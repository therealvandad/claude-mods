// Pure data model of layout-kit: configuration, validation, layout editing, tiles, rules, templates, import and export.
// No `$` in here, so every rule is easy to test. Every value that comes from the store or from a command goes through
// a validator in this file before it is kept.

import type { BadgeDef, ButtonDef, Cfg, CustomDef, GoalDef, Page, Pending, Rec, RuleDef, Size, Thresholds, TileRef } from '../types'

import { METRIC_NAMES, calc, holds, parseCondition, parseFormula, zeroMetrics } from './formula'
import type { MetricName, Metrics } from './formula'

// ---------------------------------------------------------------- caps

export const CAP = {
  pages: 6,
  tiles: 24,
  defs: 20,
  saved: 12,
  byProject: 30,
  snippets: 30,
  snippetLen: 500,
  aliases: 20,
  aliasLen: 200,
  templates: 20,
  templateLen: 400,
  vars: 20,
  varLen: 120,
  buttons: 5,
  buttonLabel: 16,
  buttonText: 300,
  status: 80,
  spriteLines: 5,
  spriteWidth: 12,
  badges: 15,
  goals: 10,
  rules: 15,
  msg: 80,
  toolStyles: 30,
  toolNames: 40,
  files: 300,
  importText: 8000,
  textTile: 60,
  budgets: 30,
} as const

export const SIZES: readonly Size[] = ['S', 'M', 'L']

/** Theme colour keys a tool may be given. */
export const COLORS = ['suggestion', 'success', 'warning', 'error', 'claude', 'permission', 'remember', 'subtle', 'inactive', 'text'] as const

// ---------------------------------------------------------------- small validators

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
export const isSafeKey = (k: string): boolean => !BAD_KEYS.has(k)

/** Text with no control characters, trimmed, within `max` characters (counted by code point). */
export const cleanText = (v: unknown, max: number, min = 0): string | undefined => {
  if (typeof v !== 'string' || CONTROL.test(v)) {
    return undefined
  }
  const t = v.trim()
  const n = Array.from(t).length

  return n >= min && n <= max ? t : undefined
}

/** Text that may hold line breaks (snippets). Other control characters are refused. */
export const cleanBlock = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') {
    return undefined
  }
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/\r\n?/g, '\n').replace(/\t/g, '  ')

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/.test(t)) {
    return undefined
  }
  const s = t.trim()
  const n = Array.from(s).length

  return n >= 1 && n <= max ? s : undefined
}

export const okPageName = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,15}$/.test(s) && s === s.trim()
export const okShortName = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{0,15}$/.test(s) && isSafeKey(s)
export const okVarName = (s: unknown): s is string => typeof s === 'string' && /^[a-z][a-z0-9_]{0,15}$/.test(s) && isSafeKey(s)
export const okToolName = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,60}$/.test(s) && isSafeKey(s)
export const okColor = (s: unknown): s is string => typeof s === 'string' && (COLORS as readonly string[]).includes(s)
const okNum = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

// ---------------------------------------------------------------- built-in tiles

export type TileInfo = { id: string; label: string; about: string; size: Size }

export const BUILTIN: readonly TileInfo[] = [
  { id: 'calls', label: 'Tool calls', about: 'How many tool calls this session', size: 'S' },
  { id: 'errors', label: 'Errors', about: 'Tool calls that failed or were blocked', size: 'S' },
  { id: 'files', label: 'Files edited', about: 'Different files changed by Edit, Write or NotebookEdit', size: 'S' },
  { id: 'edits', label: 'Edits', about: 'Edit, Write and NotebookEdit calls', size: 'S' },
  { id: 'prompts', label: 'Prompts', about: 'Prompts you sent', size: 'S' },
  { id: 'turns', label: 'Turns', about: 'Turns finished', size: 'S' },
  { id: 'spend', label: 'Spend', about: 'Session cost in dollars (an estimate)', size: 'S' },
  { id: 'budget', label: 'Budget', about: 'Spend against this project\'s budget (/cubudget)', size: 'M' },
  { id: 'ctx', label: 'Context', about: 'How full the context window is', size: 'S' },
  { id: 'limit', label: 'Rate limit', about: 'The fullest rate-limit window', size: 'S' },
  { id: 'elapsed', label: 'Elapsed', about: 'Time since the session started', size: 'S' },
  { id: 'todo', label: 'Todos', about: 'Open and done items of the model\'s todo list', size: 'M' },
  { id: 'tools', label: 'Tools', about: 'Calls per tool, with your colours, glyphs and names', size: 'L' },
  { id: 'badges', label: 'Badges', about: 'Your badges and whether you earned them', size: 'M' },
  { id: 'goals', label: 'Goals', about: 'Your goals and their progress', size: 'M' },
  { id: 'sprite', label: 'Sprite', about: 'Your 5-line sprite', size: 'S' },
]

const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN.map(t => t.id))

export const isBuiltin = (id: string): boolean => BUILTIN_IDS.has(id)
export const isCustomRef = (id: string): boolean => /^c:[a-z0-9][a-z0-9-]{0,15}$/.test(id)
export const okTileId = (id: unknown): id is string => typeof id === 'string' && (isBuiltin(id) || isCustomRef(id))

// ---------------------------------------------------------------- defaults

export const DEFAULT_THR: Thresholds = { ctx: [70, 85], limit: [70, 85], errors: [3, 10], spend: [5, 20] }

export const defaultPages = (): Page[] => [
  {
    name: 'Main',
    tiles: [
      { id: 'calls', size: 'S' },
      { id: 'errors', size: 'S' },
      { id: 'files', size: 'S' },
      { id: 'spend', size: 'S' },
      { id: 'ctx', size: 'S' },
      { id: 'elapsed', size: 'S' },
      { id: 'todo', size: 'M' },
      { id: 'tools', size: 'L' },
    ],
  },
]

export const emptyCfg = (): Cfg => ({
  pages: defaultPages(),
  defs: [],
  saved: {},
  byProject: {},
  snippets: {},
  aliases: {},
  templates: {},
  vars: {},
  buttons: [],
  statusTpl: '',
  sprite: [],
  badges: [],
  goals: [],
  rules: [],
  recipes: {},
  toolColor: {},
  toolGlyph: {},
  toolName: {},
  thr: { ctx: [...DEFAULT_THR.ctx], limit: [...DEFAULT_THR.limit], errors: [...DEFAULT_THR.errors], spend: [...DEFAULT_THR.spend] },
  budgets: {},
})

export const emptyRec = (startedAt = 0): Rec => ({ calls: 0, errors: 0, edits: 0, bash: 0, prompts: 0, turns: 0, todoOpen: 0, todoDone: 0, startedAt, byTool: {}, files: [] })

export const emptyPending = (): Pending => ({ has: false, pages: [], defs: [], diff: '' })

// ---------------------------------------------------------------- custom tiles

export type DefResult = { ok: true; def: CustomDef } | { ok: false; error: string }

const blankDef = (id: string, kind: CustomDef['kind'], label: string): CustomDef => ({ id, kind, label, text: '', num: 0, unit: '', expr: '' })

