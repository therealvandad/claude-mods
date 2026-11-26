import { expect, mock, test } from 'claude-code/testing'

import { CATALOG } from './catalog'
import { COMMANDS } from './pure'

const PANE_ID = 'anim-extra-main'
const NOON = new Date(2026, 10, 25, 12, 30).getTime()

const PANE = (surface: 'terminal' | 'desktop' = 'desktop') =>
  ({
    plugin: 'anim-extra',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: { title: 'Anim extra', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as const

const BAND = (extra: Record<string, unknown> = {}) =>
  ({
    plugin: 'anim-extra',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {}, ...extra },
  }) as any

const LIST = (rows: string[], hasSurvey = false) =>
  ({
    plugin: 'anim-extra',
    surface: 'terminal',
    component: 'AbovePromptList',
    requestId: 'band',
    props: {
      rows: rows.map(plugin => ({ plugin, tree: { type: 'Box', props: {}, children: [] } })),
      hasSurvey,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as any

const done = (durationMs = 1000) => ({ answer: '', durationMs, isAborted: false, turnId: 't', reason: 'answer' }) as any

type Opts = { motion?: boolean; calm?: boolean; cfg?: unknown; usage?: { percent: number; usd: number; limit?: number } }

// Stands in for the engine. `motion.isOn` and `settings.*` belong to other mods and are stubbed on state.get.
const engine = (on: any, init: Opts = {}) => {
  const flags = { motion: init.motion ?? true, calm: init.calm ?? false }
  const usage = { percent: 10, usd: 0.5, limit: 0, ...init.usage }
  const box = {
    toasts: [] as string[],
    fills: [] as { text: string; mode?: string }[],
    copies: [] as string[],
    commands: [] as string[],
    opened: [] as string[],
    stores: {} as Record<string, unknown>,
    nows: 0,
    tool: ((): any => ({ result: {} })) as (e: Record<string, unknown>) => any,
  }
  const clock = mock.clock(on, { now: NOON })
  if (init.cfg !== undefined) {
    box.stores['ax.cfg'] = init.cfg
  }
  on('store.get', (_: unknown, e: { key: string }) => ({ value: box.stores[e.key] }))
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete box.stores[e.key]

    return { value: undefined }
  })
  on('state.get', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'motion' && e.key === 'isOn') {
      return { value: { value: flags.motion, version: 1 } }
    }
    if (e.plugin === 'settings' && e.key === 'isCalm') {
      return { value: { value: flags.calm, version: 1 } }
    }

    return next(e)
  })
  on('state.set', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'anim-extra' && e.key === 'now') {
      box.nows += 1
    }

    return next(e)
  })
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    box.stores[e.key] = e.value

    return { value: undefined }
  })
  on('command.register', (_: unknown, e: { name: string }) => {
    box.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    box.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => undefined)
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.copy', (_: unknown, e: { text: string }) => {
    box.copies.push(e.text)

    return { value: { isCopied: true } }
  })
  on('prompt.fill', (_: unknown, e: { text: string; mode?: string }) => {
    box.fills.push({ text: e.text, mode: e.mode })

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_: unknown, e: Record<string, unknown>) => box.tool(e))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1000, percent: usage.percent },
      rateLimits: usage.limit > 0 ? [{ kind: 'five_hour', percentUsed: usage.limit, resetsAt: 0 }] : [],
      cost: { usd: usage.usd },
    },
  }))

  return { flags, usage, box, clock }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const say = async ($: any, command: string, args = '') => ((await $.command.run({ command, args, origin: 'user' } as any)) as { text: string }).text
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text)
const joined = async (ui: any) => (await texts(ui)).join('\n')
const withPane = async ($: any, fn: (ui: any) => Promise<void>, surface: 'terminal' | 'desktop' = 'desktop') => {
  const ui = await $.ui.mount(PANE(surface))
  await fn(ui)
  await ui.unmount()
}
const saved = (box: { stores: Record<string, unknown> }) => box.stores['ax.cfg'] as any
const finish = async ($: any, ms = 1000) => $.turn.complete(done(ms))

// ------------------------------------------------------------- commands

test('/ax lists every command, and every command is registered at session start', async ($, on) => {
  const { box } = engine(on)
  await start($)
  const text = await say($, 'ax')

  for (const [name] of COMMANDS) {
    expect(text).toContain(`/${name}:`)
    expect(box.commands).toContain(name)
  }
  expect(COMMANDS.every(([n]) => n === 'ax' || n.startsWith('ax'))).toBe(true)
  expect(text).toMatch(/\/motion off/)
})

