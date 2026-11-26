import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import type { Db, Settings } from '../types'
import {
  CAPS,
  DAY_RE,
  DB_SCHEMA,
  LEN,
  MAX_FILE,
  MAX_TOTAL,
  SETTING_KEYS,
  addLog,
  addTo,
  applyTerms,
  buildMarkdown,
  bumpJournal,
  checkSchema,
  clip,
  dayKey,
  emptyDb,
  fitCap,
  fmtAt,
  fmtBytes,
  isDue,
  linesToNotes,
  looksBinary,
  mergeImport,
  nextDue,
  oneLine,
  parseAttach,
  parseCmd,
  parseEvery,
  parseLink,
  parseSnip,
  parseTags,
  parseTerm,
  parseWhen,
  pruneByAge,
  removeById,
  searchAll,
  setSetting,
  shortCwd,
  sizeOf,
  takeToken,
  tagCounts,
  validateImport,
} from './pure'
import type { ListKey } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]
type UI = ReturnType<Dollar['ui']['resolve']>

const PANE = 'notes-main'

// ---------------------------------------------------------------- state

const dbAtom = atom({ plugin: 'notes', key: 'db' } as const, emptyDb(), { shape: 'db-1' })
const tabAtom = atom({ plugin: 'notes', key: 'tab' } as const, 'notes')
const cwdAtom = atom({ plugin: 'notes', key: 'cwd' } as const, '')
const sessionStart = atom({ plugin: 'notes', key: 'sessionStart' } as const, 0)
const scopeAll = atom({ plugin: 'notes', key: 'scopeAll' } as const, false)
const tagFilter = atom({ plugin: 'notes', key: 'tagFilter' } as const, '')
const queryAtom = atom({ plugin: 'notes', key: 'query' } as const, '')
const viewTitle = atom({ plugin: 'notes', key: 'viewTitle' } as const, '')
const viewText = atom({ plugin: 'notes', key: 'viewText' } as const, '')
const isArmed = atom({ plugin: 'notes', key: 'isArmed' } as const, false)

// Module variables start over on a reload; the data itself is in the store.
let ticker: Timer | undefined
let persistTimer: Timer | undefined
let isDirty = false
let lastDraft = ''

const TABS = [
  ['notes', 'Notes'],
  ['find', 'Find'],
  ['links', 'Links'],
  ['snips', 'Snippets'],
  ['cmds', 'Commands'],
  ['files', 'Files'],
  ['terms', 'Glossary'],
  ['time', 'Reminders'],
  ['journal', 'Journal'],
  ['data', 'Data'],
  ['export', 'Export'],
] as const

const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['nt', '', 'List the commands of the notes mod'],
  ['ntjot', '<text>', 'Quick-capture a note for this folder (#tag words become tags)'],
  ['ntnotes', '[all|#tag]', 'Open the notes of this folder, all folders, or one tag'],
  ['nttags', '', 'Count the tags used in notes and links'],
  ['ntfind', '<text|#tag>', 'Search every store of this mod'],
  ['ntdel', '<id>...', 'Delete one record by id (n3 note, l2 link, s1 snippet, c1 command, a1 file, g1 term, r1 reminder, e1 recurring, or a journal day)'],
  ['ntlink', '<url> <title>', 'Save a link with a title (never fetched)'],
  ['ntsnip', '<lang> <name> <code>', 'Save a code snippet'],
  ['ntcmd', '<name> <command>', 'Save a shell command in the cookbook (never run)'],
  ['ntput', '<name>', 'Fill the prompt with a snippet or a saved command'],
  ['ntattach', '<name> <path> [desc]', 'Shelve a file path with a description (the file is never copied)'],
  ['ntterm', '<word> => <replacement>', 'Add a glossary term (no args lists them)'],
  ['ntfix', '', 'Apply the glossary to the draft in the prompt box'],
  ['ntremind', '15:30|in 20 <text>', 'Set a reminder; a toast appears when due'],
  ['ntevery', 'daily|weekly|monthly <text>', 'Add a recurring task, shown as a toast at session start when due'],
  ['ntjournal', '', 'Open the daily journal (tool calls and files edited per day)'],
  ['ntprofile', 'save|load|list|del <name>', 'Save or restore this mod\'s own settings under a name'],
  ['ntset', '[key value]', `Show or change this mod's settings (${SETTING_KEYS.join(', ')})`],
  ['ntkeep', '<days>|off|run', 'Retention: delete notes, links and journal older than N days at session start'],
  ['ntfile', '<path>', 'Import a text file (max 200 KB) as notes, one per line'],
  ['ntexport', '', 'Show a JSON backup of this mod\'s data in the pane (never written to disk)'],
  ['ntimport', '[replace] <json>', 'Restore from a pasted /ntexport backup (merges unless "replace")'],
  ['ntmd', '', 'Show this session as Markdown in the pane (never written to disk)'],
  ['ntopen', '[tab]', `Open the pane (${TABS.map(t => t[0]).join(', ')})`],
  ['ntwipe', 'confirm', 'Delete ALL data of this mod (needs "confirm")'],
  ['ntreset', '', 'Same as /ntwipe confirm'],
]

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

// ---------------------------------------------------------------- data access

const isMissing = (v: unknown) => v === undefined || v === null

const loadDb = async (d: Dollar): Promise<Db> => {
  const saved = await d.store.get('db').catch(() => undefined)

  if (isMissing(saved)) {
    return emptyDb()
  }
  const r = checkSchema(DB_SCHEMA, saved)

  return r.ok ? (r.value as Db) : emptyDb()
}

const persistNow = async (d: Dollar) => {
  isDirty = false
  await d.store.set('db', await read(d, dbAtom))
}

// Automatic records (journal, log) are written to the store at most every 15 s.
const persistSoon = (d: Dollar) => {
  isDirty = true

  if (persistTimer === undefined) {
    persistTimer = d.clock.after(15_000, () => {
      persistTimer = undefined
      void persistNow(d).catch(() => undefined)
    })
  }
}

const commit = async (d: Dollar, fn: (db: Db) => Db) => {
  const next = fitCap(fn(await read(d, dbAtom)))
  await update(d, dbAtom, () => next)
  await persistNow(d)
}

type AddResult = { ok: true; id: string; count: number } | { ok: false; error: string }

