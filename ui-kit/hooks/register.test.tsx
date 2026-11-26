import { expect, mock, test } from 'claude-code/testing'

const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime()
const MIN = 60_000

type Opts = {
  motion?: boolean
  calm?: boolean
  features?: Record<string, boolean>
  icons?: string
  store?: Record<string, unknown>
  refuse?: boolean
  usage?: { usd: number; pct: number }
  tool?: (e: { tool: string }) => unknown
}

const paneProps = (columns: number, placement = 'dock') => ({ title: 'UI kit', isFocused: false, bodyColumns: columns, placement, scroll: { offset: 0, bodyRows: 40 }, view: {} })
const pane = (surface: string, columns = 80, placement = 'dock', id = 'ui-kit-main') =>
  ({ plugin: 'ui-kit', component: 'Pane', requestId: id, surface, props: paneProps(columns, placement) }) as any

// Stands in for the engine. Returns the things a test wants to look at.
const engine = (on: any, o: Opts = {}) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, o.store ?? {})
  const box = { registered: [] as string[], opened: [] as any[], toasts: [] as string[], usage: { usd: o.usage?.usd ?? 1.25, pct: o.usage?.pct ?? 40 } }
  on('command.register', (_: unknown, e: { name: string }) => {
    if (o.refuse === true && e.name === 'uifail') {
      throw new Error('name taken')
    }
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: any) => {
    box.opened.push(e)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: NOW - 600_000, context: { window: 1000, percent: box.usage.pct }, rateLimits: [], cost: { usd: box.usage.usd } },
  }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('tool.call', (_: unknown, e: { tool: string }) => (o.tool === undefined ? { result: {}, text: 'ok' } : o.tool(e)))
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: any) => {
    if (e.plugin === 'motion' && e.key === 'isOn') {
      return { value: { value: o.motion !== false, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'isCalm') {
      return { value: { value: o.calm === true, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'icons' && o.icons !== undefined) {
      return { value: { value: o.icons, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'features' && o.features !== undefined) {
      return { value: { value: { shape: 'features-1', value: o.features }, version: 1 } }
    }

    return next(e)
  })

  return { clock, box }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args, origin: 'user' } as any)) as { text: string }).text
const find = (ui: any, re: RegExp, type = 'Text') => ui.find({ type, text: new RegExp(re.source.replace(/ /g, '\\s'), re.flags) })
const tree = async (ui: any) => JSON.stringify(await ui.drawn())
const has = async (ui: any, re: RegExp) => re.test(await tree(ui))
const btn = (ui: any, key: string) => ui.find({ type: 'Button', key }).catch(() => undefined)
const walk = (n: any, fn: (n: any) => void) => {
  fn(n)

  for (const c of n?.children ?? []) {
    if (typeof c === 'object' && c !== null) {
      walk(c, fn)
    }
  }
}
/** Is there a Box of this direction that holds both of these texts in separate children? */
const splitBox = async (ui: any, dir: string, a: string, b: string) => {
  let hit = false
  walk(await ui.drawn(), n => {
    if (n.type === 'Box' && n.props?.flexDirection === dir && (n.children ?? []).length === 2) {
      const [x, y] = (n.children as any[]).map(c => JSON.stringify(c))

      hit = hit || ((x!.includes(`"${a}"`) && y!.includes(`"${b}"`)) && x !== y)
    }
  })

  return hit
}
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const DATA_VIEWS = ['timeline', 'files', 'errors', 'prompts', 'spend', 'activity'] as const

/** A few real calls: two reads, an edit, and a failing Bash with a secret in its message. */
const someCalls = async ($: any) => {
  await $.tool.call({ tool: 'Read', file_path: '/app/src/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/app/src/a.ts', old_string: 'x', new_string: 'y\nz' })
  await $.tool.call({ tool: 'Bash', command: 'npm test --token=hunter2' })
}
const failBash = (e: { tool: string }) => (e.tool === 'Bash' ? { isError: true, result: 'exit 1', text: 'exit code 1: token=hunter2 failed in /app/a.ts' } : { result: {}, text: 'ok' })

test('a session registers every command, /ui lists each one, and a refused name does not stop the start', async ($, on) => {
  const { box } = engine(on, { refuse: true })
  await start($)
  expect(box.registered.sort()).toEqual(['ui', 'uidemo', 'uifull', 'uimini', 'uireset', 'uiswitches', 'uiundo', 'uiviews', 'uiwidget'].sort())
  const help = await run($, 'ui')

  for (const name of [...box.registered, 'uifail']) {
    expect(help).toMatch(new RegExp(`^/${name} {2}`, 'm'))
  }
})

test('tool calls and a failure are recorded and counted; a secret never reaches the view', async ($, on) => {
  engine(on, { tool: failBash })
  await start($)
  await someCalls($)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await find(ui, /tool calls 3 {2}· {2}failed 1/)).toBeDefined()
  expect(await has(ui, /hunter2/)).toBe(false)
  await ui.unmount()
})

