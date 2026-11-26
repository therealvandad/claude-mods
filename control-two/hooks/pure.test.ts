import { expect, test } from 'claude-code/testing'

import { CHANGELOG } from './changelog'
import { DUPLICATES, MODS } from './data'
import { depGraphSvg, graphOf } from './svg'
import {
  COMMANDS,
  MAX_ERRORS,
  MAX_NOTES,
  MAX_PINS,
  MAX_RULES,
  MAX_SNAPS,
  MAX_SOUND_CALLS,
  soundsBatch,
  MAX_TIMING,
  addStat,
  allMods,
  buildDiag,
  changelogRows,
  cleanOverrides,
  compareUpdates,
  compareVersions,
  depLines,
  diffOverrides,
  discoverBundled,
  featureArgs,
  findMod,
  healthFor,
  helpText,
  isErrorLine,
  liveConflicts,
  makePending,
  makeSnap,
  maskPaths,
  metricsFromUsage,
  normalizeRules,
  normalizeSnaps,
  pageOf,
  parseNote,
  parseOnOff,
  parsePin,
  parsePluginList,
  parseRule,
  pendingState,
  planRules,
  pushError,
  pushSnap,
  resetCommands,
  restoreCalls,
  rollbackText,
  sanitize,
  selfTests,
  soundMods,
  soundsPlan,
  soundsState,
  topStats,
  withNote,
  withPin,
} from './pure'
import type { LiveCmd } from './pure'

// ------------------------------------------------------------ the table

test('the build-time table has mods, its duplicate scan agrees with it, and every mod has a changelog row', () => {
  expect(MODS.length).toBeGreaterThan(30)
  const names = MODS.flatMap(m => m.cmds)
  const owners = new Map<string, string[]>()

  for (const m of MODS) {
    for (const c of m.cmds) {
      owners.set(c, [...(owners.get(c) ?? []), m.name])
    }
  }
  // the embedded scan result agrees with the table it was made from
  expect(Object.keys(DUPLICATES).sort()).toEqual([...owners].filter(([, v]) => v.length > 1).map(([k]) => k).sort())
  expect(names.length).toBeGreaterThan(300)
  expect(CHANGELOG.length).toBeGreaterThanOrEqual(38)
  // every mod of the table has a row, written by hand or the plain fallback
  expect(changelogRows().length).toBe(allMods().length)
  expect(changelogRows().every(c => c.text.length > 10)).toBe(true)
})

test('every command of this mod starts with kx and is unique, and help lists each', () => {
  const names = COMMANDS.map(c => c[0])
  expect(new Set(names).size).toBe(names.length)

  for (const n of names) {
    expect(n.startsWith('kx')).toBe(true)
    expect(helpText()).toContain(`/${n}`)
  }
  expect(names.length).toBeLessThan(40)
})

test('no path or user name sits in the build-time data', () => {
  const text = JSON.stringify([MODS, CHANGELOG])
  expect(text).not.toMatch(/\/Users\/|\/home\/|C:\\\\/)
})

// ------------------------------------------------------------ switches and sounds

test('cleanOverrides keeps well-formed boolean overrides only', () => {
  expect(cleanOverrides({ 'cockpit.band': false, 'bad id': true, 'x.y': 'on', 'motion.sounds': true })).toEqual({ 'cockpit.band': false, 'motion.sounds': true })
  expect(cleanOverrides(null)).toEqual({})
  expect(cleanOverrides([1, 2])).toEqual({})
})

test('the sounds plan touches every unlocked mod once and one go stays under 40 calls', () => {
  const plan = soundsPlan({}, 'off')

  expect(plan.length).toBe(soundMods().length)
  expect(MAX_SOUND_CALLS).toBe(39)
  expect(soundsBatch(plan).calls.length).toBeLessThan(40)
  expect(soundsBatch(plan).rest).toBe(Math.max(0, plan.length - 39))
  expect(soundsBatch(Array.from({ length: 50 }, () => 'x'))).toEqual({ calls: Array.from({ length: 39 }, () => 'x'), rest: 11 })
  expect(plan[0]).toMatch(/^feature [a-z0-9-]+\.sounds off$/)
  expect(plan.some(l => /tool-guard|safety-pro|controls|settings\./.test(l))).toBe(false)
})

