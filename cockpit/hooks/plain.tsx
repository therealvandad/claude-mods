// The plain look: the app's own text and buttons, one row above the prompt, nothing while there is
// nothing to do, and colour only where it means something (red: failing, amber: needs you).
import type { ElementTable } from 'claude-code'

import type { BarButton, BarLive } from './bar'

export type View = { look: 'plain' | 'rich'; clean: boolean; alert: boolean; chat: boolean; chatStyle: 'roomy' | 'clean'; rows: boolean }

export const DEFAULT_VIEW: View = { look: 'plain', clean: false, alert: true, chat: true, chatStyle: 'roomy', rows: true }

export const viewOf = (raw: unknown): View => {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  return { look: r.look === 'rich' ? 'rich' : 'plain', clean: r.clean === true, alert: r.alert !== false, chat: r.chat !== false, chatStyle: r.chatStyle === 'clean' ? 'clean' : 'roomy', rows: r.rows !== false }
}

export const CONTEXT_FULL = 80
export const LONG_TURN_MS = 60_000
export const PROMPT_BUTTONS = 5
const PROMPTS_KEPT = 200

const fill = (id: string, label: string, text: string): BarButton => ({ id, label, kind: 'fill', text })

export const RUN_TESTS = fill('plain-tests', 'Run tests', 'Run the tests and tell me what fails.')
export const FIX_TESTS = fill('plain-fix', 'Fix it', 'The tests failed. Find the cause and fix it.')
export const UNDO = fill('plain-undo', 'Undo', '/rollback')
export const COMPACT = fill('plain-compact', 'Compact', '/compact')

const HOME_TAB: BarButton = { id: 'plain-home', label: 'Home', kind: 'tab', tab: 'overview' }

export const quietNotice = (figures: string): Notice => ({ text: figures === '' ? 'Cockpit ready' : '', tone: undefined, buttons: [HOME_TAB] })

export const figuresOf = (live: BarLive): string =>
  [
    live.contextPct === null ? '' : `Context ${Math.round(live.contextPct)}%`,
    live.costUsd === null ? '' : `$${live.costUsd.toFixed(2)}`,
  ]
    .filter(x => x !== '')
    .join(' · ')

export type Notice = { text: string; tone: 'error' | 'warning' | undefined; buttons: BarButton[] }

const filesChanged = (n: number) => `${n} file${n === 1 ? '' : 's'} changed`

/** The one thing worth saying right now, or null: then nothing is drawn at all. */
export const noticeOf = (live: BarLive, o: { isWorking: boolean; hasGit: boolean }): Notice | null => {
  if (live.waiting !== null) {
    return {
      text: live.waiting === 'question' ? 'Needs you: a question is waiting' : 'Needs you: an approval is waiting',
      tone: 'warning',
      buttons: [],
    }
  }

  if (o.isWorking) {
    return null
  }
  const isFull = live.contextPct !== null && live.contextPct >= CONTEXT_FULL
  // Putting files back needs git, so the button only shows in a git project.
  const second = isFull ? [COMPACT] : o.hasGit ? [UNDO] : []
  const count = live.unproven?.length ?? 0

  if (live.test !== null && !live.test.ok && !live.isUntested) {
    const failed = live.test.failed ?? 0

    return { text: failed > 0 ? `Tests failed: ${failed} failing` : 'Tests failed', tone: 'error', buttons: [FIX_TESTS, ...second] }
  }

  if (live.isUntested && count > 0) {
    return { text: `${filesChanged(count)}, not tested yet`, tone: undefined, buttons: [RUN_TESTS, ...second] }
  }

  return isFull ? { text: 'Context is nearly full', tone: 'warning', buttons: [COMPACT] } : null
}

// ------------------------------------------------------------------ the person's own prompts

const SECRETISH = /(sk-|ghp_|github_pat_|AKIA|xox[bap]-|passw|secret|token|api[_-]?key|bearer\s|[A-Za-z0-9+/_-]{32,}|\/Users\/|\/home\/|[A-Za-z]:\\|\S+@\S+\.\w)/i

/** Counts a short, one-line prompt. Anything long or that looks like it holds a secret is not kept. */
export const countPrompt = (kept: Record<string, number>, raw: string): Record<string, number> => {
  const text = raw.trim()

  if (text.length < 8 || text.length > 160 || text.includes('\n') || text.startsWith('/') || SECRETISH.test(text)) {
    return kept
  }
  const next = { ...kept, [text]: (kept[text] ?? 0) + 1 }
  const rows = Object.entries(next)

  if (rows.length <= PROMPTS_KEPT) {
    return next
  }
  // The newest is always kept; the rarest of the others makes room.
  const others = rows.filter(([k]) => k !== text).sort((a, b) => b[1] - a[1])

  return Object.fromEntries([[text, next[text] ?? 1], ...others.slice(0, PROMPTS_KEPT - 1)])
}

export const topPrompts = (kept: Record<string, number>): string[] =>
  Object.entries(kept)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, PROMPT_BUTTONS)
    .map(([text]) => text)

export const countsOf = (raw: unknown): Record<string, number> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter((x): x is [string, number] => typeof x[1] === 'number'))
    : {}

export const longTurnText = (ms: number): string => {
  const s = Math.round(ms / 1000)

  return `Done after ${Math.floor(s / 60)}m ${s % 60}s`
}

// ------------------------------------------------------------------ drawing

type Kit = Pick<ElementTable<'desktop'>, 'Box' | 'Text' | 'Button'>

