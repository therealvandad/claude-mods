import { expect, mock, test } from 'claude-code/testing'

import {
  addItem,
  alertOf,
  applyBar,
  buttonWidth,
  chipsFor,
  commandKey,
  deadlineAt,
  defaultConfig,
  edgeOf,
  emptyLive,
  estimateOf,
  fitButtons,
  isBuildCommand,
  isTestCommand,
  ITEMS,
  lineDelta,
  onlyChanged,
  pickButtons,
  planBand,
  plainWords,
  PRESETS,
  projectKey,
  reduceToolEnd,
  reduceToolStart,
  reduceTurnEnd,
  reduceTurnStart,
  reduceUsage,
  rememberDuration,
  ROWS,
  sanitizeConfig,
  SIZES,
  snapshotChips,
  stepOf,
  storable,
  testCounts,
  THEMES,
  wantsTicker,
} from './bar'
import type { BarConfig, BarLive, ChipContext } from './bar'
import { cardSvg, chipsSvg, layoutChips, slimSvg } from './barsvg'
import { hudSvg } from './hud'
import type { HudData } from './hud'

// ------------------------------------------------------------------ helpers

const GIT = { branch: 'main', ahead: 2, behind: 1, dirty: 3 }

const config = (patch: Partial<BarConfig> = {}): BarConfig => ({ ...defaultConfig(), ...patch })
const withItems = (...ids: string[]): BarConfig => ({ ...ids.reduce(addItem, defaultConfig()), size: 'expanded' })
const live = (patch: Partial<BarLive> = {}): BarLive => ({ ...emptyLive(), ...patch })
const ctx = (patch: Partial<ChipContext> = {}): ChipContext => ({
  config: config(),
  live: live(),
  git: GIT,
  openTodos: 0,
  now: 1_000_000,
  isWorking: false,
  ...patch,
})
const chip = (c: ChipContext, id: string) => chipsFor(c).find(x => x.id === id)

const start = (l: BarLive, tool: string, input: Record<string, unknown>, id = 't1', at = 1000, estimateMs: number | null = null) =>
  reduceToolStart(l, { id, tool, input, at, estimateMs, isAgent: false })

const end = (
  l: BarLive,
  tool: string,
  input: Record<string, unknown>,
  extra: { failure?: string; output?: string; result?: unknown; isDenied?: boolean; id?: string } = {},
) =>
  reduceToolEnd(l, {
    id: extra.id ?? 't1',
    tool,
    input,
    at: 2000,
    failure: extra.failure ?? null,
    isDenied: extra.isDenied === true,
    output: extra.output ?? '',
    result: extra.result,
    isAgent: false,
  })

