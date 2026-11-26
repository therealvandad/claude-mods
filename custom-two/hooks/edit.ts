// The commands that only edit this mod's tables, as pure functions: (config, arguments, context) to a new config and a text.
// register.tsx stores the result. Nothing here touches the engine, the disk or the network.
import type { Config, LogRow } from '../types'
import { curveNames, samples, strip } from './curves'
import {
  BUILTIN_FOCUS,
  COLOUR_KEYS,
  DEFAULT_TEMPLATE,
  CONDITIONS,
  EVENTS,
  EXPORT_FORMATS,
  GUARDS,
  ICON_NAMES,
  LIMITS,
  MOD_RE,
  NAME_RE,
  PACKS,
  PACK_IDS,
  TAB_IDS,
  TIME_RE,
  allTips,
  checkFocusStep,
  checkMacroStep,
  cleanBundle,
  cleanCheck,
  cleanCurve,
  cleanFileColour,
  cleanFilter,
  cleanFont,
  cleanGlyph,
  cleanGreeting,
  cleanKey,
  cleanName,
  cleanRange,
  cleanRule,
  cleanSched,
  cleanSearch,
  cleanTemplate,
  cleanTerm,
  cleanText,
  clip,
  exportRows,
  inWindow,
  minutesOf,
  normalizeHex,
  renderGreeting,
  renderTemplate,
  reportVars,
  schedNow,
  searchRows,
  viewOf,
  pickByDay,
} from './pure'
import type { ExportFormat } from './pure'
import { SOUND_FILES } from './sounds'

export type Ctx = { now: number; hour: number; minutes: number; log: readonly LogRow[]; usd: number; branch: string }
export type Edit = { cfg: Config; text: string; fill?: string }

const same = (cfg: Config, text: string): Edit => ({ cfg, text })

const words = (args: string): string[] => args.trim().split(/\s+/).filter(w => w !== '')
const rest = (args: string, n: number): string => args.trim().split(/\s+/).slice(n).join(' ')
const verb = (args: string): string => (words(args)[0] ?? '').toLowerCase()
const full = (list: readonly unknown[], max: number, what: string): string | null => (list.length >= max ? `That list is full (${max} ${what}). Remove one first.` : null)

const tabHint = `one of ${TAB_IDS.join(', ')}`

// ------------------------------------------------------------------ 126 colours per file type

export const editFile = (cfg: Config, args: string): Edit => {
  const [a = '', b = ''] = words(args)
  const entries = Object.entries(cfg.fileColours)

  if (a === '' || a === 'list') {
    return same(cfg, [`File colours (${entries.length}/${LIMITS.fileColours}): ${entries.map(([e, c]) => `.${e}=${c}`).join('  ') || 'none'}`, `Colours: ${COLOUR_KEYS.join(', ')}. Usage: /cxfile <ext> <colour> | rm <ext> | reset`].join('\n'))
  }

  if (a === 'reset') {
    return same({ ...cfg, fileColours: {} }, 'File colours cleared (no colour for any extension).')
  }

  if (a === 'rm') {
    const e = b.toLowerCase().replace(/^\./, '')

    if (!Object.prototype.hasOwnProperty.call(cfg.fileColours, e)) {
      return same(cfg, `No colour set for .${e}.`)
    }
    const { [e]: _gone, ...left } = cfg.fileColours

    return same({ ...cfg, fileColours: left }, `Removed .${e}.`)
  }
  const row = cleanFileColour(a, b)

  if (row === null) {
    return same(cfg, `Usage: /cxfile <ext> <colour>. The extension is 1-8 letters or digits; colour is one of ${COLOUR_KEYS.join(', ')}.`)
  }

  if (!Object.prototype.hasOwnProperty.call(cfg.fileColours, row[0]) && entries.length >= LIMITS.fileColours) {
    return same(cfg, `That list is full (${LIMITS.fileColours}).`)
  }

  return same({ ...cfg, fileColours: { ...cfg.fileColours, [row[0]]: row[1] } }, `.${row[0]} is now ${row[1]}.`)
}

// ------------------------------------------------------------------ 127 an accent per branch

export const editBranch = (cfg: Config, args: string): Edit => {
  const [a = '', b = ''] = words(args)

  if (a === '' || a === 'list') {
    return same(cfg, [`Branch accents (first match wins): ${cfg.branchRules.map(r => `${r.pattern}=${r.accent}`).join('  ') || 'none'}`, 'Usage: /cxbranch <name or prefix/*> <colour> | rm <pattern> | reset | now (reads the branch)'].join('\n'))
  }

  if (a === 'reset') {
    return same({ ...cfg, branchRules: [] }, 'Branch accents cleared.')
  }

  if (a === 'rm') {
    return cfg.branchRules.some(r => r.pattern === b) ? same({ ...cfg, branchRules: cfg.branchRules.filter(r => r.pattern !== b) }, `Removed ${b}.`) : same(cfg, `No rule for ${b}.`)
  }
  const rule = cleanBranchRuleLocal(a, b)

  if (rule === null) {
    return same(cfg, `Usage: /cxbranch <name, or prefix ending in *> <colour>. Colours: ${COLOUR_KEYS.join(', ')}.`)
  }
  const others = cfg.branchRules.filter(r => r.pattern !== rule.pattern)

  if (others.length >= LIMITS.branchRules) {
    return same(cfg, `That list is full (${LIMITS.branchRules}).`)
  }

  return same({ ...cfg, branchRules: [...others, rule] }, `${rule.pattern} gets ${rule.accent}.`)
}

const cleanBranchRuleLocal = (pattern: string, accent: string) => {
  const ok = /^[A-Za-z0-9._/@+-]{1,60}\*?$/.test(pattern) && (COLOUR_KEYS as readonly string[]).includes(accent)

  return ok ? { pattern, accent } : null
}

// ------------------------------------------------------------------ 128 a sound per event