const addItem = async <K extends ListKey>(d: Dollar, key: K, build: (id: string) => Db[K][number]): Promise<AddResult> => {
  const cur = await read(d, dbAtom)
  const r = addTo(cur, key, build)

  if (!r.ok) {
    return r
  }
  await update(d, dbAtom, () => r.db)
  await persistNow(d)

  return { ok: true, id: r.id, count: r.db[key].length }
}

const nearCap = (key: ListKey, count: number) =>
  count >= Math.ceil(CAPS[key] * 0.9) ? ` (${count} of ${CAPS[key]}: nearly full)` : ''

const openPane = async (d: Dollar, to?: string) => {
  if (to !== undefined) {
    await update(d, tabAtom, () => to)
  }
  await d.ui.open({ id: PANE, title: 'Notes' })
}

const showView = async (d: Dollar, title: string, text: string) => {
  await update(d, viewTitle, () => title)
  await update(d, viewText, () => text)
  await openPane(d, 'export')
}

// ---------------------------------------------------------------- reminders and recurring

const syncTicker = async (d: Dollar) => {
  const has = (await read(d, dbAtom)).remind.length > 0

  if (has && ticker === undefined) {
    // One 30 s check, only while a reminder exists.
    ticker = d.clock.every(30_000, () => {
      void checkDue(d).catch(() => undefined)
    })
  } else if (!has && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}

/** Fires every due reminder in one toast; `extra` lines (session start) join the same toast. */
const checkDue = async (d: Dollar, extra: string[] = []) => {
  const now = await d.clock.now()
  const db = await read(d, dbAtom)
  const due = db.remind.filter(r => r.at <= now)
  const lines = [...due.map(r => `Reminder: ${oneLine(r.text, 80)}`), ...extra]

  if (due.length > 0) {
    await commit(d, cur => {
      const gone = new Set(due.map(r => r.id))
      let next: Db = { ...cur, remind: cur.remind.filter(r => !gone.has(r.id)) }

      for (const r of due) {
        next = addLog(next, { t: now, kind: 'remind', text: r.text })
      }

      return next
    })
  }
  await syncTicker(d)

  if (lines.length > 0) {
    d.ui.toast(clip(lines.slice(0, 4).join(' | '), 240), { timeoutMs: 12_000 })
  }
}

/** Marks every due recurring task as shown today and returns its toast lines. */
const surfaceRecurring = async (d: Dollar, now: number): Promise<string[]> => {
  const today = dayKey(now)
  const db = await read(d, dbAtom)
  const due = db.every.filter(e => isDue(e, today))

  if (due.length === 0) {
    return []
  }
  const ids = new Set(due.map(e => e.id))
  await commit(d, cur => ({ ...cur, every: cur.every.map(e => (ids.has(e.id) ? { ...e, last: today } : e)) }))

  return due.map(e => `Due (${e.kind}): ${oneLine(e.text, 80)}`)
}

// ---------------------------------------------------------------- recording (journal and log)

const record = async (d: Dollar, ev: { tool?: string; file?: string; prompt?: boolean }) => {
  const db = await read(d, dbAtom)

  if (!db.settings.journal) {
    return
  }
  const now = await d.clock.now()
  const day = dayKey(now)
  const text = ev.prompt === true ? 'prompt' : ev.file ?? ev.tool ?? ''
  const kind = ev.prompt === true ? 'prompt' : ev.file === undefined ? 'tool' : 'edit'
  await update(d, dbAtom, cur => addLog(bumpJournal(cur, day, ev), { t: now, kind, text }))
  persistSoon(d)
}

// ---------------------------------------------------------------- command helpers

type Out = { text: string }

const helpText = (): string =>
  [
    'Notes mod (nt): searchable notes, links, snippets, commands, journal, reminders. All data stays in this mod\'s store.',
    ...COMMANDS.map(([name, usage, desc]) => `/${name}${usage === '' ? '' : ` ${usage}`}  ${desc}`),
  ].join('\n')

const addMsg = async <K extends ListKey>(
  d: Dollar,
  key: K,
  build: (id: string) => Db[K][number],
  say: (id: string) => string,
): Promise<Out> => {
  const r = await addItem(d, key, build)

  return { text: r.ok ? `${say(r.id)}${nearCap(key, r.count)}` : r.error }
}

const listLines = <T,>(items: readonly T[], f: (x: T) => string, max = 12): string =>
  items.length === 0 ? '(none)' : [...items.slice(0, max).map(f), ...(items.length > max ? [`...and ${items.length - max} more`] : [])].join('\n')

const activeDraft = async (d: Dollar): Promise<string> => {
  const box = await d.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const t = box.text

  // A typed `/ntfix` may already have left the box: fall back to the last draft seen.
  return t.trim() !== '' && !/^\/nt/i.test(t.trim()) ? t : lastDraft
}

const fixDraft = async (d: Dollar): Promise<Out> => {
  const db = await read(d, dbAtom)

  if (db.terms.length === 0) {
    return { text: 'The glossary is empty. Add terms with /ntterm <word> => <replacement>.' }
  }
  const draft = await activeDraft(d)

  if (draft.trim() === '') {
    return { text: 'There is no draft in the prompt box to fix.' }
  }
  const r = applyTerms(draft, db.terms, db.settings.ci)

  if (r.count === 0) {
    return { text: 'No glossary term appears in the draft.' }
  }
  const filled = await d.prompt.fill({ text: r.text, mode: 'replace' })

  return {
    text: filled.isFilled
      ? `Fixed ${r.count} term${r.count === 1 ? '' : 's'} in the draft.`
      : `The prompt box could not take the text. Fixed draft:\n${r.text}`,
  }
}

const insertText = async (d: Dollar, text: string): Promise<boolean> => {
  const r = await d.prompt.fill({ text, mode: 'insert' }).catch(() => ({ isFilled: false }))

  return r.isFilled
}

const snipText = (s: { lang: string; code: string }) => `\`\`\`${s.lang}\n${s.code}\n\`\`\`\n`

const readFileNotes = async (d: Dollar, rawPath: string): Promise<Out> => {
  const [path] = takeToken(rawPath)

  if (path === '') {
    return { text: 'Usage: /ntfile <path>   (a text file up to 200 KB, one note per line, read-only)' }
  }
  if (path.startsWith('~')) {
    return { text: 'Use a full path or one relative to the project: ~ is not expanded.' }
  }
  const stat = await d.fs.stat(path).catch(() => undefined)

  if (stat === undefined) {
    return { text: `Cannot find ${clip(path, 80)}.` }
  }
  if (stat.kind !== 'file') {
    return { text: 'That path is not a regular file.' }
  }
  if (stat.size > MAX_FILE) {
    return { text: `That file is ${fmtBytes(stat.size)}; the limit is ${fmtBytes(MAX_FILE)}.` }
  }
  const text = await d.fs.read(path).catch(() => undefined)

  if (typeof text !== 'string') {
    return { text: 'The file could not be read as text.' }
  }
  if (looksBinary(text)) {
    return { text: 'That looks like a binary file; only text files are imported.' }
  }
  const { lines, more } = linesToNotes(text)

  if (lines.length === 0) {
    return { text: 'The file has no text lines.' }
  }
  const now = await d.clock.now()
  const cwd = await read(d, cwdAtom)
  let cur = await read(d, dbAtom)
  let added = 0
  let stop = ''

  for (const line of lines) {
    const tags = [...new Set([...parseTags(line), 'imported'])].slice(0, 8)
    const r = addTo(cur, 'notes', id => ({ id, t: now, cwd, text: line, tags }))

    if (!r.ok) {
      stop = r.error
      break
    }
    cur = r.db
    added += 1
  }
  if (added > 0) {
    await update(d, dbAtom, () => cur)
    await persistNow(d)
  }
  const skipped = lines.length - added + more

  return {
    text: `Imported ${added} note${added === 1 ? '' : 's'} from ${clip(path, 60)} (tagged #imported).${
      skipped > 0 ? ` ${skipped} line${skipped === 1 ? '' : 's'} not imported.` : ''
    }${stop === '' ? '' : ` ${stop}`}`,
  }
}

const wipeAll = async (d: Dollar): Promise<Out> => {
  persistTimer?.cancel()
  persistTimer = undefined
  isDirty = false
  lastDraft = ''
  await update(d, dbAtom, () => emptyDb())
  await d.store.delete('db')
  await update(d, viewText, () => '')
  await update(d, viewTitle, () => '')
  await update(d, queryAtom, () => '')
  await update(d, tagFilter, () => '')
  await update(d, isArmed, () => false)
  await syncTicker(d)

  return { text: 'All data of the notes mod was deleted (notes, links, snippets, commands, files, glossary, reminders, journal, profiles and settings).' }
}

const totalsText = (db: Db): string =>
  `${db.notes.length} notes, ${db.links.length} links, ${db.snips.length} snippets, ${db.cmds.length} commands, ${db.attach.length} files, ${db.terms.length} terms, ${db.remind.length} reminders, ${db.every.length} recurring, ${db.journal.length} journal days`

const findByName = <T extends { name: string }>(list: readonly T[], q: string): T | 'many' | undefined => {
  const low = q.toLowerCase()
  const exact = list.find(x => x.name.toLowerCase() === low)

  if (exact !== undefined) {
    return exact
  }
  const part = list.filter(x => x.name.toLowerCase().includes(low))

  return part.length === 1 ? part[0] : part.length > 1 ? 'many' : undefined
}

// ---------------------------------------------------------------- the commands

const runCommand = async (d: Dollar, name: string, rawArgs: string): Promise<Out> => {
  const args = rawArgs.trim()
  const now = await d.clock.now()
  const db = await read(d, dbAtom)

  switch (name) {
    case 'nt':
      return { text: helpText() }

    case 'ntjot': {
      if (args === '') {
        return { text: 'Usage: /ntjot <text>   (use #tag words to tag it)' }
      }
      if (args.length > LEN.note) {
        return { text: `A note is at most ${LEN.note} characters (this one is ${args.length}).` }
      }
      const cwd = await read(d, cwdAtom)
      const tags = parseTags(args)

      return addMsg(
        d,
        'notes',
        id => ({ id, t: now, cwd, text: args, tags }),
        id => `Saved ${id} for ${shortCwd(cwd)}${tags.length > 0 ? ` (${tags.map(t => `#${t}`).join(' ')})` : ''}.`,
      )
    }

    case 'ntnotes': {
      const low = args.toLowerCase()
      await update(d, scopeAll, () => low === 'all')
      await update(d, tagFilter, () => (low.startsWith('#') ? low.slice(1) : ''))
      await openPane(d, 'notes')
      const cwd = await read(d, cwdAtom)
      const shown = db.notes
        .filter(n => (low === 'all' || low.startsWith('#') ? true : n.cwd === cwd))
        .filter(n => !low.startsWith('#') || n.tags.includes(low.slice(1)))

      return { text: `${shown.length} notes (${low === 'all' ? 'all folders' : low.startsWith('#') ? low : shortCwd(cwd)}):\n${listLines([...shown].reverse(), n => `${n.id} ${oneLine(n.text, 90)}`, 8)}` }
    }

    case 'nttags': {
      const tags = tagCounts(db)

      return { text: tags.length === 0 ? 'No tags yet. Add #tag words to notes and link titles.' : tags.map(t => `#${t.tag} (${t.n})`).join('  ') }
    }

    case 'ntfind': {
      if (args === '') {
        return { text: 'Usage: /ntfind <text or #tag>   (searches notes, links, snippets, commands, files, terms, reminders, journal)' }
      }
      await update(d, queryAtom, () => args)
      await openPane(d, 'find')
      const r = searchAll(db, args, db.settings.findMax)

      return {
        text: r.total === 0 ? `Nothing found for "${clip(args, 40)}".` : `${r.total} found${r.total > r.hits.length ? ` (showing ${r.hits.length})` : ''}:\n${r.hits.map(h => `[${h.kind}] ${h.id} ${h.text}`).join('\n')}`,
      }
    }

    case 'ntdel': {
      const ids = args.split(/\s+/).filter(x => x !== '')

      if (ids.length === 0) {
        return { text: 'Usage: /ntdel <id> ...   (ids show in the pane and in command replies)' }
      }
      let cur = db
      const gone: string[] = []
      const missing: string[] = []

      for (const id of ids.slice(0, 20)) {
        if (DAY_RE.test(id)) {
          if (cur.journal.some(j => j.day === id)) {
            cur = { ...cur, journal: cur.journal.filter(j => j.day !== id) }
            gone.push(id)
          } else {
            missing.push(id)
          }
          continue
        }
        const r = removeById(cur, id)

        if (r.key === null) {
          missing.push(id)
        } else {
          cur = r.db
          gone.push(id)
        }
      }
      if (gone.length > 0) {
        await commit(d, () => cur)
        await syncTicker(d)
      }

      return { text: `${gone.length > 0 ? `Deleted ${gone.join(', ')}.` : ''}${missing.length > 0 ? ` Not found: ${missing.join(', ')}.` : ''}`.trim() }
    }

    case 'ntlink': {
      const p = parseLink(args)

      if (!p.ok) {
        return { text: p.error }
      }
      const tags = parseTags(p.value.title)

      return addMsg(d, 'links', id => ({ id, t: now, url: p.value.url, title: p.value.title, tags }), id => `Saved link ${id}: ${oneLine(p.value.title, 60)}`)
    }

    case 'ntsnip': {
      const p = parseSnip(rawArgs)

      if (!p.ok) {
        return { text: p.error }
      }
      const same = db.snips.find(s => s.name.toLowerCase() === p.value.name.toLowerCase())

      if (same !== undefined) {
        await commit(d, cur => ({ ...cur, snips: cur.snips.filter(s => s.id !== same.id) }))
      }

      return addMsg(d, 'snips', id => ({ id, t: now, ...p.value }), id => `${same === undefined ? 'Saved' : 'Replaced'} snippet ${id} "${p.value.name}" [${p.value.lang}]. Insert it with /ntput ${p.value.name}`)
    }

    case 'ntcmd': {
      const p = parseCmd(args)

      if (!p.ok) {
        return { text: p.error }
      }
      const same = db.cmds.find(c => c.name.toLowerCase() === p.value.name.toLowerCase())

      if (same !== undefined) {
        await commit(d, cur => ({ ...cur, cmds: cur.cmds.filter(c => c.id !== same.id) }))
      }

      return addMsg(d, 'cmds', id => ({ id, t: now, ...p.value }), id => `${same === undefined ? 'Saved' : 'Replaced'} command ${id} "${p.value.name}". It is never run: /ntput ${p.value.name} fills the prompt.`)
    }

    case 'ntput': {
      if (args === '') {
        return { text: `Usage: /ntput <name>\nSnippets: ${db.snips.map(s => s.name).join(', ') || '(none)'}\nCommands: ${db.cmds.map(c => c.name).join(', ') || '(none)'}` }
      }
      const q = args.replace(/^(snip|cmd):/i, '')
      const only = /^snip:/i.test(args) ? 'snip' : /^cmd:/i.test(args) ? 'cmd' : ''
      const s = only === 'cmd' ? undefined : findByName(db.snips, q)
      const c = only === 'snip' ? undefined : findByName(db.cmds, q)

      if (s === 'many' || c === 'many' || (s !== undefined && c !== undefined)) {
        return { text: 'More than one match. Be exact, or prefix with snip: or cmd:.' }
      }
      if (s !== undefined) {
        const text = snipText(s)

        return { text: (await insertText(d, text)) ? `Inserted snippet "${s.name}" into the prompt.` : `The prompt box could not take it. Snippet:\n${text}` }
      }
      if (c !== undefined) {
        return { text: (await insertText(d, c.cmd)) ? `Inserted command "${c.name}" into the prompt (not run).` : `The prompt box could not take it. Command:\n${c.cmd}` }
      }

      return { text: `No snippet or command named "${clip(q, 40)}".` }
    }

    case 'ntattach': {
      const p = parseAttach(args)

      if (!p.ok) {
        return { text: p.error }
      }

      return addMsg(d, 'attach', id => ({ id, t: now, ...p.value }), id => `Shelved ${id} "${p.value.name}" -> ${clip(p.value.path, 60)} (path only; the file is not copied or read).`)
    }

    case 'ntterm': {
      if (args === '') {
        return { text: `Glossary:\n${listLines(db.terms, g => `${g.id} ${g.from} => ${g.to}`, 20)}\nApply to the draft with /ntfix.` }
      }
      const p = parseTerm(args)

      if (!p.ok) {
        return { text: p.error }
      }
      const same = db.terms.find(g => g.from === p.value.from)

      if (same !== undefined) {
        await commit(d, cur => ({ ...cur, terms: cur.terms.filter(g => g.id !== same.id) }))
      }

      return addMsg(d, 'terms', id => ({ id, ...p.value }), id => `${same === undefined ? 'Added' : 'Updated'} term ${id}: ${p.value.from} => ${p.value.to}. Nothing changes until you run /ntfix.`)
    }

    case 'ntfix':
      return fixDraft(d)

    case 'ntremind': {
      if (args === '') {
        return { text: `Reminders:\n${listLines(db.remind, r => `${r.id} ${fmtAt(r.at, now)} ${oneLine(r.text, 70)}`)}\nSet one: /ntremind 15:30 <text> or /ntremind in 20 <text>` }
      }
      const w = parseWhen(args, now)

      if (!w.ok) {
        return { text: w.error }
      }
      const r = await addItem(d, 'remind', id => ({ id, at: w.at, text: oneLine(w.text, LEN.text) }))

      if (!r.ok) {
        return { text: r.error }
      }
      await syncTicker(d)

      return { text: `Reminder ${r.id} set for ${fmtAt(w.at, now)}: ${oneLine(w.text, 60)}. It is checked every 30 s while the app is open and survives restarts.` }
    }

    case 'ntevery': {
      if (args === '') {
        return { text: `Recurring tasks:\n${listLines(db.every, e => `${e.id} ${e.kind} (next ${nextDue(e.kind, e.last)}) ${oneLine(e.text, 60)}`)}\nAdd: /ntevery weekly <text>` }
      }
      const p = parseEvery(args)

      if (!p.ok) {
        return { text: p.error }
      }
      const today = dayKey(now)

      return addMsg(d, 'every', id => ({ id, kind: p.value.kind, text: p.value.text, last: today }), id => `Recurring ${id} (${p.value.kind}): ${p.value.text}. First toast at a session start on or after ${nextDue(p.value.kind, today)}.`)
    }

    case 'ntjournal': {
      await openPane(d, 'journal')
      const j = db.journal.find(x => x.day === dayKey(now))

      return { text: j === undefined ? `Nothing recorded today yet. ${db.settings.journal ? '' : 'Journal recording is off (/ntset journal on).'}` : `Today: ${j.tools} tool calls, ${j.edits} file edits, ${j.prompts} prompts, ${j.files.length} files.` }
    }

    case 'ntprofile': {
      const [sub, rest] = takeToken(args)
      const pname = rest.trim()
      const note = ' Profiles hold only this mod\'s own settings; this mod cannot read or change any other mod\'s settings.'

      if (sub === '' || sub === 'list') {
        return { text: `Profiles:\n${listLines(db.profiles, p => `${p.name}: keep ${p.settings.keepDays || 'forever'}, journal ${p.settings.journal ? 'on' : 'off'}, find ${p.settings.findMax}`)}\n${note.trim()}` }
      }
      if (pname === '' || pname.length > LEN.name) {
        return { text: `Usage: /ntprofile save|load|list|del <name> (name up to ${LEN.name} characters).` }
      }
      if (sub === 'save') {
        if (!db.profiles.some(p => p.name === pname) && db.profiles.length >= CAPS.profiles) {
          return { text: `Profiles are full (${CAPS.profiles}). Delete one with /ntprofile del <name>.` }
        }
        await commit(d, cur => ({ ...cur, profiles: [...cur.profiles.filter(p => p.name !== pname), { name: pname, settings: { ...cur.settings } }] }))

        return { text: `Saved profile "${pname}".${note}` }
      }
      const found = db.profiles.find(p => p.name === pname)

      if (found === undefined) {
        return { text: `No profile named "${clip(pname, 30)}".` }
      }
      if (sub === 'del') {
        await commit(d, cur => ({ ...cur, profiles: cur.profiles.filter(p => p.name !== pname) }))

        return { text: `Deleted profile "${pname}".` }
      }
      if (sub === 'load') {
        await commit(d, cur => ({ ...cur, settings: { ...found.settings } }))
        const keep = found.settings.keepDays

        return { text: `Restored profile "${pname}".${keep > 0 ? ` Retention is now ${keep} days: older records are deleted at each session start.` : ''}${note}` }
      }

      return { text: 'Usage: /ntprofile save|load|list|del <name>' }
    }

    case 'ntset': {
      const [key, value] = takeToken(args)

      if (key === '') {
        const s = db.settings

        return { text: `Settings: keepDays ${s.keepDays || 'off'}, journal ${s.journal ? 'on' : 'off'}, startupToast ${s.startupToast ? 'on' : 'off'}, ci (glossary ignores case) ${s.ci ? 'on' : 'off'}, findMax ${s.findMax}.\nChange: /ntset <key> <value>` }
      }
      const r = setSetting(db.settings, key, value.trim())

      if (!r.ok) {
        return { text: r.error }
      }
      await commit(d, cur => ({ ...cur, settings: r.value as Settings }))

      return { text: `Set ${key} to ${value.trim()}.` }
    }

    case 'ntkeep': {
      const low = args.toLowerCase()

      if (low === 'run') {
        const k = db.settings.keepDays
        const r = pruneByAge(db, now, k)
        const n = r.removed.notes + r.removed.links + r.removed.journal + r.removed.log

        if (k <= 0) {
          return { text: 'Retention is off. Set it with /ntkeep <days>.' }
        }
        if (n > 0) {
          await commit(d, () => r.db)
        }

        return { text: `Deleted ${r.removed.notes} notes, ${r.removed.links} links, ${r.removed.journal} journal days and ${r.removed.log} log rows older than ${k} days.` }
      }
      if (args === '') {
        const k = db.settings.keepDays

        return { text: k > 0 ? `Retention: records older than ${k} days are deleted at session start (notes, links, journal; snippets, commands, files, terms and profiles are kept). /ntkeep off to stop.` : 'Retention is off: nothing is deleted automatically. Usage: /ntkeep <days>' }
      }
      const r = setSetting(db.settings, 'keepDays', low)

      if (!r.ok) {
        return { text: 'Usage: /ntkeep <days>|off|run' }
      }
      await commit(d, cur => ({ ...cur, settings: r.value as Settings }))
      const k = (r.value as Settings).keepDays
      const would = pruneByAge(db, now, k).removed

      return {
        text: k === 0 ? 'Retention off.' : `Retention set to ${k} days. Older records are deleted at each session start; ${would.notes + would.links + would.journal + would.log} are older right now (run /ntkeep run to delete them now).`,
      }
    }

    case 'ntfile':
      return readFileNotes(d, rawArgs)

    case 'ntexport': {
      const json = JSON.stringify(db)
      await showView(d, `Backup JSON, ${fmtBytes(json.length)} (shown only, never written to disk)`, json)

      return { text: `Backup of this mod's data (${fmtBytes(json.length)}). Copy it, and restore with /ntimport <json>:\n\`\`\`json\n${json}\n\`\`\`` }
    }

    case 'ntimport': {
      const isReplace = /^replace(\s|$)/i.test(args)
      const body = isReplace ? args.replace(/^replace\s*/i, '') : args
      const v = validateImport(body)

      if (!v.ok) {
        return { text: `Nothing imported. ${v.error}` }
      }
      const m = mergeImport(db, v.db, isReplace ? 'replace' : 'merge')

      if (!m.ok) {
        return { text: m.error }
      }
      await commit(d, () => m.db)
      await syncTicker(d)

      return { text: `${isReplace ? 'Replaced all data' : 'Merged'}: ${m.added} records added${m.skipped > 0 ? `, ${m.skipped} skipped (list full)` : ''}. Now: ${totalsText(m.db)}.` }
    }

    case 'ntmd': {
      const md = buildMarkdown(db, { now, startedAt: await read(d, sessionStart), cwd: await read(d, cwdAtom) })
      await showView(d, 'Session as Markdown (shown only, never written to disk)', md)

      return { text: `Session as Markdown:\n\`\`\`markdown\n${md}\`\`\`` }
    }

    case 'ntopen': {
      const want = args.toLowerCase()
      const hit = TABS.find(t => t[0] === want || t[1].toLowerCase() === want)

      if (args !== '' && hit === undefined) {
        return { text: `Tabs: ${TABS.map(t => t[0]).join(', ')}` }
      }
      await openPane(d, hit?.[0] ?? 'notes')

      return { text: `Notes pane opened${hit === undefined ? '' : ` on ${hit[1]}`}. ${totalsText(db)}.` }
    }

    case 'ntwipe':
    case 'ntreset': {
      if (name === 'ntreset' || args.toLowerCase() === 'confirm') {
        return wipeAll(d)
      }

      return { text: `This deletes ALL notes mod data: ${totalsText(db)}, plus settings and profiles. Nothing else is touched. Type /ntwipe confirm to do it.` }
    }

    default:
      return { text: 'Unknown command.' }
  }
}

// ---------------------------------------------------------------- pane pieces

const Heading = (ui: UI, title: string, right?: string) => {
  const { Box, Text } = ui

  return (
    <Box justifyContent="space-between" marginBottom="sm">
      <Text size="heading" weight="bold">
        {title}
      </Text>
      {right !== undefined && (
        <Text dimColor mono tabular>
          {right}
        </Text>
      )}
    </Box>
  )
}

const Empty = (ui: UI, text: string) => {
  const { Text } = ui

  return <Text dimColor>{text}</Text>
}

const Section = (ui: UI, label: string) => {
  const { Box, Text } = ui

  return (
    <Box marginTop="md">
      <Text size="caption" weight="semibold" dimColor>
        {label.toUpperCase()}
      </Text>
    </Box>
  )
}

const bodyNotes = async ($: Dollar, ui: UI, room: number, now: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)
  const cwd = await read($, cwdAtom)
  const all = await read($, scopeAll)
  const tag = await read($, tagFilter)
  const tags = tagCounts(db).slice(0, 6)
  const shown = [...db.notes]
    .filter(n => all || tag !== '' || n.cwd === cwd)
    .filter(n => tag === '' || n.tags.includes(tag))
    .reverse()

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Notes', `${shown.length} of ${db.notes.length}`)}
      <Box gap="sm" flexWrap="wrap" marginBottom="sm">
        <Button key="scope-here" variant={!all ? 'primary' : undefined} label={`This folder: ${shortCwd(cwd)}`} onPress={() => update($, scopeAll, () => false)} />
        <Button key="scope-all" variant={all ? 'primary' : undefined} label="All folders" onPress={() => update($, scopeAll, () => true)} />
        {tags.map(t => (
          <Button key={`tag-${t.tag}`} variant={tag === t.tag ? 'primary' : undefined} label={`#${t.tag} ${t.n}`} onPress={() => update($, tagFilter, () => (tag === t.tag ? '' : t.tag))} />
        ))}
      </Box>
      {shown.length === 0 && Empty(ui, 'No notes here yet. Capture one with /ntjot your text #tag')}
      {shown.slice(0, room).map(n => (
        <Box gap="sm">
          <Text dimColor mono>
            {n.id}
          </Text>
          <Text dimColor tabular>
            {fmtAt(n.t, now)}
          </Text>
          <Text>{oneLine(n.text, 120)}</Text>
          <Button key={`ni-${n.id}`} dimColor label="insert" onPress={() => insertText($, n.text)} />
          <Button key={`nd-${n.id}`} dimColor label="delete" onPress={() => commit($, cur => removeById(cur, n.id).db)} />
        </Box>
      ))}
    </Box>
  )
}

