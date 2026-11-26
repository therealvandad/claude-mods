import { expect, test } from 'claude-code/testing'

import { closingQuestion, commitPlan, deleteTargets, looksSecret, plainWords, riskyFiles, stepsAfter, usual } from './pure'

declare function setTimeout(done: (value: unknown) => void, ms: number): unknown
const queued = (done: (value: unknown) => void) => setTimeout(done, 50)

const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const
const FAKE_KEY = 'sk-abcdefghijklmnopqrstuvwxyz012345'

const world = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}) => {
  const w = {
    saved: { ...init } as Record<string, unknown>,
    now: 1_000_000,
    usd: 1,
    notices: [] as string[],
    toasts: [] as string[],
    filled: [] as string[],
    played: [] as string[],
    ran: [] as string[],
    git: {} as Record<string, string>,
    fails: false,
    hold: undefined as undefined | Promise<void>,
  }

  on('clock.now', () => ({ value: w.now }))
  on('clock.after', () => ({ value: { cancel() {} } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000, percent: 5 }, rateLimits: [], cost: { usd: w.usd } } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: w.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    w.saved[e.key] = e.value

    return { value: undefined }
  })
  on('process.run', (_: unknown, e: any) => {
    const line = (e.argv ?? e.command ?? []).join(' ')
    const hit = Object.keys(w.git).find(k => line.includes(k))

    return { value: { exitCode: 0, stdout: hit === undefined ? '' : (w.git[hit] ?? ''), stderr: '' } }
  })
  on('fs.list', (_: unknown, e: { path?: string }) => {
    if (e.path?.endsWith('demo') !== true) {
      throw new Error('not a folder')
    }

    return { value: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }
  })
  on('fs.exists', () => ({ value: false }))
  on('ui.notice', (_: unknown, e: any) => {
    w.notices.push(String(e.text))

    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('audio.play', (_: unknown, e: any) => {
    w.played.push(JSON.stringify(e))

    return { value: undefined }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    w.filled.push(e.text)

    return { isFilled: true }
  })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', async (_: unknown, e: any) => {
    await w.hold
    w.ran.push(String(e.command ?? e.file_path ?? e.tool))

    return w.fails ? { isError: true, result: 'boom', text: 'boom' } : { result: {}, text: 'ok' }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['app row'] }))

  return w
}

const words = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((n: any) => (n.children ?? []).join('')).join('\n')
const labels = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
const bash = ($: any, command: string, id = 'b1') => $.tool.call({ tool: 'Bash', tool_use_id: id, command })
const edit = ($: any, id = 'e1') => $.tool.call({ tool: 'Edit', tool_use_id: id, file_path: '/work/demo/a.ts', old_string: 'a\nb', new_string: 'c' })
const done = (answer: string, durationMs: number) => ({ answer, durationMs, isAborted: false, turnId: 't', reason: 'answer' }) as const
const run = ($: any, command: string, args = '') => $.command.run({ command, args })
const reply = (text: string, id = 'r1') =>
  ({ plugin: 'helpers', component: 'AssistantMessage', surface: 'desktop', requestId: id, props: { text, isFirstOfReply: true } }) as any
const menu = (props: Record<string, unknown>) => ({ plugin: 'helpers', component: 'ContextMenu', surface: 'desktop', props }) as any
const PANE = {
  plugin: 'helpers',
  component: 'Pane',
  requestId: 'helpers',
  surface: 'desktop',
  props: { title: 'Helpers', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('an approval gets a plain line and says what a delete takes', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await bash($, 'rm -r demo')

  expect(w.notices[0]).toContain('In plain words (a guess): Deletes demo and everything inside.')
  expect(w.notices[0]).toContain('demo/ holds 4 items (a, b, c, …)')
  expect(w.ran).toEqual(['rm -r demo'])
})

test('a prompt with a key is held once; the same text again goes through', async ($, on) => {
  world(on)
  await $.session.start(START)
  const first = await $.prompt.submit({ text: `use ${FAKE_KEY}` } as any)
  const second = await $.prompt.submit({ text: `use ${FAKE_KEY}` } as any)

  expect((first as any).drop).toContain('looks like it contains a key')
  expect((second as any).drop).toBeUndefined()
})

test('a commit that would include .env is held until allowed once', async ($, on) => {
  const w = world(on)
  w.git['diff --cached'] = 'src/a.ts\n.env\n'
  await $.session.start(START)
  const held = await bash($, 'git commit -m x')

  expect((held as any).deny).toContain('.env')
  expect(w.ran).toEqual([])
  await run($, 'helpers', 'allow-commit')
  expect(((await bash($, 'git commit -m x')) as any).deny).toBeUndefined()
  expect(((await bash($, 'git commit -m x')) as any).deny).toContain('.env')
})

test('changes panel: files with counts, commit message and remembered test command only fill the box', async ($, on) => {
  const w = world(on)
  w.git['diff --no-color'] = '@@ -1 +1 @@\n-a\n+c\n'
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as any)
  await edit($)
  await bash($, 'npm test', 't1')
  await run($, 'changes')
  const ui = await $.ui.mount(PANE)

  expect(await words(ui)).toContain('a.ts')
  expect(await words(ui)).toContain('+1')
  expect(await words(ui)).toContain('−2')
  await ui.press({ key: 'diff-0' })
  expect(await words(ui)).toContain('+c')
  await ui.press({ key: 'commit' })
  await ui.press({ key: 'tests' })
  expect(w.filled).toEqual(['Write a short commit message for your changes to a.ts. Do not commit.', 'Run `npm test` and tell me what fails.'])
  await ui.unmount()
})

