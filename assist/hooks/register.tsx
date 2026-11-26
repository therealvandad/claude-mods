import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import {
  addBounded,
  attachFix,
  avoidPrompt,
  bump,
  classifyPaste,
  clip,
  COACH,
  commandKey,
  compressRows,
  dayOf,
  DEFAULT_MODES,
  errorLine,
  errorSignature,
  explainPrompt,
  failingName,
  fileOf,
  findFiles,
  findFixes,
  fmtSize,
  fmtTime,
  GAP_MS,
  guessSituation,
  handoffText,
  helpReport,
  isStuck,
  KEEP,
  kindOfTool,
  lastFailure,
  latestError,
  maskSecrets,
  nextChips,
  nextFixN,
  noteError,
  oneLine,
  onOff,
  openFailures,
  ordinal,
  outputText,
  pickCoach,
  plural,
  postflight,
  preflight,
  QUESTIONS,
  readErrors,
  readFixes,
  readMinutes,
  readModes,
  readPrompts,
  readRecall,
  readUsage,
  recallAdd,
  recallFind,
  recapPrompt,
  retryPrompt,
  SITUATIONS,
  SKIM_PROMPT,
  skimPoints,
  splitVerb,
  TOAST_GAP_MS,
  touch,
  trackRun,
  unstickPrompt,
  hasSecret,
} from './pure'
import type { CallRec, Chip, ErrRow, FileRow, FixRow, Modes, PasteLabel, PromptRow, RecallRow, RecapCard, Sel, Stuck } from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]
type Kit = ReturnType<Dollar['ui']['resolve']>

// Nothing in this mod animates, so it does not read the `motion` flag. It reads the shared `settings` atoms and works
// with their defaults when the settings mod has never written them.
const isCalm = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')

// ---------------------------------------------------------------- state
// Change a shape tag when the stored fields change: it declines what an earlier version stored.
const modes = atom({ plugin: 'assist', key: 'modes' } as const, DEFAULT_MODES, { shape: 'modes-1' })
const calls = atom({ plugin: 'assist', key: 'calls' } as const, [], { shape: 'calls-1' })
const files = atom({ plugin: 'assist', key: 'files' } as const, [], { shape: 'files-1' })
const errors = atom({ plugin: 'assist', key: 'errors' } as const, [], { shape: 'errors-1' })
const fixes = atom({ plugin: 'assist', key: 'fixes' } as const, [], { shape: 'fixes-1' })
const prompts = atom({ plugin: 'assist', key: 'prompts' } as const, [], { shape: 'prompts-1' })
const recall = atom({ plugin: 'assist', key: 'recall' } as const, [], { shape: 'recall-1' })
const usage = atom({ plugin: 'assist', key: 'usage' } as const, {}, { shape: 'usage-1' })
const decisions = atom({ plugin: 'assist', key: 'decisions' } as const, [], { shape: 'decisions-1' })
const stuck = atom({ plugin: 'assist', key: 'stuck' } as const, { run: [], lines: [], isEpisode: false }, { shape: 'stuck-1' })
const paste = atom({ plugin: 'assist', key: 'paste' } as const, null, { shape: 'paste-1' })
const card = atom({ plugin: 'assist', key: 'card' } as const, null, { shape: 'card-1' })
const sel = atom({ plugin: 'assist', key: 'sel' } as const, { find: '', recall: '', fixes: '', task: '' }, { shape: 'sel-1' })
const tab = atom({ plugin: 'assist', key: 'tab' } as const, 'next')
const sit = atom({ plugin: 'assist', key: 'sit' } as const, '')
const report = atom({ plugin: 'assist', key: 'report' } as const, '')
const handoff = atom({ plugin: 'assist', key: 'handoff' } as const, '')
const skim = atom({ plugin: 'assist', key: 'skim' } as const, '')
const lastAnswer = atom({ plugin: 'assist', key: 'lastAnswer' } as const, '')
const turn = atom({ plugin: 'assist', key: 'turn' } as const, 0)
const lastToastAt = atom({ plugin: 'assist', key: 'lastToastAt' } as const, 0)

const PANE = 'assist-main'

const TABS = [
  ['next', 'Next'],
  ['find', 'Find'],
  ['context', 'Context'],
  ['errors', 'Errors'],
  ['prompts', 'Prompts'],
  ['reports', 'Reports'],
  ['modes', 'Modes'],
] as const

const COMMANDS = [
  ['as', '[pane]', 'List these commands; "pane" opens the Assist pane'],
  ['asnext', 'on|off', 'Next-step suggester: up to three chips (fix the test, run the tests, commit); one dim suggestion line when on (default off)'],
  ['asunstick', '', 'After 3+ different failures in a row: fill a reset prompt (one toast per episode)'],
  ['asretry', '[change]', 'Fill "Retry the last failed command with <change>"'],
  ['ascompress', '[fill]', 'List the biggest recorded outputs to drop or avoid re-reading; fill puts an avoid prompt in the box'],
  ['aspaste', 'on|off', 'Smart paste label: a one-line note when a stack trace, log lines, JSON or a diff is pasted (default on, not calm)'],
  ['asfind', '<text>', 'Fuzzy-find files touched this session; the pane click fills @path'],
  ['asrecall', '<text> | on | off | clear', 'Search shell commands from this and earlier days (secrets masked, last 300); off stops recording'],
  ['asrecap', '', 'Fill "Summarize where we left off" with your last prompts listed'],
  ['aspre', '<task>', 'Fill a pre-flight checklist of confirmations before a big refactor'],
  ['aspost', '<task>', 'Fill a post-flight checklist: tests, lint, diff, commit, notes'],
  ['ashelp', '', 'Draft a bug report from recorded errors and commands in the pane (never sent)'],
  ['ashandoff', '[decide <text>]', 'Bundle prompts, decisions, files changed and open errors into one text block in the pane'],
  ['asread', 'on|off', 'Dim "~N min read" under assistant text over 400 words (default off)'],
  ['asskim', '', 'Fill a key-points request; also lists the first sentence of each paragraph of the last answer'],
  ['asq', '[situation [n]]', 'Question bank: follow-up prompts by situation (error, edited, stuck, unclear, learn, wrap)'],
  ['asfix', '<text>', 'Note how you fixed the latest error; it is attached to that error signature'],
  ['asfixes', '[text]', 'Search the saved fixes'],
  ['ascoach', 'on|off|now', 'Shortcut coach: at most one toast a day naming a command you have not used (default on, not calm)'],
  ['asrec', 'on|off', 'Recording of calls, prompts, errors and file names for the features above (default on, local only)'],
  ['asreset', '[all]', 'Clear everything recorded; "all" also clears your fixes, decisions and settings'],
] as const

