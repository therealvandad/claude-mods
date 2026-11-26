import { expect, mock, test } from 'claude-code/testing'

import { MODS } from './data'
import { COMMANDS, soundMods } from './pure'

// Everything outside the mod is a stand-in here: no real process, network or disk is touched.
const HOME = '/Users/jane'

type Opts = {
  stored?: Record<string, unknown>
  foreign?: Record<string, unknown>
  /** Names of commands the stand-in refuses to run (as if the mod were not installed). */
  noRun?: string[]
  /** Command names the stand-in's register refuses. */
  refuse?: string[]
  live?: { name: string; source: string; plugin?: string }[]
  usage?: { percent: number; usd?: number; limits?: number[] }
  list?: unknown[]
  cli?: 'path' | 'none'
  now?: number
}

const LIST = [
  { id: 'notes@local-mods', version: '0.0.1', scope: 'user', enabled: true, installPath: `${HOME}/x`, readFromFolder: `${HOME}/y` },
  { id: 'alerts@local-mods', version: '0.1.0', scope: 'user', enabled: false },
  { id: 'motion@local-mods', version: '0.1.0', scope: 'user', enabled: true },
]

const world = (on: any, opts: Opts = {}) => {
  const foreign: Record<string, any> = { breakFeatures: false, features: {}, isOn: true, isCalm: false, preset: 'full', ...(opts.foreign ?? {}) }
  const box = {
    procs: [] as string[][],
    fills: [] as string[],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    opened: [] as string[],
    registered: [] as string[],
    cfg: [] as string[],
    cfgOrigins: [] as unknown[],
    motion: [] as string[],
    usage: { ...(opts.usage ?? { percent: 10 }) },
    inFlight: 0,
    maxInFlight: 0,
  }
  const clock = mock.clock(on, { now: opts.now ?? 1_000_000 })
  mock.store(on, opts.stored ?? {})
  mock.env(on, { HOME })
  on('command.register', (_: unknown, e: { name: string }) => {
    if (opts.refuse?.includes(e.name)) {
      return { deny: 'name taken' }
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
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    box.statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    box.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 1,
      context: { window: 1000, percent: box.usage.percent },
      rateLimits: (box.usage.limits ?? []).map(p => ({ kind: 'five_hour', percentUsed: p })),
      ...(box.usage.usd === undefined ? {} : { cost: { usd: box.usage.usd } }),
    },
  }))
  on('command.list', () => ({ value: opts.live ?? [] }))
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    box.procs.push([...e.argv])
    const [bin = '', ...rest] = e.argv

    if (bin !== 'claude' || opts.cli === 'none') {
      throw new Error('spawn ENOENT')
    }

    if (rest.length === 1 && rest[0] === '--version') {
      return { value: { exitCode: 0, stdout: '2.1.330 (Claude Code)\n', stderr: '' } }
    }

    if (rest[0] === 'plugin' && rest[1] === 'list') {
      return { value: { exitCode: 0, stdout: JSON.stringify(opts.list ?? LIST), stderr: '' } }
    }

    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected' } }
  })
  // The settings mod's /cfg, simulated: it keeps the overrides the way the real one does.
  on('command.run', { command: 'cfg' }, async (_: unknown, e: { args: string; origin: unknown }) => {
    if (opts.noRun?.includes('cfg')) {
      throw new Error('unknown command')
    }
    box.inFlight++
    box.maxInFlight = Math.max(box.maxInFlight, box.inFlight)
    box.cfg.push(e.args)
    box.cfgOrigins.push(e.origin)
    await Promise.resolve()
    await Promise.resolve()
    box.inFlight--
    const w = e.args.trim().split(/\s+/)

    if (w[0] === 'feature' && w[1] === 'reset') {
      foreign.features = {}
    } else if (w[0] === 'feature' && w[1] !== undefined && w[2] !== undefined) {
      const { [w[1]]: _gone, ...rest } = foreign.features

      foreign.features = w[2] === 'default' ? rest : { ...rest, [w[1]]: w[2] === 'on' }
    } else if (w[0] === 'calm') {
      foreign.isCalm = w[1] === 'on'
    }

    return { text: `cfg ok: ${e.args}` }
  })
  on('command.run', { command: 'motion' }, (_: unknown, e: { args: string }) => {
    if (opts.noRun?.includes('motion')) {
      throw new Error('unknown command')
    }
    box.motion.push(e.args)
    foreign.isOn = e.args.trim() === 'on'

    return { text: `Motion ${e.args}.` }
  })
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: any) => {
    if (e.plugin === 'settings' && e.key === 'features' && foreign.breakFeatures === true) {
      throw new Error('boom')
    }

    if (e.plugin === 'settings' && e.key === 'features') {
      return { value: { value: { shape: 'features-1', value: foreign.features }, version: 1 } }
    }

    if ((e.plugin === 'settings' && ['isCalm', 'preset', 'accent', 'density', 'icons'].includes(e.key)) || (e.plugin === 'motion' && e.key === 'isOn')) {
      const v = e.plugin === 'motion' ? foreign.isOn : foreign[e.key]

      return v === undefined ? next(e) : { value: { value: v, version: 1 } }
    }

    return next(e)
  })

  return { box, clock, foreign }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '', kind = 'composer'): Promise<string> =>
  (await $.command.run({ command, args, origin: { kind }, presentation: { layout: 'main', columns: 80 } })).text
