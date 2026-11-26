import { expect, test } from 'claude-code/testing'

import { CVDS, FAMILIES, MONTH_ACCENTS, contrastRatio, familyPalette, hsl, hslOf, lightnessSteps, luminance, monthAccent, normalizeHex, parseHexList, pickAccent, simulate } from './color'
import {
  ACCENT_CHOICES,
  BORDERS,
  CARDS,
  DEFAULT_FINISH,
  GRAYS,
  GROUNDS,
  PRESETS,
  PRESET_IDS,
  SHAPES,
  TONES,
  anchorsOf,
  backdropOf,
  defOf,
  describe as describeFinish,
  parseFinish,
  parseOpts,
  resolve,
  styleOf,
  withPreset,
} from './finish'
import type { Finish } from './finish'
import { makeColors } from './make-colors.js'
import { colourSvg, dataSvg, iconsSvg, miniSvg, sampleSvg, surfaceSvg, typeSvg } from './preview'
import { sceneSvg } from './scenes'
import { glyphFor, withGlyph } from './titles'

const fin = (over: Partial<Finish> = {}): Finish => ({ ...DEFAULT_FINISH, ...over })

// ---- colour maths ----

test('hex input is validated and normalised', () => {
  expect(normalizeHex('#E8F')).toBe('#ee88ff')
  expect(normalizeHex('e8643c')).toBe('#e8643c')
  expect(normalizeHex('#12345')).toBeNull()
  expect(normalizeHex('red')).toBeNull()
  expect(normalizeHex('')).toBeNull()
})

test('a pasted list is parsed leniently and bounded', () => {
  const r = parseHexList('#3b6fd4, e8643c;#abc\n  nope  #12 #00ff00')

  expect(r.colors).toEqual(['#3b6fd4', '#e8643c', '#aabbcc', '#00ff00'])
  expect(r.ignored).toBe(2)
  const many = parseHexList(Array.from({ length: 300 }, () => '#123456').join(' '))

  expect(many.colors.length).toBe(64)
})

test('the accent picked from a list is the most saturated mid-lightness colour', () => {
  // A near-white and a near-black are very saturated in HSL but not mid-lightness; a grey is mid but unsaturated.
  const list = ['#ffffff', '#000000', '#808080', '#fff5f5', '#0a0014', '#d9531e', '#6f8fb0']
  const r = pickAccent(list)

  expect(r).toEqual({ hex: '#d9531e', isMid: true })
  expect(pickAccent([])).toBeNull()
  // With nothing mid-lightness, the most saturated hue is kept and its lightness pulled into the band.
  const dark = pickAccent(['#0a0014', '#000a05'])!

  expect(dark.isMid).toBe(false)
  const { l } = hslOf(dark.hex)

  expect(l).toBeGreaterThanOrEqual(29)
  expect(l).toBeLessThanOrEqual(71)
})

test('every month has an accent and the index wraps', () => {
  expect(MONTH_ACCENTS.length).toBe(12)
  expect(new Set(MONTH_ACCENTS).size).toBe(12)
  expect(monthAccent(0)).toBe(MONTH_ACCENTS[0])
  expect(monthAccent(12)).toBe(MONTH_ACCENTS[0])
  expect(monthAccent(-1)).toBe(MONTH_ACCENTS[11])

  for (const hex of MONTH_ACCENTS) {
    const { l } = hslOf(hex)

    expect(l).toBeGreaterThan(30)
    expect(l).toBeLessThan(70)
  }
})

test('the colour-blind simulation uses the standard matrices and keeps greys grey', () => {
  expect(simulate('#e8643c', 'none')).toBe('#e8643c')

  for (const kind of CVDS) {
    const g = simulate('#808080', kind)
    const [r, gg, b] = [1, 3, 5].map(i => parseInt(g.slice(i, i + 2), 16))

    expect(Math.abs(r! - gg!)).toBeLessThanOrEqual(4)
    expect(Math.abs(gg! - b!)).toBeLessThanOrEqual(4)
    expect(simulate('#ffffff', kind)).toMatch(/^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/)
  }
  // Red and green collapse toward each other for red-green conditions, and stay apart for tritanopia.
  const d = (a: string, b: string) => {
    const x = hslOf(a)
    const y = hslOf(b)

    return Math.abs(x.h - y.h)
  }

  expect(d(simulate('#cc2222', 'deuteranopia'), simulate('#22aa22', 'deuteranopia'))).toBeLessThan(d('#cc2222', '#22aa22'))
  expect(luminance(simulate('#ff0000', 'protanopia'))).toBeLessThan(luminance('#ff0000'))
  expect(simulate('#3366cc', 'tritanopia')).not.toBe('#3366cc')
})

