import { expect, mock, test } from 'claude-code/testing'

import { COMMANDS } from './logic'

// Everything outside the mod is a stand-in here: no real process, network or disk is touched.
// Wednesday 2026-11-25 10:00:00 UTC
const T0 = Date.UTC(2026, 10, 25, 10, 0, 0)
const MIN = 60_000

type Opts = {
  stored?: Record<string, unknown>
  features?: Record<string, boolean>
  cwd?: string
  git?: string | Error
  failStore?: boolean
  now?: number
  refuse?: string[]
}

let current: { prefs: Record<string, unknown> }

const world = (on: any, opts: Opts = {}) => {
  const box = {
    registered: [] as string[],
    opened: [] as any[],
    toasts: [] as { text: string; timeoutMs?: number }[],
    fills: [] as string[],
    procs: [] as { argv: string[]; cwd?: string }[],
    statuses: 0,
    saved: { ...(opts.stored ?? {}) } as Record<string, unknown>,
    features: { ...(opts.features ?? {}) } as Record<string, boolean>,
    cwd: opts.cwd ?? '/work/app',
    git: opts.git as string | Error | undefined,
    prefs: {} as Record<string, unknown>,
  }
  current = box
  const clock = mock.clock(on, { now: opts.now ?? T0 })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: box.saved[e.key] }))
  on('state.set', (_: unknown, e: { plugin: string; key: string; value: any }, next: any) => {
    // The test's `$` has no `state`: the shared atom is read from what the mod writes to it.
    if (e.plugin === 'prefs' && e.key === 'prefs') {
      box.prefs = e.value?.value ?? {}
    }

    return next(e)
  })
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    if (opts.failStore === true) {
      throw new Error('disk full')
    }
    box.saved[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete box.saved[e.key]

    return { value: undefined }
  })
  on('command.register', (_: unknown, e: { name: string }) => {
    if (opts.refuse?.includes(e.name)) {
      throw new Error('name taken')
    }
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: unknown) => {
    box.opened.push(e)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_: unknown, e: { text: string; timeoutMs?: number }) => {
    box.toasts.push({ text: e.text, timeoutMs: e.timeoutMs })

    return { value: undefined }
  })
  on('ui.status', () => {
    box.statuses++

    return { value: undefined }
  })
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    box.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: box.cwd }))
  on('process.run', (_: unknown, e: { argv: string[]; init?: { cwd?: string } }) => {
    box.procs.push({ argv: [...e.argv], cwd: e.init?.cwd })

    if (box.git instanceof Error || box.git === undefined) {
      throw new Error('no git here')
    }

    return { value: { exitCode: 0, stdout: `${box.git}\n`, stderr: '' } }
  })
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: any) =>
    e.plugin === 'settings' && e.key === 'features' ? { value: { value: { shape: 'features-1', value: box.features }, version: 1 } } : next(e),
  )

  return { box, clock }
}

