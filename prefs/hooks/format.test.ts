import { expect, test } from 'claude-code/testing'

import {
  DAY_NAMES,
  DEFAULT_CTX,
  ctxFrom,
  deviceOffsetMin,
  displayPath,
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatSize,
  formatTime,
  isQuiet,
  minutesOfDay,
  parseQuiet,
  relativeTime,
  shortNumber,
  startOfWeek,
  truncate,
  weekOrder,
  weekdayOf,
  zoneLabel,
} from './format'
import type { FmtCtx } from './format'

const C = DEFAULT_CTX
const x = (o: Partial<FmtCtx>): FmtCtx => ({ ...DEFAULT_CTX, ...o })
// Wednesday 2026-11-25 15:07:09 UTC
const T = Date.UTC(2026, 10, 25, 15, 7, 9)
const NO = '\u2013'

// ------------------------------------------------------------------ numbers

test('formatNumber: grouping, decimals and signs', () => {
  expect(formatNumber(0, C)).toBe('0')
  expect(formatNumber(12, C)).toBe('12')
  expect(formatNumber(123, C)).toBe('123')
  expect(formatNumber(1000, C)).toBe('1,000')
  expect(formatNumber(100000, C)).toBe('100,000')
  expect(formatNumber(1234567.891, C, 2)).toBe('1,234,567.89')
  expect(formatNumber(-1234.5, C, 1)).toBe('-1,234.5')
  expect(formatNumber(1.23456, C, 4)).toBe('1.2346')
  expect(formatNumber(5, C, 2)).toBe('5.00')
})

test('formatNumber: rounds half away from zero and absorbs binary noise', () => {
  expect(formatNumber(1.005, C, 2)).toBe('1.01')
  expect(formatNumber(0.5, C)).toBe('1')
  expect(formatNumber(2.5, C)).toBe('3')
  expect(formatNumber(-0.5, C)).toBe('-1')
  expect(formatNumber(-2.5, C)).toBe('-3')
  expect(formatNumber(999999.995, C, 2)).toBe('1,000,000.00')
  expect(formatNumber(0.1 + 0.2, C, 2)).toBe('0.30')
})

test('formatNumber: a value that rounds to zero has no minus sign', () => {
  expect(formatNumber(-0.001, C, 2)).toBe('0.00')
  expect(formatNumber(-0.4, C)).toBe('0')
  expect(formatNumber(-0, C)).toBe('0')
})

test('formatNumber: separators come from the context', () => {
  expect(formatNumber(1234567.891, x({ dec: ',', grp: '.' }), 2)).toBe('1.234.567,89')
  expect(formatNumber(1234567.891, x({ dec: '.', grp: ' ' }), 2)).toBe('1 234 567.89')
  expect(formatNumber(1234567.891, x({ dec: '.', grp: '' }), 2)).toBe('1234567.89')
  // the same character for both: the group separator is dropped, never ambiguous
  expect(formatNumber(1234.5, x({ dec: ',', grp: ',' }), 1)).toBe('1234,5')
  expect(formatNumber(1234.5, x({ dec: '.', grp: '.' }), 1)).toBe('1234.5')
})

test('formatNumber: guards against bad input and huge values', () => {
  expect(formatNumber(Number.NaN, C)).toBe(NO)
  expect(formatNumber(Infinity, C)).toBe(NO)
  expect(formatNumber(-Infinity, C)).toBe(NO)
  expect(formatNumber('5' as unknown as number, C)).toBe(NO)
  expect(formatNumber(1e15, C)).toBe('1.00e+15')
  expect(formatNumber(-1e15, C)).toBe('-1.00e+15')
  expect(formatNumber(1.5, C, -3)).toBe('2')
  expect(formatNumber(1.5, C, Number.NaN)).toBe('2')
  expect(formatNumber(1.5, C, 99)).toBe('1.5000000000')
  expect(formatNumber(123456789012, C, 10)).toBe('123,456,789,012.0000')
})

test('shortNumber: thresholds, one decimal, no trailing .0', () => {
  expect(shortNumber(0, C)).toBe('0')
  expect(shortNumber(12, C)).toBe('12')
  expect(shortNumber(12.34, C)).toBe('12.3')
  expect(shortNumber(999, C)).toBe('999')
  expect(shortNumber(999.94, C)).toBe('999.9')
  expect(shortNumber(1000, C)).toBe('1k')
  expect(shortNumber(1234, C)).toBe('1.2k')
  expect(shortNumber(1250, C)).toBe('1.3k')
  expect(shortNumber(12345, C)).toBe('12.3k')
  expect(shortNumber(999499, C)).toBe('999.5k')
  expect(shortNumber(1_000_000, C)).toBe('1M')
  expect(shortNumber(1_250_000, C)).toBe('1.3M')
  expect(shortNumber(2_400_000_000, C)).toBe('2.4B')
  expect(shortNumber(3e12, C)).toBe('3T')
})

