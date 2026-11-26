import { expect, test } from 'claude-code/testing'

import { countPrompt, noticeOf, topPrompts, viewOf } from './plain'
import { emptyLive } from './bar'

const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const
const done = (durationMs: number) => ({ answer: 'ok', durationMs, isAborted: false, turnId: 't', reason: 'answer' }) as const
const band = (props: Record<string, unknown> = {}) =>
  ({
    plugin: 'cockpit',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, ...props },
  }) as any
const PANE = {
  plugin: 'cockpit',
  component: 'Pane',
  requestId: 'cockpit',
  surface: 'desktop',
  props: { title: 'Cockpit', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const world = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}) => {
  const w = {
    saved: { ...init } as Record<string, unknown>,
    filled: [] as string[],
    toasts: [] as string[],
    percent: 40,
    failTests: false,
  }

  on('clock.now', () => ({ value: 100_000 }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: w.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    w.saved[e.key] = e.value

    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## main...origin/main\n M a.ts\n', stderr: '' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: w.percent }, rateLimits: [], cost: { usd: 1.4 } },
  }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    w.filled.push(e.text)

    return { isFilled: true }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('tool.call', (_: unknown, e: any) =>
    e.tool === 'Bash' && w.failTests ? { isError: true, result: '2 failed', text: '2 failed' } : { result: {}, text: '3 passed' },
  )
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['other mod row'] }))

  return w
}

const labels = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
const words = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((n: any) => (n.children ?? []).join('')).join('\n')
const edit = ($: any) => $.tool.call({ tool: 'Edit', file_path: '/work/demo/a.ts', old_string: 'a', new_string: 'b' })

test('nothing to do: one quiet line with the figures and Home', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.turn.complete(done(10))
  const ui = await $.ui.mount(band())

  expect(await labels(ui)).toEqual(['Home'])
  expect(await words(ui)).toContain('Context 40% · $1.40')
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  expect(await words(ui)).toContain('other mod row')
  await ui.unmount()
})

test('an untested edit shows one row with two buttons, and a passing test clears it', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as any)
  await edit($)
  await $.turn.complete(done(10))

  let ui = await $.ui.mount(band())
  expect(await words(ui)).toContain('1 file changed, not tested yet')
  expect(await words(ui)).toContain('Context 40% · $1.40')
  expect(await labels(ui)).toEqual(['Run tests', 'Undo'])
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  await ui.press({ key: 'bar-plain-tests' })
  await ui.press({ key: 'bar-plain-undo' })
  expect(w.filled).toEqual(['Run the tests and tell me what fails.', '/rollback'])
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  ui = await $.ui.mount(band())
  expect(await labels(ui)).toEqual(['Home'])
  await ui.unmount()
})

test('failing tests are said in red with Fix it; a full context offers Compact', async ($, on) => {
  const w = world(on)
  w.percent = 85
  w.failTests = true
  await $.session.start(START)
  await edit($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete(done(10))
  const ui = await $.ui.mount(band())

  expect(await words(ui)).toContain('Tests failed: 2 failing')
  expect((await ui.find({ type: 'Text', text: /Tests failed/ }))?.props.color).toBe('error')
  expect(await labels(ui)).toEqual(['Fix it', 'Compact'])
  await ui.unmount()
})

test('/clean hides the row and the pop-up; a long turn pops up otherwise', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await edit($)
  await $.turn.complete(done(30_000))
  expect(w.toasts).toEqual([])
  await $.turn.complete(done(200_000))
  expect(w.toasts).toEqual(['Done after 3m 20s'])

  await $.command.run({ command: 'clean', args: '' } as any)
  const ui = await $.ui.mount(band())
  expect(await labels(ui)).toEqual([])
  await ui.unmount()
  await $.turn.complete(done(200_000))
  expect(w.toasts).toHaveLength(1)
  expect(w.saved.view).toMatchObject({ clean: true })
})

test('the plain Home: native text only, five tabs, and buttons that only fill', async ($, on) => {
  const w = world(on, { myprompts: { 'fix the failing test': 3, once: 1 } })
  await $.session.start(START)
  await edit($)
  const ui = await $.ui.mount(PANE)

  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  const found = await labels(ui)
  expect(found.slice(0, 5)).toEqual(['Home', 'Files', 'Todo', 'History', 'Errors'])
  expect(found).toContain('fix the failing test')
  expect(found).not.toContain('once')
  expect(await words(ui)).toContain('1 file changed, not tested yet.')
  await ui.press({ key: 'home-cap-5' })
  await ui.press({ key: 'home-snapshot' })
  await ui.press({ key: 'home-mine-0' })
  expect(w.filled).toEqual(['/hardbudget 5', '/snapshot on', 'fix the failing test'])
  await ui.press({ key: 'home-forget' })
  expect(w.saved.myprompts).toEqual({})
  await ui.press({ key: 'home-look' })
  expect(w.saved.view).toMatchObject({ look: 'rich' })
  await ui.unmount()
})

test('/bar look switches between the two looks', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'bar', args: 'look rich' } as any)
  expect(w.saved.view).toMatchObject({ look: 'rich' })
  await $.command.run({ command: 'bar', args: 'look plain' } as any)
  expect(w.saved.view).toMatchObject({ look: 'plain' })
})

test('prompts: repeated short ones become buttons, secrets and paths are never kept', async () => {
  let kept: Record<string, number> = {}

  for (const p of ['run the tests', 'run the tests', 'my password is hunter22', 'open /Users/someone/x', 'mail me at a@b.com please', '/compact', 'hi']) {
    kept = countPrompt(kept, p)
  }
  expect(kept).toEqual({ 'run the tests': 2 })
  expect(topPrompts(kept)).toEqual(['run the tests'])

  for (let i = 0; i < 260; i += 1) {
    kept = countPrompt(kept, `a different prompt number ${i}`)
  }
  expect(Object.keys(kept).length).toBeLessThanOrEqual(200)
  expect(kept['run the tests']).toBe(2)
})

test('the notice: waiting wins, nothing while working, junk settings read as plain', async () => {
  const live = { ...emptyLive(), isUntested: true, unproven: ['a.ts'] }

  expect(noticeOf(live, { isWorking: true, hasGit: true })).toBeNull()
  expect(noticeOf({ ...live, waiting: 'permission' }, { isWorking: true, hasGit: true })?.tone).toBe('warning')
  expect(noticeOf(live, { isWorking: false, hasGit: false })?.buttons.map(b => b.label)).toEqual(['Run tests'])
  expect(viewOf('junk')).toEqual({ look: 'plain', clean: false, alert: true, chat: true, chatStyle: 'roomy', rows: true, colors: 'app', size: 'medium', glass: 'frosted', corners: 'soft' })
})

test('before any reply the quiet line still says the cockpit is there', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(band())

  expect(await labels(ui)).toEqual(['Home'])
  await ui.unmount()
})
