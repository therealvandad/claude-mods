import { expect, mock, test } from 'claude-code/testing'

import { CATALOG, LOOK_CHOICES } from './catalog'
import { CHANGELOG } from './changelog'
import { COOKIES, EGGS, SOUNDTRACKS, TOUR, VERSION, WARDROBE } from './data'
import {
  CLEAN_RUN,
  POSTCARDS,
  addSample,
  auditIsDue,
  auditIsOpen,
  boxLines,
  bumpHeat,
  cleanCounters,
  cleanGame,
  cleanHeat,
  cleanKind,
  cleanNotes,
  cookieAt,
  cookieIndex,
  crossed,
  dayIndex,
  dayKey,
  emptyCounters,
  emptyTrack,
  eggFor,
  heatByMod,
  hlGuess,
  hlNew,
  huntText,
  isNewerVersion,
  isUnlocked,
  isoWeek,
  lookOfWeek,
  memFlip,
  memNew,
  nextRand,
  onOff,
  parseFeedback,
  parseMood,
  pickCompliment,
  petPreview,
  postcardText,
  recommendText,
  recordTool,
  soundOfDay,
  soundtrackText,
  stepTrack,
  tourMove,
  typingStats,
  unusedMods,
  wardrobeText,
  weekKey,
} from './logic'
import type { Counters, Mem, ToolFact } from './logic'

const MIN = 60_000
const DAY = 86_400_000
// Local 10:00 on 25 Nov 2026, so day keys do not depend on the machine's zone.
const T0 = new Date(2026, 10, 25, 10, 0, 0).getTime()
const TODAY = dayKey(T0)

const fact = (over: Partial<ToolFact> = {}): ToolFact => ({ tool: 'Read', ok: true, command: '', path: '', ...over })

// ================================================================= pure logic

test('calendar: day keys, day index and ISO weeks are local and consecutive', async () => {
  expect(TODAY).toBe('2026-11-25')
  expect(dayIndex(T0 + DAY) - dayIndex(T0)).toBe(1)
  expect(isoWeek(new Date(2026, 0, 1, 12).getTime())).toEqual({ year: 2026, week: 1 })
  expect(isoWeek(new Date(2026, 11, 31, 12).getTime())).toEqual({ year: 2026, week: 53 })
  expect(weekKey(T0)).toBe('2026-W48')
})

test('181: the look of the week is stable inside a week and moves on in the next', async () => {
  const ids = LOOK_CHOICES.map(l => l.id)
  expect(ids.length).toBeGreaterThan(8)
  // Only looks /look can switch to: the day-phase palettes are not on the list.
  for (const phase of ['dawn', 'noon', 'dusk', 'night']) {
    expect(ids).not.toContain(phase)
  }
  expect(ids).toContain('nord')
  const a = lookOfWeek({ year: 2026, week: 48 }, ids)
  expect(a).toBe(lookOfWeek({ year: 2026, week: 48 }, ids))
  expect(a).not.toBe(lookOfWeek({ year: 2026, week: 49 }, ids))
  expect(lookOfWeek({ year: 2026, week: 1 }, [])).toBeUndefined()
  // Over the year every look comes up.
  const seen = new Set(Array.from({ length: 52 }, (_, i) => lookOfWeek({ year: 2026, week: i + 1 }, ids)))
  expect(seen.size).toBe(ids.length)
})

test('185: the sound of the day is one of the real packs and cycles', async () => {
  const d = dayIndex(T0)
  expect(['retro', 'wood', 'glass']).toContain(soundOfDay(d))
  expect(new Set([soundOfDay(d), soundOfDay(d + 1), soundOfDay(d + 2)]).size).toBe(3)
  expect(soundOfDay(d)).toBe(soundOfDay(d + 3))
})

test('186: soundtrack ideas are text only, by mood, with no links', async () => {
  expect(SOUNDTRACKS.length).toBeGreaterThanOrEqual(12)
  expect(parseMood('')).toBe('all')
  expect(parseMood('Calm')).toBe('calm')
  expect(parseMood('loud')).toBeUndefined()
  const text = soundtrackText('focus', 5)
  expect(text).toContain('[focus]')
  expect(text).not.toContain('[calm]')
  expect(text).toContain('Pick for today')
  expect(soundtrackText('all', 1)).not.toMatch(/https?:|www\./)
})

test('188: sixty distinct short cookies, a stable first one per day, then it steps on', async () => {
  expect(COOKIES.length).toBe(60)
  expect(new Set(COOKIES).size).toBe(60)

  for (const c of COOKIES) {
    expect(c.length).toBeGreaterThan(15)
    expect(c.length).toBeLessThanOrEqual(120)
  }
  const d = dayIndex(T0)
  expect(cookieAt(d, 0)).toBe(cookieAt(d, 0))
  expect(cookieAt(d, 0)).not.toBe(cookieAt(d, 1))
  expect(cookieAt(d, 0)).not.toBe(cookieAt(d + 1, 0))
  expect(cookieIndex(d, 60)).toBe(cookieIndex(d, 0))
  // Every cookie turns up over 60 days.
  expect(new Set(Array.from({ length: 60 }, (_, i) => cookieIndex(d + i, 0))).size).toBe(60)
})

test('counters: tool calls, edits, commits, tests, errors and active days', async () => {
  let c = emptyCounters()
  c = recordTool(c, fact({ tool: 'Edit', path: '/a.ts' }), '2026-11-25')
  c = recordTool(c, fact({ tool: 'Edit', ok: false, path: '/b.ts' }), '2026-11-25')
  c = recordTool(c, fact({ tool: 'Bash', command: 'git commit -m x' }), '2026-11-25')
  c = recordTool(c, fact({ tool: 'Bash', command: 'git -C . commit -m y', ok: false }), '2026-11-25')
  c = recordTool(c, fact({ tool: 'Bash', command: 'npm test' }), '2026-11-26')
  c = recordTool(c, fact({ tool: 'Bash', command: 'pytest -q', ok: false }), '2026-11-26')
  c = recordTool(c, fact({ tool: 'Bash', command: 'ls' }), '2026-11-26')
  expect(c).toMatchObject({ tools: 7, errors: 3, edits: 1, commits: 1, testsPassed: 1, testsFailed: 1, days: 2, firstDay: '2026-11-25', lastDay: '2026-11-26' })
  expect(c.byTool.Bash).toBe(5)
})

