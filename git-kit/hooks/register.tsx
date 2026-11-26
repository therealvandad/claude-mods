import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { CheckItem, Line, ReleaseState, TestState, ViewState } from '../types'
import { GIT_ENV, GitRefused, gitArgv } from './guard'
import {
  addItem,
  analyzeBranches,
  analyzeStyle,
  blameLines,
  branchStyleLines,
  changelogLines,
  checklistLines,
  defaultChecklist,
  fmtAge,
  fmtBytes,
  groupChanges,
  healthLines,
  hookLines,
  ignoreLines,
  ignoreSuggestions,
  isSafeRef,
  isTestCommand,
  largeFiles,
  lines as splitLines,
  mergeEntries,
  mergeLines,
  msgPrompt,
  nextVersion,
  parseBlame,
  parseBranchRefs,
  parseDiffCheck,
  parseLogLines,
  parseNumstat,
  parseRefs,
  parseSemver,
  parseStashList,
  parseStatus,
  parseSubmodules,
  parseTouches,
  parseTrivialMerge,
  parseWorktrees,
  pickBase,
  pickFixupTarget,
  plural,
  prPrompt,
  readiness,
  readinessLines,
  removeItem,
  splitLines as splitText,
  statLines,
  statusLines,
  styleLines,
  submoduleLines,
  suggestBranches,
  suggestBump,
  testStatus,
  toastAllowed,
  toastMark,
  toggleItem,
  toText,
  totalsOf,
  trunc,
  watchCandidates,
  worktreeLines,
} from './parse'
import type { LogEntry, SizedFile, ToastGate } from './parse'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'git-kit-main'
const TABS = ['status', 'health', 'stash', 'trees', 'release', 'ready'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = { status: 'Status', health: 'Health', stash: 'Stash', trees: 'Trees', release: 'Release', ready: 'Ready' }

const viewA = atom({ plugin: 'git-kit', key: 'view' } as const, { tab: 'status', isBusy: false, at: 0, note: '', views: {} } as ViewState, { shape: 'view-1' })
const releaseA = atom({ plugin: 'git-kit', key: 'release' } as const, { repo: '', items: [] } as ReleaseState, { shape: 'release-1' })
const testsA = atom({ plugin: 'git-kit', key: 'tests' } as const, { lastPassAt: 0, lastFailAt: 0, lastCmd: '', editAt: 0 } as TestState, { shape: 'tests-1' })

const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['gk', '/gk', 'List every git-kit command'],
  ['gkmsg', '/gkmsg', 'Learn this repo\'s commit-message style and fill a prompt asking Claude to follow it'],
  ['gkbranch', '/gkbranch <task>', 'Suggest branch names that match the existing naming'],
  ['gkpr', '/gkpr [base]', 'Fill a prompt to draft a PR description from the diff stat and commits since the base'],
  ['gklog', '/gklog', 'Changelog from commit subjects since the last tag'],
  ['gkstatus', '/gkstatus', 'Staged / unstaged / untracked map of every file (pane tab)'],
  ['gkmerge', '/gkmerge [branch]', 'Preview merge conflicts with a read-only merge-tree'],
  ['gkstash', '/gkstash', 'Browse stashes with their stat (pane tab)'],
  ['gktag', '/gktag', 'Suggest the next version from commit prefixes since the last tag'],
  ['gkignore', '/gkignore [fill]', 'Untracked files that look like build output or secrets; "fill" asks Claude to update .gitignore'],
  ['gklarge', '/gklarge [on|off|<MB>|now]', 'Large-file watcher: toast when a changed file passes the threshold'],
  ['gkblame', '/gkblame <file>', 'Who wrote a file: authors by lines (size capped)'],
  ['gksplit', '/gksplit', 'Propose how to split the changed files into commits (text only)'],
  ['gkfixup', '/gkfixup [file...]', 'Which recent commit last touched a file (or your staged files)'],
  ['gkrelease', '/gkrelease [tick n|add text|del n|clear]', 'Per-repo release checklist you can tick (pane tab)'],
  ['gkhealth', '/gkhealth', 'Repo health card: branch ages, stale and merged branches, big files (pane tab)'],
  ['gksub', '/gksub', 'Submodule status'],
  ['gkhooks', '/gkhooks', 'List the git hook files that exist (never runs them)'],
  ['gkremote', '/gkremote [on|off|now]', 'Toast when you are ahead of upstream after a turn (max one per 10 min)'],
  ['gktree', '/gktree', 'Worktrees, submodules and hooks in one tab'],
  ['gkready', '/gkready', 'Merge-readiness score: tests seen passing, clean tree, no conflict markers (pane tab)'],
  ['gkreset', '/gkreset', 'Clear everything git-kit recorded'],
]

const HELP = [
  'git-kit: read-only git helpers. Nothing here writes to the repo or talks to a remote.',
  ...COMMANDS.map(([, usage, desc]) => `${usage.padEnd(40)} ${desc}`),
  '',
  `The pane "${PANE}" has tabs: ${TABS.map(t => TAB_LABEL[t]).join(', ')}.`,
].join('\n')

