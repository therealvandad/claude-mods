import type {
  Cfg,
  Data,
  Day,
  Fmt,
  Goal,
  Intent,
  Migration,
  Plan,
  Point,
  Refactor,
  RevItem,
  Rule,
  RuleEvent,
  Sess,
  Template,
  Upgrade,
  Win,
} from '../types'

// Pure helpers for the progress-more mod: no engine calls, so every one of them is tested directly.

export const DAY_MS = 86_400_000
const p2 = (n: number) => String(n).padStart(2, '0')

// ---------------------------------------------------------------- time

export const dayKey = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** ISO week of a local time, e.g. 2026-W48. */
export const isoWeek = (ms: number): string => {
  const d = new Date(ms)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3)
  const y = t.getUTCFullYear()
  const jan4 = new Date(Date.UTC(y, 0, 4))
  const w = 1 + Math.round(((t.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)

  return `${y}-W${p2(w)}`
}

/** Monday of an ISO week as a UTC midnight; undefined for a malformed key. */
export const weekStartUtc = (key: string): number | undefined => {
  const m = /^(\d{4})-W(\d{2})$/.exec(key)

  if (m === null) {
    return undefined
  }
  const y = Number(m[1])
  const w = Number(m[2])

  if (w < 1 || w > 53) {
    return undefined
  }
  const jan4 = Date.UTC(y, 0, 4)
  const dow = (new Date(jan4).getUTCDay() + 6) % 7

  return jan4 - dow * DAY_MS + (w - 1) * 7 * DAY_MS
}

export const weekDays = (key: string): string[] => {
  const start = weekStartUtc(key)

  return start === undefined ? [] : Array.from({ length: 7 }, (_, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10))
}

export const weeksBetween = (a: string, b: string): number | undefined => {
  const x = weekStartUtc(a)
  const y = weekStartUtc(b)

  return x === undefined || y === undefined ? undefined : Math.round((y - x) / (7 * DAY_MS))
}

const localNoon = (day: string): number => {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)

  return new Date(y, m - 1, d, 12).getTime()
}

/** `2026-W48`, `2026-11-25` or `+3` (weeks from now) to a week key. */
export const parseWeek = (text: string, now: number): string | undefined => {
  const t = text.trim()

  if (/^\d{4}-W\d{2}$/i.test(t)) {
    const k = t.toUpperCase()

    return weekStartUtc(k) === undefined ? undefined : k
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const ms = localNoon(t)

    return Number.isNaN(ms) || dayKey(ms) !== t ? undefined : isoWeek(ms)
  }
  const plus = /^\+(\d{1,3})$/.exec(t)

  return plus === null ? undefined : isoWeek(now + Number(plus[1]) * 7 * DAY_MS)
}

// ---------------------------------------------------------------- tiny charts (text only)

const BLOCKS = '▁▂▃▄▅▆▇█'

export const spark = (vals: readonly (number | null)[], max?: number): string => {
  const real = vals.filter((v): v is number => v !== null)
  const top = max ?? Math.max(0, ...real)

  return vals.map(v => (v === null ? '·' : top <= 0 ? BLOCKS[0] : (BLOCKS[Math.min(7, Math.max(0, Math.round((v / top) * 7)))] ?? '▁'))).join('')
}

export const bar = (frac: number, width = 16): string => {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  const n = Math.round(f * width)

  return '█'.repeat(n) + '░'.repeat(width - n)
}

export const pct = (a: number, b: number): string => (b <= 0 ? 'n/a' : `${Math.round((a / b) * 100)}%`)
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const check = (icons: string, done: boolean): string =>
  icons === 'letters' ? (done ? '[x]' : '[ ]') : icons === 'minimal' ? (done ? 'x' : '-') : done ? '☑' : '☐'

// ---------------------------------------------------------------- arguments

