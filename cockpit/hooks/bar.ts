// The configurable bar above the prompt: pure logic only. No `$`, no engine, no disk, no network.
// register.tsx wires events to the reducers here; barview.tsx draws the tree; hud.ts and barsvg.ts draw the pictures.

import type { BarConfig, BarLive, BarMode, BarRunning, GitInfo } from '../types'

export type { BarConfig, BarLive, BarMode }

// ------------------------------------------------------------------ the item catalog

export type ItemKind = 'chip' | 'button' | 'look' | 'smart' | 'line'

export type ItemDef = {
  id: string
  label: string
  kind: ItemKind
  group: 'Live' | 'Numbers' | 'Actions' | 'Project' | 'Looks' | 'Smart'
  /** The idea numbers (1-60) this item answers. */
  ideas: readonly number[]
}

const item = (id: string, label: string, kind: ItemKind, group: ItemDef['group'], ...ideas: number[]): ItemDef => ({
  id,
  label,
  kind,
  group,
  ideas,
})

export const ITEMS: readonly ItemDef[] = [
  item('file', 'File being edited', 'chip', 'Live', 1),
  item('timer', 'Turn timer', 'chip', 'Live', 2),
  item('step', 'Todo step count', 'chip', 'Live', 3),
  item('trail', 'Last five tools', 'chip', 'Live', 4),
  item('mode', 'Mode light', 'look', 'Live', 5),
  item('eta', 'Time estimate', 'chip', 'Live', 6),
  item('command', 'Running command', 'chip', 'Live', 7),
  item('background', 'Background tasks', 'chip', 'Live', 8),
  item('savepulse', 'Pulse on file save', 'look', 'Live', 9),
  item('failflash', 'Red flash on failure', 'look', 'Live', 10),

  item('reset', 'Limit reset time', 'chip', 'Numbers', 11),
  item('pace', 'Limit at this pace', 'chip', 'Numbers', 12),
  item('turncost', 'Last turn cost', 'chip', 'Numbers', 13),
  item('today', 'Spend today', 'chip', 'Numbers', 14),
  item('budget', 'Budget bar', 'chip', 'Numbers', 15),
  item('tokens', 'Tokens left', 'chip', 'Numbers', 16),
  item('lines', 'Lines added and removed', 'chip', 'Numbers', 17),
  item('tests', 'Tests passed and failed', 'chip', 'Numbers', 18),
  item('errors', 'Error count button', 'button', 'Numbers', 19),
  item('length', 'Session length', 'chip', 'Numbers', 20),

  item('tests-run', 'Run tests button', 'button', 'Actions', 21),
  item('commit', 'Commit button', 'button', 'Actions', 22),
  item('explain', 'Explain that button', 'button', 'Actions', 23),
  item('undo', 'Undo last change button', 'button', 'Actions', 24),
  item('continue', 'Continue button', 'button', 'Actions', 25),
  item('fix', 'Fix the error button', 'button', 'Actions', 26),
  item('compact', 'Compact button', 'button', 'Actions', 27),
  item('newsession', 'New session summary button', 'button', 'Actions', 28),
  item('files', 'Changed files button', 'button', 'Actions', 29),
  item('custom', 'My own buttons', 'button', 'Actions', 30),

  item('branch', 'Branch', 'chip', 'Project', 31),
  item('changes', 'Uncommitted count', 'chip', 'Project', 32),
  item('sync', 'Ahead and behind', 'chip', 'Project', 33),
  item('git', 'Git text line', 'line', 'Project', 31, 32, 33),
  item('project', 'Project name colour', 'chip', 'Project', 34),
  item('testresult', 'Last test result', 'chip', 'Project', 35),
  item('build', 'Build light', 'chip', 'Project', 36),
  item('todos', 'Open todos', 'chip', 'Project', 37),
  item('note', 'Pinned note', 'line', 'Project', 38),
  item('goal', 'Session goal', 'line', 'Project', 39),
  item('deadline', 'Deadline countdown', 'chip', 'Project', 40),

  item('edge', 'Edge colour by state', 'look', 'Looks', 41),
  item('glow', 'Glow when a task finishes', 'look', 'Looks', 42),
  item('roll', 'Rolling digits', 'look', 'Looks', 43),
  item('wave', 'Waveform while working', 'look', 'Looks', 44),
  item('heartbeat', 'Activity heartbeat', 'chip', 'Looks', 45),
  item('daynight', 'Day to night tint', 'look', 'Looks', 49),
  item('celebrate', 'Sweep on green tests', 'look', 'Looks', 50),

  item('changed', 'Show only what changed', 'smart', 'Smart', 51),
  item('grow', 'Grow when you are needed', 'smart', 'Smart', 52),
  item('waiting', 'Waiting for your answer', 'smart', 'Smart', 53),
  item('contextwarn', 'Context warning card', 'smart', 'Smart', 54),
  item('auto', 'Different for chat and code', 'smart', 'Smart', 55),
  item('hidetyping', 'Hide while typing', 'smart', 'Smart', 56),
  item('more', 'More and Less button', 'button', 'Smart', 47),
  item('quietbtn', 'Quiet button', 'button', 'Smart', 60),
]

export const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map(i => [i.id, i]))

export const SIZES = ['slim', 'normal', 'expanded'] as const
export const THEMES = ['glass', 'midnight', 'paper', 'neon'] as const
export type Size = (typeof SIZES)[number]
export type Theme = (typeof THEMES)[number]

// ------------------------------------------------------------------ presets and config

const CLEAN = ['more', 'fix', 'compact', 'custom', 'continue', 'tests-run', 'commit', 'waiting', 'git'] as const

const CODING = [
  ...CLEAN,
  'undo',
  'files',
  'errors',
  'mode',
  'edge',
  'failflash',
  'celebrate',
  'file',
  'command',
  'step',
  'testresult',
  'build',
  'branch',
  'changes',
  'lines',
  'tests',
]

const NUMBERS = [...CLEAN, 'turncost', 'today', 'tokens', 'reset', 'pace', 'length', 'budget', 'heartbeat', 'roll']

export const PRESETS = {
  clean: { items: [...CLEAN] as string[], size: 'normal' as Size },
  coding: { items: CODING as string[], size: 'expanded' as Size },
  numbers: { items: NUMBERS as string[], size: 'expanded' as Size },
  // Everything except the two that change what is shown rather than add to it.
  everything: {
    items: [...CLEAN, ...ITEMS.map(i => i.id).filter(id => !(CLEAN as readonly string[]).includes(id) && id !== 'changed' && id !== 'hidetyping')],
    size: 'expanded' as Size,
  },
} as const

export const defaultConfig = (): BarConfig => ({
  items: [...PRESETS.clean.items],
  size: 'normal',
  theme: 'glass',
  quiet: false,
  note: '',
  goal: '',
  deadline: null,
  budget: null,
  buttons: [],
})

export const DEFAULT_CONFIG: BarConfig = defaultConfig()

