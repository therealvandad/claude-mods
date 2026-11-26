import { expect, test } from 'claude-code/testing'

import {
  AGAIN_MS,
  DAY,
  addArch,
  archTree,
  barOf,
  boxCounts,
  buildPrompt,
  dayKey,
  dueCards,
  extOf,
  formatDue,
  makeCard,
  nextDueAt,
  nextSchedule,
  parseCard,
  parseRead,
  parseTerm,
  putProjectTerm,
  readingByTopic,
  searchTerms,
  shouldNudge,
  standingSections,
  topCounts,
  touchSkills,
  upsertTerm,
  weekKey,
  DEFAULT_FLAGS,
} from './logic'

const NOON = new Date(2026, 10, 25, 12, 30).getTime() // Wed 25 Nov 2026, local

test('knew it climbs a box and waits longer each time, again resets to minutes', () => {
  let card = makeCard('a', 'q', 'a', NOON)
  const days: number[] = []

  for (let i = 0; i < 7; i++) {
    card = nextSchedule(card, true, NOON)
    days.push(Math.round((card.due - NOON) / DAY))
  }
  expect(days).toEqual([1, 2, 4, 8, 16, 16, 16])
  expect(card.box).toBe(5)
  expect(card.seen).toBe(7)

  const again = nextSchedule(card, false, NOON)
  expect(again.box).toBe(0)
  expect(again.due).toBe(NOON + AGAIN_MS)
})

test('due cards come oldest first and the next due time ignores cards already due', () => {
  const a = { ...makeCard('a', 'q', 'a', NOON - 2000), due: NOON - 1000 }
  const b = { ...makeCard('b', 'q', 'a', NOON - 3000), due: NOON - 5000 }
  const c = { ...makeCard('c', 'q', 'a', NOON), due: NOON + 3 * DAY }
  const d = { ...makeCard('d', 'q', 'a', NOON), due: NOON + DAY }

  expect(dueCards([a, b, c, d], NOON).map(x => x.id)).toEqual(['b', 'a'])
  expect(nextDueAt([a, b, c, d], NOON)).toBe(NOON + DAY)
  expect(nextDueAt([a], NOON)).toBeNull()
  expect(boxCounts([a, { ...b, box: 3 }, { ...c, box: 99 }])).toEqual([1, 0, 0, 1, 0, 1])
})

test('due labels read naturally', () => {
  expect(formatDue(NOON - 1, NOON)).toBe('due now')
  expect(formatDue(NOON + 5 * 60_000, NOON)).toBe('in 5m')
  expect(formatDue(NOON + 3 * 3_600_000, NOON)).toBe('in 3h')
  expect(formatDue(NOON + 4 * DAY, NOON)).toBe('in 4d')
})

test('the daily nudge fires once a day, only when something is due and it is on', () => {
  expect(shouldNudge(3, true, '2026-11-24', '2026-11-25')).toBe(true)
  expect(shouldNudge(3, true, '2026-11-25', '2026-11-25')).toBe(false)
  expect(shouldNudge(0, true, '', '2026-11-25')).toBe(false)
  expect(shouldNudge(3, false, '', '2026-11-25')).toBe(false)
})

test('argument parsers', () => {
  expect(parseTerm('closure = a function plus its scope')).toEqual({ term: 'closure', def: 'a function plus its scope' })
  expect(parseTerm('a = b = c')).toEqual({ term: 'a', def: 'b = c' })
  expect(parseTerm('no equals')).toBeNull()
  expect(parseTerm('x =')).toBeNull()
  expect(parseCard('What is O(1)? | Constant time')).toEqual({ q: 'What is O(1)?', a: 'Constant time' })
  expect(parseCard('only a question')).toBeNull()
  expect(parseRead('Rust book https://doc.rust-lang.org/book #rust')).toEqual({
    title: 'Rust book',
    url: 'https://doc.rust-lang.org/book',
    topic: 'rust',
  })
  expect(parseRead('#Go Tour of Go https://go.dev/tour')?.topic).toBe('go')
  expect(parseRead('https://x.dev')?.title).toBe('https://x.dev')
  expect(parseRead('no url here')).toBeNull()
})

test('glossary: upsert replaces by name ignoring case, search matches definitions, caps hold', () => {
  let list = upsertTerm([], 'Closure', 'one', 1, 3)
  list = upsertTerm(list, 'closure', 'two', 2, 3)
  expect(list).toEqual([{ term: 'closure', def: 'two', at: 2 }])
  list = upsertTerm(list, 'b', 'bee', 3, 3)
  list = upsertTerm(list, 'c', 'sea', 4, 3)
  list = upsertTerm(list, 'd', 'dee', 5, 3)
  expect(list.map(t => t.term)).toEqual(['b', 'c', 'd'])
  expect(searchTerms(list, 'SEA').map(t => t.term)).toEqual(['c'])
})

