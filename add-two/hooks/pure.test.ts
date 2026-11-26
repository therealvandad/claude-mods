import { expect, test } from 'claude-code/testing'

import type { Data, GraphRow } from '../types'
import {
  bar,
  changelogLines,
  clip,
  diskLines,
  extractIssueRefs,
  fmtBytes,
  groupNotes,
  issueLines,
  layoutGraph,
  parseConventional,
  parseDu,
  parseGraphRows,
  parseLogLines,
  parseTags,
  pickLastTag,
  refLabels,
  releaseNotesLines,
  remoteSlug,
  toText,
} from './gitparse'
import {
  INTERVALS,
  addArch,
  addCard,
  addDecision,
  archLines,
  cleanData,
  cleanRec,
  dayKey,
  dayNumber,
  decisionLines,
  defaultPr,
  dueCards,
  editRetro,
  emptyData,
  gradeCard,
  quizPrompt,
  redact,
  removeArch,
  retroLines,
  suggestTerms,
  weekKey,
} from './learn'
import {
  PALETTES,
  cheatItems,
  docLines,
  firstHeading,
  handoffLines,
  isDocName,
  isSecretName,
  onboardingLines,
  parseMakeTargets,
  parsePackageScripts,
  parsePorcelain,
  parsePyproject,
  searchDocs,
  shareLines,
  themeLines,
} from './pack'
import { SVG_FORBIDDEN, archSvg, esc, graphSvg } from './svg'

// A structural check: every tag is one of ours, and every attribute name is one we write. Escaped text may still
// contain words such as "onload=" as plain characters; that is harmless because no "<" survives inside it.
const TAGS = ['svg', 'style', 'path', 'circle', 'g', 'title', 'rect', 'text']
const ATTRS = ['xmlns', 'viewBox', 'width', 'height', 'role', 'aria-label', 'class', 'd', 'cx', 'cy', 'r', 'x', 'y', 'rx']

const expectSafeStructure = (svg: string) => {
  const noStyle = svg.replace(/<style>[\s\S]*?<\/style>/, '<style></style>')

  for (const m of noStyle.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/g)) {
    expect(TAGS).toContain(m[2] as string)

    for (const a of (m[3] as string).matchAll(/\s([A-Za-z:-]+)=/g)) expect(ATTRS).toContain(a[1] as string)
  }
  // No "<" that is not the start of one of those tags.
  expect(noStyle.replace(/<\/?(svg|style|path|circle|g|title|rect|text)\b[^<>]*>/g, '').includes('<')).toBe(false)
}

const H = (n: number) => n.toString(16).padStart(40, '0')

// What `git log --format=%H|%P|%s|%D` prints for a small history with a feature branch merged back.
const LOG = [
  `${H(9)}|${H(7)} ${H(8)}|Merge branch 'feature/x' into main|HEAD -> main, origin/main`,
  `${H(8)}|${H(6)}|feat(ui): add dark mode | with a pipe in the subject|tag: v1.2.0, feature/x`,
  `${H(7)}|${H(5)}|fix: crash on empty input|`,
  `${H(6)}|${H(5)}|docs: explain the flags|`,
  `${H(5)}|${H(4)}|chore: bump deps|tag: v1.1.0`,
  `${H(4)}||Initial commit|`,
].join('\n')

test('parseGraphRows reads the log format, pipes in subjects, parents and decorations', () => {
  const rows = parseGraphRows(LOG)
  expect(rows.length).toBe(6)
  expect(rows[0]?.parents).toEqual([H(7), H(8)])
  expect(rows[0]?.refs).toBe('HEAD -> main, origin/main')
  expect(rows[1]?.subject).toBe('feat(ui): add dark mode | with a pipe in the subject')
  expect(rows[1]?.refs).toBe('tag: v1.2.0, feature/x')
  expect(rows[5]?.parents).toEqual([])
  expect(parseGraphRows('garbage\n\nnot|a|log\n' + LOG).length).toBe(6)
  expect(parseGraphRows(LOG, 2).length).toBe(2)
})

test('refLabels sorts decorations into head, tag, local and remote', () => {
  expect(refLabels('HEAD -> main, tag: v1.0, origin/main, feature/x')).toEqual([
    { kind: 'head', name: 'main' },
    { kind: 'tag', name: 'v1.0' },
    { kind: 'remote', name: 'origin/main' },
    { kind: 'remote', name: 'feature/x' },
  ])
  expect(refLabels('HEAD')).toEqual([{ kind: 'head', name: 'HEAD' }])
  expect(refLabels('')).toEqual([])
})

