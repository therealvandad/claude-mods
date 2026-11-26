// Pure frame functions: given a time or an age in ms (and the motion flag), the
// text and theme colour key of one frame. No engine calls, so each is unit-testable.
// `isMotion` false means "draw the static final value".
import type { Cell } from '../types'

/** The only colours used: theme keys, so every frame follows the person's theme. */
export type ColorKey = 'success' | 'error' | 'warning' | 'suggestion' | 'subtle' | 'inactive' | 'claude'
export type Run = { text: string; color: ColorKey; isBold?: boolean }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
export const clamp01 = (x: number) => clamp(x, 0, 1)
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)
export const easeInOut = (x: number) => {
  const t = clamp01(x)

  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Merges neighbouring cells of one colour into runs: fewer elements to draw. */
export const groupRuns = (cells: { glyph: string; color: ColorKey; isBold?: boolean }[]): Run[] => {
  const runs: Run[] = []

  for (const c of cells) {
    const last = runs[runs.length - 1]

    if (last !== undefined && last.color === c.color && (last.isBold ?? false) === (c.isBold ?? false)) {
      last.text += c.glyph
    } else {
      runs.push({ text: c.glyph, color: c.color, isBold: c.isBold })
    }
  }

  return runs
}

const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

// ---- 1: heartbeat dot ---------------------------------------------------------
export const BEAT_MS = 1000
const BEATS = ['●', '•', '◉', '·'] as const

/** A pulsing dot while busy (one beat a second), a dim dash when idle, a steady dot when motion is off. */
export const heartFrame = (isBusy: boolean, now: number, isMotion: boolean): { glyph: string; color: ColorKey; isBright: boolean } => {
  if (!isBusy) {
    return { glyph: '─', color: 'inactive', isBright: false }
  }

  if (!isMotion) {
    return { glyph: '●', color: 'claude', isBright: true }
  }
  const i = Math.floor((((now % BEAT_MS) + BEAT_MS) % BEAT_MS) / (BEAT_MS / BEATS.length))

  return { glyph: BEATS[i] ?? '●', color: i < 3 ? 'claude' : 'subtle', isBright: i < 3 }
}

const ECG = '────╱╲╱╲────'

/** The big form: a flat line when idle, a scrolling pulse trace when busy. */
export const ecgLine = (isBusy: boolean, now: number, isMotion: boolean, width: number): string => {
  if (!isBusy) {
    return '─'.repeat(width)
  }
  const shift = isMotion ? Math.floor(now / 100) % ECG.length : 0

  return Array.from({ length: width }, (_, i) => ECG[(i + shift) % ECG.length]).join('')
}

// ---- 2: context tank ----------------------------------------------------------
export const toneOf = (percent: number): ColorKey => (percent >= 85 ? 'error' : percent >= 70 ? 'warning' : 'success')

const waveOffset = (col: number, now: number) => Math.round(Math.sin(now / 500 + col * 0.9) * 1.4)

/** Rows of a vertical tank, top to bottom. The surface row ripples by up to one eighth block per column. */
export const tankRows = (percent: number, now: number, height: number, width: number, isMotion: boolean): string[] => {
  const p = clamp(percent, 0, 100)
  const total = height * 8
  const fill = (p / 100) * total
  const rows: string[] = []

  for (let r = 0; r < height; r++) {
    const fromBottom = height - 1 - r
    let line = ''

    for (let c = 0; c < width; c++) {
      const off = isMotion && p > 0 && p < 100 ? waveOffset(c, now) : 0
      const eighths = clamp(clamp(Math.round(fill + off), 0, total) - fromBottom * 8, 0, 8)
      line += BLOCKS[eighths]
    }
    rows.push(line)
  }

  return rows
}

/** One cell of tank for the band. */
export const tankMini = (percent: number) => BLOCKS[Math.max(1, Math.round((clamp(percent, 0, 100) / 100) * 8))] ?? '▁'

// ---- 3: coin drop -------------------------------------------------------------
export const COIN_MS = 480
/** Which row the coin is on: 0 and 1 are the two rows above the figure, 2 is the figure itself (landed). Undefined: none. */
export const coinRow = (age: number): 0 | 1 | 2 | undefined =>
  age < 0 || age >= COIN_MS ? undefined : (Math.floor(age / (COIN_MS / 3)) as 0 | 1 | 2)

// ---- 4: sparkline draw-in -----------------------------------------------------
export const SPARK_MS = 600
const SPARK = '▁▂▃▄▅▆▇█'

/** The last `width` values as block glyphs, scaled between their own min and max. */
export const sparkline = (values: number[], width: number): string => {
  const v = values.slice(-width)

  if (v.length === 0) {
    return ''
  }
  const lo = Math.min(...v)
  const hi = Math.max(...v)

  return v.map(x => (hi === lo ? '▄' : (SPARK[Math.round(((x - lo) / (hi - lo)) * 7)] ?? '▄'))).join('')
}

/** The sparkline revealed left to right over SPARK_MS from `age`; whole when settled or motion is off. */
export const sparkReveal = (values: number[], width: number, age: number, isMotion: boolean): string => {
  const full = sparkline(values, width)

  if (!isMotion || age < 0 || age >= SPARK_MS) {
    return full
  }
  const n = Math.ceil(full.length * easeOut(age / SPARK_MS))

  return full.slice(0, n).padEnd(full.length, ' ')
}

// ---- 5: tab underline slide ---------------------------------------------------
export const TAB_MS = 320

/** The underline row under tabs `cellWidth` wide: a bar that stretches toward the new tab, then its tail follows. */
export const underlineFrame = (cellWidth: number, from: number, to: number, age: number, isMotion: boolean): string => {
  if (!isMotion || from === to || age < 0 || age >= TAB_MS) {
    return ' '.repeat(to * cellWidth) + '━'.repeat(cellWidth)
  }
  const lead = easeOut(age / TAB_MS)
  const trail = easeOut((age - 70) / (TAB_MS - 70))
  const isRight = to > from
  const a = isRight ? trail : lead
  const b = isRight ? lead : trail
  const left = Math.round((from + (to - from) * a) * cellWidth)
  const right = Math.round((from + (to - from) * b) * cellWidth + cellWidth)

  return ' '.repeat(left) + '━'.repeat(Math.max(1, right - left))
}

// ---- 6: shake on error --------------------------------------------------------
export const SHAKE_MS = 400
export const SHAKE_BASE = 3
const SHAKE_STEPS = [3, -3, 2, -2] // one per 100 ms, decaying

export const shakeOffset = (age: number, isMotion: boolean) =>
  !isMotion || age < 0 || age >= SHAKE_MS ? 0 : (SHAKE_STEPS[Math.floor(age / 100)] ?? 0)

/** The status text, pushed left and right of its resting indent while it shakes. */
export const shakeText = (text: string, age: number, isMotion: boolean) =>
  ' '.repeat(SHAKE_BASE + shakeOffset(age, isMotion)) + text

// ---- 7: confetti --------------------------------------------------------------
export const CONFETTI_MS = 1500
const CONFETTI_COLORS: ColorKey[] = ['success', 'warning', 'suggestion', 'claude', 'error']
const CONFETTI_GLYPHS = ['*', '✦', '•', '+', '◆', '▪']
const PIECES = 22

const rand = (seed: number, k: number) => {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453

  return x - Math.floor(x)
}

/** A burst from the bottom centre: pieces fly up, fall back, rest, then fade. Rows of runs; [] once it is over. */
export const confettiFrame = (age: number, seed: number, width: number, rows: number): Run[][] => {
  if (age < 0 || age >= CONFETTI_MS) {
    return []
  }
  const s = age / 1000
  const fade = age > CONFETTI_MS * 0.7
  const grid: ({ glyph: string; color: ColorKey } | undefined)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: width }, () => undefined),
  )

  for (let p = 0; p < PIECES; p++) {
    const vx = (rand(seed, p * 4) - 0.5) * 2 * width * 0.55
    const vy = rows * (1.4 + rand(seed, p * 4 + 1) * 1.6)
    const g = rows * 5
    const x = Math.round(width / 2 + vx * Math.min(s, 0.9))
    const y = Math.min(rows - 1, Math.round(rows - 1 - (vy * s - 0.5 * g * s * s)))

    if (x < 0 || x >= width || y < 0) {
      continue
    }
    grid[y]![x] = {
      glyph: fade ? '·' : (CONFETTI_GLYPHS[Math.floor(rand(seed, p * 4 + 2) * CONFETTI_GLYPHS.length)] ?? '*'),
      color: CONFETTI_COLORS[Math.floor(rand(seed, p * 4 + 3) * CONFETTI_COLORS.length)] ?? 'success',
    }
  }

  return grid.map(row => groupRuns(row.map(c => c ?? { glyph: ' ', color: 'inactive' as ColorKey })))
}

