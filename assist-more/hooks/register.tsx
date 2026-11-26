import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Db, Line, View } from '../types'
import {
  BUILTIN_PROFILES,
  CAPS,
  COMMANDS,
  DOCTOR_TOOLS,
  FLAG_NAMES,
  PLAIN_SECTION,
  addOption,
  addRecorded,
  analyzeProject,
  applyProfile,
  cleanGlyph,
  clip,
  closeSiblings,
  contrastText,
  decisionTable,
  destructiveSummary,
  doctorLines,
  emptyDb,
  estimateText,
  fixKey,
  flagsText,
  fmtDur,
  goalLines,
  helpText,
  isQuiet,
  joinPath,
  judgeTool,
  leafOf,
  noteFix,
  parentOf,
  parseGoal,
  parseHourRange,
  parseOnOff,
  parseOption,
  parsePorcelain,
  pathCandidates,
  plural,
  profileOf,
  projectLines,
  putRunbook,
  quietRanges,
  quietStrip,
  recordAnswers,
  riskyEdit,
  runbookName,
  runbookPrompt,
  runbookText,
  sanitizeDb,
  splitPrompt,
  tickGoal,
  toastAllowed,
  undoGuide,
  usualAnswer,
} from './pure'
import type { FixSeen, GitFacts } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'assist-more-main'
const STORE_KEY = 'assist-more'
const TABS = ['Doctor', 'Project', 'Runbooks', 'Task', 'Decide', 'Goals', 'Quiet', 'Buddy', 'Profiles'] as const

const DEFAULT_VIEW: View = { tab: 'Doctor', sel: '', isBusy: false, doctor: [], project: [] }

