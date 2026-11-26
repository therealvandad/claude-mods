import { expect, test } from 'claude-code/testing'

import { credHits, dirsOf, hostsOf, incidentHit, parseAllow, redact, sandboxNote, scrub, testReport } from './rules'
import { MODS } from './snapshot'

type Eng = {
  now: number
  cwd: string
  toasts: string[]
  reached: { tool: string; [k: string]: unknown }[]
  stored: Record<string, unknown>
  copies: string[]
  opened: string[]
  below: (e: any) => string | undefined
  broken: { clock: boolean; store: boolean }
}

const T0 = 1_700_000_000_000
const MIN = 60_000

const newEng = (): Eng => ({
  now: T0,
  cwd: '/proj',
  toasts: [],
  reached: [],
  stored: {},
  copies: [],
  opened: [],
  broken: { clock: false, store: false },
  // Stands for tool-guard (and the tool itself) beneath this mod.
  below: e => {
    if (e.tool === 'Bash' && /git push --force /.test(e.command ?? '')) {
      return 'tool-guard: blocked (force push (use --force-with-lease)). Propose a safer command or ask the user.'
    }

    if (/^(Edit|Write)$/.test(e.tool) && /(^|\/)(\.env|id_rsa|\.aws\/credentials)/.test(e.file_path ?? '')) {
      return `tool-guard: ${e.file_path} is protected (secrets). Ask the user to edit it.`
    }

    return undefined
  },
})

