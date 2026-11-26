// Pure SVG drawing for the cockpit Overview (desktop surface only): the tiles, git, the ring gauges,
// the per-turn charts, the limits, the test strip and the tool bars, as one picture.
// No `$` in here, so it is easy to test and to preview. The cards, type and themes are the ones of the
// status strip (hud.ts, panesvg.ts); the accent comes from the shared settings mod.
// It is drawn at the width it is shown, so nothing is scaled down. The entrance plays once.

import { stop } from './hud'
import type { HudTheme } from './hud'
import { card, describe, fit, shell, text, wrap, xml } from './panesvg'

export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'

export type VecData = {
  /** Context window percent now, or null when unknown. */
  contextPct: number | null
  /** Session spend in dollars, or null when unknown. */
  spendUsd: number | null
  /** Cumulative spend read after each turn. */
  costSamples: readonly number[]
  /** Context percent read after each turn. */
  ctxSamples: readonly number[]
  /** Latest reading per rate-limit kind, with the pace sentence when there is one. */
  limits: readonly { kind: string; pct: number; forecast?: { text: string; isUrgent: boolean } }[]
  /** Test runs, oldest first. */
  tests: readonly { ok: boolean }[]
  /** Tool call counts by tool name. */
  tools: Readonly<Record<string, number>>
  /** The five tiles; left out, the row is not drawn. */
  stats?: { prompts: number; tools: number; files: number; errors: number }
  /** Left out, the row is not drawn; null says there is no repository. */
  git?: { branch: string; ahead: number; behind: number; dirty: number } | null
}

export type VecLook = { accent: string; animate: boolean; width?: number; theme?: HudTheme }

// Light and dark accent colours (hex), because SVG cannot read the app's theme keys. Saturated on purpose.
const ACCENTS: Record<Accent, readonly [string, string]> = {
  suggestion: ['#3b46d6', '#9fb0ff'],
  claude: ['#d2511f', '#ff9466'],
  success: ['#1f8f45', '#52d17c'],
  warning: ['#b36b00', '#ffc247'],
  permission: ['#3b46d6', '#9fb0ff'],
  remember: ['#7a3ee0', '#c3a0ff'],
}

const accentPair = (name: string): readonly [string, string] =>
  Object.prototype.hasOwnProperty.call(ACCENTS, name) ? ACCENTS[name as Accent] : ACCENTS.suggestion

export const esc = (s: string): string => xml(s)

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
const f = (n: number) => String(Math.round(clamp(n, -100_000, 100_000) * 100) / 100)

export const money = (n: number): string => {
  const v = Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : 0

  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
}

/** The next round number above a spend: 1, 2, 5, 10, 20, 50 ... Used as the ring's full scale. */
export const niceCeil = (n: number): number => {
  const v = clamp(n, 0, 1_000_000)
  let base = 1

  for (let guard = 0; guard < 12; guard++) {
    for (const k of [1, 2, 5]) {
      if (v <= base * k) {
        return base * k
      }
    }
    base *= 10
  }

  return base
}

