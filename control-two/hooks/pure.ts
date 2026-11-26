// Pure logic of control-two: nothing here touches the engine, a process, the network or the disk.
// register.tsx wires it up; pure.test.ts tests it.
import type {
  Applied,
  ErrEntry,
  HealthRow,
  Installed,
  InstalledStatus,
  Kind,
  Light,
  Metric,
  Note,
  OrderRow,
  Pending,
  Pin,
  Rule,
  SaveMode,
  Snap,
  SnapOwn,
  Stat,
} from '../types'
import { CHANGELOG } from './changelog'
import type { Change as ChangeRow } from './changelog'
import { BUILT_AT, DUPLICATES, MODS } from './data'
import type { ModRow } from './data'

// ------------------------------------------------------------------ constants

export const PREFIX = 'kx'
export const SELF = 'control-two'
export const VERSION = '0.1.0'
export const PANE = 'control-two-main'
/** Their messages and rows can never be switched off (settings keeps them locked). */
export const LOCKED: readonly string[] = ['settings', 'tool-guard', 'safety-pro', 'controls']
export const KINDS: readonly Kind[] = ['band', 'toasts', 'sounds', 'status']
export const METRICS: readonly Metric[] = ['ctx', 'cost', 'limit']
export const YES_WORD = 'confirm'

export const MAX_RULES = 10
export const MAX_RULE_CALLS = 10
export const MAX_SNAPS = 5
export const MAX_PINS = 30
export const MAX_NOTES = 50
export const NOTE_MAX = 280
export const MAX_TIMING = 60
export const MAX_ERRORS = 100
export const MAX_ORDER = 60
export const MAX_REFUSALS = 40
/** At most this many /cfg calls in one go (under 40); a longer plan is finished by running the command again. */
export const MAX_SOUND_CALLS = 39
export const MAX_RESTORE_CALLS = 60
export const MAX_OVERRIDES = 600
export const PENDING_MS = 120_000
export const CALL_TIMEOUT_MS = 10_000
export const CALL_GAP_MS = 80
export const RUN_TIMEOUT_MS = 30_000

export const FEATURE_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}\.[a-z0-9][a-z0-9-]{0,40}$/
export const MOD_RE = /^[a-z0-9][a-z0-9-]{0,40}$/
export const VERSION_RE = /^v?\d+(\.\d+){0,3}(-[0-9A-Za-z.-]{1,20})?$/

/** Every command of this mod and its one-line help. The first is the bare prefix. */
export const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['kx', 'Control two: open the pane and list every command', ''],
  ['kxquick', 'Open the quick controls (motion, calm, sounds, recording) or another tab', '[tab]'],
  ['kxmotion', 'Quick motion toggle: runs /motion on|off', '[on|off]'],
  ['kxcalm', 'Quick calm toggle: runs /cfg calm on|off', '[on|off]'],
  ['kxsounds', 'Quick sounds toggle: flips the sounds switch of every mod, one /cfg feature call each', '[on|off]'],
  ['kxrecording', 'Quick recording flag kept by this mod (other mods do not read it)', '[on|off]'],
  ['kxsave', 'Keep this mod\'s own settings for later sessions (saved) or for this session only', 'saved | session'],
  ['kxrules', 'Row visibility rules, evaluated after each turn when the rules switch is on', 'add | rm <n> | list | run | restore | clear'],
  ['kxreset', 'Reset this mod\'s data and /cfg feature reset, in two steps (second step: confirm)', '[list] | confirm | cancel'],
  ['kxresetmod', 'Show and fill the reset command of one mod (never runs it)', '[mod]'],
  ['kxbackup', 'Snapshot this mod\'s settings and the current switch overrides (last 5 kept)', '[list | clear]'],
  ['kxrestore', 'Preview, then re-apply, the switch overrides of a snapshot', '[n] | <n> confirm'],
  ['kxupdates', 'Read-only check: installed versions against the versions this mod was built with', ''],
  ['kxrollback', 'Why a local mod cannot be rolled back here, and how git could do it', '[mod]'],
  ['kxpin', 'A note list of versions you want to stay on (nothing enforces it)', '<mod> <version> [note] | rm <mod>'],
  ['kxhealth', 'Health light per mod from what this session can observe', '[mod]'],
  ['kxerrors', 'Error log per mod from log lines and hook failures (needs the errors switch)', '[mod | clear]'],
  ['kxselftest', 'List documented self-test commands and put one in the prompt box', '[mod]'],
  ['kxdiag', 'Diagnostics text: versions, mods, switch overrides, counts (no paths, no user name)', ''],
  ['kxtiming', 'Time the hooks of pop-ups and status writes per mod (needs the timing switch)', '[clear]'],
  ['kxstorage', 'Size of the keys this mod keeps in its own store', ''],
  ['kxhooks', 'Order of the hooks beneath this mod (needs the hookorder switch)', ''],
  ['kxconflicts', 'Duplicate command scan, live owners and refused registrations', ''],
  ['kxdeps', 'Which mod needs which: a graph on the desktop, a list elsewhere', ''],
  ['kxchanges', 'Plain-language changelog of all mods', '[mod]'],
  ['kxfeedback', 'Keep a note about a mod: list, add or clear', '[<mod> <text> | clear <mod|all>]'],
]

export const TABS: readonly (readonly [string, string])[] = [
  ['quick', 'Quick'],
  ['rules', 'Rules'],
  ['health', 'Health'],
  ['updates', 'Updates'],
  ['backups', 'Backups'],
  ['hooks', 'Hooks'],
  ['graph', 'Graph'],
  ['changes', 'Changes'],
  ['feedback', 'Feedback'],
  ['diag', 'Diag'],
]

export const isTab = (v: unknown): v is string => typeof v === 'string' && TABS.some(([id]) => id === v)

// ------------------------------------------------------------------ mods

