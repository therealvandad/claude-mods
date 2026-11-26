// Pure helpers for anim-extra: frames, the rule engine, the alias store, threshold validation, band
// arrangement, i18n, glyphs, ratings and config sanitising. No engine calls, so each one is unit-testable.
import type { AxCfg, AxLang, AxThresholds } from '../types'

// ---- timing ------------------------------------------------------------------
export const TICK_MS = 150
export const SKEL_MS = 2400
export const STAGGER_MS = 300
export const RING_FRAME_MS = 150
export const SWEEP_MS = 150
export const URGENT_MS = 10_000
export const GLOW_CYCLE_MS = 2000
export const CONFETTI_MS = 3000
export const LOOP_MS = 20_000
export const TOAST_GATE_MS = 3 * 60_000
export const RULE_COOLDOWN_MS = 5 * 60_000

export const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`)

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

// ---- 163 skeleton -------------------------------------------------------------
export type SampleCard = { title: string; meta: string; body: string }

export const SAMPLE_CARDS: readonly SampleCard[] = [
  { title: 'Fix login redirect', meta: '2 files, 14 min', body: 'The callback dropped the query string.' },
  { title: 'Add retry to uploads', meta: '3 files, 9 min', body: 'Backs off 1, 2, 4 s, then gives up.' },
  { title: 'Trim bundle size', meta: '1 file, 4 min', body: 'Lazy-loads the chart module.' },
]

const HOT = 4

/** A grey bar of `width` cells with a bright run sliding across it. Still: all grey, no run. */
export const shimmer = (width: number, now: number, isLive: boolean): { before: string; hot: string; after: string } => {
  if (!isLive || width <= 0) {
    return { before: '░'.repeat(Math.max(0, width)), hot: '', after: '' }
  }
  const pos = (Math.floor(now / 80) % (width + HOT)) - HOT
  const start = clamp(pos, 0, width)
  const end = clamp(pos + HOT, 0, width)

  return { before: '░'.repeat(start), hot: '▓'.repeat(end - start), after: '░'.repeat(width - end) }
}

/** Age of the skeleton run; a run that never started reads as already finished. */
export const ageOf = (at: number, now: number) => (at <= 0 ? Number.POSITIVE_INFINITY : now - at)

/** 'skeleton' until this card's turn, then 'content'. Not live: the final content at once. */
export const cardState = (index: number, age: number, isLive: boolean): 'skeleton' | 'content' =>
  !isLive || age >= SKEL_MS + index * STAGGER_MS ? 'content' : 'skeleton'

export const skeletonTotal = (n: number) => SKEL_MS + Math.max(0, n - 1) * STAGGER_MS

// ---- 165 ripple ----------------------------------------------------------------
export const RING: readonly string[] = ['◉', '◎', '○', '◌']
export const RING_IDLE = '●'

/** Four ring frames over 600 ms after a new notification, then the idle dot. Not live: the idle dot. */
export const ringFrame = (age: number, isLive: boolean): string =>
  isLive && age >= 0 && age < RING.length * RING_FRAME_MS ? RING[Math.floor(age / RING_FRAME_MS)]! : RING_IDLE

// ---- 166 glow ------------------------------------------------------------------
/** Border colour of the pulse: two seconds per cycle, hot for the first half. Not live: steady 'error'. */
export const glowTone = (age: number, isLive: boolean): 'error' | 'warning' =>
  !isLive || Math.floor(Math.max(0, age) / (GLOW_CYCLE_MS / 2)) % 2 === 0 ? 'error' : 'warning'

const CONFETTI: readonly string[] = ['✦ · ✧ · ✦ · ✧', '· ✧ · ✦ · ✧ · ✦', '✧ · ✦ · ✧ · ✦ ·', '· ✦ · ✧ · ✦ · ✧']

/** One line of confetti that drifts every 150 ms; still: one fixed line. */
export const confettiLine = (age: number, isLive: boolean) =>
  isLive ? CONFETTI[Math.floor(Math.max(0, age) / TICK_MS) % CONFETTI.length]! : CONFETTI[0]!

// ---- 168 day-night gradient --------------------------------------------------------
const STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 0x0f, 0x17, 0x2a],
  [5, 0x1e, 0x3a, 0x8a],
  [6.5, 0xf9, 0x73, 0x16],
  [8, 0xfc, 0xd3, 0x4d],
  [12, 0x38, 0xbd, 0xf8],
  [17, 0x38, 0xbd, 0xf8],
  [18.5, 0xfb, 0x92, 0x3c],
  [20, 0x7c, 0x3a, 0xed],
  [21.5, 0x31, 0x2e, 0x81],
  [24, 0x0f, 0x17, 0x2a],
]

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0')

/** Raw hex colour of the sky at an hour (0 to 24): a gradient has no theme key. */
export const hourColor = (hour: number): string => {
  const h = clamp(hour, 0, 24)

  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i]!
    const a = STOPS[i - 1]!

    if (h <= b[0]) {
      const f = b[0] === a[0] ? 0 : (h - a[0]) / (b[0] - a[0])

      return `#${hex2(a[1] + (b[1] - a[1]) * f)}${hex2(a[2] + (b[2] - a[2]) * f)}${hex2(a[3] + (b[3] - a[3]) * f)}`
    }
  }

  return '#0f172a'
}