// ---------------------------------------------------------------- tiny helpers

const safe = async <T,>(run: () => Promise<T> | T, fallback: T): Promise<T> => {
  try {
    return await run()
  } catch {
    return fallback
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object'

const keep = (d: Dollar, key: string, value: unknown) => safe(() => d.store.set(`assist.${key}`, value), undefined)

const calmNow = (d: Dollar): Promise<boolean> => safe(() => read(d, isCalm), false)

// One toast per three minutes from this mod; false when it was held back.
const toastOnce = async (d: Dollar, text: string): Promise<boolean> => {
  const now = await d.clock.now()
  const last = await read(d, lastToastAt)

  if (last > 0 && now - last < TOAST_GAP_MS) {
    return false
  }
  await update(d, lastToastAt, () => now)
  d.ui.toast(text, { timeoutMs: 6000 })

  return true
}

const openPane = async (d: Dollar, to?: string): Promise<boolean> => {
  if (to !== undefined) {
    await update(d, tab, () => to)
  }
  const opened = await safe(() => d.ui.open({ id: PANE, title: 'Assist' }), undefined)

  return opened?.isPlaced === true
}

// Never destroys a draft: an empty box is replaced, a draft gets the text after it.
const fillSmart = async (d: Dollar, text: string, cursor?: number): Promise<boolean> => {
  const box = await safe(() => d.prompt.read(), { text: '', cursor: 0 })
  const isEmpty = box.text.trim() === ''
  const result = await safe(
    () =>
      isEmpty
        ? d.prompt.fill({ text, mode: 'replace', ...(cursor === undefined ? {} : { cursor }) })
        : d.prompt.fill({ text: `\n\n${text}`, mode: 'append' }),
    undefined,
  )

  return result?.isFilled === true
}

// A short token that goes at the end of the draft on the same line.
const fillInline = async (d: Dollar, text: string): Promise<boolean> => {
  const box = await safe(() => d.prompt.read(), { text: '', cursor: 0 })
  const sep = box.text === '' || /\s$/.test(box.text) ? '' : ' '
  const result = await safe(() => d.prompt.fill({ text: `${sep}${text} `, mode: 'append' }), undefined)

  return result?.isFilled === true
}

const filledNote = (isFilled: boolean, ok: string): string =>
  isFilled ? ok : 'The prompt box could not take the text (a dialog may be open). Try again from the pane.'

const setModes = async (d: Dollar, patch: Partial<Modes>) => {
  const next = await update(d, modes, m => ({ ...m, ...patch }))
  await keep(d, 'modes', next)

  return next
}

const setSel = (d: Dollar, patch: Partial<Sel>) => update(d, sel, s => ({ ...s, ...patch }))

// ---------------------------------------------------------------- loading and activity

let lastActiveMem = 0
let lastActivePersisted = 0
let lastGapCheck = 0

const touchActive = async (d: Dollar, now: number) => {
  lastActiveMem = now

  if (now - lastActivePersisted > 30_000 || lastActivePersisted > now) {
    lastActivePersisted = now
    await keep(d, 'lastActive', now)
  }
}

// 77: a gap of ten minutes or more raises a dismissible recap card (a prompt fill, not a digest).
const checkGap = async (d: Dollar, now: number) => {
  if (lastActiveMem > 0 && now - lastActiveMem >= GAP_MS) {
    const gapMin = Math.round((now - lastActiveMem) / 60_000)
    await update(d, card, () => ({ gapMin, at: now }))
    lastActiveMem = now
    lastActivePersisted = now
    await keep(d, 'lastActive', now)
  }
}

const loadAll = async (d: Dollar) => {
  const get = (key: string) => safe(() => d.store.get(`assist.${key}`), undefined)
  const m = readModes(await get('modes'))
  await update(d, modes, () => m)
  const rc = readRecall(await get('recall'))
  await update(d, recall, () => rc)
  const ps = readPrompts(await get('prompts'))
  await update(d, prompts, () => ps)
  const er = readErrors(await get('errors'))
  await update(d, errors, () => er)
  const fx = readFixes(await get('fixes'))
  await update(d, fixes, () => fx)
  const us = readUsage(await get('usage'))
  await update(d, usage, () => us)
  const dc = await get('decisions')
  await update(d, decisions, () => (Array.isArray(dc) ? dc.filter((x): x is string => typeof x === 'string').slice(-KEEP.decisions) : []))
  const at = await get('lastActive')
  const now = await safe(() => d.clock.now(), 0)

  if (m.rec && typeof at === 'number' && at > 0 && now > 0) {
    lastActiveMem = at
    lastActivePersisted = at
    await checkGap(d, now)
  } else {
    lastActiveMem = now
    lastActivePersisted = 0
  }
}

// ---------------------------------------------------------------- recording a tool call (69 70 73 75 76 80 87)

type Ran = { deny?: string; isError?: boolean; text?: string; result?: unknown }

const recordCall = async (d: Dollar, input: Record<string, unknown>, ran: Ran) => {
  const m = await read(d, modes)
  const now = await d.clock.now()
  await touchActive(d, now)

  if (!m.rec) {
    return
  }
  const tool = String(input.tool ?? '')
  const command = tool === 'Bash' && typeof input.command === 'string' ? input.command : ''
  const file = fileOf(tool, input)
  const isErr = ran.isError === true
  const text = ran.text ?? outputText(ran.result)
  const kind = kindOfTool(tool, command)
  const key = commandKey(tool, maskSecrets(command), file)
  const pattern = typeof input.pattern === 'string' ? input.pattern : typeof input.url === 'string' ? input.url : ''
  const label = maskSecrets(
    tool === 'Bash' ? oneLine(command, 100) : file !== '' ? `${tool} ${file}` : pattern !== '' ? `${tool} ${oneLine(pattern, 60)}` : tool,
  )
  const line = isErr ? maskSecrets(kind === 'test' ? failingName(text) || errorLine(text) : errorLine(text)) : ''
  const n = await read(d, turn)
  const rec: CallRec = { id: String(input.tool_use_id ?? ''), tool, kind, key, label, isErr, line, size: text.length, at: now, turn: n, file }
  await update(d, calls, list => addBounded(list, rec, KEEP.calls))

  if (file !== '' && !isErr && (kind === 'read' || kind === 'edit')) {
    await update(d, files, list => touch(list, file, kind, now))
  }
  if (command !== '' && m.recall) {
    const rows = await update(d, recall, list => recallAdd(list, command, now))
    await keep(d, 'recall', rows)
  }
  if (isErr) {
    await noteFailure(d, rec, text, command, now)
  } else {
    await update(d, stuck, () => ({ run: [], lines: [], isEpisode: false }))
  }
}

const noteFailure = async (d: Dollar, rec: CallRec, text: string, command: string, now: number) => {
  const sig = errorSignature(text)

  if (sig !== '') {
    const before = (await read(d, errors)).find(e => e.sig === sig)
    const rows = await update(d, errors, list =>
      noteError(list, { sig, last: now, tool: rec.tool, cmd: maskSecrets(clip(command, 160)), sample: oneLine(maskSecrets(text), 200) }, now),
    )
    await keep(d, 'errors', rows)

    if (before !== undefined && before.fix !== '' && !(await calmNow(d))) {
      await toastOnce(d, `assist: seen this error ${before.count + 1} times. Your fix note: ${oneLine(before.fix, 100)}`)
    }
  }
  const s = await update(d, stuck, old => ({
    run: trackRun(old.run, rec.key, true),
    lines: [...old.lines, `${rec.label}: ${rec.line}`].slice(-12),
    isEpisode: old.isEpisode,
  }))

  if (isStuck(s.run) && !s.isEpisode) {
    await update(d, stuck, old => ({ ...old, isEpisode: true }))

    if (!(await calmNow(d))) {
      await toastOnce(d, `assist: ${new Set(s.run).size} different attempts in a row failed. /asunstick fills a reset prompt.`)
    }
  }
}

// ---------------------------------------------------------------- the prompt (74, 77)

const recordPrompt = async (d: Dollar, text: string) => {
  const now = await d.clock.now()
  await touchActive(d, now)
  await update(d, turn, n => n + 1)
  await update(d, paste, () => null)
  await update(d, card, () => null)
  const m = await read(d, modes)

  if (!m.rec || text.trim() === '' || hasSecret(text)) {
    return
  }
  const rows = await update(d, prompts, list => addBounded(list, { text: clip(text, 400), at: now }, KEEP.prompts))
  await keep(d, 'prompts', rows)
}

let lastEditAt = 0

const watchEdit = async (d: Dollar, input: { inputText: string }, boxText: string) => {
  const piece = input.inputText

  if (piece.length < 30 && !(piece.includes('\n') && piece.length >= 8)) {
    if (boxText.trim() === '' && (await read(d, paste)) !== null) {
      await update(d, paste, () => null)
    }
    // A cheap gap check: at most every five seconds.
    const now = await d.clock.now()

    if (now - lastEditAt >= 5000 || now < lastEditAt) {
      lastEditAt = now
      await checkGap(d, now)
    }

    return
  }
  const now = await d.clock.now()
  lastEditAt = now
  await checkGap(d, now)
  const m = await read(d, modes)

  if (m.paste) {
    const found = classifyPaste(piece)

    if (found !== null) {
      await update(d, paste, () => found)
    }
  }
}

// ---------------------------------------------------------------- 69 next-step, 70 stuck, 72 retry, 71 explain

const chipsNow = async (d: Dollar): Promise<Chip[]> => nextChips(await read(d, calls), await read(d, turn))

const unstickNow = async (d: Dollar): Promise<string> => {
  const s = await read(d, stuck)
  const all = await read(d, calls)
  const lines = s.lines.length > 0 ? s.lines : all.filter(c => c.isErr).slice(-4).map(c => `${c.label}: ${c.line}`)

  if (lines.length === 0) {
    return 'No failed attempts are recorded, so there is nothing to reset.'
  }
  const isFilled = await fillSmart(d, unstickPrompt(lines))

  return filledNote(isFilled, `Reset prompt is in the prompt box (${plural(lines.length, 'recent failure')} listed). Nothing was sent.`)
}

const retryNow = async (d: Dollar, change: string): Promise<string> => {
  const all = await read(d, calls)
  const failed = lastFailure(all.filter(c => c.kind === 'bash' || c.kind === 'test')) ?? lastFailure(all)

  if (failed === undefined) {
    return 'No failed command is recorded yet.'
  }
  const r = retryPrompt(failed.tool === 'Bash' ? failed.label : failed.label, change)
  const isFilled = await fillSmart(d, r.text, r.cursor)

  return filledNote(isFilled, change.trim() === '' ? 'Retry prompt is in the box; type the change where the blank is.' : 'Retry prompt is in the box. Nothing was sent.')
}

const explainFill = async (d: Dollar, tool: string, inputv: unknown, output: unknown) => {
  const isFilled = await fillSmart(d, explainPrompt(tool, inputv, output))

  if (!isFilled) {
    d.ui.toast('The prompt box could not take the text.', { timeoutMs: 3000 })
  }
}

// ---------------------------------------------------------------- the last assistant text (83)

const lastAnswerText = async (d: Dollar): Promise<string> => {
  const found = await safe(() => d.session.messages({ last: 20 }), undefined)

  if (Array.isArray(found)) {
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const m = found[i]

      if (m !== undefined && m.role === 'assistant' && m.text.trim() !== '') {
        return m.text
      }
    }
  }

  return read(d, lastAnswer)
}

const refreshSkim = async (d: Dollar) => {
  const points = skimPoints(await lastAnswerText(d))
  await update(d, skim, () => points.map((p, i) => `${i + 1}. ${p}`).join('\n'))
}

const skimNow = async (d: Dollar): Promise<string> => {
  const text = await lastAnswerText(d)
  const points = skimPoints(text)
  await update(d, skim, () => points.map((p, i) => `${i + 1}. ${p}`).join('\n'))
  const isFilled = await fillSmart(d, SKIM_PROMPT)
  const list = points.length === 0 ? 'No assistant text to skim yet.' : `First sentence of each paragraph:\n${points.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`

  return `${filledNote(isFilled, 'Key-points request is in the prompt box. Nothing was sent.')}\n${list}`
}

// ---------------------------------------------------------------- command answers

const helpText = async (d: Dollar): Promise<string> => {
  const m = await read(d, modes)
  const rows = COMMANDS.map(([name, hint, description]) => `/${name}${hint === '' ? '' : ` ${hint}`}  ${description}`)
  const flag = (b: boolean) => (b ? 'on' : 'off')

  return [
    'assist: prompt-box helpers. Nothing is sent for you and no model is called. Every command starts with as.',
    ...rows,
    '',
    `Switches: next ${flag(m.next)}, paste label ${flag(m.paste)}, reading time ${flag(m.read)}, coach ${flag(m.coach)}, recording ${flag(m.rec)}, command recall ${flag(m.recall)}.`,
    'When the settings mod says calm, no chip, label, card or toast shows up by itself; the commands still work.',
    'Glossary hover (idea 85) is not built: the API has no hover popover for words inside the assistant text.',
  ].join('\n')
}

const cmdHelp = async (d: Dollar, args: string) => {
  if (args.trim().toLowerCase() === 'pane') {
    const isPlaced = await openPane(d, 'next')

    return { text: isPlaced ? 'Assist pane opened.' : 'No surface draws a pane here; use the commands.' }
  }

  return { text: await helpText(d) }
}

const SWITCH_COMMAND: Readonly<Record<keyof Modes, string>> = {
  next: 'asnext',
  paste: 'aspaste',
  read: 'asread',
  coach: 'ascoach',
  rec: 'asrec',
  recall: 'asrecall',
}

const switchCmd = async (d: Dollar, args: string, key: keyof Modes, name: string) => {
  const v = onOff(args)

  if (v === undefined) {
    const m = await read(d, modes)

    return { text: `${name} is ${m[key] ? 'on' : 'off'}. /${SWITCH_COMMAND[key]} on|off changes it.` }
  }
  await setModes(d, { [key]: v })

  return { text: `${name} is now ${v ? 'on' : 'off'}.` }
}

const cmdNext = async (d: Dollar, args: string) => {
  const v = onOff(args)

  if (v !== undefined) {
    await setModes(d, { next: v })

    return { text: v ? 'Next-step suggestion on: after a turn, one dim line you can take with Tab (not shown when calm).' : 'Next-step suggestion off.' }
  }
  const m = await read(d, modes)
  const chips = await chipsNow(d)
  const list = chips.length === 0 ? 'Nothing to suggest right now.' : chips.map((c, i) => `  ${i + 1}. ${c.label}: ${c.text}`).join('\n')

  return { text: `Suggestion line is ${m.next ? 'on' : 'off'} (/asnext on|off). Chips from this session's calls:\n${list}` }
}

const cmdCompress = async (d: Dollar, args: string) => {
  const rows = compressRows(await read(d, calls))

  if (rows.length === 0) {
    return { text: 'No outputs are recorded yet.' }
  }
  const lines = rows.map((r, i) => `  ${i + 1}. ${fmtSize(r.size)} chars  ${r.label}${r.times > 1 ? `  (read ${r.times} times)` : ''}`)

  if (args.trim().toLowerCase() === 'fill') {
    const isFilled = await fillSmart(d, avoidPrompt(rows))

    return { text: `${filledNote(isFilled, 'Avoid-re-reading prompt is in the prompt box.')}\n${lines.join('\n')}` }
  }

  return { text: `Biggest recorded outputs (characters; /ascompress fill puts an avoid-re-reading request in the box):\n${lines.join('\n')}` }
}

const cmdFind = async (d: Dollar, args: string) => {
  const q = args.trim()
  await setSel(d, { find: q })
  const all = await read(d, files)

  if (all.length === 0) {
    return { text: 'No files were touched in this session yet.' }
  }
  const found = findFiles(all, q, 8)

  if (found.length === 1 && q !== '') {
    const only = found[0] as FileRow
    const isFilled = await fillInline(d, `@${only.path}`)

    return { text: filledNote(isFilled, `One match: @${only.path} is in the prompt box.`) }
  }
  await openPane(d, 'find')

  return { text: found.length === 0 ? `No touched file matches "${q}".` : `Files touched this session matching "${q}" (the pane fills @path when you press one):\n${found.map(f => `  ${f.path}  (${plural(f.reads, 'read')}, ${plural(f.edits, 'edit')})`).join('\n')}` }
}

const cmdRecall = async (d: Dollar, args: string) => {
  const v = onOff(args)

  if (v !== undefined) {
    await setModes(d, { recall: v })

    return { text: v ? 'Command recall is recording again (secrets masked, last 300).' : 'Command recall stopped recording. Stored commands stay until /asrecall clear.' }
  }
  if (args.trim().toLowerCase() === 'clear') {
    await update(d, recall, () => [])
    await keep(d, 'recall', [])

    return { text: 'Stored commands cleared.' }
  }
  const q = args.trim()
  await setSel(d, { recall: q })
  const rows = recallFind(await read(d, recall), q, 8)

  if (rows.length === 0) {
    return { text: q === '' ? 'No commands are stored yet.' : `No stored command matches "${q}".` }
  }

  return { text: `Commands matching "${q}" (newest first):\n${rows.map(r => `  ${fmtTime(r.at)}  ${r.c}`).join('\n')}` }
}

const recapNow = async (d: Dollar): Promise<string> => {
  const ps = await read(d, prompts)
  const open = openFailures(await read(d, calls)).map(c => `${c.label}: ${c.line}`)
  const isFilled = await fillSmart(d, recapPrompt(ps, open))
  await update(d, card, () => null)

  return filledNote(isFilled, `Recap prompt is in the prompt box with ${plural(Math.min(4, ps.length), 'prompt')} listed. Nothing was sent.`)
}

const flightCmd = async (d: Dollar, task: string, post: boolean) => {
  const isFilled = await fillSmart(d, post ? postflight(task) : preflight(task))

  return { text: filledNote(isFilled, `${post ? 'Post' : 'Pre'}-flight checklist is in the prompt box. Nothing was sent.`) }
}

const cmdHelpReport = async (d: Dollar) => {
  const now = await d.clock.now()
  const text = helpReport(await read(d, errors), await read(d, calls), now)
  await update(d, report, () => text)
  const isPlaced = await openPane(d, 'reports')

  return { text: `${isPlaced ? 'Draft is in the Assist pane (Reports). It is never sent.\n\n' : ''}${text}` }
}

const buildHandoff = async (d: Dollar): Promise<string> => {
  const text = handoffText(await read(d, prompts), await read(d, decisions), await read(d, files), openFailures(await read(d, calls)))
  await update(d, handoff, () => text)

  return text
}

const cmdHandoff = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)

  if (verb === 'decide' && rest !== '') {
    const rows = await update(d, decisions, list => addBounded(list, clip(maskSecrets(rest), 200), KEEP.decisions))
    await keep(d, 'decisions', rows)

    return { text: `Decision ${rows.length} noted for the handoff pack.` }
  }
  const text = await buildHandoff(d)
  const isPlaced = await openPane(d, 'reports')

  return { text: `${isPlaced ? 'Handoff pack is in the Assist pane (Reports).\n\n' : ''}${text}` }
}

