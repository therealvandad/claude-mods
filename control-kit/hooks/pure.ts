// Pure logic of control-kit: nothing here touches the engine, the disk or the network.
// register.tsx wires it up; pure.test.ts and register.test.tsx test it.
import { TABLE } from './table'
import type { TableMod } from './table'

// ------------------------------------------------------------------ constants

export const SELF = 'control-kit'
export const MARKET = 'local-mods'
export const KINDS = ['toasts', 'sounds', 'status', 'band'] as const
export const SNOOZE_KINDS = ['toasts', 'sounds'] as const
/** The three guard mods and the settings mod itself: the settings mod never gates them, so no switch of theirs can be muted. */
export const GUARDS: readonly string[] = ['tool-guard', 'safety-pro', 'controls']
export const NEVER_MUTED: readonly string[] = ['settings', ...GUARDS]
/** `/cfg feature quiet` keeps the notifier's four switches on. */
export const NOTIFIER = 'alerts'
export const CALM_BANDS: readonly string[] = ['cockpit', 'alerts']
/** Mods the panic list leaves out: the guards, the switch owner, the manager that can undo it, and this mod. */
export const PANIC_KEEP: readonly string[] = [...NEVER_MUTED, 'mod-manager', SELF]

export const MAX_HOLDS = 80
export const MAX_CHANGES = 30
export const MAX_AUDIT = 200
export const MAX_BLOCK = 50
export const MAX_ALLOW_CWDS = 20
export const MAX_ALLOW_PREFIXES = 20
export const MAX_ORDER = 30
export const MAX_OPS = 400
export const CONFIRM_MS = 120_000
export const MAX_MINUTES = 240
export const DEFAULT_PAUSE_MIN = 60
export const MIN_TOAST_GAP_MIN = 3
export const MAX_TOAST_GAP_MIN = 120

export const FEATURE_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}\.[a-z0-9][a-z0-9-]{0,40}$/
export const MOD_RE = /^[a-z0-9][a-z0-9-]{0,40}$/
export const ROW_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type Table = readonly TableMod[]
export type Overrides = Record<string, boolean>
/** `from` and `to` are overrides: true, false, or null for "no override, the default applies". */
export type Flip = { id: string; from: boolean | null; to: boolean | null }
export type Tidy = { isOn: boolean; keep: string[] }
export type Op = { t: 'cfg'; args: string } | { t: 'tidy'; args: string }
export type Hold = { id: string; before: boolean | null; until: number; src: 'pause' | 'snooze' }
export type Snap = { at: number; src: 'off' | 'safe' | 'panic'; before: Overrides; tidy: Tidy | null; tidyTo: Tidy | null }
export type Change = { at: number; label: string; flips: Flip[]; tidy: { from: Tidy; to: Tidy } | null }
export type AuditEntry = { at: number; what: string; result: string }
export type Dismissed = Record<string, { at: number; note: string; before: boolean | null }>
export type BlockCfg = { list: string[]; allow: Record<string, string[]> }
export type Prefs = { toastGapMin: number; isLocked: boolean }

