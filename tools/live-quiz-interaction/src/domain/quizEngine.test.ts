import { describe, expect, it } from 'vitest'
import {
  createQuizState,
  getScoreSummary,
  goToQuestion,
  parseQuestionsFromText,
  submitAnswer,
} from './quizEngine'
import type { QuizQuestion } from './types'

const questions: QuizQuestion[] = [
  {
    id: 'q1',
    title: '第一题',
    prompt: '太阳从 ____ 升起。',
    answer: '东方',
    hints: ['和早晨有关', '不是西方', '两个字'],
    guide: '本题考查太阳升起方向。',
    explanation: '答案是东方。',
  },
  {
    id: 'q2',
    title: '第二题',
    prompt: '一年有 ____ 个月。',
    answer: '12',
    aliases: ['十二'],
    hints: ['大于 10', '小于 13', '两位数'],
    guide: '本题考查月份数量。',
    explanation: '答案是 12。',
  },
]

describe('quiz engine', () => {
  it('awards points and marks the current question correct when the answer matches', () => {
    const state = createQuizState(questions)

    const next = submitAnswer(state, '  东 方  ')

    expect(next.feedback.kind).toBe('correct')
    expect(next.feedback.pointsDelta).toBe(100)
    expect(next.attempts.q1.status).toBe('correct')
    expect(getScoreSummary(next).score).toBe(100)
  })

  it('subtracts points and reveals the next hint when an answer is wrong', () => {
    const state = createQuizState(questions)

    const next = submitAnswer(state, '南方')

    expect(next.feedback.kind).toBe('wrong')
    if (next.feedback.kind !== 'wrong') {
      throw new Error('Expected wrong feedback')
    }
    expect(next.feedback.pointsDelta).toBe(-10)
    expect(next.feedback.hint).toBe('和早晨有关')
    expect('correctAnswer' in next.feedback).toBe(false)
    expect(next.attempts.q1.wrongAttempts).toBe(1)
    expect(getScoreSummary(next).score).toBe(-10)
  })

  it('reveals the correct answer and locks the question after three wrong attempts', () => {
    const first = submitAnswer(createQuizState(questions), '南方')
    const second = submitAnswer(first, '北方')
    const third = submitAnswer(second, '西方')

    expect(third.feedback.kind).toBe('locked')
    if (third.feedback.kind !== 'locked') {
      throw new Error('Expected locked feedback')
    }
    expect(third.feedback.correctAnswer).toBe('东方')
    expect(third.attempts.q1.status).toBe('incorrect')
    expect(third.attempts.q1.wrongAttempts).toBe(3)
    expect(getScoreSummary(third).score).toBe(-30)
  })

  it('supports answer aliases and clamps previous/next navigation', () => {
    const state = createQuizState(questions)
    const onSecond = goToQuestion(state, 1)
    const answered = submitAnswer(onSecond, '十二')

    expect(answered.feedback.kind).toBe('correct')
    expect(goToQuestion(answered, -1).currentIndex).toBe(0)
    expect(goToQuestion(answered, 99).currentIndex).toBe(1)
  })

  it('parses pasted question text into blank prompts, answers, and hints', () => {
    const parsed = parseQuestionsFromText(`
题目：地球的卫星是月球
答案：月球
提示1：夜晚常见
提示2：绕地球转
提示3：两个字

题目：水的化学式是 H2O
答案：H2O
    `)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      title: '第 1 题',
      prompt: '地球的卫星是 ____',
      answer: '月球',
      hints: ['夜晚常见', '绕地球转', '两个字'],
    })
    expect(parsed[1].prompt).toBe('水的化学式是 ____')
  })
})
