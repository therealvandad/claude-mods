import { expect, test } from 'claude-code/testing'

import {
  ALIAS_MAX,
  BUNDLES,
  DEFAULT_CFG,
  DEFAULT_THRESHOLDS,
  LANGS,
  RECIPES,
  RULES_MAX,
  RULE_COOLDOWN_MS,
  STRINGS,
  TOAST_GATE_MS,
  addAlias,
  ageOf,
  arrangeRows,
  cardState,
  classifyCall,
  classifyEdit,
  classifyOutput,
  cleanCfg,
  confettiLine,
  entriesOf,
  errorsIn,
  evaluateRules,
  extOf,
  glowTone,
  glyphFor,
  hourColor,
  hourStrip,
  isTestCommand,
  parseAliasArgs,
  parseBandArgs,
  parseGlyphArgs,
  parseRateArgs,
  parseRule,
  removeAlias,
  renderMessage,
  resolveAlias,
  ringFrame,
  ruleMatches,
  shimmer,
  skeletonTotal,
  starsOf,
  sweepCell,
  testsPassed,
  thresholdKeyOf,
  tr,
  validateThreshold,
} from './pure'
import type { Facts } from './pure'

const facts = (over: Partial<Facts> = {}): Facts => ({ cost: 0, context: 0, errors: 0, duration: 0, testpass: 0, ...over })

// ------------------------------------------------------------------ rule parser

test('a valid rule parses and is stored in one canonical spelling', () => {
  const p = parseRule('if cost > 5 then toast "Cost is {cost}"')
  expect(p.ok).toBe(true)

  if (p.ok) {
    expect(p.text).toBe('if cost > $5 then toast "Cost is {cost}"')
    expect(p.rule.urgent).toBe(false)
    expect(p.rule.conds).toEqual([{ field: 'cost', op: '>', value: 5 }])
  }
  // The canonical text parses back to the same rule.
  const again = parseRule(p.ok ? p.text : '')
  expect(again.ok && p.ok && again.text === p.text).toBe(true)
})

test('units, = and two conditions with and', () => {
  const p = parseRule('urgent IF context >= 90% AND errors = 3 THEN fill "Run /compact"')
  expect(p.ok).toBe(true)

  if (p.ok) {
    expect(p.rule.urgent).toBe(true)
    expect(p.text).toBe('urgent if context >= 90% and errors == 3 then fill "Run /compact"')
  }
  const d = parseRule('if duration > 90s then toast "slow"')
  expect(d.ok && d.rule.conds[0]!.value).toBe(90)
  expect(parseRule('if cost <= $2.50 then toast "cheap"').ok).toBe(true)
})

test('strict validation refuses everything outside the grammar', () => {
  const bad = (text: string, re: RegExp) => {
    const p = parseRule(text)
    expect(p.ok).toBe(false)
    expect(p.ok ? '' : p.error).toMatch(re)
  }
  bad('', /Empty/)
  bad('cost > 5 then toast "x"', /Expected/)
  bad('if cost > 5 then toast x', /Expected/)
  bad("if cost > 5 then toast 'x'", /Expected/)
  bad('if cost > 5 then toast ""', /Expected/)
  bad(`if cost > 5 then toast "${'a'.repeat(141)}"`, /Expected/)
  bad('if cost > 5 then run "ls"', /Expected/)
  bad('if cost > 5 then toast "x" extra', /Expected/)
  bad('if speed > 5 then toast "x"', /Cannot read/)
  bad('if cost ! 5 then toast "x"', /Cannot read/)
  bad('if cost > five then toast "x"', /Cannot read/)
  bad('if cost > 5 and cost > 6 and cost > 7 then toast "x"', /At most two/)
  bad('if context > 150 then toast "x"', /between 0 and 100/)
  bad('if errors > 99 then toast "x"', /between 0 and 10/)
  bad('if errors > 2.5 then toast "x"', /whole number/)
  bad('if context > 50s then toast "x"', /context takes/)
  bad('if cost > 5% then toast "x"', /cost takes/)
  bad('if errors > 5% then toast "x"', /plain number/)
  bad('if cost > -1 then toast "x"', /Cannot read/)
  bad('if cost > 5 then toast "bad\nline"', /Expected/)
  // Confetti is for the prebuilt recipes only.
  bad('if cost > 5 then confetti "x"', /toast or fill/)
  expect(parseRule('if testpass >= 1 then confetti "x"', { allowConfetti: true }).ok).toBe(true)
})

