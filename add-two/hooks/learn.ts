// Pure logic for everything the person writes in add-two: the data model, its strict validation, and the
// list operations behind the commands. No `$` in here.
import type { ArchNode, Card, CheckItem, Data, Decision, QNote, Rec, Retro, Term, Topic } from '../types'
import { clip, note, plural } from './gitparse'
import type { Line } from '../types'

export const LIMITS = {
  repos: 10,
  items: 24,
  topics: 12,
  steps: 16,
  cards: 300,
  words: 200,
  qnotes: 60,
  arch: 60,
  decisions: 100,
  weeks: 26,
  weekItems: 12,
  ratings: 200,
  prompts: 60,
  files: 100,
  todos: 30,
} as const

export const emptyData = (): Data => ({
  pr: {},
  path: [],
  cards: [],
  nextCard: 1,
  seq: 0,
  words: [],
  qnotes: [],
  arch: [],
  nextArch: 1,
  decisions: [],
  nextDecision: 1,
  retros: {},
  ratings: {},
})

export const emptyRec = (): Rec => ({ prompts: [], files: [], todos: [] })

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const int = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const k = typeof v === 'number' && Number.isInteger(v) ? v : dflt

  return Math.min(hi, Math.max(lo, k))
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export const cleanItems = (v: unknown, max: number = LIMITS.items, len = 120): CheckItem[] =>
  arr(v)
    .filter(isObj)
    .map(o => ({ t: clip(o.t, len), done: o.done === true }))
    .filter(i => i.t !== '')
    .slice(0, max)

const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'] as const
export const MOD_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/

/** Accepts anything and returns a valid Data: wrong types are dropped, lists are cut to their limits. */
export const cleanData = (raw: unknown): Data => {
  const o = isObj(raw) ? raw : {}
  const d = emptyData()

  if (isObj(o.pr)) {
    for (const [k, v] of Object.entries(o.pr).slice(-LIMITS.repos)) {
      const key = clip(k, 200)
      const items = cleanItems(v)

      if (key !== '' && items.length > 0) d.pr[key] = items
    }
  }
  d.path = arr(o.path)
    .filter(isObj)
    .map(t => ({ title: clip(t.title, 80), steps: cleanItems(t.steps, LIMITS.steps, 100) }))
    .filter(t => t.title !== '')
    .slice(0, LIMITS.topics)
  d.cards = arr(o.cards)
    .filter(isObj)
    .map((c, i): Card => ({ id: int(c.id, 1, 1e9, i + 1), front: clip(c.front, 200), back: clip(c.back, 400), box: int(c.box, 1, 5, 1), due: int(c.due, 0, 1e6, 0), seen: int(c.seen, 0, 1e9, 0) }))
    .filter(c => c.front !== '' && c.back !== '')
    .slice(0, LIMITS.cards)
  d.nextCard = Math.max(int(o.nextCard, 1, 1e9, 1), ...d.cards.map(c => c.id + 1))
  d.seq = Math.max(int(o.seq, 0, 1e9, 0), ...d.cards.map(c => c.seen))
  d.words = arr(o.words)
    .filter(isObj)
    .map((w): Term => ({ term: clip(w.term, 60), def: clip(w.def, 300) }))
    .filter(w => w.term !== '')
    .slice(0, LIMITS.words)
  d.qnotes = arr(o.qnotes)
    .filter(isObj)
    .map((q): QNote => ({ q: clip(q.q, 200), a: clip(q.a, 400) }))
    .filter(q => q.q !== '')
    .slice(0, LIMITS.qnotes)
  const seen = new Set<number>()
  const nodes: ArchNode[] = []

  for (const a of arr(o.arch).filter(isObj).slice(0, LIMITS.arch)) {
    const id = int(a.id, 1, 1e9, 0)
    const parent = int(a.parent, 0, 1e9, 0)
    const name = clip(a.name, 40)

    // A parent must come earlier: that rules out cycles and orphans.
    if (id === 0 || name === '' || seen.has(id) || (parent !== 0 && !seen.has(parent))) continue
    seen.add(id)
    nodes.push({ id, parent, name, note: clip(a.note, 60) })
  }
  d.arch = nodes
  d.nextArch = Math.max(int(o.nextArch, 1, 1e9, 1), ...nodes.map(x => x.id + 1))
  d.decisions = arr(o.decisions)
    .filter(isObj)
    .map((x, i): Decision => ({
      id: int(x.id, 1, 1e9, i + 1),
      date: typeof x.date === 'string' && DATE.test(x.date) ? x.date : '1970-01-01',
      title: clip(x.title, 100),
      status: (STATUSES as readonly string[]).includes(String(x.status)) ? String(x.status) : 'proposed',
      note: clip(x.note, 200),
    }))
    .filter(x => x.title !== '')
    .slice(-LIMITS.decisions)
  d.nextDecision = Math.max(int(o.nextDecision, 1, 1e9, 1), ...d.decisions.map(x => x.id + 1))

  if (isObj(o.retros)) {
    for (const [k, v] of Object.entries(o.retros).slice(-LIMITS.weeks)) {
      if (!WEEK.test(k) || !isObj(v)) continue
      d.retros[k] = {
        well: arr(v.well).map(t => clip(t, 140)).filter(t => t !== '').slice(0, LIMITS.weekItems),
        improve: arr(v.improve).map(t => clip(t, 140)).filter(t => t !== '').slice(0, LIMITS.weekItems),
        actions: cleanItems(v.actions, LIMITS.weekItems, 140),
      }
    }
  }

  if (isObj(o.ratings)) {
    for (const [k, v] of Object.entries(o.ratings).slice(0, LIMITS.ratings)) {
      if (MOD_NAME.test(k) && typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5) d.ratings[k] = v
    }
  }

  return d
}

