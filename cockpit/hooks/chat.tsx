// The chat looks and the step line under the working row. Colours are the app's own names, so
// light and dark follow the app; nothing here uses gradients, shadows or pictures.
import type { ElementTable, ThemeStyle } from 'claude-code'

import type { BarLive } from './bar'

export const CHAT_STYLE: ThemeStyle = {
  Text: { fontSize: 15, lineHeight: 24 },
  Heading: { fontWeight: 'semibold' },
  UserMessage: { color: 'text-primary', backgroundColor: 'surface-1', radius: 12, paddingX: 14, paddingY: 8 },
  ToolUse: { color: 'text-secondary', fontFamily: ['mono'], borderColor: 'border', borderWidth: 1, radius: 8, paddingX: 10, paddingY: 4 },
}

export const ROOMY_STYLE: ThemeStyle = {
  Text: { fontSize: 19, lineHeight: 30 },
  Heading: { fontWeight: 'bold' },
  UserMessage: { color: 'text-accent', backgroundColor: 'bg-accent', radius: 18, paddingX: 18, paddingY: 12 },
  ToolUse: { color: 'text-primary', fontFamily: ['mono'], backgroundColor: 'surface-1', radius: 10, paddingX: 14, paddingY: 10 },
}

export type ChatStyleName = 'roomy' | 'clean'

export const styleFor = (name: ChatStyleName | undefined): ThemeStyle => (name === 'clean' ? CHAT_STYLE : ROOMY_STYLE)

const SEGMENTS = 12

export type Steps = { bar: string; text: string }

/** Where Claude's task list stands, or null when there is no unfinished list worth showing. */
export const stepsOf = (tasks: BarLive['tasks']): Steps | null => {
  const done = tasks.filter(t => t.status === 'completed').length

  if (tasks.length < 2 || done === tasks.length) {
    return null
  }
  const current = tasks.find(t => t.status === 'in_progress')
  const number = current === undefined ? done + 1 : tasks.indexOf(current) + 1
  const filled = tasks.length <= SEGMENTS ? done : Math.floor((done / tasks.length) * SEGMENTS)
  const width = Math.min(SEGMENTS, tasks.length)
  const label = current?.label ?? ''

  return {
    bar: '▰'.repeat(filled) + '▱'.repeat(width - filled),
    text: `Step ${number} of ${tasks.length}${label === '' ? '' : `: ${label}`}`,
  }
}

type Kit = Pick<ElementTable<'desktop'>, 'Box' | 'Text'>

export const drawSteps = (ui: Kit, steps: Steps, native: unknown) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column">
      {native as never}
      <Box gap="sm">
        <Text mono>{steps.bar}</Text>
        <Text dimColor>{steps.text}</Text>
      </Box>
    </Box>
  )
}
