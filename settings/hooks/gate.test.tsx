import { expect, test } from 'claude-code/testing'

// What is verified here: the hooks of settings, run by the real hook chain, with REAL foreign origins.
// Each inline plugin below is a plugin of its own, so `next.origin.plugin` is its name, set by the host
// (the harness stands in for the live host: that the live app does the same is what only the app can confirm).

const row = (plugin: string, word: string) => ({
  plugin,
  tree: { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: [word] }] },
})
const LIST = (rows: unknown[], hasSurvey = false) =>
  ({
    plugin: 'settings',
    component: 'AbovePromptList',
    surface: 'desktop',
    props: { rows, hasSurvey, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80 },
  }) as any

type Box = {
  toasts: string[]
  plays: number
  speaks: string[]
  statuses: (string | undefined)[]
  stored: Map<string, unknown>
  breakLookup: boolean
}

const newBox = (saved: Record<string, unknown> = {}): Box => ({ toasts: [], plays: 0, speaks: [], statuses: [], stored: new Map(Object.entries(saved)), breakLookup: false })

// The bottom of the chain: whatever reaches here was NOT swallowed by settings.
const wire = (on: (...args: any[]) => unknown, box: Box) => {
  on('command.register', () => ({ value: { command: 'cfg' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: box.stored.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    box.stored.set(e.key, e.value)

    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('audio.play', () => {
    box.plays++

    return { value: undefined }
  })
  on('audio.speak', (_: unknown, e: { text: string }) => {
    box.speaks.push(e.text)

    return { value: { via: 'system' as const } }
  })
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    box.statuses.push(e.text)

    return { value: undefined }
  })
  // lets a test make the lookup of the switches throw, to see the gate fail open
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: (e: unknown) => unknown) => {
    if (box.breakLookup && e.plugin === 'settings' && e.key === 'features') {
      return { deny: 'the lookup is refused' }
    }

    return next(e)
  })
}

const NOISE = (on: any) => {
  on('command.run', { command: 'noise' }, async ($: any) => {
    await $.ui.toast('hello from a mod')
    await $.audio.play({ asset: 'sounds/x.wav' })
    await $.audio.speak('spoken line')
    await $.ui.status('a status line')

    return { text: 'noise made' }
  })
  on('command.run', { command: 'clearit' }, async ($: any) => {
    await $.ui.status(undefined)

    return { text: 'cleared' }
  })
}
const make = (name: string) => ({ name, register: NOISE })
// The inline plugins all hook the same command; each makes its calls under its own name. The first to answer wins,
// so a test names exactly one noisy plugin per run. The names are real mods of the registry
// (only a registry mod has switches); the real mods are not loaded here, only these stand-ins.

const run = async ($: any, args: string) => ((await $.command.run({ command: 'cfg', args, origin: 'user' } as any)) as { text: string }).text
const clearit = async ($: any) => ((await $.command.run({ command: 'clearit', args: '', origin: 'user' } as any)) as { text: string }).text
// a status write is not awaited by the caller, so give the chain a moment to reach the bottom
declare const setTimeout: (fn: () => void, ms: number) => unknown
const settle = () => new Promise<void>(resolve => setTimeout(() => resolve(), 30))
const noise = async ($: any) => {
  const text = ((await $.command.run({ command: 'noise', args: '', origin: 'user' } as any)) as { text: string }).text
  await settle()

  return text
}
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

const reached = (box: Box) => ({ toasts: box.toasts.length, plays: box.plays, speaks: box.speaks.length, statuses: box.statuses.filter(t => t !== undefined).length })
const ALL = { toasts: 1, plays: 1, speaks: 1, statuses: 1 }

test('with nothing switched off, a foreign mod gets everything through', { plugins: [make('workbench')] }, async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  expect(await noise($)).toBe('noise made')
  expect(reached(box)).toEqual(ALL)
})

test('toasts off swallows only that mod, and its sounds and status still pass', { plugins: [make('workbench')] }, async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  expect(await run($, 'feature workbench.toasts off')).toMatch(/workbench\.toasts\s+off/)
  await noise($)
  expect(reached(box)).toEqual({ toasts: 0, plays: 1, speaks: 1, statuses: 1 })
  expect(await run($, 'feature workbench.toasts on')).toMatch(/workbench\.toasts\s+on/)
  await noise($)
  expect(box.toasts).toEqual(['hello from a mod'])
})

test('sounds off covers both audio.play and audio.speak, and the swallowed speech still answers', { plugins: [make('workbench')] }, async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature workbench.sounds off')
  expect(await noise($)).toBe('noise made')
  expect(reached(box)).toEqual({ toasts: 1, plays: 0, speaks: 0, statuses: 1 })
})

