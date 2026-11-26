import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import {
  addBounded,
  average,
  BLANK,
  BUILTIN_TEMPLATES,
  blankCount,
  cleanDictation,
  cleanLanguage,
  cleanPin,
  clip,
  DEFAULT_MODES,
  diffInline,
  diffSummary,
  expandMacros,
  extractAssumptions,
  fillBlanks,
  fmtTime,
  hasSecret,
  isName,
  maskSecrets,
  oneLine,
  onOff,
  parseParts,
  quoteBlock,
  readModes,
  readNamed,
  rewordDraft,
  scoreLine,
  scorePrompt,
  splitVerb,
  standingNames,
  standingText,
  SUMMARY_PROMPT,
  wordDiff,
} from './pure'
import type {
  AbRow,
  DecisionRow,
  DiffSel,
  DraftInfo,
  HistRow,
  MarkRow,
  Modes,
  Named,
  Rewrite,
  Tone,
} from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]
type Kit = ReturnType<Dollar['ui']['resolve']>

// Nothing in this mod animates, so it does not read the `motion` flag.

// ---------------------------------------------------------------- state
// Change a shape tag when the stored fields change: it declines what an earlier version stored.
const modes = atom({ plugin: 'prompting', key: 'modes' } as const, DEFAULT_MODES, { shape: 'modes-1' })
const tpls = atom({ plugin: 'prompting', key: 'tpls' } as const, {}, { shape: 'tpls-1' })
const ctxs = atom({ plugin: 'prompting', key: 'ctxs' } as const, {}, { shape: 'ctxs-1' })
const macros = atom({ plugin: 'prompting', key: 'macros' } as const, {}, { shape: 'macros-1' })
const queue = atom({ plugin: 'prompting', key: 'queue' } as const, [], { shape: 'queue-1' })
const abs = atom({ plugin: 'prompting', key: 'abs' } as const, [], { shape: 'abs-1' })
const marks = atom({ plugin: 'prompting', key: 'marks' } as const, [], { shape: 'marks-1' })
const decisions = atom({ plugin: 'prompting', key: 'decisions' } as const, [], { shape: 'decisions-1' })
const history = atom({ plugin: 'prompting', key: 'history' } as const, [], { shape: 'history-1' })
const assumptions = atom({ plugin: 'prompting', key: 'assumptions' } as const, [], { shape: 'assumptions-1' })
const pins = atom({ plugin: 'prompting', key: 'pins' } as const, [], { shape: 'pins-1' })
const attached = atom({ plugin: 'prompting', key: 'attached' } as const, [], { shape: 'attached-1' })
const diffSel = atom({ plugin: 'prompting', key: 'diffSel' } as const, { a: 0, b: 0 }, { shape: 'diffsel-1' })
const rewrite = atom({ plugin: 'prompting', key: 'rewrite' } as const, null, { shape: 'rewrite-1' })
const scratch = atom({ plugin: 'prompting', key: 'scratch' } as const, null, { shape: 'scratch-1' })
const draftInfo = atom({ plugin: 'prompting', key: 'draftInfo' } as const, { chars: 0, at: 0 }, { shape: 'draftinfo-1' })
const tab = atom({ plugin: 'prompting', key: 'tab' } as const, 'modes')
const lastAnswer = atom({ plugin: 'prompting', key: 'lastAnswer' } as const, '')
const lastToastAt = atom({ plugin: 'prompting', key: 'lastToastAt' } as const, 0)

const PANE = 'prompting'
const KEEP = { tpls: 40, ctxs: 30, macros: 40, queue: 30, abs: 30, marks: 50, decisions: 100, history: 40, assumptions: 60, pins: 3 }
const MAX_CHARS = { tpl: 1000, ctx: 8000, macro: 1000, queue: 4000, ab: 4000, draft: 8000, history: 1500 }
const TOAST_GAP_MS = 3 * 60 * 1000
const DRAFT_EVERY_MS = 3000
const HINT_CHARS = 800

const TABS = [
  ['modes', 'Modes'],
  ['library', 'Library'],
  ['queue', 'Queue and A/B'],
  ['prompts', 'Prompts'],
  ['notes', 'Notes'],
] as const