const bodyFind = async ($: Dollar, ui: UI, room: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)
  const q = await read($, queryAtom)
  const r = searchAll(db, q, Math.min(room, db.settings.findMax))

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Find', q === '' ? undefined : `${r.total} found`)}
      {q === '' && Empty(ui, 'Search every store with /ntfind <text> or /ntfind #tag')}
      {q !== '' && r.total === 0 && Empty(ui, `Nothing found for "${clip(q, 40)}".`)}
      {r.hits.map(h => (
        <Box gap="sm">
          <Text color="suggestion">{h.kind}</Text>
          <Text dimColor mono>
            {h.id}
          </Text>
          <Text>{h.text}</Text>
        </Box>
      ))}
    </Box>
  )
}

const bodyLinks = async ($: Dollar, ui: UI, room: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Links', `${db.links.length} of ${CAPS.links}`)}
      {db.links.length === 0 && Empty(ui, 'Save one with /ntlink https://example.com A short title')}
      {[...db.links].reverse().slice(0, room).map(l => (
        <Box gap="sm">
          <Text dimColor mono>
            {l.id}
          </Text>
          <Text weight="semibold">{oneLine(l.title, 60)}</Text>
          <Text dimColor>{oneLine(l.url, 60)}</Text>
          <Button key={`li-${l.id}`} dimColor label="insert" onPress={() => insertText($, `${l.title} ${l.url}`)} />
          <Button key={`ld-${l.id}`} dimColor label="delete" onPress={() => commit($, cur => removeById(cur, l.id).db)} />
        </Box>
      ))}
    </Box>
  )
}

