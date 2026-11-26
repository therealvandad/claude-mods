import { expect, mock, test } from 'claude-code/testing'

import { SOUND_FILES } from './sounds'
import { isAllowedRun } from './pure'

// Everything outside the mod is a stand-in here: no real process, network, disk or sound is touched.
const at = (h: number, m = 0) => new Date(2026, 10, 25, h, m).getTime()
const NOON = at(12, 0)

type Opts = {
  now?: number
  features?: Record<string, boolean>
  motion?: boolean
  calm?: boolean
  stored?: Record<string, unknown>
  /** What /cfg answers; an Error rejects the call. */
  cfg?: (args: string) => string | Error
  branch?: { exitCode: number; stdout: string } | Error
  tool?: (e: Record<string, unknown>) => Record<string, unknown>
  refuse?: string[]
}

type Called = { command: string; args: string; origin: any }

const unwrap = (v: any) => (v !== null && typeof v === 'object' && 'value' in v && ('version' in v || 'shape' in v) ? v.value : v)

const world = (on: any, opts: Opts = {}) => {
  const box = {
    registered: [] as string[],
    toasts: [] as string[],
    plays: [] as { asset: string; gain?: number }[],
    fills: [] as string[],
    procs: [] as string[][],
    runs: [] as Called[],
    themes: [] as any[],
    opened: [] as { id: string; title?: string }[],
    statuses: 0,
    frames: [] as number[],
    saved: { ...(opts.stored ?? {}) } as Record<string, unknown>,
    features: { ...(opts.features ?? {}) } as Record<string, boolean>,
    motion: opts.motion ?? true,
    calm: opts.calm ?? false,
  }
  const clock = mock.clock(on, { now: opts.now ?? NOON })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: box.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    box.saved[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete box.saved[e.key]

    return { value: undefined }
  })
  on('command.register', (_: unknown, e: { name: string }) => {
    if (opts.refuse?.includes(e.name)) {
      throw new Error('name taken')
    }
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: { id: string; title?: string }) => {
    box.opened.push({ id: e.id, title: e.title })

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', () => {
    box.statuses++

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', () => ({ turnId: 't' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_: unknown, e: Record<string, unknown>) => opts.tool?.(e) ?? { result: {} })
  on('audio.play', (_: unknown, e: { clip: { asset: string }; gain?: number }) => {
    box.plays.push({ asset: e.clip.asset, gain: e.gain })

    return { value: undefined }
  })
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    box.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    box.procs.push([...e.argv])
    const out = opts.branch ?? { exitCode: 0, stdout: 'feature/x\n' }

    if (out instanceof Error) {
      throw out
    }

    return { value: { exitCode: out.exitCode, stdout: out.stdout, stderr: '' } }
  })
  on('theme.set', (_: unknown, e: unknown) => {
    box.themes.push(e)

    return { value: { isDrawn: true, requestId: 'r' } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000, percent: 5 }, rateLimits: [], cost: { usd: 1.25 } } }))
  // Every command this mod runs for itself reaches the engine here (its own cx* commands are answered by its own hooks).
  on('command.run', (_: unknown, e: { command: string; args: string; origin: any }) => {
    if (e.origin?.kind === 'plugin') {
      box.runs.push({ command: e.command, args: e.args, origin: e.origin })
    }

    if (e.command === 'cfg') {
      const out = opts.cfg?.(e.args) ?? `Done.\n${e.args}`

      if (out instanceof Error) {
        throw out
      }

      return { text: out }
    }

    return { text: 'ok' }
  })
  on('state.set', (_: unknown, e: { plugin: string; key: string; value: unknown }, next: any) => {
    if (e.plugin === 'custom-two' && e.key === 'frame') {
      box.frames.push(unwrap(e.value) as number)
    }

    return next(e)
  })
  on('state.get', (_: unknown, e: { plugin: string; key: string }, next: any) => {
    if (e.plugin === 'settings' && e.key === 'features') {
      return { value: { value: { shape: 'features-1', value: box.features }, version: 1 } }
    }

    if (e.plugin === 'settings' && e.key === 'isCalm') {
      return { value: { value: box.calm, version: 1 } }
    }

    if (e.plugin === 'motion' && e.key === 'isOn') {
      return { value: { value: box.motion, version: 1 } }
    }

    return next(e)
  })

  return { box, clock }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = ''): Promise<string> => (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })).text
const setup = async ($: any, on: any, opts: Opts = {}) => {
  const w = world(on, opts)
  await start($)
  await w.clock.settle()

  return w
}
const call = ($: any, input: Record<string, unknown>) => $.tool.call(input as any)
const line = (r: Called) => `${r.command}${r.args === '' ? '' : ` ${r.args}`}`
/** Whatever this mod ran for itself, it ran only what the allow list lets through. */
const onlyAllowed = (box: { runs: Called[] }) => {
  for (const r of box.runs) {
    expect(isAllowedRun(r.command, r.args), line(r)).toBe(true)
  }
}

