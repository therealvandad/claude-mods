import { expect, test } from 'claude-code/testing'

import { menuTarget, quote, rememberText } from './menu'

const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const
const menu = (props: Record<string, unknown>) => ({ plugin: 'cockpit', component: 'ContextMenu', surface: 'desktop', props }) as any
const reply = (id: string, text: string) =>
  ({ plugin: 'cockpit', component: 'AssistantMessage', surface: 'desktop', requestId: id, props: { text, isFirstOfReply: true } }) as any
const ROW = (id: string) => ({ row: { component: 'AssistantMessage', requestId: id } })

const world = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}) => {
  const w = { saved: { ...init } as Record<string, unknown>, filled: [] as { text: string; mode: string }[], toasts: [] as string[] }

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
  on('theme.set', () => ({ value: { isDrawn: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.fill', (_: unknown, e: { text: string; mode: string }) => {
    w.filled.push({ text: e.text, mode: e.mode })

    return { isFilled: true }
  })
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))

  return w
}

const labels = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)

test('selected text gets four actions; asking only fills the prompt box', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(menu({ selection: { text: 'one\ntwo' } }))

  expect(await labels(ui)).toEqual(['Explain simpler', 'Shorter', 'How to test this', 'Pin this'])
  await ui.press({ key: 'menu-simpler' })
  await ui.press({ key: 'menu-test' })
  expect(w.filled).toEqual([
    { text: 'Explain this more simply:\n> one\n> two\n', mode: 'insert' },
    { text: 'Show me how to test this:\n> one\n> two\n', mode: 'insert' },
  ])
  await ui.press({ key: 'menu-pin' })
  expect(w.saved.cpins).toEqual(['one two'])
  expect(w.toasts.join()).toMatch(/Pinned/)
  await ui.unmount()
})

test('right-clicking a reply quotes that reply, not another', async ($, on) => {
  const w = world(on)
  await $.session.start(START)

  for (const [id, text] of [['r1', 'the first answer'], ['r2', 'the second answer']]) {
    const drawn = await $.ui.mount(reply(id as string, text as string))
    await drawn.unmount()
  }
  const ui = await $.ui.mount(menu(ROW('r1')))
  await ui.press({ key: 'menu-shorter' })

  expect(w.filled[0]?.text).toBe('Say this more briefly:\n> the first answer\n')
  await ui.unmount()
})

test('no menu rows for an unknown row, another kind of row, or when everything is hidden', async ($, on) => {
  world(on, { view: { clean: true } })
  await $.session.start(START)

  for (const props of [{ selection: { text: 'x y' } }, ROW('never-drawn'), {}]) {
    const ui = await $.ui.mount(menu(props))
    expect(await labels(ui)).toEqual([])
    await ui.unmount()
  }
})

test('helpers: long text is clipped, and only so many replies are remembered', async () => {
  expect(quote('a'.repeat(900)).length).toBe(602)
  const texts = new Map<string, string>()

  for (let i = 0; i < 260; i += 1) {
    rememberText(texts, `r${i}`, `answer ${i}`)
  }
  expect(texts.size).toBe(200)
  expect(menuTarget(ROW('r0'), texts)).toBeNull()
  expect(menuTarget(ROW('r259'), texts)?.text).toBe('answer 259')
  expect(menuTarget({ row: { component: 'ToolUse', requestId: 'r259' } }, texts)).toBeNull()
})