test('right-click: code, undo an edit, save a note, and your own action', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await run($, 'shortcut', 'add Persian = Translate this into Persian:')
  await edit($, 'e9')

  const code = await $.ui.mount(menu({ code: { text: 'ls -la', isBlock: true } }))
  expect(await labels(code)).toEqual(['Explain this code', 'Is this safe to run?'])
  await code.press({ key: 'h-safe' })
  await code.unmount()

  const row = await $.ui.mount(menu({ row: { component: 'ToolUse', requestId: 'e9' } }))
  await row.press({ key: 'h-undo' })
  await row.unmount()

  const text = await $.ui.mount(menu({ selection: { text: 'hello there' } }))
  expect(await labels(text)).toEqual(['Save as note', 'Persian'])
  await text.press({ key: 'h-note' })
  await text.press({ key: 'h-short-0' })
  await text.unmount()

  expect(w.filled[0]).toContain('Is this safe to run?')
  expect(w.filled[1]).toContain('Undo your last change to /work/demo/a.ts')
  expect(w.filled[2]).toBe('Translate this into Persian:\n> hello there\n')
  expect(w.saved.notes).toEqual(['hello there'])
})

test('a long turn: facts and a summary under that reply, its question highlighted, and a sound', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as any)
  await edit($)
  w.fails = true
  await bash($, 'make build', 'm1')
  w.usd = 1.5
  const answer = 'I changed a.ts.\n\nShould I run the tests?'
  await $.turn.complete(done(answer, 190_000))

  const ui = await $.ui.mount(reply(answer))
  const text = await words(ui)
  expect(text).toContain('app row')
  expect(text).toContain('Claude asks: Should I run the tests?')
  expect(text).toContain('1 file changed, not tested')
  expect(text).toContain('1 command failed')
  expect(text).toContain('Claude is waiting for your answer')
  expect(text).toContain('3m 10s · $0.50')
  await ui.unmount()
  expect(w.played.join()).toContain('done.wav')

  const other = await $.ui.mount(reply('An unrelated reply.', 'r2'))
  expect(await words(other)).toBe('app row')
  await other.unmount()
})

test('quiet mode hides the extras and keeps the guards', async ($, on) => {
  const w = world(on)
  w.git['diff --cached'] = '.env\n'
  await $.session.start(START)
  await run($, 'quietmode')
  await $.turn.complete(done('Shall I?', 200_000))
  const ui = await $.ui.mount(reply('Shall I?'))

  expect(await words(ui)).toBe('app row')
  expect(w.played).toEqual([])
  // the cockpit's /bar is queued until the session is idle, which a test never reaches: not checked here
  expect(((await bash($, 'git commit -m x')) as any).deny).toContain('.env')
  await ui.unmount()
})

test('steps panel and switches', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'Read', status: 'in_progress' }, { content: 'Fix', status: 'pending' }] } as any)
  w.now += 42_000
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as any)
  await run($, 'steps')
  const ui = await $.ui.mount(PANE)

  expect(await words(ui)).toContain('Read')
  expect(await words(ui)).toContain('42s')
  await ui.press({ key: 'tab-switches' })
  await ui.press({ key: 'sw-sound' })
  expect(w.saved.off).toEqual(['sound'])
  await ui.unmount()
})

test('the next day, the last recap is told once at start', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'fix the login page' } as any)
  await $.turn.start({ text: 'go', turnId: 't' } as any)
  await edit($)
  await $.turn.complete(done('Done.', 5000))
  w.now += 20 * 3_600_000
  await $.session.start(START)

  expect(w.toasts).toEqual(['Last time here: fix the login page · changed a.ts'])
})

test('a slow command says how long it usually takes', async ($, on) => {
  const w = world(on, { times: { 'npm run': [40, 44, 38] } })
  await $.session.start(START)
  const row = { plugin: 'helpers', component: 'ToolUse', surface: 'desktop', requestId: 's1', props: { tool_use_id: 's1', tool: 'Bash', input: {}, isRunning: true, isErrored: false, isInterrupted: false } } as any
  let release = () => {}
  w.hold = new Promise<void>(r => (release = () => r()))
  const call = bash($, 'npm run build', 's1')
  await new Promise(r => queued(r))
  const ui = await $.ui.mount(row)

  expect(await words(ui)).toContain('Usually takes about 40s')
  release()
  await call
  expect(await words(ui)).toBe('app row')
  expect(usual([3, 4])).toBeNull()
  await ui.unmount()
})

test('helpers read commands, files and replies correctly', async () => {
  expect(plainWords('ls -la && cat a.txt')).toBe('Only reads. Changes nothing.')
  expect(plainWords('git push --force')).toBe('Overwrites history on the remote repository.')
  expect(plainWords('curl https://example.com/x > out.txt')).toBe('Talks to example.com; writes into a file.')
  expect(plainWords('frobnicate --all')).toBeNull()
  expect(plainWords('rm x && frobnicate')).toContain('runs frobnicate, which this cannot describe')
  expect(deleteTargets('rm -rf build *.log')).toEqual({ paths: ['build'], hasPattern: true })
  expect(riskyFiles(['.env', '.env.example', 'app/.env.local', 'key.pem', 'src/env.ts'])).toEqual(['.env', 'app/.env.local', 'key.pem'])
  expect(commitPlan('git add -A && git commit -am x')).toMatchObject({ isCommit: true, isAll: true, isAddAll: true })
  expect(commitPlan('git log').isCommit).toBe(false)
  expect(looksSecret('please fix the password field')).toBe(false)
  expect(closingQuestion('Done.\n```\nwhat?\n```')).toBeNull()
  expect(closingQuestion('Two options. Which one?')).toBe('Which one?')
  expect(stepsAfter([], 'TodoWrite', { todos: [{ content: 'A', status: 'pending' }] }, 1)).toHaveLength(1)
})