// Catmull-Rom through the points, as cubic Bezier segments: a smooth line, not a zig-zag.
export const smoothPath = (pts: readonly (readonly [number, number])[]): string => {
  const first = pts[0]

  if (first === undefined) {
    return ''
  }

  if (pts.length === 1) {
    return `M${f(first[0])} ${f(first[1])}`
  }
  let d = `M${f(first[0])} ${f(first[1])}`

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`
  }

  return d
}

const toneOf = (pct: number): 'ok' | 'warn' | 'bad' => (pct >= 85 ? 'bad' : pct >= 70 ? 'warn' : 'ok')

// Tool kinds get their own gradient, so the bars read at a glance.
export const toolKind = (name: string): 1 | 2 | 3 | 4 => {
  if (/^(bash|shell|run)/i.test(name)) {
    return 2
  }

  if (/^(edit|write|notebook|multi)/i.test(name)) {
    return 3
  }

  if (/^(grep|glob|search|web|find|ls)/i.test(name)) {
    return 4
  }

  return 1
}

const KIND_FILL = { 1: 'url(#acc)', 2: 'url(#g-ok)', 3: 'url(#g-warn)', 4: 'url(#g-run)' } as const

const kindLabel = (kind: string) => {
  const s = kind.replace(/_/g, ' ').trim()
  const out = s === '' ? 'Limit' : s.charAt(0).toUpperCase() + s.slice(1)
  const chars = [...out]

  return chars.length > 14 ? `${chars.slice(0, 13).join('')}...` : out
}

const count = (n: number) => Math.round(clamp(n, 0, 1_000_000))

// ---------------------------------------------------------------- pieces

type Piece = { body: string; h: number }

const PAD = 14
const GAP = 10

const tiles = (W: number, s: NonNullable<VecData['stats']>, spend: number | null): Piece => {
  const all = [
    ['Prompts', String(count(s.prompts))],
    ['Tools', String(count(s.tools))],
    ['Files', String(count(s.files))],
    ['Errors', String(count(s.errors))],
    ['Spend', spend === null ? 'n/a' : money(spend)],
  ] as const
  const col = (W - PAD * 2) / all.length

  return {
    h: 62,
    body:
      card(0, 0, W, 62) +
      all
        .map(([label, value], i) => {
          const x = PAD + i * col + col / 2
          const isBad = label === 'Errors' && count(s.errors) > 0

          return `<g><title>${xml(label)}: ${xml(value)}</title>${text(x, 31, value, 'big', ` text-anchor="middle"${isBad ? ' style="fill:var(--bad1)"' : ''}`)}${text(x, 48, label.toUpperCase(), 'cap', ' text-anchor="middle"')}${i === 0 ? '' : `<line x1="${f(PAD + i * col)}" y1="16" x2="${f(PAD + i * col)}" y2="46" class="hair"/>`}</g>`
        })
        .join(''),
  }
}

const gitRow = (W: number, git: NonNullable<VecData['git']> | null): Piece => {
  let body = card(0, 0, W, 38) + text(PAD, 23, 'GIT', 'cap')

  if (git === null) {
    return { h: 38, body: body + text(PAD + 30, 23.5, fit('Not a git repository, or git is unavailable.', W - PAD * 2 - 30), 'r m') }
  }
  const chips = [
    [`+${count(git.ahead)}`, '--live'],
    [`-${count(git.behind)}`, '--warn1'],
    [`${count(git.dirty)} dirty`, count(git.dirty) > 0 ? '--warn1' : '--live'],
  ] as const
  const widths = chips.map(([label]) => Math.max(34, label.length * 7.6 + 16))
  let x = W - PAD - widths.reduce((s, w) => s + w + 6, -6)
  body += text(PAD + 30, 23.5, fit(git.branch, x - PAD - 40, { bold: true }), 'rb')

  for (const [i, [label, tone]] of chips.entries()) {
    const w = widths[i] ?? 40
    body += `<rect x="${f(x)}" y="9" width="${f(w)}" height="20" rx="10" style="fill:var(${tone})" fill-opacity=".14"/>${text(x + w / 2, 23, label, 'sb', ` text-anchor="middle" style="fill:var(${tone})"`)}`
    x += w + 6
  }

  return { h: 38, body }
}

type Ring = { pct: number; big: string; label: string; sub: string; tip: string; fill: string; glow: string; delay: number }

// One ring gauge with a glowing tip. The sweep is a CSS animation on stroke-dashoffset (plays once).
const ring = (cx: number, cy: number, r: number, o: Ring, animate: boolean) => {
  const c = 2 * Math.PI * r
  const p = clamp(o.pct, 0, 100)
  const target = c * (1 - p / 100)
  const style = animate
    ? `stroke-dasharray:${f(c)};stroke-dashoffset:${f(target)};animation:sweep .9s cubic-bezier(.2,.8,.2,1) ${f(o.delay)}s both;--from:${f(c)};--to:${f(target)}`
    : `stroke-dasharray:${f(c)};stroke-dashoffset:${f(target)}`
  const angle = (p / 100) * 2 * Math.PI - Math.PI / 2
  const tx = cx + r * Math.cos(angle)
  const ty = cy + r * Math.sin(angle)
  const arc =
    p <= 0
      ? ''
      : `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="none" stroke-width="9" stroke-linecap="round" stroke="${o.fill}" transform="rotate(-90 ${f(cx)} ${f(cy)})" style="${style}"/><g${animate ? ` style="animation:fadein .25s ease-out ${f(o.delay + 0.8)}s both"` : ''}><circle cx="${f(tx)}" cy="${f(ty)}" r="9.5" style="fill:var(${o.glow})" opacity=".28"/><circle cx="${f(tx)}" cy="${f(ty)}" r="3" style="fill:var(--shine)"/></g>`

  return `<g><title>${xml(o.tip)}</title><circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="none" stroke-width="9" style="stroke:var(--track)"/>${arc}${text(cx, cy + 3, o.big, o.big.length > 6 ? 'rb' : 'big', ' text-anchor="middle"')}${text(cx, cy + 19, o.sub, 'tiny', ' text-anchor="middle"')}${text(cx, cy + r + 23, o.label.toUpperCase(), 'cap', ' text-anchor="middle"')}</g>`
}

type Spark = { values: readonly number[]; unit: 'usd' | 'pct'; title: string; right: string; rightTip: string; animate: boolean; id: string; isStacked: boolean }

const sparkCard = (W: number, o: Spark): Piece => {
  // Stacked and with nothing to draw yet, the card only needs room for its sentence.
  const H = o.isStacked && o.values.length < 2 ? 70 : 142
  const x = PAD
  const y = 38
  const w = W - PAD * 2
  const h = 80
  let body =
    card(0, 0, W, H) +
    text(PAD, 23, o.title, 'cap') +
    (o.right === '' ? '' : `<text x="${W - PAD}" y="27" class="big" text-anchor="end"><title>${xml(o.rightTip)}</title>${xml(o.right)}</text>`)

  if (o.values.length < 2) {
    return { h: H, body: body + text(PAD, H === 70 ? 50 : 80, 'Fills in after the second reply.', 'r m') }
  }
  const isPct = o.unit === 'pct'
  const top = isPct ? 100 : Math.max(...o.values, 0.01)
  const py = (v: number) => y + h - 4 - (v / top) * (h - 10)
  const pts = o.values.map((v, i) => [x + 4 + (i / (o.values.length - 1)) * (w - 8), py(v)] as const)
  const d = smoothPath(pts)
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  const draw = o.animate ? 'stroke-dasharray:900;stroke-dashoffset:0;animation:draw .9s ease-out both' : ''
  const fade = o.animate ? ' style="animation:fadein .6s ease-out .3s both"' : ''
  const grid = isPct
    ? `<line x1="${x}" x2="${f(x + w)}" y1="${f(py(70))}" y2="${f(py(70))}" class="grid warnline"/><line x1="${x}" x2="${f(x + w)}" y1="${f(py(85))}" y2="${f(py(85))}" class="grid badline"/>${text(x, py(70) + 11, '70%', 'tiny')}${text(x, py(85) - 3, '85%', 'tiny')}`
    : [0.33, 0.66].map(k => `<line x1="${x}" x2="${f(x + w)}" y1="${f(y + h * k)}" y2="${f(y + h * k)}" class="grid"/>`).join('')
  const tipFor = (v: number, i: number) => (isPct ? `Turn ${i + 1}: ${Math.round(v)}%` : `Turn ${i + 1}: ${money(v)}`)
  const hits = pts
    .map((p, i) => `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${o.values.length > 24 ? 4 : 8}" fill="transparent"><title>${xml(tipFor(o.values[i] ?? 0, i))}</title></circle>`)
    .join('')
  // Gradients in page units: a flat line has no height, and a box gradient would not paint it.
  const grad = `<linearGradient id="${o.id}" gradientUnits="userSpaceOnUse" x1="${x}" y1="0" x2="${f(x + w)}" y2="0"><stop offset="0" style="stop-color:var(${isPct ? '--e1' : '--acc'})"/><stop offset=".6" style="stop-color:var(--e2)"/><stop offset="1" style="stop-color:var(--e3)"/></linearGradient>`

  body += `${grad}${grid}<path d="${d} L${f(last[0])} ${y + h} L${f(first[0])} ${y + h} Z" fill="url(#area)"${fade}/>
<path d="${d}" fill="none" stroke="url(#${o.id})" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" pathLength="900" style="${draw}"/>
<circle cx="${f(last[0])}" cy="${f(last[1])}" r="9" style="fill:var(--e3)" opacity=".28"/><circle cx="${f(last[0])}" cy="${f(last[1])}" r="3" style="fill:var(--shine);stroke:var(--e2);stroke-width:1.5"/>${hits}
${text(x, H - 9, 'Turn 1', 'tiny')}${text(x + w, H - 9, `Turn ${o.values.length}`, 'tiny', ' text-anchor="end"')}`

  return { h: H, body }
}

