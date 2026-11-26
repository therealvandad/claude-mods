import { expect, test } from 'claude-code/testing'

import {
  attachFix,
  avoidPrompt,
  bump,
  classifyPaste,
  commandKey,
  compressRows,
  errorLine,
  errorSignature,
  explainPrompt,
  failingName,
  findFiles,
  findFixes,
  fuzzyScore,
  guessSituation,
  handoffText,
  hasSecret,
  helpReport,
  isStuck,
  kindOfTool,
  maskSecrets,
  nextChips,
  noteError,
  openFailures,
  ordinal,
  outputText,
  pickCoach,
  postflight,
  preflight,
  readMinutes,
  readModes,
  recallAdd,
  recallFind,
  recapPrompt,
  retryPrompt,
  skimPoints,
  touch,
  trackRun,
  unstickPrompt,
  DEFAULT_MODES,
} from './pure'
import type { CallRec } from '../types'

const call = (over: Partial<CallRec>): CallRec => ({
  id: 'x',
  tool: 'Bash',
  kind: 'bash',
  key: 'k',
  label: 'ls',
  isErr: false,
  line: '',
  size: 10,
  at: 1,
  turn: 1,
  file: '',
  ...over,
})

test('next steps: failing test, edits without tests, uncommitted edits, in that order and at most three', async () => {
  const failed = nextChips([call({ kind: 'test', isErr: true, line: 'math adds numbers', label: 'npm test' })], 1)
  expect(failed.map(c => c.label)).toEqual(['fix the failing test'])
  expect(failed[0]?.text).toBe('Fix the failing test: math adds numbers')

  const edited = nextChips([call({ kind: 'edit', tool: 'Edit', file: 'a.ts' })], 1)
  expect(edited.map(c => c.label)).toEqual(['run the tests', 'commit'])

  const tested = nextChips([call({ kind: 'edit' }), call({ kind: 'test', label: 'npm test' })], 1)
  expect(tested.map(c => c.label)).toEqual(['commit'])

  const committed = nextChips([call({ kind: 'edit', turn: 1 }), call({ kind: 'test', turn: 1 }), call({ kind: 'commit', turn: 1 })], 1)
  expect(committed).toEqual([])

  const both = nextChips([call({ kind: 'edit' }), call({ kind: 'test', isErr: true, line: 'x' })], 1)
  expect(both.map(c => c.label)).toEqual(['fix the failing test'])

  // Edits of an earlier turn do not ask for tests now, but they are still uncommitted.
  const older = nextChips([call({ kind: 'edit', turn: 1 })], 2)
  expect(older.map(c => c.label)).toEqual(['commit'])

  expect(nextChips([], 1)).toEqual([])
  expect(nextChips([call({ isErr: true, line: 'boom' })], 1).map(c => c.label)).toEqual(['explain the last error'])
})

test('tool kinds and keys', async () => {
  expect(kindOfTool('Bash', 'npm test')).toBe('test')
  expect(kindOfTool('Bash', 'pnpm run test:unit')).toBe('test')
  expect(kindOfTool('Bash', 'pytest -x')).toBe('test')
  expect(kindOfTool('Bash', 'git commit -m "x"')).toBe('commit')
  expect(kindOfTool('Bash', 'ls')).toBe('bash')
  expect(kindOfTool('Edit', '')).toBe('edit')
  expect(kindOfTool('Read', '')).toBe('read')
  expect(kindOfTool('Grep', '')).toBe('other')
  expect(commandKey('Bash', 'npm   test', '')).toBe('npm test')
  expect(commandKey('Edit', '', '/a/b.ts')).toBe('Edit /a/b.ts')
})

test('stuck: three different failures in a row; a success or a repeat does not count', async () => {
  let run: string[] = []
  run = trackRun(run, 'a', true)
  run = trackRun(run, 'a', true)
  run = trackRun(run, 'a', true)
  expect(isStuck(run)).toBe(false)
  run = trackRun(run, 'b', true)
  expect(isStuck(run)).toBe(false)
  run = trackRun(run, 'c', true)
  expect(isStuck(run)).toBe(true)
  expect(trackRun(run, 'ok', false)).toEqual([])
  expect(unstickPrompt(['npm test: fail', 'ls: no such file'])).toContain('- ls: no such file')
  expect(unstickPrompt([])).toContain('(see the transcript)')
})