/** A strict enough XML reader: every tag is well formed and closed, and text holds no stray < or &. */
const checkXml = (svg: string): string => {
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y
  const stack: string[] = []
  let at = 0
  let roots = 0

  while (at < svg.length) {
    if (svg[at] === '<') {
      tag.lastIndex = at
      const m = tag.exec(svg)

      if (m === null) {
        return `bad tag at ${at}: ${svg.slice(at, at + 80)}`
      }
      const [whole, closing, name = '', attrs = '', selfClosing] = m
      const names = [...attrs.matchAll(/\s([\w:-]+)="/g)].map(x => x[1])

      if (new Set(names).size !== names.length) {
        return `repeated attribute in <${name}>: ${whole.slice(0, 120)}`
      }

      if (closing === '/') {
        if (stack.pop() !== name) {
          return `mismatched </${name}> at ${at}`
        }
      } else {
        roots += stack.length === 0 ? 1 : 0

        if (selfClosing !== '/') {
          stack.push(name)
        }
      }
      at += whole.length
    } else {
      const next = svg.indexOf('<', at)
      const text = svg.slice(at, next < 0 ? svg.length : next)

      if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(text)) {
        return `stray & in: ${text.slice(0, 60)}`
      }
      at += text.length
    }
  }

  return stack.length > 0 ? `unclosed: ${stack.join(' ')}` : roots === 1 ? '' : `${roots} roots`
}

const fine = (svg: string) => {
  expect(checkXml(svg)).toBe('')
  expect(svg).not.toMatch(/="[^"<>]*"[A-Za-z]/)
  expect(svg).not.toMatch(/NaN|undefined|Infinity|\[object/)
  expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+=|javascript:|href=|url\((?!#)/i)
  expect(svg.length).toBeLessThan(14_000)
  expect(svg).toMatch(/^<svg [^>]*width="\d+" height="\d+"/)

  // Nothing is drawn smaller than 10px, at the size it is shown.
  for (const [, size] of svg.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) {
    expect(Number(size)).toBeGreaterThanOrEqual(10)
  }
}

// ------------------------------------------------------------------ the default and the command

test('the default is clean: no second strip, no looks, and only buttons that make sense', () => {
  const c = defaultConfig()
  expect(c.size).toBe('normal')
  expect(c.theme).toBe('glass')
  expect(c.items).toEqual([...PRESETS.clean.items])
  expect(c.items.filter(id => ITEMS.find(i => i.id === id)?.kind === 'chip')).toEqual([])
  expect(c.items.filter(id => ITEMS.find(i => i.id === id)?.kind === 'look')).toEqual([])
  expect(wantsTicker(c)).toBe(false)
  expect(pickButtons(ctx({ git: null })).map(b => b.id)).toEqual(['more'])
})

test('every one of the sixty ideas has an item, a size, a theme or a command behind it', () => {
  const covered = new Set(ITEMS.flatMap(i => i.ideas))

  // 46 slim and 47 expanded are sizes, 48 themes, 57 to 59 commands and storage.
  for (let n = 1; n <= 60; n += 1) {
    expect(covered.has(n) || [46, 48, 57, 58, 59].includes(n)).toBe(true)
  }
  expect(SIZES).toEqual(['slim', 'normal', 'expanded'])
  expect(THEMES).toEqual(['glass', 'midnight', 'paper', 'neon'])
  expect(new Set(ITEMS.map(i => i.id)).size).toBe(ITEMS.length)
})

test('/bar edits the layout and says what it did', () => {
  const run = (c: BarConfig, args: string) => applyBar(c, args, new Date(2026, 0, 5, 12, 0).getTime())
  const help = run(config(), '')
  expect(help.isChanged).toBe(false)
  expect(help.text).toMatch(/\/bar add\|remove <item>/)
  expect(help.text).toMatch(/On: more, fix/)

  const added = run(config(), 'add timer')
  expect(added.config.items).toContain('timer')
  expect(added.config.size).toBe('expanded')
  expect(run(added.config, 'remove timer').config.items).not.toContain('timer')
  expect(run(config(), 'add nonsense').isChanged).toBe(false)

  const two = run(added.config, 'add branch').config
  const moved = run(two, 'move branch left').config
  expect(moved.items.indexOf('branch')).toBeLessThan(moved.items.indexOf('timer'))
  expect(chipsFor(ctx({ config: moved, isWorking: true, live: live({ turnStartedAt: 1 }) })).map(x => x.id)).toEqual(['branch', 'timer'])
  expect(run(moved, 'move branch left').isChanged).toBe(false)
  expect(run(config(), 'move branch left').isChanged).toBe(false)

  expect(run(config(), 'slim').config.size).toBe('slim')
  expect(run(config(), 'expanded').config.size).toBe('expanded')
  expect(run(config(), 'theme neon').config.theme).toBe('neon')
  expect(run(config(), 'theme pink').isChanged).toBe(false)
  expect(run(config(), 'preset coding').config.items).toContain('mode')
  expect(run(config(), 'preset numbers').config.items).toContain('turncost')
  expect(run(config(), 'preset everything').config.items.length).toBe(ITEMS.length - 2)
  expect(run(run(config(), 'preset everything').config, 'preset reset').config).toEqual(defaultConfig())
  expect(run(config(), 'preset nope').isChanged).toBe(false)

  expect(run(config(), 'goal ship the parser').config.goal).toBe('ship the parser')
  expect(run(config(), 'note call back').config.note).toBe('call back')
  expect(run(run(config(), 'note x').config, 'note off').config.note).toBe('')
  const due = run(config(), 'deadline 17:30 release').config
  expect(due.deadline).toEqual({ at: new Date(2026, 0, 5, 17, 30).getTime(), label: 'release' })
  expect(run(config(), 'deadline 25:00 x').isChanged).toBe(false)
  expect(deadlineAt('09:00', new Date(2026, 0, 5, 12, 0).getTime())).toBe(new Date(2026, 0, 6, 9, 0).getTime())
  expect(run(config(), 'budget $5').config.budget).toBe(5)
  expect(run(config(), 'budget -1').isChanged).toBe(false)
  expect(run(config(), 'button add Ship = Open a pull request.').config.buttons).toEqual([{ label: 'Ship', text: 'Open a pull request.' }])
  expect(run(run(config(), 'button add Ship = go').config, 'button remove ship').config.buttons).toEqual([])
  expect(run(config(), 'button add broken').isChanged).toBe(false)
  expect(run(config(), 'quiet on').config.quiet).toBe(true)
  expect(run(config({ quiet: true }), 'quiet off').config.quiet).toBe(false)
  expect(run(config(), 'quiet maybe').isChanged).toBe(false)
  expect(run(config(), 'wat').text).toMatch(/Unknown/)
  expect(applyBar(config(), '', 0, 'cbar').text).toMatch(/\/cbar add\|remove/)
})

test('what the store held is cleaned up, the goal is never stored and folders are hashed', () => {
  expect(sanitizeConfig('junk', 0)).toEqual(defaultConfig())
  const loaded = sanitizeConfig(
    { items: ['timer', 'timer', 'bogus'], size: 'huge', theme: 'paper', goal: 'old', budget: -2, deadline: { at: 5, label: 'x' }, buttons: [{ label: 'a', text: '' }] },
    10 * 86_400_000,
  )
  expect(loaded.items).toEqual(['timer'])
  expect(loaded.size).toBe('normal')
  expect(loaded.theme).toBe('paper')
  expect(loaded.goal).toBe('')
  expect(loaded.budget).toBeNull()
  expect(loaded.deadline).toBeNull()
  expect(loaded.buttons).toEqual([])
  expect(Object.keys(storable(config({ goal: 'secret' })))).not.toContain('goal')
  expect(projectKey('/work/demo')).toMatch(/^[0-9a-f]{8}$/)
  expect(projectKey('/work/demo')).not.toBe(projectKey('/work/other'))
})

// ------------------------------------------------------------------ live activity (1-10)

test('live items: the file, timer, step, trail, mode, estimate, command, background, save and failure', () => {
  const c = withItems('file', 'timer', 'step', 'trail', 'eta', 'command', 'background')
  let l = reduceTurnStart(live(), 1000)
  l = start(l, 'Edit', { file_path: '/work/demo/src/parser.ts' }, 'e1')
  const during = ctx({ config: c, live: l, isWorking: true, now: 66_000 })
  expect(chip(during, 'file')?.value).toBe('parser.ts')
  expect(chip(during, 'timer')?.value).toBe('01:05')
  expect(chip(during, 'command')?.value).toBe('editing parser.ts')
  expect(l.running[0]?.mode).toBe('editing')

  l = end(l, 'Edit', { file_path: '/work/demo/src/parser.ts', old_string: 'a', new_string: 'b' }, { id: 'e1' })
  expect(l.saves).toBe(1)
  expect(l.savedFile).toBe('parser.ts')
  expect(chip(ctx({ config: c, live: l }), 'file')).toBeUndefined()

  l = end(start(l, 'TodoWrite', { todos: [] }, 'p'), 'TodoWrite', {
    todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'completed' },
      { content: 'd', status: 'in_progress' },
      { content: 'e', status: 'pending' },
      { content: 'f', status: 'pending' },
      { content: 'g', status: 'pending' },
    ],
  }, { id: 'p' })
  expect(chip(ctx({ config: c, live: l }), 'step')?.value).toBe('4 of 7')

  // The newer task tools count the same way.
  let t = end(live(), 'TaskCreate', { subject: 'one' }, { result: { task: { id: '1' } } })
  t = end(t, 'TaskCreate', { subject: 'two' }, { result: { task: { id: '2' } } })
  t = end(t, 'TaskUpdate', { taskId: '1', status: 'completed' })
  expect(stepOf(t.tasks)).toEqual({ n: 2, of: 2, label: '', open: 1 })

  for (const tool of ['Read', 'Grep', 'Bash', 'Read', 'Read', 'Glob']) {
    l = end(start(l, tool, {}, tool), tool, {}, { id: tool })
  }
  expect(l.trail).toHaveLength(5)
  expect(chip(ctx({ config: c, live: l }), 'trail')?.trail).toHaveLength(5)

  const modes = [
    ['Read', '', 'reading'],
    ['Edit', '', 'editing'],
    ['Bash', 'npm test', 'testing'],
    ['Bash', 'ls', 'running'],
  ] as const

  for (const [tool, command, mode] of modes) {
    expect(start(live(), tool, { command }).running[0]?.mode).toBe(mode)
  }

  // The estimate comes from earlier runs of the same command, and is labelled one.
  let d = rememberDuration({}, commandKey('npm run build --silent'), 20_000)
  d = rememberDuration(d, commandKey('npm run build'), 30_000)
  d = rememberDuration(d, commandKey('npm run build'), 40_000)
  expect(estimateOf(d, 'npm run build')).toBe(30_000)
  expect(rememberDuration(d, 'ls', 20)).toBe(d)
  expect(commandKey('curl "https://x.test/?token=abc"')).toBe('curl')
  const slow = start(live(), 'Bash', { command: 'npm run build' }, 'b', 1000, 30_000)
  expect(chip(ctx({ config: c, live: slow, now: 11_000, isWorking: true }), 'eta')).toMatchObject({ label: 'estimate', value: '~20s left' })
  expect(chip(ctx({ config: c, live: slow, now: 99_000, isWorking: true }), 'eta')?.value).toBe('past avg')

  expect(plainWords('Bash', { command: 'npm test' })).toBe('running the tests')
  expect(plainWords('Bash', { command: 'x', description: 'List the files' })).toBe('List the files')
  expect(plainWords('Bash', { command: 'git commit -m a' })).toBe('committing changes')
  expect(plainWords('mcp__docs__search', {})).toBe('using search')

  expect(chip(ctx({ config: c, live: live({ background: 2 }) }), 'background')?.value).toBe('2 tasks')
  expect(chip(ctx({ config: c, live: live() }), 'background')).toBeUndefined()

  const failed = end(start(live(), 'Bash', { command: 'npm run build' }), 'Bash', { command: 'npm run build' }, { failure: 'exit 1' })
  expect(failed.failure?.plain).toBe('building the project')
  expect(failed.build).toBe(false)
  expect(edgeOf(failed, false)).toBe('red')
  // Reading a runner's config is not a test run, and a backgrounded run has no result yet.
  expect(isTestCommand('cat jest.config.js')).toBe(false)
  expect(isTestCommand('grep vitest package.json')).toBe(false)
  expect(isTestCommand('cd app && CI=1 npx vitest run')).toBe(true)
  expect(isBuildCommand('cat tsconfig.json')).toBe(false)
  expect(isBuildCommand('npm run build | tail')).toBe(true)
  const pending = end(live(), 'Bash', { command: 'npm test', run_in_background: true })
  expect(pending.test).toBeNull()
  expect(pending.isCelebrating).toBe(false)
  expect(end(live(), 'Bash', { command: 'npm test | tail -3' }, { output: ' 3 pass\n 2 fail' }).test?.ok).toBe(false)
  // The same command succeeding clears it; a refusal never counts as a failure.
  expect(end(failed, 'Bash', { command: 'npm run build' }).failure).toBeNull()
  expect(end(live(), 'Bash', { command: 'rm x' }, { failure: 'denied: no', isDenied: true }).failure).toBeNull()
})

// ------------------------------------------------------------------ numbers (11-20)

test('number items show only real figures', () => {
  const c = { ...withItems('reset', 'pace', 'turncost', 'today', 'budget', 'tokens', 'lines', 'tests', 'length', 'errors'), budget: 4 }
  expect(chipsFor(ctx({ config: c }))).toEqual([])

  const now = 10_000_000
  let l = reduceUsage(live({ sessionStartedAt: now - 3_900_000, costUsd: 1 }), {
    contextPct: 40,
    contextTokens: 80_000,
    window: 200_000,
    costUsd: 1,
    limit: { kind: 'five_hour', pct: 60, resetsAt: now + 7_800_000, paceMin: 25 },
  })
  l = reduceTurnStart(l, now)
  l = reduceUsage(l, { contextPct: 45, contextTokens: null, window: 200_000, costUsd: 3.2, limit: l.limit })
  l = reduceTurnEnd(l, { isAnswer: true, todayUsd: 7.5 })
  const at = ctx({ config: c, live: l, now })
  expect(chip(at, 'reset')?.value).toBe('in 2h 10m')
  expect(chip(at, 'pace')?.value).toBe('full in 25 min')
  expect(chip(at, 'turncost')?.value).toBe('$2.20')
  expect(chip(at, 'today')?.value).toBe('$7.50')
  expect(chip(at, 'budget')).toMatchObject({ value: '$3.20 / $4.00', fill: 0.8, tone: 'warn' })
  expect(chip(at, 'tokens')?.value).toBe('110k')
  expect(chip(at, 'length')?.value).toBe('65 min')
  const later = live({ limit: { kind: 'five_hour', pct: 60, resetsAt: now + 60_000, paceMin: 25 } })
  expect(chip(ctx({ config: c, live: later, now }), 'pace')?.value).toBe('resets first')

  // Without a turn start the cost of the turn is unknown, so it is not shown.
  expect(reduceTurnEnd(live({ costUsd: 5 }), { isAnswer: true, todayUsd: null }).turnUsd).toBeNull()

  expect(lineDelta('Edit', {}, { structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }] })).toEqual({ added: 2, removed: 1 })
  expect(lineDelta('Edit', { old_string: 'a\nb\nc', new_string: 'a\nB\nC\nc' }, {})).toEqual({ added: 2, removed: 1 })
  expect(lineDelta('Write', { content: 'x\ny\n' }, { type: 'create', structuredPatch: [] })).toEqual({ added: 2, removed: 0 })
  expect(lineDelta('Write', { content: 'x' }, { type: 'update', structuredPatch: [] })).toEqual({ added: 0, removed: 0 })
  const edited = end(live(), 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b\nc' })
  expect(chip(ctx({ config: c, live: edited }), 'lines')?.value).toBe('+2 -1')

  expect(testCounts('Tests: 2 failed, 5 passed, 7 total')).toEqual({ passed: 5, failed: 2 })
  expect(testCounts(' 25 pass\n 0 fail')).toEqual({ passed: 25, failed: 0 })
  expect(testCounts('ok')).toEqual({ passed: null, failed: null })
  const ran = end(live(), 'Bash', { command: 'pytest' }, { output: '5 passed, 1 failed' })
  expect(chip(ctx({ config: c, live: ran }), 'tests')).toMatchObject({ value: '5 \u2713 1 \u2717', tone: 'bad' })

  const errs = pickButtons(ctx({ config: withItems('errors'), live: live({ errorCount: 3 }) })).find(b => b.id === 'errors')
  expect(errs).toMatchObject({ label: '3 errors', kind: 'tab', tab: 'errors' })
})

// ------------------------------------------------------------------ actions (21-30)

test('action buttons appear only when they make sense, at most four, and only ever fill the box', () => {
  const all = { ...withItems('tests-run', 'commit', 'explain', 'undo', 'continue', 'fix', 'compact', 'newsession', 'files', 'custom') }
  const only = (id: string, l: Partial<BarLive>, patch: Partial<ChipContext> = {}) =>
    pickButtons(ctx({ config: config({ items: [id], buttons: [{ label: 'Ship', text: 'Open a PR.' }] }), live: live(l), ...patch }))

  expect(only('tests-run', { isUntested: true })[0]?.text).toMatch(/Run the tests/)
  expect(only('commit', { turnsDone: 1 })[0]?.text).toMatch(/Commit/)
  expect(only('commit', { turnsDone: 1 }, { git: { ...GIT, dirty: 0 } })).toEqual([])
  expect(only('explain', { turnsDone: 1 })[0]?.text).toMatch(/Explain/)
  expect(only('undo', { editedThisTurn: 2 })[0]?.text).toMatch(/Undo the last change/)
  expect(only('continue', { turnsDone: 1 })[0]?.text).toBe('Continue.')
  expect(only('continue', { turnsDone: 1 }, { isWorking: true })).toEqual([])
  expect(only('fix', { failure: { tool: 'Bash', key: 'x', plain: 'running the tests', reason: 'exit 1', at: 1 } })[0]?.text).toMatch(
    /Fix the error.*running the tests.*exit 1/,
  )
  expect(only('fix', {})).toEqual([])
  expect(only('compact', { contextPct: 80 })[0]?.text).toBe('/compact')
  expect(only('compact', { contextPct: 40 })).toEqual([])
  expect(only('newsession', { contextPct: 90 })[0]?.text).toMatch(/summary/)
  expect(only('files', { edited: ['a', 'b'] })[0]).toMatchObject({ label: '2 files', kind: 'tab', tab: 'files' })
  expect(only('custom', {})[0]).toMatchObject({ label: 'Ship', text: 'Open a PR.' })

  const busy = pickButtons(
    ctx({
      config: { ...addItem(all, 'more'), buttons: [{ label: 'Ship', text: 'x' }] },
      live: live({
        turnsDone: 3,
        isUntested: true,
        contextPct: 90,
        editedThisTurn: 1,
        edited: ['a'],
        failure: { tool: 'Bash', key: 'x', plain: 'y', reason: 'z', at: 1 },
      }),
    }),
  )
  expect(busy).toHaveLength(4)
  expect(busy.map(b => b.id)).toEqual(['fix', 'compact', 'newsession', 'more'])
  expect(fitButtons(busy, 200).map(b => b.id)).toEqual(['fix', 'more'])
})

// ------------------------------------------------------------------ project (31-40)

test('project items: git, name colour, results, todos, note, goal and deadline', () => {
  const c = {
    ...withItems('branch', 'changes', 'sync', 'project', 'testresult', 'build', 'todos', 'deadline'),
    deadline: { at: 1_000_000 + 3_600_000, label: 'ship' },
  }
  const l = live({ cwd: '/work/demo-app', test: { ok: true, passed: 3, failed: 0 }, build: false })
  const at = ctx({ config: c, live: l, openTodos: 4 })
  expect(chip(at, 'branch')?.value).toBe('main')
  expect(chip(at, 'changes')?.value).toBe('3 files')
  expect(chip(at, 'sync')?.value).toBe('+2 / -1')
  expect(chip(at, 'project')?.value).toBe('demo-app')
  expect(chip(at, 'project')?.hue).toBeGreaterThanOrEqual(0)
  expect(chip(at, 'testresult')).toMatchObject({ value: 'passed', tone: 'ok' })
  expect(chip(at, 'build')).toMatchObject({ value: 'broken', tone: 'bad' })
  expect(chip(at, 'todos')?.value).toBe('4 open')
  // Idle shows the time itself, which cannot go stale; a running turn shows the countdown.
  expect(chip(at, 'deadline')?.value).toMatch(/^due \d\d:\d\d$/)
  expect(chip(ctx({ config: c, live: l, isWorking: true }), 'deadline')?.value).toBe('60 min left')
  expect(wantsTicker(c)).toBe(true)
  expect(chipsFor(ctx({ config: c, git: null })).map(x => x.id)).toEqual(['deadline'])
})

// ------------------------------------------------------------------ looks (41-50)

const HUD: HudData = {
  contextPct: 61,
  limitPct: 12,
  limitName: 'five_hour',
  spendUsd: 2,
  isWorking: false,
  tool: '',
  toolCalls: 3,
  trend: [10, 30, 61],
  animate: true,
}

test('looks: edge colour, glow, rolling digits, waveform, pulse, flash, themes, tint and celebration', () => {
  expect(edgeOf(live(), false)).toBe('blue')
  expect(edgeOf(live({ waiting: 'question' }), true)).toBe('amber')
  expect(edgeOf(live({ contextPct: 80 }), false)).toBe('amber')
  expect(edgeOf(live({ outcome: 'ok' }), false)).toBe('green')
  expect(hudSvg({ ...HUD, edge: 'red' })).toContain('style="stroke:var(--bad1)"')

  expect(hudSvg(HUD)).not.toMatch(/@keyframes|animation:/)
  const effects = [
    [{ glow: true }, /@keyframes glow/],
    [{ flash: true }, /@keyframes flash/],
    [{ celebrate: true }, /@keyframes party/],
    [{ pulse: 4 }, /data-saves="4"/],
    [{ roll: { contextPct: 40, spendUsd: 1 } }, /class="val rollout">40%/],
    [{ isWorking: true, wave: true }, /class="bar wv"/],
  ] as const

  for (const [patch, mark] of effects) {
    const moving = hudSvg({ ...HUD, ...patch })
    fine(moving)
    expect(moving).toMatch(mark)
    expect(hudSvg({ ...HUD, ...patch, animate: false })).not.toMatch(/@keyframes|animation:|<animate|rollout"/)
  }
  // One-shot effects end: only the working loops repeat for ever.
  expect(hudSvg({ ...HUD, glow: true, flash: true, celebrate: true, pulse: 1 })).not.toContain('infinite')

  expect(hudSvg({ ...HUD, theme: 'midnight' })).not.toContain('prefers-color-scheme')
  expect(hudSvg({ ...HUD, theme: 'glass' })).toContain('@media (prefers-color-scheme:dark)')
  expect(new Set(THEMES.map(theme => hudSvg({ ...HUD, theme }))).size).toBe(4)
  expect(hudSvg({ ...HUD, hour: 6 })).toContain('#ff8fab')
  expect(hudSvg({ ...HUD, hour: 23 })).toContain('#5b4bd6')

  const green = end(live(), 'Bash', { command: 'npm test' }, { output: '3 passed' })
  expect(green.isCelebrating).toBe(true)
  expect(start(green, 'Read', {}).isCelebrating).toBe(false)

  const beat = live({ beats: [1, 5, 2] })
  expect(chip(ctx({ config: withItems('heartbeat'), live: beat }), 'heartbeat')?.spark).toEqual([1, 5, 2])
})

test('every picture is well formed for every state, theme, width and size, with hostile text', () => {
  const nasty = '<a b="c">&\'" \u0000\u0007 😀😀😀 ]]> long long long long long long long long'
  const states: Partial<HudData>[] = [
    {},
    { isWorking: true, tool: nasty, wave: true },
    { contextPct: null, limitPct: null, spendUsd: null, trend: [] },
    { contextPct: 400, limitPct: -3, spendUsd: Number.NaN, trend: [Number.NaN, 999], limitName: nasty },
    { state: { word: 'your turn', sub: 'answer me', tone: 'amber' }, edge: 'amber' },
    { state: { word: nasty, sub: nasty, tone: 'testing' } },
    { glow: true, flash: true, celebrate: true, pulse: 9, roll: { contextPct: 1, spendUsd: 1 }, hour: 99 },
    { isWorking: true, glow: true, wave: true, edge: 'green', hour: -4 },
  ]
  const chips = chipsFor(
    ctx({
      config: { ...PRESETS.everything, items: [...PRESETS.everything.items], theme: 'glass', quiet: false, note: nasty, goal: nasty, buttons: [], budget: 1, deadline: { at: 2_000_000, label: nasty } },
      live: live({
        cwd: `/work/${nasty}`,
        turnStartedAt: 1,
        running: [{ id: 'a', tool: nasty, file: nasty, plain: nasty, mode: 'editing', startedAt: 1, estimateMs: 5_000_000 }],
        trail: [{ tool: nasty, isOk: false }, { tool: 'Read', isOk: true }, { tool: 'Edit', isOk: true }, { tool: 'Bash', isOk: true }, { tool: 'WebFetch', isOk: true }],
        tasks: [{ id: '1', status: 'in_progress', label: nasty }],
        background: 3,
        limit: { kind: nasty, pct: 50, resetsAt: 9_000_000, paceMin: 5 },
        turnUsd: 1,
        todayUsd: 2,
        costUsd: 3,
        tokensLeft: 1234,
        added: 5,
        test: { ok: false, passed: 1, failed: 1 },
        build: true,
        sessionStartedAt: 1,
        beats: [0, 3, 1],
      }),
      git: { branch: nasty, ahead: 1, behind: 0, dirty: 2 },
      openTodos: 2,
      isWorking: true,
    }),
  )
  expect(chips.length).toBeGreaterThanOrEqual(18)

  for (const theme of THEMES) {
    for (const width of [300, 340, 348, 380, 390, 400]) {
      for (const s of states) {
        for (const animate of [true, false]) {
          fine(hudSvg({ ...HUD, ...s, theme, width, animate }))
        }
      }
      // Slim, the card, and the second strip.
      fine(slimSvg({ contextPct: 61, limitPct: 12, limitName: nasty, spendUsd: '$2.00', word: nasty, tone: 'amber' }, { width, theme, hour: 3 }))
      fine(slimSvg({ contextPct: null, limitPct: null, limitName: '', spendUsd: '', word: 'ready', tone: 'idle' }, { width, theme }))
      fine(cardSvg({ tone: 'warn', title: nasty, detail: nasty }, { width, theme }))

      for (const rows of [1, 2]) {
        for (let from = 0; from < chips.length; from += 4) {
          const grid = chipsSvg(chips.slice(from), { width, theme }, rows)
          fine(grid.source)
          expect(grid.height).toBeLessThanOrEqual(rows * 44 + 6)
        }
      }
    }
  }
  expect(chipsSvg([], { width: 400, theme: 'glass' }, 2).source).toBe('')
  // The checker itself catches what broke the picture once before.
  expect(checkXml('<svg><rect a="1"b="2"/></svg>')).not.toBe('')
  expect(checkXml('<svg><g></svg>')).not.toBe('')
})

test('nothing is placed outside the strip and wide chips never wrap off the edge', () => {
  const chips = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: 'x', value: 'y', isWide: i % 3 === 0 }))

  for (const width of [300, 360, 400]) {
    const { placed, rows } = layoutChips(chips, width, 2)
    expect(rows).toBe(2)

    for (const p of placed) {
      expect(p.col + p.span).toBeLessThanOrEqual(width >= 360 ? 4 : 3)
      expect(p.row).toBeLessThan(2)
    }
  }
})

