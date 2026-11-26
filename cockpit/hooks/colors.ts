// Three optional color themes. The app builds the full palette from a few anchors per mode.
import { DEFAULT_OPTIONS, isPremium, LOOKS, PREMIUM_NAMES, premiumColors, premiumTheme } from './premium'
import type { LookOptions, PremiumName } from './premium'
import { makeColors } from './make-colors'

export type MoreName = 'nord' | 'forest' | 'ocean' | 'rose' | 'mocha' | 'sunset' | 'lavender' | 'graphite' | 'mint' | 'berry' | 'sand' | 'solar'
export type ColorName = 'app' | PremiumName | 'paper' | 'midnight' | 'contrast' | MoreName

export const COLOR_NAMES: readonly ColorName[] = ['app', ...PREMIUM_NAMES, 'paper', 'midnight', 'contrast', 'nord', 'forest', 'ocean', 'rose', 'mocha', 'sunset', 'lavender', 'graphite', 'mint', 'berry', 'sand', 'solar']

export const colorLabel = (name: ColorName): string =>
  name === 'app' ? 'App colors' : isPremium(name) ? LOOKS[name].label : name === 'contrast' ? 'High contrast' : `${name.charAt(0).toUpperCase()}${name.slice(1)}`

// Each follows the app's light or dark mode. light: page, card, panel, then three text shades;
// dark: page, card, panel, menu, then three text shades.
type Seed = { label: string; accent: [string, string]; light: string[]; dark: string[] }

const MORE: Record<MoreName, Seed> = {
  nord: { label: 'Nord', accent: ['#4c6a92', '#88c0d0'], light: ['#e5e9f0', '#eceff4', '#f8f9fb', '#2e3440', '#434c5e', '#4c566a'], dark: ['#20242d', '#272c36', '#2e3440', '#353c4a', '#eceff4', '#d8dee9', '#b8c2d3'] },
  forest: { label: 'Forest', accent: ['#2f6b45', '#7fc796'], light: ['#e6ede4', '#eef3ec', '#f8faf7', '#1d2b21', '#38493d', '#4c5f52'], dark: ['#101a14', '#17231b', '#1e2d23', '#27382c', '#e6f0e8', '#bcd0c1', '#9ab3a1'] },
  ocean: { label: 'Ocean', accent: ['#0f6b7d', '#5fd0e0'], light: ['#e1eef1', '#ebf4f6', '#f8fbfc', '#10282f', '#2c474f', '#436069'], dark: ['#0a1a20', '#0f242c', '#153038', '#1c3d47', '#e2f4f7', '#b4d6dd', '#91bac3'] },
  rose: { label: 'Rose', accent: ['#a63a66', '#f29ab9'], light: ['#f4e6eb', '#f8eef1', '#fdf8f9', '#34202a', '#553a46', '#6b4d5a'], dark: ['#1f141a', '#291b22', '#34232c', '#412c37', '#f8e9ee', '#dcc0cb', '#c2a1ad'] },
  mocha: { label: 'Mocha', accent: ['#8a5a2b', '#e0af7a'], light: ['#ede4da', '#f3ece4', '#faf7f3', '#2d2118', '#4a3a2e', '#5f4d3f'], dark: ['#1c1511', '#251d17', '#2f251e', '#3b2f26', '#f2e8de', '#d5c3b1', '#b9a491'] },
  sunset: { label: 'Sunset', accent: ['#b1481f', '#ffa26b'], light: ['#f6e8e0', '#faf0ea', '#fefaf7', '#37201a', '#583a31', '#704d42'], dark: ['#1d1420', '#281b2c', '#342338', '#412c46', '#fbeae2', '#e0c3c0', '#c5a5aa'] },
  lavender: { label: 'Lavender', accent: ['#6247aa', '#b9a5f5'], light: ['#ebe8f4', '#f2f0f9', '#fbfaff', '#261f3d', '#453c61', '#594f77'], dark: ['#16131f', '#1e1a2a', '#272235', '#302a41', '#eeeaf9', '#cbc3e0', '#ada4c6'] },
  graphite: { label: 'Graphite', accent: ['#3d3d3d', '#d0d0d0'], light: ['#e6e6e6', '#efefef', '#fafafa', '#1a1a1a', '#3a3a3a', '#505050'], dark: ['#121212', '#1a1a1a', '#222222', '#2a2a2a', '#ededed', '#c6c6c6', '#a8a8a8'] },
  mint: { label: 'Mint', accent: ['#0f7a5f', '#6fdcc0'], light: ['#e2f1ec', '#edf7f3', '#f8fdfb', '#10281f', '#2b463b', '#425f53'], dark: ['#0c1916', '#11231e', '#172e27', '#1e3a31', '#e4f6f0', '#b8d9cd', '#96bcb0'] },
  berry: { label: 'Berry', accent: ['#8e2a8b', '#e79be4'], light: ['#f2e6f2', '#f7eef7', '#fdf9fd', '#2f1830', '#50344f', '#664765'], dark: ['#1c1020', '#25172a', '#2f1e35', '#3a2641', '#f6e8f7', '#d9bddc', '#bd9fc1'] },
  sand: { label: 'Sand', accent: ['#7a5c12', '#e3c56a'], light: ['#eee9da', '#f5f1e5', '#fcfaf3', '#2b2616', '#47412c', '#5b553f'], dark: ['#191710', '#222016', '#2c291d', '#363225', '#f3efe0', '#d3cdb7', '#b6b09a'] },
  solar: { label: 'Solar', accent: ['#1c6ea4', '#6cb6e8'], light: ['#eee8d5', '#f5efdc', '#fdf6e3', '#073642', '#35535c', '#4a656d'], dark: ['#00212b', '#042b36', '#083642', '#0e414e', '#eee8d5', '#c3c9c3', '#a1b0ae'] },
}

