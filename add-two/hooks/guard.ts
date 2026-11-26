// The strict argv allowlist of add-two. Pure: `checkArgv` looks at a whole argument vector (argv[0] included) and
// says whether it is exactly one of the few read-only forms this mod uses. Anything else is refused, and the
// wrapper in register.tsx calls `safeArgv`, which throws, so a refused vector never reaches `$.process.run`.
//
// Two programs only: `git` (read verbs, fixed flag sets) and `du -sk`. No shell, no pipes, no other program.

export type Verdict = { ok: true } | { ok: false; reason: string }

const refuse = (reason: string): Verdict => ({ ok: false, reason })
const OK: Verdict = { ok: true }

/** The only `--format=` values a log may use. */
export const FORMATS: readonly string[] = ['%H|%P|%s|%D', '%h%x09%s']

const LOG_FLAGS: readonly string[] = ['--graph', '--oneline', '--decorate', '--no-color', '--no-merges']
const MAX_ARGS = 14
const MAX_LOG = 500
const MAX_DU_PATHS = 12

// A ref or tag name: no leading dash, no revision syntax (^ ~ : @{ ..), no path tricks.
const REF = /^[A-Za-z0-9][A-Za-z0-9._/+@-]{0,99}$/

export const isSafeRef = (s: string): boolean =>
  REF.test(s) && !s.includes('..') && !s.includes('//') && !s.includes('@{') && !s.endsWith('/') && !s.endsWith('.') && !s.endsWith('.lock')

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

const checkLog = (args: readonly string[]): Verdict => {
  let limit = false
  let format = false
  let positional = false

  for (let i = 0; i < args.length; i++) {
    const w = args[i] as string

    if (LOG_FLAGS.includes(w)) {
      continue
    }

    if (w === '-n') {
      const v = args[i + 1]

      if (limit || v === undefined || !/^[1-9]\d{0,3}$/.test(v) || Number(v) > MAX_LOG) {
        return refuse(`git log -n needs one number from 1 to ${MAX_LOG}`)
      }
      limit = true
      i++
      continue
    }

    if (w.startsWith('--format=')) {
      if (format || !FORMATS.includes(w.slice('--format='.length))) {
        return refuse('git log --format value is not on the list')
      }
      format = true
      continue
    }

    if (!w.startsWith('-')) {
      const range = /^(.+)\.\.HEAD$/.exec(w)
      const isRev = w === 'HEAD' || (range !== null && isSafeRef(range[1] as string))

      if (positional || !isRev) {
        return refuse(`git log word "${w.slice(0, 40)}" is not allowed (only HEAD or <ref>..HEAD)`)
      }
      positional = true
      continue
    }

    return refuse(`git log ${w.slice(0, 40)} is not on the read-only allowlist`)
  }

  return limit ? OK : refuse('git log needs -n <count>')
}

export const checkGit = (args: readonly string[]): Verdict => {
  const verb = args[0]

  if (verb === undefined) {
    return refuse('no git command given')
  }
  const rest = args.slice(1)

  switch (verb) {
    case 'log':
      return checkLog(rest)
    case 'tag':
      return same(rest, ['--list', '--merged', 'HEAD', '--sort=-v:refname']) ? OK : refuse('git tag is allowed only as "tag --list --merged HEAD --sort=-v:refname"')
    case 'status':
      return same(rest, ['--porcelain=v1']) || same(rest, ['--porcelain=v1', '-b']) ? OK : refuse('git status is allowed only as "status --porcelain=v1 [-b]"')
    case 'config':
      return same(rest, ['--get', 'remote.origin.url']) ? OK : refuse('git config is allowed only as "config --get remote.origin.url"')
    case 'rev-parse':
      return same(rest, ['--show-toplevel']) || same(rest, ['--abbrev-ref', 'HEAD']) ? OK : refuse('git rev-parse is allowed only as --show-toplevel or --abbrev-ref HEAD')
    default:
      return refuse(`git ${verb.slice(0, 40)} is not on the read-only allowlist`)
  }
}

const isCleanPath = (p: string) => p.startsWith('/') && p.length <= 1024 && !/[\0\n\r]/.test(p) && !p.split('/').includes('..')

export const checkDu = (args: readonly string[], root = ''): Verdict => {
  if (root === '' || !isCleanPath(root) || root === '/') {
    return refuse('du needs the working folder it may measure')
  }

  if (args[0] !== '-sk' || args[1] !== '--') {
    return refuse('du is allowed only as "du -sk -- <absolute paths>"')
  }
  const paths = args.slice(2)

  if (paths.length === 0 || paths.length > MAX_DU_PATHS) {
    return refuse(`du takes 1 to ${MAX_DU_PATHS} paths`)
  }

  const base = root.replace(/\/+$/, '')

  return paths.every(p => isCleanPath(p) && p.startsWith(`${base}/`)) ? OK : refuse('du paths must be absolute, inside the working folder, with no ".." and no control characters')
}

/** `root` is the working folder: the only place `du` may look. */
export const checkArgv = (argv: unknown, root = ''): Verdict => {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > MAX_ARGS) {
    return refuse('an argument vector of 1 to 14 strings is required')
  }

  for (const a of argv) {
    if (typeof a !== 'string' || a === '' || a.includes('\0')) {
      return refuse('arguments must be plain non-empty strings')
    }
  }
  const [prog, ...rest] = argv as string[]

  if (prog === 'git') {
    return checkGit(rest)
  }

  if (prog === 'du') {
    return checkDu(rest, root)
  }

  return refuse(`${String(prog).slice(0, 40)} is not on the allowlist (only git and du)`)
}

export class Refused extends Error {
  constructor(reason: string) {
    super(`add-two refused: ${reason}`)
    this.name = 'Refused'
  }
}

// No pager, no fsmonitor daemon, no quoting of non-ASCII names, no signature checks (gpg), no colour.
const FIXED = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-c', 'log.showSignature=false', '-c', 'color.ui=never'] as const

/** The vector for `$.process.run`, or a throw. */
export const safeArgv = (argv: readonly string[], root = ''): string[] => {
  const v = checkArgv(argv, root)

  if (!v.ok) {
    throw new Refused(v.reason)
  }

  return argv[0] === 'git' ? ['git', ...FIXED, ...argv.slice(1)] : [...argv]
}

export const RUN_ENV: Record<string, string> = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  LC_ALL: 'C.UTF-8',
}
