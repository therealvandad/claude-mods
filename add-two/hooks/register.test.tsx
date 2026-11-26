import { expect, mock, test } from 'claude-code/testing'

import { checkArgv } from './guard'
import { COMMAND_NAMES, FEATURE_DEFAULTS } from './register'
import { MODS } from './modlist'

const mk = (surface: 'desktop' | 'terminal') =>
  ({
    plugin: 'add-two',
    component: 'Pane',
    requestId: 'add-two-main',
    surface,
    props: { title: 'add-two', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const
const PANE = mk('desktop')
const PANE_TERM = mk('terminal')

const H = (n: number) => n.toString(16).padStart(40, '0')
const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime()
const CWD = '/r/proj'

// The test session's real folder is the mod's own, so paths come back resolved against it: map them back.
const rel = (p: string | undefined): string => (p === undefined ? '' : p.replace(/^.*\/add-two(\/|$)/, '').replace(`${CWD}/`, '').replace(CWD, '').replace(/^\.$/, ''))

type Reply = { code?: number; out?: string; err?: string; throws?: boolean }
type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number }

const engine = (
  on: any,
  replies: Record<string, Reply> = {},
  opts: { features?: Record<string, boolean>; accent?: string } = {},
) => {
  const clock = mock.clock(on, { now: NOW })
  const db: Record<string, unknown> = {}
  on('store.get', (_: unknown, e: { key: string }) => ({ value: db[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    db[e.key] = e.value

    return { value: undefined }
  })
  let ver = 1
  const reads: { path: string; length?: number }[] = []
  const calls: string[][] = []
  const toasts: string[] = []
  const filled: string[] = []
  const lists: Record<string, Entry[]> = {}
  const files: Record<string, string> = {}
  const features: Record<string, boolean> = { ...(opts.features ?? {}) }
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('fs.list', (_: unknown, e: { path?: string }) => {
    const p = rel(e.path)
    const l = lists[p]

    if (!l) throw new Error('ENOENT')

    return { value: l.map(x => ({ ...x, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_: unknown, e: { path: string; length?: number }) => {
    reads.push({ path: rel(e.path), length: e.length })
    const f = files[rel(e.path)]

    if (f === undefined) throw new Error('ENOENT')

    return { value: e.length !== undefined ? f.slice(0, e.length) : f }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    const isGit = e.argv[0] === 'git'
    const key = isGit ? e.argv.slice(10).join(' ') : e.argv.join(' ')
    calls.push([...e.argv])
    const hit = Object.entries(replies).find(([k]) => key === k || key.startsWith(k))
    const r: Reply = hit ? hit[1] : { code: 128, err: 'fatal: not a git repository' }

    if (r.throws) throw new Error('timed out')

    return { value: { exitCode: r.code ?? 0, stdout: r.out ?? '', stderr: r.err ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('state.get', (_: unknown, e: any, next: any) => {
    if (e.plugin === 'settings' && e.key === 'features') return { value: { value: { shape: 'features-1', value: { ...features } }, version: ++ver } }

    if (e.plugin === 'settings' && e.key === 'accent' && opts.accent !== undefined) return { value: { value: opts.accent, version: 1 } }

    return next(e)
  })

  return { clock, calls, toasts, filled, lists, files, features, reads, db }
}

const start = ($: any) => $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
const run = async ($: any, command: string, args = ''): Promise<string> => ((await $.command.run({ command, args, origin: 'user' } as any)) as { text: string }).text
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text).join('\n')
const svgOf = async (ui: any): Promise<string> => String(((await ui.find({ type: 'Svg' })) as any)?.props.source ?? '')
const send = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const REPO = { 'rev-parse --show-toplevel': { out: '/r/proj\n' } }
const LOG = [
  `${H(5)}|${H(4)} ${H(3)}|Merge branch 'x'|HEAD -> main, origin/main`,
  `${H(4)}|${H(2)}|feat: add a|`,
  `${H(3)}|${H(2)}|fix: fix b|tag: v1.1.0`,
  `${H(2)}|${H(1)}|chore: c|`,
  `${H(1)}||Initial commit|`,
].join('\n')
const GRAPH_TEXT = '*   abc1234 (HEAD -> main) Merge branch x\n|\\\n| * def5678 feat: add a\n* | 1112223 fix: fix b\n|/\n* 4445556 chore: c\n'

test('every command is registered, starts with ae, and /ae lists them all', async ($, on) => {
  engine(on)
  await start($)
  const text = await run($, 'ae')

  for (const name of COMMAND_NAMES) {
    expect(name.startsWith('ae')).toBe(true)
    expect(text).toMatch(new RegExp(`/${name}\\b`))
  }
  expect(COMMAND_NAMES.length).toBe(23)
  expect(text).toMatch(/read-only/)
  expect(text).toMatch(/record-prompts off/)
})

test('the switch ids in the code are valid and everything that records or nags defaults to off', () => {
  const ids = Object.keys(FEATURE_DEFAULTS)
  expect(ids.length).toBeLessThanOrEqual(40)

  for (const id of ids) expect(/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)).toBe(true)

  for (const id of ['toasts', 'sounds', 'status', 'band']) expect(ids).not.toContain(id)

  for (const id of ['record-prompts', 'record-edits', 'record-todos', 'due-toast']) expect(FEATURE_DEFAULTS[id]).toBe(false)
})

test('outside a repository the git commands say so and run nothing but allowlisted git', async ($, on) => {
  const { calls } = engine(on)
  await start($)

  for (const c of ['aegraph', 'aenotes', 'aechange', 'aepr']) {
    const t = await run($, c)
    expect(t).toMatch(c === 'aepr' ? /PR checklist/ : /not a git repository/)
  }
  expect(calls.every(a => a[0] === 'git')).toBe(true)

  for (const a of calls) expect(checkArgv(['git', ...a.slice(10)]).ok).toBe(true)
})

test('/aegraph prints the text graph and the desktop pane draws one safe SVG; other surfaces keep text', async ($, on) => {
  const { calls } = engine(on, { ...REPO, 'log --graph --oneline --decorate --no-color -n 40': { out: GRAPH_TEXT }, 'log --format=%H|%P|%s|%D -n 60': { out: LOG } })
  await start($)
  const text = await run($, 'aegraph')
  expect(text).toMatch(/Git graph/)
  expect(text).toMatch(/\* abc1234 \(HEAD -> main\) Merge branch x/)

  const ui = await $.ui.mount(PANE)
  const svg = await svgOf(ui)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).not.toMatch(/<script|<foreignObject|href=/)
  expect(svg).toContain('add a')
  expect(svg).toContain('v1.1.0')
  expect(await ui.find({ type: 'Svg' })).toBeTruthy()
  await ui.unmount()

  const term = await $.ui.mount(PANE_TERM)
  expect(await term.find({ type: 'Svg' })).toBeFalsy()
  expect(await texts(term)).toMatch(/def5678 feat: add a/)
  await term.unmount()
  expect(calls.every(a => a[0] === 'git')).toBe(true)

  for (const a of calls) expect(checkArgv(['git', ...a.slice(10)]).ok).toBe(true)
})

test('the svg switch off keeps the text graph on desktop too, and git-reads off refuses git', async ($, on) => {
  const { features, calls } = engine(on, { ...REPO, 'log --graph': { out: GRAPH_TEXT }, 'log --format=%H|%P|%s|%D': { out: LOG } })
  await start($)
  await run($, 'aegraph')
  features['add-two.svg'] = false
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Svg' })).toBeFalsy()
  expect(await texts(ui)).toMatch(/feat: add a/)
  await ui.unmount()
  features['add-two.git-reads'] = false
  const before = calls.length
  expect(await run($, 'aegraph')).toMatch(/switched off: \/cfg feature add-two\.git-reads on/)
  expect(await run($, 'aenotes')).toMatch(/switched off/)
  expect(calls.length).toBe(before)
})

test('/aenotes and /aechange read the log since the last plain tag and write nothing', async ($, on) => {
  const { calls } = engine(on, {
    ...REPO,
    'tag --list --merged HEAD --sort=-v:refname': { out: 'v2.0.0-rc.1\nv1.9.0\nv1.8.0\n' },
    'log --no-merges --format=%h%x09%s -n 300 v1.9.0..HEAD': { out: 'a1b2c3d\tfeat(ui): add dark mode\nb2c3d4e\tfix: crash\nc3d4e5f\tchore: deps\nd4e5f60\tfeat!: drop node 16\n' },
  })
  await start($)
  const notes = await run($, 'aenotes')
  expect(notes).toMatch(/4 commits since v1\.9\.0/)
  expect(notes).toMatch(/Breaking changes[\s\S]*drop node 16/)
  expect(notes).toMatch(/Fixes \(1\)/)
  const log = await run($, 'aechange')
  expect(log).toMatch(/^## \[Unreleased\]/)
  expect(log).toMatch(/### Added\n- ui: add dark mode\n- drop node 16/)
  expect(log).toMatch(/### Fixed\n- crash/)
  expect(log).toMatch(/1 housekeeping or unprefixed commit left out/)
  expect(calls.some(a => a.includes('tag'))).toBe(true)
  expect(calls.every(a => ['git', 'du'].includes(a[0] as string))).toBe(true)
  const writes = ['add', 'commit', 'push', 'checkout', 'reset', 'rm', 'tag -a']

  for (const a of calls) for (const w of writes) expect(a.slice(10).join(' ').startsWith(w)).toBe(false)
})

test('a tag with odd characters falls back to the whole history with a note', async ($, on) => {
  engine(on, {
    ...REPO,
    'tag --list --merged HEAD --sort=-v:refname': { out: 'v1.0.0\n' },
    'log --no-merges --format=%h%x09%s -n 300 v1.0.0..HEAD': { out: '' },
    'log --no-merges --format=%h%x09%s -n 300': { out: 'a1b2c3d\tfix: a\n' },
  })
  await start($)
  expect(await run($, 'aenotes')).toMatch(/No commits since v1\.0\.0/)
})

test('issue links come from recorded prompts only when that switch is on, or from pasted text', async ($, on) => {
  const { features } = engine(on, { ...REPO, 'config --get remote.origin.url': { out: 'git@github.com:acme/widgets.git\n' } })
  await start($)
  await send($, 'please look at #12 and acme/other#4')
  expect(await run($, 'aeissues')).toMatch(/Prompt recording is off/)
  const pasted = await run($, 'aeissues', 'see #7 and org/lib#2')
  expect(pasted).toMatch(/acme\/widgets#7 {2}https:\/\/github\.com\/acme\/widgets\/issues\/7/)
  expect(pasted).toMatch(/org\/lib#2/)
  features['add-two.record-prompts'] = true
  await send($, 'please look at #12 and acme/other#4 with token sk-ABCDEFGHIJKLMNOP1234')
  await send($, '/aecard')
  const t = await run($, 'aeissues')
  expect(t).toMatch(/acme\/widgets#12 {2}https:\/\/github\.com\/acme\/widgets\/issues\/12/)
  expect(t).toMatch(/acme\/other#4/)
  expect(t).toMatch(/nothing was fetched/)
})

test('/aedisk measures folders with du -sk, lists files from the listing, and reports a timeout as partial', async ($, on) => {
  const { lists, calls } = engine(on, {
    [`du -sk -- ${CWD}/src ${CWD}/node_modules ${CWD}/empty`]: { out: `920\t${CWD}/src\n182340\t${CWD}/node_modules\n0\t${CWD}/empty\n` },
  })
  lists[''] = [
    { name: 'src', kind: 'dir', size: 0 },
    { name: 'node_modules', kind: 'dir', size: 0 },
    { name: 'empty', kind: 'dir', size: 0 },
    { name: 'package.json', kind: 'file', size: 2048 },
    { name: 'link', kind: 'other', size: 0 },
  ]
  await start($)
  const t = await run($, 'aedisk')
  expect(t).toMatch(/Disk usage of \/r\/proj: 179 MB in 4 top-level entries/)
  expect(t).toMatch(/node_modules\//)
  expect(t).toMatch(/package\.json/)
  expect(t).toMatch(/1 entry not measured/)
  expect(calls.filter(a => a[0] === 'du').length).toBe(1)
  expect(calls.find(a => a[0] === 'du')?.slice(0, 3)).toEqual(['du', '-sk', '--'])
})

test('/aedisk gives a partial list when du times out, and the switch turns it off', async ($, on) => {
  const { lists, features, calls } = engine(on, { du: { throws: true } })
  lists[''] = [{ name: 'src', kind: 'dir', size: 0 }, { name: 'a.txt', kind: 'file', size: 10 }]
  await start($)
  expect(await run($, 'aedisk')).toMatch(/20 second limit[\s\S]*partial|partial/)
  features['add-two.disk-scan'] = false
  const before = calls.length
  expect(await run($, 'aedisk')).toMatch(/switched off/)
  expect(calls.length).toBe(before)
})

test('/aedisk never lists a folder outside the working directory and ignores odd names', async ($, on) => {
  const { lists, calls } = engine(on, { du: { out: `10\t${CWD}/ok\n99\t/etc\n` } })
  lists[''] = [{ name: 'ok', kind: 'dir', size: 0 }, { name: 'bad\nname', kind: 'dir', size: 0 }, { name: '..', kind: 'dir', size: 0 }]
  await start($)
  const t = await run($, 'aedisk')
  expect(t).toMatch(/ok\//)
  expect(t).not.toMatch(/etc/)

  for (const a of calls.filter(x => x[0] === 'du')) expect(a.slice(3).every(p => p.startsWith(`${CWD}/`) && !p.includes('..'))).toBe(true)
})

test('/aedocs searches README and docs names and headings, skips secret-like names and respects the read cap', async ($, on) => {
  const { lists, files } = engine(on)
  lists[''] = [
    { name: 'README.md', kind: 'file', size: 100 },
    { name: 'README.secret.md', kind: 'file', size: 10 },
    { name: 'README.png', kind: 'file', size: 10 },
    { name: 'src', kind: 'dir', size: 0 },
  ]
  lists.docs = [
    { name: 'install.md', kind: 'file', size: 10 },
    { name: 'tokens.md', kind: 'file', size: 10 },
    { name: 'notes.txt', kind: 'file', size: 10 },
  ]
  files['README.md'] = '# Widget toolkit\n\ntext'
  files['docs/install.md'] = 'Installing\n==========\n'
  files['README.secret.md'] = 'SECRET'
  files['docs/tokens.md'] = 'SECRET'
  await start($)
  const all = await run($, 'aedocs')
  expect(all).toMatch(/README\.md {2}- {2}Widget toolkit/)
  expect(all).toMatch(/docs\/install\.md {2}- {2}Installing/)
  expect(all).toMatch(/Skipped \(secret-like name, never opened\): README\.secret\.md, docs\/tokens\.md/)
  expect(all).not.toMatch(/SECRET/)
  expect(await run($, 'aedocs', 'install')).toMatch(/matching "install": 1 file of 2/)
  expect(await run($, 'aedocs', 'zzz')).toMatch(/Nothing matched/)
})

test('docs reads are capped at 32 KB per file and at 40 files', async ($, on) => {
  const { lists, files, reads } = engine(on)
  lists[''] = []
  lists.docs = Array.from({ length: 60 }, (_, i) => ({ name: `d${i}.md`, kind: 'file' as const, size: 10 }))

  for (let i = 0; i < 60; i++) files[`docs/d${i}.md`] = `# Doc ${i}\n${'x'.repeat(100_000)}`
  await start($)
  const t = await run($, 'aedocs')
  expect(reads.length).toBe(40)
  expect(reads.every(r => r.length === 32_768)).toBe(true)
  expect(t).toMatch(/40 files/)
})

test('file-reads off stops docs, onboarding and the cheatsheet from reading anything', async ($, on) => {
  const { lists, features, reads } = engine(on)
  lists[''] = [{ name: 'README.md', kind: 'file', size: 1 }, { name: 'package.json', kind: 'file', size: 1 }]
  features['add-two.file-reads'] = false
  await start($)

  for (const c of ['aedocs', 'aeonboard', 'aecheat']) expect(await run($, c)).toMatch(/switched off: \/cfg feature add-two\.file-reads on/)
  expect(reads.length).toBe(0)
})

test('/aeonboard builds an outline from the listing, 2 KB of README and script names', async ($, on) => {
  const { lists, files, reads } = engine(on)
  lists[''] = [
    { name: 'README.md', kind: 'file', size: 5000 },
    { name: 'package.json', kind: 'file', size: 400 },
    { name: 'Makefile', kind: 'file', size: 100 },
    { name: '.env', kind: 'file', size: 10 },
    { name: 'src', kind: 'dir', size: 0 },
    { name: 'docs', kind: 'dir', size: 0 },
  ]
  files['README.md'] = '# Widgets\n\nA small toolkit for dashboards.\n' + 'x'.repeat(5000)
  files['package.json'] = JSON.stringify({ scripts: { test: 'vitest', build: 'tsc' } })
  files.Makefile = 'all: build\nbuild:\n\techo hi\n'
  files['.env'] = 'SECRET=1'
  await start($)
  const t = await run($, 'aeonboard')
  expect(t).toMatch(/Onboarding outline: proj/)
  expect(t).toMatch(/README\.md: Widgets/)
  expect(t).toMatch(/A small toolkit for dashboards/)
  expect(t).toMatch(/package\.json scripts: test, build/)
  expect(t).toMatch(/make targets: all, build/)
  expect(t).toMatch(/Skipped \(secret-like names, never opened\): \.env/)
  expect(t).not.toMatch(/SECRET/)
  expect(reads.find(r => r.path === 'README.md')?.length).toBe(2048)
  expect(reads.find(r => r.path === 'package.json')?.length).toBe(8192)
  expect(reads.some(r => r.path === '.env')).toBe(false)
})

test('/aecheat lists commands from three manifests and a button copies one to the prompt box, running nothing', async ($, on) => {
  const { lists, files, filled, calls } = engine(on)
  lists[''] = [{ name: 'package.json', kind: 'file', size: 1 }, { name: 'Makefile', kind: 'file', size: 1 }, { name: 'pyproject.toml', kind: 'file', size: 1 }]
  files['package.json'] = JSON.stringify({ scripts: { test: 'vitest run', 'lint:fix': 'eslint . --fix' } })
  files.Makefile = 'clean: ## Remove output\n\trm -rf out\n'
  files['pyproject.toml'] = '[project.scripts]\ndemo = "demo:main"\n'
  await start($)
  const t = await run($, 'aecheat')
  expect(t).toMatch(/4 commands from package\.json, Makefile, pyproject\.toml/)
  expect(t).toMatch(/npm test/)
  expect(t).toMatch(/npm run lint:fix/)
  expect(t).toMatch(/make clean/)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'cheat-2' })
  expect(filled).toEqual(['make clean'])
  await ui.unmount()
  expect(calls.length).toBe(0)
})

test('/aepr ticks, adds and deletes items per repo and the pane button ticks too', async ($, on) => {
  const { db } = engine(on, { ...REPO })
  await start($)
  expect(await run($, 'aepr')).toMatch(/0\/8 done/)
  expect(await run($, 'aepr', 'tick 2')).toMatch(/1\/8 done[\s\S]*2\. \[x\]/)
  expect(await run($, 'aepr', 'add Announce it')).toMatch(/1\/9 done[\s\S]*9\. \[ \] Announce it/)
  expect(await run($, 'aepr', 'del 9')).toMatch(/1\/8 done/)
  expect(await run($, 'aepr', 'tick 99')).toMatch(/Usage/)
  expect(await run($, 'aepr', 'bogus')).toMatch(/Usage/)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'pr-0' })
  expect(await run($, 'aepr')).toMatch(/2\/8 done[\s\S]*1\. \[x\]/)
  await ui.unmount()
  expect(await run($, 'aepr', 'clear')).toMatch(/0\/8 done/)
  const stored = db['add-two:data'] as { pr: Record<string, unknown[]> }
  expect(Object.keys(stored.pr)).toEqual(['/r/proj'])
})

test('/aepath tracks topics, steps and ticks, and rejects bad numbers', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'aepath')).toMatch(/No learning topics/)
  await run($, 'aepath', 'add Rust basics')
  await run($, 'aepath', 'step 1 Read chapter 4')
  await run($, 'aepath', 'step 1 Write a parser')
  expect(await run($, 'aepath', 'tick 1.2')).toMatch(/1\. Rust basics {2}1\/2 steps[\s\S]*1\.2 \[x\] Write a parser/)
  expect(await run($, 'aepath', 'tick 3.1')).toMatch(/Usage/)
  expect(await run($, 'aepath', 'step 9 x')).toMatch(/Usage/)
  expect(await run($, 'aepath', 'bogus')).toMatch(/Usage/)
})

test('the path tab ticks steps with buttons, and steps and topics can be deleted', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'aepath', 'add Rust basics')
  await run($, 'aepath', 'step 1 Read chapter 4')
  await run($, 'aepath', 'step 1 Write a parser')
  await run($, 'aepath', 'tick 1.2')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-path' })
  await ui.press({ key: 'step-0-0' })
  expect(await run($, 'aepath')).toMatch(/2\/2 steps/)
  await ui.unmount()
  expect(await run($, 'aepath', 'delstep 1.1')).toMatch(/1\/1 steps/)
  expect(await run($, 'aepath', 'del 1')).toMatch(/No learning topics/)
})

test('flashcards: add, review, show, good and again move cards through the boxes by day', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  expect(await run($, 'aecard', 'add')).toMatch(/Usage/)
  await run($, 'aecard', 'add capital of France? | Paris')
  await run($, 'aecard', 'add 2+2 | 4')
  expect(await run($, 'aecard', 'list')).toMatch(/#1 \(box 1\) capital of France\?[\s\S]*#2/)
  expect(await run($, 'aecard', 'review')).toMatch(/2 cards, 2 due today[\s\S]*Front: capital of France\?/)
  expect(await run($, 'aecard', 'show')).toMatch(/Back: Paris/)
  expect(await run($, 'aecard', 'good')).toMatch(/Moved up a box\. Next front: 2\+2/)
  expect(await run($, 'aecard', 'again')).toMatch(/Back to box 1\. Next front: 2\+2/)
  expect(await run($, 'aecard', 'good')).toMatch(/No more cards due today/)
  expect(await run($, 'aecard', 'review')).toMatch(/Nothing is due/)
  await clock.advance(86_400_000 * 2.2)
  expect(await run($, 'aecard', 'review')).toMatch(/1 due today[\s\S]*Front: capital of France\?|2 due today/)
  expect(await run($, 'aecard', 'del 99')).toMatch(/Usage/)
  expect(await run($, 'aecard', 'del 2')).toMatch(/deleted/)
  expect(await run($, 'aecard', 'wat')).toMatch(/Usage/)
})

test('the cards tab reviews with Show, Good and Again buttons', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'aecard', 'add front one | back one')
  await run($, 'aecard', 'add front two | back two')
  await run($, 'aecard')
  const ui = await $.ui.mount(PANE)
  expect(await texts(ui)).toMatch(/front one[\s\S]*\(back hidden\)/)
  await ui.press({ key: 'card-show' })
  expect(await texts(ui)).toMatch(/back one/)
  await ui.press({ key: 'card-again' })
  expect(await texts(ui)).toMatch(/front two/)
  await ui.press({ key: 'card-show' })
  await ui.press({ key: 'card-good' })
  expect(await texts(ui)).toMatch(/front one/)
  await ui.unmount()
})

test('/aequiz fills a quiz prompt from recorded prompts, saves answers you note', async ($, on) => {
  const { filled, features } = engine(on)
  await start($)
  expect(await run($, 'aequiz')).toMatch(/Prompt filled \(prompt recording is off/)
  expect(filled[0]).toMatch(/topics we covered so far/)
  features['add-two.record-prompts'] = true
  await send($, 'fix the flaky retry logic')
  await send($, 'explain the reconcile step')
  expect(await run($, 'aequiz')).toMatch(/from your last 2 prompts/)
  expect(filled[1]).toMatch(/- fix the flaky retry logic[\s\S]*- explain the reconcile step/)
  expect(await run($, 'aequiz', 'note What is idempotency? | Same result when repeated')).toBe('Saved.')
  expect(await run($, 'aequiz', 'notes')).toMatch(/1 saved answer[\s\S]*Q: What is idempotency\?  A: Same result when repeated/)
  expect(await run($, 'aequiz', 'note')).toMatch(/Usage/)
  expect(await run($, 'aequiz', 'del 5')).toMatch(/Usage/)
  expect(await run($, 'aequiz', 'del 1')).toBe('Deleted.')
})

test('the glossary adds, deletes, and suggests repeated terms only from recorded prompts', async ($, on) => {
  const { features } = engine(on)
  await start($)
  expect(await run($, 'aeword', 'suggest')).toMatch(/recording is off/)
  features['add-two.record-prompts'] = true
  await send($, 'why does useAuthToken rerender')
  await send($, 'make useAuthToken stable and fix the reconcile loop')
  await send($, 'the reconcile loop again')
  const s = await run($, 'aeword', 'suggest')
  expect(s).toMatch(/heuristic/)
  expect(s).toMatch(/useauthtoken/)
  expect(s).toMatch(/reconcile/)
  await run($, 'aeword', 'add Reconcile = Compare old and new trees')
  await run($, 'aeword', 'add Idempotent')
  const list = await run($, 'aeword')
  expect(list).toMatch(/Idempotent: \(no definition yet\)/)
  expect(list).toMatch(/Reconcile: Compare old and new trees/)
  expect(await run($, 'aeword', 'suggest')).not.toMatch(/ reconcile /)
  expect(await run($, 'aeword', 'del 99')).toMatch(/Usage/)
  expect(await run($, 'aeword', 'add')).toMatch(/Usage/)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-words' })
  expect(await texts(ui)).toMatch(/Suggested terms/)
  await ui.press({ key: 'sug-useauthtoken' })
  await ui.unmount()
  expect(await run($, 'aeword')).toMatch(/useauthtoken: \(no definition yet\)/)
})

test('/aearch builds a tree, draws one SVG on desktop and text elsewhere, and deletes subtrees', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'aearch')).toMatch(/No components yet/)
  await run($, 'aearch', 'add App | entry')
  await run($, 'aearch', 'add 1 API | http')
  await run($, 'aearch', 'add 1 UI')
  const t = await run($, 'aearch', 'add 2 DB | sqlite')
  expect(t).toMatch(/4 components[\s\S]*1\. App {2}- entry[\s\S]*2\.    └ API {2}- http[\s\S]*3\.       └ DB/)
  expect(await run($, 'aearch', 'add 9 Nope')).toMatch(/no component 9/)
  expect(await run($, 'aearch', 'note 4 the front end')).toMatch(/UI {2}- the front end/)
  expect(await run($, 'aearch', 'rename 4 Frontend')).toMatch(/Frontend/)
})

test('the architecture pane draws one escaped SVG on desktop and text elsewhere', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'aearch', 'add App | entry')
  await run($, 'aearch', 'add 1 API | http')
  await run($, 'aearch', 'add 1 Frontend')
  await run($, 'aearch', 'add 2 DB | sqlite')
  const ui = await $.ui.mount(PANE)
  const svg = await svgOf(ui)
  expect(svg).toContain('Frontend')
  expect((svg.match(/<rect/g) ?? []).length).toBe(4)
  expect(svg).not.toMatch(/<script|href=/)
  await ui.unmount()
  const term = await $.ui.mount(PANE_TERM)
  expect(await term.find({ type: 'Svg' })).toBeFalsy()
  expect(await texts(term)).toMatch(/Architecture: 4 components/)
  await term.unmount()
})

test('deleting a component removes its subtree', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'aearch', 'add App')
  await run($, 'aearch', 'add 1 API')
  await run($, 'aearch', 'add 2 DB')
  await run($, 'aearch', 'add 1 UI')
  expect(await run($, 'aearch', 'del 2')).toMatch(/2 components/)
  expect(await run($, 'aearch', 'del 9')).toMatch(/no component 9/)
})

test('/aedecide logs decisions with the local date and status changes; a pane button cycles status', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'aedecide')).toMatch(/No decisions logged/)
  expect(await run($, 'aedecide', 'add Use SQLite | simple and local')).toMatch(/2026-11-25 {2}\[proposed\] {2}Use SQLite[\s\S]*simple and local/)
  expect(await run($, 'aedecide', 'set 1 accepted')).toMatch(/\[accepted\]/)
  expect(await run($, 'aedecide', 'set 1 maybe')).toMatch(/Usage/)
  expect(await run($, 'aedecide', 'set 7 accepted')).toMatch(/Usage/)
})

