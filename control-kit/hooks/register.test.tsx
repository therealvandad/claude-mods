import { expect, mock, test } from 'claude-code/testing'

import { COMMANDS } from './pure'
import { TABLE } from './table'

// Everything outside the mod is a stand-in here. The settings mod's /cfg feature and band-tidy's /tidy are re-written below from
// their documented behaviour, so the tests can check what a restore really leaves behind.

declare const setTimeout: (fn: () => void, ms: number) => unknown

type Ov = Record<string, boolean>
type Tidy = { isOn: boolean; keep: string[] }
type Run = { cmd: string; args: string; origin: unknown }

const GUARD_SET = new Set(['tool-guard', 'safety-pro', 'controls', 'settings'])
const KINDS = ['toasts', 'sounds', 'status', 'band']
const DEFAULTS = new Map<string, boolean>()

for (const m of TABLE) {
  for (const k of KINDS) {
    DEFAULTS.set(`${m.name}.${k}`, true)
  }

  for (const f of m.own) {
    DEFAULTS.set(`${m.name}.${f.id}`, f.default)
  }
}

const DEFAULT_KEEP = ['cockpit', 'alerts', 'safety-pro', 'controls']

type Opts = {
  ov?: Ov
  tidy?: Tidy
  stored?: Record<string, unknown>
  now?: number
  /** 'reject': /cfg is refused by the host. 'never': it never answers. */
  cfg?: 'ok' | 'reject' | 'never'
  tidyMod?: 'ok' | 'reject'
  refuse?: string[]
}

const world = (on: any, opts: Opts = {}) => {
  const box = {
    ov: { ...(opts.ov ?? {}) } as Ov,
    tidy: { isOn: opts.tidy?.isOn ?? true, keep: [...(opts.tidy?.keep ?? DEFAULT_KEEP)] } as Tidy,
    runs: [] as Run[],
    fills: [] as string[],
    toasts: [] as string[],
    opened: [] as string[],
    registered: [] as string[],
    statuses: 0,
    saved: { ...(opts.stored ?? {}) } as Record<string, unknown>,
    cfgMode: opts.cfg ?? 'ok',
    tidyMode: opts.tidyMod ?? 'ok',
    tools: 0,
  }
  const clock = mock.clock(on, { now: opts.now ?? 1_700_000_000_000 })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: box.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    box.saved[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
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
  on('tool.call', () => {
    box.tools++

    return { result: {} }
  })
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    box.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })

  // The settings mod's /cfg feature, as documented: presets REPLACE the override map; a value equal to the default is not kept.
  on('command.run', { command: 'cfg' }, (_: unknown, e: { args: string; origin: unknown }) => {
    box.runs.push({ cmd: 'cfg', args: e.args, origin: e.origin })

    if (box.cfgMode === 'reject') {
      throw new Error('refused by the host')
    }

    if (box.cfgMode === 'never') {
      return new Promise(() => undefined)
    }
    const [, what = '', val = ''] = e.args.trim().split(/\s+/)

    if (what === 'reset' || what === 'full') {
      box.ov = {}

      return { text: 'done' }
    }

    if (what === 'quiet' || what === 'calm') {
      const next: Ov = {}

      for (const m of TABLE) {
        if (GUARD_SET.has(m.name) || m.name === 'alerts') {
          continue
        }

        for (const k of KINDS) {
          if (what === 'quiet' || k !== 'band' || !['cockpit', 'alerts'].includes(m.name)) {
            next[`${m.name}.${k}`] = false
          }
        }
      }
      box.ov = next

      return { text: `Feature switches ${what}` }
    }

    if (!DEFAULTS.has(what)) {
      return { text: `No switch named "${what}".` }
    }
    const [mod = '', key = ''] = what.split('.')

    if (GUARD_SET.has(mod) && KINDS.includes(key)) {
      return { text: `${what} cannot be changed: ${mod} is a safety mod` }
    }
    delete box.ov[what]

    if (val !== 'default' && (val === 'on') !== DEFAULTS.get(what)) {
      box.ov[what] = val === 'on'
    }

    return { text: 'Done.' }
  })

  // band-tidy's /tidy, as it answers.
  on('command.run', { command: 'tidy' }, (_: unknown, e: { args: string; origin: unknown }) => {
    box.runs.push({ cmd: 'tidy', args: e.args, origin: e.origin })

    if (box.tidyMode === 'reject') {
      throw new Error('unknown command')
    }
    const [verb = '', name = ''] = e.args.trim().toLowerCase().split(/\s+/)

    if (verb === 'on' || verb === 'off') {
      box.tidy.isOn = verb === 'on'

      return { text: `Tidy ${verb}` }
    }

    if (verb === 'keep') {
      box.tidy.keep = [...new Set([...box.tidy.keep, name])]

      return { text: `${name} may draw above the prompt.` }
    }

    if (verb === 'hide') {
      box.tidy.keep = box.tidy.keep.filter(n => n !== name)

      return { text: `${name} is hidden above the prompt.` }
    }

    if (verb === 'reset') {
      box.tidy = { isOn: true, keep: [...DEFAULT_KEEP] }

      return { text: 'Tidy reset' }
    }

    return { text: `Tidy is ${box.tidy.isOn ? 'on' : 'off'}. Showing rows from: ${box.tidy.keep.join(', ') || '(none)'}.\nRows drawn right now: (none yet).\nUsage: /tidy on|off` }
  })

  // The overrides atom of the settings mod, kept with its shape tag.
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: any) =>
    e.plugin === 'settings' && e.key === 'features' ? { value: { value: { shape: 'features-1', value: { ...box.ov } }, version: 1 } } : next(e),
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
const yieldAll = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    for (let j = 0; j < 30; j++) {
      await Promise.resolve()
    }
  }
}
const flush = async (clock: any, ms = 0) => {
  await clock.advance(ms)
  await yieldAll()
}
/** A typed command only previews and queues its job; the job runs a moment later from a timer. This moves the clock past that and lets it finish. */
const settle = async (clock: any) => {
  for (let i = 0; i < 3; i++) {
    await flush(clock, 60)
  }
}
const go = async ($: any, clock: any, command: string, args = '', kind = 'composer'): Promise<string> => {
  const text = await run($, command, args, kind)
  await settle(clock)

  return text
}
/** What changed anything: a /cfg call, or a /tidy call with arguments (a bare /tidy only reads). */
const mutations = (runs: Run[]) => runs.filter(r => r.cmd === 'cfg' || (r.cmd === 'tidy' && r.args.trim() !== ''))
const sortKeep = (t: Tidy) => ({ isOn: t.isOn, keep: [...t.keep].sort() })

