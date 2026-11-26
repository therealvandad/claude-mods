import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { DelightTab } from '../types'
import { CATALOG, BUILT_ON, LOOK_CHOICES } from './catalog'
import { CHANGELOG } from './changelog'
import { COUNTER_LABEL, COOKIES, EGGS, MOODS, TOUR, VERSION, WARDROBE } from './data'
import {
  POSTCARDS,
  addSample,
  auditIsDue,
  auditIsOpen,
  bar,
  boxLines,
  bumpHeat,
  cleanAudits,
  cleanCards,
  cleanCounters,
  cleanEggs,
  cleanFlags,
  cleanGame,
  cleanHeat,
  cleanKind,
  cleanNotes,
  clampStep,
  complimentText,
  cookieAt,
  crossed,
  dayIndex,
  dayKey,
  eggFor,
  emptyCounters,
  emptyTrack,
  gameText,
  heatByMod,
  hlGuess,
  hlNew,
  huntText,
  cardName,
  isNewerVersion,
  isObj,
  isoWeek,
  isUnlocked,
  lookOfWeek,
  memFace,
  memFlip,
  memNew,
  MAX_NOTES,
  notesText,
  num,
  onOff,
  parseFeedback,
  parseMood,
  pickCompliment,
  petPreview,
  plural,
  postcardText,
  progressOf,
  recommendText,
  recordTool,
  soundOfDay,
  soundtrackText,
  stepTrack,
  str,
  topToolOf,
  tourMove,
  typingStats,
  unusedMods,
  wardrobeText,
  weekKey,
} from './logic'
import type { AuditNote, CardSnap, Counters, Flags, Game, Heat, Hit, KindState, Note, RunTrack, Sample } from './logic'

type Dollar = Parameters<Hook<'session.start'>>[0]
type UI = ReturnType<Dollar['ui']['resolve']>

const PANE = 'delight-main'

// What the pane draws from. Scalars only: a hot reload keeps them.
const rev = atom({ plugin: 'delight', key: 'rev' } as const, 0)
const tabAtom = atom({ plugin: 'delight', key: 'tab' } as const, 'gallery' as DelightTab)

const TABS: readonly (readonly [DelightTab, string])[] = [
  ['gallery', 'Gallery'],
  ['today', 'Today'],
  ['tour', 'Tour'],
  ['pet', 'Wardrobe'],
  ['games', 'Games'],
  ['cards', 'Milestones'],
  ['retro', 'Retro'],
  ['type', 'Typing'],
  ['heat', 'Heat'],
  ['notes', 'Notes'],
  ['log', 'Changelog'],
]

type Meta = {
  seenVersion: string
  cookieDay: number
  cookieStep: number
  lastToastAt: number
  trackSince: number
  typingBest: number
  auditShown: string
}

type Cache = {
  flags: Flags
  counters: Counters
  heat: Heat
  cards: Record<string, CardSnap>
  wear: string | null
  eggs: Record<string, number>
  game: Game | null
  notes: Note[]
  audits: AuditNote[]
  kind: KindState
  meta: Meta
  tourStep: number
  showNew: boolean
}

type Key = 'flags' | 'counters' | 'heat' | 'cards' | 'wear' | 'eggs' | 'game' | 'notes' | 'audits' | 'kind' | 'meta'
const KEYS: readonly Key[] = ['flags', 'counters', 'heat', 'cards', 'wear', 'eggs', 'game', 'notes', 'audits', 'kind', 'meta']

const TOAST_GAP_MS = 3 * 60_000
const FLUSH_MS = 5000
const BUMP_MS = 1000

// Module state: lost at a hot reload, rebuilt lazily from $.store by `load`.
let cache: Cache | undefined
let loading: Promise<Cache> | undefined
let track: RunTrack = emptyTrack()
let pending: Hit[] = []
let samples: Sample[] = []
let lastFlush = -Infinity
let lastBump = -Infinity
let gameN = 0
const dirty = new Set<Key>()

// ------------------------------------------------------------------ storage

const cleanMeta = (raw: unknown): Meta => {
  const m = isObj(raw) ? raw : {}

  return {
    seenVersion: str(m.seenVersion).slice(0, 20),
    cookieDay: num(m.cookieDay, -1),
    cookieStep: Math.max(0, Math.floor(num(m.cookieStep))),
    lastToastAt: num(m.lastToastAt),
    trackSince: num(m.trackSince),
    typingBest: Math.max(0, Math.floor(num(m.typingBest))),
    auditShown: str(m.auditShown).slice(0, 10),
  }
}

const build = (raw: Record<Key, unknown>): Cache => ({
  flags: cleanFlags(raw.flags),
  counters: cleanCounters(raw.counters),
  heat: cleanHeat(raw.heat),
  cards: cleanCards(raw.cards),
  wear: typeof raw.wear === 'string' && WARDROBE.some(w => w.id === raw.wear) ? raw.wear : null,
  eggs: cleanEggs(raw.eggs),
  game: cleanGame(raw.game),
  notes: cleanNotes(raw.notes),
  audits: cleanAudits(raw.audits),
  kind: cleanKind(raw.kind),
  meta: cleanMeta(raw.meta),
  tourStep: 0,
  showNew: false,
})

const load = (d: Dollar): Promise<Cache> => {
  if (cache !== undefined) {
    return Promise.resolve(cache)
  }
  loading ??= (async () => {
    const values = await Promise.all(KEYS.map(k => d.store.get(k)))
    const raw = Object.fromEntries(KEYS.map((k, i) => [k, values[i]])) as Record<Key, unknown>
    cache = build(raw)

    return cache
  })().finally(() => {
    loading = undefined
  })

  return loading
}

const save = async (d: Dollar, c: Cache, key: Key) => {
  await d.store.set(key, c[key] as never)
}

const flush = async (d: Dollar, now: number, force = false) => {
  if (dirty.size === 0 || (!force && now - lastFlush < FLUSH_MS)) {
    return
  }
  const c = await load(d)
  const keys = [...dirty]
  dirty.clear()
  lastFlush = now

  for (const k of keys) {
    await save(d, c, k)
  }
}

const bump = (d: Dollar) => update(d, rev, n => n + 1)

const bumpSoon = async (d: Dollar, now: number) => {
  if (now - lastBump >= BUMP_MS) {
    lastBump = now
    await bump(d)
  }
}

const tryToast = async (d: Dollar, c: Cache, now: number, text: string): Promise<boolean> => {
  if (now - c.meta.lastToastAt < TOAST_GAP_MS) {
    return false
  }
  c.meta.lastToastAt = now
  dirty.add('meta')
  await flush(d, now, true)
  d.ui.toast(text, { timeoutMs: 8000 })

  return true
}

