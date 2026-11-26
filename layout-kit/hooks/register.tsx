import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register } from 'claude-code'

import type { Cfg, Page, Pending, Rec, Ui } from '../types'

import { METRIC_NAMES, calc } from './formula'
import type { Metrics } from './formula'
import {
  BUILTIN,
  CAP,
  COLORS,
  RECIPES,
  SIZES,
  SPRITES,
  addButton,
  addPage,
  addTile,
  applyImport,
  bar,
  bindProject,
  budgetFor,
  buildMetrics,
  checkStatusTemplate,
  deleteLayout,
  delMap,
  dropTileEverywhere,
  earnedNow,
  emptyCfg,
  emptyPending,
  emptyRec,
  evalRules,
  exportLayout,
  expandTemplate,
  fmtMetric,
  fmtNum,
  fmtUsd,
  findPage,
  hasOwn,
  loadLayout,
  makeDef,
  moveTile,
  nextColor,
  parseBadge,
  parseGoal,
  parseImport,
  parseRule,
  parseSprite,
  putMap,
  recTodos,
  recTool,
  removePage,
  removeTile,
  renamePage,
  renderStatus,
  resizeTile,
  sanitizeCfg,
  saveLayout,
  setBudget,
  setThreshold,
  setToolStyle,
  splitArgs,
  tileView,
  toolRows,
} from './model'
import type { Edit, Icons, MapKind, TileView, Tone } from './model'
import { barsAlt, barsSvg, ringSvg } from './vec'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'layout-kit-main'
const STORE_CFG = 'lkcfg'

// ---------------------------------------------------------------- shared settings (read only, owned by the settings mod)

const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')

const flag = (o: Record<string, boolean>, id: string, dflt: boolean): boolean => o[id] ?? dflt

/** Whether one of this mod's own switches (features.json) is on. Absent means the switch's default. */
const isOn = async (d: Dollar, id: string, dflt: boolean): Promise<boolean> => flag(await read(d, featuresA), `layout-kit.${id}`, dflt)

// ---------------------------------------------------------------- state

const cfgA = atom({ plugin: 'layout-kit', key: 'cfg' } as const, emptyCfg(), { shape: 'cfg-1' })
const recA = atom({ plugin: 'layout-kit', key: 'rec' } as const, emptyRec(), { shape: 'rec-1' })
const uiA = atom({ plugin: 'layout-kit', key: 'ui' } as const, { tab: 'dashboard', page: 0, sub: '', pg: 0, note: '' }, { shape: 'ui-1' })
const pendingA = atom({ plugin: 'layout-kit', key: 'pending' } as const, emptyPending(), { shape: 'pending-1' })
const armedA = atom({ plugin: 'layout-kit', key: 'armed' } as const, {}, { shape: 'armed-1' })
const earnedA = atom({ plugin: 'layout-kit', key: 'earned' } as const, [], { shape: 'earned-1' })
const cwdA = atom({ plugin: 'layout-kit', key: 'cwd' } as const, '')
const lastStatusA = atom({ plugin: 'layout-kit', key: 'lastStatusAt' } as const, 0)
const lastToastA = atom({ plugin: 'layout-kit', key: 'lastToastAt' } as const, 0)

const TABS = [
  ['dashboard', 'Dashboard'],
  ['edit', 'Edit'],
  ['library', 'Library'],
  ['snippets', 'Snippets'],
  ['rules', 'Rules'],
] as const

const SNIP_SUBS = [
  ['snippets', 'Snippets'],
  ['aliases', 'Aliases'],
  ['templates', 'Templates'],
  ['vars', 'Variables'],
  ['chips', 'Chips'],
] as const

const RULE_SUBS = [
  ['rules', 'Rules'],
  ['recipes', 'Recipes'],
  ['badges', 'Badges'],
  ['goals', 'Goals'],
  ['tools', 'Tools'],
  ['limits', 'Limits'],
] as const

const TOAST_GAP_MS = 180_000
const STATUS_GAP_MS = 15_000
const LIST_PAGE = 6

const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['cu', 'Layout kit: list every command', ''],
  ['cushow', 'Open the dashboard pane: /cushow [dashboard|edit|library|snippets|rules]', 'open the pane, optionally on a tab'],
  ['cutile', 'Tiles: /cutile list | add <id> [S|M|L] | rm <id> | up <id> | down <id> | size <id> S|M|L', 'reorder, resize, add and remove tiles on the chosen page'],
  ['cucustom', 'Custom tiles: /cucustom text|number|formula <id> <label> | <value> ; set <id> <v> ; rm <id>', 'your own text, number and formula tiles'],
  ['cutab', 'Dashboard pages: /cutab list | add <name> | rm <n> | rename <n> <name> | use <n>', 'up to 6 named pages'],
  ['culayout', 'Saved layouts: /culayout list | save <name> | load <name> | rm <name> | project <name>|off', 'named layouts and one per project folder'],
  ['cuexport', 'Print the current layout as text to share', 'layout as one line of JSON'],
  ['cuimport', 'Import a layout: /cuimport <json> shows the changes, /cuimport confirm applies them', 'strict check, diff, then confirm'],
  ['cusnip', 'Text snippets: /cusnip list | add <name> <text> | rm <name> | <name> (puts it in the prompt box)', 'short named texts'],
  ['cualias', 'Command aliases: /cualias list | add <alias> <text> | rm <alias>', 'stored command text, run with /curun'],
  ['curun', 'Put an alias in the prompt box: /curun <alias>', 'fill the prompt from an alias'],
  ['cutpl', 'Templates: /cutpl list | add <name> <text with {1} {2} {name}> | rm <name> | <name> <args>', 'expand a template into the prompt box'],
  ['cuvar', 'Template variables: /cuvar name=value | list | rm <name>', 'values for {name} placeholders'],
  ['cubtn', 'Custom buttons (max 5): /cubtn list | add <label> | <text> | rm <n> | use <n>', 'buttons that fill the prompt'],
  ['custatus', 'Status template: /custatus <text with {calls} {errors} {spend} {ctx}> | off | show', 'custom status line (needs its switch)'],
  ['cusprite', 'Sprite: /cusprite <line|line|line|line|line> | preset cat|robot|ghost | clear', 'a 5-line sprite for the pane'],
  ['cubadge', 'Badges: /cubadge "100 calls" when calls >= 100 | list | rm <name>', 'achievements over your own counters'],
  ['cugoal', 'Goals: /cugoal "ship it" files target 10 | list | rm <name>', 'goals with targets'],
  ['curule', 'Alert rules: /curule add if errors > 5 then toast "..." | list | rm|on|off <n>', 'toast rules at turn end (needs its switch)'],
  ['curecipe', 'Ready-made rules: /curecipe list | on <id> | off <id>', 'six toggleable rules (needs its switch)'],
  ['cutool', 'Tool style (this pane only): /cutool color|glyph|name <tool> <value> | clear <tool> | list', 'colour, glyph and friendly name per tool'],
  ['cuwarn', 'Warning levels: /cuwarn <ctx|limit|errors|spend> <warn> <bad> | list | reset', 'numbers behind the tile colours'],
  ['cubudget', 'Budget for this project folder: /cubudget <usd> | off', 'used by the spend and budget tiles'],
  ['cureset', 'Clear what was recorded: /cureset | /cureset all confirm (also your settings)', 'wipe recorded data'],
]

const HELP = [
  'Layout kit: a dashboard of tiles in one pane (layout-kit-main). Everything here changes ONLY that pane: no other mod, row or colour in the app.',
  ...COMMANDS.map(([name, text]) => `/${name}  ${name === 'cu' ? 'this list' : text.replace(/^[^:]*: /, '')}`),
  'Not possible: dragging tiles (a mod gets no pointer events: use Up/Down), registering new slash commands at run time (use /curun and /cutpl), restyling other mods.',
].join('\n')

// ---------------------------------------------------------------- helpers that take `$`

const loadCfg = async (d: Dollar) => {
  const saved = await d.store.get(STORE_CFG).catch(() => undefined)
  await update(d, cfgA, () => sanitizeCfg(saved))
}

/** Applies an edit to the config and keeps it. Returns the refusal, or undefined when it worked. */
const applyCfg = async (d: Dollar, fn: (c: Cfg) => Edit<Cfg>): Promise<string | undefined> => {
  const cur = await read(d, cfgA)
  const r = fn(cur)

  if (!r.ok) {
    return r.error
  }
  await update(d, cfgA, () => r.value)
  await d.store.set(STORE_CFG, r.value)

  return undefined
}

const setNote = async (d: Dollar, text: string) => update(d, uiA, u => ({ ...u, note: text.slice(0, 200) }))

const press = async (d: Dollar, fn: (c: Cfg) => Edit<Cfg>, ok = '') => {
  const err = await applyCfg(d, fn)
  await setNote(d, err ?? ok)
}

const pressPage = async (d: Dollar, fn: (pages: Page[], pi: number, c: Cfg) => Edit<Page[]>) => {
  const ui = await read(d, uiA)
  await press(d, c => {
    const pi = Math.max(0, Math.min(ui.page, c.pages.length - 1))
    const r = fn(c.pages, pi, c)

    return r.ok ? { ok: true, value: { ...c, pages: r.value } } : r
  })
}