test('project glossaries are keyed by folder and the number of folders is bounded', () => {
  let all: Record<string, ReturnType<typeof upsertTerm>> = {}
  all = putProjectTerm(all, '/a', 'x', 'in a', 1)
  all = putProjectTerm(all, '/b', 'x', 'in b', 2)
  expect(all['/a']?.[0]?.def).toBe('in a')
  expect(all['/b']?.[0]?.def).toBe('in b')

  for (let i = 0; i < 60; i++) {
    all = putProjectTerm(all, `/p${i}`, 't', 'd', 100 + i)
  }
  expect(Object.keys(all).length).toBe(40)
  expect(all['/p59']).toBeDefined()
  expect(all['/a']).toBeUndefined()
})

test('the architecture tree nests folders first and shows descriptions', () => {
  let list = addArch([], './src/app/main.ts/', 'entry point', 10)
  list = addArch(list, 'src/lib', 'helpers', 10)
  list = addArch(list, 'README.md', 'docs', 10)
  list = addArch(list, 'src/app/main.ts', 'the entry', 10)
  expect(archTree(list)).toEqual([
    '├── src/',
    '│   ├── app/',
    '│   │   └── main.ts  - the entry',
    '│   └── lib  - helpers',
    '└── README.md  - docs',
  ])
  expect(addArch(list, '  / ', 'x', 10)).toBe(list)
  expect(addArch(list, 'a', 'x', 3).length).toBe(3)
})

test('weeks start on Monday and extensions are read from paths', () => {
  expect(weekKey(NOON)).toBe('2026-11-23')
  expect(weekKey(new Date(2026, 10, 29, 23, 0).getTime())).toBe('2026-11-23') // Sunday
  expect(weekKey(new Date(2026, 10, 30, 0, 30).getTime())).toBe('2026-11-30') // next Monday
  expect(dayKey(NOON)).toBe('2026-11-25')
  expect(extOf('/a/b/Main.TS')).toBe('.ts')
  expect(extOf('/a/.gitignore')).toBe('.gitignore')
  expect(extOf('/a/Dockerfile')).toBe('dockerfile')
  expect(extOf('/a/LICENSE')).toBe('')
  expect(extOf('/a/trailing.')).toBe('')
})

test('skill counters add up per week, only count file types for file tools, and stay bounded', () => {
  let weeks = touchSkills({}, 'Edit', '/a/x.ts', NOON)
  weeks = touchSkills(weeks, 'Edit', '/a/y.ts', NOON)
  weeks = touchSkills(weeks, 'Read', '/a/z.py', NOON)
  weeks = touchSkills(weeks, 'Bash', '/not/a/file.rs', NOON)
  const week = weeks['2026-11-23']
  expect(week?.tools).toEqual({ Edit: 2, Read: 1, Bash: 1 })
  expect(week?.ext).toEqual({ '.ts': 2, '.py': 1 })

  for (let i = 0; i < 60; i++) {
    weeks = touchSkills(weeks, `mcp__t${i}`, undefined, NOON)
  }
  expect(Object.keys(weeks['2026-11-23']?.tools ?? {}).length).toBeLessThanOrEqual(41)
  expect(weeks['2026-11-23']?.tools.other).toBeGreaterThan(0)

  let long = {}
  for (let w = 0; w < 20; w++) {
    long = touchSkills(long, 'Read', undefined, NOON + w * 7 * DAY)
  }
  expect(Object.keys(long).length).toBe(12)
  expect(topCounts({ a: 1, b: 3, c: 3 }, 2)).toEqual([['b', 3], ['c', 3]])
  expect(barOf(5, 10, 10)).toBe('█████░░░░░')
  expect(barOf(0, 0, 4)).toBe('░░░░')
})

test('reading list groups by topic in name order', () => {
  const item = (id: string, topic: string) => ({ id, title: id, url: 'https://x', topic, isDone: false, at: 0 })
  const groups = readingByTopic([item('1', 'rust'), item('2', 'go'), item('3', 'rust')])
  expect(groups.map(([t, l]) => [t, l.length])).toEqual([['go', 1], ['rust', 2]])
})

test('prompt fillers use the optional subject and never send anything', () => {
  expect(buildPrompt('eli5')).toBe('Explain your last answer simply, with an everyday analogy.')
  expect(buildPrompt('walk', 'src/a.ts')).toMatch(/Walk me through src\/a\.ts step by step, one block at a time/)
  expect(buildPrompt('walk')).toMatch(/the code you just wrote/)
  expect(buildPrompt('quiz')).toMatch(/three questions/)
  expect(buildPrompt('alt')).toMatch(/two other ways/)
  expect(buildPrompt('diff')).toMatch(/one-line reason/)
  expect(buildPrompt('cardgen', 'closures')).toMatch(/\/lncard <question> \| <answer>/)
})

test('standing instructions appear only for switches that are on', () => {
  expect(standingSections(DEFAULT_FLAGS)).toEqual([])
  const ids = standingSections({ ...DEFAULT_FLAGS, mentor: true, beginner: true }).map(s => s.id)
  expect(ids).toEqual(['learning:mentor', 'learning:beginner'])
})
