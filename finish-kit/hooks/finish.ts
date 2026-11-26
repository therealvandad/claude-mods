import type { ThemeBackdrop, ThemeMessageRule, ThemeSetArgs, ThemeStyle } from 'claude-code'

import { hsl, mix, normalizeHex } from './color'
import { makeColors } from './make-colors.js'

// A "finish" is the whole look the studio can build. Pure data and helpers: no `$` here, so the tests can run
// every combination through makeColors and read its problem lines.

export const GRAYS = ['neutral', 'warm', 'cool'] as const
export const TONES = ['standard', 'off-white', 'true-black', 'sepia'] as const
export const CONTRASTS = ['normal', 'high'] as const
export const GROUNDS = ['none', 'band', 'paper', 'noise', 'glass'] as const
export const CARDS = ['default', 'matte', 'glossy'] as const
export const BORDERS = ['default', 'hairline', 'bold'] as const
export const SHAPES = ['default', 'pill', 'square'] as const
export const HEADINGS = ['default', 'serif'] as const
export const WEIGHTS = ['default', 'hierarchy'] as const

export type Gray = (typeof GRAYS)[number]
export type Tone = (typeof TONES)[number]
export type Contrast = (typeof CONTRASTS)[number]
export type Ground = (typeof GROUNDS)[number]
export type Card = (typeof CARDS)[number]
export type Border = (typeof BORDERS)[number]
export type Shape = (typeof SHAPES)[number]
export type Headings = (typeof HEADINGS)[number]
export type Weights = (typeof WEIGHTS)[number]

export type Finish = {
  gray: Gray
  tone: Tone
  accent: string
  neutralFirst: boolean
  contrast: Contrast
  ground: Ground
  card: Card
  border: Border
  shape: Shape
  headings: Headings
  weights: Weights
  hand: boolean
}

export const DEFAULT_ACCENT = '#3b6fd4'

export const DEFAULT_FINISH: Finish = {
  gray: 'neutral',
  tone: 'standard',
  accent: DEFAULT_ACCENT,
  neutralFirst: true,
  contrast: 'normal',
  ground: 'none',
  card: 'default',
  border: 'default',
  shape: 'default',
  headings: 'default',
  weights: 'default',
  hand: false,
}

/** Named accents for the pane's buttons. */
export const ACCENT_CHOICES: readonly { id: string; label: string; hex: string }[] = [
  { id: 'ink', label: 'Ink blue', hex: '#3b6fd4' },
  { id: 'teal', label: 'Teal', hex: '#2f9a96' },
  { id: 'green', label: 'Green', hex: '#3f9b6e' },
  { id: 'amber', label: 'Amber', hex: '#d9961a' },
  { id: 'coral', label: 'Coral', hex: '#e2603f' },
  { id: 'rose', label: 'Rose', hex: '#d0688c' },
  { id: 'violet', label: 'Violet', hex: '#7b5ea7' },
  { id: 'slate', label: 'Slate', hex: '#5d6f86' },
]

// ---- presets (each is a few choices on top of the current draft) ----

export type Preset = { label: string; blurb: string; set: Partial<Finish> }

