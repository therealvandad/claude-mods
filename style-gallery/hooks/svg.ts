// Pure SVG drawing for the style gallery: one small vector image per sample. No `$` here, so it is easy to test and preview.
// Colours follow the app's light or dark mode through a media query inside the SVG; the three mode samples
// (blueprint, terminal-green, print) keep their own fixed colours, because that is what they show.
// Nothing in here is active content: no script, no links, no images, no event attributes, no external references.
import { SAMPLES, byId } from './catalog'
import type { Sample } from './catalog'

export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'
export type Ctx = { accent: Accent; animate: boolean; grid: boolean; tips: boolean }

export const SVG_WIDTH = 520
export const SVG_MAX = 14_000

// Light and dark accent colours (hex), because SVG cannot read the app's theme keys.
const ACCENTS: Record<Accent, readonly [string, string]> = {
  suggestion: ['#4b57c9', '#a9b4ff'],
  claude: ['#c4562f', '#e08a68'],
  success: ['#2f8f4e', '#5fbf7a'],
  warning: ['#a8741a', '#f0b94a'],
  permission: ['#4b57c9', '#a9b4ff'],
  remember: ['#7b4bd0', '#b08cff'],
}
const ACCENT_KEYS = Object.keys(ACCENTS) as Accent[]

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const f = (n: number) => String(Math.round(n * 100) / 100)

type Out = { h: number; body: string; defs?: string; css?: string; grid?: boolean }

// --------------------------------------------------------------------------- small drawing helpers

const tx = (x: number, y: number, s: string, cls = '', anchor = '') =>
  `<text x="${f(x)}" y="${f(y)}"${anchor === '' ? '' : ` text-anchor="${anchor}"`}${cls === '' ? '' : ` class="${cls}"`}>${esc(s)}</text>`
const rc = (x: number, y: number, w: number, h: number, rx: number, cls: string, extra = '') =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" class="${cls}"${extra === '' ? '' : ` ${extra}`}/>`
const ci = (x: number, y: number, r: number, cls: string, extra = '') =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" class="${cls}"${extra === '' ? '' : ` ${extra}`}/>`
const ln = (x1: number, y1: number, x2: number, y2: number, cls: string, extra = '') =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="${cls}"${extra === '' ? '' : ` ${extra}`}/>`
const tip = (c: Ctx, s: string) => (c.tips ? `<title>${esc(s)}</title>` : '')
const grp = (inner: string, extra = '') => `<g${extra === '' ? '' : ` ${extra}`}>${inner}</g>`
const chev = (x: number, y: number, cls = 'ln2') => `<path d="M${f(x)} ${f(y - 4)} L${f(x + 4)} ${f(y)} L${f(x)} ${f(y + 4)}" class="${cls}"/>`

const TONES = { info: 'var(--acc)', success: 'var(--ok)', warning: 'var(--warn)', danger: 'var(--bad)', muted: 'var(--mut)' } as const

// --------------------------------------------------------------------------- the frame

const SHADOWS = `<filter id="s1" x="-20%" y="-20%" width="140%" height="170%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity=".14"/></filter>
<filter id="s2" x="-25%" y="-25%" width="150%" height="190%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity=".18"/></filter>
<filter id="s3" x="-30%" y="-30%" width="160%" height="230%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity=".24"/></filter>
<filter id="blur4" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4"/></filter>`

const GRID_DEFS = `<pattern id="g4" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M4 0H0V4" fill="none" class="gl" stroke-width=".4" opacity=".3"/></pattern>
<pattern id="g16" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" class="gl" stroke-width=".8" opacity=".45"/></pattern>`

const css = (c: Ctx, extra: string) => {
  const [light, dark] = ACCENTS[c.accent]
  const lightSet = ACCENT_KEYS.map((k, i) => `--a${i}:${ACCENTS[k][0]}`).join(';')
  const darkSet = ACCENT_KEYS.map((k, i) => `--a${i}:${ACCENTS[k][1]}`).join(';')

  return `
:root{--page:#f3f1ea;--card:#ffffff;--e0:#f3f1ea;--e1:#ffffff;--e2:#ffffff;--e3:#ffffff;--line:#dedad0;--text:#2b2a27;--mut:#8a867d;--acc:${light};--onacc:#ffffff;--ok:#2f8f4e;--warn:#a8741a;--bad:#c43a50;--track:#e6e2d6;--sil:#cfcbc0;--tipbg:#2b2a27;--tiptx:#ffffff;${lightSet}}
@media (prefers-color-scheme:dark){:root{--page:#232321;--card:#2d2d2b;--e0:#232321;--e1:#2d2d2b;--e2:#353533;--e3:#3e3e3b;--line:#46453f;--text:#ece9e2;--mut:#98948b;--acc:${dark};--onacc:#14142a;--ok:#5fbf7a;--warn:#f0b94a;--bad:#ff7a8a;--track:#3b3a36;--sil:#4a4944;--tipbg:#ece9e2;--tiptx:#232321;${darkSet}}}
text{font-family:-apple-system,system-ui,'Segoe UI',sans-serif;fill:var(--text);font-size:12px}
.b{font-weight:700} .m{fill:var(--mut)} .s{font-size:11px} .xs{font-size:10px} .h{font-size:14px;font-weight:700} .c{font-size:10px;font-weight:700;letter-spacing:.08em;fill:var(--mut)}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
.page{fill:var(--page)} .card{fill:var(--card);stroke:var(--line)} .e0{fill:var(--e0);stroke:var(--line)} .e1{fill:var(--e1);stroke:var(--line)} .e2{fill:var(--e2);stroke:var(--line)} .e3{fill:var(--e3);stroke:var(--line)}
.ln{stroke:var(--line);fill:none} .ln2{stroke:var(--mut);fill:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.acc{fill:var(--acc)} .accs{stroke:var(--acc);fill:none} .accsoft{fill:var(--acc);fill-opacity:.14} .accsel{fill:var(--acc);fill-opacity:.28} .at{fill:var(--acc)}
.ok{fill:var(--ok)} .warn{fill:var(--warn)} .bad{fill:var(--bad)} .mutf{fill:var(--mut)} .on{fill:var(--onacc)}
.trk{fill:var(--track)} .sk{fill:var(--text);fill-opacity:.08} .sil{fill:var(--sil)} .gl{stroke:var(--acc)}
.z2{fill:var(--text);fill-opacity:.02} .z8{fill:var(--text);fill-opacity:.08}
.tip{fill:var(--tipbg)} .tiptx{fill:var(--tiptx)}
.thumb{fill:var(--mut)}
${extra}
${
  c.animate
    ? `@keyframes shim{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.85}}
@keyframes slide{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
.sk{animation:shim 1.4s ease-in-out infinite} .glow{animation:pulse 1.8s ease-in-out infinite} .slide{animation:slide .6s cubic-bezier(.2,.8,.2,1) both} .cur{animation:blink 1s steps(1) infinite}`
    : ''
}`
}