export const editSound = (cfg: Config, args: string): Edit => {
  const [a = '', b = ''] = words(args)

  if (a === '' || a === 'list') {
    return same(cfg, [`Sounds (play only while custom-two.event-sounds is on): ${EVENTS.map(e => `${e}=${cfg.sounds[e] === '' || cfg.sounds[e] === undefined ? 'off' : cfg.sounds[e]}`).join('  ')}`, `Files in the sounds folder: ${SOUND_FILES.join(', ')}`, 'Usage: /cxsound <turn-end|error|commit> <file|off> | test <event>'].join('\n'))
  }

  if (!(EVENTS as readonly string[]).includes(a)) {
    return same(cfg, `Event is one of ${EVENTS.join(', ')}.`)
  }

  if (b !== 'off' && !SOUND_FILES.includes(b)) {
    return same(cfg, `"${clip(b, 30)}" is not in the sounds folder. Files: ${SOUND_FILES.join(', ')}, or off.`)
  }

  return same({ ...cfg, sounds: { ...cfg.sounds, [a]: b === 'off' ? '' : b } }, `${a} -> ${b}.`)
}

// ------------------------------------------------------------------ 129 greetings, 130 tips

export const greetingNow = (cfg: Config, now: number, hour: number): string => {
  const tpl = pickByDay(cfg.greetTemplates, now)

  return tpl === undefined ? 'No greeting templates stored: /cxgreet add Good {time}, {name}.' : renderGreeting(tpl, hour, cfg.greetName)
}

export const editGreet = (cfg: Config, args: string, ctx: Ctx): Edit => {
  const v = verb(args)

  if (v === '') {
    return same(cfg, greetingNow(cfg, ctx.now, ctx.hour))
  }

  if (v === 'list') {
    return same(cfg, [`Name: ${cfg.greetName === '' ? '(none, says "there")' : cfg.greetName}`, ...cfg.greetTemplates.map((t, i) => `${i + 1}. ${t}`), 'Usage: /cxgreet add <text with {time} {name}> | rm <n> | name <text> | reset'].join('\n'))
  }

  if (v === 'name') {
    const name = cleanName(rest(args, 1))

    return same({ ...cfg, greetName: name }, name === '' ? 'Name cleared.' : `Name is now ${name}.`)
  }

  if (v === 'reset') {
    return same({ ...cfg, greetTemplates: [], greetName: '' }, 'Greetings cleared. /cxgreet add <text> puts new ones in.')
  }

  if (v === 'add') {
    const t = cleanGreeting(rest(args, 1))
    const blocked = full(cfg.greetTemplates, LIMITS.greet, 'templates')

    return t === null ? same(cfg, 'A template is up to 100 characters and may only use {time} and {name}.') : blocked !== null ? same(cfg, blocked) : same({ ...cfg, greetTemplates: [...cfg.greetTemplates, t] }, `Added: ${t}`)
  }

  if (v === 'rm') {
    const n = Number(words(args)[1])

    return Number.isInteger(n) && n >= 1 && n <= cfg.greetTemplates.length ? same({ ...cfg, greetTemplates: cfg.greetTemplates.filter((_, i) => i !== n - 1) }, `Removed ${n}.`) : same(cfg, 'Usage: /cxgreet rm <number from /cxgreet list>')
  }

  return same(cfg, 'Usage: /cxgreet [list | add <text> | rm <n> | name <text> | reset]')
}

export const editTip = (cfg: Config, args: string, ctx: Ctx): Edit => {
  const v = verb(args)
  const all = allTips(cfg)

  if (v === '') {
    const i = cfg.tipCursor % all.length

    return same({ ...cfg, tipCursor: (i + 1) % all.length }, `Tip ${i + 1}/${all.length}: ${all[i]}`)
  }

  if (v === 'list') {
    return same(cfg, [`Built in: ${all.length - cfg.tips.length}. Yours (${cfg.tips.length}/${LIMITS.tips}):`, ...cfg.tips.map((t, i) => `${i + 1}. ${t}`), 'Usage: /cxtip | add <text> | rm <n> | today'].join('\n'))
  }

  if (v === 'today') {
    return same(cfg, `Today's tip: ${pickByDay(all, ctx.now) ?? ''}`)
  }

  if (v === 'add') {
    const t = cleanText(rest(args, 1), 140)
    const blocked = full(cfg.tips, LIMITS.tips, 'tips')

    return t === '' ? same(cfg, 'Usage: /cxtip add <text up to 140 characters>') : blocked !== null ? same(cfg, blocked) : same({ ...cfg, tips: [...cfg.tips, t] }, 'Tip added.')
  }

  if (v === 'rm') {
    const n = Number(words(args)[1])

    return Number.isInteger(n) && n >= 1 && n <= cfg.tips.length ? same({ ...cfg, tips: cfg.tips.filter((_, i) => i !== n - 1) }, `Removed ${n}.`) : same(cfg, 'Usage: /cxtip rm <number from /cxtip list> (built-in tips stay)')
  }

  return same(cfg, 'Usage: /cxtip [list | add <text> | rm <n> | today]')
}

// ------------------------------------------------------------------ 131 empty states, 132 pane titles

const editMessages = (cfg: Config, args: string, key: 'empty' | 'titles', name: string, extra: readonly string[]): Edit => {
  const table = cfg[key]
  const [a = '', b = ''] = words(args)
  const keys = [...extra, ...TAB_IDS]

  if (a === '' || a === 'list') {
    return same(cfg, [`Custom ${name} (${Object.keys(table).length}): ${Object.entries(table).map(([k, v]) => `${k}="${clip(v, 40)}"`).join('  ') || 'none'}`, `Usage: /cx${key === 'empty' ? 'empty' : 'title'} <${keys.join('|')}> <text up to 120 characters> | rm <id> | reset`].join('\n'))
  }

  if (a === 'reset') {
    return same({ ...cfg, [key]: {} }, `Custom ${name} cleared.`)
  }

  if (a === 'rm') {
    if (!Object.prototype.hasOwnProperty.call(table, b)) {
      return same(cfg, `No custom ${name} for "${clip(b, 20)}".`)
    }
    const { [b]: _gone, ...left } = table

    return same({ ...cfg, [key]: left }, `Removed ${b}.`)
  }
  const text = cleanText(rest(args, 1), 120)

  if (!keys.includes(a) || text === '') {
    return same(cfg, `The id is ${tabHint}${extra.length > 0 ? `, or ${extra.join(', ')}` : ''}; then the text.`)
  }

  if (!Object.prototype.hasOwnProperty.call(table, a) && Object.keys(table).length >= LIMITS.titles) {
    return same(cfg, `That list is full (${LIMITS.titles}).`)
  }

  return same({ ...cfg, [key]: { ...table, [a]: text } }, `${a}: "${text}"`)
}