export const PRESETS: Record<string, Preset> = {
  quiet: {
    label: 'Quiet gray',
    blurb: 'Neutral grays carry the screen; the accent stays small.',
    set: { gray: 'neutral', tone: 'standard', neutralFirst: true, ground: 'none', card: 'matte', border: 'hairline', shape: 'default', headings: 'default', weights: 'hierarchy', contrast: 'normal', hand: false },
  },
  'warm-paper': {
    label: 'Warm paper',
    blurb: 'Warm off-white, paper grain, serif headings.',
    set: { gray: 'warm', tone: 'off-white', neutralFirst: true, ground: 'paper', card: 'matte', border: 'hairline', shape: 'default', headings: 'serif', weights: 'hierarchy', contrast: 'normal', hand: false },
  },
  oled: {
    label: 'True black',
    blurb: 'Black page for OLED, a fine noise, cool grays.',
    set: { gray: 'cool', tone: 'true-black', neutralFirst: true, ground: 'noise', card: 'matte', border: 'hairline', shape: 'default', headings: 'default', weights: 'hierarchy', contrast: 'normal', hand: false },
  },
  sepia: {
    label: 'Sepia reader',
    blurb: 'A reading mode: sepia page, serif headings, calm borders.',
    set: { gray: 'warm', tone: 'sepia', neutralFirst: true, ground: 'none', card: 'matte', border: 'hairline', shape: 'default', headings: 'serif', weights: 'hierarchy', contrast: 'normal', hand: false },
  },
  glass: {
    label: 'Glass studio',
    blurb: 'Cool grays over soft colour, frosted panes, glossy pills.',
    set: { gray: 'cool', tone: 'standard', neutralFirst: false, ground: 'glass', card: 'glossy', border: 'hairline', shape: 'pill', headings: 'default', weights: 'default', contrast: 'normal', hand: false },
  },
  contrast: {
    label: 'High contrast',
    blurb: 'Strong text, bold outlines, square corners.',
    set: { gray: 'neutral', tone: 'standard', neutralFirst: true, ground: 'none', card: 'matte', border: 'bold', shape: 'square', headings: 'default', weights: 'hierarchy', contrast: 'high', hand: false },
  },
  notes: {
    label: 'Handwritten notes',
    blurb: 'Warm paper with your own messages in a handwriting font.',
    set: { gray: 'warm', tone: 'off-white', neutralFirst: true, ground: 'paper', card: 'glossy', border: 'hairline', shape: 'default', headings: 'serif', weights: 'default', contrast: 'normal', hand: true },
  },
}

export const PRESET_IDS = Object.keys(PRESETS)

export const withPreset = (f: Finish, id: string): Finish => {
  const p = PRESETS[id]

  return p === undefined ? f : { ...f, ...p.set }
}

// ---- choices typed as words ----

type Key = 'gray' | 'tone' | 'contrast' | 'ground' | 'card' | 'border' | 'shape' | 'headings' | 'weights'

export const CHOICES: Record<Key, readonly string[]> = {
  gray: GRAYS,
  tone: TONES,
  contrast: CONTRASTS,
  ground: GROUNDS,
  card: CARDS,
  border: BORDERS,
  shape: SHAPES,
  headings: HEADINGS,
  weights: WEIGHTS,
}

// A bare word that means exactly one choice, so `/fnapply warm paper` works.
const BARE: Record<string, [Key, string]> = {
  neutral: ['gray', 'neutral'],
  warm: ['gray', 'warm'],
  cool: ['gray', 'cool'],
  offwhite: ['tone', 'off-white'],
  'off-white': ['tone', 'off-white'],
  oled: ['tone', 'true-black'],
  trueblack: ['tone', 'true-black'],
  'true-black': ['tone', 'true-black'],
  sepia: ['tone', 'sepia'],
  highcontrast: ['contrast', 'high'],
  'high-contrast': ['contrast', 'high'],
  band: ['ground', 'band'],
  paper: ['ground', 'paper'],
  noise: ['ground', 'noise'],
  glass: ['ground', 'glass'],
  matte: ['card', 'matte'],
  glossy: ['card', 'glossy'],
  hairline: ['border', 'hairline'],
  bold: ['border', 'bold'],
  pill: ['shape', 'pill'],
  square: ['shape', 'square'],
  serif: ['headings', 'serif'],
  hierarchy: ['weights', 'hierarchy'],
}

const onOff = (word: string): boolean | null => {
  if (word === 'on' || word === 'yes' || word === 'true') {
    return true
  }

  return word === 'off' || word === 'no' || word === 'false' ? false : null
}

export type Parsed = { finish: Finish; errors: string[]; changed: string[]; preset: string | null; accentList: string | null }