test('a status button in the decisions tab cycles the status; delete and bad input are handled', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'aedecide', 'add Use SQLite | simple and local')
  await run($, 'aedecide', 'set 1 accepted')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'dec-0' })
  expect(await run($, 'aedecide')).toMatch(/\[rejected\]/)
  await ui.unmount()
  expect(await run($, 'aedecide', 'del 1')).toMatch(/No decisions logged/)
  expect(await run($, 'aedecide', 'add')).toMatch(/Usage/)
})

test('/aeretro keeps went-well, improve and action notes per ISO week', async ($, on) => {
  engine(on)
  await start($)
  expect(await run($, 'aeretro')).toMatch(/Retro 2026-W48/)
  await run($, 'aeretro', 'well Shipped the graph')
  await run($, 'aeretro', 'improve Too many context switches')
  const t = await run($, 'aeretro', 'action Block focus time')
  expect(t).toMatch(/Went well\n {2}1\. Shipped the graph/)
  expect(t).toMatch(/To improve\n {2}1\. Too many context switches/)
  expect(t).toMatch(/Actions 0\/1\n {2}1\. \[ \] Block focus time/)
})

test('retro actions tick, weeks list, items delete, and bad input gets usage', async ($, on) => {
  engine(on)
  await start($)
  await run($, 'aeretro', 'well Shipped the graph')
  await run($, 'aeretro', 'improve Too many context switches')
  await run($, 'aeretro', 'action Block focus time')
  expect(await run($, 'aeretro', 'tick 1')).toMatch(/Actions 1\/1/)
  expect(await run($, 'aeretro', 'tick 5')).toMatch(/Usage/)
  expect(await run($, 'aeretro', 'list')).toMatch(/2026-W48: 1 well, 1 improve, 1 actions/)
  expect(await run($, 'aeretro', 'del well 1')).toMatch(/\(nothing yet\)/)
  expect(await run($, 'aeretro', 'del nope 1')).toMatch(/Usage/)
  expect(await run($, 'aeretro', 'well')).toMatch(/Usage/)
})

