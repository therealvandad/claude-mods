// The twenty chart renderers. Each is a pure function: recorded data in, rows of text out.
// They draw with block, braille and box-drawing characters only (no images), so they are text charts.

import type {
  CallRec,
  DayRec,
  EditRec,
  ImportRec,
  PromptRec,
  SampleRec,
  SprintRec,
  TodoEv,
  TodoRec,
  TodoState,
  TurnRec,
} from '../types'

import {
  E,
  N,
  RING_CELLS,
  S,
  W,
  addDays,
  apportion,
  axisTime,
  apportionMin,
  base,
  boxGlyph,
  brailleOf,
  centre,
  clamp,
  dayKey,
  dim,
  dur,
  gapOf,
  heat,
  hhmm,
  levelOf,
  merge,
  monthName,
  note,
  p2,
  packOf,
  pad,
  padL,
  perimeter,
  ringGlyph,
  ringRows,
  seg,
  sideBySide,
  size,
  sparkOf,
  startOfDay,
  toneAt,
  trunc,
  usd,
  weekday,
  widthOf,
  wrap,
} from './draw'
import type { Opts, Row, Seg } from './draw'

export type ChartData = {
  now: number
  start: number
  calls: readonly CallRec[]
  prompts: readonly PromptRec[]
  turns: readonly TurnRec[]
  samples: readonly SampleRec[]
  edits: readonly EditRec[]
  imports: readonly ImportRec[]
  days: Readonly<Record<string, DayRec>>
  hours: readonly number[]
  sprints: readonly SprintRec[]
  todos: readonly TodoRec[]
  todoEv: readonly TodoEv[]
  budget: number | null
  usd: number | null
  ctx: number | null
  limit: number | null
}

export const EDIT_TOOLS = /^(Edit|Write|NotebookEdit)$/

// ================================================================ 35 donut gauges

export type Gauge = { label: string; percent: number | null; detail: string }

const gaugeBlock = (g: Gauge, o: Opts): Row[] => {
  const pk = packOf(o)
  const has = g.percent !== null
  const pct = clamp(g.percent ?? 0, 0, 100)
  const filled = Math.round((pct / 100) * RING_CELLS)
  const tone = heat(pct, o.accent)
  const cells: Seg[] = perimeter().map((c, i) => {
    const on = has && i < filled
    const glyph = ringGlyph(c.k, on, pk)

    return on ? seg(glyph, tone) : dim(glyph)
  })

  return ringRows(cells, [
    [dim(centre(trunc(g.label, 7), 7))],
    [seg(centre(has ? `${Math.round(pct)}%` : 'n/a', 7), has ? tone : undefined, !has, has)],
    [dim(centre(trunc(g.detail, 7), 7))],
  ])
}

export const donutRows = (d: ChartData, o: Opts): Row[] => {
  const spendPct = d.budget !== null && d.budget > 0 && d.usd !== null ? (d.usd / d.budget) * 100 : null
  const gauges: Gauge[] = [
    { label: 'context', percent: d.ctx, detail: 'window' },
    { label: 'spend', percent: spendPct, detail: d.usd === null ? '' : usd(d.usd) },
    { label: 'limit', percent: d.limit, detail: 'rate' },
  ]
  const rows = sideBySide(gauges.map(g => gaugeBlock(g, o)), gapOf(o))
  const out: Row[] = [...rows, [seg('')]]
  out.push([
    dim('context '),
    seg(d.ctx === null ? 'n/a' : `${Math.round(d.ctx)}%`, d.ctx === null ? undefined : heat(d.ctx, o.accent)),
    dim('   spend '),
    seg(d.usd === null ? 'n/a' : usd(d.usd), o.accent),
    dim(d.budget === null ? ' (no budget: /chbudget <usd> fills the ring)' : ` of ${usd(d.budget)}`),
  ])
  out.push([
    dim('rate limit '),
    seg(d.limit === null ? 'n/a' : `${Math.round(d.limit)}%`, d.limit === null ? undefined : heat(d.limit, o.accent)),
    dim('   ring: 24 cells, clockwise from the top'),
  ])

  return out
}

// ================================================================ 36 radial 24-hour clock

export const clockRows = (d: ChartData, o: Opts): Row[] => {
  const pk = packOf(o)
  const hours = Array.from({ length: 24 }, (_, i) => Math.max(0, d.hours[i] ?? 0))
  const max = Math.max(0, ...hours)
  const total = hours.reduce((a, b) => a + b, 0)
  const nowH = new Date(d.now).getHours()
  const peak = max === 0 ? -1 : hours.indexOf(max)
  const cells: Seg[] = hours.map((v, i) => {
    const lvl = levelOf(v, max)
    const isNow = i === nowH
    const glyph = lvl === 0 && isNow ? pk.off : (pk.ramp[lvl] ?? pk.ramp[0])

    return isNow ? seg(glyph, 'warning', false, true) : lvl === 0 ? dim(glyph) : seg(glyph, o.accent, lvl === 1)
  })
  const ring = ringRows(cells, [
    [dim(centre(max === 0 ? 'no use' : 'peak', 7))],
    [seg(centre(peak < 0 ? 'yet' : `${p2(peak)}:00`, 7), peak < 0 ? undefined : o.accent, peak < 0, peak >= 0)],
    [dim(centre(`now ${p2(nowH)}`, 7))],
  ])
  const part = (a: number, b: number): number => hours.slice(a, b).reduce((x, y) => x + y, 0)
  const side: Row[] = [
    [dim('hour 00 top, 06 right,')],
    [dim('12 bottom, 18 left.')],
    [seg('')],
    [dim('night   00-05 '), seg(String(part(0, 6)), o.accent)],
    [dim('morning 06-11 '), seg(String(part(6, 12)), o.accent)],
    [dim('midday  12-17 '), seg(String(part(12, 18)), o.accent)],
    [dim('evening 18-23 '), seg(String(part(18, 24)), o.accent)],
  ]
  const joined = sideBySide([ring, side], gapOf(o) + 1)

  return [
    ...joined,
    [seg('')],
    [dim(`${total} events, darker is busier: `), ...pk.ramp.slice(1).map((g, i) => seg(g, o.accent, i === 0)), dim('   ○ now (amber)')],
  ]
}

// ================================================================ 37 stacked bar of tool types

export const toolCounts = (calls: readonly CallRec[]): { name: string; n: number }[] => {
  const m = new Map<string, number>()

  for (const c of calls) {
    m.set(c.tool, (m.get(c.tool) ?? 0) + 1)
  }

  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
}

export const stackedRows = (calls: readonly CallRec[], o: Opts): Row[] => {
  const pk = packOf(o)
  const all = toolCounts(calls)
  const total = all.reduce((a, b) => a + b.n, 0)

  if (total === 0) {
    return [note('No tool calls yet. Every call adds to this bar.')]
  }
  const top = all.slice(0, 7)
  const rest = all.slice(7).reduce((a, b) => a + b.n, 0)
  const items = rest > 0 ? [...top, { name: 'other', n: rest }] : top
  const width = clamp(o.width - 2, 20, 70)
  const cells = apportion(items.map(i => i.n), width)
  const bar: Seg[] = items.map((it, i) => seg((pk.fills[i % 4] ?? pk.full).repeat(cells[i] ?? 0), toneAt(o.accent, i)))
  const out: Row[] = [merge(bar), [seg('')]]

  items.forEach((it, i) => {
    out.push([
      seg(pk.fills[i % 4] ?? pk.full, toneAt(o.accent, i)),
      seg(` ${pad(it.name, 11)}`),
      seg(padL(String(it.n), 4), undefined, false, true),
      dim(`  ${padL(String(Math.round((it.n / total) * 100)), 3)}%`),
    ])
  })
  out.push([dim(`${total} calls in all`)])

  return out
}

// ================================================================ 38 treemap of files touched

export const commonDir = (paths: readonly string[]): string => {
  const dirs = paths.map(p => p.split('/').slice(0, -1))
  let common = dirs[0] ?? []

  for (const dd of dirs) {
    let i = 0

    while (i < common.length && i < dd.length && common[i] === dd[i]) {
      i += 1
    }
    common = common.slice(0, i)
  }

  return common.join('/')
}

