import { expect, mock, test } from 'claude-code/testing'

import type { Data } from '../types'
import { graphSvg, timelineSvg, tipsSvg, treemapSvg } from './draw'
import {
  CAP,
  COLUMNS,
  FEATURE_DEFAULTS,
  GROUPS,
  VIEWS,
  addCard,
  addGoal,
  addLib,
  addNotice,
  addSpend,
  bar,
  beginTurn,
  budgetCheck,
  budgetStatus,
  calendar,
  cmdMatches,
  compare,
  dayKey,
  digestText,
  dueGoals,
  emptyData,
  emptyUi,
  exportPrompts,
  feedItems,
  finishPomo,
  focusScore,
  forecast,
  graph,
  importPrompts,
  moveCard,
  paged,
  parseGoal,
  parsePromptAdd,
  parseUsd,
  presentFigures,
  printLines,
  recordCall,
  recordPrompt,
  recordTurn,
  replayState,
  rollBudget,
  sanitize,
  sanitizeUi,
  setBudget,
  sortEvents,
  spark,
  startPomo,
  startSession,
  tableEvents,
  tagStats,
  timelineBands,
  tips,
  toggleCol,
  treemap,
  modelStats,
} from './pure'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const call = (d: Data, over: Partial<{ t: number; tool: string; file: string; ms: number; ok: boolean }> = {}) => recordCall(d, { t: NOW, tool: 'Read', ms: 10, ok: true, ...over })
const seeded = (): Data => {
  let d = startSession(emptyData(), NOW - 2 * HOUR)

  for (let i = 0; i < 6; i++) {
    d = call(d, { t: NOW - i * 5 * 60_000, tool: 'Edit', file: `/proj/src/a${i % 2}.ts`, ms: 20 + i })
  }
  d = call(d, { t: NOW - 60_000, tool: 'Read', file: '/proj/src/a0.ts' })
  d = call(d, { t: NOW - 30_000, tool: 'Bash', ms: 400, ok: false })
  d = recordPrompt(d, { t: NOW - 90_000, len: 42, isCommand: false })

  return d
}

// ------------------------------------------------------------------ pure

test('FEATURE_DEFAULTS has every switch, and nothing proactive is on', () => {
  for (const id of ['toasts', 'sounds', 'status', 'band']) {
    expect(FEATURE_DEFAULTS[id]).toBeUndefined()
  }

  for (const id of ['budget-warn-80', 'budget-warn-100', 'goal-toasts', 'pomo-toast', 'digest-morning', 'live-timer', 'prompt-excerpts']) {
    expect(FEATURE_DEFAULTS[id]).toBe(false)
  }
  expect(Object.keys(FEATURE_DEFAULTS).length).toBe(16)
})

test('sanitize repairs a broken stored value and caps lists', () => {
  expect(sanitize(undefined)).toEqual(emptyData())
  expect(sanitize('x')).toEqual(emptyData())
  const bad = sanitize({
    events: [{ t: 1, k: 'tool', n: 'Read' }, { t: 'x', k: 'tool' }, { t: 2, k: 'nope', n: 'z' }, 5, null],
    days: { '2026-01-01': { tools: 'x', usd: -4 }, bad: { tools: 3 } },
    files: { '/a': 3, '/b': -1, '/c': 'x' },
    budget: { perDay: 'x', carry: -3, asOf: 'nope' },
    cards: [{ id: 1, text: 'ok', col: 'todo' }, { id: 2, text: 'x', col: 'weird' }],
    lib: [{ id: 1, title: 't', text: 'x', tags: ['ok', 'Bad Tag', 'ok'] }],
    pomo: { kind: 'weird', startedAt: 1, endsAt: 2 },
    cmds: 'nope',
  })
  expect(bad.events.length).toBe(1)
  expect(Object.keys(bad.days)).toEqual(['2026-01-01'])
  expect(bad.days['2026-01-01']).toEqual({ tools: 0, edits: 0, errors: 0, prompts: 0, usd: 0, pomos: 0 })
  expect(bad.files).toEqual({ '/a': 3 })
  expect(bad.budget).toEqual({ perDay: 0, carry: 0, asOf: '', w80: '', w100: '' })
  expect(bad.cards.length).toBe(1)
  expect(bad.lib[0]!.tags).toEqual(['ok'])
  expect(bad.pomo).toBeNull()
  expect(bad.cmds.length).toBeGreaterThan(3)
  const many = sanitize({ events: Array.from({ length: 500 }, (_, i) => ({ t: i, k: 'tool', n: 'R' })) })
  expect(many.events.length).toBe(CAP.events)
  const ui = sanitizeUi({ view: 'nope', page: 99999, win: 7, cols: ['zzz'], calOff: 5, dir: 'x' })
  expect(ui.view).toBe('overview')
  expect(ui.page).toBe(1000)
  expect(ui.win).toBe(60)
  expect(ui.cols).toEqual([])
  expect(ui.calOff).toBe(0)
})

test('recordCall counts kinds, files and edges, and every list stays bounded', () => {
  const d = seeded()
  expect(d.events.map(e => e.k)).toEqual(['edit', 'edit', 'edit', 'edit', 'edit', 'edit', 'tool', 'error', 'prompt'])
  expect(d.days[dayKey(NOW)]).toMatchObject({ tools: 8, edits: 6, errors: 1, prompts: 1 })
  expect(d.sessions[0]).toMatchObject({ tools: 8, edits: 6, errors: 1, prompts: 1 })
  expect(d.files['/proj/src/a0.ts']).toBe(3)
  expect(d.edges['Read\t/proj/src/a0.ts']).toBe(1)
  expect(d.turnTools).toBe(8)
  expect(d.turnErrs).toBe(1)
  let big = emptyData()

  for (let i = 0; i < CAP.events + 40; i++) {
    big = call(big, { t: NOW + i, file: `/p/f${i}.ts`, tool: 'Edit' })
  }
  expect(big.events.length).toBe(CAP.events)
  expect(Object.keys(big.files).length).toBe(CAP.files)
  expect(Object.keys(big.edges).length).toBeLessThanOrEqual(CAP.edges)
  let days = emptyData()

  for (let i = 0; i < 120; i++) {
    days = call(days, { t: NOW + i * 86_400_000 })
  }
  expect(Object.keys(days.days).length).toBe(CAP.days)
})

test('spend: only growth is added, samples are throttled, a new session does not double count', () => {
  let d = startSession(emptyData(), NOW)
  d = addSpend(d, 1, NOW, false)
  expect(d.total).toBe(0)
  d = addSpend(d, 1.5, NOW + 1000, false)
  expect(d.total).toBe(0.5)
  expect(d.days[dayKey(NOW)]!.usd).toBe(0.5)
  expect(d.samples.length).toBe(1)
  d = addSpend(d, 1.7, NOW + 2000, false)
  expect(d.samples.length).toBe(1)
  d = addSpend(d, 1.9, NOW + 3000, true)
  expect(d.samples.length).toBe(2)
  expect(d.total).toBe(0.9)
  d = addSpend(d, 0.2, NOW + 4000, false)
  expect(d.total).toBe(0.9)
  d = startSession(d, NOW + 5000)
  d = addSpend(d, 0.4, NOW + 6000, false)
  expect(d.total).toBe(0.9)
  expect(addSpend(d, undefined, NOW, false)).toBe(d)
})

