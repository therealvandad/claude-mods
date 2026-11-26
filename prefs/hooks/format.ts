// Pure formatting helpers that follow the preferences. No engine, no disk, no clock: every function takes the time or the
// context it needs, so each one is deterministic and tested. A mod that wants the same behaviour copies the function it
// needs (mods cannot import each other's code); the README says which atoms to read to build a context.
import { valueOf } from './prefs'
import type { Over } from './prefs'

export type DateStyle = 'iso' | 'dmy' | 'mdy'
export type PathStyle = 'short' | 'mid' | 'full'
export type WeekStart = 'mon' | 'sun' | 'sat'

export type FmtCtx = {
  /** money symbol token: usd eur gbp jpy chf none */
  symbol: string
  cents: boolean
  /** multiplier applied to a US-dollar amount */
  rate: number
  hours: 12 | 24
  date: DateStyle
  /** the decimal and the group separator as characters ('' = none) */
  dec: string
  grp: string
  short: boolean
  tilesCompact: boolean
  binary: boolean
  trunc: number
  path: PathStyle
  /** minutes east of UTC for the time zone to show */
  tzMin: number
  weekStart: WeekStart
}

export const SYMBOLS: Readonly<Record<string, string>> = { usd: '$', eur: '€', gbp: '£', jpy: '¥', chf: 'CHF', none: '' }
export const DEC_CHARS: Readonly<Record<string, string>> = { dot: '.', comma: ',' }
export const GRP_CHARS: Readonly<Record<string, string>> = { comma: ',', dot: '.', space: ' ', none: '' }

export const DEFAULT_CTX: FmtCtx = {
  symbol: 'usd', cents: true, rate: 1, hours: 24, date: 'iso', dec: '.', grp: ',', short: false, tilesCompact: false, binary: false, trunc: 60, path: 'mid', tzMin: 0, weekStart: 'mon',
}

// ------------------------------------------------------------------ time zone

/** Minutes east of UTC that the device uses at this moment (what `Date` says). */
export const deviceOffsetMin = (ms: number): number => (Number.isFinite(ms) ? -new Date(ms).getTimezoneOffset() || 0 : 0)

/** The zone to show at `ms`: the fixed offset, or the device's. */
export const zoneOffsetFor = (over: Over, ms: number): number =>
  valueOf(over, 'tz.mode') === 'fixed' ? Number(valueOf(over, 'tz.offset')) : deviceOffsetMin(ms)

/** Build a context from the overrides (anything not overridden takes its default). `ms` picks the device zone offset. */
export const ctxFrom = (over: Over, ms: number): FmtCtx => {
  const dec = DEC_CHARS[String(valueOf(over, 'num.decimal'))] ?? '.'
  const grp = GRP_CHARS[String(valueOf(over, 'num.group'))] ?? ','

  return {
    symbol: String(valueOf(over, 'money.symbol')),
    cents: valueOf(over, 'money.cents') === true,
    rate: Number(valueOf(over, 'money.rate')),
    hours: valueOf(over, 'time.hours') === '12h' ? 12 : 24,
    date: valueOf(over, 'date.format') as DateStyle,
    dec,
    grp: grp === dec ? '' : grp,
    short: valueOf(over, 'num.short') === true,
    tilesCompact: valueOf(over, 'tiles.compact') === true,
    binary: valueOf(over, 'size.units') === 'KiB',
    trunc: Number(valueOf(over, 'trunc.len')),
    path: valueOf(over, 'path.style') as PathStyle,
    tzMin: zoneOffsetFor(over, ms),
    weekStart: valueOf(over, 'week.start') as WeekStart,
  }
}