test('the sounds plan skips mods already in the target state and reads the state', () => {
  const off = Object.fromEntries(soundMods().map(m => [`${m}.sounds`, false]))

  expect(soundsState({})).toBe('on')
  expect(soundsState(off)).toBe('off')
  expect(soundsState({ 'notes.sounds': false })).toBe('mixed')
  expect(soundsPlan(off, 'off')).toEqual([])
  expect(soundsPlan({ 'notes.sounds': false }, 'on')).toEqual(['feature notes.sounds on'])
  expect(soundsPlan({ 'notes.sounds': false }, 'off').length).toBe(soundMods().length - 1)
})

test('parseOnOff', () => {
  expect(parseOnOff('')).toEqual({ ok: true, value: 'toggle' })
  expect(parseOnOff(' OFF ')).toEqual({ ok: true, value: 'off' })
  expect(parseOnOff('status')).toEqual({ ok: true, value: 'status' })
  expect(parseOnOff('maybe').ok).toBe(false)
})

// ------------------------------------------------------------ rules

test('parseRule accepts the documented forms and rejects locked mods, bad kinds and bad numbers', () => {
  const ok = parseRule('cockpit band hide when ctx >= 70')

  expect(ok).toEqual({ ok: true, rule: { mod: 'cockpit', kind: 'band', action: 'hide', metric: 'ctx', op: 'ge', value: 70 } })
  expect(parseRule('alerts toasts show cost<2.5')).toEqual({ ok: true, rule: { mod: 'alerts', kind: 'toasts', action: 'show', metric: 'cost', op: 'lt', value: 2.5 } })
  expect(parseRule('tool-guard band hide ctx >= 70').ok).toBe(false)
  expect(parseRule('settings toasts hide ctx >= 70').ok).toBe(false)
  expect(parseRule('nosuchmod band hide ctx >= 70').ok).toBe(false)
  expect(parseRule('cockpit glow hide ctx >= 70').ok).toBe(false)
  expect(parseRule('cockpit band hide ctx >= 700').ok).toBe(false)
  expect(parseRule('cockpit band hide ctx >= x').ok).toBe(false)
  expect(parseRule('cockpit band').ok).toBe(false)
})

test('normalizeRules keeps valid rules, drops locked and malformed ones, and caps at 10', () => {
  const good = { mod: 'cockpit', kind: 'band', action: 'hide', metric: 'ctx', op: 'ge', value: 70 }
  const many = Array.from({ length: 20 }, () => good)

  expect(normalizeRules(many).length).toBe(MAX_RULES)
  expect(normalizeRules([good, { ...good, mod: 'tool-guard' }, { ...good, kind: 'x' }, null, 5])).toEqual([good])
  expect(normalizeRules('no')).toEqual([])
})

test('planRules sets a switch while a rule matches and puts it back afterwards', () => {
  const rules = normalizeRules([{ mod: 'cockpit', kind: 'band', action: 'hide', metric: 'ctx', op: 'ge', value: 70 }])
  const high = { ctx: 80, cost: null, limit: null }
  const low = { ctx: 20, cost: null, limit: null }
  const first = planRules(rules, {}, {}, high)

  expect(first.calls).toEqual([{ id: 'cockpit.band', on: false }])
  expect(first.applied).toEqual({ 'cockpit.band': { orig: true, set: false } })
  // still high and already off: no new call
  expect(planRules(rules, first.applied, { 'cockpit.band': false }, high).calls).toEqual([])
  // low again: restore
  const back = planRules(rules, first.applied, { 'cockpit.band': false }, low)

  expect(back.calls).toEqual([{ id: 'cockpit.band', on: true }])
  expect(back.applied).toEqual({})
})

