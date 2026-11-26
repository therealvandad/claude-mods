import { expect, test } from 'claude-code/testing'

import {
  CAP,
  capDays,
  countLines,
  detailOf,
  editInfo,
  fileOf,
  lineOf,
  parseBudget,
  parseSprint,
  pruneTodos,
  stateOf,
  todoApply,
  todoList,
} from './record'
import type { TodoStore } from './record'

test('a Bash call keeps only its first word, never the whole command line', () => {
  expect(detailOf('Bash', { command: 'curl -H "Authorization: Bearer sk-secret" https://x' })).toBe('curl')
  expect(detailOf('Edit', { file_path: '/a/b/c.ts' })).toBe('c.ts')
  expect(detailOf('Grep', { pattern: 'a   b' })).toBe('a b')
  expect(detailOf('WebFetch', { url: 'https://example.com/x?token=1' })).toBe('example.com')
  expect(detailOf('Other', {})).toBe('')
  expect(fileOf({ notebook_path: '/n.ipynb' })).toBe('/n.ipynb')
  expect(fileOf({ file_path: '' })).toBeUndefined()
})

test('line numbers come from tool inputs or from a numbered result, else nothing', () => {
  expect(lineOf({ line: 12.7 }, '')).toBe(12)
  expect(lineOf({ offset: 0 }, '')).toBeNull()
  expect(lineOf({}, 'The file has been updated:\n   42→  const x = 1')).toBe(42)
  expect(lineOf({}, 'ok')).toBeNull()
})

test('edit info reads sizes from Edit, Write and NotebookEdit inputs', () => {
  expect(editInfo('Edit', { file_path: '/a.ts', old_string: 'a\nb', new_string: 'x\ny\nz' }, '  7→x')).toEqual({ path: '/a.ts', added: 3, removed: 2, lines: 0, mark: 7, src: 'x\ny\nz' })
  expect(editInfo('Write', { file_path: '/a.ts', content: 'a\nb\nc' }, '  7→x')).toEqual({ path: '/a.ts', added: 3, removed: 0, lines: 3, mark: null, src: 'a\nb\nc' })
  expect(editInfo('NotebookEdit', { notebook_path: '/n.ipynb', new_source: 'print(1)' }, '').added).toBe(1)
  expect(countLines('')).toBe(0)
})

test('/chbudget understands dollars, off and rubbish', () => {
  expect(parseBudget('5')).toBe(5)
  expect(parseBudget('$2.505')).toBe(2.51)
  expect(parseBudget('off')).toBeNull()
  expect(parseBudget('0')).toBeNull()
  expect(parseBudget('lots')).toBeUndefined()
  expect(parseBudget('-3')).toBeUndefined()
  expect(parseBudget('')).toBeUndefined()
})

test('/chsprint needs minutes first and keeps a short label', () => {
  expect(parseSprint('25 write the parser')).toEqual({ min: 25, label: 'write the parser' })
  expect(parseSprint('45m')).toEqual({ min: 45, label: 'sprint' })
  expect(parseSprint('90 min deep work')).toEqual({ min: 90, label: 'deep work' })
  expect(parseSprint('write 25')).toBeUndefined()
  expect(parseSprint('0 nothing')).toBeUndefined()
  expect(parseSprint('9999 nope')).toBeUndefined()
  expect(parseSprint('5 ' + 'x'.repeat(100))?.label.length).toBe(60)
})

const EMPTY: TodoStore = { todos: [], events: [] }

test('/chtodo adds, moves through doing and done, removes, and lists', () => {
  let st = EMPTY
  const run = (args: string, now = 1000) => {
    const r = todoApply(args, st, now)
    st = r.store

    return r.text
  }
  expect(run('add write the tests', 1)).toBe('Todo #1 added.')
  expect(run('add   ship it ', 2)).toBe('Todo #2 added.')
  expect(run('doing 1', 3)).toBe('#1 is now doing.')
  expect(run('doing 1')).toBe('#1 is already doing.')
  expect(run('done #1', 4)).toBe('#1 is now done.')
  expect(run('rm 2', 5)).toBe('#2 removed.')
  expect(run('done 2')).toMatch(/No todo #2/)
  expect(run('done 9')).toMatch(/No todo #9/)
  expect(run('open 1', 6)).toBe('#1 is now open.')
  expect(run('list')).toBe('#1 [ ] write the tests')
  expect(stateOf(st.events, 1)).toBe('open')
  expect(stateOf(st.events, 2)).toBe('gone')
  expect(st.events.map(e => [e.id, e.to, e.t])).toEqual([[1, 'open', 1], [2, 'open', 2], [1, 'doing', 3], [1, 'done', 4], [2, 'gone', 5], [1, 'open', 6]])
  expect(run('add')).toMatch(/Usage/)
  expect(run('whatever')).toMatch(/Usage/)
  expect(run('')).toBe('#1 [ ] write the tests')
  expect(todoList(EMPTY)).toMatch(/No todos/)
})

test('the todo list and its history are capped, finished items go first', () => {
  let st: TodoStore = EMPTY

  for (let i = 0; i < CAP.todos + 20; i += 1) {
    st = todoApply(`add item ${i}`, st, i).store
  }
  expect(st.todos.length).toBe(CAP.todos)
  expect(st.todos[0]?.text).toBe('item 20')
  expect(st.events.every(e => st.todos.some(t => t.id === e.id))).toBe(true)

  // many state changes on a few items: the history stays under its cap and finished items are dropped first
  let busy: TodoStore = todoApply('add keep', EMPTY, 0).store
  busy = todoApply('add other', busy, 0).store

  for (let i = 0; i < 300; i += 1) {
    busy = todoApply(i % 2 === 0 ? 'doing 1' : 'open 1', busy, i + 1).store
  }
  busy = todoApply('done 2', busy, 400).store

  for (let i = 0; i < 300; i += 1) {
    busy = todoApply(i % 2 === 0 ? 'doing 1' : 'open 1', busy, 500 + i).store
  }
  expect(busy.events.length).toBeLessThanOrEqual(CAP.events)
  expect(pruneTodos(busy).events.length).toBeLessThanOrEqual(CAP.events)
  expect(stateOf(busy.events, 1)).toBeDefined()
  expect(busy.todos.some(t => t.id === 2)).toBe(false)
})

test('daily counters keep the newest days only', () => {
  const days: Record<string, number> = {}

  for (let i = 1; i <= 100; i += 1) {
    days[`2026-01-${String(i).padStart(3, '0')}`] = i
  }
  const kept = capDays(days, 90)
  expect(Object.keys(kept).length).toBe(90)
  expect(kept['2026-01-100']).toBe(100)
  expect(kept['2026-01-001']).toBeUndefined()
})
