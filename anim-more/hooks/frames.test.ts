import { expect, test } from 'claude-code/testing'

import {
  BALLOON_MS,
  DRIP_MS,
  FIRE_MS,
  PET_STRIP,
  PLANT_ROWS,
  PLANT_STAGES,
  PLANT_WIDTH,
  PENDULUM_WIDTH,
  PULSES,
  RAIN_MS,
  ROCKET_TRACK,
  SPINNERS,
  SPINNER_NAMES,
  TIP_MS,
  TOAST_GAP_MS,
  balloonsFrame,
  canToast,
  daysToNext,
  dayKey,
  dialFrame,
  dripFrame,
  fireworksFrame,
  flipFrame,
  fmtClock,
  glowFrame,
  isBuildCommand,
  isLiveAt,
  isTagCreate,
  marqueeFrame,
  marqueeMs,
  middleTruncate,
  nextSpinner,
  outputLooksOk,
  parsePercent,
  pendulumFrame,
  petFrame,
  plantDemoStage,
  plantFrame,
  plantRows,
  pulseFrame,
  rainFrame,
  rocketFrame,
  spinnerFrame,
  squishFrame,
  stageOf,
  todoPercent,
  toastFrame,
  tooltipFrame,
  typeFrame,
  typeMs,
  underlineFrame,
  waveRow,
} from './frames'

// ---- 143 tooltip ---------------------------------------------------------------------
test('143 the hint grows in 3 steps, then stays; motion off shows it whole; a negative age is hidden', () => {
  const text = 'Hints grow in three steps.'
  const a = tooltipFrame(text, 0, true)
  const b = tooltipFrame(text, 160, true)
  const c = tooltipFrame(text, 320, true)
  expect(a.length).toBeLessThan(b.length)
  expect(b.length).toBeLessThan(c.length)
  expect(c).toBe(text)
  expect(text.startsWith(a)).toBe(true)
  expect(tooltipFrame(text, TIP_MS + 5000, true)).toBe(text)
  expect(tooltipFrame(text, 0, false)).toBe(text)
  expect(tooltipFrame(text, -1, true)).toBe('')
  expect(tooltipFrame(text, -1, false)).toBe('')
})

// ---- 144 glow ---------------------------------------------------------------------------
test('144 the border steps between two sides and back; static is the steady first side', () => {
  const seen = new Set<string>()

  for (let i = 0; i < 12; i++) {
    const g = glowFrame(i * 150, true)
    seen.add(`${g.side}${g.isDim ? 'd' : ''}`)
  }
  expect(seen.has('a')).toBe(true)
  expect(seen.has('b')).toBe(true)
  expect(seen.has('ad') && seen.has('bd')).toBe(true)
  expect(glowFrame(0, true)).toEqual(glowFrame(12 * 150, true))
  expect(glowFrame(0, false)).toEqual({ side: 'a', isDim: false })
  expect(glowFrame(777, false)).toEqual({ side: 'a', isDim: false })
})

// ---- 145 underline ------------------------------------------------------------------------
test('145 the underline draws left to right; before a press it is a dim rule; static is full', () => {
  const w = 10
  expect(underlineFrame(w, -1, true)).toEqual({ hot: '', rest: '─'.repeat(w) })
  let prev = 0

  for (const age of [0, 150, 300, 450, 599]) {
    const f = underlineFrame(w, age, true)
    expect(f.hot.length + f.rest.length).toBe(w)
    expect(f.hot.length).toBeGreaterThanOrEqual(prev)
    prev = f.hot.length
  }
  expect(underlineFrame(w, 0, true).hot.length).toBeLessThan(w)
  expect(underlineFrame(w, 600, true)).toEqual({ hot: '━'.repeat(w), rest: '' })
  expect(underlineFrame(w, 0, false)).toEqual({ hot: '━'.repeat(w), rest: '' })
})

