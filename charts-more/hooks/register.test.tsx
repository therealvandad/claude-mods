import { expect, mock, test } from 'claude-code/testing'

import type { Data } from '../types'
import {
  CAP,
  CHARTS,
  FOCUS_TARGET_MS,
  addNote,
  applyCall,
  applyPrompt,
  applyTurn,
  arcGrid,
  bar,
  boxplot,
  buildTree,
  candles,
  chartOf,
  clusters,
  demoData,
  demoUsage,
  dirOf,
  emptyData,
  focusMs,
  fuelGauge,
  histogram,
  lastDays,
  noteNetwork,
  parseNote,
  pieChart,
  pieSlices,
  progress,
  quantile,
  ringBorder,
  rowText,
  sanitize,
  shownRows,
  sliderRows,
  sparkleRow,
  speedScale,
  stackColumns,
  stats5,
  thermometers,
  tokenize,
  touch,
  treeChart,
  turnsLastHour,
  weekKey,
} from './pure'
import type { Ctx } from './pure'

const NOW = 1_700_000_000_000
const ctx = (data: Data, over: Partial<Ctx> = {}): Ctx => ({ data, usage: demoUsage(), now: NOW, cols: 80, p: 1, ...over })
const text = (rows: { t: string }[][]) => rows.map(r => rowText(r)).join('\n')

// ------------------------------------------------------------------ pure: numbers and bars

test('bar is always exactly w cells wide and quantiles interpolate', () => {
  for (const f of [0, 0.03, 0.5, 0.97, 1, 2, -1]) {
    expect([...bar(f, 10)].length).toBe(10)
  }
  expect(bar(0, 4)).toBe('░░░░')
  expect(bar(1, 4)).toBe('████')
  expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  expect(quantile([10, 20], 0.5)).toBe(15)
  expect(stats5([5, 1, 3, 2, 4])).toEqual({ min: 1, q1: 2, med: 3, q3: 4, max: 5, n: 5 })
  expect(stats5([])).toEqual({ min: 0, q1: 0, med: 0, q3: 0, max: 0, n: 0 })
})

test('55 histogram: counts, bins and the empty state; growth scales the bars', () => {
  const none = histogram(ctx(emptyData()))
  expect(text(none.rows)).toMatch(/No finished turns/)
  const d = { ...emptyData(), turns: [10, 12, 14, 30, 31, 90, 200, 200] }
  const full = histogram(ctx(d))
  expect(text(full.rows)).toContain('8 turns')
  expect(full.rows.length).toBe(1 + 8)
  const counts = full.rows.slice(1).map(r => Number(rowText(r).split('▏').pop()!.trim()))
  expect(counts.reduce((a, b) => a + b, 0)).toBe(8)
  const zero = histogram(ctx(d, { p: 0 }))
  expect(text(zero.rows)).toContain('0 turns')
  expect(text(zero.rows)).not.toContain('█')
  const same = histogram(ctx({ ...emptyData(), turns: [5, 5, 5] }))
  expect(same.rows.length).toBe(2)
})

test('56 box plot: whiskers, box, median in order, on one scale', () => {
  const d = { ...emptyData(), tools: { Bash: [10, 20, 30, 40, 100], Read: [5, 5, 6] } }
  const c = boxplot(ctx(d))
  const bash = rowText(c.rows.find(r => rowText(r).startsWith('Bash'))!)
  const [i0, i1, i2, i3, i4] = ['├', '[', '┃', ']', '┤'].map(ch => bash.indexOf(ch))
  expect(i0! < i1! && i1! <= i2! && i2! <= i3! && i3! < i4!).toBe(true)
  expect(bash).toContain('n=5 med 30ms')
  expect(text(boxplot(ctx(emptyData())).rows)).toMatch(/No tool calls/)
  // Growth from zero: with p=0 everything collapses to the left edge.
  const g = rowText(boxplot(ctx(d, { p: 0 })).rows.find(r => rowText(r).startsWith('Bash'))!)
  expect(g.indexOf('┤')).toBeLessThanOrEqual(g.indexOf('├') + 1)
})

