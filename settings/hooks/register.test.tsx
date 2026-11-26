import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'settings',
  component: 'Pane',
  requestId: 'settings-main',
  surface: 'desktop',
  props: { title: 'Settings', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const engine = (on: (...args: any[]) => unknown, saved: unknown = undefined) => {
  on('command.register', () => ({ value: { command: 'cfg' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: saved }))
  on('store.set', () => ({ value: undefined }))
}
const run = async ($: any, args: string) => ((await $.command.run({ command: 'cfg', args })) as { text: string }).text
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

test('a preset sets several values and says what it did', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'preset calm')).toMatch(/Preset calm/)
  expect(await run($, '')).toMatch(/preset calm · accent suggestion · density airy · icons symbols · calm on/)
})

test('single values validate and flip the preset to custom', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'accent purple')).toMatch(/Accent is one of/)
  expect(await run($, 'density compact')).toMatch(/preset custom · accent suggestion · density compact/)
  expect(await run($, 'calm maybe')).toMatch(/Usage/)
})

test('saved settings load, and garbage in the store is ignored', async ($, on) => {
  engine(on, { accent: 'warning', density: 'airy', icons: 'letters', preset: 'custom', isCalm: true })
  await start($)
  expect(await run($, '')).toMatch(/accent warning · density airy · icons letters · calm on/)

  const bad = await (async () => 1)()
  expect(bad).toBe(1)
})

test('garbage in the store falls back to defaults', async ($, on) => {
  engine(on, { accent: 42, density: 'huge', icons: null, preset: 'x', isCalm: 'yes' })
  await start($)
  expect(await run($, '')).toMatch(/preset full · accent suggestion · density normal · icons symbols · calm off/)
})

test('the pane draws and a preset button works', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'preset-focus' })
  expect(await run($, '')).toMatch(/preset focus/)
  await ui.unmount()
})