const setup = async ($: any, on: any, opts: Opts = {}) => {
  const w = world(on, opts)
  await start($)

  return w
}
const done = (over: Record<string, unknown> = {}) => ({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...over }) as any
/** Only the version probe and `plugin list` are read-only; anything else would be a change. */
const isReadOnly = (procs: string[][]) => procs.every(p => p.at(-1) === '--version' || (p.includes('plugin') && p.includes('list')))


// An inline stand-in plugin of its own: its calls reach this mod's hooks with a real foreign origin (as in settings' gate tests).
const NOISE = (on: any) => {
  on('command.run', { command: 'noise' }, async ($: any, e: { args: string }) => {
    const [what = '', text = 'hello'] = e.args.split('|')

    if (what === 'toast') {
      await $.ui.toast(text)
    } else if (what === 'status') {
      await $.ui.status(text)
    } else if (what === 'log') {
      await $.ui.log(text)
    } else if (what === 'register') {
      return { text: await $.command.register({ name: text, description: 'x' }).then(() => 'registered', (err: Error) => `refused: ${err.message}`) }
    }

    return { text: 'noise made' }
  })
}
const STAND_IN = { plugins: [{ name: 'workbench', register: NOISE }] }
const noise = async ($: any, clock: any, what: string, text = 'hello') => {
  const out = (await $.command.run({ command: 'noise', args: `${what}|${text}`, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })).text

  await clock.settle()

  return out as string
}