type Settings = { large: { on: boolean; mb: number }; remote: { on: boolean } }
const DEFAULTS: Settings = { large: { on: true, mb: 10 }, remote: { on: true } }
let settings: Settings = { large: { ...DEFAULTS.large }, remote: { ...DEFAULTS.remote } }
let gate: ToastGate = { lastAny: -Infinity, last: {} }
let noRepoUntil = 0
const seenLarge = new Set<string>()

// ---------------------------------------------------------------- the git wrapper

type Git = { code: number; out: string; err: string }

// Every git call in this mod goes through here; `gitArgv` throws for anything not on the read-only allowlist.
const git = async ($: Dollar, args: string[], timeoutMs = 15_000): Promise<Git> => {
  const argv = gitArgv(args)
  const r = await $.process.run(argv, { env: GIT_ENV, timeoutMs })

  return { code: r.exitCode, out: r.stdout, err: r.stderr }
}

const firstLine = (s: string) => s.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
const note = (t: string, c?: Line['c']): Line => (c ? { t, c } : { t })
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Repo = { ok: true; root: string } | { ok: false; text: string }

const repoOf = async ($: Dollar): Promise<Repo> => {
  let r: Git

  try {
    r = await git($, ['rev-parse', '--show-toplevel'])
  } catch (err) {
    if (err instanceof GitRefused) throw err

    return { ok: false, text: `git could not be run here: ${msgOf(err)}` }
  }

  if (r.code !== 0) {
    return {
      ok: false,
      text: /not a git repository/i.test(r.err) ? 'This folder is not a git repository, so there is nothing for git-kit to read. Start a session inside a repo.' : `git could not read this folder: ${firstLine(r.err) || 'unknown error'}`,
    }
  }

  return { ok: true, root: r.out.trim() }
}

const currentBranch = async ($: Dollar): Promise<string> => {
  const r = await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])

  return r.code === 0 ? r.out.trim() : ''
}

const allBranches = async ($: Dollar): Promise<string[]> => {
  const r = await git($, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])

  return r.code === 0 ? parseBranchRefs(r.out) : []
}

const baseOf = async ($: Dollar, current: string): Promise<string | undefined> => {
  const head = await git($, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])

  return pickBase(await allBranches($), current, head.code === 0 ? head.out : undefined)
}

const statSizes = async ($: Dollar, root: string, paths: readonly string[]): Promise<SizedFile[]> => {
  const out: SizedFile[] = []

  for (let i = 0; i < paths.length; i += 20) {
    const batch = await Promise.all(
      paths.slice(i, i + 20).map(async p => {
        try {
          const s = await $.fs.stat(`${root}/${p}`)

          return s.kind === 'file' ? { path: p, size: s.size } : undefined
        } catch {
          return undefined
        }
      }),
    )

    for (const b of batch) if (b) out.push(b)
  }

  return out
}

// ---------------------------------------------------------------- stored state

const loadSettings = async ($: Dollar) => {
  const saved = (await $.store.get('git-kit:settings').catch(() => undefined)) as Partial<Settings> | undefined
  const mb = Number(saved?.large?.mb)

  settings = {
    large: { on: saved?.large?.on !== false, mb: Number.isFinite(mb) && mb > 0 ? mb : DEFAULTS.large.mb },
    remote: { on: saved?.remote?.on !== false },
  }
}

const saveSettings = ($: Dollar) => $.store.set('git-kit:settings', settings)

const releaseMap = async ($: Dollar): Promise<Record<string, CheckItem[]>> => {
  const raw = await $.store.get('git-kit:release').catch(() => undefined)

  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, CheckItem[]>) : {}
}

const loadRelease = async ($: Dollar, root: string): Promise<CheckItem[]> => {
  const m = await releaseMap($)
  const items = m[root]

  return Array.isArray(items) && items.length > 0 ? items.filter(i => typeof i?.t === 'string').map(i => ({ t: i.t, done: i.done === true })) : defaultChecklist()
}

const saveRelease = async ($: Dollar, root: string, items: CheckItem[]) => {
  const m = await releaseMap($)
  delete m[root]
  const keys = Object.keys(m).slice(-9)
  const next: Record<string, CheckItem[]> = {}

  for (const k of keys) next[k] = m[k] as CheckItem[]
  next[root] = items
  await $.store.set('git-kit:release', next)
  await update($, releaseA, () => ({ repo: root, items }))
}

// ---------------------------------------------------------------- tab builders (each returns lines)

const noRepo = (text: string): Line[] => [note(text, 'warning')]

const buildStatus = async ($: Dollar): Promise<Line[]> => {
  const repo = await repoOf($)

  if (!repo.ok) return noRepo(repo.text)
  const r = await git($, ['status', '--porcelain=v1', '-b'])

  return r.code === 0 ? statusLines(parseStatus(r.out)) : [note(`git status failed: ${firstLine(r.err)}`, 'error')]
}

