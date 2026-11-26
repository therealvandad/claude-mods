// Pure frame functions: given a time or age in ms, the text or colour of one frame.
// No engine calls here, so each is unit-testable and the render hooks stay small.
import type { Ring } from '../types'

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

// ---- 36: context colour glide ------------------------------------------------
const STOPS: readonly [number, [number, number, number]][] = [
  [0, [0x4a, 0xde, 0x80]], // green
  [70, [0xfb, 0xbf, 0x24]], // amber
  [90, [0xef, 0x44, 0x44]], // red
]
const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')

/** Smooth green to amber to red blend for a percentage. A raw hex colour: a blend has no theme key. */
export const blendColor = (percent: number): string => {
  const p = Math.max(0, Math.min(100, percent))

  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i]!
    const [p0, c0] = STOPS[i - 1]!

    if (p <= p1) {
      const f = (p - p0) / (p1 - p0)

      return `#${hex(c0[0] + (c1[0] - c0[0]) * f)}${hex(c0[1] + (c1[1] - c0[1]) * f)}${hex(c0[2] + (c1[2] - c0[2]) * f)}`
    }
  }
  const last = STOPS[STOPS.length - 1]![1]

  return `#${hex(last[0])}${hex(last[1])}${hex(last[2])}`
}

/** The theme key a static (motion off) gauge uses: it follows the person's theme. */
export const toneOf = (percent: number) => (percent >= 85 ? 'error' : percent >= 70 ? 'warning' : 'success')

export const barOf = (percent: number, width = 10) => {
  const filled = Math.round(clamp01(percent / 100) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const fmtSpend = (usd: number) => `$${usd.toFixed(2)}`

// ---- 30/32/33: status line entry --------------------------------------------
export const TYPE_MS = 30
export const HOLD_MS = 2600
export const ERASE_MS = 14
export const PULSE_MS = 700

/**
 * One frame of the status line: slides in (arrows shrink), types itself out
 * with a cursor, pulses its marker (diamond filled or hollow), settles, holds,
 * then erases. `undefined` means the entry is over: clear the status.
 */
export const statusFrame = (text: string, age: number): string | undefined => {
  const n = text.length
  const typedEnd = n * TYPE_MS
  const eraseStart = typedEnd + HOLD_MS
  const end = eraseStart + n * ERASE_MS

  if (age >= end) {
    return undefined
  }

  if (age >= eraseStart) {
    const left = Math.max(0, n - Math.floor((age - eraseStart) / ERASE_MS))

    return `· ${text.slice(0, left)}`
  }
  const lead = age < 300 ? '›'.repeat(3 - Math.floor(age / 100)) : ''
  const marker = age < PULSE_MS ? (Math.floor(age / 100) % 2 === 0 ? '◆' : '◇') : '▸'
  const shown = Math.min(n, Math.floor(age / TYPE_MS) + 1)
  const cursor = shown < n ? '▌' : ''

  return `${lead}${marker} ${text.slice(0, shown)}${cursor}`
}

/** The settled entry, for motion off. */
export const statusStatic = (text: string) => `▸ ${text}`

// ---- 34: shimmer -------------------------------------------------------------
/** A moving highlight over a dim track: [dim before, hot, dim after]. */
export const shimmerFrame = (now: number, width = 16): [string, string, string] => {
  const span = width + 4
  const head = (Math.floor(now / 100) % span) - 2
  const cells = Array.from({ length: width }, (_, i) => {
    const d = Math.abs(i - head)

    return d === 0 ? '▓' : d === 1 ? '▒' : '░'
  })
  const lo = cells.findIndex(c => c !== '░')

  if (lo === -1) {
    return [cells.join(''), '', '']
  }
  let hi = cells.length - 1

  while (cells[hi] === '░') {
    hi -= 1
  }

  return [cells.slice(0, lo).join(''), cells.slice(lo, hi + 1).join(''), cells.slice(hi + 1).join('')]
}

// ---- 35: check pop -----------------------------------------------------------
export const POP_MS = 420

/** The glyph a finished call passes through: dot, ringed dot, then the mark. */
export const popFrame = (age: number, isOk: boolean): { glyph: string; isStrong: boolean } => {
  const mark = isOk ? '✓' : '✗'

  return age < 110
    ? { glyph: '●', isStrong: false }
    : age < 230
      ? { glyph: '◉', isStrong: true }
      : { glyph: mark, isStrong: age < POP_MS }
}

// ---- 42: celebrate -----------------------------------------------------------
export const CHEER_MS = 2200
const SPARKS = ['✦', '·', '✧', '∗', '•', '˙', ' ']

/** A deterministic row of sparks that changes every 150 ms. */
export const confettiFrame = (now: number, width = 14): string => {
  const f = Math.floor(now / 150)

  return Array.from({ length: width }, (_, i) => SPARKS[(f * 31 + i * 17 + ((f + i) % 5) * 7) % SPARKS.length]).join('')
}

// ---- 31: ripple --------------------------------------------------------------
export const RIPPLE_MS = 420

export const rippleFrame = (age: number): string | undefined =>
  age < 100 ? '◦' : age < 200 ? '○' : age < 310 ? '◎' : age < RIPPLE_MS ? '◉' : undefined

// ---- 38: staggered entry -----------------------------------------------------
export const STAGGER_MS = 150

/** How many of `n` list items are in at `age`. */
export const staggerShown = (age: number, n: number) => Math.min(n, Math.floor(age / STAGGER_MS) + 1)

export const staggerLife = (n: number) => n * STAGGER_MS + STAGGER_MS

// ---- 39: breathing -----------------------------------------------------------
export const AWAY_MS = 60_000
export const BREATH_MAX_MS = 10 * 60_000
const LEVELS = ['·', '∙', '•', '●']

/** Five cells whose glow rolls along a four second breath. */
export const breathFrame = (now: number): { glyph: string; isBright: boolean }[] =>
  Array.from({ length: 5 }, (_, i) => {
    const wave = (Math.sin((now / 4000) * 2 * Math.PI - i * 0.6) + 1) / 2
    const level = Math.min(3, Math.floor(wave * 4))

    return { glyph: LEVELS[level]!, isBright: level >= 2 }
  })

// ---- 40: spring ring ---------------------------------------------------------
const K = 160
const C = 9

/** Semi-implicit Euler for an underdamped spring; settles exactly on target. */
export const springStep = (r: Ring, dtMs: number): Ring => {
  let { pos, vel } = r
  const sub = Math.max(1, Math.ceil(dtMs / 16))
  const h = dtMs / 1000 / sub

  for (let i = 0; i < sub; i++) {
    vel += (K * (r.target - pos) - C * vel) * h
    pos += vel * h
  }

  return Math.abs(r.target - pos) < 0.004 && Math.abs(vel) < 0.02
    ? { pos: r.target, vel: 0, target: r.target }
    : { pos, vel, target: r.target }
}

export const springIsLive = (r: Ring) => r.pos !== r.target || r.vel !== 0

const RING = ['○', '◔', '◑', '◕', '●']

export const ringGlyph = (pos: number) => RING[Math.round(clamp01(pos) * 4)]!

export const ringBar = (pos: number, width = 8) => {
  const filled = Math.round(clamp01(pos) * width)

  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}
