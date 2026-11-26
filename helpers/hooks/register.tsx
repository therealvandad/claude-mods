import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import {
  addChange,
  baseName,
  closingQuestion,
  commandKey,
  commitPlan,
  deleteTargets,
  factsLine,
  FEATURES,
  footerFor,
  isTestCommand,
  keyOf,
  lineDelta,
  LONG_TURN_MS,
  looksSecret,
  parseShortcut,
  plainWords,
  quote,
  remember,
  riskyFiles,
  SOUND_TURN_MS,
  spanOf,
  stepsAfter,
  summaryLines,
  tailOf,
  usual,
} from './pure'
import type { Change, Footer, Shortcut, Step } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]
type Tab = 'switches' | 'changes' | 'steps' | 'notes'
type Show = { off: string[]; quiet: boolean }

const PANE = 'helpers'
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit'])
const STEP_TOOLS = new Set(['TodoWrite', 'mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up'])
const AWAY_MS = 3 * 3_600_000

const show = atom({ plugin: 'helpers', key: 'show' } as const, { off: [], quiet: false } as Show, { shape: 'show-1' })
const tab = atom({ plugin: 'helpers', key: 'tab' } as const, 'switches' as Tab)
const changes = atom({ plugin: 'helpers', key: 'changes' } as const, [] as Change[], { shape: 'changes-1' })
const turn = atom({ plugin: 'helpers', key: 'turn' } as const, { usd: null as number | null, failed: 0, isTested: false }, { shape: 'turn-1' })
const steps = atom({ plugin: 'helpers', key: 'steps' } as const, [] as Step[], { shape: 'steps-1' })
const footers = atom({ plugin: 'helpers', key: 'footers' } as const, [] as Footer[], { shape: 'footers-1' })
const notes = atom({ plugin: 'helpers', key: 'notes' } as const, [] as string[], { shape: 'notes-1' })
const shortcuts = atom({ plugin: 'helpers', key: 'shortcuts' } as const, [] as Shortcut[], { shape: 'shortcuts-1' })
const testCommand = atom({ plugin: 'helpers', key: 'testCommand' } as const, '')
const lastTime = atom({ plugin: 'helpers', key: 'lastTime' } as const, '')
const usualFor = atom({ plugin: 'helpers', key: 'usualFor' } as const, {} as Record<string, number>, { shape: 'usual-1' })
const diff = atom({ plugin: 'helpers', key: 'diff' } as const, { path: '', lines: [] as string[] }, { shape: 'diff-1' })

// Not state: nothing redraws when these change.
const replyTexts = new Map<string, string>()
const editPaths = new Map<string, string>()
let project = 'all'
let lastAsk = ''
let heldPrompt = ''
let isCommitAllowed = false

// Switched off in the app's settings (userConfig): it stays off whatever the pane's switch says.
let setOff: readonly string[] = []
const isOn = (s: Show, id: string) => !s.off.includes(id) && !setOff.includes(id)
const isShown = (s: Show, id: string) => !s.quiet && isOn(s, id)

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const load = async (d: Dollar) => {
  const off = strings(await d.store.get('off'))
  const quiet = (await d.store.get('quiet')) === true
  await update(d, show, () => ({ off, quiet }))
  const kept = strings(await d.store.get('notes'))
  await update(d, notes, () => kept)
  const mine = await d.store.get('shortcuts')
  await update(d, shortcuts, () =>
    Array.isArray(mine) ? (mine as Shortcut[]).filter(x => typeof x?.label === 'string' && typeof x?.text === 'string').slice(0, 8) : [],
  )
  const test = await d.store.get(`test:${project}`)
  await update(d, testCommand, () => (typeof test === 'string' ? test : ''))
}

const tellLastTime = async (d: Dollar) => {
  const recap = (await d.store.get(`recap:${project}`)) as { at?: number; ask?: string; files?: string[] } | undefined

  if (recap === undefined || typeof recap.at !== 'number') {
    return
  }
  const files = strings(recap.files)
  const line = [recap.ask ?? '', files.length === 0 ? '' : `changed ${files.join(', ')}`].filter(Boolean).join(' · ')
  await update(d, lastTime, () => line)
  const how = await read(d, show)

  if (line !== '' && isShown(how, 'tomorrow') && (await d.clock.now()) - recap.at > AWAY_MS) {
    d.ui.toast(`Last time here: ${line}`.slice(0, 200))
  }
}

