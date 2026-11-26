// Pure logic for the "what happened in this session" half of add-kit: test, coverage, build and error parsing,
// flaky tracking, command history, snippets, distraction log, project counters. No engine, disk or network here.
import { bar, dayKey, fmtMs, lastDays, maskSecrets, note, plural, spark, trunc } from './parse'
import type { Line } from './parse'

// ------------------------------------------------------------------ tests (272)

export type TestSummary = { fw: string; pass: number; fail: number; skip: number; failed: string[]; passed: string[] }

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')

const MAX_NAMES = 40
const cap = (names: Iterable<string>): string[] => [...new Set([...names].map(n => trunc(maskSecrets(n.trim()), 90)).filter(Boolean))].slice(0, MAX_NAMES)

const countsIn = (line: string): Record<string, number> => {
  const out: Record<string, number> = {}

  for (const m of line.matchAll(/(\d+)\s+(failed|passed|skipped|todo|total|errors?|xfailed|xpassed|deselected)/gi)) {
    const k = (m[2] as string).toLowerCase().replace(/^errors$/, 'error')

    out[k] = (out[k] ?? 0) + Number(m[1])
  }

  return out
}

const jest = (text: string): TestSummary | undefined => {
  const line = text.split('\n').find(l => /^\s*Tests:\s+\d/.test(l))

  if (!line) return undefined
  const c = countsIn(line)
  const failed = [...text.matchAll(/^\s*●\s+(.+?)\s*$/gm)].map(m => m[1] as string).filter(n => !/^(Console|Test suite failed to run|Validation Warning)/i.test(n))
  const passed = [...text.matchAll(/^\s*[✓√]\s+(.+?)(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?\s*$/gm)].map(m => m[1] as string)

  return { fw: 'jest', pass: c.passed ?? 0, fail: c.failed ?? 0, skip: (c.skipped ?? 0) + (c.todo ?? 0), failed: cap(failed), passed: cap(passed) }
}

const vitest = (text: string): TestSummary | undefined => {
  const line = text.split('\n').find(l => /^\s*Tests\s+(?:\d+\s+(?:failed|passed|skipped|todo)\b[\s|]*)+\(\d+\)/.test(l))

  if (!line) return undefined
  const c = countsIn(line)
  const failed = [...text.matchAll(/^\s*(?:FAIL|×|✗|✖)\s+(\S.*? > .+?)(?:\s+\d+ms)?\s*$/gm)].map(m => m[1] as string)
  const passed = [...text.matchAll(/^\s*[✓√]\s+(\S.*? > .+?)(?:\s+\d+ms)?\s*$/gm)].map(m => m[1] as string)

  return { fw: 'vitest', pass: c.passed ?? 0, fail: c.failed ?? 0, skip: (c.skipped ?? 0) + (c.todo ?? 0), failed: cap(failed), passed: cap(passed) }
}

const pytest = (text: string): TestSummary | undefined => {
  const line = text
    .split('\n')
    .reverse()
    .find(l => /^\s*(?:=+\s*)?(?:\d+\s+(?:failed|passed|skipped|errors?|xfailed|xpassed|deselected|warnings?|rerun)(?:,\s*)?)+\s+in\s+[\d.]+s/.test(l))

  if (!line) return undefined
  const c = countsIn(line)
  const failed = [...text.matchAll(/^(?:FAILED|ERROR)\s+(\S+)/gm)].map(m => m[1] as string)
  const passed = [...text.matchAll(/^(\S+::\S+)\s+PASSED\b/gm)].map(m => m[1] as string)

  return { fw: 'pytest', pass: (c.passed ?? 0) + (c.xpassed ?? 0), fail: (c.failed ?? 0) + (c.error ?? 0), skip: (c.skipped ?? 0) + (c.xfailed ?? 0), failed: cap(failed), passed: cap(passed) }
}

const cargo = (text: string): TestSummary | undefined => {
  const results = [...text.matchAll(/^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)]

  if (results.length === 0) return undefined
  let pass = 0
  let fail = 0
  let skip = 0

  for (const m of results) {
    pass += Number(m[1])
    fail += Number(m[2])
    skip += Number(m[3])
  }
  const failed = [...text.matchAll(/^test (\S+) \.\.\. FAILED/gm)].map(m => m[1] as string)
  const passed = [...text.matchAll(/^test (\S+) \.\.\. ok/gm)].map(m => m[1] as string)

  return { fw: 'cargo', pass, fail, skip, failed: cap(failed), passed: cap(passed) }
}

const gotest = (text: string): TestSummary | undefined => {
  const verbose = [...text.matchAll(/^\s*--- (PASS|FAIL|SKIP): (\S+)/gm)]
  const pkgs = [...text.matchAll(/^(ok|FAIL)\s+\S+\s+(?:[\d.]+s|\(cached\))/gm)]

  if (verbose.length === 0 && pkgs.length === 0) return undefined
  const failed = verbose.filter(m => m[1] === 'FAIL').map(m => m[2] as string)
  const passed = verbose.filter(m => m[1] === 'PASS').map(m => m[2] as string)

  if (verbose.length > 0) {
    return { fw: 'go', pass: passed.length, fail: failed.length, skip: verbose.filter(m => m[1] === 'SKIP').length, failed: cap(failed), passed: cap(passed) }
  }

  return { fw: 'go', pass: pkgs.filter(m => m[1] === 'ok').length, fail: pkgs.filter(m => m[1] === 'FAIL').length, skip: 0, failed: [], passed: [] }
}

/** Reads a test runner's summary out of Bash output; undefined when no known summary is in it. */
export const parseTests = (raw: string): TestSummary | undefined => {
  const text = stripAnsi(raw.length > 400_000 ? raw.slice(-400_000) : raw)
  const found = jest(text) ?? vitest(text) ?? pytest(text) ?? cargo(text) ?? gotest(text)

  return found && found.pass + found.fail + found.skip > 0 ? found : undefined
}

/** A coverage percentage from the usual reporters; undefined when none is printed. */
export const parseCoverage = (raw: string): number | undefined => {
  const text = stripAnsi(raw)
  const pats: RegExp[] = [
    /^\s*All files\s*\|\s*(\d+(?:\.\d+)?)/m,
    /^\s*Statements\s*:\s*(\d+(?:\.\d+)?)%/m,
    /^\s*TOTAL\s+\d+\s+\d+(?:\s+\d+\s+\d+)?\s+(\d+(?:\.\d+)?)%/m,
    /coverage:\s*(\d+(?:\.\d+)?)% of statements/,
    /(\d+(?:\.\d+)?)% coverage,/,
    /^\s*Lines\s*:\s*(\d+(?:\.\d+)?)%/m,
  ]

  for (const re of pats) {
    const m = re.exec(text)

    if (m) {
      const v = Number(m[1])

      if (Number.isFinite(v) && v >= 0 && v <= 100) return Math.round(v * 10) / 10
    }
  }

  return undefined
}

export type TestRun = { t: number; fw: string; key: string; pass: number; fail: number; skip: number; failed: string[]; ms: number }
export type CovPoint = { t: number; pct: number; key: string }

export const MAX_RUNS = 120
export const MAX_COV = 120

export const addRun = (runs: readonly TestRun[], r: TestRun): TestRun[] => [...runs, r].slice(-MAX_RUNS)
export const addCov = (cov: readonly CovPoint[], c: CovPoint): CovPoint[] => [...cov, c].slice(-MAX_COV)

/** A stable key for "the same test command": the command with flags and file arguments dropped. */
export const cmdKey = (command: string): string => {
  const words = command.replace(/\bcd\s+\S+\s*&&\s*/g, '').trim().split(/\s+/).filter(w => !/^[A-Z_][A-Z0-9_]*=/.test(w))

  return words.filter(w => !w.startsWith('-') && !/[./]/.test(w) || /^(run|test)$/.test(w)).slice(0, 3).join(' ').slice(0, 40) || 'tests'
}

export type RunStats = { total: number; passRate: number; lastPass: number; lastFail: number; trend: 'up' | 'down' | 'flat' | 'none'; failStreak: number }

export const runStats = (runs: readonly TestRun[]): RunStats => {
  if (runs.length === 0) return { total: 0, passRate: 0, lastPass: 0, lastFail: 0, trend: 'none', failStreak: 0 }
  const rate = (r: TestRun) => (r.pass + r.fail > 0 ? r.pass / (r.pass + r.fail) : 1)
  const last = runs[runs.length - 1] as TestRun
  const prev = runs[runs.length - 2]
  let streak = 0

  for (let i = runs.length - 1; i >= 0 && (runs[i] as TestRun).fail > 0; i--) streak++
  const avg = runs.reduce((a, r) => a + rate(r), 0) / runs.length
  const d = prev === undefined ? 0 : rate(last) - rate(prev)

  return { total: runs.length, passRate: Math.round(avg * 100), lastPass: last.pass, lastFail: last.fail, trend: prev === undefined ? 'none' : d > 0.001 ? 'up' : d < -0.001 ? 'down' : 'flat', failStreak: streak }
}

export const testLines = (runs: readonly TestRun[], cov: readonly CovPoint[], nowMs: number): Line[] => {
  if (runs.length === 0) return [note('No test runs seen yet. Switch add-kit.tests on (/cfg feature add-kit.tests on), then run tests through Claude: jest, vitest, pytest, go and cargo summaries are read from the Bash output.', 'inactive')]
  const s = runStats(runs)
  const last = runs[runs.length - 1] as TestRun
  const out: Line[] = [
    note(`${plural(s.total, 'test run')}, ${s.passRate}% of tests passed on average, trend ${s.trend === 'up' ? 'improving' : s.trend === 'down' ? 'worsening' : s.trend}`, 'suggestion'),
    note(`Last: ${last.fw} ${last.pass} passed, ${last.fail} failed, ${last.skip} skipped (${Math.round((nowMs - last.t) / 60_000)} min ago)`, last.fail > 0 ? 'error' : 'success'),
    note(`  pass ${spark(runs.map(r => r.pass))}`),
    note(`  fail ${spark(runs.map(r => r.fail))}`, last.fail > 0 ? 'error' : undefined),
  ]

  if (s.failStreak > 1) out.push(note(`  ${plural(s.failStreak, 'run')} in a row with failures`, 'warning'))

  for (const f of last.failed.slice(0, 5)) out.push(note(`  failing: ${f}`, 'error'))

  if (cov.length > 0) {
    const c = cov[cov.length - 1] as CovPoint
    const p = cov[cov.length - 2]

    out.push(note(`Coverage ${c.pct}%${p ? ` (${c.pct - p.pct >= 0 ? '+' : ''}${(Math.round((c.pct - p.pct) * 10) / 10).toFixed(1)} since the run before)` : ''}  ${spark(cov.map(x => x.pct))}`, c.pct >= 80 ? 'success' : c.pct >= 60 ? undefined : 'warning'))
  }

  return out
}

export const covLines = (cov: readonly CovPoint[]): Line[] => {
  if (cov.length === 0) return [note('No coverage numbers seen yet. Run tests with a coverage reporter through Claude (jest, vitest, pytest-cov, go -cover, tarpaulin) with add-kit.tests on.', 'inactive')]
  const c = cov[cov.length - 1] as CovPoint
  const lo = Math.min(...cov.map(x => x.pct))
  const hi = Math.max(...cov.map(x => x.pct))

  return [
    note(`Coverage now ${c.pct}% (${plural(cov.length, 'reading')}, low ${lo}%, high ${hi}%)`, c.pct >= 80 ? 'success' : 'suggestion'),
    note(`  ${spark(cov.map(x => x.pct), 40)}`),
    ...cov.slice(-8).map(x => note(`  ${bar(x.pct, 100, 20)} ${String(x.pct).padStart(5)}%  ${x.key}`)),
  ]
}

// ------------------------------------------------------------------ flaky tests (273)

export type Flaky = { name: string; fw: string; fails: number; passes: number; flips: number; last: number; state: 'pass' | 'fail' }
export const MAX_FLAKY = 80

/**
 * Folds one run into the per-test record. A name seen failing is `fail`; a name seen passing (verbose output)
 * is `pass`; a run with no failures at all, of the same command, passes every name that was failing before.
 */
export const updateFlaky = (map: Readonly<Record<string, Flaky>>, run: TestRun, passed: readonly string[]): Record<string, Flaky> => {
  const next: Record<string, Flaky> = { ...map }
  const mark = (name: string, state: 'pass' | 'fail') => {
    const id = `${run.fw}|${name}`
    const cur = next[id]

    if (cur === undefined) {
      if (state === 'pass') return
      next[id] = { name, fw: run.fw, fails: 1, passes: 0, flips: 0, last: run.t, state }

      return
    }
    next[id] = { ...cur, last: run.t, state, fails: cur.fails + (state === 'fail' ? 1 : 0), passes: cur.passes + (state === 'pass' ? 1 : 0), flips: cur.flips + (cur.state !== state ? 1 : 0) }
  }

  for (const n of run.failed) mark(n, 'fail')

  for (const n of passed) mark(n, 'pass')

  if (run.fail === 0 && run.pass > 0) {
    for (const f of Object.values(map)) if (f.fw === run.fw && f.state === 'fail') mark(f.name, 'pass')
  }
  const ids = Object.keys(next)

  if (ids.length > MAX_FLAKY) {
    const keep = ids.sort((a, b) => (next[b] as Flaky).last - (next[a] as Flaky).last).slice(0, MAX_FLAKY)
    const trimmed: Record<string, Flaky> = {}

    for (const k of keep) trimmed[k] = next[k] as Flaky

    return trimmed
  }

  return next
}

export const flakyLines = (map: Readonly<Record<string, Flaky>>): Line[] => {
  const rows = Object.values(map)
    .filter(f => f.flips > 0)
    .sort((a, b) => b.flips - a.flips || b.last - a.last)

  if (rows.length === 0) {
    const open = Object.values(map).filter(f => f.state === 'fail').length

    return [note(Object.keys(map).length === 0 ? 'No failing tests seen, so nothing can be flaky yet (needs add-kit.tests on).' : `No test has gone from failing to passing yet. ${plural(open, 'test')} failing now.`, 'inactive')]
  }
  const out: Line[] = [note(`${plural(rows.length, 'test')} that failed and later passed (or the reverse). More flips means more likely flaky; one flip may just be a fix.`, 'suggestion')]

  for (const f of rows.slice(0, 12)) out.push(note(`  ${f.flips >= 2 ? 'FLAKY ' : 'fixed?'} ${trunc(f.name, 56)}  fails ${f.fails}, passes ${f.passes}, flips ${f.flips}, now ${f.state}`, f.flips >= 2 ? 'warning' : undefined))

  return out
}

// ------------------------------------------------------------------ build times (275)

export type BuildRec = { t: number; key: string; ms: number; ok: boolean }
export const MAX_BUILDS = 300

const BUILD_WORDS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'cargo', 'go', 'make', 'cmake', 'mvn', 'gradle', 'gradlew', 'tsc', 'vite', 'webpack', 'esbuild', 'rollup', 'pytest', 'jest', 'vitest', 'swift', 'xcodebuild', 'dotnet', 'rake', 'bundle', 'tox', 'ruff', 'eslint', 'mypy', 'next', 'turbo', 'nx', 'bazel', 'ninja', 'python', 'python3', 'pip', 'pip3', 'docker'])
const SUB_WORDS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'cargo', 'go', 'make', 'dotnet', 'swift', 'gradle', 'gradlew', 'mvn', 'docker', 'bundle', 'pip', 'pip3'])
const BUILDISH_SUB = /^(run|build|test|install|ci|check|clippy|lint|typecheck|compile|package|verify|bench|vet|generate|tidy|all|clean|assemble|exec|i|add)$/

