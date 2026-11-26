import { expect, mock, test } from 'claude-code/testing'

import { GIT_ENV, GitRefused, checkGit, gitArgv } from './guard'
import {
  addItem,
  analyzeBranches,
  analyzeStyle,
  blameLines,
  changelogLines,
  defaultChecklist,
  fmtAge,
  fmtBytes,
  groupChanges,
  healthLines,
  hookLines,
  ignoreSuggestions,
  isSafeRef,
  isTestCommand,
  largeFiles,
  mergeEntries,
  mergeLines,
  msgPrompt,
  nextVersion,
  parseBlame,
  parseBranchRefs,
  parseConventional,
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
  prPrompt,
  readiness,
  removeItem,
  slugify,
  statusLines,
  suggestBranches,
  suggestBump,
  tenseOf,
  testStatus,
  toastAllowed,
  toastMark,
  toggleItem,
  unquoteC,
  watchCandidates,
} from './parse'

// ------------------------------------------------------------------ the allowlist wrapper

const ok = (...a: string[]) => expect(checkGit(a).ok).toBe(true)
const no = (...a: string[]) => expect(checkGit(a).ok).toBe(false)

test('the allowlist accepts the read-only forms this mod uses', () => {
  ok('status', '--porcelain=v1', '-b')
  ok('status', '--porcelain=v1', '-b', '-uall')
  ok('status', '-sb')
  ok('log', '--max-count=30', '--no-merges', '--format=%s')
  ok('log', '-5', '--format=%h%x09%ct%x09%s', '--', 'src/a.ts')
  ok('log', '--max-count=100', '--format=%h %s', 'main..HEAD')
  ok('diff', '--numstat', 'main...HEAD')
  ok('diff', '--check', '--cached')
  ok('diff', '--stat')
  ok('branch', '--merged', 'main', '--format=%(refname:short)')
  ok('branch', '--list', 'feature/*')
  ok('branch', '-a', '-vv')
  ok('tag', '--list', '--merged', 'HEAD', '--sort=-v:refname')
  ok('tag', '-l', 'v1.*')
  ok('stash', 'list', '--format=%gd%x09%ct%x09%s')
  ok('stash', 'show', '--stat', 'stash@{0}')
  ok('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes')
  ok('rev-parse', '--show-toplevel')
  ok('rev-parse', '--abbrev-ref', 'origin/HEAD')
  ok('rev-parse', '--path-format=absolute', '--git-common-dir')
  ok('blame', '--line-porcelain', '--', 'src/a.ts')
  ok('blame', '-L', '1,20', '--line-porcelain', 'a.ts')
  ok('worktree', 'list', '--porcelain')
  ok('remote', '-v')
  ok('submodule', 'status')
  ok('config', '--get', 'core.hooksPath')
  ok('ls-files', '-z')
  ok('ls-files', '--others', '--exclude-standard')
  ok('check-ignore', '-v', 'build/out.js')
  ok('merge-base', 'HEAD', 'main')
  ok('merge-tree', '--trivial-merge', 'abc', 'HEAD', 'main')
})

test('the allowlist refuses every write verb', () => {
  const writers = [
    'add', 'commit', 'push', 'pull', 'fetch', 'checkout', 'switch', 'restore', 'reset', 'rebase', 'merge', 'cherry-pick', 'revert', 'clean',
    'rm', 'mv', 'init', 'clone', 'gc', 'prune', 'am', 'apply', 'bisect', 'notes', 'update-ref', 'update-index', 'symbolic-ref', 'hash-object',
    'write-tree', 'commit-tree', 'replace', 'reflog', 'filter-branch', 'format-patch', 'archive', 'bundle', 'fsck', 'repack', 'maintenance',
    'sparse-checkout', 'submodule-helper', 'lfs', 'daemon', 'send-email', 'request-pull', 'pack-objects', 'read-tree', 'checkout-index',
    'unpack-file', 'mktree', 'mktag', 'fast-import', 'credential', 'stage', 'show-branch', 'describe',
  ]

  for (const w of writers) {
    no(w)
    no(w, '--help')
    no(w.toUpperCase())
  }
})

test('write sub-commands and flags of the allowed verbs are refused too', () => {
  no('tag', 'v1.0.0')
  no('tag')
  no('tag', '-a', 'v1', '-m', 'x')
  no('tag', '-d', 'v1')
  no('tag', '--list', '-d', 'v1')
  no('branch', 'newbranch')
  no('branch', '-d', 'old')
  no('branch', '-D', 'old')
  no('branch', '-m', 'a', 'b')
  no('branch', '-c', 'a', 'b')
  no('branch', '--set-upstream-to=origin/x')
  no('branch', '-u', 'origin/x')
  no('branch', '--unset-upstream')
  no('branch', '--edit-description')
  no('branch', '-av', 'foo')
  no('branch', '-dv', 'foo')
  no('branch', '--merged', '-d', 'foo')
  no('stash')
  no('stash', 'push')
  no('stash', 'pop')
  no('stash', 'apply')
  no('stash', 'drop')
  no('stash', 'clear')
  no('stash', 'save', 'x')
  no('stash', 'branch', 'x')
  no('stash', 'create')
  no('stash', 'store', 'abc')
  no('worktree', 'add', '../x')
  no('worktree', 'remove', 'x')
  no('worktree', 'prune')
  no('worktree', 'move', 'a', 'b')
  no('worktree', 'lock', 'x')
  no('remote')
  no('remote', 'add', 'x', 'url')
  no('remote', 'remove', 'x')
  no('remote', 'set-url', 'x', 'u')
  no('remote', 'update')
  no('remote', 'prune', 'origin')
  no('remote', '-v', 'add', 'x', 'u')
  no('submodule', 'update')
  no('submodule', 'init')
  no('submodule', 'add', 'u')
  no('submodule', 'sync')
  no('config', 'user.name', 'x')
  no('config', '--unset', 'user.name')
  no('config', '--add', 'a.b', 'c')
  no('config', '--edit')
  no('config', '--global', 'a.b', 'c')
  no('config', '--list')
  no('config', '--get', '--file', '/tmp/x', 'a.b')
  no('diff', '--output=/tmp/x')
  no('diff', '--output', '/tmp/x')
  no('log', '--output=/tmp/x')
  no('diff', '--ext-diff')
  no('status', '--ignored=bogus', '--bogus')
  no('rev-parse', '--git-dir', '--unknown')
  no('blame', '--contents', '/etc/passwd', 'f')
  no('merge-tree', '--write-tree', 'a', 'b')
  no('merge-tree', 'a', 'b', 'c')
  no('merge-tree', '--trivial-merge', 'a', 'b')
  no('merge-tree', '--trivial-merge', '-x', 'b', 'c')
  no('merge-base', '--octopus', 'a', 'b')
  no('merge-base', 'a')
  no('ls-files', '--with-tree=x', '--bogus')
  no('check-ignore', '--stdin')
})