/** Whitespace split that keeps "double" and 'single' quoted words together. */
export const splitArgs = (text: string): string[] => {
  const out: string[] = []
  let cur = ''
  let quote = ''
  let has = false

  for (const ch of text) {
    if (quote !== '') {
      if (ch === quote) {
        quote = ''
      } else {
        cur += ch
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (has || cur !== '') {
        out.push(cur)
      }
      cur = ''
      has = false
    } else {
      cur += ch
    }
  }

  if (has || cur !== '') {
    out.push(cur)
  }

  return out
}

export const parseOnOff = (s: string): boolean | undefined => {
  const t = s.trim().toLowerCase()

  return t === 'on' || t === 'true' || t === 'yes' ? true : t === 'off' || t === 'false' || t === 'no' ? false : undefined
}

// ---------------------------------------------------------------- defaults and normalising stored data

export const TILE_IDS = ['quality', 'review', 'refactor', 'migration', 'upgrade', 'testdebt', 'docs', 'cleanup', 'intent', 'plan', 'goals', 'wins'] as const

export const TILE_INFO: Record<string, { title: string; idea: string }> = {
  quality: { title: 'Quality trend', idea: '123' },
  review: { title: 'Review progress', idea: '124' },
  refactor: { title: 'Refactor tracker', idea: '125' },
  migration: { title: 'Migration tracker', idea: '126' },
  upgrade: { title: 'Upgrade tracker', idea: '127' },
  testdebt: { title: 'Test debt', idea: '128' },
  docs: { title: 'Docs coverage', idea: '129' },
  cleanup: { title: 'Cleanup meter', idea: '130' },
  intent: { title: 'Session intentions', idea: '131' },
  plan: { title: 'Monday plan', idea: '133' },
  goals: { title: 'Season goals', idea: '136' },
  wins: { title: 'Celebration log', idea: '134' },
}

export const KEEP_LISTS = ['days', 'trends', 'intents', 'wins'] as const
export const KEEP_DEFAULT: Record<string, number> = { days: 180, trends: 365, intents: 365, wins: 730 }

export const emptyData = (): Data => ({
  days: [],
  review: [],
  refactor: null,
  migration: null,
  upgrades: [],
  intents: [],
  wins: [],
  plan: null,
  goals: [],
})

export const defaultFmt = (): Fmt => ({ currency: '$', clock: '24', units: 'si' })

export const defaultCfg = (): Cfg => ({
  tips: [],
  tipsOn: true,
  templates: [],
  rules: [],
  tiles: [...TILE_IDS],
  keep: {},
  fmt: defaultFmt(),
})

export const emptySess = (now = 0): Sess => ({ startedAt: now, changed: [], tests: [], docs: {}, lastToastAt: 0, lastSaveAt: 0, ruleLast: {} })

const arr = <T>(v: unknown, ok: (x: unknown) => x is T, cap: number): T[] => (Array.isArray(v) ? v.filter(ok).slice(-cap) : [])
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
const str = (x: unknown, d = '') => (typeof x === 'string' ? x : d)

const isPoint = (x: unknown): x is Point => isObj(x) && typeof x.at === 'number' && typeof x.a === 'number'
const isDay = (x: unknown): x is Day => isObj(x) && typeof x.day === 'string' && typeof x.calls === 'number'
const isRev = (x: unknown): x is RevItem => isObj(x) && typeof x.id === 'string' && typeof x.text === 'string'
const isIntent = (x: unknown): x is Intent => isObj(x) && typeof x.id === 'string' && typeof x.text === 'string'
const isWin = (x: unknown): x is Win => isObj(x) && typeof x.text === 'string' && typeof x.at === 'number'
const isGoal = (x: unknown): x is Goal => isObj(x) && typeof x.id === 'string' && typeof x.text === 'string' && typeof x.due === 'string'
const isUpg = (x: unknown): x is Upgrade => isObj(x) && typeof x.at === 'number' && typeof x.total === 'number'

const fixDay = (d: Day): Day => ({
  day: d.day,
  calls: num(d.calls),
  errors: num(d.errors),
  todoAdd: num(d.todoAdd),
  todoDone: num(d.todoDone),
  bytes: num(d.bytes),
  peakChanged: num(d.peakChanged),
  peakUntested: num(d.peakUntested),
  docsExported: num(d.docsExported),
  docsDocumented: num(d.docsDocumented),
})

const fixPoint = (p: Point): Point => ({ at: p.at, a: num(p.a), b: num(p.b), fa: num(p.fa), fb: num(p.fb) })

export const normalizeData = (raw: unknown): Data => {
  const base = emptyData()

  if (!isObj(raw)) {
    return base
  }
  const r = raw
  const plan = isObj(r.plan) && typeof r.plan.week === 'string' && Array.isArray(r.plan.items) ? r.plan : null
  const ref = isObj(r.refactor) && typeof r.refactor.pattern === 'string' ? r.refactor : null
  const mig = isObj(r.migration) && typeof r.migration.oldP === 'string' && typeof r.migration.newP === 'string' ? r.migration : null

  return {
    days: arr(r.days, isDay, MAX_DAYS).map(fixDay),
    review: arr(r.review, isRev, MAX_REVIEW).map(x => ({ id: x.id, text: str(x.text), done: x.done === true, at: num(x.at) })),
    refactor: ref === null ? null : { pattern: str(ref.pattern), points: arr(ref.points, isPoint, MAX_POINTS).map(fixPoint) },
    migration:
      mig === null ? null : { oldP: str(mig.oldP), newP: str(mig.newP), points: arr(mig.points, isPoint, MAX_POINTS).map(fixPoint) },
    upgrades: arr(r.upgrades, isUpg, MAX_UPGRADES).map(u => ({
      at: u.at,
      mgr: str(u.mgr),
      total: num(u.total),
      major: num(u.major),
      minor: num(u.minor),
      patch: num(u.patch),
      other: num(u.other),
      top: Array.isArray(u.top) ? u.top.filter((t): t is string => typeof t === 'string').slice(0, 10) : [],
    })),
    intents: arr(r.intents, isIntent, MAX_INTENTS).map(x => ({
      id: x.id,
      at: num(x.at),
      text: str(x.text),
      rating: typeof x.rating === 'number' && x.rating >= 1 && x.rating <= 5 ? Math.round(x.rating) : null,
    })),
    wins: arr(r.wins, isWin, MAX_WINS).map(x => ({ at: x.at, text: str(x.text) })),
    plan:
      plan === null
        ? null
        : {
            week: str(plan.week),
            items: (plan.items as unknown[])
              .filter(isObj)
              .slice(0, 3)
              .map(i => ({ text: str(i.text), done: i.done === true })),
          },
    goals: arr(r.goals, isGoal, MAX_GOALS).map(g => ({ id: g.id, text: str(g.text), due: g.due, done: g.done === true, at: num(g.at) })),
  }
}

export const normalizeCfg = (raw: unknown): Cfg => {
  const base = defaultCfg()

  if (!isObj(raw)) {
    return base
  }
  const r = raw
  const fmt = isObj(r.fmt) ? r.fmt : {}
  const tiles = Array.isArray(r.tiles) ? [...new Set(r.tiles.filter((t): t is string => typeof t === 'string' && TILE_IDS.includes(t as never)))] : base.tiles
  const keep: Record<string, number> = {}

  if (isObj(r.keep)) {
    for (const k of KEEP_LISTS) {
      const v = r.keep[k]

      if (typeof v === 'number' && v >= 7 && v <= 3650) {
        keep[k] = Math.round(v)
      }
    }
  }

  return {
    tips: Array.isArray(r.tips) ? r.tips.filter((t): t is string => typeof t === 'string').slice(0, MAX_TIPS) : [],
    tipsOn: r.tipsOn !== false,
    templates: arr(r.templates, (x): x is Template => isObj(x) && typeof x.name === 'string' && typeof x.text === 'string', MAX_TEMPLATES).map(t => ({ name: t.name, text: t.text })),
    rules: arr(r.rules, (x): x is Rule => isObj(x) && typeof x.id === 'string' && typeof x.text === 'string' && RULE_EVENTS.includes(x.event as never), MAX_RULES).map(x => ({
      id: x.id,
      event: x.event,
      text: x.text,
      everyMin: Math.min(1440, Math.max(1, Math.round(num(x.everyMin, 5)))),
    })),
    tiles,
    keep,
    fmt: {
      currency: validSymbol(str(fmt.currency)) ? str(fmt.currency) : base.fmt.currency,
      clock: fmt.clock === '12' ? '12' : '24',
      units: fmt.units === 'iec' ? 'iec' : 'si',
    },
  }
}

// ---------------------------------------------------------------- bounds

export const MAX_DAYS = 400
export const MAX_REVIEW = 40
export const MAX_POINTS = 60
export const MAX_UPGRADES = 30
export const MAX_INTENTS = 120
export const MAX_WINS = 200
export const MAX_GOALS = 40
export const MAX_TIPS = 30
export const MAX_TEMPLATES = 20
export const MAX_RULES = 20
export const MAX_FILES = 100
export const MAX_DOC_ENTRIES = 400

// ---------------------------------------------------------------- 123 quality trend, day records

export const emptyDay = (day: string): Day => ({
  day,
  calls: 0,
  errors: 0,
  todoAdd: 0,
  todoDone: 0,
  bytes: 0,
  peakChanged: 0,
  peakUntested: 0,
  docsExported: 0,
  docsDocumented: 0,
})

export const touchDay = (days: readonly Day[], key: string, fn: (d: Day) => Day): Day[] => {
  const found = days.find(d => d.day === key)
  const next = fn(found ?? emptyDay(key))
  const rest = found === undefined ? [...days] : days.filter(d => d.day !== key)

  return [...rest, next].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).slice(-MAX_DAYS)
}

