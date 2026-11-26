import { expect, test } from 'claude-code/testing'

import { cleanHist, cleanMeet, cleanProjs, cleanRuns, cleanSnips } from './clean'
import {
  filterLog, guessLanguages, guessLicense, hygiene, isSecretLikePath, licenseFromPackageJson, licenseFromToml, maskSecrets, parseBranchRows, parseDf, parseDu, parseLsof,
  parseNpmOutdated, parsePipOutdated, parsePs, restorePlan, scanTodos, scoreRepo, statusCounts, tailLines, topByCpu, bumpKind, cleanOverrides, diskLines, portLines, procLines, logLines, todoLines, fmtAge,
} from './parse'
import {
  addBuild, addCmd, addCov, addDistraction, addErrors, addRun, addSnippet, buildKey, buildLines, buildStats, cmdKey, errorClusterLines, errorLines, fenced, findSnippet, flakyLines, histLines,
  normalizeError, parseCoverage, parseTests, recordTool, runStats, searchCmds, testLines, updateFlaky, MAX_HIST, MAX_BUILDS, MAX_RUNS, distractLines,
} from './runs'
import type { Flaky, TestRun } from './runs'
import { testsAlt, testsSvg } from './svg'

// ------------------------------------------------------------------ secrets

test('maskSecrets hides known key shapes', () => {
  const fake = (s: string) => s
  const cases: [string, RegExp][] = [
    [`export OPENAI_API_KEY=${fake('sk-proj-abcdefghijklmnopqrstuvwx')}`, /OPENAI_API_KEY=\[secret\]/],
    [`curl -H "Authorization: Bearer ${fake('abcdef1234567890abcdef')}" https://x.test`, /Authorization: \[secret\]/],
    [`git clone https://user:${fake('hunter2hunter2')}@github.com/a/b.git`, /https:\/\/\[user\]:\[secret\]@github\.com/],
    [`token ${fake('ghp_abcdefghijklmnopqrstuvwxyz0123456789')} used`, /\[github token\]/],
    [`${fake('AKIA')}${fake('ABCDEFGHIJKLMNOP')} in env`, /\[aws key\]/],
    [`xoxb-${fake('1234567890-abcdefghij')}`, /\[slack token\]/],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk end', /\[jwt\]/],
    ['mysql --password=correcthorse -u root', /--password=\[secret\]|--password \[secret\]/],
    ['tool --token abc123def456 run', /--token \[secret\]/],
    ['DB_PASSWORD="my secret pass" npm start', /DB_PASSWORD=\[secret\]/],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----', /\[private key\]/],
  ]

  for (const [input, re] of cases) {
    const out = maskSecrets(input)

    expect(out).toMatch(re)
    expect(out).not.toMatch(/hunter2hunter2|abcdef1234567890abcdef|correcthorse|abc123def456|my secret pass|MIIBOgIBAAJBAK|1234567890-abcdefghij/)
  }
})

test('maskSecrets leaves ordinary commands alone', () => {
  for (const s of ['npm run build', 'git commit -m "fix: token refresh"', 'ls -la src/components', 'echo hello world', 'pytest tests/test_auth.py -k login', 'sort --key 2 file.txt', 'grep -rn "secretary" docs']) {
    expect(maskSecrets(s)).toBe(s)
  }
})

test('maskSecrets hides long random-looking runs and 40 hex digit hashes', () => {
  expect(maskSecrets('curl x/Zm9vYmFyMTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1OT1BRUg')).toMatch(/\[secret\]/)
  expect(maskSecrets('built 0123456789abcdef0123456789abcdef01234567')).toMatch(/\[hash\]/)
  expect(maskSecrets('abc')).toBe('abc')
})

// ------------------------------------------------------------------ ports and processes

const LSOF = `COMMAND     PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
rapportd    612 devuser    8u  IPv4 0x6f5e9d1c2a3b4c5d      0t0  TCP *:49152 (LISTEN)
rapportd    612 devuser    9u  IPv6 0x6f5e9d1c2a3b4c5e      0t0  TCP *:49152 (LISTEN)
node      12345 devuser   23u  IPv4 0x1234567890abcdef      0t0  TCP 127.0.0.1:3000 (LISTEN)
node      12345 devuser   24u  IPv6 0x1234567890abcdee      0t0  TCP [::1]:3000 (LISTEN)
Google\\x20Chrome  777 devuser   44u  IPv6 0xabcdefabcdefabcd      0t0  TCP [::1]:9222 (LISTEN)
postgres   4021 devuser    7u  IPv4 0xfeedfeedfeedfeed      0t0  TCP 0.0.0.0:5432 (LISTEN)
ControlCe  1011 devuser   10u  IPv4 0xdeadbeefdeadbeef      0t0  TCP *:7000 (LISTEN)
garbage line that is not lsof
`

test('lsof output parses to ports sorted by number, with the program name unescaped', () => {
  const ports = parseLsof(LSOF)

  expect(ports.map(p => p.port)).toEqual([3000, 3000, 5432, 7000, 9222, 49152])
  expect(ports.find(p => p.port === 9222)?.cmd).toBe('Google Chrome')
  expect(ports.find(p => p.port === 5432)).toMatchObject({ pid: 4021, host: '0.0.0.0', isOpen: true, user: 'devuser' })
  expect(ports.find(p => p.port === 3000 && p.host === '127.0.0.1')?.isOpen).toBe(false)
  expect(ports.find(p => p.port === 7000)?.isOpen).toBe(true)
})

