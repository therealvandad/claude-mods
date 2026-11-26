// Pure logic of the feature switches: nothing here touches the engine, the disk or the network.
// register.tsx wires it up; pure.test.ts and register.test.tsx test it.
import { REGISTRY } from './registry'
import type { RegistryFeature, RegistryMod } from './registry'

// ------------------------------------------------------------------ constants

/** The four switches every mod has. `sounds` covers audio.play and audio.speak, `band` its row above the prompt. */
export const KINDS = ['toasts', 'sounds', 'status', 'band'] as const
export type Kind = (typeof KINDS)[number]

/**
 * Origins that are never gated. `engine`, `client` and `hook:*` are the host; `settings` is this mod; the three guard
 * mods raise safety messages (blocked calls, approvals, warnings), which must always reach the person.
 */
export const GUARD_MODS: readonly string[] = ['tool-guard', 'safety-pro', 'controls']
export const NEVER_GATED: readonly string[] = ['engine', 'client', 'settings', ...GUARD_MODS]
/** The quiet presets keep these on too: the notifier is how a quiet session still tells you something is waiting. */
export const KEEP_NOTIFIER = 'alerts'
/** `calm` keeps these bands (guards and settings can never be hidden anyway). */
export const CALM_BANDS: readonly string[] = ['cockpit', 'alerts']

export const MAX_OVERRIDES = 600
/** `<mod>.<id>`: a mod folder name, a dot, a local id. */
export const FEATURE_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}\.[a-z0-9][a-z0-9-]{0,40}$/

export type Overrides = Record<string, boolean>
export type FeatureDef = RegistryFeature & { mod: string; key: string; locked: boolean }
export type Index = ReadonlyMap<string, FeatureDef>

/** The documented pattern for a mod's own switch: the override if there is one, else its default. */
export const isFeatureOn = (overrides: Record<string, boolean>, id: string, dflt: boolean): boolean => overrides[id] ?? dflt

// ------------------------------------------------------------------ the decision

/** `name@marketplace` and `Name` both mean `name`. */
export const bareName = (plugin: unknown): string => (typeof plugin === 'string' ? (plugin.split('@')[0] ?? '').trim().toLowerCase() : '')

export const isNeverGated = (plugin: unknown): boolean => {
  const bare = bareName(plugin)

  return bare === '' || NEVER_GATED.includes(bare) || bare.startsWith('hook:')
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** May this plugin's call of this kind go through? Only an explicit `false` override stops it. */
export const isAllowed = (plugin: unknown, kind: Kind, overrides: unknown): boolean => {
  if (isNeverGated(plugin) || typeof overrides !== 'object' || overrides === null) {
    return true
  }
  const key = `${bareName(plugin)}.${kind}`

  return !(hasOwn(overrides, key) && (overrides as Record<string, unknown>)[key] === false)
}

/** The rows of the band that may stay, and how many were dropped. */
export const keepRows = <R extends { plugin: string }>(rows: readonly R[], overrides: unknown): { rows: R[]; dropped: number } => {
  const kept = rows.filter(r => isAllowed(r.plugin, 'band', overrides))

  return { rows: kept, dropped: rows.length - kept.length }
}

// ------------------------------------------------------------------ the registry as an index

export const buildIndex = (registry: readonly RegistryMod[]): Index => {
  const map = new Map<string, FeatureDef>()

  for (const mod of registry) {
    for (const f of mod.features) {
      const id = `${mod.name}.${f.id}`

      if (FEATURE_ID_RE.test(id) && !map.has(id)) {
        map.set(id, { ...f, mod: mod.name, key: f.id, locked: f.universal && isNeverGated(mod.name) })
      }
    }
  }

  return map
}

export const INDEX: Index = buildIndex(REGISTRY)

/** Load-time cleaning: ids that match the pattern and exist, boolean values only, at most 600. Never throws. */
export const sanitize = (raw: unknown, index: Index = INDEX): Overrides => {
  const out: Overrides = {}

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out
  }
  let n = 0

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_OVERRIDES) {
      break
    }
    const def = index.get(id)

    if (typeof value === 'boolean' && FEATURE_ID_RE.test(id) && def !== undefined && !def.locked) {
      out[id] = value
      n++
    }
  }

  return out
}