const readUsage = async (d: Dollar) => {
  try {
    const u = await d.session.usage()
    const limits = u.rateLimits.map(r => r.percentUsed).filter(n => Number.isFinite(n))

    return { usd: u.cost?.usd ?? 0, ctx: u.context.percent ?? 0, limit: limits.length === 0 ? 0 : Math.max(...limits), startedAt: u.startedAt }
  } catch {
    return { usd: 0, ctx: 0, limit: 0, startedAt: 0 }
  }
}

/** Everything a tile, rule or status line reads: config, counters, live usage and the metrics made of them. */
const live = async (d: Dollar): Promise<{ cfg: Cfg; rec: Rec; m: Metrics; now: number; cwd: string }> => {
  const cfg = await read(d, cfgA)
  const rec0 = await read(d, recA)
  const now = await d.clock.now()
  const u = await readUsage(d)
  const cwd = await read(d, cwdA)
  const rec = rec0.startedAt > 0 ? rec0 : { ...rec0, startedAt: u.startedAt }

  return { cfg, rec, now, cwd, m: buildMetrics(rec, { usd: u.usd, ctx: u.ctx, limit: u.limit, now }, budgetFor(cfg, cwd)) }
}

const fillPrompt = async (d: Dollar, text: string): Promise<boolean> => {
  try {
    const r = await d.prompt.fill({ text, mode: 'replace' })

    return r.isFilled
  } catch {
    return false
  }
}

const openPane = async (d: Dollar, tab?: string) => {
  if (tab !== undefined) {
    await update(d, uiA, u => ({ ...u, tab, pg: 0, sub: '' }))
  }
  await d.ui.open({ id: PANE, title: 'Layout kit' })
}

/** Puts `text` in the prompt box and says so; when the box cannot be reached the text is returned instead. */
const fillAndSay = async (d: Dollar, text: string, note: string): Promise<string> => ((await fillPrompt(d, text)) ? `${note} It is in the prompt box; press Enter to send it, or edit it first.` : `${note} Could not reach the prompt box. The text was:\n${text}`)

const clearStatus = async (d: Dollar) => {
  try {
    await d.ui.status(undefined)
  } catch {
    // no status line here
  }
}

const maybeToast = async (d: Dollar, text: string): Promise<boolean> => {
  const now = await d.clock.now()

  if (now - (await read(d, lastToastA)) < TOAST_GAP_MS && (await read(d, lastToastA)) > 0) {
    return false
  }
  await update(d, lastToastA, () => now)
  await d.ui.toast(text, { timeoutMs: 6000 })

  return true
}

// ---------------------------------------------------------------- command bodies

const tileList = (c: Cfg, pi: number): string => {
  const page = c.pages[pi]

  return [
    `Built-in tiles: ${BUILTIN.map(t => t.id).join(' ')}`,
    `Custom tiles: ${c.defs.length === 0 ? 'none (/cucustom adds one)' : c.defs.map(x => `c:${x.id}`).join(' ')}`,
    `Page ${pi + 1} "${page?.name ?? '?'}": ${page === undefined || page.tiles.length === 0 ? '(empty)' : page.tiles.map(t => `${t.id}/${t.size}`).join(' ')}`,
  ].join('\n')
}

const cmdTile = async (d: Dollar, args: string): Promise<string> => {
  const [verb = 'list', id = '', arg = ''] = splitArgs(args.toLowerCase())
  const ui = await read(d, uiA)
  const c = await read(d, cfgA)
  const pi = Math.max(0, Math.min(ui.page, c.pages.length - 1))

  if (verb === 'list' || verb === '') {
    return tileList(c, pi)
  }
  const size = (s: string) => (SIZES as readonly string[]).includes(s.toUpperCase()) ? (s.toUpperCase() as 'S' | 'M' | 'L') : undefined
  let fn: ((pages: Page[], cc: Cfg) => Edit<Page[]>) | undefined

  if (verb === 'add') {
    const s = arg === '' ? undefined : size(arg)

    if (arg !== '' && s === undefined) {
      return 'The size is S, M or L.'
    }
    fn = (pages, cc) => addTile(pages, pi, id, cc.defs, s)
  } else if (verb === 'rm' || verb === 'remove') {
    fn = pages => removeTile(pages, pi, id)
  } else if (verb === 'up' || verb === 'down') {
    fn = pages => moveTile(pages, pi, id, verb === 'up' ? -1 : 1)
  } else if (verb === 'size') {
    const s = size(arg)

    if (s === undefined) {
      return 'Usage: /cutile size <id> S|M|L'
    }
    fn = pages => resizeTile(pages, pi, id, s)
  }

  if (fn === undefined) {
    return 'Usage: /cutile list | add <id> [S|M|L] | rm <id> | up <id> | down <id> | size <id> S|M|L (acts on the page chosen in the pane; /cutab use <n> changes it)'
  }
  const run = fn
  const err = await applyCfg(d, cc => {
    const r = run(cc.pages, cc)

    return r.ok ? { ok: true, value: { ...cc, pages: r.value } } : r
  })

  return err ?? `Done.\n${tileList(await read(d, cfgA), pi)}`
}

const cmdCustom = async (d: Dollar, args: string): Promise<string> => {
  const trimmed = args.trim()
  const verb = (/^\S+/.exec(trimmed)?.[0] ?? 'list').toLowerCase()
  const rest = trimmed.slice(verb.length).trim()
  const c = await read(d, cfgA)

  if (verb === 'list' || trimmed === '') {
    return c.defs.length === 0 ? 'No custom tiles. /cucustom text|number|formula <id> <label> | <value>' : c.defs.map(x => `c:${x.id}  ${x.kind}  ${x.label}  ${x.kind === 'text' ? x.text : x.kind === 'number' ? `${x.num} ${x.unit}`.trim() : x.expr}`).join('\n')
  }

  if (verb === 'rm') {
    const id = rest.toLowerCase()

    if (!c.defs.some(x => x.id === id)) {
      return `No custom tile ${id}.`
    }
    const err = await applyCfg(d, cc => ({
      ok: true,
      value: { ...cc, defs: cc.defs.filter(x => x.id !== id), pages: dropTileEverywhere(cc.pages, `c:${id}`) },
    }))

    return err ?? `Removed c:${id} and its place on every page.`
  }

  if (verb === 'set') {
    const [id = '', ...more] = rest.split(/\s+/)
    const def = c.defs.find(x => x.id === id.toLowerCase())

    if (def === undefined || def.kind === 'formula') {
      return def === undefined ? `No custom tile ${id}.` : 'A formula tile has a formula: replace it with /cucustom formula <id> <label> | <expr>.'
    }
    const r = makeDef(def.kind, def.id, def.label, def.kind === 'number' ? (more[0] ?? '') : more.join(' '), def.unit)

    if (!r.ok) {
      return r.error
    }
    const next = r.def
    const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, defs: cc.defs.map(x => (x.id === next.id ? next : x)) } }))

    return err ?? `c:${def.id} is now ${def.kind === 'number' ? next.num : next.text}.`
  }

  if (verb === 'text' || verb === 'number' || verb === 'formula') {
    const bar = rest.indexOf('|')

    if (bar < 0) {
      return `Usage: /cucustom ${verb} <id> <label> | <${verb === 'text' ? 'text' : verb === 'number' ? 'number> [unit' : 'formula'}>`
    }
    const left = rest.slice(0, bar).trim()
    const right = rest.slice(bar + 1).trim()
    const id = (/^\S+/.exec(left)?.[0] ?? '').toLowerCase()
    const label = left.slice(id.length).trim()
    const [numText = '', ...unit] = right.split(/\s+/)
    const r = verb === 'number' ? makeDef('number', id, label, numText, unit.join(' ')) : makeDef(verb, id, label, right)

    if (!r.ok) {
      return r.error
    }
    const def = r.def

    if (!c.defs.some(x => x.id === def.id) && c.defs.length >= CAP.defs) {
      return `${CAP.defs} custom tiles at most. /cucustom rm <id> frees one.`
    }
    const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, defs: cc.defs.some(x => x.id === def.id) ? cc.defs.map(x => (x.id === def.id ? def : x)) : [...cc.defs, def] } }))

    return err ?? `Saved c:${def.id}. Add it to a page with /cutile add c:${def.id} (or Library in the pane).`
  }

  return 'Usage: /cucustom list | text|number|formula <id> <label> | <value> | set <id> <value> | rm <id>'
}

const cmdTab = async (d: Dollar, args: string): Promise<string> => {
  const trimmed = args.trim()
  const verb = (/^\S+/.exec(trimmed)?.[0] ?? 'list').toLowerCase()
  const rest = trimmed.slice(verb.length).trim()
  const c = await read(d, cfgA)
  const ui = await read(d, uiA)
  const listing = (cc: Cfg) => cc.pages.map((p, i) => `${i === Math.min(ui.page, cc.pages.length - 1) ? '*' : ' '} ${i + 1}. ${p.name} (${p.tiles.length} tiles)`).join('\n')

  if (verb === 'list' || trimmed === '') {
    return listing(c)
  }

  if (verb === 'add') {
    const err = await applyCfg(d, cc => {
      const r = addPage(cc.pages, rest)

      return r.ok ? { ok: true, value: { ...cc, pages: r.value } } : r
    })

    return err ?? `Page added.\n${listing(await read(d, cfgA))}`
  }
  const sel = (/^\S+/.exec(rest)?.[0] ?? '').toLowerCase()
  const pi = findPage(c.pages, sel)

  if (verb === 'use') {
    const j = findPage(c.pages, rest)

    if (j < 0) {
      return `No page "${rest}". /cutab list shows them.`
    }
    await update(d, uiA, u => ({ ...u, page: j }))

    return `Using page ${j + 1} "${c.pages[j]?.name ?? ''}" for /cutile.`
  }

  if (verb === 'rm') {
    const j = findPage(c.pages, rest)

    if (j < 0) {
      return `No page "${rest}".`
    }
    const err = await applyCfg(d, cc => {
      const r = removePage(cc.pages, j)

      return r.ok ? { ok: true, value: { ...cc, pages: r.value } } : r
    })
    await update(d, uiA, u => ({ ...u, page: 0 }))

    return err ?? `Page removed.\n${listing(await read(d, cfgA))}`
  }

  if (verb === 'rename') {
    if (pi < 0) {
      return `No page "${sel}". Usage: /cutab rename <n|name> <new name>`
    }
    const name = rest.slice(sel.length).trim()
    const err = await applyCfg(d, cc => {
      const r = renamePage(cc.pages, pi, name)

      return r.ok ? { ok: true, value: { ...cc, pages: r.value } } : r
    })

    return err ?? `Renamed.\n${listing(await read(d, cfgA))}`
  }

  return 'Usage: /cutab list | add <name> | rm <n|name> | rename <n|name> <new name> | use <n|name>'
}

