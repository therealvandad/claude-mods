import { expect, test } from 'claude-code/testing'

import { COMMANDS, FEATURE_DEFAULTS, SAMPLES, SAMPLE_IDS, TABS } from './catalog'
import {
  DEFAULT_VIEW,
  askText,
  cleanQuery,
  copyText,
  findSample,
  fromStore,
  groupByTab,
  helpText,
  listRows,
  listText,
  matchesChips,
  matchesQuery,
  normView,
  paginate,
  parseSwitch,
  parseTarget,
  sortSamples,
  step,
  tabCounts,
  visible,
  withSticky,
} from './pure'
import { DRAWN_IDS, SVG_MAX, esc, pixelWord, sampleSvg } from './svg'
import type { Ctx } from './svg'

const CTX: Ctx = { accent: 'suggestion', animate: false, grid: false, tips: true }

// ------------------------------------------------------------------ the catalogue

test('thirty samples, unique ids, every one with a spec, a text version and a drawing', () => {
  expect(SAMPLES.length).toBe(30)
  expect(new Set(SAMPLE_IDS).size).toBe(30)
  expect([...DRAWN_IDS].sort()).toEqual([...SAMPLE_IDS].sort())
  expect(new Set(SAMPLES.map(s => s.no)).size).toBe(30)

  for (const s of SAMPLES) {
    expect(s.id).toMatch(/^[a-z]{3,12}$/)
    expect(s.spec.length).toBeGreaterThan(80)
    expect(s.spec.length).toBeLessThanOrEqual(420)
    expect(s.text.length).toBeGreaterThan(0)
    expect(s.blurb.length).toBeGreaterThan(10)
  }
})

test('the five tabs hold what the brief grouped there', () => {
  const by = (tab: string) => SAMPLES.filter(s => s.tab === tab).map(s => s.no)
  expect(by('surfaces')).toEqual([31, 32, 33, 34, 35, 39])
  expect(by('controls')).toEqual([36, 37, 38, 40, 41, 209, 210])
  expect(by('feedback')).toEqual([42, 43, 44, 45, 46])
  expect(by('navigation')).toEqual([201, 202, 203, 204, 205, 206, 207, 208])
  expect(by('modes')).toEqual([47, 48, 49, 50])
  expect(TABS.map(t => t.id)).toEqual(['surfaces', 'controls', 'feedback', 'navigation', 'modes', 'list'])
})

test('every preview says what is not real', () => {
  const note = (id: string) => SAMPLES.find(s => s.id === id)?.note ?? ''
  expect(note('scrollbar')).toMatch(/cannot be restyled/)
  expect(note('toast')).toMatch(/plain text/)
  expect(note('tooltip')).toMatch(/only real tooltip/)
  expect(note('ctxmenu')).toMatch(/cannot attach/)
  expect(note('pixel')).toMatch(/fonts cannot be chosen/)
  expect(SAMPLES.every(s => s.status === 'live' || s.note !== '')).toBe(true)
})

test('the commands are unique, start with sg, and the help names each one', () => {
  const names = COMMANDS.map(c => c.name)
  expect(new Set(names).size).toBe(names.length)
  expect(names.every(n => n === 'sg' || n.startsWith('sg'))).toBe(true)
  expect(names).toContain('sgdemo')
  expect(names).toContain('sgcopy')

  for (const c of COMMANDS) {
    expect(helpText()).toContain(c.usage)
  }
  expect(helpText()).toMatch(/cannot restyle other mods/)
  expect(Object.keys(FEATURE_DEFAULTS).length).toBe(9)
})

// ------------------------------------------------------------------ the vector samples