/** Validates one custom tile from loose input. `value` is the text, the number, the unit text or the formula by kind. */
export const makeDef = (kind: string, id: string, label: string, value: string, unit = ''): DefResult => {
  if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(id) || !isSafeKey(id)) {
    return { ok: false, error: 'The id is 1 to 16 lowercase letters, digits or dashes.' }
  }
  const lab = cleanText(label, 20, 1)

  if (lab === undefined) {
    return { ok: false, error: 'The label is 1 to 20 characters.' }
  }

  if (kind === 'text') {
    const t = cleanText(value, CAP.textTile, 1)

    return t === undefined ? { ok: false, error: `The text is 1 to ${CAP.textTile} characters.` } : { ok: true, def: { ...blankDef(id, 'text', lab), text: t } }
  }

  if (kind === 'number') {
    const n = Number(value.trim())

    if (value.trim() === '' || !okNum(n, -1e9, 1e9)) {
      return { ok: false, error: 'The number must be between -1000000000 and 1000000000.' }
    }
    const u = cleanText(unit, 8)

    return u === undefined ? { ok: false, error: 'The unit is at most 8 characters.' } : { ok: true, def: { ...blankDef(id, 'number', lab), num: n, unit: u } }
  }

  if (kind === 'formula') {
    const p = parseFormula(value)

    return p.ok ? { ok: true, def: { ...blankDef(id, 'formula', lab), expr: value.trim().toLowerCase() } } : { ok: false, error: `Formula refused: ${p.error}.` }
  }

  return { ok: false, error: 'The kind is text, number or formula.' }
}

/** Re-validates a def loaded from the store or an import. */
export const checkDef = (raw: unknown): CustomDef | undefined => {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.kind !== 'string' || typeof raw.label !== 'string') {
    return undefined
  }
  const field = raw.kind === 'text' ? raw.text : raw.kind === 'number' ? raw.num : raw.expr

  if (typeof field !== (raw.kind === 'number' ? 'number' : 'string') || (raw.unit !== undefined && typeof raw.unit !== 'string')) {
    return undefined
  }
  const value = String(field)
  const r = makeDef(raw.kind, raw.id, raw.label, value, typeof raw.unit === 'string' ? raw.unit : '')

  return r.ok ? r.def : undefined
}

// ---------------------------------------------------------------- pages

const sizeOf = (v: unknown): Size => (v === 'S' || v === 'M' || v === 'L' ? v : 'M')

/** Keeps the valid pages: known tiles, no repeats on a page, caps applied. Custom tiles must exist in `defs`. */
export const sanitizePages = (raw: unknown, defs: readonly CustomDef[]): Page[] => {
  const known = new Set(defs.map(d => `c:${d.id}`))
  const out: Page[] = []

  for (const p of Array.isArray(raw) ? raw.slice(0, CAP.pages) : []) {
    if (!isRecord(p) || !okPageName(p.name) || out.some(x => x.name === p.name)) {
      continue
    }
    const seen = new Set<string>()
    const tiles: TileRef[] = []

    for (const t of Array.isArray(p.tiles) ? p.tiles.slice(0, CAP.tiles) : []) {
      if (!isRecord(t) || !okTileId(t.id) || seen.has(t.id) || (isCustomRef(t.id) && !known.has(t.id))) {
        continue
      }
      seen.add(t.id)
      tiles.push({ id: t.id, size: sizeOf(t.size) })
    }
    out.push({ name: p.name, tiles })
  }

  return out
}

export type Edit<T> = { ok: true; value: T } | { ok: false; error: string }

const withPage = (pages: Page[], pi: number, fn: (tiles: TileRef[]) => Edit<TileRef[]>): Edit<Page[]> => {
  const page = pages[pi]

  if (page === undefined) {
    return { ok: false, error: 'No such page.' }
  }
  const r = fn(page.tiles)

  return r.ok ? { ok: true, value: pages.map((p, i) => (i === pi ? { ...p, tiles: r.value } : p)) } : r
}

export const moveTile = (pages: Page[], pi: number, id: string, delta: -1 | 1): Edit<Page[]> =>
  withPage(pages, pi, tiles => {
    const i = tiles.findIndex(t => t.id === id)
    const j = i + delta

    if (i < 0) {
      return { ok: false, error: `${id} is not on this page.` }
    }

    if (j < 0 || j >= tiles.length) {
      return { ok: false, error: `${id} is already ${delta < 0 ? 'first' : 'last'}.` }
    }
    const next = [...tiles]
    const a = next[i]
    const b = next[j]

    if (a === undefined || b === undefined) {
      return { ok: false, error: 'No such tile.' }
    }
    next[i] = b
    next[j] = a

    return { ok: true, value: next }
  })

export const resizeTile = (pages: Page[], pi: number, id: string, size: Size): Edit<Page[]> =>
  withPage(pages, pi, tiles => (tiles.some(t => t.id === id) ? { ok: true, value: tiles.map(t => (t.id === id ? { ...t, size } : t)) } : { ok: false, error: `${id} is not on this page.` }))

export const cycleSize = (s: Size): Size => (s === 'S' ? 'M' : s === 'M' ? 'L' : 'S')

export const addTile = (pages: Page[], pi: number, id: string, defs: readonly CustomDef[], size?: Size): Edit<Page[]> =>
  withPage(pages, pi, tiles => {
    if (!okTileId(id) || (isCustomRef(id) && !defs.some(d => `c:${d.id}` === id))) {
      return { ok: false, error: `No tile "${id}". /cutile list shows them.` }
    }

    if (tiles.some(t => t.id === id)) {
      return { ok: false, error: `${id} is already on this page.` }
    }

    if (tiles.length >= CAP.tiles) {
      return { ok: false, error: `A page holds ${CAP.tiles} tiles at most.` }
    }

    return { ok: true, value: [...tiles, { id, size: size ?? BUILTIN.find(b => b.id === id)?.size ?? 'S' }] }
  })

export const removeTile = (pages: Page[], pi: number, id: string): Edit<Page[]> =>
  withPage(pages, pi, tiles => (tiles.some(t => t.id === id) ? { ok: true, value: tiles.filter(t => t.id !== id) } : { ok: false, error: `${id} is not on this page.` }))

export const addPage = (pages: Page[], name: string): Edit<Page[]> => {
  if (!okPageName(name)) {
    return { ok: false, error: 'A page name is 1 to 16 letters, digits, spaces, dashes or underscores.' }
  }

  if (pages.length >= CAP.pages) {
    return { ok: false, error: `${CAP.pages} pages at most.` }
  }

  if (pages.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `A page called ${name} exists.` }
  }

  return { ok: true, value: [...pages, { name, tiles: [] }] }
}

export const removePage = (pages: Page[], pi: number): Edit<Page[]> => (pages.length <= 1 ? { ok: false, error: 'Keep at least one page.' } : pages[pi] === undefined ? { ok: false, error: 'No such page.' } : { ok: true, value: pages.filter((_, i) => i !== pi) })

export const renamePage = (pages: Page[], pi: number, name: string): Edit<Page[]> => {
  if (!okPageName(name)) {
    return { ok: false, error: 'A page name is 1 to 16 letters, digits, spaces, dashes or underscores.' }
  }

  if (pages[pi] === undefined) {
    return { ok: false, error: 'No such page.' }
  }

  if (pages.some((p, i) => i !== pi && p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `A page called ${name} exists.` }
  }

  return { ok: true, value: pages.map((p, i) => (i === pi ? { ...p, name } : p)) }
}

export const findPage = (pages: readonly Page[], word: string): number => {
  const w = word.trim().toLowerCase()
  const n = Number(w)

  if (/^\d+$/.test(w) && n >= 1 && n <= pages.length) {
    return n - 1
  }

  return pages.findIndex(p => p.name.toLowerCase() === w)
}

/** Drops a custom tile from every page (used when its definition is deleted). */
export const dropTileEverywhere = (pages: Page[], id: string): Page[] => pages.map(p => ({ ...p, tiles: p.tiles.filter(t => t.id !== id) }))

// ---------------------------------------------------------------- numbers and text for display

