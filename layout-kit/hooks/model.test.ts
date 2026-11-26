import { expect, test } from 'claude-code/testing'

import type { Cfg, Page } from '../types'

import { zeroMetrics } from './formula'
import {
  BUILTIN,
  CAP,
  RECIPES,
  addButton,
  addPage,
  addTile,
  applyImport,
  bar,
  bindProject,
  budgetFor,
  buildMetrics,
  checkStatusTemplate,
  cleanText,
  deleteLayout,
  delMap,
  diffLayout,
  dropTileEverywhere,
  earnedNow,
  emptyCfg,
  emptyRec,
  evalRules,
  exportLayout,
  expandTemplate,
  fmtDur,
  fmtNum,
  fmtUsd,
  findPage,
  interpolate,
  loadLayout,
  makeDef,
  moveTile,
  parseBadge,
  parseGoal,
  parseImport,
  parseRule,
  parseSprite,
  putMap,
  recTodos,
  recTool,
  removePage,
  removeTile,
  renamePage,
  renderStatus,
  resizeTile,
  sanitizeCfg,
  saveLayout,
  setBudget,
  setThreshold,
  setToolStyle,
  splitArgs,
  tileView,
  toneOf,
  toolLabel,
  toolRows,
} from './model'

const cfg0 = (): Cfg => emptyCfg()
const ok = <T,>(r: { ok: boolean; value?: T; def?: T; error?: string }): T => {
  if (!r.ok) {
    throw new Error(r.error)
  }

  return (r.value ?? r.def) as T
}

// ---------------------------------------------------------------- layout editing

test('moving a tile swaps it with its neighbour and refuses the ends', () => {
  const pages = cfg0().pages
  const first = pages[0]?.tiles[0]?.id ?? ''
  const second = pages[0]?.tiles[1]?.id ?? ''
  const down = ok(moveTile(pages, 0, first, 1))
  expect(down[0]?.tiles[0]?.id).toBe(second)
  expect(down[0]?.tiles[1]?.id).toBe(first)
  expect(moveTile(pages, 0, first, -1).ok).toBe(false)
  const last = pages[0]?.tiles[pages[0].tiles.length - 1]?.id ?? ''
  expect(moveTile(pages, 0, last, 1).ok).toBe(false)
  expect(moveTile(pages, 0, 'nope', 1).ok).toBe(false)
  expect(moveTile(pages, 3, first, 1).ok).toBe(false)
  // the input was not mutated
  expect(pages[0]?.tiles[0]?.id).toBe(first)
})

test('resizing keeps the order, and only S, M, L exist', () => {
  const pages = cfg0().pages
  const r = ok(resizeTile(pages, 0, 'calls', 'L'))
  expect(r[0]?.tiles.find(t => t.id === 'calls')?.size).toBe('L')
  expect(r[0]?.tiles.map(t => t.id)).toEqual(pages[0]?.tiles.map(t => t.id))
  expect(resizeTile(pages, 0, 'files-nope', 'S').ok).toBe(false)
})

test('adding and removing tiles: known ids only, no repeats, 24 at most', () => {
  const c = cfg0()
  const p = ok(removeTile(c.pages, 0, 'calls'))
  expect(p[0]?.tiles.some(t => t.id === 'calls')).toBe(false)
  const back = ok(addTile(p, 0, 'calls', c.defs, 'L'))
  expect(back[0]?.tiles.at(-1)).toEqual({ id: 'calls', size: 'L' })
  expect(addTile(back, 0, 'calls', c.defs).ok).toBe(false)
  expect(addTile(back, 0, 'not-a-tile', c.defs).ok).toBe(false)
  expect(addTile(back, 0, 'c:ghost', c.defs).ok).toBe(false)
  expect(addTile(back, 0, '__proto__', c.defs).ok).toBe(false)
  const def = ok(makeDef('text', 'note', 'Note', 'hello'))
  expect(addTile(back, 0, 'c:note', [def]).ok).toBe(true)
  // the default size of a built-in comes from the catalogue
  const prompts = ok(addTile([{ name: 'X', tiles: [] }], 0, 'tools', []))
  expect(prompts[0]?.tiles[0]?.size).toBe('L')
  // the cap
  let full: Page[] = [{ name: 'Full', tiles: [] }]
  const ids = BUILTIN.map(b => b.id)
  const many = Array.from({ length: 10 }, (_, i) => ok(makeDef('text', `t${i}`, `T${i}`, 'x')))

  for (const id of [...ids, ...many.map(d => `c:${d.id}`)].slice(0, CAP.tiles)) {
    full = ok(addTile(full, 0, id, many))
  }
  expect(full[0]?.tiles.length).toBe(CAP.tiles)
  expect(addTile(full, 0, 'c:t9', many).ok).toBe(false) // page is full
})

