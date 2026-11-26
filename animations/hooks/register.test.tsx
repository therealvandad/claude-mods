import { expect, mock, test } from 'claude-code/testing'

const LAB = 'animations-lab'
// A fixed local time: 12:30 (sun), so the sky strip has a known marker.
const NOON = new Date(2026, 10, 25, 12, 30).getTime()

const BAND = (isWorking = false, extra: Record<string, unknown> = {}) =>
  ({
    plugin: 'animations',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking,
      maxRows: 12,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
      ...extra,
    },
  }) as const

const PANE = (surface: 'terminal' | 'desktop' = 'desktop') =>
  ({
    plugin: 'animations',
    surface,
    component: 'Pane',
    requestId: LAB,
    props: {
      title: 'Animations lab',
      isFocused: false,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const

const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

// A state write carries `{ shape, value }` (or `{ value, version }`) or the plain value.
const unwrap = (v: any) => (v !== null && typeof v === 'object' && 'value' in v && ('version' in v || 'shape' in v) ? v.value : v)

type Handler = (e: Record<string, unknown>) => unknown

// Stands in for the engine. `motion` is the global flag the motion mod owns.
const engine = (on: any, init: { motion?: boolean; isPlaced?: boolean } = {}) => {
  const usage = { percent: 10, usd: 0.5 }
  const motion = { isOn: init.motion ?? true }
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const counts = { nows: 0 }
  const last: Record<string, any> = {}
  const tool: { fn: Handler } = { fn: () => ({ result: {} }) }
  const clock = mock.clock(on, { now: NOON })
  mock.store(on)
  on('state.get', (_: unknown, e: any, next: any) =>
    e.plugin === 'motion' && e.key === 'isOn' ? { value: { value: motion.isOn, version: 1 } } : next(e),
  )
  // Every tick writes the `now` atom, so counting those writes counts ticks and events.
  on('state.set', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'animations') {
      last[e.key] = e.value

      if (e.key === 'now') {
        counts.nows += 1
      }
    }

    return next(e)
  })
  on('command.register', () => ({ value: { command: 'anim' } }))
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

  return { usage, motion, statuses, toasts, opened, counts, tool, clock, last }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const call = ($: any, input: Record<string, unknown>) => $.tool.call(input as any)
const run = ($: any, args: string) => $.command.run({ command: 'anim', args, origin: 'user' } as any)
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text)
const joined = async (ui: any) => (await texts(ui)).join('')
const withBand = async ($: any, fn: (ui: any) => Promise<void>, isWorking = false) => {
  const ui = await $.ui.mount(BAND(isWorking))
  await fn(ui)
  await ui.unmount()
}

const ok = (stdout = '') => ({ result: { stdout, stderr: '', interrupted: false } })

// ------------------------------------------------------------- the command

test('/anim lists all fourteen pieces and its subcommands', async ($, on) => {
  engine(on)
  await start($)
  const text = (await run($, '')).text as string

  for (let n = 1; n <= 14; n++) {
    expect(text).toMatch(new RegExp(`(^|\\n)\\s+${n} `))
  }
  expect(text).toMatch(/\/anim demo \| lab \| timer <minutes> \| badge <text> \| skeleton/)
  expect(text).toMatch(/motion on/)
  expect((await run($, 'timer abc')).text).toMatch(/Usage/)
  expect((await run($, 'timer 9999')).text).toMatch(/Usage/)
})

// ------------------------------------------------------------- motion off: nothing runs, static values

test('with the motion atom false no ticker starts and every piece shows its static final value', async ($, on) => {
  const { counts, clock, statuses, tool, usage, motion } = engine(on, { motion: false })
  tool.fn = e => (e.command === 'bad' ? { result: {}, isError: true } : ok('[main abc1234] msg'))
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await call($, { tool: 'Bash', command: 'git commit -m msg' })
  await call($, { tool: 'Bash', command: 'bad' })
  await call($, { tool: 'Edit', file_path: '/p/src/a.ts' })
  usage.usd = 0.9
  await call($, { tool: 'Read', file_path: '/p/b.ts' })
  expect((await run($, 'demo')).text).toMatch(/Motion is off/)
  expect((await run($, 'lab')).text).toMatch(/static final value/)
  expect((await run($, 'timer 5')).text).toMatch(/started/)
  expect((await run($, 'badge HELLO')).text).toMatch(/Badge: HELLO/)
  expect((await run($, 'skeleton')).text).toMatch(/skeleton/)
  await clock.settle()

  // No ticker: advancing a long time writes the clock atom no more.
  const before = counts.nows
  await clock.advance(60_000)
  expect(counts.nows).toBe(before)

  // The band: a steady dot while busy, a calm static tank, no coin, no confetti.
  await withBand($, async ui => {
    const t = await texts(ui)
    expect(t).toContain('●')
    expect(t.some(x => /^ +\$$/.test(x))).toBe(false)
    expect(t.join('')).not.toMatch(/[*◆▪]/)
    expect(t.some(x => /^\$0\.90$/.test(x))).toBe(true)
  })

  // The shake is a plain, still status line, and it clears itself without a ticker.
  expect(statuses.filter(s => s !== undefined && s.includes('✗ Bash failed')).every(s => s === '   ✗ Bash failed')).toBe(true)
  expect(statuses.some(s => s === '✓ committed')).toBe(true)
  expect(statuses[statuses.length - 1]).toBeUndefined()

  // The lab: sparkline whole at once, the file row settled, the flip clock plain digits, the badge swept.
  let ui = await $.ui.mount(PANE())
  expect(await joined(ui)).toMatch(/Motion is off: every piece shows its static final value/)
  expect(await ui.find({ type: 'Text', text: /^▁/ })).toBeDefined()
  await ui.unmount()
  await $.ui.mount(PANE()).then(async u => {
    await u.press({ key: 'tab-1' })
    await u.unmount()
  })
  ui = await $.ui.mount(PANE())
  // The underline sits under the selected tab at once, never mid-glide.
  expect(await ui.find({ type: 'Text', text: /^ {12}━{12}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /src\/a\.ts/ })).toBeDefined()
  await ui.unmount()
  void motion
})

test('with motion off the ticker stays off through a whole turn, even with the lab open', async ($, on) => {
  const { counts, clock } = engine(on, { motion: false })
  await start($)
  await run($, 'lab')
  const before = counts.nows
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await call($, { tool: 'Bash', command: 'ls' })
  await clock.advance(30_000)
  // Only event writes (turn.start does none, the tool call touches the clock a couple of times).
  expect(counts.nows - before <= 3).toBe(true)
  const mid = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(mid)
})

// ------------------------------------------------------------- 1 heartbeat, shared ticker

test('1 the heartbeat pulses while a turn runs, flatlines when idle, and the one ticker stops itself', async ($, on) => {
  const { counts, clock } = engine(on)
  await start($)
  await withBand($, async ui => {
    expect(await texts(ui)).toContain('─')
  })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  const seen = new Set<string>()

  for (let i = 0; i < 8; i++) {
    await clock.advance(250)
    await withBand($, async ui => {
      const t = await texts(ui)
      ;['●', '•', '◉', '·'].forEach(g => t.includes(g) && seen.add(g))
      expect(t).not.toContain('─')
    })
  }
  expect(seen.size >= 3).toBe(true)

  await $.turn.complete(done)
  await clock.advance(1000)
  const before = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(before)
  await withBand($, async ui => {
    expect(await texts(ui)).toContain('─')
  })
})

test('the heart does not pulse for a subagent turn', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await $.turn.start({ text: 'sub', turnId: 's1', agentId: 'a1' } as any)
  await clock.advance(300)
  await withBand($, async ui => {
    expect(await texts(ui)).toContain('─')
  })
})

