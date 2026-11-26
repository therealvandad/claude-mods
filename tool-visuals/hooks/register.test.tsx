import { expect, mock, test } from 'claude-code/testing'

import {
  buildSummary,
  edgeOf,
  failingTests,
  fmtDuration,
  glyphFor,
  isWritingCommand,
  miniDiff,
  networkKind,
  ordinal,
  parseBuildErrors,
  redact,
  redactDeep,
  signatureOf,
  sizeBadge,
} from './pure'

// ------------------------------------------------------------ pure parsers

test('duration formatting', async () => {
  expect(fmtDuration(0)).toBe('0ms')
  expect(fmtDuration(420)).toBe('420ms')
  expect(fmtDuration(2345)).toBe('2.3s')
  expect(fmtDuration(9999)).toBe('9.9s')
  expect(fmtDuration(10_400)).toBe('10s')
  expect(fmtDuration(65_000)).toBe('1m 05s')
  expect(fmtDuration(3_720_000)).toBe('1h 02m')
  expect(fmtDuration(-5)).toBe('0ms')
  expect(ordinal(2)).toBe('2nd')
  expect(ordinal(3)).toBe('3rd')
  expect(ordinal(11)).toBe('11th')
  expect(ordinal(22)).toBe('22nd')
})

test('failing test names from jest, vitest, pytest, go and cargo', async () => {
  const jest = [
    'FAIL src/a.test.ts',
    '  ● math › adds numbers',
    '  ● math › subtracts',
    '  ✕ adds numbers (4 ms)',
    '  ● Console',
  ].join('\n')
  expect(failingTests(jest).names).toEqual(['math › adds numbers', 'math › subtracts'])

  const vitest = [
    ' ❯ src/a.test.ts (3 tests | 1 failed)',
    '   × adds numbers 2ms',
    ' FAIL  src/a.test.ts > math > adds numbers',
    ' FAIL  src/a.test.ts > math > adds numbers',
  ].join('\n')
  expect(failingTests(vitest).names).toEqual(['src/a.test.ts > math > adds numbers'])

  const pytest = [
    '=== short test summary info ===',
    'FAILED tests/test_a.py::test_one - AssertionError: nope',
    'ERROR tests/test_b.py::test_two',
  ].join('\n')
  expect(failingTests(pytest).names).toEqual(['tests/test_a.py::test_one', 'tests/test_b.py::test_two'])

  const go = ['--- FAIL: TestAdd (0.00s)', '    --- FAIL: TestAdd/neg (0.00s)', 'FAIL', 'FAIL\tpkg\t0.01s'].join('\n')
  expect(failingTests(go).names).toEqual(['TestAdd', 'TestAdd/neg'])

  const cargo = ['test tests::ok ... ok', 'test tests::bad ... FAILED'].join('\n')
  expect(failingTests(cargo).names).toEqual(['tests::bad'])

  const many = Array.from({ length: 8 }, (_, i) => `FAILED t.py::test_${i}`).join('\n')
  const capped = failingTests(many)
  expect(capped.names.length).toBe(5)
  expect(capped.more).toBe(3)

  expect(failingTests('all 12 tests passed').names).toEqual([])
  expect(failingTests('\u001b[31m  ✕ colored name\u001b[39m').names).toEqual(['colored name'])
})

