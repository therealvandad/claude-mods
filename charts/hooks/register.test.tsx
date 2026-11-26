import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'charts',
  component: 'Pane',
  requestId: 'charts-main',
  surface: 'desktop',
  props: { title: 'Charts', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type Usage = { cost?: { usd: number }; percent?: number; limits?: { kind: string; percentUsed: number }[] }

// Stands in for the engine. `clock.t` and `usage` are moved by each test.
const engine = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}, opt: { refuse?: boolean; tool?: (e: { tool: string }) => unknown } = {}) => {
  const saved: Record<string, unknown> = { ...init }
  const clock = { t: new Date(2026, 10, 25, 12, 0, 0).getTime() }
  const usage: Usage = { cost: { usd: 0 }, percent: 10, limits: [] }
  const registered: string[] = []
  const opened: string[] = []

  on('clock.now', () => ({ value: clock.t }))
  on('command.register', (_: unknown, e: { name: string }) => {
    if (opt.refuse === true) {
      throw new Error('name taken')
    }
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: clock.t - 600_000, context: { window: 1000, percent: usage.percent ?? null }, rateLimits: usage.limits ?? [], cost: usage.cost },
  }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('tool.call', (_: unknown, e: { tool: string }) => (opt.tool === undefined ? { result: {}, text: 'ok' } : opt.tool(e)))

  return { saved, clock, usage, registered, opened }
}

// Rows are drawn with non-breaking spaces so they keep their shape: a space in a pattern matches either.
const find = (ui: any, re: RegExp) => ui.find({ type: 'Text', text: new RegExp(re.source.replace(/ /g, '\\s'), re.flags) })
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args, origin: 'user' } as any)) as { text: string }).text
const done = { answer: '', durationMs: 30_000, isAborted: false, turnId: 't', reason: 'answer' } as const

test('a session registers every command, and /ch lists them one per line', async ($, on) => {
  const { registered } = engine(on)
  await start($)
  expect(registered.sort()).toEqual(['ch', 'chbudget', 'chdemo', 'chdonut', 'chreset', 'chshow', 'chsprint', 'chtodo'])
  const help = await run($, 'ch')

  for (const name of registered) {
    expect(help).toMatch(new RegExp(`^/${name}[ ]`, 'm'))
  }
})

test('a refused command name does not stop the session starting', async ($, on) => {
  engine(on, {}, { refuse: true })
  await start($)
  expect(await run($, 'ch')).toMatch(/^Charts:/)
})

test('the pane opens on the donut gauges, groups and charts switch the body', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  expect(await find(ui, /^Donut gauges$/)).toBeDefined()
  expect(await find(ui, /^Duration against output size$/)).toBeUndefined()

  await ui.press({ key: 'grp-tools' })
  expect(await find(ui, /^Tool mix$/)).toBeDefined()
  await ui.press({ key: 'ch-scatter' })
  expect(await find(ui, /^Duration against output size$/)).toBeDefined()

  for (const [group, chart, title] of [
    ['grp-time', 'ch-gantt', /^Gantt strip of tool calls$/],
    ['grp-files', 'ch-tree', /^Treemap of files touched$/],
    ['grp-plan', 'ch-burn', /^Todo burndown$/],
    ['grp-gauges', 'ch-radar', /^Session health$/],
  ] as const) {
    await ui.press({ key: group })
    await ui.press({ key: chart })
    expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
  }
  await ui.unmount()
})

test('every one of the twenty charts can be picked from the pane', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  let seen = 0

  for (const group of ['gauges', 'tools', 'time', 'files', 'plan']) {
    await ui.press({ key: `grp-${group}` })

    for (const id of ['donut', 'clock', 'bullet', 'radar', 'waffle', 'stack', 'spark', 'scatter', 'flow', 'gantt', 'flame', 'minimap', 'timeline', 'heat', 'tree', 'deps', 'diff', 'sprints', 'burn', 'cfd']) {
      const btn = await ui.find({ type: 'Button', key: `ch-${id}` }).catch(() => undefined)

      if (btn !== undefined) {
        await ui.press({ key: `ch-${id}` })
        seen += 1
      }
    }
  }
  expect(seen).toBe(20)
  await ui.unmount()
})

