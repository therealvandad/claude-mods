import { expect, mock, test } from 'claude-code/testing'

import {
  CATS,
  DEFAULT_CFG,
  DEFAULT_LIMITER,
  GLOBAL_GAP_MS,
  MIN,
  MUTABLE,
  URGENT_GAP_MS,
  addFired,
  addPending,
  bumpWeek,
  checkinDue,
  crossedDown,
  crossedUp,
  decide,
  digestSummary,
  firedNums,
  firstWord,
  inQuiet,
  isDiskLow,
  isFailed,
  isFileChange,
  isFriday,
  isNetCall,
  levelSpec,
  nextOccurrence,
  normalizeCfg,
  parseDf,
  parseQuiet,
  shouldFlush,
  stretchOf,
  weekKey,
  weeklyDue,
} from './pure'
import type { Cfg, Level, Limiter } from '../types'

const at = (h: number, m = 0, day = 5) => new Date(2026, 0, day, h, m).getTime() // local time, Monday 5 Jan 2026

const base = (over: Partial<Parameters<typeof decide>[0]> = {}) => ({
  level: 'notice' as Level,
  category: 'cost',
  now: at(12),
  minute: 12 * 60,
  cfg: DEFAULT_CFG as Cfg,
  limiter: DEFAULT_LIMITER as Limiter,
  ...over,
})

// ------------------------------------------------------------ 121 levels (pure)

test('121: a level decides the toast duration and the sound; sounds are off unless switched on', async () => {
  expect(levelSpec('info', false)).toEqual({ timeoutMs: 3500, sound: null })
  expect(levelSpec('notice', false).sound).toBeNull()
  expect(levelSpec('urgent', false).sound).toBeNull()
  expect(levelSpec('info', true).sound).toBeNull()
  expect(levelSpec('notice', true)).toEqual({ timeoutMs: 6000, sound: 'sounds/notice.wav' })
  expect(levelSpec('urgent', true)).toEqual({ timeoutMs: 10_000, sound: 'sounds/urgent.wav' })
  expect(levelSpec('urgent', false).timeoutMs).toBeGreaterThan(levelSpec('notice', false).timeoutMs)
})

// ------------------------------------------------------------ the rate limiter (pure)

test('rate limiter: the first notice shows, a second within 3 minutes is batched, one after 3 minutes shows', async () => {
  const first = decide(base())
  expect(first.action).toBe('show')
  expect(first.limiter.lastShown).toBe(at(12))

  const second = decide(base({ category: 'idle', now: at(12) + 60_000, limiter: first.limiter }))
  expect(second).toMatchObject({ action: 'digest', reason: 'one toast per 3 minutes' })
  // A batched notice does not use up the allowance.
  expect(second.limiter).toBe(first.limiter)

  const third = decide(base({ category: 'idle', now: at(12) + GLOBAL_GAP_MS, limiter: first.limiter }))
  expect(third.action).toBe('show')
})

test('rate limiter: a category has its own minimum gap and drops repeats', async () => {
  expect(CATS.idle?.gap).toBe(10 * MIN)
  const first = decide(base({ category: 'idle' }))
  const again = decide(base({ category: 'idle', now: at(12) + 5 * MIN, limiter: first.limiter }))
  expect(again).toMatchObject({ action: 'drop', reason: 'category rate limit' })
  const later = decide(base({ category: 'idle', now: at(12) + 10 * MIN, limiter: first.limiter }))
  expect(later.action).toBe('show')
})

test('rate limiter: urgent skips the 3-minute limit and snooze but keeps a 20 s burst guard and the mute list', async () => {
  const shownNotice = decide(base()).limiter
  const cfg = { ...DEFAULT_CFG, snoozeUntil: at(13) }
  const urgent = decide(base({ level: 'urgent', category: 'disk', now: at(12) + 1000, cfg, limiter: shownNotice }))
  expect(urgent.action).toBe('show')
  const burst = decide(base({ level: 'urgent', category: 'deadline', now: at(12) + 1000 + URGENT_GAP_MS - 1, cfg, limiter: urgent.limiter }))
  expect(burst).toMatchObject({ action: 'digest', reason: 'urgent burst' })
  const after = decide(base({ level: 'urgent', category: 'deadline', now: at(12) + 1000 + URGENT_GAP_MS, cfg, limiter: urgent.limiter }))
  expect(after.action).toBe('show')
  const muted = decide(base({ level: 'urgent', category: 'disk', cfg: { ...DEFAULT_CFG, muted: ['disk'] } }))
  expect(muted).toMatchObject({ action: 'drop', reason: 'muted' })
})

test('rate limiter: info is always batched, except the digest summary itself', async () => {
  expect(decide(base({ level: 'info' }))).toMatchObject({ action: 'digest', reason: 'low priority' })
  expect(decide(base({ level: 'notice', category: 'digest', isDigest: true })).action).toBe('show')
})

// ------------------------------------------------------------ snooze and mute (pure)

test('123/124: snooze holds non-urgent notices until it ends; mute drops one category only', async () => {
  const cfg = { ...DEFAULT_CFG, snoozeUntil: at(12) + 30 * MIN }
  expect(decide(base({ cfg }))).toMatchObject({ action: 'hold', reason: 'snoozed' })
  expect(decide(base({ cfg, now: at(12) + 30 * MIN })).action).toBe('show')

  const muted = { ...DEFAULT_CFG, muted: ['cost'] }
  expect(decide(base({ cfg: muted }))).toMatchObject({ action: 'drop', reason: 'muted' })
  expect(decide(base({ cfg: muted, category: 'idle' })).action).toBe('show')
  expect(MUTABLE).toContain('cost')
  expect(MUTABLE).not.toContain('test')
})

