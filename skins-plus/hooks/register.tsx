import { atom, read, update } from 'claude-code'
import type { Hook, Register, ThemeSetArgs, Timer } from 'claude-code'

import {
  COLOUR_NAMES,
  FIXED,
  LIVE_SKINS,
  ROLE_NAMES,
  WEEKDAYS,
  allFixed,
  branchSlot,
  build,
  BRANCH_HUES,
  canonicalSkin,
  customDef,
  hexHue,
  huePalette,
  isFixedSkin,
  isHex,
  parseColour,
  sunHue,
  withRoles,
} from './palettes'
import type { CustomPalette, Def, RoleName } from './palettes'
import {
  MAX_RULES,
  PLACEHOLDERS,
  SCALES,
  activeRule,
  addRule,
  bounded,
  checkTemplate,
  cleanCfg,
  dayId,
  defaults,
  diffCfg,
  exportPalette,
  exportSetup,
  fmtCost,
  fmtPercent,
  isRuleSkin,
  normTime,
  padFor,
  paneSize,
  parseCustom,
  parseImport,
  renderTemplate,
  spaceText,
  spacingFor,
  styleFor,
} from './pure'
import type { Cfg, Imported, Rule } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'skins-plus-main'
const STATUS_MS = 15_000
const LIVE_MS = 30 * 60_000
const BRANCH_TTL_MS = 60_000
const PENDING_TTL_MS = 10 * 60_000

// Bumped after every change so the pane redraws; the settings themselves live in $.store.
const rev = atom({ plugin: 'skins-plus', key: 'rev' } as const, 0)

// Module variables restart on a reload; session.start fills them again.
const mod = {
  cwd: '',
  current: null as string | null,
  lastLive: '',
  lastStatusAt: 0,
  hasStatus: false,
  branch: undefined as { at: number; value: string | undefined } | undefined,
  liveTimer: undefined as Timer | undefined,
  statusTimer: undefined as Timer | undefined,
}

const COMMANDS: readonly { name: string; description: string }[] = [
  { name: 'sp', description: 'Skins plus: list every /sp command' },
  { name: 'spskin', description: 'Apply a palette now: /spskin cyber|night|hivis|print|mon..sun|custom|project|branch|sun|plain' },
  { name: 'spnight', description: 'Apply the cozy night palette (low blue, amber on dark)' },
  { name: 'spscheme', description: 'Colour mode for palettes: /spscheme system|light|dark' },
  { name: 'spauto', description: 'Apply a project or branch tint at session start: /spauto on|project|branch|off' },
  { name: 'spproject', description: 'Accent colour for this folder: /spproject <colour|#hex|off>' },
  { name: 'spday', description: "Apply today's weekday palette at session start: /spday on|off" },
  { name: 'spsched', description: 'Look scheduler: /spsched on|off|add 22:00 night|del 22:00|list' },
  { name: 'spsun', description: 'Accent hue follows the hour: /spsun on|off' },
  { name: 'spuse', description: 'Palette profile for this folder: /spuse set <name>, /spuse, /spuse off' },
  { name: 'spstatus', description: 'Custom status line: /spstatus on|off or /spstatus {branch} {cost} {context}' },
  { name: 'sprole', description: 'Semantic colours for these palettes: /sprole danger #aa0000' },
  { name: 'spcustom', description: 'Edit your custom palette: /spcustom hue 200 sat 20 mode both accent #2288cc' },
  { name: 'spexport', description: 'Show your custom palette as JSON' },
  { name: 'spimport', description: 'Import JSON with a preview: /spimport <json>, then /spimport confirm' },
  { name: 'spshare', description: "Show this mod's settings as one JSON block" },
  { name: 'spdys', description: 'Dyslexia-friendly spacing: /spdys on|off' },
  { name: 'sptype', description: 'Large-type scale: /sptype 1|1.15|1.3|1.5' },
  { name: 'spdensity', description: 'Compact or airy density for this mod: /spdensity compact|normal|airy' },
  { name: 'sppane', description: 'Open the skins-plus pane' },
  { name: 'spreset', description: "Forget everything this mod stored (the theme itself is left alone)" },
]

const HELP = [
  'Skins plus: more looks, all opt-in. Nothing recolours the app until you type a command or turn a switch on.',
  '  /spskin <name>     apply now: cyber night hivis print mon..sun custom project branch sun plain',
  '  /spnight           shortcut for /spskin night (low blue, amber on dark)',
  '  /spscheme <m>      system (app decides) | light | dark (forced). Needs the next /spskin to apply',
  '  /spauto <m>        on | project | branch | off: tint applied at session start (default off)',
  '  /spproject <c>     accent colour for this folder (name or #hex), /spproject off',
  '  /spday on|off      apply today\'s weekday palette at session start (default off)',
  '  /spsched ...       look scheduler, checked every 30 min while on (default off)',
  '  /spsun on|off      accent hue follows the hour, every 30 min (default off)',
  '  /spuse [set <n>]   palette profile for this folder: set, apply, off',
  '  /spstatus ...      custom status line template (default off, writes at most every 15 s)',
  '  /sprole <r> <hex>  semantic colours (accent danger success warning pro) used by these palettes',
  '  /spcustom ...      edit your custom palette; apply with /spskin custom',
  '  /spexport          your custom palette as JSON',
  '  /spimport <json>   validate and preview; /spimport confirm applies; /spimport cancel',
  '  /spshare           this mod\'s settings as one JSON block (no folder paths)',
  '  /spdys on|off      dyslexia-friendly spacing: own panes, and the type style of /spskin',
  '  /sptype <scale>    large-type scale for own panes and the type style of /spskin',
  '  /spdensity <d>     compact | normal | airy for own panes; also prints the /cfg density command',
  '  /sppane            open the skins-plus pane',
  '  /spreset           forget everything stored by this mod (does not touch the theme)',
  'Applying a theme from two mods means the last call wins. This mod never clears the theme except for a scheduler rule `default`; use /look off otherwise.',
].join('\n')

