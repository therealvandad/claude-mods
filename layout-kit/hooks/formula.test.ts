import { expect, test } from 'claude-code/testing'

import { MAX_DEPTH, MAX_LEN, METRIC_NAMES, calc, holds, parse, parseCondition, parseFormula, zeroMetrics } from './formula'
import type { Metrics } from './formula'

const M: Metrics = { ...zeroMetrics(), calls: 40, errors: 4, files: 3, spend: 1.5, ctx: 62, limit: 10, mins: 90, budget: 5, todo_open: 2, todo_done: 6, todo_all: 8 }
const f = (s: string): number | null => calc(s, M)

test('numbers, precedence, parentheses and unary minus', () => {
  expect(f('1')).toBe(1)
  expect(f('1 + 2 * 3')).toBe(7)
  expect(f('(1 + 2) * 3')).toBe(9)
  expect(f('10 - 4 - 3')).toBe(3)
  expect(f('100 / 4 / 5')).toBe(5)
  expect(f('-3 + 5')).toBe(2)
  expect(f('--3')).toBe(3)
  expect(f('2 * -3')).toBe(-6)
  expect(f('0.5 * 4')).toBe(2)
  expect(f('1.25 + 1.25')).toBe(2.5)
  expect(f('007')).toBe(7)
})

test('metrics are looked up by name, case-insensitively, and combine with numbers', () => {
  expect(f('calls')).toBe(40)
  expect(f('CALLS')).toBe(40)
  expect(f('errors / calls * 100')).toBe(10)
  expect(f('spend * 2')).toBe(3)
  expect(f('todo_done / todo_all')).toBe(0.75)
  expect(f('(calls - errors) / calls')).toBe(0.9)
  expect(f('  calls   +   1  ')).toBe(41)
})

test('every listed metric parses and evaluates', () => {
  for (const n of METRIC_NAMES) {
    expect(typeof calc(n, M)).toBe('number')
  }
  expect(METRIC_NAMES.length).toBe(15)
})

test('division by zero is 0, not an error and not infinity', () => {
  expect(f('1 / 0')).toBe(0)
  expect(f('calls / (errors - 4)')).toBe(0)
  expect(calc('errors / calls', zeroMetrics())).toBe(0)
})

test('names that are not metrics are refused, never looked up', () => {
  for (const bad of ['foo', 'constructor', '__proto__', 'prototype', 'toString', 'hasOwnProperty', 'process', 'globalThis', 'window', 'this', 'eval', 'Function', 'valueOf', 'calls2', 'call', 'callss', 'a', '_']) {
    const p = parseFormula(bad)
    expect(p.ok).toBe(false)
    expect(calc(bad, M)).toBeNull()
  }
  const p = parseFormula('constructor')
  expect(p.ok === false && /not a metric/.test(p.error)).toBe(true)
})

test('anything that is not number, metric, + - * / ( ) is refused in a formula', () => {
  const bad = [
    'calls > 1',
    'calls == 1',
    'calls && errors',
    'calls || errors',
    'calls % 2',
    'calls ** 2',
    'calls ^ 2',
    'calls; errors',
    'calls, errors',
    'calls.errors',
    'calls[0]',
    'calls()',
    'max(calls, 2)',
    '`calls`',
    '"calls"',
    "'calls'",
    '$calls',
    '{calls}',
    '#',
    'a = 1',
    '1e5',
    '0x10',
    '1_000',
    '.5',
    '5.',
    '1..2',
    '1.2.3',
    '1.0000001',
    '1a',
    '١٢٣',
    'ｃａｌｌｓ',
    'calls\n+ 1',
    'calls\t+ 1',
    'calls\u0000',
    '(',
    ')',
    '()',
    '(1',
    '1)',
    '1 +',
    '+ 1',
    '* 2',
    '1 2',
    'calls errors',
    '1 + * 2',
    '',
    '   ',
    '-',
  ]

  for (const s of bad) {
    expect(parseFormula(s).ok).toBe(false)
    expect(calc(s, M)).toBeNull()
  }
})

