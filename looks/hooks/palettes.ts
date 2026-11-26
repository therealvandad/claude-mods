import { makeColors } from './make-colors.js'

// Pure data and helpers: no `$` in here, so the tests can run every palette
// through makeColors and read the problems list.

export type Def = Omit<Parameters<typeof makeColors>[0], 'label'>
type Roles = NonNullable<Def['roles']>

export type Palette = { id: string; label: string; blurb: string; def: Def }

const ROLES_DEFAULT: Roles = {
  accent: '#2f5d8c',
  danger: '#b3392f',
  success: '#4e7d3a',
  warning: '#a86f14',
  pro: '#6d4f94',
}

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

type Tint = { hue: number; sat: number; roles: Roles; lightSat?: number; darkSat?: number }

// A whole look from one hue: every surface and text takes the hue, a few percent of lightness apart.
const tinted = ({ hue, sat, roles, lightSat = sat, darkSat = sat }: Tint): Def => ({
  roles,
  light: {
    gray: {
      anchors: {
        'surface-0': hsl(hue, lightSat, 87),
        'surface-1': hsl(hue, lightSat, 91),
        'surface-2': hsl(hue, lightSat, 95),
        'text-primary': hsl(hue, 35, 11),
        'text-secondary': hsl(hue, 25, 24),
        'text-muted': hsl(hue, 18, 31),
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': hsl(hue, darkSat, 8),
        'surface-1': hsl(hue, darkSat, 11),
        'surface-2': hsl(hue, darkSat, 14),
        'surface-3': hsl(hue, darkSat, 14),
        'text-primary': hsl(hue, 40, 93),
        'text-secondary': hsl(hue, 25, 80),
        'text-muted': hsl(hue, 18, 69),
      },
    },
  },
})

const PAPER: Def = {
  roles: ROLES_DEFAULT,
  light: {
    gray: {
      anchors: {
        'surface-0': '#efe6d3',
        'surface-1': '#f4ecdc',
        'surface-2': '#faf5e9',
        'text-primary': '#2a241d',
        'text-secondary': '#544a3d',
        'text-muted': '#6a5f50',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1f1a15',
        'surface-1': '#28221b',
        'surface-2': '#312a22',
        'surface-3': '#312a22',
        'text-primary': '#f0e7d7',
        'text-secondary': '#cfc4b2',
        'text-muted': '#aca08d',
      },
    },
  },
}

const TERMINAL: Def = {
  only: 'dark',
  roles: { accent: '#39ff7a', danger: '#ff5c57', success: '#7ee787', warning: '#f3c13a', pro: '#b48cff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#07090a',
        'surface-1': '#0c100e',
        'surface-2': '#121714',
        'surface-3': '#121714',
        'text-primary': '#d2f7da',
        'text-secondary': '#a6d6b0',
        'text-muted': '#86b391',
      },
    },
  },
}

const NORD: Def = {
  codeTheme: { dark: 'nord' },
  roles: { accent: '#5e81ac', danger: '#bf616a', success: '#a3be8c', warning: '#d08770', pro: '#b48ead' },
  light: {
    roles: { accent: '#5e81ac', danger: '#b4505a', success: '#6f8f55', warning: '#b8743a', pro: '#8f6a8a' },
    gray: {
      anchors: {
        'surface-0': '#dfe5ee',
        'surface-1': '#e5e9f0',
        'surface-2': '#eceff4',
        'text-primary': '#2e3440',
        'text-secondary': '#434c5e',
        'text-muted': '#4c566a',
      },
    },
  },
  dark: {
    roles: { accent: '#88c0d0', danger: '#bf616a', success: '#a3be8c', warning: '#ebcb8b', pro: '#b48ead' },
    gray: {
      anchors: {
        'surface-0': '#2b303b',
        'surface-1': '#2e3440',
        'surface-2': '#343b49',
        'surface-3': '#343b49',
        'text-primary': '#eceff4',
        'text-secondary': '#d8dee9',
        'text-muted': '#a9b4c6',
      },
    },
  },
}

