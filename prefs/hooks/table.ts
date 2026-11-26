// The typed table of preferences: DATA only. One preference per line, in a regular form (a script reads this file to
// write the README table, so keep each entry on one line and use plain literals).
//
//   e(key, group, section, default, [values], label, description, isUsedHere)
//   b(key, group, section, default, label, description, isUsedHere)
//   n(key, group, section, default, min, max, step, unit, label, description, isUsedHere)
//
// "isUsedHere" is true when the prefs mod itself acts on the value (its own pane, formatters and commands). Every other
// preference is STORED for other mods to read: nothing changes until a mod reads it. The pane says which is which.
import type { PrefSpec } from './prefs'

export type Group = 'general' | 'formats' | 'interface' | 'notices' | 'charts' | 'data'
export const GROUPS: readonly Group[] = ['general', 'formats', 'interface', 'notices', 'charts', 'data']

const e = (key: string, group: Group, section: string, def: string, values: readonly string[], label: string, description: string, isUsedHere = false): PrefSpec => ({
  key, group, section, type: 'enum', default: def, values, label, description, isUsedHere,
})
const b = (key: string, group: Group, section: string, def: boolean, label: string, description: string, isUsedHere = false): PrefSpec => ({
  key, group, section, type: 'boolean', default: def, label, description, isUsedHere,
})
const n = (key: string, group: Group, section: string, def: number, min: number, max: number, step: number, unit: string, label: string, description: string, isUsedHere = false): PrefSpec => ({
  key, group, section, type: 'number', default: def, min, max, step, unit, label, description, isUsedHere,
})