test('layoutGraph keeps the first parent in the lane and opens a lane for a merged branch', () => {
  const rows = parseGraphRows(LOG)
  const lay = layoutGraph(rows)
  // The merge sits in lane 0; its second parent opens lane 1; the branch commit sits in lane 1.
  expect(lay.cols[0]).toBe(0)
  expect(lay.cols[1]).toBe(1)
  expect(lay.cols[2]).toBe(0)
  expect(lay.width).toBe(2)
  // Every commit but the root has an edge to its parent, and the root has none.
  expect(lay.edges.length).toBe(6)
  const e = lay.edges.find(x => x.r0 === 0 && x.b === 1)
  expect(e).toBeDefined()
  for (const x of lay.edges) {
    expect(x.r1).toBeGreaterThan(x.r0)
    expect(x.lane).toBeGreaterThanOrEqual(0)
    expect(x.lane).toBeLessThan(lay.width)
  }
})

test('layoutGraph runs lines off the bottom when the parents are cut off', () => {
  const rows = parseGraphRows(LOG).slice(0, 3)
  const lay = layoutGraph(rows)
  expect(lay.edges.some(x => x.r1 === 3)).toBe(true)
  expect(layoutGraph([]).width).toBe(1)
})

test('layoutGraph copes with an octopus merge and a repeated parent', () => {
  const rows: GraphRow[] = [
    { hash: H(10), parents: [H(1), H(2), H(3)], subject: 'octopus', refs: '' },
    { hash: H(1), parents: [H(0)], subject: 'a', refs: '' },
    { hash: H(2), parents: [H(0)], subject: 'b', refs: '' },
    { hash: H(3), parents: [H(0)], subject: 'c', refs: '' },
    { hash: H(0), parents: [], subject: 'root', refs: '' },
  ]
  const lay = layoutGraph(rows)
  expect(lay.width).toBe(3)
  expect(lay.cols[4]).toBe(0)
  expect(lay.edges.length).toBe(6)
})

test('graphSvg is one well-formed, script-free, escaped drawing', () => {
  const svg = graphSvg(parseGraphRows(LOG))
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect((svg.match(/<svg/g) ?? []).length).toBe(1)
  expect(svg.length).toBeLessThan(40_000)
  expect(svg).not.toMatch(SVG_FORBIDDEN)
  expect(svg).toContain('@media (prefers-color-scheme:dark)')
  // The lane colour classes also set fill, so lines must keep fill:none with a more specific selector.
  expect(svg).toContain('path.e{fill:none')
  expect(svg).not.toMatch(/animation|@keyframes|<animate/)
  expect(svg).toContain('feat(ui): add dark mode')
  expect(svg).not.toContain('NaN')
  expect(svg).not.toContain('undefined')
})

test('hostile subjects, refs and hashes cannot break out of the graph SVG', () => {
  const evil: GraphRow[] = [
    { hash: H(2), parents: [H(1)], subject: '</text><script>alert(1)</script><svg onload=alert(1)>', refs: 'tag: "><image href=x>, HEAD -> a"b&c' },
    { hash: H(1), parents: [], subject: "x' onmouseover='alert(1)", refs: 'javascript:alert(1)' },
    { hash: 'not-a-hash"><script>', parents: [], subject: 'dropped', refs: '' },
  ]
  const svg = graphSvg(evil)
  expectSafeStructure(svg)
  expect(svg).not.toContain('<script')
  expect(svg).not.toContain('<image')
  expect(svg).toContain('&lt;script&gt;')
  expect(svg).toContain('&quot;')
  expect(svg).toContain('&#39;')
  expect(svg).not.toContain('dropped')
  expect((svg.match(/<svg/g) ?? []).length).toBe(1)
  expect(esc('a<b>&"\'\u0000\u0007')).toBe('a&lt;b&gt;&amp;&quot;&#39;')
})

test('a huge or empty history still gives a small, valid SVG', () => {
  expect(graphSvg([])).toContain('no commits')
  const many: GraphRow[] = Array.from({ length: 300 }, (_, i) => ({ hash: H(i + 1), parents: i === 0 ? [] : [H(i)], subject: `commit number ${i} ${'x'.repeat(300)}`, refs: Array.from({ length: 12 }, (_, k) => `branch-${k}`).join(', ') })).reverse()
  const svg = graphSvg(many)
  expect(svg.length).toBeLessThan(120_000)
  expect(svg).not.toMatch(SVG_FORBIDDEN)
  expect((svg.match(/<circle/g) ?? []).length).toBeLessThanOrEqual(60)
})

// ---------------------------------------------------------------- release notes and changelog