test('hue-family palettes step evenly from dark to light and stay one hue', () => {
  for (const [, hue] of Object.entries(FAMILIES)) {
    for (const mode of ['light', 'dark'] as const) {
      const p = familyPalette(hue, 5, mode)

      expect(p.length).toBe(5)
      expect(lightnessSteps(p).every(s => s > 4)).toBe(true)
      expect(Math.abs(hslOf(p[2]!).h - hue)).toBeLessThan(6)
    }
  }
  expect(familyPalette(200, 99, 'light').length).toBe(9)
  expect(familyPalette(200, 0, 'light').length).toBe(2)
})

// ---- every combination must paint ----

const problemsOf = (f: Finish): string[] => {
  const { problems } = makeColors({ label: 'x', ...defOf(f) })

  return problems.filter(p => p.startsWith("Desktop won't paint"))
}

for (const tone of TONES) {
  test(`every gray, contrast and role setting paints in tone ${tone}`, () => {
    const bad: string[] = []
    let count = 0

    for (const gray of GRAYS) {
      for (const contrast of ['normal', 'high'] as const) {
        for (const neutralFirst of [true, false]) {
          const f = fin({ gray, tone, contrast, neutralFirst })
          const r = resolve(f)

          count += 1

          if (r.refusal !== null || problemsOf(f).length > 0) {
            bad.push(`${gray}/${tone}/${contrast}/${neutralFirst}: ${r.refusal ?? problemsOf(f).join(' ')}`)
          }
          expect(r.args?.colors).toBeDefined()
        }
      }
    }
    expect(count).toBe(12)
    expect(bad).toEqual([])
  })
}

const SPREAD = (): string[] => {
  const hexes = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#fafafa', '#050505', '#f0e68c']

  for (let h = 0; h < 360; h += 30) {
    for (const [s, l] of [[100, 50], [100, 8], [100, 94], [40, 60]] as const) {
      hexes.push(hsl(h, s, l))
    }
  }

  return hexes
}

for (const tone of TONES) {
  for (const part of [0, 1] as const) {
    test(`a wide spread of accents paints in tone ${tone} (part ${part + 1} of 2)`, () => {
      const hexes = SPREAD().filter((_, i) => i % 2 === part)
      const bad: string[] = []

      for (const accent of hexes) {
        for (const gray of GRAYS) {
          const r = resolve(fin({ accent, tone, gray }))

          if (r.refusal !== null) {
            bad.push(`${accent}/${tone}/${gray}: ${r.refusal}`)
          }
        }
      }
      expect(hexes.length).toBeGreaterThan(25)
      expect(bad).toEqual([])
    })
  }
}

test('named accents, month accents and every preset paint', () => {
  for (const a of ACCENT_CHOICES) {
    expect(resolve(fin({ accent: a.hex })).refusal).toBeNull()
  }

  for (const hex of MONTH_ACCENTS) {
    expect(resolve(fin({ accent: hex })).refusal).toBeNull()
  }

  for (const id of PRESET_IDS) {
    const r = resolve(withPreset(DEFAULT_FINISH, id))

    expect(r.refusal).toBeNull()
    expect(r.args?.colors).toBeDefined()
  }
})

test('the surfaces never use pure white in light mode, and true black is only in the dark', () => {
  for (const gray of GRAYS) {
    for (const tone of TONES) {
      for (const contrast of ['normal', 'high'] as const) {
        const a = anchorsOf(fin({ gray, tone, contrast }))

        expect([a.light.s0, a.light.s1, a.light.s2]).not.toContain('#ffffff')
        expect(a.light.s0).not.toBe('#000000')
      }
    }
  }
  expect(anchorsOf(fin({ tone: 'true-black' })).dark.s0).toBe('#000000')
  expect(anchorsOf(fin({ tone: 'standard' })).dark.s0).not.toBe('#000000')
  // Off-white is warm, whatever gray was asked for.
  const off = anchorsOf(fin({ tone: 'off-white', gray: 'cool' })).light

  expect(hslOf(off.s2).h).toBeGreaterThan(30)
  expect(hslOf(off.s2).h).toBeLessThan(50)
})

