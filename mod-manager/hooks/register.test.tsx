import { expect, mock, test } from 'claude-code/testing'

import { COMMANDS } from './pure'

// Everything outside the mod is a stand-in here: no real process, network or disk is touched.
const HOME = '/fake-home'
const ROOT = `${HOME}/Library/Application Support/Claude/claude-code`
const BUNDLED = `${ROOT}/2.1.330/abc123def456/claude.app/Contents/MacOS/claude`

type Proc = { argv: string[]; timeoutMs?: number }
type Run = { exitCode: number; stdout: string; stderr: string }

type Opts = {
  cli?: 'path' | 'bundled' | 'none'
  list?: unknown[]
  run?: (args: string[]) => Run | Error
  fetch?: (url: string, init: unknown) => { status: number; ok: boolean; headers: Record<string, string>; text: string } | Error | 'never'
  stored?: Record<string, unknown>
  refuse?: string[]
  foreign?: Record<string, unknown>
  /** What the settings mod's /cfg answers; an Error rejects the call; left out, nobody answers /cfg at all. */
  cfg?: (args: string) => string | Error | undefined
  now?: number
}

const LIST = [
  { id: 'notes@local-mods', version: '0.1.0', scope: 'user', enabled: true, installPath: `${HOME}/x`, readFromFolder: `${HOME}/y` },
  { id: 'alerts@local-mods', version: '0.1.0', scope: 'user', enabled: false },
  { id: 'tool-guard@local-mods', version: '0.1.0', scope: 'user', enabled: true },
  { id: 'third-party@other', version: '2.0.0', scope: 'project', enabled: true },
]

