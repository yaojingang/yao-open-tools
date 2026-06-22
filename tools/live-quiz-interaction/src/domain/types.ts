export type QuestionStatus = 'unanswered' | 'correct' | 'incorrect'

export type QuizQuestion = {
  id: string
  title: string
  prompt: string
  answer: string
  aliases?: string[]
  hints: string[]
  guide: string
  explanation: string
  sourceText?: string
}

export type QuestionAttempt = {
  status: QuestionStatus
  wrongAttempts: number
  submittedAnswers: string[]
}

export type QuizFeedback =
  | {
      kind: 'idle'
      message: string
      pointsDelta: 0
    }
  | {
      kind: 'correct'
      message: string
      pointsDelta: number
    }
  | {
      kind: 'wrong'
      message: string
      pointsDelta: number
      hint?: string
    }
  | {
      kind: 'locked'
      message: string
      pointsDelta: number
      hint?: string
      correctAnswer: string
    }

export type ScoreConfig = {
  correctPoints: number
  wrongPenalty: number
  maxWrongAttempts: number
}

export type QuizState = {
  questions: QuizQuestion[]
  currentIndex: number
  attempts: Record<string, QuestionAttempt>
  score: number
  config: ScoreConfig
  feedback: QuizFeedback
}

export type ScoreSummary = {
  score: number
  total: number
  correct: number
  incorrect: number
  unanswered: number
  wrongAttempts: number
}
