// The other pictures of the bar: the second strip of figures, the one-line slim strip and the warning card.
// Pure drawing, no `$`. Drawn at the width they are shown; nothing under 10px; no animation here.

import type { Chip } from './bar'
import { clamp, esc, f, FONT, short, themeCss, tintOf } from './hud'
import type { HudTheme, HudTone } from './hud'

export const CHIP_ROW_H = 44
export const SLIM_H = 28
export const CARD_H = 36

export type Placed = { chip: Chip; col: number; row: number; span: number }

export const gridColumns = (width: number): number => (width >= 360 ? 4 : 3)

/** Places chips left to right in priority order; what does not fit in `maxRows` is left out. */
export const layoutChips = (chips: readonly Chip[], width: number, maxRows: number): { placed: Placed[]; rows: number } => {
  const columns = gridColumns(width)
  const placed: Placed[] = []
  let row = 0
  let col = 0

  for (const chip of chips) {
    const span = chip.isWide === true ? 2 : 1
    let r = row
    let c = col

    if (c + span > columns) {
      r += 1
      c = 0
    }

    if (r >= maxRows) {
      continue
    }
    placed.push({ chip, col: c, row: r, span })
    row = r
    col = c + span
  }

  return { placed, rows: placed.length === 0 ? 0 : Math.max(...placed.map(p => p.row)) + 1 }
}

const TONE = { ok: 'var(--live)', warn: 'var(--warn1)', bad: 'var(--bad1)', mut: 'var(--mut)' } as const

const iconPath = (tool: string): string => {
  if (tool === 'Read') {
    return 'M4 4.5h6M4 7h6M4 9.5h4'
  }

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    return 'M4 10l.5-2.2L9.2 3.1l1.7 1.7-4.7 4.7z'
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    return 'M3.5 4.5L6.5 7 3.5 9.5M7.5 10h3.5'
  }

  if (tool === 'Grep' || tool === 'Glob' || tool === 'ToolSearch') {
    return 'M8.6 8.6L11 11M9.3 6.2a3.1 3.1 0 1 1-6.2 0 3.1 3.1 0 0 1 6.2 0z'
  }

  if (tool === 'WebFetch' || tool === 'WebSearch') {
    return 'M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM3 7h8M7 3c-2 2.5-2 5.5 0 8 2-2.5 2-5.5 0-8'
  }

  if (tool === 'Agent' || tool === 'Task') {
    return 'M5 5.5h.1M9 5.5h.1M4.5 9c1.5 1.6 3.500 1.6 5 0'
  }

  return 'M5 5h4v4H5z'
}

const trailIcons = (x: number, y: number, trail: NonNullable<Chip['trail']>) =>
  trail
    .slice(-5)
    .map(
      (t, i) =>
        `<g transform="translate(${f(x + i * 17)} ${y})"><title>${esc(short(t.tool, 24))}${t.isOk ? '' : ' failed'}</title><rect width="14" height="14" rx="4" style="fill:${t.isOk ? 'var(--ok1)' : 'var(--bad2)'}"/><path d="${iconPath(t.tool)}" fill="none" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></g>`,
    )
    .join('')