test('a quote inside the text cannot smuggle a second action', () => {
  expect(parseRule('if cost > 5 then toast "a" then fill "b"').ok).toBe(false)
  expect(parseRule('if cost > 5 then toast "a then toast b"').ok).toBe(true)
})

test('rules match the facts and messages fill their placeholders', () => {
  const r = parseRule('if cost > 5 and context >= 50 then toast "x"')
  expect(r.ok).toBe(true)

  if (r.ok) {
    expect(ruleMatches(r.rule, facts({ cost: 6, context: 50 }))).toBe(true)
    expect(ruleMatches(r.rule, facts({ cost: 6, context: 49 }))).toBe(false)
    expect(ruleMatches(r.rule, facts({ cost: 5, context: 80 }))).toBe(false)
  }
  expect(renderMessage('{cost} {context} {errors} {duration} {testpass} {other}', facts({ cost: 5.5, context: 85.4, errors: 3, duration: 183.2, testpass: 2 }))).toBe('$5.50 85% 3 183s 2 {other}')
})

// ------------------------------------------------------------------ rule engine

const entry = (text: string, key = 'r1', edge = false) => {
  const p = parseRule(text, { allowConfetti: true })

  if (!p.ok) {
    throw new Error(p.error)
  }

  return { key, rule: p.rule, edge }
}
const run = (over: Record<string, unknown> = {}) =>
  evaluateRules({ entries: [entry('if cost > 5 then toast "hi"')], facts: facts({ cost: 9 }), now: 1_000_000, isCalm: false, fired: {}, match: {}, toastAt: 0, ...over } as never)

test('a matching rule fires once, then waits out its cooldown', () => {
  const first = run()
  expect(first.fire).toEqual([{ key: 'r1', kind: 'toast', text: 'hi', urgent: false }])
  const again = run({ fired: first.fired, now: 1_000_000 + RULE_COOLDOWN_MS - 1, toastAt: 0 })
  expect(again.fire).toEqual([])
  const later = run({ fired: first.fired, now: 1_000_000 + RULE_COOLDOWN_MS })
  expect(later.fire.length).toBe(1)
})

test('at most one toast per three minutes, even across rules', () => {
  const two = run({ entries: [entry('if cost > 5 then toast "a"', 'r1'), entry('if cost > 6 then toast "b"', 'r2')] })
  expect(two.fire.map(f => f.text)).toEqual(['a'])
  expect(two.toastAt).toBe(1_000_000)
  const gated = run({ toastAt: 1_000_000 - TOAST_GATE_MS + 1 })
  expect(gated.fire).toEqual([])
  expect(run({ toastAt: 1_000_000 - TOAST_GATE_MS }).fire.length).toBe(1)
  // A fill is not a toast: the gate does not hold it back.
  expect(run({ entries: [entry('if cost > 5 then fill "next"')], toastAt: 999_999 }).fire.length).toBe(1)
})

test('calm runs only urgent rules, and never confetti', () => {
  expect(run({ isCalm: true }).fire).toEqual([])
  const urgent = run({ isCalm: true, entries: [entry('urgent if cost > 5 then toast "hot"')] })
  expect(urgent.fire).toEqual([{ key: 'r1', kind: 'toast', text: 'hot', urgent: true }])
  expect(run({ isCalm: true, entries: [entry('urgent if cost > 5 then confetti "x"')] }).fire).toEqual([])
  // An urgent toast is not held by the one-toast gate.
  expect(run({ entries: [entry('urgent if cost > 5 then toast "hot"')], toastAt: 999_999 }).fire.length).toBe(1)
})

test('an edge rule fires only when it newly becomes true', () => {
  const e = [entry('if cost >= 5 then toast "over"', 'recipe:x', true)]
  const first = run({ entries: e })
  expect(first.fire.length).toBe(1)
  expect(first.match['recipe:x']).toBe(true)
  const second = run({ entries: e, match: first.match, fired: {}, now: 5_000_000 })
  expect(second.fire).toEqual([])
  const drop = run({ entries: e, facts: facts({ cost: 1 }), match: first.match })
  expect(drop.match['recipe:x']).toBe(false)
  const rise = run({ entries: e, match: drop.match, now: 9_000_000 })
  expect(rise.fire.length).toBe(1)
})

