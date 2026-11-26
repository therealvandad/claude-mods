// Pure parsers and builders for the "system and project" half of add-kit: nothing here touches the engine, the
// disk or the network. register.tsx feeds them text it got from the read-only wrapper, then draws the result.

/** One line of a pane tab: its text and an optional theme colour name. */
export type Line = { t: string; c?: 'success' | 'warning' | 'error' | 'subtle' | 'inactive' | 'suggestion' | 'claude' }

export const note = (t: string, c?: Line['c']): Line => (c ? { t, c } : { t })
export const toText = (lines: readonly Line[]): string => lines.map(l => l.t).join('\n')
export const trunc = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`)
export const plural = (n: number, w: string): string => `${n} ${n === 1 ? w : /(ch|sh|s|x)$/.test(w) ? `${w}es` : `${w}s`}`
export const splitLines = (s: string): string[] => s.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '')

export const fmtAge = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))

  if (s < 90) return `${s}s`

  if (s < 5400) return `${Math.round(s / 60)}m`

  if (s < 172_800) return `${Math.round(s / 3600)}h`

  return `${Math.round(s / 86_400)}d`
}

export const fmtKb = (kb: number): string => {
  const k = Math.max(0, kb)

  if (k < 1024) return `${Math.round(k)} KB`

  if (k < 1024 * 1024) return `${(k / 1024).toFixed(1)} MB`

  return `${(k / 1024 / 1024).toFixed(1)} GB`
}

export const fmtMs = (ms: number): string => {
  const m = Math.max(0, ms)

  if (m < 1000) return `${Math.round(m)} ms`

  if (m < 60_000) return `${(m / 1000).toFixed(1)} s`

  return `${Math.floor(m / 60_000)}m ${Math.round((m % 60_000) / 1000)}s`
}

const BLOCKS = '▁▂▃▄▅▆▇█'

/** A text sparkline of up to `width` of the latest values. */
export const spark = (values: readonly number[], width = 24): string => {
  const v = values.slice(-width).filter(n => Number.isFinite(n))

  if (v.length === 0) return ''
  const lo = Math.min(...v)
  const hi = Math.max(...v)

  return v.map(n => (hi === lo ? BLOCKS[3] : BLOCKS[Math.min(7, Math.floor(((n - lo) / (hi - lo)) * 7.999))])).join('')
}

/** A horizontal bar of `width` cells for a value out of a maximum. */
export const bar = (value: number, max: number, width = 20): string => {
  const w = max > 0 ? Math.round((Math.max(0, value) / max) * width) : 0

  return '█'.repeat(Math.min(width, w)) + '░'.repeat(Math.max(0, width - w))
}

/** Local calendar day, `YYYY-MM-DD`. */
export const dayKey = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const lastDays = (nowMs: number, n: number): string[] => {
  const out: string[] = []

  for (let i = n - 1; i >= 0; i--) out.push(dayKey(nowMs - i * 86_400_000))

  return out
}

// ------------------------------------------------------------------ secrets

const SECRET_NAME = /(?:secret|token|passw(?:or)?d|passwd|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|auth)/i

const PATTERNS: readonly [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]'],
  [/\b(?:sk|pk|rk)-(?:ant-|live-|test-|proj-)?[A-Za-z0-9_-]{16,}\b/g, '[key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[github token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[github token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[slack token]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[aws key]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[google key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, '[jwt]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [secret]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[user]:[secret]@'],
  [/(\bAuthorization\s*:\s*)[^\s"']+(?:\s+[^\s"']+)?/gi, '$1[secret]'],
]

/** Hides credentials in a line of text: known key shapes, `NAME=value` and `--flag value` pairs whose name sounds secret. */
export const maskSecrets = (input: string): string => {
  let s = typeof input === 'string' ? input : String(input)

  for (const [re, to] of PATTERNS) s = s.replace(re, to)
  // NAME=value and NAME: value (also quoted), where NAME contains a secret-sounding word.
  s = s.replace(/\b([A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"';&|]+)/g, (m, name: string, sep: string) =>
    SECRET_NAME.test(name) ? `${name}${sep}[secret]` : m,
  )
  // --token abc, --password=abc, -p abc is not guessed.
  s = s.replace(/(--[a-z][a-z0-9-]*)(\s+)("[^"]*"|'[^']*'|[^\s"';&|-][^\s"';&|]*)/gi, (m, flag: string, sp: string) => (SECRET_NAME.test(flag) ? `${flag}${sp}[secret]` : m))
  // A long unbroken run that looks like a random token.
  s = s.replace(/\b[A-Fa-f0-9]{40,}\b/g, '[hash]')
  s = s.replace(/\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])[A-Za-z0-9+/_-]{36,}={0,2}/g, '[secret]')

  return s
}

// ------------------------------------------------------------------ ports (279)

export type Port = { cmd: string; pid: number; user: string; host: string; port: number; isOpen: boolean; proto: string }

/** Parses `lsof -nP -iTCP -sTCP:LISTEN`. */
export const parseLsof = (out: string): Port[] => {
  const seen = new Set<string>()
  const ports: Port[] = []

  for (const raw of out.split('\n')) {
    const line = raw.trim()

    if (line === '' || line.startsWith('COMMAND')) continue
    const m = /^(\S+)\s+(\d+)\s+(\S+)\s+\S+\s+(IPv[46])\s+\S+\s+\S+\s+(TCP|UDP)\s+(\S+)\s+\(LISTEN\)$/.exec(line)

    if (!m) continue
    const addr = m[6] as string
    const colon = addr.lastIndexOf(':')

    if (colon < 0) continue
    const port = Number(addr.slice(colon + 1))
    const host = addr.slice(0, colon)

    if (!Number.isInteger(port) || port < 0 || port > 65_535) continue
    const key = `${m[2]}:${host}:${port}`

    if (seen.has(key)) continue
    seen.add(key)
    ports.push({
      cmd: (m[1] as string).replace(/\\x20/g, ' '),
      pid: Number(m[2]),
      user: m[3] as string,
      host,
      port,
      isOpen: host === '*' || host === '0.0.0.0' || host === '[::]',
      proto: m[5] as string,
    })
  }

  return ports.sort((a, b) => a.port - b.port || a.pid - b.pid)
}

export const portLines = (ports: readonly Port[], max = 30): Line[] => {
  if (ports.length === 0) return [note('Nothing is listening on a TCP port (or lsof showed none for your user).', 'success')]
  const open = ports.filter(p => p.isOpen).length
  const out: Line[] = [note(`${plural(ports.length, 'listening port')}: ${open} on all interfaces, ${ports.length - open} on loopback only`, 'suggestion')]
  out.push(note(`${'PORT'.padEnd(6)} ${'WHERE'.padEnd(10)} ${'PID'.padEnd(7)} ${'PROGRAM'.padEnd(22)} USER`, 'inactive'))

  for (const p of ports.slice(0, max)) {
    out.push(note(`${String(p.port).padEnd(6)} ${(p.isOpen ? 'all' : p.host === '127.0.0.1' || p.host === '[::1]' ? 'loopback' : p.host).slice(0, 10).padEnd(10)} ${String(p.pid).padEnd(7)} ${trunc(p.cmd, 22).padEnd(22)} ${p.user}`, p.isOpen ? 'warning' : undefined))
  }

  if (ports.length > max) out.push(note(`… ${ports.length - max} more`, 'inactive'))

  return out
}

// ------------------------------------------------------------------ processes (280)

export type Proc = { pid: number; name: string; path: string; cpu: number; mem: number }

/** Parses `ps -axo pid,comm,pcpu,pmem` (macOS and Linux), tolerant of spaces in the command. */
export const parsePs = (out: string): Proc[] => {
  const procs: Proc[] = []

  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/.exec(line)

    if (!m) continue
    const path = m[2] as string
    const name = path.slice(path.lastIndexOf('/') + 1) || path

    procs.push({ pid: Number(m[1]), name, path, cpu: Number((m[3] as string).replace(',', '.')), mem: Number((m[4] as string).replace(',', '.')) })
  }

  return procs
}

export const topByCpu = (procs: readonly Proc[], n = 15): Proc[] => [...procs].sort((a, b) => b.cpu - a.cpu || b.mem - a.mem || a.pid - b.pid).slice(0, n)

export const procLines = (procs: readonly Proc[], n = 15): Line[] => {
  if (procs.length === 0) return [note('ps showed no processes.', 'warning')]
  const top = topByCpu(procs, n)
  const out: Line[] = [note(`Top ${top.length} of ${procs.length} processes by CPU (ps reports an average over each process's life, not the instant)`, 'suggestion')]
  out.push(note(`${'PID'.padEnd(7)} ${'CPU%'.padStart(6)} ${'MEM%'.padStart(6)}  PROGRAM`, 'inactive'))

  for (const p of top) out.push(note(`${String(p.pid).padEnd(7)} ${p.cpu.toFixed(1).padStart(6)} ${p.mem.toFixed(1).padStart(6)}  ${trunc(p.name, 40)}`, p.cpu >= 50 ? 'warning' : undefined))

  return out
}

