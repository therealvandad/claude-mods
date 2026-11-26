import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import {
  ACTIVE_GAP_MS,
  CATS,
  COST_STEPS,
  DEADLINE_STEPS,
  DEFAULT_CFG,
  DEFAULT_LIMITER,
  DF_ARGV,
  DIGEST_GAP_MS,
  MIN,
  MUTABLE,
  RATE_STEPS,
  addFired,
  addHistory,
  addPending,
  bumpWeek,
  checkinDue,
  costLevel,
  crossedDown,
  crossedUp,
  deadlineText,
  decide,
  digestLines,
  digestSummary,
  firedNums,
  firstWord,
  fmtClock,
  fmtDur,
  historyLines,
  isDiskLow,
  isFailed,
  isFileChange,
  isLevel,
  isNetCall,
  levelSpec,
  minuteOfDay,
  nextOccurrence,
  normalizeCfg,
  normalizeWeek,
  oneLine,
  parseDf,
  parseHm,
  parseQuiet,
  rateLabel,
  rateLevel,
  shouldFlush,
  stretchOf,
  weekKey,
  weeklyDue,
} from './pure'
import type { Decision } from './pure'
import type { Cfg, Level, Limiter, Run } from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]

// Nothing in this mod animates (toasts and one static band row), so it does not read the `motion` flag.

// ---------------------------------------------------------------- state
const cfgAtom = atom({ plugin: 'alerts', key: 'cfg' } as const, DEFAULT_CFG, { shape: 'cfg-1' })
const pendingAtom = atom({ plugin: 'alerts', key: 'pending' } as const, [], { shape: 'pending-1' })
const historyAtom = atom({ plugin: 'alerts', key: 'history' } as const, [], { shape: 'history-1' })
const limiterAtom = atom({ plugin: 'alerts', key: 'limiter' } as const, DEFAULT_LIMITER, { shape: 'limiter-1' })
const statsAtom = atom({ plugin: 'alerts', key: 'stats' } as const, { muted: 0, held: 0, digested: 0, limited: 0 }, { shape: 'stats-1' })
const firedAtom = atom({ plugin: 'alerts', key: 'fired' } as const, [], { shape: 'fired-1' })
const waitingAtom = atom({ plugin: 'alerts', key: 'waiting' } as const, null, { shape: 'waiting-1' })
const tickAtom = atom({ plugin: 'alerts', key: 'tick' } as const, 0)

const FRESH_RUN: Run = {
  promptSeen: false,
  turnRunning: false,
  turnEnd: 0,
  turnMs: 0,
  taskDoneDone: true,
  idleDone: true,
  stretchStart: 0,
  stretchLast: 0,
  checkinDone: false,
  edits: 0,
  editsDone: false,
  netFails: 0,
  netDown: false,
  lastDiskAt: 0,
  diskOff: false,
  usageAt: 0,
  ctxAt: 0,
  calls: 0,
}
const runAtom = atom({ plugin: 'alerts', key: 'run' } as const, FRESH_RUN, { shape: 'run-1' })

const TICK_MS = 15_000
const LONG_TURN_MS = 120_000
const TASKDONE_WAIT_MS = 60_000
const IDLE_MS = 10 * MIN
const LONGRUN_MS = 90_000
const EDIT_LIMIT = 10
const NET_LIMIT = 3
const CONTEXT_LIMIT = 85
const CONTEXT_GAP_MS = 20 * MIN
const DISK_GAP_MS = 10 * MIN
const WAIT_STALE_MS = 30 * MIN

const COMMANDS = [
  ['al', 'Help: every alerts command in one line each, and the current quiet settings', ''],
  ['alsnooze', 'Pause this mod\'s non-urgent notices: /alsnooze 30 (minutes) | off', '<minutes|off>'],
  ['almute', 'Mute one of this mod\'s notice categories: /almute <name> (toggles) | clear. Cannot silence other mods', '<category|clear>'],
  ['alhistory', 'Every toast this mod showed lately: /alhistory [count]', '[count]'],
  ['aldigest', 'Pending low-priority notices: /aldigest | now (send the summary) | clear', '<now|clear>'],
  ['alquiet', 'Quiet hours in local time: /alquiet 22:00-07:00 | off', '<HH:MM-HH:MM|off>'],
  ['aldeadline', 'Countdown: /aldeadline 17:30 <label> | off (band in the last 60 min, toasts at 30/10/0)', '<HH:MM label|off>'],
  ['alcheckin', 'Take-a-breath prompt after 90 minutes of activity: /alcheckin on | off (default off)', '<on|off>'],
  ['alsound', 'Notice sounds: /alsound on | off | test (default off)', '<on|off|test>'],
  ['altest', 'Send a test notice through the notifier: /altest info | notice | urgent', '<info|notice|urgent>'],
  ['alreset', 'Clear everything this mod recorded; /alreset all also restores the settings', '[all]'],
] as const

