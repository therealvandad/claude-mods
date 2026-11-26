# prefs

A second set of shared preferences for the mods, **distinct from `settings`** (which owns accent, density, icons, calm and the
feature switches and is never edited here). `prefs` owns formats (money, time, dates, numbers, sizes, paths, truncation),
language, time zone, toast and sound levels, chart styles, list and data policies, and per-mod tables (quiet hours, recording,
retention, auto-open). Everything is stored as one atom of **overrides** that other mods can read.

## Honest scope: read this first

A preference only changes what a mod **reads** it. Today only `prefs` itself and mods built after it read these values; every
mod that was built earlier ignores them. The Preferences pane says so in its top line and marks each preference either
**used by prefs** (this mod acts on it: its own pane, helpers and commands) or **stored for other mods**.

Things that are stored only, because the app does not let a mod do more: `toast.pos` (the app places toasts), `motion.level`
(the separate `motion` mod and `/motion` own reduced motion; this is only a value for mods built to read it), volumes, quiet
hours, notification channels, recording and retention (they bind only a mod that reads them), `pane.tab.mod-manager` (the mod
manager does not read it today), chart styles (the app cannot restyle other mods' charts; the pane draws a **preview**).

## How another mod reads the preferences

1. Add `"dependencies": ["prefs"]` to your `plugin.json` (with `settings`/`motion` as needed). A dependency makes
   `plugin validate` skip type-checking, so also type-check a scratch copy with the dependency removed and a shim (below).
2. Declare the atom at module top. The shape tag **`prefs-1`** is required. **Never write it**; only `prefs` does.

```ts
import { atom, read } from 'claude-code'

// ONLY the overrides: a key that is absent means that preference's default.
const prefs = atom({ plugin: 'prefs', key: 'prefs' } as const, {}, { shape: 'prefs-1' })

// In a hook ($ is the one passed to a top-level function, as always):
const p = (await read($, prefs)) as Record<string, string | number | boolean>
const lang = typeof p['lang'] === 'string' ? p['lang'] : 'en'          // default 'en'
const cents = typeof p['money.cents'] === 'boolean' ? p['money.cents'] : true // default on
const toastMs = typeof p['toast.ms'] === 'number' ? p['toast.ms'] : 4000      // default 4000
```

A tiny helper that copes with the atom never having been written and with a wrong type (what you should do, since the value
comes from a store a person can import into):

```ts
const pref = <T extends string | number | boolean>(p: Record<string, unknown>, key: string, dflt: T): T =>
  typeof p[key] === typeof dflt ? (p[key] as T) : dflt
// pref(p, 'money.symbol', 'usd')  pref(p, 'tip.delay', 400)  pref(p, 'anim.entrance', true)
```

3. Type shim for your scratch type-check (the real package declares it for you through `prefs/types/index.d.ts`):

```ts
declare module 'claude-code' {
  interface PluginState {
    prefs: { prefs: Shaped<Record<string, string | number | boolean>> }
  }
}
```

4. Your mod must work with the defaults when the atom has never been written (the `{}` initial value does that).

What the atom holds: the **global** overrides, with the **project** layer and then the **branch** layer stacked on top when
`sync.mode` is `per-project` (see below). Values are validated when stored: known key, exact type, in range, not equal to the
default (a value equal to the default is removed). Only a typed `string`, `number` or `boolean` ever appears.

### Per-mod keys

`quiet.<mod>`, `record.<mod>`, `retain.<mod>` and `autoopen.<mod>` exist for every mod name (lowercase letters, digits, dashes).
The mods that existed when `prefs` was built have a row in the pane; any other valid name still works with `/pfset`. To read
your own: `pref(p, 'quiet.<your-mod>', 'off')`, `pref(p, 'record.<your-mod>', true)`, `pref(p, 'retain.<your-mod>', 30)`.

- `quiet.<mod>`: `off` or one of `22:00-07:00`, `23:00-06:00`, `21:00-08:00`, `00:00-08:00`, `12:00-13:00` (local time of the
  zone setting; a window may wrap midnight). Copy `isQuiet` from `hooks/format.ts`.
- `record.<mod>`: `false` means "do not record anything". `retain.<mod>`: days to keep what you recorded (1 to 365).
- `autoopen.<mod>`: open that mod's main pane at session start. `prefs` acts on `autoopen.prefs` only (with the
  `prefs.auto-open` switch on); for any other mod it is a value to read. Opening another mod's pane is that mod's own call.

