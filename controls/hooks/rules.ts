// Pure helpers for the controls mod. Nothing here touches `$`, so every function
// can be tested by itself and nothing here can fail a tool call by throwing
// at a place that matters: the gates in register.tsx catch and fail closed.

export type Profile = 'strict' | 'normal' | 'off'
export type Preset = 'off' | 'work' | 'personal' | 'presenting'
export type Allow = { text: string; until: number }

export const PROFILES: readonly Profile[] = ['strict', 'normal', 'off']
export const PRESETS: readonly Preset[] = ['work', 'personal', 'presenting', 'off']

// ---------------------------------------------------------------------------
// A COPY of tool-guard's patterns, taken when this mod was built (2026-11-25).
// tool-guard keeps enforcing its own; this copy only lets /cttest explain what
// tool-guard-style rules would say, and lets incident mode use the same idea of
// "mutating". If tool-guard changes later, this copy does not follow.
// ---------------------------------------------------------------------------

export const TG_COPY_DATE = '2026-11-25'

export const TG_MUTATING =
  /\b(rm|mv|cp|touch|mkdir|tee|sed\s+-i|git\s+(commit|push|checkout|reset|rebase|merge|clean)|npm\s+(install|publish)|pip\s+install)\b|>\s*[^&\s]/

export const TG_PROTECTED = /(^|\/)(\.env(\..+)?|id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials)/

export const TG_BLOCKED: readonly (readonly [RegExp, string])[] = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive)\b[^|;&]*\s(\/|~|\$HOME|\*)(\s|$)/, 'recursive delete of root, home or *'],
  [/\bgit\s+push\b[^|;&]*(--force\b|\s-f\b)(?!-with-lease)/, 'force push (use --force-with-lease)'],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'piping a download into a shell'],
  [/\bmkfs\b|\bdd\s+if=.*\sof=\/dev\//, 'disk-level write'],
]

export const TG_HIGH = /\b(sudo|rm\s+-[a-z]*r|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|chmod\s+-R|drop\s+(table|database))\b/i
export const TG_MEDIUM = /\b(rm|mv|git\s+(checkout|rebase|push)|npm\s+(publish|uninstall)|pip\s+uninstall|kill|pkill)\b/i

// ---------------------------------------------------------------------------
// This mod's own deny rules (they do not repeat tool-guard's or safety-pro's)
// ---------------------------------------------------------------------------

export type OwnRule = { id: string; label: string; re: RegExp }
export type Hit = { id: string; label: string }

// Only on the `strict` profile.
export const STRICT_RULES: readonly OwnRule[] = [
  { id: 'sudo', label: 'sudo (runs as administrator)', re: /\bsudo\b/ },
  { id: 'reset-hard', label: 'git reset --hard (discards work)', re: /\bgit\s+reset\s+--hard\b/ },
  { id: 'clean-force', label: 'git clean -f (deletes untracked files)', re: /\bgit\s+clean\s+-[a-z]*f/ },
  { id: 'chmod-recursive', label: 'chmod -R (recursive permission change)', re: /\bchmod\s+(-[a-z]*R|--recursive)\b/ },
  { id: 'drop-sql', label: 'DROP TABLE / DROP DATABASE', re: /\bdrop\s+(table|database)\b/i },
  { id: 'publish', label: 'npm publish (outward-facing)', re: /\bnpm\s+publish\b/ },
]

export const MIN_BLOCK = 3
export const MAX_BLOCK = 80
export const MAX_BLOCKS = 30
export const MAX_ALLOWS = 10
export const MAX_ALLOW_MIN = 120

export const customHit = (literal: string): Hit => ({ id: `block:${literal}`, label: `custom block "${literal}"` })

const matchesAllow = (hit: Hit, text: string) => {
  const t = text.toLowerCase()

  return hit.id.toLowerCase() === t || hit.label.toLowerCase().includes(t)
}

export const isWaived = (hit: Hit, allows: readonly Allow[], now: number) =>
  allows.some(a => a.until > now && matchesAllow(hit, a.text))

export type Verdict = { hit?: Hit; waived: Hit[] }

