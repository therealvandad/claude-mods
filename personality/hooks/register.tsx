import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

// Global reduced-motion switch: owned by the `motion` mod (`/motion on|off`).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)

import {
  BADGES,
  IDLE_MS,
  SLEEP_MS,
  TICK_MS,
  TIPS,
  addTool,
  badgeToastText,
  badgesText,
  bar,
  cleanDays,
  dayKey,
  emptyDay,
  enqueue,
  frameOf,
  greetingText,
  hourOf,
  moodOf,
  newBadges,
  parseSprint,
  petFrame,
  petStateOf,
  pickToast,
  plural,
  pruneDays,
  sprintLogText,
  sprintToast,
  statusPlan,
  statusText,
  streakOf,
  streakText,
  tipIndexFor,
  weekOf,
  weeklyText,
} from './logic'
import type { Days, Pending, SprintRecord, SprintState, StatusMemo, ToolEvent } from './logic'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PET = 'personality-pet'
const WEEKLY = 'personality-weekly'

// What the panes draw from. Scalars only: a hot reload keeps them.
const nowAtom = atom({ plugin: 'personality', key: 'now' } as const, 0)
const lastAt = atom({ plugin: 'personality', key: 'lastAt' } as const, 0)
const running = atom({ plugin: 'personality', key: 'running' } as const, 0)
const happyUntil = atom({ plugin: 'personality', key: 'happyUntil' } as const, 0)
const rev = atom({ plugin: 'personality', key: 'rev' } as const, 0)

type Meta = {
  lifetime: number
  lastToastAt: number
  lastGreetingAt: number
  tipDay: string
  tipIdx: number
  best: number
}
type Cache = {
  days: Days
  badges: Record<string, number>
  meta: Meta
  sprints: SprintRecord[]
  sprint: SprintState | null
  fun: boolean
  motion: boolean
}
type Dirty = 'days' | 'meta' | 'sprint' | 'badges'

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const MINUTE = 60_000
const GREETING_GAP_MS = 2 * 60 * MINUTE

// Module state: lost at a hot reload, rebuilt lazily from $.store by `readData`.
let cache: Cache | undefined
let loading: Promise<Cache> | undefined
let events: ToolEvent[] = []
let queue: Pending[] = []
let sessionFiles = new Set<string>()
let lastStatus: StatusMemo = { text: undefined, at: 0 }
let lastSave = -Infinity
const dirty = new Set<Dirty>()
let ticker: Timer | undefined
let statusTimer: Timer | undefined
let sleepTimer: Timer | undefined
let flushTimer: Timer | undefined
let sprintTimer: Timer | undefined

// ------------------------------------------------------------ pure cleaners

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const cleanMeta = (raw: unknown): Meta => {
  const m = isObj(raw) ? raw : {}

  return {
    lifetime: num(m.lifetime),
    lastToastAt: num(m.lastToastAt),
    lastGreetingAt: num(m.lastGreetingAt),
    tipDay: str(m.tipDay),
    tipIdx: num(m.tipIdx, -1),
    best: num(m.best),
  }
}

const cleanBadges = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {}

  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && BADGES.some(b => b.id === k)) {
        out[k] = v
      }
    }
  }

  return out
}

const cleanSprint = (raw: unknown): SprintState | null =>
  isObj(raw) && typeof raw.endsAt === 'number'
    ? {
        startedAt: num(raw.startedAt),
        endsAt: num(raw.endsAt),
        minutes: num(raw.minutes, 25),
        goal: str(raw.goal),
        files: strings(raw.files),
        tools: num(raw.tools),
      }
    : null

const cleanSprints = (raw: unknown): SprintRecord[] =>
  Array.isArray(raw)
    ? raw.filter(isObj).map(s => ({
        goal: str(s.goal),
        minutes: num(s.minutes),
        startedAt: num(s.startedAt),
        endedAt: num(s.endedAt),
        files: strings(s.files),
        tools: num(s.tools),
        isDone: s.isDone === true,
      }))
    : []

// ----------------------------------------------------------------- storage