type Limit = VecData['limits'][number]

const limitsCard = (W: number, limits: readonly Limit[], animate: boolean): Piece => {
  let y = 34
  let body = text(PAD, 23, 'LIMITS', 'cap')

  for (const [i, l] of limits.entries()) {
    const pct = Math.round(l.pct)
    const grow = animate ? ` style="transform-origin:${PAD}px ${y + 24}px;animation:grow .7s cubic-bezier(.2,.8,.2,1) ${f(0.1 + i * 0.05)}s both"` : ''
    body += `${text(PAD, y + 14, fit(kindLabel(l.kind), W * 0.6, { bold: true }), 'rb')}${text(W - PAD, y + 14, `${pct}%`, 'rb', ' text-anchor="end"')}<rect x="${PAD}" y="${y + 21}" width="${W - PAD * 2}" height="6" rx="3" class="track"/>${pct > 0 ? `<rect x="${PAD}" y="${y + 21}" width="${f(Math.max(6, (l.pct / 100) * (W - PAD * 2)))}" height="6" rx="3" fill="url(#g-${toneOf(l.pct)})"${grow}/>` : ''}`
    y += 32

    if (l.forecast !== undefined) {
      for (const line of wrap(l.forecast.text, W - PAD * 2, 3, { size: 12 })) {
        body += text(PAD, y + 12, line, 'fc', l.forecast.isUrgent ? ' style="fill:var(--warn1)"' : '')
        y += 15
      }
      y += 3
    }
    y += 4
  }

  return { h: y + 6, body: card(0, 0, W, y + 6) + body }
}