const cmdLayout = async (d: Dollar, args: string): Promise<string> => {
  const [verb = 'list', name = '', second = ''] = splitArgs(args.toLowerCase())
  const c = await read(d, cfgA)
  const cwd = await read(d, cwdA)

  if (verb === 'list' || verb === '') {
    const names = Object.keys(c.saved)
    const bound = hasOwn(c.byProject, cwd) ? c.byProject[cwd] : undefined

    return `Saved layouts (${names.length}/${CAP.saved}): ${names.length === 0 ? 'none' : names.join(' ')}\nThis project folder uses: ${bound ?? 'no saved layout'}${bound === undefined ? '' : ' (applied when a session starts, if the per-project switch is on)'}`
  }

  if (second !== '' && verb !== 'list') {
    return 'A layout name is one word: 1 to 16 lowercase letters, digits, _ or -.'
  }

  if (verb === 'save' || verb === 'load' || verb === 'rm') {
    const err = await applyCfg(d, cc => (verb === 'save' ? saveLayout(cc, name) : verb === 'load' ? loadLayout(cc, name) : deleteLayout(cc, name)))

    if (err === undefined) {
      await update(d, uiA, u => ({ ...u, page: 0 }))
    }

    return err ?? (verb === 'save' ? `Saved the current layout as ${name}.` : verb === 'load' ? `Loaded ${name}. It is now the current layout.` : `Deleted ${name}.`)
  }

  if (verb === 'project') {
    if (name === '') {
      return hasOwn(c.byProject, cwd) ? `This project folder uses layout ${c.byProject[cwd]}.` : 'This project folder has no layout bound. /culayout project <saved name>'
    }
    const err = await applyCfg(d, cc => bindProject(cc, cwd, name === 'off' ? undefined : name))

    return err ?? (name === 'off' ? 'This project folder no longer has a layout of its own.' : `Sessions started in this folder now open layout ${name} (switch layout-kit.per-project must be on, as it is by default).`)
  }
  return 'Usage: /culayout list | save <name> | load <name> | rm <name> | project <name>|off'
}

const cmdImport = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()

  if (t === 'cancel') {
    await update(d, pendingA, () => emptyPending())

    return 'Import cancelled.'
  }

  if (t === 'confirm') {
    const p = await read(d, pendingA)

    if (!p.has) {
      return 'Nothing is waiting. /cuimport <json> first.'
    }
    const err = await applyCfg(d, cc => ({ ok: true, value: applyImport(cc, p.pages, p.defs) }))
    await update(d, pendingA, () => emptyPending())
    await update(d, uiA, u => ({ ...u, page: 0 }))

    return err ?? 'Imported. The layout is now the current layout (/culayout save <name> keeps it).'
  }
  const c = await read(d, cfgA)
  const r = parseImport(t, c)

  if (!r.ok) {
    return `Import refused: ${r.error}`
  }
  const pending: Pending = { has: true, pages: r.pages, defs: r.defs, diff: r.diff }
  await update(d, pendingA, () => pending)

  return `Valid layout. Nothing has changed yet. Applying it would:\n${r.diff}\n\n/cuimport confirm applies it, /cuimport cancel drops it.`
}

const cmdMap = async (d: Dollar, kind: MapKind, args: string, label: string): Promise<string> => {
  const t = args.trim()
  const verb = (/^\S+/.exec(t)?.[0] ?? 'list').toLowerCase()
  const rest = t.slice(verb.length).trim()
  const c = await read(d, cfgA)

  if (verb === 'list' || t === '') {
    const names = Object.keys(c[kind])

    return names.length === 0 ? `No ${label}s yet. /cu${kind === 'snippets' ? 'snip' : kind === 'aliases' ? 'alias' : kind === 'templates' ? 'tpl' : 'var'} add <name> <text>` : names.map(n => `${n}: ${(c[kind][n] ?? '').replace(/\s+/g, ' ').slice(0, 70)}`).join('\n')
  }

  if (verb === 'add') {
    const name = (/^\S+/.exec(rest)?.[0] ?? '').toLowerCase()
    const err = await applyCfg(d, cc => putMap(cc, kind, name, rest.slice(name.length).trim()))

    return err ?? `Saved ${label} ${name}.`
  }

  if (verb === 'rm') {
    const err = await applyCfg(d, cc => delMap(cc, kind, rest.toLowerCase()))

    return err ?? `Deleted ${rest.toLowerCase()}.`
  }

  return ''
}

const cmdSnip = async (d: Dollar, args: string): Promise<string> => {
  const out = await cmdMap(d, 'snippets', args, 'snippet')

  if (out !== '') {
    return out
  }
  const name = args.trim().toLowerCase().replace(/^use\s+/, '')
  const c = await read(d, cfgA)
  const text = hasOwn(c.snippets, name) ? c.snippets[name] : undefined

  return text === undefined ? `No snippet "${name.slice(0, 20)}". /cusnip list` : fillAndSay(d, text, `Snippet ${name}.`)
}

const cmdAlias = async (d: Dollar, args: string): Promise<string> => {
  const out = await cmdMap(d, 'aliases', args, 'alias')

  return out === '' ? 'Usage: /cualias list | add <alias> <command text> | rm <alias>. Run one with /curun <alias>. (A mod cannot register new slash commands while the session runs, so an alias is filled into the prompt box instead.)' : out
}

const cmdRun = async (d: Dollar, args: string): Promise<string> => {
  const name = args.trim().toLowerCase()
  const c = await read(d, cfgA)

  if (name === '') {
    return `Aliases: ${Object.keys(c.aliases).join(' ') || 'none'}. /curun <alias>`
  }
  const text = hasOwn(c.aliases, name) ? c.aliases[name] : undefined

  return text === undefined ? `No alias "${name.slice(0, 20)}". /cualias list` : fillAndSay(d, text, `Alias ${name}.`)
}

const cmdTpl = async (d: Dollar, args: string): Promise<string> => {
  const out = await cmdMap(d, 'templates', args, 'template')

  if (out !== '') {
    return out
  }
  const argv = splitArgs(args.trim())
  const name = (argv[0] ?? '').toLowerCase()
  const c = await read(d, cfgA)
  const tpl = hasOwn(c.templates, name) ? c.templates[name] : undefined

  if (tpl === undefined) {
    return `No template "${name.slice(0, 20)}". /cutpl list`
  }
  const r = expandTemplate(tpl, argv.slice(1), c.vars)
  const note = r.missing.length === 0 ? '' : ` Not filled: ${r.missing.join(' ')} (positional ones come from the arguments, named ones from /cuvar name=value).`

  return fillAndSay(d, r.text, `Template ${name}.${note}`)
}

const cmdVar = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()
  const c = await read(d, cfgA)

  if (t === '' || t === 'list') {
    const names = Object.keys(c.vars)

    return names.length === 0 ? 'No variables. /cuvar name=value, then use {name} in a template.' : names.map(n => `${n}=${c.vars[n] ?? ''}`).join('\n')
  }

  if (/^rm\s+/i.test(t)) {
    const err = await applyCfg(d, cc => delMap(cc, 'vars', t.replace(/^rm\s+/i, '').trim().toLowerCase()))

    return err ?? 'Deleted.'
  }
  const m = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(t)

  if (m === null) {
    return 'Usage: /cuvar name=value | list | rm <name>'
  }
  const name = (m[1] ?? '').toLowerCase()
  const err = await applyCfg(d, cc => putMap(cc, 'vars', name, m[2] ?? ''))

  return err ?? `{${name}} is now set. Templates that contain {${name}} use it.`
}