test('57 ring border and 139 ring sweep', () => {
  const b = ringBorder(72, 80)
  expect(b.startsWith('╭')).toBe(true)
  expect(b.endsWith('╮')).toBe(true)
  expect(b).toContain('context 72%')
  expect(b).toContain('━')
  expect(b).toContain('┄')
  const full = arcGrid({ r: 3, from: 0, to: 360, steps: 24, value: 1, closed: true, needle: false }).flat()
  expect(full.filter(c => c.k === 'on').length).toBeGreaterThan(12)
  expect(full.filter(c => c.k === 'off').length).toBe(0)
  const none = arcGrid({ r: 3, from: 0, to: 360, steps: 24, value: 0, closed: true, needle: false }).flat()
  expect(none.filter(c => c.k === 'on').length).toBe(0)
  const half = arcGrid({ r: 3, from: 0, to: 360, steps: 24, value: 0.5, closed: true, needle: false }).flat()
  const on = half.filter(c => c.k === 'on').length
  const off = half.filter(c => c.k === 'off').length
  expect(on).toBeGreaterThan(4)
  expect(off).toBeGreaterThan(4)
  expect(Math.abs(on - off)).toBeLessThanOrEqual(4)
  const swept = chartOf('ring', ctx(emptyData(), { p: 0.5 }))
  expect(text(swept.rows)).toContain('36%')
  expect(text(chartOf('ring', ctx(emptyData(), { usage: { limits: [] } })).rows)).toMatch(/no context reading/)
})

test('58 thermometers, one per rate-limit window, and an honest empty state', () => {
  const c = thermometers(ctx(emptyData()))
  const t = text(c.rows)
  expect(t).toContain('42%')
  expect(t).toContain('5-hour')
  expect(t).toContain('7-day')
  expect(t).toContain('spend')
  expect(c.rows.length).toBe(8 + 4)
  const withReset = thermometers(ctx(emptyData(), { usage: { limits: [{ kind: 'five_hour', pct: 10, resetsAt: new Date(NOW + 2 * 3_600_000 + 600_000).toISOString() }] } }))
  expect(text(withReset.rows)).toContain('in 2h10m')
  expect(text(thermometers(ctx(emptyData(), { usage: { limits: [] } })).rows)).toMatch(/No rate-limit readings/)
  const low = text(thermometers(ctx(emptyData(), { p: 0 })).rows)
  expect(low).not.toContain('│█│')
})

test('59 fuel gauge: left of budget, no budget, no cost', () => {
  expect(text(fuelGauge(ctx(emptyData())).rows)).toMatch(/\/cmbudget/)
  const d = { ...emptyData(), budget: 10 }
  const f = text(fuelGauge(ctx(d, { usage: { limits: [], usd: 2.5 } })).rows)
  expect(f).toContain('$7.50 left')
  expect(f).toContain('of $10.00')
  expect(f).toContain('▼')
  expect(text(fuelGauge(ctx(d, { usage: { limits: [] } })).rows)).toMatch(/no session cost/)
  expect(text(fuelGauge(ctx(d, { usage: { limits: [], usd: 50 } })).rows)).toContain('$0.00 left')
})

test('60 speedometer: turns in the last hour and a nice scale', () => {
  const d = { ...emptyData(), turnAt: [NOW - 1000, NOW - 600_000, NOW - 3_000_000, NOW - 4_000_000] }
  expect(turnsLastHour(d, NOW)).toBe(3)
  expect(speedScale(3)).toBe(10)
  expect(speedScale(9)).toBe(20)
  expect(speedScale(400)).toBe(480)
  const c = chartOf('speed', ctx(d))
  expect(text(c.rows)).toContain('3/h')
  const grid = arcGrid({ r: 4, from: -90, to: 90, steps: 16, value: 0.5, closed: false, needle: true }).flat()
  expect(grid.filter(x => x.k === 'needle').length).toBe(1)
  expect(grid.length).toBeGreaterThan(0)
})

test('61 battery: focus resets after a gap of 5 minutes and caps at the 90 minute target', () => {
  let d = touch(emptyData(), NOW)
  expect(focusMs(d, NOW + 60_000)).toBe(60_000)
  d = touch(d, NOW + 4 * 60_000)
  expect(d.focusStart).toBe(NOW)
  expect(focusMs(d, NOW + 4 * 60_000)).toBe(4 * 60_000)
  d = touch(d, NOW + 10 * 60_000)
  expect(d.focusStart).toBe(NOW + 10 * 60_000)
  expect(focusMs(d, NOW + 11 * 60_000)).toBe(60_000)
  expect(focusMs(d, NOW + 30 * 60_000)).toBe(0)
  const full = { ...emptyData(), focusStart: NOW - FOCUS_TARGET_MS - 1000, lastAct: NOW - 1000 }
  expect(text(chartOf('battery', ctx(full)).rows)).toContain('fully charged')
  expect(text(chartOf('battery', ctx(emptyData())).rows)).toMatch(/No activity/)
})

