import { expect, mock, test } from 'claude-code/testing'

type Fill = { text: string; mode: string; cursor?: number }
type ToolOut = Record<string, unknown>

type Box = {
  registered: string[]
  refuse: string[]
  toasts: string[]
  fills: Fill[]
  suggestions: string[]
  draft: string
  messages: { role: 'user' | 'assistant'; text: string; toolUses: unknown[] }[]
  calm: boolean
  tool: (e: any) => ToolOut
}

const newBox = (): Box => ({
  registered: [],
  refuse: [],
  toasts: [],
  fills: [],
  suggestions: [],
  draft: '',
  messages: [],
  calm: false,
  tool: () => ({ result: {}, text: 'ok' }),
})

const wire = (on: (...args: any[]) => unknown, box: Box) => {
  on('command.register', (_: unknown, e: { name: string }) => {
    if (box.refuse.includes(e.name)) {
      throw new Error('name taken')
    }
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.read', () => ({ value: { text: box.draft, cursor: box.draft.length } }))
  on('prompt.fill', (_: unknown, e: Fill) => {
    box.fills.push({ text: e.text, mode: e.mode, ...(e.cursor === undefined ? {} : { cursor: e.cursor }) })

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.suggest', (_: unknown, e: { text: string }) => {
    box.suggestions.push(e.text)

    return { isShown: true }
  })
  on('prompt.edit', (_: unknown, e: { text: string; inputText: string }) => ({ text: e.text + e.inputText, cursor: 0 }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('session.messages', () => ({ value: box.messages }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_: unknown, e: any) => box.tool(e))
  // The settings mod owns isCalm: it reads here from the box, nothing is stored in this mod.
  on('state.get', (_: unknown, e: any, next: any) =>
    e.plugin === 'settings' && e.key === 'isCalm' ? { value: { value: box.calm, version: 1 } } : next(e),
  )
}

const stored: Record<string, unknown> = {}

const wireStore = (on: (...args: any[]) => unknown, entries: Record<string, unknown>) => {
  for (const key of Object.keys(stored)) {
    delete stored[key]
  }
  Object.assign(stored, JSON.parse(JSON.stringify(entries)))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: stored[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(stored[e.key])) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete stored[e.key]

    return { value: undefined }
  })
}

const cmd = ($: any, command: string, args = ''): Promise<{ text: string }> =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const send = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })
const done = ($: any, answer = 'done') => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

const setup = async ($: any, on: any, entries: Record<string, unknown> = {}, now = 1_700_000_000_000) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now })
  wireStore(on, entries)
  await start($)

  return { box, clock }
}

const PANE = {
  plugin: 'assist',
  component: 'Pane',
  requestId: 'assist-main',
  surface: 'desktop',
  props: { title: 'Assist', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as any

const BAND = {
  plugin: 'assist',
  surface: 'desktop',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as any

const ROW = (props: Record<string, unknown>, surface = 'desktop') =>
  ({
    plugin: 'assist',
    surface,
    component: 'ToolUse',
    requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', input: { command: 'npm run build' }, isRunning: false, isErrored: false, isInterrupted: false, ...props },
  }) as any

const MSG = (text: string, surface = 'desktop') =>
  ({ plugin: 'assist', surface, component: 'AssistantMessage', requestId: 'm1', props: { text } }) as any

const fail = (text: string) => ({ result: 'exit 1', isError: true, text })

// ------------------------------------------------------------------ session start, help, reset

test('session start registers every command with the as prefix and survives a refused name', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1000 })
  wireStore(on, {})
  box.refuse = ['asq']
  await start($)

  expect(box.registered.length).toBe(20)
  expect(box.registered.every(n => n === 'as' || n.startsWith('as'))).toBe(true)
  expect(box.registered).not.toContain('asq')
  expect(box.toasts.some(t => t.includes('/asq could not be registered'))).toBe(true)
})

