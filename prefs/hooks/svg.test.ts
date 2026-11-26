import { expect, test } from 'claude-code/testing'

import { RAMPS, SAMPLE, chartAlt, chartSvg, chartText, esc, linePath, sparkText } from './svg'
import type { ChartOpts } from './svg'

const O: ChartOpts = { type: 'line', smooth: true, grid: true, labels: false, legend: 'bottom', ramp: 'blue', range: '24h', metric: 'cost', accent: 'suggestion' }
const o = (p: Partial<ChartOpts>): ChartOpts => ({ ...O, ...p })
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length

test('esc escapes the four characters that matter in SVG text', () => {
  expect(esc('<b a="1">&')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;')
  expect(esc('plain')).toBe('plain')
})

test('linePath: straight and smooth, empty and single point', () => {
  expect(linePath([], true)).toBe('')
  expect(linePath([[1, 2]], true)).toBe('M1 2')
  expect(linePath([[0, 0], [10, 10]], false)).toBe('M0 0 L10 10')
  expect(linePath([[0, 0], [10, 10], [20, 0]], false)).toBe('M0 0 L10 10 L20 0')
  expect(linePath([[0, 0], [10, 10], [20, 0]], true).startsWith('M0 0 C')).toBe(true)
  expect(count(linePath([[0, 0], [10, 10], [20, 0]], true), /C/g)).toBe(2)
})

test('chartSvg: a well-formed, safe drawing for every combination', () => {
  for (const type of ['line', 'bar', 'area'] as const) {
    for (const legend of ['top', 'bottom', 'right', 'none'] as const) {
      for (const smooth of [true, false]) {
        const s = chartSvg(o({ type, legend, smooth, labels: smooth }))

        expect(s.startsWith('<svg')).toBe(true)
        expect(s.endsWith('</svg>')).toBe(true)
        expect(s.includes('NaN') || s.includes('undefined') || s.includes('Infinity')).toBe(false)
        expect(s.includes('<script') || s.includes('onclick') || s.includes('href')).toBe(false)
        expect(count(s, /<svg/g)).toBe(1)
      }
    }
  }
})

test('chartSvg: the type decides the marks', () => {
  const line = chartSvg(o({ type: 'line' }))
  const bar = chartSvg(o({ type: 'bar', legend: 'none' }))
  const area = chartSvg(o({ type: 'area' }))

  expect(count(line, /<circle/g)).toBe(SAMPLE.length)
  expect(count(bar, /<circle/g)).toBe(0)
  expect(count(bar, /rx="2" class="accfill"/g)).toBe(SAMPLE.length)
  expect(area.includes('opacity="0.22"')).toBe(true)
  expect(line.includes('opacity="0.22"')).toBe(false)
  expect(line.includes(' C')).toBe(true)
  expect(chartSvg(o({ type: 'line', smooth: false })).includes(' C')).toBe(false)
  expect(chartSvg(o({ type: 'line', smooth: false })).includes(' L')).toBe(true)
})

test('chartSvg: grid, labels and legend switches', () => {
  expect(count(chartSvg(o({ grid: true })), /class="grid"/g)).toBe(5)
  expect(count(chartSvg(o({ grid: false })), /class="grid"/g)).toBe(0)
  expect(count(chartSvg(o({ labels: true })), /class="num"/g)).toBe(6)
  expect(count(chartSvg(o({ labels: false })), /class="num"/g)).toBe(0)

  for (const legend of ['top', 'bottom', 'right'] as const) {
    expect(count(chartSvg(o({ legend })), />cost<\/text>/g)).toBe(1)
  }
  expect(count(chartSvg(o({ legend: 'none' })), />cost<\/text>/g)).toBe(0)
})

test('chartSvg: the ramp has five cells in the chosen colours, an unknown ramp falls back', () => {
  for (const name of Object.keys(RAMPS)) {
    const s = chartSvg(o({ ramp: name }))

    for (const c of RAMPS[name]!) {
      expect(s.includes(`fill="${c}"`)).toBe(true)
    }
    expect(RAMPS[name]!.length).toBe(5)
  }
  expect(chartSvg(o({ ramp: 'nonsense' })).includes(`fill="${RAMPS['blue']![0]}"`)).toBe(true)
})

test('chartSvg: text from outside is escaped, an unknown accent falls back', () => {
  const s = chartSvg(o({ metric: '<b>x</b>', range: 'a&b' }))

  expect(s.includes('<b>')).toBe(false)
  expect(s.includes('&lt;b&gt;x&lt;/b&gt;')).toBe(true)
  expect(s.includes('a&amp;b')).toBe(true)
  expect(chartSvg(o({ accent: 'bogus' as never })).includes('--acc:#4b57c9')).toBe(true)
  expect(chartSvg(o({ accent: 'success' })).includes('--acc:#2f8f4e')).toBe(true)
  expect(chartSvg(o({})).includes('prefers-color-scheme:dark')).toBe(true)
})

test('chartAlt describes the settings; the text twin works without vectors', () => {
  const alt = chartAlt(o({ type: 'bar', grid: false, labels: true, legend: 'right', ramp: 'warm', range: '7d' }))

  expect(alt).toContain('drawn as bar')
  expect(alt).toContain('without grid lines')
  expect(alt).toContain('with data labels')
  expect(alt).toContain('legend right')
  expect(alt).toContain('range 7d')
  expect(alt).toContain('warm heat-map ramp')
  expect(chartAlt(o({ type: 'line', smooth: true }))).toContain(', smooth')
  expect(chartAlt(o({ type: 'bar', smooth: true }))).not.toContain(', smooth')
  expect(sparkText().length).toBe(SAMPLE.length)
  expect(sparkText([0, 1])).toBe('▁█')
  expect(sparkText([])).toBe('')
  expect(chartText(o({})).length).toBe(2)
  expect(chartText(o({ type: 'bar' }))[0]).toContain('cost: bar, grid on')
  expect(chartText(o({ type: 'line', smooth: false }))[0]).toContain('straight')
})