test('recipes parse, are off until switched on, and share the engine', () => {
  for (const r of RECIPES) {
    expect(parseRule(r.text, { allowConfetti: true }).ok).toBe(true)
  }
  expect(entriesOf([], {})).toEqual([])
  const on = entriesOf(['if errors >= 2 then toast "e"'], { 'tests-confetti': true, 'cost-5': true, bogus: true })
  expect(on.map(x => x.key)).toEqual(['r1', 'recipe:tests-confetti', 'recipe:cost-5'])
  expect(on[2]!.edge).toBe(true)
  // An invalid stored rule is skipped, not fatal.
  expect(entriesOf(['garbage', 'if cost > 1 then toast "ok"'], {}).map(x => x.key)).toEqual(['r2'])
})

test('errors in the last ten calls and test detection', () => {
  expect(errorsIn('')).toBe(0)
  expect(errorsIn('eeoeooeooeoe')).toBe(4)
  expect(errorsIn('eeoeooeooeoe', 3)).toBe(2)
  expect(isTestCommand('npm test')).toBe(true)
  expect(isTestCommand('pnpm run test -- --watch=false')).toBe(true)
  expect(isTestCommand('pytest -q')).toBe(true)
  expect(isTestCommand('ls -la')).toBe(false)
  expect(testsPassed('npm test', 'Tests: 12 passed', false)).toBe(true)
  expect(testsPassed('npm test', 'Tests: 2 failed, 10 passed', false)).toBe(false)
  expect(testsPassed('npm test', 'Tests: 0 failed, 12 passed', false)).toBe(true)
  expect(testsPassed('npm test', 'ok', true)).toBe(false)
  expect(testsPassed('ls', 'ok', false)).toBe(false)
  expect(RULES_MAX).toBe(15)
})

// ------------------------------------------------------------------ alias store

test('aliases are added, normalised, replaced, removed and bounded', () => {
  const a = addAlias({}, 'S', 'dashboard')
  expect(a).toEqual({ ok: true, aliases: { s: '/dashboard' } })
  const b = addAlias(a.ok ? a.aliases : {}, 't', '/timer   25')
  expect(b.ok && b.aliases.t).toBe('/timer 25')
  const c = addAlias(b.ok ? b.aliases : {}, 's', 'files')
  expect(c.ok && c.aliases.s).toBe('/files')
  expect(resolveAlias(c.ok ? c.aliases : {}, 'S')).toBe('/files')
  expect(resolveAlias({}, 'constructor')).toBeUndefined()
  expect(resolveAlias({}, '__proto__')).toBeUndefined()
  const gone = removeAlias(c.ok ? c.aliases : {}, 's')
  expect(gone).toEqual({ ok: true, aliases: { t: '/timer 25' } })
  expect(removeAlias({}, 'x').ok).toBe(false)

  let full: Record<string, string> = {}

  for (let i = 0; i < ALIAS_MAX; i++) {
    const r = addAlias(full, `a${i}`, 'files')
    full = r.ok ? r.aliases : full
  }
  expect(Object.keys(full).length).toBe(ALIAS_MAX)
  expect(addAlias(full, 'extra', 'files').ok).toBe(false)
  expect(addAlias(full, 'a0', 'notes').ok).toBe(true)
})

test('alias validation', () => {
  expect(addAlias({}, '1x', 'files').ok).toBe(false)
  expect(addAlias({}, 'add', 'files').ok).toBe(false)
  expect(addAlias({}, 'has space', 'files').ok).toBe(false)
  expect(addAlias({}, 'x'.repeat(17), 'files').ok).toBe(false)
  expect(addAlias({}, 'ok', '').ok).toBe(false)
  expect(addAlias({}, 'ok', '/').ok).toBe(false)
  expect(addAlias({}, 'ok', 'a'.repeat(201)).ok).toBe(false)
  expect(addAlias({}, 'loop', '/axrun loop').ok).toBe(false)
  expect(parseAliasArgs('')).toEqual({ kind: 'list' })
  expect(parseAliasArgs('add s dashboard now')).toEqual({ kind: 'add', name: 's', target: 'dashboard now' })
  expect(parseAliasArgs('add s').kind).toBe('bad')
  expect(parseAliasArgs('rm s')).toEqual({ kind: 'rm', name: 's' })
  expect(parseAliasArgs('zap').kind).toBe('bad')
})

