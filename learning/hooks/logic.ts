// Pure helpers for the learning mod: no engine calls, so tests run them directly.
import type { ArchEntry, Card, Flags, ReadItem, Term, WeekCounts } from '../types'

export const DAY = 86_400_000
export const AGAIN_MS = 5 * 60_000
// Days until a card is due again, indexed by the box it just moved into.
export const INTERVAL_DAYS = [0, 1, 2, 4, 8, 16] as const
export const MAX_BOX = INTERVAL_DAYS.length - 1

export const CAPS = {
  terms: 300,
  projects: 40,
  projectTerms: 150,
  cards: 300,
  log: 300,
  reading: 200,
  arch: 200,
  weeks: 12,
  keysPerWeek: 40,
} as const

export const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// ---------- dates (local time) ----------

const pad = (n: number) => String(n).padStart(2, '0')

export const dayKey = (ms: number) => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The Monday of the week holding `ms`, as a day key. */
export const weekKey = (ms: number) => {
  const d = new Date(ms)
  const back = (d.getDay() + 6) % 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12)

  return dayKey(monday.getTime())
}

export const timeOf = (ms: number) => {
  const d = new Date(ms)

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const formatDue = (due: number, now: number) => {
  const left = due - now

  if (left <= 0) {
    return 'due now'
  }
  const minutes = Math.ceil(left / 60_000)

  if (minutes < 60) {
    return `in ${minutes}m`
  }
  const hours = Math.ceil(left / 3_600_000)

  return hours < 48 ? `in ${hours}h` : `in ${Math.ceil(left / DAY)}d`
}

// ---------- argument parsing ----------

const splitOnce = (text: string, sep: string): [string, string] | null => {
  const at = text.indexOf(sep)

  return at < 0 ? null : [text.slice(0, at).trim(), text.slice(at + sep.length).trim()]
}

export const parseTerm = (args: string) => {
  const parts = splitOnce(args, '=')

  if (parts === null || parts[0] === '' || parts[1] === '') {
    return null
  }

  return { term: clip(parts[0], 80), def: clip(parts[1], 500) }
}

export const parseCard = (args: string) => {
  const parts = splitOnce(args, '|')

  if (parts === null || parts[0] === '' || parts[1] === '') {
    return null
  }

  return { q: clip(parts[0], 500), a: clip(parts[1], 500) }
}

/** `<title words> <url> [#topic]`: the last http(s) token is the url, `#word` the topic. */
export const parseRead = (args: string) => {
  const tokens = args.trim().split(/\s+/).filter(t => t !== '')
  let url = ''
  let topic = 'general'
  const words: string[] = []

  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i] ?? ''

    if (url === '' && /^https?:\/\/\S+$/i.test(t)) {
      url = t
    } else if (/^#[\w-]+$/.test(t)) {
      topic = t.slice(1).toLowerCase()
    } else {
      words.unshift(t)
    }
  }

  if (url === '') {
    return null
  }

  return { title: clip(words.join(' ') || url, 120), url: clip(url, 300), topic }
}

// ---------- glossary ----------

export const upsertTerm = (list: Term[], term: string, def: string, at: number, cap: number): Term[] => {
  const key = term.toLowerCase()
  const rest = list.filter(t => t.term.toLowerCase() !== key)

  return [...rest, { term, def, at }].slice(-cap)
}

export const removeTerm = (list: Term[], term: string): Term[] =>
  list.filter(t => t.term.toLowerCase() !== term.trim().toLowerCase())

export const searchTerms = (list: Term[], query: string): Term[] => {
  const q = query.trim().toLowerCase()

  if (q === '') {
    return list
  }

  return list.filter(t => t.term.toLowerCase().includes(q) || t.def.toLowerCase().includes(q))
}

export const sortedTerms = (list: Term[]): Term[] =>
  [...list].sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()))

/** Per-folder glossaries, keyed by cwd, bounded in folders and terms. */
export const putProjectTerm = (
  all: Record<string, Term[]>,
  cwd: string,
  term: string,
  def: string,
  at: number,
): Record<string, Term[]> => {
  const mine = upsertTerm(all[cwd] ?? [], term, def, at, CAPS.projectTerms)
  const next: Record<string, Term[]> = { ...all, [cwd]: mine }
  const keys = Object.keys(next)

  if (keys.length > CAPS.projects) {
    // Drop the folder whose newest term is oldest.
    const newest = (k: string) => Math.max(0, ...(next[k] ?? []).map(t => t.at))
    const oldest = keys.filter(k => k !== cwd).sort((a, b) => newest(a) - newest(b))[0]

    if (oldest !== undefined) {
      delete next[oldest]
    }
  }

  return next
}

