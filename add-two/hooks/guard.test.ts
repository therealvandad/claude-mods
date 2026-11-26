import { expect, test } from 'claude-code/testing'

import { FORMATS, RUN_ENV, Refused, checkArgv, checkDu, checkGit, isSafeRef, safeArgv } from './guard'

const ROOT = '/Users/me/proj'
const ok = (...a: string[]) => expect(checkArgv(a, ROOT).ok).toBe(true)
const no = (...a: unknown[]) => expect(checkArgv(a, ROOT).ok).toBe(false)

// Every vector this mod really sends.
const ALLOWED: string[][] = [
  ['git', 'rev-parse', '--show-toplevel'],
  ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
  ['git', 'log', '--graph', '--oneline', '--decorate', '--no-color', '-n', '40'],
  ['git', 'log', '--format=%H|%P|%s|%D', '-n', '60'],
  ['git', 'log', '--no-merges', '--format=%h%x09%s', '-n', '300'],
  ['git', 'log', '--no-merges', '--format=%h%x09%s', '-n', '300', 'v1.2.3..HEAD'],
  ['git', 'log', '--no-merges', '--format=%h%x09%s', '-n', '300', 'release/v2.0.0-rc.1+build..HEAD'],
  ['git', 'tag', '--list', '--merged', 'HEAD', '--sort=-v:refname'],
  ['git', 'status', '--porcelain=v1'],
  ['git', 'status', '--porcelain=v1', '-b'],
  ['git', 'config', '--get', 'remote.origin.url'],
  ['du', '-sk', '--', '/Users/me/proj/src'],
  ['du', '-sk', '--', '/Users/me/proj/src', '/Users/me/proj/node_modules', '/Users/me/proj/dir with space'],
]

test('every vector the mod sends is accepted', () => {
  for (const a of ALLOWED) expect(checkArgv(a, ROOT).ok).toBe(true)
  ok('git', 'log', '-n', '5', 'HEAD')
  ok('git', 'log', '--oneline', '-n', '500')
})

test('write verbs of git are refused, in every spelling', () => {
  const writers = [
    'add', 'commit', 'push', 'pull', 'fetch', 'checkout', 'switch', 'restore', 'reset', 'rebase', 'merge', 'cherry-pick', 'revert', 'clean',
    'rm', 'mv', 'init', 'clone', 'gc', 'prune', 'am', 'apply', 'bisect', 'notes', 'update-ref', 'update-index', 'symbolic-ref', 'hash-object',
    'write-tree', 'commit-tree', 'replace', 'reflog', 'filter-branch', 'format-patch', 'archive', 'bundle', 'fsck', 'repack', 'maintenance',
    'sparse-checkout', 'lfs', 'daemon', 'send-email', 'pack-objects', 'read-tree', 'stage', 'stash', 'worktree', 'submodule', 'remote',
    'branch', 'diff', 'show', 'blame', 'describe', 'ls-files', 'for-each-ref', 'merge-base', 'merge-tree', 'help', 'version',
  ]

  for (const w of writers) {
    no('git', w)
    no('git', w, '--help')
    no('git', w.toUpperCase())
  }
})

test('global git options and config injection are refused', () => {
  no('git', '-c', 'core.pager=evil', 'log', '-n', '1')
  no('git', '--exec-path=/tmp', 'log', '-n', '1')
  no('git', '--git-dir=/tmp/x', 'status', '--porcelain=v1')
  no('git', '-C', '/', 'status', '--porcelain=v1')
  no('git', '--upload-pack=x', 'log', '-n', '1')
  no('git', '--no-pager', 'log', '-n', '1')
  no('git')
  no('git', '')
})

