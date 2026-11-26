import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register } from 'claude-code'

import type { CheatItem, Data, GraphRow, Line, Rec, ViewState } from '../types'
import { RUN_ENV, Refused, safeArgv } from './guard'
import {
  changelogLines,
  clip,
  diskLines,
  extractIssueRefs,
  issueLines,
  note,
  parseDu,
  parseGraphRows,
  parseLogLines,
  parseTags,
  pickLastTag,
  plural,
  releaseNotesLines,
  remoteSlug,
  toText,
} from './gitparse'
import type { DiskRow, LogEntry } from './gitparse'
import {
  LIMITS,
  STATUSES,
  addArch,
  addCard,
  addDecision,
  addItem,
  archLines,
  archOrderIds,
  cardSummary,
  checkLines,
  cleanData,
  cleanRec,
  dayKey,
  dayNumber,
  decisionLines,
  defaultPr,
  dueCards,
  editRetro,
  emptyData,
  emptyRec,
  gradeCard,
  pathLines,
  quizPrompt,
  redact,
  removeArch,
  removeAt,
  retroLines,
  suggestTerms,
  toggleAt,
  weekKey,
  wordLines,
  MOD_NAME,
} from './learn'
import { MODS } from './modlist'
import {
  PALETTES,
  cheatItems,
  cheatLines,
  docLines,
  firstHeading,
  handoffLines,
  isDocName,
  isSecretName,
  onboardingLines,
  paletteCommands,
  parseMakeTargets,
  parsePackageScripts,
  parsePorcelain,
  searchDocs,
  shareLines,
  themeLines,
} from './pack'
import { archSvg, graphSvg } from './svg'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'add-two-main'
const STORE = 'add-two:data'

const GROUPS = [
  ['git', 'Git'],
  ['project', 'Project'],
  ['learn', 'Learn'],
  ['design', 'Design'],
  ['mods', 'Mods'],
] as const
type Group = (typeof GROUPS)[number][0]

const TABS: Record<Group, readonly string[]> = {
  git: ['graph', 'notes', 'change', 'pr', 'issues'],
  project: ['disk', 'docs', 'onboard', 'cheats', 'handoff'],
  learn: ['path', 'cards', 'quiz', 'words'],
  design: ['arch', 'decisions', 'retro'],
  mods: ['ratings', 'themes', 'share'],
}
const TAB_LABEL: Record<string, string> = {
  graph: 'Graph',
  notes: 'Release notes',
  change: 'Changelog',
  pr: 'PR checklist',
  issues: 'Issues',
  disk: 'Disk',
  docs: 'Docs',
  onboard: 'Onboarding',
  cheats: 'Cheatsheet',
  handoff: 'Handoff',
  path: 'Path',
  cards: 'Cards',
  quiz: 'Quiz',
  words: 'Glossary',
  arch: 'Architecture',
  decisions: 'Decisions',
  retro: 'Retro',
  ratings: 'Ratings',
  themes: 'Themes',
  share: 'Share',
}
const ALL_TABS = Object.values(TABS).flat()
// Tabs that read git or files when opened. The disk scan only runs when asked for.
const AUTO = ['graph', 'notes', 'change', 'issues', 'docs', 'onboard', 'cheats', 'handoff']
const PAGE = 8

const groupOf = (tab: string): Group => (GROUPS.find(([g]) => TABS[g].includes(tab))?.[0] ?? 'git') as Group

// The shared look switches (owned by the settings mod, read only) and this mod's own feature switches.
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {} as Record<string, boolean>, { shape: 'features-1' })
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')

const viewA = atom(
  { plugin: 'add-two', key: 'view' } as const,
  { group: 'git', tab: 'graph', isBusy: false, at: 0, page: 0, isCardShown: false, repo: '', views: {}, graph: [], cheats: [] } as ViewState,
  { shape: 'view-1' },
)
const dataA = atom({ plugin: 'add-two', key: 'data' } as const, emptyData(), { shape: 'data-1' })
const recA = atom({ plugin: 'add-two', key: 'rec' } as const, emptyRec(), { shape: 'rec-1' })

/** The defaults of features.json, mirrored here (a test checks they agree). */
export const FEATURE_DEFAULTS: Record<string, boolean> = {
  'git-reads': true,
  'disk-scan': true,
  'file-reads': true,
  svg: true,
  'record-prompts': false,
  'record-edits': false,
  'record-todos': false,
  'due-toast': false,
}

const isOn = async ($: Dollar, id: string): Promise<boolean> => {
  const o = await read($, featuresA)

  return o[`add-two.${id}`] ?? FEATURE_DEFAULTS[id] ?? false
}

// ---------------------------------------------------------------- the commands

const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['ae', '/ae', 'List every add-two command'],
  ['aepane', '/aepane [tab]', 'Open the add-two pane (tabs grouped Git, Project, Learn, Design, Mods)'],
  ['aedisk', '/aedisk', '281 Disk usage of the top-level entries of this folder (du -sk, 20 s limit)'],
  ['aegraph', '/aegraph', '282 Git graph of the last 40 to 60 commits (SVG on desktop, text elsewhere)'],
  ['aepr', '/aepr [tick n|add text|del n|clear]', '283 Pull-request checklist for this repo'],
  ['aenotes', '/aenotes', '284 Release notes draft since the last tag, grouped by commit prefix (shown only)'],
  ['aechange', '/aechange', '285 Changelog in Keep a Changelog layout since the last tag (shown only)'],
  ['aeissues', '/aeissues [text]', '286 Issue links (#123, owner/repo#123) from your recorded prompts or pasted text'],
  ['aedocs', '/aedocs [query]', '287 Search README and docs/*.md file names and first headings'],
  ['aepath', '/aepath [add|step|tick|del|delstep]', '288 Learning path tracker with steps and ticks'],
  ['aecard', '/aecard [add|review|show|good|again|list|del]', '289 Flashcards with Leitner review'],
  ['aequiz', '/aequiz [note Q | A|notes|del n]', '290 Fill a prompt asking for a 3-question quiz; keep answers you note'],
  ['aeword', '/aeword [add|del|suggest]', '291 Glossary with word-frequency suggestions (heuristic)'],
  ['aearch', '/aearch [add|del|note|rename]', '292 Architecture sketch: component tree, box diagram on desktop'],
  ['aedecide', '/aedecide [add|set|del]', '293 Decision log with date and status'],
  ['aeretro', '/aeretro [well|improve|action|tick|del|list]', '294 Weekly retro notes'],
  ['aepack', '/aepack [fill]', '295 Handoff pack: goals, decisions, open todos, changed files (shown only)'],
  ['aeonboard', '/aeonboard', '296 Onboarding outline from the top-level listing, README and script names'],
  ['aecheat', '/aecheat', '297 Cheatsheet of npm scripts, make targets and pyproject scripts'],
  ['aerate', '/aerate [mod 1-5|clear mod]', '298 Rate the mods in the list (local only, no network)'],
  ['aetheme', '/aetheme [id]', '299 Theme gallery of 8 palettes; fills /look or /skuse, applies nothing itself'],
  ['aeshare', '/aeshare', '300 Guide to sharing a mod through GitHub (publishing is manual)'],
  ['aereset', '/aereset', 'Clear everything add-two recorded or stored'],
]

export const COMMAND_NAMES: readonly string[] = COMMANDS.map(c => c[0])

const HELP = [
  'add-two: git, releases, docs and learning. Git and du are read-only through an argv allowlist; no network; nothing is written to your project.',
  ...COMMANDS.map(([, usage, desc]) => `${usage.padEnd(48)} ${desc}`),
  '',
  `Pane "${PANE}": ${GROUPS.map(([g, l]) => `${l} (${TABS[g].map(t => TAB_LABEL[t]).join(', ')})`).join('; ')}.`,
  'Switches (default): /cfg feature add-two.<id> on|off with git-reads on, disk-scan on, file-reads on, svg on, record-prompts off, record-edits off, record-todos off, due-toast off.',
].join('\n')

// ---------------------------------------------------------------- guarded shell

class Off extends Error {}