export const selfRow = (): ModRow => ({
  name: SELF,
  version: VERSION,
  desc: 'Quick controls and diagnostics (this mod)',
  help: PREFIX,
  deps: ['motion', 'settings'],
  cmds: COMMANDS.map(c => c[0]),
  reset: 'kxreset',
  selftest: null,
  own: 0,
})

/** The mods of the build-time table plus this one, by name. */
export const allMods = (): readonly ModRow[] => [...MODS.filter(m => m.name !== SELF), selfRow()]

export const findMod = (name: string): ModRow | undefined => {
  const n = bareName(name)

  return allMods().find(m => m.name === n)
}

export const bareName = (plugin: unknown): string => (typeof plugin === 'string' ? (plugin.split('@')[0] ?? '').trim().toLowerCase() : '')

export const isLocked = (mod: string): boolean => LOCKED.includes(bareName(mod))

// ------------------------------------------------------------------ small text helpers

export const clip = (text: string, max: number): string => {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length <= max ? one : `${one.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

export const stripAnsi = (text: string): string => text.replace(ANSI_RE, '').replace(CTRL_RE, '')

const SECRET_RULES: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]'],
  [/\b(?:sk|pk|rk)-(?:ant-|live-|proj-)?[A-Za-z0-9_-]{16,}/g, '[secret]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[secret]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[secret]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[secret]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[secret]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[secret]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[jwt]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [secret]'],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]*@/gi, '$1[credentials]@'],
  [
    /\b((?:[A-Za-z0-9_]*(?:token|secret|password|passwd|apikey|api[_-]key|authorization|auth)[A-Za-z0-9_]*))(\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&]+)/gi,
    '$1$2[masked]',
  ],
]

export const maskSecrets = (text: string): string => SECRET_RULES.reduce((acc, [re, sub]) => acc.replace(re, sub), text)

// A home directory is machine-specific and holds the user name: show it as ~ in anything shown or kept.
const HOME_RE = new RegExp(`(?:[A-Za-z]:)?[\\\\/](?:${['Users', 'home'].join('|')})[\\\\/][^\\\\/\\s:'"]+`, 'g')

export const maskPaths = (text: string, home?: string): string => {
  let out = text

  if (home !== undefined && home.length > 3) {
    out = out.split(home).join('~')
  }

  return out.replace(HOME_RE, '~')
}

/** Clean text that came from a process or another mod before it is shown or kept. */
export const sanitize = (text: string, home?: string): string => maskPaths(maskSecrets(stripAnsi(text)), home)

export const pad = (text: string, n: number): string => (text.length >= n ? text : text + ' '.repeat(n - text.length))

export const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(2)} MiB`)

export const fmtMs = (n: number): string => (n < 10 ? `${n.toFixed(1)} ms` : `${Math.round(n)} ms`)

export const fmtClock = (ms: number): string => {
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')

  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** The size of a value as JSON text, in bytes of UTF-16 code units (an upper bound for the store's count). */
export const sizeOf = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ------------------------------------------------------------------ on/off words

export type OnOff = { ok: true; value: 'on' | 'off' | 'toggle' | 'status' } | { ok: false; message: string }

export const parseOnOff = (args: string): OnOff => {
  const word = args.trim().toLowerCase()

  if (word === '') {
    return { ok: true, value: 'toggle' }
  }

  if (word === 'on' || word === 'off') {
    return { ok: true, value: word }
  }

  if (word === 'status') {
    return { ok: true, value: 'status' }
  }

  return { ok: false, message: 'Say on, off, status, or nothing to flip it.' }
}

// ------------------------------------------------------------------ switches

export type Overrides = Record<string, boolean>

/** Overrides that look right: `<mod>.<id>` names with a boolean value, at most 600. */
export const cleanOverrides = (raw: unknown): Overrides => {
  const out: Overrides = {}

  if (!isRecord(raw)) {
    return out
  }
  let n = 0

  for (const [id, value] of Object.entries(raw)) {
    if (n >= MAX_OVERRIDES) {
      break
    }

    if (typeof value === 'boolean' && FEATURE_ID_RE.test(id)) {
      out[id] = value
      n++
    }
  }

  return out
}

export const isOn = (o: Overrides, id: string, dflt: boolean): boolean => o[id] ?? dflt

/** `feature <mod>.<id> on|off|default`: the arguments of `/cfg`. */
export const featureArgs = (id: string, to: 'on' | 'off' | 'default'): string => `feature ${id} ${to}`

/** Mods whose sounds this mod may flip: every mod of the table except the locked ones. */
export const soundMods = (): string[] => allMods().map(m => m.name).filter(n => !isLocked(n))

export type SoundsState = 'on' | 'off' | 'mixed'

export const soundsState = (o: Overrides): SoundsState => {
  const mods = soundMods()
  const off = mods.filter(m => o[`${m}.sounds`] === false).length

  return off === 0 ? 'on' : off === mods.length ? 'off' : 'mixed'
}

/** The `/cfg` calls that make every mod's sounds `target`; only mods that differ get one. */
export const soundsPlan = (o: Overrides, target: 'on' | 'off'): string[] => {
  const calls: string[] = []

  for (const mod of soundMods()) {
    const cur = o[`${mod}.sounds`] ?? true

    if (cur !== (target === 'on')) {
      calls.push(featureArgs(`${mod}.sounds`, target))
    }
  }

  return calls
}

/** One go of a plan: the first 39 calls, and how many are left for the next run of the command. */
export const soundsBatch = (plan: readonly string[]): { calls: string[]; rest: number } => ({ calls: plan.slice(0, MAX_SOUND_CALLS), rest: Math.max(0, plan.length - MAX_SOUND_CALLS) })

// ------------------------------------------------------------------ rules (176)

export type Metrics = { ctx: number | null; cost: number | null; limit: number | null }

export const metricText = (m: Metric): string => (m === 'ctx' ? 'context %' : m === 'cost' ? 'cost USD' : 'rate limit %')

export const ruleId = (r: Rule): string => `${r.mod}.${r.kind}`

export const ruleText = (r: Rule): string =>
  `${r.action} ${r.mod} ${r.kind} while ${r.metric} ${r.op === 'ge' ? '>=' : '<'} ${r.value}`

export const RULE_USAGE =
  'Usage: /kxrules add <mod> <band|toasts|sounds|status> <hide|show> [when] <ctx|cost|limit> <>=|<> <number>   e.g. /kxrules add cockpit band hide when ctx >= 70'

export type RuleParse = { ok: true; rule: Rule } | { ok: false; message: string }

export const parseRule = (args: string): RuleParse => {
  const words = args
    .trim()
    .toLowerCase()
    .replace(/(>=|<=|>|<)/g, ' $1 ')
    .split(/\s+/)
    .filter(w => w !== '' && w !== 'when' && w !== 'while')
  const [mod = '', kind = '', action = '', metric = '', op = '', num = ''] = words

  if (words.length !== 6) {
    return { ok: false, message: RULE_USAGE }
  }

  if (findMod(mod) === undefined) {
    return { ok: false, message: `"${clip(mod, 40)}" is not a mod this table knows. ${RULE_USAGE}` }
  }

  if (isLocked(mod)) {
    return { ok: false, message: `${mod} is a safety or settings mod: its messages and rows cannot be switched off, so no rule can hide it.` }
  }

  if (!KINDS.includes(kind as Kind)) {
    return { ok: false, message: `Kind must be one of ${KINDS.join(', ')}.` }
  }

  if (action !== 'hide' && action !== 'show') {
    return { ok: false, message: 'Say hide or show.' }
  }

  if (!METRICS.includes(metric as Metric)) {
    return { ok: false, message: `Metric must be one of ${METRICS.join(', ')}.` }
  }
  const opNorm = op === '>=' || op === '>' || op === 'ge' ? 'ge' : op === '<' || op === '<=' || op === 'lt' ? 'lt' : ''
  const value = Number(num)
  const limit = metric === 'cost' ? 10_000 : 100

  if (opNorm === '' || !/^\d+(\.\d{1,2})?$/.test(num) || !Number.isFinite(value) || value < 0 || value > limit) {
    return { ok: false, message: `Use >= or <, then a number from 0 to ${limit}. ${RULE_USAGE}` }
  }

  return { ok: true, rule: { mod, kind: kind as Kind, action, metric: metric as Metric, op: opNorm, value } }
}

export const normalizeRules = (raw: unknown): Rule[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: Rule[] = []

  for (const r of raw) {
    if (out.length >= MAX_RULES || !isRecord(r)) {
      continue
    }
    const mod = typeof r.mod === 'string' ? r.mod : ''
    const value = typeof r.value === 'number' ? r.value : NaN

    if (
      findMod(mod) !== undefined &&
      !isLocked(mod) &&
      KINDS.includes(r.kind as Kind) &&
      (r.action === 'hide' || r.action === 'show') &&
      METRICS.includes(r.metric as Metric) &&
      (r.op === 'ge' || r.op === 'lt') &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 10_000
    ) {
      out.push({ mod, kind: r.kind as Kind, action: r.action, metric: r.metric as Metric, op: r.op, value })
    }
  }

  return out
}

export const normalizeApplied = (raw: unknown): Applied => {
  const out: Applied = {}

  if (!isRecord(raw)) {
    return out
  }

  for (const [id, v] of Object.entries(raw).slice(0, MAX_RULES * 2)) {
    if (FEATURE_ID_RE.test(id) && isRecord(v) && typeof v.orig === 'boolean' && typeof v.set === 'boolean') {
      out[id] = { orig: v.orig, set: v.set }
    }
  }

  return out
}

export const ruleMatches = (r: Rule, m: Metrics): boolean => {
  const v = m[r.metric]

  if (v === null || !Number.isFinite(v)) {
    return false
  }

  return r.op === 'ge' ? v >= r.value : v < r.value
}

export type RulePlan = { calls: { id: string; on: boolean }[]; applied: Applied }

/**
 * What to change now. A switch a rule moved is put back when no rule matches it any more, unless somebody else changed
 * it in between (then it is left alone and forgotten). Later rules win over earlier ones for the same switch.
 */
export const planRules = (rules: readonly Rule[], applied: Applied, overrides: Overrides, m: Metrics): RulePlan => {
  const want = new Map<string, boolean>()

  for (const r of rules) {
    if (ruleMatches(r, m)) {
      want.set(ruleId(r), r.action === 'show')
    }
  }
  const calls: { id: string; on: boolean }[] = []
  const next: Applied = { ...applied }

  for (const [id, w] of want) {
    const cur = overrides[id] ?? true

    if (cur !== w) {
      calls.push({ id, on: w })
      next[id] = { orig: next[id]?.orig ?? cur, set: w }
    } else if (next[id] !== undefined) {
      next[id] = { orig: next[id]?.orig ?? cur, set: w }
    }
  }

  for (const [id, a] of Object.entries(applied)) {
    if (want.has(id)) {
      continue
    }
    const cur = overrides[id] ?? true

    if (cur === a.set && cur !== a.orig) {
      calls.push({ id, on: a.orig })
    }
    delete next[id]
  }

  return { calls: calls.slice(0, MAX_RULE_CALLS), applied: next }
}

/** The calls that put every switch a rule moved back where it was. */
export const restoreCalls = (applied: Applied, overrides: Overrides): { id: string; on: boolean }[] =>
  Object.entries(applied)
    .filter(([id, a]) => (overrides[id] ?? true) === a.set && a.set !== a.orig)
    .map(([id, a]) => ({ id, on: a.orig }))
    .slice(0, MAX_RULE_CALLS)

export const metricsFromUsage = (u: unknown): Metrics => {
  const r = isRecord(u) ? u : {}
  const ctx = isRecord(r.context) && typeof r.context.percent === 'number' ? r.context.percent : null
  const cost = isRecord(r.cost) && typeof r.cost.usd === 'number' ? r.cost.usd : null
  const limits = Array.isArray(r.rateLimits) ? r.rateLimits : []
  let limit: number | null = null

  for (const l of limits) {
    if (isRecord(l) && typeof l.percentUsed === 'number') {
      limit = Math.max(limit ?? 0, l.percentUsed)
    }
  }

  return { ctx, cost, limit }
}

// ------------------------------------------------------------------ own data: pins, notes, snapshots

export const normalizePins = (raw: unknown): Pin[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: Pin[] = []

  for (const p of raw) {
    if (out.length < MAX_PINS && isRecord(p) && typeof p.mod === 'string' && findMod(p.mod) !== undefined && typeof p.version === 'string' && VERSION_RE.test(p.version)) {
      out.push({ mod: p.mod, version: p.version, note: clip(sanitize(typeof p.note === 'string' ? p.note : ''), 120) })
    }
  }

  return out
}

export type PinCmd =
  | { kind: 'list' }
  | { kind: 'rm'; mod: string }
  | { kind: 'add'; pin: Pin }
  | { kind: 'error'; message: string }

export const PIN_USAGE = 'Usage: /kxpin | /kxpin <mod> <version> [note] | /kxpin rm <mod>. A pin is a note: nothing stops an update.'

export const parsePin = (args: string): PinCmd => {
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  const [first = '', second = '', ...rest] = words

  if (first === '') {
    return { kind: 'list' }
  }

  if (first.toLowerCase() === 'rm') {
    return second !== '' && findMod(second) !== undefined ? { kind: 'rm', mod: bareName(second) } : { kind: 'error', message: PIN_USAGE }
  }

  if (findMod(first) === undefined) {
    return { kind: 'error', message: `"${clip(first, 40)}" is not a mod this table knows. ${PIN_USAGE}` }
  }

  if (!VERSION_RE.test(second)) {
    return { kind: 'error', message: `"${clip(second, 24)}" is not a version like 0.1.0. ${PIN_USAGE}` }
  }

  return { kind: 'add', pin: { mod: bareName(first), version: second.replace(/^v/, ''), note: clip(sanitize(rest.join(' ')), 120) } }
}

export const withPin = (pins: readonly Pin[], pin: Pin): Pin[] => [...pins.filter(p => p.mod !== pin.mod), pin].slice(-MAX_PINS)

export const normalizeNotes = (raw: unknown): Note[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: Note[] = []

  for (const n of raw) {
    if (isRecord(n) && typeof n.at === 'number' && typeof n.mod === 'string' && findMod(n.mod) !== undefined && typeof n.text === 'string') {
      out.push({ at: n.at, mod: bareName(n.mod), text: clip(sanitize(n.text), NOTE_MAX) })
    }
  }

  return out.slice(-MAX_NOTES)
}

export type NoteCmd =
  | { kind: 'list'; mod: string }
  | { kind: 'clear'; mod: string }
  | { kind: 'add'; mod: string; text: string }
  | { kind: 'error'; message: string }

export const NOTE_USAGE = 'Usage: /kxfeedback [mod] | /kxfeedback <mod> <text> | /kxfeedback clear <mod|all>'

export const parseNote = (args: string): NoteCmd => {
  const trimmed = args.trim()
  const [first = '', ...rest] = trimmed.split(/\s+/).filter(w => w !== '')

  if (first === '') {
    return { kind: 'list', mod: '' }
  }

  if (first.toLowerCase() === 'clear') {
    const target = (rest[0] ?? '').toLowerCase()

    return target === 'all' || (target !== '' && findMod(target) !== undefined) ? { kind: 'clear', mod: target } : { kind: 'error', message: NOTE_USAGE }
  }

  if (findMod(first) === undefined) {
    return { kind: 'error', message: `"${clip(first, 40)}" is not a mod this table knows. ${NOTE_USAGE}` }
  }

  if (rest.length === 0) {
    return { kind: 'list', mod: bareName(first) }
  }
  const text = clip(sanitize(rest.join(' ')), NOTE_MAX)

  return text.length < 3 ? { kind: 'error', message: 'The note is too short.' } : { kind: 'add', mod: bareName(first), text }
}

export const withNote = (notes: readonly Note[], note: Note): Note[] => [...notes, note].slice(-MAX_NOTES)

export const normalizeSnaps = (raw: unknown): Snap[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: Snap[] = []

  for (const s of raw) {
    if (!isRecord(s) || typeof s.at !== 'number' || !isRecord(s.own)) {
      continue
    }
    const own = s.own
    out.push({
      at: s.at,
      label: clip(sanitize(typeof s.label === 'string' ? s.label : ''), 40),
      overrides: cleanOverrides(s.overrides),
      own: {
        recording: own.recording === true,
        persist: own.persist === 'session' ? 'session' : 'saved',
        rules: normalizeRules(own.rules),
        pins: normalizePins(own.pins),
      },
    })
  }

  return out.slice(-MAX_SNAPS)
}

export const makeSnap = (at: number, label: string, overrides: Overrides, own: SnapOwn): Snap => ({ at, label: clip(label, 40), overrides: cleanOverrides(overrides), own })

/** The newest snapshot last; at most five, the oldest dropped. */
export const pushSnap = (snaps: readonly Snap[], snap: Snap): Snap[] => [...snaps, snap].slice(-MAX_SNAPS)

export type Change = { id: string; to: 'on' | 'off' | 'default' }

/** The switch changes that turn `current` into `target`; ids of locked mods and bad ids are left out and counted. */
export const diffOverrides = (current: Overrides, target: Overrides): { changes: Change[]; skipped: number } => {
  const changes: Change[] = []
  let skipped = 0
  const ids = new Set([...Object.keys(current), ...Object.keys(target)])

  for (const id of [...ids].sort()) {
    const mod = id.split('.')[0] ?? ''

    if (!FEATURE_ID_RE.test(id) || findMod(mod) === undefined || isLocked(mod)) {
      skipped++
      continue
    }
    const want = target[id]
    const have = current[id]

    if (want === have) {
      continue
    }
    changes.push({ id, to: want === undefined ? 'default' : want ? 'on' : 'off' })
  }

  return { changes, skipped }
}

export const changeLine = (c: Change): string => `/cfg ${featureArgs(c.id, c.to)}`

// ------------------------------------------------------------------ pending two-step actions

export const makePending = (kind: Pending['kind'], now: number, n: number, steps: string[]): Pending => ({
  kind,
  createdAt: now,
  expiresAt: now + PENDING_MS,
  n,
  steps: steps.slice(0, MAX_RESTORE_CALLS),
})

export const pendingState = (p: Pending | null, now: number): 'none' | 'valid' | 'expired' => (p === null ? 'none' : now <= p.expiresAt ? 'valid' : 'expired')

export const secondsLeft = (p: Pending, now: number): number => Math.max(0, Math.ceil((p.expiresAt - now) / 1000))

/** A command that only the person may confirm: not one a plugin raised through `$.command.run`. */
export const isPersonOrigin = (origin: unknown): boolean => isRecord(origin) && origin.kind !== 'plugin'

// ------------------------------------------------------------------ reset commands (183, 184)

export const resetCommands = (): { mod: string; command: string }[] =>
  allMods()
    .filter(m => m.name !== SELF && m.reset !== null)
    .map(m => ({ mod: m.name, command: m.reset ?? '' }))

export const noResetMods = (): string[] => allMods().filter(m => m.name !== SELF && m.reset === null).map(m => m.name)

export const resetListText = (): string => resetCommands().map(r => `/${r.command}`).join('\n')

// ------------------------------------------------------------------ versions and the installed list (186, 198)

type Parsed = { nums: number[]; pre: string[] }

const parseVersion = (v: string): Parsed | null => {
  const m = /^v?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim())

  if (m === null || m[1] === undefined) {
    return null
  }

  return { nums: m[1].split('.').map(Number), pre: m[2] === undefined ? [] : m[2].split('.') }
}

/** -1 when a is older than b, 1 when newer, 0 when equal, null when either is not a version. */
export const compareVersions = (a: string, b: string): -1 | 0 | 1 | null => {
  const x = parseVersion(a)
  const y = parseVersion(b)

  if (x === null || y === null) {
    return null
  }

  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)

    if (d !== 0) {
      return d < 0 ? -1 : 1
    }
  }

  if (x.pre.length === 0 || y.pre.length === 0) {
    return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1
  }

  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]

    if (p === undefined || q === undefined) {
      return p === undefined ? -1 : 1
    }

    if (p === q) {
      continue
    }
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)

    if (pn && qn) {
      return Number(p) < Number(q) ? -1 : 1
    }

    if (pn !== qn) {
      return pn ? -1 : 1
    }

    return p < q ? -1 : 1
  }

  return 0
}

// Finding the CLI: the same approach the mod manager uses (PATH `claude`, then the desktop app's bundled binary).

export type DirEntry = { name: string; kind: string }

export const parseVersionDir = (name: string): number[] | null => (/^\d+(\.\d+){1,3}$/.test(name) ? name.split('.').map(Number) : null)

export const compareParts = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)

    if (d !== 0) {
      return d
    }
  }

  return 0
}

export const versionDirsHighestFirst = (entries: readonly DirEntry[]): string[] =>
  entries
    .filter(e => e.kind === 'dir')
    .map(e => ({ name: e.name, parts: parseVersionDir(e.name) }))
    .filter((e): e is { name: string; parts: number[] } => e.parts !== null)
    .sort((a, b) => compareParts(b.parts, a.parts))
    .map(e => e.name)

export const CLAUDE_DIR = 'Library/Application Support/Claude/claude-code'
export const CLAUDE_BIN = 'claude.app/Contents/MacOS/claude'

export const isSafeHome = (home: string | undefined): home is string =>
  home !== undefined && home.length > 1 && home.startsWith('/') && !/[\u0000-\u001f]/.test(home) && !home.split('/').includes('..')

/** Up to four candidate paths of the app's bundled binary, best first; the caller tries each with `--version`. */
export const discoverBundled = async (home: string | undefined, list: (path: string) => Promise<readonly DirEntry[]>): Promise<string[]> => {
  if (!isSafeHome(home)) {
    return []
  }
  const root = `${home.replace(/\/+$/, '')}/${CLAUDE_DIR}`
  const top = await list(root).catch(() => [] as DirEntry[])
  const found: string[] = []

  for (const version of versionDirsHighestFirst(top).slice(0, 3)) {
    const inside = await list(`${root}/${version}`).catch(() => [] as DirEntry[])
    const hashes = inside
      .filter(e => e.kind === 'dir' && !e.name.startsWith('.') && /^[A-Za-z0-9_-]{1,80}$/.test(e.name))
      .map(e => e.name)
      .sort()

    for (const hash of hashes) {
      found.push(`${root}/${version}/${hash}/${CLAUDE_BIN}`)
    }

    if (found.length >= 4) {
      break
    }
  }

  return found.slice(0, 4)
}

export const looksLikeVersionOutput = (stdout: string): boolean => /\b\d+\.\d+\.\d+/.test(stdout)

const clean = (v: unknown, max: number): string => clip(stripAnsi(typeof v === 'string' || typeof v === 'number' ? String(v) : ''), max)
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(@[A-Za-z0-9._-]{1,127})?$/

const mkInstalled = (id: string, version: string, scope: string, status: InstalledStatus): Installed => {
  const at = id.indexOf('@')

  return { id, name: at < 0 ? id : id.slice(0, at), market: at < 0 ? '' : id.slice(at + 1), version: clip(version, 32), scope: clip(scope, 16), status }
}

const statusFromWords = (text: string): InstalledStatus => {
  const t = text.toLowerCase()

  if (/disabled/.test(t)) {
    return 'disabled'
  }

  return /enabled/.test(t) ? 'enabled' : 'error'
}

export type ListParse = { ok: true; list: Installed[] } | { ok: false; error: string }

/**
 * Reads the output of `claude plugin list --json` (an array) or of the plain `claude plugin list` (blocks of
 * "name@market / Version: / Scope: / Status:"). Only id, version, scope and status are kept: folders the output
 * names are never stored.
 */
export const parsePluginList = (text: string): ListParse => {
  const body = stripAnsi(text).trim()

  if (body.startsWith('[') || body.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(body)
      const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.plugins) ? data.plugins : null

      if (rows === null) {
        return { ok: false, error: 'plugin list gave JSON that is not a list' }
      }
      const list: Installed[] = []

      for (const row of rows.slice(0, 500)) {
        const r = isRecord(row) ? row : {}
        const id = clean(r.id ?? r.name, 128)

        if (!ID_RE.test(id)) {
          continue
        }
        list.push(mkInstalled(id, clean(r.version, 32), clean(r.scope, 16), r.enabled === false ? 'disabled' : r.enabled === true ? 'enabled' : 'error'))
      }

      return { ok: true, list }
    } catch {
      return { ok: false, error: 'plugin list gave JSON that could not be read' }
    }
  }
  const list: Installed[] = []
  let cur: { id: string; version: string; scope: string; status: InstalledStatus } | undefined
  const flush = () => {
    if (cur !== undefined) {
      list.push(mkInstalled(cur.id, cur.version, cur.scope, cur.status))
    }
    cur = undefined
  }

  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const head = /^(?:[^\sA-Za-z0-9]{1,3}\s+)?([A-Za-z0-9][A-Za-z0-9._-]*(?:@[A-Za-z0-9._-]+)?)$/.exec(line)
    const kv = /^([A-Za-z ]{3,12}):\s*(.*)$/.exec(line)

    if (kv !== null && cur !== undefined) {
      const key = (kv[1] ?? '').toLowerCase()
      const val = kv[2] ?? ''

      if (key === 'version') {
        cur.version = val
      } else if (key === 'scope') {
        cur.scope = val
      } else if (key === 'status') {
        cur.status = statusFromWords(val)
      }
    } else if (head !== null && kv === null && !/^installed plugins/i.test(line) && (line.includes('@') || /^[^\sA-Za-z0-9]/.test(line))) {
      flush()
      cur = { id: head[1] ?? '', version: '', scope: '', status: 'error' }
    }

    if (list.length >= 500) {
      break
    }
  }
  flush()

  if (list.length === 0 && !/no plugins/i.test(body)) {
    return { ok: false, error: 'plugin list gave output this mod does not recognise' }
  }

  return { ok: true, list }
}

export type UpdateState = 'newer-in-table' | 'same' | 'installed-newer' | 'not-installed' | 'disabled' | 'unknown'
export type UpdateRow = { mod: string; installed: string; table: string; state: UpdateState; pin: string }

export const findInstalled = (list: readonly Installed[], name: string): Installed | undefined => list.find(i => i.name === name)

/** One row per mod of the table. "newer-in-table" means the version this mod was built with is newer than the installed one. */
export const compareUpdates = (list: readonly Installed[], pins: readonly Pin[]): UpdateRow[] =>
  allMods().map(m => {
    const have = findInstalled(list, m.name)
    const pin = pins.find(p => p.mod === m.name)?.version ?? ''

    if (have === undefined) {
      return { mod: m.name, installed: '', table: m.version, state: 'not-installed', pin }
    }
    const c = compareVersions(have.version, m.version)
    const state: UpdateState = have.status === 'disabled' ? 'disabled' : c === null ? 'unknown' : c < 0 ? 'newer-in-table' : c > 0 ? 'installed-newer' : 'same'

    return { mod: m.name, installed: have.version, table: m.version, state, pin }
  })

export const updateCount = (rows: readonly UpdateRow[]): number => rows.filter(r => r.state === 'newer-in-table').length

export const updateLine = (r: UpdateRow): string => {
  const what =
    r.state === 'newer-in-table'
      ? `installed ${r.installed}, built with ${r.table}: newer available`
      : r.state === 'same'
        ? `${r.installed}: same as the table`
        : r.state === 'installed-newer'
          ? `installed ${r.installed} is newer than the table (${r.table})`
          : r.state === 'disabled'
            ? `${r.installed}: installed but disabled`
            : r.state === 'unknown'
              ? `installed ${r.installed || '?'}: version could not be compared`
              : 'not installed (or not in plugin list)'

  return `${r.mod}: ${what}${r.pin !== '' ? ` · pinned note: ${r.pin}${r.installed !== '' && compareVersions(r.installed, r.pin) !== 0 ? ' (differs from installed)' : ''}` : ''}`
}

export const rollbackText = (mod: string): string => {
  const name = findMod(mod)?.name ?? '<mod>'

  return [
    `Rolling ${name} back is not possible from here.`,
    'Local mods are plain folders: a plugin has one folder and one version, with no history kept, and a plugin cannot install or replace another.',
    'If your mods folder is a git repository you could do it yourself, in a terminal (nothing below was run):',
    `  git -C <your mods folder> log --oneline -- ${name}        # find the commit with the version you want`,
    `  git -C <your mods folder> checkout <commit> -- ${name}    # put that version of the folder back`,
    `  claude plugin update ${name}                              # let the app read the folder again`,
    'Without git, copy the folder somewhere safe before an update: that copy is your rollback.',
  ].join('\n')
}