test('/axpanel opens the pane and validates the tab name', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect(await say($, 'axpanel', 'rules')).toMatch(/pane opened/)
  expect(box.opened).toContain(PANE_ID)
  expect(await say($, 'axpanel', 'nope')).toMatch(/Tabs:/)
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/Alert rules|Rules \(0\/15\)/)
  })
})

// ------------------------------------------------------------- 174 aliases

test('aliases are stored, survive a restart, and /axrun fills the prompt', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect(await say($, 'axalias', 'add s dashboard')).toMatch(/Alias s -> \/dashboard/)
  expect(saved(box).aliases).toEqual({ s: '/dashboard' })
  expect(await say($, 'axalias', 'add 9x files')).toMatch(/1-16 characters/)
  expect(await say($, 'axrun', 's')).toMatch(/Prompt filled with \/dashboard/)
  expect(box.fills).toEqual([{ text: '/dashboard', mode: 'replace' }])
  expect(await say($, 'axrun', 'nope')).toMatch(/No alias/)
  expect(await say($, 'axalias', 'list')).toMatch(/s -> \/dashboard/)
  expect(await say($, 'axalias', 'rm s')).toMatch(/removed/)
  expect(await say($, 'axalias', 'rm s')).toMatch(/No alias/)
})

test('a saved config comes back after a restart, and garbage in the store is ignored', async ($, on) => {
  engine(on, { cfg: { aliases: { s: '/dashboard' }, lang: 'es', thresholds: { slowCallSec: 77 }, rules: ['if cost > 5 then toast "x"', 'junk'] } })
  await start($)
  expect(await say($, 'axalias', 'list')).toMatch(/s -> \/dashboard/)
  expect(await say($, 'axthresh')).toMatch(/slow call 77 s/)
  expect(await say($, 'axrule', 'list')).toMatch(/1\. if cost > \$5/)
})

test('garbage in the store falls back to defaults', async ($, on) => {
  engine(on, { cfg: 42 })
  await start($)
  expect(await say($, 'axthresh')).toMatch(/slow call 30 s · large output 200 lines · risky edit 50 lines/)
})

// ------------------------------------------------------------- 196 thresholds

test('thresholds are validated and stored', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect(await say($, 'axthresh', 'slow 45')).toMatch(/Slow call is now 45 seconds/)
  expect(saved(box).thresholds.slowCallSec).toBe(45)
  expect(await say($, 'axthresh', 'slow 0')).toMatch(/1 to 3600/)
  expect(await say($, 'axthresh', 'output abc')).toMatch(/whole number/)
  expect(await say($, 'axthresh', 'bogus 3')).toMatch(/Usage/)
  expect(await say($, 'axthresh', 'edit 99')).toMatch(/Risky edit is now 99/)
  expect(await say($, 'axthresh', 'reset')).toMatch(/defaults/)
  expect(saved(box).thresholds).toEqual({ slowCallSec: 30, largeOutputLines: 200, riskyEditLines: 50 })
})

// ------------------------------------------------------------- 198 rules

test('rules are validated, bounded at 15, listed and removed', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect(await say($, 'axrule', 'if cost > 5 then toast "Cost is {cost}"')).toMatch(/Rule 1 added/)
  expect(await say($, 'axrule', 'if cost > 5 then toast "Cost is {cost}"')).toMatch(/already/)
  expect(await say($, 'axrule', 'if speed > 5 then toast "x"')).toMatch(/Cannot read/)
  expect(await say($, 'axrule', 'if cost > 5 then run "ls"')).toMatch(/Expected/)
  expect(await say($, 'axrule', 'if cost > 5 then confetti "x"')).toMatch(/toast or fill/)

  for (let i = 2; i <= 15; i++) {
    expect(await say($, 'axrule', `if cost > ${i + 5} then toast "r${i}"`)).toMatch(new RegExp(`Rule ${i} added`))
  }
  expect(await say($, 'axrule', 'if cost > 99 then toast "r16"')).toMatch(/At most 15/)
  expect(saved(box).rules.length).toBe(15)
  expect(await say($, 'axrule', 'rm 15')).toMatch(/Rule 15 removed/)
  expect(await say($, 'axrule', 'rm 99')).toMatch(/Usage/)
  expect(await say($, 'axrule', 'clear')).toMatch(/removed/)
  expect(saved(box).rules).toEqual([])
})

