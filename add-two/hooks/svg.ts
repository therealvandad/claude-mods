// Pure SVG drawing for add-two: the git graph (282) and the architecture box diagram (292).
// No `$`, no script, no links: every piece of text is escaped, every number clamped. Colours follow the app's
// light or dark mode through a media query inside the SVG. Nothing here animates.
import type { ArchNode, GraphRow } from '../types'
import { layoutGraph, refLabels } from './gitparse'
import { archOrderIds } from './learn'

export const esc = (s: string): string =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const n = (v: number): string => String(Math.round((Number.isFinite(v) ? v : 0) * 10) / 10)
const cut = (s: string, k: number) => (s.length > k ? `${s.slice(0, Math.max(0, k - 1))}…` : s)

export const MAX_SVG = 120_000

const STYLE =
  '<style>' +
  'text{font:11px ui-monospace,Menlo,Consolas,monospace}.t{fill:#1f2328}.s{fill:#6e7781}.b{fill:#cf222e}' +
  '.l0{stroke:#4b57c9;fill:#4b57c9}.l1{stroke:#2f8f4e;fill:#2f8f4e}.l2{stroke:#c4562f;fill:#c4562f}' +
  '.l3{stroke:#7b4bd0;fill:#7b4bd0}.l4{stroke:#a8741a;fill:#a8741a}.l5{stroke:#0e8a9a;fill:#0e8a9a}' +
  'path.e{fill:none;stroke-width:2;stroke-linecap:round}path.ln{fill:none}.nd{stroke:#fff;stroke-width:1.5}' +
  '.pill{fill:#eaeef2;stroke:#c9d1d9}.pt{fill:#1f2328}.hd{fill:#ddf4ff;stroke:#54aeff}.tg{fill:#fff8c5;stroke:#d4a72c}' +
  '.box{fill:#f6f8fa;stroke:#8c959f;stroke-width:1.2}.root{fill:#ddf4ff;stroke:#54aeff;stroke-width:1.4}.ln{stroke:#8c959f;stroke-width:1.2}' +
  '@media (prefers-color-scheme:dark){.t{fill:#e6edf3}.s{fill:#8b949e}.b{fill:#ff7b72}' +
  '.l0{stroke:#a9b4ff;fill:#a9b4ff}.l1{stroke:#5fbf7a;fill:#5fbf7a}.l2{stroke:#e08a68;fill:#e08a68}' +
  '.l3{stroke:#b08cff;fill:#b08cff}.l4{stroke:#f0b94a;fill:#f0b94a}.l5{stroke:#4cc9d8;fill:#4cc9d8}' +
  '.nd{stroke:#0d1117}.pill{fill:#21262d;stroke:#30363d}.pt{fill:#e6edf3}.hd{fill:#0c2d6b;stroke:#388bfd}.tg{fill:#3b2e00;stroke:#9e6a03}' +
  '.box{fill:#161b22;stroke:#6e7681}.root{fill:#0c2d6b;stroke:#388bfd}.ln{stroke:#6e7681}}' +
  '</style>'

const wrap = (w: number, h: number, body: string, label: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}" role="img" aria-label="${esc(label)}">${STYLE}${body}</svg>`

// ------------------------------------------------------------------ the git graph

const ROW = 24
const COL = 16
const LEFT = 10
const TOP = 6

export const graphSvg = (rows: readonly GraphRow[]): string => {
  const list = rows.filter(r => /^[0-9a-f]{40,64}$/.test(r.hash)).slice(0, 60)

  if (list.length === 0) {
    return wrap(200, 30, '<text class="s" x="10" y="20">no commits</text>', 'An empty git graph')
  }
  const lay = layoutGraph(list)
  const x = (c: number) => LEFT + c * COL + COL / 2
  const y = (r: number) => TOP + r * ROW + ROW / 2
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    const ym = (y1 + y2) / 2

    return x1 === x2 ? ` L${n(x2)} ${n(y2)}` : ` C${n(x1)} ${n(ym)} ${n(x2)} ${n(ym)} ${n(x2)} ${n(y2)}`
  }
  let edges = ''

  for (const e of lay.edges) {
    const lane = Math.min(11, Math.max(0, e.lane))
    const a = Math.min(11, Math.max(0, e.a))
    const b = Math.min(11, Math.max(0, e.b))
    let d = `M${n(x(a))} ${n(y(e.r0))}`

    if (e.r1 <= e.r0 + 1) {
      d += seg(x(a), y(e.r0), x(b), y(e.r1))
    } else {
      d += seg(x(a), y(e.r0), x(lane), y(e.r0 + 1))

      if (e.r1 - 1 > e.r0 + 1) d += seg(x(lane), y(e.r0 + 1), x(lane), y(e.r1 - 1))
      d += seg(x(lane), y(e.r1 - 1), x(b), y(e.r1))
    }
    edges += `<path class="e l${lane % 6}" d="${d}"/>`
  }
  const textX = LEFT + lay.width * COL + 12
  let nodes = ''
  let labels = ''
  let widest = 0

  list.forEach((row, i) => {
    const col = Math.min(11, lay.cols[i] ?? 0)
    const isHead = refLabels(row.refs).some(l => l.kind === 'head')
    const isMerge = row.parents.length > 1
    nodes += `<circle class="nd l${col % 6}" cx="${n(x(col))}" cy="${n(y(i))}" r="${isHead ? 6 : isMerge ? 5.5 : 4.5}"/>`
    let tx = textX
    let g = `<g><title>${esc(`${row.hash.slice(0, 12)}  ${row.subject}${row.refs !== '' ? `  (${row.refs})` : ''}`)}</title>`

    for (const l of refLabels(row.refs)) {
      const name = cut(l.name, 22)
      const w = name.length * 6.6 + 10
      const cls = l.kind === 'tag' ? 'tg' : l.kind === 'head' ? 'hd' : 'pill'
      g += `<rect class="${cls}" x="${n(tx)}" y="${n(y(i) - 8)}" width="${n(w)}" height="16" rx="8"/><text class="pt" x="${n(tx + 5)}" y="${n(y(i) + 4)}">${esc(name)}</text>`
      tx += w + 5
    }
    const subject = cut(row.subject, 80)
    g += `<text class="s" x="${n(tx)}" y="${n(y(i) + 4)}">${esc(row.hash.slice(0, 7))}</text><text class="t" x="${n(tx + 58)}" y="${n(y(i) + 4)}">${esc(subject)}</text></g>`
    widest = Math.max(widest, tx + 58 + subject.length * 6.6)
    labels += g
  })
  const w = Math.min(1100, Math.max(260, widest + 12))
  const h = TOP * 2 + list.length * ROW
  const svg = wrap(w, h, `${edges}${nodes}${labels}`, `Git graph of the last ${list.length} commits`)

  return svg.length <= MAX_SVG ? svg : wrap(260, 30, '<text class="s" x="10" y="20">graph too large to draw</text>', 'Git graph too large')
}

