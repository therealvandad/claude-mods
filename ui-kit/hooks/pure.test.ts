import { expect, test } from 'claude-code/testing'

import {
  CAP,
  addPrompt,
  bumpEdit,
  cleanAcc,
  cleanDays,
  cleanHours,
  cleanLab,
  cleanName,
  cleanPrefs,
  demoData,
  detailOf,
  dur,
  endCall,
  etaFor,
  median,
  milestoneCrossed,
  money,
  redact,
  sigOf,
  startCall,
  trimDays,
} from './data'
import type { Data } from './data'
import { bar, breakpointOf, fit, glyphs, spark, svgWidth } from './fmt'
import { activityModel, errorsModel, filesModel, promptsModel, spendModel, squarify, timelineModel } from './model'
import { activitySvg, checkSvg, confettiSvg, errorsSvg, filesSvg, miniSvg, promptsSvg, skeletonSvg, spendSvg, stepperSvg, timelineSvg, tinySpark } from './svg'
import type { Look } from './svg'
import { buildView, miniNums } from './views'

const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime()
const look = (over: Partial<Look> = {}): Look => ({ accent: 'suggestion', animate: true, enter: true, pulse: ['calls'], W: 480, ...over })
const still = look({ animate: false, enter: false, pulse: [] })

// ---------------------------------------------------------------- small formats

test('durations, money and the median read plainly', () => {
  expect(dur(850)).toBe('850ms')
  expect(dur(1250)).toBe('1.3s')
  expect(dur(42_000)).toBe('42s')
  expect(dur(125_000)).toBe('2m 05s')
  expect(dur(Number.NaN)).toBe('0ms')
  expect(money(3.2)).toBe('$3.20')
  expect(money(250)).toBe('$250')
  expect(money(-4)).toBe('$0.00')
  expect(median([5, 1, 3])).toBe(3)
  expect(median([1, 3])).toBe(2)
  expect(median([])).toBe(0)
})

test('text bars and sparklines keep to the width they are given', () => {
  expect(spark([1, 2, 3, 4, 5, 6, 7, 8], 4)).toHaveLength(4)
  expect(spark([], 6)).toBe('      ')
  expect(spark([0, 0], 3)).toBe('▁▁▁')
  expect(bar(0.5, 10)).toHaveLength(10)
  expect(bar(2, 5)).toBe('█████')
  expect(bar(Number.NaN, 5)).toBe('     ')
  expect(fit('abcdefghij', 5)).toBe('abcd…')
  expect(glyphs('symbols').err).toBe('✗')
  expect(new Set(Object.values(glyphs('letters'))).size).toBe(4)
})

test('three breakpoints by columns, each with its own picture width', () => {
  expect(breakpointOf(40)).toBe('narrow')
  expect(breakpointOf(59)).toBe('narrow')
  expect(breakpointOf(60)).toBe('medium')
  expect(breakpointOf(99)).toBe('medium')
  expect(breakpointOf(100)).toBe('wide')
  expect(svgWidth('narrow', 40, false)).toBeLessThan(svgWidth('medium', 80, false))
  expect(svgWidth('medium', 80, false)).toBeLessThan(svgWidth('wide', 120, false))
  expect(svgWidth('wide', 120, true)).toBeLessThan(svgWidth('wide', 120, false))
})

// ---------------------------------------------------------------- recording rules

test('secrets are scrubbed from error text, and a command line keeps only its first word', () => {
  expect(redact('failed with token=abc123def and sk-live_ABCDEFGH1234')).not.toMatch(/abc123|ABCDEFGH/)
  expect(redact('Authorization: Bearer abcdefghijklmnop')).toContain('Bearer ***')
  expect(redact('x'.repeat(500)).length).toBe(CAP.msg)
  expect(redact('a\n\n  b\tc')).toBe('a b c')
  expect(detailOf('Bash', { command: 'curl -H "Authorization: x" https://a' })).toBe('curl')
  expect(detailOf('Edit', { file_path: '/a/b/c.ts' })).toBe('c.ts')
})

