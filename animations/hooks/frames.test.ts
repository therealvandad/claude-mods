import { expect, test } from 'claude-code/testing'

import {
  BADGE_MS,
  BELT,
  COIN_MS,
  CONFETTI_MS,
  FLIP_MS,
  INK_MS,
  SHAKE_BASE,
  SHAKE_MS,
  SLIDE_MS,
  SPARK_MS,
  TAB_MS,
  ambientColor,
  ambientLevel,
  ambientRatio,
  badgeFrame,
  clockText,
  coinRow,
  commitSucceeded,
  confettiFrame,
  conveyorFrame,
  demoView,
  ecgLine,
  flipFrame,
  flipGlyph,
  heartFrame,
  inkFrame,
  isSliding,
  shakeOffset,
  shakeText,
  shimmerBar,
  shortPath,
  skyAxis,
  skyCells,
  sparkReveal,
  sparkline,
  tankMini,
  tankRows,
  toneOf,
  underlineFrame,
  waveLine,
} from './frames'
import type { ColorKey } from './frames'

const THEME: ColorKey[] = ['success', 'error', 'warning', 'suggestion', 'subtle', 'inactive', 'claude']

// ---- 1 heartbeat ----------------------------------------------------------------
test('1 the heartbeat pulses while busy, flatlines when idle, and is a steady dot with motion off', () => {
  expect(heartFrame(false, 0, true)).toEqual({ glyph: '─', color: 'inactive', isBright: false })
  expect(heartFrame(false, 500, true).glyph).toBe('─')
  const glyphs = [0, 250, 500, 750].map(t => heartFrame(true, t, true).glyph)
  expect(glyphs).toEqual(['●', '•', '◉', '·'])
  expect(new Set(glyphs).size).toBe(4)
  expect(heartFrame(true, 1000, true).glyph).toBe('●')
  // Motion off: the final static value, whatever the clock says.
  expect(heartFrame(true, 0, false).glyph).toBe('●')
  expect(heartFrame(true, 500, false).glyph).toBe('●')
  expect(ecgLine(false, 700, true, 12)).toBe('─'.repeat(12))
  expect(ecgLine(true, 0, true, 12)).not.toBe(ecgLine(true, 300, true, 12))
  expect(ecgLine(true, 0, false, 12)).toBe(ecgLine(true, 900, false, 12))
  expect(ecgLine(true, 0, true, 30).length).toBe(30)
})

// ---- 2 tank -----------------------------------------------------------------------
test('2 the tank fills with the percent and only its surface row waves', () => {
  expect(tankRows(50, 0, 4, 4, false)).toEqual(['    ', '    ', '████', '████'])
  expect(tankRows(100, 123, 4, 3, true)).toEqual(['███', '███', '███', '███'])
  expect(tankRows(0, 123, 3, 3, true)).toEqual(['   ', '   ', '   '])
  // 37.5% of 4 rows = 12 eighths: three full rows' worth is a bottom row full, 4 eighths more above it.
  const still = tankRows(37.5, 0, 4, 6, false)
  expect(still).toEqual(['      ', '      ', '▄▄▄▄▄▄', '██████'])
  const moving = tankRows(37.5, 700, 4, 6, true)
  expect(moving[3]).toBe('██████')
  expect(moving[0]).toBe('      ')
  expect(moving[2]).not.toBe(still[2])
  expect(moving.every(r => r.length === 6)).toBe(true)
  // Over time the surface differs; with motion off it never does.
  const frames = new Set([0, 400, 800, 1200, 1600].map(t => tankRows(37.5, t, 4, 6, true)[2]))
  expect(frames.size > 1).toBe(true)
  expect(tankRows(37.5, 0, 4, 6, false)).toEqual(tankRows(37.5, 999, 4, 6, false))
  expect(tankMini(0)).toBe('▁')
  expect(tankMini(100)).toBe('█')
  expect(toneOf(10)).toBe('success')
  expect(toneOf(75)).toBe('warning')
  expect(toneOf(90)).toBe('error')
})

// ---- 3 coin ---------------------------------------------------------------------
test('3 the coin falls through two rows and lands on the figure', () => {
  expect(coinRow(-1)).toBeUndefined()
  expect(coinRow(0)).toBe(0)
  expect(coinRow(COIN_MS / 3 + 1)).toBe(1)
  expect(coinRow((COIN_MS * 2) / 3 + 1)).toBe(2)
  expect(coinRow(COIN_MS)).toBeUndefined()
})