export const cleanRec = (raw: unknown): Rec => {
  const o = isObj(raw) ? raw : {}

  return {
    prompts: arr(o.prompts).map(p => clip(p, 300)).filter(p => p !== '').slice(-LIMITS.prompts),
    files: arr(o.files).map(f => clip(f, 300)).filter(f => f !== '').slice(-LIMITS.files),
    todos: arr(o.todos)
      .filter(isObj)
      .map(t => ({ t: clip(t.t, 120), s: ['pending', 'in_progress', 'completed'].includes(String(t.s)) ? String(t.s) : 'pending' }))
      .filter(t => t.t !== '')
      .slice(0, LIMITS.todos),
  }
}

// ------------------------------------------------------------------ dates

const pad = (k: number) => String(k).padStart(2, '0')

export const dayKey = (ms: number): string => {
  const d = new Date(Number.isFinite(ms) ? ms : 0)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Whole local days since 1970-01-01 (stable across DST because it counts calendar days). */
export const dayNumber = (ms: number): number => {
  const d = new Date(Number.isFinite(ms) ? ms : 0)

  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

/** ISO week key such as 2026-W48. */
export const weekKey = (ms: number): string => {
  const d = new Date(Number.isFinite(ms) ? ms : 0)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dow)
  const y = t.getUTCFullYear()
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7)

  return `${y}-W${pad(week)}`
}

// ------------------------------------------------------------------ generic checklists

export const toggleAt = (items: readonly CheckItem[], i: number): CheckItem[] => items.map((it, k) => (k === i ? { ...it, done: !it.done } : it))
export const removeAt = <T,>(items: readonly T[], i: number): T[] => items.filter((_, k) => k !== i)
export const addItem = (items: readonly CheckItem[], text: string, max: number = LIMITS.items): CheckItem[] => {
  const t = clip(text, 120)

  return t === '' || items.length >= max ? [...items] : [...items, { t, done: false }]
}

export const defaultPr = (): CheckItem[] =>
  [
    'Title says what changed and why',
    'Description links the issue and explains the approach',
    'Tests added or updated, and they pass',
    'Lint and type-check pass',
    'Docs and changelog updated if behaviour changed',
    'No secrets, debug code or stray files in the diff',
    'Screenshots or notes for any visible change',
    'Reviewed my own diff once before asking others',
  ].map(t => ({ t, done: false }))

