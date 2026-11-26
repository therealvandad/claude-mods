// Pure parsers and text builders for git-kit. Nothing here touches the engine.

export type Tone = 'success' | 'warning' | 'error' | 'subtle' | 'inactive' | 'suggestion' | 'claude'
export type Line = { t: string; c?: Tone }

export const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)
export const lines = (s: string) => s.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l !== '')
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100))

export const fmtBytes = (n: number) =>
  n >= 1024 * 1024 * 1024 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 * 1024 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`

export const fmtAge = (sec: number, nowSec: number) => {
  const d = Math.max(0, nowSec - sec)

  if (d < 90) return 'just now'

  if (d < 5400) return `${Math.round(d / 60)} min ago`

  if (d < 129_600) return `${Math.round(d / 3600)} h ago`

  if (d < 86_400 * 60) return `${Math.round(d / 86_400)} days ago`

  return `${Math.round(d / (86_400 * 30))} months ago`
}

// ---------------------------------------------------------------- status

export type StatusKind = 'staged' | 'unstaged' | 'both' | 'untracked' | 'ignored' | 'conflict'
export type StatusEntry = { x: string; y: string; path: string; from?: string; kind: StatusKind }
export type StatusInfo = {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  isGone: boolean
  isDetached: boolean
  hasNoCommits: boolean
  entries: StatusEntry[]
}

const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

// A path git quoted in C style ("a\tb", "caf\303\251") back to text.
export const unquoteC = (raw: string): string => {
  if (!(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))) return raw
  const chars = Array.from(raw.slice(1, -1))
  const bytes: number[] = []
  const esc: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string

    if (ch !== '\\') {
      const cp = ch.codePointAt(0) ?? 63

      if (cp < 128) bytes.push(cp)
      else bytes.push(...Array.from(encodeURIComponent(ch).matchAll(/%([0-9A-F]{2})/g), m => parseInt(m[1] as string, 16)))
      continue
    }
    const next = chars[i + 1] ?? ''

    if (/[0-7]/.test(next)) {
      const oct = chars.slice(i + 1, i + 4).join('').match(/^[0-7]{1,3}/)?.[0] ?? '0'
      bytes.push(parseInt(oct, 8))
      i += oct.length
    } else {
      bytes.push(esc[next] ?? next.charCodeAt(0))
      i += 1
    }
  }

  try {
    return decodeURIComponent(bytes.map(b => `%${b.toString(16).padStart(2, '0')}`).join(''))
  } catch {
    return String.fromCharCode(...bytes)
  }
}

export const parseStatus = (out: string): StatusInfo => {
  const info: StatusInfo = { branch: '', ahead: 0, behind: 0, isGone: false, isDetached: false, hasNoCommits: false, entries: [] }

  for (const line of out.split('\n')) {
    if (line.startsWith('## ')) {
      let rest = line.slice(3)

      if (rest.startsWith('No commits yet on ')) {
        info.hasNoCommits = true
        info.branch = rest.slice('No commits yet on '.length)
        continue
      }

      if (rest.startsWith('Initial commit on ')) {
        info.hasNoCommits = true
        info.branch = rest.slice('Initial commit on '.length)
        continue
      }
      const track = rest.match(/ \[([^\]]+)\]$/)

      if (track) {
        rest = rest.slice(0, track.index)
        const t = track[1] as string
        info.isGone = /\bgone\b/.test(t)
        info.ahead = Number(t.match(/ahead (\d+)/)?.[1] ?? 0)
        info.behind = Number(t.match(/behind (\d+)/)?.[1] ?? 0)
      }

      if (rest.startsWith('HEAD (no branch)')) {
        info.isDetached = true
        info.branch = 'HEAD'
        continue
      }
      const dots = rest.indexOf('...')

      if (dots === -1) info.branch = rest
      else {
        info.branch = rest.slice(0, dots)
        info.upstream = rest.slice(dots + 3)
      }
      continue
    }

    if (line.length < 4 || line[2] !== ' ') continue
    const x = line[0] as string
    const y = line[1] as string
    let path = line.slice(3)
    let from: string | undefined

    if ((x === 'R' || x === 'C' || y === 'R' || y === 'C') && path.includes(' -> ')) {
      const at = path.indexOf(' -> ')
      from = unquoteC(path.slice(0, at))
      path = path.slice(at + 4)
    }
    path = unquoteC(path)
    const pair = `${x}${y}`
    const kind: StatusKind =
      pair === '??' ? 'untracked' : pair === '!!' ? 'ignored' : UNMERGED.has(pair) ? 'conflict' : x !== ' ' && y !== ' ' ? 'both' : x !== ' ' ? 'staged' : 'unstaged'
    info.entries.push(from === undefined ? { x, y, path, kind } : { x, y, path, from, kind })
  }

  return info
}

const WORD: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', U: 'unmerged', '?': 'untracked' }

// Per-file map: what is staged, what is not, what is untracked, what conflicts.
export const statusLines = (info: StatusInfo): Line[] => {
  const out: Line[] = []
  const by = (k: StatusKind) => info.entries.filter(e => e.kind === k)
  const head = info.hasNoCommits ? `${info.branch} (no commits yet)` : info.isDetached ? 'detached HEAD' : info.branch
  const track =
    info.upstream === undefined
      ? 'no upstream'
      : `${info.upstream}${info.ahead > 0 ? `, ahead ${info.ahead}` : ''}${info.behind > 0 ? `, behind ${info.behind}` : ''}${info.isGone ? ', upstream gone' : ''}${info.ahead + info.behind === 0 && !info.isGone ? ', in sync' : ''}`
  out.push({ t: `On ${head}  (${track})`, c: 'suggestion' })

  if (info.entries.length === 0) {
    out.push({ t: 'Working tree clean.', c: 'success' })

    return out
  }
  const section = (title: string, list: StatusEntry[], c: Tone, show: (e: StatusEntry) => string) => {
    if (list.length === 0) return
    out.push({ t: '', c: 'subtle' }, { t: `${title} (${list.length})`, c })

    for (const e of list.slice(0, 40)) out.push({ t: `  ${show(e)}` })

    if (list.length > 40) out.push({ t: `  … ${list.length - 40} more`, c: 'inactive' })
  }
  const verb = (ch: string) => WORD[ch] ?? ch
  section('Conflicts', by('conflict'), 'error', e => `${e.x}${e.y}  ${e.path}`)
  section('Staged', [...by('staged'), ...by('both')], 'success', e => `${verb(e.x).padEnd(9)} ${e.from ? `${e.from} -> ` : ''}${e.path}${e.kind === 'both' ? '  (also changed since)' : ''}`)
  section('Not staged', [...by('unstaged'), ...by('both')], 'warning', e => `${verb(e.y).padEnd(9)} ${e.path}`)
  section('Untracked', by('untracked'), 'subtle', e => e.path)

  return out
}

export const toText = (ls: readonly Line[]) => ls.map(l => l.t).join('\n')

// ---------------------------------------------------------------- commit style

const CONV_TYPES = new Set(['feat', 'feature', 'fix', 'bugfix', 'hotfix', 'docs', 'doc', 'style', 'refactor', 'perf', 'test', 'tests', 'build', 'ci', 'chore', 'revert', 'deps', 'wip', 'release', 'improvement', 'cleanup'])

export type Conventional = { type: string; scope?: string; isBreaking: boolean; desc: string }

export const parseConventional = (subject: string): Conventional | null => {
  const m = subject.match(/^([A-Za-z]+)(?:\(([^)]*)\))?(!)?: (.+)$/)

  if (!m) return null
  const type = (m[1] as string).toLowerCase()

  if (!CONV_TYPES.has(type)) return null

  return { type, ...(m[2] ? { scope: m[2] } : {}), isBreaking: m[3] === '!', desc: m[4] as string }
}

export type PrefixKind = 'conventional' | 'bracket' | 'ticket' | 'issue' | 'emoji' | 'path' | 'none'

const prefixOf = (subject: string): { kind: PrefixKind; rest: string } => {
  const conv = parseConventional(subject)

  if (conv) return { kind: 'conventional', rest: conv.desc }
  const br = subject.match(/^\[[^\]]+\]:?\s*(.*)$/)

  if (br) return { kind: 'bracket', rest: br[1] as string }
  const tk = subject.match(/^[A-Z][A-Z0-9]+-\d+[:\s-]+\s*(.*)$/)

  if (tk) return { kind: 'ticket', rest: tk[1] as string }
  const is = subject.match(/^#\d+[:\s-]+\s*(.*)$/)

  if (is) return { kind: 'issue', rest: is[1] as string }
  const em = subject.match(/^(?:\p{Extended_Pictographic}️?|:[a-z0-9_+-]+:)\s*(.*)$/u)

  if (em) return { kind: 'emoji', rest: em[1] as string }
  const pa = subject.match(/^[\w./-]+: (.+)$/)

  if (pa) return { kind: 'path', rest: pa[1] as string }

  return { kind: 'none', rest: subject }
}

const NOT_PAST = new Set(['feed', 'need', 'speed', 'embed', 'proceed', 'succeed', 'exceed', 'seed', 'bleed', 'shed', 'bed', 'red', 'reed', 'breed', 'indeed', 'hundred'])
const NOT_ING = new Set(['bring', 'string', 'spring', 'ring', 'thing', 'sing', 'wing', 'king', 'swing', 'cling'])
const IRREGULAR_PAST = new Set(['made', 'got', 'ran', 'wrote', 'built', 'began', 'took', 'gave', 'set-up', 'found', 'kept', 'left', 'put-in'])

export type Tense = 'imperative' | 'past' | 'gerund'

export const tenseOf = (text: string): Tense => {
  const w = (text.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z-]/g, '')

  if (w.length > 4 && w.endsWith('ing') && !NOT_ING.has(w)) return 'gerund'

  if ((w.length > 3 && w.endsWith('ed') && !NOT_PAST.has(w)) || IRREGULAR_PAST.has(w)) return 'past'

  return 'imperative'
}

export type StyleInfo = {
  count: number
  prefixKind: PrefixKind
  prefixShare: number
  types: [string, number][]
  scopeShare: number
  len: { avg: number; median: number; p90: number; max: number }
  tense: Tense
  tenseShare: number
  lowerShare: number
  periodShare: number
  examples: string[]
}

export const analyzeStyle = (subjectsIn: readonly string[]): StyleInfo | null => {
  const subjects = subjectsIn.map(s => s.trim()).filter(s => s !== '' && !/^Merge (branch|pull request|remote-tracking)/.test(s))

  if (subjects.length === 0) return null
  const parts = subjects.map(s => ({ s, ...prefixOf(s) }))
  const kinds = new Map<PrefixKind, number>()

  for (const p of parts) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1)
  const [kind, kindN] = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0] as [PrefixKind, number]
  const types = new Map<string, number>()
  let scoped = 0

  for (const p of parts) {
    const c = parseConventional(p.s)

    if (c) {
      types.set(c.type, (types.get(c.type) ?? 0) + 1)

      if (c.scope) scoped++
    }
  }
  const lens = subjects.map(s => s.length).sort((a, b) => a - b)
  const at = (q: number) => lens[Math.min(lens.length - 1, Math.floor(q * lens.length))] as number
  const tenses = new Map<Tense, number>()

  for (const p of parts) {
    const t = tenseOf(p.rest)
    tenses.set(t, (tenses.get(t) ?? 0) + 1)
  }
  const [tense, tenseN] = [...tenses.entries()].sort((a, b) => b[1] - a[1])[0] as [Tense, number]
  const letters = parts.filter(p => /^[A-Za-z]/.test(p.rest))
  const lower = letters.filter(p => /^[a-z]/.test(p.rest)).length

  return {
    count: subjects.length,
    prefixKind: kind,
    prefixShare: pct(kindN, subjects.length),
    types: [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    scopeShare: pct(scoped, Math.max(1, [...types.values()].reduce((a, b) => a + b, 0))),
    len: { avg: Math.round(lens.reduce((a, b) => a + b, 0) / lens.length), median: at(0.5), p90: at(0.9), max: lens[lens.length - 1] as number },
    tense,
    tenseShare: pct(tenseN, subjects.length),
    lowerShare: pct(lower, Math.max(1, letters.length)),
    periodShare: pct(subjects.filter(s => s.endsWith('.')).length, subjects.length),
    examples: subjects.slice(0, 3),
  }
}

const PREFIX_WORDS: Record<PrefixKind, string> = {
  conventional: 'Conventional Commits (type(scope): description)',
  bracket: 'a [bracketed] tag at the start',
  ticket: 'a ticket key at the start (ABC-123)',
  issue: 'an issue number at the start (#123)',
  emoji: 'an emoji or :shortcode: at the start',
  path: 'an area prefix ("area: description")',
  none: 'no prefix, just a plain sentence',
}

export const styleLines = (s: StyleInfo | null): string[] => {
  if (s === null) return ['No commits to learn from yet.']
  const out = [`Commit style, learned from ${plural(s.count, 'subject')}:`]
  out.push(`- Prefix: ${PREFIX_WORDS[s.prefixKind]} (${s.prefixShare}% of subjects)`)

  if (s.types.length > 0) out.push(`- Types used: ${s.types.map(([t, n]) => `${t} ${n}`).join(', ')}; scope on ${s.scopeShare}% of them`)
  out.push(`- Length: median ${s.len.median}, 90th percentile ${s.len.p90}, longest ${s.len.max} characters`)
  out.push(`- Tense: ${s.tense} (${s.tenseShare}%)${s.tense === 'imperative' ? ', e.g. "add", "fix"' : s.tense === 'past' ? ', e.g. "added", "fixed"' : ', e.g. "adding", "fixing"'}`)
  out.push(`- First letter after the prefix: ${s.lowerShare >= 50 ? 'lowercase' : 'capitalised'} (${s.lowerShare >= 50 ? s.lowerShare : 100 - s.lowerShare}%)`)
  out.push(`- Trailing period: ${s.periodShare >= 50 ? 'yes' : 'no'} (${s.periodShare >= 50 ? s.periodShare : 100 - s.periodShare}%)`)
  out.push(`- Recent: ${s.examples.map(e => `"${trunc(e, 60)}"`).join('; ')}`)

  return out
}

export const msgPrompt = (s: StyleInfo, hasStaged: boolean): string =>
  [
    `Write a commit message for ${hasStaged ? 'my staged changes' : 'my current changes'} (read the diff first). Follow this repository's commit style, learned from its last ${s.count} commits:`,
    `- prefix: ${PREFIX_WORDS[s.prefixKind]}${s.types.length > 0 ? `; usual types: ${s.types.map(t => t[0]).join(', ')}` : ''}${s.scopeShare >= 40 ? '; include a scope when one fits' : ''}`,
    `- subject: ${s.tense} mood, ${s.lowerShare >= 50 ? 'starting lowercase' : 'starting with a capital'}${s.periodShare >= 50 ? ', ending with a period' : ', no trailing period'}, at most ${Math.max(50, Math.min(100, s.len.p90))} characters`,
    `- examples from the log: ${s.examples.map(e => `"${trunc(e, 70)}"`).join(' | ')}`,
    'Give me the message only; do not commit.',
  ].join('\n')