const dbA = atom({ plugin: 'assist-more', key: 'db' } as const, emptyDb(), { shape: 'db-1' })
const viewA = atom({ plugin: 'assist-more', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-1' })
// Owned by the settings mod: read only, with the defaults used when it never wrote them.
const calmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')

// In-memory only (reset with every session): when this mod last toasted, fixes seen, the fix on offer.
let lastToastAt = -Infinity
let fixSeen: FixSeen = {}
let pendingFix: { from: string; to: string } | null = null

type Call = { tool: string } & Record<string, unknown>
type Ran = { deny?: string; result?: unknown }

// ---------------------------------------------------------------- storage

const loadDb = async (d: Dollar) => {
  const raw = await d.store.get(STORE_KEY).catch(() => undefined)
  await update(d, dbA, () => sanitizeDb(raw))
}

const setDb = async (d: Dollar, fn: (db: Db) => Db) => {
  await update(d, dbA, fn)
  await d.store.set(STORE_KEY, await read(d, dbA)).catch(() => undefined)
}

const setView = (d: Dollar, patch: Partial<View>) => update(d, viewA, v => ({ ...v, ...patch }))

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const asText = (lines: readonly Line[]) => lines.map(l => l.t).join('\n')

// ---------------------------------------------------------------- toasts (one gate for the whole mod)

const canToast = async (d: Dollar): Promise<boolean> => {
  const [calm, db, now] = await Promise.all([read(d, calmA), read(d, dbA), d.clock.now()])

  return toastAllowed({ isCalm: calm, quiet: db.quiet, now, lastAt: lastToastAt })
}

const toast = async (d: Dollar, text: string, ms = 8000): Promise<boolean> => {
  if (!(await canToast(d))) return false
  lastToastAt = await d.clock.now()

  try {
    await d.ui.toast(text, { timeoutMs: ms })
  } catch {
    return false
  }

  return true
}

// ---------------------------------------------------------------- scans

const scanDoctor = async (d: Dollar): Promise<Line[]> => {
  const rows = await Promise.all(
    DOCTOR_TOOLS.map(async t => {
      try {
        return judgeTool(t, await d.process.run(t.argv, { timeoutMs: 5000 }))
      } catch {
        return judgeTool(t, undefined)
      }
    }),
  )

  return doctorLines(rows)
}

const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'requirements.txt']

const scanProject = async (d: Dollar): Promise<Line[]> => {
  const cwd = await d.session.cwd()
  const entries = await d.fs.list(cwd)
  const names = entries.slice(0, CAPS.listing).map(e => e.name)
  const manifests: { name: string; text: string }[] = []

  for (const n of MANIFESTS) {
    if (!names.includes(n)) continue

    try {
      manifests.push({ name: n, text: await d.fs.read(`${cwd}/${n}`, { as: 'text', offset: 0, length: CAPS.manifest }) })
    } catch {
      // unreadable manifest: the card just knows less
    }
  }

  return projectLines(analyzeProject(names, manifests, entries.length > CAPS.listing), cwd)
}

const refreshTab = async (d: Dollar, tab: string) => {
  if (tab !== 'Doctor' && tab !== 'Project') return
  await setView(d, { isBusy: true })

  try {
    const lines = tab === 'Doctor' ? await scanDoctor(d) : await scanProject(d)
    await setView(d, tab === 'Doctor' ? { doctor: lines } : { project: lines })
  } catch (err) {
    const lines: Line[] = [{ t: `Could not read: ${msgOf(err)}`, c: 'error' }]
    await setView(d, tab === 'Doctor' ? { doctor: lines } : { project: lines })
  } finally {
    await setView(d, { isBusy: false })
  }
}

// ---------------------------------------------------------------- git, read only

const READ_ONLY_GIT = new Set(['rev-parse', 'status', 'log'])

const gitRead = async (d: Dollar, args: string[]) => {
  const sub = args.find(a => !a.startsWith('-'))

  if (sub === undefined || !READ_ONLY_GIT.has(sub)) {
    throw new Error(`git ${sub ?? ''} is not on the read-only list`)
  }

  return d.process.run(['git', ...args], { timeoutMs: 10_000 })
}

const gatherGit = async (d: Dollar): Promise<GitFacts> => {
  const none: GitFacts = { isRepo: false, changed: [], staged: 0, untracked: 0, last: '', hasCommit: false, branch: '' }

  try {
    const top = await gitRead(d, ['rev-parse', '--show-toplevel'])

    if (top.exitCode !== 0) return none
    const status = await gitRead(d, ['--no-optional-locks', 'status', '--porcelain'])
    const branch = await gitRead(d, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const last = await gitRead(d, ['log', '-1', '--format=%h %s'])
    const p = parsePorcelain(status.stdout)

    return { isRepo: true, ...p, last: last.exitCode === 0 ? last.stdout.trim() : '', hasCommit: last.exitCode === 0 && last.stdout.trim() !== '', branch: branch.exitCode === 0 ? branch.stdout.trim() : '' }
  } catch {
    return none
  }
}

// ---------------------------------------------------------------- prompt and pane helpers

const fillPrompt = async (d: Dollar, text: string): Promise<string> => {
  const r = await d.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)

  return r?.isFilled === true ? 'Prompt is in the box. Edit it if you like, then press Enter to send. Nothing was sent or run.' : `Could not fill the prompt box. The text:\n${text}`
}

const openPane = async (d: Dollar, tab?: string): Promise<boolean> => {
  if (tab !== undefined) await setView(d, { tab })
  const r = await d.ui.open({ id: PANE, title: 'Assist more' }).catch(() => undefined)

  return r?.isPlaced === true
}

const tabFromWord = (w: string): string | undefined => TABS.find(t => t.toLowerCase() === w.trim().toLowerCase())

const pressTab = async (d: Dollar, tab: string) => {
  await setView(d, { tab })
  const v = await read(d, viewA)

  if ((tab === 'Doctor' && v.doctor.length === 0) || (tab === 'Project' && v.project.length === 0)) {
    await refreshTab(d, tab)
  }
}

// ---------------------------------------------------------------- commands

const firstWord = (s: string): [string, string] => {
  const t = s.trim()
  const i = t.search(/\s/)

  return i === -1 ? [t.toLowerCase(), ''] : [t.slice(0, i).toLowerCase(), t.slice(i + 1).trim()]
}

const cmdDoctor = async (d: Dollar) => {
  await refreshTab(d, 'Doctor')

  return asText((await read(d, viewA)).doctor)
}

const cmdProject = async (d: Dollar) => {
  await refreshTab(d, 'Project')

  return asText((await read(d, viewA)).project)
}

const cmdRun = async (d: Dollar, args: string): Promise<string> => {
  const [sub, rest] = firstWord(args)
  const db = await read(d, dbA)
  const find = (n: string) => db.runbooks.find(r => r.name === runbookName(n))

  if (sub === 'start') {
    const name = runbookName(rest)

    if (name === undefined) return 'Usage: /amrun start <name> (letters, digits, - and _, up to 32 characters).'

    if (db.recording !== null) return `Already recording "${db.recording.name}" (${plural(db.recording.cmds.length, 'command')}). Run /amrun stop first.`
    await setDb(d, x => ({ ...x, recording: { name, cmds: [] } }))

    return `Recording "${name}": Bash commands from now on are noted here (secrets masked, nothing is executed by this). /amrun stop saves it.`
  }

  if (sub === 'stop') {
    if (db.recording === null) return 'Not recording. Start with /amrun start <name>.'
    const rec = db.recording
    const now = await d.clock.now()

    if (rec.cmds.length === 0) {
      await setDb(d, x => ({ ...x, recording: null }))

      return `Stopped "${rec.name}": no Bash commands were seen, so nothing was saved.`
    }
    await setDb(d, x => ({ ...x, recording: null, runbooks: putRunbook(x.runbooks, { name: rec.name, cmds: rec.cmds, at: now }) }))
    await setView(d, { sel: rec.name })

    return `Saved run-book "${rec.name}" with ${plural(rec.cmds.length, 'command')}. /amrun show ${rec.name} to read it, /amrun fill ${rec.name} to put it in the prompt.`
  }

  if (sub === 'show') {
    const rb = find(rest)

    return rb === undefined ? `No run-book "${rest}". /amrun list shows them.` : runbookText(rb)
  }

  if (sub === 'fill') {
    const rb = find(rest)

    return rb === undefined ? `No run-book "${rest}". /amrun list shows them.` : fillPrompt(d, runbookPrompt(rb))
  }

  if (sub === 'del') {
    const rb = find(rest)

    if (rb === undefined) return `No run-book "${rest}".`
    await setDb(d, x => ({ ...x, runbooks: x.runbooks.filter(r => r.name !== rb.name) }))

    return `Deleted run-book "${rb.name}".`
  }
  const status = db.recording === null ? 'Not recording.' : `Recording "${db.recording.name}": ${plural(db.recording.cmds.length, 'command')} so far.`

  return db.runbooks.length === 0 && sub === ''
    ? `${status} No run-books yet. /amrun start <name> begins one.`
    : `${status}\n${db.runbooks.length === 0 ? 'No run-books yet.' : db.runbooks.map(r => `${r.name} (${plural(r.cmds.length, 'command')})`).join('\n')}\nUsage: /amrun start <name> | stop | show <name> | list | fill <name> | del <name>`
}

const cmdTask = async (d: Dollar, args: string): Promise<string> => {
  const [sub, rest] = firstWord(args)
  const db = await read(d, dbA)
  const now = await d.clock.now()

  if (sub === 'start') {
    const label = clip(rest, 80)

    if (label === '') return 'Usage: /amtask start <label>, for example /amtask start fix login redirect bug'

    if (db.active !== null) return `Already timing "${db.active.label}" (${fmtDur(now - db.active.at)}). /amtask done or /amtask cancel first.`
    await setDb(d, x => ({ ...x, active: { label, at: now } }))

    return `Started "${label}". ${estimateText(db.tasks, label)}`
  }

  if (sub === 'done') {
    if (db.active === null) return 'No task is being timed. /amtask start <label> begins one.'
    const a = db.active
    const ms = now - a.at

    if (ms > 86_400_000) {
      await setDb(d, x => ({ ...x, active: null }))

      return `"${a.label}" was open for more than a day, so it was not recorded (probably forgotten).`
    }
    await setDb(d, x => ({ ...x, active: null, tasks: [...x.tasks, { label: a.label, ms, at: now }].slice(-CAPS.tasks) }))

    return `Done: "${a.label}" took ${fmtDur(ms)}. Earlier guess: ${estimateText(db.tasks, a.label)}`
  }

  if (sub === 'cancel') {
    await setDb(d, x => ({ ...x, active: null }))

    return 'Task timer cleared; nothing recorded.'
  }

  if (sub === 'list') {
    return db.tasks.length === 0 ? 'No finished tasks yet.' : db.tasks.slice(-10).reverse().map(t => `${fmtDur(t.ms).padEnd(7)} ${t.label}`).join('\n')
  }

  return db.active === null ? `No task is being timed (${plural(db.tasks.length, 'finished task')} remembered). /amtask start <label> | done | cancel | list` : `Timing "${db.active.label}": ${fmtDur(now - db.active.at)} so far. ${estimateText(db.tasks, db.active.label)}`
}

const cmdSplit = async (d: Dollar, args: string): Promise<string> => {
  let request = args.trim()

  if (request === '') {
    const box = await d.prompt.read().catch(() => undefined)
    const text = box?.text?.trim() ?? ''
    request = text.startsWith('/') ? '' : text
  }

  return fillPrompt(d, splitPrompt(request))
}

const cmdDecide = async (d: Dollar, args: string): Promise<string> => {
  const q = args.trim()

  if (q.toLowerCase() === 'clear') {
    await setDb(d, x => ({ ...x, decision: { question: '', options: [] } }))

    return 'Decision cleared.'
  }

  if (q !== '') await setDb(d, x => ({ ...x, decision: { question: clip(q, 120), options: [] } }))

  return decisionTable((await read(d, dbA)).decision).join('\n')
}

const cmdOpt = async (d: Dollar, args: string): Promise<string> => {
  const [sub, rest] = firstWord(args)
  const db = await read(d, dbA)

  if (sub === '') return decisionTable(db.decision).join('\n')

  if (sub === 'del') {
    const n = Number(rest)

    if (!Number.isInteger(n) || n < 1 || n > db.decision.options.length) return 'Usage: /amopt del <number from the table>'
    await setDb(d, x => ({ ...x, decision: { ...x.decision, options: x.decision.options.filter((_, i) => i !== n - 1) } }))

    return decisionTable((await read(d, dbA)).decision).join('\n')
  }
  const opt = parseOption(args)

  if (opt === undefined) return 'Usage: /amopt <option> + <pro> (weight 1-5) - <con> (weight 1-5), for example /amopt Redis + fast (3) + simple - uses memory (2)'

  if (db.decision.options.length >= CAPS.options && !db.decision.options.some(o => o.name.toLowerCase() === opt.name.toLowerCase())) {
    return `At most ${CAPS.options} options. /amopt del <n> removes one.`
  }
  await setDb(d, x => ({ ...x, decision: addOption(x.decision, opt) }))

  return decisionTable((await read(d, dbA)).decision).join('\n')
}

const FLAG_TEXT: Record<string, { label: string; on: string; off: string }> = {
  risk: { label: 'Risk reminder', on: 'toasts (max one per 3 minutes) when an edit touches Dockerfile, CI yml, Makefile or package.json scripts', off: 'silent' },
  typo: { label: 'Gentle correction', on: 'toasts when a Bash path looks like a typo of a nearby existing one; it never blocks the command', off: 'silent' },
  summary: { label: 'Confirmation summaries', on: 'one line above destructive-looking rm, mv and git clean; it never blocks', off: 'no banner' },
  learn: { label: 'Learning moments', on: 'one toast when the same Edit fix happens twice, offering /amlearn save', off: 'nothing is watched' },
  defaults: { label: 'Smart defaults', on: 'your answers to AskUserQuestion prompts are counted on this machine, and a hint shows your usual one', off: 'answers are not recorded' },
  plain: { label: 'Plain-language mode', on: 'the model is asked to avoid jargon and explain terms', off: 'normal wording' },
}

const cmdFlag = async (d: Dollar, flag: (typeof FLAG_NAMES)[number], args: string): Promise<string> => {
  const want = parseOnOff(args)
  const t = FLAG_TEXT[flag]!

  if (want === undefined && args.trim() !== '') return `Usage: /am${flag} on|off`

  if (want !== undefined) {
    await setDb(d, x => ({ ...x, flags: { ...x.flags, [flag]: want } }))
  }
  const now = (await read(d, dbA)).flags[flag]

  return `${t.label} is ${now ? 'on' : 'off'}: ${now ? t.on : t.off}.`
}

const cmdUndo = async (d: Dollar) => undoGuide(await gatherGit(d))

const cmdLearn = async (d: Dollar, args: string): Promise<string> => {
  const [sub, rest] = firstWord(args)
  const db = await read(d, dbA)

  if (sub === 'save') {
    if (pendingFix === null) return 'No fix is waiting. When learning moments are on and the same fix happens twice, it is offered here.'
    const fix = pendingFix
    const now = await d.clock.now()
    pendingFix = null
    await setDb(d, x => ({ ...x, fixes: [...x.fixes, { from: fix.from, to: fix.to, at: now }].slice(-CAPS.fixes) }))

    return `Saved: "${clip(fix.from, 50)}" -> "${clip(fix.to, 50)}". /amlearn list shows your saved fixes.`
  }

  if (sub === 'list') {
    return db.fixes.length === 0 ? 'No saved fixes.' : db.fixes.map((f, i) => `${i + 1}. "${clip(f.from, 50)}" -> "${clip(f.to, 50)}"`).join('\n')
  }

  if (sub === 'clear') {
    pendingFix = null
    fixSeen = {}
    await setDb(d, x => ({ ...x, fixes: [] }))

    return 'Cleared saved fixes and what was being watched.'
  }

  return cmdFlag(d, 'learn', sub === 'on' || sub === 'off' ? sub : rest)
}

const cmdDefaults = async (d: Dollar, args: string): Promise<string> => {
  const [sub] = firstWord(args)
  const db = await read(d, dbA)

  if (sub === 'list') {
    const rows = Object.entries(db.answers).map(([q, counts]) => `${clip(q, 60)}: ${Object.entries(counts).map(([a, n]) => `${a} x${n}`).join(', ')}`)

    return rows.length === 0 ? 'No answers recorded.' : rows.join('\n')
  }

  if (sub === 'clear') {
    await setDb(d, x => ({ ...x, answers: {} }))

    return 'Cleared the remembered answers.'
  }

  return cmdFlag(d, 'defaults', args)
}

const cmdContrast = async (_d: Dollar, args: string): Promise<string> => {
  const w = args.trim().split(/\s+/).filter(Boolean)

  if (w.length === 1) return `${contrastText(w[0]!, '#ffffff')}\n${contrastText(w[0]!, '#000000')}`

  return contrastText(w[0] ?? '', w[1] ?? '')
}

const cmdQuiet = async (d: Dollar, args: string): Promise<string> => {
  const [sub, rest] = firstWord(args)
  const show = async () => {
    const q = (await read(d, dbA)).quiet

    return `Quiet hours (no toasts from this mod): ${quietRanges(q)}\n${quietStrip(q)}\n0     6     12    18   23  (local hour)\nUsage: /amquiet 22-7 | toggle <hour> | none | all. The pane (/ampane quiet) has a button for each hour.`
  }

  if (sub === '') return show()

  if (sub === 'none' || sub === 'all') {
    await setDb(d, x => ({ ...x, quiet: Array.from({ length: 24 }, () => sub === 'all') }))

    return show()
  }

  if (sub === 'toggle') {
    const h = Number(rest)

    if (!Number.isInteger(h) || h < 0 || h > 23) return 'Usage: /amquiet toggle <hour 0-23>'
    await setDb(d, x => ({ ...x, quiet: x.quiet.map((v, i) => (i === h ? !v : v)) }))

    return show()
  }
  const hours = parseHourRange(args)

  if (hours === undefined) return 'Usage: /amquiet 22-7 (from 22:00 to 07:00) | toggle <hour> | none | all'
  await setDb(d, x => ({ ...x, quiet: Array.from({ length: 24 }, (_, h) => hours.includes(h)) }))

  return show()
}

const AUDIO = /\.(wav|mp3|aiff?|m4a|caf|ogg)$/i

const cmdSound = async (d: Dollar, args: string): Promise<string> => {
  const dir = `${d.plugin.root}/sounds`
  let files: string[] = []

  try {
    files = (await d.fs.list(dir)).filter(e => e.kind === 'file' && AUDIO.test(e.name)).map(e => e.name).sort()
  } catch {
    // no folder: handled below
  }
  const names = files.map(f => f.replace(AUDIO, ''))
  const how = `Copy your own wav files into ${dir} (then run /amsound <name>). Only files in that folder can be played.`
  const want = args.trim()

  if (want === '') return files.length === 0 ? `No sounds found. ${how}` : `Sounds: ${names.join(', ')}\n${how}`

  if (!/^[A-Za-z0-9_-]{1,40}$/.test(want)) return 'A sound name is letters, digits, - and _ only.'
  const idx = names.findIndex(n => n.toLowerCase() === want.toLowerCase())

  if (idx === -1) return `No sound "${want}". ${files.length === 0 ? how : `Available: ${names.join(', ')}`}`

  try {
    await d.audio.play({ asset: `sounds/${files[idx]}` })
  } catch (err) {
    return `Could not play ${files[idx]}: ${msgOf(err)}`
  }

  return `Played ${files[idx]}.`
}

const spriteText = (db: Db) => `${db.sprite.name}  ${db.sprite.frames[db.sprite.pick] ?? ''}   (glyph ${db.sprite.pick + 1} of ${db.sprite.frames.length}: ${db.sprite.frames.join('  ')})`

const cmdSprite = async (d: Dollar, args: string): Promise<string> => {
  const [sub, rest] = firstWord(args)
  const db = await read(d, dbA)

  if (sub === 'name') {
    const name = clip(rest.replace(/[\u0000-\u001f\u007f]/g, '').trim(), 16)

    if (name === '') return 'Usage: /amsprite name <text>'
    await setDb(d, x => ({ ...x, sprite: { ...x.sprite, name } }))
  } else if (sub === 'add') {
    const g = cleanGlyph(args.trim().slice(3))

    if (g === '') return 'Usage: /amsprite add <glyph> (a short piece of text, up to 12 characters)'

    if (db.sprite.frames.length >= CAPS.frames) return `At most ${CAPS.frames} glyphs: /amsprite clear starts over.`
    await setDb(d, x => ({ ...x, sprite: { ...x.sprite, frames: [...x.sprite.frames, g], pick: x.sprite.frames.length } }))
  } else if (sub === 'pick') {
    const n = Number(rest)

    if (!Number.isInteger(n) || n < 1 || n > db.sprite.frames.length) return `Usage: /amsprite pick <1-${db.sprite.frames.length}>`
    await setDb(d, x => ({ ...x, sprite: { ...x.sprite, pick: n - 1 } }))
  } else if (sub === 'clear') {
    await setDb(d, x => ({ ...x, sprite: emptyDb().sprite }))
  }

  return `${spriteText(await read(d, dbA))}\nUsed in this mod's own pane only (/ampane buddy). /amsprite name <text> | add <glyph> | pick <n> | clear`
}

const cmdGoal = async (d: Dollar, args: string): Promise<string> => {
  const [sub, rest] = firstWord(args)
  const db = await read(d, dbA)
  const show = async () => {
    const x = await read(d, dbA)

    return goalLines(x.goals, x.badges).join('\n')
  }

  if (sub === 'add') {
    const g = parseGoal(rest)

    if (g === undefined) return 'Usage: /amgoal add <text> <target>, for example /amgoal add write tests 5'

    if (db.goals.length >= CAPS.goals) return `At most ${CAPS.goals} goals: /amgoal del <n> removes one.`
    await setDb(d, x => ({ ...x, goals: [...x.goals, { text: g.text, target: g.target, count: 0, doneAt: 0 }] }))

    return show()
  }

  if (sub === 'tick') {
    const [a = '', b = ''] = rest.split(/\s+/)
    const n = Number(a)
    const by = b === '' ? 1 : Number(b)

    if (!Number.isInteger(n) || n < 1 || n > db.goals.length || !Number.isInteger(by) || Math.abs(by) > 100) return 'Usage: /amgoal tick <goal number> [by]'
    const now = await d.clock.now()
    const r = tickGoal(db.goals, n - 1, by, now)
    await setDb(d, x => ({
      ...x,
      goals: r.goals,
      badges: r.done === undefined ? x.badges : [...x.badges, { text: r.done.text, at: now }].slice(-CAPS.badges),
    }))

    return `${await show()}${r.done === undefined ? '' : `\nGoal reached: "${r.done.text}". Badge earned.`}`
  }

  if (sub === 'del') {
    const n = Number(rest)

    if (!Number.isInteger(n) || n < 1 || n > db.goals.length) return 'Usage: /amgoal del <goal number>'
    await setDb(d, x => ({ ...x, goals: x.goals.filter((_, i) => i !== n - 1) }))
  }

  return `${await show()}\n/amgoal add <text> <target> | tick <n> [by] | del <n>`
}

const profileList = (db: Db, bound: string | undefined) =>
  [...new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(db.profiles)])]
    .map(n => `${n}${db.profiles[n] === undefined ? ' (built in)' : ''}${bound === n ? '  <- bound to this folder' : ''}: ${flagsText((profileOf(db, n) ?? { flags: db.flags }).flags)}`)
    .join('\n')

