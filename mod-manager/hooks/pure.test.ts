import { expect, test } from 'claude-code/testing'

import type { Installed } from '../types'
import { CATALOG } from './catalog'
import type { CatalogMod } from './catalog'
import {
  BUILTIN_BUNDLES,
  CATEGORIES,
  COMMANDS,
  GUARDS,
  FEATURE_KINDS,
  LOG_MAX,
  UNMUTABLE,
  PENDING_MS,
  allBundleNames,
  baseName,
  buildReport,
  bundleMembers,
  changedSwitches,
  chipFor,
  cleanOverrides,
  compareVersions,
  diffRemote,
  discoverBundled,
  featureArgs,
  featureLine,
  featureRows,
  findInstalled,
  formatOutput,
  guardCheck,
  headLines,
  isPersonOrigin,
  isSafeHome,
  makePending,
  maskSecrets,
  mkEntry,
  normalizeLog,
  orderMods,
  modFeatureRow,
  paginateUnits,
  parseBundleArgs,
  parseFeaturesArgs,
  presetArgs,
  parseDoArgs,
  parseModList,
  parsePluginList,
  parseSourceUrl,
  pendingState,
  planBundle,
  pushLog,
  repoFromUrl,
  resolveTarget,
  sanitize,
  searchCatalog,
  secondsLeft,
  statusOf,
  stepArgs,
  stepArgv,
  stepIsValid,
  stepLine,
  tailLines,
  validateMarketplace,
  versionDirsHighestFirst,
} from './pure'

// A home directory spelled without a literal path in this file.
const HOME = ['', 'Users', 'bob'].join('/')
const inst = (id: string, version = '1.0.0', status: Installed['status'] = 'enabled', scope = 'user'): Installed => {
  const at = id.indexOf('@')

  return { id, name: at < 0 ? id : id.slice(0, at), market: at < 0 ? '' : id.slice(at + 1), version, scope, status }
}

// ------------------------------------------------------------ argv validation: accepted

test('/mmdo accepts each verb with a plain name and defaults to scope user', async () => {
  for (const verb of ['install', 'enable', 'disable', 'update', 'uninstall']) {
    expect(parseDoArgs(`${verb} notes`)).toEqual({ kind: 'action', verb, name: 'notes', scope: 'user', hasYes: false })
  }
})

test('/mmdo accepts name@marketplace, a scope, and any case for the verb', async () => {
  expect(parseDoArgs('install foo@some-market')).toMatchObject({ kind: 'action', name: 'foo@some-market', scope: 'user' })
  expect(parseDoArgs('install foo --scope project')).toMatchObject({ scope: 'project' })
  expect(parseDoArgs('update foo --scope=local')).toMatchObject({ scope: 'local' })
  expect(parseDoArgs('--scope user')).toMatchObject({ kind: 'error' })
  expect(parseDoArgs('INSTALL foo')).toMatchObject({ kind: 'action', verb: 'install' })
  expect(parseDoArgs('install a.b_c-d@m.1')).toMatchObject({ kind: 'action' })
  expect(parseDoArgs('install ' + 'a'.repeat(64))).toMatchObject({ kind: 'action' })
})

test('/mmdo with nothing, confirm and cancel are their own forms', async () => {
  expect(parseDoArgs('')).toEqual({ kind: 'help' })
  expect(parseDoArgs('  confirm ')).toEqual({ kind: 'confirm' })
  expect(parseDoArgs('CANCEL')).toEqual({ kind: 'cancel' })
  expect(parseDoArgs('confirm foo')).toMatchObject({ kind: 'error' })
})

// ------------------------------------------------------------ argv validation: refused

test('/mmdo refuses unknown verbs, missing names and extra names', async () => {
  for (const bad of ['frobnicate foo', 'install', 'install a b', 'remove foo', 'list']) {
    expect(parseDoArgs(bad).kind).toBe('error')
  }
})

test('/mmdo refuses every flag but --scope (and the guard word where it applies)', async () => {
  for (const bad of ['install foo --force', 'install foo -y', 'install foo --json', 'install foo --marketplace x/y', 'update foo --accept-command abc', 'install foo --config a=b', 'uninstall foo --prune', 'uninstall foo --keep-data', 'install foo --scope', 'install foo --scope managed', 'install foo --scope user --scope local', 'install -s user foo', 'install foo --yes-i-know']) {
    expect(parseDoArgs(bad).kind).toBe('error')
  }
})

test('/mmdo refuses names that are not plugin names, so nothing odd reaches an argument list', async () => {
  const bad = [
    'Foo', '-x', '_x', '.x', 'foo;ls', 'foo&&ls', 'foo|cat', 'foo$(id)', 'foo`id`', 'foo/bar', '../x', 'foo bar@x y', 'a'.repeat(65), '@market', 'foo@', 'foo@a@b', 'foo@Bar', 'foö', 'foo\u0000', 'foo>x', "foo'x", 'foo"x', 'foo*', '~', 'foo=1',
  ]

  for (const name of bad) {
    const out = parseDoArgs(`install ${name}`)

    expect(out.kind === 'error' || out.kind === 'action' && /^[a-z0-9][a-z0-9._-]{0,63}(@[a-z0-9._-]{1,63})?$/.test(out.name)).toBe(true)

    // Whatever is accepted must itself be a clean name.
    if (out.kind === 'action') {
      expect(name.includes(' ')).toBe(false)
    }
  }

  for (const name of ['Foo', '-x', 'foo;ls', 'foo$(id)', 'foo/bar', '../x', '@market', 'foo@', 'foo@a@b', 'a'.repeat(65), 'foo>x']) {
    expect(parseDoArgs(`install ${name}`).kind).toBe('error')
  }
})

// ------------------------------------------------------------ guards