const build = (name: MoreName) => {
  const t = MORE[name]
  const at = (list: string[], i: number) => (list[i] ?? '#000000') as `#${string}`

  return makeColors({
    label: t.label,
    roles: { accent: t.accent[0] as `#${string}`, danger: '#b3392f', success: '#3f7d4a', warning: '#9a6410', pro: '#6d4f94' },
    light: {
      gray: {
        anchors: { 'surface-0': at(t.light, 0), 'surface-1': at(t.light, 1), 'surface-2': at(t.light, 2), 'text-primary': at(t.light, 3), 'text-secondary': at(t.light, 4), 'text-muted': at(t.light, 5) },
      },
    },
    dark: {
      roles: { accent: t.accent[1] as `#${string}`, danger: '#ff8a80', success: '#8fd19a', warning: '#e8bf6a', pro: '#c3a6ee' },
      gray: {
        anchors: { 'surface-0': at(t.dark, 0), 'surface-1': at(t.dark, 1), 'surface-2': at(t.dark, 2), 'surface-3': at(t.dark, 3), 'text-primary': at(t.dark, 4), 'text-secondary': at(t.dark, 5), 'text-muted': at(t.dark, 6) },
      },
    },
  })
}

export const colorName = (raw: unknown): ColorName => (COLOR_NAMES.includes(raw as ColorName) ? (raw as ColorName) : 'app')

const paper = () =>
  makeColors({
    label: 'Paper',
    roles: { accent: '#2f5d8c', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
    light: {
      gray: {
        anchors: { 'surface-0': '#efe6d3', 'surface-1': '#f4ecdc', 'surface-2': '#faf5e9', 'text-primary': '#2a241d', 'text-secondary': '#544a3d', 'text-muted': '#6a5f50' },
      },
    },
    dark: {
      gray: {
        anchors: { 'surface-0': '#1f1a15', 'surface-1': '#28221b', 'surface-2': '#312a22', 'surface-3': '#3a3229', 'text-primary': '#f0e7d7', 'text-secondary': '#cfc4b2', 'text-muted': '#aca08d' },
      },
    },
  })

const midnight = () =>
  makeColors({
    label: 'Midnight',
    roles: { accent: '#7aa2f7', danger: '#f7768e', success: '#9ece6a', warning: '#e0af68', pro: '#bb9af7' },
    dark: {
      gray: {
        anchors: { 'surface-0': '#0f1220', 'surface-1': '#151a2c', 'surface-2': '#1c2238', 'surface-3': '#242b45', 'text-primary': '#e8ecff', 'text-secondary': '#bac2e0', 'text-muted': '#9aa3c7' },
      },
    },
  })

const contrast = () =>
  makeColors({
    label: 'High contrast',
    roles: { accent: '#0a5cc2', danger: '#b00020', success: '#0b6b2b', warning: '#8a5300', pro: '#5b2ca0' },
    light: {
      gray: {
        anchors: { 'surface-0': '#f2f2f2', 'surface-1': '#fafafa', 'surface-2': '#ffffff', 'text-primary': '#000000', 'text-secondary': '#1f1f1f', 'text-muted': '#3a3a3a' },
      },
    },
    dark: {
      gray: {
        anchors: { 'surface-0': '#000000', 'surface-1': '#0b0b0b', 'surface-2': '#141414', 'surface-3': '#1c1c1c', 'text-primary': '#ffffff', 'text-secondary': '#ececec', 'text-muted': '#d0d0d0' },
      },
    },
  })

/** What `$.theme.set` takes for a theme, beside the chat style. Empty for the app's own colors. */
export const themeFor = (name: ColorName, options: LookOptions = DEFAULT_OPTIONS) => {
  if (name === 'paper') {
    return { colors: paper().theme }
  }

  if (name === 'midnight') {
    return { colors: midnight().theme, overrideColorScheme: 'dark' as const }
  }

  if (name === 'contrast') {
    return { colors: { ...contrast().theme, contrast: 'more' as const } }
  }

  if (isPremium(name)) {
    return premiumTheme(name, options)
  }

  return name === 'app' ? {} : { colors: build(name).theme }
}

/** Lines the palette builder says would stop the desktop painting a theme. */
export const refusals = (): string[] =>
  [...PREMIUM_NAMES.map(premiumColors), paper(), midnight(), contrast(), ...(Object.keys(MORE) as MoreName[]).map(build)].flatMap(p => p.problems).filter(x => x.startsWith("Desktop won't paint"))