// ------------------------------------------------------------- 2 tank, 3 coin

test('2 the band shows a context tank cell and the percent', async ($, on) => {
  const { usage } = engine(on)
  usage.percent = 80
  await start($)
  await withBand($, async ui => {
    expect(await texts(ui)).toContain('▆')
    expect(await joined(ui)).toMatch(/80%/)
  })
})

test('3 a $ falls over the spend figure when cost rises, then is gone', async ($, on) => {
  const { usage, clock } = engine(on)
  await start($)
  await withBand($, async ui => {
    expect((await texts(ui)).some(x => /^ +\$$/.test(x))).toBe(false)
  })
  usage.usd = 0.75
  await call($, { tool: 'Read', file_path: '/a.ts' })

  const rows: number[] = []

  for (let i = 0; i < 5; i++) {
    await withBand($, async ui => {
      const t = await texts(ui)
      const idx = t.findIndex(x => /^ +\$$/.test(x))
      rows.push(idx)
    })
    await clock.advance(100)
  }
  // It was drawn on the first row, then the second: it fell.
  expect(rows[0]).toBeGreaterThanOrEqual(0)
  expect(rows.filter(r => r >= 0).length >= 2).toBe(true)
  expect(new Set(rows.filter(r => r >= 0)).size >= 2).toBe(true)

  await clock.advance(1000)
  await withBand($, async ui => {
    expect((await texts(ui)).some(x => /^ +\$$/.test(x))).toBe(false)
    expect(await joined(ui)).toMatch(/\$0\.75/)
  })

  // Cost that does not rise drops no coin.
  await call($, { tool: 'Read', file_path: '/b.ts' })
  await withBand($, async ui => {
    expect((await texts(ui)).some(x => /^ +\$$/.test(x))).toBe(false)
  })
})