test('shortNumber: rounding carries into the next unit', () => {
  expect(shortNumber(999.95, C)).toBe('1k')
  expect(shortNumber(999_949, C)).toBe('999.9k')
  expect(shortNumber(999_950, C)).toBe('1M')
  expect(shortNumber(999_950_000, C)).toBe('1B')
  expect(shortNumber(999_950_000_000, C)).toBe('1T')
  expect(shortNumber(1.5e15, C)).toBe('1500T')
})

test('shortNumber: signs, separator and bad input', () => {
  expect(shortNumber(-1234, C)).toBe('-1.2k')
  expect(shortNumber(-0.04, C)).toBe('0')
  expect(shortNumber(1234, x({ dec: ',' }))).toBe('1,2k')
  expect(shortNumber(12.34, x({ dec: ',' }))).toBe('12,3')
  expect(shortNumber(Number.NaN, C)).toBe(NO)
  expect(shortNumber(Infinity, C)).toBe(NO)
})

test('formatCount picks the short form from the context', () => {
  expect(formatCount(1234, C)).toBe('1,234')
  expect(formatCount(1234, x({ short: true }))).toBe('1.2k')
  expect(formatCount(1234.5, C, { decimals: 1 })).toBe('1,234.5')
  expect(formatCount(1234, C, { tile: true })).toBe('1,234')
  expect(formatCount(1234, x({ tilesCompact: true }), { tile: true })).toBe('1.2k')
  expect(formatCount(1234, x({ tilesCompact: true }))).toBe('1,234')
})

// ------------------------------------------------------------------ money

test('formatMoney: symbol, cents and sign', () => {
  expect(formatMoney(1234.5, C)).toBe('$1,234.50')
  expect(formatMoney(0, C)).toBe('$0.00')
  expect(formatMoney(-0.5, C)).toBe('-$0.50')
  expect(formatMoney(0.004, C)).toBe('$0.00')
  expect(formatMoney(-0.004, C)).toBe('$0.00')
  expect(formatMoney(1234.5, x({ cents: false }))).toBe('$1,235')
  expect(formatMoney(-1234.5, x({ cents: false }))).toBe('-$1,235')
  expect(formatMoney(0.4, x({ cents: false }))).toBe('$0')
})

test('formatMoney: every symbol', () => {
  expect(formatMoney(100, x({ symbol: 'usd' }))).toBe('$100.00')
  expect(formatMoney(100, x({ symbol: 'eur' }))).toBe('\u20ac100.00')
  expect(formatMoney(100, x({ symbol: 'gbp' }))).toBe('\u00a3100.00')
  expect(formatMoney(100, x({ symbol: 'jpy', cents: false }))).toBe('\u00a5100')
  expect(formatMoney(100, x({ symbol: 'chf' }))).toBe('CHF 100.00')
  expect(formatMoney(100, x({ symbol: 'none' }))).toBe('100.00')
  expect(formatMoney(100, x({ symbol: 'bogus' }))).toBe('$100.00')
})

test('formatMoney: conversion rate and bad rates', () => {
  expect(formatMoney(100, x({ rate: 0.92 }))).toBe('$92.00')
  expect(formatMoney(10, x({ symbol: 'jpy', cents: false, rate: 150 }))).toBe('\u00a51,500')
  expect(formatMoney(100, x({ rate: 0 }))).toBe('$100.00')
  expect(formatMoney(100, x({ rate: -2 }))).toBe('$100.00')
  expect(formatMoney(100, x({ rate: Number.NaN }))).toBe('$100.00')
  expect(formatMoney(-100, x({ rate: 0.5 }))).toBe('-$50.00')
})