/** `npm run build`, `cargo test`, `pytest`: the first word of the build or test command, plus its verb for package managers. Undefined for other commands. */
export const buildKey = (command: string): string | undefined => {
  for (const seg of command.split(/&&|;|\|\||\||\n/)) {
    const words = seg.trim().split(/\s+/).filter(w => w !== '' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) && w !== 'sudo' && w !== 'time' && w !== 'nice')
    const first = (words[0] ?? '').replace(/^.*\//, '')

    if (!BUILD_WORDS.has(first)) continue

    if ((first === 'python' || first === 'python3') && !(words[1] === '-m' && /^(pytest|unittest|build|pip)$/.test(words[2] ?? ''))) continue

    if (first === 'docker' && words[1] !== 'build') continue

    if (SUB_WORDS.has(first)) {
      const sub = words.slice(1).find(w => !w.startsWith('-')) ?? ''

      if (sub === '') {
        if (first === 'make' || first === 'gradle' || first === 'gradlew' || first === 'mvn') return first
        continue
      }

      if (BUILDISH_SUB.test(sub)) {
        const third = sub === 'run' ? (words.slice(1).filter(w => !w.startsWith('-'))[1] ?? '') : ''

        return `${first} ${sub}${third !== '' ? ` ${third.slice(0, 20)}` : ''}`
      }

      if (first === 'make' || first === 'gradle' || first === 'gradlew' || first === 'mvn') return first

      continue
    }

    return first === 'python' || first === 'python3' ? `${first} -m ${words[2]}` : first
  }

  return undefined
}

