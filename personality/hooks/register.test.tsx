import { expect, mock, test } from 'claude-code/testing'

import {
  BADGES,
  CHEERS,
  TIPS,
  badgesText,
  bar,
  canToast,
  cleanDays,
  dayKey,
  emptyDay,
  enqueue,
  filesLine,
  frameOf,
  greetingText,
  moodOf,
  newBadges,
  parseSprint,
  petFrame,
  petStateOf,
  pickToast,
  pruneDays,
  shiftDay,
  statusPlan,
  statusText,
  streakOf,
  streakText,
  tipIndexFor,
  weekOf,
  weeklyText,
} from './logic'
import type { BadgeCtx, Days, Pending, ToolEvent } from './logic'

const MIN = 60_000
// Local 10:00 on 25 Nov 2026, so day keys do not depend on the machine's zone.
const T0 = new Date(2026, 10, 25, 10, 0, 0).getTime()
const TODAY = dayKey(T0)

const call = (agoMs: number, ok = true, tool = 'Read', detail = '', isEdit = false): ToolEvent => ({
  at: T0 - agoMs,
  ok,
  tool,
  detail,
  isEdit,
})

const day = (over: Partial<ReturnType<typeof emptyDay>> = {}) => ({ ...emptyDay(), ...over })
const edited = (n = 1) => day({ edits: n, tools: n, fileCount: n })

// ------------------------------------------------------------------- calendar

test('day keys are local and shift across month ends', async () => {
  expect(TODAY).toBe('2026-11-25')
  expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  expect(shiftDay('2026-11-25', -7)).toBe('2026-11-18')
})

// ----------------------------------------------------------------------- mood

test('mood: quiet with too little or stale activity', async () => {
  expect(moodOf([], T0)).toBeNull()
  expect(moodOf([call(10_000), call(20_000)], T0)).toBeNull()
  // Three calls, but the last was 4 minutes ago: idle.
  expect(moodOf([call(280_000), call(270_000), call(250_000)], T0)).toBeNull()
})

test('mood: cruising on a fast clean run', async () => {
  const evs = [100, 90, 80, 70, 60, 50, 40, 30].map(s => call(s * 1000))
  expect(moodOf(evs, T0)).toBe('cruising')
})

test('mood: digging in on a slower pace', async () => {
  const evs = [150, 110, 70, 30].map(s => call(s * 1000))
  expect(moodOf(evs, T0)).toBe('digging in')
})

test('mood: stuck on three failures in a row, or a high error ratio', async () => {
  expect(moodOf([call(40_000), call(30_000, false), call(20_000, false), call(10_000, false)], T0)).toBe('stuck')
  const mixed = [call(50_000, false), call(40_000), call(30_000, false), call(20_000), call(10_000, true)]
  expect(moodOf(mixed, T0)).toBe('stuck')
})

test('mood: wrapping up when tests or git follow edits', async () => {
  const evs = [call(60_000, true, 'Edit', 'a.ts', true), call(40_000, true, 'Read'), call(20_000, true, 'Bash', 'git commit -m x')]
  expect(moodOf(evs, T0)).toBe('wrapping up')
  // The same command with no edits before it is just work.
  const noEdit = [call(60_000), call(40_000), call(20_000, true, 'Bash', 'npm test')]
  expect(moodOf(noEdit, T0)).toBe('digging in')
})

test('status line: prefixed with a glyph, short, and set sparingly', async () => {
  expect(statusText('stuck')).toBe('✕ stuck')
  expect(statusText('cruising').length).toBeLessThan(20)
  const memo = { text: '≈ cruising' as string | undefined, at: T0 }
  expect(statusPlan(memo, '≈ cruising', T0 + 60_000)).toBe('skip')
  expect(statusPlan(memo, '◒ digging in', T0 + 5_000)).toBe('skip')
  expect(statusPlan(memo, '◒ digging in', T0 + 20_000)).toBe('set')
  expect(statusPlan(memo, undefined, T0 + 1)).toBe('clear')
  expect(statusPlan({ text: undefined, at: 0 }, undefined, T0)).toBe('skip')
})

// --------------------------------------------------------------------- streak

