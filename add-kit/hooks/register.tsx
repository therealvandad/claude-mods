import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register } from 'claude-code'

import type { Data, ViewState } from '../types'
import { cleanDistract, cleanHist, cleanMeet, cleanProjs, cleanRuns, cleanSessionPaths, cleanSnips } from './clean'
import { Refused, SAFE_ENV, safeArgv } from './guard'
import {
  diskLines,
  dayKey,
  extOf,
  firstLine,
  fmtAge,
  fmtMs,
  guessLanguages,
  guessLicense,
  hygiene,
  hygieneLines,
  isLicenseFile,
  isSecretLikeName,
  isSecretLikePath,
  licenseFromPackageJson,
  licenseFromToml,
  LOG_BYTES,
  logLines,
  note,
  outdatedLines,
  parseBranchRows,
  parseDf,
  parseDu,
  parseLsof,
  parseNpmOutdated,
  parsePipOutdated,
  parsePs,
  plural,
  portLines,
  procLines,
  repoLines,
  restorePlan,
  scanTodos,
  scoreRepo,
  cleanOverrides,
  spark,
  tailLines,
  todoLines,
  toText,
  trunc,
} from './parse'
import type { Line, Outdated, Todo } from './parse'
import {
  addBuild,
  addCmd,
  addCov,
  addDistraction,
  addErrors,
  addRun,
  addSnippet,
  buildKey,
  buildLines,
  cmdKey,
  covLines,
  distractLines,
  errorClusterLines,
  errorLines,
  fenced,
  findSnippet,
  flakyLines,
  histLines,
  HIST_PAGE,
  parseCoverage,
  parseTests,
  recordTool,
  searchCmds,
  snippetLines,
  testLines,
  updateFlaky,
} from './runs'
import { testsAlt, testsSvg } from './svg'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'add-kit-main'
const TABS = ['project', 'repo', 'tests', 'builds', 'errors', 'todo', 'history', 'snippets', 'health', 'system', 'logs', 'focus'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = {
  project: 'Project', repo: 'Repo', tests: 'Tests', builds: 'Builds', errors: 'Errors', todo: 'TODO', history: 'History',
  snippets: 'Snippets', health: 'Health', system: 'System', logs: 'Logs', focus: 'Focus',
}
const SUBS = ['ports', 'procs', 'disk'] as const

// ---------------------------------------------------------------- state

const EMPTY_DATA: Data = {
  hist: [], distract: [], snips: [], projs: {}, runs: [], cov: [], flaky: {}, builds: [], errors: [], edited: [],
  meet: { isOn: false, at: 0, snapshot: {} }, isPresent: false,
}
const EMPTY_VIEW: ViewState = { tab: 'project', sub: 'ports', isBusy: false, note: '', page: 0, lines: {}, figs: {}, logPath: '', logQ: '', histQ: '', draft: { lang: '', name: '', code: '' } }

const viewA = atom({ plugin: 'add-kit', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-1' })
const dataA = atom({ plugin: 'add-kit', key: 'data' } as const, EMPTY_DATA, { shape: 'data-1' })
// Owned by the settings mod, read only: switches are changed by the person with /cfg feature.
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {} as Record<string, boolean>, { shape: 'features-1' })
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')

const SWITCHES = [
  ['history', 'Command history'], ['tests', 'Test, flaky and coverage tracking'], ['builds', 'Build timings'],
  ['errors', 'Error clustering'], ['todos', 'Edited-file list for the TODO board'], ['activity', 'Project activity counters'],
] as const

const isOn = (o: Record<string, boolean>, id: string, dflt: boolean): boolean => o[id] ?? dflt
const flag = async ($: Dollar, id: string, dflt: boolean): Promise<boolean> => isOn(await read($, featuresA).catch(() => ({}) as Record<string, boolean>), `add-kit.${id}`, dflt)

const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['ad', '/ad', 'List every add-kit command'],
  ['adpane', '/adpane [tab]', 'Open the add-kit pane (tabs: project repo tests builds errors todo history snippets health system logs focus)'],
  ['addistract', '/addistract [what]', 'Mark a task switch; no text shows the counts by day (261)'],
  ['admeet', '/admeet on|off|status', 'Meeting mode: runs /cfg feature quiet and restores your switches exactly (262)'],
  ['adpresent', '/adpresent on|off', 'Pane view with figures only; fills /present for real masking (263)'],
  ['adsnip', '/adsnip [add <lang> <name> <code> | use <n> | del <n>]', 'Code snippet manager; use fills the prompt with a fenced block (264)'],
  ['adhist', '/adhist [text]', 'Search the Bash commands recorded (secrets masked, newest 500) (265)'],
  ['adproj', '/adproj', 'Dashboard for this project folder: counters, languages, disk (266)'],
  ['adrepo', '/adrepo', 'Repository health scorecard from read-only git (267)'],
  ['adoutdated', '/adoutdated [npm|pip]', 'Outdated dependencies: runs only when you type it; npm contacts the registry (268)'],
  ['adsec', '/adsec', 'Security hygiene: secret-like file names, tracked .env, .gitignore (269)'],
  ['adlicense', '/adlicense', 'Licence summary from package.json and the LICENSE file (270)'],
  ['adtodo', '/adtodo', 'TODO, FIXME and HACK notes in the files edited this session (271)'],
  ['adtests', '/adtests', 'Test results dashboard: counts per run, trend, chart (272)'],
  ['adflaky', '/adflaky', 'Tests that failed and later passed (273)'],
  ['adcov', '/adcov', 'Coverage trend (274)'],
  ['adbuild', '/adbuild', 'Build and test command durations (275)'],
  ['aderr', '/aderr', 'Error messages grouped by normalised text (276)'],
  ['adlog', '/adlog <file> [filter]', 'Tail the last 16 KB of a log file you name, filtered; refuses secret-like paths (277)'],
  ['adports', '/adports', 'Listening TCP ports (279)'],
  ['adprocs', '/adprocs', 'Top 15 processes by CPU (280)'],
  ['adrec', '/adrec [on|off]', 'Show or set the recording switches (history tests builds errors todos activity)'],
  ['adreset', '/adreset', 'Clear everything add-kit recorded'],
]

const HELP = [
  'add-kit: the project and the code around the session. Read-only shell (git reads, lsof, ps, df, du, ls; npm/pip outdated only when you type /adoutdated). Nothing is written to your project.',
  ...COMMANDS.map(([, usage, desc]) => `${usage.padEnd(52)} ${desc}`),
  '',
  `The pane "${PANE}" has tabs: ${TABS.map(t => TAB_LABEL[t]).join(', ')}.`,
  'Recording is OFF until you switch it on: /adrec on, or /cfg feature add-kit.<history|tests|builds|errors|todos|activity> on.',
  'Not built: 278 (masked environment viewer): the platform can only read a variable whose name is spelled in code, it cannot list them.',
].join('\n')

let lastCwd = '/'

// ---------------------------------------------------------------- the one door to the shell

type Sh = { code: number; out: string; err: string }

const rootOf = async ($: Dollar): Promise<string> => {
  const c = await $.session.cwd().catch(() => undefined)

  return typeof c === 'string' && c.startsWith('/') ? c : lastCwd
}

// Every process this mod starts goes through here; `safeArgv` throws for anything not on the read-only allowlist.
const sh = async ($: Dollar, argv: string[], opts: { isExplicit?: boolean; timeoutMs?: number } = {}): Promise<Sh> => {
  const root = await rootOf($)
  const real = safeArgv(argv, { root, isExplicit: opts.isExplicit })
  const r = await $.process.run(real, { env: SAFE_ENV, timeoutMs: opts.timeoutMs ?? 15_000, cwd: root })

  return { code: r.exitCode, out: r.stdout, err: r.stderr }
}

const git = ($: Dollar, args: string[], timeoutMs = 15_000) => sh($, ['git', ...args], { timeoutMs })
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const firstOf = (s: string) => s.split('\n').find(l => l.trim() !== '')?.trim() ?? ''

// ---------------------------------------------------------------- stored data

const KEYS = {
  hist: 'add-kit:hist',
  distract: 'add-kit:distract',
  snips: 'add-kit:snips',
  projs: 'add-kit:projs',
  runs: 'add-kit:runs',
  meet: 'add-kit:meet',
  present: 'add-kit:present',
} as const
type Persist = keyof typeof KEYS

const loadData = async ($: Dollar): Promise<Data> => {
  const get = (k: string) => $.store.get(k).catch(() => undefined)
  const r = cleanRuns(await get(KEYS.runs))
  const prev = await read($, dataA).catch(() => EMPTY_DATA)

  return {
    hist: cleanHist(await get(KEYS.hist)),
    distract: cleanDistract(await get(KEYS.distract)),
    snips: cleanSnips(await get(KEYS.snips)),
    projs: cleanProjs(await get(KEYS.projs)),
    ...r,
    edited: cleanSessionPaths(prev.edited),
    meet: cleanMeet(await get(KEYS.meet)),
    isPresent: (await get(KEYS.present)) === true,
  }
}

const save = async ($: Dollar, which: Persist, d: Data): Promise<void> => {
  const value =
    which === 'runs' ? { runs: d.runs, cov: d.cov, flaky: d.flaky, builds: d.builds, errors: d.errors } : which === 'present' ? d.isPresent : which === 'meet' ? d.meet : d[which]

  await $.store.set(KEYS[which], value)
}

const mutate = async ($: Dollar, which: Persist | undefined, fn: (d: Data) => Data): Promise<Data> => {
  let out: Data = EMPTY_DATA

  await update($, dataA, cur => {
    out = fn(cur)

    return out
  })

  if (which) await save($, which, out).catch(() => undefined)

  return out
}

const setView = ($: Dollar, fn: (v: ViewState) => ViewState) => update($, viewA, fn)

// ---------------------------------------------------------------- recording (every part behind its own switch)

type Rec = Record<string, unknown>

const observe = async ($: Dollar, e: Rec, ran: Rec, ms: number, f: Record<string, boolean>): Promise<void> => {
  const t = await $.clock.now()
  const tool = String(e.tool ?? '')
  const text = typeof ran.text === 'string' ? ran.text : ''
  const isError = ran.isError === true && ran.deny === undefined
  const command = tool === 'Bash' && typeof e.command === 'string' ? e.command : ''
  const path = typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : ''
  const on = (id: string) => isOn(f, `add-kit.${id}`, false)

  if (on('activity')) {
    const cwd = await rootOf($)

    await mutate($, 'projs', d => ({ ...d, projs: recordTool(d.projs, cwd, tool, extOf(path), t) }))
  }

  if (on('history') && command !== '') await mutate($, 'hist', d => ({ ...d, hist: addCmd(d.hist, command, t) }))

  if (on('todos') && path.startsWith('/') && (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') && !isSecretLikePath(path)) {
    await mutate($, undefined, d => ({ ...d, edited: [...d.edited.filter(p => p !== path), path].slice(-50) }))
  }
  const wantTests = on('tests') && command !== ''
  const wantBuild = on('builds') && command !== ''
  const wantErr = on('errors') && isError

  if (wantTests || wantBuild || wantErr) {
    await mutate($, 'runs', d => {
      let next = d

      if (wantTests) {
        const sum = parseTests(text)

        if (sum) {
          const run = { t, fw: sum.fw, key: cmdKey(command), pass: sum.pass, fail: sum.fail, skip: sum.skip, failed: sum.failed.slice(0, 20), ms }

          next = { ...next, runs: addRun(next.runs, run), flaky: updateFlaky(next.flaky, run, sum.passed) }
        }
        const cov = parseCoverage(text)

        if (cov !== undefined) next = { ...next, cov: addCov(next.cov, { t, pct: cov, key: cmdKey(command) }) }
      }

      if (wantBuild) {
        const key = buildKey(command)

        if (key !== undefined && ms >= 0) next = { ...next, builds: addBuild(next.builds, { t, key, ms, ok: !isError }) }
      }

      if (wantErr) next = { ...next, errors: addErrors(next.errors, errorLines(text !== '' ? text : String(ran.deny ?? '')), t) }

      return next
    })
  }
}

// ---------------------------------------------------------------- read-only builders (each returns lines)

const NOT_REPO = [note('This folder is not a git repository, so there is nothing for add-kit to score. Start a session inside a repo.', 'warning')]

const statSizes = async ($: Dollar, root: string, paths: readonly string[]): Promise<{ path: string; size: number }[]> => {
  const out: { path: string; size: number }[] = []

  for (let i = 0; i < paths.length; i += 20) {
    const batch = await Promise.all(
      paths.slice(i, i + 20).map(async p => {
        try {
          const s = await $.fs.stat(`${root}/${p}`)

          return s.kind === 'file' ? { path: p, size: s.size } : undefined
        } catch {
          return undefined
        }
      }),
    )

    for (const b of batch) if (b) out.push(b)
  }

  return out
}

const buildRepo = async ($: Dollar): Promise<{ lines: Line[]; score?: number }> => {
  const top = await git($, ['rev-parse', '--show-toplevel']).catch(e => {
    if (e instanceof Refused) throw e

    return { code: 128, out: '', err: msgOf(e) } as Sh
  })

  if (top.code !== 0) return { lines: NOT_REPO }
  const root = top.out.trim()
  const refs = await git($, ['for-each-ref', '--format=%(refname:short)%09%(committerdate:unix)%09%(HEAD)', 'refs/heads'])
  const st = await git($, ['status', '--porcelain=v1', '-b', '-unormal'])
  const last = await git($, ['log', '-1', '--format=%ct'])
  const un = await git($, ['ls-files', '--others', '--exclude-standard'])
  const untracked = un.code === 0 ? un.out.split('\n').filter(Boolean) : []
  const sized = await statSizes($, root, untracked.slice(0, 300))
  const nowSec = Math.floor((await $.clock.now()) / 1000)
  const branches = parseBranchRows(refs.out)
  const s = scoreRepo({
    branches,
    statusOut: st.out,
    lastCommitTs: Number(last.out.trim()) || 0,
    nowSec,
    bigUntracked: sized.filter(f => f.size >= 5 * 1024 * 1024),
    untrackedCount: untracked.length,
  })
  const lines = repoLines(s, branches.find(b => b.isCurrent)?.name ?? '')

  if (untracked.length > 300) lines.push(note(`  (only the first 300 of ${untracked.length} untracked files were size-checked)`, 'inactive'))

  return { lines, score: s.score }
}

const LANG_DIRS = ['src', 'lib', 'app', 'test', 'tests', 'pkg', 'cmd']

const buildProject = async ($: Dollar, d: Data): Promise<Line[]> => {
  const root = await rootOf($)
  const name = root.slice(root.lastIndexOf('/') + 1) || root
  const proj = d.projs[root]
  const nowMs = await $.clock.now()
  const exts: Record<string, number> = {}
  const count = (entries: { name: string; kind: string }[]) => {
    for (const en of entries) if (en.kind === 'file' && extOf(en.name) !== '') exts[extOf(en.name)] = (exts[extOf(en.name)] ?? 0) + 1
  }
  const top = await $.fs.list(root).catch(() => [])

  count(top)

  for (const dir of top.filter(en => en.kind === 'dir' && LANG_DIRS.includes(en.name)).slice(0, 5)) count(await $.fs.list(`${root}/${dir.name}`).catch(() => []))

  for (const [k, n] of Object.entries(proj?.exts ?? {})) exts[k] = (exts[k] ?? 0) + n
  const langs = guessLanguages(exts)
  const out: Line[] = [note(`Project ${name}`, 'suggestion'), note(`  ${trunc(root, 80)}`, 'inactive')]

  if (proj) {
    out.push(note(`  last activity ${fmtAge((nowMs - proj.last) / 1000)} ago, first seen ${dayKey(proj.first)}`))
    out.push(note(`  ${proj.tools} tool calls: ${proj.bash} shell, ${proj.edits} edits, ${proj.reads} reads/searches`))
    const days = Object.keys(proj.days).sort().slice(-14)

    out.push(note(`  14 days  ${spark(days.map(k => proj.days[k] ?? 0), 14) || '(none)'}  today ${proj.days[dayKey(nowMs)] ?? 0}`))
  } else {
    out.push(note('  No activity counters for this folder yet (switch add-kit.activity on, then work in it).', 'inactive'))
  }
  out.push(note(`  languages (by file extension): ${langs.length > 0 ? langs.map(l => `${l.lang} ${l.pct}%`).join(', ') : 'none recognised'}`))
  const du = await sh($, ['du', '-k', '-d', '1', root], { timeoutMs: 20_000 }).catch(() => undefined)
  const df = await sh($, ['df', '-k', root]).catch(() => undefined)

  out.push(...diskLines(root, du ? parseDu(du.out) : [], df ? parseDf(df.out) : []))

  return out
}

const SECRET_SPECS = ['*.pem', '*.key', ':(glob)**/.env*', ':(glob)**/id_rsa', ':(glob)**/id_ed25519', ':(glob)**/.npmrc']

const buildHygiene = async ($: Dollar): Promise<Line[]> => {
  const root = await rootOf($)
  const entries = await $.fs.list(root).catch(() => [])
  const names = entries.map(en => en.name)
  const inRepo = await git($, ['rev-parse', '--is-inside-work-tree']).catch(() => ({ code: 1, out: '', err: '' }))
  const isRepo = inRepo.code === 0
  let tracked: string[] = []
  const notIgnored: string[] = []

  if (isRepo) {
    const r = await git($, ['ls-files', '--', ...SECRET_SPECS])

    tracked = r.code === 0 ? r.out.split('\n').filter(p => p !== '' && isSecretLikeName(p.slice(p.lastIndexOf('/') + 1))).slice(0, 30) : []

    for (const n of names.filter(isSecretLikeName).slice(0, 10)) {
      const c = await git($, ['check-ignore', '-q', '--', n])

      if (c.code === 1) notIgnored.push(n)
    }
  }

  return hygieneLines(hygiene({ names, isRepo, tracked, notIgnored }))
}

const readHead = async ($: Dollar, path: string, bytes: number): Promise<string | undefined> => {
  try {
    const s = await $.fs.stat(path)

    if (s.kind !== 'file' || s.size > 2 * 1024 * 1024) return undefined
    const r = await $.fs.read(path, { offset: 0, length: Math.min(bytes, s.size) })

    return typeof r === 'string' ? r : undefined
  } catch {
    return undefined
  }
}

const buildLicense = async ($: Dollar): Promise<Line[]> => {
  const root = await rootOf($)
  const entries = await $.fs.list(root).catch(() => [])
  const out: Line[] = [note('Licence', 'suggestion')]
  const pkg = entries.some(en => en.name === 'package.json') ? await readHead($, `${root}/package.json`, 200_000) : undefined
  const fromPkg = pkg === undefined ? undefined : licenseFromPackageJson(pkg)

  if (pkg !== undefined) out.push(note(`  package.json license: ${fromPkg ?? 'not declared'}`, fromPkg ? undefined : 'warning'))

  for (const f of ['Cargo.toml', 'pyproject.toml']) {
    if (entries.some(en => en.name === f)) {
      const t = await readHead($, `${root}/${f}`, 100_000)
      const l = t === undefined ? undefined : licenseFromToml(t)

      out.push(note(`  ${f} license: ${l ?? 'not declared'}`, l ? undefined : 'warning'))
    }
  }
  const files = entries.filter(en => en.kind === 'file' && isLicenseFile(en.name)).slice(0, 3)

  for (const f of files) {
    const t = await readHead($, `${root}/${f.name}`, 600)
    const line = t === undefined ? '' : firstLine(t)
    const guess = guessLicense(t ?? '')

    out.push(note(`  ${f.name}: "${trunc(line, 80)}"${guess ? `  (looks like ${guess})` : ''}`))
  }

  if (out.length === 1) out.push(note('  No package.json licence field and no LICENSE file at the top level.', 'warning'))
  out.push(note('  Text only: this is not legal advice.', 'inactive'))

  return out
}

const buildTodos = async ($: Dollar, d: Data): Promise<{ lines: Line[]; count: number }> => {
  const root = await rootOf($)
  const todos: Todo[] = []
  let scanned = 0

  for (const p of d.edited.slice(-30).reverse()) {
    if (isSecretLikePath(p) || todos.length >= 200) continue
    const s = await $.fs.stat(p).catch(() => undefined)

    if (!s || s.kind !== 'file' || s.size > 256 * 1024) continue
    const text = await $.fs.read(p, { offset: 0, length: s.size }).catch(() => undefined)

    if (typeof text !== 'string') continue
    scanned++
    todos.push(...scanTodos(p, text))
  }

  return { lines: todoLines(todos.slice(0, 200), scanned, root), count: todos.length }
}

const buildPorts = async ($: Dollar): Promise<{ lines: Line[]; count: number }> => {
  const r = await sh($, ['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'], { timeoutMs: 15_000 }).catch(e => {
    if (e instanceof Refused) throw e

    return undefined
  })

  if (!r) return { lines: [note('lsof could not be run here.', 'warning')], count: 0 }
  const ports = parseLsof(r.out)

  return { lines: portLines(ports), count: ports.length }
}

const buildProcs = async ($: Dollar): Promise<Line[]> => {
  const r = await sh($, ['ps', '-axo', 'pid,comm,pcpu,pmem'], { timeoutMs: 15_000 }).catch(e => {
    if (e instanceof Refused) throw e

    return undefined
  })

  return r ? procLines(parsePs(r.out)) : [note('ps could not be run here.', 'warning')]
}

const buildDisk = async ($: Dollar): Promise<Line[]> => {
  const root = await rootOf($)
  const du = await sh($, ['du', '-k', '-d', '1', root], { timeoutMs: 20_000 }).catch(() => undefined)
  const df = await sh($, ['df', '-k', root]).catch(() => undefined)

  return diskLines(root, du ? parseDu(du.out) : [], df ? parseDf(df.out) : [])
}

const runOutdated = async ($: Dollar, which: 'npm' | 'pip'): Promise<Line[]> => {
  const argvs: string[][] = which === 'npm' ? [['npm', 'outdated', '--json']] : [['pip', 'list', '--outdated', '--format', 'json'], ['pip3', 'list', '--outdated', '--format', 'json']]

  for (const argv of argvs) {
    let r: Sh

    try {
      r = await sh($, argv, { isExplicit: true, timeoutMs: 30_000 })
    } catch (err) {
      if (err instanceof Refused) throw err

      if (/timed out|timeout/i.test(msgOf(err))) return [note(`${which}: timed out after 30 s, so nothing was read.`, 'warning')]
      continue
    }
    if (r.code === 127 || /command not found|not found|no such file/i.test(r.err)) continue
    // npm exits 1 when something is outdated, so the JSON decides, not the exit code.
    const rows: Outdated[] | undefined = which === 'npm' ? parseNpmOutdated(r.out) : parsePipOutdated(r.out)

    if (rows !== undefined && (rows.length > 0 || r.code === 0)) return outdatedLines(rows, which)

    return [note(`${which} gave no readable answer (exit ${r.code}): ${trunc(firstOf(r.err) || firstOf(r.out) || 'no output', 120)}`, 'warning')]
  }

  return [note(`${which} is not installed here, or could not be started.`, 'warning')]
}

const buildLog = async ($: Dollar, path: string, q: string): Promise<Line[]> => {
  const p = path.trim()

  if (p === '') return [note('Type a log file path above (relative to the project or absolute), then press Enter or Refresh.', 'inactive')]

  if (p.length > 500 || p.includes('\0')) return [note('That path is not valid.', 'error')]
  const root = await rootOf($)
  const abs = p.startsWith('/') ? p : p.startsWith('~') ? '' : `${root}/${p}`

  if (abs === '') return [note('Give a path relative to the project or an absolute one (no ~).', 'error')]

  if (isSecretLikePath(abs)) return [note('Refused: that path looks like it holds secrets (keys, .env, credentials, history files), so it will not be read.', 'error')]
  const st = await $.fs.stat(abs, { resolve: true }).catch(() => undefined)

  if (!st) return [note(`${trunc(p, 60)}: no such file.`, 'error')]

  if (st.realPath !== undefined && isSecretLikePath(st.realPath)) return [note('Refused: that path leads to a secret-like file.', 'error')]

  if (st.kind !== 'file') return [note(`${trunc(p, 60)} is not a regular file.`, 'error')]
  const offset = Math.max(0, st.size - LOG_BYTES)
  const text = await $.fs.read(abs, { offset, length: Math.min(st.size, LOG_BYTES) }).catch(() => undefined)

  return typeof text === 'string' ? logLines(p, tailLines(text, offset > 0), q, st.size) : [note('The file could not be read.', 'error')]
}

// ---------------------------------------------------------------- tabs

const liveTab = (t: Tab): boolean => t === 'tests' || t === 'builds' || t === 'errors' || t === 'history' || t === 'snippets' || t === 'focus'

const meetLines = (d: Data): Line[] =>
  d.meet.isOn
    ? [note(`Meeting mode is ON: ${plural(Object.keys(d.meet.snapshot).length, 'switch')} saved to restore exactly. /admeet off to restore.`, 'warning')]
    : [note('Meeting mode is off. /admeet on runs /cfg feature quiet and remembers your switches.', 'inactive')]

const presentLines = (d: Data): Line[] => [
  note(d.isPresent ? 'Presentation view is ON: the pane shows figures only. /adpresent off to leave.' : 'Presentation view is off. /adpresent on shows figures only; /present (extras) masks names on screen.', d.isPresent ? 'warning' : 'inactive'),
]

const liveLines = (t: Tab, d: Data, v: ViewState, nowMs: number): Line[] => {
  switch (t) {
    case 'tests':
      return [...testLines(d.runs, d.cov, nowMs), note(''), ...flakyLines(d.flaky)]
    case 'builds':
      return buildLines(d.builds)
    case 'errors':
      return errorClusterLines(d.errors)
    case 'history':
      return histLines(d.hist, v.histQ, nowMs, v.page)
    case 'snippets':
      return snippetLines(d.snips)
    case 'focus':
      return [...distractLines(d.distract, nowMs), note(''), ...meetLines(d), ...presentLines(d)]
    default:
      return []
  }
}

const stored = (v: ViewState, key: string): Line[] => v.lines[key] ?? []

const tabLines = (t: Tab, d: Data, v: ViewState, nowMs: number): Line[] => {
  if (liveTab(t)) return liveLines(t, d, v, nowMs)

  switch (t) {
    case 'health':
      return [...stored(v, 'hygiene'), note(''), ...stored(v, 'license'), ...(stored(v, 'deps').length > 0 ? [note(''), ...stored(v, 'deps')] : [])]
    case 'system':
      return stored(v, v.sub)
    case 'logs':
      return stored(v, 'log')
    default:
      return stored(v, t)
  }
}

const putLines = ($: Dollar, key: string, lines: Line[], figs: Record<string, number> = {}) => setView($, v => ({ ...v, lines: { ...v.lines, [key]: lines }, figs: { ...v.figs, ...figs } }))

const refreshTab = async ($: Dollar, t: Tab, opts: { isExplicitDeps?: 'npm' | 'pip'; isDepsOnly?: boolean } = {}): Promise<void> => {
  await setView($, v => ({ ...v, isBusy: true, note: '' }))

  try {
    const d = await read($, dataA)
    const v = await read($, viewA)

    switch (t) {
      case 'project':
        await putLines($, 'project', await buildProject($, d))
        break
      case 'repo': {
        const r = await buildRepo($)

        await putLines($, 'repo', r.lines, r.score === undefined ? {} : { repo: r.score })
        break
      }
      case 'todo': {
        const r = await buildTodos($, d)

        await putLines($, 'todo', r.lines, { todo: r.count })
        break
      }
      case 'health':
        if (!opts.isDepsOnly) {
          await putLines($, 'hygiene', await buildHygiene($))
          await putLines($, 'license', await buildLicense($))
        }

        if (opts.isExplicitDeps) {
          const lines = await runOutdated($, opts.isExplicitDeps)

          await putLines($, 'deps', lines, { outdated: Number(/(\d+) packages? behind/.exec(lines[0]?.t ?? '')?.[1] ?? 0) })
        }
        break
      case 'system':
        if (v.sub === 'ports') {
          const r = await buildPorts($)

          await putLines($, 'ports', r.lines, { ports: r.count })
        } else if (v.sub === 'procs') {
          await putLines($, 'procs', await buildProcs($))
        } else {
          await putLines($, 'disk', await buildDisk($))
        }
        break
      case 'logs':
        await putLines($, 'log', await buildLog($, v.logPath, v.logQ))
        break
      default:
        break
    }
  } catch (err) {
    await setView($, v => ({ ...v, note: err instanceof Refused ? err.message : `add-kit: ${trunc(msgOf(err), 120)}` }))
  }
  await setView($, v => ({ ...v, isBusy: false }))
}

const showTab = async ($: Dollar, t: Tab, opts: { isExplicitDeps?: 'npm' | 'pip'; isDepsOnly?: boolean } = {}): Promise<string> => {
  await setView($, v => ({ ...v, tab: t, page: 0 }))
  const opened = await $.ui.open({ id: PANE, title: 'add-kit' }).catch(() => undefined)

  if (!liveTab(t)) await refreshTab($, t, opts)
  const d = await read($, dataA)
  const v = await read($, viewA)
  const nowMs = await $.clock.now()
  const text = toText(opts.isDepsOnly ? stored(v, 'deps') : tabLines(t, d, v, nowMs))

  return `${text}${v.note !== '' ? `\n${v.note}` : ''}${opened?.isPlaced === false ? '\n\n(No pane could be shown here, so the tab is printed above.)' : ''}`
}

// ---------------------------------------------------------------- commands

const fill = async ($: Dollar, text: string): Promise<boolean> => {
  const r = await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)

  return r?.isFilled === true
}

const runCfg = async ($: Dollar, args: string): Promise<{ ok: boolean; reason: string }> => {
  try {
    await $.command.run({ command: 'cfg', args })

    return { ok: true, reason: '' }
  } catch (err) {
    return { ok: false, reason: trunc(msgOf(err), 100) }
  }
}

// `$.command.run` is refused inside a command.run hook (the turn would wait on itself), so a typed /admeet
// answers at once and the /cfg calls run from a timer, outside any hook. If the engine still refuses, the
// first step is put in the prompt box and the rest are listed, so nothing is lost.
const finishMeet = async ($: Dollar, to: 'on' | 'off'): Promise<void> => {
  const d = await read($, dataA)
  const plan = to === 'on' ? { args: ['feature quiet'], isComplete: true } : restorePlan(d.meet.snapshot)

  for (let i = 0; i < plan.args.length; i++) {
    const r = await runCfg($, plan.args[i] as string)

    if (r.ok) continue
    const filled = await fill($, `/cfg ${plan.args[i]}`)
    const msg = `/cfg could not be run for you (${r.reason}). ${filled ? `The prompt box holds "/cfg ${plan.args[i]}": press Enter.` : `Type /cfg ${plan.args[i]}.`}${plan.args.length > i + 1 ? ` Then, in order: ${plan.args.slice(i + 1).map(x => `/cfg ${x}`).join(' ; ')}` : ''}`

    await setView($, v => ({ ...v, note: trunc(msg, 400) }))
    await $.ui.toast(`add-kit: meeting mode needs you to press Enter on "/cfg ${plan.args[i]}".`, { timeoutMs: 8000 })

    return
  }

  if (to === 'off') await mutate($, 'meet', x => ({ ...x, meet: { isOn: false, at: 0, snapshot: {} } }))
  await setView($, v => ({ ...v, note: to === 'on' ? 'Meeting mode is on: /cfg feature quiet was applied.' : `Meeting mode is off: your ${plural(plan.args.length - 1, 'saved switch')} were put back exactly.${plan.isComplete ? '' : ' (Only the first 40 could be restored; check /cfg feature.)'}` }))
}

const cmdMeet = async ($: Dollar, args: string): Promise<string> => {
  const a = args.trim().toLowerCase()
  const d = await read($, dataA)

  if (a === 'status' || a === '') return `${toText(meetLines(d))}\nUsage: /admeet on|off|status`

  if (a === 'on') {
    if (d.meet.isOn) return 'Meeting mode is already on. /admeet off to restore your switches.'
    const snapshot = cleanOverrides(await read($, featuresA).catch(() => ({})))
    const now = await $.clock.now()

    await mutate($, 'meet', x => ({ ...x, meet: { isOn: true, at: now, snapshot } }))
    $.clock.after(0, () => { void finishMeet($, 'on') })

    return `Meeting mode on: running /cfg feature quiet now (no toasts, sounds, status writes or rows from mods; guards and alerts stay). ${plural(Object.keys(snapshot).length, 'switch')} of yours are saved; /admeet off puts them back exactly. If /cfg cannot be run for you, the prompt box gets the command to press Enter on.`
  }

  if (a === 'off') {
    if (!d.meet.isOn) return 'Meeting mode is not on.'
    const plan = restorePlan(d.meet.snapshot)

    $.clock.after(0, () => { void finishMeet($, 'off') })

    return `Restoring now: /cfg feature reset, then ${plural(plan.args.length - 1, 'saved switch')} put back exactly${plan.isComplete ? '' : ' (only the first 40)'}. If /cfg cannot be run for you, the commands are listed in the pane's Focus tab.`
  }

  return 'Usage: /admeet on|off|status'
}

const cmdPresent = async ($: Dollar, args: string): Promise<string> => {
  const a = args.trim().toLowerCase()

  if (a !== 'on' && a !== 'off') return 'Usage: /adpresent on|off. On shows a figures-only view in the pane; for real masking of names, paths and secrets on screen use /present (the extras mod).'
  const to = a === 'on'

  await mutate($, 'present', d => ({ ...d, isPresent: to }))

  if (to) await $.ui.open({ id: PANE, title: 'add-kit' }).catch(() => undefined)
  const ok = await fill($, `/present ${a}`)

  return `${to ? 'Presentation view on: the add-kit pane shows figures only (no names, commands, paths or file contents).' : 'Presentation view off.'} add-kit cannot mask other mods or the transcript: ${ok ? `the prompt box holds "/present ${a}", press Enter for the real masking.` : `type /present ${a} for the real masking.`}`
}

const cmdDistract = async ($: Dollar, args: string): Promise<string> => {
  const what = args.trim()
  const now = await $.clock.now()

  if (what === '') return toText(distractLines((await read($, dataA)).distract, now))

  if (what.length > 200) return 'Keep it under 200 characters.'
  const d = await mutate($, 'distract', x => ({ ...x, distract: addDistraction(x.distract, what, now) }))
  const today = d.distract.filter(x => dayKey(x.t) === dayKey(now)).length

  return `Marked. ${plural(today, 'task switch')} today, ${d.distract.length} in the log.`
}

const cmdSnip = async ($: Dollar, args: string): Promise<string> => {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim())
  const verb = (m?.[1] ?? 'list').toLowerCase()
  const rest = m?.[2] ?? ''
  const d = await read($, dataA)

  if (verb === 'list') return `${toText(snippetLines(d.snips))}\nUsage: /adsnip add <lang> <name> <code> | use <n|name> | del <n|name>`

  if (verb === 'add') {
    const p = /^(\S+)\s+(\S+)\s+([\s\S]+)$/.exec(rest)

    if (!p) return 'Usage: /adsnip add <lang> <name> <code>  (name is one word; write \\n for a new line; the pane form takes longer code)'
    const r = addSnippet(d.snips, p[1] as string, p[2] as string, p[3] as string)

    if (!r.ok) return r.reason
    await mutate($, 'snips', x => ({ ...x, snips: r.list }))

    return `${r.replaced ? 'Replaced' : 'Saved'} snippet "${p[2]}" (${r.list.length} of 60).`
  }
  const s = findSnippet(d.snips, rest)

  if (verb === 'use') {
    if (!s) return `No snippet "${trunc(rest.trim(), 30)}". /adsnip lists them.`

    return (await fill($, fenced(s))) ? `Prompt filled with "${s.name}" as a ${s.lang} code block.` : 'The prompt box could not be filled here.'
  }

  if (verb === 'del') {
    if (!s) return `No snippet "${trunc(rest.trim(), 30)}".`
    await mutate($, 'snips', x => ({ ...x, snips: x.snips.filter(y => y !== s) }))

    return `Deleted "${s.name}".`
  }

  return 'Usage: /adsnip [list | add <lang> <name> <code> | use <n|name> | del <n|name>]'
}