type Ran = { code: number; out: string; err: string }

// Every process this mod starts goes through here; `safeArgv` throws for anything not on the allowlist.
const run = async ($: Dollar, argv: string[], timeoutMs = 15_000, root = ''): Promise<Ran> => {
  const final = safeArgv(argv, root)
  const r = await $.process.run(final, { env: RUN_ENV, timeoutMs })

  return { code: r.exitCode, out: r.stdout, err: r.stderr }
}

const git = async ($: Dollar, args: string[], timeoutMs = 15_000): Promise<Ran> => {
  if (!(await isOn($, 'git-reads'))) throw new Off('Git reading is switched off: /cfg feature add-two.git-reads on')

  return run($, ['git', ...args], timeoutMs)
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const firstLine = (s: string) => s.split('\n').find(l => l.trim() !== '')?.trim() ?? ''

type Repo = { ok: true; root: string } | { ok: false; text: string }

const repoOf = async ($: Dollar): Promise<Repo> => {
  let r: Ran

  try {
    r = await git($, ['rev-parse', '--show-toplevel'])
  } catch (err) {
    if (err instanceof Off || err instanceof Refused) throw err

    return { ok: false, text: `git could not be run here: ${msgOf(err)}` }
  }

  if (r.code !== 0) {
    return { ok: false, text: /not a git repository/i.test(r.err) ? 'This folder is not a git repository, so there is nothing to read. Start a session inside a repo.' : `git could not read this folder: ${firstLine(r.err) || 'unknown error'}` }
  }

  return { ok: true, root: r.out.trim() }
}

const cwdOf = async ($: Dollar): Promise<string> => {
  const c = await $.session.cwd().catch(() => '')

  return c.length > 1 ? c.replace(/\/+$/, '') : c
}

const readHead = async ($: Dollar, path: string, bytes: number): Promise<string | undefined> => {
  try {
    return await $.fs.read(path, { length: bytes })
  } catch {
    return undefined
  }
}

const needFiles = async ($: Dollar) => {
  if (!(await isOn($, 'file-reads'))) throw new Off('Reading project files is switched off: /cfg feature add-two.file-reads on')
}

// ---------------------------------------------------------------- data helpers

const mutate = async ($: Dollar, fn: (d: Data) => Data | string): Promise<string | undefined> => {
  const cur = await read($, dataA)
  const r = fn(cur)

  if (typeof r === 'string') return r
  const next = cleanData(r)
  await update($, dataA, () => next)
  await $.store.set(STORE, next)

  return undefined
}

const todayOf = async ($: Dollar) => dayNumber(await $.clock.now())

const loadData = async ($: Dollar) => {
  const saved = await $.store.get(STORE).catch(() => undefined)
  await update($, dataA, () => cleanData(saved))
}

/** `n.m` as zero-based indexes, or undefined. */
export const parseNM = (s: string): [number, number] | undefined => {
  const m = /^(\d{1,3})\.(\d{1,3})$/.exec(s)

  return m === null ? undefined : [Number(m[1]) - 1, Number(m[2]) - 1]
}
const parseN = (s: string | undefined): number | undefined => (s !== undefined && /^\d{1,4}$/.test(s) ? Number(s) - 1 : undefined)

const split = (args: string) => {
  const a = args.trim()
  const m = /^(\S+)\s*([\s\S]*)$/.exec(a)

  return { op: (m?.[1] ?? '').toLowerCase(), rest: (m?.[2] ?? '').trim() }
}

const pipe = (s: string): [string, string] => {
  const i = s.indexOf('|')

  return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]
}

// ---------------------------------------------------------------- builders (each returns lines)

const noRepo = (text: string): Line[] => [note(text, 'warning')]
const eg = (err: unknown): Line[] => [note(err instanceof Off ? err.message : `Could not read: ${msgOf(err)}`, err instanceof Off ? 'warning' : 'error')]

const buildGraph = async ($: Dollar): Promise<{ lines: Line[]; rows: GraphRow[] }> => {
  const repo = await repoOf($)

  if (!repo.ok) return { lines: noRepo(repo.text), rows: [] }
  const text = await git($, ['log', '--graph', '--oneline', '--decorate', '--no-color', '-n', '40'])

  if (text.code !== 0) {
    return { lines: [note(/does not have any commits|bad default revision/i.test(text.err) ? 'This repository has no commits yet.' : `git log failed: ${firstLine(text.err)}`, 'warning')], rows: [] }
  }
  const fmt = await git($, ['log', '--format=%H|%P|%s|%D', '-n', '60'])
  const rows = fmt.code === 0 ? parseGraphRows(fmt.out) : []
  const lines = [note('Git graph (newest first; text from git log --graph, vector drawing on desktop)', 'suggestion'), ...text.out.split('\n').filter(l => l.trim() !== '').slice(0, 40).map(l => note(clip(l.replace(/\s+$/, ''), 160)))]

  return { lines, rows }
}

const lastTagOf = async ($: Dollar): Promise<string | undefined> => {
  const r = await git($, ['tag', '--list', '--merged', 'HEAD', '--sort=-v:refname'])

  return r.code === 0 ? pickLastTag(parseTags(r.out)) : undefined
}

const sinceTag = async ($: Dollar): Promise<{ tag: string | undefined; entries: LogEntry[]; warn?: string } | string> => {
  const repo = await repoOf($)

  if (!repo.ok) return repo.text
  const tag = await lastTagOf($)
  let range: string[] = []
  let warn: string | undefined

  if (tag !== undefined) {
    if (/^[A-Za-z0-9][A-Za-z0-9._/+@-]{0,99}$/.test(tag) && !tag.includes('..')) range = [`${tag}..HEAD`]
    else warn = `The last tag "${clip(tag, 30)}" cannot be used as a range, so the whole history is used.`
  }
  const r = await git($, ['log', '--no-merges', '--format=%h%x09%s', '-n', '300', ...range])

  if (r.code !== 0) return /does not have any commits|bad default revision/i.test(r.err) ? 'This repository has no commits yet.' : `git log failed: ${firstLine(r.err)}`

  return { tag: warn === undefined ? tag : undefined, entries: parseLogLines(r.out), warn }
}

const buildNotes = async ($: Dollar): Promise<Line[]> => {
  const s = await sinceTag($)

  if (typeof s === 'string') return noRepo(s)

  return [...(s.warn !== undefined ? [note(s.warn, 'warning')] : []), ...releaseNotesLines(s.entries, s.tag)]
}

const buildChange = async ($: Dollar): Promise<Line[]> => {
  const s = await sinceTag($)

  if (typeof s === 'string') return noRepo(s)

  return [...(s.warn !== undefined ? [note(s.warn, 'warning')] : []), ...changelogLines(s.entries, s.tag)]
}

const buildIssues = async ($: Dollar, arg: string): Promise<Line[]> => {
  const rec = await read($, recA)
  const pasted = arg.trim() !== ''
  const text = pasted ? arg : rec.prompts.join('\n')
  const source = pasted ? 'the text you gave' : `your ${plural(rec.prompts.length, 'recorded prompt')}`
  const refs = extractIssueRefs(text)
  let slug: string | undefined

  if (refs.some(r => r.slug === '') && (await isOn($, 'git-reads'))) {
    const r = await git($, ['config', '--get', 'remote.origin.url']).catch(() => undefined)
    slug = r !== undefined && r.code === 0 ? remoteSlug(r.out) : undefined
  }
  const out = issueLines(refs, slug, source)

  if (!pasted && rec.prompts.length === 0) {
    out.unshift(note((await isOn($, 'record-prompts')) ? 'No prompts recorded yet in this session.' : 'Prompt recording is off: /cfg feature add-two.record-prompts on, or paste text: /aeissues <text>', 'warning'))
  }

  return out
}

const listDir = async ($: Dollar, path?: string) => {
  try {
    return await $.fs.list(path)
  } catch {
    return []
  }
}

