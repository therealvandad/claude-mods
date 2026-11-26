// A small vector preview of the chart preferences (type, smoothing, grid, labels, legend, ramp). Pure and static: no
// animation, so it needs no motion switch. It is a PREVIEW of what the values mean: the app cannot apply them to other
// mods' charts. Colours follow light and dark through a media query inside the SVG.
export type ChartType = 'line' | 'bar' | 'area'
export type Legend = 'top' | 'bottom' | 'right' | 'none'
export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'

export type ChartOpts = {
  type: ChartType
  smooth: boolean
  grid: boolean
  labels: boolean
  legend: Legend
  ramp: string
  range: string
  metric: string
  accent: Accent
}

const ACCENTS: Readonly<Record<Accent, readonly [string, string]>> = {
  suggestion: ['#4b57c9', '#a9b4ff'],
  claude: ['#c4562f', '#e08a68'],
  success: ['#2f8f4e', '#5fbf7a'],
  warning: ['#a8741a', '#f0b94a'],
  permission: ['#4b57c9', '#a9b4ff'],
  remember: ['#7b4bd0', '#b08cff'],
}

export const RAMPS: Readonly<Record<string, readonly string[]>> = {
  blue: ['#dbe4ff', '#a9bdff', '#7794ff', '#4a67e0', '#2a3fa8'],
  green: ['#d8f3dc', '#a3dfae', '#6cc27f', '#3a9a58', '#1f6b3b'],
  warm: ['#fff1c9', '#ffd78a', '#ffae5c', '#ee7a3c', '#b94a1f'],
  mono: ['#eceae4', '#c8c5bc', '#9d9a91', '#6b6862', '#3d3b37'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
}

export const SAMPLE: readonly number[] = [3, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15]

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const f = (n: number): string => String(Math.round(n * 100) / 100)

/** Catmull-Rom through the points as cubic Bezier segments; a straight polyline when `smooth` is false. */
export const linePath = (pts: readonly (readonly [number, number])[], smooth: boolean): string => {
  const first = pts[0]

  if (first === undefined) {
    return ''
  }
  let d = `M${f(first[0])} ${f(first[1])}`

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!
    const p2 = pts[i + 1]!

    if (!smooth) {
      d += ` L${f(p2[0])} ${f(p2[1])}`
      continue
    }
    const p0 = pts[i - 1] ?? p1
    const p3 = pts[i + 2] ?? p2
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }

  return d
}

export const chartAlt = (o: ChartOpts): string =>
  `Sample ${o.metric} chart drawn as ${o.type}${o.smooth && o.type !== 'bar' ? ', smooth' : ''}, ${o.grid ? 'with' : 'without'} grid lines, ${o.labels ? 'with' : 'without'} data labels, legend ${o.legend}, range ${o.range}, ${o.ramp} heat-map ramp.`

