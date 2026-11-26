// Pure logic for ui-two: no `$` in here, so every function is easy to test.
import type { Budget, Card, Col, Data, DayRow, Ev, Goal, Kind, Lib, Notice, PStat, Pomo, Session, Turn, Ui } from '../types'

// ---------------------------------------------------------------- limits (everything recorded is bounded)
export const CAP = { events: 300, days: 90, sessions: 20, turns: 100, samples: 200, files: 150, edges: 200, notices: 50, cards: 60, goals: 30, lib: 50, pstats: 100, cmds: 60 }
export const HOUR = 3_600_000
export const DAY = 86_400_000

/** The default of every switch in features.json (a test and a script keep the two in step). */
export const FEATURE_DEFAULTS: Record<string, boolean> = {
  'record-activity': true,
  'record-prompts': true,
  'record-spend': true,
  'record-turns': true,
  'prompt-excerpts': false,
  'command-bar': true,
  'popover-menu': true,
  'svg-charts': true,
  presentation: true,
  'notice-log': true,
  'budget-warn-80': false,
  'budget-warn-100': false,
  'goal-toasts': false,
  'pomo-toast': false,
  'live-timer': false,
  'digest-morning': false,
}

// ---------------------------------------------------------------- small helpers
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
export const pad2 = (n: number): string => String(n).padStart(2, '0')
export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)
const num = (v: unknown, lo: number, hi: number, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt)
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)
const round = (n: number, p = 100): number => Math.round(n * p) / p
export const usd = (n: number): string => `$${(Number.isFinite(n) && n > 0 ? n : 0).toFixed(2)}`
const KINDS: readonly Kind[] = ['tool', 'edit', 'error', 'prompt']
const COLS: readonly Col[] = ['todo', 'doing', 'done']

export const dayKey = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
export const hhmm = (ms: number): string => {
  const d = new Date(ms)

  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
export const hhmmss = (ms: number): string => `${hhmm(ms)}:${pad2(new Date(ms).getSeconds())}`
export const nextDay = (key: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)

  return m === null ? key : dayKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 12).getTime())
}
export const endOfDay = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(24, 0, 0, 0)

  return d.getTime()
}
export const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))

  if (s < 90) {
    return `${s}s`
  }

  if (s < 5400) {
    return `${Math.round(s / 60)}m`
  }

  return `${round(s / 3600, 10)}h`
}
export const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))

  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}
export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1) || p
export const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '.')

const SPARK = '▁▂▃▄▅▆▇█'
/** A text sparkline: one block per value, scaled to the biggest. */
export const spark = (vals: readonly number[]): string => {
  const max = Math.max(0, ...vals)

  return vals.map(v => (v <= 0 || max <= 0 ? '▁' : SPARK[Math.min(7, Math.floor((v / max) * 7.999))]!)).join('')
}
/** A bar exactly `w` cells wide. */
export const bar = (frac: number, w: number): string => {
  const n = Math.max(0, Math.min(w, Math.round((Number.isFinite(frac) ? frac : 0) * w)))

  return '█'.repeat(n) + '░'.repeat(w - n)
}

/** Keeps the `limit` biggest counts (ties: alphabetical). */
export const boundCounts = (m: Record<string, number>, limit: number): Record<string, number> => {
  const keys = Object.keys(m)

  if (keys.length <= limit) {
    return m
  }
  const keep = keys.sort((a, b) => (m[b]! - m[a]! !== 0 ? m[b]! - m[a]! : a < b ? -1 : 1)).slice(0, limit)
  const out: Record<string, number> = {}

  for (const k of keep) {
    out[k] = m[k]!
  }

  return out
}

// ---------------------------------------------------------------- defaults and validation
export const DEFAULT_CMDS = [
  '/ujfeed',
  '/ujkanban',
  '/ujspend',
  '/ujdigest daily',
  '/ujdigest weekly',
  '/ujprompt list',
  '/ujreplay',
  'Summarize what changed in this session',
  'Run the tests and report only the failures',
]
export const emptyBudget = (): Budget => ({ perDay: 0, carry: 0, asOf: '', w80: '', w100: '' })
export const emptyData = (): Data => ({
  events: [],
  days: {},
  sessions: [],
  turns: [],
  samples: [],
  total: 0,
  lastUsd: null,
  files: {},
  edges: {},
  notices: [],
  noticeSeq: 0,
  cards: [],
  cardSeq: 0,
  goals: [],
  goalSeq: 0,
  lib: [],
  libSeq: 0,
  pstats: [],
  pending: null,
  turnTools: 0,
  turnErrs: 0,
  turnUsd: 0,
  cmds: [...DEFAULT_CMDS],
  budget: emptyBudget(),
  pomo: null,
  lastDigest: '',
})
export const emptyUi = (): Ui => ({
  group: 'activity',
  view: 'overview',
  kind: 'all',
  page: 0,
  sort: 'time',
  dir: 'desc',
  cols: ['time', 'tool', 'file', 'ms', 'ok'],
  pos: -1,
  q: '',
  pop: false,
  calOff: 0,
  win: 60,
  cmp: 'day',
  tag: '',
  msg: '',
  exp: '',
  dig: 'daily',
})

const list = <T>(v: unknown, cap: number, fn: (x: Record<string, unknown>) => T | undefined): T[] => {
  if (!Array.isArray(v)) {
    return []
  }
  const out: T[] = []

  for (const x of v) {
    if (isObj(x)) {
      const r = fn(x)

      if (r !== undefined) {
        out.push(r)
      }
    }
  }

  return out.slice(-cap)
}
const counts = (v: unknown, cap: number): Record<string, number> => {
  const out: Record<string, number> = {}

  if (isObj(v)) {
    for (const k of Object.keys(v)) {
      const n = v[k]

      if (typeof n === 'number' && Number.isFinite(n) && n > 0 && k.length <= 300 && k !== '__proto__') {
        out[k] = Math.min(1e9, Math.round(n))
      }
    }
  }

  return boundCounts(out, cap)
}
const dayRow = (x: unknown): DayRow => {
  const o = isObj(x) ? x : {}

  return { tools: num(o.tools, 0, 1e9, 0), edits: num(o.edits, 0, 1e9, 0), errors: num(o.errors, 0, 1e9, 0), prompts: num(o.prompts, 0, 1e9, 0), usd: num(o.usd, 0, 1e7, 0), pomos: num(o.pomos, 0, 1e6, 0) }
}
const validTag = /^[a-z0-9][a-z0-9-]{0,19}$/
const tagList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((t): t is string => typeof t === 'string' && validTag.test(t)))].slice(0, 6) : [])

