// Pure renderers and recorders for charts-more. No `$`, no clock: every function takes what it needs.
// A chart is a list of Rows; a Row is a list of Segs (a run of text with one style). The pane draws them.
import type { CostSample, Data, Day, Note } from '../types'

export type Seg = { t: string; c?: string; d?: boolean; b?: boolean }
export type Row = Seg[]
export type Chart = { title: string; rows: Row[]; note?: string }
export type Limit = { kind: string; pct: number; resetsAt?: string }
export type UsageLite = { ctxPct?: number; limits: Limit[]; usd?: number }
/** What a chart needs to draw itself. `p` is the entrance progress, 0 to 1 (1 when settled or animation is off). */
export type Ctx = { data: Data; usage: UsageLite; now: number; cols: number; p: number }

// ---------------------------------------------------------------- limits (every record is bounded)
export const CAP = {
  turns: 200,
  turnAt: 300,
  perTool: 60,
  tools: 24,
  toolTotal: 30,
  words: 200,
  notes: 60,
  dirs: 200,
  cost: 120,
  days: 30,
  blob: 1500,
  noteText: 120,
}
export const IDLE_MS = 5 * 60_000
export const FOCUS_TARGET_MS = 90 * 60_000
export const HOUR_MS = 3_600_000

export const emptyData = (): Data => ({
  turns: [],
  turnAt: [],
  tools: {},
  toolTotal: {},
  words: {},
  wordsWeek: '',
  wordsOff: false,
  notes: [],
  noteSeq: 0,
  dirs: {},
  cwd: '',
  cost: [],
  lastCost: 0,
  days: {},
  focusStart: 0,
  lastAct: 0,
  streak: 0,
  best: 0,
  budget: 0,
  before: '',
  after: '',
  split: 50,
  manual: false,
  ringOff: false,
})

// ---------------------------------------------------------------- small helpers
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const clamp01 = (x: number) => clamp(x, 0, 1)
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)
const num = (x: unknown, fallback = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback)
const pad2 = (n: number) => String(n).padStart(2, '0')

/** Progress 0..1 of an animation that began at `start` and lasts `ms`; 1 when `isOn` is false or it never began. */
export const progress = (start: number, now: number, ms: number, isOn: boolean): number =>
  !isOn || start <= 0 ? 1 : clamp01((now - start) / ms)

export const fmtSecs = (s: number): string => {
  const n = Math.max(0, Math.round(s))

  return n < 60 ? `${n}s` : n < 3600 ? `${Math.floor(n / 60)}m${pad2(n % 60)}s` : `${Math.floor(n / 3600)}h${pad2(Math.floor((n % 3600) / 60))}m`
}
export const fmtMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)}ms` : fmtSecs(ms / 1000))
export const fmtUsd = (n: number): string => `$${n.toFixed(n >= 100 ? 0 : 2)}`
export const fmtMin = (ms: number): string => {
  const m = Math.floor(ms / 60_000)

  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${pad2(m % 60)}m`
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A horizontal bar exactly `w` cells wide: full blocks, one eighth-block, then light shade. */
export const bar = (frac: number, w: number): string => {
  const total = Math.round(clamp01(frac) * w * 8)
  const full = Math.floor(total / 8)
  const part = total % 8

  return '█'.repeat(full) + EIGHTHS[part] + '░'.repeat(Math.max(0, w - full - (part > 0 ? 1 : 0)))
}

export const toneOf = (pct: number): string => (pct >= 85 ? 'error' : pct >= 70 ? 'warning' : 'success')
export const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) {
    return 0
  }
  const at = (sorted.length - 1) * clamp01(q)
  const lo = Math.floor(at)
  const hi = Math.ceil(at)

  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo)
}
export const stats5 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)

  return { min: s[0] ?? 0, q1: quantile(s, 0.25), med: quantile(s, 0.5), q3: quantile(s, 0.75), max: s[s.length - 1] ?? 0, n: s.length }
}

const text = (t: string, o: Omit<Seg, 't'> = {}): Seg => ({ t, ...o })
const line = (...segs: Seg[]): Row => segs
const dim = (t: string): Row => [text(t, { d: true })]
const empty = (title: string, why: string): Chart => ({ title, rows: [dim(why)] })

/** Joins neighbours with the same style so a row stays a handful of Texts. */
export const mergeSegs = (row: Row): Row => {
  const out: Seg[] = []

  for (const s of row) {
    const last = out[out.length - 1]

    if (last !== undefined && last.c === s.c && last.d === s.d && last.b === s.b) {
      last.t += s.t
    } else {
      out.push({ ...s })
    }
  }

  return out
}

export const rowText = (row: Row): string => row.map(s => s.t).join('')

// ---------------------------------------------------------------- dates
export const dayKey = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
export const minuteOfDay = (ms: number): number => {
  const d = new Date(ms)

  return d.getHours() * 60 + d.getMinutes()
}
/** The Monday of the week of `ms`, as a day key: the bucket the word counts live in. */
export const weekKey = (ms: number): string => {
  const d = new Date(ms)
  const back = (d.getDay() + 6) % 7

  return dayKey(ms - back * 86_400_000)
}

// ---------------------------------------------------------------- recorders (state in, state out)
/** Keeps the `limit` biggest counts (ties: alphabetical). */
export const boundCounts = (m: Record<string, number>, limit: number): Record<string, number> => {
  const keys = Object.keys(m)

  if (keys.length <= limit) {
    return m
  }
  const keep = keys.sort((a, b) => (m[b]! - m[a]!) || (a < b ? -1 : 1)).slice(0, limit)

  return Object.fromEntries(keep.map(k => [k, m[k]!]))
}

const pushBounded = <T>(xs: T[], x: T, cap: number): T[] => [...xs, x].slice(-cap)

/** Marks activity at `now`: the day's first/last minute, and the focus window (an idle gap of 5 min restarts it). */
export const touch = (d: Data, now: number): Data => {
  const key = dayKey(now)
  const m = minuteOfDay(now)
  const day: Day = d.days[key] ?? { a: m, b: m, n: 0 }
  const days = { ...d.days, [key]: { a: Math.min(day.a, m), b: Math.max(day.b, m), n: day.n + 1 } }
  const keys = Object.keys(days).sort()
  const kept = Object.fromEntries(keys.slice(-CAP.days).map(k => [k, days[k]!]))
  const isNew = d.lastAct <= 0 || now - d.lastAct >= IDLE_MS

  return { ...d, days: kept, lastAct: now, focusStart: isNew ? now : d.focusStart }
}