test('non-string input is refused', () => {
  for (const v of [undefined, null, 1, {}, [], true, () => 1, Symbol('x')]) {
    expect(parseFormula(v).ok).toBe(false)
    expect(parseCondition(v).ok).toBe(false)
  }
})

test('length cap: 80 characters pass, 81 do not', () => {
  const ok = `1${' '.repeat(79)}`
  expect(ok.length).toBe(MAX_LEN)
  expect(parseFormula(ok).ok).toBe(true)
  expect(parseFormula(`1${' '.repeat(80)}`).ok).toBe(false)
  expect(parseFormula('1'.repeat(MAX_LEN + 1)).ok).toBe(false)
  expect(parseFormula(` ${'1 '.repeat(100)}`).ok).toBe(false)
  const long = parseFormula('1'.repeat(200))
  expect(long.ok === false && /too long/.test(long.error)).toBe(true)
  expect(parseCondition(`calls > 1${' '.repeat(80)}`).ok).toBe(false)
})

test('token cap: 40 tokens pass, 41 do not', () => {
  const sum = (n: number) => Array.from({ length: n }, () => '1').join('+') // n numbers, n-1 operators
  expect(parseFormula(sum(20)).ok).toBe(true) // 39 tokens
  expect(parseFormula(`${sum(20)}+1`).ok).toBe(false) // 41 tokens
  const r = parseFormula(sum(25))
  expect(r.ok === false && /too long/.test(r.error)).toBe(true)
})

test('deep nesting is refused at depth 9, accepted at depth 8, and never overflows the stack', () => {
  const nest = (n: number) => `${'('.repeat(n)}1${')'.repeat(n)}`
  expect(parseFormula(nest(MAX_DEPTH)).ok).toBe(true)
  expect(f(nest(MAX_DEPTH))).toBe(1)
  const r = parseFormula(nest(MAX_DEPTH + 1))
  expect(r.ok).toBe(false)
  expect(r.ok === false && /nested too deeply/.test(r.error)).toBe(true)
  expect(parseFormula(nest(39)).ok).toBe(false)
  expect(parseFormula('-'.repeat(MAX_DEPTH + 1) + '1').ok).toBe(false)
  expect(parseFormula('-'.repeat(MAX_DEPTH) + '1').ok).toBe(true)
  expect(parseCondition(`${'('.repeat(40)}1`).ok).toBe(false)
  expect(parseCondition(')'.repeat(80)).ok).toBe(false)
  expect(parseCondition('('.repeat(80)).ok).toBe(false)
})

test('huge numbers: 9 digits pass, 10 do not, and products stay under 1e15', () => {
  expect(f('999999999')).toBe(999999999)
  expect(parseFormula('1000000000').ok).toBe(false)
  expect(parseFormula('99999999999999999999999999').ok).toBe(false)
  expect(parseFormula('0.1234567').ok).toBe(false)
  expect(f('999999999 * 999999999')).toBeNull() // 1e18 > 1e15
  expect(f('999999 * 999999')).toBe(999998000001)
  expect(f('999999999 * 999999999 * 999999999 * 999999999 * 999999999 * 999999999 * 999999999 * 999999999')).toBeNull()
  expect(f('999999999 + 999999999')).toBe(1999999998)
  expect(f('-999999999 * 999999999')).toBeNull()
  expect(f('1 / 0.000001')).toBe(1000000)
  expect(f('999999999 / 0.000001')).toBe(999999999000000) // just under 1e15
  expect(f('999999999 / 0.000001 * 2')).toBeNull()
})

test('metrics that are not finite numbers count as 0', () => {
  const bad = { ...M, calls: Number.NaN, errors: Number.POSITIVE_INFINITY } as Metrics
  expect(calc('calls + errors', bad)).toBe(0)
})