// ------------------------------------------------------------------ smart (51-60)

test('smart items: only what changed, growing when needed, waiting, context card, chat or code, quiet', () => {
  const c = withItems('changes', 'branch')
  const before = snapshotChips(ctx({ config: c }))
  const now = chipsFor(ctx({ config: c, git: { ...GIT, dirty: 9 } }))
  expect(onlyChanged(now, before).map(x => x.id)).toEqual(['changes'])

  const asked = start(live(), 'AskUserQuestion', { questions: [{ question: 'Which one?' }] })
  expect(asked.waiting).toBe('question')
  expect(alertOf(config(), asked)).toBeNull()
  expect(alertOf(withItems('grow'), asked)).toMatchObject({ title: 'Waiting for your answer', detail: 'Which one?' })
  expect(end(asked, 'AskUserQuestion', {}).waiting).toBeNull()
  expect(alertOf(withItems('contextwarn'), live({ contextPct: 78 }))?.title).toBe('Context 78% full')
  expect(alertOf(withItems('contextwarn'), live({ contextPct: 90 }))?.tone).toBe('bad')
  expect(alertOf(withItems('contextwarn'), live({ contextPct: 50 }))).toBeNull()
  expect(alertOf({ ...withItems('grow'), quiet: true }, asked)).toBeNull()

  const auto = withItems('auto', 'branch', 'turncost')
  const chat = live({ turnUsd: 1, turnsDone: 1 })
  expect(chipsFor(ctx({ config: auto, live: chat })).map(x => x.id)).toEqual(['turncost'])
  expect(pickButtons(ctx({ config: auto, live: chat })).map(x => x.id)).toEqual(['continue', 'more'])
  expect(chipsFor(ctx({ config: auto, live: { ...chat, isCoding: true } })).map(x => x.id)).toEqual(['branch', 'turncost'])

  expect(pickButtons(ctx({ config: config({ quiet: true }), live: chat })).map(x => x.id)).toEqual(['quietoff'])
  expect(pickButtons(ctx({ config: withItems('quietbtn'), live: live() })).map(x => x.id)).toContain('quiet')
})

