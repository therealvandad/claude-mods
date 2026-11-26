import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import { CHEATS, cheatsText, fillFor } from './cheats'
import {
  AWAY_MS,
  addTotal,
  approxTokens,
  bandColor,
  bandOf,
  buildDigest,
  clampPos,
  clip,
  computeHealth,
  digestLines,
  fileOf,
  fmtChars,
  fmtCount,
  fmtDuration,
  isErrorResult,
  isReadOnlyGit,
  lintDraft,
  maskDeep,
  maskText,
  oneLine,
  parseRefs,
  parseStat,
  positionBar,
  rankTotals,
  REFS_ARGV,
  signatureOf,
  sizeOfResult,
  stepPos,
  statArgv,
  summarize,
  titleFrom,
} from './pure'
import type { Input } from './pure'
import type { SnapRow } from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]

// Nothing in this mod animates (the pane bars are static values), so it does not read the `motion` flag.

// ---------------------------------------------------------------- state
// Change a shape tag when the stored fields change: it declines what an earlier version stored.
const calls = atom({ plugin: 'extras', key: 'calls' } as const, [], { shape: 'calls-1' })
const totals = atom({ plugin: 'extras', key: 'totals' } as const, {}, { shape: 'totals-1' })
const marks = atom({ plugin: 'extras', key: 'marks' } as const, [], { shape: 'marks-1' })
const vitals = atom(
  { plugin: 'extras', key: 'vitals' } as const,
  { ctx: null, usd: null, startedAt: 0, at: 0 },
  { shape: 'vitals-1' },
)
const spend = atom({ plugin: 'extras', key: 'spend' } as const, [], { shape: 'spend-1' })
const maskCtx = atom({ plugin: 'extras', key: 'maskCtx' } as const, { home: '', user: '', cwd: '' }, { shape: 'mask-1' })
const digest = atom({ plugin: 'extras', key: 'digest' } as const, null, { shape: 'digest-1' })
const snaps = atom(
  { plugin: 'extras', key: 'snaps' } as const,
  { rows: [], loadedAt: 0, error: '', isLoading: false },
  { shape: 'snaps-1' },
)
const snapSel = atom({ plugin: 'extras', key: 'snapSel' } as const, '')
const replayPos = atom({ plugin: 'extras', key: 'replayPos' } as const, -1)
const lastActive = atom({ plugin: 'extras', key: 'lastActive' } as const, 0)
const isTurnRunning = atom({ plugin: 'extras', key: 'isTurnRunning' } as const, false)
const isPresenting = atom({ plugin: 'extras', key: 'isPresenting' } as const, false)
const isAlertsOn = atom({ plugin: 'extras', key: 'isAlertsOn' } as const, true)
const lastAlertAt = atom({ plugin: 'extras', key: 'lastAlertAt' } as const, 0)
const isLintOn = atom({ plugin: 'extras', key: 'isLintOn' } as const, true)
const lintHint = atom({ plugin: 'extras', key: 'lintHint' } as const, '')
const lastLintToastAt = atom({ plugin: 'extras', key: 'lastLintToastAt' } as const, 0)
const titleTries = atom({ plugin: 'extras', key: 'titleTries' } as const, 0)
const isTitled = atom({ plugin: 'extras', key: 'isTitled' } as const, false)

const KEEP = 300
const KEEP_MARKS = 50
const KEEP_SPEND = 40
const ALERT_AFTER_MS = 60_000
const ALERT_GAP_MS = 5 * 60 * 1000
const LINT_DELAY_MS = 1200
const LINT_TOAST_GAP_MS = 3 * 60 * 1000
const MAX_TITLE_TRIES = 3

const PANE = {
  health: 'extras-health',
  tools: 'extras-tools',
  replay: 'extras-replay',
  cheats: 'extras-cheats',
  snaps: 'extras-snaps',
} as const

const PANE_TITLE = {
  [PANE.health]: 'Session health',
  [PANE.tools]: 'Tool cost',
  [PANE.replay]: 'Replay',
  [PANE.cheats]: 'Cheatsheet',
  [PANE.snaps]: 'Snapshots',
} as const

