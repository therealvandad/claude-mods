import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import type { Cfg, Entry, Todo } from '../types'
import {
  BALLOON_MS,
  DEMO_MS,
  DRIP_MS,
  FIRE_MS,
  FLIP_MS,
  GLOW_MS,
  IDLE_MS,
  PET_MS,
  PLANT_DEMO_MS,
  PLANT_MS,
  PULSE_MS,
  RAIN_MS,
  ROCKET_MS,
  SPINNERS,
  SPINNER_NAMES,
  SQUISH_MS,
  TICK_MS,
  TIP_MS,
  TOAST_HOLD_MS,
  TOAST_MS,
  UNDER_MS,
  balloonsFrame,
  canToast,
  daysToNext,
  dayKey,
  dialFrame,
  dripFrame,
  fireworksFrame,
  flipFrame,
  fmtClock,
  glowFrame,
  isBuildCommand,
  isLiveAt,
  isTagCreate,
  marqueeFrame,
  marqueeMs,
  middleTruncate,
  nextSpinner,
  outputLooksOk,
  parsePercent,
  pendulumFrame,
  petFrame,
  plantDemoStage,
  plantFrame,
  pulseFrame,
  rainFrame,
  rocketFrame,
  spinnerFrame,
  squishFrame,
  stageOf,
  todoPercent,
  toastFrame,
  tooltipFrame,
  typeFrame,
  typeMs,
  underlineFrame,
  waveRow,
} from './frames'

type Dollar = Parameters<Hook<'session.start'>>[0]

// ---- foreign atoms (READ only) --------------------------------------------------------
// motion.isOn: the global reduced-motion switch (/motion on|off), owned by the `motion` mod.
// settings.*: shared look-and-feel, owned by the `settings` mod. Both default sensibly when never written.
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const calmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')

// ---- this mod's atoms --------------------------------------------------------------------
// `now` is written by the one shared ticker, only while something animates. Every frame is
// a pure function of `now` and an event stamp in `marks` (0 = never), so settled UI never redraws.
const nowA = atom({ plugin: 'anim-more', key: 'now' } as const, 0)
const busyA = atom({ plugin: 'anim-more', key: 'busy' } as const, false)
const labA = atom({ plugin: 'anim-more', key: 'lab' } as const, false)
const tabA = atom({ plugin: 'anim-more', key: 'tab' } as const, 0)
const activeA = atom({ plugin: 'anim-more', key: 'active' } as const, 0)
const demoA = atom({ plugin: 'anim-more', key: 'demo' } as const, 0)
const seedA = atom({ plugin: 'anim-more', key: 'seed' } as const, 1)
const errsA = atom({ plugin: 'anim-more', key: 'errs' } as const, 0)
const cfgA = atom({ plugin: 'anim-more', key: 'cfg' } as const, { wave: false, rain: false, spin: 'dots' }, { shape: 'cfg-1' })
const marksA = atom({ plugin: 'anim-more', key: 'marks' } as const, {}, { shape: 'marks-1' })
const textsA = atom({ plugin: 'anim-more', key: 'texts' } as const, { type: '', marquee: '' }, { shape: 'texts-1' })
const toastA = atom({ plugin: 'anim-more', key: 'toast' } as const, { at: 0, text: '', isStatus: false, last: 0 }, { shape: 'toast-1' })
const spendA = atom({ plugin: 'anim-more', key: 'spend' } as const, { to: 0, from: 0, at: 0, isKnown: false }, { shape: 'spend-1' })
const growA = atom({ plugin: 'anim-more', key: 'grow' } as const, { days: 0, last: '', prev: 0 }, { shape: 'grow-1' })
const journalA = atom({ plugin: 'anim-more', key: 'journal' } as const, [], { shape: 'journal-1' })
const jflipA = atom({ plugin: 'anim-more', key: 'jflip' } as const, { idx: 0, from: 0 }, { shape: 'jflip-1' })
const sprintA = atom({ plugin: 'anim-more', key: 'sprint' } as const, null, { shape: 'sprint-1' })
const rocketA = atom({ plugin: 'anim-more', key: 'rocket' } as const, { pct: 0, from: 0, at: 0, mode: 'manual' }, { shape: 'rocket-1' })
const todosA = atom({ plugin: 'anim-more', key: 'todos' } as const, [], { shape: 'todos-1' })

// ---- bounds, names, texts ---------------------------------------------------------------------
const LAB = 'anim-more-lab'
const TABS = ['UI', 'Text', 'Fun'] as const
const JOURNAL_MAX = 30
const JOURNAL_CHARS = 160
const TODO_MAX = 30
const TODO_CHARS = 80
const TYPE_CHARS = 200
const STALE_BUSY_MS = 30 * 60_000
const LONG_TURN_MS = 60_000
const SPRINT_MAX_MIN = 240
const HINT = 'Hints grow in three steps, then stay.'
const SAMPLE_TYPE = 'Summary: anim-more types this out one character at a time.'
const SAMPLE_PATH = '/Users/you/projects/a-long-project-name/packages/core/src/components/Sidebar/index.tsx'
const SAMPLE_PAGES: readonly Entry[] = [
  { d: 'sample day 1', t: 'Shipped the picker; paired on the flaky test.' },
  { d: 'sample day 2', t: 'Wrote docs, cleaned the branch, took a walk.' },
]
const KEY = {
  cfg: 'anim-more.cfg',
  grow: 'anim-more.grow',
  journal: 'anim-more.journal',
  todos: 'anim-more.todos',
  rocket: 'anim-more.rocket',
} as const

/** Pieces that play for a fixed time from a stamp in `marks`; the ticker runs while any is playing. */
const DURATIONS: Readonly<Record<string, number>> = {
  tip: TIP_MS,
  glow: GLOW_MS,
  under: UNDER_MS,
  squishA: SQUISH_MS,
  squishB: SQUISH_MS,
  pulse: PULSE_MS,
  rain: RAIN_MS,
  fire: FIRE_MS,
  balloons: BALLOON_MS,
  flip: FLIP_MS,
  plant: PLANT_MS,
  plantDemo: PLANT_DEMO_MS,
  pet: PET_MS,
}

const PIECES = [
  '143 pop-in hint: lab UI tab, a hint grows in 3 steps when you press (?)',
  '144 breathing glow: lab UI tab, a border steps between two theme colours while a turn runs',
  '145 underline draw: lab UI tab, a Button draws its underline left to right (a hover cannot be animated, so it is Button-driven)',
  '146 button squish: lab UI tab, a press insets the button for 2 frames',
  '147 staged toast: status line, 3 frames, at most once per 3 minutes (the real toast cannot be animated)',
  '148 wave: a one-row wave while a turn runs, in the lab or in the band after /aywave on',
  '149 spinners: dots, orbit, round, quad, arc, pulse; choose with /ayspin',
  '150 typewriter: /aytype <text> reveals it in the lab',
  '151 marquee: a long path scrolls in a window in the lab (/aymarquee <text>)',
  '152 pulsing badge: lab Text tab, a count that pulses 3 times when a tool call errors',
  '153 drip: lab Text tab, a drop falls and the spend figure ticks up',
  '154 plant: /aygrow, 7 stages that grow with each day you run a tool call',
  '155 rain: a 1.2 s shower in the band after a build or test succeeds (/ayrain on)',
  '156 fireworks: a 2 s burst in the band after a git tag succeeds (/ayrain on)',
  '157 balloons: /aysprint <minutes>, balloons rise in the lab at the end, plus a toast',
  '158 page flip: /ayjot <text>, the lab flips between journal days',
  '159 dial: the lab dial spins while a sprint runs',
  '160 pendulum: lab Fun tab, swings after 60 s idle',
  '161 pet: lab Fun tab, a cat walks a 20-cell strip while a turn runs',
  '162 rocket: /ayrocket <percent|todo>, /aytodo, a rocket advances along a track',
]

