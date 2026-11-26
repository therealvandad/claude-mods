// View models: what each view shows, worked out from the recorded data. Pure, so each can be tested alone.

import type { CallRec } from '../types'
import { dayKey, dur, etaFor, hhmm, hhmmss, median, money, ago } from './data'
import type { Data, Eta } from './data'
import { baseName, folderOf } from './fmt'

export type Tone = 'accent' | 'ok' | 'bad' | 'warn' | 'mut'
export type Line = { t: string; tone?: Tone; dim?: boolean; bold?: boolean }
/** A headline number. `key` names it for the pulse. */
export type Num = { key: string; label: string; value: string; tone?: Tone }
/** One row of a list: expandable on its own, or picked in a master-detail pair. */
export type Item = { id: string; title: string; meta: string; tone?: Tone; detail: string[] }

export type Rect = { x: number; y: number; w: number; h: number }

// ---------------------------------------------------------------- treemap layout

/** Squarified treemap: rectangles for `weights` (largest first) that fill W x H exactly, as squarish as the method manages. */
export const squarify = (weights: readonly number[], W: number, H: number): Rect[] => {
  const n = weights.length
  const ws = weights.map(v => Math.max(Number.isFinite(v) ? v : 0, 0.0001))
  const total = ws.reduce((s, v) => s + v, 0)

  if (n === 0 || W <= 0 || H <= 0) {
    return []
  }
  const areas = ws.map(v => (v / total) * W * H)
  const out: Rect[] = []
  let x = 0
  let y = 0
  let w = W
  let h = H
  let i = 0

  while (i < n) {
    const side = Math.min(w, h)
    const row: number[] = []
    let rowArea = 0
    let best = Number.POSITIVE_INFINITY
    let j = i

    while (j < n) {
      const a = areas[j] ?? 0
      const sum = rowArea + a
      const worst = Math.max((side * side * Math.max(a, ...row)) / (sum * sum), (sum * sum) / (side * side * Math.min(a, ...row)))

      if (row.length > 0 && worst > best) {
        break
      }
      row.push(a)
      rowArea = sum
      best = worst
      j++
    }
    const thick = side > 0 ? rowArea / side : 0

    if (w >= h) {
      let yy = y

      for (const a of row) {
        const hh = thick > 0 ? a / thick : 0
        out.push({ x, y: yy, w: thick, h: hh })
        yy += hh
      }
      x += thick
      w -= thick
    } else {
      let xx = x

      for (const a of row) {
        const ww = thick > 0 ? a / thick : 0
        out.push({ x: xx, y, w: ww, h: thick })
        xx += ww
      }
      y += thick
      h -= thick
    }
    i = j
  }

  return out
}

// ---------------------------------------------------------------- timeline

export type Bar = { lane: number; a: number; b: number; tool: string; isErr: boolean; running: boolean; ms: number; tip: string }
export type TimelineModel = {
  isEmpty: boolean
  lanes: string[]
  bars: Bar[]
  spanMs: number
  t0: number
  running: CallRec | undefined
  eta: Eta | undefined
  nums: Num[]
  items: Item[]
  recent: CallRec[]
}