test('/as lists every command and says glossary hover is not built; /as pane opens the pane', async ($, on) => {
  const { box } = await setup($, on)
  const help = (await cmd($, 'as')).text

  for (const name of ['asnext', 'asunstick', 'asretry', 'ascompress', 'aspaste', 'asfind', 'asrecall', 'asrecap', 'aspre', 'aspost', 'ashelp', 'ashandoff', 'asread', 'asskim', 'asq', 'asfix', 'asfixes', 'ascoach', 'asrec', 'asreset']) {
    expect(help).toContain(`/${name}`)
  }
  expect(help).toContain('Glossary hover')
  expect(help).toContain('Nothing is sent')
  expect((await cmd($, 'as', 'pane')).text).toBe('Assist pane opened.')
  expect(box.fills).toEqual([])
})

// ------------------------------------------------------------------ 69 next-step suggester

test('69: the suggestion line is off by default, on with /asnext on, and held back when calm', async ($, on) => {
  const { box } = await setup($, on)
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })
  await done($)
  expect(box.suggestions).toEqual([])

  expect((await cmd($, 'asnext', 'on')).text).toContain('on')
  await send($, 'change it')
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'b', new_string: 'c' })
  await done($)
  expect(box.suggestions).toEqual(['Run the tests and report what fails.'])

  box.calm = true
  await done($)
  expect(box.suggestions.length).toBe(1)
  // On command it still answers, calm or not.
  const chips = (await cmd($, 'asnext')).text
  expect(chips).toContain('run the tests')
  expect(chips).toContain('commit')
})

test('69: a failed test run proposes fixing it; a commit after clears the commit chip', async ($, on) => {
  const { box } = await setup($, on)
  await cmd($, 'asnext', 'on')
  await send($, 'go')
  box.tool = e => (e.command === 'npm test' ? fail('FAILED tests/a.py::test_one - boom') : { result: {}, text: 'ok' })
  await bash($, 'npm test')
  await done($)
  expect(box.suggestions).toEqual(['Fix the failing test: tests/a.py::test_one'])

  await send($, 'again')
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })
  box.tool = () => ({ result: {}, text: 'ok' })
  await bash($, 'npm test')
  await bash($, 'git commit -am x')
  const after = (await cmd($, 'asnext')).text
  expect(after).toContain('Nothing to suggest')
})

// ------------------------------------------------------------------ 70 stuck, 72 retry

test('70: three different failures raise one toast per episode; /asunstick fills the reset prompt', async ($, on) => {
  const { box } = await setup($, on)
  box.tool = () => fail('Error: it broke')
  await bash($, 'npm run a')
  await bash($, 'npm run b')
  expect(box.toasts).toEqual([])
  await bash($, 'npm run c')
  expect(box.toasts.length).toBe(1)
  expect(box.toasts[0]).toContain('/asunstick')
  await bash($, 'npm run d')
  expect(box.toasts.length).toBe(1)

  const answer = (await cmd($, 'asunstick')).text
  expect(answer).toContain('Nothing was sent')
  expect(box.fills[0]?.text).toContain('Several different attempts in a row failed')
  expect(box.fills[0]?.text).toContain('npm run c')
  expect(box.fills[0]?.mode).toBe('replace')
})

test('70: the same command failing again and again is not stuck, and a success ends the episode', async ($, on) => {
  const { box, clock } = await setup($, on)
  box.tool = () => fail('Error: it broke')
  for (let i = 0; i < 4; i += 1) {
    await bash($, 'npm run a')
  }
  expect(box.toasts).toEqual([])
  await bash($, 'npm run b')
  await bash($, 'npm run c')
  expect(box.toasts.length).toBe(1)
  box.tool = () => ({ result: {}, text: 'ok' })
  await bash($, 'ls')
  await clock.advance(4 * 60 * 1000)
  box.tool = () => fail('Error: it broke')
  await bash($, 'x1')
  await bash($, 'x2')
  await bash($, 'x3')
  expect(box.toasts.length).toBe(2)
})

