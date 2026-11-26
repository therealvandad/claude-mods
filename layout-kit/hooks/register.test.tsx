import { expect, test } from 'claude-code/testing'

const PANE = (surface: 'desktop' | 'terminal' = 'desktop', cols = 100) =>
  ({
    plugin: 'layout-kit',
    component: 'Pane',
    requestId: 'layout-kit-main',
    surface,
    props: { title: 'Layout kit', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

const BAND = { plugin: 'layout-kit', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 80, scroll: { offset: 0, bodyRows: 5 }, view: {} } } as const

type Usage = { cost?: { usd: number }; percent?: number; limits?: { kind: string; percentUsed: number }[] }

// Stands in for the engine. `clock.t` and `usage` are moved by each test.
const engine = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}, opt: { refuse?: boolean; fill?: boolean; features?: Record<string, boolean>; cwd?: string } = {}) => {
  const saved: Record<string, unknown> = { ...init }
  const clock = { t: new Date(2026, 10, 25, 12, 0, 0).getTime() }
  const usage: Usage = { cost: { usd: 0 }, percent: 10, limits: [] }
  const registered: string[] = []
  const fills: string[] = []
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []

  on('clock.now', () => ({ value: clock.t }))
  on('command.register', (_: unknown, e: { name: string }) => {
    if (opt.refuse === true) {
      throw new Error('name taken')
    }
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', (_: unknown, e: { text?: string }) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    fills.push(e.text)

    return { isFilled: opt.fill !== false, text: e.text, cursor: e.text.length }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: clock.t - 90 * 60_000, context: { window: 1000, percent: usage.percent ?? null }, rateLimits: usage.limits ?? [], cost: usage.cost },
  }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('tool.call', (_: unknown, e: { tool: string }) => (e.tool === 'Boom' ? { deny: 'nope' } : { result: {}, text: 'ok' }))
  // The shared switches belong to the settings mod: answer them as the engine would.
  on('state.get', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'settings' && e.key === 'features') {
      return { value: { value: { shape: 'features-1', value: opt.features ?? {} }, version: 1 } }
    }

    return next(e)
  })

  return { saved, clock, usage, registered, fills, toasts, statuses, cwd: opt.cwd ?? '/proj/a' }
}

const find = (ui: any, re: RegExp, type = 'Text') => ui.find({ type, text: re })
const start = ($: any, cwd = '/proj/a') => $.session.start({ cwd, surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args, origin: 'user' } as any)) as { text: string }).text
const done = { answer: '', durationMs: 30_000, isAborted: false, turnId: 't', reason: 'answer' } as const

const NAMES = ['cu', 'cushow', 'cutile', 'cucustom', 'cutab', 'culayout', 'cuexport', 'cuimport', 'cusnip', 'cualias', 'curun', 'cutpl', 'cuvar', 'cubtn', 'custatus', 'cusprite', 'cubadge', 'cugoal', 'curule', 'curecipe', 'cutool', 'cuwarn', 'cubudget', 'cureset']

test('a session registers every command, each starts with cu, and /cu lists them one per line', async ($, on) => {
  const { registered } = engine(on)
  await start($)
  expect(registered.sort()).toEqual([...NAMES].sort())
  expect(registered.every(n => n.startsWith('cu'))).toBe(true)
  const help = await run($, 'cu')

  for (const name of registered) {
    expect(help).toMatch(new RegExp(`^/${name}[ ]`, 'm'))
  }
  expect(help).toMatch(/Not possible: dragging/)
})

test('a refused command name does not stop the session starting', async ($, on) => {
  engine(on, {}, { refuse: true })
  await start($)
  expect(await run($, 'cu')).toMatch(/^Layout kit/)
})

test('the pane opens on the dashboard with the default tiles and the five tabs', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE())

  for (const label of ['Dashboard', 'Edit', 'Library', 'Snippets', 'Rules']) {
    expect(await ui.find({ type: 'Button', text: new RegExp(label) })).toBeDefined()
  }

  for (const title of ['Tool calls', 'Errors', 'Files edited', 'Spend', 'Context', 'Elapsed', 'Todos', 'Tools']) {
    expect(await find(ui, new RegExp(`^${title}$`))).toBeDefined()
  }
  expect(await find(ui, /Everything here changes only this pane/)).toBeDefined()
  await ui.unmount()
})