const start = ($: any, cwd = '/work/app') => $.session.start({ cwd, surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '', kind = 'composer'): Promise<string> =>
  (await $.command.run({ command, args, origin: { kind }, presentation: { layout: 'main', columns: 80 } })).text
const setup = async ($: any, on: any, opts: Opts = {}) => {
  const w = world(on, opts)
  await start($, opts.cwd ?? '/work/app')

  return w
}
const eff = async (_$: any): Promise<Record<string, unknown>> => ({ ...current.prefs })

const PANE = {
  plugin: 'prefs',
  component: 'Pane',
  requestId: 'prefs-main',
  surface: 'desktop',
  props: { title: 'Preferences', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join('\n')
const FIXED_ZONE = { 'tz.mode': 'fixed', 'tz.offset': 0 }

// ------------------------------------------------------------ start-up

test('start-up registers every command, survives a refused name, and is quiet', async ($, on) => {
  const { box } = await setup($, on, { refuse: ['pfmods'] })

  expect(box.registered.sort()).toEqual(COMMANDS.map(c => c[0]).filter(n => n !== 'pfmods').sort())
  expect(box.toasts).toEqual([])
  expect(box.fills).toEqual([])
  expect(box.opened).toEqual([])
  expect(box.procs).toEqual([])
  expect(box.statuses).toBe(0)
  expect(await eff($)).toEqual({})
})

test('/pf opens the pane and lists every command and the honest scope', async ($, on) => {
  const { box } = await setup($, on)
  const text = await run($, 'pf')

  expect(box.opened.length).toBe(1)
  expect(box.opened[0]).toEqual({ id: 'prefs-main', title: 'Preferences', columns: 80 })

  for (const [name] of COMMANDS) {
    expect(text).toContain(`/${name}:`)
  }
  expect(text).toContain('READS')
})

test('pane width and dock or float preferences shape how the pane is asked for', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'pfset', 'pane.width wide')
  await run($, 'pfset', 'pane.placement float')
  await run($, 'pf')
  expect(box.opened[0]).toEqual({ id: 'prefs-main', title: 'Preferences', columns: 110, placement: 'widget' })
  await run($, 'pfset', 'lang de')
  await run($, 'pf')
  expect(box.opened[1].title).toBe('Einstellungen')
})

// ------------------------------------------------------------ set, get, reset

test('/pfset changes the shared atom and is saved; defaults remove the override', async ($, on) => {
  const { box } = await setup($, on)

  expect(await run($, 'pfset', 'money.symbol EUR')).toContain('money.symbol = eur')
  expect(await eff($)).toEqual({ 'money.symbol': 'eur' })
  expect(box.saved['pf.base']).toEqual({ 'money.symbol': 'eur' })
  expect(await run($, 'pfset', 'toast.ms 3000')).toContain('3000 ms')
  expect(await eff($)).toEqual({ 'money.symbol': 'eur', 'toast.ms': 3000 })
  expect(await run($, 'pfset', 'money.symbol usd')).toContain('(the default)')
  expect(await eff($)).toEqual({ 'toast.ms': 3000 })
  expect(await run($, 'pfset', 'toast.ms 3000')).toContain('already')
})

test('/pfset refuses what it cannot accept, and explains', async ($, on) => {
  await setup($, on)

  expect(await run($, 'pfset')).toContain('Usage')
  expect(await run($, 'pfset', 'nope 1')).toContain('No preference named "nope"')
  expect(await run($, 'pfset', 'money.symbl eur')).toContain('Closest: money.symbol')
  expect(await run($, 'pfset', 'toast.ms 12')).toContain('out of range')
  expect(await run($, 'pfset', 'toast.ms abc')).toContain('a number from 1000 to 15000 ms')
  expect(await run($, 'pfset', 'money.cents maybe')).toContain('on or off')
  expect(await run($, 'pfset', 'lang')).toContain('one of en, es, de')
  expect(await run($, 'pfset', 'num.group dot')).toContain('cannot both be')
  expect(await run($, 'pfset', 'sync.mode weird')).toContain('one of synced, per-project')
  expect(await eff($)).toEqual({})
})

test('/pfset num.decimal comma also moves the group separator', async ($, on) => {
  await setup($, on)
  const text = await run($, 'pfset', 'num.decimal comma')

  expect(text).toContain('num.group changed to dot')
  expect(await eff($)).toEqual({ 'num.decimal': 'comma', 'num.group': 'dot' })
})

test('a per-mod key for a mod that is not in the list still works', async ($, on) => {
  await setup($, on)

  expect(await run($, 'pfset', 'quiet.brand-new-mod 22:00-07:00')).toContain('quiet.brand-new-mod = 22:00-07:00')
  expect(await run($, 'pfset', 'retain.alerts 7')).toContain('7 days')
  expect(await run($, 'pfset', 'record.alerts off')).toContain('off')
  expect(await run($, 'pfset', 'quiet.b@d 22:00-07:00')).toContain('No preference named')
  expect(await eff($)).toEqual({ 'quiet.brand-new-mod': '22:00-07:00', 'retain.alerts': 7, 'record.alerts': false })
})

test('/pfget: summary, one key, search, near misses', async ($, on) => {
  await setup($, on)

  expect(await run($, 'pfget')).toContain('0 changed from default')
  await run($, 'pfset', 'toast.ms 3000')
  await run($, 'pfset', 'money.symbol gbp')
  const all = await run($, 'pfget')

  expect(all).toContain('2 changed from default')
  expect(all).toContain('toast.ms = 3000 ms  (default 4000 ms)')
  const one = await run($, 'pfget', 'money.symbol')

  expect(one).toContain('money.symbol: gbp (default usd)')
  expect(one).toContain('decided by: base')
  expect(one).toContain('preview: ')
  expect(await run($, 'pfget', 'tip.delay')).toContain('decided by: default')
  expect(await run($, 'pfget', 'cents')).toContain('money.cents = on')
  expect(await run($, 'pfget', 'money.sym')).toContain('money.symbol')
  expect(await run($, 'pfget', 'zz.yy')).toContain('No preference named "zz.yy"')
  expect(await run($, 'pfget', 'zzzzqqq')).toContain('0 matches')
})

test('/pfreset: one key, all, history, and everything needs the word confirm', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'pfset', 'toast.ms 3000')
  await run($, 'pfset', 'lang es')
  expect(await run($, 'pfreset', 'lang')).toContain('back to its default')
  expect(await run($, 'pfreset', 'lang')).toContain('already at its default')
  expect(await run($, 'pfreset', 'nope')).toContain('No preference named')
  expect(await eff($)).toEqual({ 'toast.ms': 3000 })
  expect(await run($, 'pfreset')).toContain('1 changed preferences are back')
  expect(await eff($)).toEqual({})
  expect(await run($, 'pfreset')).toContain('Nothing to reset')
  expect((await run($, 'pfundo', 'list')).length).toBeGreaterThan(20)
  expect(await run($, 'pfreset', 'history')).toContain('cleared')
  expect(await run($, 'pfundo')).toContain('Nothing to undo')
  await run($, 'pfset', 'lang de')
  expect(await run($, 'pfreset', 'everything')).toContain('/pfreset everything confirm')
  expect(await eff($)).toEqual({ lang: 'de' })
  expect(await run($, 'pfreset', 'everything confirm')).toContain('Everything prefs recorded is cleared')
  expect(await eff($)).toEqual({})
  expect(box.saved).toEqual({})
})