const COMMANDS: readonly { name: string; description: string }[] = [
  { name: 'ay', description: 'More animations: list every piece and command' },
  { name: 'aylab', description: 'Open the animation lab pane: /aylab [ui|text|fun]' },
  { name: 'aydemo', description: 'Play every animation once in the lab (about 7 s)' },
  { name: 'aywave', description: 'Band wave while a turn runs: /aywave on|off (default off)' },
  { name: 'ayrain', description: 'Rain after a build, fireworks after a git tag: /ayrain on|off (default off)' },
  { name: 'ayspin', description: 'Spinner variant: /ayspin [dots|orbit|round|quad|arc|pulse|next]' },
  { name: 'aytype', description: 'Reveal a text with a typewriter in the lab: /aytype <text>' },
  { name: 'aymarquee', description: 'Scroll a long string in the lab: /aymarquee [text]' },
  { name: 'aytoast', description: 'Staged status-line toast, once per 3 minutes: /aytoast <text>' },
  { name: 'aysprint', description: 'Own sprint timer: /aysprint <minutes> | off' },
  { name: 'ayjot', description: 'Add to today\'s mini journal, or list it: /ayjot [text]' },
  { name: 'aygrow', description: 'Show the plant that grows with the days you work' },
  { name: 'ayrocket', description: 'Rocket progress: /ayrocket <percent> | todo' },
  { name: 'aytodo', description: 'Todos for the rocket: /aytodo [add <text> | done <n> | undo <n> | rm <n> | clear]' },
  { name: 'ayreset', description: 'Clear everything anim-more recorded' },
]

// ---- module state the drawings never read -----------------------------------------------------------
let ticker: Timer | undefined
let isStepping = false
let statusClear: Timer | undefined
let sprintTimer: Timer | undefined
let idleTimer: Timer | undefined
let demoTimers: Timer[] = []
let turnAt = 0

type CallInfo = { tool: string; command?: unknown }

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)))

// ---- the gate: nothing animates unless motion is on AND settings are not calm ------------------------
const animOk = async ($: Dollar) => (await read($, motionIsOn)) && !(await read($, calmA))

// ---- the one shared ticker ------------------------------------------------------------------------------
const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
}

const touch = async ($: Dollar) => {
  const t = await $.clock.now()
  await update($, nowA, () => t)

  return t
}

/** Whether any piece needs frames at time `t`. Pure reads, no writes. */
const isLive = async ($: Dollar, t: number) => {
  const marks = await read($, marksA)

  if (Object.entries(DURATIONS).some(([k, ms]) => isLiveAt(marks[k] ?? 0, t, ms))) {
    return true
  }
  const texts = await read($, textsA)
  const demoAt = await read($, demoA)
  const toast = await read($, toastA)
  const spend = await read($, spendA)
  const rocket = await read($, rocketA)
  const sprint = await read($, sprintA)
  const busy = await read($, busyA)
  const cfg = await read($, cfgA)
  const lab = await read($, labA)
  const tab = await read($, tabA)

  if (
    isLiveAt(marks.type ?? 0, t, typeMs(texts.type || SAMPLE_TYPE)) ||
    isLiveAt(marks.marquee ?? 0, t, marqueeMs(texts.marquee || SAMPLE_PATH)) ||
    isLiveAt(spend.at, t, DRIP_MS) ||
    isLiveAt(rocket.at, t, ROCKET_MS) ||
    (toast.at > 0 && (toast.isStatus || isLiveAt(toast.at, t, TOAST_MS))) ||
    isLiveAt(demoAt, t, DEMO_MS)
  ) {
    return true
  }
  const isSprintRunning = sprint !== null && t < sprint.endAt
  const isIdle = t - (await read($, activeA)) >= IDLE_MS

  return (
    (cfg.wave && busy) ||
    (lab && tab === 0 && busy) ||
    (lab && tab === 2 && (busy || isSprintRunning || isIdle))
  )
}

/** Starts the ticker if something needs frames and the gate is open. Never starts with motion off or calm. */
const kick = async ($: Dollar) => {
  if (ticker !== undefined || !(await animOk($))) {
    return
  }

  if ((await isLive($, await $.clock.now())) && ticker === undefined) {
    ticker = $.clock.every(TICK_MS, () => {
      void step($)
    })
  }
}

const paintToast = async ($: Dollar, t: number) => {
  const ts = await read($, toastA)

  if (!ts.isStatus || ts.at === 0) {
    return
  }
  const age = t - ts.at
  await $.ui.status(toastFrame(ts.text, age, true))

  if (age >= TOAST_MS) {
    await update($, toastA, s => ({ ...s, isStatus: false }))
    statusClear?.cancel()
    statusClear = $.clock.after(TOAST_HOLD_MS, () => {
      void $.ui.status(undefined)
    })
  }
}

const step = async ($: Dollar) => {
  if (isStepping) {
    return
  }
  isStepping = true

  try {
    if (!(await animOk($))) {
      stopTicker()

      return
    }
    const t = await $.clock.now()
    await update($, nowA, () => t)
    await paintToast($, t)

    if ((await read($, busyA)) && t - (await read($, activeA)) > STALE_BUSY_MS) {
      await update($, busyA, () => false)
    }

    if (!(await isLive($, t))) {
      stopTicker()
    }
  } finally {
    isStepping = false
  }
}

// ---- stamps ------------------------------------------------------------------------------------------------
const stamp = async ($: Dollar, ...keys: string[]) => {
  const t = await touch($)
  await update($, marksA, m => ({ ...m, ...Object.fromEntries(keys.map(k => [k, t])) }))
  await kick($)

  return t
}

const unstamp = async ($: Dollar, key: string) => {
  await touch($)
  await update($, marksA, m => ({ ...m, [key]: 0 }))
}

