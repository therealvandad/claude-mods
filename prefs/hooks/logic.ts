// Pure logic of the prefs mod: planning a change, layers, history and undo, export and import, profiles, the auto schedule,
// preview lines and the help text. Nothing here touches the engine, the disk or the network; register.tsx wires it up.
import { ctxFrom, displayPath, formatDate, formatDateTime, formatMoney, formatNumber, formatSize, formatTime, relativeTime, shortNumber, truncate, weekOrder, zoneLabel } from './format'
import {
  MAX_IMPORT_CHARS,
  MAX_OVERRIDES,
  acceptText,
  applyChanges,
  changeLine,
  checkTyped,
  crossCheck,
  diffOver,
  nearKeys,
  parseValue,
  sanitizeOverrides,
  searchPrefs,
  showValue,
  specFor,
  valueOf,
  withValue,
} from './prefs'
import type { Change, Over, PrefSpec, Val } from './prefs'
import type { Group } from './table'

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

// ------------------------------------------------------------------ commands

export const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['pf', 'Help: every prefs command in one line each; opens the Preferences pane', ''],
  ['pfset', 'Set one preference: /pfset <key> <value> (key with no value shows what it accepts)', '<key> <value>'],
  ['pfget', 'Show one preference, or a summary, or search by words: /pfget [key or words]', '[key]'],
  ['pfreset', 'Back to default: /pfreset <key> | /pfreset (all) | /pfreset history | /pfreset everything confirm', '[key]'],
  ['pfexport', 'Show your preferences as a JSON block (never written to a file)', ''],
  ['pfimport', 'Check pasted JSON and show what would change: /pfimport <json>, then /pfimport confirm', '<json>'],
  ['pfundo', 'Undo the last change: /pfundo | /pfundo <n> | /pfundo list (last 30 changes are kept)', '[n|list]'],
  ['pfproject', 'Per-project and per-branch layers: /pfproject [show|set|unset|clear|branch ...|refresh]', '[show|set|unset|clear|branch|refresh]'],
  ['pfprofile', 'Named bundles: /pfprofile save <name> | use <name> | list | del <name>', 'save|use|list|del [name]'],
  ['pfauto', 'Profile by time of day: /pfauto on|off|status|add HH:MM <profile>|rm HH:MM (default off)', 'on|off|status|add|rm'],
  ['pfmods', 'Searchable mod list with the /cfg feature line for each switch: /pfmods [words]', '[words]'],
]

// ------------------------------------------------------------------ planning a change

export type SetPlan = { ok: true; next: Over; changes: Change[]; notes: string[] } | { ok: false; message: string }

/** The decimal separator `dec` needs a different group separator; this picks the usual partner. */
const partnerGroup = (decToken: string): string => (decToken === 'comma' ? 'dot' : 'comma')

/** Set a typed value on a layer's overrides. `keepDefaults` is for the project and branch layers. */
export const planValue = (over: Over, spec: PrefSpec, value: Val, keepDefaults = false): SetPlan => {
  const checked = checkTyped(spec, value)

  if (!checked.ok) {
    return { ok: false, message: checked.message }
  }
  let next = withValue(over, spec, checked.value, keepDefaults)
  const notes: string[] = []

  if (!keepDefaults && crossCheck(next).length > 0) {
    if (spec.key === 'num.decimal') {
      const group = specFor('num.group')!
      next = withValue(next, group, partnerGroup(String(checked.value)))
      notes.push(`num.group changed to ${String(valueOf(next, 'num.group'))} so it differs from the decimal separator.`)
    } else {
      return { ok: false, message: crossCheck(next)[0]! }
    }
  }

  if (Object.keys(next).length > MAX_OVERRIDES) {
    return { ok: false, message: `At most ${MAX_OVERRIDES} preferences can be changed at once; reset some first.` }
  }

  return { ok: true, next, changes: diffOver(over, next), notes }
}

