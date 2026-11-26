import { expect, mock, test } from 'claude-code/testing'

import { checkGit } from './guard'

// ------------------------------------------------------------------ the engine, stubbed

const ROOT = '/w/p'
const PANE = { plugin: 'add-kit', component: 'Pane', requestId: 'add-kit-main', surface: 'desktop', props: { title: 'add-kit', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

type Reply = { code?: number; out?: string; err?: string }
type Opts = {
  replies?: Record<string, Reply | ((argv: string[]) => Reply)>
  features?: Record<string, boolean>
  stats?: Record<string, { kind: 'file' | 'dir'; size: number; realPath?: string }>
  lists?: Record<string, { name: string; kind: 'file' | 'dir'; size: number }[]>
  files?: Record<string, string>
  cfg?: (args: string) => unknown
}

const TOOL_OUT = { fn: (_e: Record<string, unknown>): Record<string, unknown> => ({ result: {}, text: '' }) }

const engine = (on: any, o: Opts = {}) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const store = new Map<string, unknown>()
  const registered: string[] = []

  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.has(e.key) ? JSON.parse(JSON.stringify(store.get(e.key))) : undefined }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    store.delete(e.key)

    return { value: undefined }
  })
  const argvs: string[][] = []
  const filled: string[] = []
  const cfg: string[] = []
  const reads: { path: string; offset?: number; length?: number }[] = []
  const features = { ...(o.features ?? {}) }

  on('command.register', (_: unknown, e: { name: string }) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: (e: unknown) => unknown) => {
    if (e.plugin === 'settings' && e.key === 'features') return { value: { value: { shape: 'features-1', value: features }, version: 1 } }

    if (e.plugin === 'settings') return { value: { value: e.key === 'accent' ? 'claude' : 'normal', version: 1 } }

    return next(e)
  })
  on('tool.call', (_: unknown, e: Record<string, unknown>) => TOOL_OUT.fn(e))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('command.run', { command: 'cfg' }, (_: unknown, e: { args: string }) => {
    cfg.push(e.args)

    return o.cfg ? (o.cfg(e.args) as { text: string }) : { text: 'ok' }
  })
  on('fs.stat', (_: unknown, e: { path: string }) => {
    const s = o.stats?.[e.path]

    if (!s) throw new Error(`ENOENT ${e.path}`)

    return { value: { ...s, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', (_: unknown, e: { path: string }) => {
    const l = o.lists?.[e.path]

    if (!l) throw new Error('ENOENT')

    return { value: l.map(x => ({ ...x, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_: unknown, e: { path: string; offset?: number; length?: number }) => {
    reads.push({ path: e.path, offset: e.offset, length: e.length })
    const f = o.files?.[e.path]

    if (f === undefined) throw new Error('ENOENT')

    return { value: f.slice(e.offset ?? 0, (e.offset ?? 0) + (e.length ?? f.length)) }
  })
  on('process.run', (_: unknown, e: { argv: string[]; init?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } }) => {
    argvs.push([...e.argv])
    const a = e.argv[0] === 'git' ? e.argv.slice(6).filter(x => x !== '--no-ext-diff' && x !== '--no-textconv') : e.argv
    const key = a.join(' ')
    const hit = Object.entries(o.replies ?? {}).find(([k]) => key === k || key.startsWith(k))
    const r = hit ? (typeof hit[1] === 'function' ? hit[1](a) : hit[1]) : { code: 128, err: 'fatal: not a git repository' }

    return { value: { exitCode: r.code ?? 0, stdout: r.out ?? '', stderr: r.err ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { clock, argvs, filled, cfg, reads, features, store, registered }
}

const start = ($: any) => $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = ''): Promise<string> => ((await $.command.run({ command, args } as any)) as { text: string }).text
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join('\n')
const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command } as any)

const ALL_ON = { 'add-kit.history': true, 'add-kit.tests': true, 'add-kit.builds': true, 'add-kit.errors': true, 'add-kit.todos': true, 'add-kit.activity': true }
const READ_VERBS = ['status', 'log', 'diff', 'branch', 'for-each-ref', 'rev-parse', 'ls-files', 'tag', 'remote', 'check-ignore']

const REPO = {
  'rev-parse --show-toplevel': { out: `${ROOT}\n` },
  'rev-parse --is-inside-work-tree': { out: 'true\n' },
  'for-each-ref': { out: 'main\t1799990000\t*\nold\t1700000000\t \n' },
  'status --porcelain=v1 -b -unormal': { out: '## main...origin/main [behind 1]\n M a.ts\n?? b.txt\n' },
  'log -1': { out: '1799990000\n' },
  'ls-files --others': { out: 'b.txt\nbig.bin\n' },
  'ls-files -- ': { out: '.env\nkeys/deploy.pem\nsrc/a.ts\n' },
  'check-ignore': { code: 1 },
}

// ------------------------------------------------------------------ commands and help

test('every command is registered, listed in /ad, and none clashes with a known name', async ($, on) => {
  const { registered } = engine(on)

  await start($)
  const help = await run($, 'ad')

  expect(registered.length).toBe(23)
  expect(new Set(registered).size).toBe(23)

  for (const name of registered) {
    expect(name.startsWith('ad')).toBe(true)
    expect(help).toContain(`/${name}`)
  }
  expect(help).toMatch(/278/)
  expect(help).toMatch(/Recording is OFF/)
  expect(await run($, 'adpane', 'nope')).toMatch(/Tabs:/)
})

// ------------------------------------------------------------------ recording is off by default and gated by switches

test('with every switch at its default nothing is recorded and no process starts', async ($, on) => {
  const { argvs } = engine(on)

  TOOL_OUT.fn = () => ({ result: {}, text: 'Tests: 3 passed, 3 total', isError: false })
  await start($)
  await bash($, 'npm test')
  await bash($, 'echo hello')
  expect(await run($, 'adhist')).toMatch(/No commands recorded/)
  expect(await run($, 'adtests')).toMatch(/No test runs seen yet/)
  expect(await run($, 'adbuild')).toMatch(/No build or test commands timed/)
  expect(argvs.length).toBe(0)
  const rec = await run($, 'adrec')

  expect(rec).toMatch(/add-kit\.tests\s+off/)
  expect(rec).toMatch(/add-kit\.svg\s+ON/)
})

test('with the switches on, tests, coverage, flaky names, builds, errors and history are recorded', async ($, on) => {
  const { clock } = engine(on, { features: ALL_ON })

  await start($)
  TOOL_OUT.fn = () => ({ result: {}, text: 'FAIL a\n  ● Suite › flaky one\nTests: 1 failed, 4 passed, 5 total\nAll files |   80.5 | 70 |', isError: true })
  await bash($, 'npm test -- --coverage')
  TOOL_OUT.fn = () => ({ result: {}, text: 'Tests: 5 passed, 5 total\nAll files |   82.0 | 70 |', isError: false })
  await clock.advance(5000)
  await bash($, 'npm test -- --coverage')
  TOOL_OUT.fn = () => ({ result: {}, text: "Error: ENOENT: no such file or directory, open '/w/p/a.txt'", isError: true })
  await bash($, 'cat a.txt')
  TOOL_OUT.fn = () => ({ result: {}, text: "Error: ENOENT: no such file or directory, open '/w/p/b.txt'", isError: true })
  await bash($, 'cat b.txt')
  TOOL_OUT.fn = () => ({ result: {}, text: 'built', isError: false })
  await bash($, 'npm run build')
  await bash($, 'export TOKEN=abc123secret456 && echo hi')

  const tests = await run($, 'adtests')

  expect(tests).toMatch(/2 test runs/)
  expect(tests).toMatch(/Last: jest 5 passed, 0 failed/)
  expect(tests).toMatch(/Coverage 82%/)
  expect(await run($, 'adflaky')).toMatch(/Suite › flaky one/)
  expect(await run($, 'adcov')).toMatch(/Coverage now 82%/)
  expect(await run($, 'adbuild')).toMatch(/npm run build/)
  expect(await run($, 'aderr')).toMatch(/3 errors in 2 clusters/)
  const hist = await run($, 'adhist', 'export')

  expect(hist).toMatch(/TOKEN=\[secret\]/)
  expect(hist).not.toMatch(/abc123secret456/)
  expect(await run($, 'adhist', 'build')).toMatch(/1 match for "build"/)
  expect(await run($, 'adproj')).toMatch(/6 tool calls: 6 shell/)
})

test('every recording feature is independent: one switch records only its own part', async ($, on) => {
  engine(on, { features: { 'add-kit.history': true } })
  await start($)
  TOOL_OUT.fn = () => ({ result: {}, text: 'Tests: 2 passed, 2 total', isError: false })
  await bash($, 'npm test')
  expect(await run($, 'adhist')).toMatch(/npm test/)
  expect(await run($, 'adtests')).toMatch(/No test runs seen yet/)
  expect(await run($, 'adbuild')).toMatch(/No build or test commands timed/)
})

test('recorded data survives a restart of the session through the store and is validated on load', async ($, on) => {
  const { store } = engine(on, { features: { 'add-kit.history': true } })
  await start($)
  TOOL_OUT.fn = () => ({ result: {}, text: '', isError: false })
  await bash($, 'git log --oneline')
  store.set('add-kit:snips', [{ lang: 'ts', name: 'ok', code: 'x' }, { lang: 'bad lang', name: 'bad', code: 'y' }, 'junk'])
  store.set('add-kit:runs', { runs: 'not an array', cov: [{ t: 1, pct: 999, key: 'k' }] })
  await start($)
  expect(await run($, 'adhist')).toMatch(/git log --oneline/)
  expect(await run($, 'adsnip')).toMatch(/1\. ok/)
  expect(await run($, 'adsnip')).not.toMatch(/bad/)
  expect(await run($, 'adtests')).toMatch(/No test runs/)
})

// ------------------------------------------------------------------ read-only shell

test('the repo scorecard reads git through the allowlist and scores it', async ($, on) => {
  const { argvs } = engine(on, { replies: REPO, stats: { [`${ROOT}/b.txt`]: { kind: 'file', size: 10 }, [`${ROOT}/big.bin`]: { kind: 'file', size: 9_000_000 } } })

  await start($)
  const text = await run($, 'adrepo')

  expect(text).toMatch(/Repository health: \d+\/100 \(grade [A-F]\)  on main/)
  expect(text).toMatch(/Stale branches \(over 90 days\)\s+1/)
  expect(text).toMatch(/Big untracked files \(5 MB or more\)\s+1/)
  expect(text).toMatch(/Behind upstream\s+1/)
  expect(argvs.length).toBeGreaterThan(4)

  for (const argv of argvs) {
    expect(argv[0]).toBe('git')
    expect(argv.slice(1, 6)).toEqual(['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false'])
    expect(READ_VERBS).toContain(argv[6])
  }
  const ui = await $.ui.mount(PANE)

  expect(await texts(ui)).toMatch(/Repository health/)
  await ui.unmount()
})

test('outside a git repository the scorecard says so and runs nothing else', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'adrepo')).toMatch(/not a git repository/)
})

test('every process the mod ever starts is a read-only call on the allowlist', async ($, on) => {
  const { argvs } = engine(on, {
    replies: { ...REPO, lsof: { out: 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 1 a 3u IPv4 0x1 0t0 TCP 127.0.0.1:3000 (LISTEN)\n' }, ps: { out: '  PID COMM %CPU %MEM\n 1 /bin/x 1.0 2.0\n' }, du: { out: '10\t/w/p/src\n20\t/w/p\n' }, df: { out: '/dev/d 100 50 50 50% /\n' }, npm: { code: 1, out: '{}' } },
    lists: { [ROOT]: [{ name: 'package.json', kind: 'file', size: 10 }, { name: '.env', kind: 'file', size: 5 }, { name: 'src', kind: 'dir', size: 0 }], [`${ROOT}/src`]: [{ name: 'a.ts', kind: 'file', size: 5 }] },
    files: { [`${ROOT}/package.json`]: '{"license":"MIT"}' },
    stats: { [`${ROOT}/package.json`]: { kind: 'file', size: 20 } },
  })

  await start($)

  for (const c of ['adproj', 'adrepo', 'adsec', 'adlicense', 'adports', 'adprocs', 'adtodo', 'adoutdated']) await run($, c)
  expect(argvs.length).toBeGreaterThan(7)

  for (const a of argvs) {
    if (a[0] === 'git') expect(READ_VERBS).toContain(a[6])
    else expect(['lsof', 'ps', 'df', 'du', 'ls', 'npm', 'pip', 'pip3']).toContain(a[0])
    expect(a.some(w => ['push', 'commit', 'rm', 'checkout', 'install', 'add', 'reset'].includes(w))).toBe(false)
  }
  expect(argvs.filter(a => a[0] === 'npm').length).toBe(1)
})

test('npm outdated runs only when /adoutdated is typed, reads JSON despite exit code 1, and reports counts', async ($, on) => {
  const npm = JSON.stringify({ react: { current: '17.0.0', wanted: '17.0.2', latest: '18.3.1' }, lodash: { current: '4.17.20', wanted: '4.17.21', latest: '4.17.21' } })
  const { argvs } = engine(on, { replies: { npm: { code: 1, out: npm } }, lists: { [ROOT]: [{ name: 'package.json', kind: 'file', size: 10 }] }, files: {}, stats: {} })

  await start($)
  await run($, 'adproj')
  await run($, 'adsec')
  expect(argvs.some(a => a[0] === 'npm')).toBe(false)
  const text = await run($, 'adoutdated')

  expect(text).toMatch(/npm: 2 packages behind \(1 major, 0 minor, 1 patch\)/)
  expect(text).toMatch(/major\s+react\s+17\.0\.0 -> 18\.3\.1/)
  expect(argvs.filter(a => a[0] === 'npm')).toEqual([['npm', 'outdated', '--json']])
  expect(await run($, 'adoutdated', 'yarn')).toMatch(/Usage/)
})

test('pip outdated tries pip then pip3 and says when neither exists', async ($, on) => {
  const { argvs } = engine(on, { replies: { pip3: { out: '[{"name":"requests","version":"2.0.0","latest_version":"2.32.0"}]' }, pip: { code: 127, err: 'pip: command not found' } }, lists: { [ROOT]: [{ name: 'requirements.txt', kind: 'file', size: 1 }] } })

  await start($)
  const text = await run($, 'adoutdated')

  expect(text).toMatch(/pip: 1 package behind/)
  expect(argvs.map(a => a[0])).toEqual(['pip', 'pip3'])
})

test('ports and processes are parsed from the allowlisted commands', async ($, on) => {
  engine(on, {
    replies: {
      lsof: { out: 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 12345 devuser 23u IPv4 0x1 0t0 TCP 127.0.0.1:3000 (LISTEN)\npostgres 4021 devuser 7u IPv4 0x2 0t0 TCP *:5432 (LISTEN)\n' },
      ps: { out: '  PID COMM %CPU %MEM\n    1 /sbin/launchd 0.0 0.1\n 2222 /usr/bin/python3 88.5 1.2\n' },
    },
  })
  await start($)
  const ports = await run($, 'adports')

  expect(ports).toMatch(/2 listening ports: 1 on all interfaces, 1 on loopback only/)
  expect(ports).toMatch(/5432\s+all/)
  const procs = await run($, 'adprocs')

  expect(procs).toMatch(/Top 2 of 2 processes by CPU/)
  expect(procs).toMatch(/2222\s+88\.5/)
})

// ------------------------------------------------------------------ hygiene, licence, todo board, log viewer

test('the hygiene check reads names and git status only, never file contents', async ($, on) => {
  const { reads } = engine(on, { replies: REPO, lists: { [ROOT]: [{ name: '.env', kind: 'file', size: 9 }, { name: 'server.pem', kind: 'file', size: 9 }, { name: 'src', kind: 'dir', size: 0 }] } })

  await start($)
  const text = await run($, 'adsec')

  expect(text).toMatch(/HIGH\s+\.env is tracked by git/)
  expect(text).toMatch(/HIGH\s+keys\/deploy\.pem is tracked by git/)
  expect(text).toMatch(/server\.pem is here and not ignored/)
  expect(text).toMatch(/No \.gitignore/)
  expect(reads.filter(r => /\.env|\.pem/.test(r.path))).toEqual([])
})

test('the licence summary reads the licence field and the first line of the licence file', async ($, on) => {
  engine(on, {
    lists: { [ROOT]: [{ name: 'package.json', kind: 'file', size: 30 }, { name: 'LICENSE', kind: 'file', size: 1000 }] },
    stats: { [`${ROOT}/package.json`]: { kind: 'file', size: 30 }, [`${ROOT}/LICENSE`]: { kind: 'file', size: 1000 } },
    files: { [`${ROOT}/package.json`]: '{"name":"x","license":"MIT"}', [`${ROOT}/LICENSE`]: '\nMIT License\n\nCopyright (c) 2026 A\n' },
  })
  await start($)
  const text = await run($, 'adlicense')

  expect(text).toMatch(/package\.json license: MIT/)
  expect(text).toMatch(/LICENSE: "MIT License"  \(looks like MIT\)/)
  expect(text).toMatch(/not legal advice/)
})

test('the TODO board scans only files seen edited this session and skips secret-like paths', async ($, on) => {
  const { reads } = engine(on, {
    features: { 'add-kit.todos': true },
    stats: { [`${ROOT}/a.ts`]: { kind: 'file', size: 60 }, [`${ROOT}/.env`]: { kind: 'file', size: 10 }, [`${ROOT}/other.ts`]: { kind: 'file', size: 20 } },
    files: { [`${ROOT}/a.ts`]: 'const a = 1\n// TODO: tidy this\n// FIXME later\n', [`${ROOT}/.env`]: '# TODO nothing', [`${ROOT}/other.ts`]: '// TODO never edited' },
  })

  await start($)
  expect(await run($, 'adtodo')).toMatch(/No files seen edited yet/)
  TOOL_OUT.fn = () => ({ result: {}, text: 'ok' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/.env`, content: 'x' } as any)
  const text = await run($, 'adtodo')

  expect(text).toMatch(/2 notes in 1 edited file/)
  expect(text).toMatch(/TODO\s+tidy this/)
  expect(text).toMatch(/FIXME\s+later/)
  expect(text).not.toMatch(/never edited/)
  expect(reads.map(r => r.path)).toEqual([`${ROOT}/a.ts`])
})

test('the log viewer tails 16 KB, filters, masks credentials, and refuses secret-like paths', async ($, on) => {
  const big = `${'x'.repeat(30_000)}\nINFO start\nERROR failed token=abcdef123456 here\nINFO done\n`
  const { reads } = engine(on, {
    stats: { [`${ROOT}/logs/app.log`]: { kind: 'file', size: big.length }, [`${ROOT}/.env`]: { kind: 'file', size: 5 }, [`${ROOT}/link.log`]: { kind: 'file', size: 5, realPath: '/home/a/.ssh/id_rsa' }, [`${ROOT}/logs`]: { kind: 'dir', size: 0 } },
    files: { [`${ROOT}/logs/app.log`]: big },
  })

  await start($)
  const text = await run($, 'adlog', 'logs/app.log error')

  expect(text).toMatch(/last 16 KB of 29 KB/)
  expect(text).toMatch(/1 match "error"/)
  expect(text).toMatch(/ERROR failed token=\[secret\] here/)
  expect(text).not.toMatch(/abcdef123456/)
  expect(reads[0]).toMatchObject({ path: `${ROOT}/logs/app.log`, length: 16_384 })
  expect(reads[0]?.offset).toBe(big.length - 16_384)
  expect(await run($, 'adlog', '.env')).toMatch(/Refused/)
  expect(await run($, 'adlog', '/home/a/.ssh/id_rsa')).toMatch(/Refused/)
  expect(await run($, 'adlog', 'link.log')).toMatch(/Refused: that path leads to a secret-like file/)
  expect(await run($, 'adlog', 'logs')).toMatch(/not a regular file/)
  expect(await run($, 'adlog', 'missing.log')).toMatch(/no such file/)
  expect(await run($, 'adlog')).toMatch(/Usage/)
  expect(reads.length).toBe(1)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-logs' })
  expect(await ui.find({ type: 'Input', key: 'log-path' } as any)).toBeDefined()
  expect(await ui.find({ type: 'Input', key: 'log-filter' } as any)).toBeDefined()
  expect(await ui.find({ key: 'refresh' } as any)).toBeDefined()
  await ui.input({ key: 'log-path', text: 'logs/app.log' })
  await ui.input({ key: 'log-filter', text: 'info' })
  expect(await texts(ui)).toMatch(/2 match "info"/)
  await ui.unmount()
})

// ------------------------------------------------------------------ focus tab: distractions, meeting, presentation

test('task switches are logged and counted by day', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'addistract')).toMatch(/No task switches marked/)
  expect(await run($, 'addistract', 'slack ping')).toMatch(/1 task switch today, 1 in the log/)
  expect(await run($, 'addistract', 'email')).toMatch(/2 task switches today/)
  expect(await run($, 'addistract')).toMatch(/2 task switches marked, 2 today/)
  expect(await run($, 'addistract', 'x'.repeat(300))).toMatch(/under 200/)
})

test('meeting mode runs the quiet preset and restores the saved switches exactly', async ($, on) => {
  const { cfg, features, clock } = engine(on)

  Object.assign(features, { 'alerts.toasts': false, 'cockpit.band': true })
  await start($)
  expect(await run($, 'admeet', 'status')).toMatch(/off/)
  expect(await run($, 'admeet', 'on')).toMatch(/running \/cfg feature quiet now.*2 switches of yours are saved/)
  expect(cfg).toEqual([])
  await clock.advance(1)
  expect(cfg).toEqual(['feature quiet'])
  expect(await run($, 'admeet', 'on')).toMatch(/already on/)
  expect(await run($, 'admeet', 'status')).toMatch(/ON: 2 switches saved/)
  expect(await run($, 'admeet', 'off')).toMatch(/Restoring now: \/cfg feature reset, then 2 saved switches put back exactly/)
  await clock.advance(1)
  expect(cfg).toEqual(['feature quiet', 'feature reset', 'feature alerts.toasts off', 'feature cockpit.band on'])
  expect(await run($, 'admeet', 'status')).toMatch(/off/)
  expect(await run($, 'admeet', 'off')).toMatch(/not on/)
  expect(await run($, 'admeet', 'maybe')).toMatch(/Usage/)
})

test('when /cfg cannot be run for the person, meeting mode fills the prompt and keeps the saved switches', async ($, on) => {
  const { filled, features, clock } = engine(on, {
    cfg: () => {
      throw new Error('queued commands are refused here')
    },
  })

  features['alerts.toasts'] = false
  await start($)
  expect(await run($, 'admeet', 'on')).toMatch(/Meeting mode on/)
  await clock.advance(1)
  expect(filled).toEqual(['/cfg feature quiet'])
  expect(await run($, 'admeet', 'status')).toMatch(/ON: 1 switch saved/)
  await run($, 'admeet', 'off')
  await clock.advance(1)
  expect(filled[1]).toBe('/cfg feature reset')
  expect(await run($, 'admeet', 'status')).toMatch(/ON: 1 switch saved/)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-focus' })
  expect(await texts(ui)).toMatch(/Then, in order: \/cfg feature alerts\.toasts off/)
  await ui.unmount()
})

test('presentation view shows figures only, hides names, and points to /present', async ($, on) => {
  const { filled } = engine(on, { features: ALL_ON })

  await start($)
  TOOL_OUT.fn = () => ({ result: {}, text: 'Tests: 1 failed, 4 passed, 5 total\n  ● Secret Suite › leaks', isError: true })
  await bash($, 'npm test -- --token=hunter2hunter2')
  await run($, 'addistract', 'confidential client call')
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-tests' })
  expect(await texts(ui)).toMatch(/Secret Suite/)
  expect(await run($, 'adpresent', 'on')).toMatch(/Presentation view on.*\/present on/)
  expect(filled).toEqual(['/present on'])
  await ui.unmount()
  const ui2 = await $.ui.mount(PANE)
  const shown = await texts(ui2)

  expect(shown).toMatch(/Presentation view: figures only/)
  expect(shown).toMatch(/Last run\s+4 passed, 1 failed/)
  expect(shown).toMatch(/Task switches today\s+1/)
  expect(shown).not.toMatch(/Secret Suite|confidential|hunter2|npm test/)
  expect(await run($, 'adpresent', 'maybe')).toMatch(/Usage/)
  expect(await run($, 'adpresent', 'off')).toMatch(/Presentation view off/)
  expect(filled[1]).toBe('/present off')
  await ui2.unmount()
})

// ------------------------------------------------------------------ snippets

test('snippets are saved, listed, inserted as a fenced block and deleted', async ($, on) => {
  const { filled } = engine(on)

  await start($)
  expect(await run($, 'adsnip')).toMatch(/No snippets yet/)
  expect(await run($, 'adsnip', 'add ts debounce const d = f => f\\nexport default d')).toMatch(/Saved snippet "debounce"/)
  expect(await run($, 'adsnip', 'add sh leak export K=AKIAABCDEFGHIJKLMNOP')).toMatch(/secret/)
  expect(await run($, 'adsnip', 'add ts')).toMatch(/Usage/)
  expect(await run($, 'adsnip')).toMatch(/1\. debounce\s+ts/)
  expect(await run($, 'adsnip', 'use 1')).toMatch(/Prompt filled/)
  expect(filled).toEqual(['```ts\nconst d = f => f\nexport default d\n```'])
  expect(await run($, 'adsnip', 'use nope')).toMatch(/No snippet/)
  expect(await run($, 'adsnip', 'del debounce')).toMatch(/Deleted/)
  expect(await run($, 'adsnip', 'frobnicate')).toMatch(/Usage/)
})

test('the snippet form in the pane saves, inserts and deletes', async ($, on) => {
  const { filled } = engine(on)

  await start($)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-snippets' })
  await ui.input({ key: 'draft-lang', text: 'py', kind: 'change' })
  await ui.input({ key: 'draft-name', text: 'hello', kind: 'change' })
  await ui.input({ key: 'draft-code', text: 'print("hi")', kind: 'change' })
  await ui.press({ key: 'draft-save' })
  expect(await texts(ui)).toMatch(/Saved "hello"/)
  expect(await texts(ui)).toMatch(/1\. hello/)
  await ui.press({ key: 'snip-use-0' })
  expect(filled).toEqual(['```py\nprint("hi")\n```'])
  await ui.press({ key: 'snip-del-0' })
  expect(await texts(ui)).toMatch(/No snippets yet/)
  await ui.unmount()
})

// ------------------------------------------------------------------ pane

test('the pane has twelve tabs, a vector chart on desktop only, and a text chart elsewhere', async ($, on) => {
  engine(on, { features: ALL_ON })
  await start($)
  TOOL_OUT.fn = () => ({ result: {}, text: 'Tests: 1 failed, 4 passed, 5 total', isError: true })
  await bash($, 'npm test')
  const ui = await $.ui.mount(PANE)
  const buttons = (await ui.findAll({ type: 'Button' })) as { key?: string }[]

  expect(buttons.filter(b => b.key?.startsWith('tab-')).length).toBe(12)
  expect(await texts(ui)).toMatch(/Nothing read yet|Reading/)
  await ui.press({ key: 'tab-tests' })
  expect(await ui.find({ type: 'Svg' } as any)).toBeDefined()
  await ui.unmount()

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const t = await $.ui.mount({ ...PANE, surface })

    await t.press({ key: 'tab-tests' })
    expect(await t.find({ type: 'Svg' } as any)).toBeUndefined()
    expect(await texts(t)).toMatch(/1 test run/)
    await t.unmount()
  }
})

test('the vector chart can be switched off', async ($, on) => {
  engine(on, { features: { ...ALL_ON, 'add-kit.svg': false } })
  await start($)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-tests' })
  expect(await ui.find({ type: 'Svg' } as any)).toBeUndefined()
  await ui.unmount()
})

test('the system tab switches between ports, processes and disk and refreshes only on press', async ($, on) => {
  const { argvs } = engine(on, { replies: { lsof: { out: '' }, ps: { out: '  PID COMM %CPU %MEM\n 5 /bin/z 9.0 1.0\n' }, du: { out: '' }, df: { out: '' } } })

  await start($)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-system' })
  expect(await texts(ui)).toMatch(/Nothing is listening/)
  await ui.press({ key: 'sub-procs' })
  expect(await texts(ui)).toMatch(/Top 1 of 1 processes/)
  const before = argvs.length

  await ui.press({ key: 'refresh' })
  expect(argvs.length).toBe(before + 1)
  await ui.unmount()
})

test('history paging and search in the pane', async ($, on) => {
  engine(on, { features: { 'add-kit.history': true } })
  await start($)
  TOOL_OUT.fn = () => ({ result: {}, text: '' })

  for (let i = 0; i < 45; i++) await bash($, `echo line${i}`)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-history' })
  expect(await texts(ui)).toMatch(/45 commands, newest first  \(page 1 of 3\)/)
  await ui.press({ key: 'hist-next' })
  expect(await texts(ui)).toMatch(/page 2 of 3/)
  await ui.input({ key: 'hist-q', text: 'line4' })
  expect(await texts(ui)).toMatch(/6 matches for "line4"/)
  await ui.unmount()
})

// ------------------------------------------------------------------ reset

test('/adreset clears everything recorded and leaves the switches alone', async ($, on) => {
  const { features, store } = engine(on, { features: ALL_ON })

  await start($)
  TOOL_OUT.fn = () => ({ result: {}, text: 'Tests: 2 passed, 2 total', isError: false })
  await bash($, 'npm test')
  await run($, 'addistract', 'x')
  await run($, 'adsnip', 'add ts a b')
  expect(await run($, 'adreset')).toMatch(/cleared/)
  expect(await run($, 'adhist')).toMatch(/No commands recorded/)
  expect(await run($, 'adtests')).toMatch(/No test runs seen yet/)
  expect(await run($, 'addistract')).toMatch(/No task switches/)
  expect(await run($, 'adsnip')).toMatch(/No snippets yet/)
  expect(features).toEqual(ALL_ON)
  expect([...store.keys()]).toEqual([])
})

// ------------------------------------------------------------------ a refused vector never reaches the process API

test('the allowlist is the only way to the process API: a write verb is rejected before it', () => {
  expect(checkGit(['push']).ok).toBe(false)
  expect(checkGit(['status']).ok).toBe(true)
})