test('lsof parsing drops duplicate rows and rows with a bad port, and copes with empty output', () => {
  expect(parseLsof(`${LSOF}${LSOF}`).length).toBe(6)
  expect(parseLsof('')).toEqual([])
  expect(parseLsof('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 1 a 3u IPv4 0x1 0t0 TCP 127.0.0.1:99999 (LISTEN)\n')).toEqual([])
  expect(portLines([])[0]?.t).toMatch(/Nothing is listening/)
  const lines = portLines(parseLsof(LSOF))

  expect(lines[0]?.t).toMatch(/6 listening ports: 3 on all interfaces, 3 on loopback only/)
  expect(lines.some(l => /5432/.test(l.t) && l.c === 'warning')).toBe(true)
})

const PS = `  PID COMM                %CPU %MEM
    1 /sbin/launchd        0.0  0.1
  612 /usr/libexec/rapportd  0.2  0.0
 1234 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome 12.3  2.4
 2222 /usr/bin/python3     88.5  1.2
 3333 node                 45.0  3.0
 4444 /opt/homebrew/bin/node 45.0  4.5
 5555 -zsh                  0.0  0.0
 notaline
`

test('ps output parses with spaces in the command, and sorts by cpu then memory', () => {
  const procs = parsePs(PS)

  expect(procs.length).toBe(7)
  expect(procs.find(p => p.pid === 1234)).toMatchObject({ name: 'Google Chrome', cpu: 12.3, mem: 2.4 })
  expect(procs.find(p => p.pid === 5555)?.name).toBe('-zsh')
  expect(topByCpu(procs, 3).map(p => p.pid)).toEqual([2222, 4444, 3333])
  expect(topByCpu(procs, 15).length).toBe(7)
  const lines = procLines(procs)

  expect(lines[0]?.t).toMatch(/Top 7 of 7 processes by CPU/)
  expect(lines.find(l => /2222/.test(l.t))?.c).toBe('warning')
})

test('top 15 keeps only fifteen of many processes', () => {
  const many = Array.from({ length: 40 }, (_, i) => `${i + 10} /bin/p${i} ${(i * 1.5).toFixed(1)} 0.${i % 10}`).join('\n')

  expect(topByCpu(parsePs(many), 15).length).toBe(15)
  expect(topByCpu(parsePs(many), 15)[0]?.pid).toBe(49)
})

test('du and df output parse, and the disk card names the biggest folders', () => {
  const du = parseDu('1024\t/w/p/src\n52\t/w/p/docs\n409600\t/w/p/node_modules\n3300\t/w/p\n')

  expect(du.length).toBe(4)
  const DF = 'Filesystem    1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s5   994662584 412345678 523456789    45% 1234567 5234567890    0%   /System/Volumes/Data\n'
  const df = parseDf(DF)

  expect(df[0]).toMatchObject({ fs: '/dev/disk3s5', pct: 45, mount: '/System/Volumes/Data', freeKb: 523456789 })
  expect(parseDf('Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/sda1 1000 400 600 40% /\n')[0]).toMatchObject({ pct: 40, mount: '/' })
  const lines = diskLines('/w/p', du, df)

  expect(lines[0]?.t).toMatch(/This folder: 3\.2 MB/)
  expect(lines[1]?.t).toMatch(/node_modules/)
  expect(lines.some(l => /Disk \/System\/Volumes\/Data/.test(l.t))).toBe(true)
})

// ------------------------------------------------------------------ dependencies

const NPM = JSON.stringify({
  'left-pad': { current: '1.0.0', wanted: '1.0.1', latest: '2.0.0', dependent: 'proj', location: '/w/p/node_modules/left-pad' },
  lodash: { current: '4.17.20', wanted: '4.17.21', latest: '4.17.21', dependent: 'proj' },
  react: { current: '17.0.2', wanted: '17.0.2', latest: '18.3.1', dependent: 'proj' },
  typescript: [{ current: '5.3.0', wanted: '5.3.3', latest: '5.6.2' }],
  missingpkg: { wanted: '1.0.0', latest: '1.2.0' },
})

test('npm outdated JSON is parsed, classified and listed worst first', () => {
  const rows = parseNpmOutdated(NPM) ?? []

  expect(rows.length).toBe(5)
  expect(rows.find(r => r.name === 'react')?.kind).toBe('major')
  expect(rows.find(r => r.name === 'typescript')?.kind).toBe('minor')
  expect(rows.find(r => r.name === 'lodash')?.kind).toBe('patch')
  expect(rows.find(r => r.name === 'missingpkg')).toMatchObject({ current: 'missing', kind: 'unknown' })
  expect(parseNpmOutdated('')).toEqual([])
  expect(parseNpmOutdated('npm ERR! not json')).toBeUndefined()
  expect(parseNpmOutdated('[1,2]')).toBeUndefined()
})

test('the outdated card shows counts and at most ten rows', () => {
  const many: Record<string, unknown> = {}

  for (let i = 0; i < 25; i++) many[`pkg${i}`] = { current: '1.0.0', wanted: '1.0.0', latest: i % 2 ? '2.0.0' : '1.1.0' }
  const lines = (await_(parseNpmOutdated(JSON.stringify(many))))

  expect(lines[0]?.t).toMatch(/25 packages behind \(12 major, 13 minor, 0 patch\)/)
  expect(lines.length).toBe(1 + 10 + 1)
  expect(lines[lines.length - 1]?.t).toMatch(/15 more/)
})

import { outdatedLines } from './parse'
const await_ = (rows: ReturnType<typeof parseNpmOutdated>) => outdatedLines(rows ?? [], 'npm')

