import { makeColors } from './make-colors.js'

// Pure data and helpers: no `$` in here, so the tests can run every palette through makeColors.

export type Def = Omit<Parameters<typeof makeColors>[0], 'label'>
export type Roles = NonNullable<Def['roles']>
export type RoleName = 'accent' | 'danger' | 'success' | 'warning' | 'pro'

export const ROLE_NAMES: readonly RoleName[] = ['accent', 'danger', 'success', 'warning', 'pro']

export type Skin = { id: string; label: string; blurb: string; def: Def }

const ROLES_DEFAULT: Roles = {
  accent: '#2f5d8c',
  danger: '#b3392f',
  success: '#4e7d3a',
  warning: '#a86f14',
  pro: '#6d4f94',
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export const hsl = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 100) / 100
  const lig = clamp(l, 0, 100) / 100
  const k = (n: number) => (n + hh / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)

/** Hue 0..359 of a #rrggbb colour; 0 for a gray. */
export const hexHue = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min

  if (d === 0) {
    return 0
  }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4

  return Math.round(((h * 60) % 360 + 360) % 360)
}

export const COLOUR_NAMES: Readonly<Record<string, string>> = {
  red: '#c0392b',
  orange: '#d9731a',
  amber: '#d9a21a',
  green: '#2e8b57',
  teal: '#1a9a94',
  cyan: '#1a8fb0',
  blue: '#2f6fd0',
  indigo: '#4b4fc4',
  purple: '#8a4fc4',
  pink: '#cf4a8e',
}

/** A colour word or a six-digit hex, as lower-case hex; undefined when it is neither. */
export const parseColour = (raw: string): string | undefined => {
  const word = raw.trim().toLowerCase()

  if (word in COLOUR_NAMES) {
    return COLOUR_NAMES[word]
  }

  return isHex(word) ? word : undefined
}

type Tint = { hue: number; sat: number; roles: Roles; only?: 'light' | 'dark' }

// A whole look from one hue: every surface and text takes the hue, a few percent of lightness apart.
export const tinted = ({ hue, sat, roles, only }: Tint): Def => {
  const light: Def['light'] = {
    gray: {
      anchors: {
        'surface-0': hsl(hue, sat, 87),
        'surface-1': hsl(hue, sat, 91),
        'surface-2': hsl(hue, sat, 95),
        'text-primary': hsl(hue, 35, 11),
        'text-secondary': hsl(hue, 25, 24),
        'text-muted': hsl(hue, 18, 31),
      },
    },
  }
  const dark: Def['dark'] = {
    gray: {
      anchors: {
        'surface-0': hsl(hue, sat, 8),
        'surface-1': hsl(hue, sat, 11),
        'surface-2': hsl(hue, sat, 14),
        'surface-3': hsl(hue, sat, 14),
        'text-primary': hsl(hue, 40, 93),
        'text-secondary': hsl(hue, 25, 80),
        'text-muted': hsl(hue, 18, 69),
      },
    },
  }

  return only === 'light' ? { roles, only, light } : only === 'dark' ? { roles, only, dark } : { roles, light, dark }
}

const CYBER: Def = {
  only: 'dark',
  roles: { accent: '#00e5ff', danger: '#ff2a6d', success: '#05ffa1', warning: '#ffd300', pro: '#b967ff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0a0a14',
        'surface-1': '#0f0f20',
        'surface-2': '#15152b',
        'surface-3': '#15152b',
        'text-primary': '#e6f1ff',
        'text-secondary': '#b9c8ee',
        'text-muted': '#93a3d1',
      },
    },
  },
}

// Low blue: every colour here keeps its blue channel well under its red.
const COZY: Def = {
  only: 'dark',
  roles: { accent: '#e0a040', danger: '#d9694f', success: '#a3b35c', warning: '#e8b04a', pro: '#c4909f' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#16110c',
        'surface-1': '#1d1711',
        'surface-2': '#251d15',
        'surface-3': '#251d15',
        'text-primary': '#f3dfbf',
        'text-secondary': '#d6bf98',
        'text-muted': '#b39d7a',
      },
    },
  },
}

const HIVIS: Def = {
  contrast: 'more',
  roles: { accent: '#0057d9', danger: '#c40000', success: '#007a2e', warning: '#a35200', pro: '#6a1fc2' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#f0f0f0',
        'surface-1': '#f7f7f7',
        'surface-2': '#ffffff',
        'text-primary': '#000000',
        'text-secondary': '#141414',
        'text-muted': '#2e2e2e',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#000000',
        'surface-1': '#080808',
        'surface-2': '#101010',
        'surface-3': '#101010',
        'text-primary': '#ffffff',
        'text-secondary': '#f0f0f0',
        'text-muted': '#d2d2d2',
      },
    },
  },
}