const PANE = (surface = 'desktop') =>
  ({
    plugin: 'control-two',
    component: 'Pane',
    requestId: 'control-two-main',
    surface,
    props: { title: 'Control two', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as any
const BAR = (surface = 'desktop') =>
  ({
    plugin: 'control-two',
    surface,
    component: 'AbovePrompt',
    requestId: 'control-two-bar',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as any
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join('\n')
const tab = async (ui: any, id: string) => ui.press({ key: `tab-${id}` })
const liveOf = (...names: string[]) =>
  names.flatMap(n => (MODS.find(m => m.name === n)?.cmds ?? []).map(c => ({ name: c, source: 'plugin', plugin: n })))

// ------------------------------------------------------------ quiet startup and help

test('startup registers every kx command, is quiet, and survives a refused name', async ($, on) => {
  const { box } = await setup($, on, { refuse: ['kxdiag'] })

  expect(box.registered.sort()).toEqual(COMMANDS.map(c => c[0]).filter(n => n !== 'kxdiag').sort())
  expect(box.procs).toEqual([])
  expect(box.toasts).toEqual([])
  expect(box.fills).toEqual([])
  expect(box.statuses).toEqual([])
  expect(box.opened).toEqual([])
  expect(box.cfg).toEqual([])
  expect(box.motion).toEqual([])
})

test('/kx opens the pane and lists every command in one line each', async ($, on) => {
  const { box } = await setup($, on)
  const text = await run($, 'kx')

  expect(box.opened).toEqual(['control-two-main'])

  for (const [name] of COMMANDS) {
    expect(text).toContain(`/${name}`)
  }
  expect(text.split('\n').length).toBeLessThan(COMMANDS.length + 6)
  expect(box.procs).toEqual([])
})

// ------------------------------------------------------------ quick toggles (178-181)

test('/kxmotion runs /motion after the command returns, with the right argument', async ($, on) => {
  const { box, clock } = await setup($, on)
  const said = await run($, 'kxmotion', 'off')

  expect(said).toMatch(/\/motion off/)
  expect(box.motion).toEqual([])
  await clock.advance(100)
  expect(box.motion).toEqual(['off'])
  // flips from the current state when no word is given
  await run($, 'kxmotion')
  await clock.advance(100)
  expect(box.motion).toEqual(['off', 'on'])
  expect(await run($, 'kxmotion', 'status')).toMatch(/Motion is on/)
  expect((await run($, 'kxmotion', 'perhaps'))).toMatch(/on, off/)
})

test('when /motion cannot be run the line goes into the prompt box instead', async ($, on) => {
  const { box, clock } = await setup($, on, { noRun: ['motion'] })

  await run($, 'kxmotion', 'off')
  await clock.advance(100)
  expect(box.fills).toEqual(['/motion off'])
  expect(box.motion).toEqual([])
})

test('/kxcalm runs /cfg calm on|off', async ($, on) => {
  const { box, clock, foreign } = await setup($, on)

  await run($, 'kxcalm', 'on')
  await clock.advance(100)
  expect(box.cfg).toEqual(['calm on'])
  expect(foreign.isCalm).toBe(true)
  await run($, 'kxcalm')
  await clock.advance(100)
  expect(box.cfg).toEqual(['calm on', 'calm off'])
})

test('/kxsounds off makes one /cfg feature call per unlocked mod, one at a time, at most 39 per go', async ($, on) => {
  const { box, clock } = await setup($, on)
  const total = soundMods().length
  const first = Math.min(39, total)
  const said = await run($, 'kxsounds', 'off')

  expect(said).toContain(`${first} calls`)
  expect(box.cfg).toEqual([])
  await clock.advance(6000)
  expect(box.cfg.length).toBe(first)
  expect(box.cfg.every(a => /^feature [a-z0-9-]+\.sounds off$/.test(a))).toBe(true)
  expect(box.cfg.some(a => /tool-guard|safety-pro|controls\.|settings\./.test(a))).toBe(false)
  expect(box.maxInFlight).toBe(1)

  if (total > 39) {
    expect(said).toMatch(/\d+ more mods remain/)
    await run($, 'kxsounds', 'off')
    await clock.advance(6000)
  }
  expect(box.cfg.length).toBe(total)
  expect(new Set(box.cfg).size).toBe(total)
  // everything is off now: asking again changes nothing, and a toggle turns them back on
  expect(await run($, 'kxsounds', 'off')).toMatch(/Nothing to do/)
  expect(await run($, 'kxsounds', 'status')).toMatch(/all off/)
  await run($, 'kxsounds')
  await clock.advance(6000)
  expect(box.cfg.length).toBe(total + first)
  expect(box.cfg.at(-1)).toMatch(/sounds on$/)
})

test('/kxsounds stops at the first call that cannot run and puts that line in the prompt box', async ($, on) => {
  const { box, clock } = await setup($, on, { noRun: ['cfg'] })

  await run($, 'kxsounds', 'off')
  await clock.advance(6000)
  expect(box.cfg).toEqual([])
  expect(box.fills.length).toBe(1)
  expect(box.fills[0]).toMatch(/^\/cfg feature [a-z0-9-]+\.sounds off$/)
})

test('/kxrecording keeps a flag, saved by default, and says no other mod reads it', async ($, on) => {
  const { box } = await setup($, on)
  const said = await run($, 'kxrecording', 'on')

  expect(said).toMatch(/other mods do not read it/)
  expect(await run($, 'kxrecording', 'status')).toMatch(/Recording flag: on/)
  expect(box.procs).toEqual([])
  const ui = await $.ui.mount(PANE())

  expect(await texts(ui)).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'q-recording' }))?.text).toBe('Recording On')
  await ui.unmount()
})

// ------------------------------------------------------------ session-only vs saved (182)

test('/kxsave session removes the stored copies, saved writes them back', async ($, on) => {
  const { box } = await setup($, on, { stored: { 'kx.recording': true, 'kx.pins': [{ mod: 'notes', version: '0.1.0', note: '' }] } })

  expect(await run($, 'kxrecording', 'status')).toMatch(/Recording flag: on/)
  expect(await run($, 'kxsave', 'session')).toMatch(/Session only/)
  expect(await run($, 'kxrecording', 'off')).toMatch(/off/)
  expect(await run($, 'kxpin', 'alerts 0.1.0 keep')).toMatch(/Noted/)
  expect(await run($, 'kxsave')).toMatch(/session only/)
  expect(await run($, 'kxsave', 'saved')).toMatch(/Saved/)
  expect(await run($, 'kxsave', 'weird')).toMatch(/Usage/)
  expect(box.cfg).toEqual([])
})

test('a stored session-only mode starts the next session without saved settings', async ($, on) => {
  await setup($, on, { stored: { 'kx.persist': 'session' } })

  expect(await run($, 'kxsave')).toMatch(/session only/)
  expect(await run($, 'kxrecording', 'status')).toMatch(/Recording flag: off/)
})

// ------------------------------------------------------------ rules (176)

test('rules never run while the switch is off, and bad rules are refused', async ($, on) => {
  const { box, clock } = await setup($, on, { usage: { percent: 90 } })

  expect(await run($, 'kxrules', 'add tool-guard band hide when ctx >= 70')).toMatch(/cannot be switched off|cannot hide/)
  expect(await run($, 'kxrules', 'add cockpit band hide when ctx >= 70')).toMatch(/Rule 1 added/)
  await $.turn.complete(done())
  await clock.advance(500)
  expect(box.cfg).toEqual([])
  expect(await run($, 'kxrules')).toMatch(/1\. hide cockpit band/)
  expect(await run($, 'kxrules', 'rm 5')).toMatch(/Say which rule/)
  expect(await run($, 'kxrules', 'rm 1')).toMatch(/removed/)
})

test('with the switch on a rule hides a row while the context is high and puts it back', async ($, on) => {
  const { box, clock, foreign } = await setup($, on, { usage: { percent: 90 }, foreign: { features: { 'control-two.rules': true } } })

  await run($, 'kxrules', 'add cockpit band hide when ctx >= 70')
  await $.turn.complete(done())
  await clock.advance(500)
  expect(box.cfg).toEqual(['feature cockpit.band off'])
  expect(foreign.features['cockpit.band']).toBe(false)
  // still high: no repeat
  await $.turn.complete(done())
  await clock.advance(500)
  expect(box.cfg.length).toBe(1)
  // low again: restored
  box.usage.percent = 20
  await $.turn.complete(done())
  await clock.advance(500)
  expect(box.cfg).toEqual(['feature cockpit.band off', 'feature cockpit.band on'])
  expect(foreign.features['cockpit.band']).toBe(true)
  // a subagent's turn does not evaluate
  box.usage.percent = 95
  await $.turn.complete(done({ agentId: 'a1' }))
  await clock.advance(500)
  expect(box.cfg.length).toBe(2)
})

test('/kxrules restore puts switches back and /kxrules run evaluates now', async ($, on) => {
  const { box, clock } = await setup($, on, { usage: { percent: 90 } })

  await run($, 'kxrules', 'add cockpit band hide when ctx >= 70')
  await run($, 'kxrules', 'run')
  await clock.advance(500)
  expect(box.cfg).toEqual(['feature cockpit.band off'])
  const said = await run($, 'kxrules', 'restore')

  expect(said).toMatch(/cockpit.band on/)
  await clock.advance(500)
  expect(box.cfg).toEqual(['feature cockpit.band off', 'feature cockpit.band on'])
  expect(await run($, 'kxrules', 'clear')).toMatch(/All rules removed/)
})

test('at most ten rules', async ($, on) => {
  await setup($, on)

  for (let i = 0; i < 10; i++) {
    expect(await run($, 'kxrules', `add cockpit band hide when ctx >= ${i + 1}`)).toMatch(/added/)
  }
  expect(await run($, 'kxrules', 'add cockpit band hide when ctx >= 99')).toMatch(/At most 10/)
})

// ------------------------------------------------------------ backups, restore and the two-step reset (183-185)

test('/kxresetmod shows and fills a reset line but never runs it', async ($, on) => {
  const { box } = await setup($, on)

  expect(await run($, 'kxresetmod')).toContain('/alreset')
  expect(await run($, 'kxresetmod', 'alerts')).toMatch(/put in the prompt box/)
  expect(box.fills).toEqual(['/alreset'])
  expect(await run($, 'kxresetmod', 'cockpit')).toMatch(/no reset command/)
  expect(await run($, 'kxresetmod', 'nosuchmod')).toMatch(/not a mod/)
  expect(box.cfg).toEqual([])
  expect(box.procs).toEqual([])
})

test('/kxreset is two steps: nothing changes before confirm, a plugin cannot confirm, then it snapshots, clears and resets switches', async ($, on) => {
  const { box, clock, foreign } = await setup($, on, { foreign: { features: { 'cockpit.band': false, 'alerts.toasts': false } } })

  await run($, 'kxrecording', 'on')
  await run($, 'kxpin', 'notes 0.1.0')
  const step1 = await run($, 'kxreset')

  expect(step1).toMatch(/nothing has been changed/i)
  expect(box.fills.length).toBe(1)
  expect(box.fills[0]?.split('\n').every(l => /^\/[a-z]+reset$|^\/[a-z]+reset /.test(l))).toBe(true)
  expect(box.fills[0]?.split('\n').length).toBeGreaterThan(15)
  expect(box.cfg).toEqual([])
  expect(await run($, 'kxreset', 'confirm', 'plugin')).toMatch(/must be typed by you/)
  expect(box.cfg).toEqual([])
  const res = await run($, 'kxreset', 'confirm')

  expect(res).toMatch(/Reset done/)
  expect(res).toMatch(/snapshot was taken/)
  await clock.advance(200)
  expect(box.cfg).toEqual(['feature reset'])
  expect(foreign.features).toEqual({})
  expect(await run($, 'kxrecording', 'status')).toMatch(/Recording flag: off/)
  expect(await run($, 'kxpin')).toMatch(/No pins/)
  expect(await run($, 'kxbackup', 'list')).toMatch(/before reset · 2 overrides/)
  // single use
  expect(await run($, 'kxreset', 'confirm')).toMatch(/Nothing is waiting/)
  expect(isReadOnly(box.procs)).toBe(true)
})

test('a pending reset expires after two minutes, and cancel drops it', async ($, on) => {
  const { box, clock } = await setup($, on)

  await run($, 'kxreset')
  await clock.advance(121_000)
  expect(await run($, 'kxreset', 'confirm')).toMatch(/expired/)
  await run($, 'kxreset')
  expect(await run($, 'kxreset', 'cancel')).toMatch(/cancelled/)
  expect(await run($, 'kxreset', 'confirm')).toMatch(/Nothing is waiting/)
  expect(box.cfg).toEqual([])
})

test('with the autobackup switch off no snapshot is taken', async ($, on) => {
  const { clock } = await setup($, on, { foreign: { features: { 'control-two.autobackup': false } } })

  await run($, 'kxreset')
  expect(await run($, 'kxreset', 'confirm')).toMatch(/No snapshot was taken/)
  await clock.advance(200)
  expect(await run($, 'kxbackup', 'list')).toMatch(/No snapshots/)
})

test('/kxrestore previews first, then re-applies the switch overrides one call at a time', async ($, on) => {
  const { box, clock, foreign } = await setup($, on, { foreign: { features: { 'cockpit.band': false, 'alerts.sounds': false } } })

  await run($, 'kxbackup')
  foreign.features = { 'notes.band': false, 'alerts.sounds': false }
  expect(await run($, 'kxrestore', '1', 'plugin')).toBeDefined()
  const preview = await run($, 'kxrestore', '1')

  expect(preview).toMatch(/nothing has been changed/i)
  expect(preview).toContain('/cfg feature cockpit.band off')
  expect(preview).toContain('/cfg feature notes.band default')
  expect(box.cfg).toEqual([])
  expect(await run($, 'kxrestore', '1', '')).toBeDefined()
  expect(await run($, 'kxrestore', '1 confirm', 'plugin')).toMatch(/must be typed by you/)
  expect(await run($, 'kxrestore', '2 confirm')).toMatch(/No snapshot 2/)
  const said = await run($, 'kxrestore', '1 confirm')

  expect(said).toMatch(/Restoring snapshot 1/)
  await clock.advance(1000)
  expect(box.cfg).toEqual(['feature cockpit.band off', 'feature notes.band default'])
  expect(foreign.features).toEqual({ 'cockpit.band': false, 'alerts.sounds': false })
  expect(box.maxInFlight).toBe(1)
  // a second confirm without a new preview does nothing
  expect(await run($, 'kxrestore', '1 confirm')).toMatch(/Preview first/)
  expect(await run($, 'kxbackup', 'list')).toMatch(/before restore/)
})

test('snapshots are kept to five and can be deleted', async ($, on) => {
  await setup($, on)

  for (let i = 0; i < 7; i++) {
    await run($, 'kxbackup')
  }
  expect((await run($, 'kxbackup', 'list')).split('\n').filter(l => /^\s+\d\)/.test(l)).length).toBe(5)
  expect(await run($, 'kxbackup', 'clear')).toMatch(/deleted/)
  expect(await run($, 'kxbackup', 'list')).toMatch(/No snapshots/)
  expect(await run($, 'kxbackup', 'nonsense')).toMatch(/Usage/)
})