test('global git options and odd input are refused', () => {
  no('-c', 'core.pager=sh', 'status')
  no('-C', '/', 'status')
  no('--git-dir=/x', 'status')
  no('--exec-path=/x', 'status')
  no('--work-tree=/x', 'status')
  no('-p', 'log')
  no('')
  expect(checkGit([]).ok).toBe(false)
  expect(checkGit(['status\0']).ok).toBe(false)
  expect(checkGit(['constructor']).ok).toBe(false)
  expect(checkGit(['__proto__']).ok).toBe(false)
  expect(checkGit(['toString']).ok).toBe(false)
})

test('gitArgv throws GitRefused for a refused call and builds a fixed argv for an allowed one', () => {
  expect(() => gitArgv(['push', 'origin', 'main'])).toThrow(GitRefused)
  expect(() => gitArgv(['commit', '-m', 'x'])).toThrow(/refused/)
  const argv = gitArgv(['diff', '--stat'])
  expect(argv.slice(0, 6)).toEqual(['git', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false'])
  expect(argv).toContain('--no-ext-diff')
  expect(gitArgv(['stash', 'list'])).toEqual(['git', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', 'stash', 'list', '--no-ext-diff', '--no-textconv'].filter(x => x !== '--no-ext-diff' && x !== '--no-textconv'))
  expect(GIT_ENV.GIT_OPTIONAL_LOCKS).toBe('0')
})

// ------------------------------------------------------------------ parsers

const STATUS = [
  '## main...origin/main [ahead 2, behind 1]',
  'M  src/a.ts',
  ' M src/b.ts',
  'MM src/c.ts',
  '?? notes.txt',
  'UU conflict.txt',
  'R  old.txt -> new.txt',
  '?? "caf\\303\\251.txt"',
  '!! dist/',
].join('\n')

test('parseStatus reads branch, tracking and every entry kind', () => {
  const s = parseStatus(STATUS)
  expect(s.branch).toBe('main')
  expect(s.upstream).toBe('origin/main')
  expect(s.ahead).toBe(2)
  expect(s.behind).toBe(1)
  const kinds = Object.fromEntries(s.entries.map(e => [e.path, e.kind]))
  expect(kinds['src/a.ts']).toBe('staged')
  expect(kinds['src/b.ts']).toBe('unstaged')
  expect(kinds['src/c.ts']).toBe('both')
  expect(kinds['notes.txt']).toBe('untracked')
  expect(kinds['conflict.txt']).toBe('conflict')
  expect(kinds['new.txt']).toBe('staged')
  expect(s.entries.find(e => e.path === 'new.txt')?.from).toBe('old.txt')
  expect(kinds['café.txt']).toBe('untracked')
  expect(kinds['dist/']).toBe('ignored')
})

test('parseStatus handles odd headers', () => {
  expect(parseStatus('## No commits yet on main').hasNoCommits).toBe(true)
  expect(parseStatus('## HEAD (no branch)').isDetached).toBe(true)
  const gone = parseStatus('## feat...origin/feat [gone]')
  expect(gone.isGone).toBe(true)
  expect(parseStatus('## solo').upstream).toBeUndefined()
  expect(parseStatus('').entries).toEqual([])
})

test('statusLines shows the staged, unstaged, untracked and conflict map', () => {
  const text = statusLines(parseStatus(STATUS)).map(l => l.t).join('\n')
  expect(text).toMatch(/On main {2}\(origin\/main, ahead 2, behind 1\)/)
  expect(text).toMatch(/Staged \(3\)/)
  expect(text).toMatch(/Not staged \(2\)/)
  expect(text).toMatch(/Untracked \(2\)/)
  expect(text).toMatch(/Conflicts \(1\)/)
  expect(text).toMatch(/also changed since/)
  expect(statusLines(parseStatus('## main')).map(l => l.t).join('')).toMatch(/clean/)
})

test('unquoteC decodes escapes and utf-8', () => {
  expect(unquoteC('plain')).toBe('plain')
  expect(unquoteC('"a\\tb"')).toBe('a\tb')
  expect(unquoteC('"caf\\303\\251"')).toBe('café')
  expect(unquoteC('"q\\"x"')).toBe('q"x')
  expect(unquoteC('"日本"')).toBe('日本')
})

const SUBJECTS = [
  'feat(api): add user endpoint',
  'fix(ui): handle empty list',
  'feat: add search box',
  'chore(deps): bump lodash',
  'fix: stop crash on start',
  'docs: update readme',
  'Merge branch main into x',
  'feat(core): support streaming',
]

test('analyzeStyle learns prefix, tense, case and length', () => {
  const s = analyzeStyle(SUBJECTS)
  expect(s?.count).toBe(7)
  expect(s?.prefixKind).toBe('conventional')
  expect(s?.prefixShare).toBe(100)
  expect(s?.tense).toBe('imperative')
  expect(s?.lowerShare).toBe(100)
  expect(s?.periodShare).toBe(0)
  expect(s?.types[0]?.[0]).toBe('feat')
  expect(s?.len.max).toBeGreaterThan(20)
  const prompt = msgPrompt(s!, true)
  expect(prompt).toMatch(/Conventional Commits/)
  expect(prompt).toMatch(/imperative/)
  expect(prompt).toMatch(/staged changes/)
})

test('analyzeStyle spots other styles', () => {
  expect(analyzeStyle(['Added the thing.', 'Fixed a bug.', 'Updated docs.'])).toMatchObject({ prefixKind: 'none', tense: 'past', periodShare: 100 })
  expect(analyzeStyle(['[API] add x', '[UI] add y'])?.prefixKind).toBe('bracket')
  expect(analyzeStyle(['ABC-12 fix a', 'ABC-13 fix b'])?.prefixKind).toBe('ticket')
  expect(analyzeStyle(['Adding a', 'Fixing b'])?.tense).toBe('gerund')
  expect(analyzeStyle([])).toBeNull()
  expect(analyzeStyle(['Merge branch x'])).toBeNull()
})

test('tenseOf and parseConventional edge cases', () => {
  expect(tenseOf('add a feature')).toBe('imperative')
  expect(tenseOf('Added a feature')).toBe('past')
  expect(tenseOf('need more tests')).toBe('imperative')
  expect(tenseOf('string handling')).toBe('imperative')
  expect(parseConventional('feat(x)!: boom')).toMatchObject({ type: 'feat', scope: 'x', isBreaking: true, desc: 'boom' })
  expect(parseConventional('hello: world')).toBeNull()
  expect(parseConventional('not conventional')).toBeNull()
})

test('branch names: analysis and suggestions follow the repo', () => {
  const names = ['feature/login-form', 'feature/api-cache', 'fix/crash-on-start', 'origin/feature/dark-mode', 'main']
  const st = analyzeBranches(names)
  expect(st?.prefixes[0]).toEqual(['feature', 3])
  expect(st?.sep).toBe('-')
  const sug = suggestBranches('Add a profile page for users', st)
  expect(sug[0]).toBe('feature/add-profile-page-users')
  expect(sug.every(n => n.startsWith('feature/'))).toBe(true)
  expect(suggestBranches('fix crash when saving', st)[0]).toMatch(/^fix\/crash-saving|^fix\/fix-crash/)
  expect(suggestBranches('', st)).toEqual([])
  expect(suggestBranches('Add thing', analyzeBranches(['one', 'two-three']))[0]).toBe('add-thing')
  const underscore = analyzeBranches(['feature/a_b', 'feature/c_d_e', 'feature/f_g'])
  expect(suggestBranches('add profile page', underscore)[0]).toBe('feature/add_profile_page')
  const tickets = analyzeBranches(['feat/ABC-1-a', 'feat/ABC-2-b', 'feat/XYZ-3-c'])
  expect(suggestBranches('PRJ-77 add export', tickets)[0]).toMatch(/PRJ-77-add-export$/)
  expect(slugify('The quick, brown fox!', 3)).toBe('quick-brown-fox')
})

test('numstat, base picking and the PR prompt', () => {
  const files = parseNumstat('10\t2\tsrc/a.ts\n-\t-\timg/logo.png\n3\t0\tdocs/{old => new}/x.md\n')
  expect(files).toHaveLength(3)
  expect(files[1]).toMatchObject({ isBinary: true, add: 0 })
  expect(pickBase(['main', 'feature/x', 'origin/main'], 'feature/x')).toBe('main')
  expect(pickBase(['feature/x', 'origin/master'], 'feature/x')).toBe('origin/master')
  expect(pickBase(['main'], 'main')).toBeUndefined()
  expect(pickBase(['dev', 'main'], 'x', 'origin/dev')).toBe('dev')
  const p = prPrompt({ branch: 'feature/x', base: 'main', commits: ['abc1234 feat: x'], files })
  expect(p).toMatch(/pull request description for branch "feature\/x" into "main"/)
  expect(p).toMatch(/abc1234 feat: x/)
  expect(p).toMatch(/3 files changed/)
  expect(isSafeRef('feature/x')).toBe(true)
  expect(isSafeRef('--output=x')).toBe(false)
  expect(isSafeRef('a..b')).toBe(false)
})

test('changelog groups by conventional type and accumulates by hash', () => {
  const entries = parseLogLines('a1\tfeat(ui): new tab\nb2\tfix: crash\nc3\tfeat!: drop v1\nd4\trandom words\ne5\tMerge branch x')
  expect(entries).toHaveLength(5)
  const text = changelogLines(entries, 'v1.0.0').join('\n')
  expect(text).toMatch(/Changelog since v1\.0\.0/)
  expect(text).toMatch(/Breaking changes\n- drop v1/)
  expect(text).toMatch(/Features\n- \*\*ui\*\*: new tab/)
  expect(text).toMatch(/Fixes\n- crash/)
  expect(text).toMatch(/Other\n- random words/)
  expect(text).not.toMatch(/Merge branch/)
  expect(changelogLines([], undefined)[0]).toMatch(/No commits/)
  const merged = mergeEntries([{ hash: 'a1', subject: 'old' }], [{ hash: 'a1', subject: 'old' }, { hash: 'z9', subject: 'new' }], 2)
  expect(merged.map(e => e.hash)).toEqual(['a1', 'z9'])
  expect(mergeEntries(merged, [{ hash: 'q', subject: 'q' }], 2).map(e => e.hash)).toEqual(['z9', 'q'])
})

test('tag helper: semver parsing, bump level and next version', () => {
  expect(parseSemver('v1.2.3')).toMatchObject({ prefix: 'v', major: 1, minor: 2, patch: 3 })
  expect(parseSemver('2.0.0-rc.1')?.pre).toBe('rc.1')
  expect(parseSemver('nightly')).toBeNull()
  expect(suggestBump(['fix: a', 'chore: b']).bump).toBe('patch')
  expect(suggestBump(['fix: a', 'feat: b']).bump).toBe('minor')
  expect(suggestBump(['feat!: a', 'fix: b']).bump).toBe('major')
  expect(suggestBump(['random']).bump).toBe('patch')
  expect(suggestBump([]).bump).toBe('none')
  expect(nextVersion('v1.2.3', 'patch')?.version).toBe('v1.2.4')
  expect(nextVersion('v1.2.3', 'minor')?.version).toBe('v1.3.0')
  expect(nextVersion('1.2.3', 'major')?.version).toBe('2.0.0')
  expect(nextVersion('v0.4.1', 'major')).toMatchObject({ version: 'v0.5.0' })
  expect(nextVersion(undefined, 'minor')?.version).toBe('v0.1.0')
  expect(nextVersion('nightly', 'minor')).toBeNull()
  expect(nextVersion('v1.0.0', 'none')).toBeNull()
})

test('gitignore suggestions flag secrets first and skip .env.example', () => {
  const sug = ignoreSuggestions(['node_modules/', '.env', '.env.example', 'server.pem', 'dist/', '.DS_Store', 'src/app.ts', 'a/__pycache__/x.pyc'])
  expect(sug[0]?.risk).toBe('secret')
  const patterns = sug.map(s => s.pattern)
  expect(patterns).toContain('node_modules/')
  expect(patterns).toContain('.env*')
  expect(patterns).toContain('*.pem / *.key')
  expect(patterns).toContain('__pycache__/ *.pyc')
  expect(sug.flatMap(s => s.examples)).not.toContain('.env.example')
  expect(sug.flatMap(s => s.examples)).not.toContain('src/app.ts')
  expect(ignoreSuggestions([])).toEqual([])
})

test('large files: threshold filter, formatting and candidates', () => {
  const big = largeFiles([{ path: 'a', size: 5 }, { path: 'b', size: 3_000_000 }, { path: 'c', size: 9_000_000 }], 1_000_000)
  expect(big.map(f => f.path)).toEqual(['c', 'b'])
  expect(fmtBytes(512)).toBe('512 B')
  expect(fmtBytes(2048)).toBe('2 KB')
  expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  const cand = watchCandidates(parseStatus('## m\n?? big.bin\n M a.ts\n D gone.ts\n?? node_modules/x/y.js\n?? dir/\n'))
  expect(cand).toEqual(['big.bin', 'a.ts'])
})

const BLAME = [
  `${'a'.repeat(40)} 1 1 2`,
  'author Ann',
  'author-mail <a@x>',
  'author-time 1700000000',
  'summary first',
  'filename f.ts',
  '\tline one',
  `${'a'.repeat(40)} 2 2`,
  'author Ann',
  'author-time 1700000000',
  'summary first',
  '\tline two',
  `${'b'.repeat(40)} 3 3 1`,
  'author Bob',
  'author-time 1710000000',
  'summary second change',
  'filename f.ts',
  '\tline three',
].join('\n')

test('parseBlame counts lines per author', () => {
  const r = parseBlame(BLAME)
  expect(r.total).toBe(3)
  expect(r.authors[0]).toMatchObject({ author: 'Ann', lines: 2, share: 67 })
  expect(r.authors[1]).toMatchObject({ author: 'Bob', lines: 1 })
  expect(r.newest?.summary).toBe('second change')
  const text = blameLines('f.ts', r, 1_710_100_000).join('\n')
  expect(text).toMatch(/f\.ts: 3 lines, 2 authors/)
  expect(text).toMatch(/Newest change: bbbbbbb second change/)
  expect(parseBlame('').total).toBe(0)
})

test('commit splitter groups by directory and type', () => {
  const groups = groupChanges(['src/ui/a.ts', 'src/ui/b.ts', 'src/api/c.ts', 'src/api/c.test.ts', 'README.md', 'package-lock.json', '.github/workflows/ci.yml', 'package.json'])
  const names = groups.map(g => g.name)
  expect(names).toContain('src: src/ui')
  expect(names).toContain('src: src/api')
  expect(names).toContain('test')
  expect(names).toContain('docs')
  expect(names).toContain('deps')
  expect(names).toContain('ci')
  expect(names).toContain('config')
  expect(groups.find(g => g.name === 'src: src/ui')?.files).toHaveLength(2)
  expect(groupChanges([])).toEqual([])
})

test('fixup assistant picks the commit that touched the most files', () => {
  const per = {
    'a.ts': parseTouches('h1\t1700000000\tfeat: a\nh0\t1690000000\told'),
    'b.ts': parseTouches('h1\t1700000000\tfeat: a'),
    'c.ts': parseTouches('h2\t1710000000\tfix: c'),
    'd.ts': parseTouches(''),
  }
  const pick = pickFixupTarget(per)
  expect(pick.target?.hash).toBe('h1')
  expect(pick.files).toEqual(['a.ts', 'b.ts'])
  expect(pick.others[0]?.hash).toBe('h2')
  expect(pickFixupTarget({ 'x.ts': [] }).target).toBeUndefined()
})

test('release checklist operations are pure and bounded', () => {
  const d = defaultChecklist()
  expect(d.length).toBeGreaterThan(4)
  expect(d.every(i => !i.done)).toBe(true)
  expect(toggleItem(d, 1)[1]?.done).toBe(true)
  expect(toggleItem(toggleItem(d, 1), 1)[1]?.done).toBe(false)
  expect(addItem(d, '  tag it  ').at(-1)).toEqual({ t: 'tag it', done: false })
  expect(addItem(d, '   ')).toHaveLength(d.length)
  expect(addItem(Array.from({ length: 30 }, () => ({ t: 'x', done: false })), 'more')).toHaveLength(30)
  expect(removeItem(d, 0)).toHaveLength(d.length - 1)
})

test('repo health: refs parse, stale and merged branches are reported', () => {
  const now = 1_800_000_000
  const rows = parseRefs(`main\t${now - 100}\torigin/main\t\t*\nold\t${now - 200 * 86400}\t\t\t\nfeat\t${now - 5 * 86400}\torigin/feat\t[gone]\t`)
  expect(rows).toHaveLength(3)
  expect(rows[0]?.isCurrent).toBe(true)
  const text = healthLines({ branches: rows, merged: ['old', 'main'], base: 'main', nowSec: now, big: [{ path: 'data.bin', size: 5_000_000 }], sampled: 12 }).map(l => l.t).join('\n')
  expect(text).toMatch(/old .*stale, merged/)
  expect(text).toMatch(/Stale \(no commit in 90\+ days\): 1/)
  expect(text).toMatch(/Already merged into main: old/)
  expect(text).toMatch(/Upstream deleted: feat/)
  expect(text).toMatch(/4\.8 MB {2}data\.bin/)
  expect(fmtAge(now - 200 * 86400, now)).toMatch(/months ago/)
  expect(fmtAge(now - 30, now)).toBe('just now')
})

test('stash, worktree, submodule and hook parsers', () => {
  const stash = parseStashList('stash@{0}\t1700000000\tWIP on main: abc msg\nstash@{1}\t1690000000\tOn x: other')
  expect(stash).toHaveLength(2)
  expect(stash[1]?.subject).toBe('On x: other')
  const wt = parseWorktrees('worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r2\nHEAD def\ndetached\nlocked reason\n\nworktree /bare\nbare\n')
  expect(wt).toHaveLength(3)
  expect(wt[0]?.branch).toBe('main')
  expect(wt[1]).toMatchObject({ isDetached: true, locked: 'reason' })
  expect(wt[2]?.isBare).toBe(true)
  const subs = parseSubmodules(' 1234567890abcdef libs/a (v1.0)\n-abcdef1234567890 libs/b\n+0011223344556677 libs/c (heads/main)\nU8899aabbccddeeff libs/d')
  expect(subs.map(s => s.state)).toEqual(['ok', 'uninitialized', 'modified', 'conflict'])
  expect(subs[0]?.describe).toBe('v1.0')
  expect(hookLines('/r/.git/hooks', [{ name: 'pre-commit', size: 120 }, { name: 'pre-push.sample', size: 900 }], 'default').map(l => l.t).join('\n')).toMatch(/pre-commit +120 B/)
  expect(hookLines('/r/.git/hooks', [{ name: 'pre-push.sample', size: 900 }], 'default').map(l => l.t).join('\n')).toMatch(/none installed \(1 \.sample/)
})

test('merge preview parses the trivial-merge format', () => {
  const out = [
    'changed in both',
    '  base   100644 de98044 f.txt',
    '  our    100644 3b6f40a f.txt',
    '  their  100644 f4ea702 f.txt',
    '@@ -1,3 +1,7 @@',
    ' a',
    '+<<<<<<< .our',
    ' B2',
    '+=======',
    '+B1',
    '+>>>>>>> .their',
    ' c',
    'changed in both',
    '  base   100644 aaa g.txt',
    '  our    100644 bbb g.txt',
    '  their  100644 ccc g.txt',
    '@@ -1 +1,2 @@',
    ' x',
    '+y',
  ].join('\n')
  const p = parseTrivialMerge(out)
  expect(p.conflicts).toEqual([{ file: 'f.txt', hunks: 1 }])
  expect(p.clean).toEqual(['g.txt'])
  expect(mergeLines(p, 'main', 'feature').map(l => l.t).join('\n')).toMatch(/1 file would conflict/)
  expect(mergeLines({ conflicts: [], clean: [] }, 'a', 'b').map(l => l.t).join('')).toMatch(/no conflicts expected/)
})

test('merge readiness: tests, diff --check and the score', () => {
  expect(isTestCommand('npm test')).toBe(true)
  expect(isTestCommand('pnpm run test -- --watch=false')).toBe(true)
  expect(isTestCommand('pytest -x tests/')).toBe(true)
  expect(isTestCommand('cargo test --all')).toBe(true)
  expect(isTestCommand('go test ./...')).toBe(true)
  expect(isTestCommand('ls -la')).toBe(false)
  expect(isTestCommand('git commit -m "test"')).toBe(false)
  expect(testStatus({ lastPassAt: 0, lastFailAt: 0, lastCmd: '', editAt: 0 })).toBe('none')
  expect(testStatus({ lastPassAt: 5, lastFailAt: 0, lastCmd: '', editAt: 0 })).toBe('pass')
  expect(testStatus({ lastPassAt: 5, lastFailAt: 0, lastCmd: '', editAt: 9 })).toBe('stale')
  expect(testStatus({ lastPassAt: 5, lastFailAt: 7, lastCmd: '', editAt: 0 })).toBe('fail')
  const chk = parseDiffCheck('a.ts:3: leftover conflict marker\na.ts:9: trailing whitespace.\n+foo  \nb.ts:1: leftover conflict marker')
  expect(chk).toEqual({ markers: 2, whitespace: 1, files: ['a.ts', 'b.ts'] })
  expect(readiness({ tests: 'pass', dirty: 0, untracked: 0, conflicts: 0, markers: 0, behind: 0 }).score).toBe(100)
  expect(readiness({ tests: 'none', dirty: 0, untracked: 0, conflicts: 0, markers: 0, behind: 0 }).score).toBe(60)
  const bad = readiness({ tests: 'fail', dirty: 20, untracked: 0, conflicts: 1, markers: 2, behind: 3 })
  expect(bad.score).toBe(0)
  expect(bad.label).toBe('not ready')
  expect(readiness({ tests: 'stale', dirty: 2, untracked: 1, conflicts: 0, markers: 0, behind: 0 }).score).toBe(20 + 13 + 25 + 10)
})

test('the toast gate allows one per 3 minutes overall and one per kind interval', () => {
  let g = { lastAny: -Infinity, last: {} as Record<string, number> }
  expect(toastAllowed(g, 'remote', 1000, 600_000)).toBe(true)
  g = toastMark(g, 'remote', 1000)
  expect(toastAllowed(g, 'large', 1000 + 60_000, 180_000)).toBe(false)
  expect(toastAllowed(g, 'large', 1000 + 181_000, 180_000)).toBe(true)
  expect(toastAllowed(g, 'remote', 1000 + 181_000, 600_000)).toBe(false)
  expect(toastAllowed(g, 'remote', 1000 + 601_000, 600_000)).toBe(true)
})

test('branch ref parsing drops HEAD pointers and keeps remotes', () => {
  expect(parseBranchRefs('refs/heads/main\nrefs/heads/feature/x\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/tags/v1')).toEqual(['main', 'feature/x', 'origin/main'])
})

// ------------------------------------------------------------------ the engine

const PANE = {
  plugin: 'git-kit',
  component: 'Pane',
  requestId: 'git-kit-main',
  surface: 'desktop',
  props: { title: 'git-kit', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type Reply = { code?: number; out?: string; err?: string }

const engine = (on: any, replies: Record<string, Reply | ((a: string[]) => Reply)> = {}, init: { cwd?: string } = {}) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
  const calls: string[][] = []
  const toasts: string[] = []
  const filled: string[] = []
  const stats: Record<string, { kind: 'file' | 'dir'; size: number }> = {}
  const lists: Record<string, { name: string; kind: 'file'; size: number }[]> = {}
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  const tool: { fn: (e: Record<string, unknown>) => unknown } = { fn: () => ({ result: {} }) }
  on('tool.call', (_: unknown, e: Record<string, unknown>) => tool.fn(e))
  on('turn.start', () => ({ turnId: 't' }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('fs.stat', (_: unknown, e: { path: string }) => {
    const s = stats[e.path] ?? stats[e.path.replace(/^\/r\//, '')]

    if (!s) throw new Error('ENOENT ' + e.path)

    return { value: { ...s, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', (_: unknown, e: { path: string }) => {
    const l = lists[e.path]

    if (!l) throw new Error('ENOENT')

    return { value: l.map(x => ({ ...x, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    calls.push([...e.argv])
    const a = e.argv.slice(6).filter(x => x !== '--no-ext-diff' && x !== '--no-textconv')
    const key = a.join(' ')
    const hit = Object.entries(replies).find(([k]) => key === k || key.startsWith(k))
    const r = hit ? (typeof hit[1] === 'function' ? hit[1](a) : hit[1]) : { code: 128, err: 'fatal: not a git repository' }

    return { value: { exitCode: r.code ?? 0, stdout: r.out ?? '', stderr: r.err ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  void init

  return { clock, calls, toasts, filled, stats, lists, tool }
}

const start = ($: any) => $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = ''): Promise<string> => ((await $.command.run({ command, args, origin: 'user' } as any)) as { text: string }).text
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join('\n')

const REPO = { 'rev-parse --show-toplevel': { out: '/r\n' }, 'rev-parse --abbrev-ref HEAD': { out: 'feature/x\n' } }

test('/gk lists every command with its prefix', async ($, on) => {
  engine(on)
  await start($)
  const text = await run($, 'gk')

  for (const name of ['gkmsg', 'gkbranch', 'gkpr', 'gklog', 'gkstatus', 'gkmerge', 'gkstash', 'gktag', 'gkignore', 'gklarge', 'gkblame', 'gksplit', 'gkfixup', 'gkrelease', 'gkhealth', 'gksub', 'gkhooks', 'gkremote', 'gktree', 'gkready', 'gkreset']) {
    expect(text).toMatch(new RegExp(`/${name}\\b`))
  }
  expect(text).toMatch(/read-only/)
})

test('outside a repository every command says so plainly and runs nothing risky', async ($, on) => {
  const { calls, filled } = engine(on)
  await start($)

  for (const c of ['gkmsg', 'gkbranch', 'gkpr', 'gklog', 'gkstatus', 'gkmerge', 'gkstash', 'gktag', 'gkignore', 'gksplit', 'gkfixup', 'gkhealth', 'gksub', 'gkhooks', 'gkremote', 'gktree', 'gkready']) {
    expect(await run($, c, 'x')).toMatch(/not a git repository/)
  }
  expect(await run($, 'gkblame', 'f.ts')).toMatch(/not a git repository/)
  expect(await run($, 'gkrelease')).toMatch(/not a git repository/)
  expect(filled).toEqual([])
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(a => a[0] === 'git' && a[6] === 'rev-parse')).toBe(true)
})

test('/gkmsg learns the style from the last subjects and fills the prompt', async ($, on) => {
  const { filled, calls } = engine(on, { ...REPO, 'log --max-count=30': { out: SUBJECTS.filter(s => !s.startsWith('Merge')).join('\n') }, 'status --porcelain=v1': { out: 'M  a.ts\n' } })
  await start($)
  const text = await run($, 'gkmsg')
  expect(text).toMatch(/Conventional Commits/)
  expect(text).toMatch(/Prompt filled/)
  expect(filled).toHaveLength(1)
  expect(filled[0]).toMatch(/imperative mood/)
  expect(filled[0]).toMatch(/staged changes/)
  expect(calls.some(a => a.includes('log') && a.includes('--no-merges'))).toBe(true)
})

test('/gkmsg on a repo with no commits explains', async ($, on) => {
  engine(on, { ...REPO, 'log --max-count=30': { code: 128, err: "fatal: your current branch 'main' does not have any commits yet" } })
  await start($)
  expect(await run($, 'gkmsg')).toMatch(/no commits yet/)
})

test('/gkbranch proposes names in the repo style', async ($, on) => {
  engine(on, { ...REPO, 'for-each-ref': { out: 'refs/heads/main\nrefs/heads/feature/login-form\nrefs/heads/feature/api-cache\nrefs/heads/fix/crash\nrefs/remotes/origin/main\n' } })
  await start($)
  const text = await run($, 'gkbranch', 'add dark mode toggle')
  expect(text).toMatch(/feature\/add-dark-mode-toggle/)
  expect(text).toMatch(/no branch was created/)
  expect(await run($, 'gkbranch', '')).toMatch(/Usage/)
})

test('/gkpr fills a prompt with commits and the diff stat since the base', async ($, on) => {
  const { filled } = engine(on, {
    ...REPO,
    'for-each-ref': { out: 'refs/heads/main\nrefs/heads/feature/x\n' },
    'rev-parse --abbrev-ref origin/HEAD': { code: 128, err: 'fatal' },
    'log --max-count=100': { out: 'abc1234 feat: add x\ndef5678 fix: y\n' },
    'diff --numstat main...HEAD': { out: '10\t2\tsrc/a.ts\n1\t1\tREADME.md\n' },
  })
  await start($)
  const text = await run($, 'gkpr')
  expect(text).toMatch(/2 commits and 2 files \(\+11 -3\) on feature\/x since main/)
  expect(filled[0]).toMatch(/abc1234 feat: add x/)
  expect(filled[0]).toMatch(/src\/a\.ts/)
  expect(await run($, 'gkpr', '--evil')).toMatch(/does not look like a branch/)
})

test('/gklog and /gktag read commits since the last semver tag', async ($, on) => {
  const { calls } = engine(on, {
    ...REPO,
    'tag --list --merged HEAD': { out: 'v1.1.0-rc.1\nv1.1.0\nv1.0.0\n' },
    'log --max-count=300': { out: 'a1b2c3d\tfeat(ui): add tab\nb2c3d4e\tfix: crash\n' },
  })
  await start($)
  const log = await run($, 'gklog')
  expect(log).toMatch(/Changelog since v1\.1\.0 \(2 commits\)/)
  expect(log).toMatch(/Features\n- \*\*ui\*\*: add tab/)
  expect(calls.some(a => a.includes('v1.1.0..HEAD'))).toBe(true)
  const tag = await run($, 'gktag')
  expect(tag).toMatch(/Suggested bump: minor {2}->  v1\.2\.0/)
  expect(tag).toMatch(/no tag was created/)
})

test('/gklog with no tag collects from the start and remembers entries', async ($, on) => {
  let log = 'a1\tfeat: one\n'
  const { calls } = engine(on, { ...REPO, 'tag --list': { out: '' }, 'log --max-count=300': () => ({ out: log }) })
  await start($)
  expect(await run($, 'gklog')).toMatch(/since the first commit \(1 commit\)/)
  expect(calls.some(a => a.some(x => x.endsWith('..HEAD')))).toBe(false)
  log = 'b2\tfix: two\n'
  const second = await run($, 'gklog')
  expect(second).toMatch(/2 commits/)
  expect(second).toMatch(/1 entry remembered/)
})

test('the merge preview uses the read-only merge-tree and reports conflicts', async ($, on) => {
  const { calls } = engine(on, {
    ...REPO,
    'for-each-ref': { out: 'refs/heads/main\nrefs/heads/feature/x\n' },
    'rev-parse --abbrev-ref origin/HEAD': { code: 128 },
    'merge-base HEAD main': { out: 'abc123\n' },
    'merge-tree --trivial-merge abc123 HEAD main': { out: 'changed in both\n  base   100644 aa f.txt\n  our    100644 bb f.txt\n  their  100644 cc f.txt\n@@ -1 +1,5 @@\n+<<<<<<< .our\n+x\n+=======\n+y\n+>>>>>>> .their\n' },
  })
  await start($)
  const text = await run($, 'gkmerge')
  expect(text).toMatch(/1 file would conflict/)
  expect(text).toMatch(/f\.txt/)
  expect(calls.some(a => a.includes('--write-tree'))).toBe(false)
})

test('the merge preview is skipped with a reason on an old git', async ($, on) => {
  engine(on, { ...REPO, 'merge-base HEAD main': { out: 'abc\n' }, 'merge-tree': { code: 129, err: "error: unknown option `trivial-merge'" } })
  await start($)
  expect(await run($, 'gkmerge', 'main')).toMatch(/Skipped: this git cannot do a read-only merge preview/)
})

test('/gkignore suggests, and fill asks Claude without changing anything', async ($, on) => {
  const { filled, calls } = engine(on, { ...REPO, 'status --porcelain=v1 -unormal': { out: '?? .env\n?? node_modules/\n?? src/new.ts\n' } })
  await start($)
  const text = await run($, 'gkignore')
  expect(text).toMatch(/SECRET .env\*/)
  expect(text).toMatch(/node_modules\//)
  expect(filled).toEqual([])
  await run($, 'gkignore', 'fill')
  expect(filled[0]).toMatch(/\.gitignore/)
  expect(calls.every(a => !['add', 'commit', 'rm'].includes(a[6] ?? ''))).toBe(true)
})

test('/gkblame summarises authors and respects the size cap', async ($, on) => {
  const { stats } = engine(on, { ...REPO, 'blame --line-porcelain -- f.ts': { out: BLAME } })
  stats['f.ts'] = { kind: 'file', size: 100 }
  stats['huge.ts'] = { kind: 'file', size: 900_000 }
  stats['dir'] = { kind: 'dir', size: 0 }
  await start($)
  expect(await run($, 'gkblame', 'f.ts')).toMatch(/Ann +2 lines +67%/)
  expect(await run($, 'gkblame', 'huge.ts')).toMatch(/over the .* cap/)
  expect(await run($, 'gkblame', 'dir')).toMatch(/not a file/)
  expect(await run($, 'gkblame', 'missing.ts')).toMatch(/no such file/)
  expect(await run($, 'gkblame', '--contents x')).toMatch(/not an option/)
  expect(await run($, 'gkblame', '')).toMatch(/Usage/)
})

test('/gksplit proposes groups and /gkfixup names the last commit that touched a file', async ($, on) => {
  engine(on, {
    ...REPO,
    'status --porcelain=v1 -unormal': { out: ' M src/ui/a.ts\n M src/api/b.ts\n M README.md\n' },
    'status --porcelain=v1': { out: 'M  src/a.ts\n' },
    'log --max-count=5': { out: 'abc1234\t1799000000\tfeat: add a\n' },
  })
  await start($)
  const split = await run($, 'gksplit')
  expect(split).toMatch(/3 changed files could go in 3 commits/)
  expect(split).toMatch(/nothing was staged/)
  const fix = await run($, 'gkfixup', 'src/a.ts')
  expect(fix).toMatch(/Most likely target: abc1234 feat: add a/)
  expect(fix).toMatch(/git commit --fixup=abc1234/)
  expect(await run($, 'gkfixup', '--all')).toMatch(/not options/)
  expect(await run($, 'gkfixup', '')).toMatch(/Most likely target/)
})

test('the release checklist ticks, adds and persists per repo', async ($, on) => {
  engine(on, { ...REPO })
  await start($)
  expect(await run($, 'gkrelease')).toMatch(/0\/7 done/)
  expect(await run($, 'gkrelease', 'tick 2')).toMatch(/1\/7 done[\s\S]*2\. \[x\]/)
  expect(await run($, 'gkrelease', 'add Announce it')).toMatch(/1\/8 done[\s\S]*8\. \[ \] Announce it/)
  expect(await run($, 'gkrelease', 'del 8')).toMatch(/1\/7 done/)
  expect(await run($, 'gkrelease', 'tick 99')).toMatch(/Usage/)
  expect(await run($, 'gkrelease', 'bogus')).toMatch(/Usage/)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-release' })
  await ui.press({ key: 'item-0' })
  expect(await run($, 'gkrelease')).toMatch(/2\/7 done[\s\S]*1\. \[x\]/)
  await ui.unmount()
  expect(await run($, 'gkrelease', 'clear')).toMatch(/0\/7 done/)
})

test('/gkhealth reports branch ages, merged branches and big files', async ($, on) => {
  const now = 1_800_000_000
  const { stats } = engine(on, {
    ...REPO,
    'for-each-ref --format=%(refname:short)': { out: `main\t${now - 50}\torigin/main\t\t*\nold-work\t${now - 300 * 86400}\t\t\t\n` },
    'for-each-ref --format=%(refname)': { out: 'refs/heads/main\nrefs/heads/old-work\n' },
    'rev-parse --abbrev-ref origin/HEAD': { code: 128 },
    'branch --merged main': { out: 'main\nold-work\n' },
    'ls-files -z': { out: 'a.ts\0data/big.bin\0' },
  })
  stats['/r/a.ts'] = { kind: 'file', size: 100 }
  stats['/r/data/big.bin'] = { kind: 'file', size: 4_000_000 }
  await start($)
  const text = await run($, 'gkhealth')
  expect(text).toMatch(/Repo health: 2 local branches, base main/)
  expect(text).toMatch(/old-work .*stale, merged/)
  expect(text).toMatch(/3\.8 MB {2}data\/big\.bin/)
  expect(text).toMatch(/you may delete these yourself/)
})

test('/gkstash shows each stash with its stat', async ($, on) => {
  engine(on, {
    ...REPO,
    'stash list': { out: 'stash@{0}\t1799990000\tWIP on main: abc msg\n' },
    'stash show --stat stash@{0}': { out: ' a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n' },
  })
  await start($)
  const text = await run($, 'gkstash')
  expect(text).toMatch(/Stashes \(1\)/)
  expect(text).toMatch(/stash@\{0\}.*WIP on main/)
  expect(text).toMatch(/a\.ts \| 2/)
})

test('/gktree, /gksub and /gkhooks list worktrees, submodules and hook files without running anything', async ($, on) => {
  const { lists, calls } = engine(on, {
    ...REPO,
    'worktree list --porcelain': { out: 'worktree /r\nHEAD abc1234\nbranch refs/heads/main\n\nworktree /r-wt\nHEAD def5678\nbranch refs/heads/feature/x\n' },
    'submodule status': { out: ' 1234567890abcdef libs/a (v1.0)\n-abcdef1234567890 libs/b\n' },
    'config --get core.hooksPath': { code: 1 },
    'rev-parse --path-format=absolute --git-common-dir': { out: '/r/.git\n' },
  })
  lists['/r/.git/hooks'] = [{ name: 'pre-commit', kind: 'file', size: 300 }, { name: 'pre-push.sample', kind: 'file', size: 900 }]
  await start($)
  const tree = await run($, 'gktree')
  expect(tree).toMatch(/Worktrees \(2\)/)
  expect(tree).toMatch(/feature\/x +\/r-wt/)
  expect(tree).toMatch(/Submodules \(2\)/)
  expect(tree).toMatch(/libs\/b .*not initialised/)
  expect(tree).toMatch(/pre-commit +300 B/)
  expect(await run($, 'gksub')).toMatch(/libs\/a/)
  expect(await run($, 'gkhooks')).toMatch(/Listed only; git-kit never runs hooks/)
  expect(calls.every(a => a[0] === 'git')).toBe(true)
})

test('/gkstatus shows the staged/unstaged map in text and in the pane', async ($, on) => {
  engine(on, { ...REPO, 'status --porcelain=v1 -b': { out: STATUS } })
  await start($)
  const text = await run($, 'gkstatus')
  expect(text).toMatch(/Staged \(3\)/)
  const ui = await $.ui.mount(PANE)
  const shown = await texts(ui)
  expect(shown).toMatch(/Not staged \(2\)/)
  expect(shown).toMatch(/Untracked \(2\)/)
  expect(await ui.find({ type: 'Button', text: /Status/ })).toBeDefined()
  await ui.unmount()
})

test('the pane has a tab for each view and says when nothing was read', async ($, on) => {
  engine(on, { ...REPO, 'status --porcelain=v1 -b': { out: '## main\n' } })
  await start($)
  const ui = await $.ui.mount(PANE)
  expect(await texts(ui)).toMatch(/Nothing read yet/)

  for (const tab of ['status', 'health', 'stash', 'trees', 'release', 'ready']) {
    expect(await ui.find({ key: `tab-${tab}` } as any)).toBeDefined()
  }
  await ui.press({ key: 'tab-status' })
  expect(await texts(ui)).toMatch(/Working tree clean/)
  await ui.unmount()
})

test('/gkready scores tests seen this session, a clean tree and no markers', async ($, on) => {
  const { tool, clock } = engine(on, { ...REPO, 'status --porcelain=v1 -b': { out: '## main...origin/main\n' }, 'diff --check': { out: '' } })
  await start($)
  const before = await run($, 'gkready')
  expect(before).toMatch(/Merge readiness: 60\/100 \(not ready\)/)
  expect(before).toMatch(/No test run seen this session/)

  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  expect(await run($, 'gkready')).toMatch(/100\/100 \(ready\)/)

  await clock.advance(1000)
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts' } as any)
  expect(await run($, 'gkready')).toMatch(/Tests passed, but files were edited after/)

  await clock.advance(1000)
  tool.fn = () => ({ result: {}, isError: true })
  await $.tool.call({ tool: 'Bash', command: 'pytest' } as any)
  expect(await run($, 'gkready')).toMatch(/Last test run failed/)
})

test('/gkready counts leftover conflict markers and a dirty tree', async ($, on) => {
  engine(on, {
    ...REPO,
    'status --porcelain=v1 -b': { out: '## main...origin/main [behind 2]\nUU a.ts\n M b.ts\n' },
    'diff --check': { code: 2, out: 'a.ts:3: leftover conflict marker\n' },
  })
  await start($)
  const text = await run($, 'gkready')
  expect(text).toMatch(/not ready/)
  expect(text).toMatch(/1 unmerged file, 1 leftover marker/)
  expect(text).toMatch(/Behind upstream by 2/)
  expect(text).toMatch(/Conflict markers in: a\.ts/)
})

test('after a turn a toast says you are ahead of upstream, at most once per 10 minutes', async ($, on) => {
  const { toasts, clock } = engine(on, { 'status --porcelain=v1 -b': { out: '## main...origin/main [ahead 3]\n' }, ...REPO })
  await start($)
  await run($, 'gklarge', 'off')
  const turn = () => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  await turn()
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/main is 3 commits ahead of origin\/main/)
  await clock.advance(5 * 60_000)
  await turn()
  expect(toasts).toHaveLength(1)
  await clock.advance(6 * 60_000)
  await turn()
  expect(toasts).toHaveLength(2)
  expect(await run($, 'gkremote', 'off')).toMatch(/off/)
  await clock.advance(20 * 60_000)
  await turn()
  expect(toasts).toHaveLength(2)
})

test('no toast when not ahead, with no upstream; outside a repo git is asked once then left alone for five minutes', async ($, on) => {
  const a = engine(on, { 'status --porcelain=v1 -b': { out: '## main\n' }, ...REPO })
  await start($)
  const turn = () => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  await turn()
  expect(a.toasts).toEqual([])
  expect(a.calls.some(c => c[6] === 'status')).toBe(true)
})

test('outside a repository a turn asks git once, then waits five minutes', async ($, on) => {
  const { toasts, calls, clock } = engine(on)
  await start($)
  const turn = () => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  await turn()
  await turn()
  expect(calls.filter(c => c[6] === 'status')).toHaveLength(1)
  await clock.advance(301_000)
  await turn()
  expect(calls.filter(c => c[6] === 'status')).toHaveLength(2)
  expect(toasts).toEqual([])
})

test('a large changed file toasts once, and not again for the same file', async ($, on) => {
  const { toasts, clock, stats } = engine(on, { 'status --porcelain=v1 -b -uall': { out: '## main\n?? data/huge.bin\n M small.ts\n' }, 'status --porcelain=v1 -uall': { out: '?? data/huge.bin\n M small.ts\n' }, ...REPO })
  stats['/r/data/huge.bin'] = { kind: 'file', size: 50 * 1024 * 1024 }
  stats['/r/small.ts'] = { kind: 'file', size: 10 }
  await start($)
  await run($, 'gkremote', 'off')
  const turn = () => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  await turn()
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/data\/huge\.bin is 50\.0 MB/)
  await clock.advance(10 * 60_000)
  await turn()
  expect(toasts).toHaveLength(1)
  expect(await run($, 'gklarge', '100')).toMatch(/threshold 100 MB/)
  expect(await run($, 'gklarge', 'now')).toMatch(/No changed or untracked file/)
  expect(await run($, 'gklarge', 'abc')).toMatch(/Usage/)
})

test('/gkreset clears settings, checklists and test history', async ($, on) => {
  engine(on, { ...REPO, 'status --porcelain=v1 -b': { out: '## main\n' }, 'diff --check': { out: '' } })
  await start($)
  await run($, 'gklarge', '33')
  await run($, 'gkrelease', 'tick 1')
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  expect(await run($, 'gkready')).toMatch(/100\/100/)
  expect(await run($, 'gkreset')).toMatch(/cleared/)
  expect(await run($, 'gklarge', 'on')).toMatch(/threshold 10 MB/)
  expect(await run($, 'gkrelease')).toMatch(/0\/7 done/)
  expect(await run($, 'gkready')).toMatch(/No test run seen/)
})

test('every process the mod starts is a read-only git call', async ($, on) => {
  const { calls } = engine(on, {
    ...REPO,
    'for-each-ref': { out: 'refs/heads/main\nrefs/heads/feature/x\n' },
    'status': { out: '## main...origin/main [ahead 1]\n M a.ts\n?? b.ts\n' },
    'rev-parse --abbrev-ref origin/HEAD': { out: 'origin/main\n' },
    'log': { out: 'a1\tfeat: x\n' },
    'diff': { out: '' },
    'tag': { out: '' },
    'stash': { out: '' },
    'worktree': { out: '' },
    'submodule': { out: '' },
    'config': { code: 1 },
    'branch': { out: '' },
    'ls-files': { out: '' },
    'merge-base': { out: 'abc\n' },
    'merge-tree': { out: '' },
  })
  await start($)

  for (const c of ['gkmsg', 'gkbranch', 'gkpr', 'gklog', 'gkstatus', 'gkmerge', 'gkstash', 'gktag', 'gkignore', 'gklarge', 'gksplit', 'gkfixup', 'gkhealth', 'gksub', 'gkhooks', 'gkremote', 'gktree', 'gkready']) {
    await run($, c, c === 'gkbranch' ? 'add thing' : '')
  }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  expect(calls.length).toBeGreaterThan(30)

  for (const argv of calls) {
    expect(argv[0]).toBe('git')
    expect(checkGit(argv.slice(6).filter((x, i) => !(i === 1 && (x === '--no-ext-diff' || x === '--no-textconv'))).filter(x => x !== '--no-ext-diff' && x !== '--no-textconv')).ok).toBe(true)
    expect(['rev-parse', 'for-each-ref', 'status', 'log', 'diff', 'tag', 'stash', 'worktree', 'submodule', 'config', 'branch', 'ls-files', 'merge-base', 'merge-tree', 'blame']).toContain(argv[6] ?? '')
  }
})
