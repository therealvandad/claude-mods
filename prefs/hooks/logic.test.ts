import { expect, test } from 'claude-code/testing'

import {
  BUILTIN_PROFILES,
  COMMANDS,
  EXPORT_FORMAT,
  GLOBAL_ONLY,
  HISTORY_MAX,
  LAYER_CAP,
  LOCALE_KEYS,
  MAX_CHANGES_PER_ENTRY,
  PANE_COLUMNS,
  applyProfile,
  branchKey,
  describeSpec,
  diffText,
  effectiveOver,
  exportText,
  findProfile,
  helpText,
  hmText,
  isBranchText,
  isBuiltinProfile,
  isScopeText,
  layerOver,
  levelPolicy,
  makeEntry,
  matchesProfile,
  paginate,
  parseHM,
  parseImport,
  planSet,
  planValue,
  previewLines,
  profileNames,
  pushHistory,
  rowPreview,
  sanitizeAuto,
  sanitizeHistory,
  sanitizeLayers,
  sanitizeMeta,
  sanitizeProfiles,
  sanitizeSchedule,
  searchLines,
  slotFor,
  slotId,
  sourceOf,
  splitLocale,
  splitWord,
  undoEntries,
  withLayer,
  withSlot,
  withoutSlot,
} from './logic'
import type { HistEntry, Layers } from './logic'
import { MAX_IMPORT_CHARS, MAX_OVERRIDES, crossCheck, sanitizeOverrides, specFor } from './prefs'
import type { Over } from './prefs'
import { GROUPS } from './table'

const T = Date.UTC(2026, 10, 25, 15, 7, 9)
const FLAGS = { project: true, branch: true }
const NONE: Layers = { projects: {}, branches: {} }
const spec = (k: string) => specFor(k)!

// ------------------------------------------------------------------ planning a change

test('planSet changes one value and reports the diff', () => {
  const p = planSet({}, 'money.symbol', 'EUR')

  expect(p.ok && p.next).toEqual({ 'money.symbol': 'eur' })
  expect(p.ok && p.changes).toEqual([{ key: 'money.symbol', before: null, after: 'eur' }])
  expect(p.ok && p.notes).toEqual([])
})

test('planSet: a value equal to the default removes the override', () => {
  const p = planSet({ 'money.symbol': 'eur' }, 'money.symbol', 'usd')

  expect(p.ok && p.next).toEqual({})
  expect(p.ok && p.changes).toEqual([{ key: 'money.symbol', before: 'eur', after: null }])
  const same = planSet({}, 'money.symbol', 'usd')

  expect(same.ok && same.changes).toEqual([])
})

test('planSet: unknown keys and bad values are refused with help', () => {
  const miss = planSet({}, 'money.symbl', 'eur')

  expect(miss.ok).toBe(false)
  const nope = planSet({}, 'zzz', '1')

  expect(nope.ok ? '' : nope.message).toContain('No preference named "zzz"')
  const near = planSet({}, 'money', 'eur')

  expect(near.ok ? '' : near.message).toContain('Closest: money.')
  const bad = planSet({}, 'toast.ms', '12')

  expect(bad.ok ? '' : bad.message).toContain('out of range')
  expect(planSet({}, 'toast.ms', '').ok).toBe(false)
  expect(planSet({}, '  TOAST.MS ', '3000').ok).toBe(true)
})

test('planSet: decimal comma moves the group separator out of the way, group equal to decimal is refused', () => {
  const p = planSet({}, 'num.decimal', 'comma')

  expect(p.ok && p.next).toEqual({ 'num.decimal': 'comma', 'num.group': 'dot' })
  expect(p.ok && p.notes.length).toBe(1)
  expect(crossCheck(p.ok ? p.next : {})).toEqual([])
  const back = planSet({ 'num.decimal': 'comma', 'num.group': 'dot' }, 'num.decimal', 'dot')

  // back to the default dot: the group "dot" would now clash, so it is moved back to its default too
  expect(back.ok && back.next).toEqual({})
  expect(back.ok && back.notes.length).toBe(1)
  const clash = planSet({}, 'num.group', 'dot')

  expect(clash.ok).toBe(false)
  expect(clash.ok ? '' : clash.message).toContain('cannot both be')
})

