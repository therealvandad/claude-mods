import { ROLE_NAMES, WEEKDAYS, canonicalSkin, isFixedSkin, isHex } from './palettes'
import type { CustomPalette, RoleName } from './palettes'

// Pure helpers: settings parsing, templates, schedule rules, import validation, text spacing.

export type Scheme = 'system' | 'light' | 'dark'
export type AutoMode = 'off' | 'on' | 'project' | 'branch'
export type Density = 'compact' | 'normal' | 'airy'
export type Rule = { at: string; skin: string }

export type Cfg = {
  scheme: Scheme
  auto: AutoMode
  day: boolean
  sun: boolean
  sched: { on: boolean; rules: Rule[] }
  status: { on: boolean; template: string }
  roles: Partial<Record<RoleName, string>>
  custom: CustomPalette | null
  dys: boolean
  scale: number
  density: Density
}

export const DEFAULT_TEMPLATE = '{branch} {cost} {context}'
export const MAX_RULES = 12
export const MAX_TEMPLATE = 160
export const MAX_ENTRIES = 50

export const defaults = (): Cfg => ({
  scheme: 'system',
  auto: 'off',
  day: false,
  sun: false,
  sched: { on: false, rules: [] },
  status: { on: false, template: DEFAULT_TEMPLATE },
  roles: {},
  custom: null,
  dys: false,
  scale: 1,
  density: 'normal',
})

const SCHEMES: readonly Scheme[] = ['system', 'light', 'dark']
const AUTOS: readonly AutoMode[] = ['off', 'on', 'project', 'branch']
const DENSITIES: readonly Density[] = ['compact', 'normal', 'airy']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------------------------------------------------------------- schedule rules

export const normTime = (raw: string): string | undefined => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim())

  return m === null ? undefined : `${m[1]!.padStart(2, '0')}:${m[2]}`
}

/** `default` clears the theme (the app's own look); the rest name a palette. */
export const isRuleSkin = (name: string): boolean =>
  name === 'default' || isFixedSkin(name) || ['custom', 'sun', 'plain', 'project', 'branch'].includes(name)

export const minutesOf = (at: string): number => Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5))

export const sortRules = (rules: readonly Rule[]): Rule[] => [...rules].sort((a, b) => minutesOf(a.at) - minutesOf(b.at))

/** The rule in force at a minute of the day: the latest one at or before it, else yesterday's last. */
export const activeRule = (rules: readonly Rule[], minute: number): Rule | undefined => {
  const sorted = sortRules(rules)
  let found: Rule | undefined

  for (const r of sorted) {
    if (minutesOf(r.at) <= minute) {
      found = r
    }
  }

  return found ?? sorted[sorted.length - 1]
}

export const addRule = (rules: readonly Rule[], at: string, skin: string): Rule[] | string => {
  const time = normTime(at)
  const name = canonicalSkin(skin)

  if (time === undefined) {
    return `"${at}" is not a time. Use HH:MM, 24 hours (for example 22:00).`
  }

  if (!isRuleSkin(name)) {
    return `"${skin}" is not a look this mod knows. Try cyber, night, hivis, print, mon..sun, custom, sun, project, branch, plain or default.`
  }
  const rest = rules.filter(r => r.at !== time)

  if (rest.length >= MAX_RULES) {
    return `At most ${MAX_RULES} rules. /spsched del <HH:MM> removes one.`
  }

  return sortRules([...rest, { at: time, skin: name }])
}

// ---------------------------------------------------------------- settings parsing

export type Parsed = { value: Partial<Cfg>; errors: string[] }

const SETTING_KEYS = ['scheme', 'auto', 'day', 'sun', 'sched', 'status', 'roles', 'custom', 'dys', 'scale', 'density'] as const