export const checkLines = (title: string, items: readonly CheckItem[], hint: string): Line[] => {
  const done = items.filter(i => i.done).length
  const out: Line[] = [note(`${title}: ${done}/${items.length} done`, done === items.length && items.length > 0 ? 'success' : 'suggestion')]
  items.forEach((it, i) => out.push(note(`${String(i + 1).padStart(2)}. [${it.done ? 'x' : ' '}] ${it.t}`, it.done ? 'inactive' : undefined)))
  out.push(note(hint, 'inactive'))

  return out
}

// ------------------------------------------------------------------ 288 learning path

export const pathLines = (topics: readonly Topic[]): Line[] => {
  if (topics.length === 0) {
    return [note('No learning topics yet.', 'warning'), note('/aepath add <topic>   then   /aepath step <topic number> <step>', 'inactive')]
  }
  const out: Line[] = []
  topics.forEach((t, i) => {
    const done = t.steps.filter(s => s.done).length
    out.push(note(`${i + 1}. ${t.title}  ${done}/${t.steps.length} steps`, t.steps.length > 0 && done === t.steps.length ? 'success' : 'suggestion'))
    t.steps.forEach((s, k) => out.push(note(`   ${i + 1}.${k + 1} [${s.done ? 'x' : ' '}] ${s.t}`, s.done ? 'inactive' : undefined)))
  })
  out.push(note('Tick with /aepath tick <n.m>. Edit with add, step, del, delstep.', 'inactive'))

  return out
}

// ------------------------------------------------------------------ 289 flashcards (Leitner)

/** Days until the next review, by box 1 to 5. */
export const INTERVALS: readonly number[] = [0, 1, 2, 4, 8, 16]

export const dueCards = (cards: readonly Card[], today: number): Card[] =>
  cards.filter(c => c.due <= today).sort((a, b) => a.due - b.due || a.seen - b.seen || a.id - b.id)

/** Good moves the card up a box and schedules it later; Again sends it back to box 1, due today but behind the others. */
export const gradeCard = (d: Data, id: number, isGood: boolean, today: number): Data => {
  const seq = d.seq + 1

  return {
    ...d,
    seq,
    cards: d.cards.map(c => {
      if (c.id !== id) return c
      const box = isGood ? Math.min(5, c.box + 1) : 1

      return { ...c, box, due: isGood ? today + (INTERVALS[box] ?? 16) : today, seen: seq }
    }),
  }
}

export const addCard = (d: Data, front: string, back: string, today: number): Data => {
  const f = clip(front, 200)
  const b = clip(back, 400)

  if (f === '' || b === '' || d.cards.length >= LIMITS.cards) return d

  return { ...d, cards: [...d.cards, { id: d.nextCard, front: f, back: b, box: 1, due: today, seen: 0 }], nextCard: d.nextCard + 1 }
}

export const cardSummary = (d: Data, today: number): Line[] => {
  const due = dueCards(d.cards, today).length
  const boxes = [1, 2, 3, 4, 5].map(b => d.cards.filter(c => c.box === b).length)

  return [
    note(`Flashcards: ${plural(d.cards.length, 'card')}, ${due} due today`, due > 0 ? 'warning' : 'success'),
    note(`Boxes 1 to 5: ${boxes.join(' / ')}  (box 5 is reviewed every 16 days)`, 'inactive'),
  ]
}

// ------------------------------------------------------------------ 290 quiz

const SECRETISH = /\b(?:sk|pk|ghp|gho|ghu|ghs|xox[abprs]|AKIA|AIza)[-_A-Za-z0-9]{10,}\b|\b[A-Za-z0-9+/_=-]{40,}\b/g

/** Masks token-like strings before a prompt is kept. */
export const redact = (s: string): string => s.replace(SECRETISH, '[token]')