test('planValue is typed and honours the override limit', () => {
  expect(planValue({}, spec('toast.ms'), 3000).ok).toBe(true)
  expect(planValue({}, spec('toast.ms'), '3000' as unknown as number).ok).toBe(false)
  expect(planValue({}, spec('money.cents'), 'yes' as unknown as boolean).ok).toBe(false)
  const full: Over = {}

  for (let i = 0; i < MAX_OVERRIDES; i++) {
    full[`quiet.m${i}`] = '22:00-07:00'
  }
  const over = planValue(full, spec('lang'), 'de')

  expect(over.ok).toBe(false)
  expect(over.ok ? '' : over.message).toContain(`${MAX_OVERRIDES}`)
  // a layer keeps a value even when it equals the default
  const layer = planValue({}, spec('money.symbol'), 'usd', true)

  expect(layer.ok && layer.next).toEqual({ 'money.symbol': 'usd' })
})

test('splitWord', () => {
  expect(splitWord('')).toEqual(['', ''])
  expect(splitWord('key')).toEqual(['key', ''])
  expect(splitWord('  key value with  spaces ')).toEqual(['key', 'value with  spaces'])
  expect(splitWord('a\tb')).toEqual(['a', 'b'])
})

// ------------------------------------------------------------------ layers

test('scope text helpers', () => {
  expect(isScopeText('/Users/me/proj')).toBe(true)
  expect(isScopeText('')).toBe(false)
  expect(isScopeText('a\nb')).toBe(false)
  expect(isScopeText('x'.repeat(301))).toBe(false)
  expect(isScopeText(5)).toBe(false)
  expect(isBranchText('main')).toBe(true)
  expect(isBranchText('feature/x-1.2_a')).toBe(true)
  expect(isBranchText('HEAD')).toBe(false)
  expect(isBranchText('a b')).toBe(false)
  expect(isBranchText('')).toBe(false)
  expect(isBranchText('a;rm')).toBe(false)
  expect(branchKey('/p', 'main')).toBe('/p#main')
})

test('sanitizeLayers keeps valid layers, strips sync.mode, keeps default-valued entries, and is bounded', () => {
  expect(sanitizeLayers(undefined)).toEqual(NONE)
  expect(sanitizeLayers('x')).toEqual(NONE)
  expect(sanitizeLayers({ projects: [], branches: 5 })).toEqual(NONE)
  const clean = sanitizeLayers({ projects: { '/p': { 'money.symbol': 'usd', 'sync.mode': 'per-project', nope: 1, lang: 'de' } }, branches: { '/p#main': {}, '/p#dev': { 'toast.ms': 3000 } } })

  expect(clean.projects).toEqual({ '/p': { 'money.symbol': 'usd', lang: 'de' } })
  expect(clean.branches).toEqual({ '/p#dev': { 'toast.ms': 3000 } })
  const projects: Record<string, unknown> = {}

  for (let i = 0; i < 100; i++) {
    projects[`/p${i}`] = { lang: 'de' }
  }
  expect(Object.keys(sanitizeLayers({ projects }).projects).length).toBe(LAYER_CAP)
  expect(GLOBAL_ONLY).toEqual(['sync.mode'])
  expect(sanitizeLayers({ projects: { 'a\nb': { lang: 'de' } } }).projects).toEqual({})
})

test('withLayer sets, removes when empty and drops the oldest past the cap', () => {
  const a = withLayer(NONE, 'project', '/p', { lang: 'de' })

  expect(a.projects).toEqual({ '/p': { lang: 'de' } })
  expect(layerOver(a, 'project', '/p')).toEqual({ lang: 'de' })
  expect(layerOver(a, 'project', '/q')).toEqual({})
  expect(layerOver(a, 'branch', '/p#main')).toEqual({})
  expect(withLayer(a, 'project', '/p', {}).projects).toEqual({})
  expect(NONE.projects).toEqual({})
  let l: Layers = NONE

  for (let i = 0; i < LAYER_CAP + 5; i++) {
    l = withLayer(l, 'branch', `/p#b${i}`, { lang: 'es' })
  }
  expect(Object.keys(l.branches).length).toBe(LAYER_CAP)
  expect(l.branches['/p#b0']).toBeUndefined()
  expect(l.branches[`/p#b${LAYER_CAP + 4}`]).toEqual({ lang: 'es' })
  // touching an old scope moves it to the newest end
  const touched = withLayer(l, 'branch', `/p#b${5}`, { lang: 'de' })

  expect(Object.keys(touched.branches).pop()).toBe('/p#b5')
})

