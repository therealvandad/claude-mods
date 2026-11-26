import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import type { Gauge, Run, SummaryItem } from '../types'
import {
  AWAY_MS,
  BREATH_MAX_MS,
  CHEER_MS,
  POP_MS,
  RIPPLE_MS,
  barOf,
  blendColor,
  breathFrame,
  confettiFrame,
  fmtSpend,
  popFrame,
  ringBar,
  ringGlyph,
  rippleFrame,
  shimmerFrame,
  springIsLive,
  springStep,
  staggerLife,
  staggerShown,
  statusFrame,
  statusStatic,
  toneOf,
} from './frames'
import { gaugeDone, gaugeIsLive, gaugeSettle, gaugeTo, gaugeValue } from './gauge'

type Dollar = Parameters<Hook<'session.start'>>[0]

// ---- state the drawings read ------------------------------------------------
// `now` is written by the one shared ticker, and only while something animates.
// A render reads it only on the branch that is animating, so settled UI never redraws.
const nowA = atom({ plugin: 'motion', key: 'now' } as const, 0)
const isOnA = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const gauges = atom({ plugin: 'motion', key: 'gauges' } as const, {}, { shape: 'gauges-1' })
const ring = atom({ plugin: 'motion', key: 'ring' } as const, { pos: 0, vel: 0, target: 0 }, { shape: 'ring-1' })
const timer = atom({ plugin: 'motion', key: 'timer' } as const, null, { shape: 'timer-1' })
const runs = atom({ plugin: 'motion', key: 'runs' } as const, {}, { shape: 'runs-1' })
const pulse = atom({ plugin: 'motion', key: 'pulse' } as const, { until: 0, tool: '' }, { shape: 'pulse-1' })
const away = atom({ plugin: 'motion', key: 'away' } as const, null, { shape: 'away-1' })
const summary = atom({ plugin: 'motion', key: 'summary' } as const, null, { shape: 'summary-1' })
const ripple = atom({ plugin: 'motion', key: 'ripple' } as const, { at: 0, key: '' }, { shape: 'ripple-1' })

// ---- module state the drawings never read -----------------------------------
const FAST_MS = 100
const SLOW_MS = 500
const PULSE_LIVE_MS = 700
const TIMER_STEPS = 16
const STALE_RUN_MS = 10 * 60_000
const MAX_RUNS = 80
const TESTS =
  /\b(npm (run )?test|npm t|yarn test|pnpm test|bun test|jest|vitest|pytest|mocha|cargo test|go test|rspec|phpunit|dotnet test|mvn test|gradle test|make test)\b/

let motionOn = true
let ticker: Timer | undefined
let tickerMs = 0
let isBusy = false
let awayTimer: Timer | undefined
let summaryTimer: Timer | undefined
let ringStepTimer: Timer | undefined
let ringClearTimer: Timer | undefined
let staticClear: Timer | undefined
let entry: { text: string; at: number } | undefined
let painted: string | undefined
let turnTools: Record<string, number> = {}

// ---- the one shared ticker ----------------------------------------------------
// It starts when something needs frames and stops itself when nothing does.
const setTicker = ($: Dollar, ms: number) => {
  if (ticker !== undefined && tickerMs === ms) {
    return
  }
  ticker?.cancel()
  tickerMs = ms
  ticker = $.clock.every(ms, () => {
    void step($)
  })
}

/** Ask for frames: never slows a faster ticker, never runs with motion off. */
const ensureTicker = ($: Dollar, ms = FAST_MS) => {
  if (!motionOn || (ticker !== undefined && tickerMs <= ms)) {
    return
  }
  setTicker($, ms)
}

const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
  tickerMs = 0
}

const paintStatus = ($: Dollar, t: number) => {
  if (entry === undefined) {
    return
  }
  const text = statusFrame(entry.text, t - entry.at)

  if (text === undefined) {
    entry = undefined
    painted = undefined
    $.ui.status(undefined)

    return
  }

  if (text !== painted) {
    painted = text
    $.ui.status(text)
  }
}