test('/aerate keeps local ratings for known mods only; stars in the pane rate too', async ($, on) => {
  engine(on)
  await start($)
  expect(MODS.length).toBeGreaterThan(10)
  const first = MODS[0]?.[0] as string
  expect(await run($, 'aerate')).toMatch(/0 of \d+ rated/)
  expect(await run($, 'aerate', `${first} 4`)).toMatch(/Rated .* 4\/5 \(kept on this computer only\)/)
  expect(await run($, 'aerate', 'nosuchmod 3')).toMatch(/Usage/)
  expect(await run($, 'aerate', `${first} 9`)).toMatch(/Usage/)
  expect(await run($, 'aerate', `${first} x`)).toMatch(/Usage/)
  expect(await run($, 'aerate')).toMatch(/1 of \d+ rated[\s\S]*★★★★☆/)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: `rate-${first}-2` })
  expect(await run($, 'aerate')).toMatch(/★★☆☆☆/)
  await ui.unmount()
  expect(await run($, 'aerate', `clear ${first}`)).toMatch(/Cleared/)
  expect(await run($, 'aerate')).toMatch(/0 of \d+ rated/)
})

test('/aetheme shows 8 raw-hex swatch palettes, fills the owner mod command and applies nothing', async ($, on) => {
  const { filled, calls } = engine(on)
  await start($)
  const t = await run($, 'aetheme')
  expect(t).toMatch(/8 palettes/)
  expect(t).toMatch(/applies nothing/)
  const ui = await $.ui.mount(PANE)
  const boxes = (await ui.findAll({ type: 'Box' })) as { props: { backgroundColor?: string } }[]
  expect(boxes.filter(b => /^#[0-9a-f]{6}$/i.test(b.props.backgroundColor ?? '')).length).toBe(48)
  await ui.press({ key: 'pal-ocean-/skuse ocean' })
  await ui.press({ key: 'pal-paper-/look paper' })
  expect(filled).toEqual(['/skuse ocean', '/look paper'])
  await ui.unmount()
  expect(await run($, 'aetheme', 'nord')).toMatch(/Prompt filled with \/look nord/)
  expect(await run($, 'aetheme', 'nope')).toMatch(/Unknown palette/)
  expect(calls.length).toBe(0)
})

test('/aeshare is a guide with the install lines, a manual-publish status and no commands run', async ($, on) => {
  const { calls, filled } = engine(on)
  await start($)
  const t = await run($, 'aeshare')
  expect(t).toMatch(/claude plugin marketplace add <owner>\/<repo>/)
  expect(t).toMatch(/claude plugin install <mod> --marketplace <owner>\/<repo>/)
  expect(t).toMatch(/manual step for you/)
  expect(t).toMatch(/Safety scan checklist/)
  expect(calls.length).toBe(0)
  expect(filled.length).toBe(0)
})

test('/aepack gathers goals, decisions, todos and files only from what the switches record, and can fill the prompt', async ($, on) => {
  const { features, filled } = engine(on, { ...REPO, 'rev-parse --abbrev-ref HEAD': { out: 'feature/x\n' }, 'status --porcelain=v1': { out: ' M src/a.ts\n?? notes.txt\n' } })
  await start($)
  const off = await run($, 'aepack')
  expect(off).toMatch(/record-prompts is off/)
  expect(off).toMatch(/record-todos is off/)
  expect(off).toMatch(/src\/a\.ts {2}\(uncommitted, from git status\)/)
  features['add-two.record-prompts'] = true
  features['add-two.record-edits'] = true
  features['add-two.record-todos'] = true
  await send($, 'add dark mode to the settings page')
  await $.tool.call({ tool: 'Edit', file_path: `${CWD}/src/a.ts`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: `${CWD}/src/new.ts`, content: 'x' })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'write tests', status: 'in_progress', activeForm: 'x' }, { content: 'old', status: 'completed', activeForm: 'x' }] })
  await run($, 'aedecide', 'add Use CSS variables')
  await run($, 'aedecide', 'set 1 accepted')
  const on1 = await run($, 'aepack')
  expect(on1).toMatch(/branch feature\/x/)
  expect(on1).toMatch(/- add dark mode to the settings page/)
  expect(on1).toMatch(/\[accepted\] Use CSS variables/)
  expect(on1).toMatch(/\[~\] write tests/)
  expect(on1).not.toMatch(/old/)
  expect(on1).toMatch(/- src\/a\.ts\n- src\/new\.ts\n- notes\.txt {2}\(uncommitted/)
  expect(await run($, 'aepack', 'fill')).toMatch(/Prompt filled/)
  expect(filled[0]).toMatch(/handoff of my session[\s\S]*Handoff pack/)
})

