// Pure helpers for debug-kit: every parser lives here so it can be tested without the engine.
import type {
  CmdRec,
  Cluster,
  Crumb,
  Frame,
  Hyp,
  MockHit,
  SnapCounts,
  TestRun,
  Timing,
  TraceInfo,
} from '../types'

export type Input = Record<string, unknown>

// ---------------------------------------------------------------- small text helpers

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g

export const stripAnsi = (text: string): string => text.replace(ANSI, '')

export const oneLine = (text: string, max = 100): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1))}…` : flat
}

export const redact = (text: string): string =>
  text
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, '[secret]')
    .replace(/\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{12,}/g, '[secret]')
    .replace(/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, '[secret]')
    .replace(/\bAKIA[0-9A-Z]{12,}/g, '[secret]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[secret]')
    .replace(/(--(?:password|passwd|token|secret|api-key|apikey)[= ])\S+/gi, '$1[hidden]')
    .replace(/\b((?:password|passwd|pwd|secret|token|api[_-]?key|apikey|auth)\s*[=:]\s*)(?!\[)\S+/gi, '$1[hidden]')

export const signatureOf = (cmd: string): string => cmd.replace(/\s+/g, ' ').trim().slice(0, 300)

export const fmtMs = (ms: number): string => {
  if (!(ms >= 0)) {
    return '0ms'
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  }

  return `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

export const shortPath = (path: string, parts = 3): string => {
  const segs = path.split('/').filter(Boolean)

  return segs.length <= parts ? path : `…/${segs.slice(-parts).join('/')}`
}

export const shq = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

// ---------------------------------------------------------------- tool output

// What a tool call's result says to the model: `text` when core set it, else stdout/stderr or a string.
export const outputOf = (ran: unknown): string => {
  if (ran === null || typeof ran !== 'object') {
    return typeof ran === 'string' ? ran : ''
  }
  const r = ran as { text?: unknown; result?: unknown }

  if (typeof r.text === 'string') {
    return r.text
  }
  const res = r.result

  if (typeof res === 'string') {
    return res
  }
  if (res !== null && typeof res === 'object') {
    const o = res as { stdout?: unknown; stderr?: unknown; output?: unknown }
    const parts = [o.stdout, o.stderr, o.output].filter((x): x is string => typeof x === 'string' && x !== '')

    return parts.join('\n')
  }

  return ''
}

export type Outcome = 'ok' | 'fail' | 'denied'

export const outcomeOf = (ran: unknown, isThrown: boolean): Outcome => {
  if (isThrown) {
    return 'fail'
  }
  if (ran === null || typeof ran !== 'object') {
    return 'ok'
  }
  const r = ran as { isError?: unknown; deny?: unknown }

  if (typeof r.deny === 'string') {
    return 'denied'
  }
  if (r.isError === true) {
    return 'fail'
  }

  return /^Exit code [1-9]\d*/.test(outputOf(ran)) ? 'fail' : 'ok'
}

