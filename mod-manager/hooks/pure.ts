// Pure logic of the mod manager: nothing here touches the engine, a process, the network or the disk.
// register.tsx wires it up; pure.test.ts tests it.
import type {
  Bundles,
  IconPack,
  Installed,
  InstalledStatus,
  LogEntry,
  LogKind,
  Pending,
  RemotePlugin,
  RemoteRow,
  Scope,
  Step,
  Verb,
} from '../types'
import type { CatalogMod } from './catalog'

// ------------------------------------------------------------------ constants

export const PREFIX = 'mm'
export const VERBS: readonly Verb[] = ['install', 'enable', 'disable', 'update', 'uninstall']
export const SCOPES: readonly Scope[] = ['user', 'project', 'local']
export const SELF = 'mod-manager'
/** Guards: switching these off or removing them needs the extra word in the first command. */
export const GUARDS: readonly string[] = ['tool-guard', 'safety-pro', 'controls']
export const YES_WORD = '--yes-i-know'
export const DEFAULT_MARKET = 'local-mods'
export const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}(@[a-z0-9._-]{1,63})?$/
export const MARKET_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/
export const BUNDLE_RE = /^[a-z][a-z0-9-]{0,23}$/

export const PENDING_MS = 120_000
export const RUN_TIMEOUT_MS = 120_000
export const LOG_MAX = 100
export const TAIL_LINES = 200
export const HEAD_LINES = 5
export const MAX_STEPS = 60
export const MAX_BUNDLES = 20
export const FETCH_TIMEOUT_MS = 15_000
export const FETCH_MAX_CHARS = 1_000_000
export const MAX_REMOTE_PLUGINS = 500
export const ALLOWED_HOSTS: readonly string[] = ['github.com', 'raw.githubusercontent.com', 'gist.githubusercontent.com']

/** Every command of this mod and its one-line help. The first is the bare prefix. */
export const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['mm', 'Mod manager: open the pane and list every command', ''],
  ['mmsettings', 'All your mods\' settings in one panel', ''],
  ['mmlist', 'Show the installed plugins (read-only plugin list) and the reachable CLI', '[refresh]'],
  ['mmcat', 'List the catalog of mods by category', '[category]'],
  ['mmdo', 'Install, enable, disable, update or uninstall a plugin: prints the command, then /mmdo confirm runs it', '<verb> <name> [--scope user|project|local] | confirm | cancel'],
  ['mmbundle', 'Named lists of mods: list, show, apply (needs /mmdo confirm), add, rm', 'list | show <name> | apply <name> [verb] | add <name> <mod,mod> | rm <name>'],
  ['mmsource', 'Store one https URL of a marketplace.json to compare against', '<https url> | off'],
  ['mmcheck', 'Fetch the stored marketplace.json and show NEW mods and newer versions (installs nothing)', ''],
  ['mmmarket', 'Marketplace name used in command lines (default local-mods)', '<name>'],
  ['mmfeatures', 'Open the Features tab: switch each mod\'s pop-ups, sounds, status and row on or off (runs /cfg feature)', '[mod]'],
  ['mmsearch', 'Search the catalog by name, description, category or command', '<text>'],
  ['mmcmds', 'Show the commands of one catalog mod', '<mod>'],
  ['mmreport', 'Text report of installed plugins (names, versions, status only) for a bug report', ''],
  ['mmreset', 'Clear everything this mod recorded: log, pending action, bundles, source, market', ''],
]

export const BUILTIN_BUNDLES: Readonly<Record<string, readonly string[]>> = {
  calm: ['settings', 'sound-pack', 'alerts'],
  focus: ['settings', 'workbench', 'notes'],
  dev: ['git-kit', 'debug-kit', 'review-kit', 'safety-pro', 'tool-guard'],
  look: ['looks', 'skins', 'skins-plus', 'animations', 'motion'],
}

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

// A home directory is machine-specific: show it as ~ in anything that is logged or reported.
const HOME_RE = new RegExp(`(?:[A-Za-z]:)?[\\\\/](?:${['Users', 'home'].join('|')})[\\\\/][^\\\\/\\s:'"]+`, 'g')

export const maskPaths = (text: string, home?: string): string => {
  let out = text

  if (home !== undefined && home.length > 3) {
    out = out.split(home).join('~')
  }

  return out.replace(HOME_RE, '~')
}

/** Clean text that came from a process or the network before it is shown or stored. */
export const sanitize = (text: string, home?: string): string => maskPaths(maskSecrets(stripAnsi(text)), home)

export const tailLines = (text: string, max = TAIL_LINES): string[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines.slice(-max)
}

export const headLines = (lines: readonly string[], max = HEAD_LINES): string[] => lines.filter(l => l.trim() !== '').slice(0, max)