test('pages: up to 6, unique names, valid names, at least one stays', () => {
  let pages: Page[] = cfg0().pages

  for (let i = 2; i <= 6; i++) {
    pages = ok(addPage(pages, `P${i}`))
  }
  expect(pages.length).toBe(6)
  expect(addPage(pages, 'P7').ok).toBe(false)
  expect(addPage(pages.slice(0, 2), 'p2').ok).toBe(false) // case-insensitive duplicate
  for (const bad of ['', ' x', 'x ', 'a'.repeat(17), 'a<b', 'a\nb', '__proto__x', '-start', 'é']) {
    expect(addPage(pages.slice(0, 1), bad).ok).toBe(false)
  }
  expect(removePage(pages.slice(0, 1), 0).ok).toBe(false)
  expect(ok(removePage(pages, 1)).length).toBe(5)
  expect(ok(renamePage(pages, 0, 'Home'))[0]?.name).toBe('Home')
  expect(renamePage(pages, 0, 'P2').ok).toBe(false)
  expect(renamePage(pages, 9, 'Home').ok).toBe(false)
  expect(findPage(pages, '2')).toBe(1)
  expect(findPage(pages, 'p3')).toBe(2)
  expect(findPage(pages, '9')).toBe(-1)
  expect(findPage(pages, 'zzz')).toBe(-1)
})

test('saved layouts: save, load, delete, cap, and the per-project binding', () => {
  let c = cfg0()
  c = ok(saveLayout(c, 'work'))
  c = { ...c, pages: ok(removeTile(c.pages, 0, 'calls')) }
  expect(ok(loadLayout(c, 'work')).pages[0]?.tiles.some(t => t.id === 'calls')).toBe(true)
  expect(loadLayout(c, 'nope').ok).toBe(false)
  expect(saveLayout(c, 'Bad Name').ok).toBe(false)
  expect(saveLayout(c, '__proto__').ok).toBe(false)
  c = ok(bindProject(c, '/proj/a', 'work'))
  expect(c.byProject['/proj/a']).toBe('work')
  expect(bindProject(c, '/proj/a', 'ghost').ok).toBe(false)
  expect(bindProject(c, '', 'work').ok).toBe(false)
  expect(ok(bindProject(c, '/proj/a', undefined)).byProject['/proj/a']).toBeUndefined()
  // deleting a layout also unbinds projects that used it
  expect(ok(deleteLayout(c, 'work')).byProject['/proj/a']).toBeUndefined()
  expect(deleteLayout(c, 'ghost').ok).toBe(false)
  // a saved layout is a copy
  const saved = c.saved.work
  expect(saved).not.toBe(c.pages)
  for (let i = 0; i < CAP.saved - 1; i++) {
    c = ok(saveLayout(c, `l${i}`))
  }
  expect(saveLayout(c, 'one-more').ok).toBe(false)
  expect(saveLayout(c, 'l1').ok).toBe(true) // overwriting is allowed at the cap
})

test('budgets are keyed by folder and validated', () => {
  let c = cfg0()
  c = ok(setBudget(c, '/a', 5))
  expect(budgetFor(c, '/a')).toBe(5)
  expect(budgetFor(c, '/b')).toBe(0)
  expect(setBudget(c, '/a', 0).ok).toBe(false)
  expect(setBudget(c, '/a', -1).ok).toBe(false)
  expect(setBudget(c, '/a', Number.NaN).ok).toBe(false)
  expect(setBudget(c, '/a', 1e9).ok).toBe(false)
  expect(setBudget(c, '', 5).ok).toBe(false)
  expect(budgetFor(ok(setBudget(c, '/a', undefined)), '/a')).toBe(0)
  expect(budgetFor(ok(setBudget(c, '/a', 2.345)), '/a')).toBe(2.35)
})

// ---------------------------------------------------------------- custom tiles

test('custom tiles: text, number and formula are validated', () => {
  expect(makeDef('text', 'a', 'Label', 'hi').ok).toBe(true)
  expect(makeDef('number', 'n', 'Bugs', '12', 'left').ok).toBe(true)
  expect(makeDef('formula', 'r', 'Rate', 'errors / calls * 100').ok).toBe(true)
  expect(ok(makeDef('formula', 'r', 'Rate', ' ERRORS / Calls ')).expr).toBe('errors / calls')
  for (const [k, id, l, v] of [
    ['text', 'A', 'x', 'y'], // uppercase id
    ['text', '', 'x', 'y'],
    ['text', 'a'.repeat(17), 'x', 'y'],
    ['text', '__proto__', 'x', 'y'],
    ['text', 'a', '', 'y'],
    ['text', 'a', 'x'.repeat(21), 'y'],
    ['text', 'a', 'x', ''],
    ['text', 'a', 'x', 'y'.repeat(61)],
    ['text', 'a', 'x', 'bad\nline'],
    ['number', 'a', 'x', 'abc'],
    ['number', 'a', 'x', ''],
    ['number', 'a', 'x', '1e99'],
    ['number', 'a', 'x', 'Infinity'],
    ['formula', 'a', 'x', 'eval(1)'],
    ['formula', 'a', 'x', 'calls > 1'],
    ['formula', 'a', 'x', 'foo + 1'],
    ['image', 'a', 'x', 'y'],
  ] as const) {
    expect(makeDef(k, id, l, v).ok).toBe(false)
  }
  expect(makeDef('number', 'a', 'x', '1', 'u'.repeat(9)).ok).toBe(false)
})