const openPane = async (d: Dollar, tab: DelightTab) => {
  await update(d, tabAtom, () => tab)
  const opened = await d.ui.open({ id: PANE, title: 'Delight' })
  await bump(d)

  return opened.isPlaced ? '' : ` (it is waiting for room: ${opened.reason})`
}

// ------------------------------------------------------------- tool tracking

const noteTool = async (d: Dollar, tool: string, input: Record<string, unknown>, ok: boolean) => {
  const c = await load(d)

  if (!c.flags.track) {
    return
  }
  const now = await d.clock.now()
  const today = dayKey(now)
  const fact = { tool, ok, command: String(input.command ?? '').slice(0, 300), path: String(input.file_path ?? input.notebook_path ?? '') }
  const before = c.counters.tools
  c.counters = recordTool(c.counters, fact, today)
  dirty.add('counters')
  const reached = crossed(before, c.counters.tools)

  for (const t of reached) {
    c.cards[String(t)] = { tools: c.counters.tools, days: c.counters.days, top: topToolOf(c.counters), date: today }
    dirty.add('cards')
  }

  if (c.flags.kind) {
    const step = stepTrack(track, fact, today)
    track = step.track
    pending = [...pending, ...step.hits].slice(-5)
  }
  await flush(d, now, reached.length > 0)

  if (reached.length > 0) {
    const last = reached[reached.length - 1]!
    await tryToast(d, c, now, `Postcard unlocked: ${last.toLocaleString('en-US')} tool calls. /dlcard shows it.`)
  }
  await maybeCompliment(d, c, now, today)
  await bumpSoon(d, now)
}

const maybeCompliment = async (d: Dollar, c: Cache, now: number, today: string) => {
  if (!c.flags.kind || pending.length === 0) {
    return
  }

  if (c.kind.lastDay === today) {
    pending = []

    return
  }
  const hit = pickCompliment(pending, c.kind, today)

  if (hit === undefined) {
    pending = []

    return
  }

  // Gated by the shared toast gap: it waits (kept in `pending`) and is tried again at the next call.
  if (await tryToast(d, c, now, `${complimentText(hit)} (Click to dismiss. /dlkind off stops these.)`)) {
    c.kind = { lastDay: today, last: { ...c.kind.last, [hit.id]: today } }
    await save(d, c, 'kind')
    pending = []
  }
}

const noteCommand = async (d: Dollar, command: string) => {
  const c = await load(d)

  if (!c.flags.track) {
    return
  }
  const now = await d.clock.now()
  c.heat = bumpHeat(c.heat, command, dayIndex(now))
  dirty.add('heat')
  // Commands are rare, so they are written through at once.
  await flush(d, now, true)
}

const noteEdit = async (d: Dollar, text: string) => {
  const c = await load(d)

  if (!c.flags.type) {
    return
  }
  const now = await d.clock.now()
  samples = addSample(samples, { at: now, len: text.length })
  const stats = typingStats(samples)

  if (stats.activeMs >= 5000 && stats.cpm > c.meta.typingBest) {
    c.meta.typingBest = stats.cpm
    dirty.add('meta')
    await flush(d, now)
  }
  await bumpSoon(d, now)
}

// ----------------------------------------------------------------- commands

const COMMANDS = [
  ['dl', 'List every delight command, one line each'],
  ['dlgallery', 'Open the mod gallery pane: every mod, its commands, a button that fills its help command'],
  ['dlpane', 'Open the delight pane at a tab: gallery today tour pet games cards retro type heat notes log'],
  ['dltour', 'Seven-step tour of the main features (pane with Back and Next)'],
  ['dlweek', 'Look of the week: suggests one of the looks and fills /look <name> into the prompt'],
  ['dlsound', 'Sound of the day: names the sound pack to run with /sound <pack>'],
  ['dlmusic', 'Ambient soundtrack ideas as text: /dlmusic [focus|calm|late|upbeat]'],
  ['dlcookie', 'One fortune-cookie line about code and rest (60 of them)'],
  ['dlwear', 'Preview pet accessories you have unlocked: /dlwear [id|none|list]'],
  ['dlgame', 'Tiny turn-based games in the pane: /dlgame higher | memory | stop'],
  ['dlcard', 'Milestone postcards at 100, 1000 and 10000 tool calls (needs /dltrack on)'],
  ['dlretro', 'Retro terminal pane in box characters, green by theme key'],
  ['dlhunt', 'Easter-egg hunt: five hidden words, how many you have found'],
  ['dltrack', 'Own counters on|off|status: tool calls and command names (off by default)'],
  ['dlkind', 'Rare, specific compliments on|off|status (off by default, needs counters)'],
  ['dltype', 'Typing-speed meter on|off (off by default, lengths only, never the text)'],
  ['dlaudit', 'Weekly helped/annoyed check-in card on|off (off by default)'],
  ['dlheat', 'Which mods you use: command runs per mod, as bars (needs /dltrack on)'],
  ['dlrecommend', 'Mods whose commands did not run in the last 14 days'],
  ['dlfeedback', 'Save a note about a mod: /dlfeedback <mod> <text>'],
  ['dlfeedbacks', 'List your notes: /dlfeedbacks [mod] | del <n>'],
  ['dlnew', 'The what-is-new card for this version (shows once)'],
  ['dlchangelog', 'Plain-language changelog for every mod: /dlchangelog [mod]'],
  ['dlreset', 'Clear everything delight recorded and switch every option back off'],
  ...EGGS.map(e => [`dl${e.word}`, 'A hidden word.'] as const),
] as const

const HELP_ROWS = COMMANDS.filter(([name]) => !EGGS.some(e => `dl${e.word}` === name))

const helpText = () =>
  [
    'delight: small extras. Everything is off except the gallery and this help.',
    ...HELP_ROWS.map(([name, desc]) => `  /${name.padEnd(12)} ${desc}`),
    `Five hidden words also exist: /dlhunt tells you how many you have found.`,
    'Switches that start off: /dltrack, /dlkind, /dltype, /dlaudit. /dlreset clears it all.',
  ].join('\n')

const TAB_IDS = TABS.map(([id]) => id)
const asTab = (arg: string): DelightTab | undefined => {
  const w = arg.trim().toLowerCase()
  const alias: Record<string, DelightTab> = { wardrobe: 'pet', milestones: 'cards', typing: 'type', changelog: 'log', new: 'log', audit: 'notes' }

  return TAB_IDS.find(t => t === w) ?? alias[w]
}