const buildHealth = async ($: Dollar): Promise<Line[]> => {
  const repo = await repoOf($)

  if (!repo.ok) return noRepo(repo.text)
  const refs = await git($, ['for-each-ref', '--format=%(refname:short)%09%(committerdate:unix)%09%(upstream:short)%09%(upstream:track)%09%(HEAD)', 'refs/heads'])

  if (refs.code !== 0) return [note(`git for-each-ref failed: ${firstLine(refs.err)}`, 'error')]
  const branches = parseRefs(refs.out)
  const cur = branches.find(b => b.isCurrent)?.name ?? ''
  const base = await baseOf($, '')
  let merged: string[] = []

  if (base !== undefined) {
    const m = await git($, ['branch', '--merged', base, '--format=%(refname:short)'])
    merged = m.code === 0 ? splitLines(m.out) : []
  }
  const tracked = await git($, ['ls-files', '-z'])
  const paths = tracked.code === 0 ? tracked.out.split('\0').filter(Boolean).slice(0, 600) : []
  const sized = await statSizes($, repo.root, paths)
  const now = await $.clock.now()

  return healthLines({ branches, merged, base, nowSec: Math.floor(now / 1000), big: largeFiles(sized, 1024 * 1024), sampled: paths.length })
}

const buildStash = async ($: Dollar): Promise<Line[]> => {
  const repo = await repoOf($)

  if (!repo.ok) return noRepo(repo.text)
  const r = await git($, ['stash', 'list', '--format=%gd%x09%ct%x09%s'])

  if (r.code !== 0) return [note(`git stash list failed: ${firstLine(r.err)}`, 'error')]
  const rows = parseStashList(r.out)

  if (rows.length === 0) return [note('No stashes.', 'success')]
  const nowSec = Math.floor((await $.clock.now()) / 1000)
  const out: Line[] = [note(`Stashes (${rows.length})`, 'suggestion')]

  for (const row of rows.slice(0, 8)) {
    out.push(note(''), note(`${row.ref}  ${fmtAge(row.ts, nowSec)}  ${trunc(row.subject, 70)}`))
    const s = await git($, ['stash', 'show', '--stat', row.ref])

    for (const l of splitLines(s.out).slice(0, 7)) out.push(note(`  ${trunc(l, 90)}`, 'inactive'))
  }

  if (rows.length > 8) out.push(note(`… ${rows.length - 8} more stashes`, 'inactive'))

  return out
}

const hooksDir = async ($: Dollar, root: string): Promise<{ dir: string; source: string } | undefined> => {
  const cfg = await git($, ['config', '--get', 'core.hooksPath'])
  const path = cfg.out.trim()

  if (cfg.code === 0 && path !== '') return { dir: path.startsWith('/') ? path : `${root}/${path}`, source: 'core.hooksPath' }
  const common = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const gd = common.out.trim()

  if (common.code === 0 && gd.startsWith('/')) return { dir: `${gd}/hooks`, source: 'default location' }

  return { dir: `${root}/.git/hooks`, source: 'default location' }
}

const buildHooks = async ($: Dollar, root: string): Promise<Line[]> => {
  const h = await hooksDir($, root)

  if (!h) return [note('Could not locate the hooks folder.', 'warning')]

  try {
    const entries = await $.fs.list(h.dir)

    return hookLines(h.dir, entries.filter(e => e.kind === 'file').map(e => ({ name: e.name, size: e.size })), h.source)
  } catch {
    return [note(`No hooks folder at ${h.dir}.`, 'subtle')]
  }
}

const buildSubmodules = async ($: Dollar): Promise<Line[]> => {
  const r = await git($, ['submodule', 'status'])

  return r.code === 0 ? submoduleLines(parseSubmodules(r.out)) : [note(`git submodule status failed: ${firstLine(r.err)}`, 'error')]
}

const buildWorktrees = async ($: Dollar): Promise<Line[]> => {
  const r = await git($, ['worktree', 'list', '--porcelain'])

  return r.code === 0 ? worktreeLines(parseWorktrees(r.out)) : [note(`git worktree list failed: ${firstLine(r.err)}`, 'error')]
}

const buildTrees = async ($: Dollar): Promise<Line[]> => {
  const repo = await repoOf($)

  if (!repo.ok) return noRepo(repo.text)

  return [...(await buildWorktrees($)), note(''), ...(await buildSubmodules($)), note(''), ...(await buildHooks($, repo.root))]
}

const buildRelease = async ($: Dollar): Promise<Line[]> => {
  const repo = await repoOf($)

  if (!repo.ok) return noRepo(repo.text)
  const items = await loadRelease($, repo.root)
  await update($, releaseA, () => ({ repo: repo.root, items }))

  return checklistLines(items)
}

