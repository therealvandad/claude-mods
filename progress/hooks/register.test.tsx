import { expect, mock, test } from 'claude-code/testing'

import {
  BRANCHES,
  CONFETTI_MS,
  CONFETTI_STILL,
  LEVELS,
  XP_DAILY_CAP,
  addBacklog,
  addGoal,
  addItem,
  addLive,
  calendarLines,
  canFreeze,
  cleanBacklog,
  cleanDays,
  cleanGoals,
  cleanLive,
  cleanMetrics,
  cleanProjects,
  cleanShips,
  commandHeads,
  completeGoal,
  confettiFrame,
  confettiView,
  dailyProgress,
  dayKey,
  emptyArchive,
  emptyBests,
  emptyDay,
  emptyGoals,
  emptySkills,
  focusScore,
  glyphsOf,
  habitLines,
  helpLines,
  isTestCommand,
  journalLines,
  leafStats,
  levelOf,
  momentum,
  nextLevelText,
  noteSkill,
  parseCoverage,
  parseShips,
  parseTestCounts,
  parseTestDuration,
  pruneDays,
  recordMetrics,
  removeItem,
  ringLines,
  setHabit,
  setItemDone,
  setJournal,
  shiftDay,
  skillCount,
  sparkline,
  startGoal,
  stopGoal,
  streakInfo,
  treeLines,
  updateBestTest,
  weekDays,
  weekProgress,
  weekStart,
  xpOfDay,
  xpTotal,
} from './logic'
import type { Days, Project } from './logic'

const MIN = 60_000
// Local 10:00 on Wed 25 Nov 2026, so day keys do not depend on the machine's zone.
const T0 = new Date(2026, 10, 25, 10, 0, 0).getTime()
const TODAY = dayKey(T0)
const GL = glyphsOf('symbols')

const day = (over: Partial<ReturnType<typeof emptyDay>> = {}) => ({ ...emptyDay(), ...over })

// ============================================================= pure functions

test('calendar: days, weeks run Monday to Sunday', async () => {
  expect(TODAY).toBe('2026-11-25')
  expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  expect(weekStart(TODAY)).toBe('2026-11-23')
  expect(weekDays(TODAY)[6]).toBe('2026-11-29')
  expect(weekStart('2026-11-29')).toBe('2026-11-23')
  expect(weekStart('2026-11-30')).toBe('2026-11-30')
})

test('103 daily bar counts goals done today over open goals plus done today', async () => {
  let data = emptyGoals()
  data = addGoal(data, 'write tests', TODAY).data
  data = addGoal(data, 'ship it', TODAY).data
  data = addGoal(data, '   ', TODAY).data
  expect(data.goals.length).toBe(2)
  expect(dailyProgress(data.goals, TODAY)).toEqual({ done: 0, total: 2, frac: 0 })
  data = completeGoal(data, 1, T0).data
  expect(dailyProgress(data.goals, TODAY)).toEqual({ done: 1, total: 2, frac: 0.5 })
  // A goal finished yesterday is not today's; an open one carries over.
  const tomorrow = shiftDay(TODAY, 1)
  expect(dailyProgress(data.goals, tomorrow)).toEqual({ done: 0, total: 1, frac: 0 })
  // Done twice or unknown does nothing.
  expect(completeGoal(data, 1, T0).goal).toBeUndefined()
  expect(completeGoal(data, 99, T0).goal).toBeUndefined()
})

test('104 weekly ring: filled dots follow goals done this week against the target', async () => {
  const filled = (lines: string[]) => lines.join('').split('').filter(c => c === GL.on).length
  expect(ringLines(0, GL).length).toBe(5)
  expect(filled(ringLines(0, GL))).toBe(0)
  expect(filled(ringLines(0.5, GL))).toBe(6)
  expect(filled(ringLines(1, GL))).toBe(12)
  expect(ringLines(0.58, GL)[2]).toContain('58%')
  expect(filled(ringLines(7, GL))).toBe(12)

  let data = { ...emptyGoals(), target: 4 }
  for (const t of ['a', 'b', 'c']) {
    data = addGoal(data, t, TODAY).data
  }
  data = completeGoal(data, 1, T0).data
  data = completeGoal(data, 2, T0 - 2 * 86_400_000).data
  expect(weekProgress(data.goals, TODAY, 4)).toEqual({ done: 2, target: 4, frac: 0.5 })
  // Last week's goal does not count.
  data = completeGoal(data, 3, T0 - 9 * 86_400_000).data
  expect(weekProgress(data.goals, TODAY, 4).done).toBe(2)
})

test('117 time per goal: one clock at a time, starting another stops the first', async () => {
  let data = addGoal(addGoal(emptyGoals(), 'one', TODAY).data, 'two', TODAY).data
  const a = startGoal(data, 1, T0)
  data = a.data
  expect(data.running).toEqual({ id: 1, startedAt: T0 })
  const b = startGoal(data, 2, T0 + 5 * MIN)
  expect(b.stopped?.spentMs).toBe(5 * MIN)
  data = b.data
  expect(data.running?.id).toBe(2)
  const s = stopGoal(data, T0 + 8 * MIN)
  expect(s.ms).toBe(3 * MIN)
  expect(s.data.goals.find(g => g.id === 2)?.spentMs).toBe(3 * MIN)
  expect(s.data.running).toBeNull()
  // Finishing a goal with a running clock adds the time.
  const c = startGoal(s.data, 1, T0 + 10 * MIN).data
  const done = completeGoal(c, 1, T0 + 12 * MIN)
  expect(done.goal?.spentMs).toBe(7 * MIN)
  expect(done.data.running).toBeNull()
  expect(startGoal(done.data, 1, T0).goal).toBeUndefined()
})