### The master level, `level`

`simple`: essentials only (fewer rows, no tips, no secondary numbers). `standard`: the usual, the default. `everything`: every
hint, number and secondary detail. In the prefs pane it hides descriptions (`simple`) or adds keys, defaults and ranges
(`everything`). For other mods it is advice they choose to follow.

### Formatting helpers (copy what you need)

Mods cannot import each other's code, so the pure helpers live in `hooks/format.ts` as plain functions with no engine calls,
each with exhaustive tests in `hooks/format.test.ts`. Copy the file (or the functions you need) into your mod:

| function | what it does |
| --- | --- |
| `ctxFrom(overrides, nowMs)` | builds the context from the atom's overrides |
| `formatMoney(usd, ctx, { tile })` | symbol, cents or whole units, conversion rate, `-$0.50`, short form in tiles |
| `formatNumber(n, ctx, decimals)`, `shortNumber(n, ctx)`, `formatCount` | decimal and group separators, `1.2k` / `1.3M` / `999.95 -> 1k` carry |
| `formatTime`, `formatDate`, `formatDateTime` | 12/24 h; iso `2026-11-25`, dmy `25/11/2026`, mdy `11/25/2026`; in the chosen zone |
| `relativeTime(ms, now)` | `just now`, `5 min ago`, `in 3 h`, `2 mo ago` |
| `formatSize(bytes, ctx)` | `1.5 KB` or `1.5 KiB`, with carry (`999 999 -> 1 MB`) |
| `displayPath(path, style, home)` | `short` file name, `mid` `~/.../dir/file`, `full` |
| `truncate(text, len)` | cuts at `len` characters including the ellipsis, never splits an emoji |
| `weekOrder`, `startOfWeek`, `weekdayOf` | first day of the week and zone aware weeks |
| `parseQuiet`, `isQuiet`, `minutesOfDay` | quiet-hours windows |
| `zoneOffsetFor`, `zoneLabel` | `tz.mode` / `tz.offset` or the device zone; `UTC+01:00` |

## The pane `prefs-main` (open with `/pf`)

Ten tabs: General, Formats, Interface, Notices, Charts, Data, **Mods**, **Profiles**, **Projects**, **History**. Each
preference is a row with a button per allowed value (enum), a toggle (boolean) or `--` `-` value `+` `++` (number; `++` is ten
steps). A `*` marks a value changed from default and a small button resets it. Formats rows show a **live preview** made by the
helpers; each group tab ends with a PREVIEW box (on the Charts tab a vector chart preview on the desktop app, a text sketch
elsewhere). A search box finds preferences across every tab (on the Mods tab it filters the mod list). The header counts
"N changed from default". Pane labels are available in English, Spanish and German (`lang`); the preference names and
descriptions stay English.

- **Mods tab**: a searchable list of mods from a build-time table (a snapshot made when `prefs` was built). Pick a mod to see
  its switches (`toasts`, `sounds`, `status`, `band` and its own); a switch button **puts the `/cfg feature <mod>.<id> on|off`
  line in the prompt box**. Nothing changes until you press Enter. The guard mods (`tool-guard`, `safety-pro`, `controls`) and
  `settings` are shown as always on.
- **Profiles tab**: use, delete and save profiles, and the time-of-day schedule.
- **Projects tab**: scope mode, the target the pane edits (global, this project, this branch), and the layers.
- **History tab**: the last 30 changes and a button to undo the last.

## Commands

| command | what it does |
| --- | --- |
| `/pf` | help (one line per command) and opens the pane |
| `/pfset <key> <value>` | set one preference (a key with no value shows what it accepts) |
| `/pfget [key or words]` | one preference, a summary of what changed, or a search |
| `/pfreset [key]` | back to default: one key, or all (undoable); `/pfreset history`; `/pfreset everything confirm` clears all prefs data |
| `/pfexport` | shows your global preferences as a JSON block. Never written to a file |
| `/pfimport <json>` | strict check, then a diff; **nothing is applied** until `/pfimport confirm` (typed by you, within 5 minutes); `/pfimport cancel` |
| `/pfundo [n\|list]` | undo the last change (or `n`, up to 30); `list` shows them |
| `/pfproject [show\|set\|unset\|clear\|refresh\|branch ...]` | per-project and per-branch layers |
| `/pfprofile save <name>\|use <name>\|list\|del <name>` | named bundles |
| `/pfauto on\|off\|status\|add HH:MM <profile>\|rm HH:MM\|clear` | profile by time of day (default off) |
| `/pfmods [words]` | the searchable mod list in text, and the Mods tab |