const PANE = {
  plugin: 'control-kit',
  component: 'Pane',
  requestId: 'control-kit-main',
  surface: 'desktop',
  props: { title: 'Control kit', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join('\n')
const buttons = async (ui: any) => (await ui.findAll({ type: 'Button' })) as { key: string; text: string; props: { hotkey?: string } }[]

const row = (plugin: string, word: string) => ({ plugin, tree: { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: [word] }] } })
const LIST = (rows: unknown[], hasSurvey = false) =>
  ({ plugin: 'control-kit', component: 'AbovePromptList', surface: 'desktop', props: { rows, hasSurvey, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80 } }) as any

// ------------------------------------------------------------ startup

test('startup registers every kc command, survives a refused name, and is quiet', async ($, on) => {
  const { box, clock } = await setup($, on, { refuse: ['kcnet'] })

  expect(box.registered.sort()).toEqual(COMMANDS.map(c => c[0]).filter(n => n !== 'kcnet').sort())
  expect(box.runs).toEqual([])
  expect(box.toasts).toEqual([])
  expect(box.fills).toEqual([])
  expect(box.statuses).toBe(0)
  expect(box.opened).toEqual([])
})

test('/kc opens the one pane and lists every command in one line each', async ($, on) => {
  const { box, clock } = await setup($, on)
  const text = await run($, 'kc')

  expect(box.opened).toEqual(['control-kit-main'])

  for (const [name] of COMMANDS) {
    expect(text).toContain(`/${name} `)
  }
  expect(box.runs.filter(r => r.cmd === 'cfg')).toEqual([])
})

// ------------------------------------------------------------ every bulk change is previewed first

test('bulk commands only preview: nothing mutates until /kcdo confirm', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcoff')
  await go($, clock, 'kcdo', 'confirm')
  const baseline = mutations(box.runs).length

  expect(baseline).toBeGreaterThan(0)
  const typed: [string, string][] = [
    ['kcoff', ''], ['kcsafe', ''], ['kcon', ''], ['kcdo', 'off'], ['kcdo', 'on'], ['kcdo', 'safe'], ['kcdo', 'quiet'], ['kcdo', 'calm'], ['kcdo', 'full'],
    ['kcrows', 'only cockpit'], ['kcrows', 'expand'], ['kcreset', ''], ['kcreset', 'all'], ['kcundo', ''], ['kcblock', 'on'],
  ]

  for (const [command, args] of typed) {
    const text = await run($, command, args)

    expect(mutations(box.runs).length).toBe(baseline)
    expect(text).toMatch(/Nothing has run|Nothing to|no restore|already|No change|would flip|Things changed/i)
  }
  // And the previews really list switches.
  const preview = await run($, 'kcdo', 'full')

  expect(preview).toMatch(/Switches that would flip \(\d+/)
  expect(preview).toContain('Nothing has run')
  expect(preview).toContain('/kcdo confirm')
  expect(mutations(box.runs).length).toBe(baseline)
})

test('/kcpreview is a dry run: it lists switches and stages nothing', async ($, on) => {
  const { box, clock } = await setup($, on)
  const text = await run($, 'kcpreview', 'quiet')

  expect(text).toMatch(/Switches that would flip \(\d+/)
  expect(text).toContain('notes.toasts: on -> off')
  expect(text).toContain('Dry run')
  expect(mutations(box.runs)).toEqual([])
  expect(await go($, clock, 'kcdo', 'confirm')).toMatch(/Nothing is pending/)
  expect(mutations(box.runs)).toEqual([])
  expect(await run($, 'kcpreview', 'bogus')).toMatch(/Usage/)
})

test('the preview matches what then happens: the same switches flip', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'notes.sounds': false } })
  const preview = await run($, 'kcdo', 'quiet')
  const full = await run($, 'kcpreview', 'quiet')
  const flips = [...full.matchAll(/^ {2}([a-z0-9-]+\.[a-z0-9-]+): (on|off) -> (on|off)/gm)].map(m => m[1])
  const counted = Number(/flip \((\d+),/.exec(preview)?.[1])
  const before = { ...box.ov }
  await go($, clock, 'kcdo', 'confirm')
  const changed = Object.keys({ ...before, ...box.ov }).filter(id => (before[id] ?? DEFAULTS.get(id)) !== (box.ov[id] ?? DEFAULTS.get(id)))

  expect(flips.length).toBeGreaterThan(5)
  expect(counted).toBe(changed.length)
  expect(flips.length).toBeLessThanOrEqual(changed.length)
  expect(flips.every(id => changed.includes(id ?? ''))).toBe(true)
  if (counted <= 200) {
    expect([...flips].sort()).toEqual([...changed].sort())
  }
})

