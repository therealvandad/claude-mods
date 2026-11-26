import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register, Timer } from 'claude-code'

// Global reduced-motion switch: owned by the `motion` mod (`/motion on|off`).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
// Shared look switches owned by the `settings` mod (read only): calm means no decorative motion.
const settingsIsCalm = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const settingsAccent = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
// Per-mod feature switches (overrides only), owned by `settings`. Read, never written.
const settingsFeatures = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })

import type {
  Call,
  DayRow,
  EditRow,
  ErrorRow,
  GitInfo,
  LimitSample,
  LinkRow,
  PromptRow,
  SearchState,
  TestRun,
  Todo,
} from '../types'
import { vecAlt, vecDashSvg } from './vecdash'
import { HUD_H, hudAlt, hudSvg, limitLabel, money } from './hud'
import type { HudData, HudTone } from './hud'
import { cardSvg, CARD_H, chipsAlt, chipsSvg, layoutChips, SLIM_H, slimSvg } from './barsvg'
import { drawBand, drawSettings } from './barview'
import type { BandParts } from './barview'
import { drawHistory, drawLinks, drawPalette, drawPins, drawTodo, picture } from './paneview'
import { errorsCard, filesCard, hhmm, paneWidth, timelineCard } from './panesvg'
import {
  countPrompt,
  countsOf,
  DEFAULT_VIEW,
  drawPlainBand,
  drawPlainHome,
  figuresOf,
  LONG_TURN_MS,
  longTurnText,
  noticeOf,
  quietNotice,
  topPrompts,
  viewOf,
} from './plain'
import type { View } from './plain'
import { drawSteps, stepsOf, styleFor } from './chat'
import { isPremium, premiumStyle, scene, stepBar } from './premium'
import type { LookOptions } from './premium'
import { COLOR_NAMES, colorLabel, colorName, themeFor } from './colors'
import { addMark, drawNote, errorNote, markNote, settleMarks, SLOW_MS, slowNote } from './rows'
import type { Marks, RowNote } from './rows'
import { drawMenu, menuTarget, pinText, quote, rememberText } from './menu'
import {
  addItem,
  alertOf,
  applyBar,
  applyPreset,
  buttonWidth,
  chipsFor,
  CODING_ITEMS,
  commandKey,
  DEFAULT_CONFIG,
  EMPTY_LIVE,
  edgeOf,
  estimateOf,
  fitButtons,
  forecastMin,
  has,
  isCodingSession,
  moveItem,
  nextSize,
  onlyChanged,
  pad2,
  pickButtons,
  planBand,
  projectKey,
  reduceToolEnd,
  reduceToolStart,
  reduceTurnEnd,
  reduceTurnStart,
  reduceUsage,
  rememberDuration,
  removeItem,
  sanitizeConfig,
  snapshotChips,
  spanOf,
  storable,
  isBackgrounded,
  isTestCommand,
  testsPassed,
  toggleItem,
  wantsTicker,
  clockOf,
} from './bar'
import type { BarButton, BarConfig, BarLive, ChipContext, Durations, Usage } from './bar'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'cockpit'

// ---------------------------------------------------------------- state

const tab = atom({ plugin: 'cockpit', key: 'tab' } as const, 'overview')
const now = atom({ plugin: 'cockpit', key: 'now' } as const, 0)
const sessionStart = atom({ plugin: 'cockpit', key: 'sessionStart' } as const, 0)
const turns = atom({ plugin: 'cockpit', key: 'turns' } as const, 0)
const contextPercent = atom({ plugin: 'cockpit', key: 'contextPercent' } as const, null)
const costUsd = atom({ plugin: 'cockpit', key: 'costUsd' } as const, null)
const calls = atom({ plugin: 'cockpit', key: 'calls' } as const, [], { shape: 'calls-1' })
const errors = atom({ plugin: 'cockpit', key: 'errors' } as const, [], { shape: 'errors-1' })
const edits = atom({ plugin: 'cockpit', key: 'edits' } as const, [], { shape: 'edits-1' })
const costSamples = atom({ plugin: 'cockpit', key: 'costSamples' } as const, [], { shape: 'cost-1' })
const ctxSamples = atom({ plugin: 'cockpit', key: 'ctxSamples' } as const, [], { shape: 'ctx-1' })
const limitSamples = atom({ plugin: 'cockpit', key: 'limitSamples' } as const, [], { shape: 'limit-1' })
const git = atom({ plugin: 'cockpit', key: 'git' } as const, null, { shape: 'git-1' })
const tests = atom({ plugin: 'cockpit', key: 'tests' } as const, [], { shape: 'tests-1' })
const todos = atom({ plugin: 'cockpit', key: 'todos' } as const, [], { shape: 'todos-1' })
const prompts = atom({ plugin: 'cockpit', key: 'prompts' } as const, [], { shape: 'prompts-1' })
const search = atom({ plugin: 'cockpit', key: 'search' } as const, { query: '', hits: [] }, { shape: 'search-1' })
const links = atom({ plugin: 'cockpit', key: 'links' } as const, [], { shape: 'links-1' })
const shelf = atom({ plugin: 'cockpit', key: 'shelf' } as const, [], { shape: 'shelf-1' })
const pins = atom({ plugin: 'cockpit', key: 'pins' } as const, [], { shape: 'pins-1' })
const daily = atom({ plugin: 'cockpit', key: 'daily' } as const, {}, { shape: 'daily-1' })
const lastUsd = atom({ plugin: 'cockpit', key: 'lastUsd' } as const, null)
const isSessionCounted = atom({ plugin: 'cockpit', key: 'isSessionCounted' } as const, false)
const isFocus = atom({ plugin: 'cockpit', key: 'isFocus' } as const, false)
const isBandHidden = atom({ plugin: 'cockpit', key: 'isBandHidden' } as const, false)
const barConfig = atom({ plugin: 'cockpit', key: 'barConfig' } as const, DEFAULT_CONFIG, { shape: 'barconfig-1' })
const barLive = atom({ plugin: 'cockpit', key: 'barLive' } as const, EMPTY_LIVE, { shape: 'barlive-1' })
const isTypingHidden = atom({ plugin: 'cockpit', key: 'isTypingHidden' } as const, false)
const view = atom({ plugin: 'cockpit', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-1' })
const myPrompts = atom({ plugin: 'cockpit', key: 'myPrompts' } as const, {}, { shape: 'myprompts-1' })
const editMarks = atom({ plugin: 'cockpit', key: 'editMarks' } as const, {} as Marks, { shape: 'marks-1' })
const slow = atom({ plugin: 'cockpit', key: 'slow' } as const, {} as Record<string, number>, { shape: 'slow-1' })

// ---------------------------------------------------------------- constants

const TABS = [
  ['overview', 'Overview'],
  ['timeline', 'Timeline'],
  ['files', 'Files'],
  ['todo', 'Todo'],
  ['history', 'History'],
  ['errors', 'Errors'],
  ['links', 'Links'],
  ['palette', 'Palette'],
  ['bar', 'Bar'],
] as const

const PLAIN_TABS: ReadonlySet<string> = new Set(['overview', 'files', 'todo', 'history', 'errors'])

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/g

const CAP = {
  calls: 120,
  errors: 40,
  edits: 100,
  samples: 40,
  limits: 60,
  tests: 20,
  prompts: 50,
  links: 50,
  shelf: 30,
  pins: 8,
  todos: 100,
  days: 30,
  hits: 30,
} as const

const PALETTE = [
  ['/cockpit', 'Open this cockpit'],
  ['/ctodo ', 'Add a todo: /ctodo <text>'],
  ['/csearch ', 'Search this session: /csearch <text>'],
  ['/cshelf add ', 'Put a snippet on the shelf'],
  ['/cpin ', 'Pin or unpin a note'],
  ['/cfocus', 'Hide or show the cockpit bands'],
  ['/bar', 'Choose what the strip above the prompt shows'],
  ['/readonly', 'Tool guard: toggle read-only mode'],
  ['/compact', 'Compact the conversation'],
  ['/context', 'Show context usage'],
  ['/cost', 'Show session cost'],
] as const

// ---------------------------------------------------------------- pure helpers

const SPARK = '▁▂▃▄▅▆▇█'

const sparkOf = (values: readonly number[]): string => {
  if (values.length === 0) {
    return ''
  }
  const lo = Math.min(...values)
  const hi = Math.max(...values)

  if (hi === lo) {
    return (lo === 0 ? '▁' : '▄').repeat(values.length)
  }

  return values.map(v => SPARK.charAt(Math.round(((v - lo) / (hi - lo)) * 7))).join('')
}

const bar = (frac: number, width = 12) =>
  '█'.repeat(Math.round(Math.max(0, Math.min(1, frac)) * width)).padEnd(width, '░')

const toneOf = (percent: number) => (percent >= 85 ? 'error' : percent >= 70 ? 'warning' : 'success')

const heatOf = (percent: number) =>
  percent >= 85 ? 'error' : percent >= 70 ? 'warning' : percent >= 40 ? 'suggestion' : 'success'

const durOf = (ms: number) =>
  ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : clockOf(ms)

const dayKey = (ms: number) => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const detailOf = (input: Record<string, unknown>): string => {
  const pick = input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? ''

  return String(pick).replace(/\s+/g, ' ').slice(0, 100)
}

const oneLine = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max)

const urlsIn = (text: string): string[] =>
  (text.slice(0, 20_000).match(URL_RE) ?? []).map(u => u.replace(/[.,;:!?]+$/, ''))

const parseGit = (out: string): GitInfo => {
  const lines = out.split('\n').filter(l => l !== '')
  const head = lines[0] ?? ''

  if (!head.startsWith('## ')) {
    return null
  }
  const body = head.slice(3)
  const fresh = /^No commits yet on (\S+)/.exec(body)
  const branch = fresh !== null ? (fresh[1] ?? '') : (body.split('...')[0] ?? '').split(' ')[0] ?? ''

  return {
    branch: branch === 'HEAD' ? 'detached' : branch,
    ahead: Number(/ahead (\d+)/.exec(body)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(body)?.[1] ?? 0),
    dirty: lines.length - 1,
  }
}

const treeOf = (rows: readonly EditRow[]) => {
  const dirs = rows.map(r => r.path.split('/').slice(0, -1))
  let common = dirs[0] ?? []

  for (const d of dirs) {
    let i = 0

    while (i < common.length && i < d.length && common[i] === d[i]) {
      i += 1
    }
    common = common.slice(0, i)
  }
  const groups = new Map<string, { name: string; n: number }[]>()

  for (const r of rows) {
    const parts = r.path.split('/')
    const dir = parts.slice(common.length, -1).join('/') || '.'
    groups.set(dir, [...(groups.get(dir) ?? []), { name: parts[parts.length - 1] ?? r.path, n: r.n }])
  }

  return {
    root: common.join('/') || '/',
    groups: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  }
}

const hitsOf = (query: string, p: readonly PromptRow[], c: readonly Call[], er: readonly ErrorRow[], l: readonly LinkRow[]) => {
  const q = query.toLowerCase()
  const out: string[] = []

  for (const x of p) {
    if (x.text.toLowerCase().includes(q)) {
      out.push(`prompt: ${oneLine(x.text, 100)}`)
    }
  }

  for (const x of c) {
    if (`${x.tool} ${x.detail}`.toLowerCase().includes(q)) {
      out.push(`tool: ${x.tool} ${x.detail}`)
    }
  }

  for (const x of er) {
    if (`${x.tool} ${x.detail} ${x.reason}`.toLowerCase().includes(q)) {
      out.push(`error: ${x.tool} ${x.reason}`)
    }
  }

  for (const x of l) {
    if (x.url.toLowerCase().includes(q)) {
      out.push(`link: ${x.url}`)
    }
  }

  return out.slice(-CAP.hits)
}

// ---------------------------------------------------------------- helpers that take `$`

// One shared ticker, alive only while a turn runs and an item on screen needs seconds.
let ticker: Timer | undefined
// Copies of what the hooks need often, so they do not read state on every call or key press.
let durations: Durations = {}
let isDurationsDirty = false
let isDailyDirty = false
let isHideOnType = false
let isTypingNow = false
let isPermissionOpen = false
let barName = 'bar'
// The Overview's entrance plays once: only in the drawings right after its tab is shown.
let entrance = { tab: '', at: 0 }
const ENTRANCE_MS = 1500

const featureOn = (overrides: Record<string, boolean>, id: string) => overrides[`cockpit.${id}`] ?? true

const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
}