// ---- 146 squish --------------------------------------------------------------------------------
test('146 a press insets for 2 frames then rests; static never insets', () => {
  expect(squishFrame(0, true)).toBe(2)
  expect(squishFrame(160, true)).toBe(1)
  expect(squishFrame(300, true)).toBe(0)
  expect(squishFrame(-1, true)).toBe(0)
  expect(squishFrame(0, false)).toBe(0)
})

// ---- 147 toast ------------------------------------------------------------------------------------
test('147 the toast is 3 staged frames ending on the settled line; at most one per 3 minutes', () => {
  const text = 'Saved the snapshot'
  const f = [0, 160, 320].map(age => toastFrame(text, age, true))
  expect(new Set(f).size).toBe(3)
  expect(f[0]!.startsWith('▁')).toBe(true)
  expect(f[1]!.startsWith('▄')).toBe(true)
  expect(f[2]).toBe(`▸ ${text}`)
  expect(toastFrame(text, 5000, true)).toBe(`▸ ${text}`)
  expect(toastFrame(text, 0, false)).toBe(`▸ ${text}`)
  expect(canToast(1000, 0)).toBe(true)
  expect(canToast(1000 + TOAST_GAP_MS - 1, 1000)).toBe(false)
  expect(canToast(1000 + TOAST_GAP_MS, 1000)).toBe(true)
})

// ---- 148 wave --------------------------------------------------------------------------------------
test('148 the wave is one row of the requested width, moves with time, and is still when static', () => {
  expect(waveRow(0, 16, true).length).toBe(16)
  expect(waveRow(0, 16, true)).not.toBe(waveRow(150, 16, true))
  expect(waveRow(0, 16, false)).toBe(waveRow(9999, 16, false))
  expect(/^[▁▂▃▄▅▆▇]+$/.test(waveRow(450, 30, true))).toBe(true)
  expect(waveRow(0, 0, true)).toBe('')
})

// ---- 149 spinners -----------------------------------------------------------------------------------
test('149 every spinner variant cycles its glyphs; static is its first glyph; unknown falls back to dots', () => {
  expect(SPINNER_NAMES.length).toBeGreaterThanOrEqual(5)

  for (const name of SPINNER_NAMES) {
    const frames = SPINNERS[name]!
    const seen = new Set(frames.map((_, i) => spinnerFrame(name, i * 150, true)))
    expect(seen.size).toBe(new Set(frames).size)
    expect(spinnerFrame(name, 0, false)).toBe(frames[0])
    expect(spinnerFrame(name, 12345, false)).toBe(frames[0])
  }
  expect(SPINNERS.dots!.slice(0, 4).join('')).toBe('⠋⠙⠹⠸')
  expect(spinnerFrame('nope', 0, true)).toBe(SPINNERS.dots![0])
  expect(nextSpinner('dots')).toBe(SPINNER_NAMES[1])
  expect(nextSpinner(SPINNER_NAMES[SPINNER_NAMES.length - 1]!)).toBe(SPINNER_NAMES[0])
  expect(nextSpinner('nope')).toBe(SPINNER_NAMES[0])
})

// ---- 150 typewriter -----------------------------------------------------------------------------------
test('150 the typewriter reveals a prefix with a cursor and finishes within 2.5 s', () => {
  const text = 'Summary: it types this out.'
  let prev = 0

  for (let age = 0; age < typeMs(text); age += 100) {
    const f = typeFrame(text, age, true)
    expect(text.startsWith(f.shown)).toBe(true)
    expect(f.shown.length).toBeGreaterThanOrEqual(prev)
    expect(f.hasCursor).toBe(f.shown.length < text.length)
    prev = f.shown.length
  }
  expect(typeFrame(text, 0, true).shown.length).toBeLessThan(text.length)
  expect(typeFrame(text, typeMs(text), true)).toEqual({ shown: text, hasCursor: false })
  expect(typeMs('x'.repeat(200))).toBeLessThanOrEqual(2501)
  expect(typeFrame(text, 0, false)).toEqual({ shown: text, hasCursor: false })
  expect(typeFrame(text, -1, true)).toEqual({ shown: text, hasCursor: false })
})