// ---- 4 sparkline ------------------------------------------------------------------
test('4 a sparkline is revealed left to right over 600 ms and is whole when settled or static', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8]
  expect(sparkline(v, 8)).toBe('▁▂▃▄▅▆▇█')
  expect(sparkline([5, 5, 5], 8)).toBe('▄▄▄')
  expect(sparkline([], 8)).toBe('')
  expect(sparkline(v, 4)).toBe('▁▃▆█')
  expect(sparkReveal(v, 8, 0, true)).toBe(' '.repeat(8))
  expect(sparkReveal(v, 8, 40, true).trim().startsWith('▁')).toBe(true)
  const mid = sparkReveal(v, 8, SPARK_MS / 3, true)
  expect(mid.length).toBe(8)
  expect(mid.trimEnd().length > 1 && mid.trimEnd().length < 8).toBe(true)
  expect(mid.startsWith('▁▂')).toBe(true)
  expect(sparkReveal(v, 8, SPARK_MS, true)).toBe('▁▂▃▄▅▆▇█')
  expect(sparkReveal(v, 8, 100, false)).toBe('▁▂▃▄▅▆▇█')
  let last = 0

  for (let age = 0; age <= SPARK_MS; age += 50) {
    const shown = sparkReveal(v, 8, age, true).trimEnd().length
    expect(shown >= last).toBe(true)
    last = shown
  }
})

// ---- 5 underline --------------------------------------------------------------------
test('5 the underline glides, stretching toward the pressed tab, and ends exactly under it', () => {
  const W = 12
  expect(underlineFrame(W, 0, 0, -1, true)).toBe('━'.repeat(W))
  expect(underlineFrame(W, 0, 2, TAB_MS, true)).toBe(' '.repeat(24) + '━'.repeat(W))
  expect(underlineFrame(W, 0, 2, 10, false)).toBe(' '.repeat(24) + '━'.repeat(W))
  const mid = underlineFrame(W, 0, 2, 100, true)
  const start = mid.indexOf('━')
  expect(start > 0 && start < 24).toBe(true)
  expect(mid.length - start > W).toBe(true)
  // Going left it stretches the other way and still ends on the tab.
  expect(underlineFrame(W, 2, 0, TAB_MS, true)).toBe('━'.repeat(W))
  const left = underlineFrame(W, 2, 0, 100, true)
  expect(left.indexOf('━') < 24).toBe(true)
  // The left edge never moves backwards while gliding right.
  let prev = -1

  for (let age = 0; age < TAB_MS; age += 20) {
    const x = underlineFrame(W, 0, 2, age, true).indexOf('━')
    expect(x >= prev).toBe(true)
    prev = x
  }
})

// ---- 6 shake ----------------------------------------------------------------------
test('6 the status text jitters for 400 ms and settles on its resting indent', () => {
  const offs = [0, 100, 200, 300].map(a => shakeOffset(a, true))
  expect(offs).toEqual([3, -3, 2, -2])
  expect(shakeOffset(SHAKE_MS, true)).toBe(0)
  expect(shakeOffset(50, false)).toBe(0)
  const texts = [0, 100, 200, 300, 400].map(a => shakeText('x', a, true))
  expect(new Set(texts).size).toBe(5)
  expect(texts[4]).toBe(' '.repeat(SHAKE_BASE) + 'x')
  expect(shakeText('x', 50, false)).toBe(' '.repeat(SHAKE_BASE) + 'x')
  expect(texts.every(t => t.trim() === 'x')).toBe(true)
})

// ---- 7 confetti ------------------------------------------------------------------
test('7 the confetti burst lasts 1.5 s, stays in its box, uses theme colours and is deterministic', () => {
  expect(confettiFrame(-1, 1, 24, 3)).toEqual([])
  expect(confettiFrame(CONFETTI_MS, 1, 24, 3)).toEqual([])
  const seen = new Set<string>()
  let sawPieces = false

  for (let age = 0; age < CONFETTI_MS; age += 100) {
    const rows = confettiFrame(age, 7, 24, 3)
    expect(rows.length).toBe(3)

    for (const row of rows) {
      expect(row.reduce((n, r) => n + r.text.length, 0)).toBe(24)

      for (const r of row) {
        expect(THEME).toContain(r.color)

        if (r.text.trim() !== '') {
          sawPieces = true
          seen.add(r.color)
        }
      }
    }
  }
  expect(sawPieces).toBe(true)
  expect(seen.size > 1).toBe(true)
  expect(JSON.stringify(confettiFrame(300, 7, 24, 3))).toBe(JSON.stringify(confettiFrame(300, 7, 24, 3)))
  expect(JSON.stringify(confettiFrame(300, 7, 24, 3))).not.toBe(JSON.stringify(confettiFrame(300, 8, 24, 3)))
  // Late frames fade to dots.
  const late = confettiFrame(1400, 7, 24, 3).flatMap(r => r.map(x => x.text)).join('')
  expect(late.replace(/[ ·]/g, '')).toBe('')
})

