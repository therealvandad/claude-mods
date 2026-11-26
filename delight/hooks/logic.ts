// Pure functions for the delight mod: no engine calls, no clock, no randomness
// except through a seed passed in. Everything here is covered by register.test.tsx.
import { COOKIES, EGGS, SOUNDTRACKS, TOUR, WARDROBE } from './data'
import type { Accessory, Mood, Track } from './data'

// ------------------------------------------------------------------- helpers

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar day as YYYY-MM-DD. */
export const dayKey = (ms: number) => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Whole local days since 1970 (consecutive local days differ by exactly one). */
export const dayIndex = (ms: number) => {
  const d = new Date(ms)

  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

/** ISO 8601 week of the local date. */
export const isoWeek = (ms: number): { year: number; week: number } => {
  const d = new Date(ms)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const year = t.getUTCFullYear()

  return { year, week: Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7) }
}

export const weekKey = (ms: number) => {
  const w = isoWeek(ms)

  return `${w.year}-W${pad(w.week)}`
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const onOff = (arg: string): boolean | undefined =>
  /^(on|true|yes|1)$/i.test(arg.trim()) ? true : /^(off|false|no|0)$/i.test(arg.trim()) ? false : undefined

export const bar = (frac: number, width: number) => {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)))

  return '█'.repeat(n) + '░'.repeat(width - n)
}

/** A box of box-drawing characters; every returned line is exactly width+4 columns. */
export const boxLines = (title: string, lines: readonly string[], width: number): string[] => {
  const fit = (t: string) => (t.length > width ? `${t.slice(0, width - 1)}\u2026` : t.padEnd(width))
  const label = ` ${title.slice(0, width - 2)} `

  return [
    `\u2554${`\u2550${label}`.padEnd(width + 2, '\u2550')}\u2557`,
    ...lines.map(l => `\u2551 ${fit(l)} \u2551`),
    `\u255a${'\u2550'.repeat(width + 2)}\u255d`,
  ]
}

// ------------------------------------------------------------ 181 / 185 / 188

/** One static look for the week. Same week gives the same look, next week the next one. */
export const lookOfWeek = (week: { year: number; week: number }, looks: readonly string[]): string | undefined =>
  looks.length === 0 ? undefined : looks[(week.year * 53 + week.week) % looks.length]

export const SOUND_PACKS = ['retro', 'wood', 'glass'] as const

export const soundOfDay = (dayIdx: number): (typeof SOUND_PACKS)[number] => SOUND_PACKS[((dayIdx % 3) + 3) % 3]!

/** First cookie of a day is fixed by the date; each extra one steps along. */
export const cookieIndex = (dayIdx: number, extra: number) => (((dayIdx * 7 + extra) % COOKIES.length) + COOKIES.length) % COOKIES.length

export const cookieAt = (dayIdx: number, extra: number) => COOKIES[cookieIndex(dayIdx, extra)]!

// ---------------------------------------------------------------------- 186

export const parseMood = (arg: string): Mood | 'all' | undefined => {
  const w = arg.trim().toLowerCase()

  return w === '' || w === 'all' ? 'all' : w === 'focus' || w === 'calm' || w === 'late' || w === 'upbeat' ? w : undefined
}