test('build errors are grouped by file', async () => {
  const tsc = [
    'src/a.ts(3,5): error TS2322: Type x',
    'src/a.ts(9,1): error TS2304: Cannot find y',
    'src/deep/dir/b.ts(1,1): error TS1005: ; expected',
    'Found 3 errors.',
  ].join('\n')
  expect(parseBuildErrors(tsc)).toEqual([['src/a.ts', 2], ['dir/b.ts', 1]])
  expect(buildSummary(parseBuildErrors(tsc))).toBe('3 errors in 2 files: src/a.ts (2), dir/b.ts (1)')

  const pretty = 'src/c.tsx:4:7 - error TS2345: Argument of type'
  expect(parseBuildErrors(pretty)).toEqual([['src/c.tsx', 1]])

  const swift = '/Users/me/App/Sources/View.swift:12:5: error: cannot find x in scope\n/Users/me/App/Sources/View.swift:20:1: warning: unused'
  expect(parseBuildErrors(swift)).toEqual([['Sources/View.swift', 1]])

  const cargo = ['error[E0425]: cannot find value', '  --> src/main.rs:4:5', '   |', 'error: could not compile `x`'].join('\n')
  expect(parseBuildErrors(cargo)).toEqual([['src/main.rs', 1]])

  const go = ['# example/pkg', './main.go:5:2: undefined: foo', 'pkg/util.go:9:1: syntax error'].join('\n')
  expect(parseBuildErrors(go)).toEqual([['main.go', 1], ['pkg/util.go', 1]])

  const four = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(f => `${f}(1,1): error TS1: x`).join('\n')
  expect(buildSummary(parseBuildErrors(four))).toBe('4 errors in 4 files: a.ts (1), b.ts (1), c.ts (1) +1 more')
  expect(buildSummary([])).toBeNull()
})

test('secrets are masked in displayed text only', async () => {
  const anthropic = 'key sk-ant-api03-abcdefghijklmnopqrstuvwx1234 end'
  expect(redact(anthropic).text).toBe('key [redacted:api-key] end')

  const github = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789 and github_pat_11ABCDEFG0abcdefghijkl_mnop'
  expect(redact(github).text).toBe('[redacted:github-token] and [redacted:github-token]')
  expect(redact(github).count).toBe(2)

  expect(redact('AKIAABCDEFGHIJKLMNOP').text).toBe('[redacted:aws-key]')
  expect(redact('API_TOKEN=9f86d081884c7d659a2feaa0c55ad015').text).toBe('API_TOKEN=[redacted:secret]')
  expect(redact('"password": "Zm9vYmFyYmF6cXV4MTIzNDU2"').text).toBe('"password": "[redacted:secret]"')
  expect(redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz12').text).toBe('Authorization: Bearer [redacted:bearer]')
  expect(redact('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----').text).toBe('[redacted:private-key]')
  expect(redact('xoxb-1234567890-abcdefghij').text).toBe('[redacted:slack-token]')

  // Ordinary text, paths and short values stay as they are.
  const plain = 'token=short and path /usr/local/lib and token_file=/etc/some/long/path/name sha 9f86d081'
  expect(redact(plain)).toEqual({ text: plain, count: 0 })
  // Masking twice changes nothing more.
  expect(redact(redact(anthropic).text).count).toBe(0)

  const output = { stdout: 'token=9f86d081884c7d659a2feaa0c55ad015', code: 0, nested: ['sk-abcdefghijklmnopqrstuv12'] }
  const masked = redactDeep(output)
  expect(masked.count).toBe(2)
  expect(masked.value).toEqual({ stdout: 'token=[redacted:secret]', code: 0, nested: ['[redacted:api-key]'] })
  // The original object is left alone, and a clean one comes back as the same object.
  expect(output.stdout).toBe('token=9f86d081884c7d659a2feaa0c55ad015')
  const clean = { stdout: 'hello' }
  expect(redactDeep(clean).value).toBe(clean)
})

test('mini diff, glyphs, edges, badges and signatures', async () => {
  expect(miniDiff('a\nb\nc', 'a\nB\nc')).toEqual({ lines: [{ sign: '-', text: 'b' }, { sign: '+', text: 'B' }], more: 0 })
  const big = miniDiff('x\n1\n2\n3\n4', 'x\nA\nB\nC\nD')
  expect(big.lines.length).toBe(3)
  expect(big.more).toBe(5)
  expect(miniDiff('same', 'same').lines).toEqual([])
  expect(miniDiff('', 'new').lines).toEqual([{ sign: '+', text: 'new' }])

  expect(glyphFor('/a/b/main.ts')).toBe('‹TS›')
  expect(glyphFor('/a/Dockerfile')).toBe('‹DOCK›')
  expect(glyphFor('/a/.env.local')).toBe('‹ENV›')
  expect(glyphFor('/a/LICENSE')).toBeNull()
  expect(glyphFor('/a/x.weird')).toBe('‹WEIR›')

  expect(edgeOf('Read', {}, false)).toBe('inactive')
  expect(edgeOf('Edit', {}, false)).toBe('warning')
  expect(edgeOf('Bash', { command: 'ls -la' }, false)).toBe('inactive')
  expect(edgeOf('Bash', { command: 'rm -rf build' }, false)).toBe('error')
  expect(edgeOf('Read', {}, true)).toBe('error')
  expect(isWritingCommand('echo hi > out.txt')).toBe(true)
  expect(isWritingCommand('ls 2>&1 > /dev/null')).toBe(false)
  expect(isWritingCommand('node -e "a => b"')).toBe(false)

  expect(networkKind('WebFetch', {})).toBe('web')
  expect(networkKind('mcp__x__y', {})).toBe('mcp')
  expect(networkKind('Bash', { command: 'curl -s https://x' })).toBe('curl')
  expect(networkKind('Bash', { command: 'ls' })).toBeNull()

  const lines = Array.from({ length: 4200 }, (_, i) => `line ${i}`).join('\n')
  expect(sizeBadge('Bash', { stdout: lines, stderr: '' })).toBe('4,200 lines')
  expect(sizeBadge('Bash', { stdout: 'short', stderr: '' })).toBeNull()
  expect(sizeBadge('Edit', { stdout: lines })).toBeNull()

  expect(signatureOf('Bash', { command: 'ls', tool_use_id: 'a' })).toBe(signatureOf('Bash', { tool_use_id: 'b', command: 'ls' }))
  expect(signatureOf('Bash', { command: 'ls' })).not.toBe(signatureOf('Bash', { command: 'pwd' }))
  expect(signatureOf('Read', { command: 'ls' })).not.toBe(signatureOf('Bash', { command: 'ls' }))
})

// ------------------------------------------------------------ engine behaviour

const engine = (on: (...args: any[]) => unknown) => {
  on('command.register', () => ({ value: { command: 'toolvis' } }))
  on('ui.status', () => ({ value: undefined }))
}

// One tool.call stand-in that holds each call for `delay.ms` on the mocked clock.
const slowCalls = (on: (...args: any[]) => unknown, clock: { sleep: (ms: number) => Promise<void> }, delay: { ms: number }) => {
  const ids: string[] = []
  on('tool.call', async (_: unknown, e: { tool_use_id: string }) => {
    ids.push(e.tool_use_id)
    if (delay.ms > 0) {
      await clock.sleep(delay.ms)
    }

    return { result: {} }
  })

  return ids
}

const ROW = (props: Record<string, unknown>) =>
  ({
    plugin: 'tool-visuals',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...props },
  }) as const

