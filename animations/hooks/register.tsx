import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import type { Cell } from '../types'
import {
  BADGE_MAX,
  BADGE_MS,
  BELT,
  CONFETTI_MS,
  COIN_MS,
  DEMO_MS,
  INK_MS,
  SAMPLE_SERIES,
  SHAKE_MS,
  SLIDE_SPAN,
  SPARK_MS,
  TAB_MS,
  AMBIENT_LABELS,
  ambientColor,
  ambientLevel,
  ambientRatio,
  badgeFrame,
  clockText,
  coinRow,
  commitSucceeded,
  confettiFrame,
  conveyorFrame,
  demoView,
  ecgLine,
  flipFrame,
  fmtClock,
  groupRuns,
  heartFrame,
  hourOf,
  inkFrame,
  secsLeft,
  shakeText,
  shimmerBar,
  shortPath,
  skyAxis,
  skyCells,
  sparkReveal,
  tankMini,
  tankRows,
  toneOf,
  underlineFrame,
  waveLine,
} from './frames'

type Dollar = Parameters<Hook<'session.start'>>[0]

// ---- state --------------------------------------------------------------------
// Global reduced-motion switch, owned by the `motion` mod (`/motion on|off`).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)

// `now` is written by the one shared ticker, only while something animates. Every
// frame is a pure function of `now` and an event stamp (`at`, 0 = none), so settled UI never redraws.
const nowA = atom({ plugin: 'animations', key: 'now' } as const, 0)
const busyA = atom({ plugin: 'animations', key: 'busy' } as const, false)
const labA = atom({ plugin: 'animations', key: 'lab' } as const, false)
const outcomesA = atom({ plugin: 'animations', key: 'outcomes' } as const, '')
const revealA = atom({ plugin: 'animations', key: 'reveal' } as const, 0)
const usageA = atom({ plugin: 'animations', key: 'usage' } as const, { ctx: 0, spend: 0, isKnown: false }, { shape: 'usage-1' })
const histA = atom({ plugin: 'animations', key: 'hist' } as const, { spend: [], ctx: [] }, { shape: 'hist-1' })
const coinA = atom({ plugin: 'animations', key: 'coin' } as const, { at: 0, delta: 0 }, { shape: 'coin-1' })
const shakeA = atom({ plugin: 'animations', key: 'shake' } as const, { at: 0, text: '' }, { shape: 'shake-1' })
const confettiA = atom({ plugin: 'animations', key: 'confetti' } as const, { at: 0, seed: 1 }, { shape: 'confetti-1' })
const tabA = atom({ plugin: 'animations', key: 'tab' } as const, { sel: 0, from: 0, at: 0 }, { shape: 'tab-1' })
const timerA = atom({ plugin: 'animations', key: 'timer' } as const, null, { shape: 'timer-1' })
const badgeA = atom({ plugin: 'animations', key: 'badge' } as const, null, { shape: 'badge-1' })
const loadingA = atom({ plugin: 'animations', key: 'loading' } as const, { ids: [] }, { shape: 'loading-1' })
const cellsA = atom({ plugin: 'animations', key: 'cells' } as const, [], { shape: 'cells-1' })
const editsA = atom({ plugin: 'animations', key: 'edits' } as const, [], { shape: 'edits-1' })
const demoA = atom({ plugin: 'animations', key: 'demo' } as const, null, { shape: 'demo-1' })

// ---- bounds and cadence -------------------------------------------------------
const FAST_MS = 100
const SLOW_MS = 250
const HIST_MAX = 40
const CELLS_MAX = 24
const EDITS_MAX = 8
const OUTCOMES_MAX = 20
const STALE_RUN_MS = 10 * 60_000
const STALE_BUSY_MS = 30 * 60_000
const HOLD_MS = 3000
const LOADING_MS = 2500
const LAB = 'animations-lab'
const TABS = ['Live', 'Events', 'More'] as const
const TAB_CELL = 12

const PIECES = [
  '1 heartbeat dot: pulses while a turn runs, flat dash when idle',
  '2 context tank: fills with context %, wavy surface',
  '3 coin drop: a $ falls over the spend figure when cost rises',
  '4 sparkline draw-in: spend/context sparklines reveal over 600 ms (lab opens)',
  '5 tab underline slide: lab tab strip, the underline glides to the pressed tab',
  '6 shake on error: status text jitters for 400 ms when a tool call errors',
  '7 confetti on commit: 1.5 s burst when a Bash `git commit` succeeds',
  '8 flip-clock timer: /anim timer <minutes>, digits flip when they change',
  '9 badge unlock flash: /anim badge <text>, a highlight sweeps the label',
  '10 sky strip: 24 cells, sun or moon on the real local hour',
  '11 skeleton shimmer: /anim skeleton, loading lab sections show moving bars',
  '12 conveyor queue: finished tool calls slide right along a belt',
  '13 ink-spread highlight: an edited file row glows then settles in 1.2 s',
  '14 ambient waves: calm to choppy as the error ratio of recent calls rises',
]