// ---- 8: flip clock ------------------------------------------------------------
export const FLIP_MS = 240

/** A digit changing: the old glyph, two half-flap glyphs, then the new one. */
export const flipGlyph = (prev: string, next: string, age: number): string => {
  if (prev === next || age >= FLIP_MS) {
    return next
  }

  return age < 60 ? prev : age < 120 ? '▀' : age < 180 ? '▄' : next
}

export const secsLeft = (endAt: number, now: number) => Math.max(0, Math.ceil((endAt - now) / 1000))

/** `MM:SS`, the minutes at least `minWidth` digits. */
export const clockText = (secs: number, minWidth = 2) =>
  `${String(Math.floor(secs / 60)).padStart(minWidth, '0')}:${String(secs % 60).padStart(2, '0')}`

/** The characters of the clock at `now`; a digit that just changed shows an in-between glyph. */
export const flipFrame = (endAt: number, totalMs: number, now: number, isMotion: boolean): string[] => {
  const secs = secsLeft(endAt, now)
  const width = Math.max(2, String(Math.floor(Math.ceil(totalMs / 1000) / 60)).length)
  const text = clockText(secs, width)

  if (!isMotion || now >= endAt || secs + 1 > Math.ceil(totalMs / 1000)) {
    return text.split('')
  }
  const frac = (endAt - now) % 1000
  const age = (1000 - frac) % 1000
  const prev = clockText(secs + 1, width)

  return text.split('').map((ch, i) => (ch === ':' ? ch : flipGlyph(prev[i] ?? ch, ch, age)))
}