// ------------------------------------------------------------------ pure: recording and privacy

test('62 words: stopwords out, counts only, bounded to 200, weekly reset, off switch', () => {
  expect(tokenize('Please refactor the parser, and refactor the parser tests https://example.com/x')).toEqual(['refactor', 'parser', 'refactor', 'parser', 'tests'])
  expect(tokenize('go go go go')).toEqual([])
  expect(tokenize('router router router router router')).toEqual(['router', 'router', 'router'])
  let d = emptyData()
  d = applyPrompt(d, { text: 'refactor the secret-sauce parser carefully, refactor again', now: NOW, isCommand: false })
  expect(d.words.refactor).toBe(2)
  // The prompt itself is never stored.
  expect(JSON.stringify(d)).not.toContain('secret-sauce parser')
  expect(JSON.stringify(d)).not.toContain('refactor the')
  // Bounded.
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const many = Array.from({ length: 400 }, (_, i) => `w${letters[i % 26]}${letters[Math.floor(i / 26) % 26]}${letters[Math.floor(i / 676)]}`.replace(/^w/, 'q'))
  for (let i = 0; i < many.length; i += 20) {
    d = applyPrompt(d, { text: many.slice(i, i + 20).join(' '), now: NOW, isCommand: false })
  }
  expect(Object.keys(d.words).length).toBeLessThanOrEqual(CAP.words)
  // The most common word survives trimming.
  expect(d.words.refactor).toBe(2)
  // A slash command is not counted; off records nothing.
  const cmd = applyPrompt(emptyData(), { text: 'deploy deploy', now: NOW, isCommand: true })
  expect(cmd.words).toEqual({})
  const off = applyPrompt({ ...emptyData(), wordsOff: true }, { text: 'deploy staging', now: NOW, isCommand: false })
  expect(off.words).toEqual({})
  // A new week starts over.
  const later = applyPrompt(applyPrompt(emptyData(), { text: 'alpha beta', now: NOW, isCommand: false }), { text: 'gamma', now: NOW + 8 * 86_400_000, isCommand: false })
  expect(Object.keys(later.words)).toEqual(['gamma'])
  expect(weekKey(NOW)).toMatch(/^\d{4}-\d\d-\d\d$/)
  expect(text(chartOf('cloud', ctx({ ...emptyData(), wordsOff: true })).rows)).toMatch(/counting is off/)
})

test('62 word cloud draws tiers by frequency', () => {
  const rows = chartOf('cloud', ctx(demoData(NOW))).rows
  const all = text(rows)
  expect(all).toContain('REFACTOR')
  expect(all).toContain('Config')
  expect(all).toMatch(/\blogging\b/)
})

test('63 notes: tags parse, links are shared tags, clusters and adjacency', () => {
  expect(parseNote('fix the cache #Perf #deploy #perf')).toEqual({ text: 'fix the cache', tags: ['perf', 'deploy'] })
  let d = emptyData()

  for (const n of ['a #x', 'b #x #y', 'c #y', 'd #z', 'lonely']) {
    d = addNote(d, n)
  }
  expect(d.notes.map(n => n.id)).toEqual([1, 2, 3, 4, 5])
  expect(clusters(d.notes)).toEqual([[0, 1, 2], [3], [4]])
  const c = noteNetwork(ctx(d))
  expect(text(c.rows)).toContain('clusters: {1,2,3}')
  // Notes 1 and 2 share one tag: a 1 in the matrix.
  expect(text(c.rows)).toMatch(/\n {2}1 {3}■ {2}1/)
  expect(addNote(d, '   ').notes.length).toBe(5)
  let big = emptyData()

  for (let i = 0; i < 80; i++) {
    big = addNote(big, `n${i} #t`)
  }
  expect(big.notes.length).toBe(CAP.notes)
  expect(text(noteNetwork(ctx(emptyData())).rows)).toMatch(/No notes yet/)
})

