// A theme from one logo colour. Pure: the only engine call (`$.theme.set`) is made by register.tsx, once per command.
import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

type Def = Omit<Parameters<typeof makeColors>[0], 'label'>

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

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

export const hsl = (h: number, s: number, l: number): string => {
  const sat = clamp(s, 0, 100) / 100
  const lig = clamp(l, 0, 100) / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')

  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

/** The definition makeColors takes: the logo colour as the accent role, greys that lean a little toward its hue. */
export const logoDef = (hex: string): Def => {
  const { h, s } = hslOf(hex)
  const sat = clamp(s * 0.3, 6, 22)

  return {
    roles: { accent: hex, danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
    light: {
      gray: { anchors: { 'surface-0': hsl(h, sat, 88), 'surface-1': hsl(h, sat, 92), 'surface-2': hsl(h, sat, 96), 'text-primary': hsl(h, 30, 11), 'text-secondary': hsl(h, 22, 24), 'text-muted': hsl(h, 16, 32) } },
    },
    dark: {
      gray: { anchors: { 'surface-0': hsl(h, sat, 8), 'surface-1': hsl(h, sat, 11), 'surface-2': hsl(h, sat, 14), 'surface-3': hsl(h, sat, 14), 'text-primary': hsl(h, 30, 93), 'text-secondary': hsl(h, 20, 80), 'text-muted': hsl(h, 14, 68) } },
    },
  }
}

export type Swatch = { label: string; hex: string }

/** The colours shown in the preview strip, straight from the definition (not read back from the made theme). */
export const swatchesOf = (hex: string): Swatch[] => {
  const d = logoDef(hex)
  const l = d.light?.gray?.anchors
  const k = d.dark?.gray?.anchors

  return [
    { label: 'accent', hex },
    { label: 'light page', hex: l?.['surface-0'] ?? '#ffffff' },
    { label: 'light text', hex: l?.['text-primary'] ?? '#000000' },
    { label: 'dark page', hex: k?.['surface-0'] ?? '#000000' },
    { label: 'dark text', hex: k?.['text-primary'] ?? '#ffffff' },
    { label: 'danger', hex: '#b3392f' },
    { label: 'success', hex: '#4e7d3a' },
    { label: 'warning', hex: '#a86f14' },
  ]
}

export type Built = { args: ThemeSetArgs | undefined; refusal: string | null; notes: string[] }

const REFUSED = "Desktop won't paint"

/** Works out the whole theme for a logo colour. Never throws: a refusal is a value. */
export const buildTheme = (hex: string): Built => {
  try {
    const { theme, problems } = makeColors({ label: 'Logo colour', ...logoDef(hex) })
    const refused = problems.find(line => line.startsWith(REFUSED))

    return refused === undefined ? { args: { colors: theme }, refusal: null, notes: problems } : { args: undefined, refusal: refused, notes: [] }
  } catch (error) {
    return { args: undefined, refusal: String(error), notes: [] }
  }
}
