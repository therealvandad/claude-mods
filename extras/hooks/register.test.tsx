import { expect, mock, test } from 'claude-code/testing'

import { CHEATS, cheatsText, fillFor } from './cheats'
import {
  AWAY_MS,
  addTotal,
  bandOf,
  buildDigest,
  clampPos,
  computeHealth,
  digestLines,
  isReadOnlyGit,
  lintDraft,
  maskDeep,
  maskSecrets,
  maskText,
  parseRefs,
  parseStat,
  positionBar,
  rankTotals,
  shortProject,
  spendRate,
  stepPos,
  titleFrom,
} from './pure'

const CTX = { home: '/Users/jane', user: 'jane', cwd: '/Users/jane/work/code/myapp' }

// ------------------------------------------------------------ 15 maskers (pure)

test('masking: home, user, email, secrets and project paths', async () => {
  expect(maskText('/Users/jane/notes/a.txt', CTX)).toBe('~/notes/a.txt')
  expect(maskText('cat /Users/jane/work/code/myapp/src/a.ts', CTX)).toBe('cat …/code/myapp/src/a.ts')
  expect(maskText('/Users/jane/work/code/myapp', CTX)).toBe('…/code/myapp')
  // A sibling that only shares the prefix is not the project.
  expect(maskText('/Users/jane/work/code/myapp-2/x', CTX)).toBe('~/work/code/myapp-2/x')
  // Another person's home on the same machine still goes.
  expect(maskText('/Users/bob/x and /home/amy/y', CTX)).toBe('~/x and ~/y')
  expect(maskText('C:\\Users\\Jane Doe\\file', CTX)).toContain('~')
  expect(maskText('owner is jane today', CTX)).toBe('owner is [user] today')
  expect(maskText('janeway stays', CTX)).toBe('janeway stays')
  expect(maskText('mail jane.doe@example.com now', CTX)).toBe('mail [email] now')
  expect(maskText('git@github.com:acme/x.git', CTX)).toBe('git@github.com:acme/x.git')

  const secrets = [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
    `ghp_${'a'.repeat(36)}`,
    'AKIAABCDEFGHIJKLMNOP',
    'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
  ]

  for (const secret of secrets) {
    const masked = maskText(`value ${secret} end`, CTX)
    expect(masked, secret).toContain('[hidden:')
    expect(masked, secret).not.toContain(secret.slice(-12))
  }
  expect(maskSecrets('nothing to hide').count).toBe(0)
  expect(maskText('plain text 42', CTX)).toBe('plain text 42')
})

test('masking: the project root being the home directory, and short roots', async () => {
  const ctx = { home: '/Users/jane', user: 'jane', cwd: '/Users/jane' }
  expect(maskText('/Users/jane/x', ctx)).toBe('~/x')
  expect(shortProject('/proj')).toBeNull()
  expect(shortProject('/a/b/')).toBe('…/a/b')
  expect(maskText('/proj/x', { home: '', user: '', cwd: '/proj' })).toBe('/proj/x')
  // An unknown home still masks by the generic rule.
  expect(maskText('/Users/zed/a', { home: '', user: '', cwd: '' })).toBe('~/a')
})

test('masking: deep copy leaves the original and keeps base64', async () => {
  const input = { stdout: 'cd /Users/jane/work/code/myapp', list: ['/Users/jane/a', 3, null], base64: '/Users/jane/raw' }
  const out = maskDeep(input, CTX) as typeof input

  expect(out.stdout).toBe('cd …/code/myapp')
  expect(out.list).toEqual(['~/a', 3, null])
  expect(out.base64).toBe('/Users/jane/raw')
  expect(input.stdout).toBe('cd /Users/jane/work/code/myapp')
  expect(maskDeep(undefined, CTX)).toBeUndefined()
  expect(maskDeep(7, CTX)).toBe(7)
})

// ------------------------------------------------------------ 16 digest (pure)

const rec = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, tool: 'Bash', sig: id, summary: id, file: '', start: 0, end: 1, bytes: 0, isErr: false, ...over }) as any

test('digest counts what finished since the gap, bounded', async () => {
  const list = [
    rec('old', { end: 100 }),
    rec('a', { end: 5000 }),
    rec('b', { tool: 'Edit', file: '/p/a.ts', end: 6000 }),
    rec('c', { tool: 'Edit', file: '/p/a.ts', end: 6500 }),
    rec('d', { isErr: true, end: 7000 }),
    rec('e', { end: null }),
  ]
  const marks = [{ at: 7500, kind: 'turn-error', ms: 5 }, { at: 10, kind: 'turn-error', ms: 5 }] as any
  const d = buildDigest(list, marks, 1000, 9000, true)

  expect(d.calls).toBe(4)
  expect(d.files).toEqual(['/p/a.ts'])
  expect(d.errors).toBe(2)
  expect(d.isRunning).toBe(true)
  expect(d.awayMs).toBe(8000)
  expect(digestLines(d)[0]).toBe('Away 8.0s: 4 tool calls finished · 1 file changed · 2 errors')
  expect(digestLines(d).pop()).toBe('A turn is still running.')

  const many = Array.from({ length: 20 }, (_, i) => rec(`f${i}`, { tool: 'Write', file: `/p/f${i}.ts`, end: 5000 }))
  const capped = buildDigest(many, [], 0, 10, false)
  expect(capped.files.length).toBe(6)
  expect(capped.filesMore).toBe(14)
  expect(digestLines(capped)[1]).toContain('(+14 more)')
  expect(AWAY_MS).toBe(600_000)
})