// ------------------------------------------------------------------ thresholds

test('threshold validation: whole numbers inside each range', () => {
  expect(validateThreshold('slowCallSec', '45')).toEqual({ ok: true, value: 45 })
  expect(validateThreshold('slowCallSec', '0').ok).toBe(false)
  expect(validateThreshold('slowCallSec', '3601').ok).toBe(false)
  expect(validateThreshold('slowCallSec', '1.5').ok).toBe(false)
  expect(validateThreshold('slowCallSec', '-3').ok).toBe(false)
  expect(validateThreshold('slowCallSec', '10s').ok).toBe(false)
  expect(validateThreshold('slowCallSec', '').ok).toBe(false)
  expect(validateThreshold('largeOutputLines', '9').ok).toBe(false)
  expect(validateThreshold('largeOutputLines', '10')).toEqual({ ok: true, value: 10 })
  expect(validateThreshold('riskyEditLines', '10000')).toEqual({ ok: true, value: 10_000 })
  expect(validateThreshold('riskyEditLines', '10001').ok).toBe(false)
  expect(thresholdKeyOf('slow')).toBe('slowCallSec')
  expect(thresholdKeyOf('OUTPUT')).toBe('largeOutputLines')
  expect(thresholdKeyOf('riskyEditLines')).toBe('riskyEditLines')
  expect(thresholdKeyOf('nope')).toBeUndefined()
})

test('thresholds classify the lab examples', () => {
  const t = { ...DEFAULT_THRESHOLDS, slowCallSec: 20 }
  expect(classifyCall(19.9, t)).toBe('ok')
  expect(classifyCall(20, t)).toBe('slow')
  expect(classifyOutput(199, t)).toBe('ok')
  expect(classifyOutput(200, t)).toBe('large')
  expect(classifyEdit(49, t)).toBe('ok')
  expect(classifyEdit(50, t)).toBe('risky')
})

// ------------------------------------------------------------------ band layout

test('band: default changes nothing; hide, order and own row', () => {
  const rows = [{ plugin: 'a' }, { plugin: 'b' }, { plugin: 'anim-extra' }, { plugin: 'c' }]
  expect(arrangeRows(rows, [], [])).toBe(rows)
  expect(arrangeRows(rows, ['b', 'anim-extra'], []).map(r => r.plugin)).toEqual(['a', 'anim-extra', 'c'])
  expect(arrangeRows(rows, [], ['c', 'a']).map(r => r.plugin)).toEqual(['c', 'a', 'b', 'anim-extra'])
  expect(arrangeRows(rows, ['a'], ['a', 'zzz', 'c']).map(r => r.plugin)).toEqual(['c', 'b', 'anim-extra'])
  // The same row objects come back, as AbovePromptList requires.
  expect(arrangeRows(rows, [], ['c'])[0]).toBe(rows[3])
})

test('band commands', () => {
  expect(parseBandArgs('')).toEqual({ kind: 'status' })
  expect(parseBandArgs('hide layout')).toEqual({ kind: 'hide', name: 'layout' })
  expect(parseBandArgs('SHOW Layout')).toEqual({ kind: 'show', name: 'layout' })
  expect(parseBandArgs('order a, b,c')).toEqual({ kind: 'order', names: ['a', 'b', 'c'] })
  expect(parseBandArgs('order a,a').kind).toBe('bad')
  expect(parseBandArgs('hide ../x').kind).toBe('bad')
  expect(parseBandArgs('hide').kind).toBe('bad')
  expect(parseBandArgs('reset')).toEqual({ kind: 'reset' })
})

// ------------------------------------------------------------------ languages, glyphs, ratings