export const editEmpty = (cfg: Config, args: string): Edit => editMessages(cfg, args, 'empty', 'empty-state messages', [])
export const editTitle = (cfg: Config, args: string): Edit => editMessages(cfg, args, 'titles', 'pane titles', ['main'])

// ------------------------------------------------------------------ 133 ranges, 134 filters, 135 searches

export const editRange = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [`Active range: ${cfg.range === '' ? 'none (all rows)' : cfg.range}`, 'Built in: today, week (last 7 days)', ...cfg.ranges.map(r => `  ${r.name}: ${r.start} to ${r.end}`), 'Usage: /cxrange add <name> <YYYY-MM-DD> <YYYY-MM-DD> | rm <name> | use <name|today|week|off>'].join('\n'))
  }

  if (v === 'add') {
    const r = cleanRange({ name: w[1], start: w[2], end: w[3] })
    const others = cfg.ranges.filter(x => x.name !== w[1])

    return r === null
      ? same(cfg, 'Usage: /cxrange add <name> <start YYYY-MM-DD> <end YYYY-MM-DD>. Real dates, start not after end; the name is lower case letters, digits and -.')
      : others.length >= LIMITS.ranges
        ? same(cfg, `That list is full (${LIMITS.ranges}).`)
        : same({ ...cfg, ranges: [...others, r] }, `Range ${r.name}: ${r.start} to ${r.end}. /cxrange use ${r.name} filters the log by it.`)
  }

  if (v === 'rm') {
    const name = w[1] ?? ''

    return cfg.ranges.some(r => r.name === name) ? same({ ...cfg, ranges: cfg.ranges.filter(r => r.name !== name), range: cfg.range === name ? '' : cfg.range }, `Removed ${name}.`) : same(cfg, `No range named ${clip(name, 20)}.`)
  }

  if (v === 'use') {
    const name = (w[1] ?? '').toLowerCase()

    if (name === 'off' || name === '') {
      return same({ ...cfg, range: '' }, 'Range filter off: all rows.')
    }

    return name === 'today' || name === 'week' || cfg.ranges.some(r => r.name === name) ? same({ ...cfg, range: name }, `Range ${name} is active for the Log, Report and export.`) : same(cfg, `No range named ${clip(name, 20)}.`)
  }

  return same(cfg, 'Usage: /cxrange [list | add <name> <start> <end> | rm <name> | use <name|off>]')
}

export const editFilter = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [`Active filter: ${cfg.filter === '' ? 'none' : cfg.filter}`, ...cfg.filters.map(f => `  ${f.name}: ${[f.tool && `tool=${f.tool}`, f.ok && `ok=${f.ok}`, f.ext && `ext=${f.ext}`, f.branch && `branch=${f.branch}`].filter(Boolean).join(' ')}`), 'Usage: /cxfilter save <name> tool=Bash ok=error ext=ts branch=main | rm <name> | use <name|off>'].join('\n'))
  }

  if (v === 'save') {
    const fields: Record<string, string> = { tool: '', ok: '', ext: '', branch: '' }

    for (const pair of w.slice(2)) {
      const [k = '', val = ''] = pair.split('=')

      if (!Object.prototype.hasOwnProperty.call(fields, k)) {
        return same(cfg, `Unknown key "${clip(k, 12)}". Keys: tool, ok, ext, branch.`)
      }
      fields[k] = val
    }
    const f = cleanFilter({ name: w[1], ...fields })
    const others = cfg.filters.filter(x => x.name !== w[1])

    return f === null || (f.tool === '' && f.ok === '' && f.ext === '' && f.branch === '')
      ? same(cfg, 'Usage: /cxfilter save <name> tool=<Tool> ok=ok|error ext=<ext> branch=<branch> (at least one).')
      : others.length >= LIMITS.filters
        ? same(cfg, `That list is full (${LIMITS.filters}).`)
        : same({ ...cfg, filters: [...others, f] }, `Filter ${f.name} saved. /cxfilter use ${f.name} applies it.`)
  }

  if (v === 'rm') {
    const name = w[1] ?? ''

    return cfg.filters.some(f => f.name === name) ? same({ ...cfg, filters: cfg.filters.filter(f => f.name !== name), filter: cfg.filter === name ? '' : cfg.filter }, `Removed ${name}.`) : same(cfg, `No filter named ${clip(name, 20)}.`)
  }

  if (v === 'use') {
    const name = w[1] ?? 'off'

    return name === 'off' ? same({ ...cfg, filter: '' }, 'Filter off.') : cfg.filters.some(f => f.name === name) ? same({ ...cfg, filter: name }, `Filter ${name} is active for the Log, Report and export.`) : same(cfg, `No filter named ${clip(name, 20)}.`)
  }

  return same(cfg, 'Usage: /cxfilter [list | save <name> k=v ... | rm <name> | use <name|off>]')
}

const rowLine = (r: LogRow): string => `${new Date(r.at).toISOString().slice(5, 16).replace('T', ' ')} ${r.ok ? ' ok  ' : 'ERROR'} ${r.tool}${r.detail !== '' ? ` ${r.detail}` : ''}${r.file !== '' ? ` ${r.file}` : ''}${r.commit ? ' (commit)' : ''}`