/** Set from text, as /pfset does. */
export const planSet = (over: Over, key: string, raw: string, keepDefaults = false): SetPlan => {
  const k = key.trim().toLowerCase()
  const spec = specFor(k)

  if (spec === undefined) {
    const near = nearKeys(k)

    return { ok: false, message: `No preference named "${k.slice(0, 40)}".${near.length > 0 ? ` Closest: ${near.join(', ')}.` : ''} /pfget <words> searches.` }
  }
  const parsed = parseValue(spec, raw)

  return parsed.ok ? planValue(over, spec, parsed.value, keepDefaults) : { ok: false, message: parsed.message }
}

/** Split "key rest of line" into its two parts. */
export const splitWord = (args: string): [string, string] => {
  const t = args.trim()
  const i = t.search(/\s/)

  return i === -1 ? [t, ''] : [t.slice(0, i), t.slice(i).trim()]
}

// ------------------------------------------------------------------ layers: global, project, branch

export type Layer = 'base' | 'project' | 'branch'
export type Layers = { projects: Record<string, Over>; branches: Record<string, Over> }
export const LAYER_CAP = 30
export const EMPTY_LAYERS: Layers = { projects: {}, branches: {} }
/** Keys that only the global layer may hold (the scope decision itself cannot depend on a layer). */
export const GLOBAL_ONLY: readonly string[] = ['sync.mode']

export const branchKey = (cwd: string, branch: string): string => `${cwd}#${branch}`
export const isScopeText = (s: unknown, max = 300): s is string => typeof s === 'string' && s.length > 0 && s.length <= max && !/[\u0000-\u001f]/.test(s)
export const isBranchText = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9._/-]{1,80}$/.test(s) && s !== 'HEAD'

const cleanLayer = (raw: unknown): Over => {
  const o = sanitizeOverrides(raw, true)

  for (const k of GLOBAL_ONLY) {
    delete o[k]
  }

  return o
}

const cleanMap = (raw: unknown): Record<string, Over> => {
  const out: Record<string, Over> = {}

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out
  }

  for (const k of Object.keys(raw).slice(0, LAYER_CAP * 2)) {
    const layer = cleanLayer((raw as Record<string, unknown>)[k])

    if (isScopeText(k, 400) && Object.keys(layer).length > 0 && Object.keys(out).length < LAYER_CAP) {
      out[k] = layer
    }
  }

  return out
}

export const sanitizeLayers = (raw: unknown): Layers => {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

  return { projects: cleanMap(r['projects']), branches: cleanMap(r['branches']) }
}

export const layerOver = (layers: Layers, layer: Exclude<Layer, 'base'>, scope: string): Over => {
  const map = layer === 'project' ? layers.projects : layers.branches

  return hasOwn(map, scope) ? (map[scope] as Over) : {}
}

/** The layers with one layer's overrides replaced (removed when empty); the newest scope goes last, the oldest drops past the cap. */
export const withLayer = (layers: Layers, layer: Exclude<Layer, 'base'>, scope: string, over: Over): Layers => {
  const key = layer === 'project' ? 'projects' : 'branches'
  const map = { ...layers[key] }
  delete map[scope]

  if (Object.keys(over).length > 0) {
    map[scope] = over
  }
  const keys = Object.keys(map)
  const kept: Record<string, Over> = {}

  for (const k of keys.slice(-LAYER_CAP)) {
    kept[k] = map[k] as Over
  }

  return { ...layers, [key]: kept }
}

export type LayerFlags = { project: boolean; branch: boolean }

/**
 * What other mods read: the global overrides, with the project and then the branch layer on top, but only while the
 * global `sync.mode` is per-project (and each layer's own switch is on). Defaults are dropped again at the end.
 */
export const effectiveOver = (base: Over, layers: Layers, cwd: string, branch: string, flags: LayerFlags): Over => {
  if (valueOf(base, 'sync.mode') !== 'per-project') {
    return { ...base }
  }
  const merged: Over = { ...base }

  const stack = (over: Over) => {
    for (const k of Object.keys(over)) {
      if (!GLOBAL_ONLY.includes(k)) {
        merged[k] = over[k] as Val
      }
    }
  }

  if (flags.project && cwd !== '') {
    stack(layerOver(layers, 'project', cwd))
  }

  if (flags.branch && cwd !== '' && branch !== '') {
    stack(layerOver(layers, 'branch', branchKey(cwd, branch)))
  }

  return sanitizeOverrides(merged)
}

