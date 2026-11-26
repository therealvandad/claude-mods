import { expect, test } from 'claude-code/testing'

import {
  CHARTS,
  GROUPS,
  bulletBar,
  bulletRows,
  burndownRows,
  cfdRows,
  clockRows,
  depsRows,
  diffmapRows,
  donutRows,
  factorsOf,
  flameRows,
  flowOf,
  ganttRows,
  heatmapRows,
  importsOf,
  minimapRows,
  miniEvents,
  radarRows,
  renderChart,
  sankeyRows,
  scatterRows,
  sparksRows,
  sprintsRows,
  stackedRows,
  timelineEvents,
  timelineRows,
  todoCounts,
  toolCounts,
  treemapRows,
  waffleRows,
} from './charts'
import type { ChartData } from './charts'
import { demoData } from './demo'
import { PACKS, apportion, apportionMin, perimeter, plain, text, widthOf } from './draw'
import type { Icons, Opts } from './draw'
import type { CallRec } from '../types'

// Wednesday 25 November 2026, noon, in local time so the tests do not depend on the time zone.
const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime()
const O: Opts = { width: 60, accent: 'suggestion', density: 'normal', icons: 'symbols', now: NOW }
const EMPTY: ChartData = {
  now: NOW,
  start: 0,
  calls: [],
  prompts: [],
  turns: [],
  samples: [],
  edits: [],
  imports: [],
  days: {},
  hours: [],
  sprints: [],
  todos: [],
  todoEv: [],
  budget: null,
  usd: null,
  ctx: null,
  limit: null,
}
const call = (tool: string, s: number, e: number | null, more: Partial<CallRec> = {}): CallRec => ({
  id: `${tool}${s}`,
  tool,
  detail: '',
  startedAt: s,
  endedAt: e,
  isError: false,
  out: 0,
  ...more,
})
const lines = (rows: Parameters<typeof plain>[0]) => plain(rows)

test('apportion gives whole numbers that always add up', () => {
  expect(apportion([3, 1], 58)).toEqual([44, 14])
  expect(apportion([1, 1, 1], 10)).toEqual([4, 3, 3])
  expect(apportion([0, 0], 10)).toEqual([0, 0])
  expect(apportion([5, 0, 5], 0)).toEqual([0, 0, 0])
  expect(apportionMin([100, 1, 1], 12, 3)).toEqual([6, 3, 3])
  expect(apportionMin([1, 1], 3, 2)).toEqual([2, 1])
})

test('every glyph pack has a 5 step ramp and an 8 step sparkline', () => {
  for (const key of ['symbols', 'letters', 'minimal'] as const) {
    expect(PACKS[key].ramp.length).toBe(5)
    expect([...PACKS[key].spark].length).toBe(8)
  }
  expect(/^[\x20-\x7e]+$/.test(Object.values(PACKS.letters).flat().join(''))).toBe(true)
})

test('the ring outline has 24 cells starting at the top middle, clockwise', () => {
  const p = perimeter()
  expect(p.length).toBe(24)
  expect(p[0]).toEqual({ x: 4, y: 0, k: 'h' })
  expect(p[6]).toEqual({ x: 8, y: 2, k: 'v' })
  expect(p[12]).toEqual({ x: 4, y: 4, k: 'h' })
  expect(p[18]).toEqual({ x: 0, y: 2, k: 'v' })
  expect(new Set(p.map(c => `${c.x},${c.y}`)).size).toBe(24)
})

// ------------------------------------------------------------ 35

test('35 donut: a half full ring fills 12 of 24 cells clockwise from the top, n/a rings stay empty', () => {
  const rows = lines(donutRows({ ...EMPTY, ctx: 50 }, O))
  expect(rows.slice(0, 5).map(r => r.slice(0, 9))).toEqual(['◜───━━━━◝', '│context┃', '│  50%  ┃', '│window ┃', '◟────━━━◞'])
  expect(rows[0]).toBe('◜───━━━━◝  ◜───────◝  ◜───────◝')
  expect(rows[2]).toBe('│  50%  ┃  │  n/a  │  │  n/a  │')
  expect(rows[6]).toMatch(/context 50%\s+spend n\/a/)
})