test('effectiveOver: synced ignores layers, per-project stacks project then branch', () => {
  const layers: Layers = { projects: { '/p': { 'money.symbol': 'gbp', 'toast.ms': 2000 } }, branches: { '/p#main': { 'toast.ms': 9000 } } }
  const base: Over = { 'money.symbol': 'eur', lang: 'de' }

  expect(effectiveOver(base, layers, '/p', 'main', FLAGS)).toEqual(base)
  const per: Over = { ...base, 'sync.mode': 'per-project' }

  expect(effectiveOver(per, layers, '/p', 'main', FLAGS)).toEqual({ 'money.symbol': 'gbp', lang: 'de', 'sync.mode': 'per-project', 'toast.ms': 9000 })
  expect(effectiveOver(per, layers, '/p', 'dev', FLAGS)['toast.ms']).toBe(2000)
  expect(effectiveOver(per, layers, '/q', 'main', FLAGS)).toEqual(per)
  expect(effectiveOver(per, layers, '/p', 'main', { project: false, branch: true })['money.symbol']).toBe('eur')
  expect(effectiveOver(per, layers, '/p', 'main', { project: true, branch: false })['toast.ms']).toBe(2000)
  expect(effectiveOver(per, layers, '', 'main', FLAGS)).toEqual(per)
  expect(effectiveOver(per, layers, '/p', '', FLAGS)['toast.ms']).toBe(2000)
})

test('effectiveOver: a layer value equal to the default overrides a changed global value', () => {
  const per: Over = { 'sync.mode': 'per-project', 'money.symbol': 'eur' }
  const layers: Layers = { projects: { '/p': { 'money.symbol': 'usd' } }, branches: {} }
  const eff = effectiveOver(per, layers, '/p', '', FLAGS)

  expect(eff['money.symbol']).toBeUndefined()
  expect(eff['sync.mode']).toBe('per-project')
  // a layer cannot switch the scope off
  expect(effectiveOver(per, { projects: { '/p': { 'sync.mode': 'synced' } }, branches: {} } as Layers, '/p', '', FLAGS)['sync.mode']).toBe('per-project')
})

test('sourceOf names the layer that decides a key', () => {
  const per: Over = { 'sync.mode': 'per-project', lang: 'de' }
  const layers: Layers = { projects: { '/p': { 'toast.ms': 2000, lang: 'es' } }, branches: { '/p#main': { 'toast.ms': 9000 } } }

  expect(sourceOf('toast.ms', per, layers, '/p', 'main', FLAGS)).toBe('branch')
  expect(sourceOf('toast.ms', per, layers, '/p', 'dev', FLAGS)).toBe('project')
  expect(sourceOf('lang', per, layers, '/p', 'dev', FLAGS)).toBe('project')
  expect(sourceOf('lang', per, layers, '/q', 'dev', FLAGS)).toBe('base')
  expect(sourceOf('tip.delay', per, layers, '/p', 'main', FLAGS)).toBe('default')
  expect(sourceOf('toast.ms', { lang: 'de' }, layers, '/p', 'main', FLAGS)).toBe('default')
  expect(sourceOf('toast.ms', per, layers, '/p', 'main', { project: false, branch: false })).toBe('default')
})

// ------------------------------------------------------------------ history and undo

const entry = (at: number, over: Partial<HistEntry> = {}): HistEntry =>
  makeEntry(at, over.label ?? 'set lang', over.layer ?? 'base', over.scope ?? 'base', over.changes ?? [{ key: 'lang', before: null, after: 'de' }])

test('pushHistory keeps the newest 30', () => {
  let h: HistEntry[] = []

  for (let i = 0; i < HISTORY_MAX + 7; i++) {
    h = pushHistory(h, entry(i))
  }
  expect(h.length).toBe(HISTORY_MAX)
  expect(h[0]!.at).toBe(7)
  expect(h[h.length - 1]!.at).toBe(HISTORY_MAX + 6)
})

test('makeEntry truncates long text and long change lists', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ key: `quiet.m${i}`, before: null, after: 'off' }))
  const e = makeEntry(1, 'x'.repeat(200), 'base', 's'.repeat(900), many)

  expect(e.label.length).toBe(80)
  expect(e.scope.length).toBe(400)
  expect(e.changes.length).toBe(MAX_CHANGES_PER_ENTRY)
})

test('sanitizeHistory keeps only well-formed entries', () => {
  const good = entry(5)

  expect(sanitizeHistory(undefined)).toEqual([])
  expect(sanitizeHistory({})).toEqual([])
  expect(sanitizeHistory([good])).toEqual([good])
  const bad = [
    { ...good, at: 'x' },
    { ...good, layer: 'weird' },
    { ...good, label: 5 },
    { ...good, scope: null },
    { ...good, changes: [] },
    { ...good, changes: [{ key: 'nope', before: null, after: 1 }] },
    { ...good, changes: [{ key: 'lang', before: null, after: 'fr' }] },
    { ...good, changes: [{ key: 'lang', before: undefined, after: 'de' }] },
    null,
    5,
    'x',
  ]

  expect(sanitizeHistory(bad)).toEqual([])
  const mixed = sanitizeHistory([...bad, good])

  expect(mixed).toEqual([good])
  const huge = Array.from({ length: 80 }, (_, i) => entry(i))

  expect(sanitizeHistory(huge).length).toBe(HISTORY_MAX)
})

