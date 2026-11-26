import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'debug-kit',
  component: 'Pane',
  requestId: 'debug-kit-main',
  surface: 'desktop',
  props: {
    title: 'Debug kit',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type Box = {
  toasts: string[]
  fills: string[]
  suggests: string[]
  argvs: string[][]
  writes: string[]
  reads: number
  files: Record<string, { text: string; size: number; mtimeMs: number }>
  tool: (e: { tool: string; command?: string }) => { text: string; isError?: true }
  panes: { id: string }[]
  commands: string[]
}

const engine = (on: any, init: Record<string, unknown> = {}) => {
  const box: Box = {
    toasts: [],
    fills: [],
    suggests: [],
    argvs: [],
    writes: [],
    reads: 0,
    files: {},
    tool: () => ({ text: 'ok' }),
    panes: [{ id: 'debug-kit-main' }],
    commands: [],
  }
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, init)
  on('command.register', (_: unknown, e: { name: string }) => {
    box.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => undefined)
  on('ui.panes', () => ({ value: box.panes }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    box.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.suggest', (_: unknown, e: { text: string }) => {
    box.suggests.push(e.text)

    return { isShown: true }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    box.argvs.push(e.argv)

    if (e.argv[0] === 'lsof') {
      return { value: { exitCode: 0, stdout: 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 77 me 20u IPv4 0x1 0t0 TCP *:3000 (LISTEN)\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === 'ruby') {
      throw new Error('spawn ruby ENOENT')
    }

    return { value: { exitCode: 0, stdout: `${e.argv[0]} 1.2.3\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', (_: unknown, e: { path: string }) => {
    box.writes.push(e.path)

    return { value: undefined }
  })
  on('fs.stat', (_: unknown, e: { path: string }) => {
    const f = box.files[e.path]

    if (f === undefined) {
      throw new Error('ENOENT: no such file')
    }

    return { value: { kind: 'file', size: f.size, mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('fs.read', (_: unknown, e: { path: string }) => {
    box.reads += 1
    const f = box.files[e.path]

    if (f === undefined) {
      throw new Error('ENOENT: no such file')
    }

    return { value: f.text }
  })
  on('tool.call', (_: unknown, e: { tool: string; command?: string }) => {
    const out = box.tool(e)

    return out.isError === true ? { result: out.text, text: out.text, isError: true } : { result: {}, text: out.text }
  })

  return { box, clock }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const cmd = ($: any, command: string, args = ''): Promise<{ text: string }> =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })
const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })
const done = () => ({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }) as any

const JEST_FAIL = [
  'FAIL src/a.test.ts',
  '  ● math › adds numbers',
  '  ● math › subtracts',
  'Tests:       2 failed, 5 passed, 7 total',
  'Snapshots:   1 obsolete, 6 passed, 7 total',
  'All files          |    80.0 |',
  '  ✓ slow case (900 ms)',
].join('\n')

// ------------------------------------------------------------- help and registration

test('/db lists every command and each is registered with the db prefix', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect(box.commands.length).toBe(21)
  expect(box.commands.every(n => n.startsWith('db'))).toBe(true)
  const help = (await cmd($, 'db')).text
  for (const name of box.commands) {
    expect(help).toContain(`/${name} `)
  }
})

// ------------------------------------------------------------- 41, 45, 46, 47, 57 tests

test('41 a failed test run feeds /dbfocus, and a later pass shows flaky, coverage, timing, snapshots', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect((await cmd($, 'dbfocus')).text).toMatch(/No failed test run/)

  box.tool = () => ({ text: `Exit code 1\n${JEST_FAIL}`, isError: true })
  await bash($, 'npx jest')
  const focus = await cmd($, 'dbfocus')
  expect(focus.text).toMatch(/2 failing tests/)
  expect(box.fills[0]).toMatch(/Re-run only the failing tests/)
  expect(box.fills[0]).toMatch(/- math › adds numbers/)
  expect(box.fills[0]).toContain("npx jest -t 'adds numbers|subtracts'")

  box.tool = () => ({ text: 'Tests:       7 passed, 7 total\nAll files          |    82.5 |' })
  await bash($, 'npx jest')
  expect((await cmd($, 'dbflaky')).text).toMatch(/Suspected flaky: 2/)
  const cov = (await cmd($, 'dbcov')).text
  expect(cov).toMatch(/80\.0%\s+first/)
  expect(cov).toMatch(/82\.5%\s+\+2\.5/)
  expect((await cmd($, 'dbtime')).text).toMatch(/900ms\s+slow case/)
  expect((await cmd($, 'dbsnap')).text).toMatch(/1 obsolete, 6 passed/)
})

test('45 an edit between the failure and the pass makes it a fix, not a flake', async ($, on) => {
  const { box } = engine(on)
  await start($)
  box.tool = () => ({ text: `Exit code 1\n${JEST_FAIL}`, isError: true })
  await bash($, 'npx jest')
  box.tool = () => ({ text: 'ok' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'a', new_string: 'b' })
  box.tool = () => ({ text: 'Tests:       7 passed, 7 total' })
  await bash($, 'npx jest')
  expect((await cmd($, 'dbflaky')).text).toMatch(/Suspected flaky: 0\. Failures that went away after an edit: 2/)
})

test('the tests tab draws the failing names and a focus button', async ($, on) => {
  const { box } = engine(on)
  await start($)
  box.tool = () => ({ text: `Exit code 1\n${JEST_FAIL}`, isError: true })
  await bash($, 'npx jest')
  await cmd($, 'dbcov')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /math › adds numbers/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'dk-focus' })).toBeDefined()
  await ui.unmount()
})

// ------------------------------------------------------------- 42 bisect

test('42 /dbbisect shows the guide, fills the prompt and runs nothing', async ($, on) => {
  const { box } = engine(on)
  await start($)
  const out = await cmd($, 'dbbisect', 'v1.0 main')
  expect(out.text).toMatch(/git bisect start/)
  expect(out.text).toMatch(/git bisect good v1\.0/)
  expect(box.fills[0]).toMatch(/Bad: main\. Good: v1\.0/)
  expect(box.argvs.length).toBe(0)
  expect((await cmd($, 'dbbisect', '--exec=x')).text).toMatch(/Refs may only/)
})

// ------------------------------------------------------------- 43, 49 traces and errors

test('43 and 49 a stack trace in a failed Bash result is explained, errors are clustered', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect((await cmd($, 'dbtrace')).text).toMatch(/No stack trace/)
  const trace = ['TypeError: x is not a function', '    at run (/work/src/a.ts:10:5)', '    at Object.<anonymous> (/work/node_modules/q/i.js:3:1)', '    at main (/work/src/b.ts:2:2)'].join('\n')
  box.tool = () => ({ text: `Exit code 1\n${trace}`, isError: true })
  await bash($, 'node a.js')
  await bash($, 'node b.js')
  const out = (await cmd($, 'dbtrace')).text
  expect(out).toMatch(/javascript stack trace: TypeError: x is not a function/)
  expect(out).toMatch(/\/work\/src\/a\.ts:10:5/)
  expect(out).not.toMatch(/Top application frames:[\s\S]*node_modules[\s\S]*All frames/)
  expect((await cmd($, 'dberr')).text).toMatch(/1 error group:\n\s+x2 /)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', key: 'dk-tab-errors' })).toBeDefined()
  await ui.unmount()
})

// ------------------------------------------------------------- 44 repro recorder

test('44 the recorder keeps Bash commands between start and stop, redacted', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await bash($, 'echo before')
  await cmd($, 'dbrec', 'start')
  await bash($, 'npm run build')
  box.tool = () => ({ text: 'Exit code 1\nboom', isError: true })
  await bash($, 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwx" x')
  await cmd($, 'dbrec', 'stop')
  box.tool = () => ({ text: 'ok' })
  await bash($, 'echo after')
  const shown = (await cmd($, 'dbrec', 'show')).text
  expect(shown).toMatch(/Stopped: 2 commands/)
  expect(shown).toMatch(/1\. npm run build/)
  expect(shown).toMatch(/2\. curl .*Bearer \[secret\].*# failed/)
  expect(shown).not.toMatch(/before|after/)
  expect(shown).not.toMatch(/abcdefghijklmnop/)
})

// ------------------------------------------------------------- 48 tail

test('48 the tail refreshes every 3 s while the pane is open and stops when it closes', async ($, on) => {
  const { box, clock } = engine(on)
  await start($)
  box.files['/var/log/app.log'] = { text: 'one\ntwo\n', size: 8, mtimeMs: 1 }
  expect((await cmd($, 'dbtail', '/var/log/app.log')).text).toMatch(/Refreshes every 3 s/)
  expect(box.reads).toBe(1)

  box.files['/var/log/app.log'] = { text: 'one\ntwo\nthree\n', size: 14, mtimeMs: 2 }
  await clock.advance(3000)
  expect(box.reads).toBe(2)
  let ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^three$/ })).toBeDefined()
  await ui.unmount()

  // unchanged file: no new read
  await clock.advance(3000)
  expect(box.reads).toBe(2)

  box.files['/var/log/app.log'] = { text: 'one\ntwo\nthree\nfour\n', size: 19, mtimeMs: 3 }
  // the pane is gone: the next tick sees it and stops the timer for good
  box.panes = []
  await clock.advance(9000)
  expect(box.reads).toBe(2)
  ui = await $.ui.mount(PANE)
  await ui.unmount()
})

test('48 with motion off there is no timer, only a manual refresh', async ($, on) => {
  const { box, clock } = engine(on, { motion: false })
  await start($)
  box.files['/work/a.log'] = { text: 'x\n', size: 2, mtimeMs: 1 }
  expect((await cmd($, 'dbtail', '/work/a.log')).text).toMatch(/Motion is off/)
  box.files['/work/a.log'] = { text: 'x\ny\n', size: 4, mtimeMs: 2 }
  await clock.advance(10_000)
  expect(box.reads).toBe(1)
  await cmd($, 'dbtail', '')
  expect(box.reads).toBe(2)
})

test('48 /motion off in the motion mod switches the timer off too', async ($, on) => {
  const { box, clock } = engine(on)
  on('state.get', (_: unknown, e: any, next: any) => (e.plugin === 'motion' && e.key === 'isOn' ? { value: { value: false, version: 1 } } : next(e)))
  await start($)
  box.files['/work/a.log'] = { text: 'x\n', size: 2, mtimeMs: 1 }
  await cmd($, 'dbtail', '/work/a.log')
  await clock.advance(10_000)
  expect(box.reads).toBe(1)
})

test('48 secrets, missing files and off', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect((await cmd($, 'dbtail', '/home/me/.ssh/config')).text).toMatch(/Refusing/)
  expect((await cmd($, 'dbtail', '.env')).text).toMatch(/Refusing/)
  await cmd($, 'dbtail', 'nope.log')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /ENOENT|no such file|implementation/i })).toBeDefined()
  await ui.unmount()
  expect((await cmd($, 'dbtail', 'off')).text).toMatch(/stopped/)
  expect(box.argvs.length).toBe(0)
})

// ------------------------------------------------------------- 50, 51 hypotheses and breadcrumbs

test('50 hypotheses are added and marked, and the Ideas tab shows them', async ($, on) => {
  engine(on)
  await start($)
  await cmd($, 'dbhyp', 'cache is stale')
  await cmd($, 'dbhyp', 'race in the queue')
  expect((await cmd($, 'dbhyp', 'ok 2')).text).toMatch(/2\. \[confirmed\] race in the queue/)
  expect((await cmd($, 'dbhyp', 'no 1')).text).toMatch(/1\. \[ruled out\] cache is stale/)
  expect((await cmd($, 'dbhyp', 'ok 9')).text).toMatch(/No hypothesis 9/)
  expect((await cmd($, 'dbhyp', 'ok')).text).toMatch(/Usage/)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /\[confirmed\] race in the queue/ })).toBeDefined()
  await ui.unmount()
})

test('51 breadcrumbs record tool, detail and outcome in order', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await bash($, 'ls')
  box.tool = () => ({ text: 'Exit code 2\nno', isError: true })
  await bash($, 'cat missing')
  await $.tool.call({ tool: 'Read', file_path: '/work/src/deep/dir/a.ts' })
  const text = (await cmd($, 'dbtrail')).text
  expect(text).toMatch(/3 attempts[\s\S]*1 ✓ Bash  ls[\s\S]*2 ✗ Bash  cat missing[\s\S]*3 ✗ Read  …\/src\/deep\/dir\/a\.ts|3 attempts[\s\S]*3 [✓✗] Read/)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props } })
  expect(await ui.find({ type: 'Text', text: /cat missing/ })).toBeDefined()
  await ui.unmount()
})

// ------------------------------------------------------------- 52, 58 shell

test('52 /dbenv runs only allowlisted --version commands', async ($, on) => {
  const { box } = engine(on)
  await start($)
  const out = (await cmd($, 'dbenv')).text
  expect(out).toMatch(/node\s+node 1\.2\.3/)
  expect(out).toMatch(/ruby\s+\(not available\)/)
  expect(box.argvs.length).toBeGreaterThan(5)
  for (const argv of box.argvs) {
    expect(argv.length).toBe(2)
    expect(argv[1]).toBe('--version')
  }
})

test('58 /dbport validates the number and only runs lsof -i', async ($, on) => {
  const { box } = engine(on)
  await start($)
  for (const bad of ['', '0', '65536', 'abc', '80;ls', '-1', '1.5']) {
    expect((await cmd($, 'dbport', bad)).text).toMatch(/Usage/)
  }
  expect(box.argvs.length).toBe(0)
  const out = (await cmd($, 'dbport', '3000')).text
  expect(out).toMatch(/Port 3000:\n\s+node  pid 77  me  TCP \*:3000 \(LISTEN\)/)
  expect(box.argvs).toEqual([['lsof', '-nP', '-i', ':3000']])
})

// ------------------------------------------------------------- 53, 55 prompt fillers

test('53 and 55 fillers use the last failing test or the text given', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await cmd($, 'dbshrink', 'parser crashes on empty input')
  expect(box.fills[0]).toMatch(/Shrink this failing case[\s\S]*parser crashes on empty input/)
  box.tool = () => ({ text: `Exit code 1\n${JEST_FAIL}`, isError: true })
  await bash($, 'npx jest')
  await cmd($, 'dbassert', '')
  expect(box.fills[1]).toMatch(/precise assertions for math › adds numbers/)
})

// ------------------------------------------------------------- 54, 59 guards

test('54 a pass after failures offers one regression-test chip, at most once per 3 minutes', async ($, on) => {
  const { box, clock } = engine(on)
  await start($)
  box.tool = () => ({ text: 'Exit code 1\nboom', isError: true })
  await bash($, 'make check')
  box.tool = () => ({ text: 'fine' })
  await bash($, 'make check')
  expect(box.toasts.length).toBe(0)
  await $.turn.complete(done())
  expect(box.toasts.length).toBe(1)
  expect(box.suggests.length).toBe(1)
  expect(box.suggests[0]).toMatch(/make check[\s\S]*regression test/)

  // a second recovery inside 3 minutes: no new toast
  box.tool = () => ({ text: 'Exit code 1\nboom', isError: true })
  await bash($, 'make lint')
  box.tool = () => ({ text: 'fine' })
  await bash($, 'make lint')
  await clock.advance(60_000)
  await $.turn.complete(done())
  expect(box.toasts.length).toBe(1)

  // after 3 minutes the pending offer is shown
  await clock.advance(3 * 60_000)
  await $.turn.complete(done())
  expect(box.toasts.length).toBe(2)
})

test('54 /dbguard off silences the offer and the loop toast', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect((await cmd($, 'dbguard', 'off')).text).toMatch(/Guards are off/)
  box.tool = () => ({ text: 'Exit code 1\nboom', isError: true })
  await bash($, 'make x')
  await bash($, 'make x')
  await bash($, 'make x')
  box.tool = () => ({ text: 'fine' })
  await bash($, 'make x')
  await $.turn.complete(done())
  expect(box.toasts.length).toBe(0)
  expect(box.suggests.length).toBe(0)
})

test('59 the same command failing three times in two minutes toasts once', async ($, on) => {
  const { box, clock } = engine(on)
  await start($)
  box.tool = () => ({ text: 'Exit code 1\nboom', isError: true })
  await bash($, 'npm test')
  await clock.advance(20_000)
  await bash($, 'npm test')
  expect(box.toasts.length).toBe(0)
  await clock.advance(20_000)
  await bash($, 'npm test')
  expect(box.toasts.length).toBe(1)
  expect(box.toasts[0]).toMatch(/"npm test" failed 3 times in 2 minutes/)
  await bash($, 'npm test')
  await bash($, 'npm test')
  expect(box.toasts.length).toBe(1)
})

test('59 failures spread over more than two minutes are not a loop', async ($, on) => {
  const { box, clock } = engine(on)
  await start($)
  box.tool = () => ({ text: 'Exit code 1\nboom', isError: true })
  for (let i = 0; i < 4; i++) {
    await bash($, 'npm run lint')
    await clock.advance(70_000)
  }
  expect(box.toasts.length).toBe(0)
})

// ------------------------------------------------------------- 56 mocks

test('56 the mock map scans test files edited this session', async ($, on) => {
  const { box } = engine(on)
  await start($)
  expect((await cmd($, 'dbmocks')).text).toMatch(/No test files edited/)
  box.files['/work/src/a.test.ts'] = { text: "jest.mock('../db')\nconst send = jest.fn()\n", size: 40, mtimeMs: 1 }
  await $.tool.call({ tool: 'Write', file_path: '/work/src/a.test.ts', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/work/src/plain.ts', content: 'x' })
  const out = (await cmd($, 'dbmocks')).text
  expect(out).toMatch(/2 mocks in 1 file/)
  expect(out).toMatch(/module \.\.\/db/)
  expect(out).toMatch(/fn\s+send/)
})

// ------------------------------------------------------------- 60 postmortem and reset

test('60 the postmortem is built and shown, never written to a file', async ($, on) => {
  const { box } = engine(on)
  await start($)
  await cmd($, 'dbhyp', 'wrong env var')
  await cmd($, 'dbhyp', 'ok 1')
  box.tool = () => ({ text: 'Exit code 1\nError: boom 5', isError: true })
  await bash($, 'node run.js')
  const out = (await cmd($, 'dbpost')).text
  expect(out).toMatch(/^# Debugging postmortem \(draft\)/)
  expect(out).toMatch(/Cause: wrong env var/)
  expect(out).toMatch(/x1 Error: boom 5/)
  expect(out).toMatch(/no file was written/)
  expect(box.writes).toEqual([])
  const ui = await $.ui.mount(PANE)
  await ui.unmount()
})

test('/dbreset clears recorded data and stops the tail', async ($, on) => {
  const { box, clock } = engine(on)
  await start($)
  box.files['/work/a.log'] = { text: 'x\n', size: 2, mtimeMs: 1 }
  await cmd($, 'dbtail', '/work/a.log')
  await cmd($, 'dbhyp', 'something')
  await bash($, 'ls')
  await cmd($, 'dbrec', 'start')
  await cmd($, 'dbreset')
  expect((await cmd($, 'dbtrail')).text).toMatch(/No attempts/)
  expect((await cmd($, 'dbhyp')).text).toMatch(/No hypotheses/)
  expect((await cmd($, 'dbrec', 'show')).text).toMatch(/Stopped: 0 commands/)
  const reads = box.reads
  box.files['/work/a.log'] = { text: 'x\ny\n', size: 4, mtimeMs: 2 }
  await clock.advance(9000)
  expect(box.reads).toBe(reads)
})

// ------------------------------------------------------------- bounded data

test('recorded data is bounded', async ($, on) => {
  const { box } = engine(on)
  await start($)
  for (let i = 0; i < 180; i++) {
    await bash($, `echo ${i}`)
  }
  expect(box.argvs.length).toBe(0)
  const text = (await cmd($, 'dbtrail')).text
  expect(text).toMatch(/^150 attempts/)
})

test('a failing recording step never changes what the tool call returns', async ($, on) => {
  const { box } = engine(on)
  await start($)
  box.tool = () => ({ text: 'hello' })
  const out: any = await bash($, 'echo hi')
  expect(out.text).toBe('hello')
})

// ------------------------------------------------------------- pane buttons

test('every tab button switches the pane body, and the buttons act', async ($, on) => {
  const { box } = engine(on)
  await start($)
  box.tool = () => ({ text: `Exit code 1\n${JEST_FAIL}`, isError: true })
  await bash($, 'npx jest')
  await cmd($, 'dbhyp', 'bad import')
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'dk-tab-tests' })
  await ui.press({ key: 'dk-focus' })
  expect(box.fills.length).toBe(1)
  expect(box.fills[0]).toMatch(/Re-run only the failing tests/)

  await ui.press({ key: 'dk-tab-ideas' })
  await ui.press({ key: 'dk-ok-1' })
  expect(await ui.find({ type: 'Text', text: /\[confirmed\] bad import/ })).toBeDefined()
  await ui.press({ key: 'dk-no-1' })
  expect(await ui.find({ type: 'Text', text: /\[ruled out\] bad import/ })).toBeDefined()

  for (const id of ['trail', 'errors', 'repro', 'tail', 'post']) {
    await ui.press({ key: `dk-tab-${id}` })
  }
  await ui.press({ key: 'dk-post-build' })
  expect(await ui.find({ type: 'Text', text: /Debugging postmortem/ })).toBeDefined()
  await ui.unmount()
})

test('the regression chip in the pane fills the prompt and goes away', async ($, on) => {
  const { box } = engine(on)
  await start($)
  box.tool = () => ({ text: 'Exit code 1\nboom', isError: true })
  await bash($, 'make check')
  box.tool = () => ({ text: 'fine' })
  await bash($, 'make check')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'dk-reg' })
  expect(box.fills[0]).toMatch(/regression test/)
  expect(await ui.find({ type: 'Button', key: 'dk-reg' })).toBeUndefined()
  await ui.unmount()
})