test('tool calls, errors, edits, prompts, todos and spend are recorded and shown', async ($, on) => {
  const e = engine(on)
  await start($)
  e.usage.cost = { usd: 1.25 }
  e.usage.percent = 88
  await $.prompt.submit({ text: 'please fix', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/b.ts', content: 'x' })
  await $.tool.call({ tool: 'Boom' } as any)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'completed', activeForm: 'a' }, { content: 'b', status: 'pending', activeForm: 'b' }, { content: 'c', status: 'in_progress', activeForm: 'c' }] })
  await $.turn.complete(done)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await find(ui, /^6$/)).toBeDefined() // calls: Bash, Edit, Edit, Write, Boom, TodoWrite
  expect(await find(ui, /^2$/)).toBeDefined() // files
  expect(await find(ui, /^1$/)).toBeDefined() // errors (the denied call)
  expect(await find(ui, /^\$1\.25$/)).toBeDefined()
  expect(await find(ui, /^88%$/)).toBeDefined()
  expect(await find(ui, /^1\/3$/)).toBeDefined() // todos done/all
  expect(await find(ui, /^1h 30m$/)).toBeDefined()
  expect(await find(ui, /\$ Bash 1/)).toBeDefined()
  expect(await find(ui, /~ Edit 2/)).toBeDefined()
  await ui.unmount()
})

test('the record switch stops all recording', async ($, on) => {
  engine(on, {}, { features: { 'layout-kit.record': false } })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await find(ui, /Recording is switched off/)).toBeDefined()
  expect(await find(ui, /^1$/)).toBeUndefined()
  await ui.unmount()
})

test('desktop draws vector rings and bars, other surfaces keep text', async ($, on) => {
  const e = engine(on)
  await start($)
  e.usage.percent = 50
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const d = await $.ui.mount(PANE('desktop'))
  const svg = (await d.find({ type: 'Svg' })) as any
  expect(svg).toBeDefined()
  expect(svg.props.source).toMatch(/^<svg /)
  expect(svg.props.alt.length).toBeGreaterThan(0)
  await d.unmount()
  const t = await $.ui.mount(PANE('terminal'))
  expect(await t.find({ type: 'Svg' })).toBeUndefined()
  expect(await find(t, /█+░+ 50%/)).toBeDefined()
  await t.unmount()
})

test('Edit tab: Up, Down, S/M/L, Remove change the layout and it is kept', async ($, on) => {
  const e = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-edit' })
  expect(await find(ui, /Drag and drop is not possible/)).toBeDefined()
  await ui.press({ key: 'dn-calls' })
  let cfg = e.saved.lkcfg as any
  expect(cfg.pages[0].tiles.slice(0, 2).map((t: any) => t.id)).toEqual(['errors', 'calls'])
  await ui.press({ key: 'up-calls' })
  cfg = e.saved.lkcfg as any
  expect(cfg.pages[0].tiles.slice(0, 2).map((t: any) => t.id)).toEqual(['calls', 'errors'])
  await ui.press({ key: 'sz-calls-L' })
  cfg = e.saved.lkcfg as any
  expect(cfg.pages[0].tiles[0]).toEqual({ id: 'calls', size: 'L' })
  await ui.press({ key: 'rm-errors' })
  cfg = e.saved.lkcfg as any
  expect(cfg.pages[0].tiles.some((t: any) => t.id === 'errors')).toBe(false)
  await ui.press({ key: 'up-calls' }) // already first: a quiet refusal
  expect(await find(ui, /already first/)).toBeDefined()
  await ui.unmount()
})

test('Edit tab: pages can be added and deleted, up to six', async ($, on) => {
  const e = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-edit' })

  for (let i = 0; i < 7; i++) {
    await ui.press({ key: 'pg-add' })
  }
  expect((e.saved.lkcfg as any).pages.length).toBe(6)
  expect(await find(ui, /6 pages at most/)).toBeDefined()
  await ui.press({ key: 'pg-del' })
  expect((e.saved.lkcfg as any).pages.length).toBe(5)
  await ui.unmount()
})

