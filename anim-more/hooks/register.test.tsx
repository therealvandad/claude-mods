import { expect, mock, test } from 'claude-code/testing'

const LAB = 'anim-more-lab'
// A fixed local time: 25 Nov 2026, 12:30.
const NOON = new Date(2026, 10, 25, 12, 30).getTime()
const DAY = 24 * 60 * 60_000

const BAND = (isWorking = false) =>
  ({
    plugin: 'anim-more',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as const

const PANE = {
  plugin: 'anim-more',
  surface: 'desktop',
  component: 'Pane',
  requestId: LAB,
  props: { title: 'More animations', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

type Init = { motion?: boolean; calm?: boolean; accent?: string; icons?: string; stored?: Record<string, unknown>; isPlaced?: boolean }

// The plugin's own store, in memory, so the tests can read what it saved.
let db: Record<string, unknown> = {}

// Stands in for the engine. `motion` and `calm` are the foreign atoms the motion and settings mods own.
const engine = (on: any, init: Init = {}) => {
  const flags = { motion: init.motion ?? true, calm: init.calm ?? false }
  db = JSON.parse(JSON.stringify(init.stored ?? {}))
  const usage = { percent: 10, usd: 0.5 }
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const counts = { nows: 0 }
  const tool: { fn: (e: Record<string, unknown>) => unknown } = { fn: () => ({ result: {} }) }
  const clock = mock.clock(on, { now: NOON })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: db[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    db[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete db[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(db) }))
  on('state.get', (_: unknown, e: any, next: any) =>
    e.plugin === 'motion' && e.key === 'isOn'
      ? { value: { value: flags.motion, version: 1 } }
      : e.plugin === 'settings' && e.key === 'isCalm'
        ? { value: { value: flags.calm, version: 1 } }
        : e.plugin === 'settings' && e.key === 'accent' && init.accent !== undefined
          ? { value: { value: init.accent, version: 1 } }
          : e.plugin === 'settings' && e.key === 'icons' && init.icons !== undefined
            ? { value: { value: init.icons, version: 1 } }
            : next(e),
  )
  // Every tick writes the `now` atom, so counting those writes counts ticks and events.
  on('state.set', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'anim-more' && e.key === 'now') {
      counts.nows += 1
    }

    return next(e)
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)

    return { value: { isPlaced: init.isPlaced ?? true } }
  })
  on('ui.close', () => undefined)
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', () => ({ turnId: 't' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_: unknown, e: Record<string, unknown>) => tool.fn(e))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000, percent: usage.percent }, rateLimits: [], cost: { usd: usage.usd } },
  }))

  return { flags, usage, statuses, toasts, opened, counts, tool, clock }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const call = ($: any, input: Record<string, unknown>) => $.tool.call(input as any)
const run = async ($: any, name: string, args = '') => (await $.command.run({ command: name, args, origin: 'user' } as any)).text as string
const ok = (stdout = '') => ({ result: { stdout, stderr: '', interrupted: false } })
const bad = (stdout = '') => ({ result: { stdout, stderr: '', interrupted: false }, isError: true })

const nodes = (n: any): any[] => [n, ...(n.children ?? []).filter((c: unknown) => typeof c === 'object' && c !== null).flatMap(nodes)]
const textOf = (n: any) => (n.children ?? []).filter((c: unknown) => typeof c === 'string').join('')
const sect = async (ui: any, head: string) => {
  const boxes = ((await ui.findAll({ type: 'Box' })) as any[]).filter(b => typeof b.text === 'string' && b.text.startsWith(head))

  return boxes.sort((a, b) => a.text.length - b.text.length)[0]
}
/** The Text nodes (with props) inside the lab section whose heading starts with `head`. */
const secTextNodes = async (ui: any, head: string) => nodes(await sect(ui, head)).filter(x => x.type === 'Text')
const secTexts = async (ui: any, head: string) => (await secTextNodes(ui, head)).map(textOf)

const lab = async ($: any, fn: (ui: any) => Promise<void>) => {
  const ui = await $.ui.mount(PANE)

  try {
    await fn(ui)
  } finally {
    await ui.unmount()
  }
}
const band = async ($: any, fn: (rows: string[]) => Promise<void>, isWorking = false) => {
  const ui = await $.ui.mount(BAND(isWorking))
  const rows = ((await ui.findAll({ type: 'Text' })) as any[]).map(textOf)

  try {
    await fn(rows)
  } finally {
    await ui.unmount()
  }
}
const press = async ($: any, key: string) => {
  const ui = await $.ui.mount(PANE)
  await ui.press({ key })
  await ui.unmount()
}
const stored = async (_$: unknown, key: string) => db[key]
/** Frames of a cycle do not start at 0 (the clock is arbitrary): each must follow the one before. */
const isCycle = (seen: string[], cycle: readonly string[]) => {
  const at = cycle.indexOf(seen[0]!)

  return at >= 0 && seen.every((g, i) => g === cycle[(at + i) % cycle.length])
}

// ------------------------------------------------------------- the command and the quiet default

test('/ay lists all twenty pieces, every command, and states the current switches', async ($, on) => {
  engine(on)
  await start($)
  const text = await run($, 'ay')

  for (let n = 143; n <= 162; n++) {
    expect(text).toMatch(new RegExp(`(^|\\n)\\s+${n} `))
  }

  for (const c of ['aylab', 'aydemo', 'aywave', 'ayrain', 'ayspin', 'aytype', 'aymarquee', 'aytoast', 'aysprint', 'ayjot', 'aygrow', 'ayrocket', 'aytodo', 'ayreset']) {
    expect(text).toContain(`/${c}`)
  }
  expect(text).toMatch(/wave off, rain\+fireworks off, spinner dots/)
  expect(text).not.toMatch(/static final frame/)
})

test('the band adds nothing by default: not while idle, not during a turn, not after a build', async ($, on) => {
  const { tool, clock } = engine(on)
  tool.fn = () => ok('built')
  await start($)
  await band($, async rows => expect(rows).toEqual([]))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(450)
  await band($, async rows => expect(rows).toEqual([]), true)
  await call($, { tool: 'Bash', command: 'npm run build' })
  await call($, { tool: 'Bash', command: 'git tag v1' })
  await clock.advance(300)
  await band($, async rows => expect(rows).toEqual([]), true)
  await $.turn.complete(done)
})