export const MAX_BUTTONS = 5

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Turns whatever the store held into a config that is safe to draw. */
export const sanitizeConfig = (raw: unknown, now: number): BarConfig => {
  const base = defaultConfig()

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return base
  }
  const r = raw as Record<string, unknown>
  const items = Array.isArray(r.items)
    ? [...new Set(r.items.filter((x): x is string => typeof x === 'string' && ITEM_BY_ID.has(x)))]
    : base.items
  const deadline = r.deadline as { at?: unknown; label?: unknown } | null | undefined
  const at = Number(deadline?.at)
  const budget = Number(r.budget)
  const buttons = (Array.isArray(r.buttons) ? r.buttons : [])
    .map(b => ({ label: text((b as { label?: unknown })?.label, 14), text: String((b as { text?: unknown })?.text ?? '').trim().slice(0, 500) }))
    .filter(b => b.label !== '' && b.text !== '')
    .slice(0, MAX_BUTTONS)

  return {
    items,
    size: SIZES.includes(r.size as Size) ? (r.size as Size) : base.size,
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : base.theme,
    quiet: r.quiet === true,
    note: text(r.note, 80),
    goal: '',
    // A deadline that passed more than a day ago is dropped.
    deadline: Number.isFinite(at) && at > now - 86_400_000 ? { at, label: text(deadline?.label, 24) || 'deadline' } : null,
    budget: Number.isFinite(budget) && budget > 0 ? budget : null,
    buttons,
  }
}

/** What goes to the store: the goal belongs to one session only. */
export const storable = (c: BarConfig): Omit<BarConfig, 'goal'> => {
  const { goal: _goal, ...rest } = c

  return rest
}

/** A short stable key for a folder, so the path itself is never written down. */
export const projectKey = (cwd: string): string => {
  let h = 0x811c9dc5

  for (let i = 0; i < cwd.length; i += 1) {
    h ^= cwd.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return h.toString(16).padStart(8, '0')
}

export const projectName = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).pop()?.slice(0, 24) ?? ''

/** Hue 0-359 from the project's name, for its own colour. */
export const projectHue = (name: string): number => parseInt(projectKey(name), 16) % 360

export const has = (c: BarConfig, id: string): boolean => c.items.includes(id)

export const needsTicker = (c: BarConfig): boolean =>
  !c.quiet && c.size === 'expanded' && (has(c, 'timer') || has(c, 'eta') || (has(c, 'deadline') && c.deadline !== null))

/** The ticker is needed when a ticking item can be on screen. `grow` can open the second strip in normal size. */
export const wantsTicker = (c: BarConfig): boolean =>
  needsTicker(c) || (!c.quiet && has(c, 'grow') && (has(c, 'timer') || has(c, 'eta') || (has(c, 'deadline') && c.deadline !== null)))

// ------------------------------------------------------------------ time and money

export const pad2 = (n: number) => String(n).padStart(2, '0')

export const clockOf = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)

  return h > 0 ? `${h}:${pad2(m)}:${pad2(total % 60)}` : `${pad2(m)}:${pad2(total % 60)}`
}

export const spanOf = (min: number) =>
  min < 90 ? `${Math.max(1, Math.round(min))} min` : `${Math.floor(Math.round(min) / 60)}h ${pad2(Math.round(min) % 60)}m`

export const hhmm = (ms: number) => {
  const d = new Date(ms)

  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export const moneyOf = (n: number) => {
  const v = Math.max(0, Math.min(1_000_000, Number.isFinite(n) ? n : 0))

  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
}

export const countOf = (n: number) => {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0))

  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
}

/**
 * Minutes until a window fills at the current pace: a least-squares line through
 * the trailing run of non-decreasing samples (a drop means the window reset).
 * Null when there is no upward trend to project.
 */
export const forecastMin = (samples: readonly { t: number; p: number }[]): number | null => {
  let start = samples.length - 1

  while (start > 0 && (samples[start - 1]?.p ?? 0) <= (samples[start]?.p ?? 0)) {
    start -= 1
  }
  const pts = samples.slice(Math.max(start, samples.length - 8))

  if (pts.length < 2) {
    return null
  }
  const n = pts.length
  const mt = pts.reduce((s, x) => s + x.t, 0) / n
  const mp = pts.reduce((s, x) => s + x.p, 0) / n
  let num = 0
  let den = 0

  for (const x of pts) {
    num += (x.t - mt) * (x.p - mp)
    den += (x.t - mt) ** 2
  }
  const last = pts[n - 1]

  if (den === 0 || last === undefined || num <= 0) {
    return null
  }

  return last.p >= 100 ? 0 : (100 - last.p) / (num / den) / 60_000
}

/** HH:MM today, or tomorrow when that time has passed. */
export const deadlineAt = (hm: string, now: number): number | null => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hm)

  if (m === null) {
    return null
  }
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)

  if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1)
  }

  return d.getTime()
}

// ------------------------------------------------------------------ reading tool calls

// A runner counts only where a command starts, so reading `jest.config.js` is not a test run.
const TEST_START = /^((npm|pnpm|yarn|bun)\s+(run\s+)?test|(vitest|jest|mocha)|pytest|unittest|rspec|(go|cargo|swift|deno|dotnet|mvn|gradle)\s+test|(\.\/)?gradlew\s+test|make\s+(test|check)|claude\s+plugin\s+test)(?![\w.-])/
const BUILD_START = /^((npm|pnpm|yarn|bun)\s+(run\s+)?build|cargo\s+(build|check)|go\s+build|swift\s+build|xcodebuild|dotnet\s+build|(\.\/)?gradlew?\s+build|mvn\s+(compile|package)|make(\s+(build|all))?\s*$|tsc|vite\s+build)(?![\w.-])/

/** The commands of a shell line, without variables and wrappers in front. */
const segments = (command: string): string[] =>
  command
    .split(/&&|\|\||[;|\n]/)
    .map(s => s.trim().replace(/^((\w+=\S*|npx|bunx|time|env|poetry run|bundle exec|python3? -m|pnpm exec)\s+)+/, ''))

export const isTestCommand = (command: string): boolean => segments(command).some(s => TEST_START.test(s))
export const isBuildCommand = (command: string): boolean => segments(command).some(s => BUILD_START.test(s))

/** A command sent to the background answers at once, so it has no result to read yet. */
export const isBackgrounded = (input: Record<string, unknown>, result: unknown): boolean =>
  input.run_in_background === true || (result as { backgroundTaskId?: unknown } | null | undefined)?.backgroundTaskId !== undefined

const EDITS = new Set(['Edit', 'Write', 'NotebookEdit'])
const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch'])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? ''

export const modeOf = (tool: string, command: string): BarMode => {
  if (EDITS.has(tool)) {
    return 'editing'
  }

  if (READS.has(tool)) {
    return 'reading'
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    return isTestCommand(command) ? 'testing' : 'running'
  }

  return tool === 'AskUserQuestion' ? 'asking' : 'running'
}