export const fmtNum = (n: number): string => {
  if (!Number.isFinite(n)) {
    return '0'
  }
  const a = Math.abs(n)

  if (a >= 1e6) {
    return `${(n / 1e6).toFixed(1)}M`
  }

  if (a >= 1e4) {
    return `${(n / 1e3).toFixed(1)}k`
  }

  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

export const fmtUsd = (n: number): string => {
  const v = Number.isFinite(n) && n > 0 ? Math.min(n, 1e9) : 0

  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
}

export const fmtDur = (ms: number): string => {
  const m = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 60_000))

  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export const fmtMetric = (name: MetricName, v: number): string => {
  if (name === 'spend' || name === 'budget') {
    return fmtUsd(v)
  }

  if (name === 'ctx' || name === 'limit') {
    return `${Math.round(v)}%`
  }

  if (name === 'mins') {
    return fmtDur(v * 60_000)
  }

  return fmtNum(v)
}

export const bar = (pct: number, width: number): string => {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  const full = Math.round((p / 100) * width)

  return '█'.repeat(full) + '░'.repeat(Math.max(0, width - full))
}

/** Replaces `{metric}` in a template with the formatted value. Unknown names are left as they are. */
export const interpolate = (text: string, m: Metrics): string =>
  text.replace(/\{([a-z_]+)\}/g, (all, name: string) => ((METRIC_NAMES as readonly string[]).includes(name) ? fmtMetric(name as MetricName, m[name as MetricName]) : all))

/** Every `{...}` in a status template or rule message must be a metric. */
export const checkPlaceholders = (text: string): string | undefined => {
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!(METRIC_NAMES as readonly string[]).includes(m[1] ?? '')) {
      return `"{${(m[1] ?? '').slice(0, 20)}}" is not a metric. Metrics: ${METRIC_NAMES.join(', ')}.`
    }
  }

  return /[{}]/.test(text.replace(/\{[^{}]*\}/g, '')) ? 'Unmatched { or }.' : undefined
}

// ---------------------------------------------------------------- recording

const EDIT_TOOLS = /^(Edit|Write|NotebookEdit)$/

export const isEditTool = (tool: string): boolean => EDIT_TOOLS.test(tool)

const toolKey = (tool: string): string => {
  const t = tool.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60)

  return t === '' || !isSafeKey(t) ? 'other' : t
}

/** Counts one finished tool call. Bounded: 40 tools, 300 files; more tools fold into "other". */
export const recTool = (r: Rec, tool: string, isErr: boolean, path?: string): Rec => {
  let key = toolKey(tool)

  if (key !== 'other' && !hasOwn(r.byTool, key) && Object.keys(r.byTool).length >= CAP.toolNames - 1) {
    key = 'other'
  }
  const cur = hasOwn(r.byTool, key) ? r.byTool[key] : undefined
  const row = { n: (cur?.n ?? 0) + 1, err: (cur?.err ?? 0) + (isErr ? 1 : 0) }
  const edit = !isErr && isEditTool(tool)
  const p = typeof path === 'string' && path.length > 0 && path.length <= 300 && !CONTROL.test(path) ? path : undefined
  const files = edit && p !== undefined && !r.files.includes(p) && r.files.length < CAP.files ? [...r.files, p] : r.files

  return { ...r, calls: r.calls + 1, errors: r.errors + (isErr ? 1 : 0), edits: r.edits + (edit ? 1 : 0), bash: r.bash + (tool === 'Bash' ? 1 : 0), byTool: { ...r.byTool, [key]: row }, files }
}

/** Counts the model's todo list (a TodoWrite call) into open and done. */
export const recTodos = (r: Rec, todos: unknown): Rec => {
  if (!Array.isArray(todos)) {
    return r
  }
  let open = 0
  let done = 0

  for (const t of todos.slice(0, 200)) {
    if (isRecord(t)) {
      if (t.status === 'completed') {
        done++
      } else if (t.status === 'pending' || t.status === 'in_progress') {
        open++
      }
    }
  }

  return { ...r, todoOpen: open, todoDone: done }
}

export type Live = { usd: number; ctx: number; limit: number; now: number }

export const buildMetrics = (r: Rec, u: Live, budget: number): Metrics => ({
  ...zeroMetrics(),
  calls: r.calls,
  errors: r.errors,
  files: r.files.length,
  edits: r.edits,
  bash: r.bash,
  prompts: r.prompts,
  turns: r.turns,
  spend: Math.round(Math.max(0, u.usd) * 10_000) / 10_000,
  budget,
  ctx: Math.round(Math.max(0, Math.min(100, u.ctx))),
  limit: Math.round(Math.max(0, Math.min(100, u.limit))),
  mins: r.startedAt > 0 ? Math.round((Math.max(0, u.now - r.startedAt) / 60_000) * 10) / 10 : 0,
  todo_open: r.todoOpen,
  todo_done: r.todoDone,
  todo_all: r.todoOpen + r.todoDone,
})

// ---------------------------------------------------------------- tools: colour, glyph, name

export type Icons = 'letters' | 'symbols' | 'minimal'

const DEFAULT_TOOL_COLOR: Record<string, string> = { Bash: 'warning', Edit: 'success', Write: 'success', NotebookEdit: 'success', Read: 'suggestion', Grep: 'suggestion', Glob: 'suggestion', Task: 'remember', Agent: 'remember', TodoWrite: 'claude', WebFetch: 'permission', WebSearch: 'permission' }
const DEFAULT_TOOL_GLYPH: Record<string, string> = { Bash: '$', Edit: '~', Write: '+', NotebookEdit: '~', Read: '>', Grep: '?', Glob: '*', Task: '@', Agent: '@', TodoWrite: '#', WebFetch: '^', WebSearch: '^' }

export const toolColor = (cfg: Cfg, tool: string): string => (hasOwn(cfg.toolColor, tool) ? (cfg.toolColor[tool] ?? 'subtle') : hasOwn(DEFAULT_TOOL_COLOR, tool) ? (DEFAULT_TOOL_COLOR[tool] ?? 'subtle') : 'subtle')

export const toolGlyph = (cfg: Cfg, tool: string, icons: Icons): string => {
  if (hasOwn(cfg.toolGlyph, tool)) {
    return cfg.toolGlyph[tool] ?? ''
  }

  if (icons === 'minimal') {
    return ''
  }

  if (icons === 'letters') {
    return tool.charAt(0).toUpperCase()
  }

  return hasOwn(DEFAULT_TOOL_GLYPH, tool) ? (DEFAULT_TOOL_GLYPH[tool] ?? '.') : '.'
}

export const toolLabel = (cfg: Cfg, tool: string): string => (hasOwn(cfg.toolName, tool) ? (cfg.toolName[tool] ?? tool) : tool.replace(/^mcp__/, '').replace(/__/g, ':'))

export type ToolRow = { tool: string; label: string; glyph: string; color: string; n: number; err: number }

export const toolRows = (r: Rec, cfg: Cfg, icons: Icons, max: number): ToolRow[] =>
  Object.entries(r.byTool)
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([tool, v]) => ({ tool, label: toolLabel(cfg, tool), glyph: toolGlyph(cfg, tool, icons), color: toolColor(cfg, tool), n: v.n, err: v.err }))

export const setToolStyle = (cfg: Cfg, kind: 'color' | 'glyph' | 'name', tool: string, value: string | undefined): Edit<Cfg> => {
  if (!okToolName(tool)) {
    return { ok: false, error: 'A tool name is letters, digits and _ . : - (up to 60), for example Bash or mcp__x__y.' }
  }
  const field = kind === 'color' ? 'toolColor' : kind === 'glyph' ? 'toolGlyph' : 'toolName'
  const cur = cfg[field]

  if (value === undefined) {
    const rest = Object.fromEntries(Object.entries(cur).filter(([k]) => k !== tool))

    return { ok: true, value: { ...cfg, [field]: rest } }
  }
  let v: string | undefined

  if (kind === 'color') {
    v = okColor(value) ? value : undefined

    if (v === undefined) {
      return { ok: false, error: `Colour keys: ${COLORS.join(', ')}.` }
    }
  } else if (kind === 'glyph') {
    v = cleanText(value, 2, 1)

    if (v === undefined) {
      return { ok: false, error: 'A glyph is 1 or 2 characters.' }
    }
  } else {
    v = cleanText(value, 20, 1)

    if (v === undefined) {
      return { ok: false, error: 'A friendly name is 1 to 20 characters.' }
    }
  }

  if (!hasOwn(cur, tool) && Object.keys(cur).length >= CAP.toolStyles) {
    return { ok: false, error: `${CAP.toolStyles} tools per table at most.` }
  }

  return { ok: true, value: { ...cfg, [field]: { ...cur, [tool]: v } } }
}