test('text keeps its contrast on the surfaces in every tone', () => {
  for (const tone of TONES) {
    for (const gray of GRAYS) {
      const a = anchorsOf(fin({ gray, tone }))

      for (const m of [a.light, a.dark]) {
        expect(contrastRatio(m.t1, m.s0)).toBeGreaterThanOrEqual(7)
        expect(contrastRatio(m.t3, m.s0)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(m.t3, m.s2)).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
})

// ---- the theme a finish builds ----

test('the default finish is gray first: neutral surfaces and muted roles', () => {
  const a = anchorsOf(DEFAULT_FINISH)

  expect(hslOf(a.light.s0).s).toBeLessThan(2)
  expect(hslOf(a.dark.s1).s).toBeLessThan(2)
  expect(describeFinish(DEFAULT_FINISH)).toContain('neutral-first')
})

test('warm and cool grays lean toward their hue', () => {
  expect(Math.abs(hslOf(anchorsOf(fin({ gray: 'warm' })).light.s1).h - 36)).toBeLessThan(6)
  expect(Math.abs(hslOf(anchorsOf(fin({ gray: 'cool' })).dark.s1).h - 214)).toBeLessThan(8)
})

test('grounds map to the right backdrop', () => {
  expect(backdropOf(fin())).toBeUndefined()
  const band = backdropOf(fin({ ground: 'band' })) as { gradient: { stops: { at: number; color: string }[] } }

  expect(band.gradient.stops.map(s => s.color)).toEqual(['bg-accent', 'surface-0', 'surface-0'])
  expect(band.gradient.stops.map(s => s.at)).toEqual([0, 0.22, 1])
  expect((backdropOf(fin({ ground: 'paper' })) as { scene: string }).scene).toBe('paper')
  expect((backdropOf(fin({ ground: 'noise' })) as { scene: string }).scene).toBe('noise')
  const glass = backdropOf(fin({ ground: 'glass' })) as { scene: string; glass: { blur: number } }

  expect(glass.scene).toBe('glass')
  expect(glass.glass.blur).toBeGreaterThan(8)

  for (const g of GROUNDS) {
    expect(resolve(fin({ ground: g })).refusal).toBeNull()
  }
})

test('cards, borders, corners, weights, serif headings and handwriting go into the style', () => {
  expect(styleOf(fin())).toBeUndefined()
  const glossy = styleOf(fin({ card: 'glossy' }))!

  expect((glossy.UserMessage as { fill?: unknown }).fill).toBeDefined()
  expect((glossy.UserMessage as { shadow?: unknown }).shadow).toBeDefined()
  const matte = styleOf(fin({ card: 'matte' }))!

  expect((matte.UserMessage as { shadow: string }).shadow).toBe('none')
  expect((matte.UserMessage as { fill?: unknown }).fill).toBeUndefined()
  expect((styleOf(fin({ border: 'hairline' }))!.UserMessage as { borderWidth: number }).borderWidth).toBe(1)
  expect((styleOf(fin({ border: 'bold' }))!.UserMessage as { borderWidth: number }).borderWidth).toBeGreaterThanOrEqual(3)
  expect((styleOf(fin({ shape: 'pill' }))!.UserMessage as { radius: number }).radius).toBeGreaterThan(16)
  expect((styleOf(fin({ shape: 'square' }))!.ToolUse as { radius: number }).radius).toBe(0)
  expect(styleOf(fin({ headings: 'serif' }))!.Heading).toEqual({ fontFamily: ['serif'] })
  expect(styleOf(fin({ weights: 'hierarchy' }))!.Heading).toEqual({ fontWeight: 'bold' })
  expect(styleOf(fin({ weights: 'hierarchy' }))!.Text).toEqual({ fontWeight: 'regular' })
  const hand = styleOf(fin({ hand: true }))!.UserMessage as unknown as { fontFamily: string[]; fontSize: number; lineHeight: number }

  expect(hand.fontFamily).toEqual(['cursive'])
  expect(hand.lineHeight).toBeGreaterThanOrEqual(hand.fontSize)
  expect((styleOf(fin({ contrast: 'high' }))!.UserMessage as { borderWidth: number }).borderWidth).toBe(2)
  // Claude's replies stay unboxed whatever the card finish.
  expect(styleOf(fin({ card: 'glossy', border: 'bold', shape: 'pill' }))!.AssistantMessage).toBeUndefined()
})

test('every card, border and corner combination resolves, and high contrast asks for more', () => {
  for (const card of CARDS) {
    for (const border of BORDERS) {
      for (const shape of SHAPES) {
        expect(resolve(fin({ card, border, shape })).refusal).toBeNull()
      }
    }
  }
  expect((resolve(fin({ contrast: 'high' })).args?.colors as { contrast?: string }).contrast).toBe('more')
  expect((resolve(fin()).args?.colors as { contrast?: string }).contrast).toBeUndefined()
})

// ---- options typed as words ----

test('options are validated strictly and a bad one changes nothing', () => {
  const ok = parseOpts('gray=warm tone=sepia accent=#E8643C ground=paper neutral=off hand=on', DEFAULT_FINISH)

  expect(ok.errors).toEqual([])
  expect(ok.finish).toMatchObject({ gray: 'warm', tone: 'sepia', accent: '#e8643c', ground: 'paper', neutralFirst: false, hand: true })
  const bad = parseOpts('gray=warm tone=purple', DEFAULT_FINISH)

  expect(bad.errors.length).toBe(1)
  expect(bad.finish).toEqual(DEFAULT_FINISH)
  expect(parseOpts('colour=red', DEFAULT_FINISH).errors.length).toBe(1)
  expect(parseOpts('accent=nothex', DEFAULT_FINISH).errors.length).toBe(1)
  expect(parseOpts('preset=nope', DEFAULT_FINISH).errors.length).toBe(1)
  expect(parseOpts('hand=maybe', DEFAULT_FINISH).errors.length).toBe(1)
})

test('bare words and presets work', () => {
  const r = parseOpts('warm paper serif oled', DEFAULT_FINISH)

  expect(r.finish).toMatchObject({ gray: 'warm', ground: 'paper', headings: 'serif', tone: 'true-black' })
  expect(parseOpts('preset=sepia', DEFAULT_FINISH).finish.tone).toBe('sepia')
  expect(parseOpts('oled', DEFAULT_FINISH).changed).toEqual(['tone=true-black'])
  expect(parseOpts('accents=#111111,#d9531e', DEFAULT_FINISH).accentList).toBe('#111111,#d9531e')
  expect(parseOpts('', DEFAULT_FINISH).changed).toEqual([])
  expect(Object.keys(PRESETS).length).toBeGreaterThanOrEqual(6)
})

test('a stored finish is trusted for nothing', () => {
  expect(parseFinish(null)).toBeNull()
  expect(parseFinish([1, 2])).toBeNull()
  expect(parseFinish('x')).toBeNull()
  const f = parseFinish({ gray: 'plaid', tone: 'sepia', accent: 'nope', hand: 'yes', ground: 'glass' })!

  expect(f.gray).toBe('neutral')
  expect(f.tone).toBe('sepia')
  expect(f.accent).toBe(DEFAULT_FINISH.accent)
  expect(f.hand).toBe(false)
  expect(f.ground).toBe('glass')
})

// ---- vector previews ----

const FORBIDDEN = [/href/i, /<image/i, /<!--/, /CDATA/i, /<script/i, /&(?!amp;|lt;|gt;|quot;)/, /NaN/, /undefined/, /Infinity/]

const checkSvg = (svg: string) => {
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect(svg.length).toBeLessThan(131_072)

  for (const re of FORBIDDEN) {
    expect(svg).not.toMatch(re)
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

const SAMPLE_FINISHES: Finish[] = [
  DEFAULT_FINISH,
  fin({ ground: 'band', card: 'glossy', shape: 'pill', headings: 'serif', hand: true }),
  fin({ ground: 'paper', tone: 'off-white', gray: 'warm', border: 'bold' }),
  fin({ ground: 'noise', tone: 'true-black', gray: 'cool', shape: 'square', contrast: 'high' }),
  fin({ ground: 'glass', tone: 'sepia', card: 'matte', border: 'hairline', neutralFirst: false }),
]

test('the sample window is a clean SVG for every kind of finish and every simulation', () => {
  for (const f of SAMPLE_FINISHES) {
    for (const cvd of CVDS) {
      const s = sampleSvg(f, { cvd, stroke: 2, month: 3 })

      checkSvg(s.svg)
      expect(s.alt.length).toBeGreaterThan(20)
    }
  }
})

test('every tab drawing is a clean SVG', () => {
  const o = { cvd: 'deuteranopia', stroke: 1.5, month: 6 } as const

  for (const f of SAMPLE_FINISHES) {
    checkSvg(colourSvg(f, o, 5.5).svg)
    checkSvg(surfaceSvg(f, o).svg)
    checkSvg(typeSvg(f, o).svg)
    checkSvg(dataSvg(f, o).svg)
    checkSvg(iconsSvg(f, o).svg)
    checkSvg(miniSvg(f, o).svg)
  }
})

test('the accent share is measured from the sample, and neutral-first stays under 10 percent', () => {
  const s = sampleSvg(DEFAULT_FINISH)

  expect(s.share).toBeGreaterThan(1)
  expect(s.share).toBeLessThan(10)
  // A band adds some accent tint, so the share goes up but remains a measured number.
  expect(sampleSvg(fin({ ground: 'band' })).share).toBeGreaterThan(s.share)
})

test('the simulation recolours the preview and the unsimulated one keeps its colours', () => {
  const normal = sampleSvg(fin({ accent: '#e8643c' })).svg
  const sim = sampleSvg(fin({ accent: '#e8643c' }), { cvd: 'deuteranopia', stroke: 1.75, month: -1 }).svg

  expect(normal).toContain('#e8643c')
  expect(sim).not.toContain('#e8643c')
})

test('the icon stroke width reaches the drawn icons', () => {
  // The icons are drawn 32 wide from a 24 box, so a visible width w is written as w * 24 / 32 inside the scaled group.
  expect(iconsSvg(DEFAULT_FINISH, { cvd: 'none', stroke: 3, month: -1 }).svg).toContain('stroke-width="2.25"')
  expect(iconsSvg(DEFAULT_FINISH, { cvd: 'none', stroke: 1, month: -1 }).svg).toContain('stroke-width="0.75"')
})

test('the three scenes are clean, still and follow the finish colours', () => {
  const f = fin({ gray: 'warm', tone: 'sepia' })

  for (const id of ['paper', 'noise', 'glass']) {
    const svg = sceneSvg(id, f)!

    checkSvg(svg)
    expect(svg).toContain('prefers-color-scheme: dark')
    expect(svg).not.toMatch(/<animate|@keyframes|animation:/)
    expect(svg).toContain(anchorsOf(f).light.s0)
    expect(svg).toContain(anchorsOf(f).dark.s0)
  }
  expect(sceneSvg('fog', f)).toBeUndefined()
})

// ---- pane title icons ----

test('pane title icons follow the icon pack and never double up', () => {
  expect(glyphFor('skins-main', 'symbols')).toBe('◐')
  expect(glyphFor('whatever-main', 'symbols')).toBe('◧')
  expect(glyphFor('skins-main', 'letters')).toBe('[S]')
  expect(glyphFor('skins-main', 'minimal')).toBe('·')
  expect(withGlyph('Skins', 'skins-main', 'symbols')).toBe('◐ Skins')
  expect(withGlyph('◐ Skins', 'skins-main', 'symbols')).toBe('◐ Skins')
  expect(withGlyph('[S] Skins', 'skins-main', 'letters')).toBe('[S] Skins')
})

// ---- the engine ----

type Sent = Record<string, unknown>

const setup = (on: (...args: any[]) => unknown, store: Record<string, unknown> = {}, opts: { refuseStyle?: boolean; switches?: Record<string, boolean>; now?: number } = {}) => {
  const sets: Sent[] = []
  const calls = { clear: 0 }
  const opened: { id: string; title?: string }[] = []

  on('command.register', () => ({ value: { command: 'fn' } }))
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
    if (opts.refuseStyle === true && e.style !== undefined) {
      throw new Error('style not supported')
    }
    sets.push(e)

    return { value: { isDrawn: true, requestId: 'r' } }
  })
  on('theme.clear', () => {
    calls.clear += 1

    return { value: { isDrawn: true, requestId: 'r' } }
  })
  on('clock.now', () => ({ value: opts.now ?? new Date(2026, 6, 15).getTime() }))
  on('ui.open', (_: unknown, e: { id: string; title?: string }) => {
    opened.push({ id: e.id, title: e.title })

    return { value: { isPlaced: true } }
  })
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: (x: unknown) => unknown) =>
    e.plugin === 'settings' && e.key === 'features' && opts.switches !== undefined ? { value: { value: { shape: 'features-1', value: opts.switches }, version: 1 } } : next(e),
  )
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))

  return { sets, calls, store, opened }
}

