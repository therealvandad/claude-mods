// Vector previews for the studio pane (desktop only). Pure strings: no `$` here, so the tests can check them.
// Every colour is an explicit hex, so the previews show light and dark side by side and do not depend on the app's
// mode. Everything goes through `col`, which applies the colour-blindness simulation when one is chosen.
// Pure vector: no pictures, no embedded fonts, no comments, no ampersands, no motion.

import { CVDS, FAMILIES, MONTHS, MONTH_ACCENTS, contrastRatio, familyPalette, hsl, hslOf, mix, simulate } from './color'
import type { Cvd } from './color'
import { anchorsOf, rolesOf } from './finish'
import type { Anchors, Finish } from './finish'

export type Opts = { cvd: Cvd; stroke: number; month: number }
export const DEFAULT_OPTS: Opts = { cvd: 'none', stroke: 1.75, month: -1 }

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (x: number): string => String(Math.round(x * 100) / 100)

const SANS = "-apple-system,system-ui,'Segoe UI',sans-serif"
const SERIF = "Georgia,'Times New Roman',serif"
const HAND = "'Bradley Hand','Segoe Script','Comic Sans MS',cursive"
const MONO = "ui-monospace,Menlo,Consolas,monospace"

type Mode = 'light' | 'dark'

const lcg = (seed: number) => {
  let s = seed >>> 0

  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0

    return s / 4294967296
  }
}

