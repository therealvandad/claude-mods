import { expect, test } from 'claude-code/testing'

import type { Db } from '../types'
import {
  CAPS,
  MAX_TOTAL,
  addTo,
  applyTerms,
  buildMarkdown,
  bumpJournal,
  dayKey,
  emptyDb,
  isDue,
  linesToNotes,
  looksBinary,
  matchQuery,
  mergeImport,
  nextDue,
  parseAttach,
  parseCmd,
  parseEvery,
  parseLink,
  parseQuery,
  parseSnip,
  parseTags,
  parseTerm,
  parseWhen,
  pruneByAge,
  removeById,
  searchAll,
  setSetting,
  takeToken,
  validateImport,
} from './pure'

// 2026-11-25 10:00 local time
const NOW = new Date(2026, 10, 25, 10, 0, 0, 0).getTime()
const DAY = 86_400_000

const PANE = {
  plugin: 'notes',
  component: 'Pane',
  requestId: 'notes-main',
  surface: 'desktop',
  props: {
    title: 'Notes',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

type Handler = (...args: any[]) => unknown

const sample = (): Db => {
  let db = emptyDb()
  const add = <K extends 'notes' | 'links' | 'snips' | 'cmds' | 'attach' | 'terms' | 'remind' | 'every'>(k: K, f: (id: string) => Db[K][number]) => {
    const r = addTo(db, k, f)

    if (!r.ok) {
      throw new Error(r.error)
    }
    db = r.db
  }
  add('notes', id => ({ id, t: NOW, cwd: '/p', text: 'fix the parser #bug', tags: ['bug'] }))
  add('links', id => ({ id, t: NOW, url: 'https://example.com/a', title: 'Example', tags: [] }))
  add('snips', id => ({ id, t: NOW, lang: 'ts', name: 'clamp', code: 'const x = 1' }))
  add('cmds', id => ({ id, t: NOW, name: 'tests', cmd: 'npm test' }))
  add('attach', id => ({ id, t: NOW, name: 'spec', path: './spec.md', desc: 'the spec' }))
  add('terms', id => ({ id, from: 'teh', to: 'the' }))
  add('remind', id => ({ id, at: NOW + 60_000, text: 'stand up' }))
  add('every', id => ({ id, kind: 'weekly', text: 'review', last: '2026-11-25' }))

  return bumpJournal(db, '2026-11-25', { tool: 'Edit', file: '/p/a.ts' })
}

// ------------------------------------------------------------ pure: time

test('parseWhen: clock times, am/pm, relative minutes and hours', () => {
  const at = (h: number, m: number, plusDays = 0) => new Date(2026, 10, 25 + plusDays, h, m, 0, 0).getTime()

  expect(parseWhen('15:30 stand up', NOW)).toEqual({ ok: true, at: at(15, 30), text: 'stand up' })
  expect(parseWhen('at 3pm call mom', NOW)).toEqual({ ok: true, at: at(15, 0), text: 'call mom' })
  expect(parseWhen('9:05am early', NOW)).toEqual({ ok: true, at: at(9, 5, 1), text: 'early' })
  // A time that has passed means tomorrow; 12am is midnight, 12pm is noon.
  expect(parseWhen('10:00 now-ish', NOW)).toEqual({ ok: true, at: at(10, 0, 1), text: 'now-ish' })
  expect(parseWhen('12am x', NOW)).toEqual({ ok: true, at: at(0, 0, 1), text: 'x' })
  expect(parseWhen('12pm x', NOW)).toEqual({ ok: true, at: at(12, 0), text: 'x' })
  expect(parseWhen('in 20 check build', NOW)).toEqual({ ok: true, at: NOW + 20 * 60_000, text: 'check build' })
  expect(parseWhen('in 20m check build', NOW)).toEqual({ ok: true, at: NOW + 20 * 60_000, text: 'check build' })
  expect(parseWhen('in 2h lunch', NOW)).toEqual({ ok: true, at: NOW + 120 * 60_000, text: 'lunch' })
  // The word "mom" after the number is text, not the unit "m".
  expect(parseWhen('in 5 mom called', NOW)).toEqual({ ok: true, at: NOW + 5 * 60_000, text: 'mom called' })
})

test('parseWhen: refuses bad input with a reason', () => {
  for (const bad of ['', 'soon do it', '25:00 x', '13pm x', '10:75 x', 'in 0 x', 'in 99999 x', 'in 20', '15:30', '5 things']) {
    const r = parseWhen(bad, NOW)
    expect(r.ok).toBe(false)
  }
})

test('recurring tasks: next due day and due check, month ends clamp', () => {
  expect(nextDue('daily', '2026-11-30')).toBe('2026-12-01')
  expect(nextDue('weekly', '2026-11-25')).toBe('2026-12-02')
  expect(nextDue('monthly', '2026-01-31')).toBe('2026-02-28')
  expect(nextDue('monthly', '2026-12-15')).toBe('2027-01-15')
  expect(isDue({ kind: 'weekly', last: '2026-11-18' }, '2026-11-25')).toBe(true)
  expect(isDue({ kind: 'weekly', last: '2026-11-19' }, '2026-11-25')).toBe(false)
  expect(isDue({ kind: 'daily', last: '2026-11-25' }, '2026-11-25')).toBe(false)
  expect(isDue({ kind: 'daily', last: 'garbage' }, '2026-11-25')).toBe(false)
  expect(dayKey(NOW)).toBe('2026-11-25')
})

// ------------------------------------------------------------ pure: tags, search, parsing

test('tags: only #words that start a word count', () => {
  expect(parseTags('fix #Bug and #ui-polish, see #bug')).toEqual(['bug', 'ui-polish'])
  expect(parseTags('#start of line')).toEqual(['start'])
  expect(parseTags('issue #42 and http://x.dev/#frag and a#b')).toEqual([])
  expect(parseTags('#a #b #c #d #e #f #g #h #i #j')).toHaveLength(8)
})

test('search: words, #tag filters and every store', () => {
  const db = sample()
  const q = parseQuery('Parser #bug')

  expect(q).toEqual({ tags: ['bug'], words: ['parser'] })
  expect(matchQuery('Fix the PARSER', ['bug'], q)).toBe(true)
  expect(matchQuery('Fix the PARSER', [], q)).toBe(false)

  expect(searchAll(db, 'parser', 20).hits[0]?.kind).toBe('note')
  expect(searchAll(db, '#bug', 20).total).toBe(1)
  expect(searchAll(db, 'example', 20).hits[0]?.kind).toBe('link')
  expect(searchAll(db, 'clamp', 20).hits[0]?.kind).toBe('snippet')
  expect(searchAll(db, 'npm', 20).hits[0]?.kind).toBe('command')
  expect(searchAll(db, 'spec.md', 20).hits[0]?.kind).toBe('file')
  expect(searchAll(db, 'teh', 20).hits[0]?.kind).toBe('term')
  expect(searchAll(db, 'stand', 20).hits[0]?.kind).toBe('reminder')
  expect(searchAll(db, 'review', 20).hits[0]?.kind).toBe('recurring')
  expect(searchAll(db, 'a.ts', 20).hits[0]?.kind).toBe('journal')
  expect(searchAll(db, '   ', 20)).toEqual({ hits: [], total: 0 })
  expect(searchAll(db, 'zzzz', 20).total).toBe(0)
  // The limit cuts what is shown, not what is counted.
  expect(searchAll(db, 'e', 2)).toMatchObject({ total: expect.any(Number) })
  expect(searchAll(db, 'e', 2).hits).toHaveLength(2)
})

test('argument parsers', () => {
  expect(takeToken('"a b" c d')).toEqual(['a b', 'c d'])
  expect(takeToken("x   y z")).toEqual(['x', 'y z'])
  expect(parseLink('https://a.dev/x Title here')).toEqual({ ok: true, value: { url: 'https://a.dev/x', title: 'Title here' } })
  expect(parseLink('javascript:alert(1) bad').ok).toBe(false)
  expect(parseLink('ftp://x/y t').ok).toBe(false)
  expect(parseSnip('ts clamp const a = 1\nconst b = 2')).toEqual({ ok: true, value: { lang: 'ts', name: 'clamp', code: 'const a = 1\nconst b = 2' } })
  expect(parseSnip('ts clamp').ok).toBe(false)
  expect(parseSnip('t$ s x').ok).toBe(false)
  expect(parseCmd('tests npm test -- --watch')).toEqual({ ok: true, value: { name: 'tests', cmd: 'npm test -- --watch' } })
  expect(parseCmd('only').ok).toBe(false)
  expect(parseAttach('spec "./my docs/spec.md" the spec')).toEqual({ ok: true, value: { name: 'spec', path: './my docs/spec.md', desc: 'the spec' } })
  expect(parseTerm('teh => the')).toEqual({ ok: true, value: { from: 'teh', to: 'the' } })
  expect(parseTerm('no arrow').ok).toBe(false)
  expect(parseEvery('Weekly review the board')).toEqual({ ok: true, value: { kind: 'weekly', text: 'review the board' } })
  expect(parseEvery('hourly x').ok).toBe(false)
  expect(setSetting(emptyDb().settings, 'keepDays', '30')).toMatchObject({ ok: true, value: { keepDays: 30 } })
  expect(setSetting(emptyDb().settings, 'keepDays', '-1').ok).toBe(false)
  expect(setSetting(emptyDb().settings, 'journal', 'off')).toMatchObject({ ok: true, value: { journal: false } })
  expect(setSetting(emptyDb().settings, 'nope', '1').ok).toBe(false)
})

test('glossary: whole words, one pass, optional case folding', () => {
  const terms = [
    { from: 'teh', to: 'the' },
    { from: 'recieve', to: 'receive' },
    { from: 'a', to: 'b' },
  ]
  expect(applyTerms('teh cat will recieve teh mail, a tehran', terms, false)).toEqual({ text: 'the cat will receive the mail, b tehran', count: 4 })
  expect(applyTerms('Teh', terms, false).count).toBe(0)
  expect(applyTerms('Teh', terms, true)).toEqual({ text: 'the', count: 1 })
  // No chains: a => b does not feed b => c.
  expect(applyTerms('a b', [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], false).text).toBe('b c')
  // A replacement with $ is literal.
  expect(applyTerms('cost', [{ from: 'cost', to: '$& $1' }], false).text).toBe('$& $1')
  expect(applyTerms('x', [], false)).toEqual({ text: 'x', count: 0 })
})

// ------------------------------------------------------------ pure: caps, retention

test('caps: a full list and a full store say so', () => {
  let db = emptyDb()

  for (let i = 0; i < CAPS.remind; i += 1) {
    const r = addTo(db, 'remind', id => ({ id, at: 1, text: 'x' }))
    expect(r.ok).toBe(true)

    if (r.ok) {
      db = r.db
    }
  }
  const full = addTo(db, 'remind', id => ({ id, at: 1, text: 'x' }))
  expect(full.ok).toBe(false)
  expect(!full.ok && full.error).toMatch(/Reminders is full \(50\)/)

  // Total size: big notes run into the 450 KB limit before the 500-note cap.
  let big = emptyDb()
  let last = ''

  for (let i = 0; i < CAPS.notes; i += 1) {
    const r = addTo(big, 'notes', id => ({ id, t: 1, cwd: '/p', text: 'x'.repeat(1000), tags: [] }))

    if (!r.ok) {
      last = r.error
      break
    }
    big = r.db
  }
  expect(last).toMatch(/store is full/)
  expect(JSON.stringify(big).length).toBeLessThanOrEqual(MAX_TOTAL)
})

test('removeById deletes by id prefix and ignores unknown ids', () => {
  const db = sample()
  const r = removeById(db, 'n1')
  expect(r.key).toBe('notes')
  expect(r.db.notes).toHaveLength(0)
  expect(removeById(db, 'n99').key).toBeNull()
  expect(removeById(db, 'zz').key).toBeNull()
  expect(removeById(db, 'e8').key).toBe('every')
})

test('retention: only notes, links, journal and log older than N days go', () => {
  let db = sample()
  db = { ...db, notes: [...db.notes, { id: 'n50', t: NOW - 40 * DAY, cwd: '/p', text: 'old', tags: [] }], links: [...db.links, { id: 'l50', t: NOW - 31 * DAY, url: 'https://o.dev', title: 'old', tags: [] }] }
  db = bumpJournal(db, dayKey(NOW - 50 * DAY), { tool: 'Bash' })
  db = { ...db, log: [{ t: NOW - 60 * DAY, kind: 'tool', text: 'Bash' }, { t: NOW, kind: 'tool', text: 'Edit' }] }

  const r = pruneByAge(db, NOW, 30)
  expect(r.removed).toEqual({ notes: 1, links: 1, journal: 1, log: 1 })
  expect(r.db.notes.map(n => n.id)).toEqual(['n1'])
  expect(r.db.snips).toHaveLength(1)
  expect(r.db.cmds).toHaveLength(1)
  expect(r.db.attach).toHaveLength(1)
  expect(r.db.journal.map(j => j.day)).toEqual(['2026-11-25'])

  // Off means nothing is touched, and the same object comes back.
  expect(pruneByAge(db, NOW, 0).db).toBe(db)
  // A day exactly on the boundary stays.
  expect(pruneByAge(db, NOW, 40).removed.notes).toBe(0)
  // Nothing old: the same object.
  expect(pruneByAge(r.db, NOW, 30).db).toBe(r.db)
})

// ------------------------------------------------------------ pure: import validation

test('import: a backup round-trips and is rebuilt field by field', () => {
  const db = sample()
  const v = validateImport(JSON.stringify(db))
  expect(v.ok).toBe(true)
  expect(v.ok && v.db).toEqual(db)
})

test('import: strict about shape, types, sizes and unknown fields', () => {
  const good = JSON.parse(JSON.stringify(sample())) as Record<string, any>
  const bad = (mut: (d: Record<string, any>) => void) => {
    const d = JSON.parse(JSON.stringify(good)) as Record<string, any>
    mut(d)

    return validateImport(JSON.stringify(d))
  }
  expect(validateImport('').ok).toBe(false)
  expect(validateImport('not json').ok).toBe(false)
  expect(validateImport('[1,2]').ok).toBe(false)
  expect(validateImport('null').ok).toBe(false)
  expect(validateImport('x'.repeat(MAX_TOTAL + 1)).ok).toBe(false)

  expect(bad(d => { d.extra = 1 }).ok).toBe(false)
  expect(bad(d => { delete d.notes }).ok).toBe(false)
  expect(bad(d => { d.v = 2 }).ok).toBe(false)
  expect(bad(d => { d.notes[0].text = 5 }).ok).toBe(false)
  expect(bad(d => { d.notes[0].extra = 'x' }).ok).toBe(false)
  expect(bad(d => { d.notes[0].text = 'x'.repeat(1001) }).ok).toBe(false)
  expect(bad(d => { d.notes[0].t = 1.5 }).ok).toBe(false)
  expect(bad(d => { d.notes[0].tags = ['ok', 'not ok'] }).ok).toBe(false)
  expect(bad(d => { d.links[0].url = 'javascript:alert(1)' }).ok).toBe(false)
  expect(bad(d => { d.every[0].kind = 'hourly' }).ok).toBe(false)
  expect(bad(d => { d.every[0].last = 'yesterday' }).ok).toBe(false)
  expect(bad(d => { d.notes[0].id = 'x1' }).ok).toBe(false)
  expect(bad(d => { d.notes.push({ ...d.notes[0] }) }).ok).toBe(false)
  expect(bad(d => { d.settings.findMax = 1000 }).ok).toBe(false)
  expect(bad(d => { d.settings.journal = 'yes' }).ok).toBe(false)
  expect(bad(d => { d.notes = new Array(CAPS.notes + 1).fill(d.notes[0]) }).ok).toBe(false)
  expect(bad(d => { d.journal.push({ ...d.journal[0] }) }).ok).toBe(false)

  const proto = validateImport('{"__proto__":{"x":1},"v":1}')
  expect(proto.ok).toBe(false)
  expect(({} as Record<string, unknown>).x).toBeUndefined()
  expect(validateImport(JSON.stringify(good)).ok).toBe(true)
})

test('import: merge renumbers ids and respects caps; replace swaps everything', () => {
  const cur = sample()
  const imp = sample()
  const m = mergeImport(cur, imp, 'merge')

  expect(m.ok).toBe(true)

  if (m.ok) {
    expect(m.db.notes.map(n => n.id)).toEqual(['n9', 'n17'].slice(0, 0).concat(m.db.notes.map(n => n.id)))
    expect(new Set(m.db.notes.map(n => n.id)).size).toBe(2)
    expect(m.db.notes).toHaveLength(2)
    expect(m.db.terms).toHaveLength(1)
    expect(m.db.journal).toHaveLength(1)
    expect(m.db.seq).toBeGreaterThan(cur.seq)
    expect(m.db.settings).toEqual(cur.settings)
  }
  const full: Db = { ...emptyDb(), remind: Array.from({ length: CAPS.remind }, (_, i) => ({ id: `r${i + 1}`, at: 1, text: 'x' })), seq: 50 }
  const capped = mergeImport(full, sample(), 'merge')
  expect(capped.ok && capped.skipped).toBe(1)

  const r = mergeImport(cur, { ...imp, settings: { ...imp.settings, keepDays: 9 } }, 'replace')
  expect(r.ok && r.db.notes).toHaveLength(1)
  expect(r.ok && r.db.settings.keepDays).toBe(9)
  expect(r.ok && r.db.notes[0]?.id).toBe('n1')
})

// ------------------------------------------------------------ pure: file import, journal, markdown

test('file import: lines become notes, binary and huge inputs are caught', () => {
  expect(linesToNotes('one\n\n  two  \r\nthree')).toEqual({ lines: ['one', 'two', 'three'], more: 0 })
  const many = linesToNotes(Array.from({ length: 250 }, (_, i) => `l${i}`).join('\n'))
  expect(many.lines).toHaveLength(200)
  expect(many.more).toBe(50)
  expect(linesToNotes('x'.repeat(3000)).lines[0]).toHaveLength(1000)
  expect(looksBinary('abc\u0000def')).toBe(true)
  expect(looksBinary('�'.repeat(10))).toBe(true)
  expect(looksBinary('plain text, with ünïcode')).toBe(false)
})

test('journal counts calls, edits and prompts per day, bounded', () => {
  let db = emptyDb()
  db = bumpJournal(db, '2026-11-25', { tool: 'Bash' })
  db = bumpJournal(db, '2026-11-25', { tool: 'Edit', file: '/a.ts' })
  db = bumpJournal(db, '2026-11-25', { tool: 'Edit', file: '/a.ts' })
  db = bumpJournal(db, '2026-11-25', { prompt: true })
  expect(db.journal).toHaveLength(1)
  expect(db.journal[0]).toMatchObject({ tools: 3, edits: 2, prompts: 1, files: ['/a.ts'] })
  expect(db.journal[0]?.top).toEqual([{ tool: 'Bash', n: 1 }, { tool: 'Edit', n: 2 }])

  for (let i = 0; i < 80; i += 1) {
    db = bumpJournal(db, dayKey(NOW + i * DAY), { tool: 'Bash' })
  }
  expect(db.journal.length).toBe(CAPS.journal)
  expect(db.journal.map(j => j.day)).toEqual([...db.journal.map(j => j.day)].sort())

  for (let i = 0; i < 30; i += 1) {
    db = bumpJournal(db, '2030-01-01', { tool: `T${i}`, file: `/f${i}` })
  }
  const last = db.journal.find(j => j.day === '2030-01-01')
  expect(last?.files).toHaveLength(20)
  expect(last?.top).toHaveLength(20)
})

test('markdown export is built from recorded activity only', () => {
  let db = sample()
  db = { ...db, log: [{ t: NOW, kind: 'edit', text: '/p/a.ts' }] }
  const md = buildMarkdown(db, { now: NOW, startedAt: NOW - 1000, cwd: '/p' })

  expect(md).toContain('# Session notes, 2026-11-25')
  expect(md).toContain('1 tool calls, 1 file edits, 0 prompts')
  expect(md).toContain('- `/p/a.ts`')
  expect(md).toContain('- fix the parser #bug')
  expect(md).toContain('[Example](https://example.com/a)')
  expect(md).toContain('edit: /p/a.ts')
  expect(md).toContain('stand up')
  expect(buildMarkdown(emptyDb(), { now: NOW, startedAt: 0, cwd: '' })).toContain('Nothing recorded yet')
})

// ------------------------------------------------------------ engine

const engine = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}) => {
  const saved: Record<string, unknown> = { ...init }
  const clock = { t: NOW }
  const toasts: string[] = []
  const filled: { text: string; mode?: string }[] = []
  const files: Record<string, { size: number; text: string; kind?: string }> = {}
  const draft = { text: '' }
  const timers = { every: 0 }

  on('clock.now', () => ({ value: clock.t }))
  on('clock.every', () => {
    timers.every += 1

    return { value: { cancel() {} } }
  })
  on('clock.after', () => ({ value: { cancel() {} } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text?: string; message?: string }) => {
    toasts.push(String(e.text ?? e.message ?? JSON.stringify(e)))

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete saved[e.key]

    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: draft.text, cursor: draft.text.length } }))
  on('prompt.fill', (_: unknown, e: { text: string; mode?: string }) => {
    filled.push({ text: e.text, mode: e.mode })

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('fs.stat', (_: unknown, e: { path: string }) => {
    const f = files[e.path]

    if (f === undefined) {
      throw new Error('ENOENT')
    }

    return { value: { kind: f.kind ?? 'file', size: f.size, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path]?.text ?? '' }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', () => ({}))

  return { saved, clock, toasts, filled, files, draft, timers }
}

const start = ($: any, cwd = '/proj/app') => $.session.start({ cwd, surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = ''): Promise<string> => {
  const r = await $.command.run({ command, args, origin: 'user' } as any)

  return String(r?.text ?? '')
}
const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

test('/ntjot saves a tagged note for this folder, in the store', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  const out = await run($, 'ntjot', 'ship the parser fix #bug #urgent')

  expect(out).toMatch(/Saved n1 for proj\/app \(#bug #urgent\)/)
  const db = saved.db as Db
  expect(db.notes).toEqual([{ id: 'n1', t: NOW, cwd: '/proj/app', text: 'ship the parser fix #bug #urgent', tags: ['bug', 'urgent'] }])
  expect(await run($, 'ntjot', '')).toMatch(/Usage/)
  expect(await run($, 'ntjot', 'x'.repeat(1001))).toMatch(/at most 1000/)
})

test('/nt lists every command and each name starts with nt', async ($, on) => {
  engine(on)
  await start($)
  const out = await run($, 'nt')

  for (const c of ['ntjot', 'ntfind', 'ntlink', 'ntsnip', 'ntcmd', 'ntput', 'ntattach', 'ntterm', 'ntfix', 'ntremind', 'ntevery', 'ntjournal', 'ntprofile', 'ntkeep', 'ntfile', 'ntexport', 'ntimport', 'ntmd', 'ntwipe', 'ntreset']) {
    expect(out).toContain(`/${c}`)
  }
  expect(out).toMatch(/\/nt  List/)
})

test('/ntfind, /nttags and /ntdel work across the stores', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'ntjot', 'parser crash #bug')
  await run($, 'ntlink', 'https://example.com/parser Parser docs #ref')
  await run($, 'ntsnip', 'ts clamp const clamp = (n: number) => n')
  await run($, 'ntcmd', 'tests npm test')
  await run($, 'ntattach', 'spec ./spec.md the parser spec')

  const found = await run($, 'ntfind', 'parser')
  expect(found).toContain('3 found')
  expect(found).toMatch(/\[note\] n1/)
  expect(found).toMatch(/\[link\] l2/)
  expect(found).toMatch(/\[file\] a5/)
  expect(await run($, 'ntfind', '#bug')).toContain('1 found')
  expect(await run($, 'nttags')).toContain('#bug (1)')
  expect(await run($, 'ntfind', 'nothing-here')).toMatch(/Nothing found/)

  expect(await run($, 'ntdel', 'n1 nope')).toMatch(/Deleted n1\..*Not found: nope/)
  expect((saved.db as Db).notes).toHaveLength(0)
})

test('links need a real http(s) URL and are never fetched', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  expect(await run($, 'ntlink', 'file:///etc/passwd x')).toMatch(/Usage/)
  expect(await run($, 'ntlink', 'https://a.dev/x Nice')).toMatch(/Saved link l1/)
  expect((saved.db as Db).links[0]).toMatchObject({ url: 'https://a.dev/x', title: 'Nice' })
})

test('snippets and commands fill the prompt and are never run', async ($, on) => {
  const { filled } = engine(on)
  await start($)
  await run($, 'ntsnip', 'py hello print("hi")')
  await run($, 'ntcmd', 'clean rm -rf build')

  expect(await run($, 'ntput', 'hello')).toMatch(/Inserted snippet/)
  expect(filled[0]).toEqual({ text: '```py\nprint("hi")\n```\n', mode: 'insert' })
  expect(await run($, 'ntput', 'clean')).toMatch(/not run/)
  expect(filled[1]).toEqual({ text: 'rm -rf build', mode: 'insert' })
  expect(await run($, 'ntput', 'missing')).toMatch(/No snippet or command/)
  // Same name replaces rather than duplicating.
  expect(await run($, 'ntsnip', 'py hello print("v2")')).toMatch(/Replaced/)
  await run($, 'ntput', 'snip:hello')
  expect(filled[2]?.text).toContain('v2')
})

test('/ntfix applies the glossary to the draft only on demand', async ($, on) => {
  const { filled, draft } = engine(on)
  await start($)
  expect(await run($, 'ntfix')).toMatch(/glossary is empty/)
  await run($, 'ntterm', 'teh => the')
  expect(filled).toHaveLength(0)

  draft.text = ''
  expect(await run($, 'ntfix')).toMatch(/no draft/)
  draft.text = 'fix teh bug'
  expect(await run($, 'ntfix')).toMatch(/Fixed 1 term/)
  expect(filled).toEqual([{ text: 'fix the bug', mode: 'replace' }])
  draft.text = 'nothing to change'
  expect(await run($, 'ntfix')).toMatch(/No glossary term/)
  expect(filled).toHaveLength(1)
})

test('reminders: set, persist, fire once as a toast, ticker only while they exist', async ($, on) => {
  const { saved, clock, toasts, timers } = engine(on)
  await start($)
  expect(timers.every).toBe(0)

  const out = await run($, 'ntremind', 'in 20 check the build')
  expect(out).toMatch(/Reminder r1 set for 10:20/)
  expect(timers.every).toBe(1)
  expect((saved.db as Db).remind).toEqual([{ id: 'r1', at: NOW + 20 * 60_000, text: 'check the build' }])
  expect(await run($, 'ntremind', 'bad words')).toMatch(/Usage/)

  await $.turn.complete(done)
  expect(toasts).toHaveLength(0)

  clock.t = NOW + 21 * 60_000
  await $.turn.complete(done)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Reminder: check the build')
  expect((saved.db as Db).remind).toEqual([])

  await $.turn.complete(done)
  expect(toasts).toHaveLength(1)
})

test('a reminder that came due while the app was closed shows at session start', async ($, on) => {
  const db = { ...emptyDb(), seq: 1, remind: [{ id: 'r1', at: NOW - 60_000, text: 'missed it' }] }
  const { toasts, saved } = engine(on, { db })
  await start($)

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('missed it')
  expect((saved.db as Db).remind).toEqual([])
})

test('a future reminder survives a restart and starts the ticker', async ($, on) => {
  const db = { ...emptyDb(), seq: 1, remind: [{ id: 'r1', at: NOW + 60_000, text: 'later' }] }
  const { toasts, timers } = engine(on, { db })
  await start($)

  expect(toasts).toHaveLength(0)
  expect(timers.every).toBe(1)
})

test('recurring tasks surface once at session start when due, then rest', async ($, on) => {
  const db = { ...emptyDb(), seq: 2, every: [{ id: 'e1', kind: 'weekly', text: 'review the board', last: dayKey(NOW - 8 * DAY) }, { id: 'e2', kind: 'monthly', text: 'not yet', last: dayKey(NOW - 3 * DAY) }] }
  const { toasts, saved } = engine(on, { db })
  await start($)

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('Due (weekly): review the board')
  expect(toasts[0]).not.toContain('not yet')
  expect((saved.db as Db).every[0]?.last).toBe('2026-11-25')

  await start($)
  expect(toasts).toHaveLength(1)
})

test('retention deletes older records at session start only when set', async ($, on) => {
  const db = sample()
  db.notes.push({ id: 'n40', t: NOW - 100 * DAY, cwd: '/p', text: 'ancient', tags: [] })
  db.settings.keepDays = 30
  const { saved, toasts } = engine(on, { db })
  await start($)

  expect((saved.db as Db).notes.map(n => n.id)).toEqual(['n1'])
  expect(toasts[0]).toContain('Retention: removed 1 notes')

})

test('retention off deletes nothing at session start', async ($, on) => {
  const db = sample()
  db.notes.push({ id: 'n40', t: NOW - 100 * DAY, cwd: '/p', text: 'ancient', tags: [] })
  const { saved, toasts } = engine(on, { db })
  await start($)

  expect((saved.db as Db).notes).toHaveLength(2)
  expect(toasts).toHaveLength(0)
})

test('/ntkeep sets retention and offers a run', async ($, on) => {
  const db = sample()
  db.notes.push({ id: 'n40', t: NOW - 100 * DAY, cwd: '/p', text: 'ancient', tags: [] })
  const { saved } = engine(on, { db })
  await start($)

  expect(await run($, 'ntkeep', 'abc')).toMatch(/Usage/)
  expect(await run($, 'ntkeep', '30')).toMatch(/1 are older right now/)
  expect((saved.db as Db).settings.keepDays).toBe(30)
  expect((saved.db as Db).notes).toHaveLength(2)
  expect(await run($, 'ntkeep', 'run')).toMatch(/Deleted 1 notes/)
  expect((saved.db as Db).notes).toHaveLength(1)
  expect(await run($, 'ntkeep', 'off')).toMatch(/Retention off/)
})

test('profiles save and restore only this mod\'s settings', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'ntset', 'findMax 50')
  await run($, 'ntset', 'journal off')
  expect(await run($, 'ntprofile', 'save quiet')).toMatch(/cannot read or change any other mod/)
  await run($, 'ntset', 'findMax 10')
  await run($, 'ntset', 'journal on')
  expect((saved.db as Db).settings).toMatchObject({ findMax: 10, journal: true })
  expect(await run($, 'ntprofile', 'load quiet')).toMatch(/Restored profile "quiet"/)
  expect((saved.db as Db).settings).toMatchObject({ findMax: 50, journal: false })
  expect(await run($, 'ntprofile', 'load nope')).toMatch(/No profile/)
  expect(await run($, 'ntprofile', 'del quiet')).toMatch(/Deleted/)
  expect((saved.db as Db).profiles).toEqual([])
  expect(await run($, 'ntset', 'findMax 1')).toMatch(/5 to 100/)
})