// ---------------------------------------------------------------- branch names

const TYPE_FORMS: Record<string, string[]> = {
  feature: ['feature', 'feat', 'features'],
  fix: ['fix', 'bugfix', 'hotfix', 'bug'],
  docs: ['docs', 'doc'],
  refactor: ['refactor', 'refactoring'],
  test: ['test', 'tests'],
  chore: ['chore', 'chores', 'deps', 'build', 'ci'],
}
const TYPE_WORDS = new Set(Object.values(TYPE_FORMS).flat().concat(['release', 'perf', 'wip', 'spike', 'experiment', 'hotfix']))

export type BranchStyle = {
  count: number
  prefixes: [string, number][]
  prefixShare: number
  sep: '-' | '_' | 'mixed'
  lowerShare: number
  ticketShare: number
  sample: string[]
}

export const analyzeBranches = (names: readonly string[]): BranchStyle | null => {
  const list = names
    .map(n => n.replace(/^(remotes\/)?origin\//, '').trim())
    .filter(n => n !== '' && !/^(main|master|develop|dev|trunk|HEAD)$/.test(n) && !n.startsWith('HEAD '))
  const uniq = [...new Set(list)]

  if (uniq.length === 0) return null
  const pre = new Map<string, number>()
  let prefixed = 0

  for (const n of uniq) {
    const i = n.indexOf('/')

    if (i > 0) {
      prefixed++
      const p = n.slice(0, i)
      pre.set(p, (pre.get(p) ?? 0) + 1)
    }
  }
  const tail = uniq.map(n => n.slice(n.indexOf('/') + 1))
  const dash = tail.filter(n => n.includes('-')).length
  const under = tail.filter(n => n.includes('_')).length
  const sep = under > dash * 1.5 ? '_' : dash > under * 1.5 || under === 0 ? '-' : 'mixed'

  return {
    count: uniq.length,
    prefixes: [...pre.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    prefixShare: pct(prefixed, uniq.length),
    sep,
    lowerShare: pct(uniq.filter(n => n === n.toLowerCase()).length, uniq.length),
    ticketShare: pct(uniq.filter(n => /[A-Za-z]{2,}-\d+/.test(n)).length, uniq.length),
    sample: uniq.slice(0, 4),
  }
}

const STOP = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'and', 'or', 'with', 'by', 'at', 'is', 'it', 'be', 'we', 'i', 'my', 'our', 'that', 'this', 'when', 'please', 'should', 'make', 'sure', 'so', 'as', 'from', 'into'])

export const slugify = (text: string, maxWords = 5, maxLen = 40): string => {
  const words = text
    .toLowerCase()
    .replace(/\b[a-z]{2,}-\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w !== '' && !STOP.has(w))
    .slice(0, maxWords)
  let slug = words.join('-')

  while (slug.length > maxLen && words.length > 1) {
    words.pop()
    slug = words.join('-')
  }

  return slug.slice(0, maxLen).replace(/-+$/, '')
}

export const taskType = (task: string): keyof typeof TYPE_FORMS => {
  const t = task.toLowerCase()

  if (/\b(fix|bug|crash|broken|regress|error|fails?|issue)\b/.test(t)) return 'fix'

  if (/\b(docs?|readme|documentation|typo)\b/.test(t)) return 'docs'

  if (/\b(refactor|cleanup|clean up|rename|restructure|simplify)\b/.test(t)) return 'refactor'

  if (/\b(tests?|coverage|spec)\b/.test(t)) return 'test'

  if (/\b(chore|bump|upgrade|dependenc\w*|deps|ci|pipeline|lint)\b/.test(t)) return 'chore'

  return 'feature'
}

export const suggestBranches = (task: string, style: BranchStyle | null): string[] => {
  const slug = slugify(task)

  if (slug === '') return []
  const ticket = task.match(/\b([A-Za-z]{2,}-\d+)\b/)?.[1]
  const ticketPart = ticket !== undefined && (style === null || style.ticketShare >= 20) ? ticket.toUpperCase() : undefined
  const type = taskType(task)
  const forms = TYPE_FORMS[type] ?? ['feature']
  const known = new Map(style?.prefixes ?? [])
  const usesTypes = style !== null && style.prefixShare >= 40 && [...known.keys()].some(k => TYPE_WORDS.has(k))
  const usesAnyPrefix = style !== null && style.prefixShare >= 40
  const ranked = forms.filter(f => known.has(f)).sort((a, b) => (known.get(b) ?? 0) - (known.get(a) ?? 0))
  const chosen = ranked[0] ?? (usesTypes ? forms[0] : undefined)
  const prefix = usesTypes || style === null ? (chosen ?? forms[0]) : usesAnyPrefix ? (style.prefixes[0]?.[0] ?? undefined) : undefined
  const sepFix = (s: string) => (style?.sep === '_' ? s.replace(/-/g, '_') : s)
  const short = slugify(task, 3, 28)
  const mkName = (p: string | undefined, body: string, t?: string) => {
    const core = sepFix(t === undefined ? body : `${t}-${body}`)

    return p === undefined ? core : `${p}/${core}`
  }
  const out = [mkName(prefix, slug, ticketPart), mkName(prefix, short, ticketPart)]

  if (prefix !== undefined && ranked[1] !== undefined) out.push(mkName(ranked[1], slug, ticketPart))
  else out.push(mkName(prefix, slugify(task, 2, 20), ticketPart))

  return [...new Set(out)].slice(0, 3)
}

export const branchStyleLines = (s: BranchStyle | null): string[] => {
  if (s === null) return ['No other branches to learn naming from yet.']
  const out = [`Branch naming, from ${plural(s.count, 'branch', 'branches')}:`]
  out.push(
    s.prefixShare >= 40 ? `- Prefixes: ${s.prefixes.map(([p, n]) => `${p}/ ${n}`).join(', ')} (${s.prefixShare}% have one)` : `- Mostly no prefix (${s.prefixShare}% have one)`,
  )
  out.push(`- Words joined with ${s.sep === 'mixed' ? 'a mix of - and _' : s.sep === '-' ? 'hyphens' : 'underscores'}; ${s.lowerShare >= 80 ? 'lowercase' : 'mixed case'}`)

  if (s.ticketShare >= 20) out.push(`- ${s.ticketShare}% carry a ticket key (ABC-123)`)
  out.push(`- Examples: ${s.sample.join(', ')}`)

  return out
}

// ---------------------------------------------------------------- numstat, PR drafting

export type NumstatFile = { path: string; add: number; del: number; isBinary: boolean }

export const parseNumstat = (out: string): NumstatFile[] =>
  lines(out).flatMap(l => {
    const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)

    if (!m) return []
    const bin = m[1] === '-'

    return [{ path: unquoteC((m[3] as string).replace(/^.*=> ?/, '').replace(/[{}]/g, '').trim() || (m[3] as string)), add: bin ? 0 : Number(m[1]), del: bin ? 0 : Number(m[2]), isBinary: bin }]
  })