const frame = (c: Ctx, o: Out): string => {
  const needsShadow = /url\(#s[123]\)|url\(#blur4\)/.test(o.body)
  const showGrid = (c.grid || o.grid === true) && o.grid !== false
  const defs = `${needsShadow ? SHADOWS : ''}${showGrid ? GRID_DEFS : ''}${o.defs ?? ''}`
  const overlay = showGrid ? `<g pointer-events="none"><rect width="${SVG_WIDTH}" height="${o.h}" fill="url(#g4)"/><rect width="${SVG_WIDTH}" height="${o.h}" fill="url(#g16)"/></g>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${o.h}" width="${SVG_WIDTH}" height="${o.h}" role="img">${defs === '' ? '' : `<defs>${defs}</defs>`}<style>${css(c, o.css ?? '')}</style>${o.body}${overlay}</svg>`
}

// --------------------------------------------------------------------------- the pixel font (5 by 5)

const GLYPHS: Record<string, readonly string[]> = {
  S: ['.####', '#....', '.###.', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  P: ['####.', '#...#', '####.', '#....', '#....'],
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  G: ['.####', '#....', '#..##', '#...#', '.###.'],
}

// A word as square cells: neighbouring cells of one row are merged into one rect, to keep the drawing small.
export const pixelWord = (word: string, x: number, y: number, cell: number, cls: string): string => {
  let out = ''
  let cx = x

  for (const ch of word.toUpperCase().slice(0, 12)) {
    const rows = GLYPHS[ch]

    if (rows !== undefined) {
      rows.forEach((row, r) => {
        for (const m of row.matchAll(/#+/g)) {
          out += `<rect x="${cx + (m.index ?? 0) * cell}" y="${y + r * cell}" width="${m[0].length * cell}" height="${cell}" class="${cls}"/>`
        }
      })
    }
    cx += 6 * cell
  }

  return out
}

// --------------------------------------------------------------------------- the drawers

const radius = (c: Ctx): Out => {
  const items = [
    [4, 'sm', '4 px', 'inputs, chips, badges'],
    [8, 'md', '8 px', 'cards, menus'],
    [16, 'lg', '16 px', 'panels, sheets, dialogs'],
  ] as const
  let b = rc(0, 0, SVG_WIDTH, 124, 12, 'page')

  items.forEach(([r, name, px, use], i) => {
    const x = 16 + i * 166
    b += grp(
      `${tip(c, `${name}: ${px} corner radius`)}${rc(x, 16, 150, 92, r, 'card')}<path d="M${x} ${16 + r} A${r} ${r} 0 0 1 ${x + r} 16" class="accs" stroke-width="2.4"/>${tx(x + 14, 44, name, 'h')}${tx(x + 14, 62, px, 'm s')}${tx(x + 14, 94, use, 'm xs')}`,
    )
  })

  return { h: 124, body: b }
}

const elevation = (c: Ctx): Out => {
  const levels = [
    ['0 flat', 'no shadow'],
    ['1 raised', '1 / 2 px, 14%'],
    ['2 overlay', '4 / 10 px, 18%'],
    ['3 modal', '12 / 28 px, 24%'],
  ] as const
  let b = rc(0, 0, SVG_WIDTH, 132, 12, 'page')

  levels.forEach(([name, spec], i) => {
    const x = 18 + i * 126

    b += grp(`${tip(c, `Level ${name}: ${spec}`)}${rc(x, 20, 108, 62, 10, `e${i}`, i > 0 ? `filter="url(#s${i})"` : '')}${tx(x + 54, 108, name, 'b', 'middle')}${tx(x + 54, 122, spec, 'm xs', 'middle')}`)
  })

  return { h: 132, body: b }
}

const spacing = (c: Ctx): Out => {
  const sizes = [
    [4, 'xs'],
    [8, 'sm'],
    [12, 'md'],
    [16, 'lg'],
    [24, 'xl'],
    [32, '2xl'],
  ] as const
  let b = rc(0, 0, SVG_WIDTH, 204, 12, 'page')
  let x = 24

  for (const [n, name] of sizes) {
    b += grp(`${tip(c, `${name}: ${n} px`)}${rc(x, 64 - n, n, n, 1, 'acc')}${tx(x + n / 2, 82, String(n), 'b s', 'middle')}${tx(x + n / 2, 96, name, 'm xs', 'middle')}`)
    x += n + 34
  }
  b += tx(24, 22, 'THE 4 PX SCALE', 'c')
  b += rc(16, 116, 232, 76, 8, 'card') + rc(32, 132, 200, 44, 4, 'accs', 'stroke-width="1.2" stroke-dasharray="3 3"') + tx(24, 128, '16', 'acc b xs', 'middle')
  b += tx(132, 158, 'content, padding 16', 'm s', 'middle')
  b += rc(280, 124, 96, 52, 8, 'card') + rc(384, 124, 96, 52, 8, 'card') + rc(376, 144, 8, 12, 0, 'accsoft') + tx(380, 190, '8', 'acc b xs', 'middle')
  b += tx(328, 154, 'card', 'm s', 'middle') + tx(432, 154, 'card', 'm s', 'middle')

  return { h: 204, body: b, grid: true }
}

const zebra = (c: Ctx): Out => {
  const names = ['Radius scale', 'Elevation', 'Spacing', 'Zebra rows', 'Highlight', 'Divider']
  let b = rc(0, 0, SVG_WIDTH, 212, 12, 'page')

  for (const [x, cls, label] of [[16, 'z2', '2% (the spec)'], [268, 'z8', '8% (too loud)']] as const) {
    b += tx(x, 24, label, 'c') + rc(x, 32, 236, 168, 8, 'card')
    names.forEach((n, i) => {
      b += (i % 2 === 1 ? rc(x + 1, 34 + i * 27, 234, 27, 0, cls) : '') + tx(x + 12, 52 + i * 27, n, 's') + tx(x + 224, 52 + i * 27, String(10 + i * 3), 'm s mono', 'end')
    })
  }

  return { h: 212, body: `${b}${tip(c, 'Every second row is the text colour at 2% opacity')}` }
}

const highlight = (c: Ctx): Out => {
  const names = ['Radius scale', 'Elevation scale', 'Spacing guide', 'Zebra rows', 'Highlight band']
  let b = rc(0, 0, SVG_WIDTH, 196, 12, 'page') + rc(16, 14, 488, 168, 8, 'card')

  names.forEach((n, i) => {
    const y = 20 + i * 32
    const cur = i === 2
    const hov = i === 3

    b += (cur ? grp(`${tip(c, 'Current row: accent at 12%, 3 px bar')}${rc(20, y, 480, 30, 5, 'accsoft')}${rc(20, y + 4, 3, 22, 1.5, 'acc')}`) : '') + (hov ? rc(20, y, 480, 30, 5, 'accsoft', 'fill-opacity=".06"') : '')
    b += tx(36, y + 20, n, cur ? 's b' : 's') + tx(486, y + 20, cur ? 'current' : hov ? 'hover' : '', cur ? 'acc b xs' : 'm xs', 'end')
  })

  return { h: 196, body: b }
}

const selection = (c: Ctx): Out => {
  let b = rc(0, 0, SVG_WIDTH, 152, 12, 'page') + rc(16, 14, 488, 54, 8, 'card')
  b += tx(32, 36, 'THE SELECTION FOLLOWS THE ACCENT', 'c')
  b += grp(`${tip(c, 'Selection: the accent at 28%; the text colour stays')}${rc(32 + 10 * 8.4, 44, 15 * 8.4, 18, 2, 'accsel')}<text x="32" y="58" class="mono" style="font-size:14px" textLength="${f(44 * 8.4)}" lengthAdjust="spacing">The quick brown fox jumps over the lazy dog</text>${ln(32 + 25 * 8.4, 44, 32 + 25 * 8.4, 62, 'accs', 'stroke-width="1.6"')}`)
  ACCENT_KEYS.forEach((k, i) => {
    const x = 16 + i * 82
    b += grp(`${tip(c, `Accent ${k}`)}${rc(x, 84, 72, 26, 5, 'card')}<rect x="${x + 6}" y="89" width="60" height="16" rx="2" style="fill:var(--a${i});fill-opacity:.28"/>${tx(x + 36, 101, 'select', 'mono xs', 'middle')}${tx(x + 36, 128, k, 'm xs', 'middle')}`)
  })

  return { h: 152, body: b }
}

const focus = (c: Ctx): Out => {
  const btn = (x: number, label: string, primary: boolean, ring: boolean, caption: string) =>
    grp(
      `${tip(c, caption)}${ring ? rc(x - 8, 34, 136, 52, 15, 'acc glow', 'fill-opacity=".35" filter="url(#blur4)"') + rc(x - 4, 38, 128, 44, 12, 'accs', 'stroke-width="2"') : ''}${rc(x, 42, 120, 36, 8, primary ? 'acc' : 'card')}${tx(x + 60, 65, label, primary ? 'on b' : 'b', 'middle')}${tx(x + 60, 112, caption, 'm xs', 'middle')}`,
    )

  return {
    h: 126,
    body: `${rc(0, 0, SVG_WIDTH, 126, 12, 'page')}${btn(24, 'Resting', false, false, 'no ring')}${btn(200, 'Focused', false, true, 'ring 2 px, offset 2, glow')}${btn(376, 'Primary', true, true, 'on a filled button')}`,
  }
}

const scrollbar = (c: Ctx): Out => {
  const pane = (x: number, w: number, thumb: number, tone: number, label: string) => {
    let b = rc(x, 14, 236, 128, 8, 'card')

    for (let i = 0; i < 6; i++) {
      b += rc(x + 14, 28 + i * 18, 120 + ((i * 37) % 70), 8, 4, 'trk')
    }
    b += rc(x + 236 - 6 - w, 24, w, 52, w / 2, 'thumb', `fill-opacity="${tone}"`)

    return grp(`${tip(c, label)}${b}${tx(x + 118, 162, label, 'm xs', 'middle')}`)
  }

  return { h: 174, body: `${rc(0, 0, SVG_WIDTH, 174, 12, 'page')}${pane(16, 6, 0, 0.4, 'resting: 6 px, 40%')}${pane(268, 10, 0, 0.7, 'hover or drag: 10 px, 70%')}` }
}

const divider = (c: Ctx): Out => {
  const rule = (y: number, label: string, cls: string, left = false) => {
    if (left) {
      return grp(`${tx(24, y + 4, label, cls)}${ln(24 + label.length * 7 + 12, y, 496, y, 'ln')}`)
    }
    const half = label.length * 3.3 + 12

    return grp(`${ln(24, y, 260 - half, y, 'ln')}${tx(260, y + 4, label, cls, 'middle')}${ln(260 + half, y, 496, y, 'ln')}`)
  }

  return {
    h: 150,
    body: `${rc(0, 0, SVG_WIDTH, 150, 12, 'page')}${tip(c, 'A line with a centred label')}${rule(30, 'or', 'm s')}${rule(66, 'Today', 'acc b s')}${rule(102, 'Section', 'm b s', true)}${grp(`${ln(24, 132, 238, 132, 'ln')}${rc(246, 122, 28, 20, 10, 'accsoft')}${tx(260, 136, 'NEW', 'acc b xs', 'middle')}${ln(282, 132, 496, 132, 'ln')}`)}`,
  }
}

const badge = (c: Ctx): Out => {
  const tones = [['info', 'info'], ['success', 'success'], ['warning', 'warning']] as const
  const styles = ['filled', 'outline', 'soft'] as const
  let b = rc(0, 0, SVG_WIDTH, 164, 12, 'page') + rc(16, 12, 488, 140, 8, 'card')

  styles.forEach((s, j) => {
    b += tx(150 + j * 120 + 42, 36, s, 'c', 'middle')
  })
  tones.forEach(([tone, label], i) => {
    const y = 52 + i * 34
    const col = TONES[tone]

    b += tx(32, y + 14, tone, 'm s')
    styles.forEach((s, j) => {
      const x = 150 + j * 120
      const style = s === 'filled' ? `fill:${col}` : s === 'outline' ? `fill:none;stroke:${col};stroke-width:1.2` : `fill:${col};fill-opacity:.16`
      const textStyle = s === 'filled' ? 'fill:var(--onacc)' : `fill:${col}`

      b += grp(`${tip(c, `${s} ${tone} badge`)}<rect x="${x}" y="${y}" width="84" height="20" rx="4" style="${style}"/><text x="${x + 42}" y="${y + 14}" text-anchor="middle" class="b s" style="${textStyle}">${esc(label)}</text>`)
    })
  })

  return { h: 164, body: b }
}

const chip = (c: Ctx): Out => {
  const chips = [
    ['build passing', 'success', false],
    ['review needed', 'warning', false],
    ['draft', 'muted', false],
    ['blocked', 'danger', false],
    ['selected', 'info', true],
    ['live', 'success', true],
  ] as const
  let b = rc(0, 0, SVG_WIDTH, 116, 12, 'page')
  let x = 16
  let y = 20

  chips.forEach(([label, tone, selected], i) => {
    const w = 38 + label.length * 6.2 + (selected ? 14 : 0)

    if (i === 4) {
      x = 16
      y = 66
    }
    b += grp(
      `${tip(c, `${label}: ${tone} dot${selected ? ', selected, removable' : ''}`)}${rc(x, y, w, 26, 13, selected ? 'accsoft' : 'card')}${selected ? rc(x, y, w, 26, 13, 'accs', 'stroke-width="1"') : ''}${ci(x + 14, y + 13, 4, 'acc', `style="fill:${TONES[tone]}"`)}${tx(x + 26, y + 17, label, 's')}${selected ? tx(x + w - 12, y + 17, '×', 'm s', 'middle') : ''}`,
    )
    x += w + 10
  })
  b += tx(16, 108, 'dot 8 px, gap 8, height 24, pill', 'm xs')

  return { h: 116, body: b }
}

const toast = (c: Ctx): Out => {
  const cls = c.animate ? 'slide' : ''

  return {
    h: 150,
    body: `${rc(0, 0, SVG_WIDTH, 150, 12, 'page')}${grp(`${tip(c, 'Pill toast: one line, fully rounded')}${rc(24, 36, 214, 40, 20, 'e2', 'filter="url(#s2)"')}${ci(46, 56, 5, 'ok')}${tx(62, 60, 'Saved to the project', 's b')}${tx(131, 108, 'pill: one line, 3 s', 'm xs', 'middle')}`, cls === '' ? '' : `class="${cls}"`)}${grp(`${tip(c, 'Card toast: title, body, action')}${rc(268, 18, 232, 80, 8, 'e2', 'filter="url(#s2)"')}${rc(268, 18, 4, 80, 2, 'acc')}${tx(286, 42, 'Build finished', 'b')}${tx(286, 60, '12 tests passed', 'm s')}${tx(484, 84, 'View', 'acc b s', 'end')}${tx(384, 124, 'card: title, body, action, 5 s', 'm xs', 'middle')}`, cls === '' ? '' : `class="${cls}" style="animation-delay:.12s"`)}`,
  }
}

const tooltip = (c: Ctx): Out => {
  const bubble = (x: number, y: number, w: number, label: string, pointer: 'down' | 'up', kbd = '') => {
    const cx = x + w / 2
    const tri = pointer === 'down' ? `${f(cx - 5)},${y + 30} ${f(cx + 5)},${y + 30} ${f(cx)},${y + 36}` : `${f(cx - 5)},${y} ${f(cx + 5)},${y} ${f(cx)},${y - 6}`

    return `${rc(x, y, w, 30, 6, 'tip')}<polygon points="${tri}" class="tip"/>${tx(x + 12, y + 19, label, 'tiptx s')}${kbd === '' ? '' : `${rc(x + w - 28, y + 6, 18, 18, 4, 'tiptx', 'fill-opacity=".22"')}${tx(x + w - 19, y + 19, kbd, 'tiptx b xs', 'middle')}`}`
  }

  return {
    h: 150,
    body: `${rc(0, 0, SVG_WIDTH, 150, 12, 'page')}${bubble(40, 24, 150, 'Copy spec to prompt', 'down')}${grp(`${tip(c, 'This hover title is the only real tooltip an SVG can have')}${rc(80, 72, 70, 32, 8, 'card')}${tx(115, 93, 'Copy', 'b', 'middle')}`)}${tx(115, 130, 'above, pointer 10 x 6', 'm xs', 'middle')}${grp(`${tip(c, 'Target of the second tooltip')}${rc(320, 24, 70, 32, 8, 'card')}${tx(355, 45, 'Grid', 'b', 'middle')}`)}${bubble(270, 70, 170, 'Show 4 px grid', 'up', 'G')}${tx(355, 130, 'below, with a shortcut chip', 'm xs', 'middle')}`,
  }
}

const skeleton = (c: Ctx): Out => {
  const card = (x: number, loaded: boolean) => {
    let b = rc(x, 12, 236, 168, 12, 'card')

    if (!loaded) {
      b += ci(x + 36, 46, 18, 'sk') + rc(x + 64, 34, 130, 10, 5, 'sk') + rc(x + 64, 52, 84, 8, 4, 'sk') + rc(x + 16, 78, 204, 52, 8, 'sk') + rc(x + 16, 144, 74, 24, 6, 'sk')
    } else {
      b += ci(x + 36, 46, 18, 'acc') + tx(x + 36, 52, 'A', 'on b', 'middle') + tx(x + 64, 43, 'Ada Lovelace', 'b') + tx(x + 64, 59, 'First programmer', 'm s')
      b += rc(x + 16, 78, 204, 52, 8, 'accsoft') + `<path d="M${x + 36} 120 L${x + 72} 94 L${x + 100} 112 L${x + 130} 98 L${x + 200} 120 Z" class="acc" fill-opacity=".5"/>`
      b += rc(x + 16, 144, 74, 24, 6, 'acc') + tx(x + 53, 160, 'Open', 'on b s', 'middle')
    }

    return b
  }

  return {
    h: 214,
    body: `${rc(0, 0, SVG_WIDTH, 214, 12, 'page')}${grp(`${tip(c, 'Loading: placeholders with the final boxes')}${card(16, false)}`)}${grp(`${tip(c, 'Loaded: the same boxes, no layout shift')}${card(268, true)}`)}${tx(134, 204, 'loading: the same boxes', 'm xs', 'middle')}${tx(386, 204, 'loaded: nothing moves', 'm xs', 'middle')}`,
  }
}

const onboarding = (c: Ctx): Out => {
  const cards = [
    ['1  Ask', 'Describe the change', 'in plain words'],
    ['2  Watch', 'Follow each step', 'as it happens'],
    ['3  Ship', 'Review the result', 'and keep it'],
  ] as const
  const art = [
    (cx: number) => `${rc(cx - 38, 22, 76, 44, 12, 'accsoft')}${rc(cx - 38, 22, 76, 44, 12, 'accs', 'stroke-width="1.6"')}${rc(cx - 26, 34, 52, 5, 2.5, 'acc', 'fill-opacity=".6"')}${rc(cx - 26, 46, 34, 5, 2.5, 'acc', 'fill-opacity=".35"')}<path d="M${cx - 18} 66 L${cx - 22} 78 L${cx - 8} 66 Z" class="acc" fill-opacity=".4"/>${rc(cx + 14, 64, 28, 18, 8, 'trk')}`,
    (cx: number) => `${rc(cx - 34, 26, 60, 6, 3, 'trk')}${rc(cx - 34, 40, 44, 6, 3, 'trk')}${rc(cx - 34, 54, 52, 6, 3, 'trk')}${ci(cx + 12, 54, 20, 'accsoft')}${ci(cx + 12, 54, 20, 'accs', 'stroke-width="3"')}${ln(cx + 26, 68, cx + 40, 82, 'accs', 'stroke-width="4" stroke-linecap="round"')}`,
    (cx: number) => `${ci(cx, 52, 28, 'accsoft')}<path d="M${cx - 12} 52 L${cx - 3} 62 L${cx + 14} 42" class="accs" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>${ln(cx + 34, 22, cx + 34, 32, 'accs', 'stroke-width="2.5" stroke-linecap="round"')}${ln(cx + 29, 27, cx + 39, 27, 'accs', 'stroke-width="2.5" stroke-linecap="round"')}${ci(cx - 36, 30, 3, 'acc', 'fill-opacity=".5"')}`,
  ]
  let b = rc(0, 0, SVG_WIDTH, 208, 12, 'page')

  cards.forEach(([title, l1, l2], i) => {
    const x = 12 + i * 170
    const cx = x + 78

    b += grp(`${tip(c, `Card ${title.replace('  ', ' ')}`)}${rc(x, 10, 156, 188, 16, 'e1', 'filter="url(#s1)"')}${art[i]?.(cx) ?? ''}${tx(cx, 124, title, 'h', 'middle')}${tx(cx, 144, l1, 's', 'middle')}${tx(cx, 158, l2, 'm s', 'middle')}${[0, 1, 2].map(d => ci(cx - 12 + d * 12, 182, 3, d === i ? 'acc' : 'trk')).join('')}`)
  })

  return { h: 208, body: b }
}

const mascot = (c: Ctx): Out => {
  const cat = (cx: number) => `<path d="M${cx - 24} 118 C${cx - 30} 92 ${cx - 18} 74 ${cx} 74 C${cx + 18} 74 ${cx + 30} 92 ${cx + 24} 118 Z" class="sil"/>${ci(cx, 60, 18, 'sil')}<path d="M${cx - 16} 52 L${cx - 14} 30 L${cx - 3} 44 Z M${cx + 16} 52 L${cx + 14} 30 L${cx + 3} 44 Z" class="sil"/><path d="M${cx + 22} 114 C${cx + 52} 116 ${cx + 54} 90 ${cx + 40} 84" class="sil" fill="none" style="stroke:var(--sil)" stroke-width="7" stroke-linecap="round"/>${ci(cx - 6, 60, 2.4, 'page')}${ci(cx + 6, 60, 2.4, 'page')}`
  const robot = (cx: number) => `${rc(cx - 26, 44, 52, 38, 9, 'sil')}${rc(cx - 20, 86, 40, 32, 6, 'sil')}${ln(cx, 44, cx, 32, 'sil', 'style="stroke:var(--sil)" stroke-width="4" stroke-linecap="round"')}${ci(cx, 29, 5, 'sil')}${rc(cx - 34, 90, 10, 22, 5, 'sil')}${rc(cx + 24, 90, 10, 22, 5, 'sil')}${ci(cx - 10, 62, 4, 'page')}${ci(cx + 10, 62, 4, 'page')}`
  const ghost = (cx: number) => `<path d="M${cx - 26} 120 L${cx - 26} 66 A26 26 0 0 1 ${cx + 26} 66 L${cx + 26} 120 L${cx + 17} 111 L${cx + 8.5} 120 L${cx} 111 L${cx - 8.5} 120 L${cx - 17} 111 Z" class="sil"/>${ci(cx - 9, 66, 3.4, 'page')}${ci(cx + 9, 66, 3.4, 'page')}`
  const items = [
    [cat, 'cat', 'No sessions yet'],
    [robot, 'robot', 'No tools ran'],
    [ghost, 'ghost', 'All quiet here'],
  ] as const
  let b = rc(0, 0, SVG_WIDTH, 196, 12, 'page')

  items.forEach(([draw, name, msg], i) => {
    const x = 12 + i * 170
    const cx = x + 78

    b += grp(`${tip(c, `${name} silhouette`)}${rc(x, 10, 156, 176, 12, 'card')}${draw(cx)}${tx(cx, 154, msg, 'b s', 'middle')}${tx(cx, 170, name, 'm xs', 'middle')}`)
  })

  return { h: 196, body: b }
}

const pixel = (c: Ctx): Out => {
  const heart = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...']
  let h = ''

  heart.forEach((row, r) => {
    for (const m of row.matchAll(/#+/g)) {
      h += `<rect x="${330 + (m.index ?? 0) * 8}" y="${34 + r * 8}" width="${m[0].length * 8}" height="8" class="bad"/>`
    }
  })
  const swatches = ['acc', 'ok', 'warn', 'bad'].map((cls, i) => rc(330 + i * 28, 104, 20, 20, 0, cls)).join('')

  return {
    h: 160,
    body: `${rc(0, 0, SVG_WIDTH, 160, 4, 'card')}${grp(`${tip(c, 'Pixel font, 5 x 5 cells of 8 px, drawn as SVG rects')}${pixelWord('STYLE', 28, 28, 8, 'trk')}${pixelWord('STYLE', 24, 24, 8, 'acc')}`, 'shape-rendering="crispEdges"')}${grp(`${tip(c, 'Same font at 4 px cells')}${pixelWord('PIXEL', 24, 92, 4, 'mutf')}${pixelWord('GALLERY', 24, 120, 4, 'mutf')}`, 'shape-rendering="crispEdges"')}${grp(`${tip(c, 'A 7 x 6 sprite')}${h}`, 'shape-rendering="crispEdges"')}${grp(swatches, 'shape-rendering="crispEdges"')}${tx(330, 146, '4 colours, hard shadow 4 px', 'm xs')}`,
  }
}

const blueprint = (c: Ctx): Out => {
  const w = '#e8f1ff'

  return {
    h: 196,
    defs: `<pattern id="bp1" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#fff" stroke-width=".5" opacity=".12"/></pattern><pattern id="bp5" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#fff" stroke-width=".8" opacity=".25"/></pattern>`,
    css: `.bt{fill:#cfe3ff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px}`,
    body: `<rect width="${SVG_WIDTH}" height="196" rx="6" fill="#0d3b72"/><rect width="${SVG_WIDTH}" height="196" fill="url(#bp1)"/><rect width="${SVG_WIDTH}" height="196" fill="url(#bp5)"/>${grp(`${tip(c, 'Outline-only part, A-A section')}<rect x="60" y="30" width="200" height="100" fill="none" stroke="${w}" stroke-width="1.6"/><circle cx="160" cy="80" r="30" fill="none" stroke="${w}" stroke-width="1.2" stroke-dasharray="6 3"/><path d="M148 80H172M160 68V92" stroke="${w}" stroke-width=".8"/>`)}${grp(`${tip(c, 'Dimension lines with arrows')}<path d="M60 150H260M60 144V156M260 144V156M60 150l6-3v6zM260 150l-6-3v6z" fill="none" stroke="${w}" stroke-width="1"/><path d="M290 30V130M284 30H296M284 130H296" fill="none" stroke="${w}" stroke-width="1"/><text x="160" y="146" text-anchor="middle" class="bt">200</text><text x="300" y="84" class="bt">100</text>`)}<circle cx="400" cy="70" r="36" fill="none" stroke="${w}" stroke-width="1.4"/><path d="M400 70L426 44" stroke="${w}" stroke-width="1"/><text x="430" y="40" class="bt">R36</text><rect x="344" y="136" width="164" height="48" fill="none" stroke="${w}" stroke-width="1.2"/><path d="M344 154H508" stroke="${w}" stroke-width=".8"/><text x="352" y="149" class="bt">STYLE GALLERY</text><text x="352" y="172" class="bt">A-A  1:1  SHEET 1/1</text>`,
  }
}

const terminal = (c: Ctx): Out => {
  const g1 = '#33ff66'
  const g2 = '#1fae45'
  const g3 = '#0f6a29'
  const lines: readonly [string, string][] = [
    ['$ gallery --mode terminal-green', g1],
    ['ok   radius scale ........ 4 / 8 / 16', g2],
    ['ok   elevation ........... levels 0-3', g2],
    ['ok   spacing ............. 4 px grid', g2],
    ['!!   scrollbars: preview only', g3],
  ]

  return {
    h: 188,
    css: `.tg{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre}`,
    body: `<rect width="${SVG_WIDTH}" height="188" fill="#0a0f0a"/><rect x="1" y="1" width="518" height="186" fill="none" stroke="${g3}"/>${grp(`${tip(c, 'Phosphor green on near-black, monospace, no radius')}${lines.map(([t, col], i) => `<text x="20" y="${34 + i * 22}" class="tg" style="fill:${col}">${esc(t)}</text>`).join('')}<text x="20" y="${34 + lines.length * 22}" class="tg" style="fill:${g1}">$</text><rect x="36" y="${22 + lines.length * 22}" width="9" height="16" fill="${g1}" class="cur"/>`)}${['#33ff66', '#1fae45', '#0f6a29', '#0a0f0a'].map((col, i) => `<rect x="${420 + i * 22}" y="150" width="16" height="16" fill="${col}" stroke="${g3}"/>`).join('')}<text x="420" y="144" class="tg" style="fill:${g2};font-size:10px">palette</text>`,
  }
}

const print = (c: Ctx): Out => {
  const k = '#111'
  const bars = [['hatch', 30], ['dots', 56], ['none', 44]] as const

  return {
    h: 204,
    defs: `<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" stroke="${k}" stroke-width="1.2"/></pattern><pattern id="dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".9" fill="${k}"/></pattern>`,
    css: `.pt{fill:${k};font-family:Georgia,'Times New Roman',serif;font-size:12px}`,
    body: `<rect width="${SVG_WIDTH}" height="204" fill="#fff"/><rect x="8.5" y="8.5" width="503" height="187" fill="none" stroke="${k}" stroke-width="1"/>${grp(`${tip(c, 'Report header with an outline badge')}<text x="24" y="38" class="pt" style="font-size:18px;font-weight:700">Report</text><rect x="104" y="24" width="44" height="18" rx="3" fill="none" stroke="${k}"/><text x="126" y="37" text-anchor="middle" class="pt" style="font-size:10px">draft</text><path d="M24 50H496" stroke="${k}"/>`)}${grp(`${tip(c, 'Table with rules, no stripes or fills')}${[0, 1, 2].map(i => `<text x="24" y="${76 + i * 24}" class="pt">${['Radius scale', 'Elevation', 'Spacing'][i]}</text><text x="236" y="${76 + i * 24}" text-anchor="end" class="pt">${[4, 8, 12][i]} px</text><path d="M24 ${84 + i * 24}H236" stroke="${k}" stroke-width=".5"/>`).join('')}`)}${grp(`${tip(c, 'Hatching and dots instead of colour')}${bars.map(([n, v], i) => `<rect x="${290 + i * 62}" y="${150 - v * 1.5}" width="46" height="${v * 1.5}" fill="${n === 'none' ? 'none' : `url(#${n})`}" stroke="${k}"/>`).join('')}<path d="M280 150H500" stroke="${k}"/>`)}<text x="24" y="172" class="pt" style="font-size:10px">https://example.com/report (links print their address)</text><text x="24" y="188" class="pt" style="font-size:10px;font-style:italic">1 px ink, no fills, no shadows, light only</text>`,
  }
}

const icon = (kind: number, x: number, y: number, cls: string) => {
  switch (kind) {
    case 0:
      return `<rect x="${x}" y="${y}" width="12" height="12" rx="2" class="${cls}" fill="none" stroke-width="1.4"/>`
    case 1:
      return `<circle cx="${x + 6}" cy="${y + 6}" r="5.5" class="${cls}" fill="none" stroke-width="1.4"/><circle cx="${x + 6}" cy="${y + 6}" r="2" class="${cls === 'accs' ? 'acc' : 'mutf'}"/>`
    case 2:
      return `<path d="M${x} ${y + 12} A6 6 0 1 1 ${x + 12} ${y + 12}" class="${cls}" fill="none" stroke-width="1.4"/>`
    case 3:
      return `<path d="M${x + 1} ${y + 1} L${x + 12} ${y + 6} L${x + 1} ${y + 11} Z" class="${cls}" fill="none" stroke-width="1.4"/>`
    default:
      return `<path d="M${x} ${y + 2}H${x + 12}M${x} ${y + 6}H${x + 12}M${x} ${y + 10}H${x + 12}" class="${cls}" fill="none" stroke-width="1.4"/>`
  }
}

const tabbar = (c: Ctx): Out => {
  const labels = ['Surfaces', 'Controls', 'Feedback', 'Navigation'] as const
  let b = rc(0, 0, SVG_WIDTH, 126, 12, 'page') + rc(16, 12, 488, 44, 8, 'card') + tx(24, 70, 'UNDERLINE', 'c')
  let x = 28

  labels.forEach((l, i) => {
    const on = i === 1
    const w = 44 + l.length * 7.4

    b += grp(`${tip(c, `${l}${on ? ' (active)' : ''}`)}${icon(i, x, 28, on ? 'accs' : 'ln2')}${tx(x + 20, 39, l, on ? 'b acc' : 'm b')}${on ? rc(x - 6, 52, w - 4, 2, 1, 'acc') : ''}`)
    x += w + 10
  })
  b += rc(16, 80, 488, 36, 18, 'card')
  x = 28
  labels.forEach((l, i) => {
    const on = i === 2
    const w = 42 + l.length * 7.4

    b += grp(`${on ? rc(x - 8, 86, w, 24, 12, 'accsoft') : ''}${icon(i, x, 92, on ? 'accs' : 'ln2')}${tx(x + 20, 103, l, on ? 'b acc' : 'm b')}`)
    x += w + 8
  })
  b += tx(496, 102, 'PILL', 'c', 'end')

  return { h: 126, body: b }
}

const breadcrumb = (c: Ctx): Out => {
  const trail = (y: number, parts: readonly string[], sep: 'chev' | 'slash', last = true) => {
    let b = ''
    let x = 28

    parts.forEach((p, i) => {
      const isLast = last && i === parts.length - 1
      b += tx(x, y + 4, p, isLast ? 'b s' : 'm s')
      x += p.length * 7 + 8

      if (i < parts.length - 1) {
        b += sep === 'chev' ? chev(x, y) : tx(x, y + 4, '/', 'm s')
        x += 14
      }
    })

    return b
  }

  return {
    h: 128,
    body: `${rc(0, 0, SVG_WIDTH, 128, 12, 'page')}${rc(16, 12, 488, 100, 8, 'card')}${grp(`${tip(c, 'Chevron trail; the last item is plain text')}${trail(34, ['Gallery', 'Navigation', 'Breadcrumbs'], 'chev')}`)}${grp(`${tip(c, 'Collapsed: Gallery > Navigation > Search box > Breadcrumbs')}${trail(66, ['Gallery', '…', 'Breadcrumbs'], 'chev')}${tx(496, 70, 'narrow: middle collapses', 'm xs', 'end')}`)}${grp(`${tip(c, 'Slash trail')}${trail(98, ['gallery', 'navigation', 'breadcrumbs'], 'slash')}`)}`,
  }
}

const searchbox = (c: Ctx): Out => {
  const field = (y: number, value: string, focused: boolean, right: string, rightCls: string) =>
    grp(
      `${focused ? rc(14, y - 4, 312, 42, 12, 'glow acc', 'fill-opacity=".18" filter="url(#blur4)"') + rc(12, y - 2, 316, 38, 10, 'accs', 'stroke-width="1.6"') : ''}${rc(16, y, 308, 34, 8, 'card')}${ci(34, y + 16, 5.5, 'ln2')}${ln(38, y + 20, 42, y + 24, 'ln2')}${value === '' ? tx(52, y + 21, 'Search...', 'm s') : tx(52, y + 21, value, 's')}${value === '' ? '' : `${ci(306, y + 17, 7, 'trk')}${tx(306, y + 21, '×', 'm s', 'middle')}`}${tx(344, y + 21, right, rightCls)}`,
    )

  return {
    h: 170,
    body: `${rc(0, 0, SVG_WIDTH, 170, 12, 'page')}${tip(c, 'Search box: filters the pane list as you type')}${field(16, 'radius', true, '1 of 30', 'acc b s')}${field(68, '', false, '30 of 30', 'm s')}${field(120, 'zzz', false, '0 of 30  ·  no matches, clear', 'warn s')}`,
  }
}

const filterchips = (c: Ctx): Out => {
  const count = (pred: (s: Sample) => boolean) => SAMPLES.filter(pred).length
  const chips = [
    ['live', count(s => s.status === 'live'), true],
    ['preview', count(s => s.status === 'preview'), false],
    ['look', count(s => s.family === 'look'), true],
    ['ui', count(s => s.family === 'ui'), false],
  ] as const
  let b = rc(0, 0, SVG_WIDTH, 120, 12, 'page')
  let x = 16
  const pos: number[] = []

  chips.forEach(([label, n, on]) => {
    const w = 66 + label.length * 6.8

    pos.push(x, x + w)
    b += grp(`${tip(c, `${label}: ${n} samples, ${on ? 'on' : 'off'}`)}${rc(x, 20, w, 28, 14, on ? 'accsoft' : 'card')}${on ? rc(x, 20, w, 28, 14, 'accs', 'stroke-width="1"') : ''}${on ? ci(x + 15, 34, 4.5, 'acc') : ci(x + 15, 34, 4, 'ln2', 'stroke-width="1.4"')}${tx(x + 28, 38, label, on ? 's b' : 's')}${tx(x + w - 12, 38, String(n), 'm xs', 'end')}`)
    x += w + 10
  })
  b += tx(x + 6, 38, 'clear', 'acc s b')
  b += `<path d="M${pos[0]} 62V68H${pos[3]}V62" class="ln2"/>${tx((pos[0]! + pos[3]!) / 2, 84, 'status: OR', 'm xs', 'middle')}<path d="M${pos[4]} 62V68H${pos[7]}V62" class="ln2"/>${tx((pos[4]! + pos[7]!) / 2, 84, 'family: OR', 'm xs', 'middle')}${tx(16, 108, 'different groups combine with AND', 'm xs')}`

  return { h: 120, body: b }
}

const sortmenu = (c: Ctx): Out => {
  const item = (y: number, label: string, mark: string, on: boolean) => `${on ? rc(268, y, 174, 26, 5, 'accsoft') : ''}${tx(280, y + 17, label, on ? 's b' : 's')}${tx(430, y + 17, mark, 'acc b s', 'end')}`

  return {
    h: 158,
    body: `${rc(0, 0, SVG_WIDTH, 158, 12, 'page')}${tx(16, 28, 'SEGMENTED', 'c')}${grp(`${tip(c, 'Active option filled with a check')}${rc(16, 38, 212, 34, 8, 'card')}${rc(20, 42, 102, 26, 6, 'acc')}${tx(71, 59, 'name ✓', 'on b s', 'middle')}${tx(175, 59, 'kind', 'm b s', 'middle')}`)}${tx(16, 96, 'press the active one again:', 'm xs')}${tx(16, 112, 'back to the default order', 'm xs')}${grp(`${tip(c, 'Menu form of the same control')}${rc(260, 14, 190, 130, 8, 'e2', 'filter="url(#s2)"')}${item(22, 'Name', '✓', true)}${item(50, 'Kind', '', false)}${ln(272, 82, 438, 82, 'ln')}${item(90, 'Catalogue order', '', false)}${tx(280, 134, 'default', 'm xs')}`)}`,
  }
}

const paging = (c: Ctx): Out => {
  let b = rc(0, 0, SVG_WIDTH, 204, 12, 'page') + tx(16, 22, 'PAGES  (WORKS HERE)', 'c') + tx(268, 22, 'ENDLESS  (PREVIEW)', 'c')
  b += rc(16, 30, 236, 166, 8, 'card') + rc(268, 30, 236, 166, 8, 'card')

  for (let i = 0; i < 4; i++) {
    b += rc(28, 42 + i * 25, 212, 18, 4, 'trk') + tx(36, 55 + i * 25, `Row ${i + 1}`, 'm xs')
  }
  const pill = (x: number, label: string, on: boolean) => `${rc(x, 156, 26, 26, 6, on ? 'acc' : 'card')}${tx(x + 13, 173, label, on ? 'on b s' : 's', 'middle')}`
  b += grp(`${tip(c, 'Pager: previous, page pills, next')}${pill(28, '‹', false)}${pill(58, '1', true)}${pill(88, '2', false)}${pill(118, '3', false)}${pill(214, '›', false)}`)

  for (let i = 0; i < 3; i++) {
    b += rc(280, 42 + i * 25, 212, 18, 4, 'trk', `fill-opacity="${[1, 0.7, 0.45][i]}"`)
  }
  b += grp(`${tip(c, 'Skeleton rows while the next batch loads')}${[0, 1].map(i => rc(280, 117 + i * 25, 212, 18, 4, 'sk')).join('')}`)
  b += [0, 1, 2].map(i => ci(362 + i * 10, 176, 2.5, 'acc glow', `style="animation-delay:${i * 0.2}s"`)).join('') + tx(396, 180, 'loading more', 'm xs') + rc(496, 40, 4, 60, 2, 'thumb', 'fill-opacity=".4"')

  return { h: 204, body: b }
}

const stickyhead = (c: Ctx): Out => {
  const row = (y: number, label: string, op = 1) => `${rc(28, y, 464, 22, 4, 'trk', `fill-opacity="${op * 0.6}"`)}${tx(40, y + 15, label, 's', '').replace('class="s"', `class="s" opacity="${op}"`)}`

  return {
    h: 196,
    defs: `<clipPath id="clipPane"><rect x="16" y="12" width="488" height="164" rx="10"/></clipPath>`,
    body: `${rc(0, 0, SVG_WIDTH, 196, 12, 'page')}${rc(16, 12, 488, 164, 10, 'card')}<g clip-path="url(#clipPane)">${row(52, 'Zebra rows')}${row(78, 'Highlight band')}${row(104, 'Divider')}${rc(16, 130, 488, 26, 0, 'e0')}${tx(32, 148, '▼ Controls', 'b s')}${row(160, 'Selection colour')}${grp(`${tip(c, 'Pinned copy of the group header')}${rc(16, 12, 488, 32, 0, 'e1', 'filter="url(#s1)"')}${tx(32, 33, '▼ Surfaces ↑', 'acc b s')}${tx(488, 33, 'pinned', 'm xs', 'end')}`)}</g>${tx(260, 190, 'the header repeats at the first row once you scroll past it', 'm xs', 'middle')}`,
  }
}

const stickyfoot = (c: Ctx): Out => {
  const btn = (x: number, w: number, label: string, primary: boolean) => `${rc(x, 134, w, 28, 7, primary ? 'acc' : 'card')}${tx(x + w / 2, 152, label, primary ? 'on b s' : 'b s', 'middle')}`

  return {
    h: 196,
    defs: `<clipPath id="clipFoot"><rect x="16" y="12" width="488" height="168" rx="10"/></clipPath>`,
    body: `${rc(0, 0, SVG_WIDTH, 196, 12, 'page')}${rc(16, 12, 488, 168, 10, 'card')}<g clip-path="url(#clipFoot)">${[0, 1, 2].map(i => rc(32, 26 + i * 28, 456 - i * 60, 18, 4, 'trk')).join('')}${rc(32, 110, 120, 10, 4, 'trk', 'fill-opacity=".5"')}${grp(`${tip(c, 'Pinned action bar')}${rc(16, 122, 488, 58, 0, 'e1', 'filter="url(#s1)"')}${ln(16, 122, 504, 122, 'ln')}${btn(28, 74, '◀ prev', false)}${btn(110, 74, 'next ▶', false)}${btn(380, 112, 'copy spec', true)}`)}</g>${tx(260, 192, 'content keeps bottom padding, so nothing hides behind the bar', 'm xs', 'middle')}`,
  }
}

const fab = (c: Ctx): Out => {
  const pane = (x: number) => `${rc(x, 12, 236, 160, 10, 'card')}${[0, 1, 2, 3].map(i => rc(x + 14, 26 + i * 26, 208 - i * 34, 16, 4, 'trk')).join('')}`

  return {
    h: 198,
    body: `${rc(0, 0, SVG_WIDTH, 198, 12, 'page')}${pane(16)}${pane(268)}${grp(`${tip(c, 'Compact FAB: 48 px circle, plus, elevation 2')}${ci(216, 136, 24, 'acc', 'filter="url(#s2)"')}${ln(216, 126, 216, 146, 'on', 'style="stroke:var(--onacc)" stroke-width="3" stroke-linecap="round"')}${ln(206, 136, 226, 136, 'on', 'style="stroke:var(--onacc)" stroke-width="3" stroke-linecap="round"')}`)}${grp(`${tip(c, 'Extended FAB: plus and label')}${rc(318, 118, 170, 40, 20, 'acc', 'filter="url(#s2)"')}${tx(403, 143, '＋  Ask for this style', 'on b s', 'middle')}`)}${tx(134, 190, 'compact', 'm xs', 'middle')}${tx(386, 190, 'extended', 'm xs', 'middle')}`,
  }
}

const ctxmenu = (c: Ctx): Out => {
  const tile = (x: number, y: number, sel: boolean, label: string) => `${rc(x, y, 130, 62, 8, 'card')}${sel ? rc(x, y, 130, 62, 8, 'accs', 'stroke-width="1.6"') : ''}${rc(x + 12, y + 12, 50, 8, 4, 'trk')}${tx(x + 12, y + 44, label, 's b')}`
  const item = (y: number, label: string, key: string, on: boolean) => `${on ? rc(232, y, 192, 28, 5, 'accsoft') : ''}${tx(246, y + 18, label, on ? 's b' : 's')}${tx(412, y + 18, key, 'm xs mono', 'end')}`

  return {
    h: 204,
    body: `${rc(0, 0, SVG_WIDTH, 204, 12, 'page')}${grp(`${tip(c, 'The tile that was right-clicked')}${tile(16, 16, true, 'Radius')}`)}${tile(16, 96, false, 'Elevation')}${tile(160, 96, false, 'Spacing')}${grp(`${tip(c, 'Context menu: 200 px, radius 8, elevation 2')}${rc(220, 44, 216, 140, 8, 'e2', 'filter="url(#s2)"')}${item(52, 'Copy spec', 'C', false)}${item(82, 'Open in List', 'L', true)}${ln(232, 114, 424, 114, 'ln')}${item(122, 'Ask for this style', 'A', false)}${item(150, 'Show grid', 'G', false)}`)}<path d="M120 44 L120 62 L125 58 L130 68 L133 66 L128 56 L134 55 Z" class="card" style="stroke:var(--text);fill:var(--text)"/>${tx(486, 28, 'right-click', 'm xs', 'end')}`,
  }
}

const DRAWERS: Record<string, (c: Ctx) => Out> = {
  radius,
  elevation,
  spacing,
  zebra,
  highlight,
  divider,
  selection,
  focus,
  scrollbar,
  badge,
  chip,
  fab,
  ctxmenu,
  toast,
  tooltip,
  skeleton,
  onboarding,
  mascot,
  pixel,
  blueprint,
  terminal,
  print,
  tabbar,
  breadcrumb,
  searchbox,
  filterchips,
  sortmenu,
  paging,
  stickyhead,
  stickyfoot,
}

export const DRAWN_IDS: readonly string[] = Object.keys(DRAWERS)

export const sampleAlt = (s: Sample): string => `${s.title}: ${s.blurb}`

// One vector image for one sample. Never throws: an unknown id gives an empty string.
export const sampleSvg = (id: string, ctx: Ctx): string => {
  const draw = DRAWERS[id]

  if (draw === undefined || byId(id) === undefined) {
    return ''
  }

  return frame(ctx, draw(ctx))
}