test('status off swallows a status write, but clearing the line always passes', { plugins: [make('workbench')] }, async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature workbench.status off')
  await noise($)
  expect(reached(box)).toEqual({ toasts: 1, plays: 1, speaks: 1, statuses: 0 })
  expect(await clearit($)).toBe('cleared')
  expect(box.statuses).toEqual([undefined])
})

test('a switch of one mod does not touch another mod', { plugins: [make('notes')] }, async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  // alerts is off, the running plugin is notes
  await run($, 'feature alerts.toasts off')
  await noise($)
  expect(reached(box)).toEqual(ALL)
})

// A name with @marketplace cannot be an inline plugin's name in this harness ("no plugin name"), so that case is covered
// on the decision function in features.test.ts, not through the hook chain.

for (const guard of ['tool-guard', 'safety-pro', 'controls']) {
  test(`${guard} can never be muted: its toasts, sounds and status pass, and the command refuses the switch`, { plugins: [make(guard)] }, async ($, on) => {
    const box = newBox({ features: { [`${guard}.toasts`]: false, [`${guard}.sounds`]: false, [`${guard}.status`]: false, [`${guard}.band`]: false } })
    wire(on, box)
    await start($)
    // even a stored override (hand-edited store) is dropped at load, and the gate would ignore it anyway
    await noise($)
    expect(reached(box)).toEqual(ALL)
    expect(await run($, `feature ${guard}.toasts off`)).toMatch(/cannot be changed/)
    expect(await run($, 'feature')).toMatch(/0 changed from default/)
    await noise($)
    expect(reached(box)).toEqual({ toasts: 2, plays: 2, speaks: 2, statuses: 2 })
  })
}

test('the quiet preset mutes a foreign mod; full brings it back', { plugins: [make('workbench')] }, async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  expect(await run($, 'feature quiet')).toMatch(/Feature switches quiet: \d+ off/)
  await noise($)
  expect(reached(box)).toEqual({ toasts: 0, plays: 0, speaks: 0, statuses: 0 })
  await run($, 'feature full')
  await noise($)
  expect(reached(box)).toEqual({ toasts: 1, plays: 1, speaks: 1, statuses: 1 })
})

test('quiet leaves alerts alone', { plugins: [make('alerts')] }, async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature quiet')
  await noise($)
  expect(reached(box)).toEqual(ALL)
})

test('the gate fails open: a lookup that fails lets every call through', { plugins: [make('workbench')] }, async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature workbench.toasts off')
  await run($, 'feature workbench.sounds off')
  await run($, 'feature workbench.status off')
  await noise($)
  expect(reached(box)).toEqual({ toasts: 0, plays: 0, speaks: 0, statuses: 0 })
  box.breakLookup = true
  await noise($)
  expect(reached(box)).toEqual({ toasts: 1, plays: 1, speaks: 1, statuses: 1 })
})

// ------------------------------------------------------------ the band

const ROWS = [row('cockpit', 'KEEP-COCKPIT'), row('workbench', 'ROW-WORKBENCH'), row('controls', 'KEEP-CONTROLS'), row('motion@local-mods', 'ROW-MOTION'), row('safety-pro', 'KEEP-SAFETY')]
const drawn = async (ui: any) => JSON.stringify(await ui.drawn())

test('the band drops rows of mods whose band switch is off and never a guard', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  const before = await $.ui.mount(LIST(ROWS))
  expect(await drawn(before)).toContain('ROW-WORKBENCH')
  await before.unmount()
  await run($, 'feature workbench.band off')
  await run($, 'feature motion.band off')
  const after = await $.ui.mount(LIST(ROWS))
  const text = await drawn(after)
  expect(text).not.toContain('ROW-WORKBENCH')
  expect(text).not.toContain('ROW-MOTION')
  expect(text).toContain('KEEP-COCKPIT')
  expect(text).toContain('KEEP-CONTROLS')
  expect(text).toContain('KEEP-SAFETY')
  await after.unmount()
})

test('a survey in the band is never touched', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature quiet')
  const ui = await $.ui.mount(LIST(ROWS, true))
  const text = await drawn(ui)
  expect(text).toContain('ROW-WORKBENCH')
  expect(text).toContain('ROW-MOTION')
  await ui.unmount()
})

test('quiet hides every optional row and keeps the guards; full shows them again', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature quiet')
  const quiet = await $.ui.mount(LIST(ROWS))
  const text = await drawn(quiet)
  expect(text).not.toContain('ROW-WORKBENCH')
  expect(text).not.toContain('KEEP-COCKPIT')
  expect(text).toContain('KEEP-CONTROLS')
  await quiet.unmount()
  await run($, 'feature full')
  const full = await $.ui.mount(LIST(ROWS))
  expect(await drawn(full)).toContain('ROW-WORKBENCH')
  await full.unmount()
})