export const timelineModel = (d: Data): TimelineModel => {
  const recent = d.calls.slice(-60)
  const counts = new Map<string, number>()

  for (const c of recent) {
    counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0])
  const lanes = ranked.length > 6 ? [...ranked.slice(0, 5), 'other'] : ranked
  const t0 = recent.reduce((m, c) => Math.min(m, c.startedAt), Number.POSITIVE_INFINITY)
  const running = [...recent].reverse().find(c => c.endedAt === null)
  const tEnd = recent.reduce((m, c) => Math.max(m, c.endedAt ?? d.now), running === undefined ? 0 : d.now)
  const spanMs = Math.max(1000, tEnd - (Number.isFinite(t0) ? t0 : 0))
  const bars: Bar[] = recent.map(c => {
    const end = c.endedAt ?? d.now
    const ms = Math.max(0, end - c.startedAt)
    const laneName = lanes.includes(c.tool) ? c.tool : 'other'

    return {
      lane: Math.max(0, lanes.indexOf(laneName)),
      a: Math.min(1, Math.max(0, (c.startedAt - t0) / spanMs)),
      b: Math.min(1, Math.max(0, (end - t0) / spanMs)),
      tool: c.tool,
      isErr: c.isError,
      running: c.endedAt === null,
      ms,
      tip: `${c.tool}${c.detail === '' ? '' : ` ${c.detail}`}: ${c.endedAt === null ? `running ${dur(ms)}` : `${dur(ms)}${c.isError ? ', failed' : ''}`} at ${hhmmss(c.startedAt)}`,
    }
  })
  const finished = d.calls.filter(c => c.endedAt !== null).map(c => (c.endedAt ?? 0) - c.startedAt)
  const errs = d.calls.filter(c => c.isError).length
  const items: Item[] = [...recent]
    .reverse()
    .slice(0, 30)
    .map(c => {
      const ms = (c.endedAt ?? d.now) - c.startedAt

      return {
        id: c.id,
        title: `${c.tool}${c.detail === '' ? '' : ` ${c.detail}`}`,
        meta: c.endedAt === null ? 'running' : dur(ms),
        tone: c.isError ? ('bad' as const) : c.endedAt === null ? ('accent' as const) : undefined,
        detail: [
          `started ${hhmmss(c.startedAt)}`,
          c.endedAt === null ? `still running after ${dur(ms)}` : `took ${dur(ms)}`,
          `result: ${c.endedAt === null ? 'not finished' : c.isError ? 'failed' : 'ok'}${c.endedAt !== null && c.out > 0 ? `, ${c.out} characters back` : ''}`,
          ...(c.isError && c.msg !== '' ? [`message: ${c.msg}`] : []),
        ],
      }
    })

  return {
    isEmpty: d.calls.length === 0,
    lanes,
    bars,
    spanMs,
    t0: Number.isFinite(t0) ? t0 : 0,
    running,
    eta: running === undefined ? undefined : etaFor(d.calls, running, d.now),
    nums: [
      { key: 'calls', label: 'tool calls', value: String(d.calls.length) },
      { key: 'errors', label: 'failed', value: String(errs), tone: errs > 0 ? 'bad' : 'mut' },
      { key: 'typical', label: 'typical', value: finished.length === 0 ? '-' : dur(median(finished)) },
    ],
    items,
    recent,
  }
}

// ---------------------------------------------------------------- files treemap

export type Tile = { path: string; label: string; w: number; n: number; added: number; removed: number; last: number; grp: 1 | 2 | 3 | 4 }
export type FilesModel = { isEmpty: boolean; tiles: Tile[]; total: number; nums: Num[]; items: Item[]; folders: [string, number][] }

export const extGroup = (path: string): 1 | 2 | 3 | 4 => {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''

  if (/^(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|swift|c|cc|cpp|h|rb|php)$/.test(ext)) {
    return 1
  }

  if (/^(css|scss|html|svg|vue|svelte)$/.test(ext)) {
    return 4
  }

  if (/^(md|txt|json|yml|yaml|toml|lock)$/.test(ext)) {
    return 3
  }

  return 2
}