// ------------------------------------------------------------ quiet hours (pure)

test('135: quiet hours wrap past midnight and use minutes of the local day', async () => {
  expect(parseQuiet('22:00-07:00')).toBe('22:00-07:00')
  expect(parseQuiet('9:5-10:00')).toBeNull()
  expect(parseQuiet('09:00-9:30')).toBe('09:00-09:30')
  expect(parseQuiet('25:00-07:00')).toBeNull()
  expect(parseQuiet('08:00-08:00')).toBeNull()
  expect(parseQuiet('nonsense')).toBeNull()

  expect(inQuiet('22:00-07:00', 23 * 60)).toBe(true)
  expect(inQuiet('22:00-07:00', 0)).toBe(true)
  expect(inQuiet('22:00-07:00', 6 * 60 + 59)).toBe(true)
  expect(inQuiet('22:00-07:00', 7 * 60)).toBe(false)
  expect(inQuiet('22:00-07:00', 12 * 60)).toBe(false)
  expect(inQuiet('22:00-07:00', 22 * 60)).toBe(true)
  expect(inQuiet('13:00-14:00', 13 * 60 + 30)).toBe(true)
  expect(inQuiet('13:00-14:00', 14 * 60)).toBe(false)
  expect(inQuiet('', 100)).toBe(false)

  const cfg = { ...DEFAULT_CFG, quiet: '22:00-07:00' }
  expect(decide(base({ cfg, now: at(23), minute: 23 * 60 }))).toMatchObject({ action: 'hold', reason: 'quiet hours' })
  expect(decide(base({ cfg, level: 'urgent', now: at(23), minute: 23 * 60 })).action).toBe('show')
  expect(decide(base({ cfg, now: at(8), minute: 8 * 60 })).action).toBe('show')
})

test('135: the next occurrence of a clock time is today if ahead, else tomorrow, in local time', async () => {
  const next = nextOccurrence(at(12), '17:30')
  expect(next).toBe(at(17, 30))
  const tomorrow = nextOccurrence(at(18), '17:30')
  expect(tomorrow).toBe(at(17, 30, 6))
  expect(nextOccurrence(at(12), '17:30')).toBeGreaterThan(at(12))
  expect(nextOccurrence(at(12), 'x')).toBeNull()
  expect(nextOccurrence(at(12), '12:00')).toBe(at(12, 0, 6))
})

// ------------------------------------------------------------ digest (pure)

test('122: the digest collects, dedupes, is bounded, flushes every 10 minutes and summarizes by category', async () => {
  const item = (n: number, category = 'cost', text = `n${n}`) => ({ t: n, category, level: 'info' as Level, text, why: 'low priority' })
  let list = addPending([], item(1))
  list = addPending(list, item(2))
  list = addPending(list, item(2)) // the same text again replaces, it does not stack
  expect(list.length).toBe(2)
  for (let i = 10; i < 80; i += 1) {
    list = addPending(list, item(i))
  }
  expect(list.length).toBe(30)
  expect(list[list.length - 1]?.text).toBe('n79')

  expect(shouldFlush([], 0, 99 * MIN)).toBe(false)
  expect(shouldFlush([item(1)], 100, 100 + 10 * MIN - 1)).toBe(false)
  expect(shouldFlush([item(1)], 100, 100 + 10 * MIN)).toBe(true)

  expect(digestSummary([item(1, 'cost'), item(2, 'cost', 'b'), item(3, 'longrun')])).toBe('3 notices held (cost x2, longrun). /aldigest to read.')
  expect(digestSummary([item(1, 'idle')])).toBe('1 notice held (idle). /aldigest to read.')
})

// ------------------------------------------------------------ milestones (pure)

test('129/128/136: milestones fire once, the highest passed, and mark every step passed', async () => {
  expect(crossedUp([1, 5, 10], 0.5, [])).toEqual({ hit: null, mark: [] })
  expect(crossedUp([1, 5, 10], 1.2, [])).toEqual({ hit: 1, mark: [1] })
  expect(crossedUp([1, 5, 10], 1.9, [1])).toEqual({ hit: null, mark: [] })
  expect(crossedUp([1, 5, 10], 7, [1])).toEqual({ hit: 5, mark: [5] })
  expect(crossedUp([1, 5, 10], 12, [])).toEqual({ hit: 10, mark: [1, 5, 10] })
  expect(crossedUp([70, 85, 95], 96, [70])).toEqual({ hit: 95, mark: [85, 95] })

  expect(crossedDown([30, 10, 0], 45, [])).toEqual({ hit: null, mark: [] })
  expect(crossedDown([30, 10, 0], 29.9, [])).toEqual({ hit: 30, mark: [30] })
  expect(crossedDown([30, 10, 0], 5, [])).toEqual({ hit: 10, mark: [30, 10] })
  expect(crossedDown([30, 10, 0], 0, [30, 10])).toEqual({ hit: 0, mark: [0] })

  const fired = addFired(addFired([], ['cost:1', 'rl:x:70']), ['cost:5'])
  expect(firedNums(fired, 'cost:')).toEqual([1, 5])
  expect(firedNums(fired, 'rl:x:')).toEqual([70])
  expect(addFired(Array.from({ length: 100 }, (_, i) => `k${i}`), ['new']).length).toBe(80)
})

// ------------------------------------------------------------ small classifiers (pure)

