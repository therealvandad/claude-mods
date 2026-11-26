import { expect, mock, test } from 'claude-code/testing'

import {
  COMMANDS,
  DEFAULTS,
  LEGEND,
  LONG_LINES,
  chipText,
  clampWidth,
  countLines,
  diffRows,
  errorLine,
  exactTime,
  fenceLanguages,
  fitMiddle,
  helpText,
  isCompact,
  longOutput,
  normSettings,
  paneId,
  parseSplitArgs,
  parseSwitch,
  pathLabel,
  relTime,
  tune,
  useTwoCols,
  whenText,
  withSticky,
} from './pure'

// ------------------------------------------------------------- pure helpers

test('path cuts: short, mid and full, then fitted in the middle', async () => {
  const p = '/Users/me/app/src/deep/file.ts'
  expect(pathLabel(p, 'short')).toBe('file.ts')
  expect(pathLabel(p, 'mid')).toBe('…/deep/file.ts')
  expect(pathLabel(p, 'full')).toBe(p)
  expect(pathLabel('/a/b.ts', 'mid')).toBe('a/b.ts')
  expect(pathLabel('file.ts', 'mid')).toBe('file.ts')
  expect(pathLabel('/', 'short')).toBe('/')
  expect(fitMiddle('abcdefghij', 6)).toBe('abc…ij')
  expect(fitMiddle('abc', 6)).toBe('abc')
  expect(fitMiddle('abcdef', 1)).toBe('…')
  expect(pathLabel(p, 'full', 12).length).toBe(12)
})

test('relative times carry the exact moment', async () => {
  const now = new Date(2026, 4, 10, 14, 30, 0).getTime()
  expect(relTime(now - 1000, now)).toBe('just now')
  expect(relTime(now - 12_000, now)).toBe('12s ago')
  expect(relTime(now - 5 * 60_000, now)).toBe('5m ago')
  expect(relTime(now - 3 * 3_600_000, now)).toBe('3h ago')
  expect(relTime(now - 2 * 86_400_000, now)).toBe('2d ago')
  expect(relTime(now - 40 * 86_400_000, now)).toBe('2026-03-31')
  expect(relTime(now + 5000, now)).toBe('just now')
  expect(exactTime(new Date(2026, 4, 10, 9, 5, 7).getTime(), now)).toBe('09:05:07')
  expect(exactTime(new Date(2026, 4, 8, 9, 5, 7).getTime(), now)).toBe('2026-05-08 09:05')
  expect(whenText(now - 5 * 60_000, now, true)).toBe('5m ago (14:25:00)')
  expect(whenText(now - 5 * 60_000, now, false)).toBe('5m ago')
})

test('code-fence languages are found once each', async () => {
  const text = 'Intro\n```ts\nlet a\n```\ntext\n```python\nx\n```\n```TS\nagain\n```\n```\nplain\n```\n  ~~~rust\nfn\n~~~'
  expect(fenceLanguages(text)).toEqual(['ts', 'python', 'rust'])
  expect(fenceLanguages('no code here')).toEqual([])
  expect(chipText('symbols', 'ts')).toBe('‹ts›')
  expect(chipText('letters', 'ts')).toBe('[ts]')
  expect(chipText('minimal', 'ts')).toBe('ts')
})

test('long output counts lines past the threshold only', async () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')
  expect(longOutput('Bash', { stdout: lines(LONG_LINES), stderr: '' })).toBeNull()
  expect(longOutput('Bash', { stdout: lines(LONG_LINES + 1), stderr: '' })?.lines).toBe(LONG_LINES + 1)
  expect(longOutput('Read', { file: { content: lines(340) } })?.lines).toBe(340)
  expect(longOutput('Bash', { stdout: '', stderr: '' })).toBeNull()
  expect(countLines('a\nb\n')).toBe(2)
})

test('the error line skips colour codes and blanks', async () => {
  expect(errorLine('\u001b[31m\n  \nBoom: it broke\nmore')).toBe('Boom: it broke')
  expect(errorLine({ stderr: 'x'.repeat(300) }, 20).length).toBe(20)
  expect(errorLine(undefined)).toBe('')
})