const ENTRIES = parseLogLines(
  [
    'a1b2c3d\tfeat(ui): add dark mode',
    'b2c3d4e\tfix: crash on empty input',
    'c3d4e5f\tfeat!: drop node 16',
    'd4e5f60\tdocs: explain the flags',
    'e5f6071\tperf(core): cache the parser',
    'f607182\trefactor: split the module',
    '0718293\tfix(security): CVE-2026-1234 escape the path',
    '1829304\tchore: bump deps',
    '2930415\tUpdated the readme',
    '3041526\ttest: add cases',
    'garbage line',
  ].join('\n'),
)

test('parseLogLines and parseTags read hash tab subject and tag lists', () => {
  expect(ENTRIES.length).toBe(10)
  expect(ENTRIES[0]).toEqual({ hash: 'a1b2c3d', subject: 'feat(ui): add dark mode' })
  expect(parseTags('v2.0.0-rc.1\nv1.9.0\n\nv1.8.0\n')).toEqual(['v2.0.0-rc.1', 'v1.9.0', 'v1.8.0'])
  expect(pickLastTag(['v2.0.0-rc.1', 'v1.9.0', 'v1.8.0'])).toBe('v1.9.0')
  expect(pickLastTag(['v2.0.0-rc.1'])).toBe('v2.0.0-rc.1')
  expect(pickLastTag([])).toBeUndefined()
})

test('parseConventional handles scope, bang and BREAKING CHANGE', () => {
  expect(parseConventional('feat(ui): x')).toEqual({ type: 'feat', scope: 'ui', breaking: false, text: 'x' })
  expect(parseConventional('feat!: x').breaking).toBe(true)
  expect(parseConventional('fix(api)!: y').breaking).toBe(true)
  expect(parseConventional('Updated stuff').type).toBe('other')
  expect(parseConventional('fix: z BREAKING CHANGE: gone').breaking).toBe(true)
})

test('release notes group by prefix with breaking changes first, and are never empty-handed', () => {
  const g = groupNotes(ENTRIES)
  expect(g.breaking.length).toBe(1)
  expect(g.groups.map(x => x.name)).toEqual(['Features', 'Fixes', 'Performance', 'Refactoring', 'Documentation', 'Tests', 'Chores', 'Other'])
  const text = toText(releaseNotesLines(ENTRIES, 'v1.9.0'))
  expect(text).toMatch(/10 commits since v1\.9\.0/)
  expect(text).toMatch(/Breaking changes[\s\S]*drop node 16/)
  expect(text).toMatch(/Features \(2\)/)
  expect(text).toMatch(/- ui: add dark mode \(a1b2c3d\)/)
  expect(text).toMatch(/nothing was written/)
  expect(toText(releaseNotesLines([], 'v1.0.0'))).toMatch(/No commits since v1\.0\.0/)
})