const cmdHist = async ($: Dollar, args: string): Promise<string> => {
  const q = args.trim().slice(0, 80)

  await setView($, v => ({ ...v, histQ: q, page: 0 }))

  return toText(histLines((await read($, dataA)).hist, q, await $.clock.now(), 0))
}

const cmdLog = async ($: Dollar, args: string): Promise<string> => {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim())

  if (!m) return 'Usage: /adlog <file> [filter words; -word excludes]'
  await setView($, v => ({ ...v, logPath: (m[1] as string).slice(0, 300), logQ: (m[2] ?? '').slice(0, 80) }))

  return showTab($, 'logs')
}

const cmdOutdated = async ($: Dollar, args: string): Promise<string> => {
  const a = args.trim().toLowerCase()
  const root = await rootOf($)
  const names = (await $.fs.list(root).catch(() => [])).map(en => en.name)
  let which: 'npm' | 'pip' | undefined = a === 'npm' ? 'npm' : a === 'pip' ? 'pip' : undefined

  if (a !== '' && which === undefined) return 'Usage: /adoutdated [npm|pip]'

  if (!which) which = names.includes('package.json') ? 'npm' : ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'].some(n => names.includes(n)) ? 'pip' : undefined

  if (!which) return 'No package.json or Python requirements file here. Say /adoutdated npm or /adoutdated pip to run it anyway.'
  const head = which === 'npm' ? 'Running npm outdated --json (read-only; npm asks the package registry for the latest versions of your dependencies, 30 s limit)...' : 'Running pip list --outdated (read-only; pip asks the package index, 30 s limit)...'

  return `${head}\n${await showTab($, 'health', { isExplicitDeps: which, isDepsOnly: true })}`
}