export const editSearch = (cfg: Config, args: string, ctx: Ctx): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()
  const rows = viewOf(ctx.log, cfg, ctx.now)
  const show = (text: string, label: string): string => {
    const hits = searchRows(rows, text)

    return [`${hits.length} of ${rows.length} rows match "${clip(text, 30)}" (${label}; the log keeps at most ${LIMITS.log}):`, ...hits.slice(-20).map(rowLine)].join('\n')
  }

  if (v === '' || v === 'list') {
    return same(cfg, [`Saved searches (${cfg.searches.length}/${LIMITS.searches}): ${cfg.searches.map(s => `${s.name}="${s.text}"`).join('  ') || 'none'}`, 'Usage: /cxsearch <text> | save <name> <text> | run <name> | rm <name>'].join('\n'))
  }

  if (v === 'save') {
    const s = cleanSearch({ name: w[1], text: rest(args, 2) })
    const others = cfg.searches.filter(x => x.name !== w[1])

    return s === null ? same(cfg, 'Usage: /cxsearch save <name> <text up to 60 characters>') : others.length >= LIMITS.searches ? same(cfg, `That list is full (${LIMITS.searches}).`) : same({ ...cfg, searches: [...others, s] }, `Search ${s.name} saved.`)
  }

  if (v === 'rm') {
    return cfg.searches.some(s => s.name === w[1]) ? same({ ...cfg, searches: cfg.searches.filter(s => s.name !== w[1]) }, `Removed ${w[1]}.`) : same(cfg, 'No search with that name.')
  }

  if (v === 'run') {
    const s = cfg.searches.find(x => x.name === w[1])

    return s === undefined ? same(cfg, 'No search with that name: /cxsearch list') : same(cfg, show(s.text, `saved search ${s.name}`))
  }

  return same(cfg, show(args.trim(), 'ad hoc'))
}

// ------------------------------------------------------------------ 136 report, 137 export

export const editReport = (cfg: Config, args: string, ctx: Ctx): Edit => {
  const v = verb(args)
  const rows = viewOf(ctx.log, cfg, ctx.now)

  if (v === 'set') {
    const t = cleanTemplate(rest(args, 1).replace(/\\n/g, '\n'))

    return t === null ? same(cfg, 'A template is up to 400 characters with only {calls} {errors} {files} {commits} {spend} {range} {filter} {branch} {date} in braces. Type \\n for a new line.') : same({ ...cfg, template: t }, 'Template stored. /cxreport shows it filled in.')
  }

  if (v === 'reset') {
    return same({ ...cfg, template: DEFAULT_TEMPLATE }, 'Template back to the default.')
  }

  if (v === 'template') {
    return same(cfg, `Template: ${cfg.template}`)
  }

  if (cfg.template === '') {
    return same(cfg, 'No template stored: /cxreport set Calls {calls}, errors {errors}')
  }

  return same(cfg, `${renderTemplate(cfg.template, reportVars(rows, cfg, ctx.usd, ctx.branch, ctx.now))}\n(rendered here as text; nothing is written to disk. Spend is the whole session's, the rest is the ${rows.length} rows in view.)`)
}

export const editExport = (cfg: Config, args: string, ctx: Ctx): Edit => {
  const fmt = verb(args)

  if (!(EXPORT_FORMATS as readonly string[]).includes(fmt)) {
    return same(cfg, `Usage: /cxexport ${EXPORT_FORMATS.join('|')}. Prints the rows in view as text; no file is written.`)
  }
  const rows = viewOf(ctx.log, cfg, ctx.now)

  return same(cfg, rows.length === 0 ? 'No rows in view. Turn on custom-two.record, or widen /cxrange and /cxfilter.' : `${rows.length} rows as ${fmt}:\n${exportRows(rows, fmt as ExportFormat, 60)}${rows.length > 60 ? `\n(last 60 of ${rows.length} shown)` : ''}`)
}

// ------------------------------------------------------------------ 138 hotkey map

export const KNOWN_SHORTCUTS: readonly (readonly [string, string])[] = [
  ['esc', 'stop what Claude is doing'],
  ['ctrl+c', 'cancel the current input or turn (twice to exit)'],
  ['ctrl+d', 'exit when the prompt is empty'],
  ['ctrl+l', 'clear the screen (terminal)'],
  ['ctrl+r', 'search prompt history (terminal)'],
  ['shift+tab', 'cycle the permission mode (terminal)'],
  ['ctrl+g', 'edit the prompt in your editor (terminal)'],
  ['up / down', 'walk through earlier prompts'],
  ['/', 'start a slash command'],
  ['@', 'mention a file'],
  ['!', 'run a shell line (terminal)'],
]

export const editKeys = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()
  const entries = Object.entries(cfg.keys)

  if (v === '' || v === 'list') {
    return same(cfg, [`Hotkey map (${entries.length}/${LIMITS.keys}). This mod cannot register keys: a row is text you send to the prompt box with /cxkeys use <key> or its button.`, ...entries.map(([k, t]) => `  ${k.padEnd(14)} ${clip(t, 70)}`), 'Usage: /cxkeys add <key> <prompt text> | rm <key> | use <key> | builtin'].join('\n'))
  }

  if (v === 'builtin') {
    return same(cfg, ['Common Claude Code shortcuts (from memory of the app: they differ by version and surface; /help and your keybindings file are the truth):', ...KNOWN_SHORTCUTS.map(([k, d]) => `  ${k.padEnd(10)} ${d}`)].join('\n'))
  }

  if (v === 'add') {
    const key = cleanKey(w[1])
    const text = cleanText(rest(args, 2), 200)

    return key === null || text === ''
      ? same(cfg, 'Usage: /cxkeys add <key> <prompt text>. A key is up to three of ctrl alt shift cmd, then one letter, digit or f1-f12 (ctrl+1, cmd+shift+k, f5).')
      : !Object.prototype.hasOwnProperty.call(cfg.keys, key) && entries.length >= LIMITS.keys
        ? same(cfg, `That list is full (${LIMITS.keys}).`)
        : same({ ...cfg, keys: { ...cfg.keys, [key]: text } }, `${key}: "${clip(text, 60)}". This mod cannot bind the key itself; /cxkeys use ${key} puts the text in the prompt box.`)
  }
  const key = cleanKey(w[1])

  if (v === 'rm') {
    if (key === null || !Object.prototype.hasOwnProperty.call(cfg.keys, key)) {
      return same(cfg, 'No such key row: /cxkeys list')
    }
    const { [key]: _gone, ...left } = cfg.keys

    return same({ ...cfg, keys: left }, `Removed ${key}.`)
  }

  if (v === 'use') {
    const text = key === null ? undefined : cfg.keys[key]

    return text === undefined ? same(cfg, 'No such key row: /cxkeys list') : { cfg, text: `Put in the prompt box (not sent): ${clip(text, 80)}`, fill: text }
  }

  return same(cfg, 'Usage: /cxkeys [list | add <key> <text> | rm <key> | use <key> | builtin]')
}