const COMMANDS = [
  ['present', 'Screen-share mode: /present on | off (masks home, user, emails, secrets and project paths on screen only)', '<on|off>'],
  ['alerts', 'Desktop alert when a turn over 60 s ends: /alerts on | off | test', '<on|off|test>'],
  ['lint', 'Gentle hint when a draft prompt looks vague: /lint on | off', '<on|off>'],
  ['health', 'Session health score (0-100) and its four factors, in a pane', ''],
  ['toolcost', 'Which tools produced the most output and time, in a pane', ''],
  ['replay', 'Step through this session\'s tool calls: /replay [first|prev|next|last]', '<first|prev|next|last>'],
  ['cheats', 'Every slash command the mods add, as buttons that fill the prompt box', ''],
  ['snaps', 'Browse safety-pro snapshots, read-only (restore stays with /rollback)', ''],
] as const

const asInput = (value: unknown): Input =>
  value !== null && typeof value === 'object' ? (value as Input) : {}

const safe = async <T,>(run: () => Promise<T> | T, fallback: T): Promise<T> => {
  try {
    return await run()
  } catch {
    return fallback
  }
}

const onOff = (args: string): boolean | undefined => {
  const word = args.trim().toLowerCase()

  return word === 'on' ? true : word === 'off' ? false : undefined
}

// ---------------------------------------------------------------- helpers that take `$`

const openPane = (d: Dollar, id: (typeof PANE)[keyof typeof PANE]) =>
  d.ui.open({ id, title: PANE_TITLE[id] }).catch(() => undefined)

const refreshStatus = async (d: Dollar) => {
  const parts: string[] = []

  if (await read(d, isPresenting)) {
    parts.push('PRESENTING')
  }
  await safe(() => d.ui.status(parts.length === 0 ? undefined : parts.join(' · ')), undefined)
}

const refreshMaskCtx = async (d: Dollar) => {
  const home = (await safe(() => d.env.get('HOME'), undefined)) ?? ''
  const named = (await safe(() => d.env.get('USER'), undefined)) ?? (await safe(() => d.env.get('LOGNAME'), undefined)) ?? ''
  const user = named !== '' ? named : (home.split('/').filter(Boolean).pop() ?? '')
  const cwd = await safe(() => d.session.cwd(), '')
  await update(d, maskCtx, () => ({ home, user, cwd: typeof cwd === 'string' ? cwd : '' }))
}

const loadSettings = async (d: Dollar) => {
  const flag = async (key: string, fallback: boolean) => {
    const value = await safe(() => d.store.get(key), undefined)

    return typeof value === 'boolean' ? value : fallback
  }
  const present = await flag('extras.present', false)
  const alerts = await flag('extras.alerts', true)
  const lint = await flag('extras.lint', true)
  await update(d, isPresenting, () => present)
  await update(d, isAlertsOn, () => alerts)
  await update(d, isLintOn, () => lint)
  await refreshMaskCtx(d)
  await refreshStatus(d)
}

const sampleVitals = async (d: Dollar, now: number) => {
  try {
    const usage = await d.session.usage()
    const usd = typeof usage.cost?.usd === 'number' ? usage.cost.usd : null
    const percent = typeof usage.context.percent === 'number' ? usage.context.percent : null
    await update(d, vitals, () => ({ ctx: percent, usd, startedAt: usage.startedAt, at: now }))

    if (usd !== null) {
      await update(d, spend, list => {
        const last = list[list.length - 1]

        return last !== undefined && now - last.t < 30_000 ? list : [...list, { t: now, usd }].slice(-KEEP_SPEND)
      })
    }
  } catch {
    // A host without a cost ledger: the factors read "not reported".
  }
}

// 16: any prompt, tool or turn activity. A gap of 10+ minutes since the last one builds the away card.
const touch = async (d: Dollar, now: number) => {
  const last = await read(d, lastActive)
  await update(d, lastActive, () => now)

  if (last > 0 && now - last >= AWAY_MS) {
    const card = buildDigest(await read(d, calls), await read(d, marks), last, now, await read(d, isTurnRunning))
    await update(d, digest, () => card)
  }
}

const dismissDigest = (d: Dollar) => update(d, digest, () => null)

const finishCall = async (
  d: Dollar,
  id: string,
  tool: string,
  start: number,
  ran: unknown,
  isThrown: boolean,
) => {
  try {
    const end = await d.clock.now()
    const bytes = sizeOfResult(ran)
    const isErr = isThrown || isErrorResult(ran)
    await update(d, calls, list => list.map(one => (one.id === id ? { ...one, end, bytes, isErr } : one)))
    await update(d, totals, table => addTotal(table, tool, end - start, bytes, isErr))
    await sampleVitals(d, end)
    await touch(d, end)
  } catch {
    // Recording must never change what a tool call returns.
  }
}