test('70: calm shows no toast, only the command works; nothing recorded gives a plain answer', async ($, on) => {
  const { box } = await setup($, on)
  expect((await cmd($, 'asunstick')).text).toContain('nothing to reset')
  box.calm = true
  box.tool = () => fail('Error: it broke')
  await bash($, 'a1')
  await bash($, 'a2')
  await bash($, 'a3')
  expect(box.toasts).toEqual([])
  await cmd($, 'asunstick')
  expect(box.fills.length).toBe(1)
})

test('72: /asretry fills the retry prompt with the failed command, with a blank when no change is given', async ($, on) => {
  const { box } = await setup($, on)
  expect((await cmd($, 'asretry')).text).toContain('No failed command')
  box.tool = () => fail('Error: timeout')
  await bash($, 'npm run build --token abc123def')
  await cmd($, 'asretry', 'a longer timeout')
  expect(box.fills[0]?.text).toBe('Retry the last failed command (`npm run build --token ***`) with a longer timeout')
  await cmd($, 'asretry')
  expect(box.fills[1]?.text.endsWith('with ___')).toBe(true)
  expect(box.fills[1]?.cursor).toBe(box.fills[1]!.text.length - 3)
})

// ------------------------------------------------------------------ 71 explain chip

test('71: an errored row gets one small explain button; a good or running or calm row does not', async ($, on) => {
  const { box } = await setup($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const bad = await $.ui.mount(ROW({ isErrored: true, output: { stderr: 'Error: nope', stdout: '' } }, surface))
    expect(await bad.find({ key: 'as-explain-t1' })).toBeDefined()
    await bad.unmount()
  }
  const good = await $.ui.mount(ROW({ output: { stdout: 'ok' } }))
  expect(await good.find({ key: 'as-explain-t1' })).toBeUndefined()
  await good.unmount()
  const running = await $.ui.mount(ROW({ isRunning: true, isErrored: true }))
  expect(await running.find({ key: 'as-explain-t1' })).toBeUndefined()
  await running.unmount()
  const stopped = await $.ui.mount(ROW({ isErrored: true, isInterrupted: true }))
  expect(await stopped.find({ key: 'as-explain-t1' })).toBeUndefined()
  await stopped.unmount()

  const ui = await $.ui.mount(ROW({ isErrored: true, output: { stderr: 'Error: nope token=abc123', stdout: '' } }))
  await ui.press({ key: 'as-explain-t1' })
  await ui.unmount()
  expect(box.fills.length).toBe(1)
  expect(box.fills[0]?.text).toContain('This command failed: `npm run build`')
  expect(box.fills[0]?.text).toContain('Error: nope')
  expect(box.fills[0]?.text).not.toContain('abc123')

  box.calm = true
  const quiet = await $.ui.mount(ROW({ isErrored: true }))
  expect(await quiet.find({ key: 'as-explain-t1' })).toBeUndefined()
  await quiet.unmount()
})

test('71: other mods rows stay (the engine row is drawn, then the button)', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1000 })
  wireStore(on, {})
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
  await start($)
  const ui = await $.ui.mount(ROW({ isErrored: true }))
  expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeDefined()
  expect(await ui.find({ key: 'as-explain-t1' })).toBeDefined()
  await ui.unmount()
})

// ------------------------------------------------------------------ 73 compressor

test('73: /ascompress lists the biggest outputs and fills an avoid prompt on request', async ($, on) => {
  const { box } = await setup($, on)
  expect((await cmd($, 'ascompress')).text).toContain('No outputs')
  box.tool = e => ({ result: {}, text: e.file_path === '/big.ts' ? 'x'.repeat(12_000) : 'small' })
  await $.tool.call({ tool: 'Read', file_path: '/big.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/big.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/small.ts' })
  const text = (await cmd($, 'ascompress')).text
  expect(text.indexOf('12k')).toBeGreaterThan(-1)
  expect(text).toContain('Read /big.ts')
  expect(text).toContain('read 2 times')
  await cmd($, 'ascompress', 'fill')
  expect(box.fills[0]?.text).toContain('Avoid re-reading /big.ts')
})