export const clip = (s: string, n: number): string => {
  const one = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()

  return one.length <= n ? one : `${one.slice(0, n - 1).trimEnd()}…`
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ------------------------------------------------------------------ the switches, as my build-time table knows them

export type SwitchInfo = { id: string; mod: string; key: string; default: boolean; universal: boolean; locked: boolean }
export type Index = ReadonlyMap<string, SwitchInfo>

export const buildIndex = (table: Table = TABLE): Index => {
  const map = new Map<string, SwitchInfo>()
  const add = (mod: string, key: string, dflt: boolean, universal: boolean) => {
    const id = `${mod}.${key}`

    if (FEATURE_ID_RE.test(id) && !map.has(id)) {
      map.set(id, { id, mod, key, default: dflt, universal, locked: universal && NEVER_MUTED.includes(mod) })
    }
  }

  for (const m of table) {
    for (const k of KINDS) {
      add(m.name, k, true, true)
    }

    for (const f of m.own) {
      add(m.name, f.id, f.default, false)
    }
  }

  return map
}

export const effective = (index: Index, ov: Overrides, id: string): boolean => ov[id] ?? index.get(id)?.default ?? true

/** Keeps booleans under well formed ids only, and drops what equals the switch's default (the settings mod stores only real changes). */
export const normalize = (index: Index, raw: unknown): Overrides => {
  const out: Overrides = {}

  if (!isObj(raw)) {
    return out
  }

  for (const [id, v] of Object.entries(raw)) {
    const info = index.get(id)

    if (typeof v === 'boolean' && FEATURE_ID_RE.test(id) && (info === undefined || info.default !== v)) {
      out[id] = v
    }
  }

  return out
}

export const diffOverrides = (a: Overrides, b: Overrides): Flip[] => {
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()

  return ids
    .filter(id => (a[id] ?? null) !== (b[id] ?? null))
    .map(id => ({ id, from: a[id] ?? null, to: b[id] ?? null }))
}

const word = (v: boolean) => (v ? 'on' : 'off')

export const flipLine = (index: Index, f: Flip): string => {
  const dflt = index.get(f.id)?.default ?? true
  const from = f.from ?? dflt
  const to = f.to ?? dflt

  return `${f.id}: ${word(from)} -> ${word(to)}${f.to === null ? ' (back to default)' : ''}`
}

export const modsOf = (flips: readonly Flip[]): string[] => [...new Set(flips.map(f => f.id.split('.')[0] ?? ''))].filter(m => m !== '')

/** The switches a flip list would really change in effect (an override that only repeats the default changes nothing). */
export const effectiveFlips = (index: Index, flips: readonly Flip[]): Flip[] =>
  flips.filter(f => (f.from ?? index.get(f.id)?.default ?? true) !== (f.to ?? index.get(f.id)?.default ?? true))

// ------------------------------------------------------------------ the settings mod's own presets, predicted from the table

const guardable = (table: Table) => table.filter(m => !NEVER_MUTED.includes(m.name))

/** What `/cfg feature quiet` leaves behind: every toast, sound, status and band off, except the guards and the notifier. It REPLACES all overrides. */
export const quietTarget = (table: Table = TABLE): Overrides => {
  const out: Overrides = {}

  for (const m of guardable(table)) {
    if (m.name !== NOTIFIER) {
      for (const k of KINDS) {
        out[`${m.name}.${k}`] = false
      }
    }
  }

  return out
}

/** What `/cfg feature calm` leaves behind. */
export const calmTarget = (table: Table = TABLE): Overrides => {
  const out: Overrides = {}

  for (const m of guardable(table)) {
    if (m.name === NOTIFIER) {
      continue
    }

    for (const k of KINDS) {
      if (k !== 'band' || !CALM_BANDS.includes(m.name)) {
        out[`${m.name}.${k}`] = false
      }
    }
  }

  return out
}

/** Safe mode: the quiet set, the notifier's four, and every own switch that is on by default, off. Guards and `settings` untouched. */
export const safeTarget = (table: Table = TABLE): Overrides => {
  const out = quietTarget(table)

  for (const m of guardable(table)) {
    if (m.name === NOTIFIER) {
      for (const k of KINDS) {
        out[`${m.name}.${k}`] = false
      }
    }

    for (const f of m.own) {
      if (f.default) {
        out[`${m.name}.${f.id}`] = false
      }
    }
  }

  return out
}

export const setOp = (id: string, v: boolean | null): Op | undefined =>
  FEATURE_ID_RE.test(id) ? { t: 'cfg', args: `feature ${id} ${v === null ? 'default' : word(v)}` } : undefined

const compact = (ops: (Op | undefined)[]): Op[] => ops.filter((o): o is Op => o !== undefined)

/** The fewest `/cfg feature ...` commands that lead from `current` to `target`: one set per difference, or `reset` then one set per override wanted. */
export const opsToReach = (index: Index, current: Overrides, target: Overrides): Op[] => {
  const a = normalize(index, current)
  const b = normalize(index, target)
  const flips = diffOverrides(a, b)

  if (flips.length === 0) {
    return []
  }
  const sets = compact(flips.map(f => setOp(f.id, f.to)))
  const reset: Op[] = [{ t: 'cfg', args: 'feature reset' }, ...compact(Object.entries(b).map(([id, v]) => setOp(id, v)))]

  return reset.length < sets.length ? reset : sets
}

// ------------------------------------------------------------------ the row filter (band-tidy) as text

/** Reads what `/tidy` says: "Tidy is on. Showing rows from: a, b." or "(none)". Anything else is `null`. */
export const parseTidy = (text: unknown): Tidy | null => {
  if (typeof text !== 'string') {
    return null
  }
  const m = /Tidy is (on|off)\.\s*Showing rows from:\s*([^\n]*)/.exec(text)

  if (m === null) {
    return null
  }
  const rest = (m[2] ?? '').trim().replace(/\.$/, '')
  const keep = rest === '(none)' || rest === '' ? [] : rest.split(',').map(s => s.trim())

  return keep.every(n => ROW_NAME_RE.test(n)) ? { isOn: m[1] === 'on', keep: keep.slice(0, 30) } : null
}

export const tidyOps = (from: Tidy, to: Tidy): Op[] => {
  const ops: Op[] = []

  for (const n of to.keep) {
    if (!from.keep.includes(n) && ROW_NAME_RE.test(n)) {
      ops.push({ t: 'tidy', args: `keep ${n}` })
    }
  }

  for (const n of from.keep) {
    if (!to.keep.includes(n) && ROW_NAME_RE.test(n)) {
      ops.push({ t: 'tidy', args: `hide ${n}` })
    }
  }

  if (from.isOn !== to.isOn) {
    ops.push({ t: 'tidy', args: to.isOn ? 'on' : 'off' })
  }

  return ops
}

export const tidyText = (t: Tidy): string => `rows ${t.isOn ? 'filtered' : 'unfiltered'}, shown from: ${t.keep.join(', ') || '(none)'}`

/** Rows that the quiet states never hide. */
export const ROWS_ALWAYS: readonly string[] = ['alerts', ...GUARDS]

// ------------------------------------------------------------------ plans

export type PlanKind =
  | 'off'
  | 'on'
  | 'safe'
  | 'panic'
  | 'quiet'
  | 'calm'
  | 'full'
  | 'undo'
  | 'pause'
  | 'snooze'
  | 'release'
  | 'dismiss'
  | 'undismiss'
  | 'block-on'
  | 'block-off'
  | 'rows-keep'
  | 'rows-hide'
  | 'rows-only'
  | 'rows-expand'
  | 'reset'

export type Spec = { kind: PlanKind; arg?: string }

export type World = {
  table: Table
  ov: Overrides
  /** What `/tidy` said, or `null` when the tidy mod did not answer. */
  tidy: Tidy | null
  snap: Snap | null
  holds: Hold[]
  changes: Change[]
  dismissed: Dismissed
  rowsBefore: Tidy | null
  now: number
  cwd: string
}

export type Effects = {
  snap?: Snap | null
  holds?: Hold[]
  dismissed?: Dismissed
  rowsBefore?: Tidy | null
  popChange?: boolean
  resetAll?: 'data' | 'everything'
}

export type Plan = {
  kind: PlanKind
  label: string
  ops: Op[]
  /** The switches that will change, predicted. */
  flips: Flip[]
  /** Other lines of the preview (rows, restore point, notes). */
  lines: string[]
  mods: string[]
  /** For the change log: the row filter before and after. */
  tidy: { from: Tidy; to: Tidy } | null
  effects: Effects
  /** Shell lines the person may run themselves (panic, safe mode). Never run by this mod. */
  disableLines: string[]
  /** True for the panic button only. */
  confirmFree: boolean
}

export type Built = { ok: true; plan: Plan } | { ok: false; message: string }

export const BULK_KINDS: ReadonlySet<PlanKind> = new Set<PlanKind>(['off', 'on', 'safe', 'quiet', 'calm', 'full', 'rows-only', 'rows-expand', 'reset'])

/** Bulk or risky: previewed and held for `/kcdo confirm`. Everything else is at most four switches of one mod, run at once and printed. */
export const needsConfirm = (plan: Plan): boolean =>
  !plan.confirmFree && (BULK_KINDS.has(plan.kind) || plan.kind === 'block-on' || plan.flips.length > 4 || plan.mods.length > 1)

export const disableLine = (name: string): string => `claude plugin disable ${name}@${MARKET}`

export const panicDisableLines = (table: Table = TABLE): string[] => table.filter(m => !PANIC_KEEP.includes(m.name)).map(m => disableLine(m.name))

const emptyPlan = (kind: PlanKind, label: string): Plan => ({
  kind,
  label,
  ops: [],
  flips: [],
  lines: [],
  mods: [],
  tidy: null,
  effects: {},
  disableLines: [],
  confirmFree: false,
})

const fail = (message: string): Built => ({ ok: false, message })

const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16)