const COMMANDS = [
  ['pm', '', 'List these commands and the state of the standing instructions: /pm pane opens the pane'],
  ['pmtpl', '[name] [a | b | c]', 'Fill the prompt from a template with blanks (bug, feature, ...): /pmtpl bug login | 500 | blank. add | rm | list'],
  ['pmdiff', '[a b]', 'Compare two earlier prompts word by word in the pane (default: the last two)'],
  ['pmctx', '[name]', 'Reusable context blocks: /pmctx <name> attaches one to the next prompt. add | rm | show | off | list'],
  ['pmtone', 'terse|teach|review|off', 'Standing tone instruction (default off)'],
  ['pmask', 'on|off', 'Question-first mode: up to three clarifying questions before big tasks (default off)'],
  ['pmscore', '[text]', 'Private clarity, scope and constraints score of each sent prompt, in the pane'],
  ['pmreword', '[text] | apply | hint on|off', 'Heuristic tidier version of a long draft; no model call'],
  ['pmquote', '[lines]', 'Fill the prompt with a quote of the last assistant reply'],
  ['pmmacro', 'add <name> <text> | rm | list', 'Prefix macros: //name at the start of a prompt expands to the stored text'],
  ['pmmark', '<label> | list | go n | rm n', 'Star a reply or moment with a label; go shows where it is'],
  ['pmsum', '', 'Fill the prompt with a request for a ten-line recap of the conversation so far'],
  ['pmdecide', '<text> | list | rm n | fill', 'Decision log'],
  ['pmassume', 'list | clear | fill', 'Lines the assistant started with "Assuming" or "I assume"'],
  ['pmpin', '<rule> | rm n | off', 'Pin a constraint (up to 3): shown above the prompt and added to the system prompt while pinned'],
  ['pmrestore', '', 'Fill the prompt with the autosaved draft (or the last prompt you sent)'],
  ['pmq', 'add <text> | next | list | rm n | clear', 'Prompt queue: next fills the box, never sends'],
  ['pmab', 'new <A> || <B> | use n a|b | better n a|b [note]', 'Store two phrasings and which result was better; never sends'],
  ['pmclean', '[text]', 'Tidy a dictated draft: filler words, repeats, spacing, capitals'],
  ['pmlang', '<language>|off', 'Standing instruction to reply in a language (default off)'],
  ['pmexample', 'on|off', 'Example-first mode: start explanations with an example (default off)'],
  ['pmrec', 'on|off', 'Recording of prompt history, scores and drafts (default on, local only, secrets skipped)'],
  ['pmreset', '[all]', 'Clear recorded data (history, drafts, marks, decisions, assumptions); all also clears your library and settings'],
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
const str = (x: unknown): x is string => typeof x === 'string'
const nat = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

const asRows = <T,>(raw: unknown, ok: (x: Record<string, unknown>) => boolean, max: number): T[] =>
  Array.isArray(raw) ? (raw.filter(x => isObj(x) && ok(x)).slice(-max) as T[]) : []

const nextN = (rows: readonly { n: number }[]): number => rows.reduce((m, r) => Math.max(m, r.n), 0) + 1

const num = (word: string | undefined): number => (word !== undefined && /^\d+$/.test(word) ? Number(word) : Number.NaN)

// `run` is one `update` of an atom of this file; its new value is kept for the next session.
const persist = async <T,>(d: Dollar, key: string, run: () => Promise<T>): Promise<T> => {
  const value = await run()
  await safe(() => d.store.set(`prompting.${key}`, value), undefined)

  return value
}

const toastOnce = async (d: Dollar, text: string) => {
  const now = await d.clock.now()
  const last = await read(d, lastToastAt)

  if (last > 0 && now - last < TOAST_GAP_MS) {
    return
  }
  await update(d, lastToastAt, () => now)
  d.ui.toast(text, { timeoutMs: 6000 })
}

const openPane = async (d: Dollar, to?: string): Promise<boolean> => {
  if (to !== undefined) {
    await update(d, tab, () => to)
  }
  const opened = await safe(() => d.ui.open({ id: PANE, title: 'Prompting' }), undefined)

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

const filledNote = (isFilled: boolean, ok: string): string =>
  isFilled ? ok : 'The prompt box could not take the text (a dialog may be open). Try again from the pane.'

// ---------------------------------------------------------------- loading

const loadAll = async (d: Dollar) => {
  const get = (key: string) => safe(() => d.store.get(`prompting.${key}`), undefined)
  const m = readModes(await get('modes'))
  await update(d, modes, () => m)
  const loaded = {
    tpls: readNamed(await get('tpls'), KEEP.tpls, MAX_CHARS.tpl),
    ctxs: readNamed(await get('ctxs'), KEEP.ctxs, MAX_CHARS.ctx),
    macros: readNamed(await get('macros'), KEEP.macros, MAX_CHARS.macro),
  }
  await update(d, tpls, () => loaded.tpls)
  await update(d, ctxs, () => loaded.ctxs)
  await update(d, macros, () => loaded.macros)
  const q = await get('queue')
  await update(d, queue, () => (Array.isArray(q) ? q.filter(str).slice(0, KEEP.queue) : []))
  const ab = asRows<AbRow>(await get('abs'), r => nat(r.n) && str(r.a) && str(r.b), KEEP.abs)
  await update(d, abs, () => ab)
  const mk = asRows<MarkRow>(await get('marks'), r => nat(r.n) && str(r.label), KEEP.marks)
  await update(d, marks, () => mk)
  const dc = asRows<DecisionRow>(await get('decisions'), r => nat(r.n) && str(r.text), KEEP.decisions)
  await update(d, decisions, () => dc)
  const hs = asRows<HistRow>(await get('history'), r => nat(r.n) && str(r.text) && nat(r.total), KEEP.history)
  await update(d, history, () => hs)
  const draft = await get('draft')

  if (isObj(draft) && str(draft.text) && nat(draft.at)) {
    await update(d, draftInfo, () => ({ chars: (draft.text as string).length, at: draft.at as number }))
  }
}

// ---------------------------------------------------------------- the draft (15) and the long-draft hint (7)

let lastDraft = ''
let savedDraft = ''
let draftTimer: { cancel: () => void } | undefined
let hinted = false

const stashDraft = async (d: Dollar, text: string) => {
  const m = await read(d, modes)

  if (!m.rec || text.trim() === '' || hasSecret(text)) {
    return false
  }
  const now = await d.clock.now()
  savedDraft = text
  await d.store.set('prompting.draft', { text: text.slice(0, MAX_CHARS.draft), at: now })
  await update(d, draftInfo, () => ({ chars: Math.min(text.length, MAX_CHARS.draft), at: now }))

  return true
}

const flushDraft = async (d: Dollar) => {
  draftTimer = undefined
  const text = lastDraft

  if (text === savedDraft || text.trim() === '') {
    return
  }
  const isSaved = await stashDraft(d, text)
  const m = await read(d, modes)

  if (isSaved && m.hints && !hinted && text.length >= HINT_CHARS) {
    hinted = true
    await toastOnce(d, `Long draft (${text.length} characters). /pmreword offers a tidier version.`)
  }
}

// A draft the person is typing; a slash command is not a draft.
const watchDraft = (d: Dollar, text: string) => {
  if (text.trim() === '' || text.trimStart().startsWith('/')) {
    return
  }
  lastDraft = text

  if (draftTimer === undefined) {
    draftTimer = d.clock.after(DRAFT_EVERY_MS, () => {
      void flushDraft(d).catch(() => undefined)
    })
  }
}

// What a draft-reading command works on: its own text, else the box, else the last draft typed.
const draftSource = async (d: Dollar, args: string): Promise<string> => {
  if (args.trim() !== '') {
    return args.trim()
  }
  const box = await safe(() => d.prompt.read(), { text: '', cursor: 0 })

  if (box.text.trim() !== '' && !box.text.trimStart().startsWith('/')) {
    return box.text
  }
  if (lastDraft.trim() !== '') {
    return lastDraft
  }
  const saved = await safe(() => d.store.get('prompting.draft'), undefined)

  return isObj(saved) && str(saved.text) ? saved.text : ''
}

// ---------------------------------------------------------------- the last assistant text (8, 10, 13)

const assistantTexts = async (d: Dollar): Promise<{ texts: string[]; total: number }> => {
  const all = await safe(() => d.session.messages(), undefined)

  if (!Array.isArray(all)) {
    return { texts: [], total: 0 }
  }

  return { texts: all.filter(m => m.role === 'assistant' && m.text.trim() !== '').map(m => m.text), total: all.length }
}

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

// ---------------------------------------------------------------- recording a sent prompt (2, 6)

const recordPrompt = async (d: Dollar, text: string) => {
  const m = await read(d, modes)

  if (!m.rec || text.trim() === '') {
    return
  }
  hinted = false
  await safe(() => stashDraft(d, text), false)
  const s = scorePrompt(text)
  const now = await d.clock.now()
  const rows = await read(d, history)
  const row: HistRow = {
    n: nextN(rows),
    at: now,
    text: clip(maskSecrets(text), MAX_CHARS.history),
    clarity: s.clarity,
    scope: s.scope,
    constraints: s.constraints,
    total: s.total,
    tip: s.tip,
  }
  await persist(d, 'history', () => update(d, history, list => addBounded(list, row, KEEP.history)))
}

// What goes in at submit: macros expand (9), attached context blocks ride along (3).
const prepareSubmit = async (d: Dollar, text: string) => {
  const table = await read(d, macros)
  const expanded = expandMacros(text, table)
  const names = await read(d, attached)
  const blocks = await read(d, ctxs)
  const context = names
    .filter(name => blocks[name] !== undefined)
    .map(name => `<context name="${name}">\n${blocks[name] ?? ''}\n</context>`)

  if (names.length > 0) {
    await update(d, attached, () => [])
  }

  return { text: expanded.text, context }
}

// ---------------------------------------------------------------- command answers

const helpText = async (d: Dollar): Promise<string> => {
  const m = await read(d, modes)
  const p = await read(d, pins)
  const info = await read(d, draftInfo)
  const rows = COMMANDS.map(([name, hint, description]) => `/${name}${hint === '' ? '' : ` ${hint}`}  ${description}`)

  return [
    'prompting: prompt helpers. Every command starts with pm.',
    ...rows,
    '',
    'Standing instructions (all off until you turn them on; they are added to the system prompt):',
    `  tone: ${m.tone}   question-first: ${m.ask ? 'on' : 'off'}   language: ${m.lang === '' ? 'off' : m.lang}   example-first: ${m.example ? 'on' : 'off'}`,
    `  pinned constraints: ${p.length === 0 ? 'none' : p.map(x => `"${oneLine(x, 40)}"`).join(', ')} (this session only)`,
    `Recording: ${m.rec ? 'on' : 'off'}${info.chars > 0 ? `, draft saved (${info.chars} characters, ${fmtTime(info.at)})` : ''}. Long-draft hint: ${m.hints ? 'on' : 'off'}. /pmreset clears recorded data.`,
  ].join('\n')
}

const setModes = (d: Dollar, patch: Partial<Modes>) => persist(d, 'modes', () => update(d, modes, m => ({ ...m, ...patch })))

const cmdHelp = async (d: Dollar, args: string) => {
  if (args.trim().toLowerCase() === 'pane') {
    const isPlaced = await openPane(d, 'modes')

    return { text: isPlaced ? 'Prompting pane opened.' : 'No surface draws a pane here; use the commands.' }
  }

  return { text: await helpText(d) }
}

// 1: templates
const templatesNow = async (d: Dollar): Promise<Named> => ({ ...BUILTIN_TEMPLATES, ...(await read(d, tpls)) })

const fillTemplate = async (d: Dollar, name: string, parts: readonly string[]): Promise<string> => {
  const all = await templatesNow(d)
  const template = all[name]

  if (template === undefined) {
    return `No template "${name}". /pmtpl list shows them.`
  }
  const filled = fillBlanks(template, parts)
  const isFilled = await fillSmart(d, filled.text, filled.cursor)

  return filledNote(
    isFilled,
    filled.left > 0
      ? `Template "${name}" is in the prompt box with ${filled.left} blank${filled.left === 1 ? '' : 's'} (${BLANK}) left to fill.`
      : `Template "${name}" is filled in the prompt box.`,
  )
}

const cmdTpl = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const mine = await read(d, tpls)

  if (verb === '' || verb === 'list') {
    const all = await templatesNow(d)
    const lines = Object.keys(all).map(name => `  ${name}${mine[name] === undefined ? '' : ' (yours)'}: ${all[name] ?? ''}`)

    return { text: `Templates (${BLANK} marks a blank; /pmtpl <name> [first | second | ...] fills them in order):\n${lines.join('\n')}` }
  }
  if (verb === 'add') {
    const [name, text] = splitVerb(rest)

    if (!isName(name) || text === '') {
      return { text: `Usage: /pmtpl add <name> <text with ${BLANK} for each blank>. Names are lowercase letters, digits, - and _.` }
    }
    if (mine[name] === undefined && Object.keys(mine).length >= KEEP.tpls) {
      return { text: `You already have ${KEEP.tpls} templates; /pmtpl rm one first.` }
    }
    await persist(d, 'tpls', () => update(d, tpls, t => ({ ...t, [name]: text.slice(0, MAX_CHARS.tpl) })))

    return { text: `Saved template "${name}" with ${blankCount(text)} blank${blankCount(text) === 1 ? '' : 's'}.` }
  }
  if (verb === 'rm') {
    const name = rest.trim().toLowerCase()

    if (mine[name] === undefined) {
      return { text: BUILTIN_TEMPLATES[name] === undefined ? `No template "${name}" of yours.` : 'Built-in templates cannot be removed; save your own under that name to override it.' }
    }
    await persist(d, 'tpls', () => update(d, tpls, t => Object.fromEntries(Object.entries(t).filter(([k]) => k !== name))))

    return { text: `Removed "${name}".` }
  }

  return { text: await fillTemplate(d, verb, parseParts(rest)) }
}

// 3: context blocks
const toggleAttach = async (d: Dollar, name: string): Promise<boolean> => {
  const list = await read(d, attached)
  const isOn = !list.includes(name)
  await update(d, attached, l => (isOn ? [...l.filter(x => x !== name), name] : l.filter(x => x !== name)))

  return isOn
}

const cmdCtx = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const blocks = await read(d, ctxs)
  const names = Object.keys(blocks)

  if (verb === '' || verb === 'list') {
    const on = await read(d, attached)

    return {
      text:
        names.length === 0
          ? 'No context blocks yet. /pmctx add <name> <text>, then /pmctx <name> attaches it to your next prompt.'
          : `Context blocks (attached ones ride along with your next prompt, then detach):\n${names.map(n => `  ${on.includes(n) ? '[attached] ' : ''}${n}: ${oneLine(blocks[n] ?? '', 80)}`).join('\n')}`,
    }
  }
  if (verb === 'add') {
    const [name, text] = splitVerb(rest)

    if (!isName(name) || text === '') {
      return { text: 'Usage: /pmctx add <name> <text>. Names are lowercase letters, digits, - and _.' }
    }
    if (blocks[name] === undefined && names.length >= KEEP.ctxs) {
      return { text: `You already have ${KEEP.ctxs} context blocks; /pmctx rm one first.` }
    }
    await persist(d, 'ctxs', () => update(d, ctxs, c => ({ ...c, [name]: text.slice(0, MAX_CHARS.ctx) })))

    return { text: `Saved context "${name}" (${Math.min(text.length, MAX_CHARS.ctx)} characters). /pmctx ${name} attaches it.` }
  }
  if (verb === 'rm') {
    const name = rest.trim().toLowerCase()

    if (blocks[name] === undefined) {
      return { text: `No context "${name}".` }
    }
    await persist(d, 'ctxs', () => update(d, ctxs, c => Object.fromEntries(Object.entries(c).filter(([k]) => k !== name))))
    await update(d, attached, l => l.filter(x => x !== name))

    return { text: `Removed "${name}".` }
  }
  if (verb === 'show') {
    const name = rest.trim().toLowerCase()

    return { text: blocks[name] === undefined ? `No context "${name}".` : `${name}:\n${blocks[name]}` }
  }
  if (verb === 'off' || verb === 'clear' || verb === 'detach') {
    await update(d, attached, () => [])

    return { text: 'Nothing is attached now.' }
  }
  if (blocks[verb] === undefined) {
    return { text: `No context "${verb}". ${names.length === 0 ? 'Add one with /pmctx add <name> <text>.' : `You have: ${names.join(', ')}.`}` }
  }
  const isOn = await toggleAttach(d, verb)

  return {
    text: isOn
      ? `Context "${verb}" will be sent with your next prompt (the model reads it; it is not typed into the box). /pmctx ${verb} again detaches it.`
      : `Context "${verb}" is detached.`,
  }
}