const bodySnips = async ($: Dollar, ui: UI, room: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Snippets', `${db.snips.length} of ${CAPS.snips}`)}
      {db.snips.length === 0 && Empty(ui, 'Save one with /ntsnip ts clamp const clamp = (n: number) => n')}
      {db.snips.slice(0, room).map(s => (
        <Box gap="sm">
          <Text weight="semibold">{s.name}</Text>
          <Text color="suggestion">{s.lang}</Text>
          <Text dimColor mono>
            {oneLine(s.code, 70)}
          </Text>
          <Button key={`si-${s.id}`} label="insert" onPress={() => insertText($, snipText(s))} />
          <Button key={`sd-${s.id}`} dimColor label="delete" onPress={() => commit($, cur => removeById(cur, s.id).db)} />
        </Box>
      ))}
    </Box>
  )
}

const bodyCmds = async ($: Dollar, ui: UI, room: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Command cookbook', `${db.cmds.length} of ${CAPS.cmds}`)}
      {Empty(ui, 'Insert only fills the prompt. Nothing here is ever run.')}
      {db.cmds.length === 0 && Empty(ui, 'Save one with /ntcmd tests npm test -- --watch')}
      {db.cmds.slice(0, room).map(c => (
        <Box gap="sm">
          <Text weight="semibold">{c.name}</Text>
          <Text dimColor mono>
            {oneLine(c.cmd, 80)}
          </Text>
          <Button key={`ci-${c.id}`} label="insert" onPress={() => insertText($, c.cmd)} />
          <Button key={`cd-${c.id}`} dimColor label="delete" onPress={() => commit($, cur => removeById(cur, c.id).db)} />
        </Box>
      ))}
    </Box>
  )
}

