// Pure SVG drawing for the desktop pane. No `$`. Colours follow light and dark through a media query inside the SVG.
import type { Swatch } from './palette'

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const f = (n: number): string => String(Math.round(n * 100) / 100)

const STYLE = `<style>:root{--bg:#f6f5f1;--line:#d6d3ca;--text:#26241f;--mut:#7a766b;--acc:#4b57c9;--dot:#4b57c9}
@media (prefers-color-scheme:dark){:root{--bg:#262522;--line:#443f39;--text:#ece9e2;--mut:#8f8b83;--acc:#a9b4ff;--dot:#a9b4ff}}</style>`

const ACC: Record<string, readonly [string, string]> = {
  suggestion: ['#4b57c9', '#a9b4ff'],
  claude: ['#c4562f', '#e08a68'],
  success: ['#2f8f4e', '#5fbf7a'],
  warning: ['#a8741a', '#f0b94a'],
  permission: ['#4b57c9', '#a9b4ff'],
  remember: ['#7b4bd0', '#b08cff'],
}

const accentStyle = (accent: string): string => {
  const [l, d] = ACC[accent] ?? ACC.suggestion!

  return `<style>:root{--bg:#f6f5f1;--line:#d6d3ca;--text:#26241f;--mut:#7a766b;--acc:${l}}
@media (prefers-color-scheme:dark){:root{--bg:#262522;--line:#443f39;--text:#ece9e2;--mut:#8f8b83;--acc:${d}}}</style>`
}

export type CurveDraw = { name: string; values: readonly number[]; line: readonly number[]; progress: number; accent: string; isAnimated: boolean }

/**
 * The easing plot: a smooth line through 60 points, the 12 preview dots on it (each with a hover title), and a ball on a
 * track below at `progress` (0 to 1). When `isAnimated` the line draws itself once; the still twin has no animation.
 */
export const curveSvg = (d: CurveDraw): string => {
  const W = 360
  const H = 190
  const x0 = 34
  const x1 = W - 14
  const yTop = 18
  const yBot = 128
  const px = (t: number) => x0 + t * (x1 - x0)
  const py = (v: number) => yBot - Math.min(1.3, Math.max(-0.3, v)) * (yBot - yTop)
  const pts = d.line.map((v, i) => `${f(px(i / Math.max(1, d.line.length - 1)))},${f(py(v))}`).join(' ')
  const dots = d.values
    .map((v, i) => `<circle cx="${f(px(i / Math.max(1, d.values.length - 1)))}" cy="${f(py(v))}" r="3.4" fill="var(--acc)"><title>${esc(`${d.name}: t ${f(i / Math.max(1, d.values.length - 1))} gives ${f(v)}`)}</title></circle>`)
    .join('')
  const ball = px(Math.min(1, Math.max(0, d.progress)))
  const anim = d.isAnimated ? `<style>@keyframes draw{from{stroke-dashoffset:700}to{stroke-dashoffset:0}}.ln{stroke-dasharray:700;animation:draw 700ms ease-out both}</style>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${accentStyle(d.accent)}${anim}<rect width="${W}" height="${H}" rx="10" fill="var(--bg)"/><line x1="${x0}" y1="${yBot}" x2="${x1}" y2="${yBot}" stroke="var(--line)"/><line x1="${x0}" y1="${yTop}" x2="${x0}" y2="${yBot}" stroke="var(--line)"/><line x1="${x0}" y1="${f(py(1))}" x2="${x1}" y2="${f(py(1))}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="6" y="${f(py(1) + 4)}" font-size="10" fill="var(--mut)" font-family="sans-serif">1</text><text x="6" y="${yBot + 4}" font-size="10" fill="var(--mut)" font-family="sans-serif">0</text><polyline class="ln" points="${pts}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}<text x="${x0}" y="${yBot + 18}" font-size="11" fill="var(--text)" font-family="sans-serif">${esc(d.name)}</text><line x1="${x0}" y1="168" x2="${x1}" y2="168" stroke="var(--line)" stroke-width="4" stroke-linecap="round"/><circle cx="${f(ball)}" cy="168" r="7" fill="var(--acc)"><title>${esc(`demo ball at ${f(d.progress)}`)}</title></circle></svg>`
}

/** A strip of labelled colour chips for the logo palette. */
export const swatchSvg = (sw: readonly Swatch[]): string => {
  const w = 76
  const W = Math.max(1, sw.length) * w + 8
  const chips = sw
    .map(
      (s, i) =>
        `<g><rect x="${4 + i * w}" y="4" width="${w - 6}" height="44" rx="8" fill="${esc(s.hex)}" stroke="var(--line)"><title>${esc(`${s.label} ${s.hex}`)}</title></rect><text x="${4 + i * w + (w - 6) / 2}" y="64" font-size="10" text-anchor="middle" fill="var(--text)" font-family="sans-serif">${esc(s.label)}</text><text x="${4 + i * w + (w - 6) / 2}" y="78" font-size="9" text-anchor="middle" fill="var(--mut)" font-family="monospace">${esc(s.hex)}</text></g>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 86" width="${W}" height="86" role="img">${STYLE}<rect width="${W}" height="86" fill="var(--bg)" rx="10"/>${chips}</svg>`
}

/** Font preview: each family drawn with the browser's own fonts. This only previews; the app cannot be given these fonts. */
export const fontSvg = (rows: readonly { label: string; family: string }[]): string => {
  const H = 14 + rows.length * 34
  const body = rows
    .map((r, i) => `<text x="12" y="${28 + i * 34}" font-size="18" fill="var(--text)" font-family="${esc(r.family)}">The quick brown fox 0123 {}</text><text x="340" y="${28 + i * 34}" font-size="10" fill="var(--mut)" font-family="sans-serif">${esc(r.label)}</text>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 ${H}" width="440" height="${H}" role="img">${STYLE}<rect width="440" height="${H}" rx="10" fill="var(--bg)"/>${body}</svg>`
}