export const quizPrompt = (prompts: readonly string[]): string => {
  const recent = prompts.slice(-6).map(p => `- ${clip(redact(p), 120)}`)

  return [
    'Quiz me with three short questions on what we worked on in this session.',
    recent.length > 0 ? `Topics from my recent prompts:\n${recent.join('\n')}` : 'Use the topics we covered so far in this conversation.',
    'Ask one question at a time, wait for my answer, then say whether it was right and why. After the third, list what I should review.',
  ].join('\n\n')
}

// ------------------------------------------------------------------ 291 glossary

const STOP = new Set(
  ('about above after again also because before being between could does doing down during each from have here into just like make more most much need only other over please should some such than that their them then there these they this those through under until using very want what when where which while will with would your yours ' +
    'file files code line lines function functions add fix make run test tests check change changes update create write read show give look using want work works thing things example please thanks').split(' '),
)

/** Candidate terms: identifiers and words repeated across your prompts. A heuristic, not understanding. */
export const suggestTerms = (prompts: readonly string[], existing: readonly Term[], max = 12): { term: string; count: number }[] => {
  const have = new Set(existing.map(t => t.term.toLowerCase()))
  const counts = new Map<string, number>()

  for (const p of prompts) {
    const seenHere = new Set<string>()

    for (const m of redact(p).matchAll(/[A-Za-z][A-Za-z0-9_-]{3,40}/g)) {
      const w = m[0]
      const key = w.toLowerCase()
      const isIdent = /[a-z][A-Z]|_|-[a-z]/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w)

      if (STOP.has(key) || have.has(key) || seenHere.has(key)) continue
      seenHere.add(key)
      counts.set(key, (counts.get(key) ?? 0) + (isIdent ? 2 : 1))
    }
  }

  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([term, count]) => ({ term, count }))
}

export const wordLines = (words: readonly Term[]): Line[] => {
  if (words.length === 0) return [note('The glossary is empty.', 'warning'), note('/aeword add <term> = <definition>   or   /aeword suggest', 'inactive')]
  const sorted = words.map((w, i) => ({ w, i })).sort((a, b) => a.w.term.localeCompare(b.w.term))

  return [note(`Glossary: ${plural(words.length, 'term')}`, 'suggestion'), ...sorted.map(({ w, i }) => note(`${String(i + 1).padStart(3)}. ${w.term}: ${w.def === '' ? '(no definition yet)' : w.def}`))]
}

// ------------------------------------------------------------------ 292 architecture tree

export const archOrderIds = (nodes: readonly ArchNode[]): { node: ArchNode; depth: number }[] => {
  const out: { node: ArchNode; depth: number }[] = []
  const walk = (parent: number, depth: number, guard: Set<number>) => {
    for (const k of nodes.filter(x => x.parent === parent).sort((a, b) => a.id - b.id)) {
      if (guard.has(k.id) || depth > 8) continue
      guard.add(k.id)
      out.push({ node: k, depth })
      walk(k.id, depth + 1, guard)
    }
  }
  walk(0, 0, new Set())

  return out
}

/** Add under the node numbered `parentN` (its position in the list, 1 based) or at the top when 0. */
export const addArch = (d: Data, parentN: number, name: string, noteText: string): Data | string => {
  const order = archOrderIds(d.arch)
  const parent = parentN === 0 ? 0 : order[parentN - 1]?.node.id

  if (parent === undefined) return `There is no component ${parentN}.`
  const n = clip(name, 40)

  if (n === '') return 'Give the component a name.'

  if (d.arch.length >= LIMITS.arch) return `At most ${LIMITS.arch} components.`

  if (parent !== 0 && (order[parentN - 1]?.depth ?? 0) >= 5) return 'Components nest at most six levels deep.'

  return { ...d, arch: [...d.arch, { id: d.nextArch, parent, name: n, note: clip(noteText, 60) }], nextArch: d.nextArch + 1 }
}

export const removeArch = (d: Data, n: number): Data | string => {
  const target = archOrderIds(d.arch)[n - 1]?.node

  if (target === undefined) return `There is no component ${n}.`
  const gone = new Set<number>([target.id])
  let grew = true

  while (grew) {
    grew = false

    for (const a of d.arch) {
      if (!gone.has(a.id) && gone.has(a.parent)) {
        gone.add(a.id)
        grew = true
      }
    }
  }

  return { ...d, arch: d.arch.filter(a => !gone.has(a.id)) }
}