test('64 tree: folders relative to the project, summed up the tree', () => {
  expect(dirOf('/p', '/p/src/ui/a.ts')).toBe('src/ui')
  expect(dirOf('/p/', '/p/a.ts')).toBe('.')
  expect(dirOf('/p', '/p/a/b/c/d/e/f.ts')).toBe('a/b/c/d')
  expect(dirOf('/p', '/elsewhere/a.ts')).toBe('(outside)')
  const root = buildTree({ src: 1, 'src/ui': 3, tests: 2, '.': 1 })
  expect(root.total).toBe(7)
  expect(root.own).toBe(1)
  expect(root.kids.get('src')!.total).toBe(4)
  const t = text(treeChart(ctx({ ...emptyData(), dirs: { src: 1, 'src/ui': 3, tests: 2 } })).rows)
  expect(t).toContain('6 edits')
  expect(t).toMatch(/├─ src/)
  expect(t).toMatch(/└─ tests/)
  expect(t).toMatch(/└─ ui/)
  expect(text(treeChart(ctx(emptyData())).rows)).toMatch(/No edits/)
})

test('65 cost per model: stacked cumulative layers by model', () => {
  const samples = [
    { t: 1, m: 'a', d: 1 },
    { t: 2, m: 'b', d: 2 },
    { t: 3, m: 'a', d: 1 },
  ]
  expect(stackColumns(samples, ['a', 'b'])).toEqual([[1, 0], [1, 2], [2, 2]])
  let d = emptyData()
  d = applyTurn(d, { sec: 5, now: 1000, model: 'claude-opus-4-20250101', usd: 1 })
  d = applyTurn(d, { sec: 5, now: 2000, model: 'claude-sonnet-4', usd: 1.5 })
  d = applyTurn(d, { sec: 5, now: 3000, model: 'claude-sonnet-4', usd: 0.2 })
  expect(d.cost.map(c => [c.m, c.d])).toEqual([['claude-opus-4-20250101', 1], ['claude-sonnet-4', 0.5], ['claude-sonnet-4', 0.2]])
  const c = chartOf('area', ctx(d))
  expect(c.rows.length).toBe(7 + 2)
  expect(text(c.rows)).toContain('sonnet-4')
  expect(text(c.rows)).toContain('opus-4')
  expect(text(chartOf('area', ctx(emptyData())).rows)).toMatch(/at least two/)
  expect(text(chartOf('area', ctx(demoData(NOW))).rows)).toMatch(/█/)
})

test('66 candlesticks: first and last hour per day over 30 days', () => {
  const days = lastDays(NOW, 30)
  expect(days.length).toBe(30)
  expect(new Set(days).size).toBe(30)
  let d = emptyData()
  d = { ...d, days: { [days[29]!]: { a: 9 * 60, b: 17 * 60 + 30, n: 40 }, [days[28]!]: { a: 8 * 60 + 30, b: 8 * 60 + 45, n: 80 } } }
  const c = candles(ctx(d))
  expect(c.rows.length).toBe(12 + 2)
  const grid = c.rows.slice(0, 12).map(r => rowText(r))
  const col = (i: number) => grid.map(r => [...r][5 + i]).join('')
  // Today: 09h to 17h is rows 4 (08-10, lower half) through 8 (16-18, upper half).
  expect(col(29).replace(/[^█▀▄]/g, '')).toBe('▄████')
  expect(col(28).replace(/[^█▀▄]/g, '')).toBe('▀')
  expect(text(candles(ctx(emptyData())).rows)).toMatch(/No days/)
  // Day counters are bounded to 30 days.
  let long = emptyData()

  for (let i = 0; i < 45; i++) {
    long = touch(long, NOW + i * 86_400_000)
  }
  expect(Object.keys(long.days).length).toBe(CAP.days)
})

test('67 pie as a proportional bar with a legend', () => {
  const sl = pieSlices({ a: 50, b: 30, c: 20, d: 0 })
  expect(sl.map(s => s.name)).toEqual(['a', 'b', 'c'])
  expect(pieSlices(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`t${i}`, 10 - i]))).length).toBe(7)
  const c = pieChart(ctx({ ...emptyData(), toolTotal: { Bash: 6000, Read: 3000, Edit: 1000 } }))
  expect(rowText(c.rows[0]!).length).toBe(2 + Math.min(Math.max(80 - 6, 16), 60))
  expect(text(c.rows)).toContain(' 60%')
  expect(text(c.rows)).toContain('Bash')
  expect(c.note).toMatch(/true pie is not possible/)
  const none = pieChart(ctx({ ...emptyData(), toolTotal: { Bash: 6000 } }, { p: 0 }))
  expect(rowText(none.rows[0]!)).not.toContain('█')
})

