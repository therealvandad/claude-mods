// Pure SVG drawing for the Tests tab (desktop surface only). No `$` here, so it is easy to test and preview.
// Colours follow the app's light or dark mode through a media query inside the SVG. Nothing animates.
import type { CovPoint, TestRun } from './runs'

export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'

const ACCENTS: Record<Accent, readonly [string, string]> = {
  suggestion: ['#4b57c9', '#a9b4ff'],
  claude: ['#c4562f', '#e08a68'],
  success: ['#2f8f4e', '#5fbf7a'],
  warning: ['#a8741a', '#f0b94a'],
  permission: ['#4b57c9', '#a9b4ff'],
  remember: ['#7b4bd0', '#b08cff'],
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
const f = (n: number) => String(Math.round(clamp(n, -100_000, 100_000) * 100) / 100)

const W = 560
const H = 250
const MAX_BARS = 30

export const testsSvg = (runs: readonly TestRun[], cov: readonly CovPoint[], accent: string): string => {
  const [light, dark] = Object.hasOwn(ACCENTS, accent) ? ACCENTS[accent as Accent] : ACCENTS.suggestion
  const bars = runs.slice(-MAX_BARS)
  const max = Math.max(1, ...bars.map(r => r.pass + r.fail + r.skip))
  const left = 36
  const right = W - 12
  const top = 34
  const base = 138
  const slot = (right - left) / Math.max(bars.length, 1)
  const bw = Math.min(22, slot * 0.7)
  let body = `<text x="${left}" y="20" class="h">Test runs</text><text x="${right}" y="20" class="m" text-anchor="end">${bars.length === 0 ? 'none yet' : `last ${bars.length}`}</text>`
  body += `<line x1="${left}" y1="${base}" x2="${right}" y2="${base}" class="axis"/>`

  bars.forEach((r, i) => {
    const x = left + i * slot + (slot - bw) / 2
    const hp = ((base - top) * r.pass) / max
    const hf = ((base - top) * r.fail) / max
    const hs = ((base - top) * r.skip) / max
    const when = new Date(r.t).toISOString().slice(0, 16).replace('T', ' ')
    let y = base

    body += `<g><title>${esc(`${r.fw}: ${r.pass} passed, ${r.fail} failed, ${r.skip} skipped (${when} UTC)`)}</title>`

    if (hp > 0) {
      y -= hp
      body += `<rect x="${f(x)}" y="${f(y)}" width="${f(bw)}" height="${f(hp)}" rx="2" class="ok"/>`
    }

    if (hs > 0) {
      y -= hs
      body += `<rect x="${f(x)}" y="${f(y)}" width="${f(bw)}" height="${f(hs)}" rx="2" class="skip"/>`
    }

    if (hf > 0) {
      y -= hf
      body += `<rect x="${f(x)}" y="${f(y)}" width="${f(bw)}" height="${f(hf)}" rx="2" class="bad"/>`
    }
    body += '</g>'
  })

  if (bars.length === 0) body += `<text x="${W / 2}" y="${(top + base) / 2}" class="m" text-anchor="middle">Test runs appear here once add-kit.tests is on.</text>`
  body += `<text x="${left - 6}" y="${top + 4}" class="m" text-anchor="end">${max}</text><text x="${left - 6}" y="${base}" class="m" text-anchor="end">0</text>`

  // Coverage line.
  const cv = cov.slice(-MAX_BARS)
  const cTop = 176
  const cBase = 232

  body += `<text x="${left}" y="164" class="h">Coverage</text>`

  if (cv.length >= 2) {
    const lo = Math.max(0, Math.floor(Math.min(...cv.map(c => c.pct)) / 10) * 10)
    const hi = Math.min(100, Math.ceil(Math.max(...cv.map(c => c.pct)) / 10) * 10 || 10)
    const span = Math.max(1, hi - lo)
    const pts = cv.map((c, i) => [left + (i * (right - left)) / (cv.length - 1), cBase - ((c.pct - lo) / span) * (cBase - cTop)] as const)
    // Catmull-Rom to cubic Bezier: a smooth line.
    let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]!
      const p1 = pts[i]!
      const p2 = pts[i + 1]!
      const p3 = pts[i + 2] ?? p2

      d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`
    }
    body += `<line x1="${left}" y1="${cBase}" x2="${right}" y2="${cBase}" class="axis"/><path d="${d}" class="line" fill="none"/>`
    cv.forEach((c, i) => {
      body += `<circle cx="${f(pts[i]![0])}" cy="${f(pts[i]![1])}" r="3.2" class="dot"><title>${esc(`${c.pct}% (${c.key})`)}</title></circle>`
    })
    body += `<text x="${left - 6}" y="${cTop + 4}" class="m" text-anchor="end">${hi}%</text><text x="${left - 6}" y="${cBase}" class="m" text-anchor="end">${lo}%</text>`
    body += `<text x="${right}" y="164" class="h" text-anchor="end">${cv[cv.length - 1]!.pct}%</text>`
  } else {
    body += `<text x="${W / 2}" y="${(cTop + cBase) / 2 + 4}" class="m" text-anchor="middle">${cv.length === 1 ? `${cv[0]!.pct}% (one reading so far)` : 'No coverage readings yet.'}</text>`
  }

  const css =
    `:root{--text:#2b2a27;--mut:#77736a;--axis:#d7d3c9;--ok:#2f8f4e;--bad:#c0394b;--skip:#b9b4a6;--acc:${light}}` +
    `@media (prefers-color-scheme:dark){:root{--text:#ece9e2;--mut:#9a968d;--axis:#43423e;--ok:#5fbf7a;--bad:#ff7a8a;--skip:#6d6a62;--acc:${dark}}}` +
    'text{font:12px -apple-system,system-ui,sans-serif;fill:var(--text)}.h{font-weight:600}.m{fill:var(--mut);font-size:11px}' +
    '.axis{stroke:var(--axis);stroke-width:1}.ok{fill:var(--ok)}.bad{fill:var(--bad)}.skip{fill:var(--skip)}.line{stroke:var(--acc);stroke-width:2.2;stroke-linecap:round}.dot{fill:var(--acc)}'

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><style>${css}</style>${body}</svg>`
}

export const testsAlt = (runs: readonly TestRun[], cov: readonly CovPoint[]): string => {
  const last = runs[runs.length - 1]

  return last === undefined
    ? 'Chart of test runs: none recorded yet.'
    : `Chart of the last ${Math.min(runs.length, MAX_BARS)} test runs; the latest had ${last.pass} passed and ${last.fail} failed.${cov.length > 0 ? ` Coverage is ${cov[cov.length - 1]!.pct} percent.` : ''}`
}