// ------------------------------------------------------------------ disk (du, df)

export type DuRow = { kb: number; path: string }

export const parseDu = (out: string): DuRow[] => {
  const rows: DuRow[] = []

  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)

    if (m) rows.push({ kb: Number(m[1]), path: m[2] as string })
  }

  return rows
}

export type DfRow = { fs: string; totalKb: number; usedKb: number; freeKb: number; pct: number; mount: string }

export const parseDf = (out: string): DfRow[] => {
  const rows: DfRow[] = []

  for (const line of out.split('\n')) {
    const m = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(?:\d+\s+\d+\s+\d+%\s+)?(\/.*)$/.exec(line.trim())

    if (m) rows.push({ fs: m[1] as string, totalKb: Number(m[2]), usedKb: Number(m[3]), freeKb: Number(m[4]), pct: Number(m[5]), mount: m[6] as string })
  }

  return rows
}

export const diskLines = (root: string, du: readonly DuRow[], df: readonly DfRow[]): Line[] => {
  const out: Line[] = []
  const total = du.find(r => r.path === root) ?? du[du.length - 1]
  const kids = du.filter(r => r !== total).sort((a, b) => b.kb - a.kb)

  if (total) out.push(note(`This folder: ${fmtKb(total.kb)} (depth-limited scan)`, 'suggestion'))
  const max = kids[0]?.kb ?? 0

  for (const k of kids.slice(0, 8)) out.push(note(`  ${bar(k.kb, max, 14)} ${fmtKb(k.kb).padStart(9)}  ${trunc(k.path.startsWith(`${root}/`) ? k.path.slice(root.length + 1) : k.path, 40)}`))
  const d = df[0]

  if (d) out.push(note(`Disk ${d.mount}: ${fmtKb(d.freeKb)} free of ${fmtKb(d.totalKb)} (${d.pct}% used)`, d.pct >= 90 ? 'warning' : undefined))

  return out
}