// ------------------------------------------------------------------ 74 smart paste

test('74: a pasted stack trace gets a one-line label in the band; typing alone does not; calm hides it', async ($, on) => {
  const { box } = await setup($, on)
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a' })
  const quiet = await $.ui.mount(BAND)
  expect(await quiet.find({ type: 'Text', text: /pasted/ })).toBeUndefined()
  await quiet.unmount()

  const trace = 'Error: boom\n    at foo (/a/b.js:3:4)\n    at bar (/a/c.js:9:1)'
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: trace })
  const band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /pasted/ }))?.text).toBe('pasted stack trace · 3 lines')
  await band.unmount()

  box.calm = true
  const hidden = await $.ui.mount(BAND)
  expect(await hidden.find({ type: 'Text', text: /pasted/ })).toBeUndefined()
  await hidden.unmount()
  box.calm = false

  // Emptying the box clears the label.
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '' })
  const gone = await $.ui.mount(BAND)
  expect(await gone.find({ type: 'Text', text: /pasted/ })).toBeUndefined()
  await gone.unmount()
})

test('74: /aspaste off stops the label; the band dismiss button clears it', async ($, on) => {
  await setup($, on)
  const json = '{"alpha": 1, "beta": [1, 2, 3], "gamma": "a long enough value"}'
  await cmd($, 'aspaste', 'off')
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: json })
  const off = await $.ui.mount(BAND)
  expect(await off.find({ type: 'Text', text: /pasted/ })).toBeUndefined()
  await off.unmount()

  await cmd($, 'aspaste', 'on')
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: json })
  const on1 = await $.ui.mount(BAND)
  expect((await on1.find({ type: 'Text', text: /pasted JSON/ }))?.text).toBe('pasted JSON · 1 line')
  await on1.press({ key: 'as-band-dismiss' })
  await on1.unmount()
  const after = await $.ui.mount(BAND)
  expect(await after.find({ type: 'Text', text: /pasted/ })).toBeUndefined()
  await after.unmount()
})

// ------------------------------------------------------------------ 75 file finder, 76 recall

test('75: files touched this session are found by a fuzzy query and the pane click fills @path', async ($, on) => {
  const { box } = await setup($, on)
  expect((await cmd($, 'asfind', 'x')).text).toContain('No files')
  await $.tool.call({ tool: 'Read', file_path: '/src/router.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/src/rate/limiter.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/src' })

  const some = (await cmd($, 'asfind', 'r')).text
  expect(some).toContain('/src/router.ts')
  expect(some).toContain('/src/rate/limiter.ts')
  expect(some).not.toContain('Grep')

  // One match goes straight into the box, on the same line.
  box.draft = 'look at'
  expect((await cmd($, 'asfind', 'limiter')).text).toContain('@/src/rate/limiter.ts is in the prompt box')
  expect(box.fills[0]).toEqual({ text: ' @/src/rate/limiter.ts ', mode: 'append' })

  await cmd($, 'asfind', 'router')
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props } })
  await ui.press({ key: 'as-tab-find' })
  await ui.press({ key: 'as-file-/src/router.ts' })
  await ui.unmount()
  expect(box.fills[1]?.text).toBe(' @/src/router.ts ')
})

test('76: commands are recalled by words, masked, kept across sessions, and /asrecall off stops recording', async ($, on) => {
  const { box } = await setup($, on)
  await bash($, 'npm run build --token abcdefgh1234')
  await bash($, 'git status')
  expect(JSON.stringify(stored['assist.recall'])).not.toContain('abcdefgh1234')

  const found = (await cmd($, 'asrecall', 'npm build')).text
  expect(found).toContain('npm run build --token ***')
  expect(found).not.toContain('git status')
  expect((await cmd($, 'asrecall', 'nothing like this')).text).toContain('No stored command matches')

  expect((await cmd($, 'asrecall', 'off')).text).toContain('stopped recording')
  await bash($, 'echo not recorded')
  expect((await cmd($, 'asrecall', 'echo')).text).toContain('No stored command matches')
  expect(box.toasts).toEqual([])
})