const cmdQ = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const s = await read(d, stuck)
  const guess = guessSituation(await read(d, calls), isStuck(s.run))

  if (verb === '') {
    return {
      text: `Situations: ${SITUATIONS.join(', ')}. Looks like: ${guess}. /asq <situation> [n] fills a question.\n${(QUESTIONS[guess] ?? []).map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`,
    }
  }
  const list = QUESTIONS[verb]

  if (list === undefined) {
    return { text: `No situation "${verb}". Pick one of: ${SITUATIONS.join(', ')}.` }
  }
  const n = /^\d+$/.test(rest) ? Number(rest) : 0

  if (n < 1 || n > list.length) {
    return { text: list.map((q, i) => `  ${i + 1}. ${q}`).join('\n') }
  }
  const isFilled = await fillSmart(d, list[n - 1] ?? '')

  return { text: filledNote(isFilled, 'Question is in the prompt box.') }
}

const addFix = async (d: Dollar, text: string): Promise<string> => {
  const latest = latestError(await read(d, errors))

  if (latest === undefined) {
    return 'No error is recorded yet, so there is nothing to attach the fix to.'
  }
  const now = await d.clock.now()
  const clean = clip(maskSecrets(text.trim()), 300)
  const rows = await update(d, fixes, list =>
    addBounded(list, { n: nextFixN(list), sig: latest.sig, text: clean, sample: latest.sample, at: now }, KEEP.fixes),
  )
  await keep(d, 'fixes', rows)
  const errs = await update(d, errors, list => attachFix(list, latest.sig, clean))
  await keep(d, 'errors', errs)

  return `Fix saved for "${latest.sig}" (${plural(latest.count, 'time')} seen). /asfixes searches the saved fixes.`
}

