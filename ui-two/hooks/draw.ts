// Pure SVG drawing for ui-two (desktop only). No `$`. Colours follow light or dark through a media query inside the SVG.
// Real hover popups are not possible in this platform: the `<title>` of an element is the browser's own small tooltip,
// which works only when the Svg is drawn interactive on the desktop.
import type { Band, GLink, GNode, Rect, Tip } from './pure'
import { baseName, clip } from './pure'

export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'

const ACCENTS: Record<Accent, readonly [string, string]> = {
  suggestion: ['#4b57c9', '#a9b4ff'],
  claude: ['#c4562f', '#e08a68'],
  success: ['#2f8f4e', '#5fbf7a'],
  warning: ['#a8741a', '#f0b94a'],
  permission: ['#4b57c9', '#a9b4ff'],
  remember: ['#7b4bd0', '#b08cff'],
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f = (n: number): string => String(Math.round((Number.isFinite(n) ? n : 0) * 100) / 100)

const css = (accent: Accent): string => {
  const [light, dark] = ACCENTS[accent] ?? ACCENTS.suggestion

  return `:root{--text:#2b2a27;--mut:#6f6b63;--line:#d9d6cd;--acc:${light};--ok:#2f8f4e;--warn:#a8741a;--bad:#c63a4c;--k2:#7b4bd0;--card:#f4f2ec}
@media (prefers-color-scheme:dark){:root{--text:#ece9e2;--mut:#8f8b83;--line:#43423e;--acc:${dark};--ok:#5fbf7a;--warn:#f0b94a;--bad:#ff7a8a;--k2:#b08cff;--card:#2d2d2b}}
text{font:11px -apple-system,system-ui,sans-serif;fill:var(--text)}
.m{fill:var(--mut)}.big{font-size:17px;font-weight:600}.sm{font-size:10px}
.acc{fill:var(--acc)}.ok{fill:var(--ok)}.warn{fill:var(--warn)}.bad{fill:var(--bad)}.k2{fill:var(--k2)}
.line{stroke:var(--line);fill:none}.card{fill:var(--card);stroke:var(--line)}
.lnk{stroke:var(--acc);fill:none;stroke-opacity:.45;stroke-linecap:round}
.lnk:hover{stroke-opacity:.95}.hit{fill:transparent}.hit:hover{fill:var(--acc);fill-opacity:.08}`
}

const wrap = (W: number, H: number, accent: Accent, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" role="img"><style>${css(accent)}</style>${body}</svg>`

const KIND_CLASS: Record<string, string> = { tool: 'acc', edit: 'ok', error: 'bad', prompt: 'k2' }

/** 236: each overview item gets a mini bar chart of 14 days; hovering a bar shows its day and value in the browser tooltip. */
export const tipsSvg = (tips: Tip[], accent: Accent): string => {
  const W = 560
  const rowH = 48
  const x0 = 170
  const n = 14
  const gap = 5
  const bw = (W - 8 - x0 - gap * (n - 1)) / n
  let body = ''

  for (const [r, t] of tips.entries()) {
    const y = 6 + r * rowH
    const max = Math.max(0.0001, ...t.series)
    body += `<line x1="8" x2="${W - 8}" y1="${y + rowH - 2}" y2="${y + rowH - 2}" class="line"/>`
    body += `<text x="8" y="${y + 16}" class="m">${esc(t.label)}</text><text x="8" y="${y + 38}" class="big">${esc(t.value)}</text>`

    for (const [i, v] of t.series.entries()) {
      const h = v <= 0 ? 1.5 : Math.max(3, (v / max) * (rowH - 14))
      const x = x0 + i * (bw + gap)
      const shown = t.id === 'spend' ? `$${v.toFixed(2)}` : String(Math.round(v * 100) / 100)
      body += `<g><title>${esc(`${t.dayLabels[i] ?? ''}: ${shown} ${t.unit}`)}</title><rect x="${f(x - gap / 2)}" y="${y}" width="${f(bw + gap)}" height="${rowH - 4}" class="hit"/><rect x="${f(x)}" y="${f(y + rowH - 4 - h)}" width="${f(bw)}" height="${f(h)}" rx="2" class="acc" fill-opacity="${i === n - 1 ? 1 : 0.55}"/></g>`
    }
  }

  return wrap(W, 6 + tips.length * rowH + 4, accent, body)
}

/** 241: horizontal bands, one per event kind, 60 buckets across the window. */
export const timelineSvg = (bands: Band[], win: number, accent: Accent): string => {
  const W = 560
  const x0 = 70
  const bw = (W - 8 - x0) / 60
  const bandH = 36
  const gap = 10
  let body = ''

  for (const [r, b] of bands.entries()) {
    const y = 8 + r * (bandH + gap)
    body += `<text x="8" y="${y + bandH - 12}" class="m">${esc(b.kind)}${b.max > 0 ? '' : ''}</text><line x1="${x0}" x2="${W - 8}" y1="${y + bandH}" y2="${y + bandH}" class="line"/>`

    for (const [i, c] of b.buckets.entries()) {
      if (c > 0) {
        const h = Math.max(3, (c / b.max) * (bandH - 4))
        const ago = Math.round(((59 - i) * win) / 60)
        body += `<g><title>${esc(`${c} ${b.kind} event${c === 1 ? '' : 's'}, about ${ago} min ago`)}</title><rect x="${f(x0 + i * bw)}" y="${f(y + bandH - h)}" width="${f(Math.max(1, bw - 1))}" height="${f(h)}" rx="1.5" class="${KIND_CLASS[b.kind] ?? 'acc'}"/></g>`
      }
    }
  }
  const H = 8 + bands.length * (bandH + gap) + 12
  body += `<text x="${x0}" y="${H - 2}" class="m sm">-${win >= 60 ? `${win / 60}h` : `${win}m`}</text><text x="${W - 8}" y="${H - 2}" class="m sm" text-anchor="end">now</text>`

  return wrap(W, H, accent, body)
}

/** 246: directories as boxes, the files inside them as nested boxes sized by edit count. */
export const treemapSvg = (rects: Rect[], W: number, H: number, accent: Accent): string => {
  const max = Math.max(1, ...rects.filter(r => r.kind === 'file').map(r => r.count))
  let body = ''

  for (const r of rects) {
    if (r.w < 1 || r.h < 1) {
      continue
    }
    const tip = `<title>${esc(`${r.full}: ${r.count} edit${r.count === 1 ? '' : 's'}`)}</title>`

    if (r.kind === 'dir') {
      body += `<g>${tip}<rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" class="card"/>${r.w > 40 ? `<text x="${f(r.x + 5)}" y="${f(r.y + 12)}" class="m sm">${esc(clip(r.label, Math.floor(r.w / 6)))}</text>` : ''}</g>`
    } else {
      const op = 0.2 + 0.7 * (r.count / max)
      body += `<g>${tip}<rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" rx="3" class="acc" fill-opacity="${f(op)}"/>${r.w > 46 && r.h > 16 ? `<text x="${f(r.x + 4)}" y="${f(r.y + 12)}" class="sm">${esc(clip(r.label, Math.floor(r.w / 6)))} ${r.count}</text>` : ''}</g>`
    }
  }

  return wrap(W, H, accent, body)
}

/** 247: tools on the left, files on the right, curved links. A simple fixed layout, no force simulation. */
export const graphSvg = (g: { tools: GNode[]; files: GNode[]; links: GLink[] }, accent: Accent): string => {
  const W = 560
  const lx = 20
  const lw = 130
  const rx = 410
  const rw = 130
  const H = Math.max(60, ...g.tools.map(n => n.y + 40), ...g.files.map(n => n.y + 30))
  const maxLink = Math.max(1, ...g.links.map(l => l.n))
  const ty = new Map(g.tools.map(n => [n.id, n.y + 11]))
  const fy = new Map(g.files.map(n => [n.id, n.y + 11]))
  let body = ''

  for (const l of g.links) {
    const y1 = ty.get(l.from)
    const y2 = fy.get(l.to)

    if (y1 !== undefined && y2 !== undefined) {
      body += `<path d="M${lx + lw} ${f(y1)} C 280 ${f(y1)} 280 ${f(y2)} ${rx} ${f(y2)}" class="lnk" stroke-width="${f(1 + (5 * l.n) / maxLink)}"><title>${esc(`${l.from} touched ${baseName(l.to)} ${l.n} time${l.n === 1 ? '' : 's'}`)}</title></path>`
    }
  }

  for (const n of g.tools) {
    body += `<g><title>${esc(`${n.full}: ${n.n} call${n.n === 1 ? '' : 's'} on files`)}</title><rect x="${lx}" y="${n.y}" width="${lw}" height="22" rx="5" class="card"/><text x="${lx + 8}" y="${n.y + 15}">${esc(clip(n.label, 18))}</text></g>`
  }

  for (const n of g.files) {
    body += `<g><title>${esc(`${n.full}: ${n.n} touch${n.n === 1 ? '' : 'es'}`)}</title><rect x="${rx}" y="${n.y}" width="${rw}" height="22" rx="5" class="card"/><text x="${rx + 8}" y="${n.y + 15}">${esc(clip(n.label, 18))}</text></g>`
  }

  return wrap(W, H, accent, body)
}

export const svgAlt = (what: string, n: number): string => `${what}: ${n} item${n === 1 ? '' : 's'} drawn as a vector chart; hover for details.`