const cmdBtn = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()
  const verb = (/^\S+/.exec(t)?.[0] ?? 'list').toLowerCase()
  const rest = t.slice(verb.length).trim()
  const c = await read(d, cfgA)
  const on = await isOn(d, 'buttons-band', false)
  const note = on ? '' : '\nThe band above the prompt is OFF (/cfg feature layout-kit.buttons-band on); the buttons still show in the pane (Snippets > Chips).'

  if (verb === 'list' || t === '') {
    return (c.buttons.length === 0 ? 'No buttons. /cubtn add <label> | <text>' : c.buttons.map((b, i) => `${i + 1}. ${b.label}: ${b.text.replace(/\s+/g, ' ').slice(0, 60)}`).join('\n')) + note
  }

  if (verb === 'add') {
    const bar2 = rest.indexOf('|')
    const err = bar2 < 0 ? 'Usage: /cubtn add <label> | <text for the prompt box>' : await applyCfg(d, cc => addButton(cc, rest.slice(0, bar2), rest.slice(bar2 + 1)))

    return (err ?? 'Button added.') + note
  }
  const n = Number(rest)
  const b = c.buttons[n - 1] ?? c.buttons.find(x => x.label.toLowerCase() === rest.toLowerCase())

  if (b === undefined) {
    return 'Usage: /cubtn list | add <label> | <text> | rm <n> | use <n>'
  }

  if (verb === 'rm') {
    const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, buttons: cc.buttons.filter(x => x !== cc.buttons.find(y => y.label === b.label)) } }))

    return err ?? `Removed ${b.label}.`
  }

  if (verb === 'use') {
    return fillAndSay(d, b.text, `Button ${b.label}.`)
  }

  return 'Usage: /cubtn list | add <label> | <text> | rm <n> | use <n>'
}

const cmdStatus = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()
  const c = await read(d, cfgA)
  const on = await isOn(d, 'status-template', false)
  const note = on ? '' : '\nThe status line is NOT written: the switch is off (/cfg feature layout-kit.status-template on, and layout-kit.status must be on too).'

  if (t === '' || t === 'show') {
    const l = await live(d)

    return c.statusTpl === '' ? `No status template. /custatus {calls} calls {errors} err {spend} {ctx}${note}` : `Template: ${c.statusTpl}\nPreview: ${renderStatus(c.statusTpl, l.m)}${note}`
  }

  if (t === 'off') {
    const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, statusTpl: '' } }))
    await clearStatus(d)

    return err ?? 'Template cleared and the status text removed.'
  }
  const r = checkStatusTemplate(t)

  if (!r.ok) {
    return r.error
  }
  const tpl = r.value
  const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, statusTpl: tpl } }))

  return err ?? `Template saved. Preview: ${renderStatus(tpl, (await live(d)).m)}\nIt is written at most every 15 s, when a turn ends.${note}`
}

const cmdSprite = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()
  const c = await read(d, cfgA)

  if (t === '' || t === 'show') {
    return c.sprite.length === 0 ? `No sprite. /cusprite <line|line|...> (up to ${CAP.spriteLines} lines of ${CAP.spriteWidth} characters) or /cusprite preset cat|robot|ghost` : c.sprite.join('\n')
  }

  if (t === 'clear') {
    const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, sprite: [] } }))

    return err ?? 'Sprite cleared.'
  }
  const preset = /^preset\s+(\S+)$/i.exec(t)?.[1]?.toLowerCase()
  const lines = preset === undefined ? parseSprite(t) : hasOwn(SPRITES, preset) ? ({ ok: true, value: SPRITES[preset] ?? [] } as const) : ({ ok: false, error: `Presets: ${Object.keys(SPRITES).join(', ')}.` } as const)

  if (!lines.ok) {
    return lines.error
  }
  const v = lines.value
  const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, sprite: v } }))

  return err ?? `Sprite saved:\n${v.join('\n')}\n(Add the Sprite tile to a page to see it; it does not move or react.)`
}

const cmdBadge = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()
  const c = await read(d, cfgA)
  const earned = await read(d, earnedA)

  if (t === '' || t === 'list') {
    return c.badges.length === 0 ? 'No badges. /cubadge "100 calls" when calls >= 100' : c.badges.map(b => `${earned.includes(b.name) ? '[x]' : '[ ]'} ${b.name}  when ${b.cond}`).join('\n')
  }

  if (/^rm\s+/i.test(t)) {
    const name = t.replace(/^rm\s+/i, '').replace(/^"|"$/g, '').trim()
    const err = c.badges.some(b => b.name === name) ? await applyCfg(d, cc => ({ ok: true, value: { ...cc, badges: cc.badges.filter(b => b.name !== name) } })) : `No badge "${name.slice(0, 24)}".`

    return err ?? `Removed ${name}.`
  }
  const r = parseBadge(t.replace(/^add\s+/i, ''))

  if (!r.ok) {
    return r.error
  }
  const b = r.value

  if (c.badges.some(x => x.name === b.name)) {
    return `A badge called ${b.name} exists.`
  }

  if (c.badges.length >= CAP.badges) {
    return `${CAP.badges} badges at most.`
  }
  const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, badges: [...cc.badges, b] } }))

  return err ?? `Badge ${b.name} added: earned when ${b.cond}.`
}

const cmdGoal = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()
  const c = await read(d, cfgA)

  if (t === '' || t === 'list') {
    if (c.goals.length === 0) {
      return 'No goals. /cugoal "ship it" files target 10'
    }
    const l = await live(d)

    return c.goals.map(g => `${g.name}: ${fmtNum(calc(g.expr, l.m) ?? 0)} of ${fmtNum(g.target)}  (${g.expr})`).join('\n')
  }

  if (/^rm\s+/i.test(t)) {
    const name = t.replace(/^rm\s+/i, '').replace(/^"|"$/g, '').trim()
    const err = c.goals.some(g => g.name === name) ? await applyCfg(d, cc => ({ ok: true, value: { ...cc, goals: cc.goals.filter(g => g.name !== name) } })) : `No goal "${name.slice(0, 24)}".`

    return err ?? `Removed ${name}.`
  }
  const r = parseGoal(t.replace(/^add\s+/i, ''))

  if (!r.ok) {
    return r.error
  }
  const g = r.value

  if (c.goals.some(x => x.name === g.name)) {
    return `A goal called ${g.name} exists.`
  }

  if (c.goals.length >= CAP.goals) {
    return `${CAP.goals} goals at most.`
  }
  const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, goals: [...cc.goals, g] } }))

  return err ?? `Goal ${g.name} added: ${g.expr} toward ${fmtNum(g.target)}.`
}

const switchNote = async (d: Dollar, id: string, what: string): Promise<string> => ((await isOn(d, id, false)) ? '' : `\nNote: ${what} is OFF, so nothing fires yet. Turn it on with /cfg feature layout-kit.${id} on (and layout-kit.toasts must be on).`)

const cmdRule = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()
  const c = await read(d, cfgA)
  const note = await switchNote(d, 'rules', 'rule evaluation')

  if (t === '' || t === 'list') {
    return (c.rules.length === 0 ? 'No rules. /curule add if errors > 5 then toast "Too many errors"' : c.rules.map((r, i) => `${i + 1}. [${r.isOn ? 'on' : 'off'}] if ${r.cond} then toast "${r.msg}"`).join('\n')) + note
  }
  const m = /^(rm|on|off)\s+(\d+)$/i.exec(t)

  if (m !== null) {
    const i = Number(m[2]) - 1
    const verb = (m[1] ?? '').toLowerCase()

    if (c.rules[i] === undefined) {
      return `No rule ${m[2] ?? ''}. /curule list`
    }
    const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, rules: verb === 'rm' ? cc.rules.filter((_, j) => j !== i) : cc.rules.map((r, j) => (j === i ? { ...r, isOn: verb === 'on' } : r)) } }))

    return err ?? `Rule ${i + 1} ${verb === 'rm' ? 'removed' : verb}.`
  }
  const r = parseRule(t.replace(/^add\s+/i, ''))

  if (!r.ok) {
    return r.error
  }

  if (c.rules.length >= CAP.rules) {
    return `${CAP.rules} rules at most.`
  }
  const rule = r.value
  const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, rules: [...cc.rules, rule] } }))

  return (err ?? `Rule added: if ${rule.cond} then toast "${rule.msg}". It fires once when the condition turns true, at the end of a turn, at most one toast per 3 minutes.`) + note
}

const cmdRecipe = async (d: Dollar, args: string): Promise<string> => {
  const [verb = 'list', id = ''] = splitArgs(args.toLowerCase())
  const c = await read(d, cfgA)
  const note = await switchNote(d, 'recipes', 'recipe evaluation')

  if (verb === 'list' || verb === '') {
    return RECIPES.map(r => `[${c.recipes[r.id] === true ? 'on ' : 'off'}] ${r.id}: ${r.label}  (if ${r.cond})`).join('\n') + note
  }

  if ((verb === 'on' || verb === 'off') && RECIPES.some(r => r.id === id)) {
    const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, recipes: { ...cc.recipes, [id]: verb === 'on' } } }))

    return (err ?? `Recipe ${id} ${verb}.`) + note
  }

  return `Usage: /curecipe list | on <id> | off <id>. Ids: ${RECIPES.map(r => r.id).join(' ')}`
}

const cmdTool = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim()
  const [verb = 'list', tool = ''] = splitArgs(t)
  const c = await read(d, cfgA)

  if (verb === 'list' || t === '') {
    const tools = [...new Set([...Object.keys(c.toolColor), ...Object.keys(c.toolGlyph), ...Object.keys(c.toolName)])]

    return tools.length === 0 ? `No tool styles. /cutool color Bash warning | glyph Bash $ | name Bash Shell. Colours: ${COLORS.join(' ')}` : tools.map(n => `${n}: colour ${c.toolColor[n] ?? 'default'}, glyph ${c.toolGlyph[n] ?? 'default'}, name ${c.toolName[n] ?? 'default'}`).join('\n')
  }

  if (verb === 'clear') {
    const err = await applyCfg(d, cc => {
      let cur: Edit<Cfg> = { ok: true, value: cc }

      for (const k of ['color', 'glyph', 'name'] as const) {
        if (cur.ok) {
          cur = setToolStyle(cur.value, k, tool, undefined)
        }
      }

      return cur
    })

    return err ?? `Cleared the styles of ${tool}.`
  }

  if (verb === 'color' || verb === 'glyph' || verb === 'name') {
    const value = t.replace(/^\S+\s+\S+\s*/, '')
    const err = await applyCfg(d, cc => setToolStyle(cc, verb, tool, value))

    return err ?? `Saved. This changes the Tools tile and the Rules > Tools list only, not the tool rows in the chat.`
  }

  return 'Usage: /cutool list | color|glyph|name <tool> <value> | clear <tool>'
}