test('settings are normalised and switches parse', async () => {
  expect(normSettings(undefined)).toEqual(DEFAULTS)
  expect(normSettings({ zen: true, icons: 'nope', width: 10, cols: '2', path: 'full' })).toEqual({ ...DEFAULTS, zen: true, width: 40, cols: '2', path: 'full' })
  expect(normSettings({ width: 9999 }).width).toBe(240)
  expect(clampWidth(-3)).toBe(0)
  expect(clampWidth(NaN)).toBe(0)
  expect(parseSwitch('on', false)).toBe(true)
  expect(parseSwitch('off', true)).toBe(false)
  expect(parseSwitch('', true)).toBe(false)
  expect(parseSwitch('maybe', true)).toBeNull()
  expect(paneId('main')).toBe('layout-main')
  expect(paneId('layout-note')).toBe('layout-note')
  expect(paneId('other')).toBeNull()
})

test('compact, two columns and per-surface tuning', async () => {
  expect(isCompact('auto', 80, 30)).toBe(false)
  expect(isCompact('auto', 50, 30)).toBe(true)
  expect(isCompact('auto', 80, 12)).toBe(true)
  expect(isCompact('on', 200, 80)).toBe(true)
  expect(isCompact('off', 20, 5)).toBe(false)
  expect(useTwoCols('auto', 99)).toBe(false)
  expect(useTwoCols('auto', 100)).toBe(true)
  expect(useTwoCols('1', 300)).toBe(false)
  expect(useTwoCols('2', 30)).toBe(true)
  expect(tune('terminal').hotkeys).toBe(true)
  expect(tune('terminal').sizes).toBe(false)
  expect(tune('mobile').hotkeys).toBe(false)
  expect(tune('desktop').pad).toBe(1)
  expect(tune('whatever').surface).toBe('terminal')
})

test('a split diff aligns equal lines and pairs changed ones', async () => {
  const rows = diffRows(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd', 'e'])
  expect(rows.map(r => r.kind)).toEqual(['same', 'chg', 'same', 'same', 'add'])
  expect(rows[1]).toEqual({ kind: 'chg', l: 'b', r: 'B' })
  expect(diffRows(['x'], []).map(r => r.kind)).toEqual(['del'])
  expect(diffRows([], [])).toEqual([])
  // A moved block stays aligned on the longest common run.
  expect(diffRows(['1', '2', '3'], ['2', '3']).map(r => r.kind)).toEqual(['del', 'same', 'same'])
})

test('split arguments divide on the first bar', async () => {
  expect(parseSplitArgs('left | right')).toEqual({ a: 'left', b: 'right' })
  expect(parseSplitArgs('a\\nb | c\\|d')).toEqual({ a: 'a\nb', b: 'c|d' })
  expect(parseSplitArgs('a \\| b | c')).toEqual({ a: 'a | b', b: 'c' })
  expect(parseSplitArgs('no bar')).toBeNull()
})

test('a sticky header takes the first row of the window', async () => {
  const items = [
    { id: 'h1', isHeader: true },
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'h2', isHeader: true },
    { id: 'd' },
    { id: 'e' },
  ]
  // Two tree rows (tabs, subtitle) sit above the items.
  expect(withSticky(items, 0, 2).map(i => i.id)).toEqual(items.map(i => i.id))
  expect(withSticky(items, 2, 2).map(i => i.id)).toEqual(items.map(i => i.id))
  const scrolled = withSticky(items, 5, 2)
  expect(scrolled.map(i => i.id)).toEqual(['h1', 'a', 'b', 'h1', 'c', 'h2', 'd', 'e'])
  expect(scrolled[3]).toMatchObject({ id: 'h1', isSticky: true })
  // A header already at the top of the window is not doubled.
  expect(withSticky(items, 6, 2).map(i => i.id)).toEqual(items.map(i => i.id))
  // Past the end, or before any header, nothing changes.
  expect(withSticky(items, 99, 2).length).toBe(items.length)
  expect(withSticky([{ id: 'x' }, { id: 'y' }] as any[], 2, 0).length).toBe(2)
  const second = withSticky(items, 8, 2)
  expect(second[6]).toMatchObject({ id: 'h2', isSticky: true })
})