test('an edit shows up in the Files view', async ($, on) => {
  engine(on)
  await start($)
  await someCalls($)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'view-files' })
  expect(await find(ui, /a\.ts +█+ +x1/)).toBeDefined()
  await ui.unmount()
})

test('a failure shows up in the Errors view with its message scrubbed', async ($, on) => {
  engine(on, { tool: failBash })
  await start($)
  await someCalls($)
  const ui = await $.ui.mount(pane('terminal', 120))
  await ui.press({ key: 'view-errors' })
  expect(await find(ui, /failed 1/)).toBeDefined()
  expect(await has(ui, /"key":"pick-errors:Bash: exit code #/)).toBe(true)
  expect(await has(ui, /message: exit code 1: token=\*\*\* failed in \/app\/a\.ts/)).toBe(true)
  expect(await has(ui, /hunter2/)).toBe(false)
  await ui.unmount()
})

test('with the record switch off nothing is kept; the calls still run', async ($, on) => {
  engine(on, { features: { 'ui-kit.record': false } })
  await start($)
  await someCalls($)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await find(ui, /No tool calls yet/)).toBeDefined()
  await ui.unmount()
})

test('prompts count by length only; snippets are a separate switch', async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: 'please fix the parser', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'view-prompts' })
  expect(await find(ui, /prompts 1/)).toBeDefined()
  expect(await has(ui, /parser/)).toBe(false)
  await ui.unmount()
})

test('prompt snippets show only when their switch is on', async ($, on) => {
  engine(on, { features: { 'ui-kit.prompt-snippets': true } })
  await start($)
  await $.prompt.submit({ text: 'please fix the parser', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'view-prompts' })
  await ui.press({ key: `row-prompts:${NOW}-0` })
  expect(await has(ui, /please fix the parser/)).toBe(true)
  await ui.unmount()
})

test('a finished turn takes a spend reading that the Spend view shows', async ($, on) => {
  const { box } = engine(on)
  await start($)
  box.usage = { usd: 2.5, pct: 63 }
  await $.turn.complete({ answer: '', durationMs: 30_000, isAborted: false, turnId: 't', reason: 'answer' })
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'view-spend' })
  expect(await find(ui, /spent \$2\.50 {2}· {2}context 63%/)).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- surfaces and breakpoints

for (const [surface, half] of SURFACES.flatMap(x => [[x, 0], [x, 1]] as const)) {
  test(`views ${half === 0 ? '1 to 3' : '4 to 6'} draw on the ${surface} surface: ${surface === 'desktop' ? 'a vector picture' : 'text charts'}`, async ($, on) => {
    engine(on)
    await start($)
    await run($, 'uidemo', 'on')
    const ui = await $.ui.mount(pane(surface))

    for (const v of DATA_VIEWS.slice(half * 3, half * 3 + 3)) {
      await ui.press({ key: `view-${v}` })
      const svg = await ui.find({ type: 'Svg' }).catch(() => undefined)

      if (surface === 'desktop') {
        expect(svg).toBeDefined()
        expect(await has(ui, /<svg/)).toBe(true)
      } else {
        expect(svg).toBeUndefined()
        expect(await has(ui, /<svg/)).toBe(false)
        expect(await has(ui, /[▁▂▃▄▅▆▇█]/)).toBe(true)
      }
    }
    await ui.unmount()
  })
}

