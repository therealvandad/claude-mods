import { expect, test } from 'claude-code/testing'

import {
  addCluster,
  bisectGuide,
  buildPostmortem,
  checkTailPath,
  coverageRows,
  failCount,
  flakyTally,
  focusCommand,
  focusPrompt,
  isAllowedVersionArgv,
  isGateOpen,
  isLoop,
  isRecovery,
  isTestCommand,
  isTestFile,
  normaliseError,
  outcomeOf,
  outputOf,
  parseBisectArgs,
  parseCoverage,
  parseHypArgs,
  parseLsof,
  parseSnapshots,
  parseStack,
  parseTestOutput,
  parseTimings,
  portArgv,
  rankSlowest,
  redact,
  runnerOf,
  scanMocks,
  tailLines,
  topAppFrames,
  validPort,
} from './pure'
import type { TestRun } from '../types'

const run = (over: Partial<TestRun>): TestRun => ({
  at: 0,
  cmd: 'npx jest',
  runner: 'jest',
  failed: [],
  passed: [],
  nFailed: 0,
  nPassed: 0,
  isGreen: true,
  cov: null,
  edits: 0,
  ...over,
})

test('41 failing names from jest, vitest, pytest, go, cargo, mocha', () => {
  const jest = ['FAIL src/a.test.ts', '  ● math › adds numbers', '  ● math › subtracts', '  ● Console', 'Tests:       2 failed, 5 passed, 7 total'].join('\n')
  const j = parseTestOutput(jest)
  expect(j.failed).toEqual(['math › adds numbers', 'math › subtracts'])
  expect([j.nFailed, j.nPassed]).toEqual([2, 5])

  const vitest = [' FAIL  src/a.test.ts > math > adds', ' FAIL  src/a.test.ts > math > adds', ' Tests  1 failed | 4 passed (5)'].join('\n')
  expect(parseTestOutput(vitest).failed).toEqual(['src/a.test.ts > math > adds'])
  expect(parseTestOutput(vitest).nFailed).toBe(1)

  const py = ['FAILED tests/test_a.py::test_one - AssertionError: no', 'ERROR tests/test_b.py::test_two', '=== 2 failed, 3 passed in 0.52s ==='].join('\n')
  const p = parseTestOutput(py)
  expect(p.failed).toEqual(['tests/test_a.py::test_one', 'tests/test_b.py::test_two'])
  expect([p.nFailed, p.nPassed]).toEqual([2, 3])

  expect(parseTestOutput('--- FAIL: TestAdd (0.00s)\n    --- FAIL: TestAdd/neg (0.00s)\nFAIL\tpkg\t0.1s').failed).toEqual(['TestAdd', 'TestAdd/neg'])
  expect(parseTestOutput('test a::b ... FAILED\ntest result: FAILED. 3 passed; 1 failed; 0 ignored').failed).toEqual(['a::b'])
  expect(parseTestOutput('  2 passing\n  1 failing\n\n  1) suite works:\n     Error: x').failed).toEqual(['suite works'])
  expect(parseTestOutput('all good').failed).toEqual([])
})

test('41 passed names and the green flag inputs', () => {
  const out = ['  ✓ adds (3 ms)', '  ✓ subtracts', 'tests/t.py::test_x PASSED', '--- PASS: TestY (0.01s)', 'test z::w ... ok'].join('\n')
  expect(parseTestOutput(out).passed).toEqual(['adds', 'subtracts', 'tests/t.py::test_x', 'TestY', 'z::w'])
})

test('41 test command and runner detection', () => {
  for (const c of ['npx jest src', 'npm test', 'pnpm run test:unit', 'pytest -x', 'python -m pytest', 'go test ./...', 'cargo test foo', 'vitest run', 'yarn test']) {
    expect(isTestCommand(c)).toBe(true)
  }
  for (const c of ['ls', 'git status', 'npm install', 'cat test.txt']) {
    expect(isTestCommand(c)).toBe(false)
  }
  expect(runnerOf('npx vitest run')).toBe('vitest')
  expect(runnerOf('npm test', 'Tests:       1 failed')).toBe('jest')
  expect(runnerOf('npm test', ' Test Files  1 failed')).toBe('vitest')
  expect(runnerOf('make test', '')).toBe('other')
})