test('planRules leaves a switch alone that somebody else changed meanwhile, and ignores unknown metrics', () => {
  const rules = normalizeRules([{ mod: 'cockpit', kind: 'band', action: 'hide', metric: 'ctx', op: 'ge', value: 70 }])
  const applied = { 'cockpit.band': { orig: true, set: false } }
  const low = { ctx: 10, cost: null, limit: null }
  // the person turned it back on by hand: nothing to restore, and it is forgotten
  const hand = planRules(rules, applied, {}, low)

  expect(hand.calls).toEqual([])
  expect(hand.applied).toEqual({})
  expect(planRules(rules, {}, {}, { ctx: null, cost: null, limit: null }).calls).toEqual([])
})

test('later rules win and the calls are capped', () => {
  const rules = normalizeRules([
    { mod: 'alerts', kind: 'band', action: 'hide', metric: 'ctx', op: 'ge', value: 10 },
    { mod: 'alerts', kind: 'band', action: 'show', metric: 'cost', op: 'ge', value: 1 },
  ])

  expect(planRules(rules, {}, {}, { ctx: 50, cost: 2, limit: null }).calls).toEqual([])
  expect(planRules(rules, {}, {}, { ctx: 50, cost: 0, limit: null }).calls).toEqual([{ id: 'alerts.band', on: false }])
  expect(restoreCalls({ 'alerts.band': { orig: true, set: false } }, { 'alerts.band': false })).toEqual([{ id: 'alerts.band', on: true }])
  expect(restoreCalls({ 'alerts.band': { orig: true, set: false } }, {})).toEqual([])
})

test('metricsFromUsage reads context, cost and the highest rate limit', () => {
  expect(metricsFromUsage({ context: { percent: 41 }, cost: { usd: 1.5 }, rateLimits: [{ percentUsed: 20 }, { percentUsed: 65 }] })).toEqual({ ctx: 41, cost: 1.5, limit: 65 })
  expect(metricsFromUsage({ context: { percent: 5 }, rateLimits: [] })).toEqual({ ctx: 5, cost: null, limit: null })
  expect(metricsFromUsage(undefined)).toEqual({ ctx: null, cost: null, limit: null })
})

// ------------------------------------------------------------ pins, notes, snapshots

test('pins: parse, validate and cap', () => {
  expect(parsePin('')).toEqual({ kind: 'list' })
  expect(parsePin('notes 0.1.0 stay here')).toEqual({ kind: 'add', pin: { mod: 'notes', version: '0.1.0', note: 'stay here' } })
  expect(parsePin('rm notes')).toEqual({ kind: 'rm', mod: 'notes' })
  expect(parsePin('notes latest').kind).toBe('error')
  expect(parsePin('zzz 1.0.0').kind).toBe('error')
  const many = Array.from({ length: MAX_PINS + 5 }, (_, i) => ({ mod: 'notes', version: `0.${i}.0`, note: '' }))
  expect(withPin(withPin([], many[0]!), many[1]!).length).toBe(1)
})

test('notes: parse, mask secrets and paths, cap at 50', () => {
  expect(parseNote('')).toEqual({ kind: 'list', mod: '' })
  expect(parseNote('notes')).toEqual({ kind: 'list', mod: 'notes' })
  expect(parseNote('clear all')).toEqual({ kind: 'clear', mod: 'all' })
  expect(parseNote('zzz hello there').kind).toBe('error')
  expect(parseNote('notes hi').kind).toBe('error')
  const add = parseNote('notes my token=abcdefghijklmnop42 file /Users/someone/work/x.txt is odd')

  expect(add.kind).toBe('add')
  expect(JSON.stringify(add)).not.toMatch(/abcdefghijklmnop42|someone/)
  let list: ReturnType<typeof withNote> = []

  for (let i = 0; i < MAX_NOTES + 10; i++) {
    list = withNote(list, { at: i, mod: 'notes', text: 'n' })
  }
  expect(list.length).toBe(MAX_NOTES)
})