test('a rule fires at turn end, once, and not again inside its cooldown', async ($, on) => {
  const { box, usage, clock } = engine(on)
  await start($)
  await say($, 'axrule', 'if cost > 5 then toast "Cost is {cost}"')
  usage.usd = 4
  await finish($)
  expect(box.toasts).toEqual([])
  usage.usd = 6.5
  await finish($)
  expect(box.toasts).toEqual(['Cost is $6.50'])
  await finish($)
  expect(box.toasts.length).toBe(1)
  await clock.advance(6 * 60_000)
  await finish($)
  expect(box.toasts.length).toBe(2)
})

test('a fill action appends to the prompt, never replaces what was typed', async ($, on) => {
  const { box, usage } = engine(on)
  await start($)
  await say($, 'axrule', 'if context >= 80 then fill "Please run /compact"')
  usage.percent = 85
  await finish($)
  expect(box.fills).toEqual([{ text: 'Please run /compact', mode: 'append' }])
})

test('rules on tool errors and turn duration', async ($, on) => {
  const { box } = engine(on)
  box.tool = e => (e.command === 'bad' ? { result: {}, isError: true } : { result: { stdout: 'ok' } })
  await start($)
  await say($, 'axrule', 'if errors >= 3 and duration > 60s then toast "{errors} failed, {duration}"')

  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Bash', command: 'bad' })
  }
  await finish($, 30_000)
  expect(box.toasts).toEqual([])
  await finish($, 90_000)
  expect(box.toasts).toEqual(['3 failed, 90s'])
})

test('calm silences ordinary rules and recipes, but an urgent rule still runs', async ($, on) => {
  const { box, usage } = engine(on, { calm: true })
  await start($)
  await say($, 'axrule', 'if cost > 5 then toast "plain"')
  await say($, 'axrule', 'urgent if cost > 5 then toast "urgent"')
  await say($, 'axrecipe', 'cost-5 on')
  usage.usd = 9
  await finish($)
  expect(box.toasts).toEqual(['urgent'])
})

test('only one toast per three minutes from this mod', async ($, on) => {
  const { box, usage, clock } = engine(on)
  await start($)
  await say($, 'axrule', 'if cost > 5 then toast "a"')
  await say($, 'axrule', 'if cost > 6 then toast "b"')
  usage.usd = 9
  await finish($)
  expect(box.toasts).toEqual(['a'])
  await clock.advance(4 * 60_000)
  await finish($)
  // "a" is still inside its own 5 minute cooldown, so "b" speaks now.
  expect(box.toasts).toEqual(['a', 'b'])
})

// ------------------------------------------------------------- 199 recipes

