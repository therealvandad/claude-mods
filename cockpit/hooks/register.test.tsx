import { hudSvg } from './hud'
import { expect, test } from 'claude-code/testing'

import { clamp, esc, money, niceCeil, smoothPath, vecAlt, vecDashSvg } from './vecdash'
import type { VecData } from './vecdash'

const PANE = {
  plugin: 'cockpit',
  component: 'Pane',
  requestId: 'cockpit',
  surface: 'desktop',
  props: {
    title: 'Cockpit',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const TERMINAL_PANE = { ...PANE, surface: 'terminal' } as any

type Usage = { cost?: { usd: number }; percent?: number; limits?: { kind: string; percentUsed: number }[] }

// Stands in for the engine. `clock.t` and `usage` are moved by each test.
const engine = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}) => {
  const saved: Record<string, unknown> = { view: { look: 'rich' }, ...init }
  const clock = { t: 1000 }
  const usage: Usage = { cost: { usd: 0 }, percent: 10, limits: [] }

  on('clock.now', () => ({ value: clock.t }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('clock.after', () => ({ value: { cancel() {} } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n', stderr: '' },
  }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1000, percent: usage.percent ?? null },
      rateLimits: usage.limits ?? [],
      cost: usage.cost,
    },
  }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))

  return { saved, clock, usage }
}

const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

// The desktop draws what is read as pictures: their descriptions and their markup.
const altsOf = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Svg' })).map((n: any) => String(n.props.alt)).join('\n')
const sourcesOf = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Svg' })).map((n: any) => String(n.props.source)).join('\n')

test('tab buttons switch the pane body', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const tabs = [
    ['timeline', 'Tool timeline'],
    ['files', 'Edited files'],
    ['todo', 'Todo'],
    ['history', 'Prompt history'],
    ['errors', 'Errors'],
    ['links', 'Links'],
    ['palette', 'Command palette'],
  ] as const

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^Session$/ })).toBeDefined()
  expect(await altsOf(ui)).not.toMatch(/^Tool timeline/m)

  for (const [id, heading] of tabs) {
    await ui.press({ key: `tab-${id}` })
    // On the desktop the heading is the title of a card.
    expect(await altsOf(ui)).toMatch(new RegExp(`^${heading}`, 'm'))
    expect(await sourcesOf(ui)).toContain(heading.toUpperCase())
    expect(await ui.find({ type: 'Text', text: /^Session$/ })).toBeUndefined()
  }
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()

  const term = await $.ui.mount(TERMINAL_PANE)
  expect(await term.find({ type: 'Text', text: /^Session$/ })).toBeDefined()

  for (const [id, heading] of tabs) {
    await term.press({ key: `tab-${id}` })
    expect(await term.find({ type: 'Text', text: new RegExp(`^${heading}$`) })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /^Session$/ })).toBeUndefined()
    expect(await term.findAll({ type: 'Svg' })).toHaveLength(0)
  }
  await term.unmount()
})

test('a todo is added by command, ticked by button and survives a new session', async ($, on) => {
  const { saved } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'ctodo', args: 'write the tests', origin: 'user' } as any)

  expect(saved.ctodos).toEqual([{ id: 1, text: 'write the tests', done: false }])

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-todo' })
  expect(await ui.find({ type: 'Button', text: /\[ \] write the tests/ })).toBeDefined()
  await ui.press({ key: 'todo-1' })

  expect(saved.ctodos).toEqual([{ id: 1, text: 'write the tests', done: true }])
  expect(await ui.find({ type: 'Button', text: /\[x\] write the tests/ })).toBeDefined()
  await ui.unmount()
})