test('counters: per-tool names are bounded and junk in the store is cleaned', async () => {
  let c = emptyCounters()

  for (let i = 0; i < 60; i++) {
    c = recordTool(c, fact({ tool: `mcp__t${i}` }), TODAY)
  }
  expect(Object.keys(c.byTool).length).toBeLessThanOrEqual(25)
  expect(c.byTool.other).toBeGreaterThan(0)
  expect(c.tools).toBe(60)
  expect(cleanCounters('junk')).toEqual(emptyCounters())
  expect(cleanCounters({ tools: -5, errors: 'x', days: 2.7, byTool: { 'bad key!': 3, Bash: 4, Edit: 'no' } })).toMatchObject({ tools: 0, errors: 0, days: 2, byTool: { Bash: 4 } })
})

test('182: accessories unlock by your own counts and the preview is plain art', async () => {
  expect(new Set(WARDROBE.map(w => w.id)).size).toBe(WARDROBE.length)
  const none: Counters = emptyCounters()
  expect(WARDROBE.filter(w => isUnlocked(w, none)).length).toBe(0)
  const cap = WARDROBE.find(w => w.id === 'cap')!
  expect(isUnlocked(cap, { ...none, tools: 49 })).toBe(false)
  expect(isUnlocked(cap, { ...none, tools: 50 })).toBe(true)
  const text = wardrobeText({ ...none, tools: 60 }, 'cap')
  expect(text).toMatch(/\* cap/)
  expect(text).toMatch(/- glasses .*60\/200/)
  expect(text).toContain('personality')

  for (const w of [null, ...WARDROBE.map(x => x.id)]) {
    const art = petPreview(w)
    expect(art.length).toBeGreaterThanOrEqual(3)
    expect(art.length).toBeLessThanOrEqual(6)
    expect(art.every(l => l.length <= 14)).toBe(true)
  }
  expect(petPreview('cap').length).toBeGreaterThan(petPreview(null).length)
})

test('184: milestones are detected from tool calls and compliments are rare', async () => {
  // Tests going green after red.
  let t = emptyTrack()
  let r = stepTrack(t, fact({ tool: 'Bash', command: 'npm test', ok: false }), TODAY)
  expect(r.hits).toEqual([])
  r = stepTrack(r.track, fact({ tool: 'Bash', command: 'npm test', ok: false }), TODAY)
  r = stepTrack(r.track, fact({ tool: 'Bash', command: 'npm test' }), TODAY)
  expect(r.hits).toEqual([{ id: 'green-after-red', n: 2 }])
  // A pass with no red before is not a milestone.
  expect(stepTrack(emptyTrack(), fact({ tool: 'Bash', command: 'npm test' }), TODAY).hits).toEqual([])

  // 25 clean calls, once, and a failure starts the count again.
  t = emptyTrack()
  let hits = 0

  for (let i = 0; i < CLEAN_RUN + 5; i++) {
    r = stepTrack(t, fact(), TODAY)
    t = r.track
    hits += r.hits.filter(h => h.id === 'clean-run').length
  }
  expect(hits).toBe(1)
  expect(stepTrack({ ...t, okRun: 24 }, fact({ ok: false }), TODAY).track.okRun).toBe(0)

  // Ten distinct edited files, once; the same file twice counts once.
  t = emptyTrack()
  const ids: string[] = []

  for (let i = 0; i < 12; i++) {
    r = stepTrack(t, fact({ tool: 'Edit', path: `/f${i % 11}.ts` }), TODAY)
    t = r.track
    ids.push(...r.hits.map(h => h.id))
  }
  expect(ids).toEqual(['ten-files'])

  // First commit of the day only.
  r = stepTrack(emptyTrack(), fact({ tool: 'Bash', command: 'git commit -m a' }), TODAY)
  expect(r.hits).toEqual([{ id: 'first-commit', n: 1 }])
  expect(stepTrack(r.track, fact({ tool: 'Bash', command: 'git commit -m b' }), TODAY).hits).toEqual([])
  expect(stepTrack(r.track, fact({ tool: 'Bash', command: 'git commit -m b' }), '2026-11-26').hits.length).toBe(1)
})

test('184: at most one compliment a day, and each kind at most once a week', async () => {
  const a = { id: 'first-commit', n: 1 } as const
  const b = { id: 'clean-run', n: 25 } as const
  expect(pickCompliment([a, b], { lastDay: '', last: {} }, TODAY)).toEqual(a)
  expect(pickCompliment([a, b], { lastDay: TODAY, last: { 'first-commit': TODAY } }, TODAY)).toBeUndefined()
  // Yesterday's was a commit one: the clean run is eligible, the commit is cooling down.
  expect(pickCompliment([a, b], { lastDay: '2026-11-24', last: { 'first-commit': '2026-11-24' } }, TODAY)).toEqual(b)
  expect(pickCompliment([a], { lastDay: '2026-11-18', last: { 'first-commit': '2026-11-18' } }, TODAY)).toEqual(a)
  expect(pickCompliment([], { lastDay: '', last: {} }, TODAY)).toBeUndefined()
  expect(cleanKind({ lastDay: 5, last: { 'bad key': 'x', ok: '2026-01-01' } })).toEqual({ lastDay: '', last: { ok: '2026-01-01' } })
})

test('187: postcards at 100, 1000 and 10000, drawn in a box of equal-width lines', async () => {
  expect([...POSTCARDS]).toEqual([100, 1000, 10000])
  expect(crossed(99, 100)).toEqual([100])
  expect(crossed(100, 101)).toEqual([])
  expect(crossed(90, 1500)).toEqual([100, 1000])
  expect(crossed(0, 20000)).toEqual([100, 1000, 10000])

  for (const t of POSTCARDS) {
    const lines = postcardText(t, { tools: t, days: 9, top: 'Bash (50)', date: TODAY })
    expect(new Set(lines.map(l => l.length)).size).toBe(1)
    expect(lines.join('\n')).toContain(t.toLocaleString('en-US'))
    expect(lines.join('\n')).toContain('Bash (50)')
  }
  const box = boxLines('A very long title that has to be cut to fit', ['x'.repeat(80)], 20)
  expect(new Set(box.map(l => l.length)).size).toBe(1)
  expect(box[0]!.startsWith('╔')).toBe(true)
})