test('undoEntries reverses the newest entries, newest first', () => {
  const h = [
    entry(1, { label: 'set lang', changes: [{ key: 'lang', before: null, after: 'de' }] }),
    entry(2, { label: 'set lang', changes: [{ key: 'lang', before: 'de', after: 'es' }] }),
    entry(3, { label: 'set toast.ms', changes: [{ key: 'toast.ms', before: null, after: 3000 }] }),
  ]
  const base: Over = { lang: 'es', 'toast.ms': 3000 }
  const one = undoEntries(base, NONE, h, 1)

  expect(one.base).toEqual({ lang: 'es' })
  expect(one.history.length).toBe(2)
  expect(one.undone.map(e => e.at)).toEqual([3])
  const two = undoEntries(base, NONE, h, 2)

  expect(two.base).toEqual({ lang: 'de' })
  const all = undoEntries(base, NONE, h, 3)

  expect(all.base).toEqual({})
  expect(all.history).toEqual([])
  expect(undoEntries(base, NONE, h, 99).history).toEqual([])
  expect(undoEntries(base, NONE, h, 0).base).toEqual(base)
  expect(undoEntries(base, NONE, [], 1).undone).toEqual([])
  expect(base).toEqual({ lang: 'es', 'toast.ms': 3000 })
})

test('undoEntries restores a project layer and removes an emptied one', () => {
  const layers = withLayer(NONE, 'project', '/p', { 'toast.ms': 2000, lang: 'de' })
  const h = [entry(1, { label: 'set toast.ms', layer: 'project', scope: '/p', changes: [{ key: 'toast.ms', before: 1500, after: 2000 }] })]
  const out = undoEntries({}, layers, h, 1)

  expect(out.layers.projects['/p']).toEqual({ 'toast.ms': 1500, lang: 'de' })
  const h2 = [entry(1, { layer: 'project', scope: '/p', changes: [{ key: 'lang', before: null, after: 'de' }] })]
  const out2 = undoEntries({}, withLayer(NONE, 'project', '/p', { lang: 'de' }), h2, 1)

  expect(out2.layers.projects).toEqual({})
})

// ------------------------------------------------------------------ export and import

test('exportText is the format plus only the global overrides, sorted', () => {
  expect(JSON.parse(exportText({}))).toEqual({ format: EXPORT_FORMAT, prefs: {} })
  const t = exportText({ 'toast.ms': 3000, lang: 'de', bogus: 1, 'money.symbol': 'usd' })

  expect(JSON.parse(t)).toEqual({ format: 'prefs-1', prefs: { lang: 'de', 'toast.ms': 3000 } })
  expect(t.indexOf('"lang"')).toBeLessThan(t.indexOf('"toast.ms"'))
})

test('parseImport round-trips an export, with or without a code fence', () => {
  const over: Over = { lang: 'es', 'toast.ms': 3000, 'money.cents': false, 'quiet.alerts': '22:00-07:00' }
  const text = exportText(over)

  expect(parseImport(text)).toEqual({ ok: true, over })
  expect(parseImport('```json\n' + text + '\n```')).toEqual({ ok: true, over })
  expect(parseImport('```\n' + text + '\n```')).toEqual({ ok: true, over })
  expect(parseImport(`  ${text}  `)).toEqual({ ok: true, over })
  expect(parseImport(JSON.stringify({ format: 'prefs-1', prefs: { lang: 'en' } }))).toEqual({ ok: true, over: {} })
})

const errorsOf = (text: string): string[] => {
  const r = parseImport(text)

  return r.ok ? [] : r.errors
}