export const parseCustom = (raw: unknown, errors: string[], where = 'custom'): CustomPalette | null | undefined => {
  if (raw === null) {
    return null
  }

  if (!isObj(raw)) {
    errors.push(`${where} must be an object or null`)

    return undefined
  }
  const local: string[] = []

  for (const k of Object.keys(raw)) {
    if (!['hue', 'sat', 'mode', 'accent'].includes(k)) {
      local.push(`${where}: unknown key "${k}"`)
    }
  }
  const { hue, sat, mode, accent } = raw

  if (typeof hue !== 'number' || !Number.isInteger(hue) || hue < 0 || hue > 359) {
    local.push(`${where}.hue must be a whole number 0 to 359`)
  }

  if (typeof sat !== 'number' || !Number.isInteger(sat) || sat < 0 || sat > 40) {
    local.push(`${where}.sat must be a whole number 0 to 40`)
  }

  if (mode !== 'both' && mode !== 'light' && mode !== 'dark') {
    local.push(`${where}.mode must be both, light or dark`)
  }

  if (accent !== undefined && !isHex(accent)) {
    local.push(`${where}.accent must be a #rrggbb colour`)
  }

  if (local.length > 0) {
    errors.push(...local)

    return undefined
  }

  return {
    hue: hue as number,
    sat: sat as number,
    mode: mode as CustomPalette['mode'],
    ...(typeof accent === 'string' ? { accent: accent.toLowerCase() } : {}),
  }
}

/** Reads a settings object. Strict mode (imports) reports every problem; the caller refuses on any. */
export const parseSettings = (raw: unknown, isStrict: boolean): Parsed => {
  const value: Partial<Cfg> = {}
  const errors: string[] = []

  if (!isObj(raw)) {
    return { value, errors: ['settings must be an object'] }
  }

  for (const k of Object.keys(raw)) {
    if (!(SETTING_KEYS as readonly string[]).includes(k)) {
      errors.push(`unknown setting "${k}"`)
    }
  }

  if (raw.scheme !== undefined) {
    SCHEMES.includes(raw.scheme as Scheme) ? (value.scheme = raw.scheme as Scheme) : errors.push('scheme must be system, light or dark')
  }

  if (raw.auto !== undefined) {
    AUTOS.includes(raw.auto as AutoMode) ? (value.auto = raw.auto as AutoMode) : errors.push('auto must be off, on, project or branch')
  }

  for (const k of ['day', 'sun', 'dys'] as const) {
    if (raw[k] !== undefined) {
      typeof raw[k] === 'boolean' ? (value[k] = raw[k] as boolean) : errors.push(`${k} must be true or false`)
    }
  }

  if (raw.density !== undefined) {
    DENSITIES.includes(raw.density as Density) ? (value.density = raw.density as Density) : errors.push('density must be compact, normal or airy')
  }

  if (raw.scale !== undefined) {
    typeof raw.scale === 'number' && raw.scale >= 0.8 && raw.scale <= 2
      ? (value.scale = Math.round(raw.scale * 100) / 100)
      : errors.push('scale must be a number from 0.8 to 2')
  }

  if (raw.sched !== undefined) {
    const s = raw.sched

    if (!isObj(s) || typeof s.on !== 'boolean' || !Array.isArray(s.rules) || s.rules.length > MAX_RULES) {
      errors.push(`sched must be { on: boolean, rules: up to ${MAX_RULES} of { at, skin } }`)
    } else {
      const rules: Rule[] = []

      for (const r of s.rules) {
        const at = isObj(r) && typeof r.at === 'string' ? normTime(r.at) : undefined
        const skin = isObj(r) && typeof r.skin === 'string' ? canonicalSkin(r.skin) : ''

        if (at === undefined || !isRuleSkin(skin) || (isObj(r) && Object.keys(r).length !== 2)) {
          errors.push(`sched rule ${JSON.stringify(r)} is not { at: "HH:MM", skin: <known look> }`)
        } else if (!rules.some(x => x.at === at)) {
          rules.push({ at, skin })
        }
      }
      value.sched = { on: s.on, rules: sortRules(rules) }
    }
  }

  if (raw.status !== undefined) {
    const s = raw.status
    const tpl = isObj(s) ? checkTemplate(s.template) : 'status must be { on: boolean, template: string }'

    if (!isObj(s) || typeof s.on !== 'boolean' || Object.keys(s).length !== 2 || tpl !== undefined) {
      errors.push(tpl ?? 'status must be { on: boolean, template: string }')
    } else {
      value.status = { on: s.on, template: s.template as string }
    }
  }

  if (raw.roles !== undefined) {
    const r = raw.roles
    const roles: Partial<Record<RoleName, string>> = {}

    if (!isObj(r)) {
      errors.push('roles must be an object')
    } else {
      for (const [k, v] of Object.entries(r)) {
        if (!(ROLE_NAMES as readonly string[]).includes(k) || !isHex(v)) {
          errors.push(`role "${k}" must be one of ${ROLE_NAMES.join(', ')} with a #rrggbb colour`)
        } else {
          roles[k as RoleName] = (v as string).toLowerCase()
        }
      }
      value.roles = roles
    }
  }

  if (raw.custom !== undefined) {
    const local: string[] = []
    const c = parseCustom(raw.custom, local)

    errors.push(...local)

    if (c !== undefined) {
      value.custom = c
    }
  }

  if (!isStrict) {
    return { value, errors: [] }
  }

  return { value, errors }
}

