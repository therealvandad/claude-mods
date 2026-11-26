// Pure data, validators and cleaners for custom-two. No `$` in here: the tests run all of it without the engine.
import type { Config, LogRow } from '../types'
import { SOUND_FILES } from './sounds'

// ------------------------------------------------------------------ constants

export const PREFIX = 'cx'
/** The one command this mod sends to another mod (the settings mod answers it). */
export const CFG = 'cfg'
export const PANE = 'custom-two-main'
export const MOD = 'custom-two'

/** Theme colour keys a Text may use. The only colours this mod ever draws with. */
export const COLOUR_KEYS = ['success', 'error', 'warning', 'suggestion', 'subtle', 'inactive', 'claude', 'permission', 'remember'] as const
export type ColourKey = (typeof COLOUR_KEYS)[number]

export const TABS = [
  ['look', 'Look'],
  ['theme', 'Theme'],
  ['curves', 'Curves'],
  ['sounds', 'Sounds'],
  ['words', 'Words'],
  ['log', 'Log'],
  ['report', 'Report'],
  ['keys', 'Keys'],
  ['auto', 'Auto'],
  ['run', 'Run'],
  ['lists', 'Lists'],
] as const
export type TabId = (typeof TABS)[number][0]
export const TAB_IDS: readonly string[] = TABS.map(t => t[0])

/** The three guard mods and the settings mod: their messages can never be muted, so no rule of ours names them. */
export const GUARDS: readonly string[] = ['tool-guard', 'safety-pro', 'controls', 'settings']

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,24}$/
export const MOD_RE = /^[a-z0-9][a-z0-9-]{0,40}$/
export const FEATURE_RE = /^[a-z0-9][a-z0-9-]{0,40}\.[a-z0-9][a-z0-9-]{0,40}$/
export const EXT_RE = /^[a-z0-9]{1,8}$/
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const BRANCH_RE = /^[A-Za-z0-9._/@+-]{1,100}$/
export const PATTERN_RE = /^[A-Za-z0-9._/@+-]{1,60}\*?$/
export const TOOL_RE = /^[A-Za-z0-9_]{1,30}$/

export const LIMITS = {
  fileColours: 40,
  branchRules: 20,
  greet: 10,
  tips: 30,
  titles: 20,
  ranges: 12,
  filters: 12,
  searches: 12,
  keys: 20,
  fonts: 5,
  curves: 8,
  sched: 12,
  focus: 8,
  focusSteps: 12,
  rules: 10,
  bundles: 10,
  bundleMods: 20,
  checklist: 20,
  glossary: 100,
  macros: 10,
  macroSteps: 6,
  log: 300,
  runs: 40,
} as const

/** Defaults of the mod's own switches: the same values as features.json (a test compares them). */
export const FEATURE_DEFAULTS: Record<string, boolean> = {
  record: false,
  'file-colours': true,
  'branch-accent': false,
  'event-sounds': false,
  'greet-toast': false,
  'tip-toast': false,
  'demo-motion': false,
  dnd: true,
  'hide-rules': false,
}

export const EVENTS = ['turn-end', 'error', 'commit'] as const
export type SoundEvent = (typeof EVENTS)[number]
export const DEFAULT_SOUNDS: Record<string, string> = { 'turn-end': 'done.wav', error: 'error.wav', commit: 'commit.wav' }

export const CONDITIONS = ['idle', 'busy', 'calm', 'lively', 'night', 'day'] as const
export type Condition = (typeof CONDITIONS)[number]
export const OPPOSITE: Record<Condition, Condition> = { idle: 'busy', busy: 'idle', calm: 'lively', lively: 'calm', night: 'day', day: 'night' }

export const ICON_NAMES = ['ok', 'error', 'warn', 'file', 'branch', 'tip', 'sound', 'clock', 'tick', 'dot'] as const
export const PACKS: Record<string, Record<string, string>> = {
  letters: { ok: 'OK', error: 'ER', warn: '!!', file: 'F', branch: 'B', tip: 'T', sound: 'S', clock: 'C', tick: 'x', dot: '.' },
  symbols: { ok: '✓', error: '✗', warn: '⚠', file: '▤', branch: '⎇', tip: '✦', sound: '♪', clock: '◷', tick: '■', dot: '●' },
  minimal: { ok: '+', error: 'x', warn: '!', file: '-', branch: '/', tip: '*', sound: '~', clock: ':', tick: '#', dot: '.' },
}
export const PACK_IDS = Object.keys(PACKS)

export const DEFAULT_EMPTY: Record<string, string> = {
  look: 'Nothing to colour yet. Turn on custom-two.record, or try /cxfile list.',
  theme: 'No logo colour yet: /cxlogo #e8643c',
  curves: 'No curve picked: /cxcurve easeOut',
  sounds: 'Event sounds are off: /cfg feature custom-two.event-sounds on',
  words: 'No greetings or tips stored.',
  log: 'Nothing recorded. Turn on custom-two.record and use some tools.',
  report: 'No rows to report on in this range and filter.',
  keys: 'No hotkey rows yet: /cxkeys add ctrl+1 <prompt text>',
  auto: 'No schedule, do-not-disturb or hide rules yet.',
  run: 'No macros or focus modes yet: /cxmacro add, /cxfocus add.',
  lists: 'No bundles, steps or terms yet.',
}