/** The text of a finished command: stdout then stderr, cleaned, at most 200 lines. */
export const formatOutput = (stdout: string, stderr: string, home?: string): string[] => {
  const out = tailLines(sanitize(stdout, home))
  const err = tailLines(sanitize(stderr, home)).map(l => (l === '' ? l : `! ${l}`))

  return [...out, ...err].slice(-TAIL_LINES)
}

// ------------------------------------------------------------------ versions

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

  // A version with a pre-release tag is older than the same version without one.
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

// ------------------------------------------------------------------ validating a command

export const baseName = (name: string): string => name.split('@')[0] ?? name

export const isVerb = (word: string): word is Verb => (VERBS as readonly string[]).includes(word)
export const isScope = (word: string): word is Scope => (SCOPES as readonly string[]).includes(word)
export const isGuard = (name: string): boolean => GUARDS.includes(baseName(name))

export type Check = { ok: true } | { ok: false; error: string }

/** The rules for guards and for the manager itself. `hasYes` is the extra word in the first command. */
export const guardCheck = (verb: Verb, name: string, hasYes: boolean): Check => {
  const base = baseName(name)
  const weakens = verb === 'disable' || verb === 'uninstall'

  if (weakens && base === SELF) {
    return { ok: false, error: `Refused: ${SELF} will not ${verb} itself. Do that yourself from a terminal if you really mean it.` }
  }

  if (weakens && GUARDS.includes(base)) {
    return hasYes
      ? { ok: true }
      : { ok: false, error: `Refused: ${base} is a guard. To ${verb} it, repeat the command with ${YES_WORD} (e.g. /mmdo ${verb} ${base} ${YES_WORD}).` }
  }

  if (hasYes) {
    return { ok: false, error: `Refused: ${YES_WORD} is only for disabling or uninstalling a guard (${GUARDS.join(', ')}); it is not needed here.` }
  }

  return { ok: true }
}

export type DoParse =
  | { kind: 'help' }
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'action'; verb: Verb; name: string; scope: Scope; hasYes: boolean }
  | { kind: 'error'; message: string }

const err = (message: string): DoParse => ({ kind: 'error', message })

/** Parse the arguments of `/mmdo`. Only a verb, one name, `--scope <s>` and `--yes-i-know` are understood. */
export const parseDoArgs = (args: string): DoParse => {
  const tokens = args.trim().split(/\s+/).filter(t => t !== '')

  if (tokens.length === 0) {
    return { kind: 'help' }
  }
  const first = (tokens[0] ?? '').toLowerCase()

  if (first === 'confirm' || first === 'cancel') {
    return tokens.length === 1 ? { kind: first } : err(`/mmdo ${first} takes nothing after it.`)
  }

  if (!isVerb(first)) {
    return err(`Unknown verb "${clip(first, 30)}". Use one of: ${VERBS.join(', ')}, or confirm, or cancel.`)
  }
  let name = ''
  let scope: Scope | undefined
  let hasYes = false

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i] ?? ''
    let value: string | undefined

    if (tok === '--scope' || tok.startsWith('--scope=')) {
      value = tok === '--scope' ? tokens[++i] : tok.slice('--scope='.length)

      if (scope !== undefined) {
        return err('--scope given twice.')
      }

      if (value === undefined || !isScope(value)) {
        return err(`--scope must be one of: ${SCOPES.join(', ')}.`)
      }
      scope = value
    } else if (tok === YES_WORD) {
      hasYes = true
    } else if (tok.startsWith('-')) {
      return err(`Flag "${clip(tok, 30)}" is not allowed. Only --scope user|project|local is understood (and ${YES_WORD} for guards).`)
    } else if (name !== '') {
      return err('One name per command. For several mods use /mmbundle.')
    } else {
      name = tok
    }
  }

  if (name === '') {
    return err(`Usage: /mmdo ${first} <name>`)
  }

  if (!NAME_RE.test(name)) {
    return err(`"${clip(name, 40)}" is not a valid plugin name (lowercase letters, digits, . _ - and an optional @marketplace).`)
  }
  const verdict = guardCheck(first, name, hasYes)

  return verdict.ok ? { kind: 'action', verb: first, name, scope: scope ?? 'user', hasYes } : err(verdict.error)
}

export const isMarketName = (s: string): boolean => MARKET_RE.test(s)

/** Which plugin id a command line should name. */
export const resolveTarget = (verb: Verb, name: string, market: string, installed: readonly Installed[] | null): string => {
  if (name.includes('@')) {
    return name
  }

  if (verb === 'install') {
    return `${name}@${market}`
  }
  const same = (installed ?? []).filter(i => i.name === name)

  return same.length === 1 && same[0] !== undefined ? same[0].id : name
}

export const stepArgs = (s: Step): string[] => ['plugin', s.verb, s.target, '--scope', s.scope]
/** The line a person reads and copies. The binary shows as `claude` whichever one is used at run time. */
export const stepLine = (s: Step): string => ['claude', ...stepArgs(s)].join(' ')
export const stepArgv = (cli: readonly string[], s: Step): string[] => [...cli, ...stepArgs(s)]