test('two failures that differ only in numbers and paths have one signature', () => {
  expect(sigOf('Bash', 'exit code 1: 3 tests failed in /app/a.test.ts')).toBe(sigOf('Bash', 'exit code 2: 9 tests failed in /app/b/c.test.ts'))
  expect(sigOf('Bash', 'exit code 1')).not.toBe(sigOf('Edit', 'exit code 1'))
  expect(sigOf('Bash', '')).toBe('Bash: failed')
})

test('the lists are bounded: calls, prompts, edits and days', () => {
  let calls = [] as ReturnType<typeof startCall>

  for (let i = 0; i < CAP.calls + 40; i++) {
    calls = startCall(calls, { id: `c${i}`, tool: 'Read', detail: '', startedAt: i, endedAt: null, isError: false, msg: '', out: 0 })
  }
  expect(calls).toHaveLength(CAP.calls)
  expect(calls[0]?.id).toBe('c40')
  const done = endCall(calls, 'c100', 500, true, 'password=hunter2', 10)
  expect(done.find(c => c.id === 'c100')).toMatchObject({ endedAt: 500, isError: true })
  expect(done.find(c => c.id === 'c100')?.msg).not.toContain('hunter2')
  expect(done.find(c => c.id === 'c101')?.endedAt).toBeNull()

  let ps = [] as ReturnType<typeof addPrompt>

  for (let i = 0; i < CAP.prompts + 5; i++) {
    ps = addPrompt(ps, { at: i, len: 3, snip: '' })
  }
  expect(ps).toHaveLength(CAP.prompts)
  let edits = [] as ReturnType<typeof bumpEdit>

  for (let i = 0; i < CAP.edits + 9; i++) {
    edits = bumpEdit(edits, `/f${i}`, 1, 0, i)
  }
  expect(edits).toHaveLength(CAP.edits)
  const merged = bumpEdit(bumpEdit([], '/a', 3, 1, 1), '/a', 2, 2, 5)
  expect(merged).toEqual([{ path: '/a', n: 2, added: 5, removed: 3, last: 5 }])
  const days = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, i]))
  expect(Object.keys(trimDays(days))).toHaveLength(CAP.days)
})

test('milestones: only the biggest one crossed counts, and each is crossed once', () => {
  expect(milestoneCrossed(9, 10)).toBe(10)
  expect(milestoneCrossed(10, 11)).toBeUndefined()
  expect(milestoneCrossed(0, 60)).toBe(50)
  expect(milestoneCrossed(99, 100)).toBe(100)
})

test('the time estimate needs three earlier calls of the same tool and never reaches 100%', () => {
  const mk = (id: string, ms: number, isError = false, tool = 'Bash') => ({ id, tool, detail: '', startedAt: 0, endedAt: ms, isError, msg: '', out: 0 })
  const running = { id: 'r', tool: 'Bash', detail: '', startedAt: 10_000, endedAt: null, isError: false, msg: '', out: 0 }
  expect(etaFor([mk('a', 4000), mk('b', 4000), running], running, 12_000)).toBeUndefined()
  expect(etaFor([mk('a', 4000), mk('b', 4000, true), mk('c', 4000), mk('d', 4000, false, 'Read'), running], running, 12_000)).toBeUndefined()
  const eta = etaFor([mk('a', 4000), mk('b', 4000), mk('c', 6000), running], running, 12_000)
  expect(eta).toMatchObject({ typicalMs: 4000, elapsedMs: 2000, fraction: 0.5, leftMs: 2000, samples: 3 })
  expect(etaFor([mk('a', 1000), mk('b', 1000), mk('c', 1000), running], running, 99_000)?.fraction).toBe(0.95)
})

