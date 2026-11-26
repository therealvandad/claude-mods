import { expect, test } from 'claude-code/testing'

import {
  EMPTY,
  LEVELS,
  PALETTES,
  PALETTE_IDS,
  describe as describeComp,
  hsl,
  normalizeHex,
  parseComp,
  resolve,
  resolveName,
  swatchesOf,
} from './palettes'
import type { Comp, Level } from './palettes'
import { SCENES } from './scenes'

// ---- palettes: none may be one Desktop refuses to paint ----

test('there are fifteen named palettes', () => {
  expect(PALETTE_IDS.length).toBe(15)
  expect([...PALETTE_IDS].sort()).toEqual(
    ['amber', 'blueprint', 'chalkboard', 'desert', 'duotone', 'forest', 'mono', 'neon', 'newspaper', 'notebook', 'ocean', 'pastel', 'sticky-note', 'sunrise', 'terminal-green'].sort(),
  )
})

// One test per contrast step, so each stays far below the 5 s limit even on a busy machine.
for (const level of LEVELS) {
  test(`every palette paints at contrast ${level}, with every corner setting`, () => {
    const refused: string[] = []
    let count = 0

    for (const id of PALETTE_IDS) {
      for (const corners of [null, 'round', 'square'] as const) {
        const r = resolve({ ...EMPTY, base: id, level, corners })

        count += 1

        if (r.refusal !== null) {
          refused.push(`${id}/${level}/${corners}: ${r.refusal}`)
        }
        expect(r.args?.colors).toBeDefined()
      }
    }
    expect(count).toBe(15 * 3)
    expect(refused).toEqual([])
  })
}

test('the plain base used by a bare contrast step paints too', () => {
  for (const level of LEVELS) {
    const r = resolve({ ...EMPTY, level })

    expect(r.refusal).toBeNull()
    expect(level === 'normal' || r.args?.colors !== undefined).toBe(true)
  }
})

const spreadHexes = () => {
  const hexes = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#fafafa', '#050505', '#f0e68c']

  for (let h = 0; h < 360; h += 20) {
    for (const [s, l] of [[100, 50], [100, 8], [100, 94], [30, 60], [5, 50]] as const) {
      hexes.push(hsl(h, s, l))
    }
  }

  return hexes
}

// One test per contrast step and half of the colours, so none runs long.
for (const level of LEVELS) {
  for (const part of [0, 1] as const) {
    test(`an accent from one hex paints for a wide spread of colours at ${level} (part ${part + 1} of 2)`, () => {
      const all = spreadHexes()
      const hexes = all.filter((_, i) => i % 2 === part)
      const refused: string[] = []

      for (const hex of hexes) {
        const r = resolve({ ...EMPTY, base: `accent:${hex}`, level })

        if (r.refusal !== null) {
          refused.push(`${hex}/${level}: ${r.refusal}`)
        }
      }
      expect(hexes.length).toBeGreaterThan(40)
      expect(refused).toEqual([])
    })
  }
}

test('hex input is validated and normalised', () => {
  expect(normalizeHex('#E8F')).toBe('#ee88ff')
  expect(normalizeHex('e8643c')).toBe('#e8643c')
  expect(normalizeHex('#12345')).toBeNull()
  expect(normalizeHex('red')).toBeNull()
  expect(normalizeHex('#gggggg')).toBeNull()
  expect(normalizeHex('')).toBeNull()
})

test('contrast steps move the text anchors, and max asks for more', () => {
  const textOf = (level: Level) => {
    const r = resolve({ ...EMPTY, base: 'forest', level })

    return JSON.stringify(r.args?.colors)
  }
  const all = LEVELS.map(textOf)

  expect(new Set(all).size).toBe(4)
  expect((resolve({ ...EMPTY, base: 'forest', level: 'max' }).args?.colors as { contrast?: string }).contrast).toBe('more')
  expect((resolve({ ...EMPTY, base: 'forest', level: 'sharp' }).args?.colors as { contrast?: string }).contrast).toBeUndefined()
  expect((resolve({ ...EMPTY, base: 'forest', level: 'soft' }).args?.colors as { contrast?: string }).contrast).toBeUndefined()
})

