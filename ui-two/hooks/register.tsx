import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register, Timer } from 'claude-code'

import type { Data, Kind, Ui } from '../types'
import { graphSvg, svgAlt, timelineSvg, tipsSvg, treemapSvg } from './draw'
import type { Accent } from './draw'
import {
  CAP,
  COLUMNS,
  COL_LABEL,
  COL_LIST,
  FEATURE_DEFAULTS,
  GROUPS,
  VIEWS,
  addCard,
  addGoal,
  addLib,
  addNotice,
  addSpend,
  bar,
  baseName,
  beginTurn,
  budgetCheck,
  budgetStatus,
  calText,
  calendar,
  cell,
  clip,
  cmdMatches,
  compare,
  dayKey,
  digestText,
  dueGoals,
  dueText,
  emptyData,
  emptyUi,
  eventLine,
  exportPrompts,
  feedItems,
  feedKinds,
  finishPomo,
  fmtDur,
  focusScore,
  forecast,
  graph,
  groupOf,
  headerLabel,
  hhmm,
  hhmmss,
  importPrompts,
  isEditTool,
  markFired,
  mmss,
  modelStats,
  moveCard,
  paged,
  parseGoal,
  parsePromptAdd,
  parseUsd,
  pomoLeft,
  presentFigures,
  printLines,
  recordCall,
  recordPrompt,
  recordTurn,
  removeCard,
  replayState,
  rollBudget,
  sanitize,
  sanitizeUi,
  setBudget,
  setRead,
  sortEvents,
  spark,
  startPomo,
  startSession,
  tableEvents,
  tableLine,
  tagStats,
  timelineBands,
  tips,
  toggleCol,
  toolCards,
  treemap,
  unread,
  usd,
} from './pure'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]
type K = ElementTable<'desktop'>
type Tone = 'success' | 'error' | 'warning' | 'suggestion' | 'subtle' | 'inactive' | 'claude' | 'permission' | 'remember'
type Gap = 'xs' | 'sm' | 'md'

// ---- foreign atoms (read only): `motion` owns isOn, `settings` owns the rest -----------------------
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const calmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })

// ---- this mod's own atoms -----------------------------------------------------------------------------
const dataA = atom({ plugin: 'ui-two', key: 'data' } as const, emptyData(), { shape: 'data-1' })
const uiA = atom({ plugin: 'ui-two', key: 'ui' } as const, emptyUi(), { shape: 'ui-1' })
const nowA = atom({ plugin: 'ui-two', key: 'now' } as const, 0)

const PANE = 'ui-two-main'
const STORE_KEY = 'uj.data'
const TOAST_GAP_MS = 180_000
const PAGE = 12

// ---- switches: features.json holds the same ids and defaults ---------------------------------------
const isOn = async ($: Dollar, id: string): Promise<boolean> => {
  const o = (await read($, featuresA)) as Record<string, boolean>

  return o[id] ?? FEATURE_DEFAULTS[id] ?? false
}

// ---- data ----------------------------------------------------------------------------------------------
const mutate = async ($: Dollar, fn: (d: Data) => Data) => {
  await update($, dataA, fn)
  await $.store.set(STORE_KEY, await read($, dataA))
}
const setUi = async ($: Dollar, patch: Partial<Ui>) => {
  await update($, uiA, u => ({ ...u, ...patch }))
}

const asInput = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const isFailure = (r: unknown): boolean => {
  const o = asInput(r)

  return typeof o.deny === 'string' || o.isError === true
}
const fileOf = (input: Record<string, unknown>): string | undefined =>
  typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined

// ---- quiet toasts: calm means none (except an urgent one), and at most one per 3 minutes -----------------
let lastToastAt = 0
const raise = async ($: Dollar, text: string, urgent = false): Promise<boolean> => {
  const t = await $.clock.now()

  if ((!urgent && (await read($, calmA))) || (lastToastAt > 0 && t - lastToastAt < TOAST_GAP_MS)) {
    return false
  }
  lastToastAt = t
  await $.ui.toast(text, { timeoutMs: 5000 })

  return true
}
/** A notice for the notification center (a bounded list of what this mod raised). */
const notify = async ($: Dollar, kind: string, text: string) => {
  if (await isOn($, 'notice-log')) {
    const t = await $.clock.now()
    await mutate($, d => addNotice(d, kind, text, t))
  }
}

// ---- animation: only the live pomodoro countdown, from one ticker that stops itself -------------------------
let ticker: Timer | undefined
let pomoTimer: Timer | undefined
let minuteTimer: Timer | undefined

const animOk = async ($: Dollar): Promise<boolean> => {
  const flag = await $.store.get('motion')
  const isStoredOff = flag === false || flag === 'off' || flag === 0 || flag === 'false'

  return (await read($, motionIsOn)) && !isStoredOff && !(await read($, calmA))
}
const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
}
const finishNow = async ($: Dollar) => {
  const t = await $.clock.now()
  const p = (await read($, dataA)).pomo

  if (p === null || t < p.endsAt) {
    return
  }
  pomoTimer?.cancel()
  pomoTimer = undefined
  await mutate($, d => finishPomo(d, t))
  stopTicker()
  const text = p.kind === 'work' ? `Pomodoro done${p.task !== '' ? `: ${p.task}` : ''}. Take a break.` : 'Break over.'
  await notify($, 'pomodoro', text)

  if (await isOn($, 'pomo-toast')) {
    await raise($, text)
  }
}
const tickLive = async ($: Dollar) => {
  const t = await $.clock.now()
  await update($, nowA, () => t)
  await finishNow($)
}
/** The countdown redraws each second only while a pomodoro runs, motion is on, calm is off and the switch is on. */
const syncTicker = async ($: Dollar) => {
  const running = (await read($, dataA)).pomo !== null
  const want = running && (await animOk($)) && (await isOn($, 'live-timer'))

  if (want && ticker === undefined) {
    ticker = $.clock.every(1000, () => {
      void tickLive($)
    })
  }

  if (!want) {
    stopTicker()
  }
}
const schedulePomo = async ($: Dollar) => {
  pomoTimer?.cancel()
  pomoTimer = undefined
  const p = (await read($, dataA)).pomo

  if (p !== null) {
    const t = await $.clock.now()
    pomoTimer = $.clock.after(Math.max(0, p.endsAt - t) + 50, () => {
      void finishNow($)
    })
  }
  await syncTicker($)
}

// ---- alerts: budget at 80 and 100 percent, goals at their due time --------------------------------------------
const checkBudget = async ($: Dollar) => {
  const t = await $.clock.now()
  const before = await read($, dataA)

  if (before.budget.perDay <= 0) {
    return
  }
  const r = budgetCheck(before, t)
  await mutate($, () => r.d)

  for (const level of r.fire) {
    const text = `Budget ${level}%: ${usd(r.status.spent)} of ${usd(r.status.allowance)} today (estimate). Nothing is blocked.`
    await notify($, 'budget', text)

    if (await isOn($, level === 80 ? 'budget-warn-80' : 'budget-warn-100')) {
      await raise($, text, level === 100)
    }
  }
}
const checkGoals = async ($: Dollar) => {
  const t = await $.clock.now()
  const due = dueGoals(await read($, dataA), t)

  if (due.length === 0) {
    return
  }
  await mutate($, d => markFired(d, due.map(g => g.id)))

  for (const g of due) {
    await notify($, 'goal', `Goal due: ${g.text}`)
  }

  if (await isOn($, 'goal-toasts')) {
    await raise($, `Goal due: ${due[0]!.text}${due.length > 1 ? ` (+${due.length - 1} more)` : ''}`)
  }
}
const morning = async ($: Dollar) => {
  const t = await $.clock.now()
  const today = dayKey(t)
  const d = await read($, dataA)

  if (!(await isOn($, 'digest-morning')) || d.lastDigest === today || new Date(t).getHours() >= 12) {
    return
  }
  await mutate($, x => ({ ...x, lastDigest: today }))
  const y = d.days[dayKey(t - 86_400_000)]
  const text = y === undefined ? 'Good morning. Nothing was recorded yesterday. /ujdigest for the digest.' : `Good morning: yesterday ${y.tools} tool calls, ${y.edits} edits, ${y.errors} errors, ${usd(y.usd)} (estimate). /ujdigest for more.`
  await notify($, 'digest', text)
  await raise($, text)
}
const minuteTick = async ($: Dollar) => {
  await checkGoals($)
  await finishNow($)
}