const SOLAR_ROLES: Roles = {
  accent: '#268bd2',
  danger: '#dc322f',
  success: '#859900',
  warning: '#b58900',
  pro: '#6c71c4',
}
const SOLAR_LIGHT: NonNullable<Def['light']> = {
  gray: {
    anchors: {
      'surface-0': '#eee8d5',
      'surface-1': '#f5efdc',
      'surface-2': '#fdf6e3',
      'text-primary': '#073642',
      'text-secondary': '#2f4f58',
      'text-muted': '#4b6068',
    },
  },
}
const SOLAR_DARK: NonNullable<Def['dark']> = {
  gray: {
    anchors: {
      'surface-0': '#002b36',
      'surface-1': '#073642',
      'surface-2': '#0b3c49',
      'surface-3': '#0b3c49',
      'text-primary': '#eee8d5',
      'text-secondary': '#c8cdc3',
      'text-muted': '#93a1a1',
    },
  },
}

const CONTRAST: Def = {
  contrast: 'more',
  roles: { accent: '#0a5cff', danger: '#d40000', success: '#007a2f', warning: '#9a5b00', pro: '#7a2fd0' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#f0f0f0',
        'surface-1': '#f8f8f8',
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
        'surface-1': '#0a0a0a',
        'surface-2': '#141414',
        'surface-3': '#141414',
        'text-primary': '#ffffff',
        'text-secondary': '#f0f0f0',
        'text-muted': '#d6d6d6',
      },
    },
  },
}

const MUTED: Def = {
  roles: { accent: '#6d8fb3', danger: '#b5645c', success: '#6f9a73', warning: '#b39556', pro: '#8d7aa8' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e9e9e9',
        'surface-1': '#f1f1f1',
        'surface-2': '#f8f8f8',
        'text-primary': '#1f1f1f',
        'text-secondary': '#444444',
        'text-muted': '#595959',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1a1a1a',
        'surface-1': '#212121',
        'surface-2': '#282828',
        'surface-3': '#282828',
        'text-primary': '#e6e6e6',
        'text-secondary': '#c4c4c4',
        'text-muted': '#a3a3a3',
      },
    },
  },
}

// Low blue light: every color keeps its blue channel under its red and green.
const SEPIA: Def = {
  roles: { accent: '#a0561c', danger: '#a8381e', success: '#6b7a21', warning: '#9a6a0a', pro: '#8a4a5a' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#ecdcb8',
        'surface-1': '#f2e5c6',
        'surface-2': '#f7edd4',
        'text-primary': '#33240f',
        'text-secondary': '#53401f',
        'text-muted': '#654d2a',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1c1409',
        'surface-1': '#251b0e',
        'surface-2': '#2e2214',
        'surface-3': '#2e2214',
        'text-primary': '#ebd6aa',
        'text-secondary': '#cdb686',
        'text-muted': '#ad9769',
      },
    },
  },
}

// Blue and orange carry success and error, so red-green colorblindness loses nothing.
// The Okabe-Ito set: blue, vermillion, yellow, reddish purple.
const COLORBLIND: Def = {
  roles: { accent: '#7b6fd0', danger: '#d55e00', success: '#0072b2', warning: '#d9a400', pro: '#cc79a7' },
  light: {
    git: {
      added: '#0072b2',
      removed: '#d55e00',
      modified: '#a07800',
      merged: '#7b6fd0',
      closed: '#d55e00',
      conflicting: '#d55e00',
      draft: '#6b6b6b',
    },
  },
  dark: {
    git: {
      added: '#56b4e9',
      removed: '#f07a2a',
      modified: '#e8c040',
      merged: '#a79bf0',
      closed: '#f07a2a',
      conflicting: '#f07a2a',
      draft: '#9a9a9a',
    },
  },
}

const SEASONS: Record<string, Palette> = {
  autumn: {
    id: 'autumn',
    label: 'Autumn',
    blurb: 'leaf-brown surfaces, burnt orange accent',
    def: tinted({
      hue: 28,
      sat: 32,
      roles: { accent: '#b5521b', danger: '#a8321f', success: '#6a7a2a', warning: '#b0741a', pro: '#7a4a6a' },
    }),
  },
  snow: {
    id: 'snow',
    label: 'Snow',
    blurb: 'blue-white surfaces, ice accent',
    def: tinted({
      hue: 212,
      sat: 28,
      roles: { accent: '#3b78b8', danger: '#b8433f', success: '#3f8a63', warning: '#a97a1c', pro: '#6a5bb0' },
    }),
  },
  spring: {
    id: 'spring',
    label: 'Spring',
    blurb: 'fresh green surfaces, blossom pink accent',
    def: tinted({
      hue: 100,
      sat: 26,
      roles: { accent: '#b5547c', danger: '#b23a3a', success: '#3f8f4a', warning: '#a77a14', pro: '#7a58a8' },
    }),
  },
  summer: {
    id: 'summer',
    label: 'Summer',
    blurb: 'sand surfaces, sea teal accent',
    def: tinted({
      hue: 44,
      sat: 36,
      roles: { accent: '#0f8f9a', danger: '#b8402a', success: '#4a8a3a', warning: '#b07812', pro: '#7a5aa0' },
    }),
  },
}

