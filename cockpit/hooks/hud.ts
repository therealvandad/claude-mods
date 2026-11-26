// The status strip above the prompt (desktop only). Pure drawing, no `$`.
// Premium finish: gradient glass card, gradient rings with a glowing tip, a faint context trend
// behind the numbers. It is drawn at the width it is shown (never scaled), so the text keeps its size.
// Loops run only WHILE Claude is working; finishing effects play a fixed number of times and stop.

export type HudTheme = 'glass' | 'midnight' | 'paper' | 'neon'
export type HudTone = 'live' | 'idle' | 'amber' | 'red' | 'thinking' | 'reading' | 'editing' | 'testing' | 'running' | 'asking'

export type HudData = {
  contextPct: number | null
  limitPct: number | null
  limitName: string
  spendUsd: number | null
  isWorking: boolean
  tool: string
  toolCalls: number
  /** Context percent after each turn, oldest first: drawn as a faint trend behind the strip. */
  trend: readonly number[]
  /** False when motion is off or calm is on. */
  animate: boolean
  width?: number
  theme?: HudTheme
  /** Edge colour that follows the state; absent keeps the three-colour edge. */
  edge?: 'blue' | 'amber' | 'red' | 'green'
  /** Replaces the working/ready word, the dot colour and the small line under it. */
  state?: { word?: string; sub?: string; tone?: HudTone }
  /** A soft green glow, played twice: a task just finished. */
  glow?: boolean
  /** A red flash, played three times: a command just failed. */
  flash?: boolean
  /** A green band crossing the card twice: the tests just passed. */
  celebrate?: boolean
  /** Bars moving under the state word while working. */
  wave?: boolean
  /** The count of saved files; a new count plays one ring around the dot. */
  pulse?: number
  /** The earlier figures: the old number slides up and the new one slides in. */
  roll?: { contextPct?: number | null; spendUsd?: number | null }
  /** Local hour 0-23 for the day-to-night tint. */
  hour?: number
}

export const HUD_W = 400
export const HUD_H = 70
export const HUD_MIN_W = 300

export const esc = (s: string) =>
  s
    // Control characters are not allowed in XML at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
export const f = (n: number) => String(Math.round(n * 100) / 100)
const tone = (p: number) => (p >= 85 ? 'bad' : p >= 70 ? 'warn' : 'ok')
export const money = (n: number) => {
  const v = clamp(n, 0, 1_000_000)

  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
}
/** Cuts by whole characters, so an emoji is never split in half. */
export const short = (s: string, max: number) => {
  const chars = [...s]

  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : s
}

export const limitLabel = (kind: string): string => {
  if (kind === 'five_hour') {
    return '5-hour'
  }

  if (kind === 'seven_day') {
    return '7-day'
  }

  return short(kind.replace(/_/g, ' ') || 'limit', 9)
}

const DARK =
  '--top:#2a2a33;--bottom:#17171d;--text:#f6f5fa;--mut:#a5a2b1;--track:#ffffff17;--hair:#ffffff14;--shine:#ffffff;--e1:#7c8cff;--e2:#c07bff;--e3:#3fe0d0;--ok1:#6aa8ff;--ok2:#b78cff;--warn1:#ffcf5c;--warn2:#ff7a45;--bad1:#ff8aa0;--bad2:#ff3d6e;--live:#4ef0a0'
const LIGHT =
  '--top:#ffffff;--bottom:#f3efe6;--text:#17161a;--mut:#6b665e;--track:#e7e2d6;--hair:#00000014;--shine:#ffffff;--e1:#5b6cff;--e2:#b45cff;--e3:#18b6b0;--ok1:#2f6bff;--ok2:#8b4dff;--warn1:#c97d00;--warn2:#ff5f2e;--bad1:#ff3d6e;--bad2:#c4123a;--live:#0f8f46'
