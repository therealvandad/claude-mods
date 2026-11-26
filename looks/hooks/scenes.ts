// Moving backdrops, drawn as plain SVG with CSS animation inside. No `$` in here.
// Every scene: pure vector, no pictures or fonts, no comments, no ampersands, well under
// 131,072 characters. Every moving part has its resting place in the markup, so a person
// who asked for reduced motion sees a finished still picture.
// Light and dark come from the media query, so one scene follows the mode the app shows.

export type SceneDef = {
  label: string
  alt: string
  svg: string
  glass?: { blur: number; opacity: number }
}

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

// Rules for light, then the same selectors for dark in the media query.
const modes = (light: string, dark: string) => `${light}@media (prefers-color-scheme: dark){${dark}}`

const wrap = (css: string, body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><style>${css}</style>${
    defs === '' ? '' : `<defs>${defs}</defs>`
  }${body}</svg>`

const stop = (offset: number, cls: string, opacity?: number) =>
  `<stop offset="${offset}" class="${cls}"${opacity === undefined ? '' : ` stop-opacity="${opacity}"`}/>`

const bg = '<rect class="bg" x="0" y="0" width="1600" height="900"/>'

const aurora = (): string => {
  const ribbons = [
    { y: 250, grad: 'a1', dur: 34, dx: 70, delay: -4, op: 0.9 },
    { y: 330, grad: 'a2', dur: 46, dx: -90, delay: -19, op: 0.75 },
    { y: 200, grad: 'a3', dur: 58, dx: 60, delay: -31, op: 0.7 },
    { y: 400, grad: 'a4', dur: 40, dx: -50, delay: -11, op: 0.6 },
  ]
  const paths = ribbons
    .map(
      b =>
        `<path class="rb" style="animation-duration:${b.dur}s;animation-delay:${b.delay}s;--dx:${b.dx}px" fill="url(#${b.grad})" opacity="${b.op}" d="M-200 ${b.y} C 100 ${b.y - 110}, 350 ${b.y + 90}, 650 ${b.y - 20} S 1150 ${b.y - 130}, 1450 ${b.y + 30} S 1700 ${b.y - 40}, 1800 ${b.y} L1800 ${b.y + 360} L-200 ${b.y + 360} Z"/>`,
    )
    .join('')
  const r = lcg(11)
  const stars = Array.from(
    { length: 50 },
    () => `<circle class="st" cx="${n1(between(r, 0, W))}" cy="${n1(between(r, 0, 520))}" r="${n1(between(r, 0.7, 1.6))}"/>`,
  ).join('')
  const css =
    modes(
      '.bg{fill:#e8edf6}.st{opacity:0}.g1{stop-color:#2fbf8f}.g2{stop-color:#3aa0c8}.g3{stop-color:#8c6cf0}.g4{stop-color:#d46aa8}',
      '.bg{fill:#060c17}.st{opacity:.55;fill:#dfe9ff}.g1{stop-color:#2bd48a}.g2{stop-color:#2aa7c9}.g3{stop-color:#8a5cf0}.g4{stop-color:#d95aa8}',
    ) +
    '.rb{transform-box:fill-box;transform-origin:50% 100%;animation:sway 40s ease-in-out infinite alternate}' +
    '@keyframes sway{0%{transform:translateX(0) scaleY(.92)}50%{transform:translateX(calc(var(--dx) * .5)) scaleY(1.08)}100%{transform:translateX(var(--dx)) scaleY(.96)}}'
  const grads = ['a1:g1', 'a2:g2', 'a3:g3', 'a4:g4']
    .map(g => {
      const [id, c] = g.split(':') as [string, string]

      return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stop(0, c, 0)}${stop(0.55, c, 0.42)}${stop(1, c, 0)}</linearGradient>`
    })
    .join('')

  return wrap(css, `${bg}${stars}${paths}`, grads)
}

