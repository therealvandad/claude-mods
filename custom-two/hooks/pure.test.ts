import { expect, test } from 'claude-code/testing'

import type { LogRow } from '../types'
import { BUILTIN_CURVES } from './pure'
import { bezier, builtin, ease, framesOf, samples, strip } from './curves'
import {
  bundleLines,
  editBranch,
  editBundle,
  editCheck,
  editCurve,
  editExport,
  editFile,
  editFilter,
  editFocus,
  editGloss,
  editGreet,
  editKeys,
  editMacro,
  editRange,
  editReport,
  editRules,
  editSched,
  editSearch,
  editSound,
  editTip,
} from './edit'
import type { Ctx } from './edit'
import { buildTheme, swatchesOf } from './palette'
import {
  BUILTIN_FOCUS,
  COLOUR_KEYS,
  CONDITIONS,
  FEATURE_DEFAULTS,
  GUARDS,
  LIMITS,
  OPPOSITE,
  accentOfBranch,
  checkFocusStep,
  checkMacroStep,
  cleanConfig,
  cleanGreeting,
  cleanKey,
  cleanLog,
  cleanTemplate,
  colourOfFile,
  csvCell,
  dayWord,
  defaultConfig,
  desiredHidden,
  dndStep,
  exportRows,
  holds,
  iconOf,
  inWindow,
  isAllowedRun,
  looksFailed,
  normalizeHex,
  parseBranch,
  parseDay,
  pushRow,
  rangeBounds,
  renderGreeting,
  renderTemplate,
  reportVars,
  ruleSteps,
  schedNow,
  searchRows,
  statsOf,
  toRow,
  viewOf,
} from './pure'
import { SOUND_FILES } from './sounds'
import { curveSvg, fontSvg, swatchSvg } from './svg'

const NOON = new Date(2026, 10, 25, 12, 30).getTime()
const ctx = (log: LogRow[] = [], minutes = 750): Ctx => ({ now: NOON, hour: 12, minutes, log, usd: 1.5, branch: 'main' })
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3
const row = (over: Partial<LogRow> = {}): LogRow => ({ at: NOON, tool: 'Edit', ok: true, detail: '', file: 'src/a.ts', branch: 'main', commit: false, ...over })

// ------------------------------------------------------------ the cleaner and its limits

test('cleanConfig turns garbage into the defaults and never throws', () => {
  for (const junk of [undefined, null, 5, 'x', [], { fileColours: 7, rules: 'no', macros: [{ name: 'A B', steps: ['rm -rf /'] }], dnd: 3 }]) {
    const c = cleanConfig(junk)
    expect(c.rules).toEqual([])
    expect(c.macros).toEqual([])
    expect(c.sounds).toEqual({ 'turn-end': 'done.wav', error: 'error.wav', commit: 'commit.wav' })
    expect(c.dnd.on).toBe(false)
  }
  expect(cleanConfig(undefined)).toEqual(defaultConfig())
})

test('every table is bounded and every row validated on load', () => {
  const many = Array.from({ length: 80 }, (_, i) => i)
  const c = cleanConfig({
    fileColours: Object.fromEntries(many.map(i => [`e${i}`, 'success'])),
    glossary: many.map(i => ({ term: `t${i}`, meaning: 'm' })),
    macros: many.map(i => ({ name: `m${i}`, steps: ['cfg feature quiet'] })),
    rules: many.map(i => ({ mod: `mod-${i}`, cond: 'idle' })),
    checklist: many.map(i => ({ text: `s${i}`, done: true })),
    sounds: { 'turn-end': '../../etc/passwd', error: 'nope.wav', commit: 'soft.wav' },
    fileColours2: 1,
  })
  expect(Object.keys(c.fileColours)).toHaveLength(LIMITS.fileColours)
  expect(c.glossary).toHaveLength(LIMITS.glossary - 20)
  expect(c.macros).toHaveLength(LIMITS.macros)
  expect(c.rules).toHaveLength(LIMITS.rules)
  expect(c.checklist).toHaveLength(LIMITS.checklist)
  expect(c.sounds).toEqual({ 'turn-end': 'done.wav', error: 'error.wav', commit: 'soft.wav' })
  expect(cleanConfig({ fileColours: { ts: 'red', md: 'success', '../x': 'success' } }).fileColours).toEqual({ md: 'success' })
  expect(cleanConfig({ rules: [{ mod: 'tool-guard', cond: 'idle' }, { mod: 'workbench', cond: 'bogus' }, { mod: 'workbench', cond: 'idle' }] }).rules).toEqual([{ mod: 'workbench', cond: 'idle' }])
})