export const detailOf = (tool: string, input: Input): string => {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')

  if (tool === 'Bash') {
    return oneLine(redact(str('command')), 90)
  }
  const file = str('file_path') || str('path') || str('notebook_path')

  if (file !== '') {
    return shortPath(file)
  }
  const pattern = str('pattern') || str('query')

  if (pattern !== '') {
    return oneLine(redact(pattern), 70)
  }
  const url = str('url')

  if (url !== '') {
    return oneLine(url.replace(/^https?:\/\//, '').split(/[?#]/)[0] ?? '', 70)
  }
  const desc = str('description') || str('prompt')

  if (desc !== '') {
    return oneLine(redact(desc), 70)
  }

  return ''
}

// ---------------------------------------------------------------- test commands and output

export const isTestCommand = (cmd: string): boolean =>
  /(^|[\s;&|(])(jest|vitest|pytest|py\.test|mocha|ava|phpunit|rspec|nextest)(\s|$)/.test(cmd) ||
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|tests|t|test:[\w:-]+)\b/.test(cmd) ||
  /\bgo\s+test\b/.test(cmd) ||
  /\bcargo\s+(test|nextest)\b/.test(cmd) ||
  /\bpython3?\s+-m\s+(pytest|unittest)\b/.test(cmd) ||
  /\b(deno|bun)\s+test\b/.test(cmd) ||
  /\bmake\s+test\b/.test(cmd) ||
  /\b(mvn|gradle|\.\/gradlew)\s+test\b/.test(cmd) ||
  /\bplaywright\s+test\b/.test(cmd)

export type Runner = 'jest' | 'vitest' | 'pytest' | 'go' | 'cargo' | 'mocha' | 'other'

export const runnerOf = (cmd: string, text = ''): Runner => {
  if (/\bvitest\b/.test(cmd)) return 'vitest'
  if (/\bjest\b/.test(cmd)) return 'jest'
  if (/\b(pytest|py\.test)\b|-m\s+pytest/.test(cmd)) return 'pytest'
  if (/\bgo\s+test\b/.test(cmd)) return 'go'
  if (/\bcargo\s+(test|nextest)\b/.test(cmd)) return 'cargo'
  if (/\bmocha\b/.test(cmd)) return 'mocha'
  // `npm test` and friends: say it from the output.
  if (/^\s*Test Files\s/m.test(text) || /\bvitest\b/i.test(text.slice(0, 600))) return 'vitest'
  if (/^Tests:\s/m.test(text) || /^Test Suites:\s/m.test(text)) return 'jest'
  if (/={3,}.*(passed|failed).* in [\d.]+s/.test(text) || /^collected \d+ items?/m.test(text)) return 'pytest'
  if (/^test result: /m.test(text)) return 'cargo'
  if (/^--- (PASS|FAIL):/m.test(text)) return 'go'

  return 'other'
}

export type ParsedTests = {
  failed: string[]
  passed: string[]
  nFailed: number
  nPassed: number
  hasSummary: boolean
}

const addUnique = (list: string[], name: string, cap: number) => {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 200)

  if (clean !== '' && !list.includes(clean) && list.length < cap) {
    list.push(clean)
  }
}

const countOf = (line: string, word: string): number => {
  const m = new RegExp(`(\\d+)\\s+${word}\\b`, 'i').exec(line)

  return m === null ? 0 : Number(m[1])
}

export const parseTestOutput = (raw: string): ParsedTests => {
  const text = stripAnsi(raw)
  const lines = text.split(/\r?\n/)
  const failed: string[] = []
  const passed: string[] = []
  let inMochaFailing = false

  for (const line of lines) {
    let m: RegExpExecArray | null

    // jest: "  ● suite › test name"
    if ((m = /^\s*●\s+(.+?)\s*$/.exec(line)) !== null) {
      const name = m[1] ?? ''

      if (!/^(Console|Test suite failed to run|Validation Warning|Deprecation)/i.test(name)) {
        addUnique(failed, name.replace(/\s+\(\d+\s*ms\)$/, ''), 60)
      }
      continue
    }
    // vitest: " FAIL  src/a.test.ts > math > adds"
    if ((m = /^\s*FAIL\s+(\S.*?\s>\s.+?)\s*$/.exec(line)) !== null) {
      addUnique(failed, m[1] ?? '', 60)
      continue
    }
    // pytest: "FAILED tests/x.py::test_a - msg", "ERROR tests/x.py::test_b"
    if ((m = /^(?:FAILED|ERROR)\s+(\S+::\S+?)(?:\s+-\s.*)?\s*$/.exec(line)) !== null) {
      addUnique(failed, m[1] ?? '', 60)
      continue
    }
    // go
    if ((m = /^\s*--- FAIL:\s+(\S+)/.exec(line)) !== null) {
      addUnique(failed, m[1] ?? '', 60)
      continue
    }
    // cargo
    if ((m = /^test\s+(\S+)\s+\.\.\.\s+FAILED\s*$/.exec(line)) !== null) {
      addUnique(failed, m[1] ?? '', 60)
      continue
    }
    // mocha: after "N failing", "  1) suite test:"
    if (/^\s*\d+\s+failing\b/.test(line)) {
      inMochaFailing = true
      continue
    }
    if (inMochaFailing && (m = /^\s+\d+\)\s+(.+?):?\s*$/.exec(line)) !== null) {
      addUnique(failed, m[1] ?? '', 60)
      continue
    }
    // passed names
    if ((m = /^\s*[✓✔√]\s+(.+?)(?:\s+\(?\d+(?:\.\d+)?\s*m?s\)?)?\s*$/.exec(line)) !== null) {
      addUnique(passed, m[1] ?? '', 200)
      continue
    }
    if ((m = /^(\S+::\S+)\s+PASSED\b/.exec(line)) !== null) {
      addUnique(passed, m[1] ?? '', 200)
      continue
    }
    if ((m = /^\s*--- PASS:\s+(\S+)/.exec(line)) !== null) {
      addUnique(passed, m[1] ?? '', 200)
      continue
    }
    if ((m = /^test\s+(\S+)\s+\.\.\.\s+ok\s*$/.exec(line)) !== null) {
      addUnique(passed, m[1] ?? '', 200)
    }
  }

  // jest/vitest print the failing titles twice (● block and ✕ line): the ✕ short form is a fallback only.
  if (failed.length === 0) {
    for (const line of lines) {
      const m = /^\s*[✕✗×]\s+(.+?)(?:\s+\(?\d+(?:\.\d+)?\s*m?s\)?)?\s*$/.exec(line)

      if (m !== null) {
        addUnique(failed, m[1] ?? '', 60)
      }
    }
  }

  let nFailed = failed.length
  let nPassed = passed.length
  let hasSummary = false
  const jest = /^\s*Tests:?\s+(.+)$/m.exec(text)
  const cargo = /^test result: \w+\.\s+(\d+) passed;\s+(\d+) failed/m.exec(text)
  const pytest = /^(?:=+\s*)?((?:\d+\s+(?:failed|passed|error|errors|skipped|xfailed|xpassed|warnings?|deselected)[,\s]*)+)\s+in\s+[\d.]+s/im.exec(text)

  if (jest !== null && /\d+\s+(failed|passed|total)/.test(jest[1] ?? '')) {
    hasSummary = true
    nFailed = Math.max(countOf(jest[1] ?? '', 'failed'), 0)
    nPassed = countOf(jest[1] ?? '', 'passed')
  } else if (cargo !== null) {
    hasSummary = true
    nPassed = Number(cargo[1])
    nFailed = Number(cargo[2])
  } else if (pytest !== null) {
    hasSummary = true
    nFailed = countOf(pytest[1] ?? '', 'failed') + countOf(pytest[1] ?? '', 'errors?')
    nPassed = countOf(pytest[1] ?? '', 'passed')
  } else if (/^(ok|FAIL)\s+\S+\s+[\d.]+s/m.test(text)) {
    hasSummary = true
    nFailed = failed.length > 0 ? failed.length : /^FAIL\s/m.test(text) ? 1 : 0
  }

  return { failed, passed, nFailed, nPassed, hasSummary }
}