const syncTicker = async (d: Dollar, config: BarConfig, isTurn: boolean) => {
  if (!isTurn || !wantsTicker(config)) {
    stopTicker()
  } else if (ticker === undefined) {
    ticker = d.clock.every(1000, () => {
      void d.clock.now().then(t => update(d, now, () => t))
    })
  }
}

const storeKey = async (d: Dollar, cwd: string) =>
  cwd !== '' && featureOn(await read(d, settingsFeatures), 'bar-per-project') ? `bar:${projectKey(cwd)}` : 'bar:all'

/** A person's choice: shown at once and kept for this project. */
const saveBar = async (d: Dollar, config: BarConfig) => {
  await update(d, barConfig, () => config)
  isHideOnType = has(config, 'hidetyping')

  if (!isHideOnType && isTypingNow) {
    isTypingNow = false
    await update(d, isTypingHidden, () => false)
  }
  const live = await read(d, barLive)
  await syncTicker(d, config, live.isTurn)
  await d.store.set(await storeKey(d, live.cwd), storable(config))
}

const loadBar = async (d: Dollar, cwd: string) => {
  const raw = await d.store.get(await storeKey(d, cwd))
  const loaded = sanitizeConfig(raw, await d.clock.now())
  // The goal lives for the session only, so a reload keeps what is already on screen.
  const goal = (await read(d, barConfig)).goal
  const config = goal === '' ? loaded : { ...addItem(loaded, 'goal'), goal }
  await update(d, barConfig, () => config)
  isHideOnType = has(config, 'hidetyping')
  const saved = await d.store.get('bar:durations')
  durations =
    typeof saved === 'object' && saved !== null && !Array.isArray(saved)
      ? (Object.fromEntries(Object.entries(saved).filter(([, v]) => Array.isArray(v) && v.every(n => typeof n === 'number'))) as Durations)
      : {}
}

/** Writes what changed during the turn, once, instead of on every tool call. */
const flushStore = async (d: Dollar) => {
  if (isDailyDirty) {
    isDailyDirty = false
    await d.store.set('cdaily', await read(d, daily))
  }

  if (isDurationsDirty) {
    isDurationsDirty = false
    await d.store.set('bar:durations', durations)
  }
}

const optionsOf = (how: Partial<View>): LookOptions => ({ size: how.size ?? 'medium', glass: how.glass ?? 'frosted', corners: how.corners ?? 'soft' })

const applyChatLook = async (d: Dollar) => {
  // The answer is kept, so `/bar chat on` can say why nothing changed when nothing does.
  const how = await read(d, view)
  // one theme stands at a time, so the chat style and the colors are sent together
  const name = colorName(how.colors)
  const options = optionsOf(how)
  // A premium look brings its own message cards; the other themes keep the chosen chat style.
  const look = { ...themeFor(name, options), ...(how.chat === false ? {} : { style: isPremium(name) ? premiumStyle(name, options) : styleFor(how.chatStyle) }) }
  const said = await d.theme.set(look).then(
    r => (r.isDrawn ? 'The app accepted it.' : `The app is not drawing it: ${'reason' in r ? String(r.reason) : 'no reason given'}`),
    (e: unknown) => `The app refused it: ${String(e).slice(0, 200)}`,
  )
  await d.store.set('chatResult', { said }).catch(() => undefined)
}

const setView = async (d: Dollar, patch: Partial<View>) => {
  const next = { ...(await read(d, view)), ...patch }
  await update(d, view, () => next)
  await d.store.set('view', next)

  if ([patch.chat, patch.chatStyle, patch.colors, patch.size, patch.glass, patch.corners].some(x => x !== undefined)) {
    if (next.chat === false && colorName(next.colors) === 'app') {
      await d.theme.clear().catch(() => undefined)
    } else {
      await applyChatLook(d)
    }
  }

  return next
}

const forgetPrompts = async (d: Dollar) => {
  await update(d, myPrompts, () => ({}))
  await d.store.set('myprompts', {})
}

const rememberPrompt = async (d: Dollar, text: string) => {
  const kept = await read(d, myPrompts)
  const next = countPrompt(kept, text)

  if (next !== kept) {
    await update(d, myPrompts, () => next)
    await d.store.set('myprompts', next)
  }
}

const loadView = async (d: Dollar) => {
  const saved = viewOf(await d.store.get('view'))
  await update(d, view, () => saved)
  const counts = countsOf(await d.store.get('myprompts'))
  await update(d, myPrompts, () => counts)
}

// The text of drawn replies, for the right-click menu. Not state: nothing redraws when it changes.
const replyTexts = new Map<string, string>()

const askAbout = async (d: Dollar, lead: string, text: string) => {
  const filled = await d.prompt.fill({ text: `${lead}\n${quote(text)}\n`, mode: 'insert' })

  if (filled?.isFilled === false) {
    d.ui.toast('Could not fill the prompt box.')
  }
}

// Commands being watched for slowness. A quick one costs a single timer that is cancelled.
const slowTimers = new Map<string, Timer[]>()

const watchSlow = (d: Dollar, id: string, startedAt: number) => {
  const timers: Timer[] = []
  slowTimers.set(id, timers)

  const tick = () =>
    void d.clock.now().then(t => (slowTimers.has(id) ? update(d, slow, m => ({ ...m, [id]: Math.round((t - startedAt) / 1000) })) : undefined))
  timers.push(
    d.clock.after(SLOW_MS, () => {
      tick()
      timers.push(d.clock.every(1000, tick))
    }),
  )
}

const unwatchSlow = async (d: Dollar, id: string) => {
  for (const timer of slowTimers.get(id) ?? []) {
    timer.cancel()
  }
  slowTimers.delete(id)

  if ((await read(d, slow))[id] !== undefined) {
    await update(d, slow, m => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)))
  }
}

