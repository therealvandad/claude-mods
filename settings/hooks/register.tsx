import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Accent, Density, IconPack, Preset } from '../types'
import {
  GUARD_MODS,
  INDEX,
  FEATURE_USAGE,
  changedCount,
  featurePresetFor,
  findMod,
  isAllowed,
  keepRows,
  lineFor,
  listMod,
  modNames,
  overview,
  parseFeatureArgs,
  presetOverrides,
  sanitize,
  withSwitch,
} from './features'
import type { FeaturePreset, Overrides } from './features'

type Dollar = Parameters<Hook<'session.start'>>[0]

const panelQuery = atom({ plugin: 'settings', key: 'panelQuery' } as const, '')
const accent = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const density = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const icons = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
const preset = atom({ plugin: 'settings', key: 'preset' } as const, 'full')
const isCalm = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
// Overrides only: an id that is absent means that switch's default. Only this mod writes it.
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })

const ACCENTS: readonly Accent[] = ['suggestion', 'claude', 'success', 'warning', 'permission', 'remember']
const DENSITIES: readonly Density[] = ['compact', 'normal', 'airy']
const ICONS: readonly IconPack[] = ['letters', 'symbols', 'minimal']
const PRESETS: Readonly<Record<Exclude<Preset, 'custom'>, { density: Density; isCalm: boolean; accent: Accent; hint: string }>> = {
  calm: { density: 'airy', isCalm: true, accent: 'suggestion', hint: 'quiet: few toasts, gentle visuals. Also run /motion off for no animation.' },
  focus: { density: 'compact', isCalm: true, accent: 'claude', hint: 'tight and quiet: only what matters. Try /lyzen on for zen mode.' },
  full: { density: 'normal', isCalm: false, accent: 'suggestion', hint: 'everything on, normal spacing.' },
}

const pick = <T extends string>(list: readonly T[], value: string): T | undefined =>
  list.find(item => item === value.trim().toLowerCase())

const save = (d: Dollar, key: string, value: unknown) => d.store.set(key, value)

const load = async (d: Dollar) => {
  const saved = (await d.store.get('settings')) as Record<string, unknown> | undefined
  const s = saved ?? {}
  await update(d, accent, () => (pick(ACCENTS, String(s.accent ?? '')) ?? 'suggestion'))
  await update(d, density, () => (pick(DENSITIES, String(s.density ?? '')) ?? 'normal'))
  await update(d, icons, () => (pick(ICONS, String(s.icons ?? '')) ?? 'symbols'))
  const p = String(s.preset ?? 'full')
  await update(d, preset, () => (p === 'calm' || p === 'focus' || p === 'custom' ? p : 'full'))
  await update(d, isCalm, () => s.isCalm === true)
  await loadFeatures(d)
}

// ---------------------------------------------------------------- feature switches

/** Load and clean the stored overrides: known ids, boolean values, at most 600. Garbage becomes `{}`, never an error. */
const loadFeatures = async (d: Dollar) => {
  const saved = await d.store.get('features').catch(() => undefined)
  await update(d, featuresA, () => sanitize(saved))
}

const saveFeatures = async (d: Dollar, next: Overrides) => {
  await update(d, featuresA, () => next)
  await d.store.set('features', next)
}

const applyFeaturePreset = async (d: Dollar, name: FeaturePreset): Promise<string> => {
  const next = presetOverrides(name)
  await saveFeatures(d, next)
  const n = Object.keys(next).length

  return name === 'full'
    ? 'Feature switches: all back to their defaults (everything on).'
    : `Feature switches ${name}: ${n} off (pop-ups, sounds, status writes${name === 'quiet' ? ' and rows' : ' and most rows'}), except alerts and the safety mods (${GUARD_MODS.join(', ')}), which cannot be muted.`
}