test('253 budget rollover: unspent amounts roll to the next day up to twice the daily amount', () => {
  const days = { '2026-03-01': { tools: 0, edits: 0, errors: 0, prompts: 0, usd: 4, pomos: 0 } }
  const b = { perDay: 10, carry: 0, asOf: '2026-03-01', w80: '', w100: '' }
  expect(rollBudget(b, days, '2026-03-01')).toEqual(b)
  expect(rollBudget(b, days, '2026-03-02').carry).toBe(6)
  // two idle days: 6 + 10 = 16, capped at 20 only later
  expect(rollBudget(b, days, '2026-03-03').carry).toBe(16)
  expect(rollBudget(b, days, '2026-03-09').carry).toBe(20)
  // overspend: the allowance never goes below zero
  const over = { '2026-03-01': { ...days['2026-03-01'], usd: 50 } }
  expect(rollBudget(b, over, '2026-03-02').carry).toBe(0)
  expect(rollBudget({ ...b, perDay: 0 }, days, '2026-03-02').carry).toBe(0)
  expect(rollBudget({ ...b, asOf: '2027-01-01' }, days, '2026-03-02').asOf).toBe('2026-03-02')
  expect(parseUsd('$12.5')).toBe(12.5)
  expect(parseUsd('abc')).toBeUndefined()
  expect(parseUsd('1.234')).toBeUndefined()
})

test('253 budget check fires 80 once, then 100 once, per day', () => {
  let d = setBudget(emptyData(), 10, NOW)
  d = { ...d, days: { [dayKey(NOW)]: { tools: 0, edits: 0, errors: 0, prompts: 0, usd: 7, pomos: 0 } } }
  let r = budgetCheck(d, NOW)
  expect(r.fire).toEqual([])
  d = { ...d, days: { [dayKey(NOW)]: { ...d.days[dayKey(NOW)]!, usd: 8.5 } } }
  r = budgetCheck(d, NOW)
  expect(r.fire).toEqual([80])
  expect(budgetCheck(r.d, NOW).fire).toEqual([])
  d = { ...r.d, days: { [dayKey(NOW)]: { ...d.days[dayKey(NOW)]!, usd: 12 } } }
  r = budgetCheck(d, NOW)
  expect(r.fire).toEqual([100])
  expect(budgetCheck(r.d, NOW).fire).toEqual([])
  expect(budgetStatus(r.d, NOW).left).toBe(0)
  expect(budgetCheck(emptyData(), NOW).fire).toEqual([])
  expect(setBudget(d, 0, NOW).budget.perDay).toBe(0)
})

test('252 forecast is a labelled linear estimate and needs samples first', () => {
  expect(forecast(emptyData(), NOW).ok).toBe(false)
  let d = emptyData()
  d = { ...d, samples: [{ t: NOW - HOUR, tot: 1 }, { t: NOW - 60_000, tot: 2 }], total: 3 }
  const f = forecast(d, NOW)
  expect(f.ok).toBe(true)
  expect(Math.abs(f.rate - 2)).toBeLessThan(0.2)
  expect(f.projected).toBeGreaterThanOrEqual(f.spent)
  expect(f.hoursLeft).toBeLessThanOrEqual(8)
  expect(forecast({ ...d, samples: [{ t: NOW - 60_000, tot: 2 }] }, NOW).ok).toBe(false)
})

test('260 focus score: share of file calls on the busiest directory in the last hour', () => {
  let d = emptyData()
  d = call(d, { t: NOW - 10, file: '/p/src/a.ts' })
  d = call(d, { t: NOW - 20, file: '/p/src/b.ts' })
  d = call(d, { t: NOW - 30, file: '/p/test/c.ts' })
  d = call(d, { t: NOW - 40, tool: 'Bash' })
  d = call(d, { t: NOW - 2 * HOUR, file: '/p/old/x.ts' })
  expect(focusScore(d, NOW)).toEqual({ pct: 67, dir: '/p/src', n: 3 })
  expect(focusScore(emptyData(), NOW)).toEqual({ pct: 0, dir: '', n: 0 })
})

test('240 243 244: feed filters, table sorts and the column picker keeps one column', () => {
  const d = seeded()
  expect(feedItems(d, 'all')[0]!.k).toBe('prompt')
  expect(feedItems(d, 'error').length).toBe(1)
  expect(feedItems(d, 'edit').length).toBe(6)
  const rows = tableEvents(d)
  expect(rows.length).toBe(8)
  expect(sortEvents(rows, 'ms', 'desc')[0]!.n).toBe('Bash')
  expect(sortEvents(rows, 'ms', 'asc')[0]!.ms).toBe(10)
  expect(sortEvents(rows, 'tool', 'asc')[0]!.n).toBe('Bash')
  expect(sortEvents(rows, 'time', 'desc')[0]!.t).toBe(NOW)
  expect(sortEvents(rows, 'ok', 'asc')[0]!.ok).toBe(false)
  expect(toggleCol(['time', 'tool'], 'ms')).toEqual(['time', 'tool', 'ms'])
  expect(toggleCol(['time', 'tool'], 'tool')).toEqual(['time'])
  expect(toggleCol(['time'], 'time')).toEqual(['time'])
  expect(COLUMNS.length).toBe(5)
  const p = paged([1, 2, 3, 4, 5], 9, 2)
  expect(p).toEqual({ rows: [5], page: 2, pages: 3 })
  expect(paged([], 0, 2).pages).toBe(1)
})

test('245 calendar month grid with daily counts', () => {
  const d = seeded()
  const cal = calendar(d, NOW, 0)
  expect(cal.weeks.every(w => w.length === 7)).toBe(true)
  const cells = cal.weeks.flat().filter(c => c !== null)
  expect(cells.length).toBeGreaterThanOrEqual(28)
  expect(cells.find(c => c!.key === dayKey(NOW))!.n).toBe(8)
  expect(cal.max).toBe(8)
  expect(calendar(d, NOW, -1).title).not.toBe(cal.title)
})

test('248 compare: today vs yesterday, and this session vs the previous one', () => {
  let d = startSession(emptyData(), NOW - 3 * HOUR)
  d = call(d, { t: NOW - 86_400_000 })
  d = startSession(d, NOW - HOUR)
  d = call(d, { t: NOW })
  d = call(d, { t: NOW })
  const day = compare(d, 'day', NOW)
  expect(day.rows[0]).toMatchObject({ label: 'Tool calls', a: 1, b: 2 })
  const ses = compare(d, 'session', NOW)
  expect(ses.rows[0]).toMatchObject({ a: 1, b: 2 })
  expect(compare(emptyData(), 'session', NOW).aLabel).toContain('none yet')
  expect(bar(0.5, 10)).toBe('█████░░░░░')
})

test('251 replay steps through events and clamps', () => {
  const d = seeded()
  expect(replayState(d, -1).at).toBe(d.events.length - 1)
  expect(replayState(d, 0).before).toEqual([])
  const mid = replayState(d, 3)
  expect(mid.at).toBe(3)
  expect(mid.so.edit).toBe(4)
  expect(mid.before.length).toBe(3)
  expect(replayState(d, 999).at).toBe(d.events.length - 1)
  expect(replayState(emptyData(), 0)).toMatchObject({ at: -1, total: 0, ev: undefined })
})