// ---------------------------------------------------------------- storage

const loadCfg = async ($: Dollar): Promise<Cfg> => cleanCfg(await $.store.get('cfg'))

const saveCfg = async ($: Dollar, cfg: Cfg) => {
  await $.store.set('cfg', cfg)
  await update($, rev, n => n + 1)
}

const loadMap = async ($: Dollar, key: string): Promise<Record<string, string>> => {
  const raw = await $.store.get(key)
  const out: Record<string, string> = {}

  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') {
        out[k] = v
      }
    }
  }

  return out
}

const bump = ($: Dollar) => update($, rev, n => n + 1)

// ---------------------------------------------------------------- git branch (read only)

const gitBranch = async ($: Dollar): Promise<string | undefined> => {
  const now = await $.clock.now()

  if (mod.branch !== undefined && now - mod.branch.at < BRANCH_TTL_MS) {
    return mod.branch.value
  }
  let value: string | undefined

  try {
    const out = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })

    value = out.exitCode === 0 && out.stdout.trim() !== '' ? out.stdout.trim().slice(0, 100) : undefined
  } catch {
    value = undefined
  }
  mod.branch = { at: now, value }

  return value
}

// ---------------------------------------------------------------- choosing and applying a skin

type Resolved = { id: string; label: string; def: Def | undefined }

const resolveSkin = async ($: Dollar, cfg: Cfg, rawName: string, now: number): Promise<Resolved | string> => {
  const name = canonicalSkin(rawName)
  const fixed = FIXED[name]

  if (fixed !== undefined) {
    return { id: fixed.id, label: fixed.label, def: fixed.def }
  }

  if (name === 'custom') {
    return cfg.custom === null
      ? 'No custom palette yet. /spcustom hue 200 sat 20 mode both makes one, or /spimport <json>.'
      : { id: 'custom', label: 'Custom palette', def: customDef(cfg.custom) }
  }

  if (name === 'project') {
    const accent = (await loadMap($, 'projects'))[mod.cwd]

    return accent === undefined
      ? 'This folder has no accent. /spproject <colour> sets one.'
      : { id: 'project', label: `Project accent ${accent}`, def: huePalette(hexHue(accent), accent) }
  }

  if (name === 'branch') {
    const branch = await gitBranch($)

    if (branch === undefined) {
      return 'No git branch here (not a repository, or git cannot run in this session).'
    }
    const hue = BRANCH_HUES[branchSlot(branch)]!

    return { id: 'branch', label: `Branch ${branch} (hue ${hue})`, def: huePalette(hue) }
  }

  if (name === 'sun') {
    const d = new Date(now)
    const hue = sunHue(d.getHours() + d.getMinutes() / 60)

    return { id: 'sun', label: `Sun accent (hue ${hue})`, def: huePalette(hue) }
  }

  if (name === 'plain') {
    return { id: 'plain', label: 'Plain type only', def: undefined }
  }

  return `No look called "${rawName}". Names: ${[...Object.keys(FIXED), ...LIVE_SKINS].join(' ')}.`
}

// One theme.set per call. `colors` is left out when the palette would not paint.
const applyResolved = async ($: Dollar, cfg: Cfg, r: Resolved): Promise<string> => {
  const args: ThemeSetArgs = {}
  const notes: string[] = []

  if (r.def !== undefined) {
    const built = build(r.label, r.def, cfg.roles)

    if (built.refused !== undefined) {
      return `Not applied: ${built.refused}`
    }
    args.colors = built.theme
  }

  if (cfg.scheme !== 'system') {
    if (r.def?.only !== undefined && r.def.only !== cfg.scheme) {
      notes.push(`this palette is ${r.def.only}-only, so the ${cfg.scheme} choice is ignored`)
    } else {
      args.overrideColorScheme = cfg.scheme
    }
  }
  const style = styleFor(cfg)

  if (style !== undefined) {
    args.style = style as ThemeSetArgs['style']
  }

  if (Object.keys(args).length === 0) {
    return 'Nothing to apply: plain type needs /spdys on or /sptype above 1 (or /spscheme light|dark).'
  }

  try {
    const set = await $.theme.set(args)

    if (!set.isDrawn) {
      notes.push(set.reason)
    }
  } catch (error) {
    if (args.style !== undefined) {
      // An older build may not take `style`: send the colours alone.
      const { style: _style, ...rest } = args

      if (Object.keys(rest).length === 0) {
        return `Not applied: ${String(error)}`
      }

      try {
        await $.theme.set(rest)
        notes.push('this build does not take type styles, so only colours were applied')
      } catch (again) {
        return `Not applied: ${String(again)}`
      }
    } else {
      return `Not applied: ${String(error)}`
    }
  }
  mod.current = r.id
  await bump($)

  return `Applied ${r.label}.${style === undefined ? '' : ' Type style included.'}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`
}