// ------------------------------------------------------------- motion off and calm: no ticker, static final frames

for (const mode of [{ motion: false }, { calm: true }] as Init[]) {
  const label = mode.motion === false ? 'motion off' : 'settings calm'

  test(`${label}: no ticker ever starts and every piece shows its static final frame`, async ($, on) => {
    const { counts, clock, statuses, tool, usage, toasts } = engine(on, mode)
    tool.fn = e => (e.command === 'bad' ? bad('FAILED') : ok('built'))
    await start($)
    await run($, 'aywave', 'on')
    await run($, 'ayrain', 'on')
    await run($, 'aylab')
    await $.turn.start({ text: 'hi', turnId: 't1' })

    // UI tab: pressed controls land on their final frame at once.
    for (const k of ['tip', 'under', 'sqA', 'toast']) {
      await press($, k)
    }
    await lab($, async ui => {
      expect((await secTexts(ui, '143'))[1]).toBe('▏ Hints grow in three steps, then stay.')
      expect((await secTexts(ui, '145')).join('')).toBe(`145  underline draw${'━'.repeat(9)}`)
      expect((await secTexts(ui, '147'))[1]).toBe('▸ Saved: lab sample')
      const squish = nodes(await sect(ui, '146')).filter(x => x.type === 'Box' && x.props?.width === 16)
      expect(squish.map(b => b.props.paddingLeft)).toEqual([0, 0])
      const glow = nodes(await sect(ui, '144')).find(x => x.type === 'Box' && x.props?.borderStyle === 'round')
      expect(glow.props.borderColor).toBe('suggestion')
      expect(glow.props.borderDimColor).toBe(false)
      expect((await secTexts(ui, '149'))[1]).toBe('⠋')
      expect((await secTexts(ui, '148'))[1]).toMatch(/^[▁▂▃▄▅▆▇]{48}$/)
    })

    {
      await clock.advance(1000)
      const n = counts.nows
      await clock.advance(5000)
      expect(counts.nows).toBe(n)
    }

    // Text tab.
    await run($, 'aytype', 'Hello there, this is the whole text')
    await run($, 'aymarquee', '/Users/you/projects/a-long-project-name/packages/core/src/components/Sidebar/index.tsx')
    await call($, { tool: 'Bash', command: 'bad' })
    usage.usd = 0.9
    await call($, { tool: 'Read', file_path: '/a.ts' })
    await run($, 'ayjot', 'first day')
    await clock.advance(DAY)
    await call($, { tool: 'Read', file_path: '/b.ts' })
    await run($, 'ayjot', 'second day')
    await lab($, async ui => {
      expect((await secTexts(ui, '150'))[1]).toBe('Hello there, this is the whole text')
      const m = (await secTexts(ui, '151'))[1]!
      expect(m.length).toBe(46)
      expect(m.startsWith('/Users')).toBe(true)
      expect(m.endsWith('index.tsx')).toBe(true)
      expect(m).toContain('…')
      const badge = (await secTextNodes(ui, '152'))[1]
      expect(textOf(badge)).toBe('● 1')
      expect(badge.props.color).toBe('error')
      expect(badge.props.weight).toBe('regular')
      const drip = await secTexts(ui, '153')
      expect(drip.slice(1, 4)).toEqual([' ', ' ', ' '])
      expect(drip[4]).toBe('$0.90')
      expect((await secTexts(ui, '158'))[1]).toBe('2026-11-26  second day')
      // Two days counted: stage 2, drawn at once.
      expect((await secTexts(ui, '154')).slice(1, 6)).toEqual(['       ', '       ', '  \\ /  ', '   |   ', '~~~|~~~'])
    })

    // Fun tab.
    await run($, 'aysprint', '0.1')
    await run($, 'ayrocket', '60')
    await call($, { tool: 'Bash', command: 'npm run build' })
    await call($, { tool: 'Bash', command: 'git tag v1' })
    await clock.advance(10_000)
    await lab($, async ui => {
      expect((await secTexts(ui, '155'))[1]).toBe('falls after a build succeeds')
      expect((await secTexts(ui, '156'))[1]).toBe('bursts after a git tag succeeds')
      expect((await secTexts(ui, '157'))[1]!.includes('●')).toBe(true)
      expect((await secTexts(ui, '159'))[1]).toBe('◴')
      expect((await secTexts(ui, '160'))[3]).toBe('    ●    ')
      expect((await secTexts(ui, '161'))[1]).toBe('·······=^.^=········')
      const rocket = await secTexts(ui, '162')
      expect(rocket[1]!.indexOf('▶')).toBe(Math.round(0.6 * 23))
      expect(rocket[1]!.includes('≈')).toBe(false)
    })
    await band(
      $,
      async rows => {
        // Calm: the band is silent. Motion off: only the static wave row, never rain or fireworks.
        expect(rows.every(r => r.length !== 24 && r.length !== 40)).toBe(true)

        if (mode.calm === true) {
          expect(rows).toEqual([])
        }
      },
      true,
    )

    // The staged toast is one plain write, then it clears itself with no ticker.
    await run($, 'aytoast', 'Saved ok')
    expect(statuses).toContain('▸ Saved ok')
    expect(statuses.some(s => s !== undefined && /^[▁▄]/.test(s))).toBe(false)
    await clock.advance(5000)
    expect(statuses[statuses.length - 1]).toBeUndefined()
    // The sprint alarm still sounds: it is an explicit user timer.
    expect(toasts.some(t => /^Sprint done/.test(t))).toBe(true)

    // The demo plays nothing.
    expect(await run($, 'aydemo')).toMatch(/Nothing plays/)
    await clock.advance(60_000)
    const before = counts.nows
    await clock.advance(120_000)
    expect(counts.nows).toBe(before)
  })
}

test('with motion off the ticker stays off through a whole turn, even with the lab open on every tab', async ($, on) => {
  const { counts, clock } = engine(on, { motion: false })
  await start($)

  for (const tab of ['ui', 'text', 'fun']) {
    await run($, 'aylab', tab)
  }
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await call($, { tool: 'Bash', command: 'ls' })
  await clock.advance(120_000)
  const mid = counts.nows
  await clock.advance(120_000)
  expect(counts.nows).toBe(mid)
})