const safe = async <T,>(run: () => Promise<T> | T, fallback: T): Promise<T> => {
  try {
    return await run()
  } catch {
    return fallback
  }
}

const asInput = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

// ---------------------------------------------------------------- settings

const setCfg = async (d: Dollar, fn: (c: Cfg) => Cfg) => {
  await update(d, cfgAtom, fn)
  const now = await read(d, cfgAtom)
  await safe(() => d.store.set('alerts.cfg', now), undefined)
}

const setRun = (d: Dollar, patch: Partial<Run>) => update(d, runAtom, r => ({ ...r, ...patch }))

// ---------------------------------------------------------------- the notifier (everything goes through here)

type Spec = {
  category: string
  level: Level
  text: string
  via?: 'toast' | 'native'
  isDigest?: boolean
}

type Outcome = { action: Decision['action']; reason: string; isSent: boolean }

const describe = (o: Outcome) =>
  o.action === 'show'
    ? o.isSent
      ? 'shown'
      : 'not sent (no notification channel)'
    : o.action === 'digest'
      ? `queued in the digest (${o.reason})`
      : o.action === 'hold'
        ? `held until quiet ends (${o.reason})`
        : `dropped (${o.reason})`

const notify = async (d: Dollar, spec: Spec): Promise<Outcome> => {
  const now = await d.clock.now()
  const cfg = await read(d, cfgAtom)
  const box: { v?: Decision; before?: Limiter } = {}

  await update(d, limiterAtom, l => {
    box.before = l
    box.v = decide({
      level: spec.level,
      category: spec.category,
      now,
      minute: minuteOfDay(now),
      cfg,
      limiter: l,
      isDigest: spec.isDigest,
    })

    return box.v.limiter
  })
  const verdict = box.v
  const before = box.before

  if (verdict === undefined || before === undefined) {
    return { action: 'drop', reason: 'no decision', isSent: false }
  }
  if (verdict.action === 'drop') {
    const isMute = verdict.reason === 'muted'
    await update(d, statsAtom, s => ({ ...s, muted: s.muted + (isMute ? 1 : 0), limited: s.limited + (isMute ? 0 : 1) }))

    return { action: 'drop', reason: verdict.reason, isSent: false }
  }
  if (verdict.action !== 'show') {
    if (spec.isDigest !== true) {
      await update(d, pendingAtom, list => addPending(list, { t: now, category: spec.category, level: spec.level, text: spec.text, why: verdict.reason }))
      await update(d, statsAtom, s => ({
        ...s,
        held: s.held + (verdict.action === 'hold' ? 1 : 0),
        digested: s.digested + (verdict.action === 'digest' ? 1 : 0),
      }))
    }

    return { action: verdict.action, reason: verdict.reason, isSent: false }
  }
  const lv = levelSpec(spec.level, cfg.sounds)
  let isSent = true

  if (spec.via === 'native') {
    const sent = await safe(() => d.ui.notify(spec.text, { title: 'Claude Code' }), { isSent: false as const, reason: 'refused' as const })
    isSent = sent.isSent

    if (!isSent) {
      // A refused notification does not use up the category or the global allowance.
      await update(d, limiterAtom, l => ({
        ...l,
        last: { ...l.last, [spec.category]: before.last[spec.category] ?? 0 },
        lastShown: before.lastShown,
        lastUrgent: before.lastUrgent,
      }))
    }
  } else {
    d.ui.toast(spec.text, { timeoutMs: lv.timeoutMs })
  }

  if (isSent) {
    if (lv.sound !== null) {
      await safe(() => d.audio.play({ asset: lv.sound as string }), undefined)
    }
    await update(d, historyAtom, list =>
      addHistory(list, {
        t: now,
        category: spec.category,
        level: spec.level,
        text: spec.text,
        via: spec.isDigest === true ? 'digest' : spec.via === 'native' ? 'native' : 'toast',
      }),
    )
  }

  return { action: 'show', reason: verdict.reason, isSent }
}