test('guards and the manager itself are protected from disable and uninstall', async () => {
  for (const guard of GUARDS) {
    for (const verb of ['disable', 'uninstall']) {
      expect(parseDoArgs(`${verb} ${guard}`).kind).toBe('error')
      expect(parseDoArgs(`${verb} ${guard}@local-mods`).kind).toBe('error')
      expect(parseDoArgs(`${verb} ${guard} --yes-i-know`)).toMatchObject({ kind: 'action', hasYes: true, name: guard })
      expect(parseDoArgs(`${verb} ${guard}@m --yes-i-know --scope local`)).toMatchObject({ kind: 'action', scope: 'local' })
    }
    // Turning a guard on or updating it needs no extra word.
    expect(parseDoArgs(`enable ${guard}`).kind).toBe('action')
    expect(parseDoArgs(`update ${guard}`).kind).toBe('action')
    expect(parseDoArgs(`install ${guard}`).kind).toBe('action')
    // The word is for guards being weakened, and nowhere else.
    expect(parseDoArgs(`enable ${guard} --yes-i-know`).kind).toBe('error')
  }
  expect(GUARDS).toEqual(['tool-guard', 'safety-pro', 'controls'])
})

test('mod-manager is never disabled or uninstalled from here, not even with the guard word', async () => {
  for (const verb of ['disable', 'uninstall']) {
    for (const name of ['mod-manager', 'mod-manager@local-mods', 'mod-manager@x']) {
      expect(parseDoArgs(`${verb} ${name}`).kind).toBe('error')
      expect(parseDoArgs(`${verb} ${name} --yes-i-know`).kind).toBe('error')
    }
  }

  for (const verb of ['install', 'enable', 'update']) {
    expect(parseDoArgs(`${verb} mod-manager`).kind).toBe('action')
  }
  expect(guardCheck('disable', 'mod-manager', true).ok).toBe(false)
  expect(guardCheck('disable', 'notes', false).ok).toBe(true)
  // A name that merely contains a guard's name is not a guard.
  expect(parseDoArgs('uninstall tool-guard-extra').kind).toBe('action')
  expect(baseName('tool-guard@x')).toBe('tool-guard')
})

// ------------------------------------------------------------ the command line

test('a step is an argument list: no shell, one flag pair, default scope user', async () => {
  const step = { verb: 'install', target: 'notes@local-mods', scope: 'user' } as const

  expect(stepArgs(step)).toEqual(['plugin', 'install', 'notes@local-mods', '--scope', 'user'])
  expect(stepLine(step)).toBe('claude plugin install notes@local-mods --scope user')
  expect(stepArgv(['claude'], step)).toEqual(['claude', 'plugin', 'install', 'notes@local-mods', '--scope', 'user'])
  expect(stepArgv(['/some bin/claude'], step)[0]).toBe('/some bin/claude')
  expect(stepArgv(['/some bin/claude'], step).length).toBe(6)
  expect(stepIsValid(step)).toBe(true)
  expect(stepIsValid({ ...step, target: 'a;b' })).toBe(false)
  expect(stepIsValid({ ...step, verb: 'purge' as never })).toBe(false)
  expect(stepIsValid({ ...step, scope: 'managed' as never })).toBe(false)
  expect(stepIsValid({ verb: 'disable', target: 'mod-manager', scope: 'user' })).toBe(false)
})

test('install adds the marketplace, other verbs use the installed id when it is unique', async () => {
  const list = [inst('notes@market-a'), inst('dup@a'), inst('dup@b')]

  expect(resolveTarget('install', 'notes', 'local-mods', list)).toBe('notes@local-mods')
  expect(resolveTarget('install', 'notes@other', 'local-mods', list)).toBe('notes@other')
  expect(resolveTarget('enable', 'notes', 'local-mods', list)).toBe('notes@market-a')
  expect(resolveTarget('enable', 'dup', 'local-mods', list)).toBe('dup')
  expect(resolveTarget('enable', 'zzz', 'local-mods', null)).toBe('zzz')
})

// ------------------------------------------------------------ pending expiry

test('a pending action lasts two minutes and is single use', async () => {
  const step = { verb: 'enable', target: 'notes', scope: 'user' } as const
  const p = makePending([step], 'enable notes', 1000)

  expect(PENDING_MS).toBe(120_000)
  expect(p.expiresAt).toBe(121_000)
  expect(pendingState(null, 5)).toBe('none')
  expect(pendingState(p, 1000)).toBe('valid')
  expect(pendingState(p, 120_999)).toBe('valid')
  expect(pendingState(p, 121_000)).toBe('expired')
  expect(pendingState(p, 9_999_999)).toBe('expired')
  expect(secondsLeft(p, 1000)).toBe(120)
  expect(secondsLeft(p, 120_500)).toBe(1)
  expect(secondsLeft(p, 130_000)).toBe(0)
})

test('only a person confirms', async () => {
  expect(isPersonOrigin({ kind: 'composer' })).toBe(true)
  expect(isPersonOrigin({ kind: 'bridge' })).toBe(true)
  expect(isPersonOrigin({ kind: 'unclassified' })).toBe(true)

  for (const kind of ['plugin', 'sdk', 'scheduled-trigger', 'task-notification', 'peer', 'channel', 'coordinator', 'auto-continuation']) {
    expect(isPersonOrigin({ kind, name: 'x' })).toBe(false)
  }
  expect(isPersonOrigin(undefined)).toBe(false)
  expect(isPersonOrigin('user')).toBe(false)
  expect(isPersonOrigin(null)).toBe(false)
})

// ------------------------------------------------------------ versions

test('version comparison', async () => {
  const table: [string, string, -1 | 0 | 1 | null][] = [
    ['0.1.0', '0.1.0', 0],
    ['0.1.0', '0.2.0', -1],
    ['0.10.0', '0.9.0', 1],
    ['1.0', '1.0.0', 0],
    ['1.2.3', '1.2.4', -1],
    ['2.0.0', '1.99.99', 1],
    ['v1.0.0', '1.0.0', 0],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0+build5', '1.0.0+build9', 0],
    ['abc', '1.0.0', null],
    ['', '1.0.0', null],
    ['1.0.0', 'latest', null],
    ['1..0', '1.0.0', null],
  ]

  for (const [a, b, want] of table) {
    expect(compareVersions(a, b)).toBe(want)
  }
})

// ------------------------------------------------------------ CLI discovery over a fake listing