/** 24 cells, one per hour, each coloured at the middle of its hour. */
export const hourStrip = (): { ch: string; color: string }[] =>
  Array.from({ length: 24 }, (_, h) => ({ ch: '█', color: hourColor(h + 0.5) }))

/** A marker row: a single arrow under (or over) one cell. */
export const markerRow = (cell: number, glyph: string) => `${' '.repeat(clamp(cell, 0, 23))}${glyph}`

/** The local hour of a clock reading, whole hours. */
export const hourOf = (ms: number) => new Date(ms).getHours()

/** Cell the sweep marker is over, or -1 when finished (or not live). */
export const sweepCell = (age: number, isLive: boolean) => {
  if (!isLive || age < 0) {
    return -1
  }
  const c = Math.floor(age / SWEEP_MS)

  return c < 24 ? c : -1
}

// ---- 198 rule builder ----------------------------------------------------------------
export type Field = 'cost' | 'context' | 'errors' | 'duration' | 'testpass'
export type Op = '>' | '>=' | '<' | '<=' | '=='
export type Cond = { field: Field; op: Op; value: number }
export type ActionKind = 'toast' | 'fill' | 'confetti'
export type Rule = { urgent: boolean; conds: Cond[]; kind: ActionKind; text: string }
export type Facts = Record<Field, number>

export const RULES_MAX = 15
export const FIELDS: readonly Field[] = ['cost', 'context', 'errors', 'duration', 'testpass']
export const FIELD_MAX: Readonly<Record<Field, number>> = { cost: 100_000, context: 100, errors: 10, duration: 86_400, testpass: 20 }
const FIELD_UNIT: Readonly<Record<Field, string>> = { cost: '$', context: '%', errors: '', duration: 's', testpass: '' }
const TEXT_MAX = 140

export type ParseResult = { ok: true; rule: Rule; text: string } | { ok: false; error: string }

const COND = /^(cost|context|errors|duration|testpass)\s*(>=|<=|==|=|>|<)\s*(\$)?(\d{1,6}(?:\.\d{1,4})?)([%s])?$/i
const RULE = /^(urgent\s+)?if\s+(.+?)\s+then\s+(toast|fill|confetti)\s+"([^"\x00-\x1f]{1,140})"\s*$/i

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))))

/** The one spelling of a rule: what is stored and listed. */
export const ruleText = (r: Rule): string =>
  `${r.urgent ? 'urgent ' : ''}if ${r.conds
    .map(c => `${c.field} ${c.op} ${c.field === 'cost' ? '$' : ''}${fmtNum(c.value)}${c.field === 'context' ? '%' : c.field === 'duration' ? 's' : ''}`)
    .join(' and ')} then ${r.kind} "${r.text}"`

/**
 * Strict parser for: [urgent] if <cond> [and <cond>] then toast|fill|confetti "<text>".
 * cond = cost|context|errors|duration|testpass  > >= < <= ==  number (cost may carry $, context %, duration s).
 * Anything else is an error with a reason; nothing is guessed.
 */
export const parseRule = (input: string, opts: { allowConfetti?: boolean } = {}): ParseResult => {
  const src = input.trim()

  if (src === '') {
    return { ok: false, error: 'Empty rule. Example: if cost > 5 then toast "Cost is high"' }
  }
  const m = RULE.exec(src)

  if (m === null) {
    return { ok: false, error: 'Expected: [urgent] if <cond> [and <cond>] then toast|fill "text" (straight double quotes, 1-140 characters, none inside).' }
  }
  const kind = m[3]!.toLowerCase() as ActionKind

  if (kind === 'confetti' && opts.allowConfetti !== true) {
    return { ok: false, error: 'The action is toast or fill.' }
  }
  const parts = m[2]!.split(/\s+and\s+/i)

  if (parts.length > 2) {
    return { ok: false, error: 'At most two conditions, joined by "and".' }
  }
  const conds: Cond[] = []

  for (const part of parts) {
    const c = COND.exec(part.trim())

    if (c === null) {
      return { ok: false, error: `Cannot read the condition "${clip(part.trim(), 40)}". Use: ${FIELDS.join(' | ')}, then > >= < <= ==, then a number.` }
    }
    const field = c[1]!.toLowerCase() as Field
    const unit = (c[3] ?? '') + (c[5] ?? '')
    const want = FIELD_UNIT[field]

    if (unit !== '' && unit !== want) {
      return { ok: false, error: want === '' ? `${field} takes a plain number.` : `${field} takes ${want === '$' ? '$' : `a trailing ${want}`}, not "${unit}".` }
    }
    const value = Number(c[4])

    if (!Number.isFinite(value) || value < 0 || value > FIELD_MAX[field]) {
      return { ok: false, error: `${field} must be between 0 and ${FIELD_MAX[field]}.` }
    }
    if ((field === 'errors' || field === 'testpass') && !Number.isInteger(value)) {
      return { ok: false, error: `${field} is a whole number.` }
    }
    conds.push({ field, op: (c[2] === '=' ? '==' : c[2]) as Op, value })
  }
  const rule: Rule = { urgent: m[1] !== undefined, conds, kind, text: m[4]! }

  return { ok: true, rule, text: ruleText(rule) }
}