// 122: one summary toast at most every 10 minutes, never while snoozed or in quiet hours (the notifier decides).
const flushDigest = async (d: Dollar, now: number, isForced: boolean): Promise<string> => {
  const pending = await read(d, pendingAtom)
  const limiter = await read(d, limiterAtom)

  if (pending.length === 0) {
    return 'nothing pending'
  }
  if (!isForced && !shouldFlush(pending, limiter.lastDigest, now)) {
    return 'too soon'
  }
  const out = await notify(d, { category: 'digest', level: 'notice', text: digestSummary(pending), isDigest: true })

  if (out.action === 'show' && out.isSent) {
    await update(d, pendingAtom, () => [])
    await update(d, limiterAtom, l => ({ ...l, lastDigest: now }))
  }

  return describe(out)
}

// ---------------------------------------------------------------- recording activity

const touch = async (d: Dollar, now: number) => {
  await update(d, runAtom, r => {
    const s = stretchOf(r.stretchStart, r.stretchLast, now)

    return { ...r, stretchStart: s.start, stretchLast: s.last, checkinDone: s.isNew ? false : r.checkinDone }
  })
}

const markFired = (d: Dollar, keys: readonly string[]) => update(d, firedAtom, list => addFired(list, keys))

const onPrompt = async (d: Dollar) => {
  const now = await d.clock.now()
  await touch(d, now)
  await setRun(d, { promptSeen: true })
  await update(d, waitingAtom, () => null)
}

const onTurnStart = async (d: Dollar) => {
  const now = await d.clock.now()
  await touch(d, now)
  await setRun(d, { turnRunning: true, edits: 0, editsDone: false })
}

const flushWeek = async (d: Dollar, now: number) => {
  const key = weekKey(now)
  const run = await read(d, runAtom)
  const stored = normalizeWeek(await safe(() => d.store.get('alerts.week'), undefined))
  let week = run.calls > 0 || stored.key !== key ? bumpWeek(stored, key, run.calls) : stored

  if (run.calls > 0) {
    await setRun(d, { calls: 0 })
  }
  if (weeklyDue(week, now)) {
    week = { ...week, shownKey: week.key }
    await safe(() => d.store.set('alerts.week', week), undefined)
    await notify(d, {
      category: 'weekly',
      level: 'notice',
      text: `Week so far: ${week.calls} tool call${week.calls === 1 ? '' : 's'} (counted by the alerts mod).`,
    })

    return
  }
  if (week.key !== stored.key || week.calls !== stored.calls) {
    await safe(() => d.store.set('alerts.week', week), undefined)
  }
}

const onTurnEnd = async (d: Dollar, durationMs: number, isAborted: boolean) => {
  const now = await d.clock.now()
  await touch(d, now)
  await setRun(d, {
    turnRunning: false,
    turnMs: durationMs,
    turnEnd: isAborted ? 0 : now,
    promptSeen: false,
    taskDoneDone: isAborted,
    idleDone: isAborted,
  })
  await update(d, waitingAtom, () => null)
  await flushWeek(d, now)
  await pollUsage(d, now, true)
}

const beforeCall = async (d: Dollar, tool: string, input: Record<string, unknown>, now: number) => {
  await touch(d, now)
  await setRun(d, { calls: (await read(d, runAtom)).calls + 1 })

  if (tool === 'AskUserQuestion') {
    await update(d, waitingAtom, () => ({ kind: 'question' as const, tool, since: now }))
  }
  // 139: ten or more file edits or deletes in one turn, once per turn.
  if (isFileChange(tool, input)) {
    const run = await read(d, runAtom)
    const edits = run.edits + 1
    const isHit = edits >= EDIT_LIMIT && !run.editsDone
    await setRun(d, { edits, editsDone: run.editsDone || isHit })

    if (isHit) {
      await notify(d, {
        category: 'unusual',
        level: 'notice',
        text: `Unusual activity: ${edits} file edits or deletes in this turn. Check /rollback or git status if unexpected.`,
      })
    }
  }
}