/** What the ticker must do now: 'fast' while anything animates, 'slow' for breathing alone, else 'none'. */
const needOf = async ($: Dollar): Promise<'fast' | 'slow' | 'none'> => {
  const isFast =
    entry !== undefined ||
    Object.values(await read($, gauges)).some(gaugeIsLive) ||
    springIsLive(await read($, ring)) ||
    (await read($, pulse)).until > 0 ||
    Object.values(await read($, runs)).some(r => r.doneAt === 0 || r.popUntil > 0 || r.cheerUntil > 0) ||
    ((await read($, summary))?.live ?? false) ||
    (await read($, ripple)).at > 0

  if (isFast) {
    return 'fast'
  }

  return (await read($, away))?.breathing === true ? 'slow' : 'none'
}

const step = async ($: Dollar) => {
  if (isBusy) {
    return
  }
  isBusy = true

  try {
    const prev = await read($, nowA)
    const t = await $.clock.now()
    await update($, nowA, () => t)
    const dt = prev > 0 ? Math.min(200, Math.max(1, t - prev)) : FAST_MS

    const g = await read($, gauges)

    if (Object.values(g).some(x => gaugeIsLive(x) && gaugeDone(x, t))) {
      await update($, gauges, m =>
        Object.fromEntries(Object.entries(m).map(([k, x]) => [k, gaugeIsLive(x) && gaugeDone(x, t) ? gaugeSettle(x) : x])),
      )
    }

    if (springIsLive(await read($, ring))) {
      await update($, ring, r => springStep(r, dt))
    }
    const p = await read($, pulse)

    if (p.until > 0 && p.until <= t) {
      await update($, pulse, () => ({ until: 0, tool: p.tool }))
    }
    const rs = await read($, runs)
    const isExpired = (r: Run) =>
      (r.popUntil > 0 && r.popUntil <= t) ||
      (r.cheerUntil > 0 && r.cheerUntil <= t) ||
      (r.doneAt === 0 && t - r.startedAt > STALE_RUN_MS)

    if (Object.values(rs).some(isExpired)) {
      await update($, runs, m =>
        Object.fromEntries(
          Object.entries(m).map(([k, r]): [string, Run] => [
            k,
            isExpired(r)
              ? {
                  ...r,
                  doneAt: r.doneAt === 0 ? t : r.doneAt,
                  popUntil: r.popUntil <= t ? 0 : r.popUntil,
                  cheerUntil: r.cheerUntil <= t ? 0 : r.cheerUntil,
                }
              : r,
          ]),
        ),
      )
    }
    const s = await read($, summary)

    if (s !== null && s.live && t - s.at >= staggerLife(s.items.length)) {
      await update($, summary, x => (x === null ? x : { ...x, live: false }))
    }
    const rp = await read($, ripple)

    if (rp.at > 0 && t - rp.at >= RIPPLE_MS) {
      await update($, ripple, () => ({ at: 0, key: rp.key }))
    }
    const a = await read($, away)

    if (a !== null && a.breathing && t - a.at >= BREATH_MAX_MS) {
      await update($, away, x => (x === null ? x : { ...x, breathing: false }))
    }
    paintStatus($, t)

    const need = await needOf($)

    if (need === 'none') {
      stopTicker()
    } else {
      setTicker($, need === 'fast' ? FAST_MS : SLOW_MS)
    }
  } finally {
    isBusy = false
  }
}

// ---- eased numbers (28, 29, 36) ---------------------------------------------
const retarget = async ($: Dollar, key: string, to: number, t: number) => {
  let isChanged = false

  await update($, gauges, m => {
    const old = m[key]

    if (old !== undefined && old.to === to) {
      return m
    }
    isChanged = old !== undefined
    const next: Gauge = gaugeTo(old, to, t, motionOn)

    return { ...m, [key]: next }
  })

  if (isChanged) {
    ensureTicker($)
  }
}

const refreshUsage = async ($: Dollar) => {
  const usage = await $.session.usage()
  const t = await $.clock.now()

  if (usage.context.percent !== undefined && usage.context.percent !== null) {
    await retarget($, 'ctx', usage.context.percent, t)
  }

  if (usage.cost?.usd !== undefined) {
    await retarget($, 'spend', usage.cost.usd, t)
  }
}