// ------------------------------------------------------------------ 139 logo hex (apply is in register), 140 fonts

export const editLogo = (cfg: Config, args: string): Edit => {
  const a = words(args)[0] ?? ''

  if (a === '' || a === 'show') {
    return same(cfg, cfg.logoHex === '' ? 'No logo colour yet: /cxlogo #e8643c previews a palette; /cxlogo apply sets it as the theme (one call, the last mod to set a theme wins).' : `Logo colour ${cfg.logoHex}. /cxlogo apply sets it as the theme; /cxlogo clear forgets it.`)
  }

  if (a === 'clear') {
    return same({ ...cfg, logoHex: '' }, 'Logo colour forgotten (the theme is not touched).')
  }
  const hex = normalizeHex(a)

  return hex === null ? same(cfg, 'Usage: /cxlogo <#rrggbb or #rgb> | apply | clear') : same({ ...cfg, logoHex: hex }, `Logo colour ${hex}: palette preview is in the Theme tab. /cxlogo apply sets the theme.`)
}

export const GENERIC_FONTS = ['sans', 'serif', 'mono', 'code', 'cursive'] as const

export const editFont = (cfg: Config, args: string): Edit => {
  const v = verb(args)

  if (v === '' || v === 'list') {
    return same(cfg, [`Font stack (preview only, ${cfg.fonts.length}/${LIMITS.fonts}): ${cfg.fonts.join(', ') || 'none'}`, `The theme API can set exactly one generic family (${GENERIC_FONTS.join(', ')}), never a named font, and theme.set would replace the current look, so nothing is applied. The Theme tab previews the stack with the viewer's own fonts.`, 'Usage: /cxfont add <family> | rm <family> | clear'].join('\n'))
  }

  if (v === 'clear') {
    return same({ ...cfg, fonts: [] }, 'Font stack cleared.')
  }
  const name = cleanFont(rest(args, 1))

  if (v === 'add') {
    return name === null ? same(cfg, 'A family name is letters, digits, spaces, . _ - (up to 40).') : cfg.fonts.length >= LIMITS.fonts ? same(cfg, `That list is full (${LIMITS.fonts}).`) : same({ ...cfg, fonts: [...cfg.fonts.filter(f => f !== name), name] }, `Added ${name}.`)
  }

  if (v === 'rm') {
    return name !== null && cfg.fonts.includes(name) ? same({ ...cfg, fonts: cfg.fonts.filter(f => f !== name) }, `Removed ${name}.`) : same(cfg, 'Not in the stack.')
  }

  return same(cfg, 'Usage: /cxfont [list | add <family> | rm <family> | clear]')
}

// ------------------------------------------------------------------ 141 icons

export const editIcon = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [`Pack: ${cfg.pack === '' ? "follows /cfg icons" : cfg.pack}. Packs: ${PACK_IDS.map(p => `${p} ${ICON_NAMES.map(n => PACKS[p]?.[n]).join(' ')}`).join(' | ')}`, `Own glyphs: ${Object.entries(cfg.icons).map(([k, g]) => `${k}=${g}`).join('  ') || 'none'}`, `Names: ${ICON_NAMES.join(', ')}. Usage: /cxicon pack <${PACK_IDS.join('|')}|auto> | <name> <glyph> | rm <name> | reset`].join('\n'))
  }

  if (v === 'reset') {
    return same({ ...cfg, icons: {}, pack: '' }, 'Icons back to the settings mod style.')
  }

  if (v === 'pack') {
    const p = (w[1] ?? '').toLowerCase()

    return p === 'auto' ? same({ ...cfg, pack: '' }, 'Icons follow /cfg icons again.') : PACK_IDS.includes(p) ? same({ ...cfg, pack: p }, `Icon pack ${p}.`) : same(cfg, `Packs: ${PACK_IDS.join(', ')}, auto.`)
  }

  if (v === 'rm') {
    const { [w[1] ?? '']: _gone, ...left } = cfg.icons

    return same({ ...cfg, icons: left }, `Own glyph for ${clip(w[1] ?? '', 12)} removed.`)
  }
  const g = cleanGlyph(w[1])

  return (ICON_NAMES as readonly string[]).includes(v) && g !== null ? same({ ...cfg, icons: { ...cfg.icons, [v]: g } }, `${v} is now ${g}.`) : same(cfg, `Usage: /cxicon <${ICON_NAMES.join('|')}> <1-3 characters>`)
}

// ------------------------------------------------------------------ 142 curves