/** The running call in plain words. A Bash description is already plain words. */
export const plainWords = (tool: string, input: Record<string, unknown>): string => {
  const command = str(input.command).trim()
  const file = baseName(str(input.file_path) || str(input.notebook_path))
  const description = str(input.description).replace(/\s+/g, ' ').trim()

  if (tool === 'Bash' || tool === 'PowerShell') {
    if (description !== '') {
      return description.slice(0, 80)
    }

    if (isTestCommand(command)) {
      return 'running the tests'
    }

    if (isBuildCommand(command)) {
      return 'building the project'
    }

    if (/^git\s+commit/.test(command)) {
      return 'committing changes'
    }

    if (/^git\s/.test(command)) {
      return 'checking git'
    }

    if (/\b(npm|pnpm|yarn|bun|pip3?|brew|cargo)\s+(install|add|i)\b/.test(command)) {
      return 'installing packages'
    }
    const first = baseName(command.split(/\s+/)[0] ?? '')

    return first === '' ? 'running a command' : `running ${first.slice(0, 30)}`
  }

  if (EDITS.has(tool)) {
    return `editing ${file || 'a file'}`
  }

  if (tool === 'Read') {
    return `reading ${file || 'a file'}`
  }

  if (tool === 'Grep' || tool === 'Glob') {
    return 'searching the code'
  }

  if (tool === 'WebFetch' || tool === 'WebSearch') {
    return 'reading the web'
  }

  if (tool === 'Agent' || tool === 'Task') {
    return 'asking a helper agent'
  }

  return `using ${tool.replace(/^mcp__.*__/, '').slice(0, 30)}`
}

/** The first two plain words of a command: what durations are filed under. Never arguments with odd characters. */
export const commandKey = (command: string): string => {
  const words: string[] = []

  for (const w of command.trim().split(/\s+/)) {
    if (w.startsWith('-')) {
      continue
    }

    if (words.length >= 3 || !/^[a-z][a-z0-9:_.-]{0,20}$/i.test(w)) {
      break
    }
    words.push(w.toLowerCase())
  }

  return words.join(' ')
}

export type Durations = Record<string, number[]>

export const rememberDuration = (d: Durations, key: string, ms: number): Durations => {
  if (key === '' || !Number.isFinite(ms) || ms < 3000) {
    return d
  }
  const rest = Object.entries(d).filter(([k]) => k !== key)

  return Object.fromEntries([...rest.slice(-39), [key, [...(d[key] ?? []), Math.round(ms)].slice(-5)]])
}

/** The median of the remembered runs, or null when this command was never slow. */
export const estimateOf = (d: Durations, key: string): number | null => {
  const list = key === '' ? undefined : d[key]

  if (list === undefined || list.length === 0) {
    return null
  }
  const sorted = [...list].sort((a, b) => a - b)

  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null
}

export const testCounts = (output: string): { passed: number | null; failed: number | null } => {
  const last = (re: RegExp): number | null => {
    const all = [...output.slice(-6000).matchAll(re)]
    const hit = all[all.length - 1]

    return hit === undefined ? null : Number(hit[1])
  }

  return {
    passed: last(/(\d+)\s+(?:tests?\s+)?(?:passed|passing|pass)\b/gi),
    failed: last(/(\d+)\s+(?:tests?\s+)?(?:failed|failing|failures?|fail)\b/gi),
  }
}

export const testsPassed = (isError: boolean, output: string): boolean =>
  !isError && !/\b[1-9]\d*\s+(failed|failing|failures?|errors?)\b/i.test(output) && !/^FAILED \(/m.test(output) && (testCounts(output).failed ?? 0) === 0

type Hunk = { lines?: unknown }

/** Lines added and removed by a finished Edit or Write. */
export const lineDelta = (tool: string, input: Record<string, unknown>, result: unknown): { added: number; removed: number } => {
  const r = (typeof result === 'object' && result !== null ? result : {}) as Record<string, unknown>
  const patch = Array.isArray(r.structuredPatch) ? (r.structuredPatch as Hunk[]) : []
  let added = 0
  let removed = 0

  if (r.staged === true) {
    return { added, removed }
  }

  for (const hunk of patch) {
    for (const line of Array.isArray(hunk.lines) ? hunk.lines : []) {
      added += String(line).startsWith('+') ? 1 : 0
      removed += String(line).startsWith('-') ? 1 : 0
    }
  }

  if (patch.length > 0) {
    return { added, removed }
  }
  const split = (s: string) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'))

  if (tool === 'Edit') {
    const a = split(str(input.old_string))
    const b = split(str(input.new_string))
    let head = 0

    while (head < a.length && head < b.length && a[head] === b[head]) {
      head += 1
    }
    let tail = 0

    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
      tail += 1
    }

    return { added: b.length - head - tail, removed: a.length - head - tail }
  }

  // A new file: every line is new. An overwrite with no patch is unknown, so it counts nothing.
  if (tool === 'Write' && r.type === 'create') {
    return { added: split(str(input.content)).length, removed: 0 }
  }

  return { added, removed }
}

// ------------------------------------------------------------------ the live digest and its reducers

export const emptyLive = (): BarLive => ({
  isTurn: false,
  turnStartedAt: 0,
  sessionStartedAt: 0,
  cwd: '',
  calls: 0,
  running: [],
  trail: [],
  waiting: null,
  question: '',
  failure: null,
  saves: 0,
  savedFile: '',
  outcome: null,
  isCelebrating: false,
  tasks: [],
  background: 0,
  contextPct: null,
  prevContextPct: null,
  tokensLeft: null,
  costUsd: null,
  prevCostUsd: null,
  turnStartUsd: null,
  turnUsd: null,
  todayUsd: null,
  limit: null,
  trend: [],
  added: 0,
  removed: 0,
  edited: [],
  editedThisTurn: 0,
  isUntested: false,
  isCoding: false,
  test: null,
  build: null,
  errorCount: 0,
  beats: [],
  turnsDone: 0,
  before: {},
})

export const EMPTY_LIVE: BarLive = emptyLive()

export type ToolStart = { id: string; tool: string; input: Record<string, unknown>; at: number; estimateMs: number | null; isAgent: boolean }

export const reduceToolStart = (l: BarLive, e: ToolStart): BarLive => {
  const command = str(e.input.command)
  const run: BarRunning = {
    id: e.id,
    tool: e.tool,
    file: EDITS.has(e.tool) ? baseName(str(e.input.file_path) || str(e.input.notebook_path)).slice(0, 40) : '',
    plain: plainWords(e.tool, e.input),
    mode: modeOf(e.tool, command),
    startedAt: e.at,
    estimateMs: e.estimateMs,
  }
  const questions = e.input.questions

  return {
    ...l,
    calls: l.calls + 1,
    running: [...l.running, run].slice(-5),
    isCelebrating: false,
    savedFile: '',
    waiting: e.tool === 'AskUserQuestion' ? 'question' : l.waiting,
    question:
      e.tool === 'AskUserQuestion' && Array.isArray(questions)
        ? str((questions[0] as { question?: unknown } | undefined)?.question).slice(0, 90)
        : l.question,
    isCoding: l.isCoding || EDITS.has(e.tool) || e.tool === 'Bash' || e.tool === 'PowerShell',
    beats: l.beats.length === 0 ? [1] : [...l.beats.slice(0, -1), (l.beats[l.beats.length - 1] ?? 0) + 1],
  }
}