/** Which layer decides a key right now: branch, project or global (and 'default' when nobody set it). */
export const sourceOf = (key: string, base: Over, layers: Layers, cwd: string, branch: string, flags: LayerFlags): 'branch' | 'project' | 'base' | 'default' => {
  if (valueOf(base, 'sync.mode') === 'per-project') {
    if (flags.branch && branch !== '' && hasOwn(layerOver(layers, 'branch', branchKey(cwd, branch)), key)) {
      return 'branch'
    }

    if (flags.project && hasOwn(layerOver(layers, 'project', cwd), key)) {
      return 'project'
    }
  }

  return hasOwn(base, key) ? 'base' : 'default'
}

// ------------------------------------------------------------------ history and undo

export const HISTORY_MAX = 30
export const MAX_CHANGES_PER_ENTRY = 250
export type HistEntry = { at: number; label: string; layer: Layer; scope: string; changes: Change[] }

export const makeEntry = (at: number, label: string, layer: Layer, scope: string, changes: Change[]): HistEntry => ({
  at,
  label: label.slice(0, 80),
  layer,
  scope: scope.slice(0, 400),
  changes: changes.slice(0, MAX_CHANGES_PER_ENTRY),
})

export const pushHistory = (list: readonly HistEntry[], entry: HistEntry): HistEntry[] => [...list, entry].slice(-HISTORY_MAX)

const cleanChange = (raw: unknown): Change | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined
  }
  const r = raw as Record<string, unknown>
  const spec = specFor(r['key'])

  if (spec === undefined) {
    return undefined
  }
  const side = (v: unknown): Val | null | undefined => {
    if (v === null) {
      return null
    }
    const c = checkTyped(spec, v)

    return c.ok ? c.value : undefined
  }
  const before = side(r['before'])
  const after = side(r['after'])

  return before === undefined || after === undefined ? undefined : { key: spec.key, before, after }
}

export const sanitizeHistory = (raw: unknown): HistEntry[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: HistEntry[] = []

  for (const item of raw.slice(-HISTORY_MAX)) {
    const r = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    const layer = r['layer']
    const changes = Array.isArray(r['changes']) ? (r['changes'] as unknown[]).slice(0, MAX_CHANGES_PER_ENTRY).map(cleanChange).filter((c): c is Change => c !== undefined) : []

    if (
      typeof r['at'] === 'number' &&
      Number.isFinite(r['at']) &&
      typeof r['label'] === 'string' &&
      (layer === 'base' || layer === 'project' || layer === 'branch') &&
      typeof r['scope'] === 'string' &&
      changes.length > 0
    ) {
      out.push(makeEntry(r['at'], r['label'], layer, r['scope'], changes))
    }
  }

  return out
}

/** Undo the newest `count` entries, newest first. Pure: returns the new base and layers and the entries that were undone. */
export const undoEntries = (base: Over, layers: Layers, history: readonly HistEntry[], count: number): { base: Over; layers: Layers; history: HistEntry[]; undone: HistEntry[] } => {
  const n = Math.max(0, Math.min(Math.floor(count), history.length))
  const undone = history.slice(history.length - n).reverse()
  let b = base
  let l = layers

  for (const e of undone) {
    if (e.layer === 'base') {
      b = sanitizeOverrides(applyChanges(b, e.changes, 'back'))
    } else {
      l = withLayer(l, e.layer, e.scope, cleanLayer(applyChanges(layerOver(l, e.layer, e.scope), e.changes, 'back')))
    }
  }

  return { base: b, layers: l, history: history.slice(0, history.length - n), undone }
}

// ------------------------------------------------------------------ export and import

export const EXPORT_FORMAT = 'prefs-1'

/** The JSON a person can copy: only the global overrides, sorted by key. */
export const exportText = (base: Over): string => {
  const keys = Object.keys(sanitizeOverrides(base)).sort()
  const prefs: Over = {}

  for (const k of keys) {
    prefs[k] = base[k] as Val
  }

  return JSON.stringify({ format: EXPORT_FORMAT, prefs }, null, 2)
}

export type ImportResult = { ok: true; over: Over } | { ok: false; errors: string[] }