const buildDisk = async ($: Dollar): Promise<Line[]> => {
  if (!(await isOn($, 'disk-scan'))) return [note('The disk scan is switched off: /cfg feature add-two.disk-scan on', 'warning')]
  const cwd = await cwdOf($)

  if (cwd === '' || !cwd.startsWith('/')) return [note('The working directory is not known here.', 'warning')]
  const listed = await listDir($)
  const entries = listed.slice(0, 150)
  const rows: DiskRow[] = []
  const dirs: string[] = []
  let skipped = Math.max(0, listed.length - 150)

  for (const e of entries) {
    if (e.kind === 'file') rows.push({ name: e.name, bytes: e.size, kind: 'file' })
    else if (e.kind === 'dir' && !/[\n\r\0/]/.test(e.name) && e.name !== '.' && e.name !== '..') dirs.push(e.name)
    else skipped++
  }
  const t0 = await $.clock.now()
  let isPartial = false

  for (let i = 0; i < dirs.length && !isPartial; i += 10) {
    const chunk = dirs.slice(i, i + 10)
    const left = 20_000 - ((await $.clock.now()) - t0)

    if (left < 500) {
      isPartial = true
      break
    }

    try {
      const r = await run($, ['du', '-sk', '--', ...chunk.map(n => `${cwd}/${n}`)], left, cwd)

      for (const d of parseDu(r.out)) {
        const name = d.path.startsWith(`${cwd}/`) ? d.path.slice(cwd.length + 1) : ''

        if (name !== '' && chunk.includes(name)) rows.push({ name, bytes: d.kb * 1024, kind: 'dir' })
      }
    } catch (err) {
      if (err instanceof Refused) throw err
      isPartial = true
    }
  }
  const measured = new Set(rows.map(r => r.name))
  skipped += dirs.filter(d => !measured.has(d)).length

  return diskLines(rows, cwd, { skipped, isPartial })
}

type DocsScan = { docs: { path: string; heading: string }[]; skipped: string[]; total: number }

const scanDocs = async ($: Dollar): Promise<DocsScan> => {
  const docs: { path: string; heading: string }[] = []
  const skipped: string[] = []
  const names: string[] = []
  const root = await listDir($)

  for (const e of root) {
    if (e.kind !== 'file' || !isDocName(e.name)) continue

    if (isSecretName(e.name)) skipped.push(e.name)
    else names.push(e.name)
  }

  for (const e of await listDir($, 'docs')) {
    if (e.kind !== 'file' || !/\.md$/i.test(e.name)) continue

    if (isSecretName(e.name)) skipped.push(`docs/${e.name}`)
    else names.push(`docs/${e.name}`)
  }
  const total = names.length

  for (const p of names.slice(0, 40)) {
    const text = await readHead($, p, 32_768)
    docs.push({ path: p, heading: text === undefined ? '' : firstHeading(text) })
  }

  return { docs, skipped, total }
}

let lastDocsQuery = ''

const buildDocs = async ($: Dollar, query: string): Promise<Line[]> => {
  await needFiles($)
  lastDocsQuery = query
  const s = await scanDocs($)

  return docLines(searchDocs(s.docs, query), query, s.skipped, s.docs.length)
}

const pickReadme = (names: readonly string[]) => names.find(n => /^README\.md$/i.test(n)) ?? names.find(n => /^README(\.(md|markdown|txt|rst))?$/i.test(n))

const buildOnboard = async ($: Dollar): Promise<Line[]> => {
  await needFiles($)
  const cwd = await cwdOf($)
  const all = await listDir($)
  const skipped = all.filter(e => isSecretName(e.name)).map(e => e.name)
  const entries = all.filter(e => !isSecretName(e.name)).map(e => ({ name: e.name, kind: e.kind }))
  const readmeName = pickReadme(entries.filter(e => e.kind === 'file').map(e => e.name))
  const readme = readmeName !== undefined ? await readHead($, readmeName, 2048) : undefined
  const has = (n: string) => entries.some(e => e.name === n && e.kind === 'file')
  const pkg = has('package.json') ? await readHead($, 'package.json', 8192) : undefined
  const mk = has('Makefile') ? await readHead($, 'Makefile', 8192) : undefined

  return onboardingLines({
    dir: cwd.split('/').filter(Boolean).pop() ?? cwd,
    entries,
    readme,
    readmeName,
    scripts: pkg !== undefined ? parsePackageScripts(pkg).map(s => s.name) : [],
    targets: mk !== undefined ? parseMakeTargets(mk).map(t => t.name) : [],
    skipped,
  })
}

const buildCheats = async ($: Dollar): Promise<{ lines: Line[]; items: CheatItem[] }> => {
  await needFiles($)
  const all = await listDir($)
  const has = (n: string) => all.some(e => e.name === n && e.kind === 'file')
  const mkName = has('Makefile') ? 'Makefile' : has('makefile') ? 'makefile' : undefined
  const pkg = has('package.json') ? await readHead($, 'package.json', 8192) : undefined
  const mk = mkName !== undefined ? await readHead($, mkName, 8192) : undefined
  const py = has('pyproject.toml') ? await readHead($, 'pyproject.toml', 8192) : undefined
  const items = cheatItems(pkg, mk, py)
  const found = [pkg !== undefined ? 'package.json' : '', mk !== undefined ? 'Makefile' : '', py !== undefined ? 'pyproject.toml' : ''].filter(Boolean)

  return { lines: cheatLines(items, found), items }
}

const buildHandoff = async ($: Dollar): Promise<Line[]> => {
  const rec = await read($, recA)
  const d = await read($, dataA)
  let branch = ''
  let gitFiles: string[] = []
  let isGit = false

  if (await isOn($, 'git-reads')) {
    const b = await git($, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined)

    if (b !== undefined && b.code === 0) {
      isGit = true
      branch = b.out.trim()
      const s = await git($, ['status', '--porcelain=v1']).catch(() => undefined)
      gitFiles = s !== undefined && s.code === 0 ? parsePorcelain(s.out) : []
    }
  }

  return handoffLines({
    branch,
    goals: rec.prompts.slice(0, 3),
    decisions: d.decisions,
    todos: rec.todos,
    files: rec.files,
    gitFiles,
    isRecording: { prompts: await isOn($, 'record-prompts'), edits: await isOn($, 'record-edits'), todos: await isOn($, 'record-todos') },
    isGit,
  })
}

const repoKey = async ($: Dollar): Promise<string> => {
  try {
    if (await isOn($, 'git-reads')) {
      const r = await git($, ['rev-parse', '--show-toplevel'])

      if (r.code === 0 && r.out.trim() !== '') return clip(r.out.trim(), 200)
    }
  } catch {
    // fall through to the folder
  }

  return clip(await cwdOf($), 200) || 'this folder'
}

const ratingLines = (d: Data): Line[] => {
  const rated = MODS.filter(([n]) => d.ratings[n] !== undefined).sort((a, b) => (d.ratings[b[0]] ?? 0) - (d.ratings[a[0]] ?? 0))
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)

  return [
    note(`Mod ratings: ${rated.length} of ${MODS.length} rated (your own, local, never sent anywhere)`, 'suggestion'),
    ...(rated.length === 0 ? [note('Nothing rated yet. /aerate <mod> <1-5>', 'inactive')] : rated.map(([n, desc]) => note(`  ${stars(d.ratings[n] ?? 0)} ${n.padEnd(16)} ${clip(desc, 60)}`))),
    note('The list is a build-time snapshot of the mods folder; ratings do not install or change anything.', 'inactive'),
  ]
}