test('a finished slow call shows a duration chip and repeats count as attempts', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: 5000 })
  mock.store(on)
  const delay = { ms: 12_300 }
  const ids = slowCalls(on, clock, delay)

  const running = $.tool.call({ tool: 'Bash', command: 'sleep 12' })
  await clock.advance(12_300)
  await running

  delay.ms = 0
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ids.length).toBe(4)

  const slow = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'sleep 12' }, output: { stdout: '', stderr: '' } }))
  expect((await slow.find({ type: 'Text', text: /slow/ }))?.text).toBe('⏱ 12s slow')
  expect(await slow.find({ type: 'Text', text: /attempt/ })).toBeUndefined()
  await slow.unmount()

  const third = await $.ui.mount(ROW({ tool_use_id: ids[3], input: { command: 'ls' }, output: { stdout: '', stderr: '' } }))
  expect((await third.find({ type: 'Text', text: /attempt/ }))?.text).toBe('↻ 3rd attempt')
  expect((await third.find({ type: 'Text', text: /^\d+ms$/ }))?.text).toBe('0ms')
  await third.unmount()
})

test('the network ticker runs while a network call runs, then stops', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: 10_000 })
  mock.store(on)
  const delay = { ms: 3000 }
  const ids = slowCalls(on, clock, delay)

  const running = $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'x' })
  await clock.advance(1600)

  const live = await $.ui.mount(ROW({ tool: 'WebFetch', tool_use_id: ids[0], input: { url: 'https://example.com' }, isRunning: true }))
  expect((await live.find({ type: 'Text', text: /waiting on network/ }))?.text).toMatch(/waiting on network · web · 1\.[05]s/)
  await live.unmount()

  await clock.advance(1500)
  await running
  await clock.advance(20_000)

  // The bar's clock stopped with the call: a stale running row does not count on.
  const stale = await $.ui.mount(ROW({ tool: 'WebFetch', tool_use_id: ids[0], input: { url: 'https://example.com' }, isRunning: true }))
  expect((await stale.find({ type: 'Text', text: /waiting on network/ }))?.text).toMatch(/· web · [23]\.\ds/)
  await stale.unmount()
})

