// Element trees for the bar: the band above the prompt and the Bar tab of the pane. No `$` here:
// register.tsx hands in the elements, the finished pictures and what each press does.

import type { ElementTable } from 'claude-code'

import { ITEMS, PRESETS, SIZES, THEMES } from './bar'
import type { BarButton, BarConfig } from './bar'
import { barHero, fieldsCard, titleCard } from './panesvg'
import type { PaneLook, Picture as Card } from './panesvg'

export type Picture = { source: string; alt: string; width: number; height: number }

export type BandParts = {
  strip: Picture
  alert: Picture | null
  chips: Picture | null
  buttons: readonly BarButton[]
  hasSide: boolean
  hasRow: boolean
  /** The one-line mode: every button shares the strip's line. */
  isSlim: boolean
  gitInline: string
  gitLine: string
  lines: readonly string[]
}

export type BandActions = {
  open: () => unknown
  hide: () => unknown
  press: (b: BarButton) => unknown
}

type Ui = ElementTable<'desktop'>

export const drawBand = (ui: Ui, p: BandParts, act: BandActions, below: unknown) => {
  const { Box, Button, Text, Svg } = ui
  const picture = (x: Picture) => <Svg source={x.source} alt={x.alt} width={x.width} height={x.height} />
  const house = [
    <Button key="cockpit-open" label="Cockpit" onPress={() => act.open()} />,
    <Button key="cockpit-hide" dimColor label="Hide" onPress={() => act.hide()} />,
  ]

  const buttons = p.buttons.map(b => (
    <Button
      key={`bar-${b.id}`}
      label={b.label}
      variant={b.isPrimary === true ? 'primary' : undefined}
      dimColor={b.kind === 'more' || b.kind === 'quiet'}
      onPress={() => act.press(b)}
    />
  ))
  const isOneLine = p.isSlim && p.hasSide

  return (
    <Box flexDirection="column">
      {below as never}
      <Box gap="sm" alignItems="center">
        {picture(p.strip)}
        {isOneLine && buttons}
        {isOneLine && house}
        {!isOneLine && p.hasSide && <Box flexDirection="column">{house}</Box>}
      </Box>
      {p.alert !== null && picture(p.alert)}
      {p.hasRow && !isOneLine && (
        <Box gap="sm" alignItems="center">
          {buttons}
          {!p.hasSide && house}
          {p.gitInline !== '' && (
            <Text mono dimColor>
              {p.gitInline}
            </Text>
          )}
        </Box>
      )}
      {p.chips !== null && picture(p.chips)}
      {p.gitLine !== '' && (
        <Text mono dimColor>
          {p.gitLine}
        </Text>
      )}
      {p.lines.map(line => (
        <Text dimColor>{line}</Text>
      ))}
    </Box>
  )
}

export type SettingsActions = {
  size: (s: BarConfig['size']) => unknown
  theme: (t: BarConfig['theme']) => unknown
  quiet: () => unknown
  preset: (name: string) => unknown
  toggle: (id: string) => unknown
  move: (id: string, by: -1 | 1) => unknown
}

/**
 * The Bar tab: one press each for size, theme, quiet and presets, then every item with its switch.
 * With a `look` (the desktop) the headings and texts are cards; the Buttons are the same ones.
 */
