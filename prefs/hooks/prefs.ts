// The typed preference table, its lookup and the strict validators. Pure: nothing here touches the engine or the disk.
import { FAMILIES, FIXED, MOD_NAME_RE } from './table'
import type { Group } from './table'
import { MODS } from './modlist'

export type Val = string | number | boolean
export type Over = Record<string, Val>
export type PrefType = 'enum' | 'boolean' | 'number'

export type PrefSpec = {
  key: string
  type: PrefType
  default: Val
  /** enum: the allowed values */
  values?: readonly string[]
  /** number: range and the step the +/- buttons use */
  min?: number
  max?: number
  step?: number
  unit?: string
  label: string
  description: string
  group: Group
  section: string
  /** True when the prefs mod itself acts on it; false means stored for other mods to read. */
  isUsedHere: boolean
}

export const MAX_OVERRIDES = 250
export const MAX_IMPORT_CHARS = 20_000
export const KEY_RE = /^[a-z0-9][a-z0-9.-]{0,60}$/

// ------------------------------------------------------------------ the table

const expand = (): PrefSpec[] => {
  const out: PrefSpec[] = []

  for (const f of FAMILIES) {
    for (const m of MODS) {
      out.push(familySpec(f.prefix, m.name))
    }
  }

  return out
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

const familySpec = (prefix: string, mod: string): PrefSpec => {
  const f = FAMILIES.find(x => x.prefix === prefix)!
  const { prefix: _p, label, description, ...rest } = f

  return {
    ...rest,
    key: `${prefix}${mod}`,
    label: label.replace('{mod}', mod),
    description: description.replace('{mod}', mod),
    isUsedHere: prefix === 'autoopen.' && mod === 'prefs',
  }
}

/** Every preference this mod lists: the fixed table, then one row per known mod in each family. */
export const PREFS: readonly PrefSpec[] = [...FIXED, ...expand()]

const INDEX: ReadonlyMap<string, PrefSpec> = new Map(PREFS.map(p => [p.key, p]))

/** The spec for a key: a listed one, or a family key for a mod name not in the build-time list (a mod added later). */
export const specFor = (key: unknown): PrefSpec | undefined => {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    return undefined
  }
  const listed = INDEX.get(key)

  if (listed !== undefined) {
    return listed
  }

  for (const f of FAMILIES) {
    if (key.startsWith(f.prefix) && MOD_NAME_RE.test(key.slice(f.prefix.length))) {
      return familySpec(f.prefix, key.slice(f.prefix.length))
    }
  }

  return undefined
}

export const defaultOf = (key: string): Val | undefined => specFor(key)?.default

export const isDefault = (spec: PrefSpec, v: Val): boolean => v === spec.default

// ------------------------------------------------------------------ values

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000

const NUM_RE = /^[+-]?\d+(\.\d+)?$/

export type Parsed = { ok: true; value: Val } | { ok: false; message: string }

const rangeText = (s: PrefSpec): string => `${s.min} to ${s.max}${s.unit === undefined ? '' : ` ${s.unit}`}`

/** The words of what a spec accepts, for error messages and help. */
export const acceptText = (s: PrefSpec): string =>
  s.type === 'enum' ? `one of ${(s.values ?? []).join(', ')}` : s.type === 'boolean' ? 'on or off' : `a number from ${rangeText(s)}`

const BOOL_TRUE = ['on', 'true', 'yes', '1']
const BOOL_FALSE = ['off', 'false', 'no', '0']

/** Parse the text a person typed for this spec. Strict: unknown words and out-of-range numbers are errors, never coerced. */
export const parseValue = (spec: PrefSpec, raw: string): Parsed => {
  const text = raw.trim()

  if (text === '') {
    return { ok: false, message: `${spec.key} needs a value: ${acceptText(spec)}.` }
  }

  if (spec.type === 'boolean') {
    const w = text.toLowerCase()

    if (BOOL_TRUE.includes(w)) {
      return { ok: true, value: true }
    }

    if (BOOL_FALSE.includes(w)) {
      return { ok: true, value: false }
    }

    return { ok: false, message: `${spec.key} is ${acceptText(spec)}, not "${text.slice(0, 30)}".` }
  }

  if (spec.type === 'number') {
    if (!NUM_RE.test(text)) {
      return { ok: false, message: `${spec.key} is ${acceptText(spec)}, not "${text.slice(0, 30)}".` }
    }
    const v = round4(Number(text))

    return checkNumber(spec, v)
  }
  const w = text.toLowerCase()
  const hit = (spec.values ?? []).find(v => v.toLowerCase() === w)

  return hit === undefined ? { ok: false, message: `${spec.key} is ${acceptText(spec)}, not "${text.slice(0, 30)}".` } : { ok: true, value: hit }
}

const checkNumber = (spec: PrefSpec, v: number): Parsed =>
  Number.isFinite(v) && v >= (spec.min ?? -Infinity) && v <= (spec.max ?? Infinity)
    ? { ok: true, value: v }
    : { ok: false, message: `${spec.key} is ${acceptText(spec)}; ${v} is out of range.` }

/** Strict check of a value that is already typed (a stored or imported one): the exact type, no coercion. */
export const checkTyped = (spec: PrefSpec, v: unknown): Parsed => {
  if (spec.type === 'boolean') {
    return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, message: `${spec.key} must be true or false.` }
  }

  if (spec.type === 'number') {
    return typeof v === 'number' && Number.isFinite(v) ? checkNumber(spec, round4(v)) : { ok: false, message: `${spec.key} must be a number.` }
  }

  return typeof v === 'string' && (spec.values ?? []).includes(v)
    ? { ok: true, value: v }
    : { ok: false, message: `${spec.key} must be ${acceptText(spec)}.` }
}