const applyByName = async ($: Dollar, name: string): Promise<string> => {
  const cfg = await loadCfg($)
  const r = await resolveSkin($, cfg, name, await $.clock.now())

  return typeof r === 'string' ? r : applyResolved($, cfg, r)
}

// ---------------------------------------------------------------- automatic choices (all opt-in)

type Candidate = { name: string; key: string | undefined }

const startupCandidate = async ($: Dollar, cfg: Cfg): Promise<Candidate | undefined> => {
  const now = await $.clock.now()
  const date = new Date(now)
  const minute = date.getHours() * 60 + date.getMinutes()
  const rule = cfg.sched.on ? activeRule(cfg.sched.rules, minute) : undefined

  if (rule !== undefined) {
    return { name: rule.skin, key: `sched:${rule.at}:${rule.skin}` }
  }

  if (cfg.day) {
    return { name: dayId(date), key: undefined }
  }

  if (cfg.auto !== 'off') {
    if (cfg.auto === 'on') {
      const profile = (await loadMap($, 'profiles'))[mod.cwd]

      if (profile !== undefined) {
        return { name: profile, key: undefined }
      }
    }

    if (cfg.auto === 'on' || cfg.auto === 'project') {
      if ((await loadMap($, 'projects'))[mod.cwd] !== undefined) {
        return { name: 'project', key: undefined }
      }
    }

    if ((cfg.auto === 'on' || cfg.auto === 'branch') && (await gitBranch($)) !== undefined) {
      return { name: 'branch', key: undefined }
    }
  }

  return cfg.sun ? { name: 'sun', key: `sun:${sunHue(date.getHours() + date.getMinutes() / 60)}` } : undefined
}

const applyCandidate = async ($: Dollar, cfg: Cfg, c: Candidate): Promise<string> => {
  if (c.key !== undefined) {
    mod.lastLive = c.key
  }

  if (c.name === 'default') {
    // Only a scheduler rule the user wrote (`06:00 default`) ever reaches this.
    await $.theme.clear()
    mod.current = null

    return 'Cleared the theme (scheduler rule: default).'
  }

  const r = await resolveSkin($, cfg, c.name, await $.clock.now())

  return typeof r === 'string' ? r : applyResolved($, cfg, r)
}

// The 30 minute check: the scheduler first, else the sun accent. Applies only when the choice changed.
const liveTick = async ($: Dollar) => {
  const cfg = await loadCfg($)
  const date = new Date(await $.clock.now())
  const minute = date.getHours() * 60 + date.getMinutes()
  const rule = cfg.sched.on ? activeRule(cfg.sched.rules, minute) : undefined
  let c: Candidate | undefined

  if (rule !== undefined) {
    c = { name: rule.skin, key: `sched:${rule.at}:${rule.skin}` }
  } else if (cfg.sun) {
    c = { name: 'sun', key: `sun:${sunHue(date.getHours() + date.getMinutes() / 60)}` }
  }

  if (c === undefined || c.key === mod.lastLive) {
    return
  }
  await applyCandidate($, cfg, c)
}

const restartTimers = async ($: Dollar) => {
  const cfg = await loadCfg($)

  mod.liveTimer?.cancel()
  mod.liveTimer = undefined
  mod.statusTimer?.cancel()
  mod.statusTimer = undefined

  if (cfg.sched.on || cfg.sun) {
    mod.liveTimer = $.clock.every(LIVE_MS, () => {
      void liveTick($).catch(() => undefined)
    })
  }

  if (cfg.status.on) {
    mod.statusTimer = $.clock.every(STATUS_MS, () => {
      void statusTick($).catch(() => undefined)
    })
    await statusTick($).catch(() => undefined)
  } else if (mod.hasStatus) {
    $.ui.status(undefined)
    mod.hasStatus = false
  }
}

// ---------------------------------------------------------------- status line

const statusTick = async ($: Dollar) => {
  const cfg = await loadCfg($)

  if (!cfg.status.on) {
    return
  }
  const now = await $.clock.now()

  if (mod.lastStatusAt !== 0 && now - mod.lastStatusAt < STATUS_MS - 500) {
    return
  }
  const usage = await $.session.usage()
  const rate = usage.rateLimits.reduce<number | undefined>((m, r) => (m === undefined || r.percentUsed > m ? r.percentUsed : m), undefined)
  const date = new Date(now)
  const text = renderTemplate(cfg.status.template, {
    branch: (await gitBranch($)) ?? '-',
    cost: fmtCost(usage.cost?.usd),
    context: fmtPercent(usage.context.percent),
    rate: fmtPercent(rate),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  })

  mod.lastStatusAt = now
  mod.hasStatus = true
  $.ui.status(text)
}

// ---------------------------------------------------------------- commands

const words = (s: string) => s.trim().split(/\s+/).filter(w => w !== '')

const onOff = (s: string | undefined): boolean | undefined => (s === 'on' ? true : s === 'off' ? false : undefined)