export type ToolEnd = {
  id: string
  tool: string
  input: Record<string, unknown>
  at: number
  /** Null for success, else what went wrong. */
  failure: string | null
  isDenied: boolean
  output: string
  result: unknown
  isAgent: boolean
}

const applyTask = (tasks: BarLive['tasks'], tool: string, input: Record<string, unknown>, result: unknown): BarLive['tasks'] => {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    return (input.todos as { content?: unknown; status?: unknown }[])
      .slice(0, 40)
      .map((t, i) => ({ id: String(i + 1), status: str(t.status) || 'pending', label: str(t.content).slice(0, 60) }))
  }

  if (tool === 'TaskCreate') {
    const id = str((result as { task?: { id?: unknown } } | undefined)?.task?.id)
    // A finished list starts over when new tasks arrive.
    const kept = tasks.every(t => t.status === 'completed') ? [] : tasks

    return id === '' ? tasks : [...kept, { id, status: 'pending', label: str(input.subject).slice(0, 60) }].slice(-40)
  }

  if (tool === 'TaskUpdate') {
    const id = str(input.taskId)

    if (input.status === 'deleted') {
      return tasks.filter(t => t.id !== id)
    }

    return tasks.map(t =>
      t.id === id ? { id, status: str(input.status) || t.status, label: str(input.subject).slice(0, 60) || t.label } : t,
    )
  }

  // The desktop app's task list: a whole list, or moves along it.
  if (tool === 'mcp__ccd_turn__update_plan') {
    if (Array.isArray(input.items)) {
      return (input.items as { content?: unknown; status?: unknown }[])
        .slice(0, 40)
        .map((t, i) => ({ id: String(i + 1), status: str(t.status) || 'pending', label: str(t.content).slice(0, 60) }))
    }
    let moved = tasks

    if (input.advance === true) {
      const at = moved.findIndex(t => t.status === 'in_progress')
      moved = moved.map((t, i) => (i === at ? { ...t, status: 'completed' } : t))
      const following = moved.findIndex(t => t.status === 'pending')
      moved = moved.map((t, i) => (i === following ? { ...t, status: 'in_progress' } : t))
    }
    const done = Array.isArray(input.done) ? input.done.map(Number) : []
    const start = Number(input.start)

    return moved.map((t, i) =>
      done.includes(i + 1) ? { ...t, status: 'completed' } : i + 1 === start ? { ...t, status: 'in_progress' } : t,
    )
  }

  // Wrapping up closes the list.
  if (tool === 'mcp__ccd_turn__wrap_up') {
    return tasks.map(t => ({ ...t, status: 'completed' }))
  }

  return tasks
}

export const reduceToolEnd = (l: BarLive, e: ToolEnd): BarLive => {
  const command = str(e.input.command)
  const isShell = e.tool === 'Bash' || e.tool === 'PowerShell'
  const isOk = e.failure === null
  const key = commandKey(command)
  const isPending = isShell && isOk && isBackgrounded(e.input, e.result)
  let next: BarLive = {
    ...l,
    running: l.running.filter(r => r.id !== e.id),
    trail: [...l.trail, { tool: e.tool, isOk }].slice(-5),
    waiting: null,
    question: '',
    tasks: isOk && !e.isAgent ? applyTask(l.tasks, e.tool, e.input, e.result) : l.tasks,
  }

  // A refusal is not a failed command: only things that ran and broke count towards "fix it".
  if (!isOk) {
    next.errorCount = l.errorCount + 1

    if (!e.isDenied && (isShell || EDITS.has(e.tool))) {
      next.failure = {
        tool: e.tool,
        key: isShell ? key : baseName(str(e.input.file_path)),
        plain: plainWords(e.tool, e.input),
        reason: (e.failure ?? '').replace(/\s+/g, ' ').slice(0, 120),
        at: e.at,
      }
    }
  } else if (!isPending && l.failure !== null && l.failure.tool === e.tool && l.failure.key === (isShell ? key : baseName(str(e.input.file_path)))) {
    next.failure = null
  }

  if (isOk && EDITS.has(e.tool)) {
    const path = str(e.input.file_path) || str(e.input.notebook_path)
    const delta = lineDelta(e.tool, e.input, e.result)

    next = {
      ...next,
      saves: l.saves + 1,
      savedFile: baseName(path).slice(0, 30),
      added: l.added + delta.added,
      removed: l.removed + delta.removed,
      edited: path === '' || l.edited.includes(path) ? l.edited : [...l.edited, path].slice(-100),
      editedThisTurn: l.editedThisTurn + 1,
      isUntested: true,
      unproven: path === '' || (l.unproven ?? []).includes(path) ? (l.unproven ?? []) : [...(l.unproven ?? []), path].slice(-100),
    }
  }

  if (isShell && isTestCommand(command) && !e.isDenied && !isPending) {
    const ok = testsPassed(!isOk, e.output)
    next = { ...next, test: { ok, ...testCounts(e.output) }, isUntested: false, isCelebrating: ok, ...(ok ? { unproven: [] } : {}) }

    if (ok && next.failure !== null && next.failure.tool === e.tool) {
      next.failure = null
    }
  }

  if (isShell && isBuildCommand(command) && !e.isDenied && !isPending) {
    next.build = testsPassed(!isOk, e.output)
  }

  return next
}

export const reduceTurnStart = (l: BarLive, at: number): BarLive => ({
  ...l,
  isTurn: true,
  turnStartedAt: at,
  running: [],
  waiting: null,
  question: '',
  failure: null,
  savedFile: '',
  outcome: null,
  isCelebrating: false,
  turnStartUsd: l.costUsd,
  editedThisTurn: 0,
  beats: [...l.beats, 0].slice(-16),
})

export type Usage = {
  contextPct: number | null
  contextTokens: number | null
  window: number | null
  costUsd: number | null
  limit: BarLive['limit']
}

export const reduceUsage = (l: BarLive, u: Usage): BarLive => {
  const left =
    u.window === null
      ? null
      : u.contextTokens !== null
        ? Math.max(0, u.window - u.contextTokens)
        : u.contextPct !== null
          ? Math.max(0, Math.round(u.window * (1 - u.contextPct / 100)))
          : null

  return {
    ...l,
    prevContextPct: l.contextPct,
    contextPct: u.contextPct,
    tokensLeft: left,
    prevCostUsd: l.costUsd,
    costUsd: u.costUsd,
    limit: u.limit,
    trend: u.contextPct === null ? l.trend : [...l.trend, u.contextPct].slice(-24),
  }
}