test('snapshots survive the reset and a new session', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'kxbackup')
  expect(box.cfg).toEqual([])
  await start($)
  expect(await run($, 'kxbackup', 'list')).toMatch(/1\) .* manual/)
})

// ------------------------------------------------------------ updates, rollback, pins (186-188, 198)

test('/kxupdates runs only read-only commands and compares versions with the table', async ($, on) => {
  const { box } = await setup($, on)
  const text = await run($, 'kxupdates')

  expect(box.procs.map(p => p.join(' '))).toEqual(['claude --version', 'claude plugin list --json'])
  expect(isReadOnly(box.procs)).toBe(true)
  expect(text).toMatch(/notes: installed 0\.0\.1, built with 0\.1\.0: newer available/)
  expect(text).toMatch(/alerts: 0\.1\.0: installed but disabled/)
  expect(text).not.toContain(HOME)
  expect(text).toMatch(/Nothing was installed, updated or changed/)
})

test('without a CLI /kxupdates says so and still runs nothing mutating', async ($, on) => {
  const { box } = await setup($, on, { cli: 'none' })

  expect(await run($, 'kxupdates')).toMatch(/Could not read the installed plugins/)
  expect(isReadOnly(box.procs)).toBe(true)
})

test('the Updates tab badge shows only after the check ran, and the switch can hide it', async ($, on) => {
  await setup($, on)
  let ui = await $.ui.mount(PANE())

  expect((await ui.find({ type: 'Button', key: 'tab-updates' }))?.text).toBe('Updates')
  await ui.unmount()
  await run($, 'kxupdates')
  ui = await $.ui.mount(PANE())
  expect((await ui.find({ type: 'Button', key: 'tab-updates' }))?.text).toMatch(/^\[Updates \(\d+\)\]$/)
  await ui.unmount()
})