const MODS = CATALOG.map(m => ({ name: m.name, commands: m.commands.map(x => x.name) }))

const helpOf = (mod: string) => CATALOG.find(m => m.name === mod)?.help ?? undefined

const lookNames = () => LOOK_CHOICES.map(l => l.id)

const cmdWeek = async (d: Dollar) => {
  const now = await d.clock.now()
  const w = isoWeek(now)
  const id = lookOfWeek(w, lookNames())
  const look = LOOK_CHOICES.find(l => l.id === id)

  if (id === undefined || look === undefined) {
    return 'No looks were found when this mod was built, so there is nothing to suggest.'
  }
  await d.prompt.fill({ text: `/look ${id}`, mode: 'replace' })

  return `Look of week ${w.week}: ${look.label} (${look.blurb}). I put /look ${id} in the prompt box: press Enter to try it, or clear the box to skip. This mod cannot apply a look itself.`
}

const cmdSound = async (d: Dollar) => {
  const pack = soundOfDay(dayIndex(await d.clock.now()))

  return `Sound of the day: ${pack}. Run /sound ${pack} to use it (this mod cannot change the pack itself; /sound silent mutes).`
}

const cmdMusic = async (d: Dollar, args: string) => {
  const mood = parseMood(args)

  if (mood === undefined) {
    return `Moods: ${MOODS.join(', ')}. /dlmusic [mood]`
  }

  return soundtrackText(mood, dayIndex(await d.clock.now()))
}

const cmdCookie = async (d: Dollar) => {
  const c = await load(d)
  const day = dayIndex(await d.clock.now())
  c.meta.cookieStep = c.meta.cookieDay === day ? c.meta.cookieStep + 1 : 0
  c.meta.cookieDay = day
  await save(d, c, 'meta')
  await bump(d)

  return `Fortune cookie: ${cookieAt(day, c.meta.cookieStep)}`
}

const cmdWear = async (d: Dollar, args: string) => {
  const c = await load(d)
  const arg = args.trim().toLowerCase()

  if (arg === '' || arg === 'list') {
    return wardrobeText(c.counters, c.wear) + (c.flags.track ? '' : '\nCounting is off, so nothing unlocks yet: /dltrack on.')
  }

  if (arg === 'none' || arg === 'off') {
    c.wear = null
  } else {
    const item = WARDROBE.find(w => w.id === arg)

    if (item === undefined) {
      return `No accessory called "${arg}". /dlwear list shows them.`
    }

    if (!isUnlocked(item, c.counters)) {
      return `${item.name} is locked: ${progressOf(item, c.counters)} of ${item.need} ${COUNTER_LABEL[item.counter]}.${c.flags.track ? '' : ' Counting is off: /dltrack on.'}`
    }
    c.wear = item.id
  }
  await save(d, c, 'wear')
  await bump(d)

  return `${petPreview(c.wear).join('\n')}\nPreview only: the pet itself belongs to the personality mod.`
}

const seedOf = async (d: Dollar) => ((await d.clock.now()) % 2_147_483_647) + ++gameN * 7919

const startGame = async (d: Dollar, c: Cache, kind: 'hl' | 'mem') => {
  const seed = await seedOf(d)
  const best = c.game !== null && c.game.kind === kind ? c.game.best : 0
  c.game = kind === 'hl' ? hlNew(seed, best) : memNew(seed, best)
  await save(d, c, 'game')
  await bump(d)
}

const cmdGame = async (d: Dollar, args: string) => {
  const c = await load(d)
  const arg = args.trim().toLowerCase()

  if (arg === 'stop') {
    c.game = null
    await save(d, c, 'game')
    await bump(d)

    return 'Game stopped.'
  }

  if (arg === 'higher' || arg === 'hl' || arg === 'lower') {
    await startGame(d, c, 'hl')
  } else if (arg === 'memory' || arg === 'mem') {
    await startGame(d, c, 'mem')
  } else if (arg !== '' && arg !== 'status') {
    return 'Usage: /dlgame higher | memory | stop'
  }
  const note = await openPane(d, 'games')

  return `${gameText(c.game)}${note}`
}

const pressHL = async (d: Dollar, guess: 'higher' | 'lower') => {
  const c = await load(d)

  if (c.game?.kind === 'hl') {
    c.game = hlGuess(c.game, guess)
    await save(d, c, 'game')
    await bump(d)
  }
}

const pressMem = async (d: Dollar, i: number) => {
  const c = await load(d)

  if (c.game?.kind === 'mem') {
    c.game = memFlip(c.game, i)
    await save(d, c, 'game')
    await bump(d)
  }
}

const cmdCard = async (d: Dollar, args: string) => {
  const c = await load(d)
  const reached = POSTCARDS.filter(t => c.cards[String(t)] !== undefined)
  const want = Number.parseInt(args, 10)
  const pick = reached.includes(want as never) ? want : reached[reached.length - 1]
  const note = await openPane(d, 'cards')

  if (pick === undefined) {
    const next = POSTCARDS.find(t => t > c.counters.tools) ?? POSTCARDS[POSTCARDS.length - 1]!

    return c.flags.track
      ? `No postcard yet: ${c.counters.tools} of ${next} tool calls.${note}`
      : `Counting is off, so no postcards. /dltrack on starts counting tool calls (the next card is at ${POSTCARDS[0]}).${note}`
  }

  return `${postcardText(pick, c.cards[String(pick)]!).join('\n')}${note}`
}

const cmdHunt = async (d: Dollar) => huntText((await load(d)).eggs)

const cmdEgg = async (d: Dollar, word: string) => {
  const egg = eggFor(word)

  if (egg === undefined) {
    return ''
  }
  const c = await load(d)
  const isFirst = c.eggs[word] === undefined
  c.eggs[word] = await d.clock.now()
  await save(d, c, 'eggs')
  await bump(d)
  const n = Object.keys(c.eggs).length

  return `${egg.art}\n${isFirst ? `Egg ${n} of ${EGGS.length} found.` : `Found again (${n} of ${EGGS.length}).`}`
}