// ------------------------------------------------------------- 6 shake

test('6 a tool error shakes the status text for about 400 ms, then it rests and clears', async ($, on) => {
  const { statuses, clock, tool } = engine(on)
  tool.fn = () => ({ result: {}, isError: true })
  await start($)
  await call($, { tool: 'Bash', command: 'nope' })
  await clock.advance(100)
  await clock.advance(100)
  await clock.advance(100)
  await clock.advance(100)
  await clock.advance(100)
  const lines = statuses.filter(s => s !== undefined && s.includes('✗ Bash failed')) as string[]
  const indents = new Set(lines.map(s => s.length - s.trimStart().length))
  expect(indents.size >= 3).toBe(true)
  expect(lines[lines.length - 1]).toBe('   ✗ Bash failed')
  await clock.advance(4000)
  expect(statuses[statuses.length - 1]).toBeUndefined()
})

// ------------------------------------------------------------- 7 confetti

test('7 a successful git commit bursts confetti for 1.5 s; a failed or empty commit does not', async ($, on) => {
  const { clock, tool, statuses } = engine(on)
  await start($)
  const confetti = async () => {
    let found = false
    await withBand($, async ui => {
      found = /[*+◆▪]/.test((await texts(ui)).join(''))
    })

    return found
  }
  tool.fn = () => ok('On branch main\nnothing to commit, working tree clean')
  await call($, { tool: 'Bash', command: 'git commit -m x' })
  await clock.advance(300)
  expect(await confetti()).toBe(false)

  tool.fn = () => ({ result: { stdout: 'error: pathspec', stderr: '', interrupted: false }, isError: true })
  await call($, { tool: 'Bash', command: 'git commit -m x' })
  await clock.advance(300)
  expect(statuses.some(s => s === '✓ committed')).toBe(false)

  tool.fn = () => ok('[main 1a2b3c4] msg\n 1 file changed, 2 insertions(+)')
  await call($, { tool: 'Bash', command: 'git add -A && git commit -m msg' })
  expect(statuses).toContain('✓ committed')
  let hits = 0

  for (let i = 0; i < 10; i++) {
    await clock.advance(100)

    if (await confetti()) {
      hits += 1
    }
  }
  expect(hits >= 3).toBe(true)
  await clock.advance(1000)
  expect(await confetti()).toBe(false)
})

// ------------------------------------------------------------- 12 conveyor, 14 ambient