## Layers: global, project, branch (`sync.mode`)

`sync.mode` is `synced` by default: one set of values for every project, and the project and branch layers are stored but **not
in force**. Set `per-project` and the atom becomes: global overrides, then the project layer (keyed by the working folder), then
the branch layer (keyed by folder and git branch). A layer can hold a value equal to the default (to override a changed global
value). `sync.mode` itself is always global. At most 30 projects and 30 branches are kept (the oldest drop first).

The branch is read with one fixed read-only command, `git rev-parse --abbrev-ref HEAD` through `$.process.run`, only when the
`prefs.branch-overrides` switch is on, at session start (and only in per-project scope) and on `/pfproject refresh`. The folder
is the session's own; a detached HEAD or an odd name is ignored. If the folder or branch changes later in a session, run
`/pfproject refresh`.

## Profiles and the schedule

A profile is a bundle of **everything except your locale settings** (language, week start, time zone, money, date, time,
number and unit settings, and the scope mode). `work`, `home` and `demo` are built in; you can save up to 12 of your own.
**Using a profile replaces your other global values** with the bundle (your locale settings stay), as one history entry, so
`/pfundo` reverts it. `/pfprofile list` marks the one in use, or "last used, since changed".

The schedule (`/pfauto add 09:00 work`, up to 6 entries, 24-hour time in the zone setting) applies a profile **once when its slot
begins**; your edits afterwards stay until the next slot. It runs only when **both** `/pfauto on` **and** the
`prefs.auto-profile` switch are on, both default off. It is checked at session start and then every 30 minutes, and the timer
is not started at all while either is off (after turning the switch on later, run `/pfauto on` again or restart).

## Switches (`features.json`)

Change with `/cfg feature prefs.<id> on|off`. Everything proactive is off by default.

| switch | default | what it covers |
| --- | --- | --- |
| `prefs.auto-open` | off | open the Preferences pane at start when `autoopen.prefs` is on |
| `prefs.auto-profile` | off | the time-of-day schedule (also needs `/pfauto on`) |
| `prefs.auto-toast` | off | one short toast when the schedule switches a profile (at most one per 3 minutes) |
| `prefs.remember-tab` | on | remember the last tab (only when `pane.remember` is on, which defaults off) |
| `prefs.history` | on | record the last 30 changes so `/pfundo` works |
| `prefs.project-overrides` | on | use the project layer in per-project scope |
| `prefs.branch-overrides` | off | read the git branch so a branch layer can apply |

`prefs` also gets the four universal switches (`prefs.toasts`, `.sounds`, `.status`, `.band`); it writes no status line, plays
no sound and draws no band.

## Storage and limits

Store keys: `pf.base`, `pf.layers`, `pf.history`, `pf.profiles`, `pf.auto`, `pf.meta` (JSON only). Every stored value is
validated again at session start (known keys, exact types, ranges); garbage becomes the defaults, never an error. At most 250
overrides per layer, 30 history entries, 12 profiles, 6 schedule slots, 30 projects and 30 branches, 20 000 characters per
import. Nothing is written to files, nothing is sent over the network, no shell command runs except the one `git` call above.
`/pfreset everything confirm` clears all of it.

## Preferences

All keys, their defaults and what they accept. Per-mod families follow the table. "Used by prefs?": yes means this mod acts on it.

### General

| key | default | accepts | used by prefs? | meaning |
| --- | --- | --- | --- | --- |
| `level` | `standard` | one of simple, standard, everything | yes | How much a mod should show: simple = essentials only, standard = the usual, everything = every hint and number. In this pane it hides or adds description lines. |
| `lang` | `en` | one of en, es, de | yes | Language of this mod's own pane labels (en, es, de). Other mods may follow it for theirs. |
| `week.start` | `mon` | one of mon, sun, sat | yes | Which day a week starts on, for weekly totals and calendars. |
| `tz.mode` | `local` | one of local, fixed | yes | local = this device's zone; fixed = use the offset below. |
| `tz.offset` | `0 min` | number -720 to 840 min (step 15) | yes | Minutes from UTC when the zone source is fixed (60 = UTC+1, -300 = UTC-5). |
| `sync.mode` | `synced` | one of synced, per-project | yes | synced = one set of values for every project; per-project = project and branch layers (/pfproject) apply on top. |