const PIP = `[{"name": "requests", "version": "2.25.0", "latest_version": "2.32.3", "latest_filetype": "wheel"}, {"name": "numpy", "version": "1.26.4", "latest_version": "2.1.0", "latest_filetype": "wheel"}, {"name": "pip", "version": "24.0", "latest_version": "24.0.1", "latest_filetype": "wheel"}]`

test('pip outdated JSON is parsed even with warning text before the array', () => {
  const rows = parsePipOutdated(`WARNING: pip is being invoked by an old script wrapper\n${PIP}`) ?? []

  expect(rows.map(r => [r.name, r.kind])).toEqual([['requests', 'minor'], ['numpy', 'major'], ['pip', 'patch']])
  expect(parsePipOutdated('')).toEqual([])
  expect(parsePipOutdated('Traceback: nope')).toBeUndefined()
  expect(parsePipOutdated('[{"name": ')).toBeUndefined()
  expect(outdatedLines([], 'pip')[0]?.t).toMatch(/up to date/)
})

test('semantic version comparison', () => {
  expect(bumpKind('1.2.3', '2.0.0')).toBe('major')
  expect(bumpKind('1.2.3', '1.3.0')).toBe('minor')
  expect(bumpKind('1.2.3', '1.2.4')).toBe('patch')
  expect(bumpKind('v1.2.3', '1.2.4-beta')).toBe('patch')
  expect(bumpKind('x', '1.0.0')).toBe('unknown')
})

// ------------------------------------------------------------------ repo scorecard

const NOW = 1_800_000_000
const day = 86_400

test('git status header and rows are counted', () => {
  expect(statusCounts('## main...origin/main [ahead 2, behind 1]\n M a.ts\nA  b.ts\n?? c.txt\n?? d.txt\n')).toEqual({ dirty: 2, untracked: 2, ahead: 2, behind: 1, hasUpstream: true })
  expect(statusCounts('## main\n')).toEqual({ dirty: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: false })
})

test('branch rows parse and a clean fresh repo scores 100', () => {
  const rows = parseBranchRows('main\t1799990000\t*\nfeature/x\t1799900000\t \n')

  expect(rows).toEqual([{ name: 'main', ts: 1_799_990_000, isCurrent: true }, { name: 'feature/x', ts: 1_799_900_000, isCurrent: false }])
  const s = scoreRepo({ branches: rows, statusOut: '## main...origin/main\n', lastCommitTs: NOW - day, nowSec: NOW, bigUntracked: [], untrackedCount: 0 })

  expect(s).toMatchObject({ score: 100, grade: 'A', dirty: 0, stale: 0 })
})

test('a messy repo loses points for each problem and the card says why', () => {
  const branches = [
    { name: 'main', ts: NOW - day, isCurrent: true },
    ...Array.from({ length: 6 }, (_, i) => ({ name: `old${i}`, ts: NOW - 200 * day, isCurrent: false })),
  ]
  const s = scoreRepo({
    branches,
    statusOut: `## main...origin/main [behind 3]\n${Array.from({ length: 12 }, (_, i) => ` M f${i}.ts`).join('\n')}\n`,
    lastCommitTs: NOW - 40 * day,
    nowSec: NOW,
    bigUntracked: [{ path: 'dump.bin', size: 9e6 }],
    untrackedCount: 1,
  })

  // dirty 12 -> -10, stale 6 -> -15 (cap), big untracked -5, last commit 40d -10, behind -5
  expect(s.score).toBe(55)
  expect(s.grade).toBe('D')
  expect(s.stale).toBe(6)
  expect(s.items.map(i => i.penalty)).toEqual([10, 15, 0, 5, 10, 5])
})

// ------------------------------------------------------------------ languages, licence, hygiene

test('languages are guessed from extensions, ignoring data formats when code exists', () => {
  expect(guessLanguages({ ts: 30, tsx: 10, js: 10, json: 90, md: 20, py: 10 })).toEqual([{ lang: 'TypeScript', pct: 67 }, { lang: 'JavaScript', pct: 17 }, { lang: 'Python', pct: 17 }])
  expect(guessLanguages({ json: 3, md: 1 })[0]?.lang).toBe('JSON')
  expect(guessLanguages({})).toEqual([])
  expect(guessLanguages({ zzz: 4 })).toEqual([])
})

test('licence text is read from package.json, TOML and file headers', () => {
  expect(licenseFromPackageJson('{"name":"x","license":"MIT"}')).toBe('MIT')
  expect(licenseFromPackageJson('{"license":{"type":"ISC","url":"x"}}')).toBe('ISC')
  expect(licenseFromPackageJson('{"licenses":[{"type":"MIT"},{"type":"Apache-2.0"}]}')).toBe('MIT OR Apache-2.0')
  expect(licenseFromPackageJson('{"name":"x"}')).toBeUndefined()
  expect(licenseFromPackageJson('not json')).toBeUndefined()
  expect(licenseFromToml('[package]\nname = "x"\nlicense = "MIT OR Apache-2.0"\n')).toBe('MIT OR Apache-2.0')
  expect(licenseFromToml('[project]\nlicense = {text = "BSD-3-Clause"}\n')).toBe('BSD-3-Clause')
  expect(guessLicense('MIT License')).toBe('MIT')
  expect(guessLicense('Apache License\n Version 2.0')).toBe('Apache-2.0')
  expect(guessLicense('GNU GENERAL PUBLIC LICENSE')).toBe('GPL')
  expect(guessLicense('Copyright 2024 Someone')).toBe('')
})