const onColor = (bg: string): string => (contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111')

type Palette = { a: Anchors; accent: string; danger: string; success: string; warning: string; pro: string; border: string; strong: string }

const paletteOf = (f: Finish, mode: Mode): Palette => {
  const a = anchorsOf(f)[mode]
  const roles = rolesOf(f)
  const lift = (hex: string) => (mode === 'dark' ? mix(hex, '#ffffff', 0.18) : hex)
  const edge = f.contrast === 'high' ? 0.7 : 0.2

  return {
    a,
    accent: lift(roles.accent),
    danger: lift(roles.danger),
    success: lift(roles.success),
    warning: lift(roles.warning),
    pro: lift(roles.pro),
    border: mix(a.s2, a.t1, edge),
    strong: mix(a.s2, a.t1, f.contrast === 'high' ? 0.8 : 0.45),
  }
}

type Ctx = { col: (hex: string) => string; area: { accent: number } }

const mkCtx = (o: Opts): Ctx => ({ col: hex => simulate(hex, o.cvd), area: { accent: 0 } })

const svgOpen = (w: number, h: number): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`

const label = (x: number, y: number, text: string, fill: string, size = 11, anchor = 'start', weight = 400): string =>
  `<text x="${n(x)}" y="${n(y)}" font-family="${SANS}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`

const NEUTRAL_LABEL = '#7d7d7d'

// ---- the sample: one finish drawn on a small window, light and dark side by side ----

const panelRadius = (f: Finish): number => (f.shape === 'pill' ? 20 : f.shape === 'square' ? 0 : 8)
const buttonRadius = (f: Finish, h: number): number => (f.shape === 'pill' ? h / 2 : f.shape === 'square' ? 0 : 6)
const borderWidth = (f: Finish): number => (f.contrast === 'high' ? 2 : f.border === 'bold' ? 2.5 : f.border === 'hairline' ? 0.75 : 1)

const panel = (f: Finish, mode: Mode, x: number, y: number, ctx: Ctx, o: Opts): string => {
  const p = paletteOf(f, mode)
  const { col } = ctx
  const { a } = p
  const r = panelRadius(f)
  const pw = 300
  const ph = 236
  const id = `${mode}`
  const bwid = borderWidth(f)
  const headFont = f.headings === 'serif' ? SERIF : SANS
  const headWeight = f.weights === 'hierarchy' ? 700 : 600
  const accentTint = mix(a.s0, p.accent, mode === 'dark' ? 0.28 : 0.32)
  const defs: string[] = []
  const out: string[] = []

  out.push(`<rect x="0" y="0" width="${pw}" height="${ph}" rx="12" fill="${col(a.s0)}"/>`)
  defs.push(`<clipPath id="cl-${id}"><rect x="0" y="0" width="${pw}" height="${ph}" rx="12"/></clipPath>`)
  out.push(`<g clip-path="url(#cl-${id})">`)

  if (f.ground === 'band') {
    defs.push(`<linearGradient id="gb-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col(accentTint)}"/><stop offset="1" stop-color="${col(a.s0)}"/></linearGradient>`)
    out.push(`<rect x="0" y="0" width="${pw}" height="${n(ph * 0.22 + 14)}" rx="12" fill="url(#gb-${id})"/>`)
    ctx.area.accent += pw * (ph * 0.22) * 0.4
  } else if (f.ground === 'paper') {
    const rnd = lcg(5)

    for (let i = 0; i < 46; i++) {
      out.push(`<circle cx="${n(rnd() * pw)}" cy="${n(rnd() * ph)}" r="${n(0.6 + rnd())}" fill="${col(rnd() < 0.5 ? a.t3 : a.s2)}" opacity="${n(0.12 + rnd() * 0.18)}"/>`)
    }
  } else if (f.ground === 'noise' && mode === 'dark') {
    const rnd = lcg(9)

    for (let i = 0; i < 110; i++) {
      out.push(`<rect x="${n(rnd() * pw)}" y="${n(rnd() * ph)}" width="1.2" height="1.2" fill="${col(rnd() < 0.5 ? a.t1 : a.t3)}" opacity="${n(0.1 + rnd() * 0.25)}"/>`)
    }
  } else if (f.ground === 'glass') {
    const { h } = hslOf(f.accent)
    const blob = (cx: number, cy: number, rad: number, off: number) =>
      `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${col(mode === 'dark' ? hsl(h + off, 62, 34) : hsl(h + off, 70, 78))}" opacity="0.8"/>`

    out.push(blob(70, 60, 70, 0), blob(240, 40, 50, 40), blob(150, 190, 60, -40))
  }
  out.push('</g>')

  // Header: a small icon (stroke = the chosen width) and the title in the finish's heading style.
  out.push(
    `<g fill="none" stroke="${col(a.t2)}" stroke-width="${n(o.stroke)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(16 14) scale(0.75)"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/></g>`,
  )
  out.push(
    `<text x="40" y="31" font-family="${headFont}" font-size="15" font-weight="${headWeight}" fill="${col(a.t1)}">Build finished</text>`,
  )

  // The card.
  const cx = 14
  const cy = 46
  const cw = 272
  const ch = 108
  const cardFill = f.card === 'glossy' ? `url(#gl-${id})` : col(a.s1)
  const opacity = f.ground === 'glass' ? 0.66 : 1

  if (f.card === 'glossy') {
    defs.push(`<linearGradient id="gl-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col(a.s2)}"/><stop offset="1" stop-color="${col(a.s1)}"/></linearGradient>`)
    out.push(`<rect x="${cx + 1}" y="${cy + 5}" width="${cw - 2}" height="${ch}" rx="${r}" fill="#000000" opacity="0.1"/>`)
    out.push(`<rect x="${cx}" y="${cy + 2}" width="${cw}" height="${ch}" rx="${r}" fill="#000000" opacity="0.08"/>`)
  }
  out.push(
    `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="${r}" fill="${cardFill}" fill-opacity="${opacity}" stroke="${col(f.border === 'bold' || f.contrast === 'high' ? p.strong : p.border)}" stroke-width="${n(bwid)}"/>`,
  )

  if (f.card === 'glossy') {
    out.push(`<path d="M${cx + r} ${cy + 1}H${cx + cw - r}" stroke="#ffffff" stroke-opacity="0.45" stroke-width="1" fill="none"/>`)
  }
  const pad = r > 10 ? 22 : 14

  out.push(
    `<text x="${cx + pad}" y="${cy + 26}" font-family="${headFont}" font-size="13" font-weight="${headWeight}" fill="${col(a.t1)}">3 files changed</text>`,
    `<text x="${cx + pad}" y="${cy + 44}" font-family="${SANS}" font-size="11.5" font-weight="${f.weights === 'hierarchy' ? 400 : 500}" fill="${col(a.t2)}">0 errors, 12 tests passed in 4.2 s.</text>`,
  )
  // A tool row and the person's own message.
  const toolR = f.shape === 'pill' ? 11 : f.shape === 'square' ? 0 : 4

  out.push(
    `<rect x="${cx + pad}" y="${cy + 56}" width="108" height="${f.shape === 'pill' ? 22 : 20}" rx="${toolR}" fill="${col(a.s2)}" stroke="${col(p.border)}" stroke-width="${n(Math.min(bwid, 1.5))}"/>`,
    `<text x="${cx + pad + 9}" y="${cy + 70}" font-family="${MONO}" font-size="10.5" fill="${col(a.t2)}">Bash  npm test</text>`,
  )
  const ur = f.shape === 'pill' ? 14 : f.shape === 'square' ? 0 : 6

  out.push(
    `<rect x="${cx + cw - pad - 112}" y="${cy + 54}" width="112" height="${f.hand ? 30 : 26}" rx="${ur}" fill="${col(a.s2)}" stroke="${col(p.border)}" stroke-width="${n(Math.min(bwid, 1.5))}"/>`,
    `<text x="${cx + cw - pad - 104}" y="${cy + (f.hand ? 73 : 71)}" font-family="${f.hand ? HAND : SANS}" font-size="${f.hand ? 14 : 11.5}" fill="${col(a.t1)}">${f.hand ? 'ship it, thanks' : 'ship it, thanks'}</text>`,
  )

  // Buttons.
  const by = 170
  const bh = 26
  const br = buttonRadius(f, bh)
  const accent = p.accent

  out.push(
    `<rect x="14" y="${by}" width="96" height="${bh}" rx="${br}" fill="${col(accent)}"/>`,
    label(62, by + 17.5, 'Apply', col(onColor(accent)), 12, 'middle', 600),
    `<rect x="120" y="${by}" width="84" height="${bh}" rx="${br}" fill="none" stroke="${col(p.strong)}" stroke-width="${n(Math.max(1, bwid))}"/>`,
    label(162, by + 17.5, 'Cancel', col(a.t2), 12, 'middle', 500),
  )
  ctx.area.accent += 96 * bh

  // Progress.
  out.push(
    `<rect x="14" y="212" width="272" height="8" rx="4" fill="${col(mix(a.s0, a.t1, 0.14))}"/>`,
    `<rect x="14" y="212" width="163" height="8" rx="4" fill="${col(accent)}"/>`,
  )
  ctx.area.accent += 163 * 8

  return `<g transform="translate(${x} ${y})"><defs>${defs.join('')}</defs>${out.join('')}</g>`
}

export type Sample = { svg: string; share: number; alt: string }

/** The finish on a sample window, light and dark. `share` is the accent's part of the sample area, 0 to 100. */
export const sampleSvg = (f: Finish, o: Opts = DEFAULT_OPTS): Sample => {
  const ctx = mkCtx(o)
  const left = panel(f, 'light', 0, 24, ctx, o)
  const total = 300 * 236 * 2
  const rightCtx = mkCtx(o)
  const right = panel(f, 'dark', 320, 24, rightCtx, o)
  const share = Math.round(((ctx.area.accent + rightCtx.area.accent) / total) * 1000) / 10
  const simNote = o.cvd === 'none' ? '' : `, simulating ${o.cvd}`

  return {
    svg: `${svgOpen(620, 268)}${label(0, 14, 'Light', NEUTRAL_LABEL, 11, 'start', 600)}${label(320, 14, 'Dark', NEUTRAL_LABEL, 11, 'start', 600)}${left}${right}</svg>`,
    share,
    alt: `A sample window in the draft finish, light and dark side by side${simNote}: a heading, a card with a tool row, buttons and a progress bar.`,
  }
}

// ---- colour tab: the greys, the roles, the accent share and the month ----

export const colourSvg = (f: Finish, o: Opts, share: number): { svg: string; alt: string } => {
  const { col } = mkCtx(o)
  const parts: string[] = []
  const names = ['page', 'card', 'panel', 'muted', 'text 2', 'text']

  ;(['light', 'dark'] as const).forEach((mode, row) => {
    const p = paletteOf(f, mode)
    const a = p.a
    const ys = row * 118
    const list = [a.s0, a.s1, a.s2, a.t3, a.t2, a.t1]

    parts.push(label(0, ys + 12, mode === 'light' ? 'Light' : 'Dark', NEUTRAL_LABEL, 11, 'start', 600))
    list.forEach((hex, i) => {
      parts.push(
        `<g><title>${esc(`${names[i]} ${hex}`)}</title><rect x="${i * 52}" y="${ys + 20}" width="46" height="34" rx="6" fill="${col(hex)}" stroke="${col(mix(a.s0, a.t1, 0.25))}" stroke-width="0.75"/></g>`,
        label(i * 52 + 23, ys + 68, names[i]!, NEUTRAL_LABEL, 9.5, 'middle'),
      )
    })
    const roles: [string, string][] = [
      ['accent', p.accent],
      ['danger', p.danger],
      ['success', p.success],
      ['warning', p.warning],
      ['pro', p.pro],
    ]

    roles.forEach(([name, hex], i) => {
      parts.push(
        `<g><title>${esc(`${name} ${hex}`)}</title><circle cx="${346 + i * 54}" cy="${ys + 36}" r="15" fill="${col(hex)}"/></g>`,
        label(346 + i * 54, ys + 68, name, NEUTRAL_LABEL, 9.5, 'middle'),
      )
    })
    const text = a.t1
    const page = a.s0

    parts.push(
      label(0, ys + 90, `text on page ${n(contrastRatio(text, page))}:1, muted on page ${n(contrastRatio(a.t3, page))}:1`, NEUTRAL_LABEL, 10),
      label(346, ys + 90, `accent on page ${n(contrastRatio(p.accent, page))}:1`, NEUTRAL_LABEL, 10),
    )
  })
  // Accent share bar.
  const barW = 560

  parts.push(
    label(0, 252, 'Accent share of the sample', NEUTRAL_LABEL, 11, 'start', 600),
    `<rect x="0" y="260" width="${barW}" height="12" rx="6" fill="${col(mix(anchorsOf(f).light.s0, anchorsOf(f).light.t1, 0.14))}"/>`,
    `<rect x="0" y="260" width="${n((barW * Math.min(share, 100)) / 100)}" height="12" rx="6" fill="${col(paletteOf(f, 'light').accent)}"/>`,
    `<line x1="${barW * 0.1}" y1="256" x2="${barW * 0.1}" y2="276" stroke="${col('#7d7d7d')}" stroke-width="1"/>`,
    label(barW * 0.1 + 4, 288, '10%', NEUTRAL_LABEL, 9.5),
    label(barW, 288, `${share}% of the two sample windows`, NEUTRAL_LABEL, 10, 'end'),
  )
  // The twelve month accents.
  parts.push(label(0, 316, 'Accent of the month (used only when you type a command)', NEUTRAL_LABEL, 11, 'start', 600))
  MONTHS.forEach((name, i) => {
    const hex = MONTH_ACCENTS[i]!
    const isNow = i === o.month

    parts.push(
      `<g><title>${esc(`${name} ${hex}`)}</title><circle cx="${14 + i * 46}" cy="342" r="${isNow ? 15 : 12}" fill="${col(hex)}" stroke="${isNow ? col('#7d7d7d') : 'none'}" stroke-width="2"/></g>`,
      label(14 + i * 46, 372, name.slice(0, 3), NEUTRAL_LABEL, 9.5, 'middle', isNow ? 700 : 400),
    )
  })

  return {
    svg: `${svgOpen(620, 384)}${parts.join('')}</svg>`,
    alt: 'The greys of the draft finish in light and dark with their contrast, the five role colours, how much of the sample the accent covers, and the twelve monthly accents.',
  }
}

// ---- surface tab: grounds, cards, borders and buttons ----

export const surfaceSvg = (f: Finish, o: Opts): { svg: string; alt: string } => {
  const { col } = mkCtx(o)
  const parts: string[] = []
  const grounds = ['none', 'band', 'paper', 'noise', 'glass'] as const

  grounds.forEach((g, i) => {
    ;(['light', 'dark'] as const).forEach((mode, row) => {
      const one: Finish = { ...f, ground: g }
      const p = paletteOf(one, mode)
      const x = i * 122
      const y = row * 78 + 18
      const rnd = lcg(3 + i)
      const bits: string[] = [
        `<defs><clipPath id="ct-${i}-${mode}"><rect x="0" y="0" width="112" height="68" rx="8"/></clipPath></defs>`,
        `<rect x="0" y="0" width="112" height="68" rx="8" fill="${col(p.a.s0)}"/>`,
        `<g clip-path="url(#ct-${i}-${mode})">`,
      ]

      if (g === 'band') {
        bits.push(
          `<defs><linearGradient id="sb-${i}-${mode}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col(mix(p.a.s0, p.accent, mode === 'dark' ? 0.28 : 0.32))}"/><stop offset="1" stop-color="${col(p.a.s0)}"/></linearGradient></defs>`,
          `<rect x="0" y="0" width="112" height="30" rx="8" fill="url(#sb-${i}-${mode})"/>`,
        )
      } else if (g === 'paper') {
        for (let k = 0; k < 24; k++) {
          bits.push(`<circle cx="${n(rnd() * 112)}" cy="${n(rnd() * 68)}" r="${n(0.5 + rnd() * 0.8)}" fill="${col(p.a.t3)}" opacity="0.28"/>`)
        }
      } else if (g === 'noise' && mode === 'dark') {
        for (let k = 0; k < 70; k++) {
          bits.push(`<rect x="${n(rnd() * 112)}" y="${n(rnd() * 68)}" width="1.2" height="1.2" fill="${col(p.a.t1)}" opacity="0.3"/>`)
        }
      } else if (g === 'glass') {
        const { h } = hslOf(f.accent)

        bits.push(
          `<circle cx="28" cy="22" r="26" fill="${col(hsl(h, mode === 'dark' ? 62 : 70, mode === 'dark' ? 34 : 78))}" opacity="0.8"/>`,
          `<circle cx="86" cy="46" r="24" fill="${col(hsl(h + 40, mode === 'dark' ? 62 : 70, mode === 'dark' ? 34 : 78))}" opacity="0.8"/>`,
        )
      }
      bits.push(
        '</g>',
        `<rect x="14" y="20" width="84" height="32" rx="6" fill="${col(p.a.s1)}" fill-opacity="${g === 'glass' ? 0.62 : 1}" stroke="${col(p.border)}" stroke-width="0.75"/>`,
        `<rect x="22" y="29" width="46" height="4" rx="2" fill="${col(p.a.t2)}"/>`,
        `<rect x="22" y="38" width="30" height="4" rx="2" fill="${col(p.a.t3)}"/>`,
      )
      parts.push(`<g transform="translate(${x} ${y})">${bits.join('')}</g>`)
    })
    parts.push(label(i * 122 + 56, 12, g === 'none' ? "app's own" : g, NEUTRAL_LABEL, 10.5, 'middle', f.ground === g ? 700 : 400))
  })
  parts.push(label(0, 186, 'Noise shows on dark pages only. Glass frosts the docked panes over the soft colour.', NEUTRAL_LABEL, 10))

  // Cards and buttons.
  const p = paletteOf(f, 'light')
  const d = paletteOf(f, 'dark')
  const cards: { name: string; card: Finish['card']; border: Finish['border'] }[] = [
    { name: 'default', card: 'default', border: 'default' },
    { name: 'matte, hairline', card: 'matte', border: 'hairline' },
    { name: 'glossy, hairline', card: 'glossy', border: 'hairline' },
    { name: 'matte, bold', card: 'matte', border: 'bold' },
  ]

  cards.forEach((c, i) => {
    const pal = i % 2 === 0 ? p : d
    const x = i * 150
    const one: Finish = { ...f, card: c.card, border: c.border }
    const bw = borderWidth(one)
    const r = panelRadius(f)
    const id = `cd${i}`

    parts.push(
      `<g transform="translate(${x} 204)"><rect x="0" y="0" width="140" height="78" rx="8" fill="${col(pal.a.s0)}"/>`,
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col(pal.a.s2)}"/><stop offset="1" stop-color="${col(pal.a.s1)}"/></linearGradient></defs>`,
      c.card === 'glossy' ? `<rect x="11" y="15" width="118" height="52" rx="${r}" fill="#000000" opacity="0.12"/>` : '',
      `<rect x="10" y="12" width="120" height="54" rx="${r}" fill="${c.card === 'glossy' ? `url(#${id})` : col(pal.a.s1)}" stroke="${col(c.border === 'bold' ? pal.strong : pal.border)}" stroke-width="${n(bw)}"/>`,
      c.card === 'glossy' ? `<path d="M${10 + r} 13H${130 - r}" stroke="#ffffff" stroke-opacity="0.45" fill="none"/>` : '',
      `<rect x="${r > 10 ? 24 : 20}" y="26" width="70" height="5" rx="2.5" fill="${col(pal.a.t1)}"/>`,
      `<rect x="${r > 10 ? 24 : 20}" y="38" width="48" height="5" rx="2.5" fill="${col(pal.a.t3)}"/></g>`,
      label(x + 70, 298, c.name, NEUTRAL_LABEL, 10, 'middle'),
    )
  })
  // Button shapes.
  const shapes: { name: string; r: number }[] = [
    { name: 'pill', r: 13 },
    { name: 'default', r: 6 },
    { name: 'square', r: 0 },
  ]

  shapes.forEach((s, i) => {
    parts.push(
      `<rect x="${i * 120}" y="316" width="104" height="26" rx="${s.r}" fill="${col(p.accent)}"/>`,
      label(i * 120 + 52, 333.5, s.name, col(onColor(p.accent)), 12, 'middle', 600),
    )
  })
  parts.push(label(372, 333, 'Buttons themselves keep the app look: corners reach message and tool rows.', NEUTRAL_LABEL, 10))

  return {
    svg: `${svgOpen(620, 354)}${parts.join('')}</svg>`,
    alt: 'The five backdrops in light and dark, four card and border finishes, and three button shapes.',
  }
}

// ---- type tab ----

export const typeSvg = (f: Finish, o: Opts): { svg: string; alt: string } => {
  const { col } = mkCtx(o)
  const a = anchorsOf(f).light
  const d = anchorsOf(f).dark
  const rows: { name: string; family: string; weight: number; text: string }[] = [
    { name: 'sans, hierarchy', family: SANS, weight: 700, text: 'Heading in bold sans' },
    { name: 'serif headings', family: SERIF, weight: 700, text: 'Heading in a serif face' },
    { name: 'handwriting (your messages)', family: HAND, weight: 400, text: 'Remember the milk, then ship it' },
    { name: 'mono (code)', family: MONO, weight: 400, text: 'const total = 1000' },
  ]
  const parts: string[] = [`<rect x="0" y="0" width="300" height="212" rx="10" fill="${col(a.s1)}"/>`, `<rect x="320" y="0" width="300" height="212" rx="10" fill="${col(d.s1)}"/>`]

  rows.forEach((row, i) => {
    const y = 34 + i * 46

    parts.push(
      `<text x="16" y="${y}" font-family="${row.family}" font-size="${row.family === HAND ? 18 : 17}" font-weight="${row.weight}" fill="${col(a.t1)}">${esc(row.text)}</text>`,
      `<text x="336" y="${y}" font-family="${row.family}" font-size="${row.family === HAND ? 18 : 17}" font-weight="${row.weight}" fill="${col(d.t1)}">${esc(row.text)}</text>`,
      label(16, y + 15, row.name, col(a.t3), 10),
      label(336, y + 15, row.name, col(d.t3), 10),
    )
  })
  const weights = [400, 500, 600, 700]

  weights.forEach((w, i) => {
    parts.push(`<text x="${16 + i * 70}" y="236" font-family="${SANS}" font-size="15" font-weight="${w}" fill="${NEUTRAL_LABEL}">Aa ${w}</text>`)
  })
  parts.push(label(16, 256, 'Weight ladder: the hierarchy option sets headings bold and body regular.', NEUTRAL_LABEL, 10))

  return {
    svg: `${svgOpen(620, 270)}${parts.join('')}</svg>`,
    alt: 'Type samples in light and dark: a bold sans heading, a serif heading, a handwriting line, a monospace line, and a weight ladder.',
  }
}

// ---- data tab: chart palettes, soft inner shadows, gradient bars and the colour-blind simulation ----

export const SERIES = (f: Finish): string[] => {
  const r = rolesOf(f)

  return [r.accent, r.danger, r.success, r.warning, r.pro, '#2f9a96', '#d0688c', '#5d6f86']
}

export const dataSvg = (f: Finish, o: Opts): { svg: string; alt: string } => {
  const { col } = mkCtx(o)
  const a = anchorsOf(f).light
  const parts: string[] = []
  const hue = hslOf(f.accent).h
  const shades = familyPalette(hue, 6, 'light')
  const heights = [34, 52, 44, 66, 58, 76]

  // Two small charts: flat bars and bars with a soft inner shadow (idea 7, preview only).
  ;[false, true].forEach((inner, k) => {
    const x0 = k * 160

    parts.push(
      `<g transform="translate(${x0} 20)"><rect x="0" y="0" width="150" height="104" rx="8" fill="${col(a.s1)}" stroke="${col(mix(a.s1, a.t1, 0.18))}" stroke-width="0.75"/>`,
      `<defs><linearGradient id="is${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0.3"/><stop offset="0.45" stop-color="#000000" stop-opacity="0"/></linearGradient></defs>`,
    )
    heights.forEach((h, i) => {
      const bx = 12 + i * 22
      const by = 92 - h

      parts.push(`<rect x="${bx}" y="${by}" width="16" height="${h}" rx="3" fill="${col(shades[i]!)}"/>`)

      if (inner) {
        parts.push(
          `<rect x="${bx}" y="${by}" width="16" height="${h}" rx="3" fill="url(#is${k})"/>`,
          `<rect x="${bx + 1}" y="${by + h - 3}" width="14" height="2" rx="1" fill="#ffffff" opacity="0.28"/>`,
        )
      }
    })
    parts.push('</g>', label(x0 + 75, 138, inner ? 'soft inner shadow' : 'flat', NEUTRAL_LABEL, 10, 'middle'))
  })

  // Gradient progress bars (idea 15, preview only).
  parts.push(`<defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${col(mix(f.accent, '#ffffff', 0.5))}"/><stop offset="1" stop-color="${col(f.accent)}"/></linearGradient></defs>`)
  ;[0.3, 0.62, 0.9].forEach((v, i) => {
    const y = 40 + i * 30

    parts.push(
      `<rect x="340" y="${y}" width="270" height="10" rx="5" fill="${col(mix(a.s0, a.t1, 0.14))}"/>`,
      `<rect x="340" y="${y}" width="${n(270 * v)}" height="10" rx="5" fill="url(#pg)"/>`,
    )
  })
  parts.push(label(340, 20, 'Gradient progress bars', NEUTRAL_LABEL, 11, 'start', 600), label(340, 138, 'Preview only: the app draws its own bars', NEUTRAL_LABEL, 10))

  // Hue-family palettes (idea 19).
  parts.push(label(0, 168, 'Hue-family chart palettes (light page above, dark page below)', NEUTRAL_LABEL, 11, 'start', 600))
  Object.entries(FAMILIES).forEach(([name, h], i) => {
    const x = i * 102
    const light = familyPalette(h, 5, 'light')
    const dark = familyPalette(h, 5, 'dark')

    light.forEach((hex, k) => {
      parts.push(`<g><title>${esc(`${name} ${hex}`)}</title><rect x="${x + k * 19}" y="178" width="17" height="22" rx="3" fill="${col(hex)}"/></g>`)
    })
    dark.forEach((hex, k) => {
      parts.push(`<rect x="${x + k * 19}" y="202" width="17" height="22" rx="3" fill="${col(hex)}" stroke="${col('#444444')}" stroke-width="0.5"/>`)
    })
    parts.push(label(x + 47, 238, name, NEUTRAL_LABEL, 10, 'middle'))
  })

  // Colour-blind simulation: the eight series as seen normally and with each condition.
  parts.push(label(0, 266, 'Colour-blind simulation of the eight chart colours (a simulation by standard matrices, not a medical test)', NEUTRAL_LABEL, 11, 'start', 600))
  const series = SERIES(f)

  CVDS.forEach((kind, row) => {
    const y = 278 + row * 30

    parts.push(label(0, y + 16, kind === 'none' ? 'normal' : kind, NEUTRAL_LABEL, 10.5, 'start', 500))
    series.forEach((hex, i) => {
      const seen = simulate(hex, kind)

      parts.push(`<g><title>${esc(`${kind} ${hex} seen as ${seen}`)}</title><rect x="${110 + i * 56}" y="${y}" width="48" height="22" rx="5" fill="${seen}"/></g>`)
    })
  })

  return {
    svg: `${svgOpen(620, 404)}${parts.join('')}</svg>`,
    alt: 'Two small bar charts, flat and with a soft inner shadow, gradient progress bars, six hue-family palettes in light and dark, and the eight chart colours seen with three kinds of colour blindness.',
  }
}

// ---- icons tab: one stroke, one colour, duotone empty states, titles, dimming and glow ----

const ICONS: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14M16 16l5 5',
  folder: 'M3 7h6l2 2h10v10H3z',
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  check: 'M4 12l5 5L20 6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  gear: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
}