export const archLines = (nodes: readonly ArchNode[]): Line[] => {
  const order = archOrderIds(nodes)

  if (order.length === 0) return [note('No components yet.', 'warning'), note('/aearch add <name> | <note>   or   /aearch add <parent number> <name> | <note>', 'inactive')]

  return [
    note(`Architecture: ${plural(order.length, 'component')}`, 'suggestion'),
    ...order.map(({ node, depth }, i) => note(`${String(i + 1).padStart(2)}. ${'   '.repeat(depth)}${depth > 0 ? '└ ' : ''}${node.name}${node.note !== '' ? `  - ${node.note}` : ''}`)),
  ]
}

// ------------------------------------------------------------------ 293 decisions

export const addDecision = (d: Data, title: string, noteText: string, date: string): Data => {
  const t = clip(title, 100)

  if (t === '') return d
  const next = [...d.decisions, { id: d.nextDecision, date, title: t, status: 'proposed', note: clip(noteText, 200) }].slice(-LIMITS.decisions)

  return { ...d, decisions: next, nextDecision: d.nextDecision + 1 }
}

export const decisionLines = (list: readonly Decision[]): Line[] => {
  if (list.length === 0) return [note('No decisions logged.', 'warning'), note('/aedecide add <title> | <note>', 'inactive')]
  const tone = (s: string): Line['c'] => (s === 'accepted' ? 'success' : s === 'rejected' ? 'error' : s === 'superseded' ? 'inactive' : 'warning')
  const out: Line[] = [note(`Decision log: ${plural(list.length, 'decision')}`, 'suggestion')]

  list.forEach((x, i) => {
    out.push(note(`${String(i + 1).padStart(3)}. ${x.date}  [${x.status}]  ${x.title}`, tone(x.status)))

    if (x.note !== '') out.push(note(`       ${x.note}`, 'inactive'))
  })
  out.push(note('/aedecide set <n> proposed|accepted|rejected|superseded   /aedecide del <n>', 'inactive'))

  return out
}

// ------------------------------------------------------------------ 294 retro notes

export const emptyRetro = (): Retro => ({ well: [], improve: [], actions: [] })

export const retroLines = (key: string, r: Retro | undefined): Line[] => {
  const x = r ?? emptyRetro()
  const out: Line[] = [note(`Retro ${key}`, 'suggestion'), note('Went well', 'success')]
  x.well.forEach((t, i) => out.push(note(`  ${i + 1}. ${t}`)))

  if (x.well.length === 0) out.push(note('  (nothing yet)', 'inactive'))
  out.push(note('To improve', 'warning'))
  x.improve.forEach((t, i) => out.push(note(`  ${i + 1}. ${t}`)))

  if (x.improve.length === 0) out.push(note('  (nothing yet)', 'inactive'))
  out.push(note(`Actions ${x.actions.filter(a => a.done).length}/${x.actions.length}`, 'suggestion'))
  x.actions.forEach((a, i) => out.push(note(`  ${i + 1}. [${a.done ? 'x' : ' '}] ${a.t}`, a.done ? 'inactive' : undefined)))

  if (x.actions.length === 0) out.push(note('  (nothing yet)', 'inactive'))
  out.push(note('/aeretro well|improve|action <text>   tick <n>   del well|improve|action <n>   list', 'inactive'))

  return out
}

export const editRetro = (d: Data, key: string, fn: (r: Retro) => Retro): Data => {
  const cur = d.retros[key] ?? emptyRetro()
  const next: Record<string, Retro> = { ...d.retros }
  delete next[key]
  const keys = Object.keys(next).sort().slice(-(LIMITS.weeks - 1))
  const out: Record<string, Retro> = {}

  for (const k of keys) out[k] = next[k] as Retro
  out[key] = fn(cur)

  return { ...d, retros: out }
}
