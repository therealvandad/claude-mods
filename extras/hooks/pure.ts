// Pure helpers for extras: no `$`, no engine calls, so the tests reach them directly.

import type { CallRec, Digest, Mark, MaskCtx, SnapFile, SpendSample, ToolTotal, Vitals } from '../types'

export type Input = Record<string, unknown>

const str = (value: unknown) => (typeof value === 'string' ? value : '')

// ---------------------------------------------------------------- formatting

export const fmtCount = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const fmtDuration = (ms: number) => {
  if (!(ms >= 0)) {
    return '0ms'
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 10_000) {
    return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s`
  }
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${minutes}m ${pad(seconds)}s`
}

// Characters are the size proxy (what the model reads); about four characters make a token.
export const fmtChars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k ch` : `${Math.round(n)} ch`)

export const approxTokens = (chars: number) => Math.ceil(chars / 4)

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text)

export const oneLine = (text: string, max: number) => clip(text.replace(/\s+/g, ' ').trim(), max)

// ---------------------------------------------------------------- 15 screen-share masking

const SECRET_RULES: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[hidden:private-key]'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, '[hidden:api-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, '[hidden:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[hidden:github-token]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[hidden:aws-key]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[hidden:slack-token]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[hidden:google-key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[hidden:jwt]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, '$1[hidden:bearer]'],
  [
    /\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|auth)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)(?=[A-Za-z0-9+])(?=[^\s"']*\d)[A-Za-z0-9+/=_.~-]{16,}/gi,
    '$1[hidden:secret]',
  ],
]

export const maskSecrets = (text: string): { text: string; count: number } => {
  let count = 0
  let out = text

  for (const [pattern, replacement] of SECRET_RULES) {
    out = out.replace(pattern, (...match: unknown[]) => {
      count += 1

      return replacement.replace('$1', () => String(match[1] ?? ''))
    })
  }

  return { text: out, count }
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

const trimEnd = (path: string) => (path.length > 1 ? path.replace(/[\\/]+$/, '') : path)

// `/work/code/myapp` -> `…/code/myapp`; null where a path has fewer than two segments.
export const shortProject = (cwd: string): string | null => {
  const parts = trimEnd(cwd).split(/[\\/]/).filter(Boolean)

  return parts.length >= 2 ? `…/${parts.slice(-2).join('/')}` : null
}

// A path prefix is replaced only where it ends on a boundary, so `/a/proj` leaves `/a/proj-2` alone.
const replacePrefix = (text: string, prefix: string, to: string) =>
  text.replace(new RegExp(`${escapeRe(prefix)}(?![A-Za-z0-9._-])`, 'g'), () => to)

const GENERIC_HOME = /(?:\/Users|\/home)\/[^/\s'"`:;,)\]}<>]+/g
const WINDOWS_HOME = /[A-Za-z]:\\Users\\[^\\\s'"`:;,)\]}<>]+/g

export const maskText = (text: string, ctx: MaskCtx): string => {
  if (text === '') {
    return text
  }
  let out = maskSecrets(text).text
  out = out.replace(EMAIL, found => (found.startsWith('git@') ? found : '[email]'))
  const cwd = trimEnd(ctx.cwd)
  const home = trimEnd(ctx.home)

  // The project root first: it lives under the home directory, which would otherwise hide it.
  if (cwd.length > 1 && cwd !== home) {
    const short = shortProject(cwd)

    if (short !== null) {
      out = replacePrefix(out, cwd, short)
    }
  }
  if (home.length > 1) {
    out = replacePrefix(out, home, '~')
  }
  out = out.replace(GENERIC_HOME, '~').replace(WINDOWS_HOME, '~')

  if (ctx.user.length >= 3 && ctx.user !== 'root') {
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${escapeRe(ctx.user)}(?![A-Za-z0-9_])`, 'g'), '[user]')
  }

  return out
}

export const maskDeep = (value: unknown, ctx: MaskCtx, depth = 0): unknown => {
  if (typeof value === 'string') {
    return maskText(value, ctx)
  }
  if (depth > 10 || value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(one => maskDeep(one, ctx, depth + 1))
  }
  const next: Record<string, unknown> = {}

  for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
    next[key] = key === 'base64' ? one : maskDeep(one, ctx, depth + 1)
  }

  return next
}

// ---------------------------------------------------------------- tool-call records

const hash = (text: string) => {
  let h = 0x811c9dc5

  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return `${h.toString(16)}-${text.length}`
}

export const signatureOf = (tool: string, input: Input) => {
  const keys = Object.keys(input)
    .filter(key => key !== 'tool' && key !== 'tool_use_id')
    .sort()

  return hash(`${tool}|${keys.map(key => `${key}=${JSON.stringify(input[key])}`).join('&')}`)
}

export const summarize = (tool: string, input: Input): string => {
  const first =
    str(input.command) ||
    str(input.file_path) ||
    str(input.notebook_path) ||
    (str(input.pattern) !== '' ? `${str(input.pattern)}${str(input.path) !== '' ? ` in ${str(input.path)}` : ''}` : '') ||
    str(input.path) ||
    str(input.url) ||
    str(input.query) ||
    str(input.description) ||
    str(input.prompt) ||
    str(input.skill) ||
    ''

  return oneLine(first, 90) || tool
}

export const fileOf = (tool: string, input: Input): string =>
  tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' || tool === 'MultiEdit'
    ? str(input.file_path) || str(input.notebook_path)
    : ''

// What the model reads is the size proxy: the result text the engine produced, else the JSON of the result.
export const sizeOfResult = (ran: unknown): number => {
  if (ran === null || typeof ran !== 'object') {
    return 0
  }
  const r = ran as { text?: unknown; result?: unknown; deny?: unknown }

  if (typeof r.text === 'string') {
    return r.text.length
  }
  if (typeof r.deny === 'string') {
    return r.deny.length
  }
  try {
    return JSON.stringify(r.result ?? null).length
  } catch {
    return 0
  }
}

export const isErrorResult = (ran: unknown): boolean => {
  if (ran === null || typeof ran !== 'object') {
    return false
  }
  const r = ran as { isError?: unknown; deny?: unknown }

  return r.isError === true || typeof r.deny === 'string'
}

// ---------------------------------------------------------------- 16 away digest

export const AWAY_MS = 10 * 60 * 1000
export const MAX_DIGEST_FILES = 6

export const buildDigest = (
  list: readonly CallRec[],
  marks: readonly Mark[],
  since: number,
  now: number,
  isRunning: boolean,
): Digest => {
  const finished = list.filter(one => one.end !== null && one.end > since)
  const files: string[] = []

  for (const one of finished) {
    if (one.file !== '' && !one.isErr && !files.includes(one.file)) {
      files.push(one.file)
    }
  }
  const turnErrors = marks.filter(one => one.kind === 'turn-error' && one.at > since).length

  return {
    at: now,
    awayMs: Math.max(0, now - since),
    calls: finished.length,
    files: files.slice(0, MAX_DIGEST_FILES),
    filesMore: Math.max(0, files.length - MAX_DIGEST_FILES),
    errors: finished.filter(one => one.isErr).length + turnErrors,
    isRunning,
  }
}

export const digestLines = (d: Digest): string[] => {
  const plural = (n: number, word: string) => `${fmtCount(n)} ${word}${n === 1 ? '' : 's'}`
  const parts = [
    `${plural(d.calls, 'tool call')} finished`,
    `${plural(d.files.length + d.filesMore, 'file')} changed`,
    `${plural(d.errors, 'error')}`,
  ]
  const lines = [`Away ${fmtDuration(d.awayMs)}: ${parts.join(' · ')}`]

  if (d.files.length > 0) {
    lines.push(`Changed: ${d.files.join(', ')}${d.filesMore > 0 ? ` (+${d.filesMore} more)` : ''}`)
  }
  lines.push(d.isRunning ? 'A turn is still running.' : 'No turn is running.')

  return lines
}

// ---------------------------------------------------------------- 19 session health

export type Factor = { key: 'errors' | 'loops' | 'context' | 'spend'; label: string; score: number; weight: number; detail: string }
export type Band = 'healthy' | 'fair' | 'strained' | 'poor'
export type Health = { score: number; band: Band; factors: Factor[] }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export const WEIGHTS = { errors: 0.3, loops: 0.2, context: 0.3, spend: 0.2 } as const
export const SPEND_FREE_PER_HOUR = 5
export const SPEND_ZERO_PER_HOUR = 20

export const bandOf = (score: number): Band =>
  score >= 80 ? 'healthy' : score >= 60 ? 'fair' : score >= 40 ? 'strained' : 'poor'

export const bandColor = (band: Band): 'success' | 'suggestion' | 'warning' | 'error' =>
  band === 'healthy' ? 'success' : band === 'fair' ? 'suggestion' : band === 'strained' ? 'warning' : 'error'

// Dollars per hour: the last 30 minutes of samples when they span two minutes, else the session average once it is 3 minutes old.
export const spendRate = (samples: readonly SpendSample[], vitals: Vitals, now: number): number | null => {
  const window = samples.filter(one => one.t >= now - 30 * 60 * 1000)
  const first = window[0]
  const last = window[window.length - 1]

  if (first !== undefined && last !== undefined && last.t - first.t >= 120_000) {
    return Math.max(0, ((last.usd - first.usd) / (last.t - first.t)) * 3_600_000)
  }
  const elapsed = now - vitals.startedAt

  if (vitals.usd === null || vitals.startedAt <= 0 || elapsed < 180_000) {
    return null
  }

  return Math.max(0, (vitals.usd / elapsed) * 3_600_000)
}

export const computeHealth = (
  list: readonly CallRec[],
  vitals: Vitals,
  samples: readonly SpendSample[],
  now: number,
): Health => {
  // errors: share of the last 50 finished calls that failed (40% or more scores 0).
  const finished = list.filter(one => one.end !== null).slice(-50)
  const errs = finished.filter(one => one.isErr).length
  const ratio = finished.length === 0 ? 0 : errs / finished.length
  const errorScore = finished.length < 3 ? 100 : Math.round(100 - clamp((ratio / 0.4) * 100, 0, 100))

  // loops: calls identical to the call right before them, in the last 30 (4 or more scores 0).
  const recent = list.slice(-30)
  let repeats = 0
  let streak = 1
  let longest = recent.length > 0 ? 1 : 0

  for (let i = 1; i < recent.length; i += 1) {
    if (recent[i]?.sig === recent[i - 1]?.sig) {
      repeats += 1
      streak += 1
      longest = Math.max(longest, streak)
    } else {
      streak = 1
    }
  }
  const loopScore = Math.round(100 - clamp(repeats * 25, 0, 100))

  // context: free up to 50% full, then 2 points per percent (100% scores 0).
  const ctx = vitals.ctx
  const ctxScore = ctx === null ? 100 : Math.round(ctx <= 50 ? 100 : clamp(100 - (ctx - 50) * 2, 0, 100))

  // spend: free up to $5/h, then linear to 0 at $20/h.
  const rate = spendRate(samples, vitals, now)
  const spendScore =
    rate === null || rate <= SPEND_FREE_PER_HOUR
      ? 100
      : Math.round(100 - clamp(((rate - SPEND_FREE_PER_HOUR) / (SPEND_ZERO_PER_HOUR - SPEND_FREE_PER_HOUR)) * 100, 0, 100))

  const factors: Factor[] = [
    {
      key: 'errors',
      label: 'Error ratio',
      score: errorScore,
      weight: WEIGHTS.errors,
      detail: finished.length < 3 ? 'too few finished calls to judge' : `${errs} of the last ${finished.length} calls failed`,
    },
    {
      key: 'loops',
      label: 'Loop repeats',
      score: loopScore,
      weight: WEIGHTS.loops,
      detail: repeats === 0 ? 'no immediate repeats' : `${repeats} repeat${repeats === 1 ? '' : 's'}, longest run ${longest}`,
    },
    {
      key: 'context',
      label: 'Context window',
      score: ctxScore,
      weight: WEIGHTS.context,
      detail: ctx === null ? 'not reported yet' : `${Math.round(ctx)}% full`,
    },
    {
      key: 'spend',
      label: 'Spend rate',
      score: spendScore,
      weight: WEIGHTS.spend,
      detail: rate === null ? 'too early to tell' : `$${rate.toFixed(2)} per hour`,
    },
  ]
  const score = Math.round(factors.reduce((sum, one) => sum + one.score * one.weight, 0))

  return { score: clamp(score, 0, 100), band: bandOf(score), factors }
}

// ---------------------------------------------------------------- 20 per-tool cost

export const addTotal = (
  totals: Record<string, ToolTotal>,
  tool: string,
  ms: number,
  bytes: number,
  isErr: boolean,
): Record<string, ToolTotal> => {
  const old = totals[tool] ?? { n: 0, bytes: 0, ms: 0, errors: 0 }
  const keys = Object.keys(totals)
  // A bounded table: past 80 distinct tools the rest count together under "(other)".
  const key = totals[tool] === undefined && keys.length >= 80 ? '(other)' : tool
  const base = totals[key] ?? old

  return {
    ...totals,
    [key]: {
      n: base.n + 1,
      bytes: base.bytes + Math.max(0, bytes),
      ms: base.ms + Math.max(0, ms),
      errors: base.errors + (isErr ? 1 : 0),
    },
  }
}

export const rankTotals = (totals: Record<string, ToolTotal>, by: 'bytes' | 'ms'): [string, ToolTotal][] =>
  Object.entries(totals).sort((a, b) => b[1][by] - a[1][by] || a[0].localeCompare(b[0]))

// ---------------------------------------------------------------- 21 replay

export const clampPos = (pos: number, length: number): number =>
  length <= 0 ? -1 : pos < 0 || pos >= length ? length - 1 : pos

export const stepPos = (pos: number, length: number, to: 'first' | 'prev' | 'next' | 'last'): number => {
  if (length <= 0) {
    return -1
  }
  const at = clampPos(pos, length)

  return to === 'first' ? 0 : to === 'last' ? length - 1 : to === 'prev' ? Math.max(0, at - 1) : Math.min(length - 1, at + 1)
}

export const positionBar = (pos: number, length: number, width = 24): string => {
  if (length <= 0) {
    return '░'.repeat(width)
  }
  const filled = Math.max(1, Math.round(((clampPos(pos, length) + 1) / length) * width))

  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------- 18 prompt linter

export type Lint = { rule: 'pronoun' | 'short'; hint: string }

const OK_SHORT = new Set([
  'yes', 'no', 'y', 'n', 'ok', 'okay', 'sure', 'continue', 'go', 'go on', 'go ahead', 'proceed', 'thanks', 'thank you',
  'stop', 'done', 'next', 'retry', 'lgtm', 'commit', 'push', 'undo', 'again', 'cancel', 'yep', 'nope', 'please', 'hi', 'hello',
])
const PRONOUNS = new Set(['it', 'this', 'that', 'them', 'these', 'those', 'stuff', 'thing', 'things', 'everything', 'something'])
const CLEAR_VERB = /^(run|build|commit|push|lint|format|test|show|list|explain|summarize|review|undo|revert|install|open)\s+\S+/i
const EXTENSIONS = 'ts|tsx|js|jsx|mjs|py|go|rs|md|json|yml|yaml|css|html|sh|swift|java|kt|rb|c|h|cpp|txt|toml|sql|lock|env|ipynb|xml|plist'
const CONCRETE: readonly RegExp[] = [
  new RegExp(`[\\w-]+\\.(?:${EXTENSIONS})\\b`, 'i'),
  /(?:^|\s)(?:~|\.{1,2})?\/[\w.-]+/,
  /[\w.-]+\/[\w.-]+/,
  /`[^`]+`/,
  /\b[a-z]+[A-Z]\w*\b/,
  /\b[A-Z][a-z0-9]+[A-Z]\w*\b/,
  /\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/,
  /\w+\(\)/,
  /https?:\/\//,
  /["“][^"”]{3,}["”]/,
  /:\d+\b/,
  /#\d+\b/,
  /@[\w./-]+/,
  /\b(?:TS|E)\d{3,}\b/,
]

export const hasConcreteToken = (text: string) => CONCRETE.some(pattern => pattern.test(text))

export const lintDraft = (draft: string): Lint | null => {
  const text = draft.trim()

  if (text.length < 3 || /^[/!#]/.test(text) || text.includes('```') || text.length > 200) {
    return null
  }
  const words = text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean)

  if (words.length === 0 || hasConcreteToken(text)) {
    return null
  }
  const plain = words.join(' ')

  if (OK_SHORT.has(plain)) {
    return null
  }
  if (words.length <= 6 && words.some(word => PRONOUNS.has(word))) {
    return {
      rule: 'pronoun',
      hint: `"${oneLine(text, 40)}" leaves a lot to guess. Name the file, function or error it points at.`,
    }
  }
  if (words.length <= 2 && text.length < 16 && !(words.length === 2 && CLEAR_VERB.test(text))) {
    return { rule: 'short', hint: 'Very short. Add what to change, where, and how you will know it worked.' }
  }

  return null
}

// ---------------------------------------------------------------- 23 auto-title

const STOP = new Set(
  (
    'a an the and or but so if then than that this these those it its it\'s i i\'m i\'ve i\'d me my mine we us our you your yours he she they them ' +
    'to of in on at by for with from into onto about as is are was were be been being am do does did done doing have has had having ' +
    'can could would should will shall may might must please pls just also really very quite maybe some any all each every more most ' +
    'there here what which who whom whose when where why how not no yes ok okay want need needs wanna gonna lets let\'s let help ' +
    'like get got make makes using use want thing things stuff something anything everything again now still too up out over ' +
    'hey hi hello thanks thank claude look looks looking see try trying work working works'
  ).split(/\s+/),
)

export const MAX_TITLE_WORDS = 6
export const MAX_TITLE_CHARS = 50

export const titleFrom = (prompt: string): string | null => {
  const clean = prompt
    .slice(0, 400)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`/g, ' ')
  const out: string[] = []
  const seen = new Set<string>()

  for (const raw of clean.split(/[\s,;:!?()"“”[\]{}]+/)) {
    const base = raw.includes('/') ? (raw.split('/').filter(Boolean).pop() ?? '') : raw
    const word = base.replace(/^[^A-Za-z0-9_@]+|[^A-Za-z0-9_]+$/g, '')
    const lower = word.toLowerCase()

    if (word.length < 2 || /^\d+$/.test(word) || STOP.has(lower) || seen.has(lower)) {
      continue
    }
    seen.add(lower)
    out.push(/[A-Z_.]/.test(word.slice(1)) || word.includes('.') ? word : lower)

    if (out.length >= MAX_TITLE_WORDS) {
      break
    }
  }
  if (out.length < 2) {
    return null
  }
  // Whole words only: drop from the end until the title fits.
  while (out.length > 2 && out.join(' ').length > MAX_TITLE_CHARS) {
    out.pop()
  }
  const title = out.join(' ')

  return clip(title.charAt(0).toUpperCase() + title.slice(1), MAX_TITLE_CHARS)
}

// ---------------------------------------------------------------- 24 snapshot browser (read-only git)

const REF_PREFIX = 'refs/claude-checkpoints/'

// The only two git invocations this mod may run. Anything else is refused before it reaches `$.process.run`.
export const isReadOnlyGit = (argv: readonly string[]): boolean => {
  const [verb, ...rest] = argv

  if (verb === 'for-each-ref') {
    return rest.every(arg => !arg.startsWith('--exec'))
  }
  if (verb === 'diff') {
    return (
      rest.some(arg => arg.startsWith('--stat')) &&
      rest.every(arg => !arg.startsWith('--output') && arg !== '-o' && arg !== '--ext-diff' && arg !== '--textconv')
    )
  }

  return false
}

export const REFS_ARGV = [
  'for-each-ref',
  '--format=%(refname)%09%(objectname)%09%(creatordate:unix)%09%(subject)',
  REF_PREFIX,
] as const

export const statArgv = (from: string, to: string) =>
  ['diff', '--stat=200,160', '--no-renames', '--no-color', '--no-ext-diff', from, to] as const

export type RefRow = { ref: string; n: number; sha: string; at: number; subject: string }

export const parseRefs = (stdout: string): RefRow[] =>
  stdout
    .split('\n')
    .map(line => line.split('\t'))
    .filter(cols => (cols[0] ?? '').startsWith(REF_PREFIX) && cols.length >= 3)
    .map(cols => ({
      ref: cols[0] ?? '',
      n: Number((cols[0] ?? '').slice(REF_PREFIX.length)),
      sha: cols[1] ?? '',
      at: Number(cols[2] ?? 0) * 1000,
      subject: (cols[3] ?? '').trim(),
    }))
    .filter(row => Number.isFinite(row.n) && row.n > 0 && /^[0-9a-f]{7,64}$/.test(row.sha))
    .sort((a, b) => a.n - b.n)

export const parseStat = (stdout: string): { files: SnapFile[]; summary: string } => {
  const files: SnapFile[] = []
  let summary = ''

  for (const line of stdout.split('\n')) {
    const row = /^\s*(.+?)\s+\|\s+(.*\S)\s*$/.exec(line)

    if (row !== null) {
      files.push({ path: row[1] ?? '', change: row[2] ?? '' })
    } else if (/\bfiles? changed\b/.test(line)) {
      summary = line.trim()
    }
  }

  return { files, summary }
}
