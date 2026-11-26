import { expect, test } from 'claude-code/testing'

import { MODS } from './modlist'
import {
  KEY_RE,
  MAX_OVERRIDES,
  PREFS,
  acceptText,
  applyChanges,
  changeLine,
  changedCount,
  checkTyped,
  crossCheck,
  defaultOf,
  diffOver,
  nearKeys,
  nudge,
  parseValue,
  prefsInGroup,
  sanitizeOverrides,
  searchPrefs,
  sectionsOf,
  showValue,
  specFor,
  valueOf,
  withValue,
} from './prefs'
import type { PrefSpec } from './prefs'
import { FAMILIES, FIXED, GROUPS, MOD_NAME_RE } from './table'

const spec = (key: string): PrefSpec => {
  const s = specFor(key)

  if (s === undefined) {
    throw new Error(`no spec ${key}`)
  }

  return s
}

// ------------------------------------------------------------------ the table itself

test('every fixed preference is well formed', () => {
  const seen = new Set<string>()

  for (const p of FIXED) {
    expect(KEY_RE.test(p.key)).toBe(true)
    expect(seen.has(p.key)).toBe(false)
    seen.add(p.key)
    expect(['enum', 'boolean', 'number'].includes(p.type)).toBe(true)
    expect(GROUPS.includes(p.group)).toBe(true)
    expect(p.section.length).toBeGreaterThan(0)
    expect(p.label.length).toBeGreaterThan(2)
    expect(p.description.length).toBeGreaterThan(10)
    expect(p.description.length).toBeLessThan(300)
    expect(checkTyped(p, p.default).ok).toBe(true)
  }
})

test('enum preferences list unique string values that include the default', () => {
  for (const p of PREFS.filter(q => q.type === 'enum')) {
    const values = p.values ?? []

    expect(values.length).toBeGreaterThan(1)
    expect(new Set(values).size).toBe(values.length)
    expect(values.includes(p.default as string)).toBe(true)

    for (const v of values) {
      expect(v.length > 0 && v.length < 24 && !/\s/.test(v)).toBe(true)
    }
  }
})

test('number preferences have a sane range, step and default', () => {
  for (const p of PREFS.filter(q => q.type === 'number')) {
    expect(typeof p.min === 'number' && typeof p.max === 'number' && typeof p.step === 'number').toBe(true)
    expect((p.min as number) < (p.max as number)).toBe(true)
    expect((p.step as number) > 0).toBe(true)
    expect((p.default as number) >= (p.min as number) && (p.default as number) <= (p.max as number)).toBe(true)
    // the +/- buttons need a reasonable number of presses to cross the range (money.rate is set exactly with /pfset)
    if (p.key !== 'money.rate') {
      expect(((p.max as number) - (p.min as number)) / (p.step as number)).toBeLessThan(5000)
    }
  }
})

test('the families expand over the listed mods without clashes', () => {
  const keys = PREFS.map(p => p.key)

  expect(new Set(keys).size).toBe(keys.length)
  expect(keys.length).toBe(FIXED.length + FAMILIES.length * MODS.length)

  for (const f of FAMILIES) {
    expect(f.prefix.endsWith('.')).toBe(true)
    expect(FIXED.some(p => p.key.startsWith(f.prefix))).toBe(false)
  }

  for (const m of MODS) {
    expect(MOD_NAME_RE.test(m.name)).toBe(true)
  }
  expect(MODS.some(m => m.name === 'prefs')).toBe(true)
  expect(MODS.some(m => m.name === 'settings')).toBe(true)
})

test('only autoopen.prefs is marked as acted on among the per-mod preferences', () => {
  const used = PREFS.filter(p => p.isUsedHere && FAMILIES.some(f => p.key.startsWith(f.prefix))).map(p => p.key)

  expect(used).toEqual(['autoopen.prefs'])
})