// ------------------------------------------------------------------ the architecture sketch

export const archSvg = (nodes: readonly ArchNode[]): string => {
  const order = archOrderIds(nodes).slice(0, 60)

  if (order.length === 0) {
    return wrap(220, 30, '<text class="s" x="10" y="20">no components yet</text>', 'An empty architecture sketch')
  }
  const BW = 124
  const BH = 40
  const GX = 14
  const GY = 34
  const byParent = new Map<number, ArchNode[]>()

  for (const { node } of order) byParent.set(node.parent, [...(byParent.get(node.parent) ?? []), node])
  const depthOf = new Map(order.map(o => [o.node.id, o.depth]))
  const xs = new Map<number, number>()
  let leaf = 0
  const store = (id: number): number => {
    const ks = byParent.get(id) ?? []
    let cx: number

    if (ks.length === 0) {
      cx = leaf * (BW + GX)
      leaf++
    } else {
      const cs = ks.map(k => store(k.id))
      cx = ((cs[0] as number) + (cs[cs.length - 1] as number)) / 2
    }

    if (id !== 0) xs.set(id, cx)

    return cx
  }

  for (const r of byParent.get(0) ?? []) store(r.id)
  const maxDepth = Math.max(...order.map(o => o.depth))
  const px = (id: number) => 10 + (xs.get(id) ?? 0)
  const py = (d: number) => 10 + d * (BH + GY)
  const w = 20 + Math.max(leaf, 1) * (BW + GX) - GX
  const h = 20 + (maxDepth + 1) * (BH + GY) - GY
  let lines = ''
  let boxes = ''

  for (const { node, depth } of order) {
    if (node.parent !== 0 && depthOf.has(node.parent)) {
      const pd = depthOf.get(node.parent) as number
      const x1 = px(node.parent) + BW / 2
      const y1 = py(pd) + BH
      const x2 = px(node.id) + BW / 2
      const y2 = py(depth)
      const ym = (y1 + y2) / 2
      lines += `<path class="ln" d="M${n(x1)} ${n(y1)} C${n(x1)} ${n(ym)} ${n(x2)} ${n(ym)} ${n(x2)} ${n(y2)}"/>`
    }
    const tip = `${node.name}${node.note !== '' ? `: ${node.note}` : ''}`
    boxes +=
      `<g><title>${esc(tip)}</title><rect class="${depth === 0 ? 'root' : 'box'}" x="${n(px(node.id))}" y="${n(py(depth))}" width="${BW}" height="${BH}" rx="6"/>` +
      `<text class="t" x="${n(px(node.id) + 8)}" y="${n(py(depth) + 17)}">${esc(cut(node.name, 17))}</text>` +
      (node.note !== '' ? `<text class="s" x="${n(px(node.id) + 8)}" y="${n(py(depth) + 31)}">${esc(cut(node.note, 17))}</text>` : '') +
      '</g>'
  }
  const svg = wrap(w, h, `${lines}${boxes}`, `Architecture sketch with ${order.length} components`)

  return svg.length <= MAX_SVG ? svg : wrap(260, 30, '<text class="s" x="10" y="20">sketch too large to draw</text>', 'Architecture sketch too large')
}

export const SVG_FORBIDDEN = /<script|\son[a-z]+\s*=|javascript:|<foreignObject|<image|<use\b|href=|<iframe|<object|<embed|<a\b|@import|url\(/i