test('nothing is recorded unless its switch is on, and prompts are clipped and masked', async ($, on) => {
  const { features } = engine(on)
  await start($)
  await send($, 'a secret #5 sk-ABCDEFGHIJKLMNOP1234')
  await $.tool.call({ tool: 'Edit', file_path: `${CWD}/a.ts`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] })
  const t = await run($, 'aepack')
  expect(t).not.toMatch(/sk-ABC|#5|a\.ts|\] x/)
  features['add-two.record-prompts'] = true
  await send($, `${'long '.repeat(200)}sk-ABCDEFGHIJKLMNOP1234`)
  await send($, '/aecard')
  expect(await run($, 'aepack')).not.toMatch(/sk-ABC/)

  for (let i = 0; i < 70; i++) await send($, `prompt ${i}`)
  expect(await run($, 'aeissues', '')).toMatch(/No issue references .* in your 60 recorded prompts/)
})

test('/aereset clears data, recordings and stored values', async ($, on) => {
  const { features, db } = engine(on)
  features['add-two.record-prompts'] = true
  await start($)
  await run($, 'aecard', 'add a | b')
  await run($, 'aeword', 'add x = y')
  await send($, 'remember #3')
  expect((db['add-two:data'] as { cards: unknown[] }).cards.length).toBe(1)
  expect(await run($, 'aereset')).toMatch(/cleared/)
  expect(db['add-two:data']).toBeFalsy()
  expect(await run($, 'aecard', 'list')).toMatch(/No cards/)
  expect(await run($, 'aeword')).toMatch(/empty/)
  expect(await run($, 'aeissues')).toMatch(/No issue references/)
})