test('the ideas the brief asks for are all present', () => {
  const need = [
    'level', 'lang', 'week.start', 'tz.mode', 'tz.offset', 'sync.mode', 'money.symbol', 'money.cents', 'money.rate', 'time.hours', 'date.format', 'num.decimal', 'num.group', 'num.short', 'tiles.compact', 'size.units', 'trunc.len', 'path.style',
    'pane.tab.prefs', 'pane.remember', 'pane.placement', 'pane.width', 'motion.level', 'anim.speed', 'anim.entrance', 'tip.hover', 'tip.delay', 'toast.ms', 'toast.pos', 'volume.ui', 'notify.errors', 'quiet.alerts', 'chart.type.cost', 'chart.range', 'chart.smooth',
    'chart.grid', 'chart.labels', 'chart.legend', 'chart.ramp', 'rows.page', 'sort.default', 'confirm.destructive', 'newproject.clear', 'record.alerts', 'retain.alerts', 'autoopen.prefs',
  ]

  for (const k of need) {
    expect(specFor(k) !== undefined).toBe(true)
  }
  expect(MODS.length).toBeGreaterThan(10)
})

// ------------------------------------------------------------------ lookup

test('specFor finds fixed keys, family keys for known mods and for mods added later', () => {
  expect(spec('money.symbol').default).toBe('usd')
  expect(spec('quiet.alerts').type).toBe('enum')
  expect(spec('quiet.brand-new-mod').default).toBe('off')
  expect(spec('retain.brand-new-mod').max).toBe(365)
  expect(spec('record.x1').default).toBe(true)
  expect(spec('autoopen.prefs').isUsedHere).toBe(true)
  expect(spec('autoopen.some-other').isUsedHere).toBe(false)
  expect(defaultOf('toast.ms')).toBe(4000)
  expect(defaultOf('nope')).toBeUndefined()
})

test('specFor rejects anything that is not a listed key or a valid family key', () => {
  for (const bad of ['', 'quiet.', 'quiet.A', 'quiet.a b', 'quiet.-x', '__proto__', 'constructor', 'toString', 'Money.cents', 'money.cents ', 'money..cents', 'nope', 'x'.repeat(70), 'quiet.' + 'a'.repeat(42), 'hasOwnProperty']) {
    expect(specFor(bad)).toBeUndefined()
  }

  for (const notString of [undefined, null, 5, {}, []]) {
    expect(specFor(notString)).toBeUndefined()
  }
})

// ------------------------------------------------------------------ parsing typed text

test('parseValue booleans accept only the known words', () => {
  const s = spec('money.cents')

  for (const w of ['on', 'ON', 'true', 'Yes', '1', ' on ']) {
    expect(parseValue(s, w)).toEqual({ ok: true, value: true })
  }

  for (const w of ['off', 'OFF', 'false', 'no', '0']) {
    expect(parseValue(s, w)).toEqual({ ok: true, value: false })
  }

  for (const w of ['maybe', '2', 'onn', 'enabled']) {
    expect(parseValue(s, w).ok).toBe(false)
  }
  expect(parseValue(s, '').ok).toBe(false)
  expect(parseValue(s, '   ').ok).toBe(false)
})

test('parseValue numbers: strict format, range and rounding', () => {
  const t = spec('toast.ms')
  const tz = spec('tz.offset')
  const r = spec('money.rate')

  expect(parseValue(t, '4000')).toEqual({ ok: true, value: 4000 })
  expect(parseValue(t, ' 4500 ')).toEqual({ ok: true, value: 4500 })
  expect(parseValue(t, '+2000')).toEqual({ ok: true, value: 2000 })
  expect(parseValue(tz, '-300')).toEqual({ ok: true, value: -300 })
  expect(parseValue(tz, '840')).toEqual({ ok: true, value: 840 })
  expect(parseValue(tz, '-720')).toEqual({ ok: true, value: -720 })
  expect(parseValue(r, '0.92')).toEqual({ ok: true, value: 0.92 })
  expect(parseValue(r, '0.123456')).toEqual({ ok: true, value: 0.1235 })

  for (const bad of ['1e3', '0x10', '5.', '.5', '1,5', 'abc', '--5', '5 5', 'Infinity', 'NaN']) {
    expect(parseValue(t, bad).ok).toBe(false)
  }
  expect(parseValue(t, '999').ok).toBe(false)
  expect(parseValue(t, '15001').ok).toBe(false)
  expect(parseValue(tz, '841').ok).toBe(false)
  expect(parseValue(r, '0').ok).toBe(false)
  expect(parseValue(r, '100001').ok).toBe(false)
  const out = parseValue(t, '5')

  expect(out.ok ? '' : out.message).toContain('1000 to 15000')
})

