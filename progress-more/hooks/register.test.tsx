import { expect, mock, test } from 'claude-code/testing'

import {
  COMMANDS,
  GREP_EXCLUDES,
  RULE_EVENTS,
  addPoint,
  addRev,
  addRule,
  bar,
  bashEvent,
  cardText,
  dayKey,
  docsStats,
  emptyData,
  emptySess,
  exportedFns,
  fmtClock,
  fmtMoney,
  fmtSize,
  grepArgv,
  isSourceFile,
  isTestFile,
  isoWeek,
  mergeDocs,
  moveTile,
  normalizeCfg,
  normalizeData,
  parseGoalAdd,
  parseGrepCounts,
  parseKeep,
  parseOutdated,
  parsePlanItems,
  parseRule,
  parseTileList,
  parseWeek,
  per100,
  pickRule,
  pruneData,
  defaultCfg,
  semverKind,
  spark,
  splitArgs,
  summarizeUpgrades,
  testBase,
  toastAllowed,
  todoDelta,
  touchDay,
  untestedFiles,
  validatePattern,
  weekDays,
  weeklyTrend,
} from './pure'

// 2026-11-25 10:00 local time, a Wednesday in ISO week 48 (Monday was 2026-11-23)
const NOW = new Date(2026, 10, 25, 10, 0, 0, 0).getTime()
const MONDAY = new Date(2026, 10, 23, 9, 0, 0, 0).getTime()
const DAY = 86_400_000

// ------------------------------------------------------------ pure: time and charts

test('dates: day key, ISO week, week parsing and week days', async () => {
  expect(dayKey(NOW)).toBe('2026-11-25')
  expect(isoWeek(NOW)).toBe('2026-W48')
  expect(isoWeek(new Date(2026, 11, 28).getTime())).toBe('2026-W53')
  expect(isoWeek(new Date(2027, 0, 1).getTime())).toBe('2026-W53')
  expect(parseWeek('2026-W50', NOW)).toBe('2026-W50')
  expect(parseWeek('2026-12-15', NOW)).toBe('2026-W51')
  expect(parseWeek('+4', NOW)).toBe('2026-W52')
  expect(parseWeek('2026-W99', NOW)).toBeUndefined()
  expect(parseWeek('2026-02-31', NOW)).toBeUndefined()
  expect(parseWeek('soon', NOW)).toBeUndefined()
  expect(weekDays('2026-W48')[0]).toBe('2026-11-23')
  expect(weekDays('2026-W48')[6]).toBe('2026-11-29')
})

test('charts are plain text and clamp', async () => {
  expect(spark([0, 5, 10])).toBe('▁▅█')
  expect(spark([null, 2], 4)).toBe('·▅')
  expect(spark([])).toBe('')
  expect(bar(0.5, 10)).toBe('█████░░░░░')
  expect(bar(7, 4)).toBe('████')
  expect(bar(Number.NaN, 4)).toBe('░░░░')
})

test('splitArgs keeps quoted words together', async () => {
  expect(splitArgs('old new')).toEqual(['old', 'new'])
  expect(splitArgs('"old thing" \'new thing\' x')).toEqual(['old thing', 'new thing', 'x'])
  expect(splitArgs('a "" b')).toEqual(['a', '', 'b'])
  expect(splitArgs('')).toEqual([])
})

// ------------------------------------------------------------ 123 quality trend

test('123 errors per hundred calls by week', async () => {
  let d = touchDay([], '2026-11-24', x => ({ ...x, calls: 100, errors: 5 }))
  d = touchDay(d, '2026-11-25', x => ({ ...x, calls: 50, errors: 1 }))
  d = touchDay(d, '2026-11-17', x => ({ ...x, calls: 40, errors: 4 }))
  const tr = weeklyTrend(d, NOW, 3)
  expect(tr.map(w => w.week)).toEqual(['2026-W46', '2026-W47', '2026-W48'])
  expect(tr.map(w => w.per100)).toEqual([null, 10, 4])
  expect(per100(1, 0)).toBeNull()
  expect(per100(1, 3)).toBe(33.3)
  // sorted and bounded
  expect(touchDay(d, '2026-11-01', x => x)[0]?.day).toBe('2026-11-01')
  let big = d

  for (let i = 0; i < 450; i++) {
    big = touchDay(big, dayKey(NOW + i * DAY), x => x)
  }
  expect(big.length).toBe(400)
})

// ------------------------------------------------------------ 124 review list

test('124 review list is bounded and validated', async () => {
  const a = addRev([], 'check errors', 1)
  expect(a.list).toHaveLength(1)
  expect(addRev([], '   ', 1).error).toMatch(/1-100/)
  expect(addRev([], 'x'.repeat(101), 1).error).toBeDefined()
  let list = a.list

  for (let i = 0; i < 45; i++) {
    list = addRev(list, `item ${i}`, i).list
  }
  expect(list).toHaveLength(40)
  expect(addRev(list, 'one more', 1).error).toMatch(/40/)
  expect(new Set(list.map(i => i.id)).size).toBe(40)
})

// ------------------------------------------------------------ 125/126 grep argument validator