test('the calm preset keeps the cockpit row and drops the others', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature calm')
  const ui = await $.ui.mount(LIST(ROWS))
  const text = await drawn(ui)
  expect(text).toContain('KEEP-COCKPIT')
  expect(text).not.toContain('ROW-WORKBENCH')
  await ui.unmount()
})

test('the band lookup that throws leaves the rows alone', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature workbench.band off')
  box.breakLookup = true
  const ui = await $.ui.mount(LIST(ROWS))
  expect(await drawn(ui)).toContain('ROW-WORKBENCH')
  await ui.unmount()
})

// ------------------------------------------------------------ the command

test('/cfg feature lists, sets, resets and validates', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  expect(await run($, 'feature')).toMatch(/switches in \d+ mods; 0 changed from default/)
  expect(await run($, 'feature cockpit.band off')).toMatch(/cockpit\.band\s+off\s+\* changed, default on/)
  expect(await run($, 'feature list cockpit')).toMatch(/cockpit\.band\s+off/)
  expect(await run($, 'feature')).toMatch(/1 changed from default[\s\S]*cockpit\.band off \(default on\)/)
  expect(await run($, 'feature cockpit.band default')).toMatch(/cockpit\.band\s+on\s+\(default on\)/)
  expect(box.stored.get('features')).toEqual({})
  expect(await run($, 'feature cockpit.bnad on')).toMatch(/No switch named "cockpit\.bnad"\. Closest: cockpit\.band/)
  expect(await run($, 'feature cockpit.band perhaps')).toMatch(/Say on, off or default/)
  expect(await run($, 'feature list nothere')).toMatch(/No mod named "nothere"/)
  expect(await run($, 'feature list all')).toMatch(/All \d+ switches[\s\S]*cockpit\.toasts/)
  await run($, 'feature alerts.sounds off')
  await run($, 'feature reset')
  expect(box.stored.get('features')).toEqual({})
  expect(await run($, 'feature')).toMatch(/0 changed from default/)
})

test('the existing /cfg words still work and the old usage line mentions features', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  expect(await run($, '')).toMatch(/preset full · accent suggestion · density normal/)
  expect(await run($, '')).toMatch(/\/cfg feature/)
  expect(await run($, 'accent warning')).toMatch(/accent warning/)
  expect(await run($, 'accent purple')).toMatch(/Accent is one of/)
})

test('/cfg preset also applies the matching feature preset: calm, focus is quiet, full clears', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  expect(await run($, 'preset calm')).toMatch(/Preset calm[\s\S]*Feature switches calm: \d+ off/)
  const calm = Object.keys((box.stored.get('features') ?? {}) as object).length
  expect(calm).toBeGreaterThan(50)
  expect(await run($, 'preset focus')).toMatch(/Preset focus[\s\S]*Feature switches quiet: \d+ off/)
  const quiet = Object.keys((box.stored.get('features') ?? {}) as object).length
  expect(quiet).toBeGreaterThan(calm)
  expect(await run($, 'preset full')).toMatch(/Preset full[\s\S]*back to their defaults/)
  expect(box.stored.get('features')).toEqual({})
})

// ------------------------------------------------------------ persistence and cleaning

test('switches are stored under `features` and come back in a new session', async ($, on) => {
  const box = newBox()
  wire(on, box)
  await start($)
  await run($, 'feature workbench.toasts off')
  await run($, 'feature motion.band off')
  expect(box.stored.get('features')).toEqual({ 'workbench.toasts': false, 'motion.band': false })
  // a fresh session over the same store: the atom is read back from it
  await start($)
  expect(await run($, 'feature')).toMatch(/2 changed from default/)
  expect(await run($, 'feature list workbench')).toMatch(/workbench\.toasts\s+off/)
})

test('garbage in the stored switches is cleaned at start', async ($, on) => {
  const box = newBox({
    features: { 'cockpit.toasts': false, 'cockpit.band': 'off', 'nope.toasts': false, 'controls.toasts': false, '../../etc.passwd': false, 'workbench.sounds': 7 },
  })
  wire(on, box)
  await start($)
  expect(await run($, 'feature')).toMatch(/1 changed from default[\s\S]*cockpit\.toasts off/)

  for (const junk of ['text', 42, null, ['a'], true]) {
    box.stored.set('features', junk)
    await start($)
    expect(await run($, 'feature')).toMatch(/0 changed from default/)
  }
})

test('more than 600 stored entries are cut to 600 at start', async ($, on) => {
  // only registry ids count, so a flood of fake ids leaves none; the cap itself is tested on the pure function
  const flood = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`mod${i}.toasts`, false]))
  const box = newBox({ features: flood })
  wire(on, box)
  await start($)
  expect(await run($, 'feature')).toMatch(/0 changed from default/)
})
