// The one door to the shell. Pure: `checkArgv` looks at a whole argument vector (program first) and says whether
// it is on a short allowlist of READ-ONLY commands. `safeArgv` throws for anything else, and register.tsx calls
// nothing but `safeArgv` before `$.process.run`, so a write verb can never reach the process API.
//
// Allowed (and only these shapes):
//   git       status log diff branch for-each-ref rev-parse ls-files tag -l, remote -v, check-ignore  (read flags only)
//   lsof      exactly: lsof -nP -iTCP -sTCP:LISTEN
//   ps        exactly: ps -axo pid,comm,pcpu,pmem
//   df        df -k [path inside the project]
//   du        du -k -d <0..3> <path inside the project>   |   du -sk <path inside the project>
//   ls        ls [one flag word of 1 A a l p h F] [path inside the project]
//   npm       exactly: npm outdated --json                              (only when the user typed the command)
//   pip       exactly: pip|pip3 list --outdated --format json           (only when the user typed the command)

export type Verdict = { ok: true } | { ok: false; reason: string }
export type Ctx = {
  /** The session's working directory, absolute. Paths given to du, df and ls must lie inside it. */
  root: string
  /** True only for a command the person typed on purpose (the explicit-only tools need it). */
  isExplicit?: boolean
}

const refuse = (reason: string): Verdict => ({ ok: false, reason })
const OK: Verdict = { ok: true }

// ------------------------------------------------------------------ paths

export const isInside = (root: string, p: string): boolean => {
  if (typeof root !== 'string' || typeof p !== 'string' || !root.startsWith('/') || !p.startsWith('/')) return false

  if (p.includes('\0') || root.includes('\0') || p.length > 1024) return false

  if (p.split('/').some(seg => seg === '..' || seg === '.')) return false
  const base = root.endsWith('/') ? root.slice(0, -1) : root

  return p === base || p === `${base}/` || p.startsWith(`${base}/`)
}

// ------------------------------------------------------------------ git

type Arity = 'none' | 'value' | 'attached'
type Spec = {
  flags: Record<string, Arity>
  paths: boolean
  digits?: boolean
  needsOne?: readonly string[]
  positionalNeeds?: readonly string[]
}

const mk = (none: string, value = '', attached = ''): Record<string, Arity> => {
  const out: Record<string, Arity> = {}
  for (const k of none.split(' ').filter(Boolean)) out[k] = 'none'
  for (const k of value.split(' ').filter(Boolean)) out[k] = 'value'
  for (const k of attached.split(' ').filter(Boolean)) out[k] = 'attached'

  return out
}

const LOG_FLAGS = mk(
  '--oneline --no-merges --merges --first-parent --stat --numstat --shortstat --name-only --name-status ' +
    '--all --decorate --no-decorate --reverse --no-color --topo-order --date-order --abbrev-commit --graph ' +
    '--branches --tags --remotes --no-patch -s --no-ext-diff --no-textconv',
  '-n --max-count --skip --since --until --after --before --author --committer --grep --format --diff-filter',
  '--pretty --date --abbrev --color',
)

const DIFF_FLAGS = mk(
  '--stat --numstat --shortstat --name-only --name-status --cached --staged --check --no-color --no-ext-diff ' +
    '--no-textconv -M -C --summary -z --minimal --compact-summary --no-renames --raw --exit-code --quiet --no-patch -s',
  '--diff-filter',
  '--color --unified -U --dirstat --stat-width --find-renames --abbrev',
)