// ------------------------------------------------------------------ health (189), conflicts (196), self-tests (191)

export type LiveCmd = { name: string; plugin?: string; source?: string }

export const normalizeLive = (raw: unknown): LiveCmd[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: LiveCmd[] = []

  for (const c of raw.slice(0, 5000)) {
    if (isRecord(c) && typeof c.name === 'string') {
      out.push({ name: c.name, plugin: typeof c.plugin === 'string' ? bareName(c.plugin) : undefined, source: typeof c.source === 'string' ? c.source : undefined })
    }
  }

  return out
}

const ownersOf = (live: readonly LiveCmd[]): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>()

  for (const c of live) {
    const set = map.get(c.name) ?? new Set<string>()
    set.add(c.plugin ?? '?')
    map.set(c.name, set)
  }

  return map
}

export const LIGHT_WORD: Record<Light, string> = { green: 'good', amber: 'partly', red: 'missing', grey: 'unknown' }

/**
 * A light from what this session can observe: how many of the mod's commands (from the build-time table) are registered
 * now, by that mod. It cannot see a hook that fails or a pane that renders badly; `bad` counts failures this mod's
 * recorders saw (errors switch).
 */
export const healthFor = (mod: ModRow, live: readonly LiveCmd[], bad: number): HealthRow => {
  const owners = ownersOf(live)
  const expected = mod.cmds.length

  if (expected === 0) {
    return { mod: mod.name, light: bad > 0 ? 'amber' : 'grey', found: 0, expected, note: bad > 0 ? `${bad} failure lines recorded` : 'no commands to check: this mod only uses hooks or panes' }
  }
  const found = mod.cmds.filter(c => {
    const who = owners.get(c)

    return who !== undefined && (who.has(mod.name) || who.has('?'))
  }).length
  const ratio = found / expected
  const light: Light = found === 0 ? 'red' : ratio >= 0.9 && bad === 0 ? 'green' : 'amber'
  const note = found === 0 ? 'none of its commands is registered now' : `${found} of ${expected} commands registered${bad > 0 ? `, ${bad} failure lines recorded` : ''}`

  return { mod: mod.name, light, found, expected, note }
}