test('216: three layouts by columns: narrow tabs are short, medium has expandable rows, wide has master-detail', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')

  for (const [columns, shortTabs, picks, rows] of [[40, true, false, true], [80, false, false, true], [120, false, true, false]] as const) {
    const ui = await $.ui.mount(pane('terminal', columns))
    expect(await has(ui, /"label":"\[?Err\]?"/)).toBe(shortTabs)
    expect(await has(ui, /"key":"pick-timeline:/)).toBe(picks)
    expect(await has(ui, /"key":"row-timeline:/)).toBe(rows)
    await ui.unmount()
  }
})

test('216: the desktop picture is drawn narrower on a narrow pane than on a wide one', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const widths: number[] = []

  for (const columns of [40, 80, 120]) {
    const ui = await $.ui.mount(pane('desktop', columns))
    widths.push(Number(/viewBox=\\"0 0 (\d+) /.exec(await tree(ui))?.[1]))
    await ui.unmount()
  }
  expect(widths[0]!).toBeLessThan(widths[1]!)
  expect(widths[1]!).toBeLessThan(widths[2]!)
})

test('212: split view shows two views, side by side only when wide', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  expect(await run($, 'uiviews', 'timeline split files')).toMatch(/timeline with files beside it/)

  for (const [columns, isRow] of [[40, false], [80, false], [120, true]] as const) {
    const ui = await $.ui.mount(pane('terminal', columns))
    expect(await find(ui, /^Timeline$/)).toBeDefined()
    expect(await find(ui, /^Files treemap$/)).toBeDefined()
    expect(await splitBox(ui, 'row', 'Timeline', 'Files treemap')).toBe(isRow)
    expect(await splitBox(ui, 'column', 'Timeline', 'Files treemap')).toBe(!isRow)
    await ui.unmount()
  }
  expect(await run($, 'uiviews', 'split off')).not.toMatch(/beside/)
})

test('212: the Split button cycles the partner view and the Lab cannot be split', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 100))
  expect(await btn(ui, 'ui-split')).toBeDefined()
  await ui.press({ key: 'ui-split' })
  expect(await find(ui, /^Files treemap$/)).toBeDefined()
  await ui.press({ key: 'view-lab' })
  expect(await btn(ui, 'ui-split')).toBeUndefined()
  await ui.unmount()
})

test('with the split switch off there is no Split button', async ($, on) => {
  engine(on, { features: { 'ui-kit.split': false } })
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await btn(ui, 'ui-split')).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- 213 214 215 mini, widget, full

test('214: mini mode is three numbers and a way back; 213: the widget placement draws the glance', async ($, on) => {
  const { box } = engine(on, { tool: failBash })
  await start($)
  await someCalls($)
  expect(await run($, 'uimini')).toBe('Mini mode on: three numbers.')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await find(ui, /calls 3 {3}failed 1 {3}spent \$0\.00/)).toBeDefined()
  expect(await btn(ui, 'view-timeline')).toBeUndefined()
  await ui.press({ key: 'ui-expand' })
  expect(await btn(ui, 'view-timeline')).toBeDefined()
  await ui.unmount()

  const glance = await $.ui.mount(pane('terminal', 30, 'widget'))
  expect(await find(glance, /calls 3/)).toBeDefined()
  expect(await btn(glance, 'ui-expand')).toBeUndefined()
  await glance.unmount()

  const second = await $.ui.mount(pane('terminal', 30, 'dock', 'ui-kit-widget'))
  expect(await find(second, /calls 3/)).toBeDefined()
  await second.unmount()

  expect(await run($, 'uiwidget')).toMatch(/Opened the small pane/)
  expect(box.opened.some((o: any) => o.id === 'ui-kit-widget' && o.placement === 'widget')).toBe(true)
  const desk = await $.ui.mount(pane('desktop', 30, 'widget', 'ui-kit-widget'))
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  await desk.unmount()
})

test('215: /uifull asks for the largest pane and says plainly it is a request', async ($, on) => {
  const { box } = engine(on)
  await start($)
  const text = await run($, 'uifull')
  expect(text).toMatch(/large, not true full screen/)
  const open = box.opened.find((o: any) => o.id === 'ui-kit-main')
  expect(open).toMatchObject({ rows: 200, columns: 200, focus: true, closeOnEscape: true })
})

// ---------------------------------------------------------------- 217 218 touch and keyboard

test('217: large targets pad every button; 218: hotkeys appear only in keyboard-first mode', async ($, on) => {
  engine(on)
  await start($)
  const plain = await $.ui.mount(pane('terminal'))
  const before = await tree(plain)
  expect(before).not.toMatch(/"hotkey"/)
  expect((before.match(/"padding":"sm"/g) ?? []).length).toBeLessThan(3)
  await plain.unmount()
})

test('217: with the switch on, buttons sit in padded boxes', async ($, on) => {
  engine(on, { features: { 'ui-kit.large-targets': true } })
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  expect((await tree(ui)).match(/"padding":"sm"/g)!.length).toBeGreaterThanOrEqual(10)
  await ui.unmount()
})

