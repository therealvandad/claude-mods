import { expect, test } from 'claude-code/testing'

import {
  CALM_BANDS,
  FEATURE_ID_RE,
  GUARD_MODS,
  INDEX,
  KINDS,
  MAX_OVERRIDES,
  NEVER_GATED,
  bareName,
  buildIndex,
  calmOverrides,
  changedCount,
  closestIds,
  effective,
  featurePresetFor,
  isAllowed,
  isFeatureOn,
  isNeverGated,
  keepRows,
  lineFor,
  listMod,
  parseFeatureArgs,
  presetOverrides,
  quietOverrides,
  sanitize,
  withSwitch,
} from './features'
import { REGISTRY } from './registry'
import type { RegistryMod } from './registry'

const def = (id: string) => {
  const d = INDEX.get(id)

  if (d === undefined) {
    throw new Error(`no switch ${id} in the registry`)
  }

  return d
}

// ------------------------------------------------------------ the decision function

test('only an explicit false stops a call, for each of the four kinds', async () => {
  for (const kind of KINDS) {
    const off = { [`noisy.${kind}`]: false }
    expect(isAllowed('noisy', kind, off)).toBe(false)
    expect(isAllowed('noisy', kind, {})).toBe(true)
    expect(isAllowed('noisy', kind, { [`noisy.${kind}`]: true })).toBe(true)
    // another mod's switch, or another kind of the same mod, does not matter
    expect(isAllowed('quiet-one', kind, off)).toBe(true)
    for (const other of KINDS.filter(k => k !== kind)) {
      expect(isAllowed('noisy', other, off)).toBe(true)
    }
  }
})

test('a name with @marketplace or capitals is the same mod', async () => {
  const off = { 'noisy.toasts': false }
  expect(bareName('Noisy@local-mods')).toBe('noisy')
  expect(isAllowed('noisy@local-mods', 'toasts', off)).toBe(false)
  expect(isAllowed('NOISY@x@y', 'toasts', off)).toBe(false)
  expect(isAllowed(' noisy ', 'toasts', off)).toBe(false)
})

test('the engine, settings and the three guard mods are never gated, even with an override that says off', async () => {
  const all: Record<string, boolean> = {}

  for (const name of [...NEVER_GATED, 'hook:tool.check']) {
    for (const kind of KINDS) {
      all[`${name}.${kind}`] = false
    }
  }

  for (const name of ['engine', 'client', 'settings', 'tool-guard', 'safety-pro', 'controls', 'controls@local-mods', 'Tool-Guard', 'hook:tool.check', '']) {
    expect(isNeverGated(name)).toBe(true)

    for (const kind of KINDS) {
      expect(isAllowed(name, kind, all)).toBe(true)
    }
  }
  expect(GUARD_MODS).toEqual(['tool-guard', 'safety-pro', 'controls'])
  expect(isNeverGated('alerts')).toBe(false)
  expect(isNeverGated('cockpit')).toBe(false)
})

test('garbage as the overrides or the plugin name lets everything through', async () => {
  for (const bad of [undefined, null, 'x', 7, [], [false], { 'noisy.toasts': 'false' }, { 'noisy.toasts': 0 }, { 'noisy.toasts': null }]) {
    expect(isAllowed('noisy', 'toasts', bad)).toBe(true)
  }

  for (const name of [undefined, null, 5, {}, []]) {
    expect(isAllowed(name, 'toasts', { 'noisy.toasts': false })).toBe(true)
  }
  // a name that is an Object.prototype key finds nothing
  expect(isAllowed('constructor', 'toasts', {})).toBe(true)
  expect(isAllowed('__proto__', 'band', {})).toBe(true)
})