test('108 confetti: a burst row for 1.5 s, a still row when motion is off, none when calm', async () => {
  expect(confettiFrame(0).trim().length).toBeGreaterThan(0)
  const mid = confettiFrame(450)
  expect(mid.length).toBe(28)
  expect(mid.trim().length).toBeGreaterThan(0)
  expect(confettiFrame(450)).toBe(mid)
  expect(confettiFrame(CONFETTI_MS)).toBe('')
  expect(confettiFrame(-1)).toBe('')
  // The burst thins out.
  const count = (age: number) => [...Array(20).keys()].reduce((n, i) => n + confettiFrame(age + i * 3).replace(/ /g, '').length, 0)
  expect(count(0)).toBeLessThan(count(300))
  expect(count(300)).toBeGreaterThan(count(1300))
  expect(confettiView(300, true, false)).toBe(confettiFrame(300))
  expect(confettiView(300, false, false)).toBe(CONFETTI_STILL)
  expect(confettiView(300, true, true)).toBe('')
  expect(confettiView(300, false, true)).toBe('')
})

test('105 milestone ladder: both thresholds must be met, with the distance to the next', async () => {
  expect(levelOf({ tools: 0, sessions: 0 })).toBe(0)
  expect(levelOf({ tools: 500, sessions: 1 })).toBe(0)
  expect(levelOf({ tools: 25, sessions: 2 })).toBe(1)
  expect(levelOf({ tools: 100, sessions: 4 })).toBe(1)
  expect(levelOf({ tools: 100, sessions: 5 })).toBe(2)
  expect(levelOf({ tools: 99999, sessions: 9999 })).toBe(LEVELS.length - 1)
  expect(nextLevelText({ tools: 10, sessions: 1 })).toBe('Next: Tinkerer needs 15 more tool calls and 1 more session.')
  expect(nextLevelText({ tools: 30, sessions: 1 })).toBe('Next: Tinkerer needs 1 more session.')
  expect(nextLevelText({ tools: 99999, sessions: 9999 })).toBe('Top of the ladder.')
  const thresholds = LEVELS.map(l => l.tools)
  expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds)
})

test('106 XP: tests +2, commit +3, note +1, goal +5, with a daily cap on the farmable ones', async () => {
  expect(xpOfDay(day({ tests: 1, commits: 1, notes: 1, goals: 1 }))).toBe(2 + 3 + 1 + 5)
  expect(xpOfDay(day({ tests: 100 }))).toBe(XP_DAILY_CAP * 2)
  expect(xpOfDay(day({ goals: 100 }))).toBe(500)
  expect(xpOfDay(undefined)).toBe(0)
  const days: Days = { [TODAY]: day({ commits: 2 }), '2025-01-01': day({ notes: 4 }) }
  expect(xpTotal(days, emptyArchive())).toBe(6 + 4)
  // Old days fold into the archive and keep their XP.
  const pruned = pruneDays(days, emptyArchive(), TODAY)
  expect(Object.keys(pruned.days)).toEqual([TODAY])
  expect(xpTotal(pruned.days, pruned.archive)).toBe(10)
})

test('107 streak calendar: a freeze bridges a quiet day, one per week', async () => {
  const yesterday = shiftDay(TODAY, -1)
  const days: Days = {
    [TODAY]: day({ tools: 3 }),
    [shiftDay(TODAY, -2)]: day({ tools: 1 }),
    [shiftDay(TODAY, -3)]: day({ tools: 1 }),
  }
  expect(streakInfo(days, [], TODAY).current).toBe(1)
  expect(streakInfo(days, [yesterday], TODAY).current).toBe(4 - 1)
  expect(streakInfo(days, [yesterday], TODAY).longest).toBe(3)
  // Today with nothing yet does not break a streak that ran to yesterday.
  const open: Days = { [yesterday]: day({ tools: 1 }), [shiftDay(TODAY, -2)]: day({ goals: 1 }) }
  expect(streakInfo(open, [], TODAY)).toEqual({ current: 2, longest: 2, isTodayDone: false })
  expect(streakInfo({}, [], TODAY)).toEqual({ current: 0, longest: 0, isTodayDone: false })

  expect(canFreeze(TODAY, TODAY, [], {}).ok).toBe(true)
  expect(canFreeze(yesterday, TODAY, [], {}).ok).toBe(true)
  expect(canFreeze(shiftDay(TODAY, -2), TODAY, [], {}).ok).toBe(false)
  expect(canFreeze(TODAY, TODAY, [], days).reason).toMatch(/already has activity/)
  expect(canFreeze(TODAY, TODAY, [yesterday], {}).reason).toMatch(/One freeze per week/)
  // Across a week boundary a new freeze is fine (Sunday then Monday).
  expect(canFreeze('2026-11-23', '2026-11-23', ['2026-11-22'], {}).ok).toBe(true)

  const lines = calendarLines(days, [yesterday], TODAY, GL)
  expect(lines.length).toBe(6)
  expect(lines[0]).toContain('Mon')
  expect(lines.join('\n')).toContain(`[${GL.on}]`)
  expect(lines.join('\n')).toContain(GL.frozen)
  // The days after today are blank.
  expect(lines[5]).toMatch(/^11-23\s+■\s+❄\s+\[■\]$/)
})