test('saved todos load when a session starts', async ($, on) => {
  engine(on, { ctodos: [{ id: 4, text: 'old item', done: true }] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-todo' })
  expect(await ui.find({ type: 'Button', text: /\[x\] old item/ })).toBeDefined()
  await ui.unmount()
})

test('spend draws as a block-character sparkline on the terminal', async ($, on) => {
  const { usage } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (let usd = 0; usd < 8; usd += 1) {
    usage.cost = { usd }
    await $.turn.complete(done)
  }
  const ui = await $.ui.mount(TERMINAL_PANE)
  expect(await ui.find({ type: 'Text', text: /▁▂▃▄▅▆▇█/ })).toBeDefined()
  await ui.unmount()
})

test('the forecast projects a linear pace to the limit', async ($, on) => {
  const { usage, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // 10 percent per minute and 30 now: the 70 left take 7 minutes.
  for (const [t, p] of [[0, 10], [60_000, 20], [120_000, 30]] as const) {
    clock.t = t
    usage.limits = [{ kind: 'five_hour', percentUsed: p }]
    await $.turn.complete(done)
  }
  const ui = await $.ui.mount(PANE)
  expect(await altsOf(ui)).toMatch(/hit the five hour limit in 7 min/)
  expect(await sourcesOf(ui)).toMatch(/At this pace you will hit the five hour limit/)
  await ui.unmount()

  const term = await $.ui.mount(TERMINAL_PANE)
  expect(await term.find({ type: 'Text', text: /hit the five hour limit in 7 min/ })).toBeDefined()
  await term.unmount()
})

test('a flat or falling pace gives no forecast', async ($, on) => {
  const { usage, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const [t, p] of [[0, 50], [60_000, 50], [120_000, 50]] as const) {
    clock.t = t
    usage.limits = [{ kind: 'five_hour', percentUsed: p }]
    await $.turn.complete(done)
  }
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /At this pace/ })).toBeUndefined()
  expect(`${await altsOf(ui)} ${await sourcesOf(ui)}`).not.toMatch(/At this pace/)
  await ui.unmount()

  const term = await $.ui.mount(TERMINAL_PANE)
  expect(await term.find({ type: 'Text', text: /At this pace/ })).toBeUndefined()
  await term.unmount()
})

test('git band data is read from a read-only status', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(done)

  const ui = await $.ui.mount(PANE)
  expect(await altsOf(ui)).toMatch(/main.*\+2.*-1.*2 dirty/)
  expect(await sourcesOf(ui)).toMatch(/>main<[\s\S]*>\+2<[\s\S]*>-1<[\s\S]*>2 dirty</)
  await ui.unmount()

  const term = await $.ui.mount(TERMINAL_PANE)
  expect(await term.find({ type: 'Text', text: /main.*\+2.*-1.*2 dirty/ })).toBeDefined()
  await term.unmount()
})

test('failed calls land in the error log, edits in the file tree, tests in the strip', async ($, on) => {
  engine(on)
  on('tool.call', (_: unknown, e: { tool: string; command?: string }) =>
    e.tool === 'Bash' && e.command === 'npm test'
      ? { isError: true, result: 'exit 1', text: '2 failed, 5 passed see https://example.com/log.' }
      : { result: {}, text: 'ok' },
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/app/src/a.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Edit', file_path: '/app/src/a.ts', old_string: 'y', new_string: 'z' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-errors' })
  expect(await altsOf(ui)).toMatch(/2 failed, 5 passed/)
  expect(await sourcesOf(ui)).toContain('2 failed, 5 passed')
  await ui.press({ key: 'tab-files' })
  expect(await sourcesOf(ui)).toMatch(/>x2</)
  expect(await altsOf(ui)).toMatch(/a\.ts x2/)
  await ui.press({ key: 'tab-links' })
  expect(await altsOf(ui)).toMatch(/^https:\/\/example\.com\/log$/m)
  await ui.press({ key: 'tab-timeline' })
  expect(await altsOf(ui)).toMatch(/Bash failed/)
  expect(await sourcesOf(ui)).toMatch(/>Bash</)
  await ui.press({ key: 'tab-overview' })
  // Desktop draws the strip inside the one Svg; its alt text and tooltips carry the count.
  expect(((await ui.find({ type: 'Svg' })) as any)?.props.alt).toMatch(/0 of 1 test runs passed/)
  expect(((await ui.find({ type: 'Svg' })) as any)?.props.source).toMatch(/0\/1/)
  await ui.unmount()

  const term = await $.ui.mount(TERMINAL_PANE)
  expect(await term.find({ type: 'Text', text: /0\/1 passed/ })).toBeDefined()
  await term.press({ key: 'tab-errors' })
  expect(await term.find({ type: 'Text', text: /2 failed, 5 passed/ })).toBeDefined()
  await term.press({ key: 'tab-files' })
  expect(await term.find({ type: 'Text', text: /^x2$/ })).toBeDefined()
  await term.press({ key: 'tab-links' })
  expect(await term.find({ type: 'Text', text: /https:\/\/example\.com\/log$/ })).toBeDefined()
  await term.press({ key: 'tab-timeline' })
  expect(await term.find({ type: 'Text', text: /^Bash/ })).toBeDefined()
  await term.unmount()
})