// Text of any tab, for the commands. Tabs that read git or files are stored in the view; the rest come from data.
const textOf = async ($: Dollar, tab: string): Promise<Line[]> => {
  const d = await read($, dataA)
  const rec = await read($, recA)
  const ms = await $.clock.now()

  switch (tab) {
    case 'pr': {
      const key = await repoKey($)

      return checkLines(`PR checklist (${clip(key.split('/').pop() ?? key, 40)})`, d.pr[key] ?? defaultPr(), '/aepr tick <n>  add <text>  del <n>  clear')
    }
    case 'path':
      return pathLines(d.path)
    case 'cards':
      return cardSummary(d, dayNumber(ms))
    case 'quiz':
      return [
        note(`Quiz: ${plural(d.qnotes.length, 'saved answer')}; ${plural(rec.prompts.length, 'recorded prompt')} to draw topics from`, 'suggestion'),
        ...d.qnotes.map((q, i) => note(`${String(i + 1).padStart(2)}. Q: ${q.q}${q.a !== '' ? `  A: ${q.a}` : ''}`)),
        note('/aequiz fills a prompt for three questions. /aequiz note <question> | <answer> keeps one.', 'inactive'),
      ]
    case 'words':
      return wordLines(d.words)
    case 'arch':
      return archLines(d.arch)
    case 'decisions':
      return decisionLines(d.decisions)
    case 'retro': {
      const k = weekKey(ms)

      return retroLines(k, d.retros[k])
    }
    case 'ratings':
      return ratingLines(d)
    case 'themes':
      return themeLines()
    case 'share':
      return shareLines()
    default:
      return []
  }
}

const readTab = async ($: Dollar, tab: string): Promise<{ lines: Line[]; graph?: GraphRow[]; cheats?: CheatItem[] }> => {
  switch (tab) {
    case 'graph': {
      const g = await buildGraph($)

      return { lines: g.lines, graph: g.rows }
    }
    case 'notes':
      return { lines: await buildNotes($) }
    case 'change':
      return { lines: await buildChange($) }
    case 'issues':
      return { lines: await buildIssues($, '') }
    case 'disk':
      return { lines: await buildDisk($) }
    case 'docs':
      return { lines: await buildDocs($, lastDocsQuery) }
    case 'onboard':
      return { lines: await buildOnboard($) }
    case 'cheats': {
      const c = await buildCheats($)

      return { lines: c.lines, cheats: c.items }
    }
    case 'handoff':
      return { lines: await buildHandoff($) }
    default:
      return { lines: await textOf($, tab) }
  }
}

// ---------------------------------------------------------------- the pane

const refreshTab = async ($: Dollar, tab: string): Promise<Line[]> => {
  await update($, viewA, v => ({ ...v, isBusy: true }))
  let built: Awaited<ReturnType<typeof readTab>>

  try {
    built = await readTab($, tab)
  } catch (err) {
    built = { lines: eg(err) }
  }
  const at = await $.clock.now()
  const repo = tab === 'pr' ? await repoKey($).catch(() => '') : undefined
  await update($, viewA, v => ({
    ...v,
    tab,
    group: groupOf(tab),
    isBusy: false,
    at,
    repo: repo ?? v.repo,
    graph: built.graph ?? v.graph,
    cheats: built.cheats ?? v.cheats,
    views: { ...v.views, [tab]: built.lines.slice(0, 200) },
  }))

  return built.lines
}

const pressTab = async ($: Dollar, tab: string) => {
  await update($, viewA, v => ({ ...v, tab, group: groupOf(tab), page: 0, isCardShown: false }))

  if (AUTO.includes(tab) || tab === 'pr') await refreshTab($, tab)
}

const showTab = async ($: Dollar, tab: string): Promise<string> => {
  await update($, viewA, v => ({ ...v, tab, group: groupOf(tab), page: 0, isCardShown: false }))
  const opened = await $.ui.open({ id: PANE, title: 'add-two' }).catch(() => undefined)
  const lines = await refreshTab($, tab)
  const text = toText(lines)

  return opened?.isPlaced === false ? `${text}\n\n(No pane could be shown here, so the tab is printed above.)` : text
}

const fill = async ($: Dollar, text: string): Promise<boolean> => {
  const r = await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)

  return r?.isFilled === true
}

// ---------------------------------------------------------------- command handlers

const cmdPr = async ($: Dollar, args: string): Promise<string> => {
  const key = await repoKey($)
  const { op, rest } = split(args)
  const n = parseN(rest.split(/\s+/)[0])

  if (op === '') return showTab($, 'pr')
  const err = await mutate($, d => {
    const items = d.pr[key] ?? defaultPr()
    const set = (next: typeof items) => ({ ...d, pr: { ...d.pr, [key]: next } })

    if (op === 'tick' || op === 'untick') return n !== undefined && n < items.length ? set(toggleAt(items, n)) : `Usage: /aepr tick <1-${items.length}>`

    if (op === 'add') return rest === '' ? 'Usage: /aepr add <text>' : items.length >= LIMITS.items ? `At most ${LIMITS.items} items.` : set(addItem(items, rest))

    if (op === 'del') return n !== undefined && n < items.length ? set(removeAt(items, n)) : `Usage: /aepr del <1-${items.length}>`

    if (op === 'clear') return set(defaultPr())

    return 'Usage: /aepr [tick n | add text | del n | clear]'
  })

  return err ?? showTab($, 'pr')
}

const cmdPath = async ($: Dollar, args: string): Promise<string> => {
  const { op, rest } = split(args)

  if (op === '') return showTab($, 'path')
  const first = rest.split(/\s+/)[0] ?? ''
  const tail = rest.slice(first.length).trim()
  const err = await mutate($, d => {
    if (op === 'add') return rest === '' ? 'Usage: /aepath add <topic>' : d.path.length >= LIMITS.topics ? `At most ${LIMITS.topics} topics.` : { ...d, path: [...d.path, { title: clip(rest, 80), steps: [] }] }
    const ti = parseN(op === 'step' || op === 'del' ? first : undefined)

    if (op === 'step') {
      const t = ti === undefined ? undefined : d.path[ti]

      if (t === undefined || tail === '') return 'Usage: /aepath step <topic number> <step text>'

      if (t.steps.length >= LIMITS.steps) return `At most ${LIMITS.steps} steps per topic.`

      return { ...d, path: d.path.map((x, i) => (i === ti ? { ...x, steps: addItem(x.steps, tail, LIMITS.steps) } : x)) }
    }

    if (op === 'del') return ti !== undefined && ti < d.path.length ? { ...d, path: removeAt(d.path, ti) } : 'Usage: /aepath del <topic number>'

    if (op === 'tick' || op === 'untick' || op === 'delstep') {
      const nm = parseNM(first)
      const t = nm === undefined ? undefined : d.path[nm[0]]

      if (nm === undefined || t === undefined || t.steps[nm[1]] === undefined) return `Usage: /aepath ${op} <topic.step>, e.g. 1.2`
      const [a, b] = nm

      return { ...d, path: d.path.map((x, i) => (i === a ? { ...x, steps: op === 'delstep' ? removeAt(x.steps, b) : toggleAt(x.steps, b) } : x)) }
    }

    return 'Usage: /aepath [add topic | step n text | tick n.m | del n | delstep n.m]'
  })

  return err ?? showTab($, 'path')
}

const cardLine = (c: { id: number; front: string; box: number }) => `#${c.id} (box ${c.box}) ${c.front}`

const cmdCard = async ($: Dollar, args: string): Promise<string> => {
  const { op, rest } = split(args)
  const today = await todayOf($)
  const d0 = await read($, dataA)
  const due = () => dueCards(d0.cards, today)

  if (op === '') return showTab($, 'cards')

  if (op === 'add') {
    const [f, b] = pipe(rest)

    if (f === '' || b === '') return 'Usage: /aecard add <front> | <back>'

    if (d0.cards.length >= LIMITS.cards) return `At most ${LIMITS.cards} cards.`
    await mutate($, d => addCard(d, f, b, today))

    return `Card added. ${plural((await read($, dataA)).cards.length, 'card')} in total.`
  }

  if (op === 'list') {
    return d0.cards.length === 0 ? 'No cards yet. /aecard add <front> | <back>' : d0.cards.slice(0, 60).map(c => `${cardLine(c)}  due ${c.due <= today ? 'now' : `in ${c.due - today}d`}`).join('\n')
  }

  if (op === 'del') {
    const id = Number(rest)

    if (!Number.isInteger(id) || !d0.cards.some(c => c.id === id)) return 'Usage: /aecard del <card id from /aecard list>'
    await mutate($, d => ({ ...d, cards: d.cards.filter(c => c.id !== id) }))

    return `Card #${id} deleted.`
  }
  const cur = due()[0]

  if (op === 'review') {
    await update($, viewA, v => ({ ...v, isCardShown: false }))

    return cur === undefined ? `${toText(cardSummary(d0, today))}\nNothing is due. Come back tomorrow, or add cards with /aecard add.` : `${toText(cardSummary(d0, today))}\nFront: ${cur.front}\n(/aecard show for the back)`
  }

  if (op === 'show') {
    await update($, viewA, v => ({ ...v, isCardShown: true }))

    return cur === undefined ? 'Nothing is due.' : `Back: ${cur.back}\n(/aecard good if you knew it, /aecard again if not)`
  }

  if (op === 'good' || op === 'again') {
    if (cur === undefined) return 'Nothing is due.'
    await mutate($, d => gradeCard(d, cur.id, op === 'good', today))
    await update($, viewA, v => ({ ...v, isCardShown: false }))
    const next = dueCards((await read($, dataA)).cards, today)[0]

    return `${op === 'good' ? 'Moved up a box.' : 'Back to box 1.'} ${next === undefined ? 'No more cards due today.' : `Next front: ${next.front}`}`
  }

  return 'Usage: /aecard [add front | back | review | show | good | again | list | del id]'
}