export const focusMs = (d: Data, now: number): number =>
  d.lastAct <= 0 || now - d.lastAct >= IDLE_MS ? 0 : Math.max(0, now - d.focusStart)

/** Directory of an edited file relative to the project, at most 4 levels deep. */
export const dirOf = (cwd: string, file: string): string => {
  const f = file.replace(/\\/g, '/')
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')

  if (root === '' || !f.startsWith(`${root}/`)) {
    return '(outside)'
  }
  const parts = f.slice(root.length + 1).split('/')
  parts.pop()

  return parts.slice(0, 4).join('/') || '.'
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

export type CallInfo = { tool: string; ms: number; ok: boolean; now: number; file?: string; edit?: { old: string; neu: string } }

export const applyCall = (d: Data, c: CallInfo): Data => {
  const name = clip(c.tool, 24)
  const known = name in d.tools
  const tools =
    known || Object.keys(d.tools).length < CAP.tools
      ? { ...d.tools, [name]: pushBounded(d.tools[name] ?? [], Math.max(0, Math.round(c.ms)), CAP.perTool) }
      : d.tools
  const totalKnown = name in d.toolTotal
  const toolTotal =
    totalKnown || Object.keys(d.toolTotal).length < CAP.toolTotal
      ? { ...d.toolTotal, [name]: (d.toolTotal[name] ?? 0) + Math.max(0, Math.round(c.ms)) }
      : d.toolTotal
  const streak = c.ok ? d.streak + 1 : 0
  let next: Data = { ...d, tools, toolTotal, streak, best: Math.max(d.best, streak) }

  if (c.file !== undefined && c.ok) {
    next = { ...next, dirs: boundCounts({ ...next.dirs, [dirOf(d.cwd, c.file)]: (next.dirs[dirOf(d.cwd, c.file)] ?? 0) + 1 }, CAP.dirs) }
  }

  if (c.edit !== undefined && c.ok && !d.manual) {
    next = { ...next, before: clip(c.edit.old, CAP.blob), after: clip(c.edit.neu, CAP.blob) }
  }

  return touch(next, c.now)
}

export const applyTurn = (d: Data, t: { sec: number; now: number; model?: string; usd?: number }): Data => {
  let next: Data = {
    ...d,
    turns: pushBounded(d.turns, Math.max(0, Math.round(t.sec)), CAP.turns),
    turnAt: pushBounded(d.turnAt, t.now, CAP.turnAt),
  }

  if (t.usd !== undefined) {
    const delta = t.usd >= d.lastCost ? t.usd - d.lastCost : t.usd
    next = { ...next, lastCost: t.usd }

    if (delta > 0.000001) {
      const sample: CostSample = { t: t.now, m: clip(t.model ?? 'unknown', 40), d: Math.round(delta * 1e6) / 1e6 }
      next = { ...next, cost: pushBounded(next.cost, sample, CAP.cost) }
    }
  }

  return touch(next, t.now)
}

const STOP = new Set(
  (
    'the and for are but not you your with this that have from they will would there their what about which when make like ' +
    'can could should just into than then them these those been being were was has had does did done its our out any all ' +
    'also use using used get got let lets please want need how why who whom where here some more most other such only own ' +
    'same very too can now new one two see look say way may might must shall yes okay thanks thank hey hello again still ' +
    'much many each both few off over under per via etc let\'s don\'t isn\'t it\'s i\'m i\'ll i\'ve cant dont wont isnt doesnt ' +
    'something anything everything nothing really maybe actually first second next last after before while because since ' +
    'going gonna into onto upon able sure right well good great ill ive youre theyre thats whats'
  ).split(' '),
)

/** Lower-case words of 3 to 20 letters, stopwords out, at most 3 of the same word per prompt. */
export const tokenize = (s: string): string[] => {
  const seen: Record<string, number> = {}
  const out: string[] = []

  for (const w of s.toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[a-z]{3,20}/g) ?? []) {
    if (!STOP.has(w) && (seen[w] ?? 0) < 3) {
      seen[w] = (seen[w] ?? 0) + 1
      out.push(w)
    }
  }

  return out
}

/** Adds a prompt's words as counts only. A new week starts the counts over. */
export const applyPrompt = (d: Data, prompt: { text: string; now: number; isCommand: boolean }): Data => {
  const base = touch(d, prompt.now)

  if (base.wordsOff || prompt.isCommand) {
    return base
  }
  const wk = weekKey(prompt.now)
  const words = { ...(base.wordsWeek === wk ? base.words : {}) }

  for (const w of tokenize(prompt.text)) {
    words[w] = (words[w] ?? 0) + 1
  }

  return { ...base, wordsWeek: wk, words: boundCounts(words, CAP.words) }
}