test('a pin shows on top and toggles off', async ($, on) => {
  const { saved } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'cpin', args: 'ship friday', origin: 'user' } as any)
  expect(saved.cpins).toEqual(['ship friday'])

  const term = await $.ui.mount(TERMINAL_PANE)
  expect(await term.find({ type: 'Text', text: /^ship friday$/ })).toBeDefined()
  await term.unmount()

  const ui = await $.ui.mount(PANE)
  expect(await altsOf(ui)).toMatch(/^Pinned: ship friday$/m)
  expect(await sourcesOf(ui)).toContain('>ship friday<')
  await ui.press({ key: 'unpin-0' })
  expect(saved.cpins).toEqual([])
  expect(await altsOf(ui)).not.toMatch(/ship friday/)
  await ui.unmount()
})

test('a prompt can be refilled from history and searched', async ($, on) => {
  engine(on)
  const filled: string[] = []
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'fix the parser bug', wait: false, origin: { kind: 'composer' } })
  await $.command.run({ command: 'csearch', args: 'parser', origin: 'user' } as any)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-history' })
  expect(await altsOf(ui)).toMatch(/prompt: fix the parser bug/)
  expect(await sourcesOf(ui)).toContain('>fix the parser bug<')
  await ui.press({ key: 'hist-0' })
  expect(filled).toEqual(['fix the parser bug'])
  await ui.unmount()

  const term = await $.ui.mount(TERMINAL_PANE)
  expect(await term.find({ type: 'Text', text: /prompt: fix the parser bug/ })).toBeDefined()
  await term.press({ key: 'hist-0' })
  expect(filled).toEqual(['fix the parser bug', 'fix the parser bug'])
  await term.unmount()
})

test('the band keeps other rows and /cfocus hides only the cockpit row', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>other mod row</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(done)

  const BAND = { plugin: 'cockpit', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 80, scroll: { offset: 0, bodyRows: 5 }, view: {} } } as const
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /main.*\+2.*-1/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'cfocus', args: '', origin: 'user' } as any)
  const hidden = await $.ui.mount(BAND)
  expect(await hidden.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  expect(await hidden.find({ type: 'Text', text: /main.*\+2.*-1/ })).toBeUndefined()
  await hidden.unmount()
})

// ---------------------------------------------------------------- vector charts

// The shared switches belong to other mods: stub their state exactly as the engine would answer.
const foreign = (on: (...args: any[]) => unknown, opts: { motion?: boolean; calm?: boolean; accent?: string } = {}) =>
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

    return next(e)
  })

const fill = async ($: any, usage: Usage, clock: { t: number }, turns = 5) => {
  for (let i = 0; i < turns; i += 1) {
    clock.t = i * 60_000
    usage.cost = { usd: i * 0.4 }
    usage.percent = 10 + i * 12
    usage.limits = [
      { kind: 'five_hour', percentUsed: 20 + i * 5 },
      { kind: 'seven_day', percentUsed: 60 },
    ]
    await $.turn.complete(done)
  }
}

const svgOf = async (ui: any): Promise<string> => String(((await ui.find({ type: 'Svg' })) as any)?.props.source ?? '')

test('desktop Overview draws exactly one Svg and no text bars', async ($, on) => {
  const { usage, clock } = engine(on)
  foreign(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await fill($, usage, clock)

  const ui = await $.ui.mount(PANE)
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /▁|█|░|✓|✗/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^SPEND PER TURN$|^Spend per turn$|^Context per turn$|^Limits$|^Test runs$/i })).toBeUndefined()
  // The tiles row, the git row and the pace forecast are inside the same picture.
  const source = await svgOf(ui)
  expect(source).toContain('>PROMPTS<')
  expect(await altsOf(ui)).toMatch(/0 prompts, 1 tools, 0 files, 0 errors/)
  expect(await altsOf(ui)).toMatch(/main.*\+2.*-1.*2 dirty/)
  expect(source).toContain('Spend')
  expect(source).toContain('Seven day')
  await ui.unmount()
})

test('terminal Overview has no Svg and keeps the text charts', async ($, on) => {
  const { usage, clock } = engine(on)
  foreign(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await fill($, usage, clock)

  const ui = await $.ui.mount(TERMINAL_PANE)
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /^SPEND PER TURN$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^CONTEXT PER TURN$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^LIMITS$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▁.*█/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /five hour/ })).toBeDefined()
  await ui.unmount()
})