test('the badge is gone with its switch off', async ($, on) => {
  await setup($, on, { foreign: { features: { 'control-two.badge': false } } })

  await run($, 'kxupdates')
  const ui = await $.ui.mount(PANE())

  expect((await ui.find({ type: 'Button', key: 'tab-updates' }))?.text).toBe('[Updates]')
  await ui.unmount()
})

test('rollback is honest and pins are only notes', async ($, on) => {
  const { box } = await setup($, on)

  expect(await run($, 'kxrollback', 'notes')).toMatch(/not possible/)
  expect(await run($, 'kxpin', 'notes 0.0.1 stay')).toMatch(/only a note/)
  expect(await run($, 'kxpin')).toMatch(/notes\s+0\.0\.1\s+stay/)
  const text = await run($, 'kxupdates')

  expect(text).toMatch(/pinned note: 0\.0\.1/)
  expect(await run($, 'kxpin', 'rm notes')).toMatch(/removed/)
  expect(isReadOnly(box.procs)).toBe(true)
})

// ------------------------------------------------------------ health, conflicts, self-tests (189, 191, 196)

test('/kxhealth lights come from the commands registered now', async ($, on) => {
  await setup($, on, { live: [...liveOf('alerts', 'motion'), ...liveOf('notes').slice(0, 3)] })
  const text = await run($, 'kxhealth')

  expect(await run($, 'kxhealth', 'alerts')).toMatch(/alerts: green/)
  expect(await run($, 'kxhealth', 'notes')).toMatch(/notes: amber · 3 of/)
  expect(await run($, 'kxhealth', 'cockpit')).toMatch(/cockpit: red/)
  expect(await run($, 'kxhealth', 'look-and-sound')).toMatch(/grey/)
  expect(text).toMatch(/Health from what this session can see/)
  expect(text).toMatch(/cannot prove a hook or pane works/)
  expect(await run($, 'kxhealth', 'zzz')).toMatch(/not a mod/)
})