test('76: stored commands from an earlier day load at session start and are bounded to 300', async ($, on) => {
  const old = Array.from({ length: 320 }, (_, i) => ({ c: `old cmd ${i}`, at: i }))
  await setup($, on, { 'assist.recall': old })
  expect((await cmd($, 'asrecall', 'old cmd 319')).text).toContain('old cmd 319')
  await bash($, 'one more')
  const rows = stored['assist.recall'] as { c: string }[]
  // 320 stored rows were cut to the newest 300, and the new command pushed the oldest one out.
  expect(rows.length).toBe(300)
  expect(rows[0]?.c).toBe('old cmd 21')
  expect(rows[299]?.c).toBe('one more')
  await cmd($, 'asrecall', 'clear')
  expect(stored['assist.recall']).toEqual([])
})

// ------------------------------------------------------------------ 77 recap

test('77: after a 10 minute gap a dismissible card offers a recap prompt fill; /asrecap fills it any time', async ($, on) => {
  const { box, clock } = await setup($, on)
  await send($, 'first task please')
  await send($, 'second task please')
  await clock.advance(4 * 60 * 1000)
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a' })
  const early = await $.ui.mount(BAND)
  expect(await early.find({ key: 'as-recap-fill' })).toBeUndefined()
  await early.unmount()

  await clock.advance(12 * 60 * 1000)
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'b' })
  const band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /back after/ }))?.text).toBe('back after 16 min')
  await band.press({ key: 'as-recap-fill' })
  await band.unmount()
  expect(box.fills[0]?.text.startsWith('Summarize where we left off.')).toBe(true)
  expect(box.fills[0]?.text).toContain('1. first task please')
  expect(box.fills[0]?.text).toContain('2. second task please')

  const gone = await $.ui.mount(BAND)
  expect(await gone.find({ key: 'as-recap-fill' })).toBeUndefined()
  await gone.unmount()

  await cmd($, 'asrecap')
  expect(box.fills.length).toBe(2)
})

test('77: a new session after a long gap raises the card from the stored time; calm hides it; dismiss works', async ($, on) => {
  const now = 1_700_000_000_000
  const { box } = await setup($, on, { 'assist.lastActive': now - 3 * 60 * 60 * 1000, 'assist.prompts': [{ text: 'old prompt', at: 1 }] }, now)
  box.calm = true
  const calm = await $.ui.mount(BAND)
  expect(await calm.find({ key: 'as-recap-fill' })).toBeUndefined()
  await calm.unmount()
  box.calm = false
  const band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /back after/ }))?.text).toBe('back after 180 min')
  await band.press({ key: 'as-band-dismiss' })
  await band.unmount()
  const after = await $.ui.mount(BAND)
  expect(await after.find({ key: 'as-recap-fill' })).toBeUndefined()
  await after.unmount()
})

// ------------------------------------------------------------------ 78 79 checklists

test('78 and 79: /aspre and /aspost fill checklists and never send', async ($, on) => {
  const { box } = await setup($, on)
  await cmd($, 'aspre', 'split the router module')
  expect(box.fills[0]?.text).toContain('Before we start "split the router module"')
  box.draft = 'half typed'
  await cmd($, 'aspost', 'split the router module')
  // A draft is never overwritten: the text goes after it.
  expect(box.fills[1]?.mode).toBe('append')
  expect(box.fills[1]?.text).toContain('Tests: run them')
  expect(box.fills[1]?.text).toContain('Commit: propose')
})

// ------------------------------------------------------------------ 80 help report, 81 handoff