test('125 the grep pattern validator accepts only short literal one-line text', async () => {
  expect(validatePattern('oldHelper(')).toEqual({ ok: true, pattern: 'oldHelper(' })
  expect(validatePattern('$.store.get')).toMatchObject({ ok: true })
  expect(validatePattern('a b c')).toMatchObject({ ok: true })
  expect(validatePattern('x')).toMatchObject({ ok: false })
  expect(validatePattern('')).toMatchObject({ ok: false })
  expect(validatePattern('x'.repeat(61))).toMatchObject({ ok: false })
  expect(validatePattern('x'.repeat(60))).toMatchObject({ ok: true })
  expect(validatePattern('-rf')).toMatchObject({ ok: false })
  expect(validatePattern('--include=*.js')).toMatchObject({ ok: false })
  expect(validatePattern('a\nb')).toMatchObject({ ok: false })
  expect(validatePattern('a\tb')).toMatchObject({ ok: false })
  expect(validatePattern('a\u0000b')).toMatchObject({ ok: false })
  expect(validatePattern(' lead')).toMatchObject({ ok: false })
  expect(validatePattern('trail ')).toMatchObject({ ok: false })
  expect(validatePattern('..')).toMatchObject({ ok: false })
  expect(validatePattern('**')).toMatchObject({ ok: false })
  expect(validatePattern(undefined)).toMatchObject({ ok: false })
  expect(validatePattern(42)).toMatchObject({ ok: false })
  expect(validatePattern({ toString: () => 'abc' })).toMatchObject({ ok: false })
})

test('125 the grep argv is fixed: -F, -I, -c, a -- before the pattern, never a shell', async () => {
  const argv = grepArgv('oldHelper(')
  expect(argv[0]).toBe('grep')
  expect(argv[1]).toBe('-rIF')
  expect(argv[2]).toBe('-c')
  expect(argv.slice(-3)).toEqual(['--', 'oldHelper(', '.'])
  expect(argv.filter(a => a.startsWith('--exclude-dir=')).length).toBe(GREP_EXCLUDES.length)
  // every element before the separator is one of this mod's own constants
  const before = argv.slice(0, argv.indexOf('--'))
  expect(before.every(a => a === 'grep' || a === '-rIF' || a === '-c' || a.startsWith('--exclude-dir='))).toBe(true)
  expect(() => grepArgv('-e')).toThrow(/refused grep pattern/)
  expect(() => grepArgv('a\nb')).toThrow()
  expect(grepArgv('$(rm -rf x)').slice(-2)[0]).toBe('$(rm -rf x)')
})

test('125 grep counts are parsed, zero-hit files dropped, junk lines skipped', async () => {
  const out = ['./src/a.ts:3', './src/b.ts:0', './src/c.ts:12', 'garbage', './x:y.txt:2', ':5', './d.ts:-1', './e.ts:1.5', ''].join('\n')
  const r = parseGrepCounts(out)
  expect(r.total).toBe(17)
  expect(r.fileCount).toBe(3)
  expect(r.files.map(f => f.path)).toEqual(['src/c.ts', 'src/a.ts', 'x:y.txt'])
  expect(parseGrepCounts('', 5)).toMatchObject({ total: 0, fileCount: 0 })
  const many = Array.from({ length: 300 }, (_, i) => `./f${i}:1`).join('\n')
  expect(parseGrepCounts(many, 50).files).toHaveLength(50)
  expect(parseGrepCounts(many, 50).fileCount).toBe(300)
  expect(parseGrepCounts(`./a:1\n${'x'.repeat(3000)}:9`).total).toBe(1)
})

test('125/126 history keeps one point per day and is bounded', async () => {
  let pts = addPoint([], { at: NOW, a: 10, b: 0, fa: 2, fb: 0 })
  pts = addPoint(pts, { at: NOW + 1000, a: 8, b: 0, fa: 2, fb: 0 })
  expect(pts).toHaveLength(1)
  expect(pts[0]?.a).toBe(8)

  for (let i = 0; i < 80; i++) {
    pts = addPoint(pts, { at: NOW + (i + 1) * DAY, a: i, b: 0, fa: 0, fb: 0 })
  }
  expect(pts).toHaveLength(60)
})

// ------------------------------------------------------------ 127 upgrades

test('127 npm and pip outdated output is parsed; semver kinds', async () => {
  expect(semverKind('1.2.3', '2.0.0')).toBe('major')
  expect(semverKind('1.2.3', '1.3.0')).toBe('minor')
  expect(semverKind('1.2.3', '1.2.9')).toBe('patch')
  expect(semverKind('', '1.2.9')).toBe('other')
  const npm = parseOutdated('npm', JSON.stringify({ left: { current: '1.0.0', wanted: '1.0.1', latest: '2.0.0' }, mid: { current: '1.0.0', wanted: '1.1.0', latest: '1.1.0' }, ws: [{ current: '3.0.0', latest: '3.0.2' }] }))
  expect(npm.ok && npm.items.map(i => i.name)).toEqual(['left', 'mid', 'ws'])
  const sum = summarizeUpgrades('npm', npm.ok ? npm.items : [], NOW)
  expect(sum).toMatchObject({ total: 3, major: 1, minor: 1, patch: 1 })
  expect(sum.top[0]).toMatch(/^major left/)
  expect(parseOutdated('npm', '').ok).toBe(true)
  expect(parseOutdated('npm', 'not json')).toMatchObject({ ok: false })
  expect(parseOutdated('npm', JSON.stringify({ error: { summary: 'offline' } }))).toMatchObject({ ok: false })
  const pip = parseOutdated('pip', JSON.stringify([{ name: 'requests', version: '2.0.0', latest_version: '2.31.0' }]))
  expect(pip.ok && pip.items[0]).toEqual({ name: 'requests', current: '2.0.0', latest: '2.31.0' })
  expect(parseOutdated('pip', '{}')).toMatchObject({ ok: false })
})

// ------------------------------------------------------------ 128/129/130