export const chartSvg = (o: ChartOpts): string => {
  const [light, dark] = ACCENTS[o.accent] ?? ACCENTS.suggestion
  const ramp = RAMPS[o.ramp] ?? RAMPS['blue']!
  const W = 360
  const H = 196
  const x0 = 28
  const x1 = o.legend === 'right' ? 276 : 344
  const y0 = o.legend === 'top' ? 36 : 20
  const y1 = o.legend === 'bottom' ? 132 : 148
  const max = Math.max(...SAMPLE)
  const n = SAMPLE.length
  const px = (i: number) => (o.type === 'bar' ? x0 + ((i + 0.5) / n) * (x1 - x0) : x0 + (i / (n - 1)) * (x1 - x0))
  const py = (v: number) => y1 - (v / max) * (y1 - y0 - 6)
  const pts = SAMPLE.map((v, i) => [px(i), py(v)] as const)
  let body = ''

  if (o.grid) {
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      body += `<line x1="${x0}" x2="${x1}" y1="${f(y1 - k * (y1 - y0))}" y2="${f(y1 - k * (y1 - y0))}" class="grid"/>`
    }
  }
  body += `<line x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}" class="axis"/>`

  if (o.type === 'bar') {
    const bw = ((x1 - x0) / n) * 0.62

    body += SAMPLE.map((v, i) => `<rect x="${f(px(i) - bw / 2)}" y="${f(py(v))}" width="${f(bw)}" height="${f(y1 - py(v))}" rx="2" class="accfill"><title>${esc(o.metric)} ${v}</title></rect>`).join('')
  } else {
    const d = linePath(pts, o.smooth)
    const last = pts[pts.length - 1]!
    const firstPt = pts[0]!

    if (o.type === 'area') {
      body += `<path d="${d} L${f(last[0])} ${y1} L${f(firstPt[0])} ${y1} Z" class="accfill" opacity="0.22"/>`
    }
    body += `<path d="${d}" fill="none" class="accline" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
    body += pts.map(([x, y], i) => `<circle cx="${f(x)}" cy="${f(y)}" r="2.6" class="accfill"><title>${esc(o.metric)} ${SAMPLE[i]}</title></circle>`).join('')
  }

  if (o.labels) {
    body += SAMPLE.map((v, i) => (i % 2 === 1 ? `<text x="${f(px(i))}" y="${f(py(v) - 6)}" text-anchor="middle" class="num">${v}</text>` : '')).join('')
  }
  const swatch = (x: number, y: number) => `<rect x="${x}" y="${y - 8}" width="10" height="10" rx="2" class="accfill"/><text x="${x + 14}" y="${y + 1}" class="mut sm">${esc(o.metric)}</text>`
  const legend =
    o.legend === 'top' ? swatch(x0, 20) : o.legend === 'bottom' ? swatch(x0, 154) : o.legend === 'right' ? swatch(288, y0 + 12) : ''
  const rampRow = ramp.map((c, i) => `<rect x="${x0 + i * 26}" y="170" width="22" height="14" rx="3" fill="${c}" stroke="var(--line)" stroke-width="1"><title>${esc(o.ramp)} ${i + 1}/5</title></rect>`).join('')
  const css = `:root{--text:#2b2a27;--mut:#8a867d;--acc:${light};--line:#d9d5ca}@media (prefers-color-scheme:dark){:root{--text:#ece9e2;--mut:#8f8b83;--acc:${dark};--line:#43423e}}
text{font-family:-apple-system,system-ui,'Segoe UI',sans-serif;fill:var(--text)}.mut{fill:var(--mut)}.sm{font-size:11px}.num{font-size:10px;font-weight:600;fill:var(--mut)}
.grid{stroke:var(--line);stroke-width:1;stroke-dasharray:2 4}.axis{stroke:var(--mut);stroke-width:1;opacity:.5}.accfill{fill:var(--acc)}.accline{stroke:var(--acc)}`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><title>${esc(chartAlt(o))}</title><style>${css}</style>${legend}${body}<text x="${x1}" y="${y1 + 12}" text-anchor="end" class="mut sm">${esc(o.range)}</text><text x="${x0 + 5 * 26 + 6}" y="181" class="mut sm">heat-map ramp: ${esc(o.ramp)}</text>${rampRow}</svg>`
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** A text twin of the same sample for surfaces with no vector drawing: block characters. */
export const sparkText = (values: readonly number[] = SAMPLE): string => {
  const max = Math.max(...values, 1)

  return values.map(v => BLOCKS[Math.min(7, Math.max(0, Math.round((v / max) * 7)))]).join('')
}

export const chartText = (o: ChartOpts): string[] => [
  `${o.metric}: ${o.type}${o.type === 'bar' ? '' : o.smooth ? ', smooth' : ', straight'}, grid ${o.grid ? 'on' : 'off'}, labels ${o.labels ? 'on' : 'off'}, legend ${o.legend}, range ${o.range}`,
  `${sparkText()}  (text sketch of the sample, ramp ${o.ramp})`,
]
