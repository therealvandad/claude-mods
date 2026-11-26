// Pure frame functions for anim-more: given an age or a time in ms, the text of one frame.
// No engine calls, so each is unit-testable. Every function takes `isAnim`: when false
// (motion off, or settings calm) it returns the STATIC FINAL frame, never a mid-way one.

export const TICK_MS = 150

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const frameOf = (age: number, count: number) => Math.floor(age / TICK_MS) % count

// ---- durations (ms) of each one-shot piece ----------------------------------------
export const TIP_MS = 450
export const GLOW_MS = 4800
export const UNDER_MS = 600
export const SQUISH_MS = 300
export const TOAST_MS = 450
export const TOAST_HOLD_MS = 3000
export const PULSE_MS = 900
export const DRIP_MS = 900
export const RAIN_MS = 1200
export const FIRE_MS = 2000
export const BALLOON_MS = 2000
export const FLIP_MS = 450
export const PLANT_MS = 450
export const PLANT_DEMO_MS = 2800
export const PET_MS = 6000
export const ROCKET_MS = 450
export const DEMO_MS = 7500
export const IDLE_MS = 60_000
export const TOAST_GAP_MS = 3 * 60_000

/** True while an event stamped at `at` (0 = never) is still playing at `now`. */
export const isLiveAt = (at: number, now: number, ms: number) => at > 0 && now >= at && now - at < ms

// ---- 143 pop-in tooltip: a 3-step grow ----------------------------------------------
/** The hint text at `age` since it appeared: a third, two thirds, then all of it. `age < 0` is hidden. */
export const tooltipFrame = (text: string, age: number, isAnim: boolean): string => {
  if (age < 0) {
    return ''
  }

  if (!isAnim || age >= TIP_MS) {
    return text
  }
  const step = Math.min(2, Math.floor(age / (TIP_MS / 3)))

  return text.slice(0, Math.max(1, Math.ceil((text.length * (step + 1)) / 3)))
}

// ---- 144 breathing glow: border steps between two theme keys ------------------------
export type Glow = { side: 'a' | 'b'; isDim: boolean }
const GLOW_CYCLE: readonly Glow[] = [
  { side: 'a', isDim: false },
  { side: 'a', isDim: false },
  { side: 'a', isDim: true },
  { side: 'b', isDim: true },
  { side: 'b', isDim: false },
  { side: 'b', isDim: false },
  { side: 'b', isDim: false },
  { side: 'b', isDim: false },
  { side: 'b', isDim: true },
  { side: 'a', isDim: true },
  { side: 'a', isDim: false },
  { side: 'a', isDim: false },
]
export const GLOW_STEPS = GLOW_CYCLE.length

/** The border colour step at time `now`. Static: steady side `a`. */
export const glowFrame = (now: number, isAnim: boolean): Glow => (isAnim ? GLOW_CYCLE[frameOf(now, GLOW_CYCLE.length)]! : { side: 'a', isDim: false })

// ---- 145 underline draw (Button-driven), left to right ------------------------------
/** `hot` cells drawn so far and the dim `rest`. `age < 0` is not drawn at all (all rest). Static: fully drawn. */
export const underlineFrame = (width: number, age: number, isAnim: boolean): { hot: string; rest: string } => {
  if (age < 0) {
    return { hot: '', rest: '─'.repeat(width) }
  }

  if (!isAnim || age >= UNDER_MS) {
    return { hot: '━'.repeat(width), rest: '' }
  }
  const n = Math.min(width, Math.floor((age / UNDER_MS) * width) + 1)

  return { hot: '━'.repeat(n), rest: '─'.repeat(width - n) }
}

// ---- 146 button squish: a 2-frame inset ---------------------------------------------
/** Left padding of a pressed button: 2 for the first frame, 1 for the second, 0 at rest. Static: always 0. */
export const squishFrame = (age: number, isAnim: boolean): number =>
  !isAnim || age < 0 || age >= SQUISH_MS ? 0 : age < SQUISH_MS / 2 ? 2 : 1

// ---- 147 slide-up toast: 3 staged frames on the status line -------------------------
/** Frame 0 low bar and a third of the text, frame 1 a taller bar and two thirds, frame 2 the settled line. */
export const toastFrame = (text: string, age: number, isAnim: boolean): string => {
  if (!isAnim || age >= TOAST_MS) {
    return `▸ ${text}`
  }
  const step = Math.max(0, Math.min(2, Math.floor(age / (TOAST_MS / 3))))

  if (step === 2) {
    return `▸ ${text}`
  }

  return `${step === 0 ? '▁' : '▄'} ${text.slice(0, Math.max(1, Math.ceil((text.length * (step + 1)) / 3)))}`
}