test('the changelog follows Keep a Changelog and leaves housekeeping out', () => {
  const text = toText(changelogLines(ENTRIES, 'v1.9.0'))
  expect(text.startsWith('## [Unreleased]')).toBe(true)
  expect(text).toMatch(/### Added\n- ui: add dark mode\n- drop node 16/)
  expect(text).toMatch(/### Changed\n- core: cache the parser\n- split the module/)
  expect(text).toMatch(/### Fixed\n- crash on empty input/)
  expect(text).toMatch(/### Security\n- security: CVE-2026-1234/)
  expect(text).not.toMatch(/bump deps|explain the flags|add cases/)
  expect(text).toMatch(/4 housekeeping or unprefixed commits left out/)
  expect(text).toMatch(/nothing was written to CHANGELOG\.md/)
  expect(text.indexOf('### Added')).toBeLessThan(text.indexOf('### Fixed'))
})

// ---------------------------------------------------------------- issues

test('issue references are found, de-duplicated, and entities and colours are skipped', () => {
  const refs = extractIssueRefs('Fix #12 and #12 again, see acme/widgets#7, also octo/cat.js#99 but not &#39; or a#b or the colour #ff0000 or ##5')
  expect(refs).toEqual([
    { slug: '', num: 12 },
    { slug: 'acme/widgets', num: 7 },
    { slug: 'octo/cat.js', num: 99 },
  ])
  expect(extractIssueRefs('#0 #99999999 x#3')).toEqual([])
  expect(extractIssueRefs(Array.from({ length: 80 }, (_, i) => `#${i + 1}`).join(' ')).length).toBe(30)
})

test('remote urls turn into owner/repo only for GitHub, and credentials are dropped', () => {
  expect(remoteSlug('https://github.com/acme/widgets.git')).toBe('acme/widgets')
  expect(remoteSlug('https://user:tok@github.com/acme/widgets')).toBe('acme/widgets')
  expect(remoteSlug('https://tok@github.com/acme/widgets.git\n')).toBe('acme/widgets')
  expect(remoteSlug('git@github.com:acme/widgets.git')).toBe('acme/widgets')
  expect(remoteSlug('ssh://git@github.com/acme/wid.gets.git')).toBe('acme/wid.gets')
  expect(remoteSlug('https://gitlab.com/acme/widgets.git')).toBeUndefined()
  expect(remoteSlug('https://github.com.evil.com/acme/widgets')).toBeUndefined()
  expect(remoteSlug('')).toBeUndefined()
})

test('issue lines list links as text and never fetch', () => {
  const text = toText(issueLines([{ slug: '', num: 12 }, { slug: 'a/b', num: 3 }], 'acme/widgets', 'your prompts'))
  expect(text).toMatch(/acme\/widgets#12 {2}https:\/\/github\.com\/acme\/widgets\/issues\/12/)
  expect(text).toMatch(/a\/b#3 {2}https:\/\/github\.com\/a\/b\/issues\/3/)
  expect(text).toMatch(/nothing was fetched/)
  expect(toText(issueLines([{ slug: '', num: 5 }], undefined, 'x'))).toMatch(/#5 {2}\(no GitHub remote/)
  expect(toText(issueLines([], undefined, 'x'))).toMatch(/No issue references/)
})

// ---------------------------------------------------------------- disk

const DU = '4\t/Users/me/proj/.github\n182340\t/Users/me/proj/node_modules\n920\t/Users/me/proj/src\n0\t/Users/me/proj/empty dir\nnot a line\n12\trelative/ignored\n'

test('parseDu reads du -sk lines with spaces in names and drops junk', () => {
  expect(parseDu(DU)).toEqual([
    { path: '/Users/me/proj/.github', kb: 4 },
    { path: '/Users/me/proj/node_modules', kb: 182340 },
    { path: '/Users/me/proj/src', kb: 920 },
    { path: '/Users/me/proj/empty dir', kb: 0 },
  ])
  expect(parseDu('')).toEqual([])
})

test('disk lines are sorted bars with sizes and percentages', () => {
  const text = toText(
    diskLines(
      [
        { name: 'src', bytes: 920 * 1024, kind: 'dir' },
        { name: 'node_modules', bytes: 182340 * 1024, kind: 'dir' },
        { name: 'package.json', bytes: 900, kind: 'file' },
      ],
      '/Users/me/proj',
      { skipped: 1, isPartial: true },
    ),
  )
  const lines = text.split('\n')
  expect(lines[0]).toMatch(/Disk usage of \/Users\/me\/proj: 179 MB in 3 top-level entries/)
  expect(lines[1]).toMatch(/^█{24} +178 MB +99% {2}node_modules\/$/)
  expect(lines[2]).toMatch(/src\/$/)
  expect(text).toMatch(/1 entry not measured/)
  expect(text).toMatch(/20 second limit/)
  expect(bar(0.5, 4)).toBe('██░░')
  expect(bar(Number.NaN, 4)).toBe('░░░░')
  expect(bar(9, 4)).toBe('████')
  expect(fmtBytes(0)).toBe('0 B')
  expect(fmtBytes(1536)).toBe('1.5 KB')
  expect(toText(diskLines([], '/x', { skipped: 0, isPartial: false }))).toMatch(/empty/)
})

// ---------------------------------------------------------------- data validation

test('cleanData turns any junk into a valid, bounded Data', () => {
  expect(cleanData(undefined)).toEqual(emptyData())
  expect(cleanData('x')).toEqual(emptyData())
  expect(cleanData([1, 2])).toEqual(emptyData())
  const junk = cleanData({
    pr: { '/r': [{ t: 'ok', done: true }, { t: '', done: true }, 5], '': [{ t: 'x' }], '/q': 'no' },
    path: [{ title: 'T', steps: [{ t: 's', done: 'yes' }] }, { title: '' }, null],
    cards: [{ id: 3, front: 'f', back: 'b', box: 99, due: -4, seen: 'x' }, { id: 4, front: '', back: 'b' }],
    words: [{ term: 't', def: 5 }, { term: '' }],
    arch: [
      { id: 1, parent: 0, name: 'root', note: 'n' },
      { id: 2, parent: 9, name: 'orphan' },
      { id: 3, parent: 1, name: 'kid' },
      { id: 1, parent: 0, name: 'dupe' },
      { id: 4, parent: 4, name: 'self' },
    ],
    decisions: [{ id: 1, date: 'yesterday', title: 'd', status: 'weird' }],
    retros: { '2026-W48': { well: ['a', 5], actions: [{ t: 'x', done: true }] }, 'bad-key': { well: ['z'] } },
    ratings: { 'add-kit': 5, 'Bad Name': 3, cockpit: 9, motion: 2.5, alerts: 1 },
  })
  expect(junk.pr).toEqual({ '/r': [{ t: 'ok', done: true }] })
  expect(junk.path).toEqual([{ title: 'T', steps: [{ t: 's', done: false }] }])
  expect(junk.cards).toEqual([{ id: 3, front: 'f', back: 'b', box: 5, due: 0, seen: 0 }])
  expect(junk.nextCard).toBe(4)
  expect(junk.words).toEqual([{ term: 't', def: '' }])
  expect(junk.arch.map(a => a.name)).toEqual(['root', 'kid'])
  expect(junk.nextArch).toBe(4)
  expect(junk.decisions[0]).toMatchObject({ date: '1970-01-01', status: 'proposed' })
  expect(Object.keys(junk.retros)).toEqual(['2026-W48'])
  expect(junk.retros['2026-W48']?.well).toEqual(['a'])
  expect(junk.ratings).toEqual({ 'add-kit': 5, alerts: 1 })
})

test('cleanData enforces every size limit', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, front: `f${i}`, back: `b${i}` }))
  const d = cleanData({ cards: many, words: many.map(m => ({ term: m.front })), path: Array.from({ length: 50 }, (_, i) => ({ title: `t${i}`, steps: Array.from({ length: 50 }, (_, k) => ({ t: `s${k}` })) })) })
  expect(d.cards.length).toBe(300)
  expect(d.words.length).toBe(200)
  expect(d.path.length).toBe(12)
  expect(d.path[0]?.steps.length).toBe(16)
  expect(clip('x'.repeat(500), 20).length).toBe(20)
  const r = cleanRec({ prompts: Array.from({ length: 100 }, (_, i) => `p${i}`), files: ['a', 5, 'b'], todos: [{ t: 'x', s: 'bogus' }, { t: '', s: 'pending' }] })
  expect(r.prompts.length).toBe(60)
  expect(r.prompts[59]).toBe('p99')
  expect(r.files).toEqual(['a', 'b'])
  expect(r.todos).toEqual([{ t: 'x', s: 'pending' }])
})

test('dates: local day keys, day numbers and ISO weeks', () => {
  const t = new Date(2026, 10, 25, 23, 30, 0).getTime()
  expect(dayKey(t)).toBe('2026-11-25')
  expect(dayNumber(t + 3_600_000)).toBe(dayNumber(t) + 1)
  expect(weekKey(new Date(2026, 10, 25).getTime())).toBe('2026-W48')
  expect(weekKey(new Date(2026, 0, 1).getTime())).toBe('2026-W01')
  expect(weekKey(new Date(2027, 0, 1).getTime())).toBe('2026-W53')
  expect(weekKey(new Date(2024, 11, 30).getTime())).toBe('2025-W01')
  expect(defaultPr().length).toBe(8)
})

// ---------------------------------------------------------------- learning

test('Leitner cards: good moves up with longer gaps, again goes back to box 1 behind the others', () => {
  const today = 20_000
  let d: Data = emptyData()
  d = addCard(d, 'one', '1', today)
  d = addCard(d, 'two', '2', today)
  d = addCard(d, '', 'x', today)
  expect(d.cards.length).toBe(2)
  expect(dueCards(d.cards, today).map(c => c.front)).toEqual(['one', 'two'])
  d = gradeCard(d, 1, true, today)
  expect(d.cards[0]).toMatchObject({ box: 2, due: today + INTERVALS[2] })
  expect(dueCards(d.cards, today).map(c => c.front)).toEqual(['two'])
  d = gradeCard(d, 2, false, today)
  expect(d.cards[1]).toMatchObject({ box: 1, due: today })
  d = gradeCard(d, 1, true, today + 2)
  d = gradeCard(d, 1, true, today + 6)
  d = gradeCard(d, 1, true, today + 20)
  d = gradeCard(d, 1, true, today + 40)
  expect(d.cards[0]?.box).toBe(5)
  expect(d.cards[0]?.due).toBe(today + 40 + 16)
  // After Again the failed card waits behind a card that was never failed.
  const e = gradeCard(addCard(addCard(emptyData(), 'a', 'a', today), 'b', 'b', today), 1, false, today)
  expect(dueCards(e.cards, today).map(c => c.front)).toEqual(['b', 'a'])
})

test('the quiz prompt names recent topics, masks tokens and works without prompts', () => {
  const p = quizPrompt(['fix the parser bug', 'use token sk-ABCDEFGHIJKLMNOP1234 in the call', 'rename the Widget class'])
  expect(p).toMatch(/three short questions/)
  expect(p).toMatch(/- fix the parser bug/)
  expect(p).toContain('[token]')
  expect(p).not.toContain('sk-ABCDEF')
  expect(quizPrompt([])).toMatch(/topics we covered so far/)
  expect(redact('ghp_abcdefghijklmnopqrstuv')).toBe('[token]')
  expect(redact('a'.repeat(45))).toBe('[token]')
  expect(redact('normal words only')).toBe('normal words only')
})

test('glossary suggestions are repeated words and identifiers, minus stop words and known terms', () => {
  const prompts = ['Why does the useAuthToken hook rerender?', 'Please make useAuthToken stable', 'the reconcile step is slow', 'reconcile again after the hook fires', 'file file file']
  const s = suggestTerms(prompts, [])
  expect(s.map(x => x.term)).toContain('reconcile')
  expect(s[0]?.term).toBe('useauthtoken')
  expect(s.map(x => x.term)).not.toContain('file')
  expect(suggestTerms(prompts, [{ term: 'Reconcile', def: '' }]).map(x => x.term)).not.toContain('reconcile')
  expect(suggestTerms([], [])).toEqual([])
})

test('the architecture tree numbers, nests, removes subtrees and refuses bad parents', () => {
  let d = emptyData()
  const step = (r: Data | string): Data => {
    expect(typeof r).not.toBe('string')

    return r as Data
  }
  d = step(addArch(d, 0, 'App', 'entry'))
  d = step(addArch(d, 1, 'API', 'http'))
  d = step(addArch(d, 1, 'UI', ''))
  d = step(addArch(d, 2, 'DB', 'sqlite'))
  expect(archLines(d.arch).map(l => l.t)).toEqual(['Architecture: 4 components', ' 1. App  - entry', ' 2.    └ API  - http', ' 3.       └ DB  - sqlite', ' 4.    └ UI'])
  expect(addArch(d, 9, 'x', '')).toMatch(/no component 9/)
  expect(addArch(d, 0, '   ', '')).toMatch(/name/)
  d = step(removeArch(d, 2))
  expect(d.arch.map(a => a.name)).toEqual(['App', 'UI'])
  expect(removeArch(d, 7)).toMatch(/no component/)
  let deep = emptyData()

  for (let i = 0; i < 6; i++) deep = step(addArch(deep, i, `n${i}`, ''))
  expect(addArch(deep, 6, 'too deep', '')).toMatch(/six levels/)
})

test('archSvg draws boxes and links, escapes names and survives odd trees', () => {
  let d = emptyData()
  d = addArch(d, 0, 'App <b>', 'a "note"') as Data
  d = addArch(d, 1, 'API', '') as Data
  d = addArch(d, 1, 'UI', 'x') as Data
  d = addArch(d, 3, '</title><script>x</script>', '') as Data
  const svg = archSvg(d.arch)
  expect(svg.startsWith('<svg')).toBe(true)
  expectSafeStructure(svg)
  expect(svg).toContain('App &lt;b&gt;')
  expect(svg).toContain('&lt;/title&gt;')
  expect((svg.match(/<rect/g) ?? []).length).toBe(4)
  expect((svg.match(/class="ln"/g) ?? []).length).toBe(3)
  expect(svg).not.toContain('NaN')
  expect(archSvg([])).toContain('no components')
  const wide = cleanData({ arch: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, parent: 0, name: `component-${i}-with-a-long-name` })) })
  const big = archSvg(wide.arch)
  expect(big.length).toBeLessThan(120_000)
  expect(big).not.toMatch(SVG_FORBIDDEN)
})