const setFlag = async (d: Dollar, name: keyof Flags, value: boolean) => {
  const c = await load(d)
  const wasTracking = c.flags.track
  c.flags = { ...c.flags, [name]: value } as Flags

  if (name === 'track' && !value) {
    c.flags.kind = false
    pending = []
  }

  // Starting to count (directly, or because compliments need it) starts the 14-day clock.
  if (c.flags.track && !wasTracking) {
    c.meta.trackSince = dayIndex(await d.clock.now())
    dirty.add('meta')
  }

  if (name === 'kind' && value && !c.flags.track) {
    c.flags.track = true
    c.meta.trackSince = dayIndex(await d.clock.now())
    dirty.add('meta')
  }

  if (name === 'type' && !value) {
    samples = []
  }

  if (name === 'audit' && value) {
    c.meta.auditShown = ''
    dirty.add('meta')
  }
  await save(d, c, 'flags')
  await flush(d, await d.clock.now(), true)
  await bump(d)
}

const switchText = (name: string, isOn: boolean) => `${name} is ${isOn ? 'on' : 'off'}.`

const cmdTrack = async (d: Dollar, args: string) => {
  const c = await load(d)
  const v = onOff(args)

  if (v === undefined) {
    return `${switchText('Counting', c.flags.track)} ${plural(c.counters.tools, 'tool call')} and ${plural(Object.keys(c.heat).length, 'command name')} recorded. /dltrack on|off. Only counts and command names are kept, never arguments or file contents.`
  }
  await setFlag(d, 'track', v)

  return v
    ? 'Counting is on: tool calls, edits, commits and test runs as numbers, and the names of commands you run (never their arguments). Postcards, the wardrobe and /dlheat use these.'
    : 'Counting is off. Compliments are off too, since they need the counters. Recorded numbers stay until /dlreset.'
}

const cmdKind = async (d: Dollar, args: string) => {
  const c = await load(d)
  const v = onOff(args)

  if (v === undefined) {
    return `${switchText('Compliments', c.flags.kind)} At most one a day, only after a real milestone (tests going green after red, 25 clean calls in a row, ten files edited, the first commit of the day). Last: ${c.kind.lastDay === '' ? 'never' : c.kind.lastDay}. /dlkind on|off`
  }
  const wasTrack = c.flags.track
  await setFlag(d, 'kind', v)

  return v
    ? `Compliments are on.${wasTrack ? '' : ' They need the counters, so /dltrack is on now too.'}`
    : 'Compliments are off.'
}

const cmdType = async (d: Dollar, args: string) => {
  const c = await load(d)
  const v = onOff(args)

  if (v === undefined) {
    const s = typingStats(samples)

    return `${switchText('The typing meter', c.flags.type)} ${c.flags.type ? `Now ${s.cpm} characters a minute, best ${c.meta.typingBest}. ` : ''}/dltype on|off`
  }
  await setFlag(d, 'type', v)

  return v
    ? 'Typing meter on. It reads only how long your draft is and when, never what it says. Open it with /dlpane type.'
    : 'Typing meter off.'
}

const cmdAudit = async (d: Dollar, args: string) => {
  const c = await load(d)
  const v = onOff(args)

  if (v === undefined) {
    const week = weekKey(await d.clock.now())

    return `${switchText('The weekly check-in', c.flags.audit)} ${c.flags.audit ? (auditIsOpen(true, week, c.audits) ? 'This week’s card waits in /dlpane notes.' : 'This week’s card is answered.') : ''} /dlaudit on|off`
  }
  await setFlag(d, 'audit', v)

  if (v) {
    const week = weekKey(await d.clock.now())

    if (auditIsOpen(true, week, c.audits)) {
      c.meta.auditShown = week
      await save(d, c, 'meta')
    }
  }

  return v ? 'Weekly check-in on: one card a week in /dlpane notes with "helped" and "annoyed" buttons.' : 'Weekly check-in off.'
}

const heatBlock = (c: Cache, today: number) => {
  const rows = heatByMod(c.heat, MODS)
  const total = rows.reduce((n, r) => n + r.n, 0)
  const un = unusedMods(c.heat, MODS, today, c.meta.trackSince)

  return { rows, total, un }
}

const cmdHeat = async (d: Dollar) => {
  const c = await load(d)
  const { rows, total } = heatBlock(c, dayIndex(await d.clock.now()))
  const note = await openPane(d, 'heat')

  if (!c.flags.track && total === 0) {
    return `Nothing recorded: counting is off. /dltrack on starts it.${note}`
  }
  const max = Math.max(1, ...rows.map(r => r.n))

  return [
    `Command runs by mod${c.flags.track ? '' : ' (counting is off now)'}:`,
    ...rows.slice(0, 15).map(r => `  ${r.label.padEnd(16)} ${bar(r.n / max, 12)} ${r.n}`),
    note,
  ]
    .filter(Boolean)
    .join('\n')
}

const cmdRecommend = async (d: Dollar) => {
  const c = await load(d)
  const un = unusedMods(c.heat, MODS, dayIndex(await d.clock.now()), c.meta.trackSince)

  return recommendText(un, helpOf)
}

const cmdFeedback = async (d: Dollar, args: string) => {
  const c = await load(d)
  const p = parseFeedback(args)

  if ('error' in p) {
    return p.error
  }
  c.notes = [...c.notes, { mod: p.mod, text: p.text, at: await d.clock.now() }].slice(-MAX_NOTES)
  await save(d, c, 'notes')
  await bump(d)
  const known = p.mod === 'delight' || CATALOG.some(m => m.name === p.mod)

  return `Saved note ${c.notes.length} about ${p.mod}.${known ? '' : ' (No mod by that name was found at build time, saved anyway.)'} /dlfeedbacks lists them.`
}

const cmdFeedbacks = async (d: Dollar, args: string) => {
  const c = await load(d)
  const del = /^del(?:ete)?\s+(\d+)\s*$/i.exec(args.trim())

  if (del !== null) {
    const i = Number(del[1]) - 1

    if (i < 0 || i >= c.notes.length) {
      return `No note ${del[1]}. /dlfeedbacks lists them.`
    }
    c.notes = c.notes.filter((_, j) => j !== i)
    await save(d, c, 'notes')
    await bump(d)

    return `Deleted note ${del[1]}.`
  }

  return notesText(c.notes, args.trim().toLowerCase() || undefined)
}

const entryText = (mod: string) => {
  const e = CHANGELOG.find(x => x.mod === mod)

  return e === undefined ? undefined : [`${e.mod} ${e.version}: ${e.summary}`, ...e.lines.map(l => `  - ${l}`), `  Start with: ${e.start}`].join('\n')
}

const cmdNew = async (d: Dollar) => {
  const c = await load(d)
  const isNew = isNewerVersion(c.meta.seenVersion, VERSION)
  c.showNew = isNew

  if (!isNew) {
    return `You have already seen what is new in delight ${VERSION}. /dlchangelog delight shows it again.`
  }
  c.meta.seenVersion = VERSION
  await save(d, c, 'meta')
  const note = await openPane(d, 'log')

  return `What is new in delight ${VERSION}:\n${entryText('delight')}${note}`
}