test('35 donut: spend uses the budget, warns past 70 and fails past 85, and the letters pack is plain ASCII', () => {
  const d = { ...EMPTY, usd: 4.5, budget: 5, ctx: 90 }
  const rows = donutRows(d, O)
  expect(rows[2]?.some(s => s.t.includes('90%') && s.c === 'error')).toBe(true)
  expect(rows[2]?.some(s => s.t.includes('90%') && s.c === 'suggestion')).toBe(false)
  // spend is 4.5 of 5: 90 percent as well
  expect(rows[2]?.filter(s => s.t.includes('90%') && s.c === 'error').length).toBe(2)
  const calm = donutRows({ ...EMPTY, ctx: 30 }, O)
  expect(calm[2]?.some(s => s.t.includes('30%') && s.c === 'suggestion')).toBe(true)
  const ascii = text(donutRows(d, { ...O, icons: 'letters' }))
  expect(/^[\x20-\x7e\n]+$/.test(ascii)).toBe(true)
})

// ------------------------------------------------------------ 36

test('36 clock: hours land on the 24 ring cells, the current hour is hollow', () => {
  const hours = Array.from({ length: 24 }, () => 0)
  hours[0] = 8
  hours[3] = 2
  hours[6] = 4
  const rows = lines(clockRows({ ...EMPTY, hours }, O))
  expect(rows[0]?.slice(0, 9)).toBe('····█··░·')
  expect(rows[2]?.slice(0, 9)).toBe('· 00:00 ▒')
  expect(rows[4]?.slice(0, 9)).toBe('····○····')
  expect(rows[3]).toMatch(/^·now 12 ·   night/)
  expect(rows.join('\n')).toMatch(/night\s+00-05 10/)
  expect(rows[rows.length - 1]).toMatch(/^14 events/)
})

test('36 clock: no data says so', () => {
  const rows = lines(clockRows(EMPTY, O))
  expect(rows[1]).toMatch(/no use/)
  expect(rows[2]).toMatch(/yet/)
})

// ------------------------------------------------------------ 37

test('37 stacked bar: segments share the width by call count', () => {
  const calls = [call('Read', 0, 1), call('Read', 1, 2), call('Read', 2, 3), call('Edit', 3, 4)]
  expect(toolCounts(calls)).toEqual([{ name: 'Read', n: 3 }, { name: 'Edit', n: 1 }])
  const rows = lines(stackedRows(calls, O))
  expect(rows[0]).toBe('█'.repeat(44) + '▓'.repeat(14))
  expect(rows[2]).toBe('█ Read          3   75%')
  expect(rows[3]).toBe('▓ Edit          1   25%')
  expect(rows[4]).toBe('4 calls in all')
})

test('37 stacked bar: more than seven tools fold into other, and empty is a note', () => {
  const calls = Array.from({ length: 9 }, (_, i) => call(`T${i}`, i, i + 1))
  const rows = lines(stackedRows(calls, O))
  expect(rows.some(r => /other\s+2/.test(r))).toBe(true)
  expect(lines(stackedRows([], O))[0]).toMatch(/No tool calls yet/)
})

// ------------------------------------------------------------ 38

test('38 treemap: box height follows edit counts and the borders join', () => {
  const edits = [{ path: '/p/src/a.ts', n: 3 }, { path: '/p/src/b.ts', n: 1 }]
  const rows = lines(treemapRows(edits, { ...O, width: 28 }))
  expect(rows[0]).toBe(`┌${'─'.repeat(26)}┐`)
  expect(rows[1]).toBe(`│a.ts x3${' '.repeat(19)}│`)
  expect(rows[8]).toBe(`├${'─'.repeat(26)}┤`)
  expect(rows[9]).toBe(`│b.ts x1${' '.repeat(19)}│`)
  expect(rows[12]).toBe(`└${'─'.repeat(26)}┘`)
  expect(rows[14]).toMatch(/src\/ 4/)
})

test('38 treemap: two folders become two columns with a T junction, ASCII uses plus signs', () => {
  const edits = [{ path: '/p/a/x.ts', n: 2 }, { path: '/p/b/y.ts', n: 2 }]
  const rows = lines(treemapRows(edits, { ...O, width: 31 }))
  expect(rows[0]).toBe(`┌${'─'.repeat(14)}┬${'─'.repeat(14)}┐`)
  expect(rows[12]).toBe(`└${'─'.repeat(14)}┴${'─'.repeat(14)}┘`)
  const ascii = lines(treemapRows(edits, { ...O, width: 31, icons: 'letters' }))
  expect(ascii[0]).toBe(`+${'-'.repeat(14)}+${'-'.repeat(14)}+`)
  expect(ascii[1]).toBe(`|x.ts x2${' '.repeat(7)}|y.ts x2${' '.repeat(7)}|`)
})