test('190: typing speed from draft growth, ignoring pauses and pastes', async () => {
  expect(typingStats([])).toEqual({ cpm: 0, chars: 0, activeMs: 0 })
  let s: { at: number; len: number }[] = []

  for (let i = 0; i <= 30; i++) {
    s = addSample(s, { at: T0 + i * 200, len: i })
  }
  expect(typingStats(s)).toMatchObject({ cpm: 300, chars: 30, activeMs: 6000 })
  // Too little data for a fair number.
  expect(typingStats(s.slice(0, 4)).cpm).toBe(0)
  // A long pause between edits is not typing time.
  expect(typingStats([{ at: 0, len: 0 }, { at: 10_000, len: 5 }]).chars).toBe(0)
  // A paste of 100 characters is ignored.
  expect(typingStats([{ at: 0, len: 0 }, { at: 100, len: 100 }, { at: 2500, len: 112 }]).chars).toBe(12)
  // Deleting never counts as negative speed.
  expect(typingStats([{ at: 0, len: 20 }, { at: 1000, len: 10 }, { at: 2500, len: 5 }]).cpm).toBe(0)
  // Bounded memory.
  let big: { at: number; len: number }[] = []

  for (let i = 0; i < 500; i++) {
    big = addSample(big, { at: i, len: i })
  }
  expect(big.length).toBe(120)
})

test('191: five hidden words, each a one-line piece of art', async () => {
  expect(EGGS.length).toBe(5)
  expect(new Set(EGGS.map(e => e.word)).size).toBe(5)

  for (const e of EGGS) {
    expect(/^[a-z]+$/.test(e.word)).toBe(true)
    expect(e.art.includes('\n')).toBe(false)
    expect(e.art.length).toBeGreaterThan(20)
    expect(eggFor(e.word)).toBe(e)
  }
  expect(eggFor('nope')).toBeUndefined()
  expect(huntText({})).toContain('0 of 5')
  const found = huntText({ xyzzy: 1, meow: 2 })
  expect(found).toContain('2 of 5')
  expect(found).toContain('found: /dlxyzzy')
  // A found word is never spelled again as a hint, and a hidden one is not spelled at all.
  expect(found).not.toContain('plugh')
})

test('194: the tour has seven steps in order and Next/Back stay in range', async () => {
  expect(TOUR.map(s => s.cmd)).toEqual(['/cockpit', '/anim lab', '/look', '/sound', '/pet', '/motion', '/cheats'])
  expect(tourMove(0, 'back')).toBe(0)
  expect(tourMove(0, 'next')).toBe(1)
  expect(tourMove(6, 'next')).toBe(6)
  expect(tourMove(6, 'back')).toBe(5)
  let n = 0

  for (let i = 0; i < 20; i++) {
    n = tourMove(n, 'next')
  }
  expect(n).toBe(6)
})

test('195: version comparison for the what-is-new card', async () => {
  expect(isNewerVersion('', '0.1.0')).toBe(true)
  expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false)
  expect(isNewerVersion('0.1.0', '0.1.1')).toBe(true)
  expect(isNewerVersion('0.9.0', '0.10.0')).toBe(true)
  expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
  expect(VERSION).toBe('0.1.0')
})

test('196: feedback parsing and cleaning', async () => {
  expect(parseFeedback('looks the paper look is too warm')).toEqual({ mod: 'looks', text: 'the paper look is too warm' })
  expect(parseFeedback('/Motion   keep   it calm')).toEqual({ mod: 'motion', text: 'keep it calm' })
  expect(parseFeedback('looks')).toHaveProperty('error')
  expect(parseFeedback('')).toHaveProperty('error')
  expect((parseFeedback(`x ${'a'.repeat(900)}`) as { text: string }).text.length).toBe(400)
  expect(cleanNotes([{ mod: 'a', text: 'b', at: 1 }, { mod: '', text: 'x', at: 2 }, 'junk'])).toEqual([{ mod: 'a', text: 'b', at: 1 }])
})

test('197/198: command heat is bounded, by name only, rolled up per mod', async () => {
  let h = {}
  h = bumpHeat(h, 'look', 100)
  h = bumpHeat(h, 'look', 101)
  h = bumpHeat(h, 'pet', 100)
  h = bumpHeat(h, 'bad name with spaces', 100)
  h = bumpHeat(h, '', 100)
  expect(h).toEqual({ look: { n: 2, last: 101 }, pet: { n: 1, last: 100 } })

  let big = {}

  for (let i = 0; i < 300; i++) {
    big = bumpHeat(big, `c${i}`, i)
  }
  expect(Object.keys(big).length).toBe(200)
  expect(Object.keys(big)).toContain('c299')
  expect(Object.keys(big)).not.toContain('c0')
  expect(cleanHeat({ ok: { n: 3, last: 5 }, 'bad key!': { n: 1, last: 1 }, x: 'y' })).toEqual({ ok: { n: 3, last: 5 } })

  const mods = [
    { name: 'looks', commands: ['look'] },
    { name: 'personality', commands: ['fun', 'pet'] },
    { name: 'quiet', commands: ['qq'] },
    { name: 'nocmd', commands: [] },
  ]
  expect(heatByMod({ look: { n: 2, last: 1 }, pet: { n: 5, last: 1 }, other: { n: 1, last: 1 } }, mods)).toEqual([
    { label: 'personality', n: 5 },
    { label: 'looks', n: 2 },
    { label: 'other', n: 1 },
  ])

  // 14 days: used yesterday is fine, used 20 days ago is not, never used is not.
  const heat = { look: { n: 1, last: 199 }, pet: { n: 1, last: 180 } }
  expect(unusedMods(heat, mods, 200, 100)).toEqual({ names: ['personality', 'quiet'], daysTracked: 101, isProvisional: false })
  expect(unusedMods({ ...heat, fun: { n: 1, last: 190 } }, mods, 200, 100).names).toEqual(['quiet'])
  expect(unusedMods({ pet: { n: 1, last: 180 } }, mods, 200, 100).names).toEqual(['looks', 'personality', 'quiet'])
  // Only three days of data: provisional, and it says so.
  const young = unusedMods({}, mods, 200, 198)
  expect(young).toMatchObject({ daysTracked: 3, isProvisional: true })
  expect(recommendText(young, m => (m === 'looks' ? 'look' : undefined))).toContain('provisional')
  expect(recommendText(young, m => (m === 'looks' ? 'look' : undefined))).toContain('looks  (try /look)')
  expect(recommendText(unusedMods({}, mods, 200, 0), () => undefined)).toContain('/dltrack on')
})