// 4, 5, 19, 20: standing instructions, each off by default
const cmdTone = async (d: Dollar, args: string) => {
  const word = args.trim().toLowerCase()

  if (word === 'terse' || word === 'teach' || word === 'review' || word === 'off') {
    await setModes(d, { tone: word as Tone })

    return { text: word === 'off' ? 'Tone preset is off.' : `Tone preset "${word}" is on: a standing instruction is added to the system prompt until /pmtone off.` }
  }
  const m = await read(d, modes)

  return { text: `Tone preset: ${m.tone}. Usage: /pmtone terse | teach | review | off.` }
}

const cmdSwitch = async (d: Dollar, args: string, key: 'ask' | 'example', label: string) => {
  const to = onOff(args)

  if (to !== undefined) {
    await setModes(d, key === 'ask' ? { ask: to } : { example: to })
  }
  const m = await read(d, modes)
  const on = key === 'ask' ? m.ask : m.example

  return { text: `${label} is ${on ? 'on' : 'off'}${on ? ': a standing instruction is added to the system prompt until you turn it off' : ''}. /${key === 'ask' ? 'pmask' : 'pmexample'} ${on ? 'off' : 'on'} switches it.` }
}

const cmdLang = async (d: Dollar, args: string) => {
  const word = args.trim()

  if (word.toLowerCase() === 'off') {
    await setModes(d, { lang: '' })

    return { text: 'Language switch is off.' }
  }
  if (word !== '') {
    const lang = cleanLanguage(word)

    if (lang === '') {
      return { text: 'Usage: /pmlang <language name> | off. Letters only, for example /pmlang German.' }
    }
    await setModes(d, { lang })

    return { text: `Replies will be in ${lang}: a standing instruction is added to the system prompt until /pmlang off.` }
  }
  const m = await read(d, modes)

  return { text: `Language switch: ${m.lang === '' ? 'off' : m.lang}. Usage: /pmlang <language> | off.` }
}

const cmdRec = async (d: Dollar, args: string) => {
  const to = onOff(args)

  if (to !== undefined) {
    await setModes(d, { rec: to })
  }
  const m = await read(d, modes)

  return { text: `Recording is ${m.rec ? 'on' : 'off'}: ${m.rec ? 'sent prompts (secrets masked), their scores and the draft are kept on this machine only; /pmreset clears them' : 'nothing new is kept'}.` }
}