test('parseImport rejects what is not exactly the format', () => {
  expect(errorsOf('')[0]).toContain('Nothing to import')
  expect(errorsOf('   ')[0]).toContain('Nothing to import')
  expect(errorsOf('{nope')[0]).toBe('Not valid JSON.')
  expect(errorsOf('[1,2]')[0]).toContain('Expected a JSON object')
  expect(errorsOf('5')[0]).toContain('Expected a JSON object')
  expect(errorsOf('null')[0]).toContain('Expected a JSON object')
  expect(errorsOf('{"format":"prefs-1"}').some(e => e.includes('"prefs" must be an object'))).toBe(true)
  expect(errorsOf('{"prefs":{}}').some(e => e.includes('"format" must be'))).toBe(true)
  expect(errorsOf('{"format":"prefs-2","prefs":{}}').some(e => e.includes('"format" must be'))).toBe(true)
  expect(errorsOf('{"format":"prefs-1","prefs":{},"extra":1}').some(e => e.includes('Unknown field "extra"'))).toBe(true)
  expect(errorsOf('{"format":"prefs-1","prefs":[]}').some(e => e.includes('"prefs" must be an object'))).toBe(true)
})

test('parseImport rejects unknown keys, wrong types and out-of-range values, with a reason each', () => {
  const e = errorsOf(JSON.stringify({ format: 'prefs-1', prefs: { nope: 1, 'toast.ms': '3000', 'tip.delay': 99999, lang: 'fr', 'money.cents': 'false', 'quiet.Bad': 'off' } }))

  expect(e.some(x => x.includes('Unknown preference "nope"'))).toBe(true)
  expect(e.some(x => x.includes('toast.ms must be a number'))).toBe(true)
  expect(e.some(x => x.includes('out of range'))).toBe(true)
  expect(e.some(x => x.includes('lang must be one of'))).toBe(true)
  expect(e.some(x => x.includes('money.cents must be true or false'))).toBe(true)
  expect(e.some(x => x.includes('Unknown preference "quiet.Bad"'))).toBe(true)
  // nothing is partly accepted
  expect(parseImport(JSON.stringify({ format: 'prefs-1', prefs: { lang: 'de', nope: 1 } })).ok).toBe(false)
})

test('parseImport: prototype keys, cross rules and size limits', () => {
  expect(parseImport('{"format":"prefs-1","prefs":{"__proto__":{"lang":"de"}}}').ok).toBe(false)
  expect(parseImport('{"format":"prefs-1","prefs":{"constructor":1}}').ok).toBe(false)
  expect(({} as Record<string, unknown>)['lang']).toBeUndefined()
  expect(errorsOf('{"format":"prefs-1","prefs":{"num.decimal":"comma"}}').some(x => x.includes('cannot both be'))).toBe(true)
  expect(parseImport('{"format":"prefs-1","prefs":{"num.decimal":"comma","num.group":"dot"}}').ok).toBe(true)
  const big = JSON.stringify({ format: 'prefs-1', prefs: { lang: 'de' }, pad: 'x'.repeat(MAX_IMPORT_CHARS) })

  expect(errorsOf(big)[0]).toContain('Too long')
  const many: Record<string, unknown> = {}

  for (let i = 0; i < MAX_OVERRIDES + 20; i++) {
    many[`quiet.m${i}`] = '22:00-07:00'
  }
  expect(errorsOf(JSON.stringify({ format: 'prefs-1', prefs: many })).some(x => x.includes('Too many'))).toBe(true)
})

test('parseImport reports at most eight errors and says how many more', () => {
  const prefs: Record<string, unknown> = {}

  for (let i = 0; i < 20; i++) {
    prefs[`bad${i}`] = 1
  }
  const e = errorsOf(JSON.stringify({ format: 'prefs-1', prefs }))

  expect(e.length).toBe(9)
  expect(e[8]).toContain('and 12 more')
})

test('diffText lists changes and counts the rest', () => {
  const changes = Array.from({ length: 20 }, (_, i) => ({ key: `quiet.m${i}`, before: null, after: '22:00-07:00' }))
  const lines = diffText(changes)

  expect(lines.length).toBe(15)
  expect(lines[0]).toBe('  quiet.m0: default (off) -> 22:00-07:00')
  expect(lines[14]).toBe('  ...and 6 more')
  expect(diffText(changes.slice(0, 2)).length).toBe(2)
})

// ------------------------------------------------------------------ profiles

test('the built-in profiles are valid, hold no default values and no locale keys', () => {
  expect(Object.keys(BUILTIN_PROFILES)).toEqual(['work', 'home', 'demo'])

  for (const [name, bundle] of Object.entries(BUILTIN_PROFILES)) {
    expect(sanitizeOverrides(bundle)).toEqual(bundle)
    expect(crossCheck(bundle)).toEqual([])
    expect(Object.keys(bundle).length).toBeGreaterThan(4)
    expect(Object.keys(bundle).some(k => LOCALE_KEYS.includes(k))).toBe(false)
    expect(isBuiltinProfile(name)).toBe(true)
  }

  for (const k of LOCALE_KEYS) {
    expect(specFor(k) !== undefined).toBe(true)
  }
})