/**
 * Reads `key=value` words (and a few bare words) on top of a finish. Strict: an unknown key or value is an error and
 * changes nothing. `accents=a,b,c` is returned as a list for the caller to pick from; `accent=#hex` sets it directly.
 */
export const parseOpts = (raw: string, base: Finish): Parsed => {
  const words = raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w !== '')
    .slice(0, 40)
  let finish: Finish = { ...base }
  const errors: string[] = []
  const changed: string[] = []
  let preset: string | null = null
  let accentList: string | null = null
  const setKey = (key: Key, value: string) => {
    if (!CHOICES[key].includes(value)) {
      errors.push(`${key} must be ${CHOICES[key].join(', ')} (not "${value}")`)

      return
    }
    finish = { ...finish, [key]: value } as Finish
    changed.push(`${key}=${value}`)
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!

    if (word === 'preset') {
      const id = words[++i] ?? ''

      if (PRESETS[id] === undefined) {
        errors.push(`preset must be one of ${PRESET_IDS.join(', ')}`)
      } else {
        finish = withPreset(finish, id)
        preset = id
        changed.push(`preset=${id}`)
      }
      continue
    }

    const eq = word.indexOf('=')

    if (eq < 0) {
      const bare = BARE[word]

      if (word === 'hand' || word === 'handwriting') {
        finish = { ...finish, hand: true }
        changed.push('hand=on')
      } else if (bare === undefined) {
        errors.push(`"${word}" is not an option`)
      } else {
        setKey(bare[0], bare[1])
      }
      continue
    }
    const key = word.slice(0, eq)
    const value = word.slice(eq + 1)

    if (key === 'preset') {
      if (PRESETS[value] === undefined) {
        errors.push(`preset must be one of ${PRESET_IDS.join(', ')}`)
      } else {
        finish = withPreset(finish, value)
        preset = value
        changed.push(`preset=${value}`)
      }
    } else if (key in CHOICES) {
      setKey(key as Key, value)
    } else if (key === 'accent') {
      const hex = normalizeHex(value)

      if (hex === null) {
        errors.push(`accent must be a hex colour such as #3b6fd4 (not "${value}")`)
      } else {
        finish = { ...finish, accent: hex }
        changed.push(`accent=${hex}`)
      }
    } else if (key === 'accents') {
      accentList = value.slice(0, 600)
    } else if (key === 'neutral' || key === 'hand') {
      const b = onOff(value)

      if (b === null) {
        errors.push(`${key} must be on or off`)
      } else {
        finish = key === 'neutral' ? { ...finish, neutralFirst: b } : { ...finish, hand: b }
        changed.push(`${key}=${b ? 'on' : 'off'}`)
      }
    } else {
      errors.push(`"${key}" is not an option`)
    }
  }

  return { finish: errors.length > 0 ? base : finish, errors, changed, preset, accentList }
}

/** A stored or typed finish, trusted for nothing. Null when it is not a finish. */
export const parseFinish = (value: unknown): Finish | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const v = value as Record<string, unknown>
  const pick = <T extends string>(list: readonly T[], x: unknown, dflt: T): T => list.find(i => i === x) ?? dflt
  const accent = typeof v.accent === 'string' ? normalizeHex(v.accent) : null

  return {
    gray: pick(GRAYS, v.gray, 'neutral'),
    tone: pick(TONES, v.tone, 'standard'),
    accent: accent ?? DEFAULT_ACCENT,
    neutralFirst: v.neutralFirst !== false,
    contrast: pick(CONTRASTS, v.contrast, 'normal'),
    ground: pick(GROUNDS, v.ground, 'none'),
    card: pick(CARDS, v.card, 'default'),
    border: pick(BORDERS, v.border, 'default'),
    shape: pick(SHAPES, v.shape, 'default'),
    headings: pick(HEADINGS, v.headings, 'default'),
    weights: pick(WEIGHTS, v.weights, 'default'),
    hand: v.hand === true,
  }
}