test('/motion off in the motion mod switches this mod off mid-session: a running ticker stops', async ($, on) => {
  const { counts, clock, flags } = engine(on)
  await start($)
  await run($, 'aylab', 'ui')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const n0 = counts.nows
  await clock.advance(600)
  expect(counts.nows - n0).toBe(4)
  flags.motion = false
  await clock.advance(300)
  const before = counts.nows
  await clock.advance(5000)
  expect(counts.nows).toBe(before)
})

// ------------------------------------------------------------- one shared ticker, stops when idle

test('one ticker runs while a turn works with the lab open, and stops itself when the turn ends', async ($, on) => {
  const { counts, clock } = engine(on)
  await start($)
  await run($, 'aylab', 'ui')
  const idle = counts.nows
  await clock.advance(10_000)
  expect(counts.nows).toBe(idle)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const before = counts.nows
  await clock.advance(1500)
  expect(counts.nows - before).toBe(10)
  await $.turn.complete(done)
  await clock.advance(300)
  const after = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(after)
})

test('a one-shot starts the ticker and it stops once the piece has played', async ($, on) => {
  const { counts, clock } = engine(on)
  await start($)
  const idle = counts.nows
  await clock.advance(5000)
  expect(counts.nows).toBe(idle)
  await press($, 'sqA')
  const n = counts.nows
  await clock.advance(450)
  expect(counts.nows - n).toBe(2)
  await clock.advance(1000)
  const after = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(after)
})

// ------------------------------------------------------------- 143..149 UI tab

test('143 the hint grows in 3 steps after (?) is pressed, then stays; pressing again hides it', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'aylab', 'ui')
  await lab($, async ui => expect((await secTexts(ui, '143'))[1]).toBe(' '))
  await press($, 'tip')
  const seen: string[] = []

  for (let i = 0; i < 4; i++) {
    await lab($, async ui => {
      seen.push((await secTexts(ui, '143'))[1]!)
    })
    await clock.advance(150)
  }
  const lens = seen.map(s => s.length)
  expect(lens[0]!).toBeLessThan(lens[1]!)
  expect(lens[1]!).toBeLessThan(lens[2]!)
  expect(seen[2]).toBe('▏ Hints grow in three steps, then stay.')
  expect(seen[3]).toBe(seen[2])
  await press($, 'tip')
  await lab($, async ui => expect((await secTexts(ui, '143'))[1]).toBe(' '))
})

test('144 the border steps between two theme colours while a turn runs, and rests when idle', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'aylab', 'ui')
  const border = async () => {
    let r = ''
    await lab($, async ui => {
      const b = nodes(await sect(ui, '144')).find(x => x.type === 'Box' && x.props?.borderStyle === 'round')
      r = `${b.props.borderColor}${b.props.borderDimColor ? ':dim' : ''}`
    })

    return r
  }
  expect(await border()).toBe('suggestion')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const seen = new Set<string>()

  for (let i = 0; i < 12; i++) {
    seen.add(await border())
    await clock.advance(150)
  }
  expect([...seen].sort()).toEqual(['subtle', 'subtle:dim', 'suggestion', 'suggestion:dim'])
  await $.turn.complete(done)
  await clock.advance(300)
  expect(await border()).toBe('suggestion')
  await clock.advance(600)
  expect(await border()).toBe('suggestion')
})

test('144 the glow follows the accent from the settings mod', async ($, on) => {
  engine(on, { accent: 'success' })
  await start($)
  await run($, 'aylab', 'ui')
  await lab($, async ui => {
    const b = nodes(await sect(ui, '144')).find(x => x.type === 'Box' && x.props?.borderStyle === 'round')
    expect(b.props.borderColor).toBe('success')
  })
})

test('145 pressing the button draws the underline left to right', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'aylab', 'ui')
  const line = async () => {
    let r: string[] = []
    await lab($, async ui => {
      r = (await secTexts(ui, '145')).slice(1)
    })

    return r
  }
  expect(await line()).toEqual(['', '─────────'])
  await press($, 'under')
  const widths: number[] = []

  for (let i = 0; i < 5; i++) {
    const [hot = '', rest = ''] = await line()
    expect(hot.length + rest.length).toBe(9)
    widths.push(hot.length)
    await clock.advance(150)
  }
  expect(widths[0]!).toBeGreaterThanOrEqual(1)
  expect(widths[1]!).toBeGreaterThan(widths[0]!)
  expect(widths[2]!).toBeGreaterThan(widths[1]!)
  expect(widths[3]!).toBeGreaterThan(widths[2]!)
  expect(widths[4]).toBe(9)
  expect(await line()).toEqual(['━━━━━━━━━', ''])
})

test('146 a press insets the button for 2 frames then it rests', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'aylab', 'ui')
  const pad = async () => {
    let r: number[] = []
    await lab($, async ui => {
      r = nodes(await sect(ui, '146')).filter(x => x.type === 'Box' && x.props?.width === 16).map(b => b.props.paddingLeft)
    })

    return r
  }
  expect(await pad()).toEqual([0, 0])
  await press($, 'sqB')
  expect(await pad()).toEqual([0, 2])
  await clock.advance(150)
  expect(await pad()).toEqual([0, 1])
  await clock.advance(150)
  expect(await pad()).toEqual([0, 0])
})

test('147 the staged toast is 3 frames on the status line and at most once per 3 minutes', async ($, on) => {
  const { statuses, clock } = engine(on)
  await start($)
  expect(await run($, 'aytoast', '')).toMatch(/Usage/)
  expect(await run($, 'aytoast', 'Saved ok')).toMatch(/Staged on the status line/)
  await clock.advance(1000)
  const frames = statuses.filter(s => s !== undefined)
  expect(frames[0]).toBe('▁ Sav')
  expect(frames).toContain('▄ Saved ')
  expect(frames).toContain('▸ Saved ok')
  expect(new Set(frames).size).toBe(3)
  await clock.advance(4000)
  expect(statuses[statuses.length - 1]).toBeUndefined()

  // A second one within three minutes plays in the lab only.
  const n = statuses.length
  expect(await run($, 'aytoast', 'Again')).toMatch(/Not on the status line/)
  await clock.advance(1000)
  expect(statuses.length).toBe(n)
  await run($, 'aylab', 'ui')
  await lab($, async ui => expect((await secTexts(ui, '147'))[1]).toBe('▸ Again'))

  await clock.advance(3 * 60_000)
  expect(await run($, 'aytoast', 'Third')).toMatch(/Staged on the status line/)
  await clock.advance(1000)
  expect(statuses.filter(s => s === '▸ Third').length).toBeGreaterThanOrEqual(1)
})

