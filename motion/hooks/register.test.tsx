import { expect, mock, test } from 'claude-code/testing'

import { CHEER_MS, blendColor, popFrame, shimmerFrame, springIsLive, springStep, staggerShown, statusFrame } from './frames'
import { GAUGE_MS, gaugeTo, gaugeValue } from './gauge'

const BAND = (isWorking = false) =>
  ({
    plugin: 'motion',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking,
      maxRows: 8,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 8 },
      view: {},
    },
  }) as const

const ROW = (props: Record<string, unknown>) =>
  ({
    plugin: 'motion',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...props },
  }) as const

const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

type Usage = { percent: number; usd: number }

// Stands in for the engine. `usage` and the status lines are moved and read by each test.
const engine = (on: any, init: Record<string, unknown> = {}) => {
  const usage: Usage = { percent: 10, usd: 0.5 }
  const statuses: (string | undefined)[] = []
  const counts = { nows: 0 }
  const clock = mock.clock(on, { now: 100_000 })
  const saved: Record<string, unknown> = { ...init }
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => ({ value: { command: 'motion' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  // Every tick writes the `now` atom, so counting those writes counts ticks.
  on('state.set', (_: unknown, e: { key?: string }, next: (e: unknown) => unknown) => {
    if (e.key === 'now') {
      counts.nows += 1
    }

    return next(e)
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000, percent: usage.percent }, rateLimits: [], cost: { usd: usage.usd } },
  }))

  return { usage, statuses, counts, clock, saved }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = ($: any, args: string) => $.command.run({ command: 'motion', args, origin: 'user' } as any)

// ------------------------------------------------------------- pure frames (28, 33, 36, 40)

test('a gauge eases to its new number over 400 ms, and is instant when motion is off', () => {
  const g = gaugeTo({ from: 0, to: 10, at: 0 }, 50, 1000, true)
  expect(g.from).toBe(10)
  expect(gaugeValue(g, 1000)).toBe(10)
  const mid = gaugeValue(g, 1000 + GAUGE_MS / 2)
  expect(mid > 10 && mid < 50).toBe(true)
  expect(gaugeValue(g, 1000 + GAUGE_MS)).toBe(50)
  expect(gaugeValue(g, 1000 + GAUGE_MS * 3)).toBe(50)
  const off = gaugeTo({ from: 0, to: 10, at: 0 }, 50, 1000, false)
  expect(off).toEqual({ from: 50, to: 50, at: 1000 })
})

test('the status line slides in, types, pulses, settles, then erases and ends', () => {
  const text = 'Bash: ls'
  expect(statusFrame(text, 0)).toBe('›››◆ B▌')
  expect(statusFrame(text, 150)).toMatch(/^››◇ Bash/)
  expect(statusFrame(text, 400)).toBe('◆ Bash: ls')
  expect(statusFrame(text, 1500)).toBe('▸ Bash: ls')
  expect(statusFrame(text, 8 * 30 + 2600 + 8 * 14 / 2)).toMatch(/^· Bash/)
  expect(statusFrame(text, 8 * 30 + 2600 + 8 * 14)).toBeUndefined()
})

test('the context colour glides green to amber to red', () => {
  expect(blendColor(0)).toBe('#4ade80')
  expect(blendColor(70)).toBe('#fbbf24')
  expect(blendColor(90)).toBe('#ef4444')
  expect(blendColor(100)).toBe('#ef4444')
  const mid = blendColor(35)
  expect(mid).not.toBe('#4ade80')
  expect(mid).not.toBe('#fbbf24')
})

test('the spring overshoots then settles exactly on target', () => {
  let r = { pos: 0, vel: 0, target: 1 }
  let peak = 0

  for (let i = 0; i < 40 && springIsLive(r); i++) {
    r = springStep(r, 100)
    peak = Math.max(peak, r.pos)
  }
  expect(peak > 1).toBe(true)
  expect(r).toEqual({ pos: 1, vel: 0, target: 1 })
})

test('small frame helpers', () => {
  expect(popFrame(0, true).glyph).toBe('●')
  expect(popFrame(150, true).glyph).toBe('◉')
  expect(popFrame(300, true).glyph).toBe('✓')
  expect(popFrame(300, false).glyph).toBe('✗')
  expect(shimmerFrame(0).join('').length).toBe(16)
  expect(staggerShown(0, 3)).toBe(1)
  expect(staggerShown(160, 3)).toBe(2)
  expect(staggerShown(9999, 3)).toBe(3)
})

// ------------------------------------------------------------- the switch (41)

test('motion is on by default, /motion shows it, off is stored and read back', async ($, on) => {
  const { clock, saved } = engine(on)
  await start($)
  expect((await run($, '')).text).toMatch(/Motion is on/)
  expect((await run($, 'off')).text).toMatch(/Motion off/)
  expect(saved.motion).toBe(false)
  expect((await run($, '')).text).toMatch(/Motion is off/)
  expect((await run($, 'demo')).text).toMatch(/Motion is off/)
  expect((await run($, 'on')).text).toMatch(/Motion on/)
  expect(saved.motion).toBe(true)
  await clock.settle()
})

test('a stored off is honoured at start', async ($, on) => {
  engine(on, { motion: false })
  await start($)
  expect((await run($, '')).text).toMatch(/Motion is off/)
})

// ------------------------------------------------------------- one shared ticker (30, 32, 33)

test('a tool call types its status out, then the one ticker stops itself', async ($, on) => {
  const { statuses, counts, clock } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(statuses[0]).toMatch(/^››/)

  await clock.advance(1500)
  expect(statuses.some(s => s === '▸ Bash: ls')).toBe(true)
  await clock.advance(5000)
  expect(statuses[statuses.length - 1]).toBeUndefined()

  // Idle: the ticker is gone, so the clock is not read any more.
  const before = counts.nows
  await clock.advance(30_000)
  expect(counts.nows).toBe(before)
})

test('with motion off the status shows its final text at once and no ticker runs', async ($, on) => {
  const { statuses, counts, clock } = engine(on, { motion: false })
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(statuses).toContain('▸ Bash: ls')
  expect(statuses.some(s => s !== undefined && s.startsWith('›'))).toBe(false)
  await clock.advance(3100)
  expect(statuses[statuses.length - 1]).toBeUndefined()

  const before = counts.nows
  await clock.advance(30_000)
  // Only the idle-away timer (one read) may have run.
  expect(counts.nows - before <= 2).toBe(true)
})

// ------------------------------------------------------------- the band (28, 29, 36, 31)

test('gauges ease to a new value and settle; the numbers roll', async ($, on) => {
  const { usage, clock } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)

  let ui = await $.ui.mount(BAND())
  expect((await ui.find({ type: 'Text', text: /^10%$/ }))?.text).toBe('10%')
  expect((await ui.find({ type: 'Text', text: /\$0\.50/ }))?.text).toBe('$0.50')
  await ui.unmount()

  usage.percent = 60
  usage.usd = 2
  await $.turn.complete(done)
  await clock.advance(200)
  ui = await $.ui.mount(BAND())
  const mid = (await ui.find({ type: 'Text', text: /^\d+%$/ }))?.text ?? ''
  const n = Number(mid.replace('%', ''))
  expect(n > 10 && n < 60).toBe(true)
  await ui.unmount()

  await clock.advance(1000)
  ui = await $.ui.mount(BAND())
  expect((await ui.find({ type: 'Text', text: /^60%$/ }))?.text).toBe('60%')
  expect((await ui.find({ type: 'Text', text: /\$2\.00/ }))?.text).toBe('$2.00')
  await ui.unmount()
})