test('199: the weekly card is due once a week, until answered', async () => {
  expect(auditIsDue(false, '2026-W48', '', [])).toBe(false)
  expect(auditIsDue(true, '2026-W48', '', [])).toBe(true)
  expect(auditIsDue(true, '2026-W48', '2026-W48', [])).toBe(false)
  expect(auditIsDue(true, '2026-W48', '2026-W47', [])).toBe(true)
  expect(auditIsDue(true, '2026-W48', '', [{ week: '2026-W48', answer: 'helped', at: 1 }])).toBe(false)
  expect(auditIsOpen(true, '2026-W48', [])).toBe(true)
  expect(auditIsOpen(true, '2026-W48', [{ week: '2026-W48', answer: 'annoyed', at: 1 }])).toBe(false)
  expect(auditIsOpen(false, '2026-W48', [])).toBe(false)
})

test('183: higher/lower is deterministic, counts streaks, and a tie changes nothing', async () => {
  expect(nextRand(1)).toEqual(nextRand(1))
  const a = hlNew(42)
  expect(a.card).toBeGreaterThanOrEqual(1)
  expect(a.card).toBeLessThanOrEqual(13)
  expect(hlNew(42)).toEqual(a)

  // Play 200 rounds always guessing the right way: the streak only ever grows, ties are free.
  let g = hlNew(7)

  for (let i = 0; i < 200; i++) {
    const [v] = nextRand(g.seed)
    const next = 1 + Math.floor(v * 13)
    const before = g
    g = hlGuess(g, next >= g.card ? 'higher' : 'lower')
    expect(g.card).toBe(next)

    if (next === before.card) {
      expect(g.last).toBe('same')
      expect(g.streak).toBe(before.streak)
    } else {
      expect(g.last).toBe('win')
      expect(g.streak).toBe(before.streak + 1)
    }
  }
  expect(g.best).toBe(g.streak)
  expect(g.rounds).toBe(200)

  // A wrong guess resets the streak but keeps the best.
  const [v] = nextRand(g.seed)
  const next = 1 + Math.floor(v * 13)

  if (next !== g.card) {
    const lost = hlGuess(g, next > g.card ? 'lower' : 'higher')
    expect(lost).toMatchObject({ last: 'lose', streak: 0, best: g.best })
  }
})

const playMem = (m: Mem): Mem => {
  // The honest way: flip the first hidden card, then find its twin.
  let s = m

  while (!s.done) {
    const first = s.matched.findIndex((x, i) => !x && !s.up[i])
    s = memFlip(s, first)
    const twin = s.cards.findIndex((c, i) => i !== first && c === s.cards[first] && !s.matched[i])
    s = memFlip(s, twin)
  }

  return s
}

test('183: memory 3x3 has four pairs and a free star, turns mismatches back and can be solved', async () => {
  const m = memNew(99)
  expect(m.cards.length).toBe(9)
  expect(m.cards[4]).toBe('★')
  expect(m.matched[4]).toBe(true)
  expect(m.up[4]).toBe(true)
  expect(memNew(99)).toEqual(m)
  expect(memNew(100).cards.join('')).not.toBe(m.cards.join(''))

  for (const sym of new Set(m.cards.filter(c => c !== '★'))) {
    expect(m.cards.filter(c => c === sym).length).toBe(2)
  }

  // A mismatch: both stay up until the next press, then both turn back.
  const wrong = m.cards.findIndex((c, i) => i !== 4 && c !== m.cards[0] && i !== 0)
  let s = memFlip(m, 0)
  s = memFlip(s, wrong)
  expect(s.moves).toBe(1)
  expect(s.picks).toEqual([0, wrong])
  expect(s.up[0] && s.up[wrong]).toBe(true)
  const third = s.cards.findIndex((_, i) => i !== 0 && i !== wrong && i !== 4)
  s = memFlip(s, third)
  expect(s.up[0]).toBe(false)
  expect(s.up[wrong]).toBe(false)
  expect(s.up[third]).toBe(true)
  // Pressing a matched card, the same card twice or an out-of-range one does nothing.
  expect(memFlip(m, 4)).toBe(m)
  expect(memFlip(m, 12)).toBe(m)
  expect(memFlip(memFlip(m, 0), 0).moves).toBe(0)

  const done = playMem(m)
  expect(done.done).toBe(true)
  expect(done.moves).toBeGreaterThanOrEqual(4)
  expect(done.best).toBe(done.moves)
  expect(memFlip(done, 0)).toBe(done)
  expect(cleanGame(JSON.parse(JSON.stringify(done)))).toEqual(done)
  const hl = hlGuess(hlNew(5), 'higher')
  expect(cleanGame(JSON.parse(JSON.stringify(hl)))).toEqual(hl)
  expect(cleanGame({ kind: 'mem', cards: ['a'] })).toBeNull()
  expect(cleanGame('x')).toBeNull()
})

test('misc: on/off words', async () => {
  expect(onOff('ON')).toBe(true)
  expect(onOff(' off ')).toBe(false)
  expect(onOff('maybe')).toBeUndefined()
})