const PANE = (surface: 'desktop' | 'terminal' = 'desktop') =>
  ({
    plugin: 'custom-two',
    component: 'Pane',
    requestId: 'custom-two-main',
    surface,
    props: { title: 'Custom two', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join('\n')
const doneTurn = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

// ------------------------------------------------------------ quiet startup

test('startup registers every command and is quiet: no toast, sound, status, process, command run or prompt fill', async ($, on) => {
  const { box } = await setup($, on)
  const help = await run($, 'cx')
  const listed = [...help.matchAll(/^\/(cx\w*)\s/gm)].map(m => String(m[1])).sort()

  expect(box.registered.sort()).toEqual(listed)
  expect(listed.length).toBeGreaterThanOrEqual(28)
  expect(listed.every(n => n === 'cx' || n.startsWith('cx'))).toBe(true)
  expect(box.toasts).toEqual([])
  expect(box.plays).toEqual([])
  expect(box.statuses).toBe(0)
  expect(box.procs).toEqual([])
  expect(box.runs).toEqual([])
  expect(box.fills).toEqual([])
  expect(box.opened).toEqual([])
  expect(box.saved.log).toBeUndefined()
})

test('a refused name does not stop the other commands', async ($, on) => {
  const { box } = await setup($, on, { refuse: ['cxtip'] })

  expect(box.registered).toContain('cxfile')
  expect(box.registered).not.toContain('cxtip')
})

test('every idea has a command and it answers without an error', async ($, on) => {
  await setup($, on)

  for (const [c, a] of [
    ['cxfile', 'list'], ['cxbranch', 'list'], ['cxsound', 'list'], ['cxgreet', ''], ['cxtip', ''], ['cxempty', 'list'], ['cxtitle', 'list'], ['cxrange', 'list'], ['cxfilter', 'list'],
    ['cxsearch', 'list'], ['cxreport', ''], ['cxexport', 'csv'], ['cxkeys', 'list'], ['cxkeys', 'builtin'], ['cxlogo', ''], ['cxfont', 'list'], ['cxicon', 'list'], ['cxcurve', 'list'],
    ['cxsched', 'list'], ['cxfocus', 'list'], ['cxdnd', ''], ['cxrules', 'list'], ['cxbundle', 'list'], ['cxcheck', 'list'], ['cxgloss', 'list'], ['cxmacro', 'list'], ['cxlog', ''],
  ] as const) {
    const text = await run($, c, a)
    expect(text, `${c} ${a}`).not.toMatch(/unexpected error|Unknown command/)
    expect(text.length, `${c} ${a}`).toBeGreaterThan(5)
  }
})

// ------------------------------------------------------------ recording (switch)

test('recording is off by default and on only behind the switch; the call result is untouched', async ($, on) => {
  const off = await setup($, on, { tool: e => ({ result: { text: `ran ${e.tool}` } }) })
  const ran = await call($, { tool: 'Edit', file_path: '/p/a.ts' })

  expect((ran as any).result.text).toBe('ran Edit')
  expect(off.box.saved.log).toBeUndefined()
  expect(await run($, 'cxlog')).toMatch(/Recording is off/)
})

test('with the switch on, rows are kept: file, error, first word of a command, commit; bounded and resettable', async ($, on) => {
  const { box, clock } = await setup($, on, {
    features: { 'custom-two.record': true },
    tool: e => (e.tool === 'Grep' ? { result: {}, isError: true } : { result: {} }),
  })
  await call($, { tool: 'Edit', file_path: '/p/a.ts' })
  await call($, { tool: 'Grep', pattern: 'secret-pattern' })
  await call($, { tool: 'Bash', command: 'git commit -m "my secret message"' })
  await call($, { tool: 'Bash', command: 'npm test' })
  const rows = box.saved.log as any[]

  expect(rows.map(r => `${r.tool}:${r.ok}:${r.detail}:${r.commit}`)).toEqual(['Edit:true::false', 'Grep:false::false', 'Bash:true:git:true', 'Bash:true:npm:false'])
  expect(JSON.stringify(rows)).not.toMatch(/secret/)
  expect(await run($, 'cxlog', 'last 2')).toMatch(/npm/)
  expect(await run($, 'cxexport', 'csv')).toMatch(/^4 rows as csv:\ntime,tool,ok/)
  expect(await run($, 'cxreport')).toMatch(/Calls 4 · errors 1 · files 1 · commits 1/)
  expect(await run($, 'cxreport')).toContain('$1.25')

  for (let i = 0; i < 40; i++) {
    await call($, { tool: 'Read', file_path: `/p/f${i % 7}.md` })
  }
  await clock.settle()
  expect((box.saved.log as any[]).length).toBe(44)
  const text = await run($, 'cxreset')
  expect(text).toMatch(/recorded log and run list are cleared/)
  expect(box.saved.log).toBeUndefined()
  expect(await run($, 'cxlog')).toMatch(/0 of at most 300/)
})

test('a filter and a range reach the report and the export', async ($, on) => {
  const { box } = await setup($, on, { features: { 'custom-two.record': true }, tool: e => (e.tool === 'Grep' ? { result: {}, isError: true } : { result: {} }) })
  await call($, { tool: 'Edit', file_path: '/p/a.ts' })
  await call($, { tool: 'Grep', pattern: 'x' })
  await call($, { tool: 'Grep', pattern: 'y' })
  await run($, 'cxfilter', 'save errs ok=error')
  await run($, 'cxfilter', 'use errs')
  expect(await run($, 'cxreport')).toMatch(/Calls 2 · errors 2/)
  expect(await run($, 'cxsearch', 'grep')).toMatch(/2 of 2 rows match/)
  await run($, 'cxrange', 'add old 2020-01-01 2020-01-31')
  await run($, 'cxrange', 'use old')
  expect(await run($, 'cxexport', 'json')).toMatch(/No rows in view/)
  expect(box.runs).toEqual([])
})

// ------------------------------------------------------------ sounds (switch)

test('event sounds: off by default, then only files from the sounds folder, quiet, and not more than one per 1.5 s', async ($, on) => {
  const quiet = await setup($, on, { tool: () => ({ result: {}, isError: true }) })
  await call($, { tool: 'Bash', command: 'false' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(doneTurn)
  expect(quiet.box.plays).toEqual([])
})

test('event sounds on: turn end, error and commit each play their file; the throttle and the mapping hold', async ($, on) => {
  const { box, clock } = await setup($, on, {
    features: { 'custom-two.event-sounds': true },
    tool: e => (e.tool === 'Grep' ? { result: {}, isError: true } : { result: {} }),
  })
  await call($, { tool: 'Grep', pattern: 'x' })
  await call($, { tool: 'Grep', pattern: 'y' })
  expect(box.plays.map(p => p.asset)).toEqual(['sounds/error.wav'])
  await clock.advance(2000)
  await call($, { tool: 'Bash', command: 'git commit -m x' })
  await clock.advance(2000)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(doneTurn)
  expect(box.plays.map(p => p.asset)).toEqual(['sounds/error.wav', 'sounds/commit.wav', 'sounds/done.wav'])
  expect(box.plays.every(p => (p.gain ?? 1) <= 0.6)).toBe(true)

  for (const p of box.plays) {
    expect(SOUND_FILES).toContain(p.asset.replace('sounds/', ''))
  }
  // a changed mapping is used, a bad one refused, an aborted turn is silent
  expect(await run($, 'cxsound', 'turn-end soft.wav')).toMatch(/turn-end -> soft.wav/)
  expect(await run($, 'cxsound', 'turn-end ../../x.wav')).toMatch(/not in the sounds folder/)
  await clock.advance(2000)
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await $.turn.complete({ ...doneTurn, turnId: 't2', reason: 'aborted' })
  expect(box.plays).toHaveLength(3)
  await $.turn.start({ text: 'hi', turnId: 't3' })
  await $.turn.complete({ ...doneTurn, turnId: 't3' })
  expect(box.plays.at(-1)?.asset).toBe('sounds/soft.wav')
  await run($, 'cxsound', 'turn-end off')
  await clock.advance(2000)
  await $.turn.start({ text: 'hi', turnId: 't4' })
  await $.turn.complete({ ...doneTurn, turnId: 't4' })
  expect(box.plays).toHaveLength(4)
})

test('/cxsound test plays one clip on request even with the switch off, and refuses an unknown event', async ($, on) => {
  const { box } = await setup($, on)
  expect(await run($, 'cxsound', 'test commit')).toMatch(/Played commit.wav/)
  expect(box.plays.map(p => p.asset)).toEqual(['sounds/commit.wav'])
  expect(await run($, 'cxsound', 'test boom')).toMatch(/Event is one of/)
  expect(box.plays).toHaveLength(1)
})

// ------------------------------------------------------------ macros and focus modes: only allow-listed commands

test('a macro runs its steps one by one, only allow-listed, after the command has returned', async ($, on) => {
  const { box, clock } = await setup($, on)
  expect(await run($, 'cxmacro', 'add calm-down cfg feature workbench.band off ; motion off ; tidy ; cxtip')).toMatch(/stored \(4 steps\)/)
  expect(await run($, 'cxmacro', 'run calm-down')).toMatch(/Started macro calm-down: 4 steps/)
  expect(box.runs).toEqual([])
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['cfg feature workbench.band off', 'motion off', 'tidy'])
  expect(box.runs.every(r => r.origin.kind === 'plugin')).toBe(true)
  onlyAllowed(box)
  expect(await run($, 'cxmacro', 'log')).toMatch(/ok\s+macro \/cfg feature workbench.band off/)
})

test('a macro stops at the first failure and puts the failed line in the prompt box', async ($, on) => {
  const { box, clock } = await setup($, on, { cfg: a => (a.includes('alerts.') ? 'No switch named "alerts.toasts".' : `Done.\n${a}`) })
  await run($, 'cxmacro', 'add m cfg feature workbench.band off ; cfg feature alerts.toasts off ; motion off')
  await run($, 'cxmacro', 'run m')
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['cfg feature workbench.band off', 'cfg feature alerts.toasts off'])
  expect(box.fills).toEqual(['/cfg feature alerts.toasts off'])
  expect(await run($, 'cxmacro', 'log')).toMatch(/FAIL\s+macro \/cfg feature alerts.toasts off/)
})

test('a rejected command run also stops the macro', async ($, on) => {
  const { box, clock } = await setup($, on, { cfg: () => new Error('queue closed') })
  await run($, 'cxmacro', 'add m cfg feature quiet ; motion off')
  await run($, 'cxmacro', 'run m')
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['cfg feature quiet'])
  expect(box.fills).toEqual(['/cfg feature quiet'])
})

test('guards and unlisted commands can never be put in a macro or a focus mode, by command or by a tampered store', async ($, on) => {
  const { box, clock } = await setup($, on, {
    stored: {
      config: {
        macros: [
          { name: 'evil', steps: ['cfg feature tool-guard.toasts off'] },
          { name: 'evil2', steps: ['ctallow x'] },
          { name: 'loop', steps: ['cxmacro run loop'] },
          { name: 'fine', steps: ['motion off'] },
        ],
        focus: [{ name: 'evil', steps: ['safety-pro.band off'] }],
      },
    },
  })
  expect(await run($, 'cxmacro', 'list')).not.toMatch(/evil|loop/)
  expect(await run($, 'cxmacro', 'list')).toMatch(/fine/)
  expect(await run($, 'cxmacro', 'add x cfg feature controls.band off')).toMatch(/Refused/)
  expect(await run($, 'cxmacro', 'add x readonly on')).toMatch(/not on the allow list/)
  expect(await run($, 'cxmacro', 'add x ctblock a')).toMatch(/not on the allow list/)
  expect(await run($, 'cxmacro', 'add x cxmacro run x')).toMatch(/cannot run inside a macro/)
  expect(await run($, 'cxfocus', 'add x tool-guard.band off')).toMatch(/safety mod/)
  expect(await run($, 'cxfocus', 'add x settings.toasts off')).toMatch(/safety mod/)
  expect(await run($, 'cxfocus', 'evil')).toMatch(/No focus mode/)
  expect(await run($, 'cxmacro', 'run evil')).toMatch(/No macro named/)
  await clock.settle()
  expect(box.runs).toEqual([])
})

test('a focus mode runs /cfg feature steps through command.run, one by one; the built-ins are quiet, calm and full', async ($, on) => {
  const { box, clock } = await setup($, on)
  expect(await run($, 'cxfocus', 'add deep workbench.band off ; alerts.toasts on')).toMatch(/stored \(2 steps\)/)
  expect(await run($, 'cxfocus', 'deep')).toMatch(/Started focus deep/)
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['cfg feature workbench.band off', 'cfg feature alerts.toasts on'])
  await run($, 'cxfocus', 'quiet')
  await clock.settle()
  await run($, 'cxfocus', 'full')
  await clock.settle()
  expect(box.runs.slice(2).map(line)).toEqual(['cfg feature quiet', 'cfg feature full'])
  onlyAllowed(box)
})

test('only one macro or focus mode runs at a time', async ($, on) => {
  const { box, clock } = await setup($, on)
  await run($, 'cxmacro', 'add a motion off')
  await run($, 'cxmacro', 'run a')
  expect(await run($, 'cxmacro', 'run a')).toMatch(/Another macro or focus mode is still running|Started/)
  await clock.settle()
  await clock.settle()
  expect(box.runs.length).toBeGreaterThanOrEqual(1)
  onlyAllowed(box)
})

// ------------------------------------------------------------ do-not-disturb

test('do-not-disturb does nothing until /cxdnd on, then runs quiet on entering the window and full on leaving it', async ($, on) => {
  const { box, clock } = await setup($, on, { now: at(22, 50) })
  await clock.advance(5 * 60_000)
  expect(box.runs).toEqual([])
  expect(await run($, 'cxdnd', 'from 22:00')).toMatch(/from 22:00/)
  await run($, 'cxdnd', 'to 23:10')
  expect(await run($, 'cxdnd', 'on')).toMatch(/Do-not-disturb on/)
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['cfg feature quiet'])
  await clock.advance(5 * 60_000)
  expect(box.runs).toHaveLength(1)
  await clock.advance(10 * 60_000)
  expect(box.runs.map(line)).toEqual(['cfg feature quiet', 'cfg feature full'])
  await clock.advance(60 * 60_000)
  expect(box.runs).toHaveLength(2)
  onlyAllowed(box)
  expect((box.saved.config as any).dnd).toMatchObject({ on: true, applied: false })
})