const fakeFs = (tree: Record<string, { name: string; kind: string }[]>) => async (path: string) => {
  const hit = tree[path]

  if (hit === undefined) {
    throw new Error('ENOENT')
  }

  return hit
}
const ROOT = `${HOME}/Library/Application Support/Claude/claude-code`
const bin = (v: string, h: string) => `${ROOT}/${v}/${h}/claude.app/Contents/MacOS/claude`
const dir = (name: string) => ({ name, kind: 'dir' })
const file = (name: string) => ({ name, kind: 'file' })

test('the highest version folder and the hash folder inside give the bundled binary', async () => {
  const fs = fakeFs({
    [ROOT]: [dir('2.1.9'), dir('2.1.330'), dir('2.0.1000'), file('notes.txt'), dir('latest')],
    [`${ROOT}/2.1.330`]: [dir('4262a1273231')],
  })

  expect(await discoverBundled(HOME, fs)).toEqual([bin('2.1.330', '4262a1273231')])
})

test('versions compare as numbers, not text', async () => {
  const names = versionDirsHighestFirst([dir('2.1.9'), dir('2.1.330'), dir('10.0.0'), dir('2.1'), file('9.9.9'), dir('x.y')])

  expect(names).toEqual(['10.0.0', '2.1.330', '2.1.9', '2.1'])
})

test('a version folder with no hash folder falls back to the next one down', async () => {
  const fs = fakeFs({
    [ROOT]: [dir('2.2.0'), dir('2.1.330')],
    [`${ROOT}/2.2.0`]: [file('stray')],
    [`${ROOT}/2.1.330`]: [dir('abc123')],
  })

  expect(await discoverBundled(HOME, fs)).toEqual([bin('2.1.330', 'abc123')])
})

test('several hash folders are all offered, in a stable order, and files are not', async () => {
  const fs = fakeFs({
    [ROOT]: [dir('1.0.0')],
    [`${ROOT}/1.0.0`]: [dir('bbb'), dir('aaa'), file('ccc'), dir('.hidden')],
  })

  expect(await discoverBundled(HOME, fs)).toEqual([bin('1.0.0', 'aaa'), bin('1.0.0', 'bbb')])
})

test('discovery finds nothing when the folder or the home is missing or odd', async () => {
  expect(await discoverBundled(HOME, fakeFs({}))).toEqual([])
  expect(await discoverBundled(undefined, fakeFs({}))).toEqual([])
  expect(await discoverBundled('', fakeFs({}))).toEqual([])
  expect(await discoverBundled('rel-home', fakeFs({ [`rel-home/${'Library/Application Support/Claude/claude-code'}`]: [dir('1.0.0')] }))).toEqual([])
  expect(await discoverBundled('/a/../b', fakeFs({}))).toEqual([])
  expect(await discoverBundled(HOME, fakeFs({ [ROOT]: [] }))).toEqual([])
  expect(isSafeHome(HOME)).toBe(true)
  expect(isSafeHome('/')).toBe(false)
  expect(isSafeHome('/x\n/y')).toBe(false)
})

test('a trailing slash on the home does not double up', async () => {
  const fs = fakeFs({ [ROOT]: [dir('1.2.3')], [`${ROOT}/1.2.3`]: [dir('h1')] })

  expect(await discoverBundled(`${HOME}/`, fs)).toEqual([bin('1.2.3', 'h1')])
})

// ------------------------------------------------------------ the installed list

const HUMAN = `Installed plugins:

  ❯ alerts@local-mods
    Version: 0.1.0
    Read from: ${HOME}/mods/alerts
    Scope: user
    Status: ✔ enabled

  ❯ other-tool@some-market
    Version: 2.3.4
    Scope: project
    Status: ✘ disabled

  ❯ broken@x
    Version: 1.0.0
    Scope: user
    Status: ✘ failed to load
`

test('plugin list text is parsed to names, versions, scope and status, and no folder is kept', async () => {
  const out = parsePluginList(HUMAN)

  expect(out.ok).toBe(true)

  if (out.ok) {
    expect(out.list.map(i => [i.id, i.version, i.scope, i.status])).toEqual([
      ['alerts@local-mods', '0.1.0', 'user', 'enabled'],
      ['other-tool@some-market', '2.3.4', 'project', 'disabled'],
      ['broken@x', '1.0.0', 'user', 'error'],
    ])
    expect(JSON.stringify(out.list)).not.toContain(HOME)
    expect(out.list[0]?.market).toBe('local-mods')
  }
})

test('plugin list JSON is parsed and its folders are dropped', async () => {
  const json = JSON.stringify([
    { id: 'a@m', version: '1.0.0', scope: 'user', enabled: true, installPath: `${HOME}/cache`, readFromFolder: `${HOME}/src` },
    { id: 'b@m', version: '0.0.1', scope: 'local', enabled: false },
    { nope: true },
    { id: 'bad id with spaces', version: '1' },
  ])
  const out = parsePluginList(json)

  expect(out.ok && out.list.map(i => `${i.id}:${i.status}`)).toEqual(['a@m:enabled', 'b@m:disabled'])
  expect(JSON.stringify(out)).not.toContain(HOME)
  expect(parsePluginList('{"plugins":[{"id":"z@m","version":"1","scope":"user","enabled":true}]}').ok).toBe(true)
})

test('plugin list that is empty, garbled or colourful', async () => {
  expect(parsePluginList('No plugins installed.')).toEqual({ ok: true, list: [] })
  expect(parsePluginList('[]')).toEqual({ ok: true, list: [] })
  expect(parsePluginList('').ok).toBe(false)
  expect(parsePluginList('Error: something odd happened').ok).toBe(false)
  expect(parsePluginList('{ not json').ok).toBe(false)
  expect(parsePluginList('{"a":1}').ok).toBe(false)
  const coloured = parsePluginList('\u001b[1m  ❯ x@m\u001b[0m\n    Version: 1.0.0\n    Scope: user\n    Status: ✔ enabled')

  expect(coloured.ok && coloured.list[0]?.id).toBe('x@m')
})