// ------------------------------------------------------------ persistence

test('what is stored comes back at the next start, and junk is cleaned', async ($, on) => {
  const { box } = await setup($, on, {
    stored: { 'pf.base': { lang: 'es', 'toast.ms': 3000, bogus: 1, 'money.cents': 'no' }, 'pf.history': 'junk', 'pf.layers': 5, 'pf.profiles': { work: { lang: 'de' }, mine: { 'toast.ms': 2000, lang: 'de' } }, 'pf.auto': { on: 'yes' }, 'pf.meta': { lastTab: 'zzz' } },
  })

  expect(await eff($)).toEqual({ lang: 'es', 'toast.ms': 3000 })
  expect(await run($, 'pfundo', 'list')).toContain('No changes recorded')
  expect(await run($, 'pfprofile', 'list')).toContain('mine (yours, 1 values)')
  expect(await run($, 'pfauto', 'status')).toContain('Auto profile: off')
  expect(box.toasts).toEqual([])
})

test('the atom other mods read is the global overrides, as a record', async ($, on) => {
  await setup($, on)
  await run($, 'pfset', 'money.symbol eur')
  await run($, 'pfset', 'tip.hover off')
  const e = await eff($)

  expect(e['money.symbol']).toBe('eur')
  expect(e['tip.hover']).toBe(false)
  expect(Object.keys(e).sort()).toEqual(['money.symbol', 'tip.hover'])
})

// ------------------------------------------------------------ undo

test('/pfundo undoes the last change, several, and lists them', async ($, on) => {
  await setup($, on)

  await run($, 'pfset', 'lang es')
  await run($, 'pfset', 'toast.ms 3000')
  await run($, 'pfset', 'lang de')
  expect(await run($, 'pfundo', 'list')).toContain('1. just now: set lang')
  expect(await run($, 'pfundo')).toContain('set lang (base, 1 value)')
  expect((await eff($))['lang']).toBe('es')
  expect(await run($, 'pfundo', '2')).toContain('Undid 2 changes')
  expect(await eff($)).toEqual({})
  expect(await run($, 'pfundo')).toContain('Nothing to undo')
  expect(await run($, 'pfundo', 'x')).toContain('Usage')
  expect(await run($, 'pfundo', '0')).toContain('Usage')
  expect(await run($, 'pfundo', '123')).toContain('Usage')
})

test('the history records each change in order (the 30 entry cap is tested on the pure function)', async ($, on) => {
  await setup($, on)

  for (let i = 1; i <= 5; i++) {
    await run($, 'pfset', `tip.delay ${100 * i}`)
  }
  const list = await run($, 'pfundo', 'list')

  expect(list).toContain('Last 5 changes, newest first')
  expect(list).toContain('5. just now: set tip.delay')
})

test('with the history switch off nothing is recorded and /pfundo says so', async ($, on) => {
  await setup($, on, { features: { 'prefs.history': false } })

  await run($, 'pfset', 'lang es')
  expect(await run($, 'pfundo')).toContain('Nothing to undo')
  expect(await run($, 'pfundo', 'list')).toContain('prefs.history switch is off')
  expect((await eff($))['lang']).toBe('es')
})

// ------------------------------------------------------------ export and import

test('/pfexport shows a JSON block and writes nothing', async ($, on) => {
  const { box } = await setup($, on)

  await run($, 'pfset', 'lang es')
  await run($, 'pfset', 'toast.ms 3000')
  const text = await run($, 'pfexport')
  const block = text.split('```json\n')[1]!.split('\n```')[0]!

  expect(JSON.parse(block)).toEqual({ format: 'prefs-1', prefs: { lang: 'es', 'toast.ms': 3000 } })
  expect(text).toContain('Nothing was written to a file')
  expect(box.fills).toEqual([])
})

test('/pfimport checks, shows a diff first, and only /pfimport confirm applies it', async ($, on) => {
  await setup($, on)
  await run($, 'pfset', 'lang es')
  const json = JSON.stringify({ format: 'prefs-1', prefs: { 'toast.ms': 3000, 'money.symbol': 'chf' } })
  const shown = await run($, 'pfimport', json)

  expect(shown).toContain('Valid. Applying would change 3 preferences (1 go back to default')
  expect(shown).toContain('lang: es -> default (en)')
  expect(shown).toContain('toast.ms: default (4000 ms) -> 3000 ms')
  expect(await eff($)).toEqual({ lang: 'es' })
  expect(await run($, 'pfimport', 'confirm', 'plugin')).toContain('must be typed by you')
  expect(await eff($)).toEqual({ lang: 'es' })
  expect(await run($, 'pfimport', 'confirm')).toContain('Imported: 3 changes applied')
  expect(await eff($)).toEqual({ 'toast.ms': 3000, 'money.symbol': 'chf' })
  expect(await run($, 'pfimport', 'confirm')).toContain('Nothing waiting')
  expect(await run($, 'pfundo')).toContain('import')
  expect(await eff($)).toEqual({ lang: 'es' })
})

