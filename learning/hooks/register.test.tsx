import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'learning',
  component: 'Pane',
  requestId: 'learning-main',
  surface: 'desktop',
  props: { title: 'Learning', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const NOON = new Date(2026, 10, 25, 12, 30).getTime()

const engine = (on: (...args: any[]) => unknown, seed: Record<string, unknown> = {}) => {
  const store: Record<string, unknown> = { ...seed }
  const rec = { toasts: [] as string[], filled: [] as string[], opened: [] as string[], registered: [] as string[], now: NOON, cwd: '/proj/a' }
  on('clock.now', () => ({ value: rec.now }))
  on('command.register', (_: unknown, e: { name: string }) => {
    rec.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    rec.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    rec.toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    rec.filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('session.cwd', () => ({ value: rec.cwd }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.compose', () => ({ sections: [{ id: 'core', scope: 'shared', text: 'core' }] }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete store[e.key]

    return { value: undefined }
  })

  return { store, rec }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args, origin: 'user' })) as { text: string }).text
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text)

test('every command is registered once with a ln prefix and /ln lists them all', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  const help = await run($, 'ln')

  expect(rec.registered.length).toBeGreaterThanOrEqual(20)
  expect(new Set(rec.registered).size).toBe(rec.registered.length)

  for (const name of rec.registered) {
    expect(name.startsWith('ln')).toBe(true)
    expect(help).toContain(`/${name} `)
  }
})

test('prompt fillers fill the box and never send', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  const msg = await run($, 'lneli5')
  await run($, 'lnwalk', 'src/a.ts')
  await run($, 'lnwhy')
  await run($, 'lnalt')
  await run($, 'lndiagram')
  await run($, 'lnquiz')
  await run($, 'lnpattern')
  await run($, 'lncomplex')
  await run($, 'lndiff')

  expect(msg).toMatch(/press Enter/)
  expect(rec.filled[0]).toBe('Explain your last answer simply, with an everyday analogy.')
  expect(rec.filled[1]).toMatch(/src\/a\.ts/)
  expect(rec.filled.length).toBe(9)
})

test('glossary: add, list, search, remove, and it survives a reload through the store', async ($, on) => {
  const { store } = engine(on)
  await start($)
  expect(await run($, 'lnterm', 'closure = a function plus the scope it was made in')).toMatch(/Saved/)
  await run($, 'lnterm', 'monad = a design pattern')
  expect(await run($, 'lnterm', 'list')).toBe('closure: a function plus the scope it was made in\nmonad: a design pattern')
  expect(await run($, 'lnterm', 'search scope')).toMatch(/closure/)
  expect(await run($, 'lnterm', 'search zzz')).toMatch(/No terms match/)
  expect(await run($, 'lnterm', 'rm monad')).toMatch(/Removed/)
  expect((store['learning-glossary'] as unknown[]).length).toBe(1)
})

test('the project glossary is keyed by the folder', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  await run($, 'lnpterm', 'api = the public surface')
  rec.cwd = '/proj/b'
  expect(await run($, 'lnpterm', 'list')).toMatch(/No terms yet/)
  rec.cwd = '/proj/a'
  expect(await run($, 'lnpterm', 'list')).toBe('api: the public surface')
  expect(await run($, 'lnterm', 'list')).toMatch(/No terms yet/)
})

test('flashcards: add, review with the buttons, spaced repetition and persistence', async ($, on) => {
  const { store, rec } = engine(on)
  await start($)
  await run($, 'lncard', 'What is a closure? | A function with its scope')
  await run($, 'lncard', 'What is O(1)? | Constant time')
  expect(await run($, 'lncard', 'list')).toMatch(/2 cards, 2 due/)

  const msg = await run($, 'lnreview')
  expect(msg).toMatch(/2 card\(s\) due/)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /What is a closure\?/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'review-knew' })).toBeUndefined()

  await ui.press({ key: 'review-show' })
  expect(await ui.find({ type: 'Text', text: /A function with its scope/ })).toBeDefined()
  await ui.press({ key: 'review-knew' })

  // The graded card left the due list; the next one is up and its answer is hidden again.
  expect(await ui.find({ type: 'Text', text: /What is O\(1\)\?/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Constant time/ })).toBeUndefined()
  await ui.press({ key: 'review-show' })
  await ui.press({ key: 'review-again' })

  const saved = store['learning-cards'] as { q: string; box: number; due: number }[]
  const closure = saved.find(c => /closure/.test(c.q))
  const big = saved.find(c => /O\(1\)/.test(c.q))
  expect(closure?.box).toBe(1)
  expect(closure?.due).toBe(NOON + 86_400_000)
  expect(big?.box).toBe(0)
  expect(big?.due).toBe(NOON + 5 * 60_000)

  expect(await ui.find({ type: 'Text', text: /All caught up/ })).toBeDefined()
  await ui.unmount()
  expect(rec.opened).toContain('learning-main')

  expect(await run($, 'lnreview')).toMatch(/Nothing due/)
  rec.now = NOON + 6 * 60_000
  expect(await run($, 'lnreview')).toMatch(/1 card\(s\) due/)
  expect(await run($, 'lncard', 'rm 1')).toMatch(/Removed/)
})