export type Phase = 'dawn' | 'noon' | 'dusk' | 'night'

const PHASES: Record<Phase, Palette> = {
  dawn: {
    id: 'dawn',
    label: 'Dawn',
    blurb: 'peach and rose',
    def: tinted({
      hue: 18,
      sat: 34,
      roles: { accent: '#c2603f', danger: '#b23a3a', success: '#5f8a45', warning: '#b07a1a', pro: '#8a5a8a' },
    }),
  },
  noon: {
    id: 'noon',
    label: 'Noon',
    blurb: 'clear, cool daylight',
    def: tinted({
      hue: 205,
      sat: 16,
      roles: { accent: '#2f6fb0', danger: '#b8402f', success: '#3f8a4f', warning: '#a87a14', pro: '#6a5bb0' },
    }),
  },
  dusk: {
    id: 'dusk',
    label: 'Dusk',
    blurb: 'amber going to violet',
    def: tinted({
      hue: 285,
      sat: 22,
      roles: { accent: '#c47a2a', danger: '#c0453f', success: '#6a9a55', warning: '#c99a2a', pro: '#9a6ad0' },
    }),
  },
  night: {
    id: 'night',
    label: 'Night',
    blurb: 'deep indigo',
    def: tinted({
      hue: 232,
      sat: 30,
      roles: { accent: '#6f8ee0', danger: '#d0524f', success: '#5fb07a', warning: '#d0a040', pro: '#a08ae0' },
    }),
  },
}

export const phaseOf = (hour: number): Phase =>
  hour >= 5 && hour < 9 ? 'dawn' : hour >= 9 && hour < 16 ? 'noon' : hour >= 16 && hour < 20 ? 'dusk' : 'night'

export const seasonOf = (month: number): 'spring' | 'summer' | 'autumn' | 'snow' =>
  month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'autumn' : 'snow'

// Amber at first light, coral by midday, rose at dusk, violet by night.
const SUNSET_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 0x7c, 0x5c, 0xd6],
  [6, 0xd9, 0x90, 0x1a],
  [12, 0xd9, 0x59, 0x3d],
  [18, 0xc2, 0x41, 0x7a],
  [22, 0x7c, 0x5c, 0xd6],
  [24, 0x7c, 0x5c, 0xd6],
]

export const sunsetAccent = (hour: number, minute = 0): string => {
  const t = clamp(hour + minute / 60, 0, 24)
  const upper = SUNSET_STOPS.findIndex(s => s[0] >= t)
  const b = SUNSET_STOPS[Math.max(1, upper)]!
  const a = SUNSET_STOPS[Math.max(1, upper) - 1]!
  const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0])
  const mix = (i: 1 | 2 | 3) =>
    Math.round(a[i] + (b[i] - a[i]) * f)
      .toString(16)
      .padStart(2, '0')

  return `#${mix(1)}${mix(2)}${mix(3)}`
}

const SUNSET_BASE = (accent: string): Def => ({
  roles: { accent, danger: '#b8402f', success: '#4e8a4a', warning: '#a87a14', pro: '#7a5ac0' },
})