export const parseNote = (raw: string): { text: string; tags: string[] } => {
  const tags: string[] = []

  for (const m of raw.matchAll(/#([A-Za-z0-9_-]{1,24})/g)) {
    const t = m[1]!.toLowerCase()

    if (!tags.includes(t) && tags.length < 6) {
      tags.push(t)
    }
  }

  return { text: clip(raw.replace(/#[A-Za-z0-9_-]+/g, '').replace(/\s+/g, ' ').trim(), CAP.noteText), tags }
}

export const addNote = (d: Data, raw: string): Data => {
  const { text: t, tags } = parseNote(raw)

  if (t === '' && tags.length === 0) {
    return d
  }
  const id = d.noteSeq + 1
  const note: Note = { id, text: t, tags }

  return { ...d, noteSeq: id, notes: pushBounded(d.notes, note, CAP.notes) }
}

/** Rebuilds a Data from whatever was stored: anything of the wrong type falls back, everything is re-bounded. */
export const sanitize = (raw: unknown): Data => {
  const base = emptyData()

  if (raw === null || typeof raw !== 'object') {
    return base
  }
  const r = raw as Record<string, unknown>
  const nums = (x: unknown, cap: number) => (Array.isArray(x) ? x.filter(v => typeof v === 'number' && Number.isFinite(v)).slice(-cap) as number[] : [])
  const rec = <T,>(x: unknown, ok: (v: unknown) => v is T, cap: number): Record<string, T> => {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) {
      return {}
    }

    return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => ok(v)).slice(0, cap)) as Record<string, T>
  }
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const isNums = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum)
  const isDay = (v: unknown): v is Day => v !== null && typeof v === 'object' && isNum((v as Day).a) && isNum((v as Day).b) && isNum((v as Day).n)
  const str = (x: unknown) => (typeof x === 'string' ? x : '')
  const notes: Note[] = Array.isArray(r.notes)
    ? r.notes
        .filter((n): n is Note => n !== null && typeof n === 'object' && isNum((n as Note).id) && typeof (n as Note).text === 'string' && Array.isArray((n as Note).tags))
        .map(n => ({ id: n.id, text: clip(n.text, CAP.noteText), tags: n.tags.filter(t => typeof t === 'string').slice(0, 6) }))
        .slice(-CAP.notes)
    : []
  const cost: CostSample[] = Array.isArray(r.cost)
    ? r.cost
        .filter((c): c is CostSample => c !== null && typeof c === 'object' && isNum((c as CostSample).t) && typeof (c as CostSample).m === 'string' && isNum((c as CostSample).d))
        .slice(-CAP.cost)
    : []

  return {
    turns: nums(r.turns, CAP.turns),
    turnAt: nums(r.turnAt, CAP.turnAt),
    tools: Object.fromEntries(Object.entries(rec(r.tools, isNums, CAP.tools)).map(([k, v]) => [k, v.slice(-CAP.perTool)])),
    toolTotal: rec(r.toolTotal, isNum, CAP.toolTotal),
    words: boundCounts(rec(r.words, isNum, CAP.words * 2), CAP.words),
    wordsWeek: str(r.wordsWeek),
    wordsOff: r.wordsOff === true,
    notes,
    noteSeq: num(r.noteSeq, notes.reduce((m, n) => Math.max(m, n.id), 0)),
    dirs: boundCounts(rec(r.dirs, isNum, CAP.dirs * 2), CAP.dirs),
    cwd: str(r.cwd),
    cost,
    lastCost: num(r.lastCost),
    days: rec(r.days, isDay, CAP.days),
    focusStart: num(r.focusStart),
    lastAct: num(r.lastAct),
    streak: num(r.streak),
    best: num(r.best),
    budget: Math.max(0, num(r.budget)),
    before: clip(str(r.before), CAP.blob),
    after: clip(str(r.after), CAP.blob),
    split: clamp(num(r.split, 50), 0, 100),
    manual: r.manual === true,
    ringOff: r.ringOff === true,
  }
}

// ---------------------------------------------------------------- 55 histogram of turn lengths
export const histogram = (c: Ctx): Chart => {
  const turns = c.data.turns
  const n = turns.length

  if (n === 0) {
    return empty('Turn lengths', 'No finished turns recorded yet. Finish a turn, or try /cmdemo.')
  }
  const s = [...turns].sort((a, b) => a - b)
  const lo = s[0]!
  const hi = s[n - 1]!
  const span = hi - lo
  const nb = span === 0 ? 1 : Math.min(8, n)
  const bins = new Array<number>(nb).fill(0)

  for (const v of turns) {
    bins[span === 0 ? 0 : Math.min(nb - 1, Math.floor(((v - lo) / span) * nb))]! += 1
  }
  const top = Math.max(...bins)
  const w = clamp(c.cols - 28, 8, 40)
  const rows: Row[] = [
    line(text(`${Math.round(n * c.p)} turns`, { b: true }), text(` · median ${fmtSecs(quantile(s, 0.5))} · longest ${fmtSecs(hi)}`, { d: true })),
  ]

  bins.forEach((count, i) => {
    const a = lo + (span * i) / nb
    const b = lo + (span * (i + 1)) / nb
    const label = span === 0 ? fmtSecs(lo) : `${fmtSecs(a)}-${fmtSecs(b)}`
    rows.push(line(text(label.padStart(13), { d: true }), text(' ▕'), text(bar((count / top) * c.p, w), { c: 'suggestion' }), text(`▏ ${Math.round(count * c.p)}`)))
  })

  return { title: 'Turn lengths', rows, note: `Each bar is a range of turn durations; the bar is the number of turns in it (last ${CAP.turns} turns).` }
}

// ---------------------------------------------------------------- 56 box plot of tool durations
export const boxplot = (c: Ctx): Chart => {
  const names = Object.keys(c.data.tools)
    .filter(k => (c.data.tools[k]?.length ?? 0) > 0)
    .sort((a, b) => c.data.tools[b]!.length - c.data.tools[a]!.length)
    .slice(0, 8)

  if (names.length === 0) {
    return empty('Tool durations', 'No tool calls recorded yet. Run a tool, or try /cmdemo.')
  }
  const st = names.map(k => ({ k, ...stats5(c.data.tools[k]!) }))
  const top = Math.max(1, ...st.map(s => s.max))
  const w = clamp(c.cols - 30, 16, 48)
  const at = (v: number) => Math.round((v / top) * (w - 1) * c.p)
  const rows: Row[] = [dim('├ min   [ q1   ┃ median   ] q3   ┤ max')]

  for (const s of st) {
    const cells = new Array<string>(w).fill(' ')
    const [a, b, m, d, e] = [at(s.min), at(s.q1), at(s.med), at(s.q3), at(s.max)] as [number, number, number, number, number]

    for (let i = a; i <= e; i++) {
      cells[i] = '─'
    }
    for (let i = b; i <= d; i++) {
      cells[i] = '▒'
    }
    cells[a] = '├'
    cells[e] = '┤'
    cells[b] = '['
    cells[d] = ']'
    cells[m] = '┃'
    rows.push(line(text(s.k.slice(0, 9).padEnd(9), { b: true }), text(` ${cells.join('')} `, { c: 'suggestion' }), text(`n=${s.n} med ${fmtMs(s.med)}`, { d: true })))
  }
  rows.push(line(text(' '.repeat(10) + '0'.padEnd(w - 1), { d: true }), text(fmtMs(top), { d: true })))

  return { title: 'Tool durations', rows, note: `Box plot per tool over its last ${CAP.perTool} calls, all on one time scale.` }
}

// ---------------------------------------------------------------- arcs (ring and speedometer share this)
export type ArcKind = 'on' | 'off' | 'needle' | 'label' | ' '
export type ArcCell = { ch: string; k: ArcKind }