const unfence = (text: string): string => {
  const t = text.trim()
  const m = /^```[a-z]*\s*\n?([\s\S]*?)\n?```$/.exec(t)

  return (m === null ? t : (m[1] ?? '')).trim()
}

/** Strict: the exact format, known keys, exact types and ranges, no unknown top-level fields. Reports up to eight errors. */
export const parseImport = (text: string): ImportResult => {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, errors: ['Nothing to import: paste the JSON after /pfimport.'] }
  }

  if (text.length > MAX_IMPORT_CHARS) {
    return { ok: false, errors: [`Too long: at most ${MAX_IMPORT_CHARS} characters.`] }
  }
  let data: unknown

  try {
    data = JSON.parse(unfence(text))
  } catch {
    return { ok: false, errors: ['Not valid JSON.'] }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['Expected a JSON object like {"format":"prefs-1","prefs":{...}}.'] }
  }
  const top = data as Record<string, unknown>
  const errors: string[] = []

  for (const k of Object.keys(top)) {
    if (k !== 'format' && k !== 'prefs') {
      errors.push(`Unknown field "${k.slice(0, 30)}": only "format" and "prefs" are allowed.`)
    }
  }

  if (top['format'] !== EXPORT_FORMAT) {
    errors.push(`"format" must be "${EXPORT_FORMAT}".`)
  }
  const prefs = top['prefs']

  if (typeof prefs !== 'object' || prefs === null || Array.isArray(prefs)) {
    errors.push('"prefs" must be an object of key: value.')

    return { ok: false, errors: errors.slice(0, 8) }
  }
  const keys = Object.keys(prefs)

  if (keys.length > MAX_OVERRIDES) {
    errors.push(`Too many preferences: at most ${MAX_OVERRIDES}.`)
  }
  const over: Over = {}

  for (const key of keys.slice(0, MAX_OVERRIDES)) {
    const spec = specFor(key)

    if (spec === undefined) {
      errors.push(`Unknown preference "${key.slice(0, 40)}".`)
      continue
    }
    const c = checkTyped(spec, (prefs as Record<string, unknown>)[key])

    if (c.ok) {
      over[key] = c.value
    } else {
      errors.push(c.message)
    }
  }
  errors.push(...crossCheck(over))

  if (errors.length > 0) {
    return { ok: false, errors: errors.slice(0, 8).concat(errors.length > 8 ? [`...and ${errors.length - 8} more.`] : []) }
  }

  return { ok: true, over: sanitizeOverrides(over) }
}

export const diffText = (changes: readonly Change[], max = 14): string[] => [
  ...changes.slice(0, max).map(c => `  ${changeLine(c)}`),
  ...(changes.length > max ? [`  ...and ${changes.length - max} more`] : []),
]

// ------------------------------------------------------------------ profiles

export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,23}$/
export const MAX_PROFILES = 12

/** What a profile never holds: your language, zone, week, money, date, time, number and unit settings, and the scope mode. */
export const LOCALE_KEYS: readonly string[] = [
  'lang', 'week.start', 'tz.mode', 'tz.offset', 'sync.mode', 'money.symbol', 'money.rate', 'money.cents', 'time.hours', 'date.format', 'num.decimal', 'num.group', 'size.units',
]

export const BUILTIN_PROFILES: Readonly<Record<string, Over>> = {
  work: { 'toast.ms': 3000, 'motion.level': 'subtle', 'anim.entrance': false, 'tip.delay': 600, 'rows.page': 30, 'trunc.len': 80, 'volume.ui': 30, 'volume.ambient': 0 },
  home: { level: 'everything', 'toast.ms': 6000, 'notify.tips': true, 'notify.updates': true, 'volume.ambient': 70, 'chart.labels': true, 'tip.delay': 200 },
  demo: { level: 'simple', 'num.short': true, 'tiles.compact': true, 'trunc.len': 40, 'path.style': 'short', 'toast.ms': 8000, 'chart.labels': true, 'chart.legend': 'right', 'anim.speed': 0.75, 'rows.page': 10 },
}

export const isBuiltinProfile = (name: string): boolean => hasOwn(BUILTIN_PROFILES, name)