/** The mod a person typed: exact name, or the closest few if it is not in the table. */
export const findMod = (table: Table, typed: string): { mod?: TableMod; near: string[] } => {
  const want = typed.trim().toLowerCase()
  const hit = table.find(m => m.name === want)

  if (hit !== undefined || want === '') {
    return { mod: hit, near: [] }
  }

  return { near: table.filter(m => m.name.includes(want) || want.includes(m.name)).slice(0, 3).map(m => m.name) }
}

const modProblem = (w: World, typed: string): { mod: TableMod } | { message: string } => {
  if (!MOD_RE.test(typed.trim().toLowerCase())) {
    return { message: 'Name a mod, for example notes. /kcperms lists them.' }
  }
  const found = findMod(w.table, typed)

  if (found.mod === undefined) {
    return { message: `No mod named "${clip(typed, 40)}" in the table.${found.near.length > 0 ? ` Closest: ${found.near.join(', ')}.` : ''}` }
  }

  if (NEVER_MUTED.includes(found.mod.name)) {
    return { message: `${found.mod.name} is a safety mod (or the settings mod): its messages are never muted, so there is nothing to change.` }
  }

  return { mod: found.mod }
}

const withTarget = (w: World, plan: Plan, target: Overrides, ops?: Op[]): Plan => {
  const index = buildIndex(w.table)
  const flips = effectiveFlips(index, diffOverrides(normalize(index, w.ov), normalize(index, target)))

  return { ...plan, flips, mods: modsOf(flips), ops: ops ?? opsToReach(index, w.ov, target) }
}

/** The off plan: `/cfg feature quiet`, the row filter cut to the notifier and the guards, a restore point kept the first time. */
const offPlan = (w: World, kind: 'off' | 'safe' | 'panic'): Plan => {
  const index = buildIndex(w.table)
  const target = kind === 'safe' ? safeTarget(w.table) : quietTarget(w.table)
  const plan = emptyPlan(kind, kind === 'safe' ? 'Safe mode: every switch of every mod except the guards off' : kind === 'panic' ? 'Panic: quiet everything' : 'Quiet everything')
  const base = normalize(index, w.ov)
  const wanted = normalize(index, target)
  const flips = effectiveFlips(index, diffOverrides(base, wanted))
  // `quiet` replaces every override; safe mode then sets the rest one by one (the notifier's four, then own switches that are on by default).
  const quiet: Overrides = normalize(index, quietTarget(w.table))
  const extra = diffOverrides(quiet, wanted)
  const ops: Op[] = [{ t: 'cfg', args: 'feature quiet' }, ...compact(extra.map(f => setOp(f.id, f.to)))]
  const lines: string[] = []

  if (w.snap === null) {
    lines.push(`A restore point is saved first: ${Object.keys(w.ov).length} existing override${Object.keys(w.ov).length === 1 ? '' : 's'} and the row filter, so /kcon puts them back exactly.`)
  } else {
    lines.push(`A restore point from ${when(w.snap.at)} already exists and is kept, so /kcon still returns to the state before the first quiet.`)
  }
  let tidyChange: Plan['tidy'] = null
  let tidyTo: Tidy | null = null

  if (w.tidy !== null) {
    tidyTo = { isOn: true, keep: w.tidy.keep.filter(n => ROWS_ALWAYS.includes(n)) }
    const t = tidyOps(w.tidy, tidyTo)

    ops.push(...t)
    tidyChange = t.length > 0 ? { from: w.tidy, to: tidyTo } : null
    lines.push(t.length > 0 ? `Rows above the prompt: ${t.map(o => `/tidy ${o.args}`).join(', ')}.` : 'Rows above the prompt: already as quiet as it gets.')
  } else {
    lines.push('Rows above the prompt: the row filter (/tidy) has not been read yet or did not answer. It is read when this runs; if it stays silent only the row switches change.')
  }

  if (ops.length > MAX_OPS) {
    return { ...plan, lines: ['Too many commands for one step.'], ops: [] }
  }
  const effects: Effects = {}

  if (w.snap === null) {
    effects.snap = { at: w.now, src: kind, before: normalize(index, w.ov), tidy: w.tidy, tidyTo }
  }

  return {
    ...plan,
    ops,
    flips,
    mods: modsOf(flips),
    lines,
    tidy: tidyChange,
    effects,
    disableLines: kind === 'off' ? [] : panicDisableLines(w.table),
    confirmFree: kind === 'panic',
  }
}

/** The inverse of a logged change, skipping switches that were changed again since. */
const undoPlan = (w: World): Built => {
  const last = w.changes[w.changes.length - 1]

  if (last === undefined) {
    return fail('Nothing to undo: no change has been logged yet.')
  }
  const index = buildIndex(w.table)
  const cur = normalize(index, w.ov)
  const target: Overrides = { ...cur }
  const skipped: string[] = []

  for (const f of last.flips) {
    if ((cur[f.id] ?? null) === f.to) {
      if (f.from === null) {
        delete target[f.id]
      } else {
        target[f.id] = f.from
      }
    } else {
      skipped.push(f.id)
    }
  }
  const plan = withTarget(w, emptyPlan('undo', `Undo: ${last.label}`), target)
  const lines = [`Undoes "${clip(last.label, 80)}" from ${when(last.at)}.`]

  if (skipped.length > 0) {
    lines.push(`Left alone because they changed again since: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ', ...' : ''}.`)
  }

  if (last.tidy !== null && w.tidy !== null && tidyText(w.tidy) === tidyText(last.tidy.to)) {
    const t = tidyOps(w.tidy, last.tidy.from)

    plan.ops.push(...t)
    plan.tidy = { from: w.tidy, to: last.tidy.from }
    lines.push(`Rows above the prompt: ${t.map(o => `/tidy ${o.args}`).join(', ') || 'unchanged'}.`)
  }
  return { ok: true, plan: { ...plan, lines, effects: { popChange: true, holds: w.holds.filter(h => !last.flips.some(f => f.id === h.id)) } } }
}

export const parseMinutes = (raw: string, dflt: number): { minutes: number } | { message: string } => {
  const t = raw.trim()

  if (t === '') {
    return { minutes: dflt }
  }

  if (!/^\d{1,4}$/.test(t)) {
    return { message: `Minutes is a whole number from 1 to ${MAX_MINUTES}.` }
  }
  const n = Number(t)

  return n >= 1 && n <= MAX_MINUTES ? { minutes: n } : { message: `Minutes is a whole number from 1 to ${MAX_MINUTES}.` }
}