const cmdProfile = async (d: Dollar, args: string): Promise<string> => {
  const [sub, rest] = firstWord(args)
  const db = await read(d, dbA)
  const cwd = await d.session.cwd().catch(() => '')
  const name = runbookName(rest)

  if (sub === 'save') {
    if (name === undefined) return 'Usage: /amprofile save <name>'

    if (Object.keys(db.profiles).length >= CAPS.profiles && db.profiles[name] === undefined) return `At most ${CAPS.profiles} saved profiles: /amprofile del <name> removes one.`
    await setDb(d, x => ({ ...x, profiles: { ...x.profiles, [name]: { flags: { ...x.flags }, quiet: [...x.quiet] } } }))

    return `Saved "${name}": ${flagsText(db.flags)}; quiet hours ${quietRanges(db.quiet)}.`
  }

  if (sub === 'use' || sub === 'bind') {
    const p = name === undefined ? undefined : profileOf(db, name)

    if (name === undefined || p === undefined) return `No profile "${rest}". /amprofile list shows them.`
    await setDb(d, x => ({ ...applyProfile(x, p), bound: sub === 'bind' && cwd !== '' ? { ...x.bound, [cwd]: name } : x.bound }))

    return sub === 'bind' ? `Applied "${name}" and bound it to ${cwd}: it is applied again when a session starts there.` : `Applied "${name}": ${flagsText(p.flags)}.`
  }

  if (sub === 'unbind') {
    await setDb(d, x => ({ ...x, bound: Object.fromEntries(Object.entries(x.bound).filter(([k]) => k !== cwd)) }))

    return `This folder has no bound profile now.`
  }

  if (sub === 'del') {
    if (name === undefined || db.profiles[name] === undefined) return `No saved profile "${rest}" (built-in ones cannot be deleted).`
    await setDb(d, x => ({ ...x, profiles: Object.fromEntries(Object.entries(x.profiles).filter(([k]) => k !== name)) }))

    return `Deleted "${name}".`
  }

  return `${profileList(db, db.bound[cwd])}\nNow: ${flagsText(db.flags)}; quiet hours ${quietRanges(db.quiet)}\n/amprofile save <name> | use <name> | bind <name> | unbind | del <name>`
}