const fallLayer = (opts: {
  seed: number
  count: number
  cls: string
  dur: number
  delay: number
  make: (r: () => number, x: number, y: number) => string
  sway?: number
}) => {
  const r = lcg(opts.seed)
  const items: string[] = []

  for (let i = 0; i < opts.count; i++) {
    const x = between(r, -40, W + 40)
    const y = between(r, 0, H)
    const piece = opts.make(r, x, y)
    items.push(piece, piece.replace(/(cy|y1|y2)="(-?[\d.]+)"/g, (_, k: string, v: string) => `${k}="${n1(Number(v) - H)}"`))
  }
  const inner = opts.sway === undefined ? items.join('') : `<g class="sw" style="--sw:${opts.sway}px;animation-duration:${n1(opts.dur / 3)}s">${items.join('')}</g>`

  return `<g class="fall ${opts.cls}" style="animation-duration:${opts.dur}s;animation-delay:${opts.delay}s">${inner}</g>`
}

const rain = (): string => {
  const streak = (len: number, slant: number, cls: string) => (r: () => number, x: number, y: number) =>
    `<line class="${cls}" x1="${n1(x)}" y1="${n1(y)}" x2="${n1(x - slant)}" y2="${n1(y + len)}"/>`
  const body =
    fallLayer({ seed: 3, count: 26, cls: 'lin', dur: 3.4, delay: -1, make: streak(26, 5, 'r1') }) +
    fallLayer({ seed: 5, count: 20, cls: 'lin', dur: 2.5, delay: -2, make: streak(36, 7, 'r2') }) +
    fallLayer({ seed: 7, count: 12, cls: 'lin', dur: 1.9, delay: -1, make: streak(48, 9, 'r3') })
  const css =
    modes(
      '.bg{fill:#e5eaef}.r1,.r2,.r3{stroke:#5f7992}.mist{fill:#ffffff}',
      '.bg{fill:#0b1118}.r1,.r2,.r3{stroke:#a5bdd4}.mist{fill:#9db4c9}',
    ) +
    '.r1,.r2,.r3{stroke-linecap:round;fill:none}.r1{stroke-width:1;opacity:.28}.r2{stroke-width:1.3;opacity:.4}.r3{stroke-width:1.7;opacity:.5}' +
    '.fall{animation-name:fall;animation-timing-function:linear;animation-iteration-count:infinite}' +
    '@keyframes fall{from{transform:translateY(0)}to{transform:translateY(900px)}}'
  const defs = `<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">${stop(0, 'mist', 0)}${stop(1, 'mist', 0.28)}</linearGradient>`

  return wrap(css, `${bg}<rect x="0" y="560" width="1600" height="340" fill="url(#mist)"/>${body}`, defs)
}

const starfield = (): string => {
  const r = lcg(21)
  const group = (cls: string, count: number, rMin: number, rMax: number, dur: number, delay: number) => {
    const stars = Array.from({ length: count }, () => {
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * 950

      return `<circle cx="${n1(800 + Math.cos(a) * d)}" cy="${n1(450 + Math.sin(a) * d)}" r="${n1(between(r, rMin, rMax))}"/>`
    }).join('')

    return `<g class="tw ${cls}" style="animation-duration:${dur}s;animation-delay:${delay}s" opacity=".8">${stars}</g>`
  }
  const field = group('s1', 70, 0.7, 1.3, 7, -2) + group('s2', 45, 1, 1.8, 11, -5) + group('s3', 22, 1.5, 2.4, 15, -9)
  const css =
    modes(
      '.bg{fill:#eef1f8}.tw{fill:#34406a}.nb{fill:#7d8fd8}',
      '.bg{fill:#04060d}.tw{fill:#e4ecff}.nb{fill:#4a5bd0}',
    ) +
    '.turn{transform-box:view-box;transform-origin:50% 50%;animation:turn 1200s linear infinite}.tw{animation:twinkle 9s ease-in-out infinite alternate}' +
    '@keyframes turn{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes twinkle{from{opacity:.4}to{opacity:.95}}'
  const defs = `<radialGradient id="nb">${stop(0, 'nb', 0.22)}${stop(1, 'nb', 0)}</radialGradient>`

  return wrap(css, `${bg}<ellipse cx="1100" cy="300" rx="620" ry="260" fill="url(#nb)"/><g class="turn">${field}</g>`, defs)
}