/** The holds after pausing or snoozing: a switch already held keeps its ORIGINAL value to go back to. */
export const addHolds = (holds: readonly Hold[], mod: string, kinds: readonly string[], src: Hold['src'], until: number, ov: Overrides): Hold[] => {
  const out = holds.filter(h => !kinds.some(k => h.id === `${mod}.${k}`))

  for (const k of kinds) {
    const id = `${mod}.${k}`
    const old = holds.find(h => h.id === id)
    out.push({ id, before: old === undefined ? (ov[id] ?? null) : old.before, until, src: old !== undefined && old.src === 'pause' ? 'pause' : src })
  }

  return out
}

export const dueHolds = (holds: readonly Hold[], now: number): { due: Hold[]; rest: Hold[] } => ({
  due: holds.filter(h => h.until <= now),
  rest: holds.filter(h => h.until > now),
})

export const holdOps = (due: readonly Hold[]): Op[] => compact(due.map(h => setOp(h.id, h.before)))

const holdPlan = (w: World, kind: 'pause' | 'snooze', arg: string): Built => {
  const [name = '', minRaw = ''] = arg.trim().toLowerCase().split(/\s+/)
  const p = modProblem(w, name)

  if ('message' in p) {
    return fail(p.message)
  }
  const m = parseMinutes(minRaw, kind === 'pause' ? DEFAULT_PAUSE_MIN : 30)

  if ('message' in m) {
    return fail(m.message)
  }
  const kinds = kind === 'pause' ? KINDS : SNOOZE_KINDS
  const until = w.now + m.minutes * 60_000
  const holds = addHolds(w.holds, p.mod.name, kinds, kind, until, w.ov)

  if (holds.length > MAX_HOLDS) {
    return fail('Too many pauses at once. End some with /kcpause <mod> off.')
  }
  const target: Overrides = { ...w.ov }

  for (const k of kinds) {
    target[`${p.mod.name}.${k}`] = false
  }
  const plan = withTarget(w, emptyPlan(kind, `${kind === 'pause' ? 'Pause' : 'Snooze'} ${p.mod.name} for ${m.minutes} min`), target)

  return {
    ok: true,
    plan: {
      ...plan,
      lines: [`${kinds.join(', ')} of ${p.mod.name} stay off until ${when(until)} (${m.minutes} min), then go back to what they are now.`],
      effects: { holds },
    },
  }
}

const releasePlan = (w: World, arg: string): Built => {
  const name = arg.trim().toLowerCase()
  const mine = w.holds.filter(h => h.id.startsWith(`${name}.`))

  if (mine.length === 0) {
    return fail(`${clip(name, 40) || 'That mod'} has no active pause or snooze.`)
  }
  const target: Overrides = { ...w.ov }

  for (const h of mine) {
    if (h.before === null) {
      delete target[h.id]
    } else {
      target[h.id] = h.before
    }
  }
  const plan = withTarget(w, emptyPlan('release', `End the pause of ${name} now`), target)

  return { ok: true, plan: { ...plan, lines: [`Puts ${mine.map(h => h.id.split('.')[1]).join(', ')} of ${name} back as they were before.`], effects: { holds: w.holds.filter(h => !h.id.startsWith(`${name}.`)) } } }
}

const dismissPlan = (w: World, arg: string): Built => {
  const [name = '', ...noteWords] = arg.trim().split(/\s+/)
  const p = modProblem(w, name)

  if ('message' in p) {
    return fail(p.message)
  }
  const id = `${p.mod.name}.toasts`
  const target: Overrides = { ...w.ov, [id]: false }
  const plan = withTarget(w, emptyPlan('dismiss', `Dismiss the pop-ups of ${p.mod.name}`), target)
  const note = clip(noteWords.join(' '), 100) || 'no note'

  return {
    ok: true,
    plan: {
      ...plan,
      lines: [`${p.mod.name}.toasts stays off until you run /kcdismiss ${p.mod.name} undo. Note kept: ${note}.`],
      effects: { dismissed: { ...w.dismissed, [p.mod.name]: { at: w.now, note, before: w.dismissed[p.mod.name]?.before ?? w.ov[id] ?? null } } },
    },
  }
}

const undismissPlan = (w: World, arg: string): Built => {
  const name = arg.trim().toLowerCase()
  const d = w.dismissed[name]

  if (d === undefined) {
    return fail(`${clip(name, 40) || 'That mod'} is not dismissed.`)
  }
  const id = `${name}.toasts`
  const target: Overrides = { ...w.ov }

  if (d.before === null) {
    delete target[id]
  } else {
    target[id] = d.before
  }
  const rest = { ...w.dismissed }
  delete rest[name]

  return { ok: true, plan: { ...withTarget(w, emptyPlan('undismiss', `Bring back the pop-ups of ${name}`), target), effects: { dismissed: rest } } }
}

const blockSwitchPlan = (w: World, on: boolean): Built => {
  const id = `${SELF}.block`
  const target: Overrides = { ...w.ov }

  if (on) {
    target[id] = true
  } else {
    delete target[id]
  }
  const plan = withTarget(w, emptyPlan(on ? 'block-on' : 'block-off', on ? 'Turn the Bash block list on' : 'Turn the Bash block list off'), target)
  const index = buildIndex(w.table)

  return {
    ok: true,
    plan: { ...plan, ops: compact([setOp(id, on ? true : null)]), flips: effectiveFlips(index, diffOverrides(normalize(index, w.ov), normalize(index, target))) },
  }
}