export const describe = (f: Finish): string => {
  const parts = [`${f.gray} grays`, f.tone === 'standard' ? 'standard tone' : f.tone, `accent ${f.accent}`]

  parts.push(f.neutralFirst ? 'neutral-first roles' : 'vivid roles')

  if (f.contrast === 'high') {
    parts.push('high contrast')
  }

  if (f.ground !== 'none') {
    parts.push(f.ground === 'band' ? 'gradient header band' : `${f.ground} backdrop`)
  }

  if (f.card !== 'default') {
    parts.push(`${f.card} cards`)
  }

  if (f.border !== 'default') {
    parts.push(`${f.border} borders`)
  }

  if (f.shape !== 'default') {
    parts.push(`${f.shape} corners`)
  }

  if (f.headings === 'serif') {
    parts.push('serif headings')
  }

  if (f.weights === 'hierarchy') {
    parts.push('weight hierarchy')
  }

  if (f.hand) {
    parts.push('handwriting for your messages')
  }

  return parts.join(' · ')
}

// ---- the greys, as hex, for the theme and for the previews ----

export type Anchors = { s0: string; s1: string; s2: string; t1: string; t2: string; t3: string }
export type Roles = { accent: string; danger: string; success: string; warning: string; pro: string }

const HUES: Record<Gray, { hue: number; sat: number }> = {
  neutral: { hue: 0, sat: 0 },
  warm: { hue: 36, sat: 12 },
  cool: { hue: 214, sat: 10 },
}

const lightAnchors = (f: Finish): Anchors => {
  if (f.tone === 'sepia') {
    return { s0: hsl(38, 34, 84), s1: hsl(38, 36, 89), s2: hsl(38, 38, 93), t1: hsl(30, 38, 14), t2: hsl(30, 30, 25), t3: hsl(30, 24, 32) }
  }

  if (f.tone === 'off-white') {
    // Warm and never pure white: the lightest surface is a cream.
    return { s0: hsl(40, 30, 90), s1: hsl(40, 32, 93), s2: hsl(40, 34, 96), t1: hsl(35, 30, 12), t2: hsl(35, 24, 24), t3: hsl(35, 18, 31) }
  }
  const { hue, sat } = HUES[f.gray]
  const ts = sat === 0 ? 0 : 1

  return {
    s0: hsl(hue, sat, 87),
    s1: hsl(hue, sat, 91),
    s2: hsl(hue, sat, 95),
    t1: hsl(hue, 35 * ts, 11),
    t2: hsl(hue, 25 * ts, 24),
    t3: hsl(hue, 18 * ts, 31),
  }
}

const darkAnchors = (f: Finish): Anchors => {
  if (f.tone === 'sepia') {
    return { s0: hsl(30, 22, 8), s1: hsl(30, 22, 11), s2: hsl(30, 22, 14), t1: hsl(36, 38, 88), t2: hsl(34, 28, 76), t3: hsl(32, 22, 66) }
  }
  const { hue, sat } = HUES[f.gray]
  const ts = sat === 0 ? 0 : 1
  const text = { t1: hsl(hue, 40 * ts, 93), t2: hsl(hue, 25 * ts, 80), t3: hsl(hue, 18 * ts, 69) }

  if (f.tone === 'true-black') {
    return { s0: '#000000', s1: hsl(hue, sat * 0.5, 5), s2: hsl(hue, sat * 0.5, 9), ...text }
  }

  return { s0: hsl(hue, sat, 8), s1: hsl(hue, sat, 11), s2: hsl(hue, sat, 14), ...text }
}

// High contrast: text moves toward the strongest colour and the surfaces drift apart a little.
const sharpen = (a: Anchors, strongest: string, page: string): Anchors => ({
  s0: a.s0,
  s1: mix(a.s1, page, 0.1),
  s2: mix(a.s2, page, 0.1),
  t1: mix(a.t1, strongest, 0.6),
  t2: mix(a.t2, strongest, 0.5),
  t3: mix(a.t3, strongest, 0.4),
})

