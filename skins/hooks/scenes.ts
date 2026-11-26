// Two STILL backdrops, drawn as plain SVG with nothing in them that moves, so reduced motion changes
// nothing and the skins mod needs no motion switch. No `$` in here.
// Pure vector, no pictures or fonts, no comments, no ampersands, well under 131,072 characters.
// Light and dark come from the media query, so one scene follows the mode the app shows.

export type SceneDef = { label: string; alt: string; svg: string }

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

const stop = (offset: number, cls: string, opacity?: number) =>
  `<stop offset="${offset}" class="${cls}"${opacity === undefined ? '' : ` stop-opacity="${opacity}"`}/>`

const bg = '<rect class="bg" x="0" y="0" width="1600" height="900"/>'

// Paper grain: warm paper, a few hundred faint specks and short fibres, a soft vignette. All static.
const grain = (): string => {
  const r = lcg(7)
  const specks = Array.from({ length: 520 }, () => {
    const tone = r() < 0.5 ? 'sa' : 'sb'

    return `<circle class="${tone}" cx="${n1(between(r, 0, W))}" cy="${n1(between(r, 0, H))}" r="${n1(between(r, 0.5, 1.5))}" opacity="${n1(between(r, 0.05, 0.16))}"/>`
  }).join('')
  const fibres = Array.from({ length: 70 }, () => {
    const x = between(r, 0, W)
    const y = between(r, 0, H)
    const a = between(r, 0, Math.PI)
    const len = between(r, 6, 22)

    return `<line class="fb" x1="${n1(x)}" y1="${n1(y)}" x2="${n1(x + Math.cos(a) * len)}" y2="${n1(y + Math.sin(a) * len)}" opacity="${n1(between(r, 0.05, 0.12))}"/>`
  }).join('')
  const css =
    modes(
      '.bg{fill:#efe6d3}.sa{fill:#7a6648}.sb{fill:#ffffff}.fb{stroke:#8a7458}.vg{stop-color:#8a7458}',
      '.bg{fill:#1f1a15}.sa{fill:#000000}.sb{fill:#d8c8aa}.fb{stroke:#d8c8aa}.vg{stop-color:#000000}',
    ) + '.fb{stroke-width:.8;stroke-linecap:round}'
  const defs = `<radialGradient id="vg" cx="0.5" cy="0.5" r="0.75">${stop(0.55, 'vg', 0)}${stop(1, 'vg', 0.22)}</radialGradient>`

  return wrap(css, `${bg}${specks}${fibres}<rect x="0" y="0" width="1600" height="900" fill="url(#vg)"/>`, defs)
}

// Glass cards: soft blobs of colour, still, for the frosted panels to blur.
const glass = (): string => {
  const shapes = [
    '<circle class="k1" cx="380" cy="300" r="260"/>',
    '<circle class="k2" cx="1230" cy="260" r="200"/>',
    '<rect class="k3" x="700" y="520" width="520" height="300" rx="150"/>',
    '<circle class="k4" cx="260" cy="760" r="190"/>',
    '<circle class="k5" cx="1400" cy="700" r="230"/>',
  ].join('')
  const css = modes(
    '.bg{fill:#f3f4f9}.k1{fill:#9db4f5}.k2{fill:#f0a9c8}.k3{fill:#a6dccf}.k4{fill:#f2cf94}.k5{fill:#c1a9ee}',
    '.bg{fill:#0b0d16}.k1{fill:#3f63d8}.k2{fill:#c23f86}.k3{fill:#1d9a86}.k4{fill:#c9792b}.k5{fill:#7447c8}',
  )

  return wrap(css, `${bg}<g opacity=".75">${shapes}</g>`)
}

export const SCENES: Record<string, SceneDef> = {
  grain: { label: 'Paper grain', alt: 'Warm paper with faint specks and fibres', svg: grain() },
  glass: { label: 'Glass', alt: 'Soft coloured shapes behind frosted glass', svg: glass() },
}