/** Turns whatever was stored into a valid Data: bad fields fall back, lists are capped. */
export const sanitize = (v: unknown): Data => {
  const base = emptyData()

  if (!isObj(v)) {
    return base
  }
  const days: Record<string, DayRow> = {}

  if (isObj(v.days)) {
    for (const k of Object.keys(v.days).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-CAP.days)) {
      days[k] = dayRow(v.days[k])
    }
  }
  const events = list<Ev>(v.events, CAP.events, x => {
    const k = KINDS.find(kk => kk === x.k)
    const t = num(x.t, 0, 1e15, -1)

    if (k === undefined || t < 0) {
      return undefined
    }
    const ev: Ev = { t, k, n: str(x.n, 40) ?? '?' }
    const f = str(x.f, 240)

    if (f !== undefined) {
      ev.f = f
    }

    if (typeof x.ms === 'number' && Number.isFinite(x.ms)) {
      ev.ms = num(x.ms, 0, 1e9, 0)
    }

    if (typeof x.ok === 'boolean') {
      ev.ok = x.ok
    }
    const xx = str(x.x, 80)

    if (xx !== undefined) {
      ev.x = xx
    }

    return ev
  })
  const b = isObj(v.budget) ? v.budget : {}
  const dk = (s: unknown) => (typeof s === 'string' && (s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s : '')
  const p = isObj(v.pomo) ? v.pomo : undefined
  const pomo: Pomo | null =
    p !== undefined && (p.kind === 'work' || p.kind === 'break') && typeof p.startedAt === 'number' && typeof p.endsAt === 'number' && Number.isFinite(p.startedAt) && Number.isFinite(p.endsAt)
      ? { kind: p.kind, startedAt: p.startedAt, endsAt: p.endsAt, card: num(p.card, 0, 1e9, 0), task: str(p.task, 120) ?? '' }
      : null
  const pend = isObj(v.pending) ? { tags: tagList(v.pending.tags) } : null

  return {
    ...base,
    events,
    days,
    sessions: list<Session>(v.sessions, CAP.sessions, x => ({ start: num(x.start, 0, 1e15, 0), tools: num(x.tools, 0, 1e9, 0), edits: num(x.edits, 0, 1e9, 0), errors: num(x.errors, 0, 1e9, 0), prompts: num(x.prompts, 0, 1e9, 0), usd: num(x.usd, 0, 1e7, 0) })),
    turns: list<Turn>(v.turns, CAP.turns, x => ({ t: num(x.t, 0, 1e15, 0), model: str(x.model, 60) ?? '?', ms: num(x.ms, 0, 1e9, 0), usd: num(x.usd, 0, 1e6, 0), tools: num(x.tools, 0, 1e6, 0), errs: num(x.errs, 0, 1e6, 0) })),
    samples: list<{ t: number; tot: number }>(v.samples, CAP.samples, x => ({ t: num(x.t, 0, 1e15, 0), tot: num(x.tot, 0, 1e7, 0) })),
    total: num(v.total, 0, 1e7, 0),
    lastUsd: typeof v.lastUsd === 'number' && Number.isFinite(v.lastUsd) ? num(v.lastUsd, 0, 1e7, 0) : null,
    files: counts(v.files, CAP.files),
    edges: counts(v.edges, CAP.edges),
    notices: list<Notice>(v.notices, CAP.notices, x => ({ id: num(x.id, 0, 1e9, 0), t: num(x.t, 0, 1e15, 0), kind: str(x.kind, 20) ?? 'info', text: str(x.text, 200) ?? '', read: x.read === true })),
    noticeSeq: num(v.noticeSeq, 0, 1e9, 0),
    cards: list<Card>(v.cards, CAP.cards, x => {
      const col = COLS.find(c => c === x.col)
      const text = str(x.text, 120)

      return col === undefined || text === undefined || text === '' ? undefined : { id: num(x.id, 0, 1e9, 0), text, col, pomos: num(x.pomos, 0, 1e5, 0) }
    }),
    cardSeq: num(v.cardSeq, 0, 1e9, 0),
    goals: list<Goal>(v.goals, CAP.goals, x => {
      const text = str(x.text, 120)

      return text === undefined || text === '' ? undefined : { id: num(x.id, 0, 1e9, 0), text, due: num(x.due, 0, 1e15, 0), done: x.done === true, fired: x.fired === true }
    }),
    goalSeq: num(v.goalSeq, 0, 1e9, 0),
    lib: list<Lib>(v.lib, CAP.lib, x => {
      const title = str(x.title, 60)
      const text = str(x.text, 2000)

      return title === undefined || text === undefined || title === '' || text === '' ? undefined : { id: num(x.id, 0, 1e9, 0), title, text, tags: tagList(x.tags) }
    }),
    libSeq: num(v.libSeq, 0, 1e9, 0),
    pstats: list<PStat>(v.pstats, CAP.pstats, x => ({ t: num(x.t, 0, 1e15, 0), tags: tagList(x.tags), ms: num(x.ms, 0, 1e9, 0), tools: num(x.tools, 0, 1e6, 0), errs: num(x.errs, 0, 1e6, 0) })),
    pending: pend,
    turnTools: num(v.turnTools, 0, 1e6, 0),
    turnErrs: num(v.turnErrs, 0, 1e6, 0),
    turnUsd: num(v.turnUsd, 0, 1e7, 0),
    cmds: Array.isArray(v.cmds) ? v.cmds.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map(c => c.slice(0, 200)).slice(0, CAP.cmds) : base.cmds,
    budget: { perDay: num(b.perDay, 0, 10000, 0), carry: num(b.carry, 0, 20000, 0), asOf: dk(b.asOf), w80: dk(b.w80), w100: dk(b.w100) },
    pomo,
    lastDigest: dk(v.lastDigest),
  }
}

/** A stored Ui is only ever a hint: anything odd falls back to the default. */
export const sanitizeUi = (v: unknown): Ui => {
  const d = emptyUi()

  if (!isObj(v)) {
    return d
  }
  const s = (x: unknown, ok: readonly string[], f: string) => (typeof x === 'string' && ok.includes(x) ? x : f)

  return {
    ...d,
    group: s(v.group, GROUPS.map(g => g.id), d.group),
    view: s(v.view, VIEWS.map(x => x.id), d.view),
    kind: s(v.kind, ['all', 'tool', 'edit', 'error', 'prompt'], 'all'),
    page: num(v.page, 0, 1000, 0),
    sort: s(v.sort, COLUMNS.map(c => c.id), 'time'),
    dir: v.dir === 'asc' ? 'asc' : 'desc',
    cols: Array.isArray(v.cols) && v.cols.length > 0 ? v.cols.filter((c): c is string => typeof c === 'string' && COLUMNS.some(x => x.id === c)).slice(0, 5) : d.cols,
    pos: num(v.pos, -1, 1000, -1),
    q: str(v.q, 80) ?? '',
    pop: v.pop === true,
    calOff: num(v.calOff, -3, 0, 0),
    win: [15, 60, 360].includes(v.win as number) ? (v.win as number) : 60,
    cmp: s(v.cmp, ['day', 'session'], 'day'),
    tag: str(v.tag, 20) ?? '',
    msg: str(v.msg, 400) ?? '',
    exp: str(v.exp, 70000) ?? '',
    dig: s(v.dig, ['daily', 'weekly'], 'daily'),
  }
}

