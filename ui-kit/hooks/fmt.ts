// Small text helpers shared by the text charts and the tests. Pure.

export type Icons = 'letters' | 'symbols' | 'minimal'

export const SPARK = '▁▂▃▄▅▆▇█'
const EIGHTHS = ' ▏▎▍▌▋▊▉█'

export const isIcons = (v: unknown): v is Icons => v === 'letters' || v === 'symbols' || v === 'minimal'

/** One character per outcome, so strips line up in any font. */
export const glyphs = (icons: Icons): { ok: string; err: string; run: string; dot: string } =>
  icons === 'letters'
    ? { ok: 'o', err: 'X', run: '~', dot: '.' }
    : icons === 'minimal'
      ? { ok: '.', err: '!', run: ':', dot: ' ' }
      : { ok: '▪', err: '✗', run: '…', dot: '·' }

export const clampN = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))

export const fit = (s: string, n: number): string => {
  const w = Math.max(1, Math.floor(n))

  return s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}…`
}

export const padEnd = (s: string, n: number): string => fit(s, n).padEnd(n, ' ')
export const padStart = (s: string, n: number): string => fit(s, n).padStart(n, ' ')

/** Keeps spaces from collapsing in a proportional font. */
export const nb = (s: string): string => s.replace(/ /g, '\u00a0')

/** Resamples to `width` columns (the largest value of each bucket) and draws block characters. */
export const spark = (values: readonly number[], width: number, max?: number): string => {
  const w = Math.max(1, Math.floor(width))
  const clean = values.map(v => (Number.isFinite(v) && v > 0 ? v : 0))

  if (clean.length === 0) {
    return ' '.repeat(w)
  }
  const cols: number[] = []

  for (let i = 0; i < w; i++) {
    const from = Math.floor((i * clean.length) / w)
    const to = Math.max(from + 1, Math.floor(((i + 1) * clean.length) / w))
    cols.push(Math.max(...clean.slice(from, to), 0))
  }
  const top = max !== undefined && max > 0 ? max : Math.max(...cols, 0)

  return cols
    .map(v => (top <= 0 || v <= 0 ? SPARK[0]! : SPARK[Math.min(7, Math.max(0, Math.round((v / top) * 7)))]!))
    .join('')
}

/** A horizontal bar of `width` cells for a 0..1 fraction, in eighths of a cell. */
export const bar = (frac: number, width: number): string => {
  const w = Math.max(1, Math.floor(width))
  const eighths = Math.round(clampN(frac, 0, 1) * w * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8

  return ('█'.repeat(full) + (part > 0 ? EIGHTHS[part]! : '')).padEnd(w, ' ')
}

export const baseName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** The last two folders of a path, e.g. `src/ui`. */
export const folderOf = (path: string): string => {
  const parts = path.split('/').filter(Boolean)
  parts.pop()

  return parts.slice(-2).join('/') || '/'
}

export type Breakpoint = 'narrow' | 'medium' | 'wide'

/** Three layouts by the pane's `bodyColumns`. */
export const breakpointOf = (columns: number): Breakpoint => (columns < 60 ? 'narrow' : columns < 100 ? 'medium' : 'wide')

/** Width of the vector drawing, in its own units, for a layout. */
export const svgWidth = (bp: Breakpoint, columns: number, isHalf: boolean): number =>
  isHalf ? 360 : bp === 'narrow' ? 300 : bp === 'medium' ? 480 : clampN(Math.round(columns * 6.6), 600, 760)