test('stored values that are garbage are cleaned, not trusted', () => {
  expect(cleanDays({ '2026-01-02': 5, nope: 3, '2026-01-03': -1, '2026-01-04': 'x', '2026-01-05': 1e9 })).toEqual({ '2026-01-02': 5, '2026-01-05': 100_000 })
  expect(cleanDays('junk')).toEqual({})
  expect(cleanHours(['a', 5, -2])).toHaveLength(24)
  expect(cleanHours(['a', 5, -2]).slice(0, 3)).toEqual([0, 5, 0])
  expect(cleanAcc({ 'timeline.list': true, 'bad key': true, 'files.list': 'yes' })).toEqual({ 'timeline.list': true })
  expect(cleanPrefs({ view: 'bogus', split: 'lab', mini: 'yes' })).toEqual({ view: 'timeline', split: 'none', mini: false })
  expect(cleanPrefs({ view: 'spend', split: 'files', mini: true })).toEqual({ view: 'spend', split: 'files', mini: true })
  expect(cleanName('  a\nb\t' + 'z'.repeat(80))).toHaveLength(CAP.labName)
  expect(cleanLab('junk').items.length).toBeGreaterThan(0)
  const lab = cleanLab({ items: [{ id: 'x', name: '' }, { id: 3, name: 'Ok', on: true, list: 'b' }, 5], nextId: 'q' })
  expect(lab.items).toEqual([{ id: 3, name: 'Ok', on: true, list: 'b', pending: false, okAt: 0 }])
  expect(lab.nextId).toBe(4)
  expect(cleanLab({ items: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `n${i}` })) }).items).toHaveLength(CAP.lab)
})

// ---------------------------------------------------------------- the treemap

test('the treemap fills the box exactly with no overlap and nothing outside', () => {
  const weights = [50, 30, 20, 9, 8, 7, 3, 1, 1, 1]
  const rects = squarify(weights, 400, 220)
  expect(rects).toHaveLength(weights.length)
  const area = rects.reduce((s, r) => s + r.w * r.h, 0)
  expect(Math.round(area)).toBe(400 * 220)

  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(-0.001)
    expect(r.y).toBeGreaterThanOrEqual(-0.001)
    expect(r.x + r.w).toBeLessThanOrEqual(400.001)
    expect(r.y + r.h).toBeLessThanOrEqual(220.001)
  }

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!
      const b = rects[j]!
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      expect(overlapW > 0.01 && overlapH > 0.01).toBe(false)
    }
  }
  // each tile's area follows its weight
  expect(rects[0]!.w * rects[0]!.h).toBeGreaterThan(rects[1]!.w * rects[1]!.h)
})

test('the treemap copes with nothing, one file, zeros and odd numbers', () => {
  expect(squarify([], 100, 100)).toEqual([])
  expect(squarify([5], 100, 50)).toEqual([{ x: 0, y: 0, w: 100, h: 50 }])
  expect(squarify([0, 0, Number.NaN], 90, 90)).toHaveLength(3)
  expect(squarify([1, 2], 0, 100)).toEqual([])
})

// ---------------------------------------------------------------- the models

const demo = (): Data => demoData(NOW)

test('timeline model: lanes are limited, bars sit inside 0..1, the running call has an estimate', () => {
  const m = timelineModel(demo())
  expect(m.lanes.length).toBeLessThanOrEqual(6)
  expect(m.bars.length).toBe(40)

  for (const b of m.bars) {
    expect(b.a).toBeGreaterThanOrEqual(0)
    expect(b.b).toBeLessThanOrEqual(1)
    expect(b.b).toBeGreaterThanOrEqual(b.a)
    expect(b.lane).toBeLessThan(m.lanes.length)
  }
  expect(m.running?.tool).toBe('Bash')
  expect(m.eta?.samples).toBeGreaterThanOrEqual(3)
  expect(m.items[0]?.meta).toBe('running')
  const many = { ...demo(), calls: Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, tool: `Tool${i % 9}`, detail: '', startedAt: i * 1000, endedAt: i * 1000 + 500, isError: false, msg: '', out: 0 })) }
  expect(timelineModel(many).lanes).toContain('other')
  expect(timelineModel(many).lanes.length).toBe(6)
  expect(timelineModel({ ...demo(), calls: [] }).isEmpty).toBe(true)
})