const readData = (d: Dollar): Promise<Cache> => {
  if (cache !== undefined) {
    return Promise.resolve(cache)
  }
  loading ??= (async () => {
    const [days, badges, meta, sprints, sprint, fun, motion] = await Promise.all(
      ['days', 'badges', 'meta', 'sprints', 'sprint', 'fun', 'motion'].map(k => d.store.get(k)),
    )
    const loaded: Cache = {
      days: cleanDays(days),
      badges: cleanBadges(badges),
      meta: cleanMeta(meta),
      sprints: cleanSprints(sprints),
      sprint: cleanSprint(sprint),
      fun: fun !== false,
      motion: motion !== false && (await read(d, motionIsOn)),
    }
    cache = loaded

    return loaded
  })().finally(() => {
    loading = undefined
  })

  return loading
}

// Like readData, and puts back a sprint that was running before a reload.
const load = async (d: Dollar): Promise<Cache> => {
  const c = await readData(d)

  if (c.sprint !== null && sprintTimer === undefined) {
    await armSprint(d)
  }

  return c
}

const saveIfDue = async (d: Dollar, now: number, force = false) => {
  if (dirty.size === 0 || (!force && now - lastSave < 3000)) {
    return
  }
  const c = await readData(d)
  const keys = [...dirty]
  dirty.clear()
  lastSave = now

  for (const k of keys) {
    await d.store.set(k, k === 'days' ? c.days : k === 'meta' ? c.meta : k === 'sprint' ? c.sprint : c.badges)
  }
}

const bump = (d: Dollar) => update(d, rev, n => n + 1)

// ------------------------------------------------------------------- toasts

const flushToasts = async (d: Dollar) => {
  const c = await readData(d)
  const now = await d.clock.now()

  if (!c.fun) {
    queue = []

    return
  }
  const { toast, rest, waitMs } = pickToast(queue, now, c.meta.lastToastAt)
  queue = rest

  if (toast !== undefined) {
    c.meta.lastToastAt = now

    if (toast.kind === 'tip') {
      c.meta.tipDay = dayKey(now)
    }

    if (toast.kind === 'greeting') {
      c.meta.lastGreetingAt = now
    }
    dirty.add('meta')
    await saveIfDue(d, now, true)
    d.ui.toast(toast.text, { timeoutMs: 6000 })
  }
  flushTimer?.cancel()
  flushTimer = undefined

  if (queue.length > 0) {
    flushTimer = d.clock.after(Math.max(1000, waitMs) + 500, () => {
      flushTimer = undefined
      void flushToasts(d)
    })
  }
}

const pushToast = async (d: Dollar, item: Omit<Pending, 'at'>) => {
  queue = enqueue(queue, { ...item, at: await d.clock.now() })
  await flushToasts(d)
}

// ------------------------------------------------------------------- badges

const checkBadges = async (d: Dollar, c: Cache, now: number) => {
  if (!c.fun) {
    return
  }
  const got = newBadges(
    {
      days: c.days,
      today: dayKey(now),
      lifetimeTools: c.meta.lifetime,
      sessionFiles: sessionFiles.size,
      hour: hourOf(now),
      sprintsDone: c.sprints.filter(s => s.isDone).length,
    },
    c.badges,
  )

  if (got.length === 0) {
    return
  }

  for (const b of got) {
    c.badges[b.id] = now
  }
  dirty.add('badges')
  const names = got.map(b => b.name)
  await pushToast(d, { kind: 'badge', priority: 2, ttlMs: 60 * MINUTE, names, text: badgeToastText(names) })
}

// --------------------------------------------------------------------- mood

const clearStatus = (d: Dollar) => {
  if (lastStatus.text !== undefined) {
    d.ui.status(undefined)
  }
  lastStatus = { text: undefined, at: lastStatus.at }
}

const refreshMood = async (d: Dollar, c: Cache, now: number) => {
  statusTimer?.cancel()
  statusTimer = undefined

  if (!c.fun) {
    clearStatus(d)

    return
  }
  events = events.filter(e => now - e.at <= 10 * MINUTE).slice(-60)
  const mood = moodOf(events, now)
  const text = mood === null ? undefined : statusText(mood)
  const plan = statusPlan(lastStatus, text, now)

  if (plan === 'set') {
    d.ui.status(text)
    lastStatus = { text, at: now }
  } else if (plan === 'clear') {
    clearStatus(d)
  }
  // Quiet when idle: the status goes away if nothing happens for a while.
  statusTimer = d.clock.after(IDLE_MS + 1000, () => {
    statusTimer = undefined
    clearStatus(d)
    void saveIfDue(d, now + IDLE_MS, true)
  })
}