// ---- recording --------------------------------------------------------------------------------------------------
const recordSpend = async ($: Dollar, force: boolean) => {
  if (!(await isOn($, 'record-spend'))) {
    return
  }
  let cost: number | undefined

  try {
    cost = (await $.session.usage()).cost?.usd
  } catch {
    cost = undefined
  }
  const t = await $.clock.now()
  await mutate($, d => addSpend(d, cost, t, force))
  await checkBudget($)
}
const onCall = async ($: Dollar, e: unknown, tool: string, start: number, ok: boolean) => {
  const end = await $.clock.now()

  if (await isOn($, 'record-activity')) {
    const file = fileOf(asInput(e))
    await mutate($, d => recordCall(d, { t: end, tool, file, ms: end - start, ok }))
  }
  await recordSpend($, false)
}
const onPrompt = async ($: Dollar, text: string, isCommand: boolean) => {
  const t = await $.clock.now()

  if (await isOn($, 'record-prompts')) {
    const excerpt = (await isOn($, 'prompt-excerpts')) ? text : undefined
    await mutate($, d => recordPrompt(d, { t, len: text.length, isCommand, excerpt }))
  }

  if (await isOn($, 'record-turns')) {
    await mutate($, d => beginTurn(d, text))
  }
}
const onTurn = async ($: Dollar, ms: number, model: string | undefined) => {
  await recordSpend($, true)

  if (await isOn($, 'record-turns')) {
    const t = await $.clock.now()
    await mutate($, d => recordTurn(d, { t, model, ms }))
  }
}

// ---- opening the pane --------------------------------------------------------------------------------------------
const openView = async ($: Dollar, view?: string): Promise<boolean> => {
  if (view !== undefined) {
    await setUi($, { view, group: groupOf(view), page: 0, pop: false })
  }
  const r = await $.ui.open({ id: PANE, title: 'UI two' })

  return r.isPlaced
}
const said = async ($: Dollar, view: string, text: string): Promise<{ text: string }> => {
  const isPlaced = await openView($, view)

  return { text: isPlaced ? text : `${text} (no surface is showing panes right now, so it will appear when one does)` }
}

// ---- actions shared by buttons and commands ---------------------------------------------------------------------
const doBudget = async ($: Dollar, arg: string): Promise<string> => {
  const t = await $.clock.now()

  if (arg === '' || arg === 'status') {
    const d = await read($, dataA)

    return d.budget.perDay > 0
      ? (() => {
          const s = budgetStatus(d, t)

          return `Budget ${usd(s.perDay)}/day, rollover ${usd(s.carry)} (cap ${usd(s.cap)}). Today ${usd(s.spent)} of ${usd(s.allowance)} (${Math.round(s.pct)}%, estimate). Nothing is blocked.`
        })()
      : 'No budget set. Type /ujbudget <usd per day>, for example /ujbudget 20.'
  }

  if (arg === 'off' || arg === '0') {
    await mutate($, d => setBudget(d, 0, t))

    return 'Budget guard off.'
  }
  const n = parseUsd(arg)

  if (n === undefined || n <= 0) {
    return 'Give dollars per day, like /ujbudget 20 (up to 99999.99), or off.'
  }
  await mutate($, d => setBudget(d, n, t))
  await checkBudget($)

  return `Budget set to ${usd(n)} per day. Unspent amount rolls into the next day up to ${usd(n * 2)}. Warning toasts need their switches (/cfg feature ui-two.budget-warn-80 on); nothing is ever blocked.`
}
const doStartPomo = async ($: Dollar, kind: 'work' | 'break', minutes: number, card: number): Promise<string> => {
  const t = await $.clock.now()

  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
    return 'Minutes must be 1 to 120.'
  }
  const d = await read($, dataA)

  if (card !== 0 && !d.cards.some(c => c.id === card)) {
    return `No kanban card ${card}.`
  }
  await mutate($, x => startPomo(x, { kind, minutes, card, now: t }))
  await schedulePomo($)

  return `${kind === 'work' ? 'Pomodoro' : 'Break'} started: ${minutes} min${card !== 0 ? `, linked to card ${card}` : ''}.`
}
const doStopPomo = async ($: Dollar): Promise<string> => {
  pomoTimer?.cancel()
  pomoTimer = undefined
  stopTicker()
  const had = (await read($, dataA)).pomo !== null
  await mutate($, d => ({ ...d, pomo: null }))

  return had ? 'Timer stopped (it does not count as done).' : 'No timer is running.'
}
const doAddCard = async ($: Dollar, text: string): Promise<string> => {
  const r = addCard(await read($, dataA), text)

  if (r === undefined) {
    return `A card needs some text, and at most ${CAP.cards} cards are kept.`
  }
  await mutate($, () => r)

  return `Card ${r.cardSeq} added to Todo.`
}
const doAddGoal = async ($: Dollar, arg: string): Promise<string> => {
  const t = await $.clock.now()
  const p = parseGoal(arg, t)

  if ('error' in p) {
    return p.error
  }
  const r = addGoal(await read($, dataA), p.due, p.text)

  if (r === undefined) {
    return `At most ${CAP.goals} goals are kept.`
  }
  await mutate($, () => r)

  return `Goal ${r.goalSeq} added, due ${dayKey(p.due)} ${hhmm(p.due)} (${dueText(p.due, t)}).`
}
const doAddPrompt = async ($: Dollar, arg: string): Promise<string> => {
  const p = parsePromptAdd(arg)

  if ('error' in p) {
    return p.error
  }
  const r = addLib(await read($, dataA), p)

  if ('error' in r) {
    return r.error
  }
  await mutate($, () => r)

  return `Prompt ${r.libSeq} saved${p.tags.length > 0 ? ` with tags ${p.tags.join(', ')}` : ''}.`
}
const doImport = async ($: Dollar, raw: string): Promise<string> => {
  const r = importPrompts(await read($, dataA), raw)

  if (!r.ok) {
    return `Import refused: ${r.error}`
  }
  await mutate($, () => r.data)

  return `Imported ${r.added} prompt${r.added === 1 ? '' : 's'}${r.skipped > 0 ? `, skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}` : ''}.`
}
const doUse = async ($: Dollar, id: number): Promise<string> => {
  const p = (await read($, dataA)).lib.find(l => l.id === id)

  if (p === undefined) {
    return `No prompt ${id}.`
  }
  await $.prompt.fill({ text: p.text, mode: 'replace' })

  return `Prompt "${p.title}" is in the prompt box. Send it as it is and its turn is measured (heuristic).`
}
const doReset = async ($: Dollar, all: boolean): Promise<string> => {
  const keep = await read($, dataA)
  const fresh = emptyData()
  const next: Data = all ? fresh : { ...fresh, cards: keep.cards, cardSeq: keep.cardSeq, goals: keep.goals, goalSeq: keep.goalSeq, lib: keep.lib, libSeq: keep.libSeq, cmds: keep.cmds, budget: { ...keep.budget, carry: 0, asOf: '', w80: '', w100: '' }, pomo: keep.pomo }
  pomoTimer?.cancel()
  pomoTimer = undefined

  if (all) {
    stopTicker()
  }
  await update($, dataA, () => next)
  await $.store.set(STORE_KEY, next)
  await setUi($, { pos: -1, msg: '', exp: '', page: 0 })
  await schedulePomo($)

  return all ? 'Cleared everything ui-two stored, including your cards, goals, prompts and commands.' : 'Cleared the recorded activity, spend, turns, notices and stats. Kept your cards, goals, prompt library, command list and budget setting (/ujreset all clears those too).'
}

// ---- help --------------------------------------------------------------------------------------------------------
const HELP = [
  'UI two (one pane `ui-two-main` with a view switcher: Activity, Charts, Work, Prompts):',
  '/uj                       this list',
  '/ujview <name>            open a view: ' + VIEWS.map(v => v.id).join(', '),
  '/ujfeed                   activity feed with kind filters',
  '/ujkanban [text]          open the kanban board (with text: add a Todo card)',
  '/ujcmd add|rm|list|reset  the stored command list for the command bar',
  '/ujnotice [read|unread|clear]  notification center (this mod\'s own notices)',
  '/ujbudget <usd/day>|off   daily budget with rollover (warnings are toasts behind switches; never blocks)',
  '/ujspend                  budget, rollover and the cost forecast',
  '/ujforecast               projected spend for today (plain linear estimate)',
  '/ujprompt add|list|use|rm|export|import   shareable prompt library with tags (strict JSON)',
  '/ujdigest [daily|weekly]  text digest',
  '/ujgoal add <date|+2h> <text> | done <id> | rm <id> | list   goals with due dates',
  '/ujpomo start [min] [card <id>] | break [min] | stop | status   pomodoro timer linked to a card',
  '/ujfocus                  focus score: share of file tool calls on the busiest directory (last hour)',
  '/ujreplay                 step back and forward through recorded events',
  '/ujprint                  light plain-text print view',
  '/ujpresent                presentation view: large figures only, no names or paths',
  '/ujreset [all]            clear recorded data (all: also your cards, goals, prompts, commands)',
  'Switches: /cfg feature ui-two.<id> on|off. Toasts, the morning digest, goal and pomodoro toasts and the live countdown are off until you switch them on.',
].join('\n')