const compare = (a: number, op: Op, b: number) => (op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : a === b)

export const ruleMatches = (r: Rule, facts: Facts) => r.conds.every(c => compare(facts[c.field], c.op, c.value))

/** Fills {cost} {context} {errors} {duration} {testpass} in a message; unknown braces stay as written. */
export const renderMessage = (text: string, facts: Facts): string =>
  text.replace(/\{(cost|context|errors|duration|testpass)\}/g, (_, f: Field) =>
    f === 'cost' ? `$${facts.cost.toFixed(2)}` : f === 'context' ? `${Math.round(facts.context)}%` : f === 'duration' ? `${Math.round(facts.duration)}s` : String(facts[f]),
  )

export type RuleEntry = { key: string; rule: Rule; edge?: boolean }
export type Fire = { key: string; kind: ActionKind; text: string; urgent: boolean }
export type EvalInput = {
  entries: readonly RuleEntry[]
  facts: Facts
  now: number
  isCalm: boolean
  fired: Readonly<Record<string, number>>
  match: Readonly<Record<string, boolean>>
  toastAt: number
}
export type EvalOutput = { fire: Fire[]; fired: Record<string, number>; match: Record<string, boolean>; toastAt: number }

/**
 * What to do after a turn. Calm: only `urgent` rules run, and never confetti. Each rule has a cooldown, an `edge`
 * rule fires only when it newly becomes true, and a non-urgent toast waits for the one-toast-per-3-minutes gate.
 */
export const evaluateRules = (input: EvalInput): EvalOutput => {
  const fire: Fire[] = []
  const fired: Record<string, number> = { ...input.fired }
  const match: Record<string, boolean> = {}
  let toastAt = input.toastAt

  for (const entry of input.entries) {
    const r = entry.rule
    const isMatch = ruleMatches(r, input.facts)
    const wasMatch = input.match[entry.key] === true
    match[entry.key] = isMatch

    if (!isMatch || (entry.edge === true && wasMatch)) {
      continue
    }
    if (input.isCalm && (!r.urgent || r.kind === 'confetti')) {
      continue
    }
    const last = fired[entry.key]

    if (last !== undefined && input.now - last < RULE_COOLDOWN_MS) {
      continue
    }
    if (r.kind === 'toast' && !r.urgent && input.now - toastAt < TOAST_GATE_MS) {
      continue
    }
    fire.push({ key: entry.key, kind: r.kind, text: renderMessage(r.text, input.facts), urgent: r.urgent })
    fired[entry.key] = input.now

    if (r.kind === 'toast') {
      toastAt = input.now
    }
  }

  return { fire, fired, match, toastAt }
}

// ---- 199 recipes (prebuilt rules on the same engine) ------------------------------------
export type Recipe = { id: string; title: string; text: string; edge: boolean }

export const RECIPES: readonly Recipe[] = [
  { id: 'tests-confetti', title: 'After tests pass: a confetti line in the band', text: 'if testpass >= 1 then confetti "Tests passed"', edge: false },
  { id: 'tests-toast', title: 'After tests pass: a toast', text: 'if testpass >= 1 then toast "Tests passed."', edge: false },
  { id: 'cost-5', title: 'Session cost crosses $5: a toast (once per crossing)', text: 'if cost >= 5 then toast "Session cost is {cost}."', edge: true },
  { id: 'context-85', title: 'Context passes 85%: a toast (once per crossing)', text: 'if context >= 85 then toast "Context is {context} full. Consider /compact."', edge: true },
  { id: 'errors-5', title: 'Five of the last 10 tool calls failed: a toast', text: 'if errors >= 5 then toast "{errors} of the last 10 tool calls failed."', edge: true },
  { id: 'long-turn', title: 'A turn takes over 3 minutes: a toast', text: 'if duration >= 180 then toast "That turn took {duration}."', edge: false },
]

/** Entries for the engine: the person's rules, then the recipes that are switched on. */
export const entriesOf = (ruleTexts: readonly string[], recipes: Readonly<Record<string, boolean>>): RuleEntry[] => {
  const out: RuleEntry[] = []

  ruleTexts.forEach((text, i) => {
    const p = parseRule(text)

    if (p.ok) {
      out.push({ key: `r${i + 1}`, rule: p.rule })
    }
  })

  for (const rc of RECIPES) {
    if (recipes[rc.id] === true) {
      const p = parseRule(rc.text, { allowConfetti: true })

      if (p.ok) {
        out.push({ key: `recipe:${rc.id}`, rule: p.rule, edge: rc.edge })
      }
    }
  }

  return out
}

/** The last 10 outcomes as a string of 'e' (error) and 'o' (ok): how many failed. */
export const errorsIn = (calls: string, last = 10) => [...calls.slice(-last)].filter(c => c === 'e').length

const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(vitest|jest|pytest|mocha|rspec|phpunit)\b|\bgo\s+test\b|\bcargo\s+test\b|\bplugin\s+test\b|\bmake\s+test\b/