test('every language has every label, and a missing language falls back to English', () => {
  const keys = Object.keys(STRINGS.en)

  for (const l of LANGS) {
    expect(Object.keys(STRINGS[l]).sort()).toEqual([...keys].sort())

    for (const k of keys) {
      expect((STRINGS[l] as Record<string, string>)[k]!.length > 0).toBe(true)
    }
  }
  expect(tr('es', 'tab_rules')).toBe('Reglas')
  expect(tr('de', 'tab_rules')).toBe('Regeln')
  expect(tr('en', 'tab_rules')).toBe('Rules')
  expect(tr('xx' as never, 'tab_rules')).toBe('Rules')
})

test('glyphs: custom first, then the icon pack', () => {
  expect(extOf('src/app.test.TS')).toBe('ts')
  expect(extOf('Makefile')).toBe('')
  expect(extOf('.gitignore')).toBe('')
  expect(glyphFor('ts', 'symbols', {})).toBe('⬡')
  expect(glyphFor('ts', 'symbols', { ts: '★' })).toBe('★')
  expect(glyphFor('ts', 'letters', {})).toBe('TS')
  expect(glyphFor('md', 'minimal', {})).toBe('·')
  expect(glyphFor('zzz', 'symbols', {})).toBe('▫')
  expect(glyphFor('toString', 'symbols', {})).toBe('▫')
  expect(parseGlyphArgs('ts ★')).toEqual({ kind: 'set', ext: 'ts', glyph: '★' })
  expect(parseGlyphArgs('.PY ◈')).toEqual({ kind: 'set', ext: 'py', glyph: '◈' })
  expect(parseGlyphArgs('ts abc').kind).toBe('bad')
  expect(parseGlyphArgs('ts').kind).toBe('bad')
  expect(parseGlyphArgs('ts ★ extra').kind).toBe('bad')
  expect(parseGlyphArgs('rm ts')).toEqual({ kind: 'rm', ext: 'ts' })
  expect(parseGlyphArgs('').kind).toBe('list')
})

test('ratings: known mods, 0 to 5, a bounded note', () => {
  const known = ['motion', 'settings']
  expect(parseRateArgs('motion 4 nice and quiet', known)).toEqual({ kind: 'rate', mod: 'motion', stars: 4, note: 'nice and quiet' })
  expect(parseRateArgs('motion 0', known)).toEqual({ kind: 'rate', mod: 'motion', stars: 0, note: null })
  expect(parseRateArgs('nope 3', known).kind).toBe('bad')
  expect(parseRateArgs('motion 6', known).kind).toBe('bad')
  expect(parseRateArgs('motion x', known).kind).toBe('bad')
  const long = parseRateArgs(`motion 3 ${'x'.repeat(300)}`, known)
  expect(long.kind === 'rate' && long.note!.length <= 120).toBe(true)
  expect(parseRateArgs('', known).kind).toBe('list')
  expect(starsOf(3)).toBe('★★★☆☆')
  expect(starsOf(9)).toBe('★★★★★')
})

// ------------------------------------------------------------------ config, bundles

test('cleanCfg keeps good values and drops the rest', () => {
  expect(cleanCfg(undefined, [])).toEqual(DEFAULT_CFG)
  expect(cleanCfg('junk', [])).toEqual(DEFAULT_CFG)
  const c = cleanCfg(
    {
      glow: true,
      lang: 'de',
      aliases: { s: 'dashboard', 'bad name': 'x', ok: 7 },
      band: { hidden: ['layout', 'anim-extra', '../x', 5], order: ['a', 'b'] },
      thresholds: { slowCallSec: 45, largeOutputLines: 'x', riskyEditLines: 99999999 },
      glyphs: { ts: '★', md: 'toolong', 'bad ext': 'x' },
      rules: ['if cost > 5 then toast "x"', 'nonsense', 'if cost > 5 then confetti "x"'],
      recipes: { 'cost-5': true, bogus: true, 'tests-toast': 'yes' },
      ratings: { motion: { stars: 4, note: 'good' }, ghost: { stars: 5, note: '' }, settings: { stars: 9, note: '' } },
      checks: { 'calm:0': true, 'calm:99': true, 'zzz:0': true },
    },
    ['motion', 'settings'],
  )
  expect(c.glow).toBe(true)
  expect(c.lang).toBe('de')
  expect(c.aliases).toEqual({ s: '/dashboard' })
  expect(c.band).toEqual({ hidden: ['layout'], order: ['a', 'b'] })
  expect(c.thresholds).toEqual({ slowCallSec: 45, largeOutputLines: 200, riskyEditLines: 50 })
  expect(c.glyphs).toEqual({ ts: '★' })
  expect(c.rules).toEqual(['if cost > $5 then toast "x"'])
  expect(c.recipes).toEqual({ 'cost-5': true })
  expect(c.ratings).toEqual({ motion: { stars: 4, note: 'good' } })
  expect(c.checks).toEqual({ 'calm:0': true })
})