export const anchorsOf = (f: Finish): { light: Anchors; dark: Anchors } => {
  const light = lightAnchors(f)
  const dark = darkAnchors(f)

  return f.contrast === 'high'
    ? { light: sharpen(light, '#000000', '#f4f4f4'), dark: sharpen(dark, '#ffffff', '#000000') }
    : { light, dark }
}

export const rolesOf = (f: Finish): Roles =>
  f.neutralFirst
    ? { accent: f.accent, danger: '#a8514a', success: '#5f7d55', warning: '#9a7a3a', pro: '#7a6a90' }
    : { accent: f.accent, danger: '#c0392b', success: '#2e8b4f', warning: '#b87a10', pro: '#7a4fc4' }

type Def = Omit<Parameters<typeof makeColors>[0], 'label'>

export const defOf = (f: Finish): Def => {
  const a = anchorsOf(f)

  return {
    roles: rolesOf(f),
    light: {
      gray: {
        anchors: { 'surface-0': a.light.s0, 'surface-1': a.light.s1, 'surface-2': a.light.s2, 'text-primary': a.light.t1, 'text-secondary': a.light.t2, 'text-muted': a.light.t3 },
      },
    },
    dark: {
      gray: {
        anchors: {
          'surface-0': a.dark.s0,
          'surface-1': a.dark.s1,
          'surface-2': a.dark.s2,
          'surface-3': a.dark.s2,
          'text-primary': a.dark.t1,
          'text-secondary': a.dark.t2,
          'text-muted': a.dark.t3,
        },
      },
    },
    ...(f.contrast === 'high' ? { contrast: 'more' as const } : {}),
  }
}

// ---- the rows of the conversation (idea 9, 10, 13, 24, 25, 26, 27) ----

const radii = (shape: Shape): { user: number; tool: number } | undefined =>
  shape === 'pill' ? { user: 22, tool: 16 } : shape === 'square' ? { user: 0, tool: 0 } : undefined

export const styleOf = (f: Finish): ThemeStyle | undefined => {
  const style: ThemeStyle = {}
  const r = radii(f.shape)
  const hasBox = f.card !== 'default' || f.border !== 'default' || r !== undefined || f.contrast === 'high'
  const border =
    f.contrast === 'high'
      ? { borderColor: 'border-stronger' as const, borderWidth: 2 }
      : f.border === 'hairline'
        ? { borderColor: 'border' as const, borderWidth: 1 }
        : f.border === 'bold'
          ? { borderColor: 'border-strong' as const, borderWidth: 3 }
          : {}
  const card: ThemeMessageRule =
    f.card === 'glossy'
      ? {
          backgroundColor: 'surface-1',
          fill: { gradient: { stops: [{ at: 0, color: 'surface-2' }, { at: 1, color: 'surface-1' }], angle: 180 } },
          shadow: { y: 2, blur: 10, color: '#00000033' },
        }
      : f.card === 'matte'
        ? { backgroundColor: 'surface-1', shadow: 'none' }
        : {}

  if (hasBox) {
    // The person's bubble and the tool rows. Claude's replies stay unboxed: a box round every run of words is heavy.
    const hasFill = f.card !== 'default'
    const user: ThemeMessageRule = { ...card, ...border, ...(hasFill ? { color: 'text-primary' as const } : {}), ...(r === undefined ? {} : { radius: r.user }) }

    style.UserMessage = user
    style.ToolUse = {
      ...(f.card === 'default' ? {} : { backgroundColor: 'surface-1' as const, color: 'text-primary' as const }),
      ...border,
      ...(f.card === 'glossy' ? { shadow: { y: 1, blur: 6, color: '#00000026' } } : {}),
      ...(r === undefined ? {} : { radius: r.tool }),
    }
  }

  if (f.weights === 'hierarchy') {
    style.Heading = { ...style.Heading, fontWeight: 'bold' }
    style.Text = { ...style.Text, fontWeight: 'regular' }
  }

  if (f.headings === 'serif') {
    style.Heading = { ...style.Heading, fontFamily: ['serif'] }
  }

  if (f.hand) {
    // Only the person's own messages: the closest thing to "a font for notes" the style API reaches.
    style.UserMessage = { ...style.UserMessage, fontFamily: ['cursive'], fontSize: 17, lineHeight: 26 }
  }

  return Object.keys(style).length === 0 ? undefined : style
}