test('status lookups by id or by bare name, and the update chip', async () => {
  const list = [inst('notes@local-mods', '0.1.0'), inst('off@m', '1.0.0', 'disabled')]

  expect(statusOf(list, 'notes')).toBe('enabled')
  expect(statusOf(list, 'notes@local-mods')).toBe('enabled')
  expect(statusOf(list, 'off')).toBe('disabled')
  expect(statusOf(list, 'missing')).toBe('absent')
  expect(statusOf(null, 'notes')).toBe('unknown')
  expect(findInstalled(list, 'notes@other')?.id).toBe('notes@local-mods')
  expect(chipFor('enabled', 'symbols').text).toBe('●')
  expect(chipFor('enabled', 'letters').text).toBe('ON')
  expect(chipFor('absent', 'minimal').text).toBe('-')
  expect(chipFor('enabled', 'symbols', true)).toEqual({ text: '●↑', color: 'suggestion' })
  expect(chipFor('error', 'symbols').color).toBe('error')
})

// ------------------------------------------------------------ secrets, paths and output

test('secrets, credentials and home folders are masked in anything shown or logged', async () => {
  const samples = [
    'key sk-ant-api03-abcdefghijklmnopqrstuvwx used',
    'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
    'Authorization: Bearer abcdefghijklmnop12345',
    'password=hunter2hunter2',
    'API_KEY: "abc123def456"',
    'clone https://user:secretpass@example.com/x.git',
    'AKIAABCDEFGHIJKLMNOP',
    'xoxb-1234567890-abcdefghij',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
  ]

  for (const s of samples) {
    const masked = maskSecrets(s)

    expect(masked).not.toMatch(/sk-ant-api03|ghp_abc|github_pat_11|abcdefghijklmnop12345|hunter2|abc123def456|secretpass|AKIAABCDEFG|xoxb-1234|eyJzdWIi/)
  }
  expect(sanitize(`opened ${HOME}/x/y and ${['', 'home', 'ann', 'z'].join('/')}`)).toBe('opened ~/x/y and ~/z')
  expect(sanitize(`at ${HOME}/p`, HOME)).toBe('at ~/p')
  expect(sanitize('\u001b[31mred\u001b[0m text')).toBe('red text')
  expect(maskSecrets('plain words and a version 1.2.3')).toBe('plain words and a version 1.2.3')
})

test('command output keeps at most 200 lines, the last ones, cleaned', async () => {
  const many = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n')

  expect(tailLines(many).length).toBe(200)
  expect(tailLines(many)[199]).toBe('line 299')
  expect(tailLines('a\nb\n\n').length).toBe(2)
  const both = formatOutput(many, 'oops\npassword=abc123abc', HOME)

  expect(both.length).toBe(200)
  expect(both[199]).toBe('! password=[masked]')
  expect(headLines(['', 'a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e'])
})

// ------------------------------------------------------------ the log

test('the log keeps 100 entries, masks secrets and refuses damaged storage', async () => {
  let log = [] as ReturnType<typeof normalizeLog>

  for (let i = 0; i < 150; i++) {
    log = pushLog(log, mkEntry(i, 'result', `exit 0 token=abcdefgh${i}`, { argv: 'claude plugin list', exit: 0, head: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }))
  }
  expect(LOG_MAX).toBe(100)
  expect(log.length).toBe(100)
  expect(log[0]?.at).toBe(50)
  expect(log[99]?.text).toContain('[masked]')
  expect(log[99]?.head.length).toBe(5)
  expect(normalizeLog('nope')).toEqual([])
  expect(normalizeLog([null, 3, { at: 'x' }, { at: 1, kind: 'bogus' }])).toEqual([])
  expect(normalizeLog([{ at: 1, kind: 'result', text: `from ${HOME}/x password=zzzzzzzz`, exit: 2, head: ['h'] }])[0]).toMatchObject({ text: 'from ~/x password=[masked]', exit: 2 })
  expect(normalizeLog(Array.from({ length: 300 }, (_, i) => ({ at: i, kind: 'cancel', text: 't' }))).length).toBe(100)
})

// ------------------------------------------------------------ the remote source

test('a source URL is https on a GitHub host, with no credentials, port or query', async () => {
  const good = [
    'https://raw.githubusercontent.com/owner/repo/main/.claude-plugin/marketplace.json',
    'https://gist.githubusercontent.com/someone/abc123/raw/marketplace.json',
    'https://github.com/owner/repo/raw/main/.claude-plugin/marketplace.json',
    'HTTPS://RAW.GITHUBUSERCONTENT.COM/owner/repo/main/marketplace.json',
  ]

  for (const url of good) {
    expect(parseSourceUrl(url).ok).toBe(true)
  }
  const blob = parseSourceUrl('https://github.com/owner/repo/blob/main/.claude-plugin/marketplace.json')

  expect(blob).toMatchObject({ ok: true, url: 'https://raw.githubusercontent.com/owner/repo/main/.claude-plugin/marketplace.json' })
  expect(repoFromUrl('https://raw.githubusercontent.com/owner/repo/main/x.json')).toBe('owner/repo')
  expect(repoFromUrl('https://gist.githubusercontent.com/u/id/raw/x.json')).toBeUndefined()
})

test('a source URL on the wrong host, scheme or shape is refused', async () => {
  const bad = [
    '',
    'http://raw.githubusercontent.com/o/r/main/marketplace.json',
    'ftp://raw.githubusercontent.com/o/r/main/marketplace.json',
    'raw.githubusercontent.com/o/r/main/marketplace.json',
    'https://example.com/marketplace.json',
    'https://raw.githubusercontent.com.evil.com/o/r/main/marketplace.json',
    'https://evilraw.githubusercontent.com/o/r/main/marketplace.json',
    'https://githubusercontent.com/o/r/main/marketplace.json',
    'https://user:pw@raw.githubusercontent.com/o/r/main/marketplace.json',
    'https://github.com@evil.com/o/r/main/marketplace.json',
    'https://raw.githubusercontent.com@evil.com/marketplace.json',
    'https://raw.githubusercontent.com:8443/o/r/main/marketplace.json',
    'https://raw.githubusercontent.com/o/r/main/marketplace.json?token=abc',
    'https://raw.githubusercontent.com/o/r/main/marketplace.json#frag',
    'https://raw.githubusercontent.com/o/r/main/market place.json',
    'https://raw.githubusercontent.com/o/r/../../x/marketplace.json',
    'https://raw.githubusercontent.com/o/r/main/readme.md',
    'https://raw.githubusercontent.com',
    'https://github.com/owner/repo',
    'https://github.com/owner/repo/tree/main',
    'https://raw.githubusercontent.com/o/r/main/' + 'a'.repeat(300) + '.json',
    'https://raw.githubusercontent.com/o/r/main/x.json\nhttps://evil.com',
  ]

  for (const url of bad) {
    expect(parseSourceUrl(url).ok).toBe(false)
  }
})

const market = (plugins: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'm', owner: { name: 'x' }, ...extra, plugins })