// ------------------------------------------------------------ 19 health (pure)

const vit = (over: Record<string, unknown> = {}) => ({ ctx: 20, usd: 0.5, startedAt: 1, at: 1, ...over }) as any

test('health score: each factor and the bands', async () => {
  const clean = Array.from({ length: 10 }, (_, i) => rec(`c${i}`, { sig: `s${i}` }))
  const ok = computeHealth(clean, vit(), [], 600_000)
  expect(ok.score).toBe(100)
  expect(ok.band).toBe('healthy')
  expect(ok.factors.map(f => f.key)).toEqual(['errors', 'loops', 'context', 'spend'])
  expect(Math.round(ok.factors.map(f => f.weight).reduce((a, b) => a + b, 0) * 100)).toBe(100)

  // 4 of 10 failing is the 40% floor: the error factor scores 0, 30% of the total.
  const failing = clean.map((one, i) => (i < 4 ? { ...one, isErr: true } : one))
  const bad = computeHealth(failing, vit(), [], 600_000)
  expect(bad.factors[0]?.score).toBe(0)
  expect(bad.score).toBe(70)

  // Four identical calls in a row: three repeats.
  const loop = Array.from({ length: 4 }, () => rec('x', { sig: 'same' }))
  const looped = computeHealth(loop, vit(), [], 600_000)
  expect(looped.factors[1]?.score).toBe(25)
  expect(looped.factors[1]?.detail).toContain('3 repeats')

  // Context: free to 50%, 0 at 100%.
  expect(computeHealth(clean, vit({ ctx: 50 }), [], 0).factors[2]?.score).toBe(100)
  expect(computeHealth(clean, vit({ ctx: 75 }), [], 0).factors[2]?.score).toBe(50)
  expect(computeHealth(clean, vit({ ctx: 100 }), [], 0).factors[2]?.score).toBe(0)
  expect(computeHealth(clean, vit({ ctx: null }), [], 0).factors[2]?.score).toBe(100)

  // Spend: $12.50 an hour is half way between $5 (free) and $20 (zero).
  const samples = [{ t: 0, usd: 0 }, { t: 3_600_000 / 6, usd: 12.5 / 6 }]
  expect(Math.round((spendRate(samples, vit(), 600_000) ?? 0) * 100)).toBe(1250)
  expect(computeHealth(clean, vit(), samples, 600_000).factors[3]?.score).toBe(50)
  expect(spendRate([], vit({ usd: 1, startedAt: 0 }), 60_000)).toBeNull()
  expect(Math.round((spendRate([], vit({ usd: 3, startedAt: 1 }), 3_600_000) ?? 0) * 100)).toBe(300)

  expect(bandOf(95)).toBe('healthy')
  expect(bandOf(70)).toBe('fair')
  expect(bandOf(45)).toBe('strained')
  expect(bandOf(10)).toBe('poor')
  // Too few finished calls to judge errors.
  expect(computeHealth([rec('a', { isErr: true })], vit(), [], 0).factors[0]?.score).toBe(100)
})

// ------------------------------------------------------------ 18 lint (pure)

test('lint rules: vague drafts are hinted, specific ones are not', async () => {
  for (const vague of ['fix it', 'Fix it please', 'make that better', 'can you look at this', 'do the thing', 'help']) {
    expect(lintDraft(vague), vague).not.toBeNull()
  }
  expect(lintDraft('fix it')?.rule).toBe('pronoun')
  expect(lintDraft('refactor')?.rule).toBe('short')

  for (const fine of [
    'fix the null check in auth.ts',
    'why does `parseDraft` return undefined',
    'look at src/lib/a and fix it',
    'yes',
    'continue',
    'run tests',
    '/health',
    '!ls',
    '',
    'ok',
    'explain how the router picks a handler when two routes overlap',
    'fix it\n```\ncode\n```',
    'update issue #42',
    'debug @src/main.ts',
  ]) {
    expect(lintDraft(fine), fine).toBeNull()
  }
})

// ------------------------------------------------------------ 23 title (pure)

test('title extractor: at most six meaningful words', async () => {
  expect(titleFrom('Can you please fix the login redirect bug in auth.ts?')).toBe('Fix login redirect bug auth.ts')
  expect(titleFrom('I want to add dark mode support to the settings page and also update the docs')).toBe(
    'Add dark mode support settings page',
  )
  expect(titleFrom('hi')).toBeNull()
  expect(titleFrom('fix it')).toBeNull()
  expect(titleFrom('```\nlots of code here\n``` explain parser')).toBe('Explain parser')
  expect(titleFrom('look at /Users/x/src/server.ts https://example.com/abc crash')).toBe('Server.ts crash')
  const long = titleFrom('refactor authentication middleware session handling database migration rollback strategy')
  expect(long).toBe('Refactor authentication middleware session')
  expect((long ?? '').length).toBeLessThanOrEqual(50)
  expect(titleFrom('one two three four five six seven eight nine')).toBe('One two three four five six')
})

// ------------------------------------------------------------ 20, 21, 24 helpers (pure)