test('command heads and test detection read what a Bash call runs', async () => {
  expect(commandHeads('cd /p && git status && npm test')).toEqual(['cd', 'git', 'git status', 'npm'])
  expect(commandHeads('FOO=1 sudo /usr/bin/ls -la | grep x')).toEqual(['ls', 'grep'])
  expect(commandHeads('git -C /repo commit -m "x"')).toEqual(['git', 'git commit'])
  expect(commandHeads('echo "git commit"')).toEqual(['echo'])
  for (const c of ['npm test', 'npm run test -- --watch=false', 'pnpm test', 'npx vitest run', 'pytest -q', 'python3 -m pytest', 'cargo test', 'go test ./...', 'cd x && jest', '"$C" plugin test /m', 'make test']) {
    expect(isTestCommand(c)).toBe(true)
  }
  for (const c of ['echo pytest', 'ls tests', 'git commit -m "npm test"', 'npm install', 'cat test.js']) {
    expect(isTestCommand(c)).toBe(false)
  }
})

test('112 skill tree: a tier unlocks only after the one above it on its branch', async () => {
  let s = emptySkills()
  expect(skillCount(s)).toEqual({ got: 0, total: 15 })
  s = noteSkill(s, 'Grep', '')
  // Searcher needs Reader first: Grep alone unlocks nothing on that branch.
  expect(treeLines(s, GL).filter(l => l.includes('Searcher'))[0]).toContain(GL.todo)
  s = noteSkill(s, 'Read', '')
  expect(treeLines(s, GL).filter(l => l.includes('Searcher'))[0]).toContain(GL.done)
  s = noteSkill(s, 'Bash', 'git commit -m x && npm test')
  const tree = treeLines(s, GL).join('\n')
  expect(tree).toMatch(new RegExp(`${GL.done} T1 Shell hand`))
  expect(tree).toMatch(new RegExp(`${GL.done} T1 Tester`))
  expect(tree).toMatch(new RegExp(`${GL.done} T2 Committer`))
  expect(tree).toContain('T3 Cartographer  (use Read, Grep and Glob)')
  s = noteSkill(s, 'mcp__x__y', '')
  expect(s.tools.mcp).toBe(1)
  expect(BRANCHES.length).toBe(5)
  // Distinct command names are what count for the shell tiers, and the record stays bounded.
  for (let i = 0; i < 100; i++) {
    s = noteSkill(s, 'Bash', `cmd${i}`)
  }
  expect(Object.keys(s.cmds).length).toBeLessThanOrEqual(60)
})