// ------------------------------------------------------------------ dependencies (268)

export type Outdated = { name: string; current: string; wanted: string; latest: string; kind: 'major' | 'minor' | 'patch' | 'unknown'; source: 'npm' | 'pip' }

const semParts = (v: string): number[] | undefined => {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim())

  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : undefined
}

export const bumpKind = (current: string, latest: string): Outdated['kind'] => {
  const a = semParts(current)
  const b = semParts(latest)

  if (!a || !b) return 'unknown'

  if (b[0]! > a[0]!) return 'major'

  if (b[0] === a[0] && b[1]! > a[1]!) return 'minor'

  return 'patch'
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, n = 60): string => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' ? String(v) : '')

/** Parses `npm outdated --json`: an object keyed by package name. Empty output means nothing is outdated. */
export const parseNpmOutdated = (out: string): Outdated[] | undefined => {
  const text = out.trim()

  if (text === '') return []
  let j: unknown

  try {
    j = JSON.parse(text)
  } catch {
    return undefined
  }

  if (!isRecord(j)) return undefined
  const rows: Outdated[] = []

  for (const [name, v] of Object.entries(j).slice(0, 2000)) {
    // npm lists a package once per location, as an array, when the tree has several copies.
    const first = Array.isArray(v) ? v[0] : v

    if (!isRecord(first)) continue
    const current = str(first.current) || 'missing'
    const latest = str(first.latest)

    rows.push({ name: name.slice(0, 80), current, wanted: str(first.wanted), latest, kind: current === 'missing' ? 'unknown' : bumpKind(current, latest), source: 'npm' })
  }

  return rows
}

/** Parses `pip list --outdated --format json`: an array of objects. Extra text before the array is ignored. */
export const parsePipOutdated = (out: string): Outdated[] | undefined => {
  const start = out.indexOf('[')

  if (start < 0) return out.trim() === '' ? [] : undefined
  let j: unknown

  try {
    j = JSON.parse(out.slice(start))
  } catch {
    return undefined
  }

  if (!Array.isArray(j)) return undefined
  const rows: Outdated[] = []

  for (const v of j.slice(0, 2000)) {
    if (!isRecord(v)) continue
    const current = str(v.version)
    const latest = str(v.latest_version)

    rows.push({ name: str(v.name, 80), current, wanted: latest, latest, kind: bumpKind(current, latest), source: 'pip' })
  }

  return rows
}