test('218: keyboard-first gives the tabs 1 to 7 and the pane opens with focus', async ($, on) => {
  const { box } = engine(on, { features: { 'ui-kit.hotkeys': true } })
  await start($)
  const ui = await $.ui.mount(pane('terminal'))
  const t = await tree(ui)

  for (const k of ['1', '2', '3', '4', '5', '6', '7', 's', 'm', 'd']) {
    expect(t).toContain(`"hotkey":"${k}"`)
  }
  await ui.unmount()
  await run($, 'uiviews')
  expect(box.opened.find((o: any) => o.id === 'ui-kit-main')?.focus).toBe(true)
})

// ---------------------------------------------------------------- 219 to 224 list patterns

test('221: a row opens in place and shows its detail; pressing again closes it', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await has(ui, /started \d\d:\d\d:\d\d/)).toBe(false)
  await ui.press({ key: 'row-timeline:d38' })
  expect(await has(ui, /started \d\d:\d\d:\d\d/)).toBe(true)
  await ui.press({ key: 'row-timeline:d38' })
  expect(await has(ui, /started \d\d:\d\d:\d\d/)).toBe(false)
  await ui.unmount()
})

test('221: with expandable rows off the rows are plain text', async ($, on) => {
  engine(on, { features: { 'ui-kit.expand-rows': false } })
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await has(ui, /"key":"row-timeline:/)).toBe(false)
  await ui.unmount()
})

test('222: on a wide pane the picked row shows its detail beside the list', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 120))
  await ui.press({ key: 'view-files' })
  expect(await has(ui, /1 edit|9 edits/)).toBe(true)
  await ui.press({ key: 'pick-files:/app/src/data.ts' })
  expect(await has(ui, /\/app\/src\/data\.ts/)).toBe(true)
  expect(await has(ui, /2 edits/)).toBe(true)
  await ui.unmount()
})

test('223: an accordion section opens and the choice is remembered in the store, then restored', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await has(ui, /Hover a mark in the picture/)).toBe(false)
  await ui.press({ key: 'acc-timeline.about' })
  expect(await has(ui, /Hover a mark in the picture/)).toBe(true)
  await ui.press({ key: 'acc-timeline.list' })
  expect(await has(ui, /"key":"row-timeline:/)).toBe(false)
  await ui.unmount()
})

test('223: the remembered folds come back in a new session', async ($, on) => {
  engine(on, { store: { acc: { 'timeline.about': true, 'timeline.list': false, 'bad key': true } } })
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await has(ui, /Hover a mark in the picture/)).toBe(true)
  expect(await has(ui, /"key":"row-timeline:/)).toBe(false)
  await ui.unmount()
})

test('with the accordion switch off every section is simply open', async ($, on) => {
  engine(on, { features: { 'ui-kit.accordion': false } })
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await has(ui, /Hover a mark in the picture/)).toBe(true)
  expect(await has(ui, /"key":"acc-/)).toBe(false)
  await ui.unmount()
})

test('211: move a Lab item between two lists with buttons', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect((await btn(ui, 'lab-mv-1'))?.props.label).toMatch(/Move →/)
  await ui.press({ key: 'lab-mv-1' })
  expect((await btn(ui, 'lab-mv-1'))?.props.label).toMatch(/← Move/)
  await ui.press({ key: 'lab-mv-1' })
  expect((await btn(ui, 'lab-mv-1'))?.props.label).toMatch(/Move →/)
  await ui.unmount()
})

test('219: rename an item in place; an empty name keeps the old one', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('terminal', 80))
  await ui.press({ key: 'lab-ren-2' })
  await ui.input({ plugin: 'ui-kit', key: 'lab-in-2', text: 'Check the figures' })
  expect(await has(ui, /Check the figures/)).toBe(true)
  expect(await btn(ui, 'lab-ren-2')).toBeDefined()
  await ui.press({ key: 'lab-ren-2' })
  await ui.input({ plugin: 'ui-kit', key: 'lab-in-2', text: '   ' })
  expect(await has(ui, /Check the figures/)).toBe(true)
  await ui.unmount()
})

test('219: adding an item and cancelling a rename', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('terminal', 80))
  await ui.input({ plugin: 'ui-kit', key: 'lab-add', text: 'Write the notes' })
  expect(await has(ui, /Write the notes/)).toBe(true)
  await ui.press({ key: 'lab-ren-1' })
  expect(await btn(ui, 'lab-cancel-1')).toBeDefined()
  await ui.press({ key: 'lab-cancel-1' })
  expect(await btn(ui, 'lab-ren-1')).toBeDefined()
  await ui.unmount()
})