test('241 246 247: timeline buckets, treemap layout and the graph', () => {
  const d = seeded()
  const bands = timelineBands(d, NOW, 60)
  expect(bands.length).toBe(4)
  expect(bands[0]!.buckets.length).toBe(60)
  expect(bands[1]!.buckets.reduce((a, b) => a + b, 0)).toBe(6)
  expect(bands[2]!.buckets.reduce((a, b) => a + b, 0)).toBe(1)
  expect(timelineBands(d, NOW, 15)[1]!.buckets.reduce((a, b) => a + b, 0)).toBeLessThan(6)
  const rects = treemap({ '/p/a/x.ts': 6, '/p/a/y.ts': 2, '/p/b/z.ts': 4 }, 560, 280)
  const dirs = rects.filter(r => r.kind === 'dir')
  expect(dirs.length).toBe(2)
  expect(Math.abs(dirs.reduce((s, r) => s + r.w, 0) - 560)).toBeLessThan(0.01)
  expect(dirs[0]!.count).toBe(8)
  expect(rects.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= 560.001 && r.y + r.h <= 280.001)).toBe(true)
  expect(treemap({}, 560, 280)).toEqual([])
  const g = graph(d.edges)
  expect(g.tools.map(t => t.id)).toContain('Edit')
  expect(g.links.length).toBeGreaterThan(0)
  expect(g.files.length).toBeLessThanOrEqual(8)
  expect(graph({}).links).toEqual([])
})

test('the vector charts are well-formed, escaped, tooltips carry the values', () => {
  const d = seeded()
  const svgs = [
    tipsSvg(tips(d, NOW), 'suggestion'),
    timelineSvg(timelineBands(d, NOW, 60), 60, 'claude'),
    treemapSvg(treemap(d.files, 560, 280), 560, 280, 'success'),
    graphSvg(graph(d.edges), 'warning'),
  ]

  for (const s of svgs) {
    expect(s.startsWith('<svg')).toBe(true)
    expect(s.endsWith('</svg>')).toBe(true)
    expect(s).toContain('prefers-color-scheme:dark')
    expect(s).toContain('<title>')
    expect(s.length).toBeLessThan(131072)
    expect(s).not.toContain('<script')
  }
  expect(svgs[0]).toContain('8 calls')
  const evil = treemapSvg(treemap({ '/p/<b>"&.ts': 3 }, 560, 280), 560, 280, 'claude')
  expect(evil).not.toContain('<b>')
  expect(evil).toContain('&lt;b&gt;')
})

test('254 prompt library: parse, tags, duplicates, caps', () => {
  expect(parsePromptAdd('Review :: Please review this diff #review #ship-it')).toEqual({ title: 'Review', text: 'Please review this diff', tags: ['review', 'ship-it'] })
  expect(parsePromptAdd('No tags :: just text')).toEqual({ title: 'No tags', text: 'just text', tags: [] })
  expect('error' in parsePromptAdd('no separator here')).toBe(true)
  expect('error' in parsePromptAdd('t :: ' + 'x'.repeat(2001))).toBe(true)
  expect('error' in parsePromptAdd('t :: a #1 #2 #3 #4 #5 #6 #7')).toBe(true)
  let d = emptyData()
  const r = addLib(d, { title: 'A', text: 'one', tags: [] })
  expect('error' in r).toBe(false)
  d = r as Data
  expect('error' in addLib(d, { title: 'A', text: 'other', tags: [] })).toBe(true)

  for (let i = 0; i < CAP.lib; i++) {
    const n = addLib(d, { title: `T${i}`, text: `x${i}`, tags: [] })
    d = 'error' in n ? d : n
  }
  expect(d.lib.length).toBe(CAP.lib)
  expect('error' in addLib(d, { title: 'Z', text: 'z', tags: [] })).toBe(true)
})

test('254 strict import/export: a good round trip and every kind of bad input refused', () => {
  let d = emptyData()
  d = addLib(d, { title: 'Review', text: 'Review this.\nBe brief.', tags: ['review'] }) as Data
  d = addLib(d, { title: 'Plain', text: 'Hello', tags: [] }) as Data
  const json = exportPrompts(d)
  expect(JSON.parse(json)).toEqual({ format: 'uj-prompts', version: 1, prompts: [{ title: 'Review', text: 'Review this.\nBe brief.', tags: ['review'] }, { title: 'Plain', text: 'Hello', tags: [] }] })
  const back = importPrompts(emptyData(), json)
  expect(back.ok).toBe(true)

  if (back.ok) {
    expect(back.added).toBe(2)
    expect(back.data.lib.map(l => l.title)).toEqual(['Review', 'Plain'])
    const again = importPrompts(back.data, json)
    expect(again.ok && again.added).toBe(0)
    expect(again.ok && again.skipped).toBe(2)
  }
  const bad = (v: unknown) => importPrompts(emptyData(), typeof v === 'string' ? v : JSON.stringify(v))
  const p = (o: object) => ({ format: 'uj-prompts', version: 1, prompts: [{ title: 't', text: 'x', tags: [], ...o }] })
  expect(bad('').ok).toBe(false)
  expect(bad('{not json').ok).toBe(false)
  expect(bad('[]').ok).toBe(false)
  expect(bad('null').ok).toBe(false)
  expect(bad({ format: 'uj-prompts', version: 1 }).ok).toBe(false)
  expect(bad({ format: 'uj-prompts', version: 1, prompts: [], extra: 1 }).ok).toBe(false)
  expect(bad({ format: 'other', version: 1, prompts: [] }).ok).toBe(false)
  expect(bad({ format: 'uj-prompts', version: 2, prompts: [] }).ok).toBe(false)
  expect(bad({ format: 'uj-prompts', version: 1, prompts: 'x' }).ok).toBe(false)
  expect(bad(p({ extra: 1 })).ok).toBe(false)
  expect(bad(p({ title: '' })).ok).toBe(false)
  expect(bad(p({ title: ' padded ' })).ok).toBe(false)
  expect(bad(p({ title: 'x'.repeat(61) })).ok).toBe(false)
  expect(bad(p({ title: 5 })).ok).toBe(false)
  expect(bad(p({ text: '' })).ok).toBe(false)
  expect(bad(p({ text: 'x'.repeat(2001) })).ok).toBe(false)
  expect(bad(p({ text: 'bad\u0001char' })).ok).toBe(false)
  expect(bad(p({ tags: 'x' })).ok).toBe(false)
  expect(bad(p({ tags: ['Bad Tag'] })).ok).toBe(false)
  expect(bad(p({ tags: ['a', 'a'] })).ok).toBe(false)
  expect(bad(p({ tags: ['1', '2', '3', '4', '5', '6', '7'] })).ok).toBe(false)
  expect(bad({ format: 'uj-prompts', version: 1, prompts: [null] }).ok).toBe(false)
  expect(bad({ format: 'uj-prompts', version: 1, prompts: Array.from({ length: 51 }, (_, i) => ({ title: `t${i}`, text: 'x', tags: [] })) }).ok).toBe(false)
  expect(bad('x'.repeat(130_000)).ok).toBe(false)
  // __proto__ as a key is an unknown key, not a pollution
  expect(bad('{"format":"uj-prompts","version":1,"prompts":[],"__proto__":{"x":1}}').ok).toBe(false)
  expect(({} as Record<string, unknown>).x).toBeUndefined()
  // one bad prompt among good ones imports nothing
  const mixed = importPrompts(emptyData(), JSON.stringify({ format: 'uj-prompts', version: 1, prompts: [{ title: 'ok', text: 'x', tags: [] }, { title: 'bad', text: '', tags: [] }] }))
  expect(mixed.ok).toBe(false)
  // would exceed the cap: refused, nothing imported
  let full = emptyData()

  for (let i = 0; i < 50; i++) {
    full = addLib(full, { title: `T${i}`, text: `x${i}`, tags: [] }) as Data
  }
  const over = importPrompts(full, JSON.stringify({ format: 'uj-prompts', version: 1, prompts: [{ title: 'new', text: 'n', tags: [] }] }))
  expect(over.ok).toBe(false)
})