export type Week = { week: string; calls: number; errors: number; per100: number | null }

export const per100 = (errors: number, calls: number): number | null => (calls <= 0 ? null : Math.round((errors * 1000) / calls) / 10)

export const weeklyTrend = (days: readonly Day[], now: number, n = 8): Week[] => {
  const sums = new Map<string, { calls: number; errors: number }>()

  for (const d of days) {
    const k = isoWeek(localNoon(d.day))
    const s = sums.get(k) ?? { calls: 0, errors: 0 }
    sums.set(k, { calls: s.calls + d.calls, errors: s.errors + d.errors })
  }

  return Array.from({ length: n }, (_, i) => {
    const week = isoWeek(now - (n - 1 - i) * 7 * DAY_MS)
    const s = sums.get(week) ?? { calls: 0, errors: 0 }

    return { week, calls: s.calls, errors: s.errors, per100: per100(s.errors, s.calls) }
  })
}

export const weekTotals = (days: readonly Day[], week: string): Day => {
  const keys = new Set(weekDays(week))
  const out = emptyDay(week)

  for (const d of days) {
    if (keys.has(d.day)) {
      out.calls += d.calls
      out.errors += d.errors
      out.todoAdd += d.todoAdd
      out.todoDone += d.todoDone
      out.bytes += d.bytes
      out.peakChanged = Math.max(out.peakChanged, d.peakChanged)
      out.peakUntested = Math.max(out.peakUntested, d.peakUntested)
    }
  }

  return out
}

// ---------------------------------------------------------------- 124 review list

export const addRev = (list: readonly RevItem[], text: string, now: number): { list: RevItem[]; error?: string } => {
  const t = text.trim()

  if (t === '' || t.length > 100) {
    return { list: [...list], error: 'Give the item as 1-100 characters, e.g. /pqrev add check error handling.' }
  }

  if (list.length >= MAX_REVIEW) {
    return { list: [...list], error: `The review list holds ${MAX_REVIEW} items; /pqrev del <n> or /pqrev clear first.` }
  }
  const id = `v${Math.max(0, ...list.map(i => Number(i.id.slice(1)) || 0)) + 1}`

  return { list: [...list, { id, text: t, done: false, at: now }] }
}

export const revProgress = (list: readonly RevItem[]) => {
  const done = list.filter(i => i.done).length

  return { done, total: list.length, frac: list.length === 0 ? 0 : done / list.length }
}

// ---------------------------------------------------------------- 125/126 literal grep tracker

export type PatternCheck = { ok: true; pattern: string } | { ok: false; reason: string }

/**
 * A pattern is only ever searched literally (grep -F). It must be a string of 2-60 characters,
 * with no control characters or newline, no leading dash (it would read as an option), no leading
 * or trailing space, and at least one letter, digit or underscore.
 */
export const validatePattern = (p: unknown): PatternCheck => {
  if (typeof p !== 'string') {
    return { ok: false, reason: 'the pattern must be text' }
  }

  if (p.length < 2 || p.length > 60) {
    return { ok: false, reason: 'the pattern must be 2 to 60 characters' }
  }

  if (p.startsWith('-')) {
    return { ok: false, reason: 'the pattern must not start with a dash (it would read as an option)' }
  }

  if (/[\u0000-\u001f\u007f]/.test(p)) {
    return { ok: false, reason: 'the pattern must be one line without control characters' }
  }

  if (p !== p.trim()) {
    return { ok: false, reason: 'no leading or trailing spaces in the pattern' }
  }

  if (!/[\p{L}\p{N}_]/u.test(p)) {
    return { ok: false, reason: 'the pattern needs at least one letter, digit or underscore' }
  }

  return { ok: true, pattern: p }
}

export const GREP_EXCLUDES = ['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.venv', '__pycache__'] as const

/** The one grep command this mod ever runs: read-only, fixed strings, binary files skipped, counts only. */
export const grepArgv = (pattern: string): string[] => {
  const v = validatePattern(pattern)

  if (!v.ok) {
    throw new Error(`refused grep pattern: ${v.reason}`)
  }

  return ['grep', '-rIF', '-c', ...GREP_EXCLUDES.map(d => `--exclude-dir=${d}`), '--', v.pattern, '.']
}

export type GrepCounts = { total: number; fileCount: number; files: { path: string; count: number }[]; isCut: boolean }

export const MAX_GREP_LINES = 200_000