const COMMANDS: { name: string; description: string }[] = [
  { name: 'uj', description: 'UI two: list every command' },
  { name: 'ujview', description: 'UI two: open a view of the pane' },
  { name: 'ujfeed', description: 'UI two: activity feed' },
  { name: 'ujkanban', description: 'UI two: kanban board, or add a card' },
  { name: 'ujcmd', description: 'UI two: manage the stored command list' },
  { name: 'ujnotice', description: 'UI two: notification center' },
  { name: 'ujbudget', description: 'UI two: daily budget with rollover' },
  { name: 'ujspend', description: 'UI two: spend, budget and forecast view' },
  { name: 'ujforecast', description: 'UI two: projected spend for today' },
  { name: 'ujprompt', description: 'UI two: shareable prompt library' },
  { name: 'ujdigest', description: 'UI two: daily or weekly digest' },
  { name: 'ujgoal', description: 'UI two: goals with due dates' },
  { name: 'ujpomo', description: 'UI two: pomodoro timer' },
  { name: 'ujfocus', description: 'UI two: focus score' },
  { name: 'ujreplay', description: 'UI two: session replay' },
  { name: 'ujprint', description: 'UI two: plain print view' },
  { name: 'ujpresent', description: 'UI two: presentation view' },
  { name: 'ujreset', description: 'UI two: clear recorded data' },
]

const idArg = (s: string): number | undefined => {
  const m = /^#?(\d{1,9})$/.exec(s.trim())

  return m === null ? undefined : Number(m[1])
}

const runKanban = async ($: Dollar, arg: string) => (arg === '' ? said($, 'kanban', 'Kanban board opened.') : { text: await doAddCard($, arg) })
const runCmd = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  const d = await read($, dataA)
  const [verb, ...rest] = arg.trim().split(/\s+/)
  const body = rest.join(' ').trim()

  if (verb === 'add' && body !== '') {
    if (d.cmds.length >= CAP.cmds || body.length > 200) {
      return { text: `At most ${CAP.cmds} commands of up to 200 characters.` }
    }
    await mutate($, x => ({ ...x, cmds: [...x.cmds, body] }))

    return { text: `Added to the command bar list (${d.cmds.length + 1} stored).` }
  }

  if (verb === 'rm' && idArg(body) !== undefined) {
    const i = idArg(body)! - 1

    if (i < 0 || i >= d.cmds.length) {
      return { text: 'No command with that number (see /ujcmd list).' }
    }
    await mutate($, x => ({ ...x, cmds: x.cmds.filter((_, j) => j !== i) }))

    return { text: 'Removed.' }
  }

  if (verb === 'reset') {
    await mutate($, x => ({ ...x, cmds: emptyData().cmds }))

    return { text: 'Command list back to its defaults.' }
  }

  return { text: d.cmds.map((c, i) => `${i + 1}. ${c}`).join('\n') + '\nAdd: /ujcmd add <text>. Remove: /ujcmd rm <number>.' }
}
const runNotice = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  if (arg === 'read' || arg === 'unread') {
    await mutate($, d => setRead(d, 'all', arg === 'read'))

    return { text: `All notices marked ${arg}.` }
  }

  if (arg === 'clear') {
    await mutate($, d => ({ ...d, notices: [] }))

    return { text: 'Notices cleared.' }
  }

  return said($, 'notices', `Notification center opened (${unread(await read($, dataA))} unread). It lists what this mod raised; other mods' toasts cannot be read.`)
}
const runForecast = async ($: Dollar): Promise<{ text: string }> => {
  const t = await $.clock.now()
  const f = forecast(await read($, dataA), t)

  if (!f.ok) {
    return { text: `${f.why} Spent today so far: ${usd(f.spent)} (estimate).` }
  }

  return { text: `Today so far ${usd(f.spent)}. At the recent rate of ${usd(f.rate)}/hour for the next ${f.hoursLeft.toFixed(1)}h (at most 8), about ${usd(f.projected)} by end of day. Approximate: a plain linear estimate from client-side cost figures.` }
}
const runPrompt = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(arg.trim())
  const verb = m?.[1] ?? 'list'
  const rest = m?.[2] ?? ''
  const d = await read($, dataA)

  if (verb === 'add') {
    return { text: await doAddPrompt($, rest) }
  }

  if (verb === 'use' && idArg(rest) !== undefined) {
    return { text: await doUse($, idArg(rest)!) }
  }

  if (verb === 'rm' && idArg(rest) !== undefined) {
    await mutate($, x => ({ ...x, lib: x.lib.filter(l => l.id !== idArg(rest)) }))

    return { text: 'Removed (if it existed).' }
  }

  if (verb === 'export') {
    return { text: exportPrompts(d) }
  }

  if (verb === 'import') {
    return { text: await doImport($, rest) }
  }

  if (verb === 'list' || verb === '') {
    return { text: d.lib.length === 0 ? 'The library is empty. /ujprompt add <title> :: <text> #tag' : d.lib.map(l => `${l.id}. ${l.title}${l.tags.length > 0 ? ` [${l.tags.join(' ')}]` : ''}`).join('\n') }
  }

  return { text: 'Use /ujprompt add | list | use <id> | rm <id> | export | import <json>.' }
}
const runGoal = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(arg.trim())
  const verb = m?.[1] ?? 'list'
  const rest = m?.[2] ?? ''
  const t = await $.clock.now()

  if (verb === 'add') {
    return { text: await doAddGoal($, rest) }
  }
  const id = idArg(rest)

  if (verb === 'done' && id !== undefined) {
    await mutate($, d => ({ ...d, goals: d.goals.map(g => (g.id === id ? { ...g, done: true } : g)) }))

    return { text: 'Marked done (if it existed).' }
  }

  if (verb === 'rm' && id !== undefined) {
    await mutate($, d => ({ ...d, goals: d.goals.filter(g => g.id !== id) }))

    return { text: 'Removed (if it existed).' }
  }
  const goals = (await read($, dataA)).goals

  return { text: goals.length === 0 ? 'No goals. /ujgoal add 2026-12-01 18:00 ship it, or /ujgoal add +2h write the notes.' : goals.map(g => `${g.id}. ${g.done ? '[done]' : '[open]'} ${g.text} (${dayKey(g.due)} ${hhmm(g.due)}, ${g.done ? 'done' : dueText(g.due, t)})`).join('\n') }
}
const runPomo = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  const parts = arg.trim().split(/\s+/).filter(Boolean)
  const verb = parts[0] ?? 'status'

  if (verb === 'stop') {
    return { text: await doStopPomo($) }
  }

  if (verb === 'start' || verb === 'break') {
    const min = parts[1] !== undefined && /^\d{1,3}$/.test(parts[1]) ? Number(parts[1]) : verb === 'start' ? 25 : 5
    const ci = parts.indexOf('card')
    const card = ci >= 0 ? (idArg(parts[ci + 1] ?? '') ?? -1) : 0

    if (card < 0) {
      return { text: 'Use: /ujpomo start [minutes] [card <id>].' }
    }

    return { text: await doStartPomo($, verb === 'start' ? 'work' : 'break', min, card) }
  }
  const t = await $.clock.now()
  const d = await read($, dataA)

  return { text: d.pomo === null ? `No timer running. Pomodoros today: ${d.days[dayKey(t)]?.pomos ?? 0}. /ujpomo start [minutes] [card <id>].` : `${d.pomo.kind === 'work' ? 'Pomodoro' : 'Break'}: ${mmss(pomoLeft(d.pomo, t))} left${d.pomo.task !== '' ? ` on "${d.pomo.task}"` : ''}.` }
}
const runView = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  const v = VIEWS.find(x => x.id === arg.trim().toLowerCase())

  return v === undefined ? { text: `Views: ${VIEWS.map(x => x.id).join(', ')}.` } : said($, v.id, `${v.label} view opened.`)
}