const start = ($: any) => $.session.start({ cwd: '/work/a', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args })) as { text: string }).text

test('by default nothing is applied: session start calls neither theme.set nor theme.clear', async ($, on) => {
  const t = setup(on)
  await start($)

  expect(t.sets).toEqual([])
  expect(t.calls.clear).toBe(0)
})

test('/fn lists every command, one line each', async ($, on) => {
  setup(on)
  await start($)
  const out = await run($, 'fn')

  for (const word of ['/fnapply', '/fnset', '/fnpreview', '/fnaccent', '/fnmonth', '/fnremember', '/fncvd', '/fnstroke', '/fnreset', 'last mod', 'preset']) {
    expect(out).toContain(word)
  }
})

test('/fnapply makes exactly one theme.set call with colours, and stores nothing while remember is off', async ($, on) => {
  const t = setup(on)
  await start($)
  const out = await run($, 'fnapply', 'warm paper serif')

  expect(out).toContain('Applied')
  expect(out).toContain('last')
  expect(t.sets.length).toBe(1)
  expect(t.sets[0]!.colors).toBeDefined()
  expect((t.sets[0]!.backdrop as { scene: string }).scene).toBe('paper')
  expect(t.calls.clear).toBe(0)
  expect(t.store).toEqual({})
})

test('every preset applies with exactly one theme call', async ($, on) => {
  const t = setup(on)
  await start($)

  for (const id of PRESET_IDS) {
    const before = t.sets.length
    const out = await run($, 'fnapply', `preset=${id}`)

    expect(out).toContain('Applied')
    expect(t.sets.length).toBe(before + 1)
  }
  expect(t.calls.clear).toBe(0)
})