// ---- persistence ------------------------------------------------------------------------------------------------
const saveCfg = async ($: Dollar) => $.store.set(KEY.cfg, await read($, cfgA))
const saveJournal = async ($: Dollar) => $.store.set(KEY.journal, await read($, journalA))
const saveTodos = async ($: Dollar) => $.store.set(KEY.todos, await read($, todosA))
const saveGrow = async ($: Dollar) => $.store.set(KEY.grow, await read($, growA))
const saveRocket = async ($: Dollar) => {
  const r = await read($, rocketA)

  return $.store.set(KEY.rocket, { pct: r.pct, mode: r.mode })
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

const load = async ($: Dollar) => {
  const cfg = await $.store.get(KEY.cfg).catch(() => undefined)
  const c = isRecord(cfg) ? cfg : {}
  await update($, cfgA, () => ({
    wave: c.wave === true,
    rain: c.rain === true,
    spin: typeof c.spin === 'string' && SPINNERS[c.spin] !== undefined ? c.spin : 'dots',
  }))
  const grow = await $.store.get(KEY.grow).catch(() => undefined)
  const g = isRecord(grow) ? grow : {}
  const days = typeof g.days === 'number' && g.days >= 0 ? Math.floor(g.days) : 0
  await update($, growA, () => ({ days, last: typeof g.last === 'string' ? g.last : '', prev: stageOf(days) }))
  const journal = await $.store.get(KEY.journal).catch(() => undefined)
  const entries: Entry[] = Array.isArray(journal)
    ? journal
        .filter((x): x is Entry => isRecord(x) && typeof x.d === 'string' && typeof x.t === 'string')
        .map(x => ({ d: x.d.slice(0, 20), t: x.t.slice(0, JOURNAL_CHARS) }))
        .slice(-JOURNAL_MAX)
    : []
  await update($, journalA, () => entries)
  await update($, jflipA, () => ({ idx: Math.max(0, entries.length - 1), from: Math.max(0, entries.length - 1) }))
  const todos = await $.store.get(KEY.todos).catch(() => undefined)
  const list: Todo[] = Array.isArray(todos)
    ? todos
        .filter((x): x is Todo => isRecord(x) && typeof x.t === 'string' && typeof x.done === 'boolean')
        .map(x => ({ t: x.t.slice(0, TODO_CHARS), done: x.done }))
        .slice(0, TODO_MAX)
    : []
  await update($, todosA, () => list)
  const rocket = await $.store.get(KEY.rocket).catch(() => undefined)
  const r = isRecord(rocket) ? rocket : {}
  const mode = r.mode === 'todo' ? 'todo' : 'manual'
  const pct = mode === 'todo' ? todoPercent(list) : typeof r.pct === 'number' ? clampInt(r.pct, 0, 100) : 0
  await update($, rocketA, () => ({ pct, from: pct, at: 0, mode }))
}

// ---- activity: idle timer, plant days -----------------------------------------------------------------------------
const markActive = async ($: Dollar) => {
  const t = await $.clock.now()
  await update($, activeA, () => t)
  idleTimer?.cancel()
  idleTimer = $.clock.after(IDLE_MS, () => {
    void kick($)
  })
}

const bumpDay = async ($: Dollar, t: number) => {
  const key = dayKey(t)
  const g = await read($, growA)

  if (g.last === key) {
    return
  }
  const days = g.days + 1
  await update($, growA, () => ({ days, last: key, prev: stageOf(g.days) }))
  await saveGrow($)

  if (stageOf(days) > stageOf(g.days)) {
    await stamp($, 'plant')
  }
}

// ---- spend -> drip ------------------------------------------------------------------------------------------------------
const refreshSpend = async ($: Dollar) => {
  let usage
  try {
    usage = await $.session.usage()
  } catch {
    return
  }
  const usd = usage.cost?.usd ?? 0
  const t = await $.clock.now()
  const prev = await read($, spendA)
  const isRise = prev.isKnown && usd > prev.to + 0.00005
  await update($, spendA, () => ({ to: usd, from: isRise ? prev.to : usd, at: isRise ? t : 0, isKnown: true }))

  if (isRise) {
    await update($, nowA, () => t)
    await kick($)
  }
}

// ---- toast (status line) ----------------------------------------------------------------------------------------------------
/** Shows a staged toast in the lab always, and on the status line only if 3 minutes have passed since the last. Returns whether the status line was used. */
const showToast = async ($: Dollar, text: string) => {
  const t = await touch($)
  const ts = await read($, toastA)
  const isStatus = canToast(t, ts.last)
  const isAnim = await animOk($)
  await update($, toastA, () => ({ at: t, text, isStatus: isStatus && isAnim, last: isStatus ? t : ts.last }))

  if (!isStatus) {
    await kick($)

    return false
  }
  statusClear?.cancel()
  await $.ui.status(toastFrame(text, 0, isAnim))

  if (isAnim) {
    await kick($)
  } else {
    statusClear = $.clock.after(TOAST_HOLD_MS, () => {
      void $.ui.status(undefined)
    })
  }

  return true
}

// ---- tool calls ----------------------------------------------------------------------------------------------------------------------
const onToolStart = async ($: Dollar) => {
  const t = await $.clock.now()
  await markActive($)
  await bumpDay($, t)
}

const onToolEnd = async ($: Dollar, e: CallInfo, outcome: unknown, isThrown: boolean) => {
  const r = outcome as { deny?: string; isError?: boolean; result?: unknown } | undefined
  const isErr = isThrown || r?.deny !== undefined || r?.isError === true
  await markActive($)

  if (isErr) {
    await update($, errsA, n => Math.min(99, n + 1))
    await stamp($, 'pulse')
  } else if (e.tool === 'Bash' && typeof e.command === 'string' && (await read($, cfgA)).rain && (await animOk($))) {
    const out = (r?.result ?? {}) as { stdout?: unknown }
    const stdout = typeof out.stdout === 'string' ? out.stdout : ''

    if (outputLooksOk(stdout)) {
      if (isTagCreate(e.command)) {
        await update($, seedA, n => n + 1)
        await stamp($, 'fire')
      } else if (isBuildCommand(e.command)) {
        await update($, seedA, n => n + 1)
        await stamp($, 'rain')
      }
    }
  }
  await refreshSpend($)
}

// ---- lab actions ----------------------------------------------------------------------------------------------------------------------
const openLab = async ($: Dollar, tab?: number) => {
  await touch($)

  if (tab !== undefined) {
    await update($, tabA, () => tab)
  }
  const opened = await $.ui.open({ id: LAB, title: 'More animations', closeOnEscape: true })
  const isPlaced = opened?.isPlaced !== false
  await update($, labA, () => isPlaced)
  await kick($)

  return isPlaced
}

const pressTab = async ($: Dollar, index: number) => {
  await touch($)
  await update($, tabA, () => index)
  await kick($)
}

const toggleTip = async ($: Dollar) => {
  const marks = await read($, marksA)

  if ((marks.tip ?? 0) > 0) {
    await unstamp($, 'tip')
  } else {
    await stamp($, 'tip')
  }
}

const setSpinner = async ($: Dollar, name: string) => {
  await update($, cfgA, c => ({ ...c, spin: name }))
  await saveCfg($)
}

const cycleSpinner = async ($: Dollar) => setSpinner($, nextSpinner((await read($, cfgA)).spin))

const replayType = async ($: Dollar, text?: string) => {
  if (text !== undefined) {
    await update($, textsA, s => ({ ...s, type: text.slice(0, TYPE_CHARS) }))
  }
  await stamp($, 'type')
}

const replayMarquee = async ($: Dollar, text?: string) => {
  if (text !== undefined) {
    await update($, textsA, s => ({ ...s, marquee: text.slice(0, TYPE_CHARS) }))
  }
  await stamp($, 'marquee')
}

/** A replay of the drip that lands on the true figure: it starts a cent lower. */
const replayDrip = async ($: Dollar) => {
  const t = await touch($)
  await update($, spendA, s => ({ ...s, from: Math.max(0, s.to - 0.01), at: t }))
  await kick($)
}

const replayRocket = async ($: Dollar, pct?: number) => {
  const t = await touch($)
  const r = await read($, rocketA)
  const next = pct ?? r.pct
  await update($, rocketA, s => ({ ...s, pct: next, from: pct === undefined ? 0 : s.pct, at: t }))
  await saveRocket($)
  await kick($)
}

const bumpRocket = async ($: Dollar) => {
  const r = await read($, rocketA)

  if (r.mode === 'todo') {
    return
  }
  await replayRocket($, r.pct >= 100 ? 0 : Math.min(100, r.pct + 25))
}

const setRocketPct = async ($: Dollar, pct: number, mode: 'manual' | 'todo') => {
  const t = await touch($)
  const r = await read($, rocketA)
  await update($, rocketA, () => ({ pct, from: r.pct, at: t, mode }))
  await saveRocket($)
  await kick($)
}

const syncRocketToTodos = async ($: Dollar) => {
  if ((await read($, rocketA)).mode === 'todo') {
    await setRocketPct($, todoPercent(await read($, todosA)), 'todo')
  }
}

// ---- sprint -------------------------------------------------------------------------------------------------------------------------------
const finishSprint = async ($: Dollar) => {
  const sprint = await read($, sprintA)
  await update($, sprintA, () => null)
  await update($, seedA, n => n + 1)
  await stamp($, 'balloons')
  const minutes = sprint === null ? 0 : Math.round((sprint.totalMs / 60_000) * 10) / 10
  // An explicit alarm the user asked for: shown even when calm, and not held back by the 3-minute rule.
  await $.ui.toast(`Sprint done${minutes > 0 ? `: ${minutes} min` : ''}`, { timeoutMs: 6000 })
}

const startSprint = async ($: Dollar, minutes: number) => {
  const t = await touch($)
  const totalMs = Math.round(minutes * 60_000)
  sprintTimer?.cancel()
  await update($, sprintA, () => ({ endAt: t + totalMs, totalMs }))
  sprintTimer = $.clock.after(totalMs, () => {
    void finishSprint($)
  })
  await kick($)
}

const stopSprint = async ($: Dollar) => {
  sprintTimer?.cancel()
  sprintTimer = undefined
  await touch($)
  await update($, sprintA, () => null)
}

// ---- journal -------------------------------------------------------------------------------------------------------------------------------
const addJot = async ($: Dollar, text: string) => {
  const t = await touch($)
  const d = dayKey(t)
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, JOURNAL_CHARS)
  await update($, journalA, list => {
    const last = list[list.length - 1]

    if (last !== undefined && last.d === d) {
      return [...list.slice(0, -1), { d, t: `${last.t} · ${clean}`.slice(0, JOURNAL_CHARS) }]
    }

    return [...list, { d, t: clean }].slice(-JOURNAL_MAX)
  })
  await saveJournal($)
  const n = (await read($, journalA)).length
  const from = (await read($, jflipA)).idx
  await update($, jflipA, () => ({ idx: n - 1, from }))
  await stamp($, 'flip')
}