const breathe = (): string => {
  const blobs = [
    { cx: 420, cy: 300, r: 560, g: 'b1', dur: 17, delay: 0 },
    { cx: 1200, cy: 620, r: 640, g: 'b2', dur: 21, delay: -7 },
    { cx: 820, cy: 480, r: 480, g: 'b3', dur: 25, delay: -13 },
  ]
  const body = blobs
    .map(
      b =>
        `<circle class="br" cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="url(#${b.g})" opacity=".7" style="animation-duration:${b.dur}s;animation-delay:${b.delay}s"/>`,
    )
    .join('')
  const css =
    modes(
      '.bg{fill:#f4f5fb}.c1{stop-color:#a9bcf5}.c2{stop-color:#e0b5f0}.c3{stop-color:#a8e3e0}',
      '.bg{fill:#0a0d19}.c1{stop-color:#3b5bdb}.c2{stop-color:#9b3fd6}.c3{stop-color:#1fa6a6}',
    ) +
    '.br{transform-box:fill-box;transform-origin:50% 50%;animation:breath 20s ease-in-out infinite alternate}' +
    '@keyframes breath{from{transform:scale(.88);opacity:.45}to{transform:scale(1.14);opacity:.8}}'
  const defs = ['b1:c1', 'b2:c2', 'b3:c3']
    .map(g => {
      const [id, c] = g.split(':') as [string, string]

      return `<radialGradient id="${id}">${stop(0, c, 0.75)}${stop(1, c, 0)}</radialGradient>`
    })
    .join('')

  return wrap(css, `${bg}${body}`, defs)
}

const horizon = (): string => {
  const hy = 480
  const verticals = Array.from({ length: 29 }, (_, k) => {
    const i = k - 14

    return `<line x1="800" y1="${hy}" x2="${800 + i * 210}" y2="900"/>`
  }).join('')
  const rows = Array.from({ length: 12 }, (_, k) => {
    const dur = 9
    const delay = -n1((dur / 12) * k)

    return `<line class="hl" x1="-100" y1="${hy}" x2="1700" y2="${hy}" style="animation-duration:${dur}s;animation-delay:${delay}s" opacity=".4"/>`
  }).join('')
  const css =
    modes(
      '.sky1{stop-color:#f2ebfb}.sky2{stop-color:#fbdfec}.sun1{stop-color:#f5a3c0}.sun2{stop-color:#f6c28a}.gr{fill:#f3e6f3}.ln{stroke:#a65aa6}',
      '.sky1{stop-color:#090614}.sky2{stop-color:#2b0f40}.sun1{stop-color:#ff5ca8}.sun2{stop-color:#ff9a4a}.gr{fill:#0d0718}.ln{stroke:#c050d8}',
    ) +
    '.ln{stroke-width:1.2;fill:none}.hl{animation:come 9s cubic-bezier(.55,0,.9,.55) infinite}.vl{opacity:.32}' +
    '@keyframes come{from{transform:translateY(0);opacity:0}15%{opacity:.5}to{transform:translateY(420px);opacity:.5}}'
  const defs =
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${stop(0, 'sky1')}${stop(1, 'sky2')}</linearGradient>` +
    `<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">${stop(0, 'sun1')}${stop(1, 'sun2')}</linearGradient>`
  const body =
    `<rect x="0" y="0" width="1600" height="900" fill="url(#sky)"/>` +
    `<circle cx="800" cy="${hy - 40}" r="170" fill="url(#sun)" opacity=".55"/>` +
    `<rect class="gr" x="0" y="${hy}" width="1600" height="420"/>` +
    `<g class="ln vl">${verticals}</g><g class="ln">${rows}</g>`

  return wrap(css, body, defs)
}

