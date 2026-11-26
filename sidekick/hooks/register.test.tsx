import { expect, test } from 'claude-code/testing'

import { addCommand, addToDay, bigFileWarning, isSensitive, looseEnds, parseServers, unbackedClaims } from './pure'

const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const

const world = (on: (...args: any[]) => unknown, init: Record<string, unknown> = {}) => {
  const w = {
    saved: { ...init } as Record<string, unknown>,
    files: {} as Record<string, string>,
    next: {} as Record<string, string>,
    filled: [] as string[],
    toasts: [] as string[],
    spoken: [] as string[],
    box: '',
    percent: 10,
    limits: [] as { kind: string; percentUsed: number }[],
    fails: false,
  }

  on('clock.now', () => ({ value: Date.parse('2026-01-02T10:00:00Z') }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000, percent: w.percent }, rateLimits: w.limits, cost: { usd: 0 } } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: w.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    w.saved[e.key] = e.value

    return { value: undefined }
  })
  on('fs.read', (_: unknown, e: { path: string }) => {
    const found = Object.keys(w.files).find(k => e.path.endsWith(k))

    if (found === undefined) {
      throw new Error('missing')
    }

    return { value: w.files[found] }
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    const found = Object.keys(w.files).find(k => e.path.endsWith(k)) ?? e.path
    w.files[found] = e.text

    return { value: undefined }
  })
  on('process.run', (_: unknown, e: any) => {
    const line = (e.argv ?? e.command ?? []).join(' ')

    return {
      value: {
        exitCode: 0,
        stdout: line.includes('rev-parse') ? 'main\n' : line.includes('lsof') ? 'COMMAND PID U FD TYPE D S NODE NAME\nnode 12 me 3u IPv4 x 0t0 TCP *:3000 (LISTEN)\n' : '',
        stderr: '',
      },
    }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('audio.speak', (_: unknown, e: any) => {
    w.spoken.push(JSON.stringify(e))

    return { value: {} }
  })
  on('prompt.read', () => ({ value: { text: w.box, cursor: 0 } }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    w.filled.push(e.text)

    return { isFilled: true }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' }] }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_: unknown, e: any) => {
    const path = String(e.file_path ?? '')
    const name = Object.keys(w.next).find(k => path.endsWith(k))

    if (name !== undefined) {
      w.files[name] = w.next[name] ?? ''
    }

    return w.fails ? { isError: true, result: 'boom', text: 'Error: boom' } : { result: {}, text: 'ok' }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['app row'] }))

  return w
}

const words = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((n: any) => (n.children ?? []).join('')).join('\n')
const labels = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
const done = (answer: string, durationMs = 5000) => ({ answer, durationMs, isAborted: false, turnId: 't', reason: 'answer' }) as const
const turn = ($: any) => $.turn.start({ text: 'go', turnId: 't' })
const run = ($: any, command: string, args = '') => $.command.run({ command, args })
const edit = ($: any, file: string, id = 'e1') => $.tool.call({ tool: 'Edit', tool_use_id: id, file_path: `/work/demo/${file}`, old_string: 'a', new_string: 'b' })
const reply = (text: string, id = 'r1') =>
  ({ plugin: 'sidekick', component: 'AssistantMessage', surface: 'desktop', requestId: id, props: { text, isFirstOfReply: true } }) as any
const menu = (props: Record<string, unknown>) => ({ plugin: 'sidekick', component: 'ContextMenu', surface: 'desktop', props }) as any
const pane = (plugin: string, requestId: string) =>
  ({ plugin, component: 'Pane', requestId, surface: 'desktop', props: { title: 'x', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } }) as any

test('a claim nothing backs is flagged, loose ends are kept, a queued request waits in the box', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await run($, 'queue', 'add a readme')
  await turn($)
  const answer = 'I fixed it and all tests pass. The mobile layout is not verified.'
  await $.turn.complete(done(answer))
  const ui = await $.ui.mount(reply(answer))

  expect(await words(ui)).toContain('it says tests pass, but no test ran')
  await ui.unmount()
  expect(w.saved[Object.keys(w.saved).find(k => k.startsWith('loose:')) ?? '']).toEqual(['The mobile layout is not verified.'])
  expect(w.filled).toEqual(['add a readme'])

  const panel = await $.ui.mount(pane('sidekick', 'sidekick'))
  await panel.press({ key: 'ask-0' })
  await panel.press({ key: 'done-0' })
  expect(await words(panel)).toContain('Nothing left open')
  await panel.unmount()
})

