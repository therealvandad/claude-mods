// Right-click actions on Claude's replies and on selected text. Nothing shows until the menu opens,
// and every action only puts text in the prompt box or pins it: nothing is sent.
import type { ElementTable } from 'claude-code'

export const QUOTE_MAX = 600
export const PIN_MAX = 200
const TEXTS_KEPT = 200

/** Remembers a drawn reply, newest last, so the menu can quote the one that was clicked. */
export const rememberText = (texts: Map<string, string>, id: string, text: string) => {
  texts.delete(id)
  texts.set(id, text.slice(0, QUOTE_MAX * 2))

  if (texts.size > TEXTS_KEPT) {
    texts.delete(texts.keys().next().value as string)
  }
}

type Props = {
  row?: { component: string; requestId: string }
  selection?: { text: string }
}

/** What the menu is about: the selection first, else the clicked reply; null when neither is ours to act on. */
export const menuTarget = (props: Props, texts: ReadonlyMap<string, string>): { text: string } | null => {
  const selected = props.selection?.text.trim() ?? ''

  if (selected !== '') {
    return { text: selected }
  }

  if (props.row?.component !== 'AssistantMessage') {
    return null
  }
  const found = texts.get(props.row.requestId)?.trim() ?? ''

  return found === '' ? null : { text: found }
}

export const quote = (text: string): string => {
  const clipped = text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text

  return clipped.replace(/^/gm, '> ')
}

export const pinText = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, PIN_MAX)

export const ASKS = [
  ['menu-simpler', 'Explain simpler', 'Explain this more simply:'],
  ['menu-shorter', 'Shorter', 'Say this more briefly:'],
  ['menu-test', 'How to test this', 'Show me how to test this:'],
] as const

type Kit = Pick<ElementTable<'desktop'>, 'Box' | 'Button'>

export const drawMenu = (ui: Kit, ask: (lead: string) => unknown, pin: () => unknown, others: unknown) => {
  const { Box, Button } = ui

  return (
    <Box flexDirection="column">
      {ASKS.map(([key, label, lead]) => (
        <Button key={key} label={label} onPress={() => ask(lead)} />
      ))}
      <Button key="menu-pin" label="Pin this" onPress={() => pin()} />
      {others as never}
    </Box>
  )
}