// 17: one desktop notification for a long turn; at most one per 5 minutes because the API cannot say whether the app is focused.
const notifyDone = async (d: Dollar, text: string): Promise<string> => {
  try {
    const sent = await d.ui.notify(text, { title: 'Claude Code' })

    return sent.isSent ? `sent through ${sent.channel}` : `not sent (${sent.reason})`
  } catch {
    return 'not sent (the notification call failed or was refused)'
  }
}

const maybeAlert = async (d: Dollar, durationMs: number, reason: string, now: number) => {
  if (!(await read(d, isAlertsOn)) || !(durationMs > ALERT_AFTER_MS) || reason === 'aborted') {
    return
  }
  const last = await read(d, lastAlertAt)

  if (last > 0 && now - last < ALERT_GAP_MS) {
    return
  }
  const text =
    reason === 'answer' ? `Claude finished after ${fmtDuration(durationMs)}.` : `Claude stopped after ${fmtDuration(durationMs)} (${reason}).`
  const result = await notifyDone(d, text)

  if (result.startsWith('sent')) {
    await update(d, lastAlertAt, () => now)
  }
}

// 18: lint the draft after the person pauses; the hint shows in the band and never blocks the prompt.
let lintTimer: { cancel: () => void } | undefined
let lastDraft = ''

const runLint = async (d: Dollar) => {
  if (!(await read(d, isLintOn))) {
    await update(d, lintHint, () => '')

    return
  }
  const box = await safe(() => d.prompt.read(), { text: lastDraft, cursor: 0 })
  const hit = lintDraft(box.text === '' ? lastDraft : box.text)
  const hint = hit === null ? '' : hit.hint

  if ((await read(d, lintHint)) !== hint) {
    await update(d, lintHint, () => hint)
  }
}

const watchDraft = async (d: Dollar, draft: string) => {
  lastDraft = draft
  lintTimer?.cancel()
  lintTimer = undefined

  if (!(await read(d, isLintOn)) || lintDraft(draft) === null) {
    if ((await read(d, lintHint)) !== '') {
      await update(d, lintHint, () => '')
    }

    return
  }
  lintTimer = d.clock.after(LINT_DELAY_MS, () => {
    void runLint(d).catch(() => undefined)
  })
}

const lintAtSubmit = async (d: Dollar, text: string, now: number) => {
  lintTimer?.cancel()
  lintTimer = undefined
  const wasShown = (await read(d, lintHint)) !== ''
  await update(d, lintHint, () => '')

  if (wasShown || !(await read(d, isLintOn))) {
    return
  }
  const hit = lintDraft(text)
  const last = await read(d, lastLintToastAt)

  // No edit event reached us for this draft: say it once, after the submit, at most every 3 minutes.
  if (hit !== null && (last === 0 || now - last >= LINT_TOAST_GAP_MS)) {
    await update(d, lastLintToastAt, () => now)
    d.ui.toast(`Hint: ${hit.hint}`, { timeoutMs: 6000 })
  }
}

// 23: the title comes from the first prompt's meaningful words; the classic UserPromptSubmit result carries it to the session.
const proposeTitle = async (d: Dollar, prompt: string, source: string | undefined, existing: string | undefined) => {
  if ((await read(d, isTitled)) || (source !== undefined && source !== 'user')) {
    return undefined
  }
  if (existing !== undefined && existing.trim() !== '') {
    await update(d, isTitled, () => true)

    return undefined
  }
  if (prompt.trim().startsWith('/') || (await read(d, titleTries)) >= MAX_TITLE_TRIES) {
    return undefined
  }
  await update(d, titleTries, n => n + 1)
  const title = titleFrom(prompt)

  if (title !== null) {
    await update(d, isTitled, () => true)
  }

  return title ?? undefined
}

// 24: read-only git. `isReadOnlyGit` is the whole allowlist: `for-each-ref` and `diff --stat`.
const readGit = (d: Dollar, argv: readonly string[]) => {
  if (!isReadOnlyGit(argv)) {
    return Promise.reject(new Error('refused: extras only runs git for-each-ref and git diff --stat'))
  }

  return d.process.run(['git', ...argv], { timeoutMs: 15_000 })
}

const SNAP_LIMIT = 12