// ---- 9: badge unlock flash ----------------------------------------------------
export const BADGE_MS = 700
export const BADGE_MAX = 24

/** A highlight three cells wide sweeping across the label: swept, hot, not yet swept. Settled: all swept. */
export const badgeFrame = (text: string, age: number, isMotion: boolean): { done: string; hot: string; todo: string } => {
  if (!isMotion || age < 0 || age >= BADGE_MS) {
    return { done: text, hot: '', todo: '' }
  }
  const n = text.length
  const pos = Math.floor(easeInOut(age / BADGE_MS) * (n + 3)) - 3
  const start = clamp(pos, 0, n)
  const end = clamp(pos + 3, 0, n)

  return { done: text.slice(0, start), hot: text.slice(start, end), todo: text.slice(end) }
}

// ---- 10: sky strip ------------------------------------------------------------
/** The local hour with minutes as a fraction. */
export const hourOf = (ms: number) => {
  const d = new Date(ms)

  return d.getHours() + d.getMinutes() / 60
}

export const isDay = (hour: number) => hour >= 6 && hour < 18

/** 24 cells, one per hour: the sun (day) or moon (night) sits on the current hour; stars twinkle at night. */
export const skyCells = (hour: number, now: number, isMotion: boolean): { glyph: string; color: ColorKey }[] => {
  const at = Math.floor(clamp(hour, 0, 23.999))
  const twinkle = isMotion ? Math.floor(now / 1500) : 0

  return Array.from({ length: 24 }, (_, i) => {
    if (i === at) {
      return isDay(hour) ? { glyph: '☀', color: 'warning' as ColorKey } : { glyph: '☾', color: 'suggestion' as ColorKey }
    }

    if (i === 5 || i === 18) {
      return { glyph: '░', color: 'warning' as ColorKey }
    }

    if (i > 5 && i < 18) {
      return { glyph: '─', color: 'subtle' as ColorKey }
    }

    return (i * 7 + twinkle) % 4 === 0
      ? { glyph: '✦', color: 'subtle' as ColorKey }
      : { glyph: '·', color: 'inactive' as ColorKey }
  })
}

