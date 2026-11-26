// Pure logic of the gallery: search, filter, sort, paging, sticky headers, argument parsing. No `$`, no engine.
import type { ChipId, GalleryView, SortId, TabId } from '../types'
import { CHIPS, COMMANDS, SAMPLES, TABS, byId, tabLabel } from './catalog'
import type { Sample } from './catalog'

export const QUERY_MAX = 60
export const MSG_MAX = 140
export const PAGE_SIZE = 8
export const DEMO_PAGE_SIZE = 4
export const DEMO_ITEMS = 12

export const TAB_IDS: readonly TabId[] = TABS.map(t => t.id)
export const SORT_IDS: readonly SortId[] = ['id', 'name', 'kind']
export const CHIP_IDS: readonly ChipId[] = CHIPS.map(c => c.id)

export const DEFAULT_VIEW: GalleryView = {
  tab: 'surfaces',
  query: '',
  chips: [],
  sort: 'id',
  page: 1,
  selected: '',
  grid: false,
  demoPage: 1,
  msg: '',
}

const clampInt = (n: unknown, lo: number, hi: number, dflt: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt

// Drops control characters and bounds the length: a query is typed text, never trusted.
export const cleanQuery = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trimStart().slice(0, QUERY_MAX) : ''

export const cleanMsg = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MSG_MAX) : '')

// Strict validation of anything stored or read back: a bad field falls back to its default.
export const normView = (raw: unknown): GalleryView => {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const chips = Array.isArray(o['chips']) ? [...new Set(o['chips'].filter((c): c is ChipId => CHIP_IDS.includes(c as ChipId)))] : []
  const selected = typeof o['selected'] === 'string' && byId(o['selected']) !== undefined ? o['selected'] : ''

  return {
    tab: TAB_IDS.includes(o['tab'] as TabId) ? (o['tab'] as TabId) : DEFAULT_VIEW.tab,
    query: cleanQuery(o['query']),
    chips,
    sort: SORT_IDS.includes(o['sort'] as SortId) ? (o['sort'] as SortId) : DEFAULT_VIEW.sort,
    page: clampInt(o['page'], 1, 99, 1),
    selected,
    grid: o['grid'] === true,
    demoPage: clampInt(o['demoPage'], 1, DEMO_ITEMS / DEMO_PAGE_SIZE, 1),
    msg: cleanMsg(o['msg']),
  }
}

// What is kept across sessions: only the quiet preferences, never the query or the selection.
export const storable = (v: GalleryView): { tab: TabId; sort: SortId; grid: boolean } => ({ tab: v.tab, sort: v.sort, grid: v.grid })

export const fromStore = (raw: unknown): GalleryView => {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const n = normView({ tab: o['tab'], sort: o['sort'], grid: o['grid'] })

  return { ...DEFAULT_VIEW, tab: n.tab, sort: n.sort, grid: n.grid }
}

// ------------------------------------------------------------------ search, filter, sort

const haystack = (s: Sample): string => `${s.id} ${s.title} ${s.kind} ${s.tab} ${s.family} ${s.status} ${s.blurb}`.toLowerCase()

export const matchesQuery = (s: Sample, query: string): boolean => {
  const words = cleanQuery(query).toLowerCase().split(' ').filter(Boolean)
  const hay = haystack(s)

  return words.every(w => hay.includes(w))
}

// Chips of one group combine with OR, different groups with AND.
export const matchesChips = (s: Sample, chips: readonly ChipId[]): boolean => {
  const status = chips.filter(c => c === 'live' || c === 'preview')
  const family = chips.filter(c => c === 'look' || c === 'ui')

  return (status.length === 0 || status.includes(s.status)) && (family.length === 0 || family.includes(s.family))
}

export const sortSamples = (list: readonly Sample[], sort: SortId): Sample[] => {
  const out = [...list]

  if (sort === 'name') {
    out.sort((a, b) => a.title.localeCompare(b.title) || a.no - b.no)
  } else if (sort === 'kind') {
    out.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title))
  }

  return out
}

export const hasFilter = (v: Pick<GalleryView, 'query' | 'chips'>): boolean => v.query.trim() !== '' || v.chips.length > 0

// Every sample that passes the search and the chips, across all tabs, in the chosen order. `useFilter` false = all.
export const visible = (v: Pick<GalleryView, 'query' | 'chips' | 'sort'>, useFilter = true): Sample[] =>
  sortSamples(SAMPLES.filter(s => !useFilter || (matchesQuery(s, v.query) && matchesChips(s, v.chips))), v.sort)

export const inTab = (list: readonly Sample[], tab: TabId): Sample[] => (tab === 'list' ? [...list] : list.filter(s => s.tab === tab))

// The List tab groups by tab (in tab order); the chosen sort applies inside each group.
export const groupByTab = (list: readonly Sample[]): Sample[] => TABS.flatMap(t => list.filter(s => s.tab === t.id))

export const tabCounts = (list: readonly Sample[]): Record<TabId, number> => {
  const out: Record<TabId, number> = { surfaces: 0, controls: 0, feedback: 0, navigation: 0, modes: 0, list: list.length }

  for (const s of list) {
    out[s.tab] += 1
  }

  return out
}

// ------------------------------------------------------------------ paging

export const paginate = <T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } => {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const p = Math.max(1, Math.min(pages, Math.round(page) || 1))

  return { items: items.slice((p - 1) * size, p * size), page: p, pages }
}