const testsCard = (W: number, H: number, runs: readonly { ok: boolean }[], animate: boolean): Piece => {
  const passed = runs.filter(t => t.ok).length
  const gap = 5
  const size = Math.min(19, Math.floor((W - PAD * 2 - gap * 9) / 10))
  let body =
    card(0, 0, W, H) +
    text(PAD, 23, 'TEST RUNS', 'cap') +
    (runs.length === 0 ? '' : `<text x="${W - PAD}" y="27" class="big" text-anchor="end"><title>${passed} of ${runs.length} test runs passed</title>${passed}/${runs.length}</text>`)

  if (runs.length === 0) {
    return { h: H, body: body + text(PAD, 66, 'No test commands seen yet.', 'r m') }
  }
  const k = size / 24

  body += runs
    .map((r, i) => {
      const sx = PAD + (i % 10) * (size + gap)
      const sy = 42 + Math.floor(i / 10) * (size + gap)
      const delay = animate ? ` style="animation:fadein .3s ease-out ${f(0.1 + i * 0.02)}s both"` : ''
      const mark = r.ok
        ? `<path d="M${f(sx + 6.3 * k)} ${f(sy + 12.6 * k)}L${f(sx + 10.5 * k)} ${f(sy + 16.5 * k)}L${f(sx + 17.7 * k)} ${f(sy + 7.8 * k)}" class="glyph"/>`
        : `<path d="M${f(sx + 8 * k)} ${f(sy + 8 * k)}L${f(sx + 16 * k)} ${f(sy + 16 * k)}M${f(sx + 16 * k)} ${f(sy + 8 * k)}L${f(sx + 8 * k)} ${f(sy + 16 * k)}" class="glyph"/>`

      return `<g${delay}><title>Test run ${i + 1}: ${r.ok ? 'passed' : 'failed'}</title><rect x="${f(sx)}" y="${f(sy)}" width="${size}" height="${size}" rx="6" fill="url(#g-${r.ok ? 'run' : 'bad'})"/>${mark}</g>`
    })
    .join('')

  return { h: H, body }
}

