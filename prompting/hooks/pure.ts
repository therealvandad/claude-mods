// Pure helpers of the prompting mod: no `$`, no engine. Everything here is heuristic text work.

import type { HistRow, Modes } from '../types'

export const BLANK = '___'

// ---------------------------------------------------------------- small text helpers

export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`

export const oneLine = (text: string, max = 100): string => clip(text.replace(/\s+/g, ' ').trim(), max)

export const isName = (name: string): boolean => /^[a-z0-9][a-z0-9_-]{0,23}$/.test(name)

export const splitVerb = (args: string): [string, string] => {
  const trimmed = args.trim()
  const at = trimmed.search(/\s/)

  return at === -1 ? [trimmed.toLowerCase(), ''] : [trimmed.slice(0, at).toLowerCase(), trimmed.slice(at).trim()]
}

export const onOff = (word: string): boolean | undefined => {
  const w = word.trim().toLowerCase()

  return w === 'on' ? true : w === 'off' ? false : undefined
}

export const addBounded = <T,>(list: readonly T[], item: T, max: number): T[] => [...list, item].slice(-max)

// ---------------------------------------------------------------- secrets: never recorded

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}/gi,
]

export const hasSecret = (text: string): boolean => SECRET_PATTERNS.some(p => new RegExp(p.source, p.flags).test(text))

export const maskSecrets = (text: string): string =>
  SECRET_PATTERNS.reduce((out, p) => out.replace(new RegExp(p.source, p.flags), '[hidden]'), text)

// ---------------------------------------------------------------- 1 templates

export const BUILTIN_TEMPLATES: Readonly<Record<string, string>> = {
  bug: 'Bug in ___, expected ___, got ___.',
  feature: 'Add ___ to ___ so that ___.',
  refactor: 'Refactor ___ to ___ without changing behavior. Check it with ___.',
  explain: 'Explain how ___ works, for someone who knows ___ but not ___.',
  test: 'Write tests for ___ covering ___ and ___.',
  review: 'Review ___ for ___. Report findings by severity and say what you did not check.',
}

export const blankCount = (template: string): number => template.split(BLANK).length - 1

// Fills the blanks in order; the caret goes to the first blank left, else the end.
export const fillBlanks = (template: string, parts: readonly string[]): { text: string; cursor: number; left: number } => {
  const pieces = template.split(BLANK)
  let text = pieces[0] ?? ''

  for (let i = 1; i < pieces.length; i += 1) {
    const part = parts[i - 1]?.trim()
    text += (part !== undefined && part !== '' ? part : BLANK) + (pieces[i] ?? '')
  }
  const first = text.indexOf(BLANK)

  return { text, cursor: first === -1 ? text.length : first, left: text.split(BLANK).length - 1 }
}

export const parseParts = (rest: string): string[] => {
  if (rest.trim() === '') {
    return []
  }

  return rest.split('|').map(p => p.trim())
}

// ---------------------------------------------------------------- 6 scorecard

const ACTION_VERBS = new Set(
  (
    'add fix write explain refactor review make create implement update remove rename find show list summarize summarise ' +
    'build change check compare convert debug delete describe document draft extract generate improve investigate move ' +
    'look optimize optimise port rewrite run search split test translate trace use verify walk why how what where which when ' +
    'can could should please help give tell read open install set design plan propose suggest merge migrate'
  ).split(' '),
)

const VAGUE = /\b(stuff|things?|somehow|whatever|something|somewhat|etc|and so on|or so|kind of|sort of|a bit|better|nice|good)\b/gi

const WIDE = /\b(everything|entire|the whole|whole (?:codebase|repo|project|app)|from scratch|all of (?:it|the)|rewrite (?:it|the) all)\b/gi

const CONSTRAINT_WORDS = [
  'must',
  'should',
  "don't",
  'do not',
  'never',
  'avoid',
  'without',
  'only',
  'keep',
  'preserve',
  'at most',
  'at least',
  'no more than',
  'exactly',
  'make sure',
  'ensure',
  'unless',
]

const FORMAT_WORDS = /\b(as a (?:list|table|diff|checklist)|bullet|json|markdown|table|in \d+ (?:sentences|lines|words|bullets)|short|brief|concise|one line|step by step)\b/i

const DONE_WORDS = /\b(so that|done when|expected|should pass|passes|acceptance|tests? (?:pass|should)|result should)\b/i

const hasTarget = (text: string): boolean =>
  /`[^`]+`/.test(text) ||
  /(?:^|\s)[\w./-]+\/[\w./-]+/.test(text) ||
  /\b[\w-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|md|json|css|html|sh|rb|swift|kt|c|cpp|h)\b/i.test(text) ||
  /\b[a-z]+[A-Z][A-Za-z]+\b/.test(text) ||
  /\b[a-z]+_[a-z_]+\b/.test(text)

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)))