// ---- the pane ---------------------------------------------------------------------------------------------------------
type Ctx = {
  k: K
  Svg: K['Svg'] | undefined
  d: Data
  u: Ui
  now: number
  cols: number
  accent: Accent
  gap: Gap
  calm: boolean
  flags: Record<string, boolean>
  surface: string
}
const KIND_TONE: Record<Kind, Tone> = { tool: 'suggestion', edit: 'success', error: 'error', prompt: 'remember' }
const note = (c: Ctx, text: string) => (
  <c.k.Text dimColor size="caption">
    {text}
  </c.k.Text>
)
const section = (c: Ctx, text: string) => (
  <c.k.Text weight="semibold" color={c.accent}>
    {text}
  </c.k.Text>
)
const empty = (c: Ctx, what: string) => (
  <c.k.Text dimColor>
    {what}
  </c.k.Text>
)
const pager = ($: Dollar, c: Ctx, page: number, pages: number) =>
  pages <= 1 ? null : (
    <c.k.Box flexDirection="row" gap="xs">
      <c.k.Button key="uj-page-prev" label="◀ Newer" onPress={() => setUi($, { page: Math.max(0, page - 1) })} />
      <c.k.Text dimColor mono>
        page {page + 1}/{pages}
      </c.k.Text>
      <c.k.Button key="uj-page-next" label="Older ▶" onPress={() => setUi($, { page: Math.min(pages - 1, page + 1) })} />
    </c.k.Box>
  )
const noData = (c: Ctx) => c.d.events.length === 0 && Object.keys(c.d.days).length === 0

const viewOverview = ($: Dollar, c: Ctx) => {
  const { Box, Text, Svg } = { ...c.k, Svg: c.Svg }
  const ts = tips(c.d, c.now)
  const f = focusScore(c.d, c.now)

  return (
    <Box flexDirection="column" gap={c.gap}>
      <Text>
        Focus, last hour: <Text weight="bold">{f.n === 0 ? 'no file calls yet' : `${f.pct}%`}</Text>
        {f.n > 0 ? ` of ${f.n} file calls in ${f.dir}` : ''}
      </Text>
      {noData(c) && empty(c, 'Nothing recorded yet. Use Claude for a while and this fills in. Recording has switches: /cfg feature ui-two.record-activity.')}
      {Svg !== undefined ? (
        <Svg source={tipsSvg(ts, c.accent)} alt={svgAlt('Overview, 14 days per item', ts.length)} isInteractive {...svgSize(tipsSvg(ts, c.accent), 560)} />
      ) : (
        <Box flexDirection="column">
          {ts.map(t => (
            <Text mono>
              {t.label.padEnd(16)} {t.value.padEnd(8)} {spark(t.series)}
            </Text>
          ))}
        </Box>
      )}
      {note(c, Svg !== undefined ? 'Each bar is one day (last 14). Hover a bar for its day and value: that is the app\'s own small tooltip on the vector chart. Real popups are not possible in a mod.' : 'The sparkline is the last 14 days. The vector chart with hover tooltips needs the desktop app; the text tooltip is the line itself.')}
    </Box>
  )
}

const viewFeed = ($: Dollar, c: Ctx) => {
  const items = feedItems(c.d, c.u.kind)
  const p = paged(items, c.u.page, PAGE)

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      <c.k.Box flexDirection="row" gap="xs" flexWrap="wrap">
        {feedKinds.map(kd => (
          <c.k.Button key={`uj-kind-${kd}`} label={kd} variant={kd === c.u.kind ? 'primary' : 'secondary'} onPress={() => setUi($, { kind: kd, page: 0 })} />
        ))}
      </c.k.Box>
      {items.length === 0 && empty(c, 'No events of this kind yet.')}
      <c.k.Box flexDirection="column">
        {p.rows.map(e => (
          <c.k.Text mono color={KIND_TONE[e.k]}>
            {clip(eventLine(e), Math.max(30, c.cols - 2))}
          </c.k.Text>
        ))}
      </c.k.Box>
      {pager($, c, p.page, p.pages)}
      {note(c, `Newest first. ${items.length} of the last ${CAP.events} events kept. Prompts show only their length unless ui-two.prompt-excerpts is on.`)}
    </c.k.Box>
  )
}

const viewTable = ($: Dollar, c: Ctx) => {
  const rows = sortEvents(tableEvents(c.d), c.u.sort, c.u.dir)
  const p = paged(rows, c.u.page, PAGE)
  const shown = COLUMNS.filter(x => c.u.cols.includes(x.id))

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      <c.k.Box flexDirection="row" gap="xs" flexWrap="wrap">
        <c.k.Text dimColor>Columns:</c.k.Text>
        {COLUMNS.map(x => (
          <c.k.Button key={`uj-col-${x.id}`} label={`${c.u.cols.includes(x.id) ? '✓ ' : ''}${x.label}`} variant={c.u.cols.includes(x.id) ? 'primary' : 'secondary'} onPress={() => setUi($, { cols: toggleCol(c.u.cols, x.id) })} />
        ))}
      </c.k.Box>
      <c.k.Box flexDirection="row" gap="xs" flexWrap="wrap">
        <c.k.Text dimColor>Sort:</c.k.Text>
        {shown.map(x => (
          <c.k.Button key={`uj-sort-${x.id}`} label={headerLabel(x.id, c.u.sort, c.u.dir)} onPress={() => setUi($, { sort: x.id, dir: c.u.sort === x.id && c.u.dir === 'desc' ? 'asc' : 'desc', page: 0 })} />
        ))}
      </c.k.Box>
      {rows.length === 0 && empty(c, 'No tool calls recorded yet.')}
      <c.k.Box flexDirection="column">
        {p.rows.map(e => (
          <c.k.Text mono color={e.ok === false ? 'error' : undefined}>
            {tableLine(e, c.u.cols)}
          </c.k.Text>
        ))}
      </c.k.Box>
      {pager($, c, p.page, p.pages)}
      {note(c, 'Tool calls from the kept events. Press a header button to sort by it; press it again to flip the order.')}
    </c.k.Box>
  )
}

const viewCards = (c: Ctx) => {
  const cards = toolCards(c.d, c.now)

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      {cards.length === 0 && empty(c, 'No tool calls recorded yet.')}
      <c.k.Box flexDirection="row" flexWrap="wrap" gap="sm">
        {cards.map(t => (
          <c.k.Box flexDirection="column" borderStyle="round" borderColor={t.errs > 0 ? 'warning' : 'subtle'} padding="xs">
            <c.k.Text weight="bold">{t.name}</c.k.Text>
            <c.k.Text mono tabular>
              {t.n} calls, {t.errs} failed
            </c.k.Text>
            <c.k.Text mono dimColor>
              avg {Math.round(t.avgMs)}ms
            </c.k.Text>
            <c.k.Text mono color={c.accent}>
              {spark(t.recent)}
            </c.k.Text>
          </c.k.Box>
        ))}
      </c.k.Box>
      {note(c, 'The sparkline is the last 80 minutes in 10-minute steps.')}
    </c.k.Box>
  )
}

const viewPrint = (c: Ctx) => (
  <c.k.Box flexDirection="column" gap="xs">
    <c.k.Text mono>{printLines(c.d, c.now, 40).join('\n')}</c.k.Text>
    <c.k.Text dimColor size="caption">
      Plain one-column text, no colour or borders, to save ink if you copy it out. Last 40 events.
    </c.k.Text>
  </c.k.Box>
)

const viewPresent = (c: Ctx) =>
  !c.flags.presentation ? (
    empty(c, 'The presentation view is switched off: /cfg feature ui-two.presentation on.')
  ) : (
    <c.k.Box flexDirection="column" gap={c.gap}>
      <c.k.Box flexDirection="row" flexWrap="wrap" gap="md">
        {presentFigures(c.d, c.now).map(f => (
          <c.k.Box flexDirection="column" padding="xs">
            <c.k.Text size="title" weight="bold" color={c.accent} tabular>
              {f.value}
            </c.k.Text>
            <c.k.Text dimColor>{f.label}</c.k.Text>
          </c.k.Box>
        ))}
      </c.k.Box>
      {note(c, 'Masked on purpose: only figures. No file names, paths, tool names or prompts ever appear in this view, so it is safe to share a screen.')}
    </c.k.Box>
  )

const viewTimeline = ($: Dollar, c: Ctx) => {
  const bands = timelineBands(c.d, c.now, c.u.win)
  const { Svg } = c

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      <c.k.Box flexDirection="row" gap="xs">
        {[15, 60, 360].map(w => (
          <c.k.Button key={`uj-win-${w}`} label={w >= 60 ? `${w / 60}h` : `${w}m`} variant={w === c.u.win ? 'primary' : 'secondary'} onPress={() => setUi($, { win: w })} />
        ))}
      </c.k.Box>
      {Svg !== undefined ? (
        <Svg source={timelineSvg(bands, c.u.win, c.accent)} alt={svgAlt('Timeline bands', bands.length)} isInteractive {...svgSize(timelineSvg(bands, c.u.win, c.accent), 560)} />
      ) : (
        <c.k.Box flexDirection="column">
          {bands.map(b => (
            <c.k.Text mono color={KIND_TONE[b.kind]}>
              {b.kind.padEnd(7)}
              {spark(b.buckets)} {b.buckets.reduce((a, x) => a + x, 0)}
            </c.k.Text>
          ))}
        </c.k.Box>
      )}
      {note(c, `Last ${c.u.win >= 60 ? `${c.u.win / 60} hour(s)` : `${c.u.win} minutes`}, 60 steps, one band per kind. Left is older, right is now.`)}
    </c.k.Box>
  )
}