test('a well formed marketplace is accepted and extra keys are ignored', async () => {
  const out = validateMarketplace(market([{ name: 'a', source: './a', description: 'A mod', version: '1.2.3', category: 'x', author: { name: 'q' } }, { name: 'b', source: { source: 'github', repo: 'o/r' } }]))

  expect(out.ok).toBe(true)

  if (out.ok) {
    expect(out.plugins).toEqual([
      { name: 'a', source: './a', description: 'A mod', version: '1.2.3' },
      { name: 'b', source: 'object', description: '', version: '' },
    ])
    expect(out.name).toBe('m')
  }
  expect(validateMarketplace(market([])).ok).toBe(true)
})

test('a malformed marketplace is refused with a reason', async () => {
  const cases: [unknown, RegExp][] = [
    ['{ nope', /not valid JSON/],
    ['', /not valid JSON/],
    ['[]', /object/],
    ['null', /object/],
    ['"text"', /object/],
    ['{}', /no "plugins"/],
    ['{"plugins":{}}', /no "plugins"/],
    ['{"plugins":"x"}', /no "plugins"/],
    [market([1]), /not an object/],
    [market([null]), /not an object/],
    [market([[]]), /not an object/],
    [market([{ source: 'x' }]), /name/],
    [market([{ name: 5, source: 'x' }]), /name/],
    [market([{ name: 'Bad Name', source: 'x' }]), /name/],
    [market([{ name: 'a@b', source: 'x' }]), /name/],
    [market([{ name: '../x', source: 'x' }]), /name/],
    [market([{ name: 'a' }]), /source/],
    [market([{ name: 'a', source: 7 }]), /source/],
    [market([{ name: 'a', source: '' }]), /source/],
    [market([{ name: 'a', source: ['x'] }]), /source/],
    [market([{ name: 'a', source: { a: { b: 1 } } }]), /source/],
    [market([{ name: 'a', source: 'x', version: 1 }]), /version/],
    [market([{ name: 'a', source: 'x', version: 'v'.repeat(65) }]), /version/],
    [market([{ name: 'a', source: 'x', description: 5 }]), /description/],
    [market([{ name: 'a', source: 'x', description: 'd'.repeat(2001) }]), /description/],
    [market([{ name: 'a', source: 'x' }, { name: 'a', source: 'y' }]), /twice/],
    [market(Array.from({ length: 501 }, (_, i) => ({ name: `p${i}`, source: 'x' }))), /More than/],
    [undefined, /not text/],
    [42, /not text/],
  ]

  for (const [text, why] of cases) {
    const out = validateMarketplace(text)

    expect(out.ok).toBe(false)

    if (!out.ok) {
      expect(out.error).toMatch(why)
    }
  }
})

test('a huge answer is refused before it is parsed', async () => {
  const huge = JSON.stringify({ plugins: [{ name: 'a', source: 'x', description: 'x'.repeat(1_100_000) }] })
  const out = validateMarketplace(huge)

  expect(out.ok).toBe(false)
  expect(!out.ok && out.error).toMatch(/1000 KB|1 MB|over/)
  expect(validateMarketplace('x'.repeat(1_000_001)).ok).toBe(false)
})

test('long or coloured remote text is cut down', async () => {
  const out = validateMarketplace(market([{ name: 'a', source: 's'.repeat(250), description: `\u001b[31m${'d'.repeat(900)}`, version: '1.0.0' }]))

  expect(out.ok && out.plugins[0]?.source.length).toBeLessThanOrEqual(100)
  expect(out.ok && out.plugins[0]?.description.length).toBeLessThanOrEqual(200)
  expect(out.ok && out.plugins[0]?.description.includes('\u001b')).toBe(false)
})

test('NEW and newer are decided against the installed list, else the catalog', async () => {
  const remote = [
    { name: 'brand-new', source: 'x', description: 'hi', version: '1.0.0' },
    { name: 'notes', source: 'x', description: '', version: '9.0.0' },
    { name: 'alerts', source: 'x', description: '', version: '0.1.0' },
    { name: 'nover', source: 'x', description: '', version: '' },
  ]
  const installed = [inst('notes@m', '0.1.0'), inst('alerts@m', '0.1.0'), inst('nover@m', '1.0.0')]
  const withList = diffRemote(remote, installed, [])

  expect(withList.rows.map(r => `${r.kind}:${r.name}`)).toEqual(['new:brand-new', 'update:notes'])
  expect(withList.rows[1]).toMatchObject({ installed: '0.1.0', remote: '9.0.0' })
  expect(withList.upToDate).toBe(2)
  const noList = diffRemote(remote, null, [{ name: 'notes', version: '0.1.0' }, { name: 'alerts', version: '0.2.0' }])

  expect(noList.rows.map(r => `${r.kind}:${r.name}`)).toEqual(['new:brand-new', 'update:notes', 'new:nover'])
})

// ------------------------------------------------------------ bundles