test('38 treemap: many files in one folder fold the tail into a "+n more" box', () => {
  const edits = Array.from({ length: 12 }, (_, i) => ({ path: `/p/f${i}.ts`, n: 12 - i }))
  const rows = lines(treemapRows(edits, { ...O, width: 30 }))
  expect(rows.some(r => /\+7 more/.test(r))).toBe(true)
  expect(lines(treemapRows([], O))[0]).toMatch(/No edits recorded yet/)
})

// ------------------------------------------------------------ 39

test('39 heatmap: today is the last column, the busiest day is full, old days are left out', () => {
  const key = (back: number) => {
    const d = new Date(2026, 10, 25 - back)

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const days = { [key(0)]: { n: 5, usd: 0 }, [key(1)]: { n: 2, usd: 0 }, [key(100)]: { n: 50, usd: 0 } }
  const rows = lines(heatmapRows(days, O))
  expect(rows.length).toBe(11)
  expect(rows[0]).toMatch(/Sep.*Oct.*Nov/)
  expect(rows[3]).toMatch(/^Wed .*█ $/)
  expect(rows[2]).toMatch(/▒ $/)
  expect(rows[10]).toMatch(/7 in 90 days, 2 active, best 5/)
  expect(rows.slice(1, 8).every(r => r.length === 4 + 26)).toBe(true)
})

test('39 heatmap: a narrow pane shows fewer weeks', () => {
  const rows = lines(heatmapRows({}, { ...O, width: 25 }))
  expect(rows[1]?.length).toBe(4 + 20 * 1)
})

// ------------------------------------------------------------ 40

test('40 gantt: overlap shows as the parallel digit row', () => {
  const calls = [call('Read', 0, 1000), call('Bash', 500, 2000), call('Edit', 3000, 4000, { isError: true })]
  const rows = lines(ganttRows(calls, O))
  expect(rows[0]).toBe(`Read     ${'█'.repeat(11)}${'·'.repeat(31)}  1.0s`)
  expect(rows[1]).toBe(`Bash     ${'·'.repeat(5)}${'█'.repeat(17)}${'·'.repeat(20)}  1.5s`)
  expect(rows[3]).toBe(`parallel ${'1'.repeat(5)}${'2'.repeat(6)}${'1'.repeat(11)}${' '.repeat(9)}${'1'.repeat(11)}`)
  expect(rows[5]).toMatch(/3 calls, up to 2 at once/)
  const colours = ganttRows(calls, O).slice(0, 3).map(r => r.find(s => s.t.includes('█'))?.c)
  expect(colours).toEqual(['success', 'success', 'error'])
})

test('40 gantt: a running call is drawn with the lighter shade and says running', () => {
  const rows = lines(ganttRows([call('Task', NOW - 1000, null)], O))
  expect(rows[0]).toMatch(/^Task +▒+ +running$/)
  expect(lines(ganttRows([], O))[0]).toMatch(/No tool calls yet/)
})

// ------------------------------------------------------------ 41

test('41 flame: a call inside another sits one row down, side by side calls share a row', () => {
  const calls = [call('Task', 0, 1000, { detail: 'plan' }), call('Read', 200, 600, { detail: 'a.ts' }), call('Bash', 1100, 1500, { detail: 'npm' })]
  const rows = lines(flameRows(calls, { start: 0, end: 2000 }, O))
  expect(rows[0]).toBe(`T  [turn 2.0s${'░'.repeat(55 - 2 - 'turn 2.0s'.length)}]`)
  expect(rows[1]?.startsWith('d0 [Task plan')).toBe(true)
  expect(rows[1]?.includes('[Bash npm')).toBe(true)
  expect(rows[2]?.startsWith('d1 ')).toBe(true)
  expect(rows[2]?.includes('[Read a.ts')).toBe(true)
  expect(rows[2]?.includes('Task')).toBe(false)
})

test('41 flame: overlapping calls that do not nest get their own row at the same depth', () => {
  const rows = lines(flameRows([call('Read', 0, 600), call('Grep', 300, 900)], { start: 0, end: 1000 }, O))
  expect(rows.filter(r => r.startsWith('d0 ')).length).toBe(2)
  expect(rows.filter(r => r.startsWith('d1 ')).length).toBe(0)
})

test('41 flame: nothing to draw says so', () => {
  expect(lines(flameRows([], null, O))[0]).toMatch(/No tool calls in the last turn/)
})

// ------------------------------------------------------------ 42

test('42 imports are found in JS, TS, Python, C and Rust source', () => {
  expect(
    importsOf("import a from './a'\nimport { b, c } from \"../b\"\nimport * as d from 'd'\nimport './side'\nexport { e } from './e'\nconst f = require('f')\nconst g = await import('g')\nimport type { H } from './h'\n"),
  ).toEqual(['./a', '../b', 'd', './e', './h', './side', 'f', 'g'])
  expect(importsOf('from .util import x\nfrom ..pkg.mod import y\nimport os, sys\n')).toEqual(['./util', '../pkg/mod', 'os', 'sys'])
  expect(importsOf('#include "local.h"\n#include <stdio.h>\nuse std::io;\n')).toEqual(['./local.h', 'stdio.h', 'std::io'])
  expect(importsOf('const x = 1')).toEqual([])
})

test('42 deps: an indented tree, local imports expand into the edited file they name', () => {
  const imps = [
    { path: '/p/a.ts', imports: ['./b', 'react'] },
    { path: '/p/b.ts', imports: ['node:fs'] },
  ]
  expect(lines(depsRows(imps, O))).toEqual([
    'a.ts',
    '├─ ./b  = b.ts',
    '│  └─ node:fs',
    '└─ react',
    '',
    '2 files, 3 imports, 1 between edited files',
  ])
})

test('42 deps: a cycle is cut, ASCII draws with pipes, none is a note', () => {
  const imps = [
    { path: '/p/a.ts', imports: ['./b'] },
    { path: '/p/b.ts', imports: ['./a.js'] },
  ]
  const rows = lines(depsRows(imps, O))
  expect(rows[0]).toBe('a.ts')
  expect(rows[1]).toBe('└─ ./b  = b.ts')
  expect(rows[2]).toBe('   └─ ./a.js  (cycle)')
  expect(lines(depsRows(imps, { ...O, icons: 'letters' }))[1]).toBe('`- ./b  = b.ts')
  expect(lines(depsRows([], O))[0]).toMatch(/No imports seen yet/)
})

// ------------------------------------------------------------ 43

test('43 mini-map: errors beat edits beat prompts in the combined strip', () => {
  const ev = miniEvents({
    ...EMPTY,
    prompts: [{ at: 0, len: 5 }],
    calls: [call('Edit', 500_000, 500_100), call('Bash', 1_000_000, 1_000_100, { isError: true }), call('Read', 1_000_000, 1_000_100)],
  })
  expect(ev.map(e => e.kind)).toEqual(['prompt', 'edit', 'error', 'tool'])
  const rows = lines(minimapRows(ev, 0, 1_000_000, { ...O, width: 32 }))
  expect(rows[0]?.startsWith('session  ▸')).toBe(true)
  expect(rows[0]?.endsWith('✗')).toBe(true)
  expect(rows[0]?.includes('◆')).toBe(true)
  expect(rows[2]?.startsWith('prompts  ▸')).toBe(true)
  expect(rows[4]?.endsWith('✗')).toBe(true)
  expect(rows[6]).toMatch(/1 prompts, 1 edits, 1 errors, 1 other calls/)
  expect(lines(minimapRows([], 0, 1, O))[0]).toMatch(/Nothing recorded yet/)
})

// ------------------------------------------------------------ 44

test('44 diff map: line numbers place the marks, a Write fills the strip, otherwise the size shows', () => {
  const rows = lines(
    diffmapRows(
      [
        { path: '/p/a.ts', n: 3, added: 10, removed: 2, marks: [1, 100], lines: 100 },
        { path: '/p/b.ts', n: 2, added: 40, removed: 0, marks: [], lines: 40 },
        { path: '/p/c.ts', n: 1, added: 8, removed: 8, marks: [], lines: 0 },
      ],
      { ...O, width: 60 },
    ),
  )
  const bw = 8
  expect(rows[0]).toBe(`a.ts              ▕█${'░'.repeat(bw - 2)}█▏ x3 +10/-2  to line 100`)
  expect(rows[1]).toBe(`b.ts              ▕${'█'.repeat(bw)}▏ x2 +40/-0  whole, 40 lines`)
  expect(rows[2]).toMatch(/^c\.ts +▕▓▓▒░*▏ x1 \+8\/-8 +size$/)
  expect(lines(diffmapRows([], O))[0]).toMatch(/No edits recorded yet/)
})

// ------------------------------------------------------------ 45

test('45 flow: prompts, tools and files in three columns of counts', () => {
  const d: ChartData = {
    ...EMPTY,
    prompts: [{ at: NOW - 20_000, len: 120 }, { at: NOW - 10_000, len: 40 }],
    calls: [
      call('Read', NOW - 19_000, NOW - 18_000, { file: '/p/a.ts' }),
      call('Edit', NOW - 17_000, NOW - 16_000, { file: '/p/a.ts' }),
      call('Bash', NOW - 9_000, NOW - 8_000),
    ],
  }
  const f = flowOf(d)
  expect(f.prompts.map(p => p.n)).toEqual([2, 1])
  expect(f.tools).toEqual([{ name: 'Bash', n: 1 }, { name: 'Edit', n: 1 }, { name: 'Read', n: 1 }])
  expect(f.files).toEqual([{ name: 'a.ts', n: 2 }])
  const rows = lines(sankeyRows(d, { ...O, width: 80 }))
  expect(rows[0]).toMatch(/^PROMPTS\s+TOOLS\s+FILES$/)
  expect(rows[1]).toMatch(/^11:59 120 +█+ 2 +▸ Bash +█+ 1 +▸ a\.ts +█+ 2/)
  expect(rows[2]).toMatch(/^11:59 40 +█+ 1/)
  expect(lines(sankeyRows(EMPTY, O))[0]).toMatch(/No prompts or calls yet/)
})

// ------------------------------------------------------------ 46

test('46 waffle: 100 cells split by success and error, an error always shows', () => {
  const calls = [call('A', 0, 1), call('B', 1, 2), call('C', 2, 3, { isError: true })]
  const rows = lines(waffleRows(calls, O))
  expect(rows.length).toBe(10)
  const all = rows.join('\n')
  const grid = rows.map(r => r.slice(0, 20)).join('\n')
  expect([...grid.matchAll(/✗ /g)].length).toBe(33)
  expect([...grid.matchAll(/● /g)].length).toBe(67)
  expect(all.length).toBeGreaterThan(0)
  expect(rows[0]).toMatch(/^● ● ● ● ● ● ● ● ● ●  +● ok +2 \(67%\)$/)
  expect(rows[1]).toMatch(/✗ error +1 \(33%\)$/)
  const many = lines(waffleRows([...Array.from({ length: 999 }, (_, i) => call('A', i, i + 1)), call('B', 0, 1, { isError: true })], O))
  expect([...many.map(r => r.slice(0, 20)).join('\n').matchAll(/✗ /g)].length).toBe(1)
  expect(lines(waffleRows([call('A', 0, null)], O))[0]).toMatch(/No finished calls yet/)
})

// ------------------------------------------------------------ 47

test('47 bullet: actual bar, target marker, room left and beyond', () => {
  expect(text([bulletBar(3, 5, 20, 'suggestion')])).toBe(`${'█'.repeat(10)}${'▒'.repeat(6)}│${'░'.repeat(3)}`)
  expect(text([bulletBar(7, 5, 20, 'suggestion')]).includes('│')).toBe(true)
  const over = bulletBar(7, 5, 20, 'suggestion')
  expect(over.find(s => s.t.includes('█'))?.c).toBe('error')
  expect(bulletBar(4.5, 5, 20, 'suggestion').find(s => s.t.includes('█'))?.c).toBe('warning')
  expect(bulletBar(1, 5, 20, 'claude').find(s => s.t.includes('█'))?.c).toBe('claude')
})

test('47 bullet rows: session, today and context against their targets', () => {
  const today = `${NOW > 0 ? new Date(NOW).getFullYear() : 0}-11-25`
  const rows = lines(bulletRows({ ...EMPTY, usd: 3, budget: 5, ctx: 40, days: { [today]: { n: 1, usd: 1.5 } } }, O))
  expect(rows[0]).toMatch(/^session +.*\$3\.00 \/ \$5\.00 {2}60%$/)
  expect(rows[1]).toMatch(/^today +.*\$1\.50 \/ \$5\.00 {2}30%$/)
  expect(rows[2]).toMatch(/^context +.*40% \/ 80% {2}50%$/)
  expect(lines(bulletRows({ ...EMPTY, usd: 3 }, O))[0]).toMatch(/no target: \/chbudget <usd>/)
  expect(lines(bulletRows(EMPTY, O))[0]).toMatch(/session\s+no reading yet/)
})

// ------------------------------------------------------------ 48

test('48 sparklines: one line per tool with its last durations', () => {
  const calls = [call('Read', 0, 100), call('Read', 1000, 1200), call('Read', 2000, 2400), call('Bash', 0, 1000)]
  const rows = lines(sparksRows(calls, O))
  expect(rows[0]).toMatch(/^tool +last durations +n +avg +max$/)
  expect(rows[1]).toBe('Read      ▃▅█                3   233ms   400ms')
  expect(rows[2]).toBe('Bash      █                  1    1.0s    1.0s')
  expect(lines(sparksRows([], O))[0]).toMatch(/No finished calls yet/)
})

// ------------------------------------------------------------ 49

test('49 sprints: a five week calendar with a dot on each sprint day', () => {
  const day = (back: number, h: number) => new Date(2026, 10, 25 - back, h).getTime()
  const rows = lines(sprintsRows([{ at: day(3, 9), min: 25, label: 'parser' }, { at: day(0, 8), min: 50, label: 'docs' }], { ...O, width: 80 }))
  expect(rows[0]).toBe(`      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => x.padEnd(6)).join('')}`)
  expect(rows.length).toBe(10)
  expect(rows[5]).toMatch(/^ {7}23 {4}24 {3}\[25\]● {2}26 /)
  expect(rows[5]).toMatch(/\[25\]●/)
  expect(rows[4]).toMatch(/ 22 ●/)
  expect(rows[7]).toBe('● = a day with a sprint. 2 sprints, 75 min in all, 50 min this week.')
  expect(rows[8]).toBe('11-25 08:00    50m  docs')
  expect(rows[9]).toBe('11-22 09:00    25m  parser')
  expect(lines(sprintsRows([], O)).some(r => /chsprint 25/.test(r))).toBe(true)
})

// ------------------------------------------------------------ 50

test('50 timeline: only today, in order, edits once per file', () => {
  const d: ChartData = {
    ...EMPTY,
    prompts: [{ at: NOW - 3_600_000, len: 90 }, { at: NOW - 90_000_000, len: 1 }],
    calls: [
      call('Edit', NOW - 3_000_000, NOW - 2_999_000, { file: '/p/a.ts' }),
      call('Edit', NOW - 2_000_000, NOW - 1_999_000, { file: '/p/a.ts' }),
      call('Bash', NOW - 1_000_000, NOW - 999_000, { isError: true, detail: 'npm' }),
    ],
    turns: [{ start: NOW - 3_600_000, end: NOW - 900_000 }],
    todos: [{ id: 1, text: 'ship' }],
    todoEv: [{ t: NOW - 500_000, id: 1, to: 'done' }],
    sprints: [{ at: NOW - 400_000, min: 25, label: 'focus' }],
  }
  expect(timelineEvents(d).map(e => e.kind)).toEqual(['prompt', 'edit', 'error', 'turn', 'todo', 'sprint'])
  expect(lines(timelineRows(d, O))).toEqual([
    '11:00  ▸ prompt, 90 characters',
    '11:10  ◆ Edit a.ts',
    '11:43  ✗ Bash failed: npm',
    '11:45  ● reply done in 45m00s',
    '11:51  ● todo done: ship',
    '11:53  ● sprint 25 min: focus',
  ])
  expect(lines(timelineRows(EMPTY, O))[0]).toMatch(/Nothing recorded today yet/)
})

// ------------------------------------------------------------ 51 and 52

const T0 = NOW - 7_200_000
const todos = [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]
const todoEv = [
  { t: T0, id: 1, to: 'open' as const },
  { t: T0, id: 2, to: 'open' as const },
  { t: T0, id: 3, to: 'open' as const },
  { t: T0 + 3_600_000, id: 1, to: 'doing' as const },
  { t: T0 + 3_600_000, id: 3, to: 'gone' as const },
  { t: NOW, id: 1, to: 'done' as const },
]

test('todo counts follow the last event of each item up to a time', () => {
  expect(todoCounts(todoEv, T0)).toEqual({ open: 3, doing: 0, done: 0 })
  expect(todoCounts(todoEv, T0 + 3_600_000)).toEqual({ open: 1, doing: 1, done: 0 })
  expect(todoCounts(todoEv, NOW)).toEqual({ open: 1, doing: 0, done: 1 })
})

test('51 burndown: remaining items fall, the last line says where it stands', () => {
  const rows = lines(burndownRows({ ...EMPTY, todos, todoEv }, O))
  expect(rows.length).toBe(8 + 1 + 1 + 2)
  expect(rows[0]).toMatch(/^ {2}3 │/)
  expect(rows[7]).toMatch(/^ {2}0 │/)
  expect(rows[0]?.endsWith(' '.repeat(10))).toBe(true)
  expect(rows[7]?.endsWith('█')).toBe(true)
  expect(rows[9]).toMatch(/^ {5}10:00 +12:00$/)
  expect(rows[10]).toMatch(/^remaining 1, done 1\./)
  expect(lines(burndownRows(EMPTY, O))[0]).toMatch(/No todos yet/)
})

test('52 cumulative flow: done at the bottom, doing above, open on top', () => {
  const rows = lines(cfdRows({ ...EMPTY, todos, todoEv }, O))
  const last = (r: string | undefined) => r?.slice(-1)
  // 3 items at the start, 2 later (one removed): the stack ends 2 high of a 3 high scale.
  expect(rows.length).toBe(8 + 1 + 1 + 1)
  expect(last(rows[7])).toBe('█')
  expect(last(rows[6])).toBe('█')
  expect(last(rows[5])).toBe('█')
  expect(last(rows[4])).toBe('░')
  expect(last(rows[3])).toBe('░')
  expect(last(rows[2])).toBe(' ')
  expect(rows[7]?.includes('░')).toBe(true)
  expect(rows[10]).toBe('█ done 1   ▓ doing 0   ░ open 1')
  expect(lines(cfdRows(EMPTY, O))[0]).toMatch(/No todos yet/)
})

// ------------------------------------------------------------ 53

test('53 radar: each factor is 0 to 100 with a note, the score is 100 minus the mean', () => {
  const calls = [call('Bash', 0, 1, { isError: true, detail: 'x' }), call('Read', 1, 2), call('Read', 2, 3), call('Read', 3, 4)]
  const f = factorsOf({ ...EMPTY, calls, ctx: 40, usd: 2, budget: 4, start: NOW - 600_000, turns: [{ start: NOW - 300_000, end: NOW }] })
  expect(f.map(x => x.label)).toEqual(['errors', 'loops', 'context', 'spend', 'idle'])
  expect(f[0]).toEqual({ label: 'errors', score: 100, note: '1 of 4 calls failed' })
  expect(f[1]).toEqual({ label: 'loops', score: 50, note: 'same call 3x in the last 20' })
  expect(f[2]).toEqual({ label: 'context', score: 40, note: '40% of the window' })
  expect(f[3]).toEqual({ label: 'spend', score: 50, note: '$2.00 of $4.00 budget' })
  expect(f[4]?.score).toBe(50)
  const rows = lines(radarRows({ ...EMPTY, calls, ctx: 40, usd: 2, budget: 4, start: NOW - 600_000, turns: [{ start: NOW - 300_000, end: NOW }] }, O))
  expect(rows[0]).toMatch(/^errors +▕█+▏ 100 +1 of 4 calls failed$/)
  expect(rows[6]).toMatch(/^health +42\/100/)
})

test('53 radar: a repeated call is a loop, no readings are n/a, spend falls back to the rate limit', () => {
  const same = Array.from({ length: 5 }, (_, i) => call('Bash', i, i + 1, { detail: 'npm' }))
  expect(factorsOf({ ...EMPTY, calls: same })[1]).toEqual({ label: 'loops', score: 100, note: 'same call 5x in the last 20' })
  const f = factorsOf({ ...EMPTY, limit: 62 })
  expect(f[3]).toEqual({ label: 'spend', score: 62, note: 'rate limit 62%' })
  expect(f[0]?.score).toBeNull()
  expect(lines(radarRows(EMPTY, O)).join('\n')).toMatch(/errors.*n\/a/)
  expect(lines(radarRows(EMPTY, O)).join('\n')).toMatch(/health\s+n\/a/)
})

// ------------------------------------------------------------ 54

test('54 scatter: a dot per call in braille, the biggest and slowest call is the top right dot', () => {
  const rows = scatterRows([call('A', 0, 100, { out: 500 })], O)
  const plainRows = lines(rows)
  expect(plainRows[0]?.endsWith('⠈')).toBe(true)
  expect(plainRows[0]?.startsWith('   500 │')).toBe(true)
  expect(plainRows[7]?.startsWith('     0 │')).toBe(true)
  expect(plainRows[9]).toMatch(/^ {8}0 +100ms$/)
  const withError = scatterRows([call('A', 0, 100, { out: 500, isError: true })], O)
  expect(withError[0]?.some(s => s.c === 'error' && s.t === '⠈')).toBe(true)
  expect(lines(scatterRows([call('A', 0, null)], O))[0]).toMatch(/No finished calls yet/)
})

test('54 scatter: the letters pack uses density characters instead of braille', () => {
  const t = text(scatterRows([call('A', 0, 100, { out: 500 }), call('B', 0, 100, { out: 500 })], { ...O, icons: 'letters' }))
  expect(/[⠀-⣿]/.test(t)).toBe(false)
  expect(t).toContain(':')
})

// ------------------------------------------------------------ the table and the demo

test('there are twenty charts, each in a group, each with an idea number from 35 to 54', () => {
  expect(CHARTS.length).toBe(20)
  expect(new Set(CHARTS.map(c => c.id)).size).toBe(20)
  expect(CHARTS.map(c => c.idea).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => 35 + i))
  const groups = new Set(GROUPS.map(g => g[0]))
  expect(CHARTS.every(c => groups.has(c.group as never))).toBe(true)
})

