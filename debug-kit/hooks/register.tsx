import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import {
  GATE_MS,
  ENV_ALLOW,
  assertPrompt,
  bisectGuide,
  bisectPrompt,
  buildPostmortem,
  checkTailPath,
  coverageRows,
  crumbLine,
  detailOf,
  envText,
  flakyTally,
  fmtDelta,
  fmtMs,
  focusCommand,
  focusPrompt,
  frameText,
  addCluster,
  glyphOf,
  isAllowedVersionArgv,
  isGateOpen,
  isLoop,
  isRecovery,
  isTestCommand,
  isTestFile,
  lastFailedRun,
  oneLine,
  outcomeOf,
  outputOf,
  parseBisectArgs,
  parseCoverage,
  parseHypArgs,
  parseLsof,
  parseSnapshots,
  parseStack,
  parseTestOutput,
  parseTimings,
  portArgv,
  pushCmd,
  rankSlowest,
  redact,
  regressionPrompt,
  reproText,
  runnerOf,
  scanMocks,
  shortPath,
  shrinkPrompt,
  signatureOf,
  snapshotSummary,
  tailLines,
  topAppFrames,
  tracePrompt,
  traceText,
  validPort,
} from './pure'
import type { Input, Outcome } from './pure'
import type { Cluster, MockHit, TestRun } from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]

// Global reduced-motion switch owned by the `motion` mod (`/motion on|off`).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)

// ---------------------------------------------------------------- state
// Change a shape tag when the stored fields change: it declines what an earlier version stored.
const crumbs = atom({ plugin: 'debug-kit', key: 'crumbs' } as const, [], { shape: 'crumbs-1' })
const crumbSeq = atom({ plugin: 'debug-kit', key: 'crumbSeq' } as const, 0)
const runs = atom({ plugin: 'debug-kit', key: 'runs' } as const, [], { shape: 'runs-1' })
const info = atom({ plugin: 'debug-kit', key: 'info' } as const, null, { shape: 'info-1' })
const clusters = atom({ plugin: 'debug-kit', key: 'clusters' } as const, [], { shape: 'clusters-1' })
const trace = atom({ plugin: 'debug-kit', key: 'trace' } as const, null, { shape: 'trace-1' })
const hyps = atom({ plugin: 'debug-kit', key: 'hyps' } as const, [], { shape: 'hyps-1' })
const hypSeq = atom({ plugin: 'debug-kit', key: 'hypSeq' } as const, 0)
const rec = atom({ plugin: 'debug-kit', key: 'rec' } as const, { isOn: false, startedAt: 0, steps: [] }, { shape: 'rec-1' })
const env = atom({ plugin: 'debug-kit', key: 'env' } as const, null, { shape: 'env-1' })
const tail = atom(
  { plugin: 'debug-kit', key: 'tail' } as const,
  { path: '', lines: [], size: 0, mtimeMs: 0, at: 0, error: '' },
  { shape: 'tail-1' },
)
const mocks = atom({ plugin: 'debug-kit', key: 'mocks' } as const, null, { shape: 'mocks-1' })
const port = atom({ plugin: 'debug-kit', key: 'port' } as const, null, { shape: 'port-1' })
const cmds = atom({ plugin: 'debug-kit', key: 'cmds' } as const, [], { shape: 'cmds-1' })
const offer = atom({ plugin: 'debug-kit', key: 'offer' } as const, null, { shape: 'offer-1' })
const loopMark = atom({ plugin: 'debug-kit', key: 'loopMark' } as const, null, { shape: 'loop-1' })
const testFiles = atom({ plugin: 'debug-kit', key: 'testFiles' } as const, [], { shape: 'tfiles-1' })
const edits = atom({ plugin: 'debug-kit', key: 'edits' } as const, 0)
const lastToastAt = atom({ plugin: 'debug-kit', key: 'lastToastAt' } as const, 0)
const isGuardOn = atom({ plugin: 'debug-kit', key: 'isGuardOn' } as const, true)
const tab = atom({ plugin: 'debug-kit', key: 'tab' } as const, 'trail')
const post = atom({ plugin: 'debug-kit', key: 'post' } as const, '')

const KEEP_CRUMBS = 150
const KEEP_RUNS = 30
const KEEP_STEPS = 100
const KEEP_HYPS = 40
const TAIL_BYTES = 16 * 1024
const TAIL_EVERY_MS = 3000
const TRACE_KEEP_CHARS = 20_000

const PANE = 'debug-kit-main'

const TABS = [
  ['trail', 'Trail'],
  ['tests', 'Tests'],
  ['errors', 'Errors'],
  ['ideas', 'Ideas'],
  ['repro', 'Repro'],
  ['tail', 'Tail'],
  ['post', 'Post'],
] as const

