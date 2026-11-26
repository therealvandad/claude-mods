import { expect, test } from 'claude-code/testing'

import {
  COMMANDS,
  GUARDS,
  MAX_AUDIT,
  MAX_CHANGES,
  MAX_ORDER,
  addHolds,
  applyOrder,
  buildIndex,
  buildPlan,
  calmTarget,
  cleanAudit,
  cleanBlock,
  cleanChanges,
  cleanHolds,
  cleanOrder,
  cleanPrefs,
  cleanSnap,
  diffOverrides,
  disableLine,
  dueHolds,
  holdOps,
  isPersonOrigin,
  judge,
  makePending,
  mayToast,
  moveInOrder,
  needsConfirm,
  normalize,
  opsToReach,
  pageOf,
  paletteRows,
  panicDisableLines,
  parseDo,
  parseMinutes,
  parseTidy,
  pendingState,
  pickKeys,
  planSig,
  pushAudit,
  pushChange,
  quietTarget,
  safeTarget,
  tidyOps,
} from './pure'
import type { Op, Overrides, Table, Tidy, World } from './pure'

const uses = { shell: false, files: false, network: false, store: false, webfetch: false, families: [] as string[] }
const mod = (name: string, own: { id: string; default: boolean }[] = [], guard = false) => ({ name, desc: '', guard, cmds: [] as { n: string; d: string }[], own, uses })
const T: Table = [
  mod('notes'),
  mod('alerts'),
  mod('cockpit', [{ id: 'rain', default: false }, { id: 'glow', default: true }]),
  mod('workbench', [{ id: 'tips', default: true }]),
  mod('tool-guard', [], true),
  mod('safety-pro', [], true),
  mod('controls', [], true),
  mod('settings'),
]
const INDEX = buildIndex(T)

/** A stand-in for the settings mod's /cfg feature, written for the test: it replaces or edits the override map and drops overrides equal to the default. */
const applyCfg = (ov: Overrides, args: string): Overrides => {
  const [, what = '', val = ''] = args.split(' ')
  const guards = [...GUARDS, 'settings']

  if (what === 'reset' || what === 'full') {
    return {}
  }

  if (what === 'quiet') {
    const out: Overrides = {}

    for (const m of T.filter(x => !guards.includes(x.name) && x.name !== 'alerts')) {
      for (const k of ['toasts', 'sounds', 'status', 'band']) {
        out[`${m.name}.${k}`] = false
      }
    }

    return out
  }
  const out = { ...ov }
  const dflt = INDEX.get(what)?.default ?? true
  delete out[what]

  if (val !== 'default' && (val === 'on') !== dflt) {
    out[what] = val === 'on'
  }

  return out
}
const run = (start: Overrides, ops: readonly Op[]) => ops.filter(o => o.t === 'cfg').reduce((ov, o) => applyCfg(ov, o.args), start)

const world = (over: Partial<World> = {}): World => ({ table: T, ov: {}, tidy: null, snap: null, holds: [], changes: [], dismissed: {}, rowsBefore: null, now: 1_700_000_000_000, cwd: '/p', ...over })

test('the index marks only the guards and settings universal switches as locked', () => {
  expect(INDEX.get('tool-guard.toasts')?.locked).toBe(true)
  expect(INDEX.get('notes.toasts')?.locked).toBe(false)
  expect(INDEX.get('cockpit.rain')?.default).toBe(false)
  expect(INDEX.get('cockpit.glow')?.default).toBe(true)
})

test('quiet leaves the guards, settings and the notifier alone; calm keeps cockpit and alerts rows', () => {
  const q = quietTarget(T)

  expect(Object.keys(q).some(k => k.startsWith('tool-guard.') || k.startsWith('settings.') || k.startsWith('alerts.'))).toBe(false)
  expect(q['notes.band']).toBe(false)
  expect(Object.keys(q).length).toBe(4 * 3)
  const c = calmTarget(T)

  expect(c['cockpit.band']).toBeUndefined()
  expect(c['cockpit.toasts']).toBe(false)
  expect(c['notes.band']).toBe(false)
})

