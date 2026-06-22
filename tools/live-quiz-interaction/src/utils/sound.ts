type ResultKind = 'correct' | 'wrong' | 'locked'

type BrowserWindow = Window & {
  webkitAudioContext?: typeof AudioContext
}

export function playResultSound(kind: ResultKind) {
  if (typeof window === 'undefined') {
    return
  }

  const AudioContextClass =
    window.AudioContext ?? (window as BrowserWindow).webkitAudioContext
  if (!AudioContextClass) {
    return
  }

  const context = new AudioContextClass()
  const now = context.currentTime
  const notes = kind === 'correct' ? [523.25, 659.25, 783.99] : [220, 164.81]

  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = now + index * 0.08

    oscillator.type = kind === 'correct' ? 'sine' : 'triangle'
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.18)
  })

  window.setTimeout(() => {
    void context.close()
  }, 420)
}