test('139/131/134/132: classifiers for file changes, network calls, failures and df output', async () => {
  expect(isFileChange('Edit', {})).toBe(true)
  expect(isFileChange('Write', {})).toBe(true)
  expect(isFileChange('Read', {})).toBe(false)
  expect(isFileChange('Bash', { command: 'rm -f a.txt' })).toBe(true)
  expect(isFileChange('Bash', { command: 'git rm a' })).toBe(true)
  expect(isFileChange('Bash', { command: 'ls; rm b' })).toBe(true)
  expect(isFileChange('Bash', { command: 'echo farm' })).toBe(false)
  expect(isFileChange('Bash', { command: 'npm run format' })).toBe(false)

  expect(isNetCall('WebFetch', {})).toBe(true)
  expect(isNetCall('Bash', { command: 'curl -s https://x' })).toBe(true)
  expect(isNetCall('Bash', { command: 'echo curlew' })).toBe(false)
  expect(isFailed({ isError: true })).toBe(true)
  expect(isFailed({ deny: 'no' })).toBe(true)
  expect(isFailed({ result: { exitCode: 7 } })).toBe(true)
  expect(isFailed({ result: { exitCode: 0 } })).toBe(false)
  expect(isFailed(undefined)).toBe(false)
  expect(firstWord('  /usr/bin/npm run test --token=abc')).toBe('npm')

  const linux = 'Filesystem     1K-blocks     Used Available Use% Mounted on\n/dev/sda1      100000000 97000000   3000000  97% /'
  const mac = 'Filesystem   1024-blocks      Used Available Capacity iused ifree %iused  Mounted on\n/dev/disk3s1s1 488245288 11000000 200000000     6%  400000 2000000000     0%   /'
  expect(Math.round((parseDf(linux) ?? 0) * 1000)).toBe(3000)
  expect(isDiskLow(parseDf(linux))).toBe(true)
  expect(parseDf(mac)).toBeGreaterThan(90)
  expect(isDiskLow(parseDf(mac))).toBe(false)
  expect(parseDf('garbage')).toBeNull()
  expect(parseDf('')).toBeNull()
  expect(isDiskLow(5)).toBe(false)
  expect(isDiskLow(4.9)).toBe(true)
  expect(isDiskLow(null)).toBe(false)
})

test('137/138: activity stretches, check-in timing, week counters and Friday', async () => {
  const a = stretchOf(0, 0, 1000)
  expect(a).toEqual({ start: 1000, last: 1000, isNew: true })
  const b = stretchOf(a.start, a.last, 1000 + 14 * MIN)
  expect(b.isNew).toBe(false)
  expect(b.start).toBe(1000)
  const c = stretchOf(b.start, b.last, b.last + 15 * MIN)
  expect(c.isNew).toBe(true)
  expect(checkinDue(0, 0)).toBe(false)
  expect(checkinDue(1000, 1000 + 89 * MIN)).toBe(false)
  expect(checkinDue(1000, 1000 + 90 * MIN)).toBe(true)

  const monday = at(9)
  const friday = at(9, 0, 9)
  expect(isFriday(friday)).toBe(true)
  expect(isFriday(monday)).toBe(false)
  expect(weekKey(monday)).toBe('2026-01-05')
  expect(weekKey(friday)).toBe('2026-01-05')
  expect(weekKey(at(9, 0, 12))).toBe('2026-01-12')

  let week = bumpWeek({ key: '', calls: 0, shownKey: '' }, weekKey(monday), 5)
  week = bumpWeek(week, weekKey(friday), 7)
  expect(week.calls).toBe(12)
  expect(weeklyDue(week, monday)).toBe(false)
  expect(weeklyDue(week, friday)).toBe(true)
  expect(weeklyDue({ ...week, shownKey: week.key }, friday)).toBe(false)
  expect(weeklyDue({ ...week, calls: 0 }, friday)).toBe(false)
  const next = bumpWeek({ ...week, shownKey: week.key }, '2026-01-12', 1)
  expect(next).toEqual({ key: '2026-01-12', calls: 1, shownKey: '2026-01-05' })
})

test('settings read from the store are validated', async () => {
  expect(normalizeCfg(null)).toEqual(DEFAULT_CFG)
  expect(normalizeCfg({ quiet: 'bad', muted: ['zzz', 3], sounds: 'yes', snoozeUntil: 'x' })).toEqual(DEFAULT_CFG)
  expect(normalizeCfg({ quiet: '22:00-07:00', muted: ['cost', 'zzz'], sounds: true, checkin: true, snoozeUntil: 5, deadline: { at: 9, label: 'x' } })).toEqual({
    snoozeUntil: 5,
    quiet: '22:00-07:00',
    muted: ['cost'],
    sounds: true,
    checkin: true,
    deadline: { at: 9, label: 'x' },
  })
})

// ------------------------------------------------------------ the engine, with a mocked world

type Box = {
  toasts: { text: string; timeoutMs: number | undefined }[]
  notified: string[]
  played: string[]
  procs: string[][]
  registered: string[]
  refuse: string
  usage: { percent: number | undefined; usd: number | undefined; limits: { kind: string; percentUsed: number; resetsAt?: string }[] }
  notifyOk: boolean
  df: string
  dfFails: boolean
  toolImpl: (e: any) => unknown
}

const newBox = (): Box => ({
  toasts: [],
  notified: [],
  played: [],
  procs: [],
  registered: [],
  refuse: '',
  usage: { percent: 10, usd: 0.1, limits: [] },
  notifyOk: true,
  df: 'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/a 1000 100 900 10% /',
  dfFails: false,
  toolImpl: () => ({ result: { stdout: 'ok' }, text: 'ok' }),
})

