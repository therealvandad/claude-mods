// Premium looks: each is a full design (colors, an animated backdrop behind frosted panels, message
// cards, tool rows and a step bar). Backdrops use soft gradients and slow transforms only: no blur
// filters and no pictures, so they stay cheap to draw.
import type { ThemeSetArgs, ThemeStyle } from 'claude-code'

import { makeColors } from './make-colors'

export type PremiumName = 'aurora' | 'midnightpro' | 'editorial' | 'obsidian' | 'abyss' | 'ember'
export type LookOptions = { size: 'small' | 'medium' | 'large'; glass: 'clear' | 'frosted' | 'solid'; corners: 'soft' | 'sharp' }

export const DEFAULT_OPTIONS: LookOptions = { size: 'medium', glass: 'frosted', corners: 'soft' }

type Hex = `#${string}`
type Card = { text: Hex; bg: Hex; border: Hex }
type Look = {
  label: string
  mode: 'dark' | 'light'
  page: Hex
  surfaces: [Hex, Hex, Hex]
  text: [Hex, Hex, Hex]
  accent: Hex
  heading: Hex
  font: 'sans' | 'serif'
  user: Card & { stops?: [Hex, Hex]; italic?: boolean }
  reply: Card
  tool: Card
  bar: [Hex, Hex]
  art: string
  motion: string
}

const glow = (id: string, color: string, strength: number) =>
  `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${strength}"/><stop offset="0.55" stop-color="${color}" stop-opacity="${(strength * 0.38).toFixed(2)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`

const blob = (cls: string, cx: number, cy: number, rx: number, ry: number, id: string) =>
  `<g class="${cls}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id})"/></g>`

/** Slow drifts: class, seconds, and where it is halfway. */
const drift = (rows: readonly (readonly [string, number, number, number])[]) =>
  rows.map(([c, s, x, y]) => `.${c}{animation:${c} ${s}s ease-in-out infinite}@keyframes ${c}{50%{transform:translate(${x}px,${y}px)}}`).join('')

const STARS = Array.from({ length: 22 }, (_, i) => `<circle cx="${(i * 397) % 1580 + 10}" cy="${(i * 211) % 420 + 20}" r="${1 + (i % 3) * 0.6}" fill="#ffffff" fill-opacity="${0.25 + (i % 4) * 0.12}"/>`).join('')
const BUBBLES = Array.from({ length: 9 }, (_, i) => `<circle class="u${i % 3}" cx="${120 + i * 170}" cy="${760 + (i % 4) * 60}" r="${4 + (i % 3) * 3}" fill="none" stroke="#9fe8f0" stroke-opacity="0.3" stroke-width="1.5"/>`).join('')