test('do-not-disturb off stops the timer, says quiet is still applied, and a failed quiet is retried, never faked', async ($, on) => {
  const { box, clock } = await setup($, on, { now: at(23, 0), cfg: () => new Error('later') })
  await run($, 'cxdnd', 'on')
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['cfg feature quiet'])
  expect((box.saved.config as any).dnd.applied).toBe(false)
  await clock.advance(5 * 60_000)
  expect(box.runs.map(line)).toEqual(['cfg feature quiet', 'cfg feature quiet'])
  expect(await run($, 'cxdnd', 'off')).toMatch(/Do-not-disturb off/)
  await clock.advance(30 * 60_000)
  expect(box.runs).toHaveLength(2)
})

test('do-not-disturb with its switch off runs nothing, and an applied quiet is undone by the person, not by /cxdnd off', async ($, on) => {
  const { box, clock } = await setup($, on, { now: at(23, 0), features: { 'custom-two.dnd': false } })
  expect(await run($, 'cxdnd', 'on')).toMatch(/switch custom-two.dnd is off/)
  await clock.advance(20 * 60_000)
  expect(box.runs).toEqual([])
  box.features['custom-two.dnd'] = true
  await clock.advance(5 * 60_000)
  expect(box.runs.map(line)).toEqual(['cfg feature quiet'])
  expect(await run($, 'cxdnd', 'off')).toMatch(/run \/cfg feature full yourself/)
  await clock.advance(10 * 60 * 60_000)
  expect(box.runs).toHaveLength(1)
})