const flipJournal = async ($: Dollar, delta: number) => {
  const count = Math.max(1, (await read($, journalA)).length || SAMPLE_PAGES.length)
  const cur = (await read($, jflipA)).idx
  const idx = (((cur + delta) % count) + count) % count
  await update($, jflipA, () => ({ idx, from: cur }))
  await stamp($, 'flip')
}

// ---- demo ------------------------------------------------------------------------------------------------------------------------------------
const playTab = async ($: Dollar, tab: number) => {
  await update($, tabA, () => tab)
  await update($, seedA, n => n + 1)

  if (tab === 0) {
    await stamp($, 'tip', 'glow', 'under', 'squishA', 'squishB')
    await showToast($, 'anim-more demo')
  } else if (tab === 1) {
    await update($, textsA, s => ({ ...s, type: s.type === '' ? SAMPLE_TYPE : s.type }))
    await stamp($, 'type', 'marquee', 'pulse', 'plantDemo')
    await replayDrip($)

    await flipJournal($, 1)
  } else {
    await stamp($, 'rain', 'fire', 'balloons', 'pet')
  }
}

const playDemo = async ($: Dollar) => {
  const isPlaced = await openLab($, 0)

  if (!(await animOk($))) {
    return { isPlaced, isAnimated: false }
  }
  demoTimers.forEach(x => x.cancel())
  const t = await touch($)
  await update($, demoA, () => t)
  await playTab($, 0)
  demoTimers = [
    $.clock.after(2500, () => {
      void playTab($, 1)
    }),
    $.clock.after(5000, () => {
      void playTab($, 2)
    }),
    $.clock.after(DEMO_MS, () => {
      void (async () => {
        await touch($)
        await update($, demoA, () => 0)
      })()
    }),
  ]

  return { isPlaced, isAnimated: true }
}

// ---- reset ------------------------------------------------------------------------------------------------------------------------------------
const resetTransient = async ($: Dollar) => {
  stopTicker()
  statusClear?.cancel()
  sprintTimer?.cancel()
  sprintTimer = undefined
  idleTimer?.cancel()
  idleTimer = undefined
  demoTimers.forEach(x => x.cancel())
  demoTimers = []
  turnAt = 0
  await update($, busyA, () => false)
  await update($, labA, () => false)
  await update($, demoA, () => 0)
  await update($, marksA, () => ({}))
  await update($, toastA, () => ({ at: 0, text: '', isStatus: false, last: 0 }))
  await update($, sprintA, () => null)
}

const resetAll = async ($: Dollar) => {
  await resetTransient($)
  await update($, cfgA, () => ({ wave: false, rain: false, spin: 'dots' }))
  await update($, textsA, () => ({ type: '', marquee: '' }))
  await update($, spendA, s => ({ to: s.to, from: s.to, at: 0, isKnown: s.isKnown }))
  await update($, errsA, () => 0)
  await update($, growA, () => ({ days: 0, last: '', prev: 0 }))
  await update($, journalA, () => [])
  await update($, jflipA, () => ({ idx: 0, from: 0 }))
  await update($, todosA, () => [])
  await update($, rocketA, () => ({ pct: 0, from: 0, at: 0, mode: 'manual' }))
  await update($, tabA, () => 0)

  for (const k of Object.values(KEY)) {
    await $.store.delete(k)
  }
}