test('conditions: comparisons, && and ||, with arithmetic inside', () => {
  const c = (s: string) => holds(s, M)
  expect(c('errors > 3')).toBe(true)
  expect(c('errors > 4')).toBe(false)
  expect(c('errors >= 4')).toBe(true)
  expect(c('errors < 5')).toBe(true)
  expect(c('errors <= 3')).toBe(false)
  expect(c('errors == 4')).toBe(true)
  expect(c('errors != 4')).toBe(false)
  expect(c('errors / calls > 0.05')).toBe(true)
  expect(c('calls >= 10 && errors >= 10')).toBe(false)
  expect(c('calls >= 10 || errors >= 10')).toBe(true)
  expect(c('(calls >= 10 || errors >= 10) && ctx > 50')).toBe(true)
  expect(c('budget > 0 && spend > budget')).toBe(false)
  expect(c('calls')).toBe(true)
  expect(c('files - 3')).toBe(false)
  expect(c('1 + 1 == 2')).toBe(true)
  expect(c('0.1 + 0.2 == 0.3')).toBe(true) // compared with a tolerance
  expect(c('1 > 2 || 2 > 1 && 3 > 2')).toBe(true) // && binds tighter than ||
})

test('conditions refuse what a formula refuses, plus chained comparisons and stray operators', () => {
  for (const s of ['1 < 2 < 3', 'calls >', '> 1', 'calls = 1', 'calls & errors', 'calls | errors', 'calls !', '!calls', 'calls <> 1', 'calls =< 1', 'foo > 1', 'calls > foo', '(calls > 1', 'calls > 1)', '&& calls', 'calls &&', 'calls || || errors']) {
    expect(parseCondition(s).ok).toBe(false)
    expect(holds(s, M)).toBe(false)
  }
})

test('a bad condition is false, never true', () => {
  expect(holds('calls >', M)).toBe(false)
  expect(holds('', M)).toBe(false)
  expect(holds('constructor > 1', M)).toBe(false)
  expect(holds('999999999 * 999999999 * 999999999 > 1', M)).toBe(false)
})

test('parse reports which metrics a formula uses and whether it is a condition', () => {
  const p = parse('errors / calls + errors', false)
  expect(p.ok && p.names.sort().join()).toBe('calls,errors')
  expect(p.ok && p.isCondition).toBe(false)
  const q = parse('calls > 1 && errors > 0', true)
  expect(q.ok && q.isCondition).toBe(true)
  const r = parse('calls + 1', true)
  expect(r.ok && r.isCondition).toBe(false)
})

test('hostile text never throws', () => {
  const hostile = [
    '__proto__.polluted = 1',
    'constructor.constructor("return process")()',
    '${process.env.HOME}',
    '</script><script>alert(1)</script>',
    '‮1+1',
    'calls + 1',
    '😀',
    '1 + ' + '(1 + '.repeat(8) + '1' + ')'.repeat(8),
    'a'.repeat(79),
    '9'.repeat(79),
    '('.repeat(79),
    '-'.repeat(79),
    '1'.padEnd(80, ' '),
    '1'.padEnd(81, ' '),
  ]

  for (const s of hostile) {
    expect(() => parseFormula(s)).not.toThrow()
    expect(() => parseCondition(s)).not.toThrow()
    expect(() => calc(s, M)).not.toThrow()
  }
  // prototype pollution did not happen
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

test('a random-ish sweep of generated formulas always returns a number or null', () => {
  const pieces = ['calls', 'errors', '1', '2.5', '+', '-', '*', '/', '(', ')', '>', '&&', ' ', '999999999']
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff

    return seed
  }

  for (let i = 0; i < 300; i++) {
    let s = ''

    for (let j = 0; j < 12; j++) {
      s += pieces[rnd() % pieces.length]
    }
    const v = calc(s, M, true)
    expect(v === null || Number.isFinite(v)).toBe(true)
  }
})
