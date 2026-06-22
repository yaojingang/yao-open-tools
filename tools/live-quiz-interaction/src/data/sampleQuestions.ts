import type { QuizQuestion } from '../domain/types'

export const sampleQuestions: QuizQuestion[] = [
  {
    id: 'sample-1',
    title: '第 1 题',
    prompt: '太阳从 ____ 升起。',
    answer: '东方',
    hints: ['想想早晨的方向', '不是西方', '两个字'],
    guide: '本题考查太阳升起方向。先回忆“日出东方”这个常识。',
    explanation: '答案是“东方”。太阳从东方升起，这是方向类基础常识。',
  },
  {
    id: 'sample-2',
    title: '第 2 题',
    prompt: '一年有 ____ 个月。',
    answer: '12',
    aliases: ['十二'],
    hints: ['大于 10', '小于 13', '也可以写成十二'],
    guide: '本题考查月份常识。先确定一年包含多少个月。',
    explanation: '答案是“12”。一年有 12 个月，也可以写作“十二”。',
  },
  {
    id: 'sample-3',
    title: '第 3 题',
    prompt: '《望岳》的作者是 ____。',
    answer: '杜甫',
    hints: ['唐代诗人', '被称为诗圣', '两个字'],
    guide: '本题考查诗人与作品对应关系。先回忆《望岳》的作者。',
    explanation: '答案是“杜甫”。《望岳》是杜甫的代表诗作之一。',
  },
  {
    id: 'sample-4',
    title: '第 4 题',
    prompt: '水的化学式是 ____。',
    answer: 'H2O',
    aliases: ['h₂o'],
    hints: ['由氢和氧组成', '有 2 个氢原子', '三个字符'],
    guide: '本题考查水的化学式。注意数字 2 的位置。',
    explanation: '答案是“H2O”。水分子由两个氢原子和一个氧原子组成。',
  },
]

export const sampleSourceText = `题目：太阳从东方升起。
答案：东方
提示1：想想早晨的方向
提示2：不是西方
提示3：两个字

题目：一年有12个月。
答案：12
提示1：大于 10
提示2：小于 13
提示3：也可以写成十二

题目：《望岳》的作者是杜甫。
答案：杜甫
提示1：唐代诗人
提示2：被称为诗圣
提示3：两个字`