test('41 focus command per runner and the prompt', () => {
  expect(focusCommand('npx jest', 'jest', ['math › adds (x)', 'math › sub'])).toBe("npx jest -t 'adds \\(x\\)|sub'")
  expect(focusCommand('npm test', 'jest', ['a › b'])).toBe("npm test -- -t 'b'")
  expect(focusCommand("npx vitest run -t 'old'", 'vitest', ['f.ts > a > b'])).toBe("npx vitest run -t 'b'")
  expect(focusCommand('python -m pytest -x tests', 'pytest', ['t/a.py::test_one'])).toBe("python -m pytest 't/a.py::test_one'")
  expect(focusCommand('go test ./...', 'go', ['TestAdd', 'TestAdd/neg'])).toBe("go test ./... -run '^(TestAdd)$'")
  expect(focusCommand('cargo test', 'cargo', ['a::b'])).toBe("cargo test 'a::b'")
  expect(focusCommand('make test', 'other', ['x'])).toBe('')
  expect(focusCommand('npx jest', 'jest', [])).toBe('')
  expect(focusPrompt(undefined)).toBe('')
  expect(focusPrompt(run({ failed: ['a › b'], nFailed: 1, isGreen: false }))).toMatch(/Re-run only the failing tests[\s\S]*- a › b[\s\S]*Suggested command: npx jest -t 'b'/)
})

test('42 bisect arguments and guide', () => {
  expect(parseBisectArgs('')).toEqual({ good: '', bad: 'HEAD', msg: '' })
  expect(parseBisectArgs('v1.2 main')).toEqual({ good: 'v1.2', bad: 'main', msg: '' })
  expect(parseBisectArgs('a b c').msg).toMatch(/Usage/)
  expect(parseBisectArgs('--exec=x').msg).toMatch(/Refs may only/)
  expect(parseBisectArgs('a;ls b').msg).toMatch(/Refs may only/)
  const guide = bisectGuide('v1', 'HEAD', 'npm test')
  expect(guide).toMatch(/git bisect start/)
  expect(guide).toMatch(/git bisect good v1/)
  expect(guide).toMatch(/git bisect reset/)
  expect(guide).toMatch(/nothing is run for you/)
})

test('43 stack traces: javascript, python, java, go, rust', () => {
  const js = [
    'TypeError: Cannot read properties of undefined (reading "x")',
    '    at foo (/app/src/a.ts:10:5)',
    '    at Object.<anonymous> (/app/node_modules/lib/index.js:3:1)',
    '    at /app/src/b.ts:20:9',
    '    at node:internal/modules/cjs/loader:1105:14',
  ].join('\n')
  const t = parseStack(js)
  expect(t?.kind).toBe('javascript')
  expect(t?.message).toMatch(/^TypeError: Cannot read/)
  expect(t?.frames.length).toBe(4)
  expect(topAppFrames(t?.frames ?? []).map(f => `${f.file}:${f.line}`)).toEqual(['/app/src/a.ts:10', '/app/src/b.ts:20'])

  const py = [
    'Traceback (most recent call last):',
    '  File "/app/main.py", line 5, in <module>',
    '    run()',
    '  File "/usr/lib/python3.11/site-packages/x.py", line 9, in run',
    '    boom()',
    'ValueError: bad input',
  ].join('\n')
  const p = parseStack(py)
  expect(p?.kind).toBe('python')
  expect(p?.message).toBe('ValueError: bad input')
  expect(p?.frames[0]?.file).toMatch(/site-packages/)
  expect(topAppFrames(p?.frames ?? [])[0]?.file).toBe('/app/main.py')

  const java = [
    'Exception in thread "main" java.lang.NullPointerException',
    '\tat com.acme.Svc.run(Svc.java:42)',
    '\tat java.lang.Thread.run(Thread.java:833)',
    '\tat com.acme.Main.main(Main.java:7)',
  ].join('\n')
  const jv = parseStack(java)
  expect(jv?.kind).toBe('java')
  expect(topAppFrames(jv?.frames ?? []).map(f => f.file)).toEqual(['Svc.java', 'Main.java'])

  const go = ['panic: boom', 'goroutine 1 [running]:', 'main.f()', '\t/app/main.go:12 +0x1d', 'main.main()', '\t/app/main.go:5 +0x14'].join('\n')
  const g = parseStack(go)
  expect(g?.kind).toBe('go')
  expect(g?.message).toBe('panic: boom')
  expect(g?.frames[0]).toMatchObject({ file: '/app/main.go', line: 12, fn: 'main.f' })

  const rs = [`thread 'main' panicked at src/main.rs:3:5:`, 'boom', '   --> src/main.rs:3:5', '   --> src/lib.rs:9:1'].join('\n')
  expect(parseStack(rs)?.kind).toBe('rust')

  expect(parseStack('just some output\nno frames')).toBeNull()
  expect(parseStack('    at foo (/a.ts:1:1)')).toBeNull()
})