const loadSnaps = async (d: Dollar) => {
  await update(d, snaps, s => ({ ...s, isLoading: true }))
  const now = await safe(() => d.clock.now(), 0)

  try {
    const listed = await readGit(d, REFS_ARGV)

    if (listed.exitCode !== 0) {
      const why = oneLine(listed.stderr, 140) || 'git for-each-ref failed'
      await update(d, snaps, () => ({ rows: [], loadedAt: now, error: why, isLoading: false }))

      return
    }
    const refs = parseRefs(listed.stdout)
    const rows: SnapRow[] = []

    for (let i = Math.max(0, refs.length - SNAP_LIMIT); i < refs.length; i += 1) {
      const ref = refs[i]

      if (ref === undefined) {
        continue
      }
      const before = refs[i - 1]
      const from = before === undefined ? `${ref.sha}^1` : before.sha
      const stat = await readGit(d, statArgv(from, ref.sha))
      const parsed = stat.exitCode === 0 ? parseStat(stat.stdout) : { files: [], summary: '' }
      rows.push({
        ref: ref.ref,
        n: ref.n,
        sha: ref.sha.slice(0, 10),
        at: ref.at,
        subject: oneLine(ref.subject, 80),
        files: parsed.files.slice(0, 60),
        summary: parsed.summary,
        note: stat.exitCode === 0 ? '' : before === undefined ? 'no earlier state to compare with' : 'could not compare',
      })
    }
    rows.reverse()
    await update(d, snaps, () => ({ rows, loadedAt: now, error: '', isLoading: false }))
    await update(d, snapSel, sel => (rows.some(one => one.ref === sel) ? sel : (rows[0]?.ref ?? '')))
  } catch (error) {
    await update(d, snaps, () => ({
      rows: [],
      loadedAt: now,
      error: oneLine(error instanceof Error ? error.message : 'could not read snapshots', 140),
      isLoading: false,
    }))
  }
}

const moveReplay = async (d: Dollar, to: 'first' | 'prev' | 'next' | 'last') => {
  const length = (await read(d, calls)).length
  const pos = await read(d, replayPos)
  await update(d, replayPos, () => stepPos(pos, length, to))
}

const resetSession = async (d: Dollar) => {
  await update(d, calls, () => [])
  await update(d, totals, () => ({}))
  await update(d, marks, () => [])
  await update(d, spend, () => [])
  await update(d, digest, () => null)
  await update(d, replayPos, () => -1)
  await update(d, lastActive, () => 0)
  await update(d, isTurnRunning, () => false)
  await update(d, isTitled, () => false)
  await update(d, titleTries, () => 0)
  await update(d, lintHint, () => '')
}

// ---------------------------------------------------------------- command answers

const presentCommand = async (d: Dollar, args: string) => {
  const to = onOff(args)

  if (to !== undefined) {
    await update(d, isPresenting, () => to)
    await safe(() => d.store.set('extras.present', to), undefined)

    if (to) {
      await refreshMaskCtx(d)
    }
    await refreshStatus(d)
  }
  const on = await read(d, isPresenting)

  return {
    text: on
      ? 'Screen-share mode is ON. What is drawn hides your home path, user name, emails, likely secrets and project paths (…/last/two). The model still reads everything unmasked. /present off to stop.'
      : 'Screen-share mode is off. /present on masks home, user, emails, secrets and project paths in what is drawn (never in what the model reads).',
  }
}

const alertsCommand = async (d: Dollar, args: string) => {
  const word = args.trim().toLowerCase()

  if (word === 'test') {
    const result = await notifyDone(d, 'Test alert from extras: a turn over 60 s will look like this.')

    return { text: `Test alert ${result}.` }
  }
  const to = onOff(word)

  if (to !== undefined) {
    await update(d, isAlertsOn, () => to)
    await safe(() => d.store.set('extras.alerts', to), undefined)
  }
  const on = await read(d, isAlertsOn)

  return {
    text: `Alerts are ${on ? 'on' : 'off'}: a desktop notification when a turn longer than 60 s ends, at most one per 5 minutes (the API cannot tell whether the app is focused). /alerts test sends one now.`,
  }
}

const lintCommand = async (d: Dollar, args: string) => {
  const to = onOff(args)

  if (to !== undefined) {
    await update(d, isLintOn, () => to)
    await safe(() => d.store.set('extras.lint', to), undefined)

    if (!to) {
      await update(d, lintHint, () => '')
    }
  }
  const on = await read(d, isLintOn)

  return { text: `Prompt hints are ${on ? 'on' : 'off'}. They never block a prompt. /lint ${on ? 'off' : 'on'} switches them.` }
}