test('a passing test run backs the claim', async ($, on) => {
  world(on)
  await $.session.start(START)
  await turn($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' } as any)
  await $.turn.complete(done('All tests pass.'))
  const ui = await $.ui.mount(reply('All tests pass.'))

  expect(await words(ui)).toBe('app row')
  await ui.unmount()
})

test('edits: main branch said once, sensitive file marked, and rewind puts back only untouched files', async ($, on) => {
  const w = world(on)
  w.files = { 'auth.ts': 'old auth', 'b.ts': 'old b' }
  w.next = { 'auth.ts': 'new auth', 'b.ts': 'new b' }
  await $.session.start(START)
  await turn($)
  await edit($, 'auth.ts', 'e1')
  await edit($, 'b.ts', 'e2')
  await $.turn.complete(done('Changed two files.'))

  expect(w.toasts).toEqual(['Heads up: these edits are on the main branch.'])
  const row = await $.ui.mount({ plugin: 'sidekick', component: 'ToolUse', surface: 'desktop', requestId: 'e1', props: { tool_use_id: 'e1', tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false } } as any)
  expect(await words(row)).toContain('Sensitive file')
  await row.unmount()

  w.files['b.ts'] = 'edited by hand'
  const drawn = await $.ui.mount(reply('Changed two files.', 'r7'))
  await drawn.unmount()
  const m = await $.ui.mount(menu({ row: { component: 'AssistantMessage', requestId: 'r7' } }))
  await m.press({ key: 's-rewind' })
  await m.unmount()
  const panel = await $.ui.mount(pane('sidekick', 'sidekick'))
  await panel.press({ key: 'confirm' })

  expect(w.files).toEqual({ 'auth.ts': 'old auth', 'b.ts': 'edited by hand' })
  expect(await words(panel)).toContain('Left alone: b.ts (changed since).')
  await panel.unmount()
})

test('right-click: error meaning, prove it, and a rule that joins the instructions', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.fails = true
  await $.tool.call({ tool: 'Bash', tool_use_id: 'f1', command: 'make x' } as any)
  const err = await $.ui.mount(menu({ row: { component: 'ToolUse', requestId: 'f1' } }))
  await err.press({ key: 's-error' })
  await err.unmount()

  const sel = await $.ui.mount(menu({ selection: { text: 'Always reply in simple English' } }))
  expect(await labels(sel)).toEqual(['Prove it', 'Teach me this', 'Quiz me', 'Make this a rule'])
  await sel.press({ key: 's-rule' })
  await sel.unmount()

  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: { name: 'd', isKeepingCodingInstructions: true }, traits: [] } as any)
  expect(composed.sections.map((s: any) => s.id)).toEqual(['base', 'sidekick-rules'])
  expect(JSON.stringify(composed.sections)).toContain('Always reply in simple English')
  expect(w.filled[0]).toContain('Error: boom')
})

test('long chat and a nearly used limit are each said once; speaking is off until chosen', async ($, on) => {
  const w = world(on)
  w.percent = 75
  w.limits = [{ kind: 'five_hour', percentUsed: 85 }]
  await $.session.start(START)
  await $.turn.complete(done('Shall I go on?', 90_000))
  await $.turn.complete(done('Shall I go on?', 90_000))

  expect(w.toasts).toHaveLength(2)
  expect(w.spoken).toEqual([])
  const panel = await $.ui.mount(pane('mod-manager', 'mod-settings'))
  await panel.press({ key: 'sk-speak', plugin: 'sidekick' })
  await $.turn.complete(done('Shall I go on?', 90_000))
  expect(w.spoken.join()).toContain('Shall I go on?')
  await panel.unmount()
})

test('project, today and servers tabs, with a section in the shared settings panel', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'build the thing' } as any)
  await turn($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'npm run build' } as any)
  await $.turn.complete(done('Built.'))
  await run($, 'today')
  const panel = await $.ui.mount(pane('sidekick', 'sidekick'))

  expect(await words(panel)).toContain('1 turn')
  expect(await words(panel)).toContain('- build the thing')
  await panel.press({ key: 'tab-project' })
  await panel.press({ key: 'run-0' })
  expect(w.filled).toEqual(['Run `npm run build` and tell me the result.'])
  await run($, 'servers')
  expect(await words(panel)).toContain(':3000  node')
  await panel.unmount()

  const shared = await $.ui.mount(pane('mod-manager', 'mod-settings'))
  expect(await words(shared)).toContain('Sidekick')
  expect(await labels(shared)).toContain('Claim checker: on')
  await shared.unmount()
})

test('the readings themselves', async () => {
  expect(unbackedClaims('The tests have not passed yet.', { isTestRun: false, isCommandRun: false })).toEqual([])
  expect(unbackedClaims('It works now.', { isTestRun: false, isCommandRun: false })[0]).toContain('no command ran')
  expect(looseEnds('Done.\n```\nTODO in code\n```')).toEqual([])
  expect(isSensitive('src/auth/login.ts')).toBe(true)
  expect(isSensitive('src/author.ts')).toBe(false)
  expect(bigFileWarning('web/package-lock.json', 0)).toContain('generated')
  expect(addCommand([], 'echo hi')).toEqual([])
  expect(addCommand([], 'python3 /Users/someone/x.py')).toEqual([])
  expect(parseServers('h\nx 1 u 3u IPv4 a 0t0 TCP 127.0.0.1:8080 (LISTEN)')).toEqual([{ name: 'x', pid: '1', port: '8080' }])
  expect(addToDay(undefined, 'd', { files: ['a'], failed: 1, ask: '' }).turns).toBe(1)
})