export const reduceTurnEnd = (l: BarLive, e: { isAnswer: boolean; todayUsd: number | null }): BarLive => ({
  ...l,
  isTurn: false,
  running: [],
  waiting: null,
  question: '',
  outcome: l.failure !== null || !e.isAnswer ? 'error' : 'ok',
  savedFile: '',
  turnUsd: l.costUsd === null || l.turnStartUsd === null ? null : Math.max(0, l.costUsd - l.turnStartUsd),
  turnStartUsd: null,
  todayUsd: e.todayUsd,
  turnsDone: l.turnsDone + 1,
})

// ------------------------------------------------------------------ chips

export type Tone = 'ok' | 'warn' | 'bad' | 'mut'

export type Chip = {
  id: string
  label: string
  value: string
  tone?: Tone
  isWide?: boolean
  spark?: readonly number[]
  trail?: readonly { tool: string; isOk: boolean }[]
  /** 0 to 1: a progress bar under the value. */
  fill?: number
  hue?: number
}

export type ChipContext = {
  config: BarConfig
  live: BarLive
  git: GitInfo
  openTodos: number
  now: number
  isWorking: boolean
}

export const stepOf = (tasks: BarLive['tasks']): { n: number; of: number; label: string; open: number } | null => {
  const of = tasks.length

  if (of === 0) {
    return null
  }
  const done = tasks.filter(t => t.status === 'completed').length
  const active = tasks.findIndex(t => t.status === 'in_progress')

  return {
    n: active >= 0 ? active + 1 : Math.min(of, done + 1),
    of,
    label: active >= 0 ? (tasks[active]?.label ?? '') : '',
    open: of - done,
  }
}

export const isCodingSession = (l: BarLive): boolean => l.isCoding || l.edited.length > 0 || l.test !== null || l.build !== null

export const CODING_ITEMS: ReadonlySet<string> = new Set([
  'file',
  'lines',
  'tests',
  'testresult',
  'build',
  'branch',
  'changes',
  'sync',
  'git',
  'tests-run',
  'commit',
  'undo',
  'files',
])

const chipOf = (id: string, c: ChipContext): Chip | null => {
  const { live, git, now, config } = c
  const run = live.running[live.running.length - 1]

  switch (id) {
    case 'file':
      return run !== undefined && run.file !== '' ? { id, label: 'editing', value: run.file, isWide: true } : null
    case 'timer':
      return c.isWorking && live.turnStartedAt > 0 ? { id, label: 'this turn', value: clockOf(now - live.turnStartedAt) } : null
    case 'step': {
      const s = stepOf(live.tasks)

      return s === null ? null : { id, label: 'step', value: `${s.n} of ${s.of}` }
    }
    case 'trail':
      return live.trail.length === 0 ? null : { id, label: 'last tools', value: live.trail.map(t => t.tool).join(', '), trail: live.trail }
    case 'eta': {
      if (run === undefined || run.estimateMs === null) {
        return null
      }
      const left = run.startedAt + run.estimateMs - now

      return { id, label: 'estimate', value: left > 0 ? `~${spanShort(left)} left` : 'past avg', tone: left > 0 ? undefined : 'warn' }
    }
    case 'command':
      return run === undefined ? null : { id, label: 'running', value: run.plain, isWide: true }
    case 'background':
      return live.background > 0 ? { id, label: 'background', value: `${live.background} ${live.background === 1 ? 'task' : 'tasks'}` } : null
    case 'reset': {
      const at = live.limit?.resetsAt ?? null

      return at === null || at <= now ? null : { id, label: 'resets', value: `in ${spanOf((at - now) / 60_000)}` }
    }
    case 'pace': {
      const m = live.limit?.paceMin ?? null

      if (m === null) {
        return null
      }
      const at = live.limit?.resetsAt ?? null

      return at !== null && now + m * 60_000 > at
        ? { id, label: 'at this pace', value: 'resets first', tone: 'ok', isWide: true }
        : { id, label: 'at this pace', value: `full in ${spanOf(m)}`, tone: m < 30 ? 'warn' : undefined, isWide: true }
    }
    case 'turncost':
      return live.turnUsd === null ? null : { id, label: 'last turn', value: moneyOf(live.turnUsd) }
    case 'today':
      return live.todayUsd === null ? null : { id, label: 'today', value: moneyOf(live.todayUsd) }
    case 'budget': {
      if (config.budget === null || live.costUsd === null) {
        return null
      }
      const frac = live.costUsd / config.budget

      return {
        id,
        label: 'budget',
        value: `${moneyOf(live.costUsd)} / ${moneyOf(config.budget)}`,
        fill: Math.max(0, Math.min(1, frac)),
        tone: frac >= 1 ? 'bad' : frac >= 0.8 ? 'warn' : 'ok',
        isWide: true,
      }
    }
    case 'tokens':
      return live.tokensLeft === null ? null : { id, label: 'tokens left', value: countOf(live.tokensLeft) }
    case 'lines':
      return live.added + live.removed === 0 ? null : { id, label: 'lines', value: `+${countOf(live.added)} -${countOf(live.removed)}` }
    case 'tests': {
      const t = live.test

      if (t === null || (t.passed === null && t.failed === null)) {
        return null
      }

      return { id, label: 'tests', value: `${countOf(t.passed ?? 0)} \u2713 ${countOf(t.failed ?? 0)} \u2717`, tone: t.ok ? 'ok' : 'bad' }
    }
    case 'length':
      return live.sessionStartedAt <= 0 || now <= live.sessionStartedAt
        ? null
        : { id, label: 'session', value: spanOf((now - live.sessionStartedAt) / 60_000) }
    case 'branch':
      return git === null ? null : { id, label: 'branch', value: git.branch, isWide: git.branch.length > 9 }
    case 'changes':
      return git === null
        ? null
        : { id, label: 'uncommitted', value: git.dirty === 0 ? 'clean' : `${git.dirty} files`, tone: git.dirty === 0 ? 'ok' : 'warn' }
    case 'sync':
      return git === null ? null : { id, label: 'vs remote', value: `+${git.ahead} / -${git.behind}` }
    case 'project': {
      const name = projectName(live.cwd)

      return name === '' ? null : { id, label: 'project', value: name, hue: projectHue(name), isWide: name.length > 8 }
    }
    case 'testresult':
      return live.test === null
        ? null
        : { id, label: 'last tests', value: live.test.ok ? 'passed' : 'failed', tone: live.test.ok ? 'ok' : 'bad' }
    case 'build':
      return live.build === null ? null : { id, label: 'build', value: live.build ? 'ok' : 'broken', tone: live.build ? 'ok' : 'bad' }
    case 'todos':
      return c.openTodos === 0 ? null : { id, label: 'todos', value: `${c.openTodos} open` }
    case 'deadline': {
      const d = config.deadline

      if (d === null) {
        return null
      }
      const left = d.at - now

      // A countdown only moves while a turn runs; when idle the clock time is shown, which cannot go stale.
      return left <= 0
        ? { id, label: d.label, value: `due ${hhmm(d.at)}`, tone: 'bad', isWide: true }
        : {
            id,
            label: d.label,
            value: c.isWorking ? `${spanOf(left / 60_000)} left` : `due ${hhmm(d.at)}`,
            tone: left < 900_000 ? 'warn' : undefined,
            isWide: true,
          }
    }
    case 'heartbeat':
      return live.beats.length < 2 ? null : { id, label: 'activity', value: '', spark: live.beats }
    default:
      return null
  }
}

