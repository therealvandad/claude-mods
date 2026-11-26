import { expect, test } from 'claude-code/testing'

import { Refused, SAFE_ENV, checkArgv, isInside, safeArgv } from './guard'

const ROOT = '/work/proj'
const ctx = { root: ROOT }
const explicit = { root: ROOT, isExplicit: true }
const ok = (argv: string[], c = ctx) => expect(checkArgv(argv, c).ok).toBe(true)
const no = (argv: unknown, c = ctx) => expect(checkArgv(argv, c).ok).toBe(false)

test('every shape the mod uses is accepted', () => {
  ok(['git', 'rev-parse', '--show-toplevel'])
  ok(['git', 'rev-parse', '--is-inside-work-tree'])
  ok(['git', 'status', '--porcelain=v1', '-b', '-unormal'])
  ok(['git', 'for-each-ref', '--format=%(refname:short)%09%(committerdate:unix)%09%(HEAD)', 'refs/heads'])
  ok(['git', 'log', '-1', '--format=%ct'])
  ok(['git', 'ls-files', '--others', '--exclude-standard'])
  ok(['git', 'ls-files', '--', '*.pem', ':(glob)**/.env*'])
  ok(['git', 'check-ignore', '-q', '--', '.env'])
  ok(['git', 'branch', '--list'])
  ok(['git', 'branch', '--merged', 'main', '--format=%(refname:short)'])
  ok(['git', 'diff', '--stat'])
  ok(['git', 'tag', '-l'])
  ok(['git', 'remote', '-v'])
  ok(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'])
  ok(['ps', '-axo', 'pid,comm,pcpu,pmem'])
  ok(['df', '-k'])
  ok(['df', '-k', ROOT])
  ok(['du', '-sk', ROOT])
  ok(['du', '-k', '-d', '1', ROOT])
  ok(['du', '-k', '-d', '3', `${ROOT}/src`])
  ok(['ls'])
  ok(['ls', '-1A'])
  ok(['ls', '-lAp', ROOT])
  ok(['ls', ROOT])
  ok(['npm', 'outdated', '--json'], explicit)
  ok(['pip', 'list', '--outdated', '--format', 'json'], explicit)
  ok(['pip3', 'list', '--outdated', '--format', 'json'], explicit)
})

test('npm and pip are refused unless the person typed the command', () => {
  no(['npm', 'outdated', '--json'])
  no(['pip', 'list', '--outdated', '--format', 'json'])
  no(['pip3', 'list', '--outdated', '--format', 'json'], { root: ROOT, isExplicit: false })
})

test('git write verbs are all refused', () => {
  for (const verb of ['add', 'commit', 'push', 'pull', 'fetch', 'checkout', 'switch', 'reset', 'clean', 'merge', 'rebase', 'cherry-pick', 'revert', 'stash', 'apply', 'am', 'mv', 'rm', 'restore', 'init', 'clone', 'gc', 'prune', 'worktree', 'submodule', 'config', 'update-ref', 'symbolic-ref', 'hash-object', 'filter-branch', 'notes', 'bisect', 'blame', 'show', 'archive', 'bundle', 'daemon', 'instaweb', 'send-email']) {
    no(['git', verb])
    no(['git', verb, 'x'])
  }
})

test('git read verbs are refused when they carry a write flag or a name that would create something', () => {
  no(['git', 'branch', 'newbranch'])
  no(['git', 'branch', '-d', 'old'])
  no(['git', 'branch', '-D', 'old'])
  no(['git', 'branch', '-m', 'a', 'b'])
  no(['git', 'branch', '--delete', 'x'])
  no(['git', 'branch', '--set-upstream-to=origin/x'])
  no(['git', 'tag', 'v1'])
  no(['git', 'tag', '-d', 'v1'])
  no(['git', 'tag'])
  no(['git', 'remote', 'add', 'x', 'url'])
  no(['git', 'remote', 'remove', 'origin'])
  no(['git', 'remote', 'set-url', 'origin', 'x'])
  no(['git', 'remote'])
  no(['git', 'log', '--output=/tmp/x'])
  no(['git', 'diff', '--output=/tmp/x'])
  no(['git', 'diff', '--no-index', 'a', 'b'])
  no(['git', 'log', '--exec=ls'])
  no(['git', 'status', '--bogus'])
  no(['git', 'ls-files', '--bogus'])
  no(['git', 'rev-parse', '--git-path', 'x'])
  no(['git', 'for-each-ref', '--format'])
})

test('global git options and config injection are refused', () => {
  no(['git', '-C', '/', 'status'])
  no(['git', '-c', 'core.pager=ls', 'status'])
  no(['git', '--git-dir=/x', 'status'])
  no(['git', '--exec-path'])
  no(['git', '--no-pager', 'status'])
  no(['git', '-c', 'alias.x=!rm -rf /', 'x'])
  no(['git', 'log', '-c', 'core.x=y'])
  no(['git', 'log', '--format', '-x'])
  no(['git'])
})

test('lsof, ps, df, du and ls refuse every other argument vector', () => {
  no(['lsof'])
  no(['lsof', '-i'])
  no(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-t'])
  no(['lsof', '-nP', '-iTCP:80', '-sTCP:LISTEN'])
  no(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-r', '1'])
  no(['lsof', '+D', '/'])
  no(['ps'])
  no(['ps', 'aux'])
  no(['ps', '-ef'])
  no(['ps', '-axo', 'pid,command'])
  no(['ps', '-axo', 'pid,comm,pcpu,pmem', '-r'])
  no(['ps', '-axo', 'pid,comm,pcpu,pmem', 'x'])
  no(['kill', '-9', '1'])
  no(['killall', 'node'])
  no(['df'])
  no(['df', '-h'])
  no(['df', '-k', '-a'])
  no(['df', '-k', '/etc'])
  no(['df', '-k', '-x', 'tmpfs'])
  no(['du'])
  no(['du', '-sk'])
  no(['du', '-sk', '/'])
  no(['du', '-sk', '/etc'])
  no(['du', '-k', '-d', '9', ROOT])
  no(['du', '-k', '-d', '1'])
  no(['du', '-ak', ROOT])
  no(['du', '-sk', `${ROOT}/../other`])
  no(['du', '-sk', '/work/project2'])
  no(['ls', '-R', ROOT])
  no(['ls', '-lR'])
  no(['ls', '-1', '/etc'])
  no(['ls', ROOT, ROOT])
  no(['ls', '--color=always'])
  no(['ls', '-1A', '-l'])
})

test('npm and pip refuse everything but the outdated listing', () => {
  for (const argv of [
    ['npm'], ['npm', 'install'], ['npm', 'i', 'x'], ['npm', 'ci'], ['npm', 'update'], ['npm', 'publish'], ['npm', 'run', 'build'], ['npm', 'test'], ['npm', 'outdated'], ['npm', 'outdated', '--json', '-g'],
    ['npm', 'outdated', '--json', '--global'], ['npm', 'outdated', '--long'], ['npm', 'audit', 'fix'], ['npm', 'config', 'set', 'x', 'y'], ['npm', '--prefix', '/', 'outdated', '--json'],
    ['npx', 'x'], ['yarn', 'outdated'], ['pnpm', 'outdated'],
    ['pip', 'install', 'x'], ['pip', 'uninstall', 'x'], ['pip', 'list'], ['pip', 'list', '--outdated'], ['pip', 'list', '--outdated', '--format', 'json', '--user'], ['pip', 'download', 'x'], ['pip', 'config', 'set', 'a', 'b'],
    ['pip3', 'install', 'x'], ['python', '-m', 'pip', 'list'], ['python3', '-c', 'print(1)'],
  ]) {
    no(argv, explicit)
  }
})

test('other programs, shells and odd values are refused', () => {
  for (const argv of [
    ['rm', '-rf', '/'], ['rm', 'x'], ['sh', '-c', 'ls'], ['bash', '-c', 'ls'], ['zsh'], ['env'], ['xargs', 'ls'], ['find', '.'], ['cat', '/etc/passwd'], ['curl', 'https://example.com'], ['wget', 'x'],
    ['mv', 'a', 'b'], ['cp', 'a', 'b'], ['chmod', '777', 'x'], ['touch', 'x'], ['tee', 'x'], ['sed', '-i', 's/a/b/', 'x'], ['sudo', 'ls'], ['open', 'x'], ['osascript'], ['/bin/ls'], ['./git', 'status'], ['GIT', 'status'],
    ['ls;rm', 'x'], ['git status'], ['git;rm', 'status'], ['lsof -nP -iTCP -sTCP:LISTEN'],
  ]) {
    no(argv, explicit)
  }
  no([], explicit)
  no('git status', explicit)
  no(undefined, explicit)
  no(null, explicit)
  no([1, 2], explicit)
  no(['git', 'status', 5], explicit)
  no(['git', 'status', 'a\0b'], explicit)
  no(['ls', 'x'.repeat(2000)], explicit)
})

test('paths must be absolute, inside the project, with no dot segments', () => {
  expect(isInside(ROOT, ROOT)).toBe(true)
  expect(isInside(ROOT, `${ROOT}/a/b`)).toBe(true)
  expect(isInside('/work/proj/', `${ROOT}/a`)).toBe(true)
  expect(isInside(ROOT, '/work/proj2')).toBe(false)
  expect(isInside(ROOT, '/work')).toBe(false)
  expect(isInside(ROOT, `${ROOT}/../x`)).toBe(false)
  expect(isInside(ROOT, `${ROOT}/./x`)).toBe(false)
  expect(isInside(ROOT, 'proj/x')).toBe(false)
  expect(isInside('rel', 'rel/x')).toBe(false)
  expect(isInside(ROOT, `${ROOT}/a\0`)).toBe(false)
  expect(isInside('/', '/etc')).toBe(true)
})

test('safeArgv throws Refused for a refused vector and adds the fixed git options for a good one', () => {
  expect(() => safeArgv(['rm', '-rf', '/'], ctx)).toThrow(Refused)
  expect(() => safeArgv(['git', 'push'], ctx)).toThrow(/add-kit refused/)
  expect(() => safeArgv(['npm', 'outdated', '--json'], ctx)).toThrow(Refused)
  expect(safeArgv(['git', 'status', '-b'], ctx)).toEqual(['git', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', 'status', '-b'])
  expect(safeArgv(['git', 'log', '-1', '--format=%ct'], ctx)).toEqual(['git', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', 'log', '--no-ext-diff', '--no-textconv', '-1', '--format=%ct'])
  expect(safeArgv(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'], ctx)).toEqual(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'])
  expect(safeArgv(['npm', 'outdated', '--json'], explicit)).toEqual(['npm', 'outdated', '--json'])
})

test('the fixed environment stops git writing and npm or pip phoning home for notices', () => {
  expect(SAFE_ENV.GIT_OPTIONAL_LOCKS).toBe('0')
  expect(SAFE_ENV.GIT_TERMINAL_PROMPT).toBe('0')
  expect(SAFE_ENV.NPM_CONFIG_UPDATE_NOTIFIER).toBe('false')
  expect(SAFE_ENV.PIP_DISABLE_PIP_VERSION_CHECK).toBe('1')
})