const cmdFixes = async (d: Dollar, args: string) => {
  const q = args.trim()
  await setSel(d, { fixes: q })
  const rows = findFixes(await read(d, fixes), q, 8)

  if (rows.length === 0) {
    return { text: q === '' ? 'No fixes saved yet. /asfix <text> saves one for the latest error.' : `No saved fix matches "${q}".` }
  }

  return { text: `Saved fixes${q === '' ? '' : ` matching "${q}"`}:\n${rows.map(f => `  #${f.n}  ${f.text}  [${f.sig}]`).join('\n')}` }
}

const cmdCoach = async (d: Dollar, args: string) => {
  if (args.trim().toLowerCase() === 'now') {
    const now = await d.clock.now()
    const pick = pickCoach(await read(d, usage), dayOf(now))

    return { text: pick === undefined ? 'You have already used every command on the coach list.' : `${pick[0]} ${pick[1]}.` }
  }

  return switchCmd(d, args, 'coach', 'Shortcut coach')
}

const clearRecorded = async (d: Dollar, isAll: boolean) => {
  await update(d, calls, () => [])
  await update(d, files, () => [])
  await update(d, errors, () => [])
  await update(d, prompts, () => [])
  await update(d, recall, () => [])
  await update(d, usage, () => ({}))
  await update(d, stuck, () => ({ run: [], lines: [], isEpisode: false }))
  await update(d, paste, () => null)
  await update(d, card, () => null)
  await update(d, sel, () => ({ find: '', recall: '', fixes: '', task: '' }))
  await update(d, report, () => '')
  await update(d, handoff, () => '')
  await update(d, skim, () => '')
  await update(d, lastAnswer, () => '')
  await update(d, turn, () => 0)

  for (const key of ['recall', 'prompts', 'errors', 'usage', 'lastActive', 'coachDay']) {
    await safe(() => d.store.delete(`assist.${key}`), undefined)
  }
  lastActiveMem = 0
  lastActivePersisted = 0

  if (isAll) {
    await update(d, fixes, () => [])
    await update(d, decisions, () => [])
    await update(d, modes, () => DEFAULT_MODES)

    for (const key of ['fixes', 'decisions', 'modes']) {
      await safe(() => d.store.delete(`assist.${key}`), undefined)
    }
  }
}

const cmdReset = async (d: Dollar, args: string) => {
  const isAll = args.trim().toLowerCase() === 'all'
  await clearRecorded(d, isAll)

  return { text: isAll ? 'Everything recorded by assist is cleared, including fixes, decisions and switches.' : 'Recorded calls, files, errors, prompts, commands and usage counts are cleared. Fixes and decisions stay (/asreset all clears them too).' }
}

// ---------------------------------------------------------------- the pane

type View = {
  current: string
  m: Modes
  calls: readonly CallRec[]
  files: readonly FileRow[]
  errors: readonly ErrRow[]
  fixes: readonly FixRow[]
  prompts: readonly PromptRow[]
  recall: readonly RecallRow[]
  decisions: readonly string[]
  stuck: Stuck
  sel: Sel
  sit: string
  turn: number
  report: string
  handoff: string
  skim: string
  accent: string
  gap: 'xs' | 'sm' | 'md'
  calm: boolean
}

const loadView = async (d: Dollar): Promise<View> => {
  const density = await safe(() => read(d, densityA), 'normal')

  return {
    current: await read(d, tab),
    m: await read(d, modes),
    calls: await read(d, calls),
    files: await read(d, files),
    errors: await read(d, errors),
    fixes: await read(d, fixes),
    prompts: await read(d, prompts),
    recall: await read(d, recall),
    decisions: await read(d, decisions),
    stuck: await read(d, stuck),
    sel: await read(d, sel),
    sit: await read(d, sit),
    turn: await read(d, turn),
    report: await read(d, report),
    handoff: await read(d, handoff),
    skim: await read(d, skim),
    accent: await safe(() => read(d, accentA), 'suggestion'),
    gap: density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm',
    calm: await calmNow(d),
  }
}

const lines = (k: Kit, text: string) => {
  const { Text } = k

  return text.split('\n').map(line => <Text>{line === '' ? ' ' : line}</Text>)
}

const nextTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k
  const chips = nextChips(v.calls, v.turn)
  const failed = lastFailure(v.calls)

  return (
    <Box flexDirection="column" gap={v.gap}>
      <Text size="heading" weight="bold">Next steps</Text>
      <Text dimColor>Heuristics from this session's calls. Pressing one fills the prompt box; nothing is sent.</Text>
      {chips.length === 0 && <Text dimColor>Nothing to suggest right now.</Text>}
      <Box gap="sm">
        {chips.map((c, i) => (
          <Button key={`as-chip-${i}`} label={c.label} variant={i === 0 ? 'primary' : undefined} onPress={() => fillSmart(d, c.text)} />
        ))}
      </Box>
      <Text dimColor>{`Suggestion line: ${v.m.next ? 'on' : 'off'}${v.calm ? ' (calm: held back)' : ''}. /asnext on|off`}</Text>
      <Text size="heading" weight="bold">Stuck</Text>
      {v.stuck.run.length === 0 && <Text dimColor>No run of failures.</Text>}
      {v.stuck.run.length > 0 && (
        <Text color={isStuck(v.stuck.run) ? 'warning' : undefined}>
          {`${plural(v.stuck.run.length, 'failure')} in a row, ${plural(new Set(v.stuck.run).size, 'different command')}${isStuck(v.stuck.run) ? ': stuck' : ''}`}
        </Text>
      )}
      <Box gap="sm">
        <Button key="as-unstick" label="Fill reset prompt" onPress={() => unstickNow(d)} />
        <Button key="as-retry" label="Retry with a tweak" onPress={() => retryNow(d, '')} />
      </Box>
      {failed !== undefined && <Text dimColor>{`last failure: ${oneLine(failed.label, 60)}  ${oneLine(failed.line, 80)}`}</Text>}
    </Box>
  )
}

const findTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button, Input } = k
  const shown = findFiles(v.files, v.sel.find, 10)
  const cmds = recallFind(v.recall, v.sel.recall, 10)

  return (
    <Box flexDirection="column" gap={v.gap}>
      <Text size="heading" weight="bold">Files touched this session</Text>
      <Input key="as-find-input" label="find" placeholder="part of a file name" value={v.sel.find} submitLabel="search" onSubmit={value => setSel(d, { find: value.trim() })} />
      {v.files.length === 0 && <Text dimColor>No file has been read or edited yet.</Text>}
      {shown.map(f => (
        <Button key={`as-file-${f.path}`} plain onPress={() => fillInline(d, `@${f.path}`)}>
          {`@${clip(f.path, 70)}`} <Text dimColor>{`${f.reads}r ${f.edits}e`}</Text>
        </Button>
      ))}
      <Text size="heading" weight="bold">Command recall</Text>
      <Input key="as-recall-input" label="recall" placeholder="words from an earlier command" value={v.sel.recall} submitLabel="search" onSubmit={value => setSel(d, { recall: value.trim() })} />
      <Text dimColor>{`${plural(v.recall.length, 'command')} stored${v.m.recall ? '' : ' (recording is off)'}. Secrets are masked.`}</Text>
      {cmds.map((r, i) => (
        <Button key={`as-cmd-${i}`} plain onPress={() => fillSmart(d, `Run this command again: \`${r.c}\``)}>
          {clip(r.c, 80)} <Text dimColor>{fmtTime(r.at)}</Text>
        </Button>
      ))}
    </Box>
  )
}

const contextTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k
  const rows = compressRows(v.calls)

  return (
    <Box flexDirection="column" gap={v.gap}>
      <Text size="heading" weight="bold">Biggest outputs</Text>
      <Text dimColor>By characters of output recorded this session. Press one to ask to avoid re-reading it.</Text>
      {rows.length === 0 && <Text dimColor>Nothing recorded yet.</Text>}
      {rows.map((r, i) => (
        <Button key={`as-big-${i}`} plain onPress={() => fillSmart(d, avoidPrompt([r]))}>
          {`${fmtSize(r.size)}`} <Text>{clip(r.label, 70)}</Text> <Text dimColor>{r.times > 1 ? `read ${r.times} times` : ''}</Text>
        </Button>
      ))}
      {rows.length > 0 && <Button key="as-avoid-all" label="Avoid re-reading all of these" onPress={() => fillSmart(d, avoidPrompt(rows))} />}
      <Text size="heading" weight="bold">Skim the last answer</Text>
      <Box gap="sm">
        <Button key="as-skim-points" label="First sentences" onPress={() => refreshSkim(d)} />
        <Button key="as-skim-fill" label="Ask for key points" onPress={() => fillSmart(d, SKIM_PROMPT)} />
      </Box>
      {v.skim !== '' && lines(k, v.skim)}
    </Box>
  )
}

const errorsTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button, Input } = k
  const museum = [...v.errors].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 8)
  const found = findFixes(v.fixes, v.sel.fixes, 8)

  return (
    <Box flexDirection="column" gap={v.gap}>
      <Text size="heading" weight="bold">Mistake museum</Text>
      <Text dimColor>Error signatures, most repeated first. A note on the latest one: press Enter below or /asfix.</Text>
      {museum.length === 0 && <Text dimColor>No errors recorded.</Text>}
      {museum.map(e => (
        <Box flexDirection="column">
          <Text weight="semibold" color={e.count > 1 ? 'warning' : undefined}>{`${e.count > 1 ? `x${e.count} ` : ''}${e.sig}`}</Text>
          <Text dimColor>{`${fmtTime(e.last)}${e.fix === '' ? '' : `  fix: ${e.fix}`}`}</Text>
        </Box>
      ))}
      <Input key="as-fix-input" label="fix note" placeholder="how you fixed the latest error" submitLabel="save" onSubmit={value => (value.trim() === '' ? undefined : void addFix(d, value))} />
      <Text size="heading" weight="bold">Fix library</Text>
      <Input key="as-fixes-input" label="search" placeholder="words from a fix or an error" value={v.sel.fixes} submitLabel="search" onSubmit={value => setSel(d, { fixes: value.trim() })} />
      {found.length === 0 && <Text dimColor>{v.fixes.length === 0 ? 'No fixes saved yet.' : 'No saved fix matches.'}</Text>}
      {found.map(f => (
        <Button key={`as-fix-${f.n}`} plain onPress={() => fillSmart(d, `Apply this known fix if it fits: ${f.text}\n\nIt was for: ${f.sig}`)}>
          {`#${f.n} ${clip(f.text, 70)}`} <Text dimColor>{clip(f.sig, 40)}</Text>
        </Button>
      ))}
    </Box>
  )
}

const promptsTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button, Input } = k
  const guess = guessSituation(v.calls, isStuck(v.stuck.run))
  const current = QUESTIONS[v.sit] === undefined ? guess : v.sit

  return (
    <Box flexDirection="column" gap={v.gap}>
      <Text size="heading" weight="bold">Question bank</Text>
      <Text dimColor>{`Looks like: ${guess}. Press a question to put it in the box.`}</Text>
      <Box gap="sm">
        {SITUATIONS.map(s => (
          <Button key={`as-sit-${s}`} label={s} variant={s === current ? 'primary' : undefined} onPress={() => update(d, sit, () => s)} />
        ))}
      </Box>
      {(QUESTIONS[current] ?? []).map((q, i) => (
        <Button key={`as-q-${i}`} plain onPress={() => fillSmart(d, q)}>
          {q}
        </Button>
      ))}
      <Text size="heading" weight="bold">Checklists</Text>
      <Input key="as-task-input" label="task" placeholder="what the change is" value={v.sel.task} submitLabel="set" onSubmit={value => setSel(d, { task: value.trim() })} />
      <Box gap="sm">
        <Button key="as-pre" label="Pre-flight" onPress={() => fillSmart(d, preflight(v.sel.task))} />
        <Button key="as-post" label="Post-flight" onPress={() => fillSmart(d, postflight(v.sel.task))} />
        <Button key="as-recap" label="Recap prompt" onPress={() => recapNow(d)} />
      </Box>
    </Box>
  )
}

const reportsTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button, Input } = k

  return (
    <Box flexDirection="column" gap={v.gap}>
      <Text size="heading" weight="bold">Bug report draft</Text>
      <Box gap="sm">
        <Button key="as-report-make" label="Draft from recorded errors" onPress={() => cmdHelpReport(d)} />
        {v.report !== '' && <Button key="as-report-fill" label="Put in prompt box" onPress={() => fillSmart(d, v.report)} />}
      </Box>
      {v.report === '' && <Text dimColor>Nothing drafted. It is text only and is never sent.</Text>}
      {v.report !== '' && lines(k, v.report)}
      <Text size="heading" weight="bold">Handoff pack</Text>
      <Input key="as-decide-input" label="decision" placeholder="a decision to carry over" submitLabel="add" onSubmit={value => (value.trim() === '' ? undefined : void cmdHandoff(d, `decide ${value}`))} />
      <Box gap="sm">
        <Button key="as-handoff-make" label="Bundle now" onPress={() => buildHandoff(d)} />
        {v.handoff !== '' && <Button key="as-handoff-fill" label="Put in prompt box" onPress={() => fillSmart(d, v.handoff)} />}
      </Box>
      {v.handoff !== '' && lines(k, v.handoff)}
    </Box>
  )
}

const modesTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k
  const rows: readonly [keyof Modes, string, string][] = [
    ['next', 'Next-step suggestion line', 'one dim line after a turn'],
    ['paste', 'Smart paste label', 'names a pasted trace, log, JSON or diff'],
    ['read', 'Reading time', 'under long assistant text'],
    ['coach', 'Shortcut coach', 'one toast a day'],
    ['rec', 'Recording', 'calls, prompts, errors, file names'],
    ['recall', 'Command recall', 'shell commands, secrets masked'],
  ]

  return (
    <Box flexDirection="column" gap={v.gap}>
      <Text size="heading" weight="bold">Switches</Text>
      {v.calm && <Text color="warning">Calm is on in the settings mod: nothing shows up by itself. Commands and this pane still work.</Text>}
      {rows.map(([key, name, hint]) => (
        <Box gap="sm">
          <Text>{name}</Text>
          <Button key={`as-on-${key}`} label="on" variant={v.m[key] ? 'primary' : undefined} onPress={() => setModes(d, { [key]: true })} />
          <Button key={`as-off-${key}`} label="off" variant={v.m[key] ? undefined : 'primary'} onPress={() => setModes(d, { [key]: false })} />
          <Text dimColor>{hint}</Text>
        </Box>
      ))}
      <Text dimColor>{`${plural(v.calls.length, 'call')}, ${plural(v.files.length, 'file')}, ${plural(v.errors.length, 'error signature')}, ${plural(v.recall.length, 'command')}, ${plural(v.fixes.length, 'fix', 'fixes')} recorded.`}</Text>
      <Button key="as-reset" label="Clear recorded data" onPress={() => clearRecorded(d, false)} />
      <Text dimColor>/as lists every command.</Text>
    </Box>
  )
}

const paneView = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k
  const known = TABS.some(t => t[0] === v.current)
  const now = known ? v.current : 'next'
  const body =
    now === 'find'
      ? findTab(d, k, v)
      : now === 'context'
        ? contextTab(d, k, v)
        : now === 'errors'
          ? errorsTab(d, k, v)
          : now === 'prompts'
            ? promptsTab(d, k, v)
            : now === 'reports'
              ? reportsTab(d, k, v)
              : now === 'modes'
                ? modesTab(d, k, v)
                : nextTab(d, k, v)

  return (
    <Box flexDirection="column" gap={v.gap}>
      <Box gap="sm">
        {TABS.map(([id, label]) => (
          <Button key={`as-tab-${id}`} label={label} variant={now === id ? 'primary' : undefined} onPress={() => update(d, tab, () => id)} />
        ))}
      </Box>
      {body}
      <Text dimColor>Everything here fills the prompt box or shows text. Nothing is sent.</Text>
    </Box>
  )
}

// ---------------------------------------------------------------- the band: one segment, only when it has something

const dismissBand = async (d: Dollar) => {
  await update(d, card, () => null)
  await update(d, paste, () => null)
}