test('safe mode adds the notifier and every own switch that is on by default, never a guard', () => {
  const s = safeTarget(T)

  expect(s['alerts.toasts']).toBe(false)
  expect(s['cockpit.glow']).toBe(false)
  expect(s['workbench.tips']).toBe(false)
  expect(s['cockpit.rain']).toBeUndefined()
  expect(Object.keys(s).some(k => /^(tool-guard|safety-pro|controls|settings)\./.test(k))).toBe(false)
})

test('overrides: normalize drops defaults, diff is symmetric in size', () => {
  const n = normalize(INDEX, { 'notes.toasts': true, 'notes.sounds': false, 'cockpit.rain': true, bad: true, 'x.y': 3 })

  expect(n).toEqual({ 'notes.sounds': false, 'cockpit.rain': true })
  expect(diffOverrides({ 'a.b': true }, { 'a.b': true })).toEqual([])
  expect(diffOverrides({ 'a.b': true }, { 'a.c': false }).length).toBe(2)
})

test('opsToReach: reaches the target exactly by the cheaper route (property over a few pairs)', () => {
  const ids = ['notes.toasts', 'notes.sounds', 'alerts.band', 'cockpit.rain', 'cockpit.glow', 'workbench.tips', 'workbench.status']
  let seed = 7
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
  const pick = (): Overrides => Object.fromEntries(ids.filter(() => rnd() < 0.5).map(id => [id, rnd() < 0.5]))

  for (let i = 0; i < 40; i++) {
    const a = pick()
    const b = pick()
    const ops = opsToReach(INDEX, a, b)

    expect(normalize(INDEX, run(a, ops))).toEqual(normalize(INDEX, b))
  }
  expect(opsToReach(INDEX, { 'notes.toasts': false }, { 'notes.toasts': false })).toEqual([])
  expect(opsToReach(INDEX, Object.fromEntries(ids.map(id => [id, false])), {}).map(o => o.args)).toEqual(['feature reset'])
})

test('parseTidy reads band-tidy words, and refuses anything else', () => {
  expect(parseTidy('Tidy is on. Showing rows from: cockpit, alerts, safety-pro, controls.\nRows drawn right now: x.\nUsage: ...')).toEqual({ isOn: true, keep: ['cockpit', 'alerts', 'safety-pro', 'controls'] })
  expect(parseTidy('Tidy is off. Showing rows from: (none).\n')).toEqual({ isOn: false, keep: [] })
  expect(parseTidy('hello')).toBeNull()
  expect(parseTidy(undefined)).toBeNull()
  expect(parseTidy('Tidy is on. Showing rows from: ev il;rm.')).toBeNull()
})

test('tidyOps reaches the target filter', () => {
  const from: Tidy = { isOn: true, keep: ['cockpit', 'notes'] }
  const to: Tidy = { isOn: false, keep: ['notes', 'alerts'] }

  expect(tidyOps(from, to).map(o => o.args).sort()).toEqual(['hide cockpit', 'keep alerts', 'off'])
  expect(tidyOps(from, from)).toEqual([])
})

test('off: quiet plus tidy, a restore point the first time, and restore returns exactly', () => {
  const start: Overrides = { 'notes.sounds': false, 'cockpit.rain': true }
  const tidy: Tidy = { isOn: true, keep: ['cockpit', 'alerts', 'notes'] }
  const off = buildPlan({ kind: 'off' }, world({ ov: start, tidy }))

  expect(off.ok).toBe(true)

  if (!off.ok) {
    return
  }
  expect(off.plan.ops[0]).toEqual({ t: 'cfg', args: 'feature quiet' })
  expect(off.plan.ops.filter(o => o.t === 'tidy').map(o => o.args).sort()).toEqual(['hide cockpit', 'hide notes'])
  expect(off.plan.effects.snap?.before).toEqual(start)
  expect(off.plan.flips.length).toBeGreaterThan(0)
  expect(off.plan.confirmFree).toBe(false)
  expect(needsConfirm(off.plan)).toBe(true)

  const snap = off.plan.effects.snap ?? null
  const quiet = run(start, off.plan.ops)
  const back = buildPlan({ kind: 'on' }, world({ ov: quiet, tidy: { isOn: true, keep: ['alerts'] }, snap }))

  expect(back.ok).toBe(true)

  if (!back.ok) {
    return
  }
  expect(normalize(INDEX, run(quiet, back.plan.ops))).toEqual(normalize(INDEX, start))
  expect(back.plan.ops.filter(o => o.t === 'tidy').map(o => o.args).sort()).toEqual(['keep cockpit', 'keep notes'])
  expect(back.plan.effects.snap).toBeNull()

  // A second off keeps the first restore point.
  const again = buildPlan({ kind: 'off' }, world({ ov: quiet, tidy: { isOn: true, keep: ['alerts'] }, snap }))

  expect(again.ok && again.plan.effects.snap === undefined).toBe(true)
})