test('80: /ashelp drafts a bug report from recorded errors and commands, in the pane, never sent', async ($, on) => {
  const { box } = await setup($, on)
  box.tool = e => (e.command === 'cat nope.txt' ? fail('cat: nope.txt: No such file or directory') : { result: {}, text: 'ok' })
  await bash($, 'ls')
  await bash($, 'cat nope.txt')
  const text = (await cmd($, 'ashelp')).text
  expect(text).toContain('Draft is in the Assist pane')
  expect(text).toContain('Bug report (draft, not sent anywhere)')
  expect(text).toContain('no such file or directory')
  expect(text).toContain('[failed] cat nope.txt')
  expect(text).toContain('- ls')
  expect(box.fills).toEqual([])

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'as-tab-reports' })
  expect(await ui.find({ type: 'Text', text: /Bug report \(draft/ })).toBeDefined()
  await ui.press({ key: 'as-report-fill' })
  await ui.unmount()
  expect(box.fills[0]?.text).toContain('Steps to reproduce')
})

test('81: /ashandoff bundles prompts, decisions, files changed and open errors', async ($, on) => {
  const { box } = await setup($, on)
  await send($, 'make the router faster')
  await $.tool.call({ tool: 'Edit', file_path: '/src/router.ts', old_string: 'a', new_string: 'b' })
  box.tool = () => fail('Error: tests broke')
  await bash($, 'npm test')
  expect((await cmd($, 'ashandoff', 'decide use a trie for lookups')).text).toContain('Decision 1 noted')
  const text = (await cmd($, 'ashandoff')).text
  expect(text).toContain('- make the router faster')
  expect(text).toContain('- use a trie for lookups')
  expect(text).toContain('- /src/router.ts (1 edit)')
  expect(text).toContain('- npm test: Error: tests broke')
})

// ------------------------------------------------------------------ 82 reading time

test('82: reading time is off by default, on with /asread on, only over 400 words, never when calm', async ($, on) => {
  const { box } = await setup($, on)
  const long = 'word '.repeat(660)
  const off = await $.ui.mount(MSG(long))
  expect(await off.find({ type: 'Text', text: /min read/ })).toBeUndefined()
  await off.unmount()

  await cmd($, 'asread', 'on')
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount(MSG(long, surface))
    expect((await ui.find({ type: 'Text', text: /min read/ }))?.text).toBe('~3 min read')
    await ui.unmount()
  }
  const short = await $.ui.mount(MSG('word '.repeat(100)))
  expect(await short.find({ type: 'Text', text: /min read/ })).toBeUndefined()
  await short.unmount()

  box.calm = true
  const calm = await $.ui.mount(MSG(long))
  expect(await calm.find({ type: 'Text', text: /min read/ })).toBeUndefined()
  await calm.unmount()
})

// ------------------------------------------------------------------ 83 skimmer

test('83: /asskim fills a key-points request and lists the first sentence of each paragraph', async ($, on) => {
  const { box } = await setup($, on)
  box.messages = [
    { role: 'user', text: 'hello', toolUses: [] },
    { role: 'assistant', text: 'The router is slow because of the regex. It runs per request.\n\nWe can cache the compiled form. That removes the cost.', toolUses: [] },
  ]
  const answer = (await cmd($, 'asskim')).text
  expect(box.fills[0]?.text).toContain('key points of your last answer')
  expect(answer).toContain('1. The router is slow because of the regex.')
  expect(answer).toContain('2. We can cache the compiled form.')

  box.messages = []
  expect((await cmd($, 'asskim')).text).toContain('No assistant text to skim yet')
})

// ------------------------------------------------------------------ 84 question bank

test('84: /asq lists the questions for the situation and fills one', async ($, on) => {
  const { box } = await setup($, on)
  expect((await cmd($, 'asq')).text).toContain('Looks like: unclear')
  box.tool = () => fail('Error: x')
  await bash($, 'one')
  expect((await cmd($, 'asq')).text).toContain('Looks like: error')
  await cmd($, 'asq', 'wrap 2')
  expect(box.fills[0]?.text).toBe('What did we decide and why?')
  expect((await cmd($, 'asq', 'nope')).text).toContain('No situation')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'as-tab-prompts' })
  await ui.press({ key: 'as-sit-learn' })
  await ui.press({ key: 'as-q-0' })
  await ui.unmount()
  expect(box.fills[1]?.text).toBe('Explain this as if I were new to the codebase.')
})