const wire = (on: (...args: any[]) => unknown, box: Box) => {
  on('command.register', (_: unknown, e: { name: string }) => {
    if (e.name === box.refuse) {
      throw new Error('name taken')
    }
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.toast', (_: unknown, e: { text: string; timeoutMs?: number }) => {
    box.toasts.push({ text: e.text, timeoutMs: e.timeoutMs })

    return { value: undefined }
  })
  on('ui.notify', (_: unknown, e: { text: string }) => {
    box.notified.push(e.text)

    return { value: box.notifyOk ? { isSent: true, channel: 'client' } : { isSent: false, reason: 'no-channel' } }
  })
  on('audio.play', (_: unknown, e: { clip: { asset: string } }) => {
    box.played.push(e.clip.asset)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 1,
      context: { window: 1000, percent: box.usage.percent },
      rateLimits: box.usage.limits,
      ...(box.usage.usd === undefined ? {} : { cost: { usd: box.usage.usd } }),
    },
  }))
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    box.procs.push(e.argv)

    if (box.dfFails) {
      throw new Error('cannot start')
    }

    return { value: { exitCode: 0, stdout: box.df, stderr: '' } }
  })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('tool.call', (_: unknown, e: any) => box.toolImpl(e))
  on('classic.PermissionRequest', () => ({}))
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
}

const cmd = ($: any, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })

const done = (over: Record<string, unknown> = {}) =>
  ({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...over }) as any

const startSession = ($: any) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

const prompt = ($: any, text = 'hello') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const BAND = (surface = 'desktop') =>
  ({
    plugin: 'alerts',
    surface,
    component: 'AbovePrompt',
    requestId: 'alerts-band',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as any

const setup = async ($: any, on: any, now = at(12), stored: Record<string, unknown> = {}, before?: (box: Box, clock: { sleep: (ms: number) => Promise<void> }) => void) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now })
  mock.store(on, stored)
  before?.(box, clock)
  await startSession($)

  return { box, clock }
}

const texts = (box: Box) => box.toasts.map(t => t.text)

test('session start registers the eleven commands and survives a refused name', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: at(12) })
  mock.store(on)
  box.refuse = 'alquiet'
  await startSession($)

  expect(box.registered).toEqual(['al', 'alsnooze', 'almute', 'alhistory', 'aldigest', 'aldeadline', 'alcheckin', 'alsound', 'altest', 'alreset'])
  expect(texts(box).some(t => /\/alquiet could not be registered/.test(t))).toBe(true)
})

test('/al lists every command with one line each and the limits of mute', async ($, on) => {
  await setup($, on)
  const text: string = (await cmd($, 'al')).text

  for (const name of ['al', 'alsnooze', 'almute', 'alhistory', 'aldigest', 'alquiet', 'aldeadline', 'alcheckin', 'alsound', 'altest', 'alreset']) {
    expect(text).toContain(`/${name}:`)
  }
  expect(text).toMatch(/other mods/)
  expect(text).toMatch(/battery/)
  for (const name of MUTABLE) {
    expect(text).toContain(name)
  }
})

test('121: levels set the toast duration; info is batched; the 3-minute limit batches the next notice; history records toasts', async ($, on) => {
  const { box, clock } = await setup($, on)

  expect((await cmd($, 'altest', 'info')).text).toMatch(/queued in the digest \(low priority\)/)
  expect(box.toasts.length).toBe(0)

  expect((await cmd($, 'altest', 'notice')).text).toBe('Test notice notice: shown.')
  expect(box.toasts).toEqual([{ text: 'Test notice notice from alerts.', timeoutMs: 6000 }])

  expect((await cmd($, 'altest', 'notice')).text).toMatch(/queued in the digest \(one toast per 3 minutes\)/)
  expect(box.toasts.length).toBe(1)

  clock.advance(1000)
  await clock.settle()
  expect((await cmd($, 'altest', 'urgent')).text).toBe('Test urgent notice: shown.')
  expect(box.toasts[1]).toEqual({ text: 'Test urgent notice from alerts.', timeoutMs: 10_000 })

  const history: string = (await cmd($, 'alhistory')).text
  expect(history).toContain('[notice/test] toast: Test notice notice from alerts.')
  expect(history).toContain('[urgent/test] toast: Test urgent notice from alerts.')
  expect(history).not.toContain('[info/test]')
  expect(history).toMatch(/2 batched/)
  expect((await cmd($, 'altest', 'loud')).text).toMatch(/Usage/)
})

test('121: sounds are off by default and play only for notice and urgent once /alsound on', async ($, on) => {
  const { box, clock } = await setup($, on)
  await cmd($, 'altest', 'notice')
  expect(box.played).toEqual([])

  expect((await cmd($, 'alsound', 'on')).text).toMatch(/Sounds are on/)
  await clock.advance(4 * MIN)
  await cmd($, 'altest', 'notice')
  expect(box.played).toEqual(['sounds/notice.wav'])
  await clock.advance(1000)
  await cmd($, 'altest', 'urgent')
  expect(box.played).toEqual(['sounds/notice.wav', 'sounds/urgent.wav'])
  expect((await cmd($, 'alsound', 'test')).text).toMatch(/Played/)
  await cmd($, 'alsound', 'off')
  await clock.advance(1000 + 30_000)
  await cmd($, 'altest', 'urgent')
  expect(box.played.length).toBe(3)
})