/** What this mod's profile rules say about a Bash command. First un-waived hit denies. */
export const evalOwn = (
  command: string,
  profile: Profile,
  blocks: readonly string[],
  allows: readonly Allow[],
  now: number,
): Verdict => {
  const waived: Hit[] = []

  if (profile === 'off') {
    return { waived }
  }
  const lower = command.toLowerCase()
  const candidates: { hit: Hit; matched: boolean }[] = [
    ...blocks.map(literal => ({ hit: customHit(literal), matched: lower.includes(literal.toLowerCase()) })),
    ...(profile === 'strict'
      ? STRICT_RULES.map(rule => ({ hit: { id: rule.id, label: rule.label }, matched: rule.re.test(command) }))
      : []),
  ]

  for (const { hit, matched } of candidates) {
    if (!matched) {
      continue
    }

    if (isWaived(hit, allows, now)) {
      waived.push(hit)
      continue
    }

    return { hit, waived }
  }

  return { waived }
}

/** Incident mode: every mutating Bash command and every edit is held. */
export const incidentHit = (tool: string, command: string): Hit | undefined => {
  if (/^(Edit|Write|NotebookEdit)$/.test(tool)) {
    return { id: 'incident', label: 'incident mode: file changes are held' }
  }

  return tool === 'Bash' && TG_MUTATING.test(command)
    ? { id: 'incident', label: 'incident mode: mutating commands are held' }
    : undefined
}