const healthText = async (d: Dollar) => {
  const now = await safe(() => d.clock.now(), 0)
  const report = computeHealth(await read(d, calls), await read(d, vitals), await read(d, spend), now)

  return [
    `Session health ${report.score}/100 (${report.band}).`,
    ...report.factors.map(f => `  ${f.label}: ${f.score}/100, weight ${Math.round(f.weight * 100)}% (${f.detail})`),
  ].join('\n')
}

const toolcostText = async (d: Dollar) => {
  const table = await read(d, totals)
  const byBytes = rankTotals(table, 'bytes').slice(0, 5)
  const byMs = rankTotals(table, 'ms').slice(0, 5)

  if (byBytes.length === 0) {
    return 'No tool calls recorded yet.'
  }
  const row = ([tool, t]: [string, { n: number; bytes: number; ms: number }]) =>
    `  ${tool}: ${fmtChars(t.bytes)} (~${fmtCount(approxTokens(t.bytes))} tokens), ${fmtDuration(t.ms)} over ${t.n} call${t.n === 1 ? '' : 's'}`

  return [
    'Most output (characters the model read):',
    ...byBytes.map(row),
    'Most time (wall clock from call start to result):',
    ...byMs.map(row),
  ].join('\n')
}

const replayText = async (d: Dollar) => {
  const list = await read(d, calls)
  const at = clampPos(await read(d, replayPos), list.length)
  const one = list[at]

  if (one === undefined) {
    return 'No tool calls recorded yet.'
  }
  const ms = one.end === null ? 'running' : fmtDuration(one.end - one.start)

  return `Call ${at + 1} of ${list.length} ${positionBar(at, list.length)}\n  ${one.tool}: ${one.summary} (${ms}, ${fmtChars(one.bytes)}${one.isErr ? ', error' : ''})`
}

const snapsText = async (d: Dollar) => {
  const state = await read(d, snaps)

  if (state.error !== '') {
    return `Could not read snapshots: ${state.error}`
  }
  if (state.rows.length === 0) {
    return 'No snapshots under refs/claude-checkpoints/. safety-pro makes them after /snapshot on.'
  }

  return [
    `${state.rows.length} snapshot${state.rows.length === 1 ? '' : 's'} (newest first, read-only; /rollback restores):`,
    ...state.rows.map(r => `  #${r.n} ${r.sha} ${r.files.length} file${r.files.length === 1 ? '' : 's'} changed: ${r.subject}`),
  ].join('\n')
}