test('every sample draws a small, safe, well formed SVG with a light/dark media query', () => {
  for (const id of SAMPLE_IDS) {
    for (const ctx of [CTX, { ...CTX, animate: true, grid: true }]) {
      const svg = sampleSvg(id, ctx)
      expect(svg.length).toBeGreaterThan(400)
      expect(svg.length).toBeLessThan(SVG_MAX)
      expect(svg.startsWith('<svg ')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect((svg.match(/<svg/g) ?? []).length).toBe(1)
      expect(svg).toContain('@media (prefers-color-scheme:dark)')
      expect(svg).not.toMatch(/<script|<foreignObject|<image|<iframe|<a[ >]|<use|href=|javascript:|@import|url\(\s*['"]?https?:|data:/i)
      expect(svg).not.toMatch(/\son[a-z]+\s*=/i)
      expect(svg).not.toMatch(/NaN|undefined|\[object/)
    }
  }
})

test('the opening and closing tags of every drawing balance', () => {
  for (const id of SAMPLE_IDS) {
    const svg = sampleSvg(id, { ...CTX, animate: true })
    const open = (svg.match(/<(g|defs|clipPath|pattern|filter|style|text|title)[ >]/g) ?? []).length
    const close = (svg.match(/<\/(g|defs|clipPath|pattern|filter|style|text|title)>/g) ?? []).length
    expect([id, open]).toEqual([id, close])
  }
})

test('the total of all thirty drawings stays small', () => {
  const total = SAMPLE_IDS.reduce((n, id) => n + sampleSvg(id, { ...CTX, animate: true }).length, 0)
  expect(total).toBeLessThan(150_000)
  expect(Math.max(...SAMPLE_IDS.map(id => sampleSvg(id, CTX).length))).toBeLessThan(SVG_MAX)
})

test('still drawings carry no animation at all, animated ones do', () => {
  for (const id of SAMPLE_IDS) {
    expect(sampleSvg(id, CTX)).not.toMatch(/@keyframes|animation:|<animate/)
  }
  expect(sampleSvg('skeleton', { ...CTX, animate: true })).toMatch(/@keyframes shim/)
  expect(sampleSvg('toast', { ...CTX, animate: true })).toMatch(/@keyframes slide/)
  expect(sampleSvg('terminal', { ...CTX, animate: true })).toMatch(/@keyframes blink/)
})

test('hover titles can be switched off, and are on by default', () => {
  expect(sampleSvg('badge', CTX)).toContain('<title>filled info badge</title>')
  expect(sampleSvg('badge', { ...CTX, tips: false })).not.toContain('<title>')
  expect(sampleSvg('tooltip', CTX)).toContain('only real tooltip')
})

test('the 4 px grid is drawn over a sample on request, and always on the spacing sample', () => {
  expect(sampleSvg('radius', CTX)).not.toContain('id="g4"')
  expect(sampleSvg('radius', { ...CTX, grid: true })).toContain('id="g4"')
  expect(sampleSvg('radius', { ...CTX, grid: true })).toContain('id="g16"')
  expect(sampleSvg('spacing', CTX)).toContain('id="g4"')
})

test('the accent changes the drawing, and an unknown id draws nothing', () => {
  expect(sampleSvg('focus', { ...CTX, accent: 'claude' })).toContain('#c4562f')
  expect(sampleSvg('focus', CTX)).toContain('#4b57c9')
  expect(sampleSvg('nope', CTX)).toBe('')
})

test('text can not break out of the drawing', () => {
  expect(esc('<script>alert(1)</script> "a" & b')).toBe('&lt;script&gt;alert(1)&lt;/script&gt; &quot;a&quot; &amp; b')
})

test('the three modes keep their own palettes in both colour schemes', () => {
  expect(sampleSvg('blueprint', CTX)).toContain('#0d3b72')
  expect(sampleSvg('terminal', CTX)).toContain('#33ff66')
  expect(sampleSvg('terminal', CTX)).toContain('#0a0f0a')
  expect(sampleSvg('print', CTX)).toContain('fill="#fff"')
})

test('the pixel font is merged runs of cells, bounded, and skips unknown letters', () => {
  const word = pixelWord('STYLE', 0, 0, 8, 'acc')
  expect(word).toContain('class="acc"')
  expect((word.match(/<rect/g) ?? []).length).toBeLessThan(60)
  expect(pixelWord('???', 0, 0, 8, 'acc')).toBe('')
  expect((pixelWord('E', 0, 0, 4, 'x').match(/<rect/g) ?? []).length).toBe(5)
  expect((pixelWord('S'.repeat(200), 0, 0, 4, 'x').match(/<rect/g) ?? []).length).toBeLessThan(200)
})

// ------------------------------------------------------------------ search, filter, sort, paging

test('search matches id, title and kind, every word, and ignores case and junk', () => {
  const radius = SAMPLES.find(s => s.id === 'radius')!
  expect(matchesQuery(radius, 'RADIUS')).toBe(true)
  expect(matchesQuery(radius, 'corner scale')).toBe(true)
  expect(matchesQuery(radius, 'shape surfaces')).toBe(true)
  expect(matchesQuery(radius, 'badge')).toBe(false)
  expect(matchesQuery(radius, '')).toBe(true)
  expect(cleanQuery('  a\u0000b\n\tc  ')).toBe('a b c ')
  expect(cleanQuery('red ')).toBe('red ')
  expect(cleanQuery('x'.repeat(500)).length).toBe(60)
  expect(cleanQuery(42)).toBe('')
})

test('chips: the same group is OR, different groups are AND', () => {
  const radius = SAMPLES.find(s => s.id === 'radius')!
  const tabbar = SAMPLES.find(s => s.id === 'tabbar')!
  expect(matchesChips(radius, [])).toBe(true)
  expect(matchesChips(radius, ['live', 'preview'])).toBe(true)
  expect(matchesChips(radius, ['live'])).toBe(false)
  expect(matchesChips(tabbar, ['live', 'ui'])).toBe(true)
  expect(matchesChips(tabbar, ['live', 'look'])).toBe(false)
  expect(matchesChips(tabbar, ['look', 'ui'])).toBe(true)
  expect(visible({ query: '', chips: ['ui'], sort: 'id' }).length).toBe(10)
  expect(visible({ query: '', chips: ['look'], sort: 'id' }).length).toBe(20)
  expect(visible({ query: 'zzzz', chips: [], sort: 'id' }).length).toBe(0)
})

test('sort by name and by kind; the default keeps the catalogue order', () => {
  const byName = sortSamples(SAMPLES, 'name').map(s => s.title)
  expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)))
  const byKind = sortSamples(SAMPLES, 'kind').map(s => s.kind)
  expect(byKind).toEqual([...byKind].sort((a, b) => a.localeCompare(b)))
  expect(sortSamples(SAMPLES, 'id').map(s => s.id)).toEqual(SAMPLE_IDS)
})

test('paging clamps, and the list groups by tab with headers', () => {
  const p = paginate(SAMPLES, 99, 8)
  expect(p.page).toBe(4)
  expect(p.pages).toBe(4)
  expect(p.items.length).toBe(6)
  expect(paginate([], 3, 8)).toEqual({ items: [], page: 1, pages: 1 })
  const grouped = groupByTab(sortSamples(SAMPLES, 'name'))
  expect(grouped.length).toBe(30)
  const rows = listRows(grouped.slice(0, 8), tabCounts(SAMPLES))
  expect(rows.filter(r => r.isHeader).length).toBe(2)
  expect(rows[0]).toMatchObject({ isHeader: true, title: 'Surfaces', count: 6 })
})

test('sticky headers repeat the group header once its rows have scrolled past', () => {
  type R = { id: string; isHeader?: boolean; isSticky?: boolean }
  const items: R[] = [{ id: 'h1', isHeader: true }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'h2', isHeader: true }, { id: 'd' }]
  expect(withSticky(items, 0, 2).length).toBe(6)
  const scrolled = withSticky(items, 5, 2)
  expect(scrolled.map(i => i.id)).toEqual(['h1', 'a', 'b', 'h1', 'c', 'h2', 'd'])
  expect(scrolled[3]).toMatchObject({ isSticky: true })
  expect(withSticky(items, 6, 2).length).toBe(6)
  expect(withSticky(items, 99, 2).length).toBe(6)
  expect(withSticky<R>([{ id: 'x' }, { id: 'y' }], 2, 0).length).toBe(2)
})

test('selection steps around the shown list', () => {
  const shown = SAMPLES.slice(0, 3)
  expect(step({ selected: '' }, shown, 1)).toBe('radius')
  expect(step({ selected: '' }, shown, -1)).toBe('spacing')
  expect(step({ selected: 'spacing' }, shown, 1)).toBe('radius')
  expect(step({ selected: 'radius' }, shown, -1)).toBe('spacing')
  expect(step({ selected: 'x' }, [], 1)).toBe('x')
})

test('a stored or typed view is validated field by field', () => {
  expect(normView(null)).toEqual(DEFAULT_VIEW)
  expect(normView({ tab: 'nope', sort: 'x', chips: ['live', 'bad', 'live'], page: -4, selected: 'zzz', grid: 'yes', query: 5, msg: 3 })).toEqual({ ...DEFAULT_VIEW, chips: ['live'] })
  expect(normView({ tab: 'modes', sort: 'kind', page: 3.4, selected: 'pixel', grid: true, demoPage: 9 })).toMatchObject({ tab: 'modes', sort: 'kind', page: 3, selected: 'pixel', grid: true, demoPage: 3 })
  expect(normView({ query: 'q'.repeat(300), msg: 'm'.repeat(900) }).query.length).toBe(60)
  expect(normView({ msg: 'm'.repeat(900) }).msg.length).toBe(140)
  expect(fromStore({ tab: 'feedback', sort: 'name', grid: true, query: 'kept?', selected: 'radius' })).toEqual({ ...DEFAULT_VIEW, tab: 'feedback', sort: 'name', grid: true })
  expect(fromStore('junk')).toEqual(DEFAULT_VIEW)
})

test('argument parsing: samples, tabs, switches', () => {
  expect(findSample('radius').sample?.id).toBe('radius')
  expect(findSample('#Radius').sample?.id).toBe('radius')
  expect(findSample('elev').sample?.id).toBe('elevation')
  expect(findSample('sticky').error).toMatch(/More than one/)
  expect(findSample('skeleton loading').error).toMatch(/No sample/)
  expect(findSample('').error).toMatch(/Give a sample id/)
  expect(findSample('<script>').error).not.toContain('<script>x')
  expect(parseTarget('Navigation').tab).toBe('navigation')
  expect(parseTarget('list').tab).toBe('list')
  expect(parseTarget('toast')).toMatchObject({ tab: 'feedback' })
  expect(parseTarget('').tab).toBeUndefined()
  expect(parseTarget('qqq').error).toMatch(/No sample/)
  expect(parseSwitch('ON')).toBe(true)
  expect(parseSwitch('off')).toBe(false)
  expect(parseSwitch('maybe')).toBeUndefined()
})

test('the spec text for the prompt box is short and names the style', () => {
  const s = SAMPLES.find(x => x.id === 'radius')!
  expect(copyText(s)).toMatch(/^Style "Radius scale" \(radius\): Radius scale: 4 px/)
  expect(askText(s)).toMatch(/^Please apply this style/)
  expect(copyText(s).length).toBeLessThan(500)
  expect(listText('')).toMatch(/^30 of 30 samples/)
  expect(listText('badge').split('\n').length).toBe(2)
  expect(listText('qqqq')).toBe('No sample matches "qqqq".')
})

// ------------------------------------------------------------------ the engine

type Opts = {
  features?: Record<string, boolean>
  motion?: boolean
  calm?: boolean
  icons?: string
  accent?: string
  draft?: string
  saved?: unknown
  refuse?: boolean
  registered?: string[]
  writes?: unknown[]
}
type Fill = { text: string; mode?: string }

const engine = (on: any, opts: Opts = {}) => {
  const fills: Fill[] = []
  const opened: string[] = []
  on('command.register', (_: unknown, e: any) => {
    opts.registered?.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: any) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: any) => ({ value: e.key === 'view' ? opts.saved : undefined }))
  on('store.set', (_: unknown, e: any) => {
    opts.writes?.push(e.value)

    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: opts.draft ?? '', cursor: 0 } }))
  on('prompt.fill', (_: unknown, e: any) => {
    fills.push({ text: e.text, mode: e.mode })

    return { isFilled: opts.refuse !== true, text: e.text, cursor: 0 }
  })
  on('state.get', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'motion' && e.key === 'isOn') {
      return { value: { value: opts.motion !== false, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'isCalm') {
      return { value: { value: opts.calm === true, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'accent' && opts.accent !== undefined) {
      return { value: { value: opts.accent, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'icons' && opts.icons !== undefined) {
      return { value: { value: opts.icons, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'features' && opts.features !== undefined) {
      return { value: { value: { shape: 'features-1', value: opts.features }, version: 1 } }
    }

    return next(e)
  })

  return { fills, opened }
}

const PANE = (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', props: Record<string, unknown> = {}) =>
  ({
    plugin: 'style-gallery',
    component: 'Pane',
    requestId: 'style-gallery-main',
    surface,
    viewport: { columns: 120, rows: 40 },
    props: { title: 'Style gallery', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {}, ...props },
  }) as any

const say = async ($: any, command: string, args = '') => (await $.command.run({ command, args, origin: 'user' } as any)).text as string
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const has = async (ui: any, text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
const hasId = (ui: any, id: string) => has(ui, new RegExp(`^${id}$`))

test('/sg lists every command and the registration names them all', async ($, on) => {
  const registered: string[] = []
  engine(on, { registered })
  await start($)
  expect(registered.sort()).toEqual(COMMANDS.map(c => c.name).sort())
  const text = await say($, 'sg')

  for (const c of COMMANDS) {
    expect(text).toContain(`/${c.name}`)
  }
})

test('every sample id shows in the pane, on every tab, on the terminal and on the desktop', async ($, on) => {
  engine(on)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const tab of ['surfaces', 'controls', 'feedback']) {
      await say($, 'sgdemo', tab)
      const ui = await $.ui.mount(PANE(surface))

      for (const s of SAMPLES.filter(x => x.tab === tab)) {
        expect([surface, s.id, await hasId(ui, s.id)]).toEqual([surface, s.id, true])
      }
      await ui.unmount()
    }
  }
})

test('the navigation and mode tabs show every id on both surfaces too', async ($, on) => {
  engine(on)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const tab of ['navigation', 'modes']) {
      await say($, 'sgdemo', tab)
      const ui = await $.ui.mount(PANE(surface))

      for (const s of SAMPLES.filter(x => x.tab === tab)) {
        expect([surface, s.id, await hasId(ui, s.id)]).toEqual([surface, s.id, true])
      }
      await ui.unmount()
    }
  }
})

test('the other surfaces draw the same text samples with every id', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'modes')

  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect(await has(ui, /^pixel$/)).toBe(true)
    expect(await has(ui, /^print$/)).toBe(true)
    await ui.unmount()
  }
})