const buildReady = async ($: Dollar): Promise<Line[]> => {
  const repo = await repoOf($)

  if (!repo.ok) return noRepo(repo.text)
  const s = await git($, ['status', '--porcelain=v1', '-b'])

  if (s.code !== 0) return [note(`git status failed: ${firstLine(s.err)}`, 'error')]
  const info = parseStatus(s.out)
  const worktree = await git($, ['diff', '--check'])
  const staged = await git($, ['diff', '--check', '--cached'])
  const check = parseDiffCheck([...new Set(`${worktree.out}\n${staged.out}`.split('\n'))].join('\n'))
  const dirty = info.entries.filter(e => e.kind !== 'untracked' && e.kind !== 'ignored').length
  const r = readiness({
    tests: testStatus(await read($, testsA)),
    dirty,
    untracked: info.entries.filter(e => e.kind === 'untracked').length,
    conflicts: info.entries.filter(e => e.kind === 'conflict').length,
    markers: check.markers,
    behind: info.behind,
  })
  const out = readinessLines(r)

  if (check.markers > 0) out.push(note(`Conflict markers in: ${check.files.slice(0, 5).join(', ')}`, 'error'))

  if (check.whitespace > 0) out.push(note(`${plural(check.whitespace, 'whitespace warning')} from git diff --check (not scored)`, 'inactive'))

  return out
}

const build = ($: Dollar, tab: Tab): Promise<Line[]> => {
  switch (tab) {
    case 'health':
      return buildHealth($)
    case 'stash':
      return buildStash($)
    case 'trees':
      return buildTrees($)
    case 'release':
      return buildRelease($)
    case 'ready':
      return buildReady($)
    default:
      return buildStatus($)
  }
}

// ---------------------------------------------------------------- the pane

const setBusy = ($: Dollar, isBusy: boolean) => update($, viewA, v => ({ ...v, isBusy }))

const refreshTab = async ($: Dollar, tab: Tab) => {
  await setBusy($, true)
  let built: Line[]

  try {
    built = await build($, tab)
  } catch (err) {
    built = [note(`Could not read git: ${msgOf(err)}`, 'error')]
  }
  const now = await $.clock.now()
  await update($, viewA, v => ({ ...v, tab, isBusy: false, at: now, views: { ...v.views, [tab]: built.slice(0, 200) } }))

  return built
}

const pressTab = async ($: Dollar, tab: Tab) => {
  await update($, viewA, v => ({ ...v, tab }))
  await refreshTab($, tab)
}

const pressItem = async ($: Dollar, index: number) => {
  const rel = await read($, releaseA)

  if (rel.repo === '') return
  await saveRelease($, rel.repo, toggleItem(rel.items, index))
  await refreshTab($, 'release')
}

const showTab = async ($: Dollar, tab: Tab): Promise<string> => {
  await update($, viewA, v => ({ ...v, tab }))
  const opened = await $.ui.open({ id: PANE, title: 'git-kit' }).catch(() => undefined)
  const built = await refreshTab($, tab)
  const text = toText(built)

  return opened?.isPlaced === false ? `${text}\n\n(No pane could be shown here, so the tab is printed above.)` : text
}

// ---------------------------------------------------------------- commands

const withRepo = async ($: Dollar, fn: (root: string) => Promise<string>): Promise<string> => {
  const repo = await repoOf($)

  return repo.ok ? fn(repo.root) : repo.text
}

const fill = async ($: Dollar, text: string): Promise<boolean> => {
  const r = await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)

  return r?.isFilled === true
}

const cmdMsg = ($: Dollar) =>
  withRepo($, async () => {
    const r = await git($, ['log', '--max-count=30', '--no-merges', '--format=%s'])

    if (r.code !== 0) return /does not have any commits|bad default revision|unknown revision/i.test(r.err) ? 'This repository has no commits yet, so there is no style to learn.' : `git log failed: ${firstLine(r.err)}`
    const style = analyzeStyle(splitLines(r.out))

    if (style === null) return 'No commits to learn from yet.'
    const st = await git($, ['status', '--porcelain=v1'])
    const hasStaged = parseStatus(st.out).entries.some(e => e.kind === 'staged' || e.kind === 'both')
    const ok = await fill($, msgPrompt(style, hasStaged))

    return `${styleLines(style).join('\n')}\n\n${ok ? 'Prompt filled: press Enter to ask Claude for a message in this style.' : 'The prompt box could not be filled here.'}`
  })

const cmdBranch = ($: Dollar, task: string) =>
  withRepo($, async () => {
    const style = analyzeBranches(await allBranches($))
    const out = branchStyleLines(style)
    const names = suggestBranches(task, style)

    if (task.trim() === '') return `${out.join('\n')}\n\nUsage: /gkbranch <task description>`

    if (names.length === 0) return `${out.join('\n')}\n\nCould not make a name from that description.`

    return `${out.join('\n')}\n\nSuggested names for "${trunc(task.trim(), 60)}":\n${names.map(n => `  ${n}`).join('\n')}\n(Names only: no branch was created.)`
  })