test('every command is listed once, with the ly prefix', async () => {
  const names = COMMANDS.map(c => c.name)
  expect(new Set(names).size).toBe(names.length)
  expect(names.every(n => n === 'ly' || n.startsWith('ly'))).toBe(true)
  expect(helpText().split('\n').length).toBe(COMMANDS.length + 1)
  expect(LEGEND.length).toBe(23)
})

// ------------------------------------------------------------- engine tests

const engine = (on: any, opened: { id: string; title?: string; placement?: string }[] = []) => {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', (_: unknown, e: any) => {
    opened.push({ id: e.id, title: e.title, placement: e.placement })

    return { value: { isPlaced: true } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  mock.clock(on, { now: new Date(2026, 4, 10, 14, 30, 0).getTime() })
  mock.store(on)

  return opened
}

const VIEWPORT = { columns: 120, rows: 40 } as const

const PANE = (id: string, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', props: Record<string, unknown> = {}, viewport: { columns: number; rows: number } = VIEWPORT) =>
  ({
    plugin: 'layout',
    component: 'Pane',
    requestId: id,
    surface,
    viewport,
    props: { title: id, isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {}, ...props },
  }) as any

const say = async ($: any, command: string, args = '') =>
  (await $.command.run({ command, args, origin: 'user' } as any)).text as string

test('/ly lists every command and the registration names them all', async ($, on) => {
  const registered: string[] = []
  on('command.register', (_: unknown, e: any) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  mock.clock(on, { now: 1000 })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(registered.sort()).toEqual(COMMANDS.map(c => c.name).sort())
  const text = await say($, 'ly')
  for (const c of COMMANDS) {
    expect(text).toContain(`/${c.name}`)
  }
})

test('layout-main draws on every surface, on every tab', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const tab of ['settings', 'legend', 'recent', 'surface', 'commands']) {
      await say($, 'lymain', tab)
      const ui = await $.ui.mount(PANE('layout-main', surface))
      expect(await ui.find({ type: 'Button', key: `tab:${tab}` })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('per-surface tuning: hotkeys on the terminal, none on mobile; sizes where the surface has them', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await say($, 'lymain', 'settings')

  const terminal = await $.ui.mount(PANE('layout-main', 'terminal'))
  expect((await terminal.find({ type: 'Button', key: 'set:zen' }))?.props.hotkey).toBe('z')
  expect((await terminal.find({ type: 'Text', text: /terminal · 60 cols/ }))?.props.size).toBeUndefined()
  await terminal.unmount()

  const mobile = await $.ui.mount(PANE('layout-main', 'mobile'))
  expect((await mobile.find({ type: 'Button', key: 'set:zen' }))?.props.hotkey).toBeUndefined()
  expect((await mobile.find({ type: 'Text', text: /mobile · 60 cols/ }))?.props.size).toBe('footnote')
  await mobile.unmount()

  await say($, 'lymain', 'surface')
  const desk = await $.ui.mount(PANE('layout-main', 'desktop'))
  expect((await desk.find({ type: 'Text', text: /hotkeys on · sizes on · pad 1/ }))).toBeDefined()
  expect((await desk.find({ type: 'Text', text: /touch only/ }))).toBeUndefined()
  await desk.unmount()
  const phone = await $.ui.mount(PANE('layout-main', 'mobile'))
  expect((await phone.find({ type: 'Text', text: /touch only, no hotkeys/ }))).toBeDefined()
  await phone.unmount()
})

test('two columns on wide panes, compact on small windows', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await say($, 'lymain', 'settings')

  const narrow = await $.ui.mount(PANE('layout-main', 'terminal', { bodyColumns: 70 }))
  expect(await narrow.find({ type: 'Text', text: /1-col · roomy/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /every command/ })).toBeUndefined()
  await narrow.unmount()

  const wide = await $.ui.mount(PANE('layout-main', 'terminal', { bodyColumns: 120 }))
  expect(await wide.find({ type: 'Text', text: /2-col/ })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: /every command/ })).toBeDefined()
  await wide.unmount()

  await say($, 'lycols', '1')
  const forcedOne = await $.ui.mount(PANE('layout-main', 'terminal', { bodyColumns: 120 }))
  expect(await forcedOne.find({ type: 'Text', text: /1-col/ })).toBeDefined()
  await forcedOne.unmount()
  await say($, 'lycols', 'auto')

  // A small window drops the subtitle and shortens the tab labels.
  const small = await $.ui.mount(PANE('layout-main', 'terminal', { bodyColumns: 36 }, { columns: 40, rows: 12 }))
  expect(await small.find({ type: 'Text', text: /· roomy|· compact/ })).toBeUndefined()
  expect((await small.find({ type: 'Button', key: 'tab:settings' }))?.text).toContain('Set')
  await small.unmount()
})

test('buttons change settings, and they are kept across sessions', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await say($, 'lymain', 'settings')

  const ui = await $.ui.mount(PANE('layout-main', 'desktop'))
  expect((await ui.find({ type: 'Button', key: 'set:icons' }))?.props.label).toBe('symbols')
  await ui.press({ key: 'set:icons' })
  expect((await ui.find({ type: 'Button', key: 'set:icons' }))?.props.label).toBe('minimal')
  await ui.press({ key: 'set:stripes' })
  expect((await ui.find({ type: 'Button', key: 'set:stripes' }))?.props.label).toBe('off')
  await ui.press({ key: 'set:width' })
  expect((await ui.find({ type: 'Button', key: 'set:width' }))?.props.label).toBe('80')
  await ui.unmount()

  // A later session reads what the store holds.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount(PANE('layout-main', 'desktop'))
  expect((await again.find({ type: 'Button', key: 'set:icons' }))?.props.label).toBe('minimal')
  expect((await again.find({ type: 'Button', key: 'set:stripes' }))?.props.label).toBe('off')
  await again.unmount()

  expect(await say($, 'lyicons', 'letters')).toBe('icons is now letters.')
  expect(await say($, 'lyicons', 'bogus')).toContain('Unknown value')
  expect(await say($, 'lypath', 'short')).toBe('path is now short.')
  expect(await say($, 'lystripe', 'on')).toBe('stripes is now on.')
})