test('streak: counts consecutive days with an edit, alive until today ends', async () => {
  const days: Days = { [TODAY]: edited(), [shiftDay(TODAY, -1)]: edited(), [shiftDay(TODAY, -2)]: edited() }
  expect(streakOf(days, TODAY)).toEqual({ current: 3, best: 3, isTodayDone: true })

  // Nothing yet today: yesterday's run still counts.
  const quiet: Days = { [shiftDay(TODAY, -1)]: edited(), [shiftDay(TODAY, -2)]: edited() }
  expect(streakOf(quiet, TODAY)).toEqual({ current: 2, best: 2, isTodayDone: false })

  // A day with sessions but no edits does not count, and a gap breaks the run.
  const gap: Days = {
    [TODAY]: edited(),
    [shiftDay(TODAY, -1)]: day({ sessions: 2, tools: 30 }),
    [shiftDay(TODAY, -2)]: edited(),
    [shiftDay(TODAY, -3)]: edited(),
    [shiftDay(TODAY, -4)]: edited(),
  }
  expect(streakOf(gap, TODAY)).toEqual({ current: 1, best: 3, isTodayDone: true })
  expect(streakOf({}, TODAY)).toEqual({ current: 0, best: 0, isTodayDone: false })
})

test('streak text tells you what to do next', async () => {
  expect(streakText({}, TODAY, 0)).toContain('Edit a file today to start one.')
  const days: Days = { [shiftDay(TODAY, -1)]: edited() }
  expect(streakText(days, TODAY, 4)).toContain('Streak: 1 day (best 4).')
  expect(streakText(days, TODAY, 4)).toContain('keep it going')
  expect(streakText({ [TODAY]: edited() }, TODAY, 0)).toContain('Today is counted.')
})

// ---------------------------------------------------------------- achievements

const ctx = (over: Partial<BadgeCtx> = {}): BadgeCtx => ({
  days: {},
  today: TODAY,
  lifetimeTools: 0,
  sessionFiles: 0,
  hour: 10,
  sprintsDone: 0,
  ...over,
})

const ids = (c: BadgeCtx, got: Record<string, number> = {}) => newBadges(c, got).map(b => b.id)

test('badges: counts, files, hours and sprints', async () => {
  expect(ids(ctx())).toEqual([])
  expect(ids(ctx({ lifetimeTools: 99 }))).toEqual([])
  expect(ids(ctx({ lifetimeTools: 100 }))).toEqual(['tools-100'])
  expect(ids(ctx({ lifetimeTools: 1000 }))).toEqual(['tools-100', 'tools-1000'])
  expect(ids(ctx({ sessionFiles: 10 }))).toEqual(['ten-files'])
  expect(ids(ctx({ hour: 2 }))).toEqual(['night-owl'])
  expect(ids(ctx({ hour: 6 }))).toEqual(['early-bird'])
  expect(ids(ctx({ hour: 5 }))).toEqual(['early-bird'])
  expect(ids(ctx({ hour: 12 }))).toEqual([])
  expect(ids(ctx({ sprintsDone: 1 }))).toEqual(['sprint-1'])
  expect(ids(ctx({ sprintsDone: 5 }))).toEqual(['sprint-1', 'sprint-5'])
})

test('badges: a zero-error day needs 20 clean calls', async () => {
  expect(ids(ctx({ days: { [TODAY]: day({ tools: 19 }) } }))).toEqual([])
  expect(ids(ctx({ days: { [TODAY]: day({ tools: 20 }) } }))).toEqual(['zero-error-day'])
  expect(ids(ctx({ days: { [TODAY]: day({ tools: 40, errors: 1 }) } }))).toEqual([])
  expect(ids(ctx({ days: { [TODAY]: day({ tools: 200 }) } }))).toEqual(['zero-error-day', 'busy-day'])
})

test('badges: streak badges, and unlocked ones are not repeated', async () => {
  const days: Days = {}

  for (let i = 0; i < 3; i++) {
    days[shiftDay(TODAY, -i)] = edited()
  }
  expect(ids(ctx({ days }))).toEqual(['streak-3'])
  expect(ids(ctx({ days }), { 'streak-3': 1 })).toEqual([])
})