test('every chart draws with no data without throwing, and says what it needs', () => {
  for (const c of CHARTS) {
    expect(renderChart(c.id, EMPTY, O).length).toBeGreaterThan(0)
  }
  expect(lines(renderChart('nope', EMPTY, O))[0]).toMatch(/Unknown chart/)
})

test('the demo data fills every chart with something real, in every glyph pack and density', () => {
  for (const icons of ['symbols', 'letters', 'minimal'] as Icons[]) {
    for (const density of ['compact', 'normal', 'airy'] as const) {
      const o: Opts = { width: 80, accent: 'claude', density, icons, now: NOW }
      const d = demoData(NOW)

      for (const c of CHARTS) {
        const rows = renderChart(c.id, d, o)
        const t = text(rows)
        expect(t.length).toBeGreaterThan(40)
        expect(t).not.toMatch(/No (tool calls|edits|finished|prompts|imports|todos|recorded)/)
        expect(Math.max(...rows.map(widthOf))).toBeLessThanOrEqual(80)
      }
    }
  }
})

test('chart lines fit the width they were given at 60 and 80 columns', () => {
  for (const width of [60, 80]) {
    for (const c of CHARTS) {
      for (const r of plain(renderChart(c.id, demoData(NOW), { ...O, width }))) {
        expect(r.length).toBeLessThanOrEqual(width)
      }
    }
  }
})

test('the demo is deterministic and bounded', () => {
  const a = demoData(NOW)
  expect(demoData(NOW)).toEqual(a)
  expect(a.calls.length).toBeLessThan(200)
  expect(Object.keys(a.days).length).toBeLessThanOrEqual(91)
})

test('density changes the gap between side by side rings and the height of the treemap', () => {
  const d = { ...EMPTY, ctx: 10 }
  const gap = (density: 'compact' | 'normal' | 'airy') => lines(donutRows(d, { ...O, density }))[0]?.indexOf('◜', 3)
  expect([gap('compact'), gap('normal'), gap('airy')]).toEqual([10, 11, 13])
  const h = (density: 'compact' | 'normal' | 'airy') => treemapRows([{ path: '/p/a.ts', n: 1 }], { ...O, density }).length
  expect(h('compact')).toBeLessThan(h('normal'))
  expect(h('normal')).toBeLessThan(h('airy'))
})

test('the accent colours the primary marks and the other colours follow it', () => {
  const rows = stackedRows([call('Read', 0, 1), call('Edit', 1, 2), call('Bash', 2, 3)], { ...O, accent: 'warning' })
  expect(rows[0]?.map(s => s.c)).toEqual(['warning', 'suggestion', 'success'])
})