/** What is stored may be garbage: keep what parses, default the rest. */
export const cleanCfg = (raw: unknown): Cfg => ({ ...defaults(), ...parseSettings(raw, false).value })

// ---------------------------------------------------------------- import and export

export const KIND_PALETTE = 'skins-plus-palette'
export const KIND_SETUP = 'skins-plus-setup'

export const exportPalette = (c: CustomPalette): string =>
  JSON.stringify({ kind: KIND_PALETTE, v: 1, hue: c.hue, sat: c.sat, mode: c.mode, ...(c.accent === undefined ? {} : { accent: c.accent }) }, null, 2)

export const exportSetup = (cfg: Cfg): string => {
  const { scheme, auto, day, sun, sched, status, roles, custom, dys, scale, density } = cfg

  return JSON.stringify({ kind: KIND_SETUP, v: 1, settings: { scheme, auto, day, sun, sched, status, roles, custom, dys, scale, density } }, null, 2)
}

export type Imported = { kind: 'palette'; palette: CustomPalette } | { kind: 'setup'; settings: Partial<Cfg> }

export const parseImport = (text: string): Imported | { error: string } => {
  const body = text.trim()

  if (body === '') {
    return { error: 'Nothing to import. Paste the JSON that /spexport or /spshare printed.' }
  }

  if (body.length > 6000) {
    return { error: 'That is too long for a setup (6000 characters at most).' }
  }
  let raw: unknown

  try {
    raw = JSON.parse(body)
  } catch {
    return { error: 'That is not valid JSON. Paste the whole block, braces included.' }
  }

  if (!isObj(raw)) {
    return { error: 'The JSON must be an object.' }
  }

  if (raw.kind === KIND_PALETTE) {
    const errors: string[] = []

    for (const k of Object.keys(raw)) {
      if (!['kind', 'v', 'hue', 'sat', 'mode', 'accent'].includes(k)) {
        errors.push(`unknown key "${k}"`)
      }
    }

    if (raw.v !== 1) {
      errors.push('v must be 1')
    }
    const { kind: _kind, v: _v, ...rest } = raw
    const palette = parseCustom(rest, errors, 'palette')

    return errors.length > 0 || palette === undefined || palette === null
      ? { error: `Refused: ${errors.join('; ') || 'not a palette'}` }
      : { kind: 'palette', palette }
  }

  if (raw.kind === KIND_SETUP) {
    const errors: string[] = []

    for (const k of Object.keys(raw)) {
      if (!['kind', 'v', 'settings'].includes(k)) {
        errors.push(`unknown key "${k}"`)
      }
    }

    if (raw.v !== 1) {
      errors.push('v must be 1')
    }
    const parsed = parseSettings(raw.settings, true)
    errors.push(...parsed.errors)

    return errors.length > 0 ? { error: `Refused: ${errors.join('; ')}` } : { kind: 'setup', settings: parsed.value }
  }

  return { error: `Refused: "kind" must be "${KIND_PALETTE}" or "${KIND_SETUP}".` }
}