const rowsPlan = (w: World, kind: 'rows-keep' | 'rows-hide' | 'rows-only' | 'rows-expand', arg: string): Built => {
  const name = arg.trim().toLowerCase()

  if (kind !== 'rows-expand' && !ROW_NAME_RE.test(name)) {
    return fail('Name a mod, for example cockpit.')
  }

  if (w.tidy === null) {
    if (kind === 'rows-keep' || kind === 'rows-hide') {
      // One /tidy word does the job whatever the filter says now.
      return {
        ok: true,
        plan: {
          ...emptyPlan(kind, kind === 'rows-keep' ? `Show the row of ${name}` : `Hide the row of ${name}`),
          ops: [{ t: 'tidy', args: `${kind === 'rows-keep' ? 'keep' : 'hide'} ${name}` }],
          lines: [`Runs /tidy ${kind === 'rows-keep' ? 'keep' : 'hide'} ${name}. The current filter has not been read yet.`],
        },
      }
    }

    return fail('The row filter (/tidy) has not been read yet or did not answer, so this cannot be previewed. It is being read in the background: ask again in a moment. (Is the band-tidy mod on?)')
  }
  let to: Tidy
  let label: string

  if (kind === 'rows-keep') {
    to = { isOn: true, keep: [...new Set([...w.tidy.keep, name])] }
    label = `Show the row of ${name}`
  } else if (kind === 'rows-hide') {
    to = { isOn: w.tidy.isOn, keep: w.tidy.keep.filter(n => n !== name) }
    label = `Hide the row of ${name}`
  } else if (kind === 'rows-only') {
    to = { isOn: true, keep: [...new Set([name, ...w.tidy.keep.filter(n => GUARDS.includes(n))])] }
    label = `Collapse all rows but ${name}`
  } else {
    to = w.rowsBefore ?? { isOn: false, keep: w.tidy.keep }
    label = w.rowsBefore === null ? 'Expand rows: let every mod draw again' : 'Expand rows: back to what was shown before the collapse'
  }
  const ops = tidyOps(w.tidy, to)
  const plan = emptyPlan(kind, label)

  return {
    ok: true,
    plan: {
      ...plan,
      ops,
      tidy: ops.length > 0 ? { from: w.tidy, to } : null,
      lines: [ops.length === 0 ? 'No change: the rows are already like that.' : `Runs ${ops.map(o => `/tidy ${o.args}`).join(', ')}.`, `Now: ${tidyText(w.tidy)}`, `After: ${tidyText(to)}`, ...(kind === 'rows-only' ? ['Guard rows (tool-guard, safety-pro, controls) are never hidden by this.'] : [])],
      effects: kind === 'rows-only' ? { rowsBefore: w.rowsBefore ?? w.tidy } : kind === 'rows-expand' ? { rowsBefore: null } : {},
    },
  }
}

const restorePlan = (w: World): Built => {
  const snap = w.snap

  if (snap === null) {
    return fail('There is no restore point. /kcoff, /kcsafe or /kcpanic make one; until then there is nothing to put back.')
  }
  const plan = withTarget(w, emptyPlan('on', 'Restore the switches and rows to what they were before quiet mode'), snap.before)
  const lines = [`Restore point from ${when(snap.at)} (${snap.src}): ${Object.keys(snap.before).length} override${Object.keys(snap.before).length === 1 ? '' : 's'} then.`]
  const now = w.tidy ?? snap.tidyTo

  if (snap.tidy !== null && now !== null) {
    const t = tidyOps(now, snap.tidy)

    plan.ops.push(...t)
    plan.tidy = t.length > 0 ? { from: now, to: snap.tidy } : null
    lines.push(`Rows above the prompt: ${t.map(o => `/tidy ${o.args}`).join(', ') || 'unchanged'}.`)
  } else {
    lines.push('Rows above the prompt: no filter state was recorded, so they are left alone.')
  }

  if (w.holds.length > 0) {
    lines.push(`${w.holds.length} timed pause/snooze switch${w.holds.length === 1 ? '' : 'es'} will be forgotten: the restore point covers them.`)
  }
  return { ok: true, plan: { ...plan, lines, effects: { snap: null, holds: [] } } }
}

const resetPlan = (w: World, arg: string): Built => {
  const all = arg.trim().toLowerCase() === 'all'
  const lines = [
    'Clears: the audit log, the change log (so /kcundo has nothing), dismissal notes, the saved row order, the block list and allow-lists, and the toast-gap preference.',
    'The lock setting is kept. No switch is changed.',
  ]

  if (all) {
    lines.push('/kcreset all also forgets the restore point and every timed pause: the switches stay as they are now and /kcon can no longer put them back.')
  } else if (w.snap !== null || w.holds.length > 0) {
    lines.push('The restore point and the timed pauses are KEPT (use /kcreset all to forget them too).')
  }

  return { ok: true, plan: { ...emptyPlan('reset', all ? 'Reset everything this mod recorded, restore point included' : 'Reset what this mod recorded'), lines, effects: { resetAll: all ? 'everything' : 'data' } } }
}

/** Builds the plan for a request. Pure: the same world and spec always give the same plan, which is how a confirm can check it is still the plan that was previewed. */
export const buildPlan = (spec: Spec, w: World): Built => {
  const arg = spec.arg ?? ''

  switch (spec.kind) {
    case 'off':
    case 'safe':
    case 'panic':
      return { ok: true, plan: offPlan(w, spec.kind) }
    case 'on':
      return restorePlan(w)
    case 'quiet':
      return { ok: true, plan: { ...withTarget(w, emptyPlan('quiet', 'Quiet: /cfg feature quiet'), quietTarget(w.table), [{ t: 'cfg', args: 'feature quiet' }]), lines: ['Replaces every override with the quiet set, so earlier own-switch choices are dropped. /kcundo puts them back.'] } }
    case 'calm':
      return { ok: true, plan: { ...withTarget(w, emptyPlan('calm', 'Calm: /cfg feature calm'), calmTarget(w.table), [{ t: 'cfg', args: 'feature calm' }]), lines: ['Replaces every override with the calm set (rows only for cockpit and alerts). /kcundo puts them back.'] } }
    case 'full':
      return { ok: true, plan: { ...withTarget(w, emptyPlan('full', 'Full: clear every override'), {}, [{ t: 'cfg', args: 'feature full' }]), lines: ['Every switch goes back to its default. /kcundo puts the old ones back.'] } }
    case 'undo':
      return undoPlan(w)
    case 'pause':
    case 'snooze':
      return holdPlan(w, spec.kind, arg)
    case 'release':
      return releasePlan(w, arg)
    case 'dismiss':
      return dismissPlan(w, arg)
    case 'undismiss':
      return undismissPlan(w, arg)
    case 'block-on':
      return blockSwitchPlan(w, true)
    case 'block-off':
      return blockSwitchPlan(w, false)
    case 'rows-keep':
    case 'rows-hide':
    case 'rows-only':
    case 'rows-expand':
      return rowsPlan(w, spec.kind, arg)
    case 'reset':
      return resetPlan(w, arg)
    default:
      return fail('Unknown action.')
  }
}

/** A short fingerprint of what a plan will do to the switches: a confirm runs only if it still equals the previewed one. The row filter is left out: it can only be read again when the job runs. */
export const planSig = (p: Plan): string =>
  JSON.stringify([p.kind, p.ops.filter(o => o.t === 'cfg'), p.flips.map(f => [f.id, f.from, f.to]), p.effects.holds?.length ?? -1, p.effects.resetAll ?? '', p.kind.startsWith('rows') ? p.label : ''])