test('123: snooze holds non-urgent notices, keeps urgent ones, and the digest goes out afterwards', async ($, on) => {
  const { box, clock } = await setup($, on)

  expect((await cmd($, 'alsnooze', '30')).text).toMatch(/Snoozed until 12:30/)
  expect((await cmd($, 'altest', 'notice')).text).toMatch(/held until quiet ends \(snoozed\)/)
  expect(box.toasts.length).toBe(0)
  expect((await cmd($, 'aldigest')).text).toMatch(/1 pending/)
  expect((await cmd($, 'altest', 'urgent')).text).toBe('Test urgent notice: shown.')

  await clock.advance(31 * MIN)
  expect(texts(box).some(t => /1 notice held \(test\)/.test(t))).toBe(true)
  expect((await cmd($, 'aldigest')).text).toMatch(/Nothing pending/)
  expect((await cmd($, 'alsnooze', 'abc')).text).toMatch(/Usage/)
  expect((await cmd($, 'alsnooze', 'off')).text).toMatch(/Snooze off/)
})

test('122: the digest summary shows at most once per 10 minutes and /aldigest now and clear work', async ($, on) => {
  const { box, clock } = await setup($, on)
  await cmd($, 'altest', 'info')
  await clock.advance(5 * MIN)
  expect(box.toasts.length).toBe(0)
  await clock.advance(5 * MIN + 30_000)
  expect(texts(box).filter(t => /notice held/.test(t)).length).toBe(1)

  await cmd($, 'altest', 'info')
  await clock.advance(2 * MIN)
  expect(texts(box).filter(t => /notice held/.test(t)).length).toBe(1)
  expect((await cmd($, 'aldigest', 'clear')).text).toBe('Digest cleared.')
  expect((await cmd($, 'aldigest', 'now')).text).toMatch(/nothing pending/)
  await cmd($, 'altest', 'info')
  await clock.advance(MIN)
  expect((await cmd($, 'aldigest', 'now')).text).toMatch(/Digest summary: shown/)
})

test('124: mute silences one category of this mod and the rest still work', async ($, on) => {
  const { box, clock } = await setup($, on)
  expect((await cmd($, 'almute', 'bogus')).text).toMatch(/Unknown category/)
  expect((await cmd($, 'almute', 'cost')).text).toContain('[x] cost')

  box.usage.usd = 6
  await $.turn.complete(done())
  expect(texts(box).some(t => /Session cost/.test(t))).toBe(false)
  expect((await cmd($, 'alhistory')).text).toMatch(/1 muted/)

  await clock.advance(MIN)
  expect((await cmd($, 'altest', 'notice')).text).toBe('Test notice notice: shown.')
  expect((await cmd($, 'almute', 'cost')).text).toContain('[ ] cost')
  expect((await cmd($, 'almute', 'idle')).text).toContain('[x] idle')
  expect((await cmd($, 'almute', 'clear')).text).toBe('Nothing is muted now.')
})

test('135: quiet hours (local time) hold notices, the settings survive a restart, urgent still shows', async ($, on) => {
  const { box, clock } = await setup($, on, at(23, 0))
  expect((await cmd($, 'alquiet', '22:00-07:00')).text).toMatch(/Quiet hours 22:00-07:00/)
  expect((await cmd($, 'altest', 'notice')).text).toMatch(/held until quiet ends \(quiet hours\)/)
  expect((await cmd($, 'altest', 'urgent')).text).toBe('Test urgent notice: shown.')
  expect(box.toasts.length).toBe(1)

  await clock.set(at(7, 5, 6))
  expect(texts(box).some(t => /1 notice held/.test(t))).toBe(true)
  expect((await cmd($, 'alquiet', '9-9')).text).toMatch(/Usage/)
  expect((await cmd($, 'alquiet', 'off')).text).toMatch(/Quiet hours are off/)
})

test('settings are stored and restored at the next session start', async ($, on) => {
  const stored = { 'alerts.cfg': { snoozeUntil: 0, quiet: '22:00-07:00', muted: ['idle', 'nope'], sounds: true, checkin: true, deadline: null } }
  const { box } = await setup($, on, at(12), stored)
  const text: string = (await cmd($, 'al')).text
  expect(text).toContain('quiet hours 22:00-07:00')
  expect(text).toContain('sounds on')
  expect(text).toContain('Muted: idle.')
  expect(box.toasts.length).toBe(0)
})

test('129 and 128 and 140: cost, rate-limit and context notices fire once each and respect the limiter', async ($, on) => {
  const { box, clock } = await setup($, on)
  box.usage.usd = 1.5
  await $.turn.complete(done())
  // $1 is info level: it waits in the digest.
  expect(texts(box).filter(t => /Session cost/.test(t)).length).toBe(0)
  expect((await cmd($, 'aldigest')).text).toMatch(/Session cost passed \$1 \(now \$1\.50\)/)

  box.usage.usd = 11
  await $.turn.complete(done())
  expect(texts(box).filter(t => /Session cost passed \$10/.test(t)).length).toBe(1)
  await $.turn.complete(done())
  await $.turn.complete(done())
  expect(texts(box).filter(t => /Session cost/.test(t)).length).toBe(1)

  await clock.advance(4 * MIN)
  box.usage.limits = [{ kind: 'five_hour', percentUsed: 72.4, resetsAt: new Date(at(15)).toISOString() }]
  await $.turn.complete(done())
  expect(texts(box).some(t => /5-hour limit is 72% used \(resets 15:00\)/.test(t))).toBe(true)
  await $.turn.complete(done())
  expect(texts(box).filter(t => /5-hour limit/.test(t)).length).toBe(1)

  // 95 percent is urgent: it shows at once and marks 85 as passed, so no 85 follows.
  box.usage.limits = [{ kind: 'five_hour', percentUsed: 96, resetsAt: new Date(at(15)).toISOString() }]
  await $.turn.complete(done())
  expect(texts(box).filter(t => /5-hour limit is 96%/.test(t)).length).toBe(1)
  expect(texts(box).some(t => /85%/.test(t))).toBe(false)
  box.usage.limits = [{ kind: 'five_hour', percentUsed: 97, resetsAt: new Date(at(15)).toISOString() }]
  await $.turn.complete(done())
  expect(texts(box).filter(t => /5-hour limit/.test(t)).length).toBe(2)

  // A new window (a new resetsAt) starts the ramp again.
  await clock.advance(4 * MIN)
  box.usage.limits = [{ kind: 'five_hour', percentUsed: 71, resetsAt: new Date(at(20)).toISOString() }]
  await $.turn.complete(done())
  expect(texts(box).some(t => /71% used/.test(t))).toBe(true)

  await clock.advance(4 * MIN)
  box.usage.percent = 90
  await $.turn.complete(done())
  // The digest summary may have just used the 3-minute allowance: the context notice then waits in the digest.
  const seen = async () => [...texts(box), (await cmd($, 'aldigest')).text].join('\n')
  expect(((await seen()).match(/Context window is 90% full/g) ?? []).length).toBe(1)
  await clock.advance(4 * MIN)
  await $.turn.complete(done())
  expect(((await seen()).match(/Context window is 90% full/g) ?? []).length).toBe(1)
})

