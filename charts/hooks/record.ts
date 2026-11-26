// Pure helpers for what the mod records and for its small command languages.
// Nothing here touches the engine, so each one is tested on its own.

import type { TodoEv, TodoRec, TodoState } from '../types'

export const CAP = {
  calls: 200,
  prompts: 100,
  turns: 60,
  samples: 60,
  edits: 60,
  marks: 24,
  imports: 40,
  days: 90,
  sprints: 60,
  todos: 60,
  events: 400,
} as const

export const asRecord = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export const fileOf = (input: Record<string, unknown>): string | undefined => {
  const p = input.file_path ?? input.notebook_path ?? input.path

  return typeof p === 'string' && p !== '' ? p : undefined
}

const hostOf = (url: string): string => /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url.slice(0, 20)

/**
 * A short label for a call. Never the whole command: Bash keeps only its first word,
 * files keep their name, so secrets in command lines are not held in the charts.
 */
export const detailOf = (tool: string, input: Record<string, unknown>): string => {
  const file = fileOf(input)

  if (tool === 'Bash') {
    return str(input.command).trim().split(/\s+/)[0]?.slice(0, 16) ?? ''
  }

  if (file !== undefined) {
    return file.split('/').filter(Boolean).pop()?.slice(0, 24) ?? ''
  }

  if (typeof input.pattern === 'string') {
    return input.pattern.replace(/\s+/g, ' ').slice(0, 18)
  }

  if (typeof input.url === 'string') {
    return hostOf(input.url).slice(0, 24)
  }

  return ''
}

export const countLines = (s: string): number => (s === '' ? 0 : s.split('\n').length)

/** A line number carried by a tool input, or by a `cat -n` style result ("  42→text"). */
export const lineOf = (input: Record<string, unknown>, text: string): number | null => {
  for (const k of ['line', 'line_number', 'start_line', 'offset']) {
    const v = input[k]

    if (typeof v === 'number' && Number.isFinite(v) && v >= 1) {
      return Math.floor(v)
    }
  }
  const m = /^\s*(\d{1,7})[→\t]/m.exec(text.slice(0, 3000))

  return m === null ? null : Number(m[1])
}

export type EditInfo = { path: string; added: number; removed: number; lines: number; mark: number | null; src: string }

export const editInfo = (tool: string, input: Record<string, unknown>, text: string): EditInfo => {
  const path = fileOf(input) ?? ''

  if (tool === 'Write') {
    const src = str(input.content)

    return { path, added: countLines(src), removed: 0, lines: countLines(src), mark: null, src }
  }

  if (tool === 'NotebookEdit') {
    const src = str(input.new_source)

    return { path, added: countLines(src), removed: 0, lines: 0, mark: null, src }
  }
  const src = str(input.new_string)

  return { path, added: countLines(src), removed: countLines(str(input.old_string)), lines: 0, mark: lineOf(input, text), src }
}

// ---------------------------------------------------------------- command languages

/** `/chbudget 5`, `/chbudget $2.50`, `/chbudget off`. undefined means the text was not understood. */
export const parseBudget = (args: string): number | null | undefined => {
  const t = args.trim().toLowerCase().replace(/^\$/, '')

  if (t === 'off' || t === 'none' || t === '0') {
    return null
  }
  const n = Number(t)

  return t !== '' && Number.isFinite(n) && n > 0 && n <= 100_000 ? Math.round(n * 100) / 100 : undefined
}

/** `/chsprint 25 write the parser`. */
export const parseSprint = (args: string): { min: number; label: string } | undefined => {
  const m = /^\s*(\d{1,3})\s*(?:m|min|minutes)?\b\s*(.*)$/i.exec(args)

  if (m === null) {
    return undefined
  }
  const min = Number(m[1])

  return min >= 1 && min <= 600 ? { min, label: (m[2] ?? '').trim().slice(0, 60) || 'sprint' } : undefined
}

export type TodoStore = { todos: TodoRec[]; events: TodoEv[] }

export const stateOf = (events: readonly TodoEv[], id: number): TodoState | undefined => {
  let s: TodoState | undefined

  for (const e of events) {
    if (e.id === id) {
      s = e.to
    }
  }

  return s
}

export const pruneTodos = (st: TodoStore): TodoStore => {
  let { todos, events } = st

  if (todos.length > CAP.todos) {
    const drop = new Set(todos.slice(0, todos.length - CAP.todos).map(t => t.id))
    todos = todos.slice(-CAP.todos)
    events = events.filter(e => !drop.has(e.id))
  }

  for (const t of todos) {
    if (events.length <= CAP.events) {
      break
    }
    const s = stateOf(events, t.id)

    if (s === 'done' || s === 'gone') {
      events = events.filter(e => e.id !== t.id)
      todos = todos.filter(x => x.id !== t.id)
    }
  }

  return { todos, events: events.slice(-CAP.events) }
}

const MARK: Record<TodoState, string> = { open: '[ ]', doing: '[~]', done: '[x]', gone: '[-]' }

export const todoList = (st: TodoStore): string => {
  const live = st.todos.filter(t => stateOf(st.events, t.id) !== 'gone')

  return live.length === 0
    ? 'No todos. /chtodo add <text>'
    : live.map(t => `#${t.id} ${MARK[stateOf(st.events, t.id) ?? 'open']} ${t.text}`).join('\n')
}

/** One /chtodo command applied to the list. Returns the reply and the new list. */
export const todoApply = (args: string, st: TodoStore, now: number): { text: string; store: TodoStore } => {
  const m = /^\s*(\w*)\s*(.*)$/s.exec(args)
  const verb = (m?.[1] ?? '').toLowerCase()
  const rest = (m?.[2] ?? '').trim()

  if (verb === '' || verb === 'list') {
    return { text: todoList(st), store: st }
  }

  if (verb === 'add') {
    if (rest === '') {
      return { text: 'Usage: /chtodo add <text>', store: st }
    }
    const id = st.todos.reduce((a, t) => Math.max(a, t.id), 0) + 1
    const next = pruneTodos({
      todos: [...st.todos, { id, text: rest.replace(/\s+/g, ' ').slice(0, 120) }],
      events: [...st.events, { t: now, id, to: 'open' }],
    })

    return { text: `Todo #${id} added.`, store: next }
  }
  const to: TodoState | undefined = verb === 'doing' ? 'doing' : verb === 'done' ? 'done' : verb === 'open' ? 'open' : verb === 'rm' ? 'gone' : undefined

  if (to === undefined) {
    return { text: 'Usage: /chtodo add <text> | doing <n> | done <n> | open <n> | rm <n> | list', store: st }
  }
  const id = Number(rest.replace(/^#/, ''))
  const now0: TodoState | undefined = Number.isInteger(id) ? stateOf(st.events, id) : undefined

  if (now0 === undefined || now0 === 'gone') {
    return { text: `No todo #${rest}. /chtodo list shows the numbers.`, store: st }
  }

  if ((now0 as TodoState) === to) {
    return { text: `#${id} is already ${to === 'gone' ? 'removed' : to}.`, store: st }
  }

  return { text: to === 'gone' ? `#${id} removed.` : `#${id} is now ${to}.`, store: pruneTodos({ todos: st.todos, events: [...st.events, { t: now, id, to }] }) }
}

/** Keeps the newest n day keys. */
export const capDays = <T>(days: Record<string, T>, n: number): Record<string, T> => {
  const out: Record<string, T> = {}

  for (const k of Object.keys(days).sort().slice(-n)) {
    out[k] = days[k] as T
  }

  return out
}