test('255 256: prompt effectiveness per tag and the model log', () => {
  let d = emptyData()
  d = addLib(d, { title: 'R', text: 'review it', tags: ['review', 'qa'] }) as Data
  d = { ...d, total: 1 }
  d = beginTurn(d, 'something else')
  expect(d.pending).toBeNull()
  d = beginTurn(d, 'review it')
  expect(d.pending).toEqual({ tags: ['review', 'qa'] })
  d = call(d, { tool: 'Bash', ok: false })
  d = call(d, { tool: 'Read' })
  d = { ...d, total: 1.25 }
  d = recordTurn(d, { t: NOW, model: 'claude-x', ms: 4000 })
  expect(d.pending).toBeNull()
  expect(d.pstats.length).toBe(1)
  expect(d.turns[0]).toMatchObject({ model: 'claude-x', ms: 4000, usd: 0.25, tools: 2, errs: 1 })
  d = recordTurn(d, { t: NOW + 1, model: undefined, ms: 1000 })
  expect(d.pstats.length).toBe(1)
  expect(d.turns[1]!.model).toBe('(not reported)')
  const ts = tagStats(d)
  expect(ts.map(t => t.tag).sort()).toEqual(['qa', 'review'])
  expect(ts[0]).toMatchObject({ n: 1, avgMs: 4000, avgTools: 2, avgErrs: 1 })
  const ms = modelStats(d)
  expect(ms.map(m => m.model).sort()).toEqual(['(not reported)', 'claude-x'])
})

test('258 259 242: goals, pomodoro and kanban', () => {
  const noon = new Date(2026, 5, 10, 12, 0).getTime()
  const g = parseGoal('2026-06-11 18:30 ship it', noon)
  expect(g).toEqual({ due: new Date(2026, 5, 11, 18, 30).getTime(), text: 'ship it' })
  expect(parseGoal('2026-06-11 ship', noon)).toEqual({ due: new Date(2026, 5, 11, 9, 0).getTime(), text: 'ship' })
  expect(parseGoal('+2h write', noon)).toEqual({ due: noon + 2 * HOUR, text: 'write' })
  expect('error' in parseGoal('2026-02-31 x', noon)).toBe(true)
  expect('error' in parseGoal('soon x', noon)).toBe(true)
  expect('error' in parseGoal('2026-06-11 25:00 x', noon)).toBe(true)
  expect('error' in parseGoal('2090-01-01 x', noon)).toBe(true)
  let d = addGoal(emptyData(), noon + 1000, 'a')!
  d = addGoal(d, noon + 5000, 'b')!
  expect(dueGoals(d, noon).length).toBe(0)
  expect(dueGoals(d, noon + 2000).map(x => x.text)).toEqual(['a'])
  let c = addCard(emptyData(), '  first   card ')!
  expect(c.cards[0]!.text).toBe('first card')
  expect(addCard(c, '   ')).toBeUndefined()
  c = moveCard(c, 1, 1)
  expect(c.cards[0]!.col).toBe('doing')
  c = moveCard(moveCard(c, 1, 1), 1, 1)
  expect(c.cards[0]!.col).toBe('done')
  c = moveCard(c, 1, -1)
  expect(c.cards[0]!.col).toBe('doing')
  c = startPomo(c, { kind: 'work', minutes: 25, card: 1, now: NOW })
  expect(c.pomo).toMatchObject({ endsAt: NOW + 25 * 60_000, card: 1, task: 'first card' })
  c = finishPomo(c, NOW + 25 * 60_000)
  expect(c.pomo).toBeNull()
  expect(c.cards[0]!.pomos).toBe(1)
  expect(c.days[dayKey(NOW + 25 * 60_000)]!.pomos).toBe(1)
  expect(finishPomo(startPomo(c, { kind: 'break', minutes: 5, card: 0, now: NOW }), NOW).days[dayKey(NOW)]!.pomos).toBe(1)
  expect(startPomo(c, { kind: 'work', minutes: 999, card: 0, now: NOW }).pomo!.endsAt).toBe(NOW + 120 * 60_000)
})

test('257 digest, 249 print and 250 presentation (masked) from the same data', () => {
  const d = addNotice(seeded(), 'budget', 'x', NOW)
  const day = digestText(d, NOW, 'daily')
  expect(day).toContain('Daily digest')
  expect(day).toContain('Tool calls 8')
  expect(day).toContain('estimate')
  const week = digestText(d, NOW, 'weekly')
  expect(week).toContain('Weekly digest')
  expect(week).toContain('per day')
  expect(digestText(emptyData(), NOW, 'daily')).toContain('Tool calls 0')
  const lines = printLines(d, NOW, 5)
  expect(lines.length).toBe(2 + 5)
  expect(lines.join('\n')).not.toMatch(/[█▁░]/)
  expect(printLines(emptyData(), NOW, 5).join('\n')).toContain('Nothing recorded')
  const secret = call(emptyData(), { t: NOW, tool: 'Edit', file: '/Users/secret/diary/passwords.txt' })
  const figs = presentFigures(secret, NOW)
  expect(JSON.stringify(figs)).not.toMatch(/secret|passwords|Edit(?!s)|diary|\.txt/)
  expect(figs.map(f => f.label)).toContain('Tool calls today')
  expect(spark([0, 1, 4, 8])).toHaveLength(4)
})

test('238 command filter and 236 tip data', () => {
  const cmds = ['/ujfeed', 'Run the tests', '/ujkanban']
  expect(cmdMatches(cmds, '', 5)).toEqual(cmds)
  expect(cmdMatches(cmds, 'UJ', 5)).toEqual(['/ujfeed', '/ujkanban'])
  expect(cmdMatches(cmds, 'run tests', 5)).toEqual(['Run the tests'])
  expect(cmdMatches(cmds, 'zzz', 5)).toEqual([])
  expect(cmdMatches(cmds, 'uj', 1)).toEqual(['/ujfeed'])
  const t = tips(seeded(), NOW)
  expect(t.length).toBe(6)
  expect(t[0]!.series.length).toBe(14)
  expect(t[0]!.series[13]).toBe(8)
  expect(t[0]!.value).toBe('8')
})

// ------------------------------------------------------------------ engine