const afterCall = async (d: Dollar, tool: string, input: Record<string, unknown>, start: number, ran: unknown, isThrown: boolean) => {
  const end = await d.clock.now()
  const waiting = await read(d, waitingAtom)

  // 126: the call finished, so whatever it waited on was answered.
  if (waiting !== null && waiting.tool === tool) {
    await update(d, waitingAtom, () => null)
  }
  // 131: a Bash call over 90 s. The notice names the command word only, never its arguments.
  if (tool === 'Bash' && end - start >= LONGRUN_MS) {
    const word = typeof input.command === 'string' ? firstWord(input.command) : ''
    await notify(d, {
      category: 'longrun',
      level: 'info',
      text: `A Bash call${word === '' ? '' : ` (${word})`} ended after ${fmtDur(end - start)}.`,
    })
  }
  // 134: three failures in a row from WebFetch or curl.
  if (isNetCall(tool, input)) {
    const failed = isThrown || isFailed(ran)
    const run = await read(d, runAtom)

    if (!failed) {
      await setRun(d, { netFails: 0, netDown: false })
    } else {
      const fails = run.netFails + 1
      const isHit = fails >= NET_LIMIT && !run.netDown
      await setRun(d, { netFails: fails, netDown: run.netDown || isHit })

      if (isHit) {
        await notify(d, {
          category: 'network',
          level: 'notice',
          text: `Network may be down: ${fails} WebFetch/curl calls failed in a row.`,
        })
      }
    }
  }
}

// ---------------------------------------------------------------- usage-based notices (128, 129, 140)

const pollUsage = async (d: Dollar, now: number, isForced: boolean) => {
  const run = await read(d, runAtom)

  if (!isForced && now - run.usageAt < MIN) {
    return
  }
  await setRun(d, { usageAt: now })
  let usage: Awaited<ReturnType<Dollar['session']['usage']>>

  try {
    usage = await d.session.usage()
  } catch {
    return
  }
  const fired = await read(d, firedAtom)
  const usd = usage.cost?.usd

  if (typeof usd === 'number') {
    const c = crossedUp(COST_STEPS, usd, firedNums(fired, 'cost:'))
    await markFired(d, c.mark.map(t => `cost:${t}`))

    if (c.hit !== null) {
      await notify(d, {
        category: 'cost',
        level: costLevel(c.hit),
        text: `Session cost passed $${c.hit} (now $${usd.toFixed(2)}).`,
      })
    }
  }
  for (const limit of usage.rateLimits) {
    const window = `${limit.kind}|${limit.resetsAt ?? ''}`
    const prefix = `rl:${window}:`
    const c = crossedUp(RATE_STEPS, limit.percentUsed, firedNums(await read(d, firedAtom), prefix))
    await markFired(d, c.mark.map(t => `${prefix}${t}`))

    if (c.hit !== null) {
      const resets = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
      await notify(d, {
        category: 'ratelimit',
        level: rateLevel(c.hit),
        text: `${rateLabel(limit.kind)} is ${Math.round(limit.percentUsed)}% used${Number.isFinite(resets) ? ` (resets ${fmtClock(resets)})` : ''}.`,
      })
    }
  }
  const percent = usage.context.percent

  if (typeof percent === 'number' && percent >= CONTEXT_LIMIT && now - run.ctxAt >= CONTEXT_GAP_MS) {
    await setRun(d, { ctxAt: now })
    await notify(d, {
      category: 'context',
      level: 'notice',
      text: `Context window is ${Math.round(percent)}% full. A /compact or a fresh session may help.`,
    })
  }
}

// 132: read-only `df -k .` and nothing else, once per 10 minutes, only while a turn runs.
const diskStep = async (d: Dollar, now: number) => {
  const run = await read(d, runAtom)

  if (!run.turnRunning || run.diskOff || now - run.lastDiskAt < DISK_GAP_MS) {
    return
  }
  await setRun(d, { lastDiskAt: now })

  try {
    const out = await d.process.run([...DF_ARGV], { timeoutMs: 10_000 })
    const free = out.exitCode === 0 ? parseDf(out.stdout) : null

    if (free !== null && isDiskLow(free)) {
      await notify(d, { category: 'disk', level: 'urgent', text: `Disk space is low: ${free.toFixed(1)}% free where this session runs.` })
    }
  } catch {
    await setRun(d, { diskOff: true })
  }
}