export const addBuild = (list: readonly BuildRec[], b: BuildRec): BuildRec[] => [...list, b].slice(-MAX_BUILDS)

export type BuildStat = { key: string; n: number; avg: number; last: number; max: number; okPct: number; series: number[] }

export const buildStats = (list: readonly BuildRec[]): BuildStat[] => {
  const by = new Map<string, BuildRec[]>()

  for (const b of list) by.set(b.key, [...(by.get(b.key) ?? []), b])

  return [...by.entries()]
    .map(([key, recs]) => ({
      key,
      n: recs.length,
      avg: recs.reduce((a, r) => a + r.ms, 0) / recs.length,
      last: (recs[recs.length - 1] as BuildRec).ms,
      max: Math.max(...recs.map(r => r.ms)),
      okPct: Math.round((recs.filter(r => r.ok).length / recs.length) * 100),
      series: recs.map(r => r.ms),
    }))
    .sort((a, b) => b.avg * b.n - a.avg * a.n)
}

export const buildLines = (list: readonly BuildRec[]): Line[] => {
  if (list.length === 0) return [note('No build or test commands timed yet. Switch add-kit.builds on (/cfg feature add-kit.builds on); each Bash call that looks like a build or test is timed.', 'inactive')]
  const stats = buildStats(list)
  const out: Line[] = [note(`${plural(list.length, 'timed command')} in ${plural(stats.length, 'group')}, by total time spent`, 'suggestion')]

  for (const s of stats.slice(0, 10)) {
    const slower = s.series.length >= 3 && s.last > s.avg * 1.5
    out.push(note(`  ${trunc(s.key, 24).padEnd(24)} x${String(s.n).padEnd(3)} avg ${fmtMs(s.avg).padEnd(8)} last ${fmtMs(s.last).padEnd(8)} ${s.okPct}% ok  ${spark(s.series, 16)}${slower ? '  slower than usual' : ''}`, slower ? 'warning' : undefined))
  }

  return out
}

