// Pure parsers and text builders for git output, du output and issue references. No `$` in here.
import type { GraphRow, Line } from '../types'

export const clip = (s: unknown, n: number): string => {
  const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : ''

  return t.length > n ? `${t.slice(0, Math.max(0, n - 1)).trimEnd()}…` : t
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const fmtBytes = (n: number): string => {
  const v = Number.isFinite(n) && n > 0 ? n : 0

  if (v < 1024) return `${Math.round(v)} B`

  if (v < 1024 * 1024) return `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB`

  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(v < 10 * 1024 ** 2 ? 1 : 0)} MB`

  return `${(v / 1024 ** 3).toFixed(1)} GB`
}

export const note = (t: string, c?: Line['c']): Line => (c ? { t, c } : { t })
export const toText = (lines: readonly Line[]): string => lines.map(l => l.t).join('\n')

// ------------------------------------------------------------------ 282 the git graph

const HASH = /^([0-9a-f]{40}|[0-9a-f]{64})\|([0-9a-f ]*)\|(.*)$/

/** Rows from `git log --format=%H|%P|%s|%D`. A line that does not fit the shape is dropped. */
export const parseGraphRows = (out: string, max = 60): GraphRow[] => {
  const rows: GraphRow[] = []

  for (const line of out.split('\n')) {
    const m = HASH.exec(line)

    if (m === null) continue
    const rest = m[3] as string
    const bar = rest.lastIndexOf('|')
    const subject = bar >= 0 ? rest.slice(0, bar) : rest
    const refs = bar >= 0 ? rest.slice(bar + 1) : ''
    rows.push({
      hash: m[1] as string,
      parents: (m[2] as string).split(' ').filter(p => /^[0-9a-f]{40,64}$/.test(p)).slice(0, 8),
      subject: clip(subject, 120),
      refs: clip(refs, 160),
    })

    if (rows.length >= max) break
  }

  return rows
}

export type RefLabel = { kind: 'head' | 'branch' | 'remote' | 'tag'; name: string }

/** `HEAD -> main, tag: v1.0, origin/main` as labels. */
export const refLabels = (refs: string): RefLabel[] => {
  const out: RefLabel[] = []

  for (const raw of refs.split(',')) {
    const p = raw.trim()

    if (p === '') continue

    if (p.startsWith('HEAD -> ')) {
      out.push({ kind: 'head', name: clip(p.slice(8), 40) })
    } else if (p === 'HEAD') {
      out.push({ kind: 'head', name: 'HEAD' })
    } else if (p.startsWith('tag: ')) {
      out.push({ kind: 'tag', name: clip(p.slice(5), 40) })
    } else {
      out.push({ kind: p.includes('/') ? 'remote' : 'branch', name: clip(p, 40) })
    }
  }

  return out.slice(0, 5)
}

export type Edge = { r0: number; a: number; lane: number; r1: number; b: number }
export type Layout = { cols: number[]; edges: Edge[]; width: number }

/** Lane assignment for a newest-first commit list. Edges run from a commit to each parent, down a lane. */
export const layoutGraph = (rows: readonly GraphRow[]): Layout => {
  const lanes: (string | null)[] = []
  const origins: { row: number; a: number }[][] = []
  const cols: number[] = []
  const edges: Edge[] = []
  let width = 1

  const free = (): number => {
    const i = lanes.indexOf(null)

    if (i >= 0) return i
    lanes.push(null)
    origins.push([])

    return lanes.length - 1
  }

  rows.forEach((row, r) => {
    let col = lanes.indexOf(row.hash)

    if (col < 0) {
      col = free()
    }
    cols[r] = col
    width = Math.max(width, col + 1)

    // Every lane waiting for this commit ends here.
    lanes.forEach((h, i) => {
      if (h === row.hash) {
        for (const o of origins[i] as { row: number; a: number }[]) {
          edges.push({ r0: o.row, a: o.a, lane: i, r1: r, b: col })
        }
        lanes[i] = null
        origins[i] = []
      }
    })

    row.parents.forEach((p, k) => {
      const waiting = lanes.indexOf(p)

      if (waiting >= 0) {
        origins[waiting]?.push({ row: r, a: col })

        return
      }
      const lane = k === 0 && lanes[col] === null ? col : free()
      lanes[lane] = p
      origins[lane] = [{ row: r, a: col }]
      width = Math.max(width, lane + 1)
    })
  })

  // Parents beyond the list: the line runs off the bottom.
  lanes.forEach((h, i) => {
    if (h !== null) {
      for (const o of origins[i] as { row: number; a: number }[]) {
        edges.push({ r0: o.row, a: o.a, lane: i, r1: rows.length, b: i })
      }
    }
  })

  return { cols, edges, width: Math.min(width, 12) }
}

// ------------------------------------------------------------------ 284 release notes, 285 changelog

export type LogEntry = { hash: string; subject: string }

export const parseLogLines = (out: string, max = 300): LogEntry[] => {
  const rows: LogEntry[] = []

  for (const line of out.split('\n')) {
    const [h, ...rest] = line.split('\t')

    if (h === undefined || !/^[0-9a-f]{7,40}$/.test(h) || rest.length === 0) continue
    rows.push({ hash: h, subject: clip(rest.join(' '), 160) })

    if (rows.length >= max) break
  }

  return rows
}

export const parseTags = (out: string): string[] =>
  out
    .split('\n')
    .map(t => t.trim())
    .filter(t => t !== '' && t.length <= 100)
    .slice(0, 400)

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** The newest plain release tag (the list is already sorted newest first), else the newest tag of any kind. */
export const pickLastTag = (tags: readonly string[]): string | undefined =>
  tags.find(t => {
    const m = SEMVER.exec(t)

    return m !== null && m[4] === undefined
  }) ?? tags[0]

export type Conv = { type: string; scope: string; breaking: boolean; text: string }

const CONV = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/

export const parseConventional = (subject: string): Conv => {
  const m = CONV.exec(subject)

  if (m === null) {
    return { type: 'other', scope: '', breaking: /BREAKING CHANGE/i.test(subject), text: subject }
  }

  return { type: (m[1] as string).toLowerCase(), scope: m[2] ?? '', breaking: m[3] === '!' || /BREAKING CHANGE/i.test(subject), text: m[4] as string }
}

const NOTE_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ['Features', ['feat', 'feature']],
  ['Fixes', ['fix', 'bugfix', 'hotfix']],
  ['Performance', ['perf']],
  ['Refactoring', ['refactor']],
  ['Documentation', ['docs', 'doc']],
  ['Tests', ['test', 'tests']],
  ['Build and CI', ['build', 'ci']],
  ['Chores', ['chore', 'style', 'revert', 'deps']],
]

export type NoteGroups = { breaking: { e: LogEntry; c: Conv }[]; groups: { name: string; items: { e: LogEntry; c: Conv }[] }[] }

export const groupNotes = (entries: readonly LogEntry[]): NoteGroups => {
  const breaking: NoteGroups['breaking'] = []
  const map = new Map<string, { e: LogEntry; c: Conv }[]>()

  for (const e of entries) {
    const c = parseConventional(e.subject)

    if (c.breaking) breaking.push({ e, c })
    const g = NOTE_GROUPS.find(([, types]) => types.includes(c.type))?.[0] ?? 'Other'
    map.set(g, [...(map.get(g) ?? []), { e, c }])
  }
  const order = [...NOTE_GROUPS.map(([n]) => n), 'Other']

  return { breaking, groups: order.filter(n => map.has(n)).map(name => ({ name, items: map.get(name) as { e: LogEntry; c: Conv }[] })) }
}

const itemText = (i: { e: LogEntry; c: Conv }) => `${i.c.scope !== '' ? `${i.c.scope}: ` : ''}${i.c.type === 'other' ? i.e.subject : i.c.text}`

export const releaseNotesLines = (entries: readonly LogEntry[], tag: string | undefined): Line[] => {
  if (entries.length === 0) {
    return [note(`No commits since ${tag ?? 'the start'}: nothing to put in release notes.`, 'warning')]
  }
  const g = groupNotes(entries)
  const out: Line[] = [note(`Release notes draft: ${plural(entries.length, 'commit')} since ${tag ?? 'the start of history'}`, 'suggestion'), note('')]

  if (g.breaking.length > 0) {
    out.push(note('Breaking changes', 'error'))

    for (const i of g.breaking.slice(0, 20)) out.push(note(`- ${clip(itemText(i), 110)} (${i.e.hash})`))
    out.push(note(''))
  }

  for (const grp of g.groups) {
    out.push(note(`${grp.name} (${grp.items.length})`, 'suggestion'))

    for (const i of grp.items.slice(0, 40)) out.push(note(`- ${clip(itemText(i), 110)} (${i.e.hash})`))

    if (grp.items.length > 40) out.push(note(`  … ${grp.items.length - 40} more`, 'inactive'))
    out.push(note(''))
  }
  out.push(note('A draft shown here only: nothing was written to a file, a tag or a release.', 'inactive'))

  return out
}

const KAC: readonly (readonly [string, (c: Conv, s: string) => boolean])[] = [
  ['Security', (_c, s) => /\b(security|cve-\d{4}-\d+|vulnerab)/i.test(s)],
  ['Removed', c => c.type === 'revert'],
  ['Deprecated', (_c, s) => /\bdeprecat/i.test(s)],
  ['Added', c => c.type === 'feat' || c.type === 'feature'],
  ['Fixed', c => c.type === 'fix' || c.type === 'bugfix' || c.type === 'hotfix'],
  ['Changed', c => ['perf', 'refactor', 'build', 'ci', 'style', 'deps'].includes(c.type)],
]

/** Keep-a-Changelog layout. Housekeeping (docs, tests, chores) is left out and counted. */
export const changelogLines = (entries: readonly LogEntry[], tag: string | undefined): Line[] => {
  if (entries.length === 0) {
    return [note(`No commits since ${tag ?? 'the start'}: nothing to add to a changelog.`, 'warning')]
  }
  const sections = new Map<string, string[]>()
  let left = 0

  for (const e of entries) {
    const c = parseConventional(e.subject)
    const hit = KAC.find(([, test]) => test(c, e.subject))

    if (hit === undefined) {
      left++
      continue
    }
    sections.set(hit[0], [...(sections.get(hit[0]) ?? []), `- ${clip(itemText({ e, c }), 120)}`])
  }
  const out: Line[] = [note('## [Unreleased]'), note('')]

  for (const name of ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']) {
    const items = sections.get(name)

    if (items === undefined) continue
    out.push(note(`### ${name}`))

    for (const i of items.slice(0, 40)) out.push(note(i))

    if (items.length > 40) out.push(note(`- … ${items.length - 40} more`))
    out.push(note(''))
  }

  if (sections.size === 0) out.push(note('(Nothing user-facing: every commit is docs, tests or a chore.)', 'inactive'), note(''))
  out.push(note(`Source: ${plural(entries.length, 'commit')} since ${tag ?? 'the start'}; ${plural(left, 'housekeeping or unprefixed commit')} left out. Grouping is by conventional-commit prefix, a heuristic.`, 'inactive'))
  out.push(note('Shown here only: nothing was written to CHANGELOG.md.', 'inactive'))

  return out
}