// ---- status line entry (30, 32, 33) -------------------------------------------
const showStatus = ($: Dollar, text: string, t: number) => {
  staticClear?.cancel()

  if (motionOn) {
    entry = { text, at: t }
    painted = undefined
    paintStatus($, t)
    ensureTicker($)

    return
  }
  entry = undefined
  $.ui.status(statusStatic(text))
  staticClear = $.clock.after(3000, () => $.ui.status(undefined))
}

// ---- idle breathing (39) -----------------------------------------------------
const armAway = ($: Dollar) => {
  awayTimer?.cancel()
  awayTimer = $.clock.after(AWAY_MS, () => {
    void goAway($)
  })
}

const goAway = async ($: Dollar) => {
  const t = await $.clock.now()
  await update($, away, () => ({ at: t, breathing: motionOn }))
  await update($, nowA, () => t)
  ensureTicker($, SLOW_MS)
}

/** The user (or the model) did something: not away, and the idle clock starts again. */
const wake = async ($: Dollar) => {
  if ((await read($, away)) !== null) {
    await update($, away, () => null)
  }
  armAway($)
}

// ---- spring timer ring (40) ----------------------------------------------------
const startTimer = async ($: Dollar, minutes: number) => {
  ringStepTimer?.cancel()
  ringClearTimer?.cancel()
  const t = await $.clock.now()
  const totalMs = Math.round(minutes * 60_000)
  const stepMs = Math.max(1000, Math.round(totalMs / TIMER_STEPS))
  await update($, timer, () => ({ startAt: t, totalMs, stepMs, k: 0, steps: TIMER_STEPS, label: 'Timer' }))
  // The ring starts empty and springs up to full, then drains one step at a time.
  await update($, ring, () => ({ pos: motionOn ? 0 : 1, vel: 0, target: 1 }))
  ensureTicker($)
  ringStepTimer = $.clock.after(stepMs, () => {
    void advanceTimer($)
  })
}

const advanceTimer = async ($: Dollar) => {
  const tm = await read($, timer)

  if (tm === null) {
    return
  }
  const k = tm.k + 1
  const target = Math.max(0, 1 - k / tm.steps)
  await update($, timer, () => ({ ...tm, k }))
  await update($, ring, r => (motionOn ? { ...r, target } : { pos: target, vel: 0, target }))
  ensureTicker($)

  if (k >= tm.steps) {
    $.ui.toast('Timer finished', { timeoutMs: 6000 })
    ringClearTimer = $.clock.after(8000, () => {
      void stopTimer($)
    })

    return
  }
  ringStepTimer = $.clock.after(tm.stepMs, () => {
    void advanceTimer($)
  })
}

const stopTimer = async ($: Dollar) => {
  ringStepTimer?.cancel()
  ringClearTimer?.cancel()
  await update($, timer, () => null)
  await update($, ring, () => ({ pos: 0, vel: 0, target: 0 }))
}

// ---- the reduced-motion switch (41) --------------------------------------------
/** Every animation ends at its final value. */
const settleAll = async ($: Dollar) => {
  stopTicker()
  await update($, gauges, m => Object.fromEntries(Object.entries(m).map(([k, x]) => [k, gaugeSettle(x)])))
  await update($, ring, r => ({ pos: r.target, vel: 0, target: r.target }))
  await update($, pulse, p => ({ until: 0, tool: p.tool }))
  await update($, runs, m =>
    Object.fromEntries(Object.entries(m).map(([k, r]): [string, Run] => [k, { ...r, popUntil: 0, cheerUntil: 0 }])),
  )
  await update($, summary, s => (s === null ? s : { ...s, live: false }))
  await update($, ripple, r => ({ at: 0, key: r.key }))
  await update($, away, a => (a === null ? a : { ...a, breathing: false }))

  if (entry !== undefined) {
    const text = entry.text
    entry = undefined
    painted = undefined
    showStatus($, text, 0)
  }
}