const cmdQuiz = async ($: Dollar, args: string): Promise<string> => {
  const { op, rest } = split(args)

  if (op === 'note') {
    const [q, a] = pipe(rest)

    if (q === '') return 'Usage: /aequiz note <question> | <your answer>'
    const err = await mutate($, d => (d.qnotes.length >= LIMITS.qnotes ? `At most ${LIMITS.qnotes} saved answers.` : { ...d, qnotes: [...d.qnotes, { q: clip(q, 200), a: clip(a, 400) }] }))

    return err ?? 'Saved.'
  }

  if (op === 'notes') return toText(await textOf($, 'quiz'))

  if (op === 'del') {
    const n = parseN(rest)
    const err = await mutate($, d => (n !== undefined && n < d.qnotes.length ? { ...d, qnotes: removeAt(d.qnotes, n) } : 'Usage: /aequiz del <number>'))

    return err ?? 'Deleted.'
  }

  if (op !== '') return 'Usage: /aequiz [note <question> | <answer> | notes | del n]'
  const rec = await read($, recA)
  const ok = await fill($, quizPrompt(rec.prompts))
  const why = rec.prompts.length === 0 ? ((await isOn($, 'record-prompts')) ? ' (no prompts recorded yet, so it asks about the session in general)' : ' (prompt recording is off, so it asks about the session in general; /cfg feature add-two.record-prompts on to draw topics from your prompts)') : ` from your last ${Math.min(6, rec.prompts.length)} prompts`

  return ok ? `Prompt filled${why}: press Enter to be quizzed.` : 'The prompt box could not be filled here.'
}

const cmdWord = async ($: Dollar, args: string): Promise<string> => {
  const { op, rest } = split(args)

  if (op === '') return showTab($, 'words')

  if (op === 'add') {
    const eq = rest.indexOf('=')
    const term = clip(eq < 0 ? rest : rest.slice(0, eq), 60)
    const def = eq < 0 ? '' : clip(rest.slice(eq + 1), 300)

    if (term === '') return 'Usage: /aeword add <term> = <definition>'
    const err = await mutate($, d => (d.words.length >= LIMITS.words ? `At most ${LIMITS.words} terms.` : { ...d, words: [...d.words.filter(w => w.term.toLowerCase() !== term.toLowerCase()), { term, def }] }))

    return err ?? `Added "${term}".`
  }

  if (op === 'del') {
    const n = parseN(rest)
    const err = await mutate($, d => (n !== undefined && n < d.words.length ? { ...d, words: removeAt(d.words, n) } : 'Usage: /aeword del <number from /aeword>'))

    return err ?? 'Deleted.'
  }

  if (op === 'suggest') {
    const rec = await read($, recA)
    const d = await read($, dataA)
    const sug = suggestTerms(rec.prompts, d.words)

    if (rec.prompts.length === 0) return (await isOn($, 'record-prompts')) ? 'No prompts recorded yet.' : 'Prompt recording is off: /cfg feature add-two.record-prompts on'

    return sug.length === 0 ? 'No repeated words found yet.' : `Candidate terms (a word-frequency heuristic, not understanding):\n${sug.map(s => `  ${s.term}  x${s.count}`).join('\n')}\nAdd one: /aeword add <term> = <definition>`
  }

  return 'Usage: /aeword [add term = definition | del n | suggest]'
}

// Component ids in tree order: the numbers shown in /aearch.
const orderIds = (d: Data): number[] => archOrderIds(d.arch).map(o => o.node.id)

const cmdArch = async ($: Dollar, args: string): Promise<string> => {
  const { op, rest } = split(args)

  if (op === '') return showTab($, 'arch')

  if (op === 'add') {
    const m = /^(\d{1,3})\s+([\s\S]+)$/.exec(rest)
    const parent = m !== null ? Number(m[1]) : 0
    const [name, nt] = pipe(m !== null ? (m[2] as string) : rest)
    const err = await mutate($, d => addArch(d, parent, name, nt))

    return err ?? showTab($, 'arch')
  }
  const n = parseN(rest.split(/\s+/)[0])

  if (op === 'del') {
    const err = await mutate($, d => (n === undefined ? 'Usage: /aearch del <number>' : removeArch(d, n + 1)))

    return err ?? showTab($, 'arch')
  }

  if (op === 'note' || op === 'rename') {
    const text = rest.replace(/^\S+\s*/, '')
    const err = await mutate($, d => {
      const target = n === undefined ? undefined : orderIds(d)[n]

      if (target === undefined) return `Usage: /aearch ${op} <number> <text>`

      if (op === 'rename' && text === '') return 'Give the new name.'

      return { ...d, arch: d.arch.map(a => (a.id === target ? (op === 'rename' ? { ...a, name: clip(text, 40) } : { ...a, note: clip(text, 60) }) : a)) }
    })

    return err ?? showTab($, 'arch')
  }

  return 'Usage: /aearch [add [parent] name | note | del n | note n text | rename n name]'
}

const cmdDecide = async ($: Dollar, args: string): Promise<string> => {
  const { op, rest } = split(args)

  if (op === '') return showTab($, 'decisions')
  const date = dayKey(await $.clock.now())

  if (op === 'add') {
    const [title, nt] = pipe(rest)

    if (title === '') return 'Usage: /aedecide add <title> | <note>'
    await mutate($, d => addDecision(d, title, nt, date))

    return showTab($, 'decisions')
  }
  const n = parseN(rest.split(/\s+/)[0])

  if (op === 'set') {
    const status = (rest.split(/\s+/)[1] ?? '').toLowerCase()
    const err = await mutate($, d =>
      n === undefined || n >= d.decisions.length || !(STATUSES as readonly string[]).includes(status)
        ? `Usage: /aedecide set <1-${d.decisions.length}> ${STATUSES.join('|')}`
        : { ...d, decisions: d.decisions.map((x, i) => (i === n ? { ...x, status } : x)) },
    )

    return err ?? showTab($, 'decisions')
  }

  if (op === 'del') {
    const err = await mutate($, d => (n !== undefined && n < d.decisions.length ? { ...d, decisions: removeAt(d.decisions, n) } : 'Usage: /aedecide del <number>'))

    return err ?? showTab($, 'decisions')
  }

  return 'Usage: /aedecide [add title | note | set n status | del n]'
}