export const isTestCommand = (cmd: string) => TEST_CMD.test(cmd)

/** A test run counts as passed when the call did not error and its output reports no failures. */
export const testsPassed = (command: string, stdout: string, isError: boolean) =>
  !isError && isTestCommand(command) && !/\b[1-9]\d* (failed|failing)\b|^\s*FAIL\b|\bFAILED\b|\bfailures?:\s*[1-9]/m.test(stdout)

// ---- 174 aliases --------------------------------------------------------------------------
export const ALIAS_MAX = 30
const ALIAS_RESERVED: readonly string[] = ['add', 'rm', 'remove', 'list', 'clear']

export const aliasNameError = (name: string): string | null =>
  !/^[a-z][a-z0-9_-]{0,15}$/.test(name)
    ? 'An alias name is 1-16 characters: a lowercase letter, then letters, digits, - or _.'
    : ALIAS_RESERVED.includes(name)
      ? `"${name}" is reserved.`
      : null

/** The command text an alias fills: a leading slash is added, one line, 200 characters at most. */
export const normalizeTarget = (raw: string): { ok: true; text: string } | { ok: false; error: string } => {
  const t = raw.trim().replace(/\s+/g, ' ')

  if (t === '' || t === '/') {
    return { ok: false, error: 'Say what the alias fills: /axalias add s dashboard' }
  }
  const text = t.startsWith('/') ? t : `/${t}`

  if (text.length > 200) {
    return { ok: false, error: 'The target is at most 200 characters.' }
  }
  if (/^\/axrun\b/.test(text)) {
    return { ok: false, error: 'An alias cannot point at /axrun.' }
  }

  return { ok: true, text }
}

export type AliasResult = { ok: true; aliases: Record<string, string> } | { ok: false; error: string }

export const addAlias = (aliases: Readonly<Record<string, string>>, nameRaw: string, targetRaw: string): AliasResult => {
  const name = nameRaw.trim().toLowerCase()
  const bad = aliasNameError(name)

  if (bad !== null) {
    return { ok: false, error: bad }
  }
  const target = normalizeTarget(targetRaw)

  if (!target.ok) {
    return target
  }
  if (!(name in aliases) && Object.keys(aliases).length >= ALIAS_MAX) {
    return { ok: false, error: `At most ${ALIAS_MAX} aliases: remove one first (/axalias rm <name>).` }
  }

  return { ok: true, aliases: { ...aliases, [name]: target.text } }
}

export const removeAlias = (aliases: Readonly<Record<string, string>>, nameRaw: string): AliasResult => {
  const name = nameRaw.trim().toLowerCase()

  if (!(name in aliases)) {
    return { ok: false, error: `No alias "${name}".` }
  }
  const { [name]: _gone, ...rest } = aliases

  return { ok: true, aliases: rest }
}

export const resolveAlias = (aliases: Readonly<Record<string, string>>, nameRaw: string): string | undefined => {
  const name = nameRaw.trim().toLowerCase()

  return Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : undefined
}

export type AliasCmd = { kind: 'add'; name: string; target: string } | { kind: 'rm'; name: string } | { kind: 'list' } | { kind: 'bad'; error: string }

export const parseAliasArgs = (args: string): AliasCmd => {
  const [word = '', name = '', ...rest] = args.trim().split(/\s+/)

  if (word === '' || word === 'list') {
    return { kind: 'list' }
  }
  if (word === 'add') {
    return name === '' || rest.length === 0 ? { kind: 'bad', error: 'Usage: /axalias add <name> <command...>' } : { kind: 'add', name, target: rest.join(' ') }
  }
  if (word === 'rm' || word === 'remove') {
    return name === '' ? { kind: 'bad', error: 'Usage: /axalias rm <name>' } : { kind: 'rm', name }
  }

  return { kind: 'bad', error: 'Usage: /axalias add <name> <command...> | rm <name> | list' }
}

// ---- 196 thresholds ---------------------------------------------------------------------------
export type ThresholdKey = keyof AxThresholds

export const THRESHOLDS: Readonly<Record<ThresholdKey, { short: string; label: string; unit: string; min: number; max: number; def: number }>> = {
  slowCallSec: { short: 'slow', label: 'Slow call', unit: 'seconds', min: 1, max: 3600, def: 30 },
  largeOutputLines: { short: 'output', label: 'Large output', unit: 'lines', min: 10, max: 100_000, def: 200 },
  riskyEditLines: { short: 'edit', label: 'Risky edit', unit: 'lines', min: 1, max: 10_000, def: 50 },
}

export const THRESHOLD_KEYS = Object.keys(THRESHOLDS) as ThresholdKey[]

export const DEFAULT_THRESHOLDS: AxThresholds = { slowCallSec: 30, largeOutputLines: 200, riskyEditLines: 50 }

export const thresholdKeyOf = (word: string): ThresholdKey | undefined => {
  const w = word.trim().toLowerCase()

  return THRESHOLD_KEYS.find(k => k.toLowerCase() === w || THRESHOLDS[k].short === w)
}