/** Points on a circle of radius r (rows), twice as wide in columns. Angles run clockwise from the top. */
export const arcGrid = (o: { r: number; from: number; to: number; steps: number; value: number; closed: boolean; needle: boolean }): ArcCell[][] => {
  const w = 4 * o.r + 1
  const h = 2 * o.r + 1
  const grid: ArcCell[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ', k: ' ' as ArcKind })))
  const n = o.closed ? o.steps : o.steps + 1
  const mark = clamp01(o.value) * o.steps

  for (let k = 0; k < n; k++) {
    const th = ((o.from + ((o.to - o.from) * k) / o.steps) * Math.PI) / 180
    const x = 2 * o.r + Math.round(2 * o.r * Math.sin(th))
    const y = o.r - Math.round(o.r * Math.cos(th))
    const cell = grid[y]![x]!

    if (cell.k !== ' ') {
      continue
    }
    const isNeedle = o.needle && k === Math.round(mark)
    const isOn = o.closed ? k < mark : k <= mark + 1e-9
    grid[y]![x] = isNeedle ? { ch: '◆', k: 'needle' } : isOn ? { ch: '●', k: 'on' } : { ch: '○', k: 'off' }
  }

  return grid
}

const arcRows = (grid: ArcCell[][], color: string): Row[] =>
  grid
    .filter(r => r.some(x => x.k !== ' '))
    .map(r =>
      mergeSegs(
        r.map(x =>
          x.k === 'on' ? text(x.ch, { c: color }) : x.k === 'needle' ? text(x.ch, { c: 'warning', b: true }) : x.k === 'label' ? text(x.ch, { b: true }) : text(x.ch, { d: true }),
        ),
      ),
    )

const putLabel = (grid: ArcCell[][], y: number, label: string) => {
  const w = grid[0]!.length
  const start = Math.floor((w - label.length) / 2)

  for (let i = 0; i < label.length; i++) {
    grid[y]![start + i] = { ch: label[i]!, k: 'label' }
  }
}

// ---------------------------------------------------------------- 57 / 139 context ring
export const ringGlyph = (pct: number): string => (pct >= 87.5 ? '●' : pct >= 62.5 ? '◕' : pct >= 37.5 ? '◑' : pct >= 12.5 ? '◔' : '○')

/** The progress border above the prompt: a rounded rule whose heavy part is the context fill. */
export const ringBorder = (pct: number, cols: number): string => {
  const label = ` ${ringGlyph(pct)} context ${Math.round(pct)}% `
  const w = Math.max(label.length + 6, Math.min(cols, 72)) - 2
  const inner = w - label.length
  const heavy = Math.round((clamp(pct, 0, 100) / 100) * inner)
  const left = Math.min(heavy, 2)

  return `╭${'━'.repeat(left)}${label}${'━'.repeat(Math.max(0, heavy - left))}${'┄'.repeat(Math.max(0, inner - heavy))}╮`
}

export const ringChart = (c: Ctx): Chart => {
  const pct = c.usage.ctxPct

  if (pct === undefined) {
    return empty('Context ring', 'The engine has no context reading yet (it appears after the first response).')
  }
  const shown = pct * c.p
  const grid = arcGrid({ r: 3, from: 0, to: 360, steps: 24, value: shown / 100, closed: true, needle: false })
  putLabel(grid, 3, `${Math.round(shown)}%`)

  return {
    title: 'Context ring',
    rows: [...arcRows(grid, toneOf(pct)), line(text(ringBorder(pct, c.cols), { c: toneOf(pct) }))],
    note: 'The same ring is a single row above the prompt box once context passes 60% (/cmring off hides it).',
  }
}

// ---------------------------------------------------------------- 58 thermometers for rate limits
const LIMIT_NAME: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', spend_limit: 'spend' }

export const fmtReset = (iso: string | undefined, now: number): string => {
  if (iso === undefined) {
    return ''
  }
  const ms = Date.parse(iso) - now

  return Number.isFinite(ms) && ms > 0 ? `resets in ${fmtMin(ms)}` : ''
}

export const thermometers = (c: Ctx): Chart => {
  const items = c.usage.limits

  if (items.length === 0) {
    return empty('Rate limits', 'No rate-limit readings: the engine reports none off a subscription, or before the first response.')
  }
  const H = 8
  const W = 12
  const mid = (s: string) => s.padStart(Math.floor((W + s.length) / 2)).padEnd(W)
  const rows: Row[] = []
  const filled = items.map(i => Math.round((clamp(i.pct, 0, 100) / 100) * c.p * H))

  for (let k = 0; k < H; k++) {
    const j = H - k
    const r: Seg[] = []

    items.forEach((it, i) => {
      const edge = k === 0 ? (j <= filled[i]! ? '┌█┐' : '┌─┐') : j <= filled[i]! ? '│█│' : '│ │'
      r.push(text(mid(edge), { c: j <= filled[i]! ? toneOf(it.pct) : undefined, d: j > filled[i]! }))
    })
    rows.push(mergeSegs(r))
  }
  rows.push(items.map(it => text(mid('(●)'), { c: toneOf(it.pct) })))
  rows.push(items.map(it => text(mid(`${Math.round(it.pct * c.p)}%`), { b: true })))
  rows.push(items.map(it => text(mid(LIMIT_NAME[it.kind] ?? it.kind.slice(0, 10)), { d: true })))
  rows.push(items.map(it => text(mid(fmtReset(it.resetsAt, c.now).replace('resets in ', 'in ')), { d: true })))

  return { title: 'Rate limits', rows: rows.map(mergeSegs), note: 'One thermometer per window the engine reports (read live from the session usage).' }
}

// ---------------------------------------------------------------- 59 fuel gauge for budget
export const fuelGauge = (c: Ctx): Chart => {
  const b = c.data.budget
  const used = c.usage.usd

  if (b <= 0) {
    return empty('Fuel gauge', 'No budget set. Type /cmbudget <usd>, for example /cmbudget 10.')
  }

  if (used === undefined) {
    return empty('Fuel gauge', 'The engine reports no session cost here, so there is nothing to subtract from the budget.')
  }
  const left = clamp01(1 - used / b)
  const w = clamp(c.cols - 12, 12, 48)
  const shown = left * c.p
  const tone = left < 0.15 ? 'error' : left < 0.35 ? 'warning' : 'success'
  const needleAt = Math.round(shown * (w - 1))
  const ticks = Array.from({ length: w }, (_, i) => (i === 0 || i === w - 1 || i === Math.floor((w - 1) / 2) ? '┬' : ' ')).join('')

  return {
    title: 'Fuel gauge',
    rows: [
      line(text(`   ${ticks}`, { d: true })),
      line(text(`   ${' '.repeat(needleAt)}▼`, { c: tone, b: true })),
      line(text('E ', { b: true }), text('▕', { d: true }), text(bar(shown, w), { c: tone }), text('▏', { d: true }), text(' F', { b: true })),
      line(text(`${fmtUsd(Math.max(0, b - used) * c.p)} left`, { b: true, c: tone }), text(` of ${fmtUsd(b)} · spent ${fmtUsd(used)} (${Math.round((used / b) * 100)}%)`, { d: true })),
    ],
    note: 'Full is the whole budget. It is a gauge only: nothing is blocked (see /hardbudget for limits).',
  }
}

// ---------------------------------------------------------------- 60 speedometer: turns per hour
export const turnsLastHour = (d: Data, now: number): number => d.turnAt.filter(t => now - t <= HOUR_MS && now - t >= 0).length

export const speedScale = (v: number): number => [10, 20, 30, 60, 120, 240].find(m => m >= v * 1.2) ?? Math.ceil(v * 1.2)

export const speedometer = (c: Ctx): Chart => {
  const v = turnsLastHour(c.data, c.now)
  const max = speedScale(v)
  const grid = arcGrid({ r: 4, from: -90, to: 90, steps: 16, value: (v / max) * c.p, closed: false, needle: true })
  putLabel(grid, 4, `${Math.round(v * c.p)}/h`)
  const w = grid[0]!.length
  const rows = arcRows(grid, 'suggestion')
  rows.push(line(text('0'.padEnd(w - String(max).length), { d: true }), text(String(max), { d: true })))

  return { title: 'Turns per hour', rows, note: `Finished turns in the last 60 minutes; the dial's top is ${max}.` }
}

// ---------------------------------------------------------------- 61 battery for focus time
export const batteryChart = (c: Ctx): Chart => {
  const f = focusMs(c.data, c.now)
  const frac = clamp01(f / FOCUS_TARGET_MS)
  const w = clamp(c.cols - 14, 12, 40)
  const tone = frac >= 1 ? 'success' : 'suggestion'

  if (c.data.lastAct <= 0) {
    return empty('Focus battery', 'No activity recorded yet. Send a prompt, or try /cmdemo.')
  }

  return {
    title: 'Focus battery',
    rows: [
      line(text(`┌${'─'.repeat(w)}┐`, { d: true })),
      line(text('│', { d: true }), text(bar(frac * c.p, w), { c: tone }), text('│', { d: true }), text('▐', { d: true })),
      line(text(`└${'─'.repeat(w)}┘`, { d: true })),
      line(text(`${fmtMin(f * c.p)}`, { b: true }), text(` of ${fmtMin(FOCUS_TARGET_MS)} focus`, { d: true }), text(frac >= 1 ? '  fully charged' : '', { c: 'success' })),
    ],
    note: 'Focus is time since your last gap of 5 minutes or more with no activity; a new gap empties it.',
  }
}

// ---------------------------------------------------------------- 62 tag cloud
export const cloudChart = (c: Ctx): Chart => {
  const d = c.data
  const entries = Object.entries(d.words).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 36)

  if (d.wordsOff && entries.length === 0) {
    return empty('Word cloud', 'Word counting is off (/cmwords on to resume). Nothing is stored while it is off.')
  }

  if (entries.length === 0) {
    return empty('Word cloud', 'No words counted yet this week. Your prompts are never stored, only word counts.')
  }
  const max = entries[0]![1]
  const rows: Row[] = []
  const width = Math.max(20, c.cols - 4)
  let cur: Seg[] = []
  let len = 0
  const shownN = Math.max(1, Math.round(entries.length * c.p))

  entries.slice(0, shownN).forEach(([w, n]) => {
    const tier = n >= max * 0.66 ? 3 : n >= max * 0.33 ? 2 : 1
    const label = tier === 3 ? w.toUpperCase() : tier === 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w

    if (len + label.length + 2 > width && cur.length > 0) {
      rows.push(mergeSegs(cur))
      cur = []
      len = 0
    }
    cur.push(text(label, tier === 3 ? { c: 'suggestion', b: true } : tier === 2 ? { b: true } : { d: true }))
    cur.push(text('  '))
    len += label.length + 2
  })

  if (cur.length > 0) {
    rows.push(mergeSegs(cur))
  }
  rows.unshift(line(text(`${Math.round(entries.length * c.p)} words`, { b: true }), text(` · week of ${d.wordsWeek || 'this week'} · top: ${entries[0]![0]} ×${max}`, { d: true })))

  return { title: 'Word cloud', rows, note: `Size is how often a word appeared in your prompts this week. Only counts are stored (max ${CAP.words} words), never the prompts. /cmwords off stops it.` }
}