test('restore with nothing saved says so, and panic is the only confirm-free plan', () => {
  const none = buildPlan({ kind: 'on' }, world())

  expect(none.ok).toBe(false)
  const panic = buildPlan({ kind: 'panic' }, world())

  expect(panic.ok && panic.plan.confirmFree).toBe(true)

  if (panic.ok) {
    expect(panic.plan.disableLines.length).toBeGreaterThan(0)
    expect(panic.plan.disableLines.every(l => l.startsWith('claude plugin disable ') && l.endsWith('@local-mods'))).toBe(true)
    expect(panic.plan.disableLines.some(l => GUARDS.some(g => l.includes(` ${g}@`)))).toBe(false)
    expect(panic.plan.disableLines.some(l => /( settings@| control-kit@| mod-manager@)/.test(l))).toBe(false)
    expect(needsConfirm(panic.plan)).toBe(false)
  }
  expect(panicDisableLines(T)).toContain(disableLine('notes'))
})

test('safe mode ops: quiet first, then the notifier and own switches, one set each', () => {
  const p = buildPlan({ kind: 'safe' }, world())

  expect(p.ok).toBe(true)

  if (p.ok) {
    const args = p.plan.ops.map(o => o.args)

    expect(args[0]).toBe('feature quiet')
    expect(args).toContain('feature alerts.toasts off')
    expect(args).toContain('feature cockpit.glow off')
    expect(args).not.toContain('feature cockpit.rain off')
    expect(normalize(INDEX, run({}, p.plan.ops))).toEqual(normalize(INDEX, safeTarget(T)))
  }
})

test('presets quiet, calm and full are previewed from the table and need a confirm', () => {
  for (const kind of ['quiet', 'calm', 'full'] as const) {
    const p = buildPlan({ kind }, world({ ov: { 'notes.sounds': false } }))

    expect(p.ok && needsConfirm(p.plan)).toBe(true)
    expect(p.ok && p.plan.ops.length).toBe(1)
  }
})

test('pause and snooze: small, one mod, run at once; the original value is what comes back', () => {
  const p = buildPlan({ kind: 'pause', arg: 'notes 30' }, world({ ov: { 'notes.sounds': false } }))

  expect(p.ok).toBe(true)

  if (!p.ok) {
    return
  }
  expect(needsConfirm(p.plan)).toBe(false)
  expect(p.plan.flips.map(f => f.id).sort()).toEqual(['notes.band', 'notes.status', 'notes.toasts'])
  expect(p.plan.effects.holds?.find(h => h.id === 'notes.sounds')?.before).toBe(false)
  expect(p.plan.effects.holds?.find(h => h.id === 'notes.toasts')?.before).toBeNull()
  const s = buildPlan({ kind: 'snooze', arg: 'notes 10' }, world({ ov: {} }))

  expect(s.ok && s.plan.effects.holds?.map(h => h.id).sort()).toEqual(['notes.sounds', 'notes.toasts'])
  expect(buildPlan({ kind: 'pause', arg: 'tool-guard 10' }, world()).ok).toBe(false)
  expect(buildPlan({ kind: 'pause', arg: 'nosuchmod 10' }, world()).ok).toBe(false)
  expect(buildPlan({ kind: 'pause', arg: 'notes 241' }, world()).ok).toBe(false)
  expect(buildPlan({ kind: 'pause', arg: 'notes 0' }, world()).ok).toBe(false)
  expect(buildPlan({ kind: 'pause', arg: 'notes 240' }, world()).ok).toBe(true)
  expect(buildPlan({ kind: 'pause', arg: 'notes 1.5' }, world()).ok).toBe(false)
})