const bodyFiles = async ($: Dollar, ui: UI, room: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Attachment shelf', `${db.attach.length} of ${CAPS.attach}`)}
      {Empty(ui, 'Paths and descriptions only: files are never copied or read.')}
      {db.attach.length === 0 && Empty(ui, 'Shelve one with /ntattach spec ./docs/spec.md the design spec')}
      {db.attach.slice(0, room).map(a => (
        <Box gap="sm">
          <Text weight="semibold">{a.name}</Text>
          <Text mono dimColor>
            {oneLine(a.path, 60)}
          </Text>
          <Text>{oneLine(a.desc, 50)}</Text>
          <Button key={`ai-${a.id}`} dimColor label="insert path" onPress={() => insertText($, a.path)} />
          <Button key={`ad-${a.id}`} dimColor label="delete" onPress={() => commit($, cur => removeById(cur, a.id).db)} />
        </Box>
      ))}
    </Box>
  )
}

const bodyTerms = async ($: Dollar, ui: UI, room: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Glossary', `${db.terms.length} of ${CAPS.terms}`)}
      {Empty(ui, 'Applied only when you ask: /ntfix or the button, to the draft in the prompt box.')}
      {db.terms.length === 0 && Empty(ui, 'Add one with /ntterm teh => the')}
      {db.terms.slice(0, room).map(g => (
        <Box gap="sm">
          <Text mono>{g.from}</Text>
          <Text dimColor>{'=>'}</Text>
          <Text mono color="suggestion">
            {g.to}
          </Text>
          <Button key={`gd-${g.id}`} dimColor label="delete" onPress={() => commit($, cur => removeById(cur, g.id).db)} />
        </Box>
      ))}
      {db.terms.length > 0 && (
        <Box marginTop="md">
          <Button
            key="fix-draft"
            label="Fix my draft"
            onPress={async () => {
              const r = await fixDraft($)
              $.ui.toast(r.text, { timeoutMs: 4000 })
            }}
          />
        </Box>
      )}
    </Box>
  )
}