test('Library tab: the gallery adds and removes tiles on the chosen page and pages through', async ($, on) => {
  const e = engine(on)
  await start($)
  await run($, 'cucustom', 'number bugs Bugs left | 3 open')
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-library' })
  expect(await find(ui, /^Tool calls$/)).toBeDefined()
  await ui.press({ key: 'lib-rm-calls' })
  expect((e.saved.lkcfg as any).pages[0].tiles.some((t: any) => t.id === 'calls')).toBe(false)
  await ui.press({ key: 'lib-add-calls' })
  expect((e.saved.lkcfg as any).pages[0].tiles.at(-1).id).toBe('calls')
  await ui.press({ key: 'pg-next' })
  await ui.press({ key: 'pg-next' })
  await ui.press({ key: 'pg-next' })
  expect(await find(ui, /^Bugs left$/)).toBeDefined()
  await ui.press({ key: 'lib-add-c:bugs' })
  await ui.press({ key: 'lib-plus-c:bugs' })
  expect((e.saved.lkcfg as any).defs[0].num).toBe(4)
  await ui.press({ key: 'lib-minus-c:bugs' })
  await ui.press({ key: 'lib-minus-c:bugs' })
  expect((e.saved.lkcfg as any).defs[0].num).toBe(2)
  await ui.press({ key: 'lib-del-c:bugs' })
  expect((e.saved.lkcfg as any).defs.length).toBe(0)
  expect((e.saved.lkcfg as any).pages[0].tiles.some((t: any) => t.id === 'c:bugs')).toBe(false)
  await ui.unmount()
})

test('custom tiles: a text tile, a number tile and a safe formula tile show on the dashboard', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'cucustom', 'text note Note | Ship by Friday')).toMatch(/Saved c:note/)
  expect(await run($, 'cucustom', 'number bugs Bugs | 7 open')).toMatch(/Saved c:bugs/)
  expect(await run($, 'cucustom', 'formula rate Error rate | errors / calls * 100')).toMatch(/Saved c:rate/)
  expect(await run($, 'cucustom', 'formula evil Evil | constructor')).toMatch(/Formula refused/)
  expect(await run($, 'cucustom', 'formula evil Evil | calls > 1')).toMatch(/Formula refused/)
  expect(await run($, 'cucustom', `formula deep Deep | ${'('.repeat(30)}1`)).toMatch(/Formula refused/)
  expect(await run($, 'cucustom', 'number big Big | 1e99')).toMatch(/between/)
  for (const id of ['c:note', 'c:bugs', 'c:rate']) {
    expect(await run($, 'cutile', `add ${id}`)).toMatch(/Done/)
  }
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Boom' } as any)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await find(ui, /^Ship by Friday$/)).toBeDefined()
  expect(await find(ui, /^7 open$/)).toBeDefined()
  expect(await find(ui, /^50$/)).toBeDefined() // 1 error / 2 calls * 100
  await ui.unmount()
  expect(await run($, 'cucustom', 'set bugs 9')).toMatch(/now 9/)
  expect(await run($, 'cucustom', 'rm rate')).toMatch(/Removed/)
  expect(await run($, 'cutile', 'list')).not.toMatch(/c:rate\//)
})

test('/cutile edits the page chosen with /cutab use, and refuses bad input', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'cutab', 'add Work')).toMatch(/2\. Work/)
  expect(await run($, 'cutab', 'use work')).toMatch(/Using page 2/)
  expect(await run($, 'cutile', 'add calls L')).toMatch(/calls\/L/)
  expect(await run($, 'cutile', 'add calls')).toMatch(/already/)
  expect(await run($, 'cutile', 'add nonsense')).toMatch(/No tile/)
  expect(await run($, 'cutile', 'add errors XL')).toMatch(/S, M or L/)
  expect(await run($, 'cutile', 'size calls S')).toMatch(/calls\/S/)
  expect(await run($, 'cutile', 'up calls')).toMatch(/already first/)
  expect(await run($, 'cutile', 'rm calls')).toMatch(/\(empty\)/)
  expect(await run($, 'cutile', 'frobnicate')).toMatch(/^Usage/)
  expect(await run($, 'cutab', 'rename work Deep Work')).toMatch(/Deep Work/)
  expect(await run($, 'cutab', 'rename nope X')).toMatch(/No page/)
  expect(await run($, 'cutab', 'rm 2')).toMatch(/Page removed/)
  expect(await run($, 'cutab', 'rm 1')).toMatch(/at least one/)
  expect(await run($, 'cutab', 'add bad<name')).toMatch(/page name/i)
})