export const totalsOf = (files: readonly NumstatFile[]) => ({ files: files.length, add: files.reduce((a, f) => a + f.add, 0), del: files.reduce((a, f) => a + f.del, 0) })

export const statLines = (files: readonly NumstatFile[], cap = 30): string[] => {
  const t = totalsOf(files)
  const shown = [...files].sort((a, b) => b.add + b.del - (a.add + a.del)).slice(0, cap)
  const w = Math.min(60, Math.max(8, ...shown.map(f => f.path.length)))
  const out = shown.map(f => `${trunc(f.path, w).padEnd(w)} | ${f.isBinary ? 'binary' : `+${f.add} -${f.del}`}`)

  if (files.length > cap) out.push(`… and ${files.length - cap} more files`)
  out.push(`${plural(t.files, 'file')} changed, ${t.add} insertions(+), ${t.del} deletions(-)`)

  return out
}

export const pickBase = (branches: readonly string[], current: string, originHead?: string): string | undefined => {
  const set = new Set(branches.map(b => b.replace(/^remotes\//, '')))
  const head = originHead?.trim().replace(/^origin\//, '')
  const order = [...(head && head !== 'HEAD' ? [head] : []), 'main', 'master', 'develop', 'trunk']

  for (const name of order) {
    if (name === current) continue

    if (set.has(name)) return name

    if (set.has(`origin/${name}`)) return `origin/${name}`
  }

  return undefined
}

export const prPrompt = (a: { branch: string; base: string; commits: string[]; files: NumstatFile[] }): string => {
  const commits = a.commits.slice(0, 50)

  return [
    `Write a pull request description for branch "${a.branch}" into "${a.base}". Use the commits and diff summary below; read the code for anything unclear.`,
    '',
    `Commits (${a.commits.length}):`,
    ...commits.map(c => `- ${trunc(c, 100)}`),
    ...(a.commits.length > commits.length ? [`- … ${a.commits.length - commits.length} more`] : []),
    '',
    'Diff summary:',
    ...statLines(a.files, 25).map(l => `  ${l}`),
    '',
    'Format: a short title line, then Summary (what and why), Changes (bullets), Testing (what I should run or check), and Risks or follow-ups. Do not open the PR; just give me the text.',
  ].join('\n')
}

// ---------------------------------------------------------------- changelog and tag

export type LogEntry = { hash: string; subject: string }

export const parseLogLines = (out: string): LogEntry[] =>
  lines(out).flatMap(l => {
    const i = l.indexOf('\t')

    return i > 0 ? [{ hash: l.slice(0, i), subject: l.slice(i + 1) }] : []
  })

const SECTION_ORDER: [string, string][] = [
  ['breaking', 'Breaking changes'],
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['test', 'Tests'],
  ['build', 'Build and CI'],
  ['chore', 'Chores'],
  ['other', 'Other'],
]
const SECTION_OF: Record<string, string> = { feat: 'feat', feature: 'feat', fix: 'fix', bugfix: 'fix', hotfix: 'fix', perf: 'perf', improvement: 'perf', refactor: 'refactor', cleanup: 'refactor', docs: 'docs', doc: 'docs', test: 'test', tests: 'test', build: 'build', ci: 'build', deps: 'build', chore: 'chore', style: 'chore', release: 'chore', revert: 'other', wip: 'other' }

export const changelogLines = (entries: readonly LogEntry[], since: string | undefined): string[] => {
  if (entries.length === 0) return [`No commits since ${since ?? 'the start'}.`]
  const groups = new Map<string, string[]>()
  const add = (k: string, text: string) => groups.set(k, [...(groups.get(k) ?? []), text])

  for (const e of entries) {
    if (/^Merge (branch|pull request|remote-tracking)/.test(e.subject)) continue
    const c = parseConventional(e.subject)
    const line = `${c ? `${c.scope ? `**${c.scope}**: ` : ''}${c.desc}` : e.subject} (${e.hash.slice(0, 7)})`

    if (c?.isBreaking) add('breaking', line)
    add(c ? (SECTION_OF[c.type] ?? 'other') : 'other', line)
  }
  const out = [`Changelog since ${since ?? 'the first commit'} (${plural(entries.length, 'commit')}):`]

  for (const [key, title] of SECTION_ORDER) {
    const g = groups.get(key)

    if (g && g.length > 0) out.push('', `${title}`, ...g.map(l => `- ${l}`))
  }

  return out
}

// Entries collected over time, newest last, one per commit hash, bounded.
export const mergeEntries = (old: readonly LogEntry[], fresh: readonly LogEntry[], cap = 300): LogEntry[] => {
  const seen = new Set(old.map(e => e.hash))
  const added = fresh.filter(e => !seen.has(e.hash))

  return [...old, ...added.reverse()].slice(-cap)
}

export type Semver = { prefix: string; major: number; minor: number; patch: number; pre?: string }

export const parseSemver = (tag: string): Semver | null => {
  const m = tag.trim().match(/^(v?)(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/)

  return m ? { prefix: m[1] as string, major: Number(m[2]), minor: Number(m[3]), patch: Number(m[4]), ...(m[5] ? { pre: m[5] } : {}) } : null
}

export type Bump = 'major' | 'minor' | 'patch' | 'none'

export const suggestBump = (subjects: readonly string[]): { bump: Bump; reasons: string[]; counts: Record<string, number> } => {
  const counts: Record<string, number> = { breaking: 0, feat: 0, fix: 0, other: 0 }
  const reasons: string[] = []

  for (const s of subjects) {
    if (/^Merge /.test(s)) continue
    const c = parseConventional(s)

    if (c?.isBreaking || /BREAKING CHANGE/.test(s)) {
      counts.breaking = (counts.breaking ?? 0) + 1
      reasons.push(`breaking: ${trunc(s, 70)}`)
    } else if (c && (c.type === 'feat' || c.type === 'feature')) {
      counts.feat = (counts.feat ?? 0) + 1
    } else if (c && ['fix', 'bugfix', 'hotfix', 'perf'].includes(c.type)) {
      counts.fix = (counts.fix ?? 0) + 1
    } else {
      counts.other = (counts.other ?? 0) + 1
    }
  }
  const total = (counts.breaking ?? 0) + (counts.feat ?? 0) + (counts.fix ?? 0) + (counts.other ?? 0)
  const bump: Bump = total === 0 ? 'none' : (counts.breaking ?? 0) > 0 ? 'major' : (counts.feat ?? 0) > 0 ? 'minor' : 'patch'

  return { bump, reasons: reasons.slice(0, 3), counts }
}

export const nextVersion = (tag: string | undefined, bump: Bump): { version: string; note?: string } | null => {
  if (bump === 'none') return null

  if (tag === undefined) return { version: 'v0.1.0', note: 'no earlier tag: starting at v0.1.0' }
  const v = parseSemver(tag)

  if (v === null) return null
  let level: Bump = bump
  let note: string | undefined

  if (v.major === 0 && bump === 'major') {
    level = 'minor'
    note = 'major is 0, so a breaking change bumps the minor number'
  }
  const [maj, min, pat] = level === 'major' ? [v.major + 1, 0, 0] : level === 'minor' ? [v.major, v.minor + 1, 0] : [v.major, v.minor, v.pre ? v.patch : v.patch + 1]

  return { version: `${v.prefix}${maj}.${min}.${pat}`, ...(note ? { note } : {}) }
}

// ---------------------------------------------------------------- gitignore suggestions

type IgnoreRule = { re: RegExp; pattern: string; why: string; risk: 'secret' | 'artifact' | 'noise' }

const IGNORE_RULES: IgnoreRule[] = [
  { re: /(^|\/)\.env(\.(?!example|sample|template)[^/]+)?$/, pattern: '.env*', why: 'environment file, often holds secrets', risk: 'secret' },
  { re: /\.(pem|key|p12|pfx|jks|keystore)$/i, pattern: '*.pem / *.key', why: 'private key or keystore', risk: 'secret' },
  { re: /(^|\/)(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$/, pattern: 'id_*', why: 'ssh key', risk: 'secret' },
  { re: /(^|\/)(credentials|secrets?)[^/]*\.(json|ya?ml|toml|txt)$/i, pattern: 'secrets*', why: 'looks like a credentials file', risk: 'secret' },
  { re: /\.tfstate(\.backup)?$/, pattern: '*.tfstate*', why: 'terraform state can hold secrets', risk: 'secret' },
  { re: /(^|\/)\.npmrc$/, pattern: '.npmrc', why: 'may hold registry tokens', risk: 'secret' },
  { re: /(^|\/)node_modules(\/|$)/, pattern: 'node_modules/', why: 'installed packages', risk: 'artifact' },
  { re: /(^|\/)(dist|build|out)(\/|$)/, pattern: 'dist/ build/ out/', why: 'build output', risk: 'artifact' },
  { re: /(^|\/)(\.next|\.nuxt|\.svelte-kit|\.turbo|\.cache|\.parcel-cache)(\/|$)/, pattern: '.next/ .cache/ ...', why: 'framework cache', risk: 'artifact' },
  { re: /(^|\/)(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox)(\/|$)|\.pyc$/, pattern: '__pycache__/ *.pyc', why: 'Python bytecode and caches', risk: 'artifact' },
  { re: /(^|\/)(\.venv|venv|env)(\/|$)/, pattern: '.venv/', why: 'virtual environment', risk: 'artifact' },
  { re: /(^|\/)(target)(\/|$)/, pattern: 'target/', why: 'Rust or Java build output', risk: 'artifact' },
  { re: /(^|\/)(coverage|\.nyc_output|htmlcov)(\/|$)|\.lcov$/, pattern: 'coverage/', why: 'coverage report', risk: 'artifact' },
  { re: /\.(log|tmp|swp|swo|bak)$|(^|\/)npm-debug\.log/, pattern: '*.log *.tmp *.swp', why: 'logs and scratch files', risk: 'noise' },
  { re: /(^|\/)\.DS_Store$|(^|\/)Thumbs\.db$/, pattern: '.DS_Store', why: 'OS metadata', risk: 'noise' },
  { re: /(^|\/)(\.idea|\.vscode|\.vs)(\/|$)|\.iml$/, pattern: '.idea/ .vscode/', why: 'editor settings', risk: 'noise' },
  { re: /\.(o|obj|class|dll|exe|so|dylib|a)$/, pattern: '*.o *.class', why: 'compiled objects', risk: 'artifact' },
]

export type IgnoreSuggestion = { pattern: string; why: string; risk: IgnoreRule['risk']; examples: string[] }

export const ignoreSuggestions = (untracked: readonly string[]): IgnoreSuggestion[] => {
  const by = new Map<string, IgnoreSuggestion>()

  for (const p of untracked) {
    for (const r of IGNORE_RULES) {
      if (r.re.test(p)) {
        const cur = by.get(r.pattern)

        if (cur) {
          if (cur.examples.length < 3) cur.examples.push(p)
        } else by.set(r.pattern, { pattern: r.pattern, why: r.why, risk: r.risk, examples: [p] })
        break
      }
    }
  }
  const rank = { secret: 0, artifact: 1, noise: 2 }

  return [...by.values()].sort((a, b) => rank[a.risk] - rank[b.risk])
}

export const ignoreLines = (sug: readonly IgnoreSuggestion[], untrackedCount: number): Line[] => {
  if (untrackedCount === 0) return [{ t: 'No untracked files: nothing to suggest.', c: 'success' }]

  if (sug.length === 0) return [{ t: `${plural(untrackedCount, 'untracked file')}; none look like build output or secrets.`, c: 'success' }]
  const out: Line[] = [{ t: `Suggested .gitignore entries (${plural(untrackedCount, 'untracked file')} checked):`, c: 'suggestion' }]

  for (const s of sug) {
    out.push({ t: `${s.risk === 'secret' ? 'SECRET ' : '       '}${s.pattern.padEnd(20)} ${s.why}`, c: s.risk === 'secret' ? 'error' : s.risk === 'artifact' ? 'warning' : 'subtle' })
    out.push({ t: `        e.g. ${s.examples.join(', ')}`, c: 'inactive' })
  }
  out.push({ t: 'Nothing was changed. Use /gkignore fill to ask Claude to add them.', c: 'inactive' })

  return out
}

// ---------------------------------------------------------------- large files

export type SizedFile = { path: string; size: number }

export const largeFiles = (files: readonly SizedFile[], thresholdBytes: number): SizedFile[] => files.filter(f => f.size >= thresholdBytes).sort((a, b) => b.size - a.size)

const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.venv|__pycache__)\//

export const watchCandidates = (info: StatusInfo, cap = 200): string[] =>
  info.entries
    .filter(e => (e.kind === 'untracked' || e.kind === 'unstaged' || e.kind === 'both' || e.kind === 'staged') && !e.path.endsWith('/') && !SKIP_DIRS.test(e.path) && !(e.y === 'D' || e.x === 'D'))
    .map(e => e.path)
    .slice(0, cap)

// ---------------------------------------------------------------- blame

export type BlameAuthor = { author: string; lines: number; share: number; lastTs: number; firstTs: number }

export const parseBlame = (out: string): { authors: BlameAuthor[]; total: number; newest?: { hash: string; summary: string; ts: number; author: string } } => {
  const per = new Map<string, { lines: number; last: number; first: number }>()
  const commits = new Map<string, { author: string; ts: number; summary: string }>()
  let total = 0
  let cur: { hash: string; author: string; ts: number; summary: string } | undefined

  for (const l of out.split('\n')) {
    const head = l.match(/^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/)

    if (head) {
      cur = { hash: head[1] as string, author: '', ts: 0, summary: '' }
      continue
    }

    if (!cur) continue

    if (l.startsWith('author ')) cur.author = l.slice(7)
    else if (l.startsWith('author-time ')) cur.ts = Number(l.slice(12))
    else if (l.startsWith('summary ')) cur.summary = l.slice(8)
    else if (l.startsWith('\t')) {
      total++
      const a = cur.author || 'unknown'
      const p = per.get(a) ?? { lines: 0, last: 0, first: Number.MAX_SAFE_INTEGER }
      p.lines++
      p.last = Math.max(p.last, cur.ts)
      p.first = Math.min(p.first, cur.ts)
      per.set(a, p)
      const c = commits.get(cur.hash)

      if (!c || cur.ts >= c.ts) commits.set(cur.hash, { author: cur.author, ts: cur.ts, summary: cur.summary })
      cur = undefined
    }
  }
  const authors = [...per.entries()].map(([author, p]) => ({ author, lines: p.lines, share: pct(p.lines, total), lastTs: p.last, firstTs: p.first })).sort((a, b) => b.lines - a.lines)
  const newest = [...commits.entries()].sort((a, b) => b[1].ts - a[1].ts)[0]

  return { authors, total, ...(newest ? { newest: { hash: newest[0], ...newest[1] } } : {}) }
}

export const blameLines = (file: string, r: ReturnType<typeof parseBlame>, nowSec: number): string[] => {
  if (r.total === 0) return [`${file}: no blame lines (empty or untracked file).`]
  const w = Math.min(28, Math.max(...r.authors.map(a => a.author.length)))
  const out = [`${file}: ${plural(r.total, 'line')}, ${plural(r.authors.length, 'author')}`]

  for (const a of r.authors.slice(0, 8)) out.push(`${trunc(a.author, w).padEnd(w)}  ${String(a.lines).padStart(5)} lines ${String(a.share).padStart(3)}%  last ${fmtAge(a.lastTs, nowSec)}`)

  if (r.authors.length > 8) out.push(`… ${r.authors.length - 8} more authors`)

  if (r.newest) out.push(`Newest change: ${r.newest.hash.slice(0, 7)} ${trunc(r.newest.summary, 60)} (${r.newest.author}, ${fmtAge(r.newest.ts, nowSec)})`)

  return out
}

// ---------------------------------------------------------------- commit splitter

export type Group = { name: string; kind: string; files: string[]; subject: string }

const kindOfPath = (p: string): string => {
  if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock)$/.test(p)) return 'deps'

  if (/(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py)$/.test(p)) return 'test'

  if (/\.(md|mdx|rst|txt)$/i.test(p) || /(^|\/)docs?(\/|$)/.test(p)) return 'docs'

  if (/\.(css|scss|sass|less|styl)$/.test(p)) return 'style'

  if (/(^|\/)(\.github|\.circleci|\.gitlab-ci)|Dockerfile|docker-compose|Makefile$/.test(p)) return 'ci'

  if (/\.(json|ya?ml|toml|ini|cfg|conf)$/.test(p) || /(^|\/)\.[A-Za-z]/.test(p.split('/').pop() ?? '')) return 'config'

  return 'src'
}

export const groupChanges = (paths: readonly string[]): Group[] => {
  const map = new Map<string, Group>()

  for (const p of paths) {
    const kind = kindOfPath(p)
    const parts = p.split('/')
    const dir = kind === 'src' || kind === 'style' ? (parts.length > 2 ? parts.slice(0, 2).join('/') : parts.length === 2 ? (parts[0] as string) : '(root)') : kind === 'test' ? '' : ''
    const key = `${kind}:${dir}`
    const g = map.get(key) ?? { name: dir === '' ? kind : `${kind}: ${dir}`, kind, files: [], subject: '' }
    g.files.push(p)
    map.set(key, g)
  }
  const verb: Record<string, string> = { src: 'feat', test: 'test', docs: 'docs', style: 'style', ci: 'ci', config: 'chore', deps: 'chore(deps)' }

  return [...map.values()]
    .map(g => ({ ...g, subject: `${verb[g.kind] ?? 'chore'}${g.kind === 'src' || g.kind === 'style' ? `(${(g.name.split(': ')[1] ?? 'core').split('/').pop()})` : ''}: <describe ${g.files.length === 1 ? 'this change' : 'these changes'}>` }))
    .sort((a, b) => (a.kind === 'src' ? -1 : 0) - (b.kind === 'src' ? -1 : 0) || b.files.length - a.files.length)
}

export const splitLines = (groups: readonly Group[]): string[] => {
  const n = groups.reduce((a, g) => a + g.files.length, 0)

  if (n === 0) return ['No changed files to split.']

  if (groups.length === 1) return [`${plural(n, 'changed file')} all belong together (${groups[0]?.name}); one commit is fine.`]
  const out = [`${plural(n, 'changed file')} could go in ${groups.length} commits:`]

  groups.forEach((g, i) => {
    out.push('', `${i + 1}. ${g.name}  (${plural(g.files.length, 'file')})`, `   message: ${g.subject}`, ...g.files.slice(0, 6).map(f => `   - ${f}`))

    if (g.files.length > 6) out.push(`   … ${g.files.length - 6} more`)
  })
  out.push('', 'Text only: nothing was staged or committed.')

  return out
}

// ---------------------------------------------------------------- fixup

export type Touch = { hash: string; ts: number; subject: string }

export const parseTouches = (out: string): Touch[] =>
  lines(out).flatMap(l => {
    const [hash, ts, ...rest] = l.split('\t')

    return hash && ts ? [{ hash, ts: Number(ts), subject: rest.join('\t') }] : []
  })

export const pickFixupTarget = (perFile: Record<string, Touch[]>): { target?: Touch; files: string[]; others: Touch[] } => {
  const votes = new Map<string, { t: Touch; files: string[] }>()

  for (const [file, touches] of Object.entries(perFile)) {
    const t = touches[0]

    if (!t) continue
    const v = votes.get(t.hash) ?? { t, files: [] }
    v.files.push(file)
    votes.set(t.hash, v)
  }
  const ranked = [...votes.values()].sort((a, b) => b.files.length - a.files.length || b.t.ts - a.t.ts)
  const best = ranked[0]

  return best ? { target: best.t, files: best.files, others: ranked.slice(1, 4).map(r => r.t) } : { files: [], others: [] }
}

// ---------------------------------------------------------------- release checklist

export type CheckItem = { t: string; done: boolean }

export const DEFAULT_CHECKLIST = ['Tests pass on a clean checkout', 'Changelog updated (/gklog)', 'Version bumped (/gktag)', 'Docs and README match the release', 'No secrets or large files staged (/gkignore, /gklarge)', 'Branch is merged or mergeable (/gkmerge)', 'Tag created and pushed by you']

export const defaultChecklist = (): CheckItem[] => DEFAULT_CHECKLIST.map(t => ({ t, done: false }))

export const toggleItem = (items: readonly CheckItem[], index: number): CheckItem[] => items.map((it, i) => (i === index ? { ...it, done: !it.done } : it))

export const addItem = (items: readonly CheckItem[], text: string, cap = 30): CheckItem[] => {
  const t = text.trim().slice(0, 120)

  return t === '' ? [...items] : [...items, { t, done: false }].slice(0, cap)
}

export const removeItem = (items: readonly CheckItem[], index: number): CheckItem[] => items.filter((_, i) => i !== index)

export const checklistLines = (items: readonly CheckItem[]): Line[] => {
  const done = items.filter(i => i.done).length
  const out: Line[] = [{ t: `Release checklist: ${done}/${items.length} done`, c: done === items.length && items.length > 0 ? 'success' : 'suggestion' }]
  items.forEach((it, i) => out.push({ t: `${String(i + 1).padStart(2)}. [${it.done ? 'x' : ' '}] ${it.t}`, c: it.done ? 'inactive' : undefined }))
  out.push({ t: '/gkrelease tick <n> | add <text> | del <n> | clear', c: 'inactive' })

  return out
}

// ---------------------------------------------------------------- health

export type BranchRow = { name: string; ts: number; upstream: string; track: string; isCurrent: boolean }

export const parseRefs = (out: string): BranchRow[] =>
  lines(out).flatMap(l => {
    const [name, ts, upstream, track, head] = l.split('\t')

    return name ? [{ name, ts: Number(ts) || 0, upstream: upstream ?? '', track: track ?? '', isCurrent: head === '*' }] : []
  })

export const healthLines = (a: { branches: BranchRow[]; merged: string[]; base: string | undefined; nowSec: number; big: SizedFile[]; sampled: number; staleDays?: number }): Line[] => {
  const stale = (a.staleDays ?? 90) * 86_400
  const out: Line[] = [{ t: `Repo health: ${plural(a.branches.length, 'local branch', 'local branches')}${a.base ? `, base ${a.base}` : ''}`, c: 'suggestion' }]
  const sorted = [...a.branches].sort((x, y) => x.ts - y.ts)
  const isStale = (b: BranchRow) => !b.isCurrent && a.nowSec - b.ts > stale
  const staleList = sorted.filter(isStale)
  const mergedSet = new Set(a.merged)
  const mergedList = sorted.filter(b => !b.isCurrent && b.name !== a.base && mergedSet.has(b.name))
  const gone = sorted.filter(b => /gone/.test(b.track))
  out.push({ t: '' }, { t: 'Branch ages', c: 'subtle' })

  for (const b of sorted.slice(0, 12)) {
    const flags = [b.isCurrent ? 'current' : '', isStale(b) ? 'stale' : '', mergedSet.has(b.name) && b.name !== a.base && !b.isCurrent ? 'merged' : '', /gone/.test(b.track) ? 'upstream gone' : ''].filter(Boolean)
    out.push({ t: `  ${trunc(b.name, 32).padEnd(32)} ${fmtAge(b.ts, a.nowSec).padEnd(14)} ${flags.join(', ')}`, c: isStale(b) ? 'warning' : undefined })
  }

  if (sorted.length > 12) out.push({ t: `  … ${sorted.length - 12} more`, c: 'inactive' })
  out.push({ t: '' }, { t: `Stale (no commit in ${a.staleDays ?? 90}+ days): ${staleList.length}`, c: staleList.length > 0 ? 'warning' : 'success' })

  if (mergedList.length > 0) out.push({ t: `Already merged into ${a.base}: ${mergedList.map(b => b.name).slice(0, 8).join(', ')}${mergedList.length > 8 ? ' …' : ''}  (you may delete these yourself)`, c: 'warning' })

  if (gone.length > 0) out.push({ t: `Upstream deleted: ${gone.map(b => b.name).slice(0, 8).join(', ')}`, c: 'warning' })
  out.push({ t: '' }, { t: `Large tracked files (${a.sampled} checked): ${a.big.length === 0 ? 'none over 1 MB' : ''}`, c: a.big.length ? 'warning' : 'success' })

  for (const f of a.big.slice(0, 6)) out.push({ t: `  ${fmtBytes(f.size).padStart(9)}  ${f.path}` })

  return out
}

// ---------------------------------------------------------------- stash, worktrees, submodules, hooks

export type StashRow = { ref: string; ts: number; subject: string }

export const parseStashList = (out: string): StashRow[] =>
  lines(out).flatMap(l => {
    const [ref, ts, ...rest] = l.split('\t')

    return ref ? [{ ref, ts: Number(ts) || 0, subject: rest.join('\t') }] : []
  })

export type Worktree = { path: string; head: string; branch?: string; isBare: boolean; isDetached: boolean; locked?: string; prunable?: string }

export const parseWorktrees = (out: string): Worktree[] => {
  const list: Worktree[] = []
  let cur: Worktree | undefined

  for (const l of out.split('\n')) {
    if (l.startsWith('worktree ')) {
      cur = { path: l.slice(9), head: '', isBare: false, isDetached: false }
      list.push(cur)
    } else if (cur) {
      if (l.startsWith('HEAD ')) cur.head = l.slice(5)
      else if (l.startsWith('branch ')) cur.branch = l.slice(7).replace(/^refs\/heads\//, '')
      else if (l === 'bare') cur.isBare = true
      else if (l === 'detached') cur.isDetached = true
      else if (l.startsWith('locked')) cur.locked = l.slice(6).trim() || 'locked'
      else if (l.startsWith('prunable')) cur.prunable = l.slice(8).trim() || 'prunable'
    }
  }

  return list
}

export const worktreeLines = (list: readonly Worktree[]): Line[] => {
  if (list.length === 0) return [{ t: 'No worktrees reported.', c: 'subtle' }]
  const out: Line[] = [{ t: `Worktrees (${list.length})`, c: 'suggestion' }]

  list.forEach((w, i) => {
    const what = w.isBare ? 'bare' : w.isDetached ? `detached at ${w.head.slice(0, 7)}` : (w.branch ?? '?')
    out.push({ t: `${i === 0 ? '* ' : '  '}${what.padEnd(26)} ${w.path}${w.locked ? `  [locked: ${w.locked}]` : ''}${w.prunable ? `  [prunable: ${w.prunable}]` : ''}`, c: w.prunable ? 'warning' : undefined })
  })

  return out
}

export type Submodule = { state: 'ok' | 'uninitialized' | 'modified' | 'conflict'; sha: string; path: string; describe?: string }

export const parseSubmodules = (out: string): Submodule[] =>
  lines(out).flatMap(l => {
    const m = l.match(/^([ +\-U])([0-9a-f]{7,64}) (\S.*?)(?: \((.*)\))?$/)

    if (!m) return []
    const state = m[1] === '-' ? 'uninitialized' : m[1] === '+' ? 'modified' : m[1] === 'U' ? 'conflict' : 'ok'

    return [{ state, sha: m[2] as string, path: m[3] as string, ...(m[4] ? { describe: m[4] } : {}) } as Submodule]
  })

export const submoduleLines = (list: readonly Submodule[]): Line[] => {
  if (list.length === 0) return [{ t: 'No submodules.', c: 'subtle' }]
  const out: Line[] = [{ t: `Submodules (${list.length})`, c: 'suggestion' }]
  const word = { ok: 'up to date', uninitialized: 'not initialised', modified: 'checked out at a different commit', conflict: 'merge conflicts' }

  for (const s of list) out.push({ t: `  ${s.path.padEnd(28)} ${s.sha.slice(0, 7)}  ${word[s.state]}${s.describe ? `  (${s.describe})` : ''}`, c: s.state === 'ok' ? undefined : s.state === 'conflict' ? 'error' : 'warning' })

  return out
}

export const hookLines = (dir: string, names: readonly { name: string; size: number }[], source: string): Line[] => {
  const real = names.filter(n => !n.name.endsWith('.sample'))
  const samples = names.length - real.length
  const out: Line[] = [{ t: `Git hooks in ${dir} (${source})`, c: 'suggestion' }]

  if (real.length === 0) out.push({ t: `  none installed${samples > 0 ? ` (${samples} .sample files)` : ''}`, c: 'subtle' })

  for (const h of real) out.push({ t: `  ${h.name.padEnd(22)} ${fmtBytes(h.size)}` })
  out.push({ t: 'Listed only; git-kit never runs hooks.', c: 'inactive' })

  return out
}

// ---------------------------------------------------------------- merge preview

export type MergePreview = { conflicts: { file: string; hunks: number }[]; clean: string[] }

export const parseTrivialMerge = (out: string): MergePreview => {
  const conflicts = new Map<string, number>()
  const touched = new Set<string>()
  let file = ''

  for (const l of out.split('\n')) {
    const f = l.match(/^\s+(?:base|our|their)\s+\d+\s+[0-9a-f]+\s+(.+)$/)

    if (f) {
      file = f[1] as string
      touched.add(file)
      continue
    }

    if (/^\+?<<<<<<< /.test(l) && file !== '') conflicts.set(file, (conflicts.get(file) ?? 0) + 1)
  }

  return { conflicts: [...conflicts.entries()].map(([f, hunks]) => ({ file: f, hunks })), clean: [...touched].filter(f => !conflicts.has(f)) }
}

export const mergeLines = (p: MergePreview, ours: string, theirs: string): Line[] => {
  const out: Line[] = [{ t: `Merge preview: ${theirs} into ${ours} (nothing is merged)`, c: 'suggestion' }]

  if (p.conflicts.length === 0) {
    out.push({ t: p.clean.length === 0 ? 'No file is changed on both sides: no conflicts expected.' : `No conflicts expected. ${plural(p.clean.length, 'file')} changed on both sides merge cleanly.`, c: 'success' })
  } else {
    out.push({ t: `${plural(p.conflicts.length, 'file')} would conflict:`, c: 'error' })

    for (const c of p.conflicts) out.push({ t: `  ${c.file}  (${plural(c.hunks, 'conflicting hunk')})`, c: 'error' })

    if (p.clean.length > 0) out.push({ t: `  clean on both sides: ${p.clean.slice(0, 6).join(', ')}`, c: 'inactive' })
  }

  return out
}

// ---------------------------------------------------------------- merge readiness

export const TEST_CMD = /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t)\b|\b(vitest|jest|mocha|pytest|tox|nosetests|rspec|phpunit)\b|\bgo\s+test\b|\bcargo\s+(test|nextest)\b|\bmvn\s+(-\S+\s+)?test\b|\bgradle\w*\s+test\b|\bdotnet\s+test\b|\bswift\s+test\b|\bmake\s+(test|check)\b|\bplugin\s+test\b/

export const isTestCommand = (cmd: string): boolean => TEST_CMD.test(cmd)

export type TestState = { lastPassAt: number; lastFailAt: number; lastCmd: string; editAt: number }

export const testStatus = (t: TestState): 'none' | 'pass' | 'fail' | 'stale' =>
  t.lastPassAt === 0 && t.lastFailAt === 0 ? 'none' : t.lastFailAt > t.lastPassAt ? 'fail' : t.editAt > t.lastPassAt ? 'stale' : 'pass'

export const parseDiffCheck = (out: string): { markers: number; whitespace: number; files: string[] } => {
  const files = new Set<string>()
  let markers = 0
  let whitespace = 0

  for (const l of lines(out)) {
    const m = l.match(/^(.+?):(\d+): (.*)$/)

    if (!m) continue

    if (/leftover conflict marker/.test(m[3] as string)) {
      markers++
      files.add(m[1] as string)
    } else whitespace++
  }

  return { markers, whitespace, files: [...files] }
}

export type Readiness = { score: number; label: string; items: { ok: boolean; t: string; points: number; max: number }[] }

export const readiness = (a: { tests: ReturnType<typeof testStatus>; dirty: number; untracked: number; conflicts: number; markers: number; behind: number }): Readiness => {
  const items = [
    { ok: a.tests === 'pass', max: 40, points: a.tests === 'pass' ? 40 : a.tests === 'stale' ? 20 : 0, t: a.tests === 'pass' ? 'Tests seen passing this session' : a.tests === 'stale' ? 'Tests passed, but files were edited after' : a.tests === 'fail' ? 'Last test run failed' : 'No test run seen this session' },
    { ok: a.dirty === 0, max: 25, points: a.dirty === 0 ? (a.untracked === 0 ? 25 : 20) : Math.max(0, 15 - a.dirty), t: a.dirty === 0 ? (a.untracked === 0 ? 'Working tree clean' : `Tree clean except ${plural(a.untracked, 'untracked file')}`) : `${plural(a.dirty, 'uncommitted change')}` },
    { ok: a.conflicts === 0 && a.markers === 0, max: 25, points: a.conflicts === 0 && a.markers === 0 ? 25 : 0, t: a.conflicts === 0 && a.markers === 0 ? 'No conflicts or conflict markers' : `${plural(a.conflicts, 'unmerged file')}, ${plural(a.markers, 'leftover marker')}` },
    { ok: a.behind === 0, max: 10, points: a.behind === 0 ? 10 : 0, t: a.behind === 0 ? 'Not behind upstream' : `Behind upstream by ${a.behind}` },
  ]
  const score = items.reduce((s, i) => s + i.points, 0)

  return { score, label: score >= 90 ? 'ready' : score >= 65 ? 'nearly ready' : 'not ready', items }
}

export const readinessLines = (r: Readiness): Line[] => {
  const out: Line[] = [{ t: `Merge readiness: ${r.score}/100 (${r.label})`, c: r.score >= 90 ? 'success' : r.score >= 65 ? 'warning' : 'error' }]

  for (const i of r.items) out.push({ t: `  ${i.ok ? '[ok]' : '[!!]'} ${i.t.padEnd(46)} ${i.points}/${i.max}`, c: i.ok ? undefined : 'warning' })
  out.push({ t: 'Tests count only if a test command ran in this session.', c: 'inactive' })

  return out
}

// ---------------------------------------------------------------- toasts

export type ToastGate = { lastAny: number; last: Record<string, number> }

// At most one toast per `anyMs` overall and one per `kindMs` for each kind.
export const toastAllowed = (g: ToastGate, kind: string, now: number, kindMs: number, anyMs = 180_000): boolean => now - g.lastAny >= anyMs && now - (g.last[kind] ?? -Infinity) >= kindMs

export const toastMark = (g: ToastGate, kind: string, now: number): ToastGate => ({ lastAny: now, last: { ...g.last, [kind]: now } })

// ---------------------------------------------------------------- refs

// `for-each-ref --format=%(refname)` lines to plain branch names (local and remote, without HEAD pointers).
export const parseBranchRefs = (out: string): string[] =>
  lines(out).flatMap(l => {
    if (l.endsWith('/HEAD')) return []

    if (l.startsWith('refs/heads/')) return [l.slice(11)]
    const m = l.match(/^refs\/remotes\/([^/]+)\/(.+)$/)

    return m ? [`${m[1]}/${m[2]}`] : []
  })

export const isSafeRef = (s: string) => /^[A-Za-z0-9_][\w./@{}~^-]*$/.test(s) && !s.includes('..')