const cmdPr = ($: Dollar, arg: string) =>
  withRepo($, async () => {
    const current = await currentBranch($)
    const wanted = arg.trim()

    if (wanted !== '' && !isSafeRef(wanted)) return `"${trunc(wanted, 40)}" does not look like a branch name.`
    const base = wanted !== '' ? wanted : await baseOf($, current)

    if (base === undefined) return 'Could not find a base branch (main, master, develop or trunk). Pass one: /gkpr <base>'
    const log = await git($, ['log', '--max-count=100', '--no-merges', '--format=%h %s', `${base}..HEAD`])

    if (log.code !== 0) return `git log ${base}..HEAD failed: ${firstLine(log.err)}`
    const commits = splitLines(log.out)

    if (commits.length === 0) return `No commits on ${current || 'HEAD'} beyond ${base}: nothing to describe.`
    const ns = await git($, ['diff', '--numstat', `${base}...HEAD`])
    const files = parseNumstat(ns.out)
    const ok = await fill($, prPrompt({ branch: current || 'HEAD', base, commits, files }))
    const t = totalsOf(files)

    return `${plural(commits.length, 'commit')} and ${plural(t.files, 'file')} (+${t.add} -${t.del}) on ${current || 'HEAD'} since ${base}.\n${ok ? 'Prompt filled: press Enter to have Claude write the description.' : 'The prompt box could not be filled here.'}`
  })

const lastTag = async ($: Dollar): Promise<string | undefined> => {
  const r = await git($, ['tag', '--list', '--merged', 'HEAD', '--sort=-v:refname'])

  if (r.code !== 0) return undefined
  const tags = splitLines(r.out)

  return tags.find(t => parseSemver(t) !== null && parseSemver(t)?.pre === undefined) ?? tags.find(t => parseSemver(t) !== null) ?? tags[0]
}

const sinceTag = async ($: Dollar, tag: string | undefined): Promise<LogEntry[]> => {
  const r = await git($, ['log', '--max-count=300', '--no-merges', '--format=%h%x09%s', ...(tag ? [`${tag}..HEAD`] : [])])

  return r.code === 0 ? parseLogLines(r.out) : []
}

const cmdLog = ($: Dollar) =>
  withRepo($, async root => {
    const tag = await lastTag($)
    const fresh = await sinceTag($, tag)
    const all = ((await $.store.get('git-kit:log').catch(() => undefined)) ?? {}) as Record<string, { since: string; entries: LogEntry[] }>
    const prior = all[root]
    const old = prior && prior.since === (tag ?? '') ? prior.entries : []
    const entries = mergeEntries(old, fresh)
    const keys = Object.keys(all).filter(k => k !== root).slice(-7)
    const next: Record<string, { since: string; entries: LogEntry[] }> = {}

    for (const k of keys) next[k] = all[k] as { since: string; entries: LogEntry[] }
    next[root] = { since: tag ?? '', entries }
    await $.store.set('git-kit:log', next)
    const kept = entries.length - fresh.length

    return `${changelogLines(entries.slice().reverse(), tag).join('\n')}${kept > 0 ? `\n\n(${plural(kept, 'entry', 'entries')} remembered from earlier looks that are no longer in the log.)` : ''}`
  })

const cmdMerge = ($: Dollar, arg: string) =>
  withRepo($, async () => {
    const current = await currentBranch($)
    const wanted = arg.trim()

    if (wanted !== '' && !isSafeRef(wanted)) return `"${trunc(wanted, 40)}" does not look like a branch name.`
    const target = wanted !== '' ? wanted : await baseOf($, current)

    if (target === undefined) return 'Could not find a branch to preview merging with. Pass one: /gkmerge <branch>'
    const mb = await git($, ['merge-base', 'HEAD', target])

    if (mb.code !== 0) return `Skipped: no common ancestor between HEAD and ${target} (${firstLine(mb.err) || 'merge-base found nothing'}).`
    const mt = await git($, ['merge-tree', '--trivial-merge', mb.out.trim(), 'HEAD', target])

    if (mt.code !== 0) return `Skipped: this git cannot do a read-only merge preview (merge-tree --trivial-merge needs git 2.38 or newer): ${firstLine(mt.err) || `exit ${mt.code}`}`

    return toText(mergeLines(parseTrivialMerge(mt.out), current || 'HEAD', target))
  })

const cmdTag = ($: Dollar) =>
  withRepo($, async () => {
    const tag = await lastTag($)
    const fresh = await sinceTag($, tag)

    if (fresh.length === 0) return `No commits since ${tag ?? 'the start'}: nothing to release.`
    const s = suggestBump(fresh.map(e => e.subject))
    const v = nextVersion(tag, s.bump)

    if (v === null) return tag !== undefined && parseSemver(tag) === null ? `The last tag "${tag}" is not a semantic version, so no next version can be suggested.` : 'No release-worthy commits found.'
    const c = s.counts

    return [
      `Last tag: ${tag ?? '(none)'}  |  ${plural(fresh.length, 'commit')} since`,
      `Commits: ${c.breaking ?? 0} breaking, ${c.feat ?? 0} feat, ${c.fix ?? 0} fix/perf, ${c.other ?? 0} other`,
      ...s.reasons.map(r => `  ${r}`),
      `Suggested bump: ${s.bump}  ->  ${v.version}${v.note ? `  (${v.note})` : ''}`,
      'Only a suggestion: no tag was created.',
    ].join('\n')
  })