export const shortName = (name: string): string => {
  const parts = name.split(/\s›\s|\s>\s|::|\//)

  return (parts[parts.length - 1] ?? name).trim()
}

// ---------------------------------------------------------------- 41 failing-test focus

export const lastFailedRun = (runs: readonly TestRun[]): TestRun | undefined => {
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]

    if (run !== undefined && (run.nFailed > 0 || run.failed.length > 0 || !run.isGreen)) {
      return run
    }
  }

  return undefined
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const focusCommand = (cmd: string, runner: string, names: readonly string[]): string => {
  if (names.length === 0) {
    return ''
  }
  const base = signatureOf(cmd)

  if (runner === 'jest' || runner === 'vitest') {
    const titles = [...new Set(names.map(shortName))].map(escapeRegex)
    const stripped = base.replace(/\s(?:-t|--testNamePattern)(?:=|\s+)(?:'[^']*'|"[^"]*"|\S+)/g, '')
    const bridge = /^(npm|pnpm|bun)\s/.test(stripped) && !/\s--(\s|$)/.test(stripped) ? ' --' : ''

    return `${stripped}${bridge} -t ${shq(titles.join('|'))}`
  }
  if (runner === 'pytest') {
    const m = /^(.*?\b(?:pytest|py\.test))\b/.exec(base)
    const ids = names.filter(n => n.includes('::'))

    return m === null || ids.length === 0 ? '' : `${m[1]} ${ids.map(shq).join(' ')}`
  }
  if (runner === 'go') {
    const tops = [...new Set(names.map(n => n.split('/')[0] ?? n))]

    return `go test ./... -run ${shq(`^(${tops.map(escapeRegex).join('|')})$`)}`
  }
  if (runner === 'cargo') {
    return `cargo test ${names.map(shq).join(' ')}`
  }

  return ''
}

export const focusPrompt = (run: TestRun | undefined): string => {
  if (run === undefined) {
    return ''
  }
  const names = run.failed.slice(0, 20)
  const cmd = focusCommand(run.cmd, run.runner, names)
  const list = names.length === 0 ? '(names could not be parsed from the output)' : names.map(n => `- ${n}`).join('\n')

  return [
    'Re-run only the failing tests from the last failed test run, not the whole suite.',
    `Last run: ${run.cmd}`,
    `Failing (${run.nFailed > 0 ? run.nFailed : names.length}):`,
    list,
    cmd === '' ? 'Pick the right per-test filter for this runner.' : `Suggested command: ${cmd}`,
    'After the re-run, show me only the failures and your read on the first one.',
  ].join('\n')
}

// ---------------------------------------------------------------- 46 coverage

export const parseCoverage = (raw: string): number | null => {
  const text = stripAnsi(raw)
  const all = /All files\s*\|\s*([\d.]+)/.exec(text)

  if (all !== null) {
    return Number(all[1])
  }
  const sum = /Statements\s*:\s*([\d.]+)%/.exec(text)

  if (sum !== null) {
    return Number(sum[1])
  }
  const total = /^TOTAL\s+.*?(\d+(?:\.\d+)?)%\s*$/m.exec(text)

  if (total !== null) {
    return Number(total[1])
  }
  const go = [...text.matchAll(/coverage:\s*([\d.]+)%\s+of statements/g)]
  const last = go[go.length - 1]

  return last === undefined ? null : Number(last[1])
}

export type CovRow = { at: number; cov: number; delta: number | null }

export const coverageRows = (runs: readonly TestRun[], keep = 8): CovRow[] => {
  const rows: CovRow[] = []
  let prev: number | null = null

  for (const run of runs) {
    if (run.cov !== null) {
      rows.push({ at: run.at, cov: run.cov, delta: prev === null ? null : Math.round((run.cov - prev) * 100) / 100 })
      prev = run.cov
    }
  }

  return rows.slice(-keep)
}

export const fmtDelta = (delta: number | null): string =>
  delta === null ? 'first' : delta === 0 ? '±0.0' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`

// ---------------------------------------------------------------- 47 timings

const toMs = (n: number, unit: string): number => Math.round(unit === 's' ? n * 1000 : n)

export const parseTimings = (raw: string): Timing[] => {
  const best = new Map<string, number>()
  const put = (name: string, ms: number) => {
    const key = name.replace(/\s+/g, ' ').trim().slice(0, 160)

    if (key !== '' && Number.isFinite(ms) && ms >= 0) {
      best.set(key, Math.max(best.get(key) ?? 0, ms))
    }
  }

  for (const line of stripAnsi(raw).split(/\r?\n/)) {
    let m: RegExpExecArray | null

    // jest: "✓ name (12 ms)"; vitest: "✓ name 12ms"
    if ((m = /^\s*[✓✔√✕✗×]\s+(.+?)\s+\(?(\d+(?:\.\d+)?)\s*(ms|s)\)?\s*$/.exec(line)) !== null) {
      put(m[1] ?? '', toMs(Number(m[2]), m[3] ?? 'ms'))
      continue
    }
    // vitest file rows: "src/a.test.ts (3 tests) 45ms"
    if ((m = /^\s*[✓❯]?\s*(\S+\.(?:test|spec)\.\S+)\s+\(\d+ tests?[^)]*\)\s+(\d+(?:\.\d+)?)\s*(ms|s)\s*$/.exec(line)) !== null) {
      put(m[1] ?? '', toMs(Number(m[2]), m[3] ?? 'ms'))
      continue
    }
    // pytest --durations: "0.52s call     tests/test_a.py::test_x"
    if ((m = /^\s*(\d+(?:\.\d+)?)(ms|s)\s+(call|setup|teardown)\s+(\S.*?)\s*$/.exec(line)) !== null) {
      put(m[4] ?? '', toMs(Number(m[1]), m[2] ?? 's'))
      continue
    }
    // go: "--- PASS: TestX (0.12s)"
    if ((m = /^\s*--- (?:PASS|FAIL): (\S+)\s+\((\d+(?:\.\d+)?)s\)/.exec(line)) !== null) {
      put(m[1] ?? '', toMs(Number(m[2]), 's'))
    }
  }

  return [...best].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms)
}

export const rankSlowest = (timings: readonly Timing[], n = 10): Timing[] =>
  [...timings].sort((a, b) => b.ms - a.ms).slice(0, n)

// ---------------------------------------------------------------- 57 snapshots

export const EMPTY_SNAPS: SnapCounts = { written: 0, updated: 0, obsolete: 0, removed: 0, failed: 0, passed: 0, unused: 0 }

export const parseSnapshots = (raw: string): { counts: SnapCounts; lines: string[] } | null => {
  const counts: SnapCounts = { ...EMPTY_SNAPS }
  const lines: string[] = []
  let isSeen = false
  const kinds = ['written', 'updated', 'obsolete', 'removed', 'failed', 'passed', 'unused'] as const

  for (const line of stripAnsi(raw).split(/\r?\n/)) {
    const t = line.trim()

    if (/^Snapshots?:?\s+\d/i.test(t)) {
      // jest "Snapshots:   1 obsolete, 2 written, 3 passed, 6 total"; vitest "Snapshots  1 obsolete | 1 written"
      isSeen = true
      lines.push(oneLine(t, 120))

      for (const kind of kinds) {
        const n = countOf(t, kind)

        counts[kind] = Math.max(counts[kind], n)
      }
      continue
    }
    const single = /^(?:[›>*-]\s*)?(\d+)\s+snapshots?\s+(\w+)/i.exec(t)

    if (single !== null) {
      const kind = (single[2] ?? '').toLowerCase()

      if ((kinds as readonly string[]).includes(kind)) {
        isSeen = true
        lines.push(oneLine(t, 120))
        counts[kind as (typeof kinds)[number]] = Math.max(counts[kind as (typeof kinds)[number]], Number(single[1]))
      }
    }
  }

  return isSeen ? { counts, lines: [...new Set(lines)].slice(0, 6) } : null
}

export const snapshotSummary = (c: SnapCounts): string => {
  const parts = (['written', 'updated', 'obsolete', 'removed', 'failed', 'passed', 'unused'] as const)
    .filter(k => c[k] > 0)
    .map(k => `${c[k]} ${k}`)
  const hints: string[] = []

  if (c.obsolete > 0 || c.unused > 0) hints.push('obsolete snapshots can be cleaned with the runner\'s update/ci flag after you check them')
  if (c.written > 0) hints.push('new snapshots were written: review them before committing')
  if (c.updated > 0) hints.push('updated snapshots change expected output: read the diff')
  if (c.failed > 0) hints.push('failed snapshots mean output changed: decide if the change is intended')

  return parts.length === 0 ? 'No snapshot changes.' : `${parts.join(', ')}${hints.length > 0 ? `. ${hints.join('; ')}.` : '.'}`
}

// ---------------------------------------------------------------- 45 flaky

export type FlakyRow = { name: string; flips: number }

export const flakyTally = (runs: readonly TestRun[]): { flaky: FlakyRow[]; fixed: number } => {
  const open = new Map<string, { edits: number; cmd: string }>()
  const flips = new Map<string, number>()
  let fixed = 0

  for (const run of runs) {
    const passedShort = new Set(run.passed.map(shortName))
    const cmd = signatureOf(run.cmd)

    for (const [key, state] of [...open]) {
      const isPass = passedShort.has(key) || (run.isGreen && cmd === state.cmd)

      if (isPass) {
        open.delete(key)

        if (run.edits === state.edits) {
          flips.set(key, (flips.get(key) ?? 0) + 1)
        } else {
          fixed += 1
        }
      }
    }
    for (const name of run.failed) {
      open.set(shortName(name), { edits: run.edits, cmd })
    }
  }

  return {
    flaky: [...flips].map(([name, n]) => ({ name, flips: n })).sort((a, b) => b.flips - a.flips),
    fixed,
  }
}

// ---------------------------------------------------------------- 43 stack traces

const LIB_FILE =
  /node_modules|^node:|node:internal|site-packages|dist-packages|\/usr\/lib\/|\/usr\/local\/lib\/python|<frozen|\/rustc\/|\.cargo\/registry|\/usr\/local\/go\/src|\/go\/pkg\/mod|^internal\/|\(native\)|<anonymous>$/
const LIB_FN = /^(?:java|javax|jdk|sun|kotlin|scala)\.|^org\.junit\.|^org\.gradle\./

const makeFrame = (file: string, line: number, col: number, fn: string): Frame => ({
  file: file.replace(/^file:\/\//, ''),
  line,
  col,
  fn: fn.trim(),
  isApp: !LIB_FILE.test(file) && !LIB_FN.test(fn.trim()),
})

export type Trace = { kind: string; message: string; frames: Frame[] }

export const parseStack = (raw: string): Trace | null => {
  const lines = stripAnsi(raw).split(/\r?\n/)
  const frames: Frame[] = []
  let kind = ''
  let prevText = ''
  let isPython = false

  for (const line of lines) {
    let m: RegExpExecArray | null

    if ((m = /^\s*File "(.+?)", line (\d+)(?:, in (.+))?\s*$/.exec(line)) !== null) {
      isPython = true
      kind ||= 'python'
      frames.push(makeFrame(m[1] ?? '', Number(m[2]), 0, m[3] ?? ''))
    } else if ((m = /^\s*at\s+([\w$.<>]+(?:\.[\w$<>]+)*)\(([\w$.-]+\.(?:java|kt|scala|groovy)):(\d+)\)\s*$/.exec(line)) !== null) {
      kind ||= 'java'
      frames.push(makeFrame(m[2] ?? '', Number(m[3]), 0, m[1] ?? ''))
    } else if ((m = /^\s*at\s+(?:(.+?)\s+\()?((?:file:\/\/)?[^()\s]+?):(\d+)(?::(\d+))?\)?\s*$/.exec(line)) !== null) {
      if (/\.rs$/.test(m[2] ?? '')) {
        kind ||= 'rust'
      } else {
        kind ||= 'javascript'
      }
      frames.push(makeFrame(m[2] ?? '', Number(m[3]), Number(m[4] ?? 0), m[1] ?? ''))
    } else if ((m = /^\s*-->\s+(\S+\.rs):(\d+):(\d+)/.exec(line)) !== null) {
      kind ||= 'rust'
      frames.push(makeFrame(m[1] ?? '', Number(m[2]), Number(m[3]), ''))
    } else if ((m = /^\s+(\/\S+\.go):(\d+)(?:\s+\+0x[0-9a-f]+)?\s*$/.exec(line)) !== null) {
      kind ||= 'go'
      frames.push(makeFrame(m[1] ?? '', Number(m[2]), 0, prevText.replace(/\(.*$/, '')))
    }
    prevText = line.trim()
  }

  if (frames.length < 2 && !(isPython && frames.length >= 1)) {
    return null
  }
  // Python prints the oldest call first: put the newest first like the others.
  const ordered = isPython ? [...frames].reverse() : frames
  let message = ''

  if (isPython) {
    const tail = lines.filter(l => /^\w[\w.]*(?:Error|Exception|Exit|Interrupt|Warning)\b.*/.test(l.trim()) && !/^\s/.test(l))
    message = tail[tail.length - 1] ?? ''
  }
  if (message === '') {
    const hit = lines.find(l => /^\s*(?:Uncaught\s+)?(?:[\w$.]*\.)?\w*(?:Error|Exception)\b[:\s]/.test(l) || /^\s*panic:/.test(l) || /panicked at/.test(l) || /^\s*Error:/.test(l))
    message = hit ?? ''
  }

  return { kind, message: oneLine(message.trim(), 160), frames: ordered.slice(0, 60) }
}

export const topAppFrames = (frames: readonly Frame[], n = 5): Frame[] => frames.filter(f => f.isApp).slice(0, n)

export const frameText = (f: Frame): string =>
  `${f.file}:${f.line}${f.col > 0 ? `:${f.col}` : ''}${f.fn === '' ? '' : `  ${oneLine(f.fn, 50)}`}`

export const traceText = (t: Pick<TraceInfo, 'kind' | 'message' | 'frames'>): string => {
  const app = topAppFrames(t.frames, 5)

  return [
    `${t.kind} stack trace${t.message === '' ? '' : `: ${t.message}`}`,
    app.length === 0 ? 'No application frames found (all frames are library or runtime code).' : 'Top application frames:',
    ...app.map(f => `  ${frameText(f)}`),
    `All frames (${t.frames.length}):`,
    ...t.frames.slice(0, 12).map(f => `  ${f.isApp ? '*' : ' '} ${f.file}:${f.line}`),
  ].join('\n')
}

export const tracePrompt = (t: TraceInfo): string => {
  const app = topAppFrames(t.frames, 5)

  return [
    'Explain this error and point at the most likely cause. Do not edit anything yet.',
    t.message === '' ? '' : `Error: ${t.message}`,
    app.length === 0 ? '' : 'Application frames, newest first:',
    ...app.map(f => `- ${f.file}:${f.line}${f.fn === '' ? '' : ` (${oneLine(f.fn, 50)})`}`),
    'Open those locations and tell me what state would make this fail.',
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------- 49 error clustering

export const normaliseError = (raw: string): string => {
  const lines = stripAnsi(raw)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l !== '' && !/^Exit code \d+$/.test(l) && !/^<\/?tool_use_error>$/.test(l))
  const pick =
    lines.slice(0, 30).find(l => /error|fail|cannot|can't|not found|denied|exception|fatal|invalid|unexpected|refused|timed? ?out|no such/i.test(l)) ??
    lines[0] ??
    ''

  return pick
    .replace(/<\/?tool_use_error>/g, '')
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?z?/g, '<time>')
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/(?:[a-z]:\\|\/)[^\s:'"`)\]]+/g, '<path>')
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '<str>')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export const addCluster = (list: readonly Cluster[], text: string, tool: string, at: number, cap = 40): Cluster[] => {
  const key = normaliseError(text)

  if (key === '') {
    return [...list]
  }
  const found = list.find(c => c.key === key)
  const next =
    found === undefined
      ? [...list, { key, count: 1, sample: oneLine(redact(stripAnsi(text).split(/\r?\n/).find(l => l.trim() !== '' && !/^Exit code/.test(l)) ?? key), 110), tools: [tool], lastAt: at }]
      : list.map(c => (c === found ? { ...c, count: c.count + 1, lastAt: at, tools: c.tools.includes(tool) ? c.tools : [...c.tools, tool].slice(0, 5) } : c))

  return next.length > cap ? [...next].sort((a, b) => b.lastAt - a.lastAt).slice(0, cap) : next
}