export const filesModel = (d: Data): FilesModel => {
  const rows = [...d.edits].sort((a, b) => b.added + b.removed + b.n * 4 - (a.added + a.removed + a.n * 4) || b.last - a.last)
  const tiles: Tile[] = rows.slice(0, 24).map(r => ({
    path: r.path,
    label: baseName(r.path),
    w: Math.max(1, r.added + r.removed + r.n * 4),
    n: r.n,
    added: r.added,
    removed: r.removed,
    last: r.last,
    grp: extGroup(r.path),
  }))
  const total = rows.reduce((s, r) => s + Math.max(1, r.added + r.removed + r.n * 4), 0)
  const folderCount = new Map<string, number>()

  for (const r of rows) {
    folderCount.set(folderOf(r.path), (folderCount.get(folderOf(r.path)) ?? 0) + 1)
  }
  const edits = rows.reduce((s, r) => s + r.n, 0)
  const items: Item[] = rows.slice(0, 20).map(r => ({
    id: r.path,
    title: baseName(r.path),
    meta: `x${r.n}`,
    detail: [
      r.path.slice(-90),
      `${r.n} edit${r.n === 1 ? '' : 's'}, +${r.added} -${r.removed} lines`,
      `last edited ${ago(Math.max(0, d.now - r.last))}`,
      `${Math.round((Math.max(1, r.added + r.removed + r.n * 4) / Math.max(1, total)) * 100)}% of the size shown`,
    ],
  }))

  return {
    isEmpty: rows.length === 0,
    tiles,
    total,
    nums: [
      { key: 'files', label: 'files', value: String(rows.length) },
      { key: 'edits', label: 'edits', value: String(edits) },
      { key: 'lines', label: 'lines +/-', value: `+${rows.reduce((s, r) => s + r.added, 0)} -${rows.reduce((s, r) => s + r.removed, 0)}` },
    ],
    items,
    folders: [...folderCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
  }
}

// ---------------------------------------------------------------- errors

export type ErrorGroup = { sig: string; tool: string; count: number; last: number; first: number; msg: string }
export type ToolErr = { tool: string; total: number; err: number }
export type StripCell = { id: string; ok: boolean; running: boolean; tip: string }
export type ErrorsModel = { isEmpty: boolean; strip: StripCell[]; perTool: ToolErr[]; groups: ErrorGroup[]; nums: Num[]; items: Item[]; errors: number }

export const errorsModel = (d: Data, sigOf: (tool: string, msg: string) => string, showMsg: boolean): ErrorsModel => {
  const strip: StripCell[] = d.calls.slice(-60).map(c => ({
    id: c.id,
    ok: !c.isError,
    running: c.endedAt === null,
    tip: `${c.tool}${c.detail === '' ? '' : ` ${c.detail}`} at ${hhmmss(c.startedAt)}: ${c.endedAt === null ? 'running' : c.isError ? 'failed' : 'ok'}`,
  }))
  const per = new Map<string, ToolErr>()
  const groups = new Map<string, ErrorGroup>()

  for (const c of d.calls) {
    const t = per.get(c.tool) ?? { tool: c.tool, total: 0, err: 0 }
    t.total += 1
    t.err += c.isError ? 1 : 0
    per.set(c.tool, t)

    if (c.isError) {
      const sig = sigOf(c.tool, c.msg)
      const g = groups.get(sig) ?? { sig, tool: c.tool, count: 0, last: 0, first: c.startedAt, msg: '' }
      g.count += 1
      g.last = Math.max(g.last, c.startedAt)
      g.first = Math.min(g.first, c.startedAt)
      g.msg = showMsg ? c.msg : ''
      groups.set(sig, g)
    }
  }
  const perTool = [...per.values()].sort((a, b) => b.err - a.err || b.total - a.total).slice(0, 5)
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last)
  const errors = d.calls.filter(c => c.isError).length

  return {
    isEmpty: d.calls.length === 0,
    strip,
    perTool,
    groups: sorted,
    errors,
    nums: [
      { key: 'errors', label: 'failed', value: String(errors), tone: errors > 0 ? 'bad' : 'ok' },
      { key: 'rate', label: 'failure rate', value: d.calls.length === 0 ? '-' : `${Math.round((errors / d.calls.length) * 100)}%`, tone: errors > 0 ? 'warn' : 'ok' },
      { key: 'kinds', label: 'kinds', value: String(sorted.length) },
    ],
    items: sorted.slice(0, 20).map(g => ({
      id: g.sig,
      title: g.sig,
      meta: `x${g.count}`,
      tone: 'bad' as const,
      detail: [
        `${g.count} time${g.count === 1 ? '' : 's'}, tool ${g.tool}`,
        `first ${hhmmss(g.first)}, last ${hhmmss(g.last)}`,
        showMsg ? (g.msg === '' ? 'no message kept' : `message: ${g.msg}`) : 'messages are hidden (ui-kit.error-text is off)',
      ],
    })),
  }
}

// ---------------------------------------------------------------- prompts

export type PromptsModel = { isEmpty: boolean; lens: number[]; ats: number[]; medianLen: number; longest: number; avgGapMs: number; nums: Num[]; items: Item[] }

export const promptsModel = (d: Data): PromptsModel => {
  const recent = d.prompts.slice(-30)
  const lens = recent.map(p => p.len)
  const gaps = d.prompts.slice(1).map((p, i) => p.at - (d.prompts[i]?.at ?? p.at)).filter(g => g >= 0)
  const avgGapMs = gaps.length === 0 ? 0 : gaps.reduce((s, g) => s + g, 0) / gaps.length
  const medianLen = median(lens)
  const longest = lens.length === 0 ? 0 : Math.max(...lens)
  const items: Item[] = d.prompts
    .map((p, i) => {
      const nextAt = d.prompts[i + 1]?.at ?? Number.POSITIVE_INFINITY
      const calls = d.calls.filter(c => c.startedAt >= p.at && c.startedAt < nextAt).length
      const gap = i === 0 ? undefined : p.at - (d.prompts[i - 1]?.at ?? p.at)

      return {
        id: `${p.at}-${i}`,
        title: `#${i + 1} at ${hhmm(p.at)}${p.snip === '' ? '' : `  ${p.snip}`}`,
        meta: `${p.len} chars`,
        detail: [
          `sent ${hhmmss(p.at)}`,
          `${p.len} characters (${p.len < 60 ? 'short' : p.len < 240 ? 'medium' : 'long'})`,
          gap === undefined ? 'the first of the session' : `${dur(gap)} after the one before`,
          `${calls} tool call${calls === 1 ? '' : 's'} before the next prompt`,
        ],
      }
    })
    .reverse()
    .slice(0, 30)

  return {
    isEmpty: d.prompts.length === 0,
    lens,
    ats: recent.map(p => p.at),
    medianLen,
    longest,
    avgGapMs,
    nums: [
      { key: 'prompts', label: 'prompts', value: String(d.prompts.length) },
      { key: 'median', label: 'median chars', value: String(Math.round(medianLen)) },
      { key: 'longest', label: 'longest', value: String(longest) },
    ],
    items,
  }
}