test('tool totals rank by output and by time', async () => {
  let t = {}
  t = addTotal(t, 'Read', 100, 9000, false)
  t = addTotal(t, 'Bash', 5000, 400, false)
  t = addTotal(t, 'Bash', 7000, 100, true)
  expect(rankTotals(t, 'bytes')[0]?.[0]).toBe('Read')
  expect(rankTotals(t, 'ms')[0]?.[0]).toBe('Bash')
  expect((t as any).Bash).toEqual({ n: 2, bytes: 500, ms: 12_000, errors: 1 })

  let many = {}
  for (let i = 0; i < 100; i += 1) {
    many = addTotal(many, `mcp__t${i}`, 1, 1, false)
  }
  expect(Object.keys(many).length).toBe(81)
  expect((many as any)['(other)'].n).toBe(20)
})

test('replay position steps and clamps', async () => {
  expect(stepPos(-1, 5, 'prev')).toBe(3)
  expect(stepPos(-1, 5, 'next')).toBe(4)
  expect(stepPos(2, 5, 'first')).toBe(0)
  expect(stepPos(2, 5, 'last')).toBe(4)
  expect(stepPos(0, 5, 'prev')).toBe(0)
  expect(stepPos(4, 5, 'next')).toBe(4)
  expect(stepPos(3, 0, 'next')).toBe(-1)
  expect(clampPos(99, 5)).toBe(4)
  expect(clampPos(2, 5)).toBe(2)
  expect(positionBar(0, 4, 8)).toBe('██░░░░░░')
  expect(positionBar(3, 4, 8)).toBe('████████')
})

test('git allowlist: only for-each-ref and diff --stat', async () => {
  expect(isReadOnlyGit(['for-each-ref', '--format=%(refname)', 'refs/claude-checkpoints/'])).toBe(true)
  expect(isReadOnlyGit(['diff', '--stat=200,160', '--no-renames', 'a', 'b'])).toBe(true)

  for (const bad of [
    ['update-ref', 'refs/claude-checkpoints/1', 'abc'],
    ['update-ref', '-d', 'refs/claude-checkpoints/1'],
    ['checkout', 'abc', '--', '.'],
    ['restore', '--source=abc', '.'],
    ['reset', '--hard', 'abc'],
    ['stash', 'create'],
    ['diff', 'a', 'b'],
    ['diff', '--stat', '--output=/tmp/x', 'a', 'b'],
    ['diff', '--stat', '--ext-diff', 'a', 'b'],
    ['for-each-ref', '--exec=rm'],
    ['push'],
    [],
  ]) {
    expect(isReadOnlyGit(bad), bad.join(' ')).toBe(false)
  }
})

test('refs and stat output parse', async () => {
  const refs = parseRefs(
    [
      'refs/claude-checkpoints/12\t' + 'b'.repeat(40) + '\t1700000300\tclaude checkpoint: turn 12',
      'refs/claude-checkpoints/2\t' + 'a'.repeat(40) + '\t1700000100\tclaude checkpoint: baseline',
      'refs/other/3\t' + 'c'.repeat(40) + '\t1\tnope',
      'refs/claude-checkpoints/x\t' + 'c'.repeat(40) + '\t1\tbad number',
      '',
    ].join('\n'),
  )
  expect(refs.map(r => r.n)).toEqual([2, 12])
  expect(refs[0]?.at).toBe(1_700_000_100_000)
  expect(refs[1]?.subject).toBe('claude checkpoint: turn 12')

  const stat = parseStat(' src/a.ts   | 12 ++++++------\n docs/b | Bin 0 -> 12 bytes\n 2 files changed, 6 insertions(+), 6 deletions(-)\n')
  expect(stat.files).toEqual([
    { path: 'src/a.ts', change: '12 ++++++------' },
    { path: 'docs/b', change: 'Bin 0 -> 12 bytes' },
  ])
  expect(stat.summary).toBe('2 files changed, 6 insertions(+), 6 deletions(-)')
})

// ------------------------------------------------------------ 22 cheatsheet data

// The names the other mods own (from the round-2 addendum). The cheatsheet must list every one.
const TAKEN = [
  'allow', 'audit', 'badges', 'budget', 'cfocus', 'cockpit', 'cpin', 'csearch', 'cshelf', 'ctodo', 'dashboard', 'dryrun',
  'files', 'focus', 'fun', 'handoff', 'hardbudget', 'look', 'loopguard', 'motion', 'note', 'notes', 'pet', 'precommit',
  'protect', 'readonly', 'rollback', 'safecompact', 'safetylog', 'sessionrecap', 'snapshot', 'snip', 'sound', 'sprint',
  'sprintlog', 'streak', 'timer', 'tip', 'toolvis', 'weekly',
]
const MINE = ['present', 'alerts', 'lint', 'health', 'toolcost', 'replay', 'cheats', 'snaps']

test('cheatsheet lists every other mod command, grouped, and none of mine clash', async () => {
  const group = (name: string) => CHEATS.find(g => g.commands.some(c => c.name === name))?.mod

  for (const name of TAKEN) {
    expect(group(name), name).toBeDefined()
    expect(MINE.includes(name), name).toBe(false)
  }
  expect(group('rollback')).toBe('safety-pro')
  expect(group('timer')).toBe('workbench')
  expect(group('csearch')).toBe('cockpit')
  expect(group('readonly')).toBe('tool-guard')
  expect(group('snip')).toBe('prompt-tools')
  expect(group('look')).toBe('looks')
  expect(group('toolvis')).toBe('tool-visuals')
  expect(group('sprint')).toBe('personality')
  const names = CHEATS.flatMap(g => g.commands.map(c => c.name))
  expect(new Set(names).size).toBe(names.length)
  expect(names.length).toBe(TAKEN.length + MINE.length)

  const text = cheatsText()
  expect(text).toContain('/rollback')
  expect(text).toContain('safety-pro')
  expect(fillFor('rollback')).toBe('/rollback ')
})