test('saved layouts and one layout per project folder', async ($, on) => {
  const e = engine(on)
  await start($)
  await run($, 'cutile', 'rm calls')
  expect(await run($, 'culayout', 'save lean')).toMatch(/Saved the current layout as lean/)
  expect(await run($, 'culayout', 'project lean')).toMatch(/now open layout lean/)
  expect(await run($, 'culayout', 'list')).toMatch(/lean/)
  expect(await run($, 'culayout', 'save Bad Name')).toMatch(/one word/)
  expect(await run($, 'culayout', 'save Bad_Name')).toMatch(/Saved/) // lowercased
  expect(await run($, 'culayout', 'load ghost')).toMatch(/No saved layout/)
  await run($, 'cutile', 'add calls')
  expect(await run($, 'culayout', 'load lean')).toMatch(/Loaded lean/)
  expect(((e.saved.lkcfg as any).pages[0].tiles as any[]).some(t => t.id === 'calls')).toBe(false)
  // A new session in the bound folder opens lean even though the stored current layout has calls again.
  await run($, 'cutile', 'add calls')
  await start($, '/proj/a')
  expect(await run($, 'cutile', 'list')).not.toMatch(/calls\/S/)
  // Another folder keeps the stored layout.
  await start($, '/proj/b')
  expect(await run($, 'cutile', 'list')).toMatch(/calls\/S/)
  expect(await run($, 'culayout', 'rm lean')).toMatch(/Deleted/)
  expect(((e.saved.lkcfg as any).byProject as object) && Object.keys((e.saved.lkcfg as any).byProject).length).toBe(0)
})

test('the per-project switch turns the automatic layout off', async ($, on) => {
  engine(on, { lkcfg: { saved: { lean: [{ name: 'Lean', tiles: [{ id: 'calls', size: 'S' }] }] }, byProject: { '/proj/a': 'lean' } } }, { features: { 'layout-kit.per-project': false } })
  await start($, '/proj/a')
  expect(await run($, 'cutile', 'list')).toMatch(/Page 1 "Main"/)
})

test('export prints one line, import shows a diff and changes nothing until confirm', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'cutab', 'add Extra')
  const out = await run($, 'cuexport')
  const json = out.split('\n')[0] ?? ''
  expect(JSON.parse(json)['layout-kit']).toBe(1)
  // Another project: a fresh config, then import.
  await run($, 'cureset', 'all confirm')
  expect(await run($, 'cutab', 'list')).not.toMatch(/Extra/)
  const preview = await run($, 'cuimport', json)
  expect(preview).toMatch(/Nothing has changed yet/)
  expect(preview).toMatch(/\+ page Extra/)
  expect(await run($, 'cutab', 'list')).not.toMatch(/Extra/)
  expect(await run($, 'cuimport', 'confirm')).toMatch(/Imported/)
  expect(await run($, 'cutab', 'list')).toMatch(/Extra/)
  expect(await run($, 'cuimport', 'confirm')).toMatch(/Nothing is waiting/)
  await run($, 'cuimport', json)
  expect(await run($, 'cuimport', 'cancel')).toMatch(/cancelled/)
  expect(await run($, 'cuimport', 'confirm')).toMatch(/Nothing is waiting/)
})

test('a refused import changes nothing and says why', async ($, on) => {
  engine(on)
  await start($)
  const before = await run($, 'cutab', 'list')

  for (const bad of ['{"layout-kit":1,"pages":[{"name":"A","tiles":[{"id":"evil","size":"S"}]}]}', 'garbage', '{"layout-kit":1,"pages":[],"__proto__":{}}', '']) {
    expect(await run($, 'cuimport', bad)).toMatch(/Import refused|Paste/)
  }
  expect(await run($, 'cuimport', 'confirm')).toMatch(/Nothing is waiting/)
  expect(await run($, 'cutab', 'list')).toBe(before)
})

test('the Edit tab shows a waiting import and applies it with a button', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'cutab', 'add Extra')
  const json = (await run($, 'cuexport')).split('\n')[0] ?? ''
  await run($, 'cutab', 'rm Extra')
  await run($, 'cuimport', json)
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-edit' })
  expect(await find(ui, /An import is waiting/)).toBeDefined()
  await ui.press({ key: 'imp-yes' })
  expect(await run($, 'cutab', 'list')).toMatch(/Extra/)
  await ui.unmount()
})