// ------------------------------------------------------------ restore is exact

const INITIALS: [string, Ov, Tidy][] = [
  ['nothing changed', {}, { isOn: true, keep: [...DEFAULT_KEEP] }],
  ['some switches off and a custom row filter', { 'notes.sounds': false, 'workbench.band': false, 'cockpit.status': false }, { isOn: false, keep: ['cockpit', 'notes', 'workbench'] }],
  ['a lone off switch and rows from nobody', { 'alerts.toasts': false }, { isOn: true, keep: [] }],
]

for (const [name, ov, tidy] of INITIALS) {
  test(`/kcoff then /kcon puts everything back exactly (${name})`, async ($, on) => {
    const { box, clock } = await setup($, on, { ov, tidy })
    const initialOv = { ...box.ov }
    const initialTidy = sortKeep(box.tidy)

    expect(await run($, 'kcoff')).toContain('Nothing has run')
    await go($, clock, 'kcdo', 'confirm')
    expect(box.ov['notes.toasts']).toBe(false)
    expect(box.ov['tool-guard.toasts']).toBeUndefined()
    expect(box.tidy.keep.every(n => ['alerts', 'tool-guard', 'safety-pro', 'controls'].includes(n))).toBe(true)

    const text = await run($, 'kcon')

    expect(text).toContain('Nothing has run')
    await go($, clock, 'kcdo', 'confirm')
    expect(box.ov).toEqual(initialOv)
    expect(sortKeep(box.tidy)).toEqual(initialTidy)
    expect(await run($, 'kcon')).toMatch(/no restore point/i)
  })
}

test('with no earlier overrides the restore is one /cfg feature reset', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcoff')
  await go($, clock, 'kcdo', 'confirm')
  box.runs.length = 0
  await run($, 'kcon')
  await go($, clock, 'kcdo', 'confirm')

  expect(box.runs.filter(r => r.cmd === 'cfg').map(r => r.args)).toEqual(['feature reset'])
  expect(box.ov).toEqual({})
})

test('an own-switch override that /cfg feature quiet drops comes back too', async ($, on) => {
  const own = TABLE.find(m => !GUARD_SET.has(m.name) && m.own.length > 0)
  const ov: Ov = own === undefined ? {} : { [`${own.name}.${own.own[0]?.id}`]: !(own.own[0]?.default ?? true) }
  const { box, clock } = await setup($, on, { ov })
  await run($, 'kcoff')
  await go($, clock, 'kcdo', 'confirm')

  if (own !== undefined) {
    expect(box.ov[`${own.name}.${own.own[0]?.id}`]).toBeUndefined()
  }
  await run($, 'kcon')
  await go($, clock, 'kcdo', 'confirm')
  expect(box.ov).toEqual(ov)
})

test('a second /kcoff keeps the first restore point', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'notes.sounds': false } })
  await run($, 'kcoff')
  await go($, clock, 'kcdo', 'confirm')
  box.ov['cockpit.sounds'] = true
  await run($, 'kcoff')
  expect(await go($, clock, 'kcdo', 'confirm')).toBeTruthy()
  await run($, 'kcon')
  await go($, clock, 'kcdo', 'confirm')
  expect(box.ov).toEqual({ 'notes.sounds': false })
})

test('the restore point survives a restart', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'notes.sounds': false } })
  await run($, 'kcoff')
  await go($, clock, 'kcdo', 'confirm')
  expect((box.saved.snap as { before: Ov }).before).toEqual({ 'notes.sounds': false })
  await start($)
  await run($, 'kcon')
  await go($, clock, 'kcdo', 'confirm')
  expect(box.ov).toEqual({ 'notes.sounds': false })
})

// ------------------------------------------------------------ panic and safe mode

test('/kcpanic is confirm-free, touches only switches and rows, and fills the prompt with the disable lines', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'notes.sounds': false } })
  const text = await go($, clock, 'kcpanic')

  expect(box.ov['notes.toasts']).toBe(false)
  expect(mutations(box.runs).every(r => (r.cmd === 'cfg' && r.args === 'feature quiet') || (r.cmd === 'tidy' && /^(hide [a-z0-9._-]+|on)$/.test(r.args)))).toBe(true)
  const filled = box.fills.at(-1) ?? ''
  const lines = filled.split('\n')

  expect(lines.length).toBeGreaterThan(5)
  expect(lines.every(l => /^claude plugin disable [a-z0-9-]+@local-mods$/.test(l))).toBe(true)
  expect(lines.some(l => /disable (tool-guard|safety-pro|controls|settings|control-kit)@/.test(l))).toBe(false)
  expect(lines).toContain('claude plugin disable notes@local-mods')
  expect(text).toContain('/kcon')
  // Undone by the same restore.
  await run($, 'kcon')
  await go($, clock, 'kcdo', 'confirm')
  expect(box.ov).toEqual({ 'notes.sounds': false })
})

test('/kcsafe previews all non-guard switches off, with the honest note, and runs nothing', async ($, on) => {
  const { box, clock } = await setup($, on)
  const text = await run($, 'kcsafe')

  expect(text).toContain('Nothing has run')
  expect(text).toContain('alerts.toasts: on -> off')
  expect(text).toMatch(/startup flag/)
  expect(mutations(box.runs)).toEqual([])
  await go($, clock, 'kcdo', 'confirm')
  expect(box.ov['alerts.toasts']).toBe(false)
  expect(Object.keys(box.ov).some(id => /^(tool-guard|safety-pro|controls|settings)\./.test(id))).toBe(false)
})

// ------------------------------------------------------------ pause, snooze, dismiss