export const validateThreshold = (key: ThresholdKey, raw: string): { ok: true; value: number } | { ok: false; error: string } => {
  const spec = THRESHOLDS[key]
  const s = raw.trim()

  if (!/^\d{1,6}$/.test(s)) {
    return { ok: false, error: `${spec.label} is a whole number of ${spec.unit}, ${spec.min} to ${spec.max}.` }
  }
  const value = Number(s)

  return value < spec.min || value > spec.max ? { ok: false, error: `${spec.label} is ${spec.min} to ${spec.max} ${spec.unit}.` } : { ok: true, value }
}

export const classifyCall = (seconds: number, t: AxThresholds): 'slow' | 'ok' => (seconds >= t.slowCallSec ? 'slow' : 'ok')
export const classifyOutput = (lines: number, t: AxThresholds): 'large' | 'ok' => (lines >= t.largeOutputLines ? 'large' : 'ok')
export const classifyEdit = (lines: number, t: AxThresholds): 'risky' | 'ok' => (lines >= t.riskyEditLines ? 'risky' : 'ok')

// ---- 176 band layout -----------------------------------------------------------------------------
export const SELF = 'anim-extra'
export const BAND_MAX = 20

export const isPluginName = (s: string) => /^[a-z0-9][a-z0-9._-]{0,40}$/.test(s)

/** Hidden rows removed, then the named order first and every other row after, as they came. Own row never hidden. */
export const arrangeRows = <T extends { plugin: string }>(rows: readonly T[], hidden: readonly string[], order: readonly string[]): readonly T[] => {
  if (hidden.length === 0 && order.length === 0) {
    return rows
  }
  const kept = rows.filter(r => r.plugin === SELF || !hidden.includes(r.plugin))
  const first: T[] = []

  for (const name of order) {
    for (const r of kept) {
      if (r.plugin === name && !first.includes(r)) {
        first.push(r)
      }
    }
  }

  return [...first, ...kept.filter(r => !first.includes(r))]
}

export type BandCmd =
  | { kind: 'hide'; name: string }
  | { kind: 'show'; name: string }
  | { kind: 'order'; names: string[] }
  | { kind: 'reset' }
  | { kind: 'status' }
  | { kind: 'bad'; error: string }

export const parseBandArgs = (args: string): BandCmd => {
  const [first = '', ...rest] = args.trim().split(/\s+/)
  const word = first.toLowerCase()
  const arg = rest.join('').toLowerCase()

  if (word === '' || word === 'status') {
    return { kind: 'status' }
  }
  if (word === 'reset') {
    return { kind: 'reset' }
  }
  if (word === 'hide' || word === 'show') {
    return isPluginName(arg) ? (word === 'hide' ? { kind: 'hide', name: arg } : { kind: 'show', name: arg }) : { kind: 'bad', error: `Usage: /axband ${word} <plugin-name>` }
  }
  if (word === 'order') {
    const names = arg.split(',').filter(n => n !== '')

    return names.length > 0 && names.length <= BAND_MAX && names.every(isPluginName) && new Set(names).size === names.length
      ? { kind: 'order', names }
      : { kind: 'bad', error: 'Usage: /axband order a,b,c (plugin names, comma separated, no repeats)' }
  }

  return { kind: 'bad', error: 'Usage: /axband hide <plugin> | show <plugin> | order a,b,c | reset | status' }
}

// ---- 195 languages -----------------------------------------------------------------------------------
export const LANGS: readonly AxLang[] = ['en', 'es', 'de']

const EN = {
  tab_hub: 'Hub', tab_presets: 'Presets', tab_mods: 'Mods', tab_alias: 'Aliases', tab_band: 'Band', tab_lab: 'Lab',
  tab_motion: 'Motion', tab_rules: 'Rules', tab_tune: 'Tune', tab_market: 'Market', tab_notes: 'About',
  g_settings: 'Settings', g_look: 'Look and feel', g_safety: 'Safety', g_work: 'Workflow', g_fun: 'Fun and learning', g_other: 'More',
  title: 'Anim extra', current: 'Current', none: 'none', fill: 'Fill', copy: 'Copy', copy_all: 'Copy all', remove: 'Remove',
  replay: 'Replay', play: 'Play', on: 'on', off: 'off', still: 'still', animated: 'animated', paused: 'paused',
  language: 'Language', thresholds: 'Thresholds', glyphs: 'File glyphs', recipes: 'Recipes', rules: 'Rules',
  disable: 'Disable', enable: 'Enable', needed_by: 'needed by', rating: 'Rating', sort_name: 'sort: name', sort_rating: 'sort: rating',
  hint_fill: 'Buttons fill the prompt: press Enter there to run the command. This pane cannot run other mods commands.',
  copied: 'Copied.', not_copied: 'Could not copy here: select the text instead.', motion_off: 'Motion is off or calm: every piece shows its still frame.',
  skeleton: 'Loading skeleton', ripple: 'Notification ripple', glow: 'Urgent edge glow', daynight: 'Day and night strip', notifications: 'notifications',
  new_notification: 'New notification', test_glow: 'Test glow', hidden: 'hidden', shown: 'shown', order: 'order', no_aliases: 'No aliases yet.',
  no_rules: 'No rules yet.', checklist: 'Checklist', example: 'Examples', last_call: 'Last call',
} as const