const viewCalendar = ($: Dollar, c: Ctx) => {
  const cal = calendar(c.d, c.now, c.u.calOff)

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      <c.k.Box flexDirection="row" gap="xs">
        <c.k.Button key="uj-cal-prev" label="◀" onPress={() => setUi($, { calOff: Math.max(-3, c.u.calOff - 1) })} />
        <c.k.Text weight="bold">{cal.title}</c.k.Text>
        <c.k.Button key="uj-cal-next" label="▶" onPress={() => setUi($, { calOff: Math.min(0, c.u.calOff + 1) })} />
      </c.k.Box>
      <c.k.Box flexDirection="column">
        <c.k.Text mono dimColor>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => ` ${x}  `).join('')}
        </c.k.Text>
        {cal.weeks.map(w => (
          <c.k.Text mono>{w.map(x => ` ${calText(x, cal.max)}`).join('')}</c.k.Text>
        ))}
      </c.k.Box>
      {note(c, 'Each cell is the day, a shade, and the tool calls that day, from this mod\'s own daily counters (kept 90 days, so older months stay empty).')}
    </c.k.Box>
  )
}

const viewTreemap = (c: Ctx) => {
  const rects = treemap(c.d.files, 560, 280)
  const { Svg } = c
  const dirs = rects.filter(r => r.kind === 'dir')

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      {rects.length === 0 && empty(c, 'No edits recorded yet: the treemap sizes files by how often they were edited.')}
      {rects.length > 0 && Svg !== undefined ? (
        <Svg source={treemapSvg(rects, 560, 280, c.accent)} alt={svgAlt('Treemap of edited files', rects.filter(r => r.kind === 'file').length)} isInteractive {...svgSize(treemapSvg(rects, 560, 280, c.accent), 560)} />
      ) : (
        <c.k.Box flexDirection="column">
          {dirs.map(dd => (
            <c.k.Box flexDirection="column">
              <c.k.Text weight="semibold">
                {clip(dd.full, 40)} ({dd.count})
              </c.k.Text>
              {rects
                .filter(r => r.kind === 'file' && r.x >= dd.x && r.x <= dd.x + dd.w)
                .map(r => (
                  <c.k.Text mono>
                    {'  '}
                    {clip(r.label, 24).padEnd(24)} {bar(r.count / Math.max(1, dd.count), 12)} {r.count}
                  </c.k.Text>
                ))}
            </c.k.Box>
          ))}
        </c.k.Box>
      )}
      {note(c, 'Files by edit count (Edit, Write, NotebookEdit), grouped by folder. In the terminal this is a nested list with bars: nested boxes need the desktop app.')}
    </c.k.Box>
  )
}

const viewGraph = (c: Ctx) => {
  const g = graph(c.d.edges)
  const { Svg } = c

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      {g.links.length === 0 && empty(c, 'No tool-to-file edges yet (tools that name a file: Read, Edit, Write).')}
      {g.links.length > 0 && Svg !== undefined ? (
        <Svg source={graphSvg(g, c.accent)} alt={svgAlt('Graph of tools and the files they touched', g.links.length)} isInteractive {...svgSize(graphSvg(g, c.accent), 560)} />
      ) : (
        <c.k.Box flexDirection="column">
          {g.tools.map(t => (
            <c.k.Text mono>
              {t.label.padEnd(10)}──▶ {g.links.filter(l => l.from === t.id).map(l => `${baseName(l.to)} ${l.n}`).join(', ')}
            </c.k.Text>
          ))}
        </c.k.Box>
      )}
      {note(c, 'Two columns with fixed positions (no force layout): tools left, files right, link width is how often. Top 6 tools and 8 files.')}
    </c.k.Box>
  )
}

const money = (n: number, isMoney: boolean) => (isMoney ? usd(n) : String(n))
const viewCompare = ($: Dollar, c: Ctx) => {
  const cmp = compare(c.d, c.u.cmp, c.now)

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      <c.k.Box flexDirection="row" gap="xs">
        <c.k.Button key="uj-cmp-day" label="Today vs yesterday" variant={c.u.cmp === 'day' ? 'primary' : 'secondary'} onPress={() => setUi($, { cmp: 'day' })} />
        <c.k.Button key="uj-cmp-session" label="This session vs previous" variant={c.u.cmp === 'session' ? 'primary' : 'secondary'} onPress={() => setUi($, { cmp: 'session' })} />
      </c.k.Box>
      {cmp.rows.map(r => {
        const max = Math.max(r.a, r.b, 0.000001)

        return (
          <c.k.Box flexDirection="column">
            <c.k.Text weight="semibold">{r.label}</c.k.Text>
            <c.k.Text mono dimColor>
              {cmp.aLabel.slice(0, 16).padEnd(16)} {bar(r.a / max, 24)} {money(r.a, r.isMoney)}
            </c.k.Text>
            <c.k.Text mono color={c.accent}>
              {cmp.bLabel.slice(0, 16).padEnd(16)} {bar(r.b / max, 24)} {money(r.b, r.isMoney)}
            </c.k.Text>
          </c.k.Box>
        )
      })}
      {note(c, 'Two bar sets on one scale per row. Spend is a client-side estimate. Sessions are counted from when this mod saw them start.')}
    </c.k.Box>
  )
}

const viewReplay = ($: Dollar, c: Ctx) => {
  const r = replayState(c.d, c.u.pos)
  const go = (pos: number) => setUi($, { pos: Math.max(0, Math.min(r.total - 1, pos)) })

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      {r.total === 0 && empty(c, 'Nothing to replay yet.')}
      {r.total > 0 && (
        <c.k.Box flexDirection="column" gap={c.gap}>
          <c.k.Box flexDirection="row" gap="xs" flexWrap="wrap">
            <c.k.Button key="uj-rp-first" label="⏮" onPress={() => go(0)} />
            <c.k.Button key="uj-rp-back10" label="◀ 10" onPress={() => go(r.at - 10)} />
            <c.k.Button key="uj-rp-back" label="◀" onPress={() => go(r.at - 1)} />
            <c.k.Button key="uj-rp-fwd" label="▶" onPress={() => go(r.at + 1)} />
            <c.k.Button key="uj-rp-fwd10" label="10 ▶" onPress={() => go(r.at + 10)} />
            <c.k.Button key="uj-rp-last" label="⏭" onPress={() => go(r.total - 1)} />
          </c.k.Box>
          <c.k.Text mono color={c.accent}>
            ▕{bar((r.at + 1) / r.total, 30)}▏ {r.at + 1}/{r.total}
          </c.k.Text>
          <c.k.Box flexDirection="column">
            {r.before.map(e => (
              <c.k.Text mono dimColor>
                {'  '}
                {clip(eventLine(e), Math.max(30, c.cols - 4))}
              </c.k.Text>
            ))}
            {r.ev !== undefined && (
              <c.k.Text mono weight="bold" color={KIND_TONE[r.ev.k]}>
                {'▶ '}
                {clip(eventLine(r.ev), Math.max(30, c.cols - 4))}
              </c.k.Text>
            )}
            {r.after.map(e => (
              <c.k.Text mono dimColor>
                {'  '}
                {clip(eventLine(e), Math.max(30, c.cols - 4))}
              </c.k.Text>
            ))}
          </c.k.Box>
          <c.k.Text mono>
            up to here: {r.so.tool} tools, {r.so.edit} edits, {r.so.error} errors, {r.so.prompt} prompts
          </c.k.Text>
        </c.k.Box>
      )}
      {note(c, 'Steps through the kept events (oldest first). It replays what was recorded: it does not re-run anything.')}
    </c.k.Box>
  )
}

