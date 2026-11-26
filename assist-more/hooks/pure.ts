import type { Db, Decision, Flags, Goal, Line, Mark, Option, Profile, Runbook, TaskRec } from '../types'

// ---------------------------------------------------------------- limits and defaults

export const CAPS = {
  runbooks: 20,
  cmds: 60,
  cmdLen: 400,
  tasks: 100,
  questions: 40,
  answersPer: 8,
  fixes: 30,
  goals: 20,
  badges: 30,
  options: 8,
  marks: 8,
  frames: 8,
  profiles: 12,
  listing: 200,
  manifest: 4096,
}

export const TOAST_GAP_MS = 180_000

export const DEFAULT_FLAGS: Flags = { risk: true, typo: true, summary: true, learn: false, defaults: false, plain: false }

export const FLAG_NAMES = ['risk', 'typo', 'summary', 'learn', 'defaults', 'plain'] as const

const NO_QUIET = (): boolean[] => Array.from({ length: 24 }, () => false)

export const DEFAULT_SPRITE = { name: 'Pip', frames: ['(•ᴗ•)', '(•o•)', '(^ᴗ^)', '(-ᴗ-)'], pick: 0 }

export const emptyDb = (): Db => ({
  flags: { ...DEFAULT_FLAGS },
  quiet: NO_QUIET(),
  runbooks: [],
  recording: null,
  tasks: [],
  active: null,
  decision: { question: '', options: [] },
  goals: [],
  badges: [],
  answers: {},
  fixes: [],
  sprite: { ...DEFAULT_SPRITE, frames: [...DEFAULT_SPRITE.frames] },
  profiles: {},
  bound: {},
})

/** What was stored may be from an older version or damaged: keep what is well-formed, default the rest. */
export const sanitizeDb = (raw: unknown): Db => {
  const base = emptyDb()

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return base
  }
  const r = raw as Record<string, unknown>
  const list = <T,>(v: unknown, ok: (x: unknown) => boolean, cap: number): T[] =>
    (Array.isArray(v) ? v.filter(ok).slice(-cap) : []) as T[]
  const isStr = (x: unknown): x is string => typeof x === 'string'
  const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  const rec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

  const flags = rec(r.flags) ? r.flags : {}
  base.flags = {
    risk: flags.risk !== false,
    typo: flags.typo !== false,
    summary: flags.summary !== false,
    learn: flags.learn === true,
    defaults: flags.defaults === true,
    plain: flags.plain === true,
  }
  base.quiet = Array.isArray(r.quiet) && r.quiet.length === 24 ? r.quiet.map(x => x === true) : NO_QUIET()
  base.runbooks = list<Runbook>(r.runbooks, x => rec(x) && isStr(x.name) && Array.isArray(x.cmds) && x.cmds.every(isStr), CAPS.runbooks)
  base.recording =
    rec(r.recording) && isStr(r.recording.name) && Array.isArray(r.recording.cmds) && r.recording.cmds.every(isStr)
      ? { name: r.recording.name, cmds: r.recording.cmds.slice(-CAPS.cmds) }
      : null
  base.tasks = list<TaskRec>(r.tasks, x => rec(x) && isStr(x.label) && isNum(x.ms) && isNum(x.at), CAPS.tasks)
  base.active = rec(r.active) && isStr(r.active.label) && isNum(r.active.at) ? { label: r.active.label, at: r.active.at } : null

  if (rec(r.decision) && isStr(r.decision.question) && Array.isArray(r.decision.options)) {
    base.decision = {
      question: r.decision.question,
      options: (r.decision.options as unknown[])
        .filter((o): o is Option => rec(o) && isStr(o.name) && Array.isArray(o.pros) && Array.isArray(o.cons))
        .slice(0, CAPS.options),
    }
  }
  base.goals = list<Goal>(r.goals, x => rec(x) && isStr(x.text) && isNum(x.target) && isNum(x.count) && isNum(x.doneAt), CAPS.goals)
  base.badges = list(r.badges, x => rec(x) && isStr(x.text) && isNum(x.at), CAPS.badges)
  base.fixes = list(r.fixes, x => rec(x) && isStr(x.from) && isStr(x.to) && isNum(x.at), CAPS.fixes)

  if (rec(r.answers)) {
    const out: Record<string, Record<string, number>> = {}

    for (const [q, counts] of Object.entries(r.answers).slice(-CAPS.questions)) {
      if (rec(counts)) {
        out[q] = Object.fromEntries(Object.entries(counts).filter(([, n]) => isNum(n)).slice(0, CAPS.answersPer)) as Record<string, number>
      }
    }
    base.answers = out
  }

  if (rec(r.sprite) && isStr(r.sprite.name) && Array.isArray(r.sprite.frames) && r.sprite.frames.length > 0 && r.sprite.frames.every(isStr)) {
    const frames = r.sprite.frames.slice(0, CAPS.frames)
    base.sprite = { name: r.sprite.name, frames, pick: isNum(r.sprite.pick) ? Math.max(0, Math.min(frames.length - 1, Math.floor(r.sprite.pick))) : 0 }
  }

  if (rec(r.profiles)) {
    for (const [name, p] of Object.entries(r.profiles).slice(0, CAPS.profiles)) {
      if (rec(p) && rec(p.flags) && Array.isArray(p.quiet) && p.quiet.length === 24) {
        base.profiles[name] = { flags: sanitizeDb({ flags: p.flags }).flags, quiet: p.quiet.map(x => x === true) }
      }
    }
  }

  if (rec(r.bound)) {
    base.bound = Object.fromEntries(Object.entries(r.bound).filter(([, v]) => isStr(v)).slice(0, 100)) as Record<string, string>
  }

  return base
}

// ---------------------------------------------------------------- small helpers