test('147 a turn that took over a minute stages a toast; a short turn and a calm session do not', async ($, on) => {
  const { statuses, clock, flags } = engine(on)
  await start($)
  await $.turn.start({ text: 'quick', turnId: 't1' })
  await clock.advance(10_000)
  await $.turn.complete(done)
  await clock.advance(1000)
  expect(statuses.filter(s => s !== undefined)).toEqual([])
  await $.turn.start({ text: 'long', turnId: 't2' })
  await clock.advance(75_000)
  flags.calm = true
  await $.turn.complete(done)
  await clock.advance(1000)
  expect(statuses.filter(s => s !== undefined)).toEqual([])
  flags.calm = false
  await $.turn.start({ text: 'long', turnId: 't3' })
  await clock.advance(75_000)
  await $.turn.complete(done)
  await clock.advance(1000)
  expect(statuses.filter(s => s !== undefined).pop()).toBe('▸ Turn finished in 1m 15s')
})

test('148 the band wave shows only with /aywave on, only while a turn runs, never when calm', async ($, on) => {
  const { counts, clock, flags } = engine(on)
  await start($)
  expect(await run($, 'aywave', '')).toMatch(/off \(default off\)/)
  expect(await run($, 'aywave', 'on')).toMatch(/on\./)
  await band($, async rows => expect(rows).toEqual([]))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const waves: string[] = []

  for (let i = 0; i < 4; i++) {
    await band(
      $,
      async rows => {
        expect(rows.length).toBe(2)
        expect(rows[0]).toMatch(/^[▁▂▃▄▅▆▇]{16}$/)
        expect(rows[1]).toBe(' working')
        waves.push(rows[0]!)
      },
      true,
    )
    await clock.advance(150)
  }
  expect(new Set(waves).size).toBeGreaterThanOrEqual(3)
  flags.calm = true
  await band($, async rows => expect(rows).toEqual([]), true)
  flags.calm = false
  await $.turn.complete(done)
  await clock.advance(300)
  await band($, async rows => expect(rows).toEqual([]))
  const after = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(after)
  expect(await run($, 'aywave', 'off')).toMatch(/off/)
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await band($, async rows => expect(rows).toEqual([]), true)
})

test('149 spinners: the variant is selectable, stored, and orbits while a turn runs', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  expect(await run($, 'ayspin', '')).toMatch(/dots, orbit, round, quad, arc, pulse/)
  expect(await run($, 'ayspin', 'zzz')).toMatch(/Unknown spinner/)
  expect(await run($, 'ayspin', 'orbit')).toMatch(/Spinner: orbit/)
  expect(((await stored($, 'anim-more.cfg')) as any).spin).toBe('orbit')
  await run($, 'aylab', 'ui')
  await lab($, async ui => {
    expect((await secTexts(ui, '149'))[0]).toBe('149  orbiting dots: orbit')
    expect((await secTexts(ui, '149'))[1]).toBe('⠁')
  })
  expect(await run($, 'ayspin', 'next')).toMatch(/Spinner: round/)
  await run($, 'ayspin', 'dots')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const glyphs: string[] = []

  for (let i = 0; i < 12; i++) {
    await lab($, async ui => {
      glyphs.push((await secTexts(ui, '149'))[1]!)
    })
    await clock.advance(150)
  }
  expect(isCycle(glyphs, ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'])).toBe(true)
  await $.turn.complete(done)
  await clock.advance(300)
  await lab($, async ui => expect((await secTexts(ui, '149'))[1]).toBe('⠋'))
})

// ------------------------------------------------------------- 150..154 and 158 Text tab

test('150 /aytype reveals the text a few characters at a time in the lab, with a cursor', async ($, on) => {
  const { opened, clock } = engine(on)
  await start($)
  expect(await run($, 'aytype', '')).toMatch(/Usage/)
  expect(await run($, 'aytype', 'Hello there friend')).toMatch(/Typing it in the lab/)
  expect(opened).toContain(LAB)
  const shown = async () => {
    let r = ''
    await lab($, async ui => {
      r = (await secTexts(ui, '150'))[1]!
    })

    return r
  }
  expect(await shown()).toBe('H▌')
  await clock.advance(150)
  expect(await shown()).toBe('Hell▌')
  await clock.advance(1000)
  expect(await shown()).toBe('Hello there friend')
})

test('151 /aymarquee slides a 46-cell window along a long path, then rests truncated', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  const path = '/Users/you/projects/a-long-project-name/packages/core/src/components/Sidebar/index.tsx'
  await run($, 'aymarquee', path)
  const shown = async () => {
    let r = ''
    await lab($, async ui => {
      r = (await secTexts(ui, '151'))[1]!
    })

    return r
  }
  expect(await shown()).toBe(path.slice(0, 46))
  await clock.advance(750)
  expect(await shown()).toBe(path.slice(5, 51))
  await clock.advance(20_000)
  const rest = await shown()
  expect(rest.length).toBe(46)
  expect(rest).toContain('…')
  expect((await run($, 'aymarquee', '')).length).toBeGreaterThan(0)
})

test('152 a tool error pulses the badge 3 times then settles; a successful call does nothing', async ($, on) => {
  const { tool, clock } = engine(on)
  await start($)
  await run($, 'aylab', 'text')
  await call($, { tool: 'Read', file_path: '/a.ts' })
  await lab($, async ui => expect(textOf((await secTextNodes(ui, '152'))[1])).toBe('● 0'))
  tool.fn = () => bad()
  await call($, { tool: 'Bash', command: 'x' })
  const beats: string[] = []

  for (let i = 0; i < 8; i++) {
    await lab($, async ui => {
      const b = (await secTextNodes(ui, '152'))[1]
      expect(textOf(b)).toBe('● 1')
      beats.push(`${b.props.color}${b.props.weight === 'bold' ? '!' : ''}`)
    })
    await clock.advance(150)
  }
  expect(beats.slice(0, 6)).toEqual(['error!', 'subtle', 'error!', 'subtle', 'error!', 'subtle'])
  expect(beats.filter(b => b === 'error!').length).toBe(3)
  expect(beats[6]).toBe('error')
  expect(beats[7]).toBe('error')
  await call($, { tool: 'Bash', command: 'y' })
  await lab($, async ui => expect(textOf((await secTextNodes(ui, '152'))[1])).toBe('● 2'))
})