const KIND_ORDER: Record<Outdated['kind'], number> = { major: 0, minor: 1, patch: 2, unknown: 3 }

export const outdatedLines = (rows: readonly Outdated[], source: string, top = 10): Line[] => {
  if (rows.length === 0) return [note(`${source}: everything is up to date.`, 'success')]
  const count = (k: Outdated['kind']) => rows.filter(r => r.kind === k).length
  const sorted = [...rows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name))
  const out: Line[] = [note(`${source}: ${plural(rows.length, 'package')} behind (${count('major')} major, ${count('minor')} minor, ${count('patch')} patch${count('unknown') > 0 ? `, ${count('unknown')} unknown` : ''})`, count('major') > 0 ? 'warning' : 'suggestion')]

  for (const r of sorted.slice(0, top)) out.push(note(`  ${r.kind.padEnd(7)} ${trunc(r.name, 30).padEnd(30)} ${r.current} -> ${r.latest}`, r.kind === 'major' ? 'warning' : undefined))

  if (rows.length > top) out.push(note(`  … ${rows.length - top} more`, 'inactive'))

  return out
}

// ------------------------------------------------------------------ repo health (267)

export type RepoInput = {
  branches: { name: string; ts: number; isCurrent: boolean }[]
  /** Lines of `git status --porcelain=v1 -b`. */
  statusOut: string
  lastCommitTs: number
  nowSec: number
  /** Untracked files over the size limit. */
  bigUntracked: { path: string; size: number }[]
  untrackedCount: number
}

export type ScoreItem = { label: string; value: string; penalty: number; tone: 'success' | 'warning' | 'error' }
export type RepoScore = { score: number; grade: string; items: ScoreItem[]; dirty: number; stale: number; branchCount: number; ageDays: number }

export const parseBranchRows = (out: string): { name: string; ts: number; isCurrent: boolean }[] =>
  out
    .split('\n')
    .map(l => l.split('\t'))
    .filter(p => (p[0] ?? '') !== '' && Number.isFinite(Number(p[1])))
    .map(p => ({ name: (p[0] as string).trim(), ts: Number(p[1]), isCurrent: (p[2] ?? '').trim() === '*' }))