/** Duplicate names and commands served by a different plugin than the table says. */
export const liveConflicts = (live: readonly LiveCmd[]): string[] => {
  const out: string[] = []

  for (const [name, who] of ownersOf(live)) {
    const plugins = [...who].filter(w => w !== '?')

    if (plugins.length > 1) {
      out.push(`/${name} is registered by ${plugins.join(' and ')}`)
    }
  }

  for (const m of allMods()) {
    const owners = ownersOf(live)

    for (const c of m.cmds) {
      const who = owners.get(c)

      if (who !== undefined && !who.has(m.name) && !who.has('?')) {
        out.push(`/${c} is expected from ${m.name} but served by ${[...who].join(', ')}`)
      }
    }
  }

  return out.slice(0, 40)
}

export const duplicateText = (): string => {
  const keys = Object.keys(DUPLICATES)

  return keys.length === 0
    ? `Build-time scan: no command name is registered by two mods (${MODS.reduce((n, m) => n + m.cmds.length, 0)} names in ${MODS.length} mods).`
    : `Build-time scan found ${keys.length} shared names: ${keys.map(k => `/${k} (${(DUPLICATES[k] ?? []).join(', ')})`).join('; ')}`
}

export const selfTests = (): { mod: string; line: string }[] =>
  allMods()
    .filter(m => m.selftest !== null)
    .map(m => ({ mod: m.name, line: `/${m.selftest ?? ''}` }))