export const parseAllow = (
  args: string,
): { kind: 'list' } | { kind: 'clear' } | { kind: 'add'; text: string; minutes: number } | { kind: 'error'; message: string } => {
  const raw = args.trim()

  if (raw === '') {
    return { kind: 'list' }
  }

  if (raw === 'clear') {
    return { kind: 'clear' }
  }
  const parts = raw.split(/\s+/)
  const last = parts[parts.length - 1] ?? ''

  if (parts.length < 2 || !/^\d+$/.test(last)) {
    return { kind: 'error', message: 'Usage: /ctallow <substring> <minutes>  (for example /ctallow sudo 10), /ctallow to list, /ctallow clear' }
  }
  const minutes = Number(last)
  const text = parts.slice(0, -1).join(' ').replace(/^["']|["']$/g, '')

  if (minutes < 1 || minutes > MAX_ALLOW_MIN) {
    return { kind: 'error', message: `Minutes must be 1 to ${MAX_ALLOW_MIN}.` }
  }

  if (text.length < MIN_BLOCK) {
    return { kind: 'error', message: `The substring must be at least ${MIN_BLOCK} characters, so it names one rule.` }
  }

  return { kind: 'add', text: text.slice(0, MAX_BLOCK), minutes }
}

export const normalizeLiteral = (raw: string): string | { error: string } => {
  const text = raw.trim().replace(/^["']|["']$/g, '')

  if (text.length < MIN_BLOCK) {
    return { error: `A block needs at least ${MIN_BLOCK} characters, or it would match almost every command.` }
  }

  if (text.length > MAX_BLOCK) {
    return { error: `A block is at most ${MAX_BLOCK} characters.` }
  }

  return text
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const normPath = (path: string, cwd: string) => {
  const abs = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`
  const out: string[] = []

  for (const seg of abs.split('/')) {
    if (seg === '' || seg === '.') {
      continue
    }

    if (seg === '..') {
      out.pop()
    } else {
      out.push(seg)
    }
  }

  return `/${out.join('/')}`
}

export const isInside = (path: string, root: string) => {
  const r = root.replace(/\/+$/, '')

  return path === r || path.startsWith(`${r}/`) || r === ''
}

export const dirnameOf = (path: string) => {
  const cut = path.lastIndexOf('/')

  return cut <= 0 ? '/' : path.slice(0, cut)
}

export const clip = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

// ---------------------------------------------------------------------------
// Scrubbing for what gets RECORDED (always on; the presets below are for display)
// ---------------------------------------------------------------------------

const SECRET_RES: readonly RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g,
  /(\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)\S+/gi,
  /(--(?:password|token|api-key|secret)[= ])\S+/gi,
]

export const scrub = (text: string) => {
  let out = text.replace(/(https?:\/\/[^\s'"?#]+)[?#]\S*/g, '$1?…')

  for (const re of SECRET_RES) {
    out = out.replace(re, (_m, keep: unknown) => (typeof keep === 'string' ? `${keep}•••` : '•••'))
  }

  return out
}

/** Looks like a secret? (used by the clipboard watch, which only warns) */
export const looksSecret = (text: string) => scrub(text) !== text.replace(/(https?:\/\/[^\s'"?#]+)[?#]\S*/g, '$1?…')

// ---------------------------------------------------------------------------
// Redaction presets (apply ONLY to this mod's own panes and /ctredact)
// ---------------------------------------------------------------------------

export type RedactRule = { name: string; source: string; flags: string; to: string }

const BASE_RULES: readonly RedactRule[] = [
  { name: 'api keys', source: '\\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}', flags: 'g', to: '•••key' },
  { name: 'github tokens', source: '\\bgh[pousr]_[A-Za-z0-9]{20,}', flags: 'g', to: '•••token' },
  { name: 'aws key ids', source: '\\bAKIA[0-9A-Z]{16}\\b', flags: 'g', to: '•••awskey' },
  { name: 'slack tokens', source: '\\bxox[abprs]-[A-Za-z0-9-]{10,}', flags: 'g', to: '•••token' },
  { name: 'bearer tokens', source: '\\b[Bb]earer\\s+[A-Za-z0-9._~+/=-]{12,}', flags: 'g', to: 'Bearer •••' },
  { name: 'jwt', source: '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]*', flags: 'g', to: '•••jwt' },
]

const WORK_RULES: readonly RedactRule[] = [
  { name: 'email addresses', source: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', flags: 'g', to: '•••@•••' },
  { name: 'ipv4 addresses', source: '\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b', flags: 'g', to: '•.•.•.•' },
  { name: 'user folders', source: '/(Users|home)/[^/\\s]+', flags: 'g', to: '/$1/•••' },
]

const PERSONAL_RULES: readonly RedactRule[] = [
  { name: 'phone numbers', source: '\\+?\\d{1,3}[\\s.-]\\(?\\d{2,4}\\)?[\\s.-]\\d{3,4}[\\s.-]\\d{3,4}\\b', flags: 'g', to: '•••phone' },
  { name: 'home shortcut', source: '(~|\\$HOME)/[^\\s]+', flags: 'g', to: '~/•••' },
]

const PRESENTING_RULES: readonly RedactRule[] = [
  { name: 'url hosts', source: '(https?|ssh|git)://[^/\\s]+', flags: 'g', to: '$1://•••' },
  { name: 'long paths', source: '(?:/[\\w.@+-]+){3,}/([\\w.@+-]+)', flags: 'g', to: '/…/$1' },
]

export const RULES_OF = (preset: Preset): readonly RedactRule[] => {
  switch (preset) {
    case 'work':
      return [...BASE_RULES, ...WORK_RULES]
    case 'personal':
      return [...BASE_RULES, ...WORK_RULES, ...PERSONAL_RULES]
    case 'presenting':
      return [...BASE_RULES, ...WORK_RULES, ...PERSONAL_RULES, ...PRESENTING_RULES]
    default:
      return []
  }
}

/** Masks `text` under a preset. If a stored regex ever fails, the text is hidden (fail closed). */
export const redact = (text: string, preset: Preset) => {
  try {
    let out = text

    for (const rule of RULES_OF(preset)) {
      out = out.replace(new RegExp(rule.source, rule.flags), rule.to)
    }

    return out
  } catch {
    return '••• (hidden: redaction failed)'
  }
}

// ---------------------------------------------------------------------------
// Tool-call readers
// ---------------------------------------------------------------------------

export type Input = Record<string, unknown>

export const str = (value: unknown) => (typeof value === 'string' ? value : '')

export const detailOf = (tool: string, input: Input) =>
  scrub(
    clip(
      tool === 'Bash'
        ? str(input.command)
        : str(input.file_path) || str(input.notebook_path) || str(input.path) || str(input.pattern) || str(input.url),
      90,
    ),
  )

const hostFrom = (authority: string) => {
  const noUser = authority.slice(authority.lastIndexOf('@') + 1)
  const host = noUser.replace(/:\d+$/, '').toLowerCase().replace(/\.$/, '')

  return /^[a-z0-9._-]+$/.test(host) && host !== '' ? host : undefined
}

export type NetHit = { host: string; via: string }

/** Host names only. Never a path, a query or a token. */
export const hostsOf = (tool: string, input: Input): NetHit[] => {
  if (tool === 'WebFetch') {
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/\s?#]*)/i.exec(str(input.url).trim())
    const host = m === null ? undefined : hostFrom(m[1] ?? '')

    return [{ host: host ?? '(unparsed)', via: 'WebFetch' }]
  }

  if (tool === 'WebSearch') {
    return [{ host: '(web search service)', via: 'WebSearch' }]
  }

  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1] ?? 'unknown'

    return [{ host: `mcp:${server}`, via: 'mcp' }]
  }

  if (tool !== 'Bash') {
    return []
  }
  const command = str(input.command)
  const via = /\bcurl\b/.test(command) ? 'curl' : /\bwget\b/.test(command) ? 'wget' : /\bgit\s+clone\b/.test(command) ? 'git clone' : undefined

  if (via === undefined) {
    return []
  }
  const found = new Set<string>()

  for (const m of command.matchAll(/\b(?:https?|ssh|git|ftp|ftps):\/\/([^/\s'"?#`)]*)/gi)) {
    const host = hostFrom(m[1] ?? '')

    if (host !== undefined) {
      found.add(host)
    }
  }

  if (via === 'git clone') {
    for (const m of command.matchAll(/(?:^|\s)[\w.-]+@([A-Za-z0-9._-]+):[^\s]+/g)) {
      const host = hostFrom(m[1] ?? '')

      if (host !== undefined) {
        found.add(host)
      }
    }
  }

  return found.size === 0 ? [{ host: '(unparsed)', via }] : [...found].map(host => ({ host, via }))
}