const wire = (on: (...args: any[]) => unknown, st: Eng) => {
  on('clock.now', () => {
    if (st.broken.clock) {
      throw new Error('clock down')
    }

    return { value: st.now }
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    st.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    st.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: st.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: st.stored[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    if (st.broken.store) {
      throw new Error('disk full')
    }
    st.stored[e.key] = e.value

    return { value: undefined }
  })
  on('ui.copy', (_: unknown, e: { text: string }) => {
    st.copies.push(e.text)

    return { value: { isCopied: true } }
  })
  on('tool.call', (_: unknown, e: any) => {
    st.reached.push(e)
    const reason = st.below(e)

    return reason === undefined ? { result: {} } : { deny: reason }
  })
}

const cmd = ($: any, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })
const edit = ($: any, file_path: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })
const write = ($: any, file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x' })
const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

const BAND = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as any

const PANE = {
  plugin: 'controls',
  component: 'Pane',
  requestId: 'controls-main',
  props: { title: 'Controls', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('hosts are host names only: no path, query, token or port', () => {
  const hit = (tool: string, input: Record<string, unknown>) => hostsOf(tool, input).map(h => h.host)

  expect(hit('WebFetch', { url: 'https://user:tok3n@Example.COM:8443/a/b?token=abc#x' })).toEqual(['example.com'])
  expect(hit('Bash', { command: 'curl -H "Authorization: Bearer abcdefghijklmnop" https://api.foo.dev/v1?key=sekrit' })).toEqual(['api.foo.dev'])
  expect(hit('Bash', { command: 'wget http://a.org/x https://b.org/y' })).toEqual(['a.org', 'b.org'])
  expect(hit('Bash', { command: 'git clone git@github.com:acme/app.git' })).toEqual(['github.com'])
  expect(hit('Bash', { command: 'git clone https://github.com/acme/app.git' })).toEqual(['github.com'])
  expect(hit('Bash', { command: 'curl $URL' })).toEqual(['(unparsed)'])
  expect(hit('Bash', { command: 'ls -la' })).toEqual([])
  expect(hit('mcp__slack__post', {})).toEqual(['mcp:slack'])
  expect(hit('WebSearch', { query: 'my secret question' })).toEqual(['(web search service)'])
  expect(JSON.stringify(hostsOf('WebSearch', { query: 'my secret question' }))).not.toMatch(/secret/)
})

test('folders come from file tools and shell redirections', () => {
  const dirs = (tool: string, input: Record<string, unknown>) => dirsOf(tool, input, '/proj').map(d => `${d.kind}:${d.dir}`)

  expect(dirs('Read', { file_path: '/etc/hosts' })).toEqual(['r:/etc'])
  expect(dirs('Edit', { file_path: 'src/a.ts' })).toEqual(['w:/proj/src'])
  expect(dirs('Write', { file_path: '/x/y/z.txt' })).toEqual(['w:/x/y'])
  expect(dirs('Bash', { command: 'echo hi > out/log.txt' })).toEqual(['w:/proj/out'])
  expect(dirs('Bash', { command: 'make 2>&1 | tee -a build/make.log' })).toEqual(['w:/proj/build'])
  expect(dirs('Bash', { command: 'ls > /dev/null' })).toEqual([])
  expect(dirs('Bash', { command: 'echo $X > $Y' })).toEqual([])
  expect(dirs('Bash', { command: 'cat a.txt' })).toEqual([])
})

test('credential paths, the sandbox note, and secret scrubbing', () => {
  expect(credHits('cat ~/.aws/credentials')).toEqual(['~/.aws/credentials'])
  expect(credHits('ls ~/.ssh/')).toEqual(['~/.ssh'])
  expect(credHits('cat .npmrc && cat /home/a/.netrc')).toEqual(['.npmrc', '.netrc'])
  expect(credHits('ls src')).toEqual([])

  expect(sandboxNote('cd /tmp && ls', '/proj')).toMatch(/outside the project/)
  expect(sandboxNote('cd .. && ls', '/proj')).toMatch(/outside the project/)
  expect(sandboxNote('cd src && ls', '/proj')).toBeUndefined()
  expect(sandboxNote('cd ~/notes', '/proj')).toMatch(/home folder/)
  expect(sandboxNote('cat /etc/passwd', '/proj')).toMatch(/\/etc/)
  expect(sandboxNote('ls ~', '/proj')).toMatch(/home/)
  expect(sandboxNote('cd /proj/sub', '/proj')).toBeUndefined()

  const s = scrub('curl https://x.io/a?key=1 --token abcdefgh -H "Bearer abcdefghijklmnopqrst" ghp_abcdefghijklmnopqrstuv')
  expect(s).not.toMatch(/key=1|abcdefgh|ghp_/)
})

test('redaction presets mask more as they get stricter, and hide text if a rule fails', () => {
  const text = 'mail me@corp.com from 10.0.0.12 in /Users/sam/proj/src/a.ts with sk-abcdefghijklmnopqrstu via https://internal.corp/x'

  expect(redact(text, 'off')).toBe(text)
  expect(redact(text, 'work')).not.toMatch(/me@corp|10\.0\.0\.12|sam|sk-abc/)
  expect(redact(text, 'work')).toMatch(/internal\.corp/)
  expect(redact(text, 'presenting')).not.toMatch(/internal\.corp|a\.ts.*proj/)
  expect(redact(text, 'presenting')).toMatch(/a\.ts/)
})

test('incident heuristics copy tool-guard\'s MUTATING idea; the rule tester never runs anything', () => {
  expect(incidentHit('Bash', 'rm x')).toBeDefined()
  expect(incidentHit('Bash', 'echo a > b')).toBeDefined()
  expect(incidentHit('Bash', 'git commit -m x')).toBeDefined()
  expect(incidentHit('Bash', 'ls -la')).toBeUndefined()
  expect(incidentHit('Edit', '')).toBeDefined()
  expect(incidentHit('Write', '')).toBeDefined()
  expect(incidentHit('Read', 'rm x')).toBeUndefined()

  const lines = testReport('git push --force origin main', 'normal', [], [], false, T0, '/proj').join('\n')
  expect(lines).toMatch(/DENIED always: force push/)
  expect(lines).toMatch(/MUTATING/)
  expect(testReport('edit /a/.env', 'normal', [], [], false, T0, '/proj').join('\n')).toMatch(/would be DENIED/)
})

test('/ctallow parsing is strict', () => {
  expect(parseAllow('sudo 10')).toEqual({ kind: 'add', text: 'sudo', minutes: 10 })
  expect(parseAllow('terraform destroy 5')).toEqual({ kind: 'add', text: 'terraform destroy', minutes: 5 })
  expect(parseAllow('').kind).toBe('list')
  expect(parseAllow('clear').kind).toBe('clear')
  expect(parseAllow('sudo').kind).toBe('error')
  expect(parseAllow('sudo 0').kind).toBe('error')
  expect(parseAllow('sudo 99999').kind).toBe('error')
  expect(parseAllow('a 5').kind).toBe('error')
})

test('the build-time snapshot has the mods and their facts', () => {
  const guard = MODS.find(m => m.name === 'tool-guard')
  expect(guard).toBeDefined()
  expect(MODS.find(m => m.name === 'safety-pro')?.calls.some(c => c.startsWith('$.process'))).toBe(true)
  expect(MODS.length).toBeGreaterThan(8)
})

// ---------------------------------------------------------------------------
// Help, dashboard, permission summary, pause
// ---------------------------------------------------------------------------

test('/ct lists every command, one line each, all starting with ct', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  const text: string = (await cmd($, 'ct')).text
  const names = [...text.matchAll(/^ {2}\/(\w+)/gm)].map(m => m[1])

  expect(names).toEqual([
    'ct', 'ctmods', 'ctperms', 'ctpause', 'ctredact', 'ctledger', 'ctapprovals', 'cttest',
    'ctblock', 'ctallow', 'ctprofile', 'ctincident', 'ctselftest', 'ctshot', 'ctreset',
  ])
  expect(names.every(n => n?.startsWith('ct'))).toBe(true)
})

test('/ctperms says what a mod can do in plain words', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  const sp: string = (await cmd($, 'ctperms', 'safety-pro')).text
  expect(sp).toMatch(/can run shell commands/)
  expect(sp).toMatch(/snapshot/i)
  expect((await cmd($, 'ctperms', 'no-such-mod')).text).toMatch(/No mod named/)
  expect((await cmd($, 'ctmods', 'tool-guard')).text).toMatch(/^Snapshot/)
})

test('/ctpause prints one disable command per mod and the pane has copy buttons', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  const text: string = (await cmd($, 'ctpause')).text
  expect(text).toMatch(/cannot disable other mods itself/)
  expect(text).toMatch(/claude plugin disable tool-guard@local-mods/)
  expect(text).toMatch(/claude plugin disable safety-pro@local-mods/)
  expect(st.opened).toContain('controls-main')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /claude plugin disable tool-guard@local-mods/ })).toBeDefined()
    await ui.press({ key: 'copy-all' })
    expect(st.copies[st.copies.length - 1]).toMatch(/disable tool-guard@local-mods\nclaude plugin disable/)
    await ui.unmount()
  }
})