test('tile views: built-ins, custom tiles, colours and removed custom tiles', () => {
  const c = cfg0()
  const rec = { ...emptyRec(1000), calls: 10, errors: 4, edits: 2, bash: 3, files: ['/a', '/b'] }
  const m = buildMetrics(rec, { usd: 1.5, ctx: 90, limit: 30, now: 1000 + 125 * 60_000 }, 0)
  const ctx = { m, cfg: c, rec, icons: 'symbols' as const, earned: [], now: 0 }
  expect(tileView('calls', ctx).big).toBe('10')
  expect(tileView('errors', ctx).tone).toBe('warning') // 4 >= 3
  expect(tileView('ctx', ctx).tone).toBe('error') // 90 >= 85
  expect(tileView('limit', ctx).tone).toBe('success')
  expect(tileView('files', ctx).big).toBe('2')
  expect(tileView('elapsed', ctx).big).toBe('2h 05m')
  expect(tileView('spend', ctx).big).toBe('$1.50')
  expect(tileView('budget', ctx).big).toBe('none')
  const withBudget = { ...ctx, m: { ...m, budget: 1.8 } }
  expect(tileView('spend', withBudget).tone).toBe('warning') // 1.5 / 1.8 = 83%
  expect(tileView('budget', withBudget).pct).toBe(83)
  expect(tileView('spend', { ...withBudget, m: { ...m, budget: 1 } }).tone).toBe('error')
  for (const b of BUILTIN) {
    const v = tileView(b.id, ctx)
    expect(v.title.length).toBeGreaterThan(0)
  }
  const d = ok(makeDef('formula', 'rate', 'Rate', 'errors / calls * 100'))
  const withDef = { ...ctx, cfg: { ...c, defs: [d] } }
  expect(tileView('c:rate', withDef).big).toBe('40')
  expect(tileView('c:gone', ctx).big).toBe('?')
  expect(tileView('whatever', ctx).sub).toBe('unknown tile')
  const n = ok(makeDef('number', 'n', 'Bugs', '3', 'open'))
  expect(tileView('c:n', { ...ctx, cfg: { ...c, defs: [n] } }).big).toBe('3 open')
})

test('the tools tile uses your colour, glyph and friendly name', () => {
  let c = cfg0()
  let rec = emptyRec(0)
  rec = recTool(rec, 'Bash', false)
  rec = recTool(rec, 'Bash', true)
  rec = recTool(rec, 'Read', false)
  expect(toolRows(rec, c, 'symbols', 5)[0]).toMatchObject({ tool: 'Bash', n: 2, err: 1, glyph: '$', color: 'warning' })
  c = ok(setToolStyle(c, 'color', 'Bash', 'error'))
  c = ok(setToolStyle(c, 'glyph', 'Bash', '>>'))
  c = ok(setToolStyle(c, 'name', 'Bash', 'Shell'))
  expect(toolRows(rec, c, 'symbols', 5)[0]).toMatchObject({ label: 'Shell', glyph: '>>', color: 'error' })
  expect(toolRows(rec, c, 'minimal', 5)[1]?.glyph).toBe('')
  expect(toolRows(rec, c, 'letters', 5)[1]?.glyph).toBe('R')
  expect(toolLabel(c, 'mcp__srv__do')).toBe('srv:do')
  c = ok(setToolStyle(c, 'color', 'Bash', undefined))
  expect(toolRows(rec, c, 'symbols', 5)[0]?.color).toBe('warning')
  for (const bad of [['color', 'Bash', 'red'], ['color', 'Bash', 'ff0000'], ['glyph', 'Bash', 'abc'], ['glyph', 'Bash', ''], ['name', 'Bash', 'x'.repeat(21)], ['color', 'bad name', 'error'], ['color', 'a/b', 'error'], ['name', 'Bash', 'a\nb']] as const) {
    expect(setToolStyle(c, bad[0], bad[1], bad[2]).ok).toBe(false)
  }
  expect(setToolStyle(c, 'color', '__proto__', 'error').ok).toBe(false)
  expect(setToolStyle(c, 'color', 'constructor', 'error').ok).toBe(false)
})

// ---------------------------------------------------------------- recording

test('recording is bounded and sorts out edits, files, bash and todos', () => {
  let r = emptyRec(0)
  r = recTool(r, 'Edit', false, '/a.ts')
  r = recTool(r, 'Edit', false, '/a.ts')
  r = recTool(r, 'Write', false, '/b.ts')
  r = recTool(r, 'Edit', true, '/c.ts') // failed edit: not a file
  r = recTool(r, 'Bash', false)
  expect(r).toMatchObject({ calls: 5, errors: 1, edits: 3, bash: 1 })
  expect(r.files).toEqual(['/a.ts', '/b.ts'])
  r = recTool(r, 'Read', false, '/ignored.ts')
  expect(r.files.length).toBe(2)
  for (let i = 0; i < 60; i++) {
    r = recTool(r, `Tool${i}`, false)
  }
  expect(Object.keys(r.byTool).length).toBeLessThanOrEqual(CAP.toolNames)
  expect(r.byTool.other?.n).toBeGreaterThan(0)
  let f = emptyRec(0)

  for (let i = 0; i < CAP.files + 20; i++) {
    f = recTool(f, 'Write', false, `/f${i}`)
  }
  expect(f.files.length).toBe(CAP.files)
  expect(f.edits).toBe(CAP.files + 20)
  // hostile tool and path text
  let h = recTool(emptyRec(0), '__proto__', false, 'a\nb')
  h = recTool(h, 'x'.repeat(200), false)
  expect(Object.keys(h.byTool).every(k => k.length <= 60)).toBe(true)
  expect(({} as Record<string, unknown>).n).toBeUndefined()
  expect(h.files).toEqual([])
  const t = recTodos(emptyRec(0), [{ status: 'completed' }, { status: 'pending' }, { status: 'in_progress' }, { status: 'weird' }, 'x', null])
  expect(t).toMatchObject({ todoOpen: 2, todoDone: 1 })
  expect(recTodos(t, 'nope')).toBe(t)
})