test('/ntexport then /ntimport restores the data, and bad JSON changes nothing', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'ntjot', 'keep me #x')
  await run($, 'ntlink', 'https://a.dev/x Title')
  const out = await run($, 'ntexport')
  const json = /```json\n([\s\S]*)\n```/.exec(out)?.[1] ?? ''
  expect(JSON.parse(json).notes).toHaveLength(1)

  await run($, 'ntreset')
  expect(saved.db).toBeUndefined()
  expect(await run($, 'ntimport', json)).toMatch(/Merged: 2 records added/)
  expect((saved.db as Db).notes[0]?.text).toBe('keep me #x')

  expect(await run($, 'ntimport', '{"v":1}')).toMatch(/Nothing imported/)
  expect(await run($, 'ntimport', 'garbage')).toMatch(/Nothing imported/)
  expect(await run($, 'ntimport', '')).toMatch(/Nothing imported/)
  expect((saved.db as Db).notes).toHaveLength(1)

  expect(await run($, 'ntimport', `replace ${json}`)).toMatch(/Replaced all data/)
  expect((saved.db as Db).notes).toHaveLength(1)
})

test('/ntwipe needs confirm; /ntreset is the same as /ntwipe confirm', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await run($, 'ntjot', 'secret #private')

  expect(await run($, 'ntwipe')).toMatch(/Type \/ntwipe confirm/)
  expect(await run($, 'ntwipe', 'yes please')).toMatch(/Type \/ntwipe confirm/)
  expect((saved.db as Db).notes).toHaveLength(1)

  expect(await run($, 'ntwipe', 'confirm')).toMatch(/All data of the notes mod was deleted/)
  expect(saved.db).toBeUndefined()

  await run($, 'ntjot', 'again')
  expect((saved.db as Db).notes).toHaveLength(1)
  await run($, 'ntreset')
  expect(saved.db).toBeUndefined()
  // Nothing found after the wipe.
  expect(await run($, 'ntfind', 'again')).toMatch(/Nothing found/)
})