export const drawPlainBand = (ui: Kit, notice: Notice, figures: string, press: (b: BarButton) => unknown, below: unknown) => {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="column">
      {below as never}
      <Box gap="md">
        {notice.text !== '' && (
          <Text weight="semibold" color={notice.tone}>
            {notice.text}
          </Text>
        )}
        {figures !== '' && <Text dimColor>{figures}</Text>}
        {notice.buttons.map(b => (
          <Button key={`bar-${b.id}`} label={b.label} onPress={() => press(b)} />
        ))}
      </Box>
    </Box>
  )
}

export type Home = {
  live: BarLive
  view: View
  branch: string
  uncommitted: number | null
  age: string
  prompts: string[]
}

export type HomeActions = {
  press: (b: BarButton) => unknown
  set: (patch: Partial<View>) => unknown
  forget: () => unknown
}

/** One layout: a heading, then short sections of one sentence and its buttons. */
export const drawPlainHome = (ui: Kit, d: Home, act: HomeActions) => {
  const { Box, Text, Button } = ui
  const count = d.live.unproven?.length ?? 0
  const test = d.live.test
  const isFailing = test !== null && !test.ok && !d.live.isUntested
  const status = isFailing
    ? 'Tests failed.'
    : d.live.isUntested && count > 0
      ? `${filesChanged(count)}, not tested yet.`
      : test?.ok === true
        ? 'Tests passed since the last edit.'
        : 'No edits waiting for a test.'
  const facts = [
    figuresOf(d.live),
    d.branch === '' ? '' : `${d.branch}${d.uncommitted === null ? '' : `, ${d.uncommitted} uncommitted`}`,
  ]
    .filter(x => x !== '')
    .join(' · ')
  const isFull = d.live.contextPct !== null && d.live.contextPct >= CONTEXT_FULL

  const Title = (label: string) => (
    <Box marginTop="md">
      <Text size="caption" weight="semibold" dimColor>
        {label}
      </Text>
    </Box>
  )

  const Press = (b: BarButton, key: string, label = b.label) => <Button key={key} label={label} onPress={() => act.press(b)} />

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text size="heading" weight="bold">
          Home
        </Text>
        <Text dimColor tabular>
          {d.age}
        </Text>
      </Box>
      <Text dimColor>{facts === '' ? 'Figures appear after the first reply.' : facts}</Text>

      {Title('Changes')}
      <Text color={isFailing ? 'error' : undefined}>{status}</Text>
      {d.live.isUntested && count > 0 && (
        <Text dimColor>
          {(d.live.unproven ?? [])
            .slice(-8)
            .map(p => p.split(/[\\/]/).pop())
            .join(', ')}
        </Text>
      )}
      <Box gap="sm" flexWrap="wrap">
        {isFailing ? Press(FIX_TESTS, 'home-fix') : Press(RUN_TESTS, 'home-tests')}
        {isFull && Press(COMPACT, 'home-compact')}
      </Box>

      {Title('Undo')}
      <Text dimColor>Needs a git project, and undo switched on before the edit. It shows a preview first.</Text>
      <Box gap="sm" flexWrap="wrap">
        {Press(UNDO, 'home-undo', 'Undo last turn')}
        {Press(fill('plain-snapshot', 'Switch undo on', '/snapshot on'), 'home-snapshot')}
      </Box>

      {Title('Spending limit')}
      <Box gap="sm" flexWrap="wrap">
        {['2', '5', '10', '20'].map(n => Press(fill(`plain-cap-${n}`, `$${n}`, `/hardbudget ${n}`), `home-cap-${n}`))}
        {Press(fill('plain-cap-off', 'Off', '/hardbudget off'), 'home-cap-off')}
      </Box>

      {Title('My prompts')}
      {d.prompts.length === 0 && <Text dimColor>A short prompt you send twice appears here as a button.</Text>}
      <Box flexDirection="column" alignItems="flex-start">
        {d.prompts.map((p, i) => Press(fill(`plain-mine-${i}`, p, p), `home-mine-${i}`, p.length > 60 ? `${p.slice(0, 59)}…` : p))}
        {d.prompts.length > 0 && <Button key="home-forget" dimColor label="Forget these" onPress={() => act.forget()} />}
      </Box>

      {Title('Switches')}
      <Box gap="sm" flexWrap="wrap">
        <Button
          key="home-alert"
          label={`Done pop-up: ${d.view.alert ? 'on' : 'off'}`}
          onPress={() => act.set({ alert: !d.view.alert })}
        />
        <Button key="home-clean" label={`Hide everything: ${d.view.clean ? 'on' : 'off'}`} onPress={() => act.set({ clean: !d.view.clean })} />
        <Button
          key="home-chat"
          label={`Chat look: ${d.view.chat !== false ? 'on' : 'off'}`}
          onPress={() => act.set({ chat: d.view.chat === false })}
        />
        <Button
          key="home-chat-size"
          label={d.view.chatStyle === 'clean' ? 'Make chat roomy' : 'Make chat smaller'}
          onPress={() => act.set({ chatStyle: d.view.chatStyle === 'clean' ? 'roomy' : 'clean' })}
        />
        <Button key="home-rows" label={`Row notes: ${d.view.rows !== false ? 'on' : 'off'}`} onPress={() => act.set({ rows: d.view.rows === false })} />
        <Button key="home-look" label="Use the rich look" onPress={() => act.set({ look: 'rich' })} />
      </Box>
      <Text size="caption" dimColor>
        Buttons put text in the prompt box. Nothing is sent until you press Enter.
      </Text>
    </Box>
  )
}