test('metrics are built from the counters and live usage', () => {
  const r = { ...emptyRec(60_000), calls: 5, prompts: 2, turns: 1, todoOpen: 1, todoDone: 3 }
  const m = buildMetrics(r, { usd: 2.123456, ctx: 140, limit: -5, now: 60_000 + 90 * 60_000 }, 7)
  expect(m).toMatchObject({ calls: 5, prompts: 2, turns: 1, spend: 2.1235, ctx: 100, limit: 0, mins: 90, budget: 7, todo_all: 4 })
  expect(buildMetrics(emptyRec(0), { usd: 0, ctx: 0, limit: 0, now: 5000 }, 0).mins).toBe(0)
})

// ---------------------------------------------------------------- text commands

test('text snippets, aliases, templates and variables are validated and capped', () => {
  let c = cfg0()
  c = ok(putMap(c, 'snippets', 'hi', 'Hello\nworld'))
  expect(c.snippets.hi).toBe('Hello\nworld')
  expect(putMap(c, 'snippets', 'add', 'x').ok).toBe(false) // reserved word
  expect(putMap(c, 'snippets', 'Bad', 'x').ok).toBe(false)
  expect(putMap(c, 'snippets', '__proto__', 'x').ok).toBe(false)
  expect(putMap(c, 'snippets', 'ok', '').ok).toBe(false)
  expect(putMap(c, 'snippets', 'ok', 'x'.repeat(CAP.snippetLen + 1)).ok).toBe(false)
  expect(putMap(c, 'snippets', 'ok', 'a\u0000b').ok).toBe(false)
  expect(putMap(c, 'aliases', 'ok', 'two\nlines').ok).toBe(false) // aliases are one line
  expect(putMap(c, 'vars', 'Name', 'x').ok).toBe(false)
  expect(putMap(c, 'vars', 'name', 'x').ok).toBe(true)
  expect(putMap(c, 'templates', 't', 'fix {1} in {file}').ok).toBe(true)
  expect(putMap(c, 'templates', 't', 'bad {Weird Thing}').ok).toBe(false)
  expect(ok(delMap(c, 'snippets', 'hi')).snippets.hi).toBeUndefined()
  expect(delMap(c, 'snippets', 'zzz').ok).toBe(false)
  let n = cfg0()

  for (let i = 0; i < CAP.snippets; i++) {
    n = ok(putMap(n, 'snippets', `s${i}`, 'x'))
  }
  expect(putMap(n, 'snippets', 'extra', 'x').ok).toBe(false)
  expect(putMap(n, 'snippets', 's1', 'changed').ok).toBe(true)
})

test('template expansion: positional, all, named variables and what is missing', () => {
  const vars = { file: 'a.ts' }
  expect(expandTemplate('fix {1} in {file}', ['bug'], vars)).toEqual({ text: 'fix bug in a.ts', missing: [] })
  expect(expandTemplate('{2} then {1}', ['a'], {})).toEqual({ text: ' then a', missing: ['{2}'] })
  expect(expandTemplate('all: {*}', ['a', 'b'], {})).toEqual({ text: 'all: a b', missing: [] })
  expect(expandTemplate('hi {who}', [], {})).toEqual({ text: 'hi {who}', missing: ['{who}'] })
  expect(expandTemplate('{who} {who}', [], {}).missing).toEqual(['{who}'])
  expect(expandTemplate('not a {placeholder with spaces} and {}', [], {}).text).toBe('not a {placeholder with spaces} and {}')
  expect(expandTemplate('{__proto__}', [], {}).missing.length).toBe(0) // not a valid name, left alone
  expect(expandTemplate('{constructor}', [], {}).text).toBe('{constructor}')
  expect(expandTemplate('{0}', ['x'], {}).text).toBe('{0}')
  // values containing placeholders are not expanded again
  expect(expandTemplate('{1}', ['{2}', 'z'], {}).text).toBe('{2}')
  expect(splitArgs('a "b c" d')).toEqual(['a', 'b c', 'd'])
  expect(splitArgs('1 2 3 4 5 6 7 8 9 10 11').length).toBe(9)
  expect(splitArgs('x'.repeat(300))[0]?.length).toBe(200)
})

test('buttons: up to 5, unique labels, bounded text', () => {
  let c = cfg0()

  for (let i = 0; i < CAP.buttons; i++) {
    c = ok(addButton(c, `b${i}`, 'text'))
  }
  expect(addButton(c, 'six', 'text').ok).toBe(false)
  expect(addButton(cfg0(), 'x'.repeat(17), 'text').ok).toBe(false)
  expect(addButton(cfg0(), '', 'text').ok).toBe(false)
  expect(addButton(cfg0(), 'a', '').ok).toBe(false)
  expect(addButton(ok(addButton(cfg0(), 'a', 'x')), 'A', 'y').ok).toBe(false)
})

