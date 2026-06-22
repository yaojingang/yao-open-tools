import {
  ArrowLeft,
  ArrowRight,
  Check,
  Lightbulb,
  RotateCcw,
  Send,
  Trophy,
  Volume2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { rationalQuestions } from './data/rationalQuestions'
import type { QuizFeedback, QuizQuestion } from './domain/types'
import {
  createQuizState,
  getScoreSummary,
  goToQuestion,
  submitAnswer,
} from './domain/quizEngine'
import { playResultSound } from './utils/sound'

function App() {
  const [quizState, setQuizState] = useState(() =>
    createQuizState(rationalQuestions),
  )
  const [answer, setAnswer] = useState('')
  const [resultDialog, setResultDialog] = useState<QuizFeedback | null>(null)
  const question = quizState.questions[quizState.currentIndex]
  const attempt = question?.id ? quizState.attempts[question.id] : undefined
  const summary = useMemo(() => getScoreSummary(quizState), [quizState])
  const progress = Math.round(
    ((summary.correct + summary.incorrect) / summary.total) * 100,
  )
  const canAnswer = attempt?.status === 'unanswered'
  const panel = getCoachPanel(quizState.feedback, question)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!answer.trim() || !canAnswer) {
      return
    }

    const nextState = submitAnswer(quizState, answer)
    setQuizState(nextState)
    setResultDialog(nextState.feedback)
    setAnswer('')

    if (nextState.feedback.kind !== 'idle') {
      playResultSound(
        nextState.feedback.kind === 'correct' ? 'correct' : nextState.feedback.kind,
      )
    }
  }

  const jumpTo = (index: number) => {
    setQuizState((current) => goToQuestion(current, index))
    setResultDialog(null)
    setAnswer('')
  }

  const reset = () => {
    setQuizState(createQuizState(rationalQuestions))
    setResultDialog(null)
    setAnswer('')
  }

  return (
    <main className="page">
      {resultDialog && resultDialog.kind !== 'idle' ? (
        <ResultDialog
          feedback={resultDialog}
          onClose={() => setResultDialog(null)}
        />
      ) : null}

      <header className="masthead">
        <div>
          <p className="kicker">有理数经典 100 题</p>
          <h1>直播填空答题</h1>
        </div>
        <div className="score" aria-label="总积分">
          <Trophy aria-hidden="true" size={16} />
          <strong>{summary.score}</strong>
          <span>分</span>
        </div>
      </header>

      <section className="paper" aria-labelledby="question-title">
        <div className="meta-line">
          <span>
            第 {quizState.currentIndex + 1} / {summary.total} 题
          </span>
          <span>
            对 {summary.correct} · 错 {summary.incorrect}
          </span>
        </div>

        <div className="progress" aria-label={`完成进度 ${progress}%`}>
          <span style={{ inlineSize: `${progress}%` }} />
        </div>

        <h2 id="question-title">
          {question.prompt.split('\n').map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h2>

        <form className="answer-form" onSubmit={handleSubmit}>
          <label htmlFor="answer">答案</label>
          <div className="answer-row">
            <input
              id="answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={!canAnswer}
              autoComplete="off"
              placeholder={canAnswer ? '输入填空答案' : '本题已结束'}
            />
            <button type="submit" disabled={!canAnswer}>
              <Send aria-hidden="true" size={15} />
              提交
            </button>
          </div>
        </form>

        <section className={`coach ${panel.kind}`} aria-live="polite">
          <div className="coach-label">
            <Lightbulb aria-hidden="true" size={15} />
            <span>{panel.title}</span>
          </div>
          <p>{panel.body}</p>
        </section>

        <nav className="actions" aria-label="题目操作">
          <button type="button" onClick={() => jumpTo(quizState.currentIndex - 1)}>
            <ArrowLeft aria-hidden="true" size={15} />
            上一题
          </button>
          <button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" size={15} />
            重置
          </button>
          <button type="button" onClick={() => jumpTo(quizState.currentIndex + 1)}>
            下一题
            <ArrowRight aria-hidden="true" size={15} />
          </button>
        </nav>
      </section>
    </main>
  )
}

function ResultDialog({
  feedback,
  onClose,
}: {
  feedback: QuizFeedback
  onClose: () => void
}) {
  const correct = feedback.kind === 'correct'
  const locked = feedback.kind === 'locked'

  return (
    <div className="dialog-layer" role="dialog" aria-live="assertive">
      <div className={`result-dialog ${correct ? 'is-correct' : 'is-wrong'}`}>
        <div className="dialog-icon" aria-hidden="true">
          {correct ? <Check size={22} /> : <X size={22} />}
        </div>
        <div>
          <strong>{correct ? '答对了' : locked ? '公布答案' : '答错了'}</strong>
          <p>{feedback.message}</p>
        </div>
        <span className="dialog-points">{formatPoints(feedback.pointsDelta)}</span>
        <Volume2 className="dialog-sound" aria-label="已播放音效" size={16} />
        <button type="button" className="dialog-close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}

function getCoachPanel(feedback: QuizFeedback, question: QuizQuestion) {
  if (feedback.kind === 'correct') {
    return {
      kind: 'correct',
      title: '解析',
      body: question.explanation,
    }
  }

  if (feedback.kind === 'locked') {
    return {
      kind: 'wrong',
      title: '解析',
      body: `正确答案：${feedback.correctAnswer}。${question.explanation}`,
    }
  }

  if (feedback.kind === 'wrong') {
    return {
      kind: 'wrong',
      title: '提示',
      body: feedback.hint ?? question.guide,
    }
  }

  return {
    kind: 'idle',
    title: '提示',
    body: question.guide,
  }
}

function formatPoints(points: number) {
  if (points > 0) {
    return `+${points}`
  }
  return String(points)
}

export default App