export const ICON_NAMES = Object.keys(ICONS)

const icon = (name: string, x: number, y: number, size: number, stroke: string, width: number): string =>
  `<g transform="translate(${x} ${y}) scale(${n(size / 24)})" fill="none" stroke="${stroke}" stroke-width="${n((width * 24) / size)}" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></g>`

export const iconsSvg = (f: Finish, o: Opts): { svg: string; alt: string } => {
  const { col } = mkCtx(o)
  const a = anchorsOf(f).light
  const d = anchorsOf(f).dark
  const acc = paletteOf(f, 'light').accent
  const parts: string[] = []
  const names = ICON_NAMES

  // One colour, one stroke width, against a mixed row.
  parts.push(label(0, 14, `One colour, one stroke width (${o.stroke})`, NEUTRAL_LABEL, 11, 'start', 600))
  names.forEach((nm, i) => parts.push(icon(nm, i * 52, 24, 32, col(a.t1), o.stroke)))
  parts.push(label(0, 82, 'Mixed colours and widths, as icons often arrive', NEUTRAL_LABEL, 11, 'start', 600))
  const mixed = [acc, '#c0392b', '#2e8b4f', '#b87a10', '#7a4fc4', '#2f9a96', '#d0688c', '#5d6f86']
  const widths = [1, 2.5, 1.5, 3, 1, 2, 1.25, 2.75]

  names.forEach((nm, i) => parts.push(icon(nm, i * 52, 92, 32, col(mixed[i]!), widths[i]!)))

  // Duotone empty states (idea 12).
  parts.push(label(0, 148, 'Duotone empty states', NEUTRAL_LABEL, 11, 'start', 600))
  const tint = mix(a.s0, acc, 0.35)

  parts.push(
    `<g transform="translate(0 158)"><rect x="0" y="0" width="140" height="96" rx="10" fill="${col(a.s1)}"/>`,
    `<path d="M26 56l16-24h56l16 24v22H26z" fill="${col(tint)}"/><path d="M26 56h32l6 10h12l6-10h32" fill="none" stroke="${col(acc)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></g>`,
    `<g transform="translate(150 158)"><rect x="0" y="0" width="140" height="96" rx="10" fill="${col(a.s1)}"/>`,
    `<rect x="26" y="50" width="16" height="30" rx="3" fill="${col(tint)}"/><rect x="50" y="36" width="16" height="44" rx="3" fill="${col(tint)}"/><rect x="74" y="58" width="16" height="22" rx="3" fill="${col(acc)}"/><path d="M22 84H118" stroke="${col(acc)}" stroke-width="3" stroke-linecap="round"/></g>`,
    label(70, 270, 'Nothing here yet', NEUTRAL_LABEL, 10, 'middle'),
    label(220, 270, 'No data yet', NEUTRAL_LABEL, 10, 'middle'),
  )

  // Pane titles with a small icon (idea 14), a dimmed inactive pane (17) and a glow on the active element only (16).
  parts.push(label(310, 148, 'Pane titles with an icon, dimmed inactive pane', NEUTRAL_LABEL, 11, 'start', 600))
  const pane = (x: number, title: string, nm: string, active: boolean) =>
    `<g transform="translate(${x} 158)" opacity="${active ? 1 : 0.5}"><rect x="0" y="0" width="144" height="96" rx="8" fill="${col(d.s1)}" stroke="${col(active ? acc : mix(d.s1, d.t1, 0.2))}" stroke-width="${active ? 1.5 : 0.75}"/>${icon(nm, 10, 8, 16, col(d.t2), o.stroke)}<text x="32" y="21" font-family="${SANS}" font-size="12" font-weight="600" fill="${col(d.t1)}">${esc(title)}</text><rect x="12" y="40" width="100" height="5" rx="2.5" fill="${col(d.t3)}"/><rect x="12" y="54" width="70" height="5" rx="2.5" fill="${col(d.t3)}"/></g>`

  parts.push(pane(310, 'Skins', 'folder', true), pane(466, 'Notes', 'bell', false))
  parts.push(label(310, 270, 'active pane, and one dimmed 50 percent', NEUTRAL_LABEL, 10))
  // Glow on the active element only.
  parts.push(label(0, 296, 'Glow on the active element only', NEUTRAL_LABEL, 11, 'start', 600))
  ;[0, 1, 2].forEach(i => {
    const x = i * 110 + 6
    const active = i === 1

    if (active) {
      parts.push(
        `<rect x="${x - 6}" y="${306 - 1}" width="104" height="34" rx="13" fill="${col(acc)}" opacity="0.12"/>`,
        `<rect x="${x - 3}" y="${306 + 2}" width="98" height="28" rx="11" fill="${col(acc)}" opacity="0.2"/>`,
      )
    }
    parts.push(
      `<rect x="${x}" y="312" width="92" height="22" rx="11" fill="${active ? col(acc) : col(mix(a.s0, a.t1, 0.1))}"/>`,
      label(x + 46, 327, active ? 'active' : 'idle', active ? col(onColor(acc)) : col(a.t2), 11, 'middle', 600),
    )
  })

  return {
    svg: `${svgOpen(620, 352)}${parts.join('')}</svg>`,
    alt: 'Eight icons at one stroke width and colour against a mixed row, two duotone empty-state drawings, two pane titles with icons where one is dimmed, and three buttons where only the active one glows.',
  }
}

// ---- the small card used by the Finishes tab ----

export const miniSvg = (f: Finish, o: Opts): { svg: string; alt: string } => {
  const ctx = mkCtx(o)
  const lp = panel(f, 'light', 0, 0, ctx, o)
  const dp = panel(f, 'dark', 310, 0, mkCtx(o), o)

  return {
    svg: `${svgOpen(610, 236)}${lp}${dp}</svg>`,
    alt: 'A sample window in this finish, light and dark side by side.',
  }
}