// ---------- flashcards (Leitner boxes) ----------

export const makeCard = (id: string, q: string, a: string, now: number): Card => ({
  id,
  q,
  a,
  box: 0,
  due: now,
  seen: 0,
  at: now,
})

/** Knew it: up one box, due after that box's interval. Again: back to box 0, due in minutes. */
export const nextSchedule = (card: Card, knew: boolean, now: number): Card => {
  if (!knew) {
    return { ...card, box: 0, due: now + AGAIN_MS, seen: card.seen + 1 }
  }
  const box = Math.min(MAX_BOX, card.box + 1)

  return { ...card, box, due: now + (INTERVAL_DAYS[box] ?? 1) * DAY, seen: card.seen + 1 }
}

export const dueCards = (cards: Card[], now: number): Card[] =>
  cards.filter(c => c.due <= now).sort((a, b) => a.due - b.due || a.at - b.at)

export const nextDueAt = (cards: Card[], now: number): number | null => {
  const later = cards.filter(c => c.due > now).map(c => c.due)

  return later.length === 0 ? null : Math.min(...later)
}

export const boxCounts = (cards: Card[]): number[] => {
  const counts = INTERVAL_DAYS.map(() => 0)

  for (const c of cards) {
    const box = Math.max(0, Math.min(MAX_BOX, c.box))
    counts[box] = (counts[box] ?? 0) + 1
  }

  return counts
}

/** At most one nudge a day, and only when the person has not switched it off. */
export const shouldNudge = (dueCount: number, isOn: boolean, lastDay: string, today: string) =>
  isOn && dueCount > 0 && lastDay !== today

// ---------- reading list ----------