export const nextColor = (c: string): string => {
  const i = (COLORS as readonly string[]).indexOf(c)

  return COLORS[(i + 1) % COLORS.length] ?? 'subtle'
}

// ---------------------------------------------------------------- thresholds and tone

export type Tone = 'success' | 'warning' | 'error'
export const toneOf = (v: number, lv: readonly number[]): Tone => ((lv[1] ?? Infinity) <= v ? 'error' : (lv[0] ?? Infinity) <= v ? 'warning' : 'success')

export const setThreshold = (cfg: Cfg, metric: string, warn: number, bad: number): Edit<Cfg> => {
  if (metric !== 'ctx' && metric !== 'limit' && metric !== 'errors' && metric !== 'spend') {
    return { ok: false, error: 'Thresholds exist for ctx, limit, errors and spend.' }
  }

  if (!okNum(warn, 0, 1e6) || !okNum(bad, 0, 1e6) || warn > bad) {
    return { ok: false, error: 'Give two numbers from 0 to 1000000, warn first and not above bad.' }
  }

  if ((metric === 'ctx' || metric === 'limit') && bad > 100) {
    return { ok: false, error: 'A percentage level is at most 100.' }
  }

  return { ok: true, value: { ...cfg, thr: { ...cfg.thr, [metric]: [warn, bad] } } }
}

// ---------------------------------------------------------------- tile views

export type TileLine = { text: string; color?: string }
export type TileView = { id: string; title: string; big: string; sub: string; tone?: Tone; pct?: number; lines: TileLine[]; spriteLines?: string[] }
export type TileCtx = { m: Metrics; cfg: Cfg; rec: Rec; icons: Icons; earned: readonly string[]; now: number }

const view = (id: string, title: string, big: string, rest: Partial<TileView> = {}): TileView => ({ id, title, big, sub: '', lines: [], ...rest })

export const SPRITES: Record<string, string[]> = {
  cat: [' /\\_/\\ ', '( o.o )', ' > ^ < ', ' /   \\ ', '(_)-(_)'],
  robot: [' [^_^] ', ' /| |\\ ', '  |_|  ', ' _| |_ ', '       '],
  ghost: [' .-"-. ', '| o o |', '|  ^  |', '|     |', '|/\\/\\/\\|'],
}

export const tileView = (id: string, c: TileCtx): TileView => {
  const { m, cfg, rec } = c

  if (isCustomRef(id)) {
    const def = cfg.defs.find(d => `c:${d.id}` === id)

    if (def === undefined) {
      return view(id, id, '?', { sub: 'This custom tile was removed.' })
    }

    if (def.kind === 'text') {
      return view(id, def.label, def.text)
    }

    if (def.kind === 'number') {
      return view(id, def.label, `${fmtNum(def.num)}${def.unit === '' ? '' : ` ${def.unit}`}`, { sub: 'a number you set' })
    }
    const v = calc(def.expr, m)

    return view(id, def.label, v === null ? '(error)' : fmtNum(v), { sub: def.expr })
  }

  switch (id) {
    case 'calls':
      return view(id, 'Tool calls', fmtNum(m.calls), { sub: `${m.bash} Bash, ${m.edits} edits` })
    case 'errors':
      return view(id, 'Errors', fmtNum(m.errors), { tone: toneOf(m.errors, cfg.thr.errors), sub: m.calls > 0 ? `${Math.round((m.errors / m.calls) * 100)}% of calls` : 'no calls yet' })
    case 'files':
      return view(id, 'Files edited', fmtNum(m.files), { sub: `${m.edits} edit calls` })
    case 'edits':
      return view(id, 'Edits', fmtNum(m.edits))
    case 'prompts':
      return view(id, 'Prompts', fmtNum(m.prompts))
    case 'turns':
      return view(id, 'Turns', fmtNum(m.turns))
    case 'spend': {
      const b = m.budget
      const tone = b > 0 ? toneOf(m.spend / b, [0.8, 1]) : toneOf(m.spend, cfg.thr.spend)

      return view(id, 'Spend', fmtUsd(m.spend), { tone, sub: b > 0 ? `of ${fmtUsd(b)} budget` : 'estimate' })
    }
    case 'budget': {
      const b = m.budget

      if (b <= 0) {
        return view(id, 'Budget', 'none', { sub: 'set one for this project: /cubudget <usd>' })
      }
      const pct = Math.round((m.spend / b) * 100)

      return view(id, 'Budget', `${fmtUsd(m.spend)} / ${fmtUsd(b)}`, { tone: toneOf(m.spend / b, [0.8, 1]), pct: Math.min(100, pct), sub: `${pct}% used` })
    }
    case 'ctx':
      return view(id, 'Context', `${m.ctx}%`, { tone: toneOf(m.ctx, cfg.thr.ctx), pct: m.ctx, sub: 'of the window' })
    case 'limit':
      return view(id, 'Rate limit', `${m.limit}%`, { tone: toneOf(m.limit, cfg.thr.limit), pct: m.limit, sub: 'fullest window' })
    case 'elapsed':
      return view(id, 'Elapsed', fmtDur(m.mins * 60_000), { sub: 'updates when the pane redraws' })
    case 'todo': {
      const all = m.todo_all

      return view(id, 'Todos', `${m.todo_done}/${all}`, { pct: all > 0 ? Math.round((m.todo_done / all) * 100) : 0, sub: all === 0 ? 'no todo list yet' : `${m.todo_open} open` })
    }
    case 'tools': {
      const rows = toolRows(rec, cfg, c.icons, 8)

      return view(id, 'Tools', String(rows.length), {
        sub: rows.length === 0 ? 'no calls yet' : 'by calls',
        lines: rows.map(r => ({ text: `${r.glyph === '' ? '' : `${r.glyph} `}${r.label}  ${r.n}${r.err > 0 ? ` (${r.err} err)` : ''}`, color: r.color })),
      })
    }
    case 'badges': {
      const lines = cfg.badges.map(b => ({ text: `${c.earned.includes(b.name) ? '[x]' : '[ ]'} ${b.name}`, color: c.earned.includes(b.name) ? 'success' : 'subtle' }))

      return view(id, 'Badges', `${cfg.badges.filter(b => c.earned.includes(b.name)).length}/${cfg.badges.length}`, { lines, sub: cfg.badges.length === 0 ? '/cubadge adds one' : 'earned' })
    }
    case 'goals': {
      const lines = cfg.goals.map(g => {
        const v = calc(g.expr, m)
        const pct = v === null ? 0 : Math.max(0, Math.min(100, Math.round((v / g.target) * 100)))

        return { text: `${g.name} ${bar(pct, 8)} ${pct}%`, color: pct >= 100 ? 'success' : undefined }
      })

      return view(id, 'Goals', String(cfg.goals.length), { lines, sub: cfg.goals.length === 0 ? '/cugoal adds one' : 'progress' })
    }
    case 'sprite':
      return view(id, 'Sprite', '', { spriteLines: cfg.sprite, sub: cfg.sprite.length === 0 ? '/cusprite sets one' : '' })
    default:
      return view(id, id, '?', { sub: 'unknown tile' })
  }
}

// ---------------------------------------------------------------- sprite, snippets, aliases, templates, buttons

