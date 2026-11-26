import { atom, read, update } from 'claude-code'
import type { Hook, Register, ThemeSetArgs } from 'claude-code'

import {
  ALIASES,
  EMPTY,
  LEVELS,
  PALETTES,
  PALETTE_IDS,
  describe,
  isEmpty,
  normalizeHex,
  parseComp,
  resolve,
  resolveName,
  swatchesOf,
} from './palettes'
import type { Comp, Corners, Level } from './palettes'
import { SCENES } from './scenes'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'skins-main'

// Re-renders the pane when the choice changes; the value itself is only a label.
const appliedAtom = atom({ plugin: 'skins', key: 'applied' } as const, '')
// A palette /skpreview <name> asked to look at first.
const focusAtom = atom({ plugin: 'skins', key: 'focus' } as const, '')

// Nothing is applied by default. This module holds what the user chose with /skuse in this
// session, and the saved choice only comes back when the user turned /skremember on.
type State = { comp: Comp; remember: boolean; isApplied: boolean }

const state: State = { comp: EMPTY, remember: false, isApplied: false }

const sceneLabel = (name: string) => SCENES[name]?.label ?? name

async function persist($: Dollar) {
  if (!state.remember) {
    return
  }

  if (isEmpty(state.comp)) {
    await $.store.delete('comp')
  } else {
    await $.store.set('comp', state.comp)
  }
}

// The only place that calls $.theme.set or $.theme.clear: once per command.
async function applyComp($: Dollar, next: Comp): Promise<string> {
  const resolved = resolve(next)

  if (resolved.refusal !== null) {
    return `Not applied: ${resolved.refusal}`
  }
  state.comp = next
  await persist($)
  await update($, appliedAtom, () => describe(next))

  if (resolved.args === undefined) {
    await $.theme.clear()
    state.isApplied = false

    return "Cleared: the app's own look."
  }
  let args: ThemeSetArgs = resolved.args
  const dropped: string[] = []
  let text = ''

  // An older build may not take `style` or a scene: keep the colours and say what was left out.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const set = await $.theme.set(args)

      state.isApplied = true
      text = set.isDrawn ? '' : ` (not drawn here: ${set.reason})`
      break
    } catch (error) {
      if (args.style !== undefined) {
        const { style: _style, ...rest } = args

        args = rest
        dropped.push('style (this build refused it)')
      } else if (args.backdrop !== undefined && args.colors !== undefined) {
        const { backdrop: _backdrop, ...rest } = args

        args = rest
        dropped.push('backdrop (this build refused it)')
      } else {
        return `Not applied: ${String(error)}`
      }
    }
  }
  const extra = dropped.length === 0 ? '' : ` Left out: ${dropped.join(', ')}.`
  const soft = resolved.notes.length === 0 ? '' : ` (${resolved.notes.length} contrast note${resolved.notes.length === 1 ? '' : 's'}, still paints)`

  return `Applied: ${describe(next)}.${soft}${extra}${text}`
}

const USAGE = [
  'Skins: nothing is applied until you type a command. One theme call per command; the last mod to call wins.',
  '  /skuse <name>             one of the palettes below',
  '  /skuse accent <hex>       a whole theme from one colour, e.g. /skuse accent #e8643c',
  '  /skuse contrast <level>   soft, normal, sharp, max',
  '  /skuse corners <kind>     round, square, default',
  '  /skuse glass on|off       frosted cards over soft colour',
  '  /skuse grain on|off       a faint paper grain behind everything',
  "  /skuse off                back to the app's own look",
  '  /skpreview [name]         a pane of swatches with an Apply button each',
  '  /skremember on|off        bring your choice back next session (default off)',
  '  /skreset                  forget the saved choice and clear what skins applied',
]

const listing = (): string =>
  [
    `Now: ${describe(state.comp)}`,
    `Remember: ${state.remember ? 'on' : 'off'}`,
    '',
    'Palettes:',
    ...PALETTE_IDS.map(id => `  ${id.padEnd(15)} ${PALETTES[id]!.blurb}`),
    '',
    ...USAGE,
  ].join('\n')

const helpText = (): string =>
  [
    '/sk                       this help',
    '/skuse <name>             apply a palette (15: ' + PALETTE_IDS.join(', ') + ')',
    '/skuse accent <hex>       a theme from one colour',
    '/skuse contrast soft|normal|sharp|max',
    '/skuse corners round|square|default',
    '/skuse glass on|off       /skuse grain on|off',
    "/skuse off                the app's own look",
    '/skpreview [name]         swatch grid pane with Apply buttons',
    '/skremember on|off        reapply your choice at session start (default off)',
    '/skreset                  forget the saved choice, clear applied skin',
  ].join('\n')