export const PRESET_KINDS = ['off', 'on', 'safe', 'quiet', 'calm', 'full'] as const
export type PresetKind = (typeof PRESET_KINDS)[number]
export const isPreset = (s: string): s is PresetKind => (PRESET_KINDS as readonly string[]).includes(s)

export const needsTidy = (kind: PlanKind): boolean =>
  ['off', 'on', 'safe', 'panic', 'undo', 'rows-keep', 'rows-hide', 'rows-only', 'rows-expand'].includes(kind)

// ------------------------------------------------------------------ the preview text

export const previewLines = (index: Index, plan: Plan, max = 40): string[] => {
  const out: string[] = [plan.label]
  const real = plan.flips

  if (real.length === 0 && plan.ops.length === 0 && plan.lines.length === 0) {
    out.push('Nothing would change.')
  }
  out.push(real.length === 0 ? 'Switches that would flip: none.' : `Switches that would flip (${real.length}, in ${plan.mods.length} mod${plan.mods.length === 1 ? '' : 's'}):`)

  for (const f of real.slice(0, max)) {
    out.push(`  ${flipLine(index, f)}`)
  }

  if (real.length > max) {
    out.push(`  ... and ${real.length - max} more (/kcpreview <preset> lists up to 200, the Presets tab pages through all of them)`)
  }
  out.push(...plan.lines.map(l => `  ${l}`))
  out.push(`Commands that would run (${plan.ops.length}): ${plan.ops.slice(0, 3).map(o => `/${o.t} ${o.args}`).join(' ; ')}${plan.ops.length > 3 ? ' ; ...' : ''}`)

  return out
}

// ------------------------------------------------------------------ pending (the two step engine)

export type Pending = { spec: Spec; sig: string; createdAt: number; expiresAt: number; label: string }

export const makePending = (spec: Spec, plan: Plan, now: number): Pending => ({ spec, sig: planSig(plan), createdAt: now, expiresAt: now + CONFIRM_MS, label: plan.label })

export const pendingState = (p: Pending | null, now: number): 'none' | 'valid' | 'expired' => (p === null ? 'none' : now < p.expiresAt ? 'valid' : 'expired')

export const secondsLeft = (p: Pending, now: number): number => Math.max(0, Math.ceil((p.expiresAt - now) / 1000))

/** The origins that are a person typing. A plugin, a scheduled task or an SDK call may not confirm. */
export const isPersonOrigin = (origin: unknown): boolean => {
  const kind = isObj(origin) ? origin.kind : undefined

  return kind === 'composer' || kind === 'bridge' || kind === 'unclassified'
}

export const parseDo = (args: string): { kind: 'status' | 'confirm' | 'cancel' } | { kind: 'stage'; spec: Spec } | { kind: 'error'; message: string } => {
  const [first = '', ...rest] = args.trim().toLowerCase().split(/\s+/).filter(w => w !== '')

  if (first === '') {
    return { kind: 'status' }
  }

  if (first === 'confirm' || first === 'cancel') {
    return rest.length > 0 ? { kind: 'error', message: `/kcdo ${first} takes no more words.` } : { kind: first }
  }

  if (isPreset(first) && rest.length === 0) {
    return { kind: 'stage', spec: { kind: first } }
  }

  return { kind: 'error', message: `Usage: /kcdo ${PRESET_KINDS.join('|')} (shows the preview), then /kcdo confirm or /kcdo cancel.` }
}

// ------------------------------------------------------------------ stored data: validation

export const cleanTidy = (raw: unknown): Tidy | null => {
  if (!isObj(raw) || typeof raw.isOn !== 'boolean' || !Array.isArray(raw.keep)) {
    return null
  }

  return { isOn: raw.isOn, keep: raw.keep.filter((n): n is string => typeof n === 'string' && ROW_NAME_RE.test(n)).slice(0, 30) }
}

const cleanOv = (raw: unknown): Overrides => {
  const out: Overrides = {}

  if (isObj(raw)) {
    for (const [id, v] of Object.entries(raw).slice(0, 600)) {
      if (typeof v === 'boolean' && FEATURE_ID_RE.test(id)) {
        out[id] = v
      }
    }
  }

  return out
}

export const cleanSnap = (raw: unknown): Snap | null => {
  if (!isObj(raw) || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) {
    return null
  }
  const src = raw.src === 'safe' || raw.src === 'panic' ? raw.src : 'off'

  return { at: raw.at, src, before: cleanOv(raw.before), tidy: cleanTidy(raw.tidy), tidyTo: cleanTidy(raw.tidyTo) }
}

const cleanTri = (v: unknown): boolean | null | undefined => (v === null || typeof v === 'boolean' ? v : undefined)

export const cleanFlips = (raw: unknown): Flip[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: Flip[] = []

  for (const f of raw.slice(0, 400)) {
    if (isObj(f) && typeof f.id === 'string' && FEATURE_ID_RE.test(f.id)) {
      const from = cleanTri(f.from)
      const to = cleanTri(f.to)

      if (from !== undefined && to !== undefined) {
        out.push({ id: f.id, from, to })
      }
    }
  }

  return out
}

export const cleanHolds = (raw: unknown): Hold[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: Hold[] = []

  for (const h of raw.slice(0, MAX_HOLDS)) {
    if (isObj(h) && typeof h.id === 'string' && FEATURE_ID_RE.test(h.id) && typeof h.until === 'number' && Number.isFinite(h.until)) {
      const before = cleanTri(h.before)

      if (before !== undefined) {
        out.push({ id: h.id, before, until: h.until, src: h.src === 'snooze' ? 'snooze' : 'pause' })
      }
    }
  }

  return out
}

export const cleanChanges = (raw: unknown): Change[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: Change[] = []

  for (const c of raw.slice(-MAX_CHANGES)) {
    if (isObj(c) && typeof c.at === 'number' && typeof c.label === 'string') {
      const from = isObj(c.tidy) ? cleanTidy(c.tidy.from) : null
      const to = isObj(c.tidy) ? cleanTidy(c.tidy.to) : null

      out.push({ at: c.at, label: clip(c.label, 100), flips: cleanFlips(c.flips), tidy: from !== null && to !== null ? { from, to } : null })
    }
  }

  return out
}

export const pushChange = (list: readonly Change[], c: Change): Change[] => [...list, { ...c, label: clip(c.label, 100) }].slice(-MAX_CHANGES)