test('snippets, aliases, templates and variables fill the prompt box', async ($, on) => {
  const e = engine(on)
  await start($)
  expect(await run($, 'cusnip', 'add sig Thanks,\nbest')).toMatch(/Saved snippet sig/)
  expect(await run($, 'cusnip', 'sig')).toMatch(/in the prompt box/)
  expect(e.fills.at(-1)).toBe('Thanks,\nbest')
  expect(await run($, 'cusnip', 'nope')).toMatch(/No snippet/)
  expect(await run($, 'cualias', 'add t /review src')).toMatch(/Saved alias t/)
  expect(await run($, 'curun', 't')).toMatch(/prompt box/)
  expect(e.fills.at(-1)).toBe('/review src')
  expect(await run($, 'curun', 'zzz')).toMatch(/No alias/)
  expect(await run($, 'cutpl', 'add fix Fix {1} in {file}, then {2}')).toMatch(/Saved template fix/)
  expect(await run($, 'cuvar', 'file=src/a.ts')).toMatch(/\{file\} is now set/)
  const r = await run($, 'cutpl', 'fix "the bug"')
  expect(e.fills.at(-1)).toBe('Fix the bug in src/a.ts, then ')
  expect(r).toMatch(/Not filled: \{2\}/)
  await run($, 'cutpl', 'fix a b')
  expect(e.fills.at(-1)).toBe('Fix a in src/a.ts, then b')
  expect(await run($, 'cutpl', 'nope')).toMatch(/No template/)
  expect(await run($, 'cutpl', 'add bad {Not Valid}')).toMatch(/Placeholders/)
  expect(await run($, 'cuvar', 'list')).toMatch(/file=src\/a.ts/)
  expect(await run($, 'cuvar', 'rm file')).toMatch(/Deleted/)
  expect(await run($, 'cuvar', 'Bad Name=1')).toMatch(/Usage/)
  expect(await run($, 'cusnip', 'add add x')).toMatch(/name is/)
})

test('when the prompt box cannot be reached the text is returned instead', async ($, on) => {
  engine(on, {}, { fill: false })
  await start($)
  await run($, 'cusnip', 'add a hello there')
  expect(await run($, 'cusnip', 'a')).toMatch(/Could not reach the prompt box[\s\S]*hello there/)
})

test('the Snippets tab lists, uses and deletes, with sub-tabs', async ($, on) => {
  const e = engine(on)
  await start($)
  await run($, 'cusnip', 'add sig Thanks')
  await run($, 'cualias', 'add go run the tests')
  await run($, 'cubtn', 'add Run | run the tests')
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-snippets' })
  expect(await find(ui, /^sig$/)).toBeDefined()
  await ui.press({ key: 'use-snippets-sig' })
  expect(e.fills.at(-1)).toBe('Thanks')
  await ui.press({ key: 'sub-aliases' })
  expect(await find(ui, /^go$/)).toBeDefined()
  expect(await find(ui, /cannot register new slash commands/)).toBeDefined()
  await ui.press({ key: 'sub-chips' })
  await ui.press({ key: 'use-chip-0' })
  expect(e.fills.at(-1)).toBe('run the tests')
  await ui.press({ key: 'del-chip-0' })
  expect(((e.saved.lkcfg as any).buttons as unknown[]).length).toBe(0)
  await ui.press({ key: 'sub-snippets' })
  await ui.press({ key: 'del-snippets-sig' })
  expect(Object.keys((e.saved.lkcfg as any).snippets).length).toBe(0)
  await ui.unmount()
})

test('buttons band: nothing by default, one row with a switch, and a press fills the prompt', async ($, on) => {
  const e = engine(on)
  on('ui.render', ($: any, el: any) => {
    const { Text } = $.ui.resolve(el)

    return <Text>other row</Text>
  })
  await start($)
  await run($, 'cubtn', 'add Run | run the tests')
  const off = await $.ui.mount(BAND)
  expect(await find(off, /other row/)).toBeDefined()
  expect(await off.find({ type: 'Button', text: /Run/ })).toBeUndefined()
  await off.unmount()
  expect(await run($, 'cubtn', 'list')).toMatch(/band above the prompt is OFF/)
  void e
})

test('buttons band with its switch on: other rows stay, buttons are capped at five', async ($, on) => {
  const e = engine(on, {}, { features: { 'layout-kit.buttons-band': true } })
  on('ui.render', ($: any, el: any) => {
    const { Text } = $.ui.resolve(el)

    return <Text>other row</Text>
  })
  await start($)

  for (let i = 1; i <= 6; i++) {
    await run($, 'cubtn', `add B${i} | text ${i}`)
  }
  expect(await run($, 'cubtn', 'add B7 | x')).toMatch(/5 buttons at most/)
  const band = await $.ui.mount(BAND)
  expect(await find(band, /other row/)).toBeDefined()
  await band.press({ key: 'band-1' })
  expect(e.fills.at(-1)).toBe('text 2')
  expect(await band.find({ type: 'Button', text: /B5/ })).toBeDefined()
  expect(await band.find({ type: 'Button', text: /B6/ })).toBeUndefined()
  await band.unmount()
  const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ type: 'Button', text: /B1/ })).toBeUndefined()
  await survey.unmount()
  expect(await run($, 'cubtn', 'use 3')).toMatch(/prompt box/)
  expect(e.fills.at(-1)).toBe('text 3')
  expect(await run($, 'cubtn', 'rm 1')).toMatch(/Removed B1/)
})