test('the log keeps 300 rows, drops bad rows and stores only the first word of a command', () => {
  let log: LogRow[] = []

  for (let i = 0; i < 320; i++) {
    log = pushRow(log, row({ at: i }))
  }
  expect(log).toHaveLength(300)
  expect(log[0]?.at).toBe(20)
  expect(cleanLog([row(), { tool: 5 }, null, 'x', { ...row(), file: 'a\u0000b' }])).toHaveLength(2)
  const r = toRow(5, 'Bash', true, { command: 'git commit -m "secret token abc"' }, 'main')
  expect(r.detail).toBe('git')
  expect(r.commit).toBe(true)
  expect(JSON.stringify(r)).not.toMatch(/secret/)
  expect(toRow(5, 'Bash', false, { command: 'git commit -m x' }, 'main').commit).toBe(false)
  expect(toRow(5, 'Bash', true, { command: 'npm test' }, '').commit).toBe(false)
  expect(toRow(5, 'Edit', true, { file_path: '/p/a.ts' }, 'bad branch!').branch).toBe('')
})

test('the switch ids are valid and everything proactive is off by default', () => {
  // features.json is compared to this table by the build script (a test cannot read a json file)
  for (const id of Object.keys(FEATURE_DEFAULTS)) {
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,40}$/)
    expect(['toasts', 'sounds', 'status', 'band']).not.toContain(id)
  }
  expect(Object.keys(FEATURE_DEFAULTS).filter(id => FEATURE_DEFAULTS[id]).sort()).toEqual(['dnd', 'file-colours'])
})

test('the sounds list embedded at build time covers the default sounds', () => {
  for (const f of SOUND_FILES) {
    expect(f).toMatch(/^[a-z0-9-]+\.wav$/)
  }

  for (const f of Object.values(defaultConfig().sounds)) {
    expect(SOUND_FILES).toContain(f)
  }
})

// ------------------------------------------------------------ the allow list

test('a macro step is allowed only for cfg (strict shapes), tidy, motion and own commands that cannot loop', () => {
  const ok = ['cfg feature workbench.band off', '/cfg feature quiet', 'cfg preset calm', 'cfg accent claude', 'tidy', 'tidy now', 'motion off', 'cxtip', 'cxsound test error', 'cxcheck tick 1']
  const no = [
    'cfg feature tool-guard.toasts off', 'cfg feature safety-pro.band off', 'cfg feature controls.sounds off', 'cfg feature settings.toasts off', 'cfg feature a.b maybe', 'cfg weird', 'cfg feature workbench.band off; rm',
    'readonly on', 'allow x', 'ctallow x', 'ctblock x', 'ctpause', 'protect', 'dryrun', 'rollback', 'snapshot', 'hardbudget 1', 'bash ls', 'rm -rf /', 'config', 'model', 'clear',
    'cxmacro run x', 'cxfocus quiet', 'cxreset all', 'cxdnd on', 'cxrules clear', 'cx$(ls)', 'tidy `ls`', 'motion off | sh', 'cfg feature a.b on && x', '', ' ', '/', 'cfgx', 'motions',
  ]

  for (const s of ok) {
    expect(checkMacroStep(s).ok, s).toBe(true)
  }

  for (const s of no) {
    expect(checkMacroStep(s).ok, s).toBe(false)
  }
})