// ---- the view every drawing reads ----------------------------------------------------------------------------------------------------------------
const readView = async ($: Dollar) => {
  const isAnim = await animOk($)
  const now = await read($, nowA)
  const busy = await read($, busyA)
  const demoAt = await read($, demoA)
  const marks = await read($, marksA)
  const density = (await read($, densityA)) as string
  const icons = (await read($, iconsA)) as string
  const rocket = await read($, rocketA)
  const todos = await read($, todosA)
  const isDemo = isAnim && isLiveAt(demoAt, now, DEMO_MS)
  const ageOf = (k: string) => ((marks[k] ?? 0) > 0 ? Math.max(0, now - (marks[k] ?? 0)) : -1)
  const demoAge = isDemo ? now - demoAt : -1

  return {
    isAnim,
    now,
    busy,
    isDemo,
    demoAge,
    isBusyLike: busy || isDemo,
    ageOf,
    tab: await read($, tabA),
    cfg: await read($, cfgA),
    texts: await read($, textsA),
    toast: await read($, toastA),
    spend: await read($, spendA),
    grow: await read($, growA),
    journal: await read($, journalA),
    jflip: await read($, jflipA),
    sprint: await read($, sprintA),
    rocket,
    todos,
    errs: await read($, errsA),
    seed: await read($, seedA),
    active: await read($, activeA),
    accent: (await read($, accentA)) as string,
    gap: density === 'compact' ? ('xs' as const) : density === 'airy' ? ('md' as const) : ('sm' as const),
    badgeGlyph: icons === 'letters' ? 'E' : icons === 'minimal' ? '•' : '●',
  }
}

type View = Awaited<ReturnType<typeof readView>>

const fmtSpend = (usd: number) => `$${usd.toFixed(2)}`

/** Plant stage and previous stage as drawn now: the demo previews 0..6, a real growth plays prev -> stage. */
const plantOf = (v: View) => {
  const stage = stageOf(v.grow.days)
  const demo = v.ageOf('plantDemo')

  if (v.isAnim && demo >= 0 && demo < PLANT_DEMO_MS) {
    const s = plantDemoStage(demo)

    return { rows: plantFrame(s, s, -1, false), stage: s, isDemo: true }
  }

  return { rows: plantFrame(stage, v.grow.prev, v.ageOf('plant'), v.isAnim), stage, isDemo: false }
}

const pageOf = (v: View, i: number): string => {
  const list: readonly Entry[] = v.journal.length > 0 ? v.journal : SAMPLE_PAGES
  const e = list[Math.max(0, Math.min(list.length - 1, i))]

  return e === undefined ? '' : `${e.d}  ${e.t}`
}

// ---- commands ------------------------------------------------------------------------------------------------------------------------------------------
const stateNote = async ($: Dollar) => {
  const isMotion = await read($, motionIsOn)
  const isCalm = await read($, calmA)

  return !isMotion || isCalm
    ? ` (${!isMotion ? 'motion is off' : 'settings are calm'}: nothing animates, every piece shows its static final frame)`
    : ''
}

const todoLines = (todos: readonly Todo[]) =>
  todos.length === 0 ? 'No todos: /aytodo add <text>' : todos.map((x, i) => `${i + 1}. [${x.done ? 'x' : ' '}] ${x.t}`).join('\n')

const runCommand = async ($: Dollar, name: string, args: string): Promise<{ text: string }> => {
  const arg = args.trim()
  const note = await stateNote($)

  if (name === 'ay') {
    const cfg = await read($, cfgA)

    return {
      text: [
        `anim-more${note}`,
        ...PIECES.map(p => `  ${p}`),
        'Commands: /aylab [ui|text|fun] | /aydemo | /aywave on|off | /ayrain on|off | /ayspin [name] | /aytype <text> | /aymarquee [text] | /aytoast <text> | /aysprint <minutes>|off | /ayjot [text] | /aygrow | /ayrocket <percent>|todo | /aytodo ... | /ayreset',
        `Now: wave ${cfg.wave ? 'on' : 'off'}, rain+fireworks ${cfg.rain ? 'on' : 'off'}, spinner ${cfg.spin}`,
      ].join('\n'),
    }
  }

  if (name === 'aylab') {
    const tab = arg === '' ? undefined : TABS.findIndex(x => x.toLowerCase() === arg.toLowerCase())

    if (tab === -1) {
      return { text: 'Usage: /aylab [ui|text|fun]' }
    }
    const isPlaced = await openLab($, tab)

    return {
      text: isPlaced ? `More animations lab opened.${note}` : 'The lab pane could not be placed (the window may be too narrow); widen it and run /aylab again.',
    }
  }

  if (name === 'aydemo') {
    const r = await playDemo($)

    return {
      text: !r.isPlaced
        ? 'The lab pane could not be placed; widen the window and run /aydemo again.'
        : r.isAnimated
          ? 'Playing each piece once in the lab (about 7 s): UI, then Text, then Fun.'
          : `Nothing plays${note}. The lab is open on its static frames.`,
    }
  }

  if (name === 'aywave' || name === 'ayrain') {
    const key = name === 'aywave' ? 'wave' : 'rain'
    const what = key === 'wave' ? 'The band wave (while a turn runs)' : 'Rain after a build or test, fireworks after a git tag'

    if (arg === 'on' || arg === 'off') {
      await update($, cfgA, c => ({ ...c, [key]: arg === 'on' }))
      await saveCfg($)
      await kick($)

      return { text: `${what}: ${arg}.${arg === 'on' ? note : ''}` }
    }

    return { text: `${what} is ${(await read($, cfgA))[key] ? 'on' : 'off'} (default off). Usage: /${name} on|off` }
  }

  if (name === 'ayspin') {
    const cur = (await read($, cfgA)).spin

    if (arg === '') {
      return { text: `Spinner: ${cur}. Choose: ${SPINNER_NAMES.join(', ')} (or "next"). Shown in the lab UI tab.` }
    }
    const pick = arg === 'next' ? nextSpinner(cur) : SPINNER_NAMES.find(x => x === arg.toLowerCase())

    if (pick === undefined) {
      return { text: `Unknown spinner. Choose: ${SPINNER_NAMES.join(', ')}` }
    }
    await setSpinner($, pick)

    return { text: `Spinner: ${pick} ${SPINNERS[pick]!.slice(0, 4).join('')}` }
  }

  if (name === 'aytype') {
    if (arg === '') {
      return { text: 'Usage: /aytype <text> (up to 200 characters)' }
    }
    await openLab($, 1)
    await replayType($, arg)

    return { text: `Typing it in the lab Text tab.${note}` }
  }

  if (name === 'aymarquee') {
    await openLab($, 1)
    await replayMarquee($, arg === '' ? undefined : arg)

    return { text: `Scrolling in the lab Text tab.${note}` }
  }

  if (name === 'aytoast') {
    if (arg === '') {
      return { text: 'Usage: /aytoast <text>' }
    }
    const isStatus = await showToast($, arg.slice(0, 80))

    return {
      text: isStatus
        ? `Staged on the status line (3 frames).${note}`
        : 'Not on the status line: the last one was under 3 minutes ago. It plays in the lab UI tab only.',
    }
  }

  if (name === 'aysprint') {
    if (arg === 'off' || arg === 'stop') {
      await stopSprint($)

      return { text: 'Sprint cleared.' }
    }
    const minutes = Number(arg === '' ? 25 : arg)

    if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > SPRINT_MAX_MIN) {
      return { text: `Usage: /aysprint <minutes> (0.1 to ${SPRINT_MAX_MIN}) or /aysprint off` }
    }
    await startSprint($, minutes)
    await openLab($, 2)

    return { text: `Sprint started: ${minutes} min. Balloons rise in the lab Fun tab at the end, with a toast.${note}` }
  }

  if (name === 'ayjot') {
    if (arg === '') {
      const list = await read($, journalA)

      return { text: list.length === 0 ? 'The journal is empty: /ayjot <text>' : list.slice(-5).map(x => `${x.d}  ${x.t}`).join('\n') }
    }
    await addJot($, arg)

    return { text: `Added to today's page (${(await read($, journalA)).length}/${JOURNAL_MAX} days kept). The lab Text tab flips between days.` }
  }

  if (name === 'aygrow') {
    const g = await read($, growA)
    const stage = stageOf(g.days)
    const toNext = daysToNext(g.days)
    const rows = plantFrame(stage, stage, -1, false)

    return {
      text: `${rows.join('\n')}\nDay ${g.days} of running a tool call, stage ${stage}/6${toNext > 0 ? `, ${toNext} more day${toNext === 1 ? '' : 's'} to the next` : ', in full bloom'}. It counts days, not a streak.`,
    }
  }

  if (name === 'ayrocket') {
    if (arg === 'todo') {
      await setRocketPct($, todoPercent(await read($, todosA)), 'todo')
      await openLab($, 2)

      return { text: `The rocket follows /aytodo: ${(await read($, rocketA)).pct}%.${note}` }
    }
    const pct = parsePercent(arg)

    if (pct === undefined) {
      const r = await read($, rocketA)

      return { text: `Rocket: ${r.pct}% (${r.mode}). Usage: /ayrocket <percent 0-100> | todo` }
    }
    await setRocketPct($, pct, 'manual')
    await openLab($, 2)

    return { text: `Rocket at ${pct}%.${note}` }
  }

  if (name === 'aytodo') {
    const [word = '', ...rest] = arg.split(/\s+/)
    const tail = rest.join(' ').trim()

    if (word === '') {
      return { text: todoLines(await read($, todosA)) }
    }

    if (word === 'add') {
      if (tail === '') {
        return { text: 'Usage: /aytodo add <text>' }
      }

      if ((await read($, todosA)).length >= TODO_MAX) {
        return { text: `At most ${TODO_MAX} todos: finish some, or /aytodo clear.` }
      }
      await update($, todosA, l => [...l, { t: tail.slice(0, TODO_CHARS), done: false }])
    } else if (word === 'done' || word === 'undo' || word === 'rm') {
      const n = Number(tail)
      const list = await read($, todosA)

      if (!Number.isInteger(n) || n < 1 || n > list.length) {
        return { text: `Usage: /aytodo ${word} <number 1-${Math.max(1, list.length)}>` }
      }
      await update($, todosA, l =>
        word === 'rm' ? l.filter((_, i) => i !== n - 1) : l.map((x, i) => (i === n - 1 ? { ...x, done: word === 'done' } : x)),
      )
    } else if (word === 'clear') {
      await update($, todosA, () => [])
    } else {
      return { text: 'Usage: /aytodo [add <text> | done <n> | undo <n> | rm <n> | clear]' }
    }
    await saveTodos($)
    await syncRocketToTodos($)
    const todos = await read($, todosA)

    return { text: `${todoLines(todos)}\n${todoPercent(todos)}% done${(await read($, rocketA)).mode === 'todo' ? '' : ' (the rocket follows them after /ayrocket todo)'}` }
  }

  if (name === 'ayreset') {
    await resetAll($)

    return { text: 'anim-more data cleared: switches off, spinner, plant, journal, todos, rocket, sprint and texts.' }
  }

  return { text: 'Unknown anim-more command: try /ay' }
}