export type Score = { clarity: number; scope: number; constraints: number; total: number; tip: string }

export const scorePrompt = (text: string): Score => {
  const body = text.trim()
  const words = body === '' ? [] : body.split(/\s+/)
  const first = (words[0] ?? '').toLowerCase().replace(/[^a-z']/g, '')
  const target = hasTarget(body)
  const structured = /\n\s*(?:[-*\d]|#)/.test(body)

  let clarity = words.length < 3 ? 20 : words.length < 6 ? 40 : words.length < 9 ? 58 : 68

  if (ACTION_VERBS.has(first) || /\?\s*$/.test(body)) {
    clarity += 10
  }
  if (target) {
    clarity += 12
  }
  const vague = (body.match(VAGUE) ?? []).length
  clarity -= Math.min(30, vague * 10)

  if (words.length > 250 && !structured) {
    clarity -= 15
  }
  if (/^(it|this|that)\b/i.test(body) && !target) {
    clarity -= 10
  }

  let scope = 40
  scope += target ? 30 : 0
  scope += /\b(only|just the|first|one|single|in (?:the )?[\w./-]+\.\w+)\b/i.test(body) ? 15 : 0
  scope += /\b\d+\b/.test(body) ? 10 : 0
  const wide = (body.match(WIDE) ?? []).length
  scope -= Math.min(40, wide * 25)

  if ((body.match(/\band\b/gi) ?? []).length > 5) {
    scope -= 10
  }
  const lower = body.toLowerCase()
  const hits = new Set(CONSTRAINT_WORDS.filter(w => lower.includes(w))).size
  let constraints = 20 + Math.min(48, hits * 12)
  constraints += FORMAT_WORDS.test(body) ? 15 : 0
  constraints += DONE_WORDS.test(body) ? 15 : 0

  const c = clamp(clarity)
  const s = clamp(scope)
  const k = clamp(constraints)
  const total = clamp(c * 0.4 + s * 0.3 + k * 0.3)
  const low = Math.min(c, s, k)
  const tip =
    low === c
      ? 'Name the action and the target (a file, a function or an error message).'
      : low === s
        ? 'Bound it: say which file, function or part, and what is out of scope.'
        : 'Add a constraint or a finish line: what must hold, or how you will know it is done.'

  return { clarity: c, scope: s, constraints: k, total, tip }
}

export const scoreLine = (row: Pick<HistRow, 'clarity' | 'scope' | 'constraints' | 'total'>): string =>
  `${row.total}/100 (clarity ${row.clarity}, scope ${row.scope}, constraints ${row.constraints})`

export const average = (rows: readonly HistRow[], count = 10): number | null => {
  const last = rows.slice(-count)

  return last.length === 0 ? null : Math.round(last.reduce((sum, r) => sum + r.total, 0) / last.length)
}

// ---------------------------------------------------------------- 2 diff

export type Seg = { kind: 'same' | 'add' | 'del'; text: string }

export const DIFF_MAX = 400

export const wordDiff = (a: string, b: string): { segs: Seg[]; isCut: boolean } => {
  const aw = a.trim() === '' ? [] : a.trim().split(/\s+/)
  const bw = b.trim() === '' ? [] : b.trim().split(/\s+/)
  const isCut = aw.length > DIFF_MAX || bw.length > DIFF_MAX
  const x = aw.slice(0, DIFF_MAX)
  const y = bw.slice(0, DIFF_MAX)
  const rows = x.length + 1
  const cols = y.length + 1
  const table: number[] = new Array<number>(rows * cols).fill(0)

  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        x[i] === y[j] ? (table[(i + 1) * cols + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0)
    }
  }
  const segs: Seg[] = []
  const push = (kind: Seg['kind'], word: string) => {
    const last = segs[segs.length - 1]

    if (last !== undefined && last.kind === kind) {
      last.text += ` ${word}`
    } else {
      segs.push({ kind, text: word })
    }
  }
  let i = 0
  let j = 0

  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('same', x[i] ?? '')
      i += 1
      j += 1
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
      push('del', x[i] ?? '')
      i += 1
    } else {
      push('add', y[j] ?? '')
      j += 1
    }
  }
  for (; i < x.length; i += 1) {
    push('del', x[i] ?? '')
  }
  for (; j < y.length; j += 1) {
    push('add', y[j] ?? '')
  }

  return { segs, isCut }
}