// ---------------------------------------------------------------- 50 hypotheses

export type HypCmd =
  | { kind: 'list' }
  | { kind: 'add'; text: string }
  | { kind: 'mark'; n: number; status: Hyp['status'] | 'rm' }
  | { kind: 'bad'; msg: string }

export const parseHypArgs = (args: string): HypCmd => {
  const t = args.trim()

  if (t === '') {
    return { kind: 'list' }
  }
  const m = /^(ok|no|open|rm)\b\s*(.*)$/i.exec(t)

  if (m !== null) {
    const word = (m[1] ?? '').toLowerCase() as 'ok' | 'no' | 'open' | 'rm'
    const rest = (m[2] ?? '').trim()

    if (/^\d{1,6}$/.test(rest) && Number(rest) >= 1) {
      return { kind: 'mark', n: Number(rest), status: word }
    }
    // "no it is not the cache" is a hypothesis; "ok" / "no 3x" alone is a mistake.
    if (rest === '' || /^\S+$/.test(rest)) {
      return { kind: 'bad', msg: `Usage: /dbhyp ${word} <number> (the number from /dbhyp).` }
    }
  }

  return { kind: 'add', text: oneLine(redact(t), 200) }
}

// ---------------------------------------------------------------- 42 bisect

const REF = /^[\w./~^@{}:-]{1,100}$/