test('a switch held twice keeps its first value; due holds restore to it', () => {
  const first = addHolds([], 'notes', ['toasts', 'sounds'], 'snooze', 1000, { 'notes.sounds': false })
  const second = addHolds(first, 'notes', ['toasts', 'sounds', 'status', 'band'], 'pause', 5000, { 'notes.sounds': false, 'notes.toasts': false })

  expect(second.find(h => h.id === 'notes.sounds')?.before).toBe(false)
  expect(second.find(h => h.id === 'notes.toasts')?.before).toBeNull()
  expect(second.length).toBe(4)
  const { due, rest } = dueHolds(second, 5000)

  expect(due.length).toBe(4)
  expect(rest.length).toBe(0)
  expect(holdOps(due).map(o => o.args).sort()).toEqual(['feature notes.band default', 'feature notes.sounds off', 'feature notes.status default', 'feature notes.toasts default'])
  expect(dueHolds(second, 4999).due.length).toBe(0)
})

test('minutes: whole numbers 1 to 240, default when blank', () => {
  expect(parseMinutes('', 60)).toEqual({ minutes: 60 })
  expect(parseMinutes('240', 60)).toEqual({ minutes: 240 })

  for (const bad of ['0', '241', '-5', '1e3', 'abc', '12 3', '99999']) {
    expect('message' in parseMinutes(bad, 60)).toBe(true)
  }
})

test('undo inverts the last change and skips what changed again', () => {
  const change = { at: 1, label: 'x', flips: [{ id: 'notes.toasts', from: null, to: false }, { id: 'notes.sounds', from: null, to: false }], tidy: null }
  const p = buildPlan({ kind: 'undo' }, world({ ov: { 'notes.toasts': false, 'notes.sounds': true }, changes: [change] }))

  expect(p.ok).toBe(true)

  if (p.ok) {
    expect(p.plan.flips.map(f => f.id)).toEqual(['notes.toasts'])
    expect(p.plan.lines.join(' ')).toContain('notes.sounds')
    expect(p.plan.effects.popChange).toBe(true)
  }
  expect(buildPlan({ kind: 'undo' }, world()).ok).toBe(false)
})

test('dismiss remembers the note and the value to go back to', () => {
  const p = buildPlan({ kind: 'dismiss', arg: 'notes too chatty' }, world({ ov: { 'notes.toasts': false } }))

  expect(p.ok && p.plan.effects.dismissed?.notes?.note).toBe('too chatty')
  expect(p.ok && p.plan.effects.dismissed?.notes?.before).toBe(false)
  const back = buildPlan({ kind: 'undismiss', arg: 'notes' }, world({ ov: { 'notes.toasts': false }, dismissed: { notes: { at: 1, note: '', before: null } } }))

  expect(back.ok && back.plan.flips.map(f => f.to)).toEqual([null])
})

test('rows plans use the tidy words only, and say so when tidy is silent', () => {
  const tidy: Tidy = { isOn: true, keep: ['cockpit', 'alerts', 'notes', 'safety-pro'] }
  const only = buildPlan({ kind: 'rows-only', arg: 'cockpit' }, world({ tidy }))

  expect(only.ok && only.plan.ops.map(o => o.args).sort()).toEqual(['hide alerts', 'hide notes'])
  expect(only.ok && needsConfirm(only.plan)).toBe(true)
  expect(only.ok && only.plan.effects.rowsBefore).toEqual(tidy)
  const hide = buildPlan({ kind: 'rows-hide', arg: 'notes' }, world({ tidy }))

  expect(hide.ok && needsConfirm(hide.plan)).toBe(false)
  const blind = buildPlan({ kind: 'rows-hide', arg: 'notes' }, world())

  expect(blind.ok && blind.plan.ops).toEqual([{ t: 'tidy', args: 'hide notes' }])
  expect(buildPlan({ kind: 'rows-only', arg: 'cockpit' }, world()).ok).toBe(false)
  expect(buildPlan({ kind: 'rows-hide', arg: 'a b;c' }, world({ tidy })).ok).toBe(false)
  const expand = buildPlan({ kind: 'rows-expand' }, world({ tidy: { isOn: true, keep: ['cockpit'] }, rowsBefore: tidy }))

  expect(expand.ok && expand.plan.ops.map(o => o.args).sort()).toEqual(['keep alerts', 'keep notes', 'keep safety-pro'])
})