/** A step is only valid when each part matches the rules again; the runner checks this before every process call. */
export const stepIsValid = (s: Step): boolean =>
  isVerb(s.verb) && isScope(s.scope) && NAME_RE.test(s.target) && !((s.verb === 'disable' || s.verb === 'uninstall') && baseName(s.target) === SELF)

// ------------------------------------------------------------------ pending actions

export const makePending = (steps: Step[], label: string, now: number, note = ''): Pending => ({
  steps,
  createdAt: now,
  expiresAt: now + PENDING_MS,
  label: clip(label, 80),
  note: clip(note, 300),
})

export const pendingState = (p: Pending | null, now: number): 'none' | 'valid' | 'expired' =>
  p === null ? 'none' : now < p.expiresAt ? 'valid' : 'expired'

export const secondsLeft = (p: Pending, now: number): number => Math.max(0, Math.ceil((p.expiresAt - now) / 1000))

/** The origins that are a person typing. Everything else (a plugin, a scheduled task, a peer, the SDK) may not confirm. */
export const isPersonOrigin = (origin: unknown): boolean => {
  const kind = typeof origin === 'object' && origin !== null ? (origin as { kind?: unknown }).kind : undefined

  return kind === 'composer' || kind === 'bridge' || kind === 'unclassified'
}

// ------------------------------------------------------------------ the log

export const mkEntry = (
  at: number,
  kind: LogKind,
  text: string,
  extra: { argv?: string; exit?: number | null; head?: readonly string[]; home?: string } = {},
): LogEntry => ({
  at,
  kind,
  text: clip(sanitize(text, extra.home), 300),
  argv: clip(sanitize(extra.argv ?? '', extra.home), 200),
  exit: extra.exit ?? null,
  head: (extra.head ?? []).slice(0, HEAD_LINES).map(l => clip(sanitize(l, extra.home), 160)),
})

export const pushLog = (log: readonly LogEntry[], entry: LogEntry): LogEntry[] => [...log, entry].slice(-LOG_MAX)

/** A stored log from an earlier version or a damaged store is cut down to what is safe to draw. */
export const normalizeLog = (raw: unknown): LogEntry[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const kinds: readonly string[] = ['pending', 'confirm', 'result', 'cancel', 'expired', 'refused', 'source', 'check', 'feature']

  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .filter(e => typeof e.at === 'number' && typeof e.kind === 'string' && kinds.includes(e.kind))
    .map(e => ({
      at: e.at as number,
      kind: e.kind as LogKind,
      text: clip(sanitize(String(e.text ?? '')), 300),
      argv: clip(sanitize(String(e.argv ?? '')), 200),
      exit: typeof e.exit === 'number' ? e.exit : null,
      head: Array.isArray(e.head) ? e.head.slice(0, HEAD_LINES).map(l => clip(sanitize(String(l)), 160)) : [],
    }))
    .slice(-LOG_MAX)
}

export const fmtClock = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export const fmtEntry = (e: LogEntry): string => {
  const exit = e.exit === null ? '' : ` exit ${e.exit}`

  return `${fmtClock(e.at)} ${e.kind}${exit}  ${e.argv !== '' ? `${e.argv}  ` : ''}${e.text}`.trimEnd()
}

// ------------------------------------------------------------------ finding the CLI

export type DirEntry = { name: string; kind: string }

/** `2.1.330` -> [2, 1, 330]; anything else null. */
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

/** Folder names that are versions, highest first. */
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

/**
 * Where the desktop app's bundled binary may be: the highest version folder under the app's claude-code
 * folder, the hash folder inside it, then the app bundle. `list` reads one directory and rejects when it is missing.
 * Returns up to four candidate paths, best first; the caller tries each with `--version`.
 */