// ---------------------------------------------------------------- the mod

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const refused: string[] = []

    for (const [name, description, argumentHint] of COMMANDS) {
      const isOk = await $.command
        .register(argumentHint === '' ? { name, description } : { name, description, argumentHint })
        .then(
          () => true,
          () => false,
        )

      if (!isOk) {
        refused.push(name)
      }
    }
    await loadSettings($).catch(() => undefined)

    if (refused.length > 0) {
      $.ui.toast(`extras: /${refused.join(', /')} could not be registered (name taken)`, { timeoutMs: 8000 })
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetSession($).catch(() => undefined)
    }

    return next(e)
  })

  // ------------------------------------------------------------ commands

  on('command.run', { command: 'present' }, async ($, e) => presentCommand($, e.args))
  on('command.run', { command: 'alerts' }, async ($, e) => alertsCommand($, e.args))
  on('command.run', { command: 'lint' }, async ($, e) => lintCommand($, e.args))

  on('command.run', { command: 'health' }, async $ => {
    await openPane($, PANE.health)

    return { text: await healthText($) }
  })

  on('command.run', { command: 'toolcost' }, async $ => {
    await openPane($, PANE.tools)

    return { text: await toolcostText($) }
  })

  on('command.run', { command: 'replay' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()

    if (word === 'first' || word === 'prev' || word === 'next' || word === 'last') {
      await moveReplay($, word)
    } else {
      await update($, replayPos, () => -1)
    }
    await openPane($, PANE.replay)

    return { text: await replayText($) }
  })

  on('command.run', { command: 'cheats' }, async $ => {
    await openPane($, PANE.cheats)

    return { text: cheatsText() }
  })

  on('command.run', { command: 'snaps' }, async $ => {
    await loadSnaps($)
    await openPane($, PANE.snaps)

    return { text: await snapsText($) }
  })

  // ------------------------------------------------------------ recording (15-21)

  on('tool.call', async ($, e, next) => {
    const input = asInput(e)
    const id = e.tool_use_id
    const start = await $.clock.now()
    await touch($, start).catch(() => undefined)
    await update($, calls, list =>
      [
        ...list.filter(one => one.id !== id),
        {
          id,
          tool: e.tool,
          sig: signatureOf(e.tool, input),
          summary: summarize(e.tool, input),
          file: fileOf(e.tool, input),
          start,
          end: null,
          bytes: 0,
          isErr: false,
        },
      ].slice(-KEEP),
    )
    let ran: unknown
    let isThrown = false

    try {
      ran = await next(e)

      return ran as Awaited<ReturnType<typeof next>>
    } catch (error) {
      isThrown = true
      throw error
    } finally {
      await finishCall($, id, e.tool, start, ran, isThrown)
    }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isTurnRunning, () => true)
      await touch($, await $.clock.now()).catch(() => undefined)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      try {
        const now = await $.clock.now()
        await update($, isTurnRunning, () => false)
        const kind = e.reason === 'error' || e.reason === 'refusal' ? 'turn-error' : 'turn-done'
        await update($, marks, list => [...list, { at: now, kind, ms: e.durationMs } as const].slice(-KEEP_MARKS))
        await sampleVitals($, now)
        await touch($, now)
        await maybeAlert($, e.durationMs, e.reason, now)
      } catch {
        // Bookkeeping never changes how a turn ends.
      }
    }

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const before = await safe(() => read($, digest), null)
    const now = await safe(() => $.clock.now(), 0)
    await safe(() => touch($, now), undefined)
    const after = await safe(() => read($, digest), null)

    // A card the person has already read past goes away with their next prompt.
    if (before !== null && after !== null && before.at === after.at) {
      await safe(() => dismissDigest($), undefined)
    }
    const result = await next(e)

    if (e.command === undefined && e.isMeta !== true) {
      await safe(() => lintAtSubmit($, e.text, now), undefined)
    }

    return result
  })

  // 18: the edit event exists, so the draft is read from it (and `$.prompt.read()` after a pause).
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await safe(() => watchDraft($, box.text), undefined)

    return box
  })

  // 23: the session title, applied through the classic UserPromptSubmit result.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const base = await next(e)
    const title = await safe(() => proposeTitle($, e.prompt, e.source, e.session_title), undefined)

    return title === undefined ? base : { ...base, sessionTitle: title }
  })

  // ------------------------------------------------------------ 15: masks on what is drawn only

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, isPresenting))) {
      return next(e)
    }
    const ctx = await read($, maskCtx)
    const props = { ...e.props, input: maskDeep(e.props.input, ctx) }

    if (e.props.output !== undefined) {
      props.output = maskDeep(e.props.output, ctx)
    }

    return next({ ...e, props })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, isPresenting))) {
      return next(e)
    }
    const ctx = await read($, maskCtx)

    return next({ ...e, props: { ...e.props, output: maskDeep(e.props.output, ctx) } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isPresenting))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, text: maskText(e.props.text, await read($, maskCtx)) } })
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!(await read($, isPresenting))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, text: maskText(e.props.text, await read($, maskCtx)) } })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (!(await read($, isPresenting))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, text: maskText(e.props.text, await read($, maskCtx)) } })
  })

  // ------------------------------------------------------------ the band: PRESENTING chip, away card, hint, health chip

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)

    if (e.props.hasSurvey) {
      return inner
    }
    const presenting = await read($, isPresenting)
    const card = await read($, digest)
    const hint = await read($, lintHint)
    const list = await read($, calls)
    const finished = list.filter(one => one.end !== null).length
    const hasChip = finished >= 3

    if (!presenting && card === null && hint === '' && !hasChip) {
      return inner
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const ctx = await read($, maskCtx)
    const health = hasChip
      ? computeHealth(list, await read($, vitals), await read($, spend), await safe(() => $.clock.now(), 0))
      : null
    const shown = (text: string) => (presenting ? maskText(text, ctx) : text)

    return (
      <Box flexDirection="column">
        {inner}
        {card !== null && (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
            {digestLines(card).map((line, i) => (
              <Text dimColor={i > 0} weight={i === 0 ? 'semibold' : undefined}>
                {shown(line)}
              </Text>
            ))}
            <Box>
              <Button key="extras-digest-dismiss" role="dismiss" label="Dismiss" onPress={() => dismissDigest($)} />
            </Box>
          </Box>
        )}
        {hint !== '' && <Text dimColor>{`hint: ${hint}`}</Text>}
        {(presenting || health !== null) && (
          <Box gap="sm">
            {presenting && (
              <Text color="warning" weight="semibold">
                ● PRESENTING
              </Text>
            )}
            {health !== null && (
              <Button key="extras-health-chip" plain onPress={() => openPane($, PANE.health)}>
                health <Text color={bandColor(health.band)}>{`${health.score} ${health.band}`}</Text>
              </Button>
            )}
          </Box>
        )}
      </Box>
    )
  })

  // ------------------------------------------------------------ 19: health pane

  on('ui.render', { component: 'Pane', requestId: PANE.health }, async ($, e) => {
    const { Box, Text, Progress } = $.ui.resolve(e)
    const now = await safe(() => $.clock.now(), 0)
    const report = computeHealth(await read($, calls), await read($, vitals), await read($, spend), now)

    return (
      <Box flexDirection="column" gap="sm">
        <Box gap="sm">
          <Text size="title" weight="bold" tabular color={bandColor(report.band)}>
            {String(report.score)}
          </Text>
          <Text size="heading" color={bandColor(report.band)}>{`/ 100  ${report.band}`}</Text>
        </Box>
        {report.factors.map(f => (
          <Box flexDirection="column">
            <Progress
              label={`${f.label} (weight ${Math.round(f.weight * 100)}%)`}
              value={f.score / 100}
              valueText={`${f.score}/100`}
              color={bandColor(bandOf(f.score))}
            />
            <Text dimColor>{f.detail}</Text>
          </Box>
        ))}
        <Text dimColor>
          Errors: share of the last 50 calls that failed (40% scores 0). Loops: calls identical to the one before, last 30
          (4 score 0). Context: free to 50% full, 0 at 100%. Spend: free to $5/h, 0 at $20/h.
        </Text>
      </Box>
    )
  })

  // ------------------------------------------------------------ 20: tool cost pane

  on('ui.render', { component: 'Pane', requestId: PANE.tools }, async ($, e) => {
    const { Box, Text, Progress } = $.ui.resolve(e)
    const table = await read($, totals)
    const byBytes = rankTotals(table, 'bytes').slice(0, 8)
    const byMs = rankTotals(table, 'ms').slice(0, 8)
    const maxBytes = Math.max(1, byBytes[0]?.[1].bytes ?? 1)
    const maxMs = Math.max(1, byMs[0]?.[1].ms ?? 1)

    return (
      <Box flexDirection="column" gap="sm">
        {byBytes.length === 0 && <Text dimColor>No tool calls yet.</Text>}
        {byBytes.length > 0 && <Text size="heading" weight="bold">Most output</Text>}
        {byBytes.map(([tool, t]) => (
          <Progress
            label={`${tool} · ${t.n} call${t.n === 1 ? '' : 's'}`}
            value={t.bytes / maxBytes}
            valueText={`${fmtChars(t.bytes)} ~${fmtCount(approxTokens(t.bytes))} tok`}
            color="suggestion"
          />
        ))}
        {byMs.length > 0 && <Text size="heading" weight="bold">Most time</Text>}
        {byMs.map(([tool, t]) => (
          <Progress
            label={`${tool} · ${t.errors > 0 ? `${t.errors} failed` : 'ok'}`}
            value={t.ms / maxMs}
            valueText={fmtDuration(t.ms)}
            color="warning"
          />
        ))}
        <Text dimColor>
          Proxy: output is the number of characters of each result the model reads (about 4 characters a token), time is the
          wall clock from a call's start to its result and includes any wait for approval. Approximate, not billing.
        </Text>
      </Box>
    )
  })

  // ------------------------------------------------------------ 21: replay pane

  on('ui.render', { component: 'Pane', requestId: PANE.replay }, async ($, e) => {
    const { Box, Text, Button, Progress } = $.ui.resolve(e)
    const list = await read($, calls)
    const at = clampPos(await read($, replayPos), list.length)
    const one = list[at]
    const presenting = await read($, isPresenting)
    const ctx = await read($, maskCtx)
    const shown = (text: string) => (presenting ? maskText(text, ctx) : text)
    const first = list[0]

    return (
      <Box flexDirection="column" gap="sm">
        <Box gap="sm">
          <Button key="replay-first" label="|< first" hotkey="f" onPress={() => moveReplay($, 'first')} />
          <Button key="replay-prev" label="< prev" hotkey="p" onPress={() => moveReplay($, 'prev')} />
          <Button key="replay-next" label="next >" hotkey="n" onPress={() => moveReplay($, 'next')} />
          <Button key="replay-last" label="last >|" hotkey="l" onPress={() => moveReplay($, 'last')} />
        </Box>
        {one === undefined ? (
          <Text dimColor>No tool calls recorded yet.</Text>
        ) : (
          <Box flexDirection="column" gap="sm">
            <Progress label={`Call ${at + 1} of ${list.length}`} value={(at + 1) / list.length} valueText={`${at + 1}/${list.length}`} />
            <Text size="heading" weight="bold">{one.tool}</Text>
            <Text mono>{shown(one.summary)}</Text>
            <Text color={one.isErr ? 'error' : one.end === null ? 'warning' : 'success'}>
              {one.end === null ? 'still running' : one.isErr ? 'failed or refused' : 'finished'}
            </Text>
            <Text dimColor>
              {`duration ${one.end === null ? '…' : fmtDuration(one.end - one.start)} · result ${fmtChars(one.bytes)} (~${fmtCount(approxTokens(one.bytes))} tokens)`}
              {first === undefined ? '' : ` · started +${fmtDuration(one.start - first.start)} into the recording`}
            </Text>
          </Box>
        )}
        <Text dimColor>{`Recording the last ${list.length} of up to 300 calls.`}</Text>
      </Box>
    )
  })

  // ------------------------------------------------------------ 22: cheatsheet pane

  on('ui.render', { component: 'Pane', requestId: PANE.cheats }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap="sm">
        <Text dimColor>Press a command to put it in the prompt box.</Text>
        {CHEATS.map(group => (
          <Box flexDirection="column">
            <Text size="caption" weight="semibold" dimColor>
              {group.mod.toUpperCase()}
            </Text>
            {group.commands.map(one => (
              <Button
                key={`cheat-${group.mod}-${one.name}`}
                plain
                onPress={() => $.prompt.fill({ text: fillFor(one.name), mode: 'replace' })}
              >
                {`/${one.name}`} <Text dimColor>{clip(one.description, 110)}</Text>
              </Button>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  // ------------------------------------------------------------ 24: snapshot browser (read-only)

  on('ui.render', { component: 'Pane', requestId: PANE.snaps }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, snaps)
    const sel = await read($, snapSel)
    const chosen = state.rows.find(one => one.ref === sel) ?? state.rows[0]
    const presenting = await read($, isPresenting)
    const ctx = await read($, maskCtx)
    const shown = (text: string) => (presenting ? maskText(text, ctx) : text)
    const ago = (at: number) => (state.loadedAt > at && at > 0 ? `${fmtDuration(state.loadedAt - at)} before load` : '')

    return (
      <Box flexDirection="column" gap="sm">
        <Box gap="sm">
          <Button key="snaps-refresh" label={state.isLoading ? 'Reading…' : 'Refresh'} onPress={() => loadSnaps($)} />
          <Text dimColor>Read-only. Restore with /rollback (safety-pro).</Text>
        </Box>
        {state.error !== '' && <Text color="warning">{`Could not read snapshots: ${state.error}`}</Text>}
        {state.error === '' && state.rows.length === 0 && (
          <Text dimColor>No snapshots under refs/claude-checkpoints/. Run /snaps to look again; safety-pro makes them after /snapshot on.</Text>
        )}
        {state.rows.map(one => (
          <Button
            key={`snap-${one.n}`}
            plain
            dimColor={chosen?.ref !== one.ref}
            onPress={() => update($, snapSel, () => one.ref)}
          >
            {`${chosen?.ref === one.ref ? '▸' : ' '} #${one.n}`} <Text dimColor>{`${one.sha} · ${one.files.length} file${one.files.length === 1 ? '' : 's'} · ${shown(one.subject)}`}</Text>
          </Button>
        ))}
        {chosen !== undefined && (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
            <Text weight="semibold">{`#${chosen.n} · ${chosen.ref}`}</Text>
            <Text dimColor>{`${chosen.summary === '' ? 'no changes against the earlier state' : chosen.summary} ${ago(chosen.at)}`}</Text>
            {chosen.note !== '' && <Text color="warning">{chosen.note}</Text>}
            {chosen.files.slice(0, 40).map(file => (
              <Text mono>{shown(`${clip(file.path, 90)}  ${file.change}`)}</Text>
            ))}
            {chosen.files.length > 40 && <Text dimColor>{`+${chosen.files.length - 40} more files`}</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