test('the same world gives the same signature; a changed world a different one', () => {
  const a = buildPlan({ kind: 'quiet' }, world({ ov: { 'notes.sounds': false } }))
  const b = buildPlan({ kind: 'quiet' }, world({ ov: { 'notes.sounds': false } }))
  const c = buildPlan({ kind: 'quiet' }, world({ ov: {} }))

  expect(a.ok && b.ok && c.ok).toBe(true)

  if (a.ok && b.ok && c.ok) {
    expect(planSig(a.plan)).toBe(planSig(b.plan))
    expect(planSig(a.plan)).not.toBe(planSig(c.plan))
    const p = makePending({ kind: 'quiet' }, a.plan, 1000)

    expect(pendingState(p, 1000 + 119_999)).toBe('valid')
    expect(pendingState(p, 1000 + 120_000)).toBe('expired')
    expect(pendingState(null, 5)).toBe('none')
  }
})

test('parseDo and the person origin', () => {
  expect(parseDo('')).toEqual({ kind: 'status' })
  expect(parseDo('CONFIRM')).toEqual({ kind: 'confirm' })
  expect(parseDo('off')).toEqual({ kind: 'stage', spec: { kind: 'off' } })
  expect(parseDo('rm -rf').kind).toBe('error')
  expect(parseDo('off now').kind).toBe('error')
  expect(parseDo('confirm now').kind).toBe('error')
  expect(isPersonOrigin({ kind: 'composer' })).toBe(true)
  expect(isPersonOrigin({ kind: 'plugin', name: 'x' })).toBe(false)
  expect(isPersonOrigin('user')).toBe(false)
  expect(isPersonOrigin(undefined)).toBe(false)
})

test('block list: empty blocks nothing; a piece blocks; the project prefix exempts only a plain command', () => {
  const cfg = cleanBlock({ list: ['Git Push --force', 'rm -rf /'], allow: { '/p': ['git push --force-with-lease'] } })

  expect(judge('ls', { list: [], allow: {} }, '/p').kind).toBe('empty')
  expect(judge('git status', cfg, '/p').kind).toBe('clear')
  expect(judge('GIT   push   --force origin main', cfg, '/p')).toEqual({ kind: 'blocked', by: 'git push --force' })
  expect(judge('git push --force-with-lease origin x', cfg, '/p').kind).toBe('allowed')
  expect(judge('git push --force-with-lease origin x', cfg, '/other').kind).toBe('blocked')
  expect(judge('git push --force-with-lease x; rm -rf /', cfg, '/p').kind).toBe('blocked')
  expect(judge('git push --force-with-lease x && git push --force y', cfg, '/p').kind).toBe('blocked')
  expect(judge('git push --force-with-lease x $(whoami)', cfg, '/p').kind).toBe('blocked')
})

test('block list cleaning bounds everything', () => {
  const many = Array.from({ length: 80 }, (_, i) => `piece number ${i}`)
  const cfg = cleanBlock({ list: [...many, 'x', 3, null, 'y'.repeat(200)], allow: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`/p${i}`, ['git status']])) })

  expect(cfg.list.length).toBe(50)
  expect(Object.keys(cfg.allow).length).toBe(20)
  expect(cleanBlock('nonsense')).toEqual({ list: [], allow: {} })
})

test('row order never drops or repeats a row, is stable, and matches name@market', () => {
  const rows = ['a', 'b@local-mods', 'c', 'd', 'e'].map(plugin => ({ plugin, n: plugin }))
  const out = applyOrder(rows, ['d', 'b', 'zzz'])

  expect(out.map(r => r.plugin)).toEqual(['d', 'b@local-mods', 'a', 'c', 'e'])
  expect([...out].sort((x, y) => x.n.localeCompare(y.n))).toEqual([...rows].sort((x, y) => x.n.localeCompare(y.n)))
  expect(applyOrder(rows, []).map(r => r.plugin)).toEqual(rows.map(r => r.plugin))
  expect(moveInOrder(['a', 'b', 'c'], 'c', 'up')).toEqual(['a', 'c', 'b'])
  expect(moveInOrder(['a', 'b'], 'z', 'top')).toEqual(['z', 'a', 'b'])
  expect(cleanOrder(Array.from({ length: 80 }, (_, i) => `m${i}`)).length).toBe(MAX_ORDER)
  expect(cleanOrder(['ok', 'Bad Name', 5, 'ok'])).toEqual(['ok'])
})