test('formatMoney: separators, tiles and bad input', () => {
  expect(formatMoney(1234.5, x({ symbol: 'eur', dec: ',', grp: '.' }))).toBe('\u20ac1.234,50')
  expect(formatMoney(12345.67, x({ tilesCompact: true }), { tile: true })).toBe('$12.3k')
  expect(formatMoney(-12345, x({ tilesCompact: true }), { tile: true })).toBe('-$12.3k')
  expect(formatMoney(999, x({ tilesCompact: true }), { tile: true })).toBe('$999.00')
  expect(formatMoney(12345.67, x({ tilesCompact: false }), { tile: true })).toBe('$12,345.67')
  expect(formatMoney(12345.67, x({ tilesCompact: true }))).toBe('$12,345.67')
  expect(formatMoney(Number.NaN, C)).toBe(NO)
  expect(formatMoney(Infinity, C)).toBe(NO)
})

// ------------------------------------------------------------------ time

test('formatTime: 24 hour clock', () => {
  expect(formatTime(T, C)).toBe('15:07')
  expect(formatTime(T, C, true)).toBe('15:07:09')
  expect(formatTime(Date.UTC(2026, 0, 1, 0, 5), C)).toBe('00:05')
  expect(formatTime(Date.UTC(2026, 0, 1, 9, 0), C)).toBe('09:00')
})

test('formatTime: 12 hour clock around midnight and noon', () => {
  const h12 = x({ hours: 12 })

  expect(formatTime(T, h12)).toBe('3:07 PM')
  expect(formatTime(T, h12, true)).toBe('3:07:09 PM')
  expect(formatTime(Date.UTC(2026, 0, 1, 0, 5), h12)).toBe('12:05 AM')
  expect(formatTime(Date.UTC(2026, 0, 1, 12, 0), h12)).toBe('12:00 PM')
  expect(formatTime(Date.UTC(2026, 0, 1, 23, 59), h12)).toBe('11:59 PM')
  expect(formatTime(Date.UTC(2026, 0, 1, 1, 0), h12)).toBe('1:00 AM')
  expect(formatTime(Date.UTC(2026, 0, 1, 11, 59), h12)).toBe('11:59 AM')
})

test('formatTime: zones, midnight crossing and bad input', () => {
  expect(formatTime(T, x({ tzMin: 60 }))).toBe('16:07')
  expect(formatTime(T, x({ tzMin: -300 }))).toBe('10:07')
  expect(formatTime(T, x({ tzMin: 330 }))).toBe('20:37')
  expect(formatTime(Date.UTC(2026, 0, 1, 23, 30), x({ tzMin: 60 }))).toBe('00:30')
  expect(formatTime(Date.UTC(2026, 0, 1, 0, 30), x({ tzMin: -60 }))).toBe('23:30')
  expect(formatTime(Number.NaN, C)).toBe(NO)
  expect(formatTime(Infinity, C)).toBe(NO)
  expect(formatTime(1e300, C)).toBe(NO)
})

test('formatDate: the three styles', () => {
  expect(formatDate(T, x({ date: 'iso' }))).toBe('2026-11-25')
  expect(formatDate(T, x({ date: 'dmy' }))).toBe('25/11/2026')
  expect(formatDate(T, x({ date: 'mdy' }))).toBe('11/25/2026')
  expect(formatDate(Date.UTC(2024, 1, 29), C)).toBe('2024-02-29')
  expect(formatDate(Date.UTC(2026, 0, 5), x({ date: 'dmy' }))).toBe('05/01/2026')
})

test('formatDate: zone shifts the day, bad input', () => {
  expect(formatDate(Date.UTC(2026, 10, 25, 23, 30), x({ tzMin: 60 }))).toBe('2026-11-26')
  expect(formatDate(Date.UTC(2026, 11, 31, 23, 59), x({ tzMin: 1 }))).toBe('2027-01-01')
  expect(formatDate(Date.UTC(2026, 0, 1, 0, 30), x({ tzMin: -60 }))).toBe('2025-12-31')
  expect(formatDate(Number.NaN, C)).toBe(NO)
  expect(formatDateTime(T, C)).toBe('2026-11-25 15:07')
  expect(formatDateTime(T, x({ hours: 12, date: 'mdy' }))).toBe('11/25/2026 3:07 PM')
  expect(formatDateTime(Number.NaN, C)).toBe(NO)
})

test('relativeTime: past', () => {
  const now = T

  expect(relativeTime(now, now)).toBe('just now')
  expect(relativeTime(now - 30_000, now)).toBe('just now')
  expect(relativeTime(now - 59_000, now)).toBe('just now')
  expect(relativeTime(now - 60_000, now)).toBe('1 min ago')
  expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago')
  expect(relativeTime(now - 3_599_000, now)).toBe('59 min ago')
  expect(relativeTime(now - 3_600_000, now)).toBe('1 h ago')
  expect(relativeTime(now - 86_399_000, now)).toBe('23 h ago')
  expect(relativeTime(now - 86_400_000, now)).toBe('1 d ago')
  expect(relativeTime(now - 29 * 86_400_000, now)).toBe('29 d ago')
})