export const isRef = (s: string): boolean => REF.test(s) && !s.startsWith('-')

export const parseBisectArgs = (args: string): { good: string; bad: string; msg: string } => {
  const parts = args.trim().split(/\s+/).filter(Boolean)

  if (parts.length > 2) {
    return { good: '', bad: '', msg: 'Usage: /dbbisect [good-ref] [bad-ref]' }
  }
  const [good = '', bad = 'HEAD'] = parts

  if ((good !== '' && !isRef(good)) || !isRef(bad)) {
    return { good: '', bad: '', msg: 'Refs may only contain letters, digits and . / ~ ^ @ _ - characters.' }
  }

  return { good, bad, msg: '' }
}

export const bisectGuide = (good: string, bad: string, testCmd: string): string =>
  [
    'git bisect guide (nothing is run for you; copy the commands you want):',
    '  1. git status               commit or stash local changes first',
    '  2. git bisect start',
    `  3. git bisect bad ${bad}`,
    `  4. git bisect good ${good === '' ? '<last-known-good-commit>' : good}`,
    `  5. at each step run: ${testCmd === '' ? '<your failing test or command>' : testCmd}`,
    '     then mark it:  git bisect good  |  git bisect bad  |  git bisect skip (cannot build/test)',
    '  6. optional automation: git bisect run <script>  (exit 0 = good, 1-124 = bad, 125 = skip)',
    '  7. it ends with "<sha> is the first bad commit": inspect it with  git show <sha>',
    '  8. always finish with: git bisect reset',
    'The prompt box now holds a request to walk through this with you.',
  ].join('\n')