test('a bad option applies nothing and changes nothing', async ($, on) => {
  const t = setup(on)
  await start($)
  const out = await run($, 'fnapply', 'gray=plaid')

  expect(out).toContain('Nothing applied')
  expect(t.sets).toEqual([])
  expect(await run($, 'fnset', 'tone=purple')).toContain('Nothing changed')
})

test('/fnset changes the draft and calls no theme API', async ($, on) => {
  const t = setup(on)
  await start($)
  const out = await run($, 'fnset', 'gray=cool tone=true-black')

  expect(out).toContain('Draft')
  expect(out).toContain('Nothing is applied')
  expect(t.sets).toEqual([])
  expect(t.calls.clear).toBe(0)
  // The next /fnapply uses the draft.
  await run($, 'fnapply', '')

  expect(t.sets.length).toBe(1)
  const colors = t.sets[0]!.colors as { inputs: { dark: Record<string, string> } }

  expect(colors.inputs.dark['gray-900']).toBe('#000000')
})

test('/fnapply off clears once', async ($, on) => {
  const t = setup(on)
  await start($)
  await run($, 'fnapply', 'sepia')
  const out = await run($, 'fnapply', 'off')

  expect(out).toContain("app's own look")
  expect(t.calls.clear).toBe(1)
  expect(t.sets.length).toBe(1)
})

