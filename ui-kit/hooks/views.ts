// Turns the models into what a pane draws: a vector picture on the desktop, lines of block characters elsewhere.
// Pure. register.tsx only places the result in Box, Text, Svg and Button elements.

import type { ViewId } from '../types'
import { dur, hhmm, sigOf } from './data'
import type { Data, Eta } from './data'
import { bar, clampN, fit, glyphs, padEnd, padStart, spark } from './fmt'
import type { Icons } from './fmt'
import { activityModel, errorsModel, filesModel, promptsModel, spendModel, timelineModel } from './model'
import type { ActivityModel, Item, Line, Num, ToolRow } from './model'
import { activitySvg, errorsSvg, filesSvg, promptsSvg, spendSvg, timelineSvg } from './svg'
import type { Look } from './svg'

export type Ctx = {
  /** Columns this view may use (half the pane in a side-by-side split). */
  cols: number
  /** Draw the vector picture (the desktop surface only). */
  svg: boolean
  look: Look
  icons: Icons
  /** A shorter list, for the second half of a split view. */
  compact: boolean
  showMsg: boolean
}

export type ViewOut = {
  id: ViewId
  title: string
  nums: Num[]
  empty: string | undefined
  svg: { source: string; alt: string } | undefined
  lines: Line[]
  items: Item[]
  tools: ToolRow[]
  eta: Eta | undefined
  running: string | undefined
  runningMs: number
  about: string[]
}

const ABOUT: Record<string, string[]> = {
  timeline: [
    'Each bar is one tool call: it starts where the call started and lasts as long as the call took.',
    'Red bars failed. A dashed bar is still running; its estimate comes from earlier calls of the same tool, so it is a guess.',
  ],
  files: [
    'Each tile is a file Claude edited or wrote; bigger means more lines changed and more edits.',
    'Colour groups the kind of file: code, config and docs, styles, other. Hover a tile for its path and counts.',
  ],
  errors: [
    'The strip shows the last 60 calls: green passed, red failed.',
    'Failures are grouped by tool and by the first line of the message, with numbers and paths blurred. Messages are cut and scrubbed of obvious keys before they are kept, and never written to disk.',
  ],
  prompts: [
    'Bars show how long each of your prompts was. Only the length and the time are kept, never the text, unless ui-kit.prompt-snippets is on (then the first 40 characters, for this session only).',
  ],
  spend: [
    'Readings are taken when a turn finishes: the cost so far (an estimate, not a bill) and how full the context window is.',
  ],
  activity: [
    'The grid counts tool calls per day for the last 12 weeks, the bars count them by hour of the day. These totals are the only thing saved between sessions.',
    'The rows below show how each tool was used across this session.',
  ],
}

const rowsFor = (cols: number, compact: boolean) => (compact ? 5 : cols < 60 ? 6 : cols < 100 ? 10 : 14)

const toneOf = (n: Num | undefined): Line['tone'] => n?.tone

// ---------------------------------------------------------------- text charts

const timelineLines = (d: Data, c: Ctx): Line[] => {
  const m = timelineModel(d)
  const g = glyphs(c.icons)
  const nameW = clampN(Math.floor(c.cols * 0.3), 8, 22)
  const barW = Math.max(6, c.cols - nameW - 7 - 3 - 2)
  const out: Line[] = []
  const rows = m.recent.slice(-rowsFor(c.cols, c.compact))
  const span = m.spanMs

  for (const call of rows) {
    const end = call.endedAt ?? d.now
    const a = Math.floor(clampN((call.startedAt - m.t0) / span, 0, 1) * (barW - 1))
    const len = Math.max(1, Math.min(barW - a, Math.round(((end - call.startedAt) / span) * barW)))
    const mark = call.endedAt === null ? g.run : call.isError ? g.err : g.ok
    out.push({
      t: `${padEnd(`${call.tool}${call.detail === '' ? '' : ` ${call.detail}`}`, nameW)} ${padEnd(' '.repeat(a) + '█'.repeat(len), barW)} ${padStart(call.endedAt === null ? 'run' : dur(end - call.startedAt), 7)} ${mark}`,
      tone: call.isError ? 'bad' : call.endedAt === null ? 'accent' : undefined,
    })
  }
  out.push({ t: `${' '.repeat(nameW + 1)}0${' '.repeat(Math.max(1, barW - 1 - dur(span).length))}${dur(span)}`, dim: true })

  return out
}

