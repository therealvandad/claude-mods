import { expect, test } from 'claude-code/testing'

import {
  analyzeProject,
  closeSiblings,
  compareVersions,
  contrastText,
  decisionTable,
  destructiveSummary,
  editDistance,
  estimateText,
  fixKey,
  isQuiet,
  joinPath,
  judgeTool,
  keywords,
  maskSecrets,
  noteFix,
  parseHourRange,
  parseOption,
  parseVersion,
  pathCandidates,
  quietRanges,
  recordAnswers,
  riskyEdit,
  sanitizeDb,
  tickGoal,
  toastAllowed,
  undoGuide,
  usualAnswer,
  DOCTOR_TOOLS,
} from './pure'

const PANE = {
  plugin: 'assist-more',
  component: 'Pane',
  requestId: 'assist-more-main',
  surface: 'desktop',
  props: { title: 'Assist more', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const ROW = (props: Record<string, unknown>) =>
  ({
    plugin: 'assist-more',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...props },
  }) as const

const NOON = new Date(2026, 10, 25, 12, 30).getTime()
const MIN = 60_000

// ------------------------------------------------------------ pure functions

test('versions parse and compare, and the doctor rules flag missing and old tools', async () => {
  expect(parseVersion('git version 2.43.0')).toEqual([2, 43, 0])
  expect(parseVersion('v20.10.0')).toEqual([20, 10, 0])
  expect(parseVersion('go version go1.22.1 darwin/arm64')).toEqual([1, 22, 1])
  expect(parseVersion('Python 3.11')).toEqual([3, 11, 0])
  expect(parseVersion('no digits')).toBeUndefined()
  expect(compareVersions([2, 9, 0], [2, 30, 0])).toBe(-1)
  expect(compareVersions([3, 0, 0], [3, 0, 0])).toBe(0)

  const git = DOCTOR_TOOLS.find(t => t.name === 'git')!
  expect(judgeTool(git, { exitCode: 0, stdout: 'git version 2.43.0\n', stderr: '' }).status).toBe('ok')
  expect(judgeTool(git, { exitCode: 0, stdout: 'git version 2.20.1\n', stderr: '' }).status).toBe('old')
  expect(judgeTool(git, undefined).status).toBe('missing')
  expect(judgeTool(git, { exitCode: 3, stdout: '', stderr: 'boom' }).status).toBe('error')
  // The only commands the doctor can run are version queries.
  for (const t of DOCTOR_TOOLS) expect(['--version', 'version']).toContain(t.argv[1])
})

test('contrast ratio follows WCAG', async () => {
  expect(contrastText('#000', '#fff')).toMatch(/21\.00:1/)
  expect(contrastText('#767676', '#ffffff')).toMatch(/4\.54:1[\s\S]*AA normal text \(4\.5\) pass/)
  const grey = contrastText('#777777', '#ffffff')
  expect(grey).toMatch(/AA normal text \(4\.5\) FAIL/)
  expect(grey).toMatch(/AA large text \(3\) pass/)
  expect(contrastText('nope', '#fff')).toMatch(/Usage/)
})

test('secrets are masked in recorded commands', async () => {
  expect(maskSecrets('API_KEY=abc123 npm run deploy')).toBe('API_KEY=*** npm run deploy')
  expect(maskSecrets('curl -H "Authorization: Bearer abcdef123456" https://x.io')).toContain('Bearer ***')
  expect(maskSecrets('deploy --token s3cr3t --env prod')).toBe('deploy --token *** --env prod')
  expect(maskSecrets('git clone https://bob:hunter2@github.com/a/b.git')).toBe('git clone https://bob:***@github.com/a/b.git')
  expect(maskSecrets('echo ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('echo ***')
  expect(maskSecrets('npm test')).toBe('npm test')
})

test('destructive commands get a plain one-line summary and safe ones none', async () => {
  expect(destructiveSummary('rm a.txt b.txt')).toBe('Deletes 2 files in this folder: a.txt, b.txt')
  expect(destructiveSummary('rm -rf build dist')).toBe('Deletes 2 paths recursively (folders with everything inside) in this folder: build, dist')
  expect(destructiveSummary('rm src/old/x.ts')).toBe('Deletes 1 file in src/old: x.ts')
  expect(destructiveSummary('sudo rm -f /tmp/a.log')).toBe('Deletes 1 file in /tmp: a.log')
  expect(destructiveSummary('rm *.log')).toMatch(/every file matching \*\.log in this folder/)
  expect(destructiveSummary('mv a.txt b.txt')).toBe('Moves a.txt to b.txt (an existing b.txt is replaced)')
  expect(destructiveSummary('mv a b c dest/')).toBe('Moves 3 items from this folder into dest/ (same-named files there are replaced)')
  expect(destructiveSummary('mv -n a b')).toBeUndefined()
  expect(destructiveSummary('git clean -fd')).toBe('Removes untracked files and folders in the repository from here down')
  expect(destructiveSummary('git clean -n')).toBeUndefined()
  expect(destructiveSummary('git clean')).toBeUndefined()
  expect(destructiveSummary('git reset --hard HEAD~2')).toMatch(/Discards every uncommitted change/)
  expect(destructiveSummary('ls -la && echo "rm -rf x"')).toBeUndefined()
  expect(destructiveSummary('cd x && rm -r old')).toBe('Deletes 1 path recursively (folders with everything inside) in this folder: old')
  expect(destructiveSummary('npm test')).toBeUndefined()
})

test('weighted decision table', async () => {
  const a = parseOption('Redis + fast (3) + simple - uses memory (2)')!
  expect(a.name).toBe('Redis')
  expect(a.pros).toEqual([{ t: 'fast', w: 3 }, { t: 'simple', w: 1 }])
  expect(a.cons).toEqual([{ t: 'uses memory', w: 2 }])
  expect(parseOption('+ nothing')).toBeUndefined()
  const b = parseOption('Postgres + durable (5) - setup (1)')!
  const table = decisionTable({ question: 'Which store?', options: [a, b] })
  expect(table[0]).toBe('Which store?')
  expect(table.join('\n')).toMatch(/Redis\s+4\s+2\s+\+2/)
  expect(table.join('\n')).toMatch(/Postgres\s+5\s+1\s+\+4[\s\S]*★/)
  expect(table[table.length - 1]).toMatch(/Leading on weighted score: Postgres/)
  expect(decisionTable({ question: '', options: [] })[0]).toMatch(/Start with \/amdecide/)
})

test('time estimates come from similar past tasks, as text', async () => {
  expect(keywords('Fix the login redirect bugs')).toEqual(['fix', 'login', 'redirect', 'bug'])
  const tasks = [
    { label: 'fix login redirect', ms: 20 * MIN, at: 1 },
    { label: 'fix login timeout', ms: 40 * MIN, at: 2 },
    { label: 'write release notes', ms: 5 * MIN, at: 3 },
  ]
  const text = estimateText(tasks, 'fix login page crash')
  expect(text).toMatch(/took about 30m \(median of 2, from 20m to 40m\)/)
  expect(text).toMatch(/matching words: fix, login/)
  expect(estimateText(tasks, 'migrate database')).toMatch(/No similar finished tasks/)
  expect(estimateText([], 'anything')).toMatch(/No similar/)
})

test('typo detection: edit distance and close siblings', async () => {
  expect(editDistance('utils', 'utls')).toBe(1)
  expect(editDistance('abc', 'xyz')).toBe(3)
  expect(closeSiblings('utls', ['src', 'utils', 'lib'])).toEqual(['utils'])
  expect(closeSiblings('srcs', ['src', 'lib'])).toEqual(['src'])
  expect(closeSiblings('totally', ['src', 'lib'])).toEqual([])
  expect(closeSiblings('ab', ['abc'])).toEqual([])
  expect(closeSiblings('Readme.md', ['README.md', 'x'])).toEqual(['README.md'])
  expect(pathCandidates('cat src/utls/a.ts && ls docs')).toEqual(['src/utls/a.ts', 'docs'])
  expect(pathCandidates('mkdir -p newdir && touch new.txt')).toEqual([])
  expect(pathCandidates('cp a.txt b.txt')).toEqual(['a.txt'])
  expect(pathCandidates('python -c "print(1)"')).toEqual([])
  expect(pathCandidates('echo hi > out.txt')).toEqual([])
  expect(pathCandidates('cat https://x.io/a.txt $HOME/a.txt *.md')).toEqual([])
  expect(joinPath('/p/a', '../b/./c')).toBe('/p/b/c')
  expect(joinPath('/p', '/abs/x')).toBe('/abs/x')
})

test('risky edits: Dockerfile, CI yml, Makefile and package.json scripts only', async () => {
  expect(riskyEdit('Edit', { file_path: '/p/Dockerfile' })).toMatch(/Dockerfile/)
  expect(riskyEdit('Write', { file_path: '/p/.github/workflows/ci.yml' })).toMatch(/CI pipeline/)
  expect(riskyEdit('Edit', { file_path: '/p/src/config.yml' })).toBeUndefined()
  expect(riskyEdit('Edit', { file_path: '/p/Makefile' })).toMatch(/Makefile/)
  expect(riskyEdit('Edit', { file_path: '/p/package.json', old_string: '"test": "jest"', new_string: '"test": "vitest"' })).toMatch(/scripts/)
  expect(riskyEdit('Edit', { file_path: '/p/package.json', old_string: '"version": "1.0.0"', new_string: '"version": "1.0.1"' })).toBeUndefined()
  expect(riskyEdit('Write', { file_path: '/p/package.json', content: '{ "scripts": { "build": "tsc" } }' })).toMatch(/scripts/)
  expect(riskyEdit('Read', { file_path: '/p/Dockerfile' })).toBeUndefined()
})

test('project card guesses from names and the head of manifests', async () => {
  const js = analyzeProject(
    ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'src', 'README.md', '.git', '.github'],
    [{ name: 'package.json', text: '{"scripts":{"test":"vitest run","build":"tsc"},"dependencies":{"react":"^18"},"devDependencies":{"vitest":"1"}}' }],
  )
  expect(js.language).toBe('TypeScript / JavaScript (Node)')
  expect(js.frameworks).toEqual(['React'])
  expect(js.test).toBe('pnpm test')
  expect(js.build).toBe('pnpm run build')
  expect(js.dirs).toEqual(['src'])
  expect(js.flags).toContain('README (README.md)')

  // A manifest cut at 4 KB is not valid JSON: the card still finds the scripts.
  const cut = analyzeProject(['package.json'], [{ name: 'package.json', text: '{"scripts":{"test":"jest"},"dependencies":{"express":"4","lod' }])
  expect(cut.test).toBe('npm test')
  expect(cut.frameworks).toEqual(['Express'])

  expect(analyzeProject(['pyproject.toml', 'tests'], [{ name: 'pyproject.toml', text: '[tool.poetry]\ndependencies = { django = "4" }' }])).toMatchObject({ language: 'Python', test: 'pytest', frameworks: ['Django'], pm: 'poetry' })
  expect(analyzeProject(['Cargo.toml'], []).test).toBe('cargo test')
  expect(analyzeProject(['go.mod'], []).test).toBe('go test ./...')
  expect(analyzeProject(['notes.txt'], []).language).toBe('unknown')
})

test('undo guide is text built from read-only facts', async () => {
  const dirty = undoGuide({ isRepo: true, changed: ['a.ts', 'b.ts'], staged: 1, untracked: 1, last: 'abc123 add thing', hasCommit: true, branch: 'main' })
  expect(dirty).toMatch(/2 changed files \(1 staged\), 1 new untracked file/)
  expect(dirty).toMatch(/git stash push/)
  expect(dirty).toMatch(/git revert HEAD/)
  expect(dirty).toMatch(/I never run these/)
  expect(undoGuide({ isRepo: false, changed: [], staged: 0, untracked: 0, last: '', hasCommit: false, branch: '' })).toMatch(/not a git repository/)
  expect(undoGuide({ isRepo: true, changed: [], staged: 0, untracked: 0, last: 'x y', hasCommit: true, branch: 'main' })).toMatch(/clean/)
})

test('learning moments offer on the second sighting only, once', async () => {
  const key = fixKey('const a = 1', 'const a = 2')!
  expect(fixKey('x', 'y')).toBeUndefined()
  const one = noteFix({}, key, 'a.ts')
  expect(one.offer).toBe(false)
  const two = noteFix(one.seen, key, 'b.ts')
  expect(two.offer).toBe(true)
  expect(noteFix(two.seen, key, 'c.ts').offer).toBe(false)
})

test('usual answers need repetition and a clear majority', async () => {
  let all = {}
  all = recordAnswers(all, { 'Which test runner?': 'vitest' })
  expect(usualAnswer(all, 'Which test runner?')).toBeUndefined()
  all = recordAnswers(all, { 'which test runner?': 'vitest' })
  all = recordAnswers(all, { 'Which test runner?': 'jest' })
  expect(usualAnswer(all, 'Which test runner?')).toEqual({ answer: 'vitest', n: 2, total: 3 })
  all = recordAnswers(all, { 'Which test runner?': 'jest' })
  expect(usualAnswer(all, 'Which test runner?')).toBeUndefined()
})

test('quiet hours, toast gate and stored data are bounded and sane', async () => {
  expect(parseHourRange('22-7')).toEqual([22, 23, 0, 1, 2, 3, 4, 5, 6])
  expect(parseHourRange('9-17:00')).toEqual([9, 10, 11, 12, 13, 14, 15, 16])
  expect(parseHourRange('25-3')).toBeUndefined()
  expect(parseHourRange('banana')).toBeUndefined()
  const q = Array.from({ length: 24 }, (_, h) => h >= 22 || h < 7)
  expect(quietRanges(q)).toBe('00:00-07:00, 22:00-00:00')
  expect(quietRanges(Array.from({ length: 24 }, () => false))).toMatch(/none/)
  expect(isQuiet(q, new Date(2026, 10, 25, 23, 0).getTime())).toBe(true)
  expect(isQuiet(q, NOON)).toBe(false)
  const open = Array.from({ length: 24 }, () => false)
  expect(toastAllowed({ isCalm: false, quiet: open, now: NOON, lastAt: -Infinity })).toBe(true)
  expect(toastAllowed({ isCalm: true, quiet: open, now: NOON, lastAt: -Infinity })).toBe(false)
  expect(toastAllowed({ isCalm: false, quiet: q, now: new Date(2026, 10, 25, 23).getTime(), lastAt: -Infinity })).toBe(false)
  expect(toastAllowed({ isCalm: false, quiet: open, now: NOON, lastAt: NOON - 2 * MIN })).toBe(false)
  expect(toastAllowed({ isCalm: false, quiet: open, now: NOON, lastAt: NOON - 3 * MIN })).toBe(true)

  expect(sanitizeDb(undefined).flags.risk).toBe(true)
  expect(sanitizeDb({ flags: { learn: true, risk: false }, quiet: [true], runbooks: [{ nope: 1 }], goals: 'x' })).toMatchObject({ flags: { learn: true, risk: false, typo: true }, runbooks: [], goals: [] })
  expect(sanitizeDb({ quiet: [true] }).quiet.length).toBe(24)
  const goals = [{ text: 'tests', target: 2, count: 1, doneAt: 0 }]
  const r = tickGoal(goals, 0, 1, 99)
  expect(r.done?.text).toBe('tests')
  expect(r.goals[0]).toMatchObject({ count: 2, doneAt: 99 })
  expect(tickGoal(r.goals, 0, 1, 100).done).toBeUndefined()
})

// ------------------------------------------------------------ engine behaviour

type Rec = {
  toasts: string[]
  filled: string[]
  opened: string[]
  registered: string[]
  played: string[]
  ran: string[][]
  now: number
  cwd: string
  calm: boolean
  box: string
  files: Record<string, { name: string; kind: string; size: number }[]>
  texts: Record<string, string>
  tools: Record<string, { exitCode: number; stdout: string; stderr: string } | 'missing'>
  onTool: (e: any) => unknown
  onRun: ((e: { argv: string[] }) => { exitCode: number; stdout: string; stderr: string }) | undefined
  onList: ((path: string) => unknown[] | undefined) | undefined
  answers: Record<string, string>
}

const engine = (on: (...args: any[]) => unknown, seed: Record<string, unknown> = {}, opts: { noSettings?: boolean } = {}) => {
  const store: Record<string, unknown> = { ...seed }
  const rec: Rec = { toasts: [], filled: [], opened: [], registered: [], played: [], ran: [], now: NOON, cwd: '/proj', calm: false, box: '', files: {}, texts: {}, tools: {}, onTool: () => ({ result: {} }), onRun: undefined, onList: undefined, answers: {} }
  const dirs = () => new Set(Object.keys(rec.files))
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
  on('prompt.read', () => ({ value: { text: rec.box, cursor: rec.box.length } }))
  on('audio.play', (_: unknown, e: { clip: { asset: string } }) => {
    rec.played.push(e.clip?.asset ?? JSON.stringify(e))

    return { value: undefined }
  })
  on('session.cwd', () => ({ value: rec.cwd }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.call', (_: unknown, e: unknown) => rec.onTool(e))
  on('ui.render', ($: any, e: any, next: any) => {
    if (e.component === 'AskUserQuestion') return next(e)
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })
  on('prompt.compose', () => ({ sections: [{ id: 'core', scope: 'shared', text: 'core' }] }))
  on('fs.list', (_: unknown, e: { path: string }) => {
    const custom = rec.onList?.(e.path)

    if (custom !== undefined) return { value: custom }
    const entries = rec.files[e.path]

    if (entries === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: entries.map(x => ({ ...x, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => ({
    value: dirs().has(e.path) || Object.values(rec.files).some((es, i) => es.some(x => `${Object.keys(rec.files)[i]}/${x.name}` === e.path)),
  }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    const t = rec.texts[e.path]

    if (t === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: t }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    rec.ran.push(e.argv)

    if (rec.onRun !== undefined) return { value: rec.onRun(e) }
    const known = rec.tools[e.argv[0]!]

    if (known === undefined || known === 'missing') throw new Error('spawn ENOENT')

    return { value: known }
  })
  if (opts.noSettings !== true) {
    on('state.get', (_: unknown, e: { plugin: string; key: string }, next: (x: unknown) => unknown) =>
      e.plugin === 'settings' && e.key === 'isCalm' ? { value: { value: rec.calm, version: 1 } } : next(e),
    )
  }
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

const start = ($: any, cwd = '/') => $.session.start({ cwd, surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = '') => ((await $.command.run({ command, args, origin: 'user' })) as { text: string }).text
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text)

test('every command starts with am, is registered once, and /am lists them all', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  const help = await run($, 'am')

  expect(rec.registered.length).toBeGreaterThanOrEqual(23)
  expect(new Set(rec.registered).size).toBe(rec.registered.length)

  for (const name of rec.registered) {
    expect(name.startsWith('am')).toBe(true)
    expect(help).toContain(`/${name}`)
  }
  expect(await run($, 'amcontrast', '#000 #fff')).toMatch(/21\.00:1/)
})

test('/amdoctor reads versions only, flags missing and old tools, and the pane shows the same lines', async ($, on) => {
  const { rec } = engine(on)
  rec.tools.git = { exitCode: 0, stdout: 'git version 2.20.0\n', stderr: '' }
  rec.tools.node = { exitCode: 0, stdout: 'v20.10.0\n', stderr: '' }
  rec.tools.python3 = { exitCode: 0, stdout: 'Python 3.11.4\n', stderr: '' }
  await start($)
  const out = await run($, 'amdoctor')

  expect(out).toMatch(/! git\s+2\.20\.0\s+older than 2\.30/)
  expect(out).toMatch(/✓ node\s+20\.10\.0/)
  expect(out).toMatch(/– cargo\s+not found or could not run/)
  expect(out).toMatch(/1 tool need attention/)
  expect(rec.ran.length).toBe(DOCTOR_TOOLS.length)

  for (const argv of rec.ran) expect(['--version', 'version']).toContain(argv[1])
  rec.tools.node = 'missing'
  expect(await run($, 'amdoctor')).toMatch(/✗ node/)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /✗ node/ })).toBeDefined()
  await ui.unmount()
})

test('/amproject lists names, reads only manifests and caps the listing', async ($, on) => {
  const { rec } = engine(on)
  rec.files['/proj'] = [
    { name: 'package.json', kind: 'file', size: 900 },
    { name: 'src', kind: 'dir', size: 0 },
    { name: 'README.md', kind: 'file', size: 100 },
    { name: 'secrets.txt', kind: 'file', size: 10 },
  ]
  rec.texts['/proj/package.json'] = '{"scripts":{"test":"jest"},"dependencies":{"next":"14"}}'
  rec.texts['/proj/README.md'] = 'SHOULD NOT BE READ'
  await start($)
  const out = await run($, 'amproject')

  expect(out).toMatch(/Project card for \/proj/)
  expect(out).toMatch(/Frameworks  Next\.js/)
  expect(out).toMatch(/Test        npm test/)
  expect(out).toMatch(/README \(README\.md\)/)
  expect(out).not.toMatch(/SHOULD NOT BE READ/)
})

test('run-book: records Bash between start and stop, masks secrets, fills the prompt, never runs', async ($, on) => {
  const { rec, store } = engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'echo before' })
  expect(await run($, 'amrun', 'start deploy')).toMatch(/Recording "deploy"/)
  expect(await run($, 'amrun', 'start other')).toMatch(/Already recording/)
  await $.tool.call({ tool: 'Bash', command: 'npm ci' })
  await $.tool.call({ tool: 'Bash', command: 'API_TOKEN=abc123 npm run deploy' })
  await $.tool.call({ tool: 'Bash', command: 'npm ci' })
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  expect(await run($, 'amrun', 'stop')).toMatch(/Saved run-book "deploy" with 3 commands/)
  await $.tool.call({ tool: 'Bash', command: 'echo after' })

  const shown = await run($, 'amrun', 'show deploy')
  expect(shown).toContain('1. npm ci')
  expect(shown).toContain('2. API_TOKEN=*** npm run deploy')
  expect(shown).not.toContain('abc123')
  expect(JSON.stringify(store)).not.toContain('abc123')
  expect(shown).not.toContain('echo before')
  expect(shown).not.toContain('echo after')

  expect(await run($, 'amrun', 'fill deploy')).toMatch(/Prompt is in the box/)
  expect(rec.filled[0]).toMatch(/run-book called "deploy"[\s\S]*masked[\s\S]*```sh\nnpm ci\nAPI_TOKEN=\*\*\* npm run deploy/)
  expect(await run($, 'amrun', 'list')).toMatch(/deploy \(3 commands\)/)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-Runbooks' })
  expect(await ui.find({ type: 'Text', text: /\$ npm ci/ })).toBeDefined()
  await ui.press({ key: 'rb-fill' })
  expect(rec.filled.length).toBe(2)
  await ui.unmount()

  expect(await run($, 'amrun', 'del deploy')).toMatch(/Deleted/)
  expect(await run($, 'amrun', 'show deploy')).toMatch(/No run-book/)
  await run($, 'amrun', 'start empty')
  expect(await run($, 'amrun', 'stop')).toMatch(/nothing was saved/)
})

test('task timer gives a text estimate from similar past tasks', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  expect(await run($, 'amtask', 'start fix login redirect')).toMatch(/No similar finished tasks/)
  rec.now += 20 * MIN
  expect(await run($, 'amtask', 'done')).toMatch(/took 20m/)
  await run($, 'amtask', 'start fix login timeout')
  rec.now += 40 * MIN
  await run($, 'amtask', 'done')
  const began = await run($, 'amtask', 'start fix login page crash')
  expect(began).toMatch(/took about 30m \(median of 2/)
  expect(await run($, 'amtask', 'start another')).toMatch(/Already timing/)
  rec.now += 2 * 86_400_000
  expect(await run($, 'amtask', 'done')).toMatch(/not recorded/)
  expect(await run($, 'amtask', 'list')).toMatch(/40m\s+fix login timeout/)
  expect(await run($, 'amtask', 'done')).toMatch(/No task is being timed/)
})

test('/amsplit fills the prompt with the request or the current draft and never sends', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  expect(await run($, 'amsplit', 'rebuild the billing system')).toMatch(/Prompt is in the box/)
  expect(rec.filled[0]).toMatch(/Split it into small steps[\s\S]*The request:\nrebuild the billing system/)
  rec.box = 'migrate everything to postgres'
  await run($, 'amsplit')
  expect(rec.filled[1]).toMatch(/The request:\nmigrate everything to postgres/)
  rec.box = ''
  await run($, 'amsplit')
  expect(rec.filled[2]).toMatch(/<paste the big request here>/)
})

test('decision helper builds a weighted table from /amdecide and /amopt', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'amdecide', 'Which cache?')).toMatch(/No options yet/)
  await run($, 'amopt', 'Redis + fast (3) - memory (2)')
  const table = await run($, 'amopt', 'Memcached + simple (2)')
  expect(table).toMatch(/Redis\s+3\s+2\s+\+1/)
  expect(table).toMatch(/Memcached\s+2\s+0\s+\+2[\s\S]*★/)
  expect(await run($, 'amopt', 'Redis + persistence (4)')).toMatch(/Redis\s+7\s+2\s+\+5/)
  expect(await run($, 'amopt', 'del 2')).not.toMatch(/Memcached/)
  expect(await run($, 'amopt', 'bad')).toMatch(/bad/)
  expect(await run($, 'amopt', '+ nothing')).toMatch(/Usage/)
  expect(await run($, 'amdecide', 'clear')).toMatch(/cleared/)
})

test('risk reminder: edits to build and CI files toast at most once per 3 minutes, never when calm or quiet', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.ts', old_string: 'a', new_string: 'b' })
  expect(rec.toasts.length).toBe(0)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/Dockerfile', old_string: 'FROM a', new_string: 'FROM b' })
  expect(rec.toasts.length).toBe(1)
  expect(rec.toasts[0]).toMatch(/Dockerfile/)
  rec.now += 2 * MIN
  await $.tool.call({ tool: 'Write', file_path: '/proj/.github/workflows/ci.yml', content: 'x' })
  expect(rec.toasts.length).toBe(1)
  rec.now += 2 * MIN
  await $.tool.call({ tool: 'Write', file_path: '/proj/.github/workflows/ci.yml', content: 'x' })
  expect(rec.toasts.length).toBe(2)

  rec.now += 10 * MIN
  rec.calm = true
  await $.tool.call({ tool: 'Edit', file_path: '/proj/Makefile', old_string: 'a', new_string: 'b' })
  expect(rec.toasts.length).toBe(2)
  rec.calm = false
  await run($, 'amquiet', '12-13')
  await $.tool.call({ tool: 'Edit', file_path: '/proj/Makefile', old_string: 'a', new_string: 'b' })
  expect(rec.toasts.length).toBe(2)
  await run($, 'amquiet', 'none')
  await run($, 'amrisk', 'off')
  await $.tool.call({ tool: 'Edit', file_path: '/proj/Makefile', old_string: 'a', new_string: 'b' })
  expect(rec.toasts.length).toBe(2)
  expect(await run($, 'amrisk', 'on')).toMatch(/is on/)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/Makefile', old_string: 'a', new_string: 'b' })
  expect(rec.toasts.length).toBe(3)
})

test('gentle correction toasts for a close sibling, never blocks, and is rate limited', async ($, on) => {
  const { rec } = engine(on)
  const seen: string[] = []
  rec.onTool = (e: { command?: string }) => {
    seen.push(e.command ?? '')

    return { result: {} }
  }
  rec.files['/proj'] = [{ name: 'src', kind: 'dir', size: 0 }]
  rec.files['/proj/src'] = [
    { name: 'utils', kind: 'dir', size: 0 },
    { name: 'index.ts', kind: 'file', size: 1 },
  ]
  rec.files['/proj/src/utils'] = []
  await start($)

  const r = await $.tool.call({ tool: 'Bash', command: 'ls src/utls' })
  expect(r.deny).toBeUndefined()
  expect(seen).toContain('ls src/utls')
  expect(rec.toasts.length).toBe(1)
  expect(rec.toasts[0]).toMatch(/"src\/utls" does not exist\. Did you mean "src\/utils"\?/)

  rec.now += MIN
  await $.tool.call({ tool: 'Bash', command: 'ls src/utls' })
  expect(rec.toasts.length).toBe(1)
  rec.now += 4 * MIN
  await $.tool.call({ tool: 'Bash', command: 'cat src/index.ts && ls src/utils' })
  expect(rec.toasts.length).toBe(1)
  await $.tool.call({ tool: 'Bash', command: 'ls src/zzzzzz' })
  expect(rec.toasts.length).toBe(1)
  await run($, 'amtypo', 'off')
  rec.now += 10 * MIN
  await $.tool.call({ tool: 'Bash', command: 'ls src/utls' })
  expect(rec.toasts.length).toBe(1)
})

test('a destructive Bash command gets a one-line banner above the call, others do not', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount(ROW({ input: { command: 'rm -rf build dist' } }))
  expect((await ui.find({ type: 'Text', text: /^▲/ }))?.text).toMatch(/Deletes 2 paths recursively/)
  expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeDefined()
  await ui.unmount()

  const safe = await $.ui.mount(ROW({ input: { command: 'npm test' } }))
  expect(await safe.find({ type: 'Text', text: /^▲/ })).toBeUndefined()
  expect(await safe.find({ type: 'Text', text: /engine row/ })).toBeDefined()
  await safe.unmount()

  await run($, 'amsummary', 'off')
  const off = await $.ui.mount(ROW({ input: { command: 'rm a' } }))
  expect(await off.find({ type: 'Text', text: /^▲/ })).toBeUndefined()
  await off.unmount()
})

test('learning moments are off by default, then offer one toast on the second identical fix', async ($, on) => {
  const { rec } = engine(on)
  await start($)
  const edit = (file: string) => $.tool.call({ tool: 'Edit', file_path: file, old_string: 'const a = foo(1)', new_string: 'const a = foo(1, true)' })
  await edit('/proj/a.ts')
  await edit('/proj/b.ts')
  expect(rec.toasts.length).toBe(0)
  expect(await run($, 'amlearn', 'save')).toMatch(/No fix is waiting/)

  expect(await run($, 'amlearn', 'on')).toMatch(/is on/)
  await edit('/proj/a.ts')
  expect(rec.toasts.length).toBe(0)
  await edit('/proj/b.ts')
  expect(rec.toasts.length).toBe(1)
  expect(rec.toasts[0]).toMatch(/Same fix twice[\s\S]*\/amlearn save/)
  rec.now += 10 * MIN
  await edit('/proj/c.ts')
  expect(rec.toasts.length).toBe(1)
  expect(await run($, 'amlearn', 'save')).toMatch(/Saved/)
  expect(await run($, 'amlearn', 'list')).toMatch(/1\. "const a = foo\(1\)" -> "const a = foo\(1, true\)"/)
  expect(await run($, 'amlearn', 'clear')).toMatch(/Cleared/)
  expect(await run($, 'amlearn', 'list')).toMatch(/No saved fixes/)
})

test('smart defaults record answers only when on and show a hint on the dialog', async ($, on) => {
  const { store, rec } = engine(on)
  rec.answers = { 'Which runner?': 'vitest' }
  rec.onTool = () => ({ result: { questions: [], answers: rec.answers } })
  await start($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which runner?', header: 'Runner', options: [], multiSelect: false }] })
  expect(JSON.stringify(store)).not.toContain('vitest')

  expect(await run($, 'amdefaults', 'on')).toMatch(/is on/)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which runner?', header: 'Runner', options: [], multiSelect: false }] })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which runner?', header: 'Runner', options: [], multiSelect: false }] })
  rec.answers = { 'Which runner?': 'jest' }
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which runner?', header: 'Runner', options: [], multiSelect: false }] })
  expect(await run($, 'amdefaults', 'list')).toMatch(/which runner: vitest x2, jest x1/)

  const ui = await $.ui.mount({
    plugin: 'assist-more',
    surface: 'terminal',
    component: 'AskUserQuestion',
    requestId: 'q1',
    props: { tool: 'AskUserQuestion', questions: [{ question: 'Which runner?', header: 'Runner', options: [], multiSelect: false }] },
  })
  expect((await ui.find({ type: 'Text', text: /usual answer/ }))?.text).toBe('Your usual answer to "Runner": vitest (2 of 3 times)')
  await ui.unmount()

  expect(await run($, 'amdefaults', 'clear')).toMatch(/Cleared/)
  expect(await run($, 'amdefaults', 'list')).toMatch(/No answers/)
})

test('plain-language mode adds one standing section only while on', async ($, on) => {
  engine(on)
  await start($)
  const ids = async () => ((await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })) as unknown as { sections: { id: string; text: string }[] }).sections.map(s => s.id)
  expect(await ids()).toEqual(['core'])
  expect(await run($, 'amplain', 'on')).toMatch(/Plain-language mode is on/)
  expect(await ids()).toEqual(['core', 'assist-more:plain'])
  expect(await run($, 'amplain', 'off')).toMatch(/is off/)
  expect(await ids()).toEqual(['core'])
})

test('/amundo runs only read-only git queries and never the commands it explains', async ($, on) => {
  const { rec } = engine(on)
  rec.onRun = e => {
    const sub = e.argv.find((a, i) => i > 0 && !a.startsWith('-'))
    const out: Record<string, string> = { 'rev-parse': '/proj\n', status: ' M src/a.ts\n?? new.txt\n', log: 'abc123 add thing\n' }

    return { exitCode: 0, stdout: out[sub ?? ''] ?? '', stderr: '' }
  }
  await start($)
  const text = await run($, 'amundo')

  expect(text).toMatch(/1 changed file, 1 new untracked file/)
  expect(text).toMatch(/Last commit: abc123 add thing/)
  const subs = rec.ran.map(a => a.find((x, i) => i > 0 && !x.startsWith('-')))
  expect(rec.ran.every(a => a[0] === 'git')).toBe(true)
  expect(subs.every(s => s === 'rev-parse' || s === 'status' || s === 'log')).toBe(true)
  expect(subs).not.toContain('restore')
  expect(subs).not.toContain('reset')
})

test('/amsound plays only files from its own sounds folder', async ($, on) => {
  const { rec } = engine(on)
  // The plugin root is whatever the engine reports; list that folder.
  rec.onList = path =>
    path.endsWith('/sounds')
      ? [{ name: 'chime.wav', kind: 'file', size: 10, mtimeMs: 0, isLink: false }, { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
      : undefined
  await start($)
  expect(await run($, 'amsound')).toMatch(/Sounds: chime[\s\S]*Copy your own wav files/)
  expect(await run($, 'amsound', 'chime')).toBe('Played chime.wav.')
  expect(rec.played).toEqual(['sounds/chime.wav'])
  expect(await run($, 'amsound', '../../etc/passwd')).toMatch(/letters, digits/)
  expect(await run($, 'amsound', 'nope')).toMatch(/No sound "nope"/)
  expect(rec.played.length).toBe(1)
})

test('goals count up, finish with a badge, and the pane has +1 buttons', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'amgoal')).toMatch(/No goals yet/)
  expect(await run($, 'amgoal', 'add write tests 2')).toMatch(/░░░░░░░░░░ 0\/2  write tests/)
  expect(await run($, 'amgoal', 'add nonsense')).toMatch(/Usage/)
  expect(await run($, 'amgoal', 'tick 1')).toMatch(/█████░░░░░ 1\/2/)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-Goals' })
  await ui.press({ key: 'goal-0' })
  expect(await ui.find({ type: 'Text', text: /2\/2  write tests  ✓ done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /★ write tests/ })).toBeDefined()
  await ui.unmount()
  expect(await run($, 'amgoal', 'tick 1')).toMatch(/2\/2/)
  expect(await run($, 'amgoal', 'del 1')).toMatch(/No goals yet/)
})

test('quiet hours editor: strip, range command and the 24 buttons', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'amquiet', '22-7')).toMatch(/Quiet hours[^\n]*00:00-07:00, 22:00-00:00/)
  expect(await run($, 'amquiet', 'toggle 3')).toMatch(/00:00-03:00, 04:00-07:00/)
  expect(await run($, 'amquiet', 'bad')).toMatch(/Usage/)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-Quiet' })
  const strip = (await texts(ui)).join('')
  expect(strip).toMatch(/Quiet hours/)
  await ui.press({ key: 'hour-12' })
  expect(await run($, 'amquiet')).toMatch(/12:00-13:00/)
  await ui.unmount()
  expect(await run($, 'amquiet', 'none')).toMatch(/none/)
})

test('sprite: own glyphs and name, shown in the pane only', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'amsprite')).toMatch(/Pip  \(•ᴗ•\)/)
  expect(await run($, 'amsprite', 'name Bean')).toMatch(/^Bean/)
  expect(await run($, 'amsprite', 'add (>_<)')).toMatch(/glyph 5 of 5/)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-Buddy' })
  expect(await ui.find({ type: 'Text', text: /^\(>_<\)$/ })).toBeDefined()
  await ui.press({ key: 'sprite-next' })
  expect(await ui.find({ type: 'Text', text: /^\(•ᴗ•\)$/ })).toBeDefined()
  await ui.unmount()
  expect(await run($, 'amsprite', 'pick 9')).toMatch(/Usage/)
  expect(await run($, 'amsprite', 'clear')).toMatch(/Pip/)
})

test('profiles: built-ins, save, use, and one bound to a folder is applied at session start', async ($, on) => {
  const { store } = engine(on)
  await start($, '/proj')
  const list = await run($, 'amprofile')
  expect(list).toMatch(/work \(built in\)/)
  expect(list).toMatch(/demo \(built in\)/)
  expect(await run($, 'amprofile', 'use demo')).toMatch(/Applied "demo"[^\n]*risk off/)
  expect(await run($, 'amquiet')).toMatch(/00:00-00:00|none|00:00-/)
  expect(await run($, 'amprofile', 'save mine')).toMatch(/Saved "mine"/)
  expect(await run($, 'amprofile', 'use work')).toMatch(/defaults on/)
  expect(await run($, 'amprofile', 'bind mine')).toMatch(/bound it to \/proj/)
  await run($, 'amprofile', 'use personal')
  expect(await run($, 'amrisk')).toMatch(/is on/)

  // A new session in the bound folder applies "mine" (risk off) again, from what was stored.
  await start($, '/proj')
  expect(await run($, 'amrisk')).toMatch(/is off/)
  expect(JSON.stringify(store['assist-more'])).toContain('"bound"')
  expect(await run($, 'amprofile', 'del mine')).toMatch(/Deleted/)
  expect(await run($, 'amprofile', 'del work')).toMatch(/built-in ones cannot/)
})

test('/amreset clears recorded data and keeps settings unless "all"', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'amgoal', 'add a 3')
  await run($, 'amdecide', 'q?')
  await run($, 'amtask', 'start x')
  await run($, 'amrun', 'start one')
  await run($, 'amrisk', 'off')
  await run($, 'amsprite', 'name Zed')
  expect(await run($, 'amreset')).toMatch(/Cleared run-books/)
  expect(await run($, 'amgoal')).toMatch(/No goals yet/)
  expect(await run($, 'amtask')).toMatch(/No task is being timed/)
  expect(await run($, 'amrun')).toMatch(/Not recording/)
  expect(await run($, 'amrisk')).toMatch(/is off/)
  expect(await run($, 'amsprite')).toMatch(/^Zed/)
  expect(await run($, 'amreset', 'all')).toMatch(/everything/)
  expect(await run($, 'amrisk')).toMatch(/is on/)
  expect(await run($, 'amsprite')).toMatch(/^Pip/)
})

test('the pane opens on every tab without errors and /ampane picks a tab', async ($, on) => {
  const { rec } = engine(on)
  rec.files['/proj'] = [{ name: 'Cargo.toml', kind: 'file', size: 5 }]
  rec.texts['/proj/Cargo.toml'] = '[dependencies]\ntokio = "1"'
  await start($)
  expect(await run($, 'ampane', 'project')).toMatch(/opened/)
  expect(rec.opened).toContain('assist-more-main')
  expect(await run($, 'ampane', 'nothing')).toMatch(/Tabs:/)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    for (const tab of ['Doctor', 'Project', 'Runbooks', 'Task', 'Decide', 'Goals', 'Quiet', 'Buddy', 'Profiles']) {
      await ui.press({ key: `tab-${tab}` })
    }
    expect(await ui.find({ type: 'Text', text: /Switches/ })).toBeDefined()
    await ui.press({ key: 'flag-risk' })
    expect(await ui.find({ type: 'Button', text: /risk: off|risk: on/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-Project' })
  expect(await ui.find({ type: 'Text', text: /Rust/ })).toBeDefined()
  await ui.unmount()
})

test('the manifest depends on settings and every other mod value has a safe default', async ($, on) => {
  // Nothing from the settings mod is stubbed here: the mod must work on defaults.
  const { rec } = engine(on, {}, { noSettings: true })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/Dockerfile', old_string: 'a', new_string: 'b' })
  expect(rec.toasts.length).toBe(1)
})