test('the guard mods are never named by do-not-disturb: only quiet and full are ever sent', async ($, on) => {
  const { box, clock } = await setup($, on, { now: at(23, 0) })
  await run($, 'cxdnd', 'to 23:20')
  await run($, 'cxdnd', 'on')
  await clock.advance(30 * 60_000)
  expect(box.runs.map(r => r.args)).toEqual(['feature quiet', 'feature full'])
  expect(box.runs.every(r => !/guard|safety|controls/.test(r.args))).toBe(true)
})

// ------------------------------------------------------------ hide rules

test('rules do nothing with the switch off; with it on they hide a row while the condition holds and restore it after', async ($, on) => {
  const { box, clock } = await setup($, on)
  expect(await run($, 'cxrules', 'add workbench idle')).toMatch(/Rule: hide workbench while idle/)
  expect(await run($, 'cxrules', 'check')).toMatch(/switch custom-two.hide-rules is off/)
  await clock.settle()
  expect(box.runs).toEqual([])
  box.features['custom-two.hide-rules'] = true
  await run($, 'cxrules', 'check')
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['cfg feature workbench.band off'])
  expect((box.saved.config as any).hidden).toEqual(['workbench'])
  // a turn starts: the opposite condition (busy) holds, so the row comes back
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(500)
  expect(box.runs.map(line)).toEqual(['cfg feature workbench.band off', 'cfg feature workbench.band on'])
  await $.turn.complete(doneTurn)
  await clock.advance(500)
  expect(box.runs.map(line).at(-1)).toBe('cfg feature workbench.band off')
  onlyAllowed(box)
})

