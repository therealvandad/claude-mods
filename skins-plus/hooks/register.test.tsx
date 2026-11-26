import { expect, mock, test } from 'claude-code/testing'

import { COLOUR_NAMES, FIXED, WEEKDAYS, allFixed, branchSlot, build, customDef, hexHue, huePalette, parseColour, sunHue, BRANCH_HUES } from './palettes'
import {
  activeRule,
  addRule,
  bounded,
  checkTemplate,
  cleanCfg,
  defaults,
  diffCfg,
  exportPalette,
  exportSetup,
  normTime,
  parseImport,
  renderTemplate,
  spaceText,
  styleFor,
} from './pure'

// ---------------------------------------------------------------- pure: palettes paint

test('every palette this mod can produce paints in Desktop', () => {
  const refused: string[] = []
  const check = (label: string, def: Parameters<typeof build>[1], roles = {}) => {
    const built = build(label, def, roles)

    if (built.refused !== undefined) {
      refused.push(`${label}: ${built.refused}`)
    }
  }

  for (const s of allFixed()) {
    check(s.id, s.def)
  }

  for (let hue = 0; hue < 360; hue += 10) {
    check(`hue ${hue}`, huePalette(hue))
  }

  for (let hue = 0; hue < 360; hue += 30) {
    check(`custom both ${hue}`, customDef({ hue, sat: 40, mode: 'both' }))
    check(`custom dark ${hue}`, customDef({ hue, sat: 0, mode: 'dark' }))
    check(`custom light ${hue}`, customDef({ hue, sat: 25, mode: 'light' }))
  }

  for (const hex of Object.values(COLOUR_NAMES)) {
    check(`project ${hex}`, huePalette(hexHue(hex), hex))
  }

  for (const hex of ['#000000', '#ffffff', '#ffff00', '#00ffff', '#808080']) {
    check(`project edge ${hex}`, huePalette(hexHue(hex), hex))
  }

  for (let h = 0; h < 24; h += 2) {
    check(`sun ${h}`, huePalette(sunHue(h)))
  }

  for (const hue of BRANCH_HUES) {
    check(`branch ${hue}`, huePalette(hue))
  }
  check('roles', FIXED.hivis!.def, { danger: '#aa0000', accent: '#0044aa' })
  expect(refused).toEqual([])
  expect(Object.keys(FIXED).length).toBe(11)
})

test('single-mode palettes name their mode, and print/hivis are as asked', () => {
  expect(FIXED.cyber!.def.only).toBe('dark')
  expect(FIXED.night!.def.only).toBe('dark')
  expect(FIXED.print!.def.only).toBe('light')
  expect((build('h', FIXED.hivis!.def).theme as { contrast?: string }).contrast).toBe('more')
  // Cozy night keeps blue under red in every role and text colour.
  const night = FIXED.night!.def
  const hexes = [...Object.values(night.roles ?? {}), ...Object.values(night.dark!.gray!.anchors!)] as string[]

  for (const hex of hexes) {
    expect(parseInt(hex.slice(5, 7), 16)).toBeLessThan(parseInt(hex.slice(1, 3), 16))
  }
  expect(WEEKDAYS.map(d => d.id)).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
})

test('hues: branch slots are stable, sun hue moves with the hour, colours parse', () => {
  expect(branchSlot('main')).toBe(branchSlot('main'))
  expect(new Set(['main', 'dev', 'feat/a', 'feat/b', 'fix/1', 'x', 'y', 'release'].map(branchSlot)).size).toBeGreaterThan(2)

  for (const b of ['a', 'main', 'a-very-long-branch-name/with/slashes', '']) {
    expect(branchSlot(b)).toBeGreaterThanOrEqual(0)
    expect(branchSlot(b)).toBeLessThan(8)
  }
  expect(sunHue(0)).toBe(255)
  expect(sunHue(7)).toBe(35)
  expect(sunHue(13)).toBe(190)
  expect(sunHue(24)).toBe(255)
  expect(sunHue(9)).not.toBe(sunHue(15))
  expect(hexHue('#ff0000')).toBe(0)
  expect(hexHue('#00ff00')).toBe(120)
  expect(hexHue('#0000ff')).toBe(240)
  expect(parseColour('Red')).toBe('#c0392b')
  expect(parseColour('#AABBCC')).toBe('#aabbcc')
  expect(parseColour('#abc')).toBeUndefined()
  expect(parseColour('chartreuse')).toBeUndefined()
})