const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['db', 'Debug kit help: every /db command in one line each', ''],
  ['dbfocus', 'Fill the prompt: re-run only the failing tests from the last failed test run', ''],
  ['dbbisect', 'Git bisect step-by-step guide and a prompt (never runs bisect itself)', '[good] [bad]'],
  ['dbtrace', 'Explain the last stack trace seen: top app frames and file:line list', ''],
  ['dbrec', 'Repro recorder: /dbrec start | stop | show (records Bash commands)', 'start|stop|show'],
  ['dbflaky', 'Tests that failed then passed with no edit in between', ''],
  ['dbcov', 'Coverage % per test run and the change between runs', ''],
  ['dbtime', 'Slowest tests from the last run that printed durations', ''],
  ['dbtail', 'Read-only tail of a file, refreshed every 3 s while the pane is open: /dbtail <path> | off', '<path>|off'],
  ['dberr', 'Tool errors grouped by normalised message', ''],
  ['dbhyp', 'Hypothesis board: /dbhyp <text> | ok <n> | no <n> | open <n> | rm <n>', '<text>|ok <n>|no <n>'],
  ['dbtrail', 'Debug breadcrumbs: ordered list of attempts and outcomes', ''],
  ['dbenv', 'Record node/python/git etc. versions (read-only --version commands)', ''],
  ['dbshrink', 'Fill the prompt: shrink a failing case to a minimal repro', '[case]'],
  ['dbguard', 'Regression-test offer and crash-loop toast: /dbguard on | off', 'on|off'],
  ['dbassert', 'Fill the prompt: suggest precise assertions for a test', '[test]'],
  ['dbmocks', 'Mock map: mocks and patches in test files edited this session', ''],
  ['dbsnap', 'Snapshot-test summary: written / updated / obsolete counts', ''],
  ['dbport', 'Who listens on a port: /dbport <1-65535> (read-only lsof)', '<port>'],
  ['dbpost', 'Draft a postmortem from the trail, hypotheses and errors (shown only, no file written)', ''],
  ['dbreset', 'Clear everything debug-kit has recorded', ''],
]

const HELP_LINES: readonly string[] = COMMANDS.map(([name, desc]) => `/${name}  ${desc}`)

const asInput = (value: unknown): Input => (value !== null && typeof value === 'object' ? (value as Input) : {})