test('decisions and retros keep their own bounded lists', () => {
  let d = addDecision(emptyData(), 'Use SQLite', 'simple', '2026-11-25')
  d = addDecision(d, '', '', '2026-11-25')
  expect(d.decisions.length).toBe(1)
  expect(d.decisions[0]).toMatchObject({ id: 1, status: 'proposed', date: '2026-11-25' })
  expect(decisionLines(d.decisions).map(l => l.t)[1]).toBe('  1. 2026-11-25  [proposed]  Use SQLite')

  for (let i = 0; i < 130; i++) d = addDecision(d, `d${i}`, '', '2026-11-25')
  expect(d.decisions.length).toBe(100)
  expect(d.decisions[99]?.title).toBe('d129')
  let r = emptyData()

  for (let w = 1; w <= 30; w++) r = editRetro(r, `2026-W${String(w).padStart(2, '0')}`, x => ({ ...x, well: ['ok'] }))
  expect(Object.keys(r.retros).length).toBe(26)
  expect(Object.keys(r.retros)[25]).toBe('2026-W30')
  expect(toText(retroLines('2026-W30', r.retros['2026-W30']))).toMatch(/Went well\n {2}1\. ok/)
  expect(toText(retroLines('2026-W31', undefined))).toMatch(/\(nothing yet\)/)
})