// ------------------------------------------------------------------ error clustering (276)

export type ErrCluster = { key: string; sample: string; count: number; first: number; last: number }
export const MAX_CLUSTERS = 100

const ERRORISH = /\b(errors?|exceptions?|failed|failures?|fatal|denied|not found|cannot|can't|unable|invalid|unexpected|refused|timeout|timed out|ENOENT|EACCES|EADDRINUSE|ECONNREFUSED|traceback|panic)\b|\bTS\d{4}\b|\bE\d{4}\b/i

/** Makes two occurrences of "the same" error compare equal: paths, numbers, ids and quoted words become placeholders. */
export const normalizeError = (line: string): string =>
  maskSecrets(line)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?/g, '<time>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@+~-]+){2,}(?::\d+(?::\d+)?)?/g, '<path>')
    .replace(/(?:[\w.@+~-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|rb|c|cc|cpp|h|swift|kt|json|yml|yaml)(?::\d+(?::\d+)?)?\b/g, '<file>')
    .replace(/"[^"]{1,80}"|'[^']{1,80}'|`[^`]{1,80}`/g, '<str>')
    .replace(/\b\d+(?:\.\d+)*\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)

/** Up to three error-looking lines of a failing result (or its first line). */
export const errorLines = (text: string): string[] => {
  const lines = stripAnsi(text).split('\n').map(l => l.trim()).filter(l => l !== '' && l.length < 400)
  const hits = lines.filter(l => ERRORISH.test(l))

  return (hits.length > 0 ? hits : lines.slice(0, 1)).slice(0, 3)
}

export const addErrors = (clusters: readonly ErrCluster[], lines: readonly string[], t: number): ErrCluster[] => {
  const map = new Map(clusters.map(c => [c.key, c]))

  for (const raw of lines) {
    const key = normalizeError(raw)

    if (key.length < 4) continue
    const cur = map.get(key)
    map.set(key, cur ? { ...cur, count: cur.count + 1, last: t } : { key, sample: trunc(maskSecrets(raw), 140), count: 1, first: t, last: t })
  }

  return [...map.values()].sort((a, b) => b.last - a.last).slice(0, MAX_CLUSTERS)
}

export const errorClusterLines = (clusters: readonly ErrCluster[]): Line[] => {
  if (clusters.length === 0) return [note('No errors recorded. Switch add-kit.errors on (/cfg feature add-kit.errors on); failing tool results are grouped by their normalised message.', 'inactive')]
  const top = [...clusters].sort((a, b) => b.count - a.count || b.last - a.last)
  const total = clusters.reduce((a, c) => a + c.count, 0)
  const out: Line[] = [note(`${plural(total, 'error')} in ${plural(clusters.length, 'cluster')} (paths, numbers and quoted words are folded together)`, 'suggestion')]

  for (const c of top.slice(0, 12)) out.push(note(`  x${String(c.count).padEnd(3)} ${trunc(c.sample, 100)}`, c.count >= 3 ? 'warning' : undefined))

  return out
}

// ------------------------------------------------------------------ command history (265)

export type Cmd = { t: number; cmd: string }
export const MAX_HIST = 500

/** Adds a Bash command: secrets masked, trimmed, consecutive repeats dropped, newest 500 kept. */
export const addCmd = (list: readonly Cmd[], command: string, t: number): Cmd[] => {
  const cmd = trunc(maskSecrets(command.replace(/\s+/g, ' ').trim()), 300)

  if (cmd === '' || list[list.length - 1]?.cmd === cmd) return list as Cmd[]

  return [...list, { t, cmd }].slice(-MAX_HIST)
}

export const searchCmds = (list: readonly Cmd[], q: string, max = 20): Cmd[] => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)

  return [...list].reverse().filter(c => words.every(w => c.cmd.toLowerCase().includes(w))).slice(0, max)
}