const PANE = {
  plugin: 'ui-two',
  component: 'Pane',
  requestId: 'ui-two-main',
  props: { title: 'UI two', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type World = { now?: number; motion?: boolean; calm?: boolean; stored?: Record<string, unknown>; features?: Record<string, boolean> }

const engine = (on: any, w: World = {}) => {
  const clock = mock.clock(on, { now: w.now ?? NOW })
  const saved: Record<string, unknown> = { ...(w.stored ?? {}) }
  const registered: string[] = []
  const toasts: string[] = []
  const fills: { text: string; mode: string }[] = []
  const counts = { nows: 0 }
  const usage = { usd: 0 }
  const world = { ...w, features: { ...(w.features ?? {}) } }
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
  on('prompt.fill', (_: unknown, e: { text: string; mode: string }) => {
    fills.push({ text: e.text, mode: e.mode })

    return { isFilled: true }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000, percent: 10 }, rateLimits: [], cost: { usd: usage.usd } } }))
  on('state.get', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'motion' && e.key === 'isOn' && w.motion === false) {
      return { value: { value: false, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'isCalm' && w.calm === true) {
      return { value: { value: true, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'features') {
      return { value: { value: { shape: 'features-1', value: world.features }, version: 1 } }
    }

    return next(e)
  })
  on('state.set', (_: unknown, e: { key?: string; plugin?: string }, next: (e: unknown) => unknown) => {
    if (e.key === 'now' && e.plugin === 'ui-two') {
      counts.nows += 1
    }

    return next(e)
  })

  return { clock, saved, registered, toasts, fills, counts, usage, features: world.features }
}

const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: 'user' } as any)
const data = (saved: Record<string, unknown>) => sanitize(saved['uj.data'])
const done: any = { answer: '', durationMs: 42_000, isAborted: false, turnId: 't', reason: 'answer', usage: { model: 'claude-opus-4', input_tokens: 1, output_tokens: 1 } }
const say = async (r: unknown) => (r as { text: string }).text

test('session start registers every command with the uj prefix, and /uj lists each one', async ($, on) => {
  const { registered } = engine(on)
  await start($)
  expect(registered.length).toBe(18)
  expect(registered.every(n => n === 'uj' || n.startsWith('uj'))).toBe(true)
  const help = await say(await run($, 'uj'))

  for (const n of registered) {
    expect(help).toContain(`/${n}`)
  }
  expect(help).toContain('/cfg feature ui-two')
})

test('tool calls, errors, files and prompts are recorded; a switch stops recording', async ($, on) => {
  const { saved, features } = engine(on)
  on('tool.call', (_: unknown, e: { tool: string }) => (e.tool === 'Bash' ? { result: {}, isError: true } : { result: {} }))
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.prompt.submit({ text: 'please fix the secret thing', wait: false, origin: { kind: 'composer' } })
  const d = data(saved)
  expect(d.events.map(e => `${e.k}:${e.n}`)).toEqual(['tool:Read', 'edit:Edit', 'error:Bash', 'prompt:prompt'])
  expect(d.events[2]!.ms).toBeGreaterThanOrEqual(0)
  expect(d.files['/proj/src/a.ts']).toBe(1)
  expect(d.days[dayKey(NOW)]).toMatchObject({ tools: 3, edits: 1, errors: 1, prompts: 1 })
  expect(JSON.stringify(saved['uj.data'])).not.toContain('secret thing')
  features['record-activity'] = false
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/b.ts' })
  expect(data(saved).events.length).toBe(4)
  features['record-prompts'] = false
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  expect(data(saved).events.length).toBe(4)
})

test('prompt excerpts are kept only behind their switch', async ($, on) => {
  const { saved, features } = engine(on)
  await start($)
  await $.prompt.submit({ text: 'plain words here', wait: false, origin: { kind: 'composer' } })
  expect(data(saved).events[0]!.x).toBeUndefined()
  features['prompt-excerpts'] = true
  await $.prompt.submit({ text: 'plain words here', wait: false, origin: { kind: 'composer' } })
  expect(data(saved).events[1]!.x).toBe('plain words here')
})

test('256 a finished turn records model, duration and cost delta; 255 a library prompt is measured', async ($, on) => {
  const { saved, usage } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await run($, 'ujprompt', 'add Review :: review the diff #review')
  await run($, 'ujprompt', 'use 1')
  await $.prompt.submit({ text: 'review the diff', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
  usage.usd = 0.4
  await $.turn.complete(done)
  const d = data(saved)
  expect(d.turns[0]).toMatchObject({ model: 'claude-opus-4', ms: 42_000, tools: 1 })
  expect(d.pstats.length).toBe(1)
  expect(d.pstats[0]!.tags).toEqual(['review'])
  // a different prompt is not measured
  await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ ...done, usage: undefined })
  expect(data(saved).pstats.length).toBe(1)
  expect(data(saved).turns[1]!.model).toBe('(not reported)')
  // a sub-agent's turn is not recorded
  await $.turn.complete({ ...done, agentId: 'a1' })
  expect(data(saved).turns.length).toBe(2)
})

test('253 the budget guard rolls over, logs notices, toasts only behind switches, and never blocks', async ($, on) => {
  const { saved, usage, toasts, features, clock } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  expect(await say(await run($, 'ujbudget'))).toContain('No budget')
  expect(await say(await run($, 'ujbudget', 'abc'))).toContain('dollars per day')
  expect(await say(await run($, 'ujbudget', '10'))).toContain('ever blocked')
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  usage.usd = 5
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  usage.usd = 8.5
  await clock.advance(61_000)
  const r = await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(r).toEqual({ result: {} })
  expect(toasts).toEqual([])
  expect(data(saved).notices.map(n => n.text).join()).toContain('Budget 80%')
  features['budget-warn-100'] = true
  usage.usd = 11
  await clock.advance(61_000)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('Budget 100%')
  expect(toasts[0]).toContain('Nothing is blocked')
  expect(await say(await run($, 'ujbudget', 'off'))).toContain('off')
  expect(data(saved).budget.perDay).toBe(0)
})

test('252 /ujforecast says it is approximate', async ($, on) => {
  const { usage, clock } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  expect(await say(await run($, 'ujforecast'))).toContain('Not enough samples')
  usage.usd = 0
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await clock.advance(30 * 60_000)
  usage.usd = 1
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await clock.advance(30 * 60_000)
  const t = await say(await run($, 'ujforecast'))
  expect(t).toContain('Approximate')
  expect(t).toMatch(/\$\d/)
})

test('258 a due goal is logged as a notice; its toast needs the switch, and calm silences it', async ($, on) => {
  const { clock, toasts, features, saved } = engine(on)
  await start($)
  expect(await say(await run($, 'ujgoal', 'add +30m write notes'))).toContain('Goal 1 added')
  expect(await say(await run($, 'ujgoal', 'add whenever x'))).toContain('Use:')
  await clock.advance(31 * 60_000)
  expect(toasts).toEqual([])
  expect(data(saved).notices[0]!.text).toContain('Goal due: write notes')
  expect(data(saved).goals[0]!.fired).toBe(true)
  features['goal-toasts'] = true
  await run($, 'ujgoal', 'add +10m second')
  await clock.advance(11 * 60_000)
  expect(toasts).toEqual(['Goal due: second'])
  expect(await say(await run($, 'ujgoal', 'list'))).toContain('second')
  await run($, 'ujgoal', 'done 2')
  expect(data(saved).goals[1]!.done).toBe(true)
  await run($, 'ujgoal', 'rm 1')
  expect(data(saved).goals.length).toBe(1)
})