// ------------------------------------------------------------------ small text helpers

export const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`)

/** One line of plain text: control characters dropped, runs of blanks collapsed, at most `max` characters. */
export const cleanText = (raw: unknown, max: number): string =>
  typeof raw !== 'string'
    ? ''
    : raw
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

export const pad2 = (n: number): string => String(n).padStart(2, '0')

export const isColour = (v: unknown): v is ColourKey => typeof v === 'string' && (COLOUR_KEYS as readonly string[]).includes(v)

/** `#abc`, `abc`, `#aabbcc` to `#aabbcc` lower case, else null. */
export const normalizeHex = (raw: string): string | null => {
  const s = raw.trim().replace(/^#/, '').toLowerCase()

  if (/^[0-9a-f]{3}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
  }

  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null
}

/** `YYYY-MM-DD` that is a real calendar day, as [y, m, d]; else null. */
export const parseDay = (s: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)

  if (m === null) {
    return null
  }
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))

  return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? [y, mo, d] : null
}

export const minutesOf = (hhmm: string): number => (TIME_RE.test(hhmm) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : -1)

// ------------------------------------------------------------------ the default config and its cleaner

export const DEFAULT_TIPS: readonly string[] = [
  '/cxpane opens the custom-two pane; every tab has a command with the same name.',
  'Saved filters (/cxfilter) and date ranges (/cxrange) shape the Log, Report and export at once.',
  '/cxlogo #e8643c previews a whole theme from one colour; /cxlogo apply sets it once.',
  '/cxsched now tells you which look command fits the time of day. It never applies anything itself.',
  'A macro chains up to six commands: /cxmacro add focus-on cfg feature workbench.band off ; motion off',
  '/cxbundle show <name> prints plugin enable and disable lines. It never runs them.',
]

export const DEFAULT_GREETINGS: readonly string[] = [
  'Good {time}, {name}.',
  'Welcome back, {name}. It is the {time}.',
  'Hello {name}: a calm {time} to build something.',
]

export const DEFAULT_TEMPLATE = 'Calls {calls} · errors {errors} · files {files} · commits {commits}\nSpend {spend} · range {range} · filter {filter} · branch {branch} · {date}'

export const defaultConfig = (): Config => ({
  fileColours: { ts: 'suggestion', tsx: 'suggestion', js: 'warning', jsx: 'warning', json: 'warning', md: 'success', py: 'success', css: 'remember', html: 'claude', sh: 'permission', yml: 'subtle', yaml: 'subtle', lock: 'inactive' },
  branchRules: [
    { pattern: 'main', accent: 'success' },
    { pattern: 'master', accent: 'success' },
    { pattern: 'release/*', accent: 'warning' },
    { pattern: 'hotfix/*', accent: 'error' },
    { pattern: 'feature/*', accent: 'suggestion' },
  ],
  sounds: { ...DEFAULT_SOUNDS },
  greetTemplates: [...DEFAULT_GREETINGS],
  greetName: '',
  tips: [],
  tipCursor: 0,
  tipDay: 0,
  empty: {},
  titles: {},
  ranges: [],
  range: '',
  filters: [],
  filter: '',
  searches: [],
  template: DEFAULT_TEMPLATE,
  keys: {},
  logoHex: '',
  fonts: [],
  icons: {},
  pack: '',
  curves: [],
  curve: 'easeOut',
  sched: [],
  focus: [],
  dnd: { on: false, from: '22:00', to: '07:00', applied: false },
  rules: [],
  hidden: [],
  bundles: [],
  checklist: [],
  glossary: [],
  macros: [],
})

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// ---- one validator per kind of row; each returns the cleaned row or null

export const cleanFileColour = (ext: unknown, colour: unknown): [string, string] | null => {
  const e = typeof ext === 'string' ? ext.trim().toLowerCase().replace(/^\./, '') : ''

  return EXT_RE.test(e) && isColour(colour) ? [e, colour] : null
}

export const cleanBranchRule = (r: unknown): { pattern: string; accent: string } | null =>
  isRecord(r) && typeof r.pattern === 'string' && PATTERN_RE.test(r.pattern) && isColour(r.accent) ? { pattern: r.pattern, accent: r.accent } : null

const PLACEHOLDER_RE = /\{([^}]*)\}/g

/** A greeting template: up to 100 characters, and only {time} and {name} between braces. */
export const cleanGreeting = (raw: unknown): string | null => {
  const s = cleanText(raw, 100)

  if (s === '') {
    return null
  }

  for (const m of s.matchAll(PLACEHOLDER_RE)) {
    if (m[1] !== 'time' && m[1] !== 'name') {
      return null
    }
  }

  return /[{}]/.test(s.replace(/\{(time|name)\}/g, '')) ? null : s
}

export const cleanName = (raw: unknown): string => cleanText(raw, 30).replace(/[^\p{L}\p{N} ._-]/gu, '').trim()