export const editCurve = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = w[0] ?? ''

  if (v === '' || v === 'list') {
    return same(cfg, [`Curve: ${cfg.curve}`, ...curveNames(cfg.curves).map(n => `  ${n.padEnd(15)} ${strip(samples(n, cfg.curves))}`), 'Usage: /cxcurve <name> | add <name> <x1> <y1> <x2> <y2> | rm <name> | demo'].join('\n'))
  }

  if (v === 'add') {
    const c = cleanCurve({ name: w[1], x1: Number(w[2]), y1: Number(w[3]), x2: Number(w[4]), y2: Number(w[5]) })
    const others = cfg.curves.filter(x => x.name !== w[1])

    return c === null
      ? same(cfg, 'Usage: /cxcurve add <name> <x1> <y1> <x2> <y2>: a cubic-bezier like CSS; x1 and x2 from 0 to 1, y1 and y2 from -1 to 2; the name is new and lower case.')
      : others.length >= LIMITS.curves
        ? same(cfg, `That list is full (${LIMITS.curves}).`)
        : same({ ...cfg, curves: [...others, c], curve: c.name }, `Curve ${c.name}: ${strip(samples(c.name, [...others, c]))}`)
  }

  if (v === 'rm') {
    return cfg.curves.some(c => c.name === w[1]) ? same({ ...cfg, curves: cfg.curves.filter(c => c.name !== w[1]), curve: cfg.curve === w[1] ? 'easeOut' : cfg.curve }, `Removed ${w[1]}.`) : same(cfg, 'Only your own curves can be removed.')
  }
  const pick = curveNames(cfg.curves).find(n => n.toLowerCase() === v.toLowerCase())

  return pick === undefined ? same(cfg, `Unknown curve. Names: ${curveNames(cfg.curves).join(', ')}.`) : same({ ...cfg, curve: pick }, `Curve ${pick}: ${strip(samples(pick, cfg.curves))} (12 dots)`)
}

// ------------------------------------------------------------------ 143 schedule

export const editSched = (cfg: Config, args: string, ctx: Ctx): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [...[...cfg.sched].sort((a, b) => minutesOf(a.at) - minutesOf(b.at)).map(s => `  ${s.at}  /${s.via} ${s.look}`), cfg.sched.length === 0 ? '  none' : '', 'Usage: /cxsched add <HH:MM> [skuse|look] <name> | rm <HH:MM> | now. Nothing is ever applied automatically.'].filter(l => l !== '').join('\n'))
  }

  if (v === 'add') {
    const via = w[2] === 'skuse' || w[2] === 'look' ? w[2] : 'skuse'
    const name = w[2] === 'skuse' || w[2] === 'look' ? w[3] : w[2]
    const s = cleanSched({ at: w[1], via, look: name })
    const others = cfg.sched.filter(x => x.at !== w[1])

    return s === null ? same(cfg, 'Usage: /cxsched add <HH:MM, 24 h> [skuse|look] <look name>') : others.length >= LIMITS.sched ? same(cfg, `That list is full (${LIMITS.sched}).`) : same({ ...cfg, sched: [...others, s] }, `${s.at} -> /${s.via} ${s.look}`)
  }

  if (v === 'rm') {
    return cfg.sched.some(s => s.at === w[1]) ? same({ ...cfg, sched: cfg.sched.filter(s => s.at !== w[1]) }, `Removed ${w[1]}.`) : same(cfg, 'No row at that time.')
  }

  if (v === 'now') {
    const s = schedNow(cfg.sched, ctx.minutes)

    return s === undefined ? same(cfg, 'The schedule is empty.') : { cfg, text: `It is ${String(Math.floor(ctx.minutes / 60)).padStart(2, '0')}:${String(ctx.minutes % 60).padStart(2, '0')}; the row in force is ${s.at}. Run this yourself (nothing was applied):\n  /${s.via} ${s.look}`, fill: `/${s.via} ${s.look}` }
  }

  return same(cfg, 'Usage: /cxsched [list | add | rm | now]')
}

// ------------------------------------------------------------------ 144 focus, 150 macros: add / rm / list (run is in register)

const splitSteps = (s: string): string[] => s.split(';').map(x => x.trim()).filter(x => x !== '')

export const editFocus = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [...BUILTIN_FOCUS.map(f => `  ${f.name} (built in): /cfg feature ${f.steps.join(' ; ')}`), ...cfg.focus.map(f => `  ${f.name}: ${f.steps.join(' ; ')}`), 'Usage: /cxfocus <name> runs it | add <name> <mod.id on|off|default> ; ... | rm <name>. A step is <mod>.<id> on|off|default, or quiet, calm, full.'].join('\n'))
  }

  if (v === 'add') {
    const steps = splitSteps(rest(args, 2))
    const checks = steps.map(s => checkFocusStep(s))
    const bad = checks.find(c => !c.ok)
    const name = w[1] ?? ''
    const others = cfg.focus.filter(x => x.name !== name)

    return !NAME_RE.test(name) || BUILTIN_FOCUS.some(b => b.name === name)
      ? same(cfg, 'Pick a new lower-case name (letters, digits, -).')
      : steps.length === 0 || steps.length > LIMITS.focusSteps
        ? same(cfg, `A mode has 1 to ${LIMITS.focusSteps} steps, separated by ;`)
        : bad !== undefined && !bad.ok
          ? same(cfg, `Refused: ${bad.why}.`)
          : others.length >= LIMITS.focus
            ? same(cfg, `That list is full (${LIMITS.focus}).`)
            : same({ ...cfg, focus: [...others, { name, steps: checks.map(c => (c.ok ? c.args.replace(/^feature /, '') : '')) }] }, `Focus mode ${name} stored (${steps.length} steps). /cxfocus ${name} runs it.`)
  }

  if (v === 'rm') {
    return cfg.focus.some(f => f.name === w[1]) ? same({ ...cfg, focus: cfg.focus.filter(f => f.name !== w[1]) }, `Removed ${w[1]}.`) : same(cfg, 'Only your own modes can be removed.')
  }

  return same(cfg, 'Usage: /cxfocus [list | <name> | add <name> <steps> | rm <name>]')
}