test('with motion off the ticker never starts', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: 10_000 })
  mock.store(on, { motion: false })
  const delay = { ms: 3000 }
  const ids = slowCalls(on, clock, delay)

  const running = $.tool.call({ tool: 'Bash', command: 'curl https://example.com' })
  await clock.advance(1600)

  const live = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'curl https://example.com' }, isRunning: true }))
  expect((await live.find({ type: 'Text', text: /waiting on network/ }))?.text).toBe('⇄ waiting on network')
  await live.unmount()

  await clock.advance(1500)
  await running
})

test('/motion off in the motion mod switches this mod off too', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: 10_000 })
  mock.store(on)
  // The motion mod owns `motion.isOn`: it reads false here, with nothing stored in this mod.
  on('state.get', (_: unknown, e: any, next: any) =>
    e.plugin === 'motion' && e.key === 'isOn' ? { value: { value: false, version: 1 } } : next(e),
  )
  const delay = { ms: 3000 }
  const ids = slowCalls(on, clock, delay)

  const running = $.tool.call({ tool: 'Bash', command: 'curl https://example.com' })
  await clock.advance(1600)

  const live = await $.ui.mount(ROW({ tool_use_id: ids[0], input: { command: 'curl https://example.com' }, isRunning: true }))
  expect((await live.find({ type: 'Text', text: /waiting on network/ }))?.text).toBe('⇄ waiting on network')
  await live.unmount()

  await clock.advance(1500)
  await running
})

test('test and build cards draw names and files, not counts', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 1 })
  mock.store(on)

  const failing = await $.ui.mount(
    ROW({
      input: { command: 'pytest -q' },
      output: { stdout: 'FAILED tests/test_a.py::test_one - boom\nFAILED tests/test_a.py::test_two\n2 failed, 5 passed', stderr: '' },
    }),
  )
  expect((await failing.find({ type: 'Text', text: /test_one/ }))?.text).toMatch(/✗ tests\/test_a\.py::test_one/)
  expect(await failing.find({ type: 'Text', text: /passed/ })).toBeUndefined()
  await failing.unmount()

  const build = await $.ui.mount(
    ROW({ input: { command: 'npx tsc --noEmit' }, output: { stdout: 'src/a.ts(1,1): error TS2304: x\nsrc/a.ts(2,1): error TS2304: y', stderr: '' } }),
  )
  expect((await build.find({ type: 'Text', text: /errors in/ }))?.text).toMatch(/2 errors in 1 file: src\/a\.ts \(2\)/)
  await build.unmount()
})

test('an edit row shows a mini diff, a glyph and an edge', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 1 })
  mock.store(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      ...ROW({ tool: 'Edit', input: { file_path: '/app/src/a.ts', old_string: 'let a = 1', new_string: 'let a = 2' } }),
      surface,
    })
    expect((await ui.find({ type: 'Text', text: /^- let a = 1/ }))?.text).toBe('- let a = 1')
    expect((await ui.find({ type: 'Text', text: /^\+ let a = 2/ }))?.text).toBe('+ let a = 2')
    expect(await ui.find({ type: 'Text', text: /‹TS›/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a running network call with motion off draws plain text, with motion on a bar', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 1 })
  mock.store(on, { motion: false })

  const quiet = await $.ui.mount(ROW({ tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: true }))
  expect(await quiet.find({ type: 'Progress' })).toBeUndefined()
  expect((await quiet.find({ type: 'Text', text: /waiting on network/ }))?.text).toBe('⇄ waiting on network')
  await quiet.unmount()
})

test('a running network call with motion on draws a bar on every surface', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 1 })
  mock.store(on)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...ROW({ tool: 'WebFetch', input: { url: 'https://example.com' }, isRunning: true }), surface })
    const bar = (await ui.find({ type: 'Progress' })) ?? (await ui.find({ type: 'Text', text: /waiting on network · web/ }))
    expect(bar).toBeDefined()
    await ui.unmount()
  }
})