test('goal toasts stay silent when calm', async ($, on) => {
  const { clock, toasts } = engine(on, { calm: true, features: { 'goal-toasts': true } })
  await start($)
  await run($, 'ujgoal', 'add +5m x')
  await clock.advance(6 * 60_000)
  expect(toasts).toEqual([])
})

test('259 a pomodoro ends on time, counts, and its toast is behind a switch', async ($, on) => {
  const { clock, toasts, features, saved } = engine(on)
  await start($)
  await run($, 'ujkanban', 'write the tests')
  expect(await say(await run($, 'ujpomo', 'start 25 card 9'))).toContain('No kanban card 9')
  expect(await say(await run($, 'ujpomo', 'start 25 card 1'))).toContain('linked to card 1')
  expect(await say(await run($, 'ujpomo', 'status'))).toContain('25:00')
  await clock.advance(24 * 60_000)
  expect(data(saved).pomo).not.toBeNull()
  await clock.advance(2 * 60_000)
  expect(data(saved).pomo).toBeNull()
  expect(data(saved).cards[0]!.pomos).toBe(1)
  expect(data(saved).days[dayKey(NOW + 26 * 60_000)]!.pomos).toBe(1)
  expect(toasts).toEqual([])
  expect(data(saved).notices.map(n => n.text).join()).toContain('Pomodoro done')
  features['pomo-toast'] = true
  await run($, 'ujpomo', 'break 5')
  await clock.advance(6 * 60_000)
  expect(toasts).toEqual(['Break over.'])
  expect(await say(await run($, 'ujpomo', 'start 500'))).toContain('1 to 120')
  await run($, 'ujpomo', 'start 10')
  expect(await say(await run($, 'ujpomo', 'stop'))).toContain('stopped')
  await clock.advance(11 * 60_000)
  expect(data(saved).days[dayKey(NOW + 40 * 60_000)]!.pomos).toBe(1)
})

test('259 the live countdown ticks once a second only behind its switch, motion on, not calm, and stops', async ($, on) => {
  const { clock, counts, features } = engine(on)
  await start($)
  await run($, 'ujpomo', 'start 2')
  await clock.advance(5000)
  expect(counts.nows).toBe(0)
  await run($, 'ujpomo', 'stop')
  features['live-timer'] = true
  await run($, 'ujpomo', 'start 2')
  await clock.advance(5000)
  expect(counts.nows).toBeGreaterThanOrEqual(4)
  await clock.advance(3 * 60_000)
  const after = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(after)
})

test('the live countdown stays static with /motion off or calm settings', async ($, on) => {
  const a = engine(on, { motion: false, features: { 'live-timer': true } })
  await start($)
  await run($, 'ujpomo', 'start 2')
  await a.clock.advance(5000)
  expect(a.counts.nows).toBe(0)
})

test('the live countdown stays static when calm', async ($, on) => {
  const a = engine(on, { calm: true, features: { 'live-timer': true } })
  await start($)
  await run($, 'ujpomo', 'start 2')
  await a.clock.advance(5000)
  expect(a.counts.nows).toBe(0)
})

test('257 the morning digest toast is off by default and fires once a day behind its switch', async ($, on) => {
  const morning = new Date(2026, 5, 10, 8, 30).getTime()
  const y = dayKey(morning - 86_400_000)
  const stored = { 'uj.data': { ...emptyData(), days: { [y]: { tools: 12, edits: 3, errors: 1, prompts: 4, usd: 1.5, pomos: 0 } } } }
  const off = engine(on, { stored, now: morning })
  await start($)
  expect(off.toasts).toEqual([])
})

test('257 the morning digest toast fires behind its switch, once per day, and not in the afternoon', async ($, on) => {
  const morning = new Date(2026, 5, 10, 8, 30).getTime()
  const y = dayKey(morning - 86_400_000)
  const stored = { 'uj.data': { ...emptyData(), days: { [y]: { tools: 12, edits: 3, errors: 1, prompts: 4, usd: 1.5, pomos: 0 } } } }
  const { toasts, saved, clock } = engine(on, { stored, now: morning, features: { 'digest-morning': true } })
  await start($)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('yesterday 12 tool calls')
  expect(data(saved).lastDigest).toBe(dayKey(morning))
  expect(data(saved).notices[0]!.kind).toBe('digest')
  await clock.advance(10 * 60_000)
  await start($)
  expect(toasts.length).toBe(1)
})

test('257 no morning toast in the afternoon', async ($, on) => {
  const afternoon = new Date(2026, 5, 10, 15, 0).getTime()
  const { toasts } = engine(on, { now: afternoon, features: { 'digest-morning': true } })
  await start($)
  expect(toasts).toEqual([])
})

test('257 /ujdigest returns text, daily or weekly', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(await say(await run($, 'ujdigest'))).toContain('Daily digest')
  expect(await say(await run($, 'ujdigest', 'weekly'))).toContain('Weekly digest')
})

test('254 /ujprompt add, list, use, export and import over the command line', async ($, on) => {
  const { saved, fills } = engine(on)
  await start($)
  expect(await say(await run($, 'ujprompt', 'add Review :: review this #review #qa'))).toContain('Prompt 1 saved')
  expect(await say(await run($, 'ujprompt', 'add bad'))).toContain('Use:')
  expect(await say(await run($, 'ujprompt', 'list'))).toContain('1. Review [review qa]')
  expect(await say(await run($, 'ujprompt', 'use 1'))).toContain('prompt box')
  expect(fills).toEqual([{ text: 'review this', mode: 'replace' }])
  const json = await say(await run($, 'ujprompt', 'export'))
  expect(JSON.parse(json).format).toBe('uj-prompts')
  await run($, 'ujprompt', 'rm 1')
  expect(data(saved).lib.length).toBe(0)
  expect(await say(await run($, 'ujprompt', `import ${json}`))).toContain('Imported 1 prompt')
  expect(await say(await run($, 'ujprompt', 'import {"format":"x"}'))).toContain('Import refused')
  expect(data(saved).lib.length).toBe(1)
})

test('/ujcmd manages the stored command list and /ujnotice the notices', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  const before = data(saved).cmds.length
  await run($, 'ujcmd', 'add Explain this module')
  expect(data(saved).cmds.length).toBe(before + 1)
  expect(await say(await run($, 'ujcmd', 'list'))).toContain('Explain this module')
  await run($, 'ujcmd', `rm ${before + 1}`)
  expect(data(saved).cmds.length).toBe(before)
  expect(await say(await run($, 'ujcmd', 'rm 999'))).toContain('No command')
  await run($, 'ujgoal', 'add +1m x')
  await run($, 'ujnotice', 'clear')
  expect(data(saved).notices).toEqual([])
})

test('/ujreset clears recorded data but keeps your own items, and /ujreset all clears those too', async ($, on) => {
  const { saved } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await run($, 'ujkanban', 'keep me')
  await run($, 'ujprompt', 'add Keep :: text')
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(data(saved).events.length).toBe(1)
  await run($, 'ujreset')
  expect(data(saved).events).toEqual([])
  expect(data(saved).days).toEqual({})
  expect(data(saved).cards.length).toBe(1)
  expect(data(saved).lib.length).toBe(1)
  await run($, 'ujreset', 'all')
  expect(data(saved).cards).toEqual([])
  expect(data(saved).lib).toEqual([])
})