test('rules: off by default, then one toast when a condition turns true, throttled to one per 3 minutes', async ($, on) => {
  const off = engine(on)
  await start($)
  expect(await run($, 'curule', 'add if errors > 0 then toast "{errors} errors so far"')).toMatch(/Rule added/)
  expect(await run($, 'curule', 'list')).toMatch(/OFF/)
  await $.tool.call({ tool: 'Boom' } as any)
  await $.turn.complete(done)
  expect(off.toasts).toEqual([])
})

test('rules with the switch on: rising edge, throttle, re-arm', async ($, on) => {
  const e = engine(on, {}, { features: { 'layout-kit.rules': true } })
  await start($)
  await run($, 'curule', 'add if errors > 0 then toast "{errors} errors so far"')
  await run($, 'curule', 'add if calls >= 1 then toast "first call"')
  await $.turn.complete(done)
  expect(e.toasts).toEqual([]) // nothing true yet
  await $.tool.call({ tool: 'Boom' } as any)
  await $.turn.complete(done)
  expect(e.toasts).toEqual(['1 errors so far (+1 more)'])
  await $.turn.complete(done)
  expect(e.toasts.length).toBe(1) // still true, not a new edge
  expect(await run($, 'curule', 'off 1')).toMatch(/off/)
  await run($, 'curule', 'add if calls >= 2 then toast "two calls"')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete(done)
  expect(e.toasts.length).toBe(1) // throttled: 3 minutes have not passed
  e.clock.t += 181_000
  await $.turn.complete(done)
  expect(e.toasts).toEqual(['1 errors so far (+1 more)', 'two calls']) // fires after the quiet period, was not lost
})

test('rules: bad syntax, caps and removal', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'curule', 'add if foo > 1 then toast "x"')).toMatch(/Condition refused/)
  expect(await run($, 'curule', 'add if calls > 1 then toast "{zzz}"')).toMatch(/not a metric/)
  expect(await run($, 'curule', 'add if calls > 1 then shell "x"')).toMatch(/Usage/)
  expect(await run($, 'curule', 'rm 4')).toMatch(/No rule/)

  for (let i = 0; i < 15; i++) {
    await run($, 'curule', `add if calls > ${i} then toast "r${i}"`)
  }
  expect(await run($, 'curule', 'add if calls > 99 then toast "x"')).toMatch(/15 rules at most/)
  expect(await run($, 'curule', 'rm 1')).toMatch(/removed/)
})

test('recipes: six ready-made rules run by the same engine, toggled by command and button', async ($, on) => {
  const e = engine(on, {}, { features: { 'layout-kit.recipes': true } })
  await start($)
  expect((await run($, 'curecipe', 'list')).split('\n').filter(l => /^\[/.test(l)).length).toBe(6)
  expect(await run($, 'curecipe', 'on errors')).toMatch(/errors on/)
  expect(await run($, 'curecipe', 'on nope')).toMatch(/Usage/)
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-rules' })
  await ui.press({ key: 'sub-recipes' })
  expect(await find(ui, /^Many errors$/)).toBeDefined()
  await ui.press({ key: 'rec-t-context' })
  await ui.unmount()
  e.usage.percent = 95
  await $.turn.complete(done)
  expect(e.toasts).toEqual(['Context is 95% full: consider /compact'])
})

test('badges are earned when a turn ends, the toast is its own switch', async ($, on) => {
  const quiet = engine(on)
  await start($)
  expect(await run($, 'cubadge', '"3 calls" when calls >= 3')).toMatch(/Badge 3 calls added/)
  expect(await run($, 'cubadge', '"bad" when foo >= 3')).toMatch(/Condition refused/)
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Bash', command: 'ls' })
  }
  await $.turn.complete(done)
  expect(await run($, 'cubadge', 'list')).toMatch(/\[x\] 3 calls/)
  expect(quiet.toasts).toEqual([])
})

test('badge toast with its switch on', async ($, on) => {
  const e = engine(on, {}, { features: { 'layout-kit.badge-toasts': true } })
  await start($)
  await run($, 'cubadge', '"first" when calls >= 1')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete(done)
  await $.turn.complete(done)
  expect(e.toasts).toEqual(['Badge earned: first'])
})