test('log refuses output flags, pagers, diffs, unknown formats and odd revisions', () => {
  const bad = [
    ['--output=/tmp/x'], ['--output', '/tmp/x'], ['-p'], ['--patch'], ['--stat'], ['--all'], ['--author=x'], ['--grep=x'], ['--since=1.day'],
    ['--ext-diff'], ['--textconv'], ['--follow'], ['--no-index'], ['--', 'file'], ['-S', 'x'], ['--format=%an'], ['--format=%H'], ['--format='],
    ['--pretty=oneline'], ['--format=%H|%P|%s|%D%x00'], ['-nx'], ['-n5'], ['--max-count=5'], ['main'], ['HEAD~3'], ['HEAD^'], ['a..b'], ['..HEAD'],
    ['-v1..HEAD'], ['a/../b..HEAD'], ['x..HEAD', 'y..HEAD'], ['HEAD', 'HEAD'], ['v1..HEAD..HEAD'], ['v1@{1}..HEAD'], ['v1:..HEAD'], ['v1 ..HEAD'], ['v1\n..HEAD'],
    ['--color=always'], ['--decorate=full'], ['--decorate-refs=x'], ['--graph=1'], ['-c'], ['--git-dir=x'], ['--exec=x'],
  ]

  for (const b of bad) no('git', 'log', '-n', '5', ...b)
  no('git', 'log') // needs -n
  no('git', 'log', '-n') // needs a number
  no('git', 'log', '-n', '0')
  no('git', 'log', '-n', '501')
  no('git', 'log', '-n', '-5')
  no('git', 'log', '-n', '5', '-n', '6')
  no('git', 'log', '-n', '1e3')
  no('git', 'log', '-n', '5', '--format=%H|%P|%s|%D', '--format=%h%x09%s')
})

test('only the exact forms of tag, status, config and rev-parse pass', () => {
  no('git', 'tag')
  no('git', 'tag', 'v1.0')
  no('git', 'tag', '-d', 'v1.0')
  no('git', 'tag', '--list')
  no('git', 'tag', '--list', '--merged', 'HEAD')
  no('git', 'tag', '--list', '--merged', 'main', '--sort=-v:refname')
  no('git', 'tag', '--list', '--merged', 'HEAD', '--sort=-v:refname', 'extra')
  no('git', 'status')
  no('git', 'status', '--porcelain=v2')
  no('git', 'status', '--porcelain=v1', '-uall')
  no('git', 'status', '--porcelain=v1', '--ignored')
  no('git', 'status', '--porcelain=v1', '-b', '-b')
  no('git', 'config', '--get', 'user.email')
  no('git', 'config', '--get', 'remote.origin.url', 'x')
  no('git', 'config', 'remote.origin.url', 'https://evil')
  no('git', 'config', '--unset', 'remote.origin.url')
  no('git', 'config', '--list')
  no('git', 'config', '--get-regexp', '.')
  no('git', 'rev-parse', '--git-dir')
  no('git', 'rev-parse', '--abbrev-ref', 'main')
  no('git', 'rev-parse', '--show-toplevel', 'x')
  no('git', 'rev-parse', 'HEAD')
})

test('du is allowed only as du -sk -- absolute paths', () => {
  const p = '/Users/me/proj/a'
  no('du', '-sk', '--', '/etc')
  no('du', '-sk', '--', '/Users/me/proj')
  no('du', '-sk', '--', '/Users/me/projx/a')
  no('du', '-sk', '--', p, '/Users/me/other/a')
  expect(checkArgv(['du', '-sk', '--', p]).ok).toBe(false) // no root given
  expect(checkArgv(['du', '-sk', '--', p], '/').ok).toBe(false)
  expect(checkArgv(['du', '-sk', '--', p], 'rel').ok).toBe(false)
  no('du')
  no('du', '-sk')
  no('du', '-sk', '--')
  no('du', '-sk', p)
  no('du', '-s', '--', p)
  no('du', '-sk', '-L', '--', p)
  no('du', '-skL', '--', p)
  no('du', '-sk', '--', 'relative/dir')
  no('du', '-sk', '--', '-x')
  no('du', '-sk', '--', '/Users/me/proj/../etc')
  no('du', '-sk', '--', '/Users/me/proj/b\nc')
  no('du', '-sk', '--', '/Users/me/proj/b\rc')
  no('du', '-sk', '--', `/Users/me/proj/${'x'.repeat(1030)}`)
  no('du', '-sk', '--', p, 'relative')
  no('du', '-sk', '--', ...Array.from({ length: 13 }, (_, i) => `/Users/me/proj/d${i}`))
  no('du', '-h', '--', p)
  no('du', '-sk', '--', p, '-L')
  expect(checkDu(['-sk', '--', p], ROOT).ok).toBe(true)
})