// ---------------------------------------------------------------- pure: rules, templates, imports

test('schedule rules: time parsing, sorting, the rule in force, wrap past midnight', () => {
  expect(normTime('6:00')).toBe('06:00')
  expect(normTime('24:00')).toBeUndefined()
  expect(normTime('9:7')).toBeUndefined()
  let rules = addRule([], '22:00', 'cozy') as { at: string; skin: string }[]

  rules = addRule(rules, '6:00', 'default') as typeof rules
  expect(rules).toEqual([
    { at: '06:00', skin: 'default' },
    { at: '22:00', skin: 'night' },
  ])
  expect(addRule(rules, '22:00', 'cyber')).toEqual([
    { at: '06:00', skin: 'default' },
    { at: '22:00', skin: 'cyber' },
  ])
  expect(typeof addRule(rules, '25:00', 'night')).toBe('string')
  expect(typeof addRule(rules, '10:00', 'neonpurple')).toBe('string')
  expect(activeRule(rules, 7 * 60)?.skin).toBe('default')
  expect(activeRule(rules, 23 * 60)?.skin).toBe('night')
  expect(activeRule(rules, 3 * 60)?.skin).toBe('night')
  expect(activeRule([], 100)).toBeUndefined()

  let many: { at: string; skin: string }[] = []

  for (let i = 0; i < 12; i++) {
    many = addRule(many, `${String(i).padStart(2, '0')}:00`, 'night') as typeof many
  }
  expect(typeof addRule(many, '13:00', 'night')).toBe('string')
})

test('status templates: known placeholders only, rendered, bounded', () => {
  expect(checkTemplate('{branch} {cost} {context}')).toBeUndefined()
  expect(checkTemplate('{nope}')).toMatch(/Unknown placeholder/)
  expect(checkTemplate('')).toMatch(/placeholders/)
  expect(checkTemplate('x'.repeat(200))).toMatch(/too long/)
  expect(checkTemplate('a\u0007b')).toMatch(/control/)
  expect(renderTemplate('{branch} {cost}  {context}', { branch: 'main', cost: '$1.20', context: '40%' })).toBe('main $1.20 40%')
})

test('import is strict: unknown keys, bad ranges, wrong kind, bad JSON, too long', () => {
  const good = JSON.parse(exportPalette({ hue: 200, sat: 20, mode: 'both', accent: '#2288cc' }))

  expect(parseImport(JSON.stringify(good))).toEqual({ kind: 'palette', palette: { hue: 200, sat: 20, mode: 'both', accent: '#2288cc' } })
  expect(parseImport('{nope')).toEqual({ error: expect.stringMatching(/not valid JSON/) })
  expect(parseImport('[]')).toEqual({ error: expect.stringMatching(/object/) })
  expect(parseImport(JSON.stringify({ ...good, hue: 400 }))).toEqual({ error: expect.stringMatching(/hue/) })
  expect(parseImport(JSON.stringify({ ...good, sat: 41 }))).toEqual({ error: expect.stringMatching(/sat/) })
  expect(parseImport(JSON.stringify({ ...good, extra: 1 }))).toEqual({ error: expect.stringMatching(/unknown key/) })
  expect(parseImport(JSON.stringify({ ...good, accent: 'red' }))).toEqual({ error: expect.stringMatching(/accent/) })
  expect(parseImport(JSON.stringify({ ...good, v: 2 }))).toEqual({ error: expect.stringMatching(/v must be 1/) })
  expect(parseImport(JSON.stringify({ kind: 'something' }))).toEqual({ error: expect.stringMatching(/kind/) })
  expect(parseImport('x'.repeat(7000))).toEqual({ error: expect.stringMatching(/too long/) })
  expect(parseImport('')).toEqual({ error: expect.stringMatching(/Nothing to import/) })

  const setup = JSON.parse(exportSetup(defaults()))

  expect('error' in parseImport(JSON.stringify(setup))).toBe(false)
  expect(parseImport(JSON.stringify({ ...setup, settings: { ...setup.settings, scheme: 'purple' } }))).toEqual({ error: expect.stringMatching(/scheme/) })
  expect(parseImport(JSON.stringify({ ...setup, settings: { ...setup.settings, evil: true } }))).toEqual({ error: expect.stringMatching(/unknown setting/) })
  expect(parseImport(JSON.stringify({ ...setup, settings: { ...setup.settings, roles: { danger: 'red' } } }))).toEqual({ error: expect.stringMatching(/role/) })
  expect(parseImport(JSON.stringify({ ...setup, settings: { ...setup.settings, status: { on: true, template: '{bad}' } } }))).toEqual({
    error: expect.stringMatching(/Unknown placeholder/),
  })
  expect(parseImport(JSON.stringify({ ...setup, settings: { ...setup.settings, sched: { on: true, rules: [{ at: '99:99', skin: 'night' }] } } }))).toEqual({
    error: expect.stringMatching(/sched rule/),
  })
})