test('the Svg is animated only when motion is on and calm is off', async ($, on) => {
  const { usage, clock } = engine(on)
  let opts: { motion?: boolean; calm?: boolean; accent?: string } = {}
  on('state.get', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'motion' && e.key === 'isOn') {
      return { value: { value: opts.motion !== false, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'isCalm') {
      return { value: { value: opts.calm === true, version: 1 } }
    }

    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fill($, usage, clock)

  const seen: Record<string, { source: string; interactive: unknown }> = {}

  for (const [name, o] of [
    ['live', {}],
    ['motion off', { motion: false }],
    ['calm', { calm: true }],
  ] as const) {
    opts = o
    const ui = await $.ui.mount(PANE)
    const node = (await ui.find({ type: 'Svg' })) as any
    seen[name] = { source: String(node?.props.source), interactive: node?.props.isInteractive }
    await ui.unmount()
  }
  expect(seen.live?.source).toMatch(/@keyframes sweep/)
  expect(seen.live?.interactive).toBe(true)

  for (const name of ['motion off', 'calm']) {
    expect(seen[name]?.source).not.toMatch(/@keyframes|animation:|<animate/)
    expect(seen[name]?.interactive).toBe(false)
  }
})

test('the accent comes from the shared settings', async ($, on) => {
  engine(on)
  foreign(on, { accent: 'claude' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  expect(await svgOf(ui)).toContain('#d2511f')
  await ui.unmount()
})

const FULL: VecData = {
  contextPct: 63,
  spendUsd: 3.2,
  costSamples: [0.1, 0.4, 0.9, 1.6, 2.4, 3.2],
  ctxSamples: [10, 22, 35, 48, 55, 63],
  limits: [
    { kind: 'five hour', pct: 41 },
    { kind: 'seven day', pct: 72 },
  ],
  tests: Array.from({ length: 20 }, (_, i) => ({ ok: i % 4 !== 0 })),
  tools: { Bash: 42, Read: 31, Edit: 19, Grep: 12, Write: 6 },
}
const LOOK = { accent: 'suggestion', animate: true } as const

test('the vector charts are small, safe and well formed', () => {
  for (const animate of [true, false]) {
    const svg = vecDashSvg(FULL, { ...LOOK, animate })
    expect(svg.length).toBeLessThan(40_000)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).not.toMatch(/<script|\son[a-z]+=|javascript:|<foreignObject|href=|url\((?!#)/i)
    expect((svg.match(/<svg/g) ?? []).length).toBe(1)
    expect(svg).toContain('@media (prefers-color-scheme:dark)')
    // Every tag opened is closed: a cheap well-formedness check without a parser.
    const tags = [...svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)]
    const stack: string[] = []

    for (const [, closing, name, , selfClosing] of tags) {
      if (selfClosing === '/') {
        continue
      }

      if (closing === '/') {
        expect(stack.pop()).toBe(name)
      } else {
        stack.push(name as string)
      }
    }
    expect(stack).toEqual([])
  }
})

test('static version has no animation at all', () => {
  const still = vecDashSvg(FULL, { ...LOOK, animate: false })
  expect(still).not.toMatch(/@keyframes|animation:|<animate|class="[^"]*ping/)
  expect(vecDashSvg(FULL, LOOK)).toMatch(/@keyframes sweep/)
  expect(vecAlt(FULL)).toMatch(/context 63 percent/)
})

test('hostile tool and limit names cannot break out of the SVG', () => {
  const svg = vecDashSvg(
    { ...FULL, tools: { '<script>alert(1)</script>': 5, 'a"b&c': 2, "x'y": 1 }, limits: [{ kind: '"><svg onload=1>', pct: 50 }] },
    LOOK,
  )
  expect(svg).not.toContain('<script>')
  expect(svg).not.toContain('<svg onload')
  expect(svg).not.toMatch(/<[^>]*\sonload=/)
  expect(svg).toContain('&lt;script&gt;')
  expect(svg).toContain('a&quot;b&amp;c')
  expect(esc(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  expect((svg.match(/<svg/g) ?? []).length).toBe(1)
})

test('odd numbers are clamped, not drawn outside the rings', () => {
  const svg = vecDashSvg(
    {
      contextPct: 250,
      spendUsd: Number.NaN,
      costSamples: [Number.NaN, -5, 1e12, Number.POSITIVE_INFINITY],
      ctxSamples: [250, -5, Number.NaN],
      limits: [{ kind: 'five hour', pct: -5 }, { kind: 'seven day', pct: Number.NaN }],
      tests: [],
      tools: { Bash: Number.NaN, Read: -3, Edit: 1e12 },
    },
    LOOK,
  )
  expect(svg).not.toMatch(/NaN|undefined|Infinity/)
  expect(svg).toContain('100%')
  expect(svg).not.toMatch(/-5%/)
  expect(clamp(Number.NaN, 0, 100)).toBe(0)
  expect(clamp(250, 0, 100)).toBe(100)
  expect(clamp(-5, 0, 100)).toBe(0)
  expect(money(Number.NaN)).toBe('$0.00')
  expect(niceCeil(3.2)).toBe(5)
  expect(niceCeil(Number.NaN)).toBe(1)
  expect(vecAlt({ ...FULL, contextPct: 250 })).toMatch(/context 100 percent/)
})

test('empty data draws a quiet card layout, not blanks', () => {
  const svg = vecDashSvg({ contextPct: null, spendUsd: null, costSamples: [], ctxSamples: [], limits: [], tests: [], tools: {} }, LOOK)
  expect(svg).toContain('n/a')
  expect(svg).toContain('Fills in after the second reply.')
  expect(svg).toContain('No test commands seen yet.')
  expect(svg).toContain('No tool calls yet.')
  expect(svg).not.toMatch(/NaN|undefined/)
})

test('the smooth path handles none, one, two and many points', () => {
  expect(smoothPath([])).toBe('')
  expect(smoothPath([[1, 2]])).toBe('M1 2')
  expect(smoothPath([[0, 0], [10, 10]])).toMatch(/^M0 0 C/)
  expect(smoothPath([[0, 0], [5, 8], [10, 2], [15, 9]]).split('C').length).toBe(4)
})

test('the chart is given a real width AND height, in proportion', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  const tree = JSON.stringify(await ui.drawn())
  const width = Number(/"width":(\d+)/.exec(tree)?.[1] ?? 0)
  const height = Number(/"height":(\d+)/.exec(tree)?.[1] ?? 0)
  expect(width).toBeGreaterThanOrEqual(360)
  expect(height).toBeGreaterThanOrEqual(300)
  await ui.unmount()
})

test('the status strip has width and height on desktop, and is not drawn elsewhere', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>other mod row</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(done)
  const props = { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 8, bodyColumns: 70, scroll: { offset: 0, bodyRows: 8 }, view: {} }

  const desk = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'AbovePrompt', props } as any)
  const tree = JSON.stringify(await desk.drawn())
  expect(tree).toMatch(/"width":390/)
  // Drawn at the width it is shown (never scaled down), so the height stays the full 70.
  expect(tree).toMatch(/"height":70/)
  expect(tree).toContain('working')
  expect(tree).toMatch(/@keyframes sweep/)
  await desk.unmount()

  const term = await $.ui.mount({ plugin: 'cockpit', surface: 'terminal', component: 'AbovePrompt', props } as any)
  expect(JSON.stringify(await term.drawn())).not.toContain('<svg')
  await term.unmount()
})

test('the strip only moves while working, and never when motion is off or calm', () => {
  const base = { contextPct: 50, limitPct: 20, limitName: 'five_hour', spendUsd: 1, isWorking: true, tool: 'Bash', toolCalls: 2, trend: [10, 30, 50], animate: true }
  expect(hudSvg(base)).toMatch(/@keyframes sweep/)
  expect(hudSvg({ ...base, isWorking: false })).not.toMatch(/@keyframes|class="sweep"/)
  expect(hudSvg({ ...base, animate: false })).not.toMatch(/@keyframes|class="sweep"/)
  const odd = hudSvg({ ...base, contextPct: 400, limitPct: -3, spendUsd: Number.NaN, trend: [Number.NaN, 999], tool: '<script>' })
  expect(odd).not.toMatch(/NaN|<script>|undefined/)
  expect(odd.length).toBeLessThan(12_000)
})

test('the strip is well formed: no attribute runs into the next one', () => {
  for (const isWorking of [true, false]) {
    const svg = hudSvg({ contextPct: 61, limitPct: 12, limitName: 'five_hour', spendUsd: 2, isWorking, tool: 'Read', toolCalls: 3, trend: [1, 2, 3], animate: true })
    expect(svg).not.toMatch(/="[^"<>]*"[A-Za-z]/)
    expect(svg.split('<svg').length).toBe(2)
    expect(svg.endsWith('</svg>')).toBe(true)
  }
})