test('/pfimport: invalid input changes nothing, cancel and expiry work', async ($, on) => {
  const { clock } = await setup($, on)
  const bad = await run($, 'pfimport', '{"format":"prefs-1","prefs":{"lang":"fr","nope":1}}')

  expect(bad).toContain('Not imported')
  expect(bad).toContain('lang must be one of')
  expect(bad).toContain('Unknown preference "nope"')
  expect(await run($, 'pfimport', 'confirm')).toContain('Nothing waiting')
  expect(await run($, 'pfimport', 'not json')).toContain('Not valid JSON')
  expect(await run($, 'pfimport', '')).toContain('Nothing to import')
  expect(await run($, 'pfimport', JSON.stringify({ format: 'prefs-1', prefs: {} }))).toContain('changes nothing')
  const ok = JSON.stringify({ format: 'prefs-1', prefs: { lang: 'de' } })

  await run($, 'pfimport', ok)
  expect(await run($, 'pfimport', 'cancel')).toContain('cancelled')
  expect(await run($, 'pfimport', 'confirm')).toContain('Nothing waiting')
  await run($, 'pfimport', ok)
  await clock.advance(6 * MIN)
  expect(await run($, 'pfimport', 'confirm')).toContain('expired')
  expect(await eff($)).toEqual({})
})

test('an export can be imported back, fenced as it was shown', async ($, on) => {
  await setup($, on)
  await run($, 'pfset', 'lang de')
  await run($, 'pfset', 'quiet.alerts 22:00-07:00')
  const exported = await run($, 'pfexport')
  const block = '```json\n' + exported.split('```json\n')[1]!.split('\n```')[0]! + '\n```'

  await run($, 'pfreset')
  expect(await eff($)).toEqual({})
  await run($, 'pfimport', block)
  await run($, 'pfimport', 'confirm')
  expect(await eff($)).toEqual({ lang: 'de', 'quiet.alerts': '22:00-07:00' })
})

// ------------------------------------------------------------ profiles

test('a built-in profile replaces everything except your locale settings, and undo brings it back', async ($, on) => {
  await setup($, on)
  await run($, 'pfset', 'lang de')
  await run($, 'pfset', 'money.symbol eur')
  await run($, 'pfset', 'chart.grid off')
  const text = await run($, 'pfprofile', 'use work')

  expect(text).toContain('Profile work applied')
  const e = await eff($)

  expect(e['lang']).toBe('de')
  expect(e['money.symbol']).toBe('eur')
  expect(e['chart.grid']).toBeUndefined()
  expect(e['toast.ms']).toBe(3000)
  expect(await run($, 'pfprofile', 'list')).toContain('work (built in, 8 values) <- in use')
  expect(await run($, 'pfprofile', 'use work')).toContain('already in force')
  await run($, 'pfundo')
  expect(await eff($)).toEqual({ lang: 'de', 'money.symbol': 'eur', 'chart.grid': false })
  expect(await run($, 'pfprofile', 'use nope')).toContain('No profile named')
})

test('your own profiles: save, list, use, delete; built-ins are protected', async ($, on) => {
  await setup($, on)
  await run($, 'pfset', 'toast.ms 2000')
  await run($, 'pfset', 'lang es')
  expect(await run($, 'pfprofile', 'save review')).toContain('saved (1 values; locale settings are not part')
  await run($, 'pfreset')
  expect(await eff($)).toEqual({})
  expect(await run($, 'pfprofile', 'use review')).toContain('1 value changed')
  expect(await eff($)).toEqual({ 'toast.ms': 2000 })
  expect(await run($, 'pfprofile', 'save work')).toContain('built-in')
  expect(await run($, 'pfprofile', 'save Bad Name')).toContain('lowercase')
  expect(await run($, 'pfprofile', 'del work')).toContain('built in')
  expect(await run($, 'pfprofile', 'del nope')).toContain('No profile of yours')
  expect(await run($, 'pfprofile', 'del review')).toContain('deleted')
  expect(await run($, 'pfprofile', 'list')).not.toContain('review')
  expect(await run($, 'pfprofile', 'wat')).toContain('Usage')
})

// ------------------------------------------------------------ project and branch layers

test('layers are stored but only in force in per-project scope', async ($, on) => {
  await setup($, on)

  expect(await run($, 'pfproject', 'set toast.ms 2000')).toContain('stored, but not in force')
  expect((await eff($))['toast.ms']).toBeUndefined()
  expect(await run($, 'pfget', 'toast.ms')).toContain('decided by: default')
  await run($, 'pfset', 'sync.mode per-project')
  expect((await eff($))['toast.ms']).toBe(2000)
  expect(await run($, 'pfget', 'toast.ms')).toContain('decided by: project')
  expect(await run($, 'pfproject')).toContain('toast.ms = 2000 ms')
  expect(await run($, 'pfproject', 'set sync.mode synced')).toContain('only be set globally')
  expect(await run($, 'pfproject', 'set money.symbol usd')).toContain('money.symbol = usd in the project layer')
  await run($, 'pfset', 'money.symbol eur')
  // the project layer's default-valued entry still wins over the global value
  expect((await eff($))['money.symbol']).toBeUndefined()
  expect(await run($, 'pfproject', 'unset money.symbol')).toContain('removed from the project layer')
  expect((await eff($))['money.symbol']).toBe('eur')
  expect(await run($, 'pfproject', 'unset money.symbol')).toContain('is not set in the project layer')
  expect(await run($, 'pfproject', 'clear')).toContain('cleared (1 values)')
  expect((await eff($))['toast.ms']).toBeUndefined()
  await run($, 'pfundo')
  expect((await eff($))['toast.ms']).toBe(2000)
})