test('a bad stored value is repaired at session start', async ($, on) => {
  const { saved } = engine(on, { stored: { 'uj.data': { events: 4, days: 'x', cards: [{ id: 1, text: 'ok', col: 'done' }], budget: 'no' } } })
  await start($)
  const d = data(saved)
  expect(d.events).toEqual([])
  expect(d.cards.length).toBe(1)
  expect(d.sessions.length).toBe(1)
  expect(d.budget.perDay).toBe(0)
})

// ------------------------------------------------------------------ the pane

const sample = () => {
  let d = seeded()
  d = { ...d, total: 2, days: { ...d.days, [dayKey(NOW)]: { ...d.days[dayKey(NOW)]!, usd: 2 } }, samples: [{ t: NOW - 2 * HOUR, tot: 0 }, { t: NOW - 60_000, tot: 2 }] }
  d = addLib(d, { title: 'Review', text: 'review it', tags: ['review'] }) as Data
  d = addCard(d, 'first card')!
  d = addGoal(d, NOW + HOUR, 'a goal')!
  d = addNotice(d, 'goal', 'A notice', NOW)
  d = recordTurn(d, { t: NOW, model: 'claude-x', ms: 3000 })
  d = { ...d, pstats: [{ t: NOW, tags: ['review'], ms: 3000, tools: 2, errs: 0 }], budget: { perDay: 10, carry: 2, asOf: dayKey(NOW), w80: '', w100: '' } }

  return d
}

const drawAll = async ($: any, surface: string) => {
  const ui = await $.ui.mount({ ...PANE, surface } as any)
  let n = 0

  for (const g of GROUPS) {
    await ui.press({ key: `uj-group-${g.id}` })

    for (const v of VIEWS.filter(x => x.group === g.id)) {
      await ui.press({ key: `uj-view-${v.id}` })
      expect(await ui.find({ type: 'Button', text: new RegExp(`^${v.label}$`) })).toBeDefined()
      n += 1
    }
  }
  await ui.unmount()

  return n
}

test('every view draws on the terminal, after pressing its own group and view buttons', async ($, on) => {
  engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  expect(await drawAll($, 'terminal')).toBe(VIEWS.length)
})

test('every view draws on the desktop (vector charts) and on mobile', async ($, on) => {
  engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  expect(await drawAll($, 'desktop')).toBe(VIEWS.length)
})

test('the switcher never shows more than 12 buttons in a row of tabs', () => {
  expect(GROUPS.length).toBeLessThanOrEqual(12)

  for (const g of GROUPS) {
    expect(VIEWS.filter(v => v.group === g.id).length).toBeLessThanOrEqual(12)
  }
  expect(VIEWS.length).toBe(20)
})

test('desktop draws vector charts with titles; terminal and the switch off draw text', async ($, on) => {
  const { features } = engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(JSON.stringify(await ui.find({ type: 'Svg' }))).toContain('<title>')

  for (const [g, v] of [['charts', 'timeline'], ['charts', 'treemap'], ['charts', 'graph']] as const) {
    await ui.press({ key: `uj-group-${g}` })
    await ui.press({ key: `uj-view-${v}` })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
  }
  await ui.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await term.press({ key: 'uj-group-charts' })
  await term.press({ key: 'uj-view-treemap' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /nested list with bars/ })).toBeDefined()
  await term.unmount()
  features['svg-charts'] = false
  const off = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  await off.press({ key: 'uj-group-charts' })
  await off.press({ key: 'uj-view-graph' })
  expect(await off.find({ type: 'Svg' })).toBeUndefined()
  await off.unmount()
})

test('236 the overview shows a sparkline per item in text and says real popups are not possible', async ($, on) => {
  engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Text', text: /Tool calls\s+8\s+▁+█/ })).toBeDefined()
  await ui.unmount()
  const dt = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await dt.find({ type: 'Text', text: /Real popups are not possible/ })).toBeDefined()
  await dt.unmount()
})

test('237 the Actions button opens an inline menu whose items act and close it', async ($, on) => {
  const { saved } = engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Button', text: /Mark all notices read/ })).toBeUndefined()
  await ui.press({ key: 'uj-pop' })
  expect(await ui.find({ type: 'Button', text: /Mark all notices read/ })).toBeDefined()
  await ui.press({ key: 'uj-pop-read' })
  expect(data(saved).notices.every(n => n.read)).toBe(true)
  expect(await ui.find({ type: 'Button', text: /Mark all notices read/ })).toBeUndefined()
  await ui.press({ key: 'uj-pop' })
  await ui.press({ key: 'uj-pop-pomo' })
  expect(data(saved).pomo).not.toBeNull()
  await ui.press({ key: 'uj-pop' })
  await ui.press({ key: 'uj-pop-replay' })
  expect(await ui.find({ type: 'Button', text: /^⏮$/ })).toBeDefined()
  await ui.unmount()
})

test('238 the command bar filters stored commands and fills the prompt box', async ($, on) => {
  const { fills, features } = engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Button', text: /\/ujkanban/ })).toBeUndefined()
  await ui.input({ key: 'uj-cmdbar', text: 'kanban', kind: 'change' })
  expect(await ui.find({ type: 'Button', text: /\/ujkanban/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /\/ujfeed/ })).toBeUndefined()
  await ui.press({ key: 'uj-cmd-0' })
  expect(fills).toEqual([{ text: '/ujkanban', mode: 'replace' }])
  await ui.input({ key: 'uj-cmdbar', text: 'tests' })
  expect(fills[1]!.text).toBe('Run the tests and report only the failures')
  await ui.input({ key: 'uj-cmdbar', text: 'zzz unknown' })
  expect(fills[2]!.text).toBe('zzz unknown')
  await ui.unmount()
  features['command-bar'] = false
  const off = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await off.find({ type: 'Input' })).toBeUndefined()
  await off.unmount()
})

test('240 the feed filters by kind; 243 the table sorts by a header button and picks columns', async ($, on) => {
  engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'uj-view-feed' })
  expect(await ui.find({ type: 'Text', text: /prompt 42 chars/ })).toBeDefined()
  await ui.press({ key: 'uj-kind-error' })
  expect(await ui.find({ type: 'Text', text: /Bash 400ms/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /prompt 42 chars/ })).toBeUndefined()
  await ui.press({ key: 'uj-view-table' })
  await ui.press({ key: 'uj-sort-ms' })
  expect(await ui.find({ type: 'Button', text: /ms ▼/ })).toBeDefined()
  await ui.press({ key: 'uj-sort-ms' })
  expect(await ui.find({ type: 'Button', text: /ms ▲/ })).toBeDefined()
  await ui.press({ key: 'uj-col-file' })
  expect(await ui.find({ type: 'Button', text: /^File$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /sort-file/ })).toBeUndefined()
  await ui.unmount()
})

test('242 kanban: add by input, move buttons, remove', async ($, on) => {
  const { saved } = engine(on, { motion: false })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'uj-group-work' })
  await ui.press({ key: 'uj-view-kanban' })
  await ui.input({ key: 'uj-card-input-0', text: 'ship it' })
  expect(data(saved).cards.map(c => c.text)).toEqual(['ship it'])
  await ui.press({ key: 'uj-card-right-1' })
  expect(data(saved).cards[0]!.col).toBe('doing')
  await ui.press({ key: 'uj-card-left-1' })
  expect(data(saved).cards[0]!.col).toBe('todo')
  await ui.press({ key: 'uj-card-pomo-1' })
  expect(data(saved).pomo!.card).toBe(1)
  await ui.press({ key: 'uj-card-rm-1' })
  expect(data(saved).cards).toEqual([])
  expect(data(saved).pomo!.card).toBe(0)
  await ui.unmount()
})