const cmdRetro = async ($: Dollar, args: string): Promise<string> => {
  const { op, rest } = split(args)
  const key = weekKey(await $.clock.now())

  if (op === '') return showTab($, 'retro')
  const d0 = await read($, dataA)

  if (op === 'list') return Object.keys(d0.retros).length === 0 ? 'No retro notes yet.' : Object.keys(d0.retros).sort().map(k => `${k}: ${(d0.retros[k]?.well.length ?? 0)} well, ${(d0.retros[k]?.improve.length ?? 0)} improve, ${(d0.retros[k]?.actions.length ?? 0)} actions`).join('\n')
  const kinds = ['well', 'improve', 'action'] as const
  type Kind = (typeof kinds)[number]
  const isKind = (s: string): s is Kind => (kinds as readonly string[]).includes(s)

  if (isKind(op)) {
    if (rest === '') return `Usage: /aeretro ${op} <text>`
    const err = await mutate($, d =>
      editRetro(d, key, r => {
        if (op === 'action') return { ...r, actions: addItem(r.actions, rest, LIMITS.weekItems) }
        const list = op === 'well' ? r.well : r.improve
        const next = list.length >= LIMITS.weekItems ? list : [...list, clip(rest, 140)]

        return op === 'well' ? { ...r, well: next } : { ...r, improve: next }
      }),
    )

    return err ?? showTab($, 'retro')
  }

  if (op === 'tick') {
    const n = parseN(rest)
    const err = await mutate($, d => (n !== undefined && n < (d.retros[key]?.actions.length ?? 0) ? editRetro(d, key, r => ({ ...r, actions: toggleAt(r.actions, n) })) : 'Usage: /aeretro tick <action number>'))

    return err ?? showTab($, 'retro')
  }

  if (op === 'del') {
    const [kind = '', num = ''] = rest.split(/\s+/)
    const n = parseN(num)
    const err = await mutate($, d => {
      const r = d.retros[key]

      if (!isKind(kind) || n === undefined || r === undefined) return 'Usage: /aeretro del well|improve|action <number>'
      const len = kind === 'well' ? r.well.length : kind === 'improve' ? r.improve.length : r.actions.length

      if (n >= len) return 'There is no such item.'

      return editRetro(d, key, x => (kind === 'well' ? { ...x, well: removeAt(x.well, n) } : kind === 'improve' ? { ...x, improve: removeAt(x.improve, n) } : { ...x, actions: removeAt(x.actions, n) }))
    })

    return err ?? showTab($, 'retro')
  }

  return 'Usage: /aeretro [well|improve|action <text> | tick n | del kind n | list]'
}

const cmdRate = async ($: Dollar, args: string): Promise<string> => {
  const { op, rest } = split(args)

  if (op === '') return showTab($, 'ratings')
  const known = (n: string) => MODS.some(([m]) => m === n)

  if (op === 'clear') {
    const name = rest.trim().toLowerCase()

    if (!known(name)) return 'Usage: /aerate clear <mod name>'
    await mutate($, d => {
      const ratings = { ...d.ratings }
      delete ratings[name]

      return { ...d, ratings }
    })

    return `Cleared the rating of ${name}.`
  }
  const stars = Number(rest.trim())

  if (!MOD_NAME.test(op) || !known(op) || !Number.isInteger(stars) || stars < 1 || stars > 5) return 'Usage: /aerate <mod name> <1-5>   (names are listed in the Ratings tab)'
  await mutate($, d => ({ ...d, ratings: { ...d.ratings, [op]: stars } }))

  return `Rated ${op} ${stars}/5 (kept on this computer only).`
}

const cmdTheme = async ($: Dollar, args: string): Promise<string> => {
  const id = args.trim().toLowerCase()

  if (id === '') return showTab($, 'themes')
  const p = PALETTES.find(x => x.id === id)

  if (p === undefined) return `Unknown palette "${clip(id, 20)}". Choose one of: ${PALETTES.map(x => x.id).join(', ')}.`
  const cmd = paletteCommands(p)[0]

  if (cmd === undefined) return 'That palette has no command.'
  const ok = await fill($, cmd.text)

  return ok ? `Prompt filled with ${cmd.text}: press Enter to apply it with the mod that owns that theme. add-two itself applies nothing.` : `The prompt box could not be filled here. Type ${cmd.text} yourself.`
}

const cmdPack = async ($: Dollar, args: string): Promise<string> => {
  if (args.trim().toLowerCase() === 'fill') {
    const text = toText(await buildHandoff($))
    const ok = await fill($, `Here is a handoff of my session so far. Please keep it in mind and continue from it:\n\n${text}`)

    return ok ? 'Prompt filled with the handoff pack.' : 'The prompt box could not be filled here.'
  }

  return showTab($, 'handoff')
}

const cmdReset = async ($: Dollar): Promise<string> => {
  lastDocsQuery = ''
  await update($, dataA, () => emptyData())
  await update($, recA, () => emptyRec())
  await update($, viewA, v => ({ ...v, tab: 'graph', group: 'git', isBusy: false, at: 0, page: 0, isCardShown: false, repo: '', views: {}, graph: [], cheats: [] }))
  await $.store.set(STORE, null)

  return 'add-two data cleared: checklists, paths, cards, glossary, sketches, decisions, retros, ratings, and everything recorded this session.'
}

const runCommand = async ($: Dollar, name: string, args: string): Promise<string> => {
  try {
    switch (name) {
      case 'ae':
        return HELP
      case 'aepane': {
        const t = args.trim().toLowerCase()

        return ALL_TABS.includes(t) ? await showTab($, t) : t === '' ? await showTab($, (await read($, viewA)).tab) : `Unknown tab "${clip(t, 20)}". Tabs: ${ALL_TABS.join(', ')}`
      }
      case 'aedisk':
        return await showTab($, 'disk')
      case 'aegraph':
        return await showTab($, 'graph')
      case 'aepr':
        return await cmdPr($, args)
      case 'aenotes':
        return await showTab($, 'notes')
      case 'aechange':
        return await showTab($, 'change')
      case 'aeissues':
        return args.trim() === '' ? await showTab($, 'issues') : toText(await buildIssues($, args))
      case 'aedocs':
        lastDocsQuery = clip(args, 60)

        return await showTab($, 'docs')
      case 'aepath':
        return await cmdPath($, args)
      case 'aecard':
        return await cmdCard($, args)
      case 'aequiz':
        return await cmdQuiz($, args)
      case 'aeword':
        return await cmdWord($, args)
      case 'aearch':
        return await cmdArch($, args)
      case 'aedecide':
        return await cmdDecide($, args)
      case 'aeretro':
        return await cmdRetro($, args)
      case 'aepack':
        return await cmdPack($, args)
      case 'aeonboard':
        return await showTab($, 'onboard')
      case 'aecheat':
        return await showTab($, 'cheats')
      case 'aerate':
        return await cmdRate($, args)
      case 'aetheme':
        return await cmdTheme($, args)
      case 'aeshare':
        return await showTab($, 'share')
      case 'aereset':
        return await cmdReset($)
      default:
        return `Unknown add-two command: ${name}`
    }
  } catch (err) {
    if (err instanceof Off) return err.message

    return err instanceof Refused ? err.message : `add-two: ${msgOf(err)}`
  }
}

// ---------------------------------------------------------------- recording (each behind its own switch)

const keep = <T,>(list: readonly T[], item: T, max: number): T[] => [...list, item].slice(-max)

const recordPrompt = async ($: Dollar, text: string) => {
  if (!(await isOn($, 'record-prompts'))) return
  const t = clip(redact(text), 300)

  if (t === '' || t.startsWith('/')) return
  await update($, recA, r => cleanRec({ ...r, prompts: keep(r.prompts, t, LIMITS.prompts) }))
}

const recordTool = async ($: Dollar, e: Record<string, unknown>) => {
  const tool = String(e.tool ?? '')

  if (tool === 'TodoWrite') {
    if (!(await isOn($, 'record-todos')) || !Array.isArray(e.todos)) return
    const todos = (e.todos as unknown[])
      .filter((t): t is Record<string, unknown> => t !== null && typeof t === 'object')
      .map(t => ({ t: clip(t.content, 120), s: String(t.status ?? 'pending') }))
    await update($, recA, r => cleanRec({ ...r, todos }))

    return
  }

  if (!(await isOn($, 'record-edits'))) return
  const p = typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : ''

  if (p === '') return
  const cwd = await cwdOf($)
  const rel = cwd !== '' && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p
  await update($, recA, r => cleanRec({ ...r, files: [...r.files.filter(f => f !== rel), rel].slice(-LIMITS.files) }))
}

let lastToastAt = -Infinity

