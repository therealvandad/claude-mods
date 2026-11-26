import type { Cfg, HistoryRow, Level, Limiter, Pending } from '../types'

// Everything here is a pure function: no `$`, no clock, no state. The notifier in register.tsx only calls these.

export const MIN = 60_000

export const GLOBAL_GAP_MS = 3 * MIN // at most one non-urgent toast from this mod per 3 minutes
export const URGENT_GAP_MS = 20_000 // an urgent notice may not follow another urgent one within 20 s
export const DIGEST_GAP_MS = 10 * MIN // at most one digest summary per 10 minutes
export const KEEP_PENDING = 30
export const KEEP_HISTORY = 50
export const KEEP_FIRED = 80

// ---------------------------------------------------------------- categories and levels

type CategoryInfo = { gap: number; about: string }

// `gap` is the least time between two shown notices of one category.
export const CATS: Record<string, CategoryInfo> = {
  taskdone: { gap: 10 * MIN, about: 'a long turn ended and no prompt followed (native notification)' },
  ratelimit: { gap: 0, about: 'rate-limit window crossed 70, 85, 95 percent' },
  cost: { gap: 0, about: 'session cost milestones ($1, $5, $10, $25, $50, $100)' },
  idle: { gap: 10 * MIN, about: 'a turn finished and nothing was typed for 10 minutes' },
  longrun: { gap: 2 * MIN, about: 'a Bash call over 90 s ended' },
  disk: { gap: 30 * MIN, about: 'free disk space under 5 percent' },
  network: { gap: 10 * MIN, about: '3 WebFetch/curl failures in a row' },
  deadline: { gap: 0, about: '/aldeadline countdown at 30, 10 and 0 minutes' },
  checkin: { gap: 60 * MIN, about: 'take-a-breath prompt after 90 minutes of activity (/alcheckin)' },
  weekly: { gap: 0, about: 'Friday summary of this week\'s tool calls' },
  unusual: { gap: 5 * MIN, about: '10 or more file edits or deletes in one turn' },
  context: { gap: 20 * MIN, about: 'context window over 85 percent' },
  digest: { gap: 0, about: 'the batched summary of low-priority notices' },
  test: { gap: 0, about: '/altest' },
}

export const MUTABLE: string[] = Object.keys(CATS).filter(name => name !== 'test')

export const isLevel = (value: unknown): value is Level => value === 'info' || value === 'notice' || value === 'urgent'

export type LevelSpec = { timeoutMs: number; sound: string | null }

// 121: the one place that turns a level into a toast duration and a sound. Sounds are off unless `soundsOn`.
export const levelSpec = (level: Level, soundsOn: boolean): LevelSpec => {
  if (level === 'urgent') {
    return { timeoutMs: 10_000, sound: soundsOn ? 'sounds/urgent.wav' : null }
  }
  if (level === 'notice') {
    return { timeoutMs: 6000, sound: soundsOn ? 'sounds/notice.wav' : null }
  }

  return { timeoutMs: 3500, sound: null }
}

// ---------------------------------------------------------------- formatting

const pad = (n: number) => String(n).padStart(2, '0')

export const fmtDur = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))

  if (total < 60) {
    return `${total}s`
  }
  if (total < 3600) {
    return `${Math.floor(total / 60)}m ${pad(total % 60)}s`
  }

  return `${Math.floor(total / 3600)}h ${pad(Math.floor((total % 3600) / 60))}m`
}