const bodyTime = async ($: Dollar, ui: UI, room: number, now: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Reminders', `${db.remind.length} of ${CAPS.remind}`)}
      {db.remind.length === 0 && Empty(ui, 'Set one with /ntremind 15:30 stand up   or   /ntremind in 20 check the build')}
      {[...db.remind].sort((a, b) => a.at - b.at).slice(0, room).map(r => (
        <Box gap="sm">
          <Text dimColor mono>
            {r.id}
          </Text>
          <Text color="suggestion" tabular>
            {fmtAt(r.at, now)}
          </Text>
          <Text>{oneLine(r.text, 80)}</Text>
          <Button key={`rd-${r.id}`} dimColor label="delete" onPress={async () => {
            await commit($, cur => removeById(cur, r.id).db)
            await syncTicker($)
          }} />
        </Box>
      ))}
      {Section(ui, `Recurring (${db.every.length} of ${CAPS.every})`)}
      {db.every.length === 0 && Empty(ui, 'Add one with /ntevery weekly review the backlog')}
      {db.every.map(e => (
        <Box gap="sm">
          <Text dimColor mono>
            {e.id}
          </Text>
          <Text color="suggestion">{e.kind}</Text>
          <Text>{oneLine(e.text, 70)}</Text>
          <Text dimColor>next {nextDue(e.kind, e.last)}</Text>
          <Button key={`ed-${e.id}`} dimColor label="delete" onPress={() => commit($, cur => removeById(cur, e.id).db)} />
        </Box>
      ))}
    </Box>
  )
}