test('recipes are prebuilt rules you switch on: tests-toast and tests-confetti', async ($, on) => {
  const { box, clock } = engine(on)
  box.tool = e => ({ result: { stdout: e.command === 'npm test' ? 'Tests: 12 passed' : 'ok' } })
  await start($)
  expect(await say($, 'axrecipe', 'list')).toMatch(/tests-toast \[off\]/)
  await finish($)
  expect(box.toasts).toEqual([])
  expect(await say($, 'axrecipe', 'tests-toast on')).toMatch(/on/)
  expect(await say($, 'axrecipe', 'bogus on')).toMatch(/Usage/)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await finish($)
  expect(box.toasts).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await finish($)
  expect(box.toasts).toEqual(['Tests passed.'])

  // The confetti line shows in the band for three seconds, then goes.
  await say($, 'axrecipe', 'tests-confetti on')
  await clock.advance(10 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await finish($)
  const ui = await $.ui.mount(BAND())
  expect(await joined(ui)).toMatch(/Tests passed/)
  await ui.unmount()
  await clock.advance(3500)
  const after = await $.ui.mount(BAND())
  expect(await joined(after)).not.toMatch(/Tests passed/)
  await after.unmount()
})

test('a failing test run does not count as passing', async ($, on) => {
  const { box } = engine(on)
  box.tool = () => ({ result: { stdout: 'Tests: 2 failed, 10 passed' } })
  await start($)
  await say($, 'axrecipe', 'tests-toast on')
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await finish($)
  expect(box.toasts).toEqual([])
})

// ------------------------------------------------------------- animations: ticker, motion, calm

test('with motion on a demo runs a ticker that stops itself when idle', async ($, on) => {
  const { box, clock } = engine(on)
  await start($)
  expect(await say($, 'axdemo')).toMatch(/Playing/)
  await clock.advance(1000)
  const mid = box.nows
  expect(mid > 3).toBe(true)
  await clock.advance(10_000)
  const end = box.nows
  expect(end > mid).toBe(true)
  await clock.advance(60_000)
  expect(box.nows).toBe(end)
})

test('with the motion atom false nothing ticks and every piece shows its still frame', async ($, on) => {
  const { box, clock } = engine(on, { motion: false })
  await start($)
  expect(await say($, 'axdemo')).toMatch(/Motion is off or calm/)
  await finish($)
  await say($, 'axpanel', 'lab')
  await say($, 'axpanel', 'motion')
  await clock.advance(60_000)
  // Only event writes: a few at most, and none after the events.
  const before = box.nows
  await clock.advance(60_000)
  expect(box.nows).toBe(before)
  expect(before <= 6).toBe(true)

  await say($, 'axpanel', 'lab')
  await withPane($, async ui => {
    const t = await joined(ui)
    expect(t).toMatch(/Motion is off or calm/)
    // Final content at once: the card titles, never grey bars.
    expect(t).toMatch(/Fix login redirect/)
    expect(t).not.toMatch(/░/)
    expect(t).toMatch(/1 notifications/)
  })
})

test('the motion mod store flag switches the ticker off too', async ($, on) => {
  const { box, clock } = engine(on)
  box.stores.motion = false
  await start($)
  await say($, 'axdemo')
  await clock.advance(30_000)
  expect(box.nows <= 2).toBe(true)
})

test('calm (settings.isCalm) gives still frames and no ticker', async ($, on) => {
  const { box, clock } = engine(on, { calm: true })
  await start($)
  expect(await say($, 'axdemo')).toMatch(/Motion is off or calm/)
  await say($, 'axpanel', 'lab')
  await clock.advance(30_000)
  expect(box.nows <= 3).toBe(true)
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/Fix login redirect/)
  })
})

test('the skeleton shows grey bars of the content widths, then the content', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await say($, 'axpanel', 'lab')
  await clock.advance(300)
  await withPane($, async ui => {
    const t = await joined(ui)
    expect(t).not.toMatch(/Fix login redirect/)
    // A bar the width of the title (18) is drawn, in grey and bright parts.
    const bars = (await texts(ui)).filter(x => /^[░▓]+$/.test(x)).join('')
    expect(bars.length >= 18).toBe(true)
  })
  await clock.advance(5000)
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/Fix login redirect/)
    expect(await joined(ui)).toMatch(/Lazy-loads the chart module/)
  })
})

test('a finished turn ripples: the count goes up and four ring frames play', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await say($, 'axpanel', 'lab')
  await clock.advance(4000)
  await finish($)
  const frames = new Set<string>()
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/1 notifications/)
  })

  for (let i = 0; i < 4; i++) {
    await withPane($, async ui => {
      const ring = (await texts(ui)).find(x => /^[◉◎○◌●]$/.test(x))
      frames.add(ring ?? '?')
    })
    await clock.advance(150)
  }
  expect(frames.size >= 3).toBe(true)
  await clock.advance(2000)
  await withPane($, async ui => {
    expect((await texts(ui)).includes('●')).toBe(true)
  })
})

// ------------------------------------------------------------- 166 glow

test('glow is off by default: an urgent rule toasts but draws no edge and no band line', async ($, on) => {
  const { box, usage } = engine(on)
  await start($)
  await say($, 'axrule', 'urgent if cost > 5 then toast "hot"')
  usage.usd = 9
  await finish($)
  expect(box.toasts).toEqual(['hot'])
  const ui = await $.ui.mount(BAND())
  expect(await texts(ui)).toEqual([])
  await ui.unmount()
})