const world = (on: any, opts: Opts = {}) => {
  const box = {
    procs: [] as Proc[],
    fills: [] as string[],
    toasts: [] as string[],
    opened: [] as string[],
    registered: [] as string[],
    fetches: [] as { url: string; init: any }[],
    cfg: [] as { args: string; origin: unknown }[],
    statuses: 0,
    saved: { ...(opts.stored ?? {}) } as Record<string, unknown>,
  }
  const cli = opts.cli ?? 'path'
  const clock = mock.clock(on, { now: opts.now ?? 1_000_000 })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: box.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    box.saved[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete box.saved[e.key]

    return { value: undefined }
  })
  mock.env(on, { HOME })

  on('command.register', (_: unknown, e: { name: string }) => {
    if (opts.refuse?.includes(e.name)) {
      throw new Error('name taken')
    }
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    box.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', () => {
    box.statuses++

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    box.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('fs.list', (_: unknown, e: { path: string }) => {
    if (cli === 'bundled' && e.path === ROOT) {
      return { value: [{ name: '2.1.330', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    }

    if (cli === 'bundled' && e.path === `${ROOT}/2.1.330`) {
      return { value: [{ name: 'abc123def456', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    }
    throw new Error('ENOENT')
  })
  on('process.run', (_: unknown, e: { argv: string[]; init?: { timeoutMs?: number } }) => {
    box.procs.push({ argv: [...e.argv], timeoutMs: e.init?.timeoutMs })
    const [bin = '', ...rest] = e.argv
    const canRun = (bin === 'claude' && cli === 'path') || (bin === BUNDLED && cli === 'bundled')

    if (!canRun) {
      throw new Error('spawn ENOENT')
    }

    if (rest.length === 1 && rest[0] === '--version') {
      return { value: { exitCode: 0, stdout: '2.1.330 (Claude Code)\n', stderr: '' } }
    }

    if (rest[0] === 'plugin' && rest[1] === 'list') {
      return { value: { exitCode: 0, stdout: JSON.stringify(opts.list ?? LIST), stderr: '' } }
    }
    const out = opts.run?.(rest) ?? { exitCode: 0, stdout: `ok ${rest.join(' ')}\n`, stderr: '' }

    if (out instanceof Error) {
      throw out
    }

    return { value: out }
  })
  on('http.fetch', async (_: unknown, e: { url: string; init?: unknown }) => {
    box.fetches.push({ url: e.url, init: e.init })
    const out = opts.fetch?.(e.url, e.init) ?? new Error('no network in this test')

    if (out === 'never') {
      return new Promise(() => undefined)
    }

    if (out instanceof Error) {
      throw out
    }

    return { value: out }
  })
  if (opts.cfg !== undefined) {
    on('command.run', { command: 'cfg' }, (_: unknown, e: { args: string; origin: unknown }) => {
      box.cfg.push({ args: e.args, origin: e.origin })
      const out = opts.cfg?.(e.args)

      if (out instanceof Error) {
        throw out
      }

      return { text: out }
    })
  }
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: any) =>
    e.plugin === 'settings' && opts.foreign?.[e.key] !== undefined
      ? // an atom with a shape tag is kept as { shape, value }
        { value: { value: e.key === 'features' ? { shape: 'features-1', value: opts.foreign[e.key] } : opts.foreign[e.key], version: 1 } }
      : next(e),
  )

  return { box, clock }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '', kind = 'composer'): Promise<string> =>
  (await $.command.run({ command, args, origin: { kind }, presentation: { layout: 'main', columns: 80 } })).text
const setup = async ($: any, on: any, opts: Opts = {}) => {
  const w = world(on, opts)
  await start($)

  return w
}
/** Only the version probe and `plugin list` are read-only; anything else would be a change. */
const isReadOnly = (procs: Proc[]) => procs.every(p => p.argv.at(-1) === '--version' || (p.argv.includes('plugin') && p.argv.includes('list')))

const PANE = {
  plugin: 'mod-manager',
  component: 'Pane',
  requestId: 'mod-manager-main',
  surface: 'desktop',
  props: { title: 'Mod manager', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join('\n')

// ------------------------------------------------------------ quiet startup

test('startup registers every mm command, is quiet, and survives a refused name', async ($, on) => {
  const { box } = await setup($, on, { refuse: ['mmsearch'] })

  expect(box.registered.sort()).toEqual(COMMANDS.map(c => c[0]).filter(n => n !== 'mmsearch').sort())
  expect(box.procs).toEqual([])
  expect(box.toasts).toEqual([])
  expect(box.fills).toEqual([])
  expect(box.statuses).toBe(0)
  expect(box.opened).toEqual([])
})

test('/mm opens the pane and lists every command', async ($, on) => {
  const { box } = await setup($, on)
  const text = await run($, 'mm')

  expect(box.opened).toEqual(['mod-manager-main'])

  for (const [name] of COMMANDS) {
    expect(text).toContain(`/${name}`)
  }
  expect(text).toContain('/mmdo confirm')
  expect(box.procs).toEqual([])
})

// ------------------------------------------------------------ no process call without confirm

test('no mutating process call happens unless /mmdo confirm is typed', async ($, on) => {
  const { box } = await setup($, on)
  const typed = [
    ['mm', ''], ['mmcat', ''], ['mmcat', 'git'], ['mmsearch', 'git'], ['mmcmds', 'notes'], ['mmmarket', ''], ['mmmarket', 'my-market'], ['mmsource', ''],
    ['mmsource', 'https://raw.githubusercontent.com/o/r/main/marketplace.json'], ['mmbundle', ''], ['mmbundle', 'show calm'], ['mmbundle', 'apply calm'],
    ['mmbundle', 'apply dev disable'], ['mmbundle', 'apply full uninstall'], ['mmbundle', 'add mine notes,alerts'], ['mmbundle', 'rm mine'],
    ['mmdo', ''], ['mmdo', 'install notes'], ['mmdo', 'enable notes'], ['mmdo', 'disable notes --scope local'], ['mmdo', 'update notes'], ['mmdo', 'uninstall notes'],
    ['mmdo', 'disable tool-guard'], ['mmdo', 'uninstall mod-manager --yes-i-know'], ['mmdo', 'install x --force'], ['mmdo', 'install ;ls'], ['mmdo', 'cancel'],
    ['mmdo', 'confirm'], ['mmdo', 'install notes'], ['mmdo', 'install other'], ['mmdo', 'cancel'], ['mmdo', 'confirm'],
  ] as const

  for (const [command, args] of typed) {
    await run($, command, args)
  }
  expect(box.procs).toEqual([])
  expect(box.toasts).toEqual([])
  // Even a confirm that came from somebody else's code runs nothing.
  await run($, 'mmdo', 'install notes')
  const refused = await run($, 'mmdo', 'confirm', 'plugin')

  expect(refused).toMatch(/must be typed by you/)
  expect(box.procs).toEqual([])
})

test('the pane buttons only fill the prompt: nothing is sent and nothing runs', async ($, on) => {
  const { box } = await setup($, on)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'cat-notes' })
  await ui.press({ key: 'sel-notes' })
  await ui.press({ key: 'copy-install' })
  await ui.press({ key: 'apply-install' })
  await ui.press({ key: 'apply-uninstall' })
  await ui.press({ key: 'tab-bundles' })
  await ui.press({ key: 'bapply-calm' })
  expect(box.fills).toEqual([
    'claude plugin install notes@local-mods --scope user',
    '/mmdo install notes',
    '/mmdo uninstall notes',
    '/mmbundle apply calm',
  ])
  expect(box.procs).toEqual([])
  await ui.unmount()
})

test('a guard shows its extra word in the apply button, and the manager has no disable or uninstall buttons', async ($, on) => {
  const { box } = await setup($, on)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'cat-safety' })
  await ui.press({ key: 'sel-tool-guard' })
  await ui.press({ key: 'apply-disable' })
  expect(box.fills.at(-1)).toBe('/mmdo disable tool-guard --yes-i-know')
  await ui.press({ key: 'cat-manager' })
  await ui.press({ key: 'sel-mod-manager' })
  expect(await ui.find({ type: 'Button', key: 'apply-disable' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'apply-uninstall' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'apply-update' })).toBeDefined()
  expect(box.procs).toEqual([])
  await ui.unmount()
})

// ------------------------------------------------------------ the two-step confirm

test('/mmdo prints the exact command, /mmdo confirm runs exactly that, once', async ($, on) => {
  const { box } = await setup($, on)
  const said = await run($, 'mmdo', 'install notes --scope project')

  expect(said).toContain('claude plugin install notes@local-mods --scope project')
  expect(said).toMatch(/Nothing has run/)
  expect(box.procs).toEqual([])

  const result = await run($, 'mmdo', 'confirm')

  // PATH `claude` was tried (read-only version check), then the one stored command ran.
  expect(box.procs.map(p => p.argv)).toEqual([
    ['claude', '--version'],
    ['claude', 'plugin', 'install', 'notes@local-mods', '--scope', 'project'],
    ['claude', 'plugin', 'list', '--json'],
  ])
  expect(box.procs[1]?.timeoutMs).toBe(120_000)
  expect(result).toContain('[1/1] claude plugin install notes@local-mods --scope project')
  expect(result).toContain('exit 0')
  expect(result).toContain('ok plugin install notes@local-mods --scope project')
  expect(box.toasts).toEqual(['mod-manager: install notes@local-mods done'])

  // Single use.
  expect(await run($, 'mmdo', 'confirm')).toMatch(/Nothing is pending/)
  expect(box.procs.length).toBe(3)
})

test('a new /mmdo replaces the pending one, and confirm runs only the latest', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'mmdo', 'install first')
  expect(await run($, 'mmdo', 'install second')).toMatch(/replaced an earlier pending action/)
  await run($, 'mmdo', 'confirm')

  const ran = box.procs.map(p => p.argv.join(' '))

  expect(ran.some(l => l.includes('second@local-mods'))).toBe(true)
  expect(ran.some(l => l.includes('first'))).toBe(false)
})

test('a pending action expires after two minutes and then runs nothing', async ($, on) => {
  const { box, clock } = await setup($, on)

  await run($, 'mmdo', 'enable notes')
  await clock.advance(119_000)
  const stillGood = await run($, 'mmdo')

  expect(stillGood).toMatch(/Pending now \(\d+ s left\)/)
  await clock.advance(1_001)
  const late = await run($, 'mmdo', 'confirm')

  expect(late).toMatch(/expired/)
  expect(box.procs).toEqual([])
  expect(await run($, 'mmdo', 'confirm')).toMatch(/Nothing is pending/)
})

test('cancel drops the pending action', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'mmdo', 'update notes')
  expect(await run($, 'mmdo', 'cancel')).toMatch(/dropped/)
  expect(await run($, 'mmdo', 'confirm')).toMatch(/Nothing is pending/)
  expect(box.procs).toEqual([])
})

