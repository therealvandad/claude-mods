// Pure SVG drawing for the visuals mod: BOLD edition. Big type, big rings, strong colour.
// No `$` here, so it is easy to test and preview. Light and dark follow the app through a media query.

export type Sample = { cost: number; ctx: number }
export type VisData = {
  startedAt: number
  contextPct: number
  spendUsd: number
  budgetUsd: number
  limitPct: number
  limitKind: string
  samples: Sample[]
  tools: Record<string, number>
  days: Record<string, number>
  isLive: boolean
  isDemo: boolean
}
export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'
export type Look = { accent: Accent; animate: boolean; elapsed: string; today: string }

// Light and dark accent colours (hex), because SVG cannot read the app's theme keys. Saturated on purpose.
const ACCENTS: Record<Accent, readonly [string, string]> = {
  suggestion: ['#3b46d6', '#9fb0ff'],
  claude: ['#d2511f', '#ff9466'],
  success: ['#1f8f45', '#52d17c'],
  warning: ['#b36b00', '#ffc247'],
  permission: ['#3b46d6', '#9fb0ff'],
  remember: ['#7a3ee0', '#c3a0ff'],
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
const f = (n: number) => String(Math.round(n * 100) / 100)

export const money = (n: number) => {
  const v = Number.isFinite(n) && n > 0 ? n : 0

  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
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

const toneClass = (pct: number) => (pct >= 85 ? 'bad' : pct >= 70 ? 'warn' : 'acc')
const rise = (a: boolean, i: number) => (a ? ` style="animation:rise .5s cubic-bezier(.2,.8,.2,1) ${f(i * 0.06)}s both"` : '')

// Tool kinds get their own hue, so the bars read at a glance.
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

// One big ring gauge, centred at (cx, cy). The sweep is a CSS animation on stroke-dashoffset (plays once).
const ring = (cx: number, cy: number, pct: number, big: string, label: string, sub: string, tip: string, delay: number, animate: boolean) => {
  const r = 70
  const c = 2 * Math.PI * r
  const p = clamp(pct, 0, 100)
  const target = c * (1 - p / 100)
  const tone = toneClass(p)
  const style = animate
    ? `stroke-dasharray:${f(c)};stroke-dashoffset:${f(target)};animation:sweep 1s cubic-bezier(.2,.8,.2,1) ${delay}s both;--from:${f(c)};--to:${f(target)}`
    : `stroke-dasharray:${f(c)};stroke-dashoffset:${f(target)}`
  let ticks = ''

  for (let i = 0; i < 40; i++) {
    const ang = (i / 40) * 2 * Math.PI
    const major = i % 10 === 0
    const r1 = 92
    const r2 = major ? 104 : 98
    ticks += `<line x1="${f(Math.sin(ang) * r1)}" y1="${f(-Math.cos(ang) * r1)}" x2="${f(Math.sin(ang) * r2)}" y2="${f(-Math.cos(ang) * r2)}" class="tick${major ? ' major' : ''}"/>`
  }

  return `<g transform="translate(${cx} ${cy})"><title>${esc(tip)}</title>
<g>${ticks}</g>
<circle r="${r}" class="track" fill="none" stroke-width="16"/>
<circle r="${r}" class="${tone} ringline" fill="none" stroke-width="16" stroke-linecap="round" transform="rotate(-90)" style="${style}" filter="url(#glow)"/>
<text y="8" text-anchor="middle" class="big">${esc(big)}</text>
<text y="34" text-anchor="middle" class="mut sm">${esc(sub)}</text>
<text y="140" text-anchor="middle" class="lab">${esc(label)}</text>
</g>`
}

const sparkline = (x: number, y: number, w: number, h: number, values: readonly number[], animate: boolean) => {
  const clean = values.length >= 2 ? values : [0, 0]
  const max = Math.max(...clean, 0.0001)
  const min = Math.min(...clean, 0)
  const span = Math.max(max - min, 0.0001)
  const pts = clean.map((v, i) => [x + (i / (clean.length - 1)) * w, y + h - ((v - min) / span) * (h - 14) - 6] as const)
  const d = smoothPath(pts)
  const last = pts[pts.length - 1]!
  const area = `${d} L${f(last[0])} ${f(y + h)} L${f(x)} ${f(y + h)} Z`
  const draw = animate ? 'stroke-dasharray:600;stroke-dashoffset:0;animation:draw 1.1s ease-out both' : ''
  const fade = animate ? 'animation:fadein .8s ease-out .3s both' : ''
  const grid = [0.25, 0.5, 0.75].map(k => `<line x1="${x}" x2="${x + w}" y1="${f(y + h * k)}" y2="${f(y + h * k)}" class="grid"/>`).join('')
  const lastVal = clean[clean.length - 1] ?? 0

  return `${grid}<path d="${area}" fill="url(#area)" style="${fade}"/>
<path d="${d}" fill="none" class="accline" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" pathLength="600" style="${draw}"/>
<circle cx="${f(last[0])}" cy="${f(last[1])}" r="6.5" class="dot"/>
<text x="${f(last[0] - 14)}" y="${f(clamp(last[1] + 6, y + 16, y + h - 2))}" text-anchor="end" class="valtxt">${esc(money(lastVal))}</text>
<text x="${x}" y="${f(y + h + 24)}" class="mut sm">start</text><text x="${x + w}" y="${f(y + h + 24)}" text-anchor="end" class="mut sm">now</text>`
}

const bars = (x: number, y: number, w: number, entries: readonly (readonly [string, number])[], animate: boolean) => {
  const max = Math.max(...entries.map(e => e[1]), 1)
  const nameW = 112
  const valW = 46
  const track = w - nameW - valW - 8

  return entries
    .map(([name, n], i) => {
      const yy = y + i * 38
      const bw = Math.max(14, (n / max) * track)
      const kind = toolKind(name)
      const grow = animate ? `transform-origin:${x + nameW}px ${yy + 11}px;animation:grow .6s cubic-bezier(.2,.8,.2,1) ${0.12 + i * 0.06}s both` : ''

      return `<g><title>${esc(name)}: ${n} call${n === 1 ? '' : 's'}</title><text x="${x}" y="${yy + 17}" class="lab">${esc(name.slice(0, 9))}</text>
<rect x="${x + nameW}" y="${yy}" width="${f(track)}" height="24" rx="12" class="track"/>
<rect x="${x + nameW}" y="${yy}" width="${f(bw)}" height="24" rx="12" class="k${kind}" style="${grow}"/>
<text x="${x + w}" y="${yy + 17}" text-anchor="end" class="valtxt">${n}</text></g>`
    })
    .join('\n')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const heat = (x: number, y: number, days: Record<string, number>, today: string, animate: boolean) => {
  const t = new Date(`${today}T12:00:00`).getTime()
  const cells: string[] = []
  const vals: number[] = []
  const keys: string[] = []
  const months: string[] = []
  const ox = x + 26
  const P = 21
  const S = 17

  for (let i = 0; i < 84; i++) {
    const d = new Date(t - (83 - i) * 86_400_000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    keys.push(key)
    vals.push(days[key] ?? 0)
  }
  const max = Math.max(...vals, 1)
  let lastMonth = -1

  vals.forEach((v, i) => {
    const col = Math.floor(i / 7)
    const row = i % 7
    const level = v === 0 ? 0 : 0.3 + 0.7 * (v / max)
    const delay = animate ? `animation:fadein .4s ease-out ${f(col * 0.02)}s both;` : ''
    const isToday = i === 83
    const key = keys[i]!
    const month = Number(key.slice(5, 7)) - 1

    if (row === 0 && month !== lastMonth) {
      months.push(`<text x="${ox + col * P}" y="${y - 10}" class="mut tiny">${MONTHS[month]}</text>`)
      lastMonth = month
    }
    cells.push(
      `<rect x="${ox + col * P}" y="${y + row * P}" width="${S}" height="${S}" rx="5" class="${level === 0 ? 'track' : 'accfill'}" style="${delay}${level === 0 ? '' : `opacity:${f(level)}`}"${isToday ? ' stroke-width="2" stroke="var(--text)"' : ''}><title>${key}: ${v} tool call${v === 1 ? '' : 's'}</title></rect>`,
    )
  })
  const days3 = [['M', 0], ['W', 2], ['F', 4]] as const
  const labels = days3.map(([n, r]) => `<text x="${x}" y="${y + r * P + 14}" class="mut tiny">${n}</text>`).join('')

  return `${labels}${months.join('')}${cells.join('\n')}`
}

const legendRow = (x: number, y: number) => {
  const sw = [0.15, 0.35, 0.6, 0.85, 1]
    .map((o, i) => `<rect x="${x + 44 + i * 22}" y="${y}" width="17" height="17" rx="5" class="${i === 0 ? 'track' : 'accfill'}" style="${i === 0 ? '' : `opacity:${o}`}"/>`)
    .join('')

  return `<text x="${x + 36}" y="${y + 14}" text-anchor="end" class="mut tiny">Less</text>${sw}<text x="${x + 44 + 5 * 22 + 4}" y="${y + 14}" class="mut tiny">More</text>`
}

const cleanNum = (n: number, lo: number, hi: number) => clamp(n, lo, hi)

// Never trust the numbers: stored or demo data may be odd. Clamp everything before drawing.
const sanitize = (d: VisData): VisData => ({
  ...d,
  contextPct: cleanNum(d.contextPct, 0, 100),
  limitPct: cleanNum(d.limitPct, 0, 100),
  spendUsd: cleanNum(d.spendUsd, 0, 1_000_000),
  budgetUsd: cleanNum(d.budgetUsd, 0, 1_000_000),
  samples: d.samples.map(x => ({ cost: cleanNum(x.cost, 0, 1_000_000), ctx: cleanNum(x.ctx, 0, 100) })),
  tools: Object.fromEntries(Object.entries(d.tools).map(([k, v]) => [k, Math.max(0, Math.round(Number.isFinite(v) ? v : 0))])),
  days: Object.fromEntries(Object.entries(d.days).map(([k, v]) => [k, Math.max(0, Number.isFinite(v) ? v : 0)])),
})

export const dashboardSvg = (raw: VisData, look: Look): string => {
  const d = sanitize(raw)
  const W = 760
  const [light, dark] = ACCENTS[look.accent]
  const a = look.animate
  const topTools = Object.entries(d.tools)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
  const spendSeries = d.samples.map(s => s.cost)
  const budgetPct = d.budgetUsd > 0 ? (d.spendUsd / d.budgetUsd) * 100 : 0
  const totalCalls = Object.values(d.days).reduce((s, n) => s + n, 0)
  const rings = [
    ring(127, 178, d.contextPct, `${Math.round(d.contextPct)}%`, 'Context', 'used', `Context window: ${Math.round(d.contextPct)}% used`, 0, a),
    ring(
      380,
      178,
      d.budgetUsd > 0 ? budgetPct : Math.min(100, d.spendUsd * 10),
      money(d.spendUsd),
      'Spend',
      d.budgetUsd > 0 ? `of ${money(d.budgetUsd)}` : 'session',
      d.budgetUsd > 0 ? `Spent ${money(d.spendUsd)} of your ${money(d.budgetUsd)} budget` : `Spent ${money(d.spendUsd)} this session (no budget set)`,
      0.1,
      a,
    ),
    ring(633, 178, d.limitPct, `${Math.round(d.limitPct)}%`, d.limitKind || 'Limit', 'used', `${d.limitKind || 'Rate'} limit: ${Math.round(d.limitPct)}% used`, 0.2, a),
  ].join('\n')
  const pill = d.isLive
    ? `<rect x="${W - 168}" y="22" width="152" height="38" rx="19" class="pill"/><circle cx="${W - 146}" cy="41" r="6" class="ok"/>${a ? `<circle cx="${W - 146}" cy="41" r="6" class="okfill ping"/>` : ''}<text x="${W - 130}" y="47" class="pilltxt">working</text>`
    : `<rect x="${W - 168}" y="22" width="152" height="38" rx="19" class="pill"/><circle cx="${W - 146}" cy="41" r="6" class="trackfill"/><text x="${W - 130}" y="47" class="pilltxt mut">idle</text>`
  const H = d.isDemo ? 924 : 890
  const demo = d.isDemo ? `<text x="28" y="${H - 18}" class="warnfill sm">Demo data: made up, nothing here was recorded. /visdemo off returns to your data.</text>` : ''
  const css = `
:root{--card:#ffffff;--line:#d9d4c7;--text:#1f1e1b;--mut:#6f6b62;--acc:${light};--ok:#1f8f45;--warn:#b36b00;--bad:#c4263f;--track:#e6e1d4;--k2:#7a3ee0;--k3:#c76f00;--k4:#12808f;--pill:#efe9d9}
@media (prefers-color-scheme:dark){:root{--card:#2b2b29;--line:#46453f;--text:#f4f1ea;--mut:#a39f95;--acc:${dark};--ok:#52d17c;--warn:#ffc247;--bad:#ff7a8a;--track:#3d3c37;--k2:#c3a0ff;--k3:#ffc247;--k4:#5fd8ea;--pill:#383731}}
text{font-family:-apple-system,system-ui,'Segoe UI',sans-serif;fill:var(--text)}
.big{font-size:36px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.xl{font-size:56px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.lab{font-size:17px;font-weight:700}
.valtxt{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.mut{fill:var(--mut)} .sm{font-size:15px;font-weight:500} .tiny{font-size:13px;font-weight:600}
.head{font-size:30px;font-weight:800;letter-spacing:-.02em}
.sub{font-size:17px;font-weight:500}
.pilltxt{font-size:16px;font-weight:700}
.cap{font-size:14px;font-weight:800;letter-spacing:.07em;fill:var(--mut)}
.card{fill:var(--card);stroke:var(--line);stroke-width:1.5}
.pill{fill:var(--pill)}
.track{stroke:var(--track);fill:var(--track)} circle.track{fill:none}
.trackfill{fill:var(--track)}
.tick{stroke:var(--mut);stroke-width:1.6;opacity:.3} .tick.major{opacity:.6;stroke-width:2.2}
.grid{stroke:var(--line);stroke-width:1.5;stroke-dasharray:3 6}
.acc{stroke:var(--acc)} .accfill{fill:var(--acc)} .accline{stroke:var(--acc)}
.k1{fill:var(--acc)} .k2{fill:var(--k2)} .k3{fill:var(--k3)} .k4{fill:var(--k4)}
.warn{stroke:var(--warn)} .bad{stroke:var(--bad)} .ok{fill:var(--ok)} .okfill{fill:var(--ok)}
.warnfill{fill:var(--warn)} .dot{fill:var(--acc);stroke:none}
.ringline{fill:none}
${a ? '.card{filter:drop-shadow(0 2px 4px rgba(0,0,0,.14))}' : ''}
${
  a
    ? `@keyframes sweep{from{stroke-dashoffset:var(--from)}to{stroke-dashoffset:var(--to)}}
@keyframes draw{from{stroke-dashoffset:600}to{stroke-dashoffset:0}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes ping{0%{transform:scale(1);opacity:.55}100%{transform:scale(3);opacity:0}}
.ping{transform-box:fill-box;transform-origin:center;animation:ping 1.6s ease-out 3}`
    : ''
}`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
<defs>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}" stop-opacity=".34"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></linearGradient>
</defs>
<style>${css}</style>
<text x="28" y="52" class="head">Session</text>
<text x="150" y="51" class="mut sub">${esc(look.elapsed)} elapsed</text>
${pill}
<g${rise(a, 0)}><rect x="16" y="74" width="728" height="268" rx="20" class="card"/>
${rings}</g>
<g${rise(a, 1)}><rect x="16" y="358" width="356" height="262" rx="20" class="card"/>
<text x="38" y="392" class="cap">SPEND OVER TIME</text>
${sparkline(40, 410, 312, 150, spendSeries.length >= 2 ? spendSeries : [0, 0], a)}</g>
<g${rise(a, 2)}><rect x="388" y="358" width="356" height="262" rx="20" class="card"/>
<text x="410" y="392" class="cap">TOP TOOLS</text>
${topTools.length > 0 ? bars(410, 414, 312, topTools, a) : `<text x="410" y="450" class="mut sub">No tool calls yet.</text>`}</g>
<g${rise(a, 3)}><rect x="16" y="636" width="728" height="238" rx="20" class="card"/>
<text x="38" y="670" class="cap">ACTIVITY, LAST 12 WEEKS</text>
${heat(38, 710, d.days, look.today, a)}
<text x="388" y="722" class="mut sub">tool calls</text>
<text x="388" y="780" class="xl">${totalCalls}</text>
<text x="388" y="806" class="mut sm">across ${Object.keys(d.days).length} active days</text>
${legendRow(520, 838)}</g>
${demo}
</svg>`
}

export const altText = (d: VisData): string =>
  `Session dashboard: context ${Math.round(clamp(d.contextPct, 0, 100))} percent, spend ${money(d.spendUsd)}, limit ${Math.round(clamp(d.limitPct, 0, 100))} percent, ${Object.values(d.tools).reduce((s, n) => s + n, 0)} tool calls.`

// Sample data for /visdemo and for previews.
export const demoData = (now: number): VisData => {
  const days: Record<string, number> = {}

  for (let i = 0; i < 84; i++) {
    const dt = new Date(now - i * 86_400_000)
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const wave = Math.sin(i / 3) + Math.cos(i / 5)

    if (i % 7 !== 0 && wave > -0.6) {
      days[key] = Math.round(3 + 9 * (wave + 1.6))
    }
  }

  return {
    startedAt: now - 47 * 60_000,
    contextPct: 63,
    spendUsd: 3.2,
    budgetUsd: 5,
    limitPct: 41,
    limitKind: 'Five hour',
    samples: [0.1, 0.3, 0.45, 0.9, 1.1, 1.0, 1.6, 2.0, 2.2, 2.9, 3.2].map((cost, i) => ({ cost, ctx: 10 + i * 5 })),
    tools: { Bash: 42, Read: 31, Edit: 19, Grep: 12, Write: 6 },
    days,
    isLive: true,
    isDemo: true,
  }
}