// 136: toasts at 30, 10 and 0 minutes; the band segment is drawn by the render hook.
const deadlineStep = async (d: Dollar, now: number, cfg: Cfg) => {
  const dl = cfg.deadline

  if (dl === null) {
    return
  }
  const left = dl.at - now

  if (left < -10 * MIN) {
    await setCfg(d, c => ({ ...c, deadline: null }))

    return
  }
  const prefix = `dl:${dl.at}:`
  const c = crossedDown(DEADLINE_STEPS, left / MIN, firedNums(await read(d, firedAtom), prefix))
  await markFired(d, c.mark.map(t => `${prefix}${t}`))

  if (c.hit !== null) {
    await notify(d, { category: 'deadline', level: c.hit === 0 ? 'urgent' : 'notice', text: deadlineText(dl.label, left) })
  }
  if (c.hit === 0) {
    await setCfg(d, x => ({ ...x, deadline: null }))
  }
  // The band redraws once a minute while a deadline is inside its last hour, and not otherwise.
  const minute = Math.floor(now / MIN)

  if (left > 0 && left <= 60 * MIN && (await read(d, tickAtom)) !== minute) {
    await update(d, tickAtom, () => minute)
  }
}

// ---------------------------------------------------------------- the one timer

let isBusy = false

const tick = async (d: Dollar) => {
  if (isBusy) {
    return
  }
  isBusy = true

  try {
    const now = await d.clock.now()
    const cfg = await read(d, cfgAtom)
    const waiting = await read(d, waitingAtom)

    if (waiting !== null && now - waiting.since > WAIT_STALE_MS) {
      await update(d, waitingAtom, () => null)
    }
    await deadlineStep(d, now, cfg)
    await flushDigest(d, now, false)
    const run = await read(d, runAtom)

    // 127: a long turn ended and nothing was typed for a minute; native notification, once per 10 minutes.
    if (run.turnEnd > 0 && !run.promptSeen && !run.taskDoneDone && now - run.turnEnd >= TASKDONE_WAIT_MS) {
      await setRun(d, { taskDoneDone: true })

      if (run.turnMs > LONG_TURN_MS) {
        await notify(d, {
          category: 'taskdone',
          level: 'notice',
          via: 'native',
          text: `Claude finished after ${fmtDur(run.turnMs)} and is waiting for you.`,
        })
      }
    }
    // 130: a turn ended and nothing was typed for 10 minutes; one toast.
    if (run.turnEnd > 0 && !run.promptSeen && !run.idleDone && now - run.turnEnd >= IDLE_MS) {
      await setRun(d, { idleDone: true })
      await notify(d, { category: 'idle', level: 'notice', text: 'Claude has been waiting 10 minutes since the last turn ended.' })
    }
    // 137: off unless /alcheckin on; one prompt per stretch of activity.
    if (cfg.checkin && !run.checkinDone && now - run.stretchLast < ACTIVE_GAP_MS && checkinDue(run.stretchStart, run.stretchLast)) {
      await setRun(d, { checkinDone: true })
      await notify(d, {
        category: 'checkin',
        level: 'notice',
        text: `You have been at it for ${fmtDur(run.stretchLast - run.stretchStart)}. Time to take a breath?`,
      })
    }
    await pollUsage(d, now, false)
    await diskStep(d, now)
  } catch {
    // A failing check never disturbs the session.
  } finally {
    isBusy = false
  }
}

const startTicker = (d: Dollar) =>
  d.clock.every(TICK_MS, () => {
    void tick(d)
  })

// ---------------------------------------------------------------- commands

const minutesLeft = (ms: number) => Math.max(0, Math.ceil(ms / MIN))

const stateLines = async (d: Dollar, now: number): Promise<string[]> => {
  const cfg = await read(d, cfgAtom)
  const pending = await read(d, pendingAtom)
  const snoozed = now < cfg.snoozeUntil
  const quiet = cfg.quiet !== ''

  return [
    `State: ${snoozed ? `snoozed for ${minutesLeft(cfg.snoozeUntil - now)} more min` : 'not snoozed'}; quiet hours ${quiet ? cfg.quiet : 'off'}; sounds ${cfg.sounds ? 'on' : 'off'}; check-ins ${cfg.checkin ? 'on' : 'off'}.`,
    `Muted: ${cfg.muted.length === 0 ? 'none' : cfg.muted.join(', ')}. Pending in the digest: ${pending.length}.`,
    cfg.deadline === null ? 'Deadline: none.' : `Deadline: ${deadlineText(cfg.deadline.label, cfg.deadline.at - now)} (at ${fmtClock(cfg.deadline.at)}).`,
  ]
}

const helpText = async (d: Dollar) => {
  const now = await d.clock.now()

  return [
    'alerts: one quiet notifier for this mod\'s own notices. Info notices are batched, notice-level ones are rate limited, urgent ones always show.',
    ...COMMANDS.map(([name, description]) => `  /${name}: ${description}`),
    ...(await stateLines(d, now)),
    'Categories (/almute): ' + MUTABLE.join(', ') + '.',
    'Limits: /almute and /alsnooze only affect notices this mod raises; toasts from other mods (and the extras /alerts notification) are not silenced by them. Not built: battery-aware mode (the API exposes no power state).',
  ].join('\n')
}