test('68 slider: left of the divider is before, right is after, per line', () => {
  const rows = sliderRows('aaaaaaaaaa\nsame line!!', 'bbbbbbbbbb\nsame line!!', 50, 10)
  expect(rowText(rows[0]!)).toBe('aaaaa┃bbbbb')
  expect(rowText(rows[1]!)).toBe('same ┃line!')
  expect(rowText(sliderRows('abcd', 'wxyz', 0, 4)[0]!)).toBe('wxyz')
  expect(rowText(sliderRows('abcd', 'wxyz', 100, 4)[0]!)).toBe('abcd')
  expect(rowText(sliderRows('abcdef', 'wx', 50, 6)[0]!)).toBe('abc┃   ')
  expect(sliderRows(Array(30).fill('x').join('\n'), '', 50, 10).length).toBe(14)
  expect(text(chartOf('slide', ctx(emptyData())).rows)).toMatch(/Nothing stored/)
})

test('an Edit fills the slider unless the user stored their own blobs; sanitize repairs bad storage', () => {
  const edit = { old: 'one', neu: 'two' }
  const d = applyCall({ ...emptyData(), cwd: '/p' }, { tool: 'Edit', ms: 5, ok: true, now: NOW, file: '/p/src/a.ts', edit })
  expect([d.before, d.after, d.dirs.src]).toEqual(['one', 'two', 1])
  const kept = applyCall({ ...emptyData(), manual: true, before: 'mine' }, { tool: 'Edit', ms: 5, ok: true, now: NOW, edit })
  expect(kept.before).toBe('mine')
  const failed = applyCall({ ...emptyData(), cwd: '/p', streak: 4, best: 4 }, { tool: 'Bash', ms: 5, ok: false, now: NOW })
  expect([failed.streak, failed.best]).toEqual([0, 4])
  expect(sanitize('junk')).toEqual(emptyData())
  const s = sanitize({ turns: [1, 'x', 3], tools: { Bash: [1, 2], bad: 'x' }, split: 900, budget: -5, words: { a: 1, b: 'x' }, notes: [{ id: 1, text: 'n', tags: ['t'] }, 7] })
  expect(s.turns).toEqual([1, 3])
  expect(s.tools).toEqual({ Bash: [1, 2] })
  expect(s.split).toBe(100)
  expect(s.budget).toBe(0)
  expect(s.words).toEqual({ a: 1 })
  expect(s.notes.length).toBe(1)
  expect(s.noteSeq).toBe(1)
})

test('tool and turn recorders are bounded', () => {
  let d = emptyData()

  for (let i = 0; i < 100; i++) {
    d = applyCall(d, { tool: 'Bash', ms: i, ok: true, now: NOW + i })
    d = applyTurn(d, { sec: i, now: NOW + i })
  }
  expect(d.tools.Bash!.length).toBe(CAP.perTool)
  expect(d.turns.length).toBe(100)
  d = emptyData()

  for (let i = 0; i < 40; i++) {
    d = applyCall(d, { tool: `mcp_tool_${i}`, ms: 1, ok: true, now: NOW })
  }
  expect(Object.keys(d.tools).length).toBe(CAP.tools)
  expect(Object.keys(d.toolTotal).length).toBe(CAP.toolTotal)
  expect(d.streak).toBe(40)
})

// ------------------------------------------------------------------ pure: animation frames

test('137-142 animation helpers are static when off and finite when on', () => {
  expect(progress(1000, 1300, 600, true)).toBe(0.5)
  expect(progress(1000, 5000, 600, true)).toBe(1)
  expect(progress(1000, 1100, 600, false)).toBe(1)
  expect(progress(0, 1100, 600, true)).toBe(1)
  expect(shownRows(10, 0, 400, true)).toBe(1)
  expect(shownRows(10, 200, 400, true)).toBe(5)
  expect(shownRows(10, 400, 400, true)).toBe(10)
  expect(shownRows(10, 0, 400, false)).toBe(10)
  // 140: the glint travels, then the line settles; off shows the settled line straight away.
  const first = rowText(sparkleRow('new best', 0, true))
  const mid = rowText(sparkleRow('new best', 750, true))
  const done = rowText(sparkleRow('new best', 1600, true))
  const off = rowText(sparkleRow('new best', 0, false))
  expect(mid).toContain('✦')
  expect(first).not.toBe(mid)
  expect(done).toBe('✦ new best ✦')
  expect(off).toBe(done)
  // 137/138: a chart at p=0 shows zero counts; the final frame shows the real ones.
  expect(text(histogram(ctx(demoData(NOW), { p: 0 })).rows)).toContain('0 turns')
  expect(text(histogram(ctx(demoData(NOW), { p: 1 })).rows)).toContain('60 turns')
})