const toolsCard = (W: number, H: number, top: readonly (readonly [string, number])[], total: number, animate: boolean): Piece => {
  let body =
    card(0, 0, W, H) +
    text(PAD, 23, 'TOOLS USED', 'cap') +
    (total === 0 ? '' : `<text x="${W - PAD}" y="27" class="big" text-anchor="end"><title>${total} tool call${total === 1 ? '' : 's'} in this session</title>${total}</text>`)

  if (top.length === 0) {
    return { h: H, body: body + text(PAD, 66, 'No tool calls yet.', 'r m') }
  }
  const max = Math.max(...top.map(e => e[1]), 1)
  const labW = Math.min(86, W * 0.34)
  const trackW = W - PAD * 2 - labW - 52

  body += top
    .map(([name, n], i) => {
      const y = 40 + i * 24
      const bw = clamp((n / max) * trackW, 8, trackW)
      const grow = animate ? ` style="transform-origin:${f(PAD + labW)}px ${y + 8}px;animation:grow .6s cubic-bezier(.2,.8,.2,1) ${f(0.12 + i * 0.06)}s both"` : ''

      return `<g><title>${xml(name)}: ${n} call${n === 1 ? '' : 's'}</title>${text(PAD, y + 13, fit(name, labW - 6, { bold: true }), 'rb')}<rect x="${f(PAD + labW)}" y="${y + 4}" width="${f(trackW)}" height="9" rx="4.5" class="track"/><rect x="${f(PAD + labW)}" y="${y + 4}" width="${f(bw)}" height="9" rx="4.5" fill="${KIND_FILL[toolKind(name)]}"${grow}/>${text(W - PAD, y + 13, String(n), 'rb', ' text-anchor="end"')}</g>`
    })
    .join('')

  return { h: H, body }
}

// ---------------------------------------------------------------- the picture

/** Clamp every number: stored or odd data must never draw outside its box. */
const sanitize = (d: VecData) => ({
  contextPct: d.contextPct === null ? null : clamp(d.contextPct, 0, 100),
  spendUsd: d.spendUsd === null ? null : clamp(d.spendUsd, 0, 1_000_000),
  costSamples: d.costSamples.slice(-40).map(v => clamp(v, 0, 1_000_000)),
  ctxSamples: d.ctxSamples.slice(-40).map(v => clamp(v, 0, 100)),
  limits: d.limits.slice(0, 8).map(l => ({
    kind: String(l.kind).slice(0, 60),
    pct: clamp(l.pct, 0, 100),
    ...(l.forecast === undefined ? {} : { forecast: { text: String(l.forecast.text).slice(0, 200), isUrgent: l.forecast.isUrgent === true } }),
  })),
  tests: d.tests.slice(-20).map(t => ({ ok: t.ok === true })),
  allTools: Object.entries(d.tools)
    .map(([k, v]) => [String(k).slice(0, 60), Math.max(0, Math.min(1_000_000, Math.round(Number.isFinite(v) ? v : 0)))] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]),
})