// ---------------------------------------------------------------------------
// Gates: own blocks, profiles, temporary allow, incident, fail-closed
// ---------------------------------------------------------------------------

test('extra blocks default to empty, then deny matching Bash commands, and pass the rest', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  expect((await bash($, 'terraform destroy -auto-approve')).deny).toBeUndefined()
  st.reached.length = 0
  expect((await cmd($, 'ctblock', 'add terraform destroy')).text).toMatch(/Blocked/)
  expect((await cmd($, 'ctblock', 'add ab')).text).toMatch(/at least 3/)

  const held = await bash($, 'cd infra && TERRAFORM DESTROY -auto-approve')
  expect(held.deny).toMatch(/controls: blocked \(custom block "terraform destroy"\)/)
  expect(held.deny).toMatch(/\/ctallow/)
  expect((await bash($, 'terraform plan')).deny).toBeUndefined()

  // the engine beneath never saw the held call
  expect(st.reached.some(c => /destroy/i.test(String(c.command)))).toBe(false)

  await cmd($, 'ctblock', 'rm terraform destroy')
  expect((await bash($, 'terraform destroy')).deny).toBeUndefined()
})

test('profiles: strict adds built-in rules, normal only your blocks, off nothing; per folder', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)
  await cmd($, 'ctblock', 'add dangerzone')

  expect((await bash($, 'sudo ls')).deny).toBeUndefined()

  await cmd($, 'ctprofile', 'strict')
  for (const command of ['sudo ls', 'git reset --hard HEAD~1', 'git clean -fd', 'chmod -R 777 .', 'psql -c "DROP TABLE users"', 'npm publish']) {
    expect((await bash($, command)).deny, command).toMatch(/controls: blocked/)
  }
  expect((await bash($, 'git status')).deny).toBeUndefined()
  expect((await bash($, 'run dangerzone')).deny).toMatch(/custom block/)

  // another project folder is unaffected
  st.cwd = '/other'
  expect((await bash($, 'sudo ls')).deny).toBeUndefined()
  expect((await bash($, 'run dangerzone')).deny).toMatch(/custom block/)
  st.cwd = '/proj'

  await cmd($, 'ctprofile', 'off')
  expect((await bash($, 'sudo ls')).deny).toBeUndefined()
  expect((await bash($, 'run dangerzone')).deny).toBeUndefined()

  // stored per folder, and the store holds it
  expect((st.stored['controls:cfg'] as any).profiles['/proj']).toBe('off')
})