test('with motion off a gauge jumps straight to its value', async ($, on) => {
  const { usage, clock } = engine(on, { motion: false })
  await start($)
  usage.percent = 80
  await $.turn.complete(done)
  await clock.advance(10)
  const ui = await $.ui.mount(BAND())
  expect((await ui.find({ type: 'Text', text: /^80%$/ }))?.text).toBe('80%')
  await ui.unmount()
})

test('the tool count pulses on a new call and settles', async ($, on) => {
  const { clock } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a.ts' })
  await clock.advance(100)

  let ui = await $.ui.mount(BAND())
  expect((await ui.find({ type: 'Text', text: /▸ \d+ calls/ }))?.text).toBeDefined()
  await ui.unmount()

  await clock.advance(3000)
  ui = await $.ui.mount(BAND())
  expect((await ui.find({ type: 'Text', text: /^1 calls$/ }))?.text).toBe('1 calls')
  await ui.unmount()
})

test('the press ripple plays on a chip and ends; the chip toggles motion', async ($, on) => {
  const { clock, saved } = engine(on)
  await start($)
  let ui = await $.ui.mount(BAND())
  await ui.press({ key: 'demo-chip' })
  await clock.advance(100)
  await ui.unmount()
  ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Button', text: /^[◦○◎◉] demo$/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(1000)
  ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Button', text: /^demo$/ })).toBeDefined()
  await ui.press({ key: 'motion-chip' })
  await ui.unmount()
  expect(saved.motion).toBe(false)

  ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Button', text: /motion off/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /demo/ })).toBeUndefined()
  await ui.unmount()
})