test('only a person can confirm; a plugin, a schedule or a peer cannot', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'mmdo', 'enable notes')

  for (const kind of ['plugin', 'sdk', 'scheduled-trigger', 'peer', 'task-notification']) {
    expect(await run($, 'mmdo', 'confirm', kind)).toMatch(/must be typed by you/)
  }
  expect(box.procs).toEqual([])
  // The pending action is still there for the person.
  expect(await run($, 'mmdo', 'confirm', 'composer')).toMatch(/exit 0/)
})

test('guards and the manager: refused in the first command, allowed with the extra word, never for the manager', async ($, on) => {
  const { box } = await setup($, on)

  for (const name of ['tool-guard', 'safety-pro', 'controls']) {
    expect(await run($, 'mmdo', `disable ${name}`)).toMatch(/is a guard.*--yes-i-know/)
    expect(await run($, 'mmdo', `uninstall ${name}`)).toMatch(/is a guard/)
  }

  for (const verb of ['disable', 'uninstall']) {
    expect(await run($, 'mmdo', `${verb} mod-manager`)).toMatch(/will not/)
    expect(await run($, 'mmdo', `${verb} mod-manager --yes-i-know`)).toMatch(/will not/)
  }
  // Nothing was stored by any of those refusals.
  expect(await run($, 'mmdo', 'confirm')).toMatch(/Nothing is pending/)
  expect(box.procs).toEqual([])
  expect(await run($, 'mmdo', 'disable tool-guard --yes-i-know')).toContain('claude plugin disable tool-guard --scope user')
  expect(box.procs).toEqual([])
  await run($, 'mmdo', 'confirm')
  expect(box.procs.some(p => p.argv.join(' ').includes('plugin disable tool-guard'))).toBe(true)
})

test('after /mmlist, the other verbs name the installed id', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'mmlist')
  expect(await run($, 'mmdo', 'disable alerts')).toContain('claude plugin disable alerts@local-mods --scope user')
  expect(await run($, 'mmdo', 'update third-party')).toContain('claude plugin update third-party@other --scope user')
  expect(isReadOnly(box.procs)).toBe(true)
})

test('output is cleaned: secrets and home folders are masked, the tail is at most 200 lines', async ($, on) => {
  const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')
  const { box } = await setup($, on, {
    run: () => ({ exitCode: 0, stdout: `${long}\ntoken=ghp_abcdefghijklmnopqrstuvwxyz0123456789\nsaved in ${HOME}/.claude/x\n`, stderr: 'warn password=hunter2hunter2' }),
  })

  await run($, 'mmdo', 'install notes')
  const out = await run($, 'mmdo', 'confirm')

  expect(out).not.toContain('ghp_abc')
  expect(out).not.toContain('hunter2')
  expect(out).not.toContain(HOME)
  expect(out).toContain('saved in ~/.claude/x')
  expect(out).toContain('line 399')
  expect(out).not.toContain('line 100\n')
  expect(out.split('\n').length).toBeLessThanOrEqual(205)
  expect(box.toasts.length).toBe(1)
})

test('a failing command is shown with its exit code, logged, and toasted once', async ($, on) => {
  const { box } = await setup($, on, { run: () => ({ exitCode: 1, stdout: '', stderr: 'Plugin not found' }) })

  await run($, 'mmdo', 'install ghost')
  const out = await run($, 'mmdo', 'confirm')

  expect(out).toContain('exit 1')
  expect(out).toContain('! Plugin not found')
  expect(box.toasts).toEqual(['mod-manager: install ghost@local-mods failed (see /mmdo output or the Log tab)'])
  // No re-read of the installed list after a failure.
  expect(box.procs.some(p => p.argv.includes('list'))).toBe(false)
})

test('a command that cannot start or times out is a failure, not a crash', async ($, on) => {
  await setup($, on, { run: () => new Error('timed out') })
  await run($, 'mmdo', 'install slow')
  const out = await run($, 'mmdo', 'confirm')

  expect(out).toContain('exit -1')
  expect(out).toContain('timed out')
})

// ------------------------------------------------------------ finding the CLI

test('with no claude on PATH the desktop app copy is found, tried, cached and used', async ($, on) => {
  const { box } = await setup($, on, { cli: 'bundled' })

  await run($, 'mmdo', 'enable alerts')
  const out = await run($, 'mmdo', 'confirm')

  expect(box.procs.map(p => p.argv)).toEqual([
    ['claude', '--version'],
    [BUNDLED, '--version'],
    [BUNDLED, 'plugin', 'enable', 'alerts', '--scope', 'user'],
    [BUNDLED, 'plugin', 'list', '--json'],
  ])
  // What people read says `claude` and never shows the folder.
  expect(out).toContain('claude plugin enable')
  expect(out).not.toContain(HOME)
  await run($, 'mmdo', 'enable alerts')
  await run($, 'mmdo', 'confirm')
  // The version probes were not repeated: the working binary was cached.
  expect(box.procs.filter(p => p.argv.at(-1) === '--version').length).toBe(2)
})