test('/kxconflicts shows the build-time scan and a live duplicate', async ($, on) => {
  await setup($, on, { live: [...liveOf('alerts'), { name: 'alreset', source: 'plugin', plugin: 'intruder' }] })
  const text = await run($, 'kxconflicts')

  expect(text).toMatch(/Build-time scan/)
  expect(text).toMatch(/\/alreset is registered by alerts and intruder/)
  expect(text).toMatch(/refusals switch is off/)
})

test('refused registrations are recorded only with the refusals switch on, and the refusal still reaches the caller', STAND_IN, async ($, on) => {
  const { box, clock } = await setup($, on, { refuse: ['clashing'], foreign: { features: { 'control-two.refusals': true } } })

  expect(await noise($, clock, 'register', 'clashing')).toMatch(/^refused: .*name taken/)
  expect(await noise($, clock, 'register', 'fine')).toBe('registered')
  const text = await run($, 'kxconflicts')

  expect(text).toMatch(/Refused registrations seen \(1\)/)
  expect(text).toMatch(/workbench \/clashing: .*name taken/)
  expect(box.registered).toContain('fine')
})

test('with the refusals switch off a refusal is passed on and nothing is kept', STAND_IN, async ($, on) => {
  const { clock } = await setup($, on, { refuse: ['clashing'] })

  expect(await noise($, clock, 'register', 'clashing')).toMatch(/^refused: .*name taken/)
  expect(await run($, 'kxconflicts')).toMatch(/Refused registrations seen: none/)
})

test('self-tests: only documented ones, filled and never run', async ($, on) => {
  const { box } = await setup($, on)

  expect(await run($, 'kxselftest')).toMatch(/controls\s+\/ctselftest/)
  expect(await run($, 'kxselftest', 'controls')).toMatch(/put in the prompt box/)
  expect(box.fills).toEqual(['/ctselftest'])
  expect(await run($, 'kxselftest', 'notes')).toMatch(/no documented self-test/)
  expect(box.cfg).toEqual([])
})

// ------------------------------------------------------------ recorders (190, 193, 195)

test('with every recorder switch off nothing is recorded', STAND_IN, async ($, on) => {
  const { box, clock } = await setup($, on)

  await noise($, clock, 'toast', 'hello')
  await noise($, clock, 'status', 'busy')
  await noise($, clock, 'log', 'it failed badly')
  expect(await run($, 'kxtiming')).toMatch(/switch is off/)
  expect(await run($, 'kxtiming')).toMatch(/nothing yet/)
  expect(await run($, 'kxerrors')).toMatch(/Nothing recorded/)
  expect(await run($, 'kxhooks')).toMatch(/Nothing seen yet/)
  expect(box.toasts).toEqual(['hello'])
  expect(box.statuses).toEqual(['busy'])
})

test('timing counts and times the toasts and status writes per mod', STAND_IN, async ($, on) => {
  const { box, clock } = await setup($, on, { foreign: { features: { 'control-two.timing': true } } })

  await noise($, clock, 'toast', 'one')
  await noise($, clock, 'status', 'two')
  const text = await run($, 'kxtiming')

  expect(text).toMatch(/Timing is on/)
  expect(text).toMatch(/workbench\s+2 calls/)
  expect(text).toMatch(/only ui\.toast and ui\.status/)
  expect(box.toasts).toEqual(['one'])
  expect(await run($, 'kxtiming', 'clear')).toMatch(/cleared/)
  expect(await run($, 'kxtiming')).toMatch(/nothing yet/)
})