test('12 tool calls ride the belt: running at the intake, finished ones slide right and settle', async ($, on) => {
  const { clock, tool, last } = engine(on)
  await start($)
  tool.fn = async e => {
    await clock.sleep(e.command === 'slow' ? 2000 : 10)

    return ok()
  }
  const running = call($, { tool: 'Bash', command: 'slow' })
  await clock.advance(300)
  await withBand($, async ui => {
    expect(await texts(ui)).toContain('▶')
  })
  await clock.advance(2000)
  await running
  await clock.advance(10)
  const belt = async () => {
    let j = ''
    await withBand($, async ui => {
      j = await joined(ui)
    })

    return (j.match(/[○▶\d]([·A-Z]{13})/) ?? ['', ''])[1]!
  }
  // It has just finished: the B (for Bash) is at the head of the belt, then it slides right.
  const first = (await belt()).indexOf('B')
  expect(first).toBeGreaterThanOrEqual(1)
  expect(first).toBeLessThanOrEqual(4)
  await clock.advance(450)
  const middle = (await belt()).indexOf('B')
  expect(middle).toBeGreaterThan(first)
  expect(middle).toBeLessThan(12)
  await clock.advance(5000)
  expect((await belt()).indexOf('B')).toBe(12)
  const cells = unwrap(last.cells)
  expect(cells.length).toBe(1)
  expect(cells[0].endAt).toBeGreaterThan(0)
})

test('14 errors among recent calls make the waves choppier and warmer', async ($, on) => {
  const { tool, clock } = engine(on)
  await start($)
  const level = async () => {
    let s = ''
    await withBand($, async ui => {
      s = await joined(ui)
    })

    return (s.match(/calm|ripples|choppy|stormy/) ?? [''])[0]
  }
  expect(await level()).toBe('calm')
  tool.fn = () => ok()

  for (let i = 0; i < 6; i++) {
    await call($, { tool: 'Read', file_path: `/f${i}` })
  }
  expect(await level()).toBe('calm')
  tool.fn = () => ({ result: {}, isError: true })

  for (let i = 0; i < 2; i++) {
    await call($, { tool: 'Bash', command: 'x' })
  }
  expect(await level()).toBe('ripples')

  for (let i = 0; i < 3; i++) {
    await call($, { tool: 'Bash', command: 'x' })
  }
  expect(['choppy', 'stormy']).toContain(await level())

  tool.fn = () => ok()

  for (let i = 0; i < 10; i++) {
    await call($, { tool: 'Read', file_path: `/g${i}` })
  }
  expect(await level()).toBe('calm')
  await clock.advance(5000)
})

// ------------------------------------------------------------- 13 ink, lab pane

test('13 an edited file glows in the lab list then settles after 1.2 s', async ($, on) => {
  const { clock, opened, last } = engine(on)
  await start($)
  await run($, 'lab')
  expect(opened).toContain(LAB)
  await call($, { tool: 'Edit', file_path: '/Users/me/proj/src/edited.ts' })
  await call($, { tool: 'Read', file_path: '/Users/me/proj/src/read-only.ts' })
  await $.ui.mount(PANE()).then(async u => {
    await u.press({ key: 'tab-1' })
    await u.unmount()
  })
  await clock.advance(1000)

  const row = async () => {
    const ui = await $.ui.mount(PANE())
    const all = (await ui.findAll({ type: 'Text' })) as { text: string; props: { color?: string; weight?: string } }[]
    await ui.unmount()

    return all.filter(t => /edit|src\/ed|ed\.ts|^src/.test(t.text) && !/Motion|sample/.test(t.text))
  }
  // Mid-spread: part of the row is lit bold in the accent colour, the rest still dim.
  const sample = await call($, { tool: 'Edit', file_path: '/Users/me/proj/src/second.ts' })
  void sample
  await clock.advance(250)
  const lit = await row()
  expect(lit.some(t => t.props.color === 'claude' && t.props.weight === 'bold')).toBe(true)
  await clock.advance(1500)
  const cooled = await row()
  expect(cooled.every(t => t.props.color === 'inactive')).toBe(true)
  expect(cooled.map(t => t.text)).toContain('src/second.ts')
  expect(cooled.map(t => t.text)).toContain('src/edited.ts')
  expect(cooled.map(t => t.text).join('|')).not.toMatch(/read-only/)
  const edits = unwrap(last.edits)
  expect(edits.length).toBe(2)
  expect(edits[0].path).toBe('src/second.ts')
})