export const HIST_PAGE = 20

export const histLines = (list: readonly Cmd[], q: string, nowMs: number, page = 0): Line[] => {
  if (list.length === 0) return [note('No commands recorded. Switch add-kit.history on (/cfg feature add-kit.history on); Bash commands are kept with secrets masked, newest 500.', 'inactive')]
  const hits = searchCmds(list, q, MAX_HIST)
  const pages = Math.max(1, Math.ceil(hits.length / HIST_PAGE))
  const at = Math.min(Math.max(0, page), pages - 1)
  const out: Line[] = [note(`${q.trim() === '' ? `${plural(list.length, 'command')}, newest first` : `${plural(hits.length, 'match')} for "${trunc(q.trim(), 30)}" in ${plural(list.length, 'command')}`}${pages > 1 ? `  (page ${at + 1} of ${pages})` : ''}`, 'suggestion')]

  for (const c of hits.slice(at * HIST_PAGE, (at + 1) * HIST_PAGE)) out.push(note(`  ${dayKey(c.t) === dayKey(nowMs) ? 'today' : dayKey(c.t).slice(5)}  ${trunc(c.cmd, 110)}`))

  if (hits.length === 0) out.push(note('  nothing matches', 'inactive'))

  return out
}

// ------------------------------------------------------------------ distraction log (261)