// ------------------------------------------------------------------ 286 issue links

export type IssueRef = { slug: string; num: number }

/** `owner/repo#12` and `#12`. A bare number gets slug ''. HTML entities (&#12;) and anchors in words are skipped. */
export const extractIssueRefs = (text: string, max = 30): IssueRef[] => {
  const seen = new Set<string>()
  const out: IssueRef[] = []
  const re = /(?<![\w&/#])(?:([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}))?#(\d{1,7})(?![\w#;])/g

  for (const m of text.matchAll(re)) {
    const slug = m[1] ?? ''
    const num = Number(m[2])

    if (!Number.isSafeInteger(num) || num < 1) continue
    const key = `${slug.toLowerCase()}#${num}`

    if (seen.has(key)) continue
    seen.add(key)
    out.push({ slug, num })

    if (out.length >= max) break
  }

  return out
}

/** `owner/repo` from a GitHub remote url (https, ssh, git@), credentials ignored. Anything else is undefined. */
export const remoteSlug = (url: string): string | undefined => {
  const u = url.trim()
  const m = /^(?:https?:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(u)

  return m === null ? undefined : `${m[1]}/${(m[2] as string).replace(/\.git$/, '')}`
}

export const issueLines = (refs: readonly IssueRef[], defaultSlug: string | undefined, source: string): Line[] => {
  if (refs.length === 0) {
    return [note(`No issue references (#123 or owner/repo#123) found in ${source}.`, 'warning')]
  }
  const out: Line[] = [note(`${plural(refs.length, 'issue reference')} in ${source}`, 'suggestion')]

  for (const r of refs) {
    const slug = r.slug !== '' ? r.slug : defaultSlug

    out.push(slug === undefined ? note(`  #${r.num}  (no GitHub remote found to link it to)`, 'inactive') : note(`  ${slug}#${r.num}  https://github.com/${slug}/issues/${r.num}`))
  }
  out.push(note('Links only: nothing was fetched, so titles and states are not shown. A pull request link redirects from /issues/.', 'inactive'))

  return out
}

// ------------------------------------------------------------------ 281 disk usage

/** `du -sk` lines: "<kilobytes>\t<path>". Lines that do not fit are dropped. */
export const parseDu = (out: string): { path: string; kb: number }[] => {
  const rows: { path: string; kb: number }[] = []

  for (const line of out.split('\n')) {
    const m = /^(\d+)\s+(\/.+)$/.exec(line)

    if (m !== null) rows.push({ path: m[2] as string, kb: Number(m[1]) })
  }

  return rows
}

export const bar = (frac: number, width = 24): string => {
  const f = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0
  const full = Math.round(f * width)

  return '█'.repeat(full) + '░'.repeat(width - full)
}

export type DiskRow = { name: string; bytes: number; kind: 'dir' | 'file' }

export const diskLines = (rows: readonly DiskRow[], cwd: string, extra: { skipped: number; isPartial: boolean }): Line[] => {
  if (rows.length === 0) {
    return [note('The folder is empty, or nothing could be measured.', 'warning')]
  }
  const sorted = [...rows].sort((a, b) => b.bytes - a.bytes)
  const total = sorted.reduce((s, r) => s + r.bytes, 0)
  const max = sorted[0]?.bytes ?? 1
  const out: Line[] = [note(`Disk usage of ${clip(cwd, 70)}: ${fmtBytes(total)} in ${plural(rows.length, 'top-level entry', 'top-level entries')}`, 'suggestion')]

  for (const r of sorted.slice(0, 25)) {
    const pct = total > 0 ? Math.round((r.bytes / total) * 100) : 0
    out.push(note(`${bar(max > 0 ? r.bytes / max : 0)} ${fmtBytes(r.bytes).padStart(8)} ${String(pct).padStart(3)}%  ${clip(r.name, 40)}${r.kind === 'dir' ? '/' : ''}`))
  }

  if (sorted.length > 25) out.push(note(`… ${sorted.length - 25} smaller entries`, 'inactive'))

  if (extra.skipped > 0) out.push(note(`${plural(extra.skipped, 'entry', 'entries')} not measured (links or limits).`, 'inactive'))

  if (extra.isPartial) out.push(note('The 20 second limit was reached: the list is partial. Run it in a smaller folder for the rest.', 'warning'))
  out.push(note('Measured with du -sk (read-only), top level only.', 'inactive'))

  return out
}