test('collapsed sections are remembered', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await say($, 'lymain', 'settings')

  const ui = await $.ui.mount(PANE('layout-main', 'terminal'))
  expect(await ui.find({ type: 'Button', key: 'set:zen' })).toBeDefined()
  await ui.press({ key: 'fold:set:display' })
  expect(await ui.find({ type: 'Button', key: 'set:zen' })).toBeUndefined()
  await ui.unmount()

  // Reloaded: the section is still folded, and the transcript section is not.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount(PANE('layout-main', 'desktop'))
  expect(await again.find({ type: 'Button', key: 'set:zen' })).toBeUndefined()
  expect(await again.find({ type: 'Button', key: 'set:err' })).toBeDefined()
  await again.press({ key: 'fold:set:display' })
  expect(await again.find({ type: 'Button', key: 'set:zen' })).toBeDefined()
  await again.unmount()
})

test('sticky headers repeat the section header once the window has scrolled past it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await say($, 'lymain', 'commands')

  const top = await $.ui.mount(PANE('layout-main', 'terminal', { scroll: { offset: 0, bodyRows: 10 } }))
  expect(await top.find({ type: 'Button', key: 'fold:cmd:Panes:sticky' })).toBeUndefined()
  await top.unmount()

  // Tree rows: tabs, subtitle, header Panes, six panes commands, header Display ... offset 6 is inside Panes.
  const inside = await $.ui.mount(PANE('layout-main', 'terminal', { scroll: { offset: 6, bodyRows: 10 } }))
  const sticky = await inside.find({ type: 'Button', key: 'fold:cmd:Panes:sticky' })
  expect(sticky?.text).toContain('Panes')
  expect(sticky?.text).toContain('↑')
  await inside.unmount()

  // Further down, the Display header is the one that repeats.
  const lower = await $.ui.mount(PANE('layout-main', 'terminal', { scroll: { offset: 12, bodyRows: 10 } }))
  expect(await lower.find({ type: 'Button', key: 'fold:cmd:Display:sticky' })).toBeDefined()
  expect(await lower.find({ type: 'Button', key: 'fold:cmd:Panes:sticky' })).toBeUndefined()
  await lower.unmount()

  // The legend sticks as well.
  await say($, 'lylegend')
  const legend = await $.ui.mount(PANE('layout-main', 'desktop', { scroll: { offset: 8, bodyRows: 10 } }))
  expect(await legend.find({ type: 'Button', key: 'fold:leg:Text and state:sticky' })).toBeDefined()
  await legend.unmount()
})

