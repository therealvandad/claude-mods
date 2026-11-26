// Pure SVG drawing of the dependency graph (idea 197). No `$` here, so it is easy to test and preview.
// Colours follow the app's light or dark mode through a media query inside the SVG; the drawing never animates.
import type { Accent } from '../types'
import type { ModRow } from './data'

const ACCENTS: Record<Accent, readonly [string, string]> = {
  suggestion: ['#4b57c9', '#a9b4ff'],
  claude: ['#c4562f', '#e08a68'],
  success: ['#2f8f4e', '#5fbf7a'],
  warning: ['#a8741a', '#f0b94a'],
  permission: ['#4b57c9', '#a9b4ff'],
  remember: ['#7b4bd0', '#b08cff'],
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const f = (n: number) => String(Math.round(n * 10) / 10)

export const ROW = 24
export const WIDTH = 560

export type Graph = { providers: string[]; dependents: { name: string; deps: string[] }[] }

/** Providers are the mods that others list in `dependencies`; dependents are the mods that list at least one. */
export const graphOf = (mods: readonly ModRow[]): Graph => ({
  providers: [...new Set(mods.flatMap(m => m.deps))].sort(),
  dependents: mods
    .filter(m => m.deps.length > 0)
    .map(m => ({ name: m.name, deps: [...m.deps].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name)),
})

export const depGraphSvg = (mods: readonly ModRow[], accent: Accent): string => {
  const g = graphOf(mods)
  const [light, dark] = ACCENTS[accent] ?? ACCENTS.suggestion
  const rows = Math.max(g.dependents.length, g.providers.length * 2, 3)
  const height = rows * ROW + 56
  const top = 40
  const provY = new Map<string, number>()
  const span = (rows * ROW) / Math.max(1, g.providers.length)

  g.providers.forEach((p, i) => provY.set(p, top + span * i + span / 2))
  const x1 = 170
  const x2 = 380
  let edges = ''
  let right = ''

  g.dependents.forEach((d, i) => {
    const y = top + i * ROW + ROW / 2

    for (const p of d.deps) {
      const py = provY.get(p)

      if (py === undefined) {
        continue
      }
      const k = g.providers.indexOf(p) % 3

      edges += `<path d="M${f(x1)} ${f(py)} C${f((x1 + x2) / 2)} ${f(py)} ${f((x1 + x2) / 2)} ${f(y)} ${f(x2)} ${f(y)}" class="e e${k}"><title>${esc(`${d.name} needs ${p}`)}</title></path>`
    }
    right += `<g><title>${esc(`${d.name} needs ${d.deps.join(', ')}`)}</title><rect x="${x2}" y="${f(y - 9)}" width="172" height="18" rx="5" class="n"/><text x="${x2 + 8}" y="${f(y + 4)}" class="t">${esc(d.name)}</text></g>`
  })
  let left = ''

  g.providers.forEach((p, i) => {
    const y = provY.get(p) ?? top
    const users = g.dependents.filter(d => d.deps.includes(p)).length
    left += `<g><title>${esc(`${p} is needed by ${users} mods`)}</title><rect x="20" y="${f(y - 15)}" width="${x1 - 20}" height="30" rx="7" class="p p${i % 3}"/><text x="${f(20 + (x1 - 20) / 2)}" y="${f(y - 1)}" text-anchor="middle" class="pt">${esc(p)}</text><text x="${f(20 + (x1 - 20) / 2)}" y="${f(y + 11)}" text-anchor="middle" class="ps">needed by ${users}</text></g>`
  })
  const css = `:root{--bg:#faf9f5;--card:#fff;--line:#d8d4c8;--text:#2b2a27;--mut:#6f6b62;--k0:${light};--k1:#a8741a;--k2:#2f8f4e}
@media (prefers-color-scheme:dark){:root{--bg:#262624;--card:#2d2d2b;--line:#43423e;--text:#ece9e2;--mut:#8f8b83;--k0:${dark};--k1:#f0b94a;--k2:#5fbf7a}}
.n{fill:var(--card);stroke:var(--line)}.t{font:12px ui-sans-serif,system-ui,sans-serif;fill:var(--text)}.h{font:600 12px ui-sans-serif,system-ui,sans-serif;fill:var(--mut)}
.pt{font:600 13px ui-sans-serif,system-ui,sans-serif;fill:var(--text)}.ps{font:10.5px ui-sans-serif,system-ui,sans-serif;fill:var(--mut)}
.p{fill:var(--card);stroke-width:2}.p0{stroke:var(--k0)}.p1{stroke:var(--k1)}.p2{stroke:var(--k2)}
.e{fill:none;stroke-width:1.4;opacity:.55}.e0{stroke:var(--k0)}.e1{stroke:var(--k1)}.e2{stroke:var(--k2)}`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img"><style>${css}</style>
<rect width="${WIDTH}" height="${height}" rx="12" fill="var(--bg)"/>
<text x="20" y="24" class="h">NEEDED BY</text><text x="${x2}" y="24" class="h">NEEDS</text>
${edges}${left}${right}</svg>`
}

export const graphAlt = (mods: readonly ModRow[]): string => {
  const g = graphOf(mods)

  return `Dependency graph: ${g.providers.join(' and ')} are needed by ${g.dependents.length} mods.`
}