test('the List tab shows every id across pages, on both surfaces', async ($, on) => {
  engine(on)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    await say($, 'sgdemo', 'list')
    const ui = await $.ui.mount(PANE(surface))
    const seen = new Set<string>()

    for (let page = 1; page <= 4; page += 1) {
      for (const s of SAMPLES) {
        if ((await ui.find({ type: 'Button', key: `row:${s.id}` })) !== undefined) {
          seen.add(s.id)
        }
      }

      if (page < 4) {
        await ui.press({ key: 'list:next' })
      }
    }
    expect(seen.size).toBe(30)
    await ui.unmount()
  }
})

test('the desktop draws a vector image per sample; the terminal draws text', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'surfaces')
  const desk = await $.ui.mount(PANE('desktop'))
  const svg = await desk.find({ type: 'Svg' })
  expect(svg?.props.source).toMatch(/^<svg /)
  expect(svg?.props.alt).toMatch(/Radius scale/)
  expect(svg?.props.width).toBe(520)
  expect(await has(desk, /^sm {2}4 px/)).toBe(false)
  await desk.unmount()

  const term = await $.ui.mount(PANE('terminal'))
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await has(term, /sm {3}4 px/)).toBe(true)
  await term.unmount()
})

test('the pane says honestly that it cannot restyle other mods', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await has(ui, /cannot restyle other mods or the app/)).toBe(true)
  await ui.unmount()
})