test('corners put a radius on the message and tool rows and keep a palette style', () => {
  const round = resolve({ ...EMPTY, base: 'sticky-note', corners: 'round' }).args!
  const square = resolve({ ...EMPTY, corners: 'square' }).args!
  const user = round.style!.UserMessage as { radius: number; rotate: number }[]

  expect(user.map(r => r.radius)).toEqual([18, 18])
  expect(user[0]!.rotate).toBe(-1.5)
  expect((round.style!.AssistantMessage as { radius: number; backgroundColor: string }).backgroundColor).toBe('#fbf6e9')
  expect((square.style!.UserMessage as { radius: number }).radius).toBe(0)
  expect((square.style!.ToolUse as { radius: number }).radius).toBe(0)
  expect(square.colors).toBeUndefined()
  expect(square.style!.AssistantMessage).toBeUndefined()
})

test('glass and grain choose a scene, glass with its own frosting', () => {
  const glass = resolve({ ...EMPTY, base: 'ocean', glass: true }).args!
  const grain = resolve({ ...EMPTY, grain: true }).args!

  expect(glass.backdrop).toEqual({ scene: 'glass', glass: { blur: 28, opacity: 0.5 } })
  expect((grain.backdrop as { scene: string }).scene).toBe('grain')
  expect(grain.colors).toBeUndefined()
  expect(resolve({ ...EMPTY, base: 'sticky-note' }).args!.backdrop).toEqual({ color: '#b98a5a' })
})

test('nothing chosen resolves to nothing', () => {
  expect(resolve(EMPTY).args).toBeUndefined()
  expect(describeComp(EMPTY)).toContain('none')
})

test('names, aliases and saved values', () => {
  expect(resolveName('Terminal')).toBe('terminal-green')
  expect(resolveName('sticky')).toBe('sticky-note')
  expect(resolveName('chalk')).toBe('chalkboard')
  expect(resolveName('nope')).toBeNull()
  expect(parseComp({ base: 'forest', level: 'max', corners: 'round', glass: true, grain: true })).toEqual({
    base: 'forest',
    level: 'max',
    corners: 'round',
    glass: true,
    grain: false,
  })
  expect(parseComp({ base: 'nope' })).toBeNull()
  expect(parseComp({ base: 'accent:#12345' })).toBeNull()
  expect(parseComp('x')).toBeNull()
  expect(parseComp({ base: 'accent:#aabbcc', level: 'weird' })?.level).toBe('normal')
})