test('a build that refuses style still gets the colours, after saying so', async ($, on) => {
  const t = setup(on, {}, { refuseStyle: true })
  await start($)
  const out = await run($, 'fnapply', 'glossy pill')

  expect(out).toContain('Left out: style')
  expect(t.sets.length).toBe(1)
  expect(t.sets[0]!.style).toBeUndefined()
  expect(t.sets[0]!.colors).toBeDefined()
})

test('/fnaccent picks the most saturated mid-lightness colour of a pasted list and does not apply', async ($, on) => {
  const t = setup(on)
  await start($)
  const out = await run($, 'fnaccent', '#ffffff #808080 #d9531e #000000 nope')

  expect(out).toContain('#d9531e')
  expect(out).toContain('1 item ignored')
  expect(out).toContain('image cannot be decoded')
  expect(t.sets).toEqual([])
  expect(await run($, 'fnapply', '')).toContain('accent #d9531e')
  expect(await run($, 'fnaccent', 'nothing here')).toContain('No hex colours')
  expect(await run($, 'fnaccent', 'teal')).toContain('named accent')
})

test('accents= on /fnapply picks from the list in the same single call', async ($, on) => {
  const t = setup(on)
  await start($)
  const out = await run($, 'fnapply', 'accents=#f4f4f4,#2255dd,#999999')

  expect(out).toContain('#2255dd')
  expect(t.sets.length).toBe(1)
  expect(await run($, 'fnapply', 'accents=zzz')).toContain('Nothing applied')
  expect(t.sets.length).toBe(1)
})