test('245 the calendar moves back a month; 248 compare switches mode; 241 timeline changes window', async ($, on) => {
  engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'uj-group-charts' })
  await ui.press({ key: 'uj-view-calendar' })
  const title = calendar(sample(), NOW, 0).title
  expect(await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) })).toBeDefined()
  await ui.press({ key: 'uj-cal-prev' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) })).toBeUndefined()
  await ui.press({ key: 'uj-view-compare' })
  await ui.press({ key: 'uj-cmp-session' })
  expect(await ui.find({ type: 'Text', text: /this session/ })).toBeDefined()
  await ui.press({ key: 'uj-view-timeline' })
  await ui.press({ key: 'uj-win-15' })
  expect(await ui.find({ type: 'Button', text: /^15m$/ })).toBeDefined()
  await ui.unmount()
})

test('251 replay moves with the buttons and shows a position bar', async ($, on) => {
  engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  await run($, 'ujreplay')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  const total = sample().events.length
  expect(await ui.find({ type: 'Text', text: new RegExp(`${total}/${total}`) })).toBeDefined()
  await ui.press({ key: 'uj-rp-first' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`^▕.*▏ 1/${total}$`) })).toBeDefined()
  await ui.press({ key: 'uj-rp-fwd' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`2/${total}`) })).toBeDefined()
  await ui.press({ key: 'uj-rp-fwd10' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`${total}/${total}`) })).toBeDefined()
  await ui.press({ key: 'uj-rp-back' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`${total - 1}/${total}`) })).toBeDefined()
  await ui.unmount()
})

test('239 notices: unread badge, toggle, mark all, and the honest note about other mods', async ($, on) => {
  const { saved } = engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Button', text: /1 unread/ })).toBeDefined()
  await ui.press({ key: 'uj-badge' })
  expect(await ui.find({ type: 'Text', text: /Toasts from other mods cannot be read/ })).toBeDefined()
  await ui.press({ key: 'uj-notice-toggle-1' })
  expect(data(saved).notices[0]!.read).toBe(true)
  expect(await ui.find({ type: 'Button', text: /^Unread$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /1 unread/ })).toBeUndefined()
  await ui.press({ key: 'uj-notice-allunread' })
  expect(data(saved).notices[0]!.read).toBe(false)
  await ui.unmount()
})

test('254 library: use fills the prompt, tag filter, export shows JSON, import field refuses bad JSON', async ($, on) => {
  const { fills, saved } = engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'uj-group-prompts' })
  await ui.press({ key: 'uj-view-library' })
  await ui.press({ key: 'uj-lib-use-1' })
  expect(fills[0]).toEqual({ text: 'review it', mode: 'replace' })
  await ui.press({ key: 'uj-tag-review' })
  expect(await ui.find({ type: 'Text', text: /Review/ })).toBeDefined()
  await ui.press({ key: 'uj-lib-export' })
  expect(await ui.find({ type: 'Text', text: /"format":"uj-prompts"/ })).toBeDefined()
  await ui.input({ key: 'uj-lib-import-1', text: '{"format":"uj-prompts","version":1,"prompts":[],"x":1}' })
  expect(await ui.find({ type: 'Text', text: /Import refused/ })).toBeDefined()
  expect(data(saved).lib.length).toBe(1)
  await ui.input({ key: 'uj-lib-add-1', text: 'Second :: do the thing #ops' })
  expect(data(saved).lib.length).toBe(2)
  await ui.unmount()
})

test('255 256 stats and models views show the heuristic and model notes', async ($, on) => {
  engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'uj-group-prompts' })
  await ui.press({ key: 'uj-view-stats' })
  expect(await ui.find({ type: 'Text', text: /Heuristic/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^review\s+1/ })).toBeDefined()
  await ui.press({ key: 'uj-view-models' })
  expect(await ui.find({ type: 'Text', text: /^claude-x\s+1/ })).toBeDefined()
  await ui.unmount()
})

test('253 252 the spend view shows the budget with rollover, and the forecast label', async ($, on) => {
  const { saved } = engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'uj-group-work' })
  await ui.press({ key: 'uj-view-spend' })
  expect(await ui.find({ type: 'Text', text: /today \$2\.00 of \$12\.00/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Forecast \(approximate\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /never block anything/ })).toBeDefined()
  await ui.input({ key: 'uj-budget-input-10', text: '25' })
  expect(data(saved).budget.perDay).toBe(25)
  await ui.unmount()
})

test('250 the presentation view shows large figures and nothing that names a file, tool or prompt', async ($, on) => {
  const stored = { 'uj.data': call(emptyData(), { tool: 'Edit', file: '/Users/zed/topsecret/plan.md', t: NOW }) }
  const { features } = engine(on, { motion: false, stored })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  await ui.press({ key: 'uj-view-present' })
  const all = JSON.stringify(await ui.find({ type: 'Box' }))
  expect(all).toContain('Tool calls today')
  expect(all).not.toMatch(/topsecret|plan\.md|zed|Edit(?!s)/)
  await ui.unmount()
  features.presentation = false
  const off = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  await off.press({ key: 'uj-view-present' })
  expect(await off.find({ type: 'Text', text: /switched off/ })).toBeDefined()
  await off.unmount()
})

test('249 the print view is plain text only', async ($, on) => {
  engine(on, { motion: false, stored: { 'uj.data': sample() } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'uj-view-print' })
  const t = await ui.find({ type: 'Text', text: /plain text/ })
  expect(t).toBeDefined()
  expect(JSON.stringify(t)).not.toMatch(/borderStyle|"color"/)
  await ui.unmount()
})

test('258 259 the goals view adds a goal by input and shows the static timer note', async ($, on) => {
  const { saved } = engine(on, { motion: false })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'uj-group-work' })
  await ui.press({ key: 'uj-view-goals' })
  await ui.input({ key: 'uj-goal-input-0', text: '+3h finish the report' })
  expect(data(saved).goals.map(g => g.text)).toEqual(['finish the report'])
  await ui.press({ key: 'uj-pomo-work' })
  expect(await ui.find({ type: 'Text', text: /^25:00$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Static/ })).toBeDefined()
  await ui.press({ key: 'uj-pomo-stop' })
  expect(data(saved).pomo).toBeNull()
  await ui.press({ key: 'uj-goal-done-1' })
  expect(data(saved).goals[0]!.done).toBe(true)
  await ui.unmount()
})

test('a pane with no data at all draws a friendly empty state on each surface', async ($, on) => {
  engine(on, { motion: false })
  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile']) {
    const ui = await $.ui.mount({ ...PANE, surface } as any)
    expect(await ui.find({ type: 'Text', text: /Nothing recorded yet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the emptyUi default points at an existing view and group', () => {
  const u = emptyUi()
  expect(VIEWS.some(v => v.id === u.view && v.group === u.group)).toBe(true)
})