test('the legend names each theme key with its colour', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await say($, 'lylegend')

  const ui = await $.ui.mount(PANE('layout-main', 'terminal'))
  const err = await ui.find({ type: 'Text', text: /■ error/ })
  expect(err?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /■ subtle/ }))?.props.color).toBe('subtle')
  expect(await ui.find({ type: 'Text', text: /failed or refused/ })).toBeDefined()
  await ui.unmount()
})

test('recent files show the cut path and a relative time with the exact one', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/Users/me/app/src/deep/file.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await say($, 'lytime')

  const ui = await $.ui.mount(PANE('layout-main', 'terminal', { bodyColumns: 90 }))
  const row = await ui.find({ type: 'Text', text: /deep\/file\.ts/ })
  expect(row?.text).toBe('…/deep/file.ts')
  expect(await ui.find({ type: 'Text', text: /just now \(14:30:00\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2h ago \(/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Bash/ })).toBeUndefined()
  await ui.unmount()

  await say($, 'lypath', 'short')
  const short = await $.ui.mount(PANE('layout-main', 'desktop', { bodyColumns: 90 }))
  expect((await short.find({ type: 'Text', text: /file\.ts/ }))?.text).toBe('file.ts')
  await short.unmount()
})

test('stripes alternate the tone of list rows and can be switched off', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await say($, 'lymain', 'commands')

  const striped = await $.ui.mount(PANE('layout-main', 'terminal'))
  const first = await striped.find({ type: 'Text', text: /open the showcase/ })
  const second = await striped.find({ type: 'Text', text: /colour legend/ })
  expect(first?.props.dimColor).toBe(false)
  expect(second?.props.dimColor).toBe(true)
  await striped.unmount()

  await say($, 'lystripe', 'off')
  const plain = await $.ui.mount(PANE('layout-main', 'terminal'))
  expect((await plain.find({ type: 'Text', text: /colour legend/ }))?.props.dimColor).toBe(false)
  await plain.unmount()
})

test('zen hides every band row; a survey is left alone (the status hook cannot be raised by a test engine)', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const LIST = (hasSurvey = false) =>
    ({
      plugin: 'layout',
      component: 'AbovePromptList',
      surface: 'terminal',
      requestId: 'band',
      props: {
        rows: [
          { plugin: 'a', tree: { type: 'Box', props: {}, children: [] } },
          { plugin: 'b', tree: { type: 'Box', props: {}, children: [] } },
        ],
        hasSurvey,
        isCollapsed: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    }) as any

  const before = await $.ui.mount(LIST())
  expect(((await before.drawn()) as any).children).toHaveLength(2)
  await before.unmount()

  expect(await say($, 'lyzen', 'on')).toContain('Zen on')
  const after = await $.ui.mount(LIST())
  expect(((await after.drawn()) as any).children ?? []).toHaveLength(0)
  await after.unmount()
  const survey = await $.ui.mount(LIST(true))
  expect(((await survey.drawn()) as any).children).toHaveLength(2)
  await survey.unmount()

  expect(await say($, 'lyzen', 'off')).toBe('Zen off.')
})