const FIXED: Record<Exclude<HudTheme, 'glass'>, string> = {
  midnight:
    '--top:#16213f;--bottom:#0a0f22;--text:#eef2ff;--mut:#93a0c8;--track:#ffffff1c;--hair:#ffffff18;--shine:#ffffff;--e1:#4f7dff;--e2:#7a5cff;--e3:#2fd0ff;--ok1:#5aa2ff;--ok2:#8f7bff;--warn1:#ffd166;--warn2:#ff8a4c;--bad1:#ff8fa8;--bad2:#ff3d6e;--live:#52f2b0',
  paper:
    '--top:#fdf9ee;--bottom:#f4ecd8;--text:#2b2418;--mut:#6f644e;--track:#e5dabd;--hair:#2b241822;--shine:#fffdf6;--e1:#8a6d3b;--e2:#b4893f;--e3:#8a6d3b;--ok1:#2f5d8a;--ok2:#5a4a8a;--warn1:#b26b00;--warn2:#c4501d;--bad1:#c0304f;--bad2:#8f1030;--live:#2f7d46',
  neon:
    '--top:#0b0714;--bottom:#030206;--text:#f4fbff;--mut:#8fd9e6;--track:#ffffff1a;--hair:#00f0ff33;--shine:#ffffff;--e1:#00f0ff;--e2:#ff2bd6;--e3:#7dff4d;--ok1:#00f0ff;--ok2:#b04dff;--warn1:#ffe14d;--warn2:#ff8a1f;--bad1:#ff4d8d;--bad2:#ff1f4f;--live:#39ff88',
}

/** The colour variables of a theme. Glass follows the app's light or dark look; the others are fixed. */
export const themeCss = (theme: HudTheme = 'glass'): string =>
  theme === 'glass' ? `:root{${LIGHT}}\n@media (prefers-color-scheme:dark){:root{${DARK}}}` : `:root{${FIXED[theme]}}`

export const FONT = "-apple-system,system-ui,'Segoe UI',sans-serif"

/** The sky tint for an hour of the day: dawn, day, dusk, night. */
export const tintOf = (hour: number): string => {
  const h = clamp(Math.floor(hour), 0, 23)

  return h >= 5 && h < 8 ? '#ff8fab' : h >= 8 && h < 17 ? '#4fb3ff' : h >= 17 && h < 20 ? '#ff9a3d' : '#5b4bd6'
}

export const stop = (id: string, a: string, b: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(${a})"/><stop offset="1" style="stop-color:var(${b})"/></linearGradient>`

/** Where each part sits at a width. Narrow strips use smaller rings; under 348px spend is left out. */
export const zonesOf = (width: number): { step: number; r: number; spend: number | null; state: number } => {
  if (width >= 388) {
    return { step: 108, r: 21, spend: 216, state: 296 }
  }

  return width >= 348 ? { step: 98, r: 18, spend: 192, state: 258 } : { step: 104, r: 18, spend: null, state: 208 }
}

const gauge = (x: number, r: number, textAt: number, value: string, pct: number | null, label: string, tip: string) => {
  // The small rings of a narrow strip sit a little closer to their edge.
  const cx = x + r + (r >= 21 ? 11 : 9)
  const cy = 35
  const c = 2 * Math.PI * r
  const p = pct === null ? 0 : clamp(pct, 0, 100)
  let arc = ''

  if (pct !== null && p > 0) {
    const t = tone(p)
    const angle = (p / 100) * 2 * Math.PI - Math.PI / 2
    const tx = cx + r * Math.cos(angle)
    const ty = cy + r * Math.sin(angle)
    arc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="6" stroke-linecap="round" stroke="url(#g-${t})" transform="rotate(-90 ${cx} ${cy})" stroke-dasharray="${f(c)}" stroke-dashoffset="${f(c * (1 - p / 100))}"/>
<circle cx="${f(tx)}" cy="${f(ty)}" r="6.5" class="glow-${t}"/><circle cx="${f(tx)}" cy="${f(ty)}" r="2.4" class="tip"/>`
  }

  return `<g><title>${esc(tip)}</title>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="6" class="track"/>${arc}
${value}
<text x="${x + textAt}" y="52" class="lab">${esc(label.toUpperCase())}</text></g>`
}

/** A figure, optionally rolling in over the one it replaces. */
const figure = (id: string, x: number, now: string, was: string | null) =>
  was === null || was === now
    ? `<text x="${x}" y="35" class="val">${now}</text>`
    : `<g clip-path="url(#${id})"><text x="${x}" y="35" class="val rollout">${was}</text><text x="${x}" y="35" class="val rollin">${now}</text></g>`

const rollClip = (id: string, x: number) => `<clipPath id="${id}"><rect x="${x - 2}" y="17" width="74" height="23"/></clipPath>`

const trendArea = (trend: readonly number[], width: number) => {
  const v = trend.slice(-24).map(n => clamp(n, 0, 100))

  if (v.length < 2) {
    return ''
  }
  const pts = v.map((n, i) => [(i / (v.length - 1)) * width, HUD_H - 4 - (n / 100) * (HUD_H - 22)] as const)
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`

  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]!
    const [qx, qy] = pts[i]!
    const mid = (px + qx) / 2
    d += ` C${f(mid)} ${f(py)} ${f(mid)} ${f(qy)} ${f(qx)} ${f(qy)}`
  }

  return `<g clip-path="url(#card)"><path d="${d} L${width} ${HUD_H} L0 ${HUD_H} Z" fill="url(#trend)"/><path d="${d}" fill="none" class="trendline"/></g>`
}