/** Parses a sprite typed as `line|line|line|line|line` (1 to 5 lines of up to 12 characters). */
export const parseSprite = (text: string): Edit<string[]> => {
  const lines = text.split('|')

  if (lines.length < 1 || lines.length > CAP.spriteLines) {
    return { ok: false, error: `A sprite has 1 to ${CAP.spriteLines} lines, separated by |.` }
  }
  const out: string[] = []

  for (const l of lines) {
    const t = l.replace(/\s+$/, '')

    if (CONTROL.test(t) || Array.from(t).length > CAP.spriteWidth) {
      return { ok: false, error: `Each sprite line is at most ${CAP.spriteWidth} characters, with no control characters.` }
    }
    out.push(t)
  }

  return out.every(l => l === '') ? { ok: false, error: 'The sprite is empty.' } : { ok: true, value: out }
}

export const sanitizeSprite = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const r = parseSprite(raw.filter((x): x is string => typeof x === 'string').join('|'))

  return r.ok ? r.value : []
}

/** Splits arguments on spaces; "double quotes" keep words together. At most 9 arguments of 200 characters. */
export const splitArgs = (s: string): string[] => {
  const out: string[] = []

  for (const m of s.matchAll(/"([^"]*)"|(\S+)/g)) {
    out.push((m[1] ?? m[2] ?? '').slice(0, 200))

    if (out.length >= 9) {
      break
    }
  }

  return out
}

export type Expanded = { text: string; missing: string[] }

/** Fills `{1}`..`{9}` from `args`, `{*}` with all of them and `{name}` from `vars`. What cannot be filled is listed in `missing`. */
export const expandTemplate = (tpl: string, args: readonly string[], vars: Readonly<Record<string, string>>): Expanded => {
  const missing: string[] = []
  const text = tpl.replace(/\{(\*|[1-9]|[a-z][a-z0-9_]{0,15})\}/g, (all, key: string) => {
    if (key === '*') {
      return args.join(' ')
    }

    if (/^[1-9]$/.test(key)) {
      const v = args[Number(key) - 1]

      if (v === undefined) {
        missing.push(all)

        return ''
      }

      return v
    }

    if (hasOwn(vars, key)) {
      return vars[key] ?? ''
    }
    missing.push(all)

    return all
  })

  return { text, missing: [...new Set(missing)] }
}

export const strMap = (raw: unknown, keyOk: (k: string) => boolean, valOf: (v: unknown) => string | undefined, max: number): Record<string, string> => {
  const out: Record<string, string> = {}

  if (!isRecord(raw)) {
    return out
  }

  for (const [k, v] of Object.entries(raw)) {
    const val = valOf(v)

    if (keyOk(k) && val !== undefined && Object.keys(out).length < max) {
      out[k] = val
    }
  }

  return out
}

export type MapKind = 'snippets' | 'aliases' | 'templates' | 'vars'

const MAP_RULES: Record<MapKind, { keyOk: (k: string) => boolean; len: number; max: number; what: string }> = {
  snippets: { keyOk: okShortName, len: CAP.snippetLen, max: CAP.snippets, what: 'snippet' },
  aliases: { keyOk: okShortName, len: CAP.aliasLen, max: CAP.aliases, what: 'alias' },
  templates: { keyOk: okShortName, len: CAP.templateLen, max: CAP.templates, what: 'template' },
  vars: { keyOk: okVarName, len: CAP.varLen, max: CAP.vars, what: 'variable' },
}

const RESERVED = new Set(['add', 'rm', 'list', 'use', 'show', 'help', 'clear', 'reset'])

export const putMap = (cfg: Cfg, kind: MapKind, name: string, text: string): Edit<Cfg> => {
  const rule = MAP_RULES[kind]

  if (!rule.keyOk(name) || RESERVED.has(name)) {
    return { ok: false, error: kind === 'vars' ? 'A variable name is a lowercase letter then up to 15 letters, digits or _.' : `A ${rule.what} name is 1 to 16 lowercase letters, digits, _ or - (not add, rm, list, use, show).` }
  }
  const v = kind === 'snippets' || kind === 'templates' ? cleanBlock(text, rule.len) : cleanText(text, rule.len, 1)

  if (v === undefined) {
    return { ok: false, error: `The ${rule.what} text is 1 to ${rule.len} characters, with no control characters.` }
  }
  const cur = cfg[kind]

  if (!hasOwn(cur, name) && Object.keys(cur).length >= rule.max) {
    return { ok: false, error: `${rule.max} ${rule.what}s at most.` }
  }

  if (kind === 'templates') {
    const bad = /\{([^{}]*)\}/g
    const unknown = [...v.matchAll(bad)].map(m => m[1] ?? '').find(k => !/^(\*|[1-9]|[a-z][a-z0-9_]{0,15})$/.test(k))

    if (unknown !== undefined) {
      return { ok: false, error: `Placeholders are {1}..{9}, {*} or {name}; "{${unknown.slice(0, 20)}}" is not one.` }
    }
  }

  return { ok: true, value: { ...cfg, [kind]: { ...cur, [name]: v } } }
}

export const delMap = (cfg: Cfg, kind: MapKind, name: string): Edit<Cfg> => {
  if (!hasOwn(cfg[kind], name)) {
    return { ok: false, error: `No ${MAP_RULES[kind].what} called ${name}.` }
  }

  return { ok: true, value: { ...cfg, [kind]: Object.fromEntries(Object.entries(cfg[kind]).filter(([k]) => k !== name)) } }
}

export const addButton = (cfg: Cfg, label: string, text: string): Edit<Cfg> => {
  const l = cleanText(label, CAP.buttonLabel, 1)
  const t = cleanBlock(text, CAP.buttonText)

  if (l === undefined || t === undefined) {
    return { ok: false, error: `A button is a label (1 to ${CAP.buttonLabel} characters) and the text it puts in the prompt box (up to ${CAP.buttonText}).` }
  }

  if (cfg.buttons.length >= CAP.buttons) {
    return { ok: false, error: `${CAP.buttons} buttons at most.` }
  }

  if (cfg.buttons.some(b => b.label.toLowerCase() === l.toLowerCase())) {
    return { ok: false, error: `A button called ${l} exists.` }
  }

  return { ok: true, value: { ...cfg, buttons: [...cfg.buttons, { label: l, text: t }] } }
}

export const sanitizeButtons = (raw: unknown): ButtonDef[] => {
  const out: ButtonDef[] = []

  for (const b of Array.isArray(raw) ? raw : []) {
    if (isRecord(b) && out.length < CAP.buttons) {
      const l = cleanText(b.label, CAP.buttonLabel, 1)
      const t = cleanBlock(b.text, CAP.buttonText)

      if (l !== undefined && t !== undefined && !out.some(x => x.label.toLowerCase() === l.toLowerCase())) {
        out.push({ label: l, text: t })
      }
    }
  }

  return out
}

// ---------------------------------------------------------------- status template, badges, goals, rules

export const checkStatusTemplate = (tpl: string): Edit<string> => {
  const t = cleanText(tpl, CAP.status, 1)

  if (t === undefined) {
    return { ok: false, error: `A status template is 1 to ${CAP.status} characters, with no control characters.` }
  }
  const bad = checkPlaceholders(t)

  return bad === undefined ? { ok: true, value: t } : { ok: false, error: bad }
}

export const renderStatus = (tpl: string, m: Metrics): string => Array.from(interpolate(tpl, m)).slice(0, 120).join('')