export const splitLocale = (over: Over): { locale: Over; style: Over } => {
  const locale: Over = {}
  const style: Over = {}

  for (const k of Object.keys(over)) {
    ;(LOCALE_KEYS.includes(k) ? locale : style)[k] = over[k] as Val
  }

  return { locale, style }
}

export const sanitizeProfiles = (raw: unknown): Record<string, Over> => {
  const out: Record<string, Over> = {}

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out
  }

  for (const name of Object.keys(raw).slice(0, MAX_PROFILES * 2)) {
    if (PROFILE_NAME_RE.test(name) && !isBuiltinProfile(name) && Object.keys(out).length < MAX_PROFILES) {
      out[name] = splitLocale(sanitizeOverrides((raw as Record<string, unknown>)[name])).style
    }
  }

  return out
}

export const profileNames = (user: Record<string, Over>): string[] => [...Object.keys(BUILTIN_PROFILES), ...Object.keys(user).sort()]

export const findProfile = (name: string, user: Record<string, Over>): Over | undefined =>
  hasOwn(BUILTIN_PROFILES, name) ? BUILTIN_PROFILES[name] : hasOwn(user, name) ? user[name] : undefined

/** The global overrides after using a profile: your locale settings stay, everything else becomes the bundle. */
export const applyProfile = (base: Over, bundle: Over): Over => sanitizeOverrides({ ...splitLocale(base).locale, ...splitLocale(bundle).style })

/** True when the current overrides still equal the profile's bundle (apart from the locale settings). */
export const matchesProfile = (base: Over, bundle: Over): boolean => diffOver(splitLocale(base).style, splitLocale(bundle).style).length === 0

// ------------------------------------------------------------------ the auto schedule

export type Slot = { at: string; profile: string }
export const MAX_SLOTS = 6
export type AutoState = { on: boolean; schedule: Slot[]; last: string }

export const parseHM = (text: string): number | null => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim())

  return m === null ? null : Number(m[1]) * 60 + Number(m[2])
}

export const hmText = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

export const sanitizeSchedule = (raw: unknown): Slot[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const byTime = new Map<number, Slot>()

  for (const item of raw.slice(0, MAX_SLOTS * 2)) {
    const r = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    const at = typeof r['at'] === 'string' ? parseHM(r['at']) : null
    const profile = r['profile']

    if (at !== null && typeof profile === 'string' && PROFILE_NAME_RE.test(profile) && byTime.size < MAX_SLOTS) {
      byTime.set(at, { at: hmText(at), profile })
    }
  }

  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1])
}

export const sanitizeAuto = (raw: unknown): AutoState => {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

  return { on: r['on'] === true, schedule: sanitizeSchedule(r['schedule']), last: typeof r['last'] === 'string' ? r['last'].slice(0, 60) : '' }
}

/** The slot in force at this minute of the day: the latest one that has started, else yesterday's last one. */
export const slotFor = (schedule: readonly Slot[], minute: number): Slot | undefined => {
  let hit: Slot | undefined

  for (const s of schedule) {
    const m = parseHM(s.at)

    if (m !== null && m <= minute) {
      hit = s
    }
  }

  return hit ?? schedule[schedule.length - 1]
}

export const slotId = (s: Slot): string => `${s.at}|${s.profile}`

export const withSlot = (schedule: readonly Slot[], at: string, profile: string): Slot[] => {
  const m = parseHM(at)

  return m === null ? [...schedule] : sanitizeSchedule([...schedule.filter(s => parseHM(s.at) !== m), { at: hmText(m), profile }])
}

export const withoutSlot = (schedule: readonly Slot[], at: string): Slot[] => {
  const m = parseHM(at)

  return schedule.filter(s => parseHM(s.at) !== m)
}

// ------------------------------------------------------------------ small stored values

export type Meta = { applied: string; lastTab: string }

export const sanitizeMeta = (raw: unknown, tabs: readonly string[]): Meta => {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const applied = typeof r['applied'] === 'string' && (PROFILE_NAME_RE.test(r['applied']) || r['applied'] === '') ? r['applied'] : ''
  const lastTab = typeof r['lastTab'] === 'string' && tabs.includes(r['lastTab']) ? r['lastTab'] : ''

  return { applied, lastTab }
}

