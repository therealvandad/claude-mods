// Idea 14: a small icon in front of a pane title. Pure: no `$` here.

export type IconPack = 'letters' | 'symbols' | 'minimal'

const GLYPHS: Record<string, string> = {
  'finish-kit': '◐',
  skins: '◐',
  looks: '◐',
  settings: '⚙',
  charts: '▥',
  visuals: '◔',
  notes: '✎',
  workbench: '▤',
  cockpit: '◈',
  progress: '▰',
  'git-kit': '⑂',
  learning: '✦',
}

const DEFAULT_GLYPH = '◧'

/** The mod a pane id belongs to: `skins-main` is `skins`. */
export const modOf = (id: string): string => id.replace(/-(main|pane|view|panel)$/, '')

/** The icon in front of a pane title for an icon pack: a symbol, a lettered tag, or a quiet dot. */
export const glyphFor = (id: string, pack: IconPack | string): string => {
  const mod = modOf(id)

  if (pack === 'minimal') {
    return '·'
  }

  if (pack === 'letters') {
    return `[${(mod.charAt(0) || '?').toUpperCase()}]`
  }

  return GLYPHS[mod] ?? DEFAULT_GLYPH
}

/** The title with its icon in front, and unchanged when it already has one. */
export const withGlyph = (title: string, id: string, pack: IconPack | string): string => {
  const g = glyphFor(id, pack)
  const known = [...Object.values(GLYPHS), DEFAULT_GLYPH, '·']

  if (title.startsWith(`${g} `) || known.some(k => title.startsWith(`${k} `)) || /^\[[A-Z?]\] /.test(title)) {
    return title
  }

  return `${g} ${title}`
}