export const gradeOf = (score: number): string => (score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F')

export const statusCounts = (out: string): { dirty: number; untracked: number; ahead: number; behind: number; hasUpstream: boolean } => {
  let dirty = 0
  let untracked = 0
  let ahead = 0
  let behind = 0
  let hasUpstream = false

  for (const line of out.split('\n')) {
    if (line.startsWith('## ')) {
      hasUpstream = line.includes('...')
      ahead = Number(/ahead (\d+)/.exec(line)?.[1] ?? 0)
      behind = Number(/behind (\d+)/.exec(line)?.[1] ?? 0)
    } else if (line.startsWith('??')) {
      untracked++
    } else if (line.trim() !== '' && !line.startsWith('!!')) {
      dirty++
    }
  }

  return { dirty, untracked, ahead, behind, hasUpstream }
}

export const STALE_DAYS = 90

export const scoreRepo = (i: RepoInput): RepoScore => {
  const items: ScoreItem[] = []
  const st = statusCounts(i.statusOut)
  const push = (label: string, value: string, penalty: number) => items.push({ label, value, penalty, tone: penalty === 0 ? 'success' : penalty >= 10 ? 'error' : 'warning' })
  push('Uncommitted changes', plural(st.dirty, 'file'), st.dirty === 0 ? 0 : st.dirty <= 5 ? 5 : st.dirty <= 20 ? 10 : 20)
  const stale = i.branches.filter(b => !b.isCurrent && i.nowSec - b.ts > STALE_DAYS * 86_400).length
  push(`Stale branches (over ${STALE_DAYS} days)`, String(stale), Math.min(15, stale * 3))
  const n = i.branches.length
  push('Local branches', String(n), n > 30 ? 10 : n > 15 ? 5 : 0)
  push('Big untracked files (5 MB or more)', String(i.bigUntracked.length), Math.min(15, i.bigUntracked.length * 5))
  const ageDays = i.lastCommitTs > 0 ? Math.max(0, (i.nowSec - i.lastCommitTs) / 86_400) : 9999
  push('Last commit', i.lastCommitTs > 0 ? `${fmtAge(i.nowSec - i.lastCommitTs)} ago` : 'none', ageDays <= 7 ? 0 : ageDays <= 30 ? 5 : ageDays <= 90 ? 10 : 15)
  push('Behind upstream', st.hasUpstream ? String(st.behind) : 'no upstream', st.behind > 0 ? 5 : 0)
  const score = Math.max(0, 100 - items.reduce((a, b) => a + b.penalty, 0))

  return { score, grade: gradeOf(score), items, dirty: st.dirty, stale, branchCount: n, ageDays: Math.round(ageDays) }
}

export const repoLines = (s: RepoScore, branch: string): Line[] => {
  const out: Line[] = [note(`Repository health: ${s.score}/100 (grade ${s.grade})${branch ? `  on ${branch}` : ''}`, s.score >= 75 ? 'success' : s.score >= 60 ? 'suggestion' : 'warning')]
  out.push(note(`  ${bar(s.score, 100, 24)}`, s.score >= 75 ? 'success' : 'warning'))

  for (const it of s.items) out.push(note(`  ${it.penalty === 0 ? 'ok ' : `-${String(it.penalty).padEnd(2)}`} ${it.label.padEnd(36)} ${it.value}`, it.tone === 'success' ? undefined : it.tone))

  return out
}

// ------------------------------------------------------------------ language guess (266)

const LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', c: 'C', h: 'C', cc: 'C++', cpp: 'C++', hpp: 'C++',
  cs: 'C#', php: 'PHP', sh: 'Shell', zsh: 'Shell', bash: 'Shell', lua: 'Lua', dart: 'Dart', scala: 'Scala', ex: 'Elixir', exs: 'Elixir', hs: 'Haskell',
  css: 'CSS', scss: 'CSS', html: 'HTML', vue: 'Vue', svelte: 'Svelte', md: 'Markdown', json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML', sql: 'SQL', m: 'Objective-C', mm: 'Objective-C',
}
const MARKUP = new Set(['Markdown', 'JSON', 'YAML', 'TOML'])

export const extOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')

  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase().slice(0, 8) : ''
}

/** Languages by share of files with a known extension; data formats count only when nothing else is there. */
export const guessLanguages = (exts: Readonly<Record<string, number>>, top = 3): { lang: string; pct: number }[] => {
  const by: Record<string, number> = {}

  for (const [e, n] of Object.entries(exts)) {
    const lang = Object.hasOwn(LANG, e) ? LANG[e] : undefined

    if (lang !== undefined && Number.isFinite(n) && n > 0) by[lang] = (by[lang] ?? 0) + n
  }
  const all = Object.entries(by)
  const code = all.filter(([l]) => !MARKUP.has(l))
  const use = code.length > 0 ? code : all
  const total = use.reduce((a, [, n]) => a + n, 0)

  return use
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([lang, n]) => ({ lang, pct: Math.round((n / total) * 100) }))
}

// ------------------------------------------------------------------ licence (270)

export const guessLicense = (text: string): string => {
  const t = text.toLowerCase()

  if (/\bmit\b/.test(t)) return 'MIT'

  if (t.includes('apache license')) return 'Apache-2.0'

  if (t.includes('gnu affero')) return 'AGPL'

  if (t.includes('gnu lesser')) return 'LGPL'

  if (t.includes('gnu general public')) return 'GPL'

  if (t.includes('mozilla public')) return 'MPL'

  if (/\bbsd\b/.test(t)) return 'BSD'

  if (/\bisc\b/.test(t)) return 'ISC'

  if (t.includes('unlicense') || t.includes('public domain')) return 'Unlicense / public domain'

  return ''
}

export const licenseFromPackageJson = (text: string): string | undefined => {
  try {
    const j: unknown = JSON.parse(text)

    if (!isRecord(j)) return undefined

    if (typeof j.license === 'string') return j.license.slice(0, 80)

    if (isRecord(j.license) && typeof j.license.type === 'string') return j.license.type.slice(0, 80)

    if (Array.isArray(j.licenses)) {
      const names = j.licenses.map(l => (isRecord(l) ? str(l.type, 40) : str(l, 40))).filter(Boolean)

      return names.length > 0 ? names.join(' OR ') : undefined
    }
  } catch {
    return undefined
  }

  return undefined
}