test('/kcpause turns four switches off now, prints them, and a timer puts them back exactly', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'notes.sounds': false, 'workbench.band': false } })
  const text = await go($, clock, 'kcpause', 'notes 30')

  expect(text).toMatch(/Pause notes for 30 min/)
  expect(text).toContain('notes.toasts: on -> off')
  expect(box.ov['notes.toasts']).toBe(false)
  expect(box.ov['notes.band']).toBe(false)
  expect(box.ov['workbench.band']).toBe(false)
  await flush(clock, 29 * 60_000)
  expect(box.ov['notes.toasts']).toBe(false)
  await flush(clock, 61_000)
  expect(box.ov).toEqual({ 'notes.sounds': false, 'workbench.band': false })
  expect((await go($, clock, 'kcpause', '')).toLowerCase()).toContain('nothing is paused')
})

test('/kcpause: at most 240 minutes, whole numbers, never a guard, never an unknown mod', async ($, on) => {
  const { box, clock } = await setup($, on)

  for (const args of ['notes 241', 'notes 0', 'notes -3', 'notes abc', 'tool-guard 10', 'safety-pro 10', 'controls 5', 'nosuchmod 10', 'settings 10']) {
    await go($, clock, 'kcpause', args)
  }
  expect(mutations(box.runs)).toEqual([])
  expect(await go($, clock, 'kcpause', 'notes 240')).toMatch(/240 min/)
  expect(box.ov['notes.toasts']).toBe(false)
})

test('/kcpause <mod> off ends it now, to the original values', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'notes.toasts': false } })
  await go($, clock, 'kcpause', 'notes 60')
  await go($, clock, 'kcpause', 'notes off')
  expect(box.ov).toEqual({ 'notes.toasts': false })
})

test('pausing twice keeps the first original value', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'notes.sounds': false } })
  await go($, clock, 'kcsnooze', 'notes 10')
  await go($, clock, 'kcpause', 'notes 20')
  await flush(clock, 21 * 60_000)
  expect(box.ov).toEqual({ 'notes.sounds': false })
})

test('/kcsnooze touches only pop-ups and sounds', async ($, on) => {
  const { box, clock } = await setup($, on)
  await go($, clock, 'kcsnooze', 'workbench 15')
  expect(box.ov).toEqual({ 'workbench.toasts': false, 'workbench.sounds': false })
  await flush(clock, 16 * 60_000)
  expect(box.ov).toEqual({})
})

test('timers are re-armed at the next start from the stored expiry', async ($, on) => {
  const now = 1_700_000_000_000
  const held = [
    { id: 'notes.toasts', before: null, until: now + 120_000, src: 'pause' },
    { id: 'notes.sounds', before: false, until: now + 120_000, src: 'pause' },
    { id: 'workbench.toasts', before: null, until: now - 5_000, src: 'snooze' },
  ]
  const { box, clock } = await setup($, on, { now, ov: { 'notes.toasts': false, 'notes.sounds': true, 'workbench.toasts': false }, stored: { holds: held } })

  expect(box.runs).toEqual([])
  await flush(clock, 1_001)
  expect(box.ov['workbench.toasts']).toBeUndefined()
  expect(box.ov['notes.toasts']).toBe(false)
  await flush(clock, 120_000)
  expect(box.ov).toEqual({ 'notes.sounds': false })
  expect((box.saved.holds as unknown[]).length).toBe(0)
})

test('a timed restore that cannot run retries later and never touches the prompt', async ($, on) => {
  const { box, clock } = await setup($, on)
  await go($, clock, 'kcsnooze', 'notes 5')
  box.cfgMode = 'reject'
  await flush(clock, 5 * 60_000 + 1000)
  expect(box.fills).toEqual([])
  expect(box.ov['notes.toasts']).toBe(false)
  box.cfgMode = 'ok'
  await flush(clock, 5 * 60_000)
  expect(box.ov).toEqual({})
})

test('/kcdismiss turns pop-ups off with a note, and undo brings them back', async ($, on) => {
  const { box, clock } = await setup($, on)
  const said = await go($, clock, 'kcdismiss', 'notes far too chatty')

  expect(said).toContain('far too chatty')
  expect(box.ov['notes.toasts']).toBe(false)
  expect(await go($, clock, 'kcdismiss', '')).toContain('far too chatty')
  await go($, clock, 'kcdismiss', 'notes undo')
  expect(box.ov['notes.toasts']).toBeUndefined()
  expect(await go($, clock, 'kcdismiss', 'tool-guard')).toMatch(/never muted/)
})

// ------------------------------------------------------------ undo and the change log

test('/kcundo undoes a small change at once and a big one only after a preview', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'cockpit.sounds': false } })
  await go($, clock, 'kcdismiss', 'notes')
  expect(box.ov['notes.toasts']).toBe(false)
  await go($, clock, 'kcundo')
  expect(box.ov).toEqual({ 'cockpit.sounds': false })
  await run($, 'kcoff')
  await go($, clock, 'kcdo', 'confirm')
  const before = mutations(box.runs).length
  const text = await go($, clock, 'kcundo')

  expect(text).toContain('Nothing has run')
  expect(mutations(box.runs).length).toBe(before)
  await go($, clock, 'kcdo', 'confirm')
  expect(box.ov).toEqual({ 'cockpit.sounds': false })
})

test('the change log keeps the last 30 only', async ($, on) => {
  const { box, clock } = await setup($, on)

  for (let i = 0; i < 18; i++) {
    await go($, clock, 'kcdismiss', `notes n${i}`)
    await go($, clock, 'kcdismiss', 'notes undo')
  }
  const list = await go($, clock, 'kcundo', 'list')

  expect((list.match(/ {2}\d{4}-/g) ?? []).length).toBe(30)
  expect((box.saved.changes as unknown[]).length).toBe(30)
})