export const cleanAudit = (raw: unknown): AuditEntry[] => {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .filter((a): a is Record<string, unknown> => isObj(a) && typeof a.at === 'number' && typeof a.what === 'string' && typeof a.result === 'string')
    .slice(-MAX_AUDIT)
    .map(a => ({ at: a.at as number, what: clip(String(a.what), 120), result: clip(String(a.result), 200) }))
}

export const pushAudit = (list: readonly AuditEntry[], a: AuditEntry): AuditEntry[] => [...list, { at: a.at, what: clip(a.what, 120), result: clip(a.result, 200) }].slice(-MAX_AUDIT)

export const cleanDismissed = (raw: unknown): Dismissed => {
  const out: Dismissed = {}

  if (isObj(raw)) {
    for (const [name, d] of Object.entries(raw).slice(0, 60)) {
      if (MOD_RE.test(name) && isObj(d) && typeof d.at === 'number') {
        const before = cleanTri(d.before)
        out[name] = { at: d.at, note: clip(typeof d.note === 'string' ? d.note : '', 100), before: before === undefined ? null : before }
      }
    }
  }

  return out
}

export const cleanPrefs = (raw: unknown): Prefs => {
  const o = isObj(raw) ? raw : {}
  const gap = typeof o.toastGapMin === 'number' && Number.isFinite(o.toastGapMin) ? Math.round(o.toastGapMin) : MIN_TOAST_GAP_MIN

  return { toastGapMin: Math.min(MAX_TOAST_GAP_MIN, Math.max(MIN_TOAST_GAP_MIN, gap)), isLocked: o.isLocked === true }
}

export const cleanOrder = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((n): n is string => typeof n === 'string' && ROW_NAME_RE.test(n)))].slice(0, MAX_ORDER) : []

// ------------------------------------------------------------------ the Bash block list and the per-project allow-list

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export const cleanPiece = (raw: string): string | undefined => {
  const t = norm(raw.replace(/[\u0000-\u001f\u007f]+/g, ' '))

  return t.length >= 2 && t.length <= 80 ? t : undefined
}

export const cleanCwd = (raw: string): string | undefined => {
  const t = raw.trim().replace(/\/+$/, '')

  return t.length >= 1 && t.length <= 200 && !/[\u0000-\u001f\u007f]/.test(t) ? t : '/'
}

export const cleanBlock = (raw: unknown): BlockCfg => {
  const o = isObj(raw) ? raw : {}
  const list = Array.isArray(o.list) ? [...new Set(o.list.filter((x): x is string => typeof x === 'string').map(cleanPiece).filter((x): x is string => x !== undefined))].slice(0, MAX_BLOCK) : []
  const allow: Record<string, string[]> = {}

  if (isObj(o.allow)) {
    for (const [cwd, prefixes] of Object.entries(o.allow).slice(0, MAX_ALLOW_CWDS)) {
      const ok = Array.isArray(prefixes) ? [...new Set(prefixes.filter((x): x is string => typeof x === 'string').map(cleanPiece).filter((x): x is string => x !== undefined))].slice(0, MAX_ALLOW_PREFIXES) : []

      if (cwd.length > 0 && cwd.length <= 200 && ok.length > 0) {
        allow[cwd] = ok
      }
    }
  }

  return { list, allow }
}