// ------------------------------------------------------------------ the list with group headers, and sticky headers

export type Row = { id: string; isHeader?: boolean; isSticky?: boolean; title?: string; count?: number; sample?: Sample }

// Rows of one page of the List tab: a header whenever the group (the tab) changes, then the sample.
export const listRows = (page: readonly Sample[], counts: Record<TabId, number>): Row[] => {
  const rows: Row[] = []
  let group = ''

  for (const s of page) {
    if (s.tab !== group) {
      group = s.tab
      rows.push({ id: `h:${s.tab}`, isHeader: true, title: tabLabel(s.tab), count: counts[s.tab] })
    }
    rows.push({ id: `s:${s.id}`, sample: s })
  }

  return rows
}

// The tree's window starts at `offset`. When that row is not a header and an earlier header has scrolled out,
// a copy of the header takes the window's first row (the rows below move down by one, none is lost).
// `base` is how many tree rows sit above the first item.
export const withSticky = <T extends { isHeader?: boolean; isSticky?: boolean }>(items: readonly T[], offset: number, base: number): T[] => {
  const at = offset - base

  if (at <= 0 || at >= items.length || items[at]?.isHeader === true) {
    return [...items]
  }
  let header = -1

  for (let i = at - 1; i >= 0; i -= 1) {
    if (items[i]?.isHeader === true) {
      header = i
      break
    }
  }

  if (header < 0) {
    return [...items]
  }
  const copy = { ...(items[header] as T), isSticky: true }

  return [...items.slice(0, at), copy, ...items.slice(at)]
}

// ------------------------------------------------------------------ selection

// The sample the footer and the Ask button act on: the selected one if it is shown, else the first shown.
export const current = (v: Pick<GalleryView, 'selected'>, shown: readonly Sample[]): Sample | undefined =>
  shown.find(s => s.id === v.selected) ?? shown[0]

export const step = (v: Pick<GalleryView, 'selected'>, shown: readonly Sample[], dir: 1 | -1): string => {
  if (shown.length === 0) {
    return v.selected
  }
  const i = shown.findIndex(s => s.id === v.selected)
  const next = i < 0 ? (dir === 1 ? 0 : shown.length - 1) : (i + dir + shown.length) % shown.length

  return shown[next]?.id ?? v.selected
}

// ------------------------------------------------------------------ the text put in the prompt box

export const copyText = (s: Sample): string => `Style "${s.title}" (${s.id}): ${s.spec}`

export const askText = (s: Sample): string =>
  `Please apply this style to what we are building, and tell me which parts you changed. Style "${s.title}" (${s.id}): ${s.spec}`

// ------------------------------------------------------------------ commands

export const parseSwitch = (raw: string): boolean | undefined => {
  const a = raw.trim().toLowerCase()

  return ['on', 'true', 'yes', '1'].includes(a) ? true : ['off', 'false', 'no', '0'].includes(a) ? false : undefined
}

// An id exactly, or a unique prefix of an id, or a unique match in the title.
export const findSample = (raw: string): { sample?: Sample; error?: string } => {
  const a = raw.trim().toLowerCase().replace(/^#/, '')

  if (a === '') {
    return { error: 'Give a sample id, for example /sgcopy radius. /sglist shows them.' }
  }
  const exact = SAMPLES.find(s => s.id === a)

  if (exact !== undefined) {
    return { sample: exact }
  }
  const pre = SAMPLES.filter(s => s.id.startsWith(a))

  if (pre.length === 1) {
    return pre[0] === undefined ? { error: 'No such sample.' } : { sample: pre[0] }
  }
  const named = SAMPLES.filter(s => s.title.toLowerCase().includes(a))

  if (pre.length === 0 && named.length === 1 && named[0] !== undefined) {
    return { sample: named[0] }
  }
  const options = (pre.length > 0 ? pre : named).map(s => s.id)

  return options.length > 1 ? { error: `More than one sample matches "${a.slice(0, 30)}": ${options.slice(0, 8).join(', ')}.` } : { error: `No sample "${a.slice(0, 30)}". /sglist shows the ids.` }
}

export const parseTarget = (raw: string): { tab?: TabId; sample?: Sample; error?: string } => {
  const a = raw.trim().toLowerCase()

  if (a === '') {
    return {}
  }
  const tab = TAB_IDS.find(t => t === a || tabLabel(t).toLowerCase() === a)

  if (tab !== undefined) {
    return { tab }
  }
  const found = findSample(a)

  return found.sample === undefined ? { error: found.error ?? 'No such tab or sample.' } : { sample: found.sample, tab: found.sample.tab }
}

export const listText = (query: string): string => {
  const q = cleanQuery(query)
  const rows = SAMPLES.filter(s => matchesQuery(s, q))

  if (rows.length === 0) {
    return `No sample matches "${q}".`
  }

  return [`${rows.length} of ${SAMPLES.length} samples${q === '' ? '' : ` matching "${q}"`}:`, ...rows.map(s => `  ${s.id.padEnd(12)} ${s.title}  (${tabLabel(s.tab).toLowerCase()}, ${s.status})`)].join('\n')
}

export const helpText = (): string =>
  [
    'Style gallery: 30 labelled style samples in one pane (vector images on the desktop, text elsewhere).',
    'It shows styles; it cannot restyle other mods or the app. /sgcopy puts a written spec in the prompt so you can ask for a style.',
    ...COMMANDS.map(c => `  ${c.usage.padEnd(20)} ${c.description}`),
  ].join('\n')