type Leaf = { name: string; n: number }

export const treemapRows = (edits: readonly { path: string; n: number }[], o: Opts): Row[] => {
  const items = edits.filter(e => e.n > 0)

  if (items.length === 0) {
    return [note('No edits recorded yet. Files changed by Edit, Write and NotebookEdit become boxes here.')]
  }
  const pk = packOf(o)
  const tw = clamp(o.width, 28, 100)
  const th = o.density === 'compact' ? 11 : o.density === 'airy' ? 17 : 13
  const root = commonDir(items.map(i => i.path))
  const groups = new Map<string, Leaf[]>()

  for (const it of items) {
    const rel = it.path.startsWith(`${root}/`) ? it.path.slice(root.length + 1) : it.path.replace(/^\//, '')
    const parts = rel.split('/')
    const file = parts.pop() ?? rel
    const dir = parts.join('/') || '.'
    groups.set(dir, [...(groups.get(dir) ?? []), { name: file, n: it.n }])
  }
  let cols = [...groups.entries()]
    .map(([dir, leaves]) => ({ dir, leaves: leaves.sort((a, b) => b.n - a.n), sum: leaves.reduce((s, l) => s + l.n, 0) }))
    .sort((a, b) => b.sum - a.sum || a.dir.localeCompare(b.dir))
  const maxCols = Math.max(1, Math.floor((tw - 1) / 8))

  if (cols.length > maxCols) {
    const keep = cols.slice(0, maxCols - 1)
    const tail = cols.slice(maxCols - 1)
    const merged = tail.flatMap(c => c.leaves.map(l => ({ name: c.dir === '.' ? l.name : `${base(c.dir)}/${l.name}`, n: l.n })))
    cols = [...keep, { dir: '…', leaves: merged.sort((a, b) => b.n - a.n), sum: merged.reduce((s, l) => s + l.n, 0) }]
  }
  const mask: number[][] = Array.from({ length: th }, () => Array.from({ length: tw }, () => 0))
  const label: (string | undefined)[][] = Array.from({ length: th }, () => Array.from({ length: tw }, () => undefined))
  const tone: number[][] = Array.from({ length: th }, () => Array.from({ length: tw }, () => 0))
  const put = (y: number, x: number, bits: number, gi: number): void => {
    const row = mask[y]
    const trow = tone[y]

    if (row !== undefined && trow !== undefined && x >= 0 && x < tw) {
      row[x] = (row[x] ?? 0) | bits
      trow[x] = gi
    }
  }
  const widths = apportionMin(cols.map(c => c.sum), tw - 1, 7)
  const maxLeaves = Math.max(1, Math.floor((th - 1) / 2))
  let x0 = 0

  cols.forEach((col, gi) => {
    const x1 = x0 + (widths[gi] ?? 0)
    let leaves = col.leaves

    if (leaves.length > maxLeaves) {
      const keep = leaves.slice(0, maxLeaves - 1)
      const tail = leaves.slice(maxLeaves - 1)
      leaves = [...keep, { name: `+${tail.length} more`, n: tail.reduce((s, l) => s + l.n, 0) }]
    }
    const heights = apportionMin(leaves.map(l => l.n), th - 1, 2)
    let y0 = 0

    leaves.forEach((leaf, li) => {
      const y1 = y0 + (heights[li] ?? 0)

      for (let x = x0; x <= x1; x += 1) {
        put(y0, x, (x > x0 ? W : 0) | (x < x1 ? E : 0), gi)
        put(y1, x, (x > x0 ? W : 0) | (x < x1 ? E : 0), gi)
      }

      for (let y = y0; y <= y1; y += 1) {
        put(y, x0, (y > y0 ? N : 0) | (y < y1 ? S : 0), gi)
        put(y, x1, (y > y0 ? N : 0) | (y < y1 ? S : 0), gi)
      }
      const inner = x1 - x0 - 1
      const tag = ` x${leaf.n}`
      const text = inner <= 0 ? '' : trunc(`${trunc(leaf.name, Math.max(1, inner - tag.length))}${tag}`, inner)
      const lrow = label[y0 + 1]
      const trow = tone[y0 + 1]

      if (lrow !== undefined && trow !== undefined) {
        for (let i = 0; i < text.length; i += 1) {
          lrow[x0 + 1 + i] = text.charAt(i)
          trow[x0 + 1 + i] = gi
        }
      }
      y0 = y1
    })
    x0 = x1
  })
  const out: Row[] = []

  for (let y = 0; y < th; y += 1) {
    const segs: Seg[] = []

    for (let x = 0; x < tw; x += 1) {
      const c = tone[y]?.[x] ?? 0
      const ch = label[y]?.[x]
      segs.push(ch !== undefined ? seg(ch, toneAt(o.accent, c), false, true) : seg(boxGlyph(mask[y]?.[x] ?? 0, pk.ascii), toneAt(o.accent, c), true))
    }
    out.push(merge(segs))
  }
  out.push([seg('')])
  out.push(
    merge(
      cols.flatMap((c, gi) => [seg(`${pk.full} `, toneAt(o.accent, gi)), seg(`${trunc(c.dir === '.' ? `${root === '' ? '.' : base(root)}/` : `${c.dir}/`, 22)} ${c.sum}   `, undefined, true)]),
    ),
  )
  out.push(...wrap(`box area follows edit counts; columns are folders under ${root === '' ? '/' : trunc(root, 40)}`, o.width))

  return out
}

// ================================================================ 39 heatmap calendar

const HEAT_DAYS = 90

export const heatmapRows = (days: Readonly<Record<string, DayRec>>, o: Opts): Row[] => {
  const pk = packOf(o)
  const today = startOfDay(o.now)
  const weeks = clamp(Math.floor((o.width - 5) / 2), 4, 13)
  const first = addDays(today, -weekday(today) - 7 * (weeks - 1))
  const cutoff = addDays(today, -(HEAT_DAYS - 1))
  const value = (ms: number): number => (ms > today || ms < cutoff ? -1 : (days[dayKey(ms)]?.n ?? 0))
  let max = 0
  let sum = 0
  let active = 0

  for (let c = 0; c < weeks; c += 1) {
    for (let r = 0; r < 7; r += 1) {
      const v = value(addDays(first, c * 7 + r))

      if (v > 0) {
        max = Math.max(max, v)
        sum += v
        active += 1
      }
    }
  }
  const head = Array.from({ length: weeks * 2 }, () => ' ')
  const marks: { c: number; ms: number }[] = []

  for (let c = 0; c < weeks; c += 1) {
    for (let r = 0; r < 7; r += 1) {
      const ms = addDays(first, c * 7 + r)

      if (new Date(ms).getDate() === 1) {
        marks.push({ c, ms })
      }
    }
  }

  if ((marks[0]?.c ?? 99) >= 3) {
    marks.unshift({ c: 0, ms: addDays(first, 3) })
  }

  for (const m of marks) {
    const name = monthName(m.ms)

    for (let i = 0; i < 3 && m.c * 2 + i < head.length; i += 1) {
      head[m.c * 2 + i] = name.charAt(i)
    }
  }
  const out: Row[] = [[dim(`    ${head.join('')}`)]]

  for (let r = 0; r < 7; r += 1) {
    const segs: Seg[] = [dim(r % 2 === 0 ? pad(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][r] ?? '', 4) : '    ')]

    for (let c = 0; c < weeks; c += 1) {
      const ms = addDays(first, c * 7 + r)
      const v = value(ms)

      if (v < 0) {
        segs.push(dim('  '))
      } else {
        const lvl = levelOf(v, max)
        const glyph = pk.ramp[lvl] ?? pk.ramp[0]
        segs.push(lvl === 0 ? dim(`${glyph} `) : seg(`${glyph} `, o.accent, lvl === 1, ms === today))
      }
    }
    out.push(merge(segs))
  }
  out.push([seg('')])
  out.push([
    dim('    less '),
    ...pk.ramp.map(g => seg(`${g} `, o.accent, g === pk.ramp[1] || g === pk.ramp[0])),
    dim('more'),
  ])
  out.push([dim(`    ${sum} in ${Math.min(weeks * 7, HEAT_DAYS)} days, ${active} active, best ${max}`)])

  return out
}

