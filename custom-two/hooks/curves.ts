// Easing curves as pure math. No `$`: the demo animation in register.tsx only calls `ease`.
import type { Config } from '../types'
import { BUILTIN_CURVES } from './pure'

export type Custom = Config['curves'][number]

const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0)

const bounce = (t: number): number => {
  const n = 7.5625
  const d = 2.75

  if (t < 1 / d) {
    return n * t * t
  }

  if (t < 2 / d) {
    const u = t - 1.5 / d

    return n * u * u + 0.75
  }

  if (t < 2.5 / d) {
    const u = t - 2.25 / d

    return n * u * u + 0.9375
  }
  const u = t - 2.625 / d

  return n * u * u + 0.984375
}

/** y of a cubic Bezier easing at x = t (the same maths as CSS cubic-bezier), by bisection: 24 steps, no loops left open. */
export const bezier = (x1: number, y1: number, x2: number, y2: number, t: number): number => {
  const x = clamp01(t)
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  let lo = 0
  let hi = 1
  let s = x

  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2
    const xs = ((ax * s + bx) * s + cx) * s

    if (xs < x) {
      lo = s
    } else {
      hi = s
    }
  }

  return ((ay * s + by) * s + cy) * s
}

/** The built-in easings by name. Returns 0 at t=0 and 1 at t=1 for every one of them. */
export const builtin = (name: string, raw: number): number => {
  const t = clamp01(raw)
  const c1 = 1.70158
  const c3 = c1 + 1

  switch (name) {
    case 'linear':
      return t
    case 'easeIn':
      return t * t * t
    case 'easeOut':
      return 1 - (1 - t) ** 3
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    case 'easeOutBack':
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
    case 'easeOutBounce':
      return bounce(t)
    case 'easeOutElastic':
      return t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1
    case 'step':
      return t >= 1 ? 1 : Math.floor(t * 4) / 4
    default:
      return t
  }
}

export const curveNames = (custom: readonly Custom[]): string[] => [...BUILTIN_CURVES, ...custom.map(c => c.name)]

/** Any known curve by name, built-in or one of the stored cubic-bezier rows. Unknown names are linear. */
export const ease = (name: string, t: number, custom: readonly Custom[]): number => {
  const c = custom.find(x => x.name === name)

  return c === undefined ? builtin(name, t) : bezier(c.x1, c.y1, c.x2, c.y2, t)
}

/** `n` values of the curve at t = 0 .. 1: the 12-dot preview strip uses 12. */
export const samples = (name: string, custom: readonly Custom[], n = 12): number[] => Array.from({ length: n }, (_, i) => ease(name, n === 1 ? 1 : i / (n - 1), custom))

const BARS = '▁▂▃▄▅▆▇█'

/** A text strip: one bar per sample, 0 to 1 over eight heights (overshoot is held at the ends). */
export const strip = (values: readonly number[]): string => values.map(v => BARS[Math.min(7, Math.max(0, Math.round(clamp01(v) * 7)))] ?? '▁').join('')

/** Animation frames for the demo: the value at each of `frames` steps, ending exactly on 1. */
export const framesOf = (name: string, custom: readonly Custom[], frames: number): number[] => Array.from({ length: frames }, (_, i) => (i === frames - 1 ? 1 : ease(name, (i + 1) / frames, custom)))