test('tool calls are recorded: the mix, the waffle and the edited file show up', async ($, on) => {
  engine(on, {}, { tool: e => (e.tool === 'Bash' ? { isError: true, result: 'exit 1', text: 'boom' } : { result: {}, text: 'ok' }) })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/app/src/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/app/src/a.ts', old_string: 'x', new_string: "import { b } from './b'\nconst y = 1" })
  await $.tool.call({ tool: 'Bash', command: 'npm test --secret=hunter2' })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'grp-tools' })
  await ui.press({ key: 'ch-stack' })
  expect(await find(ui, /3\scalls in all/)).toBeDefined()
  await ui.press({ key: 'grp-gauges' })
  await ui.press({ key: 'ch-waffle' })
  expect(await find(ui, /error\s+1\s\(33%\)/)).toBeDefined()
  await ui.press({ key: 'grp-files' })
  await ui.press({ key: 'ch-tree' })
  expect(await find(ui, /a\.ts\sx1/)).toBeDefined()
  await ui.press({ key: 'ch-deps' })
  expect(await find(ui, /\.\/b/)).toBeDefined()
  await ui.press({ key: 'grp-time' })
  await ui.press({ key: 'ch-gantt' })
  expect(await find(ui, /Bash/)).toBeDefined()
  // the secret on the command line is not kept anywhere the charts can show it
  expect(await find(ui, /hunter2/)).toBeUndefined()
  await ui.unmount()
})

test('a turn takes a context and spend reading, shown on the rings', async ($, on) => {
  const { usage } = engine(on)
  await start($)
  usage.cost = { usd: 2.5 }
  usage.percent = 63
  usage.limits = [{ kind: 'five_hour', percentUsed: 41 }]
  await $.turn.complete(done)
  await run($, 'chbudget', '5')

  const ui = await $.ui.mount(PANE)
  expect(await find(ui, /63%/)).toBeDefined()
  expect(await find(ui, /50%/)).toBeDefined()
  expect(await find(ui, /41%/)).toBeDefined()
  await ui.unmount()
})

test('prompts are counted by length only and feed the hour clock and the heatmap, which persist', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await $.prompt.submit({ text: 'please fix the parser', wait: false, origin: { kind: 'composer' } })
  const hours = saved.chhours as number[]
  expect(hours[12]).toBe(1)
  expect(hours.reduce((a, b) => a + b, 0)).toBe(1)
  expect(saved.chdays).toEqual({ '2026-11-25': { n: 1, usd: 0 } })
  expect(JSON.stringify(saved)).not.toContain('parser')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'grp-time' })
  await ui.press({ key: 'ch-heat' })
  expect(await find(ui, /1 in 90 days, 1 active/)).toBeDefined()
  await ui.press({ key: 'grp-gauges' })
  await ui.press({ key: 'ch-clock' })
  expect(await find(ui, /1 events/)).toBeDefined()
  await ui.unmount()
})

test('counters saved by an earlier session load when a session starts', async ($, on) => {
  const hours = Array.from({ length: 24 }, () => 0)
  hours[9] = 7
  engine(on, { chdays: { '2026-11-24': { n: 12, usd: 1 }, '2026-11-25': { n: 3, usd: 0.5 } }, chhours: hours })
  await start($)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'grp-time' })
  await ui.press({ key: 'ch-heat' })
  expect(await find(ui, /15 in 90 days, 2 active, best 12/)).toBeDefined()
  await ui.press({ key: 'grp-gauges' })
  await ui.press({ key: 'ch-clock' })
  expect(await find(ui, /09:00/)).toBeDefined()
  await ui.unmount()
})

test('garbage in the store is ignored and the old days are cut to ninety', async ($, on) => {
  engine(on, {
    chdays: { 'not a day': { n: 5 }, '2026-01-01': 'x', '2026-02-02': { n: 3, usd: 'a' } },
    chhours: ['a', -3, 5],
    chsprints: [{ at: 'x' }, 7, { at: 1, min: 25, label: 'ok' }],
    chtodos: [{ id: 'a' }, { id: 1, text: 'fine' }],
    chtodoev: [{ t: 1, id: 1, to: 'open' }, { t: 1, id: 1, to: 'bogus' }],
    chbudget: 'lots',
  })
  await start($)
  expect(await run($, 'chtodo', 'list')).toBe('#1 [ ] fine')
  expect(await run($, 'chbudget')).toMatch(/No budget set/)
})