// ---- the ground behind the conversation (idea 5, 6, 8, 18) ----

export const SCENE_IDS = ['paper', 'noise', 'glass'] as const
export type SceneId = (typeof SCENE_IDS)[number]

export const backdropOf = (f: Finish): ThemeBackdrop | undefined => {
  switch (f.ground) {
    case 'band':
      // A header band: the accent's tint at the top, fading into the page by a fifth of the way down.
      return { gradient: { angle: 180, stops: [{ at: 0, color: 'bg-accent' }, { at: 0.22, color: 'surface-0' }, { at: 1, color: 'surface-0' }] } }
    case 'paper':
      return { scene: 'paper', glass: { blur: 6, opacity: 0.55 } }
    case 'noise':
      return { scene: 'noise', glass: { blur: 4, opacity: 0.6 } }
    case 'glass':
      return { scene: 'glass', glass: { blur: 28, opacity: 0.5 } }
    default:
      return undefined
  }
}

// ---- the whole theme ----

export type Resolved = { args: ThemeSetArgs | undefined; refusal: string | null; notes: string[] }

const REFUSED = "Desktop won't paint"

/** One theme from a finish. Pure: no engine call. A refusal means makeColors threw or Desktop would ignore the theme. */
export const resolve = (f: Finish): Resolved => {
  const notes: string[] = []
  const args: ThemeSetArgs = {}

  try {
    const { theme, problems } = makeColors({ label: 'Finish', ...defOf(f) })
    const refused = problems.find(line => line.startsWith(REFUSED))

    if (refused !== undefined) {
      return { args: undefined, refusal: refused, notes }
    }
    notes.push(...problems)
    args.colors = theme
  } catch (error) {
    return { args: undefined, refusal: String(error), notes }
  }
  const style = styleOf(f)
  const backdrop = backdropOf(f)

  if (style !== undefined) {
    args.style = style
  }

  if (backdrop !== undefined) {
    args.backdrop = backdrop
  }

  return { args, refusal: null, notes }
}

/** What the studio shows in previews only, and why: shown in the pane and by /fn. */
export const PREVIEW_ONLY: readonly { n: number; what: string; why: string }[] = [
  { n: 7, what: 'Soft inner shadows on charts', why: 'the theme cannot restyle other mods\' charts' },
  { n: 11, what: 'One-colour icons', why: 'the theme has no icon colour; the app draws its own icons' },
  { n: 12, what: 'Duotone empty-state drawings', why: 'empty states belong to the app and to other mods; drawn in the previews only' },
  { n: 15, what: 'Gradient progress bars', why: 'the theme cannot restyle other mods\' bars' },
  { n: 16, what: 'Glow on the active element only', why: 'the theme cannot tell which element is active' },
  { n: 17, what: 'Dimmed inactive panes', why: '$.ui.open has no dim option' },
  { n: 19, what: 'Hue-family chart palettes', why: 'data only: other mods keep their own chart colours' },
  { n: 30, what: 'One icon stroke width', why: 'the app and other mods draw their own icons' },
]

export const SKIPPED: readonly { n: number; what: string; why: string }[] = [
  { n: 28, what: 'Code ligatures', why: 'the theme style API picks a generic font family only, with no font features' },
  { n: 29, what: 'A slashed-zero number font', why: 'same: no way to name a font or turn on a font feature' },
]