test('retry prompt with and without a change', async () => {
  expect(retryPrompt('npm test', 'a longer timeout')).toEqual({ text: 'Retry the last failed command (`npm test`) with a longer timeout', cursor: 64 })
  const blank = retryPrompt('npm test', '')
  expect(blank.text).toBe('Retry the last failed command (`npm test`) with ___')
  expect(blank.text.slice(blank.cursor)).toBe('___')
})

test('open failures are failures with no later success of the same call', async () => {
  const rows = [call({ key: 'a', isErr: true }), call({ key: 'b', isErr: true }), call({ key: 'a', isErr: false })]
  expect(openFailures(rows).map(c => c.key)).toEqual(['b'])
})

test('errors: signature ignores paths, numbers, quotes; the line is the one that says error', async () => {
  const a = errorSignature("Error: ENOENT: no such file or directory, open '/Users/me/app/a.txt'\n  at foo")
  const b = errorSignature("Error: ENOENT: no such file or directory, open '/tmp/other/b.txt'")
  expect(a).toBe(b)
  expect(errorSignature('x.ts(3,4): error TS2322: Type 5 is bad')).toBe(errorSignature('y.ts(9,1): error TS2322: Type 77 is bad'))
  expect(errorLine('\u001b[31mwarn: x\u001b[0m\nfatal: not a git repository')).toBe('fatal: not a git repository')
  expect(errorSignature('')).toBe('')
  expect(failingName('FAILED tests/test_a.py::test_one - boom')).toBe('tests/test_a.py::test_one')
  expect(failingName('--- FAIL: TestAdd (0.00s)')).toBe('TestAdd')
  expect(failingName('all good')).toBe('')
})

test('secrets are masked in commands and text', async () => {
  expect(maskSecrets('curl -H "Authorization: Bearer abcdefghijklmnop" https://x')).not.toContain('abcdefghijklmnop')
  expect(maskSecrets('API_KEY=sk-abcdefghijklmnopqrstuvwx npm start')).toBe('API_KEY=*** npm start')
  expect(maskSecrets('mysql --password hunter2 -u me')).toBe('mysql --password *** -u me')
  expect(maskSecrets('git clone https://user:pw123@github.com/a/b')).toBe('git clone https://user:***@github.com/a/b')
  expect(maskSecrets('token ghp_abcdefghijklmnopqrstuv')).toBe('token ***')
  expect(maskSecrets('ls -la')).toBe('ls -la')
  expect(hasSecret('export SECRET=abc')).toBe(true)
  expect(hasSecret('echo hello')).toBe(false)
})

test('output text reads strings, stderr and stdout, and other shapes', async () => {
  expect(outputText('plain')).toBe('plain')
  expect(outputText({ stdout: 'out', stderr: 'err' })).toBe('err\nout')
  expect(outputText({ n: 1 })).toBe('{"n":1}')
  expect(outputText(undefined)).toBe('')
  const p = explainPrompt('Bash', { command: 'npm run build --token abc123' }, { stderr: 'boom: failed', stdout: '' })
  expect(p).toContain('This command failed: `npm run build --token ***`')
  expect(p).toContain('boom: failed')
  expect(p).not.toContain('abc123')
})

test('compressor ranks by size and counts re-reads', async () => {
  const rows = compressRows([
    call({ kind: 'read', tool: 'Read', file: '/a.ts', label: 'Read /a.ts', size: 9000 }),
    call({ kind: 'read', tool: 'Read', file: '/a.ts', label: 'Read /a.ts', size: 8000 }),
    call({ label: 'ls', size: 50 }),
    call({ label: 'empty', size: 0 }),
  ])
  expect(rows.map(r => r.size)).toEqual([9000, 8000, 50])
  expect(rows[0]?.times).toBe(2)
  expect(avoidPrompt(rows)).toContain('Avoid re-reading /a.ts, /a.ts')
})