export const bisectPrompt = (good: string, bad: string, testCmd: string): string =>
  [
    'Help me find the commit that introduced this bug using git bisect.',
    `Bad: ${bad}. Good: ${good === '' ? '(help me find a known-good commit, e.g. from tags or git log)' : good}.`,
    `Test to run at each step: ${testCmd === '' ? '(propose the smallest command that shows the failure)' : testCmd}`,
    'Go one step at a time and ask me before running any `git bisect` command. Never run `git bisect reset`, checkout other branches or discard changes without asking. At the end show `git show --stat` for the first bad commit.',
  ].join('\n')

// ---------------------------------------------------------------- prompt fillers 53, 55

export const shrinkPrompt = (target: string, cmd: string): string =>
  [
    'Shrink this failing case to a minimal reproduction.',
    target === '' ? '' : `Failing case: ${target}`,
    cmd === '' ? '' : `Command that fails: ${cmd}`,
    'Remove inputs, setup, files and dependencies one at a time, re-running after each removal, and keep the failure going. Stop when nothing more can be removed and show me the smallest version with the exact command that reproduces it. Do not change application code while shrinking.',
  ]
    .filter(Boolean)
    .join('\n')

export const assertPrompt = (target: string): string =>
  [
    `Suggest precise assertions for ${target === '' ? 'the failing test' : target}.`,
    'Read the code under test and the test, then list what the test should assert: exact return values, error type and message, side effects, and one edge case. Prefer specific matchers over truthiness. Show the assertions as a diff to the test; do not edit files yet.',
  ].join('\n')