test('badges: ids are unique and /badges lists every one', async () => {
  expect(new Set(BADGES.map(b => b.id)).size).toBe(BADGES.length)
  const text = badgesText({ 'tools-100': T0 })
  expect(text).toContain(`Badges: 1 of ${BADGES.length}`)
  expect(text).toContain('★ First 100 tool calls')
  expect(text).toContain('☆ Night owl')
})

// --------------------------------------------------------------------- weekly

const weekDays = (): Days => {
  const days: Days = {}

  for (let i = 0; i < 10; i++) {
    days[shiftDay(TODAY, -i)] = day({
      sessions: 1,
      tools: 10 * (i + 1),
      errors: i === 0 ? 2 : 0,
      edits: 3,
      fileCount: 2,
      toolCounts: { Bash: 4 * (i + 1), Read: 6 * (i + 1) },
    })
  }

  return days
}

test('weekly: sums exactly the last seven days', async () => {
  const w = weekOf(weekDays(), TODAY)
  expect(w.rows.length).toBe(7)
  expect(w.from).toBe(shiftDay(TODAY, -6))
  expect(w.rows[6]?.day).toBe(TODAY)
  // Days 0..6 ago have 10..70 calls: 280 in all. The three older days are left out.
  expect(w.totals).toEqual({ sessions: 7, tools: 280, errors: 2, edits: 21, files: 14 })
  expect(w.topTools).toEqual([
    ['Read', 168],
    ['Bash', 112],
  ])
  expect(w.busiest?.day).toBe(shiftDay(TODAY, -6))
})

test('weekly: empty history gives zero rows and a friendly report', async () => {
  const w = weekOf({}, TODAY)
  expect(w.totals.tools).toBe(0)
  expect(w.topTools).toEqual([])
  const text = weeklyText(w, {}, 0)
  expect(text).toContain('0 sessions')
  expect(text).toContain('(none recorded yet)')
})

test('weekly: text report has bars, totals, streak and top tools', async () => {
  const days = weekDays()
  const text = weeklyText(weekOf(days, TODAY), days, 12)
  expect(text).toContain('Weekly report, Nov 19 to Nov 25')
  expect(text).toContain('7 sessions · 280 tool calls · 14 files edited · 2 errors')
  expect(text).toContain('Streak: 10 days (best 12)')
  expect(text).toContain('██████████')
  expect(text).toMatch(/Read\s+█+/)
  expect(bar(0.5, 10)).toBe('█████░░░░░')
  expect(bar(5, 4)).toBe('████')
  expect(bar(Number.NaN, 4)).toBe('░░░░')
})

// --------------------------------------------------------------------- toasts

const item = (over: Partial<Pending> = {}): Pending => ({ kind: 'tip', text: 't', priority: 1, at: T0, ttlMs: 60 * MIN, ...over })

test('toast gate: one per five minutes, highest priority first, stale dropped', async () => {
  expect(canToast(T0, 0)).toBe(true)
  expect(canToast(T0, T0 - 4 * MIN)).toBe(false)
  expect(canToast(T0, T0 - 5 * MIN)).toBe(true)

  const q = [item({ kind: 'tip', priority: 1 }), item({ kind: 'sprint', priority: 3, text: 's' })]
  const closed = pickToast(q, T0, T0 - MIN)
  expect(closed.toast).toBeUndefined()
  expect(closed.rest.length).toBe(2)
  expect(closed.waitMs).toBe(4 * MIN)

  const open = pickToast(q, T0, T0 - 6 * MIN)
  expect(open.toast?.kind).toBe('sprint')
  expect(open.rest.map(r => r.kind)).toEqual(['tip'])

  const stale = pickToast([item({ ttlMs: MIN })], T0 + 2 * MIN, 0)
  expect(stale.toast).toBeUndefined()
  expect(stale.rest).toEqual([])
})

test('toast queue: badges merge into one toast', async () => {
  let q: Pending[] = []
  q = enqueue(q, item({ kind: 'badge', names: ['Night owl'], text: 'Badge unlocked: Night owl', priority: 2 }))
  q = enqueue(q, item({ kind: 'badge', names: ['Ten files in a session'], priority: 2 }))
  expect(q.length).toBe(1)
  expect(q[0]?.text).toBe('Badges unlocked: Night owl, Ten files in a session')
})