// ================================================================ 40 Gantt strip of tool calls

const endOf = (c: CallRec, now: number): number => c.endedAt ?? Math.max(now, c.startedAt)

export const ganttRows = (calls: readonly CallRec[], o: Opts): Row[] => {
  const list = calls.slice(-14)

  if (list.length === 0) {
    return [note('No tool calls yet. Each call draws one bar; calls that overlap run in parallel.')]
  }
  const pk = packOf(o)
  const label = 9
  const bw = clamp(o.width - label - 9, 12, 60)
  const t0 = Math.min(...list.map(c => c.startedAt))
  const t1 = Math.max(...list.map(c => endOf(c, o.now)))
  const span = Math.max(1, t1 - t0)
  const col = (t: number): number => clamp(Math.floor(((t - t0) / span) * bw), 0, bw - 1)
  const cover = Array.from({ length: bw }, () => 0)
  const lead = pk.ascii ? '.' : '·'
  const out: Row[] = []

  for (const c of list) {
    const s = col(c.startedAt)
    const e = Math.max(s, col(endOf(c, o.now)))

    for (let i = s; i <= e; i += 1) {
      cover[i] = (cover[i] ?? 0) + 1
    }
    const tone = c.isError ? 'error' : c.endedAt === null ? o.accent : 'success'
    out.push([
      dim(pad(c.tool, label)),
      dim(lead.repeat(s)),
      seg((c.endedAt === null ? (pk.ramp[2] ?? pk.full) : pk.full).repeat(e - s + 1), tone),
      dim(lead.repeat(bw - e - 1)),
      dim(`  ${c.endedAt === null ? 'running' : dur(c.endedAt - c.startedAt)}`),
    ])
  }
  const peak = Math.max(...cover)
  out.push([dim(`${pad('parallel', label)}`), ...merge(cover.map(n => (n === 0 ? dim(' ') : n >= 2 ? seg(n > 9 ? '+' : String(n), 'warning', false, true) : dim('1'))))])
  out.push([dim(`${pad('', label)}${axisTime(t0, span)}${' '.repeat(Math.max(1, bw - 16))}${axisTime(t1, span)}`)])
  out.push(...wrap(`window ${dur(span)}, ${list.length} calls, up to ${peak} at once. The digits under the bars count calls running in that column.`, o.width))

  return out
}

// ================================================================ 41 flame-like nested time

type FlameItem = { call: CallRec; depth: number; lane: number; s: number; e: number }

export const flameRows = (calls: readonly CallRec[], turn: { start: number; end: number } | null, o: Opts): Row[] => {
  if (calls.length === 0) {
    return [note('No tool calls in the last turn yet. Calls nest by time: a call that runs inside another sits one row below.')]
  }
  const pk = packOf(o)
  const sorted = [...calls].sort((a, b) => a.startedAt - b.startedAt || endOf(b, o.now) - endOf(a, o.now))
  const t0 = turn?.start ?? Math.min(...sorted.map(c => c.startedAt))
  const t1 = Math.max(turn?.end ?? 0, ...sorted.map(c => endOf(c, o.now)), t0 + 1)
  const bw = clamp(o.width - 5, 20, 80)
  const col = (t: number): number => clamp(Math.floor(((t - t0) / (t1 - t0)) * bw), 0, bw - 1)
  const items: FlameItem[] = sorted.map((c, i) => {
    let depth = 0

    sorted.forEach((p, j) => {
      if (j !== i && p.startedAt <= c.startedAt && endOf(p, o.now) >= endOf(c, o.now) && (p.startedAt < c.startedAt || endOf(p, o.now) > endOf(c, o.now) || j < i)) {
        depth += 1
      }
    })
    const s = col(c.startedAt)

    return { call: c, depth, lane: 0, s, e: Math.max(s, col(endOf(c, o.now))) }
  })
  const laneEnd = new Map<string, number>()

  for (const it of items) {
    let lane = 0

    while ((laneEnd.get(`${it.depth}/${lane}`) ?? -1) >= it.s) {
      lane += 1
    }
    it.lane = lane
    laneEnd.set(`${it.depth}/${lane}`, it.e)
  }
  const keys = [...new Set(items.map(i => `${i.depth}/${i.lane}`))].sort((a, b) => {
    const [ad = 0, al = 0] = a.split('/').map(Number)
    const [bd = 0, bl = 0] = b.split('/').map(Number)

    return ad - bd || al - bl
  })
  const out: Row[] = []
  const draw = (cells: Seg[], gutter: string): Row => [dim(gutter), ...merge(cells)]
  const fillGlyph = pk.ascii ? '.' : '░'
  const rootLen = bw
  const rootText = `turn ${dur(t1 - t0)}`
  out.push(draw([seg(`[${rootText}${fillGlyph.repeat(Math.max(0, rootLen - rootText.length - 2))}]`.slice(0, rootLen), 'subtle')], 'T  '))

  for (const key of keys) {
    const mine = items.filter(i => `${i.depth}/${i.lane}` === key)
    const cells: Seg[] = []
    let at = 0

    for (const [mi, it] of mine.entries()) {
      if (it.s > at) {
        cells.push(dim(' '.repeat(it.s - at)))
        at = it.s
      }
      const len = Math.min(bw - at, it.e - at + 1)

      if (len <= 0) {
        continue
      }
      const name = `${it.call.tool}${it.call.detail === '' ? '' : ` ${it.call.detail}`}`
      const tone = it.call.isError ? 'error' : toneAt(o.accent, it.depth)
      const body = len >= 4 ? `[${trunc(name, len - 2)}${fillGlyph.repeat(Math.max(0, len - 2 - Math.min(name.length, len - 2)))}]` : (mi % 2 === 0 ? pk.fills[0] : pk.fills[1]).repeat(len)
      cells.push(seg(body.slice(0, len), tone, false, it.depth === 0))
      at += len
    }
    out.push(draw(cells, `${key.split('/')[0] === '0' ? 'd0' : `d${key.split('/')[0]}`} `))
  }
  out.push([dim(`${pad('', 3)}${axisTime(t0, t1 - t0)}${' '.repeat(Math.max(1, bw - 16))}${axisTime(t1, t1 - t0)}`)])
  out.push(...wrap('rows are nesting depth (d0 outermost); a second row at one depth means calls ran side by side.', o.width))

  return out
}

// ================================================================ 42 dependency graph of edited files

const normPath = (p: string): string => {
  const out: string[] = []

  for (const part of p.split('/')) {
    if (part === '..') {
      out.pop()
    } else if (part !== '' && part !== '.') {
      out.push(part)
    }
  }

  return (p.startsWith('/') ? '/' : '') + out.join('/')
}

const stripExt = (p: string): string => p.replace(/\.[A-Za-z0-9]+$/, '')

