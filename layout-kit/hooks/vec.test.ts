import { expect, test } from 'claude-code/testing'

import { barsAlt, barsSvg, esc, ringSvg } from './vec'

test('the ring is a small well-formed svg with the value and the title', () => {
  const s = ringSvg(62, 'Context', 'warning')
  expect(s).toMatch(/^<svg [^>]*viewBox="0 0 72 72"/)
  expect(s.endsWith('</svg>')).toBe(true)
  expect(s).toMatch(/62%/)
  expect(s).toMatch(/<title>Context 62%<\/title>/)
  expect(s).toMatch(/prefers-color-scheme:dark/)
  expect(s.length).toBeLessThan(5000)
})

test('the ring clamps odd numbers and unknown colours', () => {
  expect(ringSvg(Number.NaN, 'x', 'bogus')).toMatch(/0%/)
  expect(ringSvg(500, 'x', '__proto__')).toMatch(/100%/)
  expect(ringSvg(-5, 'x', 'constructor')).toMatch(/0%/)
  expect(ringSvg(50, 'x', 'bogus')).toMatch(/s-subtle/)
})

test('bars: one per tool, escaped text, your colour class, capped at eight rows and 700 px', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ label: `T${i}<script>"&`, glyph: '$', n: i + 1, err: i % 2, color: i === 0 ? 'error' : 'nope' }))
  const s = barsSvg(rows, 5000)
  expect(s).not.toMatch(/<script/)
  expect(s).toMatch(/&lt;script&gt;/)
  expect((s.match(/<rect /g) ?? []).length).toBe(8)
  expect(s).toMatch(/width="700"/)
  expect(s).toMatch(/f-error/)
  expect(barsSvg([], 10)).toMatch(/viewBox="0 0 160 /)
  expect(s.length).toBeLessThan(131072)
})

test('hostile labels cannot break out of the markup', () => {
  const s = barsSvg([{ label: '"><svg onload=alert(1)>\u0000\u0008', glyph: "'", n: 1, err: 0, color: 'success' }], 300)
  expect(s).not.toMatch(/<svg onload/)
  expect(s).not.toMatch(/\u0000|\u0008/)
  expect(esc('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&#39;')
  expect(barsAlt([])).toBe('No tool calls yet.')
  expect(barsAlt([{ label: 'Bash', glyph: '', n: 3, err: 0, color: 'x' }])).toMatch(/Bash 3/)
})