// ------------------------------------------------------------ engine behaviour

type Box = {
  status: (string | undefined)[]
  toasts: string[]
  notified: string[]
  fills: string[]
  git: string[][]
  usage: { usd: number; percent: number }
  notifyResult: { isSent: boolean }
  register: (name: string) => void
  procs: (argv: string[]) => { exitCode: number; stdout: string; stderr: string }
  hint: string | null
}

const newBox = (): Box => ({
  status: [],
  toasts: [],
  notified: [],
  fills: [],
  git: [],
  usage: { usd: 0.2, percent: 20 },
  notifyResult: { isSent: true },
  register: () => undefined,
  procs: argv => defaultProcs(argv),
  hint: null,
})

const defaultProcs = (argv: string[]) => {
  if (argv[1] === 'for-each-ref') {
    return {
      exitCode: 0,
      stderr: '',
      stdout: [
        `refs/claude-checkpoints/1\t${'a'.repeat(40)}\t1700000100\tclaude checkpoint: baseline`,
        `refs/claude-checkpoints/2\t${'b'.repeat(40)}\t1700000400\tclaude checkpoint: turn 1`,
      ].join('\n'),
    }
  }
  if (argv[1] === 'diff') {
    return { exitCode: 0, stderr: '', stdout: ' src/a.ts | 4 ++--\n 1 file changed, 2 insertions(+), 2 deletions(-)\n' }
  }

  return { exitCode: 1, stderr: 'unexpected', stdout: '' }
}

const wire = (on: (...args: any[]) => unknown, box: Box) => {
  on('command.register', (_: unknown, e: { name: string }) => {
    box.register(e.name)

    return { value: { command: e.name } }
  })
  on('state.get', (_: unknown, e: any, next: any) =>
    box.hint !== null && e.plugin === 'extras' && e.key === 'lintHint' ? { value: { value: box.hint, version: 1 } } : next(e),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_: unknown, e: { text?: string }) => {
    box.status.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.notify', (_: unknown, e: { text: string }) => {
    box.notified.push(e.text)

    return { value: box.notifyResult.isSent ? { isSent: true, channel: 'client' } : { isSent: false, reason: 'no-channel' } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/jane/work/code/myapp' }))
  on('session.usage', () => ({
    value: { startedAt: 1, context: { window: 1000, percent: box.usage.percent }, rateLimits: [], cost: { usd: box.usage.usd } },
  }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    box.fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    box.git.push(e.argv)

    return { value: box.procs(e.argv) }
  })
}

const cmd = ($: any, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })

const done = (over: Record<string, unknown> = {}) =>
  ({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...over }) as any

const startSession = ($: any) => $.session.start({ cwd: '/Users/jane/work/code/myapp', surface: 'desktop', isInteractive: true })

const PANE = (id: string, surface = 'desktop') =>
  ({
    plugin: 'extras',
    component: 'Pane',
    requestId: id,
    surface,
    props: { title: id, isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as any

const BAND = (surface = 'desktop') =>
  ({
    plugin: 'extras',
    surface,
    component: 'AbovePrompt',
    requestId: 'extras-band',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as any

const TOOL_ROW = (props: Record<string, unknown>, surface = 'desktop') =>
  ({
    plugin: 'extras',
    surface,
    component: 'ToolUse',
    requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...props },
  }) as any

test('session start registers the eight commands and survives a refused name', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  const names: string[] = []
  box.register = name => {
    names.push(name)
    if (name === 'lint') {
      throw new Error('name taken')
    }
  }

  await startSession($)
  expect(names).toEqual(['present', 'alerts', 'lint', 'health', 'toolcost', 'replay', 'cheats', 'snaps'])
  expect(box.toasts.some(t => /\/lint could not be registered/.test(t))).toBe(true)
})

test('15: /present masks what is drawn, never what the model gets, and shows PRESENTING', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1000 })
  const saved: Record<string, unknown> = {}
  on('store.get', (_: unknown, e: { key: string }) => ({ value: saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  const modelSaw: unknown[] = []
  on('tool.call', (_: unknown, e: any) => {
    modelSaw.push(e.command)

    return { result: { stdout: 'jane@example.com in /Users/jane/work/code/myapp' }, text: 'jane@example.com in /Users/jane/work/code/myapp' }
  })
  // The engine's own drawing: it prints the props it was handed.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{JSON.stringify([e.props.input, e.props.output, e.props.text])}</Text>
  })
  await startSession($)

  const row = { input: { command: 'cat /Users/jane/work/code/myapp/.env', secret: 'ghp_' + 'a'.repeat(36) }, output: { stdout: 'by jane@example.com' } }
  const before = await $.ui.mount(TOOL_ROW(row))
  expect((await before.find({ type: 'Text', text: /\/Users\/jane/ }))?.text).toContain('/Users/jane/work/code/myapp/.env')
  await before.unmount()

  const answer = await cmd($, 'present', 'on')
  expect(answer.text).toMatch(/Screen-share mode is ON/)
  expect(box.status.at(-1)).toBe('PRESENTING')
  expect(saved['extras.present']).toBe(true)

  const live = await $.ui.mount(TOOL_ROW(row))
  const shown = (await live.find({ type: 'Text', text: /cat/ }))?.text ?? ''
  expect(shown).toContain('…/code/myapp/.env')
  expect(shown).not.toContain('/Users/jane')
  expect(shown).toContain('[hidden:github-token]')
  expect(shown).not.toContain('ghp_aaaa')
  await live.unmount()

  const result = await $.ui.mount({ ...TOOL_ROW({ output: { stdout: 'mail jane@example.com' } }), component: 'ToolResult' })
  expect((await result.find({ type: 'Text', text: /mail/ }))?.text).toContain('[email]')
  await result.unmount()

  const said = await $.ui.mount({
    plugin: 'extras', surface: 'desktop', component: 'AssistantMessage', requestId: 'm1',
    props: { text: 'Edited /Users/jane/notes.md', isFirstOfReply: true },
  } as any)
  expect((await said.find({ type: 'Text', text: /Edited/ }))?.text).toContain('~/notes.md')
  await said.unmount()

  // The model reads the real thing: the tool ran with the unmasked command and its result is unchanged.
  const ran = await $.tool.call({ tool: 'Bash', command: 'cat /Users/jane/work/code/myapp/.env' })
  expect(modelSaw).toEqual(['cat /Users/jane/work/code/myapp/.env'])
  expect((ran as any).text).toBe('jane@example.com in /Users/jane/work/code/myapp')

  // The chip also shows in the band.
  const band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /PRESENTING/ })).toBeDefined()
  await band.unmount()

  await cmd($, 'present', 'off')
  expect(box.status.at(-1)).toBeUndefined()
  expect(saved['extras.present']).toBe(false)
  const off = await $.ui.mount(TOOL_ROW(row))
  expect((await off.find({ type: 'Text', text: /cat/ }))?.text).toContain('/Users/jane/work/code/myapp/.env')
  await off.unmount()
})