test('status templates accept only metric placeholders and render them', () => {
  expect(checkStatusTemplate('{calls} calls {errors} err {spend} {ctx}').ok).toBe(true)
  for (const bad of ['', 'x'.repeat(81), '{nope}', '{calls', 'calls}', '{ calls }', 'a\nb', '{calls}{__proto__}']) {
    expect(checkStatusTemplate(bad).ok).toBe(false)
  }
  const m = { ...zeroMetrics(), calls: 12, errors: 1, spend: 0.5, ctx: 41.6, mins: 75 }
  expect(renderStatus('{calls}c {errors}e {spend} {ctx} {mins}', m)).toBe('12c 1e $0.50 42% 1h 15m')
  expect(interpolate('{unknown} {calls}', m)).toBe('{unknown} 12')
  expect(renderStatus('x'.repeat(80), m).length).toBe(80)
})

test('the sprite is 1 to 5 lines of at most 12 characters', () => {
  expect(ok(parseSprite('/\\_/\\|( o.o )|> ^ <')).length).toBe(3)
  expect(parseSprite('a|b|c|d|e|f').ok).toBe(false)
  expect(parseSprite('x'.repeat(13)).ok).toBe(false)
  expect(parseSprite('a\u0007b').ok).toBe(false)
  expect(parseSprite('  | ').ok).toBe(false)
  expect(parseSprite('').ok).toBe(false)
  expect(ok(parseSprite('😀😀😀😀😀😀😀😀😀😀😀😀'))[0]?.length).toBeGreaterThan(0) // 12 code points
  expect(parseSprite('😀'.repeat(13)).ok).toBe(false)
})

// ---------------------------------------------------------------- badges, goals, rules

test('badges, goals and rules are parsed with the safe parser', () => {
  expect(ok(parseBadge('"100 calls" when calls >= 100'))).toEqual({ name: '100 calls', cond: 'calls >= 100' })
  expect(parseBadge('100 calls when calls >= 100').ok).toBe(false)
  expect(parseBadge('"x" when foo > 1').ok).toBe(false)
  expect(parseBadge('"x" when eval(1)').ok).toBe(false)
  expect(parseBadge('"" when calls > 1').ok).toBe(false)
  expect(parseBadge(`"${'x'.repeat(25)}" when calls > 1`).ok).toBe(false)
  expect(parseBadge(`"x" when ${'('.repeat(30)}1`).ok).toBe(false)
  expect(ok(parseGoal('"ship" files target 10'))).toEqual({ name: 'ship', expr: 'files', target: 10 })
  expect(parseGoal('"ship" files target 0').ok).toBe(false)
  expect(parseGoal('"ship" files target -3').ok).toBe(false)
  expect(parseGoal('"ship" files target abc').ok).toBe(false)
  expect(parseGoal('"ship" files > 1 target 10').ok).toBe(false) // goals are formulas, not conditions
  expect(parseGoal('"ship" files target 1e12').ok).toBe(false)
  const r = ok(parseRule('if errors > 5 then toast "{errors} errors"'))
  expect(r).toEqual({ cond: 'errors > 5', msg: '{errors} errors', isOn: true })
  expect(ok(parseRule('rule if errors > 5 then toast "x"')).cond).toBe('errors > 5')
  for (const bad of ['errors > 5', 'if errors > 5 then say "x"', 'if errors > 5 then toast x', 'if errors > 5 then toast ""', `if errors > 5 then toast "${'x'.repeat(81)}"`, 'if foo > 1 then toast "x"', 'if errors > 5 then toast "{nope}"', 'if errors > then toast "x"', 'if errors > 5 then toast "a\nb"']) {
    expect(parseRule(bad).ok).toBe(false)
  }
  const m = { ...zeroMetrics(), calls: 120 }
  expect(earnedNow([{ name: 'a', cond: 'calls >= 100' }, { name: 'b', cond: 'calls >= 200' }], m)).toEqual(['a'])
})

test('rules fire once when they turn true and re-arm when they turn false', () => {
  const rules = [{ cond: 'errors > 5', msg: '{errors} errors', isOn: true }, { cond: 'calls > 0', msg: 'off', isOn: false }]
  const hi = { ...zeroMetrics(), errors: 6, calls: 1 }
  const lo = { ...zeroMetrics(), errors: 0, calls: 1 }
  const use = { rules: true, recipes: false }
  const a = evalRules(rules, {}, hi, {}, use)
  expect(a.fired).toEqual([{ key: 'u:errors > 5', msg: '6 errors' }])
  const b = evalRules(rules, {}, hi, a.armed, use)
  expect(b.fired).toEqual([])
  const c = evalRules(rules, {}, lo, b.armed, use)
  expect(c.fired).toEqual([])
  expect(evalRules(rules, {}, hi, c.armed, use).fired.length).toBe(1)
  expect(evalRules(rules, {}, hi, {}, { rules: false, recipes: false }).fired).toEqual([])
  expect(Object.keys(evalRules(rules, {}, hi, { stale: true }, use).armed)).toEqual(['u:errors > 5'])
})

test('six recipes exist, parse with the safe parser, and only run when toggled on', () => {
  expect(RECIPES.length).toBe(6)

  for (const r of RECIPES) {
    expect(parseRule(`if ${r.cond} then toast "${r.msg}"`).ok).toBe(true)
  }
  const m = { ...zeroMetrics(), errors: 9, ctx: 90, spend: 6, budget: 5, mins: 130, files: 25 }
  const all = Object.fromEntries(RECIPES.map(r => [r.id, true]))
  expect(evalRules([], all, m, {}, { rules: false, recipes: true }).fired.length).toBe(6)
  expect(evalRules([], { errors: true }, m, {}, { rules: false, recipes: true }).fired.length).toBe(1)
  expect(evalRules([], all, m, {}, { rules: false, recipes: false }).fired.length).toBe(0)
  expect(evalRules([], all, zeroMetrics(), {}, { rules: false, recipes: true }).fired.length).toBe(0)
})