/** True when a toast may be shown: none yet, or the last one was at least three minutes ago. */
export const canToast = (now: number, lastAt: number) => lastAt === 0 || now - lastAt >= TOAST_GAP_MS

// ---- 148 wave under a working indicator ----------------------------------------------
const WAVE = '▁▂▃▄▅▆▇'

/** A one-row wave `width` cells wide. Static: the phase-0 row. */
export const waveRow = (now: number, width: number, isAnim: boolean): string => {
  const phase = isAnim ? Math.floor(now / TICK_MS) * 0.9 : 0

  return Array.from({ length: Math.max(0, width) }, (_, i) => WAVE[Math.round(3 + 3 * Math.sin(i * 0.7 + phase))]!).join('')
}

// ---- 149 orbiting dots: selectable spinners ------------------------------------------
export const SPINNERS: Readonly<Record<string, readonly string[]>> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  orbit: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  round: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  quad: ['▖', '▘', '▝', '▗'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  pulse: ['·', '•', '●', '•'],
}
export const SPINNER_NAMES = Object.keys(SPINNERS)

export const spinnerFrame = (name: string, now: number, isAnim: boolean): string => {
  const frames = SPINNERS[name] ?? SPINNERS.dots!

  return isAnim ? frames[frameOf(now, frames.length)]! : frames[0]!
}

/** The next variant after `name`, wrapping; an unknown name starts at the first. */
export const nextSpinner = (name: string) => SPINNER_NAMES[(SPINNER_NAMES.indexOf(name) + 1) % SPINNER_NAMES.length]!

// ---- 150 typewriter ---------------------------------------------------------------------
/** Ms per character: 40 ms, but never longer than 2.5 s for the whole text. */
export const typeStepMs = (len: number) => Math.max(1, Math.min(40, 2500 / Math.max(1, len)))
export const typeMs = (text: string) => Math.ceil(text.length * typeStepMs(text.length))

/** The revealed prefix and whether the cursor still blinks. Static: all of it, no cursor. */
export const typeFrame = (text: string, age: number, isAnim: boolean): { shown: string; hasCursor: boolean } => {
  if (!isAnim || age < 0 || age >= typeMs(text)) {
    return { shown: text, hasCursor: false }
  }
  const n = Math.max(0, Math.min(text.length, Math.floor(age / typeStepMs(text.length)) + 1))

  return { shown: text.slice(0, n), hasCursor: n < text.length }
}

// ---- 151 marquee for long paths ---------------------------------------------------------
const GAP = '   '

/** A long string cut in the middle to fit `width` (the static frame). */
export const middleTruncate = (text: string, width: number): string => {
  if (text.length <= width || width < 5) {
    return text.length <= width ? text : text.slice(0, width)
  }
  const keep = width - 1
  const head = Math.ceil(keep / 2)

  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
}

/** How long the scroll runs: one full loop of a short text, at most 9 s for a long one. */
export const marqueeMs = (text: string) => Math.min(9000, (text.length + GAP.length) * TICK_MS)

/** A `width`-cell window sliding along the text, one cell per tick. Short text and static: no scroll. */
export const marqueeFrame = (text: string, width: number, age: number, isAnim: boolean): string => {
  if (text.length <= width) {
    return text
  }

  if (!isAnim || age < 0 || age >= marqueeMs(text)) {
    return middleTruncate(text, width)
  }
  const loop = `${text}${GAP}${text}`
  const at = Math.floor(age / TICK_MS) % (text.length + GAP.length)

  return loop.slice(at, at + width)
}

// ---- 152 pulsing badge: 3 pulses, then settled --------------------------------------------
export type Pulse = 'bright' | 'dim' | 'steady'

export const pulseFrame = (age: number, isAnim: boolean): Pulse =>
  !isAnim || age < 0 || age >= PULSE_MS ? 'steady' : Math.floor(age / TICK_MS) % 2 === 0 ? 'bright' : 'dim'

/** How many bright beats a pulse has: three. */
export const PULSES = 3