export const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`)

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

export const parseOnOff = (s: string): boolean | undefined => {
  const v = s.trim().toLowerCase()

  return v === 'on' ? true : v === 'off' ? false : undefined
}

export const fmtDur = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))

  if (total < 60) return `${total}s`
  const m = Math.round(total / 60)

  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)

  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)

  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

export const dayStamp = (now: number): string => {
  const d = new Date(now)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const line = (t: string, c?: Line['c']): Line => (c ? { t, c } : { t })

// ---------------------------------------------------------------- toast gate and quiet hours

export const isQuiet = (quiet: readonly boolean[], now: number): boolean => quiet[new Date(now).getHours()] === true

export const toastAllowed = (a: { isCalm: boolean; quiet: readonly boolean[]; now: number; lastAt: number }): boolean =>
  !a.isCalm && !isQuiet(a.quiet, a.now) && a.now - a.lastAt >= TOAST_GAP_MS

/** "22-7" or "22:00-07:00" -> the hours it covers (wrapping past midnight). The end hour is not included. */
export const parseHourRange = (s: string): number[] | undefined => {
  const m = /^(\d{1,2})(?::00)?\s*-\s*(\d{1,2})(?::00)?$/.exec(s.trim())

  if (!m) return undefined
  const a = Number(m[1])
  const b = Number(m[2])

  if (a > 23 || b > 24) return undefined
  const out: number[] = []

  for (let h = a; h !== b % 24; h = (h + 1) % 24) {
    out.push(h)

    if (out.length > 24) break
  }

  return out
}

export const quietRanges = (quiet: readonly boolean[]): string => {
  const parts: string[] = []
  let h = 0

  while (h < 24) {
    if (quiet[h]) {
      let end = h

      while (end + 1 < 24 && quiet[end + 1]) end += 1
      parts.push(`${String(h).padStart(2, '0')}:00-${String((end + 1) % 24).padStart(2, '0')}:00`)
      h = end + 1
    } else {
      h += 1
    }
  }

  return parts.length === 0 ? 'none (toasts allowed all day)' : parts.join(', ')
}

/** A 24 character strip: a block for a quiet hour, a light cell for an allowed one. */
export const quietStrip = (quiet: readonly boolean[]): string => Array.from({ length: 24 }, (_, h) => (quiet[h] ? '█' : '░')).join('')

// ---------------------------------------------------------------- environment doctor

export type DoctorTool = { name: string; argv: string[]; need: 'core' | 'optional'; min?: string; hint: string }

/** The only commands the doctor ever runs: each is `<tool> --version` (or `go version`). */
export const DOCTOR_TOOLS: readonly DoctorTool[] = [
  { name: 'git', argv: ['git', '--version'], need: 'core', min: '2.30', hint: 'install git' },
  { name: 'node', argv: ['node', '--version'], need: 'core', min: '18', hint: 'install Node 18 or newer' },
  { name: 'npm', argv: ['npm', '--version'], need: 'optional', min: '9', hint: 'comes with Node' },
  { name: 'python3', argv: ['python3', '--version'], need: 'optional', min: '3.9', hint: 'install Python 3.9 or newer' },
  { name: 'go', argv: ['go', 'version'], need: 'optional', min: '1.20', hint: 'install Go 1.20 or newer' },
  { name: 'cargo', argv: ['cargo', '--version'], need: 'optional', min: '1.70', hint: 'install Rust via rustup' },
  { name: 'docker', argv: ['docker', '--version'], need: 'optional', min: '20', hint: 'install Docker 20 or newer' },
  { name: 'make', argv: ['make', '--version'], need: 'optional', hint: 'install make' },
  { name: 'rg', argv: ['rg', '--version'], need: 'optional', hint: 'ripgrep makes searching faster' },
  { name: 'jq', argv: ['jq', '--version'], need: 'optional', hint: 'handy for JSON' },
  { name: 'gh', argv: ['gh', '--version'], need: 'optional', hint: 'GitHub CLI' },
  { name: 'curl', argv: ['curl', '--version'], need: 'optional', hint: 'install curl' },
]

export const parseVersion = (text: string): number[] | undefined => {
  const first = text.split('\n').find(l => /\d+\.\d+/.test(l)) ?? text
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(first)

  return m ? [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])] : undefined
}

export const compareVersions = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)

    if (d !== 0) return d < 0 ? -1 : 1
  }

  return 0
}

export type DoctorRow = { name: string; status: 'ok' | 'old' | 'missing' | 'error'; version: string; note: string; need: 'core' | 'optional' }

/** `result` is undefined when the tool could not be started at all. */
export const judgeTool = (tool: DoctorTool, result: { exitCode: number; stdout: string; stderr: string } | undefined): DoctorRow => {
  if (result === undefined) {
    return { name: tool.name, status: 'missing', version: '', note: `not found or could not run: ${tool.hint}`, need: tool.need }
  }
  const v = parseVersion(`${result.stdout}\n${result.stderr}`)

  if (result.exitCode !== 0 && v === undefined) {
    return { name: tool.name, status: 'error', version: '', note: `exited with code ${result.exitCode}`, need: tool.need }
  }

  if (v === undefined) {
    return { name: tool.name, status: 'ok', version: '?', note: 'runs (version not recognised)', need: tool.need }
  }
  const text = v.join('.')
  const min = tool.min === undefined ? undefined : parseVersion(tool.min)

  if (min !== undefined && compareVersions(v, min) < 0) {
    return { name: tool.name, status: 'old', version: text, note: `older than ${tool.min}: ${tool.hint}`, need: tool.need }
  }

  return { name: tool.name, status: 'ok', version: text, note: '', need: tool.need }
}

export const doctorLines = (rows: readonly DoctorRow[]): Line[] => {
  const out: Line[] = [line('Environment doctor (read-only: each tool is asked for its version, nothing else runs).', 'suggestion')]

  for (const r of rows) {
    const mark = r.status === 'ok' ? '✓' : r.status === 'old' ? '!' : r.status === 'missing' ? (r.need === 'core' ? '✗' : '–') : '?'
    const color: Line['c'] =
      r.status === 'ok' ? 'success' : r.status === 'old' ? 'warning' : r.status === 'missing' ? (r.need === 'core' ? 'error' : 'subtle') : 'warning'
    out.push(line(`${mark} ${r.name.padEnd(8)} ${r.version.padEnd(9)} ${r.note}`.trimEnd(), color))
  }
  const bad = rows.filter(r => r.status === 'old' || (r.status === 'missing' && r.need === 'core') || r.status === 'error').length
  out.push(line(bad === 0 ? 'Nothing needs attention.' : `${plural(bad, 'tool')} need attention (✗ missing core tool, ! too old, ? failed to answer; – missing but optional).`, bad === 0 ? 'success' : 'warning'))

  return out
}

// ---------------------------------------------------------------- project card

export type Manifest = { name: string; text: string }
export type ProjectCard = {
  language: string
  frameworks: string[]
  pm: string
  test: string
  build: string
  dirs: string[]
  flags: string[]
  seen: number
  isCut: boolean
}

const has = (names: readonly string[], n: string) => names.includes(n)

const scriptOf = (text: string, key: string): string | undefined => {
  try {
    const parsed = JSON.parse(text) as { scripts?: Record<string, unknown> }
    const s = parsed.scripts?.[key]

    return typeof s === 'string' ? s : undefined
  } catch {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)

    return m ? m[1] : undefined
  }
}

const depNames = (text: string): string[] => {
  try {
    const p = JSON.parse(text) as Record<string, unknown>
    const pick = (k: string) => (typeof p[k] === 'object' && p[k] !== null ? Object.keys(p[k] as object) : [])

    return [...pick('dependencies'), ...pick('devDependencies'), ...pick('peerDependencies')]
  } catch {
    return [...text.matchAll(/"((?:@[\w.-]+\/)?[\w.-]+)"\s*:\s*"[^"]*"/g)].map(m => m[1]!)
  }
}

const JS_FRAMEWORKS: ReadonlyArray<[string, string]> = [
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['astro', 'Astro'],
  ['@remix-run/react', 'Remix'],
  ['@angular/core', 'Angular'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['@nestjs/core', 'NestJS'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['electron', 'Electron'],
  ['vite', 'Vite'],
  ['tailwindcss', 'Tailwind'],
]

const PY_FRAMEWORKS: ReadonlyArray<[string, string]> = [
  ['django', 'Django'],
  ['fastapi', 'FastAPI'],
  ['flask', 'Flask'],
  ['numpy', 'NumPy'],
  ['pandas', 'pandas'],
  ['torch', 'PyTorch'],
]

const RUST_FRAMEWORKS: ReadonlyArray<[string, string]> = [
  ['tokio', 'Tokio'],
  ['axum', 'Axum'],
  ['actix-web', 'Actix'],
  ['rocket', 'Rocket'],
  ['bevy', 'Bevy'],
]

export const analyzeProject = (names: readonly string[], manifests: readonly Manifest[], isCut = false): ProjectCard => {
  const man = (n: string) => manifests.find(m => m.name === n)?.text
  const pkg = man('package.json')
  const py = `${man('pyproject.toml') ?? ''}\n${man('requirements.txt') ?? ''}`.toLowerCase()
  const cargo = man('Cargo.toml')?.toLowerCase()
  const frameworks: string[] = []
  const flags: string[] = []
  let language = 'unknown'
  let test = ''
  let build = ''
  let pm = ''

  if (has(names, 'pnpm-lock.yaml')) pm = 'pnpm'
  else if (has(names, 'yarn.lock')) pm = 'yarn'
  else if (has(names, 'bun.lockb') || has(names, 'bun.lock')) pm = 'bun'
  else if (has(names, 'package-lock.json')) pm = 'npm'

  if (pkg !== undefined) {
    const deps = depNames(pkg)
    const runner = pm === '' ? 'npm' : pm
    language = has(names, 'tsconfig.json') || deps.includes('typescript') ? 'TypeScript / JavaScript (Node)' : 'JavaScript (Node)'

    for (const [dep, label] of JS_FRAMEWORKS) {
      if (deps.includes(dep)) frameworks.push(label)
    }
    const t = scriptOf(pkg, 'test')

    if (t !== undefined && !/no test specified/.test(t)) test = runner === 'npm' ? 'npm test' : `${runner} test`
    else if (deps.includes('vitest')) test = 'npx vitest run'
    else if (deps.includes('jest')) test = 'npx jest'

    if (scriptOf(pkg, 'build') !== undefined) build = `${runner} run build`
  } else if (has(names, 'pyproject.toml') || has(names, 'requirements.txt') || has(names, 'setup.py') || has(names, 'Pipfile')) {
    language = 'Python'

    for (const [dep, label] of PY_FRAMEWORKS) {
      if (new RegExp(`(^|[^a-z])${dep}([^a-z]|$)`).test(py)) frameworks.push(label)
    }

    if (py.includes('poetry')) pm = 'poetry'
    else if (has(names, 'uv.lock')) pm = 'uv'
    else if (has(names, 'Pipfile')) pm = 'pipenv'
    else pm = 'pip'

    if (py.includes('pytest') || has(names, 'pytest.ini') || has(names, 'tests') || has(names, 'test')) test = 'pytest'
    else if (has(names, 'tox.ini')) test = 'tox'
  } else if (cargo !== undefined || has(names, 'Cargo.toml')) {
    language = 'Rust'
    pm = 'cargo'
    test = 'cargo test'
    build = 'cargo build'

    for (const [dep, label] of RUST_FRAMEWORKS) {
      if ((cargo ?? '').includes(dep)) frameworks.push(label)
    }
  } else if (has(names, 'go.mod')) {
    language = 'Go'
    pm = 'go modules'
    test = 'go test ./...'
    build = 'go build ./...'
    const gomod = man('go.mod') ?? ''

    for (const [needle, label] of [['gin-gonic/gin', 'Gin'], ['labstack/echo', 'Echo'], ['gofiber/fiber', 'Fiber']] as const) {
      if (gomod.includes(needle)) frameworks.push(label)
    }
  } else if (has(names, 'pom.xml')) {
    language = 'Java (Maven)'
    test = 'mvn test'
    build = 'mvn package'
  } else if (has(names, 'build.gradle') || has(names, 'build.gradle.kts')) {
    language = has(names, 'build.gradle.kts') ? 'Kotlin / Java (Gradle)' : 'Java (Gradle)'
    test = './gradlew test'
    build = './gradlew build'
  } else if (has(names, 'Gemfile')) {
    language = 'Ruby'
    test = has(names, 'spec') ? 'bundle exec rspec' : 'bundle exec rake test'
  } else if (has(names, 'composer.json')) {
    language = 'PHP'
    test = 'composer test'
  } else if (has(names, 'Package.swift')) {
    language = 'Swift'
    test = 'swift test'
    build = 'swift build'
  } else if (has(names, 'mix.exs')) {
    language = 'Elixir'
    test = 'mix test'
  } else if (names.some(n => /\.(csproj|sln)$/.test(n))) {
    language = 'C# / .NET'
    test = 'dotnet test'
    build = 'dotnet build'
  }

  const readme = names.find(n => /^readme(\.|$)/i.test(n))

  if (readme !== undefined) flags.push(`README (${readme})`)
  if (has(names, 'Dockerfile')) flags.push('Dockerfile')
  if (has(names, '.github')) flags.push('GitHub config (.github)')
  if (has(names, 'Makefile')) flags.push('Makefile')
  if (has(names, '.env') || has(names, '.env.example')) flags.push(has(names, '.env.example') ? '.env.example' : '.env present')
  if (has(names, '.git')) flags.push('git repo')

  const dirs = ['src', 'app', 'lib', 'tests', 'test', 'docs', 'packages', 'scripts', 'cmd', 'internal'].filter(d => has(names, d))

  return { language, frameworks, pm, test, build, dirs, flags, seen: names.length, isCut }
}

export const projectLines = (c: ProjectCard, cwd: string): Line[] => {
  const out: Line[] = [line(`Project card for ${cwd}`, 'suggestion')]
  out.push(line(`Language    ${c.language}${c.pm !== '' ? ` · ${c.pm}` : ''}`))
  out.push(line(`Frameworks  ${c.frameworks.length === 0 ? 'none recognised' : c.frameworks.join(', ')}`))
  out.push(line(`Test        ${c.test === '' ? 'no test command guessed' : c.test}`, c.test === '' ? 'subtle' : 'success'))

  if (c.build !== '') out.push(line(`Build       ${c.build}`))
  out.push(line(`Folders     ${c.dirs.length === 0 ? 'no common ones at the top level' : c.dirs.join(', ')}`))
  out.push(line(`Also        ${c.flags.length === 0 ? 'nothing notable' : c.flags.join(', ')}`))
  out.push(line(`Read only the top-level names (${c.seen}${c.isCut ? '+, capped' : ''}) and the first 4 KB of package manifests. A guess, not a promise.`, 'subtle'))

  return out
}

// ---------------------------------------------------------------- shell splitting

/** Splits a command line into segments (at && || ; | & and newlines) of words, honouring quotes. A guess, never a full shell parser. */
export const splitCommand = (cmd: string): string[][] => {
  const segs: string[][] = []
  let cur: string[] = []
  let tok = ''
  let has_ = false
  let q = ''
  const pushTok = () => {
    if (has_) cur.push(tok)
    tok = ''
    has_ = false
  }
  const pushSeg = () => {
    pushTok()
    if (cur.length > 0) segs.push(cur)
    cur = []
  }

  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i]!

    if (q !== '') {
      if (c === q) q = ''
      else if (c === '\\' && q === '"' && i + 1 < cmd.length) tok += cmd[++i]
      else tok += c
      continue
    }

    if (c === '"' || c === "'") {
      q = c
      has_ = true
    } else if (c === '\\' && i + 1 < cmd.length) {
      tok += cmd[++i]
      has_ = true
    } else if (c === ' ' || c === '\t') {
      pushTok()
    } else if (c === '&' || c === '|' || c === ';' || c === '\n') {
      if (c === '&' && (tok.endsWith('>') || cmd[i + 1] === '>')) {
        tok += c
        has_ = true
      } else {
        pushSeg()
      }
    } else {
      tok += c
      has_ = true
    }
  }
  pushSeg()

  return segs
}

const PREFIXES = new Set(['sudo', 'command', 'time', 'nohup', 'env', 'exec', 'nice'])
const baseName = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p
const dirName = (p: string) => {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')

  return i === -1 ? '.' : i === 0 ? '/' : t.slice(0, i)
}

const stripPrefix = (words: readonly string[]): string[] => {
  let i = 0

  while (i < words.length && (PREFIXES.has(words[i]!) || /^[A-Za-z_]\w*=/.test(words[i]!))) i += 1

  return words.slice(i)
}

const dropRedirects = (words: readonly string[]): string[] => {
  const out: string[] = []

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!

    if (/^\d*[<>]+$/.test(w)) i += 1
    else if (/^\d*[<>]/.test(w)) continue
    else out.push(w)
  }

  return out
}

// ---------------------------------------------------------------- confirmation summaries

const whereOf = (targets: readonly string[]): string => {
  const dirs = [...new Set(targets.map(t => dirName(t)))]

  if (dirs.length === 1) return dirs[0] === '.' ? 'this folder' : dirs[0]!

  return `${dirs.length} folders`
}

const nameList = (targets: readonly string[]) => {
  const names = targets.slice(0, 3).map(t => baseName(t))

  return `${names.join(', ')}${targets.length > 3 ? ', …' : ''}`
}

/** A one-line plain description of what a destructive-looking command does, or undefined for anything else. */
export const destructiveSummary = (command: string): string | undefined => {
  for (const seg of splitCommand(command)) {
    const words = dropRedirects(stripPrefix(seg))
    const cmd = baseName(words[0] ?? '')
    const rest = words.slice(1)

    if (cmd === 'rm') {
      const dd = rest.indexOf('--')
      const flagWords = (dd === -1 ? rest : rest.slice(0, dd)).filter(w => w.startsWith('-'))
      const targets = (dd === -1 ? rest.filter(w => !w.startsWith('-')) : [...rest.slice(0, dd).filter(w => !w.startsWith('-')), ...rest.slice(dd + 1)])
      const isRecursive = flagWords.some(f => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive')

      if (targets.length === 0) continue
      const globs = targets.filter(t => /[*?[]/.test(t))

      if (globs.length > 0) {
        return `Deletes every file matching ${globs.slice(0, 2).join(', ')} in ${whereOf(globs)}${isRecursive ? ', folders with everything inside' : ''} (the count is known only when it runs)`
      }

      if (isRecursive) {
        return `Deletes ${plural(targets.length, 'path')} recursively (folders with everything inside) in ${whereOf(targets)}: ${nameList(targets)}`
      }

      return `Deletes ${plural(targets.length, 'file')} in ${whereOf(targets)}: ${nameList(targets)}`
    }

    if (cmd === 'mv') {
      const flagWords = rest.filter(w => w.startsWith('-'))
      const args = rest.filter(w => !w.startsWith('-'))

      if (args.length < 2 || flagWords.some(f => f === '-t' || f === '--target-directory' || f === '-n' || f === '--no-clobber')) continue
      const dest = args[args.length - 1]!
      const sources = args.slice(0, -1)

      return sources.length === 1
        ? `Moves ${sources[0]} to ${dest} (an existing ${dest} is replaced)`
        : `Moves ${sources.length} items from ${whereOf(sources)} into ${dest} (same-named files there are replaced)`
    }

    if (cmd === 'git') {
      const sub = rest.findIndex(w => w === 'clean' || w === 'reset')

      if (sub === -1) continue
      const args = rest.slice(sub + 1)

      if (rest[sub] === 'clean') {
        const letters = args.filter(w => /^-[a-zA-Z]+$/.test(w)).join('').replace(/-/g, '')
        const isDry = letters.includes('n') || args.includes('--dry-run')
        const isForce = letters.includes('f') || args.includes('--force')

        if (isDry || !isForce) continue
        const paths = args.filter(w => !w.startsWith('-'))

        return `Removes untracked files${letters.includes('d') ? ' and folders' : ''}${/[xX]/.test(letters) ? ', ignored ones too,' : ''} in ${paths.length === 0 ? 'the repository from here down' : paths.join(', ')}`
      }

      if (args.includes('--hard')) {
        const target = args.find(w => !w.startsWith('-'))

        return `Discards every uncommitted change to tracked files${target === undefined ? '' : ` and moves the branch to ${target}`}`
      }
    }
  }

  return undefined
}

// ---------------------------------------------------------------- run-book

const TOKEN_SHAPES: ReadonlyArray<RegExp> = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/g,
]

export const maskSecrets = (cmd: string): string => {
  let s = cmd
  s = s.replace(/(\b[A-Za-z_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|AUTH|CREDENTIAL)[A-Za-z_]*=)("[^"]*"|'[^']*'|\S+)/gi, '$1***')
  s = s.replace(/(--?(?:token|password|passwd|secret|api-key|apikey|key|auth|access-token)[= ])("[^"]*"|'[^']*'|\S+)/gi, '$1***')
  s = s.replace(/(Authorization:\s*\w+\s+)[^\s"']+/gi, '$1***')
  s = s.replace(/(https?:\/\/[^/\s:@]+:)[^@\s]+@/g, '$1***@')
  s = s.replace(/(\s-u\s+[^\s:]+:)\S+/g, '$1***')

  for (const re of TOKEN_SHAPES) s = s.replace(re, '***')
  s = s.replace(/\b[A-Za-z0-9+/_-]{40,}\b/g, m => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) && !m.includes('/') ? '***' : m))

  return clip(s.trim(), CAPS.cmdLen)
}

export const addRecorded = (cmds: readonly string[], command: string): string[] => {
  const masked = maskSecrets(command)

  if (masked === '' || cmds[cmds.length - 1] === masked) return [...cmds]

  return [...cmds, masked].slice(-CAPS.cmds)
}

export const runbookName = (s: string): string | undefined => {
  const n = s.trim().replace(/\s+/g, '-').toLowerCase()

  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(n) ? n : undefined
}

export const putRunbook = (list: readonly Runbook[], rb: Runbook): Runbook[] => [...list.filter(r => r.name !== rb.name), rb].slice(-CAPS.runbooks)

export const runbookText = (rb: Runbook): string =>
  `Run-book "${rb.name}" (${plural(rb.cmds.length, 'command')}, recorded ${dayStamp(rb.at)}):\n${rb.cmds.map((c, i) => `${String(i + 1).padStart(2)}. ${c}`).join('\n')}`

export const runbookPrompt = (rb: Runbook): string => {
  const masked = rb.cmds.some(c => c.includes('***'))

  return [
    `Here is a run-book called "${rb.name}". Go through it step by step: explain what each command does, then run them one at a time and stop if one fails.`,
    ...(masked ? ['Values shown as *** were masked when it was recorded; ask me for the real ones instead of guessing.'] : []),
    '',
    '```sh',
    ...rb.cmds,
    '```',
  ].join('\n')
}