test('every chart renders from demo data and from nothing, with unique commands', () => {
  const names = new Set<string>()

  for (const c of CHARTS) {
    expect(names.has(c.command)).toBe(false)
    names.add(c.command)
    const demo = c.run(ctx(demoData(NOW)))
    expect(demo.rows.length).toBeGreaterThan(1)
    expect(demo.title.length).toBeGreaterThan(0)
    const blank = c.run(ctx(emptyData(), { usage: { limits: [] } }))
    expect(blank.rows.length).toBeGreaterThan(0)

    for (const p of [0, 0.3, 1]) {
      expect(c.run(ctx(demoData(NOW), { p })).rows.length).toBeGreaterThan(0)
    }
  }
  expect(CHARTS.length).toBe(14)
})

// ------------------------------------------------------------------ engine

const PANE = {
  plugin: 'charts-more',
  component: 'Pane',
  requestId: 'charts-more-main',
  props: { title: 'More charts', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const BAND = {
  plugin: 'charts-more',
  surface: 'desktop',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} },
} as const

const done: any = { answer: '', durationMs: 42_000, isAborted: false, turnId: 't', reason: 'answer', usage: { model: 'claude-opus-4', input_tokens: 1, output_tokens: 1 } }

type World = { motion?: boolean; calm?: boolean; stored?: Record<string, unknown> }

const engine = (on: any, w: World = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const saved: Record<string, unknown> = { ...(w.stored ?? {}) }
  const registered: string[] = []
  const toasts: string[] = []
  const counts = { nows: 0 }
  const usage = { percent: 10, usd: 0, rateLimits: [] as { kind: string; percentUsed: number }[] }
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  on('command.register', (_: unknown, e: { name: string }) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_: unknown, e: { changed: unknown[] }) => ({ changed: e.changed }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000, percent: usage.percent }, rateLimits: usage.rateLimits, cost: { usd: usage.usd } },
  }))
  on('state.get', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'motion' && e.key === 'isOn' && w.motion === false) {
      return { value: { value: false, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'isCalm' && w.calm === true) {
      return { value: { value: true, version: 1 } }
    }

    return next(e)
  })
  on('state.set', (_: unknown, e: { key?: string; plugin?: string }, next: (e: unknown) => unknown) => {
    if (e.key === 'now' && e.plugin === 'charts-more') {
      counts.nows += 1
    }

    return next(e)
  })

  return { clock, saved, registered, toasts, counts, usage }
}

const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: 'user' } as any)
const data = (saved: Record<string, unknown>) => saved['cm.data'] as Data

test('session start registers every command once and /cm lists them all', async ($, on) => {
  const { registered } = engine(on)
  await start($)
  const expected = ['cm', ...CHARTS.map(c => c.command), 'cmdemo', 'cmreset']
  expect([...registered].sort()).toEqual([...new Set(expected)].sort())
  expect(registered.every(n => n.startsWith('cm'))).toBe(true)
  const help = (await run($, 'cm')) as { text: string }

  for (const name of new Set(expected)) {
    if (name !== 'cm') {
      expect(help.text).toContain(`/${name}`)
    }
  }
})

test('tool calls record durations, streaks and folders; prompts record counts only', async ($, on) => {
  const { clock, saved } = engine(on)
  on('tool.call', async (_: unknown, e: { tool: string }) => {
    await clock.sleep(e.tool === 'Bash' ? 250 : 10)

    return { result: {} }
  })
  await start($)
  const p = $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(300)
  await p
  const q = $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.ts', old_string: 'x', new_string: 'y' })
  await clock.advance(50)
  await q
  const d = data(saved)
  expect(d.tools.Bash).toEqual([250])
  expect(d.toolTotal.Bash).toBe(250)
  expect(d.dirs).toEqual({ src: 1 })
  expect(d.streak).toBe(2)
  expect([d.before, d.after]).toEqual(['x', 'y'])
  await $.prompt.submit({ text: 'please refactor the secret parser', wait: false, origin: { kind: 'composer' } })
  const w = data(saved)
  expect(w.words).toEqual({ refactor: 1, secret: 1, parser: 1 })
  expect(JSON.stringify(saved)).not.toContain('please refactor')
})

