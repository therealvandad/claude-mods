// Shared drawing helpers for the text charts. Everything here is a pure function:
// a chart is a list of Rows, a Row is a list of Segs (text plus an optional theme colour).

export type Density = 'compact' | 'normal' | 'airy'
export type Icons = 'letters' | 'symbols' | 'minimal'

/** One run of text. c is a theme colour key, d dims it, b makes it bold. */
export type Seg = { t: string; c?: string; d?: boolean; b?: boolean }
export type Row = Seg[]

/** What every renderer is told: the width it may use, the accent, the spacing, the glyph style and "now". */
export type Opts = { width: number; accent: string; density: Density; icons: Icons; now: number }

/** The glyphs of one style. ramp has 5 levels (none to full); spark has 8. */
export type Pack = {
  full: string
  empty: string
  ramp: readonly [string, string, string, string, string]
  spark: string
  on: string
  off: string
  tl: string
  tr: string
  bl: string
  br: string
  hOn: string
  hOff: string
  vOn: string
  vOff: string
  ascii: boolean
  err: string
  edit: string
  prompt: string
  tool: string
  fills: readonly [string, string, string, string]
}

export const PACKS: Readonly<Record<Icons, Pack>> = {
  symbols: {
    full: '█',
    empty: '░',
    ramp: ['·', '░', '▒', '▓', '█'],
    spark: '▁▂▃▄▅▆▇█',
    on: '●',
    off: '○',
    tl: '◜',
    tr: '◝',
    bl: '◟',
    br: '◞',
    hOn: '━',
    hOff: '─',
    vOn: '┃',
    vOff: '│',
    ascii: false,
    err: '✗',
    edit: '◆',
    prompt: '▸',
    tool: '·',
    fills: ['█', '▓', '▒', '░'],
  },
  letters: {
    full: '#',
    empty: '.',
    ramp: [' ', '.', ':', '*', '#'],
    spark: '_.,:-=+#',
    on: '*',
    off: 'o',
    tl: '+',
    tr: '+',
    bl: '+',
    br: '+',
    hOn: '=',
    hOff: '-',
    vOn: '#',
    vOff: '|',
    ascii: true,
    err: 'x',
    edit: 'e',
    prompt: '>',
    tool: '.',
    fills: ['#', '%', '=', '-'],
  },
  minimal: {
    full: '■',
    empty: '·',
    ramp: [' ', '·', '▪', '■', '█'],
    spark: '▁▂▃▄▅▆▇█',
    on: '■',
    off: '□',
    tl: '╭',
    tr: '╮',
    bl: '╰',
    br: '╯',
    hOn: '━',
    hOff: '┄',
    vOn: '┃',
    vOff: '┆',
    ascii: false,
    err: '×',
    edit: '+',
    prompt: '›',
    tool: '·',
    fills: ['■', '▪', '▫', '·'],
  },
}

export const packOf = (o: Opts): Pack => PACKS[o.icons] ?? PACKS.symbols

// ---------------------------------------------------------------- small helpers

export const seg = (t: string, c?: string, d?: boolean, b?: boolean): Seg => {
  const s: Seg = { t }

  if (c !== undefined) {
    s.c = c
  }

  if (d === true) {
    s.d = true
  }

  if (b === true) {
    s.b = true
  }

  return s
}

export const dim = (t: string): Seg => seg(t, undefined, true)

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export const p2 = (n: number): string => String(n).padStart(2, '0')

export const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))

export const padL = (s: string, n: number): string => (s.length >= n ? s.slice(-n) : ' '.repeat(n - s.length) + s)

export const trunc = (s: string, n: number): string => (s.length <= n ? s : n <= 1 ? s.slice(0, Math.max(0, n)) : `${s.slice(0, n - 1)}…`)

export const centre = (s: string, n: number): string => {
  const t = s.length > n ? s.slice(0, n) : s
  const left = Math.floor((n - t.length) / 2)

  return ' '.repeat(left) + t + ' '.repeat(n - t.length - left)
}

export const widthOf = (r: Row): number => r.reduce((n, s) => n + s.t.length, 0)

export const plain = (rows: readonly Row[]): string[] => rows.map(r => r.map(s => s.t).join(''))

export const text = (rows: readonly Row[]): string => plain(rows).join('\n')

export const base = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

export const dur = (ms: number): string => {
  const v = Math.max(0, ms)

  if (v < 1000) {
    return `${Math.round(v)}ms`
  }

  if (v < 60_000) {
    return `${(v / 1000).toFixed(1)}s`
  }

  return `${Math.floor(v / 60_000)}m${p2(Math.round((v % 60_000) / 1000) % 60)}s`
}