test('parseValue enums: case-insensitive, canonical result, unknown words explained', () => {
  expect(parseValue(spec('money.symbol'), 'EUR')).toEqual({ ok: true, value: 'eur' })
  expect(parseValue(spec('time.hours'), '24H')).toEqual({ ok: true, value: '24h' })
  expect(parseValue(spec('size.units'), 'kib')).toEqual({ ok: true, value: 'KiB' })
  expect(parseValue(spec('quiet.alerts'), '22:00-07:00')).toEqual({ ok: true, value: '22:00-07:00' })
  const bad = parseValue(spec('time.hours'), '13h')

  expect(bad.ok).toBe(false)
  expect(bad.ok ? '' : bad.message).toContain('12h, 24h')
  expect(parseValue(spec('lang'), '').ok).toBe(false)
})

test('checkTyped is exact: no coercion of stored or imported values', () => {
  expect(checkTyped(spec('money.cents'), true).ok).toBe(true)
  expect(checkTyped(spec('money.cents'), 'true').ok).toBe(false)
  expect(checkTyped(spec('money.cents'), 1).ok).toBe(false)
  expect(checkTyped(spec('toast.ms'), 4000).ok).toBe(true)
  expect(checkTyped(spec('toast.ms'), '4000').ok).toBe(false)
  expect(checkTyped(spec('toast.ms'), Number.NaN).ok).toBe(false)
  expect(checkTyped(spec('toast.ms'), Infinity).ok).toBe(false)
  expect(checkTyped(spec('toast.ms'), 999).ok).toBe(false)
  expect(checkTyped(spec('toast.ms'), 15001).ok).toBe(false)
  expect(checkTyped(spec('toast.ms'), null).ok).toBe(false)
  expect(checkTyped(spec('lang'), 'de').ok).toBe(true)
  expect(checkTyped(spec('lang'), 'DE').ok).toBe(false)
  expect(checkTyped(spec('lang'), 5).ok).toBe(false)
  expect(checkTyped(spec('lang'), ['en']).ok).toBe(false)
  expect(checkTyped(spec('money.rate'), 0.92).ok).toBe(true)
})

test('acceptText and showValue read well', () => {
  expect(acceptText(spec('lang'))).toBe('one of en, es, de')
  expect(acceptText(spec('money.cents'))).toBe('on or off')
  expect(acceptText(spec('toast.ms'))).toBe('a number from 1000 to 15000 ms')
  expect(showValue(spec('money.cents'), true)).toBe('on')
  expect(showValue(spec('money.cents'), false)).toBe('off')
  expect(showValue(spec('toast.ms'), 4000)).toBe('4000 ms')
  expect(showValue(spec('lang'), 'es')).toBe('es')
})

// ------------------------------------------------------------------ +/- buttons

test('nudge steps, clamps and rounds', () => {
  const t = spec('toast.ms')

  expect(nudge(t, 4000, 1)).toBe(4500)
  expect(nudge(t, 4000, -1)).toBe(3500)
  expect(nudge(t, 4000, 1, true)).toBe(9000)
  expect(nudge(t, 4000, -1, true)).toBe(1000)
  expect(nudge(t, 14800, 1)).toBe(15000)
  expect(nudge(t, 1000, -1)).toBe(1000)
  expect(nudge(spec('money.rate'), 1, 1)).toBe(1.05)
  expect(nudge(spec('money.rate'), 0.1, -1)).toBe(0.05)
  expect(nudge(spec('money.rate'), 0.01, -1)).toBe(0.0001)
  expect(nudge(spec('anim.speed'), 1, 1)).toBe(1.25)
  expect(nudge(spec('tz.offset'), 0, -1)).toBe(-15)
  expect(nudge(spec('tz.offset'), 0, -1, true)).toBe(-150)
  expect(nudge(spec('tz.offset'), -720, -1)).toBe(-720)
  expect(nudge(t, 'oops', 1)).toBe(4500)
  expect(nudge(spec('retain.alerts'), 30, 1)).toBe(31)
  expect(nudge(spec('retain.alerts'), 365, 1, true)).toBe(365)
})