/** Show a value the way a person types it. */
export const showValue = (spec: PrefSpec, v: Val): string =>
  spec.type === 'boolean' ? (v === true ? 'on' : 'off') : spec.type === 'number' ? `${v}${spec.unit === undefined ? '' : ` ${spec.unit}`}` : String(v)

/** The next value for a +/- press: `dir` is -1 or +1, `big` multiplies the step by 10. Clamped, rounded to 4 decimals. */
export const nudge = (spec: PrefSpec, current: Val, dir: -1 | 1, big = false): number => {
  const step = (spec.step ?? 1) * (big ? 10 : 1)
  const base = typeof current === 'number' ? current : Number(spec.default)

  return round4(Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, base + dir * step)))
}

// ------------------------------------------------------------------ overrides

/** The effective value of a key: the override if it is valid, else the default. */
export const valueOf = (over: Over, key: string): Val => {
  const spec = specFor(key)
  const v = hasOwn(over, key) ? over[key] : undefined

  if (spec === undefined) {
    return ''
  }

  if (v !== undefined) {
    const c = checkTyped(spec, v)

    if (c.ok) {
      return c.value
    }
  }

  return spec.default
}

/** Cross-field rules. Empty array = fine. */
export const crossCheck = (over: Over): string[] => {
  const dec = String(valueOf(over, 'num.decimal'))
  const grp = String(valueOf(over, 'num.group'))
  const problems: string[] = []

  if (dec === grp) {
    problems.push(`num.decimal and num.group cannot both be ${dec} (set one of them differently).`)
  }

  return problems
}

/**
 * Keep only valid entries of an unknown value: known key, exact type, in range, and (unless `keepDefaults`, used for the
 * project and branch layers where a value equal to the default still means something) not the default. At most MAX_OVERRIDES.
 */
export const sanitizeOverrides = (raw: unknown, keepDefaults = false): Over => {
  const out: Over = {}

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out
  }

  for (const key of Object.keys(raw).slice(0, MAX_OVERRIDES * 2)) {
    const spec = specFor(key)

    if (spec === undefined || Object.keys(out).length >= MAX_OVERRIDES) {
      continue
    }
    const c = checkTyped(spec, (raw as Record<string, unknown>)[key])

    if (c.ok && (keepDefaults || !isDefault(spec, c.value))) {
      out[key] = c.value
    }
  }

  return keepDefaults || crossCheck(out).length === 0 ? out : dropConflict(out)
}

/** A stored set that breaks a cross rule loses the group separator override, then the decimal one (never an error). */
const dropConflict = (over: Over): Over => {
  const next: Over = { ...over }
  delete next['num.group']

  if (crossCheck(next).length > 0) {
    delete next['num.decimal']
  }

  return next
}

/** `over` with one key set (or removed when it equals the default, unless `keepDefaults`). Returns a new object. */
export const withValue = (over: Over, spec: PrefSpec, value: Val, keepDefaults = false): Over => {
  const next: Over = { ...over }

  if (!keepDefaults && isDefault(spec, value)) {
    delete next[spec.key]
  } else {
    next[spec.key] = value
  }

  return next
}

export type Change = { key: string; before: Val | null; after: Val | null }

/** What turning `a` into `b` changes, in key order. null = not overridden (the default). */
export const diffOver = (a: Over, b: Over): Change[] => {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  const out: Change[] = []

  for (const key of keys) {
    const before = hasOwn(a, key) ? (a[key] as Val) : null
    const after = hasOwn(b, key) ? (b[key] as Val) : null

    if (before !== after) {
      out.push({ key, before, after })
    }
  }

  return out
}

/** Apply `changes` forward (`after`) or backward (`before`). */
export const applyChanges = (over: Over, changes: readonly Change[], dir: 'forward' | 'back'): Over => {
  const next: Over = { ...over }

  for (const c of changes) {
    const v = dir === 'forward' ? c.after : c.before

    if (v === null) {
      delete next[c.key]
    } else {
      next[c.key] = v
    }
  }

  return next
}

export const changeLine = (c: Change): string => {
  const spec = specFor(c.key)
  const show = (v: Val | null) => (v === null ? (spec === undefined ? 'default' : `default (${showValue(spec, spec.default)})`) : spec === undefined ? String(v) : showValue(spec, v))

  return `${c.key}: ${show(c.before)} -> ${show(c.after)}`
}

export const changedCount = (over: Over): number => Object.keys(sanitizeOverrides(over)).length

// ------------------------------------------------------------------ search

/** Preferences whose key, label, description, group or section contain every word of the query. */
export const searchPrefs = (query: string, list: readonly PrefSpec[] = PREFS): PrefSpec[] => {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== '').slice(0, 6)

  if (words.length === 0) {
    return []
  }

  return list.filter(p => {
    const hay = `${p.key} ${p.label} ${p.description} ${p.group} ${p.section}`.toLowerCase()

    return words.every(w => hay.includes(w))
  })
}

/** The nearest keys to a mistyped one (shared prefix or substring), at most 4. */
export const nearKeys = (key: string): string[] => {
  const k = key.toLowerCase().slice(0, 40)
  const head = k.split('.')[0] ?? k

  return PREFS.filter(p => p.key.includes(k) || k.includes(p.key) || (head.length >= 2 && p.key.startsWith(head)))
    .slice(0, 4)
    .map(p => p.key)
}

export const prefsInGroup = (group: Group): PrefSpec[] => PREFS.filter(p => p.group === group)

export const sectionsOf = (group: Group): string[] => [...new Set(prefsInGroup(group).map(p => p.section))]
