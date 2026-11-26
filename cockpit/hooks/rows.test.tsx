import { expect, mock, test } from 'claude-code/testing'

import { isTestCommand, testsPassed } from './bar'
import { errorLine, settleMarks } from './rows'

const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const
const row = (id: string, props: Record<string, unknown>) =>
  ({
    plugin: 'cockpit',
    component: 'ToolUse',
    surface: 'desktop',
    requestId: id,
    props: { tool_use_id: id, tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...props },
  }) as any

const world = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}, hasOwnClock = false) => {
  const w = {
    saved: { ...init } as Record<string, unknown>,
    now: 100_000,
    fails: false,
    hold: undefined as undefined | Promise<void>,
  }
  const timer = () => ({ value: { cancel() {} } })

  if (!hasOwnClock) {
    on('clock.now', () => ({ value: w.now }))
    on('clock.after', () => timer())
    on('clock.every', () => timer())
  }
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: w.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    w.saved[e.key] = e.value

    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 0 } } }))
  on('theme.set', () => ({ value: { isDrawn: true } }))
  on('tool.call', async (_: unknown, e: any) => {
    await w.hold

    return e.tool === 'Bash' && w.fails ? { isError: true, result: '1 failed', text: '1 failed' } : { result: {}, text: '3 passed' }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['app row'] }))

  return w
}

const words = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((n: any) => (n.children ?? []).join('')).join('\n')
const drawn = async ($: any, id: string, props: Record<string, unknown> = {}) => {
  const ui = await $.ui.mount(row(id, props))
  const text = await words(ui)
  await ui.unmount()

  return text
}
const edit = ($: any, id: string) => $.tool.call({ tool: 'Edit', tool_use_id: id, file_path: '/work/demo/a.ts', old_string: 'a', new_string: 'b' })
const npmTest = ($: any, id: string) => $.tool.call({ tool: 'Bash', tool_use_id: id, command: 'npm test' })

test('an edit row says not tested, then tested, and a later edit starts again', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await edit($, 'e1')
  expect(await drawn($, 'e1')).toBe('app row\n○ not tested yet')

  w.fails = true
  await npmTest($, 't1')
  expect(await drawn($, 'e1')).toContain('✗ tests failed after this edit')

  w.fails = false
  await npmTest($, 't2')
  await edit($, 'e2')
  expect(await drawn($, 'e1')).toContain('✓ tested')
  expect(await drawn($, 'e2')).toContain('○ not tested yet')
  expect(await drawn($, 'unknown')).toBe('app row')
})

test('a failed command shows the line that says why; a good or interrupted one shows nothing', async ($, on) => {
  world(on)
  await $.session.start(START)
  const output = 'Exit code 1\nrunning checks\nError: cannot find module x\n  at y'
  const ui = await $.ui.mount(row('b1', { tool: 'Bash', isErrored: true, output }))

  expect(await words(ui)).toBe('app row\nError: cannot find module x')
  expect((await ui.find({ type: 'Text', text: /cannot find/ }))?.props.color).toBe('error')
  await ui.unmount()
  expect(await drawn($, 'b2', { tool: 'Bash' })).toBe('app row')
  expect(await drawn($, 'b3', { tool: 'Bash', isErrored: true, isInterrupted: true, output })).toBe('app row')
})

test('a slow command shows its time, a finished one does not', async ($, on) => {
  const clock = mock.clock(on, { now: 100_000 })
  const w = world(on, {}, true)
  await $.session.start(START)
  let release = () => {}
  w.hold = new Promise<void>(r => (release = () => r()))
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 's1', command: 'npm run build' } as any)
  await clock.settle()
  const ui = await $.ui.mount(row('s1', { tool: 'Bash', isRunning: true }))

  expect(await words(ui)).toBe('app row')
  await clock.advance(10_000)
  await ui.drawn()
  expect(await words(ui)).toContain('Running for 10s')
  await clock.advance(65_000)
  await ui.drawn()
  expect(await words(ui)).toContain('Running for 1m 15s')
  release()
  await call
  await clock.settle()
  expect(await words(ui)).toBe('app row')
  await ui.unmount()
})

test('/bar rows off leaves the app rows alone', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await edit($, 'e1')
  await $.command.run({ command: 'bar', args: 'rows off' } as any)

  expect(await drawn($, 'e1')).toBe('app row')
  expect(w.saved.view).toMatchObject({ rows: false })
})

test('helpers: the telling line wins, and a failing run keeps proven edits proven', async () => {
  expect(errorLine('Exit code 2\n\nsome words\nfatal: not a repository')).toBe('fatal: not a repository')
  expect(errorLine('just this')).toBe('just this')
  expect(errorLine(undefined)).toBe('')
  expect(settleMarks({ a: 'tested', b: 'untested' }, false)).toEqual({ a: 'tested', b: 'failed' })
})

test('common test commands count as tests, look-alikes do not', async () => {
  for (const c of ['python3 -m unittest discover -s demo -v', 'python -m pytest', 'npx vitest', 'make test', 'cd app && npm run test', './gradlew test', 'claude plugin test .']) {
    expect(isTestCommand(c), c).toBe(true)
  }

  for (const c of ['make testing', 'python3 -m http.server', 'cat pytest.ini', 'echo npm test']) {
    expect(isTestCommand(c), c).toBe(false)
  }
  expect(testsPassed(false, 'Ran 2 tests\n\nFAILED (failures=1)')).toBe(false)
  expect(testsPassed(false, 'Ran 1 test\n\nOK')).toBe(true)
})