export const cleanRange = (r: unknown): { name: string; start: string; end: string } | null =>
  isRecord(r) &&
  typeof r.name === 'string' &&
  NAME_RE.test(r.name) &&
  typeof r.start === 'string' &&
  typeof r.end === 'string' &&
  parseDay(r.start) !== null &&
  parseDay(r.end) !== null &&
  r.start <= r.end
    ? { name: r.name, start: r.start, end: r.end }
    : null

export const cleanFilter = (r: unknown): { name: string; tool: string; ok: string; ext: string; branch: string } | null => {
  if (!isRecord(r) || typeof r.name !== 'string' || !NAME_RE.test(r.name)) {
    return null
  }
  const tool = typeof r.tool === 'string' ? r.tool : ''
  const ok = typeof r.ok === 'string' ? r.ok : ''
  const ext = typeof r.ext === 'string' ? r.ext : ''
  const branch = typeof r.branch === 'string' ? r.branch : ''

  if ((tool !== '' && !TOOL_RE.test(tool)) || (ok !== '' && ok !== 'ok' && ok !== 'error') || (ext !== '' && !EXT_RE.test(ext)) || (branch !== '' && !BRANCH_RE.test(branch))) {
    return null
  }

  return { name: r.name, tool, ok, ext, branch }
}

export const cleanSearch = (r: unknown): { name: string; text: string } | null => {
  if (!isRecord(r) || typeof r.name !== 'string' || !NAME_RE.test(r.name)) {
    return null
  }
  const text = cleanText(r.text, 60)

  return text === '' ? null : { name: r.name, text }
}

export const TEMPLATE_VARS = ['calls', 'errors', 'files', 'commits', 'spend', 'range', 'filter', 'branch', 'date'] as const

/** A report template: up to 400 characters, and only the known placeholders between braces. */
export const cleanTemplate = (raw: unknown): string | null => {
  if (typeof raw !== 'string') {
    return null
  }
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 400)

  if (s === '') {
    return null
  }

  for (const m of s.matchAll(PLACEHOLDER_RE)) {
    if (!(TEMPLATE_VARS as readonly string[]).includes(m[1] ?? '')) {
      return null
    }
  }

  return s
}

const MODIFIERS = ['ctrl', 'alt', 'shift', 'cmd']

/** `ctrl+1`, `cmd+shift+k`, `f5`: at most three modifiers and one key; lower case. */
export const cleanKey = (raw: unknown): string | null => {
  const parts = typeof raw === 'string' ? raw.trim().toLowerCase().split('+') : []
  const key = parts[parts.length - 1] ?? ''
  const mods = parts.slice(0, -1)

  if (parts.length < 1 || mods.length > 3 || new Set(mods).size !== mods.length || !mods.every(m => MODIFIERS.includes(m))) {
    return null
  }

  return /^([a-z0-9]|f([1-9]|1[0-2]))$/.test(key) && (mods.length > 0 || /^f/.test(key)) ? parts.join('+') : null
}

export const cleanFont = (raw: unknown): string | null => {
  const s = cleanText(raw, 40)

  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(s) ? s : null
}

export const cleanGlyph = (raw: unknown): string | null => {
  const s = typeof raw === 'string' ? raw.trim() : ''
  const n = Array.from(s).length

  // eslint-disable-next-line no-control-regex
  return n >= 1 && n <= 3 && !/[\u0000-\u001f\u007f-\u009f\s]/.test(s) ? s : null
}

export const BUILTIN_CURVES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack', 'easeOutBounce', 'easeOutElastic', 'step'] as const

export const cleanCurve = (r: unknown): { name: string; x1: number; y1: number; x2: number; y2: number } | null => {
  if (!isRecord(r) || typeof r.name !== 'string' || !NAME_RE.test(r.name) || (BUILTIN_CURVES as readonly string[]).map(s => s.toLowerCase()).includes(r.name)) {
    return null
  }
  const n = [r.x1, r.y1, r.x2, r.y2]

  if (!n.every(v => typeof v === 'number' && Number.isFinite(v))) {
    return null
  }
  const [x1, y1, x2, y2] = n as [number, number, number, number]

  return x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1 && y1 >= -1 && y1 <= 2 && y2 >= -1 && y2 <= 2 ? { name: r.name, x1, y1, x2, y2 } : null
}

export const cleanSched = (r: unknown): { at: string; via: string; look: string } | null =>
  isRecord(r) && typeof r.at === 'string' && TIME_RE.test(r.at) && (r.via === 'skuse' || r.via === 'look') && typeof r.look === 'string' && NAME_RE.test(r.look)
    ? { at: r.at, via: r.via, look: r.look }
    : null

export const cleanRule = (r: unknown): { mod: string; cond: string } | null =>
  isRecord(r) && typeof r.mod === 'string' && MOD_RE.test(r.mod) && !GUARDS.includes(r.mod) && typeof r.cond === 'string' && (CONDITIONS as readonly string[]).includes(r.cond)
    ? { mod: r.mod, cond: r.cond }
    : null