test('greeting follows the hour and recaps yesterday', async () => {
  const days: Days = { [shiftDay(TODAY, -1)]: day({ sessions: 3, tools: 41 }) }
  expect(greetingText(9, days, TODAY)).toBe('Good morning. Yesterday: 3 sessions, 41 tool calls.')
  expect(greetingText(14, {}, TODAY)).toBe('Good afternoon.')
  expect(greetingText(19, {}, TODAY)).toBe('Good evening.')
  expect(greetingText(2, {}, TODAY)).toBe('Late one.')
  expect(greetingText(9, { [shiftDay(TODAY, -1)]: day({ sessions: 1, tools: 1 }) }, TODAY)).toBe('Good morning. Yesterday: 1 session, 1 tool call.')
})

// ----------------------------------------------------------------------- tips

test('forty distinct tips, one stable choice per day', async () => {
  expect(TIPS.length).toBe(40)
  expect(new Set(TIPS).size).toBe(40)

  for (const t of TIPS) {
    expect(t.length).toBeGreaterThan(30)
    expect(t.length).toBeLessThan(170)
  }
  expect(tipIndexFor('2026-11-25')).toBe(tipIndexFor('2026-11-25'))
  const seen = new Set<number>()

  for (let i = 0; i < 60; i++) {
    const idx = tipIndexFor(shiftDay('2026-01-01', i))
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(40)
    seen.add(idx)
  }
  expect(seen.size).toBeGreaterThan(15)
})

// --------------------------------------------------------------------- sprint

test('sprint: parsing and the end-of-sprint cheer', async () => {
  expect(parseSprint('25 write the parser')).toEqual({ minutes: 25, goal: 'write the parser' })
  expect(parseSprint('  1.5   fix   it ')).toEqual({ minutes: 1.5, goal: 'fix it' })
  expect(parseSprint('25')).toBeUndefined()
  expect(parseSprint('0 nothing')).toBeUndefined()
  expect(parseSprint('999 too long')).toBeUndefined()
  expect(parseSprint('soon do x')).toBeUndefined()
  expect(filesLine([])).toBe('No files changed.')
  expect(filesLine(['/a/b/one.ts', '/a/two.ts'])).toBe('Changed: one.ts, two.ts.')
  expect(filesLine(['/1.ts', '/2.ts', '/3.ts', '/4.ts', '/5.ts', '/6.ts'])).toBe('Changed: 1.ts, 2.ts, 3.ts, 4.ts +2 more.')
  expect(CHEERS.length).toBeGreaterThan(5)
})

// ------------------------------------------------------------------------ pet

test('pet: state from activity, frames advance, motion off holds still', async () => {
  const base = { now: T0, lastAt: T0 - MIN, running: 0, happyUntil: 0 }
  expect(petStateOf(base)).toBe('idle')
  expect(petStateOf({ ...base, running: 1 })).toBe('working')
  expect(petStateOf({ ...base, happyUntil: T0 + 5000 })).toBe('happy')
  expect(petStateOf({ ...base, running: 1, happyUntil: T0 + 5000 })).toBe('working')
  expect(petStateOf({ ...base, lastAt: T0 - 5 * MIN })).toBe('sleepy')
  expect(petStateOf({ ...base, lastAt: T0 - 4 * MIN })).toBe('idle')
  expect(petStateOf({ ...base, lastAt: 0 })).toBe('idle')

  for (const s of ['idle', 'working', 'happy', 'sleepy'] as const) {
    const a = petFrame(s, 0)
    const b = petFrame(s, 1)
    expect(a.lines.length).toBe(4)
    const frames = new Set<string>()

    for (let f = 0; f < 8; f++) {
      frames.add(petFrame(s, f).lines.join('\n'))
    }
    // Every state animates (idle only blinks).
    expect(frames.size).toBeGreaterThan(1)
    expect(b.caption).toBe(a.caption)
  }
  expect(frameOf(T0, false)).toBe(0)
  expect(frameOf(T0 + 500, true) - frameOf(T0, true)).toBe(1)
})

// --------------------------------------------------------------- store hygiene