test('keepRows drops the rows of mods whose band switch is off and keeps the guards', async () => {
  const rows = ['cockpit', 'workbench', 'controls', 'safety-pro@x', 'tool-guard', 'notes@local'].map(plugin => ({ plugin }))
  const kept = keepRows(rows, { 'workbench.band': false, 'controls.band': false, 'notes.band': false, 'cockpit.toasts': false })
  expect(kept.rows.map(r => r.plugin)).toEqual(['cockpit', 'controls', 'safety-pro@x', 'tool-guard'])
  expect(kept.dropped).toBe(2)
  expect(keepRows(rows, {}).dropped).toBe(0)
})

test('isFeatureOn is the documented pattern: the override, else the default', async () => {
  expect(isFeatureOn({}, 'a.b', true)).toBe(true)
  expect(isFeatureOn({}, 'a.b', false)).toBe(false)
  expect(isFeatureOn({ 'a.b': false }, 'a.b', true)).toBe(false)
  expect(isFeatureOn({ 'a.b': true }, 'a.b', false)).toBe(true)
})

// ------------------------------------------------------------ the registry

test('the registry holds no path, no username and every mod has the four switches', async () => {
  const text = JSON.stringify(REGISTRY)
  expect(text).not.toContain(['', 'Users', ''].join('/'))
  expect(text).not.toContain('/home/')
  expect(text).not.toContain('C:\\')
  expect(text).not.toMatch(/\/(var|private|tmp)\//)
  expect(REGISTRY.length).toBeGreaterThan(10)

  for (const mod of REGISTRY) {
    const universal = mod.features.filter(f => f.universal).map(f => f.id)
    expect(universal).toEqual(['toasts', 'sounds', 'status', 'band'])
    expect(mod.features.filter(f => f.universal).every(f => f.default)).toBe(true)
    const ids = mod.features.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  }
  const labels = REGISTRY[0]?.features.filter(f => f.universal).map(f => f.label)
  expect(labels).toEqual(['Show its pop-up messages', 'Play its sounds and speech', 'Write to the status line', 'Show its row above the prompt'])
  expect(INDEX.size).toBe(REGISTRY.reduce((n, m) => n + m.features.length, 0))

  for (const id of INDEX.keys()) {
    expect(FEATURE_ID_RE.test(id)).toBe(true)
  }
})

test('locked means a universal switch of a mod that is never gated', async () => {
  for (const mod of ['settings', 'tool-guard', 'safety-pro', 'controls']) {
    for (const kind of KINDS) {
      expect(def(`${mod}.${kind}`).locked).toBe(true)
    }
  }
  expect(def('cockpit.band').locked).toBe(false)
  expect(def('alerts.toasts').locked).toBe(false)
})

const OWN: RegistryMod[] = [
  {
    name: 'demo',
    description: 'd',
    features: [
      ...KINDS.map(k => ({ id: k, label: k, description: '', default: true, group: 'Universal', universal: true })),
      { id: 'rain', label: 'Rain', description: 'Falling', default: false, group: 'Look', universal: false },
      { id: 'sparkle', label: 'Sparkle', description: '', default: true, group: '', universal: false },
    ],
  },
  { name: 'tool-guard', description: '', features: [{ id: 'toasts', label: 't', description: '', default: true, group: '', universal: true }, { id: 'paste-check', label: 'p', description: '', default: true, group: '', universal: false }] },
]

test('a mod-specific switch with a default of off works with the documented pattern; a guard mod keeps its own switches settable', async () => {
  const index = buildIndex(OWN)
  expect(index.get('demo.rain')?.default).toBe(false)
  expect(index.get('tool-guard.toasts')?.locked).toBe(true)
  expect(index.get('tool-guard.paste-check')?.locked).toBe(false)
  const o = sanitize({ 'demo.rain': true, 'demo.sparkle': false, 'tool-guard.toasts': false, 'tool-guard.paste-check': false }, index)
  expect(o).toEqual({ 'demo.rain': true, 'demo.sparkle': false, 'tool-guard.paste-check': false })
  expect(isFeatureOn(o, 'demo.rain', false)).toBe(true)
  expect(changedCount(o, index)).toBe(3)
})

// ------------------------------------------------------------ sanitising

test('garbage stored values are cleaned: unknown ids, bad ids, non-booleans, locked ids and wrong shapes', async () => {
  expect(sanitize(undefined)).toEqual({})
  expect(sanitize(null)).toEqual({})
  expect(sanitize('x')).toEqual({})
  expect(sanitize(12)).toEqual({})
  expect(sanitize([true, false])).toEqual({})
  expect(
    sanitize({
      'cockpit.toasts': false,
      'cockpit.band': 'no',
      'cockpit.sounds': 1,
      'cockpit.status': null,
      'no-such-mod.toasts': false,
      'cockpit.no-such-switch': false,
      'COCKPIT.toasts': false,
      '../x.toasts': false,
      'controls.toasts': false,
      'settings.band': false,
      '__proto__.toasts': false,
      'constructor.band': false,
      '': false,
      ['x'.repeat(500)]: false,
    }),
  ).toEqual({ 'cockpit.toasts': false })
  expect(sanitize({ 'cockpit.toasts': true })).toEqual({ 'cockpit.toasts': true })
})

test('at most 600 entries are kept', async () => {
  const many: RegistryMod = {
    name: 'big',
    description: '',
    features: Array.from({ length: 700 }, (_, i) => ({ id: `f${i}`, label: 'l', description: '', default: true, group: '', universal: false })),
  }
  const index = buildIndex([many])
  expect(index.size).toBe(700)
  const stored = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`big.f${i}`, false]))
  expect(Object.keys(sanitize(stored, index)).length).toBe(MAX_OVERRIDES)
  expect(MAX_OVERRIDES).toBe(600)
})