const setShow = async (d: Dollar, patch: Partial<Show>) => {
  const next = { ...(await read(d, show)), ...patch }
  await update(d, show, () => next)
  await d.store.set('off', next.off)
  await d.store.set('quiet', next.quiet)
}

const toggle = async (d: Dollar, id: string) => {
  const { off } = await read(d, show)
  await setShow(d, { off: off.includes(id) ? off.filter(x => x !== id) : [...off, id] })
}

const toggleQuiet = async (d: Dollar) => {
  const quiet = !(await read(d, show)).quiet
  await setShow(d, { quiet })
  // The cockpit's row notes are the other thing on screen, so they follow. The call is queued until the
  // session is idle, so it is not waited for; without the cockpit it is simply refused.
  void d.command.run({ command: 'bar', args: quiet ? 'rows off' : 'rows on' }).catch(() => undefined)

  return quiet
}

const openTab = async (d: Dollar, to: Tab) => {
  await update(d, tab, () => to)
  await d.ui.open({ id: PANE, title: 'Helpers' })
}

const fill = async (d: Dollar, text: string) => {
  const filled = await d.prompt.fill({ text, mode: 'insert' })

  if (filled?.isFilled === false) {
    d.ui.toast('Could not fill the prompt box.')
  }
}

const saveNotes = async (d: Dollar, list: string[]) => {
  await update(d, notes, () => list)
  await d.store.set('notes', list)
}

const saveShortcuts = async (d: Dollar, list: Shortcut[]) => {
  await update(d, shortcuts, () => list)
  await d.store.set('shortcuts', list)
}

const showDiff = async (d: Dollar, path: string) => {
  const out = await d.process
    .run(['git', '--no-optional-locks', 'diff', '--no-color', '--', path], { timeoutMs: 5000 })
    .catch(() => null)
  const body = out === null || out.exitCode !== 0 ? [] : out.stdout.split('\n').filter(l => /^[-+@ ]/.test(l) && !/^(\+\+\+|---) /.test(l))
  await update(d, diff, () => ({ path, lines: body.slice(0, 60) }))
}

/** What a delete would take, as far as it can be listed. */
const deletePreview = async (d: Dollar, command: string): Promise<string> => {
  const { paths, hasPattern } = deleteTargets(command)
  const found: string[] = []

  for (const path of paths) {
    const entries = await d.fs.list(path).catch(() => null)

    if (entries !== null) {
      const names = entries.slice(0, 3).map(x => x.name)
      found.push(`${baseName(path)}/ holds ${entries.length} item${entries.length === 1 ? '' : 's'}${names.length > 0 ? ` (${names.join(', ')}${entries.length > 3 ? ', …' : ''})` : ''}`)
    } else if (!(await d.fs.exists(path).catch(() => true))) {
      found.push(`${baseName(path)} is not there`)
    }
  }

  if (hasPattern) {
    found.push('a pattern, so the full list is not known')
  }

  return found.join('; ')
}

const gitNames = async (d: Dollar, ...argv: string[]): Promise<string[]> => {
  const out = await d.process.run(['git', '--no-optional-locks', ...argv], { timeoutMs: 5000 })

  return out.exitCode === 0 ? out.stdout.split('\n').filter(Boolean) : []
}

/** The secret-looking files a commit command would include, as far as git can say beforehand. */
const riskyInCommit = async (d: Dollar, command: string): Promise<string[]> => {
  const plan = commitPlan(command)

  if (!plan.isCommit) {
    return []
  }
  const files = [...(await gitNames(d, 'diff', '--cached', '--name-only')), ...plan.added]

  if (plan.isAll) {
    files.push(...(await gitNames(d, 'diff', '--name-only')))
  }

  if (plan.isAddAll) {
    files.push(...(await gitNames(d, 'ls-files', '--others', '--modified', '--exclude-standard')))
  }

  return [...new Set(riskyFiles(files))]
}