test('152 the badge glyph follows the icon style from the settings mod', async ($, on) => {
  const { tool } = engine(on, { icons: 'letters' })
  tool.fn = () => bad()
  await start($)
  await run($, 'aylab', 'text')
  await call($, { tool: 'Bash', command: 'x' })
  await lab($, async ui => expect(textOf((await secTextNodes(ui, '152'))[1])).toBe('E 1'))
})

test('153 a drop falls through 3 rows and the spend figure ticks up when the cost rises', async ($, on) => {
  const { usage, clock } = engine(on)
  await start($)
  await run($, 'aylab', 'text')
  usage.usd = 0.75
  await call($, { tool: 'Read', file_path: '/a.ts' })
  const rows = async () => {
    let r: string[] = []
    await lab($, async ui => {
      r = (await secTexts(ui, '153')).slice(1, 5)
    })

    return r
  }
  const seen: string[][] = []

  for (let i = 0; i < 7; i++) {
    seen.push(await rows())
    await clock.advance(150)
  }
  expect(seen[0]).toEqual(['  ▾', ' ', ' ', '$0.50'])
  expect(seen[1]).toEqual([' ', '  ▾', ' ', '$0.50'])
  expect(seen[2]).toEqual([' ', ' ', '  ▾', '$0.50'])
  expect(seen[3]![3]).toBe('$0.58')
  expect(seen[4]![3]).toBe('$0.67')
  expect(seen[5]![3]).toBe('$0.75')
  expect(seen[6]).toEqual([' ', ' ', ' ', '$0.75'])
  // A call that does not raise the cost drops nothing.
  await call($, { tool: 'Read', file_path: '/b.ts' })
  expect(await rows()).toEqual([' ', ' ', ' ', '$0.75'])
})

test('154 the plant counts the days a tool call ran, grows through its stages, and is stored', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  expect(await run($, 'aygrow')).toMatch(/Day 0 .*stage 0\/6, 1 more day to the next/)
  await call($, { tool: 'Read', file_path: '/a.ts' })
  await call($, { tool: 'Read', file_path: '/b.ts' })
  expect(await run($, 'aygrow')).toMatch(/Day 1 .*stage 1\/6/)
  expect(await stored($, 'anim-more.grow')).toEqual({ days: 1, last: '2026-11-25', prev: 0 })

  for (let d = 1; d <= 6; d++) {
    await clock.advance(DAY)
    await call($, { tool: 'Read', file_path: '/c.ts' })
  }
  const text = await run($, 'aygrow')
  expect(text).toMatch(/Day 7 .*stage 4\/6, 7 more days to the next/)
  expect(text).toMatch(/not a streak/)
  expect(((await stored($, 'anim-more.grow')) as any).days).toBe(7)

  for (let d = 1; d <= 14; d++) {
    await clock.advance(DAY)
    await call($, { tool: 'Read', file_path: '/c.ts' })
  }
  expect(await run($, 'aygrow')).toMatch(/Day 21 .*stage 6\/6, in full bloom/)
})

test('154 reaching a new stage plays prev, a spark, then the new plant in the lab; a preview walks all stages', async ($, on) => {
  const { clock } = engine(on, { stored: { 'anim-more.grow': { days: 1, last: '2026-11-24' } } })
  await start($)
  await run($, 'aylab', 'text')
  const art = async () => {
    let r = ''
    await lab($, async ui => {
      r = (await secTexts(ui, '154')).slice(1, 6).join('|')
    })

    return r
  }
  const stage1 = '       |       |       |   ,   |~~~|~~~'
  expect(await art()).toBe(stage1)
  await call($, { tool: 'Read', file_path: '/a.ts' })
  expect(await art()).toBe(stage1)
  await clock.advance(150)
  expect(await art()).toBe('   *   |       |       |   ,   |~~~|~~~')
  await clock.advance(150)
  expect(await art()).toBe('       |       |  \\ /  |   |   |~~~|~~~')
  await clock.advance(1000)
  await press($, 'plant')
  const stages: string[] = []

  for (let i = 0; i < 8; i++) {
    await lab($, async ui => {
      stages.push((await secTexts(ui, '154'))[6]!)
    })
    await clock.advance(400)
  }
  expect(stages[0]).toMatch(/stage 0\/6 \(preview\)/)
  expect(stages[3]).toMatch(/stage 3\/6 \(preview\)/)
  expect(stages[6]).toMatch(/stage 6\/6 \(preview\)/)
  await clock.advance(1000)
  await lab($, async ui => expect((await secTexts(ui, '154'))[6]).toMatch(/day 2 · stage 2\/6/))
})

test('158 /ayjot keeps one page per day, flips between days in 3 frames, and is stored and bounded', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  expect(await run($, 'ayjot', '')).toMatch(/empty/)
  expect(await run($, 'ayjot', 'Wrote the docs')).toMatch(/\(1\/30 days kept\)/)
  await run($, 'ayjot', 'and tests')
  expect(await run($, 'ayjot', '')).toBe('2026-11-25  Wrote the docs · and tests')
  await clock.advance(DAY)
  await run($, 'ayjot', 'Shipped it')
  expect(await stored($, 'anim-more.journal')).toEqual([
    { d: '2026-11-25', t: 'Wrote the docs · and tests' },
    { d: '2026-11-26', t: 'Shipped it' },
  ])
  await run($, 'aylab', 'text')
  const page = async () => {
    let r: string[] = []
    await lab($, async ui => {
      r = (await secTexts(ui, '158')).slice(1)
    })

    return r
  }
  await clock.advance(2000)
  expect((await page())[0]).toBe('2026-11-26  Shipped it')
  expect((await page())[1]).toBe('page 2/2')
  // Flip back: the old page, a fold, then the new page.
  await press($, 'prev')
  expect((await page())[0]).toBe('2026-11-26  Shipped it')
  await clock.advance(150)
  expect(((await page())[0] ?? '').trim()).toMatch(/^▒+$/)
  await clock.advance(150)
  expect((await page())[0]).toBe('2026-11-25  Wrote the docs · and tests')
  expect((await page())[1]).toBe('page 1/2')
  await press($, 'prev')
  await clock.advance(1000)
  expect((await page())[1]).toBe('page 2/2')

  // Bounded to 30 days, and a long text is cut.
  for (let i = 0; i < 34; i++) {
    await clock.advance(DAY)
    await run($, 'ayjot', 'x'.repeat(400))
  }
  const list = (await stored($, 'anim-more.journal')) as { d: string; t: string }[]
  expect(list.length).toBe(30)
  expect(list.every(x => x.t.length <= 160)).toBe(true)
})