// ------------------------------------------------------------ setting, counting, listing

test('a switch set to its default is removed, so the store holds only real changes', async () => {
  const toasts = def('cockpit.toasts')
  const off = withSwitch({}, toasts, false)
  expect(off).toEqual({ 'cockpit.toasts': false })
  expect(withSwitch(off, toasts, true)).toEqual({})
  expect(withSwitch(off, toasts, 'default')).toEqual({})
  expect(withSwitch({}, toasts, true)).toEqual({})
  expect(changedCount(off)).toBe(1)
  expect(changedCount({ 'cockpit.toasts': true, 'nope.x': false })).toBe(0)
  expect(effective(off, toasts)).toBe(false)
  expect(effective({}, toasts)).toBe(true)
})

test('list lines show on or off, the default, and changed switches with a star', async () => {
  const lines = listMod({ 'cockpit.band': false }, 'cockpit')
  expect(lines.length).toBe(4)
  expect(lines.join('\n')).toMatch(/cockpit\.band\s+off\s+\* changed, default on/)
  expect(lines.join('\n')).toMatch(/cockpit\.toasts\s+on\s+\(default on\)/)
  expect(lineFor({}, def('controls.toasts'))).toMatch(/always on/)
})

// ------------------------------------------------------------ presets

test('quiet turns every toast, sound, status and band off except for the guards, settings and alerts', async () => {
  const q = quietOverrides()
  expect(q['cockpit.toasts']).toBe(false)
  expect(q['cockpit.band']).toBe(false)
  expect(q['workbench.sounds']).toBe(false)
  expect(q['motion.status']).toBe(false)

  for (const keep of [...GUARD_MODS, 'settings', 'alerts']) {
    expect(Object.keys(q).filter(id => id.startsWith(`${keep}.`))).toEqual([])
  }
  expect(Object.values(q).every(v => v === false)).toBe(true)
  expect(Object.keys(q).length).toBeLessThanOrEqual(MAX_OVERRIDES)
  expect(sanitize(q)).toEqual(q)
})