export const soundtrackText = (mood: Mood | 'all', dayIdx: number): string => {
  const list: readonly Track[] = mood === 'all' ? SOUNDTRACKS : SOUNDTRACKS.filter(t => t.mood === mood)
  const pick = list[dayIdx % Math.max(1, list.length)]
  const rows = list.map(t => `  [${t.mood}] ${t.name}: ${t.note}`)

  return [
    'Ambient ideas (text only: nothing is played or linked, search for the name in any player).',
    ...rows,
    pick === undefined ? '' : `Pick for today: ${pick.name}.`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------- 182

export type Counters = {
  tools: number
  errors: number
  edits: number
  commits: number
  testsPassed: number
  testsFailed: number
  days: number
  firstDay: string
  lastDay: string
  byTool: Record<string, number>
}

export const emptyCounters = (): Counters => ({
  tools: 0,
  errors: 0,
  edits: 0,
  commits: 0,
  testsPassed: 0,
  testsFailed: 0,
  days: 0,
  firstDay: '',
  lastDay: '',
  byTool: {},
})

const MAX_TOOL_KEYS = 24

export const cleanCounters = (raw: unknown): Counters => {
  const r = isObj(raw) ? raw : {}
  const byTool: Record<string, number> = {}

  if (isObj(r.byTool)) {
    for (const [k, v] of Object.entries(r.byTool).slice(0, MAX_TOOL_KEYS)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && /^[\w:.-]{1,60}$/.test(k)) {
        byTool[k] = Math.floor(v)
      }
    }
  }
  const n = (k: string) => Math.max(0, Math.floor(num(r[k])))

  return {
    tools: n('tools'),
    errors: n('errors'),
    edits: n('edits'),
    commits: n('commits'),
    testsPassed: n('testsPassed'),
    testsFailed: n('testsFailed'),
    days: n('days'),
    firstDay: str(r.firstDay),
    lastDay: str(r.lastDay),
    byTool,
  }
}

const TESTS =
  /\b(npm (run )?test|npm t|yarn test|pnpm test|bun test|jest|vitest|pytest|mocha|cargo test|go test|rspec|phpunit|dotnet test|mvn test|gradle test|make test)\b/

export const isTestCommand = (cmd: string) => TESTS.test(cmd)
export const isCommitCommand = (cmd: string) => /\bgit\s+(?:-\S+\s+)*commit\b/.test(cmd)

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export type ToolFact = { tool: string; ok: boolean; command: string; path: string }

/** Counts one finished tool call. Pure: returns a new object. */
export const recordTool = (c: Counters, f: ToolFact, today: string): Counters => {
  const isNewDay = c.lastDay !== today
  const byTool = { ...c.byTool }
  const key = /^[\w:.-]{1,60}$/.test(f.tool) ? f.tool : 'other'
  const slot = key in byTool || Object.keys(byTool).length < MAX_TOOL_KEYS ? key : 'other'
  byTool[slot] = (byTool[slot] ?? 0) + 1
  const isBash = f.tool === 'Bash'
  const isTest = isBash && isTestCommand(f.command)

  return {
    ...c,
    tools: c.tools + 1,
    errors: c.errors + (f.ok ? 0 : 1),
    edits: c.edits + (f.ok && EDIT_TOOLS.has(f.tool) ? 1 : 0),
    commits: c.commits + (f.ok && isBash && isCommitCommand(f.command) ? 1 : 0),
    testsPassed: c.testsPassed + (f.ok && isTest ? 1 : 0),
    testsFailed: c.testsFailed + (!f.ok && isTest ? 1 : 0),
    days: c.days + (isNewDay ? 1 : 0),
    firstDay: c.firstDay === '' ? today : c.firstDay,
    lastDay: today,
    byTool,
  }
}

export const progressOf = (a: Accessory, c: Counters) => Math.min(a.need, c[a.counter])
export const isUnlocked = (a: Accessory, c: Counters) => c[a.counter] >= a.need
export const unlockedIds = (c: Counters) => WARDROBE.filter(a => isUnlocked(a, c)).map(a => a.id)

/** Preview art for the wardrobe: a plain figure of our own (the real pet belongs to personality). */
export const petPreview = (id: string | null): string[] => {
  const a = WARDROBE.find(w => w.id === id)

  if (a === undefined) {
    return ['  /\\_/\\', ' ( o.o )', '  > ^ <']
  }

  return [...a.top, a.id === 'phones' ? ' /\\_/\\' : '  /\\_/\\', a.face, a.bottom]
}

export const wardrobeText = (c: Counters, worn: string | null): string => {
  const rows = WARDROBE.map(a => {
    const mark = a.id === worn ? '*' : isUnlocked(a, c) ? '+' : '-'
    const status = isUnlocked(a, c) ? 'unlocked' : `${progressOf(a, c)}/${a.need} ${a.counter === 'tools' ? 'tool calls' : a.counter}`

    return `  ${mark} ${a.id.padEnd(8)} ${a.name.padEnd(14)} ${status}`
  })

  return ['Wardrobe (a preview only: the pet itself belongs to the personality mod).', ...rows, 'Wear one with /dlwear <id>, or /dlwear none.'].join('\n')
}

// ---------------------------------------------------------------------- 184

export type Hit = { id: 'green-after-red' | 'clean-run' | 'ten-files' | 'first-commit'; n: number }

export type RunTrack = { okRun: number; testFails: number; files: string[]; commitDay: string }

export const emptyTrack = (): RunTrack => ({ okRun: 0, testFails: 0, files: [], commitDay: '' })

export const CLEAN_RUN = 25
export const FILES_GOAL = 10

/** Looks at one finished call and says which real milestones it completed. */
export const stepTrack = (t: RunTrack, f: ToolFact, today: string): { track: RunTrack; hits: Hit[] } => {
  const hits: Hit[] = []
  const track: RunTrack = { ...t, files: [...t.files] }
  track.okRun = f.ok ? t.okRun + 1 : 0

  if (f.ok && track.okRun === CLEAN_RUN) {
    hits.push({ id: 'clean-run', n: CLEAN_RUN })
  }
  const isTest = f.tool === 'Bash' && isTestCommand(f.command)

  if (isTest && !f.ok) {
    track.testFails = t.testFails + 1
  }

  if (isTest && f.ok && t.testFails > 0) {
    hits.push({ id: 'green-after-red', n: t.testFails })
    track.testFails = 0
  }

  if (f.ok && EDIT_TOOLS.has(f.tool) && f.path !== '' && !track.files.includes(f.path)) {
    track.files = [...track.files, f.path].slice(-50)

    if (track.files.length === FILES_GOAL) {
      hits.push({ id: 'ten-files', n: FILES_GOAL })
    }
  }

  if (f.ok && f.tool === 'Bash' && isCommitCommand(f.command) && t.commitDay !== today) {
    track.commitDay = today
    hits.push({ id: 'first-commit', n: 1 })
  }

  return { track, hits }
}

export const complimentText = (h: Hit): string => {
  switch (h.id) {
    case 'green-after-red':
      return `Your tests went green after ${plural(h.n, 'red run')}. Going back in until it passed is the part that counts.`
    case 'clean-run':
      return `${h.n} tool calls in a row without a failure. That was a smooth stretch.`
    case 'ten-files':
      return `Ten different files edited this session. That is a real change, not a tweak.`
    case 'first-commit':
      return 'First commit of the day. Small commits are kind to your future self.'
  }
}

export type KindState = { lastDay: string; last: Record<string, string> }

export const COOLDOWN_DAYS = 7

export const cleanKind = (raw: unknown): KindState => {
  const r = isObj(raw) ? raw : {}
  const last: Record<string, string> = {}

  if (isObj(r.last)) {
    for (const [k, v] of Object.entries(r.last).slice(0, 10)) {
      if (typeof v === 'string' && /^[\w-]{1,30}$/.test(k)) {
        last[k] = v.slice(0, 10)
      }
    }
  }

  return { lastDay: str(r.lastDay).slice(0, 10), last }
}

const daysBetween = (a: string, b: string) => {
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`)

  return Math.round((t(b) - t(a)) / 86_400_000)
}

/** At most one compliment per day, and each kind at most once a week. */
export const pickCompliment = (hits: readonly Hit[], kind: KindState, today: string): Hit | undefined => {
  if (kind.lastDay === today) {
    return undefined
  }

  return hits.find(h => {
    const seen = kind.last[h.id]

    return seen === undefined || !Number.isFinite(daysBetween(seen, today)) || daysBetween(seen, today) >= COOLDOWN_DAYS
  })
}

// ---------------------------------------------------------------------- 187

export const POSTCARDS = [100, 1000, 10000] as const

export const crossed = (prev: number, next: number): number[] => POSTCARDS.filter(t => prev < t && next >= t)

export type CardSnap = { tools: number; days: number; top: string; date: string }

export const postcardText = (threshold: number, snap: CardSnap): string[] => {
  const n = POSTCARDS.indexOf(threshold as (typeof POSTCARDS)[number]) + 1
  const lines = [`${threshold.toLocaleString('en-US')} tool calls`, '', `Reached on ${snap.date}`, `Active days so far: ${snap.days}`]

  if (snap.top !== '') {
    lines.push(`Most used: ${snap.top}`)
  }
  lines.push('', threshold >= 10000 ? 'Ten thousand. Take a long walk.' : threshold >= 1000 ? 'A thousand. This is a habit now.' : 'A hundred. The first of many.')

  return boxLines(`Postcard ${n} of ${POSTCARDS.length}`, lines, 38)
}

export const topToolOf = (c: Counters): string => {
  const [tool, n] = Object.entries(c.byTool).sort((a, b) => b[1] - a[1])[0] ?? []

  return tool === undefined || n === undefined ? '' : `${tool} (${n})`
}

// ---------------------------------------------------------------------- 190

export type Sample = { at: number; len: number }

export const MAX_SAMPLES = 120
const GAP_MS = 3000
const PASTE_CHARS = 40
const WINDOW_MS = 30_000

/** Characters per minute while typing: growth of the draft over the time between edits that were close together. */
export const typingStats = (samples: readonly Sample[]): { cpm: number; chars: number; activeMs: number } => {
  const last = samples[samples.length - 1]

  if (last === undefined) {
    return { cpm: 0, chars: 0, activeMs: 0 }
  }
  const recent = samples.filter(s => last.at - s.at <= WINDOW_MS)
  let chars = 0
  let activeMs = 0

  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1]!
    const b = recent[i]!
    const dt = b.at - a.at
    const grew = b.len - a.len

    if (dt <= 0 || dt > GAP_MS || grew > PASTE_CHARS) {
      continue
    }
    activeMs += dt
    chars += Math.max(0, grew)
  }

  return { cpm: activeMs >= 2000 ? Math.round((chars / activeMs) * 60_000) : 0, chars, activeMs }
}

export const addSample = (samples: readonly Sample[], s: Sample): Sample[] => [...samples, s].slice(-MAX_SAMPLES)

// ---------------------------------------------------------------------- 191

export const eggFor = (word: string) => EGGS.find(e => e.word === word)

export const huntText = (found: Record<string, number>): string => {
  const n = EGGS.filter(e => found[e.word] !== undefined).length
  const rows = EGGS.map(e => (found[e.word] !== undefined ? `  found: /dl${e.word}` : `  hidden: ${e.hint}`))

  return [`Egg hunt: ${n} of ${EGGS.length} found. The words are typed as /dl<word>.`, ...rows].join('\n')
}

export const cleanEggs = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {}

  if (isObj(raw)) {
    for (const e of EGGS) {
      if (typeof raw[e.word] === 'number') {
        out[e.word] = raw[e.word] as number
      }
    }
  }

  return out
}

// ---------------------------------------------------------------------- 194

export const tourMove = (step: number, dir: 'next' | 'back', count = TOUR.length) =>
  Math.max(0, Math.min(count - 1, step + (dir === 'next' ? 1 : -1)))

export const clampStep = (n: unknown, count = TOUR.length) => Math.max(0, Math.min(count - 1, Math.floor(num(n))))

// ---------------------------------------------------------------------- 195

export const versionParts = (v: string) => v.split('.').map(p => Number.parseInt(p, 10) || 0)

export const isNewerVersion = (seen: string, current: string): boolean => {
  if (seen === '') {
    return true
  }
  const a = versionParts(seen)
  const b = versionParts(current)

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0)

    if (d !== 0) {
      return d > 0
    }
  }

  return false
}

// ---------------------------------------------------------------------- 196

export type Note = { mod: string; text: string; at: number }

export const MAX_NOTES = 200

export const parseFeedback = (args: string): { mod: string; text: string } | { error: string } => {
  const m = /^\s*\/?([A-Za-z0-9_-]{1,40})\s+([\s\S]+?)\s*$/.exec(args)

  if (m === null) {
    return { error: 'Usage: /dlfeedback <mod> <your note>, for example /dlfeedback looks the paper look is too warm' }
  }

  return { mod: m[1]!.toLowerCase(), text: m[2]!.replace(/\s+/g, ' ').slice(0, 400) }
}

export const cleanNotes = (raw: unknown): Note[] =>
  Array.isArray(raw)
    ? raw
        .filter(isObj)
        .map(n => ({ mod: str(n.mod).slice(0, 40), text: str(n.text).slice(0, 400), at: num(n.at) }))
        .filter(n => n.mod !== '' && n.text !== '')
        .slice(-MAX_NOTES)
    : []

export const notesText = (notes: readonly Note[], mod?: string): string => {
  const list = mod === undefined || mod === '' ? notes : notes.filter(n => n.mod === mod)

  if (list.length === 0) {
    return mod ? `No notes for ${mod}. /dlfeedback ${mod} <text> adds one.` : 'No notes yet. /dlfeedback <mod> <text> adds one.'
  }
  const shown = list.slice(-20)

  return [
    `${plural(list.length, 'note')}${list.length > shown.length ? ` (last ${shown.length})` : ''}:`,
    ...shown.map(n => `  ${notes.indexOf(n) + 1}. ${dayKey(n.at)} [${n.mod}] ${n.text}`),
  ].join('\n')
}

// ---------------------------------------------------------------------- 197/198

export type Heat = Record<string, { n: number; last: number }>

const MAX_HEAT = 200

const COMMAND_NAME = /^[\w:.-]{1,64}$/

/** Counts one command run. Only the name is kept, never the arguments. */
export const bumpHeat = (h: Heat, command: string, dayIdx: number): Heat => {
  if (!COMMAND_NAME.test(command)) {
    return h
  }
  const next: Heat = { ...h, [command]: { n: (h[command]?.n ?? 0) + 1, last: dayIdx } }
  const keys = Object.keys(next)

  if (keys.length <= MAX_HEAT) {
    return next
  }
  // Over the cap: forget the least recently used command.
  const oldest = keys.filter(k => k !== command).sort((a, b) => next[a]!.last - next[b]!.last)[0]

  if (oldest !== undefined) {
    delete next[oldest]
  }

  return next
}

export const cleanHeat = (raw: unknown): Heat => {
  const out: Heat = {}

  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw).slice(0, MAX_HEAT)) {
      if (COMMAND_NAME.test(k) && isObj(v)) {
        out[k] = { n: Math.max(0, Math.floor(num(v.n))), last: Math.floor(num(v.last)) }
      }
    }
  }

  return out
}

export type ModCommands = { name: string; commands: readonly string[] }

export type HeatRow = { label: string; n: number }

/** Command counts rolled up per mod; commands that belong to no mod count as "other". */
export const heatByMod = (h: Heat, mods: readonly ModCommands[]): HeatRow[] => {
  const owner = new Map<string, string>()

  for (const m of mods) {
    for (const c of m.commands) {
      owner.set(c, m.name)
    }
  }
  const sums = new Map<string, number>()

  for (const [cmd, v] of Object.entries(h)) {
    const label = owner.get(cmd) ?? 'other'
    sums.set(label, (sums.get(label) ?? 0) + v.n)
  }

  return [...sums.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
}

export const RECOMMEND_DAYS = 14

/** Mods none of whose commands ran in the last 14 days. Provisional until tracking covers 14 days. */
export const unusedMods = (
  h: Heat,
  mods: readonly ModCommands[],
  today: number,
  trackedSince: number,
): { names: string[]; daysTracked: number; isProvisional: boolean } => {
  const cutoff = today - (RECOMMEND_DAYS - 1)
  const names = mods
    .filter(m => m.commands.length > 0)
    .filter(m => m.commands.every(c => (h[c]?.last ?? -Infinity) < cutoff))
    .map(m => m.name)
  const daysTracked = trackedSince > 0 ? Math.max(1, today - trackedSince + 1) : 0

  return { names, daysTracked, isProvisional: daysTracked < RECOMMEND_DAYS }
}

export const recommendText = (r: ReturnType<typeof unusedMods>, helpOf: (mod: string) => string | undefined): string => {
  if (r.daysTracked === 0) {
    return 'Usage tracking is off, so there is nothing to recommend from. /dltrack on starts counting command runs (names only).'
  }
  const head = r.isProvisional
    ? `Only ${plural(r.daysTracked, 'day')} of data so far (a fair read needs ${RECOMMEND_DAYS}), so this list is provisional.`
    : `Based on the last ${RECOMMEND_DAYS} days of command runs.`

  if (r.names.length === 0) {
    return `${head}\nEvery mod with commands had at least one run in that window.`
  }

  return [
    head,
    'Mods whose commands were not run in that window:',
    ...r.names.map(n => {
      const help = helpOf(n)

      return `  ${n}${help === undefined ? '' : `  (try /${help})`}`
    }),
  ].join('\n')
}

// ---------------------------------------------------------------------- 199

export type AuditNote = { week: string; answer: 'helped' | 'annoyed'; at: number }

export const cleanAudits = (raw: unknown): AuditNote[] =>
  Array.isArray(raw)
    ? raw
        .filter(isObj)
        .map(a => ({ week: str(a.week).slice(0, 10), answer: a.answer === 'annoyed' ? ('annoyed' as const) : ('helped' as const), at: num(a.at) }))
        .filter(a => /^\d{4}-W\d{2}$/.test(a.week))
        .slice(-52)
    : []

/** The card is due when it is on, this week's card was not shown yet and was not answered. */
export const auditIsDue = (isOn: boolean, week: string, shownWeek: string, audits: readonly AuditNote[]) =>
  isOn && shownWeek !== week && !audits.some(a => a.week === week)

export const auditIsOpen = (isOn: boolean, week: string, audits: readonly AuditNote[]) => isOn && !audits.some(a => a.week === week)

// ---------------------------------------------------------------------- 183

/** mulberry32: returns a value in [0,1) and the next seed. */
export const nextRand = (seed: number): [number, number] => {
  const t = (seed + 0x6d2b79f5) >>> 0
  let r = Math.imul(t ^ (t >>> 15), 1 | t)
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)

  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t]
}

export type HL = {
  kind: 'hl'
  seed: number
  card: number
  prev: number | null
  streak: number
  best: number
  rounds: number
  last: 'win' | 'lose' | 'same' | null
}

export const hlNew = (seed: number, best = 0): HL => {
  const [v, s] = nextRand(seed)

  return { kind: 'hl', seed: s, card: 1 + Math.floor(v * 13), prev: null, streak: 0, best, rounds: 0, last: null }
}

export const hlGuess = (g: HL, guess: 'higher' | 'lower'): HL => {
  const [v, seed] = nextRand(g.seed)
  const card = 1 + Math.floor(v * 13)
  const base = { ...g, seed, card, prev: g.card, rounds: g.rounds + 1 }

  if (card === g.card) {
    return { ...base, last: 'same' }
  }
  const isWin = guess === 'higher' ? card > g.card : card < g.card
  const streak = isWin ? g.streak + 1 : 0

  return { ...base, streak, best: Math.max(g.best, streak), last: isWin ? 'win' : 'lose' }
}

export const cardName = (n: number) => (n === 1 ? 'A' : n === 11 ? 'J' : n === 12 ? 'Q' : n === 13 ? 'K' : String(n))

export const MEM_SYMBOLS = ['♠', '♥', '♦', '♣'] as const
export const MEM_FREE = '★'
export const MEM_CENTER = 4

export type Mem = {
  kind: 'mem'
  seed: number
  cards: string[]
  up: boolean[]
  matched: boolean[]
  picks: number[]
  moves: number
  done: boolean
  best: number
}

/** 3x3 memory: four pairs and a free star in the middle. */
export const memNew = (seed: number, best = 0): Mem => {
  const pool: string[] = [...MEM_SYMBOLS, ...MEM_SYMBOLS]
  let s = seed

  for (let i = pool.length - 1; i > 0; i--) {
    const [v, n] = nextRand(s)
    s = n
    const j = Math.floor(v * (i + 1))
    const a = pool[i]!
    pool[i] = pool[j]!
    pool[j] = a
  }
  const cards = [...pool.slice(0, MEM_CENTER), MEM_FREE, ...pool.slice(MEM_CENTER)]
  const free = cards.map((_, i) => i === MEM_CENTER)

  return { kind: 'mem', seed: s, cards, up: [...free], matched: [...free], picks: [], moves: 0, done: false, best }
}

export const memFlip = (m: Mem, i: number): Mem => {
  if (m.done || i < 0 || i >= m.cards.length || m.matched[i] === true || m.picks.includes(i)) {
    return m
  }
  const up = [...m.up]
  const matched = [...m.matched]
  let picks = [...m.picks]

  // A mismatched pair stays face up until the next press, then turns back.
  if (picks.length === 2) {
    for (const p of picks) {
      up[p] = false
    }
    picks = []
  }
  up[i] = true
  picks.push(i)
  let moves = m.moves

  if (picks.length === 2) {
    moves++
    const [a, b] = picks as [number, number]

    if (m.cards[a] === m.cards[b]) {
      matched[a] = true
      matched[b] = true
      picks = []
    }
  }
  const done = matched.every(Boolean)

  return { ...m, up, matched, picks, moves, done, best: done ? (m.best === 0 ? moves : Math.min(m.best, moves)) : m.best }
}

export const memFace = (m: Mem, i: number) => (m.up[i] || m.matched[i] ? m.cards[i]! : '?')

export type Game = HL | Mem

export const cleanGame = (raw: unknown): Game | null => {
  if (!isObj(raw)) {
    return null
  }

  if (raw.kind === 'hl') {
    const last = raw.last === 'win' || raw.last === 'lose' || raw.last === 'same' ? raw.last : null

    return {
      kind: 'hl',
      seed: num(raw.seed, 1) >>> 0,
      card: Math.max(1, Math.min(13, Math.floor(num(raw.card, 1)))),
      prev: typeof raw.prev === 'number' ? raw.prev : null,
      streak: Math.max(0, Math.floor(num(raw.streak))),
      best: Math.max(0, Math.floor(num(raw.best))),
      rounds: Math.max(0, Math.floor(num(raw.rounds))),
      last,
    }
  }

  if (raw.kind === 'mem' && Array.isArray(raw.cards) && raw.cards.length === 9) {
    const bools = (v: unknown) => (Array.isArray(v) && v.length === 9 ? v.map(x => x === true) : Array<boolean>(9).fill(false))
    const cards = raw.cards.map(c => str(c).slice(0, 2))
    const picks = Array.isArray(raw.picks) ? raw.picks.filter((p): p is number => typeof p === 'number' && p >= 0 && p < 9).slice(0, 2) : []

    return {
      kind: 'mem',
      seed: num(raw.seed, 1) >>> 0,
      cards,
      up: bools(raw.up),
      matched: bools(raw.matched),
      picks,
      moves: Math.max(0, Math.floor(num(raw.moves))),
      done: raw.done === true,
      best: Math.max(0, Math.floor(num(raw.best))),
    }
  }

  return null
}

export const gameText = (g: Game | null): string => {
  if (g === null) {
    return 'No game running. /dlgame higher or /dlgame memory starts one.'
  }

  if (g.kind === 'hl') {
    const was = g.prev === null ? '' : ` (last card ${cardName(g.prev)}: ${g.last === 'win' ? 'right' : g.last === 'lose' ? 'wrong' : 'same, no change'})`

    return `Higher or lower: card ${cardName(g.card)}, streak ${g.streak}, best ${g.best}${was}.`
  }
  const rows = [0, 3, 6].map(r => [0, 1, 2].map(c => memFace(g, r + c)).join(' '))

  return [`Memory: ${plural(g.moves, 'move')}${g.best > 0 ? `, best ${g.best}` : ''}${g.done ? ', solved!' : ''}`, ...rows.map(r => `  ${r}`)].join('\n')
}

// -------------------------------------------------------------- misc cleaners

export type Flags = { track: boolean; kind: boolean; type: boolean; audit: boolean }

export const cleanFlags = (raw: unknown): Flags => {
  const r = isObj(raw) ? raw : {}

  return { track: r.track === true, kind: r.kind === true, type: r.type === true, audit: r.audit === true }
}

export const cleanCards = (raw: unknown): Record<string, CardSnap> => {
  const out: Record<string, CardSnap> = {}

  if (isObj(raw)) {
    for (const t of POSTCARDS) {
      const c = raw[String(t)]

      if (isObj(c)) {
        out[String(t)] = { tools: num(c.tools), days: num(c.days), top: str(c.top).slice(0, 80), date: str(c.date).slice(0, 10) }
      }
    }
  }

  return out
}

export const helpWords = (name: string) => name.replace(/^\//, '')