// ---------------------------------------------------------------- the mod

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const refused: string[] = []

    for (const [name, hint, description] of COMMANDS) {
      const isOk = await $.command
        .register(hint === '' ? { name, description } : { name, description, argumentHint: hint })
        .then(
          () => true,
          () => false,
        )

      if (!isOk) {
        refused.push(name)
      }
    }
    await loadAll($).catch(() => undefined)

    if (refused.length > 0) {
      $.ui.toast(`assist: /${refused.join(', /')} could not be registered (name taken)`, { timeoutMs: 8000 })
    }

    return next(e)
  })

  // 86: every command that passes through is counted by name only, so the coach knows what you have not used.
  // Registered first so it sees this mod's own commands too.
  on('command.run', async ($, e, next) => {
    try {
      const m = await read($, modes)

      if (m.rec) {
        const rows = await update($, usage, u => bump(u, e.command))
        await keep($, 'usage', rows)
      }
    } catch {
      // Bookkeeping only.
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------ commands

  on('command.run', { command: 'as' }, async ($, e) => cmdHelp($, e.args))
  on('command.run', { command: 'asnext' }, async ($, e) => cmdNext($, e.args))
  on('command.run', { command: 'asunstick' }, async $ => ({ text: await unstickNow($) }))
  on('command.run', { command: 'asretry' }, async ($, e) => ({ text: await retryNow($, e.args) }))
  on('command.run', { command: 'ascompress' }, async ($, e) => cmdCompress($, e.args))
  on('command.run', { command: 'aspaste' }, async ($, e) => switchCmd($, e.args, 'paste', 'Smart paste label'))
  on('command.run', { command: 'asfind' }, async ($, e) => cmdFind($, e.args))
  on('command.run', { command: 'asrecall' }, async ($, e) => cmdRecall($, e.args))
  on('command.run', { command: 'asrecap' }, async $ => ({ text: await recapNow($) }))
  on('command.run', { command: 'aspre' }, async ($, e) => flightCmd($, e.args, false))
  on('command.run', { command: 'aspost' }, async ($, e) => flightCmd($, e.args, true))
  on('command.run', { command: 'ashelp' }, async $ => cmdHelpReport($))
  on('command.run', { command: 'ashandoff' }, async ($, e) => cmdHandoff($, e.args))
  on('command.run', { command: 'asread' }, async ($, e) => switchCmd($, e.args, 'read', 'Reading time'))
  on('command.run', { command: 'asskim' }, async $ => ({ text: await skimNow($) }))
  on('command.run', { command: 'asq' }, async ($, e) => cmdQ($, e.args))
  on('command.run', { command: 'asfix' }, async ($, e) => ({ text: e.args.trim() === '' ? 'Usage: /asfix <how you fixed the latest error>' : await addFix($, e.args) }))
  on('command.run', { command: 'asfixes' }, async ($, e) => cmdFixes($, e.args))
  on('command.run', { command: 'ascoach' }, async ($, e) => cmdCoach($, e.args))
  on('command.run', { command: 'asrec' }, async ($, e) => switchCmd($, e.args, 'rec', 'Recording'))
  on('command.run', { command: 'asreset' }, async ($, e) => cmdReset($, e.args))

  // ------------------------------------------------------------ tool calls: recorded, never changed

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    try {
      const r = ran as Ran

      if (r.deny === undefined) {
        await recordCall($, e as unknown as Record<string, unknown>, r)
      }
    } catch {
      // Bookkeeping only.
    }

    return ran
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------ the prompt

  on('prompt.submit', async ($, e, next) => {
    const isUsers = e.command === undefined && e.isMeta !== true && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')

    if (isUsers) {
      await safe(() => recordPrompt($, e.text), undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await safe(() => watchEdit($, e, box.text), undefined)

    return box
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------ the end of a turn: 69 suggestion, 86 coach

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    try {
      if (e.agentId === undefined) {
        const now = await $.clock.now()
        await touchActive($, now)

        if (e.answer.trim() !== '') {
          await update($, lastAnswer, () => clip(e.answer, 6000))
        }
        const m = await read($, modes)
        const quiet = await calmNow($)

        if (m.next && !quiet && !e.isAborted && e.reason === 'answer') {
          const first = (await chipsNow($))[0]

          if (first !== undefined) {
            await $.prompt.suggest({ text: first.text })
          }
        }
        if (m.coach && !quiet && !e.isAborted) {
          const day = dayOf(now)
          const shown = await safe(() => $.store.get('assist.coachDay'), undefined)
          const pick = pickCoach(await read($, usage), day)

          if (shown !== day && pick !== undefined && (await toastOnce($, `assist tip: ${pick[0]} ${pick[1]}. You have not used it yet.`))) {
            await keep($, 'coachDay', day)
          }
        }
      }
    } catch {
      // Bookkeeping only.
    }

    return result
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------ 71: an "explain" button on a failed tool row

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const inner = await next(e)

    if (!e.props.isErrored || e.props.isRunning || e.props.isInterrupted || (await calmNow($))) {
      return inner
    }
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {inner}
        <Box>
          <Button key={`as-explain-${e.props.tool_use_id}`} plain label="explain" onPress={() => explainFill($, e.props.tool, e.props.input, e.props.output)} />
        </Box>
      </Box>
    )
  })

  // ------------------------------------------------------------ 82: a dim reading-time line under long answers

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const inner = await next(e)
    const m = await read($, modes)

    if (!m.read || (await calmNow($))) {
      return inner
    }
    const mins = readMinutes(e.props.text)

    if (mins === null) {
      return inner
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {inner}
        <Text dimColor>{`~${mins} min read`}</Text>
      </Box>
    )
  })

  // ------------------------------------------------------------ the band: the recap card or the paste label, never both, never when calm

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)

    if (e.props.hasSurvey) {
      return inner
    }
    const c: RecapCard | null = await read($, card)
    const p: PasteLabel | null = await read($, paste)

    if (c === null && p === null) {
      return inner
    }
    if (await calmNow($)) {
      return inner
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const accent = await safe(() => read($, accentA), 'suggestion')

    return (
      <Box flexDirection="column">
        {inner}
        {c !== null ? (
          <Box gap="sm">
            <Text color={accent}>{`back after ${c.gapMin} min`}</Text>
            <Button key="as-recap-fill" plain label="fill recap prompt" onPress={() => recapNow($)} />
            <Button key="as-band-dismiss" plain label="dismiss" onPress={() => dismissBand($)} />
          </Box>
        ) : (
          p !== null && (
            <Box gap="sm">
              <Text dimColor>{`pasted ${p.kind} · ${plural(p.lines, 'line')}`}</Text>
              <Button key="as-band-dismiss" plain label="dismiss" onPress={() => dismissBand($)} />
            </Box>
          )
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)

    return paneView($, kit, await loadView($))
  })
}