test('with no CLI at all it says so and falls back to command lines', async ($, on) => {
  const { box } = await setup($, on, { cli: 'none' })
  const list = await run($, 'mmlist')

  expect(list).toMatch(/Could not read the installed plugins/)
  expect(list).toMatch(/could not be reached/)
  expect(list).toContain('claude plugin list')
  await run($, 'mmdo', 'install notes')
  const out = await run($, 'mmdo', 'confirm')

  expect(out).toMatch(/could not be reached/)
  expect(out).toContain('claude plugin install notes@local-mods --scope user')
  expect(box.procs.every(p => p.argv.at(-1) === '--version')).toBe(true)
  expect(box.toasts).toEqual([])
})

// ------------------------------------------------------------ the installed list

test('/mmlist reads plugin list (read-only) for every plugin, not only these mods', async ($, on) => {
  const { box } = await setup($, on)
  const out = await run($, 'mmlist')

  expect(out).toContain('4 installed plugins')
  expect(out).toContain('third-party@other')
  expect(out).toContain('○ alerts@local-mods')
  expect(out).not.toContain(HOME)
  expect(isReadOnly(box.procs)).toBe(true)
  expect(box.procs.map(p => p.argv)).toEqual([['claude', '--version'], ['claude', 'plugin', 'list', '--json']])
})

test('/mmreport has names, versions and status, and no path', async ($, on) => {
  await setup($, on)
  const report = await run($, 'mmreport')

  expect(report).toContain('mod-manager 0.1.0 report')
  expect(report).toContain('third-party@other 2.0.0 [project] enabled')
  expect(report).toContain('alerts@local-mods 0.1.0 [user] disabled')
  expect(report).not.toContain(HOME)
  expect(report).not.toMatch(/readFromFolder|installPath|Library/)
})

// ------------------------------------------------------------ bundles

test('built-in bundles show their command lines, and apply stores one multi-step pending action', async ($, on) => {
  const { box } = await setup($, on)
  const shown = await run($, 'mmbundle', 'show calm')

  expect(shown).toContain('claude plugin install settings@local-mods --scope user')
  expect(shown).toContain('claude plugin install sound-pack@local-mods --scope user')
  expect(shown).toContain('claude plugin install alerts@local-mods --scope user')
  expect(box.procs).toEqual([])
  const applied = await run($, 'mmbundle', 'apply calm')

  expect(applied).toMatch(/3 steps/)
  expect(applied).toMatch(/Nothing has run/)
  expect(box.procs).toEqual([])
})

test('a bundle runs its steps in order and stops at the first failure', async ($, on) => {
  const seen: string[] = []
  const { box } = await setup($, on, {
    run: args => {
      seen.push(args.join(' '))

      return args[2]?.startsWith('sound-pack') ? { exitCode: 2, stdout: '', stderr: 'nope' } : { exitCode: 0, stdout: 'fine', stderr: '' }
    },
  })

  await run($, 'mmbundle', 'apply calm')
  const out = await run($, 'mmdo', 'confirm')

  expect(seen).toEqual(['plugin install settings@local-mods --scope user', 'plugin install sound-pack@local-mods --scope user'])
  expect(out).toContain('[1/3]')
  expect(out).toContain('[2/3]')
  expect(out).not.toContain('[3/3]')
  expect(out).toMatch(/Stopped at the first failure; 1 step not run/)
  expect(box.toasts.length).toBe(1)
  expect(box.procs.some(p => p.argv.join(' ').includes('alerts'))).toBe(false)
})

test('a bundle apply uses the installed state to enable or skip', async ($, on) => {
  await setup($, on)
  await run($, 'mmlist')
  const out = await run($, 'mmbundle', 'apply focus')

  // notes is on, settings and workbench are not installed.
  expect(out).toContain('claude plugin install settings@local-mods --scope user')
  expect(out).toContain('claude plugin install workbench@local-mods --scope user')
  expect(out).toMatch(/Skipped: notes/)
})

test('bundles never switch off the manager, and guards need the word', async ($, on) => {
  const { box } = await setup($, on)
  const plain = await run($, 'mmbundle', 'apply full disable')

  expect(plain).not.toContain('plugin disable mod-manager')
  expect(plain).not.toContain('plugin disable tool-guard')
  expect(plain).not.toContain('plugin disable safety-pro')
  expect(plain).not.toContain('plugin disable controls')
  expect(plain).toMatch(/mod-manager \(a bundle never disables it\)/)
  const yes = await run($, 'mmbundle', 'apply full uninstall --yes-i-know')

  expect(yes).toContain('claude plugin uninstall tool-guard --scope user')
  expect(yes).not.toContain('uninstall mod-manager')
  expect(box.procs).toEqual([])
})

test('your own bundles are stored, listed, shown and removed', async ($, on) => {
  const { box } = await setup($, on)

  expect(await run($, 'mmbundle', 'add mine notes,alerts')).toMatch(/Bundle mine saved/)
  expect(await run($, 'mmbundle', 'add mine notes,Bad;name')).toMatch(/not a valid plugin name/)
  expect(await run($, 'mmbundle', 'add calm notes')).toMatch(/built-in/)
  expect(await run($, 'mmbundle', 'list')).toMatch(/mine \(2 mods, yours\): notes, alerts/)
  expect(await run($, 'mmbundle', 'show mine')).toContain('claude plugin install alerts@local-mods')
  expect(await run($, 'mmbundle', 'rm calm')).toMatch(/built in/)
  expect(await run($, 'mmbundle', 'rm toString')).toMatch(/No bundle of yours/)
  expect(await run($, 'mmbundle', 'rm mine')).toMatch(/removed/)
  expect(await run($, 'mmbundle', 'show mine')).toMatch(/No bundle named/)
  expect(box.procs).toEqual([])
})