test('store hygiene: junk is cleaned, old days pruned, only today keeps files', async () => {
  const raw = {
    [TODAY]: { sessions: 2, tools: 5, files: ['/a', 7], toolCounts: { Bash: 'x', Read: 3 } },
    [shiftDay(TODAY, -1)]: { sessions: 1, tools: 2, files: ['/b'] },
    [shiftDay(TODAY, -90)]: { sessions: 1 },
    'not-a-day': { sessions: 1 },
    [shiftDay(TODAY, 3)]: { sessions: 9 },
  }
  const clean = cleanDays(raw)
  expect(clean[TODAY]?.files).toEqual(['/a'])
  expect(clean[TODAY]?.toolCounts).toEqual({ Bash: 0, Read: 3 })
  expect(clean['not-a-day']).toBeUndefined()
  const pruned = pruneDays(clean, TODAY)
  expect(Object.keys(pruned).sort()).toEqual([shiftDay(TODAY, -1), TODAY].sort())
  expect(pruned[shiftDay(TODAY, -1)]?.files).toEqual([])
  expect(pruned[TODAY]?.files).toEqual(['/a'])
  expect(cleanDays('garbage')).toEqual({})
})

// ================================================================ the mod itself

const PANE = (id: string) =>
  ({
    plugin: 'personality',
    component: 'Pane',
    requestId: id,
    surface: 'desktop',
    props: { title: id, isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as const

// A quiet store: greeted and tipped already, last toast long ago.
const settled = (extra: Record<string, unknown> = {}) => ({
  meta: { lastToastAt: T0 - 60 * MIN, lastGreetingAt: T0, tipDay: TODAY, lifetime: 0, best: 0 },
  ...extra,
})

const world = (on: any, store: Record<string, unknown>, opts: { now?: number; onTool?: () => Promise<void> } = {}) => {
  const log = { toasts: [] as { text: string; at: number }[], statuses: [] as (string | undefined)[], registered: [] as string[] }
  const clock = mock.clock(on, { now: opts.now ?? T0 })
  mock.store(on, store)
  on('command.register', (_: unknown, e: { name: string }) => {
    log.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    log.toasts.push({ text: e.text, at: clock.now() })

    return { value: undefined }
  })
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    log.statuses.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', async (_: unknown, e: { tool: string }) => {
    await opts.onTool?.()

    return { result: {}, ...(e.tool === 'mcp__t__fail' ? { isError: true } : {}) }
  })

  return { log, clock }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args })) as { text: string }).text

test('session start registers the commands and greets once', async ($, on) => {
  const { log, clock } = world(on, {})
  await start($)
  await clock.settle()

  expect(log.registered.sort()).toEqual(['badges', 'fun', 'pet', 'sprint', 'sprintlog', 'streak', 'tip', 'weekly'])
  expect(log.toasts.map(t => t.text)).toEqual(['Good morning.'])

  // The tip of the day waits for the five-minute gap, and arrives once.
  await clock.advance(5 * MIN + 2000)
  expect(log.toasts.length).toBe(2)
  expect(log.toasts[1]?.text.startsWith('Tip: ')).toBe(true)
  expect(log.toasts[1]!.at - log.toasts[0]!.at).toBeGreaterThanOrEqual(5 * MIN)
  await clock.advance(30 * MIN)
  expect(log.toasts.length).toBe(2)
})

test('never more than one toast in any five minutes, however much happens', async ($, on) => {
  const { log, clock } = world(on, {})
  await start($)

  for (let i = 0; i < 120; i++) {
    await $.tool.call({ tool: 'Edit', file_path: `/p/f${i % 12}.ts`, old_string: 'a', new_string: 'b' })
    await clock.advance(1000)
  }
  await clock.advance(20 * MIN)

  expect(log.toasts.length).toBeGreaterThan(1)

  for (let i = 1; i < log.toasts.length; i++) {
    expect(log.toasts[i]!.at - log.toasts[i - 1]!.at).toBeGreaterThanOrEqual(5 * MIN)
  }
})

test('/fun off silences toasts, status and badges; /fun on brings them back', async ($, on) => {
  const { log, clock } = world(on, settled())
  await start($)
  expect(await run($, 'fun', 'off')).toContain('Fun is off')

  for (let i = 0; i < 110; i++) {
    await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
  }
  await clock.advance(10 * MIN)
  expect(log.toasts).toEqual([])
  expect(log.statuses.filter(s => s !== undefined)).toEqual([])
  expect(await run($, 'badges')).toContain('Badges: 0 of')
  // Stats are still counted for /weekly.
  expect(await run($, 'weekly')).toContain('110 tool calls')

  expect(await run($, 'fun')).toContain('Fun is off')
  expect(await run($, 'fun', 'on')).toContain('Fun is on')
  await $.tool.call({ tool: 'Bash', command: 'echo again' })
  expect(log.toasts.length).toBe(1)
  expect(log.toasts[0]?.text).toContain('First 100 tool calls')
})