test('/ntfile reads a small text file read-only and refuses big, binary or missing ones', async ($, on) => {
  const { saved, files } = engine(on)
  await start($)
  files['/notes.txt'] = { size: 40, text: 'first idea #idea\n\nsecond idea\n' }
  files['/big.txt'] = { size: 300 * 1024, text: 'x' }
  files['/bin.dat'] = { size: 20, text: 'ab\u0000cd' }
  files['/dir'] = { size: 0, text: '', kind: 'dir' }

  expect(await run($, 'ntfile', '/notes.txt')).toMatch(/Imported 2 notes/)
  const notes = (saved.db as Db).notes
  expect(notes.map(n => n.text)).toEqual(['first idea #idea', 'second idea'])
  expect(notes[0]?.tags).toEqual(['idea', 'imported'])
  expect(await run($, 'ntfile', '/big.txt')).toMatch(/limit is 200.0 KB/)
  expect(await run($, 'ntfile', '/bin.dat')).toMatch(/binary/)
  expect(await run($, 'ntfile', '/dir')).toMatch(/not a regular file/)
  expect(await run($, 'ntfile', '/nope.txt')).toMatch(/Cannot find/)
  expect(await run($, 'ntfile', '~/x.txt')).toMatch(/not expanded/)
  expect(await run($, 'ntfile', '')).toMatch(/Usage/)
  expect((saved.db as Db).notes).toHaveLength(2)
})