test('relativeTime: months, years, future and bad input', () => {
  const now = T

  expect(relativeTime(now - 30 * 86_400_000, now)).toBe('1 mo ago')
  expect(relativeTime(now - 364 * 86_400_000, now)).toBe('12 mo ago')
  expect(relativeTime(now - 365 * 86_400_000, now)).toBe('1 y ago')
  expect(relativeTime(now - 3 * 365 * 86_400_000, now)).toBe('3 y ago')
  expect(relativeTime(now + 30_000, now)).toBe('in a moment')
  expect(relativeTime(now + 5 * 60_000, now)).toBe('in 5 min')
  expect(relativeTime(now + 3 * 3_600_000, now)).toBe('in 3 h')
  expect(relativeTime(now + 2 * 86_400_000, now)).toBe('in 2 d')
  expect(relativeTime(Number.NaN, now)).toBe(NO)
  expect(relativeTime(now, Infinity)).toBe(NO)
})

// ------------------------------------------------------------------ weeks and zones

test('weekdayOf and weekOrder', () => {
  expect(weekdayOf(T, 0)).toBe(3)
  expect(weekdayOf(Date.UTC(2026, 10, 22, 23, 30), 60)).toBe(1)
  expect(weekOrder('mon').join(' ')).toBe('Mon Tue Wed Thu Fri Sat Sun')
  expect(weekOrder('sun').join(' ')).toBe('Sun Mon Tue Wed Thu Fri Sat')
  expect(weekOrder('sat').join(' ')).toBe('Sat Sun Mon Tue Wed Thu Fri')
  expect(weekOrder('mon', 'de').join(' ')).toBe('Mo Di Mi Do Fr Sa So')
  expect(weekOrder('mon', 'es')[0]).toBe('lun')
  expect(weekOrder('mon', 'xx')[0]).toBe('Mon')
  expect(Object.keys(DAY_NAMES).sort()).toEqual(['de', 'en', 'es'])
})

test('startOfWeek follows the first day and the zone', () => {
  expect(startOfWeek(T, 0, 'mon')).toBe(Date.UTC(2026, 10, 23))
  expect(startOfWeek(T, 0, 'sun')).toBe(Date.UTC(2026, 10, 22))
  expect(startOfWeek(T, 0, 'sat')).toBe(Date.UTC(2026, 10, 21))
  // already the first day: itself at midnight
  expect(startOfWeek(Date.UTC(2026, 10, 23, 0, 0), 0, 'mon')).toBe(Date.UTC(2026, 10, 23))
  expect(startOfWeek(Date.UTC(2026, 10, 23, 23, 59), 0, 'mon')).toBe(Date.UTC(2026, 10, 23))
  // Sunday evening belongs to the week that began the Monday before
  expect(startOfWeek(Date.UTC(2026, 10, 22, 23, 59), 0, 'mon')).toBe(Date.UTC(2026, 10, 16))
  // in UTC+1, Sunday 23:30 UTC is already Monday 00:30 local
  expect(startOfWeek(Date.UTC(2026, 10, 22, 23, 30), 60, 'mon')).toBe(Date.UTC(2026, 10, 22, 23))
  expect(startOfWeek(Date.UTC(2026, 10, 25, 3, 0), -300, 'mon')).toBe(Date.UTC(2026, 10, 23, 5))
})

test('zoneLabel and device offset', () => {
  expect(zoneLabel(0)).toBe('UTC')
  expect(zoneLabel(60)).toBe('UTC+01:00')
  expect(zoneLabel(-330)).toBe('UTC-05:30')
  expect(zoneLabel(840)).toBe('UTC+14:00')
  expect(zoneLabel(-720)).toBe('UTC-12:00')
  expect(zoneLabel(Number.NaN)).toBe('UTC')
  expect(deviceOffsetMin(T)).toBe(-new Date(T).getTimezoneOffset() || 0)
  expect(deviceOffsetMin(Number.NaN)).toBe(0)
})