test('the startProfile option sets the default for folders with no profile', { options: { startProfile: 'strict' } }, async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  expect((await bash($, 'sudo ls')).deny).toMatch(/controls: blocked/)
  await cmd($, 'ctprofile', 'normal')
  expect((await bash($, 'sudo ls')).deny).toBeUndefined()
})

test('/ctallow lets this mod\'s rule pass for N minutes, then it applies again; tool-guard is never loosened', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)
  await cmd($, 'ctprofile', 'strict')

  expect((await bash($, 'sudo ls')).deny).toBeDefined()
  expect((await cmd($, 'ctallow', 'sudo 10')).text).toMatch(/tool-guard and safety-pro are unaffected/)
  expect((await bash($, 'sudo ls')).deny).toBeUndefined()
  expect((await bash($, 'git reset --hard')).deny).toMatch(/controls: blocked/)
  expect((await cmd($, 'ctallow')).text).toMatch(/sudo: 10 min left/)

  // tool-guard's refusal still stands whatever is allowed here
  await cmd($, 'ctallow', 'force 10')
  expect((await bash($, 'git push --force origin main')).deny).toMatch(/^tool-guard: blocked/)

  st.now += 9 * MIN
  expect((await bash($, 'sudo ls')).deny).toBeUndefined()
  st.now += 2 * MIN
  expect((await bash($, 'sudo ls')).deny).toMatch(/controls: blocked/)

  // too short a substring cannot waive everything
  expect((await cmd($, 'ctallow', 'a 5')).text).toMatch(/at least 3/)
  expect((await cmd($, 'ctallow', 'sudo 500')).text).toMatch(/1 to 120/)
  await cmd($, 'ctallow', 'sudo 5')
  await cmd($, 'ctallow', 'clear')
  expect((await bash($, 'sudo ls')).deny).toMatch(/controls: blocked/)
})

test('incident mode holds mutating Bash, Edit and Write, logs every call, and is off by default', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  expect((await bash($, 'rm build/x')).deny).toBeUndefined()
  expect((await cmd($, 'ctincident')).text).toMatch(/off/)
  expect((await cmd($, 'ctincident', 'on')).text).toMatch(/INCIDENT MODE ON/)

  for (const command of ['rm x', 'mv a b', 'echo hi > f', 'git commit -m x', 'npm install', 'sed -i s/a/b/ f']) {
    expect((await bash($, command)).deny, command).toMatch(/incident mode/)
  }
  expect((await edit($, '/proj/a.ts')).deny).toMatch(/incident mode/)
  expect((await write($, '/proj/a.ts')).deny).toMatch(/incident mode/)
  expect((await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/proj/a.ipynb', new_source: 'x' })).deny).toMatch(/incident mode/)

  // reads pass
  expect((await bash($, 'ls -la')).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })).deny).toBeUndefined()

  // every call is logged: held ones and ones that ran
  await cmd($, 'ctapprovals')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-log' })
  expect(await ui.find({ type: 'Text', text: /^held$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /incident: ran/ })).toBeDefined()
  await ui.unmount()

  // banner
  const band = await $.ui.mount({ plugin: 'controls', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  expect(await band.find({ type: 'Text', text: /INCIDENT MODE/ })).toBeDefined()
  await band.unmount()

  await cmd($, 'ctincident', 'off')
  expect((await bash($, 'rm x')).deny).toBeUndefined()
  const quiet = await $.ui.mount({ plugin: 'controls', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  expect(await quiet.find({ type: 'Text', text: /INCIDENT MODE/ })).toBeUndefined()
  await quiet.unmount()
})

test('incident mode survives into the next session; a damaged store cannot switch anything on', async ($, on) => {
  const st = newEng()
  wire(on, st)
  st.stored['controls:cfg'] = { incident: true, blocks: ['zzz-held'], profiles: { '/proj': 'bogus' }, preset: 'nope', allows: 'x' }
  await start($)

  expect((await bash($, 'rm x')).deny).toMatch(/incident mode/)
  expect((await bash($, 'echo zzz-held')).deny).toMatch(/incident mode|custom block/)
  await cmd($, 'ctincident', 'off')
  expect((await bash($, 'echo zzz-held')).deny).toMatch(/custom block/)
  expect((await cmd($, 'ctprofile')).text).toMatch(/normal/)
})

test('a store holding nonsense leaves incident mode off and the block list empty', async ($, on) => {
  const st = newEng()
  wire(on, st)
  st.stored['controls:cfg'] = { incident: 'yes', blocks: 7, allows: [{ text: 5 }] }
  await start($)

  expect((await bash($, 'rm x')).deny).toBeUndefined()
  expect((await cmd($, 'ctblock', 'list')).text).toMatch(/No extra blocks/)
})

test('FAIL CLOSED: if a gate throws, the call is held, never let through', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  // the clock the gate reads breaks
  st.broken.clock = true

  const b = await bash($, 'ls')
  expect(b.deny).toMatch(/controls: its guard failed, so the command was held/)
  const e = await edit($, '/proj/a.ts')
  expect(e.deny).toMatch(/controls: its guard failed, so the edit was held/)
  const w = await write($, '/proj/a.ts')
  expect(w.deny).toMatch(/guard failed/)
  expect(st.reached.some(c => c.tool === 'Bash' && c.command === 'ls')).toBe(false)
})

test('the observer never denies: tools that are not gated pass even when recording is impossible', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)
  st.broken.store = true

  // Read is not gated; the observer's store write fails but the call still runs
  const ran = await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
  expect(ran.deny).toBeUndefined()
  expect(st.reached.some(c => c.tool === 'Read')).toBe(true)
})