// ---- 153 drip on spend --------------------------------------------------------------------
/** `drop` is the row (0..2) of the falling drop or -1; `figure` ticks from `from` to `to` in 3 steps after it lands. Static: `to`. */
export const dripFrame = (age: number, from: number, to: number, isAnim: boolean): { drop: number; figure: number } => {
  if (!isAnim || age < 0 || age >= DRIP_MS) {
    return { drop: -1, figure: to }
  }

  if (age < DRIP_MS / 2) {
    return { drop: Math.min(2, Math.floor(age / TICK_MS)), figure: from }
  }
  const step = Math.min(3, Math.floor((age - DRIP_MS / 2) / TICK_MS) + 1)

  return { drop: -1, figure: from + ((to - from) * step) / 3 }
}

// ---- 154 plant -------------------------------------------------------------------------------
export const PLANT_ROWS = 5
export const PLANT_WIDTH = 7
export const PLANT_STAGES = 7
const PLANT: readonly (readonly string[])[] = [
  ['       ', '       ', '       ', '       ', '~~~.~~~'],
  ['       ', '       ', '       ', '   ,   ', '~~~|~~~'],
  ['       ', '       ', '  \\ /  ', '   |   ', '~~~|~~~'],
  ['       ', '   |   ', '  \\|/  ', '   |   ', '~~~|~~~'],
  ['   o   ', '  \\|/  ', '   |   ', '  \\|/  ', '~~~|~~~'],
  ['  (o)  ', '  \\|/  ', '   |   ', ' \\ |/  ', '~~~|~~~'],
  [' \\ | / ', ' -(*)- ', ' / | \\ ', '  \\|/  ', '~~~|~~~'],
]
const PLANT_AT = [0, 1, 2, 4, 7, 14, 21] as const

/** Stage 0..6 from the number of days a tool call was run: 0, 1, 2, 4, 7, 14, 21. */
export const stageOf = (days: number) => PLANT_AT.reduce<number>((s, at, i) => (days >= at && days > 0 ? i : s), 0)

/** Days still needed to reach the next stage, or 0 at full bloom. */
export const daysToNext = (days: number) => {
  const next = PLANT_AT[stageOf(days) + 1]

  return next === undefined ? 0 : next - days
}

export const plantRows = (stage: number): readonly string[] => PLANT[Math.max(0, Math.min(PLANT_STAGES - 1, Math.floor(stage)))]!

/** When the stage grows: the old plant, the old plant with a spark above it, then the new one. Static: the new stage. */
export const plantFrame = (stage: number, prev: number, age: number, isAnim: boolean): readonly string[] => {
  if (!isAnim || age < 0 || age >= PLANT_MS || prev >= stage) {
    return plantRows(stage)
  }
  const step = Math.min(2, Math.floor(age / (PLANT_MS / 3)))

  if (step === 0) {
    return plantRows(prev)
  }

  if (step === 1) {
    const rows = [...plantRows(prev)]
    rows[0] = rows[0]!.trim() === '' ? '   *   ' : rows[0]!

    return rows
  }

  return plantRows(stage)
}

/** The stage a preview of the whole growth shows: one stage per 400 ms, 0 to 6. */
export const plantDemoStage = (age: number) => Math.max(0, Math.min(PLANT_STAGES - 1, Math.floor(age / 400)))

/** The local calendar day of a timestamp as `YYYY-MM-DD`. */
export const dayKey = (t: number) => {
  const d = new Date(t)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---- seeded hash for rain and fireworks -------------------------------------------------------
const hash = (seed: number, n: number) => {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)

  return (h ^ (h >>> 13)) >>> 0
}

const blank = (width: number, rows: number) => Array.from({ length: rows }, () => Array.from({ length: width }, () => ' '))
const joinGrid = (grid: string[][]) => grid.map(r => r.join(''))

// ---- 155 rain of small glyphs ------------------------------------------------------------------
const RAIN_GLYPHS = ['·', '˙', ':', '`', '*']

/** A 1.2 s shower, `rows` rows of `width` cells. Empty (`[]`) when it is not playing and for the static frame. */
export const rainFrame = (age: number, seed: number, width: number, rows: number, isAnim: boolean): string[] => {
  if (!isAnim || age < 0 || age >= RAIN_MS) {
    return []
  }
  const step = Math.floor(age / TICK_MS)
  const grid = blank(width, rows)

  for (let c = 0; c < width; c++) {
    const h = hash(seed, c)

    if (h % 3 !== 0) {
      continue
    }
    const y = step - (h % 5)

    if (y >= 0 && y < rows) {
      grid[y]![c] = RAIN_GLYPHS[(h >>> 8) % RAIN_GLYPHS.length]!
    }
  }

  return joinGrid(grid)
}