test('built-in bundles name only mods that are in the catalog', async () => {
  const names = CATALOG.map(m => m.name)

  for (const [bundle, mods] of Object.entries(BUILTIN_BUNDLES)) {
    expect(mods.length).toBeGreaterThan(0)

    for (const m of mods) {
      expect(names).toContain(m)
    }
    expect(bundle).toMatch(/^[a-z]+$/)
  }
  expect(BUILTIN_BUNDLES.calm).toEqual(['settings', 'sound-pack', 'alerts'])
  expect(BUILTIN_BUNDLES.focus).toEqual(['settings', 'workbench', 'notes'])
  expect(BUILTIN_BUNDLES.dev).toEqual(['git-kit', 'debug-kit', 'review-kit', 'safety-pro', 'tool-guard'])
  expect(BUILTIN_BUNDLES.look).toEqual(['looks', 'skins', 'skins-plus', 'animations', 'motion'])
  expect(bundleMembers('full', {}, CATALOG)).toEqual(names)
  expect(bundleMembers('mine', { mine: ['a', 'b'] }, CATALOG)).toEqual(['a', 'b'])
  expect(bundleMembers('nope', {}, CATALOG)).toBeUndefined()
  expect(bundleMembers('toString', {}, CATALOG)).toBeUndefined()
  expect(bundleMembers('constructor', {}, CATALOG)).toBeUndefined()
  expect(bundleMembers('__proto__', {}, CATALOG)).toBeUndefined()
  expect(allBundleNames({ zed: ['a'], abc: ['b'] })).toEqual(['calm', 'focus', 'full', 'dev', 'look', 'abc', 'zed'])
})

test('/mmbundle arguments', async () => {
  expect(parseBundleArgs('')).toEqual({ kind: 'list' })
  expect(parseBundleArgs('show calm')).toEqual({ kind: 'show', name: 'calm' })
  expect(parseBundleArgs('show').kind).toBe('error')
  expect(parseBundleArgs('rm mine')).toEqual({ kind: 'rm', name: 'mine' })
  expect(parseBundleArgs('add mine notes,alerts settings')).toEqual({ kind: 'add', name: 'mine', mods: ['notes', 'alerts', 'settings'] })
  expect(parseBundleArgs('add mine').kind).toBe('error')
  expect(parseBundleArgs('add Mine notes').kind).toBe('error')
  expect(parseBundleArgs('add calm notes').kind).toBe('error')
  expect(parseBundleArgs('add full notes').kind).toBe('error')
  expect(parseBundleArgs('add mine notes,Bad;Name').kind).toBe('error')
  expect(parseBundleArgs('add mine ' + Array.from({ length: 61 }, (_, i) => `m${i}`).join(',')).kind).toBe('error')
  expect(parseBundleArgs('apply calm')).toEqual({ kind: 'apply', name: 'calm', verb: 'auto', scope: 'user', hasYes: false })
  expect(parseBundleArgs('apply dev disable --scope local --yes-i-know')).toEqual({ kind: 'apply', name: 'dev', verb: 'disable', scope: 'local', hasYes: true })
  expect(parseBundleArgs('apply calm --force').kind).toBe('error')
  expect(parseBundleArgs('apply calm --scope nope').kind).toBe('error')
  expect(parseBundleArgs('apply').kind).toBe('error')
  expect(parseBundleArgs('wat').kind).toBe('error')
  expect(parseModList('a, b ,a').ok).toBe(true)
  expect(parseModList('').ok).toBe(false)
})

test('applying a bundle: auto picks install or enable and skips what is on', async () => {
  const installed = [inst('settings@m', '1', 'enabled'), inst('sound-pack@m', '1', 'disabled')]
  const plan = planBundle(['settings', 'sound-pack', 'alerts'], 'auto', 'user', false, installed, 'local-mods', CATALOG)

  expect(plan.steps.map(stepLine)).toEqual(['claude plugin enable sound-pack@m --scope user', 'claude plugin install alerts@local-mods --scope user'])
  expect(plan.skipped.join()).toContain('settings')
  const unknown = planBundle(['settings', 'alerts'], 'auto', 'project', false, null, 'm2', CATALOG)

  expect(unknown.steps.every(s => s.verb === 'install' && s.scope === 'project' && s.target.endsWith('@m2'))).toBe(true)
})

test('a bundle never disables or uninstalls the manager, and guards need the extra word', async () => {
  const members = ['mod-manager', 'tool-guard', 'notes', 'safety-pro']

  for (const verb of ['disable', 'uninstall'] as const) {
    const plain = planBundle(members, verb, 'user', false, null, 'm', CATALOG)

    expect(plain.steps.map(s => baseName(s.target))).toEqual(['notes'])
    expect(plain.skipped.length).toBe(3)
    const yes = planBundle(members, verb, 'user', true, null, 'm', CATALOG)

    expect(yes.steps.map(s => baseName(s.target)).sort()).toEqual(['notes', 'safety-pro', 'tool-guard'])
    expect(yes.steps.some(s => baseName(s.target) === 'mod-manager')).toBe(false)
  }
  // Installing or enabling the manager and guards through a bundle is fine, and the extra word is not needed.
  const on = planBundle(members, 'enable', 'user', true, null, 'm', CATALOG)

  expect(on.steps.length).toBe(4)
  expect(on.skipped).toEqual([])
  // The full bundle can never switch the manager off either.
  const everything = planBundle(bundleMembers('full', {}, CATALOG) ?? [], 'uninstall', 'user', true, null, 'm', CATALOG)

  expect(everything.steps.some(s => baseName(s.target) === 'mod-manager')).toBe(false)
  expect(everything.steps.every(stepIsValid)).toBe(true)
})

test('mods that need others come after them, and a removal runs the other way', async () => {
  const cat = [
    { name: 'base', deps: [] as string[] },
    { name: 'mid', deps: ['base'] },
    { name: 'top', deps: ['mid', 'base'] },
  ] as never

  expect(orderMods(['top', 'mid', 'base'], cat)).toEqual(['base', 'mid', 'top'])
  const plan = planBundle(['top', 'mid', 'base'], 'uninstall', 'user', false, null, 'm', cat)

  expect(plan.steps.map(s => baseName(s.target))).toEqual(['top', 'mid', 'base'])
  // A dependency loop does not hang.
  expect(orderMods(['a', 'b'], [{ name: 'a', deps: ['a'] }, { name: 'b', deps: ['b'] }] as never).length).toBe(2)
})