// ---------------------------------------------------------------------------
// Ledgers, warnings, approvals
// ---------------------------------------------------------------------------

test('the ledgers record hosts and folders, never URLs with queries, and skip held calls', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  await $.tool.call({ tool: 'WebFetch', url: 'https://Docs.Example.com/guide?token=SECRET123', prompt: 'x' })
  await bash($, 'curl -s https://api.foo.dev/v1/items?key=sekrit')
  await bash($, 'git clone git@github.com:acme/app.git')
  await $.tool.call({ tool: 'mcp__slack__post_message', channel: 'x' })
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/a.ts' })
  await edit($, '/proj/src/b.ts')
  await bash($, 'echo hi > /proj/out/log.txt')
  await bash($, 'git push --force origin main') // held beneath: no ledger row

  const stored = JSON.stringify(st.stored['controls:data'])
  expect(stored).toMatch(/docs\.example\.com/)
  expect(stored).toMatch(/api\.foo\.dev/)
  expect(stored).toMatch(/github\.com/)
  expect(stored).toMatch(/mcp:slack/)
  expect(stored).not.toMatch(/SECRET123|sekrit|token=|guide|key=/)
  expect(stored).toMatch(/"dir":"\/proj\/src"/)
  expect(stored).toMatch(/"dir":"\/proj\/out"/)

  const text: string = (await cmd($, 'ctledger')).text
  expect(text).toMatch(/Hosts \(4\)/)
  expect(text).toMatch(/Folders \(2\)/)

  await cmd($, 'ctledger', 'clear')
  expect((await cmd($, 'ctledger')).text).toMatch(/Hosts \(0\)/)
})

test('the ledgers are bounded', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  for (let i = 0; i < 80; i += 1) {
    st.now += 1000
    await $.tool.call({ tool: 'WebFetch', url: `https://h${i}.example.org/`, prompt: 'x' })
    await $.tool.call({ tool: 'Read', file_path: `/d${i}/f.txt` })
  }
  const data = st.stored['controls:data'] as { net: unknown[]; dirs: unknown[] }
  expect(data.net.length).toBe(50)
  expect(data.dirs.length).toBe(60)
})

test('credential paths warn but never block, with at most one toast per 3 minutes', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  expect((await bash($, 'cat ~/.aws/credentials')).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: '/home/a/.npmrc' })).deny).toBeUndefined()
  expect((await bash($, 'cat ~/.ssh/config')).deny).toBeUndefined()
  expect(st.toasts.length).toBe(1)
  expect(st.toasts[0]).toMatch(/~\/\.aws\/credentials.*nothing was blocked/)

  st.now += 4 * MIN
  await bash($, 'cat .netrc')
  expect(st.toasts.length).toBe(2)

  // the log kept every warning
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-log' })
  expect(await ui.find({ type: 'Text', text: /credential-path/ })).toBeDefined()
  await ui.unmount()
})