export const licenseFromToml = (text: string): string | undefined => {
  const m = /^\s*license\s*=\s*(?:\{\s*(?:text|file)\s*=\s*)?["']([^"']{1,80})["']/m.exec(text)

  return m ? (m[1] as string) : undefined
}

export const firstLine = (text: string): string => (text.split('\n').map(l => l.trim()).find(l => l !== '') ?? '').slice(0, 160)

export const isLicenseFile = (name: string): boolean => /^(licen[cs]e|copying|unlicense)(\.[a-z]{1,4})?$/i.test(name)

// ------------------------------------------------------------------ security hygiene (269)

export type Finding = { sev: 'high' | 'medium' | 'info'; text: string }

export const SECRET_FILE = /^(\.env(\..+)?|id_(rsa|dsa|ecdsa|ed25519)|.+\.(pem|key|p12|pfx|jks|keystore)|\.npmrc|\.pypirc|\.netrc|credentials(\..+)?|secrets?\.(json|ya?ml|toml)|service-account.*\.json)$/i
/** `.env.example` and friends are meant to be committed. */
export const SAMPLE_FILE = /\.(example|sample|template|dist)$/i

export const isSecretLikeName = (name: string): boolean => SECRET_FILE.test(name) && !SAMPLE_FILE.test(name)

export type HygieneInput = {
  names: readonly string[]
  isRepo: boolean
  /** Tracked files that match the secret-like patterns (from `git ls-files`). */
  tracked: readonly string[]
  /** Names that `git check-ignore` says are NOT ignored. */
  notIgnored: readonly string[]
}

export const hygiene = (i: HygieneInput): Finding[] => {
  const out: Finding[] = []

  for (const t of i.tracked.slice(0, 20)) if (!SAMPLE_FILE.test(t)) out.push({ sev: 'high', text: `${t} is tracked by git: a secret-like file name is in the repository` })
  const present = i.names.filter(isSecretLikeName)

  for (const n of present) {
    if (i.tracked.includes(n)) continue

    if (i.notIgnored.includes(n)) out.push({ sev: 'medium', text: `${n} is here and not ignored by git: it could be committed by accident` })
    else out.push({ sev: 'info', text: `${n} is here${i.isRepo ? ' and ignored by git' : ''} (contents not read)` })
  }

  if (i.isRepo && !i.names.includes('.gitignore')) out.push({ sev: 'medium', text: 'No .gitignore at the top level' })

  if (!i.isRepo) out.push({ sev: 'info', text: 'Not a git repository, so tracking and ignore status were not checked' })

  return out
}

export const hygieneLines = (f: readonly Finding[]): Line[] => {
  const bad = f.filter(x => x.sev !== 'info').length
  const out: Line[] = [note(bad === 0 ? 'Security hygiene: nothing risky found at the top level (names only, no file contents read)' : `Security hygiene: ${plural(bad, 'thing')} to look at (names only, no file contents read)`, bad === 0 ? 'success' : 'warning')]

  for (const x of f) out.push(note(`  ${x.sev === 'high' ? 'HIGH  ' : x.sev === 'medium' ? 'MEDIUM' : 'info  '} ${x.text}`, x.sev === 'high' ? 'error' : x.sev === 'medium' ? 'warning' : 'inactive'))

  return out
}

// ------------------------------------------------------------------ TODO board (271)

export type Todo = { file: string; line: number; kind: string; text: string }

const TODO_RE = /(?:\/\/|#|\/\*|\*|--|<!--|;|%)\s*@?(TODO|FIXME|HACK)\b[:\s(-]?\s*(.*)$/

export const scanTodos = (file: string, text: string, max = 20): Todo[] => {
  const out: Todo[] = []

  if (text.includes('\0')) return out
  const lines = text.split('\n')

  for (let i = 0; i < lines.length && out.length < max; i++) {
    const line = lines[i] as string

    if (line.length > 600) continue
    const m = TODO_RE.exec(line)

    if (m) out.push({ file, line: i + 1, kind: m[1] as string, text: maskSecrets(trunc((m[2] ?? '').replace(/\*\/\s*$|-->\s*$/, '').trim(), 100)) })
  }

  return out
}

export const todoLines = (todos: readonly Todo[], scanned: number, root: string): Line[] => {
  if (scanned === 0) return [note('No files seen edited yet. Switch add-kit.todos on, then edit something: this board reads only files Claude edited in this session.', 'inactive')]

  if (todos.length === 0) return [note(`No TODO, FIXME or HACK comments in the ${plural(scanned, 'file')} edited this session.`, 'success')]
  const out: Line[] = [note(`${plural(todos.length, 'note')} in ${plural(scanned, 'edited file')}`, 'suggestion')]
  let last = ''

  for (const t of todos) {
    const rel = t.file.startsWith(`${root}/`) ? t.file.slice(root.length + 1) : t.file

    if (rel !== last) {
      out.push(note(trunc(rel, 70), 'inactive'))
      last = rel
    }
    out.push(note(`  ${String(t.line).padStart(5)}  ${t.kind.padEnd(5)} ${t.text}`, t.kind === 'FIXME' ? 'warning' : undefined))
  }

  return out
}

// ------------------------------------------------------------------ log viewer (277)

const SECRET_PATH = [
  /(^|\/)\.env(\.|$)/i, /(^|\/)\.(ssh|gnupg|aws|kube|docker|netrc|npmrc|pypirc)(\/|$)/i, /\.(pem|key|p12|pfx|jks|keystore|kdbx|gpg|asc)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/i, /(^|\/)(credentials?|secrets?|tokens?)(\.|$|\/)/i, /(secret|password|passwd|apikey|api[_-]key|private[_-]key)/i,
  /(^|\/)(shadow|master\.passwd|sudoers)$/i, /\.(bash|zsh|sh|python|node|psql|mysql)_history$/i, /(^|\/)Keychains?(\/|$)/i, /(^|\/)\.git\/(config|credentials)/i,
  /(^|\/)(Login Data|Cookies|key[34]\.db|logins\.json)$/i,
]

export const isSecretLikePath = (p: string): boolean => SECRET_PATH.some(re => re.test(p))

export const LOG_BYTES = 16 * 1024

/** The lines of a tail read: a read that started mid-file drops its first (partial) line. */
export const tailLines = (text: string, isPartial: boolean): string[] => {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))

  if (isPartial) lines.shift()

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  return lines
}