test('with glow on, an urgent event pulses the edge and shows one band line for ten seconds', async ($, on) => {
  const { box, usage, clock } = engine(on)
  await start($)
  expect(await say($, 'axglow')).toMatch(/off/)
  expect(await say($, 'axglow', 'test')).toMatch(/Glow is off/)
  expect(await say($, 'axglow', 'on')).toMatch(/Urgent glow on/)
  expect((await $.ui.mount(BAND()).then(async u => { const t = await texts(u); await u.unmount(); return t }))).toEqual([])
  usage.percent = 93
  await finish($)
  expect(box.toasts).toEqual([])

  const ui = await $.ui.mount(BAND())
  expect(await joined(ui)).toMatch(/urgent: context 93% full/)
  const colours = new Set<string>()
  await ui.unmount()

  for (let i = 0; i < 6; i++) {
    const b = await $.ui.mount(BAND())
    const node = await b.find({ type: 'Text', text: /urgent/ })
    colours.add(String((node as any)?.props?.color))
    await b.unmount()
    await clock.advance(500)
  }
  // Two seconds per cycle: both colours of the pulse showed.
  expect(colours.size).toBe(2)
  await clock.advance(10_000)
  const gone = await $.ui.mount(BAND())
  expect(await texts(gone)).toEqual([])
  await gone.unmount()
})

test('with glow on and calm, the urgent edge is steady, not pulsing', async ($, on) => {
  const { clock } = engine(on, { calm: true })
  await start($)
  await say($, 'axglow', 'on')
  await say($, 'axglow', 'test')
  const colours = new Set<string>()

  for (let i = 0; i < 5; i++) {
    const b = await $.ui.mount(BAND())
    colours.add(String(((await b.find({ type: 'Text', text: /urgent/ })) as any)?.props?.color))
    await b.unmount()
    await clock.advance(700)
  }
  expect([...colours]).toEqual(['error'])
})

test('a rate limit at 95 percent is urgent too, and /axglow clear ends the event', async ($, on) => {
  const { usage } = engine(on)
  await start($)
  await say($, 'axglow', 'on')
  usage.limit = 96
  await finish($)
  const ui = await $.ui.mount(BAND())
  expect(await joined(ui)).toMatch(/rate limit 96% used/)
  await ui.unmount()
  await say($, 'axglow', 'clear')
  const after = await $.ui.mount(BAND())
  expect(await texts(after)).toEqual([])
  await after.unmount()
})

test('the pane edge is drawn only while glow is on', async ($, on) => {
  engine(on)
  await start($)
  let ui = await $.ui.mount(PANE())
  expect(((await ui.drawn()) as any).props.borderStyle).toBeUndefined()
  await ui.unmount()
  await say($, 'axglow', 'on')
  ui = await $.ui.mount(PANE())
  expect(((await ui.drawn()) as any).props.borderStyle).toBe('round')
  await ui.unmount()
})

// ------------------------------------------------------------- 176 band layout

test('the band hook changes nothing by default, then hides and orders other rows', async ($, on) => {
  engine(on)
  await start($)
  let ui = await $.ui.mount(LIST(['a', 'b', 'c']))
  expect(((await ui.drawn()) as any).children).toHaveLength(3)
  await ui.unmount()

  expect(await say($, 'axband', 'hide b')).toMatch(/hidden/)
  expect(await say($, 'axband', 'hide anim-extra')).toMatch(/never hidden/)
  expect(await say($, 'axband', 'hide ../etc')).toMatch(/Usage/)
  ui = await $.ui.mount(LIST(['a', 'b', 'c']))
  expect(((await ui.drawn()) as any).children).toHaveLength(2)
  await ui.unmount()

  // A survey holds the band: nothing is touched.
  ui = await $.ui.mount(LIST(['a', 'b', 'c'], true))
  expect(((await ui.drawn()) as any).children).toHaveLength(3)
  await ui.unmount()

  expect(await say($, 'axband', 'show b')).toMatch(/shown again/)
  expect(await say($, 'axband', 'order c,a')).toMatch(/c, a first/)
  expect(await say($, 'axband', 'status')).toMatch(/Order: c, a/)
  expect(await say($, 'axband', 'reset')).toMatch(/default/)
  ui = await $.ui.mount(LIST(['a', 'b', 'c']))
  expect(((await ui.drawn()) as any).children).toHaveLength(3)
  await ui.unmount()
})

// ------------------------------------------------------------- 195, 197, 200