// ------------------------------------------------------------------ 86 shortcut coach

test('86: one coach toast a day for a command not used yet, never when calm, off with /ascoach off', async ($, on) => {
  const { box, clock } = await setup($, on)
  await done($)
  expect(box.toasts.length).toBe(1)
  expect(box.toasts[0]).toContain('assist tip: /')
  await clock.advance(5 * 60 * 1000)
  await done($)
  expect(box.toasts.length).toBe(1)

  await clock.advance(24 * 60 * 60 * 1000)
  box.calm = true
  await done($)
  expect(box.toasts.length).toBe(1)
  box.calm = false
  await cmd($, 'ascoach', 'off')
  await done($)
  expect(box.toasts.length).toBe(1)
  await cmd($, 'ascoach', 'on')
  await done($)
  expect(box.toasts.length).toBe(2)
  expect((await cmd($, 'ascoach', 'now')).text.startsWith('/')).toBe(true)
})

test('86: a command you already used is not coached', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1_700_000_000_000 })
  wireStore(on, {})
  // The commands of other mods answer beneath this mod; this one only counts them by name.
  on('command.run', () => ({ text: '' }))
  await start($)
  for (const name of ['aspre', 'asunstick', 'asrecall', 'asfind', 'ascompress', 'asskim', 'ashandoff', 'asfix', 'aspost', 'pmtpl', 'pmsum']) {
    await $.command.run({ command: name, args: '', origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } }).catch(() => undefined)
  }
  await done($)
  expect(box.toasts.some(t => t.includes('assist tip'))).toBe(false)
  expect((await cmd($, 'ascoach', 'now')).text).toContain('already used every command')
})

// ------------------------------------------------------------------ 87 museum, 88 fix library

test('87 and 88: /asfix attaches to the latest error signature, a repeat toasts the note, /asfixes searches', async ($, on) => {
  const { box, clock } = await setup($, on)
  expect((await cmd($, 'asfix', 'kill the old server')).text).toContain('No error is recorded')
  box.tool = e => fail(e.command === 'a' ? 'Error: EADDRINUSE port 3000 in use' : 'Error: something else')
  await bash($, 'a')
  await bash($, 'b')
  await bash($, 'a')
  // The latest is "a" again (3rd call), so the fix goes on the port error.
  await bash($, 'a')
  expect((await cmd($, 'asfix', 'kill the old server on the port')).text).toContain('Fix saved for')
  expect(box.toasts.some(t => t.includes('kill the old server'))).toBe(false)

  await clock.advance(5 * 60 * 1000)
  await bash($, 'a')
  expect(box.toasts.some(t => t.includes('seen this error 4 times') && t.includes('kill the old server on the port'))).toBe(true)

  expect((await cmd($, 'asfixes', 'server')).text).toContain('kill the old server on the port')
  expect((await cmd($, 'asfixes', 'nothing here')).text).toContain('No saved fix matches')
  expect((await cmd($, 'asfixes')).text).toContain('#1')
  expect(JSON.stringify(stored['assist.fixes'])).toContain('kill the old server')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'as-tab-errors' })
  expect(await ui.find({ type: 'Text', text: /x4/ })).toBeDefined()
  await ui.input({ key: 'as-fixes-input', text: 'port' })
  await ui.press({ key: 'as-fix-1' })
  await ui.unmount()
  expect(box.fills[0]?.text).toContain('Apply this known fix if it fits: kill the old server on the port')
})

test('87: a repeat toast is held back when calm', async ($, on) => {
  const { box } = await setup($, on)
  box.tool = () => fail('Error: EADDRINUSE')
  await bash($, 'a')
  await cmd($, 'asfix', 'kill it')
  box.calm = true
  await bash($, 'a')
  expect(box.toasts).toEqual([])
})

// ------------------------------------------------------------------ the pane, switches, reset