// ---- 151 marquee ----------------------------------------------------------------------------------------
test('151 the marquee slides a fixed window over a long path; short text and static do not scroll', () => {
  const path = '/Users/you/projects/a-long-project-name/packages/core/src/index.tsx'
  const w = 24
  const a = marqueeFrame(path, w, 0, true)
  const b = marqueeFrame(path, w, 300, true)
  expect(a.length).toBe(w)
  expect(b.length).toBe(w)
  expect(a).not.toBe(b)
  expect(path.includes(a)).toBe(true)
  const wrapped = marqueeFrame(path, w, (path.length - 5) * 150, true)
  expect(wrapped.length).toBe(w)
  expect(marqueeFrame(path, w, marqueeMs(path) + 1, true)).toBe(middleTruncate(path, w))
  const still = marqueeFrame(path, w, 0, false)
  expect(still).toBe(middleTruncate(path, w))
  expect(still.length).toBe(w)
  expect(still.startsWith('/Users')).toBe(true)
  expect(still.endsWith('index.tsx')).toBe(true)
  expect(marqueeFrame('short', 24, 300, true)).toBe('short')
  expect(middleTruncate('abc', 10)).toBe('abc')
})

// ---- 152 badge pulse ---------------------------------------------------------------------------------------
test('152 the badge pulses 3 times (6 steps) then settles; static is steady', () => {
  const steps = [0, 150, 300, 450, 600, 750].map(a => pulseFrame(a, true))
  expect(steps).toEqual(['bright', 'dim', 'bright', 'dim', 'bright', 'dim'])
  expect(steps.filter(s => s === 'bright').length).toBe(PULSES)
  expect(pulseFrame(900, true)).toBe('steady')
  expect(pulseFrame(-1, true)).toBe('steady')
  expect(pulseFrame(0, false)).toBe('steady')
  expect(pulseFrame(150, false)).toBe('steady')
})

// ---- 153 drip --------------------------------------------------------------------------------------------------
test('153 a drop falls through 3 rows, then the figure ticks up in 3 steps to the true value', () => {
  expect([0, 150, 300].map(a => dripFrame(a, 1, 1.03, true).drop)).toEqual([0, 1, 2])
  expect(dripFrame(0, 1, 1.03, true).figure).toBe(1)
  const ticks = [450, 600, 750].map(a => dripFrame(a, 1, 1.03, true).figure)
  expect(ticks[0]!).toBeGreaterThan(1)
  expect(ticks[1]!).toBeGreaterThan(ticks[0]!)
  expect(Math.abs(ticks[2]! - 1.03) < 1e-9).toBe(true)
  expect(dripFrame(450, 1, 1.03, true).drop).toBe(-1)
  expect(dripFrame(DRIP_MS, 1, 1.03, true)).toEqual({ drop: -1, figure: 1.03 })
  expect(dripFrame(0, 1, 1.03, false)).toEqual({ drop: -1, figure: 1.03 })
  expect(dripFrame(-1, 1, 1.03, true)).toEqual({ drop: -1, figure: 1.03 })
})

// ---- 154 plant -----------------------------------------------------------------------------------------------------
test('154 seven plant stages of one size; stage follows the days; growth plays prev, spark, new; static is the new stage', () => {
  expect(PLANT_STAGES).toBe(7)

  for (let s = 0; s < PLANT_STAGES; s++) {
    const rows = plantRows(s)
    expect(rows.length).toBe(PLANT_ROWS)
    expect(rows.every(r => r.length === PLANT_WIDTH)).toBe(true)
  }
  expect(new Set(Array.from({ length: PLANT_STAGES }, (_, s) => plantRows(s).join('|'))).size).toBe(PLANT_STAGES)
  expect([0, 1, 2, 3, 4, 7, 13, 14, 20, 21, 99].map(stageOf)).toEqual([0, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6])
  expect(daysToNext(0)).toBe(1)
  expect(daysToNext(21)).toBe(0)
  expect(plantRows(99)).toEqual(plantRows(6))
  expect(plantRows(-3)).toEqual(plantRows(0))
  const f0 = plantFrame(3, 2, 0, true)
  const f1 = plantFrame(3, 2, 160, true)
  const f2 = plantFrame(3, 2, 320, true)
  expect(f0).toEqual(plantRows(2))
  expect(f1).not.toEqual(plantRows(2))
  expect(f1.some(r => r.includes('*'))).toBe(true)
  expect(f2).toEqual(plantRows(3))
  expect(plantFrame(3, 2, 0, false)).toEqual(plantRows(3))
  expect(plantFrame(3, 3, 0, true)).toEqual(plantRows(3))
  expect(plantDemoStage(0)).toBe(0)
  expect(plantDemoStage(2800)).toBe(6)
  expect(plantDemoStage(900)).toBe(2)
})