test('/chdemo fills every chart with sample data without touching the real data', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  expect(await find(ui, /DEMO DATA/)).toBeUndefined()
  await ui.press({ key: 'grp-tools' })
  await ui.press({ key: 'ch-stack' })
  expect(await find(ui, /No tool calls yet/)).toBeDefined()

  expect(await run($, 'chdemo')).toMatch(/Demo on/)
  expect(await find(ui, /DEMO DATA/)).toBeDefined()
  expect(await find(ui, /No tool calls yet/)).toBeUndefined()
  expect(await find(ui, /\d+\scalls in all/)).toBeDefined()
  expect(saved.chdays).toBeUndefined()

  await ui.press({ key: 'demo-toggle' })
  expect(await find(ui, /DEMO DATA/)).toBeUndefined()
  expect(await run($, 'chdemo', 'on')).toMatch(/Demo on/)
  expect(await run($, 'chdemo', 'off')).toMatch(/Demo off/)
  await ui.unmount()
})

test('/chshow opens the pane on a chart, a group or says what exists', async ($, on) => {
  const { opened } = engine(on)
  await start($)
  expect(await run($, 'chshow')).toBe('Charts opened.')
  expect(await run($, 'chshow', 'gantt')).toBe('Charts opened on gantt.')
  expect(await run($, 'chshow', 'Treemap')).toBe('Charts opened on tree.')
  expect(await run($, 'chshow', 'plan')).toBe('Charts opened on sprints.')
  expect(await run($, 'chshow', 'bogus')).toMatch(/No chart "bogus"\. Charts: donut, clock/)
  expect(await run($, 'chdonut')).toBe('Gauges opened.')
  expect(opened.every(id => id === 'charts-main')).toBe(true)
  expect(opened.length).toBe(5)

  const ui = await $.ui.mount(PANE)
  expect(await find(ui, /^Donut gauges$/)).toBeDefined()
  await ui.unmount()
})

test('/chbudget sets, shows and clears the target and the bullet chart uses it', async ($, on) => {
  const { saved, usage } = engine(on)
  await start($)
  usage.cost = { usd: 3 }
  await $.turn.complete(done)
  expect(await run($, 'chbudget', 'lots')).toMatch(/Usage/)
  expect(await run($, 'chbudget', '$5')).toBe('Budget set to $5.00. See Gauges > Budget.')
  expect(saved.chbudget).toBe(5)
  expect(await run($, 'chbudget')).toBe('Budget is $5.00.')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'ch-bullet' })
  expect(await find(ui, /\$3\.00\s\/\s\$5\.00/)).toBeDefined()
  await ui.unmount()
  expect(await run($, 'chbudget', 'off')).toBe('Budget cleared.')
  expect(saved.chbudget).toBeNull()
})

test('/chsprint logs a sprint and the calendar shows it', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  expect(await run($, 'chsprint', 'soon')).toMatch(/Usage/)
  expect(await run($, 'chsprint', '25 write the parser')).toBe('Logged 25 min: write the parser. See Plan > Sprints.')
  expect(saved.chsprints).toEqual([{ at: new Date(2026, 10, 25, 12).getTime(), min: 25, label: 'write the parser' }])
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'grp-plan' })
  await ui.press({ key: 'ch-sprints' })
  expect(await find(ui, /\[25\]●/)).toBeDefined()
  expect(await find(ui, /25m/)).toBeDefined()
  await ui.unmount()
})

test('/chtodo feeds the burndown and the flow strip, and survives a new session', async ($, on) => {
  const { saved, clock } = engine(on)
  await start($)
  clock.t -= 3_600_000
  expect(await run($, 'chtodo', 'add first')).toBe('Todo #1 added.')
  expect(await run($, 'chtodo', 'add second')).toBe('Todo #2 added.')
  clock.t += 1_800_000
  expect(await run($, 'chtodo', 'doing 1')).toBe('#1 is now doing.')
  clock.t += 1_800_000
  expect(await run($, 'chtodo', 'done 1')).toBe('#1 is now done.')
  expect((saved.chtodoev as unknown[]).length).toBe(4)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'grp-plan' })
  await ui.press({ key: 'ch-burn' })
  expect(await find(ui, /remaining\s1,\sdone\s1/)).toBeDefined()
  await ui.press({ key: 'ch-cfd' })
  expect(await find(ui, /done\s1/)).toBeDefined()
  await ui.unmount()

  // a later session starts from what was stored
  await run($, 'chreset', 'session')
  await start($)
  expect(await run($, 'chtodo', 'list')).toBe('#1 [x] first\n#2 [ ] second')
})