export const filterLog = (lines: readonly string[], q: string): string[] => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)

  if (words.length === 0) return [...lines]

  return lines.filter(l => {
    const low = l.toLowerCase()

    return words.every(w => (w.startsWith('-') && w.length > 1 ? !low.includes(w.slice(1)) : low.includes(w)))
  })
}

export const logLines = (path: string, all: readonly string[], q: string, size: number, shown = 120): Line[] => {
  const hit = filterLog(all, q)
  const out: Line[] = [note(`${trunc(path, 60)}: last ${fmtKb(Math.min(size, LOG_BYTES) / 1024)} of ${fmtKb(size / 1024)}, ${plural(all.length, 'line')}${q.trim() !== '' ? `, ${hit.length} match "${trunc(q.trim(), 30)}"` : ''}. Credentials are masked.`, 'suggestion')]

  if (hit.length === 0) return [...out, note('No lines match.', 'inactive')]

  for (const l of hit.slice(-shown)) out.push(note(trunc(maskSecrets(l), 200)))

  if (hit.length > shown) out.push(note(`(older ${hit.length - shown} matching lines not shown)`, 'inactive'))

  return out
}

// ------------------------------------------------------------------ meeting mode restore (262)

/** The `/cfg` arguments that put every feature switch back to exactly what a snapshot held. */
export const restorePlan = (snapshot: Readonly<Record<string, boolean>>, max = 40): { args: string[]; isComplete: boolean } => {
  const keys = Object.keys(snapshot).filter(k => /^[a-z0-9][a-z0-9-]{0,40}\.[a-z0-9][a-z0-9-]{0,40}$/.test(k) && typeof snapshot[k] === 'boolean')
  const args = ['feature reset', ...keys.slice(0, max).map(k => `feature ${k} ${snapshot[k] === true ? 'on' : 'off'}`)]

  return { args, isComplete: keys.length <= max }
}

export const cleanOverrides = (v: unknown, max = 600): Record<string, boolean> => {
  const out: Record<string, boolean> = {}

  if (!isRecord(v)) return out

  for (const [k, val] of Object.entries(v).slice(0, max)) if (typeof val === 'boolean' && /^[a-z0-9][a-z0-9-]{0,40}\.[a-z0-9][a-z0-9-]{0,40}$/.test(k)) out[k] = val

  return out
}