test('224: the four step wizard goes Next and Back, finishes with a tick, and starts over', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('desktop', 80))
  expect(await find(ui, /^Step 1: Pick a view$/)).toBeDefined()
  expect(await btn(ui, 'lab-back')).toBeUndefined()
  await ui.press({ key: 'lab-pick-0-2' })
  await ui.press({ key: 'lab-next' })
  expect(await find(ui, /^Step 2: Pick a layout$/)).toBeDefined()
  await ui.press({ key: 'lab-back' })
  expect(await find(ui, /^Step 1: Pick a view$/)).toBeDefined()
  await ui.press({ key: 'lab-next' })
  await ui.press({ key: 'lab-next' })
  await ui.press({ key: 'lab-next' })
  expect(await find(ui, /^Step 4: Review$/)).toBeDefined()
  expect(await has(ui, /You picked: Errors, Single, Large targets/)).toBe(true)
  await ui.press({ key: 'lab-finish' })
  expect(await has(ui, /stroke-dasharray:100/)).toBe(true)
  await ui.press({ key: 'lab-restart' })
  expect(await find(ui, /^Step 1: Pick a view$/)).toBeDefined()
  await ui.unmount()
})

for (const [name, o] of [['motion off', { motion: false }], ['calm', { calm: true }], ['the checkmark switch off', { features: { 'ui-kit.checkmark': false } }]] as [string, Opts][]) {
  test(`232: the tick is drawn still with ${name}`, async ($, on) => {
    engine(on, o)
    await start($)
    await run($, 'uiviews', 'lab')
    const ui = await $.ui.mount(pane('desktop', 80))

    for (const k of ['lab-next', 'lab-next', 'lab-next', 'lab-finish']) {
      await ui.press({ key: k })
    }
    const t = await tree(ui)
    expect(t).not.toMatch(/stroke-dasharray:100|@keyframes/)
    expect(t).toMatch(o.features === undefined ? /M17 29/ : /✓ Done/)
    await ui.unmount()
  })
}

test('232: with motion on the tick is a stroke that draws itself', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('desktop', 80))

  for (const k of ['lab-next', 'lab-next', 'lab-next', 'lab-finish']) {
    await ui.press({ key: k })
  }
  expect(await has(ui, /stroke-dasharray:100/)).toBe(true)
  expect(await has(ui, /@keyframes tick/)).toBe(true)
  await ui.unmount()
})

// ---------------------------------------------------------------- 225 estimate

test('225: a running call shows a progress bar with a guess from earlier calls; no guess without three', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await has(ui, /Running: Bash node \(2\.6s\)/)).toBe(true)
  expect(await has(ui, /about [\d.]+s left, a guess from \d+ similar calls/)).toBe(true)
  await ui.unmount()
})

test('225: the estimate can be switched off', async ($, on) => {
  engine(on, { features: { 'ui-kit.eta': false } })
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await has(ui, /Running:/)).toBe(false)
  await ui.unmount()
})

// ---------------------------------------------------------------- 226 skeleton

test('226: the skeleton shows for a moment after a switch, only when switched on and motion allowed', async ($, on) => {
  const { clock } = engine(on, { features: { 'ui-kit.skeleton': true } })
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('desktop', 80))
  await ui.press({ key: 'view-files' })
  expect(await has(ui, /aria-label=\\"Loading\\"/)).toBe(true)
  expect(await has(ui, /@keyframes sweep/)).toBe(true)
  await clock.advance(600)
  expect(await has(ui, /aria-label=\\"Loading\\"/)).toBe(false)
  expect(await has(ui, /Treemap of 8 edited files/)).toBe(true)
  await ui.unmount()
})

test('226: no skeleton by default', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('desktop', 80))
  await ui.press({ key: 'view-files' })
  expect(await has(ui, /Loading/)).toBe(false)
  await ui.unmount()
})

test('226: none with calm on, even with the switch on', async ($, on) => {
  engine(on, { features: { 'ui-kit.skeleton': true }, calm: true })
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('desktop', 80))
  await ui.press({ key: 'view-errors' })
  expect(await has(ui, /Loading/)).toBe(false)
  await ui.unmount()
})

// ---------------------------------------------------------------- 227 228 optimistic and undo

const ticked = async (ui: any, id: number) => /☑/.test(String((await btn(ui, `lab-tg-${id}`))?.text))

test('227: a toggle shows its new state at once, saving, then confirmed a moment later', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await ticked(ui, 2)).toBe(false)
  await ui.press({ key: 'lab-tg-2' })
  expect(await ticked(ui, 2)).toBe(true)
  expect(await has(ui, /saving/)).toBe(true)
  await clock.advance(1000)
  expect(await has(ui, /saving/)).toBe(false)
  expect(await has(ui, /confirmed/)).toBe(true)
  await clock.advance(2000)
  expect(await has(ui, /confirmed/)).toBe(false)
  expect(await ticked(ui, 2)).toBe(true)
  await ui.unmount()
})