test('51 outcome and output of a tool result', () => {
  expect(outcomeOf({ text: 'fine' }, false)).toBe('ok')
  expect(outcomeOf({ isError: true, text: 'x' }, false)).toBe('fail')
  expect(outcomeOf({ deny: 'no' }, false)).toBe('denied')
  expect(outcomeOf({ text: 'Exit code 2\nboom' }, false)).toBe('fail')
  expect(outcomeOf(undefined, true)).toBe('fail')
  expect(outputOf({ text: 'a' })).toBe('a')
  expect(outputOf({ result: { stdout: 'o', stderr: 'e' } })).toBe('o\ne')
  expect(outputOf(null)).toBe('')
})

test('45 flaky: failed then passed with no edit between; with an edit it is a fix', () => {
  const runs = [
    run({ failed: ['m › a'], isGreen: false, nFailed: 1, edits: 0 }),
    run({ passed: ['a'], edits: 0 }),
    run({ failed: ['m › b'], isGreen: false, nFailed: 1, edits: 0 }),
    run({ isGreen: true, edits: 2 }),
  ]
  const t = flakyTally(runs)
  expect(t.flaky).toEqual([{ name: 'a', flips: 1 }])
  expect(t.fixed).toBe(1)
  expect(flakyTally([]).flaky).toEqual([])
  const t2 = flakyTally([run({ failed: ['x'], isGreen: false }), run({ failed: ['x'], isGreen: false }), run({ isGreen: true })])
  expect(t2.flaky).toEqual([{ name: 'x', flips: 1 }])
  const t3 = flakyTally([run({ failed: ['x'], isGreen: false }), run({ cmd: 'pytest', isGreen: true })])
  expect(t3.flaky).toEqual([])
})

test('46 coverage lines and per-run delta', () => {
  expect(parseCoverage('All files          |    83.4 |     70 |')).toBe(83.4)
  expect(parseCoverage('Statements   : 91.2% ( 10/11 )')).toBe(91.2)
  expect(parseCoverage('TOTAL      120     10    92%')).toBe(92)
  expect(parseCoverage('coverage: 55.5% of statements\nok\ncoverage: 60.0% of statements')).toBe(60)
  expect(parseCoverage('nothing here')).toBeNull()
  const rows = coverageRows([run({ cov: 80 }), run({ cov: null }), run({ cov: 83.4 }), run({ cov: 82 })])
  expect(rows.map(r => r.delta)).toEqual([null, 3.4, -1.4])
})

test('47 timings from jest, vitest, pytest and go, ranked', () => {
  const t = parseTimings(
    ['  ✓ slow one (1200 ms)', '  ✓ fast 3ms', ' ✓ src/a.test.ts (3 tests) 45ms', '0.52s call     tests/test_a.py::test_x', '0.01s setup    tests/test_a.py::test_x', '--- PASS: TestY (2.50s)'].join('\n'),
  )
  expect(t[0]).toEqual({ name: 'TestY', ms: 2500 })
  expect(t.find(x => x.name === 'slow one')?.ms).toBe(1200)
  expect(t.find(x => x.name === 'tests/test_a.py::test_x')?.ms).toBe(520)
  expect(t.find(x => x.name === 'fast')?.ms).toBe(3)
  expect(rankSlowest(t, 2).map(x => x.name)).toEqual(['TestY', 'slow one'])
  expect(parseTimings('no durations')).toEqual([])
})

test('49 error normalisation and clustering', () => {
  expect(normaliseError("Exit code 1\nError: ENOENT: no such file or directory, open '/tmp/a/123.txt'")).toBe('error: enoent: no such file or directory, open <str>')
  expect(normaliseError('Error: timeout after 3000ms at 0xDEADBEEF')).toBe('error: timeout after Nms at <hex>')
  expect(normaliseError('failed at /Users/x/app/file.ts:12 request 550e8400-e29b-41d4-a716-446655440000')).toBe('failed at <path>:N request <id>')
  expect(normaliseError('')).toBe('')
  let list = addCluster([], 'Exit code 1\nError: cannot find module "a"', 'Bash', 1)
  list = addCluster(list, 'Error: cannot find module "b"', 'Bash', 2)
  list = addCluster(list, 'Error: other thing 5', 'Read', 3)
  expect(list.length).toBe(2)
  expect(list[0]?.count).toBe(2)
  expect(list[0]?.lastAt).toBe(2)
  expect(addCluster([], '', 'Bash', 1)).toEqual([])
})

