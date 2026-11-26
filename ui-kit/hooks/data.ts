// Pure data helpers for the ui-kit mod: records, caps, cleaning, estimates and demo data.
// Nothing here touches the engine, so every function is tested on its own.

import type { CallRec, EditRec, LabState, PromptRec, SampleRec, UiPrefs, UiState, ViewId } from '../types'

export const VIEWS: readonly { id: ViewId; label: string; short: string; key: string }[] = [
  { id: 'timeline', label: 'Timeline', short: 'Time', key: '1' },
  { id: 'files', label: 'Files', short: 'Files', key: '2' },
  { id: 'errors', label: 'Errors', short: 'Err', key: '3' },
  { id: 'prompts', label: 'Prompts', short: 'Ask', key: '4' },
  { id: 'spend', label: 'Spend', short: '$', key: '5' },
  { id: 'activity', label: 'Activity', short: 'Act', key: '6' },
  { id: 'lab', label: 'Lab', short: 'Lab', key: '7' },
]

export const DATA_VIEWS: readonly ViewId[] = ['timeline', 'files', 'errors', 'prompts', 'spend', 'activity']

export const isView = (v: unknown): v is ViewId => typeof v === 'string' && VIEWS.some(x => x.id === v)

/** Hard limits on everything this mod keeps. */
export const CAP = {
  calls: 150,
  edits: 60,
  prompts: 80,
  samples: 60,
  days: 90,
  open: 24,
  lab: 12,
  labName: 30,
  msg: 160,
  snip: 40,
} as const

export const MILESTONES: readonly number[] = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

const clampN = (n: unknown, lo: number, hi: number, dflt = lo): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt

export const pad2 = (n: number) => String(n).padStart(2, '0')