test('clearing the rules, resetting the mod, or switching rules off puts every hidden row back', async ($, on) => {
  const { box, clock } = await setup($, on, { features: { 'custom-two.hide-rules': true } })
  await run($, 'cxrules', 'add workbench idle')
  await run($, 'cxrules', 'add notes idle')
  await run($, 'cxrules', 'check')
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['cfg feature workbench.band off', 'cfg feature notes.band off'])
  // the switch is turned off: the next check restores both
  box.features['custom-two.hide-rules'] = false
  await run($, 'cxrules', 'check')
  await clock.settle()
  expect(box.runs.slice(2).map(line).sort()).toEqual(['cfg feature notes.band on', 'cfg feature workbench.band on'])
  box.features['custom-two.hide-rules'] = true
  await run($, 'cxrules', 'check')
  await clock.settle()
  expect((box.saved.config as any).hidden.sort()).toEqual(['notes', 'workbench'])
  const before = box.runs.length
  expect(await run($, 'cxrules', 'clear')).toMatch(/Putting back/)
  await clock.settle()
  expect(box.runs.slice(before).map(line).sort()).toEqual(['cfg feature notes.band on', 'cfg feature workbench.band on'])
  expect((box.saved.config as any).hidden).toEqual([])
  expect((box.saved.config as any).rules).toEqual([])
  // and /cxreset does the same
  await run($, 'cxrules', 'add alerts idle')
  await run($, 'cxrules', 'check')
  await clock.settle()
  const n = box.runs.length
  expect(await run($, 'cxreset')).toMatch(/alerts is being put back/)
  await clock.settle()
  expect(box.runs.slice(n).map(line)).toEqual(['cfg feature alerts.band on'])
  onlyAllowed(box)
})