const roleCheck = (cfg: Cfg, roles: Partial<Record<RoleName, string>>): string | undefined => {
  for (const s of allFixed()) {
    const built = build(s.label, s.def, roles)

    if (built.refused !== undefined) {
      return `${s.label}: ${built.refused}`
    }
  }

  if (cfg.custom !== null) {
    const built = build('Custom', customDef(cfg.custom), roles)

    if (built.refused !== undefined) {
      return `Custom palette: ${built.refused}`
    }
  }

  return undefined
}

const customCheck = (c: CustomPalette, roles: Partial<Record<RoleName, string>>): string | undefined => {
  const built = build('Custom', customDef(c), roles)

  return built.refused
}

const describe = async ($: Dollar): Promise<string> => {
  const cfg = await loadCfg($)
  const profile = (await loadMap($, 'profiles'))[mod.cwd]
  const accent = (await loadMap($, 'projects'))[mod.cwd]
  const roles = Object.entries(cfg.roles)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')

  return [
    `Applied this session: ${mod.current ?? 'none'}   scheme: ${cfg.scheme}`,
    `Auto at session start: ${cfg.auto}   weekday: ${cfg.day ? 'on' : 'off'}   sun accent: ${cfg.sun ? 'on' : 'off'}`,
    `Scheduler: ${cfg.sched.on ? 'on' : 'off'}, ${cfg.sched.rules.length} rule(s)   status line: ${cfg.status.on ? 'on' : 'off'}`,
    `This folder: accent ${accent ?? 'none'}, profile ${profile ?? 'none'}`,
    `Typography: dyslexia ${cfg.dys ? 'on' : 'off'}, scale ${cfg.scale}, density ${cfg.density}   custom palette: ${cfg.custom === null ? 'none' : 'set'}   roles: ${roles === '' ? 'default' : roles}`,
  ].join('\n')
}

const listSkins = async ($: Dollar): Promise<string> => {
  const cfg = await loadCfg($)

  return [
    await describe($),
    '',
    'Palettes:',
    ...Object.values(FIXED)
      .filter(s => !WEEKDAYS.some(d => d.id === s.id))
      .map(s => `  ${s.id.padEnd(8)} ${s.blurb}`),
    `  mon..sun ${WEEKDAYS.map(d => `${d.id} ${d.hue}`).join(', ')} (one hue per weekday)`,
    `  custom   ${cfg.custom === null ? 'not set: /spcustom' : `hue ${cfg.custom.hue}, sat ${cfg.custom.sat}, ${cfg.custom.mode}`}`,
    '  project  tint from this folder\'s /spproject accent',
    '  branch   one of 8 hues picked from the git branch name',
    '  sun      accent hue for the current hour',
    '  plain    no colours, only the type style (/spdys, /sptype)',
    '',
    '/spskin <name> applies it now with one theme.set. To go back to the app\'s own look use /look off.',
  ].join('\n')
}

async function cmdSkin($: Dollar, args: string): Promise<string> {
  const name = words(args)[0] ?? ''

  if (name === '' || name === 'list') {
    return listSkins($)
  }

  if (name === 'off' || name === 'default' || name === 'none') {
    return "This mod does not clear the theme on its own. Use /look off (the looks mod) to go back to the app's own look, or a scheduler rule `06:00 default`."
  }

  return applyByName($, name)
}

async function cmdScheme($: Dollar, args: string): Promise<string> {
  const v = words(args)[0] ?? ''
  const cfg = await loadCfg($)

  if (v !== 'system' && v !== 'light' && v !== 'dark') {
    return [
      `Scheme: ${cfg.scheme}. Usage: /spscheme system|light|dark`,
      '  system: no override, so a palette that has both a light and a dark half follows the mode the app is in (the mod cannot read the OS setting itself)',
      '  light / dark: forces that mode with overrideColorScheme (a dark-only palette ignores light)',
    ].join('\n')
  }
  await saveCfg($, { ...cfg, scheme: v })

  return `Scheme ${v}. It is used by the next /spskin (or automatic) apply.`
}

async function cmdAuto($: Dollar, args: string): Promise<string> {
  const v = words(args)[0] ?? ''
  const cfg = await loadCfg($)

  if (v !== 'on' && v !== 'off' && v !== 'project' && v !== 'branch') {
    return `Auto: ${cfg.auto}. Usage: /spauto on|project|branch|off. At session start, applies this folder's profile, then its /spproject accent, then a branch tint (on); or only the project or branch one. Off by default.`
  }
  await saveCfg($, { ...cfg, auto: v })

  return v === 'off' ? 'Auto off: nothing is applied at session start by this switch.' : `Auto ${v}: applies at the next session start in a folder that has what it needs.`
}

async function cmdProject($: Dollar, args: string): Promise<string> {
  const v = words(args)[0] ?? ''
  const map = await loadMap($, 'projects')
  const cfg = await loadCfg($)

  if (v === '') {
    return `This folder's accent: ${map[mod.cwd] ?? 'none'}. Usage: /spproject <${Object.keys(COLOUR_NAMES).join('|')}|#rrggbb|off>`
  }

  if (v === 'off') {
    const next = { ...map }

    delete next[mod.cwd]
    await $.store.set('projects', next)
    await bump($)

    return 'Folder accent removed.'
  }
  const hex = parseColour(v)

  if (hex === undefined) {
    return `"${v}" is not a colour. Use one of ${Object.keys(COLOUR_NAMES).join(', ')} or a #rrggbb hex.`
  }
  const built = build('Project accent', huePalette(hexHue(hex), hex), cfg.roles)

  if (built.refused !== undefined) {
    return `That colour would not paint: ${built.refused}`
  }
  await $.store.set('projects', bounded(map, mod.cwd, hex))
  await bump($)

  return `Accent ${hex} stored for ${mod.cwd}. /spskin project applies it now; /spauto on|project applies it at session start.`
}