test('the error banner sits under a failed row and keeps the rows beneath it', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>tool-visuals row</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ROW = (extra: Record<string, unknown>, surface: 'terminal' | 'desktop' | 'mobile' = 'terminal') =>
    ({
      plugin: 'layout',
      component: 'ToolUse',
      requestId: 't1',
      surface,
      props: { tool_use_id: 't1', tool: 'Bash', input: { command: 'false' }, isRunning: false, isErrored: false, isInterrupted: false, output: undefined, ...extra },
    }) as any

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const bad = await $.ui.mount(ROW({ isErrored: true, output: '\nExit code 2\nnpm ERR! boom' }, surface))
    expect(await bad.find({ type: 'Text', text: /tool-visuals row/ })).toBeDefined()
    expect((await bad.find({ type: 'Text', text: /✗ failed/ }))?.props.color).toBe('error')
    expect(await bad.find({ type: 'Text', text: /Exit code 2/ })).toBeDefined()
    await bad.unmount()
  }
  const ok = await $.ui.mount(ROW({}))
  expect(await ok.find({ type: 'Text', text: /tool-visuals row/ })).toBeDefined()
  expect(await ok.find({ type: 'Text', text: /failed/ })).toBeUndefined()
  await ok.unmount()

  const stopped = await $.ui.mount(ROW({ isErrored: true, isInterrupted: true, output: 'Interrupted' }))
  expect(await stopped.find({ type: 'Text', text: /failed/ })).toBeUndefined()
  await stopped.unmount()

  await say($, 'lyicons', 'letters')
  const letters = await $.ui.mount(ROW({ isErrored: true, output: 'bad' }))
  expect(await letters.find({ type: 'Text', text: /^x failed/ })).toBeDefined()
  await letters.unmount()

  await say($, 'lyerr', 'off')
  const off = await $.ui.mount(ROW({ isErrored: true, output: 'bad' }))
  expect(await off.find({ type: 'Text', text: /failed/ })).toBeUndefined()
  expect(await off.find({ type: 'Text', text: /tool-visuals row/ })).toBeDefined()
  await off.unmount()
})

test('the long-output banner appears above 300 lines only', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>result body</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `row ${i}`).join('\n')
  const RES = (n: number, tool = 'Bash', output: unknown = { stdout: lines(n), stderr: '' }) =>
    ({
      plugin: 'layout',
      component: 'ToolResult',
      requestId: 'r1',
      surface: 'terminal',
      props: { tool_use_id: 'r1', tool, output, isErrored: false },
    }) as any

  const exact = await $.ui.mount(RES(300))
  expect(await exact.find({ type: 'Text', text: /long output/ })).toBeUndefined()
  expect(await exact.find({ type: 'Text', text: /result body/ })).toBeDefined()
  await exact.unmount()

  const over = await $.ui.mount(RES(340))
  expect((await over.find({ type: 'Text', text: /long output/ }))?.text).toMatch(/long output · 340 lines/)
  expect(await over.find({ type: 'Text', text: /result body/ })).toBeDefined()
  await over.unmount()

  const read = await $.ui.mount(RES(0, 'Read', { file: { content: lines(500) } }))
  expect((await read.find({ type: 'Text', text: /long output/ }))?.text).toMatch(/500 lines/)
  await read.unmount()

  await say($, 'lylong', 'off')
  const off = await $.ui.mount(RES(340))
  expect(await off.find({ type: 'Text', text: /long output/ })).toBeUndefined()
  await off.unmount()
})

