// Pure helpers of the `notes` mod: no engine calls, so each one is unit tested.
import type { Db, Every, EveryKind, Journal, LogRow, Settings } from '../types'

// ---------------------------------------------------------------- limits

export type ListKey = 'notes' | 'links' | 'snips' | 'cmds' | 'attach' | 'terms' | 'remind' | 'every'

export const CAPS = {
  notes: 500,
  links: 300,
  snips: 100,
  cmds: 100,
  attach: 100,
  terms: 100,
  remind: 50,
  every: 30,
  journal: 60,
  log: 200,
  profiles: 20,
} as const

export const LEN = {
  note: 1000,
  title: 200,
  url: 500,
  name: 40,
  lang: 20,
  code: 8000,
  cmd: 1000,
  path: 500,
  desc: 200,
  term: 80,
  text: 200,
  log: 120,
  file: 200,
} as const

/** The whole stored data may not pass this many characters of JSON. */
export const MAX_TOTAL = 450_000
/** The most a read file may be, bytes. */
export const MAX_FILE = 200 * 1024
/** The most lines one file import turns into notes. */
export const MAX_FILE_LINES = 200
export const DAY_MS = 86_400_000

export const PREFIX: Record<ListKey, string> = {
  notes: 'n',
  links: 'l',
  snips: 's',
  cmds: 'c',
  attach: 'a',
  terms: 'g',
  remind: 'r',
  every: 'e',
}

export const LABEL: Record<ListKey, string> = {
  notes: 'Notes',
  links: 'Links',
  snips: 'Snippets',
  cmds: 'Commands',
  attach: 'Attachments',
  terms: 'Glossary terms',
  remind: 'Reminders',
  every: 'Recurring tasks',
}

export const defaultSettings = (): Settings => ({
  keepDays: 0,
  journal: true,
  startupToast: true,
  ci: false,
  findMax: 20,
})

export const emptyDb = (): Db => ({
  v: 1,
  seq: 0,
  notes: [],
  links: [],
  snips: [],
  cmds: [],
  attach: [],
  terms: [],
  remind: [],
  every: [],
  journal: [],
  log: [],
  profiles: [],
  settings: defaultSettings(),
})

export const sizeOf = (db: Db): number => JSON.stringify(db).length

export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)

export const oneLine = (s: string, n = 80): string => clip(s.replace(/\s+/g, ' ').trim(), n)

export const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)

// ---------------------------------------------------------------- time

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar day as YYYY-MM-DD. */
export const dayKey = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const hhmm = (ms: number): string => {
  const d = new Date(ms)

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `15:30` for today, `2026-11-26 15:30` for another day. */
export const fmtAt = (at: number, now: number): string =>
  dayKey(at) === dayKey(now) ? hhmm(at) : `${dayKey(at)} ${hhmm(at)}`

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Whole days since 1970 for a YYYY-MM-DD key; NaN for a bad key. */
export const dayNum = (key: string): number => {
  if (!DAY_RE.test(key)) {
    return Number.NaN
  }
  const [y, m, d] = key.split('-').map(Number)

  return Math.floor(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / DAY_MS)
}

export type When = { ok: true; at: number; text: string } | { ok: false; error: string }

const WHEN_USAGE = 'Usage: /ntremind 15:30 <text>  or  /ntremind in 20 <text>  (also 3pm, in 2h)'

/** Parses `15:30 text`, `3pm text`, `at 9:05am text`, `in 20 text`, `in 2h text`. */
export const parseWhen = (input: string, now: number): When => {
  const s = input.trim().replace(/^at\s+/i, '')
  const rel = /^in\s+(\d+)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)?(?=\s|$)\s*([\s\S]*)$/i.exec(s)

  if (rel !== null) {
    const n = Number(rel[1])
    const isHours = /^h/i.test(rel[2] ?? '')
    const minutes = isHours ? n * 60 : n
    const text = (rel[3] ?? '').trim()

    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 7 * 24 * 60) {
      return { ok: false, error: 'Use between 1 minute and 7 days.' }
    }
    if (text === '') {
      return { ok: false, error: `Say what to remind you of. ${WHEN_USAGE}` }
    }

    return { ok: true, at: now + minutes * 60_000, text }
  }
  const clock =
    /^(\d{1,2}):(\d{2})\s*(am|pm)?(?=\s|$)\s*([\s\S]*)$/i.exec(s) ?? /^(\d{1,2})()\s*(am|pm)(?=\s|$)\s*([\s\S]*)$/i.exec(s)

  if (clock === null) {
    return { ok: false, error: WHEN_USAGE }
  }
  let hour = Number(clock[1])
  const minute = clock[2] === '' ? 0 : Number(clock[2])
  const meridiem = (clock[3] ?? '').toLowerCase()
  const text = (clock[4] ?? '').trim()

  if (meridiem !== '') {
    if (hour < 1 || hour > 12) {
      return { ok: false, error: 'With am/pm the hour is 1 to 12.' }
    }
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0)
  } else if (hour > 23) {
    return { ok: false, error: 'The hour is 0 to 23.' }
  }
  if (minute > 59) {
    return { ok: false, error: 'The minutes are 00 to 59.' }
  }
  if (text === '') {
    return { ok: false, error: `Say what to remind you of. ${WHEN_USAGE}` }
  }
  const d = new Date(now)
  d.setHours(hour, minute, 0, 0)

  if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1)
  }

  return { ok: true, at: d.getTime(), text }
}

const daysInMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate()

/** The day a recurring task is next due: last + 1 day, 7 days or one calendar month. */
export const nextDue = (kind: EveryKind, last: string): string => {
  const n = dayNum(last)

  if (Number.isNaN(n)) {
    return last
  }
  if (kind === 'daily' || kind === 'weekly') {
    return utcKey(n + (kind === 'daily' ? 1 : 7))
  }
  const [y, m, d] = last.split('-').map(Number)
  const ty = (m ?? 1) === 12 ? (y ?? 1970) + 1 : (y ?? 1970)
  const tm = (m ?? 1) === 12 ? 1 : (m ?? 1) + 1

  return `${ty}-${pad(tm)}-${pad(Math.min(d ?? 1, daysInMonth(ty, tm)))}`
}

// A day number back to its key, in UTC so no timezone shifts it.
const utcKey = (dayN: number): string => {
  const d = new Date(dayN * DAY_MS)

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const isDue = (e: Pick<Every, 'kind' | 'last'>, today: string): boolean => {
  const due = dayNum(nextDue(e.kind, e.last))
  const t = dayNum(today)

  return !Number.isNaN(due) && !Number.isNaN(t) && t >= due
}

// ---------------------------------------------------------------- text parsing

export const TAG_RE = /^\p{L}[\p{L}\p{N}_-]{0,29}$/u

/** `#tag` words of a text, lower case, unique, at most 8. A `#` inside a word or URL is not a tag. */
export const parseTags = (text: string): string[] => {
  const out: string[] = []

  for (const m of text.matchAll(/(?:^|\s)#(\p{L}[\p{L}\p{N}_-]{0,29})/gu)) {
    const tag = (m[1] ?? '').toLowerCase()

    if (tag !== '' && !out.includes(tag) && out.length < 8) {
      out.push(tag)
    }
  }

  return out
}

export type Query = { tags: string[]; words: string[] }

/** Splits a search into `#tag` filters and lower-case words. */
export const parseQuery = (q: string): Query => {
  const tags: string[] = []
  const words: string[] = []

  for (const raw of q.trim().split(/\s+/)) {
    if (raw === '') {
      continue
    }
    if (raw.startsWith('#') && raw.length > 1) {
      tags.push(raw.slice(1).toLowerCase())
    } else {
      words.push(raw.toLowerCase())
    }
  }

  return { tags, words }
}

export const matchQuery = (hay: string, tags: readonly string[], q: Query): boolean => {
  const h = hay.toLowerCase()

  return q.tags.every(t => tags.includes(t)) && q.words.every(w => h.includes(w))
}

/** One token (a quoted one may hold spaces) and what follows it. */
export const takeToken = (text: string): [string, string] => {
  const s = text.replace(/^\s+/, '')
  const q = s[0]

  if (q === '"' || q === "'") {
    const end = s.indexOf(q, 1)

    if (end > 0) {
      return [s.slice(1, end), s.slice(end + 1).replace(/^\s+/, '')]
    }
  }
  const m = /^(\S+)\s*([\s\S]*)$/.exec(s)

  return m === null ? ['', ''] : [m[1] ?? '', m[2] ?? '']
}

export const isHttpUrl = (s: string): boolean => s.length <= LEN.url && /^https?:\/\/[^\s]+$/i.test(s)

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export const parseLink = (args: string): Parsed<{ url: string; title: string }> => {
  const [url, rest] = takeToken(args)

  if (!isHttpUrl(url)) {
    return { ok: false, error: 'Usage: /ntlink <http(s) url> <title>   (the page is never fetched)' }
  }
  const title = oneLine(rest, LEN.title)

  return { ok: true, value: { url, title: title === '' ? url : title } }
}

export const parseSnip = (args: string): Parsed<{ lang: string; name: string; code: string }> => {
  const [lang, r1] = takeToken(args)
  const [name, code] = takeToken(r1)
  const body = code.replace(/\s+$/, '')

  if (lang === '' || name === '' || body === '') {
    return { ok: false, error: 'Usage: /ntsnip <lang> <name> <code>' }
  }
  if (!/^[\w+#.-]{1,20}$/.test(lang)) {
    return { ok: false, error: 'The language is one short word, like ts, py or sh.' }
  }
  if (name.length > LEN.name) {
    return { ok: false, error: `The name is at most ${LEN.name} characters.` }
  }
  if (body.length > LEN.code) {
    return { ok: false, error: `A snippet is at most ${LEN.code} characters.` }
  }

  return { ok: true, value: { lang: lang.toLowerCase(), name, code: body } }
}

export const parseCmd = (args: string): Parsed<{ name: string; cmd: string }> => {
  const [name, rest] = takeToken(args)
  const cmd = rest.trim()

  if (name === '' || cmd === '') {
    return { ok: false, error: 'Usage: /ntcmd <name> <command>   (saved only, never run)' }
  }
  if (name.length > LEN.name || cmd.length > LEN.cmd) {
    return { ok: false, error: `Name up to ${LEN.name} and command up to ${LEN.cmd} characters.` }
  }

  return { ok: true, value: { name, cmd } }
}

export const parseAttach = (args: string): Parsed<{ name: string; path: string; desc: string }> => {
  const [name, r1] = takeToken(args)
  const [path, r2] = takeToken(r1)

  if (name === '' || path === '') {
    return { ok: false, error: 'Usage: /ntattach <name> <path> [description]   (only the path is saved)' }
  }
  if (name.length > LEN.name || path.length > LEN.path) {
    return { ok: false, error: `Name up to ${LEN.name} and path up to ${LEN.path} characters.` }
  }

  return { ok: true, value: { name, path, desc: oneLine(r2, LEN.desc) } }
}

export const parseTerm = (args: string): Parsed<{ from: string; to: string }> => {
  const at = args.indexOf('=>')
  const from = at < 0 ? '' : args.slice(0, at).trim()
  const to = at < 0 ? '' : args.slice(at + 2).trim()

  if (from === '' || to === '') {
    return { ok: false, error: 'Usage: /ntterm <word> => <replacement>' }
  }
  if (from.length > LEN.term || to.length > LEN.term) {
    return { ok: false, error: `Each side is at most ${LEN.term} characters.` }
  }

  return { ok: true, value: { from, to } }
}

export const parseEvery = (args: string): Parsed<{ kind: EveryKind; text: string }> => {
  const [word, rest] = takeToken(args)
  const kind = word.toLowerCase()
  const text = oneLine(rest, LEN.text)

  if ((kind !== 'daily' && kind !== 'weekly' && kind !== 'monthly') || text === '') {
    return { ok: false, error: 'Usage: /ntevery daily|weekly|monthly <text>' }
  }

  return { ok: true, value: { kind, text } }
}

// ---------------------------------------------------------------- the list store

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const keyOfId = (id: string): ListKey | null => {
  const hit = (Object.keys(PREFIX) as ListKey[]).find(k => /^[a-z]\d+$/.test(id) && id.startsWith(PREFIX[k]))

  return hit ?? null
}

export type Added = { ok: true; db: Db; id: string } | { ok: false; error: string }

/** Adds one item to a list, telling the user at a cap. `build` receives the new id. */
export const addTo = <K extends ListKey>(db: Db, key: K, build: (id: string) => Db[K][number]): Added => {
  if (db[key].length >= CAPS[key]) {
    return { ok: false, error: `${LABEL[key]} is full (${CAPS[key]}). Delete one with /ntdel <id> first.` }
  }
  const seq = db.seq + 1
  const id = `${PREFIX[key]}${seq}`
  const next = { ...db, seq, [key]: [...db[key], build(id)] } as Db
  const size = sizeOf(next)

  if (size > MAX_TOTAL) {
    return {
      ok: false,
      error: `The notes store is full (${fmtBytes(MAX_TOTAL)} of data). Delete something with /ntdel <id> or /ntkeep <days>.`,
    }
  }

  return { ok: true, db: next, id }
}

export const removeById = (db: Db, id: string): { db: Db; key: ListKey | null } => {
  const key = keyOfId(id)

  if (key === null || !(db[key] as readonly { id: string }[]).some(x => x.id === id)) {
    return { db, key: null }
  }

  return { db: { ...db, [key]: (db[key] as readonly { id: string }[]).filter(x => x.id !== id) } as Db, key }
}

export type Hit = { kind: string; id: string; text: string }

/** Searches every list of the store; `#tag` words filter by tag. */
export const searchAll = (db: Db, q: string, limit: number): { hits: Hit[]; total: number } => {
  const query = parseQuery(q)
  const all: Hit[] = []

  if (query.tags.length === 0 && query.words.length === 0) {
    return { hits: [], total: 0 }
  }
  for (const n of db.notes) {
    if (matchQuery(n.text, n.tags, query)) {
      all.push({ kind: 'note', id: n.id, text: oneLine(n.text, 100) })
    }
  }
  for (const l of db.links) {
    if (matchQuery(`${l.title} ${l.url}`, l.tags, query)) {
      all.push({ kind: 'link', id: l.id, text: oneLine(`${l.title} ${l.url}`, 100) })
    }
  }
  for (const s of db.snips) {
    if (matchQuery(`${s.name} ${s.lang} ${s.code}`, [s.lang], query)) {
      all.push({ kind: 'snippet', id: s.id, text: `${s.name} [${s.lang}] ${oneLine(s.code, 60)}` })
    }
  }
  for (const c of db.cmds) {
    if (matchQuery(`${c.name} ${c.cmd}`, [], query)) {
      all.push({ kind: 'command', id: c.id, text: `${c.name}: ${oneLine(c.cmd, 70)}` })
    }
  }
  for (const a of db.attach) {
    if (matchQuery(`${a.name} ${a.path} ${a.desc}`, [], query)) {
      all.push({ kind: 'file', id: a.id, text: oneLine(`${a.name} ${a.path} ${a.desc}`, 100) })
    }
  }
  for (const g of db.terms) {
    if (matchQuery(`${g.from} ${g.to}`, [], query)) {
      all.push({ kind: 'term', id: g.id, text: `${g.from} => ${g.to}` })
    }
  }
  for (const r of db.remind) {
    if (matchQuery(r.text, [], query)) {
      all.push({ kind: 'reminder', id: r.id, text: oneLine(r.text, 100) })
    }
  }
  for (const e of db.every) {
    if (matchQuery(e.text, [], query)) {
      all.push({ kind: 'recurring', id: e.id, text: `${e.kind}: ${oneLine(e.text, 90)}` })
    }
  }
  for (const j of db.journal) {
    if (matchQuery(`${j.day} ${j.files.join(' ')} ${j.top.map(t => t.tool).join(' ')}`, [], query)) {
      all.push({ kind: 'journal', id: j.day, text: `${j.tools} tools, ${j.edits} edits` })
    }
  }

  return { hits: all.slice(0, Math.max(1, limit)), total: all.length }
}

/** Tag counts over notes and links, most used first. */
export const tagCounts = (db: Db): { tag: string; n: number }[] => {
  const m = new Map<string, number>()

  for (const t of [...db.notes.flatMap(n => n.tags), ...db.links.flatMap(l => l.tags)]) {
    m.set(t, (m.get(t) ?? 0) + 1)
  }

  return [...m.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
}

// ---------------------------------------------------------------- glossary

/** Replaces each term in one pass (no chains), whole words when the term starts and ends with a word character. */
export const applyTerms = (
  text: string,
  terms: readonly { from: string; to: string }[],
  ci: boolean,
): { text: string; count: number } => {
  const live = terms.filter(t => t.from !== '')

  if (live.length === 0) {
    return { text, count: 0 }
  }
  const sorted = [...live].sort((a, b) => b.from.length - a.from.length)
  const word = /[\p{L}\p{N}_]/u
  const parts = sorted.map(t => {
    const lead = word.test(t.from[0] ?? '') ? '(?<![\\p{L}\\p{N}_])' : ''
    const tail = word.test(t.from[t.from.length - 1] ?? '') ? '(?![\\p{L}\\p{N}_])' : ''

    return `${lead}${esc(t.from)}${tail}`
  })
  const re = new RegExp(parts.join('|'), ci ? 'giu' : 'gu')
  const map = new Map<string, string>()

  for (const t of sorted) {
    const k = ci ? t.from.toLowerCase() : t.from

    if (!map.has(k)) {
      map.set(k, t.to)
    }
  }
  let count = 0
  const out = text.replace(re, hit => {
    count += 1

    return map.get(ci ? hit.toLowerCase() : hit) ?? hit
  })

  return { text: out, count }
}

// ---------------------------------------------------------------- journal and log

const bump = (j: Journal, tool: string | undefined, file: string | undefined, isPrompt: boolean): Journal => {
  let top = j.top

  if (tool !== undefined) {
    const has = top.some(t => t.tool === tool)

    if (has) {
      top = top.map(t => (t.tool === tool ? { ...t, n: t.n + 1 } : t))
    } else if (top.length < 20) {
      top = [...top, { tool, n: 1 }]
    }
  }
  const f = file === undefined ? undefined : clip(file, LEN.file)
  const files = f !== undefined && !j.files.includes(f) && j.files.length < 20 ? [...j.files, f] : j.files

  return {
    ...j,
    tools: j.tools + (tool === undefined ? 0 : 1),
    edits: j.edits + (file === undefined ? 0 : 1),
    prompts: j.prompts + (isPrompt ? 1 : 0),
    files,
    top,
  }
}

/** Counts one tool call, edited file or prompt into the day's journal entry. */
export const bumpJournal = (
  db: Db,
  day: string,
  ev: { tool?: string; file?: string; prompt?: boolean },
): Db => {
  const i = db.journal.findIndex(j => j.day === day)
  const base: Journal = i >= 0 ? (db.journal[i] as Journal) : { day, tools: 0, edits: 0, prompts: 0, files: [], top: [] }
  const next = bump(base, ev.tool, ev.file, ev.prompt === true)
  const list = i >= 0 ? db.journal.map((j, k) => (k === i ? next : j)) : [...db.journal, next].sort((a, b) => a.day.localeCompare(b.day))

  return { ...db, journal: list.slice(-CAPS.journal) }
}

export const addLog = (db: Db, row: LogRow): Db => ({
  ...db,
  log: [...db.log, { ...row, text: clip(row.text, LEN.log) }].slice(-CAPS.log),
})

/** Trims the automatic records (log, then oldest journal days) until the data fits. */
export const fitCap = (db: Db): Db => {
  let cur = db

  while (sizeOf(cur) > MAX_TOTAL && cur.log.length > 0) {
    cur = { ...cur, log: cur.log.slice(Math.max(1, Math.ceil(cur.log.length / 4))) }
  }
  while (sizeOf(cur) > MAX_TOTAL && cur.journal.length > 1) {
    cur = { ...cur, journal: cur.journal.slice(1) }
  }

  return cur
}

// ---------------------------------------------------------------- retention

export type Removed = { notes: number; links: number; journal: number; log: number }

/** Deletes notes, links, journal days and log rows older than `days`. 0 or less keeps everything. */
export const pruneByAge = (db: Db, now: number, days: number): { db: Db; removed: Removed } => {
  if (!(days > 0)) {
    return { db, removed: { notes: 0, links: 0, journal: 0, log: 0 } }
  }
  const cutoff = now - days * DAY_MS
  const cutDay = dayKey(cutoff)
  const notes = db.notes.filter(n => n.t >= cutoff)
  const links = db.links.filter(l => l.t >= cutoff)
  const journal = db.journal.filter(j => j.day >= cutDay)
  const log = db.log.filter(r => r.t >= cutoff)
  const removed = {
    notes: db.notes.length - notes.length,
    links: db.links.length - links.length,
    journal: db.journal.length - journal.length,
    log: db.log.length - log.length,
  }

  if (removed.notes + removed.links + removed.journal + removed.log === 0) {
    return { db, removed }
  }

  return { db: { ...db, notes, links, journal, log }, removed }
}

// ---------------------------------------------------------------- settings

export const SETTING_KEYS = ['keepDays', 'journal', 'startupToast', 'ci', 'findMax'] as const

const asBool = (v: string): boolean | null => {
  const s = v.trim().toLowerCase()

  return s === 'on' || s === 'true' || s === 'yes' || s === '1' ? true : s === 'off' || s === 'false' || s === 'no' || s === '0' ? false : null
}

export const setSetting = (s: Settings, key: string, value: string): Parsed<Settings> => {
  if (key === 'keepDays') {
    const n = value.trim().toLowerCase() === 'off' ? 0 : Number(value)

    if (!Number.isInteger(n) || n < 0 || n > 3650) {
      return { ok: false, error: 'keepDays is a whole number of days, 0 (off) to 3650.' }
    }

    return { ok: true, value: { ...s, keepDays: n } }
  }
  if (key === 'findMax') {
    const n = Number(value)

    if (!Number.isInteger(n) || n < 5 || n > 100) {
      return { ok: false, error: 'findMax is a whole number from 5 to 100.' }
    }

    return { ok: true, value: { ...s, findMax: n } }
  }
  if (key === 'journal' || key === 'startupToast' || key === 'ci') {
    const b = asBool(value)

    return b === null ? { ok: false, error: `${key} is on or off.` } : { ok: true, value: { ...s, [key]: b } }
  }

  return { ok: false, error: `Settings of this mod: ${SETTING_KEYS.join(', ')}.` }
}

// ---------------------------------------------------------------- import / export validation

type Sch =
  | { t: 'str'; max: number; pat?: RegExp }
  | { t: 'int'; min: number; max: number }
  | { t: 'bool' }
  | { t: 'enum'; of: readonly string[] }
  | { t: 'strs'; max: number; itemMax: number; pat?: RegExp }
  | { t: 'obj'; f: Record<string, Sch> }
  | { t: 'arr'; of: Sch; max: number }

const str = (max: number, pat?: RegExp): Sch => ({ t: 'str', max, ...(pat === undefined ? {} : { pat }) })
const int = (min: number, max: number): Sch => ({ t: 'int', min, max })
const TIME = int(0, 4_102_444_800_000)
const ID = str(11, /^[a-z]\d{1,9}$/)
const TAGS: Sch = { t: 'strs', max: 8, itemMax: 30, pat: TAG_RE }
const URL_PAT = /^https?:\/\/\S+$/i

const SETTINGS_SCH: Sch = {
  t: 'obj',
  f: { keepDays: int(0, 3650), journal: { t: 'bool' }, startupToast: { t: 'bool' }, ci: { t: 'bool' }, findMax: int(5, 100) },
}

export const DB_SCHEMA: Sch = {
  t: 'obj',
  f: {
    v: int(1, 1),
    seq: int(0, 1_000_000_000),
    notes: { t: 'arr', max: CAPS.notes, of: { t: 'obj', f: { id: ID, t: TIME, cwd: str(500), text: str(LEN.note), tags: TAGS } } },
    links: { t: 'arr', max: CAPS.links, of: { t: 'obj', f: { id: ID, t: TIME, url: str(LEN.url, URL_PAT), title: str(LEN.title), tags: TAGS } } },
    snips: { t: 'arr', max: CAPS.snips, of: { t: 'obj', f: { id: ID, t: TIME, lang: str(LEN.lang, /^[\w+#.-]+$/), name: str(LEN.name), code: str(LEN.code) } } },
    cmds: { t: 'arr', max: CAPS.cmds, of: { t: 'obj', f: { id: ID, t: TIME, name: str(LEN.name), cmd: str(LEN.cmd) } } },
    attach: { t: 'arr', max: CAPS.attach, of: { t: 'obj', f: { id: ID, t: TIME, name: str(LEN.name), path: str(LEN.path), desc: str(LEN.desc) } } },
    terms: { t: 'arr', max: CAPS.terms, of: { t: 'obj', f: { id: ID, from: str(LEN.term), to: str(LEN.term) } } },
    remind: { t: 'arr', max: CAPS.remind, of: { t: 'obj', f: { id: ID, at: TIME, text: str(LEN.text) } } },
    every: {
      t: 'arr',
      max: CAPS.every,
      of: { t: 'obj', f: { id: ID, kind: { t: 'enum', of: ['daily', 'weekly', 'monthly'] }, text: str(LEN.text), last: str(10, DAY_RE) } },
    },
    journal: {
      t: 'arr',
      max: CAPS.journal,
      of: {
        t: 'obj',
        f: {
          day: str(10, DAY_RE),
          tools: int(0, 10_000_000),
          edits: int(0, 10_000_000),
          prompts: int(0, 10_000_000),
          files: { t: 'strs', max: 20, itemMax: LEN.file },
          top: { t: 'arr', max: 20, of: { t: 'obj', f: { tool: str(40), n: int(0, 10_000_000) } } },
        },
      },
    },
    log: {
      t: 'arr',
      max: CAPS.log,
      of: { t: 'obj', f: { t: TIME, kind: { t: 'enum', of: ['tool', 'edit', 'prompt', 'note', 'remind'] }, text: str(LEN.log) } },
    },
    profiles: { t: 'arr', max: CAPS.profiles, of: { t: 'obj', f: { name: str(LEN.name), settings: SETTINGS_SCH } } },
    settings: SETTINGS_SCH,
  },
}

type Checked = { ok: true; value: unknown } | { ok: false; error: string }

const fail = (path: string, why: string): Checked => ({ ok: false, error: `${path === '' ? 'root' : path}: ${why}` })

/** Checks `v` against the schema and returns a fresh copy holding only the known fields. Unknown or missing fields fail. */
export const checkSchema = (s: Sch, v: unknown, path = ''): Checked => {
  switch (s.t) {
    case 'str':
      if (typeof v !== 'string') {
        return fail(path, 'expected text')
      }
      if (v.length > s.max) {
        return fail(path, `text longer than ${s.max}`)
      }
      if (s.pat !== undefined && !s.pat.test(v)) {
        return fail(path, 'text has the wrong format')
      }

      return { ok: true, value: v }
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v) || v < s.min || v > s.max) {
        return fail(path, `expected a whole number from ${s.min} to ${s.max}`)
      }

      return { ok: true, value: v }
    case 'bool':
      return typeof v === 'boolean' ? { ok: true, value: v } : fail(path, 'expected true or false')
    case 'enum':
      return typeof v === 'string' && s.of.includes(v) ? { ok: true, value: v } : fail(path, `expected one of ${s.of.join(', ')}`)
    case 'strs': {
      if (!Array.isArray(v) || v.length > s.max) {
        return fail(path, `expected a list of at most ${s.max} texts`)
      }
      const out: string[] = []

      for (const [i, item] of v.entries()) {
        if (typeof item !== 'string' || item.length > s.itemMax || (s.pat !== undefined && !s.pat.test(item))) {
          return fail(`${path}[${i}]`, 'bad text')
        }
        out.push(item)
      }

      return { ok: true, value: out }
    }
    case 'arr': {
      if (!Array.isArray(v)) {
        return fail(path, 'expected a list')
      }
      if (v.length > s.max) {
        return fail(path, `more than ${s.max} items`)
      }
      const out: unknown[] = []

      for (const [i, item] of v.entries()) {
        const r = checkSchema(s.of, item, `${path}[${i}]`)

        if (!r.ok) {
          return r
        }
        out.push(r.value)
      }

      return { ok: true, value: out }
    }
    case 'obj': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return fail(path, 'expected an object')
      }
      const src = v as Record<string, unknown>

      for (const k of Object.keys(src)) {
        if (!Object.prototype.hasOwnProperty.call(s.f, k)) {
          return fail(path, `unknown field "${clip(k, 30)}"`)
        }
      }
      const out: Record<string, unknown> = {}

      for (const [k, sub] of Object.entries(s.f)) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) {
          return fail(path, `missing field "${k}"`)
        }
        const r = checkSchema(sub, src[k], path === '' ? k : `${path}.${k}`)

        if (!r.ok) {
          return r
        }
        out[k] = r.value
      }

      return { ok: true, value: out }
    }
  }
}

export type Imported = { ok: true; db: Db } | { ok: false; error: string }

/** Parses and strictly validates pasted backup JSON. */
export const validateImport = (text: string): Imported => {
  const raw = text.trim()

  if (raw === '') {
    return { ok: false, error: 'Paste the JSON from /ntexport after the command.' }
  }
  if (raw.length > MAX_TOTAL) {
    return { ok: false, error: `That is over the ${fmtBytes(MAX_TOTAL)} limit.` }
  }
  let data: unknown

  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'That is not valid JSON (was it cut off or re-wrapped?).' }
  }
  const r = checkSchema(DB_SCHEMA, data)

  if (!r.ok) {
    return { ok: false, error: `Not a notes backup: ${r.error}` }
  }
  const db = r.value as Db
  const dupes = (ids: string[]) => new Set(ids).size !== ids.length

  for (const k of Object.keys(PREFIX) as ListKey[]) {
    const list = db[k] as readonly { id: string }[]

    if (list.some(x => !x.id.startsWith(PREFIX[k])) || dupes(list.map(x => x.id))) {
      return { ok: false, error: `Not a notes backup: ${k} has a wrong or repeated id.` }
    }
  }
  if (dupes(db.journal.map(j => j.day))) {
    return { ok: false, error: 'Not a notes backup: journal repeats a day.' }
  }

  return { ok: true, db }
}

export type Merged = { ok: true; db: Db; skipped: number; added: number } | { ok: false; error: string }

/** Folds a validated backup into the current data (`merge`) or in place of it (`replace`); ids are renumbered. */
export const mergeImport = (cur: Db, imp: Db, mode: 'merge' | 'replace'): Merged => {
  let seq = mode === 'replace' ? 0 : cur.seq
  let skipped = 0
  let added = 0
  const base = mode === 'replace' ? emptyDb() : cur
  const out: Db = { ...base }

  for (const k of Object.keys(PREFIX) as ListKey[]) {
    const room = Math.max(0, CAPS[k] - base[k].length)
    const incoming = (imp[k] as readonly { id: string }[]).slice(0, room).map(x => ({ ...x, id: `${PREFIX[k]}${++seq}` }))
    skipped += imp[k].length - incoming.length
    added += incoming.length
    ;(out as Record<string, unknown>)[k] = [...base[k], ...incoming]
  }
  // Terms are unique by the word they replace: an imported one wins.
  const seen = new Set<string>()
  out.terms = [...out.terms].reverse().filter(t => !seen.has(t.from) && seen.add(t.from)).reverse()
  const days = new Map(base.journal.map(j => [j.day, j]))

  for (const j of imp.journal) {
    days.set(j.day, j)
  }
  out.journal = [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-CAPS.journal)
  out.log = [...base.log, ...imp.log].sort((a, b) => a.t - b.t).slice(-CAPS.log)
  const profiles = new Map(base.profiles.map(p => [p.name, p]))

  for (const p of imp.profiles) {
    profiles.set(p.name, p)
  }
  out.profiles = [...profiles.values()].slice(-CAPS.profiles)
  out.settings = mode === 'replace' ? imp.settings : base.settings
  out.seq = Math.max(seq, mode === 'replace' ? imp.seq : cur.seq)
  out.v = 1

  if (sizeOf(out) > MAX_TOTAL) {
    return { ok: false, error: `Importing would pass the ${fmtBytes(MAX_TOTAL)} limit. Nothing was changed.` }
  }

  return { ok: true, db: out, skipped, added }
}

// ---------------------------------------------------------------- file import

export const looksBinary = (text: string): boolean => {
  if (text.includes('\u0000')) {
    return true
  }
  let bad = 0

  for (const ch of text.slice(0, 20_000)) {
    if (ch === '�') {
      bad += 1
    }
  }

  return bad > 5
}

/** Each non-empty line of a text file becomes one note (at most MAX_FILE_LINES). */
export const linesToNotes = (text: string): { lines: string[]; more: number } => {
  const all = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l !== '')
    .map(l => clip(l, LEN.note))

  return { lines: all.slice(0, MAX_FILE_LINES), more: Math.max(0, all.length - MAX_FILE_LINES) }
}

