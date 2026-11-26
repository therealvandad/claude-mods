// Vector drawings for the desktop app. Pure: strings in, strings out, so they can be tested and previewed.
// Colours follow the app's light or dark mode through a media query inside the SVG; every mark has a <title>
// (the hover tooltip). Motion (entrance, pulse, skeleton sweep, checkmark draw, confetti) exists only when the
// caller says so: with motion off or calm on the same drawings are static, with no @keyframes at all.

import { dur } from './data'
import { clampN } from './fmt'
import type { ActivityModel, ErrorsModel, FilesModel, Num, PromptsModel, SpendModel, TimelineModel } from './model'
import { squarify } from './model'

export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'
/** `animate`: motion is on and calm is off. `enter`: play the entrance now. `pulse`: numbers to highlight now. */
export type Look = { accent: Accent; animate: boolean; enter: boolean; pulse: readonly string[]; W: number }

const ACCENTS: Record<Accent, readonly [string, string]> = {
  suggestion: ['#4b57c9', '#a9b4ff'],
  claude: ['#c4562f', '#e08a68'],
  success: ['#2f8f4e', '#5fbf7a'],
  warning: ['#a8741a', '#f0b94a'],
  permission: ['#4b57c9', '#a9b4ff'],
  remember: ['#7b4bd0', '#b08cff'],
}