const SPECS: Record<string, Spec> = {
  status: {
    flags: mk('-s --short -b --branch -z --no-renames --renames --ahead-behind --no-ahead-behind --long', '', '--porcelain -u --untracked-files --ignored'),
    paths: true,
  },
  log: { flags: LOG_FLAGS, paths: true, digits: true },
  diff: { flags: DIFF_FLAGS, paths: true },
  branch: {
    flags: mk('-a --all -r --remotes -v -vv --verbose --show-current --list --no-color', '--contains --no-contains --merged --no-merged --format --sort --points-at', '--color --abbrev'),
    paths: false,
    positionalNeeds: ['--list'],
  },
  tag: {
    flags: mk('-l --list --no-color', '--contains --no-contains --merged --no-merged --format --sort --points-at', '-n --color'),
    paths: false,
    needsOne: ['-l', '--list'],
    positionalNeeds: ['-l', '--list'],
  },
  'for-each-ref': {
    flags: mk('', '--format --sort --count --merged --no-merged --contains --no-contains --points-at'),
    paths: true,
  },
  'rev-parse': {
    flags: mk('--is-inside-work-tree --show-toplevel --git-dir --absolute-git-dir --verify --show-prefix --quiet -q', '', '--abbrev-ref --short'),
    paths: true,
  },
  'ls-files': {
    flags: mk('-c --cached -d --deleted -m --modified -o --others -i --ignored -s --stage -z --exclude-standard --full-name --directory --no-empty-directory'),
    paths: true,
  },
  'check-ignore': { flags: mk('-v --verbose -n --non-matching -z --no-index -q --quiet'), paths: true },
}

const checkWords = (name: string, spec: Spec, words: readonly string[]): Verdict => {
  const present = (flag: string) => words.some(w => w === flag || w.startsWith(`${flag}=`))

  if (spec.needsOne && !spec.needsOne.some(present)) return refuse(`git ${name} is allowed only with ${spec.needsOne.join(' or ')}`)
  let isPathsOnly = false

  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? ''

    if (isPathsOnly) {
      if (!spec.paths) return refuse(`git ${name}: paths are not accepted`)
      continue
    }

    if (w === '--') {
      if (!spec.paths) return refuse(`git ${name}: "--" is not accepted`)
      isPathsOnly = true
      continue
    }

    if (w.startsWith('--')) {
      const eq = w.indexOf('=')
      const key = eq === -1 ? w : w.slice(0, eq)
      const kind = Object.hasOwn(spec.flags, key) ? spec.flags[key] : undefined

      if (kind === undefined) return refuse(`git ${name} ${key} is not on the read-only allowlist`)

      if (kind === 'none' && eq !== -1) return refuse(`git ${name} ${key} takes no value`)

      if (kind === 'value' && eq === -1) {
        const v = words[i + 1]

        if (v === undefined || v.startsWith('-')) return refuse(`git ${name} ${key} needs a plain value`)
        i++
      }
      continue
    }

    if (w.startsWith('-') && w.length > 1) {
      if (spec.digits && /^-\d+$/.test(w)) continue
      const exact = Object.hasOwn(spec.flags, w) ? spec.flags[w] : undefined

      if (exact === 'none' || exact === 'attached') continue

      if (exact === 'value') {
        const v = words[i + 1]

        if (v === undefined || v.startsWith('-')) return refuse(`git ${name} ${w} needs a plain value`)
        i++
        continue
      }
      const head = w.slice(0, 2)
      const headKind = Object.hasOwn(spec.flags, head) ? spec.flags[head] : undefined

      if ((headKind === 'value' || headKind === 'attached') && !w.startsWith('--')) continue

      if (/^-[A-Za-z]{2,}$/.test(w) && [...w.slice(1)].every(c => (Object.hasOwn(spec.flags, `-${c}`) ? spec.flags[`-${c}`] : undefined) === 'none')) continue

      return refuse(`git ${name} ${w} is not on the read-only allowlist`)
    }

    if (spec.positionalNeeds !== undefined && spec.positionalNeeds.length > 0 && !spec.positionalNeeds.some(present)) {
      return refuse(`git ${name} ${w}: a name here would create or change something`)
    }

    if (!spec.paths && spec.positionalNeeds === undefined) return refuse(`git ${name}: no positional words are accepted`)
  }

  return OK
}

export const checkGit = (args: readonly string[]): Verdict => {
  if (args.length === 0) return refuse('no git command given')
  const verb = args[0] ?? ''

  if (verb.startsWith('-')) return refuse(`global git option ${verb} is not allowed`)
  const rest = args.slice(1)

  if (verb === 'remote') {
    return rest.length > 0 && rest.every(w => w === '-v' || w === '--verbose') ? OK : refuse('git remote is allowed only as "remote -v"')
  }

  if (!Object.hasOwn(SPECS, verb)) return refuse(`git ${verb} is not on the read-only allowlist`)

  return checkWords(verb, SPECS[verb] as Spec, rest)
}