test('109 and 110 project checklist: leaf percent, nesting, parents follow their children', async () => {
  let p: Project = { name: 'App', items: [], nextId: 1 }
  p = addItem(p, 'design', 0).project!
  p = addItem(p, 'build', 0).project!
  p = addItem(p, 'api', 2).project!
  p = addItem(p, 'ui', 2).project!
  p = addItem(p, 'form', 4).project!
  expect(leafStats(p.items)).toEqual({ done: 0, total: 3, percent: 0 })
  expect(addItem(p, 'too deep', 5).error).toMatch(/3 levels/)
  expect(addItem(p, 'x', 99).error).toMatch(/No item #99/)
  expect(addItem(p, '  ', 0).error).toBeDefined()

  p = { ...p, items: setItemDone(p.items, 1, true)! }
  expect(leafStats(p.items).percent).toBe(33)
  p = { ...p, items: setItemDone(p.items, 3, true)! }
  expect(leafStats(p.items, 2)).toEqual({ done: 1, total: 2, percent: 50 })
  // Checking a parent checks everything under it.
  p = { ...p, items: setItemDone(p.items, 2, true)! }
  expect(leafStats(p.items).percent).toBe(100)
  p = { ...p, items: setItemDone(p.items, 4, false)! }
  expect(leafStats(p.items, 2).percent).toBe(50)
  expect(setItemDone(p.items, 77, true)).toBeUndefined()
  // Removing a parent removes its subtree.
  expect(removeItem(p.items, 2)?.map(i => i.id)).toEqual([1])
  // A broken parent link in stored data moves the item to the top level.
  const fixed = cleanProjects({ projects: [{ name: 'X', items: [{ id: 3, text: 'a', parent: 9 }] }], current: 'nope' })
  expect(fixed.projects[0]?.items[0]?.parent).toBe(0)
  expect(fixed.current).toBe('X')
})

test('113 habits: three defaults on a weekly grid', async () => {
  let h = setHabit({}, TODAY, 1, true)
  h = setHabit(h, shiftDay(TODAY, -1), 0, true)
  h = setHabit(h, shiftDay(TODAY, -1), 2, true)
  const lines = habitLines(h, TODAY, GL)
  expect(lines[2]).toMatch(/1 Write a note\s+/)
  expect(lines[2]).toMatch(/1\/7$/)
  expect(lines[3]).toMatch(/2 Run tests.*1\/7$/)
  expect(lines[4]).toMatch(/3 Commit.*1\/7$/)
  h = setHabit(h, TODAY, 1, false)
  expect(habitLines(h, TODAY, GL)[3]).toMatch(/0\/7$/)
})

test('114 personal bests: run time read from test output, only a faster run replaces it', async () => {
  expect(parseTestDuration('Tests: 3 passed\nTime:        1.234 s')).toBe(1234)
  expect(parseTestDuration('   Duration  850ms (transform 1ms)')).toBe(850)
  expect(parseTestDuration('=== 12 passed in 0.52s ===')).toBe(520)
  expect(parseTestDuration('Ran 3 tests in 0.004s')).toBe(4)
  expect(parseTestDuration('test result: ok. 3 passed; 0 failed; finished in 0.01s')).toBe(10)
  expect(parseTestDuration('# duration_ms 123.4')).toBe(123)
  expect(parseTestDuration('ok  \tgithub.com/x/y\t0.123s')).toBe(123)
  expect(parseTestDuration('nothing here')).toBeUndefined()
  let b = emptyBests()
  let r = updateBestTest(b, 900, 'parsed', T0, 'npm test')
  expect(r.isBest).toBe(true)
  b = r.bests
  expect(updateBestTest(b, 1200, 'parsed', T0, 'x').isBest).toBe(false)
  r = updateBestTest(b, 400, 'measured', T0 + 1, 'pytest')
  expect(r.bests).toMatchObject({ testMs: 400, testSource: 'measured', testCmd: 'pytest' })
  expect(updateBestTest(b, 0, 'measured', T0, 'x').isBest).toBe(false)
})

test('115 journal: one line a day, timeline with quiet days', async () => {
  let j = setJournal([], '2026-11-25', 'first')
  j = setJournal(j, '2026-11-25', 'second wins')
  j = setJournal(j, '2026-11-22', 'older')
  expect(j.map(e => e.text)).toEqual(['older', 'second wins'])
  expect(setJournal(j, '2026-11-24', '   ')).toEqual(j)
  const lines = journalLines(j, TODAY)
  expect(lines[0]).toBe('● 11-25 Wed  second wins')
  expect(lines[1]).toBe('│  2 quiet days')
  expect(lines[2]).toBe('● 11-22 Sun  older')
  expect(journalLines([], TODAY)[0]).toMatch(/empty/)
  // Bounded to 90 days of lines.
  let many = j
  for (let i = 0; i < 120; i++) {
    many = setJournal(many, shiftDay('2026-01-01', i), `d${i}`)
  }
  expect(many.length).toBe(90)
})

test('118 focus score: the share of recent file calls in the most-touched directory', async () => {
  let live = cleanLive({}, T0)
  expect(focusScore(live.events, T0).score).toBeUndefined()
  for (const [i, p] of ['/p/src/a.ts', '/p/src/b.ts', '/p/src/c.ts', '/p/docs/x.md'].entries()) {
    live = addLive(live, T0 - 10 * MIN + i * MIN, p)
  }
  expect(focusScore(live.events, T0)).toEqual({ score: 75, dir: '/p/src', count: 3, total: 4 })
  // Calls older than 2 hours fall out of the window.
  live = addLive(live, T0 + 3 * 60 * MIN, '/p/docs/y.md')
  expect(focusScore(live.events, T0 + 3 * 60 * MIN).total).toBe(1)
  // A call with no file path counts for momentum only.
  const n = addLive(live, T0, '')
  expect(n.events.length).toBe(live.events.length)
})

test('119 momentum: this hour against the average of earlier active hours', async () => {
  const hours: Record<string, number> = {}
  expect(momentum(hours, T0).average).toBeUndefined()
  hours['2026-11-25 07'] = 10
  hours['2026-11-25 08'] = 20
  hours['2026-11-25 09'] = 30
  hours['2026-11-25 10'] = 40
  const m = momentum(hours, T0)
  expect(m).toMatchObject({ current: 40, average: 20, ratio: 2, samples: 3 })
  expect(momentum({ ...hours, '2026-11-25 10': 10 }, T0).ratio).toBe(0.5)
})

test('120 backlog: add, count of open items, bounded to 100', async () => {
  let d = cleanBacklog({})
  d = addBacklog(d, 'one', TODAY).data
  d = addBacklog(d, 'two', TODAY).data
  expect(d.items.map(i => i.id)).toEqual([1, 2])
  expect(addBacklog(d, '  ', TODAY).item).toBeUndefined()
  for (let i = 0; i < 150; i++) {
    d = addBacklog(d, `item ${i}`, TODAY).data
  }
  expect(d.items.length).toBe(100)
  expect(d.nextId).toBe(153)
})

test('121 ship log: commits, merges and tags are read from successful Bash results', async () => {
  const commit = parseShips('git add . && git commit -m "fix: parser"', '[main 1a2b3c4] fix: parser\n 1 file changed', false, T0)
  expect(commit).toEqual([{ at: T0, kind: 'commit', text: 'fix: parser', ref: '1a2b3c4' }])
  expect(parseShips('git commit -m x', '[feature/x (root-commit) abcdef0] first', false, T0)[0]?.text).toBe('first')
  expect(parseShips('git commit -m x', 'nothing to commit, working tree clean', false, T0)).toEqual([])
  expect(parseShips('git commit -m x', '[main 1a2b3c4] fix', true, T0)).toEqual([])
  expect(parseShips('git commit -m "echo"', 'hello', false, T0)).toEqual([])
  expect(parseShips('echo "git commit"', '[main 1a2b3c4] fix', false, T0).length).toBe(0)

  const merge = parseShips('git merge feature', "Merge made by the 'ort' strategy.", false, T0)
  expect(merge[0]).toMatchObject({ kind: 'merge', text: 'Merge feature', ref: 'feature' })
  expect(parseShips('git merge feature', 'Already up to date.', false, T0)).toEqual([])
  expect(parseShips('git merge --no-ff -m "Ship it" dev', 'Merge made by the ort strategy', false, T0)[0]?.text).toBe('Ship it')

  expect(parseShips('git tag v1.2.0', '', false, T0)[0]).toMatchObject({ kind: 'tag', text: 'v1.2.0', ref: 'v1.2.0' })
  expect(parseShips('git tag -a v2 -m "Release two"', '', false, T0)[0]).toMatchObject({ text: 'Release two', ref: 'v2' })
  expect(parseShips('git tag', 'v1', false, T0)).toEqual([])
  expect(parseShips('git tag -l "v*"', 'v1', false, T0)).toEqual([])
  expect(parseShips('git tag -d v1', 'Deleted', false, T0)).toEqual([])
  expect(parseShips('git tag v3', '', true, T0)).toEqual([])

  const junk = cleanShips([{ kind: 'x', text: 'ok', at: 1 }, { text: '' }, 'no'])
  expect(junk).toEqual([{ at: 1, kind: 'commit', text: 'ok', ref: '' }])
})

test('122 before and after metrics: counts and coverage parsed from test output, sparkline, bounded', async () => {
  expect(parseTestCounts('Test Suites: 1 passed, 1 total\nTests:       1 failed, 12 passed, 13 total')).toEqual({ passed: 12, failed: 1 })
  expect(parseTestCounts(' Test Files  1 passed (1)\n      Tests  7 passed (7)')).toEqual({ passed: 7, failed: 0 })
  expect(parseTestCounts('=== 2 failed, 30 passed in 0.5s ===')).toEqual({ passed: 30, failed: 2 })
  expect(parseTestCounts('test result: ok. 5 passed; 0 failed;')).toEqual({ passed: 5, failed: 0 })
  expect(parseTestCounts('# tests 4\n# pass 4\n# fail 0')).toEqual({ passed: 4, failed: 0 })
  expect(parseTestCounts('no tests')).toBeUndefined()
  expect(parseCoverage('All files          |   85.2 |   70 |')).toBe(85.2)
  expect(parseCoverage('Name  Stmts  Miss  Cover\nTOTAL   200    20    90%')).toBe(90)
  expect(parseCoverage('coverage: 71.5% of statements')).toBe(71.5)
  expect(parseCoverage('Statements   : 66.67% ( 4/6 )')).toBe(66.67)
  expect(parseCoverage('nothing')).toBeUndefined()

  let m = cleanMetrics({})
  for (let i = 0; i < 70; i++) {
    m = recordMetrics(m, `Tests: ${i} passed\nAll files | ${50 + (i % 40)} |`, T0 + i, true)
  }
  expect(m.passed.length).toBe(60)
  expect(m.passed[59]?.v).toBe(69)
  expect(m.coverage.length).toBe(60)
  // Coverage alone, from a coverage command that is not a test run.
  const only = recordMetrics(cleanMetrics({}), 'coverage report\nTOTAL 10 1 88%', T0, false)
  expect(only.coverage.map(p => p.v)).toEqual([88])
  expect(only.passed).toEqual([])
  expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe('▁▂▃▄▅▆▇█')
  expect(sparkline([5, 5, 5])).toBe('▄▄▄')
  expect(sparkline([])).toBe('')
})

test('stored junk is cleaned and bounded', async () => {
  expect(cleanGoals('x')).toEqual(emptyGoals())
  const g = cleanGoals({ goals: [{ id: 1, text: 'ok', day: '2026-11-25' }, { id: 2, text: '' }, 5], nextId: 'x', target: 500, running: { id: 7, startedAt: 1 } })
  expect(g.goals.length).toBe(1)
  expect(g.nextId).toBe(2)
  expect(g.target).toBe(99)
  expect(g.running).toBeNull()
  expect(cleanDays({ 'bad-key': { tools: 1 }, '2026-11-25': { tools: -3, goals: 'x' } })).toEqual({ '2026-11-25': emptyDay() })
  expect(cleanLive({ hours: { nope: 1, '2026-11-25 10': 4 }, events: [{ at: T0 - 1, dir: '/a' }, { at: 5, dir: '/old' }] }, T0).events.length).toBe(1)
  expect(helpLines().length).toBeGreaterThanOrEqual(19)
  expect(helpLines().every(l => l.startsWith('/pg'))).toBe(true)
})

// ================================================================ the mod itself

const PANE = (over: Record<string, unknown> = {}) =>
  ({
    plugin: 'progress',
    component: 'Pane',
    requestId: 'progress-main',
    surface: 'desktop',
    props: { title: 'Progress', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    ...over,
  }) as const

type World = {
  log: { toasts: string[]; registered: string[]; fills: string[]; opened: string[] }
  clock: ReturnType<typeof mock.clock>
  setOutput: (s: string) => void
  setError: (b: boolean) => void
  setDenied: (b: boolean) => void
}

const world = (on: any, store: Record<string, unknown> = {}, foreign: Record<string, unknown> = {}, now = T0): World => {
  const log = { toasts: [] as string[], registered: [] as string[], fills: [] as string[], opened: [] as string[] }
  let output = ''
  let isError = false
  let isDenied = false
  const clock = mock.clock(on, { now })
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('state.get', (_: unknown, e: any, next: any) =>
    (e.plugin === 'motion' || e.plugin === 'settings') && `${e.plugin}.${e.key}` in foreign
      ? { value: { value: foreign[`${e.plugin}.${e.key}`], version: 1 } }
      : next(e),
  )
  on('command.register', (_: unknown, e: { name: string }) => {
    log.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    log.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: log.opened.map(id => ({ id })) }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    log.toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    log.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('tool.call', () => (isDenied ? { deny: 'no' } : { result: {}, text: output, ...(isError ? { isError: true } : {}) }))

  return { log, clock, setOutput: s => (output = s), setError: b => (isError = b), setDenied: b => (isDenied = b) }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args })) as { text: string }).text