// ---------------------------------------------------------------- time estimate

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'some', 'all', 'new', 'our', 'your', 'then', 'also', 'can', 'are', 'not', 'but'])

export const keywords = (label: string): string[] => [
  ...new Set(
    label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
      .map(w => (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w)),
  ),
]

export const similarTasks = (tasks: readonly TaskRec[], label: string): Array<{ task: TaskRec; shared: string[] }> => {
  const mine = keywords(label)

  if (mine.length === 0) return []

  return tasks
    .map(task => {
      const theirs = new Set(keywords(task.label))
      const shared = mine.filter(w => theirs.has(w))

      return { task, shared, score: shared.length / mine.length }
    })
    .filter(x => x.shared.length >= 1 && x.score >= 0.34)
    .sort((a, b) => b.score - a.score || b.task.at - a.task.at)
    .slice(0, 8)
    .map(({ task, shared }) => ({ task, shared }))
}

export const estimateText = (tasks: readonly TaskRec[], label: string): string => {
  const sim = similarTasks(tasks, label)

  if (sim.length === 0) {
    return 'No similar finished tasks yet, so no estimate: this one becomes the first data point.'
  }
  const ms = sim.map(s => s.task.ms)
  const words = [...new Set(sim.flatMap(s => s.shared))].slice(0, 4).join(', ')

  return `Similar tasks (matching words: ${words}) took about ${fmtDur(median(ms))} (median of ${sim.length}, from ${fmtDur(Math.min(...ms))} to ${fmtDur(Math.max(...ms))}). A rough guide from your own history, not a promise.`
}