const quoted = (s: string, max: number): string | undefined => {
  const t = cleanText(s, max, 1)

  return t === undefined || /["\\]/.test(t) ? undefined : t
}

/** `"100 calls" when calls >= 100` */
export const parseBadge = (text: string): Edit<BadgeDef> => {
  const m = /^"([^"]*)"\s+when\s+(.+)$/i.exec(text.trim())

  if (m === null) {
    return { ok: false, error: 'Usage: /cubadge "100 calls" when calls >= 100' }
  }
  const name = quoted(m[1] ?? '', 24)

  if (name === undefined) {
    return { ok: false, error: 'A badge name is 1 to 24 characters, without quotes.' }
  }
  const p = parseCondition(m[2] ?? '')

  return p.ok ? { ok: true, value: { name, cond: (m[2] ?? '').trim().toLowerCase() } } : { ok: false, error: `Condition refused: ${p.error}.` }
}

/** `"ship it" files target 10` */
export const parseGoal = (text: string): Edit<GoalDef> => {
  const m = /^"([^"]*)"\s+(.+?)\s+target\s+(\S+)$/i.exec(text.trim())

  if (m === null) {
    return { ok: false, error: 'Usage: /cugoal "ship it" files target 10' }
  }
  const name = quoted(m[1] ?? '', 24)

  if (name === undefined) {
    return { ok: false, error: 'A goal name is 1 to 24 characters, without quotes.' }
  }
  const p = parseFormula(m[2] ?? '')

  if (!p.ok) {
    return { ok: false, error: `Formula refused: ${p.error}.` }
  }
  const target = Number(m[3])

  if (!okNum(target, 0.000001, 1e9)) {
    return { ok: false, error: 'The target is a number above 0 and up to 1000000000.' }
  }

  return { ok: true, value: { name, expr: (m[2] ?? '').trim().toLowerCase(), target } }
}

/** `if errors > 5 then toast "Too many errors"` (a leading `rule` is optional) */
export const parseRule = (text: string): Edit<RuleDef> => {
  const m = /^(?:rule\s+)?if\s+(.+?)\s+then\s+toast\s+"([^"]*)"$/i.exec(text.trim())

  if (m === null) {
    return { ok: false, error: 'Usage: /curule add if errors > 5 then toast "Too many errors"' }
  }
  const p = parseCondition(m[1] ?? '')

  if (!p.ok) {
    return { ok: false, error: `Condition refused: ${p.error}.` }
  }
  const msg = cleanText(m[2], CAP.msg, 1)

  if (msg === undefined) {
    return { ok: false, error: `The toast text is 1 to ${CAP.msg} characters.` }
  }
  const bad = checkPlaceholders(msg)

  return bad === undefined ? { ok: true, value: { cond: (m[1] ?? '').trim().toLowerCase(), msg, isOn: true } } : { ok: false, error: bad }
}

export const sanitizeBadges = (raw: unknown): BadgeDef[] => {
  const out: BadgeDef[] = []

  for (const b of Array.isArray(raw) ? raw : []) {
    if (isRecord(b) && out.length < CAP.badges) {
      const name = typeof b.name === 'string' ? quoted(b.name, 24) : undefined

      if (name !== undefined && parseCondition(b.cond).ok && !out.some(x => x.name === name)) {
        out.push({ name, cond: String(b.cond).trim().toLowerCase() })
      }
    }
  }

  return out
}

export const sanitizeGoals = (raw: unknown): GoalDef[] => {
  const out: GoalDef[] = []

  for (const g of Array.isArray(raw) ? raw : []) {
    if (isRecord(g) && out.length < CAP.goals) {
      const name = typeof g.name === 'string' ? quoted(g.name, 24) : undefined

      if (name !== undefined && parseFormula(g.expr).ok && okNum(g.target, 0.000001, 1e9) && !out.some(x => x.name === name)) {
        out.push({ name, expr: String(g.expr).trim().toLowerCase(), target: g.target })
      }
    }
  }

  return out
}

export const sanitizeRules = (raw: unknown): RuleDef[] => {
  const out: RuleDef[] = []

  for (const r of Array.isArray(raw) ? raw : []) {
    if (isRecord(r) && out.length < CAP.rules) {
      const msg = cleanText(r.msg, CAP.msg, 1)

      if (msg !== undefined && checkPlaceholders(msg) === undefined && parseCondition(r.cond).ok) {
        out.push({ cond: String(r.cond).trim().toLowerCase(), msg, isOn: r.isOn !== false })
      }
    }
  }

  return out
}

export const earnedNow = (badges: readonly BadgeDef[], m: Metrics): string[] => badges.filter(b => holds(b.cond, m)).map(b => b.name)

/** The six ready-made rules. Each can be switched on or off; they run through the same engine as your own rules. */
export const RECIPES: readonly { id: string; label: string; cond: string; msg: string }[] = [
  { id: 'errors', label: 'Many errors', cond: 'errors >= 5', msg: '{errors} tool errors this session' },
  { id: 'context', label: 'Context nearly full', cond: 'ctx >= 80', msg: 'Context is {ctx} full: consider /compact' },
  { id: 'budget', label: 'Over the project budget', cond: 'budget > 0 && spend > budget', msg: 'Spend {spend} passed this project\'s budget {budget}' },
  { id: 'spend', label: 'Spend reached $5', cond: 'spend >= 5', msg: 'Session spend reached {spend}' },
  { id: 'long', label: 'Long session', cond: 'mins >= 120', msg: 'Session open for {mins}: time for a break?' },
  { id: 'files', label: 'Many files edited', cond: 'files >= 20', msg: '{files} files edited this session' },
]

export type Fired = { key: string; msg: string }

/** Which rules just became true. A rule fires once when its condition turns true and re-arms when it turns false again. */
export const evalRules = (
  rules: readonly RuleDef[],
  recipes: Readonly<Record<string, boolean>>,
  m: Metrics,
  armed: Readonly<Record<string, boolean>>,
  use: { rules: boolean; recipes: boolean },
): { fired: Fired[]; armed: Record<string, boolean> } => {
  const fired: Fired[] = []
  const next: Record<string, boolean> = {}
  const items: { key: string; cond: string; msg: string }[] = [
    ...(use.rules ? rules.filter(r => r.isOn).map(r => ({ key: `u:${r.cond}`, cond: r.cond, msg: r.msg })) : []),
    ...(use.recipes ? RECIPES.filter(r => recipes[r.id] === true).map(r => ({ key: `p:${r.id}`, cond: r.cond, msg: r.msg })) : []),
  ]

  for (const it of items) {
    const now = holds(it.cond, m)
    next[it.key] = now

    if (now && armed[it.key] !== true) {
      fired.push({ key: it.key, msg: interpolate(it.msg, m) })
    }
  }

  return { fired, armed: next }
}

// ---------------------------------------------------------------- saved layouts, per-project, budgets

export const clonePages = (pages: readonly Page[]): Page[] => pages.map(p => ({ name: p.name, tiles: p.tiles.map(t => ({ id: t.id, size: t.size })) }))

export const saveLayout = (cfg: Cfg, name: string): Edit<Cfg> => {
  if (!okShortName(name)) {
    return { ok: false, error: 'A layout name is 1 to 16 lowercase letters, digits, _ or -.' }
  }

  if (!hasOwn(cfg.saved, name) && Object.keys(cfg.saved).length >= CAP.saved) {
    return { ok: false, error: `${CAP.saved} saved layouts at most. /culayout rm <name> frees one.` }
  }

  return { ok: true, value: { ...cfg, saved: { ...cfg.saved, [name]: clonePages(cfg.pages) } } }
}

export const loadLayout = (cfg: Cfg, name: string): Edit<Cfg> => {
  if (!hasOwn(cfg.saved, name)) {
    return { ok: false, error: `No saved layout called ${name}.` }
  }
  const pages = sanitizePages(cfg.saved[name], cfg.defs)

  return pages.length === 0 ? { ok: false, error: `Layout ${name} has no valid page left.` } : { ok: true, value: { ...cfg, pages } }
}