### Formats

| key | default | accepts | used by prefs? | meaning |
| --- | --- | --- | --- | --- |
| `money.symbol` | `usd` | one of usd, eur, gbp, jpy, chf, none | yes | Symbol for money amounts: usd $, eur EUR sign, gbp pound, jpy yen, chf CHF, none = no symbol. |
| `money.cents` | `on` | on/off (true/false) | yes | On shows 1,234.50; off rounds to whole units (1,235). Idea: show cents or round. |
| `money.rate` | `1 x` | number 0.0001 to 100000 x (step 0.05) | yes | Multiplier applied to a US-dollar amount before showing it (1 = no conversion). Set the exact value with /pfset money.rate 0.92. |
| `time.hours` | `24h` | one of 12h, 24h | yes | 12-hour (3:07 PM) or 24-hour (15:07) time. |
| `date.format` | `iso` | one of iso, dmy, mdy | yes | iso = 2026-11-25, dmy = 25/11/2026, mdy = 11/25/2026. |
| `num.decimal` | `dot` | one of dot, comma | yes | dot = 1,234.5; comma = 1.234,5. Cannot equal the group separator. |
| `num.group` | `comma` | one of comma, dot, space, none | yes | Thousands separator: comma, dot, space or none. Cannot equal the decimal separator. |
| `num.short` | `off` | on/off (true/false) | yes | Show 1.2k, 3.4M instead of 1,234 and 3,400,000 where a mod has little room. |
| `tiles.compact` | `off` | on/off (true/false) | yes | Mods that draw tiles or cards should use the short form (1.2k) inside them. |
| `size.units` | `KB` | one of KB, KiB | yes | KB = powers of 1000, KiB = powers of 1024. |
| `trunc.len` | `60 chars` | number 10 to 200 chars (step 5) | yes | Where long text, names and commands are cut with an ellipsis. |
| `path.style` | `mid` | one of short, mid, full | yes | short = file name only, mid = ~/.../dir/file, full = the whole path. |

### Interface

| key | default | accepts | used by prefs? | meaning |
| --- | --- | --- | --- | --- |
| `pane.tab.prefs` | `general` | one of general, formats, interface, notices, charts, data, mods, profiles, projects, history | yes | The tab this mod's pane opens on. |
| `pane.tab.mod-manager` | `catalog` | one of catalog, installed, features, bundles, source, log | no, stored | Stored for the mod manager: it does not read this today. |
| `pane.remember` | `off` | on/off (true/false) | yes | Reopen this mod's pane on the tab you used last (needs the prefs.remember-tab switch). |
| `pane.placement` | `dock` | one of dock, float | yes | float asks the desktop app for the small widget form when this mod opens its pane; the app decides. |
| `pane.width` | `medium` | one of narrow, medium, wide | yes | Wanted width when this mod opens its pane: narrow 60, medium 80, wide 110 columns (a request, not a grant). |
| `motion.level` | `full` | one of off, subtle, full | no, stored | off = still, subtle = small movements only, full = everything. The motion mod and /motion are separate: this is only a value for mods built to read it. |
| `anim.speed` | `1 x` | number 0.25 to 3 x (step 0.25) | no, stored | Multiplier for animation speed: 0.5 slower, 2 faster. |
| `anim.entrance` | `on` | on/off (true/false) | no, stored | Whether things may fade or slide in when they appear. |
| `tip.hover` | `on` | on/off (true/false) | no, stored | Whether hover tooltips may appear. |
| `tip.delay` | `400 ms` | number 0 to 2000 ms (step 100) | no, stored | Wait before a hover tooltip appears. |

### Notices