export const dayKey = (t: number): string => {
  const d = new Date(t)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export const hhmm = (t: number): string => {
  const d = new Date(t)

  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export const hhmmss = (t: number): string => `${hhmm(t)}:${pad2(new Date(t).getSeconds())}`

/** 850 ms -> 0.9s, 12 s -> 12s, 125 s -> 2m 05s. */
export const dur = (ms: number): string => {
  const v = Number.isFinite(ms) && ms > 0 ? ms : 0

  if (v < 1000) {
    return `${Math.round(v)}ms`
  }

  if (v < 10_000) {
    return `${(v / 1000).toFixed(1)}s`
  }

  if (v < 60_000) {
    return `${Math.round(v / 1000)}s`
  }
  const s = Math.round(v / 1000)

  return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`
}

export const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))

  if (s < 60) {
    return `${s}s ago`
  }

  if (s < 3600) {
    return `${Math.round(s / 60)}m ago`
  }

  return `${Math.round(s / 3600)}h ago`
}

export const money = (n: number): string => {
  const v = Number.isFinite(n) && n > 0 ? n : 0

  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
}

export const median = (xs: readonly number[]): number => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)

  if (s.length === 0) {
    return 0
  }
  const m = Math.floor(s.length / 2)

  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}

// ---------------------------------------------------------------- what a tool call looks like

export const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

export const fileOf = (input: Record<string, unknown>): string | undefined => {
  const p = input.file_path ?? input.notebook_path ?? input.path

  return typeof p === 'string' && p !== '' ? p.slice(0, 300) : undefined
}

/** A short label for a call. Bash keeps only its first word, so secrets on a command line are never kept. */
export const detailOf = (tool: string, input: Record<string, unknown>): string => {
  if (tool === 'Bash') {
    const c = typeof input.command === 'string' ? input.command : ''

    return c.trim().split(/\s+/)[0]?.slice(0, 16) ?? ''
  }
  const file = fileOf(input)

  if (file !== undefined) {
    return file.split('/').filter(Boolean).pop()?.slice(0, 24) ?? ''
  }

  if (typeof input.pattern === 'string') {
    return input.pattern.replace(/\s+/g, ' ').slice(0, 18)
  }

  return ''
}

export const EDIT_TOOLS = /^(Edit|Write|NotebookEdit)$/

const countLines = (s: string): number => (s === '' ? 0 : s.split('\n').length)

export const editSize = (tool: string, input: Record<string, unknown>): { added: number; removed: number } => {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')

  if (tool === 'Write') {
    return { added: countLines(str(input.content)), removed: 0 }
  }

  if (tool === 'NotebookEdit') {
    return { added: countLines(str(input.new_source)), removed: 0 }
  }

  return { added: countLines(str(input.new_string)), removed: countLines(str(input.old_string)) }
}

/** Removes things that look like secrets, flattens whitespace and cuts to `max`. Applied before an error text is kept. */
export const redact = (s: string, max: number = CAP.msg): string =>
  s
    .replace(/\b(sk|pk|ghp|gho|ghs|xox[a-z])[-_][A-Za-z0-9_-]{8,}/g, '***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/\b(password|passwd|token|secret|api[_-]?key|auth)\s*[=:]\s*\S+/gi, '$1=***')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** Two errors with the same signature are the same problem: digits and paths are blurred. */
export const sigOf = (tool: string, msg: string): string => {
  const first = (msg.split(/[\n.]/)[0] ?? '').toLowerCase().replace(/\/[\w./-]+/g, '/~').replace(/\d+/g, '#').trim().slice(0, 60)

  return `${tool}: ${first === '' ? 'failed' : first}`
}

// ---------------------------------------------------------------- bounded list updates

export const startCall = (list: readonly CallRec[], rec: CallRec): CallRec[] => [...list, rec].slice(-CAP.calls)

export const endCall = (
  list: readonly CallRec[],
  id: string,
  endedAt: number,
  isError: boolean,
  msg: string,
  out: number,
): CallRec[] => list.map(c => (c.id === id ? { ...c, endedAt, isError, msg: isError ? redact(msg) : '', out: clampN(out, 0, 1e9) } : c))

export const bumpEdit = (list: readonly EditRec[], path: string, added: number, removed: number, at: number): EditRec[] => {
  const hit = list.find(r => r.path === path)
  const row: EditRec = {
    path,
    n: (hit?.n ?? 0) + 1,
    added: (hit?.added ?? 0) + clampN(added, 0, 1e6),
    removed: (hit?.removed ?? 0) + clampN(removed, 0, 1e6),
    last: at,
  }

  return [...list.filter(r => r.path !== path), row].slice(-CAP.edits)
}

export const addPrompt = (list: readonly PromptRec[], rec: PromptRec): PromptRec[] => [...list, rec].slice(-CAP.prompts)

export const addSample = (list: readonly SampleRec[], rec: SampleRec): SampleRec[] => [...list, rec].slice(-CAP.samples)

export const trimDays = (days: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(days).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-CAP.days))

/** The biggest milestone passed when a count goes from `before` to `after`, if any. */
export const milestoneCrossed = (before: number, after: number): number | undefined => {
  let hit: number | undefined

  for (const m of MILESTONES) {
    if (before < m && after >= m) {
      hit = m
    }
  }

  return hit
}

// ---------------------------------------------------------------- estimate for a running call

export type Eta = { tool: string; elapsedMs: number; typicalMs: number; fraction: number; leftMs: number; samples: number }

/** Looks at earlier finished, successful calls of the same tool. Needs three; fewer gives no estimate (a guess is not shown). */
export const etaFor = (calls: readonly CallRec[], running: CallRec, now: number): Eta | undefined => {
  const same = calls
    .filter(c => c.tool === running.tool && c.endedAt !== null && !c.isError && c.id !== running.id)
    .slice(-20)
    .map(c => (c.endedAt ?? 0) - c.startedAt)
    .filter(ms => ms >= 0)

  if (same.length < 3) {
    return undefined
  }
  const typicalMs = Math.max(200, median(same))
  const elapsedMs = Math.max(0, now - running.startedAt)

  return {
    tool: running.tool,
    elapsedMs,
    typicalMs,
    fraction: Math.min(0.95, elapsedMs / typicalMs),
    leftMs: Math.max(0, typicalMs - elapsedMs),
    samples: same.length,
  }
}

// ---------------------------------------------------------------- store cleaning

export const cleanDays = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {}

  for (const [k, n] of Object.entries(asRecord(v))) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      out[k] = Math.min(n, 100_000)
    }
  }

  return trimDays(out)
}

export const cleanHours = (v: unknown): number[] =>
  Array.from({ length: 24 }, (_, i) => clampN(Array.isArray(v) ? v[i] : 0, 0, 1e6, 0))

export const cleanAcc = (v: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {}

  for (const [k, b] of Object.entries(asRecord(v)).slice(0, 60)) {
    if (/^[a-z]{1,12}\.[a-z]{1,12}$/.test(k) && typeof b === 'boolean') {
      out[k] = b
    }
  }

  return out
}

export const DEFAULT_PREFS: UiPrefs = { view: 'timeline', split: 'none', mini: false }

export const DEFAULT_UI: UiState = {
  ...DEFAULT_PREFS,
  sel: {},
  open: [],
  enterAt: 0,
  loadingUntil: 0,
  pulseAt: 0,
  pulseKeys: [],
  celebrateAt: 0,
  celebrateN: 0,
  failOnce: false,
  lastToastAt: 0,
}

export const cleanPrefs = (v: unknown): UiPrefs => {
  const r = asRecord(v)

  return {
    view: isView(r.view) ? r.view : 'timeline',
    split: r.split !== 'lab' && isView(r.split) ? r.split : 'none',
    mini: r.mini === true,
  }
}

export const DEFAULT_LAB: LabState = {
  items: [
    { id: 1, name: 'Draft the summary', on: true, list: 'a', pending: false, okAt: 0 },
    { id: 2, name: 'Check the numbers', on: false, list: 'a', pending: false, okAt: 0 },
    { id: 3, name: 'Send for review', on: false, list: 'b', pending: false, okAt: 0 },
  ],
  nextId: 4,
  editing: 0,
  step: 0,
  picks: [0, 0, 0],
  done: false,
  undo: null,
}

export const cleanName = (s: unknown): string => (typeof s === 'string' ? s.replace(/[\r\n\t]+/g, ' ').trim().slice(0, CAP.labName) : '')

export const cleanLab = (v: unknown): LabState => {
  const r = asRecord(v)
  const items = (Array.isArray(r.items) ? r.items : [])
    .map(asRecord)
    .map((x, i) => ({
      id: clampN(x.id, 1, 1e6, i + 1),
      name: cleanName(x.name),
      on: x.on === true,
      list: x.list === 'b' ? ('b' as const) : ('a' as const),
      pending: false,
      okAt: 0,
    }))
    .filter(x => x.name !== '')
    .slice(0, CAP.lab)

  if (items.length === 0 && !Array.isArray(r.items)) {
    return DEFAULT_LAB
  }
  const nextId = Math.max(clampN(r.nextId, 1, 1e6, 1), ...items.map(x => x.id + 1))

  return { ...DEFAULT_LAB, items, nextId }
}

/** What goes to the store for the lab: names, flags and lists only. */
export const labToStore = (l: LabState) => ({
  items: l.items.map(x => ({ id: x.id, name: x.name, on: x.on, list: x.list })),
  nextId: l.nextId,
})

// ---------------------------------------------------------------- demo data

export type Data = {
  now: number
  startedAt: number
  calls: CallRec[]
  edits: EditRec[]
  prompts: PromptRec[]
  samples: SampleRec[]
  days: Record<string, number>
  hours: number[]
  isDemo: boolean
}

export const emptyData = (now: number): Data => ({
  now,
  startedAt: now,
  calls: [],
  edits: [],
  prompts: [],
  samples: [],
  days: {},
  hours: Array.from({ length: 24 }, () => 0),
  isDemo: false,
})

/** Made-up data, deterministic for one `now`: used by /uidemo and by the tests. */
export const demoData = (now: number): Data => {
  const tools = ['Read', 'Grep', 'Edit', 'Bash', 'Read', 'Edit', 'Bash', 'Write', 'Glob', 'Bash']
  const details = ['register.tsx', 'handler', 'data.ts', 'npm', 'svg.ts', 'model.ts', 'git', 'notes.md', '*.ts', 'node']
  const start = now - 40 * 60_000
  const calls: CallRec[] = []
  let t = start

  for (let i = 0; i < 40; i++) {
    const tool = tools[i % tools.length] ?? 'Read'
    const ms = tool === 'Bash' ? 1500 + ((i * 937) % 9000) : 150 + ((i * 211) % 1400)
    t += 20_000 + ((i * 7919) % 50_000)
    const isError = i % 11 === 7
    const isRunning = i === 39
    calls.push({
      id: `d${i}`,
      tool,
      detail: details[i % details.length] ?? '',
      startedAt: isRunning ? now - 2600 : t,
      endedAt: isRunning ? null : t + ms,
      isError,
      msg: isError ? (i % 2 === 0 ? 'exit code 1: 3 tests failed in /app/test/a.test.ts' : 'No such file or directory: /app/src/gone.ts') : '',
      out: 200 + ((i * 313) % 4000),
    })
  }
  const paths = ['src/a.ts', 'src/b.ts', 'src/ui/pane.tsx', 'src/ui/svg.ts', 'test/a.test.ts', 'docs/notes.md', 'package.json', 'src/data.ts']
  const edits: EditRec[] = paths.map((path, i) => ({
    path: `/app/${path}`,
    n: 9 - i,
    added: 120 - i * 13,
    removed: 40 - i * 4,
    last: now - i * 240_000,
  }))
  const prompts: PromptRec[] = Array.from({ length: 14 }, (_, i) => ({
    at: start + i * 160_000,
    len: 20 + ((i * 53) % 400),
    snip: '',
  }))
  const samples: SampleRec[] = [0.1, 0.3, 0.45, 0.9, 1.1, 1.0, 1.6, 2.0, 2.2, 2.9, 3.2].map((usd, i) => ({
    t: start + i * 200_000,
    usd: i === 5 ? 1.1 : usd,
    ctx: 10 + i * 5,
  }))
  const days: Record<string, number> = {}

  for (let i = 0; i < 84; i++) {
    const wave = Math.sin(i / 3) + Math.cos(i / 5)

    if (i % 7 !== 0 && wave > -0.6) {
      days[dayKey(now - i * 86_400_000)] = Math.round(3 + 9 * (wave + 1.6))
    }
  }
  const hours = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 18 ? 4 + ((h * 5) % 11) : h >= 20 && h <= 22 ? 3 : 0))

  return { now, startedAt: start, calls, edits, prompts, samples, days, hours, isDemo: true }
}