test('goals show progress toward a target', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'cugoal', '"edit 4 files" files target 4')).toMatch(/Goal edit 4 files added/)
  expect(await run($, 'cugoal', '"x" files target 0')).toMatch(/target is a number/)
  await $.tool.call({ tool: 'Write', file_path: '/a', content: '' })
  await $.tool.call({ tool: 'Write', file_path: '/b', content: '' })
  expect(await run($, 'cugoal', 'list')).toMatch(/2 of 4/)
  await run($, 'cutile', 'add goals')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await find(ui, /edit 4 files █{4}░{4} 50%/)).toBeDefined()
  await ui.unmount()
  expect(await run($, 'cugoal', 'rm "edit 4 files"')).toMatch(/Removed/)
})

test('status template: only with its switch, at most one write per 15 seconds', async ($, on) => {
  const off = engine(on)
  await start($)
  expect(await run($, 'custatus', '{calls} calls, {errors} err, {spend}, {ctx}')).toMatch(/Preview: 0 calls, 0 err, \$0\.00, 10%/)
  await $.turn.complete(done)
  expect(off.statuses).toEqual([])
  expect(await run($, 'custatus', '')).toMatch(/NOT written/)
})

test('status template with the switch on writes, throttles and clears', async ($, on) => {
  const e = engine(on, {}, { features: { 'layout-kit.status-template': true } })
  await start($)
  expect(await run($, 'custatus', '{nope}')).toMatch(/not a metric/)
  await run($, 'custatus', '{calls} calls {ctx}')
  await $.turn.complete(done)
  expect(e.statuses).toEqual(['0 calls 10%'])
  e.clock.t += 5000
  await $.turn.complete(done)
  expect(e.statuses.length).toBe(1)
  e.clock.t += 11_000
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete(done)
  expect(e.statuses).toEqual(['0 calls 10%', '1 calls 10%'])
  expect(await run($, 'custatus', 'off')).toMatch(/cleared/)
  expect(e.statuses.at(-1)).toBeUndefined()
})

test('tool style: colour, glyph and friendly name apply to this pane only', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(await run($, 'cutool', 'color Bash error')).toMatch(/not the tool rows in the chat/)
  expect(await run($, 'cutool', 'glyph Bash >>')).toMatch(/Saved/)
  expect(await run($, 'cutool', 'name Bash Shell')).toMatch(/Saved/)
  expect(await run($, 'cutool', 'color Bash red')).toMatch(/Colour keys/)
  expect(await run($, 'cutool', 'color __proto__ error')).toMatch(/tool name/)
  expect(await run($, 'cutool', 'list')).toMatch(/Bash: colour error, glyph >>, name Shell/)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await find(ui, />> Shell 1/)).toBeDefined()
  await ui.unmount()
  const rules = await $.ui.mount(PANE())
  await rules.press({ key: 'tab-rules' })
  await rules.press({ key: 'sub-tools' })
  await rules.press({ key: 'tool-c-Bash' }) // cycles to the next colour key
  expect((await run($, 'cutool', 'list'))).toMatch(/colour claude/)
  await rules.press({ key: 'tool-r-Bash' })
  expect(await run($, 'cutool', 'list')).toMatch(/No tool styles/)
  await rules.unmount()
})

test('warning levels change tile colours; a project budget drives the spend tile', async ($, on) => {
  const e = engine(on)
  await start($)
  e.usage.percent = 60
  expect(await run($, 'cuwarn', 'ctx 50 70')).toMatch(/ctx: warn at 50, bad at 70/)
  expect(await run($, 'cuwarn', 'ctx 90 50')).toMatch(/Give two numbers/)
  expect(await run($, 'cuwarn', 'nope 1 2')).toMatch(/Thresholds exist/)
  expect(await run($, 'cuwarn', 'ctx 50')).toMatch(/Usage/)
  const ui = await $.ui.mount(PANE('terminal'))
  const ctxTile = (await ui.find({ type: 'Text', text: /^60%$/ })) as any
  expect(ctxTile.props.color).toBe('warning')
  await ui.unmount()
  expect(await run($, 'cuwarn', 'reset')).toMatch(/reset/)
  e.usage.cost = { usd: 4.5 }
  expect(await run($, 'cubudget', '5')).toMatch(/\$5\.00/)
  expect(await run($, 'cubudget', '')).toMatch(/budget of \$5\.00/)
  await run($, 'cutile', 'add budget')
  const b = await $.ui.mount(PANE('terminal'))
  expect(await find(b, /^\$4\.50 \/ \$5\.00$/)).toBeDefined()
  expect(await find(b, /^of \$5\.00 budget$/)).toBeDefined()
  expect((((await b.find({ type: 'Text', text: /^\$4\.50$/ })) as any).props.color)).toBe('warning')
  await b.unmount()
  // a budget belongs to the folder: another folder has none
  await start($, '/proj/b')
  expect(await run($, 'cubudget', '')).toMatch(/No budget/)
  expect(await run($, 'cubudget', '-3')).toMatch(/from 0\.01/)
  expect(await run($, 'cubudget', 'abc')).toMatch(/from 0\.01/)
  expect(await run($, 'cubudget', 'off')).toMatch(/cleared/)
})