// ---------------------------------------------------------------- the view switcher
export const GROUPS = [
  { id: 'activity', label: 'Activity' },
  { id: 'charts', label: 'Charts' },
  { id: 'work', label: 'Work' },
  { id: 'prompts', label: 'Prompts' },
]
export const VIEWS: { id: string; label: string; group: string }[] = [
  { id: 'overview', label: 'Overview', group: 'activity' },
  { id: 'feed', label: 'Feed', group: 'activity' },
  { id: 'table', label: 'Table', group: 'activity' },
  { id: 'cards', label: 'Cards', group: 'activity' },
  { id: 'print', label: 'Print', group: 'activity' },
  { id: 'present', label: 'Present', group: 'activity' },
  { id: 'timeline', label: 'Timeline', group: 'charts' },
  { id: 'calendar', label: 'Calendar', group: 'charts' },
  { id: 'treemap', label: 'Treemap', group: 'charts' },
  { id: 'graph', label: 'Graph', group: 'charts' },
  { id: 'compare', label: 'Compare', group: 'charts' },
  { id: 'replay', label: 'Replay', group: 'charts' },
  { id: 'kanban', label: 'Kanban', group: 'work' },
  { id: 'goals', label: 'Goals', group: 'work' },
  { id: 'spend', label: 'Spend', group: 'work' },
  { id: 'digest', label: 'Digest', group: 'work' },
  { id: 'notices', label: 'Notices', group: 'work' },
  { id: 'library', label: 'Library', group: 'prompts' },
  { id: 'stats', label: 'Stats', group: 'prompts' },
  { id: 'models', label: 'Models', group: 'prompts' },
]
export const groupOf = (view: string): string => VIEWS.find(v => v.id === view)?.group ?? 'activity'

// ---------------------------------------------------------------- recorders (data in, data out)
const EDIT_TOOLS = /^(Edit|Write|NotebookEdit)$/
export const isEditTool = (tool: string): boolean => EDIT_TOOLS.test(tool)

const bumpDay = (d: Data, t: number, patch: (r: DayRow) => DayRow): Data => {
  const key = dayKey(t)
  const days = { ...d.days, [key]: patch(d.days[key] ?? dayRow(undefined)) }
  const keys = Object.keys(days).sort()
  const kept: Record<string, DayRow> = {}

  for (const k of keys.slice(-CAP.days)) {
    kept[k] = days[k]!
  }

  return { ...d, days: kept }
}
const bumpSession = (d: Data, patch: (s: Session) => Session): Data => {
  const last = d.sessions[d.sessions.length - 1]

  return last === undefined ? d : { ...d, sessions: [...d.sessions.slice(0, -1), patch(last)] }
}
const pushEvent = (d: Data, ev: Ev): Data => ({ ...d, events: [...d.events, ev].slice(-CAP.events) })

/** A new session starts: one more row in the session list (for the session compare). */
export const startSession = (d: Data, t: number): Data => ({ ...d, sessions: [...d.sessions, { start: t, tools: 0, edits: 0, errors: 0, prompts: 0, usd: 0 }].slice(-CAP.sessions), lastUsd: null })

export const recordCall = (d: Data, c: { t: number; tool: string; file?: string; ms: number; ok: boolean }): Data => {
  const isEdit = isEditTool(c.tool) && c.ok
  const k: Kind = !c.ok ? 'error' : isEdit ? 'edit' : 'tool'
  const ev: Ev = { t: c.t, k, n: c.tool.slice(0, 40), ms: Math.max(0, Math.round(c.ms)), ok: c.ok }

  if (c.file !== undefined && c.file !== '') {
    ev.f = c.file.slice(0, 240)
  }
  let next = pushEvent(d, ev)
  next = bumpDay(next, c.t, r => ({ ...r, tools: r.tools + 1, edits: r.edits + (isEdit ? 1 : 0), errors: r.errors + (c.ok ? 0 : 1) }))
  next = bumpSession(next, s => ({ ...s, tools: s.tools + 1, edits: s.edits + (isEdit ? 1 : 0), errors: s.errors + (c.ok ? 0 : 1) }))
  next = { ...next, turnTools: next.turnTools + 1, turnErrs: next.turnErrs + (c.ok ? 0 : 1) }

  if (ev.f !== undefined) {
    const edges = { ...next.edges }
    const ek = `${ev.n}\t${ev.f}`
    edges[ek] = (edges[ek] ?? 0) + 1
    next = { ...next, edges: boundCounts(edges, CAP.edges) }

    if (isEdit) {
      const files = { ...next.files }
      files[ev.f] = (files[ev.f] ?? 0) + 1
      next = { ...next, files: boundCounts(files, CAP.files) }
    }
  }

  return next
}

export const recordPrompt = (d: Data, c: { t: number; len: number; isCommand: boolean; excerpt?: string }): Data => {
  const ev: Ev = { t: c.t, k: 'prompt', n: c.isCommand ? 'command' : 'prompt', ms: Math.max(0, Math.round(c.len)) }

  if (c.excerpt !== undefined && c.excerpt !== '') {
    ev.x = c.excerpt.replace(/\s+/g, ' ').slice(0, 80)
  }
  let next = pushEvent(d, ev)
  next = bumpDay(next, c.t, r => ({ ...r, prompts: r.prompts + 1 }))
  next = bumpSession(next, s => ({ ...s, prompts: s.prompts + 1 }))

  return next
}

/** A prompt was sent: the per-turn counters restart, and a stored prompt (if it matches) is tracked. */
export const beginTurn = (d: Data, text: string): Data => {
  const hit = matchLib(d, text)

  return { ...d, turnTools: 0, turnErrs: 0, turnUsd: d.total, pending: hit === undefined ? null : { tags: hit.tags } }
}

/** Spend: only the growth of the session's cost is added, so a new session does not double count. */
export const addSpend = (d: Data, cost: number | undefined, t: number, force: boolean): Data => {
  if (cost === undefined || !Number.isFinite(cost) || cost < 0) {
    return d
  }

  if (d.lastUsd === null) {
    return { ...d, lastUsd: cost }
  }
  const delta = Math.round(Math.max(0, cost - d.lastUsd) * 1e6) / 1e6
  let next: Data = { ...d, lastUsd: cost, total: round(d.total + delta, 1e6) }

  if (delta > 0) {
    next = bumpDay(next, t, r => ({ ...r, usd: round(r.usd + delta, 1e6) }))
    next = bumpSession(next, s => ({ ...s, usd: round(s.usd + delta, 1e6) }))
  }
  const last = next.samples[next.samples.length - 1]

  if (force || last === undefined || t - last.t >= 60_000) {
    next = { ...next, samples: [...next.samples, { t, tot: next.total }].slice(-CAP.samples) }
  }

  return next
}