// ---- 8 flip clock -------------------------------------------------------------------
test('8 a digit that changes flips through half glyphs; the start, the end and motion off are static', () => {
  expect(flipGlyph('4', '3', 0)).toBe('4')
  expect(flipGlyph('4', '3', 60)).toBe('▀')
  expect(flipGlyph('4', '3', 120)).toBe('▄')
  expect(flipGlyph('4', '3', 180)).toBe('3')
  expect(flipGlyph('4', '4', 10)).toBe('4')
  expect(flipGlyph('4', '3', FLIP_MS)).toBe('3')
  expect(clockText(65)).toBe('01:05')
  expect(clockText(3600, 3)).toBe('060:00')
  const end = 100_000
  const total = 10_000
  // Start of the timer: nothing flips yet.
  expect(flipFrame(end, total, end - total, true).join('')).toBe('00:10')
  // Just after the 10 -> 9 change: the last digit is mid-flip.
  expect(flipFrame(end, total, end - 9000 + 70, true).join('')).toBe('00:▀▀')
  expect(flipFrame(end, total, end - 9000 + 130, true).join('')).toBe('00:▄▄')
  // 9 -> 8 changes only the last digit.
  expect(flipFrame(end, total, end - 8000 + 70, true).join('')).toBe('00:0▀')
  expect(flipFrame(end, total, end - 9000 + 250, true).join('')).toBe('00:09')
  // 10 -> 9 also changes the tens digit (1 -> 0).
  expect(flipFrame(end, total, end - 9000 + 70, true)[3]).toBe('▀')
  // Motion off: the value, no flaps.
  expect(flipFrame(end, total, end - 9000 + 70, false).join('')).toBe('00:09')
  // Done.
  expect(flipFrame(end, total, end, true).join('')).toBe('00:00')
  expect(flipFrame(end, total, end + 5000, true).join('')).toBe('00:00')
  // A long timer gets a wider minutes field.
  expect(flipFrame(0, 125 * 60_000, -125 * 60_000, true).join('')).toBe('125:00')
})

// ---- 9 badge -----------------------------------------------------------------------
test('9 a highlight sweeps across the badge label and the label settles', () => {
  const text = 'FIRST BLOOD'

  for (let age = 0; age <= BADGE_MS + 100; age += 50) {
    const f = badgeFrame(text, age, true)
    expect(f.done + f.hot + f.todo).toBe(text)
    expect(f.hot.length <= 3).toBe(true)
  }
  expect(badgeFrame(text, 0, true)).toEqual({ done: '', hot: '', todo: text })
  expect(badgeFrame(text, BADGE_MS, true)).toEqual({ done: text, hot: '', todo: '' })
  expect(badgeFrame(text, 100, false)).toEqual({ done: text, hot: '', todo: '' })
  const mid = badgeFrame(text, BADGE_MS / 2, true)
  expect(mid.hot.length).toBeGreaterThan(0)
  expect(mid.done.length).toBeGreaterThan(0)
  expect(mid.todo.length).toBeGreaterThan(0)
  let prev = 0

  for (let age = 0; age < BADGE_MS; age += 25) {
    const n = badgeFrame(text, age, true).done.length
    expect(n >= prev).toBe(true)
    prev = n
  }
})

// ---- 10 sky ------------------------------------------------------------------------
test('10 the sky strip has 24 cells and puts the sun or moon on the real hour', () => {
  const noon = skyCells(12.5, 0, true)
  expect(noon.length).toBe(24)
  expect(noon[12]).toEqual({ glyph: '☀', color: 'warning' })
  expect(noon.filter(c => c.glyph === '☀' || c.glyph === '☾').length).toBe(1)
  expect(skyCells(23, 0, true)[23]).toEqual({ glyph: '☾', color: 'suggestion' })
  expect(skyCells(3, 0, true)[3]!.glyph).toBe('☾')
  expect(skyCells(6, 0, true)[6]!.glyph).toBe('☀')
  expect(skyCells(18, 0, true)[18]!.glyph).toBe('☾')
  // The marker moves one cell per hour.
  expect(skyCells(9, 0, true).findIndex(c => c.glyph === '☀')).toBe(9)
  expect(skyCells(10, 0, true).findIndex(c => c.glyph === '☀')).toBe(10)
  // Stars twinkle with the clock, but not with motion off.
  expect(JSON.stringify(skyCells(1, 0, true))).not.toBe(JSON.stringify(skyCells(1, 1500, true)))
  expect(JSON.stringify(skyCells(1, 0, false))).toBe(JSON.stringify(skyCells(1, 99_999, false)))
  expect(skyCells(1, 0, true).every(c => THEME.includes(c.color))).toBe(true)
  expect(skyAxis().startsWith('0     6')).toBe(true)
})