test('the band never asks for more rows or columns than it was given', () => {
  for (let maxRows = 0; maxRows <= 24; maxRows += 1) {
    for (let columns = 20; columns <= 120; columns += 1) {
      for (const isSlim of [false, true]) {
        const plan = planBand({ maxRows, columns, isSlim, hasAlert: true, chipRows: 2, buttonsPx: 260, gitPx: 160, lines: 3 })

        if (plan.kind === 'text') {
          continue
        }
        const rows =
          ROWS[plan.kind] +
          (plan.hasRow ? ROWS.row : 0) +
          (plan.hasAlert ? ROWS.alert : 0) +
          plan.chipRows * ROWS.chipRow +
          (plan.hasGitLine ? ROWS.line : 0) +
          plan.lines * ROWS.line
        expect(maxRows).toBeGreaterThanOrEqual(4)
        expect(rows).toBeLessThanOrEqual(maxRows)
        // Beside a full strip stand two stacked buttons; beside a slim one, every button in a line.
        const beside = !plan.hasSide ? 0 : isSlim ? 260 + buttonWidth('Cockpit') + buttonWidth('Hide') + 24 : 100
        expect(plan.stripWidth + beside).toBeLessThanOrEqual(columns * 7)
        expect(plan.stripWidth).toBeLessThanOrEqual(400)
        expect(plan.stripWidth).toBeGreaterThanOrEqual(isSlim && plan.hasSide ? 240 : 300)
      }
    }
  }
  expect(planBand({ maxRows: 3, columns: 80, isSlim: false, hasAlert: false, chipRows: 0, buttonsPx: 0, gitPx: 0, lines: 0 }).kind).toBe('text')
  expect(buttonWidth('More')).toBeGreaterThan(40)
})