test('smart paste recognises a stack trace, log lines, JSON and a diff', async () => {
  expect(classifyPaste('Error: boom\n    at foo (/a/b.js:3:4)\n    at bar (/a/c.js:9:1)')?.kind).toBe('stack trace')
  expect(classifyPaste('Traceback (most recent call last):\n  File "a.py", line 3, in x\n  File "b.py", line 4, in y\nValueError')?.kind).toBe('stack trace')
  expect(classifyPaste('2026-01-02 10:00:00 INFO start\n2026-01-02 10:00:01 WARN slow\n2026-01-02 10:00:02 ERROR bad')?.kind).toBe('log lines')
  expect(classifyPaste('{"a": 1, "b": [1, 2, 3], "name": "something long"}')?.kind).toBe('JSON')
  expect(classifyPaste('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')?.kind).toBe('diff')
  expect(classifyPaste('{ not json at all and long enough to be considered }')).toBeNull()
  expect(classifyPaste('just a sentence')).toBeNull()
  expect(classifyPaste('just a plain sentence that is quite long but has nothing special in it')).toBeNull()
})

test('file finder: subsequence match, basename first, no match scores zero', async () => {
  expect(fuzzyScore('rt', '/src/router.ts')).toBeGreaterThan(0)
  expect(fuzzyScore('zzz', '/src/router.ts')).toBe(0)
  expect(fuzzyScore('', '/src/router.ts')).toBe(1)
  const rows = ['/src/router.ts', '/src/rate/test.ts', '/docs/readme.md'].reduce((acc, p, i) => touch(acc, p, 'read', i), [] as ReturnType<typeof touch>)
  expect(findFiles(rows, 'router')[0]?.path).toBe('/src/router.ts')
  expect(findFiles(rows, 'qqq')).toEqual([])
  expect(findFiles(rows, '').length).toBe(3)
  const twice = touch(touch([], '/a', 'read', 1), '/a', 'edit', 2)
  expect(twice).toEqual([{ path: '/a', reads: 1, edits: 1, at: 2 }])
})

test('recall: masked, deduped, bounded to 300, searchable by every word', async () => {
  let rows = recallAdd([], 'npm test -- --token abcdefgh1234', 1)
  expect(rows[0]?.c).toBe('npm test -- --token ***')
  rows = recallAdd(rows, 'ls -la', 2)
  rows = recallAdd(rows, 'npm test -- --token abcdefgh1234', 3)
  expect(rows.map(r => r.c)).toEqual(['ls -la', 'npm test -- --token ***'])
  expect(recallFind(rows, 'npm test').length).toBe(1)
  expect(recallFind(rows, 'npm ls')).toEqual([])
  let many: ReturnType<typeof recallAdd> = []
  for (let i = 0; i < 350; i += 1) {
    many = recallAdd(many, `cmd ${i}`, i)
  }
  expect(many.length).toBe(300)
  expect(many[0]?.c).toBe('cmd 50')
  expect(recallAdd(many, '   ', 1).length).toBe(300)
})

test('recap, pre-flight and post-flight prompts', async () => {
  const text = recapPrompt([{ text: 'first', at: 1 }, { text: 'second', at: 2 }], ['npm test: failed'])
  expect(text.startsWith('Summarize where we left off.')).toBe(true)
  expect(text).toContain('1. first')
  expect(text).toContain('- npm test: failed')
  expect(recapPrompt([], [])).toContain('single next step')
  expect(preflight('split the router')).toContain('Before we start "split the router"')
  expect(preflight('')).toContain('Scope:')
  expect(postflight('x')).toContain('Tests: run them')
  expect(postflight('x')).toContain('Commit: propose')
})

test('bug report and handoff texts', async () => {
  const errs = noteError([], { sig: 'enoent', last: 5, tool: 'Bash', cmd: 'cat x', sample: 'ENOENT x' }, 5)
  const r = helpReport(errs, [call({ label: 'cat x', isErr: true })], 1_700_000_000_000)
  expect(r).toContain('Bug report (draft, not sent anywhere)')
  expect(r).toContain('- enoent (x1')
  expect(r).toContain('[failed] cat x')
  expect(helpReport([], [], 0)).toContain('No errors were recorded')
  const h = handoffText([{ text: 'do it', at: 1 }], ['use sqlite'], [{ path: '/a.ts', reads: 0, edits: 2, at: 1 }, { path: '/b.ts', reads: 3, edits: 0, at: 1 }], [call({ isErr: true, label: 'npm test', line: 'fail' })])
  expect(h).toContain('- do it')
  expect(h).toContain('- use sqlite')
  expect(h).toContain('- /a.ts (2 edits)')
  expect(h).not.toContain('/b.ts')
  expect(h).toContain('- npm test: fail')
})