const dueToast = async ($: Dollar) => {
  if (!(await isOn($, 'due-toast'))) return
  const now = await $.clock.now()

  if (now - lastToastAt < 180_000) return
  const due = dueCards((await read($, dataA)).cards, dayNumber(now)).length

  if (due === 0) return
  lastToastAt = now
  await $.ui.toast(`${plural(due, 'flashcard')} due: /aecard review`, { timeoutMs: 6000 })
}

// ---------------------------------------------------------------- pane drawing

const PAD = { compact: 'xs', normal: 'sm', airy: 'md' } as const

const pageOf = <T,>(list: readonly T[], page: number): { items: T[]; pages: number; page: number } => {
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const p = Math.min(Math.max(0, page), pages - 1)

  return { items: list.slice(p * PAGE, p * PAGE + PAGE), pages, page: p }
}

const nextStatus = (s: string) => STATUSES[(STATUSES.indexOf(s as (typeof STATUSES)[number]) + 1) % STATUSES.length] as string

const pressPr = async ($: Dollar, i: number) => {
  const v = await read($, viewA)
  const key = v.repo !== '' ? v.repo : await repoKey($)
  await mutate($, d => ({ ...d, pr: { ...d.pr, [key]: toggleAt(d.pr[key] ?? defaultPr(), i) } }))
}

const pressStep = async ($: Dollar, a: number, b: number) => {
  await mutate($, d => ({ ...d, path: d.path.map((t, i) => (i === a ? { ...t, steps: toggleAt(t.steps, b) } : t)) }))
}

const pressCard = async ($: Dollar, what: 'show' | 'good' | 'again') => {
  if (what === 'show') {
    await update($, viewA, v => ({ ...v, isCardShown: true }))

    return
  }
  const today = await todayOf($)
  const cur = dueCards((await read($, dataA)).cards, today)[0]

  if (cur === undefined) return
  await mutate($, d => gradeCard(d, cur.id, what === 'good', today))
  await update($, viewA, v => ({ ...v, isCardShown: false }))
}