export const deleteLayout = (cfg: Cfg, name: string): Edit<Cfg> => {
  if (!hasOwn(cfg.saved, name)) {
    return { ok: false, error: `No saved layout called ${name}.` }
  }

  return {
    ok: true,
    value: { ...cfg, saved: Object.fromEntries(Object.entries(cfg.saved).filter(([k]) => k !== name)), byProject: Object.fromEntries(Object.entries(cfg.byProject).filter(([, v]) => v !== name)) },
  }
}

const okCwd = (s: unknown): s is string => typeof s === 'string' && s.length >= 1 && s.length <= 300 && !CONTROL.test(s)

export const bindProject = (cfg: Cfg, cwd: string, name: string | undefined): Edit<Cfg> => {
  if (!okCwd(cwd)) {
    return { ok: false, error: 'No project folder is known for this session.' }
  }

  if (name === undefined) {
    return { ok: true, value: { ...cfg, byProject: Object.fromEntries(Object.entries(cfg.byProject).filter(([k]) => k !== cwd)) } }
  }

  if (!hasOwn(cfg.saved, name)) {
    return { ok: false, error: `No saved layout called ${name}. /culayout save ${name} first.` }
  }

  if (!hasOwn(cfg.byProject, cwd) && Object.keys(cfg.byProject).length >= CAP.byProject) {
    return { ok: false, error: `${CAP.byProject} projects at most.` }
  }

  return { ok: true, value: { ...cfg, byProject: { ...cfg.byProject, [cwd]: name } } }
}

export const setBudget = (cfg: Cfg, cwd: string, usd: number | undefined): Edit<Cfg> => {
  if (!okCwd(cwd)) {
    return { ok: false, error: 'No project folder is known for this session.' }
  }

  if (usd === undefined) {
    return { ok: true, value: { ...cfg, budgets: Object.fromEntries(Object.entries(cfg.budgets).filter(([k]) => k !== cwd)) } }
  }

  if (!okNum(usd, 0.01, 100_000)) {
    return { ok: false, error: 'A budget is from 0.01 to 100000 dollars.' }
  }

  if (!hasOwn(cfg.budgets, cwd) && Object.keys(cfg.budgets).length >= CAP.budgets) {
    return { ok: false, error: `${CAP.budgets} project budgets at most.` }
  }

  return { ok: true, value: { ...cfg, budgets: { ...cfg.budgets, [cwd]: Math.round(usd * 100) / 100 } } }
}

export const budgetFor = (cfg: Cfg, cwd: string): number => (hasOwn(cfg.budgets, cwd) ? (cfg.budgets[cwd] ?? 0) : 0)

// ---------------------------------------------------------------- loading from the store

const sanitizeThr = (raw: unknown): Thresholds => {
  const out = emptyCfg().thr
  const o = isRecord(raw) ? raw : {}

  for (const k of ['ctx', 'limit', 'errors', 'spend'] as const) {
    const v = o[k]

    if (Array.isArray(v) && v.length === 2 && okNum(v[0], 0, 1e6) && okNum(v[1], 0, 1e6) && v[0] <= v[1] && ((k !== 'ctx' && k !== 'limit') || v[1] <= 100)) {
      out[k] = [v[0], v[1]]
    }
  }

  return out
}

const sanitizeBoolMap = (raw: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {}

  if (isRecord(raw)) {
    for (const r of RECIPES) {
      if (typeof raw[r.id] === 'boolean') {
        out[r.id] = raw[r.id] as boolean
      }
    }
  }

  return out
}

const sanitizeStyleMap = (raw: unknown, valOf: (v: unknown) => string | undefined): Record<string, string> => strMap(raw, okToolName, valOf, CAP.toolStyles)

export const sanitizeCfg = (raw: unknown): Cfg => {
  const base = emptyCfg()

  if (!isRecord(raw)) {
    return base
  }
  const defs: CustomDef[] = []

  for (const d of Array.isArray(raw.defs) ? raw.defs : []) {
    const c = checkDef(d)

    if (c !== undefined && defs.length < CAP.defs && !defs.some(x => x.id === c.id)) {
      defs.push(c)
    }
  }
  const pages = sanitizePages(raw.pages, defs)
  const saved: Record<string, Page[]> = {}

  if (isRecord(raw.saved)) {
    for (const [k, v] of Object.entries(raw.saved)) {
      const p = sanitizePages(v, defs)

      if (okShortName(k) && p.length > 0 && Object.keys(saved).length < CAP.saved) {
        saved[k] = p
      }
    }
  }
  const byProject: Record<string, string> = {}

  if (isRecord(raw.byProject)) {
    for (const [k, v] of Object.entries(raw.byProject)) {
      if (okCwd(k) && typeof v === 'string' && hasOwn(saved, v) && Object.keys(byProject).length < CAP.byProject) {
        byProject[k] = v
      }
    }
  }
  const budgets: Record<string, number> = {}

  if (isRecord(raw.budgets)) {
    for (const [k, v] of Object.entries(raw.budgets)) {
      if (okCwd(k) && okNum(v, 0.01, 100_000) && Object.keys(budgets).length < CAP.budgets) {
        budgets[k] = v
      }
    }
  }
  const status = typeof raw.statusTpl === 'string' && raw.statusTpl !== '' ? checkStatusTemplate(raw.statusTpl) : undefined

  return {
    pages: pages.length > 0 ? pages : base.pages,
    defs,
    saved,
    byProject,
    snippets: strMap(raw.snippets, okShortName, v => cleanBlock(v, CAP.snippetLen), CAP.snippets),
    aliases: strMap(raw.aliases, okShortName, v => cleanText(v, CAP.aliasLen, 1), CAP.aliases),
    templates: strMap(raw.templates, okShortName, v => cleanBlock(v, CAP.templateLen), CAP.templates),
    vars: strMap(raw.vars, okVarName, v => cleanText(v, CAP.varLen, 1), CAP.vars),
    buttons: sanitizeButtons(raw.buttons),
    statusTpl: status !== undefined && status.ok ? status.value : '',
    sprite: sanitizeSprite(raw.sprite),
    badges: sanitizeBadges(raw.badges),
    goals: sanitizeGoals(raw.goals),
    rules: sanitizeRules(raw.rules),
    recipes: sanitizeBoolMap(raw.recipes),
    toolColor: sanitizeStyleMap(raw.toolColor, v => (okColor(v) ? v : undefined)),
    toolGlyph: sanitizeStyleMap(raw.toolGlyph, v => cleanText(v, 2, 1)),
    toolName: sanitizeStyleMap(raw.toolName, v => cleanText(v, 20, 1)),
    thr: sanitizeThr(raw.thr),
    budgets,
  }
}

// ---------------------------------------------------------------- export and import of a layout

export const exportLayout = (cfg: Cfg): string => {
  const used = new Set(cfg.pages.flatMap(p => p.tiles.map(t => t.id)))
  const defs = cfg.defs
    .filter(d => used.has(`c:${d.id}`))
    .map(d => (d.kind === 'text' ? { id: d.id, kind: d.kind, label: d.label, text: d.text } : d.kind === 'number' ? { id: d.id, kind: d.kind, label: d.label, num: d.num, unit: d.unit } : { id: d.id, kind: d.kind, label: d.label, expr: d.expr }))

  return JSON.stringify({ 'layout-kit': 1, pages: cfg.pages, defs })
}

const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[], what: string): string | undefined => {
  const extra = Object.keys(o).find(k => !allowed.includes(k))

  return extra === undefined ? undefined : `${what} has an unknown key "${extra.slice(0, 20)}".`
}

export type Imported = { ok: true; pages: Page[]; defs: CustomDef[]; diff: string } | { ok: false; error: string }

const DEF_KEYS: Record<string, readonly string[]> = {
  text: ['id', 'kind', 'label', 'text'],
  number: ['id', 'kind', 'label', 'num', 'unit'],
  formula: ['id', 'kind', 'label', 'expr'],
}