export const hhmm = (ms: number): string => {
  const d = new Date(ms)

  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export const hms = (ms: number): string => {
  const d = new Date(ms)

  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

/** Clock label for an axis: seconds too when the window is short. */
export const axisTime = (ms: number, span: number): string => (span < 600_000 ? hms(ms) : hhmm(ms))

export const usd = (v: number): string => `$${v.toFixed(2)}`

export const size = (n: number): string => (n < 1000 ? String(Math.round(n)) : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`)

/** A colour for each rank: the accent first, then the other theme colours in a fixed order. */
const CYCLE = ['suggestion', 'success', 'warning', 'claude', 'permission', 'remember']

export const toneAt = (accent: string, i: number): string => {
  const list = [accent, ...CYCLE.filter(t => t !== accent)]

  return list[((i % list.length) + list.length) % list.length] ?? accent
}

/** Accent normally, warning from 70 percent, error from 85. */
export const heat = (percent: number, accent: string): string => (percent >= 85 ? 'error' : percent >= 70 ? 'warning' : accent)

export const gapOf = (o: Opts): number => (o.density === 'compact' ? 1 : o.density === 'airy' ? 4 : 2)

export const blank = (o: Opts): Row[] => (o.density === 'airy' ? [[seg('')]] : [])

export const note = (t: string): Row => [dim(t)]

/** Dim text broken into rows of at most width characters, at word boundaries. */
export const wrap = (t: string, width: number): Row[] => {
  const rows: Row[] = []
  let cur = ''

  for (const w of t.split(/\s+/).filter(Boolean)) {
    if (cur !== '' && cur.length + 1 + w.length > width) {
      rows.push([dim(cur)])
      cur = w
    } else {
      cur = cur === '' ? w : `${cur} ${w}`
    }
  }

  if (cur !== '') {
    rows.push([dim(cur)])
  }

  return rows
}

/**
 * Whole numbers that follow the weights and add up to total (largest remainder),
 * so a bar or a waffle is always exactly full.
 */
export const apportion = (weights: readonly number[], total: number): number[] => {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0)

  if (sum <= 0 || total <= 0) {
    return weights.map(() => 0)
  }
  const raw = weights.map(w => (Math.max(0, w) / sum) * total)
  const out = raw.map(r => Math.floor(r))
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i)

  for (const { i } of order) {
    if (left <= 0) {
      break
    }
    out[i] = (out[i] ?? 0) + 1
    left -= 1
  }

  return out
}

/** Like apportion, but every part gets at least min (when the total allows it). */
export const apportionMin = (weights: readonly number[], total: number, min: number): number[] => {
  const n = weights.length

  if (n === 0) {
    return []
  }

  if (total < min * n) {
    return apportion(weights.map(() => 1), total)
  }
  const extra = apportion(weights, total - min * n)

  return extra.map(x => x + min)
}

/** Joins blocks of rows left to right, padding each to its own width plus a gap. */
export const sideBySide = (blocks: readonly (readonly Row[])[], gap: number): Row[] => {
  const h = Math.max(0, ...blocks.map(b => b.length))
  const widths = blocks.map(b => Math.max(0, ...b.map(widthOf)))
  const out: Row[] = []

  for (let y = 0; y < h; y += 1) {
    const row: Row = []

    blocks.forEach((b, i) => {
      const r = b[y] ?? []
      row.push(...r)
      const fill = (widths[i] ?? 0) - widthOf(r) + (i < blocks.length - 1 ? gap : 0)

      if (fill > 0) {
        row.push(seg(' '.repeat(fill)))
      }
    })
    out.push(row)
  }

  return out
}

/** Merges neighbouring segs that look the same, so a row is a few runs rather than one per cell. */
export const merge = (segs: readonly Seg[]): Row => {
  const out: Seg[] = []

  for (const s of segs) {
    const last = out[out.length - 1]

    if (last !== undefined && last.c === s.c && last.d === s.d && last.b === s.b) {
      last.t += s.t
    } else {
      out.push({ ...s })
    }
  }

  return out
}

export const sparkOf = (values: readonly number[], spark: string): string => {
  if (values.length === 0) {
    return ''
  }
  const hi = Math.max(...values)
  const top = spark.length - 1

  if (hi <= 0) {
    return (spark[0] ?? '_').repeat(values.length)
  }

  return values.map(v => spark.charAt(clamp(Math.round((Math.max(0, v) / hi) * top), 0, top))).join('')
}

/** 0 for nothing, then 1 to 4 by share of the maximum. */
export const levelOf = (v: number, max: number): number => (v <= 0 || max <= 0 ? 0 : clamp(Math.ceil((v / max) * 4), 1, 4))

// ---------------------------------------------------------------- dates (local time)

export const dayKey = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

export const startOfDay = (ms: number): number => {
  const d = new Date(ms)

  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export const addDays = (ms: number, n: number): number => {
  const d = new Date(ms)

  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

/** Monday is 0. */
export const weekday = (ms: number): number => (new Date(ms).getDay() + 6) % 7

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export const monthName = (ms: number): string => MONTHS[new Date(ms).getMonth()] ?? ''

// ---------------------------------------------------------------- the ring

export type RingCell = { x: number; y: number; k: 'tl' | 'tr' | 'bl' | 'br' | 'h' | 'v' }

export const RING_W = 9
export const RING_H = 5

/** The 24 cells of a 9x5 outline, clockwise from the top middle: hour 0 on top, 6 right, 12 bottom, 18 left. */
export const perimeter = (): RingCell[] => {
  const out: RingCell[] = []
  const top = (x: number): RingCell['k'] => (x === 0 ? 'tl' : x === RING_W - 1 ? 'tr' : 'h')

  for (let x = 4; x < RING_W; x += 1) {
    out.push({ x, y: 0, k: top(x) })
  }

  for (let y = 1; y <= RING_H - 2; y += 1) {
    out.push({ x: RING_W - 1, y, k: 'v' })
  }

  for (let x = RING_W - 1; x >= 0; x -= 1) {
    out.push({ x, y: RING_H - 1, k: x === 0 ? 'bl' : x === RING_W - 1 ? 'br' : 'h' })
  }

  for (let y = RING_H - 2; y >= 1; y -= 1) {
    out.push({ x: 0, y, k: 'v' })
  }

  for (let x = 0; x < 4; x += 1) {
    out.push({ x, y: 0, k: top(x) })
  }

  return out
}

export const RING_CELLS = 24

/** Lays 24 cell segs round the outline and three 7-wide inner lines inside it. */
export const ringRows = (cells: readonly Seg[], inner: readonly (readonly Seg[])[]): Row[] => {
  const at = new Map<string, Seg>()

  perimeter().forEach((c, i) => {
    at.set(`${c.x},${c.y}`, cells[i] ?? dim(' '))
  })
  const rows: Row[] = []

  for (let y = 0; y < RING_H; y += 1) {
    const row: Seg[] = []

    if (y === 0 || y === RING_H - 1) {
      for (let x = 0; x < RING_W; x += 1) {
        row.push(at.get(`${x},${y}`) ?? dim(' '))
      }
    } else {
      row.push(at.get(`0,${y}`) ?? dim(' '))
      row.push(...(inner[y - 1] ?? [dim(' '.repeat(RING_W - 2))]))
      row.push(at.get(`${RING_W - 1},${y}`) ?? dim(' '))
    }
    rows.push(merge(row))
  }

  return rows
}

/** The ring glyph for one cell, on or off. */
export const ringGlyph = (k: RingCell['k'], on: boolean, pk: Pack): string =>
  k === 'tl' ? pk.tl : k === 'tr' ? pk.tr : k === 'bl' ? pk.bl : k === 'br' ? pk.br : k === 'h' ? (on ? pk.hOn : pk.hOff) : on ? pk.vOn : pk.vOff

// ---------------------------------------------------------------- box drawing by connections

export const N = 1
export const E = 2
export const S = 4
export const W = 8

const BOX: Readonly<Record<number, string>> = {
  0: ' ',
  1: '╵',
  2: '╶',
  3: '└',
  4: '╷',
  5: '│',
  6: '┌',
  7: '├',
  8: '╴',
  9: '┘',
  10: '─',
  11: '┴',
  12: '┐',
  13: '┤',
  14: '┬',
  15: '┼',
}

/** The glyph for a cell whose lines run in the directions of mask (N, E, S, W bits). */
export const boxGlyph = (mask: number, ascii: boolean): string => {
  if (!ascii) {
    return BOX[mask] ?? ' '
  }
  const v = (mask & (N | S)) !== 0
  const h = (mask & (E | W)) !== 0

  return v && h ? '+' : v ? '|' : h ? '-' : ' '
}

// ---------------------------------------------------------------- braille

const BRAILLE_BITS: readonly (readonly number[])[] = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

/** The braille character for a dot set: dots are [column 0-1, row 0-3] pairs. */
export const brailleOf = (dots: readonly (readonly [number, number])[]): string => {
  let bits = 0

  for (const [x, y] of dots) {
    bits |= BRAILLE_BITS[x]?.[y] ?? 0
  }

  return String.fromCharCode(0x2800 + bits)
}