/** `UTC`, `UTC+01:00`, `UTC-05:30`. */
export const zoneLabel = (tzMin: number): string => {
  const m = Math.round(Number.isFinite(tzMin) ? tzMin : 0)

  if (m === 0) {
    return 'UTC'
  }
  const a = Math.abs(m)

  return `UTC${m < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
}

// ------------------------------------------------------------------ numbers

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

const groupInt = (digits: string, sep: string): string => (sep === '' ? digits : digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep))

/** Round half away from zero at `d` decimals, absorbing binary noise (1.005 -> 1.01). Returns the scaled integer. */
const scaledRound = (abs: number, d: number): number => Math.round(abs * 10 ** d * (1 + Number.EPSILON))

const NONE = '–'

/** 1234567.891 -> "1,234,567.89" (decimals 2). Separators come from the context. Not finite -> an en dash. */
export const formatNumber = (n: number, ctx: FmtCtx, decimals = 0): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return NONE
  }
  let d = Math.min(10, Math.max(0, Math.floor(Number.isFinite(decimals) ? decimals : 0)))
  const abs = Math.abs(n)
  const dec = ctx.dec === '' ? '.' : ctx.dec
  const grp = ctx.grp === dec ? '' : ctx.grp

  while (d > 0 && abs * 10 ** d > 9e15) {
    d--
  }

  if (abs >= 1e15) {
    return `${n < 0 ? '-' : ''}${abs.toExponential(2).replace('.', dec)}`
  }
  const scaled = scaledRound(abs, d)
  const digits = String(scaled).padStart(d + 1, '0')
  const int = d === 0 ? digits : digits.slice(0, -d)
  const frac = d === 0 ? '' : digits.slice(-d)
  const isZero = scaled === 0

  return `${n < 0 && !isZero ? '-' : ''}${groupInt(int, grp)}${frac === '' ? '' : dec + frac}`
}

const UNITS: readonly (readonly [number, string])[] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
]

const oneDecimal = (v: number, dec: string): string => {
  const r = Math.round(v * 10 * (1 + Number.EPSILON)) / 10

  return Number.isInteger(r) ? String(r) : String(r).replace('.', dec)
}

/** 1234 -> "1.2k", 1250000 -> "1.3M", 999950 -> "1M" (rounding carries up), 12 -> "12". One decimal, no trailing .0. */
export const shortNumber = (n: number, ctx: FmtCtx): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return NONE
  }
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  const dec = ctx.dec === '' ? '.' : ctx.dec

  if (abs < 999.95) {
    const body = oneDecimal(abs, dec)

    return `${body === '0' ? '' : sign}${body}`
  }

  for (let i = 0; i < UNITS.length; i++) {
    const [unit, suffix] = UNITS[i]!

    if (abs >= unit * 0.99995 || i === UNITS.length - 1) {
      let r = Math.round((abs / unit) * 10 * (1 + Number.EPSILON)) / 10

      if (r >= 1000 && i > 0) {
        const [bigger, bigSuffix] = UNITS[i - 1]!
        r = Math.round((abs / bigger) * 10 * (1 + Number.EPSILON)) / 10

        return `${sign}${oneDecimal(r, dec)}${bigSuffix}`
      }

      return `${sign}${oneDecimal(r, dec)}${suffix}`
    }
  }

  return `${sign}${abs}`
}

/** Chooses the short form when the context asks for it (or `force`), else the full number with `decimals`. */
export const formatCount = (n: number, ctx: FmtCtx, opts: { decimals?: number; tile?: boolean } = {}): string =>
  ctx.short || (opts.tile === true && ctx.tilesCompact) ? shortNumber(n, ctx) : formatNumber(n, ctx, opts.decimals ?? 0)

// ------------------------------------------------------------------ money

/** A US-dollar amount shown in the chosen symbol, cents or whole units, converted by the rate. `-$1.50`, `1.234,50 EUR sign`. */
export const formatMoney = (usd: number, ctx: FmtCtx, opts: { tile?: boolean } = {}): string => {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) {
    return NONE
  }
  const rate = Number.isFinite(ctx.rate) && ctx.rate > 0 ? ctx.rate : 1
  const v = usd * rate
  const sym = SYMBOLS[ctx.symbol] ?? '$'
  const gap = /^[A-Za-z]+$/.test(sym) ? ' ' : ''
  const compact = opts.tile === true && ctx.tilesCompact && Math.abs(v) >= 1000
  const body = compact ? shortNumber(Math.abs(v), ctx) : formatNumber(Math.abs(v), ctx, ctx.cents ? 2 : 0)
  const isZero = !/[1-9]/.test(body.replace(/[kMBT]$/, ''))

  return `${v < 0 && !isZero ? '-' : ''}${sym}${gap}${body}`
}

// ------------------------------------------------------------------ time and dates

const shift = (ms: number, tzMin: number): Date => new Date(ms + (Number.isFinite(tzMin) ? tzMin : 0) * 60_000)

const okTime = (ms: number): boolean => typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) < 8.64e15 - 2e9

/** 12h "3:07 PM" / "12:00 AM", or 24h "15:07". In the context's zone. With seconds: "15:07:09". */
export const formatTime = (ms: number, ctx: FmtCtx, withSeconds = false): string => {
  if (!okTime(ms)) {
    return NONE
  }
  const d = shift(ms, ctx.tzMin)
  const h = d.getUTCHours()
  const mm = pad(d.getUTCMinutes())
  const ss = withSeconds ? `:${pad(d.getUTCSeconds())}` : ''

  if (ctx.hours === 24) {
    return `${pad(h)}:${mm}${ss}`
  }

  return `${h % 12 === 0 ? 12 : h % 12}:${mm}${ss} ${h < 12 ? 'AM' : 'PM'}`
}

/** iso 2026-11-25, dmy 25/11/2026, mdy 11/25/2026. */
export const formatDate = (ms: number, ctx: FmtCtx): string => {
  if (!okTime(ms)) {
    return NONE
  }
  const d = shift(ms, ctx.tzMin)
  const y = pad(d.getUTCFullYear(), 4)
  const m = pad(d.getUTCMonth() + 1)
  const day = pad(d.getUTCDate())

  return ctx.date === 'dmy' ? `${day}/${m}/${y}` : ctx.date === 'mdy' ? `${m}/${day}/${y}` : `${y}-${m}-${day}`
}

export const formatDateTime = (ms: number, ctx: FmtCtx): string => (okTime(ms) ? `${formatDate(ms, ctx)} ${formatTime(ms, ctx)}` : NONE)

/** "just now", "5 min ago", "2 h ago", "3 d ago", "2 mo ago", "1 y ago"; the future reads "in 5 min". Floors each unit. */
export const relativeTime = (ms: number, now: number): string => {
  if (!okTime(ms) || !okTime(now)) {
    return NONE
  }
  const diff = Math.floor((now - ms) / 1000)
  const abs = Math.abs(diff)
  const wrap = (s: string) => (diff < 0 ? `in ${s}` : `${s} ago`)

  if (abs < 60) {
    return diff < 0 ? 'in a moment' : 'just now'
  }

  if (abs < 3600) {
    return wrap(`${Math.floor(abs / 60)} min`)
  }

  if (abs < 86_400) {
    return wrap(`${Math.floor(abs / 3600)} h`)
  }

  if (abs < 86_400 * 30) {
    return wrap(`${Math.floor(abs / 86_400)} d`)
  }

  if (abs < 86_400 * 365) {
    return wrap(`${Math.floor(abs / (86_400 * 30))} mo`)
  }

  return wrap(`${Math.floor(abs / (86_400 * 365))} y`)
}

// ------------------------------------------------------------------ weeks

/** 0 = Sunday ... 6 = Saturday, in the zone. */
export const weekdayOf = (ms: number, tzMin: number): number => shift(ms, tzMin).getUTCDay()

export const WEEK_START_INDEX: Readonly<Record<string, number>> = { sun: 0, mon: 1, sat: 6 }
export const DAY_NAMES: Readonly<Record<string, readonly string[]>> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'],
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
}

/** The seven day names, starting at the chosen first day. */
export const weekOrder = (start: WeekStart, lang = 'en'): string[] => {
  const names = DAY_NAMES[lang] ?? DAY_NAMES['en']!
  const s = WEEK_START_INDEX[start] ?? 1

  return Array.from({ length: 7 }, (_, i) => names[(s + i) % 7]!)
}

/** The instant (UTC ms) of local midnight on the first day of the week that holds `ms`. */
export const startOfWeek = (ms: number, tzMin: number, start: WeekStart): number => {
  const off = (Number.isFinite(tzMin) ? tzMin : 0) * 60_000
  const dayStart = Math.floor((ms + off) / 86_400_000) * 86_400_000
  const dow = new Date(dayStart).getUTCDay()
  const back = (dow - (WEEK_START_INDEX[start] ?? 1) + 7) % 7

  return dayStart - back * 86_400_000 - off
}

// ------------------------------------------------------------------ sizes

/** 1536 -> "1.5 KB" (or "1.5 KiB" with binary units). Bytes below one unit stay "812 B". Rounding carries to the next unit. */
export const formatSize = (bytes: number, ctx: FmtCtx): string => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return NONE
  }
  const base = ctx.binary ? 1024 : 1000
  const names = ctx.binary ? ['B', 'KiB', 'MiB', 'GiB', 'TiB'] : ['B', 'KB', 'MB', 'GB', 'TB']
  const dec = ctx.dec === '' ? '.' : ctx.dec

  if (bytes < base) {
    return `${Math.round(bytes)} B`
  }
  let i = 1

  while (i < names.length - 1 && bytes >= base ** (i + 1)) {
    i++
  }
  let r = Math.round((bytes / base ** i) * 10 * (1 + Number.EPSILON)) / 10

  if (r >= base && i < names.length - 1) {
    i++
    r = Math.round((bytes / base ** i) * 10 * (1 + Number.EPSILON)) / 10
  }

  return `${oneDecimal(r, dec)} ${names[i]}`
}

// ------------------------------------------------------------------ text and paths

/** Cut to `len` characters including the ellipsis; counts whole characters (emoji stay whole). */
export const truncate = (text: string, len: number): string => {
  const chars = Array.from(String(text))
  const n = Math.floor(Number.isFinite(len) ? len : 0)

  if (n <= 0) {
    return ''
  }

  if (chars.length <= n) {
    return chars.join('')
  }

  if (n === 1) {
    return '…'
  }

  return `${chars.slice(0, n - 1).join('').trimEnd()}…`
}

/** short = the last segment; mid = first segment, an ellipsis, then the last two; full = all of it. `home` becomes `~`. */
export const displayPath = (path: string, style: PathStyle, home = ''): string => {
  const raw = String(path)

  if (raw === '') {
    return ''
  }
  const sep = raw.includes('/') || !raw.includes('\\') ? '/' : '\\'
  const trimmed = raw.length > 1 ? raw.replace(/[/\\]+$/, '') : raw
  const h = home.length > 1 ? home.replace(/[/\\]+$/, '') : home
  const underHome = h !== '' && (trimmed === h || trimmed.startsWith(h + sep))
  const shown = underHome ? `~${trimmed.slice(h.length)}` : trimmed

  if (style === 'full') {
    return shown
  }
  const parts = shown.split(sep).filter(p => p !== '')
  const last = parts[parts.length - 1]

  if (last === undefined) {
    return shown
  }

  if (style === 'short') {
    return last
  }

  if (parts.length <= 3) {
    return shown
  }
  const lead = shown.startsWith(sep) ? sep + parts[0] : parts[0]

  return `${lead}${sep}…${sep}${parts[parts.length - 2]}${sep}${last}`
}

// ------------------------------------------------------------------ quiet hours

/** "22:00-07:00" -> minutes from midnight, or null for "off" and anything that is not a valid window. */
export const parseQuiet = (spec: string): { from: number; to: number } | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(spec)

  return m === null ? null : { from: Number(m[1]) * 60 + Number(m[2]), to: Number(m[3]) * 60 + Number(m[4]) }
}

export const minutesOfDay = (ms: number, tzMin: number): number => {
  const d = shift(ms, tzMin)

  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** Is `minute` (0-1439) inside the window? A window may wrap midnight; equal ends mean never. */
export const isQuiet = (spec: string, minute: number): boolean => {
  const w = parseQuiet(spec)

  if (w === null || w.from === w.to) {
    return false
  }

  return w.from < w.to ? minute >= w.from && minute < w.to : minute >= w.from || minute < w.to
}