// ---- 11: skeleton shimmer -----------------------------------------------------
const HOT = 4

/** A placeholder bar: a bright window sliding across it. Static: plain dim bar. */
export const shimmerBar = (width: number, now: number, isMotion: boolean): { before: string; hot: string; after: string } => {
  if (!isMotion) {
    return { before: '░'.repeat(width), hot: '', after: '' }
  }
  const pos = (Math.floor(now / 60) % (width + HOT)) - HOT
  const start = clamp(pos, 0, width)
  const end = clamp(pos + HOT, 0, width)

  return { before: '░'.repeat(start), hot: '▓'.repeat(end - start), after: '░'.repeat(width - end) }
}

// ---- 12: conveyor queue -------------------------------------------------------
export const SLIDE_MS = 150
export const BELT = 14

export type BeltCell = { glyph: string; color: ColorKey }

/** How long after it finishes the newest call keeps sliding at most (to settle on the pile). */
export const SLIDE_SPAN = SLIDE_MS * BELT

/**
 * The belt: cell 0 is the intake (a mark while calls run), finished calls enter at
 * cell 1 and slide right one cell per SLIDE_MS until they meet the pile that
 * builds from the right end (oldest rightmost). Static: everything already settled.
 */
export const conveyorFrame = (cells: Cell[], now: number, isMotion: boolean, width = BELT): BeltCell[] => {
  const out: BeltCell[] = Array.from({ length: width }, () => ({ glyph: '·', color: 'inactive' as ColorKey }))
  const running = cells.filter(c => c.endAt === 0).length
  out[0] = running > 0 ? { glyph: running > 1 ? String(Math.min(running, 9)) : '▶', color: 'suggestion' } : { glyph: '○', color: 'inactive' }
  const done = cells
    .filter(c => c.endAt > 0)
    .sort((a, b) => a.endAt - b.endAt)
    .slice(-(width - 1))
  let previous = width // the position of the next older cell: a newer one stays left of it

  done.forEach((c, i) => {
    const final = width - 1 - i
    const pos = isMotion ? Math.min(final, 1 + Math.floor(Math.max(0, now - c.endAt) / SLIDE_MS)) : final
    const at = Math.min(pos, previous - 1)
    previous = Math.min(at, previous)

    if (at >= 1) {
      out[at] = { glyph: (c.tool[0] ?? '?').toUpperCase(), color: c.isErr ? 'error' : 'success' }
    }
  })

  return out
}

/** True while any finished call is still sliding toward its place. */
export const isSliding = (cells: Cell[], now: number) =>
  cells.some(c => c.endAt > 0 && now - c.endAt < SLIDE_SPAN)

// ---- 13: ink-spread highlight -------------------------------------------------
export const INK_MS = 1200

/** A file row: the glow spreads left to right (0-600 ms), holds bright, cools, and settles dim by 1200 ms. */
export const inkFrame = (text: string, age: number, isMotion: boolean): Run[] => {
  if (!isMotion || age < 0 || age >= INK_MS) {
    return [{ text, color: 'inactive' }]
  }

  if (age < 600) {
    const n = Math.ceil(text.length * easeOut(age / 600))

    return [
      { text: text.slice(0, n), color: 'claude', isBold: true },
      { text: text.slice(n), color: 'inactive' },
    ].filter(r => r.text !== '') as Run[]
  }

  return [{ text, color: age < 900 ? 'claude' : 'suggestion', isBold: age < 900 }]
}

// ---- 14: ambient state --------------------------------------------------------
const RECENT = 10