export const diffSummary = (segs: readonly Seg[]): string => {
  const count = (kind: Seg['kind']) => segs.filter(s => s.kind === kind).reduce((n, s) => n + s.text.split(' ').length, 0)
  const added = count('add')
  const removed = count('del')
  const kept = count('same')

  return added === 0 && removed === 0 ? 'identical wording' : `+${added} words, -${removed} words, ${kept} kept`
}

export const diffInline = (segs: readonly Seg[]): string =>
  segs.map(s => (s.kind === 'same' ? s.text : s.kind === 'add' ? `[+${s.text}]` : `[-${s.text}]`)).join(' ')

// ---------------------------------------------------------------- 7 reword

const LEAD_POLITE =
  /^(?:(?:hi|hello|hey)[,!.]?\s+)?(?:i was wondering if (?:you could|you can|maybe you could)|(?:could|can|would) you (?:please |possibly |maybe )?(?:help me )?(?:to )?|would you mind|i would like you to|i want you to|i need you to|i'd like you to|please)\s*/i

const FILLER = /\b(?:please|basically|actually|really|very|honestly|literally|just so you know)\b[,]?\s*/gi

const CONSTRAINT_SENTENCE =
  /\b(must|should|don't|do not|never|avoid|without|only|keep|preserve|at most|at least|no more than|exactly|make sure|ensure|unless|shouldn't|can't|cannot|need to stay|has to)\b/i

const capital = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1))

const sentencesOf = (text: string): string[] => {
  const out: string[] = []

  for (const line of text.split('\n')) {
    const found = line.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []

    for (const piece of found) {
      const s = piece.replace(/^\s*[-*•]\s*/, '').trim()

      if (s !== '') {
        out.push(s)
      }
    }
  }

  return out
}

export const REWORD_MIN = 300

export type Reworded = { text: string; notes: string[] } | { reason: string }