export const drawSettings = (ui: ElementTable, config: BarConfig, name: string, act: SettingsActions, look?: PaneLook) => {
  const { Box, Button, Text } = ui
  const Svg = look === undefined ? undefined : (ui as Ui).Svg
  const groups = [...new Set(ITEMS.map(i => i.group))]
  const order = (id: string) => config.items.indexOf(id)
  const choice = (key: string, label: string, isOn: boolean, onPress: () => unknown) => (
    <Button key={key} label={isOn ? `* ${label}` : label} variant={isOn ? 'primary' : undefined} onPress={() => onPress()} />
  )
  const card = (p: Card) => (Svg === undefined ? null : <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />)
  const title = (label: string, value = '') => (
    <Box marginTop="md" marginBottom={look === undefined ? undefined : 'xs'}>
      {look === undefined ? (
        <Text size="caption" weight="semibold" dimColor>
          {label.toUpperCase()}
        </Text>
      ) : (
        card(titleCard(label, value, look))
      )}
    </Box>
  )
  const itemsOf = (group: string) =>
    ITEMS.filter(i => i.group === group).sort((a, b) => (order(a.id) < 0 ? 999 : order(a.id)) - (order(b.id) < 0 ? 999 : order(b.id)))
  const itemRow = (i: (typeof ITEMS)[number]) => {
    const isOn = config.items.includes(i.id)

    return (
      <Box gap="sm">
        <Button key={`bar-item-${i.id}`} dimColor={!isOn} label={`${isOn ? '[x]' : '[ ]'} ${i.label}`} onPress={() => act.toggle(i.id)} />
        {isOn && (i.kind === 'chip' || i.kind === 'button') && (
          <Button key={`bar-left-${i.id}`} dimColor label="left" onPress={() => act.move(i.id, -1)} />
        )}
        {isOn && (i.kind === 'chip' || i.kind === 'button') && (
          <Button key={`bar-right-${i.id}`} dimColor label="right" onPress={() => act.move(i.id, 1)} />
        )}
      </Box>
    )
  }
  const written = [
    ['Note', config.note || `none (/${name} note text)`],
    ['Goal', config.goal || `none (/${name} goal text)`],
    ['Budget', config.budget === null ? `none (/${name} budget 5)` : `$${config.budget}`],
    ['Buttons', config.buttons.map(b => b.label).join(', ') || `none (/${name} button add label = text)`],
  ] as const

  return (
    <Box flexDirection="column">
      {look === undefined ? (
        <Text size="heading" weight="bold">
          Bar
        </Text>
      ) : (
        card(barHero({ name, size: config.size, theme: config.theme, quiet: config.quiet, on: config.items.length }, look))
      )}
      {look === undefined && <Text dimColor>{`The strip above the prompt. Same choices as /${name}.`}</Text>}
      {title('Size', config.size)}
      <Box gap="sm" flexWrap="wrap">
        {SIZES.map(s => choice(`bar-size-${s}`, s, config.size === s, () => act.size(s)))}
        {choice('bar-quiet-toggle', config.quiet ? 'quiet is on' : 'quiet', config.quiet, act.quiet)}
      </Box>
      {title('Theme', config.theme)}
      <Box gap="sm" flexWrap="wrap">
        {THEMES.map(t => choice(`bar-theme-${t}`, t, config.theme === t, () => act.theme(t)))}
      </Box>
      {title('Presets')}
      <Box gap="sm" flexWrap="wrap">
        {[...Object.keys(PRESETS), 'reset'].map(p => (
          <Button key={`bar-preset-${p}`} label={p} onPress={() => act.preset(p)} />
        ))}
      </Box>
      {groups.map(group => {
        const all = itemsOf(group)

        // The text version lists every item on its own row.
        if (look === undefined) {
          return (
            <Box flexDirection="column">
              {title(group)}
              {all.map(itemRow)}
            </Box>
          )
        }
        const on = all.filter(i => config.items.includes(i.id))

        // On the desktop the chosen items keep a row each (with their arrows); the rest wrap.
        return (
          <Box flexDirection="column" gap="xs">
            {title(group, `${on.length} of ${all.length} on`)}
            {on.map(itemRow)}
            <Box gap="sm" flexWrap="wrap">
              {all.filter(i => !config.items.includes(i.id)).map(itemRow)}
            </Box>
          </Box>
        )
      })}
      {look === undefined && title('Your text')}
      {look === undefined && written.map(([label, value]) => <Text dimColor>{`${label}: ${value}`}</Text>)}
      {look !== undefined && <Box marginTop="md">{card(fieldsCard('Your text', written, look))}</Box>}
    </Box>
  )
}