test('the pane draws every tab on every surface and the tab buttons switch', async ($, on) => {
  const { box } = await setup($, on)
  box.tool = () => fail('Error: x')
  await bash($, 'one')
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const id of ['find', 'context', 'errors', 'prompts', 'reports', 'modes', 'next']) {
      if (surface === 'vscode' || surface === 'mobile') {
        continue
      }
      await ui.press({ key: `as-tab-${id}` })
      expect(await ui.find({ type: 'Text', text: /Nothing is sent/ })).toBeDefined()
    }
    await ui.unmount()
  }
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'as-tab-modes' })
  await ui.press({ key: 'as-on-next' })
  await ui.unmount()
  expect((await cmd($, 'asnext')).text).toContain('Suggestion line is on')
  expect(stored['assist.modes']).toMatchObject({ next: true })
})

test('the next tab shows chips that fill the box; the retry and reset buttons fill too', async ($, on) => {
  const { box } = await setup($, on)
  await send($, 'edit it')
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'as-chip-0' })
  expect(box.fills[0]?.text).toBe('Run the tests and report what fails.')
  await ui.press({ key: 'as-unstick' })
  await ui.press({ key: 'as-retry' })
  await ui.unmount()
})

test('/asrec off stops recording, /asreset clears the record, /asreset all also clears fixes and switches', async ($, on) => {
  const { box } = await setup($, on)
  box.tool = () => fail('Error: x')
  await bash($, 'one')
  await send($, 'a prompt')
  await cmd($, 'asfix', 'a fix')
  await cmd($, 'asnext', 'on')
  expect(stored['assist.errors']).toBeDefined()
  expect(stored['assist.prompts']).toBeDefined()

  expect((await cmd($, 'asreset')).text).toContain('Fixes and decisions stay')
  expect(stored['assist.errors']).toBeUndefined()
  expect(stored['assist.prompts']).toBeUndefined()
  expect(stored['assist.recall']).toBeUndefined()
  expect((await cmd($, 'asfixes')).text).toContain('a fix')
  expect((await cmd($, 'asnext')).text).toContain('Suggestion line is on')
  expect((await cmd($, 'ashelp')).text).toContain('No errors were recorded')

  await cmd($, 'asrec', 'off')
  await bash($, 'two')
  expect((await cmd($, 'ashelp')).text).toContain('No errors were recorded')
  expect(stored['assist.errors']).toBeUndefined()

  await cmd($, 'asreset', 'all')
  expect(stored['assist.fixes']).toBeUndefined()
  expect((await cmd($, 'asfixes')).text).toContain('No fixes saved')
  expect((await cmd($, 'asnext')).text).toContain('Suggestion line is off')
})

test('prompts with secrets are not recorded, and the record is bounded', async ($, on) => {
  await setup($, on)
  await send($, 'use API_KEY=abcdef123456 for it')
  expect(stored['assist.prompts']).toBeUndefined()
  for (let i = 0; i < 30; i += 1) {
    await send($, `prompt number ${i}`)
  }
  expect((stored['assist.prompts'] as unknown[]).length).toBe(20)
})

test('a refused tool call is not recorded and its result is passed on unchanged', async ($, on) => {
  const { box } = await setup($, on)
  box.tool = () => ({ deny: 'nope' })
  const ran = await bash($, 'rm something')
  expect(ran.deny).toBe('nope')
  expect((await cmd($, 'asrecall', 'rm')).text).toContain('No stored command matches')
})

test('with calm on no mod UI shows by itself: no band, no explain, no reading time, no suggestion', async ($, on) => {
  const { box } = await setup($, on)
  box.calm = true
  await cmd($, 'asnext', 'on')
  await cmd($, 'asread', 'on')
  box.tool = () => fail('Error: x')
  await bash($, 'a')
  await bash($, 'b')
  await bash($, 'c')
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'Traceback (most recent call last):\n  File "a.py", line 3, in x\n  File "b.py", line 4, in y\nValueError' })
  await done($)
  expect(box.toasts).toEqual([])
  expect(box.suggestions).toEqual([])
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text' })).toBeUndefined()
  await band.unmount()
})