export const effective = (overrides: Overrides, def: FeatureDef): boolean => overrides[def.mod + '.' + def.key] ?? def.default

/** Sets one switch. A value equal to the default removes the override, so the store holds only real changes. */
export const withSwitch = (overrides: Overrides, def: FeatureDef, value: boolean | 'default'): Overrides => {
  const id = `${def.mod}.${def.key}`
  const { [id]: _old, ...rest } = overrides

  return value === 'default' || value === def.default ? rest : { ...rest, [id]: value }
}

/** How many switches differ from their default. */
export const changedCount = (overrides: Overrides, index: Index = INDEX): number => {
  let n = 0

  for (const [id, value] of Object.entries(overrides)) {
    const def = index.get(id)

    if (def !== undefined && def.default !== value) {
      n++
    }
  }

  return n
}

// ------------------------------------------------------------------ presets

const universalOf = (index: Index) => [...index.values()].filter(d => d.universal && !d.locked)

/** `quiet`: every toast, sound, status and band off, except the guards (which cannot be muted) and the notifier. */
export const quietOverrides = (index: Index = INDEX): Overrides => {
  const out: Overrides = {}

  for (const d of universalOf(index)) {
    if (d.mod !== KEEP_NOTIFIER && d.default) {
      out[`${d.mod}.${d.key}`] = false
    }
  }

  return out
}

/** `calm`: toasts, sounds and status off (the notifier excepted), a band only for cockpit and alerts. */
export const calmOverrides = (index: Index = INDEX): Overrides => {
  const out: Overrides = {}

  for (const d of universalOf(index)) {
    if (!d.default) {
      continue
    }
    const keep = d.mod === KEEP_NOTIFIER || (d.key === 'band' && CALM_BANDS.includes(d.mod))

    if (!keep) {
      out[`${d.mod}.${d.key}`] = false
    }
  }

  return out
}

export const FEATURE_PRESETS = ['quiet', 'calm', 'full'] as const
export type FeaturePreset = (typeof FEATURE_PRESETS)[number]

export const presetOverrides = (name: FeaturePreset, index: Index = INDEX): Overrides =>
  name === 'quiet' ? quietOverrides(index) : name === 'calm' ? calmOverrides(index) : {}

/** The feature preset that goes with a look-and-feel preset (focus is quiet). */
export const featurePresetFor = (preset: 'calm' | 'focus' | 'full'): FeaturePreset => (preset === 'focus' ? 'quiet' : preset)

// ------------------------------------------------------------------ suggestions

const levenshtein = (a: string, b: string): number => {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0
    prev[0] = i

    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }

  return prev[b.length] ?? 0
}

/** Up to `n` ids that look like what was typed: same words, a typo away, or the right mod. */
export const closestIds = (input: string, index: Index = INDEX, n = 3): string[] => {
  const want = input.trim().toLowerCase().slice(0, 80)

  if (want === '') {
    return []
  }
  const [wantMod = '', wantKey = ''] = want.includes('.') ? want.split('.', 2) : [want, '']
  const scored: { id: string; score: number }[] = []

  for (const id of index.keys()) {
    const [mod = '', key = ''] = id.split('.', 2)
    let score = levenshtein(want, id)

    if (id.includes(want) || want.includes(id)) {
      score = Math.min(score, 1)
    }

    if (want.includes('.')) {
      score = Math.min(score, levenshtein(wantMod, mod) + levenshtein(wantKey, key) + 0.5)
    } else if (mod === want) {
      score = Math.min(score, 1.5)
    } else {
      score = Math.min(score, levenshtein(want, mod) + 1)
    }
    scored.push({ id, score })
  }
  const limit = Math.max(3, Math.ceil(want.length / 3))

  return scored
    .filter(s => s.score <= limit)
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, n)
    .map(s => s.id)
}

// ------------------------------------------------------------------ the /cfg feature command line

export type FeatureCmd =
  | { kind: 'overview' }
  | { kind: 'list'; mod: string }
  | { kind: 'set'; id: string; value: boolean | 'default' }
  | { kind: 'reset' }
  | { kind: 'preset'; name: 'quiet' | 'calm' | 'full' }
  | { kind: 'error'; message: string }