// ---------------------------------------------------------------- 63 note network
export const sharedTags = (a: Note, b: Note): number => a.tags.filter(t => b.tags.includes(t)).length

/** Connected groups of notes (linked by at least one shared tag), biggest first. */
export const clusters = (notes: Note[]): number[][] => {
  const seen = new Set<number>()
  const out: number[][] = []

  notes.forEach((n, i) => {
    if (seen.has(i)) {
      return
    }
    const group: number[] = []
    const stack = [i]
    seen.add(i)

    while (stack.length > 0) {
      const cur = stack.pop()!
      group.push(cur)
      notes.forEach((m, j) => {
        if (!seen.has(j) && sharedTags(notes[cur]!, m) > 0) {
          seen.add(j)
          stack.push(j)
        }
      })
    }
    out.push(group.sort((a, b) => a - b))
  })

  return out.sort((a, b) => b.length - a.length)
}

export const noteNetwork = (c: Ctx): Chart => {
  const notes = c.data.notes.slice(-18)

  if (notes.length === 0) {
    return empty('Note network', 'No notes yet. Add one with /cmnote <text> #tag #another. Notes sharing a tag are linked.')
  }
  const rows: Row[] = []
  const w = clamp(c.cols - 12, 20, 70)

  for (const n of notes) {
    rows.push(line(text(`${String(n.id).padStart(3)} `, { b: true }), text(clip(n.text, w), {}), text(n.tags.length > 0 ? `  ${n.tags.map(t => `#${t}`).join(' ')}` : '', { c: 'suggestion' })))
  }
  rows.push(dim(''))
  rows.push(line(text('links by shared tags (digit = tags in common)', { d: true })))
  rows.push(line(text('    ' + notes.map(n => String(n.id % 100).padStart(3)).join(''), { d: true })))

  notes.forEach((a, i) => {
    const cells: Seg[] = [text(`${String(a.id % 100).padStart(3)} `, { d: true })]

    notes.forEach((b, j) => {
      const s = i === j ? -1 : sharedTags(a, b)
      cells.push(i === j ? text('  ■', { d: true }) : s > 0 ? text(`  ${Math.min(9, s)}`, { c: 'suggestion', b: true }) : text('  ·', { d: true }))
    })
    rows.push(mergeSegs(cells))
  })
  const groups = clusters(notes).filter(g => g.length > 1)
  rows.push(dim(''))
  rows.push(
    groups.length === 0
      ? dim('No links yet: give two notes the same #tag.')
      : line(text('clusters: ', { d: true }), text(groups.map(g => `{${g.map(i => notes[i]!.id).join(',')}}`).join(' '), { c: 'suggestion' })),
  )

  return { title: 'Note network', rows, note: 'The grid is an adjacency matrix: each digit is how many tags two notes share.' }
}

// ---------------------------------------------------------------- 64 folder tree
type TreeNode = { name: string; own: number; total: number; kids: Map<string, TreeNode> }

export const buildTree = (dirs: Record<string, number>): TreeNode => {
  const root: TreeNode = { name: '.', own: 0, total: 0, kids: new Map() }

  for (const [path, n] of Object.entries(dirs)) {
    let node = root
    root.total += n

    if (path === '.') {
      root.own += n
      continue
    }

    for (const part of path.split('/')) {
      let kid = node.kids.get(part)

      if (kid === undefined) {
        kid = { name: part, own: 0, total: 0, kids: new Map() }
        node.kids.set(part, kid)
      }
      kid.total += n
      node = kid
    }
    node.own += n
  }

  return root
}

export const treeChart = (c: Ctx): Chart => {
  if (Object.keys(c.data.dirs).length === 0) {
    return empty('Project tree', 'No edits recorded yet. Folders appear as Edit and Write calls land.')
  }
  const root = buildTree(c.data.dirs)
  const top = Math.max(1, ...[...root.kids.values()].map(k => k.total), root.own)
  const w = clamp(Math.floor(c.cols / 4), 6, 16)
  const rows: Row[] = [line(text('.', { b: true }), text(`  ${Math.round(root.total * c.p)} edits`, { d: true }))]
  let budget = 40

  const walk = (node: TreeNode, prefix: string) => {
    const kids = [...node.kids.values()].sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1))
    const shown = kids.slice(0, 8)

    shown.forEach((k, i) => {
      if (budget <= 0) {
        return
      }
      budget -= 1
      const last = i === shown.length - 1 && kids.length === shown.length
      rows.push(
        line(
          text(`${prefix}${last ? '└─ ' : '├─ '}`, { d: true }),
          text(k.name, { b: k.kids.size > 0 }),
          text('  '),
          text(bar((k.total / top) * c.p, w), { c: 'suggestion' }),
          text(` ${Math.round(k.total * c.p)}`, { d: true }),
        ),
      )
      walk(k, prefix + (last ? '   ' : '│  '))
    })

    if (kids.length > shown.length) {
      rows.push(dim(`${prefix}└─ … ${kids.length - shown.length} more folders`))
    }
  }
  walk(root, '')

  return { title: 'Project tree', rows, note: 'Counts are edits (Edit, Write, NotebookEdit) per folder, summed up the tree; paths are relative to where the session started.' }
}

// ---------------------------------------------------------------- 65 layered area chart of cost per model
export const shortModel = (m: string): string => m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-latest$/, '')
const LAYER_GLYPH = ['█', '▓', '▒', '░']
const LAYER_COLOR = ['suggestion', 'success', 'warning', 'claude']