test('snapshots keep the last five, newest last, and normalise whatever was stored', () => {
  const own = { recording: false, persist: 'saved' as const, rules: [], pins: [] }
  let snaps: ReturnType<typeof pushSnap> = []

  for (let i = 0; i < 8; i++) {
    snaps = pushSnap(snaps, makeSnap(i, `s${i}`, { 'cockpit.band': i % 2 === 0 }, own))
  }
  expect(snaps.length).toBe(MAX_SNAPS)
  expect(snaps[0]?.at).toBe(3)
  expect(snaps[4]?.at).toBe(7)
  expect(normalizeSnaps(JSON.parse(JSON.stringify(snaps))).length).toBe(MAX_SNAPS)
  expect(normalizeSnaps('x')).toEqual([])
  expect(normalizeSnaps([{ at: 1 }, { at: 'a', own: {} }])).toEqual([])
  expect(normalizeSnaps([{ at: 1, label: 'x', overrides: { 'bad id': true, 'notes.band': false }, own: { recording: true, persist: 'session' } }])[0]).toEqual({
    at: 1,
    label: 'x',
    overrides: { 'notes.band': false },
    own: { recording: true, persist: 'session', rules: [], pins: [] },
  })
})

test('diffOverrides lists on, off and default changes, and skips locked mods and unknown names', () => {
  const { changes, skipped } = diffOverrides(
    { 'cockpit.band': false, 'alerts.toasts': false, 'tool-guard.toasts': false },
    { 'cockpit.band': false, 'alerts.sounds': false, 'notes.band': true, 'nosuch.band': false },
  )

  expect(changes).toEqual([
    { id: 'alerts.sounds', to: 'off' },
    { id: 'alerts.toasts', to: 'default' },
    { id: 'notes.band', to: 'on' },
  ])
  expect(skipped).toBe(2)
  expect(featureArgs('notes.band', 'on')).toBe('feature notes.band on')
})

test('pending actions expire after two minutes', () => {
  const p = makePending('reset', 1000, 0, [])

  expect(pendingState(p, 1000 + 119_000)).toBe('valid')
  expect(pendingState(p, 1000 + 121_000)).toBe('expired')
  expect(pendingState(null, 5)).toBe('none')
  expect(makePending('restore', 0, 1, Array.from({ length: 200 }, () => 'x')).steps.length).toBe(60)
})

test('reset commands come from the table, one per mod, never this mod\'s own', () => {
  const list = resetCommands()

  expect(list.length).toBeGreaterThan(15)
  expect(list.some(r => r.mod === 'control-two')).toBe(false)
  expect(list.find(r => r.mod === 'alerts')?.command).toBe('alreset')
  expect(list.find(r => r.mod === 'anim-extra')?.command).toBe('axreset')
})

// ------------------------------------------------------------ versions, plugin list, updates

test('compareVersions', () => {
  expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
  expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
  expect(compareVersions('x', '1.0.0')).toBeNull()
})

test('parsePluginList reads json and plain output without keeping folders', () => {
  const json = parsePluginList(JSON.stringify([{ id: 'notes@local-mods', version: '0.1.0', scope: 'user', enabled: true, installPath: '/Users/a/x' }, { id: 'alerts@local-mods', version: '0.0.9', enabled: false }]))

  expect(json.ok).toBe(true)
  expect(JSON.stringify(json)).not.toContain('/Users')
  const plain = parsePluginList('Installed plugins:\n\n  ❯ notes@local-mods\n    Version: 0.1.0\n    Scope: user\n    Status: ✔ enabled\n')

  expect(plain.ok && plain.list[0]).toMatchObject({ name: 'notes', version: '0.1.0', status: 'enabled' })
  expect(parsePluginList('garbage').ok).toBe(false)
})