export const FEATURE_USAGE =
  'Usage: /cfg feature · /cfg feature list [mod|all] · /cfg feature <mod>.<id> on|off|default · /cfg feature quiet|calm|full · /cfg feature reset'

/** `args` is what follows `feature`. Needs the index only to tell a mod name from a switch name. */
export const parseFeatureArgs = (args: string, index: Index = INDEX): FeatureCmd => {
  const words = args.trim().toLowerCase().split(/\s+/).filter(w => w !== '')
  const [first = '', second = ''] = words

  if (first === '') {
    return { kind: 'overview' }
  }

  if (first === 'list') {
    return second === '' ? { kind: 'overview' } : { kind: 'list', mod: second }
  }

  if (first === 'reset' || first === 'full') {
    return words.length > 1 ? { kind: 'error', message: FEATURE_USAGE } : first === 'reset' ? { kind: 'reset' } : { kind: 'preset', name: 'full' }
  }

  if (first === 'quiet' || first === 'calm') {
    return words.length > 1 ? { kind: 'error', message: FEATURE_USAGE } : { kind: 'preset', name: first }
  }

  if (!first.includes('.')) {
    // a bare mod name shows that mod's switches
    return second === '' ? { kind: 'list', mod: first } : { kind: 'error', message: `"${first.slice(0, 40)}" is not a switch name. A switch is <mod>.<id>, for example cockpit.toasts. ${FEATURE_USAGE}` }
  }

  if (!index.has(first)) {
    const near = closestIds(first, index)

    return { kind: 'error', message: `No switch named "${first.slice(0, 60)}".${near.length > 0 ? ` Closest: ${near.join(', ')}.` : ''} /cfg feature list <mod> shows a mod's switches.` }
  }

  if (words.length > 2 || (second !== '' && !['on', 'off', 'default'].includes(second))) {
    return { kind: 'error', message: `Say on, off or default after the switch name. ${FEATURE_USAGE}` }
  }

  if (second === '') {
    return { kind: 'list', mod: first.split('.')[0] ?? first }
  }

  return { kind: 'set', id: first, value: second === 'default' ? 'default' : second === 'on' }
}

const mark = (on: boolean) => (on ? 'on ' : 'off')

export const lineFor = (overrides: Overrides, def: FeatureDef): string => {
  const id = `${def.mod}.${def.key}`
  const now = effective(overrides, def)

  if (def.locked) {
    return `  ${id.padEnd(30)} on   always on: a safety mod's messages cannot be muted`
  }

  return `  ${id.padEnd(30)} ${mark(now)}  ${now === def.default ? `(default ${mark(def.default).trim()})` : `* changed, default ${mark(def.default).trim()}`}  ${def.label}`
}

export const listMod = (overrides: Overrides, mod: string, index: Index = INDEX): string[] =>
  [...index.values()].filter(d => d.mod === mod).map(d => lineFor(overrides, d))

export const modNames = (index: Index = INDEX): string[] => [...new Set([...index.values()].map(d => d.mod))]

/** Resolves what the person typed as a mod: exact, or a unique prefix. */
export const findMod = (typed: string, index: Index = INDEX): { mod?: string; near: string[] } => {
  const want = typed.trim().toLowerCase()
  const names = modNames(index)

  if (names.includes(want)) {
    return { mod: want, near: [] }
  }

  return { near: names.filter(n => n.includes(want) || levenshtein(n, want) <= 2).slice(0, 3) }
}

export const overview = (overrides: Overrides, index: Index = INDEX): string => {
  const changed = Object.entries(overrides)
    .filter(([id, v]) => index.get(id) !== undefined && index.get(id)?.default !== v)
    .sort(([a], [b]) => a.localeCompare(b))
  const lines = [
    `${index.size} switches in ${modNames(index).length} mods; ${changed.length} changed from default.`,
    ...changed.slice(0, 40).map(([id, v]) => `  ${id} ${v ? 'on' : 'off'} (default ${index.get(id)?.default ? 'on' : 'off'})`),
    ...(changed.length > 40 ? [`  ... and ${changed.length - 40} more (/cfg feature list all)`] : []),
    `Every mod has four: <mod>.toasts, <mod>.sounds, <mod>.status, <mod>.band. ${GUARD_MODS.join(', ')} and settings cannot be muted.`,
    FEATURE_USAGE,
  ]

  return lines.join('\n')
}