test('hygiene flags tracked secrets, unignored secret-like files and a missing .gitignore, by name only', () => {
  const f = hygiene({ names: ['src', '.env', '.env.example', 'server.pem', 'README.md'], isRepo: true, tracked: ['.env.local', 'keys/deploy.pem'], notIgnored: ['server.pem'] })

  expect(f.filter(x => x.sev === 'high').map(x => x.text)).toEqual(['.env.local is tracked by git: a secret-like file name is in the repository', 'keys/deploy.pem is tracked by git: a secret-like file name is in the repository'])
  expect(f.some(x => x.sev === 'medium' && /server\.pem is here and not ignored/.test(x.text))).toBe(true)
  expect(f.some(x => x.sev === 'medium' && /No \.gitignore/.test(x.text))).toBe(true)
  expect(f.some(x => /\.env\.example/.test(x.text))).toBe(false)
  expect(f.some(x => /^\.env is here and ignored/.test(x.text))).toBe(true)
  expect(hygiene({ names: ['.gitignore', 'src'], isRepo: true, tracked: [], notIgnored: [] })).toEqual([])
})

// ------------------------------------------------------------------ TODO board

const CODE = `import x from 'y'
// TODO: handle the empty case
const a = 1 // FIXME(bob) wrong when negative
/* HACK works around a bug */
# TODO python style
const s = "TODO is a word in a string"
<!-- TODO: html -->
 * @todo not matched lowercase
-- TODO sql
const k = 'sk-abcdefghijklmnopqrstuvwxyz0123' // TODO rotate this key sk-abcdefghijklmnopqrstuvwxyz0123
`

test('TODO, FIXME and HACK notes are found in comments only, with line numbers', () => {
  const todos = scanTodos('/w/a.ts', CODE)

  expect(todos.map(t => [t.line, t.kind])).toEqual([[2, 'TODO'], [3, 'FIXME'], [4, 'HACK'], [5, 'TODO'], [7, 'TODO'], [9, 'TODO'], [10, 'TODO']])
  expect(todos[1]?.text).toBe('bob) wrong when negative')
  expect(todos[6]?.text).not.toMatch(/sk-abcdefghijklmnop/)
  expect(scanTodos('/w/b.bin', 'TODO\0 // TODO x')).toEqual([])
  expect(scanTodos('/w/c.ts', Array.from({ length: 50 }, () => '// TODO x').join('\n')).length).toBe(20)
  const lines = todoLines(todos, 2, '/w')

  expect(lines[0]?.t).toBe('7 notes in 2 edited files')
  expect(lines[1]?.t).toBe('a.ts')
  expect(todoLines([], 0, '/w')[0]?.t).toMatch(/No files seen edited/)
  expect(todoLines([], 3, '/w')[0]?.t).toMatch(/No TODO, FIXME or HACK comments in the 3 files/)
})

// ------------------------------------------------------------------ log viewer

test('secret-like paths are refused for the log viewer', () => {
  for (const p of ['/w/.env', '/w/.env.local', '/home/a/.ssh/id_rsa', '/w/server.pem', '/w/tls.key', '/w/credentials.json', '/w/secrets/app.log', '/home/a/.aws/config', '/home/a/.zsh_history', '/etc/shadow', '/w/my-password-list.txt', '/home/a/.npmrc', '/Users/a/Library/Keychains/login.keychain-db', '/w/.git/config', '/w/api_key.log']) {
    expect(isSecretLikePath(p)).toBe(true)
  }

  for (const p of ['/w/logs/app.log', '/var/log/system.log', '/w/npm-debug.log', '/w/.environment/readme', '/w/keyboard.log', '/w/build/output.txt']) {
    expect(isSecretLikePath(p)).toBe(false)
  }
})

test('a tail read drops a partial first line, filters, and masks credentials', () => {
  const lines = tailLines('rtial line\nINFO started\nERROR boom token=abcd1234efgh5678\nINFO ok\n', true)

  expect(lines).toEqual(['INFO started', 'ERROR boom token=abcd1234efgh5678', 'INFO ok'])
  expect(tailLines('a\nb\n', false)).toEqual(['a', 'b'])
  expect(filterLog(lines, 'error')).toEqual(['ERROR boom token=abcd1234efgh5678'])
  expect(filterLog(lines, 'info -ok')).toEqual(['INFO started'])
  expect(filterLog(lines, '')).toEqual(lines)
  const out = logLines('/w/app.log', lines, 'boom', 5000)

  expect(out[0]?.t).toMatch(/1 match "boom"/)
  expect(out[1]?.t).toBe('ERROR boom token=[secret]')
  expect(logLines('/w/app.log', lines, 'zzz', 5000)[1]?.t).toBe('No lines match.')
})

// ------------------------------------------------------------------ meeting mode

test('restorePlan resets every switch, then puts back exactly the saved overrides', () => {
  expect(restorePlan({})).toEqual({ args: ['feature reset'], isComplete: true })
  expect(restorePlan({ 'alerts.toasts': false, 'cockpit.band': true })).toEqual({ args: ['feature reset', 'feature alerts.toasts off', 'feature cockpit.band on'], isComplete: true })
  expect(restorePlan({ 'bad key': true, 'x.y': 1 as unknown as boolean }).args).toEqual(['feature reset'])
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`m${i}.t`, true]))

  expect(restorePlan(many).args.length).toBe(41)
  expect(restorePlan(many).isComplete).toBe(false)
  expect(cleanOverrides({ 'a.b': true, c: false, 'd.e': 'x', 'f.g': false })).toEqual({ 'a.b': true, 'f.g': false })
  expect(cleanOverrides(null)).toEqual({})
  expect(fmtAge(30)).toBe('30s')
})

// ------------------------------------------------------------------ tests parsing