export const stackColumns = (samples: CostSample[], models: string[]): number[][] => {
  const run: Record<string, number> = {}

  return samples.map(s => {
    run[s.m] = (run[s.m] ?? 0) + s.d

    return models.map(m => run[m] ?? 0)
  })
}

export const areaChart = (c: Ctx): Chart => {
  const all = c.data.cost

  if (all.length < 2) {
    return empty('Cost per model', 'Needs at least two finished turns with a cost reading. Try /cmdemo to see it.')
  }
  const totals: Record<string, number> = {}

  for (const s of all) {
    totals[s.m] = (totals[s.m] ?? 0) + s.d
  }
  const ordered = Object.keys(totals).sort((a, b) => totals[b]! - totals[a]!)
  const models = ordered.slice(0, 4)
  const samples = all.slice(-clamp(c.cols - 12, 8, 48)).map(s => (models.includes(s.m) ? s : { ...s, m: models[models.length - 1]! }))
  const cols = stackColumns(samples, models)
  const maxTotal = Math.max(1e-9, ...cols.map(col => col.reduce((a, b) => a + b, 0)))
  const H = 7
  const rows: Row[] = []

  for (let r = H - 1; r >= 0; r--) {
    const cells: Seg[] = [text(r === H - 1 ? fmtUsd(maxTotal).padStart(7) : ' '.repeat(7), { d: true }), text('▕', { d: true })]

    for (const col of cols) {
      let acc = 0
      let layer = -1

      for (let l = 0; l < col.length; l++) {
        acc += col[l]!

        if ((acc / maxTotal) * H * c.p >= r + 0.5) {
          layer = l
          break
        }
      }
      cells.push(layer < 0 ? text(' ') : text(LAYER_GLYPH[layer]!, { c: LAYER_COLOR[layer] }))
    }
    rows.push(mergeSegs(cells))
  }
  rows.push(line(text(`${fmtUsd(0).padStart(7)}▕${'─'.repeat(cols.length)}`, { d: true })))
  rows.push(line(...models.flatMap((m, i) => [text(`${LAYER_GLYPH[i]} `, { c: LAYER_COLOR[i] }), text(`${shortModel(m)} ${fmtUsd(totals[m]!)}   `, { d: true })])))

  return { title: 'Cost per model', rows, note: 'Stacked, cumulative: each column is one finished turn; a model is a layer. Turns are priced by the model the engine says answered.' }
}

// ---------------------------------------------------------------- 66 candlestick of daily activity ranges
export const lastDays = (now: number, n: number): string[] => Array.from({ length: n }, (_, i) => dayKey(now - (n - 1 - i) * 86_400_000))