// 14: pins (session only)
const cmdPin = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const list = await read(d, pins)

  if (verb === '' || verb === 'list') {
    return { text: list.length === 0 ? 'No pinned constraints. /pmpin <rule> pins one for this session.' : `Pinned (this session):\n${list.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}` }
  }
  if (verb === 'off' || verb === 'clear') {
    await update(d, pins, () => [])

    return { text: 'Pins cleared.' }
  }
  if (verb === 'rm') {
    const at = num(rest.trim())

    if (!(at >= 1 && at <= list.length)) {
      return { text: 'Usage: /pmpin rm <number>.' }
    }
    await update(d, pins, l => l.filter((_, i) => i !== at - 1))

    return { text: `Unpinned #${at}.` }
  }
  const rule = cleanPin(args)

  if (list.length >= KEEP.pins) {
    return { text: `Three pins at most; /pmpin rm <number> or /pmpin off first.` }
  }
  await update(d, pins, l => [...l, rule])

  return { text: `Pinned: "${rule}". It shows above the prompt and goes into the system prompt until you unpin it.` }
}

// 6: the scorecard (private: the pane shows it; the model never sees it)
const cmdScore = async (d: Dollar, args: string) => {
  if (args.trim() !== '') {
    const s = scorePrompt(args.trim())
    await update(d, scratch, () => ({ n: 0, at: 0, text: clip(maskSecrets(args.trim()), 400), ...s }))
    const isPlaced = await openPane(d, 'prompts')

    return { text: isPlaced ? 'Scored; the card is in the pane (not recorded).' : `${scoreLine(s)}. ${s.tip}` }
  }
  const rows = await read(d, history)
  const last = rows[rows.length - 1]
  const isPlaced = await openPane(d, 'prompts')

  if (last === undefined) {
    return { text: isPlaced ? 'No sent prompts scored yet. Scores are shown in the pane only.' : 'No sent prompts scored yet.' }
  }

  return {
    text: isPlaced
      ? `Scorecard is in the pane (private; nothing is sent to the model). Average of the last ${Math.min(10, rows.length)}: ${average(rows)}/100.`
      : `Last prompt #${last.n}: ${scoreLine(last)}. ${last.tip} Average of the last ${Math.min(10, rows.length)}: ${average(rows)}/100.`,
  }
}

// 2: prompt history diff
const pickRow = (rows: readonly HistRow[], n: number): HistRow | undefined => rows.find(r => r.n === n)

const cmdDiff = async (d: Dollar, args: string) => {
  const rows = await read(d, history)
  const found = args.match(/(\d+)\D+(\d+)/)
  let a = found === null ? 0 : Number(found[1])
  let b = found === null ? 0 : Number(found[2])

  if (found === null) {
    const last = rows.slice(-2)

    if (last.length < 2) {
      return { text: 'Need two recorded prompts to compare (recording is on by default; send two prompts first).' }
    }
    a = last[0]?.n ?? 0
    b = last[1]?.n ?? 0
  }
  const left = pickRow(rows, a)
  const right = pickRow(rows, b)

  if (left === undefined || right === undefined) {
    return { text: `Prompt #${left === undefined ? a : b} is not recorded. The pane's Prompts tab lists the numbers (the last ${KEEP.history} are kept).` }
  }
  await update(d, diffSel, () => ({ a, b }))
  const isPlaced = await openPane(d, 'prompts')
  const { segs, isCut } = wordDiff(left.text, right.text)

  return { text: `#${a} against #${b}: ${diffSummary(segs)}${isCut ? ' (first 400 words each)' : ''}.${isPlaced ? ' Shown in the pane.' : `\n${clip(diffInline(segs), 1200)}`}` }
}

const pressHistory = (d: Dollar, n: number) =>
  update(d, diffSel, sel => (sel.a === 0 ? { a: n, b: 0 } : sel.b === 0 && sel.a !== n ? { a: sel.a, b: n } : { a: n, b: 0 }))

// 7: reword suggestions
const cmdReword = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)

  if (verb === 'hint') {
    const to = onOff(rest)

    if (to !== undefined) {
      await setModes(d, { hints: to })
    }
    const m = await read(d, modes)

    return { text: `Long-draft hint is ${m.hints ? 'on' : 'off'}: ${m.hints ? 'at most one toast every 3 minutes, for drafts of 800 characters or more' : 'no toast'}.` }
  }
  if (verb === 'apply') {
    const current = await read(d, rewrite)

    if (current === null) {
      return { text: 'No rewrite waiting. /pmreword [text] makes one.' }
    }
    const isFilled = await safe(() => d.prompt.fill({ text: current.text, mode: 'replace' }), undefined)

    return { text: filledNote(isFilled?.isFilled === true, 'The rewrite is in the prompt box; your original draft stays recoverable with /pmrestore.') }
  }
  const source = await draftSource(d, args)
  const result = rewordDraft(source)

  if ('reason' in result) {
    return { text: result.reason }
  }
  await update(d, rewrite, () => ({ orig: clip(source, MAX_CHARS.draft), text: result.text, notes: result.notes }))
  await safe(() => stashDraft(d, source), false)

  return { text: `${result.text}\n\n${result.notes.join(' ')}\n/pmreword apply puts it in the prompt box (or press Use in the pane).` }
}

const applyRewrite = async (d: Dollar) => {
  const current = await read(d, rewrite)

  if (current !== null) {
    await safe(() => d.prompt.fill({ text: current.text, mode: 'replace' }), undefined)
    await update(d, rewrite, () => null)
  }
}

// 18: dictation clean-up
const cleanNow = async (d: Dollar, args: string): Promise<string> => {
  const source = await draftSource(d, args)

  if (source.trim() === '') {
    return 'Nothing to clean: type or dictate a draft first, or give the text: /pmclean <text>.'
  }
  const { text, changes } = cleanDictation(source)

  if (text === source.trim()) {
    return 'The draft is already tidy.'
  }
  await safe(() => stashDraft(d, source), false)
  const result = await safe(() => d.prompt.fill({ text, mode: 'replace' }), undefined)

  return filledNote(result?.isFilled === true, `Tidied ${changes} thing${changes === 1 ? '' : 's'} (filler words, repeats, spacing, capitals); the cleaned draft is in the box and the original is kept for /pmrestore.`)
}

// 8: quote the last reply
const quoteNow = async (d: Dollar, lines: number): Promise<string> => {
  const text = await lastAnswerText(d)

  if (text.trim() === '') {
    return 'No assistant reply to quote yet.'
  }
  const picked = lines > 0 ? text.trim().split('\n').filter(l => l.trim() !== '').slice(-lines).join('\n') : text
  const isFilled = await fillSmart(d, quoteBlock(picked))

  return filledNote(isFilled, `Quoted ${lines > 0 ? `the last ${lines} line${lines === 1 ? '' : 's'} of` : ''} the last reply in the prompt box; write under it.`)
}

// 9: macros
const cmdMacro = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const table = await read(d, macros)

  if (verb === '' || verb === 'list') {
    const names = Object.keys(table)

    return {
      text:
        names.length === 0
          ? 'No macros yet. /pmmacro add t Answer tersely. Then start a prompt with //t to expand it.'
          : `Macros (a prompt that starts with //name expands to the text):\n${names.map(n => `  //${n}: ${oneLine(table[n] ?? '', 90)}`).join('\n')}`,
    }
  }
  if (verb === 'add') {
    const [name, text] = splitVerb(rest)

    if (!isName(name) || text === '') {
      return { text: 'Usage: /pmmacro add <name> <text>. Names are lowercase letters, digits, - and _.' }
    }
    if (table[name] === undefined && Object.keys(table).length >= KEEP.macros) {
      return { text: `You already have ${KEEP.macros} macros; /pmmacro rm one first.` }
    }
    await persist(d, 'macros', () => update(d, macros, t => ({ ...t, [name]: text.slice(0, MAX_CHARS.macro) })))

    return { text: `Saved //${name}. Start a prompt with //${name} to expand it when you send.` }
  }
  if (verb === 'rm') {
    const name = rest.trim().toLowerCase().replace(/^\/\//, '')

    if (table[name] === undefined) {
      return { text: `No macro //${name}.` }
    }
    await persist(d, 'macros', () => update(d, macros, t => Object.fromEntries(Object.entries(t).filter(([k]) => k !== name))))

    return { text: `Removed //${name}.` }
  }

  return { text: 'Usage: /pmmacro add <name> <text> | rm <name> | list.' }
}