const onOff = (arg: string | undefined): boolean | null => {
  if (arg === undefined || arg === '' || arg === 'on' || arg === 'yes') {
    return true
  }

  return arg === 'off' || arg === 'no' ? false : null
}

async function runUse($: Dollar, raw: string): Promise<string> {
  const words = raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w !== '')
  const first = words[0] ?? ''
  const arg = words[1]
  const c = state.comp

  if (first === '' || first === 'list' || first === 'help' || first === '?') {
    return listing()
  }

  if (first === 'off' || first === 'none' || first === 'clear' || first === 'default') {
    return applyComp($, EMPTY)
  }

  if (first === 'accent') {
    const hex = normalizeHex(arg ?? '')

    if (hex === null) {
      return 'Usage: /skuse accent <hex>, such as #e8643c or e86 (three or six hex digits).'
    }

    return applyComp($, { ...c, base: `accent:${hex}` })
  }

  if (first === 'contrast') {
    const level: Level | undefined = LEVELS.find(l => l === arg)

    return level === undefined ? `Usage: /skuse contrast ${LEVELS.join('|')}` : applyComp($, { ...c, level })
  }

  if (first === 'corners' || first === 'round' || first === 'rounded' || first === 'square' || first === 'squared') {
    const word = first === 'corners' ? (arg ?? '') : first
    const kind: Corners | null | undefined =
      word === 'round' || word === 'rounded' ? 'round' : word === 'square' || word === 'squared' ? 'square' : word === 'default' || word === 'off' ? null : undefined

    return kind === undefined ? 'Usage: /skuse corners round|square|default' : applyComp($, { ...c, corners: kind })
  }

  if (first === 'glass' || first === 'grain' || first === 'paper') {
    const want = onOff(arg)

    if (want === null) {
      return `Usage: /skuse ${first === 'glass' ? 'glass' : 'grain'} on|off`
    }

    return first === 'glass'
      ? applyComp($, { ...c, glass: want, grain: want ? false : c.grain })
      : applyComp($, { ...c, grain: want, glass: want ? false : c.glass })
  }
  const id = resolveName(first)

  if (id === null) {
    return `No skin called "${first}". /skuse lists them (${Object.keys(ALIASES).length} aliases work too).`
  }

  return applyComp($, { ...c, base: id })
}

async function runPreview($: Dollar, raw: string): Promise<string> {
  const name = raw.trim()
  const id = name === '' ? '' : resolveName(name)

  if (id === null) {
    return `No palette called "${name}". Palettes: ${PALETTE_IDS.join(', ')}.`
  }
  await update($, focusAtom, () => id)
  await $.ui.open({ id: PANE, title: 'Skins' }).catch(() => undefined)

  return id === ''
    ? 'Skins pane opened: swatches for all 15 palettes. Pressing Apply calls /skuse for you.'
    : `Skins pane opened with ${PALETTES[id]!.label} first.`
}

async function runReset($: Dollar): Promise<string> {
  const wasApplied = state.isApplied

  state.remember = false
  state.comp = EMPTY
  state.isApplied = false
  await $.store.delete('remember')
  await $.store.delete('comp')
  await update($, focusAtom, () => '')
  await update($, appliedAtom, () => '')

  if (wasApplied) {
    await $.theme.clear()

    return "Skins reset: saved choice and remember setting deleted, and the skin this mod applied is cleared (the app's own look)."
  }

  return 'Skins reset: saved choice and remember setting deleted. This mod had applied nothing, so the theme was left alone.'
}

async function runRemember($: Dollar, raw: string): Promise<string> {
  const want = raw.trim().toLowerCase()

  if (want === '') {
    return `Remember is ${state.remember ? 'on' : 'off'}. /skremember on brings your /skuse choice back at every session start; off forgets it.`
  }

  if (want !== 'on' && want !== 'off') {
    return 'Usage: /skremember on|off'
  }
  state.remember = want === 'on'

  if (state.remember) {
    await $.store.set('remember', true)
    await persist($)

    return isEmpty(state.comp)
      ? 'Remember on. Nothing is chosen yet: pick a skin with /skuse and it will come back next session.'
      : `Remember on. Saved: ${describe(state.comp)}. It is applied once at the start of each session.`
  }
  await $.store.delete('remember')
  await $.store.delete('comp')

  return 'Remember off: the saved choice is deleted, and new sessions start with whatever theme is already there.'
}

