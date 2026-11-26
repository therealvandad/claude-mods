import { expect, test } from 'claude-code/testing'

import {
  MODEL_ACCENTS,
  PHASE_PALETTES,
  SEASON_PALETTES,
  allResolved,
  build,
  familyOf,
  phaseOf,
  seasonOf,
  sunsetAccent,
} from './palettes'
import { SCENES, SCENE_NAMES } from './scenes'

// ---- palettes: none may be one Desktop refuses to paint ----

test('every palette this mod can produce paints in Desktop', () => {
  const all = allResolved()
  const refused: string[] = []

  for (const r of all) {
    const { problems } = build(r)

    for (const line of problems) {
      if (line.startsWith("Desktop won't paint")) {
        refused.push(`${r.id}: ${line}`)
      }
    }
  }
  expect(all.length).toBeGreaterThan(60)
  expect(refused).toEqual([])
})

test('the requested looks all exist', () => {
  const ids = allResolved().map(r => r.id)

  for (const id of ['paper', 'terminal', 'nord', 'solarized-day', 'solarized-night', 'contrast', 'muted', 'sepia', 'colorblind', 'autumn', 'snow', 'spring']) {
    expect(ids).toContain(id)
  }
  expect(Object.keys(PHASE_PALETTES).sort()).toEqual(['dawn', 'dusk', 'night', 'noon'])
  expect(Object.keys(SEASON_PALETTES)).toContain('snow')
})

test('time of day, season and sunset follow the clock', () => {
  expect(phaseOf(3)).toBe('night')
  expect(phaseOf(7)).toBe('dawn')
  expect(phaseOf(12)).toBe('noon')
  expect(phaseOf(18)).toBe('dusk')
  expect(phaseOf(22)).toBe('night')
  expect(seasonOf(0)).toBe('snow')
  expect(seasonOf(3)).toBe('spring')
  expect(seasonOf(9)).toBe('autumn')
  expect(sunsetAccent(6)).toBe('#d9901a')
  expect(sunsetAccent(23)).toBe('#7c5cd6')
  expect(sunsetAccent(9)).not.toBe(sunsetAccent(15))
  expect(familyOf('claude-sonnet-5-5')).toBe('sonnet')
  expect(familyOf('opus')).toBe('opus')
  expect(familyOf('gpt')).toBe(null)
  expect(Object.keys(MODEL_ACCENTS)).toContain('haiku')
})

test('nord asks for the nord code theme and contrast asks for more', () => {
  const nord = allResolved().find(r => r.id === 'nord')!
  const contrast = allResolved().find(r => r.id === 'contrast')!

  expect((build(nord).theme as { codeTheme?: { dark?: string } }).codeTheme?.dark).toBe('nord')
  expect((build(contrast).theme as { contrast?: string }).contrast).toBe('more')
})

// ---- scenes: pure vector, plain, within the engine's limits ----