const snoozeCommand = async (d: Dollar, args: string) => {
  const word = args.trim().toLowerCase()
  const now = await d.clock.now()

  if (word === 'off' || word === '0') {
    await setCfg(d, c => ({ ...c, snoozeUntil: 0 }))

    return { text: 'Snooze off. Held notices go out in the next digest.' }
  }
  if (word !== '') {
    const minutes = Number(word)

    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      return { text: 'Usage: /alsnooze <minutes 1-1440> | off' }
    }
    await setCfg(d, c => ({ ...c, snoozeUntil: now + Math.round(minutes) * MIN }))
  }
  const cfg = await read(d, cfgAtom)

  return {
    text:
      now < cfg.snoozeUntil
        ? `Snoozed until ${fmtClock(cfg.snoozeUntil)} (${minutesLeft(cfg.snoozeUntil - now)} min). Non-urgent notices from this mod are held for the digest; urgent ones still show. Other mods are not affected.`
        : 'Not snoozed. /alsnooze 30 pauses this mod\'s non-urgent notices for 30 minutes.',
  }
}

const muteCommand = async (d: Dollar, args: string) => {
  const word = args.trim().toLowerCase()

  if (word === 'clear') {
    await setCfg(d, c => ({ ...c, muted: [] }))

    return { text: 'Nothing is muted now.' }
  }
  if (word !== '') {
    if (!MUTABLE.includes(word)) {
      return { text: `Unknown category "${word}". Categories: ${MUTABLE.join(', ')}.` }
    }
    await setCfg(d, c => ({ ...c, muted: c.muted.includes(word) ? c.muted.filter(x => x !== word) : [...c.muted, word] }))
  }
  const cfg = await read(d, cfgAtom)

  return {
    text: [
      'Categories of this mod\'s own notices ([x] muted). /almute <name> toggles one. It cannot silence other mods.',
      ...MUTABLE.map(name => `  [${cfg.muted.includes(name) ? 'x' : ' '}] ${name}: ${CATS[name]?.about ?? ''}`),
    ].join('\n'),
  }
}

const historyCommand = async (d: Dollar, args: string) => {
  const n = Math.min(50, Math.max(1, Math.round(Number(args.trim()) || 15)))
  const list = await read(d, historyAtom)
  const stats = await read(d, statsAtom)
  const tail = `Not shown: ${stats.muted} muted, ${stats.held} held for quiet, ${stats.digested} batched, ${stats.limited} rate limited.`

  return { text: list.length === 0 ? `No toasts shown by this mod yet. ${tail}` : [`Last ${Math.min(n, list.length)} toasts from this mod (newest last):`, ...historyLines(list, n), tail].join('\n') }
}

const digestCommand = async (d: Dollar, args: string) => {
  const word = args.trim().toLowerCase()
  const now = await d.clock.now()

  if (word === 'clear') {
    await update(d, pendingAtom, () => [])

    return { text: 'Digest cleared.' }
  }
  if (word === 'now') {
    const result = await flushDigest(d, now, true)

    return { text: `Digest summary: ${result}.` }
  }
  const pending = await read(d, pendingAtom)
  const limiter = await read(d, limiterAtom)
  const next = limiter.lastDigest + DIGEST_GAP_MS

  return {
    text:
      pending.length === 0
        ? 'Nothing pending. Info-level notices, and any notice held by snooze, quiet hours or the one-toast-per-3-minutes limit, collect here.'
        : [`${pending.length} pending (one summary toast at most every 10 min; next possible ${fmtClock(Math.max(next, now))}):`, ...digestLines(pending, now)].join('\n'),
  }
}

const quietCommand = async (d: Dollar, args: string) => {
  const word = args.trim().toLowerCase()

  if (word === 'off') {
    await setCfg(d, c => ({ ...c, quiet: '' }))
  } else if (word !== '') {
    const spec = parseQuiet(word)

    if (spec === null) {
      return { text: 'Usage: /alquiet 22:00-07:00 (local time, 24-hour) | off' }
    }
    await setCfg(d, c => ({ ...c, quiet: spec }))
  }
  const cfg = await read(d, cfgAtom)

  return {
    text:
      cfg.quiet === ''
        ? 'Quiet hours are off. /alquiet 22:00-07:00 holds this mod\'s non-urgent notices in that local-time window.'
        : `Quiet hours ${cfg.quiet} (this machine's local time). Non-urgent notices from this mod wait for the digest; urgent ones still show.`,
  }
}

