import { expect, test } from 'claude-code/testing'

test('this mod draws its section in the shared Mod manager panel and the button works', async ($, on) => {
  const saved: Record<string, unknown> = {}
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  const ui = await $.ui.mount({
    plugin: 'mod-manager',
    component: 'Pane',
    requestId: 'mod-settings',
    surface: 'desktop',
    props: { title: 'Mod manager', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as any)

  await ui.press({ key: 'mo-on', plugin: 'motion' })
  expect(saved.motion).toBe(false)
  await ui.unmount()
})