export type DirHit = { dir: string; kind: 'r' | 'w' }

const unquote = (t: string) => t.replace(/^["']|["']$/g, '')

const redirectTargets = (command: string) => {
  const out: string[] = []

  for (const m of command.matchAll(/(?:^|[^<>&\d])\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>()]+)/g)) {
    out.push(unquote(m[1] ?? ''))
  }

  for (const m of command.matchAll(/\btee\s+(?:-[a-z]+\s+)*("[^"]+"|'[^']+'|[^\s;&|<>()-][^\s;&|<>()]*)/g)) {
    out.push(unquote(m[1] ?? ''))
  }

  return out.filter(t => t !== '' && !t.startsWith('&') && !t.startsWith('/dev/') && !t.includes('$') && !t.includes('`'))
}

export const dirsOf = (tool: string, input: Input, cwd: string): DirHit[] => {
  const fileDir = (path: string, kind: 'r' | 'w'): DirHit[] =>
    path === '' ? [] : [{ dir: dirnameOf(path.startsWith('~') ? path : normPath(path, cwd)), kind }]

  if (tool === 'Read') {
    return fileDir(str(input.file_path), 'r')
  }

  if (/^(Edit|Write)$/.test(tool)) {
    return fileDir(str(input.file_path), 'w')
  }

  if (tool === 'NotebookEdit') {
    return fileDir(str(input.notebook_path) || str(input.file_path), 'w')
  }

  if (tool === 'Glob' || tool === 'Grep') {
    const path = str(input.path)

    return path === '' ? [] : [{ dir: path.startsWith('~') ? path : normPath(path, cwd), kind: 'r' }]
  }

  if (tool === 'Bash') {
    return redirectTargets(str(input.command)).flatMap(t => fileDir(t, 'w'))
  }

  return []
}

// ---------------------------------------------------------------------------
// Warnings: credential files and leaving the project folder
// ---------------------------------------------------------------------------

const CRED_RES: readonly (readonly [RegExp, string])[] = [
  [/\.aws\/credentials\b/, '~/.aws/credentials'],
  [/(^|[/\s'"~=:])\.ssh(\/|\b)/, '~/.ssh'],
  [/\.npmrc\b/, '.npmrc'],
  [/\.netrc\b/, '.netrc'],
]

export const credHits = (text: string): string[] => CRED_RES.filter(([re]) => re.test(text)).map(([, label]) => label)

export const mentionText = (input: Input) =>
  [input.command, input.file_path, input.notebook_path, input.path, input.pattern, input.glob]
    .map(str)
    .filter(t => t !== '')
    .join('\n')

/** Why a shell command leaves the project folder, or undefined. */
export const sandboxNote = (command: string, cwd: string): string | undefined => {
  for (const m of command.matchAll(/(?:^|[\s;&|(])cd(?:\s+("[^"]*"|'[^']*'|[^\s;&|()<>]+))?(?=$|[\s;&|)])/g)) {
    const target = unquote(m[1] ?? '~')

    if (target === '-') {
      continue
    }

    if (target === '~' || target.startsWith('~/') || target.startsWith('$HOME')) {
      return `cd to ${target} (your home folder, outside the project)`
    }
    const abs = normPath(target, cwd)

    if (!isInside(abs, cwd)) {
      return `cd to ${abs}, outside the project folder`
    }
  }

  if (/(^|[\s'"=:])(~|\$HOME)(\/|\s|$|['"])/.test(command)) {
    return 'it touches your home folder (~)'
  }

  if (/(^|[\s'"=:])\/etc(\/|\s|$|['"])/.test(command)) {
    return 'it touches /etc'
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Rule tester: what tool-guard-style rules would say (never runs anything)
// ---------------------------------------------------------------------------

export type TestReport = string[]

export const testReport = (
  subject: string,
  profile: Profile,
  blocks: readonly string[],
  allows: readonly Allow[],
  incident: boolean,
  now: number,
  cwd: string,
): TestReport => {
  const lines: string[] = []
  const editMatch = /^(edit|write)\s+(\S.*)$/i.exec(subject)

  if (editMatch !== null) {
    const path = (editMatch[2] ?? '').trim()

    lines.push(
      TG_PROTECTED.test(path)
        ? `tool-guard (copy): Edit/Write of ${path} would be DENIED (protected secrets path).`
        : `tool-guard (copy): Edit/Write of ${path} is not on its protected-secrets list.`,
    )

    if (incident) {
      lines.push('controls: incident mode is ON, so every edit is denied.')
    }

    for (const label of credHits(path)) {
      lines.push(`controls: would warn (credential path ${label}); warnings never block.`)
    }

    return lines
  }
  const blocked = TG_BLOCKED.filter(([re]) => re.test(subject))

  if (blocked.length > 0) {
    for (const [, why] of blocked) {
      lines.push(`tool-guard (copy): DENIED always: ${why}.`)
    }
  } else {
    lines.push('tool-guard (copy): none of its always-blocked patterns match.')
  }
  lines.push(
    TG_MUTATING.test(subject)
      ? 'tool-guard (copy): looks MUTATING, so it is held while tool-guard read-only mode (/readonly) is on.'
      : 'tool-guard (copy): not mutating, so read-only mode would let it through.',
  )
  const risk = TG_HIGH.test(subject) ? 'high-risk' : TG_MEDIUM.test(subject) ? 'changes things' : undefined
  lines.push(risk === undefined ? 'tool-guard (copy): no risk badge.' : `tool-guard (copy): would badge it "${risk}" (a label, not a block).`)

  const own = evalOwn(subject, profile, blocks, allows, now)

  if (own.hit !== undefined) {
    lines.push(`controls (profile ${profile}): DENIED by ${own.hit.label}.`)
  } else {
    lines.push(`controls (profile ${profile}): none of this mod's rules deny it${own.waived.length > 0 ? ` (waived for now: ${own.waived.map(w => w.id).join(', ')})` : ''}.`)
  }
  const inc = incidentHit('Bash', subject)
  lines.push(incident ? (inc === undefined ? 'controls: incident mode is ON; this one is not mutating, so it passes.' : 'controls: incident mode is ON, so it is DENIED.') : 'controls: incident mode is off.')

  const creds = credHits(subject)

  if (creds.length > 0) {
    lines.push(`controls: would warn about credential paths: ${creds.join(', ')} (warn only).`)
  }
  const outside = sandboxNote(subject, cwd)

  if (outside !== undefined) {
    lines.push(`controls: would remind you of the sandbox (${outside}).`)
  }
  lines.push('safety-pro (protected paths, dry-run, loop guard, budget) depends on its live settings and is not simulated here.')

  return lines
}

// ---------------------------------------------------------------------------
// Privacy dashboard words (from build-time facts)
// ---------------------------------------------------------------------------

export type ModFacts = {
  name: string
  events: readonly string[]
  calls: readonly string[]
  gatesCaught: readonly string[]
  gatesBare: readonly string[]
}

export type Caps = { shell: boolean; read: boolean; write: boolean; net: boolean; store: boolean }

const FS_WRITE = /^\$\.fs\.(write|remove|delete|mkdir|rename|move|copy|append|truncate|rm|unlink)/

export const capsOf = (m: ModFacts): Caps => ({
  shell: m.calls.some(c => c.startsWith('$.process')),
  read: m.calls.some(c => c.startsWith('$.fs') && !FS_WRITE.test(c)),
  write: m.calls.some(c => FS_WRITE.test(c)),
  net: m.calls.some(c => c.startsWith('$.http')),
  store: m.calls.some(c => c.startsWith('$.store')),
})

const CALL_WORDS: readonly (readonly [RegExp, string, number])[] = [
  [/^\$\.process/, 'can run shell commands and programs', 3],
  [FS_WRITE, 'can write or delete files', 3],
  [/^\$\.http/, 'can reach the network', 3],
  [/^\$\.tool\.call/, 'can run tools (Bash, Edit, Read...) by itself', 3],
  [/^\$\.agent/, 'can start subagents', 2],
  [/^\$\.model/, 'can ask the model on its own', 2],
  [/^\$\.mcp/, 'can call your connected MCP servers', 2],
  [/^\$\.fs/, 'can read files', 2],
  [/^\$\.env/, 'can read environment variables', 2],
  [/^\$\.vcs/, 'can read git state', 1],
  [/^\$\.prompt/, 'can fill or read your prompt box', 1],
  [/^\$\.session\.(messages|transcript)/, 'can read the conversation', 2],
  [/^\$\.session\.compact/, 'can compact the conversation', 1],
  [/^\$\.config\.set/, 'can change settings', 2],
  [/^\$\.settings/, 'can read your settings', 1],
  [/^\$\.telemetry/, 'can send telemetry events', 2],
  [/^\$\.store/, 'keeps small notes on disk between sessions', 1],
  [/^\$\.audio/, 'plays sounds or speaks', 0],
]

const EVENT_WORDS: readonly (readonly [string, string, number])[] = [
  ['tool.call', 'sees every tool call and can block or rewrite it', 2],
  ['prompt.submit', 'sees what you type and can rewrite it', 2],
  ['prompt.compose', 'can add to the instructions the model reads', 2],
  ['classic.PermissionRequest', 'is told when a permission dialog opens', 1],
  ['turn.complete', 'sees each finished answer', 1],
]

export type PlainRow = { words: string[]; risk: 0 | 1 | 2 | 3 }

export const plainOf = (m: ModFacts): PlainRow => {
  const seen = new Map<string, number>()

  for (const call of m.calls) {
    for (const [re, words, level] of CALL_WORDS) {
      if (re.test(call)) {
        seen.set(words, level)
        break
      }
    }
  }

  for (const [event, words, level] of EVENT_WORDS) {
    if (m.events.includes(event)) {
      seen.set(words, level)
    }
  }
  const ordered = [...seen.entries()].sort((a, b) => b[1] - a[1])
  const risk = Math.max(0, ...ordered.map(([, level]) => level)) as 0 | 1 | 2 | 3

  return { words: ordered.map(([words]) => words), risk }
}

export const disableCommand = (name: string) => `claude plugin disable ${name}@local-mods`