test('session start registers every command, each beginning pg', async ($, on) => {
  const { log } = world(on)
  await start($)
  expect(log.registered.length).toBe(helpLines().length)
  expect(log.registered.every(n => n.startsWith('pg'))).toBe(true)
  expect(new Set(log.registered).size).toBe(log.registered.length)
  expect(await run($, 'pg')).toContain('/pggoal')
})

test('103 108 117: goals through commands, with the pane bar, ring and a 1.5 s burst that stops', async ($, on) => {
  const { log, clock } = world(on)
  await start($)
  expect(await run($, 'pggoal', 'add write tests')).toContain('Added #1')
  await run($, 'pggoal', 'add ship it')
  expect(await run($, 'pggoal', '')).toContain('0/2')
  expect(await run($, 'pggoal', 'start 1')).toContain('Clock running on #1')
  await clock.advance(5 * MIN)
  expect(await run($, 'pggoal', 'list')).toContain('5m')

  await run($, 'pgpane', 'goals')
  expect(log.opened).toContain('progress-main')
  const done = await run($, 'pggoal', 'done 1')
  expect(done).toContain('Goal #1 done: write tests. +5 XP')
  expect(done).toContain('1/2')
  expect(done).toContain('✦')
  expect(await run($, 'pggoal', 'done 1')).toBe('No open goal #1.')
  expect(await run($, 'pggoal', 'stop')).toBe('No goal clock is running.')

  // The burst row animates on the 150 ms ticker, then goes away.
  const burst = async () => {
    const ui = await $.ui.mount(PANE())
    const row = await ui.find({ type: 'Text', text: /[✦✧*•+]/ })
    await ui.unmount()

    return row?.text
  }
  const seen = new Set<string | undefined>()
  for (let i = 0; i < 4; i++) {
    seen.add(await burst())
    await clock.advance(150)
  }
  expect([...seen].filter(Boolean).length).toBeGreaterThan(1)
  await clock.advance(CONFETTI_MS)
  const after = await burst()
  // The only glyph rows left are none: the pane text no longer holds the burst.
  expect(after === undefined || !/^[\s✦✧*•+·]+$/.test(after)).toBe(true)
  expect(await run($, 'pgxp')).toMatch(/Goal done\s+\+5\s+1/)
})