test('the project layer is per folder and its switch can turn it off', async ($, on) => {
  const w = world(on)
  await start($, '/work/a')
  await run($, 'pfset', 'sync.mode per-project')
  await run($, 'pfproject', 'set tip.delay 900')
  expect((await eff($))['tip.delay']).toBe(900)
  w.box.features['prefs.project-overrides'] = false
  await run($, 'pfset', 'lang es')
  expect((await eff($))['tip.delay']).toBeUndefined()
  w.box.features['prefs.project-overrides'] = true
  await run($, 'pfset', 'lang de')
  expect((await eff($))['tip.delay']).toBe(900)
  // another folder sees only the global values
  await start($, '/work/b')
  expect((await eff($))['tip.delay']).toBeUndefined()
  expect((await eff($))['lang']).toBe('de')
})

test('the branch layer needs its switch; git is asked only read-only and only then', async ($, on) => {
  const { box } = await setup($, on, { git: 'feature/x' })

  await run($, 'pfset', 'sync.mode per-project')
  expect(box.procs).toEqual([])
  expect(await run($, 'pfproject', 'branch set toast.ms 9000')).toContain('No git branch is known')
  expect(await run($, 'pfproject', 'refresh')).toContain('branch not read')
  expect(box.procs).toEqual([])
  box.features['prefs.branch-overrides'] = true
  expect(await run($, 'pfproject', 'refresh')).toContain('branch feature/x')
  expect(box.procs).toEqual([{ argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd: '/work/app' }])
  expect(await run($, 'pfproject', 'branch set toast.ms 9000')).toContain('in the branch layer')
  expect((await eff($))['toast.ms']).toBe(9000)
  expect(await run($, 'pfget', 'toast.ms')).toContain('decided by: branch')
  expect(await run($, 'pfproject', 'branch unset toast.ms')).toContain('removed from the branch layer')
  expect((await eff($))['toast.ms']).toBeUndefined()
})

test('a git failure or an odd branch name never breaks anything', async ($, on) => {
  const { box } = await setup($, on, { git: new Error('x'), features: { 'prefs.branch-overrides': true } })

  expect(await run($, 'pfproject', 'refresh')).toContain('branch not read')
  expect(box.procs.length).toBe(1)
  box.git = 'HEAD'
  expect(await run($, 'pfproject', 'refresh')).toContain('branch not read')
  box.git = 'bad name;rm'
  expect(await run($, 'pfproject', 'refresh')).toContain('branch not read')
  expect(box.procs.length).toBe(3)
  expect(box.procs.every(p => p.argv.join(' ') === 'git rev-parse --abbrev-ref HEAD')).toBe(true)
})

test('at start the branch is read only for per-project scope with the switch on', async ($, on) => {
  const { box } = await setup($, on, { stored: { 'pf.base': { 'sync.mode': 'per-project' }, 'pf.layers': { projects: {}, branches: { '/work/app#main': { 'tip.delay': 700 } } } }, git: 'main', features: { 'prefs.branch-overrides': true } })

  expect(box.procs.length).toBe(1)
  expect((await eff($))['tip.delay']).toBe(700)
  // a restart with the switch off, or with the global scope, never asks git
  box.features['prefs.branch-overrides'] = false
  await start($)
  expect(box.procs.length).toBe(1)
  expect((await eff($))['tip.delay']).toBeUndefined()
  box.features['prefs.branch-overrides'] = true
  box.saved['pf.base'] = {}
  await start($)
  expect(box.procs.length).toBe(1)
})

const SCHEDULE = { 'pf.auto': { on: true, schedule: [{ at: '09:00', profile: 'work' }, { at: '18:30', profile: 'home' }], last: '' }, 'pf.base': FIXED_ZONE }

test('auto profile does nothing unless /pfauto on AND the switch are both on', async ($, on) => {
  const { box, clock } = await setup($, on, { stored: SCHEDULE })

  expect((await eff($))['toast.ms']).toBeUndefined()
  await clock.advance(60 * MIN)
  expect((await eff($))['toast.ms']).toBeUndefined()
  expect(await run($, 'pfauto', 'status')).toContain('switch prefs.auto-profile: off')
  // the switch on but the command off: still nothing
  box.saved['pf.auto'] = { ...SCHEDULE['pf.auto'], on: false }
  box.features['prefs.auto-profile'] = true
  await start($)
  await clock.advance(60 * MIN)
  expect((await eff($))['toast.ms']).toBeUndefined()
  expect(box.toasts).toEqual([])
})