test('reading time only over 400 words', async () => {
  expect(readMinutes('word '.repeat(400))).toBeNull()
  expect(readMinutes('word '.repeat(401))).toBe(2)
  expect(readMinutes('word '.repeat(2200))).toBe(10)
})

test('skim takes the first sentence of each paragraph and leaves code out', async () => {
  const text = ['# A longer title here', '', 'First point is this. More detail follows after it.', '', '```ts', 'const a = 1', '```', '', '- A bullet that explains something. And another.', '', 'ok'].join('\n')
  expect(skimPoints(text)).toEqual(['A longer title here', 'First point is this.', 'A bullet that explains something.'])
  expect(skimPoints('')).toEqual([])
  expect(skimPoints(Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} says something.`).join('\n\n')).length).toBe(8)
})

test('question bank guess', async () => {
  expect(guessSituation([], true)).toBe('stuck')
  expect(guessSituation([call({ isErr: true })], false)).toBe('error')
  expect(guessSituation([call({ kind: 'edit' })], false)).toBe('edited')
  expect(guessSituation([], false)).toBe('unclear')
})

test('coach picks an unused command, once a day, rotating', async () => {
  const first = pickCoach({}, 0)
  expect(first?.[0].startsWith('/')).toBe(true)
  expect(pickCoach({}, 1)?.[0]).not.toBe(first?.[0])
  const used: Record<string, number> = {}
  for (const name of ['aspre', 'asunstick', 'asrecall', 'asfind', 'ascompress', 'asskim', 'ashandoff', 'asfix', 'aspost', 'pmtpl', 'pmsum']) {
    used[name] = 1
  }
  expect(pickCoach(used, 3)).toBeUndefined()
  expect(pickCoach({ ...used, aspre: 0 }, 3)?.[0]).toBe('/aspre')
  expect(bump({ a: 1 }, 'a')).toEqual({ a: 2 })
  let u: Record<string, number> = {}
  for (let i = 0; i < 150; i += 1) {
    u = bump(u, `c${i}`)
  }
  expect(Object.keys(u).length).toBeLessThanOrEqual(120)
})

test('museum counts repeats and keeps the fix; fixes are searchable', async () => {
  let rows = noteError([], { sig: 'a', last: 1, tool: 'Bash', cmd: '', sample: 's' }, 1)
  rows = noteError(rows, { sig: 'b', last: 2, tool: 'Bash', cmd: '', sample: 's' }, 2)
  rows = attachFix(rows, 'a', 'restart the server')
  rows = noteError(rows, { sig: 'a', last: 3, tool: 'Bash', cmd: '', sample: 's' }, 3)
  const a = rows.find(r => r.sig === 'a')
  expect(a?.count).toBe(2)
  expect(a?.first).toBe(1)
  expect(a?.fix).toBe('restart the server')
  let many: typeof rows = []
  for (let i = 0; i < 80; i += 1) {
    many = noteError(many, { sig: `s${i}`, last: i, tool: 'Bash', cmd: '', sample: '' }, i)
  }
  expect(many.length).toBe(50)
  const fixes = [
    { n: 1, sig: 'enoent', text: 'create the folder first', sample: '', at: 1 },
    { n: 2, sig: 'port in use', text: 'kill the old server', sample: '', at: 2 },
  ]
  expect(findFixes(fixes, 'server').map(f => f.n)).toEqual([2])
  expect(findFixes(fixes, 'enoent folder').map(f => f.n)).toEqual([1])
  expect(findFixes(fixes, '').map(f => f.n)).toEqual([2, 1])
  expect(ordinal(1)).toBe('1st')
  expect(ordinal(12)).toBe('12th')
})

test('modes read from the store fall back to the defaults', async () => {
  expect(readModes(undefined)).toEqual(DEFAULT_MODES)
  expect(readModes({ next: true, paste: 'x' })).toEqual({ ...DEFAULT_MODES, next: true })
  expect(DEFAULT_MODES.next).toBe(false)
  expect(DEFAULT_MODES.read).toBe(false)
})