const setMotion = async ($: Dollar, isOn: boolean) => {
  motionOn = isOn
  await $.store.set('motion', isOn)
  await update($, isOnA, () => isOn)

  if (!isOn) {
    await settleAll($)

    return
  }
  const a = await read($, away)

  if (a !== null) {
    const t = await $.clock.now()
    await update($, away, () => ({ at: t, breathing: true }))
    ensureTicker($, SLOW_MS)
  }
}

const isStoredOn = (saved: unknown) => saved !== false && saved !== 'off' && saved !== 0

// ---- demo (replays the entry animations) --------------------------------------
const SAMPLE: SummaryItem[] = [
  { tool: 'Bash', count: 3 },
  { tool: 'Edit', count: 2 },
  { tool: 'Read', count: 4 },
]

const playDemo = async ($: Dollar) => {
  if (!motionOn) {
    return false
  }
  const t = await $.clock.now()
  await update($, nowA, () => t)
  await update($, gauges, m =>
    Object.fromEntries(Object.entries(m).map(([k, x]) => [k, { from: 0, to: x.to, at: t }])),
  )
  await update($, pulse, () => ({ until: t + PULSE_LIVE_MS, tool: 'demo' }))
  await update($, ring, r => ({ pos: 0, vel: 0, target: r.target }))
  await update($, summary, () => ({ at: t, items: SAMPLE, live: true }))
  summaryTimer?.cancel()
  summaryTimer = $.clock.after(6000, () => {
    void update($, summary, () => null)
  })
  showStatus($, 'motion demo: typing, pulse, odometer, spring', t)
  ensureTicker($)

  return true
}

const ripplePress = async ($: Dollar, key: string) => {
  if (!motionOn) {
    return
  }
  const t = await $.clock.now()
  await update($, nowA, () => t)
  await update($, ripple, () => ({ at: t, key }))
  ensureTicker($)
}

// ---- small helpers -----------------------------------------------------------
const detailOf = (input: Record<string, unknown>) =>
  String(input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 36)

const looksFailed = (output: unknown) => {
  const o = output as { stdout?: string; stderr?: string } | undefined

  return /\b[1-9]\d*\s+(failed|failing|errors?)\b/i.test(`${o?.stdout ?? ''}\n${o?.stderr ?? ''}`)
}

const trimRuns = (m: Record<string, Run>): Record<string, Run> => {
  const all = Object.entries(m)

  return all.length <= MAX_RUNS
    ? m
    : Object.fromEntries(all.sort((a, b) => a[1].startedAt - b[1].startedAt).slice(all.length - MAX_RUNS))
}

const finishRun = async ($: Dollar, id: string) => {
  const t = await $.clock.now()
  await update($, runs, m => {
    const r = m[id]

    return r === undefined
      ? m
      : {
          ...m,
          [id]: {
            ...r,
            doneAt: t,
            popUntil: motionOn ? t + POP_MS : 0,
            cheerUntil: motionOn && r.isTest ? t + CHEER_MS : 0,
          },
        }
  })
  ensureTicker($)
  await refreshUsage($)
}

const stateText = () =>
  `Motion is ${motionOn ? 'on' : 'off'}. Usage: /motion on | off | demo | timer <minutes> | timer off`