test('the result row is masked, and a clean one is left alone', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 1 })
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const out = (e.props as { output?: { stdout?: string } }).output

    return <Text>{out?.stdout ?? ''}</Text>
  })

  const result = (stdout: string) =>
    ({
      plugin: 'tool-visuals',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: 'r1',
      props: { tool_use_id: 'r1', tool: 'Bash', output: { stdout, stderr: '' }, isErrored: false },
    }) as const

  const masked = await $.ui.mount(result('here: ghp_abcdefghijklmnopqrstuvwxyz0123456789'))
  expect((await masked.find({ type: 'Text', text: /redacted/ }))?.text).toBe('here: [redacted:github-token]')
  expect(await masked.find({ type: 'Text', text: /masked in this display/ })).toBeDefined()
  expect(await masked.find({ type: 'Text', text: /ghp_/ })).toBeUndefined()
  await masked.unmount()

  const clean = await $.ui.mount(result('hello'))
  expect(await clean.find({ type: 'Text', text: /masked in this display/ })).toBeUndefined()
  await clean.unmount()
})

test('a long finished run of reads folds into one line', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 1 })
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine group</Text>
  })
  const calls = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      tool_use_id: `g${i}`,
      tool: i % 3 === 0 ? 'Grep' : 'Read',
      input: {},
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: { stdout: 'a\nb\nc' },
    }))
  const group = (n: number, isActive = false) =>
    ({
      plugin: 'tool-visuals',
      surface: 'terminal',
      component: 'ToolGroup',
      requestId: 'grp',
      props: { calls: calls(n), isActive, isExpanded: false, isCallsOnly: true },
    }) as const

  const folded = await $.ui.mount(group(8))
  expect((await folded.find({ type: 'Text', text: /quiet calls/ }))?.text).toMatch(/8 quiet calls: 5 Read · 3 Grep/)
  await folded.unmount()

  const few = await $.ui.mount(group(3))
  expect(await few.find({ type: 'Text', text: /engine group/ })).toBeDefined()
  await few.unmount()

  const live = await $.ui.mount(group(8, true))
  expect(await live.find({ type: 'Text', text: /engine group/ })).toBeDefined()
  await live.unmount()
})

test('the row composes with a hook beneath it, such as tool-guard badge', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 1 })
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>▲ high-risk command</Text>
  })

  const ui = await $.ui.mount(ROW({ input: { command: 'sudo rm -rf build' }, output: { stdout: '', stderr: '' } }))
  expect(await ui.find({ type: 'Text', text: /high-risk command/ })).toBeDefined()
  await ui.unmount()
})

test('/toolvis off turns the chrome off and keeps masking on', async ($, on) => {
  engine(on)
  mock.clock(on, { now: 1 })
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const edit = ROW({ tool: 'Edit', input: { file_path: '/a.ts', old_string: 'a', new_string: 'b' } })
  const before = await $.ui.mount(edit)
  expect(await before.find({ type: 'Text', text: /^- a/ })).toBeDefined()
  await before.unmount()

  const said = await $.command.run({ command: 'toolvis', args: 'off', origin: 'user' } as any)
  expect(JSON.stringify(said)).toMatch(/off/)

  const after = await $.ui.mount(edit)
  expect(await after.find({ type: 'Text', text: /^- a/ })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: /engine row/ })).toBeDefined()
  await after.unmount()
})