test('compareUpdates marks newer, same, missing and disabled', () => {
  const list = [
    { id: 'notes@m', name: 'notes', market: 'm', version: '0.0.1', scope: 'user', status: 'enabled' as const },
    { id: 'alerts@m', name: 'alerts', market: 'm', version: '0.1.0', scope: 'user', status: 'disabled' as const },
    { id: 'looks@m', name: 'looks', market: 'm', version: '9.0.0', scope: 'user', status: 'enabled' as const },
    { id: 'motion@m', name: 'motion', market: 'm', version: '0.1.0', scope: 'user', status: 'enabled' as const },
  ]
  const rows = compareUpdates(list, [{ mod: 'notes', version: '0.0.1', note: '' }])
  const by = (n: string) => rows.find(r => r.mod === n)

  expect(by('notes')?.state).toBe('newer-in-table')
  expect(by('notes')?.pin).toBe('0.0.1')
  expect(by('alerts')?.state).toBe('disabled')
  expect(by('looks')?.state).toBe('installed-newer')
  expect(by('motion')?.state).toBe('same')
  expect(by('settings')?.state).toBe('not-installed')
})

test('discoverBundled finds the app binary the way the mod manager does, and refuses a bad home', async () => {
  const dirs: Record<string, { name: string; kind: string }[]> = {
    '/h/Library/Application Support/Claude/claude-code': [{ name: '2.1.330', kind: 'dir' }, { name: '2.1.9', kind: 'dir' }, { name: 'junk', kind: 'dir' }],
    '/h/Library/Application Support/Claude/claude-code/2.1.330': [{ name: 'abc123', kind: 'dir' }],
    '/h/Library/Application Support/Claude/claude-code/2.1.9': [{ name: 'old', kind: 'dir' }],
  }
  const list = async (p: string) => {
    const d = dirs[p]

    if (d === undefined) {
      throw new Error('ENOENT')
    }

    return d
  }
  const found = await discoverBundled('/h', list)

  expect(found[0]).toBe('/h/Library/Application Support/Claude/claude-code/2.1.330/abc123/claude.app/Contents/MacOS/claude')
  expect(found.length).toBe(2)
  expect(await discoverBundled('relative', list)).toEqual([])
  expect(await discoverBundled('/a/../b', list)).toEqual([])
})