test('auto profile applies the slot at start, again when the time comes, and leaves your edits alone in between', async ($, on) => {
  const { box, clock } = await setup($, on, { stored: SCHEDULE, features: { 'prefs.auto-profile': true } })

  expect((await eff($))['toast.ms']).toBe(3000)
  expect((await eff($))['volume.ambient']).toBe(0)
  expect(box.saved['pf.auto']).toMatchObject({ last: '09:00|work' })
  expect(box.toasts).toEqual([])
  await run($, 'pfset', 'toast.ms 5000')
  await clock.advance(60 * MIN)
  expect((await eff($))['toast.ms']).toBe(5000)
  await clock.advance(8 * 60 * MIN)
  expect((await eff($))['toast.ms']).toBe(6000)
  expect((await eff($))['notify.tips']).toBe(true)
  expect(box.saved['pf.auto']).toMatchObject({ last: '18:30|home' })
  expect(await run($, 'pfprofile', 'list')).toContain('home (built in, 7 values) <- in use')
})

test('/pfauto off stops the checks; the toast is its own switch and is throttled', async ($, on) => {
  const { box, clock } = await setup($, on, { stored: SCHEDULE, features: { 'prefs.auto-profile': true, 'prefs.auto-toast': true } })

  expect(box.toasts).toEqual([{ text: 'Profile work applied (09:00 schedule).', timeoutMs: 3000 }])
  await clock.advance(9 * 60 * MIN)
  expect(box.toasts.length).toBe(2)
  expect(box.toasts[1]).toEqual({ text: 'Profile home applied (18:30 schedule).', timeoutMs: 6000 })
  expect(await run($, 'pfauto', 'off')).toContain('nothing is checked any more')
  await run($, 'pfprofile', 'use demo')
  await clock.advance(24 * 60 * MIN)
  expect((await eff($))['level']).toBe('simple')
  expect(box.toasts.length).toBe(2)
})

test('/pfauto on, add, rm, clear and the usage messages', async ($, on) => {
  const { box, clock } = await setup($, on, { stored: { 'pf.base': FIXED_ZONE } })

  expect(await run($, 'pfauto', 'add 09:00 work')).toContain('from 09:00 use work')
  expect(await run($, 'pfauto', 'add 18:30 nope')).toContain('No profile named')
  expect(await run($, 'pfauto', 'add 25:00 work')).toContain('Usage')
  expect(await run($, 'pfauto', 'rm x')).toContain('Usage')
  expect(await run($, 'pfauto', 'on')).toContain('nothing will run until the switch is on too')
  expect((await eff($))['toast.ms']).toBeUndefined()
  box.features['prefs.auto-profile'] = true
  expect(await run($, 'pfauto', 'on')).toContain('checked now (applied work)')
  expect((await eff($))['toast.ms']).toBe(3000)
  expect(await run($, 'pfauto', 'status')).toContain('In force now: work (since 09:00)')
  expect(await run($, 'pfauto', 'rm 9:00')).toContain('removed')
  expect(await run($, 'pfauto', 'status')).toContain('Schedule: empty')
  await run($, 'pfauto', 'add 10:00 demo')
  expect(await run($, 'pfauto', 'clear')).toContain('cleared')
  expect(await run($, 'pfauto', 'wat')).toContain('Usage')
  await clock.advance(60 * MIN)
  for (let i = 0; i < 7; i++) {
    await run($, 'pfauto', `add 0${i}:00 work`)
  }
  expect(await run($, 'pfauto', 'add 15:00 work')).toContain('At most 6')
})

test('auto profile follows the fixed time zone preference', async ($, on) => {
  const { clock } = await setup($, on, { stored: { ...SCHEDULE, 'pf.base': { 'tz.mode': 'fixed', 'tz.offset': 600 } }, features: { 'prefs.auto-profile': true } })

  // 10:00 UTC is 20:00 at UTC+10: the evening slot
  expect((await eff($))['toast.ms']).toBe(6000)
  await clock.advance(MIN)
  expect((await eff($))['toast.ms']).toBe(6000)
})

// ------------------------------------------------------------ auto-open

test('auto-open needs both the preference and its switch, and opens only the prefs pane', async ($, on) => {
  const { box } = await setup($, on, { stored: { 'pf.base': { 'autoopen.prefs': true, 'autoopen.alerts': true } } })

  expect(box.opened).toEqual([])
  box.saved['pf.base'] = { 'autoopen.alerts': true }
  box.features['prefs.auto-open'] = true
  await start($)
  expect(box.opened).toEqual([])
  box.saved['pf.base'] = { 'autoopen.prefs': true, 'autoopen.alerts': true }
  await start($)
  expect(box.opened.map((o: any) => o.id)).toEqual(['prefs-main'])
})

test('/pfmods filters the build-time list, opens the Mods tab and names the /cfg line', async ($, on) => {
  const { box } = await setup($, on, { features: { 'alerts.band': false } })
  const all = await run($, 'pfmods')

  expect(all).toContain('mods')
  expect(all).toContain('snapshot')
  const some = await run($, 'pfmods', 'alerts')

  expect(some).toContain('alerts:')
  expect(some).toContain('[off: band]')
  expect(some).toContain('/cfg feature <mod>.<id> on|off')
  expect(await run($, 'pfmods', 'zzzzqqq')).toContain('0 of')
  expect(box.opened.length).toBe(3)
})

// ------------------------------------------------------------ the pane