// ---- module state the drawings never read ---------------------------------------
let ticker: Timer | undefined
let tickerMs = 0
let isStepping = false
let lastBusyAt = 0
let statusClear: Timer | undefined
let timerEnd: Timer | undefined
let seedN = 1

type CallInfo = { tool: string; command?: unknown; file_path?: unknown; notebook_path?: unknown }

// ---- the one shared ticker ------------------------------------------------------
// It starts when something needs frames and stops itself when nothing does. It
// never starts while the global motion flag is off.
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

const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
  tickerMs = 0
}

/** Ask for frames: never slows a faster ticker, never runs with motion off. */
const ensureTicker = async ($: Dollar, ms = FAST_MS) => {
  if (!(await read($, motionIsOn)) || (ticker !== undefined && tickerMs <= ms)) {
    return
  }
  setTicker($, ms)
}

const touch = async ($: Dollar) => {
  const t = await $.clock.now()
  await update($, nowA, () => t)

  return t
}

/** What the ticker must do now: 'fast' while a burst animates, 'slow' for ambient motion, else 'none'. */
const needOf = async ($: Dollar, t: number): Promise<'fast' | 'slow' | 'none'> => {
  const isLab = await read($, labA)
  const timer = await read($, timerA)
  const cells = await read($, cellsA)
  const edits = await read($, editsA)
  const badge = await read($, badgeA)
  const isFast =
    (await read($, coinA)).at > 0 ||
    (await read($, shakeA)).at > 0 ||
    (await read($, confettiA)).at > 0 ||
    (await read($, revealA)) > 0 ||
    (await read($, tabA)).at > 0 ||
    (badge !== null && badge.at > 0) ||
    edits.some(x => t - x.at < INK_MS) ||
    (cells.length > 0 && cells.some(c => c.endAt > 0 && t - c.endAt < SLIDE_SPAN)) ||
    (await read($, loadingA)).ids.length > 0 ||
    (await read($, demoA)) !== null ||
    (isLab && timer !== null && t < timer.endAt)

  if (isFast) {
    return 'fast'
  }

  return isLab || (await read($, busyA)) || cells.some(c => c.endAt === 0) ? 'slow' : 'none'
}

const setStatusStatic = async ($: Dollar, text: string) => {
  statusClear?.cancel()
  await $.ui.status(text)
  statusClear = $.clock.after(HOLD_MS, () => {
    void $.ui.status(undefined)
  })
}

const paintShake = async ($: Dollar, t: number) => {
  const sh = await read($, shakeA)

  if (sh.at === 0) {
    return
  }
  const age = t - sh.at

  if (age >= SHAKE_MS) {
    await update($, shakeA, s => ({ at: 0, text: s.text }))
    await setStatusStatic($, shakeText(sh.text, 0, false))

    return
  }
  await $.ui.status(shakeText(sh.text, age, true))
}

/** Clears every finished event stamp so its drawing falls back to the settled frame. */
const expire = async ($: Dollar, t: number) => {
  if ((await read($, coinA)).at > 0 && t - (await read($, coinA)).at >= COIN_MS) {
    await update($, coinA, c => ({ at: 0, delta: c.delta }))
  }
  const cf = await read($, confettiA)

  if (cf.at > 0 && t - cf.at >= CONFETTI_MS) {
    await update($, confettiA, c => ({ at: 0, seed: c.seed }))
  }

  if ((await read($, revealA)) > 0 && t - (await read($, revealA)) >= SPARK_MS) {
    await update($, revealA, () => 0)
  }
  const tab = await read($, tabA)

  if (tab.at > 0 && t - tab.at >= TAB_MS) {
    await update($, tabA, s => ({ sel: s.sel, from: s.sel, at: 0 }))
  }
  const badge = await read($, badgeA)

  if (badge !== null && badge.at > 0 && t - badge.at >= BADGE_MS) {
    await update($, badgeA, b => (b === null ? b : { text: b.text, at: 0 }))
  }
  const demo = await read($, demoA)

  if (demo !== null && t - demo.at >= DEMO_MS) {
    await update($, demoA, () => null)
  }

  if ((await read($, busyA)) && lastBusyAt > 0 && t - lastBusyAt > STALE_BUSY_MS) {
    await update($, busyA, () => false)
  }

  if ((await read($, cellsA)).some(c => c.endAt === 0 && t - c.startAt > STALE_RUN_MS)) {
    await update($, cellsA, list => list.filter(c => c.endAt !== 0 || t - c.startAt <= STALE_RUN_MS))
  }
}