test('50 hypothesis commands', () => {
  expect(parseHypArgs('')).toEqual({ kind: 'list' })
  expect(parseHypArgs('cache is stale')).toEqual({ kind: 'add', text: 'cache is stale' })
  expect(parseHypArgs('ok 3')).toEqual({ kind: 'mark', n: 3, status: 'ok' })
  expect(parseHypArgs('no 12')).toEqual({ kind: 'mark', n: 12, status: 'no' })
  expect(parseHypArgs('rm 1')).toEqual({ kind: 'mark', n: 1, status: 'rm' })
  expect(parseHypArgs('ok').kind).toBe('bad')
  expect(parseHypArgs('no 0').kind).toBe('bad')
  expect(parseHypArgs('no it is the cache')).toEqual({ kind: 'add', text: 'no it is the cache' })
  expect(parseHypArgs('token=abc123456789012 leaks')).toEqual({ kind: 'add', text: 'token=[hidden] leaks' })
})

test('52 version allowlist', () => {
  expect(isAllowedVersionArgv(['node', '--version'])).toBe(true)
  expect(isAllowedVersionArgv(['git', '--version'])).toBe(true)
  expect(isAllowedVersionArgv(['node', '-e', 'x'])).toBe(false)
  expect(isAllowedVersionArgv(['curl', '--version'])).toBe(false)
  expect(isAllowedVersionArgv(['node'])).toBe(false)
  expect(isAllowedVersionArgv(['git', '--version', 'x'])).toBe(false)
})

test('54 and 59 recovery, crash loop and the toast gate', () => {
  const hist = [
    { sig: 'make', isOk: false, at: 1000 },
    { sig: 'other', isOk: true, at: 1500 },
  ]
  expect(isRecovery(hist, 'make', 2000)).toBe(true)
  expect(isRecovery(hist, 'other', 2000)).toBe(false)
  expect(isRecovery(hist, 'new', 2000)).toBe(false)
  expect(isRecovery(hist, 'make', 1000 + 31 * 60 * 1000)).toBe(false)
  expect(isRecovery([...hist, { sig: 'make', isOk: true, at: 1800 }], 'make', 2000)).toBe(false)
  const loop = [1000, 30_000, 60_000].map(at => ({ sig: 'npm test', isOk: false, at }))
  expect(failCount(loop, 'npm test', 70_000)).toBe(3)
  expect(isLoop(loop, 'npm test', 70_000)).toBe(true)
  expect(isLoop(loop, 'npm test', 70_000 + 120_000)).toBe(false)
  expect(isLoop(loop.slice(1), 'npm test', 70_000)).toBe(false)
  expect(isGateOpen(0, 5)).toBe(true)
  expect(isGateOpen(1000, 1000 + 179_999)).toBe(false)
  expect(isGateOpen(1000, 1000 + 180_000)).toBe(true)
})

test('56 mock scan across jest, vitest, python', () => {
  const js = ["jest.mock('../db')", 'const send = jest.fn()', "vi.spyOn(api, 'get')", 'const g = vi.fn(() => 1)', "sinon.stub(clock, 'tick')"].join('\n')
  const hits = scanMocks(js)
  expect(hits.map(h => `${h.kind}:${h.name}`)).toEqual(['module:../db', 'fn:send', 'spy:api.get', 'fn:g', 'sinon:clock.tick'])
  expect(hits[0]?.line).toBe(1)
  const py = ['@patch("app.svc.send")', '@mock.patch.object(Client, "get")', 'm = MagicMock()', 'with patch("a.b") as p:'].join('\n')
  expect(scanMocks(py).map(h => `${h.kind}:${h.name}`)).toEqual(['patch:app.svc.send', 'patch:Client.get', 'mock:m', 'patch:a.b'])
  expect(scanMocks('const x = 1')).toEqual([])
  expect(isTestFile('src/a.test.ts')).toBe(true)
  expect(isTestFile('tests/test_a.py')).toBe(true)
  expect(isTestFile('pkg/a_test.go')).toBe(true)
  expect(isTestFile('src/a.ts')).toBe(false)
})