export const candles = (c: Ctx): Chart => {
  const keys = lastDays(c.now, CAP.days)
  const list = keys.map(k => c.data.days[k])

  if (list.every(x => x === undefined)) {
    return empty('Daily ranges', 'No days recorded yet. Each day keeps its first and last activity time.')
  }
  const rows: Row[] = []
  const R = 12

  for (let r = 0; r < R; r++) {
    const label = r % 2 === 0 ? `${pad2(r * 2)}h ` : '    '
    const cells: Seg[] = [text(label, { d: true }), text('▕', { d: true })]

    list.forEach((day, i) => {
      if (day === undefined) {
        cells.push(text('·', { d: true }))

        return
      }
      const lo = Math.floor(day.a / 60)
      const hi = Math.floor(day.b / 60)
      const up = lo <= 2 * r && 2 * r <= hi
      const down = lo <= 2 * r + 1 && 2 * r + 1 <= hi
      const prev = i > 0 ? list[i - 1] : undefined
      const colour = prev === undefined || day.n >= prev.n ? 'success' : 'warning'
      const ch = up && down ? '█' : up ? '▀' : down ? '▄' : '┆'
      cells.push(up || down ? text(ch, { c: colour }) : text(ch, { d: true }))
    })
    rows.push(mergeSegs(cells))
  }
  const shown = list.filter((x): x is Day => x !== undefined)
  const totalN = shown.reduce((a, d) => a + d.n, 0)
  rows.push(line(text('    ▕' + '─'.repeat(keys.length), { d: true })))
  rows.push(line(text(`${shown.length} active days · ${Math.round(totalN * c.p)} events · oldest ${keys[0]!.slice(5)} → today`, { d: true })))

  return { title: 'Daily ranges', rows, note: 'Each column is a day, top is midnight. The bar spans the first to the last activity hour; green means at least as busy as the day before, amber less busy. Range bars in candlestick style: there is no open or close price.' }
}

// ---------------------------------------------------------------- 67 pie as a proportional bar
const PIE_GLYPH = ['█', '▓', '▒', '░', '▚', '▞', '▖']
const PIE_COLOR = ['suggestion', 'success', 'warning', 'claude', 'error', 'subtle', 'inactive']

export const pieSlices = (m: Record<string, number>): { name: string; ms: number }[] => {
  const e = Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const top = e.slice(0, 6).map(([name, ms]) => ({ name, ms }))
  const rest = e.slice(6).reduce((a, [, v]) => a + v, 0)

  return rest > 0 ? [...top, { name: 'other', ms: rest }] : top
}

export const pieChart = (c: Ctx): Chart => {
  const sl = pieSlices(c.data.toolTotal)

  if (sl.length === 0) {
    return empty('Where time went', 'No tool time recorded yet. Run a tool, or try /cmdemo.')
  }
  const total = sl.reduce((a, s) => a + s.ms, 0)
  const w = clamp(c.cols - 6, 16, 60)
  const reach = Math.round(w * c.p)
  let edge = 0
  const segs: Seg[] = []

  sl.forEach((s, i) => {
    const end = i === sl.length - 1 ? w : Math.round(((edge + s.ms) / total) * w)
    const startCell = Math.round((edge / total) * w)
    const cells = Math.max(0, Math.min(end, reach) - startCell)
    segs.push(text(PIE_GLYPH[i]!.repeat(cells), { c: PIE_COLOR[i] }))
    edge += s.ms
  })
  const rows: Row[] = [mergeSegs([text('▕', { d: true }), ...segs, text(' '.repeat(Math.max(0, w - reach)), {}), text('▏', { d: true })]), dim('')]

  sl.forEach((s, i) => {
    rows.push(line(text(`${PIE_GLYPH[i]}${PIE_GLYPH[i]} `, { c: PIE_COLOR[i] }), text(s.name.slice(0, 18).padEnd(19), { b: true }), text(`${String(Math.round((s.ms / total) * 100 * c.p)).padStart(3)}%  `, {}), text(fmtMs(s.ms * c.p), { d: true })))
  })

  return { title: 'Where time went', rows, note: 'A true pie is not possible in text, so this is a proportional bar: slice width is share of total tool time.' }
}

// ---------------------------------------------------------------- 68 before/after slider
const cut = (s: string, a: number, b: number) => s.slice(a, b).padEnd(Math.max(0, b - a))

export const sliderRows = (before: string, after: string, split: number, width: number): Row[] => {
  const b = before.split('\n')
  const a = after.split('\n')
  const n = Math.min(14, Math.max(b.length, a.length))
  const d = Math.round((clamp(split, 0, 100) / 100) * width)
  const rows: Row[] = []

  for (let i = 0; i < n; i++) {
    const left = cut(b[i] ?? '', 0, d)
    const right = cut(a[i] ?? '', d, width)
    const same = (b[i] ?? '') === (a[i] ?? '')
    rows.push(
      line(
        text(left, { c: same ? undefined : 'diffRemoved', d: same }),
        text(d <= 0 || d >= width ? '' : '┃', { b: true }),
        text(right, { c: same ? undefined : 'diffAdded', d: same }),
      ),
    )
  }

  return rows
}

export const sliderChart = (c: Ctx): Chart => {
  if (c.data.before === '' && c.data.after === '') {
    return empty('Before / after', 'Nothing stored yet. The last Edit is captured automatically, or use /cmslide before <text> and /cmslide after <text> (use \\n for new lines).')
  }
  const longest = Math.max(...`${c.data.before}\n${c.data.after}`.split('\n').map(l => l.length))
  const width = clamp(longest, 20, Math.max(20, c.cols - 6))
  const head = line(text('◀ before', { c: 'diffRemoved', b: true }), text(`  split ${c.data.split}%  `, { d: true }), text('after ▶', { c: 'diffAdded', b: true }))

  return {
    title: 'Before / after',
    rows: [head, ...sliderRows(c.data.before, c.data.after, c.data.split, width)],
    note: 'Left of the divider shows the before text, right of it the after text, line by line. Move it with the buttons.',
  }
}