const step = async ($: Dollar) => {
  if (isStepping) {
    return
  }
  isStepping = true

  try {
    if (!(await read($, motionIsOn))) {
      stopTicker()

      return
    }
    const t = await $.clock.now()
    await update($, nowA, () => t)
    await expire($, t)
    await paintShake($, t)
    const need = await needOf($, t)

    if (need === 'none') {
      stopTicker()
    } else {
      setTicker($, need === 'fast' ? FAST_MS : SLOW_MS)
    }
  } finally {
    isStepping = false
  }
}

// ---- usage, history, coin ------------------------------------------------------
const pushHist = (list: number[], v: number) => [...list, v].slice(-HIST_MAX)

const refreshUsage = async ($: Dollar, isSample: boolean) => {
  let usage
  try {
    usage = await $.session.usage()
  } catch {
    return
  }
  const t = await $.clock.now()
  const ctx = usage.context.percent ?? 0
  const spend = usage.cost?.usd ?? 0
  const prev = await read($, usageA)
  await update($, usageA, () => ({ ctx, spend, isKnown: true }))

  if (isSample || !prev.isKnown) {
    await update($, histA, h => ({ spend: pushHist(h.spend, spend), ctx: pushHist(h.ctx, ctx) }))
  }

  if (prev.isKnown && spend > prev.spend + 0.00005 && (await read($, motionIsOn))) {
    await update($, coinA, () => ({ at: t, delta: spend - prev.spend }))
    await ensureTicker($)
  }
}

// ---- tool calls: conveyor, outcomes, errors, edits, commits -------------------
const beginCall = async ($: Dollar, id: string, tool: string, t: number) => {
  lastBusyAt = t
  await update($, cellsA, list =>
    [...list.filter(c => c.id !== id), { id, tool, startAt: t, endAt: 0, isErr: false }].slice(-CELLS_MAX),
  )
  await ensureTicker($, SLOW_MS)
}

const onError = async ($: Dollar, tool: string) => {
  const t = await $.clock.now()
  const text = `✗ ${tool} failed`

  if (await read($, motionIsOn)) {
    statusClear?.cancel()
    await update($, shakeA, () => ({ at: t, text }))
    await update($, nowA, () => t)
    await paintShake($, t)
    await ensureTicker($)

    return
  }
  await setStatusStatic($, shakeText(text, 0, false))
}

const onCommit = async ($: Dollar) => {
  const t = await $.clock.now()
  seedN += 1

  if (await read($, motionIsOn)) {
    await update($, confettiA, () => ({ at: t, seed: seedN }))
    await update($, nowA, () => t)
    await ensureTicker($)
  }
  await setStatusStatic($, '✓ committed')
}

const touchEdit = async ($: Dollar, path: string, t: number) => {
  const short = shortPath(path)
  await update($, editsA, list => [{ path: short, at: t }, ...list.filter(x => x.path !== short)].slice(0, EDITS_MAX))
  await update($, nowA, () => t)
  await ensureTicker($)
}

