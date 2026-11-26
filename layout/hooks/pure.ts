// Pure helpers of the layout mod: no `$`, no drawing, all testable on their own.
import type { Auto, ColsMode, IconSet, LayoutSettings, PathMode, RecentFile, SplitBlobs } from '../types'

// ------------------------------------------------------------------ settings

export const DEFAULTS: LayoutSettings = {
  zen: false,
  icons: 'symbols',
  path: 'mid',
  stripes: true,
  errBanner: true,
  longBanner: true,
  chips: false,
  width: 0,
  compact: 'auto',
  cols: 'auto',
}

const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

export const WIDTH_MIN = 40
export const WIDTH_MAX = 240

export const clampWidth = (value: unknown): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0

  return n <= 0 ? 0 : Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n))
}

// Whatever came out of `$.store` or an older version becomes a valid value.
export const normSettings = (raw: unknown): LayoutSettings => {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  return {
    zen: bool(o.zen, DEFAULTS.zen),
    icons: oneOf<IconSet>(o.icons, ['letters', 'symbols', 'minimal'], DEFAULTS.icons),
    path: oneOf<PathMode>(o.path, ['short', 'mid', 'full'], DEFAULTS.path),
    stripes: bool(o.stripes, DEFAULTS.stripes),
    errBanner: bool(o.errBanner, DEFAULTS.errBanner),
    longBanner: bool(o.longBanner, DEFAULTS.longBanner),
    chips: bool(o.chips, DEFAULTS.chips),
    width: clampWidth(o.width),
    compact: oneOf<Auto>(o.compact, ['auto', 'on', 'off'], DEFAULTS.compact),
    cols: oneOf<ColsMode>(o.cols, ['auto', '1', '2'], DEFAULTS.cols),
  }
}

export const parseSwitch = (word: string, current: boolean): boolean | null => {
  const w = word.trim().toLowerCase()

  if (w === 'on' || w === 'true' || w === '1' || w === 'yes') {
    return true
  }
  if (w === 'off' || w === 'false' || w === '0' || w === 'no') {
    return false
  }

  return w === '' || w === 'toggle' ? !current : null
}

export const nextOf = <T extends string>(list: readonly T[], current: T): T =>
  list[(list.indexOf(current) + 1) % list.length] as T

export const ICON_SETS: readonly IconSet[] = ['letters', 'symbols', 'minimal']
export const PATH_MODES: readonly PathMode[] = ['short', 'mid', 'full']
export const AUTO_MODES: readonly Auto[] = ['auto', 'on', 'off']
export const COLS_MODES: readonly ColsMode[] = ['auto', '1', '2']

// --------------------------------------------------------------------- icons

export type IconKey = 'ok' | 'warn' | 'error' | 'info' | 'open' | 'closed' | 'file' | 'pin' | 'long' | 'here' | 'chip'

export const ICONS: Record<IconSet, Record<IconKey, string>> = {
  letters: { ok: 'ok', warn: '!', error: 'x', info: 'i', open: 'v', closed: '>', file: 'f', pin: 'p', long: 'L', here: '*', chip: '' },
  symbols: { ok: '✓', warn: '▲', error: '✗', info: 'ℹ', open: '▾', closed: '▸', file: '◦', pin: '◆', long: '≫', here: '▶', chip: '‹›' },
  minimal: { ok: '+', warn: '!', error: 'x', info: '-', open: '-', closed: '+', file: '-', pin: '*', long: '~', here: '>', chip: '' },
}

// A code-fence chip in each pack: ‹ts›, [ts], ts.
export const chipText = (icons: IconSet, lang: string) =>
  icons === 'symbols' ? `‹${lang}›` : icons === 'letters' ? `[${lang}]` : lang

// ---------------------------------------------------------------------- text

export const fitMiddle = (text: string, max: number): string => {
  if (max <= 0 || text.length <= max) {
    return text
  }
  if (max === 1) {
    return '…'
  }
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)

  return `${text.slice(0, head)}…${tail > 0 ? text.slice(text.length - tail) : ''}`
}

