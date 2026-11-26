// Pure colour helpers for finish-kit. No `$` in here, so the tests can run them directly.

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))

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

export const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

export const hexOf = (rgb: readonly number[]): string =>
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

// ---- idea 3: an accent from a pasted list of hex colours ----

/** Every `#rgb` / `#rrggbb` in a pasted list (spaces, commas, semicolons, bars, newlines). At most 64 are kept. */
export const parseHexList = (raw: string): { colors: string[]; ignored: number } => {
  const tokens = raw
    .split(/[\s,;|]+/)
    .filter(t => t !== '')
    .slice(0, 200)
  const colors: string[] = []
  let ignored = 0

  for (const token of tokens) {
    const hex = normalizeHex(token)

    if (hex === null) {
      ignored += 1
    } else if (colors.length < 64) {
      colors.push(hex)
    } else {
      ignored += 1
    }
  }

  return { colors, ignored }
}

/**
 * The most saturated mid-lightness colour of a list (lightness 30 to 70). With none in that band it falls back to
 * the most saturated colour whose lightness is nearest the middle, and says so. Null for an empty list.
 */
export const pickAccent = (colors: readonly string[]): { hex: string; isMid: boolean } | null => {
  const scored = colors.map(hex => ({ hex, ...hslOf(hex) }))
  const mid = scored.filter(c => c.l >= 30 && c.l <= 70)
  const pool = mid.length > 0 ? mid : scored

  if (pool.length === 0) {
    return null
  }
  const best = [...pool].sort((a, b) => b.s - a.s || Math.abs(a.l - 50) - Math.abs(b.l - 50))[0]!

  if (mid.length > 0) {
    return { hex: best.hex, isMid: true }
  }
  // Nothing mid-lightness: keep the most saturated hue and pull its lightness into the band so the theme can use it.
  return { hex: hsl(best.h, best.s, clamp(best.l, 30, 70)), isMid: false }
}

// ---- idea 4: the accent of the month (used only when a command asks for it) ----

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

export const MONTH_ACCENTS: readonly string[] = [
  '#3a6ea5',
  '#7b5ea7',
  '#3f9b6e',
  '#d0688c',
  '#2f9a96',
  '#d9961a',
  '#e2603f',
  '#d4802c',
  '#a86a2f',
  '#c4562f',
  '#8a6a4c',
  '#b03a48',
]

export const monthAccent = (monthIndex: number): string => MONTH_ACCENTS[((Math.floor(monthIndex) % 12) + 12) % 12]!

// ---- idea 20: colour-blindness simulation (an approximation, not a medical test) ----

export type Cvd = 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia'
export const CVDS: readonly Cvd[] = ['none', 'deuteranopia', 'protanopia', 'tritanopia']

type Matrix = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied to linear RGB.
const MATRICES: Record<Exclude<Cvd, 'none'>, Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

const toLinear = (v: number): number => {
  const c = v / 255

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const fromLinear = (c: number): number => {
  const v = clamp(c, 0, 1)

  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
}

/** How a colour is seen with the given condition, by the standard matrices. `none` returns the colour unchanged. */
export const simulate = (hex: string, kind: Cvd): string => {
  if (kind === 'none') {
    return hex
  }
  const m = MATRICES[kind]
  const [r, g, b] = rgbOf(hex).map(toLinear) as [number, number, number]

  return hexOf(m.map(row => fromLinear(row[0] * r + row[1] * g + row[2] * b)))
}

/** WCAG-style relative luminance. */
export const luminance = (hex: string): number => {
  const [r, g, b] = rgbOf(hex).map(toLinear) as [number, number, number]

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a)
  const lb = luminance(b)

  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// ---- idea 19: hue-family chart palettes (data only) ----

export const FAMILIES: Record<string, number> = { blue: 215, teal: 178, green: 140, amber: 38, rose: 345, violet: 268 }

/** `n` shades of one hue, dark to light, tuned for light or dark pages. */
export const familyPalette = (hue: number, n: number, mode: 'light' | 'dark'): string[] => {
  const count = Math.max(2, Math.min(9, Math.round(n)))
  const lo = mode === 'light' ? 30 : 40
  const hi = mode === 'light' ? 74 : 82

  return Array.from({ length: count }, (_, i) => hsl(hue, mode === 'light' ? 62 : 58, lo + ((hi - lo) * i) / (count - 1)))
}

/** The distance between two palette neighbours in CIE-ish lightness, to show the steps stay distinct. */
export const lightnessSteps = (colors: readonly string[]): number[] => colors.slice(1).map((c, i) => hslOf(c).l - hslOf(colors[i]!).l)