test('language, glyphs and ratings are stored and used by the pane', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await say($, 'axpanel', 'tune')
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/Language/)
  })
  expect(await say($, 'axlang', 'fr')).toMatch(/en, es, de/)
  expect(await say($, 'axlang', 'es')).toMatch(/now in es/)
  expect(saved(box).lang).toBe('es')
  await withPane($, async ui => {
    const t = await joined(ui)
    expect(t).toMatch(/Idioma/)
    expect(t).toMatch(/Umbrales/)
    expect(t).not.toMatch(/Language/)
  })
  await say($, 'axlang', 'de')
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/Sprache/)
  })

  expect(await say($, 'axglyph', 'ts ★')).toMatch(/\.ts is now ★/)
  expect(await say($, 'axglyph', 'ts toolong')).toMatch(/Usage/)
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/★ src\/app\.ts/)
  })
  expect(await say($, 'axglyph', 'rm ts')).toMatch(/removed/)

  expect(await say($, 'axrate', 'motion 4 calm and clear')).toMatch(/motion ★★★★☆/)
  expect(await say($, 'axrate', 'nonsense 4')).toMatch(/No mod called/)
  expect(await say($, 'axrate', 'motion 9')).toMatch(/Usage/)
  expect(await say($, 'axrate', 'list')).toMatch(/motion ★★★★☆ calm and clear/)
  expect(saved(box).ratings.motion).toEqual({ stars: 4, note: 'calm and clear' })
  await say($, 'axpanel', 'market')
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/calm and clear/)
  })
  expect(await say($, 'axrate', 'motion 0')).toMatch(/cleared/)
  expect(saved(box).ratings).toEqual({})
})

// ------------------------------------------------------------- the pane tabs

test('every tab draws on every surface', async ($, on) => {
  engine(on)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const tab of ['hub', 'presets', 'mods', 'alias', 'band', 'lab', 'motion', 'rules', 'tune', 'market', 'about']) {
      await say($, 'axpanel', tab)
      await withPane($, async ui => {
        expect([surface, tab, (await texts(ui)).length >= 3]).toEqual([surface, tab, true])
      }, surface)
    }
  }
})

test('the hub lists every mod of the build-time table with its help command as a Button', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await say($, 'axpanel', 'hub')

  // The shared settings come first, with the current values.
  await withPane($, async ui => {
    const t = await joined(ui)
    expect(t).toMatch(/preset full · accent suggestion · density normal · icons symbols · calm off/)
    expect(await ui.find({ type: 'Button', text: /\/cfg/ })).toBeDefined()
    await ui.press({ key: 'cfg-preset-calm' })
    await ui.press({ key: 'cfg-accent-warning' })
  })
  expect(box.fills.map(f => f.text)).toEqual(['/cfg preset calm', '/cfg accent warning'])

  // Each group lists its mods.
  const groups = new Set(CATALOG.map(m => m.group))

  for (const g of groups) {
    await withPane($, async ui => {
      await ui.press({ key: `group-${g}` })
    })
    await withPane($, async ui => {
      const t = await joined(ui)

      for (const m of CATALOG.filter(x => x.group === g)) {
        expect(t).toContain(m.name)
      }
    })
  }
  const settingsMod = CATALOG.find(m => m.name === 'settings')!
  expect(settingsMod.help).toBe('cfg')
})

test('hub reads the shared settings atoms', async ($, on) => {
  engine(on, { calm: true })
  await start($)
  await say($, 'axpanel', 'hub')
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/calm on/)
  })
})

test('presets: a checklist with a Fill button per line and a Copy all', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await say($, 'axpanel', 'presets')
  await withPane($, async ui => {
    const t = await joined(ui)
    expect(t).toMatch(/Quiet day/)
    expect(t).toMatch(/\/cfg preset calm/)
    expect(t).toMatch(/cannot run other mods commands/)
    await ui.press({ key: 'pfill-calm-1' })
    await ui.press({ key: 'chk-calm-0' })
    await ui.press({ key: 'pcopy-calm' })
  })
  expect(box.fills[0]!.text).toBe('/motion off')
  expect(saved(box).checks).toEqual({ 'calm:0': true })
  expect(box.copies[0]).toContain('/cfg preset calm\n/motion off')
  expect(await say($, 'axpreset', 'focus')).toMatch(/\/alsnooze 60/)
  expect(await say($, 'axpreset', 'zzz')).toMatch(/Presets:/)
})

test('mods tab: all mods, with a copyable disable line each', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await say($, 'axpanel', 'mods')
  await withPane($, async ui => {
    const t = await joined(ui)

    for (const m of CATALOG) {
      expect(t).toContain(`claude plugin disable ${m.name}@local-mods`)
    }
    expect(t).toMatch(/needed by: .*animations/)
    await ui.press({ key: 'dis-motion' })
  })
  expect(box.copies).toEqual(['claude plugin disable motion@local-mods'])
})