// ---------------------------------------------------------------- project files

test('secret-like names are recognised and docs names are README or docs markdown', () => {
  for (const n of ['.env', '.env.local', 'secrets.md', 'README.secret.md', 'id_rsa', 'token.txt', 'api-key.md', 'cert.pem', 'server.key', 'credentials.json', '.npmrc', 'private.md']) expect(isSecretName(n)).toBe(true)

  for (const n of ['README.md', 'readme.txt', 'architecture.md', 'keyboard.md', 'monkey.md', 'package.json', 'envelope.md']) expect(isSecretName(n)).toBe(false)
  expect(isDocName('README')).toBe(true)
  expect(isDocName('README.md')).toBe(true)
  expect(isDocName('readme.rst')).toBe(true)
  expect(isDocName('README.png')).toBe(false)
  expect(isDocName('READMEFIRST.md')).toBe(false)
})

test('first headings: ATX, setext and none', () => {
  expect(firstHeading('\n# My Project ##\n\ntext')).toBe('My Project')
  expect(firstHeading('Title Here\n==========\ntext')).toBe('Title Here')
  expect(firstHeading('just text\nmore')).toBe('')
  expect(firstHeading('intro\n\n## Second\n')).toBe('Second')
})

test('docs search matches names and headings only and lists skipped secret-like names', () => {
  const docs = [
    { path: 'README.md', heading: 'Widget toolkit' },
    { path: 'docs/install.md', heading: 'Installing' },
    { path: 'docs/deploy-guide.md', heading: 'Shipping to production' },
  ]
  expect(searchDocs(docs, '').length).toBe(3)
  expect(searchDocs(docs, 'install').map(x => x.path)).toEqual(['docs/install.md'])
  expect(searchDocs(docs, 'production').map(x => x.why)).toEqual(['heading'])
  expect(searchDocs(docs, 'deploy guide').length).toBe(1)
  expect(searchDocs(docs, 'deploy nothing').length).toBe(0)
  expect(searchDocs(docs, 'DEPLOY-guide').length).toBe(1)
  const text = toText(docLines(searchDocs(docs, 'widget'), 'widget', ['docs/.env.md'], 3))
  expect(text).toMatch(/README\.md {2}- {2}Widget toolkit {3}\(heading\)/)
  expect(text).toMatch(/Skipped \(secret-like name, never opened\): docs\/\.env\.md/)
})