test('the lab opens, reveals the sparklines, and keeps a slow ticker while it is open', async ($, on) => {
  const { counts, clock } = engine(on)
  await start($)
  const opening = await run($, 'lab')
  expect(opening.text).toMatch(/lab opened/)

  let ui = await $.ui.mount(PANE())
  const first = await texts(ui)
  const spark = first.find(x => /^[▁▂▃▄▅▆▇█ ]{20,}$/.test(x))
  // Right after opening the sparkline is still drawing in: blanks at the right end.
  expect(spark).toBeDefined()
  expect(spark!.endsWith(' ')).toBe(true)
  await ui.unmount()
  await clock.advance(700)
  ui = await $.ui.mount(PANE())
  const settled = (await texts(ui)).find(x => /^[▁▂▃▄▅▆▇█ ]{20,}$/.test(x))
  expect(settled!.endsWith(' ')).toBe(false)
  expect(await joined(ui)).toMatch(/sample data/)
  await ui.unmount()

  // The pane keeps a slow ticker while open (ambient waves, sky, tank).
  const mid = counts.nows
  await clock.advance(2000)
  expect(counts.nows).toBeGreaterThan(mid)
})

// ------------------------------------------------------------- 5 tabs

test('5 pressing a tab glides the underline to it and settles exactly under it', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'lab')
  await clock.advance(700)
  const underline = async () => {
    const ui = await $.ui.mount(PANE())
    const t = await ui.find({ type: 'Text', text: /^ *━+$/ })
    await ui.unmount()

    return t?.text ?? ''
  }
  expect(await underline()).toBe('━'.repeat(12))
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-2' })
  await ui.unmount()
  await clock.advance(100)
  const mid = await underline()
  expect(mid).not.toBe(' '.repeat(24) + '━'.repeat(12))
  expect(mid.length).toBeGreaterThan(0)
  expect(mid.trimStart().length > 12).toBe(true)
  await clock.advance(400)
  expect(await underline()).toBe(' '.repeat(24) + '━'.repeat(12))

  // The pressed tab's page is showing.
  const page = await $.ui.mount(PANE())
  expect(await joined(page)).toMatch(/flip-clock timer/)
  await page.unmount()
})

// ------------------------------------------------------------- 8 flip clock, 9 badge, 11 skeleton

test('8 /anim timer starts a flip clock in the lab: digits flip, the end toasts, motion off shows plain digits', async ($, on) => {
  const { clock, toasts } = engine(on)
  await start($)
  await run($, 'lab')
  const t = await run($, 'timer 0.1')
  expect(t.text).toMatch(/started: 0\.1 min/)
  const ui0 = await $.ui.mount(PANE())
  await ui0.press({ key: 'tab-2' })
  await ui0.unmount()
  await clock.advance(1)

  const digits = async () => {
    const ui = await $.ui.mount(PANE())
    const all = await texts(ui)
    await ui.unmount()

    return all.join('')
  }
  expect(await digits()).toMatch(/00 : 06|00 : 05/)
  let flipped = false

  for (let i = 0; i < 40; i++) {
    await clock.advance(100)

    if (/[▀▄]/.test(await digits())) {
      flipped = true
    }
  }
  expect(flipped).toBe(true)
  await clock.advance(3000)
  expect(toasts).toContain('Timer finished')
  expect(await digits()).toMatch(/00 : 00/)
  expect(await digits()).toMatch(/\(done\)/)
})

test('9 /anim badge sweeps a highlight across the label', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'lab')
  expect((await run($, 'badge FIRST BLOOD')).text).toMatch(/Badge: FIRST BLOOD/)
  const ui0 = await $.ui.mount(PANE())
  await ui0.press({ key: 'tab-2' })
  await ui0.unmount()
  await clock.advance(50)
  const states = new Set<string>()

  for (let i = 0; i < 9; i++) {
    await clock.advance(100)
    const ui = await $.ui.mount(PANE())
    const whole = await texts(ui)
    const at = whole.findIndex(x => x === '[ ')
    states.add(whole.slice(at + 1, at + 4).join('|'))
    await ui.unmount()
  }
  expect(states.size >= 3).toBe(true)
  await clock.advance(1000)
  const ui = await $.ui.mount(PANE())
  const whole = await texts(ui)
  const at = whole.findIndex(x => x === '[ ')
  expect(whole.slice(at + 1, at + 4)).toEqual(['FIRST BLOOD', '', ''])
  await ui.unmount()
})