const bodyJournal = async ($: Dollar, ui: UI, room: number) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Daily journal', `${db.journal.length} of ${CAPS.journal} days`)}
      {!db.settings.journal && Empty(ui, 'Recording is off. Turn it on with /ntset journal on')}
      {db.journal.length === 0 && Empty(ui, 'Entries appear on their own once tools run: counts only, no commands or contents.')}
      {[...db.journal].reverse().slice(0, Math.max(2, Math.floor(room / 3))).map(j => (
        <Box flexDirection="column" marginBottom="sm">
          <Box gap="sm">
            <Text weight="semibold" tabular>
              {j.day}
            </Text>
            <Text tabular>
              {j.tools} tools, {j.edits} edits, {j.prompts} prompts
            </Text>
          </Box>
          {j.top.length > 0 && <Text dimColor>{[...j.top].sort((a, b) => b.n - a.n).slice(0, 5).map(t => `${t.tool} ${t.n}`).join(', ')}</Text>}
          {j.files.slice(0, 4).map(f => (
            <Text mono dimColor>
              {oneLine(f, 90)}
            </Text>
          ))}
          {j.files.length > 4 && <Text dimColor>...and {j.files.length - 4} more files</Text>}
        </Box>
      ))}
    </Box>
  )
}

const bodyData = async ($: Dollar, ui: UI) => {
  const { Box, Text, Button } = ui
  const db = await read($, dbAtom)
  const armed = await read($, isArmed)
  const total = sizeOf(db)
  const rows: [string, number, number, number][] = [
    ['Notes', db.notes.length, CAPS.notes, JSON.stringify(db.notes).length],
    ['Links', db.links.length, CAPS.links, JSON.stringify(db.links).length],
    ['Snippets', db.snips.length, CAPS.snips, JSON.stringify(db.snips).length],
    ['Commands', db.cmds.length, CAPS.cmds, JSON.stringify(db.cmds).length],
    ['Files', db.attach.length, CAPS.attach, JSON.stringify(db.attach).length],
    ['Glossary', db.terms.length, CAPS.terms, JSON.stringify(db.terms).length],
    ['Reminders', db.remind.length, CAPS.remind, JSON.stringify(db.remind).length],
    ['Recurring', db.every.length, CAPS.every, JSON.stringify(db.every).length],
    ['Journal', db.journal.length, CAPS.journal, JSON.stringify(db.journal).length],
    ['Activity log', db.log.length, CAPS.log, JSON.stringify(db.log).length],
    ['Profiles', db.profiles.length, CAPS.profiles, JSON.stringify(db.profiles).length],
  ]
  const s = db.settings

  return (
    <Box flexDirection="column">
      {Heading(ui, 'What this mod stores', `${fmtBytes(total)} of ${fmtBytes(MAX_TOTAL)}`)}
      {rows.map(([label, n, cap, bytes]) => (
        <Box gap="sm">
          <Text mono>{label.padEnd(13)}</Text>
          <Text mono tabular>
            {`${String(n).padStart(3)} / ${String(cap).padEnd(3)}`}
          </Text>
          <Text dimColor mono tabular>
            {fmtBytes(bytes)}
          </Text>
        </Box>
      ))}
      {Section(ui, 'Settings')}
      <Text>
        keep {s.keepDays > 0 ? `${s.keepDays} days` : 'forever'}, journal {s.journal ? 'on' : 'off'}, startup toast {s.startupToast ? 'on' : 'off'}, glossary ignores case {s.ci ? 'yes' : 'no'}, find shows {s.findMax}
      </Text>
      <Text dimColor>Profiles ({db.profiles.map(p => p.name).join(', ') || 'none'}) hold only these settings, never other mods' settings.</Text>
      {Section(ui, 'Privacy')}
      <Text dimColor>Everything is in this mod's store on this computer. Commands saved here are never run; files are never copied.</Text>
      <Box gap="sm" marginTop="sm">
        {!armed && <Button key="wipe-arm" label="Wipe all data..." onPress={() => update($, isArmed, () => true)} />}
        {armed && <Text color="error">Delete everything this mod stores?</Text>}
        {armed && <Button key="wipe-yes" variant="primary" label="Yes, wipe all" onPress={() => wipeAll($)} />}
        {armed && <Button key="wipe-no" label="Cancel" onPress={() => update($, isArmed, () => false)} />}
      </Box>
    </Box>
  )
}