const featureCommand = async (d: Dollar, args: string): Promise<string> => {
  const cmd = parseFeatureArgs(args)
  const overrides = await read(d, featuresA)

  if (cmd.kind === 'error') {
    return cmd.message
  }

  if (cmd.kind === 'overview') {
    return overview(overrides)
  }

  if (cmd.kind === 'list') {
    if (cmd.mod === 'all') {
      return [`All ${INDEX.size} switches (* = changed from default):`, ...modNames().flatMap(m => listMod(overrides, m))].join('\n')
    }
    const found = findMod(cmd.mod)

    return found.mod === undefined
      ? `No mod named "${cmd.mod.slice(0, 40)}".${found.near.length > 0 ? ` Closest: ${found.near.join(', ')}.` : ''} /cfg feature list all shows every switch.`
      : [`${found.mod} (* = changed from default):`, ...listMod(overrides, found.mod)].join('\n')
  }

  if (cmd.kind === 'reset') {
    await saveFeatures(d, {})

    return 'All feature switches are back to their defaults.'
  }

  if (cmd.kind === 'preset') {
    return applyFeaturePreset(d, cmd.name)
  }
  const def = INDEX.get(cmd.id)

  if (def === undefined) {
    return `No switch named "${cmd.id}".`
  }

  if (def.locked) {
    return `${cmd.id} cannot be changed: ${def.mod} is a safety mod (or this one), so its messages are never muted.`
  }
  await saveFeatures(d, withSwitch(overrides, def, cmd.value))

  return `Done.\n${lineFor(await read(d, featuresA), def).trim()}`
}

const persist = async (d: Dollar) => {
  await save(d, 'settings', {
    accent: await read(d, accent),
    density: await read(d, density),
    icons: await read(d, icons),
    preset: await read(d, preset),
    isCalm: await read(d, isCalm),
  })
}

const describe = async (d: Dollar) =>
  `preset ${await read(d, preset)} · accent ${await read(d, accent)} · density ${await read(d, density)} · icons ${await read(d, icons)} · calm ${(await read(d, isCalm)) ? 'on' : 'off'}`

const applyPreset = async (d: Dollar, name: Exclude<Preset, 'custom'>) => {
  const p = PRESETS[name]
  await update(d, preset, () => name)
  await update(d, density, () => p.density)
  await update(d, isCalm, () => p.isCalm)
  await update(d, accent, () => p.accent)
  await persist(d)
  const feature = await applyFeaturePreset(d, featurePresetFor(name)).catch(() => 'Feature switches were not changed.')

  return `Preset ${name}: ${p.hint}\n${feature}`
}

const setOne = async (d: Dollar, what: string, value: string) => {
  if (what === 'accent') {
    const v = pick(ACCENTS, value)

    if (v === undefined) {
      return `Accent is one of: ${ACCENTS.join(', ')}`
    }
    await update(d, accent, () => v)
  } else if (what === 'density') {
    const v = pick(DENSITIES, value)

    if (v === undefined) {
      return `Density is one of: ${DENSITIES.join(', ')}`
    }
    await update(d, density, () => v)
  } else if (what === 'icons') {
    const v = pick(ICONS, value)

    if (v === undefined) {
      return `Icons are one of: ${ICONS.join(', ')}`
    }
    await update(d, icons, () => v)
  } else if (what === 'calm') {
    const v = value.trim().toLowerCase()

    if (v !== 'on' && v !== 'off') {
      return 'Usage: /cfg calm on|off'
    }
    await update(d, isCalm, () => v === 'on')
  } else {
    return 'Usage: /cfg [accent|density|icons|calm|preset] <value>'
  }
  await update(d, preset, () => 'custom')
  await persist(d)

  return `Set ${what}. Now: ${await describe(d)}`
}