const cmdWarn = async (d: Dollar, args: string): Promise<string> => {
  const [metric = 'list', a = '', b = ''] = splitArgs(args.toLowerCase())
  const c = await read(d, cfgA)
  const show = (cc: Cfg) => (['ctx', 'limit', 'errors', 'spend'] as const).map(k => `${k}: warn at ${cc.thr[k][0]}, bad at ${cc.thr[k][1]}`).join('\n')

  if (metric === 'list' || metric === '') {
    return show(c)
  }

  if (metric === 'reset') {
    const err = await applyCfg(d, cc => ({ ok: true, value: { ...cc, thr: emptyCfg().thr } }))

    return err ?? `Levels reset.\n${show(emptyCfg())}`
  }
  const err = await applyCfg(d, cc => (a === '' || b === '' ? { ok: false, error: 'Usage: /cuwarn <ctx|limit|errors|spend> <warn> <bad>' } : setThreshold(cc, metric, Number(a), Number(b))))

  return err ?? `Saved.\n${show(await read(d, cfgA))}`
}

const cmdBudget = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim().toLowerCase()
  const cwd = await read(d, cwdA)
  const c = await read(d, cfgA)

  if (t === '') {
    const b = budgetFor(c, cwd)

    return b > 0 ? `This project folder has a budget of ${fmtUsd(b)}.` : 'No budget for this project folder. /cubudget <usd> sets one, /cubudget off clears it.'
  }
  const usd = t === 'off' ? undefined : Number(t.replace(/^\$/, ''))
  const err = await applyCfg(d, cc => setBudget(cc, cwd, usd))

  return err ?? (usd === undefined ? 'Budget cleared for this project folder.' : `Budget for this project folder: ${fmtUsd(usd)}. The Spend and Budget tiles use it.`)
}

const cmdReset = async (d: Dollar, args: string): Promise<string> => {
  const t = args.trim().toLowerCase()
  const now = await d.clock.now()
  await update(d, recA, () => emptyRec(now))
  await update(d, earnedA, () => [])
  await update(d, armedA, () => ({}))
  await update(d, pendingA, () => emptyPending())
  await update(d, lastToastA, () => 0)
  await update(d, lastStatusA, () => 0)

  if (t === 'all confirm') {
    await update(d, cfgA, () => emptyCfg())
    await d.store.set(STORE_CFG, emptyCfg())
    await update(d, uiA, () => ({ tab: 'dashboard', page: 0, sub: '', pg: 0, note: '' }))
    await clearStatus(d)

    return 'Cleared the counters, earned badges AND all of your settings (layouts, tiles, snippets, rules, ...).'
  }

  return t === 'all' ? 'Cleared the counters and earned badges. Your settings are kept; /cureset all confirm would erase them too.' : 'Cleared the counters and earned badges. Your settings are kept.'
}

// ---------------------------------------------------------------- recording and turn end

const onTurnEnd = async (d: Dollar) => {
  const l = await live(d)
  const cfg = l.cfg

  if (await isOn(d, 'badges', true)) {
    const now = earnedNow(cfg.badges, l.m)
    const before = await read(d, earnedA)
    const fresh = now.filter(n => !before.includes(n))

    if (fresh.length > 0) {
      await update(d, earnedA, list => [...new Set([...list, ...fresh])].slice(0, CAP.badges))

      if (await isOn(d, 'badge-toasts', false)) {
        await maybeToast(d, `Badge earned: ${fresh.slice(0, 3).join(', ')}`).catch(() => false)
      }
    }
  }
  const useRules = await isOn(d, 'rules', false)
  const useRecipes = await isOn(d, 'recipes', false)

  if (useRules || useRecipes) {
    const ev = evalRules(cfg.rules, cfg.recipes, l.m, await read(d, armedA), { rules: useRules, recipes: useRecipes })
    const first = ev.fired[0]
    let armed = ev.armed

    if (first !== undefined) {
      const text = ev.fired.length > 1 ? `${first.msg} (+${ev.fired.length - 1} more)` : first.msg
      const shown = await maybeToast(d, text).catch(() => false)

      if (!shown) {
        // Throttled: stay unarmed so the rule gets another chance after the quiet period.
        armed = { ...armed, ...Object.fromEntries(ev.fired.map(f => [f.key, false])) }
      }
    }
    await update(d, armedA, () => armed)
  }

  if (cfg.statusTpl !== '' && (await isOn(d, 'status-template', false))) {
    const last = await read(d, lastStatusA)

    if (last === 0 || l.now - last >= STATUS_GAP_MS) {
      await update(d, lastStatusA, () => l.now)
      await d.ui.status(renderStatus(cfg.statusTpl, l.m))
    }
  }
}