// ---------------------------------------------------------------- decision helper

const parseMark = (s: string): Mark | undefined => {
  const m = /^(.*?)(?:\s*\(\s*(\d)\s*\))?$/.exec(s.trim())
  const t = (m?.[1] ?? '').trim()

  if (t === '') return undefined

  return { t: clip(t, 60), w: Math.max(1, Math.min(5, m?.[2] === undefined ? 1 : Number(m[2]))) }
}

/** "Redis + fast (3) + simple - uses memory (2)" -> a name, weighted pros and cons. */
export const parseOption = (text: string): Option | undefined => {
  const parts = text.trim().split(/\s([+-])\s+/)
  const name = (parts[0] ?? '').trim()

  if (name === '' || /^[+-](\s|$)/.test(name)) return undefined
  const opt: Option = { name: clip(name, 40), pros: [], cons: [] }

  for (let i = 1; i + 1 < parts.length; i += 2) {
    const mark = parseMark(parts[i + 1]!)

    if (mark !== undefined) (parts[i] === '+' ? opt.pros : opt.cons).push(mark)
  }

  return opt
}

export const addOption = (d: Decision, opt: Option): Decision => {
  const found = d.options.findIndex(o => o.name.toLowerCase() === opt.name.toLowerCase())

  if (found !== -1) {
    const cur = d.options[found]!
    const merged: Option = { name: cur.name, pros: [...cur.pros, ...opt.pros].slice(-CAPS.marks), cons: [...cur.cons, ...opt.cons].slice(-CAPS.marks) }

    return { ...d, options: d.options.map((o, i) => (i === found ? merged : o)) }
  }

  return { ...d, options: [...d.options, opt].slice(0, CAPS.options) }
}