const cmdRec = async ($: Dollar, args: string): Promise<string> => {
  const a = args.trim().toLowerCase()
  const f = await read($, featuresA).catch(() => ({}) as Record<string, boolean>)

  if (a === 'on' || a === 'off') {
    const failed: string[] = []

    for (const [id] of SWITCHES) {
      const r = await runCfg($, `feature add-kit.${id} ${a}`)

      if (!r.ok) failed.push(id)
    }

    return failed.length === 0 ? `Recording switched ${a}: ${SWITCHES.map(s => s[0]).join(', ')}.` : `Could not run /cfg for you (${failed.length} of ${SWITCHES.length} failed). Type:\n${SWITCHES.map(([id]) => `  /cfg feature add-kit.${id} ${a}`).join('\n')}`
  }
  if (a !== '' && a !== 'status') return 'Usage: /adrec [status|on|off]'

  return [
    'Recording switches (all default off; each is its own /cfg feature):',
    ...SWITCHES.map(([id, label]) => `  add-kit.${id.padEnd(9)} ${isOn(f, `add-kit.${id}`, false) ? 'ON ' : 'off'}  ${label}`),
    `  add-kit.svg       ${isOn(f, 'add-kit.svg', true) ? 'ON ' : 'off'}  Vector chart on the Tests tab (desktop)`,
    'Change one: /cfg feature add-kit.tests on   ·   all six: /adrec on|off',
  ].join('\n')
}