test('129: a host without a cost ledger or limits gives no cost notices and no crash', async ($, on) => {
  const { box } = await setup($, on)
  box.usage.usd = undefined
  await $.turn.complete(done())
  await $.turn.complete(done())
  expect(box.toasts.length).toBe(0)
})

test('127: a long turn followed by 60 s of silence sends one native notification, at most once per 10 minutes', async ($, on) => {
  const { box, clock } = await setup($, on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(130_000)
  await $.turn.complete(done({ durationMs: 130_000 }))
  await clock.advance(30_000)
  expect(box.notified.length).toBe(0)
  await clock.advance(46_000)
  expect(box.notified).toEqual(['Claude finished after 2m 10s and is waiting for you.'])

  // A turn under 120 s sends nothing; a prompt within 60 s cancels it.
  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.turn.complete(done({ durationMs: 100_000 }))
  await clock.advance(2 * MIN)
  expect(box.notified.length).toBe(1)
  await $.turn.complete(done({ durationMs: 200_000 }))
  await clock.advance(20_000)
  await prompt($)
  await clock.advance(3 * MIN)
  expect(box.notified.length).toBe(1)

  // The 10-minute category limit.
  await $.turn.complete(done({ durationMs: 200_000 }))
  await clock.advance(2 * MIN)
  expect(box.notified.length).toBe(1)
  await clock.advance(10 * MIN)
  await $.turn.complete(done({ durationMs: 200_000 }))
  await clock.advance(2 * MIN)
  expect(box.notified.length).toBe(2)
  // An interrupted turn and a subagent's turn never notify.
  await $.turn.complete(done({ durationMs: 500_000, isAborted: true, reason: 'aborted' }))
  await $.turn.complete(done({ durationMs: 500_000, agentId: 'sub' }))
  await clock.advance(20 * MIN)
  expect(box.notified.length).toBe(2)
})

test('127: a refused native notification does not use up the allowance', async ($, on) => {
  const { box, clock } = await setup($, on)
  box.notifyOk = false
  await $.turn.complete(done({ durationMs: 200_000 }))
  await clock.advance(2 * MIN)
  expect(box.notified.length).toBe(1)
  box.notifyOk = true
  await $.turn.complete(done({ durationMs: 200_000 }))
  await clock.advance(2 * MIN)
  expect(box.notified.length).toBe(2)
  expect((await cmd($, 'alhistory')).text).toMatch(/native: Claude finished after 3m 20s/)
})

test('130: ten minutes of silence after a turn gives one idle toast; a prompt cancels it', async ($, on) => {
  const { box, clock } = await setup($, on)
  await $.turn.complete(done({ durationMs: 5000 }))
  await clock.advance(9 * MIN)
  expect(texts(box).length).toBe(0)
  await clock.advance(2 * MIN)
  expect(texts(box)).toEqual(['Claude has been waiting 10 minutes since the last turn ended.'])
  await clock.advance(30 * MIN)
  expect(texts(box).length).toBe(1)

  await $.turn.complete(done({ durationMs: 5000 }))
  await clock.advance(5 * MIN)
  await prompt($)
  await clock.advance(30 * MIN)
  expect(texts(box).length).toBe(1)
})

test('131: a Bash call over 90 s gives one notice naming the command word only', async ($, on) => {
  const { box, clock } = await setup($, on, at(12), {}, (b, c) => {
    b.toolImpl = async (e: any) => {
      await c.sleep(e.command.includes('slow') ? 100_000 : 1000)

      return { result: { stdout: 'ok' }, text: 'ok' }
    }
  })

  const quick = $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(2000)
  await quick
  expect((await cmd($, 'aldigest')).text).toMatch(/Nothing pending/)

  const slow = $.tool.call({ tool: 'Bash', command: 'npm run slow --token=SECRET' })
  await clock.advance(101_000)
  await slow
  // Info level: it waits in the digest.
  expect(box.toasts.length).toBe(0)
  const text: string = (await cmd($, 'aldigest')).text
  expect(text).toMatch(/A Bash call \(npm\) ended after 1m 4\ds/)
  expect(text).not.toContain('SECRET')
})

test('134: three failures in a row give one network notice; a success resets the count', async ($, on) => {
  let fail = true
  const { box } = await setup($, on, at(12), {}, b => {
    b.toolImpl = () => (fail ? { result: { error: 'x' }, text: 'x', isError: true } : { result: {}, text: 'ok' })
  })

  await $.tool.call({ tool: 'WebFetch', url: 'https://a', prompt: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'curl -s https://b' })
  expect(box.toasts.length).toBe(0)
  fail = false
  await $.tool.call({ tool: 'WebFetch', url: 'https://a', prompt: 'x' })
  fail = true
  await $.tool.call({ tool: 'WebFetch', url: 'https://a', prompt: 'x' })
  await $.tool.call({ tool: 'WebFetch', url: 'https://a', prompt: 'x' })
  expect(box.toasts.length).toBe(0)
  await $.tool.call({ tool: 'WebFetch', url: 'https://a', prompt: 'x' })
  expect(texts(box)).toEqual(['Network may be down: 3 WebFetch/curl calls failed in a row.'])
  await $.tool.call({ tool: 'WebFetch', url: 'https://a', prompt: 'x' })
  await $.tool.call({ tool: 'WebFetch', url: 'https://a', prompt: 'x' })
  expect(box.toasts.length).toBe(1)
  // Failures of other tools do not count.
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(box.toasts.length).toBe(1)
})

test('139: ten file edits or deletes in one turn give one toast, and the next turn counts afresh', async ($, on) => {
  const { box, clock } = await setup($, on)
  await $.turn.start({ text: 'refactor', turnId: 't1' })

  for (let i = 0; i < 9; i += 1) {
    await $.tool.call({ tool: 'Edit', file_path: `/w/${i}.ts`, old_string: 'a', new_string: 'b' })
  }
  expect(box.toasts.length).toBe(0)
  await $.tool.call({ tool: 'Bash', command: 'rm old.txt' })
  expect(texts(box).length).toBe(1)
  expect(texts(box)[0]).toMatch(/10 file edits or deletes/)
  await $.tool.call({ tool: 'Edit', file_path: '/w/x.ts', old_string: 'a', new_string: 'b' })
  expect(box.toasts.length).toBe(1)

  await $.turn.complete(done())
  await clock.advance(6 * MIN)
  await $.turn.start({ text: 'again', turnId: 't2' })
  for (let i = 0; i < 10; i += 1) {
    await $.tool.call({ tool: 'Write', file_path: `/w/n${i}.ts`, content: 'x' })
  }
  expect(box.toasts.length).toBe(2)
})

test('132: df -k . is the only command run, once per 10 minutes, only while a turn runs, and low space is urgent', async ($, on) => {
  const { box, clock } = await setup($, on)
  await clock.advance(30 * MIN)
  expect(box.procs).toEqual([])

  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(20_000)
  expect(box.procs).toEqual([['df', '-k', '.']])
  await clock.advance(5 * MIN)
  expect(box.procs.length).toBe(1)
  expect(box.toasts.length).toBe(0)

  box.df = 'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/a 1000 970 30 97% /'
  await clock.advance(6 * MIN)
  expect(box.procs.length).toBe(2)
  expect(texts(box)).toEqual(['Disk space is low: 3.0% free where this session runs.'])
  expect(box.toasts[0]?.timeoutMs).toBe(10_000)
  for (const argv of box.procs) {
    expect(argv).toEqual(['df', '-k', '.'])
  }
  await $.turn.complete(done())
  await clock.advance(30 * MIN)
  expect(box.procs.length).toBe(2)
})

test('132: a host that cannot run df stops asking', async ($, on) => {
  const { box, clock } = await setup($, on)
  box.dfFails = true
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(60 * MIN)
  expect(box.procs.length).toBe(1)
  expect(box.toasts.length).toBe(0)
})

test('126: the band shows a waiting permission until the call finishes, and renders nothing otherwise', async ($, on) => {
  await setup($, on)

  const quiet = await $.ui.mount(BAND())
  expect(await quiet.find({ type: 'Text', text: /Waiting/ })).toBeUndefined()
  await quiet.unmount()

  await ($ as any).classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  const waiting = await $.ui.mount(BAND())
  expect((await waiting.find({ type: 'Text', text: /Waiting/ }))?.text).toBe('Waiting on you: Bash permission')
  await waiting.unmount()

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const after = await $.ui.mount(BAND())
  expect(await after.find({ type: 'Text', text: /Waiting/ })).toBeUndefined()
  await after.unmount()

  await ($ as any).classic.PermissionRequest({ tool_name: 'Edit', tool_input: {} })
  await prompt($)
  const cleared = await $.ui.mount(BAND())
  expect(await cleared.find({ type: 'Text', text: /Waiting/ })).toBeUndefined()
  await cleared.unmount()
})

test('126: an AskUserQuestion call shows the band while it is unanswered', async ($, on) => {
  const { clock } = await setup($, on, at(12), {}, (b, c) => {
    b.toolImpl = async (e: any) => {
      if (e.tool === 'AskUserQuestion') {
        await c.sleep(5000)
      }

      return { result: {}, text: 'ok' }
    }
  })

  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await clock.advance(1000)
  const ui = await $.ui.mount(BAND())
  expect((await ui.find({ type: 'Text', text: /Waiting/ }))?.text).toBe('Waiting on you: a question')
  await ui.unmount()
  await clock.advance(5000)
  await asking
  const after = await $.ui.mount(BAND())
  expect(await after.find({ type: 'Text', text: /Waiting/ })).toBeUndefined()
  await after.unmount()
})

test('136: a deadline shows in the band only in the last 60 minutes and toasts at 30, 10 and 0', async ($, on) => {
  const { box, clock } = await setup($, on, at(15, 0))
  expect((await cmd($, 'aldeadline', '25:99 x')).text).toMatch(/Usage/)
  expect((await cmd($, 'aldeadline', '17:30 ship it')).text).toMatch(/Deadline "ship it" at 17:30, 2h 30m from now/)

  const early = await $.ui.mount(BAND())
  expect(await early.find({ type: 'Text', text: /left/ })).toBeUndefined()
  await early.unmount()

  await clock.set(at(16, 40))
  const inside = await $.ui.mount(BAND())
  expect((await inside.find({ type: 'Text', text: /left/ }))?.text).toBe('ship it: 50 min left')
  await inside.unmount()
  expect(box.toasts.length).toBe(0)

  await clock.set(at(17, 1))
  expect(texts(box)).toEqual(['ship it: 30 min left'])
  await clock.set(at(17, 21))
  expect(texts(box)).toEqual(['ship it: 30 min left', 'ship it: 10 min left'])
  await clock.set(at(17, 31))
  expect(texts(box)).toEqual(['ship it: 30 min left', 'ship it: 10 min left', 'ship it: time is up'])
  expect((await cmd($, 'aldeadline')).text).toMatch(/No deadline/)
})

test('136: the time-is-up toast is urgent, shows through snooze, and clears the deadline', async ($, on) => {
  const { box, clock } = await setup($, on, at(17, 0))
  await cmd($, 'aldeadline', '17:10 demo')
  await cmd($, 'alsnooze', '120')
  await clock.set(at(17, 11))
  expect(texts(box)).toEqual(['demo: time is up'])
  expect(box.toasts[0]?.timeoutMs).toBe(10_000)
  const ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /left/ })).toBeUndefined()
  await ui.unmount()
  expect((await cmd($, 'aldeadline', 'off')).text).toBe('Deadline cleared.')
})