// ------------------------------------------------------------ the two step engine

test('a confirm expires after two minutes and runs nothing', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcoff')
  await flush(clock, 119_000)
  expect(await run($, 'kcdo')).toMatch(/Pending now/)
  await flush(clock, 1_001)
  expect(await go($, clock, 'kcdo', 'confirm')).toMatch(/expired/)
  expect(mutations(box.runs)).toEqual([])
  expect(await go($, clock, 'kcdo', 'confirm')).toMatch(/Nothing is pending/)
})

test('only a person can confirm; a plugin or scheduled call cannot', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcoff')

  for (const kind of ['plugin', 'schedule', 'peer', 'sdk']) {
    expect(await run($, 'kcdo', 'confirm', kind)).toMatch(/must be typed by you/)
  }
  expect(mutations(box.runs)).toEqual([])
  await go($, clock, 'kcdo', 'confirm', 'composer')
  expect(mutations(box.runs).length).toBeGreaterThan(0)
})

test('a confirm is single use, and a newer request replaces the older one', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcoff')
  await run($, 'kcdo', 'full')
  await go($, clock, 'kcdo', 'confirm')
  expect(mutations(box.runs).map(r => r.args)).toEqual(['feature full'])
  expect(await go($, clock, 'kcdo', 'confirm')).toMatch(/Nothing is pending/)
  await run($, 'kcdo', 'quiet')
  await run($, 'kcdo', 'cancel')
  expect(await go($, clock, 'kcdo', 'confirm')).toMatch(/Nothing is pending/)
  expect(mutations(box.runs).length).toBe(1)
})

test('if the switches changed since the preview, the confirm shows a new preview instead of running', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcdo', 'quiet')
  box.ov['notes.sounds'] = false
  const text = await go($, clock, 'kcdo', 'confirm')

  expect(text).toMatch(/Things changed since the preview/)
  expect(mutations(box.runs)).toEqual([])
  await go($, clock, 'kcdo', 'confirm')
  expect(mutations(box.runs).length).toBe(1)
})

// ------------------------------------------------------------ read-only lock

test('/kclock on makes every change command refuse, and a plugin cannot unlock', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcoff')
  await run($, 'kclock', 'on')
  const before = mutations(box.runs).length
  const typed: [string, string][] = [
    ['kcdo', 'confirm'], ['kcoff', ''], ['kcon', ''], ['kcsafe', ''], ['kcpanic', ''], ['kcpause', 'notes 5'], ['kcsnooze', 'notes 5'], ['kcdismiss', 'notes'], ['kcundo', ''],
    ['kcblock', 'add git push'], ['kcblock', 'on'], ['kcallow', 'add git status'], ['kcrows', 'hide notes'], ['kcrows', 'only cockpit'], ['kcorder', 'set cockpit notes'], ['kcreset', ''], ['kclimit', '5'], ['kcnext', ''],
  ]

  for (const [command, args] of typed) {
    expect(await run($, command, args)).toMatch(/Read-only mode is on/)
  }
  expect(mutations(box.runs).length).toBe(before)
  expect(box.fills).toEqual([])
  expect(await run($, 'kclock', 'off', 'plugin')).toMatch(/must be typed by you/)
  expect(await run($, 'kclock')).toMatch(/ON/)
  // Reading still works.
  expect(await run($, 'kcfind', 'kcoff')).toContain('/kcoff')
  expect(await run($, 'kcpreview', 'quiet')).toContain('Dry run')
  await run($, 'kclock', 'off')
  await go($, clock, 'kcpause', 'notes 5')
  expect(box.ov['notes.toasts']).toBe(false)
})

test('the lock survives a restart', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kclock', 'on')
  await start($)
  expect(await run($, 'kcoff')).toMatch(/Read-only/)
  expect(mutations(box.runs)).toEqual([])
})

// ------------------------------------------------------------ the host will not run /cfg

test('if /cfg is refused the line goes in the prompt box and the rest wait for /kcnext', async ($, on) => {
  const { box, clock } = await setup($, on, { cfg: 'reject' })
  await run($, 'kcsafe')
  await go($, clock, 'kcdo', 'confirm')

  expect(box.fills.at(-1)).toBe('/cfg feature quiet')
  expect(mutations(box.runs).filter(r => r.cmd === 'cfg').length).toBe(1)
  expect(await run($, 'kclog')).toMatch(/refused to run/)
  const first = await run($, 'kcnext')

  expect(first).toMatch(/^In the prompt box/)
  expect(box.fills.at(-1)).toMatch(/^\/(cfg|tidy) /)
  let guard = 0

  while (!(await run($, 'kcnext')).startsWith('Nothing is queued') && guard++ < 600) {
    expect(box.fills.at(-1)).toMatch(/^\/(cfg|tidy) [a-z0-9. -]+$/)
  }
  expect(guard).toBeLessThan(600)
  expect(guard).toBeGreaterThan(3)
})

test('if /cfg never answers, the run times out and falls back to the prompt box', async ($, on) => {
  const { box, clock } = await setup($, on, { cfg: 'never' })
  const text = await run($, 'kcpanic')

  expect(text).toContain('claude plugin disable')
  await settle(clock)
  await flush(clock, 8_100)
  await settle(clock)
  expect(box.fills.at(-1)).toBe('/cfg feature quiet')
  expect(await run($, 'kclog')).toMatch(/did not answer/)
})