// short: the file name. mid: the last two segments behind an ellipsis. full: all of it.
export const pathLabel = (path: string, mode: PathMode, max = 0): string => {
  const parts = path.split('/').filter(part => part !== '')
  let label = path

  if (mode === 'short') {
    label = parts.length > 0 ? (parts[parts.length - 1] as string) : path
  } else if (mode === 'mid') {
    label = parts.length <= 2 ? parts.join('/') : `…/${parts.slice(-2).join('/')}`
    label = label === '' ? path : label
  }

  return fitMiddle(label, max)
}

export const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g

export const outputText = (value: unknown, depth = 0): string => {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(one => outputText(one, depth + 1)).join('\n')
  }
  if (value !== null && typeof value === 'object' && depth < 4) {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^(base64|image|rawOutputPath)$/.test(key))
      .map(([, one]) => outputText(one, depth + 1))
      .filter(text => text.length > 0)
      .join('\n')
  }

  return ''
}

export const countLines = (text: string) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length)

export const LONG_LINES = 300

// The text a result carries; a Read keeps its file body under `file.content`.
export const resultText = (tool: string, output: unknown): string => {
  const file = (output as { file?: { content?: unknown } } | null | undefined)?.file

  return tool === 'Read' && typeof file?.content === 'string' ? file.content : outputText(output)
}

export const longOutput = (tool: string, output: unknown): { lines: number; kb: number } | null => {
  const text = resultText(tool, output)
  const lines = countLines(text)

  return lines > LONG_LINES ? { lines, kb: Math.max(1, Math.round(text.length / 1024)) } : null
}

// The first line worth showing of an error: no colour codes, no blank lines, bounded.
export const errorLine = (output: unknown, max = 140): string => {
  const text = outputText(output).replace(ANSI, '')
  const line = text.split('\n').map(one => one.trim()).find(one => one !== '') ?? ''

  return fitMiddle(line, max)
}

export const fenceLanguages = (text: string): string[] => {
  const seen: string[] = []

  for (const m of text.matchAll(/^[ \t]*(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]{1,20})/gm)) {
    const lang = (m[1] as string).toLowerCase()

    if (!seen.includes(lang)) {
      seen.push(lang)
    }
  }

  return seen
}

// ---------------------------------------------------------------------- time

const pad2 = (n: number) => String(n).padStart(2, '0')

export const relTime = (at: number, now: number): string => {
  const sec = Math.floor(Math.max(0, now - at) / 1000)

  if (sec < 5) {
    return 'just now'
  }
  if (sec < 60) {
    return `${sec}s ago`
  }
  const min = Math.floor(sec / 60)

  if (min < 60) {
    return `${min}m ago`
  }
  const hours = Math.floor(min / 60)

  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)

  return days < 30 ? `${days}d ago` : exactTime(at, now, true)
}

// The exact moment: the time of day when it is today, else the date and the time.
export const exactTime = (at: number, now: number, dateOnly = false): string => {
  const d = new Date(at)
  const n = new Date(now)
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  const isToday = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()

  return dateOnly ? day : isToday ? clock : `${day} ${clock.slice(0, 5)}`
}

// "5m ago" and, unless the row is tight, "(14:03:22)" after it.
export const whenText = (at: number, now: number, withExact: boolean) =>
  withExact ? `${relTime(at, now)} (${exactTime(at, now)})` : relTime(at, now)

// -------------------------------------------------------------------- layout

export const isCompact = (mode: Auto, columns: number | undefined, rows: number | undefined): boolean =>
  mode === 'on' ? true : mode === 'off' ? false : (columns !== undefined && columns < 56) || (rows !== undefined && rows > 0 && rows < 16)

export const WIDE_AT = 100

export const useTwoCols = (mode: ColsMode, bodyColumns: number): boolean =>
  mode === '2' ? true : mode === '1' ? false : bodyColumns >= WIDE_AT

export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'
export const SURFACES: readonly Surface[] = ['terminal', 'desktop', 'vscode', 'mobile']