test('stored data is validated when a session starts: junk in the store never reaches the pane', async ($, on) => {
  const { db } = engine(on)
  db['add-two:data'] = { cards: [{ id: 1, front: 'f', back: 'b', box: 77 }, 'junk'], words: 'nope', ratings: { evil: 99 }, pr: { '/x': [{ t: 'ok' }] } }
  await start($)
  expect(await run($, 'aecard', 'list')).toMatch(/#1 \(box 5\) f/)
  expect(await run($, 'aeword')).toMatch(/empty/)
  expect(await run($, 'aerate')).toMatch(/0 of \d+ rated/)
})

test('the due toast is off by default, then fires once when switched on and cards are due', async ($, on) => {
  const { toasts, features } = engine(on)
  await start($)
  await run($, 'aecard', 'add q | a')
  await start($)
  expect(toasts).toEqual([])
  features['add-two.due-toast'] = true
  await start($)
  expect(toasts).toEqual(['1 flashcard due: /aecard review'])
  await start($)
  expect(toasts.length).toBe(1)
})

test('the pane groups tabs with at most 12 buttons in any row and every tab opens', async ($, on) => {
  const { lists } = engine(on, { ...REPO })
  lists[''] = []
  await start($)
  const ui = await $.ui.mount(PANE)
  const buttons = (await ui.findAll({ type: 'Button' })) as { key?: string }[]
  expect(buttons.filter(b => (b.key ?? '').startsWith('group-')).length).toBe(5)
  expect(buttons.filter(b => (b.key ?? '').startsWith('tab-')).length).toBeLessThanOrEqual(12)

  for (const g of ['git', 'project', 'learn', 'design', 'mods']) {
    await ui.press({ key: `group-${g}` })
    const now = (await ui.findAll({ type: 'Button' })) as { key?: string }[]
    expect(now.filter(b => (b.key ?? '').startsWith('tab-')).length).toBeLessThanOrEqual(5)
  }
  await ui.unmount()
  expect(await run($, 'aepane', 'bogus')).toMatch(/Unknown tab/)
  expect(await run($, 'aepane', 'share')).toMatch(/Sharing a mod/)
})

test('the accent from the shared settings is used and the mod works with defaults when it was never written', async ($, on) => {
  engine(on, {}, { accent: 'success' })
  await start($)
  await run($, 'aecard', 'add a | b')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'group-learn' })
  await ui.press({ key: 'tab-cards' })
  expect(await texts(ui)).toMatch(/1 card/)
  await ui.unmount()
})

