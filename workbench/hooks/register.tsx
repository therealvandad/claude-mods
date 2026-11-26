import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import type { Call, Limit, TimerState } from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]

const calls = atom({ plugin: 'workbench', key: 'calls' } as const, [], { shape: 'calls-1' })
const files = atom({ plugin: 'workbench', key: 'files' } as const, [], { shape: 'files-1' })
const notes = atom({ plugin: 'workbench', key: 'notes' } as const, [], { shape: 'notes-1' })
const timer = atom({ plugin: 'workbench', key: 'timer' } as const, null, { shape: 'timer-2' })
const now = atom({ plugin: 'workbench', key: 'now' } as const, 0)
const sessionStart = atom({ plugin: 'workbench', key: 'sessionStart' } as const, 0)
const turns = atom({ plugin: 'workbench', key: 'turns' } as const, 0)
const contextPercent = atom({ plugin: 'workbench', key: 'contextPercent' } as const, null)
const costUsd = atom({ plugin: 'workbench', key: 'costUsd' } as const, null)
const limits = atom({ plugin: 'workbench', key: 'limits' } as const, [], { shape: 'limits-1' })
const budget = atom({ plugin: 'workbench', key: 'budget' } as const, null)
const isFocus = atom({ plugin: 'workbench', key: 'isFocus' } as const, false)
const isBandHidden = atom({ plugin: 'workbench', key: 'isBandHidden' } as const, false)

const PANES = {
  dashboard: 'Session dashboard',
  files: 'Changed files',
  notes: 'Notes',
  timer: 'Timer',
} as const
type PaneId = keyof typeof PANES

const bar = (frac: number, width = 12) =>
  '█'.repeat(Math.round(Math.max(0, Math.min(1, frac)) * width)).padEnd(width, '░')

const toneOf = (percent: number) => (percent >= 85 ? 'error' : percent >= 70 ? 'warning' : 'success')

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const CHIPS = [
  { label: 'Run tests', text: 'Run the tests and tell me what fails.' },
  { label: 'Explain', text: 'Explain what you just did, briefly.' },
  { label: 'Commit', text: 'Commit the current changes with a clear message.' },
] as const

const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

const detailOf = (input: Record<string, unknown>): string => {
  const pick = input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? ''

  return String(pick).replace(/\s+/g, ' ').slice(0, 80)
}

const LONG_MS = 60_000
const warned = new Set<string>()
let recent: string[] = []
let isOverBudget = false
let ticker: Timer | undefined
let alarm: Timer | undefined

const saveNotes = (d: Dollar, list: string[]) => d.store.set('notes', list)

const startTimer = async (d: Dollar, minutes: number, label = 'Focus') => {
  alarm?.cancel()
  const ms = Math.round(minutes * 60_000)
  const at = (await d.clock.now()) + ms
  await update(d, timer, () => ({ endsAt: at, totalMs: ms, label }) as TimerState)
  alarm = d.clock.after(ms, () => {
    void update(d, timer, () => null)
    d.ui.toast(`${label} timer finished (${minutes} min)`, { timeoutMs: 10_000 })
  })
}

const stopTimer = async (d: Dollar) => {
  alarm?.cancel()
  await update(d, timer, () => null)
}