export const discoverBundled = async (
  home: string | undefined,
  list: (path: string) => Promise<readonly DirEntry[]>,
): Promise<string[]> => {
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

// ------------------------------------------------------------------ the installed list

const clean = (v: unknown, max: number): string => clip(stripAnsi(typeof v === 'string' || typeof v === 'number' ? String(v) : ''), max)
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(@[A-Za-z0-9._-]{1,127})?$/

const mkInstalled = (id: string, version: string, scope: string, status: InstalledStatus): Installed => {
  const at = id.indexOf('@')

  return {
    id,
    name: at < 0 ? id : id.slice(0, at),
    market: at < 0 ? '' : id.slice(at + 1),
    version: clip(version, 32),
    scope: clip(scope, 16),
    status,
  }
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
 * "❯ name@market / Version: / Scope: / Status:"). Only the id, version, scope and status are kept: the folders
 * the output names are never stored.
 */
export const parsePluginList = (text: string): ListParse => {
  const body = stripAnsi(text).trim()

  if (body.startsWith('[') || body.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(body)
      const rows = Array.isArray(data) ? data : Array.isArray((data as { plugins?: unknown }).plugins) ? (data as { plugins: unknown[] }).plugins : null

      if (rows === null) {
        return { ok: false, error: 'plugin list gave JSON that is not a list' }
      }
      const list: Installed[] = []

      for (const row of rows.slice(0, 500)) {
        const r = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>
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

export type ModStatus = 'enabled' | 'disabled' | 'error' | 'absent' | 'unknown'

export const findInstalled = (list: readonly Installed[] | null, name: string): Installed | undefined => {
  if (list === null) {
    return undefined
  }
  const byId = list.find(i => i.id === name)

  return byId ?? list.find(i => i.name === baseName(name))
}

export const statusOf = (list: readonly Installed[] | null, name: string): ModStatus => {
  if (list === null) {
    return 'unknown'
  }

  return findInstalled(list, name)?.status ?? 'absent'
}

export const hasNewer = (list: readonly Installed[] | null, mod: Pick<CatalogMod, 'name' | 'version'>): boolean => {
  const have = findInstalled(list, mod.name)

  return have !== undefined && compareVersions(have.version, mod.version) === -1
}

export const chipFor = (status: ModStatus, icons: IconPack, isNewer = false): { text: string; color: string } => {
  const table: Record<IconPack, Record<ModStatus, string>> = {
    symbols: { enabled: '●', disabled: '○', error: '✕', absent: '·', unknown: '?' },
    letters: { enabled: 'ON', disabled: 'OFF', error: 'ERR', absent: '--', unknown: '??' },
    minimal: { enabled: 'on', disabled: 'off', error: 'err', absent: '-', unknown: '?' },
  }
  const color: Record<ModStatus, string> = { enabled: 'success', disabled: 'warning', error: 'error', absent: 'subtle', unknown: 'subtle' }
  const mark = isNewer ? (icons === 'symbols' ? '↑' : '+') : ''

  return { text: `${table[icons][status]}${mark}`, color: isNewer ? 'suggestion' : color[status] }
}

export const WIDTH_PAD: Record<IconPack, number> = { symbols: 2, letters: 4, minimal: 4 }

// ------------------------------------------------------------------ catalog helpers

export const CATEGORIES = [
  'look', 'charts', 'animation', 'assist', 'progress', 'safety', 'notes', 'prompts', 'git', 'learning', 'alerts', 'layout', 'fun', 'settings', 'manager',
] as const

export const findMod = (catalog: readonly CatalogMod[], name: string): CatalogMod | undefined => {
  const base = baseName(name.trim().toLowerCase())

  return catalog.find(m => m.name === base)
}

export const modsInCategory = (catalog: readonly CatalogMod[], category: string): CatalogMod[] =>
  category === 'all' ? [...catalog] : catalog.filter(m => m.category === category)

export const searchCatalog = (catalog: readonly CatalogMod[], query: string, limit = 15): CatalogMod[] => {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== '')

  if (words.length === 0) {
    return []
  }
  const scored = catalog.map(mod => {
    let score = 0

    for (const w of words) {
      const hay = [
        [mod.name, 5],
        [mod.help ?? '', 4],
        [mod.category, 3],
        [mod.description, 1],
        [mod.cmds.map(c => `${c.name} ${c.desc}`).join(' '), 1],
      ] as const
      const hit = hay.filter(([text]) => text.toLowerCase().includes(w))

      if (hit.length === 0) {
        return { mod, score: 0 }
      }
      score += Math.max(...hit.map(([, weight]) => weight))
    }

    return { mod, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || a.mod.name.localeCompare(b.mod.name))
    .slice(0, limit)
    .map(s => s.mod)
}

/** Mods that depend on others come after the ones they need, so a bundle installs the base first. */
export const orderMods = (names: readonly string[], catalog: readonly CatalogMod[]): string[] => {
  const depth = (name: string): number => {
    const mod = findMod(catalog, name)

    return mod === undefined || mod.deps.length === 0 ? 0 : 1 + Math.max(...mod.deps.map(d => (d === name ? 0 : depth(d))))
  }

  return names
    .map((name, i) => ({ name, i, d: Math.min(depth(name), 5) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(x => x.name)
}

// ------------------------------------------------------------------ bundles

export const allBundleNames = (user: Bundles): string[] => ['calm', 'focus', 'full', 'dev', 'look', ...Object.keys(user).sort()]

export const bundleMembers = (name: string, user: Bundles, catalog: readonly CatalogMod[]): string[] | undefined => {
  if (name === 'full') {
    return catalog.map(m => m.name)
  }
  const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_BUNDLES, name) ? BUILTIN_BUNDLES[name] : undefined

  if (builtin !== undefined) {
    return [...builtin]
  }
  const mine = Object.prototype.hasOwnProperty.call(user, name) ? user[name] : undefined

  return mine === undefined ? undefined : [...mine]
}

export const isBuiltinBundle = (name: string): boolean => name === 'full' || Object.prototype.hasOwnProperty.call(BUILTIN_BUNDLES, name)

export type BundleParse =
  | { kind: 'list' }
  | { kind: 'show'; name: string }
  | { kind: 'rm'; name: string }
  | { kind: 'add'; name: string; mods: string[] }
  | { kind: 'apply'; name: string; verb: Verb | 'auto'; scope: Scope; hasYes: boolean }
  | { kind: 'error'; message: string }

export const parseModList = (text: string): { ok: true; mods: string[] } | { ok: false; error: string } => {
  const parts = text.split(/[\s,]+/).filter(p => p !== '')
  const mods: string[] = []

  for (const p of parts) {
    if (!NAME_RE.test(p)) {
      return { ok: false, error: `"${clip(p, 40)}" is not a valid plugin name.` }
    }

    if (!mods.includes(p)) {
      mods.push(p)
    }
  }

  if (mods.length === 0) {
    return { ok: false, error: 'Give at least one mod, e.g. /mmbundle add mine settings,notes' }
  }

  return mods.length > MAX_STEPS ? { ok: false, error: `A bundle holds at most ${MAX_STEPS} mods.` } : { ok: true, mods }
}

export const parseBundleArgs = (args: string): BundleParse => {
  const tokens = args.trim().split(/\s+/).filter(t => t !== '')
  const sub = (tokens[0] ?? 'list').toLowerCase()
  const name = tokens[1] ?? ''

  if (sub === 'list') {
    return { kind: 'list' }
  }

  if (sub === 'show' || sub === 'rm') {
    return name === '' ? { kind: 'error', message: `Usage: /mmbundle ${sub} <name>` } : { kind: sub, name }
  }

  if (sub === 'add') {
    if (!BUNDLE_RE.test(name)) {
      return { kind: 'error', message: 'Bundle names are lowercase letters, digits and dashes, starting with a letter (max 24).' }
    }

    if (isBuiltinBundle(name)) {
      return { kind: 'error', message: `"${name}" is a built-in bundle and cannot be replaced.` }
    }
    const parsed = parseModList(tokens.slice(2).join(' '))

    return parsed.ok ? { kind: 'add', name, mods: parsed.mods } : { kind: 'error', message: parsed.error }
  }

  if (sub === 'apply') {
    if (name === '') {
      return { kind: 'error', message: 'Usage: /mmbundle apply <name> [install|enable|disable|update|uninstall] [--scope user|project|local]' }
    }
    let verb: Verb | 'auto' = 'auto'
    let scope: Scope | undefined
    let hasYes = false

    for (let i = 2; i < tokens.length; i++) {
      const tok = tokens[i] ?? ''

      if (isVerb(tok.toLowerCase()) && verb === 'auto') {
        verb = tok.toLowerCase() as Verb
      } else if (tok === '--scope' || tok.startsWith('--scope=')) {
        const value = tok === '--scope' ? tokens[++i] : tok.slice('--scope='.length)

        if (scope !== undefined || value === undefined || !isScope(value)) {
          return { kind: 'error', message: `--scope must be given once and be one of: ${SCOPES.join(', ')}.` }
        }
        scope = value
      } else if (tok === YES_WORD) {
        hasYes = true
      } else {
        return { kind: 'error', message: `"${clip(tok, 30)}" is not understood here. Allowed: a verb, --scope <s>, ${YES_WORD}.` }
      }
    }

    return { kind: 'apply', name, verb, scope: scope ?? 'user', hasYes }
  }

  return { kind: 'error', message: 'Usage: /mmbundle list | show <name> | apply <name> [verb] | add <name> <mod,mod> | rm <name>' }
}

export type Plan = { steps: Step[]; skipped: string[] }

/** The steps of a bundle apply. Never disables or uninstalls the manager; guards need the extra word. */
export const planBundle = (
  members: readonly string[],
  verb: Verb | 'auto',
  scope: Scope,
  hasYes: boolean,
  installed: readonly Installed[] | null,
  market: string,
  catalog: readonly CatalogMod[],
): Plan => {
  const weakens = verb === 'disable' || verb === 'uninstall'
  const ordered = orderMods(members, catalog)
  const list = weakens ? [...ordered].reverse() : ordered
  const steps: Step[] = []
  const skipped: string[] = []

  for (const name of list) {
    const base = baseName(name)
    let chosen: Verb | undefined = verb === 'auto' ? undefined : verb

    if (verb === 'auto') {
      const have = findInstalled(installed, name)

      if (installed === null || have === undefined) {
        chosen = 'install'
      } else if (have.status === 'disabled') {
        chosen = 'enable'
      } else {
        skipped.push(`${base} (already ${have.status === 'enabled' ? 'enabled' : 'installed but not loading'})`)
        continue
      }
    }

    if (chosen === undefined) {
      continue
    }

    if (chosen !== 'install' && installed !== null && findInstalled(installed, name) === undefined) {
      skipped.push(`${base} (not installed)`)
      continue
    }
    const verdict = guardCheck(chosen, name, hasYes && isGuard(name) && (chosen === 'disable' || chosen === 'uninstall'))

    if (!verdict.ok) {
      skipped.push(
        base === SELF
          ? `${base} (a bundle never ${chosen === 'disable' ? 'disables' : 'uninstalls'} it)`
          : `${base} (guard: add ${YES_WORD} to ${chosen} it)`,
      )
      continue
    }
    steps.push({ verb: chosen, target: resolveTarget(chosen, name, market, installed), scope })
  }

  return { steps: steps.slice(0, MAX_STEPS), skipped }
}

// ------------------------------------------------------------------ the remote marketplace

export type UrlParse = { ok: true; url: string; note: string } | { ok: false; error: string }

/** One https URL on a GitHub host, no credentials, no port, no query. A github.com /blob/ link becomes the raw link. */
export const parseSourceUrl = (input: string): UrlParse => {
  const text = input.trim()

  if (text === '' || text.length > 300) {
    return { ok: false, error: 'Give one https URL of a marketplace.json (at most 300 characters).' }
  }

  if (/[\s\u0000-\u001f\u007f]/.test(text)) {
    return { ok: false, error: 'The URL may not contain spaces or control characters.' }
  }

  if (!/^https:\/\//i.test(text)) {
    return { ok: false, error: 'Only https URLs are accepted.' }
  }
  const m = /^https:\/\/([^/?#]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(text)

  if (m === null) {
    return { ok: false, error: 'That is not a URL this mod can read.' }
  }
  const authority = (m[1] ?? '').toLowerCase()
  let path = m[2] ?? ''

  if (authority.includes('@')) {
    return { ok: false, error: 'Credentials in a URL are not accepted.' }
  }

  if (authority.includes(':')) {
    return { ok: false, error: 'A port in the URL is not accepted.' }
  }

  if (!ALLOWED_HOSTS.includes(authority)) {
    return { ok: false, error: `Host must be one of: ${ALLOWED_HOSTS.join(', ')}.` }
  }

  if (m[3] !== undefined || m[4] !== undefined) {
    return { ok: false, error: 'No query string or fragment (they can carry tokens). Use the plain file URL.' }
  }

  if (!/^[A-Za-z0-9._~%/+=-]+$/.test(path) || path.split('/').includes('..')) {
    return { ok: false, error: 'The path has characters this mod does not accept.' }
  }
  let host = authority
  let note = ''

  if (host === 'github.com') {
    const blob = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(path)

    if (blob !== null) {
      host = 'raw.githubusercontent.com'
      path = `/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`
      note = 'A github.com /blob/ link was turned into its raw.githubusercontent.com link.'
    } else if (!/^\/[^/]+\/[^/]+\/raw\/.+/.test(path)) {
      return { ok: false, error: 'On github.com give the link of the file itself (/owner/repo/blob/<branch>/path/marketplace.json).' }
    }
  }
  const last = path.split('/').filter(s => s !== '').pop() ?? ''

  if (!last.toLowerCase().endsWith('.json')) {
    return { ok: false, error: 'The URL should end in the marketplace .json file (usually marketplace.json).' }
  }

  return { ok: true, url: `https://${host}${path}`, note }
}

/** `owner/repo` for a GitHub URL, to print `claude plugin marketplace add owner/repo`; undefined for a gist. */
export const repoFromUrl = (url: string): string | undefined => {
  const m = /^https:\/\/(?:raw\.githubusercontent\.com|github\.com)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\//.exec(url)

  return m === null ? undefined : `${m[1]}/${m[2]}`
}

export type RemoteParse = { ok: true; plugins: RemotePlugin[]; name: string } | { ok: false; error: string }

const noCtl = (s: string): string => clip(stripAnsi(s), 600)

/** Strict shape check of a fetched marketplace.json. Extra keys are ignored; wrong types are errors. */
export const validateMarketplace = (text: unknown): RemoteParse => {
  if (typeof text !== 'string') {
    return { ok: false, error: 'The answer was not text.' }
  }

  if (text.length > FETCH_MAX_CHARS) {
    return { ok: false, error: `The answer is over ${FETCH_MAX_CHARS / 1000} KB; refused.` }
  }
  let data: unknown

  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The answer is not valid JSON (is this the raw file URL?).' }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'The JSON must be an object with a "plugins" array.' }
  }
  const root = data as Record<string, unknown>

  if (!Array.isArray(root.plugins)) {
    return { ok: false, error: 'The JSON has no "plugins" array.' }
  }

  if (root.plugins.length > MAX_REMOTE_PLUGINS) {
    return { ok: false, error: `More than ${MAX_REMOTE_PLUGINS} plugins; refused.` }
  }
  const plugins: RemotePlugin[] = []
  const seen = new Set<string>()

  for (const [i, raw] of root.plugins.entries()) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `plugins[${i}] is not an object.` }
    }
    const p = raw as Record<string, unknown>

    if (typeof p.name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(p.name)) {
      return { ok: false, error: `plugins[${i}].name is missing or not a valid plugin name.` }
    }

    if (seen.has(p.name)) {
      return { ok: false, error: `plugins[${i}].name "${p.name}" appears twice.` }
    }
    seen.add(p.name)
    let source = ''

    if (typeof p.source === 'string' && p.source.length > 0 && p.source.length <= 300) {
      source = p.source
    } else if (typeof p.source === 'object' && p.source !== null && !Array.isArray(p.source)) {
      const entries = Object.entries(p.source as Record<string, unknown>)

      if (entries.length > 8 || entries.some(([, v]) => typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) {
        return { ok: false, error: `plugins[${i}].source has an unexpected shape.` }
      }
      source = 'object'
    } else {
      return { ok: false, error: `plugins[${i}].source must be a string or a flat object.` }
    }

    if (p.description !== undefined && (typeof p.description !== 'string' || p.description.length > 2000)) {
      return { ok: false, error: `plugins[${i}].description must be a string under 2000 characters.` }
    }

    if (p.version !== undefined && (typeof p.version !== 'string' || p.version.length > 64)) {
      return { ok: false, error: `plugins[${i}].version must be a string under 64 characters.` }
    }
    plugins.push({
      name: p.name,
      source: noCtl(source).slice(0, 100),
      description: p.description === undefined ? '' : noCtl(p.description).slice(0, 200),
      version: p.version === undefined ? '' : noCtl(p.version).slice(0, 64),
    })
  }

  return { ok: true, plugins, name: typeof root.name === 'string' ? noCtl(root.name).slice(0, 64) : '' }
}

/** Which remote plugins are new to this machine and which are newer than what is installed (or, with no list, than the catalog). */
export const diffRemote = (
  remote: readonly RemotePlugin[],
  installed: readonly Installed[] | null,
  catalog: readonly Pick<CatalogMod, 'name' | 'version'>[],
): { rows: RemoteRow[]; upToDate: number } => {
  const rows: RemoteRow[] = []
  let upToDate = 0

  for (const r of remote) {
    const have = installed?.find(i => i.name === r.name)
    const cat = catalog.find(c => c.name === r.name)
    const known = have !== undefined ? have.version : cat?.version

    if (known === undefined) {
      rows.push({ name: r.name, kind: 'new', installed: '', remote: r.version, description: r.description })
    } else if (r.version !== '' && compareVersions(known, r.version) === -1) {
      rows.push({ name: r.name, kind: 'update', installed: known, remote: r.version, description: r.description })
    } else {
      upToDate++
    }
  }

  return { rows: rows.slice(0, 100), upToDate }
}

// ------------------------------------------------------------------ feature switches (the Features tab)

/** The four switches every mod has, in the order the tab draws them, with the short word on the button. */
export const FEATURE_KINDS: readonly (readonly [string, string])[] = [
  ['toasts', 'Toasts'],
  ['sounds', 'Sounds'],
  ['status', 'Status'],
  ['band', 'Row'],
]
/** Mods whose four universal switches the settings mod never mutes: shown as locked, with no toggle. */
export const UNMUTABLE: readonly string[] = ['settings', ...GUARDS]
export const FEATURE_PRESETS: readonly { name: string; label: string }[] = [
  { name: 'quiet', label: 'Quiet' },
  { name: 'calm', label: 'Calm' },
  { name: 'full', label: 'Everything on' },
]
export const MAX_QUERY = 40

/** `{ '<mod>.<id>': boolean }`, as the settings mod keeps it. Anything else (a missing atom, a damaged value) reads as no overrides. */
export type Overrides = Record<string, boolean>

export const cleanOverrides = (raw: unknown): Overrides => {
  const out: Overrides = {}

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out
  }

  for (const [id, value] of Object.entries(raw as Record<string, unknown>).slice(0, 2000)) {
    if (typeof value === 'boolean' && id.length <= 90) {
      out[id] = value
    }
  }

  return out
}

export type SwitchView = {
  /** `<mod>.<id>`, the name `/cfg feature` takes. */
  id: string
  key: string
  label: string
  description: string
  group: string
  on: boolean
  dflt: boolean
  changed: boolean
}
export type ModFeatureRow = { mod: CatalogMod; locked: boolean; universal: SwitchView[]; own: SwitchView[] }

const viewOf = (mod: string, key: string, label: string, description: string, group: string, dflt: boolean, overrides: Overrides): SwitchView => {
  const id = `${mod}.${key}`
  const on = Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] === true : dflt

  return { id, key, label, description, group, on, dflt, changed: on !== dflt }
}

export const modFeatureRow = (mod: CatalogMod, overrides: Overrides): ModFeatureRow => {
  const locked = UNMUTABLE.includes(mod.name)

  return {
    mod,
    locked,
    universal: FEATURE_KINDS.map(([key, label]) => viewOf(mod.name, key, label, '', 'Universal', true, locked ? {} : overrides)),
    own: (mod.features ?? []).map(f => viewOf(mod.name, f.id, f.label, f.description, f.group, f.default, overrides)),
  }
}

/** Every word of the query must appear in the mod's name, category, description or one of its own switches. */
export const matchesFeatureQuery = (mod: CatalogMod, query: string): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== '')
  const hay = [mod.name, mod.category, mod.description, ...(mod.features ?? []).flatMap(f => [f.id, f.label, f.group])].join(' ').toLowerCase()

  return words.every(w => hay.includes(w))
}

/** The mods to draw: filtered by the query, in category order, then by name. */
export const featureRows = (catalog: readonly CatalogMod[], overrides: Overrides, query: string): ModFeatureRow[] => {
  const order: readonly string[] = CATEGORIES

  return catalog
    .filter(m => matchesFeatureQuery(m, query))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name))
    .map(m => modFeatureRow(m, overrides))
}