export type LabelKey = keyof typeof EN

const ES: Record<LabelKey, string> = {
  tab_hub: 'Centro', tab_presets: 'Perfiles', tab_mods: 'Mods', tab_alias: 'Alias', tab_band: 'Banda', tab_lab: 'Laboratorio',
  tab_motion: 'Movimiento', tab_rules: 'Reglas', tab_tune: 'Ajustes', tab_market: 'Mercado', tab_notes: 'Acerca de',
  g_settings: 'Ajustes', g_look: 'Aspecto', g_safety: 'Seguridad', g_work: 'Trabajo', g_fun: 'Diversion y estudio', g_other: 'Mas',
  title: 'Anim extra', current: 'Actual', none: 'ninguno', fill: 'Rellenar', copy: 'Copiar', copy_all: 'Copiar todo', remove: 'Quitar',
  replay: 'Repetir', play: 'Reproducir', on: 'si', off: 'no', still: 'fijo', animated: 'animado', paused: 'en pausa',
  language: 'Idioma', thresholds: 'Umbrales', glyphs: 'Iconos de archivo', recipes: 'Recetas', rules: 'Reglas',
  disable: 'Desactivar', enable: 'Activar', needed_by: 'lo necesitan', rating: 'Nota', sort_name: 'orden: nombre', sort_rating: 'orden: nota',
  hint_fill: 'Los botones rellenan el prompt: pulsa Enter alli para ejecutar. Este panel no puede ejecutar comandos de otros mods.',
  copied: 'Copiado.', not_copied: 'No se pudo copiar aqui: selecciona el texto.', motion_off: 'Sin movimiento o en modo calma: cada pieza muestra su imagen fija.',
  skeleton: 'Esqueleto de carga', ripple: 'Onda de notificacion', glow: 'Brillo de borde urgente', daynight: 'Franja de dia y noche', notifications: 'notificaciones',
  new_notification: 'Nueva notificacion', test_glow: 'Probar brillo', hidden: 'oculto', shown: 'visible', order: 'orden', no_aliases: 'Aun no hay alias.',
  no_rules: 'Aun no hay reglas.', checklist: 'Lista', example: 'Ejemplos', last_call: 'Ultima llamada',
}

const DE: Record<LabelKey, string> = {
  tab_hub: 'Zentrale', tab_presets: 'Profile', tab_mods: 'Mods', tab_alias: 'Aliase', tab_band: 'Leiste', tab_lab: 'Labor',
  tab_motion: 'Bewegung', tab_rules: 'Regeln', tab_tune: 'Anpassen', tab_market: 'Markt', tab_notes: 'Info',
  g_settings: 'Einstellungen', g_look: 'Aussehen', g_safety: 'Sicherheit', g_work: 'Arbeit', g_fun: 'Spass und Lernen', g_other: 'Mehr',
  title: 'Anim extra', current: 'Aktuell', none: 'keine', fill: 'Einfuegen', copy: 'Kopieren', copy_all: 'Alles kopieren', remove: 'Entfernen',
  replay: 'Nochmal', play: 'Abspielen', on: 'an', off: 'aus', still: 'ruhig', animated: 'animiert', paused: 'angehalten',
  language: 'Sprache', thresholds: 'Schwellen', glyphs: 'Dateisymbole', recipes: 'Rezepte', rules: 'Regeln',
  disable: 'Abschalten', enable: 'Einschalten', needed_by: 'gebraucht von', rating: 'Wertung', sort_name: 'Sortierung: Name', sort_rating: 'Sortierung: Wertung',
  hint_fill: 'Knoepfe fuellen die Eingabe: dort Enter druecken zum Ausfuehren. Dieses Fenster kann keine Befehle anderer Mods ausfuehren.',
  copied: 'Kopiert.', not_copied: 'Hier nicht kopierbar: Text markieren.', motion_off: 'Bewegung aus oder ruhiger Modus: jedes Teil zeigt sein Standbild.',
  skeleton: 'Lade-Skelett', ripple: 'Benachrichtigungs-Welle', glow: 'Dringender Randschein', daynight: 'Tag-und-Nacht-Streifen', notifications: 'Benachrichtigungen',
  new_notification: 'Neue Benachrichtigung', test_glow: 'Schein testen', hidden: 'versteckt', shown: 'sichtbar', order: 'Reihenfolge', no_aliases: 'Noch keine Aliase.',
  no_rules: 'Noch keine Regeln.', checklist: 'Checkliste', example: 'Beispiele', last_call: 'Letzter Aufruf',
}

export const STRINGS: Readonly<Record<AxLang, Readonly<Record<LabelKey, string>>>> = { en: EN, es: ES, de: DE }

/** One label in a language; a missing one falls back to English. */
export const tr = (lang: AxLang, key: LabelKey): string => STRINGS[lang]?.[key] ?? EN[key]

export const isLang = (s: string): s is AxLang => (LANGS as readonly string[]).includes(s)