/** Parses `grep -c` output (`./path:count`), keeping files that have at least one hit. */
export const parseGrepCounts = (stdout: string, keep = 200): GrepCounts => {
  let total = 0
  let fileCount = 0
  const files: { path: string; count: number }[] = []
  const lines = stdout.split('\n', MAX_GREP_LINES + 1)
  const isCut = lines.length > MAX_GREP_LINES

  for (const line of lines.slice(0, MAX_GREP_LINES)) {
    if (line.length > 2000) {
      continue
    }
    const i = line.lastIndexOf(':')

    if (i < 1) {
      continue
    }
    const n = Number(line.slice(i + 1))

    if (!Number.isInteger(n) || n <= 0) {
      continue
    }
    total += n
    fileCount += 1
    files.push({ path: line.slice(0, i).replace(/^\.\//, ''), count: n })
  }
  files.sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : 1))

  return { total, fileCount, files: files.slice(0, keep), isCut }
}

export const addPoint = (points: readonly Point[], pt: Point): Point[] => [...points.filter(p => dayKey(p.at) !== dayKey(pt.at)), pt].slice(-MAX_POINTS)

export const refactorLines = (r: Refactor | null): string[] => {
  if (r === null) {
    return ['Not tracking. /pqrefactor <literal text> counts what is left (read-only grep).']
  }
  const last = r.points[r.points.length - 1]
  const first = r.points[0]

  if (last === undefined || first === undefined) {
    return [`"${r.pattern}": not counted yet. Run /pqrefactor again.`]
  }
  const drop = first.a - last.a

  return [
    `"${r.pattern}": ${plural(last.a, 'occurrence')} left in ${plural(last.fa, 'file')}`,
    `${spark(r.points.map(p => p.a))}  from ${first.a} at start${r.points.length > 1 ? `, ${drop >= 0 ? `${drop} fewer` : `${-drop} more`}` : ''}`,
  ]
}

export const migrationLines = (m: Migration | null): string[] => {
  if (m === null) {
    return ['Not tracking. /pqmigrate <old text> <new text> (quote text with spaces) counts both.']
  }
  const last = m.points[m.points.length - 1]

  if (last === undefined) {
    return [`"${m.oldP}" -> "${m.newP}": not counted yet. Run /pqmigrate again.`]
  }
  const total = last.a + last.b

  return [
    `"${m.oldP}" -> "${m.newP}"`,
    `${bar(total === 0 ? 0 : last.b / total)} ${pct(last.b, total)} migrated`,
    `old ${last.a} in ${plural(last.fa, 'file')} · new ${last.b} in ${plural(last.fb, 'file')}`,
    `old over time ${spark(m.points.map(p => p.a))}`,
  ]
}

// ---------------------------------------------------------------- 127 upgrades (npm / pip, read-only)

export type Outdated = { name: string; current: string; latest: string }
export type Parsed = { ok: true; items: Outdated[] } | { ok: false; reason: string }

export const semverKind = (current: string, latest: string): 'major' | 'minor' | 'patch' | 'other' => {
  const parse = (s: string) => {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(s.trim())

    return m === null ? undefined : [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
  }
  const a = parse(current)
  const b = parse(latest)

  if (a === undefined || b === undefined) {
    return 'other'
  }

  return a[0] !== b[0] ? 'major' : a[1] !== b[1] ? 'minor' : a[2] !== b[2] ? 'patch' : 'other'
}

export const parseOutdated = (mgr: 'npm' | 'pip', stdout: string): Parsed => {
  const text = stdout.trim()

  if (text === '') {
    return { ok: true, items: [] }
  }
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, reason: `${mgr} did not print JSON` }
  }

  if (mgr === 'npm') {
    if (!isObj(json)) {
      return { ok: false, reason: 'unexpected npm outdated output' }
    }

    if (isObj(json.error)) {
      return { ok: false, reason: `npm said: ${clip(str(json.error.summary, 'an error'), 120)}` }
    }
    const items = Object.entries(json).slice(0, 500).flatMap(([name, v]): Outdated[] => {
      const one = Array.isArray(v) ? v[0] : v

      if (!isObj(one)) {
        return []
      }

      return [{ name, current: str(one.current), latest: str(one.latest, str(one.wanted)) }]
    })

    return { ok: true, items }
  }

  if (!Array.isArray(json)) {
    return { ok: false, reason: 'unexpected pip output' }
  }

  return {
    ok: true,
    items: json
      .slice(0, 500)
      .filter(isObj)
      .map(o => ({ name: str(o.name), current: str(o.version), latest: str(o.latest_version) })),
  }
}

export const summarizeUpgrades = (mgr: string, items: readonly Outdated[], now: number): Upgrade => {
  const count = { major: 0, minor: 0, patch: 0, other: 0 }
  const ranked = items.map(i => ({ i, k: semverKind(i.current, i.latest) }))

  for (const r of ranked) {
    count[r.k] += 1
  }
  const order = { major: 0, minor: 1, patch: 2, other: 3 }
  const top = [...ranked].sort((a, b) => order[a.k] - order[b.k]).slice(0, 8).map(r => `${r.k} ${r.i.name} ${r.i.current || '?'} -> ${r.i.latest || '?'}`)

  return { at: now, mgr, total: items.length, ...count, top }
}

export const upgradeLines = (list: readonly Upgrade[], now: number): string[] => {
  const u = list[list.length - 1]

  if (u === undefined) {
    return ['Not checked. /pqupgrade runs npm outdated or pip list --outdated (read-only; never installs).']
  }
  const trend = list.length > 1 ? `  ${spark(list.map(x => x.total))}` : ''

  return [
    `${u.mgr}: ${u.total === 0 ? 'everything is current' : `${u.total} outdated (${u.major} major, ${u.minor} minor, ${u.patch} patch${u.other > 0 ? `, ${u.other} other` : ''})`}${trend}`,
    `checked ${dayKey(u.at)}${dayKey(u.at) === dayKey(now) ? ' (today)' : ''}`,
    ...u.top.slice(0, 4),
  ]
}

// ---------------------------------------------------------------- 128/129/130 from edit contents

export const isTestFile = (p: string): boolean =>
  /(^|[\\/])(tests?|__tests__|spec|specs)[\\/]/i.test(p) || /\.(test|spec)\.[a-z0-9]+$/i.test(p) || /_test\.(go|py|rs|rb)$/i.test(p) || /(^|[\\/])test_[^\\/]*\.py$/i.test(p) || /Tests?\.(java|kt|cs|swift)$/.test(p)

export const isSourceFile = (p: string): boolean =>
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift|vue|svelte)$/i.test(p) && !isTestFile(p) && !/\.d\.ts$/.test(p) && !/\.config\.[a-z]+$/i.test(p)

export const testBase = (p: string): string => {
  const file = p.split(/[\\/]/).pop() ?? p
  const stem = file.replace(/\.[^.]+$/, '')

  return stem
    .replace(/\.(test|spec)$/i, '')
    .replace(/_test$/i, '')
    .replace(/^test_/i, '')
    .replace(/Tests?$/, '')
    .toLowerCase()
}

export const untestedFiles = (changed: readonly string[], tests: readonly string[]): string[] => {
  const bases = new Set(tests.map(testBase))

  return changed.filter(c => !bases.has(testBase(c)))
}