test('tabs switch, the breadcrumb follows, and the tab counts show', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('desktop'))
  expect((await ui.find({ type: 'Button', key: 'tab:controls' }))?.text).toContain('Controls 7')
  await ui.press({ key: 'tab:navigation' })
  expect(await hasId(ui, 'tabbar')).toBe(true)
  expect(await hasId(ui, 'radius')).toBe(false)
  expect((await ui.find({ type: 'Button', key: 'crumb:tab' }))?.text).toBe('Navigation')
  await ui.press({ key: 'sel:fab' }).catch(() => undefined)
  await ui.press({ key: 'sel:paging' })
  expect(await has(ui, /^Pagination and endless scroll$/)).toBe(true)
  await ui.unmount()
})

test('the search box filters the list as you type, across tabs', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.input({ key: 'sg-q', text: 'badge', kind: 'change' })
  expect((await ui.find({ type: 'Button', key: 'tab:controls' }))?.text).toContain('Controls 1')
  expect((await ui.find({ type: 'Button', key: 'tab:surfaces' }))?.text).toContain('Surfaces 0')
  expect(await has(ui, /Filtered: 1 of 30/)).toBe(true)
  await ui.press({ key: 'tab:controls' })
  expect(await hasId(ui, 'badge')).toBe(true)
  expect(await hasId(ui, 'chip')).toBe(false)
  await ui.press({ key: 'tab:surfaces' })
  expect(await has(ui, /No sample in Surfaces matches/)).toBe(true)
  await ui.press({ key: 'clear' })
  expect(await hasId(ui, 'radius')).toBe(true)
  await ui.input({ key: 'sg-q', text: 'x'.repeat(400), kind: 'change' })
  expect(((await ui.find({ type: 'Input', key: 'sg-q' }))?.props.value as string).length).toBe(60)
  await ui.unmount()
})