const spanShort = (ms: number) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : spanOf(ms / 60_000))

/** What the expanded view shows when no number or project item was chosen. */
const FALLBACK_CHIPS = ['branch', 'changes', 'turncost', 'tokens', 'testresult', 'length'] as const

/** The chips in the person's order (order is also priority). Items with no real figure are left out. */
export const chipsFor = (c: ChipContext): Chip[] => {
  const chosen = c.config.items.filter(id => ITEM_BY_ID.get(id)?.kind === 'chip')
  const ids = chosen.length > 0 ? chosen : [...FALLBACK_CHIPS]
  const isChat = has(c.config, 'auto') && !isCodingSession(c.live)

  return ids
    .filter(id => !(isChat && CODING_ITEMS.has(id)))
    .map(id => chipOf(id, c))
    .filter((x): x is Chip => x !== null)
}

/** For "show only what changed": every chip's value as it stands now. */
export const snapshotChips = (c: ChipContext): Record<string, string> =>
  Object.fromEntries(chipsFor(c).map(x => [x.id, x.value]))

export const onlyChanged = (chips: readonly Chip[], before: Record<string, string>): Chip[] =>
  chips.filter(x => before[x.id] !== x.value)

// ------------------------------------------------------------------ buttons

export type BarButton = {
  id: string
  label: string
  kind: 'fill' | 'tab' | 'more' | 'quietoff' | 'quiet'
  /** For `fill`: what goes into the prompt box. Never sent. */
  text?: string
  tab?: string
  isPrimary?: boolean
}

export const MAX_ROW = 4
export const CONTEXT_HIGH = 75
export const CONTEXT_FULL = 85

const fillButton = (id: string, label: string, text: string, isPrimary = false): BarButton => ({
  id,
  label,
  kind: 'fill',
  text,
  isPrimary,
})

const actionFor = (id: string, c: ChipContext): BarButton[] => {
  const { live, git, config, isWorking } = c
  const isIdle = !isWorking
  const pct = live.contextPct ?? 0

  switch (id) {
    case 'fix':
      return isIdle && live.failure !== null
        ? [
            fillButton(
              id,
              'Fix the error',
              `Fix the error. This failed: ${live.failure.plain}. ${live.failure.reason}`.trim(),
              true,
            ),
          ]
        : []
    case 'compact':
      return isIdle && pct >= CONTEXT_HIGH ? [fillButton(id, 'Compact', '/compact', pct >= CONTEXT_FULL)] : []
    case 'newsession':
      return isIdle && pct >= CONTEXT_FULL
        ? [
            fillButton(
              id,
              'New session',
              'Write a short summary of this session (the goal, what changed, what is left) that I can paste into a new session.',
            ),
          ]
        : []
    case 'custom':
      return isIdle ? config.buttons.map((b, i) => fillButton(`custom-${i}`, b.label, b.text)) : []
    case 'continue':
      return isIdle && live.turnsDone > 0 ? [fillButton(id, 'Continue', 'Continue.')] : []
    case 'tests-run':
      return isIdle && live.isUntested ? [fillButton(id, 'Run tests', 'Run the tests and tell me what fails.')] : []
    case 'commit':
      return isIdle && git !== null && git.dirty > 0 && live.turnsDone > 0
        ? [fillButton(id, 'Commit', 'Commit the current changes with a clear message.')]
        : []
    case 'explain':
      return isIdle && live.turnsDone > 0 ? [fillButton(id, 'Explain that', 'Explain what you just did and why, in plain words.')] : []
    case 'undo':
      return isIdle && live.editedThisTurn > 0
        ? [fillButton(id, 'Undo change', 'Undo the last change you made, and tell me exactly what you reverted.')]
        : []
    case 'files':
      return live.edited.length > 0 ? [{ id, label: `${live.edited.length} files`, kind: 'tab', tab: 'files' }] : []
    case 'errors':
      return live.errorCount > 0
        ? [{ id, label: live.errorCount === 1 ? '1 error' : `${live.errorCount} errors`, kind: 'tab', tab: 'errors' }]
        : []
    default:
      return []
  }
}

/** The one row of at most four buttons that make sense right now. Urgent ones first, then the person's order. */
export const pickButtons = (c: ChipContext): BarButton[] => {
  const { config } = c

  if (config.quiet) {
    return [{ id: 'quietoff', label: 'Quiet off', kind: 'quietoff' }]
  }
  const tail: BarButton[] = []

  if (has(config, 'more')) {
    tail.push({ id: 'more', label: config.size === 'expanded' ? 'Less' : 'More', kind: 'more' })
  }

  if (has(config, 'quietbtn')) {
    tail.push({ id: 'quiet', label: 'Quiet', kind: 'quiet' })
  }
  const urgent = ['fix', 'compact', 'newsession']
  const order = [...urgent.filter(id => has(config, id)), ...config.items.filter(id => !urgent.includes(id))]
  const isChat = has(config, 'auto') && !isCodingSession(c.live)
  const actions = order.filter(id => !(isChat && CODING_ITEMS.has(id))).flatMap(id => actionFor(id, c))

  return [...actions.slice(0, MAX_ROW - tail.length), ...tail]
}

export const buttonWidth = (label: string): number => label.length * 7 + 28

/** Drops the lowest priority actions (never More or Quiet) until the row fits. */
export const fitButtons = (buttons: readonly BarButton[], px: number): BarButton[] => {
  const out = [...buttons]
  const total = () => out.reduce((s, b) => s + buttonWidth(b.label), 0)

  while (total() > px && out.length > 0) {
    let at = out.length - 1

    while (at > 0 && (out[at]?.kind === 'more' || out[at]?.kind === 'quiet')) {
      at -= 1
    }
    out.splice(at, 1)
  }

  return out
}

// ------------------------------------------------------------------ state of the strip

export type Edge = 'blue' | 'amber' | 'red' | 'green'

export const edgeOf = (l: BarLive, isWorking: boolean): Edge => {
  if (l.waiting !== null) {
    return 'amber'
  }

  if (l.failure !== null) {
    return 'red'
  }

  if ((l.contextPct ?? 0) >= CONTEXT_HIGH) {
    return 'amber'
  }

  if (!isWorking && (l.outcome === 'ok' || l.isCelebrating)) {
    return 'green'
  }

  return 'blue'
}