async function cmdSwitch($: Dollar, key: 'day' | 'sun', args: string, what: string): Promise<string> {
  const cfg = await loadCfg($)
  const v = onOff(words(args)[0])

  if (v === undefined) {
    return `${what} is ${cfg[key] ? 'on' : 'off'}. Usage: /sp${key} on|off`
  }
  await saveCfg($, { ...cfg, [key]: v })
  await restartTimers($)

  return `${what} ${v ? 'on' : 'off'}.`
}

const listRules = (cfg: Cfg): string =>
  cfg.sched.rules.length === 0
    ? '  (no rules)'
    : cfg.sched.rules.map((r: Rule) => `  ${r.at} ${r.skin}`).join('\n')

async function cmdSched($: Dollar, args: string): Promise<string> {
  const [sub = '', a = '', b = ''] = words(args)
  const cfg = await loadCfg($)
  const usage = `Usage: /spsched on|off | add <HH:MM> <look> | del <HH:MM> | clear | list   (up to ${MAX_RULES} rules; a look may be \`default\`, which clears the theme)`

  if (sub === 'on' || sub === 'off') {
    await saveCfg($, { ...cfg, sched: { ...cfg.sched, on: sub === 'on' } })
    await restartTimers($)

    return sub === 'on'
      ? `Scheduler on, checked every 30 minutes (and at session start). It acts only when the rule in force changes.\n${listRules(cfg)}`
      : 'Scheduler off.'
  }

  if (sub === 'add') {
    const rules = addRule(cfg.sched.rules, a, b)

    if (typeof rules === 'string') {
      return rules
    }
    await saveCfg($, { ...cfg, sched: { ...cfg.sched, rules } })

    return `Rule added.\n${listRules({ ...cfg, sched: { ...cfg.sched, rules } })}\nScheduler is ${cfg.sched.on ? 'on' : 'off: /spsched on starts it'}.`
  }

  if (sub === 'del') {
    const at = normTime(a)
    const rules = cfg.sched.rules.filter(r => r.at !== at)

    if (at === undefined || rules.length === cfg.sched.rules.length) {
      return `No rule at "${a}". ${usage}`
    }
    await saveCfg($, { ...cfg, sched: { ...cfg.sched, rules } })

    return 'Rule removed.'
  }

  if (sub === 'clear') {
    await saveCfg($, { ...cfg, sched: { ...cfg.sched, rules: [] } })

    return 'All rules removed.'
  }

  if (sub === '' || sub === 'list') {
    return `Scheduler ${cfg.sched.on ? 'on' : 'off'}:\n${listRules(cfg)}\n${usage}\nIn force: ${activeRule(cfg.sched.rules, new Date(await $.clock.now()).getHours() * 60 + new Date(await $.clock.now()).getMinutes())?.skin ?? 'none'}`
  }

  return usage
}

async function cmdUse($: Dollar, args: string): Promise<string> {
  const [sub = '', name = ''] = words(args)
  const profiles = await loadMap($, 'profiles')
  const stored = profiles[mod.cwd]

  if (sub === 'set') {
    const n = canonicalSkin(name)

    if (!isFixedSkin(n) && !['custom', 'sun', 'plain', 'project', 'branch'].includes(n)) {
      return `Usage: /spuse set <${[...Object.keys(FIXED), ...LIVE_SKINS].join('|')}>`
    }
    await $.store.set('profiles', bounded(profiles, mod.cwd, n))
    await bump($)

    return `Profile ${n} stored for ${mod.cwd}. /spuse applies it; /spauto on applies it at session start.`
  }

  if (sub === 'off') {
    const next = { ...profiles }

    delete next[mod.cwd]
    await $.store.set('profiles', next)
    await bump($)

    return 'Profile removed for this folder.'
  }

  if (sub !== '') {
    return 'Usage: /spuse set <name> | /spuse | /spuse off'
  }

  return stored === undefined ? 'No profile for this folder. /spuse set <name> stores one.' : applyByName($, stored)
}

async function cmdStatus($: Dollar, args: string): Promise<string> {
  const text = args.trim()
  const cfg = await loadCfg($)
  const sw = onOff(text)

  if (text === '' || text === 'show') {
    return `Status line ${cfg.status.on ? 'on' : 'off'}, template: ${cfg.status.template}\nUsage: /spstatus on|off, or /spstatus {branch} {cost} {context} (placeholders: ${PLACEHOLDERS.map(p => `{${p}}`).join(' ')}). Updated at most every 15 seconds, only while on. The status line is shared with other mods; this one writes its own entry and clears it on off.`
  }

  if (sw !== undefined) {
    await saveCfg($, { ...cfg, status: { ...cfg.status, on: sw } })
    await restartTimers($)

    return sw ? `Status line on: ${cfg.status.template}` : 'Status line off and cleared.'
  }

  if (text === 'reset') {
    await saveCfg($, { ...cfg, status: { ...cfg.status, template: defaults().status.template } })

    return 'Template reset to the default.'
  }
  const problem = checkTemplate(text)

  if (problem !== undefined) {
    return problem
  }
  await saveCfg($, { ...cfg, status: { ...cfg.status, template: text } })

  return `Template saved: ${text}\n${cfg.status.on ? 'It shows within 15 seconds.' : 'Turn it on with /spstatus on.'}`
}