// ------------------------------------------------------------------ recorders: timing (193), errors (190), order (195)

export const newStat = (): Stat => ({ n: 0, ms: 0, max: 0 })

/** Adds one sample for a key. At most 60 keys are kept: a new key past that is ignored. Returns a new table. */
export const addStat = (table: Readonly<Record<string, Stat>>, key: string, ms: number): Record<string, Stat> => {
  const k = clip(key, 60)
  const have = table[k]

  if (have === undefined && Object.keys(table).length >= MAX_TIMING) {
    return { ...table }
  }
  const v = Number.isFinite(ms) && ms > 0 ? ms : 0
  const cur = have ?? newStat()

  return { ...table, [k]: { n: cur.n + 1, ms: cur.ms + v, max: Math.max(cur.max, v) } }
}

export const normalizeStats = (raw: unknown): Record<string, Stat> => {
  const out: Record<string, Stat> = {}

  if (!isRecord(raw)) {
    return out
  }

  for (const [k, v] of Object.entries(raw).slice(0, MAX_TIMING)) {
    if (isRecord(v) && typeof v.n === 'number' && typeof v.ms === 'number' && typeof v.max === 'number') {
      out[clip(k, 60)] = { n: v.n, ms: v.ms, max: v.max }
    }
  }

  return out
}