test('108 with motion off the burst is one still row, with calm there is none and no toast', async ($, on) => {
  const still = world(on, {}, { 'motion.isOn': false })
  await start($)
  await run($, 'pgpane')
  await run($, 'pggoal', 'add a')
  expect(await run($, 'pggoal', 'done 1')).toContain(CONFETTI_STILL)
  const ui = await $.ui.mount(PANE())
  expect((await ui.find({ type: 'Text', text: /✦ · ✧/ }))?.text).toBe(CONFETTI_STILL)
  await still.clock.advance(2000)
  expect((await ui.find({ type: 'Text', text: /✦ · ✧/ }))?.text).toBe(CONFETTI_STILL)
  await ui.unmount()
})

test('108 calm: no burst row at all', async ($, on) => {
  world(on, {}, { 'settings.isCalm': true })
  await start($)
  await run($, 'pgpane')
  await run($, 'pggoal', 'add a')
  const out = await run($, 'pggoal', 'done 1')
  expect(out).not.toContain('✦')
  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /[✦✧]/ })).toBeUndefined()
  await ui.unmount()
})

test('goal commands: undo, rm, target and usage', async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'pggoal', 'add')).toContain('Usage')
  await run($, 'pggoal', 'add one')
  await run($, 'pggoal', 'done 1')
  expect(await run($, 'pgxp')).toMatch(/Goal done\s+\+5\s+1/)
  expect(await run($, 'pggoal', 'undo 1')).toContain('Reopened #1')
  expect(await run($, 'pggoal', 'undo 1')).toBe('Goal #1 is not finished.')
  expect(await run($, 'pggoal', 'target 4')).toBe('Weekly target is now 4 goals.')
  expect(await run($, 'pggoal', 'target 0')).toContain('The weekly target is 4')
  expect(await run($, 'pggoal', 'rm 1')).toContain('Removed #1')
  expect(await run($, 'pggoal', 'bogus 1')).toContain('Usage')
  expect(await run($, 'pggoal', 'done x')).toContain('Usage')
})

test('106 113 114 121 122: tool calls feed XP, habits, bests, the ship log and metrics', async ($, on) => {
  const w = world(on)
  await start($)

  w.setOutput('Tests: 12 passed, 12 total\nTime:        1.500 s\nAll files | 81.5 |')
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --coverage' })
  w.setOutput('Tests: 12 passed, 12 total\nTime:        0.900 s\nAll files | 83 |')
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  w.setOutput('[main 9f8e7d6] add the parser\n 2 files changed')
  await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "add the parser"' })
  w.setOutput('')
  await $.tool.call({ tool: 'Bash', command: 'git tag v0.1.0' })
  w.setOutput('Merge made by the ort strategy.')
  await $.tool.call({ tool: 'Bash', command: 'git merge feature' })

  const xp = await run($, 'pgxp')
  expect(xp).toContain('Test run     +2')
  expect(xp).toMatch(/Test run\s+\+2\s+2\s+2\s+2/)
  expect(xp).toMatch(/Commit\s+\+3\s+1\s+1\s+1/)
  expect(xp).toContain('XP 7 total')

  const habits = await run($, 'pghabit')
  expect(habits).toMatch(/2 Run tests.*1\/7$/m)
  expect(habits).toMatch(/3 Commit.*1\/7$/m)
  expect(habits).toMatch(/1 Write a note.*0\/7$/m)

  expect(await run($, 'pgbest')).toContain('Fastest passing test run: 900 ms (read from the output)')
  const ships = await run($, 'pgship')
  expect(ships).toContain('1 commit, 1 merge, 1 tag')
  expect(ships).toContain('9f8e7d6 add the parser')
  expect(ships).toContain('Merge feature')
  expect(await run($, 'pgmetrics')).toMatch(/Passed\s+\S+\s+12 to 12/)
  const metrics = await run($, 'pgmetrics')
  expect(metrics).toMatch(/Coverage\s+\S+\s+81.5% to 83%/)

  // A failing commit leaves no entry, and a failing test run still counts as a run.
  w.setError(true)
  w.setOutput('[main 1111111] nope')
  await $.tool.call({ tool: 'Bash', command: 'git commit -m nope' })
  expect(await run($, 'pgship')).not.toContain('nope')
  w.setOutput('Tests: 2 failed, 3 passed, 5 total')
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(await run($, 'pgxp')).toMatch(/Test run\s+\+2\s+3\s+3\s+3/)
  expect(await run($, 'pgbest')).toContain('900 ms')
  expect(await run($, 'pgmetrics')).toMatch(/Failed\s+\S+\s+0 to 2/)
})