test('files, errors, prompts, spend and activity models read the demo data', () => {
  const f = filesModel(demo())
  expect(f.tiles).toHaveLength(8)
  expect(f.tiles[0]?.w).toBeGreaterThanOrEqual(f.tiles[7]?.w ?? 0)
  expect(f.nums[0]?.value).toBe('8')
  const e = errorsModel(demo(), sigOf, true)
  expect(e.errors).toBe(3)
  expect(e.groups.reduce((s, g) => s + g.count, 0)).toBe(3)
  expect(e.groups.length).toBe(3)
  expect(e.items[0]?.detail.join(' ')).toMatch(/message:/)
  expect(errorsModel(demo(), sigOf, false).items[0]?.detail.join(' ')).toMatch(/hidden/)
  const p = promptsModel(demo())
  expect(p.lens).toHaveLength(14)
  expect(p.items[0]?.detail.join(' ')).toMatch(/tool call/)
  const s = spendModel(demo())
  expect(s.deltas.every(d => d >= 0)).toBe(true)
  expect(s.nums[0]?.value).toBe('$3.20')
  const a = activityModel(demo())
  expect(a.heat).toHaveLength(84)
  expect(a.tools.length).toBeLessThanOrEqual(6)
  expect(a.tools[0]?.series).toHaveLength(10)
  expect(activityModel({ ...demo(), days: {}, calls: [] }).isEmpty).toBe(true)
})

// ---------------------------------------------------------------- the pictures

const SVGS: [string, (d: Data, l: Look) => string][] = [
  ['timeline', (d, l) => timelineSvg(timelineModel(d), l)],
  ['files', (d, l) => filesSvg(filesModel(d), l)],
  ['errors', (d, l) => errorsSvg(errorsModel(d, sigOf, true), l)],
  ['prompts', (d, l) => promptsSvg(promptsModel(d), l)],
  ['spend', (d, l) => spendSvg(spendModel(d), l)],
  ['activity', (d, l) => activitySvg(activityModel(d), l)],
]

test('every picture is one small, safe, well formed SVG with a dark mode and hover titles', () => {
  for (const [name, draw] of SVGS) {
    for (const W of [300, 480, 720]) {
      const svg = draw(demo(), look({ W }))
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect((svg.match(/<svg/g) ?? []).length).toBe(1)
      expect(svg.length).toBeLessThan(40_000)
      expect(svg).not.toMatch(/<script|on[a-z]+=|javascript:|<foreignObject|href=/i)
      expect(svg).toContain('@media (prefers-color-scheme:dark)')
      expect(svg).not.toMatch(/NaN|undefined|Infinity/)
      expect(svg).toContain('<title>')
      expect(svg).toContain(`viewBox="0 0 ${W} `)
      expect(name.length).toBeGreaterThan(0)
    }
  }
})

test('with motion off or calm on every picture is still: no keyframes, no animation, no flash', () => {
  for (const [, draw] of SVGS) {
    const svg = draw(demo(), still)
    expect(svg).not.toMatch(/@keyframes|animation:|<animate|class="flash"/)
    expect(svg).toContain('<title>')
  }
})

test('with motion on the pictures carry an entrance, and a changed number gets a flash', () => {
  for (const [, draw] of SVGS) {
    const svg = draw(demo(), look())
    expect(svg).toContain('@keyframes rise')
  }
  expect(timelineSvg(timelineModel(demo()), look())).toContain('class="flash"')
  expect(timelineSvg(timelineModel(demo()), look({ pulse: [] }))).not.toContain('class="flash"')
  expect(timelineSvg(timelineModel(demo()), look({ enter: false, pulse: [] }))).not.toContain('@keyframes rise')
})

test('hostile names cannot break out of a picture', () => {
  const d = demo()
  d.calls = [{ id: 'x', tool: '<script>alert(1)</script>', detail: 'a"b&c', startedAt: NOW - 5000, endedAt: NOW, isError: true, msg: '</svg><script>', out: 1 }]
  d.edits = [{ path: '/x/<img onerror=alert(1)>.ts', n: 2, added: 3, removed: 1, last: NOW }]
  const all = [timelineSvg(timelineModel(d), look()), filesSvg(filesModel(d), look()), errorsSvg(errorsModel(d, sigOf, true), look())].join('')
  expect(all).not.toContain('<script>')
  expect(all).not.toContain('<img')
  expect(all).toContain('&lt;script&gt;')
  expect(all).toContain('a&quot;b&amp;c'.slice(0, 1))
})

