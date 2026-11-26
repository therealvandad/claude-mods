// Three STILL backdrops (paper, noise, glass) as plain SVG with nothing that moves, so reduced motion changes nothing.
// Colours come from the finish, so the page colour under the scene matches the theme. No `$` here.
// Pure vector: no pictures, no fonts, no comments, no ampersands, far under 131,072 characters.

import { hslOf, hsl } from './color'
import { anchorsOf } from './finish'
import type { Finish, SceneId } from './finish'

const W = 1600
const H = 900

const lcg = (seed: number) => {
  let s = seed >>> 0

  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0

    return s / 4294967296
  }
}

const n1 = (x: number) => Math.round(x * 10) / 10
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)
const modes = (light: string, dark: string) => `${light}@media (prefers-color-scheme: dark){${dark}}`

const wrap = (css: string, body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><style>${css}</style>${
    defs === '' ? '' : `<defs>${defs}</defs>`
  }${body}</svg>`

const bg = `<rect class="bg" x="0" y="0" width="${W}" height="${H}"/>`

// Warm specks and short fibres, a soft vignette.
const paper = (f: Finish): string => {
  const a = anchorsOf(f)
  const r = lcg(7)
  const specks = Array.from({ length: 480 }, () => {
    const tone = r() < 0.5 ? 'sa' : 'sb'

    return `<circle class="${tone}" cx="${n1(between(r, 0, W))}" cy="${n1(between(r, 0, H))}" r="${n1(between(r, 0.5, 1.5))}" opacity="${n1(between(r, 0.05, 0.16))}"/>`
  }).join('')
  const fibres = Array.from({ length: 60 }, () => {
    const x = between(r, 0, W)
    const y = between(r, 0, H)
    const t = between(r, 0, Math.PI)
    const len = between(r, 6, 22)

    return `<line class="fb" x1="${n1(x)}" y1="${n1(y)}" x2="${n1(x + Math.cos(t) * len)}" y2="${n1(y + Math.sin(t) * len)}" opacity="${n1(between(r, 0.05, 0.12))}"/>`
  }).join('')
  const css =
    modes(
      `.bg{fill:${a.light.s0}}.sa{fill:${a.light.t3}}.sb{fill:${a.light.s2}}.fb{stroke:${a.light.t3}}.vg{stop-color:${a.light.t3}}`,
      `.bg{fill:${a.dark.s0}}.sa{fill:#000000}.sb{fill:${a.dark.t3}}.fb{stroke:${a.dark.t3}}.vg{stop-color:#000000}`,
    ) + '.fb{stroke-width:.8;stroke-linecap:round}'
  const defs = `<radialGradient id="vg" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" class="vg" stop-opacity="0"/><stop offset="1" class="vg" stop-opacity="0.2"/></radialGradient>`

  return wrap(css, `${bg}${specks}${fibres}<rect x="0" y="0" width="${W}" height="${H}" fill="url(#vg)"/>`, defs)
}

// Fine grain that shows on dark pages and all but vanishes on light ones. Three paths of tiny squares, one per strength.
const noise = (f: Finish): string => {
  const a = anchorsOf(f)
  const r = lcg(11)
  const layer = (cls: string) => {
    const d = Array.from({ length: 560 }, () => `M${n1(between(r, 0, W))} ${n1(between(r, 0, H))}h1.8v1.8h-1.8z`).join('')

    return `<path class="${cls}" d="${d}"/>`
  }
  const css = modes(
    `.bg{fill:${a.light.s0}}.n1{fill:${a.light.t3};fill-opacity:.04}.n2{fill:${a.light.t3};fill-opacity:.07}.n3{fill:${a.light.t3};fill-opacity:.1}`,
    `.bg{fill:${a.dark.s0}}.n1{fill:${a.dark.t1};fill-opacity:.08}.n2{fill:${a.dark.t1};fill-opacity:.15}.n3{fill:${a.dark.t3};fill-opacity:.28}`,
  )

  return wrap(css, `${bg}${layer('n1')}${layer('n2')}${layer('n3')}`)
}

// Soft blobs of colour from the accent's hue, still, for frosted panels to blur.
const glass = (f: Finish): string => {
  const a = anchorsOf(f)
  const { h } = hslOf(f.accent)
  const shapes = [
    '<circle class="k1" cx="380" cy="300" r="260"/>',
    '<circle class="k2" cx="1230" cy="260" r="200"/>',
    '<rect class="k3" x="700" y="520" width="520" height="300" rx="150"/>',
    '<circle class="k4" cx="260" cy="760" r="190"/>',
    '<circle class="k5" cx="1400" cy="700" r="230"/>',
  ].join('')
  const offsets = [0, 40, -40, 150, -150]
  const light = offsets.map((o, i) => `.k${i + 1}{fill:${hsl(h + o, 70, 78)}}`).join('')
  const dark = offsets.map((o, i) => `.k${i + 1}{fill:${hsl(h + o, 62, 34)}}`).join('')
  const css = modes(`.bg{fill:${a.light.s0}}${light}`, `.bg{fill:${a.dark.s0}}${dark}`)

  return wrap(css, `${bg}<g opacity=".75">${shapes}</g>`)
}

const BUILDERS: Record<SceneId, (f: Finish) => string> = { paper, noise, glass }

export const SCENE_ALT: Record<SceneId, string> = {
  paper: 'Paper with faint specks and fibres, in the finish colours',
  noise: 'A fine grain on a dark page',
  glass: 'Soft blobs of colour behind frosted glass',
}

export const sceneSvg = (id: string, f: Finish): string | undefined => {
  const build = (BUILDERS as Record<string, ((f: Finish) => string) | undefined>)[id]

  return build === undefined ? undefined : build(f)
}
