// One short line under an edit or command row: whether the edit has been tested, why a command
// failed, or how long a slow one has been running. The app's own row is kept above it.
import type { ElementTable } from 'claude-code'

export type Mark = 'untested' | 'tested' | 'failed'
export type Marks = Record<string, Mark>

export const SLOW_MS = 10_000
const MARKS_KEPT = 200

export const addMark = (marks: Marks, id: string): Marks =>
  Object.fromEntries([...Object.entries(marks).filter(([k]) => k !== id), [id, 'untested' as Mark]].slice(-MARKS_KEPT))

/** A test run answers for every edit before it: passing covers them all, failing marks the unproven ones. */
export const settleMarks = (marks: Marks, isPassed: boolean): Marks =>
  Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, isPassed ? 'tested' : v === 'tested' ? 'tested' : 'failed']))

export type RowNote = { text: string; tone: 'error' | 'success' | undefined }

export const markNote = (mark: Mark | undefined): RowNote | null =>
  mark === undefined
    ? null
    : mark === 'tested'
      ? { text: '✓ tested', tone: 'success' }
      : mark === 'failed'
        ? { text: '✗ tests failed after this edit', tone: 'error' }
        : { text: '○ not tested yet', tone: undefined }

const TELLING = /error|fail|not found|no such|denied|cannot|can't|refused|exception|fatal|invalid|undefined/i

/** The line that best says why: the first one that sounds like an error, else the first with words. */
export const errorLine = (output: unknown): string => {
  const lines = (typeof output === 'string' ? output : '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !/^exit (code|status):? \d+$/i.test(l))
  const hit = lines.find(l => TELLING.test(l)) ?? lines[0] ?? ''

  return hit.length > 160 ? `${hit.slice(0, 159)}…` : hit
}

export const errorNote = (output: unknown): RowNote | null => {
  const line = errorLine(output)

  return line === '' ? null : { text: line, tone: 'error' }
}

export const slowNote = (seconds: number | undefined): RowNote | null =>
  seconds === undefined
    ? null
    : { text: `Running for ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}`, tone: undefined }

type Kit = Pick<ElementTable<'desktop'>, 'Box' | 'Text'>

export const drawNote = (ui: Kit, note: RowNote, native: unknown) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column">
      {native as never}
      <Text color={note.tone} dimColor={note.tone === undefined}>
        {note.text}
      </Text>
    </Box>
  )
}