const cmdIgnore = ($: Dollar, arg: string) =>
  withRepo($, async () => {
    const r = await git($, ['status', '--porcelain=v1', '-unormal'])

    if (r.code !== 0) return `git status failed: ${firstLine(r.err)}`
    const untracked = parseStatus(r.out).entries.filter(e => e.kind === 'untracked').map(e => e.path)
    const sug = ignoreSuggestions(untracked)
    const text = toText(ignoreLines(sug, untracked.length))

    if (arg.trim() === 'fill' && sug.length > 0) {
      const ok = await fill($, `Please add these entries to .gitignore (create it if missing, keep existing entries, do not touch tracked files):\n${sug.map(s => `- ${s.pattern}  (${s.why}; e.g. ${s.examples[0]})`).join('\n')}\nIf any listed file is a real secret, tell me before doing anything else.`)

      return `${text}\n${ok ? 'Prompt filled.' : 'The prompt box could not be filled here.'}`
    }

    return text
  })

const scanLarge = async ($: Dollar, root: string, paths: string[], mb: number) => largeFiles(await statSizes($, root, paths), mb * 1024 * 1024)

const cmdLarge = async ($: Dollar, arg: string): Promise<string> => {
  const a = arg.trim().toLowerCase()
  const state = () => `Large-file watcher is ${settings.large.on ? 'on' : 'off'}, threshold ${settings.large.mb} MB.`

  if (a === 'on' || a === 'off') {
    settings = { ...settings, large: { ...settings.large, on: a === 'on' } }
    await saveSettings($)

    return state()
  }

  if (a !== '' && a !== 'now') {
    const mb = Number(a.replace(/mb$/, ''))

    if (!Number.isFinite(mb) || mb <= 0 || mb > 100_000) return 'Usage: /gklarge [on|off|<MB>|now]'
    settings = { ...settings, large: { ...settings.large, mb } }
    await saveSettings($)

    return state()
  }

  return withRepo($, async root => {
    const r = await git($, ['status', '--porcelain=v1', '-uall'], 20_000)

    if (r.code !== 0) return `git status failed: ${firstLine(r.err)}`
    const cand = watchCandidates(parseStatus(r.out))
    const big = await scanLarge($, root, cand, settings.large.mb)

    return [state(), big.length === 0 ? `No changed or untracked file (of ${cand.length} checked) is over the threshold.` : `${plural(big.length, 'file')} over ${settings.large.mb} MB:`, ...big.slice(0, 10).map(f => `  ${fmtBytes(f.size).padStart(9)}  ${f.path}`)].join('\n')
  })
}

const BLAME_CAP = 300_000

const cmdBlame = ($: Dollar, arg: string) =>
  withRepo($, async root => {
    const file = arg.trim()

    if (file === '') return 'Usage: /gkblame <file>'

    if (file.startsWith('-')) return 'Give a file path, not an option.'
    let size = 0
    const candidates = file.startsWith('/') ? [file] : [`${root}/${file}`, file]
    let found: { kind: string; size: number } | undefined

    for (const c of candidates) {
      found = await $.fs.stat(c).catch(() => undefined)

      if (found) break
    }

    if (!found) return `${file}: no such file.`

    if (found.kind !== 'file') return `${file} is not a file.`
    size = found.size

    if (size > BLAME_CAP) return `${file} is ${fmtBytes(size)}, over the ${fmtBytes(BLAME_CAP)} cap for blame: pick a smaller file.`
    const r = await git($, ['blame', '--line-porcelain', '--', file], 25_000)

    if (r.code !== 0) return `git blame failed: ${firstLine(r.err)}`
    return blameLines(file, parseBlame(r.out), Math.floor((await $.clock.now()) / 1000)).join('\n')
  })

const cmdSplit = ($: Dollar) =>
  withRepo($, async () => {
    const r = await git($, ['status', '--porcelain=v1', '-unormal'])

    if (r.code !== 0) return `git status failed: ${firstLine(r.err)}`
    const paths = parseStatus(r.out).entries.filter(e => e.kind !== 'ignored').map(e => e.path)

    return splitText(groupChanges(paths)).join('\n')
  })