// ---------------------------------------------------------------- 140 sparkle
/** One frame of the glint: a star travelling over the line for `ms`, then the settled line. */
export const sparkleRow = (label: string, elapsed: number, isAnimated: boolean, ms = 1500): Row => {
  const done = !isAnimated || elapsed >= ms

  if (done) {
    return line(text('✦ ', { c: 'warning', b: true }), text(label, { c: 'success', b: true }), text(' ✦', { c: 'warning', b: true }))
  }
  const n = label.length
  const at = Math.min(n - 1, Math.floor((elapsed / ms) * (n + 4)) - 2)
  const pre = label.slice(0, Math.max(0, at))
  const post = label.slice(Math.max(0, at) + 1)

  return mergeSegs([
    text('· ', { d: true }),
    text(pre, { c: 'success' }),
    at >= 0 && at < n ? text('✦', { c: 'warning', b: true }) : text(''),
    text(at >= 0 && at < n ? post : label.slice(Math.max(0, at)), { c: 'success' }),
  ])
}

// ---------------------------------------------------------------- the picker
export const CHARTS: { id: string; label: string; command: string; run: (c: Ctx) => Chart }[] = [
  { id: 'hist', label: 'Turns', command: 'cmhist', run: histogram },
  { id: 'box', label: 'Tool box', command: 'cmbox', run: boxplot },
  { id: 'ring', label: 'Ring', command: 'cmring', run: ringChart },
  { id: 'therm', label: 'Limits', command: 'cmtherm', run: thermometers },
  { id: 'fuel', label: 'Fuel', command: 'cmbudget', run: fuelGauge },
  { id: 'speed', label: 'Speed', command: 'cmspeed', run: speedometer },
  { id: 'battery', label: 'Focus', command: 'cmbattery', run: batteryChart },
  { id: 'cloud', label: 'Words', command: 'cmwords', run: cloudChart },
  { id: 'notes', label: 'Notes', command: 'cmnote', run: noteNetwork },
  { id: 'tree', label: 'Tree', command: 'cmtree', run: treeChart },
  { id: 'area', label: 'Cost', command: 'cmarea', run: areaChart },
  { id: 'candle', label: 'Days', command: 'cmcandle', run: candles },
  { id: 'pie', label: 'Time', command: 'cmpie', run: pieChart },
  { id: 'slide', label: 'Slider', command: 'cmslide', run: sliderChart },
]

export const chartOf = (id: string, c: Ctx): Chart => (CHARTS.find(x => x.id === id) ?? CHARTS[0]!).run(c)

/** Card-stack shuffle: how many rows are shown `elapsed` ms after opening (all of them when settled). */
export const shownRows = (total: number, elapsed: number, ms: number, isOn: boolean): number =>
  !isOn || elapsed >= ms ? total : Math.min(total, Math.max(1, Math.ceil((elapsed / ms) * total)))

// ---------------------------------------------------------------- demo data (/cmdemo): never recorded
const lcg = (seed: number) => {
  let s = seed

  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296

    return s / 4294967296
  }
}

export const demoData = (now: number): Data => {
  const rnd = lcg(7)
  const d = emptyData()
  const tools = { Bash: 40, Read: 25, Edit: 18, Grep: 14, Write: 6, WebFetch: 4 } as const
  const spread: Record<string, number> = { Bash: 900, Read: 120, Edit: 200, Grep: 160, Write: 260, WebFetch: 1800 }
  const toolMap: Record<string, number[]> = {}
  const total: Record<string, number> = {}

  for (const [name, count] of Object.entries(tools)) {
    toolMap[name] = Array.from({ length: count }, () => Math.round(spread[name]! * (0.15 + rnd() * rnd() * 3)))
    total[name] = toolMap[name]!.reduce((a, b) => a + b, 0)
  }
  const models = ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4']
  const cost: CostSample[] = Array.from({ length: 24 }, (_, i) => ({ t: now - (24 - i) * 600_000, m: models[rnd() < 0.5 ? 0 : rnd() < 0.7 ? 1 : 2]!, d: Math.round((0.05 + rnd() * 0.4) * 1e4) / 1e4 }))
  const days: Record<string, Day> = {}

  for (let i = 0; i < 30; i++) {
    if (i % 7 === 5 || i % 7 === 6) {
      continue
    }
    const a = 8 * 60 + Math.round(rnd() * 150)
    days[dayKey(now - i * 86_400_000)] = { a, b: Math.min(1439, a + 240 + Math.round(rnd() * 420)), n: 10 + Math.round(rnd() * 90) }
  }

  return {
    ...d,
    turns: Array.from({ length: 60 }, () => Math.round(6 + Math.pow(rnd(), 2.2) * 240)),
    turnAt: Array.from({ length: 22 }, (_, i) => now - i * 160_000),
    tools: toolMap,
    toolTotal: total,
    words: { refactor: 14, tests: 12, parser: 9, config: 8, deploy: 7, cache: 6, router: 6, schema: 5, migration: 5, review: 4, lint: 4, docs: 3, hotfix: 3, bundle: 3, fixture: 2, mock: 2, token: 2, retry: 2, logging: 1, types: 1 },
    wordsWeek: weekKey(now),
    notes: [
      { id: 1, text: 'cache invalidation on deploy', tags: ['cache', 'deploy'] },
      { id: 2, text: 'router rewrite plan', tags: ['router', 'refactor'] },
      { id: 3, text: 'bundle size regression', tags: ['deploy', 'perf'] },
      { id: 4, text: 'split parser from lexer', tags: ['refactor', 'parser'] },
      { id: 5, text: 'flaky retry test', tags: ['tests'] },
      { id: 6, text: 'perf budget for parser', tags: ['perf', 'parser'] },
    ],
    noteSeq: 6,
    dirs: { src: 4, 'src/ui': 9, 'src/ui/charts': 14, 'src/core': 7, 'src/core/io': 3, tests: 11, docs: 2, '.': 3 },
    cost,
    lastCost: 6.8,
    days,
    focusStart: now - 54 * 60_000,
    lastAct: now - 60_000,
    streak: 7,
    best: 12,
    budget: 10,
    before: 'function total(items) {\n  let sum = 0\n  for (const i of items) {\n    sum += i.price\n  }\n  return sum\n}',
    after: 'const total = items =>\n  items.reduce((sum, i) =>\n    sum + i.price * i.qty,\n  0)\n\nexport { total }',
    split: 50,
  }
}

export const demoUsage = (): UsageLite => ({
  ctxPct: 72,
  usd: 6.8,
  limits: [
    { kind: 'five_hour', pct: 42 },
    { kind: 'seven_day', pct: 18 },
    { kind: 'spend_limit', pct: 87 },
  ],
})