// ---- 11 skeleton ---------------------------------------------------------------------
test('11 the skeleton bar has a moving highlight, and none with motion off', () => {
  const a = shimmerBar(20, 0, true)
  const b = shimmerBar(20, 600, true)
  expect(a.before.length + a.hot.length + a.after.length).toBe(20)
  expect(b.before.length + b.hot.length + b.after.length).toBe(20)
  expect(a.before.length).not.toBe(b.before.length)
  expect(b.hot.length).toBe(4)
  expect(shimmerBar(20, 600, false)).toEqual({ before: '░'.repeat(20), hot: '', after: '' })
  // The highlight enters from the left edge.
  expect(shimmerBar(20, 60 * 2, true).hot.length).toBe(2)
})

// ---- 12 conveyor -----------------------------------------------------------------------
const cell = (id: string, tool: string, endAt: number, isErr = false) => ({ id, tool, startAt: 0, endAt, isErr })

test('12 finished calls slide right and pile up from the right end; running calls sit at the intake', () => {
  expect(conveyorFrame([], 0, true).length).toBe(BELT)
  expect(conveyorFrame([], 0, true)[0]!.glyph).toBe('○')
  expect(conveyorFrame([cell('a', 'Bash', 0)], 5, true)[0]).toEqual({ glyph: '▶', color: 'suggestion' })
  expect(conveyorFrame([cell('a', 'Bash', 0), cell('b', 'Read', 0)], 5, true)[0]!.glyph).toBe('2')
  const one = [cell('a', 'Bash', 1000)]
  const at = (t: number) => conveyorFrame(one, t, true).findIndex(c => c.glyph === 'B')
  expect(at(1000)).toBe(1)
  expect(at(1000 + SLIDE_MS)).toBe(2)
  expect(at(1000 + SLIDE_MS * 4)).toBe(5)
  expect(at(1000 + SLIDE_MS * 40)).toBe(BELT - 1)
  // Motion off: already settled.
  expect(conveyorFrame(one, 1000, false).findIndex(c => c.glyph === 'B')).toBe(BELT - 1)
  // Errors are drawn in the error colour.
  expect(conveyorFrame([cell('a', 'Bash', 1, true)], 99_999, true)[BELT - 1]!.color).toBe('error')
  // Several: oldest rightmost, newer to its left, never two in one cell, at any moment.
  const many = ['A', 'B', 'C', 'D', 'E'].map((t, i) => cell(`c${i}`, t, 1000 + i * 40))

  for (let t = 1000; t < 4000; t += 30) {
    const f = conveyorFrame(many, t, true)
    const letters = f.map(c => c.glyph).filter(g => /[A-E]/.test(g))
    expect(new Set(letters).size).toBe(letters.length)
  }
  const settled = conveyorFrame(many, 99_999, true).map(c => c.glyph).join('')
  expect(settled.endsWith('EDCBA')).toBe(true)
  expect(conveyorFrame(many, 0, false).map(c => c.glyph).join('')).toBe(settled)
  expect(isSliding(many, 1100)).toBe(true)
  expect(isSliding(many, 99_999)).toBe(false)
  // More finished calls than belt cells: the oldest fall off.
  const lots = Array.from({ length: 40 }, (_, i) => cell(`l${i}`, 'X', 1000 + i))
  expect(conveyorFrame(lots, 99_999, true).filter(c => c.glyph === 'X').length).toBe(BELT - 1)
})

// ---- 13 ink ------------------------------------------------------------------------------
test('13 an edited row glows from left to right, holds, cools and settles by 1.2 s', () => {
  const path = 'src/app/main.ts'
  const f0 = inkFrame(path, 150, true)
  expect(f0[0]!.color).toBe('claude')
  expect(f0[0]!.isBold).toBe(true)
  expect(f0.map(r => r.text).join('')).toBe(path)
  expect(f0.length).toBe(2)
  let prev = 0

  for (let age = 0; age < 600; age += 50) {
    const lit = inkFrame(path, age, true).filter(r => r.color === 'claude').reduce((n, r) => n + r.text.length, 0)
    expect(lit >= prev).toBe(true)
    prev = lit
  }
  expect(inkFrame(path, 600, true)).toEqual([{ text: path, color: 'claude', isBold: true }])
  expect(inkFrame(path, 1000, true)).toEqual([{ text: path, color: 'suggestion', isBold: false }])
  expect(inkFrame(path, INK_MS, true)).toEqual([{ text: path, color: 'inactive' }])
  expect(inkFrame(path, 100, false)).toEqual([{ text: path, color: 'inactive' }])
  expect(inkFrame(path, -1, true)).toEqual([{ text: path, color: 'inactive' }])
})