test('137: check-ins are off by default, then fire once per 90 minutes of continuous activity', async ($, on) => {
  const { box, clock } = await setup($, on)

  for (let i = 0; i < 20; i += 1) {
    await clock.advance(5 * MIN)
    await prompt($)
  }
  expect(texts(box).some(t => /breath/.test(t))).toBe(false)

  expect((await cmd($, 'alcheckin', 'on')).text).toMatch(/Check-ins are on/)
  for (let i = 0; i < 30; i += 1) {
    await clock.advance(5 * MIN)
    await prompt($)
  }
  expect(texts(box).filter(t => /breath/.test(t)).length).toBe(1)
  expect((await cmd($, 'alcheckin', 'off')).text).toMatch(/Check-ins are off/)
})

test('137: a 15 minute gap starts a new stretch, so no check-in follows', async ($, on) => {
  const { box, clock } = await setup($, on)
  await cmd($, 'alcheckin', 'on')

  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      await clock.advance(5 * MIN)
      await prompt($)
    }
    await clock.advance(20 * MIN)
  }
  expect(texts(box).some(t => /breath/.test(t))).toBe(false)
})

test('138: on a Friday the first turn end gives a weekly tool-call summary once', async ($, on) => {
  const friday = at(10, 0, 9)
  const { box, clock } = await setup($, on, friday, { 'alerts.week': { key: weekKey(friday), calls: 40, shownKey: '' } })
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await $.tool.call({ tool: 'Read', file_path: '/b' })
  expect(box.toasts.length).toBe(0)
  await $.turn.complete(done())
  expect(texts(box)).toEqual(['Week so far: 42 tool calls (counted by the alerts mod).'])
  await clock.advance(10 * MIN)
  await $.turn.complete(done())
  expect(texts(box).filter(t => /Week so far/.test(t)).length).toBe(1)
})