test('ctxFrom reads every preference and keeps defaults for the rest', () => {
  const d = ctxFrom({ 'tz.mode': 'fixed', 'tz.offset': 0 }, T)

  expect(d).toEqual(C)
  const c = ctxFrom(
    { 'money.symbol': 'eur', 'money.cents': false, 'money.rate': 0.92, 'time.hours': '12h', 'date.format': 'dmy', 'num.decimal': 'comma', 'num.group': 'dot', 'num.short': true, 'tiles.compact': true, 'size.units': 'KiB', 'trunc.len': 30, 'path.style': 'short', 'tz.mode': 'fixed', 'tz.offset': 120, 'week.start': 'sun' },
    T,
  )

  expect(c).toEqual({ symbol: 'eur', cents: false, rate: 0.92, hours: 12, date: 'dmy', dec: ',', grp: '.', short: true, tilesCompact: true, binary: true, trunc: 30, path: 'short', tzMin: 120, weekStart: 'sun' })
})

test('ctxFrom: equal separators never reach the formatters, device zone is used in local mode', () => {
  expect(ctxFrom({ 'num.decimal': 'comma' }, T).grp).toBe('')
  expect(ctxFrom({ 'num.group': 'dot' }, T).dec).toBe('.')
  expect(ctxFrom({ 'num.group': 'dot' }, T).grp).toBe('')
  expect(ctxFrom({ 'num.group': 'space' }, T).grp).toBe(' ')
  expect(ctxFrom({ 'num.group': 'none' }, T).grp).toBe('')
  expect(ctxFrom({}, T).tzMin).toBe(deviceOffsetMin(T))
  expect(ctxFrom({ 'tz.offset': 300 }, T).tzMin).toBe(deviceOffsetMin(T))
  // a junk value falls back to the default instead of leaking through
  expect(ctxFrom({ 'money.rate': 'x' as unknown as number }, T).rate).toBe(1)
})

// ------------------------------------------------------------------ sizes

test('formatSize: decimal units', () => {
  expect(formatSize(0, C)).toBe('0 B')
  expect(formatSize(1, C)).toBe('1 B')
  expect(formatSize(999, C)).toBe('999 B')
  expect(formatSize(1000, C)).toBe('1 KB')
  expect(formatSize(1536, C)).toBe('1.5 KB')
  expect(formatSize(1_536_000, C)).toBe('1.5 MB')
  expect(formatSize(734_003_200, C)).toBe('734 MB')
  expect(formatSize(1_000_000_000, C)).toBe('1 GB')
  expect(formatSize(5e12, C)).toBe('5 TB')
  expect(formatSize(5e15, C)).toBe('5000 TB')
})

test('formatSize: binary units and the carry at the boundary', () => {
  const b = x({ binary: true })

  expect(formatSize(1000, b)).toBe('1000 B')
  expect(formatSize(1023, b)).toBe('1023 B')
  expect(formatSize(1024, b)).toBe('1 KiB')
  expect(formatSize(1536, b)).toBe('1.5 KiB')
  expect(formatSize(1_048_575, b)).toBe('1 MiB')
  expect(formatSize(1_073_741_824, b)).toBe('1 GiB')
  expect(formatSize(999_999, C)).toBe('1 MB')
  expect(formatSize(999_949, C)).toBe('999.9 KB')
})

test('formatSize: odd input', () => {
  expect(formatSize(-1, C)).toBe(NO)
  expect(formatSize(Number.NaN, C)).toBe(NO)
  expect(formatSize(Infinity, C)).toBe(NO)
  expect(formatSize(1.5, C)).toBe('2 B')
  expect(formatSize(1536, x({ dec: ',' }))).toBe('1,5 KB')
})

// ------------------------------------------------------------------ text and paths

test('truncate counts the ellipsis and whole characters', () => {
  expect(truncate('hello', 10)).toBe('hello')
  expect(truncate('hello', 5)).toBe('hello')
  expect(truncate('hello world', 5)).toBe('hell\u2026')
  expect(truncate('hello world', 1)).toBe('\u2026')
  expect(truncate('hello world', 0)).toBe('')
  expect(truncate('hello world', -4)).toBe('')
  expect(truncate('hello world', Number.NaN)).toBe('')
  expect(truncate('', 5)).toBe('')
  expect(truncate('ab cd ef', 4)).toBe('ab\u2026')
  expect(truncate(12345 as unknown as string, 3)).toBe('12\u2026')
  expect(truncate('hello world', 5.9)).toBe('hell\u2026')
})