export const LOOKS: Record<PremiumName, Look> = {
  aurora: {
    label: 'Aurora Glass', mode: 'dark', page: '#090d22', surfaces: ['#111737', '#171e45', '#1e2652'], text: ['#f2f4ff', '#c9d0f2', '#a8b1da'],
    accent: '#8b7cff', heading: '#ffffff', font: 'sans',
    user: { text: '#ffffff', bg: '#4a3fc4', border: '#ffffff30', stops: ['#5a47d6', '#0d7f76'] },
    reply: { text: '#eaedff', bg: '#141b40e8', border: '#ffffff30' },
    tool: { text: '#d9deff', bg: '#18204ae8', border: '#ffffff26' },
    bar: ['#8b7cff', '#2ee6c9'],
    art: `<defs>${glow('g1', '#5b45f0', 0.8)}${glow('g2', '#12a89c', 0.7)}${glow('g3', '#9a2f97', 0.68)}${glow('g4', '#2458d8', 0.55)}</defs>` +
      blob('a', 260, 150, 640, 230, 'g1') + blob('b', 1220, 210, 620, 200, 'g2') + blob('c', 800, 960, 760, 260, 'g3') + blob('d', 1480, 720, 420, 300, 'g4'),
    motion: drift([['a', 38, 190, 50], ['b', 46, -220, 70], ['c', 52, 150, -60], ['d', 60, -130, -120]]),
  },
  midnightpro: {
    label: 'Midnight Pro', mode: 'dark', page: '#0a0a0c', surfaces: ['#101013', '#141418', '#1b1b21'], text: ['#ededf0', '#bdbdc6', '#9c9ca7'],
    accent: '#c8ff3d', heading: '#ffffff', font: 'sans',
    user: { text: '#f4f4f6', bg: '#16171b', border: '#c8ff3d66' },
    reply: { text: '#e4e4e9', bg: '#101013f2', border: '#2b2b33' },
    tool: { text: '#cfd0d6', bg: '#0d0d10f2', border: '#2b2b33' },
    bar: ['#c8ff3d', '#c8ff3d'],
    art: `<defs>${glow('g1', '#c8ff3d', 0.3)}${glow('g2', '#4a5bff', 0.3)}<pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#ffffff" fill-opacity="0.09"/></pattern></defs>` +
      '<rect width="1600" height="1000" fill="url(#dots)"/>' + blob('a', 1380, 80, 520, 330, 'g1') + blob('b', 160, 960, 560, 340, 'g2'),
    motion: drift([['a', 44, -160, 60], ['b', 56, 180, -50]]),
  },
  editorial: {
    label: 'Editorial', mode: 'light', page: '#efe8da', surfaces: ['#f5f0e5', '#fbf8f1', '#fffdf8'], text: ['#1d1a16', '#45403a', '#625b52'],
    accent: '#a93f1b', heading: '#14110e', font: 'serif',
    user: { text: '#2a231c', bg: '#ece3d2', border: '#a93f1b55', italic: true },
    reply: { text: '#221e19', bg: '#fdfaf3f5', border: '#d8cfbd' },
    tool: { text: '#554d42', bg: '#f3eddff5', border: '#cfc5b2' },
    bar: ['#a93f1b', '#d08a3a'],
    art: `<defs>${glow('g1', '#e3a35a', 0.22)}${glow('g2', '#c9694a', 0.14)}</defs>` + blob('a', 1400, 80, 560, 360, 'g1') + blob('b', 120, 940, 600, 360, 'g2') +
      '<rect x="80" y="70" width="1440" height="1.5" fill="#1d1a16" fill-opacity="0.12"/><rect x="80" y="78" width="1440" height="0.8" fill="#1d1a16" fill-opacity="0.09"/>',
    motion: drift([['a', 70, -90, 50], ['b', 80, 110, -40]]),
  },
  obsidian: {
    label: 'Obsidian Gold', mode: 'dark', page: '#0b0a09', surfaces: ['#131110', '#191614', '#221e1a'], text: ['#f6efe0', '#d3c8b0', '#ada28b'],
    accent: '#e2b857', heading: '#f3d995', font: 'serif',
    user: { text: '#1a1305', bg: '#d9b25a', border: '#ffe3a066', stops: ['#e8c670', '#c99b3d'] },
    reply: { text: '#f1eada', bg: '#141210f2', border: '#c9a45240' },
    tool: { text: '#e2d6ba', bg: '#171411f2', border: '#c9a45233' },
    bar: ['#c99b3d', '#f3d995'],
    art: `<defs>${glow('g1', '#d8a845', 0.48)}${glow('g2', '#8a6a2a', 0.45)}<pattern id="lines" width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="1" height="90" fill="#e2b857" fill-opacity="0.09"/></pattern></defs>` +
      '<rect width="1600" height="1000" fill="url(#lines)"/>' + blob('a', 1250, 60, 600, 300, 'g1') + blob('b', 300, 1000, 700, 300, 'g2'),
    motion: drift([['a', 48, -200, 40], ['b', 58, 180, -50]]),
  },
  abyss: {
    label: 'Abyss', mode: 'dark', page: '#04141c', surfaces: ['#08202b', '#0c2a37', '#123646'], text: ['#e8fbff', '#bfe0e8', '#9bc2cc'],
    accent: '#4fd9e8', heading: '#ffffff', font: 'sans',
    user: { text: '#ffffff', bg: '#0b6c84', border: '#bff6ff33', stops: ['#0b6c84', '#1a4f9c'] },
    reply: { text: '#e6f9fc', bg: '#08222ee8', border: '#8fe6f033' },
    tool: { text: '#cdeef4', bg: '#0a2835e8', border: '#8fe6f02b' },
    bar: ['#1a8fb5', '#7ff0e0'],
    art: `<defs>${glow('g1', '#35c8e0', 0.38)}${glow('g2', '#1a5fb4', 0.45)}${glow('ray', '#bff6ff', 0.2)}</defs>` +
      blob('a', 500, 0, 130, 640, 'ray') + blob('b', 900, -40, 90, 700, 'ray') + blob('c', 1240, 0, 160, 580, 'ray') + blob('d', 300, 920, 700, 280, 'g2') + blob('e', 1300, 860, 560, 300, 'g1') + BUBBLES,
    motion: drift([['a', 34, 110, 0], ['b', 42, -130, 0], ['c', 50, 90, 0], ['d', 60, 140, -40], ['e', 66, -120, -50]]) +
      '.u0{animation:rise 34s linear infinite}.u1{animation:rise 46s linear infinite}.u2{animation:rise 58s linear infinite}@keyframes rise{to{transform:translateY(-900px)}}',
  },
  ember: {
    label: 'Ember Dusk', mode: 'dark', page: '#170d1c', surfaces: ['#211228', '#2b1832', '#371f3e'], text: ['#fff1ea', '#ecccc4', '#cca6a4'],
    accent: '#ff9a5c', heading: '#ffffff', font: 'sans',
    user: { text: '#ffffff', bg: '#a83a5a', border: '#ffd0c033', stops: ['#b8452a', '#8a2f7a'] },
    reply: { text: '#fdeee8', bg: '#241229ea', border: '#ffb89a33' },
    tool: { text: '#f3d8d0', bg: '#2a1730ea', border: '#ffb89a2b' },
    bar: ['#ff7a45', '#ffd27a'],
    art: `<defs>${glow('g1', '#ff7a3d', 0.6)}${glow('g2', '#c02f6a', 0.55)}${glow('g3', '#5a2a9a', 0.6)}</defs>` +
      STARS + blob('a', 800, 1060, 760, 330, 'g1') + blob('b', 250, 900, 620, 300, 'g2') + blob('c', 1350, 150, 640, 330, 'g3'),
    motion: drift([['a', 46, 120, -40], ['b', 54, 170, 30], ['c', 62, -180, 60]]),
  },
}