export const scoreOf = (o: Option) => o.pros.reduce((a, m) => a + m.w, 0) - o.cons.reduce((a, m) => a + m.w, 0)

export const decisionTable = (d: Decision): string[] => {
  if (d.options.length === 0) {
    return [d.question === '' ? 'No decision yet. Start with /amdecide <question>, then /amopt <option> + <pro> - <con>.' : `${d.question}\nNo options yet: /amopt <option> + <pro> - <con> (add a weight 1-5 in brackets, e.g. + fast (3)).`]
  }
  const scores = d.options.map(scoreOf)
  const top = Math.max(...scores)
  const width = Math.min(24, Math.max(6, ...d.options.map(o => o.name.length)))
  const out = [d.question === '' ? 'Decision' : d.question, `${'#'.padEnd(3)}${'Option'.padEnd(width)}  Pros Cons Score`]

  d.options.forEach((o, i) => {
    const pro = o.pros.reduce((a, m) => a + m.w, 0)
    const con = o.cons.reduce((a, m) => a + m.w, 0)
    const s = scores[i]!
    const bar = s > 0 && top > 0 ? '█'.repeat(Math.max(1, Math.round((s / top) * 8))) : ''
    out.push(`${String(i + 1).padEnd(3)}${clip(o.name, width).padEnd(width)}  ${String(pro).padStart(4)} ${String(con).padStart(4)} ${`${s > 0 ? '+' : ''}${s}`.padStart(5)} ${bar}${s === top && d.options.length > 1 && scores.filter(x => x === top).length === 1 ? ' ★' : ''}`)
  })
  const winners = d.options.filter((_, i) => scores[i] === top)
  out.push(d.options.length < 2 ? 'Add at least two options to compare.' : winners.length === 1 ? `Leading on weighted score: ${winners[0]!.name}. The table is a thinking aid: the weights are yours.` : `Tie between ${winners.map(w => w.name).join(' and ')}: adjust a weight or add a pro/con.`)

  return out
}