/** The share of errors among the last RECENT calls; `outcomes` is a string of `o` (ok) and `e` (error). */
export const ambientRatio = (outcomes: string) => {
  const last = outcomes.slice(-RECENT)

  return last.length === 0 ? 0 : last.split('').filter(c => c === 'e').length / last.length
}

export const ambientLevel = (ratio: number): 0 | 1 | 2 | 3 => (ratio < 0.1 ? 0 : ratio < 0.3 ? 1 : ratio < 0.55 ? 2 : 3)
export const AMBIENT_LABELS = ['calm', 'ripples', 'choppy', 'stormy'] as const
export const ambientColor = (level: number): ColorKey => (['success', 'suggestion', 'warning', 'error'] as const)[level] ?? 'success'

const WAVES = [
  { base: 2, amp: 0.8, speed: 0.0012, noise: 0 },
  { base: 2.5, amp: 1.4, speed: 0.002, noise: 0 },
  { base: 3.5, amp: 2.4, speed: 0.004, noise: 0.8 },
  { base: 4.5, amp: 3.2, speed: 0.007, noise: 1.6 },
] as const

/** A line of waves: gentle swells when calm, taller, faster and jagged as the level rises. Static: level's resting pose. */
export const waveLine = (level: number, now: number, isMotion: boolean, width: number): string => {
  const w = WAVES[clamp(level, 0, 3)]!
  const phase = isMotion ? now * w.speed : 0
  const bucket = Math.floor(now / 120)

  return Array.from({ length: width }, (_, i) => {
    const jitter = isMotion ? (rand(i, bucket) - 0.5) * 2 * w.noise : 0
    const v = w.base + w.amp * Math.sin(i * 0.55 + phase) + jitter

    return BLOCKS[clamp(Math.round(v), 1, 8)]
  }).join('')
}

// ---- demo ---------------------------------------------------------------------
export const DEMO_MS = 6000

/** What the demo shows in place of live data: busy, a context sweep, and an error ratio that rises then falls. */
export const demoView = (age: number): { isBusy: boolean; ctx: number; ratio: number } => {
  const t = clamp01(age / DEMO_MS)
  const ratio = t < 0.25 ? 0 : t < 0.6 ? ((t - 0.25) / 0.35) * 0.8 : t < 0.8 ? 0.8 : 0.8 * (1 - (t - 0.8) / 0.2)

  return { isBusy: age >= 0 && age < DEMO_MS, ctx: 15 + 55 * easeInOut(t), ratio }
}

/** A fixed sample series so a lab with no history yet still has something to draw. */
export const SAMPLE_SERIES = [2, 3, 3, 5, 4, 6, 8, 7, 9, 12, 11, 14, 13, 17, 19, 18, 22, 24, 23, 27]

// ---- small pure helpers the engine code uses -----------------------------------
/** The last two path segments, cut to 44 characters from the left. */
export const shortPath = (path: string) => {
  const tail = path.split('/').filter(Boolean).slice(-2).join('/')

  return tail.length > 44 ? `…${tail.slice(-43)}` : tail
}

/** A `git commit` that really made a commit: the command says so and the output shows a new sha. */
export const commitSucceeded = (command: string, stdout: string, hasGitOp: boolean): boolean => {
  if (!/\bgit\b[^;&|\n]*?\bcommit\b/.test(command) || /--dry-run/.test(command)) {
    return false
  }

  if (/nothing (added )?to commit|no changes added to commit/i.test(stdout)) {
    return false
  }

  return hasGitOp || /^\[[^\]\n]+ [0-9a-f]{7,}\]/m.test(stdout)
}

/** The hour ruler under the sky strip, aligned to its 24 cells. */
export const skyAxis = () => {
  const a = Array.from({ length: 26 }, () => ' ')
  const put = (s: string, at: number) => s.split('').forEach((ch, i) => (a[at + i] = ch))
  put('0', 0)
  put('6', 6)
  put('12', 12)
  put('18', 18)
  put('23', 23)

  return a.join('').trimEnd()
}

export const fmtClock = (ms: number) => {
  const d = new Date(ms)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
