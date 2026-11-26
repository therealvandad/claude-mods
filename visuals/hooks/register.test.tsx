import { expect, test } from 'claude-code/testing'

import { altText, dashboardSvg, demoData, smoothPath, toolKind } from './svg'

const PANE = {
  plugin: 'visuals',
  component: 'Pane',
  requestId: 'visuals-main',
  surface: 'desktop',
  props: { title: 'Visuals', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime()

const engine = (on: (...args: any[]) => unknown, opts: { motion?: boolean; calm?: boolean } = {}) => {
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('state.get', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'motion' && e.key === 'isOn') {
      return { value: { value: opts.motion !== false, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'isCalm') {
      return { value: { value: opts.calm === true, version: 1 } }
    }

    return next(e)
  })
  on('session.usage', () => ({ value: { startedAt: NOW - 600000, context: { window: 1000, percent: 40 }, rateLimits: [], cost: { usd: 1.25 } } }))
}
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args, origin: 'user' } as any)) as { text: string }).text
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const look = { accent: 'suggestion', animate: true, elapsed: '47m', today: '2026-11-25' } as const

test('the dashboard SVG is small, safe and well formed', () => {
  const svg = dashboardSvg(demoData(NOW), look)
  expect(svg.length).toBeLessThan(40_000)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect(svg).not.toMatch(/<script|on[a-z]+=|javascript:|<foreignObject|href=/i)
  expect((svg.match(/<svg/g) ?? []).length).toBe(1)
  expect(svg).toContain('@media (prefers-color-scheme:dark)')
})

test('motion off gives a still SVG with no animation at all', () => {
  const still = dashboardSvg(demoData(NOW), { ...look, animate: false })
  expect(still).not.toMatch(/@keyframes|animation:|<animate/)
  expect(dashboardSvg(demoData(NOW), look)).toMatch(/@keyframes sweep/)
})

test('text from tool names cannot break out of the SVG', () => {
  const d = demoData(NOW)
  d.tools = { '<script>alert(1)</script>': 5, 'a"b&c': 2 }
  const svg = dashboardSvg(d, look)
  expect(svg).not.toContain('<script>')
  expect(svg).toContain('&lt;script&gt;')
  expect(svg).toContain('a&quot;b&amp;c')
})

test('odd numbers are clamped, not drawn outside the ring', () => {
  const d = demoData(NOW)
  d.contextPct = 250
  d.limitPct = -40
  d.spendUsd = Number.NaN
  const svg = dashboardSvg(d, look)
  expect(svg).not.toContain('NaN')
  expect(svg).not.toContain('undefined')
})

test('the smooth path handles one point, two points and many', () => {
  expect(smoothPath([])).toBe('')
  expect(smoothPath([[1, 2]])).toBe('M1 2')
  expect(smoothPath([[0, 0], [10, 10]])).toMatch(/^M0 0 C/)
  expect(smoothPath([[0, 0], [5, 8], [10, 2], [15, 9]]).split('C').length).toBe(4)
  expect(altText(demoData(NOW))).toMatch(/context 63 percent/)
})

test('the pane draws one Svg, interactive only while animating', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'visdemo')
  const ui = await $.ui.mount(PANE)
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  await ui.unmount()
})

test('motion off or calm: the pane carries the still version', async ($, on) => {
  engine(on, { motion: false })
  await start($)
  await run($, 'visdemo')
  const ui = await $.ui.mount(PANE)
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).not.toMatch(/@keyframes/)
  expect(tree).toMatch(/Still version/)
  await ui.unmount()
})

test('demo on and off, and reset', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'visdemo')).toMatch(/made-up sample data/)
  expect(await run($, 'visdemo', 'off')).toBe('Demo data off.')
  expect(await run($, 'visreset')).toBe('Visuals data cleared.')
})

test('every drawn part carries a hover title, and tool kinds are stable', () => {
  const svg = dashboardSvg(demoData(NOW), look)
  expect((svg.match(/<title>/g) ?? []).length).toBeGreaterThan(90)
  expect(svg).toContain('Context window: 63% used')
  expect(svg).toContain('Bash: 42 calls')
  expect(toolKind('Bash')).toBe(2)
  expect(toolKind('Edit')).toBe(3)
  expect(toolKind('Grep')).toBe(4)
  expect(toolKind('mcp__x__y')).toBe(1)
})

test('the still version keeps the hover titles and loses all motion', () => {
  const still = dashboardSvg(demoData(NOW), { ...look, animate: false })
  expect(still).toContain('<title>')
  expect(still).not.toMatch(/@keyframes|animation:|filter:drop-shadow/)
})

test('DUMP svg for preview', () => {
  console.log('@@SVG:animated@@' + dashboardSvg(demoData(NOW), look) + '@@END@@')
  console.log('@@SVG:still@@' + dashboardSvg(demoData(NOW), { ...look, animate: false }) + '@@END@@')
})

test('the chart is given a real width AND height, in proportion', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'visdemo')
  const ui = await $.ui.mount(PANE)
  const tree = JSON.stringify(await ui.drawn())
  const width = Number(/"width":(\d+)/.exec(tree)?.[1] ?? 0)
  const height = Number(/"height":(\d+)/.exec(tree)?.[1] ?? 0)
  expect(width).toBeGreaterThanOrEqual(360)
  expect(height).toBeGreaterThanOrEqual(300)
  await ui.unmount()
})