test('15: the choice is restored from the store at session start', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1000 })
  mock.store(on, { 'extras.present': true })
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  await startSession($)

  expect(box.status.at(-1)).toBe('PRESENTING')
})

test('16: a 10+ minute gap shows the away card, a short one does not, and it can be dismissed', async ($, on) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 100_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  const hold = { ms: 0 }
  on('tool.call', async () => {
    if (hold.ms > 0) {
      await clock.sleep(hold.ms)
    }

    return { result: {}, text: 'x'.repeat(50) }
  })
  await startSession($)
  await $.turn.start({ text: 'go', turnId: 't' } as any)

  // 9 minutes is not away.
  hold.ms = 9 * 60_000
  const short = $.tool.call({ tool: 'Edit', file_path: '/p/short.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(9 * 60_000)
  await short
  let band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /^Away/ })).toBeUndefined()
  await band.unmount()

  // A 12-minute silent call: the card says what finished while nothing else happened.
  hold.ms = 12 * 60_000
  const long = $.tool.call({ tool: 'Edit', file_path: '/Users/jane/work/code/myapp/src/long.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(12 * 60_000)
  await long

  band = await $.ui.mount(BAND())
  const head = await band.find({ type: 'Text', text: /^Away/ })
  expect(head?.text).toBe('Away 12m 00s: 1 tool call finished · 1 file changed · 0 errors')
  expect(await band.find({ type: 'Text', text: /Changed: .*long\.ts/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /A turn is still running/ })).toBeDefined()
  await band.press({ key: 'extras-digest-dismiss' })
  expect(await band.find({ type: 'Text', text: /^Away/ })).toBeUndefined()
  await band.unmount()

  // A prompt after a long silence also raises one; the next prompt takes it away again.
  hold.ms = 0
  await $.turn.complete(done())
  await clock.advance(11 * 60_000)
  await $.prompt.submit({ text: 'back again', wait: false, origin: { kind: 'composer' } })
  band = await $.ui.mount(BAND())
  expect((await band.find({ type: 'Text', text: /^Away/ }))?.text).toMatch(/^Away 11m 00s: 0 tool calls finished/)
  expect(await band.find({ type: 'Text', text: /No turn is running/ })).toBeDefined()
  await band.unmount()

  await clock.advance(1000)
  await $.prompt.submit({ text: 'and another', wait: false, origin: { kind: 'composer' } })
  band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /^Away/ })).toBeUndefined()
  await band.unmount()
})

test('16: the card hides paths while presenting', async ($, on) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 100_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  on('tool.call', async () => {
    await clock.sleep(11 * 60_000)

    return { result: {}, text: '' }
  })
  await startSession($)
  await cmd($, 'present', 'on')

  const run = $.tool.call({ tool: 'Write', file_path: '/Users/jane/work/code/myapp/src/x.ts', content: 'a' })
  await clock.advance(11 * 60_000)
  await run
  const band = await $.ui.mount(BAND())
  expect((await band.find({ type: 'Text', text: /Changed:/ }))?.text).toBe('Changed: …/code/myapp/src/x.ts')
  await band.unmount()
})