// ---- 156 fireworks -------------------------------------------------------------------------------
const SPOKES: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]

/** A 2 s release: a rocket rises for 0.6 s then a burst grows and fades. Empty when idle and for the static frame. */
export const fireworksFrame = (age: number, seed: number, width: number, rows: number, isAnim: boolean): string[] => {
  if (!isAnim || age < 0 || age >= FIRE_MS || width < 9 || rows < 4) {
    return []
  }
  const grid = blank(width, rows)
  const x = 4 + (hash(seed, 99) % (width - 8))
  const top = 1

  if (age < 600) {
    const y = rows - 1 - Math.floor((age / 600) * (rows - 1 - top))
    grid[Math.max(top, y)]![x] = '|'

    return joinGrid(grid)
  }
  const r = Math.floor((age - 600) / 200)
  const glyph = r < 3 ? '*' : r < 5 ? '+' : '·'

  for (const [dx, dy] of SPOKES) {
    const px = x + dx * r * 2
    const py = top + dy * Math.ceil(r / 2)

    if (px >= 0 && px < width && py >= 0 && py < rows) {
      grid[py]![px] = glyph
    }
  }

  if (r < 6) {
    grid[top]![x] = '✦'
  }

  return joinGrid(grid)
}

// ---- 157 balloons rising ----------------------------------------------------------------------------
const BALLOON_COLS = [3, 8, 13, 18, 23] as const

/** Balloons climbing for 2 s. The static and the settled frame: all at the top, strings hanging. `age < 0` is `[]`. */
export const balloonsFrame = (age: number, width: number, rows: number, isAnim: boolean): string[] => {
  if (age < 0 || rows < 3) {
    return []
  }
  const grid = blank(width, rows)
  const span = rows - 2

  BALLOON_COLS.forEach((c, i) => {
    if (c >= width) {
      return
    }
    const p = !isAnim || age >= BALLOON_MS ? 1 : clamp01((age / BALLOON_MS) * 1.25 - i * 0.05)
    const y = Math.round((1 - p) * span)
    grid[y]![c] = '●'
    grid[y + 1]![c] = '│'
  })

  return joinGrid(grid)
}

// ---- 158 page flip between journal days ----------------------------------------------------------------
/** Old page, a folded middle, then the new page (3 frames in 450 ms). Static: the new page. */
export const flipFrame = (oldText: string, newText: string, age: number, width: number, isAnim: boolean): string => {
  if (!isAnim || age < 0 || age >= (FLIP_MS * 2) / 3) {
    return newText
  }

  if (age < FLIP_MS / 3) {
    return oldText
  }
  const fold = '▒'.repeat(Math.max(1, Math.ceil(Math.min(width, Math.max(oldText.length, newText.length)) / 4)))

  return ' '.repeat(Math.max(0, Math.floor((Math.min(width, Math.max(oldText.length, newText.length)) - fold.length) / 2))) + fold
}

// ---- 159 dial spin ---------------------------------------------------------------------------------------
const DIAL = ['◴', '◷', '◶', '◵'] as const

/** A quarter-circle dial turning clockwise. Static: the upright dial. */
export const dialFrame = (now: number, isAnim: boolean): string => (isAnim ? DIAL[frameOf(now, DIAL.length)]! : DIAL[0])

// ---- 160 pendulum ------------------------------------------------------------------------------------------
export const PENDULUM_WIDTH = 9

/** Three rows: the pivot, then the bob high at the ends of the swing and low in the middle. Static: hanging still. */
export const pendulumFrame = (now: number, isAnim: boolean): [string, string, string] => {
  const mid = (PENDULUM_WIDTH - 1) / 2
  const pos = isAnim ? Math.round(mid + mid * Math.sin((Math.floor(now / TICK_MS) * 0.55))) : mid
  const row = (glyph: string, at: number) => ' '.repeat(at) + glyph + ' '.repeat(PENDULUM_WIDTH - 1 - at)
  const isHigh = Math.abs(pos - mid) >= 3

  return [row('┬', mid), isHigh ? row('●', pos) : ' '.repeat(PENDULUM_WIDTH), isHigh ? ' '.repeat(PENDULUM_WIDTH) : row('●', pos)]
}