async function cmdRole($: Dollar, args: string): Promise<string> {
  const [role = '', value = ''] = words(args)
  const cfg = await loadCfg($)

  if (role === '' || role === 'list') {
    return `Roles: ${ROLE_NAMES.map(r => `${r} ${cfg.roles[r] ?? '(palette default)'}`).join(', ')}\nUsage: /sprole <${ROLE_NAMES.join('|')}> <#rrggbb|off>, /sprole reset. Used by every palette of this mod from the next apply.`
  }

  if (role === 'reset') {
    await saveCfg($, { ...cfg, roles: {} })

    return 'Role colours back to each palette\'s own.'
  }

  if (!(ROLE_NAMES as readonly string[]).includes(role)) {
    return `Roles are ${ROLE_NAMES.join(', ')}.`
  }
  const r = role as RoleName
  const roles = { ...cfg.roles }

  if (value === 'off') {
    delete roles[r]
  } else if (isHex(value)) {
    roles[r] = value.toLowerCase()
  } else {
    return 'Give a six-digit hex such as #aa0000, or off.'
  }
  const problem = roleCheck(cfg, roles)

  if (problem !== undefined) {
    return `Not stored, it would break a palette. ${problem}`
  }
  await saveCfg($, { ...cfg, roles })

  return `${role} ${value === 'off' ? 'back to the palette default' : value}. It shows from the next /spskin.`
}

async function cmdCustom($: Dollar, args: string): Promise<string> {
  const cfg = await loadCfg($)
  const w = words(args)

  if (w.length === 0) {
    return `Custom palette: ${cfg.custom === null ? 'none' : JSON.stringify(cfg.custom)}\nUsage: /spcustom hue <0-359> sat <0-40> mode <both|light|dark> accent <#rrggbb|off>, or /spcustom reset. Then /spskin custom applies it, /spexport shares it.`
  }

  if (w[0] === 'reset') {
    await saveCfg($, { ...cfg, custom: null })

    return 'Custom palette removed.'
  }
  const next: Record<string, unknown> = { hue: 210, sat: 18, mode: 'both', ...(cfg.custom ?? {}) }

  for (let i = 0; i < w.length; i += 2) {
    const k = w[i]!
    const v = w[i + 1]

    if (v === undefined || !['hue', 'sat', 'mode', 'accent'].includes(k)) {
      return 'Usage: /spcustom hue <0-359> sat <0-40> mode <both|light|dark> accent <#rrggbb|off>'
    }

    if (k === 'accent') {
      v === 'off' ? delete next.accent : (next.accent = parseColour(v) ?? v)
    } else {
      next[k] = k === 'mode' ? v : Number(v)
    }
  }
  const errors: string[] = []
  const c = parseCustom(next, errors)

  if (c === undefined || c === null) {
    return `Not stored: ${errors.join('; ')}`
  }
  const refused = customCheck(c, cfg.roles)

  if (refused !== undefined) {
    return `Not stored, that would not paint: ${refused}`
  }
  await saveCfg($, { ...cfg, custom: c })

  return `Custom palette stored: ${JSON.stringify(c)}. /spskin custom applies it.`
}

async function cmdExport($: Dollar): Promise<string> {
  const cfg = await loadCfg($)

  return cfg.custom === null
    ? 'No custom palette to export. /spcustom hue 200 sat 20 mode both makes one.'
    : `Your custom palette (paste into /spimport on another machine):\n${exportPalette(cfg.custom)}`
}

const describeImport = (cfg: Cfg, imp: Imported): string =>
  imp.kind === 'palette'
    ? `Palette import:\n  custom: ${JSON.stringify(cfg.custom)} -> ${JSON.stringify(imp.palette)}\n  and it would be applied once with /spskin custom`
    : `Setup import, ${diffCfg(cfg, imp.settings).length} change(s):\n${diffCfg(cfg, imp.settings).join('\n') || '  (identical to what you have)'}`