test('other programs and odd vectors are refused', () => {
  const progs = ['sh', 'bash', 'zsh', 'rm', 'curl', 'wget', 'python3', 'node', 'env', 'sudo', 'find', 'cat', 'ls', 'ssh', 'gh', 'npm', 'make', 'GIT', 'Git', '/usr/bin/git', './git', 'git ', ' git', 'git;ls']

  for (const p of progs) {
    no(p)
    no(p, 'log', '-n', '5')
    no(p, '-c', 'ls')
  }
  no()
  no('')
  no(['git', 'log'])
  expect(checkArgv('git log -n 5').ok).toBe(false)
  expect(checkArgv(undefined).ok).toBe(false)
  expect(checkArgv(null).ok).toBe(false)
  expect(checkArgv({ 0: 'git' }).ok).toBe(false)
  expect(checkArgv(['git', 5]).ok).toBe(false)
  expect(checkArgv(['git', null]).ok).toBe(false)
  no('git', 'log', '-n', '5\0')
  no('git', 'log', '-n', '5', ...Array.from({ length: 20 }, () => 'HEAD'))
})

test('appending any word to any allowed vector makes it refused', () => {
  const nasty = ['--output=/tmp/x', '-c', 'x', '--', '--exec', ';', '|', '&&', '$(id)', '`id`', '../x', '/etc/passwd', '-p', '--all', '*', '-n', '5', 'HEAD', '']

  for (const a of ALLOWED) {
    // log forms take an optional rev, so skip words that are allowed there on their own.
    for (const w of nasty) {
      const v = [...a, w]
      const verdict = checkArgv(v, ROOT)

      if (a[1] === 'log' && w === 'HEAD' && !a.includes('HEAD') && !a.some(x => x.endsWith('..HEAD'))) {
        continue
      }
      expect(verdict.ok).toBe(false)
    }
  }
})

test('changing any word of any allowed vector to a hostile one makes it refused', () => {
  const hostile = ['--output=/tmp/x', '-c', '--exec-path=x', '--upload-pack=x', '$(id)', '`id`', '; ls', '../x', '/etc/passwd', '--help', '--version', '-p', '--all']

  for (const a of ALLOWED) {
    for (let i = 1; i < a.length; i++) {
      for (const w of hostile) {
        const v = a.map((x, k) => (k === i ? w : x))

        expect(checkArgv(v, ROOT).ok).toBe(false)
      }
    }
  }
})

test('refs are plain names only', () => {
  for (const r of ['v1.0.0', 'release/v2', 'a-b_c', 'feature/x+y', 'v1@2']) expect(isSafeRef(r)).toBe(true)

  for (const r of ['', '-x', '--output', 'a..b', 'a b', 'a\n', 'a^', 'a~1', 'a:b', 'a@{1}', 'a/', 'a//b', 'x.lock', '.hidden', 'a;b', 'a$b', 'a`b', 'x'.repeat(101)]) {
    expect(isSafeRef(r)).toBe(false)
  }
})

test('the formats list holds exactly the two formats the mod uses', () => {
  expect(FORMATS).toEqual(['%H|%P|%s|%D', '%h%x09%s'])
  expect(checkGit(['log', '-n', '1', '--format=%H|%P|%s|%D']).ok).toBe(true)
})

test('safeArgv throws Refused for a refusal and fixes git options and environment', () => {
  expect(() => safeArgv(['git', 'push'])).toThrow(Refused)
  expect(() => safeArgv(['rm', '-rf', '/'])).toThrow(Refused)
  expect(() => safeArgv(['git', 'log', '-n', '1', '--output=/tmp/x'])).toThrow(/refused/)
  const v = safeArgv(['git', 'log', '-n', '3'])
  expect(v.slice(0, 2)).toEqual(['git', '--no-pager'])
  expect(v).toContain('core.fsmonitor=false')
  expect(v).toContain('log.showSignature=false')
  expect(v.slice(-3)).toEqual(['log', '-n', '3'])
  expect(safeArgv(['du', '-sk', '--', '/a/b'], '/a')).toEqual(['du', '-sk', '--', '/a/b'])
  expect(() => safeArgv(['du', '-sk', '--', '/a/b'])).toThrow(Refused)
  expect(RUN_ENV.GIT_OPTIONAL_LOCKS).toBe('0')
  expect(RUN_ENV.GIT_TERMINAL_PROMPT).toBe('0')
})