test('filter chips toggle, combine, and clear', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('desktop'))
  await ui.press({ key: 'chip:ui' })
  expect((await ui.find({ type: 'Button', key: 'chip:ui' }))?.text).toContain('●')
  expect((await ui.find({ type: 'Button', key: 'tab:controls' }))?.text).toContain('Controls 2')
  await ui.press({ key: 'chip:live' })
  expect(await has(ui, /Filtered: 9 of 30/)).toBe(true)
  await ui.press({ key: 'chip:ui' })
  await ui.press({ key: 'chip:live' })
  expect(await ui.find({ type: 'Button', key: 'clear' })).toBeUndefined()
  await ui.unmount()
})

test('sort buttons: name, kind, and a second press back to the default', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'surfaces')
  const ui = await $.ui.mount(PANE('terminal'))
  const order = async () => {
    const out: string[] = []

    for (const s of SAMPLES.filter(x => x.tab === 'surfaces')) {
      const t = JSON.stringify(await ui.drawn())
      out.push(`${t.indexOf(`"${s.id}"`)}:${s.id}`)
    }

    return out.sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0])).map(x => x.split(':')[1])
  }
  expect(await order()).toEqual(['radius', 'elevation', 'spacing', 'zebra', 'highlight', 'divider'])
  await ui.press({ key: 'sort:name' })
  expect((await ui.find({ type: 'Button', key: 'sort:name' }))?.text).toBe('name ✓')
  expect((await order())[0]).toBe('divider')
  await ui.press({ key: 'sort:name' })
  expect((await order())[0]).toBe('radius')
  await ui.press({ key: 'sort:kind' })
  expect((await ui.find({ type: 'Button', key: 'sort:kind' }))?.text).toBe('kind ✓')
  await ui.unmount()
})

