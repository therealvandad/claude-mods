import { expect, test } from 'claude-code/testing'

import { CHAT_STYLE, ROOMY_STYLE, stepsOf } from './chat'
import { refusals } from './colors'

const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const
const SPINNER = {
  plugin: 'cockpit',
  component: 'Spinner',
  surface: 'desktop',
  props: { word: 'Working', message: null, suffix: '…', mode: 'tool-use' },
} as any
const PLAN = 'mcp__ccd_turn__update_plan'

const world = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}) => {
  const w = { saved: { ...init } as Record<string, unknown>, themes: [] as any[], cleared: 0 }

  on('clock.now', () => ({ value: 100_000 }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: w.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    w.saved[e.key] = e.value

    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 0 } } }))
  on('theme.set', (_: unknown, e: unknown) => {
    w.themes.push(e)

    return { value: { isDrawn: true } }
  })
  on('theme.clear', () => {
    w.cleared += 1

    return { value: undefined }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['the app working row'] }))

  return w
}

const words = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((n: any) => (n.children ?? []).join('')).join('\n')

test('the chat look is set at start, and /bar chat off puts the app look back', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(w.themes).toHaveLength(1)
  expect(JSON.stringify(w.themes[0])).toContain('"fontSize":19')
  await $.command.run({ command: 'bar', args: 'chat off' } as any)
  expect(w.cleared).toBe(1)
  expect(w.saved.view).toMatchObject({ chat: false })
  await $.command.run({ command: 'bar', args: 'chat on' } as any)
  expect(w.themes).toHaveLength(2)
})

test('a chat look that was switched off stays off', async ($, on) => {
  const w = world(on, { view: { chat: false } })
  await $.session.start(START)
  expect(w.themes).toEqual([])
})

test('the working row keeps the app line and adds the step Claude is on', async ($, on) => {
  world(on)
  await $.session.start(START)

  let ui = await $.ui.mount(SPINNER)
  expect(await words(ui)).toBe('the app working row')
  await ui.unmount()

  await $.tool.call({
    tool: PLAN,
    items: [
      { content: 'Read the code', status: 'in_progress' },
      { content: 'Fix it', status: 'pending' },
      { content: 'Test it', status: 'pending' },
    ],
  } as any)
  await $.tool.call({ tool: PLAN, advance: true } as any)
  ui = await $.ui.mount(SPINNER)
  const text = await words(ui)
  expect(text).toContain('the app working row')
  expect(text).toContain('▰▱▱')
  expect(text).toContain('Step 2 of 3: Fix it')
  await ui.unmount()

  await $.tool.call({ tool: PLAN, done: [2], start: 3 } as any)
  ui = await $.ui.mount(SPINNER)
  expect(await words(ui)).toContain('Step 3 of 3: Test it')
  await ui.unmount()

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done' } as any)
  ui = await $.ui.mount(SPINNER)
  expect(await words(ui)).toBe('the app working row')
  await ui.unmount()
})

test('steps: a short or finished list shows nothing; a long one keeps twelve segments', async () => {
  const task = (i: number, status: string) => ({ id: String(i), status, label: `t${i}` })

  expect(stepsOf([task(1, 'in_progress')])).toBeNull()
  expect(stepsOf([task(1, 'completed'), task(2, 'completed')])).toBeNull()
  const long = Array.from({ length: 24 }, (_, i) => task(i, i < 12 ? 'completed' : 'pending'))
  expect(stepsOf(long)?.bar).toBe('▰'.repeat(6) + '▱'.repeat(6))
  expect(JSON.stringify(CHAT_STYLE)).not.toMatch(/shadow|gradient|rotate|#/)
})

test('/bar chat on says what the app answered', async ($, on) => {
  world(on)
  await $.session.start(START)
  const out = await $.command.run({ command: 'bar', args: 'chat on' } as any)

  expect(out.text).toBe('Roomy chat look on. The app accepted it.')
})

test('/bar chat clean and roomy swap the style, and the help lists them', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const clean = await $.command.run({ command: 'bar', args: 'chat clean' } as any)

  expect(clean.text).toBe('Clean chat look on. The app accepted it.')
  expect(JSON.stringify(w.themes[w.themes.length - 1])).toContain('"fontSize":15')
  await $.command.run({ command: 'bar', args: 'chat roomy' } as any)
  expect(JSON.stringify(w.themes[w.themes.length - 1])).toContain('"fontSize":19')
  expect(w.saved.view).toMatchObject({ chat: true, chatStyle: 'roomy' })
  const help = await $.command.run({ command: 'bar', args: '' } as any)
  expect(help.text).toContain('/bar chat roomy|clean|off (now roomy)')
  expect(JSON.stringify(ROOMY_STYLE)).not.toMatch(/shadow|gradient|rotate|#/)
})

test('color themes go out with the chat style, and none is refused by the desktop', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(refusals()).toEqual([])

  for (const name of ['paper', 'midnight', 'contrast', 'nord', 'forest', 'ocean', 'rose', 'mocha', 'sunset', 'lavender', 'graphite', 'mint', 'berry', 'sand', 'solar']) {
    await $.command.run({ command: 'bar', args: `colors ${name}` } as any)
    const sent = JSON.stringify(w.themes[w.themes.length - 1])
    expect(sent, name).toContain('colors')
    expect(sent, name).toContain('"fontSize":19')
  }
  await $.command.run({ command: 'bar', args: 'chat off' } as any)
  expect(w.cleared).toBe(0)
  expect(JSON.stringify(w.themes[w.themes.length - 1])).not.toContain('fontSize')
  await $.command.run({ command: 'bar', args: 'colors app' } as any)
  expect(w.cleared).toBe(1)
})

test('this mod draws its section in the shared Mod manager panel', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({
    plugin: 'mod-manager',
    component: 'Pane',
    requestId: 'mod-settings',
    surface: 'desktop',
    props: { title: 'Mod manager', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as any)

  expect((await ui.findAll({ type: 'Text' })).map((n: any) => (n.children ?? []).join('')).join('\n')).toContain('Look and chat')
  await ui.press({ key: 'cp-rows', plugin: 'cockpit' })
  expect(w.saved.view).toMatchObject({ rows: false })
  await ui.unmount()
})