test('diff lists only what changes; stored garbage falls back to defaults', () => {
  const cur = defaults()

  expect(diffCfg(cur, { dys: true, scale: 1, scheme: 'dark' }).join('|')).toBe('  scheme: "system" -> "dark"|  dys: false -> true')
  expect(diffCfg(cur, {})).toEqual([])
  expect(cleanCfg({ scheme: 42, auto: 'maybe', day: 'yes', scale: 99, roles: { danger: 'nope' }, junk: 1 })).toEqual(defaults())
  expect(cleanCfg('garbage')).toEqual(defaults())
  expect(cleanCfg({ scheme: 'dark', scale: 1.3 }).scale).toBe(1.3)
})

test('text spacing, type style and bounded maps', () => {
  const plain = spaceText('one two three four five six', { wordGap: 1, lineGap: 0, width: 80 })

  expect(plain).toEqual(['one two three four five six'])
  const wide = spaceText('one two three four five six', { wordGap: 2, lineGap: 1, width: 15 })

  expect(wide[0]).toBe('one  two  three')
  expect(wide[1]).toBe('')
  expect(wide.length).toBe(4)
  expect(wide[2]).toBe('four  five  six')
  expect(styleFor({ dys: false, scale: 1 })).toBeUndefined()
  expect(styleFor({ dys: false, scale: 1.3 })).toEqual({ Text: { fontSize: 20, lineHeight: 30 } })
  const dys = styleFor({ dys: true, scale: 1 })!

  expect(dys.Text.letterSpacing).toBe(0.6)
  expect(dys.Text.lineHeight).toBeGreaterThanOrEqual(dys.Text.fontSize)
  expect(styleFor({ dys: false, scale: 2 })!.Text.fontSize).toBe(28)
  let map: Record<string, string> = {}

  for (let i = 0; i < 80; i++) {
    map = bounded(map, `/p${i}`, 'x')
  }
  expect(Object.keys(map).length).toBe(50)
  expect(map['/p79']).toBe('x')
  expect(map['/p0']).toBeUndefined()
})

// ---------------------------------------------------------------- the engine

type Box = {
  sets: Record<string, any>[]
  clears: number
  statuses: (string | undefined)[]
  registered: string[]
  store: Record<string, unknown>
  branch: string | null
  usage: { percent: number; usd: number; limits: { kind: string; percentUsed: number }[] }
  failStyle: boolean
  procs: string[][]
}

const at = (h: number, m = 0) => new Date(2026, 5, 1, h, m).getTime() // a Monday, local time