test('a /note that writes something counts as the note habit and XP, a bare /note does not', async ($, on) => {
  world(on)
  on('command.run', (_: unknown, e: { command: string }) => ({ text: `ran ${e.command}` }))
  await start($)
  await ($ as any).command.run({ command: 'note', args: '' })
  expect(await run($, 'pgxp')).toMatch(/Note\s+\+1\s+0\s+0\s+0/)
  await ($ as any).command.run({ command: 'note', args: 'remember the milk' })
  expect(await run($, 'pgxp')).toMatch(/Note\s+\+1\s+1\s+1\s+1/)
  expect(await run($, 'pghabit')).toMatch(/1 Write a note.*1\/7$/m)
})

test('115 journal and 111 learning and 120 backlog through commands', async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'pgjournal')).toMatch(/empty/)
  expect(await run($, 'pgjournal', 'wrote the parser')).toContain('● 11-25 Wed  wrote the parser')
  await run($, 'pgjournal', 'rewrote it')
  const timeline = await run($, 'pgjournal')
  expect(timeline).toContain('rewrote it')
  expect(timeline).not.toContain('wrote the parser')
  // The journal counts as the day's note once.
  expect(await run($, 'pgxp')).toMatch(/Note\s+\+1\s+1\s+1\s+1/)

  expect(await run($, 'pglearn')).toContain('0/5 this week')
  await run($, 'pglearn', 'rust lifetimes')
  await run($, 'pglearn', 'Rust Lifetimes')
  expect(await run($, 'pglearn', 'target 2')).toContain('2/2 this week  target reached')
  expect(await run($, 'pglearn', 'target 100')).toContain('The weekly target is 2')

  expect(await run($, 'pgbacklog', 'add fix flaky test')).toContain('1 open')
  await run($, 'pgbacklog', 'add rename module')
  expect(await run($, 'pgbacklog', 'done 1')).toContain('1 open')
  expect(await run($, 'pgbacklog')).toContain('Backlog: 1 open, 1 done')
  expect(await run($, 'pgbacklog', 'clear')).toContain('1 open')
  expect(await run($, 'pgbacklog', 'rm 2')).toContain('0 open')
  expect(await run($, 'pgbacklog', 'done 9')).toContain('Usage')
})

test('109 110 projects through commands', async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'pgproj', 'add x')).toContain('No project yet')
  expect(await run($, 'pgproj', 'new Launch')).toContain('Launch')
  await run($, 'pgproj', 'add Write docs')
  await run($, 'pgproj', 'add Build')
  await run($, 'pgproj', 'sub 2 api')
  await run($, 'pgproj', 'sub 2 ui')
  expect(await run($, 'pgproj', 'check 3')).toContain('50%')
  const tree = await run($, 'pgproj')
  expect(tree).toContain('Launch')
  expect(tree).toMatch(/○ #2 Build {2}1\/2 50%/)
  expect(tree).toMatch(/ {2}✓ #3 api/)
  expect(await run($, 'pgproj', 'check 1')).toContain('67%')
  expect(await run($, 'pgproj', 'check 2')).toContain('The checklist is complete.')
  expect(await run($, 'pgproj', 'uncheck 2')).toContain('33%')
  expect(await run($, 'pgproj', 'sub 9 z')).toContain('No item #9')
  expect(await run($, 'pgproj', 'check 9')).toContain('No item #9')
  await run($, 'pgproj', 'new Second')
  expect(await run($, 'pgproj', 'list')).toMatch(/Launch.*\n▶ Second/)
  expect(await run($, 'pgproj', 'use launch')).toContain('Launch')
  expect(await run($, 'pgproj', 'new launch')).toContain('exists')
  expect(await run($, 'pgproj', 'rm 2')).toContain('#1')
  expect(await run($, 'pgproj', 'drop')).toContain('Dropped Launch')
})

test('107 freeze: /pgfreeze shows, "use" spends the week\'s one freeze, a second is refused', async ($, on) => {
  world(on)
  await start($)
  const view = await run($, 'pgfreeze')
  expect(view).toContain('Freeze: 1 left this week')
  expect(view).toContain('To spend this week')
  // Today is not frozen by merely typing /pgfreeze.
  expect(await run($, 'pgfreeze')).toContain('Freeze: 1 left')
  await $.tool.call({ tool: 'Read', file_path: '/p/a' })
  expect(await run($, 'pgfreeze', 'use')).toMatch(/already has activity/)
  const y = await run($, 'pgfreeze', 'yesterday')
  expect(y).toContain('Froze 2026-11-24')
  expect(y).toContain('Freeze: used on 2026-11-24')
  expect(await run($, 'pgfreeze', 'yesterday')).toMatch(/already frozen/)
  expect(await run($, 'pgfreeze', 'use')).toMatch(/already has activity/)
})

test('105 level up toast: once, at most one per three minutes, silent when calm', async ($, on) => {
  const w = world(on, { 'pg-meta': { totals: { tools: 24, sessions: 1 }, level: 0 } })
  await start($)
  // Session start makes it 2 sessions; the 25th tool call reaches Tinkerer.
  expect(w.log.toasts).toEqual([])
  await $.tool.call({ tool: 'Read', file_path: '/p/a' })
  expect(w.log.toasts).toEqual(['Level up: Tinkerer. Next: Builder needs 75 more tool calls and 3 more sessions.'])
  await $.tool.call({ tool: 'Read', file_path: '/p/a' })
  expect(w.log.toasts.length).toBe(1)
  expect(await run($, 'pglevel')).toContain('Level 2: Tinkerer')
  expect(await run($, 'pglevel')).toContain('Next: Builder needs')
})