/** One line per setting that would change. */
export const diffCfg = (cur: Cfg, next: Partial<Cfg>): string[] => {
  const lines: string[] = []

  for (const k of SETTING_KEYS) {
    if (next[k] === undefined) {
      continue
    }
    const a = JSON.stringify(cur[k])
    const b = JSON.stringify(next[k])

    if (a !== b) {
      lines.push(`  ${k}: ${a} -> ${b}`)
    }
  }

  return lines
}

// ---------------------------------------------------------------- status template

export const PLACEHOLDERS = ['branch', 'cost', 'context', 'rate', 'time'] as const

/** undefined when fine; else why not. */
export const checkTemplate = (t: unknown): string | undefined => {
  if (typeof t !== 'string' || t.trim() === '') {
    return 'The template must be some text with placeholders such as {branch} {cost} {context}.'
  }

  if (t.length > MAX_TEMPLATE) {
    return `The template is too long (${MAX_TEMPLATE} characters at most).`
  }

  if (/[\u0000-\u001f\u007f]/.test(t)) {
    return 'The template may not hold control characters.'
  }

  for (const m of t.matchAll(/\{([^{}]*)\}/g)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(m[1]!)) {
      return `Unknown placeholder {${m[1]}}. Known: ${PLACEHOLDERS.map(p => `{${p}}`).join(' ')}`
    }
  }

  return undefined
}

export const renderTemplate = (t: string, values: Record<string, string>): string =>
  t.replace(/\{([^{}]*)\}/g, (whole, name: string) => values[name] ?? whole).replace(/\s+/g, ' ').trim()

export const fmtCost = (usd: number | undefined): string => (usd === undefined ? '-' : `$${usd.toFixed(2)}`)
export const fmtPercent = (p: number | undefined): string => (p === undefined ? '-' : `${Math.round(p)}%`)

// ---------------------------------------------------------------- type, spacing, density

export const SCALES = [1, 1.15, 1.3, 1.5] as const

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** The `style` part of a theme, only when dyslexia spacing or a larger type scale is on. */
export const styleFor = (cfg: Pick<Cfg, 'dys' | 'scale'>) => {
  if (!cfg.dys && cfg.scale === 1) {
    return undefined
  }
  const fontSize = clamp(Math.round(15 * cfg.scale), 11, 28)
  const lineHeight = clamp(Math.round(fontSize * (cfg.dys ? 1.7 : 1.5)), fontSize, 48)

  return {
    Text: {
      fontSize,
      lineHeight,
      ...(cfg.dys ? { letterSpacing: 0.6, fontFamily: ['sans'] as const } : {}),
    },
  }
}

export const paneSize = (scale: number): 'footnote' | 'body' | 'heading' | 'title' =>
  scale >= 1.4 ? 'title' : scale >= 1.15 ? 'heading' : scale <= 0.9 ? 'footnote' : 'body'

export const padFor = (d: Density): 'xs' | 'sm' | 'md' => (d === 'compact' ? 'xs' : d === 'airy' ? 'md' : 'sm')

/** Wraps words to a width with extra word and line gaps: the dyslexia preview. */
export const spaceText = (text: string, opts: { wordGap: number; lineGap: number; width: number }): string[] => {
  const gap = ' '.repeat(opts.wordGap)
  const lines: string[] = []
  let line = ''

  for (const word of text.split(/\s+/).filter(w => w !== '')) {
    const next = line === '' ? word : `${line}${gap}${word}`

    if (next.length > opts.width && line !== '') {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }

  if (line !== '') {
    lines.push(line)
  }
  const out: string[] = []

  for (const l of lines) {
    out.push(l)

    for (let i = 0; i < opts.lineGap; i++) {
      out.push('')
    }
  }

  return out
}

export const spacingFor = (dys: boolean) => (dys ? { wordGap: 2, lineGap: 1, width: 44 } : { wordGap: 1, lineGap: 0, width: 80 })

export const dayId = (date: Date): string => WEEKDAYS[date.getDay()]!.id

/** Keep a per-folder map small: the newest entries stay. */
export const bounded = <T>(map: Record<string, T>, key: string, value: T): Record<string, T> => {
  const next = { ...map }

  delete next[key]
  next[key] = value
  const keys = Object.keys(next)

  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    delete next[k]
  }

  return next
}