/** One finished turn: model, duration, cost delta, and (for a stored prompt) its effectiveness sample. */
export const recordTurn = (d: Data, c: { t: number; model: string | undefined; ms: number }): Data => {
  const turn: Turn = { t: c.t, model: (c.model ?? '').trim() === '' ? '(not reported)' : c.model!.slice(0, 60), ms: Math.max(0, Math.round(c.ms)), usd: round(Math.max(0, d.total - d.turnUsd), 1e6), tools: d.turnTools, errs: d.turnErrs }
  let next: Data = { ...d, turns: [...d.turns, turn].slice(-CAP.turns) }

  if (d.pending !== null) {
    next = { ...next, pstats: [...next.pstats, { t: c.t, tags: d.pending.tags, ms: turn.ms, tools: turn.tools, errs: turn.errs }].slice(-CAP.pstats), pending: null }
  }

  return next
}

export const addNotice = (d: Data, kind: string, text: string, t: number): Data => ({
  ...d,
  noticeSeq: d.noticeSeq + 1,
  notices: [...d.notices, { id: d.noticeSeq + 1, t, kind: kind.slice(0, 20), text: text.slice(0, 200), read: false }].slice(-CAP.notices),
})
export const setRead = (d: Data, id: number | 'all', read: boolean): Data => ({ ...d, notices: d.notices.map(n => (id === 'all' || n.id === id ? { ...n, read } : n)) })
export const unread = (d: Data): number => d.notices.filter(n => !n.read).length

// ---------------------------------------------------------------- budget guard with rollover (253)
export const rolloverCap = (perDay: number): number => perDay * 2
/** Moves the budget's day forward: each full day's unspent allowance rolls into the next, up to the cap. */
export const rollBudget = (b: Budget, days: Record<string, DayRow>, today: string): Budget => {
  if (b.perDay <= 0) {
    return b
  }

  if (b.asOf === '' || b.asOf > today) {
    return { ...b, asOf: today }
  }
  let cur = b.asOf
  let carry = b.carry
  let guard = 0

  while (cur < today && guard++ < 200) {
    carry = Math.min(rolloverCap(b.perDay), Math.max(0, b.perDay + carry - (days[cur]?.usd ?? 0)))
    cur = nextDay(cur)
  }

  return { ...b, carry: round(carry, 100), asOf: today }
}
export const parseUsd = (s: string): number | undefined => {
  const m = /^\$?(\d{1,5}(?:\.\d{1,2})?)$/.exec(s.trim())

  return m === null ? undefined : Number(m[1])
}
export const setBudget = (d: Data, perDay: number, t: number): Data => ({ ...d, budget: perDay <= 0 ? emptyBudget() : { perDay, carry: 0, asOf: dayKey(t), w80: '', w100: '' } })
export type BudgetStatus = { perDay: number; carry: number; allowance: number; spent: number; pct: number; left: number; cap: number }
export const budgetStatus = (d: Data, t: number): BudgetStatus => {
  const b = rollBudget(d.budget, d.days, dayKey(t))
  const spent = d.days[dayKey(t)]?.usd ?? 0
  const allowance = b.perDay + b.carry

  return { perDay: b.perDay, carry: b.carry, allowance, spent, pct: allowance > 0 ? (spent / allowance) * 100 : 0, left: Math.max(0, allowance - spent), cap: rolloverCap(b.perDay) }
}
/** Rolls the budget forward and says which warnings are newly due (80 and 100 percent, once per day each). */
export const budgetCheck = (d: Data, t: number): { d: Data; fire: (80 | 100)[]; status: BudgetStatus } => {
  if (d.budget.perDay <= 0) {
    return { d, fire: [], status: budgetStatus(d, t) }
  }
  const today = dayKey(t)
  let next: Data = { ...d, budget: rollBudget(d.budget, d.days, today) }
  const status = budgetStatus(next, t)
  const fire: (80 | 100)[] = []

  if (status.pct >= 100 && next.budget.w100 !== today) {
    fire.push(100)
    next = { ...next, budget: { ...next.budget, w100: today, w80: today } }
  } else if (status.pct >= 80 && status.pct < 100 && next.budget.w80 !== today) {
    fire.push(80)
    next = { ...next, budget: { ...next.budget, w80: today } }
  }

  return { d: next, fire, status }
}

// ---------------------------------------------------------------- cost forecast (252)
export type Forecast = { ok: boolean; why?: string; spent: number; rate: number; hoursLeft: number; projected: number }
/** A plain linear estimate: the average rate over about the last hour, carried forward (at most 8 more hours of today). */
export const forecast = (d: Data, now: number): Forecast => {
  const spent = d.days[dayKey(now)]?.usd ?? 0
  const base = [...d.samples].reverse().find(s => s.t <= now - HOUR) ?? d.samples[0]

  if (base === undefined || now - base.t < 10 * 60_000) {
    return { ok: false, why: 'Not enough samples yet: needs about 10 minutes of recorded spend.', spent, rate: 0, hoursLeft: 0, projected: spent }
  }
  const rate = Math.max(0, (d.total - base.tot) / ((now - base.t) / HOUR))
  const hoursLeft = Math.max(0, Math.min(8, (endOfDay(now) - now) / HOUR))

  return { ok: true, spent, rate, hoursLeft, projected: spent + rate * hoursLeft }
}

// ---------------------------------------------------------------- focus score (260)
export const focusScore = (d: Data, now: number): { pct: number; dir: string; n: number } => {
  const tally: Record<string, number> = {}
  let n = 0

  for (const e of d.events) {
    if (e.k !== 'prompt' && e.f !== undefined && e.t >= now - HOUR) {
      const dir = dirOf(e.f)
      tally[dir] = (tally[dir] ?? 0) + 1
      n += 1
    }
  }
  const top = Object.keys(tally).sort((a, b) => tally[b]! - tally[a]! || (a < b ? -1 : 1))[0]

  return top === undefined || n === 0 ? { pct: 0, dir: '', n: 0 } : { pct: Math.round((tally[top]! / n) * 100), dir: top, n }
}

// ---------------------------------------------------------------- feed (240), table (243), cards (244)
export const feedKinds = ['all', 'tool', 'edit', 'error', 'prompt']
export const feedItems = (d: Data, kind: string): Ev[] => [...d.events].reverse().filter(e => kind === 'all' || e.k === kind)
export const eventLine = (e: Ev): string => {
  const what = e.k === 'prompt' ? `${e.n} ${e.ms ?? 0} chars${e.x !== undefined ? `: ${e.x}` : ''}` : `${e.n}${e.f !== undefined ? ` ${baseName(e.f)}` : ''}${e.ms !== undefined ? ` ${e.ms}ms` : ''}`

  return `${hhmmss(e.t)} ${e.k.padEnd(6)} ${what}`
}
export const paged = <T>(items: readonly T[], page: number, size: number): { rows: T[]; page: number; pages: number } => {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const p = Math.max(0, Math.min(pages - 1, page))

  return { rows: items.slice(p * size, p * size + size), page: p, pages }
}