export const PREMIUM_NAMES = Object.keys(LOOKS) as PremiumName[]

export const isPremium = (name: string): name is PremiumName => (PREMIUM_NAMES as string[]).includes(name)

/** The backdrop drawing. Still: the same picture with nothing moving. */
export const scene = (name: PremiumName, isMoving: boolean): string => {
  const look = LOOKS[name]
  const style = isMoving ? `<style>${look.motion}@media (prefers-reduced-motion:reduce){*{animation:none}}</style>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">${style}<rect width="1600" height="1000" fill="${look.page}"/>${look.art}</svg>`
}

export const premiumColors = (name: PremiumName) => {
  const l = LOOKS[name]
  const half = {
    roles:
      l.mode === 'dark'
        ? { accent: l.accent, danger: '#ff9a9a' as Hex, success: '#7fe0b0' as Hex, warning: '#ffd38a' as Hex, pro: '#c3a6ff' as Hex }
        : { accent: l.accent, danger: '#a8261c' as Hex, success: '#2f6b3a' as Hex, warning: '#835200' as Hex, pro: '#5b3a8c' as Hex },
    gray: {
      anchors: { 'surface-0': l.page, 'surface-1': l.surfaces[0], 'surface-2': l.surfaces[1], 'surface-3': l.mode === 'dark' ? l.surfaces[2] : l.surfaces[1], 'text-primary': l.text[0], 'text-secondary': l.text[1], 'text-muted': l.text[2] },
    },
  }

  return makeColors({ label: l.label, roles: half.roles, ...(l.mode === 'dark' ? { dark: half } : { light: half }) })
}