test('if /tidy is silent the switches are still changed and rows are said to be untouched', async ($, on) => {
  const { box, clock } = await setup($, on, { tidyMod: 'reject' })
  expect(await run($, 'kcoff')).toMatch(/row filter \(\/tidy\) has not been read yet or did not answer/)
  await go($, clock, 'kcdo', 'confirm')
  expect(box.ov['notes.toasts']).toBe(false)
  expect(await run($, 'kcrows', 'only cockpit')).toMatch(/has not been read yet or did not answer/)
})

// ------------------------------------------------------------ the Bash block list

const bash = async ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

test('the block list is off by default, empty by default, and only blocks its own pieces when switched on', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcblock', 'add git push --force')

  const passes = async (command: string) => {
    const before = box.tools
    const out = await bash($, command)

    return box.tools > before && !JSON.stringify(out).includes('block list')
  }

  expect(await passes('git push --force origin main')).toBe(true)
  box.ov['control-kit.block'] = true
  expect(await passes('git push --force origin main')).toBe(false)
  expect(await passes('GIT  PUSH   --FORCE x')).toBe(false)
  expect(await passes('git status')).toBe(true)
  await run($, 'kcblock', 'rm git push --force')
  expect(await passes('git push --force origin main')).toBe(true)
  await run($, 'kcblock', 'add rm -rf')
  expect(await passes('ls')).toBe(true)
  expect(await run($, 'kctest', 'rm -rf build')).toMatch(/BLOCKED by "rm -rf"/)
  expect(await run($, 'kctest', 'ls -la')).toMatch(/No block piece matches/)
  expect(box.tools).toBeGreaterThan(0)
})

test('a project allow-list exempts a plain command prefix from this list only', async ($, on) => {
  const { box, clock } = await setup($, on)
  box.ov['control-kit.block'] = true
  await run($, 'kcblock', 'add git push')
  await run($, 'kcallow', 'add git push origin feature')
  expect(await run($, 'kctest', 'git push origin feature/x')).toMatch(/allows the prefix/)
  expect(await run($, 'kctest', 'git push origin main')).toMatch(/BLOCKED/)
  expect(await run($, 'kctest', 'git push origin feature/x && git push --force')).toMatch(/BLOCKED/)
  expect(await run($, 'kcallow', 'list')).toContain('git push origin feature')
  expect((box.saved.block as { allow: Record<string, string[]> }).allow['/work']).toEqual(['git push origin feature'])
  await run($, 'kcallow', 'rm git push origin feature')
  expect(await run($, 'kctest', 'git push origin feature/x')).toMatch(/BLOCKED/)
})

test('/kcblock on is a risky change: it waits for a confirm; list edits are bounded', async ($, on) => {
  const { box, clock } = await setup($, on)
  expect(await run($, 'kcblock', 'on')).toContain('Nothing has run')
  expect(mutations(box.runs)).toEqual([])
  await go($, clock, 'kcdo', 'confirm')
  expect(box.ov['control-kit.block']).toBe(true)

  for (let i = 0; i < 60; i++) {
    await run($, 'kcblock', `add piece number ${i}`)
  }
  expect((box.saved.block as { list: string[] }).list.length).toBe(50)
  expect(await run($, 'kcblock', 'add x')).toMatch(/2 to 80/)
})

// ------------------------------------------------------------ rows

test('pin, hide, collapse all but cockpit, expand: through /tidy, and expand restores what was shown', async ($, on) => {
  const { box, clock } = await setup($, on, { tidy: { isOn: true, keep: ['cockpit', 'alerts', 'notes', 'safety-pro', 'controls'] } })
  await go($, clock, 'kcrows', 'hide notes')
  expect(box.tidy.keep).not.toContain('notes')
  await go($, clock, 'kcrows', 'keep notes')
  expect(box.tidy.keep).toContain('notes')
  const before = mutations(box.runs).length
  const text = await run($, 'kcrows', 'only cockpit')

  expect(text).toContain('Nothing has run')
  expect(mutations(box.runs).length).toBe(before)
  await go($, clock, 'kcdo', 'confirm')
  expect(sortKeep(box.tidy).keep).toEqual(['cockpit', 'controls', 'safety-pro'])
  await go($, clock, 'kcrows', 'expand')
  await go($, clock, 'kcdo', 'confirm')
  expect(sortKeep(box.tidy).keep).toEqual(['alerts', 'cockpit', 'controls', 'notes', 'safety-pro'])
  expect(await run($, 'kcrows', 'show')).toContain('Rows drawn')
})

test('the stored order moves rows only when its switch is on, drops nothing, and leaves a survey alone', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcorder', 'set workbench cockpit')
  const rows = [row('cockpit', 'WORD-COCKPIT'), row('notes', 'WORD-NOTES'), row('workbench', 'WORD-WORKBENCH'), row('alerts', 'WORD-ALERTS')]
  const words = ['WORD-COCKPIT', 'WORD-NOTES', 'WORD-WORKBENCH', 'WORD-ALERTS']
  const order = (s: string) => words.map(w => [w, s.indexOf(w)] as const).sort((a, b) => a[1] - b[1]).map(x => x[0])

  const off = await $.ui.mount(LIST(rows))
  expect(order(JSON.stringify(await off.drawn()))).toEqual(words)
  await off.unmount()
  box.ov['control-kit.reorder'] = true
  const onUi = await $.ui.mount(LIST(rows))
  const drawn = JSON.stringify(await onUi.drawn())

  expect(order(drawn)).toEqual(['WORD-WORKBENCH', 'WORD-COCKPIT', 'WORD-NOTES', 'WORD-ALERTS'])
  expect(words.every(w => drawn.includes(w))).toBe(true)
  await onUi.unmount()
  const survey = await $.ui.mount(LIST(rows, true))

  expect(order(JSON.stringify(await survey.drawn()))).toEqual(words)
  await survey.unmount()
  expect(await run($, 'kcorder', 'up cockpit')).toContain('cockpit')
  expect((box.saved.order as string[])[0]).toBe('cockpit')
  expect(await run($, 'kcorder', 'set bad;name')).toMatch(/Usage|Row order/)
  await run($, 'kcorder', 'clear')
  expect(box.saved.order).toEqual([])
})