export const COLUMNS = [
  { id: 'time', label: 'Time', w: 8 },
  { id: 'tool', label: 'Tool', w: 10 },
  { id: 'file', label: 'File', w: 22 },
  { id: 'ms', label: 'ms', w: 6 },
  { id: 'ok', label: 'Result', w: 6 },
]
export const toggleCol = (cols: string[], id: string): string[] => {
  const on = cols.includes(id)

  if (on && cols.length === 1) {
    return cols
  }

  return COLUMNS.map(c => c.id).filter(c => (c === id ? !on : cols.includes(c)))
}
export const tableEvents = (d: Data): Ev[] => d.events.filter(e => e.k !== 'prompt')
export const sortEvents = (rows: Ev[], sort: string, dir: 'asc' | 'desc'): Ev[] => {
  const key = (e: Ev): number | string => (sort === 'tool' ? e.n : sort === 'file' ? (e.f !== undefined ? baseName(e.f) : '') : sort === 'ms' ? (e.ms ?? 0) : sort === 'ok' ? (e.ok === false ? 0 : 1) : e.t)
  const out = rows.map((e, i) => ({ e, i, k: key(e) }))
  out.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))

  return (dir === 'asc' ? out : out.reverse()).map(x => x.e)
}
export const cell = (e: Ev, col: string): string =>
  col === 'time' ? hhmmss(e.t) : col === 'tool' ? e.n : col === 'file' ? (e.f !== undefined ? baseName(e.f) : '') : col === 'ms' ? String(e.ms ?? '') : e.ok === false ? 'failed' : 'ok'
export const tableLine = (e: Ev, cols: string[]): string => COLUMNS.filter(c => cols.includes(c.id)).map(c => clip(cell(e, c.id), c.w).padEnd(c.w)).join(' ')
export const headerLabel = (id: string, sort: string, dir: 'asc' | 'desc'): string => `${COLUMNS.find(c => c.id === id)?.label ?? id}${sort === id ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}`

export type ToolCard = { name: string; n: number; errs: number; avgMs: number; recent: number[] }
export const toolCards = (d: Data, now: number): ToolCard[] => {
  const by: Record<string, ToolCard> = {}

  for (const e of d.events) {
    if (e.k === 'prompt') {
      continue
    }
    const c = (by[e.n] ??= { name: e.n, n: 0, errs: 0, avgMs: 0, recent: Array<number>(8).fill(0) })
    c.avgMs = (c.avgMs * c.n + (e.ms ?? 0)) / (c.n + 1)
    c.n += 1
    c.errs += e.k === 'error' ? 1 : 0
    const slot = 7 - Math.floor((now - e.t) / 600_000)

    if (slot >= 0 && slot <= 7) {
      c.recent[slot] = (c.recent[slot] ?? 0) + 1
    }
  }

  return Object.values(by).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1)).slice(0, 12)
}

// ---------------------------------------------------------------- calendar (245)
export type CalCell = { day: number; key: string; n: number } | null
export const calendar = (d: Data, now: number, off: number): { title: string; weeks: CalCell[][]; max: number } => {
  const base = new Date(now)
  const first = new Date(base.getFullYear(), base.getMonth() + off, 1, 12)
  const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const cells: CalCell[] = Array<CalCell>(lead).fill(null)
  let max = 0

  for (let day = 1; day <= dim; day++) {
    const key = `${first.getFullYear()}-${pad2(first.getMonth() + 1)}-${pad2(day)}`
    const n = d.days[key]?.tools ?? 0
    max = Math.max(max, n)
    cells.push({ day, key, n })
  }

  while (cells.length % 7 !== 0) {
    cells.push(null)
  }
  const weeks: CalCell[][] = []

  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  return { title: `${names[first.getMonth()]} ${first.getFullYear()}`, weeks, max }
}
export const calText = (c: CalCell, max: number): string => {
  if (c === null) {
    return '      '
  }
  const shade = c.n <= 0 || max <= 0 ? '·' : '░▒▓█'[Math.min(3, Math.floor((c.n / max) * 3.999))]!

  return `${pad2(c.day)}${shade}${String(Math.min(999, c.n)).padStart(3)}`
}

// ---------------------------------------------------------------- compare (248)
export type CompareRow = { label: string; a: number; b: number; isMoney: boolean }
export const compare = (d: Data, mode: string, now: number): { aLabel: string; bLabel: string; rows: CompareRow[] } => {
  const row = (r: { tools: number; edits: number; errors: number; prompts: number; usd: number } | undefined) => r ?? { tools: 0, edits: 0, errors: 0, prompts: 0, usd: 0 }
  let a: ReturnType<typeof row>
  let b: ReturnType<typeof row>
  let aLabel: string
  let bLabel: string

  if (mode === 'session') {
    a = row(d.sessions[d.sessions.length - 2])
    b = row(d.sessions[d.sessions.length - 1])
    aLabel = d.sessions.length >= 2 ? 'previous session' : 'previous session (none yet)'
    bLabel = 'this session'
  } else {
    a = row(d.days[dayKey(now - DAY)])
    b = row(d.days[dayKey(now)])
    aLabel = 'yesterday'
    bLabel = 'today'
  }

  return {
    aLabel,
    bLabel,
    rows: [
      { label: 'Tool calls', a: a.tools, b: b.tools, isMoney: false },
      { label: 'Edits', a: a.edits, b: b.edits, isMoney: false },
      { label: 'Errors', a: a.errors, b: b.errors, isMoney: false },
      { label: 'Prompts', a: a.prompts, b: b.prompts, isMoney: false },
      { label: 'Spend (est.)', a: a.usd, b: b.usd, isMoney: true },
    ],
  }
}

// ---------------------------------------------------------------- replay (251)
export const replayPos = (d: Data, pos: number): number => (d.events.length === 0 ? -1 : pos < 0 ? d.events.length - 1 : Math.min(pos, d.events.length - 1))
export const replayState = (d: Data, pos: number): { at: number; total: number; ev: Ev | undefined; so: Record<Kind, number>; before: Ev[]; after: Ev[] } => {
  const at = replayPos(d, pos)
  const so: Record<Kind, number> = { tool: 0, edit: 0, error: 0, prompt: 0 }

  for (let i = 0; i <= at; i++) {
    so[d.events[i]!.k] += 1
  }

  return { at, total: d.events.length, ev: d.events[at], so, before: d.events.slice(Math.max(0, at - 3), Math.max(0, at)), after: d.events.slice(at + 1, at + 4) }
}

// ---------------------------------------------------------------- print (249) and presentation (250)
export const printLines = (d: Data, now: number, limit: number): string[] => {
  const out = [`ui-two activity, plain text. Printed ${dayKey(now)} ${hhmm(now)}.`, '']

  for (const e of d.events.slice(-limit)) {
    out.push(`${dayKey(e.t)} ${eventLine(e)}${e.f !== undefined && e.k !== 'prompt' ? ` (${e.f})` : ''}`)
  }

  if (d.events.length === 0) {
    out.push('Nothing recorded yet.')
  }

  return out
}
/** The presentation view: large figures only. No file names, tool names, prompts or paths ever go in. */
export const presentFigures = (d: Data, now: number): { label: string; value: string }[] => {
  const t = d.days[dayKey(now)] ?? dayRow(undefined)
  const f = focusScore(d, now)

  return [
    { label: 'Tool calls today', value: String(t.tools) },
    { label: 'Edits today', value: String(t.edits) },
    { label: 'Errors today', value: String(t.errors) },
    { label: 'Spend today (est.)', value: usd(t.usd) },
    { label: 'Focus, last hour', value: f.n === 0 ? '-' : `${f.pct}%` },
    { label: 'Pomodoros today', value: String(t.pomos) },
  ]
}