test('a step that is not installed is skipped for enable, disable, update and uninstall', async () => {
  const plan = planBundle(['notes', 'alerts'], 'enable', 'user', false, [inst('notes@m')], 'm', CATALOG)

  expect(plan.steps.map(s => baseName(s.target))).toEqual(['notes'])
  expect(plan.skipped.join()).toContain('alerts')
})

// ------------------------------------------------------------ catalog and commands

test('the generated catalog holds no absolute path, home folder or user name', async () => {
  const slash = (name: string) => `/${name}/`
  const winHome = ['C:', 'Users', ''].join('\\')
  const serial = JSON.stringify(CATALOG)

  expect(serial).not.toContain(slash('Users'))
  expect(serial).not.toContain(slash('home'))
  expect(serial).not.toContain(winHome)
  expect(serial).not.toContain(slash('private'))
  expect(serial).not.toContain(slash('tmp'))
  expect(serial).not.toMatch(/~\/\.claude/)

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      expect(value.includes(slash('Users'))).toBe(false)
      expect(value.includes(slash('home'))).toBe(false)
      expect(/^\/[A-Za-z]/.test(value) && value.split('/').length > 3).toBe(false)
    } else if (Array.isArray(value)) {
      value.forEach(walk)
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(walk)
    }
  }
  walk(CATALOG)
})

test('every catalog entry is complete and consistent', async () => {
  const names = new Set<string>()

  for (const mod of CATALOG) {
    expect(mod.name).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/)
    expect(names.has(mod.name)).toBe(false)
    names.add(mod.name)
    expect(mod.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(mod.description.length).toBeGreaterThan(5)
    expect((CATEGORIES as readonly string[]).includes(mod.category)).toBe(true)
    expect(mod.hasDeps).toBe(mod.deps.length > 0)

    if (mod.help !== null) {
      expect(mod.cmds.map(c => c.name)).toContain(mod.help)
      expect(mod.cmds[0]?.name).toBe(mod.help)
    }

    for (const c of mod.cmds) {
      expect(c.name).toMatch(/^[a-z][a-z0-9]{0,15}$/)
    }
  }
  expect(CATALOG.length).toBeGreaterThan(20)
  expect(names.has('mod-manager')).toBe(true)
  // The bundled mods the brief names exist.
  for (const m of ['settings', 'motion', 'tool-guard', 'safety-pro', 'controls', 'workbench', 'notes']) {
    expect(names.has(m)).toBe(true)
  }
  expect(CATALOG.find(m => m.name === 'tool-visuals')?.hasDeps).toBe(true)
  expect(CATALOG.find(m => m.name === 'tool-guard')?.hasDeps).toBe(false)
})

test('the manager lists its own commands in the catalog, every one starting with mm', async () => {
  const me = CATALOG.find(m => m.name === 'mod-manager')

  expect(me?.help).toBe('mm')
  expect(me?.category).toBe('manager')
  expect(me?.deps).toEqual(['settings'])
  expect((me?.cmds ?? []).map(c => c.name).sort()).toEqual(COMMANDS.map(c => c[0]).sort())

  for (const [name] of COMMANDS) {
    expect(name.startsWith('mm')).toBe(true)
  }
  expect(new Set(COMMANDS.map(c => c[0])).size).toBe(COMMANDS.length)
  expect(COMMANDS[0]?.[0]).toBe('mm')
})

test('catalog search ranks names first and needs every word to match', async () => {
  expect(searchCatalog(CATALOG, 'git')[0]?.name).toBe('git-kit')
  expect(searchCatalog(CATALOG, 'tool guard')[0]?.name).toBe('tool-guard')
  expect(searchCatalog(CATALOG, 'git zzzzqqqq').length).toBe(0)
  expect(searchCatalog(CATALOG, 'tool-guard')[0]?.name).toBe('tool-guard')
  expect(searchCatalog(CATALOG, '   ')).toEqual([])
  expect(searchCatalog(CATALOG, 'zzzzqqqq')).toEqual([])
  expect(searchCatalog(CATALOG, 'mod', 3).length).toBeLessThanOrEqual(3)
  expect(searchCatalog(CATALOG, 'GIT')[0]?.name).toBe('git-kit')
})