test('a focus step is only <mod>.<id> on|off|default or quiet|calm|full, never a guard', () => {
  for (const s of ['workbench.band off', 'alerts.toasts on', 'quiet', 'calm', 'full', 'notes.band default']) {
    const c = checkFocusStep(s)
    expect(c.ok, s).toBe(true)
    expect(c.ok && c.command).toBe('cfg')
  }

  for (const s of ['tool-guard.toasts off', 'controls.band off', 'safety-pro.sounds off', 'settings.status off', 'a.b maybe', 'reset', 'x; y', 'preset calm', 'a b on']) {
    expect(checkFocusStep(s).ok, s).toBe(false)
  }

  for (const g of GUARDS) {
    expect(checkFocusStep(`${g}.toasts off`).ok).toBe(false)
    expect(isAllowedRun('cfg', `feature ${g}.toasts off`)).toBe(false)
  }
})

test('isAllowedRun is the one gate: it agrees with the checkers and refuses everything else', () => {
  expect(isAllowedRun('cfg', 'feature quiet')).toBe(true)
  expect(isAllowedRun('cfg', 'feature full')).toBe(true)
  expect(isAllowedRun('cfg', 'feature workbench.band on')).toBe(true)
  expect(isAllowedRun('cfg', 'feature tool-guard.band off')).toBe(false)
  expect(isAllowedRun('tidy', '')).toBe(true)
  expect(isAllowedRun('motion', 'off')).toBe(true)
  expect(isAllowedRun('cxtip', '')).toBe(true)
  expect(isAllowedRun('cxmacro', 'run a')).toBe(false)

  for (const c of ['ctapprovals', 'ctallow', 'readonly', 'protect', 'bash', 'clear', 'compact', 'look', 'skuse', 'sound', 'dashboard']) {
    expect(isAllowedRun(c, ''), c).toBe(false)
  }
  expect(looksFailed('No switch named "x.y".')).toBe(true)
  expect(looksFailed('Usage: /x')).toBe(true)
  expect(looksFailed('controls.toasts cannot be changed: it is a safety mod')).toBe(true)
  expect(looksFailed('Done.\nworkbench.band on')).toBe(false)
  expect(looksFailed(undefined)).toBe(false)
})

test('macros and focus modes are stored only when every step passes', () => {
  const c = defaultConfig()
  expect(editMacro(c, 'add m cfg feature workbench.band off ; motion off').cfg.macros).toEqual([{ name: 'm', steps: ['/cfg feature workbench.band off', '/motion off'] }])
  expect(editMacro(c, 'add m cfg feature tool-guard.toasts off').cfg.macros).toEqual([])
  expect(editMacro(c, 'add m motion on ; bash ls').text).toMatch(/not on the allow list/)
  expect(editMacro(c, 'add m a ; b ; c ; d ; e ; f ; g').text).toMatch(/1 to 6 steps/)
  expect(editMacro(c, 'add Bad_Name motion off').cfg.macros).toEqual([])
  expect(editFocus(c, 'add deep workbench.band off ; alerts.toasts on').cfg.focus).toEqual([{ name: 'deep', steps: ['workbench.band off', 'alerts.toasts on'] }])
  expect(editFocus(c, 'add deep controls.band off').cfg.focus).toEqual([])
  expect(editFocus(c, 'add quiet quiet').text).toMatch(/new lower-case name/)
  // a stored macro with a bad step does not survive a reload
  expect(cleanConfig({ macros: [{ name: 'x', steps: ['cfg feature tool-guard.band off'] }] }).macros).toEqual([])
  expect(BUILTIN_FOCUS.every(f => f.steps.every(s => checkFocusStep(s).ok))).toBe(true)
})

// ------------------------------------------------------------ do-not-disturb and rules

test('the do-not-disturb window crosses midnight and only undoes what it applied', () => {
  expect(inWindow(23 * 60, '22:00', '07:00')).toBe(true)
  expect(inWindow(3 * 60, '22:00', '07:00')).toBe(true)
  expect(inWindow(12 * 60, '22:00', '07:00')).toBe(false)
  expect(inWindow(8 * 60, '09:00', '17:00')).toBe(false)
  expect(inWindow(10 * 60, '09:00', '17:00')).toBe(true)
  expect(inWindow(10 * 60, '10:00', '10:00')).toBe(false)
  const d = { on: true, from: '22:00', to: '07:00', applied: false }
  expect(dndStep(d, 23 * 60)).toEqual({ args: 'feature quiet' })
  expect(dndStep({ ...d, applied: true }, 23 * 60)).toBeNull()
  expect(dndStep({ ...d, applied: true }, 8 * 60)).toEqual({ args: 'feature full' })
  expect(dndStep(d, 8 * 60)).toBeNull()
  expect(dndStep({ ...d, on: false }, 23 * 60)).toBeNull()
  expect(dndStep({ ...d, on: false, applied: true }, 8 * 60)).toBeNull()

  for (const m of [0, 400, 1000, 1439]) {
    for (const applied of [true, false]) {
      const s = dndStep({ ...d, applied }, m)
      expect(s === null || isAllowedRun('cfg', s.args)).toBe(true)
    }
  }
})