// ---- the mod ---------------------------------------------------------------------------------------------------------------------------------------------
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) {
      await $.command.register(c).catch(() => undefined)
    }
    await resetTransient($)
    await load($)
    await touch($)
    await markActive($)
    await refreshSpend($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnAt = await $.clock.now()
      await markActive($)
      await update($, busyA, () => true)
      await kick($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const t = await $.clock.now()
      await update($, busyA, () => false)
      await touch($)
      await markActive($)

      if (turnAt > 0 && t - turnAt >= LONG_TURN_MS && !(await read($, calmA))) {
        const secs = Math.round((t - turnAt) / 1000)
        await showToast($, `Turn finished in ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`)
      }
      turnAt = 0
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.abort', async ($, e, next) => {
    await update($, busyA, () => false)
    turnAt = 0

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const info = e as unknown as CallInfo
    await onToolStart($).catch(() => undefined)
    let outcome: unknown
    let isThrown = true

    try {
      const ran = await next(e)
      outcome = ran
      isThrown = false

      return ran
    } finally {
      await onToolEnd($, info, outcome, isThrown).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)

    if (e.id === LAB) {
      await update($, labA, () => false)
    }

    return closed
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ay' }, async ($, e) => runCommand($, 'ay', e.args))
  on('command.run', { command: 'aylab' }, async ($, e) => runCommand($, 'aylab', e.args))
  on('command.run', { command: 'aydemo' }, async ($, e) => runCommand($, 'aydemo', e.args))
  on('command.run', { command: 'aywave' }, async ($, e) => runCommand($, 'aywave', e.args))
  on('command.run', { command: 'ayrain' }, async ($, e) => runCommand($, 'ayrain', e.args))
  on('command.run', { command: 'ayspin' }, async ($, e) => runCommand($, 'ayspin', e.args))
  on('command.run', { command: 'aytype' }, async ($, e) => runCommand($, 'aytype', e.args))
  on('command.run', { command: 'aymarquee' }, async ($, e) => runCommand($, 'aymarquee', e.args))
  on('command.run', { command: 'aytoast' }, async ($, e) => runCommand($, 'aytoast', e.args))
  on('command.run', { command: 'aysprint' }, async ($, e) => runCommand($, 'aysprint', e.args))
  on('command.run', { command: 'ayjot' }, async ($, e) => runCommand($, 'ayjot', e.args))
  on('command.run', { command: 'aygrow' }, async ($, e) => runCommand($, 'aygrow', e.args))
  on('command.run', { command: 'ayrocket' }, async ($, e) => runCommand($, 'ayrocket', e.args))
  on('command.run', { command: 'aytodo' }, async ($, e) => runCommand($, 'aytodo', e.args))
  on('command.run', { command: 'ayreset' }, async ($, e) => runCommand($, 'ayreset', e.args))

  // The one band segment. It renders nothing (`next(e)`) unless the band wave is on and a turn runs,
  // or a rain or fireworks burst is playing (those two are opt-in via /ayrain on). Calm: never.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isCollapsed || (await read($, calmA))) {
      return next(e)
    }
    // Cheap exit first: this row only draws when the wave or the rain switch is on (both off by default).
    // readView() makes about 25 state reads, far too many for every redraw of the band.
    const quick = await read($, cfgA)

    if (quick.wave !== true && quick.rain !== true) {
      return next(e)
    }
    const v = await readView($)
    const isWorking = v.busy || e.props.isWorking
    const isWave = v.cfg.wave && isWorking
    const rain = v.cfg.rain && v.isAnim ? rainFrame(v.ageOf('rain'), v.seed, 24, 3, true) : []
    const fire = v.cfg.rain && v.isAnim ? fireworksFrame(v.ageOf('fire'), v.seed, 40, 5, true) : []

    if (!isWave && rain.length === 0 && fire.length === 0) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        {fire.map(row => (
          <Text color="warning">{row}</Text>
        ))}
        {rain.map(row => (
          <Text color={v.accent}>{row}</Text>
        ))}
        {isWave && (
          <Box>
            <Text color={v.accent}>{waveRow(v.now, 16, v.isAnim)}</Text>
            <Text color="subtle"> working</Text>
          </Box>
        )}
      </Box>
    )
  })

  // The lab pane: each piece large, over three tabs.
  on('ui.render', { component: 'Pane', requestId: LAB }, async ($, e) => {
    const v = await readView($)
    const { Box, Button, Text } = $.ui.resolve(e)
    const W = Math.max(20, Math.min(48, e.props.bodyColumns - 4))
    const heading = (s: string) => <Text color="subtle">{s}</Text>
    const age = v.ageOf
    const spin = spinnerFrame(v.cfg.spin, v.now, v.isAnim && v.isBusyLike)

    if (e.props.placement === 'widget') {
      const plant = plantOf(v)

      return (
        <Box flexDirection="column">
          <Text color={v.accent}>{`${spin} ${v.busy ? 'working' : 'idle'}  ${v.badgeGlyph} ${v.errs}  plant ${plant.stage}/6`}</Text>
        </Box>
      )
    }

    const strip = (
      <Box flexDirection="row" gap={0}>
        {TABS.map((name, i) => (
          <Button key={`tab-${i}`} label={` ${name}`.padEnd(8, ' ')} plain dimColor={v.tab !== i} onPress={() => { void pressTab($, i) }} />
        ))}
      </Box>
    )

    // ---- UI tab ----
    const tipAge = age('tip')
    const tipBox = (
      <Box flexDirection="column">
        {heading('143  pop-in hint')}
        <Button key="tip" label="(?) what is this" dimColor onPress={() => { void toggleTip($) }} />
        <Text color="subtle">{tipAge < 0 ? ' ' : `▏ ${tooltipFrame(HINT, tipAge, v.isAnim)}`}</Text>
      </Box>
    )

    const glowAge = age('glow')
    const isGlowing = v.isAnim && (v.isBusyLike || (glowAge >= 0 && glowAge < GLOW_MS))
    const glow = glowFrame(v.now, isGlowing)
    const glowBox = (
      <Box flexDirection="column">
        {heading('144  breathing glow')}
        <Box borderStyle="round" borderColor={glow.side === 'a' ? v.accent : 'subtle'} borderDimColor={glow.isDim} paddingX={1}>
          <Text color={glow.side === 'a' ? v.accent : 'subtle'}>{v.busy ? 'working: the border breathes' : 'the active element'}</Text>
        </Box>
        <Button key="glow" label="breathe" dimColor onPress={() => { void stamp($, 'glow') }} />
      </Box>
    )

    const under = underlineFrame(9, age('under'), v.isAnim)
    const underBox = (
      <Box flexDirection="column">
        {heading('145  underline draw')}
        <Button key="under" label="Open docs" plain onPress={() => { void stamp($, 'under') }} />
        <Box>
          <Text color={v.accent}>{under.hot}</Text>
          <Text color="inactive">{under.rest}</Text>
        </Box>
      </Box>
    )

    const squishBox = (
      <Box flexDirection="column">
        {heading('146  button squish')}
        <Box>
          <Box width={16} borderStyle="round" borderColor="subtle" paddingLeft={squishFrame(age('squishA'), v.isAnim)}>
            <Button key="sqA" label="Save" onPress={() => { void stamp($, 'squishA') }} />
          </Box>
          <Box width={16} borderStyle="round" borderColor="subtle" paddingLeft={squishFrame(age('squishB'), v.isAnim)}>
            <Button key="sqB" label="Run" onPress={() => { void stamp($, 'squishB') }} />
          </Box>
        </Box>
      </Box>
    )

    const toastBox = (
      <Box flexDirection="column">
        {heading('147  staged toast (status line, once per 3 min)')}
        <Text color={v.accent}>{v.toast.at > 0 ? toastFrame(v.toast.text, Math.max(0, v.now - v.toast.at), v.isAnim) : ' '}</Text>
        <Button key="toast" label="show a toast" dimColor onPress={() => { void showToast($, 'Saved: lab sample') }} />
      </Box>
    )

    const waveBox = (
      <Box flexDirection="column">
        {heading('148  wave under a working indicator')}
        <Text color={v.accent}>{waveRow(v.now, W, v.isAnim && v.isBusyLike)}</Text>
        <Text color="inactive">{v.isBusyLike ? 'a turn is running' : 'idle: it waves while a turn runs (band: /aywave on)'}</Text>
      </Box>
    )

    const spinBox = (
      <Box flexDirection="column">
        {heading(`149  orbiting dots: ${v.cfg.spin}`)}
        <Box gap={2}>
          <Text color={v.accent} size="title">{spin}</Text>
          <Button key="spin" label="next variant" dimColor onPress={() => { void cycleSpinner($) }} />
        </Box>
      </Box>
    )

    // ---- Text tab ----
    const typeText = v.texts.type === '' ? SAMPLE_TYPE : v.texts.type
    const typed = typeFrame(typeText, age('type'), v.isAnim)
    const typeBox = (
      <Box flexDirection="column">
        {heading('150  typewriter (/aytype <text>)')}
        <Text>{`${typed.shown}${typed.hasCursor ? '▌' : ''}`}</Text>
        <Button key="type" label="replay" dimColor onPress={() => { void replayType($) }} />
      </Box>
    )

    const path = v.texts.marquee === '' ? SAMPLE_PATH : v.texts.marquee
    const marqueeBox = (
      <Box flexDirection="column">
        {heading('151  marquee (/aymarquee <text>)')}
        <Text color="suggestion">{marqueeFrame(path, W - 2, age('marquee'), v.isAnim)}</Text>
        <Button key="marquee" label="scroll" dimColor onPress={() => { void replayMarquee($) }} />
      </Box>
    )

    const pulse = pulseFrame(age('pulse'), v.isAnim)
    const badgeColor = pulse === 'bright' ? 'error' : pulse === 'dim' ? 'subtle' : v.errs > 0 ? 'error' : 'inactive'
    const badgeBox = (
      <Box flexDirection="column">
        {heading('152  pulsing badge (new tool errors)')}
        <Box gap={1}>
          <Text color={badgeColor} weight={pulse === 'bright' ? 'bold' : 'regular'}>{`${v.badgeGlyph} ${v.errs}`}</Text>
          <Text color="inactive">{v.errs === 0 ? 'no tool errors yet' : `tool error${v.errs === 1 ? '' : 's'} this session`}</Text>
        </Box>
        <Button key="pulse" label="replay pulse" dimColor onPress={() => { void stamp($, 'pulse') }} />
      </Box>
    )

    const dripAge = v.spend.at > 0 ? Math.max(0, v.now - v.spend.at) : -1
    const drip = dripFrame(dripAge, v.spend.from, v.spend.to, v.isAnim)
    const dripBox = (
      <Box flexDirection="column">
        {heading('153  drip on spend')}
        {[0, 1, 2].map(r => (
          <Text color="warning">{drip.drop === r ? '  ▾' : ' '}</Text>
        ))}
        <Text tabular color={drip.figure !== v.spend.to ? 'warning' : 'subtle'}>{v.spend.isKnown ? fmtSpend(drip.figure) : '$--'}</Text>
        <Button key="drip" label="replay" dimColor onPress={() => { void replayDrip($) }} />
      </Box>
    )

    const pagesCount = v.journal.length > 0 ? v.journal.length : SAMPLE_PAGES.length
    const flip = flipFrame(pageOf(v, v.jflip.from), pageOf(v, v.jflip.idx), age('flip'), W, v.isAnim)
    const flipBox = (
      <Box flexDirection="column">
        {heading(`158  page flip${v.journal.length === 0 ? ' (sample pages: /ayjot <text>)' : ''}`)}
        <Text>{middleTruncate(flip, W)}</Text>
        <Box gap={2}>
          <Button key="prev" label="‹ prev" dimColor onPress={() => { void flipJournal($, -1) }} />
          <Text color="inactive">{`page ${v.jflip.idx + 1}/${pagesCount}`}</Text>
          <Button key="next" label="next ›" dimColor onPress={() => { void flipJournal($, 1) }} />
        </Box>
      </Box>
    )

    const plant = plantOf(v)
    const toNext = daysToNext(v.grow.days)
    const plantBox = (
      <Box flexDirection="column">
        {heading('154  plant (grows by the day you run a tool call)')}
        <Box gap={2}>
          <Box flexDirection="column">
            {plant.rows.map(r => (
              <Text color="success">{r}</Text>
            ))}
          </Box>
          <Text color="subtle">{`day ${v.grow.days} · stage ${plant.stage}/6${plant.isDemo ? ' (preview)' : toNext > 0 ? ` · ${toNext} to next` : ' · in bloom'}`}</Text>
        </Box>
        <Button key="plant" label="preview growth" dimColor onPress={() => { void stamp($, 'plantDemo') }} />
      </Box>
    )

    // ---- Fun tab ----
    const rain = rainFrame(age('rain'), v.seed, W, 3, v.isAnim)
    const rainBox = (
      <Box flexDirection="column">
        {heading('155  rain (after a build or test, /ayrain on)')}
        {rain.length > 0 ? rain.map(r => <Text color={v.accent}>{r}</Text>) : <Text color="inactive">{age('rain') >= 0 ? '✓ built' : 'falls after a build succeeds'}</Text>}
        <Button key="rain" label="play rain" dimColor onPress={() => { void update($, seedA, n => n + 1).then(() => stamp($, 'rain')) }} />
      </Box>
    )

    const fire = fireworksFrame(age('fire'), v.seed, W, 5, v.isAnim)
    const fireBox = (
      <Box flexDirection="column">
        {heading('156  fireworks (after a git tag, /ayrain on)')}
        {fire.length > 0 ? fire.map(r => <Text color="warning">{r}</Text>) : <Text color="inactive">{age('fire') >= 0 ? '✓ tagged' : 'bursts after a git tag succeeds'}</Text>}
        <Button key="fire" label="play fireworks" dimColor onPress={() => { void update($, seedA, n => n + 1).then(() => stamp($, 'fire')) }} />
      </Box>
    )

    const balloons = balloonsFrame(age('balloons'), W, 5, v.isAnim)
    const balloonBox = (
      <Box flexDirection="column">
        {heading('157  balloons (end of a sprint)')}
        {balloons.length > 0 ? balloons.map(r => <Text color="claude">{r}</Text>) : <Text color="inactive">/aysprint &lt;minutes&gt;: they rise at the end</Text>}
        <Box gap={2}>
          <Button key="sprint1" label="1-min sprint" dimColor onPress={() => { void startSprint($, 1) }} />
          <Button key="balloons" label="play" dimColor onPress={() => { void stamp($, 'balloons') }} />
          <Button key="sprint0" label="clear" dimColor onPress={() => { void stopSprint($) }} />
        </Box>
      </Box>
    )

    const isSprint = v.sprint !== null && v.now < v.sprint.endAt
    const dialBox = (
      <Box flexDirection="column">
        {heading('159  dial (spins while a sprint runs)')}
        <Box gap={2}>
          <Text color={v.accent} size="title">{dialFrame(v.now, v.isAnim && (isSprint || v.isDemo))}</Text>
          <Text color="inactive">{v.sprint === null ? 'no sprint running' : `ends at ${fmtClock(v.sprint.endAt)}`}</Text>
        </Box>
      </Box>
    )

    const isIdle = v.isDemo || v.now - v.active >= IDLE_MS
    const swing = pendulumFrame(v.now, v.isAnim && isIdle)
    const pendulumBox = (
      <Box flexDirection="column">
        {heading('160  pendulum (swings after 60 s idle)')}
        {swing.map(r => (
          <Text color="subtle">{r}</Text>
        ))}
      </Box>
    )

    const petAge = age('pet')
    const isWalking = v.isAnim && (v.isBusyLike || (petAge >= 0 && petAge < PET_MS))
    const petBox = (
      <Box flexDirection="column">
        {heading('161  walking pet (while a turn runs)')}
        <Text color="claude">{petFrame(Math.floor(v.now / TICK_MS), isWalking)}</Text>
        <Button key="pet" label="walk" dimColor onPress={() => { void stamp($, 'pet') }} />
      </Box>
    )

    const rocketPct = v.isDemo && v.rocket.pct === 0 ? Math.min(100, Math.round((v.demoAge / DEMO_MS) * 100)) : v.rocket.pct
    const rAge = v.rocket.at > 0 ? Math.max(0, v.now - v.rocket.at) : -1
    const done = v.todos.filter(x => x.done).length
    const rocketBox = (
      <Box flexDirection="column">
        {heading('162  rocket progress')}
        <Box gap={1}>
          <Text color={v.accent}>{rocketFrame(rocketPct, v.rocket.from, rAge, v.isAnim)}</Text>
          <Text tabular color="subtle">{`${rocketPct}%`}</Text>
        </Box>
        <Text color="inactive">
          {v.rocket.mode === 'todo' ? `following todos: ${done}/${v.todos.length} done` : 'manual: /ayrocket <percent> or /ayrocket todo'}
        </Text>
        <Button key="rocket" label="+25%" dimColor onPress={() => { void bumpRocket($) }} />
      </Box>
    )

    return (
      <Box flexDirection="column" gap={v.gap}>
        {strip}
        {v.tab === 0 && (
          <Box flexDirection="column" gap={v.gap}>
            {tipBox}
            {glowBox}
            {underBox}
            {squishBox}
            {toastBox}
            {waveBox}
            {spinBox}
          </Box>
        )}
        {v.tab === 1 && (
          <Box flexDirection="column" gap={v.gap}>
            {typeBox}
            {marqueeBox}
            {badgeBox}
            {dripBox}
            {flipBox}
            {plantBox}
          </Box>
        )}
        {v.tab === 2 && (
          <Box flexDirection="column" gap={v.gap}>
            {rainBox}
            {fireBox}
            {balloonBox}
            {dialBox}
            {pendulumBox}
            {petBox}
            {rocketBox}
          </Box>
        )}
        {!v.isAnim && <Text color="warning">Motion is off or settings are calm: every piece shows its static final frame.</Text>}
      </Box>
    )
  })
}