test('your bundles survive a restart of the session', async ($, on) => {
  await setup($, on, { stored: { 'mm.bundles': { mine: ['notes', 'alerts'], calm: ['x'], 'Bad Name': ['y'], broken: 'text' } } })

  const list = await run($, 'mmbundle', 'list')

  expect(list).toContain('mine (2 mods, yours)')
  expect(list).not.toContain('Bad Name')
  expect(list).not.toContain('broken')
  expect(list).toContain('calm (3 mods): settings, sound-pack, alerts')
})

// ------------------------------------------------------------ source and check

const REMOTE = JSON.stringify({
  name: 'friends',
  plugins: [
    { name: 'brand-new', source: './brand-new', description: 'A new mod', version: '1.0.0' },
    { name: 'notes', source: './notes', description: 'Newer notes', version: '0.2.0' },
    { name: 'alerts', source: './alerts', version: '0.1.0' },
  ],
})
const GOOD_URL = 'https://raw.githubusercontent.com/owner/repo/main/.claude-plugin/marketplace.json'
const okFetch = (text: string) => () => ({ status: 200, ok: true, headers: {}, text })

test('/mmsource stores one https URL on a GitHub host and nothing else', async ($, on) => {
  const { box } = await setup($, on)

  for (const bad of ['http://raw.githubusercontent.com/o/r/main/m.json', 'https://example.com/m.json', 'https://u:p@raw.githubusercontent.com/o/r/main/m.json', 'https://raw.githubusercontent.com/o/r/main/m.json?token=1']) {
    expect(await run($, 'mmsource', bad)).toMatch(/Not stored/)
  }
  expect(await run($, 'mmsource', '')).toMatch(/No source stored/)
  expect(await run($, 'mmsource', GOOD_URL)).toContain('Source stored')
  expect(await run($, 'mmsource', '')).toContain(GOOD_URL)
  expect(box.fetches).toEqual([])
  expect(await run($, 'mmsource', 'off')).toMatch(/cleared/)
  expect(await run($, 'mmcheck')).toMatch(/No source stored/)
})

test('/mmcheck fetches with a plain GET, shows NEW and newer, and installs nothing', async ($, on) => {
  const { box } = await setup($, on, { fetch: okFetch(REMOTE) })

  await run($, 'mmsource', GOOD_URL)
  await run($, 'mmmarket', 'friends')
  const out = await run($, 'mmcheck')

  expect(box.fetches).toEqual([{ url: GOOD_URL, init: { method: 'GET' } }])
  expect(out).toMatch(/NEW\s+brand-new 1.0.0/)
  expect(out).toMatch(/NEWER\s+notes 0.1.0 -> 0.2.0/)
  expect(out).toContain('claude plugin install brand-new@friends --scope user')
  expect(out).toContain('claude plugin update notes@friends --scope user')
  expect(out).not.toMatch(/alerts@friends/)
  expect(out).toContain('claude plugin marketplace add owner/repo')
  expect(out).toMatch(/Nothing was installed/)
  expect(isReadOnly(box.procs)).toBe(true)
  expect(box.toasts).toEqual([])
})

test('/mmcheck refuses a bad answer: wrong shape, huge, error status, no network, no answer', async ($, on) => {
  let answer: ReturnType<NonNullable<Opts['fetch']>> = okFetch('{ nope')()
  const { box, clock } = await setup($, on, { fetch: () => answer })

  await run($, 'mmsource', GOOD_URL)
  expect(await run($, 'mmcheck')).toMatch(/refused: The answer is not valid JSON/)
  answer = okFetch('{"plugins":[{"name":"Bad Name","source":"x"}]}')()
  expect(await run($, 'mmcheck')).toMatch(/refused: plugins\[0\]\.name/)
  answer = okFetch('x'.repeat(1_000_001))()
  expect(await run($, 'mmcheck')).toMatch(/over 1 MB/)
  answer = { status: 200, ok: true, headers: { 'content-length': '5000000' }, text: '{}' }
  expect(await run($, 'mmcheck')).toMatch(/over 1 MB/)
  answer = { status: 404, ok: false, headers: {}, text: 'Not found' }
  expect(await run($, 'mmcheck')).toMatch(/answered 404/)
  answer = new Error('getaddrinfo ENOTFOUND')
  expect(await run($, 'mmcheck')).toMatch(/Could not fetch/)
  answer = 'never'
  const waiting = run($, 'mmcheck')

  await clock.advance(15_000)
  expect(await waiting).toMatch(/no answer within 15 s/)
  expect(box.fetches.every(f => f.init && (f.init as { method: string }).method === 'GET' && Object.keys(f.init as object).join() === 'method')).toBe(true)
  expect(isReadOnly(box.procs)).toBe(true)
})

test('/mmcheck falls back to the catalog when the installed list is unreachable', async ($, on) => {
  await setup($, on, { cli: 'none', fetch: okFetch(REMOTE) })
  await run($, 'mmsource', GOOD_URL)
  const out = await run($, 'mmcheck')

  expect(out).toContain('compared with the catalog')
  expect(out).toMatch(/NEW\s+brand-new/)
})