const JEST_FAIL = `FAIL src/math.test.ts
  Math
    ✓ adds (2 ms)
    ✕ subtracts (3 ms)

  ● Math › subtracts

    expect(received).toBe(expected)

    Expected: 1
    Received: 2

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 1 skipped, 8 passed, 10 total
Snapshots:   0 total
Time:        1.234 s
`

test('jest summaries give counts, failing names and passing names', () => {
  const s = parseTests(JEST_FAIL)

  expect(s).toMatchObject({ fw: 'jest', pass: 8, fail: 1, skip: 1, failed: ['Math › subtracts'], passed: ['adds'] })
  expect(parseTests('Tests:       12 passed, 12 total')).toMatchObject({ pass: 12, fail: 0 })
})

const VITEST = `
 ❯ src/a.test.ts  (5 tests | 1 failed) 8ms
   × suite > does a thing 3ms
   ✓ suite > works 1ms

 FAIL  src/a.test.ts > suite > does a thing
AssertionError: expected 1 to be 2

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 10 passed | 1 skipped (12)
   Duration  1.2s
`

test('vitest summaries are read, including ANSI colour codes', () => {
  const s = parseTests(VITEST)

  expect(s).toMatchObject({ fw: 'vitest', pass: 10, fail: 1, skip: 1 })
  expect(s?.failed).toContain('suite > does a thing')
  expect(parseTests('\u001b[32m Tests \u001b[39m \u001b[1m3 passed\u001b[22m (3)')?.pass).toBe(3)
  expect(parseTests('\u001b[1m      Tests  \u001b[22m 2 passed | 1 failed (3)')).toMatchObject({ fw: 'vitest', pass: 2, fail: 1 })
})

const PYTEST = `============================= test session starts ==============================
collected 8 items

tests/test_a.py ..F.....                                                 [100%]

=================================== FAILURES ===================================
=========================== short test summary info ============================
FAILED tests/test_a.py::test_add - assert 1 == 2
ERROR tests/test_b.py::test_setup - fixture 'db' not found
=================== 1 failed, 5 passed, 1 skipped, 1 error in 0.12s ===================
`

test('pytest summaries count errors as failures and list failing ids', () => {
  expect(parseTests(PYTEST)).toMatchObject({ fw: 'pytest', pass: 5, fail: 2, skip: 1, failed: ['tests/test_a.py::test_add', 'tests/test_b.py::test_setup'] })
  expect(parseTests('5 passed in 0.03s')).toMatchObject({ fw: 'pytest', pass: 5, fail: 0 })
  expect(parseTests('tests/t.py::test_x PASSED\n== 1 passed in 0.01s ==')?.passed).toEqual(['tests/t.py::test_x'])
})

const GO = `=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSub
    sub_test.go:12: got 1, want 2
--- FAIL: TestSub (0.00s)
    --- SKIP: TestSub/slow (0.00s)
FAIL
FAIL	example.com/pkg	0.004s
ok  	example.com/other	0.002s
`

test('go test output counts per test when verbose, per package otherwise', () => {
  expect(parseTests(GO)).toMatchObject({ fw: 'go', pass: 1, fail: 1, skip: 1, failed: ['TestSub'], passed: ['TestAdd'] })
  expect(parseTests('ok  \texample.com/a\t0.003s\nok  \texample.com/b\t(cached)\nFAIL\texample.com/c\t0.1s\n')).toMatchObject({ fw: 'go', pass: 2, fail: 1 })
})

const CARGO = `running 3 tests
test tests::adds ... ok
test tests::subs ... FAILED
test tests::slow ... ignored

failures:

test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s

running 2 tests
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
`

test('cargo test sums every crate result', () => {
  expect(parseTests(CARGO)).toMatchObject({ fw: 'cargo', pass: 3, fail: 1, skip: 1, failed: ['tests::subs'] })
})

test('text that is not a test summary gives nothing', () => {
  for (const t of ['', 'hello world', 'npm ERR! missing script: test', 'Tests are important', 'total 0 passed', 'ls -la']) expect(parseTests(t)).toBeUndefined()
})

test('coverage percentages are read from the usual reporters', () => {
  expect(parseCoverage('----------|---------|\nAll files |   85.71 |    70 |\n')).toBe(85.7)
  expect(parseCoverage('Statements   : 91.2% ( 120/131 )\nBranches     : 80% ( 4/5 )')).toBe(91.2)
  expect(parseCoverage('Name    Stmts   Miss  Cover\nTOTAL     120     10    92%')).toBe(92)
  expect(parseCoverage('TOTAL    120     10     30      5    88%')).toBe(88)
  expect(parseCoverage('ok  \tpkg\t0.2s\tcoverage: 73.4% of statements')).toBe(73.4)
  expect(parseCoverage('85.34% coverage, 100/117 lines covered')).toBe(85.3)
  expect(parseCoverage('Lines        : 64% ( 8/12 )')).toBe(64)
  expect(parseCoverage('no numbers here')).toBeUndefined()
  expect(parseCoverage('Statements : 400%')).toBeUndefined()
})

// ------------------------------------------------------------------ run history, flaky, trends

const run = (t: number, fw: string, pass: number, fail: number, failed: string[] = []): TestRun => ({ t, fw, key: 'npm test', pass, fail, skip: 0, failed, ms: 100 })