const endCall = async ($: Dollar, e: CallInfo, id: string, outcome: unknown, isThrown: boolean) => {
  const t = await $.clock.now()
  const r = outcome as { deny?: string; isError?: boolean; result?: unknown } | undefined
  const isErr = isThrown || r?.deny !== undefined || r?.isError === true
  await update($, cellsA, list => list.map(c => (c.id === id ? { ...c, endAt: t, isErr } : c)))
  await update($, outcomesA, o => `${o}${isErr ? 'e' : 'o'}`.slice(-OUTCOMES_MAX))
  await update($, nowA, () => t)
  await ensureTicker($)

  if (isErr) {
    await onError($, e.tool)
  } else {
    const out = (r?.result ?? {}) as { stdout?: unknown; gitOperation?: { commit?: unknown } }

    if (e.tool === 'Bash' && typeof e.command === 'string') {
      const stdout = typeof out.stdout === 'string' ? out.stdout : ''

      if (commitSucceeded(e.command, stdout, out.gitOperation?.commit !== undefined)) {
        await onCommit($)
      }
    }
    const path = typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : ''

    if (path !== '' && (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit')) {
      await touchEdit($, path, t)
    }
  }
  await refreshUsage($, false)
}

// ---- lab and command actions -----------------------------------------------------
const triggerCoin = async ($: Dollar) => {
  if (!(await read($, motionIsOn))) {
    return
  }
  const t = await touch($)
  await update($, coinA, () => ({ at: t, delta: 0.01 }))
  await ensureTicker($)
}

const replayReveal = async ($: Dollar) => {
  if (!(await read($, motionIsOn))) {
    return
  }
  const t = await touch($)
  await update($, revealA, () => t)
  await ensureTicker($)
}

const triggerShake = async ($: Dollar) => onError($, 'Sample')

const triggerBurst = async ($: Dollar) => onCommit($)

const triggerBadge = async ($: Dollar, text: string) => {
  const label = text.trim().slice(0, BADGE_MAX) || 'UNLOCKED'
  const isOn = await read($, motionIsOn)
  const t = await touch($)
  await update($, badgeA, () => ({ text: label, at: isOn ? t : 0 }))
  await ensureTicker($)

  return label
}

const triggerEdit = async ($: Dollar) => touchEdit($, 'src/sample/ink.ts', await $.clock.now())

const triggerSampleCall = async ($: Dollar) => {
  const t = await touch($)
  seedN += 1
  const id = `lab-${t}-${seedN}`
  const isErr = seedN % 3 === 0
  await beginCall($, id, 'Sample', t)
  $.clock.after(900, () => {
    void (async () => {
      const end = await $.clock.now()
      await update($, cellsA, list => list.map(c => (c.id === id ? { ...c, endAt: end, isErr } : c)))
      await update($, nowA, () => end)
      await ensureTicker($)
    })()
  })
}

const triggerSkeleton = async ($: Dollar) => {
  await update($, loadingA, () => ({ ids: ['spark', 'files', 'sky', 'skeleton'] }))
  await touch($)
  await ensureTicker($)
  $.clock.after(LOADING_MS, () => {
    void (async () => {
      await update($, loadingA, () => ({ ids: [] }))
      await replayReveal($)
    })()
  })
}

const pressTab = async ($: Dollar, index: number) => {
  const isOn = await read($, motionIsOn)
  const t = await touch($)
  await update($, tabA, s => ({ sel: index, from: isOn ? s.sel : index, at: isOn && s.sel !== index ? t : 0 }))
  await ensureTicker($)
}

const startTimer = async ($: Dollar, minutes: number) => {
  const t = await touch($)
  const totalMs = Math.round(Math.max(1 / 60, Math.min(600, minutes)) * 60_000)
  timerEnd?.cancel()
  await update($, timerA, () => ({ endAt: t + totalMs, totalMs, label: 'timer' }))
  timerEnd = $.clock.after(totalMs, () => {
    void finishTimer($)
  })
  await ensureTicker($)
}

const finishTimer = async ($: Dollar) => {
  await touch($)
  await $.ui.toast('Timer finished', { timeoutMs: 6000 })
  await ensureTicker($)
}

const stopTimer = async ($: Dollar) => {
  timerEnd?.cancel()
  await update($, timerA, () => null)
}

const openLab = async ($: Dollar) => {
  const isOn = await read($, motionIsOn)
  const t = await touch($)
  const opened = await $.ui.open({ id: LAB, title: 'Animations lab', closeOnEscape: true })
  const isPlaced = opened?.isPlaced !== false
  await update($, labA, () => isPlaced)
  await update($, revealA, () => (isOn ? t : 0))
  await ensureTicker($, SLOW_MS)

  return isPlaced
}

const playDemo = async ($: Dollar) => {
  if (!(await read($, motionIsOn))) {
    return false
  }
  const t = await touch($)
  seedN += 1
  await update($, demoA, () => ({ at: t }))
  await update($, coinA, () => ({ at: t, delta: 0.02 }))
  await update($, shakeA, () => ({ at: t, text: '✗ demo failed' }))
  await update($, confettiA, () => ({ at: t, seed: seedN }))
  await update($, revealA, () => t)
  await update($, tabA, s => ({ sel: (s.sel + 1) % TABS.length, from: s.sel, at: t }))
  await update($, badgeA, () => ({ text: 'DEMO UNLOCKED', at: t }))
  await update($, loadingA, () => ({ ids: ['spark', 'files', 'skeleton'] }))
  await update($, editsA, list => [{ path: 'demo/ink.ts', at: t }, ...list.filter(x => x.path !== 'demo/ink.ts')].slice(0, EDITS_MAX))

  if ((await read($, timerA)) === null) {
    await startTimer($, 6 / 60)
  }
  statusClear?.cancel()
  await paintShake($, t)

  // Four sample calls enter the belt together and finish one after another.
  for (let i = 0; i < 4; i++) {
    const id = `demo-${t}-${i}`
    await beginCall($, id, ['Read', 'Edit', 'Bash', 'Grep'][i] ?? 'Read', t)
    $.clock.after(500 + i * 450, () => {
      void (async () => {
        const end = await $.clock.now()
        await update($, cellsA, list => list.map(c => (c.id === id ? { ...c, endAt: end, isErr: i === 2 } : c)))
        await ensureTicker($)
      })()
    })
  }
  $.clock.after(1500, () => {
    void update($, loadingA, () => ({ ids: [] }))
  })
  await ensureTicker($)

  return true
}

const resetTransient = async ($: Dollar) => {
  await update($, busyA, () => false)
  await update($, coinA, () => ({ at: 0, delta: 0 }))
  await update($, shakeA, () => ({ at: 0, text: '' }))
  await update($, confettiA, () => ({ at: 0, seed: 1 }))
  await update($, revealA, () => 0)
  await update($, tabA, s => ({ sel: s.sel, from: s.sel, at: 0 }))
  await update($, badgeA, b => (b === null ? b : { text: b.text, at: 0 }))
  await update($, loadingA, () => ({ ids: [] }))
  await update($, cellsA, () => [])
  await update($, demoA, () => null)
  await update($, labA, () => false)
}

// ---- the view every drawing reads ------------------------------------------------
const readView = async ($: Dollar) => {
  const isOn = await read($, motionIsOn)
  const now = await read($, nowA)
  const busy = await read($, busyA)
  const demo = await read($, demoA)
  const usage = await read($, usageA)
  const outcomes = await read($, outcomesA)
  const dv = isOn && demo !== null ? demoView(now - demo.at) : undefined

  return {
    isOn,
    now,
    busy: dv?.isBusy ?? busy,
    isDemo: dv !== undefined,
    ctx: dv?.ctx ?? usage.ctx,
    spend: usage.spend,
    isKnown: usage.isKnown || dv !== undefined,
    ratio: dv?.ratio ?? ambientRatio(outcomes),
    outcomes,
    hist: await read($, histA),
    coin: await read($, coinA),
    shake: await read($, shakeA),
    confetti: await read($, confettiA),
    reveal: await read($, revealA),
    tab: await read($, tabA),
    timer: await read($, timerA),
    badge: await read($, badgeA),
    loading: (await read($, loadingA)).ids,
    cells: await read($, cellsA),
    edits: await read($, editsA),
  }
}

type View = Awaited<ReturnType<typeof readView>>

const fmtSpend = (usd: number) => `$${usd.toFixed(2)}`

// ---- the mod ----------------------------------------------------------------------
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'anim', description: 'Animations: /anim | demo | lab | timer <minutes> | badge <text> | skeleton' })
      .catch(() => undefined)
    await resetTransient($)
    await touch($)
    await refreshUsage($, true)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      lastBusyAt = await $.clock.now()
      await update($, busyA, () => true)
      await ensureTicker($, SLOW_MS)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, busyA, () => false)
      await touch($)
      await refreshUsage($, true)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.abort', async ($, e, next) => {
    await update($, busyA, () => false)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const info = e as unknown as CallInfo
    const t = await $.clock.now()
    const id = e.tool_use_id ?? `${e.tool}-${t}`
    await beginCall($, id, e.tool, t).catch(() => undefined)
    let outcome: unknown
    let isThrown = true

    try {
      const ran = await next(e)
      outcome = ran
      isThrown = false

      return ran
    } finally {
      await endCall($, info, id, outcome, isThrown).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)

    if (e.id === LAB) {
      await update($, labA, () => false)
    }

    return closed
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'anim' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    const isOn = await read($, motionIsOn)
    const offNote = isOn ? '' : ' Motion is off (/motion on): every piece shows its static final value.'

    if (word === 'lab') {
      const isPlaced = await openLab($)

      return {
        text: isPlaced
          ? `Animations lab opened.${offNote}`
          : 'The lab pane could not be placed (the window may be too narrow); widen it and run /anim lab again.',
      }
    }

    if (word === 'demo') {
      return { text: (await playDemo($)) ? 'Playing every animation once (about 6 s). Open /anim lab to see them large.' : 'Motion is off, so there is nothing to play: run /motion on first.' }
    }

    if (word === 'timer') {
      if (arg === 'off' || arg === 'stop') {
        await stopTimer($)

        return { text: 'Timer cleared.' }
      }
      const minutes = Number(arg === '' ? 5 : arg)

      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
        return { text: 'Usage: /anim timer <minutes> (0.1 to 600) or /anim timer off' }
      }
      await startTimer($, minutes)

      return { text: `Flip-clock timer started: ${minutes} min. See it in /anim lab (More tab).${offNote}` }
    }

    if (word === 'badge') {
      const label = await triggerBadge($, arg)

      return { text: `Badge: ${label}. See it in /anim lab (More tab).${offNote}` }
    }

    if (word === 'skeleton') {
      await triggerSkeleton($)

      return { text: `Lab sections show skeleton bars for ${LOADING_MS / 1000} s.${offNote}` }
    }

    return {
      text: `Animations (${isOn ? 'motion on' : 'motion off'}):\n${PIECES.map(p => `  ${p}`).join('\n')}\nUsage: /anim demo | lab | timer <minutes> | badge <text> | skeleton${offNote}`,
    }
  })

  // The band above the prompt: heartbeat, tank, spend with its coin, conveyor,
  // waves and sky, plus the confetti burst. It composes: other mods' rows stay.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isCollapsed) {
      return next(e)
    }
    const v = await readView($)
    const isMoving = v.isOn && (v.busy || v.isDemo)
    const busy = v.busy || e.props.isWorking
    const heart = heartFrame(busy, v.now, isMoving)
    const pct = v.isKnown ? `${Math.round(v.ctx)}%` : '--%'
    const coin = v.isOn && v.coin.at > 0 ? coinRow(v.now - v.coin.at) : undefined
    const prefix = 6 + pct.length
    const level = ambientLevel(v.ratio)
    const belt = groupRuns(conveyorFrame(v.cells, v.now, v.isOn).map(c => ({ ...c })))
    const burst = v.isOn && v.confetti.at > 0 ? confettiFrame(v.now - v.confetti.at, v.confetti.seed, 24, 3) : []
    const sky = v.now > 0 ? groupRuns(skyCells(hourOf(v.now), v.now, isMoving)) : []
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        {burst.map(row => (
          <Box>
            {row.map(r => (
              <Text color={r.color}>{r.text}</Text>
            ))}
          </Box>
        ))}
        {coin !== undefined && (
          <Box flexDirection="column">
            <Text color="warning">{coin === 0 ? `${' '.repeat(prefix)}$` : ' '}</Text>
            <Text color="warning">{coin === 1 ? `${' '.repeat(prefix)}$` : ' '}</Text>
          </Box>
        )}
        <Box>
          <Text color={heart.color} weight={heart.isBright ? 'bold' : 'regular'}>
            {heart.glyph}
          </Text>
          <Text> </Text>
          <Text color={toneOf(v.ctx)}>{tankMini(v.ctx)}</Text>
          <Text tabular color="subtle">{` ${pct}  `}</Text>
          <Text tabular color={coin === 2 ? 'warning' : 'subtle'} weight={coin === 2 ? 'bold' : 'regular'}>
            {fmtSpend(v.spend)}
          </Text>
          <Text>{'  '}</Text>
          {belt.map(r => (
            <Text color={r.color}>{r.text}</Text>
          ))}
        </Box>
        <Box>
          <Text color={ambientColor(level)}>{waveLine(level, v.now, isMoving, 12)}</Text>
          <Text color="subtle">{` ${AMBIENT_LABELS[level]}  `}</Text>
          {sky.map(r => (
            <Text color={r.color}>{r.text}</Text>
          ))}
        </Box>
      </Box>
    )
  })

  // The lab pane: each piece large, over three tabs.
  on('ui.render', { component: 'Pane', requestId: LAB }, async ($, e) => {
    const v = await readView($)
    const { Box, Button, Text } = $.ui.resolve(e)
    const W = Math.max(20, Math.min(48, e.props.bodyColumns - 4))
    const isOn = v.isOn
    const level = ambientLevel(v.ratio)
    const heart = heartFrame(v.busy, v.now, isOn)
    const isLoading = (id: string) => v.loading.includes(id)
    const heading = (s: string) => <Text color="subtle">{s}</Text>

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text color={heart.color}>{`${heart.glyph} ${tankMini(v.ctx)} ${v.isKnown ? Math.round(v.ctx) : '--'}%`}</Text>
          <Text color={ambientColor(level)}>{waveLine(level, v.now, isOn, 12)}</Text>
        </Box>
      )
    }

    const skeleton = (width: number) => {
      const b = shimmerBar(width, v.now, isOn)

      return (
        <Box>
          <Text color="inactive">{b.before}</Text>
          <Text color="claude">{b.hot}</Text>
          <Text color="inactive">{b.after}</Text>
        </Box>
      )
    }

    // 5: the tab strip. Labels are padded to one width so the underline can be placed by arithmetic.
    const tabAge = isOn && v.tab.at > 0 ? v.now - v.tab.at : -1
    const strip = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={0}>
          {TABS.map((name, i) => (
            <Button key={`tab-${i}`} label={` ${name}`.padEnd(TAB_CELL, ' ')} plain dimColor={v.tab.sel !== i} onPress={() => { void pressTab($, i) }} />
          ))}
        </Box>
        <Text color="claude">{underlineFrame(TAB_CELL, v.tab.from, v.tab.sel, tabAge, isOn)}</Text>
      </Box>
    )

    // 1
    const heartBox = (
      <Box flexDirection="column">
        {heading('1  heartbeat')}
        <Box>
          <Text color={heart.color} size="title">{heart.glyph}</Text>
          <Text>  </Text>
          <Text color={v.busy ? 'claude' : 'inactive'}>{ecgLine(v.busy, v.now, isOn, W - 6)}</Text>
        </Box>
        <Text color="inactive">{v.busy ? 'a turn is running' : 'idle: flatline'}</Text>
      </Box>
    )

    // 2
    const tank = tankRows(v.ctx, v.now, 6, 8, isOn)
    const tankBox = (
      <Box flexDirection="column">
        {heading('2  context tank')}
        <Box gap={2}>
          <Box flexDirection="column" borderStyle="round" borderColor="subtle">
            {tank.map(row => (
              <Text color={toneOf(v.ctx)}>{row}</Text>
            ))}
          </Box>
          <Text color="subtle">{`${v.isKnown ? Math.round(v.ctx) : '--'}% of context`}</Text>
        </Box>
      </Box>
    )

    // 3
    const coin = isOn && v.coin.at > 0 ? coinRow(v.now - v.coin.at) : undefined
    const coinBox = (
      <Box flexDirection="column">
        {heading('3  coin drop')}
        <Text color="warning">{coin === 0 ? '  $' : ' '}</Text>
        <Text color="warning">{coin === 1 ? '  $' : ' '}</Text>
        <Box gap={2}>
          <Text tabular color={coin === 2 ? 'warning' : 'subtle'} weight={coin === 2 ? 'bold' : 'regular'}>
            {fmtSpend(v.spend)}
          </Text>
          <Button key="coin" label="drop a coin" dimColor onPress={() => { void triggerCoin($) }} />
        </Box>
      </Box>
    )

    // 4
    const sampleSpend = v.hist.spend.length >= 3 ? v.hist.spend : SAMPLE_SERIES
    const sampleCtx = v.hist.ctx.length >= 3 ? v.hist.ctx : SAMPLE_SERIES.map(x => x * 3)
    const revealAge = isOn && v.reveal > 0 ? v.now - v.reveal : -1
    const sparkBox = (
      <Box flexDirection="column">
        {heading(`4  sparkline draw-in${v.hist.spend.length >= 3 ? '' : ' (sample data)'}`)}
        {isLoading('spark') ? (
          <Box flexDirection="column">
            {skeleton(W - 10)}
            {skeleton(W - 10)}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box gap={1}>
              <Text color="subtle">spend</Text>
              <Text color="success">{sparkReveal(sampleSpend, W - 10, revealAge, isOn)}</Text>
            </Box>
            <Box gap={1}>
              <Text color="subtle">ctx  </Text>
              <Text color="suggestion">{sparkReveal(sampleCtx, W - 10, revealAge, isOn)}</Text>
            </Box>
          </Box>
        )}
        <Button key="replay" label="replay" dimColor onPress={() => { void replayReveal($) }} />
      </Box>
    )

    // 6
    const shakeAge = isOn && v.shake.at > 0 ? v.now - v.shake.at : -1
    const shakeBox = (
      <Box flexDirection="column">
        {heading('6  shake on error')}
        <Text color="error">{shakeText(v.shake.text === '' ? '✗ Sample failed' : v.shake.text, shakeAge, isOn)}</Text>
        <Button key="shake" label="trigger an error" dimColor onPress={() => { void triggerShake($) }} />
      </Box>
    )

    // 7
    const burst = isOn && v.confetti.at > 0 ? confettiFrame(v.now - v.confetti.at, v.confetti.seed, W, 6) : []
    const confettiBox = (
      <Box flexDirection="column">
        {heading('7  confetti on commit')}
        {Array.from({ length: 6 }, (_, i) => (
          <Box>
            {(burst[i] ?? [{ text: ' ', color: 'inactive' as const }]).map(r => (
              <Text color={r.color}>{r.text}</Text>
            ))}
          </Box>
        ))}
        <Button key="burst" label="commit!" dimColor onPress={() => { void triggerBurst($) }} />
      </Box>
    )

    // 12
    const beltCells = conveyorFrame(v.cells, v.now, isOn).map(c => ({ glyph: `${c.glyph} `, color: c.color }))
    const beltBox = (
      <Box flexDirection="column">
        {heading('12  conveyor queue')}
        <Box>
          {groupRuns(beltCells).map(r => (
            <Text color={r.color}>{r.text}</Text>
          ))}
        </Box>
        <Text color="inactive">{`intake  ->  ${v.cells.filter(c => c.endAt === 0).length} running, ${v.cells.filter(c => c.endAt > 0).length} finished`}</Text>
        <Button key="call" label="run a sample call" dimColor onPress={() => { void triggerSampleCall($) }} />
      </Box>
    )

    // 13
    const inkBox = (
      <Box flexDirection="column">
        {heading('13  ink-spread highlight')}
        {isLoading('files') ? (
          <Box flexDirection="column">
            {skeleton(W - 8)}
            {skeleton(Math.round((W - 8) * 0.6))}
          </Box>
        ) : v.edits.length === 0 ? (
          <Text color="inactive">no file edited yet</Text>
        ) : (
          v.edits.slice(0, 5).map(x => (
            <Box>
              {inkFrame(x.path, isOn ? v.now - x.at : -1, isOn).map(r => (
                <Text color={r.color} weight={r.isBold === true ? 'bold' : 'regular'}>
                  {r.text}
                </Text>
              ))}
            </Box>
          ))
        )}
        <Button key="edit" label="touch a sample file" dimColor onPress={() => { void triggerEdit($) }} />
      </Box>
    )

    // 14
    const errs = v.outcomes.slice(-10).split('').filter(c => c === 'e').length
    const ambientBox = (
      <Box flexDirection="column">
        {heading('14  ambient state')}
        <Text color={ambientColor(level)}>{waveLine(level, v.now, isOn, W)}</Text>
        <Text color="subtle">{`${AMBIENT_LABELS[level]}: ${errs} error${errs === 1 ? '' : 's'} in the last ${Math.min(10, v.outcomes.length)} calls`}</Text>
      </Box>
    )

    // 8
    const flip = v.timer === null ? undefined : flipFrame(v.timer.endAt, v.timer.totalMs, v.now, isOn)
    const flipBox = (
      <Box flexDirection="column">
        {heading('8  flip-clock timer')}
        {v.timer === null || flip === undefined ? (
          <Text color="inactive">no timer: /anim timer &lt;minutes&gt;</Text>
        ) : (
          <Box flexDirection="column">
            <Box>
              {flip.map(ch =>
                ch === ':' ? (
                  <Text color="subtle"> : </Text>
                ) : (
                  <Box borderStyle="round" borderColor={ch === '▀' || ch === '▄' ? 'claude' : 'subtle'} paddingX={1}>
                    <Text mono tabular color={ch === '▀' || ch === '▄' ? 'claude' : undefined}>{ch}</Text>
                  </Box>
                ),
              )}
            </Box>
            <Text color="inactive">{`ends at ${fmtClock(v.timer.endAt)}${secsLeft(v.timer.endAt, v.now) === 0 ? ' (done)' : ''}`}</Text>
          </Box>
        )}
        <Box gap={2}>
          <Button key="timer1" label="start 1 min" dimColor onPress={() => { void startTimer($, 1) }} />
          <Button key="timer0" label="clear" dimColor onPress={() => { void stopTimer($) }} />
        </Box>
      </Box>
    )

    // 9
    const badgeText = v.badge === null ? 'UNLOCKED' : v.badge.text
    const bf = badgeFrame(badgeText, isOn && v.badge !== null && v.badge.at > 0 ? v.now - v.badge.at : -1, isOn)
    const badgeBox = (
      <Box flexDirection="column">
        {heading('9  badge unlock flash')}
        <Box>
          <Text color="subtle">[ </Text>
          <Text color="success" weight="bold">{bf.done}</Text>
          <Text color="claude" weight="bold">{bf.hot}</Text>
          <Text color="inactive">{bf.todo}</Text>
          <Text color="subtle"> ]</Text>
        </Box>
        <Button key="badge" label="unlock" dimColor onPress={() => { void triggerBadge($, v.badge === null ? '' : v.badge.text) }} />
      </Box>
    )

    // 10
    const hour = hourOf(v.now)
    const skyBox = (
      <Box flexDirection="column">
        {heading('10  sky strip')}
        {isLoading('sky') || v.now === 0 ? (
          skeleton(24)
        ) : (
          <Box flexDirection="column">
            <Box>
              {groupRuns(skyCells(hour, v.now, isOn)).map(r => (
                <Text color={r.color}>{r.text}</Text>
              ))}
            </Box>
            <Text color="inactive">{skyAxis()}</Text>
            <Text color="subtle">{`local time ${fmtClock(v.now)}: ${hour >= 6 && hour < 18 ? 'sun' : 'moon'} on hour ${Math.floor(hour)}`}</Text>
          </Box>
        )}
      </Box>
    )

    // 11
    const skelBox = (
      <Box flexDirection="column">
        {heading('11  skeleton shimmer')}
        {isLoading('skeleton') ? (
          <Box flexDirection="column">
            {skeleton(W)}
            {skeleton(Math.round(W * 0.7))}
            {skeleton(Math.round(W * 0.45))}
          </Box>
        ) : (
          <Text color="inactive">nothing is loading</Text>
        )}
        <Button key="skeleton" label="load for 2.5 s" dimColor onPress={() => { void triggerSkeleton($) }} />
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {strip}
        {v.tab.sel === 0 && (
          <Box flexDirection="column" gap={1}>
            {heartBox}
            {tankBox}
            {coinBox}
            {sparkBox}
          </Box>
        )}
        {v.tab.sel === 1 && (
          <Box flexDirection="column" gap={1}>
            {shakeBox}
            {confettiBox}
            {beltBox}
            {inkBox}
            {ambientBox}
          </Box>
        )}
        {v.tab.sel === 2 && (
          <Box flexDirection="column" gap={1}>
            {flipBox}
            {badgeBox}
            {skyBox}
            {skelBox}
          </Box>
        )}
        {!isOn && <Text color="warning">Motion is off: every piece shows its static final value.</Text>}
      </Box>
    )
  })
}