test('rules: conditions have opposites, steps restore what was hidden, guards cannot be named', () => {
  for (const c of CONDITIONS) {
    expect(OPPOSITE[OPPOSITE[c]]).toBe(c)
    expect(holds(c, { busy: false, calm: false, minutes: 600 })).toBe(!holds(OPPOSITE[c], { busy: false, calm: false, minutes: 600 }))
  }
  expect(holds('idle', { busy: false, calm: true, minutes: 0 })).toBe(true)
  expect(holds('night', { busy: false, calm: true, minutes: 23 * 60 })).toBe(true)
  const rules = [{ mod: 'workbench', cond: 'idle' }, { mod: 'notes', cond: 'busy' }]
  expect(desiredHidden(rules, { busy: false, calm: false, minutes: 0 })).toEqual(['workbench'])
  expect(desiredHidden(rules, { busy: true, calm: false, minutes: 0 })).toEqual(['notes'])
  expect(ruleSteps([], ['workbench'])).toEqual([{ mod: 'workbench', args: 'feature workbench.band off' }])
  expect(ruleSteps(['workbench'], [])).toEqual([{ mod: 'workbench', args: 'feature workbench.band on' }])
  expect(ruleSteps(['workbench'], ['workbench'])).toEqual([])

  for (const g of GUARDS) {
    expect(editRules(defaultConfig(), `add ${g} idle`).cfg.rules).toEqual([])
  }
  expect(editRules(defaultConfig(), 'add hide workbench while idle').cfg.rules).toEqual([])
  expect(editRules(defaultConfig(), 'add workbench while idle').cfg.rules).toEqual([{ mod: 'workbench', cond: 'idle' }])
  let c = defaultConfig()

  for (let i = 0; i < 12; i++) {
    c = editRules(c, `add mod-${i} idle`).cfg
  }
  expect(c.rules).toHaveLength(LIMITS.rules)

  for (const s of [...ruleSteps([], ['a', 'b']), ...ruleSteps(['a'], [])]) {
    expect(isAllowedRun('cfg', s.args)).toBe(true)
  }
})

// ------------------------------------------------------------ look features

test('file colours and branch accents map to theme keys only', () => {
  const c = defaultConfig()
  expect(colourOfFile(c, 'src/a.ts')).toBe('suggestion')
  expect(colourOfFile(c, 'README.MD')).toBe('success')
  expect(colourOfFile(c, 'Makefile')).toBeUndefined()
  expect(accentOfBranch(c, 'main')).toBe('success')
  expect(accentOfBranch(c, 'release/1.2')).toBe('warning')
  expect(accentOfBranch(c, 'feature/x')).toBe('suggestion')
  expect(accentOfBranch(c, 'random')).toBeUndefined()
  expect(editFile(c, 'ts red').cfg.fileColours.ts).toBe('suggestion')
  expect(editFile(c, 'ts error').cfg.fileColours.ts).toBe('error')
  expect(editFile(c, 'x claude').cfg.fileColours.x).toBe('claude')
  expect(editFile(c, 'rm md').cfg.fileColours.md).toBeUndefined()
  expect(editBranch(c, 'wip/* subtle').cfg.branchRules.map(r => r.pattern)).toContain('wip/*')
  expect(editBranch(c, 'a*b subtle').cfg.branchRules).toEqual(c.branchRules)
  expect(editBranch(c, 'x ../y').cfg.branchRules).toEqual(c.branchRules)

  for (const r of defaultConfig().branchRules) {
    expect(COLOUR_KEYS).toContain(r.accent)
  }
  expect(parseBranch('feature/x\n')).toBe('feature/x')
  expect(parseBranch('fatal: not a git repository')).toBe('')
  expect(parseBranch('')).toBe('')
})