const cmdFixup = ($: Dollar, arg: string) =>
  withRepo($, async () => {
    let files = arg.trim().split(/\s+/).filter(Boolean)

    if (files.some(f => f.startsWith('-'))) return 'Give file paths, not options.'

    if (files.length === 0) {
      const r = await git($, ['status', '--porcelain=v1'])
      files = parseStatus(r.out).entries.filter(e => e.kind === 'staged' || e.kind === 'both').map(e => e.path)

      if (files.length === 0) return 'Usage: /gkfixup <file...>   (or stage some files first)'
    }
    const per: Record<string, ReturnType<typeof parseTouches>> = {}

    for (const f of files.slice(0, 10)) {
      const r = await git($, ['log', '--max-count=5', '--format=%h%x09%ct%x09%s', '--', f])
      per[f] = r.code === 0 ? parseTouches(r.out) : []
    }
    const pick = pickFixupTarget(per)

    if (!pick.target) return 'None of those files has history yet (new files cannot be fixups).'
    const nowSec = Math.floor((await $.clock.now()) / 1000)
    const t = pick.target

    return [
      `Most likely target: ${t.hash} ${trunc(t.subject, 70)} (${fmtAge(t.ts, nowSec)})`,
      `  last touched ${pick.files.slice(0, 4).join(', ')}${pick.files.length > 4 ? ' …' : ''}`,
      ...(pick.others.length > 0 ? ['Other candidates:', ...pick.others.map(o => `  ${o.hash} ${trunc(o.subject, 70)}`)] : []),
      `To use it, you run: git commit --fixup=${t.hash}   (nothing was run for you)`,
    ].join('\n')
  })

const cmdRelease = ($: Dollar, arg: string) =>
  withRepo($, async root => {
    const [op = '', ...rest] = arg.trim().split(/\s+/)
    const text = rest.join(' ')
    const n = Number(rest[0]) - 1
    let items = await loadRelease($, root)

    if (op === 'tick' || op === 'untick') {
      if (!Number.isInteger(n) || n < 0 || n >= items.length) return `Usage: /gkrelease tick <1-${items.length}>`
      items = toggleItem(items, n)
    } else if (op === 'add') {
      if (text.trim() === '') return 'Usage: /gkrelease add <text>'
      items = addItem(items, text)
    } else if (op === 'del') {
      if (!Number.isInteger(n) || n < 0 || n >= items.length) return `Usage: /gkrelease del <1-${items.length}>`
      items = removeItem(items, n)
    } else if (op === 'clear') {
      items = defaultChecklist()
    } else if (op !== '') {
      return 'Usage: /gkrelease [tick n | add text | del n | clear]'
    }

    if (op !== '') await saveRelease($, root, items)

    return showTab($, 'release')
  })

const cmdRemote = async ($: Dollar, arg: string): Promise<string> => {
  const a = arg.trim().toLowerCase()

  if (a === 'on' || a === 'off') {
    settings = { ...settings, remote: { on: a === 'on' } }
    await saveSettings($)

    return `Remote reminder is ${a}. It toasts when you are ahead of upstream after a turn (max once per 10 minutes).`
  }

  return withRepo($, async () => {
    const r = await git($, ['status', '--porcelain=v1', '-b'])

    if (r.code !== 0) return `git status failed: ${firstLine(r.err)}`
    const i = parseStatus(r.out)
    const state = `Remote reminder is ${settings.remote.on ? 'on' : 'off'}.`

    if (i.upstream === undefined) return `${state} ${i.branch || 'This branch'} has no upstream, so there is nothing to compare.`

    return `${state} ${i.branch} vs ${i.upstream}: ahead ${i.ahead}, behind ${i.behind}${i.isGone ? ' (upstream branch was deleted)' : ''}. Nothing is fetched, so this is as of your last fetch.`
  })
}

const cmdReset = async ($: Dollar): Promise<string> => {
  settings = { large: { ...DEFAULTS.large }, remote: { ...DEFAULTS.remote } }
  gate = { lastAny: -Infinity, last: {} }
  noRepoUntil = 0
  seenLarge.clear()
  await $.store.set('git-kit:settings', null)
  await $.store.set('git-kit:release', null)
  await $.store.set('git-kit:log', null)
  await update($, viewA, () => ({ tab: 'status', isBusy: false, at: 0, note: '', views: {} }))
  await update($, releaseA, () => ({ repo: '', items: [] }))
  await update($, testsA, () => ({ lastPassAt: 0, lastFailAt: 0, lastCmd: '', editAt: 0 }))

  return 'git-kit data cleared: settings back to defaults, release checklists, remembered changelog entries and test history removed.'
}

const runCommand = async ($: Dollar, name: string, args: string): Promise<string> => {
  try {
    switch (name) {
      case 'gk':
        return HELP
      case 'gkmsg':
        return await cmdMsg($)
      case 'gkbranch':
        return await cmdBranch($, args)
      case 'gkpr':
        return await cmdPr($, args)
      case 'gklog':
        return await cmdLog($)
      case 'gkstatus':
        return await showTab($, 'status')
      case 'gkmerge':
        return await cmdMerge($, args)
      case 'gkstash':
        return await showTab($, 'stash')
      case 'gktag':
        return await cmdTag($)
      case 'gkignore':
        return await cmdIgnore($, args)
      case 'gklarge':
        return await cmdLarge($, args)
      case 'gkblame':
        return await cmdBlame($, args)
      case 'gksplit':
        return await cmdSplit($)
      case 'gkfixup':
        return await cmdFixup($, args)
      case 'gkrelease':
        return await cmdRelease($, args)
      case 'gkhealth':
        return await showTab($, 'health')
      case 'gksub':
        return await withRepo($, async () => toText(await buildSubmodules($)))
      case 'gkhooks':
        return await withRepo($, async root => toText(await buildHooks($, root)))
      case 'gkremote':
        return await cmdRemote($, args)
      case 'gktree':
        return await showTab($, 'trees')
      case 'gkready':
        return await showTab($, 'ready')
      case 'gkreset':
        return await cmdReset($)
      default:
        return `Unknown git-kit command: ${name}`
    }
  } catch (err) {
    return err instanceof GitRefused ? `${err.message}` : `git-kit: ${msgOf(err)}`
  }
}