test('splitLocale, applyProfile and matchesProfile keep your locale settings', () => {
  const base: Over = { lang: 'de', 'money.symbol': 'eur', 'toast.ms': 2000, 'chart.grid': false }
  const s = splitLocale(base)

  expect(s.locale).toEqual({ lang: 'de', 'money.symbol': 'eur' })
  expect(s.style).toEqual({ 'toast.ms': 2000, 'chart.grid': false })
  const next = applyProfile(base, BUILTIN_PROFILES['work']!)

  expect(next.lang).toBe('de')
  expect(next['money.symbol']).toBe('eur')
  expect(next['chart.grid']).toBeUndefined()
  expect(next['toast.ms']).toBe(3000)
  expect(matchesProfile(next, BUILTIN_PROFILES['work']!)).toBe(true)
  expect(matchesProfile({ ...next, 'tip.delay': 100 }, BUILTIN_PROFILES['work']!)).toBe(false)
  expect(matchesProfile({ ...next, lang: 'es' }, BUILTIN_PROFILES['work']!)).toBe(true)
  expect(applyProfile({}, {})).toEqual({})
})

test('sanitizeProfiles: names, built-in clashes, locale keys and the limit', () => {
  expect(sanitizeProfiles(undefined)).toEqual({})
  expect(sanitizeProfiles([])).toEqual({})
  const raw: Record<string, unknown> = { review: { 'toast.ms': 3000, lang: 'de' }, 'Bad Name': { 'toast.ms': 3000 }, work: { 'toast.ms': 1000 }, '-x': {}, ok2: 5 }
  const clean = sanitizeProfiles(raw)

  expect(clean).toEqual({ review: { 'toast.ms': 3000 }, ok2: {} })
  const many: Record<string, unknown> = {}

  for (let i = 0; i < 40; i++) {
    many[`p${i}`] = { 'toast.ms': 3000 }
  }
  expect(Object.keys(sanitizeProfiles(many)).length).toBe(12)
  expect(sanitizeProfiles(JSON.parse('{"__proto__":{"toast.ms":3000}}'))).toEqual({})
})

test('profileNames and findProfile', () => {
  const user = { review: { 'toast.ms': 3000 } }

  expect(profileNames(user)).toEqual(['work', 'home', 'demo', 'review'])
  expect(findProfile('work', user)).toBe(BUILTIN_PROFILES['work'])
  expect(findProfile('review', user)).toEqual({ 'toast.ms': 3000 })
  expect(findProfile('nope', user)).toBeUndefined()
  expect(findProfile('constructor', user)).toBeUndefined()
  expect(findProfile('toString', user)).toBeUndefined()
  expect(isBuiltinProfile('constructor')).toBe(false)
})

// ------------------------------------------------------------------ the schedule

test('parseHM and hmText', () => {
  expect(parseHM('09:00')).toBe(540)
  expect(parseHM('9:00')).toBe(540)
  expect(parseHM('00:00')).toBe(0)
  expect(parseHM('23:59')).toBe(1439)
  expect(parseHM(' 18:30 ')).toBe(1110)

  for (const bad of ['24:00', '12:60', '12', '1230', 'ab:cd', '', '12:5', '-1:00', '12:00:00']) {
    expect(parseHM(bad)).toBeNull()
  }
  expect(hmText(540)).toBe('09:00')
  expect(hmText(1439)).toBe('23:59')
  expect(hmText(0)).toBe('00:00')
})

test('sanitizeSchedule sorts, drops bad entries and duplicates, and keeps six', () => {
  expect(sanitizeSchedule(undefined)).toEqual([])
  expect(sanitizeSchedule([{ at: '18:30', profile: 'home' }, { at: '9:00', profile: 'work' }, { at: '09:00', profile: 'demo' }, { at: 'x', profile: 'work' }, { at: '10:00', profile: 'Bad' }, 5, null])).toEqual([
    { at: '09:00', profile: 'demo' },
    { at: '18:30', profile: 'home' },
  ])
  const many = Array.from({ length: 12 }, (_, i) => ({ at: `${String(i).padStart(2, '0')}:00`, profile: 'work' }))

  expect(sanitizeSchedule(many).length).toBe(6)
})