test('icons: own glyph over the pack, the pack over the settings style', () => {
  const c = defaultConfig()
  expect(iconOf(c, 'ok', 'symbols')).toBe('✓')
  expect(iconOf(c, 'ok', 'letters')).toBe('OK')
  expect(iconOf({ ...c, pack: 'minimal' }, 'ok', 'letters')).toBe('+')
  expect(iconOf({ ...c, icons: { ok: '*' } }, 'ok', 'letters')).toBe('*')
  expect(iconOf(c, 'zzz', 'symbols')).toBe('?')
})

test('greetings fill only {time} and {name}; other braces are refused', () => {
  expect(cleanGreeting('Good {time}, {name}.')).toBe('Good {time}, {name}.')
  expect(cleanGreeting('Hi {user}')).toBeNull()
  expect(cleanGreeting('Hi {name')).toBeNull()
  expect(cleanGreeting('Hi }')).toBeNull()
  expect(cleanGreeting('')).toBeNull()
  expect(dayWord(8)).toBe('morning')
  expect(dayWord(13)).toBe('afternoon')
  expect(dayWord(19)).toBe('evening')
  expect(dayWord(2)).toBe('night')
  expect(renderGreeting('Good {time}, {name}.', 8, 'Ada')).toBe('Good morning, Ada.')
  expect(renderGreeting('Good {time}, {name}.', 8, '')).toBe('Good morning, there.')
  expect(editGreet(defaultConfig(), 'name Ada <b>', ctx()).cfg.greetName).toBe('Ada b')
  expect(editGreet(defaultConfig(), '', ctx()).text).toMatch(/Good|Welcome|Hello/)
  expect(editTip(defaultConfig(), '', ctx()).text).toMatch(/^Tip 1\//)
  expect(editTip(defaultConfig(), 'add Use /cxpane', ctx()).cfg.tips).toEqual(['Use /cxpane'])
})

test('sounds: only files of the embedded list, only the three events', () => {
  const c = defaultConfig()
  expect(editSound(c, 'turn-end chime.wav').cfg.sounds['turn-end']).toBe('chime.wav')
  expect(editSound(c, 'turn-end off').cfg.sounds['turn-end']).toBe('')
  expect(editSound(c, 'turn-end ../x.wav').cfg.sounds).toEqual(c.sounds)
  expect(editSound(c, 'turn-end /etc/passwd').cfg.sounds).toEqual(c.sounds)
  expect(editSound(c, 'start soft.wav').cfg.sounds).toEqual(c.sounds)
  expect(editSound(c, 'list').text).toContain('chime.wav')
})

// ------------------------------------------------------------ log, ranges, filters, searches, reports, exports

test('ranges and filters narrow the log; dates must be real', () => {
  expect(parseDay('2026-02-30')).toBeNull()
  expect(parseDay('2026-12-05')).toEqual([2026, 12, 5])
  expect(parseDay('26-1-1')).toBeNull()
  let c = editRange(defaultConfig(), 'add sprint 2026-11-24 2026-11-26').cfg
  expect(c.ranges).toHaveLength(1)
  expect(editRange(c, 'add bad 2026-11-27 2026-11-26').cfg.ranges).toHaveLength(1)
  expect(editRange(c, 'add Bad 2026-11-24 2026-11-26').cfg.ranges).toHaveLength(1)
  c = editRange(c, 'use sprint').cfg
  const inSprint = row({ at: new Date(2026, 10, 25, 9).getTime() })
  const before = row({ at: new Date(2026, 10, 23, 23, 59).getTime() })
  const lastMoment = row({ at: new Date(2026, 10, 26, 23, 59, 59).getTime() })
  expect(viewOf([before, inSprint, lastMoment], c, NOON)).toEqual([inSprint, lastMoment])
  expect(rangeBounds(c, 'nope', NOON)).toBeNull()
  expect(editRange(c, 'use nope').cfg.range).toBe('sprint')
  const today = editRange(c, 'use today').cfg
  expect(viewOf([before, inSprint, row({ at: NOON })], today, NOON)).toHaveLength(2)
  expect(editRange(c, 'rm sprint').cfg.range).toBe('')
  let f = editFilter(defaultConfig(), 'save errs ok=error tool=Bash').cfg
  expect(f.filters).toEqual([{ name: 'errs', tool: 'Bash', ok: 'error', ext: '', branch: '' }])
  expect(editFilter(f, 'save x tool=Ba$h').cfg.filters).toHaveLength(1)
  expect(editFilter(f, 'save x').cfg.filters).toHaveLength(1)
  expect(editFilter(f, 'save x color=red').text).toMatch(/Unknown key/)
  f = editFilter(f, 'use errs').cfg
  expect(viewOf([row({ tool: 'Bash', ok: false }), row({ tool: 'Bash' }), row({ ok: false })], f, NOON)).toHaveLength(1)
  expect(viewOf([row({ file: 'a.ts' }), row({ file: 'b.md' })], { ...f, filter: '' }, NOON)).toHaveLength(2)
})

test('searches look only at tool, detail and file of the bounded log', () => {
  const log = [row({ tool: 'Bash', detail: 'npm' }), row({ file: 'docs/Guide.md' }), row()]
  expect(searchRows(log, 'guide')).toHaveLength(1)
  expect(searchRows(log, 'NPM')).toHaveLength(1)
  expect(searchRows(log, '')).toEqual([])
  const c = editSearch(defaultConfig(), 'save docs guide', ctx(log)).cfg
  expect(c.searches).toEqual([{ name: 'docs', text: 'guide' }])
  expect(editSearch(c, 'run docs', ctx(log)).text).toMatch(/1 of 3 rows match/)
  expect(editSearch(c, 'run nope', ctx(log)).text).toMatch(/No search/)
  expect(editSearch(c, 'save Bad x', ctx(log)).cfg.searches).toHaveLength(1)
  const big = Array.from({ length: 500 }, () => row({ file: 'x.ts' }))
  expect(searchRows(big, 'x.ts')).toHaveLength(300)
})

test('report templates fill known placeholders and refuse the rest', () => {
  expect(cleanTemplate('Calls {calls}')).toBe('Calls {calls}')
  expect(cleanTemplate('{secret}')).toBeNull()
  expect(cleanTemplate('x'.repeat(500))?.length).toBe(400)
  expect(cleanTemplate('')).toBeNull()
  const rows = [row(), row({ ok: false, file: 'b.ts' }), row({ commit: true, file: 'src/a.ts' })]
  expect(statsOf(rows)).toEqual({ calls: 3, errors: 1, files: 2, commits: 1 })
  const vars = reportVars(rows, defaultConfig(), 2.5, 'main', NOON)
  expect(renderTemplate('{calls}/{errors}/{files}/{spend}/{nope}', vars)).toBe('3/1/2/$2.50/{nope}')
  expect(renderTemplate('{constructor} {toString}', vars)).toBe('{constructor} {toString}')
  const out = editReport(defaultConfig(), '', ctx(rows)).text
  expect(out).toContain('Calls 3')
  expect(out).toContain('$1.50')
  expect(editReport(defaultConfig(), 'set Calls {calls}\\nSpend {spend}', ctx(rows)).cfg.template).toBe('Calls {calls}\nSpend {spend}')
  expect(editReport(defaultConfig(), 'set {evil}', ctx(rows)).cfg.template).toBe(defaultConfig().template)
})

test('exports are text only and a spreadsheet formula is neutralised', () => {
  const rows = [row({ file: '=HYPERLINK("x")', tool: 'Edit' }), row({ file: 'a,b.ts' }), row({ file: 'p|q.ts' })]
  const csv = exportRows(rows, 'csv')
  expect(csv.split('\n')[0]).toBe('time,tool,ok,detail,file,branch,commit')
  expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"")
  expect(csv).toContain('"a,b.ts"')
  expect(csvCell('+1')).toBe("'+1")
  expect(csvCell('-1')).toBe("'-1")
  expect(csvCell('@x')).toBe("'@x")
  expect(csvCell('plain')).toBe('plain')
  expect(exportRows(rows, 'md')).toContain('p\\|q.ts')
  expect(JSON.parse(exportRows(rows, 'json'))).toHaveLength(3)
  expect(exportRows(rows, 'json', 2)).not.toContain('HYPERLINK')
  expect(editExport(defaultConfig(), 'xml', ctx(rows)).text).toMatch(/Usage/)
  expect(editExport(defaultConfig(), 'csv', ctx([])).text).toMatch(/No rows/)
  expect(editExport(defaultConfig(), 'md', ctx(rows)).text).toMatch(/3 rows as md/)
})