| key | default | accepts | used by prefs? | meaning |
| --- | --- | --- | --- | --- |
| `toast.ms` | `4000 ms` | number 1000 to 15000 ms (step 500) | yes | How long a pop-up stays. This mod uses it for its own toasts; other mods may read it. |
| `toast.pos` | `top-right` | one of top-right, top-left, bottom-right, bottom-left, top, bottom | no, stored | Stored only: the app places toasts, no mod can move them. |
| `volume.ui` | `50 %` | number 0 to 100 % (step 10) | no, stored | Loudness for clicks and small interface sounds. |
| `volume.alerts` | `50 %` | number 0 to 100 % (step 10) | no, stored | Loudness for alert and warning sounds. |
| `volume.ambient` | `50 %` | number 0 to 100 % (step 10) | no, stored | Loudness for background and ambient sounds. |
| `volume.voice` | `50 %` | number 0 to 100 % (step 10) | no, stored | Loudness for spoken text. |
| `volume.tools` | `50 %` | number 0 to 100 % (step 10) | no, stored | Loudness for tool-call sounds. |
| `notify.errors` | `on` | on/off (true/false) | no, stored | May a mod raise a notice when something fails. |
| `notify.approvals` | `on` | on/off (true/false) | no, stored | May a mod raise a notice when something waits for you to approve. |
| `notify.done` | `on` | on/off (true/false) | no, stored | May a mod raise a notice when a long task finishes. |
| `notify.budget` | `on` | on/off (true/false) | no, stored | May a mod raise a notice about cost or rate limits. |
| `notify.updates` | `off` | on/off (true/false) | no, stored | May a mod raise a notice about new versions. |
| `notify.tips` | `off` | on/off (true/false) | no, stored | May a mod raise a notice with a tip. |

### Charts

| key | default | accepts | used by prefs? | meaning |
| --- | --- | --- | --- | --- |
| `chart.type.cost` | `line` | one of line, bar, area | no, stored | How a cost-over-time chart should draw. |
| `chart.type.context` | `area` | one of line, bar, area | no, stored | How a context-use chart should draw. |
| `chart.type.tokens` | `bar` | one of line, bar, area | no, stored | How a token-count chart should draw. |
| `chart.type.tools` | `bar` | one of line, bar, area | no, stored | How a tool-call chart should draw. |
| `chart.type.time` | `line` | one of line, bar, area | no, stored | How a time-spent chart should draw. |
| `chart.range` | `24h` | one of 1h, 6h, 24h, 7d, 30d | no, stored | The range a chart opens on. |
| `chart.smooth` | `on` | on/off (true/false) | no, stored | Curved lines instead of straight segments. |
| `chart.grid` | `on` | on/off (true/false) | no, stored | Faint grid lines behind a chart. |
| `chart.labels` | `off` | on/off (true/false) | no, stored | Print values on the points or bars. |
| `chart.legend` | `bottom` | one of top, bottom, right, none | no, stored | Where a chart legend goes, or none. |
| `chart.ramp` | `blue` | one of blue, green, warm, mono, viridis | no, stored | The colour ramp for heat maps and calendars. |

### Data

| key | default | accepts | used by prefs? | meaning |
| --- | --- | --- | --- | --- |
| `rows.page` | `20 rows` | number 5 to 100 rows (step 5) | no, stored | How many rows a paged list shows. |
| `sort.default` | `newest` | one of newest, oldest, name, size, value | no, stored | How lists are ordered when you have not chosen. |
| `confirm.destructive` | `on` | on/off (true/false) | no, stored | Mods that delete, reset or overwrite should ask first. This mod's own /pfreset everything always asks. |
| `newproject.clear` | `never` | one of never, ask, always | no, stored | What a recording mod should do with its recorded data when you start in a new project. |

### Per-mod families

| pattern | default | accepts | meaning |
| --- | --- | --- | --- |
| `quiet.<mod>` | `off` | `off`, `22:00-07:00`, `23:00-06:00`, `21:00-08:00`, `00:00-08:00`, `12:00-13:00` | hours `<mod>` should stay quiet |
| `record.<mod>` | `on` | on/off | off asks `<mod>` not to record anything |
| `retain.<mod>` | `30 days` | number 1 to 365 days (step 1) | days `<mod>` keeps what it recorded |
| `autoopen.<mod>` | `off` | on/off | open `<mod>`'s main pane at start (prefs acts on `autoopen.prefs` only) |

## What was not built, and why

- Applying `toast.pos`, `motion.level`, volumes, chart styles, notification channels, recording opt-outs and retention to other
  mods: the app gives a mod no way to move toasts, restyle or silence other mods, or bind them. These are values for mods built
  to read them.
- Auto-opening panes of other mods: a mod may only open its own panes, so `autoopen.<mod>` is documented for that mod to read.
- Remembering the last open pane across mods: only this pane's last tab is remembered (`pane.remember`), because this mod cannot reopen another mod's pane.
- A "save as default for new projects" flow beyond `sync.mode` and the layers.