test('every process the mod ever starts is on the allowlist', async ($, on) => {
  const { calls, lists, files } = engine(on, {
    ...REPO,
    'rev-parse --abbrev-ref HEAD': { out: 'main\n' },
    'log --graph': { out: GRAPH_TEXT },
    'log --format=%H|%P|%s|%D': { out: LOG },
    'tag --list': { out: 'v1.0.0\n' },
    'log --no-merges': { out: 'a1b2c3d\tfix: a\n' },
    'status --porcelain=v1': { out: ' M a\n' },
    'config --get remote.origin.url': { out: 'https://github.com/a/b.git\n' },
    du: { out: `5\t${CWD}/src\n` },
  })
  lists[''] = [{ name: 'src', kind: 'dir', size: 0 }, { name: 'README.md', kind: 'file', size: 1 }]
  files['README.md'] = '# x'
  await start($)

  for (const c of ['aegraph', 'aenotes', 'aechange', 'aepr', 'aedisk', 'aepack', 'aedocs', 'aeonboard', 'aecheat']) await run($, c)
  await run($, 'aeissues', 'see #1')
  expect(calls.length).toBeGreaterThan(8)

  for (const a of calls) {
    const argv = a[0] === 'git' ? ['git', ...a.slice(10)] : a
    expect(checkArgv(argv, CWD).ok).toBe(true)
  }
})