test('128 test debt: changed source files whose test file was not touched', async () => {
  expect(isTestFile('/p/src/a.test.ts')).toBe(true)
  expect(isTestFile('/p/tests/a.py')).toBe(true)
  expect(isTestFile('/p/pkg/store_test.go')).toBe(true)
  expect(isTestFile('/p/src/a.ts')).toBe(false)
  expect(isSourceFile('/p/src/a.ts')).toBe(true)
  expect(isSourceFile('/p/README.md')).toBe(false)
  expect(isSourceFile('/p/src/a.test.ts')).toBe(false)
  expect(isSourceFile('/p/vite.config.ts')).toBe(false)
  expect(testBase('/p/src/parser.test.ts')).toBe('parser')
  expect(testBase('/p/tests/test_user_service.py')).toBe('user_service')
  expect(testBase('/p/UserServiceTest.java')).toBe('userservice')
  expect(untestedFiles(['/p/a.ts', '/p/b.ts', '/p/c.py'], ['/p/a.test.ts', '/p/test_c.py'])).toEqual(['/p/b.ts'])
  expect(untestedFiles([], ['/p/a.test.ts'])).toEqual([])
})

test('129 docs coverage: exported functions with a comment above', async () => {
  const ts = ['/** Adds. */', 'export function add(a, b) {}', '', 'export const sub = (a, b) => a - b', '// halves', 'export async function half(x) {}', 'function hidden() {}'].join('\n')
  expect(exportedFns(ts, 'a.ts', true)).toEqual([
    { name: 'add', documented: true },
    { name: 'sub', documented: false },
    { name: 'half', documented: true },
  ])
  // a fragment's first line has an unknown neighbour
  expect(exportedFns('export function first() {}', 'a.ts', false)).toEqual([{ name: 'first', documented: null }])
  expect(exportedFns('export function first() {}', 'a.ts', true)).toEqual([{ name: 'first', documented: false }])
  const py = ['# helper', 'def a():', '    pass', '', '@deco', 'def b():', '    """Doc."""', '', 'def c():', '    pass', 'def _private():', '    pass'].join('\n')
  expect(exportedFns(py, 'a.py', true)).toEqual([
    { name: 'a', documented: true },
    { name: 'b', documented: true },
    { name: 'c', documented: false },
  ])
  expect(exportedFns('// Serve\nfunc Serve() {}\nfunc private() {}', 'a.go', true)).toEqual([{ name: 'Serve', documented: true }])
  expect(exportedFns('/// ok\npub fn go() {}', 'a.rs', true)).toEqual([{ name: 'go', documented: true }])
  expect(exportedFns('export function x() {}', 'a.md', true)).toEqual([])
  // merging: an unknown never overwrites, a rewrite replaces the file
  let docs = mergeDocs({}, '/p/a.ts', [{ name: 'add', documented: false }], true)
  docs = mergeDocs(docs, '/p/a.ts', [{ name: 'add', documented: true }, { name: 'zed', documented: null }], false)
  expect(docs['/p/a.ts']).toEqual({ add: 1 })
  expect(docsStats(docs)).toMatchObject({ exported: 1, documented: 1, frac: 1 })
  expect(docsStats(mergeDocs(docs, '/p/a.ts', [], true))).toMatchObject({ exported: 0 })
})

test('130 cleanup meter: TODOs added versus removed from the edit', async () => {
  expect(todoDelta('', '// TODO: a\n// FIXME b', true)).toEqual({ added: 2, removed: 0 })
  expect(todoDelta('// TODO: a\n// TODO: b', '// TODO: a', false)).toEqual({ added: 0, removed: 1 })
  expect(todoDelta('x', '// HACK y', false)).toEqual({ added: 1, removed: 0 })
  expect(todoDelta('// TODO a', '// TODO a changed', false)).toEqual({ added: 0, removed: 0 })
})

// ------------------------------------------------------------ 191 rule engine

test('191 rule parsing is strict: fixed events, one action, bounded text and throttle', async () => {
  expect(parseRule('on tests-pass toast "nice"')).toEqual({ ok: true, event: 'tests-pass', text: 'nice', everyMin: 5 })
  expect(parseRule("on commit toast 'shipped!' every 30m")).toEqual({ ok: true, event: 'commit', text: 'shipped!', everyMin: 30 })
  expect(parseRule('ON turn.complete TOAST "done" every 1 min')).toMatchObject({ ok: true, event: 'turn.complete', everyMin: 1 })
  expect(parseRule('on tests-fail toast "x" every 1440m')).toMatchObject({ ok: true })
  expect(parseRule('on tests-fail toast "x" every 1441m')).toMatchObject({ ok: false })
  expect(parseRule('on tests-fail toast "x" every 0m')).toMatchObject({ ok: false })
  expect(parseRule('on file.write toast "x"')).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown event/) })
  expect(parseRule('on commit run "rm -rf /"')).toMatchObject({ ok: false })
  expect(parseRule('on commit toast ""')).toMatchObject({ ok: false })
  expect(parseRule(`on commit toast "${'x'.repeat(81)}"`)).toMatchObject({ ok: false })
  expect(parseRule(`on commit toast "${'x'.repeat(80)}"`)).toMatchObject({ ok: true })
  expect(parseRule('on commit toast "a\u0007b"')).toMatchObject({ ok: false })
  expect(parseRule('toast "x" on commit')).toMatchObject({ ok: false })
  expect(parseRule('on commit toast nice')).toMatchObject({ ok: false })
  expect(RULE_EVENTS).toEqual(['turn.complete', 'tests-pass', 'tests-fail', 'commit'])
})