const PKG = JSON.stringify({ name: 'x', scripts: { test: 'vitest run', build: 'tsc -p .', 'lint:fix': 'eslint . --fix', 'bad name': 'x', 'a;b': 'x', dev: 5 }, dependencies: { a: '1' } }, null, 2)

test('package scripts parse from whole and from cut-off JSON, rejecting odd names', () => {
  expect(parsePackageScripts(PKG).map(s => s.name)).toEqual(['test', 'build', 'lint:fix'])
  const cut = PKG.slice(0, PKG.indexOf('"bad name"'))
  expect(parsePackageScripts(cut).map(s => s.name)).toEqual(['test', 'build', 'lint:fix'])
  expect(parsePackageScripts('{ "name": "x" }')).toEqual([])
  expect(parsePackageScripts('not json')).toEqual([])
  expect(parsePackageScripts('{"scripts": {"a": "echo \\"hi\\""}}')[0]?.body).toBe('echo "hi"')
})

const MAKE = [
  'CC := gcc',
  'VERSION ?= 1.0',
  '.PHONY: all test clean',
  '',
  'all: build test ## Build everything',
  '\t@echo hi',
  'build: ## Compile',
  '\t$(CC) main.c',
  'test lint: build',
  '%.o: %.c',
  '\t$(CC) -c $<',
  'vars: FOO=bar',
  'clean:',
  'FOO = a: b',
].join('\n')

test('make targets skip assignments, patterns, dot targets and recipe lines', () => {
  const t = parseMakeTargets(MAKE)
  expect(t.map(x => x.name)).toEqual(['all', 'build', 'test', 'lint', 'vars', 'clean'])
  expect(t[0]?.note).toBe('Build everything')
  expect(t[1]?.note).toBe('Compile')
})

const PYP = [
  '[project]',
  'name = "demo"',
  '[project.scripts]',
  'demo = "demo.cli:main"',
  'demo-admin = "demo.admin:main"',
  '# a comment',
  '[tool.pdm.scripts]',
  'lint = "ruff check ."',
  '"test" = { cmd = "pytest" }',
  '[tool.poe.tasks]',
  'serve = "uvicorn app:app"',
  '[tool.other]',
  'skip = 1',
].join('\n')

test('pyproject scripts come from the known sections only', () => {
  const p = parsePyproject(PYP)
  expect(p.map(x => x.cmd)).toEqual(['demo', 'demo-admin', 'pdm run lint', 'pdm run test', 'poe serve'])
  const all = cheatItems(PKG, MAKE, PYP)
  expect(all.some(i => i.cmd === 'npm test')).toBe(true)
  expect(all.some(i => i.cmd === 'npm run build')).toBe(true)
  expect(all.some(i => i.cmd === 'make clean')).toBe(true)
  expect(all.every(i => /^[A-Za-z0-9 :_.-]+$/.test(i.cmd))).toBe(true)
  expect(cheatItems(undefined, undefined, undefined)).toEqual([])
})

