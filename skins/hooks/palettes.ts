import type { ThemeMessageRule, ThemeSetArgs, ThemeStyle } from 'claude-code'

import { makeColors } from './make-colors.js'

// Pure data and helpers: no `$` in here, so the tests can run every palette
// through makeColors and read the problems list.

export type Def = Omit<Parameters<typeof makeColors>[0], 'label'>
type Roles = NonNullable<Def['roles']>
type Mode = NonNullable<Def['light']>

export type Palette = {
  id: string
  label: string
  blurb: string
  def: Def
  // Rows of the conversation (desktop app only). Colours that name a surface follow light and dark.
  style?: ThemeStyle
  // A still ground behind the conversation, with no scene hook needed.
  ground?: { color: `#${string}` }
  scheme?: 'light' | 'dark'
}

// ---- colour maths ----

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export const hsl = (h: number, s: number, l: number): string => {
  const sat = clamp(s, 0, 100) / 100
  const lig = clamp(l, 0, 100) / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

/** `#abc` or `#aabbcc` (with or without the `#`) to `#aabbcc` lower case, or null. */
export const normalizeHex = (raw: string): string | null => {
  const s = raw.trim().replace(/^#/, '').toLowerCase()

  if (/^[0-9a-f]{3}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
  }

  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null
}

const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

const hexOf = (rgb: readonly number[]): string =>
  `#${rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`

/** `t` of the way from `from` to `to`. */
export const mix = (from: string, to: string, t: number): string => {
  const a = rgbOf(from)
  const b = rgbOf(to)

  return hexOf(a.map((v, i) => v + (b[i]! - v) * t))
}

/** Hue 0-360, saturation and lightness 0-100 of a `#rrggbb`. */
export const hslOf = (hex: string): { h: number; s: number; l: number } => {
  const [r, g, b] = rgbOf(hex).map(v => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) {
    return { h: 0, s: 0, l: l * 100 }
  }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4

  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 }
}

// ---- builders ----

const ROLES_DEFAULT: Roles = {
  accent: '#2f5d8c',
  danger: '#b3392f',
  success: '#4e7d3a',
  warning: '#a86f14',
  pro: '#6d4f94',
}

type Six = readonly [string, string, string, string, string, string]

const lightMode = ([s0, s1, s2, t1, t2, t3]: Six): Mode => ({
  gray: {
    anchors: {
      'surface-0': s0,
      'surface-1': s1,
      'surface-2': s2,
      'text-primary': t1,
      'text-secondary': t2,
      'text-muted': t3,
    },
  },
})

const darkMode = ([s0, s1, s2, t1, t2, t3]: Six): Mode => ({
  gray: {
    anchors: {
      'surface-0': s0,
      'surface-1': s1,
      'surface-2': s2,
      'surface-3': s2,
      'text-primary': t1,
      'text-secondary': t2,
      'text-muted': t3,
    },
  },
})

type Tint = { hue: number; sat: number; roles: Roles; lightSat?: number; darkSat?: number }

// A whole palette from one hue: every surface and text takes the hue, a few percent of lightness apart.
export const tinted = ({ hue, sat, roles, lightSat = sat, darkSat = sat }: Tint): Def => ({
  roles,
  light: lightMode([
    hsl(hue, lightSat, 87),
    hsl(hue, lightSat, 91),
    hsl(hue, lightSat, 95),
    hsl(hue, 35, 11),
    hsl(hue, 25, 24),
    hsl(hue, 18, 31),
  ]),
  dark: darkMode([
    hsl(hue, darkSat, 8),
    hsl(hue, darkSat, 11),
    hsl(hue, darkSat, 14),
    hsl(hue, 40, 93),
    hsl(hue, 25, 80),
    hsl(hue, 18, 69),
  ]),
})

// The neutral base the contrast steps use when no palette is picked.
const PLAIN: Def = {
  roles: ROLES_DEFAULT,
  light: lightMode(['#e9e9e9', '#f1f1f1', '#f8f8f8', '#1f1f1f', '#444444', '#595959']),
  dark: darkMode(['#1a1a1a', '#212121', '#282828', '#e6e6e6', '#c4c4c4', '#a3a3a3']),
}

export const PLAIN_ID = 'plain'

// ---- the fifteen named palettes ----

const NEON_STYLE: ThemeStyle = {
  UserMessage: {
    color: '#e6fbff',
    backgroundColor: '#0d1020',
    borderColor: '#00f0ff',
    borderWidth: 1,
    radius: 6,
    shadow: { x: 0, y: 0, blur: 8, color: '#00f0ff55' },
  },
  AssistantMessage: {
    color: '#f6e8ff',
    backgroundColor: '#0d1020',
    borderColor: '#ff2d9b',
    borderWidth: 1,
    radius: 6,
    shadow: { x: 0, y: 0, blur: 8, color: '#ff2d9b55' },
  },
  ToolUse: { color: '#eadcff', backgroundColor: '#0d1020', borderColor: '#bf5fff', borderWidth: 1, radius: 6 },
}

const BLUEPRINT_STYLE: ThemeStyle = {
  UserMessage: { color: '#eef5ff', backgroundColor: '#0f3774', borderColor: '#9cc4ff', borderWidth: 1, radius: 0 },
  AssistantMessage: { color: '#eef5ff', backgroundColor: '#0c2f66', borderColor: '#6f9fe0', borderWidth: 1, radius: 0 },
  ToolUse: { color: '#d3e4ff', backgroundColor: '#0c2f66', borderColor: '#6f9fe0', borderWidth: 1, radius: 0 },
}

const NEWSPAPER_STYLE: ThemeStyle = {
  Text: { fontFamily: ['serif'] },
  Heading: { fontFamily: ['serif'], fontWeight: 'bold' },
  UserMessage: { backgroundColor: 'surface-2', borderColor: 'text-primary', borderWidth: 1, radius: 0 },
}

const NOTEBOOK_STYLE: ThemeStyle = {
  Heading: { fontFamily: ['cursive'] },
  UserMessage: {
    fontFamily: ['cursive'],
    fontSize: 17,
    lineHeight: 26,
    backgroundColor: 'surface-2',
    borderColor: 'border-accent',
    borderWidth: 1,
    radius: 4,
  },
}

const NOTE_BASE = { color: '#2b2416', radius: 2, padding: 14, shadow: { x: 0, y: 3, blur: 8, color: '#00000055' } } as const

const STICKY_STYLE: ThemeStyle = {
  UserMessage: [
    { ...NOTE_BASE, backgroundColor: '#fde68a', fontFamily: ['cursive'], fontSize: 17, lineHeight: 26, rotate: -1.5 },
    { ...NOTE_BASE, backgroundColor: '#fbcfe8', fontFamily: ['cursive'], fontSize: 17, lineHeight: 26, rotate: 1 },
  ],
  AssistantMessage: { ...NOTE_BASE, backgroundColor: '#fbf6e9' },
  ToolUse: { color: '#2b2416', backgroundColor: '#f6edd2', radius: 3, paddingX: 8 },
}

const CHALK_STYLE: ThemeStyle = {
  Heading: { fontFamily: ['cursive'] },
  UserMessage: { color: '#f4f1e4', backgroundColor: '#2e403a', borderColor: '#e8e6d4', borderWidth: 1, radius: 10 },
}

const PASTEL_STYLE: ThemeStyle = {
  UserMessage: { backgroundColor: 'surface-2', radius: 18 },
  ToolUse: { radius: 12 },
}

export const PALETTES: Record<string, Palette> = {
  neon: {
    id: 'neon',
    label: 'Neon outline',
    blurb: 'near-black, cyan and magenta outlines glowing round each message',
    scheme: 'dark',
    def: {
      only: 'dark',
      roles: { accent: '#00f0ff', danger: '#ff3d71', success: '#3dff9a', warning: '#ffe600', pro: '#bf5fff' },
      dark: darkMode(['#07070d', '#0c0d18', '#121426', '#f1fdff', '#c4eaf2', '#9fc6d1']),
    },
    style: NEON_STYLE,
  },
  pastel: {
    id: 'pastel',
    label: 'Pastel',
    blurb: 'soft lilac and rose, round bubbles',
    def: {
      roles: { accent: '#8f7de0', danger: '#e07a8a', success: '#5fbf96', warning: '#d9a94f', pro: '#c08ae0' },
      light: lightMode(['#efe6f2', '#f5eef7', '#fbf7fc', '#2b2233', '#4d4058', '#625470']),
      dark: darkMode(['#1f1b27', '#272233', '#2f293d', '#f1e9f8', '#d3c7e0', '#b3a6c2']),
    },
    style: PASTEL_STYLE,
  },
  mono: {
    id: 'mono',
    label: 'Monochrome',
    blurb: 'one blue-grey hue ramp, status colours kept faint',
    def: {
      roles: { accent: '#4a6a8a', danger: '#a56a66', success: '#6d8f78', warning: '#a38f5c', pro: '#5d7896' },
      light: lightMode([
        hsl(215, 10, 88),
        hsl(215, 10, 92),
        hsl(215, 10, 96),
        hsl(215, 30, 12),
        hsl(215, 18, 26),
        hsl(215, 14, 34),
      ]),
      dark: darkMode([
        hsl(215, 10, 9),
        hsl(215, 10, 12),
        hsl(215, 10, 15),
        hsl(215, 22, 93),
        hsl(215, 14, 80),
        hsl(215, 10, 68),
      ]),
    },
  },
  duotone: {
    id: 'duotone',
    label: 'Duotone',
    blurb: 'deep indigo against hot coral, nothing else',
    def: {
      roles: { accent: '#ee5a3c', danger: '#e04a3f', success: '#3d8fc2', warning: '#e0902f', pro: '#5b5bd6' },
      light: lightMode(['#e6e5f2', '#eeedf8', '#f6f5fc', '#1c1a3a', '#3a3868', '#4d4b7c']),
      dark: darkMode(['#0f0e26', '#16143a', '#1d1b48', '#f2f0ff', '#cfcdf5', '#a9a7e0']),
    },
  },
  'terminal-green': {
    id: 'terminal-green',
    label: 'Terminal green',
    blurb: 'classic green phosphor on black',
    scheme: 'dark',
    def: {
      only: 'dark',
      roles: { accent: '#33ff66', danger: '#ff6b4a', success: '#66ff99', warning: '#d8ff33', pro: '#2fe0b0' },
      dark: darkMode(['#000a03', '#031208', '#061b0d', '#8dffa6', '#5fe07d', '#49bd63']),
    },
  },
  amber: {
    id: 'amber',
    label: 'Amber monitor',
    blurb: 'old amber CRT: everything glows orange-yellow',
    scheme: 'dark',
    def: {
      only: 'dark',
      roles: { accent: '#ffb000', danger: '#ff6a3d', success: '#d6e04a', warning: '#ffd040', pro: '#ff9a70' },
      dark: darkMode(['#110800', '#1a0e02', '#231505', '#ffc766', '#e0a444', '#bf8a36']),
    },
  },
  blueprint: {
    id: 'blueprint',
    label: 'Blueprint',
    blurb: 'white linework on drafting blue, square corners',
    scheme: 'dark',
    def: {
      only: 'dark',
      roles: { accent: '#7fd3ff', danger: '#ff8a80', success: '#8ff0b0', warning: '#ffd36b', pro: '#c3b0ff' },
      dark: darkMode(['#0a2a5c', '#0c3068', '#0f3774', '#eef5ff', '#c4daf8', '#a6c6f0']),
    },
    style: BLUEPRINT_STYLE,
  },
  newspaper: {
    id: 'newspaper',
    label: 'Newspaper',
    blurb: 'newsprint grey, serif type, ink-red accent, hairline boxes',
    def: {
      roles: { accent: '#9c1f1f', danger: '#b3261e', success: '#2f6b3a', warning: '#9a6410', pro: '#4a3a7a' },
      light: lightMode(['#e6e3db', '#edeae2', '#f5f2ea', '#141414', '#383632', '#4d4a44']),
      dark: darkMode(['#161513', '#1e1d1a', '#272622', '#ece8df', '#cfcac0', '#aea99e']),
    },
    style: NEWSPAPER_STYLE,
  },
  notebook: {
    id: 'notebook',
    label: 'Notebook',
    blurb: 'cream ruled paper, blue ink, handwriting for your messages',
    def: {
      roles: { accent: '#2b50aa', danger: '#c0392b', success: '#2f7a4a', warning: '#a8700f', pro: '#7a4a9a' },
      light: lightMode(['#efead4', '#f5f1de', '#fbf8ea', '#1d2440', '#363e5e', '#4a5272']),
      dark: darkMode(['#161a2a', '#1d2236', '#252b42', '#e9ecf8', '#c6cbe0', '#a5abc4']),
    },
    style: NOTEBOOK_STYLE,
  },
  'sticky-note': {
    id: 'sticky-note',
    label: 'Sticky notes',
    blurb: 'cork board, your messages as slightly crooked notes',
    scheme: 'light',
    def: {
      only: 'light',
      roles: { accent: '#b3541e', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#7a4f94' },
      light: lightMode(['#efe3b0', '#f5ebc4', '#fbf3d6', '#2b2416', '#4a3f27', '#5f5333']),
    },
    style: STICKY_STYLE,
    ground: { color: '#b98a5a' },
  },
  chalkboard: {
    id: 'chalkboard',
    label: 'Chalkboard',
    blurb: 'slate green, chalk white, chalk-yellow accent',
    scheme: 'dark',
    def: {
      only: 'dark',
      roles: { accent: '#f4e285', danger: '#f0958f', success: '#a5d6a7', warning: '#f5c97a', pro: '#c9b2f0' },
      dark: darkMode(['#1b2622', '#222f2a', '#2a3933', '#f4f1e4', '#d4d1c2', '#b2b0a2']),
    },
    style: CHALK_STYLE,
  },
  sunrise: {
    id: 'sunrise',
    label: 'Sunrise',
    blurb: 'peach and rose paper, coral accent; plum night',
    def: {
      roles: { accent: '#e8643c', danger: '#c23a3a', success: '#4f8f4a', warning: '#c0801a', pro: '#a0508a' },
      light: lightMode([hsl(22, 48, 88), hsl(22, 48, 92), hsl(22, 48, 96), hsl(10, 40, 12), hsl(10, 28, 24), hsl(10, 20, 32)]),
      dark: darkMode(['#1d1216', '#271920', '#30202a', '#fbe8e0', '#e6c8c3', '#c3a3a3']),
    },
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    blurb: 'moss and bark greens, fern accent',
    def: {
      roles: { accent: '#3f7d4f', danger: '#b0443a', success: '#4f8f3a', warning: '#a87a1c', pro: '#6a5a8a' },
      light: lightMode([hsl(140, 20, 86), hsl(140, 20, 90), hsl(140, 20, 94), hsl(150, 40, 10), hsl(150, 26, 22), hsl(150, 18, 30)]),
      dark: darkMode(['#0d1812', '#13211a', '#192a21', '#e3f3e8', '#bfdcc8', '#9bbba6']),
    },
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    blurb: 'sea-glass blues, teal accent; deep water at night',
    def: {
      roles: { accent: '#1d7fa6', danger: '#b8433f', success: '#2f8f6a', warning: '#b07a18', pro: '#5a6ab8' },
      light: lightMode([hsl(200, 30, 86), hsl(200, 30, 90), hsl(200, 30, 94), hsl(205, 45, 11), hsl(205, 30, 23), hsl(205, 20, 31)]),
      dark: darkMode(['#07151d', '#0c1e29', '#122734', '#e2f2fa', '#bcd8e6', '#98b8c9']),
    },
  },
  desert: {
    id: 'desert',
    label: 'Desert',
    blurb: 'sand and sandstone, terracotta accent; dusk adobe',
    def: {
      roles: { accent: '#b5542e', danger: '#a8322a', success: '#6a7f3a', warning: '#b27a1a', pro: '#8a5a7a' },
      light: lightMode([hsl(36, 42, 85), hsl(36, 42, 90), hsl(36, 42, 94), hsl(24, 40, 11), hsl(24, 28, 23), hsl(24, 20, 31)]),
      dark: darkMode(['#1b130e', '#251a13', '#2f211a', '#f6e8d8', '#dcc9b4', '#b8a28d']),
    },
  },
}

export const PALETTE_IDS = Object.keys(PALETTES)

export const ALIASES: Record<string, string> = {
  terminal: 'terminal-green',
  green: 'terminal-green',
  classic: 'terminal-green',
  crt: 'amber',
  monitor: 'amber',
  monochrome: 'mono',
  sticky: 'sticky-note',
  stickies: 'sticky-note',
  notes: 'sticky-note',
  chalk: 'chalkboard',
  blackboard: 'chalkboard',
  news: 'newspaper',
  paperboy: 'newspaper',
  sand: 'desert',
  sea: 'ocean',
  woods: 'forest',
  dawn: 'sunrise',
  pastels: 'pastel',
  neon: 'neon',
  outline: 'neon',
}

export const resolveName = (raw: string): string | null => {
  const k = raw.trim().toLowerCase()
  const id = ALIASES[k] ?? k

  return id in PALETTES ? id : null
}

// ---- one accent hex to a whole theme ----

/** A theme from one colour: the accent role, and greys that lean a little toward its hue. */
export const accentDef = (hex: string): Def => {
  const { h, s } = hslOf(hex)
  const sat = clamp(s * 0.3, 6, 22)

  return {
    roles: { accent: hex, danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
    light: lightMode([hsl(h, sat, 88), hsl(h, sat, 92), hsl(h, sat, 96), hsl(h, 30, 11), hsl(h, 22, 24), hsl(h, 16, 32)]),
    dark: darkMode([hsl(h, sat, 8), hsl(h, sat, 11), hsl(h, sat, 14), hsl(h, 30, 93), hsl(h, 20, 80), hsl(h, 14, 68)]),
  }
}

// ---- contrast steps ----

export type Level = 'soft' | 'normal' | 'sharp' | 'max'
export const LEVELS: readonly Level[] = ['soft', 'normal', 'sharp', 'max']

// Text moves toward the strongest colour for the mode (positive) or toward the page (negative);
// surfaces move toward the opposite extreme so cards separate from the page.
const STEPS: Record<Level, { text: readonly [number, number, number]; surface: number; more: boolean }> = {
  soft: { text: [-0.1, -0.1, -0.05], surface: 0, more: false },
  normal: { text: [0, 0, 0], surface: 0, more: false },
  sharp: { text: [0.6, 0.5, 0.4], surface: 0.1, more: false },
  max: { text: [1, 0.9, 0.75], surface: 0.4, more: true },
}

const SURFACES = ['surface-0', 'surface-1', 'surface-2', 'surface-3'] as const
const TEXTS = ['text-primary', 'text-secondary', 'text-muted'] as const

const shiftMode = (mode: Mode, strongest: string, page: string, step: (typeof STEPS)[Level]): Mode => {
  const anchors = mode.gray?.anchors

  if (anchors === undefined) {
    return mode
  }
  const next: Record<string, string> = { ...anchors }
  const pageColor = anchors['surface-0']

  TEXTS.forEach((key, i) => {
    const from = anchors[key]
    const amount = step.text[i]!

    if (from !== undefined && amount !== 0) {
      next[key] = amount > 0 ? mix(from, strongest, amount) : mix(from, pageColor, -amount)
    }
  })

  if (step.surface > 0) {
    for (const key of SURFACES) {
      const from = anchors[key]

      if (from !== undefined) {
        next[key] = mix(from, page, step.surface)
      }
    }
  }

  return { ...mode, gray: { ...mode.gray, anchors: next as NonNullable<Mode['gray']>['anchors'] } }
}

export const withContrast = (def: Def, level: Level): Def => {
  const step = STEPS[level]

  if (level === 'normal') {
    return def
  }

  return {
    ...def,
    ...(step.more ? { contrast: 'more' as const } : {}),
    ...(def.light === undefined ? {} : { light: shiftMode(def.light, '#000000', '#ffffff', step) }),
    ...(def.dark === undefined ? {} : { dark: shiftMode(def.dark, '#ffffff', '#000000', step) }),
  }
}

// ---- corners ----

export type Corners = 'round' | 'square'

const roundRule = <R extends ThemeMessageRule>(rule: R, radius: number): R => ({ ...rule, radius })

type Rows = 'UserMessage' | 'AssistantMessage' | 'ToolUse'

const roundRules = (rule: ThemeMessageRule | readonly ThemeMessageRule[] | undefined, radius: number) =>
  Array.isArray(rule)
    ? (rule as readonly ThemeMessageRule[]).map(r => roundRule(r, radius))
    : roundRule((rule as ThemeMessageRule | undefined) ?? {}, radius)

/** Sets the corner radius of the message and tool rows on top of a palette's own style. */
export const withCorners = (style: ThemeStyle | undefined, corners: Corners): ThemeStyle => {
  const radius: Record<Rows, number> =
    corners === 'round' ? { UserMessage: 18, AssistantMessage: 14, ToolUse: 12 } : { UserMessage: 0, AssistantMessage: 0, ToolUse: 0 }
  const out: ThemeStyle = { ...(style ?? {}) }

  out.UserMessage = roundRules(out.UserMessage, radius.UserMessage)
  // A reply has no box until a rule gives it one: only restyle one a palette already boxed.
  if (out.AssistantMessage !== undefined) {
    out.AssistantMessage = roundRules(out.AssistantMessage, radius.AssistantMessage)
  }
  out.ToolUse = roundRule(out.ToolUse ?? {}, radius.ToolUse)

  return out
}

// ---- the whole choice ----

export type Comp = {
  // A palette id, 'accent:#rrggbb', or null for none.
  base: string | null
  level: Level
  corners: Corners | null
  glass: boolean
  grain: boolean
}

export const EMPTY: Comp = { base: null, level: 'normal', corners: null, glass: false, grain: false }

export const isEmpty = (c: Comp): boolean =>
  c.base === null && c.level === 'normal' && c.corners === null && !c.glass && !c.grain

export const SCENE_GRAIN = 'grain'
export const SCENE_GLASS = 'glass'

export type Resolved = {
  args: ThemeSetArgs | undefined
  // Why it was refused, when it was.
  refusal: string | null
  // Contrast lines that are not refusals.
  notes: string[]
}

export const baseDef = (base: string | null): Def | undefined => {
  if (base === null) {
    return undefined
  }

  if (base.startsWith('accent:')) {
    return accentDef(base.slice(7))
  }

  return PALETTES[base]?.def
}

const REFUSED = "Desktop won't paint"

/** Works out the whole theme for a choice. Pure: no engine call. */
export const resolve = (comp: Comp): Resolved => {
  const palette = comp.base === null ? undefined : PALETTES[comp.base]
  let def = baseDef(comp.base)

  if (def === undefined && comp.level !== 'normal') {
    def = PLAIN
  }
  const args: ThemeSetArgs = {}
  const notes: string[] = []

  if (def !== undefined) {
    try {
      const { theme, problems } = makeColors({ label: palette?.label ?? comp.base ?? 'Skin', ...withContrast(def, comp.level) })
      const refused = problems.find(line => line.startsWith(REFUSED))

      if (refused !== undefined) {
        return { args: undefined, refusal: refused, notes }
      }
      notes.push(...problems)
      args.colors = theme
    } catch (error) {
      return { args: undefined, refusal: String(error), notes }
    }
  }

  if (palette?.style !== undefined || comp.corners !== null) {
    args.style = comp.corners === null ? palette?.style : withCorners(palette?.style, comp.corners)
  }

  if (comp.glass) {
    args.backdrop = { scene: SCENE_GLASS, glass: { blur: 28, opacity: 0.5 } }
  } else if (comp.grain) {
    args.backdrop = { scene: SCENE_GRAIN, glass: { blur: 6, opacity: 0.55 } }
  } else if (palette?.ground !== undefined) {
    args.backdrop = palette.ground
  }

  if (palette?.scheme === 'light' && comp.base === 'sticky-note') {
    args.overrideColorScheme = 'light'
  }

  return { args: Object.keys(args).length === 0 ? undefined : args, refusal: null, notes }
}

const labelOfBase = (base: string | null): string => {
  if (base === null) {
    return 'none'
  }

  return base.startsWith('accent:') ? `accent ${base.slice(7)}` : (PALETTES[base]?.label ?? base)
}

export const describe = (c: Comp): string => {
  if (isEmpty(c)) {
    return "none (the app's own look)"
  }
  const parts = [`palette ${labelOfBase(c.base)}`, `contrast ${c.level}`]

  if (c.corners !== null) {
    parts.push(`corners ${c.corners === 'round' ? 'rounded' : 'square'}`)
  }

  if (c.glass) {
    parts.push('glass cards')
  }

  if (c.grain) {
    parts.push('paper grain')
  }

  return parts.join(' · ')
}

// Reads a saved choice back, trusting nothing about it.
export const parseComp = (value: unknown): Comp | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const v = value as Record<string, unknown>
  const base = v.base
  const okBase =
    base === null ||
    (typeof base === 'string' && (base in PALETTES || (base.startsWith('accent:') && normalizeHex(base.slice(7)) === base.slice(7))))

  if (!okBase) {
    return null
  }
  const level = LEVELS.find(l => l === v.level) ?? 'normal'
  const corners: Corners | null = v.corners === 'round' || v.corners === 'square' ? v.corners : null
  const glass = v.glass === true
  const grain = v.grain === true && !glass

  return { base: base as string | null, level, corners, glass, grain }
}


// ---- swatches for the preview pane ----

export type Swatch = { name: string; hex: string }

/** Raw hex colours of a palette for the preview: surface, card, text and accent, per mode it has. */
export const swatchesOf = (def: Def): { light: Swatch[]; dark: Swatch[]; accent: string } => {
  const take = (mode: Mode | undefined): Swatch[] => {
    const a = mode?.gray?.anchors

    return a === undefined
      ? []
      : [
          { name: 'page', hex: a['surface-0'] },
          { name: 'card', hex: a['surface-2'] ?? a['surface-1'] ?? a['surface-0'] },
          { name: 'text', hex: a['text-primary'] },
        ]
  }
  const accent = typeof def.roles?.accent === 'string' ? def.roles.accent : (def.roles?.accent as { seed?: string } | undefined)?.seed ?? '#888888'

  return { light: take(def.light), dark: take(def.dark), accent }
}