test('17: alerts fire for long turns only, at most one per 5 minutes, and /alerts off and test work', async ($, on) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  await startSession($)

  await $.turn.complete(done({ durationMs: 30_000 }))
  expect(box.notified.length).toBe(0)
  await $.turn.complete(done({ durationMs: 60_000 }))
  expect(box.notified.length).toBe(0)
  await $.turn.complete(done({ durationMs: 90_000, reason: 'aborted', isAborted: true }))
  expect(box.notified.length).toBe(0)
  await $.turn.complete(done({ durationMs: 61_000, agentId: 'sub1' }))
  expect(box.notified.length).toBe(0)

  await $.turn.complete(done({ durationMs: 90_000 }))
  expect(box.notified).toEqual(['Claude finished after 1m 30s.'])

  await clock.advance(4 * 60_000)
  await $.turn.complete(done({ durationMs: 120_000 }))
  expect(box.notified.length).toBe(1)

  await clock.advance(61_000)
  await $.turn.complete(done({ durationMs: 120_000, reason: 'error' }))
  expect(box.notified.length).toBe(2)
  expect(box.notified[1]).toBe('Claude stopped after 2m 00s (error).')

  expect((await cmd($, 'alerts', 'off')).text).toMatch(/Alerts are off/)
  await clock.advance(10 * 60_000)
  await $.turn.complete(done({ durationMs: 120_000 }))
  expect(box.notified.length).toBe(2)

  expect((await cmd($, 'alerts', 'test')).text).toBe('Test alert sent through client.')
  expect(box.notified.length).toBe(3)
  box.notifyResult.isSent = false
  expect((await cmd($, 'alerts', 'test')).text).toBe('Test alert not sent (no-channel).')

  // A refused notification does not use up the 5-minute allowance.
  await cmd($, 'alerts', 'on')
  await clock.advance(10 * 60_000)
  await $.turn.complete(done({ durationMs: 120_000 }))
  box.notifyResult.isSent = true
  await $.turn.complete(done({ durationMs: 120_000 }))
  expect(box.notified.length).toBe(6)
})

test('18: /lint toasts a vague submitted prompt once per 3 minutes, never blocks, and shows a standing hint', async ($, on) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  await startSession($)

  const sent = await $.prompt.submit({ text: 'fix it', wait: false, origin: { kind: 'composer' } })
  expect(sent.text).toBe('fix it')
  expect(box.toasts.filter(t => /^Hint:/.test(t)).length).toBe(1)

  await clock.advance(60_000)
  await $.prompt.submit({ text: 'do that', wait: false, origin: { kind: 'composer' } })
  expect(box.toasts.filter(t => /^Hint:/.test(t)).length).toBe(1)

  await clock.advance(3 * 60_000)
  await $.prompt.submit({ text: 'do that', wait: false, origin: { kind: 'composer' } })
  expect(box.toasts.filter(t => /^Hint:/.test(t)).length).toBe(2)

  await $.prompt.submit({ text: 'fix the null check in auth.ts', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: '/health', wait: false, origin: { kind: 'composer' }, command: { name: 'health' } } as any)
  expect(box.toasts.filter(t => /^Hint:/.test(t)).length).toBe(2)

  expect((await cmd($, 'lint', 'off')).text).toMatch(/Prompt hints are off/)
  await clock.advance(10 * 60_000)
  await $.prompt.submit({ text: 'fix it', wait: false, origin: { kind: 'composer' } })
  expect(box.toasts.filter(t => /^Hint:/.test(t)).length).toBe(2)
  await cmd($, 'lint', 'on')

  // The standing hint in the band (set by the debounced edit hook) is drawn from the mod's state.
  box.hint = 'Name the file or error.'
  const band = await $.ui.mount(BAND())
  expect((await band.find({ type: 'Text', text: /hint:/ }))?.text).toBe('hint: Name the file or error.')
  await band.unmount()
})

test('18: the edit hook shows a hint after a pause and clears it when the draft improves', async ($, on) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  const draft = { text: '' }
  on('prompt.read', () => ({ value: { text: draft.text, cursor: draft.text.length } }))
  on('prompt.edit', (_: unknown, e: { text: string; inputText: string }) => ({ text: e.text + e.inputText, cursor: 0 }))
  await startSession($)

  const edit = ($ as any).prompt?.edit

  expect(typeof edit).toBe('function')
  draft.text = 'fix it'
  await edit({ origin: { kind: 'composer' }, text: 'fix i', cursor: 5, start: 5, end: 5, inputText: 't' })
  let band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /hint:/ })).toBeUndefined()
  await band.unmount()

  await clock.advance(1300)
  band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /hint: "fix it"/ })).toBeDefined()
  await band.unmount()

  draft.text = 'fix it in auth.ts'
  await edit({ origin: { kind: 'composer' }, text: 'fix it in auth.t', cursor: 16, start: 16, end: 16, inputText: 's' })
  band = await $.ui.mount(BAND())
  expect(await band.find({ type: 'Text', text: /hint:/ })).toBeUndefined()
  await band.unmount()
})

// Calls with sizes and failures: Read 9000 chars, Bash x2, one failing.
const makeCalls = async ($: any, on: (...args: any[]) => unknown, clock: { sleep: (ms: number) => Promise<void>; advance: (ms: number) => Promise<void> }) => {
  const plan: { size: number; ms: number; isError?: boolean }[] = []
  on('tool.call', async () => {
    const step = plan.shift() ?? { size: 0, ms: 0 }
    if (step.ms > 0) {
      await clock.sleep(step.ms)
    }

    return step.isError === true ? { result: {}, text: 'x'.repeat(step.size), isError: true } : { result: {}, text: 'x'.repeat(step.size) }
  })
  const run = async (input: Record<string, unknown>, size: number, ms: number, isError = false) => {
    plan.push({ size, ms, isError })
    const call = $.tool.call(input)
    await clock.advance(ms)

    return call
  }

  return run
}