// ---- 14 ambient ---------------------------------------------------------------------------
test('14 the waves get choppier and warmer as the error ratio of recent calls rises', () => {
  expect(ambientRatio('')).toBe(0)
  expect(ambientRatio('oooo')).toBe(0)
  expect(ambientRatio('eoeo')).toBe(0.5)
  // Only the last 10 count.
  expect(ambientRatio('eeeeeeeeeeoooooooooo')).toBe(0)
  expect(ambientLevel(0)).toBe(0)
  expect(ambientLevel(0.2)).toBe(1)
  expect(ambientLevel(0.4)).toBe(2)
  expect(ambientLevel(0.9)).toBe(3)
  expect(ambientColor(0)).toBe('success')
  expect(ambientColor(3)).toBe('error')
  const roughness = (level: number) => {
    let sum = 0
    let n = 0

    for (let t = 0; t < 3000; t += 100) {
      const line = waveLine(level, t, true, 24)
      expect(line.length).toBe(24)

      for (let i = 1; i < line.length; i++) {
        sum += Math.abs('▁▂▃▄▅▆▇█'.indexOf(line[i]!) - '▁▂▃▄▅▆▇█'.indexOf(line[i - 1]!))
        n += 1
      }
    }

    return sum / n
  }
  expect(roughness(0) < roughness(1)).toBe(true)
  expect(roughness(1) < roughness(2)).toBe(true)
  expect(roughness(2) < roughness(3)).toBe(true)
  expect(waveLine(2, 0, false, 20)).toBe(waveLine(2, 5000, false, 20))
  expect(waveLine(0, 0, true, 20)).not.toBe(waveLine(0, 2000, true, 20))
})

// ---- demo, parsing helpers -------------------------------------------------------------
test('the demo view ramps context and error ratio and ends', () => {
  expect(demoView(0).isBusy).toBe(true)
  expect(demoView(0).ratio).toBe(0)
  expect(demoView(3600).ratio).toBeGreaterThan(0.5)
  expect(demoView(5990).ratio).toBeLessThan(0.1)
  expect(demoView(6000).isBusy).toBe(false)
  expect(demoView(0).ctx).toBe(15)
})

test('commit detection needs the command and proof of a new commit; paths are shortened', () => {
  expect(commitSucceeded('git commit -m "x"', '[main abc1234] x\n 1 file changed', false)).toBe(true)
  expect(commitSucceeded('git add . && git commit -m "x"', '[feat/a 1a2b3c4d] x', false)).toBe(true)
  expect(commitSucceeded('git -C repo commit -m x', '', true)).toBe(true)
  expect(commitSucceeded('git commit -m x', 'nothing to commit, working tree clean', false)).toBe(false)
  expect(commitSucceeded('git commit --dry-run', '[main abc1234] x', false)).toBe(false)
  expect(commitSucceeded('git status', '[main abc1234] x', false)).toBe(false)
  expect(commitSucceeded('git log --oneline', 'abc1234 commit', false)).toBe(false)
  expect(shortPath('/Users/me/project/src/app/main.ts')).toBe('app/main.ts')
  expect(shortPath('x.ts')).toBe('x.ts')
  expect(shortPath(`/${'d'.repeat(60)}/f.ts`).length).toBeLessThanOrEqual(44)
})

test('every colour any frame uses is a theme key', () => {
  const colours = new Set<string>()
  colours.add(heartFrame(true, 0, true).color)
  colours.add(heartFrame(true, 900, true).color)
  colours.add(heartFrame(false, 0, true).color)
  skyCells(2, 0, true).forEach(c => colours.add(c.color))
  skyCells(14, 0, true).forEach(c => colours.add(c.color))
  conveyorFrame([cell('a', 'B', 1, true), cell('b', 'R', 2)], 9999, true).forEach(c => colours.add(c.color))
  inkFrame('abc', 100, true).forEach(r => colours.add(r.color))
  inkFrame('abc', 1000, true).forEach(r => colours.add(r.color))
  ;[0, 1, 2, 3].forEach(l => colours.add(ambientColor(l)))
  ;[10, 75, 95].forEach(p => colours.add(toneOf(p)))

  for (const c of colours) {
    expect(THEME).toContain(c)
  }
})