const filesLines = (d: Data, c: Ctx): Line[] => {
  const m = filesModel(d)
  const nameW = clampN(Math.floor(c.cols * 0.3), 8, 24)
  const barW = Math.max(6, c.cols - nameW - 16)
  const max = Math.max(1, ...m.tiles.map(t => t.w))
  const out: Line[] = []

  for (const t of m.tiles.slice(0, rowsFor(c.cols, c.compact))) {
    out.push({ t: `${padEnd(t.label, nameW)} ${bar(t.w / max, barW)} x${t.n} +${t.added} -${t.removed}` })
  }

  if (m.folders.length > 0) {
    out.push({ t: `folders: ${m.folders.map(([f, n]) => `${f} ${n}`).join(' · ')}`, dim: true })
  }

  return out
}

const errorsLines = (d: Data, c: Ctx): Line[] => {
  const m = errorsModel(d, sigOf, c.showMsg)
  const g = glyphs(c.icons)
  const out: Line[] = [{ t: `last ${m.strip.length} calls (${g.ok} ok, ${g.err} failed):`, dim: true }]
  const chars = m.strip.map(s => (s.running ? g.run : s.ok ? g.ok : g.err))
  const per = Math.max(10, c.cols - 2)

  for (let i = 0; i < chars.length; i += per) {
    out.push({ t: chars.slice(i, i + per).join(''), tone: chars.slice(i, i + per).includes(g.err) ? 'bad' : 'ok' })
  }
  const shown = m.perTool.filter(t => t.err > 0)

  if (shown.length === 0) {
    out.push({ t: 'No failed calls.', tone: 'ok' })
  }

  for (const t of shown) {
    out.push({ t: `${padEnd(t.tool, 10)} ${bar(t.err / Math.max(1, t.total), Math.max(6, c.cols - 18))} ${t.err}/${t.total}`, tone: 'bad' })
  }

  return out
}

const promptsLines = (d: Data, c: Ctx): Line[] => {
  const m = promptsModel(d)
  const w = Math.min(30, Math.max(8, c.cols - 2))
  const out: Line[] = [
    { t: `length of each prompt, newest at the right:`, dim: true },
    { t: spark(m.lens, w), tone: 'accent' },
    { t: `median ${Math.round(m.medianLen)} chars, longest ${m.longest}, average gap ${m.avgGapMs === 0 ? '-' : dur(m.avgGapMs)}`, dim: true },
  ]
  const max = Math.max(1, m.longest)

  for (let i = m.lens.length - 1; i >= Math.max(0, m.lens.length - rowsFor(c.cols, c.compact)); i--) {
    out.push({ t: `${hhmm(m.ats[i] ?? 0)} ${bar((m.lens[i] ?? 0) / max, Math.max(6, c.cols - 14))} ${padStart(String(m.lens[i] ?? 0), 5)}` })
  }

  return out
}

const spendLines = (d: Data, c: Ctx): Line[] => {
  const m = spendModel(d)
  const w = Math.min(40, Math.max(8, c.cols - 14))

  return [
    { t: `${padEnd('spent', 8)} ${spark(m.cum, w)} ${m.nums[0]?.value ?? ''}`, tone: 'accent' },
    { t: `${padEnd('context', 8)} ${spark(m.ctx, w, 100)} ${m.nums[1]?.value ?? ''}`, tone: toneOf(m.nums[1]) },
    { t: `${padEnd('per turn', 8)} ${spark(m.deltas, w)}`, dim: true },
  ]
}

const SHADES = ['·', '░', '▒', '▓', '█']

const heatLines = (m: ActivityModel): Line[] => {
  const out: Line[] = []

  for (let row = 0; row < 7; row++) {
    let t = ''

    for (let col = 0; col < 12; col++) {
      const v = m.heat[col * 7 + row]?.v ?? 0
      const level = v === 0 ? 0 : Math.min(4, 1 + Math.floor((v / m.max) * 3.999))
      t += SHADES[level]!.repeat(2)
    }
    out.push({ t, tone: 'accent' })
  }

  return out
}

const activityLines = (d: Data): Line[] => {
  const m = activityModel(d)
  const out: Line[] = [{ t: 'last 12 weeks, one cell per day (older at the left):', dim: true }, ...heatLines(m)]
  out.push({ t: 'by hour of the day:', dim: true }, { t: spark(m.hours, 24), tone: 'accent' }, { t: '0     6     12    18', dim: true })

  return out
}