// ---------------------------------------------------------------- markdown

export const shortCwd = (cwd: string): string => {
  const parts = cwd.split('/').filter(p => p !== '')

  return parts.length === 0 ? '/' : parts.slice(-2).join('/')
}

/** The session as Markdown text, from this mod's recorded activity only. */
export const buildMarkdown = (db: Db, o: { now: number; startedAt: number; cwd: string }): string => {
  const today = dayKey(o.now)
  const j = db.journal.find(x => x.day === today)
  const since = o.startedAt > 0 ? o.startedAt : o.now - DAY_MS
  const recent = db.log.filter(r => r.t >= since)
  const notes = db.notes.filter(n => n.t >= since)
  const links = db.links.filter(l => l.t >= since)
  const lines: string[] = [`# Session notes, ${today}`, '', `Folder: \`${o.cwd === '' ? 'unknown' : o.cwd}\``, '', '## Activity today', '']

  if (j === undefined) {
    lines.push('- Nothing recorded yet (the journal counts tool calls once they happen).')
  } else {
    lines.push(`- ${j.tools} tool calls, ${j.edits} file edits, ${j.prompts} prompts`)

    if (j.top.length > 0) {
      lines.push(`- Tools: ${[...j.top].sort((a, b) => b.n - a.n).map(t => `${t.tool} ${t.n}`).join(', ')}`)
    }
  }
  if (j !== undefined && j.files.length > 0) {
    lines.push('', '## Files edited', '', ...j.files.map(f => `- \`${f}\``))
  }
  if (notes.length > 0) {
    lines.push('', '## Notes captured', '', ...notes.map(n => `- ${n.text}`))
  }
  if (links.length > 0) {
    lines.push('', '## Links saved', '', ...links.map(l => `- [${l.title}](${l.url})`))
  }
  if (recent.length > 0) {
    lines.push('', `## Recent recorded steps (last ${Math.min(recent.length, 30)})`, '')

    for (const r of recent.slice(-30)) {
      lines.push(`- ${hhmm(r.t)} ${r.kind}: ${r.text}`)
    }
  }
  if (db.remind.length > 0) {
    lines.push('', '## Open reminders', '', ...db.remind.map(r => `- ${fmtAt(r.at, o.now)} ${r.text}`))
  }

  return `${lines.join('\n')}\n`
}