const wire = (on: any, init: Record<string, unknown> = {}, now = at(12)) => {
  const box: Box = {
    sets: [],
    clears: 0,
    statuses: [],
    registered: [],
    store: { ...init },
    branch: 'main',
    usage: { percent: 42, usd: 1.234, limits: [{ kind: 'five_hour', percentUsed: 31 }] },
    failStyle: false,
    procs: [],
  }
  const clock = mock.clock(on, { now })

  on('command.register', (_: unknown, e: { name: string }) => {
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    box.statuses.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: box.store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    box.store[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete box.store[e.key]

    return { value: undefined }
  })
  on('theme.set', (_: unknown, e: Record<string, any>) => {
    if (box.failStyle && e.style !== undefined) {
      throw new Error('style is not supported')
    }
    box.sets.push(e)

    return { value: { isDrawn: true, requestId: 'r' } }
  })
  on('theme.clear', () => {
    box.clears += 1

    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    box.procs.push(e.argv)

    if (box.branch === null) {
      throw new Error('cannot start')
    }

    return { value: { exitCode: 0, stdout: `${box.branch}\n`, stderr: '' } }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1000, percent: box.usage.percent },
      rateLimits: box.usage.limits,
      cost: { usd: box.usage.usd },
    },
  }))

  return { box, clock }
}

const start = ($: any, cwd = '/work/a') => $.session.start({ cwd, surface: 'desktop', isInteractive: true })
const cmd = async ($: any, command: string, args = ''): Promise<string> => (await $.command.run({ command, args })).text

test('by default nothing is applied, scheduled or written; only commands are registered', async ($, on) => {
  const { box } = wire(on)

  await start($)
  expect(box.sets).toEqual([])
  expect(box.clears).toBe(0)
  expect(box.statuses).toEqual([])
  expect(box.procs).toEqual([])
  expect(box.registered.every(n => n === 'sp' || n.startsWith('sp'))).toBe(true)
  expect(box.registered.length).toBe(21)
  expect(new Set(box.registered).size).toBe(21)
})

test('/sp lists every command in one line each', async ($, on) => {
  const { box } = wire(on)

  await start($)
  const help = await cmd($, 'sp')

  for (const name of box.registered.filter(n => n !== 'sp')) {
    expect(help).toContain(`/${name}`)
  }
})

test('/spskin applies a palette with exactly one theme.set; /spnight is a shortcut', async ($, on) => {
  const { box } = wire(on)

  await start($)
  expect(await cmd($, 'spskin', 'cyber')).toMatch(/Applied Cyber/)
  expect(box.sets.length).toBe(1)
  expect(box.sets[0]!.colors).toBeDefined()
  expect(box.sets[0]!.overrideColorScheme).toBeUndefined()
  expect(box.sets[0]!.style).toBeUndefined()
  expect(await cmd($, 'spnight')).toMatch(/Applied Cozy night/)
  expect(box.sets.length).toBe(2)
  expect(await cmd($, 'spskin', 'hivis')).toMatch(/Applied High visibility/)
  expect(await cmd($, 'spskin', 'print')).toMatch(/Applied Print/)
  expect(await cmd($, 'spskin', 'friday')).toMatch(/Applied Friday/)
  expect(await cmd($, 'spskin', 'bubblegum')).toMatch(/No look called/)
  expect(box.sets.length).toBe(5)
  expect(box.clears).toBe(0)
  expect(await cmd($, 'spskin', 'off')).toMatch(/\/look off/)
  expect(box.clears).toBe(0)
  expect(await cmd($, 'spskin', '')).toMatch(/Palettes:/)
})

test('/spscheme forces a mode only for palettes that have it', async ($, on) => {
  const { box } = wire(on)

  await start($)
  await cmd($, 'spscheme', 'light')
  expect(box.sets.length).toBe(0)
  await cmd($, 'spskin', 'hivis')
  expect(box.sets[0]!.overrideColorScheme).toBe('light')
  const out = await cmd($, 'spskin', 'cyber')

  expect(out).toMatch(/dark-only/)
  expect(box.sets[1]!.overrideColorScheme).toBeUndefined()
  await cmd($, 'spscheme', 'system')
  await cmd($, 'spskin', 'hivis')
  expect(box.sets[2]!.overrideColorScheme).toBeUndefined()
  expect(await cmd($, 'spscheme', 'purple')).toMatch(/Usage/)
})