test('the pane draws every tab, on the desktop with vectors and on the terminal without', async ($, on) => {
  await setup($, on)

  for (const surface of ['desktop', 'terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await texts(ui)).toContain('Preferences')
    expect(await texts(ui)).toContain('READS it')
    await ui.unmount()
  }
  const ui = await $.ui.mount(PANE)

  for (const tab of ['general', 'formats', 'interface', 'notices', 'charts', 'data', 'mods', 'profiles', 'projects', 'history']) {
    await ui.press({ key: `tab-${tab}` })
    expect((await texts(ui)).length).toBeGreaterThan(50)
  }
  await ui.press({ key: 'tab-charts' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await term.press({ key: 'tab-charts' })
  expect(await texts(term)).toContain('text sketch of the sample')
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()
})

test('pane buttons change values: enum, toggle, +/- and reset; the preview follows', async ($, on) => {
  await setup($, on, { stored: { 'pf.base': FIXED_ZONE } })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-formats' })
  expect(await texts(ui)).toContain('-> $1,234.50')
  await ui.press({ key: 'set-money.symbol-eur' })
  expect((await eff($))['money.symbol']).toBe('eur')
  expect(await texts(ui)).toContain('€1,234.50')
  await ui.press({ key: 'tog-money.cents' })
  expect((await eff($))['money.cents']).toBe(false)
  expect(await texts(ui)).toContain('€1,235')
  await ui.press({ key: 'tog-money.cents' })
  expect((await eff($))['money.cents']).toBeUndefined()
  await ui.press({ key: 'inc-money.rate' })
  await ui.press({ key: 'incb-money.rate' })
  expect((await eff($))['money.rate']).toBe(1.55)
  await ui.press({ key: 'decb-money.rate' })
  expect((await eff($))['money.rate']).toBe(1.05)
  await ui.press({ key: 'rst-money.rate' })
  expect((await eff($))['money.rate']).toBeUndefined()
  // the fixed zone stored at the start counts as one change, the euro as the other
  expect(await texts(ui)).toContain('2 changed from default')
  await ui.press({ key: 'set-time.hours-12h' })
  expect(await texts(ui)).toContain('Time: 10:00 AM')
  await ui.unmount()
})

test('the pane refuses a bad cross setting through the same rules as the commands', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-formats' })
  await ui.press({ key: 'set-num.group-dot' })
  expect(await texts(ui)).toContain('cannot both be')
  expect(await eff($)).toEqual({})
  await ui.press({ key: 'set-num.decimal-comma' })
  expect(await eff($)).toEqual({ 'num.decimal': 'comma', 'num.group': 'dot' })
  await ui.unmount()
})

test('the pane search finds preferences across tabs and the count says how many changed', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount(PANE)

  expect(await texts(ui)).toContain('0 changed from default')
  await ui.input({ key: 'psearch', text: 'cents' })
  expect(await texts(ui)).toContain('Show cents')
  expect(await texts(ui)).not.toContain('Toast duration')
  await ui.input({ key: 'psearch', text: 'zzzzqq' })
  expect(await texts(ui)).toContain('Nothing matches.')
  await ui.press({ key: 'clear-search' })
  expect(await texts(ui)).toContain('Detail level')
  await run($, 'pfset', 'lang es')
  expect(await texts(ui)).toContain('1 distintas del valor por defecto')
  expect(await texts(ui)).toContain('Preferencias')
  expect(await texts(ui)).toContain('Nota honesta')
  await ui.unmount()
})

test('the pane follows the detail level and says which preferences prefs itself uses', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount(PANE)

  expect(await texts(ui)).toContain('[used by prefs]')
  expect(await texts(ui)).not.toContain('default standard')
  await ui.press({ key: 'set-level-everything' })
  expect(await texts(ui)).toContain('level  default standard')
  await ui.press({ key: 'set-level-simple' })
  expect(await texts(ui)).not.toContain('[used by prefs]')
  await run($, 'pfset', 'level standard')
  await ui.press({ key: 'tab-interface' })
  expect(await texts(ui)).toContain('[stored for other mods]')
  await ui.unmount()
})

test('the Mods tab filters, shows switches and only fills the prompt', async ($, on) => {
  const { box } = await setup($, on, { features: { 'alerts.toasts': false } })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-mods' })
  await ui.input({ key: 'psearch', text: 'alerts' })
  await ui.press({ key: 'msel-alerts' })
  expect(await texts(ui)).toContain('alerts.toasts')
  await ui.press({ key: 'msw-alerts.toasts' })
  await ui.press({ key: 'msw-alerts.band' })
  expect(box.fills).toEqual(['/cfg feature alerts.toasts on', '/cfg feature alerts.band off'])
  await ui.input({ key: 'psearch', text: 'tool-guard' })
  await ui.press({ key: 'msel-tool-guard' })
  expect(await texts(ui)).toContain('Always on')
  expect(box.fills.length).toBe(2)
  await ui.unmount()
})