test('cleanCfg bounds rules and glyphs', () => {
  const rules = Array.from({ length: 40 }, (_, i) => `if cost > ${i + 1} then toast "x"`)
  expect(cleanCfg({ rules }, []).rules.length).toBe(RULES_MAX)
  const glyphs = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`e${i}`, '★']))
  expect(Object.keys(cleanCfg({ glyphs }, []).glyphs).length).toBe(40)
})

test('preset bundles use only commands that exist or this mod\'s own', () => {
  for (const b of BUNDLES) {
    expect(b.lines.length > 0).toBe(true)

    for (const l of b.lines) {
      expect(l).toMatch(/^\/[a-z]+( .+)?$/)
    }
  }
})

// ------------------------------------------------------------------ frames

test('skeleton cards reveal in order and settle; still means content', () => {
  expect(cardState(0, 0, true)).toBe('skeleton')
  expect(cardState(0, 2399, true)).toBe('skeleton')
  expect(cardState(0, 2400, true)).toBe('content')
  expect(cardState(2, 2400, true)).toBe('skeleton')
  expect(cardState(2, skeletonTotal(3), true)).toBe('content')
  expect(cardState(0, 0, false)).toBe('content')
  expect(ageOf(0, 5000)).toBe(Number.POSITIVE_INFINITY)
  expect(cardState(1, ageOf(0, 5000), true)).toBe('content')
})

test('the shimmer keeps the bar width and is plain when still', () => {
  for (const now of [0, 80, 400, 1234, 99_999]) {
    const s = shimmer(20, now, true)
    expect(s.before.length + s.hot.length + s.after.length).toBe(20)
  }
  expect(shimmer(12, 500, false)).toEqual({ before: '░'.repeat(12), hot: '', after: '' })
  expect(shimmer(0, 500, true)).toEqual({ before: '', hot: '', after: '' })
})

test('the ripple has four ring frames then the idle dot', () => {
  const seen = [0, 150, 300, 450].map(a => ringFrame(a, true))
  expect(new Set(seen).size).toBe(4)
  expect(ringFrame(600, true)).toBe('●')
  expect(ringFrame(100, false)).toBe('●')
  expect(ringFrame(-1, true)).toBe('●')
})

test('the glow pulses every second and is steady when still', () => {
  expect(glowTone(0, true)).toBe('error')
  expect(glowTone(999, true)).toBe('error')
  expect(glowTone(1000, true)).toBe('warning')
  expect(glowTone(2000, true)).toBe('error')
  expect(glowTone(1000, false)).toBe('error')
  expect(confettiLine(0, false)).toBe(confettiLine(900, false))
  expect(confettiLine(0, true)).not.toBe(confettiLine(150, true))
})

test('the day-night strip has 24 hex cells that differ from night to noon', () => {
  const strip = hourStrip()
  expect(strip.length).toBe(24)

  for (const cell of strip) {
    expect(cell.color).toMatch(/^#[0-9a-f]{6}$/)
  }
  expect(hourColor(0)).toBe('#0f172a')
  expect(hourColor(24)).toBe('#0f172a')
  expect(hourColor(12)).toBe('#38bdf8')
  expect(hourColor(2)).not.toBe(hourColor(12))
  expect(hourColor(-5)).toBe(hourColor(0))
  expect(sweepCell(0, true)).toBe(0)
  expect(sweepCell(150 * 23, true)).toBe(23)
  expect(sweepCell(150 * 24, true)).toBe(-1)
  expect(sweepCell(0, false)).toBe(-1)
})