const cmdReset = async ($: Dollar): Promise<string> => {
  for (const k of Object.values(KEYS)) await $.store.delete(k).catch(() => undefined)
  await update($, dataA, () => ({ ...EMPTY_DATA, edited: [] }))
  await update($, viewA, v => ({ ...EMPTY_VIEW, tab: v.tab }))

  return 'add-kit: everything it recorded is cleared (history, task switches, snippets, project counters, test, build and error records, meeting and presentation state). Your /cfg switches are untouched.'
}

const runCommand = async ($: Dollar, name: string, args: string): Promise<string> => {
  try {
    switch (name) {
      case 'ad':
        return HELP
      case 'adpane': {
        const t = args.trim().toLowerCase()

        if (t !== '' && !(TABS as readonly string[]).includes(t)) return `Tabs: ${TABS.join(', ')}`
        await setView($, v => ({ ...v, tab: t === '' ? v.tab : t }))
        await $.ui.open({ id: PANE, title: 'add-kit' }).catch(() => undefined)

        return `add-kit pane opened${t ? ` at ${t}` : ''}.`
      }
      case 'addistract':
        return await cmdDistract($, args)
      case 'admeet':
        return await cmdMeet($, args)
      case 'adpresent':
        return await cmdPresent($, args)
      case 'adsnip':
        return await cmdSnip($, args)
      case 'adhist':
        return await cmdHist($, args)
      case 'adproj':
        return await showTab($, 'project')
      case 'adrepo':
        return await showTab($, 'repo')
      case 'adoutdated':
        return await cmdOutdated($, args)
      case 'adsec':
        return await showTab($, 'health')
      case 'adlicense':
        return await showTab($, 'health')
      case 'adtodo':
        return await showTab($, 'todo')
      case 'adtests':
        return await showTab($, 'tests')
      case 'adflaky': {
        await showTab($, 'tests')

        return toText(flakyLines((await read($, dataA)).flaky))
      }
      case 'adcov': {
        await showTab($, 'tests')

        return toText(covLines((await read($, dataA)).cov))
      }
      case 'adbuild':
        return await showTab($, 'builds')
      case 'aderr':
        return await showTab($, 'errors')
      case 'adlog':
        return await cmdLog($, args)
      case 'adports':
        await setView($, v => ({ ...v, sub: 'ports' }))

        return await showTab($, 'system')
      case 'adprocs':
        await setView($, v => ({ ...v, sub: 'procs' }))

        return await showTab($, 'system')
      case 'adrec':
        return await cmdRec($, args)
      case 'adreset':
        return await cmdReset($)
      default:
        return `Unknown add-kit command: ${name}`
    }
  } catch (err) {
    return err instanceof Refused ? err.message : `add-kit: ${trunc(msgOf(err), 160)}`
  }
}