for (const [name, o] of [['calm is on', { calm: true }], ['motion is off', { motion: false }], ['the switch is off', { features: { 'ui-kit.optimistic': false } }]] as [string, Opts][]) {
  test(`227: a toggle confirms at once when ${name}`, async ($, on) => {
    engine(on, o)
    await start($)
    await run($, 'uiviews', 'lab')
    const ui = await $.ui.mount(pane('terminal', 80))
    await ui.press({ key: 'lab-tg-2' })
    expect(await has(ui, /saving/)).toBe(false)
    expect(await ticked(ui, 2)).toBe(true)
    await ui.unmount()
  })
}

test('228: removing shows a toast and an Undo button for 30 s; /uiundo brings it back; later it is too late', async ($, on) => {
  const { box, clock } = engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('terminal', 80))
  await ui.press({ key: 'lab-rm-1' })
  expect(box.toasts).toHaveLength(1)
  expect(box.toasts[0]).toMatch(/Removed "Draft the summary".*\/uiundo.*30 seconds/)
  expect(await btn(ui, 'lab-undo')).toBeDefined()
  expect(await has(ui, /Draft the summary/)).toBe(true)
  await ui.press({ key: 'lab-undo' })
  expect(await btn(ui, 'lab-undo')).toBeUndefined()
  expect(await btn(ui, 'lab-rm-1')).toBeDefined()

  await ui.press({ key: 'lab-rm-2' })
  expect(box.toasts).toHaveLength(1)
  await clock.advance(31_000)
  expect(await btn(ui, 'lab-undo')).toBeUndefined()
  expect(await run($, 'uiundo')).toMatch(/Nothing to undo/)
  await ui.unmount()
})

test('228: /uiundo restores an item removed a moment ago; a second toast waits three minutes', async ($, on) => {
  const { box, clock } = engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('terminal', 80))
  await ui.press({ key: 'lab-rm-3' })
  expect(await run($, 'uiundo')).toBe('Brought back "Send for review".')
  await clock.advance(4 * MIN)
  await ui.press({ key: 'lab-rm-3' })
  expect(box.toasts).toHaveLength(2)
  await ui.unmount()
})

test('228: the undo toast has its own switch, the inline Undo stays', async ($, on) => {
  const { box } = engine(on, { features: { 'ui-kit.undo-toast': false } })
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('terminal', 80))
  await ui.press({ key: 'lab-rm-1' })
  expect(box.toasts).toHaveLength(0)
  expect(await btn(ui, 'lab-undo')).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- 229 230 empty and error states

test('229: every view has an empty state with a button, and the button fills it with sample data', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal', 80))

  for (const v of DATA_VIEWS) {
    await ui.press({ key: `view-${v}` })
    expect(await btn(ui, 'empty-demo')).toBeDefined()
    expect(await btn(ui, 'empty-lab')).toBeDefined()
  }
  await ui.press({ key: 'view-timeline' })
  await ui.press({ key: 'empty-demo' })
  expect(await btn(ui, 'empty-demo')).toBeUndefined()
  expect(await has(ui, /SAMPLE DATA/)).toBe(true)
  await ui.press({ key: 'empty-lab' }).catch(() => undefined)
  await ui.unmount()
})

test('229: the empty button can open the Lab', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(pane('terminal', 80))
  await ui.press({ key: 'empty-lab' })
  expect(await find(ui, /^Lab$/)).toBeDefined()
  await ui.unmount()
})

test('230: a view that fails to draw shows an error with Retry, and Retry draws it again', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  expect(await run($, 'uifail')).toMatch(/Retry/)
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await find(ui, /Timeline could not be drawn\./)).toBeDefined()
  expect(await btn(ui, 'retry')).toBeDefined()
  await ui.press({ key: 'retry' })
  expect(await find(ui, /could not be drawn/)).toBeUndefined()
  expect(await find(ui, /^Timeline$/)).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- 231 to 235 feedback

const tenCalls = async ($: any) => {
  for (let i = 0; i < 10; i++) {
    await $.tool.call({ tool: 'Read', file_path: `/a/${i}.ts` })
  }
}

test('233: confetti is off by default', async ($, on) => {
  engine(on)
  await start($)
  await tenCalls($)
  const ui = await $.ui.mount(pane('desktop', 80))
  expect(await has(ui, /Milestone/)).toBe(false)
  await ui.unmount()
})