test('sandbox reminder: cd outside the project or touching ~ and /etc, once per 10 minutes', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  expect((await bash($, 'cd src && ls')).deny).toBeUndefined()
  expect(st.toasts.length).toBe(0)

  await bash($, 'cd /tmp/x && ls')
  expect(st.toasts.length).toBe(1)
  expect(st.toasts[0]).toMatch(/sandbox reminder/)

  st.now += 4 * MIN
  await bash($, 'cat /etc/hosts')
  expect(st.toasts.length).toBe(1) // 10-minute limit

  st.now += 7 * MIN
  await bash($, 'ls ~')
  expect(st.toasts.length).toBe(2)
})

test('approvals: a dialog is recorded and then marked by whether the call ran', async ($, on) => {
  const st = newEng()
  wire(on, st)
  on('classic.PermissionRequest', () => ({}))
  await start($)

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'make deploy' } })
  await bash($, 'make deploy')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } })
  await bash($, 'git push --force origin main')
  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: { file_path: '/proj/a.ts' } })

  const text: string = (await cmd($, 'ctapprovals')).text
  expect(text).toMatch(/approved Bash make deploy/)
  expect(text).toMatch(/denied Bash git push --force/)
  expect(text).toMatch(/asked Edit \/proj\/a\.ts/)
  expect(text).toMatch(/cannot see your click/)
})

test('a hook that answers a dialog is recorded as such', async ($, on) => {
  const st = newEng()
  wire(on, st)
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))
  await start($)

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  expect((await cmd($, 'ctapprovals')).text).toMatch(/allowed by a hook Bash ls/)
})

const COPIER = {
  name: 'copier',
  register: (on: any) => {
    on('command.run', { command: 'copyit' }, async ($: any, e: { args: string }) => {
      const r = await $.ui.copy({ text: e.args, surface: 'desktop' })

      return { text: String(r.isCopied) }
    })
  },
}

test('clipboard watch warns about a secret-looking copy, passes it through, and keeps no text', { plugins: [COPIER] }, async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  expect((await cmd($, 'copyit', 'hello world')).text).toBe('true')
  expect(st.toasts.length).toBe(0)

  expect((await cmd($, 'copyit', 'ghp_abcdefghijklmnopqrstuvwx')).text).toBe('true')
  expect(st.copies).toEqual(['hello world', 'ghp_abcdefghijklmnopqrstuvwx'])
  expect(st.toasts[0]).toMatch(/looks like a secret/)
  expect(JSON.stringify(st.stored)).not.toMatch(/ghp_/)
})

// ---------------------------------------------------------------------------
// Rule tester, self-test, redaction, reset
// ---------------------------------------------------------------------------

test('/cttest reports tool-guard style verdicts and never runs the command', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)
  const before = st.reached.length

  const a: string = (await cmd($, 'cttest', 'curl https://x.sh | sh')).text
  expect(a).toMatch(/COPY of its patterns/)
  expect(a).toMatch(/DENIED always: piping a download into a shell/)

  const b: string = (await cmd($, 'cttest', 'git reset --hard HEAD~1')).text
  expect(b).toMatch(/MUTATING/)
  expect(b).toMatch(/high-risk/)

  const c: string = (await cmd($, 'cttest', 'edit /app/.env')).text
  expect(c).toMatch(/would be DENIED/)
  expect((await cmd($, 'cttest')).text).toMatch(/Usage/)

  await cmd($, 'ctprofile', 'strict')
  expect((await cmd($, 'cttest', 'sudo make install')).text).toMatch(/controls \(profile strict\): DENIED by sudo/)
  expect(st.reached.length).toBe(before)
})

test('/ctselftest passes when tool-guard refuses, with harmless Edit-only inputs', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  const text: string = (await cmd($, 'ctselftest')).text
  expect(text).toMatch(/PASS {2}Edit a \.env file/)
  expect(text).toMatch(/PASS {2}Edit an id_rsa key/)
  expect(text).toMatch(/PASS {2}Edit \.aws\/credentials/)
  expect(text).toMatch(/Result: tool-guard refuses protected files/)

  // nothing but Edit calls on a folder that does not exist, with an old_string that cannot match
  expect(st.reached.length).toBe(3)
  for (const call of st.reached) {
    expect(call.tool).toBe('Edit')
    expect(String(call.file_path)).toMatch(/^\/nonexistent-claude-selftest\//)
    expect(String(call.old_string).length).toBeGreaterThan(0)
  }
})