export const cleanBundle = (r: unknown): { name: string; mods: string[] } | null => {
  if (!isRecord(r) || typeof r.name !== 'string' || !NAME_RE.test(r.name)) {
    return null
  }
  const mods = [...new Set(asArray(r.mods).filter((m): m is string => typeof m === 'string' && MOD_RE.test(m)))].slice(0, LIMITS.bundleMods)

  return mods.length === 0 ? null : { name: r.name, mods }
}

export const cleanCheck = (r: unknown): { text: string; done: boolean } | null => {
  if (!isRecord(r)) {
    return null
  }
  const text = cleanText(r.text, 100)

  return text === '' ? null : { text, done: r.done === true }
}

export const cleanTerm = (r: unknown): { term: string; meaning: string } | null => {
  if (!isRecord(r)) {
    return null
  }
  const term = cleanText(r.term, 40)
  const meaning = cleanText(r.meaning, 200)

  return term === '' || meaning === '' ? null : { term, meaning }
}

// ---- allow-lists for what this mod may run through $.command.run

/** Closed list of command names a macro may start with: the rest of the name must be empty (`cfg`) or, for `cx`, own commands. */
export const MACRO_ALLOW = ['cfg', 'tidy', 'motion'] as const
/** Own commands a macro may never run: they could loop, run other lists, or wipe data. */
export const MACRO_DENY_OWN = ['cxmacro', 'cxfocus', 'cxreset', 'cxdnd', 'cxrules']