const sparkPath = (x: number, y: number, w: number, h: number, values: readonly number[]) => {
  const v = values.slice(-16).map(n => clamp(n, 0, 1_000_000))

  if (v.length < 2) {
    return ''
  }
  const hi = Math.max(1, ...v)
  const pts = v.map((n, i) => `${f(x + (i / (v.length - 1)) * w)} ${f(y + h - (n / hi) * h)}`)

  return `<path d="M${pts.join(' L')}" fill="none" stroke="url(#spark)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
}

const chipBody = (p: Placed, cellW: number): string => {
  const { chip } = p
  const x = f(p.col * cellW + 11)
  const y = p.row * CHIP_ROW_H + 3
  const room = p.span * cellW - 18
  const hasDot = chip.hue !== undefined || chip.id === 'build' || chip.id === 'testresult'
  const dot = hasDot
    ? `<circle cx="${f(p.col * cellW + 15)}" cy="${y + 28}" r="4.5" style="fill:${chip.hue !== undefined ? `hsl(${Math.round(clamp(chip.hue, 0, 359))},70%,55%)` : TONE[chip.tone ?? 'mut']}"/>`
    : ''
  const valueX = hasDot ? f(p.col * cellW + 24) : x
  const chars = Math.max(3, Math.floor((room - (hasDot ? 13 : 0)) / 8.6))
  const fillColor = chip.tone === undefined || chip.tone === 'ok' || hasDot ? '' : ` style="fill:${TONE[chip.tone]}"`
  const body =
    chip.trail !== undefined
      ? trailIcons(p.col * cellW + 11, y + 21, chip.trail)
      : chip.spark !== undefined
        ? sparkPath(p.col * cellW + 11, y + 21, room - 4, 14, chip.spark)
        : `${dot}<text x="${valueX}" y="${y + 33}" class="v"${fillColor}>${esc(short(chip.value, chars))}</text>`
  const meter =
    chip.fill === undefined
      ? ''
      : `<rect x="${x}" y="${y + 38}" width="${f(room - 4)}" height="3" rx="1.5" class="trk"/><rect x="${x}" y="${y + 38}" width="${f((room - 4) * clamp(chip.fill, 0, 1))}" height="3" rx="1.5" style="fill:${TONE[chip.tone ?? 'ok']}"/>`

  return `<g><title>${esc(`${chip.label}: ${chip.value}`)}</title><text x="${x}" y="${y + 15}" class="l">${esc(short(chip.label.toUpperCase(), Math.max(4, Math.floor(room / 7.4))))}</text>${body}${meter}</g>`
}

export type LookOptions = { width: number; theme: HudTheme; hour?: number }

const shell = (width: number, height: number, look: LookOptions, css: string, body: string, defs = '') => {
  const card = `x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${height < 40 ? 11 : 14}"`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--top)"/><stop offset="1" style="stop-color:var(--bottom)"/></linearGradient>${defs}</defs>
<style>${themeCss(look.theme)}
text{font-family:${FONT};fill:var(--text);font-variant-numeric:tabular-nums}
${css}</style>
<rect ${card} fill="url(#bg)"/>${look.hour === undefined ? '' : `<rect ${card} fill="${tintOf(look.hour)}" opacity="0.11"/>`}
<rect ${card} fill="none" style="stroke:var(--track)" stroke-width="1"/>
${body}
</svg>`
}

/** The second strip: a grid of small labelled figures. Empty string when nothing can be shown. */
export const chipsSvg = (chips: readonly Chip[], look: LookOptions, maxRows: number): { source: string; height: number; shown: Chip[] } => {
  const { placed, rows } = layoutChips(chips, look.width, maxRows)

  if (rows === 0) {
    return { source: '', height: 0, shown: [] }
  }
  const height = rows * CHIP_ROW_H + 6
  const cellW = look.width / gridColumns(look.width)
  const lines = Array.from({ length: rows - 1 }, (_, i) => `<line x1="14" y1="${(i + 1) * CHIP_ROW_H + 3}" x2="${look.width - 14}" y2="${(i + 1) * CHIP_ROW_H + 3}" style="stroke:var(--hair)"/>`).join('')
  const css = `.l{font-size:10px;font-weight:700;letter-spacing:.07em;fill:var(--mut)}
.v{font-size:16px;font-weight:800;letter-spacing:-.01em}
.trk{fill:var(--track)}`
  const defs = '<linearGradient id="spark" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="400" y2="0"><stop offset="0" style="stop-color:var(--e1)"/><stop offset="1" style="stop-color:var(--e2)"/></linearGradient>'

  return {
    source: shell(look.width, height, look, css, lines + placed.map(p => chipBody(p, cellW)).join(''), defs),
    height,
    shown: placed.map(p => p.chip),
  }
}

export const chipsAlt = (chips: readonly Chip[]): string => chips.map(c => `${c.label} ${c.value}`.trim()).join(', ')

export type SlimData = {
  contextPct: number | null
  limitPct: number | null
  limitName: string
  spendUsd: string
  word: string
  tone: HudTone
}

const SLIM_DOT: Partial<Record<HudTone, string>> = {
  live: 'var(--live)',
  amber: 'var(--warn1)',
  red: 'var(--bad1)',
  idle: 'var(--mut)',
}

/** Segments in priority order; the last ones are dropped when the line is too narrow. */
export const slimSegments = (d: SlimData, width: number): string[] => {
  const all = [
    d.word,
    d.contextPct === null ? '' : `context ${Math.round(clamp(d.contextPct, 0, 100))}%`,
    d.limitPct === null ? '' : `${d.limitName} ${Math.round(clamp(d.limitPct, 0, 100))}%`,
    d.spendUsd,
  ].filter(s => s !== '')
  const max = Math.floor((width - 36) / 7.1)

  while (all.length > 1 && all.join('     ').length > max) {
    all.pop()
  }

  return all
}

export const slimSvg = (d: SlimData, look: LookOptions): string => {
  const [word = '', ...rest] = slimSegments(d, look.width)
  const css = `.s{font-size:13px;font-weight:600}.w{font-weight:800}.d{fill:var(--mut)}`
  const body = `<circle cx="15" cy="14" r="4.5" style="fill:${SLIM_DOT[d.tone] ?? 'var(--live)'}"/><text x="25" y="18.5" class="s"><tspan class="w">${esc(short(word, 24))}</tspan>${rest.map(s => `<tspan class="d" dx="9">·</tspan><tspan dx="9">${esc(s)}</tspan>`).join('')}</text>`

  return shell(look.width, SLIM_H, look, css, body)
}

/** The card that appears when something needs the person. */
export const cardSvg = (a: { tone: 'warn' | 'bad'; title: string; detail: string }, look: LookOptions): string => {
  const color = a.tone === 'bad' ? 'var(--bad1)' : 'var(--warn1)'
  const css = `.t{font-size:13px;font-weight:800}.d{font-size:11px;fill:var(--mut)}`
  const body = `<rect x="9" y="8" width="4" height="${CARD_H - 16}" rx="2" style="fill:${color}"/><text x="21" y="16" class="t">${esc(short(a.title, Math.floor((look.width - 34) / 7.6)))}</text><text x="21" y="29" class="d">${esc(short(a.detail, Math.floor((look.width - 34) / 6)))}</text>`

  return shell(look.width, CARD_H, look, css, body)
}