const restoreDraft = (d: Dollar, text: string) => {
  d.clock.after(150, () => {
    void d.prompt
      .read()
      .then(box => (box.text === '' ? d.prompt.fill({ text, mode: 'replace' }) : undefined))
      .catch(() => undefined)
  })
}

export const register: Register = (on, options) => {
  // This mod's own section in the shared "Mod manager" settings panel.
  on('ui.render', { component: 'Pane', plugin: '*', requestId: 'mod-settings' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const how = await read($, show)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="column" marginTop="md">
          <Text weight="bold">Helpers</Text>
          <Box gap="sm" flexWrap="wrap">
            <Button key="hp-quiet" label={`Quiet mode: ${how.quiet ? 'on' : 'off'}`} onPress={() => toggleQuiet($)} />
            {FEATURES.map(f => (
              <Button key={`hp-${f.id}`} label={`${f.label}: ${setOff.includes(f.id) ? 'off' : isOn(how, f.id) ? 'on' : 'off'}`} onPress={() => toggle($, f.id)} />
            ))}
          </Box>
        </Box>
      </Box>
    )
  })

  setOff = ['footer', 'question', 'sound'].filter(id => options?.[id] === false)

  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['helpers', 'Helpers: switches, changes, steps and notes. /helpers allow-commit lets one held commit through'],
      ['changes', 'Files changed in the last turn, with diffs'],
      ['steps', "Claude's task list with how long each step took"],
      ['mynotes', 'Replies you saved as notes'],
      ['shortcut', 'Your right-click actions: /shortcut add <name> = <what to ask>'],
      ['quietmode', 'Hide extra lines, sounds and pop-ups (safety checks stay)'],
    ] as const) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    project = keyOf(e.cwd)
    lastAsk = ''
    heldPrompt = ''
    isCommitAllowed = false
    await load($).catch(() => undefined)
    await tellLastTime($).catch(() => undefined)

    return next(e)
  })

  // ------------------------------------------------------------ safety

  on('prompt.submit', async ($, e, next) => {
    const isTyped = e.command === undefined && e.isMeta !== true && (e.origin === undefined || e.origin.kind === 'composer' || e.origin.kind === 'bridge')

    if (!isTyped) {
      return next(e)
    }

    if (looksSecret(e.text)) {
      const key = keyOf(e.text)

      if (key !== heldPrompt && isOn(await read($, show), 'secrets')) {
        heldPrompt = key
        restoreDraft($, e.text)

        return { drop: 'Held: this looks like it contains a key or password. Send the same text again to send it anyway.' }
      }
    } else {
      lastAsk = e.text.replace(/\s+/g, ' ').trim().slice(0, 100)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String((e as { command?: unknown }).command ?? '')
    const how = await read($, show)

    if (isOn(how, 'commitguard') && commitPlan(command).isCommit) {
      const risky = await riskyInCommit($, command)

      if (risky.length > 0 && !isCommitAllowed) {
        return {
          deny: `helpers held this commit: it would include ${risky.slice(0, 3).join(', ')}, which usually holds secrets. Unstage it, or ask the person to type /helpers allow-commit if it is meant.`,
        }
      }
      isCommitAllowed = false
    }
    const parts: string[] = []
    const plain = isOn(how, 'approvals') ? plainWords(command) : null

    if (plain !== null) {
      parts.push(`In plain words (a guess): ${plain}`)
    }
    const preview = isOn(how, 'delpreview') ? await deletePreview($, command) : ''

    if (preview !== '') {
      parts.push(`Delete: ${preview}.`)
    }

    if (parts.length > 0 && e.tool_use_id !== undefined) {
      // shows only while a permission dialog is open for this call
      try {
        $.ui.notice(e.tool_use_id, parts.join(' '))
      } catch {
        // a surface that cannot show it simply does not
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------ watching

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const usd = await $.session
        .usage()
        .then(u => u.cost?.usd ?? null)
        .catch(() => null)
      await update($, changes, () => [])
      await update($, turn, () => ({ usd, failed: 0, isTested: false }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id ?? ''
    const isShell = e.tool === 'Bash' || e.tool === 'PowerShell'
    const command = isShell ? String(input.command ?? '') : ''
    const key = isShell && input.run_in_background !== true ? commandKey(command) : ''
    let startedAt = 0

    if (key !== '') {
      startedAt = await $.clock.now()
      const times = ((await $.store.get('times')) ?? {}) as Record<string, number[]>
      const typical = usual(times[key])

      if (typical !== null && id !== '') {
        await update($, usualFor, m => ({ ...m, [id]: typical }))
      }
    }
    const ran = await next(e)
    const isFailed = ran.deny !== undefined || ran.isError === true

    if (key !== '') {
      const times = ((await $.store.get('times')) ?? {}) as Record<string, number[]>
      const kept = remember(times, key, (await $.clock.now()) - startedAt)

      if (kept !== times && !isFailed) {
        await $.store.set('times', kept)
      }
      await update($, usualFor, m => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)))
    }

    if (isShell && isFailed && ran.deny === undefined) {
      await update($, turn, t => ({ ...t, failed: t.failed + 1 }))
    }

    if (isShell && ran.deny === undefined && isTestCommand(command)) {
      await update($, turn, t => ({ ...t, isTested: !isFailed }))

      if (!looksSecret(command) && command.length <= 300) {
        await update($, testCommand, () => command)
        await $.store.set(`test:${project}`, command)
      }
    }

    if (EDITS.has(e.tool) && !isFailed) {
      const path = String(input.file_path ?? input.notebook_path ?? '')

      if (path !== '') {
        editPaths.set(id, path)

        if (editPaths.size > 200) {
          editPaths.delete(editPaths.keys().next().value as string)
        }
        await update($, changes, list => addChange(list, { path, ...lineDelta(e.tool, input, ran.result) }))
        await update($, turn, t => ({ ...t, isTested: false }))
      }
    }

    if (STEP_TOOLS.has(e.tool) && !isFailed && input.agentId === undefined) {
      const at = await $.clock.now()
      await update($, steps, list => stepsAfter(list, e.tool, input, at))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || e.reason !== 'answer') {
      return next(e)
    }
    const how = await read($, show)
    const t = await read($, turn)
    const files = await read($, changes)
    const at = await $.clock.now()
    const usd = await $.session
      .usage()
      .then(u => u.cost?.usd ?? null)
      .catch(() => null)
    const spent = usd === null || t.usd === null ? null : Math.max(0, usd - t.usd)
    const extra =
      isOn(how, 'summary') && e.durationMs >= LONG_TURN_MS
        ? summaryLines({ files: files.length, isTested: t.isTested, failed: t.failed, answer: e.answer })
        : []
    const line = isOn(how, 'footer') ? factsLine(e.durationMs, spent) : ''
    const tail = tailOf(e.answer)

    if (tail !== '' && (line !== '' || extra.length > 0)) {
      await update($, footers, list => [...list, { tail, line, extra }].slice(-30))
    }

    if (isShown(how, 'sound') && e.durationMs >= SOUND_TURN_MS) {
      await $.audio.play({ asset: 'sounds/done.wav' }).catch(() => undefined)
    }

    if (lastAsk !== '' || files.length > 0) {
      await $.store.set(`recap:${project}`, { at, ask: lastAsk, files: files.slice(-6).map(f => baseName(f.path)) })
    }

    return next(e)
  })

  // ------------------------------------------------------------ on the transcript

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    replyTexts.delete(e.requestId)
    replyTexts.set(e.requestId, e.props.text.slice(0, 1200))

    if (replyTexts.size > 200) {
      replyTexts.delete(replyTexts.keys().next().value as string)
    }
    const how = await read($, show)

    if (how.quiet) {
      return next(e)
    }
    const question = isOn(how, 'question') ? closingQuestion(e.props.text) : null
    const footer = footerFor(await read($, footers), e.props.text)

    if (question === null && footer === undefined) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        {question !== null && (
          <Text color="warning" weight="semibold">
            Claude asks: {question}
          </Text>
        )}
        {footer?.extra.map(x => <Text>{x}</Text>)}
        {footer !== undefined && footer.line !== '' && <Text dimColor>{footer.line}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!e.props.isRunning || (e.props.tool !== 'Bash' && e.props.tool !== 'PowerShell')) {
      return next(e)
    }
    const typical = (await read($, usualFor))[e.props.tool_use_id]

    if (typical === undefined || !isShown(await read($, show), 'usual')) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text dimColor>Usually takes about {spanOf(typical)}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'ContextMenu' }, async ($, e, next) => {
    if (!isOn(await read($, show), 'menu')) {
      return next(e)
    }
    const row = e.props.row
    const code = e.props.code?.text.trim() ?? ''
    const selected = e.props.selection?.text.trim() ?? ''
    const text = selected !== '' ? selected : row?.component === 'AssistantMessage' ? (replyTexts.get(row.requestId) ?? '').trim() : ''
    const path = row?.component === 'ToolUse' ? editPaths.get(row.requestId) : undefined

    if (code === '' && text === '' && path === undefined) {
      return next(e)
    }
    const mine = text === '' ? [] : await read($, shortcuts)
    const { Box, Button } = $.ui.resolve(e)
    const block = `\`\`\`\n${code.slice(0, 1500)}\n\`\`\`\n`

    return (
      <Box flexDirection="column">
        {code !== '' && <Button key="h-explain" label="Explain this code" onPress={() => fill($, `Explain this:\n${block}`)} />}
        {code !== '' && <Button key="h-safe" label="Is this safe to run?" onPress={() => fill($, `Is this safe to run? Say what it changes.\n${block}`)} />}
        {path !== undefined && (
          <Button key="h-undo" label="Undo this change" onPress={() => fill($, `Undo your last change to ${path}, and show me what you restore.`)} />
        )}
        {text !== '' && (
          <Button
            key="h-note"
            label="Save as note"
            onPress={async () => {
              await saveNotes($, [...(await read($, notes)), text.slice(0, 600)].slice(-50))
              $.ui.toast('Saved. See it with /mynotes.')
            }}
          />
        )}
        {mine.map((s, i) => (
          <Button key={`h-short-${i}`} label={s.label} onPress={() => fill($, `${s.text}\n${quote(text)}\n`)} />
        ))}
        {await next(e)}
      </Box>
    )
  })

  // ------------------------------------------------------------ pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const active = await read($, tab)
    const how = await read($, show)
    let body: unknown = null

    if (active === 'changes') {
      const files = await read($, changes)
      const test = await read($, testCommand)
      const shown = await read($, diff)

      body = (
        <Box flexDirection="column">
          {files.length === 0 && <Text dimColor>No files changed in the last turn.</Text>}
          {files.map((f, i) => (
            <Box gap="sm">
              <Text>{baseName(f.path)}</Text>
              <Text color="success">+{f.added}</Text>
              <Text color="error">−{f.removed}</Text>
              <Button key={`diff-${i}`} dimColor label="Show diff" onPress={() => showDiff($, f.path)} />
            </Box>
          ))}
          {shown.path !== '' && (
            <Box flexDirection="column" marginTop="sm">
              <Text weight="semibold">{baseName(shown.path)}</Text>
              {shown.lines.length === 0 && <Text dimColor>No diff to show: a new file, already committed, or not a git project.</Text>}
              {shown.lines.map(l => (
                <Text mono color={l.startsWith('+') ? 'success' : l.startsWith('-') ? 'error' : undefined}>
                  {l.slice(0, 200)}
                </Text>
              ))}
            </Box>
          )}
          <Box gap="sm" flexWrap="wrap" marginTop="sm">
            {files.length > 0 && (
              <Button
                key="commit"
                label="Write commit message"
                onPress={() => fill($, `Write a short commit message for your changes to ${files.map(f => baseName(f.path)).slice(0, 12).join(', ')}. Do not commit.`)}
              />
            )}
            {test !== '' && <Button key="tests" label="Run my tests" onPress={() => fill($, `Run \`${test}\` and tell me what fails.`)} />}
          </Box>
          {test !== '' && <Text dimColor>Test command here: {test}</Text>}
        </Box>
      )
    } else if (active === 'steps') {
      const list = await read($, steps)

      body = (
        <Box flexDirection="column">
          {list.length === 0 && <Text dimColor>No task list yet.</Text>}
          {list.map(s => (
            <Box gap="sm">
              <Text color={s.status === 'completed' ? 'success' : undefined}>{s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '▸' : '○'}</Text>
              <Text weight={s.status === 'in_progress' ? 'semibold' : undefined}>{s.label}</Text>
              {s.startedAt !== null && s.endedAt !== null && <Text dimColor>{spanOf(Math.round((s.endedAt - s.startedAt) / 1000))}</Text>}
            </Box>
          ))}
        </Box>
      )
    } else if (active === 'notes') {
      const list = await read($, notes)

      body = (
        <Box flexDirection="column">
          {list.length === 0 && <Text dimColor>Right-click a reply and choose Save as note.</Text>}
          {list.map((n, i) => (
            <Box flexDirection="column" marginBottom="sm">
              <Text>{n.length > 200 ? `${n.slice(0, 199)}…` : n}</Text>
              <Box gap="sm">
                <Button key={`use-${i}`} label="Put in prompt" onPress={() => fill($, n)} />
                <Button key={`del-${i}`} dimColor label="Delete" onPress={async () => saveNotes($, (await read($, notes)).filter((_, j) => j !== i))} />
              </Box>
            </Box>
          ))}
        </Box>
      )
    } else {
      const before = await read($, lastTime)
      const mine = await read($, shortcuts)

      body = (
        <Box flexDirection="column" alignItems="flex-start">
          {before !== '' && <Text dimColor>Last time here: {before}</Text>}
          <Button key="quiet" label={`Quiet mode: ${how.quiet ? 'on' : 'off'}`} onPress={() => toggleQuiet($)} />
          {FEATURES.map(f => (
            <Button key={`sw-${f.id}`} label={`${f.label}: ${setOff.includes(f.id) ? 'off in Settings' : isOn(how, f.id) ? 'on' : 'off'}`} onPress={() => toggle($, f.id)} />
          ))}
          <Text dimColor>
            {mine.length === 0 ? 'Add your own right-click action: /shortcut add Persian = Translate this into Persian:' : `Your actions: ${mine.map(s => s.label).join(', ')}`}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding="sm">
        <Box gap="sm" flexWrap="wrap" marginBottom="sm">
          {(['switches', 'changes', 'steps', 'notes'] as const).map(id => (
            <Button
              key={`tab-${id}`}
              variant={id === active ? 'primary' : undefined}
              label={`${id.charAt(0).toUpperCase()}${id.slice(1)}`}
              onPress={() => update($, tab, () => id)}
            />
          ))}
        </Box>
        {body as never}
      </Box>
    )
  })

  // ------------------------------------------------------------ commands

  on('command.run', { command: 'helpers' }, async ($, e) => {
    if (e.args.trim() === 'allow-commit') {
      isCommitAllowed = true

      return { text: 'The next commit that includes a secret-looking file will be let through, once.' }
    }
    await openTab($, 'switches')

    return { text: 'Helpers opened.' }
  })

  on('command.run', { command: 'changes' }, async $ => {
    await openTab($, 'changes')

    return { text: 'Changes opened.' }
  })

  on('command.run', { command: 'steps' }, async $ => {
    await openTab($, 'steps')

    return { text: 'Steps opened.' }
  })

  on('command.run', { command: 'mynotes' }, async $ => {
    await openTab($, 'notes')

    return { text: 'Notes opened.' }
  })

  on('command.run', { command: 'shortcut' }, async ($, e) => {
    const wanted = parseShortcut(e.args)
    const list = await read($, shortcuts)

    if (wanted.add !== undefined) {
      const added = wanted.add
      await saveShortcuts($, [...list.filter(s => s.label !== added.label), added].slice(-8))

      return { text: `"${added.label}" is now in the right-click menu.` }
    }

    if (wanted.remove !== undefined) {
      const next = list.filter(s => s.label !== wanted.remove)
      await saveShortcuts($, next)

      return { text: next.length === list.length ? `No action called "${wanted.remove}".` : `Removed "${wanted.remove}".` }
    }

    return { text: wanted.error ?? '' }
  })

  on('command.run', { command: 'quietmode' }, async $ => {
    const quiet = await toggleQuiet($)

    return { text: quiet ? 'Quiet mode on. Safety checks still work.' : 'Quiet mode off.' }
  })
}