const safe = async <T,>(run: () => Promise<T> | T, fallback: T): Promise<T> => {
  try {
    return await run()
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- shared helpers that take `$`

const isMotionOn = async (d: Dollar): Promise<boolean> => {
  const flag: unknown = await safe(async () => (await d.store.get('motion')) as unknown, undefined)

  return (await read(d, motionIsOn)) && !(flag === false || flag === 'off' || flag === 0 || flag === 'false')
}

const isPaneOpen = async (d: Dollar): Promise<boolean> => safe(async () => (await d.ui.panes()).some(p => p.id === PANE), false)

// At most one toast from this mod every 3 minutes.
const gatedToast = async (d: Dollar, text: string): Promise<boolean> => {
  const now = await d.clock.now()

  if (!isGateOpen(await read(d, lastToastAt), now)) {
    return false
  }
  await update(d, lastToastAt, () => now)
  await safe(() => d.ui.toast(text, { timeoutMs: 8000 }), undefined)

  return true
}

// ---------------------------------------------------------------- 48 tail timer

let tailTimer: { cancel: () => void } | undefined

const stopTail = () => {
  tailTimer?.cancel()
  tailTimer = undefined
}

const refreshTail = async (d: Dollar): Promise<void> => {
  const t = await read(d, tail)

  if (t.path === '') {
    return
  }
  const now = await d.clock.now()

  try {
    const st = await d.fs.stat(t.path)

    if (st.kind !== 'file') {
      await update(d, tail, cur => ({ ...cur, lines: [], error: 'Not a regular file.', at: now }))

      return
    }
    if (st.size === t.size && st.mtimeMs === t.mtimeMs && t.error === '' && t.at > 0) {
      return
    }
    const offset = Math.max(0, st.size - TAIL_BYTES)
    const text = st.size === 0 ? '' : await d.fs.read(t.path, { offset, length: st.size - offset })
    const lines = tailLines(text, offset > 0)

    await update(d, tail, cur => ({ ...cur, lines, size: st.size, mtimeMs: st.mtimeMs, at: now, error: '' }))
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)

    await update(d, tail, cur => ({ ...cur, lines: [], error: oneLine(msg, 160), at: now }))
  }
}

const tickTail = async (d: Dollar): Promise<void> => {
  if (!(await isPaneOpen(d))) {
    stopTail()

    return
  }
  if ((await read(d, tab)) === 'tail') {
    await refreshTail(d)
  }
}

// One 3 s timer while the pane is open; with motion off there is no timer, only manual refresh.
const startTail = async (d: Dollar): Promise<boolean> => {
  stopTail()

  if (!(await isMotionOn(d))) {
    return false
  }
  tailTimer = d.clock.every(TAIL_EVERY_MS, () => {
    void tickTail(d)
  })

  return true
}

// ---------------------------------------------------------------- pane

const openPane = async (d: Dollar, to?: string): Promise<void> => {
  if (to !== undefined) {
    await update(d, tab, () => to)
  }
  await safe(() => d.ui.open({ id: PANE, title: 'Debug kit' }), undefined)

  if ((await read(d, tail)).path !== '') {
    if (tailTimer === undefined) {
      await startTail(d)
    }
    if ((await read(d, tab)) === 'tail') {
      await refreshTail(d)
    }
  }
}

const selectTab = async (d: Dollar, to: string): Promise<void> => {
  await update(d, tab, () => to)

  if (to === 'tail') {
    await refreshTail(d)
  }
}

// ---------------------------------------------------------------- recording

const startCall = async (d: Dollar, id: string, tool: string, input: Input): Promise<number> => {
  const now = await d.clock.now()
  const n = (await read(d, crumbSeq)) + 1

  await update(d, crumbSeq, () => n)
  await update(d, crumbs, list =>
    [...list.filter(c => c.id !== id), { id, n, tool, detail: detailOf(tool, input), outcome: 'run' as const, at: now }].slice(-KEEP_CRUMBS),
  )

  return now
}

const recordTestRun = async (d: Dollar, cmd: string, text: string, outcome: Outcome, now: number): Promise<void> => {
  const parsed = parseTestOutput(text)
  const timings = parseTimings(text)
  const snaps = parseSnapshots(text)
  const run: TestRun = {
    at: now,
    cmd: signatureOf(cmd),
    runner: runnerOf(cmd, text),
    failed: parsed.failed.slice(0, 40),
    passed: parsed.passed.slice(0, 150),
    nFailed: parsed.nFailed,
    nPassed: parsed.nPassed,
    isGreen: outcome === 'ok' && parsed.nFailed === 0 && parsed.failed.length === 0,
    cov: parseCoverage(text),
    edits: await read(d, edits),
  }

  await update(d, runs, list => [...list, run].slice(-KEEP_RUNS))

  if (timings.length > 0 || snaps !== null) {
    await update(d, info, () => ({
      at: now,
      cmd: signatureOf(cmd),
      timings: timings.slice(0, 60),
      snaps: snaps === null ? null : snaps.counts,
      snapLines: snaps === null ? [] : snaps.lines,
    }))
  }
}

const recordBash = async (d: Dollar, cmd: string, outcome: Outcome, now: number): Promise<void> => {
  if (outcome === 'denied') {
    return
  }
  const sig = signatureOf(cmd)
  const isOk = outcome === 'ok'

  if ((await read(d, rec)).isOn) {
    await update(d, rec, cur => ({
      ...cur,
      steps: [...cur.steps, { cmd: redact(cmd).slice(0, 400), outcome: isOk ? ('ok' as const) : ('fail' as const) }].slice(-KEEP_STEPS),
    }))
  }
  const hist = await read(d, cmds)
  const isGuarding = await read(d, isGuardOn)

  if (isOk && isGuarding && isRecovery(hist, sig, now)) {
    await update(d, offer, () => ({ cmd: oneLine(redact(cmd), 160), at: now }))
  }
  const nextHist = pushCmd(hist, { sig, isOk, at: now })

  await update(d, cmds, () => nextHist)

  if (!isOk && isGuarding && isLoop(nextHist, sig, now)) {
    const mark = await read(d, loopMark)

    if (mark === null || mark.sig !== sig || now - mark.at > 10 * 60 * 1000) {
      const isSent = await gatedToast(
        d,
        `debug-kit: "${oneLine(redact(cmd), 40)}" failed 3 times in 2 minutes. Try a different angle: /dbhyp to note a hypothesis.`,
      )

      if (isSent) {
        await update(d, loopMark, () => ({ sig, at: now }))
      }
    }
  }
}

const finishCall = async (
  d: Dollar,
  id: string,
  tool: string,
  input: Input,
  ran: unknown,
  isThrown: boolean,
): Promise<void> => {
  try {
    const now = await d.clock.now()
    const outcome = outcomeOf(ran, isThrown)
    const text = isThrown ? '' : outputOf(ran)

    await update(d, crumbs, list => list.map(c => (c.id === id ? { ...c, outcome } : c)))

    if (tool === 'Bash') {
      const cmd = typeof input.command === 'string' ? input.command : ''

      await recordBash(d, cmd, outcome, now)

      if (isTestCommand(cmd) && outcome !== 'denied') {
        await recordTestRun(d, cmd, text, outcome, now)
      }
      if (outcome !== 'denied') {
        const found = parseStack(text)

        if (found !== null && (outcome === 'fail' || /Traceback|^\s+at\s/m.test(text))) {
          await update(d, trace, () => ({ kind: found.kind, message: found.message, frames: found.frames.slice(0, 30), at: now, cmd: oneLine(redact(cmd), 80) }))
        }
      }
    } else if (outcome === 'fail' && text !== '') {
      const found = parseStack(text)

      if (found !== null) {
        await update(d, trace, () => ({ kind: found.kind, message: found.message, frames: found.frames.slice(0, 30), at: now, cmd: tool }))
      }
    }
    if (outcome === 'fail' && text !== '') {
      await update(d, clusters, list => addCluster(list, text.slice(0, TRACE_KEEP_CHARS), tool, now))
    }
    if ((tool === 'Edit' || tool === 'Write') && outcome === 'ok') {
      const file = typeof input.file_path === 'string' ? input.file_path : ''

      await update(d, edits, n => n + 1)

      if (file !== '' && isTestFile(file)) {
        await update(d, testFiles, list => (list.includes(file) ? list : [...list, file].slice(-30)))
      }
    }
  } catch {
    // Recording must never change what a tool call returns.
  }
}

// ---------------------------------------------------------------- 54 regression offer (after a turn, so the prompt box can take it)

const maybeOffer = async (d: Dollar): Promise<void> => {
  const pending = await read(d, offer)

  if (pending === null || !(await read(d, isGuardOn))) {
    return
  }
  const isSent = await gatedToast(d, 'debug-kit: that command passes now after failing. Tab in the prompt box takes a regression-test request.')

  if (isSent) {
    await safe(() => d.prompt.suggest({ text: regressionPrompt(pending.cmd) }), undefined)
  }
}

const fillRegression = async (d: Dollar): Promise<void> => {
  const pending = await read(d, offer)

  if (pending !== null) {
    await d.prompt.fill({ text: regressionPrompt(pending.cmd), mode: 'replace' })
    await update(d, offer, () => null)
  }
}

// ---------------------------------------------------------------- command bodies

const trailText = async (d: Dollar): Promise<string> => {
  const list = await read(d, crumbs)

  return list.length === 0 ? 'No attempts recorded yet.' : [`${list.length} attempts (newest last):`, ...list.slice(-12).map(crumbLine)].join('\n')
}

const flakyText = async (d: Dollar): Promise<string> => {
  const all = await read(d, runs)
  const t = flakyTally(all)

  if (all.length === 0) {
    return 'No test runs seen yet.'
  }
  const rows = t.flaky.slice(0, 10).map(r => `  ${r.name}  failed then passed x${r.flips} with no edit in between`)

  return [
    `${all.length} test run${all.length === 1 ? '' : 's'} seen. Suspected flaky: ${t.flaky.length}. Failures that went away after an edit: ${t.fixed}.`,
    ...rows,
  ].join('\n')
}

const covText = async (d: Dollar): Promise<string> => {
  const rows = coverageRows(await read(d, runs))

  return rows.length === 0
    ? 'No coverage lines seen (looking for "All files | 83.4", "TOTAL ... 92%" or "coverage: 83.4% of statements").'
    : ['Coverage per run:', ...rows.map(r => `  ${r.cov.toFixed(1)}%  ${fmtDelta(r.delta)}`)].join('\n')
}

const timeText = async (d: Dollar): Promise<string> => {
  const i = await read(d, info)

  if (i === null || i.timings.length === 0) {
    return 'No test durations seen (jest/vitest print them with --verbose, pytest with --durations=10).'
  }

  return [`Slowest in \`${oneLine(i.cmd, 50)}\`:`, ...rankSlowest(i.timings, 10).map(t => `  ${fmtMs(t.ms).padStart(8)}  ${oneLine(t.name, 80)}`)].join('\n')
}

const snapText = async (d: Dollar): Promise<string> => {
  const i = await read(d, info)

  if (i === null || i.snaps === null) {
    return 'No snapshot lines seen in test output.'
  }

  return [snapshotSummary(i.snaps), ...i.snapLines.map(l => `  ${l}`)].join('\n')
}

const errText = async (d: Dollar): Promise<string> => {
  const list = [...(await read(d, clusters))].sort((a, b) => b.count - a.count)

  return list.length === 0
    ? 'No tool errors recorded.'
    : [`${list.length} error group${list.length === 1 ? '' : 's'}:`, ...list.slice(0, 10).map(c => `  x${c.count}  ${c.sample}  [${c.tools.join(', ')}]`)].join('\n')
}

const hypText = async (d: Dollar): Promise<string> => {
  const list = await read(d, hyps)

  return list.length === 0
    ? 'No hypotheses yet. /dbhyp <text> adds one.'
    : list.map(hy => `  ${hy.n}. [${hy.status === 'ok' ? 'confirmed' : hy.status === 'no' ? 'ruled out' : 'open'}] ${hy.text}`).join('\n')
}

const hypCommand = async (d: Dollar, args: string): Promise<string> => {
  const cmd = parseHypArgs(args)

  if (cmd.kind === 'bad') {
    return cmd.msg
  }
  if (cmd.kind === 'add') {
    const now = await d.clock.now()
    const n = (await read(d, hypSeq)) + 1

    await update(d, hypSeq, () => n)
    await update(d, hyps, list => [...list, { n, text: cmd.text, status: 'open' as const, at: now }].slice(-KEEP_HYPS))
    await openPane(d, 'ideas')

    return `Hypothesis ${n} added.\n${await hypText(d)}`
  }
  if (cmd.kind === 'mark') {
    const list = await read(d, hyps)

    if (!list.some(hy => hy.n === cmd.n)) {
      return `No hypothesis ${cmd.n}.\n${await hypText(d)}`
    }
    const status = cmd.status
    await update(d, hyps, cur => (status === 'rm' ? cur.filter(hy => hy.n !== cmd.n) : cur.map(hy => (hy.n === cmd.n ? { ...hy, status } : hy))))
  }

  return hypText(d)
}

const markHyp = (d: Dollar, n: number, status: 'open' | 'ok' | 'no') =>
  update(d, hyps, list => list.map(hy => (hy.n === n ? { ...hy, status } : hy)))

const recCommand = async (d: Dollar, args: string): Promise<string> => {
  const word = args.trim().toLowerCase()
  const now = await d.clock.now()

  if (word === 'start') {
    await update(d, rec, () => ({ isOn: true, startedAt: now, steps: [] }))

    return 'Recording Bash commands. /dbrec stop ends it, /dbrec show lists them.'
  }
  if (word === 'stop') {
    const was = (await read(d, rec)).isOn

    await update(d, rec, cur => ({ ...cur, isOn: false }))

    return was ? `Stopped. ${(await read(d, rec)).steps.length} commands recorded. /dbrec show lists them.` : 'Not recording.'
  }
  if (word === 'show' || word === '') {
    const r = await read(d, rec)

    await openPane(d, 'repro')

    return `${r.isOn ? 'Recording' : 'Stopped'}: ${r.steps.length} command${r.steps.length === 1 ? '' : 's'}\n${reproText(r.steps)}`
  }

  return 'Usage: /dbrec start | stop | show'
}

const tailCommand = async (d: Dollar, args: string): Promise<string> => {
  const word = args.trim()

  if (word.toLowerCase() === 'off') {
    stopTail()
    await update(d, tail, () => ({ path: '', lines: [], size: 0, mtimeMs: 0, at: 0, error: '' }))

    return 'Tail stopped.'
  }
  const t = word === '' ? { path: (await read(d, tail)).path, error: '' } : checkTailPath(word)

  if (t.path === '') {
    return t.error === '' ? 'Usage: /dbtail <path> (relative to the project or absolute); /dbtail off stops it.' : t.error
  }
  await update(d, tail, () => ({ path: t.path, lines: [], size: 0, mtimeMs: 0, at: 0, error: '' }))
  await openPane(d, 'tail')
  const isLive = await startTail(d)
  await refreshTail(d)

  return `Tailing ${t.path} (read-only, last ${TAIL_BYTES / 1024} KB). ${isLive ? 'Refreshes every 3 s while the pane is open.' : 'Motion is off: refresh by hand with the Refresh button or /dbtail again.'}`
}

const takeEnv = async (d: Dollar): Promise<string> => {
  const rows: { cmd: string; out: string; isOk: boolean }[] = []

  for (const cmd of ENV_ALLOW) {
    const argv = [cmd, '--version']

    if (!isAllowedVersionArgv(argv)) {
      continue
    }
    try {
      const r = await d.process.run(argv, { timeoutMs: 5000 })
      const out = oneLine((r.stdout !== '' ? r.stdout : r.stderr).split(/\r?\n/)[0] ?? '', 80)

      rows.push({ cmd, out, isOk: r.exitCode === 0 && out !== '' })
    } catch {
      rows.push({ cmd, out: '', isOk: false })
    }
  }
  const now = await d.clock.now()

  await update(d, env, () => ({ at: now, rows }))
  await openPane(d, 'repro')

  return `Environment (read-only --version commands):\n${envText(rows)}`
}

const findPort = async (d: Dollar, arg: string): Promise<string> => {
  const n = validPort(arg)

  if (n === null) {
    return 'Usage: /dbport <number 1-65535>'
  }
  try {
    const r = await d.process.run(portArgv(n), { timeoutMs: 8000 })
    const rows = parseLsof(r.stdout)
    const now = await d.clock.now()
    const text =
      rows.length === 0
        ? `Nothing found on port ${n} (lsof only sees your own processes unless run as root).`
        : `Port ${n}:\n${rows.map(r2 => `  ${r2}`).join('\n')}`

    await update(d, port, () => ({ port: n, at: now, text, rows }))
    await openPane(d, 'repro')

    return text
  } catch {
    return 'Could not run lsof here (not installed or process access is unavailable).'
  }
}

const scanMocksNow = async (d: Dollar): Promise<string> => {
  const files = await read(d, testFiles)
  const now = await d.clock.now()

  if (files.length === 0) {
    await update(d, mocks, () => ({ at: now, files: 0, hits: [], error: '' }))

    return 'No test files edited this session yet (Edit or Write on *.test.*, *.spec.*, test_*.py, *_test.go ...).'
  }
  const hits: MockHit[] = []
  let readCount = 0

  for (const file of files.slice(-20)) {
    try {
      const text = await d.fs.read(file, { length: 300_000 })

      readCount += 1
      hits.push(...scanMocks(text).map(hy => ({ ...hy, file: shortPath(file) })))
    } catch {
      // A file that moved or was deleted is skipped.
    }
  }
  await update(d, mocks, () => ({ at: now, files: readCount, hits: hits.slice(0, 120), error: '' }))
  await openPane(d, 'tests')

  return hits.length === 0
    ? `No mocks found in ${readCount} edited test file${readCount === 1 ? '' : 's'}.`
    : [`${hits.length} mock${hits.length === 1 ? '' : 's'} in ${readCount} file${readCount === 1 ? '' : 's'}:`, ...hits.slice(0, 20).map(hy => `  ${hy.kind.padEnd(6)} ${hy.name}  ${hy.file}:${hy.line}`)].join('\n')
}

const buildPost = async (d: Dollar): Promise<string> => {
  const text = buildPostmortem({
    crumbs: await read(d, crumbs),
    hyps: await read(d, hyps),
    clusters: await read(d, clusters),
    trace: await read(d, trace),
    runs: await read(d, runs),
  })

  await update(d, post, () => text)

  return text
}

const resetAll = async (d: Dollar): Promise<void> => {
  stopTail()
  await update(d, crumbs, () => [])
  await update(d, crumbSeq, () => 0)
  await update(d, runs, () => [])
  await update(d, info, () => null)
  await update(d, clusters, () => [])
  await update(d, trace, () => null)
  await update(d, hyps, () => [])
  await update(d, hypSeq, () => 0)
  await update(d, rec, () => ({ isOn: false, startedAt: 0, steps: [] }))
  await update(d, env, () => null)
  await update(d, tail, () => ({ path: '', lines: [], size: 0, mtimeMs: 0, at: 0, error: '' }))
  await update(d, mocks, () => null)
  await update(d, port, () => null)
  await update(d, cmds, () => [])
  await update(d, offer, () => null)
  await update(d, loopMark, () => null)
  await update(d, testFiles, () => [])
  await update(d, edits, () => 0)
  await update(d, lastToastAt, () => 0)
  await update(d, post, () => '')
}

const fillPrompt = async (d: Dollar, text: string): Promise<void> => {
  await d.prompt.fill({ text, mode: 'replace' })
}

const runCommand = async (d: Dollar, name: string, args: string): Promise<{ text: string }> => {
  const arg = args.trim()

  if (name === 'db') {
    return { text: ['debug-kit commands:', ...HELP_LINES.map(l => `  ${l}`), 'All data stays in this session; /dbreset clears it. Shell use is read-only (--version, lsof -i).'].join('\n') }
  }
  if (name === 'dbfocus') {
    const run = lastFailedRun(await read(d, runs))

    if (run === undefined) {
      return { text: 'No failed test run seen yet. Run your tests with the Bash tool first; I read the names from that output.' }
    }
    await fillPrompt(d, focusPrompt(run))
    const cmd = focusCommand(run.cmd, run.runner, run.failed)

    return { text: `Prompt filled: re-run ${run.failed.length} failing test${run.failed.length === 1 ? '' : 's'} only.${cmd === '' ? '' : `\nSuggested: ${cmd}`}` }
  }
  if (name === 'dbbisect') {
    const p = parseBisectArgs(arg)

    if (p.msg !== '') {
      return { text: p.msg }
    }
    const last = (await read(d, runs)).slice(-1)[0]
    const testCmd = last === undefined ? '' : last.cmd

    await fillPrompt(d, bisectPrompt(p.good, p.bad, testCmd))

    return { text: bisectGuide(p.good, p.bad, testCmd) }
  }
  if (name === 'dbtrace') {
    const t = await read(d, trace)

    if (t === null) {
      return { text: 'No stack trace seen yet in a tool error or Bash output.' }
    }
    await openPane(d, 'errors')

    return { text: traceText(t) }
  }
  if (name === 'dbrec') {
    return { text: await recCommand(d, arg) }
  }
  if (name === 'dbflaky') {
    await openPane(d, 'tests')

    return { text: await flakyText(d) }
  }
  if (name === 'dbcov') {
    await openPane(d, 'tests')

    return { text: await covText(d) }
  }
  if (name === 'dbtime') {
    await openPane(d, 'tests')

    return { text: await timeText(d) }
  }
  if (name === 'dbsnap') {
    await openPane(d, 'tests')

    return { text: await snapText(d) }
  }
  if (name === 'dbtail') {
    return { text: await tailCommand(d, arg) }
  }
  if (name === 'dberr') {
    await openPane(d, 'errors')

    return { text: await errText(d) }
  }
  if (name === 'dbhyp') {
    return { text: await hypCommand(d, arg) }
  }
  if (name === 'dbtrail') {
    await openPane(d, 'trail')

    return { text: await trailText(d) }
  }
  if (name === 'dbenv') {
    return { text: await takeEnv(d) }
  }
  if (name === 'dbshrink') {
    const run = lastFailedRun(await read(d, runs))
    const target = arg !== '' ? oneLine(redact(arg), 200) : (run?.failed[0] ?? '')

    await fillPrompt(d, shrinkPrompt(target, run === undefined ? '' : run.cmd))

    return { text: 'Prompt filled: shrink the failing case to a minimal repro.' }
  }
  if (name === 'dbguard') {
    const word = arg.toLowerCase()

    if (word === 'on' || word === 'off') {
      await update(d, isGuardOn, () => word === 'on')
    }
    const isOn = await read(d, isGuardOn)

    return { text: `Guards are ${isOn ? 'on' : 'off'}: regression-test offer after a fix and a toast on a crash loop (3 failures in 2 min), at most one toast per ${GATE_MS / 60000} minutes. /dbguard on | off.` }
  }
  if (name === 'dbassert') {
    const run = lastFailedRun(await read(d, runs))
    const target = arg !== '' ? oneLine(redact(arg), 200) : (run?.failed[0] ?? '')

    await fillPrompt(d, assertPrompt(target))

    return { text: 'Prompt filled: suggest precise assertions.' }
  }
  if (name === 'dbmocks') {
    return { text: await scanMocksNow(d) }
  }
  if (name === 'dbport') {
    return { text: await findPort(d, arg) }
  }
  if (name === 'dbpost') {
    const text = await buildPost(d)

    await openPane(d, 'post')

    return { text: `${text}\n\n(Shown only: no file was written.)` }
  }
  if (name === 'dbreset') {
    await resetAll(d)

    return { text: 'debug-kit data cleared.' }
  }

  return { text: `Unknown debug-kit command /${name}.` }
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
    if (refused.length > 0) {
      await safe(() => $.ui.toast(`debug-kit: /${refused.join(', /')} could not be registered (name taken)`, { timeoutMs: 8000 }), undefined)
    }

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => runCommand($, name, e.args))
  }

  on('tool.call', async ($, e, next) => {
    const input = asInput(e)
    const id = e.tool_use_id
    let ran: unknown
    let isThrown = false

    await safe(() => startCall($, id, e.tool, input), 0)

    try {
      ran = await next(e)

      return ran as Awaited<ReturnType<typeof next>>
    } catch (error) {
      isThrown = true
      throw error
    } finally {
      await finishCall($, id, e.tool, input, ran, isThrown)
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await safe(() => maybeOffer($), undefined)
    }

    return result
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)

    if (e.id === PANE) {
      stopTail()
    }

    return closed
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------ the pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 9)
    const cols = e.props.bodyColumns
    const active = await read($, tab)
    const wide = Math.max(24, cols - 8)

    const Section = (label: string) => (
      <Box marginTop="md">
        <Text size="caption" weight="semibold" dimColor>
          {label.toUpperCase()}
        </Text>
      </Box>
    )
    const Empty = (text: string) => <Text dimColor>{text}</Text>

    let body: unknown = null

    if (active === 'trail') {
      const list = await read($, crumbs)
      const fails = list.filter(c => c.outcome === 'fail').length
      const isGuard = await read($, isGuardOn)

      body = (
        <Box flexDirection="column">
          <Text dimColor tabular>{`${list.length} attempts, ${fails} failed`}</Text>
          {list.length === 0 && Empty('Tool calls show up here as you debug: tool, one-line detail, outcome.')}
          {[...list].reverse().slice(0, room).map(c => (
            <Box gap="sm">
              <Text mono tabular dimColor>{String(c.n).padStart(3)}</Text>
              <Text color={c.outcome === 'ok' ? 'success' : c.outcome === 'fail' ? 'error' : 'subtle'}>{glyphOf(c.outcome)}</Text>
              <Text weight="semibold">{c.tool}</Text>
              <Text dimColor>{oneLine(c.detail, wide - 14)}</Text>
            </Box>
          ))}
          {Section('Guards')}
          <Box gap="sm">
            <Text dimColor>{`regression offer + crash-loop toast: ${isGuard ? 'on' : 'off'}`}</Text>
            <Button key="dk-guard" dimColor label={isGuard ? 'turn off' : 'turn on'} onPress={() => update($, isGuardOn, v => !v)} />
          </Box>
        </Box>
      )
    } else if (active === 'tests') {
      const all = await read($, runs)
      const inf = await read($, info)
      const failedRun = lastFailedRun(all)
      const lastRun = all[all.length - 1]
      const flake = flakyTally(all)
      const cov = coverageRows(all, 6)
      const scan = await read($, mocks)

      body = (
        <Box flexDirection="column">
          {lastRun === undefined && Empty('No test run seen yet. Run tests with Bash (jest, vitest, pytest, go test, cargo test).')}
          {lastRun !== undefined && (
            <Text mono>{oneLine(`${lastRun.isGreen ? 'PASS' : 'FAIL'}  ${lastRun.cmd}  (${lastRun.nPassed} passed, ${lastRun.nFailed} failed)`, wide)}</Text>
          )}
          {Section('Failing')}
          {failedRun === undefined && Empty('Nothing failing in the runs seen.')}
          {failedRun !== undefined && failedRun.failed.slice(0, 6).map(n => <Text color="error">{oneLine(n, wide)}</Text>)}
          {failedRun !== undefined && (
            <Box gap="sm" marginTop="sm">
              <Button key="dk-focus" variant="primary" label="Re-run only these (fill prompt)" onPress={() => runCommand($, 'dbfocus', '')} />
              <Button key="dk-shrink" label="Shrink" onPress={() => runCommand($, 'dbshrink', '')} />
              <Button key="dk-assert" label="Assertions" onPress={() => runCommand($, 'dbassert', '')} />
            </Box>
          )}
          {Section('Coverage')}
          {cov.length === 0 && Empty('No coverage lines seen yet.')}
          {cov.map(r => (
            <Box gap="sm">
              <Text mono tabular>{`${r.cov.toFixed(1)}%`}</Text>
              <Text mono tabular color={r.delta === null || r.delta === 0 ? 'subtle' : r.delta > 0 ? 'success' : 'error'}>{fmtDelta(r.delta)}</Text>
            </Box>
          ))}
          {Section('Slowest tests')}
          {(inf === null || inf.timings.length === 0) && Empty('No durations seen (jest --verbose, vitest, pytest --durations=10).')}
          {inf !== null && rankSlowest(inf.timings, Math.min(8, room)).map(t => (
            <Box gap="sm">
              <Text mono tabular>{fmtMs(t.ms).padStart(8)}</Text>
              <Text>{oneLine(t.name, wide - 12)}</Text>
            </Box>
          ))}
          {Section('Snapshots')}
          {(inf === null || inf.snaps === null) && Empty('No snapshot lines seen.')}
          {inf !== null && inf.snaps !== null && <Text>{oneLine(snapshotSummary(inf.snaps), wide * 2)}</Text>}
          {Section('Flaky')}
          {flake.flaky.length === 0 && Empty(`None suspected. ${flake.fixed} failure${flake.fixed === 1 ? '' : 's'} went away after edits.`)}
          {flake.flaky.slice(0, 6).map(r => (
            <Box gap="sm">
              <Text mono tabular color="warning">{`x${r.flips}`}</Text>
              <Text>{oneLine(r.name, wide - 6)}</Text>
            </Box>
          ))}
          {Section('Mock map')}
          <Button key="dk-mocks" label="Scan test files edited this session" onPress={() => scanMocksNow($)} />
          {scan !== null && scan.hits.length === 0 && Empty(`No mocks found in ${scan.files} file${scan.files === 1 ? '' : 's'}.`)}
          {scan !== null && scan.hits.slice(0, 12).map(hy => (
            <Box gap="sm">
              <Text dimColor mono>{hy.kind.padEnd(6)}</Text>
              <Text>{oneLine(`${hy.name}  ${hy.file}:${hy.line}`, wide - 8)}</Text>
            </Box>
          ))}
        </Box>
      )
    } else if (active === 'errors') {
      const list = [...(await read($, clusters))].sort((a, b) => b.count - a.count)
      const t = await read($, trace)
      const app = t === null ? [] : topAppFrames(t.frames, 5)

      body = (
        <Box flexDirection="column">
          {Section('Error groups')}
          {list.length === 0 && Empty('No tool errors recorded.')}
          {list.slice(0, Math.max(3, room - 8)).map((c: Cluster) => (
            <Box gap="sm">
              <Text mono tabular color="error">{`x${c.count}`}</Text>
              <Text>{oneLine(c.sample, wide - 8)}</Text>
            </Box>
          ))}
          {Section('Last stack trace')}
          {t === null && Empty('No stack trace seen yet.')}
          {t !== null && <Text color="error">{oneLine(`${t.kind}: ${t.message === '' ? 'no message line' : t.message}`, wide)}</Text>}
          {t !== null && app.length === 0 && Empty('No application frames: all frames are library or runtime code.')}
          {app.map(f => <Text mono>{oneLine(frameText(f), wide)}</Text>)}
          {t !== null && (
            <Box flexDirection="column" marginTop="sm">
              <Text size="caption" dimColor>{`all frames (${t.frames.length}), * = application`}</Text>
              {t.frames.slice(0, 10).map(f => <Text mono dimColor>{oneLine(`${f.isApp ? '*' : ' '} ${f.file}:${f.line}`, wide)}</Text>)}
              <Box marginTop="sm">
                <Button key="dk-explain" label="Explain this (fill prompt)" onPress={() => fillPrompt($, tracePrompt(t))} />
              </Box>
            </Box>
          )}
        </Box>
      )
    } else if (active === 'ideas') {
      const list = await read($, hyps)

      body = (
        <Box flexDirection="column">
          {list.length === 0 && Empty('No hypotheses yet. Add one with /dbhyp <text>.')}
          {list.slice(-room).map(hy => (
            <Box gap="sm">
              <Text mono tabular dimColor>{`${hy.n}.`}</Text>
              <Text color={hy.status === 'ok' ? 'success' : hy.status === 'no' ? 'inactive' : undefined} dimColor={hy.status === 'no'}>
                {`${hy.status === 'ok' ? '[confirmed] ' : hy.status === 'no' ? '[ruled out] ' : ''}${oneLine(hy.text, wide - 14)}`}
              </Text>
              <Button key={`dk-ok-${hy.n}`} label="ok" onPress={() => markHyp($, hy.n, 'ok')} />
              <Button key={`dk-no-${hy.n}`} label="no" onPress={() => markHyp($, hy.n, 'no')} />
              <Button key={`dk-open-${hy.n}`} dimColor label="open" onPress={() => markHyp($, hy.n, 'open')} />
            </Box>
          ))}
        </Box>
      )
    } else if (active === 'repro') {
      const r = await read($, rec)
      const en = await read($, env)
      const pt = await read($, port)

      body = (
        <Box flexDirection="column">
          <Box gap="sm">
            <Text weight="semibold">{r.isOn ? 'Recording' : 'Recorder stopped'}</Text>
            <Text dimColor tabular>{`${r.steps.length} commands`}</Text>
            <Button key="dk-rec-start" label="start" onPress={() => recCommand($, 'start')} />
            <Button key="dk-rec-stop" label="stop" onPress={() => recCommand($, 'stop')} />
          </Box>
          {r.steps.length === 0 && Empty('Start the recorder, run the failing steps, then stop.')}
          {r.steps.slice(-Math.max(3, room - 12)).map((s, i) => (
            <Text mono color={s.outcome === 'fail' ? 'error' : undefined}>{oneLine(`${i + 1}. ${s.cmd}`, wide)}</Text>
          ))}
          {Section('Environment')}
          <Button key="dk-env" label="Record versions" onPress={() => takeEnv($)} />
          {en !== null && en.rows.map(row => (
            <Text mono dimColor={!row.isOk}>{`${row.cmd.padEnd(8)} ${row.isOk ? row.out : 'not available'}`}</Text>
          ))}
          {Section('Port')}
          {pt === null && Empty('/dbport <n> shows what listens on a port.')}
          {pt !== null && <Text>{`Port ${pt.port}`}</Text>}
          {pt !== null && pt.rows.length === 0 && Empty('Nothing found.')}
          {pt !== null && pt.rows.map(row => <Text mono>{oneLine(row, wide)}</Text>)}
        </Box>
      )
    } else if (active === 'tail') {
      const t = await read($, tail)
      const live = tailTimer !== undefined

      body = (
        <Box flexDirection="column">
          {t.path === '' && Empty('/dbtail <path> follows a file, read-only.')}
          {t.path !== '' && (
            <Box gap="sm">
              <Text mono weight="semibold">{oneLine(t.path, wide - 30)}</Text>
              <Text dimColor>{live ? 'live, every 3 s' : 'manual (motion off or timer not running)'}</Text>
              <Button key="dk-tail-now" label="Refresh" onPress={() => refreshTail($)} />
              <Button key="dk-tail-off" dimColor label="Stop" onPress={() => runCommand($, 'dbtail', 'off')} />
            </Box>
          )}
          {t.error !== '' && <Text color="error">{t.error}</Text>}
          {t.path !== '' && t.error === '' && t.lines.length === 0 && Empty('The file is empty.')}
          {t.lines.slice(-Math.max(5, room + 2)).map(l => <Text mono>{oneLine(l, wide + 4)}</Text>)}
        </Box>
      )
    } else {
      const text = await read($, post)

      body = (
        <Box flexDirection="column">
          <Box gap="sm" marginBottom="sm">
            <Button key="dk-post-build" variant="primary" label={text === '' ? 'Draft postmortem' : 'Refresh draft'} onPress={() => buildPost($)} />
            {text !== '' && (
              <Button key="dk-post-fill" label="Ask Claude to polish (fill prompt)" onPress={() => fillPrompt($, `Polish this postmortem draft. Keep it short and blameless, fill the blanks you can from the session, and tell me what is missing:\n\n${text}`)} />
            )}
          </Box>
          {text === '' && Empty('Builds a markdown write-up from the trail, hypotheses and errors. Shown here only; no file is written.')}
          {text.split('\n').slice(0, room + 8).map(l => <Text mono>{oneLine(l, wide + 4)}</Text>)}
        </Box>
      )
    }
    const pending = await read($, offer)

    return (
      <Box flexDirection="column" padding="sm">
        {pending !== null && (
          <Box gap="sm" marginBottom="sm">
            <Text color="suggestion">{oneLine(`Passing now: ${pending.cmd}`, wide - 30)}</Text>
            <Button key="dk-reg" variant="primary" label="Ask for a regression test" onPress={() => fillRegression($)} />
            <Button key="dk-reg-x" dimColor label="dismiss" onPress={() => update($, offer, () => null)} />
          </Box>
        )}
        <Box gap="sm" flexWrap="wrap" marginBottom="sm">
          {TABS.map(([id, label]) => (
            <Button
              key={`dk-tab-${id}`}
              variant={id === active ? 'primary' : undefined}
              label={id === active ? `* ${label}` : label}
              onPress={() => selectTab($, id)}
            />
          ))}
        </Box>
        {body as never}
      </Box>
    )
  })
}