test('truncate never splits an emoji', () => {
  const s = '\u{1F600}\u{1F600}\u{1F600}\u{1F600}'

  expect(truncate(s, 3)).toBe('\u{1F600}\u{1F600}\u2026')
  expect(truncate(s, 4)).toBe(s)
  expect(truncate(s, 5)).toBe(s)
})

test('displayPath: the three styles with a home directory', () => {
  const p = '/Users/you/projects/app/src/Button.tsx'

  expect(displayPath(p, 'full', '/Users/you')).toBe('~/projects/app/src/Button.tsx')
  expect(displayPath(p, 'short', '/Users/you')).toBe('Button.tsx')
  expect(displayPath(p, 'mid', '/Users/you')).toBe('~/\u2026/src/Button.tsx')
  expect(displayPath(p, 'full')).toBe(p)
  expect(displayPath(p, 'mid')).toBe('/Users/\u2026/src/Button.tsx')
  expect(displayPath('/Users/you', 'mid', '/Users/you')).toBe('~')
  expect(displayPath('/Users/you/', 'full', '/Users/you/')).toBe('~')
})

test('displayPath: short paths, roots, siblings of home and other separators', () => {
  expect(displayPath('/a/b/c', 'mid')).toBe('/a/b/c')
  expect(displayPath('/a/b/c/d', 'mid')).toBe('/a/\u2026/c/d')
  expect(displayPath('/a/b/c/d/', 'mid')).toBe('/a/\u2026/c/d')
  expect(displayPath('/', 'short')).toBe('/')
  expect(displayPath('/', 'mid')).toBe('/')
  expect(displayPath('', 'mid')).toBe('')
  expect(displayPath('/Users/youngster/x.ts', 'full', '/Users/you')).toBe('/Users/youngster/x.ts')
  expect(displayPath('src/a/b/c.ts', 'mid')).toBe('src/\u2026/b/c.ts')
  expect(displayPath('C:\\Users\\me\\proj\\src\\a.ts', 'mid')).toBe('C:\\\u2026\\src\\a.ts')
  expect(displayPath('C:\\Users\\me\\proj\\src\\a.ts', 'short')).toBe('a.ts')
  expect(displayPath('file.txt', 'short')).toBe('file.txt')
})

// ------------------------------------------------------------------ quiet hours

test('parseQuiet accepts only a valid window', () => {
  expect(parseQuiet('22:00-07:00')).toEqual({ from: 1320, to: 420 })
  expect(parseQuiet('00:00-08:30')).toEqual({ from: 0, to: 510 })
  expect(parseQuiet('off')).toBeNull()
  expect(parseQuiet('')).toBeNull()
  expect(parseQuiet('25:00-07:00')).toBeNull()
  expect(parseQuiet('22:00-07:60')).toBeNull()
  expect(parseQuiet('2:00-07:00')).toBeNull()
  expect(parseQuiet('22:00-07:00 ')).toBeNull()
  expect(parseQuiet('22:00')).toBeNull()
})

test('isQuiet: a window that wraps midnight, one that does not, and degenerate ones', () => {
  expect(isQuiet('22:00-07:00', 1380)).toBe(true)
  expect(isQuiet('22:00-07:00', 180)).toBe(true)
  expect(isQuiet('22:00-07:00', 1320)).toBe(true)
  expect(isQuiet('22:00-07:00', 1319)).toBe(false)
  expect(isQuiet('22:00-07:00', 419)).toBe(true)
  expect(isQuiet('22:00-07:00', 420)).toBe(false)
  expect(isQuiet('22:00-07:00', 12 * 60)).toBe(false)
  expect(isQuiet('12:00-13:00', 12 * 60 + 30)).toBe(true)
  expect(isQuiet('12:00-13:00', 13 * 60)).toBe(false)
  expect(isQuiet('12:00-13:00', 11 * 60 + 59)).toBe(false)
  expect(isQuiet('10:00-10:00', 600)).toBe(false)
  expect(isQuiet('off', 600)).toBe(false)
  expect(isQuiet('nonsense', 600)).toBe(false)
})

test('minutesOfDay respects the zone', () => {
  expect(minutesOfDay(T, 0)).toBe(15 * 60 + 7)
  expect(minutesOfDay(T, 60)).toBe(16 * 60 + 7)
  expect(minutesOfDay(Date.UTC(2026, 0, 1, 0, 30), -60)).toBe(23 * 60 + 30)
  expect(minutesOfDay(Date.UTC(2026, 0, 1, 23, 30), 60)).toBe(30)
})