test('mood status appears with activity, stays short, and clears when idle', async ($, on) => {
  const { log, clock } = world(on, settled())
  await start($)

  for (let i = 0; i < 8; i++) {
    await $.tool.call({ tool: 'Read', file_path: `/p/${i}.ts` })
    await clock.advance(5000)
  }
  const shown = log.statuses.filter((s): s is string => s !== undefined)
  expect(shown.length).toBeGreaterThan(0)
  expect(shown.length).toBeLessThan(3)
  expect(shown[0]).toMatch(/^[≈◒✕✓] [a-z ]+$/)
  expect(shown[0]!.length).toBeLessThan(16)

  await clock.advance(4 * MIN)
  expect(log.statuses[log.statuses.length - 1]).toBeUndefined()
})

test('failures show as stuck', async ($, on) => {
  const { log } = world(on, settled())
  await start($)

  for (let i = 0; i < 4; i++) {
    await $.tool.call({ tool: 'mcp__t__fail', command: 'x' })
  }
  expect(log.statuses[log.statuses.length - 1]).toBe('✕ stuck')
})

test('an edit starts a streak, and /streak, /weekly and the weekly pane agree', async ($, on) => {
  world(on, settled())
  await start($)
  expect(await run($, 'streak')).toContain('Streak: 0 days')
  await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })

  expect(await run($, 'streak')).toContain('Streak: 1 day (best 1).')
  const text = await run($, 'weekly')
  expect(text).toContain('1 session · 3 tool calls · 1 file edited · 0 errors')
  expect(text).toContain('Bash')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE('personality-weekly'), surface })
    expect(await ui.find({ type: 'Text', text: /Last 7 days/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /█+/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Bash$/ })).toBeDefined()
    await ui.unmount()
  }
  expect(await run($, 'weekly', 'pane')).toBe('Weekly pane opened.')
})

test('the 100th tool call unlocks a badge, once', async ($, on) => {
  const { log } = world(on, settled({ meta: { lastToastAt: T0 - 60 * MIN, lastGreetingAt: T0, tipDay: TODAY, lifetime: 97, best: 0 } }))
  await start($)

  for (let i = 0; i < 6; i++) {
    await $.tool.call({ tool: 'Read', file_path: `/p/${i}` })
  }
  expect(log.toasts.map(t => t.text)).toEqual(['Badge unlocked: First 100 tool calls'])
  expect(await run($, 'badges')).toContain('★ First 100 tool calls')
})

test('a night-time call earns the night owl', async ($, on) => {
  // The clock starts at 02:00 local.
  const night = new Date(2026, 10, 25, 2, 0, 0).getTime()
  const { log } = world(on, { meta: { lastToastAt: night - 60 * MIN, lastGreetingAt: night, tipDay: dayKey(night) } }, { now: night })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/p/a' })
  expect(log.toasts.map(t => t.text)).toEqual(['Badge unlocked: Night owl'])
})