const code = (): string => {
  const patterns = [
    [6, 20, 4, 34, 10, 16, 5, 43, 8, 22, 12, 18],
    [9, 28, 5, 18, 7, 40, 11, 14, 4, 36, 8, 20],
    [4, 15, 12, 30, 6, 25, 9, 38, 5, 17, 10, 24],
    [11, 22, 7, 32, 4, 19, 8, 41, 6, 15, 9, 27],
  ]
  const r = lcg(31)
  const cols = Array.from({ length: 36 }, (_, i) => {
    const pat = patterns[i % patterns.length]!
    const period = pat.reduce((a, b) => a + b, 0)
    const x = 22 + i * 44.5
    const dur = n1(between(r, 5, 11))
    const delay = -n1(between(r, 0, 9))

    return `<line x1="${n1(x)}" y1="-40" x2="${n1(x)}" y2="940" stroke-dasharray="${pat.join(' ')}" style="--p:${period}px;animation-duration:${dur}s;animation-delay:${delay}s"/>`
  }).join('')
  const css =
    modes(
      '.bg{fill:#edf3ee}.cg{stop-color:#3f7a52}',
      '.bg{fill:#040907}.cg{stop-color:#38e07a}',
    ) +
    '.cl line{stroke-width:7;fill:none;animation-name:glyphs;animation-timing-function:linear;animation-iteration-count:infinite}' +
    '@keyframes glyphs{from{stroke-dashoffset:0}to{stroke-dashoffset:calc(var(--p) * -1)}}'
  const defs = `<linearGradient id="cf" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="900">${stop(0, 'cg', 0)}${stop(0.45, 'cg', 0.34)}${stop(1, 'cg', 0.06)}</linearGradient>`

  return wrap(css, `${bg}<g class="cl" stroke="url(#cf)">${cols}</g>`, defs)
}

const fireflies = (): string => {
  const r = lcg(41)
  const flies = Array.from({ length: 26 }, (_, i) => {
    const x = n1(between(r, 90, 1510))
    const y = n1(between(r, 250, 800))
    const drift = 1 + (i % 4)
    const dd = n1(between(r, 18, 34))
    const pd = n1(between(r, 3.6, 7.5))

    return (
      `<g transform="translate(${x} ${y})"><g class="dr d${drift}" style="animation-duration:${dd}s;animation-delay:-${n1(between(r, 0, 20))}s">` +
      `<g class="pl" opacity=".6" style="animation-duration:${pd}s;animation-delay:-${n1(between(r, 0, 6))}s"><circle r="15" fill="url(#halo)"/><circle r="2.3" class="core"/></g></g></g>`
    )
  }).join('')
  const css =
    modes(
      '.bg{fill:#e9f0e1}.hill{fill:#cddcc0}.core{fill:#b88710}.h{stop-color:#d7a52a}',
      '.bg{fill:#07100d}.hill{fill:#030806}.core{fill:#f6f58a}.h{stop-color:#e6f26a}',
    ) +
    '.dr{animation:drift1 26s ease-in-out infinite alternate}.d2{animation-name:drift2}.d3{animation-name:drift3}.d4{animation-name:drift4}' +
    '.pl{animation:glow 5s ease-in-out infinite alternate}' +
    '@keyframes drift1{0%{transform:translate(0,0)}50%{transform:translate(40px,-26px)}100%{transform:translate(-20px,-50px)}}' +
    '@keyframes drift2{0%{transform:translate(0,0)}50%{transform:translate(-36px,-18px)}100%{transform:translate(24px,-44px)}}' +
    '@keyframes drift3{0%{transform:translate(0,0)}50%{transform:translate(22px,30px)}100%{transform:translate(-40px,-10px)}}' +
    '@keyframes drift4{0%{transform:translate(0,0)}50%{transform:translate(-26px,24px)}100%{transform:translate(34px,-24px)}}' +
    '@keyframes glow{from{opacity:.12}to{opacity:.95}}'
  const defs = `<radialGradient id="halo">${stop(0, 'h', 0.55)}${stop(1, 'h', 0)}</radialGradient>`
  const hills = `<path class="hill" d="M0 900 L0 790 C 250 730, 480 810, 760 770 S 1220 720, 1600 800 L1600 900 Z"/>`

  return wrap(css, `${bg}${hills}${flies}`, defs)
}