test('19, 20, 21: health, tool cost and the replay scrubber read the recorded calls', async ($, on) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  const run = await makeCalls($, on, clock)
  await startSession($)

  await run({ tool: 'Read', file_path: '/Users/jane/work/code/myapp/big.ts' }, 9000, 200)
  await run({ tool: 'Bash', command: 'sleep 20' }, 400, 20_000)
  await run({ tool: 'Bash', command: 'npm test' }, 2000, 5000, true)
  await run({ tool: 'Grep', pattern: 'TODO', path: 'src' }, 100, 50)

  // 19: the chip and the pane.
  const band = await $.ui.mount(BAND())
  const chip = await band.find({ type: 'Button', key: 'extras-health-chip' })
  expect(chip?.text).toMatch(/health \d+ (healthy|fair|strained|poor)/)
  await band.unmount()

  box.usage.percent = 90
  await $.turn.complete(done())
  const text = (await cmd($, 'health')).text
  expect(text).toMatch(/^Session health \d+\/100 \((healthy|fair|strained|poor)\)\./)
  expect(text).toContain('Error ratio')
  expect(text).toContain('1 of the last 4 calls failed')
  expect(text).toContain('90% full')

  const pane = await $.ui.mount(PANE('extras-health'))
  for (const label of ['Error ratio', 'Loop repeats', 'Context window', 'Spend rate']) {
    expect(await pane.find({ type: 'Text', text: new RegExp(label) }), label).toBeDefined()
  }
  await pane.unmount()

  // 20: ranking by output and by time.
  const cost = (await cmd($, 'toolcost')).text
  const outputPart = cost.split('Most time')[0] ?? ''
  expect(outputPart.indexOf('Read')).toBeLessThan(outputPart.indexOf('Bash'))
  expect(cost.split('Most time')[1]?.trim().split('\n')[1]).toMatch(/^\s+Bash: .*25s over 2 calls/)
  const tools = await $.ui.mount(PANE('extras-tools'))
  expect(await tools.find({ type: 'Text', text: /^Most output$/ })).toBeDefined()
  expect(await tools.find({ type: 'Text', text: /Read · 1 call/ })).toBeDefined()
  expect(await tools.find({ type: 'Text', text: /Bash · 1 failed/ })).toBeDefined()
  await tools.unmount()

  // 21: first / prev / next / last.
  const replay = await $.ui.mount(PANE('extras-replay'))
  expect(await replay.find({ type: 'Text', text: /Call 4 of 4/ })).toBeDefined()
  await replay.press({ key: 'replay-first' })
  expect(await replay.find({ type: 'Text', text: /Call 1 of 4/ })).toBeDefined()
  expect(await replay.find({ type: 'Text', text: /^Read$/ })).toBeDefined()
  expect(await replay.find({ type: 'Text', text: /big\.ts/ })).toBeDefined()
  expect(await replay.find({ type: 'Text', text: /duration 200ms · result 9\.0k ch/ })).toBeDefined()
  await replay.press({ key: 'replay-next' })
  expect(await replay.find({ type: 'Text', text: /Call 2 of 4/ })).toBeDefined()
  expect(await replay.find({ type: 'Text', text: /sleep 20/ })).toBeDefined()
  await replay.press({ key: 'replay-next' })
  expect(await replay.find({ type: 'Text', text: /failed or refused/ })).toBeDefined()
  await replay.press({ key: 'replay-prev' })
  expect(await replay.find({ type: 'Text', text: /Call 2 of 4/ })).toBeDefined()
  await replay.press({ key: 'replay-last' })
  expect(await replay.find({ type: 'Text', text: /Call 4 of 4/ })).toBeDefined()
  expect(await replay.find({ type: 'Text', text: /TODO in src/ })).toBeDefined()
  await replay.press({ key: 'replay-next' })
  expect(await replay.find({ type: 'Text', text: /Call 4 of 4/ })).toBeDefined()
  await replay.unmount()

  expect((await cmd($, 'replay', 'first')).text).toMatch(/^Call 1 of 4 /)
})

test('21: the replay pane hides paths while presenting', async ($, on) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  const run = await makeCalls($, on, clock)
  await startSession($)
  await cmd($, 'present', 'on')
  await run({ tool: 'Read', file_path: '/Users/jane/secret/plan.md' }, 10, 1)

  const replay = await $.ui.mount(PANE('extras-replay'))
  expect((await replay.find({ type: 'Text', text: /plan\.md/ }))?.text).toBe('~/secret/plan.md')
  await replay.unmount()
})

test('22: /cheats answers with the list and its rows fill the prompt box', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  await startSession($)

  const answer = await cmd($, 'cheats')
  expect(answer.text).toContain('/rollback')
  expect(answer.text).toContain('/present')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const pane = await $.ui.mount(PANE('extras-cheats', surface))
    expect(await pane.find({ type: 'Text', text: /^SAFETY-PRO$/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'cheat-workbench-timer' })).toBeDefined()
    await pane.unmount()
  }
  const pane = await $.ui.mount(PANE('extras-cheats'))
  await pane.press({ key: 'cheat-safety-pro-rollback' })
  await pane.press({ key: 'cheat-extras-present' })
  expect(box.fills).toEqual(['/rollback ', '/present '])
  await pane.unmount()
})

