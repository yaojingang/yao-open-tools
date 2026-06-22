import type {
  QuestionAttempt,
  QuizFeedback,
  QuizQuestion,
  QuizState,
  ScoreConfig,
  ScoreSummary,
} from './types'

const defaultConfig: ScoreConfig = {
  correctPoints: 100,
  wrongPenalty: 10,
  maxWrongAttempts: 3,
}

export function createQuizState(
  questions: QuizQuestion[],
  config: Partial<ScoreConfig> = {},
): QuizState {
  const mergedConfig = { ...defaultConfig, ...config }
  return {
    questions,
    currentIndex: 0,
    attempts: Object.fromEntries(
      questions.map((question) => [
        question.id,
        {
          status: 'unanswered',
          wrongAttempts: 0,
          submittedAnswers: [],
        } satisfies QuestionAttempt,
      ]),
    ),
    score: 0,
    config: mergedConfig,
    feedback: {
      kind: 'idle',
      message: '等待输入答案',
      pointsDelta: 0,
    },
  }
}

export function submitAnswer(state: QuizState, rawAnswer: string): QuizState {
  const question = state.questions[state.currentIndex]
  if (!question) {
    return state
  }

  const attempt = state.attempts[question.id]
  if (attempt.status === 'correct' || attempt.status === 'incorrect') {
    return {
      ...state,
      feedback: lockedFeedback(question, 0, attempt),
    }
  }

  if (isAnswerCorrect(question, rawAnswer)) {
    return updateAttempt(state, question.id, {
      ...attempt,
      status: 'correct',
      submittedAnswers: [...attempt.submittedAnswers, rawAnswer],
    }, state.score + state.config.correctPoints, {
      kind: 'correct',
      message: '回答正确，获得满分',
      pointsDelta: state.config.correctPoints,
    })
  }

  const wrongAttempts = attempt.wrongAttempts + 1
  const nextAttempt: QuestionAttempt = {
    ...attempt,
    wrongAttempts,
    submittedAnswers: [...attempt.submittedAnswers, rawAnswer],
    status:
      wrongAttempts >= state.config.maxWrongAttempts ? 'incorrect' : 'unanswered',
  }
  const nextScore = state.score - state.config.wrongPenalty
  const hint = question.hints[Math.min(wrongAttempts - 1, question.hints.length - 1)]

  const feedback: QuizFeedback =
    wrongAttempts >= state.config.maxWrongAttempts
      ? lockedFeedback(question, -state.config.wrongPenalty, nextAttempt, hint)
      : {
          kind: 'wrong',
          message: `回答错误，已触发第 ${wrongAttempts} 次提醒`,
          pointsDelta: -state.config.wrongPenalty,
          hint,
        }

  return updateAttempt(state, question.id, nextAttempt, nextScore, feedback)
}

export function goToQuestion(state: QuizState, index: number): QuizState {
  return {
    ...state,
    currentIndex: Math.max(0, Math.min(index, state.questions.length - 1)),
    feedback: {
      kind: 'idle',
      message: '等待输入答案',
      pointsDelta: 0,
    },
  }
}

export function getScoreSummary(state: QuizState): ScoreSummary {
  const attempts = Object.values(state.attempts)
  return {
    score: state.score,
    total: state.questions.length,
    correct: attempts.filter((attempt) => attempt.status === 'correct').length,
    incorrect: attempts.filter((attempt) => attempt.status === 'incorrect').length,
    unanswered: attempts.filter((attempt) => attempt.status === 'unanswered')
      .length,
    wrongAttempts: attempts.reduce(
      (total, attempt) => total + attempt.wrongAttempts,
      0,
    ),
  }
}

export function parseQuestionsFromText(rawText: string): QuizQuestion[] {
  return rawText
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(parseQuestionBlock)
    .filter((question): question is QuizQuestion => Boolean(question))
}

function parseQuestionBlock(block: string, index: number): QuizQuestion | null {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const statement = readField(lines, /^(?:\d+[.、)]\s*)?(?:题目|问题|问)[:：]\s*(.+)$/)
  const answer = readField(lines, /^(?:答案|参考答案|正确答案)[:：]\s*(.+)$/)

  if (!statement || !answer) {
    return null
  }

  const hints = lines
    .map((line) =>
      readField(
        [line],
        /^(?:提示\s*[123一二三]?|第[一二三123]次提醒|提醒\s*[123一二三]?)[:：]\s*(.+)$/,
      ),
    )
    .filter((hint): hint is string => Boolean(hint))

  return {
    id: `q${index + 1}`,
    title: `第 ${index + 1} 题`,
    prompt: buildBlankPrompt(statement, answer),
    answer,
    hints,
    guide: `本题考查：${buildBlankPrompt(statement, answer)}。先看空格前后的关键词。`,
    explanation: `答案是“${answer}”。完整结论：${statement}`,
    sourceText: statement,
  }
}

function updateAttempt(
  state: QuizState,
  questionId: string,
  attempt: QuestionAttempt,
  score: number,
  feedback: QuizFeedback,
): QuizState {
  return {
    ...state,
    attempts: {
      ...state.attempts,
      [questionId]: attempt,
    },
    score,
    feedback,
  }
}

function lockedFeedback(
  question: QuizQuestion,
  pointsDelta: number,
  attempt: QuestionAttempt,
  hint?: string,
): QuizFeedback {
  return {
    kind: 'locked',
    message:
      attempt.status === 'incorrect'
        ? '三次机会已用完，公布正确答案'
        : '本题已经完成',
    pointsDelta,
    hint,
    correctAnswer: question.answer,
  }
}

function isAnswerCorrect(question: QuizQuestion, rawAnswer: string): boolean {
  const acceptableAnswers = [question.answer, ...(question.aliases ?? [])]
  return acceptableAnswers.some(
    (answer) => normalizeAnswer(answer) === normalizeAnswer(rawAnswer),
  )
}

function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[。．.，,、；;：:！!？?（）()[\]{}]/g, '')
}

function readField(lines: string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const match = line.match(pattern)
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  return undefined
}

function buildBlankPrompt(statement: string, answer: string): string {
  const escapedAnswer = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(escapedAnswer, 'i')
  if (pattern.test(statement)) {
    return statement
      .replace(pattern, ' ____ ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([，。,.!?！？])/g, '$1')
      .trim()
  }
  return `${statement} ____`
}