test('odd numbers never reach a picture as NaN', () => {
  const d = demo()
  d.samples = [{ t: 1, usd: Number.NaN, ctx: 500 }, { t: 2, usd: -3, ctx: -9 }]
  d.hours = [Number.NaN, ...d.hours.slice(1)]
  d.days = { '2026-11-25': Number.NaN }
  for (const [, draw] of SVGS) {
    expect(draw(d, look())).not.toMatch(/NaN|undefined|Infinity/)
  }
})

test('the small drawings: skeleton, tick, confetti, stepper, mini, sparkline', () => {
  expect(skeletonSvg(look())).toContain('@keyframes sweep')
  expect(skeletonSvg(still)).not.toMatch(/@keyframes|animation:/)
  expect(checkSvg(look(), 'Done')).toContain('stroke-dasharray:100')
  expect(checkSvg(still, 'Done')).not.toMatch(/@keyframes|animation:/)
  expect(checkSvg(still, 'Done')).toContain('M17 29')
  expect(confettiSvg(look(), '100 calls')).toContain('@keyframes fall')
  expect(confettiSvg(still, '100 calls')).not.toMatch(/@keyframes|animation:/)
  expect(confettiSvg(still, '100 calls')).toContain('100 calls')
  const st = stepperSvg(['A', 'B', 'C', 'D'], 2, look())
  expect(st).toContain('Step 3: C (now)')
  expect(st).toContain('Step 1: A (done)')
  expect(miniSvg(miniNums(demo()), look())).toContain('calls 40')
  const sp = tinySpark([1, 0, 4, 2], 'x', 'claude')
  expect(sp.startsWith('<svg')).toBe(true)
  expect(sp.length).toBeLessThan(1500)
  expect(sp).not.toMatch(/@keyframes|animation/)
})

// ---------------------------------------------------------------- the text charts

test('text charts: each view draws lines that fit every width, with no picture on other surfaces', () => {
  for (const cols of [40, 80, 120]) {
    for (const id of ['timeline', 'files', 'errors', 'prompts', 'spend', 'activity'] as const) {
      const v = buildView(id, demo(), { cols, svg: false, look: still, icons: 'symbols', compact: false, showMsg: true })
      expect(v.svg).toBeUndefined()
      expect(v.lines.length).toBeGreaterThan(1)
      expect(v.nums).toHaveLength(3)

      for (const l of v.lines) {
        expect(l.t.length).toBeLessThanOrEqual(cols)
      }
    }
  }
})

test('on the desktop a view carries a picture and no text lines; empty views say so', () => {
  const v = buildView('files', demo(), { cols: 80, svg: true, look: look(), icons: 'symbols', compact: false, showMsg: true })
  expect(v.svg?.source.startsWith('<svg')).toBe(true)
  expect(v.svg?.alt).toMatch(/files 8/)
  expect(v.lines).toEqual([])
  const empty = buildView('timeline', { ...demo(), calls: [] }, { cols: 80, svg: true, look: look(), icons: 'symbols', compact: false, showMsg: true })
  expect(empty.empty).toMatch(/No tool calls yet/)
  expect(empty.svg).toBeUndefined()
})

test('a compact view (the half of a split) lists fewer rows', () => {
  const full = buildView('timeline', demo(), { cols: 80, svg: false, look: still, icons: 'symbols', compact: false, showMsg: true })
  const half = buildView('timeline', demo(), { cols: 80, svg: false, look: still, icons: 'symbols', compact: true, showMsg: true })
  expect(half.lines.length).toBeLessThan(full.lines.length)
})

test('icon packs change the glyphs the strip uses', () => {
  const a = buildView('errors', demo(), { cols: 80, svg: false, look: still, icons: 'symbols', compact: false, showMsg: true }).lines.map(l => l.t).join('')
  const b = buildView('errors', demo(), { cols: 80, svg: false, look: still, icons: 'letters', compact: false, showMsg: true }).lines.map(l => l.t).join('')
  expect(a).toContain('✗')
  expect(b).toContain('X')
  expect(b).not.toContain('✗')
})