export const regressionPrompt = (cmd: string): string =>
  [
    `That command now passes after earlier failures: ${oneLine(cmd, 100)}`,
    'Add a regression test that fails without the fix and passes with it. Keep it as small as possible, name it after the bug, and show me the test before writing it.',
  ].join('\n')

// ---------------------------------------------------------------- 56 mocks

export const isTestFile = (path: string): boolean =>
  /[._-](test|spec)\.[cm]?[jt]sx?$/.test(path) ||
  /(^|\/)__tests__\//.test(path) ||
  /(^|\/)test_[^/]+\.py$/.test(path) ||
  /_test\.(py|go)$/.test(path) ||
  /(^|\/)tests?\/.+\.(py|[cm]?[jt]sx?|rb)$/.test(path) ||
  /Tests?\.(java|kt)$/.test(path) ||
  /_spec\.rb$/.test(path)

export const scanMocks = (text: string): Omit<MockHit, 'file'>[] => {
  const hits: Omit<MockHit, 'file'>[] = []
  const seen = new Set<string>()
  const add = (kind: string, name: string, line: number) => {
    const key = `${kind}|${name}`

    if (name !== '' && !seen.has(key) && hits.length < 80) {
      seen.add(key)
      hits.push({ kind, name, line })
    }
  }

  text.split(/\r?\n/).forEach((src, i) => {
    const line = i + 1
    let m: RegExpExecArray | null

    if ((m = /\b(?:jest|vi)\.(?:doMock|mock)\(\s*(['"`])([^'"`]+)\1/.exec(src)) !== null) add('module', m[2] ?? '', line)
    if ((m = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:jest|vi)\.fn\b/.exec(src)) !== null) add('fn', m[1] ?? '', line)
    if ((m = /\b(?:jest|vi)\.spyOn\(\s*([\w.$]+)\s*,\s*(['"`])([\w$]+)\2/.exec(src)) !== null) add('spy', `${m[1]}.${m[3]}`, line)
    if ((m = /\bsinon\.(?:stub|spy)\(\s*([\w.$]+)\s*,\s*['"]([\w$]+)['"]/.exec(src)) !== null) add('sinon', `${m[1]}.${m[2]}`, line)
    if ((m = /\bpatch(?:\.object|\.dict)?\(\s*(?:([\w.]+)\s*,\s*)?(['"])([^'"]+)\2/.exec(src)) !== null) {
      add('patch', m[1] === undefined ? (m[3] ?? '') : `${m[1]}.${m[3]}`, line)
    }
    if ((m = /\b(\w+)\s*=\s*(?:Magic|Async|NonCallableMagic)?Mock\(/.exec(src)) !== null) add('mock', m[1] ?? '', line)
    if ((m = /\bmocker\.(?:spy|stub)\([^)]*\)/.exec(src)) !== null) add('mocker', oneLine(m[0], 60), line)
  })

  return hits
}

// ---------------------------------------------------------------- 58 port, 52 env

export const validPort = (text: string): number | null => {
  const t = text.trim()

  if (!/^\d{1,5}$/.test(t)) {
    return null
  }
  const n = Number(t)

  return n >= 1 && n <= 65535 ? n : null
}

export const portArgv = (port: number): string[] => ['lsof', '-nP', '-i', `:${port}`]

export const parseLsof = (stdout: string): string[] => {
  const rows = stdout
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l !== '' && !/^COMMAND\s/.test(l))
    .map(l => {
      const f = l.split(/\s+/)

      return `${f[0] ?? '?'}  pid ${f[1] ?? '?'}  ${f[2] ?? '?'}  ${f.slice(7).join(' ')}`
    })

  return [...new Set(rows)].slice(0, 12)
}

export const ENV_ALLOW = ['node', 'npm', 'pnpm', 'yarn', 'bun', 'deno', 'python3', 'python', 'git', 'tsc', 'cargo', 'rustc', 'ruby'] as const

export const isAllowedVersionArgv = (argv: readonly string[]): boolean =>
  argv.length === 2 && argv[1] === '--version' && (ENV_ALLOW as readonly string[]).includes(argv[0] ?? '')

export const envText = (rows: readonly { cmd: string; out: string; isOk: boolean }[]): string =>
  rows.length === 0 ? 'No environment recorded yet. Run /dbenv.' : rows.map(r => `${r.cmd.padEnd(8)} ${r.isOk ? r.out : '(not available)'}`).join('\n')

// ---------------------------------------------------------------- 48 tail

const SENSITIVE_PATH =
  /(^|\/)(\.ssh|\.gnupg|\.aws|\.kube|\.docker)(\/|$)|(^|\/)\.env(\..*)?$|(^|\/)\.(npmrc|netrc|pypirc|git-credentials)$|\.(pem|key|p12|pfx|keystore)$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)|(^|\/)credentials(\.json)?$|\/etc\/(shadow|sudoers)/i

export const isSensitivePath = (path: string): boolean => SENSITIVE_PATH.test(path)

export const checkTailPath = (raw: string): { path: string; error: string } => {
  const path = raw.trim().replace(/^['"]|['"]$/g, '')

  if (path === '') return { path: '', error: 'Usage: /dbtail <path> (relative to the project or absolute); /dbtail off stops it.' }
  if (/[\0\r\n]/.test(path)) return { path: '', error: 'That path has control characters.' }
  if (path.length > 400) return { path: '', error: 'That path is too long.' }
  if (isSensitivePath(path)) return { path: '', error: 'Refusing to show keys, credentials and .env files.' }

  return { path, error: '' }
}

export const tailLines = (text: string, isCut: boolean, max = 200): string[] => {
  const lines = stripAnsi(text).split(/\r?\n/)

  if (isCut) {
    lines.shift()
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines.slice(-max).map(l => oneLine(redact(l), 400))
}

// ---------------------------------------------------------------- 54, 59 guards

export const GATE_MS = 3 * 60 * 1000
export const LOOP_MS = 2 * 60 * 1000
export const RECOVER_MS = 30 * 60 * 1000

export const isGateOpen = (last: number, now: number): boolean => last <= 0 || now - last >= GATE_MS

// A success right after a failure of the same command (the most recent record for it was a failure).
export const isRecovery = (hist: readonly CmdRec[], sig: string, now: number): boolean => {
  for (let i = hist.length - 1; i >= 0; i--) {
    const r = hist[i]

    if (r !== undefined && r.sig === sig) {
      return !r.isOk && now - r.at <= RECOVER_MS
    }
  }

  return false
}

export const failCount = (hist: readonly CmdRec[], sig: string, now: number): number =>
  hist.filter(r => r.sig === sig && !r.isOk && now - r.at <= LOOP_MS).length

export const isLoop = (hist: readonly CmdRec[], sig: string, now: number): boolean => failCount(hist, sig, now) >= 3

export const pushCmd = (hist: readonly CmdRec[], rec: CmdRec, cap = 60): CmdRec[] => [...hist, rec].slice(-cap)

// ---------------------------------------------------------------- 51 breadcrumbs, 60 postmortem

export const glyphOf = (o: Crumb['outcome']): string => (o === 'ok' ? '✓' : o === 'fail' ? '✗' : o === 'denied' ? '–' : '…')

export const crumbLine = (c: Crumb): string => `${String(c.n).padStart(3)} ${glyphOf(c.outcome)} ${c.tool}${c.detail === '' ? '' : `  ${c.detail}`}`

export type PostInput = {
  crumbs: readonly Crumb[]
  hyps: readonly Hyp[]
  clusters: readonly Cluster[]
  trace: TraceInfo | null
  runs: readonly TestRun[]
}

export const buildPostmortem = (d: PostInput): string => {
  const failures = d.crumbs.filter(c => c.outcome === 'fail').length
  const lastRun = d.runs[d.runs.length - 1]
  const confirmed = d.hyps.filter(h => h.status === 'ok')
  const out: string[] = ['# Debugging postmortem (draft)', '', '## Summary']

  out.push(`- ${d.crumbs.length} steps tried, ${failures} failed.`)
  if (lastRun !== undefined) {
    out.push(`- Last test run (\`${oneLine(lastRun.cmd, 60)}\`): ${lastRun.isGreen ? 'passing' : `${lastRun.nFailed || lastRun.failed.length} failing`}.`)
  }
  out.push(`- Cause: ${confirmed.length > 0 ? confirmed.map(h => h.text).join('; ') : '_not confirmed yet; fill in_'}`, '', '## Errors seen')
  const top = [...d.clusters].sort((a, b) => b.count - a.count).slice(0, 5)

  if (top.length === 0) out.push('- none recorded')
  for (const c of top) out.push(`- x${c.count} ${c.sample}`)
  if (d.trace !== null) {
    out.push('', '## Stack trace', `- ${d.trace.message === '' ? d.trace.kind : d.trace.message}`)
    for (const f of topAppFrames(d.trace.frames, 3)) out.push(`  - ${f.file}:${f.line}`)
  }
  out.push('', '## Hypotheses')
  if (d.hyps.length === 0) out.push('- none recorded')
  for (const h of d.hyps) out.push(`- [${h.status === 'ok' ? 'x' : h.status === 'no' ? '-' : ' '}] ${h.text}${h.status === 'no' ? ' (ruled out)' : ''}`)
  out.push('', '## Timeline (last 12 steps)')
  for (const c of d.crumbs.slice(-12)) out.push(`- ${glyphOf(c.outcome)} ${c.tool}${c.detail === '' ? '' : ` ${c.detail}`}`)
  out.push('', '## Fix', '- _describe the change_', '', '## Follow-ups', '- _regression test, monitoring, docs_')

  return out.join('\n')
}

export const reproText = (steps: readonly { cmd: string; outcome: string }[]): string =>
  steps.length === 0 ? 'No commands recorded.' : steps.map((s, i) => `${i + 1}. ${s.cmd}${s.outcome === 'fail' ? '   # failed' : ''}`).join('\n')