test('233: with the switch a milestone shows a burst of falling pieces, then it goes', async ($, on) => {
  const { clock } = engine(on, { features: { 'ui-kit.confetti': true } })
  await start($)
  await tenCalls($)
  const ui = await $.ui.mount(pane('desktop', 80))
  expect(await has(ui, /Milestone: 10 tool calls/)).toBe(true)
  expect(await has(ui, /@keyframes fall/)).toBe(true)
  await clock.advance(7000)
  expect(await has(ui, /Milestone/)).toBe(false)
  await ui.unmount()
})

test('233: calm gives the milestone as a still picture, with no falling pieces', async ($, on) => {
  engine(on, { features: { 'ui-kit.confetti': true }, calm: true })
  await start($)
  await tenCalls($)
  const ui = await $.ui.mount(pane('desktop', 80))
  expect(await has(ui, /Milestone: 10 tool calls/)).toBe(true)
  expect(await has(ui, /@keyframes|animation:/)).toBe(false)
  await ui.unmount()
})

test('234: a number that just changed flashes, then settles', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
  let ui = await $.ui.mount(pane('desktop', 80))
  expect(await has(ui, /class=\\"flash\\"/)).toBe(true)
  await ui.unmount()
  await clock.advance(2000)
  ui = await $.ui.mount(pane('desktop', 80))
  expect(await has(ui, /class=\\"flash\\"/)).toBe(false)
  await ui.unmount()
})

for (const [name, o] of [['motion is off', { motion: false }], ['calm is on', { calm: true }], ['the switch is off', { features: { 'ui-kit.pulse': false } }]] as [string, Opts][]) {
  test(`234: no flash when ${name}`, async ($, on) => {
    engine(on, o)
    await start($)
    await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
    const ui = await $.ui.mount(pane('desktop', 80))
    expect(await has(ui, /class=\\"flash\\"/)).toBe(false)
    await ui.unmount()
  })
}

test('the entrance plays right after a view opens, and not once the moment has passed', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  await run($, 'uiviews', 'files')
  let ui = await $.ui.mount(pane('desktop', 80))
  expect(await has(ui, /@keyframes rise/)).toBe(true)
  await ui.unmount()
  await clock.advance(3000)
  ui = await $.ui.mount(pane('desktop', 80))
  expect(await has(ui, /@keyframes rise/)).toBe(false)
  await ui.unmount()
})

for (const [name, o] of [['motion is off', { motion: false }], ['calm is on', { calm: true }]] as [string, Opts][]) {
  test(`every picture is still when ${name}, hover titles kept`, async ($, on) => {
    engine(on, o)
    await start($)
    await run($, 'uidemo', 'on')
    await run($, 'uiviews', 'files')
    const ui = await $.ui.mount(pane('desktop', 80))

    for (const v of DATA_VIEWS) {
      await ui.press({ key: `view-${v}` })
      expect(await has(ui, /@keyframes|animation:/)).toBe(false)
      expect(await has(ui, /<title>/)).toBe(true)
    }
    await ui.unmount()
  })
}

test('235: hover cards are the plain SVG titles, nothing richer', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const ui = await $.ui.mount(pane('desktop', 120))
  await ui.press({ key: 'view-files' })
  const t = await tree(ui)
  expect(t).toMatch(/<title>\/app\/src\/data\.ts/)
  expect(t).not.toMatch(/"hover"/)
  await ui.unmount()
})

test('220: tool rows end in a tiny picture on desktop and block characters elsewhere', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uidemo', 'on')
  const desk = await $.ui.mount(pane('desktop', 80))
  await desk.press({ key: 'view-activity' })
  expect((await tree(desk)).match(/"alt":"Bash calls over time"/g)?.length).toBe(1)
  await desk.unmount()
  const term = await $.ui.mount(pane('terminal', 80))
  await term.press({ key: 'view-activity' })
  expect(await has(term, /Bash\s+[▁▂▃▄▅▆▇█]{12}\s\d+/)).toBe(true)
  expect(await has(term, /calls over time/)).toBe(false)
  await term.unmount()
})

// ---------------------------------------------------------------- housekeeping

test('/uiswitches lists every switch and says which are changed', async ($, on) => {
  engine(on, { features: { 'ui-kit.confetti': true, 'ui-kit.split': false } })
  await start($)
  const text = await run($, 'uiswitches')
  expect(text).toMatch(/^ui-kit\.confetti: on \(changed\)$/m)
  expect(text).toMatch(/^ui-kit\.split: off \(changed\)$/m)
  expect(text).toMatch(/^ui-kit\.record: on$/m)
  expect(text).toMatch(/^ui-kit\.hotkeys: off$/m)
  expect(text.split('\n').length).toBe(22)
})