test('57 snapshot summaries', () => {
  const jest = parseSnapshots('Snapshots:   1 obsolete, 2 written, 3 passed, 6 total\n › 1 snapshot obsolete from 1 test suite.')
  expect(jest?.counts).toMatchObject({ obsolete: 1, written: 2, passed: 3 })
  expect(parseSnapshots(' Snapshots  1 obsolete | 1 written')?.counts).toMatchObject({ obsolete: 1, written: 1 })
  expect(parseSnapshots('2 snapshots updated')?.counts.updated).toBe(2)
  expect(parseSnapshots('3 snapshots passed. 1 snapshot unused.')?.counts).toMatchObject({ passed: 3 })
  expect(parseSnapshots('nothing')).toBeNull()
})

test('58 port validation and lsof parsing', () => {
  expect(validPort('8080')).toBe(8080)
  expect(validPort(' 1 ')).toBe(1)
  expect(validPort('65535')).toBe(65535)
  for (const bad of ['0', '65536', '-1', '1.5', 'abc', '', '80 ; ls', '0x50', '+80', '123456']) {
    expect(validPort(bad)).toBeNull()
  }
  expect(portArgv(3000)).toEqual(['lsof', '-nP', '-i', ':3000'])
  const out = 'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnode    123 me   20u  IPv4 0x1      0t0  TCP *:3000 (LISTEN)\n'
  expect(parseLsof(out)).toEqual(['node  pid 123  me  TCP *:3000 (LISTEN)'])
  expect(parseLsof('')).toEqual([])
})

test('48 tail path checks and line cutting', () => {
  expect(checkTailPath('logs/app.log')).toEqual({ path: 'logs/app.log', error: '' })
  expect(checkTailPath("'/var/log/x.log'").path).toBe('/var/log/x.log')
  expect(checkTailPath('').error).toMatch(/Usage/)
  expect(checkTailPath('/home/u/.ssh/config').path).toBe('')
  expect(checkTailPath('.env').path).toBe('')
  expect(checkTailPath('cfg/.env.local').path).toBe('')
  expect(checkTailPath('keys/id_ed25519').path).toBe('')
  expect(checkTailPath('a\nb').path).toBe('')
  expect(tailLines('cut\none\ntwo\n', true)).toEqual(['one', 'two'])
  expect(tailLines('one\ntwo\n', false)).toEqual(['one', 'two'])
  expect(tailLines('a\nb\nc', false, 2)).toEqual(['b', 'c'])
  expect(tailLines('token=abcdefghijklmnop', false)).toEqual(['token=[hidden]'])
})

test('redaction', () => {
  expect(redact('curl -H "Authorization: Bearer abcdefghijklmnopqrst"')).toMatch(/Bearer \[secret\]/)
  expect(redact('export API_KEY=abcd1234')).toMatch(/\[hidden\]/)
  expect(redact('--password hunter2 run')).toBe('--password [hidden] run')
  expect(redact('key sk-abcdefghijklmnop12')).toBe('key [secret]')
  expect(redact('ls -la')).toBe('ls -la')
})

test('60 postmortem is markdown built from the data', () => {
  const md = buildPostmortem({
    crumbs: [
      { id: '1', n: 1, tool: 'Bash', detail: 'npm test', outcome: 'fail', at: 1 },
      { id: '2', n: 2, tool: 'Edit', detail: 'a.ts', outcome: 'ok', at: 2 },
    ],
    hyps: [
      { n: 1, text: 'stale cache', status: 'no', at: 1 },
      { n: 2, text: 'off by one', status: 'ok', at: 2 },
    ],
    clusters: [{ key: 'k', count: 3, sample: 'Error: boom', tools: ['Bash'], lastAt: 1 }],
    trace: null,
    runs: [run({ isGreen: false, failed: ['a'], nFailed: 1 })],
  })
  expect(md).toMatch(/^# Debugging postmortem/)
  expect(md).toMatch(/2 steps tried, 1 failed/)
  expect(md).toMatch(/Cause: off by one/)
  expect(md).toMatch(/- \[-\] stale cache \(ruled out\)/)
  expect(md).toMatch(/- \[x\] off by one/)
  expect(md).toMatch(/x3 Error: boom/)
  expect(md).toMatch(/1 failing/)
})