test('language chips and the reading width wrap an assistant message', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine message</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const MSG = (text: string, columns = 160) =>
    ({
      plugin: 'layout',
      component: 'AssistantMessage',
      requestId: 'm1',
      surface: 'terminal',
      viewport: { columns, rows: 40 },
      props: { text, isFirstOfReply: true },
    }) as any
  const code = 'Here:\n```ts\nlet a = 1\n```\n```py\nx = 1\n```'

  // Everything is off by default: the engine's message stands alone.
  const plain = await $.ui.mount(MSG(code))
  expect(await plain.find({ type: 'Text', text: /‹/ })).toBeUndefined()
  expect((await plain.drawn()).type).toBe('Text')
  await plain.unmount()

  await say($, 'lychips', 'on')
  const chips = await $.ui.mount(MSG(code))
  expect(await chips.find({ type: 'Text', text: '‹ts›' })).toBeDefined()
  expect(await chips.find({ type: 'Text', text: '‹py›' })).toBeDefined()
  expect(await chips.find({ type: 'Text', text: /engine message/ })).toBeDefined()
  await chips.unmount()
  const noCode = await $.ui.mount(MSG('just words'))
  expect((await noCode.drawn()).type).toBe('Text')
  await noCode.unmount()

  await say($, 'lychips', 'off')
  expect(await say($, 'lywidth', '90')).toContain('90 cells')
  const wide = await $.ui.mount(MSG('just words', 160))
  expect(((await wide.drawn()) as any).props).toMatchObject({ width: 90 })
  await wide.unmount()
  // A window narrower than the limit is left as the engine drew it.
  const narrow = await $.ui.mount(MSG('just words', 70))
  expect((await narrow.drawn()).type).toBe('Text')
  await narrow.unmount()
  expect(await say($, 'lywidth', 'off')).toContain('off')
  const gone = await $.ui.mount(MSG('just words', 160))
  expect((await gone.drawn()).type).toBe('Text')
  await gone.unmount()
})

test('the floating note: command, input, widget seat and mobile mirror', async ($, on) => {
  const opened = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await say($, 'lynote', 'buy milk')).toContain('Opened the Note pane')
  expect(opened.at(-1)).toMatchObject({ id: 'layout-note', placement: 'widget' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(PANE('layout-note', surface))
    expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('buy milk')
    expect(!!(await ui.find({ type: 'Text', text: 'buy milk' }))).toBe(surface === 'mobile')
    await ui.unmount()
  }
  const ui = await $.ui.mount(PANE('layout-note', 'desktop'))
  await ui.input({ key: 'note', text: 'buy oat milk', kind: 'change' })
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('buy oat milk')
  await ui.press({ key: 'note:clear' })
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('')
  await ui.unmount()

  await say($, 'lynote', 'second thought')
  const widget = await $.ui.mount(PANE('layout-note', 'desktop', { placement: 'widget' }))
  expect(await widget.find({ type: 'Input' })).toBeUndefined()
  expect(await widget.find({ type: 'Text', text: 'second thought' })).toBeDefined()
  await widget.unmount()

  expect(await say($, 'lynote', 'clear')).toBe('Note cleared.')
  const empty = await $.ui.mount(PANE('layout-note', 'desktop', { placement: 'widget' }))
  expect(await empty.find({ type: 'Text', text: /empty note/ })).toBeDefined()
  await empty.unmount()
})

test('split view compares two blobs side by side, or stacked when narrow', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await say($, 'lysplit', 'one\\ntwo\\nthree | one\\nTWO\\nthree\\nfour')).toContain('2 differing row(s), 2 equal')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(PANE('layout-split', surface, { bodyColumns: 80 }))
    expect(await ui.find({ type: 'Text', text: /A 3 lines · B 4 lines · 2 differ/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'two' }))?.props.color).toBe('warning')
    expect((await ui.find({ type: 'Text', text: 'four' }))?.props.color).toBe('diffAdded')
    expect(await ui.find({ type: 'Text', text: /^- / })).toBeUndefined()
    await ui.unmount()
  }
  const stacked = await $.ui.mount(PANE('layout-split', 'terminal', { bodyColumns: 40 }, { columns: 40, rows: 30 }))
  expect((await stacked.find({ type: 'Text', text: '- two' }))?.props.color).toBe('diffRemoved')
  expect((await stacked.find({ type: 'Text', text: '+ TWO' }))?.props.color).toBe('diffAdded')
  await stacked.press({ key: 'fold:split:edit' })
  expect(await stacked.find({ type: 'Input', key: 'split-a' })).toBeUndefined()
  await stacked.press({ key: 'fold:split:edit' })
  expect(await stacked.find({ type: 'Input', key: 'split-a' })).toBeDefined()
  await stacked.unmount()

  const edit = await $.ui.mount(PANE('layout-split', 'desktop'))
  await edit.input({ key: 'split-a', text: 'x', kind: 'change' })
  expect(await edit.find({ type: 'Text', text: /A 1 lines/ })).toBeDefined()
  await edit.unmount()

  expect(await say($, 'lysplit', 'swap')).toContain('Swapped')
  expect(await say($, 'lysplit', 'bad usage')).toContain('Usage')
  expect(await say($, 'lysplit', 'clear')).toContain('cleared')
  const empty = await $.ui.mount(PANE('layout-split', 'terminal'))
  expect(await empty.find({ type: 'Text', text: /Nothing to compare yet/ })).toBeDefined()
  await empty.unmount()
})