// ------------------------------------------------------------------ wired into the app

type World = {
  filled: { text: string; mode: string }[]
  saved: Record<string, unknown>
  writes: string[]
  /** Every state read, as `plugin.key`. */
  reads: string[]
  ticks: number
  clock: { t: number }
  usage: { percent: number; usd: number }
  draft: string
  /** False makes the prompt box refuse the next fills. */
  canFill: boolean
  toasts: string[]
}

type WorldOptions = { features?: Record<string, boolean>; hasOwnClock?: boolean }

const world = (on: (...args: any[]) => unknown, o: WorldOptions = {}): World => {
  const w: World = { filled: [], saved: { view: { look: 'rich' } }, writes: [], reads: [], ticks: 0, clock: { t: 100_000 }, usage: { percent: 10, usd: 0 }, draft: '', canFill: true, toasts: [] }

  if (o.hasOwnClock !== true) {
    on('clock.now', () => ({ value: w.clock.t }))
  }
  on('state.set', (_: unknown, e: any, next: any) => {
    w.ticks += e.plugin === 'cockpit' && e.key === 'now' ? 1 : 0

    return next(e)
  })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: w.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    w.saved[e.key] = e.value
    w.writes.push(e.key)

    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## main...origin/main\n M a.ts\n', stderr: '' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: w.usage.percent }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }], cost: { usd: w.usage.usd } },
  }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.read', () => ({ value: { text: w.draft, cursor: w.draft.length } }))
  on('prompt.fill', (_: unknown, e: { text: string; mode: string }) => {
    w.filled.push({ text: e.text, mode: e.mode })

    return { isFilled: w.canFill }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', () => {
    throw new Error('the bar must never send a prompt')
  })
  on('state.get', (_: unknown, e: any, next: any) => {
    w.reads.push(`${e.plugin}.${e.key}`)

    return e.plugin === 'settings' && e.key === 'features' && o.features !== undefined
      ? { value: { value: { shape: 'features-1', value: o.features }, version: 1 } }
      : next(e)
  })
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>other mod row</Text>
  })

  return w
}