// ---------------------------------------------------------------- undo guide

export type GitFacts = { isRepo: boolean; changed: string[]; staged: number; untracked: number; last: string; hasCommit: boolean; branch: string }

export const parsePorcelain = (out: string): { changed: string[]; staged: number; untracked: number } => {
  const changed: string[] = []
  let staged = 0
  let untracked = 0

  for (const l of out.split('\n')) {
    if (l.length < 4) continue

    if (l.startsWith('??')) {
      untracked += 1
      continue
    }

    if (l[0] !== ' ' && l[0] !== '?') staged += 1
    changed.push(l.slice(3))
  }

  return { changed, staged, untracked }
}

export const undoGuide = (f: GitFacts): string => {
  if (!f.isRepo) {
    return [
      'This folder is not a git repository, so there is no safe built-in way to roll back.',
      'Options: restore the file from a backup or editor history; for next time, run "git init" and commit before big changes.',
      'Nothing was run except a read-only check.',
    ].join('\n')
  }
  const out = [`Undo guide (read-only: I looked at "git status"${f.hasCommit ? ' and the last commit' : ''} and ran nothing else). Branch: ${f.branch || 'unknown'}.`]
  const edits = f.changed.length

  if (edits === 0 && f.untracked === 0) {
    out.push('Working tree is clean: there are no uncommitted changes to undo.')
  } else {
    out.push(`Uncommitted: ${plural(edits, 'changed file')}${f.staged > 0 ? ` (${f.staged} staged)` : ''}${f.untracked > 0 ? `, ${plural(f.untracked, 'new untracked file')}` : ''}.`)
    out.push(`  ${f.changed.slice(0, 5).join(', ')}${edits > 5 ? ', …' : ''}`)
    out.push('To put the changes aside and keep them (safest, you can bring them back):')
    out.push('  git stash push --include-untracked -m "before undo"      then later: git stash pop')
    out.push('To throw changes away for specific files (cannot be undone, check first with "git diff <file>"):')
    out.push('  git restore <file>              (add --staged to unstage first)')

    if (f.untracked > 0) {
      out.push('New untracked files are not touched by restore. Preview what would go: "git clean -n"; delete only after reading the list: "git clean -f".')
    }
  }

  if (f.hasCommit) {
    out.push(`Last commit: ${f.last}`)
    out.push('To undo it but keep the changes in your files:   git reset --soft HEAD~1')
    out.push('To undo it with a new commit (safe if already pushed):   git revert HEAD')
    out.push('Avoid "git reset --hard" unless you are sure: it deletes uncommitted work.')
  }
  out.push('I never run these for you. Copy the one you want, or ask me to run it.')

  return out.join('\n')
}

// ---------------------------------------------------------------- contrast