export const vecDashSvg = (raw: VecData, look: VecLook): string => {
  const d = sanitize(raw)
  const a = look.animate
  const theme = look.theme ?? 'glass'
  const [light, dark] = accentPair(look.accent)
  const W = Math.round(clamp(look.width ?? 560, 360, 600))
  const isWide = W >= 500
  const half = isWide ? (W - GAP) / 2 : W
  const worst = d.limits.reduce<(typeof d.limits)[number] | undefined>((m, l) => (m === undefined || l.pct > m.pct ? l : m), undefined)
  const spendScale = niceCeil(d.spendUsd ?? 0)
  const ctxPct = d.contextPct ?? 0
  const totalCalls = d.allTools.reduce((s, t) => s + t[1], 0)
  const lastCost = d.costSamples[d.costSamples.length - 1]
  const lastCtx = d.ctxSamples[d.ctxSamples.length - 1]

  const col = W / 3
  const r = Math.min(46, Math.floor(col / 2) - 16)
  const cy = r + 20
  const ringsH = cy + r + 38
  const gauges: Ring[] = [
    {
      pct: ctxPct,
      big: d.contextPct === null ? 'n/a' : `${Math.round(ctxPct)}%`,
      label: 'Context',
      sub: 'used',
      tip: d.contextPct === null ? 'Context window: no reading yet' : `Context window: ${Math.round(ctxPct)}% used`,
      fill: `url(#g-${toneOf(ctxPct)})`,
      glow: ctxPct >= 85 ? '--bad2' : ctxPct >= 70 ? '--warn2' : '--ok2',
      delay: 0,
    },
    {
      pct: ((d.spendUsd ?? 0) / spendScale) * 100,
      big: d.spendUsd === null ? 'n/a' : money(d.spendUsd),
      label: 'Spend',
      sub: d.spendUsd === null ? 'no reading' : `of ${money(spendScale)}`,
      tip:
        d.spendUsd === null
          ? 'Spend: no reading yet'
          : `Spent ${money(d.spendUsd)} this session. The ring fills against the next round number (${money(spendScale)}); it is not a budget.`,
      fill: 'url(#acc)',
      glow: '--e2',
      delay: 0.08,
    },
    {
      pct: worst?.pct ?? 0,
      big: worst === undefined ? 'n/a' : `${Math.round(worst.pct)}%`,
      label: worst === undefined ? 'Rate limit' : kindLabel(worst.kind),
      sub: worst === undefined ? 'no reading' : 'used',
      tip: worst === undefined ? 'Rate limits: no reading yet' : `${kindLabel(worst.kind)} limit: ${Math.round(worst.pct)}% used (the highest of ${d.limits.length})`,
      fill: `url(#g-${toneOf(worst?.pct ?? 0)})`,
      glow: (worst?.pct ?? 0) >= 85 ? '--bad2' : (worst?.pct ?? 0) >= 70 ? '--warn2' : '--ok2',
      delay: 0.16,
    },
  ]
  const rings: Piece = {
    h: ringsH,
    body: card(0, 0, W, ringsH) + gauges.map((g, i) => ring(col * i + col / 2, cy, r, g, a)).join(''),
  }

  const spend = sparkCard(half, { values: d.costSamples, unit: 'usd', title: 'SPEND PER TURN', right: lastCost === undefined ? '' : money(lastCost), rightTip: 'Spend after the latest turn', animate: a, id: 'spendline', isStacked: !isWide })
  const ctx = sparkCard(half, { values: d.ctxSamples, unit: 'pct', title: 'CONTEXT PER TURN', right: lastCtx === undefined ? '' : `${Math.round(lastCtx)}%`, rightTip: 'Context used after the latest turn', animate: a, id: 'ctxline', isStacked: !isWide })
  // Side by side the two share one height; stacked, each takes only its own.
  const testsH = d.tests.length > 10 ? 100 : 82
  const toolsH = Math.max(82, 46 + Math.min(3, d.allTools.length) * 24)
  const tests = testsCard(half, isWide ? Math.max(testsH, toolsH) : testsH, d.tests, a)
  const tools = toolsCard(half, isWide ? Math.max(testsH, toolsH) : toolsH, d.allTools.slice(0, 3), totalCalls, a)

  // Rows of one or two cards, stacked from the top.
  const rows: Piece[][] = [
    ...(raw.stats === undefined ? [] : [[tiles(W, raw.stats, d.spendUsd)]]),
    ...(raw.git === undefined ? [] : [[gitRow(W, raw.git)]]),
    [rings],
    ...(isWide ? [[spend, ctx]] : [[spend], [ctx]]),
    ...(d.limits.length === 0 ? [] : [[limitsCard(W, d.limits, a)]]),
    ...(isWide ? [[tests, tools]] : [[tests], [tools]]),
  ]
  let y = 0
  let body = ''

  for (const [i, row] of rows.entries()) {
    const rise = a ? ` style="animation:rise .45s cubic-bezier(.2,.8,.2,1) ${f(Math.min(i, 5) * 0.05)}s both"` : ''
    const cells = row.map((piece, j) => `<g transform="translate(${f(j * (half + GAP))} ${f(y)})">${piece.body}</g>`).join('')
    body += `<g${rise}>${cells}</g>\n`
    y += Math.max(...row.map(p => p.h)) + GAP
  }

  const accent = theme === 'glass' ? `:root{--acc:${light}}\n@media (prefers-color-scheme:dark){:root{--acc:${dark}}}` : `:root{--acc:${theme === 'paper' ? light : dark}}`
  const css = `
${accent}
.tiny{font-size:11px;font-weight:600;fill:var(--mut)}
.fc{font-size:12px;fill:var(--mut)}
.grid{stroke:var(--hair);stroke-width:1.2;stroke-dasharray:3 5}
.warnline{stroke:var(--warn1);opacity:.55} .badline{stroke:var(--bad1);opacity:.55}
.glyph{stroke:#ffffff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;fill:none}
${
  a
    ? `@keyframes sweep{from{stroke-dashoffset:var(--from)}to{stroke-dashoffset:var(--to)}}
@keyframes draw{from{stroke-dashoffset:900}to{stroke-dashoffset:0}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes fadein{from{opacity:.35}to{opacity:1}}
@keyframes rise{from{opacity:.55;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`
    : ''
}`
  const defs = `${stop('acc', '--acc', '--e2')}<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--e2);stop-opacity:.30"/><stop offset="1" style="stop-color:var(--e1);stop-opacity:0"/></linearGradient>`

  return shell(W, y - GAP, theme, body.trimEnd(), css, defs)
}

export const vecAlt = (raw: VecData): string => {
  const d = sanitize(raw)
  const worst = d.limits.reduce((m, l) => Math.max(m, l.pct), 0)
  const passed = d.tests.filter(t => t.ok).length
  const tiles =
    raw.stats === undefined
      ? ''
      : ` ${count(raw.stats.prompts)} prompts, ${count(raw.stats.tools)} tools, ${count(raw.stats.files)} files, ${count(raw.stats.errors)} errors.`
  const git =
    raw.git === undefined
      ? ''
      : raw.git === null
        ? ' Not a git repository, or git is unavailable.'
        : ` Git ${raw.git.branch.slice(0, 80)}, +${count(raw.git.ahead)} -${count(raw.git.behind)}, ${count(raw.git.dirty)} dirty.`
  const forecasts = d.limits.flatMap(l => (l.forecast === undefined ? [] : [` ${l.forecast.text}`])).join('')

  return describe(`Session charts: context ${d.contextPct === null ? 'unknown' : `${Math.round(d.contextPct)} percent`}, spend ${d.spendUsd === null ? 'unknown' : money(d.spendUsd)}, highest rate limit ${d.limits.length === 0 ? 'unknown' : `${Math.round(worst)} percent`}, ${d.costSamples.length} turns of spend, ${passed} of ${d.tests.length} test runs passed.${tiles}${git}${forecasts}`)
}