const props = (patch: Record<string, unknown> = {}) => ({
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 14,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 14 },
  view: {},
  ...patch,
})
const band = (patch: Record<string, unknown> = {}) => ({ plugin: 'cockpit', surface: 'desktop', component: 'AbovePrompt', props: props(patch) }) as any
const turn = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const
const bar = (args: string, command = 'bar') => ({ command, args, origin: 'user' }) as any
const svgs = async (ui: any) => (await ui.findAll({ type: 'Svg' })).map((n: any) => n.props)

test('default band: one picture, a row of buttons that fill and never send, few state reads', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/work/demo/a.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete(turn)

  w.reads.length = 0
  const ui = await $.ui.mount(band())
  const idle = new Set(w.reads)
  expect([...idle].sort()).toEqual([
    'cockpit.barConfig',
    'cockpit.barLive',
    'cockpit.git',
    'cockpit.isBandHidden',
    'cockpit.isFocus',
    'cockpit.pins',
    'cockpit.view',
    'settings.features',
  ])
  expect(w.reads.length).toBe(8)
  expect(idle.has('cockpit.calls')).toBe(false)
  expect(idle.has('motion.isOn')).toBe(false)
  expect(await svgs(ui)).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual([
    'Cockpit',
    'Hide',
    'Continue',
    'Run tests',
    'Commit',
    'More',
  ])
  expect(await ui.find({ key: 'bar-continue' })).toBeDefined()
  expect(await ui.find({ key: 'bar-fix' })).toBeUndefined()
  expect(await ui.find({ key: 'bar-compact' })).toBeUndefined()

  await ui.press({ key: 'bar-continue' })
  w.draft = 'half written'
  await ui.press({ key: 'bar-tests-run' })
  expect(w.filled).toEqual([
    { text: 'Continue.', mode: 'replace' },
    { text: '\nRun the tests and tell me what fails.', mode: 'append' },
  ])
  expect(w.toasts).toEqual([])
  w.canFill = false
  await ui.press({ key: 'bar-continue' })
  expect(w.toasts.join()).toMatch(/Could not fill the prompt box/)
  await ui.unmount()

  w.reads.length = 0
  const working = await $.ui.mount(band({ isWorking: true }))
  expect(w.reads.length).toBe(10)
  expect((await svgs(working))[0]?.source).toMatch(/@keyframes sweep/)
  await working.unmount()
})