export const readingByTopic = (items: ReadItem[]): [string, ReadItem[]][] => {
  const by = new Map<string, ReadItem[]>()

  for (const item of items) {
    by.set(item.topic, [...(by.get(item.topic) ?? []), item])
  }

  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

// ---------- architecture map ----------

export const normalizePath = (path: string) =>
  path
    .trim()
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/')

export const addArch = (list: ArchEntry[], path: string, desc: string, cap: number): ArchEntry[] => {
  const clean = normalizePath(path)

  if (clean === '') {
    return list
  }
  const rest = list.filter(a => a.path !== clean)

  return [...rest, { path: clean, desc: clip(desc, 200) }].slice(-cap)
}

type TreeNode = { name: string; desc: string; kids: Map<string, TreeNode> }

/** A text tree of every path (and its parents), descriptions after a dash. */
export const archTree = (entries: ArchEntry[]): string[] => {
  const root: TreeNode = { name: '', desc: '', kids: new Map() }

  for (const entry of entries) {
    let node = root

    for (const part of entry.path.split('/')) {
      let kid = node.kids.get(part)

      if (kid === undefined) {
        kid = { name: part, desc: '', kids: new Map() }
        node.kids.set(part, kid)
      }
      node = kid
    }
    node.desc = entry.desc
  }
  const lines: string[] = []

  const walk = (node: TreeNode, prefix: string) => {
    const kids = [...node.kids.values()].sort((a, b) => {
      const dirDiff = Number(b.kids.size > 0) - Number(a.kids.size > 0)

      return dirDiff !== 0 ? dirDiff : a.name.localeCompare(b.name)
    })

    kids.forEach((kid, i) => {
      const isLast = i === kids.length - 1
      const label = kid.kids.size > 0 ? `${kid.name}/` : kid.name
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${label}${kid.desc === '' ? '' : `  - ${kid.desc}`}`)
      walk(kid, `${prefix}${isLast ? '    ' : '│   '}`)
    })
  }
  walk(root, '')

  return lines
}

// ---------- skill tracker ----------

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const NAMED_FILES = new Set(['dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile'])

export const extOf = (path: string) => {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase()

  if (NAMED_FILES.has(base)) {
    return base
  }
  const dot = base.lastIndexOf('.')

  if (dot < 0 || dot === base.length - 1) {
    return ''
  }

  return base.slice(dot, dot + 16)
}

const bump = (rec: Record<string, number>, key: string, cap: number) => {
  const k = key in rec || Object.keys(rec).length < cap ? key : 'other'

  return { ...rec, [k]: (rec[k] ?? 0) + 1 }
}

/** Count one tool call (and the file extension it touched) into this week's totals. */
export const touchSkills = (
  weeks: Record<string, WeekCounts>,
  tool: string,
  path: string | undefined,
  now: number,
): Record<string, WeekCounts> => {
  const key = weekKey(now)
  const week = weeks[key] ?? { ext: {}, tools: {} }
  const tools = bump(week.tools, tool, CAPS.keysPerWeek)
  const ext = path !== undefined && FILE_TOOLS.has(tool) && extOf(path) !== '' ? bump(week.ext, extOf(path), CAPS.keysPerWeek) : week.ext
  const next = { ...weeks, [key]: { ext, tools } }
  const keep = Object.keys(next).sort().slice(-CAPS.weeks)

  return Object.fromEntries(keep.map(k => [k, next[k] as WeekCounts]))
}

export const topCounts = (rec: Record<string, number>, n: number): [string, number][] =>
  Object.entries(rec)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)

export const barOf = (value: number, max: number, width: number) => {
  const filled = max <= 0 ? 0 : Math.round((Math.max(0, value) / max) * width)

  return '█'.repeat(Math.min(width, filled)).padEnd(width, '░')
}

export const weekTotal = (week: WeekCounts | undefined) =>
  Object.values(week?.tools ?? {}).reduce((a, b) => a + b, 0)

// ---------- prompt fillers ----------

export type FillerKind = 'eli5' | 'walk' | 'why' | 'alt' | 'diagram' | 'quiz' | 'pattern' | 'complex' | 'diff' | 'cardgen' | 'archsuggest'

const about = (arg: string, fallback: string) => (arg.trim() === '' ? fallback : arg.trim())

export const buildPrompt = (kind: FillerKind, arg = ''): string => {
  switch (kind) {
    case 'eli5':
      return 'Explain your last answer simply, with an everyday analogy.'
    case 'walk':
      return `Walk me through ${about(arg, 'the code you just wrote or changed')} step by step, one block at a time. Start with the first block: say what it does and why it is there, then stop and wait for me to say "next" before you continue. Do not change any files.`
    case 'why':
      return `Why did you choose this approach${arg.trim() === '' ? '' : ` for ${arg.trim()}`}? Justify the key decisions, name the assumptions you made, and say what would make you change your mind.`
    case 'alt':
      return `Show two other ways to do ${about(arg, 'this')}. For each, give a short sketch and the trade-offs against what you did (complexity, performance, readability, risk), then say which you would pick and why.`
    case 'diagram':
      return `Draw a diagram of ${about(arg, 'how the pieces we just built fit together')}. Use a Mermaid diagram if it will render, otherwise a clear ASCII diagram, and add one sentence under it saying how to read it.`
    case 'quiz':
      return `Quiz me with three questions about ${about(arg, 'what we just built')}. Ask one question at a time, wait for my answer, then tell me what I got right and what I missed before the next one.`
    case 'pattern':
      return `Point out the design patterns, idioms and notable techniques used in ${about(arg, 'the code we just worked on')}. For each one, name it, say in one sentence why it is used here, and where else I might meet it.`
    case 'complex':
      return `Explain the time and space complexity of ${about(arg, 'the code we just worked on')} in plain words. Say what dominates the cost, how it grows with input size, and give one small numeric example.`
    case 'diff':
      return `Show the changes you made in this session as an annotated diff: after each changed hunk, add a one-line reason for the change.`
    case 'cardgen':
      return `Write 5 flashcards about ${about(arg, 'what we covered in this session')}. Give each as one line in the form: /lncard <question> | <answer>. Keep each answer to one sentence, and output only those lines.`
    case 'archsuggest':
      return `List the main folders and files of ${about(arg, 'this project')}. Give each as one line in the form: /lnarch add <path> <one-line description>. Output only those lines, at most 15, and do not change any files.`
  }
}

// ---------- standing instructions (opt-in, default off) ----------

export const DEFAULT_FLAGS: Flags = { mentor: false, duck: false, beginner: false, eli5: false, nudge: true }

const SECTION_TEXT = {
  mentor:
    'Mentor mode is on: the user is learning. Do not hand over the full solution straight away. Give a hint or a leading question first and name the concept involved. Give the complete answer only if the user asks for it or is still stuck after a hint.',
  duck:
    'Rubber-duck mode is on: respond mostly with short, probing questions that help the user find the problem themselves. Ask one or two at a time, restate the problem in a sentence when that helps, and give a solution only if the user asks for one.',
  beginner:
    'Beginner guardrails are on: explain each technical term in a few words the first time you use it and prefer small, simple steps. Before any destructive or hard-to-undo step (deleting or overwriting files, force operations, rewriting history, system-wide installs), say plainly what it does and ask for explicit confirmation first.',
  eli5: 'ELI5 mode is on: explain things in plain words with an everyday analogy where it helps, and avoid jargon.',
} as const

export const standingSections = (flags: Flags) =>
  (['mentor', 'duck', 'beginner', 'eli5'] as const)
    .filter(k => flags[k])
    .map(k => ({ id: `learning:${k}`, scope: 'session' as const, text: SECTION_TEXT[k] }))

export const parseOnOff = (args: string): boolean | null => {
  const a = args.trim().toLowerCase()

  return a === 'on' ? true : a === 'off' ? false : null
}

// ---------- command table: the one source for registering and for /ln ----------

export const COMMANDS: readonly (readonly [string, string])[] = [
  ['ln', 'List every learning command'],
  ['lnpane', 'Open the learning pane: /lnpane [glossary|cards|log|reading|arch|skills]'],
  ['lneli5', 'Fill the prompt: explain the last answer simply. /lneli5 on|off keeps it as a standing instruction'],
  ['lnterm', 'Glossary: /lnterm <term> = <definition>, /lnterm list, /lnterm search <q>, /lnterm rm <term>'],
  ['lnpterm', 'Per-folder glossary (keyed by the current folder), same forms as /lnterm'],
  ['lncard', 'Flashcards: /lncard <q> | <a>, /lncard list, /lncard rm <n>, /lncard gen [topic] fills a prompt'],
  ['lnreview', 'Quiz yourself on due cards, one at a time, in the pane'],
  ['lnwalk', 'Fill the prompt: walk through <file> one block at a time'],
  ['lnwhy', 'Fill the prompt: justify the approach taken'],
  ['lnalt', 'Fill the prompt: two other ways, with trade-offs'],
  ['lnread', 'Reading list: /lnread <title> <url> [#topic], /lnread list, /lnread done <n>, /lnread rm <n>'],
  ['lndiagram', 'Fill the prompt: ask for a diagram'],
  ['lnlearned', 'Learning log: /lnlearned <text> adds a dated entry, bare lists the latest'],
  ['lnquiz', 'Fill the prompt: three questions about what was built'],
  ['lnpattern', 'Fill the prompt: spot the patterns and idioms used'],
  ['lncomplex', 'Fill the prompt: explain the time and space complexity'],
  ['lnarch', 'Architecture map: /lnarch add <path> <description>, rm <path>, suggest, bare opens the pane'],
  ['lnmentor', '/lnmentor on|off: hint-first answers (default off)'],
  ['lnduck', '/lnduck on|off: Claude mostly asks questions (default off)'],
  ['lndiff', 'Fill the prompt: annotated diff with a one-line reason per change'],
  ['lnbeginner', '/lnbeginner on|off: explain terms, confirm before destructive steps (default off)'],
  ['lnskills', 'File extensions and tools used per week, in the pane'],
  ['lnnudge', '/lnnudge on|off: one toast a day when cards are due (default on)'],
  ['lnreset', 'Clear recorded learning data: /lnreset yes (settings kept)'],
]

export const helpText = () => ['Learning commands:', ...COMMANDS.map(([n, d]) => `/${n}  ${d}`)].join('\n')

export const FILLER_COMMANDS: Record<string, FillerKind> = {
  lnwalk: 'walk',
  lnwhy: 'why',
  lnalt: 'alt',
  lndiagram: 'diagram',
  lnquiz: 'quiz',
  lnpattern: 'pattern',
  lncomplex: 'complex',
  lndiff: 'diff',
}

export const TABS = ['Glossary', 'Cards', 'Log', 'Reading', 'Arch', 'Skills'] as const
export type Tab = (typeof TABS)[number]

export const tabFromWord = (word: string): Tab | null => {
  const w = word.trim().toLowerCase()

  return TABS.find(t => t.toLowerCase() === w || (w.length >= 2 && t.toLowerCase().startsWith(w))) ?? null
}