const cmdChangelog = async (d: Dollar, args: string) => {
  const mod = args.trim().toLowerCase().replace(/^\//, '')

  if (mod === '') {
    const note = await openPane(d, 'log')

    return `${plural(CHANGELOG.length, 'mod')} in the changelog: ${CHANGELOG.map(e => e.mod).join(', ')}. /dlchangelog <mod> prints one.${note}`
  }

  return entryText(mod) ?? `No changelog entry for "${mod}". /dlchangelog lists them.`
}

const cmdTour = async (d: Dollar, args: string) => {
  const c = await load(d)
  const n = Number.parseInt(args, 10)
  c.tourStep = Number.isFinite(n) ? clampStep(n - 1) : 0
  const note = await openPane(d, 'tour')
  const s = TOUR[c.tourStep]!

  return `Tour ${c.tourStep + 1} of ${TOUR.length}: ${s.title}. ${s.body} Try ${s.cmd}.${note}`
}

const cmdReset = async (d: Dollar) => {
  for (const k of KEYS) {
    await d.store.delete(k)
  }
  cache = build(Object.fromEntries(KEYS.map(k => [k, undefined])) as Record<Key, unknown>)
  track = emptyTrack()
  pending = []
  samples = []
  dirty.clear()
  await bump(d)

  return 'Delight data cleared: counters, command counts, postcards, eggs, game, notes, check-ins and every switch (all off again).'
}

const cmdGallery = async (d: Dollar) => {
  const note = await openPane(d, 'gallery')

  return `Gallery opened: ${plural(CATALOG.length, 'mod')} found in the marketplace folder on ${BUILT_ON}.${note}`
}

const cmdPane = async (d: Dollar, args: string) => {
  const tab = asTab(args)

  if (tab === undefined) {
    return `Tabs: ${TAB_IDS.join(', ')}. /dlpane <tab>`
  }

  return `Delight pane: ${tab}.${await openPane(d, tab)}`
}

const cmdRetro = async (d: Dollar) => `Retro pane.${await openPane(d, 'retro')} Green comes from your theme's success colour; it cannot recolour the app (try /look terminal).`

// --------------------------------------------------------------- pane bodies

const Heading = (ui: UI, label: string) => (
  <ui.Box marginTop="md">
    <ui.Text size="caption" weight="semibold" dimColor>
      {label.toUpperCase()}
    </ui.Text>
  </ui.Box>
)

const fill = (d: Dollar, text: string) => d.prompt.fill({ text, mode: 'replace' })

const GalleryBody = (d: Dollar, ui: UI, c: Cache, _now: number) => {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="column" gap="xs">
      <Text weight="semibold">Mod gallery</Text>
      <Text dimColor size="caption">
        Built on {BUILT_ON} from the plugin.json files in the marketplace folder. Which of these are installed in your session cannot be checked at
        runtime, so there is no tick. A button fills the prompt with the mod's help command; press Enter to run it.
      </Text>
      {CATALOG.map(m => (
        <Box flexDirection="column" marginTop="sm">
          <Box gap="sm">
            <Text weight="bold" color="claude">
              {m.name}
            </Text>
            <Text dimColor size="caption">
              {m.version}
            </Text>
            {m.help !== null && <Button key={`gal-${m.name}`} label={`/${m.help}`} onPress={() => fill(d, `/${m.help}`)} />}
          </Box>
          <Text size="footnote">{m.description}</Text>
          <Text dimColor mono size="caption">
            {m.commands.length === 0 ? 'no commands' : m.commands.map(x => `/${x.name}`).join(' ')}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

const TodayBody = (d: Dollar, ui: UI, c: Cache, now: number) => {
  const { Box, Text, Button } = ui
  const w = isoWeek(now)
  const id = lookOfWeek(w, lookNames())
  const look = LOOK_CHOICES.find(l => l.id === id)
  const day = dayIndex(now)
  const pack = soundOfDay(day)
  const step = c.meta.cookieDay === day ? c.meta.cookieStep : 0

  return (
    <Box flexDirection="column" gap="xs">
      {Heading(ui, 'Look of the week')}
      {look === undefined ? (
        <Text dimColor>No looks found at build time.</Text>
      ) : (
        <Box gap="sm">
          <Text>
            Week {w.week}: {look.label}, {look.blurb}
          </Text>
          <Button key="fill-look" label={`/look ${look.id}`} onPress={() => fill(d, `/look ${look.id}`)} />
        </Box>
      )}
      {Heading(ui, 'Sound of the day')}
      <Box gap="sm">
        <Text>{pack}</Text>
        <Button key="fill-sound" label={`/sound ${pack}`} onPress={() => fill(d, `/sound ${pack}`)} />
      </Box>
      {Heading(ui, 'Fortune cookie')}
      <Text italic>{cookieAt(day, step)}</Text>
      <Box>
        <Button key="cookie-next" label="Another" onPress={() => cmdCookie(d)} />
      </Box>
      {Heading(ui, 'Ambient ideas (text only, nothing is played)')}
      {MOODS.map(m => (
        <Text dimColor mono size="caption">
          {m.padEnd(7)} {soundtrackText(m, day).split('\n').slice(-1)[0]}
        </Text>
      ))}
      <Text dimColor size="caption">
        /dlmusic lists them all.
      </Text>
    </Box>
  )
}

const TourBody = (d: Dollar, ui: UI, c: Cache, _now: number) => {
  const { Box, Text, Button } = ui
  const s = TOUR[c.tourStep] ?? TOUR[0]!
  const dots = TOUR.map((_, i) => (i === c.tourStep ? '●' : '○')).join(' ')
  const move = async (dir: 'next' | 'back') => {
    c.tourStep = tourMove(c.tourStep, dir)
    await bump(d)
  }

  return (
    <Box flexDirection="column" gap="sm">
      <Text dimColor mono>
        {dots}
      </Text>
      <Text size="heading" weight="bold">
        {c.tourStep + 1}. {s.title}
      </Text>
      <Text>{s.body}</Text>
      <Box gap="sm">
        <Text mono color="suggestion">
          {s.cmd}
        </Text>
        <Button key="tour-try" label="Fill the prompt" onPress={() => fill(d, s.cmd)} />
      </Box>
      <Box gap="sm">
        {c.tourStep > 0 && <Button key="tour-back" label="Back" onPress={() => move('back')} />}
        {c.tourStep < TOUR.length - 1 ? (
          <Button key="tour-next" variant="primary" label="Next" onPress={() => move('next')} />
        ) : (
          <Button
            key="tour-done"
            variant="primary"
            label="Done"
            onPress={async () => {
              c.tourStep = 0
              await bump(d)
            }}
          />
        )}
      </Box>
    </Box>
  )
}

const PetBody = (d: Dollar, ui: UI, c: Cache, _now: number) => {
  const { Box, Text, Button } = ui
  const wear = async (id: string | null) => {
    c.wear = id
    await save(d, c, 'wear')
    await bump(d)
  }

  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="column">
        {petPreview(c.wear).map(line => (
          <Text mono color="claude">
            {line}
          </Text>
        ))}
      </Box>
      <Text dimColor size="caption">
        A preview figure of this mod's own. The real pet belongs to the personality mod (/pet) and is not changed.
        {c.flags.track ? '' : ' Counting is off, so nothing new unlocks: /dltrack on.'}
      </Text>
      {WARDROBE.map(a => {
        const ok = isUnlocked(a, c.counters)

        return (
          <Box gap="sm">
            <Text weight={a.id === c.wear ? 'bold' : 'regular'} dimColor={!ok}>
              {a.name}
            </Text>
            <Text dimColor size="caption" tabular>
              {ok ? 'unlocked' : `${progressOf(a, c.counters)}/${a.need} ${COUNTER_LABEL[a.counter]}`}
            </Text>
            {ok && <Button key={`wear-${a.id}`} label={a.id === c.wear ? 'Worn' : 'Wear'} onPress={() => wear(a.id)} />}
          </Box>
        )
      })}
      {c.wear !== null && (
        <Box>
          <Button key="wear-none" label="Take it off" onPress={() => wear(null)} />
        </Box>
      )}
    </Box>
  )
}

const GamesBody = (d: Dollar, ui: UI, c: Cache, _now: number) => {
  const { Box, Text, Button } = ui
  const g = c.game
  const found = Object.keys(c.eggs).length

  return (
    <Box flexDirection="column" gap="sm">
      <Box gap="sm">
        <Button key="start-hl" label="Higher or lower" onPress={async () => startGame(d, c, 'hl')} />
        <Button key="start-mem" label="Memory 3x3" onPress={async () => startGame(d, c, 'mem')} />
        {g !== null && (
          <Button
            key="stop"
            label="Stop"
            onPress={async () => {
              c.game = null
              await save(d, c, 'game')
              await bump(d)
            }}
          />
        )}
      </Box>
      {g === null && <Text dimColor>Pick a game. They are turn-based: nothing moves until you press something.</Text>}
      {g?.kind === 'hl' && (
        <Box flexDirection="column" gap="sm">
          <Text size="title" weight="bold" tabular color="claude">
            {cardName(g.card)}
          </Text>
          <Text dimColor>
            Will the next card (1 to 13) be higher or lower? Streak {g.streak}, best {g.best}.
            {g.last === 'win' && g.prev !== null ? ` Last was ${cardName(g.prev)}: right.` : ''}
            {g.last === 'lose' && g.prev !== null ? ` Last was ${cardName(g.prev)}: wrong, streak reset.` : ''}
            {g.last === 'same' ? ' Same card, no change.' : ''}
          </Text>
          <Box gap="sm">
            <Button key="hl-higher" label="Higher" onPress={() => pressHL(d, 'higher')} />
            <Button key="hl-lower" label="Lower" onPress={() => pressHL(d, 'lower')} />
          </Box>
        </Box>
      )}
      {g?.kind === 'mem' && (
        <Box flexDirection="column" gap="sm">
          {[0, 3, 6].map(r => (
            <Box gap="sm">
              {[0, 1, 2].map(k => (
                <Button key={`mem-${r + k}`} label={` ${memFace(g, r + k)} `} onPress={() => pressMem(d, r + k)} />
              ))}
            </Box>
          ))}
          <Text dimColor>
            {g.done ? `Solved in ${plural(g.moves, 'move')}.${g.best > 0 ? ` Best ${g.best}.` : ''}` : `Find the four pairs. Moves ${g.moves}. The star is free.`}
          </Text>
        </Box>
      )}
      {Heading(ui, 'Egg hunt')}
      <Text>
        {found} of {EGGS.length} found. /dlhunt gives hints.
      </Text>
    </Box>
  )
}

const CardsBody = (_d: Dollar, ui: UI, c: Cache, _now: number) => {
  const { Box, Text } = ui
  const next = POSTCARDS.find(t => t > c.counters.tools)
  const reached = POSTCARDS.filter(t => c.cards[String(t)] !== undefined)

  return (
    <Box flexDirection="column" gap="sm">
      {!c.flags.track && <Text dimColor>Counting is off, so no postcards will arrive. /dltrack on starts counting tool calls.</Text>}
      <Text>
        {plural(c.counters.tools, 'tool call')}, {plural(c.counters.days, 'active day')}, {plural(c.counters.commits, 'commit')}
        {next === undefined ? '. All postcards reached.' : `. Next postcard at ${next}.`}
      </Text>
      {next !== undefined && (
        <Text mono color="suggestion">
          {bar(c.counters.tools / next, 24)} {c.counters.tools}/{next}
        </Text>
      )}
      {reached.length === 0 && <Text dimColor>No postcards yet.</Text>}
      {reached.map(t => (
        <Box flexDirection="column">
          {postcardText(t, c.cards[String(t)]!).map(line => (
            <Text mono color="claude">
              {line}
            </Text>
          ))}
        </Box>
      ))}
      <Text dimColor size="caption">
        Compliments: {c.flags.kind ? 'on' : 'off'}. Last one: {c.kind.lastDay === '' ? 'never' : c.kind.lastDay}. /dlkind on|off.
      </Text>
    </Box>
  )
}

const RetroBody = (d: Dollar, ui: UI, c: Cache, _now: number) => {
  const { Box, Text, Button } = ui
  const k = c.counters
  const rows = [
    `TOOLS ..... ${String(k.tools).padStart(6)}`,
    `ERRORS .... ${String(k.errors).padStart(6)}`,
    `EDITS ..... ${String(k.edits).padStart(6)}`,
    `COMMITS ... ${String(k.commits).padStart(6)}`,
    `TESTS OK .. ${String(k.testsPassed).padStart(6)}`,
    `DAYS ...... ${String(k.days).padStart(6)}`,
    '',
    c.flags.track ? '> READY_' : '> COUNTING OFF (/dltrack on)',
  ]

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="column">
        {boxLines('DELIGHT TERMINAL 0.1', rows, 34).map(line => (
          <Text mono color="success">
            {line}
          </Text>
        ))}
      </Box>
      <Text dimColor size="caption">
        Honest note: this is a pane drawn in box characters, monospace, with your theme's success colour for green. It cannot recolour the rest of the
        app or give it a dark background. A real green-on-black needs a look: try /look terminal.
      </Text>
      <Box>
        <Button key="retro-look" label="Fill /look terminal" onPress={() => fill(d, '/look terminal')} />
      </Box>
    </Box>
  )
}

const TypeBody = (d: Dollar, ui: UI, c: Cache, _now: number) => {
  const { Box, Text, Button } = ui
  const s = typingStats(samples)
  const toggle = () => setFlag(d, 'type', !c.flags.type)

  return (
    <Box flexDirection="column" gap="sm">
      <Text dimColor>
        {c.flags.type
          ? 'Measuring how fast your draft grows between edits (pauses over 3 s and pastes are skipped). Only lengths and times are kept in memory, never the text.'
          : 'Off. Turn it on to see characters per minute while you type in the prompt box.'}
      </Text>
      <Box gap="sm">
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
          <Text size="caption" dimColor>
            Now
          </Text>
          <Text size="heading" weight="bold" tabular>
            {s.cpm} cpm
          </Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
          <Text size="caption" dimColor>
            About
          </Text>
          <Text size="heading" weight="bold" tabular>
            {Math.round(s.cpm / 5)} wpm
          </Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
          <Text size="caption" dimColor>
            Best
          </Text>
          <Text size="heading" weight="bold" tabular>
            {c.meta.typingBest} cpm
          </Text>
        </Box>
      </Box>
      <Box gap="sm">
        <Button key="type-toggle" label={c.flags.type ? 'Turn off' : 'Turn on'} onPress={toggle} />
        <Button
          key="type-clear"
          label="Clear"
          onPress={async () => {
            samples = []
            await bump(d)
          }}
        />
      </Box>
    </Box>
  )
}

const HeatBody = (d: Dollar, ui: UI, c: Cache, now: number) => {
  const { Box, Text, Button } = ui
  const { rows, total, un } = heatBlock(c, dayIndex(now))
  const max = Math.max(1, ...rows.map(r => r.n))

  return (
    <Box flexDirection="column" gap="xs">
      <Text dimColor>
        {c.flags.track
          ? 'Counting command runs by name (never arguments). Only commands that pass through this mod are seen.'
          : 'Counting is off, so this shows only what was recorded before.'}
      </Text>
      <Box>
        <Button key="heat-toggle" label={c.flags.track ? 'Stop counting' : 'Start counting'} onPress={() => setFlag(d, 'track', !c.flags.track)} />
      </Box>
      {Heading(ui, 'Command runs by mod')}
      {rows.length === 0 && <Text dimColor>Nothing recorded yet.</Text>}
      {rows.slice(0, 20).map(r => (
        <Box gap="sm">
          <Text mono dimColor>
            {r.label.padEnd(15)}
          </Text>
          <Text mono color="suggestion">
            {bar(r.n / max, 14)}
          </Text>
          <Text mono tabular>
            {r.n}
          </Text>
        </Box>
      ))}
      {total > 0 && (
        <Text dimColor size="caption">
          {plural(total, 'run')} in all.
        </Text>
      )}
      {Heading(ui, 'Not used in 14 days')}
      <Text dimColor>{recommendText(un, helpOf)}</Text>
    </Box>
  )
}

const NotesBody = (d: Dollar, ui: UI, c: Cache, now: number) => {
  const { Box, Text, Button } = ui
  const week = weekKey(now)
  const open = auditIsOpen(c.flags.audit, week, c.audits)
  const answer = async (a: 'helped' | 'annoyed') => {
    c.audits = [...c.audits, { week, answer: a, at: await d.clock.now() }].slice(-52)
    await save(d, c, 'audits')
    await bump(d)
  }

  return (
    <Box flexDirection="column" gap="sm">
      {open ? (
        <Box flexDirection="column" borderStyle="round" borderColor="suggestion" padding="sm" gap="sm">
          <Text weight="semibold">Weekly check-in ({week})</Text>
          <Text>Did the little delights help this week, or annoy you?</Text>
          <Box gap="sm">
            <Button key="audit-helped" label="helped" onPress={() => answer('helped')} />
            <Button key="audit-annoyed" label="annoyed" onPress={() => answer('annoyed')} />
          </Box>
        </Box>
      ) : (
        <Text dimColor>
          {c.flags.audit ? `This week's check-in is answered (${c.audits.find(a => a.week === week)?.answer}).` : 'The weekly check-in is off. /dlaudit on turns it on.'}
        </Text>
      )}
      {c.audits.length > 0 && (
        <Text dimColor size="caption" mono>
          {c.audits
            .slice(-8)
            .map(a => `${a.week} ${a.answer}`)
            .join('  ')}
        </Text>
      )}
      {Heading(ui, 'Your notes')}
      {c.notes.length === 0 && <Text dimColor>None yet. /dlfeedback {'<mod> <text>'} adds one.</Text>}
      {c.notes.slice(-10).map(n => (
        <Box gap="sm">
          <Text mono dimColor size="caption">
            {dayKey(n.at)}
          </Text>
          <Text weight="semibold">{n.mod}</Text>
          <Text>{n.text}</Text>
        </Box>
      ))}
    </Box>
  )
}

const LogBody = (d: Dollar, ui: UI, c: Cache, _now: number) => {
  const { Box, Text, Button } = ui
  const fresh = CHANGELOG.find(e => e.mod === 'delight')

  return (
    <Box flexDirection="column" gap="xs">
      {c.showNew && fresh !== undefined && (
        <Box flexDirection="column" borderStyle="round" borderColor="suggestion" padding="sm" gap="xs">
          <Text weight="semibold">What is new in delight {fresh.version}</Text>
          <Text>{fresh.summary}</Text>
          {fresh.lines.map(l => (
            <Text size="footnote">- {l}</Text>
          ))}
          <Box>
            <Button
              key="new-ok"
              label="Got it"
              onPress={async () => {
                c.showNew = false
                await bump(d)
              }}
            />
          </Box>
        </Box>
      )}
      <Text dimColor size="caption">
        Hand-written when this mod was built. Each entry says what the mod does for you today.
      </Text>
      {CHANGELOG.map(e => (
        <Box flexDirection="column" marginTop="sm">
          <Box gap="sm">
            <Text weight="bold" color="claude">
              {e.mod}
            </Text>
            <Text dimColor size="caption">
              {e.version}
            </Text>
            {e.start.startsWith('/') && <Button key={`log-${e.mod}`} label={e.start} onPress={() => fill(d, e.start)} />}
          </Box>
          <Text>{e.summary}</Text>
          {e.lines.map(l => (
            <Text size="footnote" dimColor>
              - {l}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

const renderBody = (d: Dollar, ui: UI, c: Cache, now: number, tab: DelightTab) => {
  switch (tab) {
    case 'today':
      return TodayBody(d, ui, c, now)
    case 'tour':
      return TourBody(d, ui, c, now)
    case 'pet':
      return PetBody(d, ui, c, now)
    case 'games':
      return GamesBody(d, ui, c, now)
    case 'cards':
      return CardsBody(d, ui, c, now)
    case 'retro':
      return RetroBody(d, ui, c, now)
    case 'type':
      return TypeBody(d, ui, c, now)
    case 'heat':
      return HeatBody(d, ui, c, now)
    case 'notes':
      return NotesBody(d, ui, c, now)
    case 'log':
      return LogBody(d, ui, c, now)
    default:
      return GalleryBody(d, ui, c, now)
  }
}

// ----------------------------------------------------------------- session

const startSession = async (d: Dollar) => {
  const c = await load(d)
  const now = await d.clock.now()
  track = emptyTrack()
  pending = []
  samples = []
  const week = weekKey(now)

  if (auditIsDue(c.flags.audit, week, c.meta.auditShown, c.audits)) {
    c.meta.auditShown = week
    dirty.add('meta')
    await flush(d, now, true)
    await tryToast(d, c, now, 'Weekly check-in is ready: /dlpane notes')
  }
}

// ----------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await startSession($).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await flush($, await $.clock.now(), true).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const c = await load($)
      const now = await $.clock.now()
      await flush($, now, true)
      await maybeCompliment($, c, now, dayKey(now))
    } catch {
      // Bookkeeping only.
    }

    return next(e)
  })

  // Heat: every command that passes through counts once, by name only. Registered first so it sees our own too.
  on('command.run', async ($, e, next) => {
    await noteCommand($, e.command).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    let ran

    try {
      ran = await next(e)
    } catch (err) {
      await noteTool($, tool, input, false).catch(() => undefined)
      throw err
    }
    const result = ran as { deny?: string; isError?: boolean }

    if (result.deny === undefined) {
      await noteTool($, tool, input, result.isError !== true).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await noteEdit($, box.text).catch(() => undefined)

    return box
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    samples = []

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'dl' }, async () => ({ text: helpText() }))
  on('command.run', { command: 'dlgallery' }, async $ => ({ text: await cmdGallery($) }))
  on('command.run', { command: 'dlpane' }, async ($, e) => ({ text: await cmdPane($, e.args) }))
  on('command.run', { command: 'dltour' }, async ($, e) => ({ text: await cmdTour($, e.args) }))
  on('command.run', { command: 'dlweek' }, async $ => ({ text: await cmdWeek($) }))
  on('command.run', { command: 'dlsound' }, async $ => ({ text: await cmdSound($) }))
  on('command.run', { command: 'dlmusic' }, async ($, e) => ({ text: await cmdMusic($, e.args) }))
  on('command.run', { command: 'dlcookie' }, async $ => ({ text: await cmdCookie($) }))
  on('command.run', { command: 'dlwear' }, async ($, e) => ({ text: await cmdWear($, e.args) }))
  on('command.run', { command: 'dlgame' }, async ($, e) => ({ text: await cmdGame($, e.args) }))
  on('command.run', { command: 'dlcard' }, async ($, e) => ({ text: await cmdCard($, e.args) }))
  on('command.run', { command: 'dlretro' }, async $ => ({ text: await cmdRetro($) }))
  on('command.run', { command: 'dlhunt' }, async $ => ({ text: await cmdHunt($) }))
  on('command.run', { command: 'dltrack' }, async ($, e) => ({ text: await cmdTrack($, e.args) }))
  on('command.run', { command: 'dlkind' }, async ($, e) => ({ text: await cmdKind($, e.args) }))
  on('command.run', { command: 'dltype' }, async ($, e) => ({ text: await cmdType($, e.args) }))
  on('command.run', { command: 'dlaudit' }, async ($, e) => ({ text: await cmdAudit($, e.args) }))
  on('command.run', { command: 'dlheat' }, async $ => ({ text: await cmdHeat($) }))
  on('command.run', { command: 'dlrecommend' }, async $ => ({ text: await cmdRecommend($) }))
  on('command.run', { command: 'dlfeedback' }, async ($, e) => ({ text: await cmdFeedback($, e.args) }))
  on('command.run', { command: 'dlfeedbacks' }, async ($, e) => ({ text: await cmdFeedbacks($, e.args) }))
  on('command.run', { command: 'dlnew' }, async $ => ({ text: await cmdNew($) }))
  on('command.run', { command: 'dlchangelog' }, async ($, e) => ({ text: await cmdChangelog($, e.args) }))
  on('command.run', { command: 'dlreset' }, async $ => ({ text: await cmdReset($) }))
  on('command.run', { command: 'dlxyzzy' }, async $ => ({ text: await cmdEgg($, 'xyzzy') }))
  on('command.run', { command: 'dlplugh' }, async $ => ({ text: await cmdEgg($, 'plugh') }))
  on('command.run', { command: 'dlquack' }, async $ => ({ text: await cmdEgg($, 'quack') }))
  on('command.run', { command: 'dlsudo' }, async $ => ({ text: await cmdEgg($, 'sudo') }))
  on('command.run', { command: 'dlmeow' }, async $ => ({ text: await cmdEgg($, 'meow') }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const c = await load($)
    await read($, rev)
    const tab = await read($, tabAtom)
    const now = await $.clock.now()

    return (
      <Box flexDirection="column" padding="sm">
        <Box gap="sm" flexWrap="wrap" marginBottom="sm">
          {TABS.map(([id, label]) => (
            <Button
              key={`tab-${id}`}
              variant={id === tab ? 'primary' : undefined}
              label={id === tab ? `* ${label}` : label}
              onPress={() => update($, tabAtom, () => id)}
            />
          ))}
        </Box>
        {renderBody($, ui, c, now, tab)}
        <Box marginTop="md">
          <Text dimColor size="caption">
            /dl lists every command. Everything here except the gallery is off until you switch it on.
          </Text>
        </Box>
      </Box>
    )
  })
}
