import { expect, test } from 'claude-code/testing'

import { DEFAULT_OPTIONS, LOOKS, PREMIUM_NAMES, premiumColors, premiumStyle, scene, stepBar } from './premium'

const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const

const world = (on: (...args: any[]) => unknown) => {
  const w = { saved: {} as Record<string, unknown>, themes: [] as any[] }

  on('clock.now', () => ({ value: 1 }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: w.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    w.saved[e.key] = e.value

    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000, percent: 5 }, rateLimits: [], cost: { usd: 0 } } }))
  on('theme.set', (_: unknown, e: unknown) => {
    w.themes.push(e)

    return { value: { isDrawn: true } }
  })

  return w
}

test('every premium look is accepted with its colors, backdrop, glass and cards', async ($, on) => {
  const w = world(on)
  await $.session.start(START)

  for (const name of PREMIUM_NAMES) {
    const out = await $.command.run({ command: 'bar', args: `colors ${name}` } as any)
    const sent = JSON.stringify(w.themes[w.themes.length - 1])

    expect(out.text, name).toBe(`Colors: ${name}.`)
    expect(sent, name).toContain(`"scene":"${name}"`)
    expect(sent, name).toContain('"glass"')
    expect(sent, name).toContain('"AssistantMessage"')
    expect(sent, name).toContain(`"overrideColorScheme":"${LOOKS[name].mode}"`)
  }
})

test('size, glass and corners change what is sent', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'bar', args: 'colors aurora' } as any)
  await $.command.run({ command: 'bar', args: 'size large' } as any)
  expect(JSON.stringify(w.themes[w.themes.length - 1])).toContain('"fontSize":20')
  await $.command.run({ command: 'bar', args: 'glass solid' } as any)
  expect(JSON.stringify(w.themes[w.themes.length - 1])).toContain('"opacity":0.7')
  await $.command.run({ command: 'bar', args: 'corners sharp' } as any)
  expect(JSON.stringify(w.themes[w.themes.length - 1])).toContain('"radius":3')
  expect(w.saved.view).toMatchObject({ size: 'large', glass: 'solid', corners: 'sharp' })
})

test('the backdrops are small pure vector art, drawn on request', async ($, on) => {
  world(on)
  await $.session.start(START)

  for (const name of PREMIUM_NAMES) {
    const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Backdrop', surface: 'desktop', props: { scene: name } } as any)
    const svg = (await ui.find({ type: 'Svg' }))?.props.source as string

    expect(svg, name).toContain('@keyframes')
    expect(svg, name).toContain('preserveAspectRatio="xMidYMid slice"')
    expect(svg, name).not.toMatch(/<image|href|<filter|<script|url\(http/)
    expect(svg, name).not.toMatch(/="[^"<>]*"[A-Za-z]/)
    expect(svg.length, name).toBeLessThan(20_000)
    expect(scene(name, false), name).not.toContain('@keyframes')
    await ui.unmount()
  }
})

test('no premium color is refused, and each step bar is well formed', async () => {
  for (const name of PREMIUM_NAMES) {
    expect(premiumColors(name).problems.filter(x => x.startsWith("Desktop won't paint")), name).toEqual([])
    expect(JSON.stringify(premiumStyle(name, DEFAULT_OPTIONS))).toContain('radius')
    const bar = stepBar(name, 2, 5)
    expect((bar.source.match(/<rect/g) ?? []).length).toBe(5)
    expect((bar.source.match(/url\(#g\)/g) ?? []).length).toBe(2)
  }
})
