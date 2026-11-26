import { expect, test } from 'claude-code/testing'

const row = (plugin: string, word: string) => ({
  plugin,
  tree: { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: [word] }] },
})

const LIST = (rows: unknown[], hasSurvey = false) =>
  ({
    plugin: 'band-tidy',
    component: 'AbovePromptList',
    surface: 'desktop',
    props: { rows, hasSurvey, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80 },
  }) as any

const engine = (on: (...args: any[]) => unknown, saved: unknown = undefined) => {
  on('command.register', () => ({ value: { command: 'tidy' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: saved }))
  on('store.set', () => ({ value: undefined }))
}
const run = async ($: any, args: string) => ((await $.command.run({ command: 'tidy', args, origin: 'user' } as any)) as { text: string }).text
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const drawnText = async (ui: any) => JSON.stringify(await ui.drawn())

const ROWS = [row('cockpit', 'KEEP-COCKPIT'), row('workbench', 'HIDE-WORKBENCH'), row('animations', 'HIDE-ANIM'), row('safety-pro', 'KEEP-SAFETY'), row('motion@local-mods', 'HIDE-MOTION')]

test('by default only the safety and summary rows stay', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(LIST(ROWS))
  const text = await drawnText(ui)
  expect(text).toContain('KEEP-COCKPIT')
  expect(text).toContain('KEEP-SAFETY')
  expect(text).not.toContain('HIDE-WORKBENCH')
  expect(text).not.toContain('HIDE-ANIM')
  expect(text).not.toContain('HIDE-MOTION')
  await ui.unmount()
})

test('keep brings a mod back, hide removes it, and a name with @marketplace still matches', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'keep motion')).toMatch(/may draw/)
  const ui = await $.ui.mount(LIST(ROWS))
  expect(await drawnText(ui)).toContain('HIDE-MOTION')
  await ui.unmount()
  expect(await run($, 'hide cockpit')).toMatch(/hidden/)
  const again = await $.ui.mount(LIST(ROWS))
  expect(await drawnText(again)).not.toContain('KEEP-COCKPIT')
  await again.unmount()
})

test('off shows everything, on tidies again, and a survey is never touched', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'off')
  const all = await $.ui.mount(LIST(ROWS))
  expect(await drawnText(all)).toContain('HIDE-WORKBENCH')
  await all.unmount()
  await run($, 'on')
  const survey = await $.ui.mount(LIST(ROWS, true))
  expect(await drawnText(survey)).toContain('HIDE-WORKBENCH')
  await survey.unmount()
})

test('rows lists who is drawing, and reset restores the defaults', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(LIST(ROWS))
  await ui.unmount()
  expect(await run($, 'rows')).toMatch(/cockpit, workbench, animations, safety-pro, motion/)
  await run($, 'keep workbench')
  expect(await run($, 'reset')).toMatch(/reset/)
  expect(await run($, '')).toMatch(/cockpit, alerts, safety-pro, controls/)
})

test('bad names are refused and garbage in the store falls back to the defaults', async ($, on) => {
  engine(on, { isOn: 'yes', keep: ['ok-name', 42, '../etc', 'Has Space'] })
  await start($)
  expect(await run($, 'keep ../../x')).toMatch(/Usage/)
  expect(await run($, 'hide')).toMatch(/Usage/)
  expect(await run($, '')).toMatch(/Showing rows from: ok-name\./)
})