test('11 /anim skeleton shows moving placeholder bars in the loading lab sections, then the real content', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await run($, 'lab')
  await clock.advance(1000)
  expect((await run($, 'skeleton')).text).toMatch(/skeleton bars/)
  const frames = new Set<string>()

  for (let i = 0; i < 6; i++) {
    await clock.advance(100)
    const ui = await $.ui.mount(PANE())
    const all = await texts(ui)
    expect(all.some(x => /^░+$/.test(x))).toBe(true)
    frames.add(all.filter(x => /^[░▓]*$/.test(x) && x !== '').slice(0, 3).join('|'))
    await ui.unmount()
  }
  expect(frames.size >= 2).toBe(true)
  await clock.advance(3000)
  const ui = await $.ui.mount(PANE())
  expect((await texts(ui)).some(x => /^░{5,}$/.test(x))).toBe(false)
  await ui.unmount()
})

// ------------------------------------------------------------- 10 sky

test('10 the sky strip in the band has 24 cells and the sun on the current local hour', async ($, on) => {
  engine(on)
  await start($)
  await withBand($, async ui => {
    const all = await texts(ui)
    const strip = all.join('').match(/[☀☾·✦─░]{24}/)
    expect(strip).not.toBeNull()
    expect(strip![0][12]).toBe('☀')
  })
})

// ------------------------------------------------------------- /anim demo

test('/anim demo plays every animation once, then everything settles and the ticker stops', async ($, on) => {
  const { clock, counts, statuses } = engine(on)
  await start($)
  const reply = await run($, 'demo')
  expect(reply.text).toMatch(/Playing every animation once/)
  await clock.advance(200)
  expect(statuses.some(s => s !== undefined && s.includes('✗ demo failed'))).toBe(true)

  await withBand($, async ui => {
    const t = await texts(ui)
    expect(t.some(x => /^ +\$$/.test(x))).toBe(true)
    expect(t).not.toContain('─')
  })

  let sawConfetti = false
  let sawChoppy = false
  let sawCtxSweep = new Set<string>()

  for (let i = 0; i < 70; i++) {
    await clock.advance(100)
    await withBand($, async ui => {
      const j = await joined(ui)
      sawConfetti = sawConfetti || /[*✦◆▪+]{1}/.test(j.replace(/[☀☾✦]/g, ''))
      sawChoppy = sawChoppy || /choppy|stormy/.test(j)
      sawCtxSweep.add((j.match(/\d+%/) ?? [''])[0])
    })
  }
  expect(sawChoppy).toBe(true)
  expect(sawCtxSweep.size > 3).toBe(true)
  void sawConfetti

  await clock.advance(10_000)
  const before = counts.nows
  await clock.advance(60_000)
  expect(counts.nows).toBe(before)
  await withBand($, async ui => {
    expect(await texts(ui)).toContain('─')
    expect(await joined(ui)).toMatch(/calm/)
  })
})

// ------------------------------------------------------------- global switch mid-run

test('flipping the motion atom off mid-animation stops the ticker at its next tick and settles the drawings', async ($, on) => {
  const { clock, counts, motion } = engine(on)
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(500)
  const running = counts.nows
  expect(running).toBeGreaterThan(1)

  motion.isOn = false
  await clock.advance(300)
  const stopped = counts.nows
  await clock.advance(10_000)
  expect(counts.nows).toBe(stopped)
  await withBand($, async ui => {
    expect(await texts(ui)).toContain('●')
  })
  motion.isOn = true
})

// ------------------------------------------------------------- bounds, composing