const bodyExport = async ($: Dollar, ui: UI, room: number) => {
  const { Box, Text, Button } = ui
  const title = await read($, viewTitle)
  const text = await read($, viewText)
  const lines = text === '' ? [] : text.split('\n')
  const shown = lines.slice(0, Math.max(5, room)).map(l => clip(l, 3000))

  return (
    <Box flexDirection="column">
      {Heading(ui, 'Export', text === '' ? undefined : fmtBytes(text.length))}
      {text === '' && Empty(ui, 'Run /ntexport for a JSON backup or /ntmd for the session as Markdown. Both are only shown here, never written to disk.')}
      {text !== '' && <Text weight="semibold">{title}</Text>}
      {shown.map(l => (
        <Text mono>{l === '' ? ' ' : l}</Text>
      ))}
      {lines.length > shown.length && <Text dimColor>...{lines.length - shown.length} more lines; the full text is in the command reply.</Text>}
    </Box>
  )
}

// ---------------------------------------------------------------- session start

const startSession = async ($: Dollar, cwd: string) => {
  for (const [name, usage, description] of COMMANDS) {
    await $.command.register({ name, description: clip(`${usage === '' ? '' : `${usage}: `}${description}`, 120) }).catch(() => undefined)
  }
  const now = await $.clock.now()
  await update($, cwdAtom, () => cwd)
  await update($, sessionStart, () => now)
  let db = await loadDb($)
  await update($, dbAtom, () => db)
  const extra: string[] = []
  const keep = db.settings.keepDays

  if (keep > 0) {
    const r = pruneByAge(db, now, keep)
    const n = r.removed.notes + r.removed.links + r.removed.journal + r.removed.log

    if (n > 0) {
      db = r.db
      await commit($, () => db)
      extra.push(`Retention: removed ${r.removed.notes} notes, ${r.removed.links} links older than ${keep} days`)
    }
  }
  if (db.settings.startupToast) {
    extra.push(...(await surfaceRecurring($, now)))
  }
  await checkDue($, extra)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await startSession($, e.cwd).catch(() => undefined)

    return next(e)
  })

  for (const [command] of COMMANDS) {
    on('command.run', { command }, async ($, e) => runCommand($, command, e.args).catch(() => ({ text: `/${command} failed; see /ntopen data for what is stored.` })))
  }

  // Keeps the last real draft so /ntfix still works when sending the command emptied the box.
  on('prompt.change', async ($, e, next) => {
    if (e.origin.kind !== 'clear' && e.text.trim() !== '' && !e.text.trimStart().startsWith('/')) {
      lastDraft = e.text.slice(0, 20_000)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.text.trimStart().startsWith('/')) {
      await record($, { prompt: true }).catch(() => undefined)
    }

    return next(e)
  })

  // Counts only the tool's name and an edited file's path; commands and contents are never kept.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const path = EDIT_TOOLS.has(e.tool) ? String(input.file_path ?? input.notebook_path ?? '') : ''
    await record($, path === '' ? { tool: e.tool } : { tool: e.tool, file: path }).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (isDirty) {
      await persistNow($).catch(() => undefined)
    }
    if ((await read($, dbAtom)).remind.length > 0) {
      await checkDue($).catch(() => undefined)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    persistTimer?.cancel()
    persistTimer = undefined
    ticker?.cancel()
    ticker = undefined

    if (isDirty) {
      await persistNow($).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    const tab = await read($, tabAtom)
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 8)
    const now = await $.clock.now()
    let body: unknown

    switch (tab) {
      case 'find':
        body = await bodyFind($, ui, room)
        break
      case 'links':
        body = await bodyLinks($, ui, room)
        break
      case 'snips':
        body = await bodySnips($, ui, room)
        break
      case 'cmds':
        body = await bodyCmds($, ui, room)
        break
      case 'files':
        body = await bodyFiles($, ui, room)
        break
      case 'terms':
        body = await bodyTerms($, ui, room)
        break
      case 'time':
        body = await bodyTime($, ui, room, now)
        break
      case 'journal':
        body = await bodyJournal($, ui, room)
        break
      case 'data':
        body = await bodyData($, ui)
        break
      case 'export':
        body = await bodyExport($, ui, room)
        break
      default:
        body = await bodyNotes($, ui, room, now)
    }

    return (
      <Box flexDirection="column" padding="sm">
        <Box gap="sm" flexWrap="wrap" marginBottom="sm">
          {TABS.map(([id, label]) => (
            <Button
              key={`tab-${id}`}
              variant={id === tab ? 'primary' : undefined}
              label={id === tab ? `* ${label}` : label}
              onPress={() => update($, tabAtom, () => id)}
            />
          ))}
        </Box>
        {body as never}
      </Box>
    )
  })
}