const viewKanban = ($: Dollar, c: Ctx) => (
  <c.k.Box flexDirection="column" gap={c.gap}>
    <c.k.Input
      key={`uj-card-input-${c.d.cardSeq}`}
      label="new card"
      placeholder="what needs doing"
      submitLabel="add"
      onSubmit={v => {
        void doAddCard($, v).then(m => setUi($, { msg: m }))
      }}
    />
    {c.u.msg !== '' && note(c, c.u.msg)}
    <c.k.Box flexDirection="row" flexWrap="wrap" gap="sm">
      {COL_LIST.map(col => (
        <c.k.Box flexDirection="column" borderStyle="round" borderColor="subtle" padding="xs" flexGrow={1}>
          <c.k.Text weight="bold" color={c.accent}>
            {COL_LABEL[col]} ({c.d.cards.filter(x => x.col === col).length})
          </c.k.Text>
          {c.d.cards
            .filter(x => x.col === col)
            .map(card => (
              <c.k.Box flexDirection="column">
                <c.k.Text>
                  {card.id}. {clip(card.text, 40)}
                  {card.pomos > 0 ? ` (${card.pomos} 🍅)` : ''}
                </c.k.Text>
                <c.k.Box flexDirection="row" gap="xs">
                  {col !== 'todo' && <c.k.Button key={`uj-card-left-${card.id}`} label="◀ Move" onPress={() => mutate($, d => moveCard(d, card.id, -1))} />}
                  {col !== 'done' && <c.k.Button key={`uj-card-right-${card.id}`} label="Move ▶" onPress={() => mutate($, d => moveCard(d, card.id, 1))} />}
                  <c.k.Button key={`uj-card-pomo-${card.id}`} label="Timer" onPress={() => doStartPomo($, 'work', 25, card.id).then(m => setUi($, { msg: m }))} />
                  <c.k.Button key={`uj-card-rm-${card.id}`} label="Remove" onPress={() => mutate($, d => removeCard(d, card.id))} />
                </c.k.Box>
              </c.k.Box>
            ))}
        </c.k.Box>
      ))}
    </c.k.Box>
    {note(c, 'Your own cards, not the model\'s task list. Move buttons shift a card one column; Timer starts a 25-minute pomodoro on it.')}
  </c.k.Box>
)

const viewGoals = ($: Dollar, c: Ctx) => {
  const p = c.d.pomo
  const left = pomoLeft(p, c.now)
  const today = c.d.days[dayKey(c.now)]?.pomos ?? 0

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      {section(c, 'Pomodoro')}
      {p === null ? (
        <c.k.Box flexDirection="row" gap="xs" flexWrap="wrap">
          <c.k.Button key="uj-pomo-work" label="Start 25 min" variant="primary" onPress={() => doStartPomo($, 'work', 25, 0).then(m => setUi($, { msg: m }))} />
          <c.k.Button key="uj-pomo-break" label="Break 5 min" onPress={() => doStartPomo($, 'break', 5, 0).then(m => setUi($, { msg: m }))} />
          <c.k.Text dimColor>{today} done today. Link a card from the Kanban view (Timer).</c.k.Text>
        </c.k.Box>
      ) : (
        <c.k.Box flexDirection="row" gap="sm">
          <c.k.Text size="heading" weight="bold" mono tabular color={p.kind === 'work' ? c.accent : 'success'}>
            {mmss(left)}
          </c.k.Text>
          <c.k.Text>
            {p.kind === 'work' ? 'focus' : 'break'}
            {p.task !== '' ? `: ${clip(p.task, 40)}` : ''}
          </c.k.Text>
          <c.k.Button key="uj-pomo-stop" label="Stop" onPress={() => doStopPomo($).then(m => setUi($, { msg: m }))} />
        </c.k.Box>
      )}
      {p !== null && note(c, c.flags['live-timer'] && !c.calm ? 'The countdown redraws each second.' : 'Static: the remaining time is read when this view redraws (the live countdown is a switch, off by default, and calm or /motion off keeps it still). The end is still caught on time.')}
      {section(c, 'Goals')}
      <c.k.Input
        key={`uj-goal-input-${c.d.goalSeq}`}
        label="new goal"
        placeholder="2026-12-01 18:00 ship it   or   +2h write notes"
        submitLabel="add"
        onSubmit={v => {
          void doAddGoal($, v).then(m => setUi($, { msg: m }))
        }}
      />
      {c.u.msg !== '' && note(c, c.u.msg)}
      {c.d.goals.length === 0 && empty(c, 'No goals yet.')}
      {[...c.d.goals].sort((a, b) => a.due - b.due).map(g => (
        <c.k.Box flexDirection="row" gap="xs" flexWrap="wrap">
          <c.k.Text color={g.done ? 'inactive' : g.due < c.now ? 'warning' : undefined} dimColor={g.done}>
            {g.done ? '✓' : '○'} {g.id}. {clip(g.text, 40)} - {dayKey(g.due)} {hhmm(g.due)} ({g.done ? 'done' : dueText(g.due, c.now)})
          </c.k.Text>
          <c.k.Button key={`uj-goal-done-${g.id}`} label={g.done ? 'Reopen' : 'Done'} onPress={() => mutate($, d => ({ ...d, goals: d.goals.map(x => (x.id === g.id ? { ...x, done: !x.done, fired: x.done ? false : x.fired } : x)) }))} />
          <c.k.Button key={`uj-goal-rm-${g.id}`} label="Remove" onPress={() => mutate($, d => ({ ...d, goals: d.goals.filter(x => x.id !== g.id) }))} />
        </c.k.Box>
      ))}
      {note(c, 'A toast at the due time needs /cfg feature ui-two.goal-toasts on. Due goals are always logged in the Notices view.')}
    </c.k.Box>
  )
}

const viewSpend = ($: Dollar, c: Ctx) => {
  const s = budgetStatus(c.d, c.now)
  const fc = forecast(c.d, c.now)
  const rolled = rollBudget(c.d.budget, c.d.days, dayKey(c.now))
  const series = c.d.samples.slice(-24).map((x, i, a) => (i === 0 ? 0 : Math.max(0, x.tot - a[i - 1]!.tot)))

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      {section(c, 'Budget guard')}
      {c.d.budget.perDay > 0 ? (
        <c.k.Box flexDirection="column">
          <c.k.Text mono color={s.pct >= 100 ? 'error' : s.pct >= 80 ? 'warning' : c.accent}>
            {bar(Math.min(1, s.pct / 100), 30)} {Math.round(s.pct)}%
          </c.k.Text>
          <c.k.Text mono>
            today {usd(s.spent)} of {usd(s.allowance)} (base {usd(s.perDay)} + rollover {usd(rolled.carry)}, cap {usd(s.cap)})
          </c.k.Text>
          <c.k.Text mono>left {usd(s.left)}</c.k.Text>
        </c.k.Box>
      ) : (
        empty(c, 'No budget set. Enter dollars per day below.')
      )}
      <c.k.Input
        key={`uj-budget-input-${c.d.budget.perDay}`}
        label="usd/day"
        placeholder="20  (or off)"
        submitLabel="set"
        onSubmit={v => {
          void doBudget($, v.trim()).then(m => setUi($, { msg: m }))
        }}
      />
      {c.u.msg !== '' && note(c, c.u.msg)}
      {section(c, 'Forecast (approximate)')}
      {fc.ok ? (
        <c.k.Box flexDirection="column">
          <c.k.Text mono>
            about {usd(fc.projected)} by end of day (so far {usd(fc.spent)}; recent rate {usd(fc.rate)}/h for {fc.hoursLeft.toFixed(1)}h more)
          </c.k.Text>
          <c.k.Text mono color={c.accent}>
            {spark(series)}
          </c.k.Text>
        </c.k.Box>
      ) : (
        empty(c, fc.why ?? 'No forecast yet.')
      )}
      {note(c, 'A plain linear estimate from client-side cost figures: server-side billing is the authority. Warnings at 80 and 100 percent are toasts behind switches (ui-two.budget-warn-80 / -100, off by default) and never block anything.')}
    </c.k.Box>
  )
}

const viewDigest = ($: Dollar, c: Ctx) => (
  <c.k.Box flexDirection="column" gap={c.gap}>
    <c.k.Box flexDirection="row" gap="xs">
      <c.k.Button key="uj-dig-daily" label="Daily" variant={c.u.dig === 'daily' ? 'primary' : 'secondary'} onPress={() => setUi($, { dig: 'daily' })} />
      <c.k.Button key="uj-dig-weekly" label="Weekly" variant={c.u.dig === 'weekly' ? 'primary' : 'secondary'} onPress={() => setUi($, { dig: 'weekly' })} />
    </c.k.Box>
    <c.k.Box flexDirection="column">
      {digestText(c.d, c.now, c.u.dig).split('\n').map(l => (
        <c.k.Text>{l}</c.k.Text>
      ))}
    </c.k.Box>
    {note(c, 'Also as text: /ujdigest daily or weekly. A morning toast is off by default (ui-two.digest-morning).')}
  </c.k.Box>
)