test('the Profiles tab uses, saves and deletes profiles and shows the schedule', async ($, on) => {
  await setup($, on, { stored: { 'pf.auto': { on: false, schedule: [{ at: '09:00', profile: 'work' }], last: '' } } })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-profiles' })
  expect(await texts(ui)).toContain('09:00  work')
  await ui.press({ key: 'puse-demo' })
  expect((await eff($))['level']).toBe('simple')
  expect(await texts(ui)).toContain('demo (in use)')
  await ui.input({ key: 'pname', text: 'mine' })
  expect(await run($, 'pfprofile', 'list')).toContain('mine (yours')
  await ui.press({ key: 'pdel-mine' })
  expect(await run($, 'pfprofile', 'list')).not.toContain('mine')
  await ui.press({ key: 'srm-09:00' })
  expect(await texts(ui)).toContain('No schedule')
  await ui.input({ key: 'pslot', text: '07:30 home' })
  expect(await texts(ui)).toContain('07:30  home')
  await ui.press({ key: 'auto-toggle' })
  expect(await run($, 'pfauto', 'status')).toContain('Auto profile: on')
  await ui.press({ key: 'auto-switch' })
  await ui.unmount()
})

test('the Projects tab edits a layer when the target is the project, and the History tab undoes', async ($, on) => {
  const { box } = await setup($, on, { stored: { 'pf.base': { 'sync.mode': 'per-project' } } })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-projects' })
  expect(await texts(ui)).toContain('project: /work/app')
  await ui.press({ key: 'target-project' })
  expect(await texts(ui)).toContain('Editing: this project')
  await ui.press({ key: 'tab-notices' })
  await ui.press({ key: 'inc-toast.ms' })
  expect((await eff($))['toast.ms']).toBe(4500)
  expect(box.saved['pf.layers']).toEqual({ projects: { '/work/app': { 'toast.ms': 4500 } }, branches: {} })
  expect(box.saved['pf.base']).toEqual({ 'sync.mode': 'per-project' })
  await ui.press({ key: 'tab-projects' })
  expect(await texts(ui)).toContain('toast.ms = 4500 ms')
  await ui.press({ key: 'unset-project-toast.ms' })
  expect((await eff($))['toast.ms']).toBeUndefined()
  await ui.press({ key: 'target-branch' })
  await ui.press({ key: 'tab-notices' })
  await ui.press({ key: 'inc-toast.ms' })
  expect(await texts(ui)).toContain('No git branch is known')
  await ui.press({ key: 'tab-history' })
  expect(await texts(ui)).toContain('reset toast.ms')
  await ui.press({ key: 'undo-last' })
  expect((await eff($))['toast.ms']).toBe(4500)
  await ui.press({ key: 'tab-projects' })
  await ui.press({ key: 'clear-project' })
  expect((await eff($))['toast.ms']).toBeUndefined()
  await ui.press({ key: 'scope-synced' })
  expect((await eff($))['sync.mode']).toBeUndefined()
  await ui.unmount()
})

test('the pane remembers the last tab only when the preference and its switch are on', async ($, on) => {
  const { box } = await setup($, on)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'tab-charts' })
  expect(box.saved['pf.meta']).toBeUndefined()
  await run($, 'pfset', 'pane.remember on')
  await ui.press({ key: 'tab-data' })
  expect(box.saved['pf.meta']).toEqual({ applied: '', lastTab: 'data' })
  await run($, 'pfset', 'pane.tab.prefs notices')
  await ui.press({ key: 'tab-charts' })
  expect(box.saved['pf.meta']).toEqual({ applied: '', lastTab: 'charts' })
  // opening again goes back to the remembered tab, not the default one
  await run($, 'pf')
  expect(await texts(ui)).toContain('Default time range')
  // with the switch off the pane opens on the default tab and records nothing new
  box.features['prefs.remember-tab'] = false
  await ui.press({ key: 'tab-data' })
  expect(box.saved['pf.meta']).toEqual({ applied: '', lastTab: 'charts' })
  await run($, 'pf')
  expect(await texts(ui)).toContain('Toast duration')
  await ui.unmount()
})

test('nothing outward-facing happens in any command: no process, no toast, no status, no prompt fill', async ($, on) => {
  const { box } = await setup($, on)
  const typed: [string, string][] = [
    ['pf', ''], ['pfset', 'lang es'], ['pfset', 'bad'], ['pfget', ''], ['pfget', 'lang'], ['pfreset', ''], ['pfexport', ''], ['pfimport', '{}'], ['pfimport', 'confirm'], ['pfundo', ''], ['pfundo', 'list'],
    ['pfproject', ''], ['pfproject', 'set lang de'], ['pfproject', 'branch set lang de'], ['pfprofile', 'list'], ['pfprofile', 'use work'], ['pfauto', 'status'], ['pfauto', 'add 09:00 work'], ['pfmods', 'a'],
  ]

  for (const [c, a] of typed) {
    await run($, c, a)
  }
  expect(box.procs).toEqual([])
  expect(box.toasts).toEqual([])
  expect(box.fills).toEqual([])
  expect(box.statuses).toBe(0)
})

test('a failing store never breaks a command', async ($, on) => {
  const { box } = await setup($, on, { failStore: true })
  const text = await run($, 'pfset', 'lang es')

  expect(text).toContain('lang = es')
  expect((await eff($))['lang']).toBe('es')
  expect(box.saved).toEqual({})
  expect(box.toasts).toEqual([])
})