test('a failed command offers Fix, high context offers Compact, More opens the second strip', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ isError: true, result: 'exit 1', text: 'boom' }))
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  w.usage = { percent: 82, usd: 1 }
  await $.turn.complete(turn)

  const ui = await $.ui.mount(band())
  expect(await ui.find({ key: 'bar-fix' })).toBeDefined()
  await ui.press({ key: 'bar-compact' })
  expect(w.filled).toEqual([{ text: '/compact', mode: 'replace' }])
  await ui.press({ key: 'bar-more' })
  const open = await svgs(ui)
  expect(open).toHaveLength(2)
  expect(open[1].source).toContain('UNCOMMITTED')
  expect(open.every((s: any) => s.width > 0 && s.height > 0)).toBe(true)
  await ui.press({ key: 'bar-more' })
  expect(await svgs(ui)).toHaveLength(1)
  await ui.unmount()
})

test('the layout is kept per project and comes back, and the Bar tab edits it', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(((await $.command.run(bar('add branch'))) as any).text).toMatch(/Added branch/)
  await $.command.run(bar('theme paper'))
  await $.command.run(bar('goal ship it'))
  const key = `bar:${projectKey('/work/demo')}`
  expect(w.writes.filter(k => k === key).length).toBe(3)
  expect(w.saved[key]).toMatchObject({ theme: 'paper', size: 'expanded' })
  expect(w.saved[key]).not.toHaveProperty('goal')
  expect(JSON.stringify(w.saved)).not.toContain('/work/demo')

  const pane = await $.ui.mount({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as any)
  await pane.press({ key: 'tab-bar' })
  await pane.press({ key: 'bar-theme-neon' })
  await pane.press({ key: 'bar-item-timer' })
  await pane.press({ key: 'bar-left-timer' })
  await pane.press({ key: 'bar-size-slim' })
  const kept = w.saved[key] as BarConfig
  expect(kept.theme).toBe('neon')
  expect(kept.items.indexOf('timer')).toBeLessThan(kept.items.indexOf('branch'))
  expect(kept.size).toBe('slim')
  await pane.press({ key: 'bar-preset-reset' })
  expect((w.saved[key] as BarConfig).items).toEqual([...PRESETS.clean.items])
  await pane.unmount()

  // Another folder starts clean; this one comes back as it was left.
  await $.command.run(bar('theme midnight'))
  await $.session.start({ ...START, cwd: '/work/other' })
  const other = await $.ui.mount(band())
  expect((await svgs(other))[0]?.source).toContain('@media (prefers-color-scheme:dark)')
  await other.unmount()
  await $.session.start(START)
  const back = await $.ui.mount(band())
  expect((await svgs(back))[0]?.source).toContain('--top:#16213f')
  await back.unmount()
})

test('one ticker, only while a turn runs and a ticking item is chosen', async ($, on) => {
  const clock = mock.clock(on, { now: 100_000 })
  const w = world(on, { hasOwnClock: true })
  await $.session.start(START)

  // Nothing ticks by default, not even during a turn.
  await $.turn.start({ text: 'go', turnId: 't1' } as any)
  w.ticks = 0
  await clock.advance(10_000)
  expect(w.ticks).toBe(0)
  await $.turn.complete(turn)

  await $.command.run(bar('add timer'))
  w.ticks = 0
  await clock.advance(10_000)
  expect(w.ticks).toBe(0)
  await $.turn.start({ text: 'go', turnId: 't2' } as any)
  w.ticks = 0
  await clock.advance(5_000)
  expect(w.ticks).toBe(5)
  const ui = await $.ui.mount(band({ isWorking: true }))
  expect((await svgs(ui))[1]?.source).toContain('00:05')
  await clock.advance(2_000)
  expect((await svgs(ui))[1]?.source).toContain('00:07')
  await ui.unmount()
  await $.turn.complete(turn)
  w.ticks = 0
  await clock.advance(10_000)
  expect(w.ticks).toBe(0)
})