// ---------------------------------------------------------------------- pet

const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
}

const startTicker = async (d: Dollar) => {
  stopTicker()
  const c = await readData(d)

  if (!c.fun || !c.motion) {
    return
  }
  // Runs only while the pane is open: the ui.close hook below stops it.
  ticker = d.clock.every(TICK_MS, () => {
    void d.clock.now().then(t => update(d, nowAtom, () => t))
  })
}

const isPetOpen = async (d: Dollar) => {
  try {
    return (await d.ui.panes()).some(p => p.id === PET)
  } catch {
    return false
  }
}

// One timer, moved at each bit of activity, so a still pet falls asleep on its own.
const touch = async (d: Dollar, now: number) => {
  await update(d, lastAt, () => now)
  await update(d, nowAtom, () => now)
  sleepTimer?.cancel()
  sleepTimer = d.clock.after(SLEEP_MS + 1000, () => {
    sleepTimer = undefined
    void d.clock.now().then(t => update(d, nowAtom, () => t))
  })
}

const setMotion = async (d: Dollar, value: boolean) => {
  const c = await readData(d)
  c.motion = value
  await d.store.set('motion', value)

  if (!value) {
    stopTicker()
  } else if (await isPetOpen(d)) {
    await startTicker(d)
  }
  await bump(d)
}

const setFun = async (d: Dollar, value: boolean) => {
  const c = await readData(d)
  c.fun = value
  await d.store.set('fun', value)

  if (value) {
    if (await isPetOpen(d)) {
      await startTicker(d)
    }
  } else {
    stopTicker()
    clearStatus(d)
    statusTimer?.cancel()
    statusTimer = undefined
    queue = []
  }
  await bump(d)
}

// ------------------------------------------------------------------- sprint

const armSprint = async (d: Dollar) => {
  const c = await readData(d)
  const s = c.sprint

  if (s === null) {
    return
  }
  sprintTimer?.cancel()
  const wait = s.endsAt - (await d.clock.now())

  if (wait <= 0) {
    sprintTimer = undefined
    await endSprint(d, 'late')

    return
  }
  sprintTimer = d.clock.after(wait, () => {
    sprintTimer = undefined
    void endSprint(d, 'done')
  })
}

const endSprint = async (d: Dollar, how: 'done' | 'late' | 'stopped') => {
  const c = await readData(d)
  const s = c.sprint

  if (s === null) {
    return
  }
  c.sprint = null
  sprintTimer?.cancel()
  sprintTimer = undefined
  const now = await d.clock.now()
  const rec: SprintRecord = {
    goal: s.goal,
    minutes: how === 'stopped' ? Math.max(1, Math.round((now - s.startedAt) / MINUTE)) : s.minutes,
    startedAt: s.startedAt,
    endedAt: how === 'late' ? s.endsAt : now,
    files: s.files,
    tools: s.tools,
    isDone: how !== 'stopped',
  }
  c.sprints = [...c.sprints, rec].slice(-50)
  await d.store.set('sprints', c.sprints)
  await d.store.set('sprint', null)
  dirty.delete('sprint')

  if (how === 'done' && c.fun) {
    await pushToast(d, {
      kind: 'sprint',
      priority: 3,
      ttlMs: 60 * MINUTE,
      text: sprintToast(rec, c.sprints.length),
    })
    await checkBadges(d, c, now)
    await saveIfDue(d, now, true)
  }
  await bump(d)
}

// ------------------------------------------------------------- tool tracking

const detailOf = (input: Record<string, unknown>): string =>
  String(input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)

const noteStart = async (d: Dollar) => {
  try {
    await update(d, running, n => n + 1)
    await touch(d, await d.clock.now())
  } catch {
    // Never let a flourish get in the way of a tool call.
  }
}