const runBar = async (d: Dollar, args: string) => {
  const option = /^(size|glass|corners)\s+(small|medium|large|clear|frosted|solid|soft|sharp)$/i.exec(args.trim())

  if (option !== null) {
    const key = (option[1] ?? '').toLowerCase()
    const value = (option[2] ?? '').toLowerCase()
    const fits = { size: ['small', 'medium', 'large'], glass: ['clear', 'frosted', 'solid'], corners: ['soft', 'sharp'] }[key as 'size']

    if (fits?.includes(value) === true) {
      await setView(d, { [key]: value } as Partial<View>)

      return { text: `${key}: ${value}. It shows with the premium looks.` }
    }
  }
  const colors = /^colors?\s+([a-z]+)$/i.exec(args.trim())?.[1]?.toLowerCase()

  if (colors !== undefined) {
    if (!COLOR_NAMES.includes(colorName(colors)) || colorName(colors) !== colors) {
      return { text: `Themes: ${COLOR_NAMES.join(', ')}.` }
    }
    await setView(d, { colors: colorName(colors) })

    return { text: colors === 'app' ? "The app's own colors are back." : `Colors: ${colors}.` }
  }
  const rows = /^rows\s+(on|off)$/i.exec(args.trim())?.[1]?.toLowerCase()

  if (rows !== undefined) {
    await setView(d, { rows: rows === 'on' })

    return { text: rows === 'on' ? 'Notes under edit and command rows are on.' : 'Notes under rows are off.' }
  }
  const chat = /^chat\s+(on|off|roomy|clean)$/i.exec(args.trim())?.[1]?.toLowerCase()

  if (chat !== undefined) {
    await setView(d, chat === 'roomy' || chat === 'clean' ? { chat: true, chatStyle: chat } : { chat: chat === 'on' })

    if (chat === 'off') {
      return { text: "Chat look off: the app's own look is back." }
    }
    const result = (await d.store.get('chatResult')) as { said?: unknown } | undefined

    const name = (await read(d, view)).chatStyle === 'clean' ? 'Clean' : 'Roomy'

    return { text: `${name} chat look on. ${String(result?.said ?? 'No answer from the app.')}` }
  }
  const wanted = /^(?:look|style)\s+(plain|rich)$/i.exec(args.trim())?.[1]?.toLowerCase()

  if (wanted === 'plain' || wanted === 'rich') {
    await setView(d, { look: wanted })

    return { text: wanted === 'plain' ? 'Plain look: one row, only when there is something to do.' : 'Rich look: the picture strip is back.' }
  }
  const out = applyBar(await read(d, barConfig), args, await d.clock.now(), barName)

  if (args.trim() === '' || args.trim().toLowerCase() === 'help') {
    const how = await read(d, view)
    const chatNow = how.chat === false ? 'off' : how.chatStyle === 'clean' ? 'clean' : 'roomy'

    return { text: `/${barName} size|glass|corners (premium looks)\n/${barName} colors ${COLOR_NAMES.join('|')} (now ${colorName(how.colors)})\n/${barName} rows on|off (now ${how.rows === false ? 'off' : 'on'})\n/${barName} chat roomy|clean|off (now ${chatNow})\n/${barName} look plain|rich (now ${how.look})\n${out.text}` }
  }

  if (out.isChanged) {
    await saveBar(d, out.config)
  }
  const isPlain = (await read(d, view)).look === 'plain'

  return { text: out.isChanged && isPlain ? `${out.text}\nThis shows in the rich look: /bar look rich.` : out.text }
}

const pressButton = async (d: Dollar, b: BarButton) => {
  if (b.kind === 'tab') {
    await openCockpit(d, b.tab)

    return
  }

  if (b.kind !== 'fill') {
    const config = await read(d, barConfig)
    await saveBar(
      d,
      b.kind === 'more' ? { ...config, size: nextSize(config.size) } : { ...config, quiet: b.kind === 'quiet' },
    )

    return
  }
  const wanted = b.text ?? ''
  // Filled, never sent. A draft in the box is kept: the text goes after it, except for a slash command.
  const draft = await d.prompt
    .read()
    .then(box => box.text)
    .catch(() => '')
  const isAppend = draft.trim() !== '' && !wanted.startsWith('/')
  const filled = await d.prompt.fill({ text: isAppend ? `\n${wanted}` : wanted, mode: isAppend ? 'append' : 'replace' })

  // A press that does nothing looks broken, so a refusal is said out loud.
  if (filled?.isFilled === false) {
    d.ui.toast(`Could not fill the prompt box. The text was: ${oneLine(wanted, 120)}`)
  }
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

const savePins = (d: Dollar, list: string[]) => d.store.set('cpins', list)
const saveTodos = (d: Dollar, list: Todo[]) => d.store.set('ctodos', list)
const saveShelf = (d: Dollar, list: string[]) => d.store.set('shelf', list)

const openCockpit = async (d: Dollar, to?: string) => {
  entrance = { tab: '', at: 0 }

  if (to !== undefined) {
    await update(d, tab, () => to)
  }
  await d.ui.open({ id: PANE, title: 'Cockpit' })
}

const togglePin = async (d: Dollar, text: string): Promise<boolean> => {
  const clean = oneLine(text, 120)
  const list = await read(d, pins)
  const has = list.includes(clean)
  const next = has ? list.filter(p => p !== clean) : [...list, clean].slice(-CAP.pins)
  await update(d, pins, () => next)
  await savePins(d, next)

  return !has
}

const addTodo = async (d: Dollar, text: string) => {
  const list = await read(d, todos)
  const id = list.reduce((m, t) => Math.max(m, t.id), 0) + 1
  const next = [...list, { id, text: oneLine(text, 200), done: false }].slice(-CAP.todos)
  await update(d, todos, () => next)
  await saveTodos(d, next)

  return id
}

const tickTodo = async (d: Dollar, id: number) => {
  const next = (await read(d, todos)).map(t => (t.id === id ? { ...t, done: !t.done } : t))
  await update(d, todos, () => next)
  await saveTodos(d, next)
}

const clearDone = async (d: Dollar) => {
  const next = (await read(d, todos)).filter(t => !t.done)
  await update(d, todos, () => next)
  await saveTodos(d, next)
}

const addShelf = async (d: Dollar, text: string) => {
  const next = [...(await read(d, shelf)), text.trim().slice(0, 500)].slice(-CAP.shelf)
  await update(d, shelf, () => next)
  await saveShelf(d, next)

  return next.length
}

const dropShelf = async (d: Dollar, index: number) => {
  const next = (await read(d, shelf)).filter((_, i) => i !== index)
  await update(d, shelf, () => next)
  await saveShelf(d, next)
}

const addLinks = async (d: Dollar, urls: string[], at: number) => {
  if (urls.length === 0) {
    return
  }
  await update(d, links, list => {
    const seen = new Set(list.map(l => l.url))
    const fresh: LinkRow[] = []

    for (const url of urls) {
      if (!seen.has(url)) {
        seen.add(url)
        fresh.push({ url, at })
      }
    }

    return [...list, ...fresh].slice(-CAP.links)
  })
}

const bumpDaily = async (d: Dollar, delta: Partial<DayRow>) => {
  const key = dayKey(await d.clock.now())
  const cur = await read(d, daily)
  const row = cur[key] ?? { sessions: 0, calls: 0, usd: 0 }
  const merged: Record<string, DayRow> = {
    ...cur,
    [key]: {
      sessions: row.sessions + (delta.sessions ?? 0),
      calls: row.calls + (delta.calls ?? 0),
      usd: Math.round((row.usd + (delta.usd ?? 0)) * 10_000) / 10_000,
    },
  }
  const keep = Object.keys(merged).sort().slice(-CAP.days)
  const next: Record<string, DayRow> = {}

  for (const k of keep) {
    next[k] = merged[k] as DayRow
  }
  await update(d, daily, () => next)
  isDailyDirty = true
}

const refreshGit = async (d: Dollar) => {
  try {
    // Read-only: status with optional locks off never writes to the repository.
    const out = await d.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '-b'], {
      timeoutMs: 5000,
    })
    await update(d, git, () => (out.exitCode === 0 ? parseGit(out.stdout) : null))
  } catch {
    await update(d, git, () => null)
  }
}

const sampleUsage = async (d: Dollar): Promise<Usage> => {
  const usage = await d.session.usage()
  const t = await d.clock.now()
  const usd = usage.cost?.usd ?? null
  await update(d, now, () => t)
  await update(d, contextPercent, () => usage.context.percent ?? null)
  await update(d, costUsd, () => usd)

  if (usd !== null) {
    await update(d, costSamples, list => [...list, usd].slice(-CAP.samples))
  }

  if (usage.context.percent !== null && usage.context.percent !== undefined) {
    const pct = usage.context.percent
    await update(d, ctxSamples, list => [...list, pct].slice(-CAP.samples))
  }
  const fresh: LimitSample[] = usage.rateLimits.map(r => ({
    t,
    kind: r.kind,
    p: r.percentUsed,
    resetsAt: r.resetsAt === undefined ? null : Date.parse(r.resetsAt) || null,
  }))
  await update(d, limitSamples, list => [...list, ...fresh].slice(-CAP.limits))

  const before = await read(d, lastUsd)

  if (usd !== null) {
    await update(d, lastUsd, () => usd)

    if (before !== null && usd > before) {
      await bumpDaily(d, { usd: usd - before })
    }
  }

  return {
    contextPct: usage.context.percent ?? null,
    contextTokens: usage.context.tokens ?? null,
    window: usage.context.window || null,
    costUsd: usd,
    limit: await topLimit(d, fresh),
  }
}

/** The fullest rate-limit window, with the pace it is filling at. */
const topLimit = async (d: Dollar, fresh: readonly LimitSample[]): Promise<BarLive['limit']> => {
  const top = [...fresh].sort((a, b) => b.p - a.p)[0]

  if (top === undefined) {
    return null
  }
  const mine = (await read(d, limitSamples)).filter(x => x.kind === top.kind)

  return { kind: top.kind, pct: top.p, resetsAt: top.resetsAt, paceMin: forecastMin(mine) }
}

const loadStore = async (d: Dollar) => {
  const t = await d.store.get('ctodos')
  const list: Todo[] = Array.isArray(t)
    ? t
        .filter((x): x is Todo => typeof x === 'object' && x !== null && typeof (x as Todo).text === 'string')
        .map(x => ({ id: Number(x.id) || 0, text: String(x.text), done: x.done === true }))
    : []
  await update(d, todos, () => list)
  const shelved = asList(await d.store.get('shelf'))
  const pinned = asList(await d.store.get('cpins'))
  await update(d, shelf, () => shelved)
  await update(d, pins, () => pinned)
  const days = await d.store.get('cdaily')
  await update(d, daily, () =>
    typeof days === 'object' && days !== null && !Array.isArray(days) ? (days as Record<string, DayRow>) : {},
  )
}

// ---------------------------------------------------------------- the mod