export type Alert = { tone: 'warn' | 'bad'; title: string; detail: string }

/** The card shown when something needs the person. Only for the items that were chosen. */
export const alertOf = (config: BarConfig, l: BarLive): Alert | null => {
  if (config.quiet) {
    return null
  }

  if (has(config, 'grow') && l.waiting !== null) {
    return l.waiting === 'question'
      ? { tone: 'warn', title: 'Waiting for your answer', detail: l.question || 'Claude asked a question.' }
      : { tone: 'warn', title: 'Waiting for your approval', detail: 'A permission request is open.' }
  }

  if (has(config, 'grow') && l.failure !== null) {
    return { tone: 'bad', title: 'A command failed', detail: l.failure.plain }
  }
  const pct = l.contextPct ?? 0

  if ((has(config, 'contextwarn') || has(config, 'grow')) && pct >= CONTEXT_HIGH) {
    return {
      tone: pct >= CONTEXT_FULL ? 'bad' : 'warn',
      title: `Context ${Math.round(Math.min(100, pct))}% full`,
      detail: 'Compact soon, or start a new session with a summary.',
    }
  }

  return null
}

// ------------------------------------------------------------------ fitting into the band

export type Plan =
  | { kind: 'text' }
  | {
      kind: 'full' | 'slim'
      stripWidth: number
      /** Cockpit and Hide sit beside the strip; otherwise they join the button row. */
      hasSide: boolean
      hasRow: boolean
      hasAlert: boolean
      chipRows: number
      isGitInline: boolean
      hasGitLine: boolean
      lines: number
    }

/** Band rows each part takes, deliberately rounded up: a band that does not fit can be drawn blank. */
export const ROWS = { full: 4, slim: 2, row: 2, alert: 2, chipRow: 3, line: 1 } as const

export type PlanInput = {
  maxRows: number
  columns: number
  isSlim: boolean
  hasAlert: boolean
  chipRows: number
  buttonsPx: number
  gitPx: number
  lines: number
}

/** The narrowest width at which the Cockpit and Hide buttons stand beside a strip that still shows spend. */
export const SIDE_PX = 448

/** The width of the Cockpit and Hide buttons when they sit in the row. */
export const HOUSE_PX = buttonWidth('Cockpit') + buttonWidth('Hide')

export const planBand = (p: PlanInput): Plan => {
  const px = Math.floor(p.columns * 7)

  if (p.maxRows < 4 || px < 304) {
    return { kind: 'text' }
  }
  const kind = p.isSlim ? 'slim' : 'full'
  // Slim keeps every button on the strip's own line, so the line makes room for them (`buttonsPx`).
  const slimWidth = px - (p.buttonsPx + HOUSE_PX + 24)
  // Beside the strip when wide; else underneath when there are rows; else beside a narrower strip.
  const hasSide = p.isSlim ? slimWidth >= 240 : px >= SIDE_PX || (p.maxRows < ROWS.full + ROWS.row && px >= 400)

  if (!hasSide && p.maxRows < ROWS[kind] + ROWS.row) {
    return { kind: 'text' }
  }
  const stripWidth = Math.round(Math.min(400, p.isSlim ? (hasSide ? slimWidth : px - 4) : hasSide ? px - 100 : px - 4))
  let room = p.maxRows - ROWS[kind]
  let hasRow = false
  let hasAlert = false
  let chipRows = 0
  let hasGitLine = false
  let lines = 0

  // Without a side column the Cockpit and Hide buttons need the row, so it is taken first.
  if (!hasSide) {
    hasRow = true
    room -= ROWS.row
  }

  if (p.hasAlert && !p.isSlim && room >= ROWS.alert) {
    hasAlert = true
    room -= ROWS.alert
  }

  if (!hasRow && !p.isSlim && p.buttonsPx > 0 && room >= ROWS.row) {
    hasRow = true
    room -= ROWS.row
  }

  if (!p.isSlim) {
    chipRows = Math.max(0, Math.min(p.chipRows, Math.floor(room / ROWS.chipRow)))
    room -= chipRows * ROWS.chipRow
  }
  // The git text shares the button row when it fits there, which costs no row.
  const rowPx = p.buttonsPx + (hasSide ? 0 : HOUSE_PX)
  const isGitInline = hasRow && !p.isSlim && p.gitPx > 0 && rowPx + p.gitPx <= px

  if (!isGitInline && p.gitPx > 0 && !p.isSlim && room >= ROWS.line) {
    hasGitLine = true
    room -= ROWS.line
  }

  if (!p.isSlim) {
    lines = Math.max(0, Math.min(p.lines, room))
  }

  return { kind, stripWidth, hasSide, hasRow, hasAlert, chipRows, isGitInline, hasGitLine, lines }
}

// ------------------------------------------------------------------ the /bar command

const HELP = [
  '/bar add|remove <item>',
  '/bar move <item> left|right',
  '/bar slim|normal|expanded',
  `/bar theme ${THEMES.join('|')}`,
  '/bar preset clean|coding|numbers|everything|reset',
  '/bar goal <text> | note <text> (empty or "off" clears)',
  '/bar deadline HH:MM <label>',
  '/bar budget <usd>',
  '/bar button add <label> = <prompt text> | button remove <label>',
  '/bar quiet on|off',
]

export const helpText = (c: BarConfig, name: string): string => {
  const others = ITEMS.map(i => i.id).filter(id => !c.items.includes(id))

  return [
    ...HELP.map(h => h.replace('/bar', `/${name}`)),
    `Now: ${c.size}, ${c.theme} theme${c.quiet ? ', quiet' : ''}.`,
    `On: ${c.items.join(', ') || 'nothing'}`,
    `Available: ${others.join(', ') || 'everything is on'}`,
    `Or use the Bar tab: /cockpit bar`,
  ].join('\n')
}

/** Swaps an item with its neighbour of the same kind, which is what the person sees side by side. */
export const moveItem = (items: readonly string[], id: string, by: -1 | 1): string[] => {
  const out = [...items]
  const from = out.indexOf(id)
  const kind = ITEM_BY_ID.get(id)?.kind

  if (from < 0) {
    return out
  }

  for (let to = from + by; to >= 0 && to < out.length; to += by) {
    if (ITEM_BY_ID.get(out[to] ?? '')?.kind === kind) {
      out[from] = out[to] as string
      out[to] = id

      return out
    }
  }

  return out
}

/** Adding something that lives in the second strip opens it, so the person sees what they asked for. */
export const addItem = (c: BarConfig, id: string): BarConfig => ({
  ...c,
  items: c.items.includes(id) ? c.items : [...c.items, id],
  size: ITEM_BY_ID.get(id)?.kind === 'chip' ? 'expanded' : c.size,
})