/** The import specifiers in a piece of source: JS and TS, Python, C, Rust and Swift-like. */
export const importsOf = (src: string): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (s: string | undefined): void => {
    const v = (s ?? '').trim()

    if (v !== '' && v.length <= 120 && !seen.has(v) && out.length < 24) {
      seen.add(v)
      out.push(v)
    }
  }
  const text = src.slice(0, 60_000)
  const js = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*$]+(?:\s+as\s+[\w$]+)?\s*,?\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)?\s*from\s*['"]([^'"\n]+)['"]/g

  for (const m of text.matchAll(js)) {
    add(m[1])
  }

  for (const m of text.matchAll(/^[ \t]*import\s*['"]([^'"\n]+)['"]/gm)) {
    add(m[1])
  }

  for (const m of text.matchAll(/\b(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)/g)) {
    add(m[1])
  }

  for (const m of text.matchAll(/^[ \t]*from\s+(\.*[\w.]*)\s+import\s/gm)) {
    const spec = m[1] ?? ''
    const dots = /^\.+/.exec(spec)?.[0].length ?? 0
    const rest = spec.slice(dots).replace(/\./g, '/')
    add(dots === 0 ? spec : `${dots === 1 ? './' : '../'.repeat(dots - 1)}${rest}`)
  }

  for (const m of text.matchAll(/^[ \t]*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)\s*(?:#.*)?$/gm)) {
    for (const part of (m[1] ?? '').split(',')) {
      add(part)
    }
  }

  for (const m of text.matchAll(/^[ \t]*#\s*include\s*(["<])([^">\n]+)[">]/gm)) {
    add(m[1] === '"' ? `./${m[2]}` : m[2])
  }

  for (const m of text.matchAll(/^[ \t]*use\s+([\w:]+)/gm)) {
    add(m[1])
  }

  return out
}

export const depsRows = (imps: readonly ImportRec[], o: Opts): Row[] => {
  const recs = imps.filter(r => r.imports.length > 0)

  if (recs.length === 0) {
    return [note('No imports seen yet. Import lines in what Edit and Write put into files are listed here as a tree.')]
  }
  const pk = packOf(o)
  const root = commonDir(recs.map(r => r.path))
  const rel = (p: string): string => (root !== '' && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
  const forms = new Map<string, string>()

  for (const r of recs) {
    forms.set(r.path, r.path)
    forms.set(stripExt(r.path), r.path)

    if (/\/index\.[A-Za-z0-9]+$/.test(r.path)) {
      forms.set(r.path.replace(/\/index\.[A-Za-z0-9]+$/, ''), r.path)
    }
  }
  const byPath = new Map(recs.map(r => [r.path, r] as const))
  const resolve = (from: string, spec: string): string | undefined => {
    if (!spec.startsWith('.')) {
      return undefined
    }
    const joined = normPath(`${from.split('/').slice(0, -1).join('/')}/${spec}`)

    return forms.get(joined) ?? forms.get(stripExt(joined))
  }
  const edges: { from: string; to: string | undefined }[] = recs.flatMap(r => r.imports.map(spec => ({ from: r.path, to: resolve(r.path, spec) })))
  const targeted = new Set(edges.flatMap(e => (e.to !== undefined && e.to !== e.from ? [e.to] : [])))
  let roots = recs.filter(r => !targeted.has(r.path)).map(r => r.path)

  if (roots.length === 0) {
    roots = recs.map(r => r.path)
  }
  const out: Row[] = []
  const limit = 44
  const elbow = (last: boolean): string => (pk.ascii ? (last ? '`- ' : '|- ') : last ? '└─ ' : '├─ ')
  const trunk = (last: boolean): string => (pk.ascii ? (last ? '   ' : '|  ') : last ? '   ' : '│  ')
  const walk = (path: string, prefix: string, ancestors: readonly string[], depth: number): void => {
    const kids = byPath.get(path)?.imports ?? []

    kids.forEach((spec, i) => {
      if (out.length >= limit) {
        return
      }
      const last = i === kids.length - 1
      const to = resolve(path, spec)
      const isLoop = to !== undefined && ancestors.includes(to)
      out.push([
        dim(`${prefix}${elbow(last)}`),
        seg(spec, to !== undefined ? o.accent : undefined, to === undefined),
        to !== undefined ? dim(isLoop ? '  (cycle)' : `  = ${trunc(rel(to), 30)}`) : seg(''),
      ])

      if (to !== undefined && !isLoop && depth < 3) {
        walk(to, `${prefix}${trunk(last)}`, [...ancestors, to], depth + 1)
      }
    })
  }

  for (const r of roots) {
    if (out.length >= limit) {
      break
    }
    out.push([seg(trunc(rel(r), o.width - 2), toneAt(o.accent, 1), false, true)])
    walk(r, '', [r], 1)
  }
  const local = edges.filter(e => e.to !== undefined && e.to !== e.from).length
  out.push([seg('')])
  out.push([dim(`${recs.length} files, ${edges.length} imports, ${local} between edited files${out.length >= limit ? ' (tree cut at 44 lines)' : ''}`)])

  return out
}

// ================================================================ 43 transcript mini-map

export type MiniEvent = { t: number; kind: 'prompt' | 'edit' | 'error' | 'tool' }

export const miniEvents = (d: ChartData): MiniEvent[] => {
  const ev: MiniEvent[] = d.prompts.map(p => ({ t: p.at, kind: 'prompt' as const }))

  for (const c of d.calls) {
    ev.push({ t: c.startedAt, kind: c.isError ? 'error' : EDIT_TOOLS.test(c.tool) ? 'edit' : 'tool' })
  }

  return ev.sort((a, b) => a.t - b.t)
}

export const minimapRows = (ev: readonly MiniEvent[], start: number, end: number, o: Opts): Row[] => {
  if (ev.length === 0) {
    return [note('Nothing recorded yet. Prompts, edits, errors and tool calls become marks along the session.')]
  }
  const pk = packOf(o)
  const t0 = Math.min(start > 0 ? start : Infinity, ...ev.map(e => e.t))
  const t1 = Math.max(end, ...ev.map(e => e.t), t0 + 1)
  const bw = clamp(o.width - 12, 20, 72)
  const col = (t: number): number => clamp(Math.floor(((t - t0) / (t1 - t0)) * bw), 0, bw - 1)
  const count = (kind: MiniEvent['kind']): number[] => {
    const a = Array.from({ length: bw }, () => 0)

    for (const e of ev) {
      if (e.kind === kind) {
        a[col(e.t)] = (a[col(e.t)] ?? 0) + 1
      }
    }

    return a
  }
  const prompts = count('prompt')
  const edits = count('edit')
  const errors = count('error')
  const tools = count('tool')
  const maxTools = Math.max(0, ...tools)
  const strip: Seg[] = []

  for (let i = 0; i < bw; i += 1) {
    if ((errors[i] ?? 0) > 0) {
      strip.push(seg(pk.err, 'error', false, true))
    } else if ((edits[i] ?? 0) > 0) {
      strip.push(seg(pk.edit, 'success'))
    } else if ((prompts[i] ?? 0) > 0) {
      strip.push(seg(pk.prompt, o.accent, false, true))
    } else {
      const lvl = levelOf(tools[i] ?? 0, maxTools)
      strip.push(dim(pk.ramp[lvl] ?? pk.ramp[0]))
    }
  }
  const lane = (name: string, a: number[], glyph: string, tone: string): Row => [dim(pad(name, 9)), ...merge(a.map(n => (n > 0 ? seg(glyph, tone) : dim(pk.tool))))]
  const n = (k: MiniEvent['kind']): number => ev.filter(e => e.kind === k).length

  return [
    [dim(pad('session', 9)), ...merge(strip)],
    [seg('')],
    lane('prompts', prompts, pk.prompt, o.accent),
    lane('edits', edits, pk.edit, 'success'),
    lane('errors', errors, pk.err, 'error'),
    [dim(`${pad('', 9)}${hhmm(t0)}${' '.repeat(Math.max(1, bw - 10))}${hhmm(t1)}`)],
    [dim(`${n('prompt')} prompts, ${n('edit')} edits, ${n('error')} errors, ${n('tool')} other calls, ${dur(t1 - t0)}`)],
    ...wrap('top strip: one mark per column, worst first; shade shows tool traffic.', o.width),
  ]
}

// ================================================================ 44 diff minimap

export const diffmapRows = (edits: readonly EditRec[], o: Opts): Row[] => {
  if (edits.length === 0) {
    return [note('No edits recorded yet. Each edited file gets a strip: where the edits landed, or how big they were.')]
  }
  const pk = packOf(o)
  const list = [...edits].sort((a, b) => b.n - a.n).slice(0, 12)
  const nameW = 18
  const bw = clamp(o.width - nameW - 36, 8, 40)
  const biggest = Math.max(1, ...list.map(e => e.added + e.removed))
  const out: Row[] = []
  const root = commonDir(list.map(e => e.path))

  for (const e of list) {
    const rel = root !== '' && e.path.startsWith(`${root}/`) ? e.path.slice(root.length + 1) : base(e.path)
    const head: Seg = seg(pad(trunc(rel, nameW - 1), nameW), undefined, false, false)
    let bar: Seg[]
    let mode: string

    if (e.marks.length > 0) {
      const length = Math.max(e.lines, ...e.marks, 1)
      const hit = new Set(e.marks.map(m => clamp(Math.floor(((Math.max(1, m) - 1) / length) * bw), 0, bw - 1)))
      bar = Array.from({ length: bw }, (_, i) => (hit.has(i) ? seg(pk.full, o.accent) : dim(pk.empty)))
      mode = `to line ${length}`
    } else if (e.lines > 0 && e.removed === 0) {
      bar = [seg(pk.full.repeat(bw), 'success')]
      mode = `whole, ${e.lines} lines`
    } else {
      const total = e.added + e.removed
      const len = clamp(Math.round((total / biggest) * bw), total > 0 ? 1 : 0, bw)
      let [a = 0, r = 0] = apportion([e.added, e.removed], len)

      if (e.removed > 0 && r === 0 && len >= 2) {
        a = len - 1
        r = 1
      }
      bar = [seg((pk.fills[1] ?? pk.full).repeat(a), 'success'), seg((pk.fills[2] ?? pk.full).repeat(r), 'error'), dim(pk.empty.repeat(bw - a - r))]
      mode = 'size'
    }
    out.push([head, dim('▕'), ...merge(bar), dim('▏'), dim(` x${e.n} +${e.added}/-${e.removed}  ${mode}`)])
  }
  out.push([seg('')])
  out.push(...wrap('strips show the line where edits landed when a tool input or result carried line numbers, else the size of the change (green added, red removed).', o.width))

  return out
}

// ================================================================ 45 sankey-like flow

export const flowOf = (d: ChartData): { prompts: { name: string; n: number }[]; tools: { name: string; n: number }[]; files: { name: string; n: number }[] } => {
  const ps = [...d.prompts].sort((a, b) => a.at - b.at).slice(-6)
  const first = ps[0]?.at ?? 0
  const calls = d.calls.filter(c => c.startedAt >= first)
  const prompts = ps.map((p, i) => {
    const next = ps[i + 1]?.at ?? Infinity

    return { name: `${hhmm(p.at)} ${size(p.len)}`, n: calls.filter(c => c.startedAt >= p.at && c.startedAt < next).length }
  })
  const files = new Map<string, number>()

  for (const c of calls) {
    if (c.file !== undefined) {
      files.set(base(c.file), (files.get(base(c.file)) ?? 0) + 1)
    }
  }

  return {
    prompts,
    tools: toolCounts(calls).slice(0, 6),
    files: [...files.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 6),
  }
}

export const sankeyRows = (d: ChartData, o: Opts): Row[] => {
  const f = flowOf(d)

  if (f.prompts.length === 0 && f.tools.length === 0) {
    return [note('No prompts or calls yet. Three columns: prompts, the tools they used, the files those touched.')]
  }
  const pk = packOf(o)
  const colW = Math.max(14, Math.floor((o.width - 8) / 3))
  const labelW = Math.max(6, Math.min(10, colW - 9))
  const barW = Math.max(2, colW - labelW - 5)
  const column = (rows: { name: string; n: number }[], tone: string): Row[] => {
    const max = Math.max(1, ...rows.map(r => r.n))

    return rows.map(r => [
      dim(pad(trunc(r.name, labelW), labelW + 1)),
      seg(pk.full.repeat(Math.max(1, Math.round((r.n / max) * barW))), tone),
      seg(` ${r.n}`, undefined, false, true),
    ])
  }
  const heads: Row = [
    seg(pad('PROMPTS', colW), undefined, true, true),
    seg('   '),
    seg(pad('TOOLS', colW), undefined, true, true),
    seg('   '),
    seg('FILES', undefined, true, true),
  ]
  const cols = [column(f.prompts, toneAt(o.accent, 0)), column(f.tools, toneAt(o.accent, 1)), column(f.files, toneAt(o.accent, 2))]
  const h = Math.max(...cols.map(c => c.length))
  const out: Row[] = [heads]

  for (let i = 0; i < h; i += 1) {
    const row: Row = []

    cols.forEach((c, ci) => {
      const r = c[i] ?? []
      row.push(...r)
      row.push(seg(' '.repeat(Math.max(0, colW - widthOf(r)))))

      if (ci < 2) {
        row.push(dim(r.length === 0 ? '   ' : ` ${pk.ascii ? '>' : '▸'} `))
      }
    })
    out.push(merge(row))
  }
  out.push([seg('')])
  out.push(...wrap('bars are call counts. Columns are counts only: no ribbons join a prompt to its own tools.', o.width))

  return out
}

// ================================================================ 46 waffle of success vs error

export const waffleRows = (calls: readonly CallRec[], o: Opts): Row[] => {
  const pk = packOf(o)
  const done = calls.filter(c => c.endedAt !== null)
  const bad = done.filter(c => c.isError).length
  const good = done.length - bad

  if (done.length === 0) {
    return [note('No finished calls yet. 100 cells: each is one percent of finished calls.')]
  }
  let [okCells = 0, badCells = 0] = apportion([good, bad], 100)

  if (bad > 0 && badCells === 0) {
    badCells = 1
    okCells = 99
  }
  const side: Row[] = [
    [seg(pk.on, 'success'), seg(` ok     ${good} (${okCells}%)`)],
    [seg(pk.err, 'error'), seg(` error  ${bad} (${badCells}%)`)],
    [seg('')],
    [dim(`${done.length} finished calls`)],
    [dim('each cell is 1%')],
  ]
  const out: Row[] = []

  for (let r = 0; r < 10; r += 1) {
    const segs: Seg[] = []

    for (let c = 0; c < 10; c += 1) {
      const idx = r * 10 + c
      segs.push(idx < okCells ? seg(`${pk.on} `, 'success') : seg(`${pk.err} `, 'error'))
    }
    out.push([...merge(segs), seg('  '), ...(side[r] ?? [])])
  }

  return out
}

// ================================================================ 47 bullet chart for budgets

export const bulletBar = (actual: number, target: number | null, width: number, accent: string, pk = packOf({ width, accent, density: 'normal', icons: 'symbols', now: 0 })): Row => {
  const max = Math.max(target ?? 0, actual, 0.0001) * (target === null ? 1.05 : 1.25)
  const a = clamp(Math.round((actual / max) * width), actual > 0 ? 1 : 0, width)
  const t = target === null ? -1 : clamp(Math.round((target / max) * width), 0, width - 1)
  const ratio = target === null || target <= 0 ? 0 : actual / target
  const tone = ratio >= 1 ? 'error' : ratio >= 0.8 ? 'warning' : accent
  const cells: Seg[] = []

  for (let i = 0; i < width; i += 1) {
    if (i === t) {
      cells.push(seg(pk.ascii ? '|' : '│', undefined, false, true))
    } else if (i < a) {
      cells.push(seg(pk.full, tone))
    } else if (t >= 0 && i < t) {
      cells.push(dim(pk.ramp[2] ?? pk.empty))
    } else {
      cells.push(dim(pk.ramp[1] ?? pk.empty))
    }
  }

  return merge(cells)
}

export const bulletRows = (d: ChartData, o: Opts): Row[] => {
  const pk = packOf(o)
  const bw = clamp(o.width - 34, 12, 44)
  const today = d.days[dayKey(d.now)]?.usd ?? 0
  const items: { label: string; actual: number | null; target: number | null; show: (n: number) => string }[] = [
    { label: 'session', actual: d.usd, target: d.budget, show: usd },
    { label: 'today', actual: today > 0 || d.usd !== null ? today : null, target: d.budget, show: usd },
    { label: 'context', actual: d.ctx, target: 80, show: n => `${Math.round(n)}%` },
  ]
  const out: Row[] = []

  for (const it of items) {
    if (it.actual === null) {
      out.push([dim(`${pad(it.label, 8)}no reading yet`)])
      continue
    }

    if (it.target === null) {
      out.push([dim(pad(it.label, 8)), ...bulletBar(it.actual, null, bw, o.accent, pk), seg(`  ${it.show(it.actual)}`), dim('  no target: /chbudget <usd>')])
      continue
    }
    const pct = it.target > 0 ? Math.round((it.actual / it.target) * 100) : 0
    out.push([
      dim(pad(it.label, 8)),
      ...bulletBar(it.actual, it.target, bw, o.accent, pk),
      seg(`  ${it.show(it.actual)}`, pct >= 100 ? 'error' : pct >= 80 ? 'warning' : undefined, false, true),
      dim(` / ${it.show(it.target)}  ${pct}%`),
    ])
  }
  out.push([seg('')])
  out.push([dim(`${pk.full} actual   ${pk.ascii ? '|' : '│'} target   ${pk.ramp[2]} room left   ${pk.ramp[1]} beyond target`)])
  out.push(...wrap('spend target: /chbudget <usd>. Context target is a fixed 80%.', o.width))

  return out
}

// ================================================================ 48 sparkline per tool

export const sparksRows = (calls: readonly CallRec[], o: Opts): Row[] => {
  const pk = packOf(o)
  const done = calls.filter(c => c.endedAt !== null)

  if (done.length === 0) {
    return [note('No finished calls yet. Each tool gets a line of its recent durations.')]
  }
  const by = new Map<string, number[]>()

  for (const c of done) {
    by.set(c.tool, [...(by.get(c.tool) ?? []), (c.endedAt ?? c.startedAt) - c.startedAt])
  }
  const rows = [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 10)
  const out: Row[] = [[dim(`${pad('tool', 10)}${pad('last durations', 16)}${padL('n', 4)}${padL('avg', 8)}${padL('max', 8)}`)]]

  rows.forEach(([tool, all], i) => {
    const last = all.slice(-14)
    const avg = all.reduce((a, b) => a + b, 0) / all.length
    out.push([
      seg(pad(tool, 10), undefined, false, true),
      seg(pad(sparkOf(last, pk.spark), 16), toneAt(o.accent, i)),
      seg(padL(String(all.length), 4)),
      dim(padL(dur(avg), 8)),
      dim(padL(dur(Math.max(...all)), 8)),
    ])
  })

  return out
}

// ================================================================ 49 calendar of sprints

export const sprintsRows = (sprints: readonly SprintRec[], o: Opts): Row[] => {
  const pk = packOf(o)
  const today = startOfDay(o.now)
  const weeks = 5
  const first = addDays(today, -weekday(today) - 7 * (weeks - 1))
  const mins = new Map<string, number>()

  for (const s of sprints) {
    mins.set(dayKey(s.at), (mins.get(dayKey(s.at)) ?? 0) + s.min)
  }
  const out: Row[] = [[dim(`      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => pad(x, 6)).join('')}`)]]

  for (let w = 0; w < weeks; w += 1) {
    const rowStart = addDays(first, w * 7)
    const prevMonth = w === 0 ? -1 : new Date(addDays(first, (w - 1) * 7)).getMonth()
    const segs: Seg[] = [dim(pad(new Date(rowStart).getMonth() !== prevMonth ? monthName(rowStart) : '', 6))]

    for (let r = 0; r < 7; r += 1) {
      const ms = addDays(rowStart, r)
      const day = new Date(ms).getDate()
      const m = mins.get(dayKey(ms)) ?? 0
      const isToday = ms === today
      const label = isToday ? `[${p2(day)}]` : ` ${p2(day)} `

      if (ms > today) {
        segs.push(dim(`${label}  `))
      } else {
        segs.push(m > 0 ? seg(`${label}${pk.on} `, o.accent, false, isToday) : seg(`${label}  `, undefined, !isToday, isToday))
      }
    }
    out.push(merge(segs))
  }
  const total = sprints.reduce((a, s) => a + s.min, 0)
  const week = sprints.filter(s => s.at >= addDays(today, -weekday(today))).reduce((a, s) => a + s.min, 0)
  out.push([seg('')])
  out.push(...wrap(`${pk.on} = a day with a sprint.  ${sprints.length} sprints, ${total} min in all, ${week} min this week.`, o.width))

  if (sprints.length === 0) {
    out.push([dim('Log one with /chsprint 25 write the parser.')])
  }

  for (const s of sprints.slice(-5).reverse()) {
    out.push([dim(`${dayKey(s.at).slice(5)} ${hhmm(s.at)}  `), seg(padL(`${s.min}m`, 5), o.accent), seg(`  ${trunc(s.label, Math.max(10, o.width - 22))}`)])
  }

  return out
}

// ================================================================ 50 timeline of the day

export type DayEvent = { t: number; kind: 'prompt' | 'edit' | 'error' | 'turn' | 'sprint' | 'todo'; text: string }

export const timelineEvents = (d: ChartData): DayEvent[] => {
  const t0 = startOfDay(d.now)
  const ev: DayEvent[] = []

  for (const p of d.prompts) {
    ev.push({ t: p.at, kind: 'prompt', text: `prompt, ${p.len} characters` })
  }
  const seenFiles = new Set<string>()

  for (const c of [...d.calls].sort((a, b) => a.startedAt - b.startedAt)) {
    if (c.isError) {
      ev.push({ t: c.startedAt, kind: 'error', text: `${c.tool} failed${c.detail === '' ? '' : `: ${c.detail}`}` })
    } else if (EDIT_TOOLS.test(c.tool) && c.file !== undefined && !seenFiles.has(c.file)) {
      seenFiles.add(c.file)
      ev.push({ t: c.startedAt, kind: 'edit', text: `${c.tool} ${base(c.file)}` })
    }
  }

  for (const t of d.turns) {
    ev.push({ t: t.end, kind: 'turn', text: `reply done in ${dur(t.end - t.start)}` })
  }

  for (const s of d.sprints) {
    ev.push({ t: s.at, kind: 'sprint', text: `sprint ${s.min} min: ${s.label}` })
  }

  for (const e of d.todoEv) {
    if (e.to === 'done') {
      ev.push({ t: e.t, kind: 'todo', text: `todo done: ${d.todos.find(x => x.id === e.id)?.text ?? `#${e.id}`}` })
    }
  }

  return ev.filter(e => e.t >= t0).sort((a, b) => a.t - b.t)
}

export const timelineRows = (d: ChartData, o: Opts): Row[] => {
  const pk = packOf(o)
  const all = timelineEvents(d)

  if (all.length === 0) {
    return [note('Nothing recorded today yet. Prompts, edits, errors, replies, sprints and finished todos land here in order.')]
  }
  const look: Record<DayEvent['kind'], [string, string | undefined]> = {
    prompt: [pk.prompt, o.accent],
    edit: [pk.edit, 'success'],
    error: [pk.err, 'error'],
    turn: [pk.on, undefined],
    sprint: [pk.on, 'warning'],
    todo: [pk.on, 'success'],
  }
  const shown = all.slice(-18)
  const out: Row[] = []

  if (all.length > shown.length) {
    out.push([dim(`... ${all.length - shown.length} earlier today`)])
  }

  for (const e of shown) {
    const [glyph, tone] = look[e.kind]
    out.push([dim(`${hhmm(e.t)}  `), seg(`${glyph} `, tone, tone === undefined), seg(trunc(e.text, Math.max(12, o.width - 10)))])
  }

  return out
}

// ================================================================ 51 burndown and 52 cumulative flow

export const todoCounts = (events: readonly TodoEv[], at: number): { open: number; doing: number; done: number } => {
  const st = new Map<number, TodoState>()

  for (const e of events) {
    if (e.t <= at) {
      st.set(e.id, e.to)
    }
  }
  let open = 0
  let doing = 0
  let done = 0

  for (const s of st.values()) {
    if (s === 'open') {
      open += 1
    } else if (s === 'doing') {
      doing += 1
    } else if (s === 'done') {
      done += 1
    }
  }

  return { open, doing, done }
}

const series = (d: ChartData, bw: number): { t0: number; t1: number; pts: { open: number; doing: number; done: number }[] } => {
  const ev = [...d.todoEv].sort((a, b) => a.t - b.t)
  const t0 = ev[0]?.t ?? d.now
  const t1 = Math.max(d.now, ev[ev.length - 1]?.t ?? 0, t0 + 1)
  const pts = Array.from({ length: bw }, (_, i) => todoCounts(ev, t0 + ((i + 1) / bw) * (t1 - t0)))

  return { t0, t1, pts }
}

const NO_TODOS = 'No todos yet. /chtodo add <text>, then /chtodo doing <n> and /chtodo done <n>.'

export const burndownRows = (d: ChartData, o: Opts): Row[] => {
  if (d.todoEv.length === 0) {
    return [note(NO_TODOS)]
  }
  const pk = packOf(o)
  const bw = clamp(o.width - 9, 16, 60)
  const h = 8
  const { t0, t1, pts } = series(d, bw)
  const rem = pts.map(p => p.open + p.doing)
  const max = Math.max(1, ...rem)
  const out: Row[] = []

  for (let r = 0; r < h; r += 1) {
    const level = h - r
    const label = r === 0 ? padL(String(max), 3) : r === h - 1 ? padL('0', 3) : '   '
    const cells: Seg[] = rem.map((n, i) => {
      const height = Math.round((n / max) * h)
      const ideal = Math.round(max * (1 - (i + 0.5) / bw) * (h / max))

      if (height >= level) {
        return seg(pk.full, o.accent)
      }

      return ideal === level ? dim(pk.ascii ? '.' : '·') : dim(' ')
    })
    out.push([dim(`${label} ${pk.ascii ? '|' : '│'}`), ...merge(cells)])
  }
  out.push([dim(`    ${pk.ascii ? '+' : '└'}${(pk.ascii ? '-' : '─').repeat(bw)}`)])
  out.push([dim(`     ${hhmm(t0)}${' '.repeat(Math.max(1, bw - 10))}${hhmm(t1)}`)])
  const last = pts[pts.length - 1] ?? { open: 0, doing: 0, done: 0 }
  out.push(...wrap(`remaining ${last.open + last.doing}, done ${last.done}. Dots: the pace that finishes everything by now.`, o.width))

  return out
}

export const cfdRows = (d: ChartData, o: Opts): Row[] => {
  if (d.todoEv.length === 0) {
    return [note(NO_TODOS)]
  }
  const pk = packOf(o)
  const bw = clamp(o.width - 9, 16, 60)
  const h = 8
  const { t0, t1, pts } = series(d, bw)
  const max = Math.max(1, ...pts.map(p => p.open + p.doing + p.done))
  const out: Row[] = []

  for (let r = 0; r < h; r += 1) {
    const y = h - 1 - r
    const label = r === 0 ? padL(String(max), 3) : r === h - 1 ? padL('0', 3) : '   '
    const cells: Seg[] = pts.map(p => {
      const doneH = Math.round((p.done / max) * h)
      const doingH = Math.round(((p.done + p.doing) / max) * h)
      const openH = Math.round(((p.done + p.doing + p.open) / max) * h)

      return y < doneH ? seg(pk.fills[0], 'success') : y < doingH ? seg(pk.fills[1], 'warning') : y < openH ? seg(pk.fills[3], o.accent) : dim(' ')
    })
    out.push([dim(`${label} ${pk.ascii ? '|' : '│'}`), ...merge(cells)])
  }
  out.push([dim(`    ${pk.ascii ? '+' : '└'}${(pk.ascii ? '-' : '─').repeat(bw)}`)])
  out.push([dim(`     ${hhmm(t0)}${' '.repeat(Math.max(1, bw - 10))}${hhmm(t1)}`)])
  const last = pts[pts.length - 1] ?? { open: 0, doing: 0, done: 0 }
  out.push([
    seg(pk.fills[0], 'success'),
    dim(` done ${last.done}   `),
    seg(pk.fills[1], 'warning'),
    dim(` doing ${last.doing}   `),
    seg(pk.fills[3], o.accent),
    dim(` open ${last.open}`),
  ])

  return out
}

// ================================================================ 53 radar of session health

export type Factor = { label: string; score: number | null; note: string }

const maxRepeat = (calls: readonly CallRec[]): number => {
  const m = new Map<string, number>()
  let best = 0

  for (const c of calls.slice(-20)) {
    const k = `${c.tool}|${c.detail}`
    const n = (m.get(k) ?? 0) + 1
    m.set(k, n)
    best = Math.max(best, n)
  }

  return best
}

export const factorsOf = (d: ChartData): Factor[] => {
  const done = d.calls.filter(c => c.endedAt !== null)
  const bad = done.filter(c => c.isError).length
  const errScore = done.length === 0 ? null : clamp((bad / done.length) * 400, 0, 100)
  const rep = maxRepeat(d.calls)
  const loopScore = d.calls.length < 3 ? null : clamp(((rep - 1) / 4) * 100, 0, 100)
  const span = d.now - d.start
  const busy = d.turns.reduce((a, t) => a + Math.max(0, t.end - t.start), 0)
  const idleScore = d.start <= 0 || span < 60_000 ? null : clamp((1 - busy / span) * 100, 0, 100)
  let spend: number | null = null
  let basis = 'no reading'

  if (d.budget !== null && d.budget > 0 && d.usd !== null) {
    spend = clamp((d.usd / d.budget) * 100, 0, 100)
    basis = `${usd(d.usd)} of ${usd(d.budget)} budget`
  } else if (d.limit !== null) {
    spend = clamp(d.limit, 0, 100)
    basis = `rate limit ${Math.round(d.limit)}%`
  } else if (d.usd !== null && span >= 300_000) {
    const perHour = d.usd / (span / 3_600_000)
    spend = clamp((perHour / 10) * 100, 0, 100)
    basis = `${usd(perHour)}/h against $10/h`
  }

  return [
    { label: 'errors', score: errScore, note: done.length === 0 ? 'no finished calls' : `${bad} of ${done.length} calls failed` },
    { label: 'loops', score: loopScore, note: loopScore === null ? 'too few calls' : `same call ${rep}x in the last 20` },
    { label: 'context', score: d.ctx === null ? null : clamp(d.ctx, 0, 100), note: d.ctx === null ? 'no reading' : `${Math.round(d.ctx)}% of the window` },
    { label: 'spend', score: spend, note: basis },
    { label: 'idle', score: idleScore, note: idleScore === null ? 'session too short' : `${Math.round(100 - idleScore)}% of the time busy` },
  ]
}

export const radarRows = (d: ChartData, o: Opts): Row[] => {
  const pk = packOf(o)
  const factors = factorsOf(d)
  const bw = clamp(o.width - 36, 10, 30)
  const out: Row[] = []

  for (const f of factors) {
    const tone = f.score === null ? undefined : f.score >= 70 ? 'error' : f.score >= 40 ? 'warning' : 'success'
    const cells = f.score === null ? 0 : Math.round((f.score / 100) * bw)
    out.push([
      seg(pad(f.label, 9), undefined, false, true),
      dim(pk.ascii ? '[' : '▕'),
      seg(pk.full.repeat(cells), tone),
      dim(pk.empty.repeat(bw - cells)),
      dim(pk.ascii ? ']' : '▏'),
      seg(f.score === null ? '  n/a' : padL(`${Math.round(f.score)}`, 4), tone, f.score === null, f.score !== null),
      dim(`  ${trunc(f.note, Math.max(10, o.width - 9 - bw - 8))}`),
    ])
  }
  const known = factors.filter(f => f.score !== null)
  const avg = known.length === 0 ? null : known.reduce((a, f) => a + (f.score ?? 0), 0) / known.length
  out.push([seg('')])
  out.push([
    seg('health    ', undefined, false, true),
    seg(avg === null ? 'n/a' : `${Math.round(100 - avg)}/100`, avg === null ? undefined : avg >= 60 ? 'error' : avg >= 35 ? 'warning' : 'success', avg === null, avg !== null),
  ])
  out.push(...wrap('each bar runs from 0 (calm) to 100 (worst); the health score is 100 minus their mean.', o.width))

  return out
}

// ================================================================ 54 scatter of duration vs output size

export const scatterRows = (calls: readonly CallRec[], o: Opts): Row[] => {
  const pts = calls.filter(c => c.endedAt !== null).map(c => ({ x: Math.max(0, (c.endedAt ?? c.startedAt) - c.startedAt), y: Math.max(0, c.out), err: c.isError }))

  if (pts.length === 0) {
    return [note('No finished calls yet. Each call becomes a dot: how long it ran against how much text it returned.')]
  }
  const pk = packOf(o)
  const cw = clamp(o.width - 8, 16, 56)
  const rh = o.density === 'compact' ? 6 : o.density === 'airy' ? 10 : 8
  const maxX = Math.max(1, ...pts.map(p => p.x))
  const maxY = Math.max(1, ...pts.map(p => p.y))
  const lx = Math.log1p(maxX)
  const ly = Math.log1p(maxY)
  const grid = new Map<string, { dots: [number, number][]; err: boolean; n: number }>()

  for (const p of pts) {
    const dx = clamp(Math.floor((Math.log1p(p.x) / lx) * (cw * 2 - 1)), 0, cw * 2 - 1)
    const dy = clamp(Math.floor((1 - Math.log1p(p.y) / ly) * (rh * 4 - 1)), 0, rh * 4 - 1)
    const key = `${dx >> 1},${dy >> 2}`
    const cell = grid.get(key) ?? { dots: [], err: false, n: 0 }
    cell.dots.push([dx & 1, dy & 3])
    cell.err = cell.err || p.err
    cell.n += 1
    grid.set(key, cell)
  }
  const out: Row[] = []

  for (let r = 0; r < rh; r += 1) {
    const label = r === 0 ? padL(size(maxY), 6) : r === rh - 1 ? padL('0', 6) : '      '
    const segs: Seg[] = []

    for (let c = 0; c < cw; c += 1) {
      const cell = grid.get(`${c},${r}`)

      if (cell === undefined) {
        segs.push(dim(pk.ascii ? ' ' : '⠀'))
      } else {
        const glyph = pk.ascii ? (pk.ramp[clamp(cell.n, 1, 4)] ?? '*') : brailleOf(cell.dots)
        segs.push(seg(glyph, cell.err ? 'error' : o.accent))
      }
    }
    out.push([dim(`${label} ${pk.ascii ? '|' : '│'}`), ...merge(segs)])
  }
  out.push([dim(`${' '.repeat(7)}${pk.ascii ? '+' : '└'}${(pk.ascii ? '-' : '─').repeat(cw)}`)])
  out.push([dim(`${' '.repeat(8)}0${' '.repeat(Math.max(1, cw - 1 - dur(maxX).length))}${dur(maxX)}`)])
  out.push(...wrap(`x: time the call took, y: characters returned, both on a log scale. ${pts.length} calls; red cells hold a failure.`, o.width))

  return out
}

// ================================================================ the table that ties them together

export type ChartId =
  | 'donut'
  | 'clock'
  | 'bullet'
  | 'radar'
  | 'waffle'
  | 'stack'
  | 'spark'
  | 'scatter'
  | 'flow'
  | 'gantt'
  | 'flame'
  | 'minimap'
  | 'timeline'
  | 'heat'
  | 'tree'
  | 'deps'
  | 'diff'
  | 'sprints'
  | 'burn'
  | 'cfd'

export type ChartMeta = { id: ChartId; group: string; label: string; title: string; idea: number; about: string }

export const GROUPS = [
  ['gauges', 'Gauges'],
  ['tools', 'Tools'],
  ['time', 'Time'],
  ['files', 'Files'],
  ['plan', 'Plan'],
] as const

export const CHARTS: readonly ChartMeta[] = [
  { id: 'donut', group: 'gauges', label: 'Donut', title: 'Donut gauges', idea: 35, about: 'Context, spend and rate limit as rings of 24 cells.' },
  { id: 'clock', group: 'gauges', label: '24h clock', title: 'Radial 24-hour clock', idea: 36, about: 'Your own activity by hour of day, kept across sessions.' },
  { id: 'bullet', group: 'gauges', label: 'Budget', title: 'Budget bullet chart', idea: 47, about: 'Spend against /chbudget, today against it, and context against 80%.' },
  { id: 'radar', group: 'gauges', label: 'Health', title: 'Session health', idea: 53, about: 'Errors, loops, context, spend and idle share as five bars.' },
  { id: 'waffle', group: 'gauges', label: 'Waffle', title: 'Success against error', idea: 46, about: '100 cells, one per percent of finished tool calls.' },
  { id: 'stack', group: 'tools', label: 'Tool mix', title: 'Tool mix', idea: 37, about: 'One stacked bar of calls by tool.' },
  { id: 'spark', group: 'tools', label: 'Sparklines', title: 'A sparkline per tool', idea: 48, about: 'Recent durations of each tool.' },
  { id: 'scatter', group: 'tools', label: 'Scatter', title: 'Duration against output size', idea: 54, about: 'One braille dot per finished call.' },
  { id: 'flow', group: 'tools', label: 'Flow', title: 'Prompts to tools to files', idea: 45, about: 'Three columns of counts with proportional bars.' },
  { id: 'gantt', group: 'time', label: 'Gantt', title: 'Gantt strip of tool calls', idea: 40, about: 'Bars on a shared time axis; overlap means parallel.' },
  { id: 'flame', group: 'time', label: 'Flame', title: 'Nested time of the last turn', idea: 41, about: 'Calls as nested rows, outermost first.' },
  { id: 'minimap', group: 'time', label: 'Mini-map', title: 'Transcript mini-map', idea: 43, about: 'The whole session in one narrow strip.' },
  { id: 'timeline', group: 'time', label: 'Today', title: 'Timeline of the day', idea: 50, about: 'Today\'s events in order, with times.' },
  { id: 'heat', group: 'time', label: 'Heatmap', title: 'Activity heatmap', idea: 39, about: 'Up to 90 days of your own daily counts (calls plus prompts).' },
  { id: 'tree', group: 'files', label: 'Treemap', title: 'Treemap of files touched', idea: 38, about: 'Nested boxes sized by edit counts.' },
  { id: 'deps', group: 'files', label: 'Imports', title: 'Import tree of edited files', idea: 42, about: 'Import lines found in what was written, as an indented tree.' },
  { id: 'diff', group: 'files', label: 'Diff map', title: 'Diff minimap', idea: 44, about: 'Where in each file the edits landed, or how big they were.' },
  { id: 'sprints', group: 'plan', label: 'Sprints', title: 'Calendar of sprints', idea: 49, about: 'Five weeks from this mod\'s own log: /chsprint <min> <label>.' },
  { id: 'burn', group: 'plan', label: 'Burndown', title: 'Todo burndown', idea: 51, about: 'Items left over time, from /chtodo.' },
  { id: 'cfd', group: 'plan', label: 'Flow strip', title: 'Cumulative flow', idea: 52, about: 'Open, doing and done over time, from /chtodo.' },
]

export const turnCalls = (d: ChartData): { calls: CallRec[]; turn: { start: number; end: number } | null } => {
  const lastPrompt = d.prompts[d.prompts.length - 1]
  const lastTurn = d.turns[d.turns.length - 1]
  const from = lastPrompt?.at ?? lastTurn?.start ?? 0
  const calls = d.calls.filter(c => c.startedAt >= from)
  const end = lastTurn !== undefined && lastTurn.end >= from ? lastTurn.end : Math.max(d.now, ...calls.map(c => endOf(c, d.now)))

  return { calls, turn: calls.length === 0 && lastPrompt === undefined ? null : { start: from, end } }
}

export const renderChart = (id: string, d: ChartData, o: Opts): Row[] => {
  switch (id) {
    case 'donut':
      return donutRows(d, o)
    case 'clock':
      return clockRows(d, o)
    case 'bullet':
      return bulletRows(d, o)
    case 'radar':
      return radarRows(d, o)
    case 'waffle':
      return waffleRows(d.calls, o)
    case 'stack':
      return stackedRows(d.calls, o)
    case 'spark':
      return sparksRows(d.calls, o)
    case 'scatter':
      return scatterRows(d.calls, o)
    case 'flow':
      return sankeyRows(d, o)
    case 'gantt':
      return ganttRows(d.calls, o)
    case 'flame': {
      const t = turnCalls(d)

      return flameRows(t.calls, t.turn, o)
    }
    case 'minimap':
      return minimapRows(miniEvents(d), d.start, d.now, o)
    case 'timeline':
      return timelineRows(d, o)
    case 'heat':
      return heatmapRows(d.days, o)
    case 'tree':
      return treemapRows(d.edits, o)
    case 'deps':
      return depsRows(d.imports, o)
    case 'diff':
      return diffmapRows(d.edits, o)
    case 'sprints':
      return sprintsRows(d.sprints, o)
    case 'burn':
      return burndownRows(d, o)
    case 'cfd':
      return cfdRows(d, o)
    default:
      return [note(`Unknown chart "${id}".`)]
  }
}