// ------------------------------------------------------------ the rest of the tables

test('hotkey rows are text for the prompt, not key bindings', () => {
  expect(cleanKey('Ctrl+1')).toBe('ctrl+1')
  expect(cleanKey('cmd+shift+k')).toBe('cmd+shift+k')
  expect(cleanKey('f5')).toBe('f5')
  expect(cleanKey('a')).toBeNull()
  expect(cleanKey('ctrl+ctrl+a')).toBeNull()
  expect(cleanKey('ctrl+f13')).toBeNull()
  expect(cleanKey('meta+a')).toBeNull()
  const c = editKeys(defaultConfig(), 'add ctrl+1 Run the tests').cfg
  expect(c.keys).toEqual({ 'ctrl+1': 'Run the tests' })
  const used = editKeys(c, 'use ctrl+1')
  expect(used.fill).toBe('Run the tests')
  expect(editKeys(c, 'list').text).toMatch(/cannot register keys/)
  expect(editKeys(c, 'builtin').text).toMatch(/differ by version/)
  expect(editKeys(c, 'add zz hi').cfg.keys).toEqual(c.keys)
})

test('curves are pure maths that start at 0 and end at 1', () => {
  for (const n of BUILTIN_CURVES) {
    expect(near(builtin(n, 0), 0), n).toBe(true)
    expect(near(builtin(n, 1), 1), n).toBe(true)
    expect(samples(n, [])).toHaveLength(12)
    expect(strip(samples(n, []))).toHaveLength(12)
    expect(framesOf(n, [], 10).at(-1)).toBe(1)
  }
  expect(builtin('linear', 0.25)).toBe(0.25)
  expect(builtin('easeOutBack', 0.7)).toBeGreaterThan(1)
  expect(near(bezier(0.25, 0.1, 0.25, 1, 0), 0)).toBe(true)
  expect(near(bezier(0.25, 0.1, 0.25, 1, 1), 1)).toBe(true)
  expect(near(bezier(0, 0, 1, 1, 0.5), 0.5)).toBe(true)
  expect(builtin('nonsense', 0.3)).toBe(0.3)
  expect(builtin('easeIn', Number.NaN)).toBe(0)
  const c = editCurve(defaultConfig(), 'add soft 0.4 0 0.2 1').cfg
  expect(c.curves).toHaveLength(1)
  expect(near(ease('soft', 1, c.curves), 1)).toBe(true)
  expect(editCurve(c, 'add bad 2 0 0 1').cfg.curves).toHaveLength(1)
  expect(editCurve(c, 'add easeout 0 0 1 1').cfg.curves).toHaveLength(1)
  expect(editCurve(c, 'easeinout').cfg.curve).toBe('easeInOut')
  expect(editCurve(c, 'zzz').text).toMatch(/Unknown curve/)
})