export type Tune = {
  surface: Surface
  hotkeys: boolean
  sizes: boolean
  pad: number
  input: string
  scroll: string
}

// What this mod's own panes do differently per surface.
export const tune = (surface: string): Tune => {
  switch (surface) {
    case 'desktop':
      return { surface, hotkeys: true, sizes: true, pad: 1, input: 'native field', scroll: 'engine window over the tree' }
    case 'vscode':
      return { surface, hotkeys: true, sizes: true, pad: 0, input: 'native field', scroll: 'engine window over the tree' }
    case 'mobile':
      return { surface, hotkeys: false, sizes: true, pad: 1, input: 'only if the app draws it, so text is mirrored', scroll: 'touch scroll, rows in its own unit' }
    default:
      return { surface: 'terminal', hotkeys: true, sizes: false, pad: 0, input: 'native field', scroll: 'one cell row per Text' }
  }
}

// ------------------------------------------------------------------- sticky

export type Sticky = { isHeader?: boolean; isSticky?: boolean }

// The tree's window starts at `offset`. When that row is not a header and an earlier header has scrolled
// out, a copy of the header takes the window's first row (the rows below move down by one, none is lost).
// `base` is how many tree rows sit above the first item.
export const withSticky = <T extends Sticky>(items: readonly T[], offset: number, base: number): T[] => {
  const at = offset - base

  if (at <= 0 || at >= items.length || items[at]?.isHeader === true) {
    return [...items]
  }
  let header = -1

  for (let i = at - 1; i >= 0; i -= 1) {
    if (items[i]?.isHeader === true) {
      header = i
      break
    }
  }
  if (header < 0) {
    return [...items]
  }
  const copy = { ...(items[header] as T), isSticky: true }

  return [...items.slice(0, at), copy, ...items.slice(at)]
}

// ---------------------------------------------------------------- split view

export type DiffRow = { kind: 'same' | 'chg' | 'del' | 'add'; l?: string; r?: string }

export const MAX_BLOB = 4000
export const MAX_LINES = 200

export const toLines = (blob: string): string[] => (blob === '' ? [] : blob.split('\n').slice(0, MAX_LINES))

export const diffRows = (a: readonly string[], b: readonly string[]): DiffRow[] => {
  const n = a.length
  const m = b.length
  // best[i][j]: length of the longest common run of a[i..] and b[j..].
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      best[i]![j] = a[i] === b[j] ? best[i + 1]![j + 1]! + 1 : Math.max(best[i + 1]![j]!, best[i]![j + 1]!)
    }
  }
  const out: DiffRow[] = []
  let dels: string[] = []
  let adds: string[] = []
  const flush = () => {
    const pairs = Math.min(dels.length, adds.length)

    for (let k = 0; k < pairs; k += 1) {
      out.push({ kind: 'chg', l: dels[k], r: adds[k] })
    }
    for (const l of dels.slice(pairs)) {
      out.push({ kind: 'del', l })
    }
    for (const r of adds.slice(pairs)) {
      out.push({ kind: 'add', r })
    }
    dels = []
    adds = []
  }
  let i = 0
  let j = 0

  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush()
      out.push({ kind: 'same', l: a[i], r: b[j] })
      i += 1
      j += 1
    } else if (j >= m || (i < n && best[i + 1]![j]! >= best[i]![j + 1]!)) {
      dels.push(a[i] as string)
      i += 1
    } else {
      adds.push(b[j] as string)
      j += 1
    }
  }
  flush()

  return out
}

// `/lysplit left | right`: the first bar divides, `\|` is a literal bar and `\n` a line break.
export const parseSplitArgs = (args: string): SplitBlobs | null => {
  let at = -1

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '\\') {
      i += 1
    } else if (args[i] === '|') {
      at = i
      break
    }
  }
  if (at < 0) {
    return null
  }
  const clean = (part: string) =>
    part
      .trim()
      .replace(/\\(n|\|)/g, (_, c: string) => (c === 'n' ? '\n' : '|'))
      .slice(0, MAX_BLOB)

  return { a: clean(args.slice(0, at)), b: clean(args.slice(at + 1)) }
}