test('project accent: stored per folder, applied at start only with /spauto', async ($, on) => {
  const { box } = wire(on)

  await start($, '/work/a')
  expect(await cmd($, 'spproject', 'teal')).toMatch(/#1a9a94 stored/)
  expect(await cmd($, 'spproject', 'chartreuse')).toMatch(/not a colour/)
  expect(box.store.projects).toEqual({ '/work/a': '#1a9a94' })
  expect(box.sets.length).toBe(0)

  await start($, '/work/a') // auto is off: still nothing
  expect(box.sets.length).toBe(0)
  await cmd($, 'spauto', 'on')
  await start($, '/work/a')
  expect(box.sets.length).toBe(1)
  await start($, '/work/b') // no accent here and the branch tint comes next
  expect(box.sets.length).toBe(2)
  await cmd($, 'spauto', 'project')
  await start($, '/work/b')
  expect(box.sets.length).toBe(2)
  await cmd($, 'spauto', 'off')
  await start($, '/work/a')
  expect(box.sets.length).toBe(2)
  expect(await cmd($, 'spproject', 'off')).toMatch(/removed/)
  expect(box.store.projects).toEqual({})
})

test('branch tint reads the branch read-only, applies only with auto on|branch, and copes with no git', async ($, on) => {
  const { box, clock } = wire(on)

  await start($)
  await cmd($, 'spauto', 'branch')
  await start($)
  expect(box.sets.length).toBe(1)
  expect(box.procs).toEqual([['git', 'rev-parse', '--abbrev-ref', 'HEAD']])
  expect(await cmd($, 'spskin', 'branch')).toMatch(/Branch main/)
  box.branch = null
  await clock.advance(61_000) // the branch is cached for a minute
  await start($)
  expect(box.sets.length).toBe(2) // no git: nothing new at start (the second set was the command)
  expect(await cmd($, 'spskin', 'branch')).toMatch(/No git branch/)
})

test('weekday palettes apply at start only with /spday on', async ($, on) => {
  const { box } = wire(on)

  await start($)
  expect(box.sets.length).toBe(0)
  await cmd($, 'spday', 'on')
  await start($)
  expect(box.sets.length).toBe(1)
  expect(box.store.cfg).toMatchObject({ day: true })
  await cmd($, 'spday', 'off')
  await start($)
  expect(box.sets.length).toBe(1)
})

test('scheduler: rules, start-up choice, 30 minute checks apply only on change, default clears', async ($, on) => {
  const { box, clock } = wire(on, {}, at(21, 50))

  await start($)
  expect(await cmd($, 'spsched', 'add 22:00 cozy')).toMatch(/Rule added/)
  expect(await cmd($, 'spsched', 'add 06:00 default')).toMatch(/Rule added/)
  expect(await cmd($, 'spsched', 'add 25:00 night')).toMatch(/not a time/)
  expect(box.sets.length).toBe(0)
  await cmd($, 'spsched', 'on')
  expect(box.sets.length).toBe(0) // turning it on waits for the next check

  await clock.advance(30 * 60_000) // 22:20: the 22:00 rule is in force
  expect(box.sets.length).toBe(1)
  await clock.advance(30 * 60_000)
  await clock.advance(30 * 60_000)
  expect(box.sets.length).toBe(1) // unchanged rule: nothing more, so a manual pick is not overwritten
  await clock.advance(8 * 3600_000) // past 06:00
  expect(box.clears).toBe(1)
  expect(box.sets.length).toBe(1)

  await cmd($, 'spsched', 'off')
  await clock.advance(24 * 3600_000)
  expect(box.sets.length).toBe(1)
  expect(await cmd($, 'spsched', 'del 06:00')).toMatch(/removed/)
  expect(await cmd($, 'spsched', 'list')).toMatch(/22:00 night/)
})

test('scheduler at session start applies the rule in force', async ($, on) => {
  const { box } = wire(
    on,
    { cfg: { sched: { on: true, rules: [{ at: '22:00', skin: 'night' }, { at: '06:00', skin: 'default' }] } } },
    at(23),
  )

  await start($)
  expect(box.sets.length).toBe(1)
  expect(box.clears).toBe(0)
})

test('sunrise accent: off by default, on re-checks every 30 minutes', async ($, on) => {
  const { box, clock } = wire(on, {}, at(7))

  await start($)
  await clock.advance(3 * 3600_000)
  expect(box.sets.length).toBe(0)
  await cmd($, 'spsun', 'on')
  await start($)
  expect(box.sets.length).toBe(1)
  await clock.advance(30 * 60_000)
  expect(box.sets.length).toBe(2)
  await cmd($, 'spsun', 'off')
  await clock.advance(3600_000)
  expect(box.sets.length).toBe(2)
})

test('status line: off by default, template validated, at most one write per 15 s', async ($, on) => {
  const { box, clock } = wire(on)

  await start($)
  expect(await cmd($, 'spstatus', '{bogus}')).toMatch(/Unknown placeholder/)
  expect(await cmd($, 'spstatus', '{branch} | {cost} | {context} | {rate}')).toMatch(/Template saved/)
  await clock.advance(60_000)
  expect(box.statuses.filter(s => s !== undefined)).toEqual([])
  box.statuses.length = 0

  await cmd($, 'spstatus', 'on')
  expect(box.statuses).toEqual(['main | $1.23 | 42% | 31%'])
  await cmd($, 'spstatus', 'on') // a second write inside 15 s is held back
  expect(box.statuses.length).toBe(1)
  await clock.advance(15_000)
  expect(box.statuses.length).toBe(2)
  await clock.advance(5_000)
  expect(box.statuses.length).toBe(2)
  await clock.advance(10_000)
  expect(box.statuses.length).toBe(3)

  await cmd($, 'spstatus', 'off')
  expect(box.statuses[box.statuses.length - 1]).toBeUndefined()
  const n = box.statuses.length

  await clock.advance(60_000)
  expect(box.statuses.length).toBe(n)
})

test('status line copes with no git and no cost', async ($, on) => {
  const { box, clock } = wire(on, { cfg: { status: { on: true, template: '{branch} {context}' } } })

  box.branch = null
  await start($)
  await clock.advance(15_000)
  expect(box.statuses.some(s => s === '- 42%')).toBe(true)
})

test('/sprole validates, stores and is used by the next palette', async ($, on) => {
  const { box } = wire(on)

  await start($)
  expect(await cmd($, 'sprole', 'danger red')).toMatch(/six-digit hex/)
  expect(await cmd($, 'sprole', 'sparkle #aa0000')).toMatch(/Roles are/)
  expect(await cmd($, 'sprole', 'danger #aa0000')).toMatch(/danger #aa0000/)
  expect((box.store.cfg as any).roles).toEqual({ danger: '#aa0000' })
  const out = await cmd($, 'spskin', 'hivis')

  expect(out).toMatch(/Applied/)
  expect(JSON.stringify(box.sets[0]!.colors)).not.toBe(JSON.stringify(build('x', FIXED.hivis!.def).theme))
  expect(await cmd($, 'sprole', 'danger off')).toMatch(/default/)
  expect(await cmd($, 'sprole', 'reset')).toMatch(/back/)
})

test('custom palette, export, strict import with a preview and confirm', async ($, on) => {
  const { box } = wire(on)

  await start($)
  expect(await cmd($, 'spexport')).toMatch(/No custom palette/)
  expect(await cmd($, 'spskin', 'custom')).toMatch(/No custom palette/)
  expect(await cmd($, 'spcustom', 'hue 400')).toMatch(/Not stored/)
  expect(await cmd($, 'spcustom', 'colour 4')).toMatch(/Usage/)
  expect(await cmd($, 'spcustom', 'hue 200 sat 20 mode dark accent teal')).toMatch(/stored/)
  const out = await cmd($, 'spexport')

  expect(out).toContain('"kind": "skins-plus-palette"')
  const json = out.slice(out.indexOf('{'))

  // Preview first: nothing changes, nothing is applied.
  await cmd($, 'spcustom', 'reset')
  const preview = await cmd($, 'spimport', json)

  expect(preview).toMatch(/Nothing changed yet/)
  expect((box.store.cfg as any).custom).toBeNull()
  expect(box.sets.length).toBe(0)
  expect(await cmd($, 'spimport', '')).toMatch(/\/spimport confirm/)
  expect(await cmd($, 'spimport', 'confirm')).toMatch(/Imported. Applied Custom palette/)
  expect(box.sets.length).toBe(1)
  expect((box.store.cfg as any).custom).toMatchObject({ hue: 200, sat: 20, mode: 'dark' })
  expect(await cmd($, 'spimport', 'confirm')).toMatch(/Nothing pending/)

  // A bad one is refused outright, and nothing is stored as pending.
  expect(await cmd($, 'spimport', json.replace('"hue": 200', '"hue": 999'))).toMatch(/Refused/)
  expect(box.store.pending).toBeUndefined()
  await cmd($, 'spimport', json)
  expect(await cmd($, 'spimport', 'cancel')).toMatch(/dropped/)
  expect(box.store.pending).toBeUndefined()
})

test('a pending import expires after ten minutes', async ($, on) => {
  const { box, clock } = wire(on)

  await start($)
  await cmd($, 'spimport', exportPalette({ hue: 10, sat: 10, mode: 'both' }))
  expect(box.store.pending).toBeDefined()
  await clock.advance(11 * 60_000)
  expect(await cmd($, 'spimport', 'confirm')).toMatch(/older than 10 minutes/)
  expect(box.sets.length).toBe(0)
})

test('share prints this mod\'s settings only (no folders), and a setup import shows a diff first', async ($, on) => {
  const { box } = wire(on)

  await start($, '/secret/place')
  await cmd($, 'spproject', 'blue')
  await cmd($, 'spuse', 'set cyber')
  await cmd($, 'spdys', 'on')
  const shared = await cmd($, 'spshare')

  expect(shared).not.toContain('/secret/place')
  expect(shared).not.toContain('#2f6fd0')
  expect(shared).toContain('"kind": "skins-plus-setup"')
  const json = shared.slice(shared.indexOf('{'))

  await cmd($, 'spdys', 'off')
  await cmd($, 'spscheme', 'dark')
  const preview = await cmd($, 'spimport', json)

  expect(preview).toMatch(/Setup import, 2 change/)
  expect(preview).toContain('dys: false -> true')
  expect(preview).toContain('scheme: "dark" -> "system"')
  expect((box.store.cfg as any).dys).toBe(false)
  expect(await cmd($, 'spimport', 'confirm')).toMatch(/Setup imported/)
  expect((box.store.cfg as any).dys).toBe(true)
  expect((box.store.cfg as any).scheme).toBe('system')
  expect(box.sets.length).toBe(0)
})

test('folder profile: set, apply, applied at start only with /spauto on', async ($, on) => {
  const { box } = wire(on)

  await start($, '/work/p')
  expect(await cmd($, 'spuse')).toMatch(/No profile/)
  expect(await cmd($, 'spuse', 'set nonsense')).toMatch(/Usage/)
  expect(await cmd($, 'spuse', 'set cyber')).toMatch(/Profile cyber stored/)
  expect(box.sets.length).toBe(0)
  expect(await cmd($, 'spuse')).toMatch(/Applied Cyber/)
  expect(box.sets.length).toBe(1)
  await start($, '/work/p')
  expect(box.sets.length).toBe(1)
  await cmd($, 'spauto', 'on')
  await start($, '/work/p')
  expect(box.sets.length).toBe(2)
  expect(await cmd($, 'spuse', 'off')).toMatch(/removed/)
})

test('dyslexia and type scale ride along in the same single theme.set; an old build falls back to colours', async ($, on) => {
  const { box } = wire(on)

  await start($)
  expect(await cmd($, 'sptype', '5')).toMatch(/Usage/)
  await cmd($, 'sptype', '1.3')
  await cmd($, 'spdys', 'on')
  const out = await cmd($, 'spskin', 'hivis')

  expect(out).toMatch(/Type style included/)
  expect(box.sets.length).toBe(1)
  expect(box.sets[0]!.style.Text).toMatchObject({ fontSize: 20, letterSpacing: 0.6 })
  expect(await cmd($, 'spskin', 'plain')).toMatch(/Applied Plain/)
  expect(box.sets[1]!.colors).toBeUndefined()

  box.failStyle = true
  const old = await cmd($, 'spskin', 'night')

  expect(old).toMatch(/does not take type styles/)
  expect(box.sets.length).toBe(3)
  expect(box.sets[2]!.style).toBeUndefined()
  expect(await cmd($, 'spskin', 'plain')).toMatch(/Not applied/)
})

test('plain with nothing to say applies nothing', async ($, on) => {
  const { box } = wire(on)

  await start($)
  expect(await cmd($, 'spskin', 'plain')).toMatch(/Nothing to apply/)
  expect(box.sets.length).toBe(0)
})

test('density prints the /cfg command and never writes the settings mod', async ($, on) => {
  const { box } = wire(on)

  await start($)
  expect(await cmd($, 'spdensity', 'compact')).toContain('/cfg density compact')
  expect(await cmd($, 'spdensity', 'airy')).toContain('/cfg density airy')
  expect(await cmd($, 'spdensity', 'huge')).toMatch(/Usage/)
  expect((box.store.cfg as any).density).toBe('airy')
})

test('/spreset forgets everything, stops timers and clears the status line, leaves the theme', async ($, on) => {
  const { box, clock } = wire(on, { projects: { '/x': '#aabbcc' }, profiles: { '/x': 'cyber' }, pending: { text: '{}', at: 1 } })

  await start($)
  await cmd($, 'spstatus', 'on')
  await cmd($, 'spsun', 'on')
  await cmd($, 'spproject', 'red')
  expect(await cmd($, 'spreset')).toMatch(/cleared/)
  expect(box.store).toEqual({})
  expect(box.statuses[box.statuses.length - 1]).toBeUndefined()
  const sets = box.sets.length
  const writes = box.statuses.length

  await clock.advance(3600_000)
  expect(box.sets.length).toBe(sets)
  expect(box.statuses.length).toBe(writes)
  expect(box.clears).toBe(0)
})

test('garbage in the store falls back to defaults', async ($, on) => {
  const { box } = wire(on, { cfg: 'garbage', projects: [1, 2], profiles: { '/a': 7 } })

  await start($)
  expect(box.sets).toEqual([])
  expect(await cmd($, 'spauto', '')).toMatch(/Auto: off/)
})

test('a failing git or theme never stops the session starting', async ($, on) => {
  const { box } = wire(on, { cfg: { auto: 'branch' } })

  box.branch = null
  await start($)
  expect(box.sets).toEqual([])
})

// ---------------------------------------------------------------- pane

const PANE = {
  plugin: 'skins-plus',
  component: 'Pane',
  requestId: 'skins-plus-main',
  props: { title: 'Skins plus', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the pane draws on every surface, a palette button applies once, dyslexia changes the preview', async ($, on) => {
  const { box } = wire(on)

  await start($)
  await cmd($, 'sppane')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /Skins plus/ }))?.text).toBe('Skins plus')
    expect(await ui.find({ type: 'Text', text: /Reading is easier/ })).toBeTruthy()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'skin-cyber' })
  expect(box.sets.length).toBe(1)
  await ui.press({ key: 'dys' })
  expect((box.store.cfg as any).dys).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Reading {2}is {2}easier/ })).toBeTruthy()
  await ui.press({ key: 'scale-1.5' })
  await ui.press({ key: 'density-airy' })
  expect((box.store.cfg as any).scale).toBe(1.5)
  expect((box.store.cfg as any).density).toBe('airy')
  await ui.unmount()
})