test('the report names plugins, versions and status, and no path', async () => {
  const text = buildReport('0.1.0', 'bundled', [inst('b@m', '2.0.0', 'disabled', 'project'), inst('a@m', '1.0.0')], 35)

  expect(text).toContain('mod-manager 0.1.0 report')
  expect(text).toContain("desktop app's bundle")
  expect(text.indexOf('a@m')).toBeLessThan(text.indexOf('b@m'))
  expect(text).toContain('b@m 2.0.0 [project] disabled')
  expect(text).not.toContain(HOME)
  expect(text).not.toMatch(/\/[A-Za-z]+\/[A-Za-z]+\//)
  expect(buildReport('0.1.0', 'none', null, 3)).toContain('installed: unknown')
})

// ------------------------------------------------------------ the Features tab

const mod = (name: string, category: CatalogMod['category'], features: CatalogMod['features'] = []): CatalogMod => ({
  name,
  version: '0.1.0',
  description: `the ${name} mod`,
  help: null,
  helpDesc: '',
  category,
  deps: [],
  hasDeps: false,
  cmds: [],
  features,
})
const RAIN = { id: 'rain', label: 'Rain effect', description: 'Falling drops', default: false, group: 'Look' }
const SPARK = { id: 'sparkle', label: 'Sparkle', description: '', default: true, group: '' }
const FAKE = [mod('zeta', 'look', [RAIN, SPARK]), mod('alpha', 'look'), mod('tool-guard', 'safety', [{ ...SPARK, id: 'paste-check' }]), mod('notes', 'notes')]

test('every catalog mod carries a features list, with no path in it and no reserved id', async () => {
  for (const m of CATALOG) {
    expect(Array.isArray(m.features)).toBe(true)

    for (const f of m.features) {
      expect(f.id).toMatch(/^[a-z0-9][a-z0-9-]{0,40}$/)
      expect(['toasts', 'sounds', 'status', 'band']).not.toContain(f.id)
      expect(typeof f.default).toBe('boolean')
    }
  }
  const text = JSON.stringify(CATALOG)
  expect(text).not.toContain(['', 'Users', ''].join('/'))
  expect(text).not.toContain('/home/')
  expect(FEATURE_KINDS.map(k => k[0])).toEqual(['toasts', 'sounds', 'status', 'band'])
  expect(UNMUTABLE).toEqual(['settings', 'tool-guard', 'safety-pro', 'controls'])
})

test('overrides read from the settings atom are cleaned: only booleans survive', async () => {
  expect(cleanOverrides(undefined)).toEqual({})
  expect(cleanOverrides(null)).toEqual({})
  expect(cleanOverrides('x')).toEqual({})
  expect(cleanOverrides([true])).toEqual({})
  expect(cleanOverrides({ 'a.b': false, 'a.c': 'no', 'a.d': 1, 'a.e': null, 'a.f': true })).toEqual({ 'a.b': false, 'a.f': true })
  expect(cleanOverrides({ ['x'.repeat(200)]: false })).toEqual({})
})

test('a mod row: four universal switches that are on by default, its own with their own default, and locked mods without toggles', async () => {
  const row = modFeatureRow(FAKE[0] as CatalogMod, { 'zeta.toasts': false, 'zeta.rain': true })
  expect(row.universal.map(s => [s.id, s.on, s.changed])).toEqual([
    ['zeta.toasts', false, true],
    ['zeta.sounds', true, false],
    ['zeta.status', true, false],
    ['zeta.band', true, false],
  ])
  expect(row.own.map(s => [s.id, s.on, s.dflt, s.changed])).toEqual([
    ['zeta.rain', true, false, true],
    ['zeta.sparkle', true, true, false],
  ])
  expect(row.universal.map(s => s.label)).toEqual(['Toasts', 'Sounds', 'Status', 'Row'])
  const guard = modFeatureRow(FAKE[2] as CatalogMod, { 'tool-guard.toasts': false, 'tool-guard.paste-check': false })
  expect(guard.locked).toBe(true)
  expect(guard.universal.every(s => s.on && !s.changed)).toBe(true)
  expect(guard.own[0]?.on).toBe(false)
  expect(modFeatureRow(FAKE[3] as CatalogMod, {}).locked).toBe(false)
  // a name that is an Object.prototype key finds no override
  expect(modFeatureRow(mod('constructor', 'look'), {}).universal.every(s => s.on)).toBe(true)
})

test('changed switches are counted against each switch\'s own default and ignore locked and unknown ones', async () => {
  expect(changedSwitches(FAKE, {})).toBe(0)
  expect(changedSwitches(FAKE, { 'zeta.toasts': false })).toBe(1)
  expect(changedSwitches(FAKE, { 'zeta.rain': true })).toBe(1)
  expect(changedSwitches(FAKE, { 'zeta.rain': false, 'zeta.sparkle': true })).toBe(0)
  expect(changedSwitches(FAKE, { 'zeta.sparkle': false, 'alpha.band': false, 'notes.sounds': false })).toBe(3)
  expect(changedSwitches(FAKE, { 'tool-guard.toasts': false, 'nobody.toasts': false, 'tool-guard.paste-check': false })).toBe(1)
})

test('rows are grouped by category then name and filtered by every word of the query', async () => {
  expect(featureRows(FAKE, {}, '').map(r => r.mod.name)).toEqual(['alpha', 'zeta', 'tool-guard', 'notes'])
  expect(featureRows(FAKE, {}, 'zeta').map(r => r.mod.name)).toEqual(['zeta'])
  expect(featureRows(FAKE, {}, 'RAIN').map(r => r.mod.name)).toEqual(['zeta'])
  expect(featureRows(FAKE, {}, 'look').map(r => r.mod.name)).toEqual(['alpha', 'zeta'])
  expect(featureRows(FAKE, {}, 'look rain').map(r => r.mod.name)).toEqual(['zeta'])
  expect(featureRows(FAKE, {}, 'nothing here').length).toBe(0)
})

test('the arguments for /cfg are exact', async () => {
  expect(featureArgs('cockpit.toasts', false)).toBe('feature cockpit.toasts off')
  expect(featureArgs('cockpit.toasts', true)).toBe('feature cockpit.toasts on')
  expect(presetArgs('quiet')).toBe('feature quiet')
  expect(presetArgs('full')).toBe('feature full')
})

test('pages never split a mod and a tall unit gets a page of its own', async () => {
  expect(paginateUnits([], 5)).toEqual([])
  expect(paginateUnits([2, 2, 2, 2], 5)).toEqual([[0, 1], [2, 3]])
  expect(paginateUnits([3, 3, 3], 5)).toEqual([[0], [1], [2]])
  expect(paginateUnits([9, 1, 1], 5)).toEqual([[0], [1, 2]])
  expect(paginateUnits([1, 1, 1], 100)).toEqual([[0, 1, 2]])
})

test('/mmfeatures takes plain words only', async () => {
  expect(parseFeaturesArgs('')).toEqual({ ok: true, query: '' })
  expect(parseFeaturesArgs('  Cockpit  ')).toEqual({ ok: true, query: 'cockpit' })
  expect(parseFeaturesArgs('look   rain')).toEqual({ ok: true, query: 'look rain' })
  expect(parseFeaturesArgs('a;b').ok).toBe(false)
  expect(parseFeaturesArgs('$(x)').ok).toBe(false)
  expect(parseFeaturesArgs('x'.repeat(41)).ok).toBe(false)
})

test('the one-line summary of a mod', async () => {
  expect(featureLine(modFeatureRow(FAKE[0] as CatalogMod, { 'zeta.sounds': false, 'zeta.rain': true }))).toBe(
    'zeta: toasts on, sounds off, status on, row on; own: rain on, sparkle on',
  )
  expect(featureLine(modFeatureRow(FAKE[2] as CatalogMod, {}))).toMatch(/^tool-guard: always on/)
})