test('run statistics and the dashboard lines show counts, trend and failing names', () => {
  expect(runStats([])).toMatchObject({ total: 0, trend: 'none' })
  const runs = [run(1, 'jest', 8, 2, ['a']), run(2, 'jest', 9, 1, ['a']), run(3, 'jest', 10, 0)]
  const s = runStats(runs)

  expect(s).toMatchObject({ total: 3, lastPass: 10, lastFail: 0, trend: 'up', failStreak: 0 })
  expect(runStats([run(1, 'jest', 10, 0), run(2, 'jest', 8, 2), run(3, 'jest', 7, 3)])).toMatchObject({ trend: 'down', failStreak: 2 })
  const lines = testLines(runs, [{ t: 3, pct: 81.5, key: 'npm test' }], 3 + 120_000)

  expect(lines[0]?.t).toMatch(/3 test runs, 90% of tests passed on average, trend improving/)
  expect(lines[1]?.t).toMatch(/Last: jest 10 passed, 0 failed/)
  expect(lines.some(l => /Coverage 81\.5%/.test(l.t))).toBe(true)
  expect(testLines([], [], 0)[0]?.t).toMatch(/No test runs seen yet/)
})

test('lists stay bounded', () => {
  let runs: TestRun[] = []

  for (let i = 0; i < MAX_RUNS + 30; i++) runs = addRun(runs, run(i, 'jest', 1, 0))
  expect(runs.length).toBe(MAX_RUNS)
  expect(runs[runs.length - 1]?.t).toBe(MAX_RUNS + 29)
  let builds: ReturnType<typeof addBuild> = []

  for (let i = 0; i < MAX_BUILDS + 5; i++) builds = addBuild(builds, { t: i, key: 'npm run build', ms: 1, ok: true })
  expect(builds.length).toBe(MAX_BUILDS)
  let hist: ReturnType<typeof addCmd> = []

  for (let i = 0; i < MAX_HIST + 20; i++) hist = addCmd(hist, `echo ${i}`, i)
  expect(hist.length).toBe(MAX_HIST)
  expect(addCov([], { t: 1, pct: 1, key: 'k' }).length).toBe(1)
})

test('a test that failed and then passed is tracked, and a clean run clears every known failure', () => {
  let map: Record<string, Flaky> = {}

  map = updateFlaky(map, run(1, 'jest', 8, 2, ['A', 'B']), [])
  expect(Object.values(map).map(f => [f.name, f.state, f.flips])).toEqual([['A', 'fail', 0], ['B', 'fail', 0]])
  map = updateFlaky(map, run(2, 'jest', 9, 1, ['B']), ['A'])
  expect(map['jest|A']).toMatchObject({ state: 'pass', flips: 1, fails: 1, passes: 1 })
  map = updateFlaky(map, run(3, 'jest', 10, 0), [])
  expect(map['jest|B']).toMatchObject({ state: 'pass', flips: 1 })
  map = updateFlaky(map, run(4, 'jest', 9, 1, ['A']), [])
  expect(map['jest|A']).toMatchObject({ state: 'fail', flips: 2, fails: 2 })
  const lines = flakyLines(map)

  expect(lines[0]?.t).toMatch(/2 tests that failed and later passed/)
  expect(lines[1]?.t).toMatch(/FLAKY  A/)
  expect(flakyLines({})[0]?.t).toMatch(/nothing can be flaky yet/)
  // another framework's clean run does not clear jest failures
  const other = updateFlaky({ 'jest|C': { name: 'C', fw: 'jest', fails: 1, passes: 0, flips: 0, last: 1, state: 'fail' } }, run(5, 'pytest', 5, 0), [])

  expect(other['jest|C']?.state).toBe('fail')
})

test('the flaky map is bounded', () => {
  let map: Record<string, Flaky> = {}

  for (let i = 0; i < 120; i++) map = updateFlaky(map, run(i, 'jest', 0, 1, [`t${i}`]), [])
  expect(Object.keys(map).length).toBe(80)
  expect(map['jest|t119']).toBeDefined()
  expect(map['jest|t0']).toBeUndefined()
})

test('command keys fold flags and file arguments away', () => {
  expect(cmdKey('npm test -- --coverage')).toBe('npm test')
  expect(cmdKey('npx jest src/a.test.ts --watch=false')).toBe('npx jest')
  expect(cmdKey('cd app && pytest -q tests/')).toBe('pytest')
  expect(cmdKey('CI=1 go test ./...')).toBe('go test')
})

// ------------------------------------------------------------------ build times

test('build and test commands get a key; other commands get none', () => {
  expect(buildKey('npm run build')).toBe('npm run build')
  expect(buildKey('npm test')).toBe('npm test')
  expect(buildKey('npm install')).toBe('npm install')
  expect(buildKey('cd web && pnpm run lint --fix')).toBe('pnpm run lint')
  expect(buildKey('cargo test --release')).toBe('cargo test')
  expect(buildKey('CI=1 go build ./...')).toBe('go build')
  expect(buildKey('make')).toBe('make')
  expect(buildKey('pytest -q')).toBe('pytest')
  expect(buildKey('python -m pytest tests')).toBe('python -m pytest')
  expect(buildKey('tsc --noEmit')).toBe('tsc')
  expect(buildKey('docker build .')).toBe('docker build')
  for (const c of ['ls -la', 'git status', 'cat package.json', 'echo hi', 'python script.py', 'docker ps', 'npm', 'pip freeze']) expect(buildKey(c)).toBeUndefined()
})

test('build stats group by key and flag a slow latest run', () => {
  const recs = [100, 110, 90, 400].map((ms, i) => ({ t: i, key: 'npm run build', ms, ok: i !== 1 })).concat([{ t: 9, key: 'cargo test', ms: 20_000, ok: true }])
  const stats = buildStats(recs)

  expect(stats[0]?.key).toBe('cargo test')
  expect(stats[1]).toMatchObject({ key: 'npm run build', n: 4, last: 400, okPct: 75 })
  const lines = buildLines(recs)

  expect(lines[0]?.t).toMatch(/5 timed commands in 2 groups/)
  expect(lines.find(l => /npm run build/.test(l.t))?.t).toMatch(/slower than usual/)
  expect(buildLines([])[0]?.t).toMatch(/No build or test commands timed/)
})