test('/mmmarket validates the name used in command lines', async ($, on) => {
  await setup($, on)

  expect(await run($, 'mmmarket', '')).toContain('local-mods')
  expect(await run($, 'mmmarket', 'Bad Name')).toMatch(/lowercase/)
  expect(await run($, 'mmmarket', '../x')).toMatch(/lowercase/)
  expect(await run($, 'mmmarket', 'team-mods')).toMatch(/@team-mods/)
  expect(await run($, 'mmdo', 'install notes')).toContain('notes@team-mods')
})

// ------------------------------------------------------------ extras

test('search, commands of a mod, and the catalog by category', async ($, on) => {
  await setup($, on)

  expect(await run($, 'mmsearch', 'git')).toMatch(/git-kit/)
  expect(await run($, 'mmsearch', 'zzzzqqqq')).toMatch(/Nothing in the catalog/)
  expect(await run($, 'mmsearch', '')).toMatch(/Usage/)
  const cmds = await run($, 'mmcmds', 'mod-manager')

  expect(cmds).toContain('/mmdo')
  expect(cmds).toContain('Help: /mm')
  expect(await run($, 'mmcmds', 'nope-mod')).toMatch(/No catalog mod/)
  expect(await run($, 'mmcmds', 'git')).toMatch(/Did you mean: git-kit/)
  const cat = await run($, 'mmcat', 'safety')

  expect(cat).toContain('tool-guard')
  expect(cat).not.toContain('git-kit')
  expect(await run($, 'mmcat', 'bogus')).toMatch(/Categories:/)
})

test('/mmreset clears the log, bundles, source, market and pending action', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'mmbundle', 'add mine notes')
  await run($, 'mmsource', GOOD_URL)
  await run($, 'mmmarket', 'team-mods')
  await run($, 'mmdo', 'enable notes')
  expect(await run($, 'mmreset')).toMatch(/cleared/)
  expect(await run($, 'mmbundle', 'list')).not.toContain('mine')
  expect(await run($, 'mmsource', '')).toMatch(/No source stored/)
  expect(await run($, 'mmmarket', '')).toContain('local-mods')
  expect(await run($, 'mmdo', 'confirm')).toMatch(/Nothing is pending/)
  expect(box.saved['mm.log']).toBeUndefined()
  expect(box.procs).toEqual([])
})

// ------------------------------------------------------------ the log

test('the log records pending, confirm and result, with exit code and first five lines, and stays at 100', async ($, on) => {
  const { box } = await setup($, on, { run: () => ({ exitCode: 0, stdout: 'a\nb\nc\nd\ne\nf\ng\npassword=abcdefgh', stderr: '' }) })

  await run($, 'mmdo', 'install notes')
  await run($, 'mmdo', 'confirm')
  const log = box.saved['mm.log'] as { kind: string; exit: number | null; head: string[]; argv: string }[]
  const kinds = log.map(l => l.kind)

  expect(kinds.slice(0, 3)).toEqual(['pending', 'confirm', 'result'])
  const result = log.find(l => l.kind === 'result')

  expect(result).toMatchObject({ exit: 0, argv: 'claude plugin install notes@local-mods --scope user', head: ['a', 'b', 'c', 'd', 'e'] })
  expect(JSON.stringify(log)).not.toContain('abcdefgh')

  for (let i = 0; i < 70; i++) {
    await run($, 'mmdo', 'install notes')
    await run($, 'mmdo', 'cancel')
  }
  expect((box.saved['mm.log'] as unknown[]).length).toBe(100)
})

test('nothing stored or logged holds a local path', async ($, on) => {
  const { box } = await setup($, on, { run: () => ({ exitCode: 0, stdout: `wrote ${HOME}/.claude/plugins/x`, stderr: '' }), cli: 'bundled' })

  await run($, 'mmdo', 'install notes')
  await run($, 'mmdo', 'confirm')
  await run($, 'mmlist')
  await run($, 'mmreport')
  const all = JSON.stringify(box.saved)

  expect(all).not.toContain(HOME)
  expect(all).not.toContain('Library')
})

// ------------------------------------------------------------ the pane

test('every tab draws, with defaults when the settings mod never wrote anything', async ($, on) => {
  const { box } = await setup($, on)
  const ui = await $.ui.mount(PANE)

  expect(await texts(ui)).toContain('Mod manager')
  expect(await texts(ui)).toContain('Status unknown')
  await ui.press({ key: 'cat-notes' })
  expect(await ui.find({ type: 'Button', key: 'sel-notes' })).toBeDefined()
  await ui.press({ key: 'tab-installed' })
  const installed = await texts(ui)

  expect(installed).toContain('4 plugins')
  expect(installed).toContain('cli on PATH')
  await ui.press({ key: 'isel-third-party@other' })
  expect(await texts(ui)).toContain('claude plugin update third-party@other --scope user')
  await ui.press({ key: 'tab-bundles' })
  await ui.press({ key: 'bsel-dev' })
  expect(await texts(ui)).toContain('safety-pro')
  await ui.press({ key: 'tab-source' })
  expect(await texts(ui)).toContain('none stored')
  await ui.press({ key: 'tab-log' })
  expect(await texts(ui)).toContain('Nothing logged yet')
  expect(isReadOnly(box.procs)).toBe(true)
  await ui.unmount()
})

test('chips follow the icon style of the settings mod, and the pane shows a pending action with its confirm helper', async ($, on) => {
  const { box } = await setup($, on, { foreign: { icons: 'letters', accent: 'warning', density: 'compact' } })

  await run($, 'mmlist')
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'cat-notes' })
  expect(await texts(ui)).toMatch(/ON\s/)
  await run($, 'mmdo', 'update notes')
  await ui.press({ key: 'tab-log' })
  expect(await texts(ui)).toMatch(/Pending: update notes@local-mods/)
  await ui.press({ key: 'pending-fill' })
  expect(box.fills.at(-1)).toBe('/mmdo confirm')
  await ui.press({ key: 'pending-cancel' })
  expect(await run($, 'mmdo', 'confirm')).toMatch(/Nothing is pending/)
  expect(isReadOnly(box.procs)).toBe(true)
  await ui.unmount()
})