test('everything recorded is bounded', async ($, on) => {
  const { clock, tool, usage, last } = engine(on)
  await start($)
  tool.fn = e => (e.command === 'x' ? { result: {}, isError: true } : ok())

  for (let i = 0; i < 70; i++) {
    usage.usd += 0.01
    await call($, { tool: i % 2 === 0 ? 'Edit' : 'Bash', file_path: `/p/f${i}.ts`, command: i % 5 === 0 ? 'x' : 'ls' })
    await $.turn.complete(done)
    await clock.advance(20)
  }
  await clock.advance(3000)
  expect(unwrap(last.cells).length).toBeLessThanOrEqual(24)
  expect(unwrap(last.edits).length).toBeLessThanOrEqual(8)
  expect(unwrap(last.edits).length).toBeGreaterThan(3)
  expect(String(unwrap(last.outcomes)).length).toBeLessThanOrEqual(20)
  expect(String(unwrap(last.outcomes)).includes('e')).toBe(true)
  const hist = unwrap(last.hist)
  expect(hist.spend.length).toBeLessThanOrEqual(40)
  expect(hist.ctx.length).toBeLessThanOrEqual(40)
  expect(hist.spend.length).toBeGreaterThan(5)
})

test('another mod row stays in the band, and a survey or collapsed band is left alone', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>other mod row</Text>
  })
  await start($)
  const ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeDefined()
  await ui.unmount()

  const survey = await $.ui.mount(BAND(false, { hasSurvey: true }))
  expect(await survey.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  expect(await survey.find({ type: 'Text', text: /calm/ })).toBeUndefined()
  await survey.unmount()
})

test('the pane and the band draw on the terminal surface too', async ($, on) => {
  engine(on)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount(PANE(surface))
    expect(await pane.find({ type: 'Button', key: 'tab-0' })).toBeDefined()
    await pane.unmount()
    const widget = await $.ui.mount({ ...PANE(surface), props: { ...PANE(surface).props, placement: 'widget' } } as any)
    expect(await widget.find({ type: 'Text', text: /%/ })).toBeDefined()
    await widget.unmount()
  }
})

test('every colour the band and the lab draw is a theme key', async ($, on) => {
  const { clock, tool, usage } = engine(on)
  const THEME = ['success', 'error', 'warning', 'suggestion', 'subtle', 'inactive', 'claude', undefined]
  await start($)
  await run($, 'lab')
  tool.fn = e => (e.command === 'bad' ? { result: {}, isError: true } : ok('[main abc1234] m'))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  usage.usd = 2
  await call($, { tool: 'Bash', command: 'git commit -m m' })
  await call($, { tool: 'Bash', command: 'bad' })
  await call($, { tool: 'Edit', file_path: '/p/a.ts' })
  await run($, 'timer 1')
  await run($, 'badge ok')
  await run($, 'skeleton')
  await clock.advance(200)
  const colours = new Set<string | undefined>()
  const scan = async (ui: any) => {
    for (const t of (await ui.findAll({ type: 'Text' })) as { props: { color?: string } }[]) {
      colours.add(t.props.color)
    }
    for (const b of (await ui.findAll({ type: 'Box' })) as { props: { borderColor?: string } }[]) {
      colours.add(b.props.borderColor)
    }
  }
  const band = await $.ui.mount(BAND())
  await scan(band)
  await band.unmount()

  for (const key of ['tab-0', 'tab-1', 'tab-2']) {
    const pane = await $.ui.mount(PANE())
    await pane.press({ key })
    await pane.unmount()
    await clock.advance(120)
    const again = await $.ui.mount(PANE())
    await scan(again)
    await again.unmount()
  }

  for (const c of colours) {
    expect(THEME).toContain(c)
  }
  expect(colours.size >= 5).toBe(true)
})

test('a lab pane the engine cannot place says so and starts no ticker', async ($, on) => {
  const { clock, counts } = engine(on, { isPlaced: false })
  await start($)
  expect((await run($, 'lab')).text).toMatch(/could not be placed/)
  await clock.advance(1000)
  const before = counts.nows
  await clock.advance(20_000)
  expect(counts.nows).toBe(before)
})