test('the error log keeps error-looking log lines only, cleaned, and per mod', STAND_IN, async ($, on) => {
  const { clock } = await setup($, on, { foreign: { features: { 'control-two.errors': true } } })

  await noise($, clock, 'log', 'could not open /Users/jane/secret.txt token=abcdefghijklmnop42')
  await noise($, clock, 'log', 'all fine here')
  const text = await run($, 'kxerrors')

  expect(text).toMatch(/1 lines/)
  expect(text).not.toMatch(/jane|abcdefghijklmnop42/)
  expect(text).toMatch(/workbench\s+could not open/)
  expect(await run($, 'kxerrors', 'workbench')).toMatch(/1 lines/)
  expect(await run($, 'kxerrors', 'nosuchplugin')).toMatch(/Nothing recorded/)
  expect(await run($, 'kxerrors', 'clear')).toMatch(/cleared/)
})

test('hook order is recorded from the links beneath, only with its switch on', STAND_IN, async ($, on) => {
  const { clock } = await setup($, on, { foreign: { features: { 'control-two.hookorder': true } } })

  await noise($, clock, 'toast', 'x')
  const text = await run($, 'kxhooks')

  expect(text).toMatch(/Hook order is on/)
  expect(text).toMatch(/Hooks beneath this mod for ui\.toast/)
  expect(text).toMatch(/the engine does not list the whole chain/)
})

test('every recorder hook is fail-open: a broken settings read never stops a toast, a status write or a log line', STAND_IN, async ($, on) => {
  const { box, clock, foreign } = await setup($, on)

  foreign.breakFeatures = true
  await noise($, clock, 'toast', 'still shown')
  await noise($, clock, 'status', 'still set')
  await noise($, clock, 'log', 'error but fine')
  expect(box.toasts).toEqual(['still shown'])
  expect(box.statuses).toEqual(['still set'])
  expect(await noise($, clock, 'register', 'late')).toBe('registered')
})

// ------------------------------------------------------------ storage, diag, deps, changes, feedback (192, 194, 197, 199, 200)

test('/kxstorage measures only this mod\'s own keys', async ($, on) => {
  await setup($, on, { stored: { 'kx.notes': [{ at: 1, mod: 'notes', text: 'hello there' }], 'kx.persist': 'saved' } })
  const text = await run($, 'kxstorage')

  expect(text).toMatch(/This mod's own store: 2 keys/)
  expect(text).toMatch(/kx\.notes/)
  expect(text).toMatch(/cannot see the stores of other mods/)
})

test('/kxdiag has versions, plugins, overrides and counts, and no path or user name', async ($, on) => {
  const { box } = await setup($, on, { foreign: { features: { 'cockpit.band': false } } })

  await run($, 'kxupdates')
  const text = await run($, 'kxdiag')

  expect(text).toContain('control-two 0.1.0')
  expect(text).toContain('notes 0.0.1 enabled')
  expect(text).toContain('cockpit.band off')
  expect(text).not.toMatch(/jane|\/Users\/|installPath/)
  expect(isReadOnly(box.procs)).toBe(true)
})

test('/kxdeps lists who needs whom and /kxchanges prints the plain-language changelog', async ($, on) => {
  await setup($, on)

  expect(await run($, 'kxdeps')).toMatch(/motion is needed by \d+/)
  const all = await run($, 'kxchanges')

  expect(all).toMatch(/Changelog \(\d+ entries/)
  expect(await run($, 'kxchanges', 'motion')).toMatch(/Changelog \(1 entry/)
  expect(await run($, 'kxchanges', 'zzz')).toMatch(/not a mod/)
})

test('feedback notes are kept per mod, cleaned and bounded, and survive a new session', async ($, on) => {
  await setup($, on)

  expect(await run($, 'kxfeedback', 'notes the list is hard to read token=abcdefghijklmnop42')).toMatch(/Note kept/)
  expect(await run($, 'kxfeedback', 'zzz hello there')).toMatch(/not a mod/)
  const list = await run($, 'kxfeedback', 'notes')

  expect(list).toMatch(/1 notes/)
  expect(list).not.toContain('abcdefghijklmnop42')
  await start($)
  expect(await run($, 'kxfeedback')).toMatch(/hard to read/)
  expect(await run($, 'kxfeedback', 'clear notes')).toMatch(/Cleared 1/)
  expect(await run($, 'kxfeedback')).toMatch(/No notes yet/)
})

// ------------------------------------------------------------ the bar (177) and the pane

test('the quick bar draws nothing with its switch off, and four buttons that run the right commands with it on', async ($, on) => {
  const { box, clock, foreign } = await setup($, on)
  let ui = await $.ui.mount(BAR())

  expect(await ui.find({ type: 'Button', key: 'bar-motion' })).toBeUndefined()
  await ui.unmount()
  foreign.features = { 'control-two.bar': true }
  ui = await $.ui.mount(BAR())
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['bar-motion', 'bar-calm', 'bar-sounds', 'bar-recording'])
  await ui.press({ key: 'bar-motion' })
  expect(box.motion).toEqual(['off'])
  await ui.press({ key: 'bar-recording' })
  expect(await run($, 'kxrecording', 'status')).toMatch(/Recording flag: on/)
  const pressed = ui.press({ key: 'bar-sounds' })

  await clock.advance(6000)
  await pressed
  expect(box.cfg.length).toBe(Math.min(39, soundMods().length))
  await ui.press({ key: 'bar-calm' })
  expect(box.cfg.at(-1)).toBe('calm on')
  await ui.unmount()
})

test('in calm the bar keeps only the calm button', async ($, on) => {
  const { foreign } = await setup($, on, { foreign: { features: { 'control-two.bar': true }, isCalm: true } })
  const ui = await $.ui.mount(BAR())

  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['bar-calm'])
  expect(foreign.isCalm).toBe(true)
  await ui.unmount()
})

test('every tab of the pane draws on every surface, with at most ten tab buttons', async ($, on) => {
  await setup($, on, { live: liveOf('alerts'), usage: { percent: 30 } })
  await run($, 'kxupdates')
  await run($, 'kxhealth')
  await run($, 'kxbackup')
  await run($, 'kxrules', 'add cockpit band hide when ctx >= 70')
  await run($, 'kxpin', 'notes 0.1.0')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile']) {
    const ui = await $.ui.mount(PANE(surface))
    const tabs = (await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('tab-'))

    expect(tabs.length).toBe(10)

    for (const id of ['quick', 'rules', 'health', 'updates', 'backups', 'hooks', 'graph', 'changes', 'feedback', 'diag']) {
      await tab(ui, id)
      expect((await ui.findAll({ type: 'Text' })).length).toBeGreaterThan(1)
    }
    await ui.unmount()
  }
})