test('/chreset clears what was recorded, /chreset session keeps the personal logs', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'chbudget', '4')
  await run($, 'chsprint', '25 focus')
  await run($, 'chtodo', 'add keep me')
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })

  expect(await run($, 'chreset', 'session')).toMatch(/Cleared this session/)
  expect(saved.chsprints).toHaveLength(1)
  expect(saved.chbudget).toBe(4)
  expect((saved.chdays as Record<string, unknown>)['2026-11-25']).toBeDefined()
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'grp-tools' })
  await ui.press({ key: 'ch-stack' })
  expect(await find(ui, /No tool calls yet/)).toBeDefined()

  expect(await run($, 'chreset')).toMatch(/Cleared everything/)
  expect(saved.chsprints).toEqual([])
  expect(saved.chtodos).toEqual([])
  expect(saved.chtodoev).toEqual([])
  expect(saved.chdays).toEqual({})
  expect(saved.chbudget).toBeNull()
  expect((saved.chhours as number[]).every(n => n === 0) || (saved.chhours as number[]).length === 0).toBe(true)
  expect(await run($, 'chtodo', 'list')).toMatch(/No todos/)
  await ui.unmount()
})

test('what is recorded is bounded', async ($, on) => {
  engine(on)
  await start($)

  for (let i = 0; i < 230; i += 1) {
    await $.tool.call({ tool: 'Read', file_path: `/f${i}.ts` })
  }
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'grp-tools' })
  await ui.press({ key: 'ch-stack' })
  expect(await find(ui, /200\scalls in all/)).toBeDefined()
  await ui.unmount()
})

const settings = (on: (...args: any[]) => unknown, values: Record<string, string>) =>
  on('state.get', (_: unknown, e: any, next: any) =>
    e.plugin === 'settings' && e.key in values ? { value: { value: values[e.key], version: 1 } } : next(e),
  )
const kids = (node: any): any[] => node?.children ?? []

test('the shared settings change the glyphs, the colour and the spacing', async ($, on) => {
  const { usage } = engine(on)
  settings(on, { icons: 'letters', accent: 'claude', density: 'compact' })
  await start($)
  usage.percent = 55
  await $.turn.complete(done)
  const ui = await $.ui.mount(PANE)
  expect(await find(ui, /◜/)).toBeUndefined()
  expect(await find(ui, /window/)).toBeDefined()
  const row: any = await find(ui, /55%/)
  expect(kids(row).find((c: any) => c.children?.join('').includes('55%'))?.props.color).toBe('claude')
  expect((await ui.find({ type: 'Box' }))?.props.padding).toBe('xs')
  await ui.unmount()
})

test('airy density and the minimal pack read the same way', async ($, on) => {
  engine(on)
  settings(on, { icons: 'minimal', density: 'airy' })
  await start($)
  const ui = await $.ui.mount(PANE)
  expect(await find(ui, /╭/)).toBeDefined()
  expect(await find(ui, /◜/)).toBeUndefined()
  expect((await ui.find({ type: 'Box' }))?.props.padding).toBe('md')
  await ui.unmount()
})

test('with the settings mod absent the defaults draw the symbols pack', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  expect(await find(ui, /◜/)).toBeDefined()
  await ui.unmount()
})

test('a tool that throws is still recorded as failed and the error passes through', async ($, on) => {
  engine(on, {}, {
    tool: () => {
      throw new Error('exploded')
    },
  })
  await start($)
  await expect($.tool.call({ tool: 'Bash', command: 'x' })).rejects.toThrow()
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'grp-gauges' })
  await ui.press({ key: 'ch-waffle' })
  expect(await find(ui, /error\s+1\s\(100%\)/)).toBeDefined()
  await ui.unmount()
})

test('no band, no status line and no toast: the mod only draws its own pane', async ($, on) => {
  engine(on)
  let toasts = 0
  on('ui.toast', () => {
    toasts += 1

    return { value: undefined }
  })
  on('ui.status', () => {
    toasts += 1

    return { value: undefined }
  })
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await $.turn.complete(done)
  const band = await $.ui.mount({
    plugin: 'charts',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 80, scroll: { offset: 0, bodyRows: 5 }, view: {} },
  })
  expect(await find(band, /engine row/)).toBeDefined()
  await band.unmount()
  expect(toasts).toBe(0)
})