const cmdReset = async (d: Dollar, args: string): Promise<string> => {
  const isAll = args.trim().toLowerCase() === 'all'
  fixSeen = {}
  pendingFix = null
  await setDb(d, x =>
    isAll
      ? emptyDb()
      : { ...x, runbooks: [], recording: null, tasks: [], active: null, decision: { question: '', options: [] }, goals: [], badges: [], answers: {}, fixes: [] },
  )
  await setView(d, { sel: '', doctor: [], project: [] })

  return isAll ? 'Cleared everything this mod stored, settings, profiles and sprite included.' : 'Cleared run-books, task history, decision, goals, badges, remembered answers and saved fixes. (Settings, profiles, quiet hours and sprite stay: /amreset all clears those too.)'
}

const cmdPane = async (d: Dollar, args: string): Promise<string> => {
  const tab = tabFromWord(args)

  if (args.trim() !== '' && tab === undefined) return `Tabs: ${TABS.map(t => t.toLowerCase()).join(', ')}`
  const placed = await openPane(d, tab)

  const shown = tab ?? (await read(d, viewA)).tab

  if (shown === 'Doctor' || shown === 'Project') await pressTab(d, shown)

  return placed ? 'Assist more pane opened.' : 'No pane could be shown here: use the commands directly (/am lists them).'
}