// ------------------------------------------------------------------ errors

test('error messages that differ only in paths, numbers and quoted words cluster together', () => {
  const a = "Error: ENOENT: no such file or directory, open '/Users/a/proj/src/x.ts'"
  const b = "Error: ENOENT: no such file or directory, open '/Users/b/other/lib/y.ts'"

  expect(normalizeError(a)).toBe(normalizeError(b))
  expect(normalizeError('src/app.ts(12,5): error TS2322: Type "a" is not assignable')).toBe(normalizeError('lib/b.ts(99,1): error TS2322: Type "zzz" is not assignable'))
  expect(normalizeError('failed after 3 retries at 2026-11-25T10:00:00Z')).toBe(normalizeError('failed after 17 retries at 2026-12-01 08:15:09'))
  expect(normalizeError('token=abcd1234efgh5678 rejected')).not.toMatch(/abcd1234/)
  expect(normalizeError('TypeError: x is undefined')).not.toBe(normalizeError('RangeError: x is undefined'))
})

test('error lines are picked out of a failing result and clustered with counts', () => {
  const out = 'building...\nsrc/a.ts:1:1 - error TS2304: Cannot find name "foo".\nsrc/b.ts:9:2 - error TS2304: Cannot find name "bar".\nFound 2 errors.\n'

  expect(errorLines(out).length).toBe(3)
  let clusters = addErrors([], errorLines(out), 10)

  clusters = addErrors(clusters, errorLines(out), 20)
  const ts = clusters.find(c => /TS<n>|TS2304/.test(c.key) || /error TS/.test(c.key))

  expect(clusters.reduce((a, c) => a + c.count, 0)).toBe(6)
  expect(ts?.count).toBe(4)
  expect(errorClusterLines(clusters)[0]?.t).toMatch(/6 errors in 2 clusters/)
  expect(errorClusterLines([])[0]?.t).toMatch(/No errors recorded/)
  expect(errorLines('just one line').length).toBe(1)
})

// ------------------------------------------------------------------ history, distractions, snippets, project counters

test('command history masks secrets, drops repeats, and is searchable', () => {
  let h = addCmd([], 'npm run build', 1)

  h = addCmd(h, 'npm run build', 2)
  h = addCmd(h, 'curl -H "Authorization: Bearer abcdef0123456789abcdef" https://x.test', 3)
  h = addCmd(h, 'export API_KEY=supersecretvalue1234 && node app.js', 4)
  h = addCmd(h, '   ', 5)
  expect(h.map(c => c.cmd)).toEqual(['npm run build', 'curl -H "Authorization: [secret]" https://x.test', 'export API_KEY=[secret] && node app.js'])
  expect(searchCmds(h, 'node app').map(c => c.t)).toEqual([4])
  expect(searchCmds(h, 'build curl')).toEqual([])
  expect(searchCmds(h, '').map(c => c.t)).toEqual([4, 3, 1])
  expect(histLines(h, 'curl', 3 * 86_400_000, 0)[0]?.t).toMatch(/1 match for "curl" in 3 commands/)
  expect(histLines([], '', 0, 0)[0]?.t).toMatch(/No commands recorded/)
})

test('distractions are counted by day', () => {
  const noon = Date.UTC(2026, 10, 25, 12)
  let d = addDistraction([], 'slack ping', noon)

  d = addDistraction(d, '  email   about\ninvoice ', noon + 3_600_000)
  d = addDistraction(d, 'old one', noon - 2 * 86_400_000)
  const lines = distractLines(d, noon)

  expect(lines[0]?.t).toBe('3 task switches marked, 2 today')
  expect(lines.some(l => /11-25 .* 2$/.test(l.t))).toBe(true)
  expect(d[1]?.what).toBe('email about invoice')
  expect(distractLines([], 0)[0]?.t).toMatch(/No task switches/)
})

test('snippets are validated, bounded, found by number or name, and fenced safely', () => {
  const a = addSnippet([], 'ts', 'debounce', 'const d = (f) => f\\nexport default d')

  expect(a.ok).toBe(true)

  if (!a.ok) return
  expect(a.list[0]?.code).toBe('const d = (f) => f\nexport default d')
  expect(addSnippet(a.list, 'ts', 'DEBOUNCE', 'x').ok && (addSnippet(a.list, 'ts', 'DEBOUNCE', 'x') as { replaced: boolean }).replaced).toBe(true)
  expect(addSnippet([], 'bad lang!', 'n', 'x')).toMatchObject({ ok: false })
  expect(addSnippet([], 'ts', '', 'x')).toMatchObject({ ok: false })
  expect(addSnippet([], 'ts', 'n', '   ')).toMatchObject({ ok: false })
  expect(addSnippet([], 'ts', 'n', 'x'.repeat(4001))).toMatchObject({ ok: false })
  expect(addSnippet([], 'sh', 'leak', 'export AWS=AKIAABCDEFGHIJKLMNOP')).toMatchObject({ ok: false, reason: expect.stringMatching(/secret/) })
  const full = Array.from({ length: 60 }, (_, i) => ({ lang: 'ts', name: `s${i}`, code: 'x' }))

  expect(addSnippet(full, 'ts', 'one more', 'x')).toMatchObject({ ok: false })
  expect(findSnippet(a.list, '1')?.name).toBe('debounce')
  expect(findSnippet(a.list, 'DEB')?.name).toBe('debounce')
  expect(findSnippet(a.list, '9')).toBeUndefined()
  expect(findSnippet(a.list, '')).toBeUndefined()
  expect(fenced({ lang: 'ts', name: 'n', code: 'a' })).toBe('```ts\na\n```')
  expect(fenced({ lang: 'md', name: 'n', code: 'x\n```js\ny\n```' })).toBe('````md\nx\n```js\ny\n```\n````')
})