test('the graph tab draws a vector image on the desktop and a text list elsewhere', async ($, on) => {
  await setup($, on)
  const desk = await $.ui.mount(PANE('desktop'))

  await tab(desk, 'graph')
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  await desk.unmount()
  const term = await $.ui.mount(PANE('terminal'))

  await tab(term, 'graph')
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await texts(term)).toMatch(/motion is needed by/)
  await term.unmount()
})

test('pane buttons only fill the prompt or run the documented commands, and the quick tab flips the switches through /cfg', async ($, on) => {
  const { box, clock } = await setup($, on, { live: liveOf('alerts') })
  const ui = await $.ui.mount(PANE())

  await ui.press({ key: 'sw-bar' })
  expect(box.cfg).toEqual(['feature control-two.bar on'])
  await ui.press({ key: 'q-motion' })
  expect(box.motion).toEqual(['off'])
  await ui.press({ key: 'q-save' })
  await tab(ui, 'rules')
  await ui.press({ key: 'rt-ctx' })
  expect(box.fills.at(-1)).toBe('/kxrules add cockpit band hide when ctx >= 70')
  await tab(ui, 'health')
  await ui.press({ key: 'h-refresh' })
  await ui.press({ key: 'hsel-alerts' })
  await ui.press({ key: 'h-reset' })
  expect(box.fills.at(-1)).toBe('/alreset')
  await tab(ui, 'backups')
  await ui.press({ key: 'b-now' })
  await ui.press({ key: 'b-reset' })
  await ui.press({ key: 'b-confirm' })
  expect(box.fills.at(-1)).toBe('/kxreset confirm')
  await ui.press({ key: 'b-cancel' })
  await clock.advance(100)
  expect(box.cfg).toEqual(['feature control-two.bar on'])
  expect(isReadOnly(box.procs)).toBe(true)
  await ui.unmount()
})

// ------------------------------------------------------------ no hidden outward calls

test('across every command nothing but read-only process calls and the two allowed commands ever run', async ($, on) => {
  const { box, clock } = await setup($, on, { live: liveOf('alerts') })
  const typed: [string, string][] = [
    ['kx', ''], ['kxquick', 'health'], ['kxresetmod', 'alerts'], ['kxrollback', 'notes'], ['kxpin', 'notes 0.1.0'], ['kxhealth', ''], ['kxerrors', ''], ['kxselftest', ''],
    ['kxdiag', ''], ['kxtiming', ''], ['kxstorage', ''], ['kxhooks', ''], ['kxconflicts', ''], ['kxdeps', ''], ['kxchanges', ''], ['kxfeedback', 'notes hello there'],
    ['kxbackup', ''], ['kxrestore', ''], ['kxrestore', '1'], ['kxreset', ''], ['kxreset', 'cancel'], ['kxupdates', ''], ['kxrules', 'list'], ['kxsave', ''],
  ]

  for (const [command, args] of typed) {
    await run($, command, args)
  }
  await clock.advance(2000)
  expect(box.cfg).toEqual([])
  expect(box.motion).toEqual([])
  expect(isReadOnly(box.procs)).toBe(true)
  expect(box.toasts).toEqual([])
  expect(box.statuses).toEqual([])
})

test('/motion off in the motion mod is read through the foreign atom, with nothing stored here', async ($, on) => {
  const { foreign } = await setup($, on)

  foreign.isOn = false
  expect(await run($, 'kxmotion', 'status')).toMatch(/Motion is off/)
})