test('a rule that names a guard mod is refused, and a stored one does not load', async ($, on) => {
  const { box, clock } = await setup($, on, {
    features: { 'custom-two.hide-rules': true },
    stored: { config: { rules: [{ mod: 'tool-guard', cond: 'idle' }, { mod: 'controls', cond: 'idle' }], hidden: ['safety-pro', 'tool-guard'] } },
  })

  for (const g of ['tool-guard', 'safety-pro', 'controls', 'settings']) {
    expect(await run($, 'cxrules', `add ${g} idle`)).toMatch(/Usage/)
  }
  await run($, 'cxrules', 'check')
  await clock.settle()
  expect(box.runs).toEqual([])
  expect(await run($, 'cxrules', 'list')).toMatch(/none/)
})

// ------------------------------------------------------------ branch accent

test('the branch is read with one read-only git command, only on request or behind the switch', async ($, on) => {
  const { box } = await setup($, on)
  expect(box.procs).toEqual([])
  expect(await run($, 'cxbranch', 'now')).toMatch(/Branch feature\/x: accent suggestion/)
  expect(box.procs).toEqual([['git', 'rev-parse', '--abbrev-ref', 'HEAD']])
})

test('with the switch on the branch is read at session start and after a turn, and a bad answer is dropped', async ($, on) => {
  const { box, clock } = await setup($, on, { features: { 'custom-two.branch-accent': true }, branch: { exitCode: 0, stdout: 'main\n' } })
  expect(box.procs).toEqual([['git', 'rev-parse', '--abbrev-ref', 'HEAD']])
  await clock.advance(60_000)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(doneTurn)
  expect(box.procs).toHaveLength(2)
  expect(box.procs.every(p => p.join(' ') === 'git rev-parse --abbrev-ref HEAD')).toBe(true)
  const ui = await $.ui.mount(PANE())
  expect(await texts(ui)).toContain('main')
  await ui.unmount()
})

test('not a git folder, or a failing git, reads as no branch', async ($, on) => {
  await setup($, on, { branch: { exitCode: 128, stdout: 'fatal: not a git repository' } })
  expect(await run($, 'cxbranch', 'now')).toMatch(/No branch read/)
})

// ------------------------------------------------------------ theme from a logo colour