test('23: the first real prompt gets a session title through the classic result, once', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  on('classic.UserPromptSubmit', () => ({}))
  await startSession($)

  const slash = await $.classic.UserPromptSubmit({ prompt: '/health' } as any)
  expect((slash as any).sessionTitle).toBeUndefined()
  const first = await $.classic.UserPromptSubmit({ prompt: 'Can you please fix the login redirect bug in auth.ts?', source: 'user' } as any)
  expect((first as any).sessionTitle).toBe('Fix login redirect bug auth.ts')
  const second = await $.classic.UserPromptSubmit({ prompt: 'now add tests for the parser module' } as any)
  expect((second as any).sessionTitle).toBeUndefined()
})

test('23: a session that already has a title keeps it; a vague first prompt waits for the next', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  on('classic.UserPromptSubmit', () => ({}))
  await startSession($)

  expect(((await $.classic.UserPromptSubmit({ prompt: 'fix it' } as any)) as any).sessionTitle).toBeUndefined()
  expect(((await $.classic.UserPromptSubmit({ prompt: 'refactor the payment retry logic' } as any)) as any).sessionTitle).toBe(
    'Refactor payment retry logic',
  )
})

test('23: a resumed session with a title is left alone', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  on('classic.UserPromptSubmit', () => ({}))
  await startSession($)

  const kept = await $.classic.UserPromptSubmit({ prompt: 'implement the export feature', session_title: 'Mine' } as any)
  expect((kept as any).sessionTitle).toBeUndefined()
  const later = await $.classic.UserPromptSubmit({ prompt: 'implement the import feature' } as any)
  expect((later as any).sessionTitle).toBeUndefined()
})

test('24: /snaps lists snapshots with read-only git only and previews changed files', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1_700_001_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  await startSession($)

  const answer = await cmd($, 'snaps')
  expect(answer.text).toContain('2 snapshots')
  expect(answer.text).toContain('#2 bbbbbbbbbb 1 file changed: claude checkpoint: turn 1')

  // Every git call was for-each-ref or diff --stat, nothing else, and the newest is compared with the one before it.
  expect(box.git.length).toBe(3)
  for (const argv of box.git) {
    expect(argv[0]).toBe('git')
    expect(['for-each-ref', 'diff']).toContain(argv[1])
    expect(isReadOnlyGit(argv.slice(1)), argv.join(' ')).toBe(true)
  }
  expect(box.git[2]).toContain('a'.repeat(40))
  expect(box.git[2]?.at(-1)).toBe('b'.repeat(40))
  expect(box.git[1]?.at(-2)).toBe(`${'a'.repeat(40)}^1`)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const pane = await $.ui.mount(PANE('extras-snaps', surface))
    expect(await pane.find({ type: 'Button', key: 'snap-1' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'snap-2' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /src\/a\.ts/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Read-only/ })).toBeDefined()
    await pane.press({ key: 'snap-1' })
    expect(await pane.find({ type: 'Text', text: /#1 · refs\/claude-checkpoints\/1/ })).toBeDefined()
    await pane.unmount()
  }
  // Viewing and selecting changed nothing and ran no other command.
  expect(box.git.length).toBe(3)
})

test('24: refresh re-reads, and a non-repository is reported without crashing', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1_700_001_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  box.procs = () => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories)' })
  await startSession($)

  const answer = await cmd($, 'snaps')
  expect(answer.text).toMatch(/Could not read snapshots: fatal: not a git repository/)
  const pane = await $.ui.mount(PANE('extras-snaps'))
  expect(await pane.find({ type: 'Text', text: /Could not read snapshots/ })).toBeDefined()
  await pane.press({ key: 'snaps-refresh' })
  expect(box.git.length).toBe(2)
  await pane.unmount()
})

test('24: no snapshots yet', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  box.procs = () => ({ exitCode: 0, stdout: '', stderr: '' })
  await startSession($)

  expect((await cmd($, 'snaps')).text).toMatch(/No snapshots under refs\/claude-checkpoints/)
})

test('a /clear resets the recorded session', async ($, on) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  on('session.end', (_: unknown, e: any) => ({ sessionId: e.sessionId }))
  const run = await makeCalls($, on, clock)
  await startSession($)
  await run({ tool: 'Bash', command: 'ls' }, 5, 1)
  expect((await cmd($, 'toolcost')).text).toContain('Bash')

  await ($ as any).session.end({ reason: 'clear', sessionId: 's', resume: {} })
  expect((await cmd($, 'toolcost')).text).toBe('No tool calls recorded yet.')
})

test('recording never changes a tool call result, and a throwing tool still records', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/jane', USER: 'jane' })
  on('tool.call', (_: unknown, e: any) =>
    e.command === 'deny' ? { deny: 'no' } : { result: { stdout: 'hi' }, text: 'hi' },
  )
  await startSession($)

  const ok = await $.tool.call({ tool: 'Bash', command: 'echo hi' })
  expect((ok as any).text).toBe('hi')
  const denied = await $.tool.call({ tool: 'Bash', command: 'deny' })
  expect((denied as any).deny).toBe('no')
  const cost = (await cmd($, 'toolcost')).text
  expect(cost).toContain('Bash')
  const tools = await $.ui.mount(PANE('extras-tools'))
  expect(await tools.find({ type: 'Text', text: /Bash · 1 failed/ })).toBeDefined()
  await tools.unmount()
})