// ---------------------------------------------------------------- watchers

const watchTurn = async ($: Dollar) => {
  if (!settings.large.on && !settings.remote.on) return
  const now = await $.clock.now()

  if (now < noRepoUntil) return
  // A slow or failing status (a huge untracked tree, git missing) pauses the watcher for five minutes.
  const r = await git($, ['status', '--porcelain=v1', '-b', settings.large.on ? '-uall' : '-unormal'], 10_000).catch(() => undefined)

  if (r === undefined) {
    noRepoUntil = now + 300_000

    return
  }

  if (r.code !== 0) {
    noRepoUntil = now + 300_000

    return
  }
  const info = parseStatus(r.out)

  if (settings.remote.on && info.upstream !== undefined && info.ahead > 0 && toastAllowed(gate, 'remote', now, 600_000)) {
    gate = toastMark(gate, 'remote', now)
    await $.ui.toast(`${info.branch} is ${plural(info.ahead, 'commit')} ahead of ${info.upstream}: not pushed yet.`, { timeoutMs: 8000 })

    return
  }

  if (settings.large.on) {
    const cand = watchCandidates(info)

    if (cand.length === 0) return
    const repo = await repoOf($)

    if (!repo.ok) return
    const fresh = (await scanLarge($, repo.root, cand, settings.large.mb)).filter(f => !seenLarge.has(f.path))

    if (fresh.length > 0 && toastAllowed(gate, 'large', now, 180_000)) {
      gate = toastMark(gate, 'large', now)

      for (const f of fresh) seenLarge.add(f.path)
      const top = fresh[0] as SizedFile
      await $.ui.toast(`${trunc(top.path, 50)} is ${fmtBytes(top.size)}${fresh.length > 1 ? ` (+${fresh.length - 1} more large files)` : ''}: check it before committing.`, { timeoutMs: 9000 })
    }
  }
}

const FAIL_TEXT = /\b[1-9]\d* (failed|failing)\b|\bFAILED\b|Tests?:\s+\d+ failed/

const noteTool = async ($: Dollar, tool: string, command: string, outcome: { deny?: string; isError?: boolean; text?: string } | undefined) => {
  const now = await $.clock.now()

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    await update($, testsA, t => ({ ...t, editAt: now }))

    return
  }

  if (tool === 'Bash' && isTestCommand(command)) {
    const isFail = outcome?.deny !== undefined || outcome?.isError === true || FAIL_TEXT.test(outcome?.text ?? '')
    await update($, testsA, t => (isFail ? { ...t, lastFailAt: now, lastCmd: command.slice(0, 80) } : { ...t, lastPassAt: now, lastCmd: command.slice(0, 80) }))
  }
}

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadSettings($)

    for (const [name, , description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({ text: await runCommand($, name, e.args) })).catch(() => ({ text: 'git-kit hit an unexpected error.' }))
  }

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await watchTurn($).catch(() => undefined)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const command = e.tool === 'Bash' ? String((e as { command?: unknown }).command ?? '') : ''
    const ran = await next(e)

    await noteTool($, e.tool, command, ran as { deny?: string; isError?: boolean; text?: string }).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, viewA)
    const rel = await read($, releaseA)
    const tab = (TABS as readonly string[]).includes(v.tab) ? (v.tab as Tab) : 'status'
    const body = v.views[tab] ?? []

    return (
      <Box flexDirection="column" padding="sm" gap="sm">
        <Box gap="sm">
          {TABS.map(t => (
            <Button key={`tab-${t}`} label={TAB_LABEL[t]} plain dimColor={tab !== t} onPress={() => { void pressTab($, t) }} />
          ))}
          <Button key="refresh" label="refresh" plain dimColor onPress={() => { void pressTab($, tab) }} />
        </Box>
        {v.isBusy && <Text dimColor>Reading git…</Text>}
        {!v.isBusy && body.length === 0 && <Text dimColor>Nothing read yet: press refresh, or run the command for this tab.</Text>}
        {tab === 'release' && rel.items.length > 0 ? (
          <Box flexDirection="column">
            <Text color="suggestion">{`Release checklist: ${rel.items.filter(i => i.done).length}/${rel.items.length} done`}</Text>
            {rel.items.map((it, i) => (
              <Button key={`item-${i}`} label={`[${it.done ? 'x' : ' '}] ${it.t}`} plain dimColor={it.done} onPress={() => { void pressItem($, i) }} />
            ))}
            <Text dimColor>Edit with /gkrelease add, del or clear.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {body.map(l => (
              <Text mono color={l.c}>
                {l.t === '' ? ' ' : l.t}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