test('slotFor picks the latest started slot and wraps to yesterday', () => {
  const s = [{ at: '09:00', profile: 'work' }, { at: '18:30', profile: 'home' }]

  expect(slotFor(s, 9 * 60)?.profile).toBe('work')
  expect(slotFor(s, 12 * 60)?.profile).toBe('work')
  expect(slotFor(s, 18 * 60 + 29)?.profile).toBe('work')
  expect(slotFor(s, 18 * 60 + 30)?.profile).toBe('home')
  expect(slotFor(s, 23 * 60 + 59)?.profile).toBe('home')
  expect(slotFor(s, 3 * 60)?.profile).toBe('home')
  expect(slotFor([], 600)).toBeUndefined()
  expect(slotId(s[0]!)).toBe('09:00|work')
})

test('withSlot replaces a time, withoutSlot removes it', () => {
  const s = withSlot([], '9:00', 'work')

  expect(s).toEqual([{ at: '09:00', profile: 'work' }])
  expect(withSlot(s, '09:00', 'home')).toEqual([{ at: '09:00', profile: 'home' }])
  expect(withSlot(s, '18:00', 'home').map(x => x.at)).toEqual(['09:00', '18:00'])
  expect(withSlot(s, 'bad', 'home')).toEqual(s)
  expect(withoutSlot(s, '9:00')).toEqual([])
  expect(withoutSlot(s, '10:00')).toEqual(s)
  expect(sanitizeAuto(undefined)).toEqual({ on: false, schedule: [], last: '' })
  expect(sanitizeAuto({ on: 'yes', schedule: [{ at: '09:00', profile: 'work' }], last: 'x'.repeat(100) })).toEqual({ on: false, schedule: [{ at: '09:00', profile: 'work' }], last: 'x'.repeat(60) })
  expect(sanitizeAuto({ on: true }).on).toBe(true)
})

test('sanitizeMeta accepts only a known tab and a valid profile name', () => {
  const tabs = ['general', 'formats']

  expect(sanitizeMeta({ applied: 'work', lastTab: 'formats' }, tabs)).toEqual({ applied: 'work', lastTab: 'formats' })
  expect(sanitizeMeta({ applied: 'Bad Name', lastTab: 'nope' }, tabs)).toEqual({ applied: '', lastTab: '' })
  expect(sanitizeMeta(undefined, tabs)).toEqual({ applied: '', lastTab: '' })
  expect(sanitizeMeta({ applied: 5, lastTab: 5 }, tabs)).toEqual({ applied: '', lastTab: '' })
})

// ------------------------------------------------------------------ paging and level

test('paginate clamps the page', () => {
  expect(paginate(0, 5, 0)).toEqual({ start: 0, end: 0, pages: 1, page: 0 })
  expect(paginate(12, 5, 0)).toEqual({ start: 0, end: 5, pages: 3, page: 0 })
  expect(paginate(12, 5, 2)).toEqual({ start: 10, end: 12, pages: 3, page: 2 })
  expect(paginate(12, 5, 99)).toEqual({ start: 10, end: 12, pages: 3, page: 2 })
  expect(paginate(12, 5, -4)).toEqual({ start: 0, end: 5, pages: 3, page: 0 })
  expect(paginate(10, 5, 1)).toEqual({ start: 5, end: 10, pages: 2, page: 1 })
  expect(paginate(3, 0, 0).pages).toBe(3)
})

test('levelPolicy', () => {
  expect(levelPolicy('simple')).toEqual({ description: false, key: false, range: false })
  expect(levelPolicy('standard')).toEqual({ description: true, key: false, range: false })
  expect(levelPolicy('everything')).toEqual({ description: true, key: true, range: true })
  expect(levelPolicy('bogus')).toEqual(levelPolicy('standard'))
  expect(levelPolicy(undefined)).toEqual(levelPolicy('standard'))
})

// ------------------------------------------------------------------ previews and text

const FIXED_ZONE: Over = { 'tz.mode': 'fixed', 'tz.offset': 60 }

test('previewLines: every group gives lines made from the current values', () => {
  for (const g of GROUPS) {
    const lines = previewLines(g, FIXED_ZONE, T)

    expect(lines.length).toBeGreaterThan(0)

    for (const l of lines) {
      expect(l.length).toBeGreaterThan(5)
      expect(l.includes('NaN') || l.includes('undefined') || l.includes('[object')).toBe(false)
    }
  }
})