test('/cmwords off records nothing; clear and reset empty the data', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'cmwords', 'off')
  await $.prompt.submit({ text: 'deploy staging tonight', wait: false, origin: { kind: 'composer' } })
  expect(data(saved).words).toEqual({})
  await run($, 'cmwords', 'on')
  await $.prompt.submit({ text: 'deploy staging tonight', wait: false, origin: { kind: 'composer' } })
  expect(Object.keys(data(saved).words).sort()).toEqual(['deploy', 'staging', 'tonight'])
  await run($, 'cmwords', 'clear')
  expect(data(saved).words).toEqual({})
  await run($, 'cmnote', 'ship it #release')
  await run($, 'cmbudget', '12.5')
  expect(data(saved).notes.length).toBe(1)
  expect(data(saved).budget).toBe(12.5)
  await $.turn.complete(done)
  expect(data(saved).turns).toEqual([42])
  const r = (await run($, 'cmreset')) as { text: string }
  expect(r.text).toMatch(/Cleared/)
  expect(data(saved).notes).toEqual([])
  expect(data(saved).turns).toEqual([])
  expect(data(saved).budget).toBe(12.5)
})

test('turn.complete records length and the model cost delta', async ($, on) => {
  const { saved, usage } = engine(on)
  await start($)
  usage.usd = 0.5
  await $.turn.complete(done)
  usage.usd = 0.75
  await $.turn.complete(done)
  const d = data(saved)
  expect(d.turns).toEqual([42, 42])
  expect(d.cost.map(c => [c.m, c.d])).toEqual([['claude-opus-4', 0.5], ['claude-opus-4', 0.25]])
})

test('/cmdemo fills the pane with sample data without recording any, and the picker switches charts', async ($, on) => {
  const { saved } = engine(on, { motion: false })
  await start($)
  await run($, 'cmdemo')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /DEMO DATA/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Turn lengths$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^60 turns$/ })).toBeDefined()

  for (const c of CHARTS) {
    expect(await ui.find({ type: 'Button', text: new RegExp(`^${c.label}$`) })).toBeDefined()
  }
  await ui.press({ key: 'cm-tab-pie' })
  expect(await ui.find({ type: 'Text', text: /^Where time went$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /true pie is not possible/ })).toBeDefined()
  await ui.press({ key: 'cm-tab-slide' })
  expect(await ui.find({ type: 'Button', text: /◀ 10%/ })).toBeDefined()
  await ui.press({ key: 'cm-slide-right' })
  expect(data(saved).split).toBe(60)
  await ui.press({ key: 'cm-slide-left' })
  await ui.press({ key: 'cm-slide-left' })
  expect(data(saved).split).toBe(40)
  await ui.press({ key: 'cm-slide-reset' })
  expect(data(saved).split).toBe(50)
  await ui.unmount()
  // Nothing about the demo was recorded.
  const d = data(saved)
  expect(d.turns).toEqual([])
  await run($, 'cmdemo', 'off')
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: /DEMO DATA/ })).toBeUndefined()
  await again.unmount()
})

test('the pane draws on every surface and shows an honest empty chart', async ($, on) => {
  engine(on, { motion: false })
  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /No finished turns/ })).toBeDefined()
    await ui.unmount()
  }
})

test('motion on: card-stack shuffle and growth play from one ticker that stops itself', async ($, on) => {
  const { clock, counts } = engine(on)
  await start($)
  await run($, 'cmdemo')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The first frame is the start of the entrance: few rows, bars at zero.
  expect(await ui.find({ type: 'Text', text: /^0 turns$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Turn lengths$/ })).toBeDefined()
  await clock.advance(1000)
  expect(counts.nows).toBeGreaterThan(2)
  expect(await ui.find({ type: 'Text', text: /^60 turns$/ })).toBeDefined()
  const after = counts.nows
  await clock.advance(30_000)
  // Idle: the ticker is gone.
  expect(counts.nows).toBe(after)
  await ui.unmount()
})