const FORBIDDEN = [/<image/i, /<foreignObject/i, /<script/i, /href/i, /@import/i, /@font-face/i, /CDATA/, /&/, /<!--/, /\/\*/, /url\((?!#)/]

test('every scene is plain vector and fits', () => {
  expect([...SCENE_NAMES].sort()).toEqual(
    ['aurora', 'breathe', 'candle', 'code', 'fireflies', 'fog', 'glass', 'horizon', 'ocean', 'rain', 'snow', 'starfield'].sort(),
  )

  for (const name of SCENE_NAMES) {
    const svg = SCENES[name]!.svg

    expect(svg.length).toBeLessThan(131072)
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('viewBox="0 0 1600 900"')
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"')
    expect(svg).toContain('@keyframes')
    expect(svg).toContain('prefers-color-scheme: dark')

    for (const bad of FORBIDDEN) {
      expect(`${name} ${bad} ${bad.test(svg)}`).toBe(`${name} ${bad} false`)
    }
    // Tags open and close in order.
    const stack: string[] = []

    for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
      const [, closing, tag, , selfClosing] = m

      if (selfClosing === '/') {
        continue
      }

      if (closing === '/') {
        expect(stack.pop()).toBe(tag)
      } else {
        stack.push(tag!)
      }
    }
    expect(stack).toEqual([])

    // Nothing flashes: every animation takes a second and a half or more.
    for (const m of svg.matchAll(/animation-duration:([\d.]+)s/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(1.5)
    }
  }
})

// ---- the engine ----

type Sent = Record<string, unknown>

const setup = (on: (...args: any[]) => unknown, store: Record<string, unknown> = {}, now = Date.UTC(2026, 5, 1, 12)) => {
  const sets: Sent[] = []
  const calls = { clear: 0, every: 0 }

  on('clock.now', () => ({ value: now }))
  on('clock.every', () => {
    calls.every += 1

    return { value: { cancel() {} } }
  })
  on('command.register', () => ({ value: { command: 'look' } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete store[e.key]

    return { value: undefined }
  })
  on('theme.set', (_: unknown, e: Sent) => {
    sets.push(e)

    return { value: { isDrawn: true, requestId: 'r' } }
  })
  on('theme.clear', () => {
    calls.clear += 1

    return { value: { isDrawn: true, requestId: 'r' } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))

  return { sets, calls, store }
}

const start = ($: any, cwd = '/work/a') => $.session.start({ cwd, surface: 'desktop', isInteractive: true })
const step = async ($: any, turnId: string, index: number, model: string) => {
  for await (const _chunk of $.turn.step({ turnId, index, model, messageCount: index + 1 })) {
    // The model's reply streams by; only the hook's side effect matters here.
  }
}
const look = ($: any, args: string) => $.command.run({ command: 'look', args })

test('by default there is no theme: it clears and sets nothing', async ($, on) => {
  const t = setup(on)
  await start($)

  expect(t.calls.clear).toBe(1)
  expect(t.sets).toEqual([])
  expect(t.calls.every).toBe(0)
})

test('/look lists the looks and what is on', async ($, on) => {
  setup(on)
  await start($)
  const out = await look($, '')

  expect(out.text).toContain('Look: none')
  for (const word of ['paper', 'nord', 'solarized-day', 'sepia', 'colorblind', 'autumn', 'auto', 'season', 'sunset', 'scene', 'project', 'model']) {
    expect(out.text).toContain(word)
  }
})

test('/look paper sets colors and remembers; a new session re-applies it', async ($, on) => {
  const store: Record<string, unknown> = {}
  const t = setup(on, store)
  await start($)
  const out = await look($, 'paper')

  expect(out.text).toContain('Warm paper')
  expect(store.look).toBe('paper')
  expect(t.sets.length).toBe(1)
  expect((t.sets[0] as { colors?: unknown }).colors).toBeDefined()
  expect((t.sets[0] as { backdrop?: unknown }).backdrop).toBeUndefined()

  await start($)
  expect(t.sets.length).toBe(2)
})

test('/look off clears and forgets', async ($, on) => {
  const store: Record<string, unknown> = { look: 'nord' }
  const t = setup(on, store)
  await start($)
  expect(t.sets.length).toBe(1)
  const clears = t.calls.clear

  await look($, 'off')
  expect(store.look).toBeUndefined()
  expect(t.calls.clear).toBe(clears + 1)
})

test('an unknown look is refused with no change', async ($, on) => {
  const t = setup(on)
  await start($)
  const out = await look($, 'neon-bubblegum')

  expect(out.text).toContain('No look called')
  expect(t.sets).toEqual([])
})

test('auto, sunset and season re-check on a 30 minute timer; a fixed look does not', async ($, on) => {
  const t = setup(on)
  await start($)
  await look($, 'sepia')
  expect(t.calls.every).toBe(0)
  await look($, 'auto')
  expect(t.calls.every).toBe(1)
  await look($, 'sunset')
  expect(t.calls.every).toBe(2)
  await look($, 'season')
  expect(t.calls.every).toBe(3)
})

test('a folder binding wins at session start and unbinds', async ($, on) => {
  const store: Record<string, unknown> = { look: 'paper' }
  const t = setup(on, store)
  await start($, '/work/a')
  await look($, 'project nord')
  expect(store.projects).toEqual({ '/work/a': 'nord' })

  await start($, '/work/a')
  const nordSet = t.sets[t.sets.length - 1] as { colors: { codeTheme?: { dark?: string } } }
  expect(nordSet.colors.codeTheme?.dark).toBe('nord')

  await start($, '/work/b')
  const other = t.sets[t.sets.length - 1] as { colors: { codeTheme?: { dark?: string } } }
  expect(other.colors.codeTheme?.dark).toBeUndefined()

  await start($, '/work/a')
  await look($, 'project off')
  expect(store.projects).toEqual({})
})

test('a scene draws a backdrop; motion off holds it back', async ($, on) => {
  const store: Record<string, unknown> = {}
  const t = setup(on, store)
  await start($)

  const out = await look($, 'scene aurora')
  expect(out.text).toContain('Aurora')
  expect((t.sets[t.sets.length - 1] as { backdrop: { scene: string } }).backdrop.scene).toBe('aurora')
  expect((t.sets[t.sets.length - 1] as { colors?: unknown }).colors).toBeUndefined()

  const clears = t.calls.clear
  await look($, 'motion off')
  expect(store.motion).toBe(false)
  expect(t.calls.clear).toBe(clears + 1)
  const held = await look($, 'scene rain')
  expect(held.text).toContain('motion is off')
  expect(t.sets.length).toBe(1)

  await look($, 'motion on')
  expect((t.sets[t.sets.length - 1] as { backdrop: { scene: string } }).backdrop.scene).toBe('rain')
})

test('a scene and a look go out in one theme', async ($, on) => {
  const t = setup(on, { look: 'muted', scene: 'glass' })
  await start($)
  const sent = t.sets[0] as { colors: unknown; backdrop: { scene: string; glass: { blur: number } } }

  expect(sent.colors).toBeDefined()
  expect(sent.backdrop.scene).toBe('glass')
  expect(sent.backdrop.glass.blur).toBe(48)
})

test('every scene can be chosen', async ($, on) => {
  const t = setup(on)
  await start($)

  for (const name of SCENE_NAMES) {
    await look($, `scene ${name}`)
    expect((t.sets[t.sets.length - 1] as { backdrop: { scene: string } }).backdrop.scene).toBe(name)
  }
  const bad = await look($, 'scene tornado')
  expect(bad.text).toContain('No scene')
})

test('the model accent follows the model family when on', async ($, on) => {
  const t = setup(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  await start($)
  await look($, 'model on')
  expect(t.sets).toEqual([])

  await step($, 't1', 0, 'claude-opus-4')
  expect(t.sets.length).toBe(1)
  const first = JSON.stringify(t.sets[0])

  await step($, 't1', 1, 'claude-opus-4')
  expect(t.sets.length).toBe(1)

  await step($, 't2', 0, 'claude-haiku-4')
  expect(t.sets.length).toBe(2)
  expect(JSON.stringify(t.sets[1])).not.toBe(first)
})

test('the backdrop hook draws the chosen scene', async ($, on) => {
  setup(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'looks',
    component: 'Backdrop',
    requestId: 'looks-backdrop',
    surface: 'desktop',
    props: { scene: 'fog', plugin: 'looks', glass: { blur: 16, opacity: 0.6 } },
  })
  const svg = await ui.find({ type: 'Svg' })

  expect(svg).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  await ui.unmount()
})

test('with motion off the backdrop hook draws nothing of its own', async ($, on) => {
  setup(on, { motion: false })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    plugin: 'looks',
    component: 'Backdrop',
    requestId: 'looks-backdrop-still',
    surface: 'desktop',
    props: { scene: 'fog', plugin: 'looks', glass: { blur: 16, opacity: 0.6 } },
  })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})