test('193/200: the catalog was built from the real mod folders, and the changelog covers them all', async () => {
  const names = CATALOG.map(m => m.name)
  expect(new Set(names).size).toBe(names.length)
  expect(names).toEqual(expect.arrayContaining(['personality', 'looks', 'motion', 'sound-pack', 'cockpit', 'delight']))

  for (const m of CATALOG) {
    expect(m.description.length).toBeGreaterThan(10)
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/)

    if (m.help !== null) {
      expect(m.commands.map(c => c.name)).toContain(m.help)
    }
    // The hidden easter-egg words never appear in the gallery.
    for (const e of EGGS) {
      expect(m.commands.map(c => c.name)).not.toContain(`dl${e.word}`)
    }
  }
  expect(CATALOG.find(m => m.name === 'personality')?.help).toBe('fun')
  expect(CATALOG.find(m => m.name === 'delight')?.commands.length).toBeGreaterThan(15)
  // 200: every mod in the gallery has a changelog entry and the other way round.
  expect(CHANGELOG.map(e => e.mod).sort()).toEqual([...names].sort())

  for (const e of CHANGELOG) {
    expect(e.summary.length).toBeGreaterThan(10)
    expect(e.lines.length).toBeGreaterThan(0)
  }
})

// ============================================================== the mod itself

const PANE = {
  plugin: 'delight',
  component: 'Pane',
  requestId: 'delight-main',
  surface: 'desktop',
  props: {
    title: 'Delight',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type Log = { toasts: { text: string; at: number }[]; registered: string[]; filled: string[]; opened: string[]; commands: string[] }

const engine = (on: any, init: Record<string, unknown> = {}, now = T0) => {
  const saved: Record<string, unknown> = { ...init }
  const log: Log = { toasts: [], registered: [], filled: [], opened: [], commands: [] }
  const clock = mock.clock(on, { now })
  on('command.register', (_: unknown, e: { name: string }) => {
    log.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    log.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    log.toasts.push({ text: e.text, at: clock.now() })

    return { value: undefined }
  })
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    log.filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete saved[e.key]

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('prompt.edit', (_: unknown, e: { text: string; inputText: string }) => ({ text: e.text + e.inputText, cursor: e.text.length + e.inputText.length }))
  // The engine's own commands: another mod's command answers with an empty line.
  on('command.run', (_: unknown, e: { command: string }) => {
    log.commands.push(e.command)

    return { text: '' }
  })
  let fail = false
  on('tool.call', () => (fail ? { result: {}, isError: true } : { result: {} }))

  return {
    saved,
    log,
    clock,
    failNext: (v: boolean) => {
      fail = v
    },
  }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args, origin: 'user' })) as { text: string }).text
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text)
const tool = ($: any, input: Record<string, unknown>) => $.tool.call(input)
const edit = ($: any, input: Record<string, unknown>) => $.prompt.edit(input)
const bash = ($: any, command: string) => tool($, { tool: 'Bash', command })

test('every command starts with dl, is registered once, and /dl lists all but the hidden ones', async ($, on) => {
  const { log } = engine(on)
  await start($)

  expect(log.registered.length).toBeGreaterThanOrEqual(28)
  expect(new Set(log.registered).size).toBe(log.registered.length)

  for (const name of log.registered) {
    expect(name.startsWith('dl')).toBe(true)
  }
  const help = await run($, 'dl')

  for (const name of log.registered) {
    if (EGGS.some(e => `dl${e.word}` === name)) {
      expect(help).not.toContain(`/${name} `)
    } else {
      expect(help).toContain(`/${name} `)
    }
  }
  for (const e of EGGS) {
    expect(log.registered).toContain(`dl${e.word}`)
  }
  expect(help).toContain('off')
})