const toolRowLine = (r: ToolRow, w: number): Line => ({ t: `${padEnd(r.tool, 10)} ${spark(r.series, w)} ${r.count}` })

// ---------------------------------------------------------------- the entry point

export const TITLES: Record<string, string> = {
  timeline: 'Timeline',
  files: 'Files treemap',
  errors: 'Errors',
  prompts: 'Prompts',
  spend: 'Spend',
  activity: 'Activity',
}

const alt = (title: string, nums: readonly Num[]) => `${title}: ${nums.map(n => `${n.label} ${n.value}`).join(', ')}`

export const buildView = (id: Exclude<ViewId, 'lab'>, d: Data, c: Ctx): ViewOut => {
  const base = {
    id,
    title: TITLES[id] ?? id,
    items: [] as Item[],
    tools: [] as ToolRow[],
    eta: undefined as Eta | undefined,
    running: undefined as string | undefined,
    runningMs: 0,
    about: ABOUT[id] ?? [],
  }
  const mk = (nums: Num[], empty: string | undefined, svg: string | undefined, lines: () => Line[], items: Item[]): ViewOut => ({
    ...base,
    nums,
    empty,
    svg: empty === undefined && c.svg && svg !== undefined ? { source: svg, alt: alt(base.title, nums) } : undefined,
    lines: empty === undefined && !(c.svg && svg !== undefined) ? lines().map(l => ({ ...l, t: fit(l.t, c.cols) })) : [],
    items,
  })

  switch (id) {
    case 'timeline': {
      const m = timelineModel(d)
      const out = mk(m.nums, m.isEmpty ? 'No tool calls yet. They show up here while Claude works.' : undefined, m.isEmpty || !c.svg ? undefined : timelineSvg(m, c.look), () => timelineLines(d, c), m.items)

      return {
        ...out,
        eta: m.eta,
        running: m.running === undefined ? undefined : `${m.running.tool}${m.running.detail === '' ? '' : ` ${m.running.detail}`}`,
        runningMs: m.running === undefined ? 0 : Math.max(0, d.now - m.running.startedAt),
      }
    }

    case 'files': {
      const m = filesModel(d)

      return mk(m.nums, m.isEmpty ? 'No edited files yet. A file appears here after Claude edits or writes it.' : undefined, m.isEmpty || !c.svg ? undefined : filesSvg(m, c.look), () => filesLines(d, c), m.items)
    }

    case 'errors': {
      const m = errorsModel(d, sigOf, c.showMsg)

      return mk(m.nums, m.isEmpty ? 'No tool calls yet, so nothing has failed.' : undefined, m.isEmpty || !c.svg ? undefined : errorsSvg(m, c.look), () => errorsLines(d, c), m.items)
    }

    case 'prompts': {
      const m = promptsModel(d)

      return mk(m.nums, m.isEmpty ? 'No prompts recorded yet.' : undefined, m.isEmpty || !c.svg ? undefined : promptsSvg(m, c.look), () => promptsLines(d, c), m.items)
    }

    case 'spend': {
      const m = spendModel(d)

      return mk(m.nums, m.isEmpty ? 'No turn has finished yet, so there is no spend reading.' : undefined, m.isEmpty || !c.svg ? undefined : spendSvg(m, c.look), () => spendLines(d, c), m.items)
    }

    default: {
      const m = activityModel(d)
      const out = mk(m.nums, m.isEmpty ? 'No activity yet.' : undefined, m.isEmpty || !c.svg ? undefined : activitySvg(m, c.look), () => activityLines(d), m.items)

      return { ...out, tools: m.tools }
    }
  }
}

export const toolLine = (r: ToolRow, cols: number): Line => toolRowLine(r, clampN(cols - 16, 6, 12))

/** The mini view: three numbers for the pane's mini mode and the widget. */
export const miniNums = (d: Data): Num[] => {
  const errs = d.calls.filter(c => c.isError).length
  const last = d.samples[d.samples.length - 1]

  return [
    { key: 'calls', label: 'calls', value: String(d.calls.length) },
    { key: 'errors', label: 'failed', value: String(errs), tone: errs > 0 ? 'bad' : 'mut' },
    { key: 'spend', label: 'spent', value: `$${(last?.usd ?? 0).toFixed(2)}` },
  ]
}

export const miniLine = (nums: readonly Num[]): string => nums.map(n => `${n.label} ${n.value}`).join('  ')

export const fitLine = (s: string, cols: number) => fit(s, cols)