test('the accent of the month is off by default, and only used when /fnmonth on and a command is typed', async ($, on) => {
  const t = setup(on, {}, { now: new Date(2026, 6, 15).getTime() })
  await start($)

  expect(await run($, 'fnmonth', '')).toContain('off')
  expect(await run($, 'fnapply', '')).not.toContain(MONTH_ACCENTS[6]!)
  expect(await run($, 'fnmonth', 'on')).toContain('on')
  const out = await run($, 'fnapply', '')

  expect(out).toContain('July')
  expect(out).toContain(`accent ${MONTH_ACCENTS[6]}`)
  expect(t.sets.length).toBe(2)
  // An explicit accent beats the month.
  const explicit = await run($, 'fnapply', 'accent=#2255dd')

  expect(explicit).toContain('accent #2255dd')
  expect(explicit).not.toContain('July')
  expect(await run($, 'fnmonth', 'maybe')).toContain('Usage')
})

test('the month switch off stops /fnmonth from changing the accent', async ($, on) => {
  const t = setup(on, {}, { switches: { 'finish-kit.month': false } })
  await start($)
  await run($, 'fnmonth', 'on')
  const out = await run($, 'fnapply', '')

  expect(out).not.toContain('July')
  expect(t.sets.length).toBe(1)
})

test('remember is off by default; on saves the applied finish; a new session re-applies it once, only with the switch on', async ($, on) => {
  const store: Record<string, unknown> = {}
  const t = setup(on, store, { switches: { 'finish-kit.remember': true } })
  await start($)
  await run($, 'fnapply', 'sepia')
  expect(store.finish).toBeUndefined()
  expect(await run($, 'fnremember', '')).toContain('off')

  expect(await run($, 'fnremember', 'on')).toContain('Remember on')
  expect(store.remember).toBe(true)
  await run($, 'fnapply', 'oled')
  expect((store.finish as Finish).tone).toBe('true-black')

  const before = t.sets.length

  await start($)
  expect(t.sets.length).toBe(before + 1)

  await run($, 'fnremember', 'off')
  expect(store.remember).toBeUndefined()
  expect(store.finish).toBeUndefined()
})

test('remember with its switch off applies nothing at start, and says why', async ($, on) => {
  const store: Record<string, unknown> = { remember: true, finish: { ...DEFAULT_FINISH, tone: 'sepia' } }
  const t = setup(on, store)
  await start($)

  expect(t.sets).toEqual([])
  expect(await run($, 'fnremember', 'on')).toContain('finish-kit.remember is off')
})

test('a corrupt saved finish is ignored at start', async ($, on) => {
  const t = setup(on, { remember: true, finish: 'garbage' }, { switches: { 'finish-kit.remember': true } })
  await start($)

  expect(t.sets).toEqual([])
})

test('/fnreset forgets the saved data but leaves the applied theme alone', async ($, on) => {
  const store: Record<string, unknown> = {}
  const t = setup(on, store)
  await start($)
  await run($, 'fnremember', 'on')
  await run($, 'fnmonth', 'on')
  await run($, 'fnapply', 'sepia')
  const out = await run($, 'fnreset')

  expect(out).toContain('reset')
  expect(store).toEqual({})
  expect(t.calls.clear).toBe(0)
  expect(await run($, 'fnmonth', '')).toContain('off')
  expect(await run($, 'fnremember', '')).toContain('off')
})

test('/fncvd and /fnstroke validate their words', async ($, on) => {
  setup(on)
  await start($)

  expect(await run($, 'fncvd', 'deuteranopia')).toContain('simulate')
  expect(await run($, 'fncvd', '')).toContain('deuteranopia')
  expect(await run($, 'fncvd', 'purple')).toContain('Usage')
  expect(await run($, 'fnstroke', '2')).toContain('stroke width 2')
  expect(await run($, 'fnstroke', '7')).toContain('Usage')
  expect(await run($, 'fnpreview', 'plaid')).toContain('No tab called')
})

// ---- the pane ----