/** Strictly validates a layout somebody exported: exact keys, exact types, every cap, every formula parsed. Nothing is applied here. */
export const parseImport = (text: string, cfg: Cfg): Imported => {
  const src = text.trim()

  if (src === '') {
    return { ok: false, error: 'Paste the text /cuexport gave: /cuimport {...}' }
  }

  if (src.length > CAP.importText) {
    return { ok: false, error: `Too long (${CAP.importText} characters at most).` }
  }
  let raw: unknown

  try {
    raw = JSON.parse(src)
  } catch {
    return { ok: false, error: 'That is not valid JSON.' }
  }

  if (!isRecord(raw)) {
    return { ok: false, error: 'The top level must be an object.' }
  }
  const topBad = onlyKeys(raw, ['layout-kit', 'pages', 'defs'], 'The layout')

  if (topBad !== undefined) {
    return { ok: false, error: topBad }
  }

  if (raw['layout-kit'] !== 1) {
    return { ok: false, error: 'Missing "layout-kit": 1 (the format version).' }
  }

  if (!Array.isArray(raw.pages) || raw.pages.length < 1 || raw.pages.length > CAP.pages) {
    return { ok: false, error: `"pages" must hold 1 to ${CAP.pages} pages.` }
  }
  const rawDefs = raw.defs === undefined ? [] : raw.defs

  if (!Array.isArray(rawDefs) || rawDefs.length > CAP.defs) {
    return { ok: false, error: `"defs" must be a list of at most ${CAP.defs}.` }
  }
  const defs: CustomDef[] = []

  for (const d of rawDefs) {
    if (!isRecord(d) || typeof d.kind !== 'string' || !hasOwn(DEF_KEYS, d.kind)) {
      return { ok: false, error: 'A custom tile needs a kind of text, number or formula.' }
    }
    const bad = onlyKeys(d, DEF_KEYS[d.kind] ?? [], 'A custom tile')

    if (bad !== undefined) {
      return { ok: false, error: bad }
    }

    if (d.kind === 'number' && typeof d.num !== 'number') {
      return { ok: false, error: 'A number tile needs a numeric "num".' }
    }

    if (d.kind === 'number' && d.unit !== undefined && typeof d.unit !== 'string') {
      return { ok: false, error: 'The unit is text.' }
    }
    const c = checkDef(d)

    if (c === undefined) {
      return { ok: false, error: `Custom tile "${String(d.id).slice(0, 20)}" is not valid (id, label, text, number or formula).` }
    }

    if (defs.some(x => x.id === c.id)) {
      return { ok: false, error: `Custom tile "${c.id}" appears twice.` }
    }
    defs.push(c)
  }
  const merged = [...cfg.defs.filter(d => !defs.some(x => x.id === d.id)), ...defs]

  if (merged.length > CAP.defs) {
    return { ok: false, error: `Importing would leave ${merged.length} custom tiles; ${CAP.defs} at most. /cucustom rm <id> frees some.` }
  }
  const pages: Page[] = []

  for (const p of raw.pages) {
    if (!isRecord(p)) {
      return { ok: false, error: 'A page must be an object.' }
    }
    const bad = onlyKeys(p, ['name', 'tiles'], 'A page')

    if (bad !== undefined) {
      return { ok: false, error: bad }
    }

    const pname = p.name

    if (!okPageName(pname)) {
      return { ok: false, error: `Page name ${String(JSON.stringify(pname)).slice(0, 24)} is not valid (1 to 16 letters, digits, spaces, - or _).` }
    }

    if (pages.some(x => x.name.toLowerCase() === pname.toLowerCase())) {
      return { ok: false, error: `Page "${pname}" appears twice.` }
    }

    if (!Array.isArray(p.tiles) || p.tiles.length > CAP.tiles) {
      return { ok: false, error: `Page "${p.name}": "tiles" must be a list of at most ${CAP.tiles}.` }
    }
    const tiles: TileRef[] = []

    for (const t of p.tiles) {
      if (!isRecord(t)) {
        return { ok: false, error: `Page "${p.name}": a tile must be an object.` }
      }
      const tb = onlyKeys(t, ['id', 'size'], 'A tile')

      if (tb !== undefined) {
        return { ok: false, error: tb }
      }

      if (!okTileId(t.id)) {
        return { ok: false, error: `Page "${p.name}": tile ${String(JSON.stringify(t.id)).slice(0, 24)} is not a known tile.` }
      }

      if (isCustomRef(t.id) && !merged.some(d => `c:${d.id}` === t.id)) {
        return { ok: false, error: `Page "${p.name}": tile ${t.id} has no definition in "defs".` }
      }

      if (t.size !== 'S' && t.size !== 'M' && t.size !== 'L') {
        return { ok: false, error: `Tile ${t.id}: size must be "S", "M" or "L".` }
      }

      if (tiles.some(x => x.id === t.id)) {
        return { ok: false, error: `Page "${p.name}": ${t.id} appears twice.` }
      }
      tiles.push({ id: t.id, size: t.size })
    }
    pages.push({ name: pname, tiles })
  }

  return { ok: true, pages, defs, diff: diffLayout(cfg.pages, cfg.defs, pages, defs).join('\n') }
}

const sameDef = (a: CustomDef, b: CustomDef): boolean => a.kind === b.kind && a.label === b.label && a.text === b.text && a.num === b.num && a.unit === b.unit && a.expr === b.expr

/** A readable list of what applying a layout would change. */
export const diffLayout = (curPages: readonly Page[], curDefs: readonly CustomDef[], newPages: readonly Page[], newDefs: readonly CustomDef[]): string[] => {
  const out: string[] = [`Pages: ${curPages.length} now, ${newPages.length} after.`]

  for (const p of newPages) {
    const old = curPages.find(x => x.name.toLowerCase() === p.name.toLowerCase())

    if (old === undefined) {
      out.push(`+ page ${p.name} (${p.tiles.length} tiles: ${p.tiles.map(t => `${t.id}/${t.size}`).join(' ')})`)
      continue
    }
    const add = p.tiles.filter(t => !old.tiles.some(o => o.id === t.id)).map(t => t.id)
    const del = old.tiles.filter(o => !p.tiles.some(t => t.id === o.id)).map(o => o.id)
    const resized = p.tiles.filter(t => old.tiles.some(o => o.id === t.id && o.size !== t.size)).map(t => t.id)
    const order = p.tiles.filter(t => old.tiles.some(o => o.id === t.id)).map(t => t.id).join() !== old.tiles.filter(o => p.tiles.some(t => t.id === o.id)).map(o => o.id).join()
    const parts = [add.length > 0 ? `add ${add.join(' ')}` : '', del.length > 0 ? `remove ${del.join(' ')}` : '', resized.length > 0 ? `resize ${resized.join(' ')}` : '', order ? 'reorder' : ''].filter(x => x !== '')
    out.push(parts.length === 0 ? `= page ${p.name} unchanged` : `~ page ${p.name}: ${parts.join(', ')}`)
  }

  for (const o of curPages) {
    if (!newPages.some(p => p.name.toLowerCase() === o.name.toLowerCase())) {
      out.push(`- page ${o.name} (${o.tiles.length} tiles) is removed`)
    }
  }

  for (const d of newDefs) {
    const old = curDefs.find(x => x.id === d.id)
    out.push(old === undefined ? `+ custom tile c:${d.id} (${d.kind}: ${d.label})` : sameDef(old, d) ? `= custom tile c:${d.id} unchanged` : `~ custom tile c:${d.id} is replaced (${d.kind}: ${d.label})`)
  }

  return out
}

/** Applies a validated import: the pages replace the current ones, the defs are merged in. */
export const applyImport = (cfg: Cfg, pages: Page[], defs: CustomDef[]): Cfg => ({ ...cfg, pages, defs: [...cfg.defs.filter(d => !defs.some(x => x.id === d.id)), ...defs] })