export type Distraction = { t: number; what: string }
export const MAX_DISTRACT = 300

export const addDistraction = (list: readonly Distraction[], what: string, t: number): Distraction[] =>
  [...list, { t, what: trunc(maskSecrets(what.replace(/\s+/g, ' ').trim()), 120) }].slice(-MAX_DISTRACT)

export const distractLines = (list: readonly Distraction[], nowMs: number): Line[] => {
  if (list.length === 0) return [note('No task switches marked. Type /addistract <what pulled you away> whenever you switch task.', 'inactive')]
  const days = lastDays(nowMs, 7)
  const by: Record<string, number> = {}

  for (const d of list) by[dayKey(d.t)] = (by[dayKey(d.t)] ?? 0) + 1
  const max = Math.max(1, ...days.map(d => by[d] ?? 0))
  const out: Line[] = [note(`${plural(list.length, 'task switch')} marked, ${by[dayKey(nowMs)] ?? 0} today`, 'suggestion')]

  for (const d of days) out.push(note(`  ${d.slice(5)} ${bar(by[d] ?? 0, max, 16)} ${by[d] ?? 0}`))

  for (const d of list.slice(-5).reverse()) out.push(note(`  ${dayKey(d.t).slice(5)}  ${d.what}`, 'inactive'))

  return out
}

// ------------------------------------------------------------------ snippets (264)

export type Snippet = { lang: string; name: string; code: string }
export const MAX_SNIPPETS = 60
export const MAX_CODE = 4000