test('calm turns toasts, sounds and status off, and keeps a band only for cockpit and alerts', async () => {
  const c = calmOverrides()
  expect(c['workbench.toasts']).toBe(false)
  expect(c['workbench.status']).toBe(false)
  expect(c['workbench.band']).toBe(false)
  expect(c['cockpit.toasts']).toBe(false)
  expect(c['cockpit.band']).toBeUndefined()
  expect(CALM_BANDS).toEqual(['cockpit', 'alerts'])

  for (const keep of [...GUARD_MODS, 'settings', 'alerts']) {
    expect(Object.keys(c).filter(id => id.startsWith(`${keep}.`))).toEqual([])
  }
  expect(Object.keys(c).length).toBeLessThan(Object.keys(quietOverrides()).length)
})

test('full is no overrides, and the look-and-feel presets map to the feature presets (focus is quiet)', async () => {
  expect(presetOverrides('full')).toEqual({})
  expect(presetOverrides('quiet')).toEqual(quietOverrides())
  expect(featurePresetFor('calm')).toBe('calm')
  expect(featurePresetFor('focus')).toBe('quiet')
  expect(featurePresetFor('full')).toBe('full')
})

// ------------------------------------------------------------ the command line

test('/cfg feature arguments parse strictly', async () => {
  expect(parseFeatureArgs('')).toEqual({ kind: 'overview' })
  expect(parseFeatureArgs('  list ')).toEqual({ kind: 'overview' })
  expect(parseFeatureArgs('list cockpit')).toEqual({ kind: 'list', mod: 'cockpit' })
  expect(parseFeatureArgs('list all')).toEqual({ kind: 'list', mod: 'all' })
  expect(parseFeatureArgs('cockpit')).toEqual({ kind: 'list', mod: 'cockpit' })
  expect(parseFeatureArgs('cockpit.toasts')).toEqual({ kind: 'list', mod: 'cockpit' })
  expect(parseFeatureArgs('cockpit.toasts off')).toEqual({ kind: 'set', id: 'cockpit.toasts', value: false })
  expect(parseFeatureArgs('Cockpit.Toasts ON')).toEqual({ kind: 'set', id: 'cockpit.toasts', value: true })
  expect(parseFeatureArgs('cockpit.toasts default')).toEqual({ kind: 'set', id: 'cockpit.toasts', value: 'default' })
  expect(parseFeatureArgs('reset')).toEqual({ kind: 'reset' })
  expect(parseFeatureArgs('quiet')).toEqual({ kind: 'preset', name: 'quiet' })
  expect(parseFeatureArgs('calm')).toEqual({ kind: 'preset', name: 'calm' })
  expect(parseFeatureArgs('full')).toEqual({ kind: 'preset', name: 'full' })
  expect(parseFeatureArgs('quiet now').kind).toBe('error')
  expect(parseFeatureArgs('cockpit.toasts maybe').kind).toBe('error')
  expect(parseFeatureArgs('cockpit.toasts off now').kind).toBe('error')
  expect(parseFeatureArgs('cockpit off').kind).toBe('error')
})

test('an unknown id is said plainly, with the closest ones', async () => {
  const typo = parseFeatureArgs('cockpit.toast off')
  expect(typo.kind).toBe('error')
  expect(typo.kind === 'error' && typo.message).toMatch(/No switch named "cockpit\.toast"\. Closest: cockpit\.toasts/)
  const mod = parseFeatureArgs('cokpit.band on')
  expect(mod.kind === 'error' && mod.message).toMatch(/Closest: cockpit\.band/)
  const nothing = parseFeatureArgs('zzzzzzzzzzzz.qqqqqqqqqqqq on')
  expect(nothing.kind === 'error' && nothing.message).toMatch(/No switch named/)
  expect(nothing.kind === 'error' && nothing.message).not.toMatch(/Closest/)
  expect(closestIds('cockpit.sound')[0]).toBe('cockpit.sounds')
  expect(closestIds('')).toEqual([])
  expect(closestIds('cockpit', INDEX, 5).length).toBeGreaterThan(0)
  expect(closestIds('x'.repeat(5000)).length).toBeLessThanOrEqual(3)
})