const EDGE_VAR = { blue: '--ok1', amber: '--warn1', red: '--bad1', green: '--live' } as const

const TONE_FILL: Record<HudTone, string> = {
  live: 'var(--live)',
  idle: 'var(--mut)',
  amber: 'var(--warn1)',
  red: 'var(--bad1)',
  thinking: 'var(--ok2)',
  reading: 'var(--ok1)',
  editing: 'var(--warn1)',
  testing: 'var(--e3)',
  running: 'var(--live)',
  asking: 'var(--warn1)',
}

const percentText = (p: number | null) => (p === null ? 'n/a' : `${Math.round(clamp(p, 0, 100))}%`)

export const hudSvg = (d: HudData): string => {
  const W = Math.round(clamp(d.width ?? HUD_W, HUD_MIN_W, HUD_W))
  const zones = zonesOf(W)
  const textA = zones.r * 2 + (zones.r >= 21 ? 18 : 16)
  const moving = d.animate && d.isWorking
  const glow = d.animate && d.glow === true
  const flash = d.animate && d.flash === true
  const party = d.animate && d.celebrate === true
  const wave = moving && d.wave === true
  const pulse = d.animate && d.pulse !== undefined && d.pulse > 0
  const oldContext = d.animate && d.roll?.contextPct !== undefined && d.roll.contextPct !== null ? percentText(d.roll.contextPct) : null
  const oldSpend = d.animate && d.roll?.spendUsd !== undefined && d.roll.spendUsd !== null ? money(d.roll.spendUsd) : null
  const isRolling = oldContext !== null || (oldSpend !== null && zones.spend !== null)
  const state = d.state?.word ?? (d.isWorking ? 'working' : 'ready')
  const dot: HudTone = d.state?.tone ?? (d.isWorking ? 'live' : 'idle')
  const stateRoom = W - zones.state - 8
  const sub = d.state?.sub ?? (d.isWorking && d.tool !== '' ? d.tool : `${Math.round(clamp(d.toolCalls, 0, 1_000_000))} tools`)
  const motionCss = [
    moving
      ? `@keyframes sweep{from{transform:translateX(-140px)}to{transform:translateX(${W}px)}}
@keyframes halo{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.8);opacity:0}}
.sweep{animation:sweep 2.2s cubic-bezier(.45,0,.55,1) infinite}
.halo{transform-box:fill-box;transform-origin:center;animation:halo 1.6s ease-out infinite}`
      : '',
    wave
      ? `@keyframes wave{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}
.wv{transform-box:fill-box;transform-origin:center;animation:wave .9s ease-in-out infinite}`
      : '',
    glow
      ? `@keyframes glow{0%,100%{opacity:0}45%{opacity:.75}}
.glow{animation:glow 1.5s ease-in-out 2}`
      : '',
    flash
      ? `@keyframes flash{0%,100%{opacity:0}30%{opacity:.5}}
.flash{animation:flash .55s ease-in-out 3}`
      : '',
    party
      ? `@keyframes party{0%{transform:translateX(-170px);opacity:.9}100%{transform:translateX(${W}px);opacity:.9}}
.party{animation:party 1.1s ease-in-out 2}`
      : '',
    pulse
      ? `@keyframes saved{0%{transform:scale(1);opacity:.9}100%{transform:scale(3);opacity:0}}
.saved{transform-box:fill-box;transform-origin:center;animation:saved .9s ease-out 1 both}`
      : '',
    isRolling
      ? `@keyframes rollout{from{transform:translateY(0);opacity:1}to{transform:translateY(-20px);opacity:0}}
@keyframes rollin{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
.rollout{animation:rollout .6s ease-in-out 1 both}.rollin{animation:rollin .6s ease-in-out 1 both}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
  const css = `
${themeCss(d.theme)}
text{font-family:${FONT};fill:var(--text)}
.val{font-size:${W >= 388 ? 20 : 18}px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.lab{font-size:10px;font-weight:700;letter-spacing:${W >= 388 ? '.07' : '.02'}em;fill:var(--mut)}
.state{font-size:${W >= 388 ? 15 : 14}px;font-weight:800;letter-spacing:-.01em}
.track{stroke:var(--track)}
.tip{fill:var(--shine)}
.glow-ok{fill:var(--ok2);opacity:.28}.glow-warn{fill:var(--warn2);opacity:.28}.glow-bad{fill:var(--bad2);opacity:.28}
.trendline{stroke:var(--e1);stroke-width:1.2;opacity:.35}
.hair{stroke:var(--hair);stroke-width:1}
.bar{fill:var(--live)}
.rollout{opacity:0}
${motionCss}`
  const card = `x="1.5" y="1.5" width="${W - 3}" height="${HUD_H - 3}" rx="18"`
  const edge =
    d.edge === undefined
      ? `<rect ${card} fill="none" stroke="url(#edge)" stroke-width="1.5"/>`
      : `<rect ${card} fill="none" style="stroke:var(${EDGE_VAR[d.edge]})" stroke-width="2"/>`
  const sx = zones.state
  const hair = (x: number) => `<line x1="${x}" y1="16" x2="${x}" y2="54" class="hair"/>`
  const waveBars = wave
    ? Array.from({ length: 11 }, (_, i) => `<rect class="bar wv" x="${sx + 12 + i * 6}" y="43" width="3" height="12" rx="1.5" style="animation-delay:-${f((i % 5) * 0.17)}s"/>`).join('')
    : ''
  const limitName = d.limitPct === null ? 'limit' : limitLabel(d.limitName)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HUD_H}" width="${W}" height="${HUD_H}" role="img">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--top)"/><stop offset="1" style="stop-color:var(--bottom)"/></linearGradient>
<linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--e1);stop-opacity:.9"/><stop offset=".5" style="stop-color:var(--e2);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--e3);stop-opacity:.9"/></linearGradient>
${stop('g-ok', '--ok1', '--ok2')}${stop('g-warn', '--warn1', '--warn2')}${stop('g-bad', '--bad1', '--bad2')}
<linearGradient id="trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--e2);stop-opacity:.20"/><stop offset="1" style="stop-color:var(--e1);stop-opacity:0"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--e1);stop-opacity:0"/><stop offset=".5" style="stop-color:var(--e3);stop-opacity:1"/><stop offset="1" style="stop-color:var(--e2);stop-opacity:0"/></linearGradient>
${party ? '<linearGradient id="cheer" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--live);stop-opacity:0"/><stop offset=".5" style="stop-color:var(--live);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--e3);stop-opacity:0"/></linearGradient>' : ''}
<clipPath id="card"><rect ${card}/></clipPath>
${isRolling ? rollClip('r1', textA) + rollClip('r2', (zones.spend ?? 0) + 10) : ''}
</defs>
<style>${css}</style>
<rect ${card} fill="url(#bg)"/>
${d.hour === undefined ? '' : `<rect ${card} fill="${tintOf(d.hour)}" opacity="0.11" data-tint="${Math.floor(clamp(d.hour, 0, 23))}"/>`}
${trendArea(d.trend, W)}
${flash ? `<rect class="flash" ${card} style="fill:var(--bad2)" opacity="0"/>` : ''}
${party ? '<g clip-path="url(#card)"><rect class="party" x="0" y="0" width="170" height="70" fill="url(#cheer)" opacity="0"/></g>' : ''}
${edge}
${glow ? `<rect class="glow" ${card} fill="none" style="stroke:var(--live)" stroke-width="6" opacity="0"/>` : ''}
<line x1="20" y1="3" x2="${W - 20}" y2="3" class="hair"/>
${hair(zones.spend === null ? sx : zones.spend + 1)}${zones.spend === null ? '' : hair(sx + 1)}
${moving ? `<g clip-path="url(#card)"><rect class="sweep" x="0" y="${HUD_H - 4}" width="140" height="2.6" rx="1.3" fill="url(#beam)"/></g>` : ''}
${gauge(0, zones.r, textA, figure('r1', textA, percentText(d.contextPct), oldContext), d.contextPct, 'context', d.contextPct === null ? 'Context: no reading yet' : `Context window ${percentText(d.contextPct)} full`)}
${gauge(zones.step, zones.r, textA, figure('r0', zones.step + textA, percentText(d.limitPct), null), d.limitPct, limitName, d.limitPct === null ? 'Rate limit: no reading yet' : `${limitName} limit ${percentText(d.limitPct)} used`)}
${zones.spend === null ? '' : `<g><title>Spend this session</title>${figure('r2', zones.spend + 10, d.spendUsd === null ? 'n/a' : money(d.spendUsd), oldSpend)}<text x="${zones.spend + 10}" y="52" class="lab">SPENT</text></g>`}
${moving ? `<circle cx="${sx + 16}" cy="30" r="5.5" class="halo" style="fill:${TONE_FILL[dot]}"/>` : ''}${pulse ? `<circle cx="${sx + 16}" cy="30" r="7" class="saved" fill="none" stroke-width="2" style="stroke:var(--e3)" opacity="0" data-saves="${Math.round(clamp(d.pulse ?? 0, 0, 1_000_000))}"/>` : ''}<circle cx="${sx + 16}" cy="30" r="5.5" style="fill:${TONE_FILL[dot]}"/>
<text x="${sx + 27}" y="35" class="state">${esc(short(state, Math.max(5, Math.floor((stateRoom - 13) / (W >= 388 ? 7.4 : 6.9)))))}</text>
${wave ? waveBars : `<text x="${sx + 11}" y="52" class="lab">${esc(short(sub.toUpperCase(), Math.max(6, Math.floor(stateRoom / 7.2))))}</text>`}
</svg>`
}

export const hudAlt = (d: HudData): string =>
  `Status: context ${d.contextPct === null ? 'unknown' : `${Math.round(clamp(d.contextPct, 0, 100))} percent`}, ${d.limitPct === null ? 'limit unknown' : `${limitLabel(d.limitName)} limit ${Math.round(clamp(d.limitPct, 0, 100))} percent`}, spend ${d.spendUsd === null ? 'unknown' : money(d.spendUsd)}, ${d.state?.word ?? (d.isWorking ? 'working' : 'ready')}.`