test('everything is off by default: tool calls, commands and typing record nothing, and no toast appears', async ($, on) => {
  const { saved, log, clock } = engine(on)
  await start($)

  for (let i = 0; i < 120; i++) {
    await tool($, { tool: 'Edit', file_path: `/p/f${i}.ts` })
  }
  await bash($, 'git commit -m x')
  await run($, 'look', 'nord')
  await edit($, { origin: { kind: 'composer' }, text: 'abc', cursor: 3, start: 3, end: 3, inputText: 'd' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await clock.advance(10 * MIN)

  expect(log.toasts).toEqual([])
  expect(saved.counters).toBeUndefined()
  expect(saved.heat).toBeUndefined()
  expect(saved.flags).toBeUndefined()
  expect(await run($, 'dltrack')).toContain('Counting is off')
  expect(await run($, 'dlkind')).toContain('Compliments is off')
  expect(await run($, 'dltype')).toContain('typing meter is off')
  expect(await run($, 'dlaudit')).toContain('check-in is off')
})

test('/dltrack on counts tool calls, and the 100th one brings a postcard, once', async ($, on) => {
  const { saved, log, clock } = engine(on)
  await start($)
  expect(await run($, 'dltrack', 'on')).toContain('Counting is on')

  for (let i = 0; i < 99; i++) {
    await tool($, { tool: 'Read', file_path: '/a' })
  }
  expect(log.toasts).toEqual([])
  await tool($, { tool: 'Edit', file_path: '/a.ts' })
  expect(log.toasts.map(t => t.text)).toEqual(['Postcard unlocked: 100 tool calls. /dlcard shows it.'])
  await clock.advance(MIN)
  await tool($, { tool: 'Read', file_path: '/a' })

  expect(log.toasts.length).toBe(1)
  expect((saved.counters as Counters).tools).toBe(101)
  expect((saved.counters as Counters).edits).toBe(1)
  expect(Object.keys(saved.cards as object)).toEqual(['100'])
  const card = await run($, 'dlcard')
  expect(card).toContain('Postcard 1 of 3')
  expect(card).toContain('100 tool calls')
  expect(card).toContain('Read (99)')
  // Both of the others are still ahead.
  expect(await run($, 'dlcard', '1000')).toContain('Postcard 1 of 3')

  await run($, 'dltrack', 'off')
  await tool($, { tool: 'Read', file_path: '/a' })
  expect((saved.counters as Counters).tools).toBe(101)
})

test('toasts from this mod are at least three minutes apart', async ($, on) => {
  const { log, clock } = engine(on, { flags: { track: true, kind: false, type: false, audit: true } })
  await start($)
  // The check-in hint used the gap at session start; the postcard has to wait for the next free slot.
  expect(log.toasts.map(t => t.text)).toEqual(['Weekly check-in is ready: /dlpane notes'])

  for (let i = 0; i < 100; i++) {
    await tool($, { tool: 'Read', file_path: '/a' })
  }
  expect(log.toasts.length).toBe(1)
  await clock.advance(3 * MIN + 1)
  await tool($, { tool: 'Read', file_path: '/a' })
  // A postcard is not re-sent after a missed slot: it waits in /dlcard.
  expect(log.toasts.length).toBe(1)
  expect(await run($, 'dlcard')).toContain('Postcard 1 of 3')
})

test('184: /dlkind on gives one compliment after tests go green, then none that day', async ($, on) => {
  const { saved, log, failNext, clock } = engine(on)
  await start($)
  const msg = await run($, 'dlkind', 'on')
  expect(msg).toContain('Compliments are on')
  expect(msg).toContain('/dltrack is on now too')
  expect((saved.flags as { track: boolean }).track).toBe(true)

  failNext(true)
  await bash($, 'npm test')
  await bash($, 'npm test')
  failNext(false)
  await bash($, 'npm test')

  expect(log.toasts.length).toBe(1)
  expect(log.toasts[0]!.text).toContain('green after 2 red runs')
  expect(log.toasts[0]!.text).toContain('/dlkind off')
  expect((saved.kind as { lastDay: string }).lastDay).toBe(TODAY)

  // A second milestone the same day, long after the gap: nothing.
  await clock.advance(10 * MIN)
  await bash($, 'git commit -m done')
  await clock.advance(10 * MIN)
  await tool($, { tool: 'Read', file_path: '/a' })
  expect(log.toasts.length).toBe(1)

  // Next day the commit milestone of that session is gone with the session; a new one is fine.
  await clock.advance(DAY)
  await start($)
  await bash($, 'git commit -m next')
  expect(log.toasts.length).toBe(2)
  expect(log.toasts[1]!.text).toContain('First commit of the day')

  await run($, 'dlkind', 'off')
  await clock.advance(DAY)
  await start($)
  await bash($, 'git commit -m again')
  expect(log.toasts.length).toBe(2)
})

test('/dltrack off also switches compliments off', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'dlkind', 'on')
  await run($, 'dltrack', 'off')
  expect((saved.flags as { kind: boolean; track: boolean })).toMatchObject({ kind: false, track: false })
})

test('197/198: heat counts command names only, per mod, and recommends from 14 days', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'dltrack', 'on')
  await run($, 'look', 'nord')
  await run($, 'look', 'paper')
  await run($, 'fun', 'on')
  await run($, 'dlcookie')

  // The /dltrack on that switched counting on is not itself counted; everything after it is.
  expect(Object.keys(saved.heat as object).sort()).toEqual(['dlcookie', 'fun', 'look'])
  expect((saved.heat as Record<string, { n: number }>).look!.n).toBe(2)
  // Arguments are never stored.
  expect(JSON.stringify(saved)).not.toContain('nord')
  expect(JSON.stringify(saved)).not.toContain('paper')

  const heat = await run($, 'dlheat')
  expect(heat).toContain('looks')
  expect(heat).toContain('personality')

  // Only just started: provisional.
  const rec = await run($, 'dlrecommend')
  expect(rec).toContain('provisional')
  expect(rec).toContain('motion')
  expect(rec).not.toContain('looks  ')
})

test('198: after 14 tracked days the list is no longer provisional', async ($, on) => {
  const today = dayIndex(T0)
  engine(on, {
    flags: { track: true, kind: false, type: false, audit: false },
    meta: { trackSince: today - 20 },
    heat: { look: { n: 4, last: today - 1 }, pet: { n: 1, last: today - 30 } },
  })
  await start($)
  const rec = await run($, 'dlrecommend')

  expect(rec).not.toContain('provisional')
  expect(rec).toContain('Based on the last 14 days')
  expect(rec).toContain('personality')
  expect(rec).not.toMatch(/\n {2}looks\b/)
})

test('193: the gallery lists every mod and a button fills the prompt with its help command', async ($, on) => {
  const { log } = engine(on)
  await start($)
  expect(await run($, 'dlgallery')).toContain('Gallery opened')
  expect(log.opened).toContain('delight-main')

  const ui = await $.ui.mount(PANE)
  const all = (await texts(ui)).join('\n')

  for (const m of CATALOG) {
    expect(all).toContain(m.name)
  }
  expect(all).toContain('cannot be checked at runtime')
  await ui.press({ key: 'gal-personality' })
  await ui.press({ key: 'gal-looks' })
  expect(log.filled).toEqual(['/fun', '/look'])
  await ui.unmount()
})

test('194: the tour walks seven steps with Next and Back and fills each command', async ($, on) => {
  const { log } = engine(on)
  await start($)
  await run($, 'dltour')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^1\. The cockpit$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'tour-back' })).toBeUndefined()

  for (let i = 2; i <= 7; i++) {
    await ui.press({ key: 'tour-next' })
    expect(await ui.find({ type: 'Text', text: new RegExp(`^${i}\\. `) })).toBeDefined()
  }
  expect(await ui.find({ type: 'Button', key: 'tour-next' })).toBeUndefined()
  await ui.press({ key: 'tour-try' })
  expect(log.filled).toEqual(['/cheats'])
  await ui.press({ key: 'tour-back' })
  expect(await ui.find({ type: 'Text', text: /^6\. The motion switch$/ })).toBeDefined()
  await ui.press({ key: 'tour-next' })
  await ui.press({ key: 'tour-done' })
  expect(await ui.find({ type: 'Text', text: /^1\. The cockpit$/ })).toBeDefined()
  await ui.unmount()
  expect(await run($, 'dltour', '3')).toContain('Tour 3 of 7: Looks')
})