export const isAccent = (v: unknown): v is Accent => typeof v === 'string' && v in ACCENTS

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const f = (n: number) => String(Math.round((Number.isFinite(n) ? n : 0) * 100) / 100)
const PAD = 14
const clip = (s: string, px: number, size = 11): string => {
  const n = Math.max(1, Math.floor(px / (size * 0.58)))

  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`
}

export const smoothPath = (pts: readonly (readonly [number, number])[]): string => {
  const first = pts[0]

  if (first === undefined) {
    return ''
  }
  let d = `M${f(first[0])} ${f(first[1])}`

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
  }

  return d
}

/** Tool kinds get their own hue (the same split the other vector mods use). */
export const toolKind = (name: string): 1 | 2 | 3 | 4 =>
  /^(bash|shell|run)/i.test(name) ? 2 : /^(edit|write|notebook|multi)/i.test(name) ? 3 : /^(grep|glob|search|web|find|ls)/i.test(name) ? 4 : 1

const rise = (look: Look, i: number) => (look.enter ? ` style="animation:rise .5s cubic-bezier(.2,.8,.2,1) ${f(i * 0.06)}s both"` : '')

type Needs = { sweep?: number; draw?: boolean; fall?: boolean; run?: boolean }

const css = (look: Look, needs: Needs = {}): string => {
  const [light, dark] = ACCENTS[look.accent]
  const moves: string[] = []

  if (look.enter) {
    moves.push('@keyframes rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}')
    moves.push('@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}} @keyframes growy{from{transform:scaleY(0)}to{transform:scaleY(1)}}')
    moves.push('@keyframes fadein{from{opacity:0}to{opacity:1}} @keyframes drawl{from{stroke-dashoffset:600}to{stroke-dashoffset:0}}')
  }

  if (look.pulse.length > 0) {
    moves.push('@keyframes flash{0%{opacity:.75}100%{opacity:0}} @keyframes pop{0%{transform:scale(1.18)}100%{transform:scale(1)}}')
  }

  if (needs.sweep !== undefined) {
    moves.push(`@keyframes sweep{from{transform:translateX(0)}to{transform:translateX(${f(needs.sweep)}px)}}`)
  }

  if (needs.draw === true) {
    moves.push('@keyframes tick{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}')
  }

  if (needs.fall === true) {
    moves.push('@keyframes fall{0%{transform:translateY(-30px) rotate(0);opacity:0}15%{opacity:1}100%{transform:translateY(0) rotate(240deg);opacity:1}}')
  }

  if (needs.run === true) {
    moves.push('@keyframes runp{0%,100%{opacity:1}50%{opacity:.45}} .run{animation:runp 1.4s ease-in-out infinite}')
  }

  return `
:root{--card:#ffffff;--line:#e4e0d6;--text:#2b2a27;--mut:#8a867d;--acc:${light};--ok:#2f8f4e;--warn:#a8741a;--bad:#c43a50;--track:#ebe7dc;--k2:#7b4bd0;--k3:#c07a1a;--k4:#1f8b9c;--on:#ffffff}
@media (prefers-color-scheme:dark){:root{--card:#2d2d2b;--line:#43423e;--text:#ece9e2;--mut:#8f8b83;--acc:${dark};--ok:#5fbf7a;--warn:#f0b94a;--bad:#ff7a8a;--track:#3b3a36;--k2:#b08cff;--k3:#f0b94a;--k4:#5fcfe0;--on:#1d1c1a}}
text{font-family:-apple-system,system-ui,'Segoe UI',sans-serif;fill:var(--text)}
.big{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums} .lab{font-size:11px;font-weight:600} .mut{fill:var(--mut)} .sm{font-size:10.5px} .tiny{font-size:9.5px}
.cap{font-size:10px;font-weight:700;letter-spacing:.08em;fill:var(--mut)} .num{font-size:11px;font-weight:600;fill:var(--mut);font-variant-numeric:tabular-nums}
.tl{font-size:10.5px;font-weight:600;fill:var(--on)}
.card{fill:var(--card);stroke:var(--line)} .track{fill:var(--track)} .grid{stroke:var(--line);stroke-width:1;stroke-dasharray:2 4}
.acc{fill:var(--acc)} .accs{stroke:var(--acc);fill:none} .okf{fill:var(--ok)} .bad{fill:var(--bad)} .warn{fill:var(--warn)} .badt{fill:var(--bad)} .okt{fill:var(--ok)} .warnt{fill:var(--warn)}
.k1{fill:var(--acc)} .k2{fill:var(--k2)} .k3{fill:var(--k3)} .k4{fill:var(--k4)} .k2s{stroke:var(--k2);fill:none}
.flash{fill:var(--warn)} .axis{stroke:var(--line);stroke-width:1}
${moves.join('\n')}`
}

const shell = (look: Look, H: number, alt: string, body: string, needs: Needs = {}): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${look.W} ${f(H)}" width="${look.W}" height="${f(H)}" role="img" aria-label="${esc(alt)}">
<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--acc)" stop-opacity=".30"/><stop offset="1" stop-color="var(--acc)" stop-opacity="0"/></linearGradient></defs>
<style>${css(look, needs)}</style>
${body}
</svg>`

/** The headline numbers, three across, with a flash behind one that just changed. */
const header = (look: Look, nums: readonly Num[], y: number): string => {
  const colW = (look.W - PAD * 2) / Math.max(1, nums.length)

  return nums
    .map((n, i) => {
      const x = PAD + i * colW
      const hot = look.pulse.includes(n.key)
      const cls = n.tone === 'bad' ? 'badt' : n.tone === 'warn' ? 'warnt' : n.tone === 'ok' ? 'okt' : n.tone === 'mut' ? 'mut' : ''
      const w = Math.max(24, n.value.length * 11.5 + 10)
      const flash = hot ? `<rect x="${f(x - 5)}" y="${y - 19}" width="${f(w)}" height="26" rx="7" class="flash" style="animation:flash 1.2s ease-out both"/>` : ''
      const pop = hot ? ` style="transform-box:fill-box;transform-origin:left center;animation:pop .6s ease-out both"` : ''

      return `<g><title>${esc(`${n.label}: ${n.value}`)}</title>${flash}<text x="${f(x)}" y="${y}" class="big ${cls}"${pop}>${esc(n.value)}</text><text x="${f(x)}" y="${y + 15}" class="mut sm">${esc(n.label)}</text></g>`
    })
    .join('')
}

const HEAD = 66

// ---------------------------------------------------------------- timeline

export const timelineSvg = (m: TimelineModel, look: Look): string => {
  const W = look.W
  const labelW = W < 400 ? 52 : 72
  const x0 = PAD + labelW
  const x1 = W - PAD
  const y0 = HEAD + 14
  const lane = 22
  const rows = Math.max(1, m.lanes.length)
  const hasRun = m.bars.some(b => b.running)
  const body: string[] = [header(look, m.nums, 34)]
  let marks = ''

  m.lanes.forEach((name, i) => {
    const y = y0 + i * lane
    marks += `<line x1="${x0}" x2="${x1}" y1="${y + lane}" y2="${y + lane}" class="grid"/><text x="${PAD}" y="${y + 15}" class="lab">${esc(clip(name, labelW - 6))}</text>`
  })
  m.bars.forEach((b, i) => {
    const x = x0 + b.a * (x1 - x0)
    const w = Math.max(3, (b.b - b.a) * (x1 - x0))
    const cls = b.isErr ? 'bad' : `k${toolKind(b.tool)}`
    const grow = look.enter ? ` style="transform-origin:${f(x)}px 0;animation:grow .45s cubic-bezier(.2,.8,.2,1) ${f(Math.min(0.6, i * 0.012))}s both"` : ''
    marks += `<rect x="${f(x)}" y="${y0 + b.lane * lane + 4}" width="${f(w)}" height="14" rx="4" class="${cls}${b.running && look.animate ? ' run' : ''}"${b.running ? ' fill-opacity=".7" stroke="var(--acc)" stroke-dasharray="3 2"' : ''}${grow}><title>${esc(b.tip)}</title></rect>`
  })
  const axisY = y0 + rows * lane + 8
  let axis = `<line x1="${x0}" x2="${x1}" y1="${axisY - 4}" y2="${axisY - 4}" class="axis"/>`

  for (let k = 0; k <= 4; k += W < 400 ? 2 : 1) {
    const x = x0 + ((x1 - x0) * k) / 4
    axis += `<text x="${f(x)}" y="${axisY + 8}" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}" class="mut tiny">${k === 0 ? '0' : esc(dur((m.spanMs * k) / 4))}</text>`
  }
  body.push(`<g${rise(look, 0)}>${marks}${axis}</g>`)

  return shell(look, axisY + 16, `Timeline of ${m.bars.length} tool calls over ${dur(m.spanMs)}`, body.join('\n'), { run: hasRun && look.animate })
}

// ---------------------------------------------------------------- files treemap

export const filesSvg = (m: FilesModel, look: Look): string => {
  const W = look.W
  const th = W < 400 ? 190 : W < 600 ? 230 : 280
  const aw = W - PAD * 2
  const rects = squarify(m.tiles.map(t => t.w), aw, th)
  const top = HEAD + 14
  let tiles = ''

  m.tiles.forEach((t, i) => {
    const r = rects[i]

    if (r === undefined) {
      return
    }
    const x = PAD + r.x
    const y = top + r.y
    const shade = clampN(1 - i * 0.025, 0.55, 1)
    const pct = Math.round((t.w / Math.max(1, m.total)) * 100)
    const fade = look.enter ? ` style="animation:fadein .5s ease-out ${f(Math.min(0.7, i * 0.03))}s both"` : ''
    const label = r.w >= 46 && r.h >= 20 ? `<text x="${f(x + 6)}" y="${f(y + 15)}" class="tl">${esc(clip(t.label, r.w - 10, 10.5))}</text>` : ''
    const sub = r.w >= 46 && r.h >= 36 ? `<text x="${f(x + 6)}" y="${f(y + 29)}" class="tl" fill-opacity=".8">x${t.n}</text>` : ''
    tiles += `<g${fade}><rect x="${f(x + 1)}" y="${f(y + 1)}" width="${f(Math.max(0, r.w - 2))}" height="${f(Math.max(0, r.h - 2))}" rx="4" class="k${t.grp}" fill-opacity="${f(shade)}"><title>${esc(`${t.path}\n${t.n} edit${t.n === 1 ? '' : 's'}, +${t.added} -${t.removed} lines, ${pct}% of the size`)}</title></rect>${label}${sub}</g>`
  })

  return shell(look, top + th + 14, `Treemap of ${m.tiles.length} edited files`, `${header(look, m.nums, 34)}<g${rise(look, 0)}>${tiles}</g>`)
}

// ---------------------------------------------------------------- errors

export const errorsSvg = (m: ErrorsModel, look: Look): string => {
  const W = look.W
  const perRow = Math.max(8, Math.floor((W - PAD * 2) / 11))
  const stripRows = Math.max(1, Math.ceil(m.strip.length / perRow))
  const top = HEAD + 24
  let strip = `<text x="${PAD}" y="${HEAD + 12}" class="cap">LAST ${m.strip.length} CALLS</text>`

  m.strip.forEach((c, i) => {
    const x = PAD + (i % perRow) * 11
    const y = top + Math.floor(i / perRow) * 11 - 8
    const cls = c.running ? 'acc' : c.ok ? 'okf' : 'bad'
    const fade = look.enter ? ` style="animation:fadein .4s ease-out ${f(Math.min(0.6, i * 0.01))}s both"` : ''
    strip += `<rect x="${x}" y="${y}" width="8" height="8" rx="2.5" class="${cls}"${c.ok ? ' fill-opacity=".55"' : ''}${fade}><title>${esc(c.tip)}</title></rect>`
  })
  const barsTop = top + stripRows * 11 + 14
  const labelW = W < 400 ? 56 : 80
  const trackW = W - PAD * 2 - labelW - 56
  let bars = `<text x="${PAD}" y="${barsTop}" class="cap">FAILURES BY TOOL</text>`
  const shown = m.perTool.filter(t => t.err > 0)

  if (shown.length === 0) {
    bars += `<text x="${PAD}" y="${barsTop + 20}" class="okt lab">No failed calls.</text>`
  }
  shown.forEach((t, i) => {
    const y = barsTop + 12 + i * 22
    const w = Math.max(6, (t.err / Math.max(1, t.total)) * trackW)
    const grow = look.enter ? ` style="transform-origin:${PAD + labelW}px ${y}px;animation:grow .6s cubic-bezier(.2,.8,.2,1) ${f(0.1 + i * 0.07)}s both"` : ''
    bars += `<g><title>${esc(`${t.tool}: ${t.err} of ${t.total} calls failed`)}</title><text x="${PAD}" y="${y + 11}" class="lab">${esc(clip(t.tool, labelW - 6))}</text><rect x="${PAD + labelW}" y="${y}" width="${f(trackW)}" height="14" rx="7" class="track"/><rect x="${PAD + labelW}" y="${y}" width="${f(w)}" height="14" rx="7" class="bad"${grow}/><text x="${W - PAD}" y="${y + 11}" text-anchor="end" class="num">${t.err}/${t.total}</text></g>`
  })
  const H = barsTop + 14 + Math.max(1, shown.length) * 22 + 6

  return shell(look, H, `Errors: ${m.errors} failed calls of ${m.strip.length} recent`, `${header(look, m.nums, 34)}<g${rise(look, 0)}>${strip}${bars}</g>`)
}

// ---------------------------------------------------------------- prompts

export const promptsSvg = (m: PromptsModel, look: Look): string => {
  const W = look.W
  const n = Math.max(1, m.lens.length)
  const aw = W - PAD * 2
  const bw = Math.max(3, aw / n - 2)
  const ch = 110
  const top = HEAD + 16
  const max = Math.max(1, m.longest)
  let bars = `<text x="${PAD}" y="${HEAD + 8}" class="cap">${W < 400 ? 'PROMPT LENGTH, NEWEST AT RIGHT' : 'LENGTH OF EACH PROMPT, NEWEST AT THE RIGHT'}</text><line x1="${PAD}" x2="${W - PAD}" y1="${top + ch}" y2="${top + ch}" class="axis"/>`

  m.lens.forEach((len, i) => {
    const h = Math.max(3, Math.sqrt(len / max) * (ch - 6))
    const x = PAD + i * (aw / n) + 1
    const grow = look.enter ? ` style="transform-origin:${f(x)}px ${top + ch}px;animation:growy .5s cubic-bezier(.2,.8,.2,1) ${f(Math.min(0.6, i * 0.02))}s both"` : ''
    bars += `<rect x="${f(x)}" y="${f(top + ch - h)}" width="${f(bw)}" height="${f(h)}" rx="2.5" class="acc"${grow}><title>${esc(`#${i + 1}: ${len} characters`)}</title></rect>`
  })
  const my = top + ch - Math.sqrt(Math.max(0, m.medianLen) / max) * (ch - 6)
  bars += `<line x1="${PAD}" x2="${W - PAD}" y1="${f(my)}" y2="${f(my)}" class="grid"/><text x="${W - PAD}" y="${f(my - 4)}" text-anchor="end" class="mut tiny">median ${Math.round(m.medianLen)}</text>`

  return shell(look, top + ch + 22, `Prompts: ${m.lens.length} recent, median ${Math.round(m.medianLen)} characters`, `${header(look, m.nums, 34)}<g${rise(look, 0)}>${bars}</g>`)
}

// ---------------------------------------------------------------- spend

export const spendSvg = (m: SpendModel, look: Look): string => {
  const W = look.W
  const aw = W - PAD * 2
  const ch = 120
  const top = HEAD + 18
  const n = m.cum.length
  const maxC = Math.max(0.01, ...m.cum)
  const px = (i: number) => PAD + (n <= 1 ? aw / 2 : (i / (n - 1)) * aw)
  const pts = m.cum.map((v, i) => [px(i), top + ch - (v / maxC) * (ch - 10) - 4] as const)
  const ctxPts = m.ctx.map((v, i) => [px(i), top + ch - (clampN(v, 0, 100) / 100) * (ch - 10) - 4] as const)
  const line = smoothPath(pts)
  const last = pts[pts.length - 1]
  const area = last === undefined || n < 2 ? '' : `<path d="${line} L${f(last[0])} ${top + ch} L${f(PAD)} ${top + ch} Z" fill="url(#area)"${look.enter ? ' style="animation:fadein .9s ease-out .3s both"' : ''}/>`
  const draw = look.enter ? ' pathLength="600" style="stroke-dasharray:600;animation:drawl 1.1s ease-out both"' : ''
  let g = `<text x="${PAD}" y="${HEAD + 8}" class="cap">${W < 400 ? 'SPENT AND CONTEXT (DASHED)' : 'SPENT SO FAR (LINE) AND CONTEXT FULL (DASHED)'}</text>
<line x1="${PAD}" x2="${W - PAD}" y1="${top + ch}" y2="${top + ch}" class="axis"/>${[0.25, 0.5, 0.75].map(k => `<line x1="${PAD}" x2="${W - PAD}" y1="${f(top + ch * k)}" y2="${f(top + ch * k)}" class="grid"/>`).join('')}${area}`

  if (n >= 2) {
    g += `<path d="${smoothPath(ctxPts)}" class="k2s" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="4 3"/><path d="${line}" class="accs" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"${draw}/>`
  }
  pts.forEach((p, i) => {
    g += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="3.5" class="acc"><title>${esc(`Turn ${i + 1}: total $${(m.cum[i] ?? 0).toFixed(2)}, context ${Math.round(m.ctx[i] ?? 0)}%, this turn +$${(m.deltas[i] ?? 0).toFixed(2)}`)}</title></circle>`
  })
  const by = top + ch + 26
  const maxD = Math.max(0.01, ...m.deltas)
  const bw = Math.max(3, aw / Math.max(1, n) - 2)
  g += `<text x="${PAD}" y="${by - 6}" class="cap">COST OF EACH TURN</text>`
  m.deltas.forEach((v, i) => {
    const h = Math.max(2, (v / maxD) * 36)
    g += `<rect x="${f(PAD + i * (aw / Math.max(1, n)) + 1)}" y="${f(by + 38 - h)}" width="${f(bw)}" height="${f(h)}" rx="2" class="k3"><title>${esc(`Turn ${i + 1}: +$${v.toFixed(2)}`)}</title></rect>`
  })

  return shell(look, by + 50, `Spend: $${(m.cum[n - 1] ?? 0).toFixed(2)} over ${n} turns`, `${header(look, m.nums, 34)}<g${rise(look, 0)}>${g}</g>`)
}

// ---------------------------------------------------------------- activity

export const activitySvg = (m: ActivityModel, look: Look): string => {
  const W = look.W
  const side = W >= 480
  const top = HEAD + 22
  const cell = 11
  const step = 14
  const heatW = 12 * step
  let g = `<text x="${PAD}" y="${HEAD + 8}" class="cap">LAST 12 WEEKS</text>`

  m.heat.forEach((h, i) => {
    const col = Math.floor(i / 7)
    const row = i % 7
    const level = h.v === 0 ? 0 : 0.28 + 0.72 * (h.v / m.max)
    const fade = look.enter ? ` style="animation:fadein .5s ease-out ${f(col * 0.03)}s both"` : ''
    g += `<rect x="${PAD + 16 + col * step}" y="${top + row * step}" width="${cell}" height="${cell}" rx="3.5" class="${level === 0 ? 'track' : 'acc'}"${level === 0 ? '' : ` fill-opacity="${f(level)}"`}${i === 83 ? ' stroke="var(--text)" stroke-width="1.5"' : ''}${fade}><title>${esc(`${h.key}: ${h.v} tool call${h.v === 1 ? '' : 's'}`)}</title></rect>`
  })
  const hx = side ? PAD + 16 + heatW + 28 : PAD
  const hy = side ? top : top + 7 * step + 26
  const hw = side ? W - hx - PAD : W - PAD * 2
  const bw = Math.max(3, hw / 24 - 2)
  const hmax = Math.max(1, ...m.hours)
  g += `<text x="${hx}" y="${side ? HEAD + 8 : hy - 10}" class="cap">BY HOUR OF THE DAY</text><line x1="${hx}" x2="${hx + hw}" y1="${hy + 7 * step - 3}" y2="${hy + 7 * step - 3}" class="axis"/>`
  m.hours.forEach((v, h) => {
    const bh = v === 0 ? 2 : Math.max(3, (v / hmax) * (7 * step - 12))
    const grow = look.enter ? ` style="transform-origin:${f(hx + h * (hw / 24))}px ${hy + 7 * step - 3}px;animation:growy .5s cubic-bezier(.2,.8,.2,1) ${f(h * 0.02)}s both"` : ''
    g += `<rect x="${f(hx + h * (hw / 24) + 1)}" y="${f(hy + 7 * step - 3 - bh)}" width="${f(bw)}" height="${f(bh)}" rx="2" class="${v === 0 ? 'track' : 'k4'}"${grow}><title>${esc(`${String(h).padStart(2, '0')}:00, ${v} call${v === 1 ? '' : 's'}`)}</title></rect>`
  })
  g += [0, 6, 12, 18].map(h => `<text x="${f(hx + h * (hw / 24))}" y="${hy + 7 * step + 9}" class="mut tiny">${String(h).padStart(2, '0')}</text>`).join('')
  const H = (side ? top + 7 * step + 22 : hy + 7 * step + 22)

  return shell(look, H, `Activity: ${m.nums[1]?.value ?? 0} tool calls in 12 weeks`, `${header(look, m.nums, 34)}<g${rise(look, 0)}>${g}</g>`)
}

// ---------------------------------------------------------------- tiny drawings

/** A sparkline small enough to sit at the end of a text row. */
export const tinySpark = (values: readonly number[], title: string, accent: Accent, w = 64, h = 16): string => {
  const [light, dark] = ACCENTS[accent]
  const n = Math.max(1, values.length)
  const max = Math.max(1, ...values)
  const bw = Math.max(1.5, w / n - 1.5)
  const bars = values
    .map((v, i) => {
      const bh = v <= 0 ? 1.5 : Math.max(2, (v / max) * (h - 2))

      return `<rect x="${f(i * (w / n))}" y="${f(h - bh)}" width="${f(bw)}" height="${f(bh)}" rx="1" class="b${v <= 0 ? ' z' : ''}"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"><style>.b{fill:${light}}.z{opacity:.3}@media (prefers-color-scheme:dark){.b{fill:${dark}}}</style><title>${esc(title)}</title>${bars}</svg>`
}

/** The three numbers of the mini pane and the widget. */
export const miniSvg = (nums: readonly Num[], look: Look): string => {
  const W = Math.min(look.W, 280)
  const small: Look = { ...look, W }

  return shell(small, 64, nums.map(n => `${n.label} ${n.value}`).join(', '), `<g${rise(look, 0)}>${header(small, nums, 28)}</g>`)
}

/** Grey placeholder bars with a light sweep across them (only drawn when motion is allowed). */
export const skeletonSvg = (look: Look, rows = 4): string => {
  const W = look.W
  const H = 40 + rows * 26
  const bars = Array.from({ length: rows }, (_, i) => `<rect x="${PAD}" y="${28 + i * 26}" width="${f((W - PAD * 2) * (i === 0 ? 0.5 : 1 - ((i * 7) % 4) * 0.12))}" height="14" rx="7"/>`).join('')
  const sweep = look.animate
    ? `<g clip-path="url(#sk)"><rect x="${f(-W * 0.6)}" y="0" width="${f(W * 0.6)}" height="${H}" fill="url(#sh)" style="animation:sweep 1.3s ease-in-out infinite"/></g>`
    : ''

  return shell(
    look,
    H,
    'Loading',
    `<defs><clipPath id="sk">${bars}</clipPath><linearGradient id="sh" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="var(--card)" stop-opacity="0"/><stop offset=".5" stop-color="var(--card)" stop-opacity=".9"/><stop offset="1" stop-color="var(--card)" stop-opacity="0"/></linearGradient></defs><g class="track">${bars}</g>${sweep}`,
    { sweep: look.animate ? W * 1.8 : undefined },
  )
}

/** A circle and a tick. The tick is drawn as a stroke when `look.animate` is true, otherwise it is just there. */
export const checkSvg = (look: Look, label: string): string => {
  const draw = look.animate ? ' pathLength="100" style="stroke-dasharray:100;animation:tick .6s .1s ease-out both"' : ''
  const ring = look.animate ? ' style="animation:fadein .3s ease-out both"' : ''
  const body = `<title>${esc(label)}</title><circle cx="28" cy="28" r="22" fill="none" class="okf" fill-opacity=".14" stroke="var(--ok)" stroke-width="2.5"${ring}/><path d="M17 29 L25 37 L40 20" fill="none" stroke="var(--ok)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"${draw}/>`
  const small: Look = { ...look, W: 56, enter: look.animate }

  return shell(small, 56, label, body, { draw: look.animate })
}

/** A strip of falling pieces for a milestone. Static scatter when `look.animate` is false. */
export const confettiSvg = (look: Look, label: string): string => {
  const W = look.W
  const colors = ['acc', 'k2', 'k3', 'k4', 'okf']
  let pieces = ''

  for (let i = 0; i < 28; i++) {
    const x = PAD + ((i * 97) % 1000) / 1000 * (W - PAD * 2)
    const y = 14 + ((i * 53) % 40)
    const cls = colors[i % colors.length]!
    const fall = look.animate ? ` style="transform-box:fill-box;transform-origin:center;animation:fall .9s cubic-bezier(.2,.8,.3,1) ${f((i % 7) * 0.07)}s both"` : ''
    pieces += i % 3 === 0 ? `<circle cx="${f(x)}" cy="${y}" r="3" class="${cls}"${fall}/>` : `<rect x="${f(x)}" y="${y}" width="6" height="9" rx="1.5" class="${cls}" transform="rotate(${(i * 37) % 90} ${f(x)} ${y})"${fall}/>`
  }

  return shell(look, 64, label, `<title>${esc(label)}</title>${pieces}<text x="${W / 2}" y="40" text-anchor="middle" class="lab" style="paint-order:stroke;stroke:var(--card);stroke-width:4px">${esc(label)}</text>`, { fall: look.animate })
}

/** Dots joined by lines for a stepper. */
export const stepperSvg = (steps: readonly string[], at: number, look: Look): string => {
  const W = look.W
  const n = steps.length
  const gap = (W - PAD * 2 - 24) / Math.max(1, n - 1)
  let g = ''

  steps.forEach((s, i) => {
    const x = PAD + 12 + i * gap
    const state = i < at ? 'done' : i === at ? 'now' : 'todo'

    if (i > 0) {
      g += `<line x1="${f(x - gap + 12)}" x2="${f(x - 12)}" y1="22" y2="22" stroke="var(--${i <= at ? 'acc' : 'line'})" stroke-width="2"/>`
    }
    g += `<g><title>${esc(`Step ${i + 1}: ${s} (${state})`)}</title><circle cx="${f(x)}" cy="22" r="11" class="${state === 'todo' ? 'track' : 'acc'}"/>${state === 'done' ? `<path d="M${f(x - 5)} 22 L${f(x - 1)} 26 L${f(x + 6)} 18" fill="none" stroke="var(--on)" stroke-width="2.2" stroke-linecap="round"/>` : `<text x="${f(x)}" y="26" text-anchor="middle" class="lab" style="fill:${state === 'now' ? 'var(--on)' : 'var(--mut)'}">${i + 1}</text>`}<text x="${f(x)}" y="48" text-anchor="middle" class="mut tiny">${esc(clip(s, gap, 9.5))}</text></g>`
  })

  return shell(look, 56, `Step ${at + 1} of ${n}: ${steps[at] ?? ''}`, g)
}