export const LANG_RE = /^[A-Za-z0-9+#._-]{1,20}$/
export const NAME_RE = /^[A-Za-z0-9 _.+#-]{1,40}$/

export type SnipResult = { ok: true; list: Snippet[]; replaced: boolean } | { ok: false; reason: string }

export const addSnippet = (list: readonly Snippet[], lang: string, name: string, code: string): SnipResult => {
  const l = lang.trim()
  const n = name.trim()
  const c = code.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\s+$/, '')

  if (!LANG_RE.test(l)) return { ok: false, reason: 'The language must be 1-20 letters, digits or + # . _ - (for example ts, python, sh).' }

  if (!NAME_RE.test(n)) return { ok: false, reason: 'The name must be 1-40 letters, digits, spaces or _ . + # -.' }

  if (c.trim() === '') return { ok: false, reason: 'The code is empty.' }

  if (c.length > MAX_CODE) return { ok: false, reason: `The code is ${c.length} characters; the limit is ${MAX_CODE}.` }

  if (maskSecrets(c) !== c) return { ok: false, reason: 'The code looks like it holds a secret (a key, token or password), so it was not saved.' }
  const at = list.findIndex(s => s.name.toLowerCase() === n.toLowerCase())

  if (at < 0 && list.length >= MAX_SNIPPETS) return { ok: false, reason: `Snippet limit reached (${MAX_SNIPPETS}). Delete one first.` }
  const snip = { lang: l, name: n, code: c }

  return { ok: true, replaced: at >= 0, list: at >= 0 ? list.map((s, i) => (i === at ? snip : s)) : [...list, snip] }
}

export const findSnippet = (list: readonly Snippet[], q: string): Snippet | undefined => {
  const key = q.trim().toLowerCase()

  if (/^\d+$/.test(key)) return list[Number(key) - 1]

  return list.find(s => s.name.toLowerCase() === key) ?? list.find(s => s.name.toLowerCase().startsWith(key) && key !== '')
}

/** A fenced block whose fence is longer than any run of backticks inside the code. */
export const fenced = (s: Snippet): string => {
  const longest = Math.max(0, ...[...s.code.matchAll(/`+/g)].map(m => m[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))

  return `${fence}${s.lang}\n${s.code}\n${fence}`
}

export const snippetLines = (list: readonly Snippet[]): Line[] =>
  list.length === 0
    ? [note('No snippets yet. /adsnip add <lang> <name> <code> (use \\n for new lines), or use the form in the pane.', 'inactive')]
    : list.map((s, i) => note(`${String(i + 1).padStart(2)}. ${s.name.padEnd(24)} ${s.lang.padEnd(8)} ${trunc(s.code.split('\n')[0] ?? '', 50)}${s.code.includes('\n') ? '  …' : ''}`))

// ------------------------------------------------------------------ project counters (266)

export type Proj = { cwd: string; first: number; last: number; tools: number; bash: number; edits: number; reads: number; days: Record<string, number>; exts: Record<string, number> }
export const MAX_PROJECTS = 30

export const emptyProj = (cwd: string, t: number): Proj => ({ cwd, first: t, last: t, tools: 0, bash: 0, edits: 0, reads: 0, days: {}, exts: {} })

export const recordTool = (projs: Readonly<Record<string, Proj>>, cwd: string, tool: string, ext: string, t: number): Record<string, Proj> => {
  const cur = projs[cwd] ?? emptyProj(cwd, t)
  const day = dayKey(t)
  const days = { ...cur.days, [day]: (cur.days[day] ?? 0) + 1 }

  for (const k of Object.keys(days).sort().slice(0, -30)) delete days[k]
  const exts = { ...cur.exts }

  if (ext !== '' && (Object.hasOwn(exts, ext) || Object.keys(exts).length < 40)) exts[ext] = (exts[ext] ?? 0) + 1
  const next: Proj = {
    ...cur,
    last: t,
    tools: cur.tools + 1,
    bash: cur.bash + (tool === 'Bash' ? 1 : 0),
    edits: cur.edits + (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' ? 1 : 0),
    reads: cur.reads + (tool === 'Read' || tool === 'Grep' || tool === 'Glob' ? 1 : 0),
    days,
    exts,
  }
  const all = { ...projs, [cwd]: next }
  const keys = Object.keys(all)

  if (keys.length > MAX_PROJECTS) {
    for (const k of keys.sort((a, b) => (all[a] as Proj).last - (all[b] as Proj).last).slice(0, keys.length - MAX_PROJECTS)) delete all[k]
  }

  return all
}