test('schedule says which command to run and never runs it', () => {
  let c = editSched(defaultConfig(), 'add 07:00 skuse sunrise', ctx()).cfg
  c = editSched(c, 'add 20:00 look dusk', ctx()).cfg
  c = editSched(c, 'add 12:00 paper', ctx()).cfg
  expect(c.sched).toHaveLength(3)
  expect(schedNow(c.sched, 8 * 60)?.look).toBe('sunrise')
  expect(schedNow(c.sched, 13 * 60)?.look).toBe('paper')
  expect(schedNow(c.sched, 22 * 60)?.look).toBe('dusk')
  expect(schedNow(c.sched, 3 * 60)?.look).toBe('dusk')
  expect(schedNow([], 5)).toBeUndefined()
  expect(editSched(c, 'now', ctx([], 21 * 60)).fill).toBe('/look dusk')
  expect(editSched(c, 'now', ctx([], 21 * 60)).text).toMatch(/nothing was applied/)
  expect(editSched(c, 'add 25:00 x', ctx()).cfg.sched).toHaveLength(3)
  expect(editSched(c, 'add 08:00 skuse Bad', ctx()).cfg.sched).toHaveLength(3)
})

test('bundles print enable and disable lines and keep the guards on', () => {
  const c = editBundle(defaultConfig(), 'add dev notes,workbench tool-guard').cfg
  expect(c.bundles).toEqual([{ name: 'dev', mods: ['notes', 'workbench', 'tool-guard'] }])
  const lines = bundleLines(c.bundles[0]!)
  expect(lines).toContain('claude plugin enable notes')
  expect(lines).toContain('claude plugin disable workbench')
  expect(lines).not.toContain('claude plugin disable tool-guard')
  expect(editBundle(c, 'add x Bad_Mod').cfg.bundles).toHaveLength(1)
  expect(editBundle(c, 'show dev').text).toMatch(/never runs them/)
})