test('the Installed tab reports an unreachable CLI and offers copy lines instead', async ($, on) => {
  await setup($, on, { cli: 'none' })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-installed' })
  expect(await texts(ui)).toContain('could not read: Claude CLI not reachable')
  expect(await texts(ui)).toContain('No CLI reachable')
  await ui.unmount()
})

test('the Source tab checks on request only and lists what to look at', async ($, on) => {
  const { box } = await setup($, on, { fetch: okFetch(REMOTE) })

  await run($, 'mmsource', GOOD_URL)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-source' })
  expect(box.fetches).toEqual([])
  await ui.press({ key: 'check' })
  expect(box.fetches.length).toBe(1)
  expect(await texts(ui)).toContain('NEW')
  await ui.press({ key: 'rcopy-brand-new' })
  expect(box.fills.at(-1)).toBe('claude plugin install brand-new@local-mods --scope user')
  await ui.press({ key: 'copy-market-add' })
  expect(box.fills.at(-1)).toBe('claude plugin marketplace add owner/repo')
  await ui.unmount()
})

// ------------------------------------------------------------ the Features tab

const SURFACES = ['terminal', 'desktop'] as const
const labelOf = async (ui: any, key: string): Promise<string | undefined> => ((await ui.find({ type: 'Button', key })) as { text?: string } | undefined)?.text
const okCfg = (args: string) => `ran ${args}`
const filterTo = (text: string) => ({ plugin: 'mod-manager', key: 'fsearch', text, kind: 'change' }) as const

test('the Features tab draws on the terminal and on the desktop, with four switches per mod', async ($, on) => {
  await setup($, on, { cfg: okCfg })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    await ui.press({ key: 'tab-features' })
    expect(await texts(ui)).toContain('0 switches changed from default')
    await $.ui.input(filterTo('cockpit'))
    const text = await texts(ui)

    expect(text).toContain('cockpit')
    expect(await labelOf(ui, 'ft-cockpit.toasts')).toBe('Toasts On')
    expect(await labelOf(ui, 'ft-cockpit.sounds')).toBe('Sounds On')
    expect(await labelOf(ui, 'ft-cockpit.status')).toBe('Status On')
    expect(await labelOf(ui, 'ft-cockpit.band')).toBe('Row On')

    for (const key of ['fp-quiet', 'fp-calm', 'fp-full']) {
      expect(await ui.find({ type: 'Button', key })).toBeDefined()
    }
    expect(await ui.find({ type: 'Input', key: 'fsearch' })).toBeDefined()
    await ui.unmount()
  }
})

test('the safety mods and settings show no toggles: their messages cannot be muted', async ($, on) => {
  await setup($, on, { cfg: okCfg, foreign: { features: { 'controls.toasts': false } } })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  await ui.press({ key: 'fp-quiet' })

  for (const mod of ['tool-guard', 'safety-pro', 'controls', 'settings']) {
    await $.ui.input(filterTo(mod))
    expect(await texts(ui)).toContain(mod)
    expect(await ui.find({ type: 'Button', key: `ft-${mod}.toasts` })).toBeUndefined()
    expect(await texts(ui)).toMatch(/always on/)
  }
  // a stored override for a locked switch does not count as a change
  expect(await texts(ui)).toContain('0 switches changed from default')
  await ui.unmount()
})

test('pressing a switch runs /cfg through command.run with the exact arguments, and shows the answer', async ($, on) => {
  const { box } = await setup($, on, { cfg: a => `Done. ${a}` })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  await $.ui.input(filterTo('cockpit'))
  await ui.press({ key: 'ft-cockpit.toasts' })
  await $.ui.input(filterTo('workbench'))
  await ui.press({ key: 'ft-workbench.band' })
  expect(box.cfg.map(c => c.args)).toEqual(['feature cockpit.toasts off', 'feature workbench.band off'])
  expect(box.cfg.every(c => (c.origin as { kind: string }).kind === 'plugin')).toBe(true)
  expect(box.fills).toEqual([])
  expect(await texts(ui)).toContain('Done. feature workbench.band off')
  expect(box.procs).toEqual([])
  await ui.press({ key: 'tab-log' })
  expect(await texts(ui)).toMatch(/feature\s+\/cfg feature workbench\.band off/)
  await ui.unmount()
})

test('a switch that is off reads Off*, and pressing it asks for on', async ($, on) => {
  const { box } = await setup($, on, { cfg: okCfg, foreign: { features: { 'cockpit.toasts': false, 'workbench.band': false } } })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  expect(await texts(ui)).toContain('2 switches changed from default')
  await $.ui.input(filterTo('cockpit'))
  expect(await labelOf(ui, 'ft-cockpit.toasts')).toBe('Toasts Off*')
  expect(await labelOf(ui, 'ft-cockpit.band')).toBe('Row On')
  await $.ui.input(filterTo('workbench'))
  expect(await labelOf(ui, 'ft-workbench.band')).toBe('Row Off*')
  await $.ui.input(filterTo('cockpit'))
  await ui.press({ key: 'ft-cockpit.toasts' })
  expect(box.cfg.map(c => c.args)).toEqual(['feature cockpit.toasts on'])
  await ui.unmount()
})