test('191 at most 20 rules, no duplicates, unique ids', async () => {
  let rules: ReturnType<typeof addRule>['rules'] = []

  for (let i = 0; i < 20; i++) {
    const r = addRule(rules, `on commit toast "r${i}"`)
    expect(r.error).toBeUndefined()
    rules = r.rules
  }
  expect(rules).toHaveLength(20)
  expect(addRule(rules, 'on commit toast "one more"').error).toMatch(/20/)
  expect(addRule(rules.slice(0, 3), 'on commit toast "r1"').error).toMatch(/already/)
  expect(new Set(rules.map(r => r.id)).size).toBe(20)
  const del = rules.filter(r => r.id !== 'r5')
  expect(addRule(del, 'on commit toast "fresh"').rule?.id).toBe('r21')
})

test('191 throttle: a rule fires again only after its interval; other events never match', async () => {
  const rules = addRule(addRule([], 'on tests-pass toast "nice" every 10m').rules, 'on commit toast "ship"').rules
  expect(pickRule(rules, 'tests-pass', NOW, {})?.text).toBe('nice')
  expect(pickRule(rules, 'tests-pass', NOW + 9 * 60_000, { r1: NOW })).toBeUndefined()
  expect(pickRule(rules, 'tests-pass', NOW + 10 * 60_000, { r1: NOW })?.text).toBe('nice')
  expect(pickRule(rules, 'tests-fail', NOW, {})).toBeUndefined()
  expect(pickRule(rules, 'commit', NOW, { r1: NOW })?.text).toBe('ship')
  expect(toastAllowed(false, NOW, NOW - 3 * 60_000)).toBe(true)
  expect(toastAllowed(false, NOW, NOW - 3 * 60_000 + 1)).toBe(false)
  expect(toastAllowed(true, NOW, 0)).toBe(false)
})

test('191 bash events: tests pass or fail, commit', async () => {
  expect(bashEvent('npm test', false, 'ok')).toBe('tests-pass')
  expect(bashEvent('npm run test -- --watch=false', true, '')).toBe('tests-fail')
  expect(bashEvent('pytest -q', false, '2 failed, 3 passed')).toBe('tests-fail')
  expect(bashEvent('pytest -q', false, '0 failed 5 passed')).toBe('tests-pass')
  expect(bashEvent('go test ./...', false, 'ok pkg')).toBe('tests-pass')
  expect(bashEvent('git commit -m "x"', false, '')).toBe('commit')
  expect(bashEvent('git commit -m "x"', true, '')).toBeUndefined()
  expect(bashEvent('ls -la', false, '')).toBeUndefined()
})

// ------------------------------------------------------------ 192, 193, 194, cards

test('192 retention parses and prunes by list', async () => {
  expect(parseKeep('days 30')).toEqual({ list: 'days', days: 30 })
  expect(parseKeep('wins default')).toEqual({ list: 'wins', days: 'default' })
  expect(parseKeep('days 3')).toHaveProperty('error')
  expect(parseKeep('days 99999')).toHaveProperty('error')
  expect(parseKeep('bogus 30')).toHaveProperty('error')
  const data = {
    ...emptyData(),
    days: [{ ...touchDay([], dayKey(NOW), x => x)[0]! }, { ...touchDay([], dayKey(NOW - 100 * DAY), x => x)[0]! }],
    wins: [{ at: NOW - 100 * DAY, text: 'old' }, { at: NOW, text: 'new' }],
    review: [{ id: 'v1', text: 'keep me', done: false, at: 0 }],
    goals: [{ id: 'g1', text: 'keep', due: '2020-W01', done: false, at: 0 }],
  }
  const cfg = { ...defaultCfg(), keep: { days: 30, wins: 365 } }
  const out = pruneData(data, cfg, NOW)
  expect(out.days.map(d => d.day)).toEqual([dayKey(NOW)])
  expect(out.wins.map(w => w.text)).toEqual(['old', 'new'])
  expect(out.review).toHaveLength(1)
  expect(out.goals).toHaveLength(1)
  expect(pruneData(data, { ...cfg, keep: { wins: 30 } }, NOW).wins.map(w => w.text)).toEqual(['new'])
})