const viewNotices = ($: Dollar, c: Ctx) => {
  const list = [...c.d.notices].reverse()

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      <c.k.Box flexDirection="row" gap="xs">
        <c.k.Text dimColor>{unread(c.d)} unread of {list.length}.</c.k.Text>
        <c.k.Button key="uj-notice-allread" label="Mark all read" onPress={() => mutate($, d => setRead(d, 'all', true))} />
        <c.k.Button key="uj-notice-allunread" label="Mark all unread" onPress={() => mutate($, d => setRead(d, 'all', false))} />
      </c.k.Box>
      {list.length === 0 && empty(c, 'No notices yet. Budget warnings, due goals, finished pomodoros and the morning digest are logged here.')}
      {list.slice(0, 15).map(n => (
        <c.k.Box flexDirection="row" gap="xs" flexWrap="wrap">
          <c.k.Text weight={n.read ? undefined : 'bold'} dimColor={n.read}>
            {n.read ? '○' : '●'} {dayKey(n.t).slice(5)} {hhmm(n.t)} [{n.kind}] {clip(n.text, 90)}
          </c.k.Text>
          <c.k.Button key={`uj-notice-toggle-${n.id}`} label={n.read ? 'Unread' : 'Read'} onPress={() => mutate($, d => setRead(d, n.id, !n.read))} />
        </c.k.Box>
      ))}
      {note(c, 'Only notices this mod raised. Toasts from other mods cannot be read from here.')}
    </c.k.Box>
  )
}

const viewLibrary = ($: Dollar, c: Ctx) => {
  const tags = [...new Set(c.d.lib.flatMap(l => l.tags))].sort()
  const items = c.d.lib.filter(l => c.u.tag === '' || l.tags.includes(c.u.tag))

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      <c.k.Input
        key={`uj-lib-add-${c.d.libSeq}`}
        label="add"
        placeholder="title :: prompt text #tag #tag"
        submitLabel="save"
        onSubmit={v => {
          void doAddPrompt($, v).then(m => setUi($, { msg: m }))
        }}
      />
      {tags.length > 0 && (
        <c.k.Box flexDirection="row" gap="xs" flexWrap="wrap">
          <c.k.Button key="uj-tag-all" label="all" variant={c.u.tag === '' ? 'primary' : 'secondary'} onPress={() => setUi($, { tag: '' })} />
          {tags.map(t => (
            <c.k.Button key={`uj-tag-${t}`} label={`#${t}`} variant={c.u.tag === t ? 'primary' : 'secondary'} onPress={() => setUi($, { tag: t })} />
          ))}
        </c.k.Box>
      )}
      {c.u.msg !== '' && note(c, c.u.msg)}
      {items.length === 0 && empty(c, 'No prompts here yet.')}
      {items.map(l => (
        <c.k.Box flexDirection="column">
          <c.k.Text>
            <c.k.Text weight="bold">
              {l.id}. {l.title}
            </c.k.Text>
            {l.tags.length > 0 ? `  ${l.tags.map(t => `#${t}`).join(' ')}` : ''}
          </c.k.Text>
          <c.k.Text dimColor>{clip(l.text.replace(/\s+/g, ' '), Math.max(30, c.cols - 4))}</c.k.Text>
          <c.k.Box flexDirection="row" gap="xs">
            <c.k.Button key={`uj-lib-use-${l.id}`} label="Use" onPress={() => doUse($, l.id).then(m => setUi($, { msg: m }))} />
            <c.k.Button key={`uj-lib-rm-${l.id}`} label="Remove" onPress={() => mutate($, d => ({ ...d, lib: d.lib.filter(x => x.id !== l.id) }))} />
          </c.k.Box>
        </c.k.Box>
      ))}
      <c.k.Box flexDirection="row" gap="xs">
        <c.k.Button key="uj-lib-export" label="Export JSON" onPress={() => setUi($, { exp: exportPrompts(c.d) })} />
        {c.u.exp !== '' && <c.k.Button key="uj-lib-hide" label="Hide" onPress={() => setUi($, { exp: '' })} />}
      </c.k.Box>
      {c.u.exp !== '' && <c.k.Text mono>{c.u.exp}</c.k.Text>}
      <c.k.Input
        key={`uj-lib-import-${c.d.libSeq}`}
        label="import"
        placeholder='paste exported JSON {"format":"uj-prompts",...}'
        submitLabel="import"
        onSubmit={v => {
          void doImport($, v).then(m => setUi($, { msg: m }))
        }}
      />
      {note(c, 'Export and import are strict JSON: unknown keys, bad tags, or more than 50 prompts are refused, and nothing is imported on any error. Also: /ujprompt export and /ujprompt import <json>.')}
    </c.k.Box>
  )
}

const viewStats = (c: Ctx) => {
  const rows = tagStats(c.d)

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      {rows.length === 0 && empty(c, 'No samples yet. Send a prompt from the library (Use, then Enter) and its turn is measured.')}
      {rows.length > 0 && (
        <c.k.Box flexDirection="column">
          <c.k.Text mono dimColor>
            {'tag'.padEnd(14)} {'turns'.padStart(5)} {'avg time'.padStart(9)} {'tools'.padStart(6)} {'errors'.padStart(7)}
          </c.k.Text>
          {rows.map(r => (
            <c.k.Text mono>
              {clip(r.tag, 14).padEnd(14)} {String(r.n).padStart(5)} {fmtDur(r.avgMs).padStart(9)} {r.avgTools.toFixed(1).padStart(6)} {r.avgErrs.toFixed(1).padStart(7)}
            </c.k.Text>
          ))}
        </c.k.Box>
      )}
      {note(c, 'Heuristic: only for prompts you stored here and sent unchanged. A few turns are noise, and a long turn may simply be a harder task. A prompt with several tags counts under each.')}
    </c.k.Box>
  )
}

const viewModels = (c: Ctx) => {
  const ms = modelStats(c.d)
  const turns = [...c.d.turns].reverse().slice(0, 12)

  return (
    <c.k.Box flexDirection="column" gap={c.gap}>
      {ms.length === 0 && empty(c, 'No turns recorded yet.')}
      {ms.length > 0 && (
        <c.k.Box flexDirection="column">
          <c.k.Text mono dimColor>
            {'model'.padEnd(24)} {'turns'.padStart(5)} {'avg time'.padStart(9)} {'avg cost'.padStart(9)}
          </c.k.Text>
          {ms.map(m => (
            <c.k.Text mono>
              {clip(m.model, 24).padEnd(24)} {String(m.n).padStart(5)} {fmtDur(m.avgMs).padStart(9)} {usd(m.avgUsd).padStart(9)}
            </c.k.Text>
          ))}
        </c.k.Box>
      )}
      {turns.length > 0 && section(c, 'Latest turns')}
      {turns.map(t => (
        <c.k.Text mono dimColor>
          {hhmmss(t.t)} {clip(t.model, 24).padEnd(24)} {fmtDur(t.ms).padStart(6)} {usd(t.usd).padStart(7)} {t.tools} tools
        </c.k.Text>
      ))}
      {note(c, 'The model name is what the API reports per turn ("(not reported)" when it does not). Cost is the growth of the session cost estimate during the turn, so parallel work can blur it.')}
    </c.k.Box>
  )
}

const bodyOf = ($: Dollar, c: Ctx) => {
  switch (c.u.view) {
    case 'feed':
      return viewFeed($, c)
    case 'table':
      return viewTable($, c)
    case 'cards':
      return viewCards(c)
    case 'print':
      return viewPrint(c)
    case 'present':
      return viewPresent(c)
    case 'timeline':
      return viewTimeline($, c)
    case 'calendar':
      return viewCalendar($, c)
    case 'treemap':
      return viewTreemap(c)
    case 'graph':
      return viewGraph(c)
    case 'compare':
      return viewCompare($, c)
    case 'replay':
      return viewReplay($, c)
    case 'kanban':
      return viewKanban($, c)
    case 'goals':
      return viewGoals($, c)
    case 'spend':
      return viewSpend($, c)
    case 'digest':
      return viewDigest($, c)
    case 'notices':
      return viewNotices($, c)
    case 'library':
      return viewLibrary($, c)
    case 'stats':
      return viewStats(c)
    case 'models':
      return viewModels(c)
    default:
      return viewOverview($, c)
  }
}

