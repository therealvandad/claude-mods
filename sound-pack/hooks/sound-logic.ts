// Pure helpers for the sound-pack mod: no engine calls, so they are easy to test.

export const PACKS = ['retro', 'wood', 'glass', 'silent'] as const
export type Pack = (typeof PACKS)[number]
export type Choice = 'off' | Pack
export type Kind = 'done' | 'error' | 'ask' | 'tick'

export type Settings = {
  pack: Choice
  ticks: boolean
  speak: boolean
  quiet: string | null
}

export const DEFAULTS: Settings = { pack: 'off', ticks: false, speak: false, quiet: null }

/** Turns shorter than this get no finish chime (instant replies stay quiet). */
export const CHIME_MIN_MS = 5_000
/** Turns at least this long get the full-volume chime. */
export const CHIME_FULL_MS = 180_000
export const GAIN_MIN = 0.3
export const GAIN_MAX = 1
/** A spoken summary follows turns longer than this. */
export const SPEAK_MIN_MS = 30_000
/** At most one tick per this many milliseconds. */
export const TICK_GAP_MS = 400
/** Approval cues closer together than this count as one ask. */
export const ASK_GAP_MS = 1_500

export const isChoice = (value: unknown): value is Choice =>
  value === 'off' || (typeof value === 'string' && (PACKS as readonly string[]).includes(value))

/** Reads stored settings of any shape back into a valid Settings. */
export const normalizeSettings = (raw: unknown): Settings => {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const quiet = typeof r.quiet === 'string' && parseQuiet(r.quiet) !== undefined ? r.quiet : null

  return {
    pack: isChoice(r.pack) ? r.pack : DEFAULTS.pack,
    ticks: r.ticks === true,
    speak: r.speak === true,
    quiet,
  }
}

export type QuietRange = { start: number; end: number }

const CLOCK = /^(\d{1,2}):(\d{2})$/

const minutesOf = (text: string): number | undefined => {
  const m = CLOCK.exec(text.trim())
  if (m === null) return undefined
  const h = Number(m[1])
  const min = Number(m[2])

  return h <= 23 && min <= 59 ? h * 60 + min : undefined
}

/** "22:00-07:00" -> minutes after midnight, or undefined when malformed or empty. */
export const parseQuiet = (text: string): QuietRange | undefined => {
  const [from, to, extra] = text.split('-')
  if (from === undefined || to === undefined || extra !== undefined) return undefined
  const start = minutesOf(from)
  const end = minutesOf(to)

  return start === undefined || end === undefined || start === end ? undefined : { start, end }
}

const pad = (n: number) => String(n).padStart(2, '0')
const clockText = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

/** The canonical text of a range, so "7:00-22:00" is stored as "07:00-22:00". */
export const formatQuiet = (range: QuietRange): string => `${clockText(range.start)}-${clockText(range.end)}`

/** Local minutes after midnight for an epoch-millisecond reading of the clock. */
export const minutesOfDay = (epochMs: number): number => {
  const d = new Date(epochMs)

  return d.getHours() * 60 + d.getMinutes()
}

/** True when `minutes` falls in the range; a range may wrap past midnight. */
export const isQuiet = (range: QuietRange | undefined, minutes: number): boolean => {
  if (range === undefined) return false

  return range.start < range.end
    ? minutes >= range.start && minutes < range.end
    : minutes >= range.start || minutes < range.end
}

/** Quiet check straight from settings and a clock reading. */
export const isQuietAt = (settings: Settings, epochMs: number): boolean =>
  settings.quiet === null ? false : isQuiet(parseQuiet(settings.quiet), minutesOfDay(epochMs))

/** Chime gain: 0.3 for short turns, rising linearly to 1.0 at three minutes. */
export const gainForDuration = (ms: number): number => {
  if (!Number.isFinite(ms) || ms <= CHIME_MIN_MS) return GAIN_MIN
  if (ms >= CHIME_FULL_MS) return GAIN_MAX
  const t = (ms - CHIME_MIN_MS) / (CHIME_FULL_MS - CHIME_MIN_MS)

  return Math.round((GAIN_MIN + (GAIN_MAX - GAIN_MIN) * t) * 100) / 100
}

/** True when enough time has passed since the last tick (or there was none). */
export const isTickDue = (lastTickAt: number, now: number): boolean => lastTickAt <= 0 || now - lastTickAt >= TICK_GAP_MS

/** The clip a pack uses for an event; `off` and `silent` have none. */
export const clipFor = (pack: Choice, kind: Kind): string | undefined =>
  pack === 'off' || pack === 'silent' ? undefined : `sounds/${pack}/${kind}.wav`

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** "Done in 42 seconds, 3 files changed": plain text for the synthesizer. */
export const summaryText = (ms: number, files: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  const took =
    minutes === 0 ? plural(total, 'second') : seconds === 0 ? plural(minutes, 'minute') : `${plural(minutes, 'minute')} ${plural(seconds, 'second')}`

  return files > 0 ? `Done in ${took}, ${plural(files, 'file')} changed` : `Done in ${took}`
}

export type Action =
  | { type: 'list' }
  | { type: 'pack'; pack: Choice }
  | { type: 'ticks'; on: boolean }
  | { type: 'speak'; on: boolean }
  | { type: 'quiet'; range: QuietRange | null }
  | { type: 'error'; message: string }

const onOff = (word: string | undefined): boolean | undefined =>
  word === 'on' ? true : word === 'off' ? false : undefined

/** Parses the text after `/sound`. */
export const parseAction = (args: string): Action => {
  const [head, ...rest] = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (head === undefined) return { type: 'list' }
  if (isChoice(head) && rest.length === 0) return { type: 'pack', pack: head }
  if (head === 'ticks' || head === 'speak') {
    const on = onOff(rest[0])

    return on === undefined ? { type: 'error', message: `Use /sound ${head} on or /sound ${head} off.` } : { type: head, on }
  }
  if (head === 'quiet') {
    if (rest[0] === 'off' || rest[0] === 'none') return { type: 'quiet', range: null }
    const range = parseQuiet(rest.join(''))

    return range === undefined
      ? { type: 'error', message: 'Use /sound quiet 22:00-07:00 (24-hour, local time, start and end must differ) or /sound quiet off.' }
      : { type: 'quiet', range }
  }

  return { type: 'error', message: `Unknown option "${head}". Packs: off, ${PACKS.join(', ')}. Also: ticks, speak, quiet.` }
}