test('another mod row stays under the band', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>other mod row</Text>
  })
  await start($)
  const ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^10%$/ })).toBeDefined()
  await ui.unmount()
})

// ------------------------------------------------------------- tool rows (34, 35, 42)

const slowCalls = (on: any, clock: { sleep: (ms: number) => Promise<void> }, delay: { ms: number }) => {
  const ids: string[] = []
  on('tool.call', async (_: unknown, e: { tool_use_id: string }) => {
    ids.push(e.tool_use_id)
    await clock.sleep(delay.ms)

    return { result: {} }
  })

  return ids
}

test('a running row shimmers; a finished row pops its check, then the row is plain', async ($, on) => {
  const { clock } = engine(on)
  const ids = slowCalls(on, clock, { ms: 1000 })
  await start($)
  const running = $.tool.call({ tool: 'Bash', command: 'sleep 1' })
  await clock.advance(300)

  let ui = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'sleep 1' }, isRunning: true }))
  expect(await ui.find({ type: 'Text', text: /[▒▓]/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(800)
  await running
  await clock.advance(100)
  ui = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'sleep 1' }, output: { stdout: '', stderr: '' } }))
  expect(await ui.find({ type: 'Text', text: /^[●◉✓]$/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(1000)
  ui = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'sleep 1' }, output: { stdout: '', stderr: '' } }))
  expect(await ui.find({ type: 'Text', text: /^[●◉✓]$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /[▒▓]/ })).toBeUndefined()
  await ui.unmount()
})

test('a passing test run celebrates, then settles to a quiet line; a failing one does not', async ($, on) => {
  const { clock } = engine(on)
  const ids: string[] = []
  on('tool.call', (_: unknown, e: { tool_use_id: string }) => {
    ids.push(e.tool_use_id)

    return { result: {} }
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
  await clock.advance(200)
  const out = { stdout: '5 passed', stderr: '' }

  let ui = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'npm test' }, output: out }))
  expect((await ui.find({ type: 'Text', text: /tests passed/ }))?.text).toMatch(/[✦✧∗•·˙ ]{14} tests passed/)
  await ui.unmount()

  const failed = { stdout: '2 failed, 5 passed', stderr: '' }
  ui = await $.ui.mount(ROW({ tool_use_id: ids[1], input: { command: 'pytest -q' }, isErrored: true, output: failed }))
  expect(await ui.find({ type: 'Text', text: /tests passed/ })).toBeUndefined()
  await ui.unmount()

  await clock.advance(CHEER_MS + 500)
  ui = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'npm test' }, output: out }))
  expect((await ui.find({ type: 'Text', text: /tests passed/ }))?.text).toBe('✓ tests passed')
  await ui.unmount()
})