test('the paging demo works: next and prev stop at the ends', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'paging')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await has(ui, /^1 \/ 3$/)).toBe(true)
  expect(await has(ui, /^Sample row 1$/)).toBe(true)
  await ui.press({ key: 'demo:next' })
  expect(await has(ui, /^2 \/ 3$/)).toBe(true)
  expect(await has(ui, /^Sample row 5$/)).toBe(true)
  await ui.press({ key: 'demo:next' })
  await ui.press({ key: 'demo:next' })
  expect(await has(ui, /^3 \/ 3$/)).toBe(true)
  await ui.press({ key: 'demo:prev' })
  await ui.press({ key: 'demo:prev' })
  await ui.press({ key: 'demo:prev' })
  expect(await has(ui, /^1 \/ 3$/)).toBe(true)
  expect(await has(ui, /endless \(preview\)/)).toBe(true)
  await ui.unmount()
})

test('the grid toggle draws the 4 px grid over the vector samples, from the card, the footer and /sggrid', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'radius')
  const radius = await $.ui.mount(PANE('desktop'))
  const radiusGrid = async () => ((await radius.find({ type: 'Svg' }))?.props.source as string).includes('id="g4"')
  expect(await radiusGrid()).toBe(false)
  await radius.press({ key: 'foot:grid' })
  expect(await radiusGrid()).toBe(true)
  await radius.press({ key: 'foot:grid' })
  expect(await radiusGrid()).toBe(false)
  expect(await say($, 'sggrid', 'on')).toMatch(/Spacing grid on/)
  expect(await radiusGrid()).toBe(true)
  expect(await say($, 'sggrid', 'off')).toMatch(/Spacing grid off/)
  expect(await say($, 'sggrid', 'sideways')).toMatch(/Use \/sggrid/)
  await radius.unmount()
})

test('/sgcopy puts the spec in the prompt box, appends to a draft, and reports a refusal', async ($, on) => {
  const box = engine(on)
  await start($)
  expect(await say($, 'sgcopy', 'radius')).toMatch(/Copied the spec of "Radius scale" \(radius\)/)
  expect(box.fills[0]?.text).toMatch(/^Style "Radius scale" \(radius\): Radius scale: 4 px for inputs/)
  expect(box.fills[0]?.mode).toBe('append')
  expect(await say($, 'sgcopy', 'nope')).toMatch(/No sample/)
  expect(await say($, 'sgcopy', '')).toMatch(/Give a sample id/)
  expect(box.fills.length).toBe(1)
})

test('a draft already in the prompt box is kept: the spec is added after a blank line', async ($, on) => {
  const box = engine(on, { draft: 'make the buttons nicer' })
  await start($)
  await say($, 'sgcopy', 'badge')
  expect(box.fills[0]?.text.startsWith('\n\nStyle "Badges')).toBe(true)
})

test('a refused fill is reported, not hidden', async ($, on) => {
  engine(on, { refuse: true })
  await start($)
  expect(await say($, 'sgcopy', 'focus')).toMatch(/did not take the text/)
})

test('the footer copies the selected sample, steps, and the Ask button asks for it', async ($, on) => {
  const box = engine(on)
  await start($)
  await say($, 'sgdemo', 'surfaces')
  const ui = await $.ui.mount(PANE('desktop'))
  expect((await ui.find({ type: 'Button', key: 'foot:copy' }))?.text).toBe('copy spec: radius')
  await ui.press({ key: 'foot:next' })
  expect((await ui.find({ type: 'Button', key: 'foot:copy' }))?.text).toBe('copy spec: elevation')
  await ui.press({ key: 'foot:copy' })
  expect(box.fills[0]?.text).toMatch(/\(elevation\)/)
  expect(await has(ui, /Copied the spec of "Elevation scale"/)).toBe(true)
  await ui.press({ key: 'fab' })
  expect(box.fills[1]?.text).toMatch(/^Please apply this style/)
  expect(box.fills[1]?.text).toMatch(/\(elevation\)/)
  await ui.press({ key: 'copy:zebra' })
  expect(box.fills[2]?.text).toMatch(/\(zebra\)/)
  await ui.press({ key: 'foot:prev' })
  expect(await has(ui, /^elevation$/)).toBe(true)
  await ui.unmount()
})