export const LOOKS: Record<string, Palette> = {
  paper: { id: 'paper', label: 'Warm paper', blurb: 'cream surfaces, ink-blue accent', def: PAPER },
  terminal: { id: 'terminal', label: 'Midnight terminal', blurb: 'near-black, neon green (dark only)', def: TERMINAL },
  nord: { id: 'nord', label: 'Nord frost', blurb: 'cool grays and blues, code theme nord', def: NORD },
  solarized: {
    id: 'solarized',
    label: 'Solarized',
    blurb: 'day and night pair, follows your mode',
    def: { roles: SOLAR_ROLES, light: SOLAR_LIGHT, dark: SOLAR_DARK, codeTheme: { light: 'solarized-light', dark: 'solarized-dark' } },
  },
  'solarized-day': {
    id: 'solarized-day',
    label: 'Solarized day',
    blurb: 'solarized light, always',
    def: { only: 'light', roles: SOLAR_ROLES, light: SOLAR_LIGHT, codeTheme: { light: 'solarized-light' } },
  },
  'solarized-night': {
    id: 'solarized-night',
    label: 'Solarized night',
    blurb: 'solarized dark, always',
    def: { only: 'dark', roles: SOLAR_ROLES, dark: SOLAR_DARK, codeTheme: { dark: 'solarized-dark' } },
  },
  sunset: { id: 'sunset', label: 'Sunset', blurb: 'accent drifts amber to violet through the day', def: SUNSET_BASE(sunsetAccent(12)) },
  contrast: { id: 'contrast', label: 'High contrast', blurb: 'black and white, stronger borders and focus rings', def: CONTRAST },
  muted: { id: 'muted', label: 'Muted dark', blurb: 'neutral grays, one steel-blue accent', def: MUTED },
  sepia: { id: 'sepia', label: 'Sepia', blurb: 'low blue light reading mode', def: SEPIA },
  colorblind: { id: 'colorblind', label: 'Colorblind safe', blurb: 'blue for success, orange for errors', def: COLORBLIND },
  ...SEASONS,
}

// Looks that change with the clock: the word the person types, and what it says.
export const DYNAMIC: Record<string, string> = {
  auto: 'dawn, noon, dusk or night by the hour, checked every 30 minutes',
  season: 'autumn, snow, spring or summer by the month (northern hemisphere)',
}

export const PHASE_PALETTES = PHASES
export const SEASON_PALETTES = SEASONS

export type Resolved = { id: string; label: string; def: Def }

// Turns what the person picked into a palette for this moment.
export const resolveLook = (id: string, when: Date): Resolved | undefined => {
  if (id === 'auto') {
    const p = PHASES[phaseOf(when.getHours())]

    return { id: `auto:${p.id}`, label: `Auto (${p.label.toLowerCase()})`, def: p.def }
  }

  if (id === 'season') {
    const p = SEASONS[seasonOf(when.getMonth())]!

    return { id: `season:${p.id}`, label: `Season (${p.label.toLowerCase()})`, def: p.def }
  }

  if (id === 'sunset') {
    const accent = sunsetAccent(when.getHours(), when.getMinutes())

    return { id: `sunset:${accent}`, label: 'Sunset', def: SUNSET_BASE(accent) }
  }
  const p = LOOKS[id]

  return p === undefined ? undefined : { id: p.id, label: p.label, def: p.def }
}

export const isLookName = (id: string) => id in LOOKS || id in DYNAMIC || id === 'sunset'

export const isDynamic = (id: string | null | undefined) => id === 'auto' || id === 'season' || id === 'sunset'

// One accent for each model family, laid over whichever look is on.
export const MODEL_ACCENTS: Record<string, string> = {
  opus: '#7b5bd1',
  sonnet: '#2f6fd6',
  haiku: '#1f9d8b',
  fable: '#c2417a',
}

export const familyOf = (model: string | undefined): string | null => {
  const m = /opus|sonnet|haiku|fable/i.exec(model ?? '')

  return m === null ? null : m[0].toLowerCase()
}

export const withAccent = (def: Def, accent: string): Def => {
  const swap = (mode: Def['light']) =>
    mode?.roles === undefined ? mode : { ...mode, roles: { ...mode.roles, accent } }

  return {
    ...def,
    roles: { ...(def.roles ?? {}), accent },
    ...(def.light === undefined ? {} : { light: swap(def.light) }),
    ...(def.dark === undefined ? {} : { dark: swap(def.dark) }),
  }
}

export const build = (r: Resolved) => makeColors({ label: r.label, ...r.def })

// Every palette this mod can produce, for the test that none is refused.
export const allResolved = (): Resolved[] => {
  const out: Resolved[] = []

  for (const id of Object.keys(LOOKS)) {
    out.push(resolveLook(id, new Date(2026, 5, 1, 12))!)
  }

  for (const p of Object.values(PHASES)) {
    out.push({ id: `phase:${p.id}`, label: p.label, def: p.def })
  }

  for (let h = 0; h < 24; h++) {
    out.push(resolveLook('sunset', new Date(2026, 5, 1, h, 30))!)
  }

  for (const [family, accent] of Object.entries(MODEL_ACCENTS)) {
    out.push({ id: `model:${family}`, label: family, def: { roles: { accent } } })

    for (const p of Object.values(LOOKS)) {
      out.push({ id: `${p.id}+${family}`, label: p.label, def: withAccent(p.def, accent) })
    }
  }

  return out
}