test('138: no weekly toast on other days, and a new week starts the counter again', async ($, on) => {
  const { box } = await setup($, on, at(10, 0, 7), { 'alerts.week': { key: '2025-12-29', calls: 99, shownKey: '' } })
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await $.turn.complete(done())
  expect(box.toasts.length).toBe(0)
})

test('/alreset clears what was recorded and /alreset all also restores settings', async ($, on) => {
  const { box } = await setup($, on)
  await cmd($, 'altest', 'notice')
  await cmd($, 'altest', 'info')
  await cmd($, 'almute', 'idle')
  expect((await cmd($, 'alhistory')).text).toContain('[notice/test]')
  expect((await cmd($, 'aldigest')).text).toMatch(/1 pending/)

  expect((await cmd($, 'alreset')).text).toMatch(/^Cleared the history/)
  expect((await cmd($, 'alhistory')).text).toMatch(/No toasts shown/)
  expect((await cmd($, 'aldigest')).text).toMatch(/Nothing pending/)
  expect((await cmd($, 'al')).text).toContain('Muted: idle.')

  expect((await cmd($, 'alreset', 'all')).text).toMatch(/restored every setting/)
  expect((await cmd($, 'al')).text).toContain('Muted: none.')
  expect(box.toasts.length).toBe(1)
})

test('recording never changes a tool call result, and a denied call stays denied', async ($, on) => {
  await setup($, on, at(12), {}, b => {
    b.toolImpl = (e: any) => (e.command === 'deny' ? { deny: 'no' } : { result: { stdout: 'hi' }, text: 'hi' })
  })

  expect(((await $.tool.call({ tool: 'Bash', command: 'echo hi' })) as any).text).toBe('hi')
  expect(((await $.tool.call({ tool: 'Bash', command: 'deny' })) as any).deny).toBe('no')
})

test('the band stays out of the way: nothing waits, nothing is drawn', async ($, on) => {
  await setup($, on, at(12), {}, () => {
    on('ui.render', ($2: any, e: any) => {
      const { Text } = $2.ui.resolve(e)

      return <Text>engine row</Text>
    })
  })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(BAND(surface))
    expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
    expect(await ui.find({ type: 'Text', text: /Waiting|left/ })).toBeUndefined()
    await ui.unmount()
  }
})
