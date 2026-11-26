# settings

Shared look-and-feel settings for the other mods (accent, density, icons, calm, preset) and, new, central
**feature switches**: turn what each mod shows, plays or writes on or off, without editing that mod.

## Look and feel

`/cfg` shows the current values. `/cfg preset calm|focus|full`, `/cfg accent|density|icons <value>`, `/cfg calm on|off`.
Other mods read the atoms `settings.accent`, `density`, `icons`, `isCalm`, `preset` (read only).

## Feature switches

A switch is named `<mod>.<id>`. Every mod has four, all on by default (so installing this changes nothing):

| switch | what it covers |
| --- | --- |
| `<mod>.toasts` | the mod's pop-up messages (`ui.toast`) |
| `<mod>.sounds` | its sounds and speech (`audio.play`, `audio.speak`) |
| `<mod>.status` | its writes to the status line (`ui.status`; clearing the line always passes) |
| `<mod>.band` | its row above the prompt (`AbovePromptList`; never touched while a survey is showing) |

How it works: the host stamps every call with the name of the plugin that made it (`next.origin.plugin`, which a mod cannot
forge). Four hooks look the name up (a trailing `@marketplace` is ignored, case is ignored) and answer a switched-off call
with an empty success instead of passing it on. Every hook is fail-open: if the lookup fails, the call goes through.

**Never muted:** the engine, `settings` itself and the three guard mods `tool-guard`, `safety-pro` and `controls`, because
their toasts and status lines are safety messages. `/cfg feature controls.toasts off` is refused.

### Commands

- `/cfg feature` or `/cfg feature list`: how many switches changed from default, and which.
- `/cfg feature list <mod>` or `list all`: the switches, `on`/`off`, `(default on)` or `* changed, default on`.
- `/cfg feature <mod>.<id> on|off|default`: set one. An unknown id is said plainly, with the closest ids.
- `/cfg feature quiet`: every toast, sound, status write and row off, except the guard mods and `alerts`.
- `/cfg feature calm`: toasts, sounds and status off (except `alerts` and the guards), rows only for `cockpit` and `alerts`.
- `/cfg feature full` or `/cfg feature reset`: clear every override.
- `/cfg preset calm|focus|full` also applies `calm`, `quiet` (focus) or `full` to the switches.

The mod manager's Features tab draws the same switches as buttons and runs these commands.

### Storage

The atom `settings.features` (`Shaped<Record<string, boolean>>`, shape tag `features-1`) holds ONLY overrides: an absent id
means the switch's default. It is saved under the store key `features`, cleaned when the session starts (ids must match
`<mod>.<id>` and exist in the registry, values must be booleans, at most 600 entries). Only this mod writes it.

### A mod's own switches: `features.json`

A mod may ship `<mod>/features.json`, a JSON array:

```json
[
  { "id": "band-row", "label": "Show the summary row", "description": "One line above the prompt", "default": true, "group": "Rows" },
  { "id": "rain", "label": "Rain effect", "description": "Falling drops while Claude works", "default": false }
]
```

`id`: lowercase letters, digits and `-` (not `toasts`, `sounds`, `status`, `band`), unique in the file. `label`: required.
`description`, `group`: optional. `default`: true or false (true when left out). The full switch name is `<mod>.<id>`.
The registry (`hooks/registry.ts`) and the mod manager's catalog are generated from these files by build scripts kept
outside the mod folders: run them again after adding or changing a `features.json`.

To read a switch, declare the foreign atom (with its shape tag) and use the override, else your default:

```ts
const features = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })
const on = (overrides: Record<string, boolean>, id: string, dflt: boolean) => overrides[id] ?? dflt
// in a hook: if (!on(await read($, features), 'mymod.rain', false)) return next(e)
```

Add `"dependencies": ["settings"]` to the mod's plugin.json. Never write the atom: change a switch with
`$.command.run({ command: 'cfg', args: 'feature mymod.rain on' })`.