async function cmdImport($: Dollar, args: string): Promise<string> {
  const text = args.trim()
  const cfg = await loadCfg($)
  const now = await $.clock.now()

  if (text === 'cancel') {
    await $.store.delete('pending')

    return 'Pending import dropped.'
  }

  if (text === 'confirm') {
    const raw = (await $.store.get('pending')) as { text?: unknown; at?: unknown } | undefined

    if (raw === undefined || typeof raw.text !== 'string' || typeof raw.at !== 'number') {
      return 'Nothing pending. /spimport <json> shows a preview first.'
    }
    await $.store.delete('pending')

    if (now - raw.at > PENDING_TTL_MS) {
      return 'The pending import is older than 10 minutes and was dropped. Run /spimport <json> again.'
    }
    const imp = parseImport(raw.text)

    if ('error' in imp) {
      return imp.error
    }

    if (imp.kind === 'palette') {
      const refused = customCheck(imp.palette, cfg.roles)

      if (refused !== undefined) {
        return `Not applied, that palette would not paint: ${refused}`
      }
      const next = { ...cfg, custom: imp.palette }

      await saveCfg($, next)
      const r = await resolveSkin($, next, 'custom', now)

      return typeof r === 'string' ? r : `Imported. ${await applyResolved($, next, r)}`
    }
    const merged: Cfg = { ...cfg, ...imp.settings }
    const problem = roleCheck(merged, merged.roles) ?? (merged.custom === null ? undefined : customCheck(merged.custom, merged.roles))

    if (problem !== undefined) {
      return `Not applied, the imported colours would not paint: ${problem}`
    }
    await saveCfg($, merged)
    await restartTimers($)

    return 'Setup imported. Nothing was recoloured: /spskin <name> applies a look with it.'
  }

  if (text === '') {
    const raw = (await $.store.get('pending')) as { text?: unknown } | undefined
    const imp = typeof raw?.text === 'string' ? parseImport(raw.text) : undefined

    return imp !== undefined && !('error' in imp)
      ? `${describeImport(cfg, imp)}\n/spimport confirm applies it, /spimport cancel drops it.`
      : 'Usage: /spimport <json> (from /spexport or /spshare). It shows what would change; /spimport confirm applies it.'
  }
  const imp = parseImport(text)

  if ('error' in imp) {
    return imp.error
  }
  await $.store.set('pending', { text, at: now })

  return `${describeImport(cfg, imp)}\nNothing changed yet. /spimport confirm applies it (within 10 minutes), /spimport cancel drops it.`
}

async function cmdShare($: Dollar): Promise<string> {
  return `Settings of skins-plus only (no folder paths, no stored accents or profiles):\n${exportSetup(await loadCfg($))}`
}

async function cmdDys($: Dollar, args: string): Promise<string> {
  const cfg = await loadCfg($)
  const v = onOff(words(args)[0])

  if (v === undefined) {
    return `Dyslexia-friendly spacing is ${cfg.dys ? 'on' : 'off'}. /spdys on|off. Used by the pane's preview and, when you apply a look, adds wider letter and line spacing to message text (desktop).`
  }
  await saveCfg($, { ...cfg, dys: v })

  return `Dyslexia-friendly spacing ${v ? 'on' : 'off'}: the pane uses it now; the message type style follows on the next /spskin <name> (or /spskin plain).`
}

async function cmdType($: Dollar, args: string): Promise<string> {
  const cfg = await loadCfg($)
  const raw = words(args)[0]
  const n = raw === undefined ? NaN : Number(raw)

  if (!(n >= 0.8 && n <= 2)) {
    return `Type scale ${cfg.scale}. Usage: /sptype ${SCALES.join('|')} (0.8 to 2). It sizes this mod's pane; it cannot resize the app. When you apply a look the message text size is set through the theme's type style (desktop only).`
  }
  await saveCfg($, { ...cfg, scale: Math.round(n * 100) / 100 })

  return `Type scale ${Math.round(n * 100) / 100}: the pane uses it now; message text follows on the next /spskin <name> (or /spskin plain).`
}

async function cmdDensity($: Dollar, args: string): Promise<string> {
  const cfg = await loadCfg($)
  const v = words(args)[0]

  if (v !== 'compact' && v !== 'normal' && v !== 'airy') {
    return `Density ${cfg.density}. Usage: /spdensity compact|normal|airy`
  }
  await saveCfg($, { ...cfg, density: v })

  return `Density ${v} for this mod's pane. This mod never writes the shared settings; to set it app-wide run:\n/cfg density ${v}`
}

async function cmdReset($: Dollar): Promise<string> {
  for (const key of ['cfg', 'projects', 'profiles', 'pending']) {
    await $.store.delete(key)
  }
  mod.liveTimer?.cancel()
  mod.statusTimer?.cancel()
  mod.liveTimer = undefined
  mod.statusTimer = undefined
  mod.current = null
  mod.lastLive = ''
  mod.lastStatusAt = 0
  mod.branch = undefined

  if (mod.hasStatus) {
    $.ui.status(undefined)
    mod.hasStatus = false
  }
  await bump($)

  return 'skins-plus data cleared (settings, folder accents and profiles, pending import). The theme on screen is left as it is: /look off clears it.'
}

async function runCommand($: Dollar, name: string, args: string): Promise<string> {
  switch (name) {
    case 'sp':
      return HELP
    case 'spskin':
      return cmdSkin($, args)
    case 'spnight':
      return applyByName($, 'night')
    case 'spscheme':
      return cmdScheme($, args)
    case 'spauto':
      return cmdAuto($, args)
    case 'spproject':
      return cmdProject($, args)
    case 'spday':
      return cmdSwitch($, 'day', args, "Today's weekday palette at session start")
    case 'spsun':
      return cmdSwitch($, 'sun', args, 'Sunrise-to-night accent')
    case 'spsched':
      return cmdSched($, args)
    case 'spuse':
      return cmdUse($, args)
    case 'spstatus':
      return cmdStatus($, args)
    case 'sprole':
      return cmdRole($, args)
    case 'spcustom':
      return cmdCustom($, args)
    case 'spexport':
      return cmdExport($)
    case 'spimport':
      return cmdImport($, args)
    case 'spshare':
      return cmdShare($)
    case 'spdys':
      return cmdDys($, args)
    case 'sptype':
      return cmdType($, args)
    case 'spdensity':
      return cmdDensity($, args)
    case 'sppane':
      await $.ui.open({ id: PANE, title: 'Skins plus' }).catch(() => undefined)

      return 'Skins plus pane opened.'
    case 'spreset':
      return cmdReset($)
    default:
      return HELP
  }
}