const noteDone = async (d: Dollar, tool: string, detail: string, path: string, outcome: 'ok' | 'error' | 'denied') => {
  try {
    await update(d, running, n => Math.max(0, n - 1))

    if (outcome === 'denied') {
      return
    }
    const c = await load(d)
    const now = await d.clock.now()
    const ok = outcome === 'ok'
    const today = dayKey(now)
    const day = (c.days[today] ??= emptyDay())
    const isEdit = ok && EDIT_TOOLS.has(tool) && path !== ''
    addTool(day, tool, ok, isEdit ? path : undefined)
    c.meta.lifetime++
    dirty.add('days')
    dirty.add('meta')
    events.push({ at: now, ok, tool, detail, isEdit })

    if (isEdit) {
      sessionFiles.add(path)
      c.meta.best = Math.max(c.meta.best, streakOf(c.days, today).best)
    }

    if (c.sprint !== null) {
      c.sprint.tools++

      if (isEdit && !c.sprint.files.includes(path)) {
        c.sprint.files.push(path)
      }
      dirty.add('sprint')
    }
    await touch(d, now)
    await refreshMood(d, c, now)
    await checkBadges(d, c, now)
    await saveIfDue(d, now)
    await bump(d)
  } catch {
    // Bookkeeping only: a failure here must never reach the tool call.
  }
}

const afterTurn = async (d: Dollar, isAnswer: boolean) => {
  try {
    const c = await load(d)
    const now = await d.clock.now()
    await touch(d, now)

    if (c.fun && isAnswer && events[events.length - 1]?.ok !== false) {
      await update(d, happyUntil, () => now + 10_000)
      d.clock.after(10_500, () => {
        void d.clock.now().then(t => update(d, nowAtom, () => t))
      })
    }
    await checkBadges(d, c, now)
    await saveIfDue(d, now, true)
    await flushToasts(d)
    await bump(d)
  } catch {
    // See noteDone.
  }
}

const startSession = async (d: Dollar) => {
  const c = await load(d)
  const now = await d.clock.now()
  const today = dayKey(now)
  c.days = pruneDays(c.days, today)
  const day = (c.days[today] ??= emptyDay())
  day.sessions++
  dirty.add('days')
  await saveIfDue(d, now, true)
  events = []
  queue = []
  sessionFiles = new Set()
  lastStatus = { text: undefined, at: 0 }
  await update(d, running, () => 0)
  await update(d, happyUntil, () => 0)
  await touch(d, now)

  if (c.fun) {
    if (now - c.meta.lastGreetingAt >= GREETING_GAP_MS) {
      await pushToast(d, {
        kind: 'greeting',
        priority: 4,
        ttlMs: 30 * MINUTE,
        text: greetingText(hourOf(now), c.days, today),
      })
    }

    if (c.meta.tipDay !== today) {
      await pushToast(d, {
        kind: 'tip',
        priority: 1,
        ttlMs: 60 * MINUTE,
        text: `Tip: ${TIPS[tipIndexFor(today)]}`,
      })
    }
  }
}

// ----------------------------------------------------------------- commands

const COMMANDS = [
  ['fun', 'Switch the quiet fun on or off: /fun on, /fun off, /fun motion on|off'],
  ['streak', 'Show your edit streak: days in a row with a file edit'],
  ['badges', 'List achievement badges and your progress'],
  ['pet', 'Open the little pet pane (/pet off to close it)'],
  ['tip', 'Show another tip about Claude Code'],
  ['sprint', 'Focus sprint: /sprint <minutes> <what you will do> (also: stop, status)'],
  ['sprintlog', 'List your recent focus sprints'],
  ['weekly', 'Report on the last 7 days (/weekly pane opens it as a pane)'],
] as const

const onOff = (arg: string): boolean | undefined => (/^(on|true|yes|1)$/i.test(arg) ? true : /^(off|false|no|0)$/i.test(arg) ? false : undefined)

const cmdFun = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const [first = '', second = ''] = args.trim().split(/\s+/)

  if (first.toLowerCase() === 'motion') {
    const v = onOff(second)

    if (v === undefined) {
      return `Motion is ${c.motion ? 'on' : 'off'}. /fun motion on|off`
    }
    await setMotion(d, v)

    return `Motion ${v ? 'on' : 'off'}.`
  }
  const v = onOff(first)

  if (v === undefined) {
    return `Fun is ${c.fun ? 'on' : 'off'}, motion is ${c.motion ? 'on' : 'off'}. Use /fun on or /fun off.`
  }
  await setFun(d, v)

  return v ? 'Fun is on: mood status, badges, greeting, tips and the pet are back.' : 'Fun is off: no toasts, status, badges or pet. Stats are still counted for /weekly and /streak.'
}

const cmdMotion = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const v = onOff(args.trim())

  if (v === undefined) {
    return `Motion is ${c.motion ? 'on' : 'off'}. /motion on|off`
  }
  await setMotion(d, v)

  return `Motion ${v ? 'on' : 'off'}.`
}