// ---------------------------------------------------------------- spend

export type SpendModel = { isEmpty: boolean; cum: number[]; ctx: number[]; deltas: number[]; ts: number[]; nums: Num[]; items: Item[] }

export const spendModel = (d: Data): SpendModel => {
  const num = (v: number, hi: number) => (Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : 0)
  const s = d.samples.map(x => ({ t: x.t, usd: num(x.usd, 1e6), ctx: num(x.ctx, 100) }))
  const cum = s.map(x => x.usd)
  const deltas = cum.map((v, i) => Math.max(0, v - (cum[i - 1] ?? 0)))
  const last = s[s.length - 1]
  const avg = s.length === 0 || last === undefined ? 0 : last.usd / s.length

  return {
    isEmpty: s.length === 0,
    cum,
    ctx: s.map(x => x.ctx),
    deltas,
    ts: s.map(x => x.t),
    nums: [
      { key: 'spend', label: 'spent', value: money(last?.usd ?? 0) },
      { key: 'ctx', label: 'context', value: `${Math.round(last?.ctx ?? 0)}%`, tone: (last?.ctx ?? 0) >= 85 ? 'bad' : (last?.ctx ?? 0) >= 70 ? 'warn' : undefined },
      { key: 'avg', label: 'per turn', value: money(avg) },
    ],
    items: [...s]
      .map((x, i) => ({
        id: String(x.t),
        title: `Turn ${i + 1} at ${hhmm(x.t)}`,
        meta: `+${money(deltas[i] ?? 0)}`,
        detail: [`total so far ${money(x.usd)}`, `context ${Math.round(x.ctx)}% full`, `this turn cost ${money(deltas[i] ?? 0)}`],
      }))
      .reverse()
      .slice(0, 20),
  }
}

// ---------------------------------------------------------------- activity

export type ToolRow = { tool: string; count: number; series: number[] }
export type ActivityModel = {
  isEmpty: boolean
  heat: { key: string; v: number }[]
  max: number
  hours: number[]
  tools: ToolRow[]
  nums: Num[]
  items: Item[]
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const activityModel = (d: Data): ActivityModel => {
  const base = new Date(d.now)
  base.setHours(12, 0, 0, 0)
  const heat = Array.from({ length: 84 }, (_, i) => {
    const key = dayKey(base.getTime() - (83 - i) * 86_400_000)

    const v = d.days[key] ?? 0

    return { key, v: Number.isFinite(v) && v > 0 ? v : 0 }
  })
  const max = Math.max(1, ...heat.map(h => h.v))
  const hours = d.hours.map(v => (Number.isFinite(v) && v > 0 ? v : 0))
  const tools = new Map<string, number[]>()
  const t0 = d.calls[0]?.startedAt ?? d.now
  const span = Math.max(1000, (d.calls[d.calls.length - 1]?.startedAt ?? d.now) - t0)

  for (const c of d.calls) {
    const arr = tools.get(c.tool) ?? Array.from({ length: 10 }, () => 0)
    const b = Math.min(9, Math.floor(((c.startedAt - t0) / span) * 10))
    arr[b] = (arr[b] ?? 0) + 1
    tools.set(c.tool, arr)
  }
  const rows: ToolRow[] = [...tools.entries()]
    .map(([tool, series]) => ({ tool, series, count: series.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
  const total = heat.reduce((s, h) => s + h.v, 0)
  const busiest = hours.reduce((bi, v, i) => (v > (hours[bi] ?? 0) ? i : bi), 0)
  const hasHours = hours.some(v => v > 0)
  const today = heat[83]?.v ?? 0

  return {
    isEmpty: total === 0 && d.calls.length === 0,
    heat,
    max,
    hours,
    tools: rows,
    nums: [
      { key: 'today', label: 'today', value: String(today) },
      { key: 'span', label: '12 weeks', value: String(total) },
      { key: 'busy', label: 'busiest hour', value: hasHours ? `${String(busiest).padStart(2, '0')}:00` : '-' },
    ],
    items: [...heat]
      .filter(h => h.v > 0)
      .sort((a, b) => b.v - a.v || (a.key < b.key ? 1 : -1))
      .slice(0, 8)
      .map(h => ({
        id: h.key,
        title: h.key,
        meta: `${h.v} calls`,
        detail: [`${WEEKDAYS[new Date(`${h.key}T12:00:00`).getDay()] ?? ''}`, `${Math.round((h.v / Math.max(1, total)) * 100)}% of the last 12 weeks`],
      })),
  }
}