// ------------------------------------------------------------------ values and overrides

test('valueOf falls back to the default for missing, wrong or unknown entries', () => {
  expect(valueOf({}, 'toast.ms')).toBe(4000)
  expect(valueOf({ 'toast.ms': 3000 }, 'toast.ms')).toBe(3000)
  expect(valueOf({ 'toast.ms': 'x' }, 'toast.ms')).toBe(4000)
  expect(valueOf({ 'toast.ms': 5 }, 'toast.ms')).toBe(4000)
  expect(valueOf({ lang: 'fr' }, 'lang')).toBe('en')
  expect(valueOf({}, 'nope')).toBe('')
  expect(valueOf({}, 'quiet.whatever')).toBe('off')
  expect(valueOf({ 'quiet.alerts': '22:00-07:00' }, 'quiet.alerts')).toBe('22:00-07:00')
})

test('crossCheck: the decimal and group separators must differ', () => {
  expect(crossCheck({})).toEqual([])
  expect(crossCheck({ 'num.decimal': 'comma', 'num.group': 'dot' })).toEqual([])
  expect(crossCheck({ 'num.decimal': 'comma', 'num.group': 'space' })).toEqual([])
  expect(crossCheck({ 'num.decimal': 'comma' }).length).toBe(1)
  expect(crossCheck({ 'num.group': 'dot' }).length).toBe(1)
  expect(crossCheck({ 'num.decimal': 'comma', 'num.group': 'comma' }).length).toBe(1)
})

test('sanitizeOverrides keeps only valid, non-default, known entries', () => {
  expect(sanitizeOverrides(undefined)).toEqual({})
  expect(sanitizeOverrides(null)).toEqual({})
  expect(sanitizeOverrides('x')).toEqual({})
  expect(sanitizeOverrides([1, 2])).toEqual({})
  expect(sanitizeOverrides({})).toEqual({})
  expect(sanitizeOverrides({ 'money.symbol': 'eur', 'toast.ms': 3000, 'money.cents': false })).toEqual({ 'money.symbol': 'eur', 'toast.ms': 3000, 'money.cents': false })
  // defaults, unknown keys, wrong types and out-of-range values are dropped
  expect(sanitizeOverrides({ 'money.symbol': 'usd', nope: 1, 'toast.ms': '3000', 'tip.delay': 99999, lang: 'fr', 'money.cents': 'false' })).toEqual({})
  expect(sanitizeOverrides({ 'quiet.newmod': '22:00-07:00', 'quiet.Bad': 'off' })).toEqual({ 'quiet.newmod': '22:00-07:00' })
})

test('sanitizeOverrides is safe against hostile objects and is bounded', () => {
  const evil = JSON.parse('{"__proto__": {"lang": "de"}, "constructor": 1, "lang": "es"}')

  expect(sanitizeOverrides(evil)).toEqual({ lang: 'es' })
  expect(({} as Record<string, unknown>)['lang']).toBeUndefined()
  const many: Record<string, unknown> = {}

  for (let i = 0; i < 400; i++) {
    many[`quiet.m${i}`] = '22:00-07:00'
  }
  expect(Object.keys(sanitizeOverrides(many)).length).toBe(MAX_OVERRIDES)
})