test('154 a day key is the local calendar day', () => {
  expect(dayKey(new Date(2026, 10, 25, 23, 59).getTime())).toBe('2026-11-25')
  expect(dayKey(new Date(2026, 0, 3, 0, 1).getTime())).toBe('2026-01-03')
})

// ---- 155 rain ------------------------------------------------------------------------------------------------------------
test('155 the rain is a 1.2 s shower of small glyphs on a fixed grid; static and finished are empty', () => {
  const frames = [0, 150, 300, 450, 600, 750, 900, 1050].map(a => rainFrame(a, 7, 24, 3, true))

  for (const f of frames) {
    expect(f.length).toBe(3)
    expect(f.every(r => r.length === 24)).toBe(true)
  }
  expect(new Set(frames.map(f => f.join('|'))).size).toBeGreaterThanOrEqual(4)
  expect(frames.some(f => /[·˙:`*]/.test(f.join('')))).toBe(true)
  expect(rainFrame(300, 7, 24, 3, true)).toEqual(rainFrame(300, 7, 24, 3, true))
  expect(rainFrame(300, 8, 24, 3, true).join('')).not.toBe(rainFrame(300, 7, 24, 3, true).join(''))
  expect(rainFrame(RAIN_MS, 7, 24, 3, true)).toEqual([])
  expect(rainFrame(-1, 7, 24, 3, true)).toEqual([])
  expect(rainFrame(300, 7, 24, 3, false)).toEqual([])
})

// ---- 156 fireworks -----------------------------------------------------------------------------------------------------------
test('156 the fireworks rise then burst and fade within 2 s; static and finished are empty', () => {
  const rise = fireworksFrame(150, 3, 40, 5, true)
  expect(rise.length).toBe(5)
  expect(rise.join('').includes('|')).toBe(true)
  expect(rise.join('').includes('*')).toBe(false)
  const burst = fireworksFrame(900, 3, 40, 5, true)
  expect(burst.join('').includes('*') || burst.join('').includes('+')).toBe(true)
  expect(burst.every(r => r.length === 40)).toBe(true)
  const late = fireworksFrame(1900, 3, 40, 5, true)
  expect(late.join('').includes('*')).toBe(false)
  expect(new Set(Array.from({ length: 13 }, (_, i) => fireworksFrame(i * 150, 3, 40, 5, true).join('|'))).size).toBeGreaterThanOrEqual(6)
  expect(fireworksFrame(FIRE_MS, 3, 40, 5, true)).toEqual([])
  expect(fireworksFrame(300, 3, 40, 5, false)).toEqual([])
  expect(fireworksFrame(300, 3, 5, 5, true)).toEqual([])
})

// ---- 157 balloons ------------------------------------------------------------------------------------------------------------------
test('157 the balloons rise over 2 s and end at the top row; static is the finished frame', () => {
  const top = (rows: string[]) => rows.findIndex(r => r.includes('●'))
  const start = balloonsFrame(0, 30, 5, true)
  expect(start.length).toBe(5)
  expect(top(start)).toBeGreaterThanOrEqual(2)
  const mid = balloonsFrame(900, 30, 5, true)
  expect(top(mid)).toBeLessThan(top(start))
  const end = balloonsFrame(BALLOON_MS, 30, 5, true)
  expect(top(end)).toBe(0)
  expect(end[1]!.includes('│')).toBe(true)
  expect(balloonsFrame(0, 30, 5, false)).toEqual(end)
  expect(balloonsFrame(-1, 30, 5, true)).toEqual([])
  expect(end.every(r => r.length === 30)).toBe(true)
})

// ---- 158 page flip --------------------------------------------------------------------------------------------------------------------
test('158 the page flip shows the old page, a fold, then the new page; static is the new page', () => {
  const old = '2026-11-24  Shipped the picker.'
  const next = '2026-11-25  Wrote docs.'
  expect(flipFrame(old, next, 0, 40, true)).toBe(old)
  const fold = flipFrame(old, next, 160, 40, true)
  expect(fold).not.toBe(old)
  expect(fold).not.toBe(next)
  expect(fold.includes('▒')).toBe(true)
  expect(flipFrame(old, next, 320, 40, true)).toBe(next)
  expect(flipFrame(old, next, 0, 40, false)).toBe(next)
  expect(flipFrame(old, next, -1, 40, true)).toBe(next)
})

// ---- 159 dial, 160 pendulum, 161 pet ------------------------------------------------------------------------------------------------------
test('159 the dial turns through four quarter glyphs; static is the first', () => {
  expect(new Set([0, 150, 300, 450].map(t => dialFrame(t, true))).size).toBe(4)
  expect(dialFrame(0, true)).toBe(dialFrame(600, true))
  expect(dialFrame(300, false)).toBe(dialFrame(0, false))
})

test('160 the pendulum swings both ways with the bob high at the ends; static hangs still at the middle', () => {
  const cols = new Set<number>()
  const highs = new Set<number>()

  for (let i = 0; i < 24; i++) {
    const f = pendulumFrame(i * 150, true)
    expect(f.every(r => r.length === PENDULUM_WIDTH)).toBe(true)
    const row = f.findIndex((r, ri) => ri > 0 && r.includes('●'))
    expect(row).toBeGreaterThan(0)
    cols.add(f[row]!.indexOf('●'))
    highs.add(row)
  }
  expect(cols.size).toBeGreaterThanOrEqual(5)
  expect(highs.size).toBe(2)
  expect(Math.min(...cols)).toBeLessThanOrEqual(1)
  expect(Math.max(...cols)).toBeGreaterThanOrEqual(7)
  const still = pendulumFrame(5000, false)
  expect(still).toEqual(pendulumFrame(0, false))
  expect(still[2]!.indexOf('●')).toBe(4)
})

test('161 the pet walks a 20-cell strip to the end and back; static sits mid-strip', () => {
  const xs = Array.from({ length: 40 }, (_, i) => petFrame(i, true))
  expect(xs.every(s => s.length === PET_STRIP)).toBe(true)
  const at = (s: string) => s.search(/[=~]\^/)
  const positions = xs.map(at)
  expect(Math.min(...positions)).toBe(0)
  expect(Math.max(...positions)).toBe(PET_STRIP - 5)
  expect(new Set(xs).size).toBeGreaterThan(10)
  expect(petFrame(0, true)).toBe(petFrame(30, true))
  expect(petFrame(3, false)).toBe(petFrame(999, false))
  expect(at(petFrame(3, false))).toBe(7)
  expect(petFrame(1, true).includes('~')).toBe(true)
})

// ---- 162 rocket ---------------------------------------------------------------------------------------------------------------------------
test('162 the rocket advances by percent; a change glides in 3 steps with a flame; static jumps', () => {
  expect(rocketFrame(0, 0, -1, true).length).toBe(ROCKET_TRACK)
  expect(rocketFrame(0, 0, -1, true).startsWith('▶')).toBe(true)
  expect(rocketFrame(50, 50, -1, true).indexOf('▶')).toBe(Math.round(0.5 * (ROCKET_TRACK - 1)))
  expect(rocketFrame(100, 100, -1, true).endsWith('★')).toBe(true)
  const heads = [0, 160, 320].map(a => rocketFrame(60, 0, a, true).indexOf('▶'))
  expect(heads[0]!).toBeLessThan(heads[1]!)
  expect(heads[1]!).toBeLessThan(heads[2]!)
  expect(heads[2]).toBe(rocketFrame(60, 60, -1, true).indexOf('▶'))
  expect(rocketFrame(60, 0, 0, true).includes('≈')).toBe(true)
  expect(rocketFrame(60, 0, 0, false)).toBe(rocketFrame(60, 60, -1, true))
  expect(rocketFrame(60, 0, 0, false).includes('≈')).toBe(false)
  expect(rocketFrame(150, 0, -1, true)).toBe(rocketFrame(100, 100, -1, true))
  expect(rocketFrame(-5, 0, -1, true)).toBe(rocketFrame(0, 0, -1, true))
})

// ---- helpers for events --------------------------------------------------------------------------------------------------------------------
test('isLiveAt covers the half-open window and never-stamped', () => {
  expect(isLiveAt(0, 100, 50)).toBe(false)
  expect(isLiveAt(100, 100, 50)).toBe(true)
  expect(isLiveAt(100, 149, 50)).toBe(true)
  expect(isLiveAt(100, 150, 50)).toBe(false)
  expect(isLiveAt(100, 99, 50)).toBe(false)
})

test('a build or test command is recognised; a help flag or an unrelated command is not', () => {
  for (const c of ['npm run build', 'pnpm test', 'yarn build', 'cargo test --release', 'go build ./...', 'make', 'cd x && make all', 'pytest -q', 'tsc --noEmit', 'vitest run', './gradlew build', 'mvn -q package', 'swift build', 'bun run test']) {
    expect(isBuildCommand(c)).toBe(true)
  }

  for (const c of ['ls -la', 'git status', 'npm install', 'echo build', 'make --help', 'npm run dev', 'cat Makefile']) {
    expect(isBuildCommand(c)).toBe(false)
  }
})

test('a git tag that creates a tag is recognised; lists, deletes and verifies are not', () => {
  for (const c of ['git tag v1.0.0', 'git tag -a v1.0.0 -m "release"', 'git -C repo tag -s v2', 'git add -A && git tag v3 HEAD']) {
    expect(isTagCreate(c)).toBe(true)
  }

  for (const c of ['git tag', 'git tag -l', 'git tag --list "v*"', 'git tag -d v1', 'git tag --delete v1', 'git tag -v v1', 'git status', 'echo tag']) {
    expect(isTagCreate(c)).toBe(false)
  }
})

test('output that reports failures is not counted as success', () => {
  expect(outputLooksOk('Compiled successfully')).toBe(true)
  expect(outputLooksOk('Tests: 3 failed, 10 passed')).toBe(false)
  expect(outputLooksOk('BUILD FAILED in 3s')).toBe(false)
  expect(outputLooksOk('src/a.ts: error TS2322')).toBe(false)
  expect(outputLooksOk('')).toBe(true)
})

test('percent parsing, todo percent and the clock text', () => {
  expect(parsePercent('40')).toBe(40)
  expect(parsePercent(' 40% ')).toBe(40)
  expect(parsePercent('0')).toBe(0)
  expect(parsePercent('100')).toBe(100)
  expect(parsePercent('101')).toBeUndefined()
  expect(parsePercent('-1')).toBeUndefined()
  expect(parsePercent('abc')).toBeUndefined()
  expect(parsePercent('')).toBeUndefined()
  expect(todoPercent([])).toBe(0)
  expect(todoPercent([{ done: true }, { done: false }, { done: false }])).toBe(33)
  expect(todoPercent([{ done: true }, { done: true }])).toBe(100)
  expect(fmtClock(new Date(2026, 10, 25, 9, 5).getTime())).toBe('09:05')
})