/** A command that chains or substitutes: an allowed prefix never exempts it, because the rest of the line could be anything. */
export const hasChaining = (command: string): boolean => /[;&|`\n\r<>]|\$\(|\$\{/.test(command)

export type Verdict =
  | { kind: 'empty' }
  | { kind: 'clear' }
  | { kind: 'blocked'; by: string }
  | { kind: 'allowed'; by: string; prefix: string }

/** Which block piece (if any) stops this command, and whether this project's allow-list exempts it. Only the pieces of THIS mod: tool-guard decides on its own. */
export const judge = (command: string, cfg: BlockCfg, cwd: string): Verdict => {
  if (cfg.list.length === 0) {
    return { kind: 'empty' }
  }
  const c = norm(command.slice(0, 4000))
  const by = cfg.list.find(p => c.includes(p))

  if (by === undefined) {
    return { kind: 'clear' }
  }
  const prefixes = cfg.allow[cleanCwd(cwd) ?? '/'] ?? []
  const prefix = prefixes.find(p => c.startsWith(p))

  return prefix !== undefined && !hasChaining(command) ? { kind: 'allowed', by, prefix } : { kind: 'blocked', by }
}

export const verdictText = (v: Verdict, isOn: boolean): string => {
  const state = isOn ? '' : ' (The block switch is OFF, so nothing is blocked now: /kcblock on.)'

  switch (v.kind) {
    case 'empty':
      return `The block list is empty: nothing would be blocked.${state}`
    case 'clear':
      return `No block piece matches: this mod would let it through.${state} (tool-guard decides on its own.)`
    case 'blocked':
      return `BLOCKED by "${v.by}".${state}`
    case 'allowed':
      return `Matches "${v.by}" but this project allows the prefix "${v.prefix}": let through by this mod.${state} (tool-guard decides on its own.)`
  }
}

// ------------------------------------------------------------------ row order

const bare = (plugin: string) => (plugin.split('@')[0] ?? '').toLowerCase()

/** Listed mods first, in the listed order; every other row after them in its own order. Never drops or repeats a row. */
export const applyOrder = <R extends { plugin: string }>(rows: readonly R[], order: readonly string[]): R[] => {
  const rank = (r: R) => {
    const i = order.indexOf(bare(r.plugin))

    return i === -1 ? order.length : i
  }

  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(x => x.r)
}

export const moveInOrder = (order: readonly string[], name: string, dir: 'up' | 'down' | 'top'): string[] => {
  const list = order.includes(name) ? [...order] : [...order, name]
  const i = list.indexOf(name)
  const j = dir === 'top' ? 0 : dir === 'up' ? Math.max(0, i - 1) : Math.min(list.length - 1, i + 1)

  list.splice(i, 1)
  list.splice(j, 0, name)

  return list.slice(0, MAX_ORDER)
}

// ------------------------------------------------------------------ notice priority and the toast rate limit

export const LEVELS = ['info', 'notice', 'urgent'] as const
export type Level = (typeof LEVELS)[number]
export const LEVEL_TEXT: Readonly<Record<Level, string>> = {
  info: 'kept in the audit log only, no pop-up',
  notice: 'a pop-up, but at most one per rate-limit window (default 3 minutes)',
  urgent: 'a pop-up that skips this mod’s rate limit (the central pop-up switch still applies)',
}

export const isLevel = (s: string): s is Level => (LEVELS as readonly string[]).includes(s)

/** Whether a notice of this level may pop up now. `lastAt` is the time of this mod's last pop-up (0 if none). The central switches are checked elsewhere. */
export const mayToast = (level: Level, lastAt: number, now: number, gapMin: number): boolean =>
  level === 'info' ? false : level === 'urgent' ? true : lastAt === 0 || now - lastAt >= gapMin * 60_000

// ------------------------------------------------------------------ the palette, permissions, network

export type PaletteRow = { mod: string; n: string; d: string }

export const paletteRows = (table: Table, query: string): PaletteRow[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t !== '').slice(0, 6)
  const rows: PaletteRow[] = []

  for (const m of table) {
    for (const c of m.cmds) {
      const hay = `/${c.n} ${c.d} ${m.name}`.toLowerCase()

      if (terms.every(t => hay.includes(t.replace(/^\//, '')))) {
        rows.push({ mod: m.name, n: c.n, d: c.d })
      }
    }
  }

  return rows.sort((a, b) => a.n.localeCompare(b.n))
}

export const pageOf = <T,>(items: readonly T[], page: number, size: number): { rows: T[]; page: number; pages: number } => {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const p = Math.min(Math.max(0, page), pages - 1)

  return { rows: items.slice(p * size, p * size + size), page: p, pages }
}

export const permFlags = (m: TableMod): string => {
  const f = [m.uses.shell ? 'shell' : '', m.uses.files ? 'files' : '', m.uses.network ? 'network' : '', m.uses.webfetch ? 'watches WebFetch' : '', m.uses.store ? 'store' : ''].filter(x => x !== '')

  return f.length === 0 ? 'none of shell, files, network, store' : f.join(' + ')
}

export const permLine = (m: TableMod): string => `${m.name}${m.guard ? ' (guard)' : ''}: ${permFlags(m)}`

export const networkMods = (table: Table): TableMod[] => table.filter(m => m.uses.network || m.uses.webfetch)

// ------------------------------------------------------------------ hotkeys

/** `count` single-letter hotkeys that avoid the reserved keys (digits are the pane's tabs). */
export const pickKeys = (count: number, reserved: readonly string[]): string[] =>
  [...'abcdefghijklmnopqrstuvwxyz'].filter(k => !reserved.includes(k)).slice(0, count)

export const TAB_KEYS: Readonly<Record<string, string>> = { home: '1', presets: '2', timers: '3', palette: '4', perms: '5', network: '6', changes: '7', log: '8', block: '9', rows: '0' }
export const TAB_ORDER = ['home', 'presets', 'timers', 'palette', 'perms', 'network', 'changes', 'log', 'block', 'rows'] as const
export const TAB_LABELS: Readonly<Record<string, string>> = { home: 'Home', presets: 'Presets', timers: 'Timers', palette: 'Palette', perms: 'Permissions', network: 'Network', changes: 'Changes', log: 'Log', block: 'Block', rows: 'Rows' }

// ------------------------------------------------------------------ commands and help

/** Every command this mod registers: name and one line. */
export const COMMANDS: readonly (readonly [string, string])[] = [
  ['kc', 'Open the control pane and list every control-kit command'],
  ['kcoff', 'Master quiet switch: shows what would change, then /kcdo confirm'],
  ['kcon', 'Restore the switches and rows exactly as they were before quiet mode'],
  ['kcpanic', 'Panic button: quiet everything now, fill the prompt with the disable lines'],
  ['kcsafe', 'Safe mode preview: all non-guard switches off plus the disable list'],
  ['kcpause', 'Pause one mod: /kcpause <mod> [minutes up to 240] or /kcpause <mod> off'],
  ['kcsnooze', 'Snooze only the pop-ups and sounds of one mod: /kcsnooze <mod> [minutes]'],
  ['kcdismiss', 'Turn one mod pop-ups off for good, with a note: /kcdismiss <mod> [note] or <mod> undo'],
  ['kcdo', 'Two-step engine: /kcdo off|on|safe|quiet|calm|full then /kcdo confirm or cancel'],
  ['kcpreview', 'Dry run: list the switches a preset would flip: /kcpreview <preset>'],
  ['kcundo', 'Undo the last logged switch change, or /kcundo list the last 30'],
  ['kclock', 'Read-only mode for this mod: /kclock on|off (cannot lock other mods)'],
  ['kclog', 'Audit log of everything this mod did, with time and result: /kclog [page]'],
  ['kcfind', 'Search every mod command by name or words: /kcfind <words>'],
  ['kcperms', 'Which of shell, files, network and store each mod touches: /kcperms [mod]'],
  ['kcnet', 'Which mods use the network (no network switch exists), with disable lines'],
  ['kcdisable', 'Show the exact claude plugin disable line for a mod and put it in the prompt'],
  ['kcblock', 'Bash block list: /kcblock on|off|add <piece>|rm <piece>|list'],
  ['kctest', 'Test a command against the block list without running it: /kctest <command>'],
  ['kcallow', 'Per-project allow prefixes for the block list: /kcallow add|rm|list [prefix]'],
  ['kclimit', 'Minutes between this mod pop-ups: /kclimit <3 to 120>'],
  ['kcprio', 'Notice priority levels, with a preview: /kcprio or /kcprio test <info|notice|urgent>'],
  ['kcrows', 'Rows above the prompt: /kcrows keep|hide <mod>, only <mod>, expand, show'],
  ['kcorder', 'Row order (needs the reorder switch): /kcorder show|set <mods>|up|down|top <mod>|clear'],
  ['kckeys', 'List the pane hotkeys'],
  ['kcnext', 'Put the next queued /cfg or /tidy line in the prompt (after a refused run)'],
  ['kcreset', 'Clear what this mod recorded (two-step): /kcreset or /kcreset all'],
]

export const helpText = (): string =>
  [
    'control-kit: the control surface for the other mods. Nothing here runs at start; every bulk change is previewed first.',
    ...COMMANDS.map(([n, d]) => `/${n}  ${d}`),
    'Small changes (one mod, four switches or fewer) run at once and print what flipped. Bulk ones wait for /kcdo confirm (2 minutes). Only /kcpanic is confirm-free.',
    'Honest limits: this mod cannot disable, pause or uninstall plugins (it prints claude plugin disable lines instead), cannot lock other mods, and cannot mute the three guards.',
  ].join('\n')

export const fmtTime = when