test('181/185/188: week look fills the prompt, sound of the day only prints, cookies step on', async ($, on) => {
  const { log } = engine(on)
  await start($)
  const week = await run($, 'dlweek')
  expect(log.filled.length).toBe(1)
  expect(log.filled[0]).toMatch(/^\/look [a-z-]+$/)
  expect(week).toContain(`Look of week ${isoWeek(T0).week}`)
  expect(week).toContain('cannot apply a look itself')
  expect(LOOK_CHOICES.map(l => `/look ${l.id}`)).toContain(log.filled[0])

  const sound = await run($, 'dlsound')
  expect(sound).toMatch(/Run \/sound (retro|wood|glass) /)
  expect(log.filled.length).toBe(1)

  const first = await run($, 'dlcookie')
  const second = await run($, 'dlcookie')
  expect(first).toContain(cookieAt(dayIndex(T0), 0))
  expect(second).toContain(cookieAt(dayIndex(T0), 1))
  expect(await run($, 'dlmusic', 'late')).toContain('[late]')
  expect(await run($, 'dlmusic', 'loud')).toContain('Moods:')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-today' })
  await ui.press({ key: 'fill-look' })
  await ui.press({ key: 'fill-sound' })
  expect(log.filled.length).toBe(3)
  expect(log.filled[2]).toMatch(/^\/sound (retro|wood|glass)$/)
  await ui.press({ key: 'cookie-next' })
  await ui.unmount()
})

test('182: the wardrobe is locked until you count, then previews in the pane and by command', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  expect(await run($, 'dlwear', 'cap')).toContain('Counting is off')
  expect(await run($, 'dlwear', 'nothing')).toContain('No accessory')
  await run($, 'dltrack', 'on')

  for (let i = 0; i < 50; i++) {
    await tool($, { tool: 'Read', file_path: '/a' })
  }
  const worn = await run($, 'dlwear', 'cap')
  expect(worn).toContain('Preview only')
  expect(saved.wear).toBe('cap')
  expect(await run($, 'dlwear', 'glasses')).toContain('locked: 50 of 200')
  expect(await run($, 'dlwear', 'list')).toMatch(/\* cap/)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-pet' })
  expect(await ui.find({ type: 'Button', key: 'wear-cap' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'wear-glasses' })).toBeUndefined()
  await ui.press({ key: 'wear-none' })
  expect(saved.wear).toBeNull()
  await ui.press({ key: 'wear-cap' })
  expect(saved.wear).toBe('cap')
  await ui.unmount()
  expect(await run($, 'dlwear', 'none')).toContain('Preview only')
  expect(saved.wear).toBeNull()
})

test('183: both games are played with buttons and survive in the store', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-games' })
  expect((await texts(ui)).join('\n')).toContain('Pick a game')

  await ui.press({ key: 'start-hl' })
  expect((saved.game as { kind: string }).kind).toBe('hl')
  const before = (saved.game as { rounds: number }).rounds
  await ui.press({ key: 'hl-higher' })
  expect((saved.game as { rounds: number }).rounds).toBe(before + 1)
  await ui.press({ key: 'hl-lower' })
  expect((saved.game as { rounds: number }).rounds).toBe(before + 2)

  await ui.press({ key: 'start-mem' })
  expect((saved.game as { kind: string }).kind).toBe('mem')
  const m = saved.game as Mem
  await ui.press({ key: 'mem-0' })
  expect((saved.game as Mem).up[0]).toBe(true)
  const twin = m.cards.findIndex((c, i) => i !== 0 && c === m.cards[0])
  await ui.press({ key: `mem-${twin}` })
  expect((saved.game as Mem).matched[0]).toBe(true)
  expect((saved.game as Mem).moves).toBe(1)
  // The star is not pressable into anything.
  await ui.press({ key: 'mem-4' })
  expect((saved.game as Mem).moves).toBe(1)

  await ui.press({ key: 'stop' })
  expect(saved.game).toBeNull()
  await ui.unmount()

  expect(await run($, 'dlgame', 'higher')).toContain('Higher or lower: card')
  expect(await run($, 'dlgame', 'memory')).toContain('Memory: 0 moves')
  expect(await run($, 'dlgame', 'chess')).toContain('Usage')
  expect(await run($, 'dlgame', 'stop')).toBe('Game stopped.')
})

test('191: each easter egg prints one line of art, counts once, and the hunt keeps score', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  expect(await run($, 'dlhunt')).toContain('0 of 5')
  const out = await run($, 'dlxyzzy')
  expect(out).toContain(EGGS[0]!.art)
  expect(out).toContain('Egg 1 of 5')
  expect(await run($, 'dlxyzzy')).toContain('Found again (1 of 5)')

  for (const e of EGGS.slice(1)) {
    expect(await run($, `dl${e.word}`)).toContain(e.art)
  }
  expect(Object.keys(saved.eggs as object).sort()).toEqual(EGGS.map(e => e.word).sort())
  expect(await run($, 'dlhunt')).toContain('5 of 5')
})

test('189: the retro tab is a box-drawn readout and says honestly that it cannot recolour the app', async ($, on) => {
  const { log } = engine(on)
  await start($)
  expect(await run($, 'dlretro')).toContain('cannot recolour the app')
  const ui = await $.ui.mount(PANE)
  const all = await texts(ui)
  expect(all.some(t => t.startsWith('╔'))).toBe(true)
  expect(all.some(t => t.startsWith('╚'))).toBe(true)
  expect(all.join('\n')).toContain('COUNTING OFF')
  expect(all.join('\n')).toContain('cannot recolour the rest of the')
  await ui.press({ key: 'retro-look' })
  expect(log.filled).toEqual(['/look terminal'])
  await ui.unmount()
})