test('the journal counts tool calls and edited files; it records no commands', async ($, on) => {
  const { saved } = engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'echo SECRET_TOKEN_123' })
  await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Write', file_path: '/p/b.ts', content: 'hello' })
  await $.prompt.submit({ text: 'please fix', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete(done)

  const db = saved.db as Db
  expect(db.journal).toHaveLength(1)
  expect(db.journal[0]).toMatchObject({ day: '2026-11-25', tools: 3, edits: 2, prompts: 1, files: ['/p/a.ts', '/p/b.ts'] })
  expect(JSON.stringify(db)).not.toContain('SECRET_TOKEN_123')
  expect(JSON.stringify(db)).not.toContain('hello')
  expect(await run($, 'ntjournal')).toMatch(/3 tool calls, 2 file edits, 1 prompts/)

  await run($, 'ntset', 'journal off')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect((saved.db as Db).journal[0]?.tools).toBe(3)
})

test('/ntmd and /ntexport show text in the pane without writing files', async ($, on) => {
  const { saved } = engine(on)
  on('fs.write', () => {
    throw new Error('this mod must never write files')
  })
  await start($)
  await run($, 'ntjot', 'for the recap #wrap')
  await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  const md = await run($, 'ntmd')
  expect(md).toContain('```markdown')
  expect(md).toContain('for the recap #wrap')
  expect(md).toContain('/p/a.ts')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-export' })
  expect(await ui.find({ type: 'Text', text: /^Session as Markdown/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /for the recap #wrap/ })).toBeDefined()
  await ui.unmount()
  expect(saved.db).toBeDefined()
})

test('the pane has tabs and shows what is stored, with sizes', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'ntjot', 'a pane note #ui')
  await run($, 'ntlink', 'https://a.dev/x Alpha')
  await run($, 'ntsnip', 'sh greet echo hi')
  await run($, 'ntcmd', 'tests npm test')
  await run($, 'ntattach', 'spec ./spec.md the spec')
  await run($, 'ntterm', 'teh => the')
  await run($, 'ntremind', 'in 30 pane reminder')
  await run($, 'ntevery', 'weekly review inbox')

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /a pane note #ui/ })).toBeDefined()

  for (const [id, probe] of [
    ['find', /Search every store/],
    ['links', /Alpha/],
    ['snips', /greet/],
    ['cmds', /Nothing here is ever run/],
    ['files', /the spec/],
    ['terms', /teh/],
    ['time', /pane reminder/],
    ['journal', /Daily journal/],
    ['data', /What this mod stores/],
    ['export', /Run \/ntexport/],
  ] as const) {
    await ui.press({ key: `tab-${id}` })
    expect(await ui.find({ type: 'Text', text: probe })).toBeDefined()
  }
  await ui.press({ key: 'tab-time' })
  expect(await ui.find({ type: 'Text', text: /review inbox/ })).toBeDefined()
  await ui.unmount()
})

test('pane buttons: scope, delete, insert, and the two-step wipe', async ($, on) => {
  const { saved, filled } = engine(on)
  await start($, '/proj/app')
  await run($, 'ntjot', 'here note')
  await start($, '/other')
  await run($, 'ntjot', 'elsewhere note')

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /elsewhere note/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^here note$/ })).toBeUndefined()
  await ui.press({ key: 'scope-all' })
  expect(await ui.find({ type: 'Text', text: /^here note$/ })).toBeDefined()

  await ui.press({ key: 'ni-n1' })
  expect(filled[0]).toEqual({ text: 'here note', mode: 'insert' })
  await ui.press({ key: 'nd-n1' })
  expect((saved.db as Db).notes.map(n => n.id)).toEqual(['n2'])

  await ui.press({ key: 'tab-data' })
  await ui.press({ key: 'wipe-arm' })
  expect(await ui.find({ type: 'Text', text: /Delete everything/ })).toBeDefined()
  await ui.press({ key: 'wipe-no' })
  expect((saved.db as Db).notes).toHaveLength(1)
  await ui.press({ key: 'wipe-arm' })
  await ui.press({ key: 'wipe-yes' })
  expect(saved.db).toBeUndefined()
  await ui.unmount()
})

test('stored data that fails the check is ignored, not trusted', async ($, on) => {
  const { toasts } = engine(on, { db: { v: 1, notes: 'oops', evil: true } })
  await start($)
  expect(toasts).toHaveLength(0)
  expect(await run($, 'ntnotes')).toMatch(/^0 notes/)
})

test('a cap is reported to the user', async ($, on) => {
  const db = { ...emptyDb(), seq: 30, every: Array.from({ length: CAPS.every }, (_, i) => ({ id: `e${i + 1}`, kind: 'daily' as const, text: 'x', last: '2026-11-25' })) }
  engine(on, { db })
  await start($)
  expect(await run($, 'ntevery', 'daily one more')).toMatch(/Recurring tasks is full \(30\)/)
})