// ---- 161 walking pet ----------------------------------------------------------------------------------------
export const PET_STRIP = 20
const PET_W = 5

/** A 5-cell cat on a 20-cell strip; it walks to the end and back, wagging its tail. Static: sitting mid-strip. */
export const petFrame = (step: number, isAnim: boolean): string => {
  const travel = PET_STRIP - PET_W
  const p = isAnim ? ((step % (travel * 2)) + travel * 2) % (travel * 2) : travel / 2
  const isRight = p <= travel
  const x = isRight ? p : travel * 2 - p
  const isWag = isAnim && step % 2 === 1
  const sprite = isWag ? (isRight ? '=^.^~' : '~^.^=') : '=^.^='
  const strip = Array.from({ length: PET_STRIP }, () => '·')
  sprite.split('').forEach((ch, i) => (strip[Math.floor(x) + i] = ch))

  return strip.join('')
}

// ---- 162 rocket progress ----------------------------------------------------------------------------------------
export const ROCKET_TRACK = 24

/** The track at `percent`. While the percent just changed it glides from `from` in 3 steps with a flame behind. Static: jumps, no flame. */
export const rocketFrame = (percent: number, from: number, age: number, isAnim: boolean): string => {
  const to = Math.max(0, Math.min(100, percent))
  const isGlide = isAnim && age >= 0 && age < ROCKET_MS && from !== to
  const shown = isGlide ? from + ((to - from) * Math.min(3, Math.floor(age / (ROCKET_MS / 3)) + 1)) / 3 : to
  const head = Math.round((shown / 100) * (ROCKET_TRACK - 1))
  const cells: string[] = Array.from({ length: ROCKET_TRACK }, (_, i) => (i < head ? '═' : i === head ? (to >= 100 && !isGlide ? '★' : '▶') : '·'))

  if (isGlide && head > 0) {
    cells[head - 1] = '≈'
  }

  return cells.join('')
}

// ---- helpers for the events that start pieces ------------------------------------------------------------------------
const BUILD_RES = [
  /(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|test|compile|ci)\b/,
  /(?:^|[\s;&|(])(?:cargo|go|dotnet|swift)\s+(?:build|test)\b/,
  /(?:^|[\s;&|(])(?:make|ninja|xcodebuild|tsc|vitest|jest|pytest|tox)\b/,
  /(?:^|[\s;&|(])cmake\s+--build\b/,
  /(?:^|[\s;&|(])(?:\.\/)?gradlew?\s+(?:build|test|assemble)\b/,
  /(?:^|[\s;&|(])mvn\s+(?:\S+\s+)*(?:package|test|verify|install)\b/,
]

/** A Bash command that builds or tests. */
export const isBuildCommand = (command: string) => BUILD_RES.some(re => re.test(command)) && !/--help|--version|\s-h(\s|$)/.test(command)

/** A `git tag` that creates a tag: not a list, delete or verify. */
export const isTagCreate = (command: string) => {
  const m = /\bgit\b[^;&|\n]*?\btag\b([^;&|\n]*)/.exec(command)

  if (m === null) {
    return false
  }
  const rest = (m[1] ?? '').trim()

  if (/(^|\s)(-d|--delete|-l|--list|-v|--verify|-n\d*)(\s|$)/.test(rest) || rest === '') {
    return false
  }

  return /(^|\s)(-a|-s|-m|-f|-u)/.test(rest) || /(^|\s)[^-\s]/.test(rest)
}

/** A finished Bash call that shows no sign of failure in its output. */
export const outputLooksOk = (stdout: string) => !/(\b\d+\s+(failed|failing)\b|\bFAILED\b|\bBUILD FAILED\b|error TS\d+)/.test(stdout)

/** `HH:MM` local. */
export const fmtClock = (t: number) => {
  const d = new Date(t)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Parses a percent from text such as `40`, `40%`; undefined when not 0..100. */
export const parsePercent = (text: string): number | undefined => {
  const m = /^\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*$/.exec(text)

  if (m === null) {
    return undefined
  }
  const n = Number(m[1])

  return n >= 0 && n <= 100 ? Math.round(n) : undefined
}

/** Percent of the todos that are done, rounded; 0 for none. */
export const todoPercent = (todos: readonly { done: boolean }[]) =>
  todos.length === 0 ? 0 : Math.round((todos.filter(t => t.done).length / todos.length) * 100)