// 10: bookmarks
const cmdMark = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const list = await read(d, marks)

  if (verb === '' || verb === 'list') {
    return {
      text:
        list.length === 0
          ? 'No marks yet. /pmmark <label> stars the latest reply.'
          : `Marks:\n${list.map(m => `  ${m.n}. ${m.label} (reply ${m.reply}, ${fmtTime(m.at)})${m.excerpt === '' ? '' : `: ${m.excerpt}`}`).join('\n')}`,
    }
  }
  if (verb === 'rm') {
    const at = num(rest.trim())

    if (!list.some(m => m.n === at)) {
      return { text: 'Usage: /pmmark rm <number>.' }
    }
    await persist(d, 'marks', () => update(d, marks, l => l.filter(m => m.n !== at)))

    return { text: `Removed mark ${at}.` }
  }
  if (verb === 'go') {
    const at = num(rest.trim())
    const m = list.find(x => x.n === at)

    if (m === undefined) {
      return { text: 'Usage: /pmmark go <number>.' }
    }
    const now = await assistantTexts(d)

    return {
      text: `Mark ${m.n} "${m.label}": assistant reply ${m.reply}${m.total > 0 ? ` of ${m.total} messages then` : ''}, ${now.texts.length > 0 ? `${now.texts.length} replies and ${now.total} messages now` : 'the transcript is not readable now'}. ${m.excerpt === '' ? '' : `It began: ${m.excerpt}. `}The app cannot scroll for a plugin, so search the transcript for those words.`,
    }
  }
  const label = oneLine(args, 60)
  const now = await assistantTexts(d)
  const answer = (now.texts[now.texts.length - 1] ?? (await read(d, lastAnswer))).trim()
  const stamp = await d.clock.now()
  const row: MarkRow = { n: nextN(list), label, at: stamp, reply: now.texts.length, total: now.total, excerpt: oneLine(answer, 110) }
  await persist(d, 'marks', () => update(d, marks, l => addBounded(l, row, KEEP.marks)))

  return { text: `Marked ${row.n}: "${label}"${answer === '' ? ' (no reply to quote yet)' : ` at reply ${row.reply}`}. /pmmark list shows them.` }
}

// 12: decision log
const cmdDecide = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const list = await read(d, decisions)

  if (verb === '' || verb === 'list') {
    return { text: list.length === 0 ? 'No decisions logged. /pmdecide <text> adds one.' : `Decisions:\n${list.map(x => `  ${x.n}. ${x.text} (${fmtTime(x.at)})`).join('\n')}` }
  }
  if (verb === 'rm') {
    const at = num(rest.trim())

    if (!list.some(x => x.n === at)) {
      return { text: 'Usage: /pmdecide rm <number>.' }
    }
    await persist(d, 'decisions', () => update(d, decisions, l => l.filter(x => x.n !== at)))

    return { text: `Removed decision ${at}.` }
  }
  if (verb === 'fill') {
    return { text: await fillDecisions(d) }
  }
  const text = oneLine(args, 240)
  const stamp = await d.clock.now()
  await persist(d, 'decisions', () => update(d, decisions, l => addBounded(l, { n: nextN(l), text, at: stamp }, KEEP.decisions)))

  return { text: `Logged decision ${nextN(list)}: ${text}` }
}

const fillDecisions = async (d: Dollar): Promise<string> => {
  const list = await read(d, decisions)

  if (list.length === 0) {
    return 'No decisions logged.'
  }
  const isFilled = await fillSmart(d, `Decisions so far:\n${list.map(x => `- ${x.text}`).join('\n')}\n`)

  return filledNote(isFilled, 'The decision list is in the prompt box.')
}

// 13: assumptions
const cmdAssume = async (d: Dollar, args: string) => {
  const verb = args.trim().toLowerCase()
  const list = await read(d, assumptions)

  if (verb === 'clear') {
    await update(d, assumptions, () => [])

    return { text: 'Assumptions cleared.' }
  }
  if (verb === 'fill') {
    return { text: list.length === 0 ? 'No assumptions collected.' : filledNote(await fillSmart(d, `Please confirm or correct these assumptions you made:\n${list.map(x => `- ${x}`).join('\n')}\n`), 'The list is in the prompt box.') }
  }

  return { text: list.length === 0 ? 'No assumptions seen yet: lines the assistant starts with "Assuming" or "I assume" are collected here.' : `Assumptions the assistant stated:\n${list.map((x, i) => `  ${i + 1}. ${x}`).join('\n')}` }
}

// 16: queue
const cmdQueue = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const list = await read(d, queue)

  if (verb === 'add') {
    if (rest === '') {
      return { text: 'Usage: /pmq add <text>.' }
    }
    if (list.length >= KEEP.queue) {
      return { text: `The queue holds ${KEEP.queue}; /pmq next or /pmq clear first.` }
    }
    await persist(d, 'queue', () => update(d, queue, l => [...l, rest.slice(0, MAX_CHARS.queue)]))

    return { text: `Queued (${list.length + 1} waiting). /pmq next puts the first in the box; nothing is sent for you.` }
  }
  if (verb === 'next') {
    return { text: await queueNext(d) }
  }
  if (verb === 'rm') {
    const at = num(rest.trim())

    if (!(at >= 1 && at <= list.length)) {
      return { text: 'Usage: /pmq rm <number>.' }
    }
    await persist(d, 'queue', () => update(d, queue, l => l.filter((_, i) => i !== at - 1)))

    return { text: `Removed item ${at}.` }
  }
  if (verb === 'clear') {
    await persist(d, 'queue', () => update(d, queue, () => []))

    return { text: 'Queue cleared.' }
  }

  return { text: list.length === 0 ? 'The queue is empty. /pmq add <text>.' : `Queue (${list.length}):\n${list.map((x, i) => `  ${i + 1}. ${oneLine(x, 100)}`).join('\n')}` }
}

const queueNext = async (d: Dollar): Promise<string> => {
  const list = await read(d, queue)
  const first = list[0]

  if (first === undefined) {
    return 'The queue is empty.'
  }
  const isFilled = await fillSmart(d, first)

  if (!isFilled) {
    return filledNote(false, '')
  }
  await persist(d, 'queue', () => update(d, queue, l => l.slice(1)))

  return `Next prompt is in the box (${list.length - 1} left). Press Enter to send it; nothing is sent for you.`
}

// 17: A/B
const cmdAb = async (d: Dollar, args: string) => {
  const [verb, rest] = splitVerb(args)
  const list = await read(d, abs)

  if (verb === 'new') {
    const [a = '', b = ''] = rest.split('||').map(s => s.trim())

    if (a === '' || b === '') {
      return { text: 'Usage: /pmab new <phrasing A> || <phrasing B>.' }
    }
    const row: AbRow = { n: nextN(list), a: a.slice(0, MAX_CHARS.ab), b: b.slice(0, MAX_CHARS.ab), better: '', note: '', at: await d.clock.now() }
    await persist(d, 'abs', () => update(d, abs, l => addBounded(l, row, KEEP.abs)))

    return { text: `Stored pair ${row.n}. /pmab use ${row.n} a (or b) fills the box; after you compare results, /pmab better ${row.n} a|b [note].` }
  }
  if (verb === 'use') {
    const [id, side] = rest.split(/\s+/)
    const row = list.find(x => x.n === num(id))

    if (row === undefined || (side !== 'a' && side !== 'b')) {
      return { text: 'Usage: /pmab use <number> a|b.' }
    }

    return { text: filledNote(await fillSmart(d, side === 'a' ? row.a : row.b), `Phrasing ${side.toUpperCase()} of pair ${row.n} is in the box; nothing is sent for you.`) }
  }
  if (verb === 'better') {
    const [id, side, ...note] = rest.split(/\s+/)
    const row = list.find(x => x.n === num(id))

    if (row === undefined || (side !== 'a' && side !== 'b')) {
      return { text: 'Usage: /pmab better <number> a|b [note].' }
    }
    await persist(d, 'abs', () => update(d, abs, l => l.map(x => (x.n === row.n ? { ...x, better: side as 'a' | 'b', note: oneLine(note.join(' '), 160) } : x))))

    return { text: `Pair ${row.n}: ${side.toUpperCase()} gave the better result.` }
  }
  if (verb === 'rm') {
    const at = num(rest.trim())

    if (!list.some(x => x.n === at)) {
      return { text: 'Usage: /pmab rm <number>.' }
    }
    await persist(d, 'abs', () => update(d, abs, l => l.filter(x => x.n !== at)))

    return { text: `Removed pair ${at}.` }
  }

  return {
    text:
      list.length === 0
        ? 'No A/B pairs yet. /pmab new <phrasing A> || <phrasing B>.'
        : `A/B pairs:\n${list.map(x => `  ${x.n}. A: ${oneLine(x.a, 50)} | B: ${oneLine(x.b, 50)}${x.better === '' ? '' : ` -> ${x.better.toUpperCase()} better${x.note === '' ? '' : ` (${x.note})`}`}`).join('\n')}`,
  }
}