export const topStats = (table: Readonly<Record<string, Stat>>, count: number): { key: string; stat: Stat; avg: number }[] =>
  Object.entries(table)
    .map(([key, stat]) => ({ key, stat, avg: stat.n === 0 ? 0 : stat.ms / stat.n }))
    .sort((a, b) => b.stat.ms - a.stat.ms || a.key.localeCompare(b.key))
    .slice(0, count)

export const ERR_RE = /\b(error|errors|failed|failure|fail|refus\w*|denied|exception|time(?:d)?[ -]?out|cannot|can't|could not|unable|crash\w*)\b/i

export const isErrorLine = (text: string): boolean => ERR_RE.test(text)

/** Adds an entry; the same plugin and text twice in a row is kept once. At most 100 are kept, the oldest dropped. */
export const pushError = (list: readonly ErrEntry[], entry: ErrEntry): ErrEntry[] => {
  const last = list[list.length - 1]
  const plugin = clip(entry.plugin, 60)
  const text = clip(sanitize(entry.text), 160)

  if (last !== undefined && last.plugin === plugin && last.text === text) {
    return [...list]
  }

  return [...list, { at: entry.at, plugin, text }].slice(-MAX_ERRORS)
}

export const errorCounts = (list: readonly ErrEntry[]): Record<string, number> => {
  const out: Record<string, number> = {}

  for (const e of list) {
    out[bareName(e.plugin)] = (out[bareName(e.plugin)] ?? 0) + 1
  }

  return out
}

export type TraceLike = { index: number; plugin: string; tier: string; outcome: string; ms: number }

/** The failures in a trace: hooks that threw, ran out of time or rejected. */
export const traceFailures = (trace: readonly TraceLike[]): TraceLike[] => trace.filter(t => t.outcome === 'caught' || t.outcome === 'expired' || t.outcome === 'rejected')

export const orderRows = (trace: readonly TraceLike[]): OrderRow[] =>
  trace.slice(0, MAX_ORDER).map(t => ({
    index: Number.isFinite(t.index) ? t.index : 0,
    plugin: clip(String(t.plugin), 60),
    tier: clip(String(t.tier), 16),
    outcome: clip(String(t.outcome), 16),
    ms: Number.isFinite(t.ms) ? t.ms : 0,
  }))

export const pushRefusal = <T extends { at: number; plugin: string; name: string; reason: string }>(list: readonly T[], r: T): T[] =>
  [...list, { ...r, plugin: clip(r.plugin, 60), name: clip(r.name, 64), reason: clip(sanitize(r.reason), 120) }].slice(-MAX_REFUSALS)

// ------------------------------------------------------------------ diagnostics bundle (192)

export type DiagInput = {
  now: number
  installed: { loadedAt: number; list: readonly Installed[]; error: string } | null
  overrides: Overrides
  motionOn: boolean
  calmOn: boolean
  preset: string
  own: { rules: number; pins: number; notes: number; snaps: number; recording: boolean; persist: SaveMode }
  recorders: { timing: number; errors: number; order: number; refusals: number }
  health: { at: number; green: number; amber: number; red: number; grey: number } | null
}

/** Text for a bug report: versions, mods, switch overrides, counts. No paths, no user name, no notes or prompts. */
export const buildDiag = (d: DiagInput, home?: string): string => {
  const lines: string[] = []
  const mods = allMods()
  lines.push(`control-two ${VERSION} · mod table built ${BUILT_AT} · ${mods.length} mods, ${mods.reduce((n, m) => n + m.cmds.length, 0)} command names`)
  lines.push(`motion ${d.motionOn ? 'on' : 'off'} · calm ${d.calmOn ? 'on' : 'off'} · preset ${d.preset}`)

  if (d.installed === null) {
    lines.push('Installed plugins: not read (run /kxupdates to read them).')
  } else if (d.installed.error !== '') {
    lines.push(`Installed plugins: could not be read (${clip(d.installed.error, 80)}).`)
  } else {
    const enabled = d.installed.list.filter(i => i.status === 'enabled')
    lines.push(`Installed plugins read at ${fmtClock(d.installed.loadedAt)}: ${d.installed.list.length} (${enabled.length} enabled)`)

    for (const i of d.installed.list.slice(0, 80)) {
      lines.push(`  ${i.name} ${i.version === '' ? '?' : i.version} ${i.status}`)
    }

    if (d.installed.list.length > 80) {
      lines.push(`  ... and ${d.installed.list.length - 80} more`)
    }
  }
  const ids = Object.keys(d.overrides).sort()
  lines.push(`Switch overrides: ${ids.length}${ids.length === 0 ? ' (all at their defaults)' : ''}`)

  for (const id of ids.slice(0, 80)) {
    lines.push(`  ${id} ${d.overrides[id] ? 'on' : 'off'}`)
  }

  if (ids.length > 80) {
    lines.push(`  ... and ${ids.length - 80} more`)
  }
  lines.push(`This mod: ${d.own.rules} rules · ${d.own.pins} pins · ${d.own.notes} notes · ${d.own.snaps} snapshots · recording ${d.own.recording ? 'on' : 'off'} · settings ${d.own.persist}`)
  lines.push(`Recorders (this session): timing ${d.recorders.timing} mods · errors ${d.recorders.errors} lines · hook order ${d.recorders.order} rows · refusals ${d.recorders.refusals}`)
  lines.push(
    d.health === null
      ? 'Health: not checked (run /kxhealth).'
      : `Health at ${fmtClock(d.health.at)}: ${d.health.green} good · ${d.health.amber} partly · ${d.health.red} missing · ${d.health.grey} unknown`,
  )
  lines.push(duplicateText())

  return sanitize(lines.join('\n'), home)
}

// ------------------------------------------------------------------ dependency graph (197), text form

export const depLines = (): string[] => {
  const mods = allMods()
  const providers = [...new Set(mods.flatMap(m => m.deps))].sort()
  const lines: string[] = []

  for (const p of providers) {
    const users = mods.filter(m => m.deps.includes(p)).map(m => m.name)
    lines.push(`${p}${mods.some(m => m.name === p) ? '' : ' (not in the table)'} is needed by ${users.length}: ${users.join(', ')}`)
  }
  const free = mods.filter(m => m.deps.length === 0 && !providers.includes(m.name)).map(m => m.name)
  lines.push(`No dependencies and nobody depends on them (${free.length}): ${free.join(', ')}`)

  return lines
}

// ------------------------------------------------------------------ help

export const helpText = (): string =>
  [
    `control-two ${VERSION}: quick controls and diagnostics (prefix ${PREFIX}). One pane: /${PREFIX}quick.`,
    ...COMMANDS.map(([name, desc, usage]) => `  /${name}${usage === '' ? '' : ` ${usage}`}  ${desc}`),
    'Switches (all quiet by default): /cfg feature list control-two',
    'This mod cannot disable or uninstall any plugin, and runs no command of another mod except /motion, /cfg and read-only plugin list.',
  ].join('\n')

export const pageOf = <T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } => {
  const pages = Math.max(1, Math.ceil(items.length / Math.max(1, size)))
  const p = Math.min(Math.max(0, page), pages - 1)

  return { items: items.slice(p * size, p * size + size), page: p, pages }
}

/**
 * The changelog rows for every mod of the table, by name. A mod without a hand-written line (added after the changelog was
 * written) gets a plain note and its one-line description instead of being left out.
 */
export const changelogRows = (): ChangeRow[] => {
  const written = new Map(CHANGELOG.map(c => [c.mod, c]))

  return allMods()
    .map(m => written.get(m.name) ?? { mod: m.name, version: m.version, text: `No hand-written line yet (added after the changelog was written). ${m.desc}` })
    .sort((a, b) => a.mod.localeCompare(b.mod))
}