test('/uiviews checks its words, and /uidemo checks its argument', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'uiviews', 'bogus')).toMatch(/Unknown word "bogus"/)
  expect(await run($, 'uiviews', 'split')).toMatch(/split needs a view/)
  expect(await run($, 'uiviews', 'split lab')).toMatch(/split needs a view/)
  expect(await run($, 'uiviews', 'errors')).toMatch(/UI kit: errors\./)
  expect(await run($, 'uidemo', 'maybe')).toBe('Use /uidemo on or /uidemo off.')
  expect(await run($, 'uidemo', 'on')).toMatch(/sample data/)
  expect(await run($, 'uidemo', 'off')).toBe('Sample data off.')
})

test('/uireset clears the records but keeps the Lab', async ($, on) => {
  engine(on, { tool: failBash })
  await start($)
  await someCalls($)
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await find(ui, /tool calls 3/)).toBeDefined()
  expect(await run($, 'uireset')).toMatch(/Cleared the recorded calls/)
  expect(await find(ui, /No tool calls yet/)).toBeDefined()
  await ui.press({ key: 'view-lab' })
  expect(await btn(ui, 'lab-rm-1')).toBeDefined()
  await ui.unmount()
})

test('/uireset all also resets the Lab, the folds and the layout', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'uiviews', 'lab')
  const ui = await $.ui.mount(pane('terminal', 80))
  await ui.press({ key: 'lab-rm-1' })
  expect(await btn(ui, 'lab-rm-1')).toBeUndefined()
  expect(await run($, 'uireset', 'all')).toMatch(/plus the Lab/)
  expect(await find(ui, /^Timeline$|No tool calls yet/)).toBeDefined()
  await ui.press({ key: 'view-lab' })
  expect(await btn(ui, 'lab-rm-1')).toBeDefined()
  expect(await find(ui, /^Step 1: Pick a view$/)).toBeDefined()
  await ui.unmount()
})

test('daily totals persist between sessions and bad stored values are ignored', async ($, on) => {
  engine(on, { store: { days: { '2026-11-24': 7, nope: 3, '2026-11-25': 'x' }, hours: [1, 'a', 2], prefs: { view: 'activity', split: 'lab', mini: 9 }, lab: 'junk' } })
  await start($)
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await find(ui, /^Activity$/)).toBeDefined()
  expect(await find(ui, /12 weeks 7/)).toBeDefined()
  await ui.unmount()
})

test('a call that fails inside the engine is recorded as failed and the error goes on', async ($, on) => {
  engine(on, {
    tool: () => {
      throw new Error('boom')
    },
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'x' }).catch(() => undefined)
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await find(ui, /tool calls 1 {2}· {2}failed 1/)).toBeDefined()
  await ui.unmount()
})

test('225: the estimate redraws every second only with eta-live on', async ($, on) => {
  const holder: { clock?: { sleep: (ms: number) => Promise<void>; advance: (ms: number) => Promise<void> } } = {}
  const live = engine(on, { features: { 'ui-kit.eta-live': true }, tool: async () => { await holder.clock?.sleep(5000); return { result: {}, text: 'done' } } })
  holder.clock = live.clock
  await start($)
  const call = $.tool.call({ tool: 'Bash', command: 'sleep' })
  await live.clock.advance(100)
  const ui = await $.ui.mount(pane('terminal', 80))
  expect(await has(ui, /Running: Bash sleep \(100ms\)/)).toBe(true)
  await live.clock.advance(3000)
  expect(await has(ui, /Running: Bash sleep \(3\.0s\)/)).toBe(true)
  await live.clock.advance(2500)
  await call
  expect(await has(ui, /Running:/)).toBe(false)
  await ui.unmount()
})

test('225: without eta-live the bar is drawn once and does not move on its own', async ($, on) => {
  const holder: { clock?: { sleep: (ms: number) => Promise<void>; advance: (ms: number) => Promise<void> } } = {}
  const quiet = engine(on, { tool: async () => { await holder.clock?.sleep(5000); return { result: {}, text: 'done' } } })
  holder.clock = quiet.clock
  await start($)
  const call = $.tool.call({ tool: 'Bash', command: 'sleep' })
  await quiet.clock.advance(100)
  const ui = await $.ui.mount(pane('terminal', 80))
  await quiet.clock.advance(3000)
  expect(await has(ui, /Running: Bash sleep \(100ms\)/)).toBe(true)
  await quiet.clock.advance(2500)
  await call
  await ui.unmount()
})