const openPane = (d: Dollar, id: PaneId) => d.ui.open({ id, title: PANES[id] })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('notes')
    await update($, notes, () => (Array.isArray(saved) ? saved.map(String) : []))
    const usage = await $.session.usage()
    await update($, sessionStart, () => usage.startedAt)
    const t0 = await $.clock.now()
    await update($, now, () => t0)

    for (const [name, description] of [
      ['dashboard', 'Open the live session dashboard pane'],
      ['files', 'Open the changed-files pane'],
      ['notes', 'Open the notes pane'],
      ['note', 'Save a note: /note <text>'],
      ['timer', 'Start a timer: /timer <minutes> (or /timer off)'],
      ['budget', 'Set a spend alert in dollars: /budget <usd> (or /budget off)'],
      ['focus', 'Toggle focus mode: hides the band above the prompt'],
      ['sessionrecap', 'Summarize this session as standup notes'],
    ] as const) {
      await $.command.register({ name, description }).catch(() => undefined)
    }

    ticker?.cancel()
    ticker = $.clock.every(1000, () => {
      void $.clock.now().then(async t => {
        await update($, now, () => t)

        for (const c of await read($, calls)) {
          if (!c.isDone && t - c.startedAt > LONG_MS && !warned.has(c.id)) {
            warned.add(c.id)
            $.ui.toast(`${c.tool} has run for over a minute: ${c.detail.slice(0, 50)}`, { timeoutMs: 8000 })
          }
        }
      })
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turns, n => n + 1)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id ?? `${e.tool}-${await $.clock.now()}`
    const call: Call = {
      id,
      tool: e.tool,
      detail: detailOf(input),
      isDone: false,
      startedAt: await $.clock.now(),
    }
    await update($, calls, list => [...list, call].slice(-200))
    recent = [...recent, `${e.tool}:${call.detail}`].slice(-3)

    if (recent.length === 3 && recent.every(k => k === recent[0]) && call.detail !== '') {
      $.ui.toast(`Possible loop: ${e.tool} repeated 3 times with the same input.`, { timeoutMs: 8000 })
      recent = []
    }

    if (EDIT_TOOLS.has(e.tool)) {
      const path = String(input.file_path ?? input.notebook_path ?? '')

      if (path !== '') {
        await update($, files, list => (list.includes(path) ? list : [...list, path]))
      }
    }

    const ran = await next(e)
    await update($, calls, list => list.map(one => (one.id === id ? { ...one, isDone: true } : one)))
    const all = await read($, calls)
    const fileCount = (await read($, files)).length
    $.ui.status(`${all.length} tools · ${fileCount} files`)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const { context, cost, rateLimits } = await $.session.usage()
    await update($, contextPercent, () => context.percent ?? null)
    await update($, costUsd, () => cost?.usd ?? null)
    await update($, limits, () => rateLimits.map((r): Limit => ({ kind: r.kind, percent: r.percentUsed })))
    const cap = await read($, budget)

    if (cap !== null && cost !== undefined && cost.usd >= cap && !isOverBudget) {
      isOverBudget = true
      $.ui.toast(`Spend alert: ${cost.usd.toFixed(2)} dollars reached your ${cap.toFixed(2)} budget.`, { timeoutMs: 10_000 })
    }

    if ((context.percent ?? 0) >= 85) {
      $.ui.toast(`Context is ${context.percent}% full. Consider /compact or a new session.`)
    }

    return next(e)
  })

  on('command.run', { command: 'dashboard' }, async $ => {
    await openPane($, 'dashboard')

    return { text: 'Dashboard opened.' }
  })
  on('command.run', { command: 'files' }, async $ => {
    await openPane($, 'files')

    return { text: 'Changed-files pane opened.' }
  })
  on('command.run', { command: 'notes' }, async $ => {
    await openPane($, 'notes')

    return { text: 'Notes pane opened.' }
  })

  on('command.run', { command: 'note' }, async ($, e) => {
    const text = e.args.trim()

    if (text === '') {
      return { text: 'Usage: /note <text>' }
    }
    const next = [...(await read($, notes)), text]
    await update($, notes, () => next)
    await saveNotes($, next)

    return { text: `Noted (${next.length} total).` }
  })

  on('command.run', { command: 'timer' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'off' || arg === 'stop') {
      await stopTimer($)

      return { text: 'Timer stopped.' }
    }
    const minutes = arg === '' ? 25 : Number(arg)

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return { text: 'Usage: /timer <minutes> or /timer off' }
    }
    await startTimer($, minutes)
    await openPane($, 'timer')

    return { text: `Timer set for ${minutes} min.` }
  })

  on('command.run', { command: 'budget' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace('$', '')

    if (arg === 'off' || arg === '') {
      await update($, budget, () => null)
      isOverBudget = false

      return { text: 'Spend alert off.' }
    }
    const usd = Number(arg)

    if (!Number.isFinite(usd) || usd <= 0) {
      return { text: 'Usage: /budget <usd> or /budget off' }
    }
    await update($, budget, () => usd)
    isOverBudget = false

    return { text: `Spend alert set at ${usd.toFixed(2)} dollars.` }
  })

  on('command.run', { command: 'focus' }, async $ => {
    const next = !(await read($, isFocus))
    await update($, isFocus, () => next)

    return { text: next ? 'Focus mode on: band hidden.' : 'Focus mode off.' }
  })

  on('command.run', { command: 'sessionrecap' }, async $ => {
    const list = await read($, calls)
    const changed = await read($, files)
    const saved = await read($, notes)
    const usage = await $.session.usage()
    const minutes = Math.round(((await $.clock.now()) - usage.startedAt) / 60_000)
    const lines = [
      `Standup recap (${minutes} min session)`,
      `- ${list.length} tool calls, ${changed.length} files changed`,
      ...changed.slice(0, 10).map(f => `  • ${f}`),
      ...(saved.length > 0 ? ['Notes:', ...saved.map(n => `  - ${n}`)] : []),
    ]

    return { text: lines.join('\n') }
  })

  for (const id of Object.keys(PANES) as PaneId[]) {
    on('ui.render', { component: 'Pane', requestId: id }, async ($, e) => {
      const { Box, Text, Button } = $.ui.resolve(e)
      const room = Math.max(3, (e.viewport?.rows ?? 24) - 6)

      const Heading = (title: string, right?: string) => (
        <Box justifyContent="space-between" marginBottom="sm">
          <Text size="heading" weight="bold">
            {title}
          </Text>
          {right !== undefined && (
            <Text dimColor mono tabular>
              {right}
            </Text>
          )}
        </Box>
      )

      const Section = (label: string) => (
        <Box marginTop="md">
          <Text size="caption" weight="semibold" dimColor>
            {label.toUpperCase()}
          </Text>
        </Box>
      )

      const Tile = (label: string, value: string, color?: string) => (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm" flexGrow={1}>
          <Text size="caption" dimColor>
            {label}
          </Text>
          <Text size="heading" weight="bold" tabular color={color}>
            {value}
          </Text>
        </Box>
      )

      const Gauge = (label: string, percent: number) => (
        <Box gap="sm">
          <Text dimColor mono>
            {label.padEnd(9)}
          </Text>
          <Text mono color={toneOf(percent)}>
            {bar(percent / 100)}
          </Text>
          <Text mono tabular>
            {String(Math.round(percent)).padStart(3)}%
          </Text>
        </Box>
      )

      if (id === 'dashboard') {
        const list = await read($, calls)
        const t = await read($, now)
        const start = await read($, sessionStart)
        const changed = await read($, files)
        const turnCount = await read($, turns)
        const percent = await read($, contextPercent)
        const spend = await read($, costUsd)
        const cap = await read($, budget)
        const windows = await read($, limits)
        const byTool = new Map<string, number>()

        for (const c of list) {
          byTool.set(c.tool, (byTool.get(c.tool) ?? 0) + 1)
        }
        const top = [...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        const max = Math.max(1, ...top.map(([, n]) => n))
        const running = list.filter(c => !c.isDone)
        const recent = list.slice(-Math.max(2, room - 14)).reverse()

        return (
          <Box flexDirection="column" padding="sm">
            {Heading('Session', start > 0 && t > 0 ? clock(t - start) : '--:--')}
            <Box gap="sm">
              {Tile('Prompts', String(turnCount))}
              {Tile('Tools', String(list.length))}
              {Tile('Files', String(changed.length))}
              {Tile(
                cap === null ? 'Spend' : `Spend / ${cap.toFixed(0)}`,
                spend === null ? 'n/a' : `$${spend.toFixed(2)}`,
                cap !== null && spend !== null && spend >= cap ? 'error' : undefined,
              )}
            </Box>

            {Section('Limits')}
            {percent !== null && Gauge('Context', percent)}
            {windows.map(w => Gauge(w.kind.replace('_', ' '), w.percent))}
            {percent === null && windows.length === 0 && <Text dimColor>Fills in after the first reply.</Text>}

            {Section('Top tools')}
            {top.length === 0 && <Text dimColor>No tool calls yet.</Text>}
            {top.map(([tool, n]) => (
              <Box gap="sm">
                <Text mono color="suggestion">
                  {bar(n / max, 10)}
                </Text>
                <Text>{tool}</Text>
                <Text dimColor tabular>
                  {n}
                </Text>
              </Box>
            ))}

            {Section(running.length > 0 ? `Running (${running.length})` : 'Activity')}
            {running.length === 0 && recent.length === 0 && <Text dimColor>Idle.</Text>}
            {running.slice(-3).map(c => (
              <Text color="suggestion">
                ● {c.tool} <Text dimColor>{c.detail}</Text>
              </Text>
            ))}
            {recent
              .filter(c => c.isDone)
              .map(c => (
                <Text>
                  <Text color="success">✓</Text> {c.tool} <Text dimColor>{c.detail}</Text>
                </Text>
              ))}
          </Box>
        )
      }

      if (id === 'files') {
        const changed = await read($, files)

        return (
          <Box flexDirection="column" padding="sm">
            {Heading('Changed files', `${changed.length}`)}
            {changed.length === 0 && (
              <Text dimColor>Nothing edited yet. Files Claude changes will collect here.</Text>
            )}
            {changed
              .slice(-room)
              .reverse()
              .map(f => {
                const at = f.lastIndexOf('/')

                return (
                  <Box gap="sm">
                    <Text weight="semibold">{f.slice(at + 1)}</Text>
                    <Text dimColor>{at > 0 ? f.slice(0, at) : ''}</Text>
                  </Box>
                )
              })}
          </Box>
        )
      }

      if (id === 'notes') {
        const list = await read($, notes)

        return (
          <Box flexDirection="column" padding="sm">
            {Heading('Notes', `${list.length}`)}
            {list.length === 0 && <Text dimColor>No notes yet. Add one with /note your text.</Text>}
            {list.slice(-room).map(n => (
              <Box gap="sm">
                <Text color="suggestion">•</Text>
                <Text>{n}</Text>
              </Box>
            ))}
            {list.length > 0 && (
              <Box marginTop="md">
                <Button
                  key="clear"
                  label="Clear all"
                  onPress={async () => {
                    await update($, notes, () => [])
                    await saveNotes($, [])
                  }}
                />
              </Box>
            )}
          </Box>
        )
      }

      const t = await read($, timer)
      const nowMs = await read($, now)
      const left = t === null ? 0 : Math.max(0, t.endsAt - nowMs)
      const used = t === null ? 0 : 1 - left / Math.max(1, t.totalMs)

      return (
        <Box flexDirection="column" padding="sm">
          {Heading('Timer', t?.label)}
          <Text size="title" weight="bold" mono tabular dimColor={t === null}>
            {t === null ? '--:--' : clock(left)}
          </Text>
          {t !== null && (
            <Text mono color="suggestion">
              {bar(used, 24)}
            </Text>
          )}
          {t === null && <Text dimColor>Pick a length to start.</Text>}
          <Box gap="sm" marginTop="md">
            {[5, 15, 25, 50].map(m => (
              <Button key={`m${m}`} label={`${m} min`} onPress={() => startTimer($, m)} />
            ))}
            {t !== null && <Button key="stop" label="Stop" onPress={() => stopTimer($)} />}
          </Box>
        </Box>
      )
    })
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden)) || (await read($, isFocus))) {
      return next(e)
    }
    const percent = await read($, contextPercent)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        {percent !== null && (
          <Text dimColor={percent < 70} color={percent >= 70 ? toneOf(percent) : undefined} tabular>
            ctx {percent}%{' '}
          </Text>
        )}
        {CHIPS.map(chip => (
          <Button
            key={chip.label}
            label={chip.label}
            onPress={() => $.prompt.fill({ text: chip.text, mode: 'replace' })}
          />
        ))}
        <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })
}