export const diffStats = (rows: readonly DiffRow[]) => ({
  same: rows.filter(r => r.kind === 'same').length,
  differ: rows.filter(r => r.kind !== 'same').length,
})

// -------------------------------------------------------------- recent files

export const RECENT_KEEP = 30

export const pathOfCall = (e: Record<string, unknown>): string | null => {
  const p = e.file_path ?? e.notebook_path

  return typeof p === 'string' && p !== '' ? p : null
}

export const addRecent = (list: readonly RecentFile[], one: RecentFile): RecentFile[] =>
  [one, ...list.filter(x => x.path !== one.path)].slice(0, RECENT_KEEP)

// -------------------------------------------------------------------- panes

export const PANES: Record<string, { title: string; rows: number; columns: number; placement?: 'widget' }> = {
  'layout-main': { title: 'Layout', rows: 18, columns: 60 },
  'layout-note': { title: 'Note', rows: 7, columns: 34, placement: 'widget' },
  'layout-split': { title: 'Split', rows: 16, columns: 72 },
}

export const paneId = (word: string): string | null => {
  const w = word.trim().toLowerCase().replace(/^layout-/, '')
  const id = `layout-${w}`

  return Object.prototype.hasOwnProperty.call(PANES, id) ? id : null
}

export const VIEWS = ['settings', 'legend', 'recent', 'surface', 'commands'] as const
export type View = (typeof VIEWS)[number]

export const asView = (value: unknown): View => (VIEWS as readonly string[]).includes(value as string) ? (value as View) : 'settings'

export const VIEW_LABEL: Record<View, [string, string]> = {
  settings: ['Settings', 'Set'],
  legend: ['Legend', 'Key'],
  recent: ['Recent', 'Rec'],
  surface: ['Surface', 'Srf'],
  commands: ['Commands', 'Cmd'],
}

// ------------------------------------------------------------------ commands

export type CommandDoc = { group: string; name: string; args: string; desc: string }

export const COMMANDS: readonly CommandDoc[] = [
  { group: 'Panes', name: 'lymain', args: '[settings|legend|recent|surface|commands]', desc: 'open the showcase and settings pane' },
  { group: 'Panes', name: 'lylegend', args: '', desc: 'colour legend: each theme key and where these mods use it' },
  { group: 'Panes', name: 'lytime', args: '', desc: 'relative-and-exact time demo (the Recent tab)' },
  { group: 'Panes', name: 'lysplit', args: 'a|b', desc: 'compare two text blobs side by side; clear, swap' },
  { group: 'Panes', name: 'lynote', args: '<text>', desc: 'small floating note pane; clear' },
  { group: 'Panes', name: 'lypin', args: '<main|note|split>', desc: 'reopen that pane at every session start; list, clear' },
  { group: 'Display', name: 'lyzen', args: '[on|off]', desc: 'hide every band row and status text other mods draw' },
  { group: 'Display', name: 'lycols', args: 'auto|1|2', desc: 'one or two columns in this mod\'s panes' },
  { group: 'Display', name: 'lycompact', args: 'auto|on|off', desc: 'dense panes for small windows' },
  { group: 'Display', name: 'lyicons', args: 'letters|symbols|minimal', desc: 'icon pack for this mod\'s panes and banners' },
  { group: 'Display', name: 'lystripe', args: '[on|off]', desc: 'alternate row tone in this mod\'s lists' },
  { group: 'Display', name: 'lypath', args: 'short|mid|full', desc: 'how file paths are cut in this mod\'s lists' },
  { group: 'Transcript', name: 'lyerr', args: '[on|off]', desc: 'one-line banner under a failed tool call' },
  { group: 'Transcript', name: 'lylong', args: '[on|off]', desc: `banner on results over ${LONG_LINES} lines` },
  { group: 'Transcript', name: 'lychips', args: '[on|off]', desc: 'language chips under code in assistant text' },
  { group: 'Transcript', name: 'lywidth', args: '<cols>|off', desc: 'reading width limit for assistant text' },
  { group: 'Housekeeping', name: 'ly', args: '', desc: 'this list' },
  { group: 'Housekeeping', name: 'lyreset', args: '', desc: 'reset settings and clear everything this mod stored' },
]

