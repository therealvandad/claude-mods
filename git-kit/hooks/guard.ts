// The read-only allowlist for git. Pure: `checkGit` looks at an argument list (without the leading "git")
// and says whether every word of it is on a short list of reading verbs and flags. Nothing else may run.
// The wrapper in register.tsx calls `gitArgv`, which throws for anything refused, so a write verb never
// reaches `$.process.run`.

export type Verdict = { ok: true } | { ok: false; reason: string }

type Arity = 'none' | 'value' | 'attached'
type Spec = {
  flags: Record<string, Arity>
  paths: boolean
  digits?: boolean
  // Flags of which at least one must be present.
  needsOne?: readonly string[]
  // Positional words (not paths after `--`) are accepted only when one of these flags is present.
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
    '--all --decorate --no-decorate --reverse --follow --left-right --cherry-pick --cherry --no-color -p --patch ' +
    '-z --topo-order --date-order --abbrev-commit --no-abbrev-commit --ancestry-path --graph --branches --tags ' +
    '--remotes --no-patch -s --full-history --simplify-by-decoration --no-ext-diff --no-textconv --summary -i ' +
    '--regexp-ignore-case --all-match --invert-grep -m --check',
  '-n --max-count --skip --since --until --after --before --author --committer --grep --format --diff-filter -S -G',
  '--pretty --date --abbrev --color --decorate-refs --stat-width',
)

const DIFF_FLAGS = mk(
  '--stat --numstat --shortstat --name-only --name-status --cached --staged --check --no-color --no-ext-diff ' +
    '--no-textconv -p --patch -M -C --summary -z --ignore-space-change -b -w --ignore-all-space --minimal --compact-summary ' +
    '--no-index --no-renames --raw --exit-code --quiet --ignore-blank-lines --histogram --patience --no-patch -s',
  '--diff-filter',
  '--color --unified -U --dirstat --stat-width --stat-name-width --find-renames --abbrev',
)

const SPECS: Record<string, Spec> = {
  status: {
    flags: mk(
      '-s --short -b --branch -z --no-renames --renames --ahead-behind --no-ahead-behind --long --show-stash',
      '',
      '--porcelain -u --untracked-files --ignored --ignore-submodules',
    ),
    paths: true,
  },
  log: { flags: LOG_FLAGS, paths: true, digits: true },
  diff: { flags: DIFF_FLAGS, paths: true },
  branch: {
    flags: mk(
      '-a --all -r --remotes -v -vv --verbose --show-current --list --no-color',
      '--contains --no-contains --merged --no-merged --format --sort --points-at',
      '--color --abbrev',
    ),
    paths: false,
    positionalNeeds: ['--list'],
  },
  tag: {
    flags: mk(
      '-l --list --no-color',
      '--contains --no-contains --merged --no-merged --format --sort --points-at',
      '-n --color',
    ),
    paths: false,
    needsOne: ['-l', '--list'],
    positionalNeeds: ['-l', '--list'],
  },
  'for-each-ref': {
    flags: mk('', '--format --sort --count --merged --no-merged --contains --no-contains --points-at'),
    paths: true,
  },
  'rev-parse': {
    flags: mk(
      '--is-inside-work-tree --show-toplevel --git-dir --absolute-git-dir --verify --git-common-dir --show-prefix ' +
        '--symbolic-full-name --is-bare-repository --quiet -q --show-superproject-working-tree --is-shallow-repository',
      '--git-path',
      '--abbrev-ref --short --path-format',
    ),
    paths: true,
  },
  blame: {
    flags: mk(
      '--line-porcelain --porcelain -p -w -M -C -e --show-email -s -f --show-name -n --show-number -t --root --incremental',
      '-L --since',
      '--date --abbrev',
    ),
    paths: true,
  },
  'ls-files': {
    flags: mk(
      '-c --cached -d --deleted -m --modified -o --others -i --ignored -s --stage -u --unmerged -k --killed -z -t -v -f ' +
        '--exclude-standard --full-name --error-unmatch --directory --no-empty-directory --eol',
      '',
      '--abbrev',
    ),
    paths: true,
  },
  'check-ignore': { flags: mk('-v --verbose -n --non-matching -z --no-index -q --quiet'), paths: true },
  'merge-base': { flags: mk('--all --is-ancestor'), paths: false, positionalNeeds: [] },
  config: {
    flags: mk(
      '--get --get-all --get-regexp --local --global --system --worktree --bool --int --path --show-origin -z --null',
      '--default',
    ),
    paths: false,
    needsOne: ['--get', '--get-all', '--get-regexp'],
    positionalNeeds: ['--get', '--get-all', '--get-regexp'],
  },
}

const STASH_LIST: Spec = { flags: LOG_FLAGS, paths: false, digits: true, positionalNeeds: [] }
const STASH_SHOW: Spec = { flags: DIFF_FLAGS, paths: false }
const WORKTREE_LIST: Spec = { flags: mk('--porcelain -v --verbose -z'), paths: false }
const SUBMODULE_STATUS: Spec = { flags: mk('--recursive --cached'), paths: false }