export const register: Register = on => {
  // This mod's own section in the shared "Mod manager" settings panel.
  on('ui.render', { component: 'Pane', plugin: '*', requestId: 'mod-settings' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const calm = await read($, isCalm)
    const query = await read($, panelQuery)
    const hit = (label: string) => query === '' || label.toLowerCase().includes(query)
    const Row = (key: string, label: string, value: string, press: () => unknown) =>
      hit(label) ? (
        <Box justifyContent="space-between" gap="sm">
          <Text>{label}</Text>
          <Button key={key} variant={value === 'On' ? 'primary' : undefined} label={value} onPress={press} />
        </Box>
      ) : null
    const rows = [
      Row('st-calm', 'Calm mode', calm ? 'On' : 'Off', () => setOne($, 'calm', calm ? 'off' : 'on')),
    ].filter(Boolean)

    return (
      <Box flexDirection="column">
        {await next(e)}
        {rows.length > 0 && (
          <Box flexDirection="column" marginTop="md" gap="sm">
            <Text weight="bold">Shared</Text>
            {rows}
          </Box>
        )}
      </Box>
    )
  })

  // The panel's search box and preset buttons belong to mod-manager; this mod follows them.
  on('ui.input', { plugin: 'mod-manager', element: 'find-setting' }, async ($, e, next) => {
    const done = await next(e)
    await update($, panelQuery, () => String((e as unknown as { value?: unknown }).value ?? '').toLowerCase().trim())

    return done
  })

  on('session.start', async ($, e, next) => {
    await load($)
    await $.command
      .register({ name: 'cfg', description: 'Shared look and feel and per-mod feature switches: /cfg preset calm|focus|full, /cfg accent|density|icons <value>, /cfg feature ...' })
      .catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'cfg' }, async ($, e) => {
    const [what = '', value = ''] = e.args.trim().split(/\s+/)

    if (what.toLowerCase() === 'feature') {
      return { text: await featureCommand($, e.args.trim().slice('feature'.length)).catch(() => `Feature switches hit an unexpected error. ${FEATURE_USAGE}`) }
    }

    if (what === '') {
      await $.ui.open({ id: 'settings-main', title: 'Settings' }).catch(() => undefined)

      return {
        text: `${await describe($)}\nUsage: /cfg preset calm|focus|full · /cfg feature [list|<mod>.<id> on|off|default|quiet|calm|full|reset] · /cfg accent <${ACCENTS.join('|')}> · /cfg density <${DENSITIES.join('|')}> · /cfg icons <${ICONS.join('|')}> · /cfg calm on|off`,
      }
    }

    if (what === 'preset') {
      const name = value.toLowerCase()

      return { text: name === 'calm' || name === 'focus' || name === 'full' ? await applyPreset($, name) : 'Presets: calm, focus, full' }
    }

    return { text: await setOne($, what.toLowerCase(), value) }
  })

  // ---- the central gate. Every hook is fail-open: a bug here lets the call through, never swallows it.
  // `next.origin.plugin` is set by the host (the plugin whose hook made the call), so a mod cannot claim another name.
  // A swallowed call answers as the call would have: nothing for a toast, a status or a sound, `{ via: 'system' }` for speech.
  on('ui.toast', async ($, e, next) =>
    isAllowed(next.origin.plugin, 'toasts', await read($, featuresA)) ? next(e) : { value: undefined },
  ).catch(($, e, next) => next(e))

  on('audio.play', async ($, e, next) =>
    isAllowed(next.origin.plugin, 'sounds', await read($, featuresA)) ? next(e) : { value: undefined },
  ).catch(($, e, next) => next(e))

  on('audio.speak', async ($, e, next) =>
    isAllowed(next.origin.plugin, 'sounds', await read($, featuresA)) ? next(e) : { value: { via: 'system' as const } },
  ).catch(($, e, next) => next(e))

  // Clearing the line (text undefined) always passes, so a mod can still take its own status away.
  on('ui.status', async ($, e, next) =>
    e.text === undefined || isAllowed(next.origin.plugin, 'status', await read($, featuresA)) ? next(e) : { value: undefined },
  ).catch(($, e, next) => next(e))

  // Rows of mods whose band switch is off are left out; a survey is never touched. Same rewrite as band-tidy.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const kept = keepRows(e.props.rows, await read($, featuresA))

    return kept.dropped === 0 ? next(e) : next({ ...e, props: { ...e.props, rows: kept.rows } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'settings-main' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = {
      preset: await read($, preset),
      accent: await read($, accent),
      density: await read($, density),
      icons: await read($, icons),
      calm: await read($, isCalm),
    }
    const changed = changedCount(await read($, featuresA))
    const row = (label: string, items: readonly string[], active: string, set: (v: string) => Promise<unknown>) => (
      <Box gap="sm" flexWrap="wrap">
        <Text dimColor mono>
          {label.padEnd(8)}
        </Text>
        {items.map(item => (
          <Button key={`${label}-${item}`} label={item === active ? `[${item}]` : item} onPress={() => set(item)} />
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" padding="sm" gap="sm">
        <Text size="heading" weight="bold">
          Settings
        </Text>
        <Text dimColor>Other mods read these. Presets change several at once.</Text>
        {row('preset', ['calm', 'focus', 'full'], current.preset, v => applyPreset($, v as 'calm' | 'focus' | 'full'))}
        {row('accent', ACCENTS, current.accent, v => setOne($, 'accent', v))}
        {row('density', DENSITIES, current.density, v => setOne($, 'density', v))}
        {row('icons', ICONS, current.icons, v => setOne($, 'icons', v))}
        {row('calm', ['on', 'off'], current.calm ? 'on' : 'off', v => setOne($, 'calm', v))}
        <Text dimColor>{`${changed} feature switches changed from default. /cfg feature, or the Features tab of the mod manager.`}</Text>
      </Box>
    )
  })
}