test('158 with no entries the lab flips between two labelled sample pages', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'aylab', 'text')
  await press($, 'next')
  await clock.advance(1000)
  await lab($, async ui => {
    const t = await secTexts(ui, '158')
    expect(t[0]).toMatch(/sample pages/)
    expect(t[1]).toMatch(/^sample day 2/)
    expect(t[2]).toBe('page 2/2')
  })
})

// ------------------------------------------------------------- 155..157, 159..162 Fun tab and the band

test('155 rain falls in the band for 1.2 s after a successful build, only after /ayrain on', async ($, on) => {
  const { tool, clock } = engine(on)
  await start($)
  expect(await run($, 'ayrain', '')).toMatch(/off \(default off\)/)
  tool.fn = () => ok('compiled')
  await call($, { tool: 'Bash', command: 'npm run build' })
  await band($, async rows => expect(rows).toEqual([]))
  expect(await run($, 'ayrain', 'on')).toMatch(/on/)

  // Not a build, a failed build, and output that shows failures: no rain.
  await call($, { tool: 'Bash', command: 'ls -la' })
  tool.fn = () => bad('x')
  await call($, { tool: 'Bash', command: 'npm run build' })
  tool.fn = () => ok('Tests: 2 failed, 8 passed')
  await call($, { tool: 'Bash', command: 'npm test' })
  await band($, async rows => expect(rows).toEqual([]))

  tool.fn = () => ok('compiled')
  await call($, { tool: 'Bash', command: 'cargo build' })
  const frames: string[] = []

  for (let i = 0; i < 9; i++) {
    await band($, async rows => {
      frames.push(rows.join('|'))
      expect(rows.length === 0 || (rows.length === 3 && rows.every(r => r.length === 24))).toBe(true)
    })
    await clock.advance(150)
  }
  expect(frames.slice(0, 8).every(f => f !== '')).toBe(true)
  expect(frames.slice(0, 8).some(f => /[·˙:`*]/.test(f))).toBe(true)
  expect(new Set(frames).size).toBeGreaterThanOrEqual(4)
  expect(frames[8]).toBe('')
})

test('156 fireworks burst in the band for 2 s after a git tag succeeds; a tag listing does not', async ($, on) => {
  const { tool, clock, counts } = engine(on)
  await start($)
  await run($, 'ayrain', 'on')
  tool.fn = () => ok('')
  await call($, { tool: 'Bash', command: 'git tag' })
  await call($, { tool: 'Bash', command: 'git tag -l' })
  await band($, async rows => expect(rows).toEqual([]))
  await call($, { tool: 'Bash', command: 'git tag -a v1.2.0 -m "release"' })
  const frames: string[] = []

  for (let i = 0; i < 15; i++) {
    await band($, async rows => {
      frames.push(rows.join('\n'))
      expect(rows.length === 0 || (rows.length === 5 && rows.every(r => r.length === 40))).toBe(true)
    })
    await clock.advance(150)
  }
  expect(frames[0]).toContain('|')
  expect(frames.some(f => f.includes('*'))).toBe(true)
  expect(frames[14]).toBe('')
  const after = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(after)
})

test('155 rain and fireworks are silent when calm even if switched on', async ($, on) => {
  const { tool, clock, counts } = engine(on, { calm: true })
  tool.fn = () => ok('')
  await start($)
  await run($, 'ayrain', 'on')
  await call($, { tool: 'Bash', command: 'npm run build' })
  await call($, { tool: 'Bash', command: 'git tag v2' })
  await clock.advance(300)
  await band($, async rows => expect(rows).toEqual([]))
  const n = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(n)
})

test('157 /aysprint runs its own timer, balloons rise in the lab at the end, and a toast says so', async ($, on) => {
  const { toasts, clock, opened, counts } = engine(on)
  await start($)
  expect(await run($, 'aysprint', 'abc')).toMatch(/Usage/)
  expect(await run($, 'aysprint', '9999')).toMatch(/Usage/)
  expect(await run($, 'aysprint', '0.01')).toMatch(/Usage/)
  expect(await run($, 'aysprint', '1')).toMatch(/Sprint started: 1 min/)
  expect(opened).toContain(LAB)
  await clock.advance(30_000)
  expect(toasts).toEqual([])
  await clock.advance(30_000)
  expect(toasts).toEqual(['Sprint done: 1 min'])
  const balloons = async () => {
    let r: string[] = []
    await lab($, async ui => {
      r = (await secTexts(ui, '157')).slice(1, 6)
    })

    return r
  }
  const first = await balloons()
  expect(first.findIndex(r => r.includes('●'))).toBeGreaterThanOrEqual(2)
  await clock.advance(900)
  const mid = await balloons()
  expect(mid.findIndex(r => r.includes('●'))).toBeLessThan(first.findIndex(r => r.includes('●')))
  await clock.advance(2000)
  const end = await balloons()
  expect(end[0]!.includes('●')).toBe(true)
  expect(end[1]!.includes('│')).toBe(true)
  // Off the Fun tab nothing is left animating.
  await run($, 'aylab', 'ui')
  await clock.advance(1000)
  const after = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(after)
  expect(toasts.length).toBe(1)
})

test('157 /aysprint off cancels the timer: no toast, no balloons', async ($, on) => {
  const { toasts, clock } = engine(on)
  await start($)
  await run($, 'aysprint', '1')
  expect(await run($, 'aysprint', 'off')).toMatch(/cleared/)
  await clock.advance(120_000)
  expect(toasts).toEqual([])
  await run($, 'aylab', 'fun')
  await lab($, async ui => expect((await secTexts(ui, '157'))[1]).toMatch(/aysprint/))
})

test('159 the dial spins in the lab while a sprint runs and rests when it ends', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'aysprint', '1')
  const dial = async () => {
    let r: string[] = []
    await lab($, async ui => {
      r = (await secTexts(ui, '159')).slice(1)
    })

    return r
  }
  const seen: string[] = []

  for (let i = 0; i < 9; i++) {
    seen.push((await dial())[0]!)
    await clock.advance(150)
  }
  expect(isCycle(seen, ['◴', '◷', '◶', '◵'])).toBe(true)
  expect((await dial())[1]).toBe('ends at 12:31')
  await clock.advance(70_000)
  const rest = await dial()
  expect(rest).toEqual(['◴', 'no sprint running'])
  await clock.advance(600)
  expect(await dial()).toEqual(rest)
})

test('160 the pendulum swings in the lab only after 60 s idle, and stops when you act', async ($, on) => {
  const { clock, tool } = engine(on)
  tool.fn = () => ok()
  await start($)
  await run($, 'aylab', 'fun')
  const bob = async () => {
    let r = ''
    await lab($, async ui => {
      const rows = (await secTexts(ui, '160')).slice(1)
      r = `${rows.findIndex(x => x.includes('●'))}:${rows.find(x => x.includes('●'))!.indexOf('●')}`
    })

    return r
  }
  expect(await bob()).toBe('2:4')
  await clock.advance(50_000)
  expect(await bob()).toBe('2:4')
  await clock.advance(11_000)
  const seen = new Set<string>()

  for (let i = 0; i < 24; i++) {
    seen.add(await bob())
    await clock.advance(150)
  }
  expect(seen.size).toBeGreaterThanOrEqual(6)
  expect([...seen].some(s => s.startsWith('1:'))).toBe(true)
  expect([...seen].some(s => s.startsWith('2:'))).toBe(true)
  // Activity resets the idle clock: it hangs still again.
  await call($, { tool: 'Read', file_path: '/a.ts' })
  await clock.advance(300)
  expect(await bob()).toBe('2:4')
  await clock.advance(1500)
  expect(await bob()).toBe('2:4')
})

test('161 the pet walks the 20-cell strip while a turn runs and sits when it ends', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'aylab', 'fun')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const strip = async () => {
    let r = ''
    await lab($, async ui => {
      r = (await secTexts(ui, '161'))[1]!
    })

    return r
  }
  const at = (s: string) => s.search(/[=~]\^/)
  const seen: string[] = []

  for (let i = 0; i < 20; i++) {
    const s = await strip()
    expect(s.length).toBe(20)
    seen.push(s)
    await clock.advance(150)
  }
  expect(new Set(seen.map(at)).size).toBeGreaterThanOrEqual(10)
  seen.slice(1).forEach((s, i) => expect(Math.abs(at(s) - at(seen[i]!))).toBe(1))
  await $.turn.complete(done)
  await clock.advance(300)
  expect(await strip()).toBe('·······=^.^=········')
})

test('161 the walk button strolls for 6 s then stops', async ($, on) => {
  const { clock, counts } = engine(on)
  await start($)
  await run($, 'aylab', 'fun')
  await press($, 'pet')
  const n = counts.nows
  await clock.advance(3000)
  expect(counts.nows - n).toBe(20)
  await clock.advance(5000)
  const after = counts.nows
  await clock.advance(10_000)
  expect(counts.nows).toBe(after)
})

test('162 /aytodo and /ayrocket: the rocket follows the todo completion, or a percent you give', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  expect(await run($, 'aytodo', '')).toMatch(/No todos/)
  expect(await run($, 'aytodo', 'add write tests')).toMatch(/1\. \[ \] write tests/)
  expect(await run($, 'aytodo', 'add ship it')).toMatch(/2\. \[ \] ship it\n0% done/)
  expect(await run($, 'aytodo', 'add')).toMatch(/Usage/)
  expect(await run($, 'aytodo', 'frob')).toMatch(/Usage/)
  expect(await run($, 'aytodo', 'done 9')).toMatch(/Usage: \/aytodo done <number 1-2>/)
  expect(await run($, 'ayrocket', 'todo')).toMatch(/follows \/aytodo: 0%/)
  const done1 = await run($, 'aytodo', 'done 1')
  expect(done1).toMatch(/1\. \[x\] write tests/)
  expect(done1).toMatch(/50% done$/)
  await clock.advance(1000)
  const rocket = async () => {
    let r: string[] = []
    await lab($, async ui => {
      r = (await secTexts(ui, '162')).slice(1)
    })

    return r
  }
  let r = await rocket()
  expect(r[0]!.indexOf('▶')).toBe(Math.round(0.5 * 23))
  expect(r[1]).toBe('50%')
  expect(r[2]).toBe('following todos: 1/2 done')
  expect(await stored($, 'anim-more.rocket')).toEqual({ pct: 50, mode: 'todo' })
  expect(await stored($, 'anim-more.todos')).toEqual([
    { t: 'write tests', done: true },
    { t: 'ship it', done: false },
  ])
  await run($, 'aytodo', 'done 2')
  await clock.advance(1000)
  r = await rocket()
  expect(r[0]!.endsWith('★')).toBe(true)
  expect(r[1]).toBe('100%')
  await run($, 'aytodo', 'undo 2')
  await run($, 'aytodo', 'rm 1')
  expect((await run($, 'aytodo', '')).trim()).toBe('1. [ ] ship it')

  // A percent you give wins and the todos stop driving it.
  expect(await run($, 'ayrocket', '150')).toMatch(/Usage/)
  expect(await run($, 'ayrocket', 'abc')).toMatch(/Usage/)
  expect(await run($, 'ayrocket', '40')).toMatch(/Rocket at 40%/)
  await clock.advance(1000)
  await run($, 'aytodo', 'done 1')
  await clock.advance(1000)
  r = await rocket()
  expect(r[1]).toBe('40%')
  expect(r[2]).toMatch(/manual/)
  expect(await run($, 'ayrocket', '')).toMatch(/Rocket: 40% \(manual\)/)
  await run($, 'aytodo', 'clear')
  expect(await run($, 'aytodo', '')).toMatch(/No todos/)
})

test('162 a new percent glides the rocket in 3 steps with a flame, then it settles; todos are bounded', async ($, on) => {
  const { clock, counts } = engine(on)
  await start($)
  await run($, 'ayrocket', '40')
  await clock.advance(1000)
  await run($, 'ayrocket', '80')
  const track = async () => {
    let r = ''
    await lab($, async ui => {
      r = (await secTexts(ui, '162'))[1]!
    })

    return r
  }
  const heads: number[] = []
  const first = await track()
  expect(first.includes('≈')).toBe(true)
  heads.push(first.indexOf('▶'))

  for (let i = 0; i < 3; i++) {
    await clock.advance(150)
    heads.push((await track()).indexOf('▶'))
  }
  expect(heads[0]!).toBeLessThan(heads[1]!)
  expect(heads[1]!).toBeLessThan(heads[2]!)
  expect(heads[3]).toBe(Math.round(0.8 * 23))
  expect((await track()).includes('≈')).toBe(false)
  const after = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(after)

  for (let i = 0; i < 40; i++) {
    await run($, 'aytodo', `add item ${i}`)
  }
  expect(((await stored($, 'anim-more.todos')) as unknown[]).length).toBe(30)
  expect(await run($, 'aytodo', 'add one more')).toMatch(/At most 30/)
})

// ------------------------------------------------------------- demo, reset, load

test('/aydemo plays each tab in turn over about 7 s, then everything stops', async ($, on) => {
  const { clock, counts, opened, statuses } = engine(on)
  await start($)
  expect(await run($, 'aydemo')).toMatch(/Playing each piece once/)
  expect(opened).toContain(LAB)
  await lab($, async ui => expect((await secTexts(ui, '143'))[1]).toMatch(/^▏ Hint/))
  await clock.advance(450)
  await lab($, async ui => expect((await secTexts(ui, '143'))[1]).toBe('▏ Hints grow in three steps, then stay.'))
  await clock.advance(2200)
  await lab($, async ui => expect((await secTexts(ui, '150'))[0]).toMatch(/typewriter/))
  await clock.advance(2500)
  await lab($, async ui => {
    expect((await secTexts(ui, '155'))[0]).toMatch(/rain/)
    const rocket = await secTexts(ui, '162')
    expect(Number(rocket[2]!.replace('%', ''))).toBeGreaterThan(50)
  })
  expect(statuses.filter(s => s !== undefined)[0]).toMatch(/^▁/)
  await clock.advance(8000)
  const after = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(after)
})

test('/ayreset clears the stored data, switches, plant, journal, todos, rocket and the sprint', async ($, on) => {
  const { clock, toasts, tool } = engine(on)
  tool.fn = () => bad()
  await start($)
  await run($, 'aywave', 'on')
  await run($, 'ayrain', 'on')
  await run($, 'ayspin', 'quad')
  await run($, 'ayjot', 'a day')
  await run($, 'aytodo', 'add one')
  await run($, 'ayrocket', '30')
  await call($, { tool: 'Bash', command: 'x' })
  await run($, 'aysprint', '1')
  expect(Object.keys(db).filter(k => k.startsWith('anim-more.')).length).toBe(5)
  expect(await run($, 'ayreset')).toMatch(/cleared/)
  expect(Object.keys(db).filter(k => k.startsWith('anim-more.'))).toEqual([])
  expect(await run($, 'ay')).toMatch(/wave off, rain\+fireworks off, spinner dots/)
  expect(await run($, 'aygrow')).toMatch(/Day 0/)
  expect(await run($, 'ayjot')).toMatch(/empty/)
  expect(await run($, 'aytodo')).toMatch(/No todos/)
  expect(await run($, 'ayrocket')).toMatch(/Rocket: 0%/)
  await clock.advance(120_000)
  expect(toasts).toEqual([])
  await run($, 'aylab', 'text')
  await lab($, async ui => expect(textOf((await secTextNodes(ui, '152'))[1])).toBe('● 0'))
})

test('what was stored comes back at session start', async ($, on) => {
  engine(on, {
    stored: {
      'anim-more.cfg': { wave: true, rain: true, spin: 'quad' },
      'anim-more.grow': { days: 7, last: '2026-11-25' },
      'anim-more.todos': [
        { t: 'a', done: true },
        { t: 'b', done: false },
      ],
      'anim-more.journal': [{ d: '2026-11-24', t: 'old' }],
      'anim-more.rocket': { pct: 0, mode: 'todo' },
    },
  })
  await start($)
  expect(await run($, 'ay')).toMatch(/wave on, rain\+fireworks on, spinner quad/)
  expect(await run($, 'aygrow')).toMatch(/Day 7 .*stage 4\/6/)
  expect(await run($, 'ayjot')).toBe('2026-11-24  old')
  expect(await run($, 'ayrocket')).toMatch(/Rocket: 50% \(todo\)/)
  // Today is already counted: a tool call adds no day.
  await call($, { tool: 'Read', file_path: '/a.ts' })
  expect(await run($, 'aygrow')).toMatch(/Day 7 /)
})

test('junk in the store falls back to the defaults', async ($, on) => {
  engine(on, {
    stored: {
      'anim-more.cfg': 5,
      'anim-more.grow': 'junk',
      'anim-more.todos': [1, { t: 5 }, { t: 'ok', done: 'no' }],
      'anim-more.journal': [null, { d: 1 }, 'x'],
      'anim-more.rocket': { pct: 'a', mode: 'x' },
    },
  })
  await start($)
  expect(await run($, 'ay')).toMatch(/wave off, rain\+fireworks off, spinner dots/)
  expect(await run($, 'aygrow')).toMatch(/Day 0 /)
  expect(await run($, 'aytodo')).toMatch(/No todos/)
  expect(await run($, 'ayjot')).toMatch(/empty/)
  expect(await run($, 'ayrocket')).toMatch(/Rocket: 0% \(manual\)/)
})

test('/aylab with an unknown tab asks for ui, text or fun; an unplaceable pane says so', async ($, on) => {
  engine(on, { isPlaced: false })
  await start($)
  expect(await run($, 'aylab', 'zzz')).toMatch(/Usage: \/aylab \[ui\|text\|fun\]/)
  expect(await run($, 'aylab', 'ui')).toMatch(/could not be placed/)
  expect(await run($, 'aydemo')).toMatch(/could not be placed/)
})

test('the lab widget placement is one small line', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' } } as any)
  const t = ((await ui.findAll({ type: 'Text' })) as any[]).map(textOf)
  expect(t.length).toBe(1)
  expect(t[0]).toMatch(/idle .*plant 0\/6/)
  await ui.unmount()
})