// Light only, low ink: near-white page, black text, muted role colours that survive a gray printer.
const PRINT: Def = {
  only: 'light',
  roles: { accent: '#1f3a5f', danger: '#8f1d1d', success: '#2d5a2d', warning: '#7a5200', pro: '#4a2f6e' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#f6f6f4',
        'surface-1': '#fbfbfa',
        'surface-2': '#ffffff',
        'text-primary': '#000000',
        'text-secondary': '#1c1c1c',
        'text-muted': '#3d3d3d',
      },
    },
  },
}

export const huePalette = (hue: number, accent?: string, sat = 22): Def =>
  tinted({ hue, sat, roles: { ...ROLES_DEFAULT, accent: accent ?? hsl(hue, 55, 45) } })

export const WEEKDAYS = [
  { id: 'sun', name: 'Sunday', hue: 320 },
  { id: 'mon', name: 'Monday', hue: 210 },
  { id: 'tue', name: 'Tuesday', hue: 350 },
  { id: 'wed', name: 'Wednesday', hue: 150 },
  { id: 'thu', name: 'Thursday', hue: 270 },
  { id: 'fri', name: 'Friday', hue: 35 },
  { id: 'sat', name: 'Saturday', hue: 180 },
] as const

export const BRANCH_HUES = [5, 32, 50, 140, 175, 215, 258, 320] as const

/** Which of the 8 branch hues a branch name maps to (a small string hash, stable across runs). */
export const branchSlot = (branch: string): number => {
  let h = 5381

  for (const ch of branch) {
    h = (Math.imul(h, 33) + ch.charCodeAt(0)) >>> 0
  }

  return h % BRANCH_HUES.length
}

const SUN_POINTS: readonly (readonly [number, number])[] = [
  [0, 255],
  [5, 270],
  [7, 35],
  [10, 48],
  [13, 190],
  [16, 215],
  [18, 18],
  [20, 330],
  [22, 270],
  [24, 255],
]

/** Accent hue for an hour (fractional, 0 to 24): moves along the shortest arc between the key points. */
export const sunHue = (hour: number): number => {
  const t = ((hour % 24) + 24) % 24

  for (let i = 1; i < SUN_POINTS.length; i++) {
    const [h1, a] = SUN_POINTS[i - 1]!
    const [h2, b] = SUN_POINTS[i]!

    if (t <= h2) {
      let d = ((b - a + 540) % 360) - 180

      if (d === -180) {
        d = 180
      }

      return Math.round((((a + (d * (t - h1)) / (h2 - h1)) % 360) + 360) % 360)
    }
  }

  return 255
}

export type CustomPalette = { hue: number; sat: number; mode: 'both' | 'light' | 'dark'; accent?: string }

export const customDef = (c: CustomPalette): Def =>
  tinted({
    hue: c.hue,
    sat: c.sat,
    roles: { ...ROLES_DEFAULT, accent: c.accent ?? hsl(c.hue, 55, 45) },
    ...(c.mode === 'both' ? {} : { only: c.mode }),
  })

/** The fixed palettes, by name. */
export const FIXED: Readonly<Record<string, Skin>> = {
  cyber: { id: 'cyber', label: 'Cyber', blurb: 'dark neon: cyan accent on near-black violet', def: CYBER },
  night: { id: 'night', label: 'Cozy night', blurb: 'low blue: amber on warm dark, for late hours', def: COZY },
  hivis: { id: 'hivis', label: 'High visibility', blurb: 'pure black and white, strong borders, saturated roles', def: HIVIS },
  print: { id: 'print', label: 'Print friendly', blurb: 'light only, black on near-white, low-ink role colours', def: PRINT },
  ...Object.fromEntries(
    WEEKDAYS.map(d => [d.id, { id: d.id, label: d.name, blurb: `${d.name}'s tint (hue ${d.hue})`, def: huePalette(d.hue) } as Skin]),
  ),
}

export const SKIN_ALIASES: Readonly<Record<string, string>> = {
  cozy: 'night',
  highvis: 'hivis',
  hv: 'hivis',
  contrast: 'hivis',
  printer: 'print',
  neon: 'cyber',
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
  sunday: 'sun',
}

export const canonicalSkin = (word: string): string => {
  const w = word.trim().toLowerCase()

  return SKIN_ALIASES[w] ?? w
}

/** Names `/spskin` takes that are made on the spot rather than fixed. */
export const LIVE_SKINS = ['project', 'branch', 'sun', 'custom', 'plain'] as const

export const isFixedSkin = (name: string): boolean => name in FIXED

export const withRoles = (def: Def, roles: Partial<Record<RoleName, string>>): Def =>
  Object.keys(roles).length === 0 ? def : { ...def, roles: { ...def.roles, ...roles } }

export type Built = { theme: ReturnType<typeof makeColors>['theme']; problems: string[]; refused: string | undefined }

export const build = (label: string, def: Def, roles: Partial<Record<RoleName, string>> = {}): Built => {
  const { theme, problems } = makeColors({ label, ...withRoles(def, roles) })

  return { theme, problems, refused: problems.find(line => line.startsWith("Desktop won't paint")) }
}

/** Every fixed palette, for tests and for validating a role change against all of them. */
export const allFixed = (): Skin[] => Object.values(FIXED)