test('190: the typing meter is off until asked, then reads growth between edits', async ($, on) => {
  const { clock, saved } = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-type' })
  expect((await texts(ui)).join('\n')).toContain('Off.')
  expect(await run($, 'dltype', 'on')).toContain('never what it says')

  let text = ''

  for (let i = 0; i < 31; i++) {
    await edit($, { origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: 'x' })
    text += 'x'
    await clock.advance(200)
  }
  expect(await run($, 'dltype')).toContain('Now 300 characters a minute, best 300')
  expect((saved.meta as { typingBest: number }).typingBest).toBe(300)
  expect(await ui.find({ type: 'Text', text: /^300 cpm$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^60 wpm$/ })).toBeDefined()

  // Sending the prompt starts the next draft fresh.
  await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
  expect(await run($, 'dltype')).toContain('Now 0 characters a minute')
  await ui.press({ key: 'type-toggle' })
  expect((saved.flags as { type: boolean }).type).toBe(false)
  await ui.unmount()
})

test('199: the weekly card has helped/annoyed buttons, is hinted once and answered once', async ($, on) => {
  const { saved, log } = engine(on)
  await start($)
  expect(log.toasts).toEqual([])
  expect(await run($, 'dlaudit', 'on')).toContain('Weekly check-in on')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-notes' })
  expect(await ui.find({ type: 'Button', key: 'audit-helped' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'audit-annoyed' })).toBeDefined()
  await ui.press({ key: 'audit-annoyed' })
  expect(saved.audits).toEqual([{ week: weekKey(T0), answer: 'annoyed', at: T0 }])
  expect(await ui.find({ type: 'Button', key: 'audit-helped' })).toBeUndefined()
  expect((await texts(ui)).join('\n')).toContain('is answered (annoyed)')
  await ui.unmount()
})

test('199: a new week brings the card back, with one toast at the next session start', async ($, on) => {
  const { log, clock } = engine(on, { flags: { track: false, kind: false, type: false, audit: true }, audits: [{ week: '2026-W47', answer: 'helped', at: 1 }] })
  await start($)
  expect(log.toasts.map(t => t.text)).toEqual(['Weekly check-in is ready: /dlpane notes'])
  await clock.advance(10 * MIN)
  await start($)
  expect(log.toasts.length).toBe(1)
})

test('196: notes are saved, listed, filtered and deleted', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  expect(await run($, 'dlfeedbacks')).toContain('No notes yet')
  expect(await run($, 'dlfeedback', 'looks')).toContain('Usage')
  expect(await run($, 'dlfeedback', 'looks the paper look is too warm')).toContain('Saved note 1 about looks')
  expect(await run($, 'dlfeedback', 'nosuchmod hello')).toContain('No mod by that name')
  expect((saved.notes as unknown[]).length).toBe(2)
  const list = await run($, 'dlfeedbacks')
  expect(list).toContain('[looks] the paper look is too warm')
  expect(list).toContain(TODAY)
  expect(await run($, 'dlfeedbacks', 'looks')).not.toContain('nosuchmod')
  expect(await run($, 'dlfeedbacks', 'del 1')).toBe('Deleted note 1.')
  expect((saved.notes as { mod: string }[]).map(n => n.mod)).toEqual(['nosuchmod'])
  expect(await run($, 'dlfeedbacks', 'del 9')).toContain('No note 9')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-notes' })
  expect((await texts(ui)).join('\n')).toContain('hello')
  await ui.unmount()
})

test('195: the what-is-new card shows once per version', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  const first = await run($, 'dlnew')
  expect(first).toContain(`What is new in delight ${VERSION}`)
  expect(saved.meta).toMatchObject({ seenVersion: VERSION })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-log' })
  expect(await ui.find({ type: 'Button', key: 'new-ok' })).toBeDefined()
  await ui.press({ key: 'new-ok' })
  expect(await ui.find({ type: 'Button', key: 'new-ok' })).toBeUndefined()
  await ui.unmount()
  expect(await run($, 'dlnew')).toContain('already seen')
})

test('195: a stored older version brings the card back', async ($, on) => {
  engine(on, { meta: { seenVersion: '0.0.9' } })
  await start($)
  expect(await run($, 'dlnew')).toContain('What is new')
})

test('200: the changelog pane and command cover every mod in plain words', async ($, on) => {
  engine(on)
  await start($)
  const list = await run($, 'dlchangelog')
  expect(list).toContain(`${CHANGELOG.length} mods`)
  const one = await run($, 'dlchangelog', '/looks')
  expect(one).toContain('looks 0.1.0')
  expect(one).toContain('Start with: /look')
  expect(await run($, 'dlchangelog', 'nope')).toContain('No changelog entry')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-log' })
  const all = (await texts(ui)).join('\n')

  for (const e of CHANGELOG) {
    expect(all).toContain(e.summary)
  }
  await ui.unmount()
})

test('/dlreset clears everything and puts every switch back off', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'dltrack', 'on')
  await run($, 'dlkind', 'on')
  await run($, 'dlaudit', 'on')
  await run($, 'dlxyzzy')
  await run($, 'dlfeedback', 'looks note')
  await run($, 'dlgame', 'higher')
  await tool($, { tool: 'Read', file_path: '/a' })
  expect(Object.keys(saved).length).toBeGreaterThan(4)

  expect(await run($, 'dlreset')).toContain('cleared')
  expect(Object.keys(saved)).toEqual([])
  expect(await run($, 'dltrack')).toContain('Counting is off')
  expect(await run($, 'dlhunt')).toContain('0 of 5')
  expect(await run($, 'dlfeedbacks')).toContain('No notes yet')
  await tool($, { tool: 'Read', file_path: '/a' })
  expect(saved.counters).toBeUndefined()
})

test('the pane draws every tab on every surface without trouble', async ($, on) => {
  engine(on)
  await start($)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    for (const id of ['gallery', 'today', 'tour', 'pet', 'games', 'cards', 'retro', 'type', 'heat', 'notes', 'log']) {
      await ui.press({ key: `tab-${id}` })
      expect((await texts(ui)).length).toBeGreaterThan(1)
    }
    await ui.unmount()
  }
})

test('/dlpane opens a named tab and the aliases work', async ($, on) => {
  const { log } = engine(on)
  await start($)
  expect(await run($, 'dlpane', 'wardrobe')).toContain('pet')
  expect(await run($, 'dlpane', 'typing')).toContain('type')
  expect(await run($, 'dlpane', 'zzz')).toContain('Tabs:')
  expect(log.opened.filter(id => id === 'delight-main').length).toBe(2)
})