// ---------------------------------------------------------------- pane

async function paneAction($: Dollar, action: string): Promise<void> {
  const cfg = await loadCfg($)

  if (action.startsWith('skin:')) {
    await applyByName($, action.slice(5))
  } else if (action === 'dys') {
    await saveCfg($, { ...cfg, dys: !cfg.dys })
  } else if (action.startsWith('scale:')) {
    await saveCfg($, { ...cfg, scale: Number(action.slice(6)) })
  } else if (action.startsWith('density:')) {
    await saveCfg($, { ...cfg, density: action.slice(8) as Cfg['density'] })
  }
}

const SAMPLE =
  'Reading is easier with room to breathe. Wider gaps between words and lines keep the eye from skipping ahead, and a shorter line length keeps your place.'

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    mod.cwd = e.cwd

    for (const c of COMMANDS) {
      await $.command.register(c).catch(() => undefined)
    }

    try {
      const cfg = await loadCfg($)
      const candidate = await startupCandidate($, cfg)

      if (candidate !== undefined) {
        await applyCandidate($, cfg, candidate)
      }
      await restartTimers($)
    } catch {
      // A failure here must never stop the session from starting.
    }

    return next(e)
  })

  for (const c of COMMANDS) {
    on('command.run', { command: c.name }, async ($, e) => ({ text: await runCommand($, c.name, e.args) })).catch(() => ({ text: 'skins-plus hit an unexpected error: nothing was changed. /spreset clears its stored data.' }))
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    await read($, rev)
    const cfg = await loadCfg($)
    const pad = padFor(cfg.density)
    const size = paneSize(cfg.scale)
    const today = FIXED[dayId(new Date(await $.clock.now()))]!
    const names = ['cyber', 'night', 'hivis', 'print', today.id]
    const spacing = spacingFor(cfg.dys)
    const preview = spaceText(SAMPLE, spacing)
    const swatch = (def: Def) => {
      const roles = withRoles(def, cfg.roles).roles ?? {}

      return ROLE_NAMES.map(r => {
        const v = roles[r]

        return typeof v === 'string' ? <Text color={v}>●</Text> : <Text dimColor>○</Text>
      })
    }

    return (
      <Box flexDirection="column" padding={pad} gap={pad}>
        <Text size="heading" weight="bold">
          Skins plus
        </Text>
        <Text dimColor size="footnote">
          Opt-in looks. Nothing changes until you press a button or type a command. Applied now: {mod.current ?? 'none'}
        </Text>
        <Box flexDirection="column" gap="xs">
          <Text weight="bold" size={size}>
            Palettes
          </Text>
          {names.map(n => {
            const s = FIXED[n]!

            return (
              <Box key={`row-${n}`} gap="sm" flexWrap="wrap">
                <Button key={`skin-${n}`} label={s.label} onPress={() => paneAction($, `skin:${n}`)} />
                <Box gap="xs">{swatch(s.def)}</Box>
                <Text dimColor size="footnote">
                  {s.blurb}
                </Text>
              </Box>
            )
          })}
          <Text dimColor size="footnote">
            Swatches: accent, danger, success, warning, pro. Last theme call wins when another mod also themes.
          </Text>
        </Box>
        <Box flexDirection="column" gap="xs">
          <Text weight="bold" size={size}>
            Reading
          </Text>
          <Box gap="sm" flexWrap="wrap">
            <Button key="dys" label={cfg.dys ? '[dyslexia spacing: on]' : 'dyslexia spacing: off'} onPress={() => paneAction($, 'dys')} />
            {SCALES.map(s => (
              <Button key={`scale-${s}`} label={cfg.scale === s ? `[x${s}]` : `x${s}`} onPress={() => paneAction($, `scale:${s}`)} />
            ))}
            {(['compact', 'normal', 'airy'] as const).map(d => (
              <Button key={`density-${d}`} label={cfg.density === d ? `[${d}]` : d} onPress={() => paneAction($, `density:${d}`)} />
            ))}
          </Box>
          <Box flexDirection="column">
            {preview.map(line => (
              <Text size={size}>
                {line === '' ? ' ' : line}
              </Text>
            ))}
          </Box>
          <Text dimColor size="footnote">
            Scale and spacing size this pane only. Applying a look (/spskin) also sends them as the message type style on desktop. App-wide density: /cfg density {cfg.density}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor size="footnote">
            Auto {cfg.auto} · weekday {cfg.day ? 'on' : 'off'} · sun {cfg.sun ? 'on' : 'off'} · scheduler {cfg.sched.on ? 'on' : 'off'} ({cfg.sched.rules.length} rules) · status line {cfg.status.on ? 'on' : 'off'} · scheme {cfg.scheme}
          </Text>
          <Text dimColor size="footnote">
            /sp lists every command.
          </Text>
        </Box>
      </Box>
    )
  })
}