test('project counters are keyed by folder, count by kind and day, and stay bounded', () => {
  const t = Date.UTC(2026, 10, 25, 12)
  let p = recordTool({}, '/w/a', 'Bash', '', t)

  p = recordTool(p, '/w/a', 'Edit', 'ts', t + 1000)
  p = recordTool(p, '/w/a', 'Read', 'ts', t + 2000)
  p = recordTool(p, '/w/b', 'Write', 'py', t + 3000)
  expect(p['/w/a']).toMatchObject({ tools: 3, bash: 1, edits: 1, reads: 1, exts: { ts: 2 } })
  expect(p['/w/a']?.days['2026-11-25']).toBe(3)
  expect(p['/w/b']?.edits).toBe(1)
  let many: ReturnType<typeof recordTool> = {}

  for (let i = 0; i < 45; i++) many = recordTool(many, `/w/p${i}`, 'Bash', '', t + i)
  expect(Object.keys(many).length).toBe(30)
  expect(many['/w/p44']).toBeDefined()
  let ext: ReturnType<typeof recordTool> = {}

  for (let i = 0; i < 60; i++) ext = recordTool(ext, '/w/x', 'Edit', `e${i}`, t)
  expect(Object.keys(ext['/w/x']?.exts ?? {}).length).toBe(40)
})

// ------------------------------------------------------------------ stored values are validated

test('stored values that do not fit are dropped, not trusted', () => {
  expect(cleanHist([{ t: 1, cmd: 'ok' }, { t: 'x', cmd: 'bad' }, null, { t: 2 }, 'str', { t: 3, cmd: '' }])).toEqual([{ t: 1, cmd: 'ok' }])
  expect(cleanHist('nope')).toEqual([])
  expect(cleanSnips([{ lang: 'ts', name: 'a', code: 'x' }, { lang: 'bad lang', name: 'b', code: 'x' }, { lang: 'ts', name: 'c', code: '  ' }])).toEqual([{ lang: 'ts', name: 'a', code: 'x' }])
  expect(cleanProjs({ '/w/a': { first: 1, last: 2, tools: 3, days: { '2026-01-01': 2, bad: 'x' }, exts: { ts: 1 } }, rel: { first: 1, last: 2 }, '/w/b': { first: 'x' } })).toEqual({ '/w/a': { cwd: '/w/a', first: 1, last: 2, tools: 3, bash: 0, edits: 0, reads: 0, days: { '2026-01-01': 2 }, exts: { ts: 1 } } })
  const r = cleanRuns({ runs: [{ t: 1, fw: 'jest', key: 'k', pass: 1, fail: 0, skip: 0, failed: ['a', 5] }, { t: 'x' }], cov: [{ t: 1, pct: 50, key: 'k' }, { t: 1, pct: 500 }], flaky: { 'jest|a': { name: 'a', fw: 'jest', state: 'fail' }, bad: { name: 1 } }, builds: [{ t: 1, key: 'k', ms: 5, ok: true }, { t: 1 }], errors: [{ key: 'k', sample: 's', count: 2 }, 3] })

  expect(r.runs.length).toBe(1)
  expect(r.runs[0]?.failed).toEqual(['a'])
  expect(r.cov.length).toBe(1)
  expect(Object.keys(r.flaky)).toEqual(['jest|a'])
  expect(r.builds.length).toBe(1)
  expect(r.errors).toEqual([{ key: 'k', sample: 's', count: 2, first: 0, last: 0 }])
  expect(cleanRuns(undefined)).toEqual({ runs: [], cov: [], flaky: {}, builds: [], errors: [] })
  expect(cleanMeet({ isOn: true, at: 5, snapshot: { 'a.b': true, bad: false } })).toEqual({ isOn: true, at: 5, snapshot: { 'a.b': true } })
  expect(cleanMeet('x')).toEqual({ isOn: false, at: 0, snapshot: {} })
})

// ------------------------------------------------------------------ the chart

test('the test chart is a vector image with a tooltip per bar, and escapes names', () => {
  const runs = [run(1_800_000_000_000, 'jest', 8, 2), run(1_800_000_100_000, 'vitest<x>', 10, 0)]
  const svg = testsSvg(runs, [{ t: 1, pct: 70, key: 'a' }, { t: 2, pct: 80, key: 'b' }, { t: 3, pct: 85, key: 'c' }], 'claude')

  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toMatch(/prefers-color-scheme:dark/)
  expect((svg.match(/<title>/g) ?? []).length).toBe(2 + 3)
  expect(svg).toMatch(/jest: 8 passed, 2 failed/)
  expect(svg).not.toMatch(/vitest<x>/)
  expect(svg).toMatch(/&lt;x&gt;/)
  expect(svg).not.toMatch(/<script|onload|onclick|animation/)
  expect(svg.length).toBeLessThan(131_072)
  expect(testsSvg([], [], 'zzz')).toMatch(/none yet/)
  expect(testsAlt([], [])).toMatch(/none recorded/)
  expect(testsAlt(runs, [{ t: 1, pct: 85, key: 'c' }])).toMatch(/10 passed and 0 failed.*85 percent/)
  const big = Array.from({ length: 200 }, (_, i) => run(i, 'jest', i, 1))

  expect(testsSvg(big, [], 'suggestion').length).toBeLessThan(131_072)
})