// ------------------------------------------------------------------ the rest

const pathOk = (ctx: Ctx, tool: string, p: string | undefined): Verdict =>
  p !== undefined && isInside(ctx.root, p) ? OK : refuse(`${tool}: the path must be absolute and inside the project folder`)

export const checkArgv = (argv: unknown, ctx: Ctx): Verdict => {
  if (!Array.isArray(argv) || argv.length === 0) return refuse('no command given')

  for (const a of argv) {
    if (typeof a !== 'string' || a.includes('\0') || a.length > 1024) return refuse('arguments must be plain strings')
  }
  const [prog, ...rest] = argv as string[]

  switch (prog) {
    case 'git':
      return checkGit(rest)
    case 'lsof':
      return rest.length === 3 && rest[0] === '-nP' && rest[1] === '-iTCP' && rest[2] === '-sTCP:LISTEN' ? OK : refuse('lsof is allowed only as: lsof -nP -iTCP -sTCP:LISTEN')
    case 'ps':
      return rest.length === 2 && rest[0] === '-axo' && rest[1] === 'pid,comm,pcpu,pmem' ? OK : refuse('ps is allowed only as: ps -axo pid,comm,pcpu,pmem')
    case 'df':
      if (rest[0] !== '-k' || rest.length > 2) return refuse('df is allowed only as: df -k [path]')

      return rest.length === 1 ? OK : pathOk(ctx, 'df', rest[1])
    case 'du':
      if (rest.length === 2 && rest[0] === '-sk') return pathOk(ctx, 'du', rest[1])

      if (rest.length === 4 && rest[0] === '-k' && rest[1] === '-d' && /^[0-3]$/.test(rest[2] ?? '')) return pathOk(ctx, 'du', rest[3])

      return refuse('du is allowed only as: du -sk <path> or du -k -d <0-3> <path>')
    case 'ls': {
      const words = [...rest]
      let flag: string | undefined

      if (words[0]?.startsWith('-')) flag = words.shift()

      if (flag !== undefined && !/^-[1AalphF]{1,6}$/.test(flag)) return refuse('ls flags are limited to 1 A a l p h F')

      if (words.length > 1) return refuse('ls takes one path')

      return words.length === 0 ? OK : pathOk(ctx, 'ls', words[0])
    }
    case 'npm':
      if (rest.length !== 2 || rest[0] !== 'outdated' || rest[1] !== '--json') return refuse('npm is allowed only as: npm outdated --json')

      return ctx.isExplicit === true ? OK : refuse('npm outdated runs only when you type /adoutdated')
    case 'pip':
    case 'pip3':
      if (rest.length !== 4 || rest[0] !== 'list' || rest[1] !== '--outdated' || rest[2] !== '--format' || rest[3] !== 'json') {
        return refuse('pip is allowed only as: pip list --outdated --format json')
      }

      return ctx.isExplicit === true ? OK : refuse('pip list --outdated runs only when you type /adoutdated')
    default:
      return refuse(`${typeof prog === 'string' ? prog.slice(0, 40) : 'that program'} is not on the read-only allowlist`)
  }
}

export class Refused extends Error {
  constructor(reason: string) {
    super(`add-kit refused: ${reason}`)
    this.name = 'Refused'
  }
}

/** Prepended to every git call: no pager, no fsmonitor daemon, no quoting of non-ASCII names. */
const GIT_FIXED = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false'] as const

/** The vector to hand to `$.process.run`, or a throw. */
export const safeArgv = (argv: readonly string[], ctx: Ctx): string[] => {
  const v = checkArgv(argv, ctx)

  if (!v.ok) throw new Refused(v.reason)

  if (argv[0] === 'git') {
    const isDiffing = argv[1] === 'diff' || argv[1] === 'log'

    return ['git', ...GIT_FIXED, argv[1] as string, ...(isDiffing ? ['--no-ext-diff', '--no-textconv'] : []), ...argv.slice(2)]
  }

  return [...argv]
}

/** Environment for every call: no index-refresh writes, no prompts, no update notices, plain output. */
export const SAFE_ENV: Record<string, string> = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  LC_ALL: 'C',
  NO_COLOR: '1',
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_AUDIT: 'false',
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
}
