// Small vector drawings for the desktop surface (ring gauge and per-tool bars). Pure strings, no `$`.
// Colours follow the app's light or dark mode through a media query inside the SVG; theme keys cannot be read by an SVG,
// so each key has a light and a dark hex. Static: nothing animates.

const PAIRS: Record<string, readonly [string, string]> = {
  suggestion: ['#4b57c9', '#a9b4ff'],
  success: ['#2f8f4e', '#5fbf7a'],
  warning: ['#a8741a', '#f0b94a'],
  error: ['#c0392b', '#ff7b6b'],
  claude: ['#c4562f', '#e08a68'],
  permission: ['#4b57c9', '#a9b4ff'],
  remember: ['#7b4bd0', '#b08cff'],
  subtle: ['#7a7a85', '#9a9aa8'],
  inactive: ['#9a9aa5', '#6f6f7a'],
  text: ['#2a2a33', '#e6e6ee'],
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
// Characters that are not allowed in XML 1.0 are dropped.
// eslint-disable-next-line no-control-regex
const xmlSafe = (s: string): string => esc(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''))

const num = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
const f = (n: number): string => String(Math.round(n * 100) / 100)
const key = (k: string): string => (Object.prototype.hasOwnProperty.call(PAIRS, k) ? k : 'subtle')

const css = (keys: readonly string[]): string => {
  const uniq = [...new Set(['text', 'subtle', ...keys.map(key)])]
  const pick = (i: 0 | 1) => uniq.map(k => `.f-${k}{fill:${PAIRS[k]?.[i] ?? '#888'}}.s-${k}{stroke:${PAIRS[k]?.[i] ?? '#888'}}`).join('')

  return `<style>${pick(0)}.track{stroke:#00000022}@media (prefers-color-scheme:dark){${pick(1)}.track{stroke:#ffffff26}}text{font:12px -apple-system,Segoe UI,sans-serif}</style>`
}

/** A ring gauge, 72 pixels square, with the value in the middle. */
export const ringSvg = (pct: number, label: string, tone: string): string => {
  const p = num(pct, 0, 100)
  const r = 28
  const c = 2 * Math.PI * r
  const k = key(tone)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72" role="img">${css([k])}<title>${xmlSafe(label)} ${f(p)}%</title><circle class="track" cx="36" cy="36" r="${r}" fill="none" stroke-width="7"/><circle class="s-${k}" cx="36" cy="36" r="${r}" fill="none" stroke-width="7" stroke-linecap="round" stroke-dasharray="${f(c)}" stroke-dashoffset="${f(c * (1 - p / 100))}" transform="rotate(-90 36 36)"/><text class="f-text" x="36" y="40" text-anchor="middle" font-weight="600">${f(Math.round(p))}%</text></svg>`
}

export type BarRow = { label: string; glyph: string; n: number; err: number; color: string }

/** Horizontal bars, one per tool, in the colour you chose for the tool. */
export const barsSvg = (rows: readonly BarRow[], width: number): string => {
  const w = num(width, 160, 700)
  const shown = rows.slice(0, 8)
  const rowH = 22
  const h = Math.max(1, shown.length) * rowH + 4
  const labelW = 96
  const max = Math.max(1, ...shown.map(r => r.n))
  const body = shown
    .map((r, i) => {
      const y = i * rowH + 2
      const len = Math.max(2, ((w - labelW - 44) * r.n) / max)
      const k = key(r.color)
      const name = Array.from(`${r.glyph === '' ? '' : `${r.glyph} `}${r.label}`).slice(0, 14).join('')

      return `<g><title>${xmlSafe(r.label)}: ${r.n} calls${r.err > 0 ? `, ${r.err} errors` : ''}</title><text class="f-text" x="0" y="${y + 14}">${xmlSafe(name)}</text><rect class="f-${k}" x="${labelW}" y="${y + 3}" width="${f(len)}" height="12" rx="6"/><text class="f-subtle" x="${f(labelW + len + 6)}" y="${y + 14}">${r.n}${r.err > 0 ? '!' : ''}</text></g>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${h}" width="${f(w)}" height="${h}" role="img">${css(shown.map(r => r.color))}${body}</svg>`
}

export const barsAlt = (rows: readonly BarRow[]): string => (rows.length === 0 ? 'No tool calls yet.' : `Tool calls: ${rows.slice(0, 8).map(r => `${r.label} ${r.n}`).join(', ')}.`)