const pressRate = (_$: Dollar, name: string, stars: number) => mutate(_$, d => ({ ...d, ratings: { ...d.ratings, [name]: stars } }))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, , description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await loadData($).catch(() => undefined)
    await dueToast($).catch(() => undefined)

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({ text: await runCommand($, name, e.args) })).catch(() => ({ text: 'add-two hit an unexpected error.' }))
  }

  on('prompt.submit', async ($, e, next) => {
    const isUsers = e.command === undefined && e.isMeta !== true && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')

    if (isUsers) await recordPrompt($, e.text).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /^(Edit|Write|NotebookEdit|TodoWrite)$/ }, async ($, e, next) => {
    const ran = await next(e)

    if ((ran as { deny?: string }).deny === undefined) await recordTool($, e as unknown as Record<string, unknown>).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = e.surface === 'desktop' ? (ui as ElementTable<'desktop'>).Svg : undefined
    const v = await read($, viewA)
    const d = await read($, dataA)
    const rec = await read($, recA)
    const accent = (await read($, accentA)) as 'suggestion'
    const density = (await read($, densityA)) as keyof typeof PAD
    const pad = PAD[density] ?? 'sm'
    const useSvg = Svg !== undefined && (await isOn($, 'svg'))
    const tab = ALL_TABS.includes(v.tab) ? v.tab : 'graph'
    const group = groupOf(tab)
    const lines = v.views[tab] ?? []
    const today = dayNumber(await $.clock.now())
    const weekK = weekKey(await $.clock.now())

    const textBlock = (list: readonly Line[]) => (
      <Box flexDirection="column">
        {list.map(l => (
          <Text mono color={l.c}>
            {l.t === '' ? ' ' : l.t}
          </Text>
        ))}
      </Box>
    )

    const body = (): ReturnType<typeof textBlock> => {
      switch (tab) {
        case 'graph':
          return useSvg && Svg !== undefined && v.graph.length > 0 ? (
            <Box flexDirection="column" gap="sm">
              <Svg source={graphSvg(v.graph)} alt={`Git graph of ${v.graph.length} commits, newest first`} isInteractive {...svgSize(graphSvg(v.graph), Math.min(900, Math.max(360, e.props.bodyColumns * 8)))} />
              <Text dimColor size="caption">
                Lanes are assigned from the parent links of the last {v.graph.length} commits. Hover a row for its full subject.
              </Text>
            </Box>
          ) : (
            textBlock(lines)
          )
        case 'pr': {
          const key = v.repo
          const items = d.pr[key] ?? defaultPr()

          return (
            <Box flexDirection="column">
              <Text color={accent}>{`PR checklist: ${items.filter(i => i.done).length}/${items.length} done (${clip(key.split('/').pop() ?? key, 30)})`}</Text>
              {items.map((it, i) => (
                <Button key={`pr-${i}`} label={`[${it.done ? 'x' : ' '}] ${it.t}`} plain dimColor={it.done} onPress={() => { void pressPr($, i) }} />
              ))}
              <Text dimColor>Edit with /aepr add, del or clear.</Text>
            </Box>
          )
        }
        case 'cheats': {
          const pg = pageOf(v.cheats, v.page)

          return (
            <Box flexDirection="column">
              {textBlock(lines.slice(0, 1))}
              {pg.items.map((c, i) => (
                <Box key={`cheat-row-${i}`} gap="sm">
                  <Button key={`cheat-${pg.page * PAGE + i}`} label={`> ${c.cmd}`} plain onPress={() => { void fill($, c.cmd) }} />
                  <Text dimColor>{c.note !== '' ? clip(c.note, 50) : c.src}</Text>
                </Box>
              ))}
              {pg.pages > 1 && (
                <Box gap="sm">
                  <Button key="cheat-prev" label="prev" plain dimColor onPress={() => { void update($, viewA, x => ({ ...x, page: Math.max(0, pg.page - 1) })) }} />
                  <Text dimColor>{`page ${pg.page + 1}/${pg.pages}`}</Text>
                  <Button key="cheat-next" label="next" plain dimColor onPress={() => { void update($, viewA, x => ({ ...x, page: Math.min(pg.pages - 1, pg.page + 1) })) }} />
                </Box>
              )}
              <Text dimColor>A button copies the command into the prompt box; nothing is run.</Text>
            </Box>
          )
        }
        case 'handoff':
          return (
            <Box flexDirection="column" gap="sm">
              {textBlock(lines)}
              <Button key="pack-fill" label="Fill the prompt with this pack" plain onPress={() => { void cmdPack($, 'fill') }} />
            </Box>
          )
        case 'path': {
          return (
            <Box flexDirection="column">
              {d.path.length === 0 && textBlock(pathLines(d.path))}
              {d.path.map((t, i) => (
                <Box key={`topic-${i}`} flexDirection="column">
                  <Text color={accent}>{`${i + 1}. ${t.title}  ${t.steps.filter(s => s.done).length}/${t.steps.length}`}</Text>
                  {t.steps.map((s, k) => (
                    <Button key={`step-${i}-${k}`} label={`  [${s.done ? 'x' : ' '}] ${s.t}`} plain dimColor={s.done} onPress={() => { void pressStep($, i, k) }} />
                  ))}
                </Box>
              ))}
              <Text dimColor>Add with /aepath add and /aepath step.</Text>
            </Box>
          )
        }
        case 'cards': {
          const due = dueCards(d.cards, today)
          const cur = due[0]

          return (
            <Box flexDirection="column" gap="sm">
              {textBlock(cardSummary(d, today))}
              {cur === undefined ? (
                <Text dimColor>{d.cards.length === 0 ? 'No cards yet: /aecard add <front> | <back>' : 'Nothing due today.'}</Text>
              ) : (
                <Box flexDirection="column" gap="sm">
                  <Text weight="bold">{cur.front}</Text>
                  {v.isCardShown ? <Text color="success">{cur.back}</Text> : <Text dimColor>(back hidden)</Text>}
                  <Box gap="sm">
                    {!v.isCardShown && <Button key="card-show" label="Show answer" onPress={() => { void pressCard($, 'show') }} />}
                    {v.isCardShown && <Button key="card-good" label="Good" onPress={() => { void pressCard($, 'good') }} />}
                    {v.isCardShown && <Button key="card-again" label="Again" onPress={() => { void pressCard($, 'again') }} />}
                  </Box>
                </Box>
              )}
            </Box>
          )
        }
        case 'quiz':
          return (
            <Box flexDirection="column" gap="sm">
              {textBlock(lines.length > 0 ? lines : [note(`Quiz: ${plural(d.qnotes.length, 'saved answer')}; ${plural(rec.prompts.length, 'recorded prompt')}`, 'suggestion'), ...d.qnotes.map((q, i) => note(`${i + 1}. Q: ${q.q}  A: ${q.a}`))])}
              <Button key="quiz-fill" label="Fill a 3-question quiz prompt" plain onPress={() => { void cmdQuiz($, '') }} />
            </Box>
          )
        case 'words': {
          const sug = suggestTerms(rec.prompts, d.words)

          return (
            <Box flexDirection="column" gap="sm">
              {textBlock(wordLines(d.words))}
              <Text color={accent}>{`Suggested terms (word-frequency heuristic${rec.prompts.length === 0 ? '; needs record-prompts' : ''})`}</Text>
              {sug.length === 0 && <Text dimColor>None yet.</Text>}
              <Box gap="sm" flexWrap="wrap">
                {sug.slice(0, 10).map(s => (
                  <Button key={`sug-${s.term}`} label={`+ ${s.term} x${s.count}`} plain onPress={() => { void mutate($, x => ({ ...x, words: [...x.words, { term: s.term, def: '' }] })) }} />
                ))}
              </Box>
            </Box>
          )
        }
        case 'arch':
          return useSvg && Svg !== undefined && d.arch.length > 0 ? (
            <Box flexDirection="column" gap="sm">
              <Svg source={archSvg(d.arch)} alt={`Architecture sketch with ${d.arch.length} components`} isInteractive {...svgSize(archSvg(d.arch), Math.min(900, Math.max(360, e.props.bodyColumns * 8)))} />
              {textBlock(archLines(d.arch))}
            </Box>
          ) : (
            textBlock(archLines(d.arch))
          )
        case 'decisions': {
          const pg = pageOf(d.decisions.map((x, i) => ({ x, i })).reverse(), v.page)

          return (
            <Box flexDirection="column">
              {d.decisions.length === 0 && textBlock(decisionLines([]))}
              {pg.items.map(({ x, i }) => (
                <Box key={`dec-row-${i}`} gap="sm">
                  <Button key={`dec-${i}`} label={`[${x.status}]`} plain onPress={() => { void mutate($, y => ({ ...y, decisions: y.decisions.map((z, k) => (k === i ? { ...z, status: nextStatus(z.status) } : z)) })) }} />
                  <Text>{`${i + 1}. ${x.date} ${x.title}`}</Text>
                </Box>
              ))}
              {pg.pages > 1 && (
                <Box gap="sm">
                  <Button key="dec-prev" label="prev" plain dimColor onPress={() => { void update($, viewA, y => ({ ...y, page: Math.max(0, pg.page - 1) })) }} />
                  <Text dimColor>{`page ${pg.page + 1}/${pg.pages}`}</Text>
                  <Button key="dec-next" label="next" plain dimColor onPress={() => { void update($, viewA, y => ({ ...y, page: Math.min(pg.pages - 1, pg.page + 1) })) }} />
                </Box>
              )}
              <Text dimColor>A status button cycles proposed, accepted, rejected, superseded.</Text>
            </Box>
          )
        }
        case 'retro': {
          const r = d.retros[weekK]

          return (
            <Box flexDirection="column">
              {textBlock(retroLines(weekK, r).slice(0, -1))}
              {(r?.actions ?? []).map((a, i) => (
                <Button key={`ract-${i}`} label={`  tick action ${i + 1}: [${a.done ? 'x' : ' '}] ${a.t}`} plain dimColor={a.done} onPress={() => { void mutate($, y => editRetro(y, weekK, z => ({ ...z, actions: toggleAt(z.actions, i) }))) }} />
              ))}
              <Text dimColor>/aeretro well|improve|action &lt;text&gt; adds an item.</Text>
            </Box>
          )
        }
        case 'ratings': {
          const pg = pageOf(MODS, v.page)

          return (
            <Box flexDirection="column">
              <Text color={accent}>{`Mod ratings (local only): ${Object.keys(d.ratings).length} of ${MODS.length} rated`}</Text>
              {pg.items.map(([name, desc]) => (
                <Box key={`rate-row-${name}`} flexDirection="column">
                  <Box gap="sm">
                    <Text weight="bold">{name}</Text>
                    <Text dimColor>{clip(desc, 56)}</Text>
                  </Box>
                  <Box gap="xs">
                    {[1, 2, 3, 4, 5].map(n => (
                      <Button key={`rate-${name}-${n}`} label={(d.ratings[name] ?? 0) >= n ? '★' : '☆'} plain onPress={() => { void pressRate($, name, n) }} />
                    ))}
                  </Box>
                </Box>
              ))}
              <Box gap="sm">
                <Button key="rate-prev" label="prev" plain dimColor onPress={() => { void update($, viewA, y => ({ ...y, page: Math.max(0, pg.page - 1) })) }} />
                <Text dimColor>{`page ${pg.page + 1}/${pg.pages}`}</Text>
                <Button key="rate-next" label="next" plain dimColor onPress={() => { void update($, viewA, y => ({ ...y, page: Math.min(pg.pages - 1, pg.page + 1) })) }} />
              </Box>
            </Box>
          )
        }
        case 'themes':
          return (
            <Box flexDirection="column" gap="sm">
              <Text color={accent}>Theme gallery: previews from raw hex values. Nothing is applied from here.</Text>
              {PALETTES.map(p => (
                <Box key={`pal-${p.id}`} flexDirection="column">
                  <Box gap="sm">
                    <Box>
                      {p.sw.map((hex, i) => (
                        <Box key={`sw-${p.id}-${i}`} backgroundColor={hex}>
                          <Text color={hex}>{'    '}</Text>
                        </Box>
                      ))}
                    </Box>
                    <Text weight="bold">{p.label}</Text>
                    <Text dimColor>{p.blurb}</Text>
                  </Box>
                  <Box gap="sm">
                    {paletteCommands(p).map(c => (
                      <Button key={`pal-${p.id}-${c.text}`} label={c.label} plain onPress={() => { void fill($, c.text) }} />
                    ))}
                  </Box>
                </Box>
              ))}
              <Text dimColor>A button fills the prompt box with the command of the mod that owns the theme. It does nothing if that mod is not installed.</Text>
            </Box>
          )
        default:
          return textBlock(lines)
      }
    }

    const tabs = TABS[group]

    return (
      <Box flexDirection="column" padding={pad} gap={pad}>
        <Box gap="sm">
          {GROUPS.map(([g, label]) => (
            <Button key={`group-${g}`} label={label} plain dimColor={group !== g} onPress={() => { void pressTab($, TABS[g][0] as string) }} />
          ))}
        </Box>
        <Box gap="sm">
          {tabs.map(t => (
            <Button key={`tab-${t}`} label={TAB_LABEL[t] ?? t} plain dimColor={tab !== t} onPress={() => { void pressTab($, t) }} />
          ))}
          <Button key="refresh" label="refresh" plain dimColor onPress={() => { void refreshTab($, tab) }} />
        </Box>
        {v.isBusy && <Text dimColor>Reading…</Text>}
        {!v.isBusy && lines.length === 0 && ['graph', 'notes', 'change', 'issues', 'disk', 'docs', 'onboard', 'cheats', 'handoff'].includes(tab) && v.graph.length === 0 && (
          <Text dimColor>{tab === 'disk' ? 'Press refresh to measure this folder (du -sk, 20 s limit).' : 'Nothing read yet: press refresh, or run the command for this tab.'}</Text>
        )}
        {body()}
        <Text dimColor size="caption">Read-only on your project. Everything you write here is kept on this computer; /aereset clears it.</Text>
      </Box>
    )
  })

}