const COMMAND_NAMES = COMMANDS.map(c => c[0])

const runCommand = async ($: Dollar, name: string, args: string): Promise<string> => {
  switch (name) {
    case 'am':
      return helpText()
    case 'ampane':
      return cmdPane($, args)
    case 'amdoctor':
      return cmdDoctor($)
    case 'amproject':
      return cmdProject($)
    case 'amrun':
      return cmdRun($, args)
    case 'amtask':
      return cmdTask($, args)
    case 'amsplit':
      return cmdSplit($, args)
    case 'amdecide':
      return cmdDecide($, args)
    case 'amopt':
      return cmdOpt($, args)
    case 'amrisk':
      return cmdFlag($, 'risk', args)
    case 'amundo':
      return cmdUndo($)
    case 'amlearn':
      return cmdLearn($, args)
    case 'amtypo':
      return cmdFlag($, 'typo', args)
    case 'amdefaults':
      return cmdDefaults($, args)
    case 'amsummary':
      return cmdFlag($, 'summary', args)
    case 'amcontrast':
      return cmdContrast($, args)
    case 'amplain':
      return cmdFlag($, 'plain', args)
    case 'amprofile':
      return cmdProfile($, args)
    case 'amquiet':
      return cmdQuiet($, args)
    case 'amsound':
      return cmdSound($, args)
    case 'amsprite':
      return cmdSprite($, args)
    case 'amgoal':
      return cmdGoal($, args)
    case 'amreset':
      return cmdReset($, args)
    default:
      return `Unknown command ${name}.`
  }
}