test('the build-time table covers every mod folder beside this one', async () => {
  expect(CATALOG.length >= 25).toBe(true)
  expect(new Set(CATALOG.map(m => m.name)).size).toBe(CATALOG.length)

  for (const name of ['settings', 'motion', 'animations', 'workbench', 'tool-guard', 'anim-extra']) {
    expect(CATALOG.some(m => m.name === name)).toBe(true)
  }

  for (const m of CATALOG) {
    expect(m.desc.length > 10).toBe(true)
  }
})

test('alias tab buttons fill and remove', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await say($, 'axalias', 'add s dashboard')
  await say($, 'axpanel', 'alias')
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/not a new slash command/)
    await ui.press({ key: 'afill-s' })
    await ui.press({ key: 'arm-s' })
  })
  expect(box.fills[0]!.text).toBe('/dashboard')
  expect(saved(box).aliases).toEqual({})
})

test('the band tab toggles a mod and the rules tab toggles a recipe', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await say($, 'axpanel', 'band')
  await withPane($, async ui => {
    await ui.press({ key: 'band-layout' })
  })
  expect(saved(box).band.hidden).toEqual(['layout'])
  await say($, 'axpanel', 'rules')
  await withPane($, async ui => {
    await ui.press({ key: 'recipe-cost-5' })
  })
  expect(saved(box).recipes).toEqual({ 'cost-5': true })
})

test('market: pressing the stars cycles the rating', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await say($, 'axpanel', 'market')
  await withPane($, async ui => {
    await ui.press({ key: 'rate-motion' })
    await ui.press({ key: 'rate-motion' })
  })
  expect(saved(box).ratings.motion.stars).toBe(2)
})

test('the motion tab shows each animation still and animated side by side', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await say($, 'axpanel', 'motion')
  await clock.advance(700)
  await withPane($, async ui => {
    const t = await joined(ui)
    expect(t).toMatch(/still/)
    expect(t).toMatch(/animated/)
    expect(t).toMatch(/Loading skeleton/)
    expect(t).toMatch(/Notification ripple/)
    expect(t).toMatch(/Urgent edge glow/)
    expect(t).toMatch(/Day and night strip/)
    expect(t).toMatch(/#[0-9a-f]{6}/)
  })
  // After the loop window the animated side is paused, and the ticker is idle.
  await clock.advance(30_000)
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/paused/)
  })
})

test('the day-night strip has 24 raw-hex cells', async ($, on) => {
  engine(on)
  await start($)
  await say($, 'axpanel', 'lab')
  await withPane($, async ui => {
    const cells = ((await ui.findAll({ type: 'Text', text: /^█$/ })) as any[]).map(n => n.props?.color)
    expect(cells.length).toBe(24)
    expect(cells.every(c => /^#[0-9a-f]{6}$/.test(String(c)))).toBe(true)
  })
})

// ------------------------------------------------------------- recording and reset

test('tool calls are recorded for the lab, and /axreset clears everything', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await say($, 'axalias', 'add s dashboard')
  await say($, 'axrule', 'if cost > 5 then toast "x"')
  await say($, 'axglow', 'on')
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/a.ts', old_string: 'a', new_string: 'b' })
  await say($, 'axpanel', 'tune')
  await withPane($, async ui => {
    expect(await joined(ui)).toMatch(/⬡ …\/src\/a\.ts/)
    expect(await joined(ui)).toMatch(/Edit \d/)
  })
  expect(await say($, 'axreset')).toMatch(/cleared/)
  expect(box.stores['ax.cfg']).toBeUndefined()
  expect(await say($, 'axalias', 'list')).toMatch(/No aliases/)
  expect(await say($, 'axrule', 'list')).toMatch(/No rules yet/)
  expect(await say($, 'axglow')).toMatch(/off/)
  await withPane($, async ui => {
    expect(await joined(ui)).not.toMatch(/src\/a\.ts/)
  })
})

test('a tool call that throws still passes through and is counted as an error', async ($, on) => {
  const { box } = engine(on)
  box.tool = () => {
    throw new Error('boom')
  }
  await start($)
  await say($, 'axrule', 'if errors >= 1 then toast "an error"')
  await $.tool.call({ tool: 'Bash', command: 'x' }).catch(() => undefined)
  await finish($)
  expect(box.toasts).toEqual(['an error'])
})