// ---------------------------------------------------------------- pane handlers (top level, so `$` may be passed)

const pressTab = async ($: Dollar, t: Tab): Promise<void> => {
  await setView($, v => ({ ...v, tab: t, page: 0 }))

  if (!liveTab(t)) await refreshTab($, t)
}

const pressSub = async ($: Dollar, sub: string): Promise<void> => {
  await setView($, v => ({ ...v, sub }))
  await refreshTab($, 'system')
}

const pressPage = ($: Dollar, delta: number) => setView($, v => ({ ...v, page: Math.max(0, v.page + delta) }))

const submitLogPath = async ($: Dollar, text: string): Promise<void> => {
  await setView($, v => ({ ...v, logPath: text.trim().slice(0, 300) }))
  await refreshTab($, 'logs')
}

const submitLogFilter = async ($: Dollar, text: string): Promise<void> => {
  await setView($, v => ({ ...v, logQ: text.slice(0, 80) }))
  await refreshTab($, 'logs')
}

const typeHist = ($: Dollar, text: string) => setView($, v => ({ ...v, histQ: text.slice(0, 80), page: 0 }))

const typeDraft = ($: Dollar, field: 'lang' | 'name' | 'code', text: string) => setView($, v => ({ ...v, draft: { ...v.draft, [field]: text.slice(0, field === 'code' ? 4000 : 40) } }))