test('pinned panes reopen at session start, only this mod\'s own', async ($, on) => {
  const opened = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await say($, 'lypin', 'main')).toContain('Pinned layout-main')
  expect(await say($, 'lypin', 'note')).toContain('Pinned layout-note')
  expect(await say($, 'lypin', 'workbench-files')).toContain('Only this mod')
  expect(await say($, 'lypin', 'list')).toContain('layout-main, layout-note')

  opened.length = 0
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened.map(o => o.id).sort()).toEqual(['layout-main', 'layout-note'])

  expect(await say($, 'lypin', 'note')).toContain('Unpinned layout-note')
  opened.length = 0
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened.map(o => o.id)).toEqual(['layout-main'])

  const ui = await $.ui.mount(PANE('layout-main', 'desktop'))
  await ui.press({ key: 'pin:layout-split' })
  expect(await say($, 'lypin', 'list')).toContain('layout-split')
  await ui.unmount()
  expect(await say($, 'lypin', 'clear')).toContain('No panes')
})

test('a pane that cannot be placed says why', async ($, on) => {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface is attached' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  mock.clock(on, { now: 1 })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await say($, 'lymain')).toBe('The Layout pane is waiting: no surface is attached.')
  expect(await say($, 'lymain', 'nonsense')).toContain('Unknown tab')
})

test('/lyreset clears settings and everything stored', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await say($, 'lyzen', 'on')
  await say($, 'lynote', 'keep me')
  await say($, 'lysplit', 'a | b')
  await say($, 'lypin', 'main')
  await say($, 'lywidth', '100')
  const ui = await $.ui.mount(PANE('layout-main', 'terminal'))
  await ui.press({ key: 'fold:set:display' })

  expect(await say($, 'lyreset')).toContain('reset')
  expect((await ui.find({ type: 'Button', key: 'set:zen' }))?.props.label).toBe('off')
  expect(await ui.find({ type: 'Button', key: 'set:zen' })).toBeDefined()
  await ui.unmount()
  const note = await $.ui.mount(PANE('layout-note', 'desktop'))
  expect((await note.find({ type: 'Input', key: 'note' }))?.props.value).toBe('')
  await note.unmount()
  expect(await say($, 'lypin', 'list')).toContain('none')
  expect(await say($, 'lywidth')).toContain('off')
  // A new session finds nothing stored.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await say($, 'lyzen', '')).toContain('Zen on')
})

test('the chain is composed: a recording hook never blocks the tool call', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const done = await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
  expect(done).toBeDefined()
  await $.tool.call({ tool: 'Write', file_path: '/a/c.ts', content: 'x' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
  await say($, 'lymain', 'recent')
  const ui = await $.ui.mount(PANE('layout-main', 'terminal', { bodyColumns: 90 }))
  expect((await ui.findAll({ type: 'Text', text: /^…\/a\/(b|c)\.ts$|^a\/(b|c)\.ts$/ })).length).toBe(2)
  await ui.unmount()
})