test('with motion off rows get no shimmer or pop, only the static pass line', async ($, on) => {
  const { clock } = engine(on, { motion: false })
  const ids = slowCalls(on, clock, { ms: 500 })
  await start($)
  const running = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(200)

  let ui = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'npm test' }, isRunning: true }))
  expect(await ui.find({ type: 'Text', text: /[▒▓]/ })).toBeUndefined()
  await ui.unmount()

  await clock.advance(400)
  await running
  ui = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'npm test' }, output: { stdout: '3 passed', stderr: '' } }))
  expect(await ui.find({ type: 'Text', text: /^[●◉]$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /tests passed/ }))?.text).toBe('✓ tests passed')
  await ui.unmount()
})

test('a row this mod never saw is left alone', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(ROW({ tool_use_id: 'unknown', isRunning: true }))
  expect(await ui.find({ type: 'Text', text: /[▒▓]/ })).toBeUndefined()
  await ui.unmount()
})

// ------------------------------------------------------------- list, ring, breathing (38, 39, 40)

test('the turn summary enters one row at a time, then all rows stay', async ($, on) => {
  const { clock } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  await $.turn.complete(done)

  let ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /Bash ×2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Edit ×1/ })).toBeUndefined()
  await ui.unmount()

  await clock.advance(1000)
  ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /Bash ×2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read ×1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Edit ×1/ })).toBeDefined()
  await ui.unmount()
})

test('the timer ring springs up, drains by steps, and ends', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  expect((await run($, 'timer 1')).text).toMatch(/Timer ring started/)

  let ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /▱▱▱▱▱▱▱▱ ~1m/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(300)
  ui = await $.ui.mount(BAND())
  const part = (await ui.find({ type: 'Text', text: /[▰▱]{8} ~/ }))?.text ?? ''
  expect(part).toMatch(/▰/)
  await ui.unmount()

  await clock.advance(1500)
  ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /▰▰▰▰▰▰▰▰ ~1m/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(60_000 + 10_000)
  ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /~\dm|done/ })).toBeUndefined()
  await ui.unmount()
})

test('with motion off the ring jumps to its value', async ($, on) => {
  engine(on, { motion: false })
  await start($)
  await run($, 'timer 1')
  const ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /▰▰▰▰▰▰▰▰ ~1m/ })).toBeDefined()
  await ui.unmount()
})

test('after a minute away the band breathes at a slow tick; activity ends it', async ($, on) => {
  const { counts, clock } = engine(on)
  await start($)
  await clock.advance(61_000)

  let ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /idle/ })).toBeDefined()
  await ui.unmount()

  // Slow cadence (500 ms): about two clock reads a second, not ten.
  const before = counts.nows
  await clock.advance(10_000)
  expect(counts.nows - before <= 40).toBe(true)
  expect(counts.nows - before >= 10).toBe(true)

  await $.prompt.submit({ text: 'back', wait: false, origin: { kind: 'composer' } })
  ui = await $.ui.mount(BAND())
  expect(await ui.find({ type: 'Text', text: /idle/ })).toBeUndefined()
  await ui.unmount()

  // Away is over, so the ticker has stopped.
  await clock.advance(1000)
  const settled = counts.nows
  await clock.advance(20_000)
  expect(counts.nows - settled <= 2).toBe(true)
})

test('motion off: the away row is a still glyph and nothing ticks', async ($, on) => {
  const { counts, clock } = engine(on, { motion: false })
  await start($)
  await clock.advance(61_000)
  const ui = await $.ui.mount(BAND())
  expect((await ui.find({ type: 'Text', text: /idle/ }))?.text).toBe('◦ idle')
  await ui.unmount()
  const before = counts.nows
  await clock.advance(20_000)
  expect(counts.nows - before <= 1).toBe(true)
})

test('turning motion off mid-animation freezes every value at its final state', async ($, on) => {
  const { usage, statuses, clock } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  usage.percent = 90
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete(done)
  await run($, 'off')

  const ui = await $.ui.mount(BAND())
  expect((await ui.find({ type: 'Text', text: /^90%$/ }))?.text).toBe('90%')
  await ui.unmount()
  expect(statuses[statuses.length - 1]).toBe('▸ Bash: ls')
  await clock.advance(3100)
  expect(statuses[statuses.length - 1]).toBeUndefined()
})