export const rewordDraft = (text: string): Reworded => {
  const body = text.trim()

  if (body.length < REWORD_MIN) {
    return { reason: `That draft is ${body.length} characters; a rewrite is offered from ${REWORD_MIN}.` }
  }
  let removed = 0
  const cleaned = sentencesOf(body).map(sentence => {
    let s = sentence.replace(LEAD_POLITE, () => {
      removed += 1

      return ''
    })
    s = s.replace(FILLER, () => {
      removed += 1

      return ''
    })

    return capital(s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim())
  })
  const seen = new Set<string>()
  const unique = cleaned.filter(s => {
    const key = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

    if (key === '' || seen.has(key)) {
      return false
    }
    seen.add(key)

    return true
  })

  if (unique.length === 0) {
    return { reason: 'Nothing readable to restructure.' }
  }
  const isAction = (s: string) => ACTION_VERBS.has((s.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z']/g, ''))
  const byAction = unique.findIndex(s => !s.endsWith('?') && isAction(s))
  const byStatement = unique.findIndex(s => !s.endsWith('?'))
  const goalAt = byAction !== -1 ? byAction : Math.max(0, byStatement)
  const goal = unique[goalAt] ?? ''
  const rest = unique.filter((_, i) => i !== goalAt)
  const questions = rest.filter(s => s.endsWith('?'))
  const constraints = rest.filter(s => !s.endsWith('?') && CONSTRAINT_SENTENCE.test(s))
  const context = rest.filter(s => !questions.includes(s) && !constraints.includes(s))
  const lines = [`Goal: ${goal}`]
  const section = (title: string, items: string[]) => {
    if (items.length > 0) {
      lines.push('', `${title}:`, ...items.map(i => `- ${i}`))
    }
  }
  section('Context', context)
  section('Constraints', constraints)
  section('Questions', questions)
  const notes = [
    `Grouped ${unique.length} sentences into goal${context.length > 0 ? ', context' : ''}${constraints.length > 0 ? ', constraints' : ''}${questions.length > 0 ? ', questions' : ''}.`,
  ]

  if (removed > 0) {
    notes.push(`Dropped ${removed} politeness or filler phrase${removed === 1 ? '' : 's'}.`)
  }
  if (unique.length < cleaned.length) {
    notes.push(`Dropped ${cleaned.length - unique.length} repeated sentence${cleaned.length - unique.length === 1 ? '' : 's'}.`)
  }
  notes.push('Heuristic only: read it before sending, no model was asked.')

  return { text: lines.join('\n'), notes }
}

// ---------------------------------------------------------------- 18 dictation clean-up

const FILLER_WORDS = /(^|[\s,.])(?:um+|uh+|erm|er|hmm+|uhm)(?=[\s,.!?]|$)[,]?/gi

const ABBREVIATIONS = new Set(['etc', 'vs', 'mr', 'mrs', 'dr', 'eg', 'ie', 'approx', 'inc'])

export const cleanDictation = (text: string): { text: string; changes: number } => {
  let changes = 0
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/)
  const cleaned = parts.map((part, index) => {
    if (index % 2 === 1) {
      return part
    }
    let s = part
    s = s.replace(FILLER_WORDS, (_m, lead: string) => {
      changes += 1

      return lead
    })
    s = s.replace(/,?\s*\byou know,\s*/gi, () => {
      changes += 1

      return ' '
    })
    s = s.replace(/(^|,\s*)like,\s*/gi, (_m, lead: string) => {
      changes += 1

      return lead === '' ? '' : ', '
    })
    s = s.replace(/\b([A-Za-z']{2,})(?:\s+\1\b)+/gi, (_m, w: string) => {
      changes += 1

      return w
    })
    s = s.replace(/[ \t]{2,}/g, () => {
      changes += 1

      return ' '
    })
    s = s.replace(/[ \t]+([,.;!?])/g, (_m, p: string) => {
      changes += 1

      return p
    })
    s = s.replace(/([,;])(?=[A-Za-z])/g, (_m, p: string) => {
      changes += 1

      return `${p} `
    })
    s = s.replace(/([A-Za-z0-9)\]`'"]{2,})([.!?]\s+)([a-z])/g, (m, word: string, stop: string, c: string) => {
      if (ABBREVIATIONS.has(word.toLowerCase())) {
        return m
      }
      changes += 1

      return word + stop + c.toUpperCase()
    })

    return s
  })
  let out = cleaned.join('')
  out = out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  const startsLikeCode = /^[\w./-]*[/._][\w./-]*(\s|$)/.test(out) || out.startsWith('`')

  if (!startsLikeCode && /^[a-z]/.test(out)) {
    out = out.charAt(0).toUpperCase() + out.slice(1)
    changes += 1
  }

  return { text: out, changes }
}

// ---------------------------------------------------------------- 13 assumptions

export const extractAssumptions = (text: string): string[] => {
  const found: string[] = []
  let inFence = false

  for (const raw of text.split('\n')) {
    if (raw.trim().startsWith('```')) {
      inFence = !inFence

      continue
    }
    if (inFence) {
      continue
    }
    const line = raw.replace(/\*\*/g, '').replace(/^[\s>*•\-\d.)]*/, '').trim()

    if (/^(assuming|i assume|i'm assuming|i am assuming)\b/i.test(line)) {
      found.push(oneLine(line, 240))
    }
  }

  return found
}

// ---------------------------------------------------------------- 9 macros

export const expandMacros = (text: string, macros: Readonly<Record<string, string>>): { text: string; used: string[] } => {
  const used: string[] = []
  const bodies: string[] = []
  let rest = text

  for (let i = 0; i < 5; i += 1) {
    const m = /^\s*\/\/([a-z0-9][a-z0-9_-]*)(?=\s|$)/i.exec(rest)
    const name = m?.[1]?.toLowerCase()
    const body = name === undefined ? undefined : macros[name]

    if (m === null || name === undefined || body === undefined) {
      break
    }
    used.push(name)
    bodies.push(body)
    rest = rest.slice(m[0].length)
  }
  if (used.length === 0) {
    return { text, used }
  }
  const tail = rest.trim()

  return { text: tail === '' ? bodies.join('\n') : `${bodies.join('\n')}\n\n${tail}`, used }
}

// ---------------------------------------------------------------- 4, 5, 14, 19, 20 standing instructions

export const TONES: Readonly<Record<string, string>> = {
  terse:
    'Tone preset (terse): answer in as few words as will do. No preamble and no recap; lead with the answer or the result. Keep code and exact commands intact.',
  teach:
    'Tone preset (teach): explain as to a capable newcomer. Say why, not only what, define a term the first time it appears, give a small example when it helps, and end with one thing they could try next.',
  review:
    'Tone preset (review): respond as a careful reviewer. List findings by severity, cite file and line, separate must-fix from nice-to-have, and say what you did not check.',
}

export const ASK_TEXT =
  'Question-first mode: before starting a large or ambiguous task (several files, an unclear goal, or something hard to undo), ask at most three short clarifying questions and wait for the answers. For small, clear requests just do the work. Never ask what you could find out by reading the code.'

export const EXAMPLE_TEXT =
  'Example-first mode: when you explain something or propose a change, begin with a short concrete example (a snippet or a before/after), then give the explanation.'

export const cleanLanguage = (word: string): string => word.replace(/[^\p{L}\p{M} ()-]/gu, '').trim().slice(0, 30)

export const langText = (lang: string): string =>
  `Language: reply in ${lang}. Keep code, commands, file paths and identifiers as they are. If the user writes in another language, still answer in ${lang} unless they ask otherwise.`

export const cleanPin = (rule: string): string => oneLine(rule.replace(/[\u0000-\u001f]/g, ' '), 160)

export const pinText = (pins: readonly string[]): string =>
  `Pinned constraints from the user (they apply to every reply this session):\n${pins.map(p => `- ${p}`).join('\n')}`

export const standingText = (modes: Modes, pins: readonly string[]): string | null => {
  const parts: string[] = []
  const tone = TONES[modes.tone]

  if (tone !== undefined) {
    parts.push(tone)
  }
  if (modes.ask) {
    parts.push(ASK_TEXT)
  }
  if (modes.lang !== '') {
    parts.push(langText(modes.lang))
  }
  if (modes.example) {
    parts.push(EXAMPLE_TEXT)
  }
  if (pins.length > 0) {
    parts.push(pinText(pins))
  }

  return parts.length === 0 ? null : parts.join('\n\n')
}

export const standingNames = (modes: Modes, pins: readonly string[]): string[] => {
  const names: string[] = []

  if (modes.tone !== 'off') {
    names.push(`tone ${modes.tone}`)
  }
  if (modes.ask) {
    names.push('question-first')
  }
  if (modes.lang !== '') {
    names.push(`language ${modes.lang}`)
  }
  if (modes.example) {
    names.push('example-first')
  }
  if (pins.length > 0) {
    names.push(`${pins.length} pinned`)
  }

  return names
}

export const DEFAULT_MODES: Modes = { tone: 'off', ask: false, lang: '', example: false, rec: true, hints: true }

// Whatever the store holds, only known fields of the right kind come back.
export const readModes = (raw: unknown): Modes => {
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const tone = r.tone === 'terse' || r.tone === 'teach' || r.tone === 'review' ? r.tone : 'off'

  return {
    tone,
    ask: r.ask === true,
    lang: typeof r.lang === 'string' ? cleanLanguage(r.lang) : '',
    example: r.example === true,
    rec: r.rec !== false,
    hints: r.hints !== false,
  }
}

export const readNamed = (raw: unknown, maxItems: number, maxChars: number): Record<string, string> => {
  const out: Record<string, string> = {}

  if (raw === null || typeof raw !== 'object') {
    return out
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isName(k) && typeof v === 'string' && Object.keys(out).length < maxItems) {
      out[k] = v.slice(0, maxChars)
    }
  }

  return out
}

// ---------------------------------------------------------------- 8 quote, 11 summary

export const SUMMARY_PROMPT =
  'Recap this conversation so far in exactly ten lines: what we set out to do, what is done, what we decided, what is still open, and the next step. One plain line each, no preamble.'

export const quoteBlock = (text: string, maxChars = 1500): string => {
  const body = clip(text.trim(), maxChars)

  return `${body.split('\n').map(line => (line === '' ? '>' : `> ${line}`)).join('\n')}\n\n`
}

export const fmtTime = (ms: number): string => {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`
}