// 15: restore
const cmdRestore = async (d: Dollar) => {
  const saved = await safe(() => d.store.get('prompting.draft'), undefined)

  if (!isObj(saved) || !str(saved.text) || saved.text === '') {
    return { text: 'No saved draft. Drafts are kept every few seconds while recording is on (/pmrec).' }
  }
  const isFilled = await fillSmart(d, saved.text)

  return { text: filledNote(isFilled, `Restored the saved draft (${saved.text.length} characters${nat(saved.at) ? `, ${fmtTime(saved.at)}` : ''}).`) }
}

// 11: summary so far
const cmdSum = async (d: Dollar) => ({ text: filledNote(await fillSmart(d, SUMMARY_PROMPT), 'A request for a ten-line recap is in the prompt box; press Enter to send it.') })

// reset
const cmdReset = async (d: Dollar, args: string) => {
  const isAll = args.trim().toLowerCase() === 'all'
  const drop = async (key: string) => safe(() => d.store.delete(`prompting.${key}`), undefined)

  for (const key of ['history', 'draft', 'marks', 'decisions']) {
    await drop(key)
  }
  await update(d, history, () => [])
  await update(d, marks, () => [])
  await update(d, decisions, () => [])
  await update(d, assumptions, () => [])
  await update(d, rewrite, () => null)
  await update(d, scratch, () => null)
  await update(d, diffSel, () => ({ a: 0, b: 0 }))
  await update(d, draftInfo, () => ({ chars: 0, at: 0 }))
  await update(d, lastAnswer, () => '')
  lastDraft = ''
  savedDraft = ''
  draftTimer?.cancel()
  draftTimer = undefined

  if (isAll) {
    for (const key of ['tpls', 'ctxs', 'macros', 'queue', 'abs', 'modes']) {
      await drop(key)
    }
    await update(d, tpls, () => ({}))
    await update(d, ctxs, () => ({}))
    await update(d, macros, () => ({}))
    await update(d, queue, () => [])
    await update(d, abs, () => [])
    await update(d, pins, () => [])
    await update(d, attached, () => [])
    await update(d, modes, () => DEFAULT_MODES)
  }

  return {
    text: isAll
      ? 'Cleared recorded data, your templates, context blocks, macros, queue, A/B pairs, pins, and every setting (all standing instructions are off).'
      : 'Cleared recorded data: prompt history and scores, the saved draft, marks, decisions, assumptions. Your library and settings are untouched (/pmreset all clears those too).',
  }
}

// ---------------------------------------------------------------- the pane

type View = {
  m: Modes
  p: string[]
  att: string[]
  mine: Named
  blocks: Named
  macs: Named
  q: string[]
  ab: AbRow[]
  mk: MarkRow[]
  dc: DecisionRow[]
  hs: HistRow[]
  assume: string[]
  sel: DiffSel
  rw: Rewrite
  scr: HistRow | null
  info: DraftInfo
  current: string
}

const loadView = async (d: Dollar): Promise<View> => ({
  m: await read(d, modes),
  p: await read(d, pins),
  att: await read(d, attached),
  mine: await read(d, tpls),
  blocks: await read(d, ctxs),
  macs: await read(d, macros),
  q: await read(d, queue),
  ab: await read(d, abs),
  mk: await read(d, marks),
  dc: await read(d, decisions),
  hs: await read(d, history),
  assume: await read(d, assumptions),
  sel: await read(d, diffSel),
  rw: await read(d, rewrite),
  scr: await read(d, scratch),
  info: await read(d, draftInfo),
  current: await read(d, tab),
})

const modesTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k
  const choice = (key: string, label: string, isOn: boolean, run: () => Promise<unknown>) => (
    <Button key={key} label={label} variant={isOn ? 'primary' : undefined} onPress={run} />
  )

  return (
    <Box flexDirection="column" gap="sm">
      <Text size="heading" weight="bold">Standing instructions</Text>
      <Text dimColor>All start off. When on, one extra section is added to the system prompt.</Text>
      <Box gap="sm">
        <Text>tone</Text>
        {(['off', 'terse', 'teach', 'review'] as const).map(t => choice(`tone-${t}`, t, v.m.tone === t, () => setModes(d, { tone: t })))}
      </Box>
      <Box gap="sm">
        <Text>question-first</Text>
        {choice('ask-on', 'on', v.m.ask, () => setModes(d, { ask: true }))}
        {choice('ask-off', 'off', !v.m.ask, () => setModes(d, { ask: false }))}
      </Box>
      <Box gap="sm">
        <Text>example-first</Text>
        {choice('example-on', 'on', v.m.example, () => setModes(d, { example: true }))}
        {choice('example-off', 'off', !v.m.example, () => setModes(d, { example: false }))}
      </Box>
      <Text>{`language: ${v.m.lang === '' ? 'off' : v.m.lang}   (/pmlang <language> | off)`}</Text>
      <Text size="heading" weight="bold">Pinned constraints</Text>
      {v.p.length === 0 && <Text dimColor>None. /pmpin {'<rule>'} pins one for this session.</Text>}
      {v.p.map((rule, i) => (
        <Box gap="sm">
          <Text>{rule}</Text>
          <Button key={`unpin-${i}`} label="Unpin" onPress={() => update(d, pins, l => l.filter((_, at) => at !== i))} />
        </Box>
      ))}
      <Text size="heading" weight="bold">Recording</Text>
      <Box gap="sm">
        <Text>prompt history, scores and draft</Text>
        {choice('rec-on', 'on', v.m.rec, () => setModes(d, { rec: true }))}
        {choice('rec-off', 'off', !v.m.rec, () => setModes(d, { rec: false }))}
      </Box>
      <Text dimColor>{v.info.chars > 0 ? `Draft saved: ${v.info.chars} characters at ${fmtTime(v.info.at)}.` : 'No draft saved yet.'}</Text>
      <Box gap="sm">
        <Button key="restore" label="Restore draft" onPress={() => cmdRestore(d)} />
        <Button key="sum" label="Summary so far" onPress={() => cmdSum(d)} />
        <Button key="quote" label="Quote last reply" onPress={() => quoteNow(d, 0)} />
      </Box>
    </Box>
  )
}

const libraryTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k
  const all: Named = { ...BUILTIN_TEMPLATES, ...v.mine }
  const blocks = Object.keys(v.blocks)
  const macs = Object.keys(v.macs)

  return (
    <Box flexDirection="column" gap="sm">
      <Text size="heading" weight="bold">Templates</Text>
      <Text dimColor>Press one to fill the prompt box; the caret lands on the first blank.</Text>
      {Object.keys(all).map(name => (
        <Button key={`tpl-${name}`} plain onPress={() => fillTemplate(d, name, [])}>
          {name} <Text dimColor>{clip(all[name] ?? '', 70)}</Text>
        </Button>
      ))}
      <Text size="heading" weight="bold">Context blocks</Text>
      {blocks.length === 0 && <Text dimColor>None. /pmctx add {'<name> <text>'}</Text>}
      {blocks.map(name => (
        <Button key={`ctx-${name}`} plain onPress={() => toggleAttach(d, name)}>
          {v.att.includes(name) ? '[attached] ' : ''}
          {name} <Text dimColor>{clip(v.blocks[name] ?? '', 60)}</Text>
        </Button>
      ))}
      {blocks.length > 0 && <Text dimColor>Press to attach or detach. An attached block goes with your next prompt only.</Text>}
      <Text size="heading" weight="bold">Macros</Text>
      {macs.length === 0 && <Text dimColor>None. /pmmacro add t Answer tersely.</Text>}
      {macs.map(name => (
        <Text>
          {`//${name} `}
          <Text dimColor>{clip(v.macs[name] ?? '', 70)}</Text>
        </Text>
      ))}
    </Box>
  )
}

const queueTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k

  return (
    <Box flexDirection="column" gap="sm">
      <Text size="heading" weight="bold">Queue</Text>
      {v.q.length === 0 && <Text dimColor>Empty. /pmq add {'<text>'}</Text>}
      {v.q.map((item, i) => (
        <Text>{`${i + 1}. ${clip(item.replace(/\s+/g, ' '), 90)}`}</Text>
      ))}
      <Box gap="sm">
        <Button key="queue-next" label="Next into the box" onPress={() => queueNext(d)} />
        <Button key="queue-clear" label="Clear" onPress={() => persist(d, 'queue', () => update(d, queue, () => []))} />
      </Box>
      <Text dimColor>Nothing is ever sent for you.</Text>
      <Text size="heading" weight="bold">A/B phrasings</Text>
      {v.ab.length === 0 && <Text dimColor>None. /pmab new {'<A> || <B>'}</Text>}
      {v.ab.map(row => (
        <Box flexDirection="column">
          <Text weight="semibold">{`Pair ${row.n}${row.better === '' ? '' : `: ${row.better.toUpperCase()} was better${row.note === '' ? '' : ` (${row.note})`}`}`}</Text>
          <Text dimColor>{`A: ${clip(row.a.replace(/\s+/g, ' '), 70)}`}</Text>
          <Text dimColor>{`B: ${clip(row.b.replace(/\s+/g, ' '), 70)}`}</Text>
          <Box gap="sm">
            <Button key={`ab-use-a-${row.n}`} label="Use A" onPress={() => fillSmart(d, row.a)} />
            <Button key={`ab-use-b-${row.n}`} label="Use B" onPress={() => fillSmart(d, row.b)} />
            <Button key={`ab-win-a-${row.n}`} label="A better" onPress={() => persist(d, 'abs', () => update(d, abs, l => l.map(x => (x.n === row.n ? { ...x, better: 'a' as const } : x))))} />
            <Button key={`ab-win-b-${row.n}`} label="B better" onPress={() => persist(d, 'abs', () => update(d, abs, l => l.map(x => (x.n === row.n ? { ...x, better: 'b' as const } : x))))} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

const promptsTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button, Progress } = k
  const last = v.scr ?? v.hs[v.hs.length - 1]
  const shown = [...v.hs].reverse().slice(0, 12)
  const left = pickRow(v.hs, v.sel.a)
  const right = pickRow(v.hs, v.sel.b)
  const diff = left !== undefined && right !== undefined ? wordDiff(left.text, right.text) : null
  const avg = average(v.hs)

  return (
    <Box flexDirection="column" gap="sm">
      <Text size="heading" weight="bold">Scorecard (private)</Text>
      <Text dimColor>A rough heuristic on the wording. It is shown here only; the model never sees it.</Text>
      {last === undefined && <Text dimColor>No prompts scored yet.</Text>}
      {last !== undefined && (
        <Box flexDirection="column">
          <Text>{`${v.scr === null ? `Last prompt #${last.n}` : 'Text you scored'}: ${last.total}/100${avg === null ? '' : `   average of the last ${Math.min(10, v.hs.length)}: ${avg}`}`}</Text>
          <Progress label="clarity" value={last.clarity / 100} valueText={String(last.clarity)} color="suggestion" />
          <Progress label="scope" value={last.scope / 100} valueText={String(last.scope)} color="suggestion" />
          <Progress label="constraints" value={last.constraints / 100} valueText={String(last.constraints)} color="suggestion" />
          <Text dimColor>{last.tip}</Text>
        </Box>
      )}
      <Text size="heading" weight="bold">Sent prompts</Text>
      <Text dimColor>Press two to compare them.</Text>
      {shown.length === 0 && <Text dimColor>Nothing recorded yet.</Text>}
      {shown.map(row => (
        <Button key={`hist-${row.n}`} plain dimColor={row.n !== v.sel.a && row.n !== v.sel.b} onPress={() => pressHistory(d, row.n)}>
          {`${row.n === v.sel.a ? 'A' : row.n === v.sel.b ? 'B' : ' '} #${row.n} ${row.total}`} <Text dimColor>{clip(row.text.replace(/\s+/g, ' '), 70)}</Text>
        </Button>
      ))}
      {diff !== null && left !== undefined && right !== undefined && (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
          <Text weight="semibold">{`#${left.n} to #${right.n}: ${diffSummary(diff.segs)}`}</Text>
          <Text>
            {diff.segs.map(seg =>
              seg.kind === 'same' ? (
                <Text>{`${seg.text} `}</Text>
              ) : seg.kind === 'add' ? (
                <Text color="success">{`${seg.text} `}</Text>
              ) : (
                <Text color="error" strikethrough>{`${seg.text} `}</Text>
              ),
            )}
          </Text>
          {diff.isCut && <Text dimColor>Only the first 400 words of each are compared.</Text>}
        </Box>
      )}
      <Text size="heading" weight="bold">Draft helpers</Text>
      <Box gap="sm">
        <Button key="reword-now" label="Reword draft" onPress={() => rewordFromBox(d)} />
        <Button key="clean-now" label="Clean draft" onPress={() => cleanFromBox(d)} />
        <Button key="score-now" label="Score draft" onPress={() => scoreFromBox(d)} />
      </Box>
      {v.rw !== null && (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
          <Text weight="semibold">Suggested rewrite</Text>
          {v.rw.text.split('\n').map(line => (
            <Text>{line === '' ? ' ' : line}</Text>
          ))}
          <Text dimColor>{v.rw.notes.join(' ')}</Text>
          <Box gap="sm">
            <Button key="rewrite-use" label="Use" variant="primary" onPress={() => applyRewrite(d)} />
            <Button key="rewrite-drop" label="Dismiss" onPress={() => update(d, rewrite, () => null)} />
          </Box>
        </Box>
      )}
    </Box>
  )
}

const rewordFromBox = async (d: Dollar) => {
  const box = await safe(() => d.prompt.read(), { text: '', cursor: 0 })
  const source = box.text.trim() === '' ? lastDraft : box.text
  const result = rewordDraft(source)

  if ('reason' in result) {
    d.ui.toast(result.reason, { timeoutMs: 4000 })

    return
  }
  await update(d, rewrite, () => ({ orig: clip(source, MAX_CHARS.draft), text: result.text, notes: result.notes }))
  await safe(() => stashDraft(d, source), false)
}

const cleanFromBox = async (d: Dollar) => {
  const text = await cleanNow(d, '')
  d.ui.toast(text, { timeoutMs: 4000 })
}

const scoreFromBox = async (d: Dollar) => {
  const source = await draftSource(d, '')

  if (source.trim() === '') {
    d.ui.toast('No draft to score.', { timeoutMs: 3000 })

    return
  }
  const s = scorePrompt(source)
  await update(d, scratch, () => ({ n: 0, at: 0, text: clip(maskSecrets(source), 400), ...s }))
}

const notesTab = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k

  return (
    <Box flexDirection="column" gap="sm">
      <Text size="heading" weight="bold">Marks</Text>
      {v.mk.length === 0 && <Text dimColor>None. /pmmark {'<label>'} stars the latest reply.</Text>}
      {[...v.mk].reverse().map(m => (
        <Box flexDirection="column">
          <Text weight="semibold">{`${m.n}. ${m.label}`}</Text>
          <Text dimColor>{`reply ${m.reply} · ${fmtTime(m.at)}${m.excerpt === '' ? '' : ` · ${m.excerpt}`}`}</Text>
        </Box>
      ))}
      <Text size="heading" weight="bold">Decisions</Text>
      {v.dc.length === 0 && <Text dimColor>None. /pmdecide {'<text>'}</Text>}
      {v.dc.map(x => (
        <Text>{`${x.n}. ${x.text}`}</Text>
      ))}
      {v.dc.length > 0 && <Button key="decide-fill" label="Put the list in the box" onPress={() => fillDecisions(d)} />}
      <Text size="heading" weight="bold">Assumptions</Text>
      {v.assume.length === 0 && <Text dimColor>None seen. Lines starting "Assuming" or "I assume" are collected.</Text>}
      {v.assume.map((x, i) => (
        <Text>{`${i + 1}. ${x}`}</Text>
      ))}
      {v.assume.length > 0 && (
        <Box gap="sm">
          <Button key="assume-fill" label="Ask to confirm" onPress={() => cmdAssume(d, 'fill')} />
          <Button key="assume-clear" label="Clear" onPress={() => update(d, assumptions, () => [])} />
        </Box>
      )}
    </Box>
  )
}

const paneView = (d: Dollar, k: Kit, v: View) => {
  const { Box, Text, Button } = k
  const body =
    v.current === 'library'
      ? libraryTab(d, k, v)
      : v.current === 'queue'
        ? queueTab(d, k, v)
        : v.current === 'prompts'
          ? promptsTab(d, k, v)
          : v.current === 'notes'
            ? notesTab(d, k, v)
            : modesTab(d, k, v)

  return (
    <Box flexDirection="column" gap="sm">
      <Box gap="sm">
        {TABS.map(([id, label]) => (
          <Button key={`tab-${id}`} label={label} variant={v.current === id || (id === 'modes' && !TABS.some(t => t[0] === v.current)) ? 'primary' : undefined} onPress={() => update(d, tab, () => id)} />
        ))}
      </Box>
      {body}
      <Text dimColor>/pm lists every command.</Text>
    </Box>
  )
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

    const m = await read($, modes)
    const names = standingNames(m, [])

    if (refused.length > 0) {
      $.ui.toast(`prompting: /${refused.join(', /')} could not be registered (name taken)`, { timeoutMs: 8000 })
    } else if (names.length > 0) {
      await toastOnce($, `prompting: standing instructions on (${names.join(', ')}). /pm shows them.`).catch(() => undefined)
    }

    return next(e)
  })

  // ------------------------------------------------------------ commands

  on('command.run', { command: 'pm' }, async ($, e) => cmdHelp($, e.args))
  on('command.run', { command: 'pmtpl' }, async ($, e) => cmdTpl($, e.args))
  on('command.run', { command: 'pmdiff' }, async ($, e) => cmdDiff($, e.args))
  on('command.run', { command: 'pmctx' }, async ($, e) => cmdCtx($, e.args))
  on('command.run', { command: 'pmtone' }, async ($, e) => cmdTone($, e.args))
  on('command.run', { command: 'pmask' }, async ($, e) => cmdSwitch($, e.args, 'ask', 'Question-first mode'))
  on('command.run', { command: 'pmexample' }, async ($, e) => cmdSwitch($, e.args, 'example', 'Example-first mode'))
  on('command.run', { command: 'pmscore' }, async ($, e) => cmdScore($, e.args))
  on('command.run', { command: 'pmreword' }, async ($, e) => cmdReword($, e.args))
  on('command.run', { command: 'pmquote' }, async ($, e) => ({ text: await quoteNow($, Math.max(0, num(e.args.trim()) || 0)) }))
  on('command.run', { command: 'pmmacro' }, async ($, e) => cmdMacro($, e.args))
  on('command.run', { command: 'pmmark' }, async ($, e) => cmdMark($, e.args))
  on('command.run', { command: 'pmsum' }, async $ => cmdSum($))
  on('command.run', { command: 'pmdecide' }, async ($, e) => cmdDecide($, e.args))
  on('command.run', { command: 'pmassume' }, async ($, e) => cmdAssume($, e.args))
  on('command.run', { command: 'pmpin' }, async ($, e) => cmdPin($, e.args))
  on('command.run', { command: 'pmrestore' }, async $ => cmdRestore($))
  on('command.run', { command: 'pmq' }, async ($, e) => cmdQueue($, e.args))
  on('command.run', { command: 'pmab' }, async ($, e) => cmdAb($, e.args))
  on('command.run', { command: 'pmclean' }, async ($, e) => ({ text: await cleanNow($, e.args) }))
  on('command.run', { command: 'pmlang' }, async ($, e) => cmdLang($, e.args))
  on('command.run', { command: 'pmrec' }, async ($, e) => cmdRec($, e.args))
  on('command.run', { command: 'pmreset' }, async ($, e) => cmdReset($, e.args))

  // ------------------------------------------------------------ standing instructions (4, 5, 14, 19, 20)

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = standingText(await read($, modes), await read($, pins))

    if (text === null) {
      return composed
    }

    return { ...composed, sections: [...composed.sections, { id: 'prompting:standing', text, scope: 'session' as const }] }
  })

  // ------------------------------------------------------------ the prompt: macros (9), context blocks (3), history and scores (2, 6)

  on('prompt.submit', async ($, e, next) => {
    const isUsers = e.command === undefined && e.isMeta !== true && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')

    if (!isUsers) {
      return next(e)
    }
    const prepared = await safe(() => prepareSubmit($, e.text), { text: e.text, context: [] as string[] })
    const input =
      prepared.context.length > 0 ? { ...e, text: prepared.text, context: [...(e.context ?? []), ...prepared.context] } : { ...e, text: prepared.text }
    const result = await next(input)

    if (result.drop === undefined) {
      await safe(() => recordPrompt($, prepared.text), undefined)
    }

    return result
  })

  // 15: the draft is kept every few seconds while the person types.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await safe(() => watchDraft($, box.text), undefined)

    return box
  })

  // 8, 13: the last assistant text, and the lines that state an assumption.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined && e.answer.trim() !== '') {
      await safe(() => update($, lastAnswer, () => clip(e.answer, 6000)), '')
      const m = await safe(() => read($, modes), DEFAULT_MODES)
      const found = extractAssumptions(e.answer)

      if (m.rec && found.length > 0) {
        await safe(() => update($, assumptions, list => [...list, ...found.filter(x => !list.includes(x))].slice(-KEEP.assumptions)), [])
      }
    }

    return result
  })

  // ------------------------------------------------------------ the band: pinned rules and attached context, only while there are some (14, 3)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    const p = await read($, pins)
    const att = await read($, attached)

    if (e.props.hasSurvey || (p.length === 0 && att.length === 0)) {
      return inner
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {inner}
        <Box gap="sm">
          {p.length > 0 && <Text color="suggestion">pinned</Text>}
          {p.length > 0 && <Text dimColor>{oneLine(p.join(' · '), 100)}</Text>}
          {p.length > 0 && <Button key="prompting-unpin" plain label="unpin" onPress={() => update($, pins, () => [])} />}
          {att.length > 0 && <Text color="suggestion">context</Text>}
          {att.length > 0 && <Text dimColor>{att.join(', ')}</Text>}
          {att.length > 0 && <Button key="prompting-detach" plain label="detach" onPress={() => update($, attached, () => [])} />}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)

    return paneView($, kit, await loadView($))
  })
}