test('thresholds and tones', () => {
  expect(toneOf(1, [3, 10])).toBe('success')
  expect(toneOf(3, [3, 10])).toBe('warning')
  expect(toneOf(10, [3, 10])).toBe('error')
  expect(ok(setThreshold(cfg0(), 'ctx', 50, 90)).thr.ctx).toEqual([50, 90])
  expect(setThreshold(cfg0(), 'ctx', 90, 50).ok).toBe(false)
  expect(setThreshold(cfg0(), 'ctx', 50, 101).ok).toBe(false)
  expect(setThreshold(cfg0(), 'nope', 1, 2).ok).toBe(false)
  expect(setThreshold(cfg0(), 'errors', -1, 2).ok).toBe(false)
  expect(setThreshold(cfg0(), 'errors', Number.NaN, 2).ok).toBe(false)
  expect(setThreshold(cfg0(), 'errors', 1, 1e9).ok).toBe(false)
  expect(setThreshold(cfg0(), '__proto__', 1, 2).ok).toBe(false)
})

// ---------------------------------------------------------------- loading from the store

test('a damaged store never gives a broken config', () => {
  for (const raw of [undefined, null, 5, 'x', [], { pages: 'x' }, { pages: [null, 5, { name: 3 }] }, { defs: [{ id: '__proto__' }] }, { thr: { ctx: [99, 1] } }]) {
    const c = sanitizeCfg(raw)
    expect(c.pages.length).toBeGreaterThan(0)
    expect(c.thr.ctx).toEqual([70, 85])
  }
  const messy = sanitizeCfg({
    pages: [{ name: 'A', tiles: [{ id: 'calls', size: 'S' }, { id: 'calls', size: 'L' }, { id: 'nope', size: 'S' }, { id: 'c:gone', size: 'S' }, { id: 'tools', size: 'XL' }] }, { name: 'A', tiles: [] }],
    defs: [{ id: 'x', kind: 'formula', label: 'X', expr: 'calls + 1' }, { id: 'y', kind: 'formula', label: 'Y', expr: 'eval(1)' }, { id: 'x', kind: 'text', label: 'dup', text: 'q' }],
    snippets: { ok: 'fine', Bad: 'x', '__proto__': 'x', empty: '' },
    buttons: [{ label: 'a', text: 'b' }, { label: 5 }, null],
    statusTpl: '{nope}',
    rules: [{ cond: 'errors > 1', msg: 'ok' }, { cond: 'foo', msg: 'bad' }, { cond: 'errors > 1', msg: '{zzz}' }],
    badges: [{ name: 'x"y', cond: 'calls > 1' }, { name: 'ok', cond: 'calls > 1' }],
    toolColor: { Bash: 'warning', Read: 'red', '__proto__': 'error' },
    thr: { ctx: [10, 20], errors: ['a', 1] },
    budgets: { '/a': 5, '/b': -1 },
    byProject: { '/a': 'ghost' },
  })
  expect(messy.pages.length).toBe(1)
  expect(messy.pages[0]?.tiles).toEqual([{ id: 'calls', size: 'S' }, { id: 'tools', size: 'M' }])
  expect(messy.defs.map(d => d.id)).toEqual(['x'])
  expect(Object.keys(messy.snippets)).toEqual(['ok'])
  expect(messy.buttons.length).toBe(1)
  expect(messy.statusTpl).toBe('')
  expect(messy.rules.length).toBe(1)
  expect(messy.badges.map(b => b.name)).toEqual(['ok'])
  expect(messy.toolColor).toEqual({ Bash: 'warning' })
  expect(messy.thr.ctx).toEqual([10, 20])
  expect(messy.thr.errors).toEqual([3, 10])
  expect(messy.budgets).toEqual({ '/a': 5 })
  expect(messy.byProject).toEqual({})
  expect(({} as Record<string, unknown>).x).toBeUndefined()
})

// ---------------------------------------------------------------- export and import

const good = () => exportLayout(cfg0())

test('export then import round-trips, with a diff and no change until applied', () => {
  let c = cfg0()
  c = { ...c, defs: [ok(makeDef('formula', 'rate', 'Rate', 'errors / calls'))] }
  c = { ...c, pages: ok(addTile(c.pages, 0, 'c:rate', c.defs, 'M')) }
  c = { ...c, pages: ok(addPage(c.pages, 'Second')) }
  const text = exportLayout(c)
  expect(text.length).toBeLessThan(CAP.importText)
  const r = parseImport(text, cfg0())
  expect(r.ok).toBe(true)

  if (r.ok) {
    expect(r.pages).toEqual(c.pages)
    expect(r.defs.map(d => d.id)).toEqual(['rate'])
    expect(r.diff).toMatch(/\+ page Second/)
    expect(r.diff).toMatch(/~ page Main: add c:rate/)
    expect(r.diff).toMatch(/\+ custom tile c:rate/)
    const applied = applyImport(cfg0(), r.pages, r.defs)
    expect(applied.pages).toEqual(c.pages)
    expect(applied.defs.map(d => d.id)).toEqual(['rate'])
  }
  const same = parseImport(good(), cfg0())
  expect(same.ok && /= page Main unchanged/.test(same.diff)).toBe(true)
  // only used custom tiles are exported
  const unused = { ...cfg0(), defs: [ok(makeDef('text', 'spare', 'Spare', 'x'))] }
  expect(exportLayout(unused)).not.toMatch(/spare/)
})