test('priority levels and the pop-up gap', () => {
  expect(mayToast('info', 0, 1e9, 3)).toBe(false)
  expect(mayToast('notice', 0, 1e9, 3)).toBe(true)
  expect(mayToast('notice', 1000, 1000 + 179_999, 3)).toBe(false)
  expect(mayToast('notice', 1000, 1000 + 180_000, 3)).toBe(true)
  expect(mayToast('urgent', 1000, 1001, 3)).toBe(true)
})

test('palette search, paging and permission lines come from the table', () => {
  const t: Table = [{ ...mod('notes'), cmds: [{ n: 'note', d: 'Jot a note' }, { n: 'notes', d: 'List notes' }] }, { ...mod('alerts'), cmds: [{ n: 'al', d: 'Help for alerts' }] }]

  expect(paletteRows(t, '').length).toBe(3)
  expect(paletteRows(t, 'jot').map(r => r.n)).toEqual(['note'])
  expect(paletteRows(t, '/al').map(r => r.n)).toEqual(['al'])
  expect(paletteRows(t, 'nothing at all').length).toBe(0)
  const pg = pageOf([1, 2, 3, 4, 5], 9, 2)

  expect(pg).toEqual({ rows: [5], page: 2, pages: 3 })
  expect(pageOf([], 0, 5).pages).toBe(1)
})

test('stored values are cleaned and bounded', () => {
  expect(cleanSnap('x')).toBeNull()
  expect(cleanSnap({ at: 5, src: 'weird', before: { 'a.b': true, 'bad id': true, 'c.d': 'yes' }, tidy: { isOn: true, keep: ['ok', 'no no'] } })).toEqual({ at: 5, src: 'off', before: { 'a.b': true }, tidy: { isOn: true, keep: ['ok'] }, tidyTo: null })
  expect(cleanHolds([{ id: 'notes.toasts', before: null, until: 5 }, { id: 'bad', before: null, until: 5 }, { id: 'notes.band', before: 'x', until: 5 }])).toEqual([{ id: 'notes.toasts', before: null, until: 5, src: 'pause' }])
  expect(cleanChanges('x')).toEqual([])
  expect(cleanPrefs({ toastGapMin: 1 }).toastGapMin).toBe(3)
  expect(cleanPrefs({ toastGapMin: 9999 }).toastGapMin).toBe(120)
  expect(cleanPrefs(null)).toEqual({ toastGapMin: 3, isLocked: false })
  let ch: ReturnType<typeof cleanChanges> = []

  for (let i = 0; i < MAX_CHANGES + 10; i++) {
    ch = pushChange(ch, { at: i, label: `c${i}`, flips: [], tidy: null })
  }
  expect(ch.length).toBe(MAX_CHANGES)
  expect(ch[ch.length - 1]?.label).toBe(`c${MAX_CHANGES + 9}`)
  let au: ReturnType<typeof cleanAudit> = []

  for (let i = 0; i < MAX_AUDIT + 5; i++) {
    au = pushAudit(au, { at: i, what: 'w', result: 'r' })
  }
  expect(au.length).toBe(MAX_AUDIT)
})

test('hotkeys avoid reserved keys and never repeat', () => {
  const keys = pickKeys(10, ['n', 'p', 'a'])

  expect(new Set(keys).size).toBe(10)
  expect(keys.some(k => ['n', 'p', 'a'].includes(k))).toBe(false)
  expect(keys.every(k => /^[a-z]$/.test(k))).toBe(true)
})

test('commands: every name starts with kc, is unique, and fits the engine rules', () => {
  const names = COMMANDS.map(c => c[0])

  expect(new Set(names).size).toBe(names.length)
  expect(names.every(n => /^kc[a-z0-9]{0,13}$/.test(n))).toBe(true)
  expect(COMMANDS.every(c => c[1].length >= 8 && c[1].includes(' '))).toBe(true)
  expect(names).toContain('kc')
  expect(names).toContain('kcreset')
})