// ---------------------------------------------------------------- digest (257)
const sum = (d: Data, keys: string[]) => {
  const t = { tools: 0, edits: 0, errors: 0, prompts: 0, usd: 0, pomos: 0 }

  for (const k of keys) {
    const r = d.days[k]

    if (r !== undefined) {
      t.tools += r.tools
      t.edits += r.edits
      t.errors += r.errors
      t.prompts += r.prompts
      t.usd += r.usd
      t.pomos += r.pomos
    }
  }

  return t
}
export const lastDays = (now: number, n: number): string[] => Array.from({ length: n }, (_, i) => dayKey(now - (n - 1 - i) * DAY))
export const digestText = (d: Data, now: number, kind: string): string => {
  const weekly = kind === 'weekly'
  const keys = lastDays(now, weekly ? 7 : 1)
  const t = sum(d, keys)
  const prev = sum(d, weekly ? lastDays(now - 7 * DAY, 7) : [dayKey(now - DAY)])
  const lines = [`${weekly ? 'Weekly' : 'Daily'} digest, ${weekly ? `${keys[0]} to ${keys[6]}` : keys[0]}`]
  const delta = (a: number, b: number) => (b === 0 ? '' : ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}% vs ${weekly ? 'the week before' : 'yesterday'})`)
  lines.push(`Tool calls ${t.tools}${delta(t.tools, prev.tools)}, edits ${t.edits}, errors ${t.errors}, prompts ${t.prompts}.`)
  lines.push(`Spend ${usd(t.usd)}${delta(t.usd, prev.usd)} (a client-side estimate). Pomodoros ${t.pomos}.`)

  if (weekly) {
    const per = keys.map(k => d.days[k]?.tools ?? 0)
    const best = keys[per.indexOf(Math.max(...per))]
    lines.push(`Tool calls per day: ${spark(per)} ${per.join(' ')}${Math.max(...per) > 0 ? `; busiest ${best}` : ''}.`)
  }
  const since = weekly ? now - 7 * DAY : new Date(now).setHours(0, 0, 0, 0)
  const tally: Record<string, number> = {}

  for (const e of d.events) {
    if (e.k !== 'prompt' && e.t >= since) {
      tally[e.n] = (tally[e.n] ?? 0) + 1
    }
  }
  const top = Object.keys(tally).sort((a, b) => tally[b]! - tally[a]! || (a < b ? -1 : 1)).slice(0, 3)
  lines.push(top.length === 0 ? 'Top tools: none recorded in the kept events.' : `Top tools (kept events): ${top.map(x => `${x} ${tally[x]}`).join(', ')}.`)
  const turns = d.turns.filter(x => x.t >= since)
  lines.push(turns.length === 0 ? 'Turns: none recorded.' : `Turns ${turns.length}, average ${fmtDur(turns.reduce((a, x) => a + x.ms, 0) / turns.length)}.`)
  const open = d.goals.filter(g => !g.done)
  lines.push(open.length === 0 ? 'Goals: none open.' : `Goals open ${open.length}; next: ${open.sort((a, b) => a.due - b.due)[0]!.text} (${dueText(open[0]!.due, now)}).`)
  lines.push(`Kanban: ${COLS.map(c => `${c} ${d.cards.filter(x => x.col === c).length}`).join(', ')}.`)

  return lines.join('\n')
}

// ---------------------------------------------------------------- goals (258)
export const dueText = (due: number, now: number): string => (due >= now ? `in ${fmtDur(due - now)}` : `overdue ${fmtDur(now - due)}`)
export const parseGoal = (arg: string, now: number): { due: number; text: string } | { error: string } => {
  const rel = /^\+(\d{1,3})([mhd])\s+([\s\S]+)$/.exec(arg.trim())
  let due: number
  let text: string

  if (rel !== null) {
    due = now + Number(rel[1]) * { m: 60_000, h: HOUR, d: DAY }[rel[2] as 'm' | 'h' | 'd']
    text = rel[3]!
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?\s+([\s\S]+)$/.exec(arg.trim())

    if (m === null) {
      return { error: 'Use: <YYYY-MM-DD [HH:MM]> <goal> or +30m / +2h / +3d <goal>.' }
    }
    const [y, mo, da, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 9), Number(m[5] ?? 0)]
    const dt = new Date(y, mo - 1, da, h, mi)

    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da || h > 23 || mi > 59) {
      return { error: 'That is not a real date and time.' }
    }
    due = dt.getTime()
    text = m[6]!
  }
  text = text.trim().replace(/\s+/g, ' ')

  if (text === '' || text.length > 120) {
    return { error: 'A goal needs 1 to 120 characters of text.' }
  }

  if (due > now + 5 * 365 * DAY || due < now - 365 * DAY) {
    return { error: 'Pick a due date within the next five years.' }
  }

  return { due, text }
}
export const addGoal = (d: Data, due: number, text: string): Data | undefined =>
  d.goals.length >= CAP.goals ? undefined : { ...d, goalSeq: d.goalSeq + 1, goals: [...d.goals, { id: d.goalSeq + 1, text, due, done: false, fired: false }] }
/** Goals whose due time has come and that were not yet announced. */
export const dueGoals = (d: Data, now: number): Goal[] => d.goals.filter(g => !g.done && !g.fired && g.due <= now)
export const markFired = (d: Data, ids: number[]): Data => ({ ...d, goals: d.goals.map(g => (ids.includes(g.id) ? { ...g, fired: true } : g)) })

// ---------------------------------------------------------------- kanban (242)
export const COL_LABEL: Record<Col, string> = { todo: 'Todo', doing: 'Doing', done: 'Done' }
export const COL_LIST: readonly Col[] = COLS
export const addCard = (d: Data, text: string): Data | undefined => {
  const t = text.trim().replace(/\s+/g, ' ').slice(0, 120)

  return t === '' || d.cards.length >= CAP.cards ? undefined : { ...d, cardSeq: d.cardSeq + 1, cards: [...d.cards, { id: d.cardSeq + 1, text: t, col: 'todo', pomos: 0 }] }
}
export const moveCard = (d: Data, id: number, by: -1 | 1): Data => ({
  ...d,
  cards: d.cards.map(c => (c.id === id ? { ...c, col: COLS[Math.max(0, Math.min(2, COLS.indexOf(c.col) + by))]! } : c)),
})
export const removeCard = (d: Data, id: number): Data => ({ ...d, cards: d.cards.filter(c => c.id !== id), pomo: d.pomo !== null && d.pomo.card === id ? { ...d.pomo, card: 0 } : d.pomo })

// ---------------------------------------------------------------- pomodoro (259)
export const startPomo = (d: Data, c: { kind: 'work' | 'break'; minutes: number; card: number; now: number }): Data => {
  const card = d.cards.find(x => x.id === c.card)
  const minutes = Math.max(1, Math.min(120, Math.round(c.minutes)))

  return { ...d, pomo: { kind: c.kind, startedAt: c.now, endsAt: c.now + minutes * 60_000, card: card?.id ?? 0, task: card?.text ?? '' } }
}
export const finishPomo = (d: Data, now: number): Data => {
  const p = d.pomo

  if (p === null) {
    return d
  }
  let next: Data = { ...d, pomo: null }

  if (p.kind === 'work') {
    next = bumpDay(next, now, r => ({ ...r, pomos: r.pomos + 1 }))
    next = { ...next, cards: next.cards.map(c => (c.id === p.card ? { ...c, pomos: c.pomos + 1 } : c)) }
  }

  return next
}
export const pomoLeft = (p: Pomo | null, now: number): number => (p === null ? 0 : Math.max(0, p.endsAt - now))

// ---------------------------------------------------------------- command bar (238) and command list
export const cmdMatches = (cmds: string[], q: string, n: number): string[] => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)

  return cmds.filter(c => words.every(w => c.toLowerCase().includes(w))).slice(0, n)
}

// ---------------------------------------------------------------- prompt library (254, 255)
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/
export type LibDraft = { title: string; text: string; tags: string[] }
/** `<title> :: <text> #tag #tag`: tags are the trailing #words. */
export const parsePromptAdd = (arg: string): LibDraft | { error: string } => {
  const m = /^([^:]{1,60}?)\s*::\s*([\s\S]+)$/.exec(arg.trim())

  if (m === null) {
    return { error: 'Use: <title> :: <prompt text> #tag #tag' }
  }
  const tail = /(?:\s+#[a-z0-9][a-z0-9-]{0,19})+\s*$/.exec(m[2]!)
  const tags = tail === null ? [] : [...new Set(tail[0].trim().split(/\s+/).map(t => t.slice(1)))]
  const text = (tail === null ? m[2]! : m[2]!.slice(0, tail.index)).trim()
  const title = m[1]!.trim()

  if (title === '' || title.length > 60 || CTRL.test(title) || text === '' || text.length > 2000 || CTRL.test(text)) {
    return { error: 'A title is 1 to 60 characters and the text 1 to 2000, with no control characters.' }
  }

  if (tags.length > 6) {
    return { error: 'At most 6 tags per prompt.' }
  }

  return { title, text, tags }
}
export const addLib = (d: Data, item: LibDraft): Data | { error: string } => {
  if (d.lib.length >= CAP.lib) {
    return { error: `The library is full (${CAP.lib}).` }
  }

  if (d.lib.some(l => l.title === item.title)) {
    return { error: 'A prompt with that title exists already.' }
  }

  return { ...d, libSeq: d.libSeq + 1, lib: [...d.lib, { id: d.libSeq + 1, ...item }] }
}
export const matchLib = (d: Data, text: string): Lib | undefined => d.lib.find(l => l.text === text.trim())

export const EXPORT_FORMAT = 'uj-prompts'
/** Strict JSON text: {"format":"uj-prompts","version":1,"prompts":[{"title","text","tags"}]}. */
export const exportPrompts = (d: Data): string => JSON.stringify({ format: EXPORT_FORMAT, version: 1, prompts: d.lib.map(l => ({ title: l.title, text: l.text, tags: l.tags })) })
const sameKeys = (o: Record<string, unknown>, keys: string[]): boolean => {
  const have = Object.keys(o).sort()

  return have.length === keys.length && [...keys].sort().every((k, i) => k === have[i])
}
export const importPrompts = (d: Data, raw: string): { ok: true; data: Data; added: number; skipped: number } | { ok: false; error: string } => {
  const text = raw.trim()

  if (text === '' || text.length > 120_000) {
    return { ok: false, error: 'Paste the exported JSON (up to 120000 characters).' }
  }
  let v: unknown

  try {
    v = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That is not valid JSON.' }
  }

  if (!isObj(v) || !sameKeys(v, ['format', 'version', 'prompts'])) {
    return { ok: false, error: 'Expected exactly the keys format, version and prompts.' }
  }

  if (v.format !== EXPORT_FORMAT || v.version !== 1) {
    return { ok: false, error: `Expected format "${EXPORT_FORMAT}" version 1.` }
  }

  if (!Array.isArray(v.prompts) || v.prompts.length > CAP.lib) {
    return { ok: false, error: `prompts must be a list of at most ${CAP.lib}.` }
  }
  const items: LibDraft[] = []

  for (const [i, p] of v.prompts.entries()) {
    if (!isObj(p) || !sameKeys(p, ['title', 'text', 'tags'])) {
      return { ok: false, error: `Prompt ${i + 1}: expected exactly title, text and tags.` }
    }

    if (typeof p.title !== 'string' || p.title.trim() === '' || p.title.length > 60 || CTRL.test(p.title) || p.title !== p.title.trim()) {
      return { ok: false, error: `Prompt ${i + 1}: title must be 1 to 60 characters, trimmed, without control characters.` }
    }

    if (typeof p.text !== 'string' || p.text.trim() === '' || p.text.length > 2000 || CTRL.test(p.text)) {
      return { ok: false, error: `Prompt ${i + 1}: text must be 1 to 2000 characters without control characters.` }
    }

    if (!Array.isArray(p.tags) || p.tags.length > 6 || !p.tags.every(t => typeof t === 'string' && validTag.test(t)) || new Set(p.tags).size !== p.tags.length) {
      return { ok: false, error: `Prompt ${i + 1}: tags must be up to 6 unique words like "review" or "ship-it".` }
    }
    items.push({ title: p.title, text: p.text, tags: p.tags as string[] })
  }
  let next = d
  let added = 0
  let skipped = 0

  for (const it of items) {
    if (next.lib.some(l => l.title === it.title && l.text === it.text)) {
      skipped += 1
      continue
    }
    const r = addLib(next, it)

    if ('error' in r) {
      return { ok: false, error: `Prompt "${it.title}": ${r.error} Nothing was imported.` }
    }
    next = r
    added += 1
  }

  return { ok: true, data: next, added, skipped }
}

export type TagStat = { tag: string; n: number; avgMs: number; avgTools: number; avgErrs: number }
/** Averages per tag for prompts sent from the library. A heuristic: a handful of turns is noise. */
export const tagStats = (d: Data): TagStat[] => {
  const by: Record<string, { n: number; ms: number; tools: number; errs: number }> = {}

  for (const s of d.pstats) {
    for (const tag of s.tags.length === 0 ? ['untagged'] : s.tags) {
      const r = (by[tag] ??= { n: 0, ms: 0, tools: 0, errs: 0 })
      r.n += 1
      r.ms += s.ms
      r.tools += s.tools
      r.errs += s.errs
    }
  }

  return Object.keys(by)
    .map(tag => ({ tag, n: by[tag]!.n, avgMs: by[tag]!.ms / by[tag]!.n, avgTools: by[tag]!.tools / by[tag]!.n, avgErrs: by[tag]!.errs / by[tag]!.n }))
    .sort((a, b) => b.n - a.n || (a.tag < b.tag ? -1 : 1))
}

// ---------------------------------------------------------------- model comparison log (256)
export type ModelStat = { model: string; n: number; avgMs: number; avgUsd: number; totalUsd: number }
export const modelStats = (d: Data): ModelStat[] => {
  const by: Record<string, { n: number; ms: number; usd: number }> = {}

  for (const t of d.turns) {
    const r = (by[t.model] ??= { n: 0, ms: 0, usd: 0 })
    r.n += 1
    r.ms += t.ms
    r.usd += t.usd
  }

  return Object.keys(by)
    .map(model => ({ model, n: by[model]!.n, avgMs: by[model]!.ms / by[model]!.n, avgUsd: by[model]!.usd / by[model]!.n, totalUsd: by[model]!.usd }))
    .sort((a, b) => b.n - a.n || (a.model < b.model ? -1 : 1))
}

// ---------------------------------------------------------------- the overview's tooltips (236): daily series
export type Tip = { id: string; label: string; value: string; series: number[]; dayLabels: string[]; unit: string }
export const tips = (d: Data, now: number): Tip[] => {
  const keys = lastDays(now, 14)
  const get = (f: (r: DayRow) => number) => keys.map(k => (d.days[k] === undefined ? 0 : f(d.days[k]!)))
  const t = d.days[dayKey(now)] ?? dayRow(undefined)

  return [
    { id: 'tools', label: 'Tool calls', value: String(t.tools), series: get(r => r.tools), dayLabels: keys, unit: 'calls' },
    { id: 'edits', label: 'Edits', value: String(t.edits), series: get(r => r.edits), dayLabels: keys, unit: 'edits' },
    { id: 'errors', label: 'Errors', value: String(t.errors), series: get(r => r.errors), dayLabels: keys, unit: 'errors' },
    { id: 'prompts', label: 'Prompts', value: String(t.prompts), series: get(r => r.prompts), dayLabels: keys, unit: 'prompts' },
    { id: 'spend', label: 'Spend (est.)', value: usd(t.usd), series: get(r => r.usd), dayLabels: keys, unit: 'USD' },
    { id: 'pomos', label: 'Pomodoros', value: String(t.pomos), series: get(r => r.pomos), dayLabels: keys, unit: 'pomodoros' },
  ]
}

// ---------------------------------------------------------------- timeline (241)
export type Band = { kind: Kind; buckets: number[]; max: number }
/** 60 buckets across the last `win` minutes, one band per event kind. */
export const timelineBands = (d: Data, now: number, win: number): Band[] => {
  const span = win * 60_000
  const size = span / 60
  const bands: Band[] = KINDS.map(kind => ({ kind, buckets: Array<number>(60).fill(0), max: 0 }))

  for (const e of d.events) {
    const age = now - e.t

    if (age >= 0 && age < span) {
      const b = bands[KINDS.indexOf(e.k)]!
      const i = 59 - Math.floor(age / size)
      b.buckets[i] = (b.buckets[i] ?? 0) + 1
    }
  }

  for (const b of bands) {
    b.max = Math.max(0, ...b.buckets)
  }

  return bands
}

// ---------------------------------------------------------------- treemap (246) and graph (247) layouts
export type Rect = { x: number; y: number; w: number; h: number; label: string; count: number; kind: 'dir' | 'file'; full: string }
/** Slice-and-dice: directories side by side, the files of each one stacked inside it. */
export const treemap = (files: Record<string, number>, W: number, H: number): Rect[] => {
  const byDir: Record<string, { name: string; full: string; n: number }[]> = {}

  for (const p of Object.keys(files)) {
    ;(byDir[dirOf(p)] ??= []).push({ name: baseName(p), full: p, n: files[p]! })
  }
  const dirs = Object.keys(byDir)
    .map(dir => ({ dir, items: byDir[dir]!.sort((a, b) => b.n - a.n), total: byDir[dir]!.reduce((s, x) => s + x.n, 0) }))
    .sort((a, b) => b.total - a.total || (a.dir < b.dir ? -1 : 1))
    .slice(0, 8)
  const grand = dirs.reduce((s, x) => s + x.total, 0)
  const out: Rect[] = []

  if (grand === 0) {
    return out
  }
  let x = 0

  for (const [i, dd] of dirs.entries()) {
    const w = i === dirs.length - 1 ? W - x : (dd.total / grand) * W
    out.push({ x, y: 0, w, h: H, label: baseName(dd.dir) === '.' ? '.' : baseName(dd.dir), count: dd.total, kind: 'dir', full: dd.dir })
    const head = H > 60 ? 16 : 0
    const shown = dd.items.slice(0, 6)
    const rest = dd.items.slice(6).reduce((s, v) => s + v.n, 0)
    const items = rest > 0 ? [...shown, { name: 'other', full: dd.dir, n: rest }] : shown
    let y = head

    for (const [j, f] of items.entries()) {
      const h = j === items.length - 1 ? H - y : ((H - head) * f.n) / dd.total

      out.push({ x: x + 1, y: y + 1, w: Math.max(0, w - 2), h: Math.max(0, h - 2), label: f.name, count: f.n, kind: 'file', full: f.full })
      y += h
    }
    x += w
  }

  return out
}

export type GNode = { id: string; label: string; full: string; y: number; n: number; side: 'l' | 'r' }
export type GLink = { from: string; to: string; n: number }
/** Two columns: tools on the left, files on the right, links as many as the edges that remain. */
export const graph = (edges: Record<string, number>): { tools: GNode[]; files: GNode[]; links: GLink[] } => {
  const toolW: Record<string, number> = {}
  const fileW: Record<string, number> = {}
  const all: { tool: string; file: string; n: number }[] = []

  for (const k of Object.keys(edges)) {
    const [tool, file] = k.split('\t')

    if (tool !== undefined && file !== undefined) {
      all.push({ tool, file, n: edges[k]! })
      toolW[tool] = (toolW[tool] ?? 0) + edges[k]!
      fileW[file] = (fileW[file] ?? 0) + edges[k]!
    }
  }
  const top = (w: Record<string, number>, n: number) => Object.keys(w).sort((a, b) => w[b]! - w[a]! || (a < b ? -1 : 1)).slice(0, n)
  const tools = top(toolW, 6)
  const files = top(fileW, 8)
  const place = (names: string[], w: Record<string, number>, side: 'l' | 'r', label: (s: string) => string): GNode[] => names.map((id, i) => ({ id, label: label(id), full: id, y: 24 + i * (side === 'l' ? 40 : 30), n: w[id]!, side }))

  return {
    tools: place(tools, toolW, 'l', s => s),
    files: place(files, fileW, 'r', baseName),
    links: all.filter(e => tools.includes(e.tool) && files.includes(e.file)).map(e => ({ from: e.tool, to: e.file, n: e.n })),
  }
}