// ------------------------------------------------------------ palette, permissions, network

test('/kcfind searches every mod command from the table, with no paths', async ($, on) => {
  await setup($, on)
  const all = await run($, 'kcfind', '')

  expect(all).toMatch(/\d+ commands/)
  expect(await run($, 'kcfind', 'kcpause')).toContain('/kcpause')
  expect(await run($, 'kcfind', 'zzzz-nothing')).toMatch(/No command matches/)
  expect(JSON.stringify(TABLE)).not.toMatch(/\/Users\/|\/home\//)
  expect(TABLE.length).toBeGreaterThan(10)
  expect(TABLE.some(m => m.name === 'control-kit' && m.cmds.length === COMMANDS.length)).toBe(true)
})

test('permissions come from the table; the disable line is shown and put in the prompt, never run', async ($, on) => {
  const { box, clock } = await setup($, on)
  const all = await run($, 'kcperms')

  for (const m of TABLE) {
    expect(all).toContain(`${m.name}`)
  }
  expect(all).toMatch(/shell|files|network|store/)
  expect(await run($, 'kcperms', 'notes')).toContain('claude plugin disable notes@local-mods')
  expect(await run($, 'kcperms', 'nope-mod')).toMatch(/No mod named/)
  const said = await run($, 'kcdisable', 'notes')

  expect(said).toContain('claude plugin disable notes@local-mods')
  expect(box.fills.at(-1)).toBe('claude plugin disable notes@local-mods')
  expect(await run($, 'kcdisable', 'tool-guard')).toMatch(/guard mod/)
  expect(await run($, 'kcdisable', 'notess')).toMatch(/Closest: notes/)
  expect(mutations(box.runs)).toEqual([])
})

test('/kcnet says plainly there is no network switch, and lists who uses the network', async ($, on) => {
  await setup($, on)
  const text = await run($, 'kcnet')

  expect(text).toMatch(/no network on\/off switch/i)

  for (const m of TABLE.filter(x => x.uses.network)) {
    expect(text).toContain(m.name)
  }
})

// ------------------------------------------------------------ notices

test('notice levels: info stays in the log, notice is rate limited, urgent is not', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'kcprio', 'test info')
  expect(box.toasts).toEqual([])
  await run($, 'kcprio', 'test notice')
  expect(box.toasts.length).toBe(1)
  expect(await run($, 'kcprio', 'test notice')).toMatch(/held back by the rate limit/)
  expect(box.toasts.length).toBe(1)
  await run($, 'kcprio', 'test urgent')
  expect(box.toasts.length).toBe(2)
  await flush(clock, 3 * 60_000)
  await run($, 'kcprio', 'test notice')
  expect(box.toasts.length).toBe(3)
  await run($, 'kclimit', '10')
  await flush(clock, 5 * 60_000)
  expect(await run($, 'kcprio', 'test notice')).toMatch(/held back/)
  expect(await run($, 'kclimit', '2')).toMatch(/3 to 120/)
  expect(await run($, 'kclimit', '121')).toMatch(/3 to 120/)
  expect(await run($, 'kcprio')).toContain('urgent')
})

test('the end of a pause only pops up when its switch is on, and at most once per window', async ($, on) => {
  const { box, clock } = await setup($, on)
  await go($, clock, 'kcsnooze', 'notes 5')
  await flush(clock, 5 * 60_000 + 1)
  expect(box.toasts).toEqual([])
  box.ov['control-kit.notify-restore'] = true
  await go($, clock, 'kcsnooze', 'notes 5')
  await flush(clock, 5 * 60_000 + 1)
  expect(box.toasts.length).toBe(1)
  await go($, clock, 'kcsnooze', 'notes 1')
  await flush(clock, 61_000)
  expect(box.toasts.length).toBe(1)
})

// ------------------------------------------------------------ audit log and reset

test('every action is in the audit log with time and result, bounded', async ($, on) => {
  const { clock } = await setup($, on)
  await go($, clock, 'kcpause', 'notes 5')
  await run($, 'kcoff')
  await go($, clock, 'kcdo', 'confirm')
  const log = await run($, 'kclog')

  expect(log).toContain('Pause notes for 5 min')
  expect(log).toContain('Quiet everything')
  expect(log).toMatch(/\d{4}-\d\d-\d\d \d\d:\d\d/)
  expect(await run($, 'kclog', '9')).toMatch(/page 1 of 1/)
})

test('/kcreset is two step, keeps the restore point unless told "all", and clears the rest', async ($, on) => {
  const { box, clock } = await setup($, on, { ov: { 'cockpit.sounds': false } })
  await run($, 'kcblock', 'add git push')
  await run($, 'kcorder', 'set cockpit')
  await run($, 'kcoff')
  await go($, clock, 'kcdo', 'confirm')
  await go($, clock, 'kcpause', 'notes 30')
  const text = await run($, 'kcreset')

  expect(text).toContain('Nothing has run')
  expect((box.saved.block as { list: string[] }).list).toEqual(['git push'])
  await go($, clock, 'kcdo', 'confirm')
  expect((box.saved.block as { list: string[] }).list).toEqual([])
  expect(box.saved.order).toEqual([])
  expect(box.saved.changes).toEqual([])
  expect(box.saved.snap).toBeTruthy()
  expect((box.saved.holds as unknown[]).length).toBe(4)
  await run($, 'kcreset', 'all')
  await go($, clock, 'kcdo', 'confirm')
  expect(box.saved.snap).toBeNull()
  expect(box.saved.holds).toEqual([])
  expect(await run($, 'kcon')).toMatch(/no restore point/i)
})

