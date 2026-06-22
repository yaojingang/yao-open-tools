from __future__ import annotations

import json
import re
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET


DOCX_PATH = Path("/Users/laoyao/Documents/副本有理数经典100题.docx")
OUTPUT_PATH = Path("src/data/rationalQuestions.ts")
W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

CONTINUATION_GROUPS = [
    (7, 8),
    (11, 12),
    (19, 20),
    (22, 23),
    (33, 34),
    (67, 68),
    (76, 77),
]
def read_answer_items() -> list[dict[str, object]]:
    with ZipFile(DOCX_PATH) as zf:
        root = ET.fromstring(zf.read("word/document.xml"))

    items = []
    for paragraph in root.findall(f".//{W_NS}p"):
        runs = []
        for run in paragraph.findall(f"{W_NS}r"):
            text = "".join(t.text or "" for t in run.findall(f"{W_NS}t"))
            if not text:
                continue
            color = ""
            rpr = run.find(f"{W_NS}rPr")
            if rpr is not None:
                color_node = rpr.find(f"{W_NS}color")
                if color_node is not None:
                    color = color_node.attrib.get(f"{W_NS}val", "")
            runs.append({"text": text, "is_answer": color.upper() == "C00000"})

        text = "".join(str(run["text"]) for run in runs).strip()
        if text:
            items.append({"text": text, "runs": runs})

    split_index = next(
        index
        for index, item in enumerate(items)
        if item["text"] == "既不是正数，也不是负数。"
    )
    return items[:split_index]


def make_prompt_and_answers(item: dict[str, object]) -> tuple[str, list[str]]:
    prompt_parts: list[str] = []
    answers: list[str] = []
    previous_was_answer = False

    for run in item["runs"]:  # type: ignore[index]
        text = str(run["text"])
        if run["is_answer"]:
            answer = text.strip()
            if answer:
                answers.append(answer)
            if not previous_was_answer:
                prompt_parts.append("____")
            previous_was_answer = True
            continue

        prompt_parts.append(text)
        previous_was_answer = False

    return clean_prompt("".join(prompt_parts)), answers


def clean_prompt(prompt: str) -> str:
    prompt = re.sub(r"[ \t]+", " ", prompt)
    prompt = re.sub(r"\s+([，。；：、）])", r"\1", prompt)
    prompt = re.sub(r"([（])\s+", r"\1", prompt)
    return prompt.strip()


def compact(text: str, limit: int = 42) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else f"{text[:limit]}..."


def strip_end_punctuation(text: str) -> str:
    return text.rstrip("。；;，, ")


def is_judgement(text: str) -> bool:
    return bool(re.search(r"[（(]\s*[√✓✔❌×xX]\s*[）)]", text))


def make_judgement(item: dict[str, object]) -> tuple[str, str, list[str]]:
    text = str(item["text"])
    match = re.search(r"[（(]\s*([√✓✔❌×xX])\s*[）)]", text)
    if not match:
        raise ValueError(f"Not a judgement item: {text}")

    symbol = "√" if match.group(1) in {"√", "✓", "✔"} else "❌"
    prompt = re.sub(r"[（(]\s*[√✓✔❌×xX]\s*[）)]", "（____）", text)
    aliases = ["对", "正确", "是", "yes", "y", "✓", "✔"] if symbol == "√" else [
        "错",
        "错误",
        "否",
        "不对",
        "no",
        "n",
        "×",
        "x",
        "X",
    ]
    return clean_prompt(prompt), symbol, aliases


def question_groups(answer_items: list[dict[str, object]]) -> list[tuple[int, ...]]:
    grouped = {index for group in CONTINUATION_GROUPS for index in group}
    groups: list[tuple[int, ...]] = []
    index = 1
    while index <= 82:
        group = next((group for group in CONTINUATION_GROUPS if group[0] == index), None)
        if group:
            groups.append(group)
            index = group[-1] + 1
        elif index not in grouped:
            groups.append((index,))
            index += 1
        else:
            index += 1

    groups.extend((index,) for index in range(84, 109))
    return groups


def build_questions() -> list[dict[str, object]]:
    answer_items = read_answer_items()
    questions: list[dict[str, object]] = []

    for number, group in enumerate(question_groups(answer_items), start=1):
        group_items = [answer_items[index - 1] for index in group]
        first_text = str(group_items[0]["text"])

        if len(group) == 1 and is_judgement(first_text):
            prompt, answer, aliases = make_judgement(group_items[0])
            guide = make_judgement_guide(prompt)
            explanation = make_explanation(
                answer,
                group_items,
                is_judgement_question=True,
            )
        else:
            prompts: list[str] = []
            answers: list[str] = []
            for item in group_items:
                prompt, item_answers = make_prompt_and_answers(item)
                prompts.append(prompt)
                answers.extend(item_answers)
            prompt = "\n".join(prompts)
            answer = "；".join(answers)
            aliases = []
            guide = make_fill_guide(prompt)
            explanation = make_explanation(
                answer,
                group_items,
                is_judgement_question=False,
            )

        questions.append(
            {
                "id": f"rational-{number}",
                "title": f"第 {number} 题",
                "prompt": prompt,
                "answer": answer,
                "aliases": aliases,
                "hints": make_hints(prompt, answer, guide),
                "guide": guide,
                "explanation": explanation,
                "sourceText": "\n".join(str(item["text"]) for item in group_items),
            }
        )

    return questions


def make_fill_guide(prompt: str) -> str:
    blank_count = prompt.count("____")
    topic = strip_end_punctuation(compact(prompt))
    if blank_count > 1:
        return (
            f"本题考查：{topic}。共有 {blank_count} 个空，"
            "按题干出现顺序填写，多个答案用分号隔开。"
        )
    return (
        f"本题考查：{topic}。先看空格前后的限定词，"
        "再填最准确的概念、符号或数值。"
    )


def make_judgement_guide(prompt: str) -> str:
    stem = strip_end_punctuation(compact(prompt.replace("（____）", "")))
    return f"本题考查命题判断：{stem}。先想是否总成立；若有反例，就填错。"


def make_hints(prompt: str, answer: str, guide: str) -> list[str]:
    return [
        guide,
        f"答案范围可缩小到：{compact(answer, 26)}。",
        "核对符号、顺序和括号；多空题按从左到右填写。",
    ]


def make_explanation(
    answer: str,
    group_items: list[dict[str, object]],
    *,
    is_judgement_question: bool,
) -> str:
    source = " ".join(str(item["text"]) for item in group_items)
    if is_judgement_question:
        return (
            f"答案是“{answer}”。完整判断：{source} "
            "判断题不要只看局部词，要看这句话是否对所有相关情况都成立。"
        )
    return (
        f"答案是“{answer}”。完整结论：{source} "
        "这就是本题对应的定义、性质或计算结果，填空时按空格顺序写。"
    )


def write_typescript(questions: list[dict[str, object]]) -> None:
    payload = json.dumps(questions, ensure_ascii=False, indent=2)
    OUTPUT_PATH.write_text(
        "import type { QuizQuestion } from '../domain/types'\n\n"
        f"export const rationalQuestions = {payload} satisfies QuizQuestion[]\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    questions = build_questions()
    if len(questions) != 100:
        raise SystemExit(f"Expected 100 questions, got {len(questions)}")
    write_typescript(questions)
    print(f"Wrote {len(questions)} questions to {OUTPUT_PATH}")