// ---------------------------------------------------------------- tool hooks

const typoNudge = async (d: Dollar, command: string) => {
  if (!(await canToast(d))) return
  const cwd = await d.session.cwd()

  for (const c of pathCandidates(command)) {
    const abs = joinPath(cwd, c)

    if (await d.fs.exists(abs)) continue
    const parent = parentOf(abs)

    if (!(await d.fs.exists(parent))) continue
    const names = (await d.fs.list(parent)).slice(0, 500).map(e => e.name)
    const close = closeSiblings(leafOf(abs), names)

    if (close.length === 0) continue
    const typed = c.replace(/\/+$/, '')
    const prefix = typed.slice(0, typed.length - leafOf(typed).length)
    await toast(d, `"${typed}" does not exist. Did you mean ${close.map(s => `"${prefix}${s}"`).join(' or ')}? (The command still runs.)`)

    return
  }
}

const afterCall = async (d: Dollar, e: Call, ran: Ran) => {
  const db = await read(d, dbA)

  if (e.tool === 'Bash' && typeof e.command === 'string' && db.recording !== null) {
    const command = e.command
    await setDb(d, x => (x.recording === null ? x : { ...x, recording: { name: x.recording.name, cmds: addRecorded(x.recording.cmds, command) } }))
  }

  if ((e.tool === 'Edit' || e.tool === 'Write') && db.flags.risk) {
    const why = riskyEdit(e.tool, e)

    if (why !== undefined) await toast(d, `Heads-up: this edit touches ${why}. Worth a second look before it ships.`)
  }

  if (e.tool === 'Edit' && db.flags.learn && typeof e.old_string === 'string' && typeof e.new_string === 'string') {
    const key = fixKey(e.old_string, e.new_string)

    if (key !== undefined) {
      const r = noteFix(fixSeen, key, typeof e.file_path === 'string' ? e.file_path : '')
      fixSeen = r.seen

      if (r.offer) {
        pendingFix = { from: e.old_string.trim(), to: e.new_string.trim() }
        await toast(d, `Same fix twice: "${clip(pendingFix.from, 40)}" -> "${clip(pendingFix.to, 40)}". /amlearn save keeps it.`, 10_000)
      }
    }
  }

  if (e.tool === 'AskUserQuestion' && db.flags.defaults) {
    const answers = (ran.result as { answers?: unknown } | undefined)?.answers

    if (typeof answers === 'object' && answers !== null && !Array.isArray(answers)) {
      await setDb(d, x => ({ ...x, answers: recordAnswers(x.answers, answers as Record<string, unknown>) }))
    }
  }
}

// ---------------------------------------------------------------- the pane

const loadBound = async (d: Dollar, cwd: string) => {
  const db = await read(d, dbA)
  const name = db.bound[cwd]
  const p = name === undefined ? undefined : profileOf(db, name)

  if (p !== undefined) await setDb(d, x => applyProfile(x, p))
}