const refused = (text: string, c: Cfg = cfg0()) => {
  const r = parseImport(text, c)

  return r.ok ? 'ACCEPTED' : r.error
}

test('import refuses anything that is not exactly the format', () => {
  const page = '{"name":"A","tiles":[{"id":"calls","size":"S"}]}'
  const wrap = (body: string) => `{"layout-kit":1,"pages":[${body}]}`
  expect(refused(wrap(page))).toBe('ACCEPTED')
  const bad: [string, string][] = [
    ['', 'Paste'],
    ['   ', 'Paste'],
    ['not json', 'not valid JSON'],
    ['{', 'not valid JSON'],
    ['[]', 'top level'],
    ['null', 'top level'],
    ['5', 'top level'],
    ['"x"', 'top level'],
    ['{}', 'layout-kit'],
    ['{"layout-kit":2,"pages":[]}', 'layout-kit'],
    ['{"layout-kit":"1","pages":[]}', 'layout-kit'],
    ['{"layout-kit":1}', 'pages'],
    ['{"layout-kit":1,"pages":[]}', 'pages'],
    ['{"layout-kit":1,"pages":"x"}', 'pages'],
    ['{"layout-kit":1,"pages":{}}', 'pages'],
    [`{"layout-kit":1,"pages":[${page}],"extra":1}`, 'unknown key'],
    [`{"layout-kit":1,"pages":[${page}],"__proto__":{}}`, 'unknown key'],
    [`{"layout-kit":1,"pages":[{"name":"A","tiles":[],"x":1}]}`, 'unknown key'],
    [wrap('5'), 'must be an object'],
    [wrap('null'), 'must be an object'],
    [wrap('[]'), 'must be an object'],
    [wrap('{"name":"A"}'), 'tiles'],
    [wrap('{"name":"A","tiles":"x"}'), 'tiles'],
    [wrap('{"tiles":[]}'), 'Page name'],
    [wrap('{"name":"","tiles":[]}'), 'Page name'],
    [wrap('{"name":"a<b","tiles":[]}'), 'Page name'],
    [wrap('{"name":"__proto__","tiles":[]}'), 'Page name'],
    [wrap('{"name":"x","tiles":[5]}'), 'must be an object'],
    [wrap('{"name":"x","tiles":[{"id":"calls"}]}'), 'size'],
    [wrap('{"name":"x","tiles":[{"id":"calls","size":"XL"}]}'), 'size'],
    [wrap('{"name":"x","tiles":[{"id":"calls","size":"s"}]}'), 'size'],
    [wrap('{"name":"x","tiles":[{"id":"calls","size":"S","extra":1}]}'), 'unknown key'],
    [wrap('{"name":"x","tiles":[{"size":"S"}]}'), 'not a known tile'],
    [wrap('{"name":"x","tiles":[{"id":5,"size":"S"}]}'), 'not a known tile'],
    [wrap('{"name":"x","tiles":[{"id":"nope","size":"S"}]}'), 'not a known tile'],
    [wrap('{"name":"x","tiles":[{"id":"__proto__","size":"S"}]}'), 'not a known tile'],
    [wrap('{"name":"x","tiles":[{"id":"c:ghost","size":"S"}]}'), 'no definition'],
    [wrap('{"name":"x","tiles":[{"id":"calls","size":"S"},{"id":"calls","size":"M"}]}'), 'twice'],
    [wrap(`${page},${page}`), 'twice'],
    [wrap('{"name":"A","tiles":[]},{"name":"a","tiles":[]}'), 'twice'],
    [`{"layout-kit":1,"pages":[${page}],"defs":"x"}`, 'defs'],
    [`{"layout-kit":1,"pages":[${page}],"defs":{}}`, 'defs'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[5]}`, 'kind'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"image","label":"x"}]}`, 'kind'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"text","label":"x"}]}`, 'not valid'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"text","label":"x","text":"y","expr":"1"}]}`, 'unknown key'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"formula","label":"x","expr":"eval(1)"}]}`, 'not valid'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"formula","label":"x","expr":"calls > 1"}]}`, 'not valid'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"formula","label":"x","expr":5}]}`, 'not valid'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"number","label":"x","num":"5"}]}`, 'numeric'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"number","label":"x","num":1e99}]}`, 'not valid'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"number","label":"x","num":1,"unit":5}]}`, 'unit'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"__proto__","kind":"text","label":"x","text":"y"}]}`, 'not valid'],
    [`{"layout-kit":1,"pages":[${page}],"defs":[{"id":"a","kind":"text","label":"x","text":"y"},{"id":"a","kind":"text","label":"x","text":"y"}]}`, 'twice'],
    ['x'.repeat(CAP.importText + 1), 'Too long'],
  ]

  for (const [text, why] of bad) {
    const e = refused(text)
    expect(`${text.slice(-90)} => ${e}`).not.toContain('=> ACCEPTED')
    expect(`${text.slice(-90)} => ${e}`).toContain(why)
  }
})

test('import enforces every cap', () => {
  const tiles = (n: number) => Array.from({ length: n }, (_, i) => `{"id":"c:t${i}","size":"S"}`).join(',')
  const defs = (n: number) => Array.from({ length: n }, (_, i) => `{"id":"t${i}","kind":"text","label":"T","text":"x"}`).join(',')
  const pages = (n: number) => Array.from({ length: n }, (_, i) => `{"name":"P${i}","tiles":[]}`).join(',')
  expect(refused(`{"layout-kit":1,"pages":[${pages(6)}]}`)).toBe('ACCEPTED')
  expect(refused(`{"layout-kit":1,"pages":[${pages(7)}]}`)).toContain('pages')
  expect(refused(`{"layout-kit":1,"pages":[{"name":"A","tiles":[${tiles(20)}]}],"defs":[${defs(20)}]}`)).toBe('ACCEPTED')
  expect(refused(`{"layout-kit":1,"pages":[{"name":"A","tiles":[${tiles(21)}]}],"defs":[${defs(21)}]}`)).toContain('defs')
  const builtins = BUILTIN.map(b => `{"id":"${b.id}","size":"S"}`).join(',')
  expect(refused(`{"layout-kit":1,"pages":[{"name":"A","tiles":[${builtins},${tiles(9)}]}],"defs":[${defs(9)}]}`)).toContain('tiles')
  // merged defs: 15 existing + 6 imported different ids is more than 20
  let c = cfg0()

  for (let i = 0; i < 15; i++) {
    c = { ...c, defs: [...c.defs, ok(makeDef('text', `old${i}`, 'Old', 'x'))] }
  }
  expect(refused(`{"layout-kit":1,"pages":[{"name":"A","tiles":[]}],"defs":[${defs(6)}]}`, c)).toContain('custom tiles')
  expect(refused(`{"layout-kit":1,"pages":[{"name":"A","tiles":[]}],"defs":[${defs(5)}]}`, c)).toBe('ACCEPTED')
})

test('import resolves custom tiles from the current config too, and never touches it', () => {
  const c = { ...cfg0(), defs: [ok(makeDef('text', 'mine', 'Mine', 'x'))] }
  const text = '{"layout-kit":1,"pages":[{"name":"A","tiles":[{"id":"c:mine","size":"M"}]}]}'
  expect(refused(text, c)).toBe('ACCEPTED')
  expect(refused(text)).toContain('no definition')
  const before = JSON.stringify(c)
  parseImport(text, c)
  expect(JSON.stringify(c)).toBe(before)
})

test('hostile import text does not throw and cannot pollute prototypes', () => {
  for (const t of ['{"__proto__":{"polluted":1}}', '{"layout-kit":1,"pages":[{"name":"A","tiles":[],"__proto__":{"polluted":1}}]}', '{"layout-kit":1,"pages":[{"name":"A","tiles":[{"id":"calls","size":"S","constructor":{}}]}]}', '[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[', '{"a":'.repeat(500), '\u0000', '{"layout-kit":1,"pages":[{"name":"A","tiles":[]}],"defs":[{"id":"a","kind":"formula","label":"x","expr":"((((((((((1))))))))))"}]}']) {
    expect(() => parseImport(t, cfg0())).not.toThrow()
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect(refused('{"layout-kit":1,"pages":[{"name":"A","tiles":[]}],"defs":[{"id":"a","kind":"formula","label":"x","expr":"((((((((((1))))))))))"}]}')).toContain('not valid')
})

test('the diff names added, removed, resized and reordered tiles', () => {
  const cur: Page[] = [{ name: 'Main', tiles: [{ id: 'calls', size: 'S' }, { id: 'errors', size: 'S' }, { id: 'files', size: 'S' }] }, { name: 'Gone', tiles: [] }]
  const next: Page[] = [{ name: 'Main', tiles: [{ id: 'files', size: 'S' }, { id: 'calls', size: 'L' }, { id: 'ctx', size: 'S' }] }, { name: 'New', tiles: [] }]
  const lines = diffLayout(cur, [], next, [])
  expect(lines[0]).toBe('Pages: 2 now, 2 after.')
  expect(lines.join('\n')).toMatch(/~ page Main: add ctx, remove errors, resize calls, reorder/)
  expect(lines.join('\n')).toMatch(/\+ page New/)
  expect(lines.join('\n')).toMatch(/- page Gone/)
})

// ---------------------------------------------------------------- small formatting helpers

test('number and text formatting', () => {
  expect(fmtNum(12)).toBe('12')
  expect(fmtNum(12.345)).toBe('12.35')
  expect(fmtNum(12_345)).toBe('12.3k')
  expect(fmtNum(2_500_000)).toBe('2.5M')
  expect(fmtNum(Number.NaN)).toBe('0')
  expect(fmtUsd(0)).toBe('$0.00')
  expect(fmtUsd(123.4)).toBe('$123')
  expect(fmtUsd(-4)).toBe('$0.00')
  expect(fmtDur(0)).toBe('0m')
  expect(fmtDur(61 * 60_000)).toBe('1h 01m')
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(bar(-5, 4)).toBe('░░░░')
  expect(bar(500, 4)).toBe('████')
  expect(cleanText('  hi  ', 5)).toBe('hi')
  expect(cleanText('a\u0000', 5)).toBeUndefined()
  expect(cleanText('abcdef', 5)).toBeUndefined()
  expect(cleanText(5, 5)).toBeUndefined()
  expect(dropTileEverywhere(cfg0().pages, 'calls')[0]?.tiles.some(t => t.id === 'calls')).toBe(false)
})