export const editMacro = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [...cfg.macros.map(m => `  ${m.name}: ${m.steps.join(' ; ')}`), cfg.macros.length === 0 ? '  none' : '', `Usage: /cxmacro add <name> <cmd> ; <cmd> (up to ${LIMITS.macroSteps}) | run <name> | rm <name> | log. Allowed: cfg (strict shapes), tidy, motion, and own cx* commands (not cxmacro, cxfocus, cxdnd, cxrules, cxreset). Runs stop at the first failure.`].filter(l => l !== '').join('\n'))
  }

  if (v === 'add') {
    const steps = splitSteps(rest(args, 2))
    const checks = steps.map(s => checkMacroStep(s))
    const bad = checks.find(c => !c.ok)
    const name = w[1] ?? ''
    const others = cfg.macros.filter(x => x.name !== name)

    return !NAME_RE.test(name)
      ? same(cfg, 'Pick a lower-case name (letters, digits, -).')
      : steps.length === 0 || steps.length > LIMITS.macroSteps
        ? same(cfg, `A macro has 1 to ${LIMITS.macroSteps} steps, separated by ;`)
        : bad !== undefined && !bad.ok
          ? same(cfg, `Refused: ${bad.why}.`)
          : others.length >= LIMITS.macros
            ? same(cfg, `That list is full (${LIMITS.macros}).`)
            : same({ ...cfg, macros: [...others, { name, steps: checks.map(c => (c.ok ? c.line : '')) }] }, `Macro ${name} stored (${steps.length} steps). /cxmacro run ${name} runs it.`)
  }

  if (v === 'rm') {
    return cfg.macros.some(m => m.name === w[1]) ? same({ ...cfg, macros: cfg.macros.filter(m => m.name !== w[1]) }, `Removed ${w[1]}.`) : same(cfg, 'No macro with that name.')
  }

  return same(cfg, 'Usage: /cxmacro [list | add | run | rm | log]')
}

// ------------------------------------------------------------------ 145 dnd settings (on/off is in register)

export const editDnd = (cfg: Config, args: string, ctx: Ctx): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()
  const d = cfg.dnd

  if (v === 'from' || v === 'to') {
    return TIME_RE.test(w[1] ?? '') ? same({ ...cfg, dnd: { ...d, [v]: w[1] } }, `Do-not-disturb ${v} ${w[1]}.`) : same(cfg, `Usage: /cxdnd ${v} <HH:MM, 24 h>`)
  }

  return same(
    cfg,
    [
      `Do-not-disturb is ${d.on ? 'on' : 'off'}: from ${d.from} to ${d.to}${inWindow(ctx.minutes, d.from, d.to) ? ' (inside the window now)' : ''}. ${d.applied ? 'This mod applied "quiet" and will apply "full" when the window ends.' : 'Nothing applied by this mod right now.'}`,
      'While on, every 5 minutes: entering the window runs /cfg feature quiet, leaving it runs /cfg feature full. Note: full clears ALL your feature switch overrides, not only the ones quiet changed.',
      `The safety mods (${GUARDS.slice(0, 3).join(', ')}) can never be muted: the settings mod refuses it. Usage: /cxdnd on | off | from <HH:MM> | to <HH:MM>`,
    ].join('\n'),
  )
}

// ------------------------------------------------------------------ 146 rules (apply / restore is in register)

export const editRules = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [...cfg.rules.map((r, i) => `  ${i + 1}. hide ${r.mod} while ${r.cond}${cfg.hidden.includes(r.mod) ? '  (hidden now)' : ''}`), cfg.rules.length === 0 ? '  none' : '', `Usage: /cxrules add <mod> <${CONDITIONS.join('|')}> | rm <n> | check | clear. Rules act only while custom-two.hide-rules is on; they run /cfg feature <mod>.band off and on.`].filter(l => l !== '').join('\n'))
  }

  if (v === 'add') {
    const mod = (w[1] ?? '').replace(/^hide$/, '')
    const r = cleanRule({ mod, cond: w[2] === 'while' ? w[3] : w[2] })

    return r === null
      ? same(cfg, `Usage: /cxrules add <mod> <${CONDITIONS.join('|')}>. The mod is a plugin folder name (not ${GUARDS.join(', ')}: their rows are never hidden).`)
      : cfg.rules.length >= LIMITS.rules
        ? same(cfg, `That list is full (${LIMITS.rules}).`)
        : cfg.rules.some(x => x.mod === r.mod && x.cond === r.cond)
          ? same(cfg, 'That rule exists.')
          : same({ ...cfg, rules: [...cfg.rules, r] }, `Rule: hide ${r.mod} while ${r.cond}. Needs /cfg feature custom-two.hide-rules on.`)
  }

  if (v === 'rm') {
    const n = Number(w[1])

    return Number.isInteger(n) && n >= 1 && n <= cfg.rules.length ? same({ ...cfg, rules: cfg.rules.filter((_, i) => i !== n - 1) }, `Removed rule ${n}. Run /cxrules check to restore a row that is no longer wanted hidden.`) : same(cfg, 'Usage: /cxrules rm <number>')
  }

  return same(cfg, 'Usage: /cxrules [list | add <mod> <cond> | rm <n> | check | clear]')
}

// ------------------------------------------------------------------ 147 bundles, 148 checklist, 149 glossary

export const bundleLines = (b: { name: string; mods: string[] }): string[] => {
  const guards = b.mods.filter(m => GUARDS.includes(m))

  return [
    `Bundle ${b.name} (${b.mods.length} mods). These lines are for you to run in a terminal; this mod never runs them.`,
    '# switch the bundle on',
    ...b.mods.map(m => `claude plugin enable ${m}`),
    '# switch the bundle off',
    ...b.mods.filter(m => !GUARDS.includes(m)).map(m => `claude plugin disable ${m}`),
    ...(guards.length > 0 ? [`# not listed for disable: ${guards.join(', ')} (safety mods: keep them on)`] : []),
  ]
}