const wavePath = (y: number, amp: number) => {
  let d = `M0 ${y} Q 200 ${y - amp * 2} 400 ${y}`

  for (let i = 0; i < 7; i++) {
    d += ` T ${800 + i * 400} ${y}`
  }

  return `${d} L3200 900 L0 900 Z`
}

const ocean = (): string => {
  const layers = [
    { y: 500, amp: 14, cls: 'w1', dur: 62, rev: false, bob: 11, op: 0.55 },
    { y: 580, amp: 18, cls: 'w2', dur: 48, rev: true, bob: 9, op: 0.6 },
    { y: 670, amp: 22, cls: 'w3', dur: 38, rev: false, bob: 8, op: 0.7 },
    { y: 770, amp: 26, cls: 'w4', dur: 30, rev: true, bob: 7, op: 0.85 },
  ]
  const body = layers
    .map(
      l =>
        `<g class="bob" style="animation-duration:${l.bob}s"><path class="${l.cls} wv" opacity="${l.op}" d="${wavePath(l.y, l.amp)}" style="animation-duration:${l.dur}s;animation-direction:${l.rev ? 'reverse' : 'normal'}"/></g>`,
    )
    .join('')
  const css =
    modes(
      '.s1{stop-color:#eaf6fa}.s2{stop-color:#bfe2ee}.w1{fill:#9fd0e2}.w2{fill:#7dbcd6}.w3{fill:#5ba6c6}.w4{fill:#3f90b5}',
      '.s1{stop-color:#08182a}.s2{stop-color:#0c3350}.w1{fill:#0f4a6a}.w2{fill:#0c3f5c}.w3{fill:#093450}.w4{fill:#062a42}',
    ) +
    '.wv{animation:swell linear infinite}.bob{animation:bob 9s ease-in-out infinite alternate}' +
    '@keyframes swell{from{transform:translateX(0)}to{transform:translateX(-800px)}}@keyframes bob{from{transform:translateY(-7px)}to{transform:translateY(7px)}}'
  const defs = `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">${stop(0, 's1')}${stop(1, 's2')}</linearGradient>`

  return wrap(css, `<rect x="0" y="0" width="1600" height="900" fill="url(#sea)"/>${body}`, defs)
}

const fog = (): string => {
  const banks = [
    { cx: 300, cy: 280, rx: 640, ry: 150, dur: 58, dx: 160, delay: -10 },
    { cx: 1250, cy: 400, rx: 700, ry: 170, dur: 72, dx: -190, delay: -33 },
    { cx: 700, cy: 560, rx: 780, ry: 190, dur: 64, dx: 150, delay: -21 },
    { cx: 1400, cy: 720, rx: 620, ry: 150, dur: 50, dx: -140, delay: -5 },
    { cx: 200, cy: 780, rx: 700, ry: 160, dur: 80, dx: 200, delay: -44 },
  ]
  const body = banks
    .map(
      b =>
        `<ellipse class="fg" cx="${b.cx}" cy="${b.cy}" rx="${b.rx}" ry="${b.ry}" fill="url(#fogg)" opacity=".7" style="animation-duration:${b.dur}s;animation-delay:${b.delay}s;--dx:${b.dx}px"/>`,
    )
    .join('')
  const css =
    modes(
      '.bg{fill:#e4e8ec}.f{stop-color:#ffffff}',
      '.bg{fill:#0d1218}.f{stop-color:#a9b9cb}',
    ) +
    '.fg{animation:drift 60s ease-in-out infinite alternate}' +
    '@keyframes drift{0%{transform:translateX(0);opacity:.45}50%{opacity:.8}100%{transform:translateX(var(--dx));opacity:.55}}'
  const defs = `<radialGradient id="fogg">${stop(0, 'f', 0.55)}${stop(1, 'f', 0)}</radialGradient>`

  return wrap(css, `${bg}${body}`, defs)
}