const PANE = {
  plugin: 'finish-kit',
  component: 'Pane',
  requestId: 'finish-kit-main',
  surface: 'desktop',
  props: { title: 'Finish studio', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('every tab of the pane draws on the desktop, with vector previews and at most 12 buttons per row', async ($, on) => {
  const t = setup(on)
  await start($)

  for (const tab of ['finishes', 'colour', 'surface', 'type', 'data', 'icons', 'about']) {
    expect(await run($, 'fnpreview', tab)).toContain('Finish studio opened')
    const ui = await $.ui.mount(PANE)
    const svgs = await ui.findAll({ type: 'Svg' })

    if (tab !== 'about') {
      expect(svgs.length).toBeGreaterThan(0)
    }

    for (const s of svgs) {
      expect(String(s.props.source).startsWith('<svg')).toBe(true)
      expect(String(s.props.alt).length).toBeGreaterThan(10)
    }
    const buttons = await ui.findAll({ type: 'Button' })

    expect(buttons.length).toBeGreaterThan(2)
    await ui.unmount()
  }
  expect(t.sets).toEqual([])
})

test('the pane on the terminal has no Svg and a text fallback', async ($, on) => {
  setup(on)
  await start($)
  await run($, 'fnpreview', 'colour')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No vector previews here/ })).toBeDefined()
  await ui.unmount()
})

test('the vector previews can be switched off', async ($, on) => {
  setup(on, {}, { switches: { 'finish-kit.svg-previews': false } })
  await start($)
  await run($, 'fnpreview', 'surface')
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('the Finishes tab has an Apply button per preset, and pressing it makes one theme call', async ($, on) => {
  const t = setup(on)
  await start($)
  await run($, 'fnpreview', 'finishes')
  const ui = await $.ui.mount(PANE)
  const apply = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('apply-') && b.key !== 'apply-draft' && b.key !== 'apply-off')

  expect(apply.length).toBe(PRESET_IDS.length)
  expect(t.sets).toEqual([])
  await ui.press({ key: String(apply[0]!.key) })
  expect(t.sets.length).toBe(1)
  await ui.unmount()
})

test('pane buttons change only the draft until Apply is pressed', async ($, on) => {
  const t = setup(on)
  await start($)
  await run($, 'fnpreview', 'surface')
  const ui = await $.ui.mount(PANE)
  const glossy = (await ui.findAll({ type: 'Button' })).find(b => b.key === 'card-glossy')!

  await ui.press({ key: String(glossy.key) })
  expect(t.sets).toEqual([])
  const now = (await ui.findAll({ type: 'Button' })).find(b => b.key === 'card-glossy')!

  expect(now.props.label).toBe('[glossy]')
  await ui.unmount()
})

test('the data tab shows the colour-blind choice', async ($, on) => {
  setup(on)
  await start($)
  await run($, 'fncvd', 'protanopia')
  await run($, 'fnpreview', 'data')
  const ui = await $.ui.mount(PANE)
  const sel = (await ui.findAll({ type: 'Button' })).find(b => b.key === 'simulate-protanopia')

  expect(sel?.props.label).toBe('[protanopia]')
  await ui.unmount()
})

// ---- hooks on other panes and backdrops ----

test('the title icon hook is off by default and prefixes titles when its switch is on', async ($, on) => {
  const off = setup(on)
  await start($)
  await run($, 'fnpreview', '')

  expect(off.opened[off.opened.length - 1]!.title).toBe('Finish studio')
})

test('with the title-icons switch on, a pane title gets one icon, once', async ($, on) => {
  const t = setup(on, {}, { switches: { 'finish-kit.title-icons': true } })
  await start($)
  await run($, 'fnpreview', '')
  expect(t.opened[t.opened.length - 1]!.title).toBe('◐ Finish studio')
  await run($, 'fnpreview', '')
  // Opened again, the title still has one icon.
  expect(t.opened[t.opened.length - 1]!.title).toBe('◐ Finish studio')
})

test('the backdrop hook draws finish-kit scenes and leaves any other to the engine', async ($, on) => {
  setup(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await start($)

  for (const scene of ['paper', 'noise', 'glass']) {
    const mine = await $.ui.mount({
      plugin: 'finish-kit',
      component: 'Backdrop',
      requestId: `fk-${scene}`,
      surface: 'desktop',
      props: { scene, plugin: 'finish-kit', glass: { blur: 6, opacity: 0.55 } },
    })

    expect(await mine.find({ type: 'Svg' })).toBeDefined()
    await mine.unmount()
  }
  const other = await $.ui.mount({
    plugin: 'finish-kit',
    component: 'Backdrop',
    requestId: 'fk-other',
    surface: 'desktop',
    props: { scene: 'fog', plugin: 'looks', glass: false },
  })

  expect(await other.find({ type: 'Svg' })).toBeUndefined()
  expect(await other.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await other.unmount()
})