/** How many switches the catalog knows that differ from their default. Ids of unknown mods or switches do not count. */
export const changedSwitches = (catalog: readonly CatalogMod[], overrides: Overrides): number => {
  let n = 0

  for (const mod of catalog) {
    const row = modFeatureRow(mod, overrides)

    if (!row.locked) {
      n += row.universal.filter(s => s.changed).length
    }
    n += row.own.filter(s => s.changed).length
  }

  return n
}

/** The arguments `/cfg` takes for one switch, or for a preset. Ids are checked by the settings mod, not here. */
export const featureArgs = (id: string, on: boolean): string => `feature ${id} ${on ? 'on' : 'off'}`
export const presetArgs = (name: string): string => `feature ${name}`

/** Greedy pages over units of different heights; a unit is never split, and a unit taller than a page gets one to itself. */
export const paginateUnits = (sizes: readonly number[], room: number): number[][] => {
  const pages: number[][] = []
  let current: number[] = []
  let used = 0

  sizes.forEach((size, i) => {
    if (current.length > 0 && used + size > room) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(i)
    used += size
  })

  if (current.length > 0) {
    pages.push(current)
  }

  return pages
}

/** `/mmfeatures [mod]`: an optional filter, lowercase words of letters, digits and . _ - only. */
export const parseFeaturesArgs = (args: string): { ok: true; query: string } | { ok: false; message: string } => {
  const query = args.trim().toLowerCase()

  if (query.length > MAX_QUERY || !/^[a-z0-9._ -]*$/.test(query)) {
    return { ok: false, message: `Usage: /mmfeatures [mod or words]. Letters, digits and . _ - only, at most ${MAX_QUERY} characters.` }
  }

  return { ok: true, query: query.replace(/\s+/g, ' ') }
}