// ---- 197 file-type glyphs ----------------------------------------------------------------------------------
export const GLYPH_MAX = 40

export const DEFAULT_GLYPHS: Readonly<Record<string, string>> = {
  ts: '⬡', tsx: '⬡', js: '◇', jsx: '◇', json: '{}', md: '¶', py: '◈', rs: '⚙', go: '◆', sh: '$', css: '◐', html: '◧', yml: '≡', yaml: '≡', txt: '·',
}

export const extOf = (path: string): string => {
  const base = path.split('/').pop() ?? path
  const i = base.lastIndexOf('.')

  return i <= 0 ? '' : base.slice(i + 1).toLowerCase()
}

/** custom mapping first; then the settings icon pack: letters (the extension), symbols (the table), minimal (a dot). */
export const glyphFor = (ext: string, icons: string, custom: Readonly<Record<string, string>>): string => {
  const e = ext.toLowerCase()

  if (Object.prototype.hasOwnProperty.call(custom, e)) {
    return custom[e]!
  }
  if (icons === 'letters') {
    return (e === '' ? '??' : e.slice(0, 2)).toUpperCase()
  }
  if (icons === 'minimal') {
    return '·'
  }

  return DEFAULT_GLYPHS[e] ?? '▫'
}

export const validGlyph = (g: string) => g !== '' && [...g].length <= 2 && !/[\s\x00-\x1f\x7f]/.test(g)

export type GlyphCmd = { kind: 'set'; ext: string; glyph: string } | { kind: 'rm'; ext: string } | { kind: 'list' } | { kind: 'bad'; error: string }

export const parseGlyphArgs = (args: string): GlyphCmd => {
  const [a = '', b = '', ...rest] = args.trim().split(/\s+/)

  if (a === '' || a === 'list') {
    return { kind: 'list' }
  }
  const clean = (s: string) => s.replace(/^\./, '').toLowerCase()

  if (a === 'rm') {
    return /^[a-z0-9]{1,8}$/.test(clean(b)) ? { kind: 'rm', ext: clean(b) } : { kind: 'bad', error: 'Usage: /axglyph rm <ext>' }
  }
  if (!/^[a-z0-9]{1,8}$/.test(clean(a)) || b === '' || rest.length > 0 || !validGlyph(b)) {
    return { kind: 'bad', error: 'Usage: /axglyph <ext> <glyph> (one or two visible characters) | rm <ext> | list' }
  }

  return { kind: 'set', ext: clean(a), glyph: b }
}

// ---- 200 ratings ----------------------------------------------------------------------------------------------
export const NOTE_MAX = 120

export const starsOf = (n: number) => '★'.repeat(clamp(n, 0, 5)) + '☆'.repeat(5 - clamp(n, 0, 5))

export type RateCmd = { kind: 'rate'; mod: string; stars: number; note: string | null } | { kind: 'list' } | { kind: 'bad'; error: string }

export const parseRateArgs = (args: string, known: readonly string[]): RateCmd => {
  const [mod = '', n = '', ...rest] = args.trim().split(/\s+/)

  if (mod === '' || mod === 'list') {
    return { kind: 'list' }
  }
  if (!known.includes(mod)) {
    return { kind: 'bad', error: `No mod called "${clip(mod, 30)}". See the Market tab or /axrate list.` }
  }
  if (!/^[0-5]$/.test(n)) {
    return { kind: 'bad', error: 'Usage: /axrate <mod> <1-5> [note] (0 clears the rating)' }
  }
  const note = rest.join(' ').trim()

  return { kind: 'rate', mod, stars: Number(n), note: note === '' ? null : clip(note, NOTE_MAX) }
}

// ---- 172 preset bundles --------------------------------------------------------------------------------------------
export type Bundle = { id: string; title: string; about: string; lines: readonly string[] }

export const BUNDLES: readonly Bundle[] = [
  { id: 'calm', title: 'Quiet day', about: 'Few toasts, no animation, no sound, hidden band rows.', lines: ['/cfg preset calm', '/motion off', '/sound off', '/toolvis off', '/fun off', '/lyzen on'] },
  { id: 'focus', title: 'Deep focus', about: 'Compact and quiet; alerts paused for an hour.', lines: ['/cfg preset focus', '/lyzen on', '/sound off', '/alsnooze 60'] },
  { id: 'full', title: 'Everything on', about: 'Normal spacing, animation, tool visuals and the quiet fun.', lines: ['/cfg preset full', '/motion on', '/toolvis on', '/fun on', '/lyzen off'] },
  { id: 'demo', title: 'Show it off', about: 'Everything on, then play the animation demos.', lines: ['/cfg preset full', '/motion on', '/anim demo', '/axdemo'] },
]

// ---- config sanitising ----------------------------------------------------------------------------------------------------
export const DEFAULT_CFG: AxCfg = {
  glow: false,
  lang: 'en',
  aliases: {},
  band: { hidden: [], order: [] },
  thresholds: DEFAULT_THRESHOLDS,
  glyphs: {},
  rules: [],
  recipes: {},
  ratings: {},
  checks: {},
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

const names = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && isPluginName(x)))].slice(0, max) : []