test('onboarding outline covers what it is, layout, how to run and where to start', () => {
  const text = toText(
    onboardingLines({
      dir: 'widgets',
      entries: [
        { name: 'src', kind: 'dir' },
        { name: 'docs', kind: 'dir' },
        { name: '.git', kind: 'dir' },
        { name: '.github', kind: 'dir' },
        { name: 'package.json', kind: 'file' },
        { name: 'README.md', kind: 'file' },
      ],
      readme: '# Widgets\n\n[![ci](x)](y)\n\nA small toolkit of widgets for dashboards.\n\n## Install',
      readmeName: 'README.md',
      scripts: ['test', 'build'],
      targets: [],
      skipped: ['.env'],
    }),
  )
  expect(text).toMatch(/Onboarding outline: widgets/)
  expect(text).toMatch(/README\.md: Widgets/)
  expect(text).toMatch(/A small toolkit of widgets/)
  expect(text).toMatch(/src\/ {2}- source code/)
  expect(text).toMatch(/\.github\/ {2}- CI workflows/)
  expect(text).not.toMatch(/ \.git\//)
  expect(text).toMatch(/package\.json scripts: test, build/)
  expect(text).toMatch(/README {2}->/)
  expect(text).toMatch(/Skipped \(secret-like names, never opened\): \.env/)
  expect(toText(onboardingLines({ dir: 'x', entries: [], scripts: [], targets: [], skipped: [] }))).toMatch(/No README found/)
})

test('the handoff pack has goals, decisions, open todos and changed files, and says what is off', () => {
  const text = toText(
    handoffLines({
      branch: 'feature/x',
      goals: ['add dark mode'],
      decisions: [{ id: 1, date: '2026-11-25', title: 'Use CSS variables', status: 'accepted', note: '' }, { id: 2, date: '2026-11-25', title: 'No', status: 'rejected', note: '' }],
      todos: [{ t: 'write tests', s: 'in_progress' }, { t: 'ship', s: 'pending' }, { t: 'done thing', s: 'completed' }],
      files: ['src/a.ts'],
      gitFiles: ['src/a.ts', 'README.md'],
      isRecording: { prompts: true, edits: true, todos: true },
      isGit: true,
    }),
  )
  expect(text).toMatch(/branch feature\/x/)
  expect(text).toMatch(/- add dark mode/)
  expect(text).toMatch(/\[accepted\] Use CSS variables/)
  expect(text).not.toMatch(/\[rejected\]/)
  expect(text).toMatch(/\[~\] write tests/)
  expect(text).not.toMatch(/done thing/)
  expect(text).toMatch(/- src\/a\.ts\n- README\.md {2}\(uncommitted, from git status\)/)
  expect(text).toMatch(/nothing was written/)
  const off = toText(handoffLines({ branch: '', goals: [], decisions: [], todos: [], files: [], gitFiles: [], isRecording: { prompts: false, edits: false, todos: false }, isGit: false }))
  expect(off).toMatch(/record-prompts is off/)
  expect(off).toMatch(/record-todos is off/)
  expect(off).toMatch(/not a git repository/)
})

test('git status porcelain paths, including renames and quotes', () => {
  expect(parsePorcelain(' M src/a.ts\n?? new.txt\nR  old.ts -> new.ts\nA  "sp ace.txt"\n')).toEqual(['src/a.ts', 'new.txt', 'new.ts', 'sp ace.txt'])
  expect(parsePorcelain('')).toEqual([])
})

test('the 8 palettes are data with raw hex swatches and a command each, the guide is manual-only', () => {
  expect(PALETTES.length).toBe(8)

  for (const p of PALETTES) {
    expect(p.sw.length).toBe(6)
    expect(p.sw.every(h => /^#[0-9a-fA-F]{6}$/.test(h))).toBe(true)
    expect(p.look !== undefined || p.skuse !== undefined).toBe(true)
  }
  expect(new Set(PALETTES.map(p => p.id)).size).toBe(8)
  expect(toText(themeLines())).toMatch(/applies nothing/)
  const share = toText(shareLines())
  expect(share).toMatch(/claude plugin marketplace add <owner>\/<repo>/)
  expect(share).toMatch(/claude plugin install <mod> --marketplace <owner>\/<repo>/)
  expect(share).toMatch(/manual step for you/)
  expect(share).toMatch(/Safety scan checklist/)
  expect(share).not.toMatch(/git push|gh repo create/)
})