export const featureLine = (row: ModFeatureRow): string =>
  `${row.mod.name}: ${row.locked ? 'always on (a safety mod: its messages cannot be muted)' : row.universal.map(s => `${s.label.toLowerCase()} ${s.on ? 'on' : 'off'}`).join(', ')}${row.own.length === 0 ? '' : `; own: ${row.own.map(s => `${s.key} ${s.on ? 'on' : 'off'}`).join(', ')}`}`

// ------------------------------------------------------------------ text for people

export const helpText = (): string =>
  [
    'Mod manager: a front door for mods and other Claude plugins. Quiet by default; nothing runs without /mmdo confirm.',
    ...COMMANDS.map(([name, desc, usage]) => `/${name}${usage === '' ? '' : ` ${usage}`}: ${desc}`),
    'Switches: the Features tab (or /mmfeatures) turns each mod\'s pop-ups, sounds, status line and row above the prompt on or off. It never disables a plugin.',
    'Safety: /mmdo <verb> <name> only prints the command and stores it for 2 minutes. /mmdo confirm runs exactly that, with no shell, 120 s limit.',
  ].join('\n')

export const buildReport = (
  version: string,
  cli: 'path' | 'bundled' | 'none' | 'unknown',
  installed: readonly Installed[] | null,
  catalogCount: number,
): string => {
  const lines = [
    `mod-manager ${version} report`,
    `catalog: ${catalogCount} mods`,
    `claude cli: ${cli === 'path' ? 'found on PATH' : cli === 'bundled' ? "found in the desktop app's bundle" : cli === 'none' ? 'not reachable' : 'not checked'}`,
  ]

  if (installed === null) {
    lines.push('installed: unknown (run /mmlist first)')
  } else {
    lines.push(`installed (${installed.length}):`)
    const sorted = [...installed].sort((a, b) => a.id.localeCompare(b.id))

    for (const i of sorted) {
      lines.push(`  ${i.id} ${i.version === '' ? '?' : i.version} ${i.scope === '' ? '' : `[${i.scope}] `}${i.status}`.trimEnd())
    }
  }

  return lines.join('\n')
}