export const register: Register = on => {
  // This mod's own section in the shared "Mod manager" settings panel.
  on('ui.render', { component: 'Pane', plugin: '*', requestId: 'mod-settings' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const how = await read($, view)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="column" marginTop="md">
          <Text weight="bold">Look and chat (cockpit)</Text>
          <Box gap="sm" flexWrap="wrap">
            <Button key="cp-chat" label={`Chat style: ${how.chat === false ? 'off' : how.chatStyle === 'clean' ? 'clean' : 'roomy'}`} onPress={() => setView($, how.chat === false ? { chat: true, chatStyle: 'roomy' } : how.chatStyle === 'clean' ? { chat: false } : { chatStyle: 'clean' })} />
            {COLOR_NAMES.map(c => (
              <Button key={`cp-colors-${c}`} label={`${colorName(how.colors) === c ? '● ' : ''}${colorLabel(c)}`} onPress={() => setView($, { colors: c })} />
            ))}
            <Button key="cp-size" label={`Text size: ${optionsOf(how).size}`} onPress={() => setView($, { size: optionsOf(how).size === 'small' ? 'medium' : optionsOf(how).size === 'medium' ? 'large' : 'small' })} />
            <Button key="cp-glass" label={`Glass: ${optionsOf(how).glass}`} onPress={() => setView($, { glass: optionsOf(how).glass === 'clear' ? 'frosted' : optionsOf(how).glass === 'frosted' ? 'solid' : 'clear' })} />
            <Button key="cp-corners" label={`Corners: ${optionsOf(how).corners}`} onPress={() => setView($, { corners: optionsOf(how).corners === 'soft' ? 'sharp' : 'soft' })} />
            <Button key="cp-rows" label={`Notes under rows: ${how.rows === false ? 'off' : 'on'}`} onPress={() => setView($, { rows: how.rows === false })} />
            <Button key="cp-clean" label={`Row above the box: ${how.clean ? 'hidden' : 'shown'}`} onPress={() => setView($, { clean: !how.clean })} />
            <Button key="cp-alert" label={`Done pop-up: ${how.alert ? 'on' : 'off'}`} onPress={() => setView($, { alert: !how.alert })} />
            <Button key="cp-look" label={`Panels: ${how.look}`} onPress={() => setView($, { look: how.look === 'plain' ? 'rich' : 'plain' })} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['cockpit', 'Open the cockpit pane: /cockpit [overview|timeline|files|todo|history|errors|links|palette|bar]'],
      ['ctodo', 'Add a todo: /ctodo <text> (tick them off in the cockpit Todo tab)'],
      ['csearch', 'Search this session\'s prompts and tool calls: /csearch <text>'],
      ['cshelf', 'Snippet shelf: /cshelf add <text>, /cshelf <n>, /cshelf rm <n>'],
      ['cpin', 'Pin or unpin a note on top of the cockpit: /cpin <text>'],
      ['cfocus', 'Hide or show only the cockpit bands'],
      ['clean', 'Hide everything the cockpit draws or pops up, or bring it back: /clean'],
    ] as const) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    const about = {
      description: 'Choose what the strip above the prompt shows: /bar for help',
      argumentHint: '[add|remove|move|slim|normal|expanded|theme|preset|goal|note|deadline|budget|button|quiet]',
      immediate: true as const,
    }
    barName = await $.command
      .register({ name: 'bar', ...about })
      .then(() => 'bar')
      .catch(async () => {
        await $.command.register({ name: 'cbar', ...about }).catch(() => undefined)

        return 'cbar'
      })

    // The three awaits below can fail on a host without a store or usage ledger.
    await loadStore($).catch(() => undefined)
    await loadView($).catch(() => undefined)

    const wanted = await read($, view)

    if (wanted.chat !== false || colorName(wanted.colors) !== 'app') {
      await applyChatLook($)
    }
    await loadBar($, e.cwd).catch(() => undefined)
    const usage = await $.session.usage()
    await update($, sessionStart, () => usage.startedAt)
    await update($, now, () => usage.startedAt)
    await update($, lastUsd, () => usage.cost?.usd ?? null)

    if (!(await read($, isSessionCounted))) {
      await update($, isSessionCounted, () => true)
      await bumpDaily($, { sessions: 1 }).catch(() => undefined)
    }
    // After a reload the digest starts empty, so it takes what the session already knows.
    const trend = await read($, ctxSamples)
    const limit = await topLimit(
      $,
      usage.rateLimits.map(r => ({
        t: usage.startedAt,
        kind: r.kind,
        p: r.percentUsed,
        resetsAt: r.resetsAt === undefined ? null : Date.parse(r.resetsAt) || null,
      })),
    )
    await update($, barLive, l => ({
      ...l,
      isTurn: false,
      running: [],
      waiting: null,
      cwd: e.cwd,
      sessionStartedAt: usage.startedAt,
      contextPct: usage.context.percent ?? l.contextPct,
      costUsd: usage.cost?.usd ?? l.costUsd,
      limit: limit ?? l.limit,
      trend: l.trend.length > 0 ? l.trend : trend.slice(-24),
    }))
    isPermissionOpen = false
    isTypingNow = false
    entrance = { tab: '', at: 0 }
    await update($, isTypingHidden, () => false)
    await flushStore($).catch(() => undefined)
    void refreshGit($)
    stopTicker()

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (isTypingNow) {
      isTypingNow = false
      await update($, isTypingHidden, () => false)
    }

    if (e.command === undefined && e.isMeta !== true && e.text.trim() !== '') {
      const at = await $.clock.now()
      await update($, turns, n => n + 1)
      await update($, prompts, list => [...list, { text: e.text.slice(0, 500), at }].slice(-CAP.prompts))
      await addLinks($, urlsIn(e.text), at)
      await rememberPrompt($, e.text).catch(() => undefined)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      const config = await read($, barConfig)
      const info = has(config, 'changed') ? await read($, git) : null
      const open = has(config, 'changed') && has(config, 'todos') ? (await read($, todos)).filter(t => !t.done).length : 0
      await update($, now, () => at)
      await update($, barLive, l => {
        const before = has(config, 'changed')
          ? snapshotChips({ config, live: l, git: info, openTodos: open, now: at, isWorking: l.isTurn })
          : {}

        return { ...reduceTurnStart(l, at), before }
      })
      await syncTicker($, config, true)
    }

    return next(e)
  })

  // Only keys that begin at the start of the box reach this: the first character typed into an
  // empty box, or the deletion that empties it. Ordinary typing never calls into the mod.
  on('prompt.edit', { start: 0 }, async ($, e, next) => {
    const box = await next(e)
    const isNowHidden = isHideOnType && box.text !== ''

    if (isNowHidden !== isTypingNow) {
      isTypingNow = isNowHidden
      await update($, isTypingHidden, () => isNowHidden)
    }

    return box
  })

  // The box emptied some other way (cleared, history, a fill): show the bar again.
  on('prompt.change', async ($, e, next) => {
    if (isTypingNow && e.text === '') {
      isTypingNow = false
      await update($, isTypingHidden, () => false)
    }

    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.tool_name !== 'AskUserQuestion') {
      isPermissionOpen = true
      await update($, barLive, l => ({ ...l, waiting: 'permission' as const }))
    }

    return next(e)
  })

  // A call that is about to run has been approved.
  on('tool.run', async ($, e, next) => {
    if (isPermissionOpen) {
      isPermissionOpen = false
      await update($, barLive, l => (l.waiting === 'permission' ? { ...l, waiting: null } : l))
    }

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const tasks = e.background_tasks

    if (tasks !== undefined && featureOn(await read($, settingsFeatures), 'bar-background')) {
      const count = tasks.filter(t => !/complete|fail|kill|stop|cancel/i.test(t.status)).length
      await update($, barLive, l => (l.background === count ? l : { ...l, background: count }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const startedAt = await $.clock.now()
    const id = e.tool_use_id ?? `${e.tool}-${startedAt}`
    const detail = detailOf(input)
    const isAgent = (input.agentId as string | undefined) !== undefined
    const isShell = e.tool === 'Bash' || e.tool === 'PowerShell'
    const key = isShell ? commandKey(String(input.command ?? '')) : ''
    await update($, now, () => startedAt)
    await update($, calls, list =>
      [...list, { id, tool: e.tool, detail, startedAt, endedAt: null, isError: false } as Call].slice(-CAP.calls),
    )
    await update($, barLive, l =>
      reduceToolStart(l, { id, tool: e.tool, input, at: startedAt, estimateMs: estimateOf(durations, key), isAgent }),
    )

    let failure: string | null = null
    let output = ''
    let ran: Awaited<ReturnType<typeof next>>

    if (isShell) {
      try {
        watchSlow($, id, startedAt)
      } catch {
        // no timers here: the row simply gets no running time
      }
    }

    try {
      ran = await next(e)

      if (isShell) {
        await unwatchSlow($, id)
      }
    } catch (err) {
      if (isShell) {
        await unwatchSlow($, id)
      }
      const endedAt = await $.clock.now()
      const reason = oneLine(String((err as Error)?.message ?? err), 160)
      await update($, calls, list => list.map(c => (c.id === id ? { ...c, endedAt, isError: true } : c)))
      await update($, errors, list =>
        [...list, { tool: e.tool, detail, reason, at: endedAt }].slice(-CAP.errors),
      )
      await update($, barLive, l =>
        reduceToolEnd(l, { id, tool: e.tool, input, at: endedAt, failure: reason, isDenied: false, output: reason, result: undefined, isAgent }),
      )
      throw err
    }
    const endedAt = await $.clock.now()

    if (ran.deny !== undefined) {
      failure = `denied: ${ran.deny}`
    } else if (ran.isError === true) {
      failure = ran.text ?? String(ran.result ?? 'failed')
    }
    output = ran.text ?? ''
    const isFailed = failure !== null

    await update($, now, () => endedAt)
    await update($, calls, list => list.map(c => (c.id === id ? { ...c, endedAt, isError: isFailed } : c)))

    if (failure !== null) {
      const reason = oneLine(failure, 160)
      await update($, errors, list => [...list, { tool: e.tool, detail, reason, at: endedAt }].slice(-CAP.errors))
    } else if (EDIT_TOOLS.has(e.tool)) {
      const path = String(input.file_path ?? input.notebook_path ?? '')
      await update($, editMarks, m => addMark(m, id))

      if (path !== '') {
        await update($, edits, list =>
          list.some(r => r.path === path)
            ? list.map(r => (r.path === path ? { ...r, n: r.n + 1 } : r))
            : [...list, { path, n: 1 }].slice(-CAP.edits),
        )
      }
    }

    isPermissionOpen = false
    await update($, barLive, l =>
      reduceToolEnd(l, {
        id,
        tool: e.tool,
        input,
        at: endedAt,
        failure,
        isDenied: ran.deny !== undefined,
        output,
        result: ran.result,
        isAgent,
      }),
    )

    // A run moved to the background answers at once, so its time and result say nothing.
    const isPending = !isFailed && isBackgrounded(input, ran.result)

    if (isShell && !isFailed && !isPending && featureOn(await read($, settingsFeatures), 'bar-estimates')) {
      const nextDurations = rememberDuration(durations, key, endedAt - startedAt)
      isDurationsDirty = isDurationsDirty || nextDurations !== durations
      durations = nextDurations
    }

    if (e.tool === 'Bash' && !isPending && isTestCommand(String(input.command ?? ''))) {
      const ok = testsPassed(isFailed, output)
      await update($, tests, list => [...list, { at: endedAt, ok } as TestRun].slice(-CAP.tests))

      if (ran.deny === undefined) {
        await update($, editMarks, m => settleMarks(m, ok))
      }
    }
    await addLinks($, urlsIn(output), endedAt)
    await bumpDaily($, { calls: 1 }).catch(() => undefined)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const usage = await sampleUsage($)

    if (e.agentId === undefined) {
      stopTicker()
      isPermissionOpen = false
      const at = await $.clock.now()
      const todayUsd = (await read($, daily))[dayKey(at)]?.usd ?? null
      await update($, barLive, l => reduceTurnEnd(reduceUsage(l, usage), { isAnswer: e.reason === 'answer', todayUsd }))
      const chosen = await read($, view)

      if (chosen.alert && !chosen.clean && e.reason === 'answer' && e.durationMs >= LONG_TURN_MS) {
        $.ui.toast(longTurnText(e.durationMs))
      }
    }
    const done = await next(e)
    await refreshGit($)
    await flushStore($).catch(() => undefined)

    return done
  })

  // ------------------------------------------------------------ commands

  on('command.run', { command: 'cockpit' }, async ($, e) => {
    const want = e.args.trim().toLowerCase()
    const hit = TABS.find(([id]) => id === want)
    await openCockpit($, hit?.[0])

    return { text: hit === undefined ? 'Cockpit opened.' : `Cockpit opened on ${hit[1]}.` }
  })

  on('command.run', { command: 'ctodo' }, async ($, e) => {
    const text = e.args.trim()

    if (text === '') {
      await openCockpit($, 'todo')

      return { text: 'Todo tab opened. Add one with /ctodo <text>.' }
    }
    const id = await addTodo($, text)

    return { text: `Todo #${id} added.` }
  })

  on('command.run', { command: 'csearch' }, async ($, e) => {
    const query = e.args.trim()

    if (query === '') {
      return { text: 'Usage: /csearch <text>' }
    }
    const hits = hitsOf(query, await read($, prompts), await read($, calls), await read($, errors), await read($, links))
    await update($, search, () => ({ query, hits }))
    await openCockpit($, 'history')

    return { text: hits.length === 0 ? `No matches for "${query}".` : `${hits.length} match(es) for "${query}" in the History tab.` }
  })

  on('command.run', { command: 'cshelf' }, async ($, e) => {
    const args = e.args.trim()
    const list = await read($, shelf)

    if (args === '') {
      await openCockpit($, 'links')

      return { text: list.length === 0 ? 'Shelf is empty. /cshelf add <text>' : list.map((s, i) => `${i + 1}. ${oneLine(s, 80)}`).join('\n') }
    }

    if (/^add\s/i.test(args)) {
      const n = await addShelf($, args.slice(4))

      return { text: `Shelved (${n} on the shelf).` }
    }
    const rm = /^rm\s+(\d+)$/i.exec(args)

    if (rm !== null) {
      await dropShelf($, Number(rm[1]) - 1)

      return { text: `Removed item ${rm[1]}.` }
    }
    const slot = list[Number(args) - 1]

    if (slot === undefined) {
      return { text: 'Usage: /cshelf add <text> | /cshelf <n> | /cshelf rm <n>' }
    }
    await $.prompt.fill({ text: slot, mode: 'replace' })

    return { text: `Shelf item ${args} is in the prompt box.` }
  })

  on('command.run', { command: 'cpin' }, async ($, e) => {
    const text = e.args.trim()

    if (text === '') {
      const list = await read($, pins)

      return { text: list.length === 0 ? 'No pins. /cpin <text> pins a note.' : list.map(p => `- ${p}`).join('\n') }
    }
    const added = await togglePin($, text)

    return { text: added ? 'Pinned.' : 'Unpinned.' }
  })

  on('command.run', { command: 'bar' }, async ($, e) => runBar($, e.args))

  on('command.run', { command: 'cbar' }, async ($, e) => runBar($, e.args))

  on('command.run', { command: 'cfocus' }, async $ => {
    const next = !(await read($, isFocus))
    await update($, isFocus, () => next)

    if (!next) {
      await update($, isBandHidden, () => false)
    }

    return { text: next ? 'Cockpit bands hidden (other mods untouched).' : 'Cockpit bands shown.' }
  })

  on('command.run', { command: 'clean' }, async $ => {
    const next = await setView($, { clean: !(await read($, view)).clean })

    return {
      text: next.clean
        ? 'Hidden: the cockpit row and pop-ups. Warnings from the safety mods still show. /clean brings it back.'
        : 'The cockpit row and pop-ups are back.',
    }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    const wanted = String(e.props.scene)

    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || !isPremium(wanted)) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const isMoving = (await read($, motionIsOn)) && !(await read($, settingsIsCalm))

    return <Svg source={scene(wanted, isMoving)} alt="A slow, soft backdrop" isInteractive />
  })

  // The app keeps its own working row (what it is doing, time, tokens); the step line goes under it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'desktop') {
      return next(e)
    }
    const how = await read($, view)
    const tasks = how.clean || how.look !== 'plain' ? [] : (await read($, barLive)).tasks
    const steps = stepsOf(tasks)

    if (steps === null) {
      return next(e)
    }

    const name = colorName(how.colors)

    if (!isPremium(name)) {
      return drawSteps($.ui.resolve(e), steps, await next(e))
    }
    const { Box, Text, Svg } = $.ui.resolve(e)
    const picture = stepBar(name, tasks.filter(t => t.status === 'completed').length, tasks.length)

    return (
      <Box flexDirection="column" gap="sm">
        {await next(e)}
        <Svg source={picture.source} alt={steps.text} width={picture.width} height={picture.height} />
        <Text dimColor>{steps.text}</Text>
      </Box>
    )
  })

  // One line under an edit or command row. Rows with nothing to say stay exactly the app's.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    const isEdit = EDIT_TOOLS.has(p.tool)
    const isShell = p.tool === 'Bash' || p.tool === 'PowerShell'
    const wantsNote = (isEdit && !p.isRunning && !p.isErrored) || (isShell && (p.isRunning || (p.isErrored && !p.isInterrupted)))

    if (!wantsNote) {
      return next(e)
    }
    const how = await read($, view)

    if (how.clean || how.look !== 'plain' || how.rows === false) {
      return next(e)
    }
    let note: RowNote | null

    if (isEdit) {
      note = markNote((await read($, editMarks))[p.tool_use_id])
    } else if (p.isRunning) {
      // only a running command listens to the seconds, so finished rows are not redrawn by them
      const seconds = (await read($, slow))[p.tool_use_id]
      note = seconds === undefined || (await read($, barLive)).waiting !== null ? null : slowNote(seconds)
    } else {
      note = errorNote(p.output)
    }

    return note === null ? next(e) : drawNote($.ui.resolve(e), note, await next(e))
  })

  // Notes each reply's text as it is drawn and changes nothing about how it looks.
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    rememberText(replyTexts, e.requestId, e.props.text)

    return next(e)
  })

  on('ui.render', { component: 'ContextMenu' }, async ($, e, next) => {
    const target = menuTarget(e.props, replyTexts)

    if (target === null || (await read($, view)).clean) {
      return next(e)
    }

    return drawMenu(
      $.ui.resolve(e),
      lead => askAbout($, lead, target.text),
      async () => {
        const added = await togglePin($, pinText(target.text))
        $.ui.toast(added ? 'Pinned. See it at the top of /cockpit.' : 'Unpinned.')
      },
      await next(e),
    )
  })

  // ------------------------------------------------------------ pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // Only the desktop surface draws the cards (pictures); every other surface keeps the text layout.
    const chosenView = await read($, view)
    const isPlain = chosenView.look === 'plain'
    const desk = e.surface === 'desktop' && !isPlain ? (ui as ElementTable<'desktop'>) : undefined
    const Svg = desk?.Svg
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 9)
    const cols = e.props.bodyColumns
    const active = await read($, tab)

    const Heading = (title: string, right?: string) => (
      <Box justifyContent="space-between" marginBottom="sm">
        <Text size="heading" weight="bold">
          {title}
        </Text>
        {right !== undefined && (
          <Text dimColor mono tabular>
            {right}
          </Text>
        )}
      </Box>
    )

    const Section = (label: string) => (
      <Box marginTop="md">
        <Text size="caption" weight="semibold" dimColor>
          {label.toUpperCase()}
        </Text>
      </Box>
    )

    const Tile = (label: string, value: string, color?: string) => (
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm" flexGrow={1}>
        <Text size="caption" dimColor>
          {label}
        </Text>
        <Text size="heading" weight="bold" tabular color={color}>
          {value}
        </Text>
      </Box>
    )

    const Gauge = (label: string, percent: number) => (
      <Box gap="sm">
        <Text dimColor mono>
          {label.padEnd(9)}
        </Text>
        <Text mono color={toneOf(percent)}>
          {bar(percent / 100)}
        </Text>
        <Text mono tabular>
          {String(Math.round(percent)).padStart(3)}%
        </Text>
      </Box>
    )

    const t = await read($, now)
    const start = await read($, sessionStart)
    const pinned = await read($, pins)
    // The desktop's cards follow the strip's theme (`/bar theme`).
    const look = desk === undefined ? undefined : { width: paneWidth(cols), theme: (await read($, barConfig)).theme }

    // Leaving the Overview arms its entrance again.
    if (active !== 'overview') {
      entrance = { tab: active, at: 0 }
    }

    let body: unknown = null

    if (active === 'timeline') {
      const every = await read($, calls)
      const list = every.slice(-Math.max(3, room))
      const width = Math.max(10, Math.min(40, cols - 24))
      const t0 = Math.min(...list.map(c => c.startedAt), t)
      const t1 = Math.max(t, ...list.map(c => c.endedAt ?? 0))
      const span = Math.max(1, t1 - t0)

      if (desk !== undefined && look !== undefined) {
        const rows = list.map(c => ({
          tool: c.tool,
          detail: c.detail,
          off: (c.startedAt - t0) / span,
          len: ((c.endedAt ?? t1) - c.startedAt) / span,
          state: c.isError ? ('bad' as const) : c.endedAt === null ? ('run' as const) : ('ok' as const),
          duration: c.endedAt === null ? 'running' : durOf(c.endedAt - c.startedAt),
        }))

        body = picture(desk, timelineCard(rows, `${durOf(t1 - t0)} window`, every.length - rows.length, look))
      } else {
        body = (
          <Box flexDirection="column">
            {Heading('Tool timeline', `${durOf(t1 - t0)} window`)}
            {list.length === 0 && <Text dimColor>No tool calls yet. Each call will draw a bar here.</Text>}
            {list.map(c => {
              const end = c.endedAt ?? t1
              const off = Math.min(width - 1, Math.floor(((c.startedAt - t0) / span) * width))
              const len = Math.max(1, Math.min(width - off, Math.round(((end - c.startedAt) / span) * width)))
              const rest = width - off - len

              return (
                <Box gap="sm">
                  <Text mono dimColor>
                    {c.tool.slice(0, 8).padEnd(8)}
                  </Text>
                  <Box>
                    {off > 0 && (
                      <Text mono dimColor>
                        {'·'.repeat(off)}
                      </Text>
                    )}
                    <Text mono color={c.isError ? 'error' : c.endedAt === null ? 'suggestion' : 'success'}>
                      {'█'.repeat(len)}
                    </Text>
                    {rest > 0 && (
                      <Text mono dimColor>
                        {'·'.repeat(rest)}
                      </Text>
                    )}
                  </Box>
                  <Text mono tabular dimColor>
                    {c.endedAt === null ? 'running' : durOf(c.endedAt - c.startedAt)}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )
      }
    } else if (active === 'files') {
      const rows = await read($, edits)
      const tree = treeOf(rows)
      const total = rows.reduce((s, r) => s + r.n, 0)

      if (desk !== undefined && look !== undefined) {
        const groups = tree.groups.slice(0, Math.max(2, Math.floor(room / 2))).map(([dir, files]) => ({
          dir: dir === '.' ? './' : `${dir}/`,
          files: files.slice(0, 8),
        }))

        body = picture(desk, filesCard({ root: tree.root, groups, files: rows.length, edits: total }, look))
      } else {
        body = (
          <Box flexDirection="column">
            {Heading('Edited files', `${rows.length} files, ${total} edits`)}
            {rows.length === 0 && <Text dimColor>Nothing edited yet. Files Claude changes will collect here.</Text>}
            {rows.length > 0 && (
              <Text dimColor mono>
                {tree.root}
              </Text>
            )}
            {tree.groups.slice(0, Math.max(2, Math.floor(room / 2))).map(([dir, files]) => (
              <Box flexDirection="column">
                <Text weight="semibold" color="suggestion">
                  {dir === '.' ? './' : `${dir}/`}
                </Text>
                {files.slice(0, 8).map(f => (
                  <Box gap="sm" paddingLeft="md">
                    <Text>{f.name}</Text>
                    <Text dimColor tabular>
                      {`x${f.n}`}
                    </Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        )
      }
    } else if (active === 'todo') {
      const list = await read($, todos)
      const open = list.filter(x => !x.done).length

      if (desk !== undefined && look !== undefined) {
        body = drawTodo(desk, look, { all: list, shown: list.slice(-room), columns: cols }, {
          tick: id => tickTodo($, id),
          clear: () => clearDone($),
        })
      } else {
        body = (
          <Box flexDirection="column">
            {Heading('Todo', `${open} open / ${list.length}`)}
            {list.length === 0 && <Text dimColor>Nothing yet. Add one with /ctodo your text.</Text>}
            {list.slice(-room).map(x => (
              <Button
                key={`todo-${x.id}`}
                dimColor={x.done}
                onPress={() => tickTodo($, x.id)}
                label={`${x.done ? '[x]' : '[ ]'} ${oneLine(x.text, Math.max(20, cols - 10))}`}
              />
            ))}
            {list.some(x => x.done) && (
              <Box marginTop="md">
                <Button key="todo-clear" label="Clear done" onPress={() => clearDone($)} />
              </Box>
            )}
          </Box>
        )
      }
    } else if (active === 'history') {
      const every = await read($, prompts)
      const list = every.slice(-Math.max(3, room - 6)).reverse()
      const found = await read($, search)
      const days = await read($, daily)
      const dayKeys = Object.keys(days).sort().slice(-5).reverse()

      if (desk !== undefined && look !== undefined) {
        body = drawHistory(
          desk,
          look,
          {
            list,
            total: every.length,
            pinned,
            found,
            days: dayKeys.map(day => ({ ...(days[day] as DayRow), day })),
          },
          { refill: text => $.prompt.fill({ text, mode: 'replace' }), pin: text => togglePin($, text) },
        )
      } else {
        body = (
          <Box flexDirection="column">
            {Heading('Prompt history', `${list.length} shown`)}
            {list.length === 0 && <Text dimColor>No prompts yet. Click one later to refill the prompt box.</Text>}
            {list.map((p, i) => (
              <Box gap="sm">
                <Button
                  key={`hist-${i}`}
                  onPress={() => $.prompt.fill({ text: p.text, mode: 'replace' })}
                  label={oneLine(p.text, Math.max(20, cols - 14))}
                />
                <Button
                  key={`histpin-${i}`}
                  dimColor
                  onPress={() => togglePin($, p.text)}
                  label={pinned.includes(oneLine(p.text, 120)) ? 'unpin' : 'pin'}
                />
              </Box>
            ))}

            {Section(found.query === '' ? 'Search' : `Search: ${found.query}`)}
            {found.query === '' && <Text dimColor>Use /csearch text to search prompts and tool calls.</Text>}
            {found.query !== '' && found.hits.length === 0 && <Text dimColor>No matches.</Text>}
            {found.hits.slice(-6).map(hit => (
              <Text>{oneLine(hit, cols - 4)}</Text>
            ))}

            {Section('Days')}
            {dayKeys.length === 0 && <Text dimColor>No daily stats yet.</Text>}
            {dayKeys.map(k => {
              const d = days[k] as DayRow

              return (
                <Text mono tabular>
                  {k}  {String(d.sessions).padStart(2)} sess  {String(d.calls).padStart(4)} calls  ${d.usd.toFixed(2)}
                </Text>
              )
            })}
          </Box>
        )
      }
    } else if (active === 'errors') {
      const every = await read($, errors)
      const list = every.slice(-Math.max(3, room)).reverse()

      if (desk !== undefined && look !== undefined) {
        body = picture(desk, errorsCard(list.map(x => ({ ...x, time: hhmm(x.at) })), every.length - list.length, look))
      } else {
        body = (
          <Box flexDirection="column">
            {Heading('Errors', `${list.length}`)}
            {list.length === 0 && <Text dimColor>No failed tool calls. Good.</Text>}
            {list.map(x => (
              <Box flexDirection="column" marginBottom="sm">
                <Text>
                  <Text color="error">x</Text> <Text weight="semibold">{x.tool}</Text>{' '}
                  <Text dimColor>{oneLine(x.detail, Math.max(10, cols - 20))}</Text>
                </Text>
                <Text color="error">{oneLine(x.reason, cols - 4)}</Text>
              </Box>
            ))}
          </Box>
        )
      }
    } else if (active === 'links') {
      const every = await read($, links)
      const list = every.slice(-Math.max(3, room - 6)).reverse()
      const saved = await read($, shelf)

      if (desk !== undefined && look !== undefined) {
        body = drawLinks(desk, look, { list, total: every.length, saved }, {
          copy: (url, surface) => $.ui.copy({ text: url, surface }),
          refill: text => $.prompt.fill({ text, mode: 'replace' }),
          drop: at => dropShelf($, at),
        })
      } else {
        body = (
          <Box flexDirection="column">
            {Heading('Links', `${list.length}`)}
            {list.length === 0 && <Text dimColor>No URLs seen yet in prompts or tool output.</Text>}
            {list.map((l, i) => (
              <Box gap="sm">
                <Button
                  key={`link-${i}`}
                  dimColor
                  label="copy"
                  onPress={press => $.ui.copy({ text: l.url, surface: press.surface })}
                />
                <Text>{oneLine(l.url, Math.max(20, cols - 12))}</Text>
              </Box>
            ))}

            {Section(`Shelf (${saved.length})`)}
            {saved.length === 0 && <Text dimColor>Empty. /cshelf add your text.</Text>}
            {saved.slice(-5).map((s, i) => {
              const at = Math.max(0, saved.length - 5) + i

              return (
                <Box gap="sm">
                  <Button
                    key={`shelf-${at}`}
                    onPress={() => $.prompt.fill({ text: s, mode: 'replace' })}
                    label={oneLine(s, Math.max(20, cols - 14))}
                  />
                  <Button key={`shelfrm-${at}`} dimColor label="drop" onPress={() => dropShelf($, at)} />
                </Box>
              )
            })}
          </Box>
        )
      }
    } else if (active === 'bar') {
      const change = async (edit: (c: BarConfig) => BarConfig) => saveBar($, edit(await read($, barConfig)))

      body = drawSettings(ui, await read($, barConfig), barName, {
        size: s => change(c => ({ ...c, size: s, quiet: false })),
        theme: th => change(c => ({ ...c, theme: th })),
        quiet: () => change(c => ({ ...c, quiet: !c.quiet })),
        preset: p => change(c => applyPreset(c, p) ?? c),
        toggle: id => change(c => toggleItem(c, id)),
        move: (id, by) => change(c => ({ ...c, items: moveItem(c.items, id, by) })),
      }, look)
    } else if (active === 'palette') {
      if (desk !== undefined && look !== undefined) {
        body = drawPalette(desk, look, PALETTE, command => $.prompt.fill({ text: command, mode: 'replace' }))
      } else {
        body = (
          <Box flexDirection="column">
            {Heading('Command palette', `${PALETTE.length}`)}
            {PALETTE.map(([cmd, note]) => (
              <Box gap="sm">
                <Button
                  key={`cmd-${cmd.trim()}`}
                  label={cmd.trim()}
                  onPress={() => $.prompt.fill({ text: cmd, mode: 'replace' })}
                />
                <Text dimColor>{note}</Text>
              </Box>
            ))}
          </Box>
        )
      }
    } else {
      const callList = await read($, calls)
      const fileList = await read($, edits)
      const errList = await read($, errors)
      const turnCount = await read($, turns)
      const spend = await read($, costUsd)
      const costs = await read($, costSamples)
      const ctx = await read($, ctxSamples)
      const info = await read($, git)
      const runs = await read($, tests)
      const samples = await read($, limitSamples)
      const kinds = [...new Set(samples.map(s => s.kind))]
      const percent = await read($, contextPercent)
      const latest = kinds.map(kind => {
        const mine = samples.filter(s => s.kind === kind)
        const lastSample = mine[mine.length - 1]
        const min = forecastMin(mine.map(s => ({ t: s.t, p: s.p })))
        const resets = lastSample?.resetsAt ?? null

        return {
          name: kind.replace('_', ' '),
          last: lastSample?.p ?? 0,
          min: min ?? 0,
          hasForecast: min !== null,
          beyond: min !== null && resets !== null && t + min * 60_000 > resets,
        }
      })
      const toolCounts: Record<string, number> = {}

      for (const c of callList) {
        toolCounts[c.tool] = (toolCounts[c.tool] ?? 0) + 1
      }
      const forecastText = (x: (typeof latest)[number]) =>
        x.beyond
          ? `At this pace you would hit the ${x.name} limit in ${spanOf(x.min)}, but it resets first.`
          : `At this pace you will hit the ${x.name} limit in ${spanOf(x.min)}.`
      const clock = start > 0 && t > 0 ? clockOf(t - start) : '--:--'

      if (Svg !== undefined && look !== undefined) {
        const isMoving = (await read($, motionIsOn)) && !(await read($, settingsIsCalm))
        const accent = String(await read($, settingsAccent))
        const drawnAt = await $.clock.now()

        if (entrance.tab !== active) {
          entrance = { tab: active, at: drawnAt }
        }
        const vec = {
          contextPct: percent,
          spendUsd: spend,
          costSamples: costs,
          ctxSamples: ctx,
          limits: latest.map(x => ({
            kind: x.name,
            pct: x.last,
            ...(x.hasForecast ? { forecast: { text: forecastText(x), isUrgent: !x.beyond && x.min < 30 } } : {}),
          })),
          tests: runs,
          tools: toolCounts,
          stats: { prompts: turnCount, tools: callList.length, files: fileList.length, errors: errList.length },
          git: info,
        }
        const source = vecDashSvg(vec, { accent, animate: isMoving && drawnAt - entrance.at < ENTRANCE_MS, ...look })
        const size = /viewBox="0 0 (\d+) (\d+)"/.exec(source)

        // The clock stays plain text: inside the picture it would redraw the whole thing every second.
        body = (
          <Box flexDirection="column">
            {Heading('Session', clock)}
            <Svg source={source} alt={vecAlt(vec)} width={Number(size?.[1] ?? look.width)} height={Number(size?.[2] ?? look.width)} isInteractive={isMoving} />
          </Box>
        )
      } else {
        body = (
          <Box flexDirection="column">
            {Heading('Session', clock)}
            <Box gap="sm">
              {Tile('Prompts', String(turnCount))}
              {Tile('Tools', String(callList.length))}
              {Tile('Files', String(fileList.length))}
              {Tile('Errors', String(errList.length), errList.length > 0 ? 'error' : undefined)}
              {Tile('Spend', spend === null ? 'n/a' : `$${spend.toFixed(2)}`)}
            </Box>

            {Section('Git')}
            {info === null && <Text dimColor>Not a git repository, or git is unavailable.</Text>}
            {info !== null && (
              <Text mono>
                {info.branch} <Text color="success">{`+${info.ahead}`}</Text>{' '}
                <Text color="warning">{`-${info.behind}`}</Text>{' '}
                <Text color={info.dirty > 0 ? 'warning' : 'success'}>{`${info.dirty} dirty`}</Text>
              </Text>
            )}

            {Section('Spend per turn')}
            {costs.length === 0 && <Text dimColor>Fills in after the first reply.</Text>}
            {costs.length > 0 && (
              <Text mono color="suggestion">
                {sparkOf(costs)} <Text dimColor>{`$${(costs[costs.length - 1] ?? 0).toFixed(2)}`}</Text>
              </Text>
            )}

            {Section('Context per turn')}
            {ctx.length === 0 && <Text dimColor>Fills in after the first reply.</Text>}
            {ctx.length > 0 && (
              <Box>
                {ctx.map(p => (
                  <Text mono color={heatOf(p)}>
                    █
                  </Text>
                ))}
                <Text dimColor mono>{` ${percent ?? Math.round(ctx[ctx.length - 1] ?? 0)}%`}</Text>
              </Box>
            )}

            {Section('Limits')}
            {latest.length === 0 && <Text dimColor>No rate-limit readings yet.</Text>}
            {latest.map(x => (
              <Box flexDirection="column">
                {Gauge(x.name, x.last)}
                {x.hasForecast && (
                  <Text size="caption" color={x.beyond ? undefined : x.min < 30 ? 'warning' : undefined} dimColor={x.beyond || x.min >= 30}>
                    {forecastText(x)}
                  </Text>
                )}
              </Box>
            ))}

            {Section('Test runs')}
            {runs.length === 0 && <Text dimColor>No test commands seen yet.</Text>}
            {runs.length > 0 && (
              <Box>
                {runs.map(r => (
                  <Text mono color={r.ok ? 'success' : 'error'}>
                    {r.ok ? '✓' : '✗'}
                  </Text>
                ))}
                <Text dimColor mono>{` ${runs.filter(r => r.ok).length}/${runs.length} passed`}</Text>
              </Box>
            )}
          </Box>
        )
      }
    }

    if (isPlain && active === 'overview') {
      const live = await read($, barLive)
      const info = await read($, git)
      const minutes = Math.max(0, Math.floor((t - start) / 60_000))

      body = drawPlainHome(
        ui,
        {
          live,
          view: chosenView,
          branch: info?.branch ?? '',
          uncommitted: info?.dirty ?? null,
          age: `${minutes}m`,
          prompts: topPrompts(await read($, myPrompts)),
        },
        { press: b => pressButton($, b), set: patch => setView($, patch), forget: () => forgetPrompts($) },
      )
    }

    return (
      <Box flexDirection="column" padding="sm">
        {desk !== undefined && look !== undefined && pinned.length > 0 && drawPins(desk, look, pinned, p => togglePin($, p))}
        {desk === undefined && pinned.map((p, i) => (
          <Box gap="sm">
            <Text color="suggestion">|</Text>
            <Text weight="semibold">{p}</Text>
            <Button key={`unpin-${i}`} dimColor label="unpin" onPress={() => togglePin($, p)} />
          </Box>
        ))}
        <Box gap="sm" flexWrap="wrap" marginBottom="sm">
          {TABS.filter(([id]) => !isPlain || PLAIN_TABS.has(id)).map(([id, label], i) => (
            <Button
              key={`tab-${id}`}
              hotkey={String(i + 1)}
              variant={id === active ? 'primary' : undefined}
              label={isPlain ? (id === 'overview' ? 'Home' : label) : id === active ? `* ${label}` : label}
              onPress={() => update($, tab, () => id)}
            />
          ))}
        </Box>
        {body as never}
      </Box>
    )
  })

  // ------------------------------------------------------------ band

  // The plain look reads: isBandHidden, isFocus, view, barConfig, barLive, settings.features and git.
  // The rich look adds pins (8 while idle); while working, motion.isOn and settings.isCalm make it 10. Everything else is read
  // only when an item that needs it was chosen.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden)) || (await read($, isFocus))) {
      return next(e)
    }
    const how = await read($, view)

    if (how.clean) {
      return next(e)
    }
    const chosen = await read($, barConfig)
    const digest = await read($, barLive)
    const features = await read($, settingsFeatures)

    if (how.look === 'plain') {
      const seen = featureOn(features, 'bar-waiting') ? digest : { ...digest, waiting: null }
      const figures = figuresOf(seen)
      const notice = noticeOf(seen, { isWorking: e.props.isWorking, hasGit: (await read($, git)) !== null }) ?? quietNotice(figures)
      const buttons = featureOn(features, 'bar-buttons') ? notice.buttons : []

      return drawPlainBand($.ui.resolve(e), { ...notice, buttons }, figures, b => pressButton($, b), await next(e))
    }

    if (has(chosen, 'hidetyping') && featureOn(features, 'bar-hide-typing') && (await read($, isTypingHidden))) {
      return next(e)
    }
    const config = featureOn(features, 'bar-waiting') ? chosen : removeItem(chosen, 'waiting')
    const live = featureOn(features, 'bar-waiting') ? digest : { ...digest, waiting: null }
    const isWorking = e.props.isWorking
    const info = await read($, git)
    const pinned = await read($, pins)
    const openTodos = has(config, 'todos') ? (await read($, todos)).filter(x => !x.done).length : 0
    // The expanded strip may show the session length even when no timed item was chosen.
    const isTimed =
      config.size === 'expanded' || has(config, 'grow') || ['timer', 'eta', 'reset', 'pace', 'deadline', 'length', 'daynight'].some(id => has(config, id))
    // Reading `now` subscribes to the ticker, so it is read only while the ticker can be running.
    const t = isWorking && wantsTicker(config) ? await read($, now) : isTimed ? await $.clock.now() : 0
    const ctx: ChipContext = { config, live, git: info, openTodos, now: t, isWorking }
    const isChat = has(config, 'auto') && !isCodingSession(live)
    const gitText =
      info !== null && has(config, 'git') && !config.quiet && !(isChat && CODING_ITEMS.has('git'))
        ? `${info.branch} +${info.ahead} -${info.behind} ${info.dirty} dirty`
        : ''
    const clip = (x: string) => oneLine(x, Math.max(10, Math.min(60, e.props.bodyColumns - 2)))
    const written = [
      has(config, 'goal') && config.goal !== '' ? `Goal: ${config.goal}` : '',
      has(config, 'note') && config.note !== '' ? `Note: ${config.note}` : '',
    ]
      .filter(x => x !== '' && !config.quiet)
      .map(clip)
    const lines = [...written, ...(pinned[0] !== undefined && !config.quiet ? [clip(pinned[0])] : [])]
    const buttons = featureOn(features, 'bar-buttons') ? pickButtons(ctx) : []
    const alert = alertOf(config, live)
    const waiting = has(config, 'waiting') ? live.waiting : null
    const act = {
      open: () => openCockpit($),
      hide: () => update($, isBandHidden, () => true),
      press: (b: BarButton) => pressButton($, b),
    }
    const isSlim = config.quiet || config.size === 'slim'
    // The slim line has no action buttons: only the ones that change the bar itself.
    const offered = isSlim ? buttons.filter(b => b.kind !== 'fill' && b.kind !== 'tab') : buttons
    const buttonsPx = offered.reduce((sum, b) => sum + buttonWidth(b.label), 0)
    const planInput = {
      maxRows: e.props.maxRows,
      columns: e.props.bodyColumns,
      isSlim,
      hasAlert: alert !== null,
      chipRows: 0,
      buttonsPx,
      gitPx: gitText.length * 7,
      lines: lines.length,
    }
    const first = planBand(planInput)
    const isWide = !config.quiet && (config.size === 'expanded' || (has(config, 'grow') && alert !== null))
    let shown = isWide && !isSlim ? chipsFor(ctx) : []

    if (has(config, 'changed')) {
      shown = onlyChanged(shown, live.before)
    }
    const plan =
      e.surface === 'desktop' && first.kind !== 'text'
        ? planBand({ ...planInput, chipRows: layoutChips(shown, first.stripWidth, 2).rows })
        : ({ kind: 'text' } as const)
    const running = live.running[live.running.length - 1]
    const word: { word?: string; sub?: string; tone?: HudTone } | undefined =
      waiting !== null
        ? { word: 'your turn', sub: waiting === 'question' ? 'answer me' : 'approve?', tone: 'amber' }
        : has(config, 'mode') && isWorking
          ? { word: running?.mode ?? 'thinking', tone: running?.mode ?? 'thinking' }
          : has(config, 'savepulse') && isWorking && live.savedFile !== ''
            ? { sub: `saved ${live.savedFile}` }
            : undefined

    // Desktop gets the big status strip. It needs a few rows of height; otherwise the text row is used.
    if (plan.kind !== 'text') {
      const ui = $.ui.resolve(e) as unknown as ElementTable<'desktop'>
      const hasRolled = live.contextPct !== live.prevContextPct || live.costUsd !== live.prevCostUsd
      const isFinished = !isWorking && live.outcome !== null
      const glow = has(config, 'glow') && !isWorking && live.outcome === 'ok'
      // Only while the failure is the newest thing, so later redraws do not play it again.
      const flash = has(config, 'failflash') && live.failure !== null && running === undefined && live.trail[live.trail.length - 1]?.isOk === false
      const party = has(config, 'celebrate') && live.isCelebrating
      const isRolling = has(config, 'roll') && isFinished && hasRolled
      const isSaved = has(config, 'savepulse') && live.savedFile !== ''
      // Motion switches are read only when there is something that could move.
      const animate =
        !config.quiet &&
        featureOn(features, 'bar-motion') &&
        (isWorking || glow || flash || party || isRolling || isSaved) &&
        (await read($, motionIsOn)) &&
        !(await read($, settingsIsCalm))
      const look = {
        theme: config.theme,
        ...(has(config, 'daynight') ? { hour: new Date(t).getHours() } : {}),
      }
      const width = plan.stripWidth
      let strip: BandParts['strip']

      if (plan.kind === 'slim') {
        const slim = {
          contextPct: live.contextPct,
          limitPct: live.limit?.pct ?? null,
          limitName: limitLabel(live.limit?.kind ?? ''),
          spendUsd: live.costUsd === null ? '' : money(live.costUsd),
          word: word?.word ?? (isWorking ? 'working' : 'ready'),
          tone: word?.tone ?? (isWorking ? ('live' as const) : ('idle' as const)),
        }
        strip = {
          source: slimSvg(slim, { width, ...look }),
          alt: `Status: ${[slim.word, slim.contextPct === null ? '' : `context ${Math.round(slim.contextPct)} percent`, slim.spendUsd].filter(Boolean).join(', ')}.`,
          width,
          height: SLIM_H,
        }
      } else {
        const data: HudData = {
          contextPct: live.contextPct,
          limitPct: live.limit?.pct ?? null,
          limitName: live.limit?.kind ?? '',
          spendUsd: live.costUsd,
          isWorking,
          tool: running?.tool ?? '',
          toolCalls: live.calls,
          trend: live.trend,
          animate,
          width,
          ...look,
          ...(has(config, 'edge') ? { edge: edgeOf(live, isWorking) } : {}),
          ...(word === undefined ? {} : { state: word }),
          glow,
          flash,
          celebrate: party,
          wave: has(config, 'wave'),
          ...(isSaved ? { pulse: live.saves } : {}),
          ...(isRolling ? { roll: { contextPct: live.prevContextPct, spendUsd: live.prevCostUsd } } : {}),
        }
        strip = { source: hudSvg(data), alt: hudAlt(data), width, height: HUD_H }
      }
      const grid = plan.chipRows > 0 ? chipsSvg(shown, { width, ...look }, plan.chipRows) : null
      const room = e.props.bodyColumns * 7 - (plan.hasSide ? 0 : buttonWidth('Cockpit') + buttonWidth('Hide'))
      const rowButtons = fitButtons(offered, room)
      const parts: BandParts = {
        strip,
        alert:
          plan.hasAlert && alert !== null
            ? { source: cardSvg(alert, { width, ...look }), alt: `${alert.title}. ${alert.detail}`, width, height: CARD_H }
            : null,
        chips:
          grid === null || grid.source === ''
            ? null
            : { source: grid.source, alt: chipsAlt(grid.shown), width, height: grid.height },
        buttons: rowButtons,
        hasSide: plan.hasSide,
        hasRow: plan.hasRow || (plan.kind === 'slim' && !plan.hasSide),
        isSlim: plan.kind === 'slim',
        gitInline: plan.isGitInline ? gitText : '',
        gitLine: plan.hasGitLine ? gitText : '',
        lines: lines.slice(0, plan.lines),
      }

      return drawBand(ui, parts, act, await next(e))
    }

    // The text version: a short desktop band, the terminal and every other surface.
    const costs = await read($, costSamples)

    if (info === null && costs.length === 0 && pinned.length === 0 && waiting === null && lines.length === 0) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const room = Math.max(0, e.props.maxRows - 1)
    const figures = isWide && room > 0 ? shown.filter(c => c.value !== '') : []
    let figureText = ''

    for (const c of figures) {
      const more = `${figureText === '' ? '' : `${figureText}  |  `}${c.label} ${c.value}`

      if (more.length <= e.props.bodyColumns) {
        figureText = more
      }
    }
    const extra = [
      waiting !== null ? `Your turn: ${waiting === 'question' ? 'a question is waiting' : 'an approval is waiting'}` : '',
      alert !== null && waiting === null ? `${alert.title}: ${alert.detail}` : '',
      figureText,
      ...written,
    ]
      .filter(x => x !== '')
      .slice(0, room)
    const actions = room > extra.length ? buttons.filter(b => b.kind === 'fill' || b.kind === 'quietoff') : []
    let used = 0
    const fits = actions.filter(b => (used += b.label.length + 6) <= e.props.bodyColumns)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box gap="sm">
          {info !== null && has(config, 'git') && (
            <Text mono>
              {info.branch}{' '}
              <Text color="success">{`+${info.ahead}`}</Text> <Text color="warning">{`-${info.behind}`}</Text>{' '}
              <Text color={info.dirty > 0 ? 'warning' : 'success'}>{`${info.dirty} dirty`}</Text>
            </Text>
          )}
          {costs.length > 1 && !config.quiet && (
            <Text mono color="suggestion">
              {sparkOf(costs.slice(-12))}
            </Text>
          )}
          {pinned[0] !== undefined && <Text dimColor>{oneLine(pinned[0], 50)}</Text>}
          <Button key="cockpit-open" label="Cockpit" onPress={() => openCockpit($)} />
          <Button key="cockpit-hide" dimColor label="Hide" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
        {extra.map(x => (
          <Text color={x.startsWith('Your turn') ? 'warning' : undefined}>{oneLine(x, e.props.bodyColumns)}</Text>
        ))}
        {fits.length > 0 && (
          <Box gap="sm">
            {fits.map(b => (
              <Button key={`bar-${b.id}`} label={b.label} onPress={() => pressButton($, b)} />
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