const SAFE_ARGS_RE = /^[A-Za-z0-9 ._:@+=,/#-]{0,80}$/
const CFG_FEATURE_RE = /^feature ([a-z0-9][a-z0-9-]{0,40})\.([a-z0-9][a-z0-9-]{0,40}) (on|off|default)$/
const CFG_PRESET_RE = /^feature (quiet|calm|full|reset)$/
const CFG_LOOK_RE = /^(preset (calm|focus|full)|accent [a-z]{3,12}|density (compact|normal|airy)|icons (letters|symbols|minimal)|calm (on|off))$/

export type StepCheck = { ok: true; command: string; args: string; line: string } | { ok: false; why: string }

/**
 * Whether one macro step may run. Closed list: `cfg` (with a strict argument shape, never naming a guard mod), `tidy`,
 * `motion`, and own `cx*` commands except the ones that could loop. Everything else is refused, always.
 */
export const checkMacroStep = (raw: string): StepCheck => {
  const text = cleanText(raw, 120).replace(/^\//, '')
  const space = text.indexOf(' ')
  const command = (space === -1 ? text : text.slice(0, space)).toLowerCase()
  const args = space === -1 ? '' : text.slice(space + 1).trim()

  if (command === '' || !/^[a-z][a-z0-9-]{0,30}$/.test(command)) {
    return { ok: false, why: 'empty or odd command name' }
  }

  if (!SAFE_ARGS_RE.test(args)) {
    return { ok: false, why: 'arguments use characters this mod does not pass on' }
  }
  const line = `/${command}${args === '' ? '' : ` ${args}`}`

  if (command === 'cfg') {
    const f = CFG_FEATURE_RE.exec(args)

    if (f !== null) {
      return GUARDS.includes(f[1] ?? '') ? { ok: false, why: `${f[1]} is a safety mod: its switches are never changed from here` } : { ok: true, command, args, line }
    }

    return CFG_PRESET_RE.test(args) || CFG_LOOK_RE.test(args) ? { ok: true, command, args, line } : { ok: false, why: 'cfg takes: feature <mod>.<id> on|off|default, feature quiet|calm|full|reset, preset, accent, density, icons, calm' }
  }

  if (command === 'tidy' || command === 'motion') {
    return { ok: true, command, args, line }
  }

  if (command.startsWith(PREFIX) && command.length > PREFIX.length) {
    return MACRO_DENY_OWN.includes(command) ? { ok: false, why: `/${command} cannot run inside a macro` } : { ok: true, command, args, line }
  }

  return { ok: false, why: `/${command} is not on the allow list (cfg, tidy, motion, own ${PREFIX}* commands)` }
}

/** A focus-mode step: only `<mod>.<id> on|off|default` or `quiet|calm|full`, and never a guard mod. */
export const checkFocusStep = (raw: string): StepCheck => {
  const text = cleanText(raw, 80).toLowerCase()
  const f = /^([a-z0-9][a-z0-9-]{0,40})\.([a-z0-9][a-z0-9-]{0,40}) (on|off|default)$/.exec(text)

  if (f !== null) {
    return GUARDS.includes(f[1] ?? '') ? { ok: false, why: `${f[1]} is a safety mod: its switches are never changed from here` } : { ok: true, command: CFG, args: `feature ${text}`, line: `/cfg feature ${text}` }
  }

  if (/^(quiet|calm|full)$/.test(text)) {
    return { ok: true, command: CFG, args: `feature ${text}`, line: `/cfg feature ${text}` }
  }

  return { ok: false, why: 'a step is <mod>.<id> on|off|default, or quiet, calm, full' }
}

export const cleanMacro = (r: unknown): { name: string; steps: string[] } | null => {
  if (!isRecord(r) || typeof r.name !== 'string' || !NAME_RE.test(r.name)) {
    return null
  }
  const steps = asArray(r.steps).filter((s): s is string => typeof s === 'string').map(s => checkMacroStep(s))

  return steps.length === 0 || steps.length > LIMITS.macroSteps || steps.some(s => !s.ok) ? null : { name: r.name, steps: steps.map(s => (s.ok ? s.line : '')) }
}

export const cleanFocus = (r: unknown): { name: string; steps: string[] } | null => {
  if (!isRecord(r) || typeof r.name !== 'string' || !NAME_RE.test(r.name)) {
    return null
  }
  const steps = asArray(r.steps).filter((s): s is string => typeof s === 'string').map(s => checkFocusStep(s))

  return steps.length === 0 || steps.length > LIMITS.focusSteps || steps.some(s => !s.ok) ? null : { name: r.name, steps: steps.map(s => (s.ok ? s.line.replace('/cfg feature ', '') : '')) }
}

export const BUILTIN_FOCUS: readonly { name: string; steps: string[] }[] = [
  { name: 'quiet', steps: ['quiet'] },
  { name: 'calm', steps: ['calm'] },
  { name: 'full', steps: ['full'] },
]

// ---- the whole cleaner

const take = <T>(v: unknown, clean: (x: unknown) => T | null, max: number, key?: (t: T) => string): T[] => {
  const out: T[] = []
  const seen = new Set<string>()

  for (const x of asArray(v)) {
    const c = clean(x)

    if (c !== null && out.length < max && (key === undefined || !seen.has(key(c)))) {
      out.push(c)

      if (key !== undefined) {
        seen.add(key(c))
      }
    }
  }

  return out
}

const takeMap = (v: unknown, clean: (k: string, val: unknown) => [string, string] | null, max: number): Record<string, string> => {
  const out: Record<string, string> = {}
  let n = 0

  if (isRecord(v)) {
    for (const [k, val] of Object.entries(v)) {
      const c = clean(k, val)

      if (c !== null && n < max && !hasOwn(out, c[0])) {
        out[c[0]] = c[1]
        n++
      }
    }
  }

  return out
}

const cleanMessage = (k: string, val: unknown, allowMain: boolean): [string, string] | null => {
  const text = cleanText(val, 120)

  return text !== '' && (TAB_IDS.includes(k) || (allowMain && k === 'main')) ? [k, text] : null
}

/** Turns whatever was stored into a valid Config: every row checked, every list bounded. Never throws. */
export const cleanConfig = (raw: unknown): Config => {
  const d = defaultConfig()

  if (!isRecord(raw)) {
    return d
  }
  const has = (k: string) => hasOwn(raw, k)
  const names = <T extends { name: string }>(xs: T[]) => (n: unknown): string => (typeof n === 'string' && xs.some(x => x.name === n) ? n : '')
  const ranges = take(raw.ranges, cleanRange, LIMITS.ranges, r => r.name)
  const filters = take(raw.filters, cleanFilter, LIMITS.filters, r => r.name)
  const curves = take(raw.curves, cleanCurve, LIMITS.curves, r => r.name)
  const dnd = isRecord(raw.dnd) ? raw.dnd : {}
  const rules = take(raw.rules, cleanRule, LIMITS.rules, r => `${r.mod}/${r.cond}`)
  const sounds: Record<string, string> = { ...DEFAULT_SOUNDS }

  if (isRecord(raw.sounds)) {
    for (const ev of EVENTS) {
      const f = raw.sounds[ev]

      if (f === '' || (typeof f === 'string' && SOUND_FILES.includes(f))) {
        sounds[ev] = f
      }
    }
  }
  const pickName = (v: unknown, builtin: readonly string[], list: { name: string }[]) =>
    typeof v === 'string' && (builtin.includes(v) || list.some(x => x.name === v)) ? v : ''

  return {
    fileColours: has('fileColours')
      ? takeMap(raw.fileColours, (k, v) => cleanFileColour(k, v), LIMITS.fileColours)
      : d.fileColours,
    branchRules: has('branchRules') ? take(raw.branchRules, cleanBranchRule, LIMITS.branchRules, r => r.pattern) : d.branchRules,
    sounds,
    greetTemplates: has('greetTemplates') ? take(raw.greetTemplates, cleanGreeting, LIMITS.greet, s => s) : d.greetTemplates,
    greetName: cleanName(raw.greetName),
    tips: take(raw.tips, x => (cleanText(x, 140) === '' ? null : cleanText(x, 140)), LIMITS.tips, s => s),
    tipCursor: typeof raw.tipCursor === 'number' && Number.isInteger(raw.tipCursor) && raw.tipCursor >= 0 && raw.tipCursor < 10000 ? raw.tipCursor : 0,
    tipDay: typeof raw.tipDay === 'number' && Number.isInteger(raw.tipDay) && raw.tipDay >= 0 && raw.tipDay < 1e6 ? raw.tipDay : 0,
    empty: takeMap(raw.empty, (k, v) => cleanMessage(k, v, false), LIMITS.titles),
    titles: takeMap(raw.titles, (k, v) => cleanMessage(k, v, true), LIMITS.titles),
    ranges,
    range: pickName(raw.range, ['today', 'week'], ranges),
    filters,
    filter: names(filters)(raw.filter),
    searches: take(raw.searches, cleanSearch, LIMITS.searches, r => r.name),
    template: has('template') ? (cleanTemplate(raw.template) ?? d.template) : d.template,
    keys: takeMap(raw.keys, (k, v) => {
      const key = cleanKey(k)
      const text = cleanText(v, 200)

      return key !== null && text !== '' ? [key, text] : null
    }, LIMITS.keys),
    logoHex: typeof raw.logoHex === 'string' ? (normalizeHex(raw.logoHex) ?? '') : '',
    fonts: take(raw.fonts, cleanFont, LIMITS.fonts, s => s),
    icons: takeMap(raw.icons, (k, v) => {
      const g = cleanGlyph(v)

      return (ICON_NAMES as readonly string[]).includes(k) && g !== null ? [k, g] : null
    }, ICON_NAMES.length),
    pack: typeof raw.pack === 'string' && PACK_IDS.includes(raw.pack) ? raw.pack : '',
    curves,
    curve: pickName(raw.curve, BUILTIN_CURVES, curves) || d.curve,
    sched: take(raw.sched, cleanSched, LIMITS.sched, r => r.at),
    focus: take(raw.focus, cleanFocus, LIMITS.focus, r => r.name),
    dnd: {
      on: dnd.on === true,
      from: typeof dnd.from === 'string' && TIME_RE.test(dnd.from) ? dnd.from : d.dnd.from,
      to: typeof dnd.to === 'string' && TIME_RE.test(dnd.to) ? dnd.to : d.dnd.to,
      applied: dnd.applied === true,
    },
    rules,
    hidden: [...new Set(asArray(raw.hidden).filter((m): m is string => typeof m === 'string' && MOD_RE.test(m) && !GUARDS.includes(m)))].slice(0, LIMITS.rules),
    bundles: take(raw.bundles, cleanBundle, LIMITS.bundles, r => r.name),
    checklist: take(raw.checklist, cleanCheck, LIMITS.checklist),
    glossary: take(raw.glossary, cleanTerm, LIMITS.glossary, r => r.term.toLowerCase()),
    macros: take(raw.macros, cleanMacro, LIMITS.macros, r => r.name),
  }
}

// ------------------------------------------------------------------ icons, file colours, branch accent

/** The glyph for an icon name: the user's own row, else the active pack (own choice, else the settings mod's style). */
export const iconOf = (cfg: Config, name: string, settingsIcons: string): string => {
  const own = hasOwn(cfg.icons, name) ? cfg.icons[name] : undefined
  const pack = PACKS[cfg.pack !== '' ? cfg.pack : settingsIcons] ?? PACKS.symbols

  return own ?? pack?.[name] ?? '?'
}

export const extOf = (file: string): string => {
  const base = file.split('/').pop() ?? ''
  const i = base.lastIndexOf('.')

  return i > 0 && i < base.length - 1 ? base.slice(i + 1).toLowerCase() : ''
}

/** The theme colour for a file name; undefined (no colour) when the extension has no row. */
export const colourOfFile = (cfg: Config, file: string): ColourKey | undefined => {
  const ext = extOf(file)
  const c = ext !== '' && hasOwn(cfg.fileColours, ext) ? cfg.fileColours[ext] : undefined

  return isColour(c) ? c : undefined
}

/** First rule that matches: an exact name, or a prefix when the pattern ends in `*`. */
export const accentOfBranch = (cfg: Config, branch: string): ColourKey | undefined => {
  for (const r of cfg.branchRules) {
    const hit = r.pattern.endsWith('*') ? branch.startsWith(r.pattern.slice(0, -1)) : branch === r.pattern

    if (hit && isColour(r.accent)) {
      return r.accent
    }
  }

  return undefined
}

/** `git rev-parse --abbrev-ref HEAD` output to a branch name, or '' when it is not a plain one. */
export const parseBranch = (stdout: string): string => {
  const s = stdout.trim().split('\n')[0]?.trim() ?? ''

  return BRANCH_RE.test(s) ? s : ''
}

// ------------------------------------------------------------------ greetings and tips

export const dayWord = (hour: number): string => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night')

export const renderGreeting = (tpl: string, hour: number, name: string): string => tpl.replace(/\{time\}/g, dayWord(hour)).replace(/\{name\}/g, name === '' ? 'there' : name)

/** Day number since the epoch in local time, for "once a day" checks and rotation. */
export const dayNumber = (ms: number): number => {
  const d = new Date(ms)

  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}

export const pickByDay = <T>(list: readonly T[], ms: number): T | undefined => (list.length === 0 ? undefined : list[dayNumber(ms) % list.length])

export const allTips = (cfg: Config): string[] => [...DEFAULT_TIPS, ...cfg.tips]

// ------------------------------------------------------------------ the recorded log: views, searches, reports, exports

export const toRow = (at: number, tool: string, ok: boolean, input: Record<string, unknown>, branch: string): LogRow => {
  const file = cleanText(input.file_path ?? input.notebook_path ?? '', 120)
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  const first = /^[A-Za-z0-9._/-]{1,30}/.exec(command)?.[0] ?? ''
  const isBash = tool === 'Bash'
  const isCommit = isBash && /^git(\s+-[^\s]+)*\s+commit(\s|$)/.test(command)

  return { at, tool: cleanText(tool, 30), ok, detail: isBash ? clip(first, 30) : '', file, branch: BRANCH_RE.test(branch) ? branch : '', commit: isCommit && ok }
}

export const cleanRow = (r: unknown): LogRow | null =>
  isRecord(r) && typeof r.at === 'number' && Number.isFinite(r.at) && typeof r.tool === 'string' && r.tool !== '' && typeof r.ok === 'boolean'
    ? {
        at: r.at,
        tool: cleanText(r.tool, 30),
        ok: r.ok,
        detail: cleanText(r.detail, 30),
        file: cleanText(r.file, 120),
        branch: typeof r.branch === 'string' && BRANCH_RE.test(r.branch) ? r.branch : '',
        commit: r.commit === true,
      }
    : null

export const cleanLog = (raw: unknown): LogRow[] => take(raw, cleanRow, LIMITS.log).slice(-LIMITS.log)

export const pushRow = (log: readonly LogRow[], row: LogRow): LogRow[] => [...log, row].slice(-LIMITS.log)

/** [from, to] in epoch ms for a range name (`today`, `week`, or a stored range), in local time; null for no range. */
export const rangeBounds = (cfg: Config, name: string, now: number): [number, number] | null => {
  if (name === 'today') {
    const d = new Date(now)

    return [new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), now]
  }

  if (name === 'week') {
    return [now - 7 * 86400000, now]
  }
  const r = cfg.ranges.find(x => x.name === name)
  const s = r === undefined ? null : parseDay(r.start)
  const e = r === undefined ? null : parseDay(r.end)

  return s === null || e === null ? null : [new Date(s[0], s[1] - 1, s[2]).getTime(), new Date(e[0], e[1] - 1, e[2], 23, 59, 59, 999).getTime()]
}

export const inRange = (row: LogRow, bounds: [number, number] | null): boolean => bounds === null || (row.at >= bounds[0] && row.at <= bounds[1])

export type Filter = { tool: string; ok: string; ext: string; branch: string }

export const matchesFilter = (row: LogRow, f: Filter | undefined): boolean =>
  f === undefined ||
  ((f.tool === '' || row.tool === f.tool) && (f.ok === '' || (f.ok === 'ok') === row.ok) && (f.ext === '' || extOf(row.file) === f.ext) && (f.branch === '' || row.branch === f.branch))

/** The rows the active range and filter let through, newest last. */
export const viewOf = (log: readonly LogRow[], cfg: Config, now: number): LogRow[] => {
  const bounds = cfg.range === '' ? null : rangeBounds(cfg, cfg.range, now)
  const f = cfg.filters.find(x => x.name === cfg.filter)

  return log.filter(r => inRange(r, bounds) && matchesFilter(r, f))
}

/** Substring search (case-insensitive) over tool, detail and file of at most the last 300 rows. */
export const searchRows = (rows: readonly LogRow[], text: string): LogRow[] => {
  const q = text.trim().toLowerCase()

  return q === '' ? [] : rows.slice(-LIMITS.log).filter(r => `${r.tool} ${r.detail} ${r.file}`.toLowerCase().includes(q))
}

export type Stats = { calls: number; errors: number; files: number; commits: number }

export const statsOf = (rows: readonly LogRow[]): Stats => ({
  calls: rows.length,
  errors: rows.filter(r => !r.ok).length,
  files: new Set(rows.filter(r => r.file !== '').map(r => r.file)).size,
  commits: rows.filter(r => r.commit).length,
})

export const money = (usd: number): string => `$${(Number.isFinite(usd) && usd > 0 ? usd : 0).toFixed(2)}`

export const dateText = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Fills the known placeholders; an unknown `{word}` is left as typed. Rendered as text only, never written anywhere. */
export const renderTemplate = (tpl: string, vars: Record<string, string>): string => tpl.replace(/\{([a-z]+)\}/g, (all, k: string) => (hasOwn(vars, k) ? (vars[k] ?? all) : all))

export const reportVars = (rows: readonly LogRow[], cfg: Config, usd: number, branch: string, now: number): Record<string, string> => {
  const s = statsOf(rows)

  return {
    calls: String(s.calls),
    errors: String(s.errors),
    files: String(s.files),
    commits: String(s.commits),
    spend: money(usd),
    range: cfg.range === '' ? 'all' : cfg.range,
    filter: cfg.filter === '' ? 'none' : cfg.filter,
    branch: branch === '' ? 'unknown' : branch,
    date: dateText(now),
  }
}

export const EXPORT_FORMATS = ['csv', 'md', 'json'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

const COLS = ['time', 'tool', 'ok', 'detail', 'file', 'branch', 'commit'] as const

const cellsOf = (r: LogRow): string[] => [new Date(r.at).toISOString(), r.tool, r.ok ? 'ok' : 'error', r.detail, r.file, r.branch, r.commit ? 'yes' : '']

/** One CSV cell: quoted when needed, and a leading = + - @ is neutralised so a spreadsheet cannot run it as a formula. */
export const csvCell = (s: string): string => {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s

  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const mdCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** The rows as CSV, Markdown or JSON text (at most `limit` rows, newest last). Text only: nothing is written anywhere. */
export const exportRows = (rows: readonly LogRow[], format: ExportFormat, limit = 300): string => {
  const slice = rows.slice(-limit)

  if (format === 'json') {
    return JSON.stringify(slice.map(r => Object.fromEntries(COLS.map((c, i) => [c, cellsOf(r)[i]]))), null, 2)
  }

  if (format === 'md') {
    return [`| ${COLS.join(' | ')} |`, `| ${COLS.map(() => '---').join(' | ')} |`, ...slice.map(r => `| ${cellsOf(r).map(mdCell).join(' | ')} |`)].join('\n')
  }

  return [COLS.join(','), ...slice.map(r => cellsOf(r).map(csvCell).join(','))].join('\n')
}

// ------------------------------------------------------------------ the look schedule

/** The entry in force at `minutes` past midnight: the latest one at or before it, else yesterday's last one. */
export const schedNow = (sched: readonly { at: string; via: string; look: string }[], minutes: number): { at: string; via: string; look: string } | undefined => {
  const sorted = [...sched].sort((a, b) => minutesOf(a.at) - minutesOf(b.at))
  const before = sorted.filter(s => minutesOf(s.at) <= minutes)

  return before[before.length - 1] ?? sorted[sorted.length - 1]
}

// ------------------------------------------------------------------ do-not-disturb and rules

/** Whether `minutes` falls in the window from..to, which may cross midnight. from == to means never. */
export const inWindow = (minutes: number, from: string, to: string): boolean => {
  const a = minutesOf(from)
  const b = minutesOf(to)

  if (a < 0 || b < 0 || a === b) {
    return false
  }

  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b
}

export type DndStep = { args: 'feature quiet' | 'feature full' } | null

/** What the five-minute check should do now: quiet on entering the window, full on leaving it, only for what this mod applied. */
export const dndStep = (dnd: { on: boolean; from: string; to: string; applied: boolean }, minutes: number): DndStep => {
  if (!dnd.on) {
    return null
  }
  const inside = inWindow(minutes, dnd.from, dnd.to)

  if (inside && !dnd.applied) {
    return { args: 'feature quiet' }
  }

  return !inside && dnd.applied ? { args: 'feature full' } : null
}

export type Ctx = { busy: boolean; calm: boolean; minutes: number }

/** Whether a condition holds. `night` is 22:00 to 07:00. */
export const holds = (cond: string, ctx: Ctx): boolean =>
  cond === 'idle' ? !ctx.busy : cond === 'busy' ? ctx.busy : cond === 'calm' ? ctx.calm : cond === 'lively' ? !ctx.calm : cond === 'night' ? inWindow(ctx.minutes, '22:00', '07:00') : cond === 'day' ? !inWindow(ctx.minutes, '22:00', '07:00') : false

/** The mods that should be hidden right now: one with any rule whose condition holds. */
export const desiredHidden = (rules: readonly { mod: string; cond: string }[], ctx: Ctx): string[] => [...new Set(rules.filter(r => holds(r.cond, ctx)).map(r => r.mod))]

export type RuleStep = { mod: string; args: string }

/** The `/cfg feature <mod>.band ...` calls needed to go from what is hidden to what should be. `off` to hide, `on` to restore. */
export const ruleSteps = (hidden: readonly string[], want: readonly string[]): RuleStep[] => [
  ...want.filter(m => !hidden.includes(m)).map(m => ({ mod: m, args: `feature ${m}.band off` })),
  ...hidden.filter(m => !want.includes(m)).map(m => ({ mod: m, args: `feature ${m}.band on` })),
]

/** The exact shape every run of `cfg` from this mod must have: used by the tests as the one allow-list. */
export const isAllowedRun = (command: string, args: string): boolean => {
  if (command === 'cfg') {
    const f = CFG_FEATURE_RE.exec(args)

    return (f !== null && !GUARDS.includes(f[1] ?? '')) || CFG_PRESET_RE.test(args) || CFG_LOOK_RE.test(args)
  }

  return checkMacroStep(`${command} ${args}`).ok
}

/** Whether a `$.command.run` answer means the command did not do its job. */
export const looksFailed = (text: string | undefined): boolean => {
  const t = (text ?? '').trim().toLowerCase()

  return /^(no switch|no mod|usage|unknown|could not|cannot|can't|not |refused|error|invalid)/.test(t) || t.includes('cannot be changed') || t.includes('is refused')
}