/** What came out of the store, made safe: wrong types are dropped, bounds applied, rules re-parsed. */
export const cleanCfg = (raw: unknown, knownMods: readonly string[]): AxCfg => {
  const s = isRecord(raw) ? raw : {}
  const aliases: Record<string, string> = {}

  if (isRecord(s.aliases)) {
    for (const [k, v] of Object.entries(s.aliases)) {
      const r = typeof v === 'string' ? addAlias(aliases, k, v) : undefined

      if (r !== undefined && r.ok) {
        Object.assign(aliases, r.aliases)
      }
    }
  }
  const thresholds = { ...DEFAULT_THRESHOLDS }

  if (isRecord(s.thresholds)) {
    for (const k of THRESHOLD_KEYS) {
      const v = s.thresholds[k]
      const r = typeof v === 'number' ? validateThreshold(k, String(v)) : undefined

      if (r !== undefined && r.ok) {
        thresholds[k] = r.value
      }
    }
  }
  const glyphs: Record<string, string> = {}

  if (isRecord(s.glyphs)) {
    for (const [k, v] of Object.entries(s.glyphs)) {
      if (/^[a-z0-9]{1,8}$/.test(k) && typeof v === 'string' && validGlyph(v) && Object.keys(glyphs).length < GLYPH_MAX) {
        glyphs[k] = v
      }
    }
  }
  const rules: string[] = []

  if (Array.isArray(s.rules)) {
    for (const t of s.rules) {
      const p = typeof t === 'string' ? parseRule(t) : undefined

      if (p !== undefined && p.ok && rules.length < RULES_MAX) {
        rules.push(p.text)
      }
    }
  }
  const recipes: Record<string, boolean> = {}

  if (isRecord(s.recipes)) {
    for (const rc of RECIPES) {
      if (s.recipes[rc.id] === true) {
        recipes[rc.id] = true
      }
    }
  }
  const ratings: Record<string, { stars: number; note: string }> = {}

  if (isRecord(s.ratings)) {
    for (const [k, v] of Object.entries(s.ratings)) {
      if (knownMods.includes(k) && isRecord(v) && typeof v.stars === 'number' && v.stars >= 1 && v.stars <= 5) {
        ratings[k] = { stars: Math.round(v.stars), note: typeof v.note === 'string' ? clip(v.note, NOTE_MAX) : '' }
      }
    }
  }
  const checks: Record<string, boolean> = {}

  if (isRecord(s.checks)) {
    for (const b of BUNDLES) {
      b.lines.forEach((_, i) => {
        if (s.checks && (s.checks as Record<string, unknown>)[`${b.id}:${i}`] === true) {
          checks[`${b.id}:${i}`] = true
        }
      })
    }
  }
  const band = isRecord(s.band) ? s.band : {}

  return {
    glow: s.glow === true,
    lang: typeof s.lang === 'string' && isLang(s.lang) ? s.lang : 'en',
    aliases,
    band: { hidden: names(band.hidden, BAND_MAX).filter(n => n !== SELF), order: names(band.order, BAND_MAX) },
    thresholds,
    glyphs,
    rules,
    recipes,
    ratings,
    checks,
  }
}

/** The single line a file path gets in the glyph preview. */
export const shortPath = (p: string) => {
  const parts = p.split('/').filter(x => x !== '')

  return parts.length <= 2 ? parts.join('/') : `…/${parts.slice(-2).join('/')}`
}

// ---- command table ---------------------------------------------------------------------------------------------
export const COMMANDS: readonly (readonly [string, string])[] = [
  ['ax', 'Anim extra help: every /ax command in one line each'],
  ['axpanel', 'Open the hub pane: /axpanel [hub|presets|mods|alias|band|lab|motion|rules|tune|market|about]'],
  ['axdemo', 'Play the skeleton, ripple and day-night demos once (needs motion on and not calm)'],
  ['axglow', 'Urgent edge glow on this mod\'s pane and one band line: /axglow on | off | test | clear (default off)'],
  ['axalias', 'Command aliases: /axalias add <name> <command...> | rm <name> | list'],
  ['axrun', 'Fill the prompt with an alias\'s command: /axrun <alias>'],
  ['axband', 'Hide or reorder other mods\' band rows: /axband hide|show <plugin> | order a,b,c | reset | status'],
  ['axrule', 'Alert rules at turn end: /axrule [urgent] if cost > 5 then toast "..." | list | rm <n> | clear | check'],
  ['axrecipe', 'Prebuilt automation recipes: /axrecipe list | <id> on|off'],
  ['axthresh', 'Your own numeric thresholds: /axthresh [slow|output|edit] [number] | reset'],
  ['axlang', 'Language of this mod\'s pane labels: /axlang en|es|de'],
  ['axglyph', 'File-type glyphs for this mod\'s pane: /axglyph <ext> <glyph> | rm <ext> | list'],
  ['axrate', 'Rate a mod and add a note: /axrate <mod> <1-5> [note] | list'],
  ['axpreset', 'Print a preset bundle\'s command lines: /axpreset [calm|focus|full|demo]'],
  ['axreset', 'Clear everything this mod stored and recorded'],
]