// ---- the mod -----------------------------------------------------------------
export const register: Register = on => {
  // This mod's own section in the shared "Mod manager" settings panel.
  on('ui.render', { component: 'Pane', plugin: '*', requestId: 'mod-settings' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const moving = await read($, isOnA)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="column" marginTop="md">
          <Text weight="bold">Animation (motion)</Text>
          <Box gap="sm" flexWrap="wrap">
            <Button key="mo-on" label={`Motion: ${moving ? 'on' : 'off'}`} onPress={() => setMotion($, !moving)} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('session.start', async ($, e, next) => {
    motionOn = isStoredOn(await $.store.get('motion'))
    await update($, isOnA, () => motionOn)
    await $.command
      .register({ name: 'motion', description: 'Motion on/off: /motion on|off|demo|timer <minutes>' })
      .catch(() => undefined)
    const t = await $.clock.now()
    await update($, nowA, () => t)
    await refreshUsage($)
    armAway($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    turnTools = {}
    summaryTimer?.cancel()
    await update($, summary, () => null)
    await wake($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const t = await $.clock.now()
    const id = e.tool_use_id ?? `${e.tool}-${t}`
    const isTest = e.tool === 'Bash' && TESTS.test(String(input.command ?? ''))
    turnTools[e.tool] = (turnTools[e.tool] ?? 0) + 1
    await wake($)
    await update($, runs, m =>
      trimRuns({ ...m, [id]: { tool: e.tool, startedAt: t, doneAt: 0, isTest, popUntil: 0, cheerUntil: 0 } }),
    )
    await retarget($, 'calls', ((await read($, gauges)).calls?.to ?? 0) + 1, t)
    await update($, pulse, () => ({ until: motionOn ? t + PULSE_LIVE_MS : 0, tool: e.tool }))
    const detail = detailOf(input)
    showStatus($, detail === '' ? e.tool : `${e.tool}: ${detail}`, t)
    ensureTicker($)

    try {
      return await next(e)
    } finally {
      await finishRun($, id).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await refreshUsage($)
    const items = Object.entries(turnTools)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tool, count]): SummaryItem => ({ tool, count }))

    if (items.length > 0) {
      const t = await $.clock.now()
      await update($, summary, () => ({ at: t, items, live: motionOn }))
      summaryTimer?.cancel()
      summaryTimer = $.clock.after(15_000, () => {
        void update($, summary, () => null)
      })
      ensureTicker($)
    }
    armAway($)

    return next(e)
  })

  on('command.run', { command: 'motion' }, async ($, e) => {
    const [word = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)

    if (word === 'on' || word === 'off') {
      await setMotion($, word === 'on')

      return { text: `Motion ${word}. Every animation ${word === 'on' ? 'runs' : 'is stopped and shows its final value'}.` }
    }

    if (word === 'demo') {
      return { text: (await playDemo($)) ? 'Playing the motion demo.' : 'Motion is off. Run /motion on first.' }
    }

    if (word === 'timer') {
      if (arg === 'off' || arg === 'stop') {
        await stopTimer($)

        return { text: 'Timer ring cleared.' }
      }
      const minutes = Number(arg === '' ? 5 : arg)

      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
        return { text: 'Usage: /motion timer <minutes> or /motion timer off' }
      }
      await startTimer($, minutes)

      return { text: `Timer ring started: ${minutes} min.` }
    }

    return { text: stateText() }
  })

  // The band above the prompt: eased gauges, tickers, spring ring, staggered
  // turn summary, idle breathing, and the press chips. It composes: the rows of
  // other mods stay (`await next(e)`).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const isOn = await read($, isOnA)
    const g = await read($, gauges)
    const tm = await read($, timer)
    const r = await read($, ring)
    const a = await read($, away)
    const sm = await read($, summary)
    const p = await read($, pulse)
    const rp = await read($, ripple)
    const isAnimating =
      isOn &&
      (Object.values(g).some(gaugeIsLive) ||
        springIsLive(r) ||
        p.until > 0 ||
        (sm?.live ?? false) ||
        rp.at > 0 ||
        (a?.breathing ?? false))
    const t = isAnimating ? await read($, nowA) : 0
    const val = (x: Gauge | undefined) =>
      x === undefined ? undefined : isOn && gaugeIsLive(x) ? gaugeValue(x, t) : x.to
    const ctx = val(g.ctx)
    const spend = val(g.spend)
    const calls = val(g.calls)
    const isPulse = isOn && p.until > 0
    const ripples = (key: string) => (isOn && rp.at > 0 && rp.key === key ? rippleFrame(t - rp.at) : undefined)
    const shownItems = sm === null ? 0 : sm.live && isOn ? staggerShown(t - sm.at, sm.items.length) : sm.items.length
    const { Box, Button, Text } = $.ui.resolve(e)
    const motionChip = ripples('motion')
    const demoChip = ripples('demo')

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box gap={2}>
          {ctx !== undefined && (
            <Box gap={1}>
              <Text dimColor>ctx</Text>
              <Text color={isOn ? blendColor(ctx) : toneOf(ctx)}>{barOf(ctx)}</Text>
              <Text tabular>{Math.round(ctx)}%</Text>
            </Box>
          )}
          {spend !== undefined && (
            <Text tabular dimColor={!isPulse}>
              {fmtSpend(spend)}
            </Text>
          )}
          {calls !== undefined && (
            <Text tabular dimColor={!isPulse} color={isPulse ? 'suggestion' : undefined} weight={isPulse ? 'bold' : 'regular'}>
              {isPulse ? '▸ ' : ''}
              {Math.round(calls)} calls
            </Text>
          )}
          {tm !== null && (
            <Text tabular>
              {ringGlyph(r.pos)} {ringBar(r.pos)} {tm.k >= tm.steps ? 'done' : `~${Math.ceil(((tm.steps - tm.k) * tm.stepMs) / 60_000)}m`}
            </Text>
          )}
          <Button
            key="motion-chip"
            label={`${motionChip === undefined ? '' : `${motionChip} `}motion ${isOn ? 'on' : 'off'}`}
            dimColor
            onPress={() => {
              void ripplePress($, 'motion').then(() => setMotion($, !isOn))
            }}
          />
          {isOn && (
            <Button
              key="demo-chip"
              label={`${demoChip === undefined ? '' : `${demoChip} `}demo`}
              dimColor
              onPress={() => {
                void ripplePress($, 'demo').then(() => playDemo($))
              }}
            />
          )}
        </Box>
        {sm !== null && shownItems > 0 && (
          <Box flexDirection="column">
            <Text dimColor>this turn</Text>
            {sm.items.slice(0, shownItems).map((it, i) => {
              const isEntering = isOn && sm.live && i === shownItems - 1

              return (
                <Text dimColor={!isEntering} color={isEntering ? 'suggestion' : undefined}>
                  {isEntering ? '›' : ' '} {it.tool} ×{it.count}
                </Text>
              )
            })}
          </Box>
        )}
        {a !== null && !e.props.isWorking && (
          <Box>
            {isOn && a.breathing ? (
              <Box gap={0}>
                {breathFrame(t).map(c => (
                  <Text dimColor={!c.isBright}>{c.glyph}</Text>
                ))}
                <Text dimColor> idle</Text>
              </Box>
            ) : (
              <Text dimColor>◦ idle</Text>
            )}
          </Box>
        )}
      </Box>
    )
  })

  // Under a tool row: a shimmer while it runs (34), the check mark's pop when
  // it finishes (35), and a spark row when a test command passes (42).
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const run = (await read($, runs))[e.props.tool_use_id]

    if (run === undefined) {
      return next(e)
    }
    const isOn = await read($, isOnA)
    const isRunning = e.props.isRunning
    const isOk = !e.props.isErrored && !e.props.isInterrupted && !looksFailed(e.props.output)
    const isPop = !isRunning && isOn && run.popUntil > 0
    const isCheer = !isRunning && isOn && run.cheerUntil > 0
    const isShimmer = isRunning && isOn
    const isStaticPass = !isRunning && run.isTest && isOk && !isCheer

    if (!isShimmer && !isPop && !isCheer && !isStaticPass) {
      return next(e)
    }
    const t = isShimmer || isPop || isCheer ? await read($, nowA) : 0
    const { Box, Text } = $.ui.resolve(e)
    const [before, hot, after] = shimmerFrame(t)
    const pop = popFrame(t - run.doneAt, isOk)

    return (
      <Box flexDirection="column">
        {await next(e)}
        {isShimmer && (
          <Box>
            <Text dimColor>{before}</Text>
            <Text color="claude">{hot}</Text>
            <Text dimColor>{after}</Text>
          </Box>
        )}
        {isPop && !(run.isTest && isOk && isCheer) && (
          <Text color={isOk ? 'success' : 'error'} weight={pop.isStrong ? 'bold' : 'regular'}>
            {pop.glyph}
          </Text>
        )}
        {run.isTest && isOk && !isRunning && (
          <Text color="success" weight={isCheer ? 'bold' : 'regular'} dimColor={!isCheer}>
            {isCheer ? `${pop.glyph} ${confettiFrame(t)} tests passed ${confettiFrame(t + 450)}` : '✓ tests passed'}
          </Text>
        )}
      </Box>
    )
  })
}