const cmdStreak = async (d: Dollar) => {
  const c = await load(d)

  return streakText(c.days, dayKey(await d.clock.now()), c.meta.best)
}

const cmdBadges = async (d: Dollar) => badgesText((await load(d)).badges)

const cmdTip = async (d: Dollar) => {
  const c = await load(d)
  const today = dayKey(await d.clock.now())
  const next = ((c.meta.tipIdx >= 0 ? c.meta.tipIdx : tipIndexFor(today)) + 1) % TIPS.length
  c.meta.tipIdx = next
  dirty.add('meta')
  await saveIfDue(d, await d.clock.now(), true)

  return `Tip ${next + 1} of ${TIPS.length}: ${TIPS[next]}`
}

const cmdPet = async (d: Dollar, args: string) => {
  const c = await load(d)

  if (/^(off|close|stop)$/i.test(args.trim())) {
    stopTicker()
    await d.ui.close({ id: PET })

    return 'Pet pane closed.'
  }

  if (!c.fun) {
    return 'Fun is off. Type /fun on first.'
  }
  const opened = await d.ui.open({ id: PET, title: 'Pet' })
  await startTicker(d)

  return opened.isPlaced ? 'Pet pane opened.' : `The pet is waiting for room: ${opened.reason}`
}

const cmdSprint = async (d: Dollar, args: string) => {
  const c = await load(d)
  const now = await d.clock.now()
  const arg = args.trim()
  const s = c.sprint

  if (/^stop$/i.test(arg)) {
    if (s === null) {
      return 'No sprint is running.'
    }
    await endSprint(d, 'stopped')

    return 'Sprint stopped and logged.'
  }

  if (arg === '' || /^status$/i.test(arg)) {
    if (s === null) {
      return 'No sprint running. /sprint <minutes> <what you will do>'
    }

    return `Sprint: "${s.goal}", ${Math.max(0, Math.ceil((s.endsAt - now) / MINUTE))} min left, ${plural(s.files.length, 'file')} changed so far.`
  }

  if (!c.fun) {
    return 'Fun is off, so sprints are too. Type /fun on first.'
  }

  if (s !== null) {
    return `A sprint is already running ("${s.goal}"). /sprint stop ends it.`
  }
  const parsed = parseSprint(arg)

  if (parsed === undefined) {
    return 'Usage: /sprint <minutes 1-240> <what you will do>, for example /sprint 25 write the parser'
  }
  c.sprint = {
    startedAt: now,
    endsAt: now + parsed.minutes * MINUTE,
    minutes: parsed.minutes,
    goal: parsed.goal,
    files: [],
    tools: 0,
  }
  dirty.add('sprint')
  await saveIfDue(d, now, true)
  await armSprint(d)
  await bump(d)

  return `Sprint started: ${parsed.minutes} min on "${parsed.goal}". I will cheer at the end.`
}

const cmdSprintLog = async (d: Dollar) => sprintLogText((await load(d)).sprints)

const cmdWeekly = async (d: Dollar, args: string) => {
  const c = await load(d)
  const today = dayKey(await d.clock.now())

  if (/^pane$/i.test(args.trim())) {
    const opened = await d.ui.open({ id: WEEKLY, title: 'Weekly' })

    return opened.isPlaced ? 'Weekly pane opened.' : `The weekly pane is waiting for room: ${opened.reason}`
  }

  return weeklyText(weekOf(c.days, today), c.days, c.meta.best)
}

