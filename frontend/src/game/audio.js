// Tiny WebAudio blips. No assets, no library: a couple of oscillators with an
// envelope. The AudioContext is created lazily on first use (browsers block it
// before a gesture) and every call is a no-op when muted or unavailable.

let ctx = null
let enabled = true

export function setMuted(muted) {
  enabled = !muted
}

export function isMuted() {
  return !enabled
}

function context() {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function blip({ freq, to = freq, duration = 0.08, type = 'sine', gain = 0.06 }) {
  if (!enabled) return
  const ac = context()
  if (!ac) return
  const osc = ac.createOscillator()
  const env = ac.createGain()
  const now = ac.currentTime
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, now + duration)
  env.gain.setValueAtTime(gain, now)
  env.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  osc.connect(env).connect(ac.destination)
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

export const sfx = {
  hit: () => blip({ freq: 520, to: 700, duration: 0.05, type: 'triangle', gain: 0.04 }),
  explode: (combo = 0) =>
    blip({
      freq: 420 + Math.min(combo, 12) * 28,
      to: 980 + Math.min(combo, 12) * 40,
      duration: 0.16,
      type: 'sawtooth',
      gain: 0.05,
    }),
  miss: () => blip({ freq: 180, to: 110, duration: 0.14, type: 'square', gain: 0.045 }),
  hurt: () => blip({ freq: 120, to: 70, duration: 0.3, type: 'sawtooth', gain: 0.06 }),
  win: () => {
    blip({ freq: 523, duration: 0.12, type: 'triangle', gain: 0.05 })
    setTimeout(() => blip({ freq: 659, duration: 0.12, type: 'triangle', gain: 0.05 }), 110)
    setTimeout(() => blip({ freq: 784, duration: 0.24, type: 'triangle', gain: 0.05 }), 220)
  },
  lose: () => {
    blip({ freq: 392, to: 196, duration: 0.4, type: 'sine', gain: 0.05 })
  },
}