// ------------------------------------------------------------ the pane

const tabsOf = ['home', 'presets', 'timers', 'palette', 'perms', 'network', 'changes', 'log', 'block', 'rows']

test('the pane has at most 12 tab buttons, each tab draws, and no hotkey or key repeats on a tab', async ($, on) => {
  const { clock } = await setup($, on)
  await go($, clock, 'kcpause', 'notes 30')
  await run($, 'kcoff')
  const ui = await $.ui.mount(PANE)

  expect((await buttons(ui)).filter(b => b.key.startsWith('tab-')).length).toBeLessThanOrEqual(12)

  for (const tab of tabsOf) {
    await ui.press({ key: `tab-${tab}` })
    const list = await buttons(ui)
    const keys = list.map(b => b.key)
    const hot = list.map(b => b.props.hotkey).filter(h => h !== undefined)

    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(hot).size).toBe(hot.length)
    expect(list.filter(b => b.props.hotkey === undefined).map(b => `${tab}:${b.key}`)).toEqual([])
    expect(hot.every(h => /^[a-z0-9]$/.test(String(h)))).toBe(true)
    expect(list.filter(b => b.key.startsWith('tab-')).map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    expect((await texts(ui)).length).toBeGreaterThan(20)
  }
  await ui.unmount()
})

test('pane buttons only change what is shown or fill the prompt; nothing mutates but panic and a confirm of a previewed plan', async ($, on) => {
  const { box, clock } = await setup($, on)
  await go($, clock, 'kcpause', 'notes 30')
  const ui = await $.ui.mount(PANE)
  const base = mutations(box.runs).length

  for (const tab of tabsOf) {
    await ui.press({ key: `tab-${tab}` })

    for (const b of await buttons(ui)) {
      if (['panic', 'confirm', 'cancel', 'prev'].includes(b.key) || b.key.startsWith('tab-')) {
        continue
      }
      if ((await ui.find({ type: 'Button', key: b.key })) !== undefined) {
        await ui.press({ key: b.key })
      }
    }
  }
  expect(mutations(box.runs).length).toBe(base)
  expect(box.fills.length).toBeGreaterThan(5)
  expect(box.fills.every(f => f.startsWith('/') || f.startsWith('claude plugin disable'))).toBe(true)
  await ui.unmount()
})

test('the Presets tab previews the same list the command would, and its Confirm button applies only a previewed plan', async ($, on) => {
  const { box, clock } = await setup($, on)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-presets' })
  await ui.press({ key: 'pre-quiet' })
  expect(await texts(ui)).toMatch(/\d+ switches? would flip/)
  expect(await ui.find({ type: 'Button', key: 'confirm' })).toBeUndefined()
  await run($, 'kcdo', 'quiet')
  expect(mutations(box.runs)).toEqual([])
  await ui.press({ key: 'tab-home' })
  await ui.press({ key: 'confirm' })
  await settle(clock)
  expect(box.ov['notes.toasts']).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'confirm' })).toBeUndefined()
  await ui.unmount()
})

test('the panic button runs at once and says so', async ($, on) => {
  const { box, clock } = await setup($, on)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'panic' })
  await settle(clock)
  expect(box.ov['notes.toasts']).toBe(false)
  expect(box.fills.at(-1)?.startsWith('claude plugin disable')).toBe(true)
  await ui.unmount()
})

test('the palette tab searches, pages, and fills the prompt with the command', async ($, on) => {
  const { box, clock } = await setup($, on)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-palette' })
  const first = await buttons(ui)

  expect(first.filter(b => b.key.startsWith('pal-')).length).toBe(8)
  expect(first.some(b => b.key === 'next' && b.props.hotkey === 'n')).toBe(true)
  const pal = first.find(b => b.key.startsWith('pal-'))

  await ui.press({ key: pal?.key ?? '' })
  expect(box.fills.at(-1)).toBe(`/${(pal?.key ?? '').slice(4)} `)
  await ui.press({ key: 'next' })
  expect((await buttons(ui)).some(b => b.key === 'prev')).toBe(true)
  await ui.unmount()
})

// ------------------------------------------------------------ the quiet band row

test('the band row shows only while a restore point or pause exists and its switch is on', async ($, on) => {
  on('ui.render', ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)

    return <Text>ENGINE-ROW</Text>
  })
  const { box, clock } = await setup($, on)
  const BAND = { plugin: 'control-kit', component: 'AbovePrompt', surface: 'desktop', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80 } } as any
  box.ov['control-kit.band-state'] = true
  const none = await $.ui.mount(BAND)

  expect(JSON.stringify(await none.drawn())).not.toContain('control-kit:')
  await none.unmount()
  await go($, clock, 'kcpause', 'notes 30')
  const shown = await $.ui.mount(BAND)

  expect(JSON.stringify(await shown.drawn())).toContain('paused: notes')
  await shown.unmount()
  delete box.ov['control-kit.band-state']
  const off = await $.ui.mount(BAND)

  expect(JSON.stringify(await off.drawn())).not.toContain('paused: notes')
  await off.unmount()
})

test('/kckeys lists the hotkeys honestly', async ($, on) => {
  await setup($, on)
  const text = await run($, 'kckeys')

  expect(text).toContain('Palette tab')
  expect(text).toMatch(/could not try keys/)
})
