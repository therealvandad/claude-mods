// Three optional color themes. The app builds the full palette from a few anchors per mode.
import { makeColors } from './make-colors'

export type ColorName = 'app' | 'paper' | 'midnight' | 'contrast'

export const COLOR_NAMES: readonly ColorName[] = ['app', 'paper', 'midnight', 'contrast']

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
export const themeFor = (name: ColorName) => {
  if (name === 'paper') {
    return { colors: paper().theme }
  }

  if (name === 'midnight') {
    return { colors: midnight().theme, overrideColorScheme: 'dark' as const }
  }

  return name === 'contrast' ? { colors: { ...contrast().theme, contrast: 'more' as const } } : {}
}

/** Lines the palette builder says would stop the desktop painting a theme. */
export const refusals = (): string[] =>
  [paper(), midnight(), contrast()].flatMap(p => p.problems).filter(x => x.startsWith("Desktop won't paint"))