const SIZES = { small: [15, 24], medium: [17, 27], large: [20, 31] } as const
const GLASS = { clear: { blur: 4, opacity: 0.1 }, frosted: { blur: 14, opacity: 0.26 }, solid: { blur: 28, opacity: 0.7 } } as const

export const premiumStyle = (name: PremiumName, o: LookOptions): ThemeStyle => {
  const l = LOOKS[name]
  const [fontSize, lineHeight] = SIZES[o.size]
  const isSoft = o.corners === 'soft' && name !== 'midnightpro' && name !== 'editorial'
  const radius = isSoft ? 18 : o.corners === 'soft' ? 8 : 3
  const shadow = { x: 0, y: 10, blur: 28, color: l.mode === 'dark' ? '#02041066' : '#3a2a1022' } as const

  return {
    Text: { fontFamily: [l.font], fontSize, lineHeight },
    Heading: { color: l.heading, fontWeight: 'semibold' },
    UserMessage: {
      color: l.user.text,
      backgroundColor: l.user.bg,
      ...(l.user.stops === undefined ? { borderColor: l.user.border, borderWidth: 1 } : { fill: { gradient: { angle: 120, stops: l.user.stops } } }),
      ...(l.user.italic === true ? { italic: true } : {}),
      radius: isSoft ? [20, 20, 6, 20] : radius,
      paddingX: 18,
      paddingY: 12,
      shadow,
    },
    AssistantMessage: { color: l.reply.text, backgroundColor: l.reply.bg, borderColor: l.reply.border, borderWidth: 1, radius, paddingX: 18, paddingY: 14, shadow },
    ToolUse: { color: l.tool.text, fontFamily: ['mono'], backgroundColor: l.tool.bg, borderColor: l.tool.border, borderWidth: 1, radius, paddingX: 14, paddingY: 8 },
  }
}

export const premiumTheme = (name: PremiumName, o: LookOptions): ThemeSetArgs => ({
  colors: premiumColors(name).theme,
  overrideColorScheme: LOOKS[name].mode,
  backdrop: { scene: name, glass: { ...GLASS[o.glass], tint: LOOKS[name].page } },
})

const SEGMENTS = 10

/** The step bar in the look's own colors, drawn as one small picture. */
export const stepBar = (name: PremiumName, done: number, total: number): { source: string; width: number; height: number } => {
  const l = LOOKS[name]
  const count = Math.max(2, Math.min(SEGMENTS, total))
  const filled = Math.max(0, Math.min(count, total <= SEGMENTS ? done : Math.floor((done / total) * SEGMENTS)))
  const width = 320
  const each = (width - (count - 1) * 4) / count
  const track = l.mode === 'dark' ? '#ffffff' : '#000000'
  const cells = Array.from({ length: count }, (_, i) =>
    `<rect x="${(i * (each + 4)).toFixed(1)}" y="0" width="${each.toFixed(1)}" height="6" rx="3" fill="${i < filled ? 'url(#g)' : track}" fill-opacity="${i < filled ? '1' : '0.16'}"/>`,
  ).join('')

  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 6" width="${width}" height="6"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="0"><stop offset="0" stop-color="${l.bar[0]}"/><stop offset="1" stop-color="${l.bar[1]}"/></linearGradient></defs>${cells}</svg>`,
    width,
    height: 6,
  }
}