const deadlineCommand = async (d: Dollar, args: string) => {
  const text = args.trim()
  const now = await d.clock.now()

  if (text.toLowerCase() === 'off') {
    await setCfg(d, c => ({ ...c, deadline: null }))

    return { text: 'Deadline cleared.' }
  }
  if (text !== '') {
    const [time = '', ...rest] = text.split(/\s+/)
    const at = nextOccurrence(now, time)

    if (at === null || parseHm(time) === null) {
      return { text: 'Usage: /aldeadline 17:30 <label> | off (24-hour local time; a time already past means tomorrow)' }
    }
    await setCfg(d, c => ({ ...c, deadline: { at, label: oneLine(rest.join(' '), 60) } }))
  }
  const cfg = await read(d, cfgAtom)

  return {
    text:
      cfg.deadline === null
        ? 'No deadline. /aldeadline 17:30 ship it sets one: a band segment in the last 60 minutes, toasts at 30, 10 and 0.'
        : `Deadline "${cfg.deadline.label === '' ? 'Deadline' : cfg.deadline.label}" at ${fmtClock(cfg.deadline.at)}, ${fmtDur(cfg.deadline.at - now)} from now.`,
  }
}

const onOff = (args: string): boolean | undefined => {
  const word = args.trim().toLowerCase()

  return word === 'on' ? true : word === 'off' ? false : undefined
}

const checkinCommand = async (d: Dollar, args: string) => {
  const to = onOff(args)

  if (to !== undefined) {
    await setCfg(d, c => ({ ...c, checkin: to }))
  }
  const on = (await read(d, cfgAtom)).checkin

  return { text: `Check-ins are ${on ? 'on' : 'off'}: ${on ? 'one gentle toast after 90 minutes of activity (a gap of 15 minutes starts a new stretch).' : '/alcheckin on enables a take-a-breath toast after 90 minutes of activity.'}` }
}

const soundCommand = async (d: Dollar, args: string) => {
  const word = args.trim().toLowerCase()

  if (word === 'test') {
    const ok = await safe(async () => {
      await d.audio.play({ asset: 'sounds/notice.wav' })

      return true
    }, false)

    return { text: ok ? 'Played the notice sound (it plays on notice and urgent toasts only when sounds are on).' : 'The sound could not be played on this surface.' }
  }
  const to = onOff(word)

  if (to !== undefined) {
    await setCfg(d, c => ({ ...c, sounds: to }))
  }
  const on = (await read(d, cfgAtom)).sounds

  return { text: `Sounds are ${on ? 'on' : 'off'}. Notice toasts play a soft tone, urgent ones a three-note tone; info toasts are silent.` }
}

const testCommand = async (d: Dollar, args: string) => {
  const word = args.trim().toLowerCase() || 'notice'

  if (!isLevel(word)) {
    return { text: 'Usage: /altest info | notice | urgent' }
  }
  const out = await notify(d, { category: 'test', level: word, text: `Test ${word} notice from alerts.` })

  return { text: `Test ${word} notice: ${describe(out)}.` }
}

const resetCommand = async (d: Dollar, args: string) => {
  const isAll = args.trim().toLowerCase() === 'all'
  const now = await d.clock.now()
  await update(d, pendingAtom, () => [])
  await update(d, historyAtom, () => [])
  await update(d, statsAtom, () => ({ muted: 0, held: 0, digested: 0, limited: 0 }))
  await update(d, firedAtom, () => [])
  await update(d, waitingAtom, () => null)
  await update(d, limiterAtom, () => ({ ...DEFAULT_LIMITER, lastDigest: now }))
  await update(d, runAtom, r => ({ ...FRESH_RUN, turnRunning: r.turnRunning }))
  await safe(() => d.store.delete('alerts.week'), undefined)

  if (isAll) {
    await update(d, cfgAtom, () => DEFAULT_CFG)
    await safe(() => d.store.delete('alerts.cfg'), undefined)
  }

  return { text: `Cleared the history, digest, once-only flags, counters and this week's tool-call count${isAll ? ', and restored every setting (snooze, quiet hours, mute list, sounds, check-ins, deadline)' : ''}.` }
}