test('a sprint ends with a cheer and the files changed during it', async ($, on) => {
  const { log, clock } = world(on, settled())
  await start($)
  expect(await run($, 'sprint', '')).toContain('No sprint running')
  expect(await run($, 'sprint', 'abc')).toContain('Usage')
  expect(await run($, 'sprint', '2 write the tests')).toContain('Sprint started: 2 min on "write the tests"')
  expect(await run($, 'sprint', '5 another')).toContain('already running')

  await $.tool.call({ tool: 'Edit', file_path: '/p/src/one.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/p/src/two.ts', content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/one.ts', old_string: 'b', new_string: 'c' })
  await clock.advance(MIN)
  expect(log.toasts).toEqual([])
  expect(await run($, 'sprint', 'status')).toContain('1 min left, 2 files changed')

  await clock.advance(MIN + 1000)
  const cheer = log.toasts.map(t => t.text).filter(t => t.includes('write the tests'))
  expect(cheer.length).toBe(1)
  expect(cheer[0]).toContain('2 min')
  expect(cheer[0]).toContain('Changed: one.ts, two.ts.')

  const sprintLog = await run($, 'sprintlog')
  expect(sprintLog).toContain('1 finished, 2 min focused')
  expect(sprintLog).toContain('write the tests')
  expect(await run($, 'sprint', 'status')).toContain('No sprint running')
})

test('a stopped sprint is logged but not cheered', async ($, on) => {
  const { log, clock } = world(on, settled())
  await start($)
  await run($, 'sprint', '10 read the docs')
  await clock.advance(3 * MIN)
  expect(await run($, 'sprint', 'stop')).toContain('stopped')
  await clock.advance(20 * MIN)
  expect(log.toasts).toEqual([])
  expect(await run($, 'sprintlog')).toContain('0 finished')
})

test('/tip shows a different tip each time', async ($, on) => {
  world(on, settled())
  await start($)
  const a = await run($, 'tip')
  const b = await run($, 'tip')
  expect(a).toMatch(/^Tip \d+ of 40: /)
  expect(a).not.toBe(b)
})

test('the pet: states in the pane, motion switch, sleepy after five minutes', async ($, on) => {
  const { clock } = world(on, settled())
  await start($)

  const ui = await $.ui.mount(PANE('personality-pet'))
  expect(await ui.find({ type: 'Text', text: /waiting/ })).toBeDefined()
  await ui.unmount()

  expect(await run($, 'pet')).toBe('Pet pane opened.')
  expect(await run($, 'fun', 'motion off')).toMatch(/Motion off/)
  const still = await $.ui.mount(PANE('personality-pet'))
  expect(await still.find({ type: 'Text', text: /\(still\)/ })).toBeDefined()
  await still.unmount()

  // After five quiet minutes the pet is asleep.
  await clock.advance(5 * MIN + 2000)
  const sleepy = await $.ui.mount(PANE('personality-pet'))
  expect(await sleepy.find({ type: 'Text', text: /zzz/ })).toBeDefined()
  await sleepy.unmount()
  expect(await run($, 'fun', 'motion on')).toMatch(/Motion on/)
  expect(await run($, 'fun', 'motion')).toBe('Motion is on. /fun motion on|off')
  expect(await run($, 'pet', 'off')).toBe('Pet pane closed.')
})

test('the 500 ms ticker animates the pet while the pane is open, and stops when it closes', async ($, on) => {
  let advance: (ms: number) => Promise<void> = async () => undefined
  let frames: string[] = []
  // Inside a running tool the pet is "working": its paws alternate with the frame.
  const probe = async () => {
    for (let i = 0; i < 4; i++) {
      const ui = await $.ui.mount(PANE('personality-pet'))
      frames.push((await ui.find({ type: 'Text', text: /\/\|=\|\\/ })) === undefined ? 'b' : 'a')
      await ui.unmount()
      await advance(500)
    }
  }
  const { clock } = world(on, settled(), { onTool: probe })
  advance = clock.advance
  await start($)

  await run($, 'pet')
  await $.tool.call({ tool: 'Bash', command: 'one' })
  expect(frames.length).toBe(4)
  expect(new Set(frames).size).toBe(2)

  // Closed: the ticker is cancelled and the frame holds.
  frames = []
  await run($, 'pet', 'off')
  await $.tool.call({ tool: 'Bash', command: 'two' })
  expect(frames.length).toBe(4)
  expect(new Set(frames).size).toBe(1)

  // Reopened: it moves again.
  frames = []
  await run($, 'pet')
  await $.tool.call({ tool: 'Bash', command: 'three' })
  expect(new Set(frames).size).toBe(2)
})

test('a working tool shows the pet at work', async ($, on) => {
  let seen = ''
  world(on, settled(), {
    onTool: async () => {
      const ui = await $.ui.mount(PANE('personality-pet'))
      seen = (await ui.find({ type: 'Text', text: /busy paws/ }))?.text ?? ''
      await ui.unmount()
    },
  })
  await start($)
  await run($, 'fun', 'motion off')
  await $.tool.call({ tool: 'Bash', command: 'sleep 1' })
  expect(seen).toBe('busy paws (still)')
})
