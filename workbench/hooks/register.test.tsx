import { expect, test } from 'claude-code/testing'

const PANE = (id: string) =>
  ({
    plugin: 'workbench',
    component: 'Pane',
    requestId: id,
    surface: 'desktop',
    props: {
      title: id,
      isFocused: false,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  }) as const

const engine = (on: (...args: any[]) => unknown) => {
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('clock.after', () => ({ value: { cancel() {} } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('store.get', () => ({ value: ['an old note'] }))
  on('store.set', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000, percent: 42 }, rateLimits: [], cost: { usd: 1.5 } },
  }))
}

test('an edited file shows up in the files pane', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/app/a.ts', old_string: 'x', new_string: 'y' })

  const ui = await $.ui.mount(PANE('files'))
  expect(await ui.find({ type: 'Text', text: /^a\.ts$/ })).toBeDefined()
  await ui.unmount()
})

test('saved notes load into the notes pane', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(PANE('notes'))
  expect(await ui.find({ type: 'Text', text: /an old note/ })).toBeDefined()
  await ui.unmount()
})

test('the dashboard counts tool calls', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })

  const ui = await $.ui.mount(PANE('dashboard'))
  expect(await ui.find({ type: 'Text', text: /^Tools$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2$/ })).toBeDefined()
  await ui.unmount()
})