export const GROUPS = ['Panes', 'Display', 'Transcript', 'Housekeeping'] as const

export const helpText = () =>
  ['layout commands:', ...COMMANDS.map(c => `/${c.name}${c.args === '' ? '' : ` ${c.args}`}  ${c.desc}`)].join('\n')

// ------------------------------------------------------------------- legend

export type LegendKey = { key: string; group: string; meaning: string; usedBy: string[] }

export const LEGEND_GROUPS = ['Text and state', 'Prompt, modes and chrome', 'Diffs'] as const

// `usedBy` is what a scan of the sibling mods found when this mod was written; it is a snapshot, not live.
export const LEGEND: readonly LegendKey[] = [
  { key: 'text', group: 'Text and state', meaning: 'default body text', usedBy: [] },
  { key: 'inverseText', group: 'Text and state', meaning: 'text drawn on a filled background', usedBy: [] },
  { key: 'inactive', group: 'Text and state', meaning: 'idle or disabled parts', usedBy: ['animations'] },
  { key: 'subtle', group: 'Text and state', meaning: 'quiet secondary text, hints', usedBy: ['workbench', 'cockpit', 'extras', 'personality'] },
  { key: 'suggestion', group: 'Text and state', meaning: 'links, hints, informational accents', usedBy: ['tool-visuals', 'workbench', 'cockpit'] },
  { key: 'remember', group: 'Text and state', meaning: 'memory notices', usedBy: [] },
  { key: 'success', group: 'Text and state', meaning: 'finished, passing, ok', usedBy: ['workbench', 'cockpit', 'motion'] },
  { key: 'error', group: 'Text and state', meaning: 'failed or refused (layout error banner)', usedBy: ['tool-visuals', 'cockpit', 'layout'] },
  { key: 'warning', group: 'Text and state', meaning: 'slow, risky, large (layout long-output banner)', usedBy: ['tool-visuals', 'cockpit', 'layout'] },
  { key: 'merged', group: 'Text and state', meaning: 'merged or completed work', usedBy: [] },
  { key: 'claude', group: 'Text and state', meaning: 'the brand accent', usedBy: ['motion', 'personality'] },
  { key: 'permission', group: 'Prompt, modes and chrome', meaning: 'permission prompts', usedBy: [] },
  { key: 'planMode', group: 'Prompt, modes and chrome', meaning: 'plan mode accent', usedBy: [] },
  { key: 'autoAccept', group: 'Prompt, modes and chrome', meaning: 'auto-accept mode accent', usedBy: [] },
  { key: 'promptBorder', group: 'Prompt, modes and chrome', meaning: 'border round the prompt box', usedBy: [] },
  { key: 'bashBorder', group: 'Prompt, modes and chrome', meaning: 'border in shell mode', usedBy: [] },
  { key: 'ide', group: 'Prompt, modes and chrome', meaning: 'editor integration accent', usedBy: [] },
  { key: 'diffAdded', group: 'Diffs', meaning: 'added line (layout split view, right side)', usedBy: ['tool-visuals', 'layout'] },
  { key: 'diffRemoved', group: 'Diffs', meaning: 'removed line (layout split view, left side)', usedBy: ['tool-visuals', 'layout'] },
  { key: 'diffAddedDimmed', group: 'Diffs', meaning: 'added line, background tone', usedBy: [] },
  { key: 'diffRemovedDimmed', group: 'Diffs', meaning: 'removed line, background tone', usedBy: [] },
  { key: 'diffAddedWord', group: 'Diffs', meaning: 'changed word inside an added line', usedBy: [] },
  { key: 'diffRemovedWord', group: 'Diffs', meaning: 'changed word inside a removed line', usedBy: [] },
]