test('193 tiles: reorder, hide and parse', async () => {
  expect(moveTile(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
  expect(moveTile(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
  expect(moveTile(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  expect(moveTile(['a', 'b', 'c'], 'zz', 1)).toEqual(['a', 'b', 'c'])
  expect(parseTileList('quality, wins quality')).toEqual({ tiles: ['quality', 'wins'] })
  expect(parseTileList('quality nope')).toHaveProperty('error')
  expect(parseTileList('')).toHaveProperty('error')
})

test('194 number formats', async () => {
  expect(fmtMoney(1.234, '$')).toBe('$1.23')
  expect(fmtMoney(1.235, '€')).toBe('€1.24')
  expect(fmtMoney(3, 'kr')).toBe('3.00 kr')
  expect(fmtClock(new Date(2026, 10, 25, 15, 5).getTime(), '24')).toBe('15:05')
  expect(fmtClock(new Date(2026, 10, 25, 15, 5).getTime(), '12')).toBe('3:05 PM')
  expect(fmtClock(new Date(2026, 10, 25, 0, 7).getTime(), '12')).toBe('12:07 AM')
  expect(fmtClock(new Date(2026, 10, 25, 12, 0).getTime(), '12')).toBe('12:00 PM')
  expect(fmtSize(999, 'si')).toBe('999 B')
  expect(fmtSize(1500, 'si')).toBe('1.5 kB')
  expect(fmtSize(1536, 'iec')).toBe('1.5 KiB')
  expect(fmtSize(5_000_000, 'si')).toBe('5 MB')
  expect(fmtSize(-4, 'si')).toBe('0 B')
})

test('133/136 plan items and goal due weeks', async () => {
  expect(parsePlanItems('a; b; c')).toEqual({ items: ['a', 'b', 'c'] })
  expect(parsePlanItems('only one')).toEqual({ items: ['only one'] })
  expect(parsePlanItems('a;b;c;d')).toHaveProperty('error')
  expect(parsePlanItems('  ; ')).toHaveProperty('error')
  expect(parsePlanItems('x'.repeat(81))).toHaveProperty('error')
  expect(parseGoalAdd('finish the migration @2026-W50', NOW)).toEqual({ text: 'finish the migration', due: '2026-W50' })
  expect(parseGoalAdd('ship it @+2', NOW)).toEqual({ text: 'ship it', due: '2026-W50' })
  expect(parseGoalAdd('no due week', NOW)).toHaveProperty('error')
  expect(parseGoalAdd('bad @nope', NOW)).toHaveProperty('error')
})

test('stored data is normalised and card text never sends', async () => {
  expect(normalizeData('junk')).toEqual(emptyData())
  expect(normalizeData({ days: 'x', wins: [{ at: 1, text: 'ok' }, { bad: true }], plan: { week: 'w', items: [{ text: 'a', done: true }] } }).wins).toHaveLength(1)
  const cfg = normalizeCfg({ tiles: ['quality', 'bogus', 'quality'], keep: { days: 3, wins: 90 }, rules: [{ id: 'r1', event: 'file.write', text: 'x', everyMin: 5 }], fmt: { currency: 'a b', clock: '12', units: 'x' } })
  expect(cfg.tiles).toEqual(['quality'])
  expect(cfg.keep).toEqual({ wins: 90 })
  expect(cfg.rules).toEqual([])
  expect(cfg.fmt).toEqual({ currency: '$', clock: '12', units: 'si' })
  const card = cardText({ data: emptyData(), cfg: defaultCfg(), sess: emptySess(NOW), now: NOW, icons: 'symbols' })
  expect(card).toMatch(/^Progress 2026-W48/)
  expect(COMMANDS.every(([n]) => n === 'pq' || n.startsWith('pq'))).toBe(true)
  expect(new Set(COMMANDS.map(([n]) => n)).size).toBe(COMMANDS.length)
})

// ------------------------------------------------------------ engine tests

type Box = { timeouts: (number | undefined)[]; toasts: string[]; fills: string[]; procs: string[][]; files: Set<string>; replies: (argv: string[]) => { exitCode: number; stdout: string; stderr: string }; isCalm: boolean; registered: string[]; refuse: string }

const newBox = (): Box => ({
  timeouts: [],
  toasts: [],
  fills: [],
  procs: [],
  files: new Set(),
  replies: () => ({ exitCode: 0, stdout: '', stderr: '' }),
  isCalm: false,
  registered: [],
  refuse: '',
})

const wire = (on: (...args: any[]) => unknown, box: Box) => {
  on('command.register', (_: unknown, e: { name: string }) => {
    if (e.name === box.refuse) {
      throw new Error('name taken')
    }
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('state.get', (_: unknown, e: any, next: any) =>
    e.plugin === 'settings' && e.key === 'isCalm' && box.isCalm ? { value: { value: true, version: 1 } } : next(e),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000, percent: 5 }, rateLimits: [], cost: { usd: 0.5 } } }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    box.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('fs.stat', (_: unknown, e: { path: string }) => {
    if (!box.files.has(e.path)) {
      throw new Error(`ENOENT ${e.path}`)
    }

    return { value: { size: 10, isFile: true, isDirectory: false, mtimeMs: 0, isLink: false } }
  })
  on('process.run', (_: unknown, e: { argv: string[]; init?: { timeoutMs?: number } }) => {
    box.procs.push([...e.argv])
    box.timeouts.push(e.init?.timeoutMs)

    return { value: { ...box.replies(e.argv), isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const cmd = ($: any, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })

const start = ($: any) => $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })

const done = (over: Record<string, unknown> = {}) => ({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...over }) as any

const PANE = (surface = 'desktop') =>
  ({
    plugin: 'progress-more',
    component: 'Pane',
    requestId: 'progress-more-main',
    surface,
    props: { title: 'Progress+', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as any

const setup = ($: any, on: any, now = NOW, stored: Record<string, unknown> = {}) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: stored[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    stored[e.key] = e.value

    return { value: undefined }
  })

  return { box, clock, stored }
}

test('session start registers every command and survives a refused name', async ($, on) => {
  const { box } = setup($, on)
  box.refuse = 'pqwin'
  await start($)
  expect(box.registered).toHaveLength(COMMANDS.length - 1)
  expect(box.registered).toContain('pqtrend')
  const help = await cmd($, 'pq')
  for (const [name] of COMMANDS) {
    expect(help.text).toContain(`/${name}`)
  }
})

test('123 tool results feed the trend; denied calls and other mods do not count', async ($, on) => {
  const { box } = setup($, on)
  let n = 0
  on('tool.call', (_: unknown, e: any) => {
    n += 1

    return e.command === 'bad' ? { result: { stdout: 'x' }, isError: true, text: 'boom' } : e.command === 'deny' ? { deny: 'blocked' } : { result: { stdout: 'x' } }
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'bad' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'deny' }).catch(() => undefined)
  expect(n).toBe(4)
  const t = await cmd($, 'pqtrend')
  expect(t.text).toMatch(/2026-W48\s+33\.3\s+1\/3/)
  const wrap = await cmd($, 'pqwrap')
  expect(wrap.text).toMatch(/Tool calls 3, errors 1 \(33\.3 per 100\)/)
  expect(box.toasts).toEqual([])
})

test('128/129/130 edits feed test debt, docs coverage and the cleanup meter', async ($, on) => {
  setup($, on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/work/app/src/a.ts', content: '/** Adds. */\nexport function add() {}\nexport function sub() {}\n// TODO: later\n' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/src/b.ts', old_string: '// TODO: x\n// TODO: y', new_string: '// TODO: x' })
  await $.tool.call({ tool: 'Write', file_path: '/work/app/src/a.test.ts', content: 'test("a", () => {})' })
  const debt = await cmd($, 'pqtestdebt')
  expect(debt.text).toMatch(/1 of 2 changed source files with no test file touched/)
  expect(debt.text).toContain('b.ts')
  const docs = await cmd($, 'pqdocs')
  expect(docs.text).toMatch(/50% of 2 exported functions/)
  expect(docs.text).toContain('a.ts:sub')
  const clean = await cmd($, 'pqclean')
  expect(clean.text).toMatch(/1 TODO\/FIXME added, 1 removed \(net 0\)/)
})

test('131/133/134/136 intentions, plan, wins and season goals', async ($, on) => {
  setup($, on)
  await start($)
  expect((await cmd($, 'pqrate', '4')).text).toMatch(/No intention yet/)
  expect((await cmd($, 'pqintent', 'finish the parser')).text).toMatch(/Intention noted/)
  expect((await cmd($, 'pqrate', '9')).text).toMatch(/1-5/)
  expect((await cmd($, 'pqrate', '4')).text).toMatch(/4\/5/)
  expect((await cmd($, 'pqplan', 'a; b; c; d')).text).toMatch(/three items at most/)
  expect((await cmd($, 'pqplan', 'ship; review; docs')).text).toMatch(/Plan for 2026-W48/)
  expect((await cmd($, 'pqplan', 'tick 2')).text).toMatch(/☑ 2\. review/)
  expect((await cmd($, 'pqwin', 'parser merged')).text).toMatch(/Logged/)
  expect((await cmd($, 'pqgoal', 'add finish migration @2026-W50')).text).toMatch(/1\. ☐ finish migration \(2026-W50, 2 wk left\)/)
  expect((await cmd($, 'pqgoal', 'add no due')).text).toMatch(/@due week/)
  expect((await cmd($, 'pqgoal', 'done 1')).text).toMatch(/☑ finish migration/)
  const wrap = (await cmd($, 'pqwrap')).text
  expect(wrap).toContain('Intent today: finish the parser (rated 4/5)')
  expect(wrap).toContain('Wins: parser merged')
  expect(wrap).toContain('Plan: 1/3 done')
  const card = (await cmd($, 'pqcard')).text
  expect(card).toMatch(/^Progress 2026-W48/m)
  expect(card).toContain('wins 1 · goals 1/1')
  expect(card).toContain('nothing is sent')
})

test('124 review list commands and progress bar', async ($, on) => {
  setup($, on)
  await start($)
  await cmd($, 'pqrev', 'add check errors')
  await cmd($, 'pqrev', 'add check logging')
  const r = await cmd($, 'pqrev', 'tick 1')
  expect(r.text).toMatch(/█+░+ 1\/2/)
  expect(r.text).toMatch(/☑ 1\. check errors/)
  expect((await cmd($, 'pqrev', 'tick 9')).text).toMatch(/Use \/pqrev tick/)
  expect((await cmd($, 'pqrev', 'del 1')).text).toMatch(/0\/1/)
  expect((await cmd($, 'pqrev', 'clear')).text).toMatch(/cleared/)
})

test('125 /pqrefactor runs only the validated read-only grep and records the count', async ($, on) => {
  const { box } = setup($, on)
  box.replies = argv => ({ exitCode: 0, stdout: argv.includes('oldHelper(') ? './src/a.ts:4\n./src/b.ts:0\n./src/c.ts:1\n' : '', stderr: '' })
  await start($)
  const bad = await cmd($, 'pqrefactor', '-rf')
  expect(bad.text).toMatch(/Not counted: the pattern must not start with a dash/)
  expect((await cmd($, 'pqrefactor', 'x')).text).toMatch(/2 to 60/)
  expect(box.procs).toEqual([])
  const r = await cmd($, 'pqrefactor', 'oldHelper(')
  expect(r.text).toMatch(/5 occurrences in 2 files/)
  expect(r.text).toContain('4  src/a.ts')
  expect(box.procs).toHaveLength(1)
  expect(box.procs[0]?.slice(0, 3)).toEqual(['grep', '-rIF', '-c'])
  expect(box.procs[0]?.slice(-3)).toEqual(['--', 'oldHelper(', '.'])
  // running again with no arguments re-counts the tracked pattern
  box.replies = () => ({ exitCode: 0, stdout: './src/a.ts:1\n', stderr: '' })
  const again = await cmd($, 'pqrefactor', '')
  expect(again.text).toMatch(/1 occurrence in 1 file/)
  expect(box.procs).toHaveLength(2)
  expect((await cmd($, 'pqrefactor', 'stop')).text).toMatch(/stopped/)
  // grep failing without output is reported, not hidden
  box.replies = () => ({ exitCode: 2, stdout: '', stderr: 'grep: bad' })
  expect((await cmd($, 'pqrefactor', 'again')).text).toMatch(/grep failed: grep: bad/)
})

test('126 /pqmigrate counts old and new and shows the share migrated', async ($, on) => {
  const { box } = setup($, on)
  box.replies = argv => ({ exitCode: 0, stdout: argv.includes('oldApi') ? './a.ts:3\n' : './a.ts:1\n./b.ts:8\n', stderr: '' })
  await start($)
  expect((await cmd($, 'pqmigrate', 'only-one')).text).toMatch(/two different literals/)
  expect((await cmd($, 'pqmigrate', 'same same')).text).toMatch(/two different literals/)
  const r = await cmd($, 'pqmigrate', 'oldApi "new api"')
  expect(r.text).toMatch(/old "oldApi": 3 occurrences in 1 file/)
  expect(r.text).toMatch(/new "new api": 9 occurrences in 2 files/)
  expect(r.text).toMatch(/75% migrated/)
  expect(box.procs.map(p => p[p.length - 2])).toEqual(['oldApi', 'new api'])
  expect((await cmd($, 'pqmigrate', '"-x" ok')).text).toMatch(/Not counted: old: the pattern must not start with a dash/)
})

test('127 /pqupgrade lists npm outdated read-only with a 30 s timeout and never installs', async ($, on) => {
  const { box } = setup($, on)
  box.files.add('/work/app/package.json')
  box.replies = argv => ({
    exitCode: 1,
    stdout: JSON.stringify({ left: { current: '1.0.0', latest: '2.0.0' }, mid: { current: '1.0.0', latest: '1.4.0' } }),
    stderr: '',
  })
  await start($)
  const r = await cmd($, 'pqupgrade')
  expect(r.text).toMatch(/npm: 2 outdated \(1 major, 1 minor, 0 patch\)/)
  expect(r.text).toMatch(/nothing was installed/)
  expect(box.procs).toEqual([['npm', 'outdated', '--json']])
  expect(box.timeouts).toEqual([30_000])
  // nothing runs without the command: pip when only a requirements file exists
  box.files.clear()
  box.files.add('/work/app/requirements.txt')
  box.replies = () => ({ exitCode: 0, stdout: '[]', stderr: '' })
  const p = await cmd($, 'pqupgrade')
  expect(p.text).toMatch(/pip: everything is current/)
  expect(box.procs[1]).toEqual(['pip', 'list', '--outdated', '--format', 'json'])
  box.files.clear()
  expect((await cmd($, 'pqupgrade')).text).toMatch(/No package.json/)
  for (const argv of box.procs) {
    expect(argv.some(a => /install|update|upgrade|add/.test(a))).toBe(false)
  }
})

test('191 rules toast on tests-pass, throttled, one toast per 3 minutes, never while calm', async ($, on) => {
  const { box, clock } = setup($, on)
  let allOk = false
  on('tool.call', (_: unknown, e: any) => (allOk || e.command === 'npm test' ? { result: { stdout: 'ok' } } : { result: { stdout: '' }, isError: true, text: 'fail' }))
  await start($)
  expect((await cmd($, 'pqrule', 'add on tests-pass toast "nice" every 10m')).text).toMatch(/1\. on tests-pass toast "nice" every 10m/)
  expect((await cmd($, 'pqrule', 'add on commit toast "ship" every 1m')).text).toMatch(/2\. on commit/)
  expect((await cmd($, 'pqrule', 'add on nothing toast "x"')).text).toMatch(/unknown event/)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(box.toasts).toEqual(['nice'])
  // rule throttle (10 m) and the global 3 minute gap
  await clock.advance(4 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(box.toasts).toEqual(['nice'])
  await clock.advance(7 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(box.toasts).toEqual(['nice', 'nice'])
  // commit rule is held back by the global gap, then shows once the gap has passed
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(box.toasts).toHaveLength(2)
  await clock.advance(4 * 60_000)
  allOk = true
  await $.tool.call({ tool: 'Bash', command: 'git commit -m y' })
  expect(box.toasts).toEqual(['nice', 'nice', 'ship'])
  // turn.complete rule
  await cmd($, 'pqrule', 'add on turn.complete toast "turn done" every 1m')
  await clock.advance(4 * 60_000)
  await $.turn.complete(done())
  expect(box.toasts.at(-1)).toBe('turn done')
  // a subagent's turn is not the user's turn
  await clock.advance(4 * 60_000)
  await $.turn.complete(done({ agentId: 'sub' }))
  expect(box.toasts.at(-1)).toBe('turn done')
  expect(box.toasts).toHaveLength(4)
  // calm switches every toast off
  box.isCalm = true
  await clock.advance(20 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m z' })
  await $.turn.complete(done())
  expect(box.toasts).toHaveLength(4)
})

test('189 one tip toast a day at session start; Monday plan reminder first; none when calm or off', async ($, on) => {
  const { box } = setup($, on, NOW)
  await start($)
  await cmd($, 'pqtips', 'add Read the diff before you commit')
  await cmd($, 'pqtips', 'add Small steps')
  expect(box.toasts).toEqual([])
  await start($)
  expect(box.toasts).toHaveLength(1)
  expect(box.toasts[0]).toMatch(/^Tip: /)
  await start($)
  expect(box.toasts).toHaveLength(1)
  expect((await cmd($, 'pqtips', 'del 1')).text).toMatch(/1\. Small steps/)
  expect((await cmd($, 'pqtips', 'add ' + 'x'.repeat(121))).text).toMatch(/1 to 120/)
})

test('189 Monday reminder, calm and off', async ($, on) => {
  const { box } = setup($, on, MONDAY)
  await start($)
  expect(box.toasts).toEqual(['Monday: set three items for the week with /pqplan a; b; c'])
  await cmd($, 'pqtips', 'off')
  expect((await cmd($, 'pqtips', '')).text).toMatch(/Tips are off/)
})

test('190 templates fill the prompt box without sending', async ($, on) => {
  const { box } = setup($, on)
  await start($)
  expect((await cmd($, 'pqtpl', '')).text).toMatch(/No templates yet/)
  expect((await cmd($, 'pqtpl', 'add bad!name some text')).text).toMatch(/Use \/pqtpl add/)
  await cmd($, 'pqtpl', 'add review Review this change for bugs: ')
  expect((await cmd($, 'pqtpl', 'review')).text).toMatch(/Filled the prompt box with "review"/)
  expect(box.fills).toEqual(['Review this change for bugs:'])
  expect((await cmd($, 'pqtpl', 'ghost')).text).toMatch(/No template "ghost"/)
  await cmd($, 'pqtpl', 'starter')
  expect((await cmd($, 'pqtpl', '')).text).toMatch(/explain/)
  await cmd($, 'pqtpl', 'del review')
  expect((await cmd($, 'pqtpl', '')).text).not.toMatch(/review:/)
})

test('192/193/194 retention, tiles and formats persist across sessions', async ($, on) => {
  const { stored } = setup($, on)
  await start($)
  expect((await cmd($, 'pqkeep', 'days 30')).text).toMatch(/days: 30 days\ntrends/)
  expect((await cmd($, 'pqkeep', 'days 2')).text).toMatch(/7 to 3650/)
  expect((await cmd($, 'pqtiles', 'show wins quality')).text).toMatch(/in order: wins, quality/)
  expect((await cmd($, 'pqtiles', 'up quality')).text).toMatch(/in order: quality, wins/)
  expect((await cmd($, 'pqtiles', 'hide wins')).text).toMatch(/in order: quality\n/)
  expect((await cmd($, 'pqtiles', 'show nope')).text).toMatch(/Unknown: nope/)
  expect((await cmd($, 'pqfmt', 'currency €')).text).toMatch(/currency €/)
  expect((await cmd($, 'pqfmt', 'clock 12')).text).toMatch(/clock 12 h/)
  expect((await cmd($, 'pqfmt', 'units iec')).text).toMatch(/MiB/)
  expect((await cmd($, 'pqfmt', 'currency a b')).text).toMatch(/Use \/pqfmt/)
  // a fresh engine start reads the same settings back from the store
  const cfg = stored.cfg as any
  expect(cfg.tiles).toEqual(['quality'])
  expect(cfg.keep).toEqual({ days: 30 })
  expect(cfg.fmt).toEqual({ currency: '€', clock: '12', units: 'iec' })
})

test('the pane draws the Home tiles in your order, with your formats, on every surface', async ($, on) => {
  setup($, on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await cmd($, 'pqwin', 'first win')
  await cmd($, 'pqtiles', 'show wins quality')
  await cmd($, 'pqfmt', 'currency €')
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect((await ui.find({ type: 'Text', text: /first win/ }))?.text).toContain('first win')
    expect((await ui.find({ type: 'Text', text: /cost estimate €0\.50/ }))?.text).toMatch(/cost estimate €0\.50/)
    expect(await ui.find({ type: 'Text', text: /^Review progress$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Celebration log$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane tabs and buttons work: review tick, template fill, tile toggle', async ($, on) => {
  const { box, stored } = setup($, on)
  await start($)
  await cmd($, 'pqrev', 'add check errors')
  await cmd($, 'pqtpl', 'add tests Write tests.')
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'tab-review' })
  expect(await ui.find({ type: 'Text', text: /░+ 0\/1/ })).toBeDefined()
  await ui.press({ key: 'rev-v1' })
  expect(await ui.find({ type: 'Text', text: /█+ 1\/1/ })).toBeDefined()
  await ui.press({ key: 'tab-custom' })
  await ui.press({ key: 'tpl-tests' })
  expect(box.fills).toEqual(['Write tests.'])
  await ui.press({ key: 'vis-wins' })
  expect((stored.cfg as any).tiles).not.toContain('wins')
  for (const tab of ['quality', 'track', 'me', 'home']) {
    await ui.press({ key: `tab-${tab}` })
    expect(await ui.find({ type: 'Text', text: /Progress\+/ })).toBeDefined()
  }
  await ui.unmount()
})

test('/pqreset clears recorded data, and "all" clears your settings too', async ($, on) => {
  const { stored } = setup($, on)
  await start($)
  await cmd($, 'pqwin', 'a win')
  await cmd($, 'pqrev', 'add x')
  await cmd($, 'pqtips', 'add keep me')
  const r = await cmd($, 'pqreset')
  expect(r.text).toMatch(/recorded data cleared/)
  expect((await cmd($, 'pqwin')).text).toMatch(/No wins yet/)
  expect((await cmd($, 'pqrev')).text).toMatch(/empty/)
  expect((await cmd($, 'pqtips')).text).toMatch(/keep me/)
  await cmd($, 'pqreset', 'all')
  expect((await cmd($, 'pqtips')).text).toMatch(/No tips yet/)
  expect(stored.data as any).toMatchObject({ wins: [], review: [] })
})

test('data written by an earlier session is loaded and pruned at session start', async ($, on) => {
  const old = new Date(2025, 0, 10).getTime()
  const stored = {
    data: { ...emptyData(), wins: [{ at: old, text: 'ancient' }, { at: NOW - DAY, text: 'recent' }], days: touchDay([], '2025-01-10', x => ({ ...x, calls: 5 })) },
    cfg: { ...defaultCfg(), keep: { wins: 30, days: 30 } },
  }
  setup($, on, NOW, stored)
  await start($)
  const wins = await cmd($, 'pqwin')
  expect(wins.text).toContain('recent')
  expect(wins.text).not.toContain('ancient')
})