// ---------------------------------------------------------------- the mod

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await loadCfg($).catch(() => undefined)
    await update($, cwdA, () => e.cwd)
    const u = await readUsage($)
    const t = await $.clock.now()
    await update($, recA, r => (r.startedAt > 0 ? r : { ...r, startedAt: u.startedAt > 0 ? u.startedAt : t }))
    const c = await read($, cfgA)

    if (hasOwn(c.byProject, e.cwd) && (await isOn($, 'per-project', true))) {
      const r = loadLayout(c, c.byProject[e.cwd] ?? '')

      // Shown for this session only; it is kept like any other edit once the layout is changed.
      if (r.ok) {
        await update($, cfgA, () => r.value)
      }
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta !== true && e.text.trim() !== '' && (await isOn($, 'record', true))) {
      await update($, recA, r => ({ ...r, prompts: r.prompts + 1 }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    let isRecording = false

    try {
      isRecording = await isOn($, 'record', true)
    } catch {
      isRecording = false
    }

    if (!isRecording) {
      return next(e)
    }
    const input = e as unknown as Record<string, unknown>
    let ran: Awaited<ReturnType<typeof next>>

    try {
      ran = await next(e)
    } catch (err) {
      await update($, recA, r => recTool(r, e.tool, true)).catch(() => undefined)
      throw err
    }
    const isFailed = ran.deny !== undefined || ran.isError === true
    const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined
    await update($, recA, r => {
      const counted = recTool(r, e.tool, isFailed, path)

      return e.tool === 'TodoWrite' && !isFailed ? recTodos(counted, input.todos) : counted
    }).catch(() => undefined)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (await isOn($, 'record', true)) {
      await update($, recA, r => ({ ...r, turns: r.turns + 1 }))
    }
    await onTurnEnd($).catch(() => undefined)

    return next(e)
  })

  // ------------------------------------------------------------ commands

  on('command.run', { command: 'cu' }, async () => ({ text: HELP }))

  on('command.run', { command: 'cushow' }, async ($, e) => {
    const w = e.args.trim().toLowerCase()
    const tab = TABS.find(t => t[0] === w)

    if (w !== '' && tab === undefined) {
      return { text: `Tabs: ${TABS.map(t => t[0]).join(' ')}` }
    }
    await openPane($, tab?.[0])

    return { text: `Layout kit opened${tab === undefined ? '' : ` on ${tab[1]}`}.` }
  })

  on('command.run', { command: 'cutile' }, async ($, e) => ({ text: await cmdTile($, e.args) }))
  on('command.run', { command: 'cucustom' }, async ($, e) => ({ text: await cmdCustom($, e.args) }))
  on('command.run', { command: 'cutab' }, async ($, e) => ({ text: await cmdTab($, e.args) }))
  on('command.run', { command: 'culayout' }, async ($, e) => ({ text: await cmdLayout($, e.args) }))
  on('command.run', { command: 'cuexport' }, async $ => ({ text: `${exportLayout(await read($, cfgA))}\n\nPass this line to /cuimport on another machine or project. It holds the pages, tile sizes and the custom tiles those pages use; snippets, rules and other settings are not included.` }))
  on('command.run', { command: 'cuimport' }, async ($, e) => ({ text: await cmdImport($, e.args) }))
  on('command.run', { command: 'cusnip' }, async ($, e) => ({ text: await cmdSnip($, e.args) }))
  on('command.run', { command: 'cualias' }, async ($, e) => ({ text: await cmdAlias($, e.args) }))
  on('command.run', { command: 'curun' }, async ($, e) => ({ text: await cmdRun($, e.args) }))
  on('command.run', { command: 'cutpl' }, async ($, e) => ({ text: await cmdTpl($, e.args) }))
  on('command.run', { command: 'cuvar' }, async ($, e) => ({ text: await cmdVar($, e.args) }))
  on('command.run', { command: 'cubtn' }, async ($, e) => ({ text: await cmdBtn($, e.args) }))
  on('command.run', { command: 'custatus' }, async ($, e) => ({ text: await cmdStatus($, e.args) }))
  on('command.run', { command: 'cusprite' }, async ($, e) => ({ text: await cmdSprite($, e.args) }))
  on('command.run', { command: 'cubadge' }, async ($, e) => ({ text: await cmdBadge($, e.args) }))
  on('command.run', { command: 'cugoal' }, async ($, e) => ({ text: await cmdGoal($, e.args) }))
  on('command.run', { command: 'curule' }, async ($, e) => ({ text: await cmdRule($, e.args) }))
  on('command.run', { command: 'curecipe' }, async ($, e) => ({ text: await cmdRecipe($, e.args) }))
  on('command.run', { command: 'cutool' }, async ($, e) => ({ text: await cmdTool($, e.args) }))
  on('command.run', { command: 'cuwarn' }, async ($, e) => ({ text: await cmdWarn($, e.args) }))
  on('command.run', { command: 'cubudget' }, async ($, e) => ({ text: await cmdBudget($, e.args) }))
  on('command.run', { command: 'cureset' }, async ($, e) => ({ text: await cmdReset($, e.args) }))

  // ------------------------------------------------------------ the band: your buttons, one row, off by default

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await isOn($, 'buttons-band', false))) {
      return next(e)
    }
    const cfg = await read($, cfgA)

    if (cfg.buttons.length === 0) {
      return next(e)
    }
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box gap="sm" flexWrap="wrap">
          {cfg.buttons.map((b, i) => (
            <Button key={`band-${i}`} label={b.label} onPress={() => fillPrompt($, b.text)} />
          ))}
        </Box>
      </Box>
    )
  })

  // ------------------------------------------------------------ the pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui$ = $.ui.resolve(e)
    const { Box, Text, Button } = ui$
    const Svg = e.surface === 'desktop' ? (ui$ as ElementTable<'desktop'>).Svg : undefined
    const l = await live($)
    const cfg = l.cfg
    const ui = await read($, uiA)
    const feats = await read($, featuresA)
    const accent = String(await read($, accentA))
    const density = String(await read($, densityA))
    const icons = String(await read($, iconsA)) as Icons
    const pad = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
    const earned = await read($, earnedA)
    const pending = await read($, pendingA)
    const cols = Math.max(30, e.props.bodyColumns - 4)
    const pi = Math.max(0, Math.min(ui.page, cfg.pages.length - 1))
    const page = cfg.pages[pi] ?? { name: 'Main', tiles: [] }
    const active = TABS.find(t => t[0] === ui.tab)?.[0] ?? 'dashboard'
    const widthOf = (s: string): number => (s === 'L' ? cols : s === 'M' ? Math.min(cols, Math.max(24, Math.floor(cols / 2) - 1)) : Math.min(cols, Math.max(14, Math.floor(cols / 4) - 1)))
    const flagOn = (id: string, dflt: boolean) => flag(feats, `layout-kit.${id}`, dflt)
    const ctx = { m: l.m, cfg, rec: l.rec, icons, earned, now: l.now }
    const toneColor = (t: Tone | undefined): string | undefined => t
    const trim = (s: string, n: number): string => (Array.from(s.replace(/\s+/g, ' ')).length > n ? `${Array.from(s.replace(/\s+/g, ' ')).slice(0, n - 1).join('')}~` : s.replace(/\s+/g, ' '))
    const pageSlice = <T,>(items: readonly T[]): { rows: T[]; pages: number; pg: number } => {
      const pages = Math.max(1, Math.ceil(items.length / LIST_PAGE))
      const pg = Math.max(0, Math.min(ui.pg, pages - 1))

      return { rows: items.slice(pg * LIST_PAGE, (pg + 1) * LIST_PAGE), pages, pg }
    }

    const Pager = (pages: number, pg: number) =>
      pages > 1 ? (
        <Box gap={pad} alignItems="center">
          <Button key="pg-prev" label="< Prev" dimColor={pg === 0} onPress={() => update($, uiA, u => ({ ...u, pg: Math.max(0, pg - 1) }))} />
          <Text dimColor>{`${pg + 1} of ${pages}`}</Text>
          <Button key="pg-next" label="Next >" dimColor={pg >= pages - 1} onPress={() => update($, uiA, u => ({ ...u, pg: Math.min(pages - 1, pg + 1) }))} />
        </Box>
      ) : null

    const Heading = (text: string, sub?: string) => (
      <Box flexDirection="column" marginTop="sm">
        <Text size="heading" weight="bold">
          {text}
        </Text>
        {sub !== undefined && <Text dimColor size="caption">{sub}</Text>}
      </Box>
    )

    const SubTabs = (subs: readonly (readonly [string, string])[], current: string) => (
      <Box gap={pad} flexWrap="wrap">
        {subs.map(([id, label]) => (
          <Button key={`sub-${id}`} variant={id === current ? 'primary' : undefined} label={id === current ? `[${label}]` : label} onPress={() => update($, uiA, u => ({ ...u, sub: id, pg: 0 }))} />
        ))}
      </Box>
    )

    const PageTabs = (
      <Box gap={pad} flexWrap="wrap">
        {cfg.pages.map((p, i) => (
          <Button key={`page-${i}`} variant={i === pi ? 'primary' : undefined} label={i === pi ? `[${p.name}]` : p.name} onPress={() => update($, uiA, u => ({ ...u, page: i }))} />
        ))}
      </Box>
    )

    // ---- one tile
    const Tile = (ref: { id: string; size: 'S' | 'M' | 'L' }) => {
      const v: TileView = tileView(ref.id, ctx)
      const w = widthOf(ref.size)
      const inner = Math.max(8, w - 4)
      const ring = Svg !== undefined && v.pct !== undefined && (ref.id === 'ctx' || ref.id === 'limit' || ref.id === 'budget')
      const rows = ref.id === 'tools' ? toolRows(l.rec, cfg, icons, 8) : []

      return (
        <Box key={`tile-${ref.id}`} flexDirection="column" width={w} borderStyle="round" borderColor={(toneColor(v.tone) ?? 'subtle') as never} paddingX="sm">
          <Text dimColor size="caption" wrap="truncate">
            {trim(v.title, inner)}
          </Text>
          {v.big !== '' && (
            <Text size="heading" weight="bold" color={(toneColor(v.tone) ?? accent) as never} wrap="truncate">
              {trim(v.big, inner)}
            </Text>
          )}
          {ring && Svg !== undefined && <Svg source={ringSvg(v.pct ?? 0, v.title, v.tone ?? 'suggestion')} alt={`${v.title} ${v.pct ?? 0} percent`} isInteractive {...svgSize(ringSvg(v.pct ?? 0, v.title, v.tone ?? 'suggestion'), 72)} />}
          {!ring && v.pct !== undefined && (
            <Text mono color={(toneColor(v.tone) ?? accent) as never}>
              {bar(v.pct, Math.max(6, Math.min(24, inner - 6)))} {v.pct}%
            </Text>
          )}
          {v.sub !== '' && (
            <Text dimColor size="caption" wrap="truncate">
              {trim(v.sub, inner)}
            </Text>
          )}
          {v.spriteLines !== undefined && v.spriteLines.map(s => <Text mono color={accent as never}>{s === '' ? ' ' : s.replace(/ /g, '\u00a0')}</Text>)}
          {ref.id === 'tools' && Svg !== undefined && rows.length > 0 && <Svg source={barsSvg(rows, Math.min(560, inner * 8))} alt={barsAlt(rows)} isInteractive {...svgSize(barsSvg(rows, Math.min(560, inner * 8)), Math.min(560, inner * 8))} />}
          {!(ref.id === 'tools' && Svg !== undefined && rows.length > 0) &&
            v.lines.slice(0, ref.size === 'S' ? 3 : 8).map(x => (
              <Text mono wrap="truncate" color={x.color as never}>
                {trim(x.text, inner)}
              </Text>
            ))}
        </Box>
      )
    }

    // ---- tabs
    const Dashboard = (
      <Box flexDirection="column" gap={pad}>
        {cfg.pages.length > 1 && PageTabs}
        {cfg.buttons.length > 0 && (
          <Box gap={pad} flexWrap="wrap" alignItems="center">
            <Text dimColor size="caption">
              Chips:
            </Text>
            {cfg.buttons.map((b, i) => (
              <Button key={`chip-${i}`} label={b.label} onPress={() => fillPrompt($, b.text)} />
            ))}
          </Box>
        )}
        {page.tiles.length === 0 && <Text dimColor>This page has no tiles. Open Library to add some.</Text>}
        <Box flexDirection="row" flexWrap="wrap" gap={pad}>
          {page.tiles.map(Tile)}
        </Box>
        {!flagOn('record', true) && <Text color="warning" size="caption">Recording is switched off (layout-kit.record), so counters stay at zero.</Text>}
        {Svg === undefined && <Text dimColor size="caption">Text layout: this surface has no vector images.</Text>}
      </Box>
    )

    const SizeButtons = (id: string, size: string) =>
      SIZES.map(s => (
        <Button key={`sz-${id}-${s}`} variant={s === size ? 'primary' : undefined} label={s} onPress={() => pressPage($, pages => resizeTile(pages, ui.page, id, s))} />
      ))

    const Edit = (
      <Box flexDirection="column" gap={pad}>
        {Heading('Pages', 'Up to 6 named pages. Rename with /cutab rename <n> <name>.')}
        {PageTabs}
        <Box gap={pad} flexWrap="wrap">
          <Button key="pg-add" label="+ Page" onPress={() => press($, c => { const r = addPage(c.pages, `Page ${c.pages.length + 1}`); return r.ok ? { ok: true, value: { ...c, pages: r.value } } : r })} />
          <Button key="pg-del" label="Delete this page" dimColor={cfg.pages.length <= 1} onPress={() => pressPage($, (pages, i) => removePage(pages, i)).then(() => update($, uiA, u => ({ ...u, page: 0 })))} />
        </Box>
        {Heading(`Tiles on ${page.name}`, 'Drag and drop is not possible in a mod pane (no pointer events), so reorder with Up and Down and resize with S, M, L.')}
        {page.tiles.length === 0 && <Text dimColor>No tiles. Library adds them.</Text>}
        {page.tiles.map((t, i) => (
          <Box key={`row-${t.id}`} gap={pad} alignItems="center" flexWrap="wrap">
            <Text mono>{trim(`${i + 1}. ${tileView(t.id, ctx).title}`, 24).padEnd(26, ' ').replace(/ /g, '\u00a0')}</Text>
            <Button key={`up-${t.id}`} label="Up" dimColor={i === 0} onPress={() => pressPage($, pages => moveTile(pages, ui.page, t.id, -1))} />
            <Button key={`dn-${t.id}`} label="Down" dimColor={i === page.tiles.length - 1} onPress={() => pressPage($, pages => moveTile(pages, ui.page, t.id, 1))} />
            {SizeButtons(t.id, t.size)}
            <Button key={`rm-${t.id}`} label="Remove" dimColor onPress={() => pressPage($, pages => removeTile(pages, ui.page, t.id))} />
          </Box>
        ))}
        {Heading('Saved layouts', 'Named copies of the pages. /culayout project <name> opens one automatically in this project folder.')}
        {Object.keys(cfg.saved).length === 0 && <Text dimColor>None saved yet.</Text>}
        {Object.keys(cfg.saved).map(n => (
          <Box key={`lay-${n}`} gap={pad} alignItems="center">
            <Text mono>{`${n}${cfg.byProject[l.cwd] === n ? '  (this project)' : ''}`}</Text>
            <Button key={`lay-load-${n}`} label="Load" onPress={() => press($, c => loadLayout(c, n), `Loaded ${n}.`).then(() => update($, uiA, u => ({ ...u, page: 0 })))} />
            <Button key={`lay-bind-${n}`} label={cfg.byProject[l.cwd] === n ? 'Unbind project' : 'Use for this project'} dimColor onPress={() => press($, c => bindProject(c, l.cwd, c.byProject[l.cwd] === n ? undefined : n))} />
            <Button key={`lay-del-${n}`} label="Delete" dimColor onPress={() => press($, c => deleteLayout(c, n))} />
          </Box>
        ))}
        <Box gap={pad}>
          <Button key="lay-save" label="Save current as ..." onPress={() => press($, c => saveLayout(c, `layout-${Object.keys(c.saved).length + 1}`), 'Saved. Rename by saving under a name with /culayout save <name>.')} />
        </Box>
        {pending.has && (
          <Box flexDirection="column" borderStyle="round" borderColor={'warning' as never} paddingX="sm">
            <Text weight="bold" color={'warning' as never}>An import is waiting</Text>
            {pending.diff.split('\n').map(x => <Text mono>{trim(x, cols - 4)}</Text>)}
            <Box gap={pad}>
              <Button key="imp-yes" variant="primary" label="Apply import" onPress={() => cmdImport($, 'confirm').then(t => setNote($, t))} />
              <Button key="imp-no" label="Cancel" onPress={() => cmdImport($, 'cancel')} />
            </Box>
          </Box>
        )}
        <Text dimColor size="caption">/cuexport prints this layout as text; /cuimport JSON brings one in (with a diff and a confirm step).</Text>
      </Box>
    )

    const libItems = [
      ...BUILTIN.map(b => ({ id: b.id, label: b.label, about: b.about, custom: false })),
      ...cfg.defs.map(x => ({ id: `c:${x.id}`, label: x.label, about: `custom ${x.kind}`, custom: true })),
    ]
    const lib = pageSlice(libItems)
    const Library = (
      <Box flexDirection="column" gap={pad}>
        {Heading('Tile gallery', `Adding and removing acts on the page "${page.name}". Custom tiles come from /cucustom.`)}
        {lib.rows.map(item => {
          const onPage = page.tiles.some(t => t.id === item.id)
          const v = tileView(item.id, ctx)

          return (
            <Box key={`lib-${item.id}`} flexDirection="column" borderStyle="single" borderColor={'subtle' as never} paddingX="sm">
              <Box gap={pad} alignItems="center" flexWrap="wrap">
                <Text weight="bold">{item.label}</Text>
                <Text dimColor size="caption">{trim(item.about, 50)}</Text>
              </Box>
              <Box gap={pad} alignItems="center" flexWrap="wrap">
                <Text mono color={accent as never}>{trim(v.big === '' ? '(see tile)' : v.big, 24)}</Text>
                {onPage ? (
                  <Button key={`lib-rm-${item.id}`} label={`Remove from ${trim(page.name, 10)}`} onPress={() => pressPage($, pages => removeTile(pages, ui.page, item.id))} />
                ) : (
                  <Button key={`lib-add-${item.id}`} variant="primary" label={`Add to ${trim(page.name, 10)}`} onPress={() => pressPage($, (pages, i, c) => addTile(pages, i, item.id, c.defs))} />
                )}
                {item.custom && cfg.defs.find(x => `c:${x.id}` === item.id)?.kind === 'number' && (
                  <Button key={`lib-plus-${item.id}`} label="+1" onPress={() => press($, c => ({ ok: true, value: { ...c, defs: c.defs.map(x => (`c:${x.id}` === item.id ? { ...x, num: Math.min(1e9, x.num + 1) } : x)) } }))} />
                )}
                {item.custom && cfg.defs.find(x => `c:${x.id}` === item.id)?.kind === 'number' && (
                  <Button key={`lib-minus-${item.id}`} label="-1" onPress={() => press($, c => ({ ok: true, value: { ...c, defs: c.defs.map(x => (`c:${x.id}` === item.id ? { ...x, num: Math.max(-1e9, x.num - 1) } : x)) } }))} />
                )}
                {item.custom && (
                  <Button
                    key={`lib-del-${item.id}`}
                    label="Delete tile"
                    dimColor
                    onPress={() => press($, c => ({ ok: true, value: { ...c, defs: c.defs.filter(x => `c:${x.id}` !== item.id), pages: dropTileEverywhere(c.pages, item.id) } }))}
                  />
                )}
              </Box>
            </Box>
          )
        })}
        {Pager(lib.pages, lib.pg)}
        <Text dimColor size="caption">Metrics for formulas: {METRIC_NAMES.join(' ')}. Example: /cucustom formula errrate Error rate | errors / calls * 100</Text>
      </Box>
    )

    const ListRow = (key: string, name: string, text: string, use: (() => unknown) | undefined, del: () => unknown) => (
      <Box key={`row-${key}`} gap={pad} alignItems="center" flexWrap="wrap">
        <Text mono weight="bold">{name}</Text>
        <Text dimColor>{trim(text, Math.max(16, cols - 40))}</Text>
        {use !== undefined && <Button key={`use-${key}`} label="Use" onPress={use} />}
        <Button key={`del-${key}`} label="Delete" dimColor onPress={del} />
      </Box>
    )

    const subS = SNIP_SUBS.find(s => s[0] === ui.sub)?.[0] ?? 'snippets'
    const mapSl = pageSlice(subS === 'chips' ? [] : Object.entries(cfg[subS]))
    const chipSl = pageSlice(subS === 'chips' ? cfg.buttons : [])
    const snip = subS === 'chips' ? chipSl : mapSl
    const Snippets = (
      <Box flexDirection="column" gap={pad}>
        {SubTabs(SNIP_SUBS, subS)}
        {subS === 'snippets' && <Text dimColor size="caption">Short named texts. /cusnip add &lt;name&gt; &lt;text&gt;. Use puts the text in the prompt box (replacing what is there).</Text>}
        {subS === 'aliases' && <Text dimColor size="caption">An alias stores command text. A mod cannot register new slash commands at run time, so run one with /curun &lt;alias&gt; (or Use here): it fills the prompt box.</Text>}
        {subS === 'templates' && <Text dimColor size="caption">/cutpl add &lt;name&gt; &lt;text&gt; with {'{1}'} {'{2}'} for arguments and {'{name}'} for variables set with /cuvar name=value. Use here fills with variables only.</Text>}
        {subS === 'vars' && <Text dimColor size="caption">/cuvar name=value sets a variable used by {'{name}'} in templates.</Text>}
        {subS === 'chips' && <Text dimColor size="caption">Up to 5 buttons (/cubtn add &lt;label&gt; | &lt;text&gt;). They show here and on the Dashboard; the row above the prompt needs the layout-kit.buttons-band switch ({flagOn('buttons-band', false) ? 'on' : 'off'}).</Text>}
        {snip.rows.length === 0 && <Text dimColor>Nothing here yet.</Text>}
        {subS === 'chips'
          ? chipSl.rows.map((b, i) => ListRow(`chip-${i}`, b.label, b.text, () => fillPrompt($, b.text), () => press($, c => ({ ok: true, value: { ...c, buttons: c.buttons.filter(x => x.label !== b.label) } }))))
          : mapSl.rows.map(([n, text]) =>
              ListRow(
                `${subS}-${n}`,
                n,
                text,
                subS === 'vars' ? undefined : () => (subS === 'templates' ? cmdTpl($, n).then(t => setNote($, t.split('\n')[0] ?? '')) : fillPrompt($, text)),
                () => press($, c => delMap(c, subS, n)),
              ),
            )}
        {Pager(snip.pages, snip.pg)}
      </Box>
    )

    const subR = RULE_SUBS.find(s => s[0] === ui.sub)?.[0] ?? 'rules'
    const ruleSl = pageSlice(subR === 'rules' ? cfg.rules : [])
    const badgeSl = pageSlice(subR === 'badges' ? cfg.badges : [])
    const goalSl = pageSlice(subR === 'goals' ? cfg.goals : [])
    const toolSl = pageSlice(subR === 'tools' ? toolRows(l.rec, cfg, icons, 40) : [])
    const rulesPage = subR === 'rules' ? ruleSl : subR === 'badges' ? badgeSl : subR === 'goals' ? goalSl : toolSl
    const Rules = (
      <Box flexDirection="column" gap={pad}>
        {SubTabs(RULE_SUBS, subR)}
        {subR === 'rules' && (
          <Box flexDirection="column" gap={pad}>
            <Text dimColor size="caption">{`/curule add if errors > 5 then toast "..." . Evaluated when a turn ends, only while the layout-kit.rules switch is on (${flagOn('rules', false) ? 'on' : 'off'}); one toast per 3 minutes at most.`}</Text>
            {ruleSl.rows.length === 0 && <Text dimColor>No rules yet.</Text>}
            {ruleSl.rows.map((r, i) => {
              const idx = ruleSl.pg * LIST_PAGE + i

              return (
                <Box key={`rule-${idx}`} gap={pad} alignItems="center" flexWrap="wrap">
                  <Text mono color={(r.isOn ? accent : 'subtle') as never}>{`${idx + 1}. if ${trim(r.cond, 30)}`}</Text>
                  <Text dimColor>{trim(`toast "${r.msg}"`, 34)}</Text>
                  <Button key={`rule-t-${idx}`} label={r.isOn ? 'On' : 'Off'} variant={r.isOn ? 'primary' : undefined} onPress={() => press($, c => ({ ok: true, value: { ...c, rules: c.rules.map((x, j) => (j === idx ? { ...x, isOn: !x.isOn } : x)) } }))} />
                  <Button key={`rule-d-${idx}`} label="Delete" dimColor onPress={() => press($, c => ({ ok: true, value: { ...c, rules: c.rules.filter((_, j) => j !== idx) } }))} />
                </Box>
              )
            })}
          </Box>
        )}
        {subR === 'recipes' && (
          <Box flexDirection="column" gap={pad}>
            <Text dimColor size="caption">{`Six ready-made rules, run by the same engine. They fire only while the layout-kit.recipes switch is on (${flagOn('recipes', false) ? 'on' : 'off'}).`}</Text>
            {RECIPES.map(r => (
              <Box key={`rec-${r.id}`} gap={pad} alignItems="center" flexWrap="wrap">
                <Button key={`rec-t-${r.id}`} label={cfg.recipes[r.id] === true ? 'On' : 'Off'} variant={cfg.recipes[r.id] === true ? 'primary' : undefined} onPress={() => press($, c => ({ ok: true, value: { ...c, recipes: { ...c.recipes, [r.id]: c.recipes[r.id] !== true } } }))} />
                <Text weight="bold">{r.label}</Text>
                <Text dimColor mono>{trim(`if ${r.cond}`, 40)}</Text>
              </Box>
            ))}
          </Box>
        )}
        {subR === 'badges' && (
          <Box flexDirection="column" gap={pad}>
            <Text dimColor size="caption">{`/cubadge "100 calls" when calls >= 100. Earned from the counters when a turn ends; a toast on earning needs layout-kit.badge-toasts (${flagOn('badge-toasts', false) ? 'on' : 'off'}).`}</Text>
            {badgeSl.rows.length === 0 && <Text dimColor>No badges yet.</Text>}
            {badgeSl.rows.map((b, i) => (
              <Box key={`badge-${i}`} gap={pad} alignItems="center" flexWrap="wrap">
                <Text mono color={(earned.includes(b.name) ? 'success' : 'subtle') as never}>{`${earned.includes(b.name) ? '[x]' : '[ ]'} ${b.name}`}</Text>
                <Text dimColor>{trim(`when ${b.cond}`, 40)}</Text>
                <Button key={`badge-d-${i}`} label="Delete" dimColor onPress={() => press($, c => ({ ok: true, value: { ...c, badges: c.badges.filter(x => x.name !== b.name) } }))} />
              </Box>
            ))}
          </Box>
        )}
        {subR === 'goals' && (
          <Box flexDirection="column" gap={pad}>
            <Text dimColor size="caption">/cugoal "ship it" files target 10. Progress is the formula over the target.</Text>
            {goalSl.rows.length === 0 && <Text dimColor>No goals yet.</Text>}
            {goalSl.rows.map((g, i) => {
              const v = calc(g.expr, l.m) ?? 0
              const pct = Math.max(0, Math.min(100, Math.round((v / g.target) * 100)))

              return (
                <Box key={`goal-${i}`} gap={pad} alignItems="center" flexWrap="wrap">
                  <Text mono weight="bold">{trim(g.name, 20)}</Text>
                  <Text mono color={(pct >= 100 ? 'success' : accent) as never}>{`${bar(pct, 12)} ${fmtNum(v)}/${fmtNum(g.target)}`}</Text>
                  <Button key={`goal-d-${i}`} label="Delete" dimColor onPress={() => press($, c => ({ ok: true, value: { ...c, goals: c.goals.filter(x => x.name !== g.name) } }))} />
                </Box>
              )
            })}
          </Box>
        )}
        {subR === 'tools' && (
          <Box flexDirection="column" gap={pad}>
            <Text dimColor size="caption">Colour, glyph and friendly name per tool. These change this pane only, never the tool rows in the chat. Glyph and name: /cutool glyph|name &lt;tool&gt; &lt;value&gt;.</Text>
            {toolSl.rows.length === 0 && <Text dimColor>No tool has been called yet.</Text>}
            {toolSl.rows.map(r => (
              <Box key={`tool-${r.tool}`} gap={pad} alignItems="center" flexWrap="wrap">
                <Text mono color={r.color as never}>{`${r.glyph === '' ? ' ' : r.glyph} ${trim(r.label, 18)}`}</Text>
                <Text dimColor>{`${r.n} calls`}</Text>
                <Button key={`tool-c-${r.tool}`} label={`Colour: ${r.color}`} onPress={() => press($, c => setToolStyle(c, 'color', r.tool, nextColor(r.color)))} />
                <Button key={`tool-r-${r.tool}`} label="Reset" dimColor onPress={() => cmdTool($, `clear ${r.tool}`).then(() => setNote($, ''))} />
              </Box>
            ))}
          </Box>
        )}
        {subR === 'limits' && (
          <Box flexDirection="column" gap={pad}>
            {Heading('Warning levels', 'Tile colours: below warn is green, from warn is amber, from bad is red. /cuwarn <metric> <warn> <bad>')}
            {(['ctx', 'limit', 'errors', 'spend'] as const).map(k => (
              <Text mono key={`thr-${k}`}>{`${k.padEnd(7, ' ').replace(/ /g, '\u00a0')} warn ${cfg.thr[k][0]}  bad ${cfg.thr[k][1]}  now ${fmtMetric(k === 'errors' ? 'errors' : k, l.m[k])}`}</Text>
            ))}
            {Heading('Project budget', 'Keyed by the project folder: /cubudget <usd>')}
            <Text mono>{budgetFor(cfg, l.cwd) > 0 ? `${fmtUsd(budgetFor(cfg, l.cwd))} for ${trim(l.cwd, 40)}` : `none for ${trim(l.cwd, 40) || 'this folder'}`}</Text>
            {Heading('Status template', `Written only with layout-kit.status-template on (${flagOn('status-template', false) ? 'on' : 'off'}), at most every 15 s.`)}
            <Text mono>{cfg.statusTpl === '' ? '(none)  /custatus {calls} calls {errors} err {spend} {ctx}' : trim(`${cfg.statusTpl}  ->  ${renderStatus(cfg.statusTpl, l.m)}`, cols - 2)}</Text>
            {Heading('Sprite', 'A static 5-line picture. /cusprite preset cat|robot|ghost')}
            {cfg.sprite.length === 0 ? <Text dimColor>(none)</Text> : cfg.sprite.map(s => <Text mono color={accent as never}>{s === '' ? ' ' : s.replace(/ /g, '\u00a0')}</Text>)}
          </Box>
        )}
        {Pager(rulesPage.pages, rulesPage.pg)}
      </Box>
    )

    return (
      <Box flexDirection="column" padding={pad} gap={pad}>
        <Box gap={pad} flexWrap="wrap">
          {TABS.map(([id, label]) => (
            <Button key={`tab-${id}`} variant={id === active ? 'primary' : undefined} label={id === active ? `[${label}]` : label} onPress={() => update($, uiA, u => ({ ...u, tab: id, pg: 0, sub: '' }))} />
          ))}
        </Box>
        {ui.note !== '' && (
          <Text color={'suggestion' as never} size="caption">
            {ui.note}
          </Text>
        )}
        {active === 'dashboard' && Dashboard}
        {active === 'edit' && Edit}
        {active === 'library' && Library}
        {active === 'snippets' && Snippets}
        {active === 'rules' && Rules}
        <Text dimColor size="caption">
          Everything here changes only this pane. Counters are recorded this session; the clock updates when the pane redraws. /cu lists the commands.
        </Text>
      </Box>
    )
  })
}