export const parseHex = (s: string): [number, number, number] | undefined => {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s.trim())

  if (!m) return undefined
  const h = m[1]!.length === 3 ? m[1]!.split('').map(c => c + c).join('') : m[1]!

  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export const luminance = ([r, g, b]: [number, number, number]): number => {
  const lin = (v: number) => {
    const c = v / 255

    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export const contrastRatio = (a: [number, number, number], b: [number, number, number]): number => {
  const la = luminance(a)
  const lb = luminance(b)

  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export const contrastVerdict = (ratio: number) => ({
  aaNormal: ratio >= 4.5,
  aaLarge: ratio >= 3,
  aaaNormal: ratio >= 7,
  aaaLarge: ratio >= 4.5,
})

export const contrastText = (fg: string, bg: string): string => {
  const a = parseHex(fg)
  const b = parseHex(bg)

  if (a === undefined || b === undefined) {
    return 'Usage: /amcontrast <hex> <hex>, for example /amcontrast #767676 #ffffff (3 or 6 digit hex, # optional).'
  }
  const ratio = contrastRatio(a, b)
  const v = contrastVerdict(ratio)
  const p = (ok: boolean) => (ok ? 'pass' : 'FAIL')
  const rounded = Math.floor(ratio * 100) / 100

  return `${fg} on ${bg}: ${rounded.toFixed(2)}:1\nAA normal text (4.5) ${p(v.aaNormal)} · AA large text (3) ${p(v.aaLarge)} · AAA normal (7) ${p(v.aaaNormal)} · AAA large (4.5) ${p(v.aaaLarge)}`
}

// ---------------------------------------------------------------- risky edits

const CI_FILE = /(^|\/)\.github\/.*\.ya?ml$|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)\.circleci\/config\.ya?ml$|(^|\/)Jenkinsfile$/
const SCRIPT_KEY = /"(?:(?:pre|post)?(?:install|build|test|start|prepare|publish|prepublish|prepublishOnly)|dev|lint|scripts)"\s*:/

/** Why this edit touches a build, CI or config file, or undefined when it does not. */
export const riskyEdit = (tool: string, input: Record<string, unknown>): string | undefined => {
  if ((tool !== 'Edit' && tool !== 'Write') || typeof input.file_path !== 'string') return undefined
  const path = input.file_path
  const name = baseName(path)

  if (/^Dockerfile(\..+)?$|\.dockerfile$/i.test(name)) return `${name} (container build)`
  if (/^docker-compose.*\.ya?ml$|^compose\.ya?ml$/.test(name)) return `${name} (container setup)`
  if (name === 'Makefile' || name === 'GNUmakefile') return 'the Makefile (build rules)'
  if (CI_FILE.test(path)) return `${name} (CI pipeline)`

  if (name === 'package.json') {
    const texts = [input.old_string, input.new_string, input.content].filter((x): x is string => typeof x === 'string')

    return texts.some(t => SCRIPT_KEY.test(t)) ? 'package.json scripts (build and test commands)' : undefined
  }

  return undefined
}

// ---------------------------------------------------------------- gentle correction

const SKIP_CHARS = /[\s$*?[\]{}()<>|&;`!~#=]/
const PATH_FIRST = new Set(['node', 'python', 'python3', 'bash', 'sh', 'source'])
const PATH_ALL = new Set(['cd', 'ls', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'rm', 'stat', 'file', 'open', 'diff', 'cp', 'mv', 'code', 'bat', 'tree', 'du'])
const ANY_WORD = new Set(['cd', 'ls', 'tree', 'du'])

/** Path-looking words of a Bash command that the command reads or enters (never ones it creates). */
export const pathCandidates = (command: string): string[] => {
  const out: string[] = []

  for (const seg of splitCommand(command)) {
    const words = dropRedirects(stripPrefix(seg))
    const cmd = baseName(words[0] ?? '')

    if (!PATH_ALL.has(cmd) && !PATH_FIRST.has(cmd)) continue
    let args = words.slice(1).filter(w => !w.startsWith('-'))

    if (cmd === 'cp' || cmd === 'mv') args = args.slice(0, -1)
    if (PATH_FIRST.has(cmd)) args = args.slice(0, 1)

    for (const a of args.slice(0, 4)) {
      const isPathy = a.includes('/') || /\.[A-Za-z0-9]{1,5}$/.test(a) || ANY_WORD.has(cmd)

      if (a !== '' && a !== '.' && a !== '..' && !SKIP_CHARS.test(a) && !a.includes('://') && a.length <= 200 && isPathy) out.push(a)
    }
  }

  return [...new Set(out)].slice(0, 4)
}

export const editDistance = (a: string, b: string): number => {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]

    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }

  return prev[b.length]!
}

/** Existing siblings at edit distance 1-2 (1 for short names): the closest ones, at most two. */
export const closeSiblings = (name: string, siblings: readonly string[]): string[] => {
  if (name.length < 3) return []
  const max = name.length <= 4 ? 1 : 2
  const scored = siblings
    .filter(s => s !== name)
    .map(s => ({ s, d: s.toLowerCase() === name.toLowerCase() ? 1 : editDistance(name, s) }))
    .filter(x => x.d >= 1 && x.d <= max)

  if (scored.length === 0) return []
  const best = Math.min(...scored.map(x => x.d))

  return scored
    .filter(x => x.d === best)
    .map(x => x.s)
    .sort()
    .slice(0, 2)
}

export const joinPath = (cwd: string, p: string): string => {
  const abs = p.startsWith('/') ? p : `${cwd.replace(/\/+$/, '')}/${p}`
  const parts: string[] = []

  for (const seg of abs.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }

  return `/${parts.join('/')}`
}

export const parentOf = dirName
export const leafOf = baseName

// ---------------------------------------------------------------- learning moments and smart defaults

export const fixKey = (from: string, to: string): string | undefined => {
  const a = from.replace(/\s+/g, ' ').trim()
  const b = to.replace(/\s+/g, ' ').trim()

  if (a.length < 6 || a === b || a.length > 160 || b.length > 160) return undefined

  return `${a}\u0000${b}`
}

export type FixSeen = Record<string, { n: number; files: string[]; offered: boolean }>

/** Counts one more sighting of a fix; returns whether this is the moment to offer saving it (the second sighting, in another call). */
export const noteFix = (seen: FixSeen, key: string, file: string): { seen: FixSeen; offer: boolean } => {
  const cur = seen[key] ?? { n: 0, files: [], offered: false }
  const next = { n: cur.n + 1, files: [...cur.files, file].slice(-3), offered: cur.offered }
  const offer = next.n >= 2 && !cur.offered

  if (offer) next.offered = true
  const entries = Object.entries({ ...seen, [key]: next })

  return { seen: Object.fromEntries(entries.slice(-50)), offer }
}

export const questionKey = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').replace(/\?+$/, '').trim().slice(0, 120)

export const recordAnswers = (all: Db['answers'], answers: Record<string, unknown>): Db['answers'] => {
  const out = { ...all }

  for (const [q, a] of Object.entries(answers)) {
    if (typeof a !== 'string' || a.trim() === '' || a.length > 80) continue
    const key = questionKey(q)

    if (key === '') continue
    const counts = { ...(out[key] ?? {}) }
    counts[a] = (counts[a] ?? 0) + 1
    const top = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, CAPS.answersPer)
    delete out[key]
    out[key] = Object.fromEntries(top)
  }

  return Object.fromEntries(Object.entries(out).slice(-CAPS.questions))
}

export const usualAnswer = (all: Db['answers'], q: string): { answer: string; n: number; total: number } | undefined => {
  const counts = all[questionKey(q)]

  if (counts === undefined) return undefined
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((a, [, n]) => a + n, 0)
  const top = entries[0]

  return top !== undefined && top[1] >= 2 && top[1] / total >= 0.6 ? { answer: top[0], n: top[1], total } : undefined
}

// ---------------------------------------------------------------- plain-language mode

export const PLAIN_SECTION = {
  id: 'assist-more:plain',
  scope: 'session',
  text: 'Plain-language mode is on. Write for someone who does not know the jargon: use everyday words and short sentences, explain any technical term in a few words the first time you use it, and spell out acronyms. Keep code, commands, file names and error messages exactly as they are. This changes only how you explain things, never what you do.',
} as const

// ---------------------------------------------------------------- goals and badges

export const parseGoal = (s: string): { text: string; target: number } | undefined => {
  const m = /^(.*\S)\s+(\d{1,4})$/.exec(s.trim())

  if (!m) return undefined
  const target = Number(m[2])

  return target >= 1 && target <= 1000 ? { text: clip(m[1]!, 60), target } : undefined
}

export const barOf = (n: number, total: number, width = 10): string => {
  const filled = total <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((n / total) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const tickGoal = (goals: readonly Goal[], index: number, by: number, now: number): { goals: Goal[]; done: Goal | undefined } => {
  const g = goals[index]

  if (g === undefined || g.doneAt > 0) return { goals: [...goals], done: undefined }
  const count = Math.min(g.target, Math.max(0, g.count + by))
  const finished = count >= g.target
  const updated: Goal = { ...g, count, doneAt: finished ? now : 0 }

  return { goals: goals.map((x, i) => (i === index ? updated : x)), done: finished ? updated : undefined }
}

export const goalLines = (goals: readonly Goal[], badges: readonly { text: string; at: number }[]): string[] => {
  const out = goals.length === 0 ? ['No goals yet. Add one with /amgoal add <text> <target>, for example /amgoal add write tests 5.'] : goals.map((g, i) => `${i + 1}. ${barOf(g.count, g.target)} ${g.count}/${g.target}  ${g.text}${g.doneAt > 0 ? '  ✓ done' : ''}`)

  if (badges.length > 0) {
    out.push('', `Badges (${badges.length}): ${badges.slice(-5).map(b => `★ ${b.text}`).join(' · ')}`)
  }

  return out
}

// ---------------------------------------------------------------- sprite

export const cleanGlyph = (s: string): string => clip(s.replace(/[\u0000-\u001f\u007f]/g, '').trim(), 12)

// ---------------------------------------------------------------- profiles

export const BUILTIN_PROFILES: Readonly<Record<string, Profile>> = {
  work: {
    flags: { risk: true, typo: true, summary: true, learn: false, defaults: true, plain: false },
    quiet: Array.from({ length: 24 }, (_, h) => h >= 22 || h < 7),
  },
  personal: {
    flags: { risk: true, typo: true, summary: true, learn: true, defaults: false, plain: true },
    quiet: Array.from({ length: 24 }, (_, h) => h >= 23 || h < 8),
  },
  demo: {
    flags: { risk: false, typo: false, summary: true, learn: false, defaults: false, plain: false },
    quiet: Array.from({ length: 24 }, () => true),
  },
}

export const profileOf = (db: Db, name: string): Profile | undefined => db.profiles[name] ?? BUILTIN_PROFILES[name]

export const applyProfile = (db: Db, p: Profile): Db => ({ ...db, flags: { ...p.flags }, quiet: [...p.quiet] })

export const flagsText = (f: Flags) => FLAG_NAMES.map(n => `${n} ${f[n] ? 'on' : 'off'}`).join(', ')

// ---------------------------------------------------------------- commands table

export const COMMANDS: ReadonlyArray<readonly [string, string, string]> = [
  ['am', '/am', 'This list'],
  ['ampane', '/ampane [doctor|project|runbooks|task|decide|goals|quiet|buddy|profiles]', 'Open the pane (buttons for scans, run-books, quiet hours, goals, sprite, profiles)'],
  ['amdoctor', '/amdoctor', 'Environment doctor: reads the version of git, node, python and friends; flags missing or old ones (read-only)'],
  ['amproject', '/amproject', 'Project card from top-level file names and the first 4 KB of package manifests'],
  ['amrun', '/amrun start <name> | stop | show <name> | list | fill <name> | del <name>', 'Record Bash commands into a run-book (secrets masked); never runs them'],
  ['amtask', '/amtask start <label> | done | cancel | list', 'Time a task and get a text-only estimate from similar past tasks'],
  ['amsplit', '/amsplit [big request]', 'Fill the prompt with a request to split a big task into small steps'],
  ['amdecide', '/amdecide <question> | clear', 'Start a decision and show its weighted table'],
  ['amopt', '/amopt <option> + <pro> (w) - <con> (w) | del <n>', 'Add an option with weighted pros (+) and cons (-); weight 1-5 in brackets'],
  ['amrisk', '/amrisk [on|off]', 'Toast when an edit touches Dockerfile, CI yml, Makefile or package.json scripts (default on)'],
  ['amundo', '/amundo', 'Explain how to roll back the last change with git; checks status read-only, never runs the commands'],
  ['amlearn', '/amlearn [on|off|save|list|clear]', 'Learning moments: one toast when the same fix happens twice (default off)'],
  ['amtypo', '/amtypo [on|off]', 'Toast when a Bash path looks like a typo of a nearby existing one; never blocks (default on)'],
  ['amdefaults', '/amdefaults [on|off|list|clear]', 'Remember your usual answer to repeated questions and show it as a hint (default off)'],
  ['amsummary', '/amsummary [on|off]', 'One-line banner above destructive-looking rm, mv, git clean (default on; never blocks)'],
  ['amcontrast', '/amcontrast <hex> <hex>', 'WCAG contrast ratio with AA and AAA verdicts'],
  ['amplain', '/amplain [on|off]', 'Plain-language mode: ask the model to avoid jargon (default off)'],
  ['amprofile', '/amprofile [list|save <name>|use <name>|bind <name>|unbind|del <name>]', 'Named bundles of this mod\'s settings: work, personal, demo, your own; bind one to a folder'],
  ['amquiet', '/amquiet [22-7|toggle <hour>|none|all]', 'Quiet hours for this mod\'s toasts (the pane has a 24 hour strip)'],
  ['amsound', '/amsound [name]', 'Play a sound from this mod\'s own sounds/ folder (copy your wav files there)'],
  ['amsprite', '/amsprite [name <text>|add <glyph>|pick <n>|clear]', 'Your own sprite glyphs and name, shown in this mod\'s pane only'],
  ['amgoal', '/amgoal add <text> <target> | tick <n> [by] | del <n>', 'Your own goals with a counter; finishing one earns a badge'],
  ['amreset', '/amreset [all]', 'Clear recorded data (run-books, tasks, decision, goals, answers, fixes); "all" also resets settings'],
]

export const helpText = (): string =>
  ['assist-more: extra helpers. Nothing here edits your files, runs your commands or talks to a network.', ...COMMANDS.map(([, usage, desc]) => `${usage.padEnd(52)} ${desc}`)].join('\n')

export const splitPrompt = (request: string): string =>
  [
    'This request is big, so do not start building yet. Split it into small steps first:',
    '1. Restate the goal in one sentence.',
    '2. List 3 to 8 steps, each small enough to finish and check on its own, in the order they should be done.',
    '3. For each step say what "done" looks like and how I can check it.',
    '4. Point out anything unclear and ask me before you start.',
    'Wait for my go-ahead before doing step 1.',
    '',
    'The request:',
    request.trim() === '' ? '<paste the big request here>' : request.trim(),
  ].join('\n')

export type { Line }