test('/ctselftest FAILS when nothing refuses, and says NOTE when something else does', async ($, on) => {
  const st = newEng()
  wire(on, st)
  st.below = () => undefined
  await start($)

  const failed: string = (await cmd($, 'ctselftest')).text
  expect(failed).toMatch(/FAIL/)
  expect(failed).toMatch(/Result: FAIL/)

  st.below = e => `some-other-hook: no edits (${e.file_path})`
  const other: string = (await cmd($, 'ctselftest')).text
  expect(other).toMatch(/NOTE/)
  expect(other).toMatch(/not confirmed/)
  expect(other).not.toMatch(/FAIL/)

  // incident mode is this mod's own refusal, which is not tool-guard's message either
  st.below = () => undefined
  await cmd($, 'ctincident', 'on')
  expect((await cmd($, 'ctselftest')).text).toMatch(/NOTE/)
})

test('/ctredact previews every preset and /ctredact <preset> masks this mod\'s pane only', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  const preview: string = (await cmd($, 'ctredact', 'ping me@corp.com at 10.1.2.3')).text
  expect(preview).toMatch(/work: ping •••@••• at •\.•\.•\.•/)
  expect(preview).toMatch(/presenting:/)

  expect((await cmd($, 'ctredact', 'presenting')).text).toMatch(/now presenting/)
  await $.tool.call({ tool: 'WebFetch', url: 'https://internal.corp.example/x', prompt: 'x' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-ledger' })
  expect(await ui.find({ type: 'Text', text: /masking: presenting/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /internal\.corp\.example/ })).toBeDefined() // host alone has no scheme to match
  await ui.unmount()

  // the redaction applies to what the pane draws, not to what was recorded
  expect((st.stored['controls:cfg'] as any).preset).toBe('presenting')
})

test('/ctshot shows counts only, no hosts, paths or commands', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)
  await $.tool.call({ tool: 'WebFetch', url: 'https://very-private.example.net/', prompt: 'x' })
  await bash($, 'cd /secret/place && ls')
  await cmd($, 'ctshot')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Hosts contacted: 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /very-private|secret/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /tool-guard/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane: every tab draws on every surface and the rules tab edits blocks', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Snapshot of \d+ mods/ })).toBeDefined()
    for (const tab of ['ledger', 'log', 'rules', 'pause', 'shot', 'mods']) {
      await ui.press({ key: `tab-${tab}` })
    }
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-rules' })
  await ui.input({ key: 'add-block', text: 'shutdown now' })
  expect((await bash($, 'shutdown now')).deny).toMatch(/custom block/)
  await ui.press({ key: 'rm-shutdown now' })
  expect((await bash($, 'shutdown now')).deny).toBeUndefined()

  await ui.press({ key: 'incident' })
  expect((await bash($, 'rm x')).deny).toMatch(/incident mode/)
  await ui.press({ key: 'incident' })
  expect((await bash($, 'rm x')).deny).toBeUndefined()

  await ui.press({ key: 'profile-strict' })
  expect((await bash($, 'sudo ls')).deny).toMatch(/controls: blocked/)
  await ui.press({ key: 'selftest' })
  expect(await ui.find({ type: 'Text', text: /PASS Edit a \.env file/ })).toBeDefined()
  await ui.unmount()
})

test('/ctreset clears recorded data; "all" clears settings too', async ($, on) => {
  const st = newEng()
  wire(on, st)
  await start($)
  await cmd($, 'ctblock', 'add terraform destroy')
  await cmd($, 'ctincident', 'on')
  await $.tool.call({ tool: 'WebFetch', url: 'https://a.example.com/', prompt: 'x' })
  await cmd($, 'ctselftest')

  const cleared: string = (await cmd($, 'ctreset')).text
  expect(cleared).toMatch(/Settings kept/)
  const data = st.stored['controls:data'] as { net: unknown[]; log: unknown[]; dirs: unknown[]; approvals: unknown[] }
  expect(data.net).toEqual([])
  expect(data.log).toEqual([])
  expect((st.stored['controls:cfg'] as any).blocks).toEqual(['terraform destroy'])
  expect((st.stored['controls:cfg'] as any).incident).toBe(true)

  await cmd($, 'ctreset', 'all')
  expect((st.stored['controls:cfg'] as any).blocks).toEqual([])
  expect((st.stored['controls:cfg'] as any).incident).toBe(false)
  expect((await bash($, 'terraform destroy')).deny).toBeUndefined()
})