test('tool calls never write the store; the turn end writes once', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start(START)
  w.writes.length = 0

  for (let i = 0; i < 5; i += 1) {
    await $.tool.call({ tool: 'Read', file_path: '/work/demo/a.ts' })
  }
  expect(w.writes).toEqual([])
  await $.turn.complete(turn)
  expect(w.writes.filter(k => k === 'cdaily')).toHaveLength(1)
})

test('long commands are remembered and estimated next time', async ($, on) => {
  const w = world(on)
  on('tool.call', () => {
    w.clock.t += 20_000

    return { result: {}, text: 'ok' }
  })
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  await $.turn.complete(turn)
  expect(w.saved['bar:durations']).toEqual({ 'npm run build': [20_000] })
})

test('waiting for approval shows your turn until the call is over, and the switch turns it off', async ($, on) => {
  world(on)
  on('classic.PermissionRequest', () => ({}))
  on('classic.Stop', () => ({}))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start(START)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as any)
  const waiting = await $.ui.mount(band({ isWorking: true }))
  expect((await svgs(waiting))[0]?.source).toContain('your turn')
  expect((await svgs(waiting))[0]?.alt).toContain('your turn')
  await waiting.unmount()

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const after = await $.ui.mount(band({ isWorking: true }))
  expect((await svgs(after))[0]?.source).not.toContain('your turn')
  await after.unmount()

  await $.command.run(bar('add background'))
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: '1', type: 'shell', status: 'running', description: 'a' },
      { id: '2', type: 'shell', status: 'completed', description: 'b' },
    ],
  } as any)
  const bg = await $.ui.mount(band())
  expect((await svgs(bg))[1]?.source).toContain('1 task')
  await bg.unmount()
})

test('feature switches from settings turn parts off', async ($, on) => {
  world(on, {
    features: { 'cockpit.bar-buttons': false, 'cockpit.bar-motion': false, 'cockpit.bar-per-project': false, 'cockpit.bar-waiting': false },
  })
  on('classic.PermissionRequest', () => ({}))
  await $.session.start(START)
  await $.turn.complete(turn)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as any)
  const ui = await $.ui.mount(band({ isWorking: true }))
  expect(await ui.find({ key: 'bar-continue' })).toBeUndefined()
  expect(await ui.find({ key: 'bar-more' })).toBeUndefined()
  expect((await svgs(ui))[0]?.source).not.toMatch(/@keyframes|your turn/)
  await ui.unmount()
})

test('slim, quiet, themes, short bands, the terminal and surveys all behave', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.turn.complete(turn)

  await $.command.run(bar('slim'))
  const slim = await $.ui.mount(band())
  expect((await svgs(slim))[0]?.height).toBe(28)
  // Wide enough: the strip, More, Cockpit and Hide share one line; no action buttons.
  expect((await slim.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['More', 'Cockpit', 'Hide'])
  await slim.unmount()

  await $.command.run(bar('quiet on'))
  const quiet = await $.ui.mount(band({ isWorking: true }))
  expect((await svgs(quiet))[0]?.source).not.toMatch(/@keyframes/)
  expect(await quiet.find({ key: 'bar-continue' })).toBeUndefined()
  await quiet.press({ key: 'bar-quietoff' })
  expect(await quiet.find({ key: 'bar-quietoff' })).toBeUndefined()
  await quiet.unmount()

  await $.command.run(bar('preset everything'))
  await $.command.run(bar('note remember the changelog'))

  for (const maxRows of [1, 3, 4, 5, 6, 9, 14, 30]) {
    for (const bodyColumns of [30, 50, 58, 64, 80, 140]) {
      const ui = await $.ui.mount(band({ maxRows, bodyColumns, isWorking: maxRows % 2 === 0 }))
      expect(await ui.find({ type: 'Text', text: /other mod row/ })).toBeDefined()

      for (const s of await svgs(ui)) {
        fine(s.source)
        expect(s.width).toBeGreaterThan(0)
        expect(s.height).toBeGreaterThan(0)
        expect(s.width).toBeLessThanOrEqual(bodyColumns * 7)
      }

      if (maxRows < 4) {
        expect(await svgs(ui)).toHaveLength(0)
      }
      await ui.unmount()
    }
  }
  const term = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /Note: remember the changelog/ })).toBeDefined()
  expect(await term.find({ key: 'cockpit-open' })).toBeDefined()
  await term.unmount()

  const survey = await $.ui.mount(band({ hasSurvey: true }))
  expect(await survey.find({ key: 'cockpit-open' })).toBeUndefined()
  expect(await survey.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  await survey.unmount()

  await $.command.run({ command: 'cfocus', args: '', origin: 'user' } as any)
  const focus = await $.ui.mount(band())
  expect(await focus.find({ key: 'cockpit-open' })).toBeUndefined()
  expect(await focus.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  await focus.unmount()
})

test('hide while typing: only the keys at the start of the box are watched', async ($, on) => {
  world(on)
  on('prompt.edit', (_: unknown, e: any) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)

    return { text, cursor: e.start + e.inputText.length }
  })
  await $.session.start(START)
  await $.command.run(bar('add hidetyping'))
  const type = (text: string, startAt: number, endAt: number, inputText: string) =>
    ($.prompt as any).edit({ origin: { kind: 'composer' }, text, cursor: endAt, start: startAt, end: endAt, inputText })
  await type('', 0, 0, 'h')
  const hidden = await $.ui.mount(band())
  expect(await hidden.find({ key: 'cockpit-open' })).toBeUndefined()
  expect(await hidden.find({ type: 'Text', text: /other mod row/ })).toBeDefined()
  await hidden.unmount()

  await type('h', 0, 1, '')
  const shown = await $.ui.mount(band())
  expect(await shown.find({ key: 'cockpit-open' })).toBeDefined()
  await shown.unmount()
})

test('when /bar is refused the command is /cbar', async ($, on) => {
  const names: string[] = []
  on('command.register', (_: unknown, e: { name: string }) => {
    if (e.name === 'bar') {
      return { deny: 'taken' } as any
    }
    names.push(e.name)

    return { value: { command: e.name } }
  })
  on('clock.now', () => ({ value: 1 }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  await $.session.start(START)
  expect(names).toContain('cbar')
  expect(((await $.command.run(bar('', 'cbar'))) as any).text).toMatch(/\/cbar add/)
})