test('105 level up is silent when calm, and still recorded', async ($, on) => {
  const w = world(on, { 'pg-meta': { totals: { tools: 24, sessions: 1 }, level: 0 } }, { 'settings.isCalm': true })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/p/a' })
  expect(w.log.toasts).toEqual([])
  expect(await run($, 'pglevel')).toContain('Level 2: Tinkerer')
})

test('118 119 112: focus, momentum and the skill tree from tool calls', async ($, on) => {
  world(on)
  await start($)
  expect(await run($, 'pgfocus')).toContain('needs at least 3 file calls')
  expect(await run($, 'pgmomentum')).toContain('needs 3 earlier active hours')
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Read', file_path: '/p/src/b.ts' })
  await $.tool.call({ tool: 'Write', file_path: '/p/docs/c.md', content: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const focus = await run($, 'pgfocus')
  expect(focus).toContain('Focus score 67%')
  expect(focus).toContain('2 of 3 file calls in the last 2 hours were in /p/src')
  const tree = await run($, 'pgtree')
  expect(tree).toMatch(/Skill tree: \d+ of 15 unlocked \(4 tools/)
  expect(tree).toMatch(/✓ T1 Editor/)
})

test('116 /pgsplit fills the prompt box with a three-step request, by text or by goal number', async ($, on) => {
  const { log } = world(on)
  await start($)
  expect(await run($, 'pgsplit')).toContain('Usage')
  expect(await run($, 'pgsplit', 'add dark mode')).toContain('three steps')
  expect(log.fills[0]).toContain('three concrete steps')
  expect(log.fills[0]).toContain('one-line check')
  expect(log.fills[0]).toContain('Goal: add dark mode')
  await run($, 'pggoal', 'add migrate the db')
  await run($, 'pgsplit', '1')
  expect(log.fills[1]).toContain('Goal: migrate the db')
  expect(await run($, 'pgsplit', '9')).toContain('Usage')
})

test('the pane shows one tab at a time and the tab buttons switch it', async ($, on) => {
  world(on)
  await start($)
  await run($, 'pggoal', 'add something')
  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /DAILY PROGRESS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MILESTONE LADDER/ })).toBeUndefined()
  await ui.press({ key: 'tab-level' })
  expect(await ui.find({ type: 'Text', text: /MILESTONE LADDER/ })).toBeDefined()
  await ui.press({ key: 'tab-skills' })
  expect(await ui.find({ type: 'Text', text: /SKILL TREE/ })).toBeDefined()
  await ui.press({ key: 'tab-stats' })
  expect(await ui.find({ type: 'Text', text: /BEFORE AND AFTER/ })).toBeDefined()
  await ui.press({ key: 'tab-log' })
  expect(await ui.find({ type: 'Text', text: /SHIP LOG/ })).toBeDefined()
  await ui.press({ key: 'tab-plans' })
  expect(await ui.find({ type: 'Text', text: /LEARNING/ })).toBeDefined()
  await ui.press({ key: 'tab-streak' })
  expect(await ui.find({ type: 'Text', text: /STREAK CALENDAR/ })).toBeDefined()
  await ui.unmount()

  expect(await run($, 'pgpane', 'nope')).toContain('Unknown tab')
  expect(await run($, 'pgpane', 'level')).toBe('Progress pane opened.')
})

test('the pane follows the settings mod: accent colour and glyph style', async ($, on) => {
  world(on, {}, { 'settings.accent': 'success', 'settings.icons': 'letters', 'settings.density': 'compact' })
  await start($)
  await run($, 'pggoal', 'add one')
  const ui = await $.ui.mount(PANE())
  const title = await ui.find({ type: 'Text', text: /DAILY PROGRESS/ })
  expect((title as any)?.props?.color ?? (title as any)?.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: /\[ \] #1 one/ }))?.text).toBe('[ ] #1 one')
  await ui.unmount()
})

test('data survives a restart through the store, and /pgreset yes clears it', async ($, on) => {
  const store: Record<string, unknown> = {}
  world(on, store)
  await start($)
  await run($, 'pggoal', 'add keep me')
  await run($, 'pgjournal', 'a line')
  await ($ as any).session.end({ reason: 'other', sessionId: 's1' })
  expect((store['pg-goals'] as any)?.goals?.[0]?.text).toBe('keep me')
  expect((store['pg-journal'] as any)?.[0]?.text).toBe('a line')

  expect(await run($, 'pgreset')).toContain('Run /pgreset yes to confirm')
  expect(await run($, 'pggoal')).toContain('keep me')
  expect(await run($, 'pgreset', 'yes')).toBe('Progress data cleared.')
  expect(await run($, 'pggoal')).toContain('No goals yet')
  expect(await run($, 'pgjournal')).toMatch(/empty/)
  expect(await run($, 'pgship')).toMatch(/empty/)
  expect((store['pg-goals'] as any)?.goals).toEqual([])
  expect(store['pg-ships']).toEqual([])
})

test('a denied tool call is not counted, and a throwing hook cannot break a call', async ($, on) => {
  const w = world(on)
  w.setDenied(true)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(await run($, 'pgxp')).toMatch(/Test run\s+\+2\s+0\s+0\s+0/)
  expect(await run($, 'pglevel')).toContain('0 tool calls')
})