test('rollback text says it is not possible and shows git lines without a path', () => {
  const t = rollbackText('notes')

  expect(t).toMatch(/not possible/)
  expect(t).toContain('git -C <your mods folder>')
  expect(t).not.toMatch(/\/Users\//)
})

// ------------------------------------------------------------ health, conflicts, self-tests

const liveFor = (name: string, mod = findMod(name)): LiveCmd[] => (mod?.cmds ?? []).map(c => ({ name: c, plugin: name, source: 'plugin' }))

test('health lights: green when its commands are there, amber when some, red when none, grey when it has none', () => {
  const alerts = findMod('alerts')!
  const all = liveFor('alerts')

  expect(healthFor(alerts, all, 0).light).toBe('green')
  expect(healthFor(alerts, all, 2).light).toBe('amber')
  expect(healthFor(alerts, all.slice(0, 3), 0).light).toBe('amber')
  expect(healthFor(alerts, [], 0).light).toBe('red')
  expect(healthFor(alerts, all.map(c => ({ ...c, plugin: 'other' })), 0).light).toBe('red')
  expect(healthFor(findMod('look-and-sound')!, [], 0).light).toBe('grey')
  // the engine may not know the owner: the name alone counts
  expect(healthFor(alerts, all.map(c => ({ name: c.name })), 0).light).toBe('green')
})

test('live conflicts: a name served by two plugins, or by the wrong one', () => {
  const cmds = [...liveFor('alerts'), { name: 'alreset', plugin: 'intruder', source: 'plugin' }]
  const found = liveConflicts(cmds)

  expect(found.some(l => l.includes('/alreset') && l.includes('alerts') && l.includes('intruder'))).toBe(true)
  expect(liveConflicts(liveFor('alerts'))).toEqual([])
})

test('self-tests come from the table, never invented', () => {
  const t = selfTests()

  expect(t.map(x => x.mod).sort()).toEqual(['alerts', 'controls'])
  expect(t.find(x => x.mod === 'controls')?.line).toBe('/ctselftest')
})

// ------------------------------------------------------------ recorders

test('addStat counts, averages through topStats, and refuses a 61st key', () => {
  let t = addStat({}, 'alerts', 10)
  t = addStat(t, 'alerts', 30)
  t = addStat(t, 'notes', 5)

  expect(t.alerts).toEqual({ n: 2, ms: 40, max: 30 })
  expect(topStats(t, 5)[0]).toMatchObject({ key: 'alerts', avg: 20 })

  for (let i = 0; i < MAX_TIMING + 10; i++) {
    t = addStat(t, `mod${i}`, 1)
  }
  expect(Object.keys(t).length).toBe(MAX_TIMING)
  expect(addStat({}, 'x', Number.NaN).x).toEqual({ n: 1, ms: 0, max: 0 })
})

test('error lines: which text counts, repeats collapse, the log is capped and cleaned', () => {
  expect(isErrorLine('Could not read the file')).toBe(true)
  expect(isErrorLine('hook failed after 3 s')).toBe(true)
  expect(isErrorLine('all good')).toBe(false)
  let list: ReturnType<typeof pushError> = []
  list = pushError(list, { at: 1, plugin: 'a', text: 'failed token=abcdefghijklmnopqrst' })
  list = pushError(list, { at: 2, plugin: 'a', text: 'failed token=abcdefghijklmnopqrst' })
  expect(list.length).toBe(1)
  expect(list[0]?.text).not.toContain('abcdefghijklmnopqrst')

  for (let i = 0; i < MAX_ERRORS + 20; i++) {
    list = pushError(list, { at: i, plugin: 'a', text: `error ${i}` })
  }
  expect(list.length).toBe(MAX_ERRORS)
})

// ------------------------------------------------------------ diagnostics, text helpers, graph

test('the diagnostics text has versions, mods, overrides and counts, and no path or user name', () => {
  const text = buildDiag(
    {
      now: 0,
      installed: { loadedAt: 1000, list: [{ id: 'notes@m', name: 'notes', market: 'm', version: '0.1.0', scope: 'user', status: 'enabled' }], error: '' },
      overrides: { 'cockpit.band': false },
      motionOn: true,
      calmOn: false,
      preset: 'full',
      own: { rules: 1, pins: 0, notes: 2, snaps: 3, recording: true, persist: 'saved' },
      recorders: { timing: 1, errors: 2, order: 3, refusals: 0 },
      health: { at: 5, green: 30, amber: 2, red: 1, grey: 4 },
    },
    '/Users/jane/x',
  )

  expect(text).toContain('control-two 0.1.0')
  expect(text).toContain('notes 0.1.0 enabled')
  expect(text).toContain('cockpit.band off')
  expect(text).toContain('30 good')
  expect(text).not.toMatch(/jane|\/Users\//)
})

test('maskPaths and sanitize hide home folders and secrets', () => {
  expect(maskPaths('read /Users/jane/work/a.txt now')).toBe('read ~/work/a.txt now')
  expect(maskPaths('x /home/bob/y', '/home/bob')).toBe('x ~/y')
  expect(sanitize('\u001b[31mred\u001b[0m token: sk-abcdefghijklmnopqrstuv')).toBe('red token: [masked]')
})

test('the dependency graph covers every dependent, in text and in the vector drawing', () => {
  const g = graphOf(allMods())

  expect(g.providers).toContain('motion')
  expect(g.providers).toContain('settings')
  expect(g.dependents.length).toBeGreaterThan(10)
  expect(depLines().some(l => /^motion is needed by \d+/.test(l))).toBe(true)
  const svg = depGraphSvg(allMods(), 'suggestion')

  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('prefers-color-scheme:dark')
  expect(svg).not.toMatch(/<script|onload|href=/)
  expect((svg.match(/class="n"/g) ?? []).length).toBe(g.dependents.length)
  expect(svg).not.toMatch(/@keyframes|animation:/)
})

test('pageOf clamps pages', () => {
  const items = Array.from({ length: 25 }, (_, i) => i)

  expect(pageOf(items, 0, 10).items.length).toBe(10)
  expect(pageOf(items, 9, 10)).toMatchObject({ page: 2, pages: 3 })
  expect(pageOf(items, -3, 10).page).toBe(0)
  expect(pageOf([], 0, 10)).toMatchObject({ pages: 1, items: [] })
})