test('sticky group headers repeat in the List tab once the window has scrolled past them', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'list')
  const top = await $.ui.mount(PANE('terminal'))
  expect(await has(top, /▼ Surfaces 6 ↑/)).toBe(false)
  expect(await has(top, /▼ Surfaces 6/)).toBe(true)
  await top.unmount()
  const inside = await $.ui.mount(PANE('terminal', { scroll: { offset: 11, bodyRows: 10 } }))
  expect(await has(inside, /▼ Surfaces 6 ↑/)).toBe(true)
  await inside.unmount()
  const later = await $.ui.mount(PANE('terminal', { scroll: { offset: 15, bodyRows: 10 } }))
  expect(await has(later, /▼ Controls \d+ ↑/)).toBe(true)
  await later.unmount()
})

test('zebra and the current-row band: backgrounds on the desktop only, markers everywhere', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'list')
  const desk = await $.ui.mount(PANE('desktop'))
  await desk.press({ key: 'row:elevation' })
  const text = JSON.stringify(await desk.drawn())
  expect(text).toContain('rgba(128,128,128,0.18)')
  expect(text).toContain('rgba(128,128,128,0.02)')
  expect(text).toContain('▌')
  await desk.unmount()
  const term = await $.ui.mount(PANE('terminal'))
  const t = JSON.stringify(await term.drawn())
  expect(t).not.toContain('rgba(')
  expect(t).toContain('▌')
  await term.unmount()
})

test('the tab icons follow the icon style', async ($, on) => {
  engine(on, { icons: 'letters' })
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Button', key: 'tab:surfaces' }))?.text).toBe('S Surfaces 6')
  await ui.unmount()
})

test('switches: vector samples off gives text on the desktop too', async ($, on) => {
  engine(on, { features: { 'style-gallery.svg': false } })
  await start($)
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await has(ui, /sm {3}4 px/)).toBe(true)
  await ui.unmount()
})

test('switches: tooltips off removes the hover titles', async ($, on) => {
  engine(on, { features: { 'style-gallery.tooltips': false } })
  await start($)
  const ui = await $.ui.mount(PANE('desktop'))
  expect(((await ui.find({ type: 'Svg' }))?.props.source as string).includes('<title>')).toBe(false)
  await ui.unmount()
})

test('switches: toolbar, footer and the Ask button can each be hidden', async ($, on) => {
  engine(on, { features: { 'style-gallery.toolbar': false, 'style-gallery.footer': false, 'style-gallery.fab': false } })
  await start($)
  await say($, 'sgdemo', 'surfaces')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Input', key: 'sg-q' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'chip:live' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'sort:name' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'foot:copy' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'fab' })).toBeUndefined()
  expect(await hasId(ui, 'radius')).toBe(true)
  await ui.unmount()
})

test('with the toolbar hidden a query kept in the view no longer hides samples', async ($, on) => {
  engine(on, { features: { 'style-gallery.toolbar': false } })
  await start($)
  await say($, 'sgdemo', 'surfaces')
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await has(ui, /Filtered:/)).toBe(false)
  expect(await hasId(ui, 'radius')).toBe(true)
  await ui.unmount()
})

test('switches: the grid overlay can be switched off, and /sggrid says so', async ($, on) => {
  engine(on, { features: { 'style-gallery.grid-overlay': false } })
  await start($)
  await say($, 'sgdemo', 'radius')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(await ui.find({ type: 'Button', key: 'foot:grid' })).toBeUndefined()
  expect(await say($, 'sggrid', 'on')).toMatch(/switch is off/)
  expect(((await ui.find({ type: 'Svg' }))?.props.source as string).includes('id="g4"')).toBe(false)
  await ui.unmount()
})

test('switches: sticky headers off keeps the plain list', async ($, on) => {
  engine(on, { features: { 'style-gallery.sticky-headers': false } })
  await start($)
  await say($, 'sgdemo', 'list')
  const ui = await $.ui.mount(PANE('terminal', { scroll: { offset: 11, bodyRows: 10 } }))
  expect(await has(ui, /↑/)).toBe(false)
  await ui.unmount()
})

test('animation is off by default: still drawings', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'skeleton')
  const plain = await $.ui.mount(PANE('desktop'))
  expect(((await plain.find({ type: 'Svg' }))?.props.source as string).includes('@keyframes')).toBe(false)
  await plain.unmount()
})

test('animation needs the switch on, motion on and calm off', async ($, on) => {
  engine(on, { features: { 'style-gallery.animate': true } })
  await start($)
  await say($, 'sgdemo', 'skeleton')
  const live = await $.ui.mount(PANE('desktop'))
  expect(((await live.find({ type: 'Svg' }))?.props.source as string).includes('@keyframes shim')).toBe(true)
  expect((await live.find({ type: 'Svg' }))?.props.isInteractive).toBe(true)
  await live.unmount()
})