const saveDraft = async ($: Dollar): Promise<void> => {
  const v = await read($, viewA)
  const d = await read($, dataA)
  const r = addSnippet(d.snips, v.draft.lang, v.draft.name, v.draft.code)

  if (!r.ok) {
    await setView($, x => ({ ...x, note: r.reason }))

    return
  }
  await mutate($, 'snips', x => ({ ...x, snips: r.list }))
  await setView($, x => ({ ...x, note: `${r.replaced ? 'Replaced' : 'Saved'} "${v.draft.name.trim()}".`, draft: { lang: x.draft.lang, name: '', code: '' } }))
}

const useSnippet = async ($: Dollar, i: number): Promise<void> => {
  const s = (await read($, dataA)).snips[i]

  if (!s) return
  const ok = await fill($, fenced(s))

  await setView($, v => ({ ...v, note: ok ? `Prompt filled with "${s.name}".` : 'The prompt box could not be filled here.' }))
}

const dropSnippet = async ($: Dollar, i: number): Promise<void> => {
  await mutate($, 'snips', x => ({ ...x, snips: x.snips.filter((_, j) => j !== i) }))
}

const markFromPane = async ($: Dollar, text: string): Promise<void> => {
  const what = text.trim()

  if (what === '') return
  const now = await $.clock.now()

  await mutate($, 'distract', x => ({ ...x, distract: addDistraction(x.distract, what, now) }))
  await setView($, v => ({ ...v, note: 'Marked.' }))
}