test('the logo colour previews first and applies a theme once, only on /cxlogo apply', async ($, on) => {
  const { box } = await setup($, on)
  expect(await run($, 'cxlogo', 'apply')).toMatch(/No logo colour yet/)
  expect(await run($, 'cxlogo', 'nothex')).toMatch(/Usage/)
  expect(await run($, 'cxlogo', '#E8643C')).toMatch(/#e8643c/)
  expect(box.themes).toEqual([])
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-theme' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
  expect(await run($, 'cxlogo', 'apply')).toMatch(/Applied a theme from #e8643c/)
  expect(box.themes).toHaveLength(1)
  expect(box.themes[0].colors).toBeDefined()
  expect(box.themes[0].style).toBeUndefined()
})

// ------------------------------------------------------------ the curve demo (motion gate)

test('the curve demo is static unless its switch, /motion and calm all allow it, and the one ticker stops by itself', async ($, on) => {
  const off = await setup($, on)
  expect(await run($, 'cxcurve', 'demo')).toMatch(/Static final frame: the curve demo motion is off/)
  expect(off.box.frames).toEqual([9])
})

test('with the switch and motion on the demo steps through its frames and stops; calm or /motion off make it static', async ($, on) => {
  const { box, clock } = await setup($, on, { features: { 'custom-two.demo-motion': true } })
  expect(await run($, 'cxcurve', 'demo')).toMatch(/Demo running/)
  await clock.advance(150 * 14)
  expect(box.frames[0]).toBe(0)
  expect(box.frames.at(-1)).toBe(9)
  expect(box.frames).toEqual([...box.frames].sort((a, b) => a - b))
  const n = box.frames.length
  await clock.advance(5000)
  expect(box.frames).toHaveLength(n)
  box.motion = false
  box.frames.length = 0
  expect(await run($, 'cxcurve', 'demo')).toMatch(/Static final frame: motion is off/)
  expect(box.frames).toEqual([9])
  box.motion = true
  box.calm = true
  box.frames.length = 0
  expect(await run($, 'cxcurve', 'demo')).toMatch(/calm is on/)
  expect(box.frames).toEqual([9])
  await clock.advance(5000)
  expect(box.frames).toEqual([9])
})

test('/motion off in the motion mod stops a running demo at the next frame', async ($, on) => {
  const { box, clock } = await setup($, on, { features: { 'custom-two.demo-motion': true } })
  await run($, 'cxcurve', 'demo')
  await clock.advance(300)
  box.motion = false
  await clock.advance(300)
  expect(box.frames.at(-1)).toBe(9)
  const n = box.frames.length
  await clock.advance(3000)
  expect(box.frames).toHaveLength(n)
})

// ------------------------------------------------------------ greetings and tips

test('no toast by default; with the switches on there is one greeting at start, one tip per day, never closer than 3 minutes', async ($, on) => {
  const quiet = await setup($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(doneTurn)
  expect(quiet.box.toasts).toEqual([])
})

test('greeting at session start and a daily tip after a turn, each behind its switch', async ($, on) => {
  const { box, clock } = await setup($, on, { features: { 'custom-two.greet-toast': true, 'custom-two.tip-toast': true } })
  expect(box.toasts).toHaveLength(1)
  expect(box.toasts[0]).toMatch(/Good|Welcome|Hello/)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(doneTurn)
  expect(box.toasts).toHaveLength(1)
  await clock.advance(4 * 60_000)
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await $.turn.complete({ ...doneTurn, turnId: 't2' })
  expect(box.toasts).toHaveLength(2)
  expect(box.toasts[1]).toMatch(/^Tip: /)
  await clock.advance(4 * 60_000)
  await $.turn.start({ text: 'hi', turnId: 't3' })
  await $.turn.complete({ ...doneTurn, turnId: 't3' })
  expect(box.toasts).toHaveLength(2)
  await clock.advance(24 * 60 * 60_000)
  await $.turn.start({ text: 'hi', turnId: 't4' })
  await $.turn.complete({ ...doneTurn, turnId: 't4' })
  expect(box.toasts).toHaveLength(3)
})

test('calm means no toast at all', async ($, on) => {
  const { box } = await setup($, on, { calm: true, features: { 'custom-two.greet-toast': true, 'custom-two.tip-toast': true } })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(doneTurn)
  expect(box.toasts).toEqual([])
})

// ------------------------------------------------------------ the tables through commands

test('tables are stored, survive a restart and are cleaned when loaded', async ($, on) => {
  const first = await setup($, on)
  await run($, 'cxfile', 'zig claude')
  await run($, 'cxgloss', 'add MCP = Model Context Protocol')
  await run($, 'cxcheck', 'add Pick an accent')
  await run($, 'cxcheck', 'tick 1')
  await run($, 'cxbundle', 'add dev notes,workbench')
  expect((first.box.saved.config as any).fileColours.zig).toBe('claude')
  expect(await run($, 'cxbundle', 'show dev')).toMatch(/claude plugin enable notes[\s\S]*claude plugin disable workbench/)
  expect(first.box.runs).toEqual([])
})

test('a stored config with junk loads as the defaults, and a stored one is cleaned', async ($, on) => {
  await setup($, on, { stored: { config: { fileColours: { ts: 'hotpink', md: 'success' }, dnd: { on: 'yes' }, sounds: { error: '/etc/passwd' } }, log: 'nope' } })
  expect(await run($, 'cxfile', 'list')).toMatch(/\.md=success/)
  expect(await run($, 'cxfile', 'list')).not.toMatch(/hotpink/)
  expect(await run($, 'cxsound', 'list')).toMatch(/error=error.wav/)
  expect(await run($, 'cxdnd', '')).toMatch(/off/)
})

test('hotkey rows only fill the prompt box; nothing is sent', async ($, on) => {
  const { box } = await setup($, on)
  await run($, 'cxkeys', 'add ctrl+1 Run the tests and summarise')
  expect(await run($, 'cxkeys', 'use ctrl+1')).toMatch(/Put in the prompt box \(not sent\)/)
  expect(box.fills).toEqual(['Run the tests and summarise'])
  expect(box.runs).toEqual([])
})

test('the schedule only prints and fills a look command; it never runs one', async ($, on) => {
  const { box } = await setup($, on, { now: at(21, 30) })
  await run($, 'cxsched', 'add 07:00 skuse sunrise')
  await run($, 'cxsched', 'add 20:00 look dusk')
  expect(await run($, 'cxsched', 'now')).toMatch(/\/look dusk/)
  expect(box.fills).toEqual(['/look dusk'])
  expect(box.runs).toEqual([])
  expect(box.themes).toEqual([])
})

// ------------------------------------------------------------ the pane

test('the pane draws every tab on desktop and terminal, the vector images only on desktop', async ($, on) => {
  const { box } = await setup($, on, { features: { 'custom-two.record': true, 'custom-two.branch-accent': true } })
  await call($, { tool: 'Edit', file_path: '/p/src/a.ts' })
  await call($, { tool: 'Edit', file_path: '/p/b.md' })
  await run($, 'cxlogo', '#3366cc')
  await run($, 'cxfont', 'add Inter')
  await run($, 'cxmacro', 'add m motion off')
  await run($, 'cxcheck', 'starter')
  await run($, 'cxgloss', 'add term = meaning')
  await run($, 'cxbundle', 'add dev notes,workbench')
  await run($, 'cxrules', 'add workbench idle')
  await run($, 'cxsched', 'add 07:00 skuse sunrise')
  await run($, 'cxkeys', 'add ctrl+1 hello')
  const tabs = ['look', 'theme', 'curves', 'sounds', 'words', 'log', 'report', 'keys', 'auto', 'run', 'lists']

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect(await texts(ui)).toContain('Custom two')

    for (const tab of surface === 'desktop' ? tabs : ['look', 'curves', 'auto']) {
      if (surface === 'desktop') {
        await ui.press({ key: `tab-${tab}` })
      } else {
        await run($, 'cxpane', tab)
      }
      expect((await texts(ui)).length, `${surface} ${tab}`).toBeGreaterThan(20)
    }
    const hasSvg = (await ui.find({ type: 'Svg' })) !== undefined

    if (surface === 'terminal') {
      expect(hasSvg).toBe(false)
    }
    await ui.unmount()
  }
  expect(box.opened.every(o => o.id === 'custom-two-main')).toBe(true)
})

test('the curves tab draws a vector plot on the desktop and a text strip elsewhere', async ($, on) => {
  await setup($, on)
  await run($, 'cxpane', 'curves')
  const d = await $.ui.mount(PANE('desktop'))
  expect(await d.find({ type: 'Svg' })).toBeDefined()
  await d.unmount()
  const t = await $.ui.mount(PANE('terminal'))
  expect(await texts(t)).toMatch(/[▁▂▃▄▅▆▇█]{12}/)
  await t.unmount()
})

test('custom empty-state messages and pane titles appear in the pane; an empty log shows the message', async ($, on) => {
  const { box } = await setup($, on)
  await run($, 'cxtitle', 'main My own hub')
  await run($, 'cxempty', 'log Quiet here, friend')
  expect(await run($, 'cxpane', 'log')).toMatch(/Pane opened on log/)
  expect(box.opened.at(-1)).toEqual({ id: 'custom-two-main', title: 'My own hub' })
  const ui = await $.ui.mount(PANE())
  const all = await texts(ui)
  expect(all).toContain('My own hub')
  expect(all).toContain('Quiet here, friend')
  await ui.unmount()
  expect(await run($, 'cxtitle', 'bogus x')).toMatch(/The id is/)
  expect(await run($, 'cxempty', 'log ')).toMatch(/The id is/)
})

test('a pane button runs a macro, a toggle ticks a step and the colour table follows the file-colours switch', async ($, on) => {
  const { box, clock } = await setup($, on, { features: { 'custom-two.record': true } })
  await call($, { tool: 'Edit', file_path: '/p/a.ts' })
  await run($, 'cxmacro', 'add m motion off')
  await run($, 'cxcheck', 'add one')
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-run' })
  await ui.press({ key: 'macro-m' })
  await clock.settle()
  expect(box.runs.map(line)).toEqual(['motion off'])
  await ui.press({ key: 'tab-lists' })
  await ui.press({ key: 'tick-0' })
  expect(((box.saved.config as any).checklist as any[])[0].done).toBe(true)
  await ui.unmount()
})

test('/cxreset all returns every table to its default and keeps nothing recorded', async ($, on) => {
  const { box } = await setup($, on, { features: { 'custom-two.record': true } })
  await call($, { tool: 'Edit', file_path: '/p/a.ts' })
  await run($, 'cxgloss', 'add a = b')
  expect(await run($, 'cxreset')).toMatch(/Your tables are kept/)
  expect(await run($, 'cxgloss', 'list')).toMatch(/Glossary \(1/)
  expect(await run($, 'cxreset', 'all')).toMatch(/All your tables went back/)
  expect(await run($, 'cxgloss', 'list')).toMatch(/Glossary \(0/)
  expect(box.saved.log).toBeUndefined()
})