/** 237: an inline menu that opens under a Button. */
const popover = ($: Dollar, c: Ctx) => {
  const items: { id: string; label: string; run: () => Promise<unknown> }[] = [
    { id: 'pomo', label: 'Start a 25-minute pomodoro', run: () => doStartPomo($, 'work', 25, 0) },
    { id: 'read', label: 'Mark all notices read', run: () => mutate($, d => setRead(d, 'all', true)) },
    { id: 'digest', label: 'Show the daily digest', run: () => setUi($, { view: 'digest', group: 'work', dig: 'daily' }) },
    { id: 'replay', label: 'Replay the latest events', run: () => setUi($, { view: 'replay', group: 'charts', pos: -1 }) },
    { id: 'export', label: 'Export the prompt library', run: () => setUi($, { view: 'library', group: 'prompts', exp: exportPrompts(c.d) }) },
    { id: 'clear', label: 'Clear the command bar', run: () => setUi($, { q: '' }) },
  ]

  return (
    <c.k.Box flexDirection="column" borderStyle="round" borderColor="subtle" padding="xs">
      {items.map(it => (
        <c.k.Button
          key={`uj-pop-${it.id}`}
          label={it.label}
          onPress={() => {
            void it.run().then(() => setUi($, { pop: false }))
          }}
        />
      ))}
    </c.k.Box>
  )
}

const fillPrompt = async ($: Dollar, text: string) => {
  await $.prompt.fill({ text, mode: 'replace' })
}

const gapOf = (density: string): Gap => (density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) {
      await $.command.register({ name: c.name, description: c.description }).catch(() => undefined)
    }
    const t = await $.clock.now()
    const data = sanitize(await $.store.get(STORE_KEY))
    const last = data.sessions[data.sessions.length - 1]
    const fresh = last !== undefined && last.tools === 0 && last.prompts === 0 && t - last.start < 600_000 ? { ...data, lastUsd: null } : startSession(data, t)
    await update($, dataA, () => fresh)
    await $.store.set(STORE_KEY, fresh)
    minuteTimer?.cancel()
    minuteTimer = $.clock.every(60_000, () => {
      void minuteTick($)
    })
    await checkGoals($)
    await schedulePomo($)
    await morning($)

    return next(e)
  })

  // ---- commands ----
  on('command.run', { command: 'uj' }, () => ({ text: HELP }))
  on('command.run', { command: 'ujview' }, ($, e) => runView($, e.args))
  on('command.run', { command: 'ujfeed' }, $ => said($, 'feed', 'Activity feed opened.'))
  on('command.run', { command: 'ujkanban' }, ($, e) => runKanban($, e.args.trim()))
  on('command.run', { command: 'ujcmd' }, ($, e) => runCmd($, e.args))
  on('command.run', { command: 'ujnotice' }, ($, e) => runNotice($, e.args.trim().toLowerCase()))
  on('command.run', { command: 'ujbudget' }, async ($, e) => ({ text: await doBudget($, e.args.trim().toLowerCase()) }))
  on('command.run', { command: 'ujspend' }, $ => said($, 'spend', 'Spend view opened.'))
  on('command.run', { command: 'ujforecast' }, $ => runForecast($))
  on('command.run', { command: 'ujprompt' }, ($, e) => runPrompt($, e.args))
  on('command.run', { command: 'ujdigest' }, async ($, e) => {
    const t = await $.clock.now()
    const kind = e.args.trim().toLowerCase() === 'weekly' ? 'weekly' : 'daily'

    return { text: digestText(await read($, dataA), t, kind) }
  })
  on('command.run', { command: 'ujgoal' }, ($, e) => runGoal($, e.args))
  on('command.run', { command: 'ujpomo' }, ($, e) => runPomo($, e.args))
  on('command.run', { command: 'ujfocus' }, async $ => {
    const t = await $.clock.now()
    const f = focusScore(await read($, dataA), t)

    return { text: f.n === 0 ? 'No file tool calls in the last hour.' : `Focus ${f.pct}%: ${Math.round((f.pct * f.n) / 100)} of ${f.n} file tool calls in the last hour were in ${f.dir}.` }
  })
  on('command.run', { command: 'ujreplay' }, async $ => {
    await setUi($, { pos: -1 })

    return said($, 'replay', 'Replay opened at the newest event.')
  })
  on('command.run', { command: 'ujprint' }, $ => said($, 'print', 'Print view opened.'))
  on('command.run', { command: 'ujpresent' }, $ => said($, 'present', 'Presentation view opened.'))
  on('command.run', { command: 'ujreset' }, async ($, e) => ({ text: await doReset($, e.args.trim() === 'all') }))

  // ---- recording ----
  on('tool.call', async ($, e, next) => {
    const start = await $.clock.now()
    let result: unknown

    try {
      result = await next(e)
    } catch (err) {
      await onCall($, e, e.tool, start, false).catch(() => undefined)
      throw err
    }
    await onCall($, e, e.tool, start, !isFailure(result)).catch(() => undefined)

    return result as Awaited<ReturnType<typeof next>>
  })

  on('prompt.submit', async ($, e, next) => {
    const isCommand = e.command !== undefined || e.isMeta === true || e.text.trim().startsWith('/')
    await onPrompt($, e.text, isCommand).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      await onTurn($, e.durationMs, e.usage?.model).catch(() => undefined)
    }

    return next(e)
  })

  // ---- the pane ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const k = $.ui.resolve(e) as unknown as K
    const d = await read($, dataA)
    const u = await read($, uiA)
    const t = await $.clock.now()
    const accent = (await read($, accentA)) as Accent
    const calm = await read($, calmA)
    const flagNames = Object.keys(FEATURE_DEFAULTS)
    const flags: Record<string, boolean> = {}

    for (const id of flagNames) {
      flags[id] = await isOn($, id)
    }

    // The countdown redraws from the ticker's writes; nothing reads `now` when it is static.
    const live = d.pomo !== null && flags['live-timer'] === true && (await animOk($))
    const now = live ? Math.max(t, await read($, nowA)) : t
    const svgOn = e.surface === 'desktop' && flags['svg-charts'] === true
    const c: Ctx = { k, Svg: svgOn ? k.Svg : undefined, d, u, now, cols: e.props.bodyColumns, accent, gap: gapOf(await read($, densityA)), calm, flags, surface: e.surface }
    const { Box, Text, Button, Input } = k
    const n = unread(d)
    const matches = flags['command-bar'] ? cmdMatches(d.cmds, u.q, 6) : []
    const groupViews = VIEWS.filter(v => v.group === u.group)

    return (
      <Box flexDirection="column" gap={c.gap}>
        <Box justifyContent="space-between" flexDirection="row">
          <Text size="heading" weight="bold" color={accent}>
            UI two
          </Text>
          <Box flexDirection="row" gap="xs">
            {n > 0 && (
              <Button key="uj-badge" label={`${n} unread`} variant="secondary" onPress={() => setUi($, { view: 'notices', group: 'work', page: 0 })} />
            )}
            {flags['popover-menu'] && <Button key="uj-pop" label={u.pop ? 'Actions ▴' : 'Actions ▾'} variant="secondary" onPress={() => setUi($, { pop: !u.pop })} />}
          </Box>
        </Box>
        {flags['popover-menu'] && u.pop && popover($, c)}
        {flags['command-bar'] && (
          <Box flexDirection="column">
            <Input
              key="uj-cmdbar"
              label="command"
              placeholder="filter your stored commands, Enter fills the prompt"
              value={u.q}
              submitLabel="fill prompt"
              onInput={v => {
                void setUi($, { q: v.slice(0, 80) })
              }}
              onSubmit={v => {
                const first = cmdMatches(d.cmds, v, 1)[0]
                void fillPrompt($, first ?? v)
              }}
            />
            {u.q !== '' && (
              <Box flexDirection="row" flexWrap="wrap" gap="xs">
                {matches.length === 0 && <Text dimColor>No stored command matches: Enter fills what you typed.</Text>}
                {matches.map((m, i) => (
                  <Button key={`uj-cmd-${i}`} label={clip(m, 40)} onPress={() => fillPrompt($, m)} />
                ))}
              </Box>
            )}
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" gap="xs">
          {GROUPS.map(g => (
            <Button
              key={`uj-group-${g.id}`}
              label={g.label}
              variant={g.id === u.group ? 'primary' : 'secondary'}
              onPress={() => setUi($, { group: g.id, view: VIEWS.find(v => v.group === g.id)?.id ?? 'overview', page: 0 })}
            />
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap="xs">
          {groupViews.map(v => (
            <Button key={`uj-view-${v.id}`} label={v.label} variant={v.id === u.view ? 'primary' : 'secondary'} onPress={() => setUi($, { view: v.id, page: 0, msg: '' })} />
          ))}
        </Box>
        {bodyOf($, c)}
      </Box>
    )
  })
}