// Called from a pane button: the same as typing /skuse <name>.
async function pressApply($: Dollar, args: string): Promise<void> {
  await runUse($, args)
}

async function loadSaved($: Dollar) {
  state.remember = (await $.store.get('remember')) === true

  if (!state.remember) {
    return
  }
  const saved = parseComp(await $.store.get('comp'))

  if (saved !== null && !isEmpty(saved)) {
    await applyComp($, saved)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['sk', 'Skins help: every /sk command in one line each'],
      ['skuse', 'Apply a palette or style: /skuse <name>, /skuse accent <hex>, /skuse contrast sharp, /skuse off'],
      ['skpreview', 'A pane of swatches for every palette, with an Apply button each'],
      ['skremember', 'Bring your /skuse choice back at session start: /skremember on|off (default off)'],
      ['skreset', 'Forget the saved skin choice and clear what skins applied'],
    ] as const) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    // Nothing is applied here unless the user turned /skremember on and has a saved choice.
    await loadSaved($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'sk' }, () => ({ text: helpText() }))
  on('command.run', { command: 'skuse' }, async ($, e) => ({ text: await runUse($, e.args) }))
  on('command.run', { command: 'skpreview' }, async ($, e) => ({ text: await runPreview($, e.args) }))
  on('command.run', { command: 'skremember' }, async ($, e) => ({ text: await runRemember($, e.args) }))
  on('command.run', { command: 'skreset' }, async $ => ({ text: await runReset($) }))

  // The two still backdrops are drawn here; any scene from another plugin goes on to the engine.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const scene = e.props.plugin === 'skins' ? SCENES[e.props.scene] : undefined

    if (scene === undefined) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={scene.svg} alt={scene.alt} isInteractive />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    await read($, appliedAtom)
    const focus = await read($, focusAtom)
    const ids = focus === '' || !(focus in PALETTES) ? PALETTE_IDS : [focus, ...PALETTE_IDS.filter(id => id !== focus)]
    const c = state.comp
    const mods = (label: string, items: readonly string[], active: string, cmd: (item: string) => string) => (
      <Box gap="sm" flexWrap="wrap">
        <Text dimColor mono>
          {label.padEnd(9)}
        </Text>
        {items.map(item => (
          <Button key={`${label}-${item}`} label={item === active ? `[${item}]` : item} onPress={() => pressApply($, cmd(item))} />
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" padding="sm" gap="sm">
        <Text size="heading" weight="bold">
          Skins
        </Text>
        <Text dimColor>Now: {describe(c)}. Nothing changes until you press a button or type /skuse.</Text>
        {mods('contrast', LEVELS, c.level, item => `contrast ${item}`)}
        {mods('corners', ['round', 'square', 'default'], c.corners ?? 'default', item => `corners ${item}`)}
        {mods('glass', ['on', 'off'], c.glass ? 'on' : 'off', item => `glass ${item}`)}
        {mods('grain', ['on', 'off'], c.grain ? 'on' : 'off', item => `grain ${item}`)}
        <Button key="skins-off" label="Back to the app's own look" onPress={() => pressApply($, 'off')} />
        <Box flexWrap="wrap" gap="sm">
          {ids.map(id => {
            const p = PALETTES[id]!
            const sw = swatchesOf(p.def)
            const isOn = c.base === id
            const chips = (mode: string, list: { hex: string }[]) =>
              list.length === 0 ? null : (
                <Box gap="xs">
                  <Text dimColor mono>
                    {mode}
                  </Text>
                  {list.map((s, i) => (
                    <Box key={`${id}-${mode}-${i}`} width={4} height={1} backgroundColor={s.hex} />
                  ))}
                  <Box key={`${id}-${mode}-accent`} width={4} height={1} backgroundColor={sw.accent} />
                </Box>
              )

            return (
              <Box
                key={`card-${id}`}
                flexDirection="column"
                width={32}
                padding="xs"
                borderStyle="round"
                borderColor={isOn || id === focus ? 'suggestion' : 'inactive'}
              >
                <Text weight="bold">
                  {isOn ? '* ' : ''}
                  {p.label}
                </Text>
                <Text dimColor size="caption">
                  {p.blurb}
                </Text>
                {chips('light', sw.light)}
                {chips('dark ', sw.dark)}
                <Button key={`apply-${id}`} label={isOn ? 'Applied' : 'Apply'} onPress={() => pressApply($, id)} />
              </Box>
            )
          })}
        </Box>
        <Text dimColor size="caption">
          Scenes used: {sceneLabel('grain')}, {sceneLabel('glass')}. Chips: page, card, text, accent.
        </Text>
      </Box>
    )
  })
}