export const paginate = (total: number, perPage: number, page: number): { start: number; end: number; pages: number; page: number } => {
  const per = Math.max(1, Math.floor(perPage))
  const pages = Math.max(1, Math.ceil(total / per))
  const p = Math.min(Math.max(0, Math.floor(page)), pages - 1)

  return { start: p * per, end: Math.min(total, p * per + per), pages, page: p }
}

export type LevelPolicy = { description: boolean; key: boolean; range: boolean }

/** The `level` preference as the pane applies it. */
export const levelPolicy = (level: unknown): LevelPolicy =>
  level === 'simple' ? { description: false, key: false, range: false } : level === 'everything' ? { description: true, key: true, range: true } : { description: true, key: false, range: false }

// ------------------------------------------------------------------ previews

const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog and keeps running far away'
const SAMPLE_PATH = '/Users/you/projects/app/src/components/Button.tsx'
const SAMPLE_HOME = '/Users/you'

/** A few lines made by the formatters from the current values: the live PREVIEW of a tab. */
export const previewLines = (group: Group, over: Over, now: number, lang = 'en'): string[] => {
  const ctx = ctxFrom(over, now)

  if (group === 'general') {
    return [
      `Now: ${formatDateTime(now, ctx)} (${zoneLabel(ctx.tzMin)}, ${valueOf(over, 'tz.mode') === 'fixed' ? 'fixed' : 'device'})`,
      `Week: ${weekOrder(ctx.weekStart, lang).join(' ')}`,
      `Detail level: ${String(valueOf(over, 'level'))}; scope: ${String(valueOf(over, 'sync.mode'))}`,
    ]
  }

  if (group === 'formats') {
    return [
      `Money: ${formatMoney(1234.5, ctx)}   ${formatMoney(-0.5, ctx)}   tile: ${formatMoney(12345, ctx, { tile: true })}`,
      `Number: ${formatNumber(1234567.891, ctx, 2)}   short: ${shortNumber(1234, ctx)}  ${shortNumber(1250000, ctx)}`,
      `Time: ${formatTime(now, ctx)}   Date: ${formatDate(now, ctx)}   ${relativeTime(now - 5 * 3_600_000, now)}`,
      `Size: ${formatSize(1_536_000, ctx)}   ${formatSize(734_003_200, ctx)}`,
      `Path: ${displayPath(SAMPLE_PATH, ctx.path, SAMPLE_HOME)}`,
      `Text: ${truncate(SAMPLE_TEXT, ctx.trunc)}`,
    ]
  }

  if (group === 'interface') {
    return [
      `Pane: opens on "${String(valueOf(over, 'pane.tab.prefs'))}", ${String(valueOf(over, 'pane.placement'))}, ${String(valueOf(over, 'pane.width'))} (${PANE_COLUMNS[String(valueOf(over, 'pane.width'))] ?? 80} columns wanted)`,
      `Motion: ${String(valueOf(over, 'motion.level'))} at ${String(valueOf(over, 'anim.speed'))}x, entrance ${valueOf(over, 'anim.entrance') === true ? 'on' : 'off'}; tooltips ${valueOf(over, 'tip.hover') === true ? `after ${String(valueOf(over, 'tip.delay'))} ms` : 'off'} (read only by mods built to)`,
    ]
  }

  if (group === 'notices') {
    return [
      `Toast: ${String(valueOf(over, 'toast.ms'))} ms at ${String(valueOf(over, 'toast.pos'))} (the app places toasts; the position is only stored)`,
      `May notify: ${['errors', 'approvals', 'done', 'budget', 'updates', 'tips'].filter(c => valueOf(over, `notify.${c}`) === true).join(', ') || 'nothing'}`,
      `Quiet hours set for: ${Object.keys(over).filter(k => k.startsWith('quiet.')).map(k => k.slice(6)).join(', ') || 'no mod'}`,
    ]
  }

  if (group === 'charts') {
    return [`Range ${String(valueOf(over, 'chart.range'))}; cost chart ${String(valueOf(over, 'chart.type.cost'))}, smooth ${valueOf(over, 'chart.smooth') === true ? 'on' : 'off'}, grid ${valueOf(over, 'chart.grid') === true ? 'on' : 'off'}, labels ${valueOf(over, 'chart.labels') === true ? 'on' : 'off'}, legend ${String(valueOf(over, 'chart.legend'))}, ramp ${String(valueOf(over, 'chart.ramp'))}`]
  }

  return [
    `Lists: ${String(valueOf(over, 'rows.page'))} rows per page, sorted ${String(valueOf(over, 'sort.default'))}; confirm before destructive: ${valueOf(over, 'confirm.destructive') === true ? 'yes' : 'no'}`,
    `New project: ${String(valueOf(over, 'newproject.clear'))}; recording off for: ${Object.keys(over).filter(k => k.startsWith('record.') && over[k] === false).map(k => k.slice(7)).join(', ') || 'no mod'}`,
  ]
}