const runCommand = async (d: Dollar, name: string, args: string): Promise<{ text: string }> => {
  switch (name) {
    case 'al':
      return { text: await helpText(d) }
    case 'alsnooze':
      return snoozeCommand(d, args)
    case 'almute':
      return muteCommand(d, args)
    case 'alhistory':
      return historyCommand(d, args)
    case 'aldigest':
      return digestCommand(d, args)
    case 'alquiet':
      return quietCommand(d, args)
    case 'aldeadline':
      return deadlineCommand(d, args)
    case 'alcheckin':
      return checkinCommand(d, args)
    case 'alsound':
      return soundCommand(d, args)
    case 'altest':
      return testCommand(d, args)
    case 'alreset':
      return resetCommand(d, args)
    default:
      return { text: 'Unknown alerts command.' }
  }
}

// ---------------------------------------------------------------- session start

const startSession = async (d: Dollar) => {
  const refused: string[] = []

  for (const [name, description, argumentHint] of COMMANDS) {
    const isOk = await d.command
      .register(argumentHint === '' ? { name, description } : { name, description, argumentHint })
      .then(
        () => true,
        () => false,
      )

    if (!isOk) {
      refused.push(name)
    }
  }
  const now = await safe(() => d.clock.now(), 0)
  const stored = await safe(() => d.store.get('alerts.cfg'), undefined)
  await update(d, cfgAtom, () => normalizeCfg(stored))
  // The first digest summary is due 10 minutes after the session starts, so early notices batch together.
  await update(d, limiterAtom, l => (l.lastDigest === 0 ? { ...l, lastDigest: now } : l))
  await touch(d, now)

  if (refused.length > 0) {
    d.ui.toast(`alerts: /${refused.join(', /')} could not be registered (name taken)`, { timeoutMs: 8000 })
  }
}

// ---------------------------------------------------------------- the mod

export const register: Register = on => {
  let timer: ReturnType<typeof startTicker> | undefined

  on('session.start', async ($, e, next) => {
    await startSession($).catch(() => undefined)
    timer?.cancel()
    timer = startTicker($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = undefined
    await safe(async () => flushWeek($, await $.clock.now()), undefined)

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => runCommand($, name, e.args))
  }

  // 126: a permission dialog is about to ask; cleared when the call finishes, a prompt arrives or the turn ends.
  on('classic.PermissionRequest', async ($, e, next) => {
    await safe(async () => {
      const now = await $.clock.now()
      await update($, waitingAtom, () => ({ kind: 'permission' as const, tool: e.tool_name, since: now }))
    }, undefined)

    return next(e)
  })

  // Recording only: the result of the call is passed through untouched.
  on('tool.call', async ($, e, next) => {
    const input = asInput(e)
    const start = await safe(() => $.clock.now(), 0)
    await safe(() => beforeCall($, e.tool, input, start), undefined)
    let ran: unknown
    let isThrown = false

    try {
      const result = await next(e)
      ran = result

      return result
    } catch (error) {
      isThrown = true
      throw error
    } finally {
      await safe(() => afterCall($, e.tool, input, start, ran, isThrown), undefined)
    }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await safe(() => onTurnStart($), undefined)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await safe(() => onTurnEnd($, e.durationMs, e.isAborted), undefined)
    }

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await safe(() => onPrompt($), undefined)

    return next(e)
  })

  // The one band segment: nothing unless a question or permission waits on the person, or a deadline is within 60 minutes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)

    if (e.props.hasSurvey) {
      return inner
    }
    const now = await safe(() => $.clock.now(), 0)
    const waiting = await read($, waitingAtom)
    const cfg = await read($, cfgAtom)
    await read($, tickAtom)
    const isWaiting = waiting !== null && now - waiting.since <= WAIT_STALE_MS
    const left = cfg.deadline === null ? 0 : cfg.deadline.at - now
    const isDeadline = cfg.deadline !== null && left > 0 && left <= 60 * MIN

    if (!isWaiting && !isDeadline) {
      return inner
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {inner}
        <Box gap="sm">
          {isWaiting && waiting !== null && (
            <Text color="warning" weight="semibold">
              {waiting.kind === 'question' ? 'Waiting on you: a question' : `Waiting on you: ${waiting.tool} permission`}
            </Text>
          )}
          {isDeadline && cfg.deadline !== null && (
            <Text color={left <= 10 * MIN ? 'warning' : 'subtle'}>{deadlineText(cfg.deadline.label, left)}</Text>
          )}
        </Box>
      </Box>
    )
  })
}