const refuse = (reason: string): Verdict => ({ ok: false, reason })

const checkWords = (name: string, spec: Spec, words: readonly string[]): Verdict => {
  const present = (flag: string) => words.some(w => w === flag || w.startsWith(`${flag}=`))

  if (spec.needsOne && !spec.needsOne.some(present)) {
    return refuse(`git ${name} is allowed only with ${spec.needsOne.join(' or ')}`)
  }
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

      // -L10,20  -n5  -U3: a short flag with its value stuck on.
      if ((headKind === 'value' || headKind === 'attached') && !w.startsWith('--')) continue

      // -sb: a cluster of one-letter flags that take nothing.
      if (/^-[A-Za-z]{2,}$/.test(w) && [...w.slice(1)].every(c => (Object.hasOwn(spec.flags, `-${c}`) ? spec.flags[`-${c}`] : undefined) === 'none')) {
        continue
      }

      return refuse(`git ${name} ${w} is not on the read-only allowlist`)
    }

    // A positional word: a ref, a pattern or a key.
    if (spec.positionalNeeds !== undefined && spec.positionalNeeds.length > 0 && !spec.positionalNeeds.some(present)) {
      return refuse(`git ${name} ${w}: a name here would create or change something`)
    }

    if (!spec.paths && spec.positionalNeeds === undefined) {
      return refuse(`git ${name}: no positional words are accepted`)
    }
  }

  return { ok: true }
}

export const checkGit = (args: readonly string[]): Verdict => {
  if (!Array.isArray(args) || args.length === 0) return refuse('no git command given')

  for (const a of args) {
    if (typeof a !== 'string' || a.includes('\0')) return refuse('arguments must be plain strings')
  }
  const verb = args[0] ?? ''

  if (verb.startsWith('-')) return refuse(`global git option ${verb} is not allowed`)
  const rest = args.slice(1)

  if (verb === 'stash') {
    const sub = rest[0]

    if (sub === 'list') {
      return checkWords('stash list', STASH_LIST, rest.slice(1))
    }

    if (sub === 'show') {
      const r = checkWords('stash show', { ...STASH_SHOW, paths: false, positionalNeeds: [] }, rest.slice(1))

      return r
    }

    return refuse(`git stash ${sub ?? ''} is not allowed (only list and show)`)
  }

  if (verb === 'worktree') {
    return rest[0] === 'list' ? checkWords('worktree list', WORKTREE_LIST, rest.slice(1)) : refuse(`git worktree ${rest[0] ?? ''} is not allowed (only list)`)
  }

  if (verb === 'submodule') {
    return rest[0] === 'status'
      ? checkWords('submodule status', SUBMODULE_STATUS, rest.slice(1))
      : refuse(`git submodule ${rest[0] ?? ''} is not allowed (only status)`)
  }

  if (verb === 'remote') {
    return rest.length > 0 && rest.every(w => w === '-v' || w === '--verbose')
      ? { ok: true }
      : refuse('git remote is allowed only as "remote -v"')
  }

  if (verb === 'merge-tree') {
    // The legacy three-way form writes nothing. `--write-tree` writes objects: refused.
    const [flag, a, b, c, ...extra] = rest

    return flag === '--trivial-merge' && extra.length === 0 && [a, b, c].every(x => typeof x === 'string' && x !== '' && !x.startsWith('-'))
      ? { ok: true }
      : refuse('git merge-tree is allowed only as "merge-tree --trivial-merge <base> <a> <b>"')
  }

  if (verb === 'merge-base') {
    const r = checkWords('merge-base', SPECS['merge-base'] as Spec, rest)

    if (!r.ok) return r
    const refs = rest.filter(w => !w.startsWith('-'))

    return refs.length >= 2 && refs.length <= 3 ? { ok: true } : refuse('git merge-base needs two refs')
  }

  if (!Object.hasOwn(SPECS, verb)) return refuse(`git ${verb} is not on the read-only allowlist`)

  return checkWords(verb, SPECS[verb] as Spec, rest)
}

// Prepended to every call: no pager, no fsmonitor daemon, no quoting of non-ASCII names.
const FIXED = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false'] as const

export class GitRefused extends Error {
  constructor(reason: string) {
    super(`git-kit refused: ${reason}`)
    this.name = 'GitRefused'
  }
}

// The argument vector for `$.process.run`, or a throw. Diffs never run external drivers or text filters.
export const gitArgv = (args: readonly string[]): string[] => {
  const v = checkGit(args)

  if (!v.ok) throw new GitRefused(v.reason)
  const verb = args[0] as string
  const subAt = verb === 'stash' || verb === 'worktree' || verb === 'submodule' ? 2 : 1
  const isDiffing = verb === 'diff' || verb === 'log' || (verb === 'stash' && args[1] === 'show')
  const extra = isDiffing ? ['--no-ext-diff', '--no-textconv'] : []

  return ['git', ...FIXED, ...args.slice(0, subAt), ...extra, ...args.slice(subAt)]
}

// Environment for every call: no index refresh writes, no prompts, plain output.
export const GIT_ENV: Record<string, string> = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  LC_ALL: 'C.UTF-8',
}