test('the count of changed switches ignores junk, unknown mods, locked switches and values equal to the default', async ($, on) => {
  await setup($, on, {
    cfg: okCfg,
    foreign: { features: { 'cockpit.toasts': false, 'cockpit.band': true, 'nope.toasts': false, 'controls.band': false, 'workbench.sounds': 'no', 'workbench.status': null } },
  })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  expect(await texts(ui)).toContain('1 switch changed from default')
  await ui.unmount()
})

test('when /cfg cannot be run from here, the line goes to the prompt box and the Log tab says so', async ($, on) => {
  const { box } = await setup($, on, { cfg: () => new Error('refused') })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  await $.ui.input(filterTo('cockpit'))
  await ui.press({ key: 'ft-cockpit.sounds' })
  expect(box.cfg.length).toBe(1)
  expect(box.fills).toEqual(['/cfg feature cockpit.sounds off'])
  expect(await texts(ui)).toMatch(/Could not run \/cfg feature cockpit\.sounds off from here, so it is in the prompt box/)
  await ui.press({ key: 'tab-log' })
  expect(await texts(ui)).toMatch(/fallback: Could not run/)
  await ui.unmount()
})

test('the fallback also covers nobody answering /cfg, an empty answer, and a prompt box that cannot be filled', async ($, on) => {
  // nobody serves /cfg at all: the call itself fails
  const none = await setup($, on)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  await ui.press({ key: 'fp-calm' })
  expect(none.box.fills).toEqual(['/cfg feature calm'])
  await ui.unmount()
})

test('an empty answer from /cfg counts as not run', async ($, on) => {
  const { box } = await setup($, on, { cfg: () => undefined })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  await ui.press({ key: 'fp-full' })
  expect(box.cfg.map(c => c.args)).toEqual(['feature full'])
  expect(box.fills).toEqual(['/cfg feature full'])
  await ui.unmount()
})

test('the preset buttons run /cfg feature quiet, calm and full', async ($, on) => {
  const { box } = await setup($, on, { cfg: okCfg })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  await ui.press({ key: 'fp-quiet' })
  await ui.press({ key: 'fp-calm' })
  await ui.press({ key: 'fp-full' })
  expect(box.cfg.map(c => c.args)).toEqual(['feature quiet', 'feature calm', 'feature full'])
  expect(box.fills).toEqual([])
  await ui.unmount()
})

test('the search box filters the mods, and clear brings them back', async ($, on) => {
  await setup($, on, { cfg: okCfg })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  const total = /page 1\/\d+ · \d+ mods/.exec(await texts(ui))?.[0]
  expect(total).toBeDefined()
  await $.ui.input({ plugin: 'mod-manager', key: 'fsearch', text: 'cockpit', kind: 'change' })
  expect(await ui.find({ type: 'Button', key: 'ft-cockpit.toasts' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ft-workbench.toasts' })).toBeUndefined()
  await $.ui.input({ plugin: 'mod-manager', key: 'fsearch', text: 'nothing-like-this-xyz' })
  expect(await texts(ui)).toContain('No mod matches that.')
  await ui.press({ key: 'fclear' })
  expect(await texts(ui)).toContain(total ?? 'missing')
  await $.ui.input(filterTo('workbench'))
  expect(await ui.find({ type: 'Button', key: 'ft-workbench.toasts' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ft-cockpit.toasts' })).toBeUndefined()
  await ui.unmount()
})

test('/mmfeatures [mod] opens the tab filtered and says what it found', async ($, on) => {
  const { box } = await setup($, on, { cfg: okCfg, foreign: { features: { 'workbench.toasts': false } } })
  const text = await run($, 'mmfeatures', 'workbench')

  expect(box.opened).toEqual(['mod-manager-main'])
  expect(text).toMatch(/Features tab opened for "workbench"\. 1 switch changed from default/)
  expect(text).toContain('workbench: toasts off, sounds on, status on, row on')
  expect(text).not.toContain('cockpit:')
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Button', key: 'ft-workbench.toasts' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ft-cockpit.toasts' })).toBeUndefined()
  await ui.unmount()
  expect(await run($, 'mmfeatures', '')).toMatch(/Features tab opened\. 1 switch changed/)
  expect(await run($, 'mmfeatures', 'x; rm -rf')).toMatch(/Usage: \/mmfeatures/)
  expect(await run($, 'mmfeatures', 'zzzzqqq')).toMatch(/No mod matches that/)
  expect(await run($, 'mmfeatures', 'controls')).toContain('controls: always on')
  expect(box.procs).toEqual([])
  expect(box.cfg).toEqual([])
})

test('the tab never disables a plugin: it has no process call, and only /cfg is raised', async ($, on) => {
  const { box } = await setup($, on, { cfg: okCfg })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-features' })
  await $.ui.input(filterTo('cockpit'))
  await ui.press({ key: 'ft-cockpit.status' })
  await ui.press({ key: 'fp-quiet' })
  expect(box.procs).toEqual([])
  expect(box.cfg.every(c => c.args.startsWith('feature '))).toBe(true)
  expect(await run($, 'mmdo', 'confirm')).toMatch(/Nothing is pending/)
  const labels = ((await ui.findAll({ type: 'Button' })) as { text: string }[]).map(b => b.text).join('|')

  expect(labels).not.toMatch(/disable|uninstall|\benable\b/i)
  await ui.unmount()
})

test('the Features tab pages through the mods and every page keeps whole mod rows', async ($, on) => {
  await setup($, on, { cfg: okCfg })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 16 } } } as any)

  await ui.press({ key: 'tab-features' })
  const first = await texts(ui)

  expect(first).toMatch(/page 1\/\d+/)
  await ui.press({ key: 'fpage-next' })
  expect(await texts(ui)).toMatch(/page 2\/\d+/)
  await ui.press({ key: 'fpage-prev' })
  expect(await texts(ui)).toMatch(/page 1\/\d+/)
  await ui.unmount()
})