const candle = (): string => {
  const css =
    modes(
      '.bg{fill:#f6ecdc}.c1{stop-color:#ffb14a}.c2{stop-color:#ff8a2a}.wax{fill:#ece0c8}.fl{fill:#f0a020}',
      '.bg{fill:#120b07}.c1{stop-color:#ffb14a}.c2{stop-color:#ff7a1a}.wax{fill:#d8c9ae}.fl{fill:#ffc860}',
    ) +
    '.gl{transform-box:fill-box;transform-origin:50% 50%;animation:flick 7s ease-in-out infinite}.big{animation-duration:11s;animation-delay:-3s}' +
    '.flame{transform-box:fill-box;transform-origin:50% 100%;animation:lick 5s ease-in-out infinite}' +
    '@keyframes flick{0%{transform:scale(1);opacity:.9}14%{transform:scale(1.05);opacity:1}31%{transform:scale(.97);opacity:.84}47%{transform:scale(1.06);opacity:.97}63%{transform:scale(.99);opacity:.88}80%{transform:scale(1.04);opacity:1}100%{transform:scale(1);opacity:.9}}' +
    '@keyframes lick{0%{transform:scale(1,1) skewX(0)}20%{transform:scale(.94,1.08) skewX(2deg)}45%{transform:scale(1.03,.95) skewX(-2deg)}70%{transform:scale(.97,1.06) skewX(1deg)}100%{transform:scale(1,1) skewX(0)}}'
  const defs =
    `<radialGradient id="g1">${stop(0, 'c1', 0.5)}${stop(0.45, 'c2', 0.16)}${stop(1, 'c2', 0)}</radialGradient>` +
    `<radialGradient id="g2">${stop(0, 'c1', 0.22)}${stop(1, 'c2', 0)}</radialGradient>`
  const body =
    `${bg}<circle class="gl big" cx="1230" cy="610" r="900" fill="url(#g2)"/><circle class="gl" cx="1230" cy="610" r="520" fill="url(#g1)"/>` +
    `<rect class="wax" x="1219" y="640" width="22" height="260" rx="3" opacity=".8"/>` +
    `<path class="fl flame" d="M1230 596 C 1222 612, 1221 626, 1230 638 C 1239 626, 1238 612, 1230 596 Z"/>`

  return wrap(css, body, defs)
}

const snow = (): string => {
  const flake = (rMin: number, rMax: number, cls: string) => (r: () => number, x: number, y: number) =>
    `<circle class="${cls}" cx="${n1(x)}" cy="${n1(y)}" r="${n1(between(r, rMin, rMax))}"/>`
  const body =
    fallLayer({ seed: 51, count: 34, cls: 'a', dur: 42, delay: -6, make: flake(0.9, 1.5, 'f1'), sway: 22 }) +
    fallLayer({ seed: 53, count: 22, cls: 'a', dur: 29, delay: -11, make: flake(1.5, 2.4, 'f2'), sway: 30 }) +
    fallLayer({ seed: 55, count: 12, cls: 'a', dur: 19, delay: -4, make: flake(2.4, 3.6, 'f3'), sway: 38 })
  const css =
    modes(
      '.bg{fill:#e8eef6}.f1,.f2,.f3{fill:#ffffff;stroke:#a9bad2;stroke-width:.6}.m{stop-color:#ffffff}',
      '.bg{fill:#0b121d}.f1,.f2,.f3{fill:#eaf1ff;stroke:none}.m{stop-color:#8ea6c4}',
    ) +
    '.f1{opacity:.55}.f2{opacity:.75}.f3{opacity:.9}.fall{animation-name:fall;animation-timing-function:linear;animation-iteration-count:infinite}' +
    '.sw{animation:sway 8s ease-in-out infinite alternate}' +
    '@keyframes fall{from{transform:translateY(0)}to{transform:translateY(900px)}}@keyframes sway{from{transform:translateX(calc(var(--sw) * -1))}to{transform:translateX(var(--sw))}}'
  const defs = `<linearGradient id="gm" x1="0" y1="0" x2="0" y2="1">${stop(0, 'm', 0)}${stop(1, 'm', 0.3)}</linearGradient>`

  return wrap(css, `${bg}<rect x="0" y="600" width="1600" height="300" fill="url(#gm)"/>${body}`, defs)
}