test('/motion off in the motion mod switches the animation off too', async ($, on) => {
  engine(on, { features: { 'style-gallery.animate': true }, motion: false })
  await start($)
  await say($, 'sgdemo', 'skeleton')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(((await ui.find({ type: 'Svg' }))?.props.source as string).includes('@keyframes')).toBe(false)
  await ui.unmount()
})

test('calm mode switches the animation off too', async ($, on) => {
  engine(on, { features: { 'style-gallery.animate': true }, calm: true })
  await start($)
  await say($, 'sgdemo', 'skeleton')
  const ui = await $.ui.mount(PANE('desktop'))
  expect(((await ui.find({ type: 'Svg' }))?.props.source as string).includes('@keyframes')).toBe(false)
  await ui.unmount()
})

test('/sgdemo opens the pane, on a tab or on a sample, and refuses nonsense', async ($, on) => {
  const box = engine(on)
  await start($)
  expect(await say($, 'sgdemo')).toMatch(/Opened the Style gallery pane on Surfaces/)
  expect(box.opened).toEqual(['style-gallery-main'])
  expect(await say($, 'sgdemo', 'modes')).toMatch(/on Modes/)
  expect(await say($, 'sgdemo', 'toast')).toMatch(/"Toast: pill and card" sample/)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await hasId(ui, 'toast')).toBe(true)
  await ui.unmount()
  expect(await say($, 'sgdemo', 'wat')).toMatch(/No sample/)
})

test('/sglist lists the ids and filters them', async ($, on) => {
  engine(on)
  await start($)
  const all = await say($, 'sglist')
  expect(all.split('\n').length).toBe(31)
  expect(all).toContain('radius')
  expect(await say($, 'sglist', 'badge')).toMatch(/1 of 30 samples matching "badge"/)
})

test('the quiet preferences are kept across sessions; the query and selection are not', async ($, on) => {
  const writes: unknown[] = []
  engine(on, { writes })
  await start($)
  await say($, 'sgdemo', 'modes')
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.input({ key: 'sg-q', text: 'pixel', kind: 'change' })
  await ui.press({ key: 'sort:name' })
  await ui.unmount()
  expect(writes.some(w => JSON.stringify(w) === JSON.stringify({ tab: 'modes', sort: 'id', grid: false }))).toBe(true)
  expect(writes.every(w => !JSON.stringify(w).includes('pixel'))).toBe(true)
  expect(writes.some(w => (w as { sort?: string }).sort === 'name')).toBe(true)
})

test('what an earlier session stored is read back', async ($, on) => {
  engine(on, { saved: { tab: 'feedback', sort: 'kind', grid: true } })
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Button', key: 'tab:feedback' }))?.props.variant).toBe('primary')
  expect((await ui.find({ type: 'Button', key: 'sort:kind' }))?.text).toBe('kind ✓')
  await ui.unmount()
})

test('a damaged stored value is ignored', async ($, on) => {
  engine(on, { saved: { tab: 5, sort: {}, grid: 'x' } })
  await start($)
  const bad = await $.ui.mount(PANE('terminal'))
  expect((await bad.find({ type: 'Button', key: 'tab:surfaces' }))?.props.variant).toBe('primary')
  await bad.unmount()
})

test('/sgreset puts everything back', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'sgdemo', 'modes')
  await say($, 'sggrid', 'on')
  expect(await say($, 'sgreset')).toMatch(/reset/)
  const ui = await $.ui.mount(PANE('terminal'))
  expect((await ui.find({ type: 'Button', key: 'tab:surfaces' }))?.props.variant).toBe('primary')
  expect((await ui.find({ type: 'Button', key: 'foot:grid' }))?.text).toBe('grid off')
  await ui.unmount()
})

test('a narrow pane and an empty tab still draw', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal', { bodyColumns: 24 }))
  await ui.input({ key: 'sg-q', text: 'zzzz', kind: 'change' })
  await ui.press({ key: 'tab:list' })
  expect(await has(ui, /No sample matches/)).toBe(true)
  await ui.press({ key: 'tab:controls' })
  expect(await ui.find({ type: 'Button', key: 'to-list' })).toBeDefined()
  await ui.unmount()
})

test('a theme accent setting reaches the drawing', async ($, on) => {
  engine(on, { accent: 'claude' })
  await start($)
  const ui = await $.ui.mount(PANE('desktop'))
  expect(((await ui.find({ type: 'Svg' }))?.props.source as string).includes('#c4562f')).toBe(true)
  await ui.unmount()
})