// ----------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await startSession($).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    for (const t of [ticker, statusTimer, sleepTimer, flushTimer]) {
      t?.cancel()
    }
    ticker = statusTimer = sleepTimer = flushTimer = undefined
    clearStatus($)
    await saveIfDue($, await $.clock.now(), true).catch(() => undefined)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await touch($, await $.clock.now()).catch(() => undefined)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const detail = detailOf(input)
    const path = String(input.file_path ?? input.notebook_path ?? '')
    await noteStart($)
    let ran

    try {
      ran = await next(e)
    } catch (err) {
      await noteDone($, tool, detail, path, 'error')
      throw err
    }
    const result = ran as { deny?: string; isError?: boolean }
    await noteDone($, tool, detail, path, result.deny !== undefined ? 'denied' : result.isError === true ? 'error' : 'ok')

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    await afterTurn($, e.reason === 'answer')

    return next(e)
  })

  on('ui.close', { id: PET }, async ($, e, next) => {
    stopTicker()

    return next(e)
  })

  on('command.run', { command: 'fun' }, async ($, e) => ({ text: await cmdFun($, e.args) }))
  on('command.run', { command: 'streak' }, async $ => ({ text: await cmdStreak($) }))
  on('command.run', { command: 'badges' }, async $ => ({ text: await cmdBadges($) }))
  on('command.run', { command: 'tip' }, async $ => ({ text: await cmdTip($) }))
  on('command.run', { command: 'pet' }, async ($, e) => ({ text: await cmdPet($, e.args) }))
  on('command.run', { command: 'sprint' }, async ($, e) => ({ text: await cmdSprint($, e.args) }))
  on('command.run', { command: 'sprintlog' }, async $ => ({ text: await cmdSprintLog($) }))
  on('command.run', { command: 'weekly' }, async ($, e) => ({ text: await cmdWeekly($, e.args) }))

  on('ui.render', { component: 'Pane', requestId: PET }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await readData($)
    await read($, rev)

    if (!c.fun) {
      return (
        <Box padding="sm">
          <Text dimColor>Fun is off. Type /fun on to wake the pet.</Text>
        </Box>
      )
    }
    const last = await read($, lastAt)
    const state = petStateOf({
      now: Math.max(await read($, nowAtom), last),
      lastAt: last,
      running: await read($, running),
      happyUntil: await read($, happyUntil),
    })
    const now = Math.max(await read($, nowAtom), last)
    const pet = petFrame(state, frameOf(now, c.motion))

    return (
      <Box flexDirection="column" padding="sm" gap="sm">
        <Box flexDirection="column">
          {pet.lines.map(line => (
            <Text mono color="claude">
              {line}
            </Text>
          ))}
        </Box>
        <Text dimColor>
          {pet.caption}
          {c.motion ? '' : ' (still)'}
        </Text>
        <Box gap="sm">
          <Button key="motion" label={c.motion ? 'Hold still' : 'Animate'} onPress={() => setMotion($, !c.motion)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: WEEKLY }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const c = await readData($)
    await read($, rev)
    const today = dayKey(await $.clock.now())
    const week = weekOf(c.days, today)
    const streak = streakOf(c.days, today)
    const maxDay = Math.max(1, ...week.rows.map(r => r.tools))
    const maxTool = Math.max(1, ...week.topTools.map(([, n]) => n))
    const t = week.totals

    const Tile = (label: string, value: string) => (
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm" flexGrow={1}>
        <Text size="caption" dimColor>
          {label}
        </Text>
        <Text size="heading" weight="bold" tabular>
          {value}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column" padding="sm">
        <Text size="heading" weight="bold">
          Last 7 days
        </Text>
        <Box gap="sm" marginTop="sm">
          {Tile('Sessions', String(t.sessions))}
          {Tile('Tool calls', String(t.tools))}
          {Tile('Files', String(t.files))}
          {Tile('Streak', `${streak.current}d`)}
        </Box>
        <Box marginTop="md">
          <Text size="caption" weight="semibold" dimColor>
            TOOL CALLS PER DAY
          </Text>
        </Box>
        {week.rows.map(r => (
          <Box gap="sm">
            <Text dimColor mono>
              {r.label}
            </Text>
            <Text mono color={r.day === today ? 'claude' : 'suggestion'}>
              {bar(r.tools / maxDay, 16)}
            </Text>
            <Text mono tabular>
              {String(r.tools).padStart(4)}
            </Text>
          </Box>
        ))}
        <Box marginTop="md">
          <Text size="caption" weight="semibold" dimColor>
            TOP TOOLS
          </Text>
        </Box>
        {week.topTools.length === 0 && <Text dimColor>Nothing recorded yet.</Text>}
        {week.topTools.map(([tool, n]) => (
          <Box gap="sm">
            <Text mono color="suggestion">
              {bar(n / maxTool, 10)}
            </Text>
            <Text>{tool}</Text>
            <Text dimColor tabular>
              {n}
            </Text>
          </Box>
        ))}
        {t.errors > 0 && (
          <Box marginTop="md">
            <Text dimColor>
              {plural(t.errors, 'failed call')} this week, {Math.round((t.errors / Math.max(1, t.tools)) * 100)}% of all calls.
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