test('previewLines follow the preferences', () => {
  const f = previewLines('formats', { ...FIXED_ZONE, 'money.symbol': 'eur', 'num.decimal': 'comma', 'num.group': 'dot', 'time.hours': '12h', 'date.format': 'dmy', 'size.units': 'KiB', 'path.style': 'short', 'trunc.len': 10 }, T).join('\n')

  expect(f).toContain('€1.234,50')
  expect(f).toContain('1.234.567,89')
  expect(f).toContain('4:07 PM')
  expect(f).toContain('25/11/2026')
  expect(f).toContain('Path: Button.tsx')
  expect(f).toContain('Text: The quick…')
  expect(f).toContain('1,5 MiB')
  const g = previewLines('general', { ...FIXED_ZONE, 'week.start': 'sun' }, T, 'de').join('\n')

  expect(g).toContain('2026-11-25 16:07 (UTC+01:00, fixed)')
  expect(g).toContain('Week: So Mo Di Mi Do Fr Sa')
  expect(previewLines('notices', { 'toast.ms': 3000, 'quiet.alerts': '22:00-07:00', 'notify.tips': true }, T).join('\n')).toContain('3000 ms')
  expect(previewLines('notices', { 'quiet.alerts': '22:00-07:00' }, T).join('\n')).toContain('Quiet hours set for: alerts')
  expect(previewLines('interface', { 'pane.width': 'wide' }, T).join('\n')).toContain('110 columns')
  expect(previewLines('charts', { 'chart.type.cost': 'bar', 'chart.legend': 'none' }, T).join('\n')).toContain('cost chart bar')
  expect(previewLines('data', { 'record.alerts': false }, T).join('\n')).toContain('recording off for: alerts')
  expect(PANE_COLUMNS).toEqual({ narrow: 60, medium: 80, wide: 110 })
})

test('rowPreview gives a sample for every format preference and nothing for the others', () => {
  const keys = ['money.symbol', 'money.cents', 'money.rate', 'time.hours', 'date.format', 'tz.mode', 'tz.offset', 'num.decimal', 'num.group', 'num.short', 'tiles.compact', 'size.units', 'trunc.len', 'path.style', 'week.start']

  for (const k of keys) {
    const p = rowPreview(k, FIXED_ZONE, T)

    expect(typeof p).toBe('string')
    expect((p ?? '').length).toBeGreaterThan(2)
  }
  expect(rowPreview('toast.ms', {}, T)).toBeUndefined()
  expect(rowPreview('lang', {}, T)).toBeUndefined()
  expect(rowPreview('money.cents', { 'money.cents': false }, T)).toBe('$1,235  -$7')
  expect(rowPreview('tz.offset', { 'tz.mode': 'fixed', 'tz.offset': -300 }, T)).toBe('UTC-05:00  2026-11-25 10:07')
  expect(rowPreview('tiles.compact', { 'tiles.compact': true }, T)).toBe('$12.3k')
  expect(rowPreview('tiles.compact', {}, T)).toBe('$12,345.67')
})

test('the commands: unique, prefixed and described in one short line each', () => {
  const names = COMMANDS.map(c => c[0])

  expect(new Set(names).size).toBe(names.length)
  expect(names[0]).toBe('pf')

  for (const [n, d] of COMMANDS) {
    expect(/^pf[a-z]*$/.test(n)).toBe(true)
    expect(d.length).toBeGreaterThan(20)
    expect(d.length).toBeLessThan(140)
  }
  expect(names.sort()).toEqual(['pf', 'pfauto', 'pfexport', 'pfget', 'pfimport', 'pfmods', 'pfprofile', 'pfproject', 'pfreset', 'pfset', 'pfundo'])
})

test('helpText lists every command and says the honest part', () => {
  const t = helpText()

  for (const [n] of COMMANDS) {
    expect(t).toContain(`/${n}:`)
  }
  expect(t).toContain('only changes what a mod READS it')
  expect(t).toContain('prefs.auto-profile')
  expect(t).toContain('prefs.branch-overrides')
})

test('describeSpec and searchLines', () => {
  const d = describeSpec(spec('toast.ms'), { 'toast.ms': 3000 })

  expect(d[0]).toBe('toast.ms: 3000 ms (default 4000 ms)')
  expect(d[2]).toContain('used by prefs itself')
  expect(describeSpec(spec('toast.pos'), {})[0]).toBe('toast.pos: top-right (default)')
  expect(describeSpec(spec('toast.pos'), {})[2]).toContain('stored for other mods')
  const s = searchLines('cents', { 'money.cents': false })

  expect(s[0]).toContain('for "cents"')
  expect(s.some(l => l.includes('money.cents = off'))).toBe(true)
  expect(searchLines('zzzzqq', {})[0]).toBe('0 matches for "zzzzqq":')
  expect(searchLines('a', {}, 3).length).toBe(4)
})