test('sprite: presets, custom lines, limits, and it shows as a tile', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'cusprite', 'preset cat')).toMatch(/Sprite saved/)
  expect(await run($, 'cusprite', 'preset dog')).toMatch(/Presets/)
  expect(await run($, 'cusprite', 'a|b|c|d|e|f')).toMatch(/1 to 5 lines/)
  expect(await run($, 'cusprite', `${'x'.repeat(13)}`)).toMatch(/at most 12/)
  expect(await run($, 'cusprite', '[^_^]| /|\\ |  |')).toMatch(/Sprite saved/)
  await run($, 'cutile', 'add sprite')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await find(ui, /\[\^_\^\]/)).toBeDefined()
  await ui.unmount()
  expect(await run($, 'cusprite', 'clear')).toMatch(/cleared/)
})

test('reset clears the counters but keeps settings; reset all needs confirm', async ($, on) => {
  const e = engine(on)
  await start($)
  await run($, 'cusnip', 'add a hello')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(await run($, 'cureset')).toMatch(/Your settings are kept/)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await find(ui, /^1$/)).toBeUndefined()
  await ui.unmount()
  expect(Object.keys((e.saved.lkcfg as any).snippets)).toEqual(['a'])
  expect(await run($, 'cureset', 'all')).toMatch(/confirm/)
  expect(Object.keys((e.saved.lkcfg as any).snippets)).toEqual(['a'])
  expect(await run($, 'cureset', 'all confirm')).toMatch(/AND all of your settings/)
  expect(Object.keys((e.saved.lkcfg as any).snippets)).toEqual([])
})

test('a damaged saved config is cleaned on load and the mod still starts', async ($, on) => {
  engine(on, { lkcfg: { pages: 'x', defs: [{ id: 'a', kind: 'formula', label: 'x', expr: 'eval(1)' }], snippets: { __proto__: 'x', ok: 'fine' }, thr: { ctx: [9, 1] } } })
  await start($)
  expect(await run($, 'cutile', 'list')).toMatch(/Page 1 "Main"/)
  expect(await run($, 'cusnip', 'list')).toBe('ok: fine')
  expect(await run($, 'cuwarn', 'list')).toMatch(/ctx: warn at 70, bad at 85/)
})

test('hostile command arguments are refused politely and never throw', async ($, on) => {
  engine(on)
  await start($)
  const hostile = ['__proto__', 'constructor', '{"a":1}', '"""', '\u0000', 'x'.repeat(5000), '(((((((((((((', '-'.repeat(200), '😀😀😀', 'add', 'rm', 'rm rm rm', 'set', '|', 'add |', 'if then toast', '= = =']

  for (const name of NAMES) {
    for (const h of hostile) {
      const t = await run($, name, h)
      expect(typeof t).toBe('string')
    }
  }
  expect(({} as Record<string, unknown>).x).toBeUndefined()
  // and the pane still draws on every tab after all that
  const ui = await $.ui.mount(PANE())

  for (const tab of ['tab-edit', 'tab-library', 'tab-snippets', 'tab-rules', 'tab-dashboard']) {
    await ui.press({ key: tab })
    expect(await find(ui, /Everything here changes only this pane/)).toBeDefined()
  }
  await ui.unmount()
})

test('/cushow opens the pane on a tab', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'cushow', 'library')).toMatch(/on Library/)
  expect(await run($, 'cushow', 'nope')).toMatch(/Tabs:/)
  const ui = await $.ui.mount(PANE())
  expect(await find(ui, /Tile gallery/)).toBeDefined()
  await ui.unmount()
})
