// Element trees of the cockpit pane on the desktop surface: cards for what is read, real Buttons for
// what is pressed, beside or under their card. No `$` here: register.tsx hands in the elements, the
// data and what each press does. Every key is the one the text version uses.

import type { ElementTable, RenderSurface } from 'claude-code'

import { buttonWidth } from './bar'
import {
  commandCard,
  daysCard,
  historyRow,
  linkRow,
  pinRow,
  searchCard,
  shelfRow,
  titleCard,
  todoCard,
  hhmm,
} from './panesvg'
import type { PaneLook, Picture } from './panesvg'
import type { DayRow, LinkRow, PromptRow, SearchState, Todo } from '../types'

type Ui = ElementTable<'desktop'>

// The app refuses a whole drawing when a Button label holds a control character.
const short = (s: string, max: number) =>
  s.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max)

export const picture = (ui: Ui, p: Picture) => {
  const { Svg } = ui

  return <Svg source={p.source} alt={p.alt} width={p.width} height={p.height} />
}

/** What is left for a row's picture once its buttons have their room. */
export const besideButtons = (look: PaneLook, labels: readonly string[]): number =>
  Math.max(220, look.width - labels.reduce((sum, label) => sum + buttonWidth(label) + 8, 0))

export const drawPins = (ui: Ui, look: PaneLook, pins: readonly string[], unpin: (text: string) => unknown) => {
  const { Box, Button } = ui
  const width = besideButtons(look, ['unpin'])

  return (
    <Box flexDirection="column" gap="xs" marginBottom="sm">
      {pins.map((p, i) => (
        <Box gap="sm" alignItems="center">
          {picture(ui, pinRow(p, width, look))}
          <Button key={`unpin-${i}`} dimColor label="unpin" onPress={() => unpin(p)} />
        </Box>
      ))}
    </Box>
  )
}

export const drawTodo = (
  ui: Ui,
  look: PaneLook,
  o: { all: readonly Todo[]; shown: readonly Todo[]; columns: number },
  act: { tick: (id: number) => unknown; clear: () => unknown },
) => {
  const { Box, Button } = ui
  const next = o.all.find(x => !x.done)

  return (
    <Box flexDirection="column" gap="xs">
      {picture(
        ui,
        todoCard(
          { done: o.all.filter(x => x.done).length, total: o.all.length, next: next?.text ?? '', hidden: o.all.length - o.shown.length },
          look,
        ),
      )}
      {o.shown.map(x => (
        <Button
          key={`todo-${x.id}`}
          dimColor={x.done}
          onPress={() => act.tick(x.id)}
          label={`${x.done ? '[x]' : '[ ]'} ${short(x.text, Math.max(20, o.columns - 10))}`}
        />
      ))}
      {o.all.some(x => x.done) && (
        <Box marginTop="sm">
          <Button key="todo-clear" label="Clear done" onPress={() => act.clear()} />
        </Box>
      )}
    </Box>
  )
}

export const drawHistory = (
  ui: Ui,
  look: PaneLook,
  o: {
    list: readonly PromptRow[]
    total: number
    pinned: readonly string[]
    found: SearchState
    days: readonly (DayRow & { day: string })[]
  },
  act: { refill: (text: string) => unknown; pin: (text: string) => unknown },
) => {
  const { Box, Button } = ui
  const width = besideButtons(look, ['use', 'unpin'])
  const right = o.total > o.list.length ? `${o.list.length} of ${o.total}` : `${o.list.length} shown`

  return (
    <Box flexDirection="column" gap="xs">
      {picture(
        ui,
        titleCard('Prompt history', right, look, o.list.length === 0 ? 'No prompts yet. Press use on one later to refill the prompt box.' : ''),
      )}
      {o.list.map((p, i) => {
        const isPinned = o.pinned.includes(p.text.replace(/\s+/g, ' ').trim().slice(0, 120))

        return (
          <Box gap="sm" alignItems="center">
            {picture(ui, historyRow({ n: i + 1, prompt: p.text, time: hhmm(p.at), isPinned }, width, look))}
            <Button key={`hist-${i}`} label="use" onPress={() => act.refill(p.text)} />
            <Button key={`histpin-${i}`} dimColor label={isPinned ? 'unpin' : 'pin'} onPress={() => act.pin(p.text)} />
          </Box>
        )
      })}
      <Box marginTop="sm">{picture(ui, searchCard(o.found.query, o.found.hits, look))}</Box>
      <Box marginTop="sm">{picture(ui, daysCard(o.days, look))}</Box>
    </Box>
  )
}

export const drawLinks = (
  ui: Ui,
  look: PaneLook,
  o: { list: readonly LinkRow[]; total: number; saved: readonly string[] },
  act: { copy: (url: string, surface: RenderSurface) => unknown; refill: (text: string) => unknown; drop: (at: number) => unknown },
) => {
  const { Box, Button } = ui
  const linkWidth = besideButtons(look, ['copy'])
  const shelfWidth = besideButtons(look, ['use', 'drop'])
  const right = o.total > o.list.length ? `${o.list.length} of ${o.total}` : `${o.list.length}`

  return (
    <Box flexDirection="column" gap="xs">
      {picture(ui, titleCard('Links', right, look, o.list.length === 0 ? 'No URLs seen yet in prompts or tool output.' : ''))}
      {o.list.map((l, i) => (
        <Box gap="sm" alignItems="center">
          {picture(ui, linkRow(l.url, linkWidth, look))}
          <Button key={`link-${i}`} label="copy" onPress={press => act.copy(l.url, press.surface)} />
        </Box>
      ))}
      <Box marginTop="sm">
        {picture(ui, titleCard('Shelf', `${o.saved.length}`, look, o.saved.length === 0 ? 'Empty. /cshelf add your text.' : ''))}
      </Box>
      {o.saved.slice(-5).map((s, i) => {
        const at = Math.max(0, o.saved.length - 5) + i

        return (
          <Box gap="sm" alignItems="center">
            {picture(ui, shelfRow({ n: at + 1, snippet: s }, shelfWidth, look))}
            <Button key={`shelf-${at}`} label="use" onPress={() => act.refill(s)} />
            <Button key={`shelfrm-${at}`} dimColor label="drop" onPress={() => act.drop(at)} />
          </Box>
        )
      })}
    </Box>
  )
}

const groupOf = (cmd: string, about: string): string => {
  if (about.startsWith('Tool guard: ') || about.startsWith('Prompt tools: ')) {
    return 'Guard'
  }

  return ['/compact', '/context', '/cost'].includes(cmd.trim()) ? 'Claude Code' : 'Cockpit'
}

export const drawPalette = (
  ui: Ui,
  look: PaneLook,
  palette: readonly (readonly [string, string])[],
  fill: (command: string) => unknown,
) => {
  const { Box, Button } = ui
  const groups = [...new Set(palette.map(([cmd, about]) => groupOf(cmd, about)))]

  return (
    <Box flexDirection="column" gap="xs">
      {picture(ui, titleCard('Command palette', `${palette.length}`, look))}
      {groups.map(group => {
        const rows = palette.filter(([cmd, about]) => groupOf(cmd, about) === group)

        return (
          <Box flexDirection="column" gap="xs" marginTop="sm">
            {picture(ui, commandCard(group, rows.map(([cmd, about]) => [cmd.trim(), about] as const), look))}
            <Box gap="sm" flexWrap="wrap">
              {rows.map(([cmd]) => (
                <Button key={`cmd-${cmd.trim()}`} label={cmd.trim()} onPress={() => fill(cmd)} />
              ))}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