export const editBundle = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [...cfg.bundles.map(b => `  ${b.name}: ${b.mods.join(', ')}`), cfg.bundles.length === 0 ? '  none' : '', 'Usage: /cxbundle add <name> <mod,mod,...> | rm <name> | show <name>'].filter(l => l !== '').join('\n'))
  }

  if (v === 'add') {
    const b = cleanBundle({ name: w[1], mods: rest(args, 2).split(/[\s,]+/).filter(m => m !== '') })
    const others = cfg.bundles.filter(x => x.name !== w[1])
    const raw = rest(args, 2).split(/[\s,]+/).filter(m => m !== '')

    return b === null || raw.some(m => !MOD_RE.test(m))
      ? same(cfg, 'Usage: /cxbundle add <name> <mod,mod,...>: mod names are lower case letters, digits and -.')
      : others.length >= LIMITS.bundles
        ? same(cfg, `That list is full (${LIMITS.bundles}).`)
        : same({ ...cfg, bundles: [...others, b] }, `Bundle ${b.name}: ${b.mods.length} mods. /cxbundle show ${b.name} prints the enable and disable lines.`)
  }

  if (v === 'rm') {
    return cfg.bundles.some(b => b.name === w[1]) ? same({ ...cfg, bundles: cfg.bundles.filter(b => b.name !== w[1]) }, `Removed ${w[1]}.`) : same(cfg, 'No bundle with that name.')
  }

  if (v === 'show') {
    const b = cfg.bundles.find(x => x.name === w[1])

    return b === undefined ? same(cfg, 'No bundle with that name: /cxbundle list') : same(cfg, bundleLines(b).join('\n'))
  }

  return same(cfg, 'Usage: /cxbundle [list | add | rm | show]')
}

export const STARTER_STEPS: readonly string[] = ['Pick an accent: /cfg accent claude', 'Choose an icon pack: /cxicon pack minimal', 'Save a date range: /cxrange add sprint 2026-11-24 2026-12-05', 'Turn on recording: /cfg feature custom-two.record on', 'Try a macro: /cxmacro add calm-down motion off ; cfg feature quiet']

export const editCheck = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()
  const n = Number(w[1])
  const ok = Number.isInteger(n) && n >= 1 && n <= cfg.checklist.length

  if (v === '' || v === 'list') {
    const done = cfg.checklist.filter(c => c.done).length

    return same(cfg, [`Checklist ${done}/${cfg.checklist.length}`, ...cfg.checklist.map((c, i) => `  ${i + 1}. [${c.done ? 'x' : ' '}] ${c.text}`), 'Usage: /cxcheck add <text> | tick <n> | untick <n> | rm <n> | clear-ticks | starter'].join('\n'))
  }

  if (v === 'add') {
    const c = cleanCheck({ text: rest(args, 1) })

    return c === null ? same(cfg, 'Usage: /cxcheck add <text up to 100 characters>') : cfg.checklist.length >= LIMITS.checklist ? same(cfg, `That list is full (${LIMITS.checklist}).`) : same({ ...cfg, checklist: [...cfg.checklist, c] }, `Step ${cfg.checklist.length + 1} added.`)
  }

  if (v === 'starter') {
    const room = LIMITS.checklist - cfg.checklist.length
    const add = STARTER_STEPS.filter(s => !cfg.checklist.some(c => c.text === s)).slice(0, Math.max(0, room)).map(text => ({ text, done: false }))

    return same({ ...cfg, checklist: [...cfg.checklist, ...add] }, `${add.length} starter steps added.`)
  }

  if (v === 'clear-ticks') {
    return same({ ...cfg, checklist: cfg.checklist.map(c => ({ ...c, done: false })) }, 'All ticks cleared.')
  }

  if (!ok) {
    return same(cfg, 'Usage: /cxcheck tick|untick|rm <number from /cxcheck list>')
  }

  if (v === 'tick' || v === 'untick') {
    return same({ ...cfg, checklist: cfg.checklist.map((c, i) => (i === n - 1 ? { ...c, done: v === 'tick' } : c)) }, `Step ${n} ${v === 'tick' ? 'ticked' : 'unticked'}.`)
  }

  return v === 'rm' ? same({ ...cfg, checklist: cfg.checklist.filter((_, i) => i !== n - 1) }, `Removed step ${n}.`) : same(cfg, 'Usage: /cxcheck [list | add | tick | untick | rm | clear-ticks | starter]')
}

export const findTerms = (cfg: Config, text: string): { term: string; meaning: string }[] => {
  const q = text.trim().toLowerCase()

  return q === '' ? [] : cfg.glossary.filter(g => g.term.toLowerCase().includes(q) || g.meaning.toLowerCase().includes(q))
}

export const editGloss = (cfg: Config, args: string): Edit => {
  const w = words(args)
  const v = (w[0] ?? '').toLowerCase()

  if (v === '' || v === 'list') {
    return same(cfg, [`Glossary (${cfg.glossary.length}/${LIMITS.glossary})`, ...cfg.glossary.slice(0, 30).map(g => `  ${g.term}: ${clip(g.meaning, 80)}`), cfg.glossary.length > 30 ? `  ... ${cfg.glossary.length - 30} more: /cxgloss find <text>` : '', 'Usage: /cxgloss add <term> = <meaning> | rm <term> | find <text>'].filter(l => l !== '').join('\n'))
  }

  if (v === 'add') {
    const body = rest(args, 1)
    const i = body.indexOf('=')
    const t = i < 0 ? null : cleanTerm({ term: body.slice(0, i), meaning: body.slice(i + 1) })
    const others = t === null ? cfg.glossary : cfg.glossary.filter(g => g.term.toLowerCase() !== t.term.toLowerCase())

    return t === null ? same(cfg, 'Usage: /cxgloss add <term> = <meaning> (term up to 40, meaning up to 200 characters)') : others.length >= LIMITS.glossary ? same(cfg, `That list is full (${LIMITS.glossary}).`) : same({ ...cfg, glossary: [...others, t] }, `${t.term}: stored.`)
  }

  if (v === 'rm') {
    const term = rest(args, 1).toLowerCase()

    return cfg.glossary.some(g => g.term.toLowerCase() === term) ? same({ ...cfg, glossary: cfg.glossary.filter(g => g.term.toLowerCase() !== term) }, 'Removed.') : same(cfg, 'No such term.')
  }

  if (v === 'find') {
    const hits = findTerms(cfg, rest(args, 1))

    return same(cfg, hits.length === 0 ? 'No term or meaning matches.' : hits.slice(0, 15).map(g => `${g.term}: ${g.meaning}`).join('\n'))
  }

  return same(cfg, 'Usage: /cxgloss [list | add <term> = <meaning> | rm <term> | find <text>]')
}