test('the daily nudge shows one toast a day when cards are due, and /lnnudge off silences it', async ($, on) => {
  const day = 86_400_000
  const seed = {
    'learning-cards': [{ id: 'c1', q: 'q', a: 'a', box: 1, due: NOON - 1000, seen: 1, at: 0 }],
  }
  const { rec, store } = engine(on, seed)
  await start($)
  expect(rec.toasts.length).toBe(1)
  expect(rec.toasts[0]).toMatch(/1 flashcard due/)
  await $.turn.complete({ reason: 'answer', answer: 'hi' } as any)
  expect(rec.toasts.length).toBe(1)
  expect(store['learning-nudgeDay']).toBe('2026-11-25')

  rec.now = NOON + day
  await start($)
  expect(rec.toasts.length).toBe(2)

  await run($, 'lnnudge', 'off')
  rec.now = NOON + 2 * day
  await start($)
  expect(rec.toasts.length).toBe(2)
})

test('reading list and learning log', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'lnread', 'Rust book https://doc.rust-lang.org/book #rust')).toMatch(/#rust/)
  await run($, 'lnread', 'Tour of Go https://go.dev/tour #go')
  expect(await run($, 'lnread', 'no url')).toMatch(/Usage/)
  expect(await run($, 'lnread', 'list rust')).toBe('#rust\n1. [ ] Rust book https://doc.rust-lang.org/book')
  expect(await run($, 'lnread', 'done 1')).toMatch(/read/)
  expect(await run($, 'lnread', 'list')).toMatch(/\[x\] Rust book/)

  await run($, 'lnlearned', 'closures capture variables by reference')
  expect(await run($, 'lnlearned')).toBe('2026-11-25 12:30  closures capture variables by reference')

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props } })
  await ui.press({ key: 'tab-Log' })
  expect(await ui.find({ type: 'Text', text: /closures capture/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2026-11-25$/i })).toBeDefined()
  await ui.press({ key: 'tab-Reading' })
  expect(await ui.find({ type: 'Text', text: /Tour of Go/ })).toBeDefined()
  await ui.unmount()
})

test('architecture map grows by command and prints as a tree', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  await run($, 'lnarch', 'add src/app main program')
  await run($, 'lnarch', 'add src/lib shared helpers')
  const tree = await run($, 'lnarch')
  expect(tree).toBe('└── src/\n    ├── app  - main program\n    └── lib  - shared helpers')
  expect(rec.opened).toContain('learning-main')
  expect(await run($, 'lnarch', 'suggest')).toMatch(/Prompt is in the box/)
  expect(rec.filled[0]).toMatch(/\/lnarch add <path>/)
  await run($, 'lnarch', 'rm src/lib')
  expect(await run($, 'lnarch')).toBe('└── src/\n    └── app  - main program')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-Arch' })
  expect(await ui.find({ type: 'Text', text: /app {2}- main program/ })).toBeDefined()
  await ui.unmount()
})

test('the skill tracker counts tools and file types, and the pane draws bars', async ($, on) => {
  const { store } = engine(on)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/a/x.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/a/y.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Read', file_path: '/a/z.py' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const week = (store['learning-skills'] as Record<string, any>)['2026-11-23']
  expect(week.tools).toEqual({ Edit: 2, Read: 1, Bash: 1 })
  expect(week.ext).toEqual({ '.ts': 2, '.py': 1 })
  expect(await run($, 'lnskills')).toMatch(/4 tool calls/)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-Skills' })
  expect(await ui.find({ type: 'Text', text: /^██████████████$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\.ts/ })).toBeDefined()
  await ui.unmount()
})

test('mentor, duck and beginner modes are off by default and add a section only when on', async ($, on) => {
  engine(on)
  await start($)
  const ids = async () => ((await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] } as any)) as unknown as { sections: { id: string }[] }).sections.map(s => s.id)
  expect(await ids()).toEqual(['core'])

  expect(await run($, 'lnmentor')).toMatch(/off/)
  await run($, 'lnmentor', 'on')
  await run($, 'lnduck', 'on')
  await run($, 'lnbeginner', 'on')
  await run($, 'lneli5', 'on')
  expect(await ids()).toEqual(['core', 'learning:mentor', 'learning:duck', 'learning:beginner', 'learning:eli5'])

  await run($, 'lnmentor', 'off')
  expect(await ids()).toEqual(['core', 'learning:duck', 'learning:beginner', 'learning:eli5'])
})

test('/lnreset asks first, then clears recorded data but keeps the switches', async ($, on) => {
  const { store } = engine(on)
  await start($)
  await run($, 'lnterm', 'a = b')
  await run($, 'lncard', 'q | a')
  await run($, 'lnduck', 'on')

  expect(await run($, 'lnreset')).toMatch(/\/lnreset yes/)
  expect((store['learning-glossary'] as unknown[]).length).toBe(1)
  expect(await run($, 'lnreset', 'yes')).toMatch(/cleared/)
  expect(store['learning-glossary']).toBeUndefined()
  expect(store['learning-cards']).toBeUndefined()
  expect((store['learning-flags'] as { duck: boolean }).duck).toBe(true)
  expect(await run($, 'lnterm', 'list')).toMatch(/No terms yet/)
})

test('data saved by an earlier version or garbage in the store is declined, not crashed on', async ($, on) => {
  engine(on, { 'learning-cards': 'oops', 'learning-glossary': { not: 'a list' }, 'learning-flags': 5 })
  await start($)
  expect(await run($, 'lncard', 'list')).toMatch(/No cards yet/)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /No terms yet/ })).toBeDefined()
  await ui.unmount()
})