export const fmtClock = (ms: number): string => {
  const d = new Date(ms)

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fmtClockSec = (ms: number): string => `${fmtClock(ms)}:${pad(new Date(ms).getSeconds())}`

export const oneLine = (text: string, max = 90): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// ---------------------------------------------------------------- time of day (135, 136)

// Minutes since local midnight of an epoch-ms time (the time zone is the machine's).
export const minuteOfDay = (ms: number): number => {
  const d = new Date(ms)

  return d.getHours() * 60 + d.getMinutes()
}

export const parseHm = (text: string): number | null => {
  const hit = /^(\d{1,2}):(\d{2})$/.exec(text.trim())

  if (hit === null) {
    return null
  }
  const h = Number(hit[1])
  const m = Number(hit[2])

  return h < 24 && m < 60 ? h * 60 + m : null
}

const hmText = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`

// '22:00-07:00' -> normalized '22:00-07:00', or null when it is not a window (or start equals end).
export const parseQuiet = (text: string): string | null => {
  const parts = text.split('-')

  if (parts.length !== 2) {
    return null
  }
  const start = parseHm(parts[0] ?? '')
  const end = parseHm(parts[1] ?? '')

  return start === null || end === null || start === end ? null : `${hmText(start)}-${hmText(end)}`
}

// True when `minute` is inside the window; a window that crosses midnight (22:00-07:00) wraps.
export const inQuiet = (spec: string, minute: number): boolean => {
  const norm = parseQuiet(spec)

  if (norm === null) {
    return false
  }
  const [a, b] = norm.split('-')
  const start = parseHm(a ?? '') ?? 0
  const end = parseHm(b ?? '') ?? 0

  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

// The next local HH:MM after `nowMs` (today if still ahead, else tomorrow), as epoch ms.
export const nextOccurrence = (nowMs: number, hm: string): number | null => {
  const minute = parseHm(hm)

  if (minute === null) {
    return null
  }
  const d = new Date(nowMs)
  d.setHours(Math.floor(minute / 60), minute % 60, 0, 0)

  if (d.getTime() <= nowMs) {
    d.setDate(d.getDate() + 1)
  }

  return d.getTime()
}

// Monday (local) of the week `ms` is in, as YYYY-MM-DD.
export const weekKey = (ms: number): string => {
  const d = new Date(ms)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const isFriday = (ms: number): boolean => new Date(ms).getDay() === 5

// ---------------------------------------------------------------- settings

export const DEFAULT_CFG: Cfg = { snoozeUntil: 0, quiet: '', muted: [], sounds: false, checkin: false, deadline: null }

export const DEFAULT_LIMITER: Limiter = { last: {}, lastShown: 0, lastUrgent: 0, lastDigest: 0 }

// Reads what the store holds (anything at all) into a safe Cfg.
export const normalizeCfg = (raw: unknown): Cfg => {
  if (raw === null || typeof raw !== 'object') {
    return DEFAULT_CFG
  }
  const r = raw as Record<string, unknown>
  const dl = r.deadline as Record<string, unknown> | null | undefined
  const quiet = typeof r.quiet === 'string' ? (parseQuiet(r.quiet) ?? '') : ''

  return {
    snoozeUntil: typeof r.snoozeUntil === 'number' && Number.isFinite(r.snoozeUntil) ? r.snoozeUntil : 0,
    quiet,
    muted: Array.isArray(r.muted) ? r.muted.filter((x): x is string => typeof x === 'string' && MUTABLE.includes(x)) : [],
    sounds: r.sounds === true,
    checkin: r.checkin === true,
    deadline:
      dl !== null && dl !== undefined && typeof dl === 'object' && typeof dl.at === 'number' && Number.isFinite(dl.at)
        ? { at: dl.at, label: typeof dl.label === 'string' ? oneLine(dl.label, 60) : '' }
        : null,
  }
}

// ---------------------------------------------------------------- 122, 123, 124, 135: the one decision

export type Decision = {
  // show: raise it now. digest: queue it for the summary. hold: queue it because the person asked for quiet.
  // drop: throw it away (muted, or the same category fired too recently).
  action: 'show' | 'digest' | 'hold' | 'drop'
  reason: string
  limiter: Limiter
}

export type DecideInput = {
  level: Level
  category: string
  now: number
  minute: number
  cfg: Cfg
  limiter: Limiter
  isDigest?: boolean
}

const shown = (l: Limiter, category: string, now: number, level: Level): Limiter => ({
  ...l,
  last: { ...l.last, [category]: now },
  lastShown: now,
  lastUrgent: level === 'urgent' ? now : l.lastUrgent,
})

// Order: mute, per-category rate limit, urgent (skips the rest but a 20 s burst guard), snooze, quiet hours,
// low priority goes to the digest, the global one-toast-per-3-minutes limit sends the rest to the digest.
export const decide = (i: DecideInput): Decision => {
  const { level, category, now, cfg, limiter } = i

  if (cfg.muted.includes(category)) {
    return { action: 'drop', reason: 'muted', limiter }
  }
  const gap = CATS[category]?.gap ?? 0
  const last = limiter.last[category]

  if (gap > 0 && last !== undefined && now - last < gap) {
    return { action: 'drop', reason: 'category rate limit', limiter }
  }
  if (level === 'urgent') {
    if (limiter.lastUrgent > 0 && now - limiter.lastUrgent < URGENT_GAP_MS) {
      return { action: 'digest', reason: 'urgent burst', limiter }
    }

    return { action: 'show', reason: 'urgent', limiter: shown(limiter, category, now, level) }
  }
  if (now < cfg.snoozeUntil) {
    return { action: 'hold', reason: 'snoozed', limiter }
  }
  if (cfg.quiet !== '' && inQuiet(cfg.quiet, i.minute)) {
    return { action: 'hold', reason: 'quiet hours', limiter }
  }
  if (level === 'info' && i.isDigest !== true) {
    return { action: 'digest', reason: 'low priority', limiter }
  }
  if (limiter.lastShown > 0 && now - limiter.lastShown < GLOBAL_GAP_MS) {
    return { action: 'digest', reason: 'one toast per 3 minutes', limiter }
  }

  return { action: 'show', reason: level, limiter: shown(limiter, category, now, level) }
}

// ---------------------------------------------------------------- 122: the digest

export const addPending = (list: readonly Pending[], item: Pending, cap = KEEP_PENDING): Pending[] =>
  [...list.filter(one => !(one.category === item.category && one.text === item.text)), item].slice(-cap)

export const shouldFlush = (pending: readonly Pending[], lastDigest: number, now: number): boolean =>
  pending.length > 0 && now - lastDigest >= DIGEST_GAP_MS

export const digestSummary = (pending: readonly Pending[]): string => {
  const counts = new Map<string, number>()

  for (const one of pending) {
    counts.set(one.category, (counts.get(one.category) ?? 0) + 1)
  }
  const parts = [...counts].map(([name, n]) => (n > 1 ? `${name} x${n}` : name))
  const n = pending.length

  return `${n} notice${n === 1 ? '' : 's'} held (${parts.join(', ')}). /aldigest to read.`
}

export const digestLines = (pending: readonly Pending[], now: number): string[] =>
  pending.map(one => `  ${fmtClock(one.t)} (${fmtDur(now - one.t)} ago) [${one.level}/${one.category}] ${one.text}  (${one.why})`)

export const addHistory = (list: readonly HistoryRow[], row: HistoryRow, cap = KEEP_HISTORY): HistoryRow[] =>
  [...list, row].slice(-cap)

export const historyLines = (list: readonly HistoryRow[], count: number): string[] =>
  list.slice(-count).map(one => `  ${fmtClockSec(one.t)} [${one.level}/${one.category}] ${one.via}: ${one.text}`)

// ---------------------------------------------------------------- once-only milestones (127-129, 136)

// Rising values (percent, dollars): the highest threshold at or below `value` that has not fired, and every
// threshold now passed (so a jump past two fires one notice and marks both).
export const crossedUp = (thresholds: readonly number[], value: number, fired: readonly number[]) => {
  const passed = thresholds.filter(t => value >= t && !fired.includes(t))

  return { hit: passed.length === 0 ? null : Math.max(...passed), mark: passed }
}

// Falling values (minutes left): the lowest threshold at or above `value` that has not fired.
export const crossedDown = (thresholds: readonly number[], value: number, fired: readonly number[]) => {
  const passed = thresholds.filter(t => value <= t && !fired.includes(t))

  return { hit: passed.length === 0 ? null : Math.min(...passed), mark: passed }
}

export const firedNums = (fired: readonly string[], prefix: string): number[] =>
  fired.filter(key => key.startsWith(prefix)).map(key => Number(key.slice(prefix.length))).filter(Number.isFinite)

export const addFired = (list: readonly string[], keys: readonly string[], cap = KEEP_FIRED): string[] =>
  [...list.filter(one => !keys.includes(one)), ...keys].slice(-cap)

export const COST_STEPS = [1, 5, 10, 25, 50, 100] as const
export const RATE_STEPS = [70, 85, 95] as const
export const DEADLINE_STEPS = [30, 10, 0] as const

export const costLevel = (step: number): Level => (step < 10 ? 'info' : 'notice')
export const rateLevel = (step: number): Level => (step >= 95 ? 'urgent' : 'notice')

export const rateLabel = (kind: string): string =>
  kind === 'five_hour' ? '5-hour limit' : kind === 'seven_day' ? '7-day limit' : kind === 'spend_limit' ? 'spend limit' : kind

export const deadlineText = (label: string, msLeft: number): string => {
  const name = label === '' ? 'Deadline' : label
  const minutes = Math.ceil(msLeft / MIN)

  return msLeft <= 0 ? `${name}: time is up` : `${name}: ${minutes} min left`
}

// ---------------------------------------------------------------- 137: continuous activity

export const ACTIVE_GAP_MS = 15 * MIN
export const CHECKIN_AFTER_MS = 90 * MIN

// A stretch of activity continues while the gap between events stays under 15 minutes.
export const stretchOf = (start: number, last: number, now: number): { start: number; last: number; isNew: boolean } =>
  start === 0 || now - last >= ACTIVE_GAP_MS ? { start: now, last: now, isNew: true } : { start, last: now, isNew: false }

export const checkinDue = (start: number, last: number): boolean => start > 0 && last - start >= CHECKIN_AFTER_MS

// ---------------------------------------------------------------- 138: weekly counters

export type Week = { key: string; calls: number; shownKey: string }

export const normalizeWeek = (raw: unknown): Week => {
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  return {
    key: typeof r.key === 'string' ? r.key : '',
    calls: typeof r.calls === 'number' && Number.isFinite(r.calls) ? r.calls : 0,
    shownKey: typeof r.shownKey === 'string' ? r.shownKey : '',
  }
}

// Adds `n` calls to this week's counter, starting a fresh one when the week changed.
export const bumpWeek = (week: Week, key: string, n: number): Week =>
  week.key === key ? { ...week, calls: week.calls + n } : { key, calls: n, shownKey: week.shownKey }

export const weeklyDue = (week: Week, now: number): boolean =>
  isFriday(now) && week.key === weekKey(now) && week.calls > 0 && week.shownKey !== week.key

// ---------------------------------------------------------------- 139, 131, 134: tool call classifiers

type Input = Record<string, unknown>

const DELETE_RE = /(^|[\s;&|(])(rm|rmdir|unlink|trash)\s|git\s+rm\s/

export const isFileChange = (tool: string, input: Input): boolean => {
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    return true
  }

  return tool === 'Bash' && typeof input.command === 'string' && DELETE_RE.test(input.command)
}

export const CURL_RE = /(^|[\s;&|(])curl\s/

export const isNetCall = (tool: string, input: Input): boolean =>
  tool === 'WebFetch' || (tool === 'Bash' && typeof input.command === 'string' && CURL_RE.test(input.command))

// The first word of a command, nothing else: a notice never carries arguments (they may hold secrets).
export const firstWord = (command: string): string => {
  const word = command.trim().split(/\s+/)[0] ?? ''

  return word.replace(/^.*\//, '').slice(0, 24)
}

// A result that says it failed: an error flag, a deny, or a shell exit code.
export const isFailed = (ran: unknown): boolean => {
  if (ran === null || typeof ran !== 'object') {
    return false
  }
  const r = ran as { isError?: unknown; deny?: unknown; result?: unknown }

  if (r.isError === true || typeof r.deny === 'string') {
    return true
  }
  const inner = r.result

  if (inner !== null && typeof inner === 'object') {
    const code = (inner as { exitCode?: unknown; code?: unknown }).exitCode ?? (inner as { code?: unknown }).code

    return typeof code === 'number' && code !== 0
  }

  return false
}

// ---------------------------------------------------------------- 132: df

export const DF_ARGV = ['df', '-k', '.'] as const

// The share of the disk that is free, from `df -k .` (POSIX and macOS columns); null when unreadable.
export const parseDf = (stdout: string): number | null => {
  const lines = stdout.trim().split('\n')
  const tokens = lines.slice(1).join(' ').trim().split(/\s+/)
  const at = tokens.findIndex(t => /^\d+%$/.test(t))

  if (at < 2) {
    return null
  }
  const used = Number(tokens[at - 2])
  const avail = Number(tokens[at - 1])

  if (!Number.isFinite(used) || !Number.isFinite(avail) || used + avail <= 0) {
    return null
  }

  return (avail / (used + avail)) * 100
}

export const isDiskLow = (freePercent: number | null): boolean => freePercent !== null && freePercent < 5