const toggleFlag = (d: Dollar, flag: (typeof FLAG_NAMES)[number]) => setDb(d, x => ({ ...x, flags: { ...x.flags, [flag]: !x.flags[flag] } }))
const toggleHour = (d: Dollar, h: number) => setDb(d, x => ({ ...x, quiet: x.quiet.map((v, i) => (i === h ? !v : v)) }))
const stepSprite = (d: Dollar, by: number) =>
  setDb(d, x => ({ ...x, sprite: { ...x.sprite, pick: (x.sprite.pick + by + x.sprite.frames.length) % Math.max(1, x.sprite.frames.length) } }))

const fillRunbook = async (d: Dollar, name: string) => {
  const rb = (await read(d, dbA)).runbooks.find(r => r.name === name)

  if (rb !== undefined) await fillPrompt(d, runbookPrompt(rb))
}

const finishTask = (d: Dollar) => cmdTask(d, 'done')
const tickGoalButton = (d: Dollar, n: number) => cmdGoal(d, `tick ${n}`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    lastToastAt = -Infinity
    fixSeen = {}
    pendingFix = null
    await loadDb($)

    for (const [name, , description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await loadBound($, e.cwd).catch(() => undefined)

    return next(e)
  })

  for (const name of COMMAND_NAMES) {
    on('command.run', { command: name }, async ($, e) => {
      try {
        return { text: await runCommand($, name, e.args) }
      } catch (err) {
        return { text: `/${name} could not finish: ${msgOf(err)}` }
      }
    })
  }

  // Plain-language mode: a standing instruction, only while the switch is on.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return (await read($, dbA)).flags.plain ? { ...composed, sections: [...composed.sections, PLAIN_SECTION] } : composed
  })

  // Typo nudge (before), run-book recording, risk reminder, learning moments and answers (after). None of this ever blocks a call.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as Call

    try {
      if (call.tool === 'Bash' && typeof call.command === 'string' && (await read($, dbA)).flags.typo) {
        await typoNudge($, call.command)
      }
    } catch {
      // a nudge that fails is just no nudge
    }
    const ran = await next(e)

    try {
      if ((ran as Ran).deny === undefined) await afterCall($, call, ran as Ran)
    } catch {
      // recording or toasting must never break the call
    }

    return ran
  }).catch(($, e, next) => next(e))

  // Banner above a destructive-looking Bash command.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const inner = await next(e)

    if (e.props.tool !== 'Bash' || !(await read($, dbA)).flags.summary) return inner
    const input = e.props.input as { command?: unknown } | undefined
    const summary = typeof input?.command === 'string' ? destructiveSummary(input.command) : undefined

    if (summary === undefined) return inner
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text color="warning">{`▲ ${summary}`}</Text>
        {inner}
      </Box>
    )
  })

  // Smart defaults: a hint above the question dialog (the dialog refuses anything drawn below it) when you usually answer the same way.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const inner = await next(e)
    const db = await read($, dbA)

    if (!db.flags.defaults || (await read($, calmA))) return inner
    const questions = Array.isArray(e.props.questions) ? (e.props.questions as { question?: unknown; header?: unknown }[]) : []
    const hints = questions.flatMap(q => {
      const text = typeof q.question === 'string' ? q.question : ''
      const u = text === '' ? undefined : usualAnswer(db.answers, text)

      return u === undefined ? [] : [`Your usual answer to "${clip(typeof q.header === 'string' ? q.header : text, 30)}": ${u.answer} (${u.n} of ${u.total} times)`]
    })

    if (hints.length === 0) return inner
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {hints.map(hint => (
          <Text dimColor>{hint}</Text>
        ))}
        {inner}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [db, v, accent, density, now] = await Promise.all([read($, dbA), read($, viewA), read($, accentA), read($, densityA), $.clock.now()])
    const tab = (TABS as readonly string[]).includes(v.tab) ? v.tab : 'Doctor'
    const gap = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
    const rows = (lines: readonly Line[]) =>
      lines.map(l => (
        <Text mono color={l.c}>
          {l.t === '' ? ' ' : l.t}
        </Text>
      ))
    const hour = new Date(now).getHours()
    const sel = db.runbooks.find(r => r.name === v.sel) ?? db.runbooks[db.runbooks.length - 1]

    return (
      <Box flexDirection="column" padding={gap} gap={gap}>
        <Box gap="sm" flexWrap="wrap">
          {TABS.map(t => (
            <Button key={`tab-${t}`} label={t} plain dimColor={tab !== t} onPress={() => { void pressTab($, t) }} />
          ))}
        </Box>

        {tab === 'Doctor' && (
          <Box flexDirection="column">
            <Button key="doctor-refresh" label="scan again" plain onPress={() => { void refreshTab($, 'Doctor') }} />
            {v.isBusy && <Text dimColor>Asking each tool for its version…</Text>}
            {rows(v.doctor)}
            {v.doctor.length === 0 && !v.isBusy && <Text dimColor>Press scan again, or run /amdoctor.</Text>}
          </Box>
        )}

        {tab === 'Project' && (
          <Box flexDirection="column">
            <Button key="project-refresh" label="read this folder again" plain onPress={() => { void refreshTab($, 'Project') }} />
            {v.isBusy && <Text dimColor>Reading file names…</Text>}
            {rows(v.project)}
            {v.project.length === 0 && !v.isBusy && <Text dimColor>Press the button, or run /amproject.</Text>}
          </Box>
        )}

        {tab === 'Runbooks' && (
          <Box flexDirection="column" gap="xs">
            <Text color={accent}>{db.recording === null ? 'Not recording. /amrun start <name> begins a run-book.' : `Recording "${db.recording.name}": ${plural(db.recording.cmds.length, 'command')} so far (secrets masked).`}</Text>
            <Box gap="sm" flexWrap="wrap">
              {db.runbooks.map(r => (
                <Button key={`rb-${r.name}`} label={`${r.name} (${r.cmds.length})`} plain dimColor={sel?.name !== r.name} onPress={() => { void setView($, { sel: r.name }) }} />
              ))}
            </Box>
            {db.runbooks.length === 0 && <Text dimColor>No run-books yet.</Text>}
            {sel !== undefined && (
              <Box flexDirection="column">
                {sel.cmds.map(c => (
                  <Text mono>{`$ ${c}`}</Text>
                ))}
                <Box gap="sm">
                  <Button key="rb-fill" label="Fill commands into the prompt" onPress={() => { void fillRunbook($, sel.name) }} />
                  <Button key="rb-del" label="Delete" plain dimColor onPress={() => { void cmdRun($, `del ${sel.name}`) }} />
                </Box>
                <Text dimColor>Filling only puts text in the box. Nothing is run until you send it.</Text>
              </Box>
            )}
          </Box>
        )}

        {tab === 'Task' && (
          <Box flexDirection="column">
            <Text color={accent}>{db.active === null ? 'No task is being timed. /amtask start <label>' : `Timing "${db.active.label}": ${fmtDur(now - db.active.at)}`}</Text>
            {db.active !== null && <Text dimColor>{estimateText(db.tasks, db.active.label)}</Text>}
            {db.active !== null && (
              <Box gap="sm">
                <Button key="task-done" label="Done" onPress={() => { void finishTask($) }} />
                <Button key="task-cancel" label="Cancel" plain dimColor onPress={() => { void cmdTask($, 'cancel') }} />
              </Box>
            )}
            {db.tasks.slice(-8).reverse().map(t => (
              <Text mono>{`${fmtDur(t.ms).padEnd(7)} ${t.label}`}</Text>
            ))}
            {db.tasks.length === 0 && <Text dimColor>No finished tasks yet.</Text>}
          </Box>
        )}

        {tab === 'Decide' && (
          <Box flexDirection="column">
            {decisionTable(db.decision).map(l => (
              <Text mono>{l}</Text>
            ))}
            <Text dimColor>/amdecide sets the question, /amopt adds options with weighted + and - points.</Text>
            {db.decision.options.length > 0 && <Button key="decide-clear" label="Clear" plain dimColor onPress={() => { void cmdDecide($, 'clear') }} />}
          </Box>
        )}

        {tab === 'Goals' && (
          <Box flexDirection="column">
            {goalLines(db.goals, db.badges).map(l => (
              <Text mono>{l === '' ? ' ' : l}</Text>
            ))}
            <Box gap="sm" flexWrap="wrap">
              {db.goals.map((g, i) => g.doneAt === 0 && <Button key={`goal-${i}`} label={`+1 ${clip(g.text, 14)}`} plain onPress={() => { void tickGoalButton($, i + 1) }} />)}
            </Box>
          </Box>
        )}

        {tab === 'Quiet' && (
          <Box flexDirection="column" gap="xs">
            <Text color={accent}>{`Quiet hours: ${quietRanges(db.quiet)}`}</Text>
            <Box>
              {db.quiet.map(q => (
                <Text mono color={q ? 'warning' : 'inactive'}>
                  {q ? '█' : '░'}
                </Text>
              ))}
            </Box>
            <Text mono dimColor>{`${' '.repeat(hour)}▲ now (${String(hour).padStart(2, '0')}h)`}</Text>
            <Text dimColor>Press an hour to flip it. █ is quiet: this mod shows no toasts then.</Text>
            <Box flexWrap="wrap" gap="xs">
              {db.quiet.map((q, hr) => (
                <Button key={`hour-${hr}`} label={`${String(hr).padStart(2, '0')}${q ? '*' : ' '}`} plain dimColor={!q} onPress={() => { void toggleHour($, hr) }} />
              ))}
            </Box>
          </Box>
        )}

        {tab === 'Buddy' && (
          <Box flexDirection="column" gap="xs">
            <Text size="title" mono color={accent}>
              {db.sprite.frames[db.sprite.pick] ?? ''}
            </Text>
            <Text>{db.sprite.name}</Text>
            <Box gap="sm">
              <Button key="sprite-prev" label="< prev" plain onPress={() => { void stepSprite($, -1) }} />
              <Button key="sprite-next" label="next >" plain onPress={() => { void stepSprite($, 1) }} />
            </Box>
            <Text dimColor>{`Glyphs: ${db.sprite.frames.join('  ')}. /amsprite name | add | pick | clear. Shown here only.`}</Text>
          </Box>
        )}

        {tab === 'Profiles' && (
          <Box flexDirection="column" gap="xs">
            <Text color={accent}>Switches (press to flip)</Text>
            <Box gap="sm" flexWrap="wrap">
              {FLAG_NAMES.map(f => (
                <Button key={`flag-${f}`} label={`${f}: ${db.flags[f] ? 'on' : 'off'}`} plain dimColor={!db.flags[f]} onPress={() => { void toggleFlag($, f) }} />
              ))}
            </Box>
            <Text color={accent}>Profiles</Text>
            <Box gap="sm" flexWrap="wrap">
              {[...new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(db.profiles)])].map(n => (
                <Button key={`profile-${n}`} label={`use ${n}`} plain onPress={() => { void cmdProfile($, `use ${n}`) }} />
              ))}
            </Box>
            <Text dimColor>{'/amprofile save <name> keeps the current switches and quiet hours; bind attaches one to this folder.'}</Text>
            {isQuiet(db.quiet, now) && <Text dimColor>It is a quiet hour now: toasts are held back.</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