test('switching tabs dims for about 200 ms then returns to normal', async ($, on) => {
  const { clock } = engine(on, { motion: true })
  await start($)
  await run($, 'cmdemo')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(1000)
  await ui.press({ key: 'cm-tab-pie' })
  const dimmed = await ui.find({ type: 'Text', text: /^Bash/ })
  expect(JSON.stringify(dimmed)).toContain('"dimColor":true')
  await clock.advance(1000)
  const normal = await ui.find({ type: 'Text', text: /^Bash/ })
  expect(JSON.stringify(normal)).not.toContain('"dimColor":true')
  await ui.unmount()
})

test('motion off: final frames at once and the ticker never starts', async ($, on) => {
  const { clock, counts } = engine(on, { motion: false })
  await start($)
  await run($, 'cmdemo')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^60 turns$/ })).toBeDefined()
  await ui.press({ key: 'cm-tab-pie' })
  await clock.advance(5000)
  expect(counts.nows).toBe(0)
  await ui.unmount()
})

test('calm settings: static final frames, no ticker, no toast on a new best', async ($, on) => {
  const { clock, counts, toasts } = engine(on, { calm: true })
  on('tool.call', () => ({ result: {} }))
  await start($)
  await run($, 'cmdemo')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^60 turns$/ })).toBeDefined()
  await clock.advance(5000)
  expect(counts.nows).toBe(0)
  await ui.unmount()
  await run($, 'cmdemo', 'off')

  for (let i = 0; i < 12; i++) {
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
  }
  expect(toasts).toEqual([])
})

test('140 a new best streak sparkles once from 10 in a row, with one toast per 3 minutes', async ($, on) => {
  const { clock, toasts, saved } = engine(on)
  const fail = { on: false }
  on('tool.call', () => (fail.on ? { result: {}, isError: true } : { result: {} }))
  await start($)

  for (let i = 0; i < 12; i++) {
    await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
  }
  expect(data(saved).best).toBe(12)
  expect(toasts).toEqual(['New best streak: 10 successful tool calls in a row'])
  await clock.advance(200_000)
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
  expect(toasts.length).toBe(2)
  await run($, 'cmdemo', 'off')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /new best streak: 13 in a row/ })).toBeDefined()
  await ui.unmount()
  // A failure resets the streak but not the best.
  fail.on = true
  await $.tool.call({ tool: 'Bash', command: 'false' })
  expect([data(saved).streak, data(saved).best]).toEqual([0, 13])
})

test('57 the ring row shows only above 60% context, keeps other rows, and /cmring off hides it', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>other mod row</Text>
  })
  await start($)
  const low = await $.ui.mount(BAND)
  expect(await low.find({ type: 'Text', text: /context/ })).toBeUndefined()
  expect(await low.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  await low.unmount()
  await $.session.measure({ context: { window: 1000, percent: 45 }, rateLimits: [], changed: ['context'] } as any)
  const mid = await $.ui.mount(BAND)
  expect(await mid.find({ type: 'Text', text: /context/ })).toBeUndefined()
  await mid.unmount()
  await $.session.measure({ context: { window: 1000, percent: 72 }, rateLimits: [], changed: ['context'] } as any)
  const high = await $.ui.mount(BAND)
  expect(await high.find({ type: 'Text', text: /context 72%/ })).toBeDefined()
  expect(await high.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  await high.unmount()
  await run($, 'cmring', 'off')
  const hidden = await $.ui.mount(BAND)
  expect(await hidden.find({ type: 'Text', text: /context/ })).toBeUndefined()
  expect(await hidden.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  await hidden.unmount()
})

test('live charts read the session usage: thermometers and the fuel gauge', async ($, on) => {
  const { usage } = engine(on, { motion: false })
  usage.rateLimits = [{ kind: 'five_hour', percentUsed: 64 }]
  usage.usd = 4
  await start($)
  await run($, 'cmbudget', '10')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'cm-tab-therm' })
  expect(await ui.find({ type: 'Text', text: /64%/ })).toBeDefined()
  await ui.press({ key: 'cm-tab-fuel' })
  expect(await ui.find({ type: 'Text', text: /\$6\.00 left/ })).toBeDefined()
  await ui.unmount()
})

test('stored data loads at session start and a bad stored value is repaired', async ($, on) => {
  const { saved } = engine(on, { motion: false, stored: { 'cm.data': { turns: [5, 9], split: 'x', tools: 4 } } })
  await start($)
  const d = data(saved)
  expect(d.turns).toEqual([5, 9])
  expect(d.split).toBe(50)
  expect(d.tools).toEqual({})
  expect(d.cwd).toBe('/proj')
})
