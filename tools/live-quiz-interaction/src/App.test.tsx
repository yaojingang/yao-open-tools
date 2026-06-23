import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { rationalQuestions } from './data/rationalQuestions'

describe('App', () => {
  it('loads the 100 rational-number questions from the Word source', () => {
    render(<App />)

    expect(rationalQuestions).toHaveLength(100)
    expect(
      rationalQuestions.every(
        (question) => question.guide.length > 8 && question.explanation.length > 8,
      ),
    ).toBe(true)
    expect(screen.getByRole('heading', { name: '有理数百问百答' })).toBeInTheDocument()
    expect(screen.getByText('第 1 / 100 题')).toBeInTheDocument()
    expect(screen.getByText('____ 既不是正数，也不是负数。')).toBeInTheDocument()
    expect(document.querySelector('.coach')).not.toBeInTheDocument()
  })

  it('awards points and shows a celebration state for a correct answer', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('答案'), '0')
    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('答对了')
    expect(screen.getByText('回答正确，获得满分')).toBeInTheDocument()
    expect(screen.queryByText('解析')).not.toBeInTheDocument()
    expect(document.querySelector('.coach')).not.toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('shows progressive hints and a penalty for a wrong answer', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('答案'), '1')
    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('答错了')
    expect(screen.getByText('回答错误，已触发第 1 次提醒')).toBeInTheDocument()
    expect(screen.queryByText('提示')).not.toBeInTheDocument()
    expect(document.querySelector('.coach')).not.toBeInTheDocument()
    expect(screen.getAllByText('-10').length).toBeGreaterThan(0)
  })
})