const glass = (): string => {
  const shapes = [
    { t: 'circle', a: 'cx="380" cy="300" r="260"', cls: 'k1', dx: 120, dy: 60, dur: 41, delay: -8 },
    { t: 'circle', a: 'cx="1230" cy="260" r="200"', cls: 'k2', dx: -100, dy: 90, dur: 53, delay: -22 },
    { t: 'rect', a: 'x="700" y="520" width="520" height="300" rx="150"', cls: 'k3', dx: 90, dy: -70, dur: 47, delay: -30 },
    { t: 'circle', a: 'cx="260" cy="760" r="190"', cls: 'k4', dx: 140, dy: -40, dur: 59, delay: -14 },
    { t: 'circle', a: 'cx="1400" cy="700" r="230"', cls: 'k5', dx: -120, dy: -60, dur: 44, delay: -36 },
  ]
  const body = shapes
    .map(
      s =>
        `<${s.t} class="gs ${s.cls}" ${s.a} opacity=".75" style="animation-duration:${s.dur}s;animation-delay:${s.delay}s;--dx:${s.dx}px;--dy:${s.dy}px"/>`,
    )
    .join('')
  const css =
    modes(
      '.bg{fill:#f3f4f9}.k1{fill:#9db4f5}.k2{fill:#f0a9c8}.k3{fill:#a6dccf}.k4{fill:#f2cf94}.k5{fill:#c1a9ee}',
      '.bg{fill:#0b0d16}.k1{fill:#3f63d8}.k2{fill:#c23f86}.k3{fill:#1d9a86}.k4{fill:#c9792b}.k5{fill:#7447c8}',
    ) +
    '.gs{animation:float 45s ease-in-out infinite alternate}' +
    '@keyframes float{from{transform:translate(0,0)}to{transform:translate(var(--dx),var(--dy))}}'

  return wrap(css, `${bg}${body}`)
}

export const SCENES: Record<string, SceneDef> = {
  aurora: { label: 'Aurora', alt: 'Slow ribbons of green and violet light over a night sky', svg: aurora() },
  rain: { label: 'Rain', alt: 'Fine rain falling in three layers', svg: rain() },
  starfield: { label: 'Starfield', alt: 'A field of stars turning very slowly', svg: starfield() },
  breathe: { label: 'Breathing gradient', alt: 'Soft colour glows slowly swelling and fading', svg: breathe() },
  horizon: { label: 'Grid horizon', alt: 'A glowing grid sliding toward a low sun', svg: horizon() },
  code: { label: 'Falling code', alt: 'Columns of green glyph-like dashes drifting downward', svg: code() },
  fireflies: { label: 'Fireflies', alt: 'Fireflies glowing and drifting above dark hills', svg: fireflies() },
  ocean: { label: 'Ocean swell', alt: 'Layers of slow sea swell', svg: ocean() },
  fog: { label: 'Fog', alt: 'Banks of fog drifting past', svg: fog() },
  candle: { label: 'Candle flicker', alt: 'A candle flame casting a warm, gently flickering glow', svg: candle() },
  snow: { label: 'Snow', alt: 'Snow drifting down in three layers', svg: snow() },
  glass: {
    label: 'Glass blur',
    alt: 'Soft coloured shapes drifting behind frosted glass',
    svg: glass(),
    glass: { blur: 48, opacity: 0.4 },
  },
}

export const SCENE_NAMES = Object.keys(SCENES)