test('checklist, glossary, empty states and titles', () => {
  let c = editCheck(defaultConfig(), 'add Set the accent').cfg
  c = editCheck(c, 'tick 1').cfg
  expect(c.checklist).toEqual([{ text: 'Set the accent', done: true }])
  expect(editCheck(c, 'tick 9').cfg).toEqual(c)
  expect(editCheck(c, 'clear-ticks').cfg.checklist[0]?.done).toBe(false)
  expect(editCheck(defaultConfig(), 'starter').cfg.checklist).toHaveLength(5)
  expect(editCheck(editCheck(defaultConfig(), 'starter').cfg, 'starter').cfg.checklist).toHaveLength(5)
  const g = editGloss(defaultConfig(), 'add MCP = Model Context Protocol').cfg
  expect(g.glossary).toEqual([{ term: 'MCP', meaning: 'Model Context Protocol' }])
  expect(editGloss(g, 'find protocol').text).toMatch(/MCP/)
  expect(editGloss(g, 'add MCP = other').cfg.glossary).toHaveLength(1)
  expect(editGloss(g, 'add nothing here').cfg.glossary).toHaveLength(1)
})

// ------------------------------------------------------------ palette and drawings

test('a logo colour builds a theme and a preview; a bad colour builds nothing', () => {
  expect(normalizeHex('#E8643C')).toBe('#e8643c')
  expect(normalizeHex('abc')).toBe('#aabbcc')
  expect(normalizeHex('#12')).toBeNull()
  expect(normalizeHex('url(x)')).toBeNull()
  const built = buildTheme('#e8643c')
  expect(built.refusal).toBeNull()
  expect(built.args?.colors).toBeDefined()
  expect(swatchesOf('#e8643c')).toHaveLength(8)
  expect(swatchesOf('#e8643c')[0]?.hex).toBe('#e8643c')

  for (const hex of ['#ffffff', '#000000', '#00ff00', '#808080', '#fffe00']) {
    const b = buildTheme(hex)
    expect(b.args !== undefined || b.refusal !== null, hex).toBe(true)
  }
})

test('drawings are valid-looking svg with escaped text and a still twin', () => {
  const values = samples('easeOut', [])
  const line = Array.from({ length: 60 }, (_, i) => ease('easeOut', i / 59, []))
  const still = curveSvg({ name: 'easeOut', values, line, progress: 1, accent: 'suggestion', isAnimated: false })
  const live = curveSvg({ name: 'easeOut', values, line, progress: 0.5, accent: 'claude', isAnimated: true })
  expect(still.startsWith('<svg')).toBe(true)
  expect(still).not.toContain('@keyframes')
  expect(live).toContain('@keyframes')
  expect(still).toContain('prefers-color-scheme:dark')
  expect(still.match(/<circle/g)?.length).toBe(13)
  expect(curveSvg({ name: '<script>', values, line, progress: 0, accent: 'x', isAnimated: false })).not.toContain('<script>')
  expect(swatchSvg([{ label: 'a<b', hex: '#112233' }])).toContain('a&lt;b')
  expect(fontSvg([{ label: 'sans', family: 'sans-serif' }])).toContain('sans-serif')
})