test('swatches are raw hex for every palette', () => {
  for (const id of PALETTE_IDS) {
    const sw = swatchesOf(PALETTES[id]!.def)

    expect(sw.light.length + sw.dark.length).toBeGreaterThan(0)
    expect(sw.accent).toMatch(/^#[0-9a-f]{6}$/)

    for (const s of [...sw.light, ...sw.dark]) {
      expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
    }
  }
})

// ---- scenes: still, pure vector, within the engine's limits ----

const FORBIDDEN = [/<image/i, /<foreignObject/i, /<script/i, /href/i, /@import/i, /@font-face/i, /CDATA/, /&/, /<!--/, /\/\*/, /url\((?!#)/, /@keyframes/, /animation/]

test('both scenes are plain, still vector', () => {
  expect(Object.keys(SCENES).sort()).toEqual(['glass', 'grain'])

  for (const name of Object.keys(SCENES)) {
    const svg = SCENES[name]!.svg

    expect(svg.length).toBeLessThan(131072)
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('viewBox="0 0 1600 900"')
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"')
    expect(svg).toContain('prefers-color-scheme: dark')

    for (const bad of FORBIDDEN) {
      expect(`${name} ${bad} ${bad.test(svg)}`).toBe(`${name} ${bad} false`)
    }
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
  }
})

// ---- the engine ----

type Sent = Record<string, unknown>

const setup = (on: (...args: any[]) => unknown, store: Record<string, unknown> = {}, isStyleRefused = false) => {
  const sets: Sent[] = []
  const calls = { clear: 0 }

  on('command.register', () => ({ value: { command: 'skuse' } }))
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
    if (isStyleRefused && e.style !== undefined) {
      throw new Error('style not supported')
    }
    sets.push(e)

    return { value: { isDrawn: true, requestId: 'r' } }
  })
  on('theme.clear', () => {
    calls.clear += 1

    return { value: { isDrawn: true, requestId: 'r' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))

  return { sets, calls, store }
}

const start = ($: any) => $.session.start({ cwd: '/work/a', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args })) as { text: string }).text
const use = ($: any, args: string) => run($, 'skuse', args)

test('by default nothing is applied: session start calls neither theme.set nor theme.clear', async ($, on) => {
  const t = setup(on)
  await start($)

  expect(t.sets).toEqual([])
  expect(t.calls.clear).toBe(0)
})

test('/sk lists every command, one line each', async ($, on) => {
  setup(on)
  await start($)
  const out = await run($, 'sk')

  for (const word of ['/skuse', 'accent', 'contrast', 'corners', 'glass', 'grain', '/skpreview', '/skremember', '/skreset', 'off']) {
    expect(out).toContain(word)
  }
})

test('/skuse with no argument lists the fifteen palettes and applies nothing', async ($, on) => {
  const t = setup(on)
  await start($)
  const out = await use($, '')

  for (const id of PALETTE_IDS) {
    expect(out).toContain(id)
  }
  expect(t.sets).toEqual([])
  expect(t.calls.clear).toBe(0)
})

test('/skuse <name> calls theme.set once, with colours, and nothing is stored while remember is off', async ($, on) => {
  const t = setup(on)
  await start($)
  await use($, 'off')
  const clears = t.calls.clear
  const out = await use($, 'forest')

  expect(out).toContain('Applied: palette Forest')
  expect(t.sets.length).toBe(1)
  expect(t.sets[0]!.colors).toBeDefined()
  expect(t.sets[0]!.backdrop).toBeUndefined()
  expect(t.calls.clear).toBe(clears)
  expect(t.store).toEqual({})
})

test('every palette can be applied by name', async ($, on) => {
  const t = setup(on)
  await start($)

  for (const id of PALETTE_IDS) {
    const before = t.sets.length
    const out = await use($, id)

    expect(out).toContain('Applied')
    expect(t.sets.length).toBe(before + 1)
  }
  const neon = await use($, 'neon')

  expect(neon).toContain('Neon outline')
  expect(t.sets[t.sets.length - 1]!.style).toBeDefined()
})

test('/skuse off clears once and forgets the choice', async ($, on) => {
  const t = setup(on)
  await start($)
  await use($, 'ocean')
  const clears = t.calls.clear

  const out = await use($, 'off')

  expect(out).toContain("app's own look")
  expect(t.calls.clear).toBe(clears + 1)
  expect(await use($, '')).toContain('Now: none')
})

test('an unknown name changes nothing', async ($, on) => {
  const t = setup(on)
  await start($)
  const before = t.sets.length
  const out = await use($, 'bubblegum')

  expect(out).toContain('No skin called')
  expect(t.sets.length).toBe(before)
})

test('/skuse accent builds a theme from one hex and refuses a bad one', async ($, on) => {
  const t = setup(on)
  await start($)
  const bad = await use($, 'accent banana')
  const before = t.sets.length

  expect(bad).toContain('Usage')
  expect(t.sets.length).toBe(before)

  const out = await use($, 'accent #E8643C')

  expect(out).toContain('accent #e8643c')
  expect(t.sets.length).toBe(before + 1)
  expect(t.sets[t.sets.length - 1]!.colors).toBeDefined()

  const short = await use($, 'accent 0af')

  expect(short).toContain('accent #00aaff')
})

test('contrast steps re-send the current palette with different colours', async ($, on) => {
  const t = setup(on)
  await start($)
  await use($, 'desert')
  const normal = JSON.stringify(t.sets[t.sets.length - 1]!.colors)

  await use($, 'contrast sharp')
  const sharp = JSON.stringify(t.sets[t.sets.length - 1]!.colors)

  await use($, 'contrast max')
  const max = t.sets[t.sets.length - 1]!.colors as { contrast?: string }

  expect(sharp).not.toBe(normal)
  expect(max.contrast).toBe('more')
  expect(await use($, 'contrast loud')).toContain('Usage')
  expect(await use($, '')).toContain('contrast max')
})

test('corners apply a style radius on top of the palette', async ($, on) => {
  const t = setup(on)
  await start($)
  await use($, 'pastel')
  await use($, 'corners square')
  const sent = t.sets[t.sets.length - 1] as { colors: unknown; style: { UserMessage: { radius: number; backgroundColor: string } } }

  expect(sent.colors).toBeDefined()
  expect(sent.style.UserMessage.radius).toBe(0)
  expect(sent.style.UserMessage.backgroundColor).toBe('surface-2')

  await use($, 'rounded')
  expect((t.sets[t.sets.length - 1] as typeof sent).style.UserMessage.radius).toBe(18)
  expect(await use($, 'corners wavy')).toContain('Usage')
})

test('glass and grain are scenes and exclude each other', async ($, on) => {
  const t = setup(on)
  await start($)
  await use($, 'glass on')
  expect((t.sets[t.sets.length - 1] as { backdrop: { scene: string } }).backdrop.scene).toBe('glass')

  await use($, 'grain')
  const grain = t.sets[t.sets.length - 1] as { backdrop: { scene: string } }

  expect(grain.backdrop.scene).toBe('grain')
  expect(await use($, '')).not.toContain('glass cards')

  const clears = t.calls.clear

  await use($, 'grain off')
  // Nothing is left chosen, so the app's own look comes back with one clear.
  expect(t.calls.clear).toBe(clears + 1)

  await use($, 'ocean')
  await use($, 'grain on')
  await use($, 'grain off')
  expect((t.sets[t.sets.length - 1] as { backdrop?: unknown }).backdrop).toBeUndefined()
})

test('remember is off by default; on saves the choice and a new session re-applies it once', async ($, on) => {
  const store: Record<string, unknown> = {}
  const t = setup(on, store)
  await start($)
  await use($, 'amber')
  expect(store.comp).toBeUndefined()
  expect(await run($, 'skremember', '')).toContain('off')

  expect(await run($, 'skremember', 'on')).toContain('Saved')
  expect(store.remember).toBe(true)
  expect((store.comp as Comp).base).toBe('amber')

  const before = t.sets.length

  await start($)
  expect(t.sets.length).toBe(before + 1)
  expect(t.calls.clear).toBeGreaterThanOrEqual(0)

  await run($, 'skremember', 'off')
  expect(store.remember).toBeUndefined()
  expect(store.comp).toBeUndefined()
  await start($)
  expect(t.sets.length).toBe(before + 1)
})

test('a garbage saved choice is ignored even with remember on', async ($, on) => {
  const t = setup(on, { remember: true, comp: { base: 'nope' } })
  await start($)

  expect(t.sets).toEqual([])
})

test('/skreset forgets the saved choice and clears what skins applied', async ($, on) => {
  const store: Record<string, unknown> = {}
  const t = setup(on, store)
  await start($)
  await run($, 'skremember', 'on')
  await use($, 'chalkboard')
  expect((store.comp as Comp).base).toBe('chalkboard')
  const clears = t.calls.clear

  const out = await run($, 'skreset')

  expect(out).toContain('cleared')
  expect(store).toEqual({})
  expect(t.calls.clear).toBe(clears + 1)

  const again = await run($, 'skreset')

  expect(again).toContain('left alone')
  expect(t.calls.clear).toBe(clears + 1)
})

test('a build that refuses style still gets the colours', async ($, on) => {
  const t = setup(on, {}, true)
  await start($)
  const out = await use($, 'newspaper')

  expect(out).toContain('Left out: style')
  expect(t.sets.length).toBe(1)
  expect(t.sets[0]!.colors).toBeDefined()
  expect(t.sets[0]!.style).toBeUndefined()
})

// ---- the preview pane ----

const PANE = {
  plugin: 'skins',
  component: 'Pane',
  requestId: 'skins-main',
  surface: 'desktop',
  props: { title: 'Skins', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('/skpreview opens the pane and refuses an unknown palette', async ($, on) => {
  setup(on)
  await start($)

  expect(await run($, 'skpreview', '')).toContain('Skins pane opened')
  expect(await run($, 'skpreview', 'ocean')).toContain('Ocean first')
  expect(await run($, 'skpreview', 'plaid')).toContain('No palette called')
})

test('the pane draws a swatch grid with raw hex chips and one Apply button per palette', async ($, on) => {
  setup(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  const boxes = await ui.findAll({ type: 'Box' })
  const hexes = boxes.map(b => b.props.backgroundColor).filter((c): c is string => typeof c === 'string')

  expect(hexes.length).toBeGreaterThan(15 * 4)

  for (const h of hexes) {
    expect(h).toMatch(/^#[0-9a-f]{6}$/)
  }
  expect(hexes).toContain(PALETTES.forest!.def.dark!.gray!.anchors!['surface-0'])
  expect(hexes).toContain('#b3541e')

  for (const id of PALETTE_IDS) {
    const button = await ui.find({ type: 'Button', key: `apply-${id}` })

    expect(button?.props.label).toBe('Apply')
  }
  await ui.unmount()
})

test('pressing Apply in the pane applies that palette', async ($, on) => {
  const t = setup(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  const before = t.sets.length

  await ui.press({ key: 'apply-blueprint' })
  expect(t.sets.length).toBe(before + 1)
  expect(await use($, '')).toContain('Blueprint')

  await ui.press({ key: 'contrast-sharp' })
  expect(t.sets.length).toBe(before + 2)

  await ui.press({ key: 'skins-off' })
  expect(await use($, '')).toContain('Now: none')
  await ui.unmount()
})

test('the pane marks the palette that is on and puts a previewed one first', async ($, on) => {
  setup(on)
  await start($)
  await use($, 'desert')
  await run($, 'skpreview', 'ocean')
  const ui = await $.ui.mount(PANE)
  const apply = await ui.findAll({ type: 'Button' })
  const labels = apply.filter(b => String(b.key).startsWith('apply-')).map(b => `${b.key}:${b.props.label}`)

  expect(labels[0]).toBe('apply-ocean:Apply')
  expect(labels).toContain('apply-desert:Applied')
  await ui.unmount()
})

// ---- the backdrop hook ----

test('the backdrop hook draws a skins scene and leaves any other to the engine', async ($, on) => {
  setup(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const mine = await $.ui.mount({
    plugin: 'skins',
    component: 'Backdrop',
    requestId: 'skins-backdrop',
    surface: 'desktop',
    props: { scene: 'grain', plugin: 'skins', glass: { blur: 6, opacity: 0.55 } },
  })

  expect(await mine.find({ type: 'Svg' })).toBeDefined()
  await mine.unmount()

  const other = await $.ui.mount({
    plugin: 'skins',
    component: 'Backdrop',
    requestId: 'skins-backdrop-other',
    surface: 'desktop',
    props: { scene: 'fog', plugin: 'looks', glass: false },
  })

  expect(await other.find({ type: 'Svg' })).toBeUndefined()
  expect(await other.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await other.unmount()
})