const pressMeet = async ($: Dollar, to: 'on' | 'off'): Promise<void> => {
  const text = await cmdMeet($, to)

  await setView($, v => ({ ...v, note: trunc(text.split('\n')[0] ?? '', 200) }))
}

const pressPresent = async ($: Dollar, to: 'on' | 'off'): Promise<void> => {
  const text = await cmdPresent($, to)

  await setView($, v => ({ ...v, note: trunc(text.split('\n')[0] ?? '', 200) }))
}

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    lastCwd = typeof e.cwd === 'string' && e.cwd.startsWith('/') ? e.cwd : '/'
    const d = await loadData($).catch(() => EMPTY_DATA)

    await update($, dataA, () => d).catch(() => undefined)

    for (const [name, , description] of COMMANDS) await $.command.register({ name, description }).catch(() => undefined)

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({ text: await runCommand($, name, e.args) })).catch(() => ({ text: 'add-kit hit an unexpected error.' }))
  }

  // Recording: nothing happens unless one of the add-kit switches is on (all default off).
  on('tool.call', async ($, e, next) => {
    const f = await read($, featuresA).catch(() => ({}) as Record<string, boolean>)

    if (!SWITCHES.some(([id]) => isOn(f, `add-kit.${id}`, false))) return next(e)
    const t0 = await $.clock.now()
    const ran = await next(e)
    const t1 = await $.clock.now()

    await observe($, e as unknown as Rec, ran as unknown as Rec, t1 - t0, f).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Input } = ui
    const Svg = e.surface === 'desktop' ? (ui as ElementTable<'desktop'>).Svg : undefined
    const v = await read($, viewA)
    const d = await read($, dataA)
    const accent = String(await read($, accentA).catch(() => 'suggestion'))
    const density = await read($, densityA).catch(() => 'normal')
    const pad = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
    const nowMs = await $.clock.now().catch(() => 0)
    const tab = (TABS as readonly string[]).includes(v.tab) ? (v.tab as Tab) : 'project'
    const useSvg = Svg !== undefined && (await flag($, 'svg', true))
    const body = tabLines(tab, d, v, nowMs)
    const acc = accent as 'suggestion'

    if (d.isPresent) {
      const last = d.runs[d.runs.length - 1]
      const fig = (label: string, value: string) => (
        <Box gap="sm">
          <Text dimColor>{label.padEnd(22)}</Text>
          <Text weight="semibold" tabular>
            {value}
          </Text>
        </Box>
      )
      const rate = d.runs.length > 0 ? Math.round((d.runs.reduce((a, r) => a + r.pass, 0) / Math.max(1, d.runs.reduce((a, r) => a + r.pass + r.fail, 0))) * 100) : undefined
      const avgBuild = d.builds.length > 0 ? d.builds.reduce((a, b) => a + b.ms, 0) / d.builds.length : undefined

      return (
        <Box flexDirection="column" padding={pad} gap={pad}>
          <Text color={acc} weight="semibold">Presentation view: figures only</Text>
          {fig('Test runs', d.runs.length > 0 ? String(d.runs.length) : 'none')}
          {fig('Last run', last ? `${last.pass} passed, ${last.fail} failed` : 'none')}
          {fig('Pass rate', rate === undefined ? 'none' : `${rate}%`)}
          {fig('Coverage', d.cov.length > 0 ? `${d.cov[d.cov.length - 1]?.pct}%` : 'none')}
          {fig('Timed commands', d.builds.length > 0 ? `${d.builds.length}, avg ${fmtMs(avgBuild ?? 0)}` : 'none')}
          {fig('Error clusters', String(d.errors.length))}
          {fig('Repo health', v.figs.repo === undefined ? 'not read' : `${v.figs.repo}/100`)}
          {fig('TODO notes', v.figs.todo === undefined ? 'not read' : String(v.figs.todo))}
          {fig('Outdated packages', v.figs.outdated === undefined ? 'not read' : String(v.figs.outdated))}
          {fig('Listening ports', v.figs.ports === undefined ? 'not read' : String(v.figs.ports))}
          {fig('Task switches today', String(d.distract.filter(x => dayKey(x.t) === dayKey(nowMs)).length))}
          <Text dimColor size="caption">Names, commands, paths and file contents are not shown here. For masking everywhere else, use /present.</Text>
          <Box>
            <Button key="exit-present" label="Leave presentation view" onPress={() => { void pressPresent($, 'off') }} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding={pad} gap={pad}>
        <Box gap="sm" flexWrap="wrap">
          {TABS.map(t => (
            <Button key={`tab-${t}`} label={TAB_LABEL[t]} plain dimColor={tab !== t} onPress={() => { void pressTab($, t) }} />
          ))}
        </Box>

        {tab === 'system' && (
          <Box gap="sm">
            {SUBS.map(s => (
              <Button key={`sub-${s}`} label={s === 'ports' ? 'Ports' : s === 'procs' ? 'Processes' : 'Disk'} plain dimColor={v.sub !== s} onPress={() => { void pressSub($, s) }} />
            ))}
            <Button key="refresh" label="refresh" plain dimColor onPress={() => { void refreshTab($, 'system') }} />
          </Box>
        )}
        {(tab === 'project' || tab === 'repo' || tab === 'todo') && (
          <Box gap="sm">
            <Button key="refresh" label={tab === 'todo' ? 'rescan' : 'refresh'} plain dimColor onPress={() => { void refreshTab($, tab) }} />
          </Box>
        )}
        {tab === 'health' && (
          <Box gap="sm">
            <Button key="refresh" label="refresh" plain dimColor onPress={() => { void refreshTab($, 'health') }} />
            <Button key="outdated-npm" label="check npm outdated" plain dimColor onPress={() => { void refreshTab($, 'health', { isExplicitDeps: 'npm' }) }} />
            <Button key="outdated-pip" label="check pip outdated" plain dimColor onPress={() => { void refreshTab($, 'health', { isExplicitDeps: 'pip' }) }} />
          </Box>
        )}
        {tab === 'logs' && (
          <Box flexDirection="column" gap="xs">
            <Input key="log-path" label="file" placeholder="logs/app.log (relative or absolute)" value={v.logPath} submitLabel="read" onInput={(x: string) => { void setView($, s => ({ ...s, logPath: x.slice(0, 300) })) }} onSubmit={(x: string) => { void submitLogPath($, x) }} />
            <Input key="log-filter" label="filter" placeholder="words that must appear; -word excludes" value={v.logQ} submitLabel="filter" onInput={(x: string) => { void setView($, s => ({ ...s, logQ: x.slice(0, 80) })) }} onSubmit={(x: string) => { void submitLogFilter($, x) }} />
            <Box gap="sm">
              <Button key="refresh" label="refresh" plain dimColor onPress={() => { void refreshTab($, 'logs') }} />
              <Text dimColor size="caption">Reads the last 16 KB once per press. No timer.</Text>
            </Box>
          </Box>
        )}
        {tab === 'history' && (
          <Box flexDirection="column" gap="xs">
            <Input key="hist-q" label="search" placeholder="words in the command" value={v.histQ} submitLabel="search" onInput={(x: string) => { void typeHist($, x) }} onSubmit={(x: string) => { void typeHist($, x.trim()) }} />
            {searchCmds(d.hist, v.histQ, 500).length > HIST_PAGE && (
              <Box gap="sm">
                <Button key="hist-prev" label="newer" plain dimColor onPress={() => { void pressPage($, -1) }} />
                <Button key="hist-next" label="older" plain dimColor onPress={() => { void pressPage($, 1) }} />
              </Box>
            )}
          </Box>
        )}
        {tab === 'focus' && (
          <Box flexDirection="column" gap="xs">
            <Box gap="sm" flexWrap="wrap">
              <Button key="meet-on" label="Meeting mode on" plain dimColor={d.meet.isOn} onPress={() => { void pressMeet($, 'on') }} />
              <Button key="meet-off" label="Meeting mode off" plain dimColor={!d.meet.isOn} onPress={() => { void pressMeet($, 'off') }} />
              <Button key="present-on" label="Presentation view" plain dimColor onPress={() => { void pressPresent($, 'on') }} />
            </Box>
            <Input key="mark" label="task switch" placeholder="what pulled you away" value="" submitLabel="mark" onSubmit={(x: string) => { void markFromPane($, x) }} />
          </Box>
        )}
        {tab === 'snippets' && (
          <Box flexDirection="column" gap="xs">
            <Input key="draft-lang" label="language" placeholder="ts, python, sh" value={v.draft.lang} submitLabel="ok" onInput={(x: string) => { void typeDraft($, 'lang', x) }} onSubmit={(x: string) => { void typeDraft($, 'lang', x.trim()) }} />
            <Input key="draft-name" label="name" placeholder="one short name" value={v.draft.name} submitLabel="ok" onInput={(x: string) => { void typeDraft($, 'name', x) }} onSubmit={(x: string) => { void typeDraft($, 'name', x.trim()) }} />
            <Input key="draft-code" label="code" placeholder="paste the code" rows={4} value={v.draft.code} submitLabel="ok" onInput={(x: string) => { void typeDraft($, 'code', x) }} onSubmit={(x: string) => { void typeDraft($, 'code', x) }} />
            <Box gap="sm">
              <Button key="draft-save" label="Save snippet" onPress={() => { void saveDraft($) }} />
            </Box>
          </Box>
        )}

        {v.isBusy && <Text dimColor>Reading…</Text>}
        {v.note !== '' && <Text color="warning">{v.note}</Text>}
        {!v.isBusy && body.length === 0 && !liveTab(tab) && <Text dimColor>Nothing read yet: press refresh, or run the command for this tab.</Text>}

        {tab === 'tests' && useSvg && Svg !== undefined && (
          <Svg source={testsSvg(d.runs, d.cov, accent)} alt={testsAlt(d.runs, d.cov)} isInteractive {...svgSize(testsSvg(d.runs, d.cov, accent), 560)} />
        )}

        {tab === 'snippets' ? (
          <Box flexDirection="column">
            {d.snips.length === 0 && <Text dimColor>No snippets yet. Fill the form above, or /adsnip add.</Text>}
            {d.snips.slice(v.page * 6, v.page * 6 + 6).map((s, k) => {
              const i = v.page * 6 + k

              return (
                <Box gap="sm">
                  <Text mono>{`${String(i + 1).padStart(2)}. ${trunc(s.name, 22).padEnd(22)} ${s.lang.padEnd(8)}`}</Text>
                  <Button key={`snip-use-${i}`} label="insert" plain onPress={() => { void useSnippet($, i) }} />
                  <Button key={`snip-del-${i}`} label="delete" plain dimColor onPress={() => { void dropSnippet($, i) }} />
                </Box>
              )
            })}
            {d.snips.length > 6 && (
              <Box gap="sm">
                <Button key="snip-prev" label="previous" plain dimColor onPress={() => { void pressPage($, -1) }} />
                <Button key="snip-next" label="next" plain dimColor onPress={() => { void pressPage($, 1) }} />
              </Box>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            {body.map(l => (
              <Text mono color={l.c}>
                {l.t === '' ? ' ' : l.t}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