export const FIXED: readonly PrefSpec[] = [
  // ---- general
  e('level', 'general', 'Detail', 'standard', ['simple', 'standard', 'everything'], 'Detail level', 'How much a mod should show: simple = essentials only, standard = the usual, everything = every hint and number. In this pane it hides or adds description lines.', true),
  e('lang', 'general', 'Language', 'en', ['en', 'es', 'de'], 'Language', 'Language of this mod\'s own pane labels (en, es, de). Other mods may follow it for theirs.', true),
  e('week.start', 'general', 'Calendar', 'mon', ['mon', 'sun', 'sat'], 'First day of the week', 'Which day a week starts on, for weekly totals and calendars.', true),
  e('tz.mode', 'general', 'Calendar', 'local', ['local', 'fixed'], 'Time zone source', 'local = this device\'s zone; fixed = use the offset below.', true),
  n('tz.offset', 'general', 'Calendar', 0, -720, 840, 15, 'min', 'Fixed zone offset', 'Minutes from UTC when the zone source is fixed (60 = UTC+1, -300 = UTC-5).', true),
  e('sync.mode', 'general', 'Scope', 'synced', ['synced', 'per-project'], 'Settings scope', 'synced = one set of values for every project; per-project = project and branch layers (/pfproject) apply on top.', true),
  // ---- formats
  e('money.symbol', 'formats', 'Money', 'usd', ['usd', 'eur', 'gbp', 'jpy', 'chf', 'none'], 'Currency symbol', 'Symbol for money amounts: usd $, eur EUR sign, gbp pound, jpy yen, chf CHF, none = no symbol.', true),
  b('money.cents', 'formats', 'Money', true, 'Show cents', 'On shows 1,234.50; off rounds to whole units (1,235). Idea: show cents or round.', true),
  n('money.rate', 'formats', 'Money', 1, 0.0001, 100000, 0.05, 'x', 'Conversion rate', 'Multiplier applied to a US-dollar amount before showing it (1 = no conversion). Set the exact value with /pfset money.rate 0.92.', true),
  e('time.hours', 'formats', 'Time', '24h', ['12h', '24h'], 'Clock', '12-hour (3:07 PM) or 24-hour (15:07) time.', true),
  e('date.format', 'formats', 'Time', 'iso', ['iso', 'dmy', 'mdy'], 'Date style', 'iso = 2026-11-25, dmy = 25/11/2026, mdy = 11/25/2026.', true),
  e('num.decimal', 'formats', 'Numbers', 'dot', ['dot', 'comma'], 'Decimal separator', 'dot = 1,234.5; comma = 1.234,5. Cannot equal the group separator.', true),
  e('num.group', 'formats', 'Numbers', 'comma', ['comma', 'dot', 'space', 'none'], 'Group separator', 'Thousands separator: comma, dot, space or none. Cannot equal the decimal separator.', true),
  b('num.short', 'formats', 'Numbers', false, 'Short numbers', 'Show 1.2k, 3.4M instead of 1,234 and 3,400,000 where a mod has little room.', true),
  b('tiles.compact', 'formats', 'Numbers', false, 'Compact numbers in tiles', 'Mods that draw tiles or cards should use the short form (1.2k) inside them.', true),
  e('size.units', 'formats', 'Units', 'KB', ['KB', 'KiB'], 'Size units', 'KB = powers of 1000, KiB = powers of 1024.', true),
  n('trunc.len', 'formats', 'Units', 60, 10, 200, 5, 'chars', 'Truncation length', 'Where long text, names and commands are cut with an ellipsis.', true),
  e('path.style', 'formats', 'Units', 'mid', ['short', 'mid', 'full'], 'Path display', 'short = file name only, mid = ~/.../dir/file, full = the whole path.', true),
  // ---- interface
  e('pane.tab.prefs', 'interface', 'Panes', 'general', ['general', 'formats', 'interface', 'notices', 'charts', 'data', 'mods', 'profiles', 'projects', 'history'], 'Default tab: prefs pane', 'The tab this mod\'s pane opens on.', true),
  e('pane.tab.mod-manager', 'interface', 'Panes', 'catalog', ['catalog', 'installed', 'features', 'bundles', 'source', 'log'], 'Default tab: mod-manager pane', 'Stored for the mod manager: it does not read this today.'),
  b('pane.remember', 'interface', 'Panes', false, 'Remember last tab', 'Reopen this mod\'s pane on the tab you used last (needs the prefs.remember-tab switch).', true),
  e('pane.placement', 'interface', 'Panes', 'dock', ['dock', 'float'], 'Dock or float', 'float asks the desktop app for the small widget form when this mod opens its pane; the app decides.', true),
  e('pane.width', 'interface', 'Panes', 'medium', ['narrow', 'medium', 'wide'], 'Pane width', 'Wanted width when this mod opens its pane: narrow 60, medium 80, wide 110 columns (a request, not a grant).', true),
  e('motion.level', 'interface', 'Motion', 'full', ['off', 'subtle', 'full'], 'Motion level', 'off = still, subtle = small movements only, full = everything. The motion mod and /motion are separate: this is only a value for mods built to read it.'),
  n('anim.speed', 'interface', 'Motion', 1, 0.25, 3, 0.25, 'x', 'Animation speed', 'Multiplier for animation speed: 0.5 slower, 2 faster.'),
  b('anim.entrance', 'interface', 'Motion', true, 'Entrance animations', 'Whether things may fade or slide in when they appear.'),
  b('tip.hover', 'interface', 'Tooltips', true, 'Hover tooltips', 'Whether hover tooltips may appear.'),
  n('tip.delay', 'interface', 'Tooltips', 400, 0, 2000, 100, 'ms', 'Tooltip delay', 'Wait before a hover tooltip appears.'),
  // ---- notices
  n('toast.ms', 'notices', 'Toasts', 4000, 1000, 15000, 500, 'ms', 'Toast duration', 'How long a pop-up stays. This mod uses it for its own toasts; other mods may read it.', true),
  e('toast.pos', 'notices', 'Toasts', 'top-right', ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top', 'bottom'], 'Toast position', 'Stored only: the app places toasts, no mod can move them.'),
  n('volume.ui', 'notices', 'Volume', 50, 0, 100, 10, '%', 'Volume: interface sounds', 'Loudness for clicks and small interface sounds.'),
  n('volume.alerts', 'notices', 'Volume', 50, 0, 100, 10, '%', 'Volume: alerts', 'Loudness for alert and warning sounds.'),
  n('volume.ambient', 'notices', 'Volume', 50, 0, 100, 10, '%', 'Volume: ambient', 'Loudness for background and ambient sounds.'),
  n('volume.voice', 'notices', 'Volume', 50, 0, 100, 10, '%', 'Volume: speech', 'Loudness for spoken text.'),
  n('volume.tools', 'notices', 'Volume', 50, 0, 100, 10, '%', 'Volume: tool sounds', 'Loudness for tool-call sounds.'),
  b('notify.errors', 'notices', 'Channels', true, 'Notify: errors', 'May a mod raise a notice when something fails.'),
  b('notify.approvals', 'notices', 'Channels', true, 'Notify: approvals', 'May a mod raise a notice when something waits for you to approve.'),
  b('notify.done', 'notices', 'Channels', true, 'Notify: finished', 'May a mod raise a notice when a long task finishes.'),
  b('notify.budget', 'notices', 'Channels', true, 'Notify: budget and limits', 'May a mod raise a notice about cost or rate limits.'),
  b('notify.updates', 'notices', 'Channels', false, 'Notify: updates', 'May a mod raise a notice about new versions.'),
  b('notify.tips', 'notices', 'Channels', false, 'Notify: tips', 'May a mod raise a notice with a tip.'),
  // ---- charts
  e('chart.type.cost', 'charts', 'Chart type', 'line', ['line', 'bar', 'area'], 'Chart type: cost', 'How a cost-over-time chart should draw.'),
  e('chart.type.context', 'charts', 'Chart type', 'area', ['line', 'bar', 'area'], 'Chart type: context', 'How a context-use chart should draw.'),
  e('chart.type.tokens', 'charts', 'Chart type', 'bar', ['line', 'bar', 'area'], 'Chart type: tokens', 'How a token-count chart should draw.'),
  e('chart.type.tools', 'charts', 'Chart type', 'bar', ['line', 'bar', 'area'], 'Chart type: tool calls', 'How a tool-call chart should draw.'),
  e('chart.type.time', 'charts', 'Chart type', 'line', ['line', 'bar', 'area'], 'Chart type: time', 'How a time-spent chart should draw.'),
  e('chart.range', 'charts', 'Look', '24h', ['1h', '6h', '24h', '7d', '30d'], 'Default time range', 'The range a chart opens on.'),
  b('chart.smooth', 'charts', 'Look', true, 'Smooth lines', 'Curved lines instead of straight segments.'),
  b('chart.grid', 'charts', 'Look', true, 'Grid lines', 'Faint grid lines behind a chart.'),
  b('chart.labels', 'charts', 'Look', false, 'Data labels', 'Print values on the points or bars.'),
  e('chart.legend', 'charts', 'Look', 'bottom', ['top', 'bottom', 'right', 'none'], 'Legend position', 'Where a chart legend goes, or none.'),
  e('chart.ramp', 'charts', 'Look', 'blue', ['blue', 'green', 'warm', 'mono', 'viridis'], 'Heat-map colour ramp', 'The colour ramp for heat maps and calendars.'),
  // ---- data
  n('rows.page', 'data', 'Lists', 20, 5, 100, 5, 'rows', 'Rows per page', 'How many rows a paged list shows.'),
  e('sort.default', 'data', 'Lists', 'newest', ['newest', 'oldest', 'name', 'size', 'value'], 'Default sort order', 'How lists are ordered when you have not chosen.'),
  b('confirm.destructive', 'data', 'Safety', true, 'Confirm before destructive actions', 'Mods that delete, reset or overwrite should ask first. This mod\'s own /pfreset everything always asks.'),
  e('newproject.clear', 'data', 'Safety', 'never', ['never', 'ask', 'always'], 'Clear recorded data in a new project', 'What a recording mod should do with its recorded data when you start in a new project.'),
]

/**
 * Families of preferences, one per mod: `<prefix><mod>` where `<mod>` is any name matching MOD_NAME_RE. The mods listed in
 * modlist.ts get a row each in the pane; any other valid name still works with /pfset (a mod added later).
 */
export type Family = Omit<PrefSpec, 'key' | 'label' | 'description'> & { prefix: string; label: string; description: string }

export const FAMILIES: readonly Family[] = [
  { prefix: 'quiet.', group: 'notices', section: 'Quiet hours', type: 'enum', default: 'off', values: ['off', '22:00-07:00', '23:00-06:00', '21:00-08:00', '00:00-08:00', '12:00-13:00'], label: 'Quiet hours: {mod}', description: 'Hours when {mod} should stay quiet (local time of the zone setting). Only affects a mod that reads it.', isUsedHere: false },
  { prefix: 'record.', group: 'data', section: 'Recording', type: 'boolean', default: true, label: 'Record: {mod}', description: 'Off asks {mod} not to record anything. Only affects a mod that reads it.', isUsedHere: false },
  { prefix: 'retain.', group: 'data', section: 'Retention', type: 'number', default: 30, min: 1, max: 365, step: 1, unit: 'days', label: 'Keep for: {mod}', description: 'Days {mod} should keep what it recorded. Only affects a mod that reads it.', isUsedHere: false },
  { prefix: 'autoopen.', group: 'interface', section: 'Auto-open', type: 'boolean', default: false, label: 'Open at start: {mod}', description: 'Open {mod}\'s main pane when a session starts. Only prefs acts on it (for its own pane, and only with the prefs.auto-open switch on); other mods may read it.', isUsedHere: false },
]

export const MOD_NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/