export const PANE_COLUMNS: Readonly<Record<string, number>> = { narrow: 60, medium: 80, wide: 110 }

/** One line showing what a single format preference does now, or undefined for a preference with no sample. */
export const rowPreview = (key: string, over: Over, now: number): string | undefined => {
  const ctx = ctxFrom(over, now)

  switch (key) {
    case 'money.symbol':
    case 'money.cents':
    case 'money.rate':
      return `${formatMoney(1234.5, ctx)}  ${formatMoney(-7.2, ctx)}`
    case 'time.hours':
      return formatTime(now, ctx)
    case 'date.format':
      return formatDate(now, ctx)
    case 'tz.mode':
    case 'tz.offset':
      return `${zoneLabel(ctx.tzMin)}  ${formatDateTime(now, ctx)}`
    case 'num.decimal':
    case 'num.group':
      return formatNumber(1234567.891, ctx, 2)
    case 'num.short':
      return `${shortNumber(1234, ctx)}  ${shortNumber(1250000, ctx)}  ${shortNumber(2_400_000_000, ctx)}`
    case 'tiles.compact':
      return formatMoney(12345.67, ctx, { tile: true })
    case 'size.units':
      return `${formatSize(1_536_000, ctx)}  ${formatSize(734_003_200, ctx)}`
    case 'trunc.len':
      return truncate(SAMPLE_TEXT, ctx.trunc)
    case 'path.style':
      return displayPath(SAMPLE_PATH, ctx.path, SAMPLE_HOME)
    case 'week.start':
      return weekOrder(ctx.weekStart).join(' ')
    default:
      return undefined
  }
}

// ------------------------------------------------------------------ text for commands

export const helpText = (): string =>
  [
    'prefs: a second set of shared preferences (distinct from /cfg). Other mods read the atom prefs.prefs; see the README.',
    ...COMMANDS.map(([name, description]) => `  /${name}: ${description}`),
    'Honest scope: a preference only changes what a mod READS it. Today only prefs itself and mods built after it do. The pane marks each preference "used by prefs" or "stored for other mods".',
    'Proactive things are switches (default off): prefs.auto-open, prefs.auto-profile, prefs.auto-toast, prefs.branch-overrides; see /cfg feature list prefs.',
  ].join('\n')

export const describeSpec = (spec: PrefSpec, over: Over): string[] => {
  const current = valueOf(over, spec.key)

  return [
    `${spec.key}: ${showValue(spec, current)}${current === spec.default ? ' (default)' : ` (default ${showValue(spec, spec.default)})`}`,
    `  ${spec.label}: ${spec.description}`,
    `  accepts ${acceptText(spec)}; ${spec.isUsedHere ? 'used by prefs itself' : 'stored for other mods to read'}`,
  ]
}

export const searchLines = (query: string, over: Over, max = 12): string[] => {
  const hits = searchPrefs(query)

  return [
    `${hits.length} ${hits.length === 1 ? 'match' : 'matches'} for "${query.slice(0, 40)}"${hits.length > max ? ` (first ${max})` : ''}:`,
    ...hits.slice(0, max).map(p => `  ${p.key} = ${showValue(p, valueOf(over, p.key))}  (${p.label})`),
  ]
}