export const removeItem = (c: BarConfig, id: string): BarConfig => ({ ...c, items: c.items.filter(x => x !== id) })

export const toggleItem = (c: BarConfig, id: string): BarConfig => (c.items.includes(id) ? removeItem(c, id) : addItem(c, id))

export const applyPreset = (c: BarConfig, name: string): BarConfig | null => {
  if (name === 'reset') {
    return defaultConfig()
  }

  if (!Object.prototype.hasOwnProperty.call(PRESETS, name)) {
    return null
  }
  const preset = PRESETS[name as keyof typeof PRESETS]

  return { ...c, items: [...preset.items], size: preset.size, quiet: false }
}

export const nextSize = (s: Size): Size => (s === 'normal' ? 'expanded' : 'normal')

export type Applied = { config: BarConfig; text: string; isChanged: boolean }

/** `/bar <args>`: pure. `name` is the command's registered name, for the messages. */
export const applyBar = (c: BarConfig, args: string, now: number, name = 'bar'): Applied => {
  const trimmed = args.trim()
  const space = trimmed.search(/\s/)
  const verb = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase()
  const rest = space < 0 ? '' : trimmed.slice(space + 1).trim()
  const done = (config: BarConfig, say: string): Applied => ({ config, text: say, isChanged: true })
  const stop = (say: string): Applied => ({ config: c, text: say, isChanged: false })
  const quietNote = c.quiet ? ' Quiet mode is on, so it stays hidden until /' + name + ' quiet off.' : ''

  if (verb === '' || verb === 'help') {
    return stop(helpText(c, name))
  }

  if (verb === 'add' || verb === 'remove') {
    const id = rest.toLowerCase()

    if (!ITEM_BY_ID.has(id)) {
      return stop(`No item "${rest}". Items: ${ITEMS.map(i => i.id).join(', ')}`)
    }

    if (verb === 'remove') {
      return c.items.includes(id) ? done(removeItem(c, id), `Removed ${id}.`) : stop(`${id} is not on.`)
    }
    const next = addItem(c, id)
    const hint =
      id === 'budget' && c.budget === null
        ? ` Set one with /${name} budget <usd>.`
        : id === 'deadline' && c.deadline === null
          ? ` Set one with /${name} deadline HH:MM <label>.`
          : (id === 'note' && c.note === '') || (id === 'goal' && c.goal === '')
            ? ` Write it with /${name} ${id} <text>.`
            : ''

    return done(next, `Added ${id}.${next.size !== c.size ? ' Switched to expanded so it shows.' : ''}${hint}${quietNote}`)
  }

  if (verb === 'move') {
    const [id = '', side = ''] = rest.toLowerCase().split(/\s+/)

    if (!c.items.includes(id) || (side !== 'left' && side !== 'right')) {
      return stop(`Usage: /${name} move <item that is on> left|right`)
    }
    const items = moveItem(c.items, id, side === 'left' ? -1 : 1)

    return items.join() === c.items.join() ? stop(`${id} is already at that end.`) : done({ ...c, items }, `Moved ${id} ${side}.`)
  }

  if (SIZES.includes(verb as Size)) {
    return done({ ...c, size: verb as Size, quiet: false }, `Bar is ${verb}.`)
  }

  if (verb === 'theme') {
    return THEMES.includes(rest.toLowerCase() as Theme)
      ? done({ ...c, theme: rest.toLowerCase() as Theme }, `Theme ${rest.toLowerCase()}.`)
      : stop(`Themes: ${THEMES.join(', ')}`)
  }

  if (verb === 'preset') {
    const next = applyPreset(c, rest.toLowerCase())

    return next === null ? stop('Presets: clean, coding, numbers, everything, reset') : done(next, `Preset ${rest.toLowerCase()} applied.`)
  }

  if (verb === 'goal' || verb === 'note') {
    const value = rest === 'off' ? '' : text(rest, 80)
    const next = value === '' ? removeItem(c, verb) : addItem(c, verb)

    return done({ ...next, [verb]: value }, value === '' ? `${verb} cleared.` : `${verb} set.${quietNote}`)
  }

  if (verb === 'deadline') {
    if (rest === 'off' || rest === '') {
      return done({ ...removeItem(c, 'deadline'), deadline: null }, 'Deadline cleared.')
    }
    const [time = '', ...label] = rest.split(/\s+/)
    const at = deadlineAt(time, now)

    if (at === null) {
      return stop(`Usage: /${name} deadline HH:MM <label>`)
    }

    return done(
      { ...addItem(c, 'deadline'), deadline: { at, label: text(label.join(' '), 24) || 'deadline' } },
      `Deadline ${hhmm(at)} set. It counts down while a turn runs.${quietNote}`,
    )
  }

  if (verb === 'budget') {
    if (rest === 'off' || rest === '') {
      return done({ ...removeItem(c, 'budget'), budget: null }, 'Budget cleared.')
    }
    const usd = Number(rest.replace(/^\$/, ''))

    if (!Number.isFinite(usd) || usd <= 0) {
      return stop(`Usage: /${name} budget <usd>`)
    }

    return done({ ...addItem(c, 'budget'), budget: usd }, `Budget ${moneyOf(usd)} for this session's spend.${quietNote}`)
  }

  if (verb === 'button') {
    const add = /^add\s+([^=]+?)\s*=\s*([\s\S]+)$/i.exec(rest)

    if (add !== null) {
      const label = text(add[1], 14)
      const kept = c.buttons.filter(b => b.label.toLowerCase() !== label.toLowerCase())

      if (kept.length >= MAX_BUTTONS) {
        return stop(`At most ${MAX_BUTTONS} buttons. Remove one with /${name} button remove <label>.`)
      }

      return done(
        { ...addItem(c, 'custom'), buttons: [...kept, { label, text: (add[2] ?? '').trim().slice(0, 500) }] },
        `Button "${label}" added. It fills the prompt box and never sends.${quietNote}`,
      )
    }
    const rm = /^remove\s+(.+)$/i.exec(rest)

    if (rm !== null) {
      const kept = c.buttons.filter(b => b.label.toLowerCase() !== (rm[1] ?? '').trim().toLowerCase())

      return kept.length === c.buttons.length
        ? stop(`No button "${rm[1]}".`)
        : done({ ...c, buttons: kept }, `Button "${rm[1]}" removed.`)
    }

    return stop(`Usage: /${name} button add <label> = <prompt text> | /${name} button remove <label>`)
  }

  if (verb === 'quiet') {
    const want = rest.toLowerCase()

    if (want !== 'on' && want !== 'off' && want !== '') {
      return stop(`Usage: /${name} quiet on|off`)
    }
    const quiet = want === '' ? !c.quiet : want === 'on'

    return done({ ...c, quiet }, quiet ? 'Quiet mode on: one still line, no action buttons.' : 'Quiet mode off.')
  }

  return stop(`Unknown: ${verb}. Try /${name} for help.`)
}