export const countTodos = (text: string): number => (text.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length

export const todoDelta = (old: string, now: string, isWrite: boolean): { added: number; removed: number } => {
  const a = countTodos(now)
  const b = isWrite ? 0 : countTodos(old)

  return { added: Math.max(0, a - b), removed: Math.max(0, b - a) }
}

export type Fn = { name: string; documented: boolean | null }

const lang = (path: string): 'js' | 'py' | 'go' | 'rs' | undefined => {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()

  return ext === undefined
    ? undefined
    : ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)
      ? 'js'
      : ext === 'py'
        ? 'py'
        : ext === 'go'
          ? 'go'
          : ext === 'rs'
            ? 'rs'
            : undefined
}

const isComment = (line: string, l: string): boolean => {
  const t = line.trim()

  return l === 'py' ? t.startsWith('#') : t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/')
}

/**
 * Exported (public) functions in a piece of source and whether a comment sits directly above (or,
 * in Python, a docstring directly below). `whole` says the text is a whole file: for a fragment,
 * a function on its first line has an unknown `documented` (null) because its comment may lie outside.
 */
export const exportedFns = (text: string, path: string, whole: boolean): Fn[] => {
  const l = lang(path)

  if (l === undefined) {
    return []
  }
  const lines = text.split('\n').slice(0, 4000)
  const out: Fn[] = []
  const re: Record<string, RegExp[]> = {
    js: [
      /^\s*export\s+(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/,
      /^\s*export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    ],
    py: [/^(?:async\s+)?def\s+([A-Za-z][\w]*)\s*\(/],
    go: [/^func\s+([A-Z]\w*)\s*\(/],
    rs: [/^\s*pub\s+(?:async\s+)?fn\s+(\w+)/],
  }

  lines.forEach((line, i) => {
    const m = (re[l] ?? []).map(r => r.exec(line)).find(x => x !== null)

    if (m === null || m === undefined || m[1] === undefined) {
      return
    }
    let j = i - 1

    while (j >= 0 && (lines[j]?.trim() === '' || (/^\s*@/.test(lines[j] ?? '') && (l === 'py' || l === 'js')) || (l === 'rs' && /^\s*#\[/.test(lines[j] ?? '')))) {
      j -= 1
    }
    const above = j >= 0 ? (lines[j] ?? '') : undefined
    let documented: boolean | null

    if (above === undefined) {
      documented = whole ? false : null
    } else {
      documented = isComment(above, l)
    }

    if (l === 'py' && documented !== true) {
      let k = i + 1

      while (k < lines.length && (lines[k] ?? '').trim() === '') {
        k += 1
      }
      const below = (lines[k] ?? '').trim()
      // the docstring of a Python function is the first statement below the def
      documented = /^[rRuUbB]?("""|''')/.test(below) ? true : documented
    }
    out.push({ name: m[1], documented })
  })

  return out
}

/** Merges the functions seen in one edit into the per-file record. Unknown (null) never overwrites. */
export const mergeDocs = (docs: Record<string, Record<string, number>>, path: string, fns: readonly Fn[], isWrite: boolean): Record<string, Record<string, number>> => {
  if (fns.length === 0 && !isWrite) {
    return docs
  }
  const prev = isWrite ? {} : (docs[path] ?? {})
  const next: Record<string, number> = { ...prev }

  for (const f of fns) {
    if (f.documented !== null) {
      next[f.name] = f.documented ? 1 : 0
    } else if (next[f.name] === undefined) {
      continue
    }
  }
  const rest = Object.fromEntries(Object.entries(docs).filter(([k]) => k !== path))
  const merged = { ...rest, [path]: next }
  const keys = Object.keys(merged)
  let total = keys.reduce((n, k) => n + Object.keys(merged[k] ?? {}).length, 0)

  for (const k of keys) {
    if (total <= MAX_DOC_ENTRIES || k === path) {
      continue
    }
    total -= Object.keys(merged[k] ?? {}).length
    delete merged[k]
  }

  return merged
}

export const docsStats = (docs: Record<string, Record<string, number>>) => {
  let exported = 0
  let documented = 0
  const missing: string[] = []

  for (const [path, fns] of Object.entries(docs)) {
    for (const [name, v] of Object.entries(fns)) {
      exported += 1
      documented += v === 1 ? 1 : 0

      if (v !== 1) {
        missing.push(`${path.split(/[\\/]/).pop() ?? path}:${name}`)
      }
    }
  }

  return { exported, documented, missing, frac: exported === 0 ? 0 : documented / exported }
}

// ---------------------------------------------------------------- 191 toast rules (a tiny engine over fixed events)

export const RULE_EVENTS: readonly RuleEvent[] = ['turn.complete', 'tests-pass', 'tests-fail', 'commit']

export type RuleParse = { ok: true; event: RuleEvent; text: string; everyMin: number } | { ok: false; reason: string }

/** `on <event> toast "<text>" [every <n>m]`; the only action is a toast, the only events are RULE_EVENTS. */
export const parseRule = (line: string): RuleParse => {
  const m = /^\s*on\s+(\S+)\s+toast\s+(?:"([^"]*)"|'([^']*)')(?:\s+every\s+(\d{1,4})\s*m(?:in)?)?\s*$/i.exec(line)

  if (m === null) {
    return { ok: false, reason: `use: on <${RULE_EVENTS.join('|')}> toast "<text>" [every <n>m]` }
  }
  const event = m[1]?.toLowerCase()

  if (event === undefined || !RULE_EVENTS.includes(event as RuleEvent)) {
    return { ok: false, reason: `unknown event "${m[1]}"; events are ${RULE_EVENTS.join(', ')}` }
  }
  const text = (m[2] ?? m[3] ?? '').trim()

  if (text === '' || text.length > 80) {
    return { ok: false, reason: 'the toast text must be 1 to 80 characters' }
  }

  if (/[\u0000-\u001f\u007f]/.test(text)) {
    return { ok: false, reason: 'the toast text must be one line without control characters' }
  }
  const everyMin = m[4] === undefined ? 5 : Number(m[4])

  if (everyMin < 1 || everyMin > 1440) {
    return { ok: false, reason: 'every <n>m needs n from 1 to 1440' }
  }

  return { ok: true, event: event as RuleEvent, text, everyMin }
}

export const addRule = (rules: readonly Rule[], line: string): { rules: Rule[]; error?: string; rule?: Rule } => {
  const p = parseRule(line)

  if (!p.ok) {
    return { rules: [...rules], error: p.reason }
  }

  if (rules.length >= MAX_RULES) {
    return { rules: [...rules], error: `At most ${MAX_RULES} rules; /pqrule del <n> first.` }
  }

  if (rules.some(r => r.event === p.event && r.text === p.text)) {
    return { rules: [...rules], error: 'That rule already exists.' }
  }
  const id = `r${Math.max(0, ...rules.map(r => Number(r.id.slice(1)) || 0)) + 1}`
  const rule: Rule = { id, event: p.event, text: p.text, everyMin: p.everyMin }

  return { rules: [...rules, rule], rule }
}

/** First rule for the event that is not throttled; callers mark it fired only if the toast was really shown. */
export const pickRule = (rules: readonly Rule[], event: string, now: number, last: Readonly<Record<string, number>>): Rule | undefined =>
  rules.find(r => r.event === event && (last[r.id] === undefined || now - (last[r.id] ?? 0) >= r.everyMin * 60_000))

export const TOAST_GAP_MS = 3 * 60_000
export const toastAllowed = (isCalm: boolean, now: number, lastAt: number): boolean => !isCalm && now - lastAt >= TOAST_GAP_MS

const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bpytest\b|\bvitest\b|\bjest\b|\bgo\s+test\b|\bcargo\s+test\b|\bmocha\b|\brspec\b|\bphpunit\b|\bdotnet\s+test\b|\bmake\s+test\b|\bunittest\b/
const COMMIT_CMD = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/
const FAIL_COUNT = /\b[1-9]\d*\s+(failed|failing|failures?)\b/i
const FAIL_LINE = /^\s*FAIL(ED)?\b/m

/** Which rule event a finished Bash command counts as, if any. */
export const bashEvent = (command: string, isError: boolean, output: string): 'tests-pass' | 'tests-fail' | 'commit' | undefined => {
  if (COMMIT_CMD.test(command) && !isError) {
    return 'commit'
  }

  if (TEST_CMD.test(command)) {
    return isError || FAIL_COUNT.test(output.slice(0, 20_000)) || FAIL_LINE.test(output.slice(0, 20_000)) ? 'tests-fail' : 'tests-pass'
  }

  return undefined
}

// ---------------------------------------------------------------- 192 retention

export const keepDays = (cfg: Cfg, list: string): number => cfg.keep[list] ?? KEEP_DEFAULT[list] ?? 365

export const parseKeep = (args: string): { list: string; days: number | 'default' } | { error: string } => {
  const [list = '', value = ''] = args.trim().toLowerCase().split(/\s+/)

  if (!KEEP_LISTS.includes(list as never)) {
    return { error: `Lists: ${KEEP_LISTS.join(', ')}. Use /pqkeep <list> <days 7-3650|default>.` }
  }

  if (value === 'default') {
    return { list, days: 'default' }
  }
  const n = Number(value)

  return Number.isInteger(n) && n >= 7 && n <= 3650 ? { list, days: n } : { error: 'Days must be a whole number from 7 to 3650 (or default).' }
}

/** Drops records older than each list's retention. Review, plan and goals are yours and never expire. */
export const pruneData = (data: Data, cfg: Cfg, now: number): Data => {
  const cut = (list: string) => now - keepDays(cfg, list) * DAY_MS

  return {
    ...data,
    days: data.days.filter(d => localNoon(d.day) >= cut('days')),
    refactor: data.refactor === null ? null : { ...data.refactor, points: data.refactor.points.filter(p => p.at >= cut('trends')) },
    migration: data.migration === null ? null : { ...data.migration, points: data.migration.points.filter(p => p.at >= cut('trends')) },
    upgrades: data.upgrades.filter(u => u.at >= cut('trends')),
    intents: data.intents.filter(i => i.at >= cut('intents')),
    wins: data.wins.filter(w => w.at >= cut('wins')),
  }
}

// ---------------------------------------------------------------- 193 tiles

export const moveTile = (tiles: readonly string[], id: string, dir: -1 | 1): string[] => {
  const i = tiles.indexOf(id)
  const j = i + dir

  if (i < 0 || j < 0 || j >= tiles.length) {
    return [...tiles]
  }
  const out = [...tiles]
  const a = out[i] ?? id
  out[i] = out[j] ?? id
  out[j] = a

  return out
}

export const parseTileList = (text: string): { tiles: string[] } | { error: string } => {
  const ids = text
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
  const bad = ids.filter(i => !TILE_IDS.includes(i as never))

  if (ids.length === 0 || bad.length > 0) {
    return { error: `Tiles: ${TILE_IDS.join(', ')}.${bad.length > 0 ? ` Unknown: ${bad.join(', ')}.` : ''}` }
  }

  return { tiles: [...new Set(ids)] }
}

// ---------------------------------------------------------------- 194 number formats

export const validSymbol = (s: string): boolean => s.length >= 1 && s.length <= 4 && !/[\s\u0000-\u001f\u007f]/.test(s)

export const fmtMoney = (usd: number, symbol: string): string => {
  const n = (Math.round(usd * 100) / 100).toFixed(2)

  return /[A-Za-z]/.test(symbol) ? `${n} ${symbol}` : `${symbol}${n}`
}

export const fmtClock = (ms: number, clock: '12' | '24'): string => {
  const d = new Date(ms)
  const h = d.getHours()
  const m = p2(d.getMinutes())

  return clock === '24' ? `${p2(h)}:${m}` : `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

export const fmtSize = (bytes: number, units: 'si' | 'iec'): string => {
  const base = units === 'iec' ? 1024 : 1000
  const names = units === 'iec' ? ['B', 'KiB', 'MiB', 'GiB'] : ['B', 'kB', 'MB', 'GB']
  let v = Math.max(0, bytes)
  let i = 0

  while (v >= base && i < names.length - 1) {
    v /= base
    i += 1
  }

  return i === 0 ? `${Math.round(v)} ${names[0]}` : `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${names[i]}`
}

// ---------------------------------------------------------------- 133/134/136 cards

export const parsePlanItems = (text: string): { items: string[] } | { error: string } => {
  const items = text
    .split(/[;\n]/)
    .map(s => s.trim())
    .filter(Boolean)

  if (items.length === 0) {
    return { error: 'Give up to three items separated by ;  e.g. /pqplan ship the parser; review PRs; tidy docs' }
  }

  if (items.length > 3) {
    return { error: 'A Monday plan holds three items at most: pick the three that matter.' }
  }

  if (items.some(i => i.length > 80)) {
    return { error: 'Keep each plan item under 80 characters.' }
  }

  return { items }
}

export const parseGoalAdd = (text: string, now: number): { text: string; due: string } | { error: string } => {
  const m = /^(.*\S)\s+@(\S+)$/.exec(text.trim())
  const example = 'e.g. /pqgoal add finish the migration @2026-W50 (or @2026-12-15 or @+4 for four weeks from now)'

  if (m === null || m[1] === undefined || m[2] === undefined) {
    return { error: `Goal text then @due week ${example}` }
  }
  const due = parseWeek(m[2], now)

  if (due === undefined) {
    return { error: `Could not read the due week "${m[2]}". ${example}` }
  }

  if (m[1].length > 100) {
    return { error: 'Keep the goal under 100 characters.' }
  }

  return { text: m[1], due }
}

export const goalLine = (g: Goal, nowWeek: string, icons: string): string => {
  const left = weeksBetween(nowWeek, g.due)
  const when = g.done ? 'done' : left === undefined ? g.due : left < 0 ? `${-left} wk overdue` : left === 0 ? 'due this week' : `${left} wk left`

  return `${check(icons, g.done)} ${g.text} (${g.due}, ${when})`
}

export const ratingTrend = (intents: readonly Intent[]): { avg: number | null; spark: string } => {
  const rated = intents.filter(i => i.rating !== null).slice(-12)
  const avg = rated.length === 0 ? null : Math.round((rated.reduce((s, i) => s + (i.rating ?? 0), 0) / rated.length) * 10) / 10

  return { avg, spark: spark(rated.map(i => i.rating), 5) }
}

// ---------------------------------------------------------------- tiles as text

export type Ctx = { data: Data; cfg: Cfg; sess: Sess; now: number; icons: string }

export const testDebtNow = (sess: Sess) => {
  const un = untestedFiles(sess.changed, sess.tests)

  return { changed: sess.changed.length, untested: un.length, files: un }
}

export const tileLines = (id: string, c: Ctx): string[] => {
  const { data, sess, now, icons } = c
  const week = isoWeek(now)

  if (id === 'quality') {
    const tr = weeklyTrend(data.days, now, 8)
    const cur = tr[tr.length - 1]

    return [
      cur === undefined || cur.per100 === null ? 'This week: no tool calls recorded yet.' : `This week: ${cur.per100} errors per 100 tool calls (${cur.errors} of ${cur.calls})`,
      `8 weeks ${spark(tr.map(w => w.per100))}  (lower is better; counted from tool results this mod saw)`,
    ]
  }

  if (id === 'review') {
    const p = revProgress(data.review)

    return p.total === 0
      ? ['No review list. /pqrev add <what to check>']
      : [`${bar(p.frac)} ${p.done}/${p.total}`, ...data.review.filter(i => !i.done).slice(0, 3).map(i => `${check(icons, false)} ${i.text}`)]
  }

  if (id === 'refactor') {
    return refactorLines(data.refactor)
  }

  if (id === 'migration') {
    return migrationLines(data.migration)
  }

  if (id === 'upgrade') {
    return upgradeLines(data.upgrades, now)
  }

  if (id === 'testdebt') {
    const t = testDebtNow(sess)
    const hist = data.days.slice(-14).map(d => (d.peakChanged === 0 ? null : d.peakUntested / d.peakChanged))

    return [
      t.changed === 0 ? 'No source files changed this session.' : `${t.untested} of ${plural(t.changed, 'changed source file')} with no test file touched`,
      ...t.files.slice(0, 3).map(f => `  ${f.split(/[\\/]/).pop() ?? f}`),
      `14 days ${spark(hist, 1)}  (share of changed files without a test; session peaks)`,
    ]
  }

  if (id === 'docs') {
    const s = docsStats(sess.docs)

    return s.exported === 0
      ? ['No exported functions seen in files edited this session.']
      : [`${bar(s.frac)} ${pct(s.documented, s.exported)} of ${s.exported} exported functions have a comment above (edited files only)`, ...s.missing.slice(0, 3).map(m => `  missing: ${m}`)]
  }

  if (id === 'cleanup') {
    const w = weekTotals(data.days, week)
    const net = w.todoAdd - w.todoDone

    return [`This week: ${w.todoAdd} TODO/FIXME added, ${w.todoDone} removed (net ${net > 0 ? '+' : ''}${net})`, 'counted from edit contents; a heuristic, not a scan of the repo']
  }

  if (id === 'intent') {
    const last = data.intents[data.intents.length - 1]
    const t = ratingTrend(data.intents)

    return [
      last === undefined ? 'No intention set. /pqintent <what this session is for>' : `Intent: ${last.text}${last.rating === null ? ' (not rated: /pqrate 1-5)' : ` (rated ${last.rating}/5)`}`,
      ...(t.avg === null ? [] : [`ratings ${t.spark}  avg ${t.avg}`]),
    ]
  }

  if (id === 'plan') {
    const p = data.plan

    return p === null ? ['No plan. /pqplan <item>; <item>; <item>'] : [`Week ${p.week}${p.week === week ? '' : ' (an earlier week)'}`, ...p.items.map(i => `${check(icons, i.done)} ${i.text}`)]
  }

  if (id === 'goals') {
    const open = data.goals.filter(g => !g.done)

    return data.goals.length === 0
      ? ['No season goals. /pqgoal add <text> @<due week>']
      : [`${data.goals.length - open.length}/${data.goals.length} done`, ...[...open].sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 3).map(g => goalLine(g, week, icons))]
  }

  if (id === 'wins') {
    const wins = data.wins.slice(-3).reverse()

    return wins.length === 0 ? ['No wins logged yet. /pqwin <what went well>'] : wins.map(w => `${dayKey(w.at)}  ${w.text}`)
  }

  return []
}

export const wrapText = (c: Ctx): string => {
  const today = dayKey(c.now)
  const d = c.data.days.find(x => x.day === today) ?? emptyDay(today)
  const t = testDebtNow(c.sess)
  const docs = docsStats(c.sess.docs)
  const wins = c.data.wins.filter(w => dayKey(w.at) === today)
  const intent = [...c.data.intents].reverse().find(i => dayKey(i.at) === today)
  const rev = revProgress(c.data.review)
  const week = isoWeek(c.now)
  const soon = c.data.goals.filter(g => !g.done && (weeksBetween(week, g.due) ?? 99) <= 1)

  return [
    `Wrap for ${today}`,
    `Tool calls ${d.calls}, errors ${d.errors}${d.calls > 0 ? ` (${per100(d.errors, d.calls)} per 100)` : ''}.`,
    `TODO/FIXME: ${d.todoAdd} added, ${d.todoDone} removed.`,
    t.changed > 0 ? `Test debt: ${t.untested} of ${t.changed} changed source files without a test touched.` : 'Test debt: no source files changed this session.',
    docs.exported > 0 ? `Docs coverage in edited files: ${pct(docs.documented, docs.exported)}.` : '',
    rev.total > 0 ? `Review list: ${rev.done}/${rev.total} ticked.` : '',
    intent === undefined ? '' : `Intent today: ${intent.text}${intent.rating === null ? ' (unrated: /pqrate 1-5)' : ` (rated ${intent.rating}/5)`}.`,
    wins.length > 0 ? `Wins: ${wins.map(w => w.text).join('; ')}.` : 'Wins: none logged (/pqwin <text> to add one).',
    soon.length > 0 ? `Goals due soon: ${soon.map(g => g.text).join('; ')}.` : '',
    c.data.plan !== null && c.data.plan.week === week ? `Plan: ${c.data.plan.items.filter(i => i.done).length}/${c.data.plan.items.length} done.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** A compact block to copy by hand. Nothing here sends anything anywhere. */
export const cardText = (c: Ctx): string => {
  const week = isoWeek(c.now)
  const w = weekTotals(c.data.days, week)
  const rev = revProgress(c.data.review)
  const goals = c.data.goals
  const mig = c.data.migration?.points[c.data.migration.points.length - 1]
  const ref = c.data.refactor?.points[c.data.refactor.points.length - 1]
  const winsWeek = c.data.wins.filter(x => isoWeek(x.at) === week).length

  return [
    `Progress ${week}`,
    `calls ${w.calls} · errors/100 ${per100(w.errors, w.calls) ?? 'n/a'}`,
    `todo +${w.todoAdd} -${w.todoDone} · test-debt peak ${w.peakUntested}/${w.peakChanged}`,
    ref === undefined || c.data.refactor === null ? '' : `refactor "${clip(c.data.refactor.pattern, 20)}": ${ref.a} left`,
    mig === undefined ? '' : `migration: ${pct(mig.b, mig.a + mig.b)}`,
    rev.total > 0 ? `review ${rev.done}/${rev.total}` : '',
    `wins ${winsWeek} · goals ${goals.filter(g => g.done).length}/${goals.length}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export const trendText = (c: Ctx): string => {
  const tr = weeklyTrend(c.data.days, c.now, 8)

  return [
    'Errors per 100 tool calls, by week (lower is better):',
    ...tr.map(w => `${w.week}  ${w.per100 === null ? '  -  ' : String(w.per100).padStart(5)}  ${w.errors}/${w.calls}`),
    `${spark(tr.map(w => w.per100))}  from tool results this mod saw (an error is a tool result flagged as an error).`,
  ].join('\n')
}

export const COMMANDS: [name: string, usage: string, description: string][] = [
  ['pq', '/pq', 'This list'],
  ['pqpane', '/pqpane [home|quality|review|track|me|custom]', 'Open the pane (tabs: Home tiles, Quality, Review, Track, Me, Custom)'],
  ['pqtrend', '/pqtrend', '123 Errors per 100 tool calls by week'],
  ['pqrev', '/pqrev [add <text>|tick <n>|untick <n>|del <n>|clear]', '124 Review list with a progress bar'],
  ['pqrefactor', '/pqrefactor [<literal text>|stop]', '125 Count what is left of a literal text (read-only grep -F)'],
  ['pqmigrate', '/pqmigrate [<old> <new>|stop]', '126 Count old and new text over time (quote text with spaces)'],
  ['pqupgrade', '/pqupgrade [npm|pip]', '127 Outdated dependencies (read-only npm outdated / pip list --outdated, 30 s limit, never installs)'],
  ['pqtestdebt', '/pqtestdebt', '128 Changed source files with no test file touched'],
  ['pqdocs', '/pqdocs', '129 Exported functions with a comment, in files edited this session'],
  ['pqclean', '/pqclean', '130 TODO/FIXME added versus removed'],
  ['pqintent', '/pqintent <text>', '131 Say what this session is for'],
  ['pqrate', '/pqrate <1-5>', '131 Rate how the latest intention went'],
  ['pqwrap', '/pqwrap', '132 End-of-day wrap card from your own counters'],
  ['pqplan', '/pqplan [a; b; c|tick <n>|clear]', '133 Monday plan card (three items)'],
  ['pqwin', '/pqwin [text]', '134 Log a win, or list the latest'],
  ['pqcard', '/pqcard', '135 This week as a compact text block (printed here, never sent)'],
  ['pqgoal', '/pqgoal [add <text> @<week|date|+n>|done <n>|del <n>]', '136 Season goals with a due week'],
  ['pqtips', '/pqtips [add <text>|del <n>|on|off]', '189 Your own tips (one toast a day at most, never when calm)'],
  ['pqtpl', '/pqtpl [add <name> <text>|del <name>|<name>|starter]', '190 Your prompt templates; a name fills the prompt box'],
  ['pqrule', '/pqrule [add on <event> toast "<text>" [every <n>m]|del <n>|clear]', '191 Toast rules over turn.complete, tests-pass, tests-fail, commit (max 20)'],
  ['pqkeep', '/pqkeep [<list> <days|default>]', '192 Retention per data list (days, trends, intents, wins)'],
  ['pqtiles', '/pqtiles [show a,b,c|hide <id>|up <id>|down <id>|reset]', '193 Choose and order the Home tiles'],
  ['pqfmt', '/pqfmt [currency <sym>|clock 12|24|units si|iec]', '194 Number formats used by this mod\'s pane'],
  ['pqreset', '/pqreset [all]', 'Clear recorded data (all: your tips, templates, rules, tiles and formats too)'],
]

export const STARTER_TEMPLATES: Template[] = [
  { name: 'explain', text: 'Explain what this code does, step by step, then list anything surprising: ' },
  { name: 'tests', text: 'Write focused tests for the code you just changed. Cover the edge cases, and run them.' },
  { name: 'small', text: 'Make the smallest change that solves this, and tell me what you left alone: ' },
]