test('sanitizeOverrides: keepDefaults is for layers, and a stored conflict is repaired', () => {
  expect(sanitizeOverrides({ 'money.symbol': 'usd' }, true)).toEqual({ 'money.symbol': 'usd' })
  expect(sanitizeOverrides({ 'money.symbol': 'usd', 'money.cents': 'x' }, true)).toEqual({ 'money.symbol': 'usd' })
  expect(sanitizeOverrides({ 'num.decimal': 'comma', 'num.group': 'dot' })).toEqual({ 'num.decimal': 'comma', 'num.group': 'dot' })
  // decimal comma with the default group (comma) conflicts: the group override goes first, then the decimal one
  expect(sanitizeOverrides({ 'num.decimal': 'comma' })).toEqual({})
  expect(sanitizeOverrides({ 'num.group': 'dot', 'money.symbol': 'eur' })).toEqual({ 'money.symbol': 'eur' })
  expect(changedCount({ 'money.symbol': 'eur', 'toast.ms': 3000, bogus: 1 })).toBe(2)
})

test('withValue, diffOver, applyChanges and changeLine', () => {
  const s = spec('money.symbol')
  const a = withValue({}, s, 'eur')

  expect(a).toEqual({ 'money.symbol': 'eur' })
  expect(withValue(a, s, 'usd')).toEqual({})
  expect(withValue(a, s, 'usd', true)).toEqual({ 'money.symbol': 'usd' })
  expect(a).toEqual({ 'money.symbol': 'eur' })
  const d = diffOver({ 'money.symbol': 'eur', lang: 'es' }, { 'money.symbol': 'gbp', 'toast.ms': 3000 })

  expect(d).toEqual([
    { key: 'lang', before: 'es', after: null },
    { key: 'money.symbol', before: 'eur', after: 'gbp' },
    { key: 'toast.ms', before: null, after: 3000 },
  ])
  expect(diffOver(a, a)).toEqual([])
  expect(applyChanges({ 'money.symbol': 'eur', lang: 'es' }, d, 'forward')).toEqual({ 'money.symbol': 'gbp', 'toast.ms': 3000 })
  expect(applyChanges({ 'money.symbol': 'gbp', 'toast.ms': 3000 }, d, 'back')).toEqual({ 'money.symbol': 'eur', lang: 'es' })
  expect(changeLine(d[1]!)).toBe('money.symbol: eur -> gbp')
  expect(changeLine(d[0]!)).toBe('lang: es -> default (en)')
  expect(changeLine(d[2]!)).toBe('toast.ms: default (4000 ms) -> 3000 ms')
})

// ------------------------------------------------------------------ search and groups

test('searchPrefs: every word must match, case-insensitive', () => {
  expect(searchPrefs('cents').some(p => p.key === 'money.cents')).toBe(true)
  expect(searchPrefs('CENTS').some(p => p.key === 'money.cents')).toBe(true)
  expect(searchPrefs('money rate').map(p => p.key)).toContain('money.rate')
  expect(searchPrefs('money rate').map(p => p.key)).not.toContain('time.hours')
  expect(searchPrefs('quiet alerts').map(p => p.key)).toContain('quiet.alerts')
  expect(searchPrefs('')).toEqual([])
  expect(searchPrefs('   ')).toEqual([])
  expect(searchPrefs('zzzzqqqq')).toEqual([])
  expect(searchPrefs('formats').length).toBeGreaterThan(10)
})

test('nearKeys suggests neighbours of a mistyped key', () => {
  expect(nearKeys('money')).toContain('money.symbol')
  expect(nearKeys('money.symb')).toContain('money.symbol')
  expect(nearKeys('zzzz')).toEqual([])
  expect(nearKeys('money').length).toBeLessThan(5)
})

test('groups and sections', () => {
  for (const g of GROUPS) {
    expect(prefsInGroup(g).length).toBeGreaterThan(3)
    expect(sectionsOf(g).length).toBeGreaterThan(0)
  }
  expect(sectionsOf('formats')).toEqual(['Money', 'Time', 'Numbers', 'Units'])
  expect(PREFS.length).toBe(GROUPS.reduce((n, g) => n + prefsInGroup(g).length, 0))
})
