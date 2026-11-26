import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Cfg, Checkpoint, LogRow, Pending } from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]
type Input = Record<string, unknown>

const DEFAULT_CFG: Cfg = {
  dryrun: false,
  loopguard: true,
  hardBudget: null,
  autoCompact: false,
  checkpoint: false,
  precommit: null,
  protect: [],
  allow: {},
}

const cfgAtom = atom({ plugin: 'safety-pro', key: 'cfg' } as const, DEFAULT_CFG, { shape: 'cfg-1' })
const logAtom = atom({ plugin: 'safety-pro', key: 'log' } as const, [], { shape: 'log-1' })
const checkpointsAtom = atom({ plugin: 'safety-pro', key: 'checkpoints' } as const, [], { shape: 'checkpoints-1' })
const pendingAtom = atom({ plugin: 'safety-pro', key: 'pending' } as const, null, { shape: 'pending-1' })
const activityAtom = atom({ plugin: 'safety-pro', key: 'activity' } as const, [], { shape: 'activity-1' })
const filesAtom = atom({ plugin: 'safety-pro', key: 'files' } as const, [], { shape: 'files-1' })
const lastPromptAtom = atom({ plugin: 'safety-pro', key: 'lastPrompt' } as const, '')
const lastAnswerAtom = atom({ plugin: 'safety-pro', key: 'lastAnswer' } as const, '')
const lastCompactAtom = atom({ plugin: 'safety-pro', key: 'lastCompactAt' } as const, 0)

const LOG_PANE = 'safety-pro-log'
const LOG_CAP = 100
const COMPACT_PERCENT = 85
const COMPACT_GAP_MS = 10 * 60_000
const PENDING_TTL_MS = 10 * 60_000
const MAX_RESTORE_FILES = 500
const LOOP_LIMIT = 4
const EDIT_TOOLS = /^(Edit|Write|NotebookEdit)$/

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'claude-checkpoint',
  GIT_AUTHOR_EMAIL: 'checkpoint@localhost',
  GIT_COMMITTER_NAME: 'claude-checkpoint',
  GIT_COMMITTER_EMAIL: 'checkpoint@localhost',
}

// ---------------------------------------------------------------------------
// Pure helpers (no `$`)
// ---------------------------------------------------------------------------

const collapse = (text: string) => text.trim().replace(/\s+/g, ' ')

const escapeRe = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

const globToRe = (glob: string) =>
  new RegExp(
    `^${glob
      .split('**')
      .map(part => part.split('*').map(escapeRe).join('[^/]*'))
      .join('.*')}$`,
  )

const normPath = (path: string, cwd: string) => {
  const abs = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`
  const out: string[] = []

  for (const seg of abs.split('/')) {
    if (seg === '' || seg === '.') {
      continue
    }

    if (seg === '..') {
      out.pop()
    } else {
      out.push(seg)
    }
  }

  return `/${out.join('/')}`
}

/** Returns the first protected entry that `target` falls under, or undefined. */
const protectedHit = (target: string, entries: readonly string[], cwd: string): string | undefined => {
  const path = normPath(target, cwd)
  const segments = path.split('/').filter(s => s !== '')

  for (const raw of entries) {
    const entry = raw.trim()

    if (entry === '' || entry.startsWith('#')) {
      continue
    }
    const bare = entry.replace(/\/+$/, '')

    if (!bare.includes('/')) {
      const re = globToRe(bare)

      if (segments.some(seg => re.test(seg))) {
        return entry
      }
      continue
    }
    const base = normPath(bare, cwd)

    if (!base.includes('*')) {
      if (path === base || path.startsWith(`${base}/`)) {
        return entry
      }
      continue
    }
    const re = globToRe(base)

    for (let i = 1; i <= segments.length; i++) {
      if (re.test(`/${segments.slice(0, i).join('/')}`)) {
        return entry
      }
    }
  }

  return undefined
}

const parseEntries = (text: string) =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))

const BENIGN_REDIRECTS = /(\d?>&\d|&?>\s*\/dev\/null|\d>\s*\/dev\/null|\d>&-)/g

const stripBenign = (command: string) => command.replace(BENIGN_REDIRECTS, ' ')

/** Operators that could chain a second, unlisted command after an allowed prefix. */
const CHAINING = /[;&|`<>\n\r]|\$\(|\$\{/

const hasChaining = (command: string) => CHAINING.test(stripBenign(command))

const prefixMatches = (command: string, prefix: string) => {
  const cmd = collapse(command)
  const pre = collapse(prefix)

  if (pre === '' || !(cmd === pre || cmd.startsWith(`${pre} `))) {
    return false
  }

  return !hasChaining(cmd)
}

const isAllowed = (command: string, prefixes: readonly string[]) => prefixes.some(p => prefixMatches(command, p))

const MUTATING_WORD =
  /(^|[;&|(`])\s*((sudo|command|exec|time|nohup|then|do|else|env)\s+)*(rm|rmdir|mv|cp|touch|mkdir|tee|truncate|chmod|chown|chgrp|ln|dd|kill|pkill|killall|patch|shred|unlink|rsync|sudo|eval|xargs|wget)(\s|$)/
const MUTATING_PATTERNS: readonly RegExp[] = [
  /\bsed\s+(-[a-zA-Z]*i|--in-place)/,
  /\bfind\b[^|;&]*\s(-delete|-exec)\b/,
  /\bperl\s+-[a-zA-Z]*i/,
  /\b(ba|z)?sh\s+-c\b/,
  /\bgit\s+(-C\s+\S+\s+)?(add|commit|push|pull|checkout|switch|reset|rebase|merge|clean|stash|restore|cherry-pick|revert|rm|mv|tag|am|apply|worktree|submodule|update-ref|gc|prune|branch\s+-[dDmM])\b/,
  /\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|rm|uninstall|publish|ci|link|update|up|dedupe)\b/,
  /\bpip3?\s+(install|uninstall)\b/,
  /\bbrew\s+(install|uninstall|upgrade|remove)\b/,
  /\bdocker\s+(run|rm|rmi|build|compose|push|stop|kill|exec)\b/,
  /\bcurl\b[^|;&]*\s(-[a-zA-Z]*[oO]\b|--output|--remote-name)/,
]

const isMutating = (command: string) => {
  const cmd = stripBenign(command)

  return MUTATING_WORD.test(cmd) || MUTATING_PATTERNS.some(p => p.test(cmd)) || cmd.includes('>')
}

const isCommit = (command: string) => /\bgit\b[^;&|\n]*\bcommit\b/.test(command)

const stable = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>

    return `{${Object.keys(obj)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(',')}}`
  }

  return JSON.stringify(value) ?? 'undefined'
}

const loopKeyOf = (input: Input) => {
  const { tool_use_id: _id, consent: _consent, ...rest } = input

  return stable(rest)
}

const pathOf = (input: Input) => String(input.file_path ?? input.notebook_path ?? '')

const detailOf = (input: Input) =>
  String(input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)

const usd = (n: number) => `$${n.toFixed(2)}`

const tail = (text: string, max = 2500) => (text.length > max ? `...${text.slice(-max)}` : text)

const parseNameStatus = (out: string) => {
  const parts = out.split('\0').filter(p => p !== '')
  const rows: { status: string; path: string }[] = []

  for (let i = 0; i + 1 < parts.length; i += 2) {
    rows.push({ status: (parts[i] ?? '?').slice(0, 1), path: parts[i + 1] ?? '' })
  }

  return rows
}

const clockText = (ms: number) => new Date(ms).toISOString().slice(11, 19)

// Loop history is per conversation turn run, so it lives outside the render state.
let loop = { key: '', count: 0 }

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

const saveCfg = async ($: Dollar, change: (c: Cfg) => Cfg) => {
  await update($, cfgAtom, change)
  await $.store.set('cfg', await read($, cfgAtom))
}

const cwdOf = ($: Dollar) => $.session.cwd().catch(() => '/')

const logRow = async ($: Dollar, kind: LogRow['kind'], rule: string, tool: string, detail: string, reason: string) => {
  const row: LogRow = { at: await $.clock.now(), kind, rule, tool, detail, reason: reason.slice(0, 400) }
  await update($, logAtom, list => [...list, row].slice(-LOG_CAP))
  await $.store.set('log', await read($, logAtom)).catch(() => undefined)
}

const refuse = async ($: Dollar, rule: string, tool: string, detail: string, reason: string) => {
  await logRow($, 'deny', rule, tool, detail, reason)
  $.ui.toast(`safety-pro (${rule}): ${reason.slice(0, 90)}`, { timeoutMs: 5000 })

  return `${$.plugin.name}: ${reason}`
}

const loadProtected = async ($: Dollar, cfg: Cfg) => {
  const text = await $.fs.read(`${$.plugin.root}/protected-paths.txt`).catch(() => '')

  return [...parseEntries(typeof text === 'string' ? text : ''), ...cfg.protect]
}

/** The first protected entry hit by the path, by spelling or where a link leads. */
const checkPath = async ($: Dollar, path: string, entries: readonly string[], cwd: string) => {
  const direct = protectedHit(path, entries, cwd)

  if (direct !== undefined) {
    return direct
  }
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)

  return stat?.realPath === undefined ? undefined : protectedHit(stat.realPath, entries, cwd)
}

// ---------------------------------------------------------------------------
// The gate: every tool call passes through here, first deny wins
// ---------------------------------------------------------------------------

const gate = async ($: Dollar, input: Input): Promise<string | undefined> => {
  const tool = String(input.tool ?? '')
  const detail = detailOf(input)
  const cfg = await read($, cfgAtom)

  await update($, activityAtom, list => [...list, `${tool} ${detail}`.trim()].slice(-30))

  if (cfg.hardBudget !== null) {
    const spent = (await $.session.usage()).cost?.usd ?? 0

    if (spent > cfg.hardBudget) {
      return refuse(
        $,
        'hardbudget',
        tool,
        detail,
        `hard budget reached (${usd(spent)} spent, limit ${usd(cfg.hardBudget)}). Every tool call is blocked. Stop, tell the user, and wait: they can raise the limit with /hardbudget <usd> or clear it with /hardbudget off.`,
      )
    }
  }

  if (cfg.loopguard) {
    const key = loopKeyOf(input)
    loop = key === loop.key ? { key, count: loop.count + 1 } : { key, count: 1 }

    if (loop.count >= LOOP_LIMIT) {
      return refuse(
        $,
        'loopguard',
        tool,
        detail,
        `stuck loop: this exact ${tool} call with identical input was already made ${loop.count - 1} times in a row. Do not repeat it. Try a different approach (another command or file, read the earlier output carefully), or ask the user.`,
      )
    }
  }

  const isEdit = EDIT_TOOLS.test(tool)
  const command = tool === 'Bash' ? String(input.command ?? '') : ''

  if (isEdit || (tool === 'Bash' && isMutating(command))) {
    const cwd = await cwdOf($)
    const entries = await loadProtected($, cfg)

    if (entries.length > 0) {
      const targets = isEdit
        ? [pathOf(input)].filter(p => p !== '')
        : command
            .split(/[\s;&|<>()]+/)
            .map(t => t.replace(/^['"]|['"]$/g, ''))
            .filter(t => t !== '' && !t.startsWith('-'))

      for (const target of targets) {
        const hit = await checkPath($, target, entries, cwd)

        if (hit !== undefined) {
          return refuse(
            $,
            'protected',
            tool,
            detail,
            `${target} is on the protected paths list (${hit}). Do not change it. Ask the user to edit it, or to run /protect rm ${hit}.`,
          )
        }
      }
    }
  }

  if (cfg.dryrun && (isEdit || (tool === 'Bash' && isMutating(command)))) {
    const cwd = await cwdOf($)
    const prefixes = cfg.allow[cwd] ?? []

    if (tool === 'Bash' && isAllowed(command, prefixes)) {
      await logRow($, 'allow', 'allowlist', tool, detail, 'on the allowlist, so dry-run did not hold it')
    } else {
      return refuse(
        $,
        'dryrun',
        tool,
        detail,
        `dry-run is on, so this ${isEdit ? 'edit' : 'command'} was NOT executed. Describe exactly what you would do instead (the ${isEdit ? 'file and the change' : 'command'} and its expected effect) and let the user decide. The user can run /dryrun off to let it run.`,
      )
    }
  }

  if (tool === 'Bash' && cfg.precommit !== null && isCommit(command)) {
    let result: Awaited<ReturnType<Dollar['process']['run']>> | undefined
    let failure = ''

    try {
      result = await $.process.run(['sh', '-c', cfg.precommit], { timeoutMs: 300_000 })
    } catch (err) {
      failure = String(err)
    }

    if (result === undefined) {
      return refuse($, 'precommit', tool, detail, `the pre-commit check could not run (${failure}), so the commit was held.`)
    }
    if (result.exitCode !== 0) {
      return refuse(
        $,
        'precommit',
        tool,
        detail,
        `pre-commit check failed (exit ${result.exitCode}): ${cfg.precommit}\n${tail(`${result.stdout}\n${result.stderr}`.trim())}\nFix the failures, then commit again.`,
      )
    }
    await logRow($, 'allow', 'precommit', tool, detail, `pre-commit check passed: ${cfg.precommit}`)
  }

  if (EDIT_TOOLS.test(tool)) {
    const path = pathOf(input)

    if (path !== '') {
      await update($, filesAtom, list => (list.includes(path) ? list : [...list, path]).slice(-100))
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Checkpoints (git stash create under a private ref; never touches tree or branch)
// ---------------------------------------------------------------------------

const git = ($: Dollar, args: string[], cwd?: string) =>
  $.process.run(['git', ...args], { timeoutMs: 30_000, env: GIT_ENV, ...(cwd === undefined ? {} : { cwd }) })

const takeSnapshot = async (
  $: Dollar,
  label: string,
): Promise<{ cp?: Checkpoint; isNew?: boolean; note: string }> => {
  const inside = await git($, ['rev-parse', '--is-inside-work-tree'])

  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
    return { note: 'not inside a git repository' }
  }
  const head = await git($, ['rev-parse', '--verify', 'HEAD'])
  const created = await git($, ['stash', 'create', `claude checkpoint: ${label}`])
  const stashSha = created.exitCode === 0 ? created.stdout.trim() : ''
  const sha = stashSha !== '' ? stashSha : head.exitCode === 0 ? head.stdout.trim() : ''

  if (sha === '') {
    return { note: `nothing to snapshot (${created.stderr.trim() || 'no commits and no tracked changes'})` }
  }
  const tree = (await git($, ['rev-parse', `${sha}^{tree}`])).stdout.trim()
  const list = await read($, checkpointsAtom)
  const last = list[list.length - 1]
  const at = await $.clock.now()

  if (last !== undefined && last.tree === tree) {
    return { cp: { ...last, at, label }, isNew: false, note: `unchanged since checkpoint #${last.n}` }
  }
  const refs = await git($, ['for-each-ref', '--format=%(refname)', 'refs/claude-checkpoints/'])
  const used = refs.stdout
    .split('\n')
    .map(r => Number(r.trim().split('/').pop()))
    .filter(n => Number.isFinite(n) && n > 0)
  const n = Math.max(0, ...used) + 1
  const ref = `refs/claude-checkpoints/${n}`
  const made = await git($, ['update-ref', ref, sha])

  if (made.exitCode !== 0) {
    return { note: `could not write ${ref}: ${made.stderr.trim()}` }
  }

  return { cp: { n, ref, sha, tree, at, label }, isNew: true, note: `checkpoint #${n} saved at ${ref}` }
}

const saveCheckpoints = async ($: Dollar, cwd: string) =>
  $.store.set(`cp:${cwd}`, await read($, checkpointsAtom)).catch(() => undefined)

const recordSnapshot = async ($: Dollar, label: string) => {
  const snap = await takeSnapshot($, label)

  if (snap.cp !== undefined) {
    const cp = snap.cp
    await update($, checkpointsAtom, list => [...list, cp].slice(-50))
    await saveCheckpoints($, await cwdOf($))
  }

  return snap
}

const diffAgainst = async ($: Dollar, sha: string, top: string) => {
  const out = await git($, ['diff', '--no-renames', '--name-status', '-z', sha], top)

  if (out.exitCode !== 0) {
    throw new Error(`git diff failed: ${out.stderr.trim()}`)
  }
  const rows = parseNameStatus(out.stdout)

  return {
    overwrite: rows.filter(r => r.status !== 'A'),
    untouched: rows.filter(r => r.status === 'A'),
  }
}

const describeRow = (r: { status: string; path: string }) =>
  `  ${r.status === 'D' ? 'D (deleted since, will be recreated)' : 'M (changed since, your current content is replaced)'}  ${r.path}`

const rollbackPreview = async ($: Dollar): Promise<string> => {
  const list = await read($, checkpointsAtom)
  const target = list[list.length - 2]

  if (target === undefined) {
    return 'Rollback needs at least two checkpoints (a baseline and one finished turn). Turn them on with /snapshot on.'
  }
  const top = (await git($, ['rev-parse', '--show-toplevel'])).stdout.trim()

  if (top === '') {
    return 'Rollback: not inside a git repository.'
  }
  const exists = await git($, ['cat-file', '-e', `${target.sha}^{commit}`], top)

  if (exists.exitCode !== 0) {
    return `Rollback: checkpoint #${target.n} (${target.ref}) is gone from this repository, so nothing can be restored.`
  }
  const { overwrite, untouched } = await diffAgainst($, target.sha, top)

  await update($, pendingAtom, () => null)

  if (overwrite.length === 0) {
    return `The last turn changed no tracked files compared with checkpoint #${target.n} (${target.label}). Nothing to restore.`
  }

  if (overwrite.length > MAX_RESTORE_FILES) {
    return `Rollback would touch ${overwrite.length} files, over the ${MAX_RESTORE_FILES} limit. Restore by hand from ${target.ref}.`
  }
  const pending: Pending = {
    n: target.n,
    ref: target.ref,
    sha: target.sha,
    top,
    files: overwrite.map(r => r.path),
    at: await $.clock.now(),
  }
  await update($, pendingAtom, () => pending)

  return [
    `Rollback preview: restore to checkpoint #${target.n} (${target.label}, ${target.ref}).`,
    `${overwrite.length} file(s) will be OVERWRITTEN:`,
    ...overwrite.map(describeRow),
    ...(untouched.length > 0
      ? [`Not touched (not in that checkpoint, nothing is deleted): ${untouched.map(r => r.path).join(', ')}`]
      : []),
    'Untracked files are never snapshotted and never removed. Before overwriting, the current state is saved to a new checkpoint ref so it can be recovered.',
    'Nothing has been changed yet. Run /rollback confirm to apply exactly this list (it expires in 10 minutes).',
  ].join('\n')
}

const rollbackConfirm = async ($: Dollar): Promise<string> => {
  const pending = await read($, pendingAtom)

  if (pending === null) {
    return 'Nothing to confirm. Run /rollback first to see which files would be overwritten.'
  }
  const now = await $.clock.now()
  await update($, pendingAtom, () => null)

  if (now - pending.at > PENDING_TTL_MS) {
    return 'That preview expired. Run /rollback again.'
  }
  const { overwrite } = await diffAgainst($, pending.sha, pending.top)
  const before = pending.files.join('\0')
  const after = overwrite.map(r => r.path).join('\0')

  if (before !== after) {
    return 'The files changed since the preview, so nothing was restored. Run /rollback again to see the new list.'
  }
  const safety = await recordSnapshot($, `before rollback to #${pending.n}`)

  if (safety.cp === undefined) {
    return `Nothing was restored: could not save the current state first (${safety.note}).`
  }
  const restored = await git(
    $,
    ['restore', `--source=${pending.sha}`, '--worktree', '--', ...pending.files.map(f => `:(literal)${f}`)],
    pending.top,
  )

  if (restored.exitCode !== 0) {
    return `Restore failed: ${restored.stderr.trim()}`
  }
  await update($, checkpointsAtom, list => list.slice(0, -2))
  await saveCheckpoints($, await cwdOf($))
  await logRow($, 'info', 'rollback', 'git', `restored ${pending.files.length} files`, `rolled back to checkpoint #${pending.n}`)

  return `Restored ${pending.files.length} file(s) from checkpoint #${pending.n}. The state just before is saved at ${safety.cp.ref}.`
}

// ---------------------------------------------------------------------------
// After each turn: remember the answer, checkpoint, auto-compact
// ---------------------------------------------------------------------------

const compactLater = async ($: Dollar, percent: number) => {
  $.ui.toast(`Context is ${percent}% full: auto-compacting shortly.`, { timeoutMs: 6000 })
  let result = 'failed'

  for (let attempt = 0; attempt < 4; attempt++) {
    await $.clock.sleep(attempt === 0 ? 1500 : 3000)
    const done = await $.session.compact().catch(() => undefined)

    if (done !== undefined) {
      result = 'skip' in done && done.skip !== undefined ? 'skipped' : 'done'
      break
    }
  }
  $.ui.toast(
    result === 'done' ? 'Auto-compact finished.' : `Auto-compact ${result}. Run /compact yourself if the context is still full.`,
    { timeoutMs: 6000 },
  )
}

const afterTurn = async ($: Dollar, answer: string) => {
  await update($, lastAnswerAtom, () => answer.slice(0, 1500))
  const cfg = await read($, cfgAtom)

  if (cfg.checkpoint) {
    const snap = await recordSnapshot($, `turn ${(await read($, checkpointsAtom)).length}`)

    if (snap.isNew === true) {
      $.ui.toast(snap.note, { timeoutMs: 3000 })
    }
  }

  if (cfg.autoCompact) {
    const { context } = await $.session.usage()
    const percent = context.percent ?? 0
    const now = await $.clock.now()
    const last = await read($, lastCompactAtom)

    if (percent >= COMPACT_PERCENT && (last === 0 || now - last >= COMPACT_GAP_MS)) {
      await update($, lastCompactAtom, () => now)
      void compactLater($, percent).catch(() => undefined)
    }
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const COMMANDS = [
  ['allow', 'Per-project allowlist: /allow <command-prefix> | list | rm <prefix> | add <prefix>', '<prefix | list | rm prefix>'],
  ['dryrun', 'Hold mutating commands and edits so the model describes them instead: on | off', '<on|off>'],
  ['snapshot', 'Opt-in checkpoint after each turn under refs/claude-checkpoints: on | off | now | list', '<on|off|now|list>'],
  ['rollback', 'Restore files from the previous checkpoint: preview first, then /rollback confirm', '<confirm>'],
  ['hardbudget', 'Hard spend stop in dollars: /hardbudget <usd> | off', '<usd|off>'],
  ['safecompact', 'Auto-compact at 85% context, at most every 10 minutes: on | off', '<on|off>'],
  ['loopguard', 'Deny the 4th identical consecutive tool call: on | off', '<on|off>'],
  ['protect', 'Protect paths from Edit and Write: /protect <path> | list | rm <path>', '<path | list | rm path>'],
  ['safetylog', 'Open the safety log pane (blocks and allows with reasons): /safetylog clear', '<clear>'],
  ['precommit', 'Run a check before the model may git commit: /precommit <command> | off', '<command|off>'],
  ['handoff', 'Write a session handoff note (kept in the mod store) and fill the prompt: /handoff show', '<show>'],
] as const

const onOff = (args: string): boolean | undefined => {
  const word = args.trim().toLowerCase()

  return word === 'on' ? true : word === 'off' ? false : undefined
}

const handoffNote = async ($: Dollar): Promise<string> => {
  const cwd = await cwdOf($)
  const cfg = await read($, cfgAtom)
  const usage = await $.session.usage()
  const now = await $.clock.now()
  const branch = await git($, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined)
  const status = await git($, ['status', '--short']).catch(() => undefined)
  const changed = status?.exitCode === 0 ? status.stdout.split('\n').filter(l => l !== '').slice(0, 20) : []
  const files = await read($, filesAtom)
  const activity = await read($, activityAtom)
  const checkpoints = await read($, checkpointsAtom)
  const lastPrompt = await read($, lastPromptAtom)
  const lastAnswer = await read($, lastAnswerAtom)
  const active = [
    cfg.dryrun && 'dry-run on',
    cfg.hardBudget !== null && `hard budget ${usd(cfg.hardBudget)}`,
    cfg.precommit !== null && `pre-commit check: ${cfg.precommit}`,
    cfg.checkpoint && `checkpoints on (${checkpoints.length})`,
  ].filter(Boolean)

  return [
    '# Session handoff',
    `Written: ${new Date(now).toISOString()}`,
    `Project: ${cwd}${branch?.exitCode === 0 ? ` (branch ${branch.stdout.trim()})` : ''}`,
    `Session: ${Math.round((now - usage.startedAt) / 60_000)} min, ${usage.cost?.usd === undefined ? 'cost n/a' : `${usd(usage.cost.usd)} spent`}, context ${usage.context.percent ?? '?'}% full`,
    '',
    '## Last request',
    lastPrompt === '' ? '(none recorded)' : lastPrompt.slice(0, 400),
    '',
    '## Where it stopped (tail of the last answer)',
    lastAnswer === '' ? '(none recorded)' : tail(lastAnswer, 600),
    '',
    '## Files edited this session',
    ...(files.length === 0 ? ['(none)'] : files.slice(-15).map(f => `- ${f}`)),
    '',
    '## Uncommitted changes (git status --short)',
    ...(changed.length === 0 ? ['(clean or not a git repo)'] : changed.map(l => `    ${l}`)),
    '',
    '## Recent tool calls',
    ...(activity.length === 0 ? ['(none)'] : activity.slice(-10).map(a => `- ${a}`)),
    '',
    `## Safety settings: ${active.length === 0 ? 'defaults' : active.join(', ')}`,
    ...(checkpoints.length > 1 ? [`Rollback is available: ${checkpoints.length} checkpoints, newest ${checkpoints[checkpoints.length - 1]?.ref}.`] : []),
  ].join('\n')
}

// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description, argumentHint] of COMMANDS) {
      await $.command.register({ name, description, argumentHint }).catch(() => undefined)
    }
    const saved = await $.store.get('cfg').catch(() => undefined)

    if (saved !== null && typeof saved === 'object') {
      await update($, cfgAtom, () => ({ ...DEFAULT_CFG, ...(saved as Partial<Cfg>) }))
    }
    const savedLog = await $.store.get('log').catch(() => undefined)

    if (Array.isArray(savedLog)) {
      await update($, logAtom, () => savedLog as LogRow[])
    }
    const savedCp = await $.store.get(`cp:${e.cwd}`).catch(() => undefined)

    if (Array.isArray(savedCp)) {
      await update($, checkpointsAtom, () => savedCp as Checkpoint[])
    }
    loop = { key: '', count: 0 }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined) {
      loop = { key: '', count: 0 }
      await update($, lastPromptAtom, () => e.text.slice(0, 400))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const reason = await gate($, e as unknown as Input)

    return reason === undefined ? next(e) : { deny: reason }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its safety check failed, so the call was held.` },
  )

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId === undefined) {
      await afterTurn($, e.answer).catch(() => undefined)
    }

    return out
  })

  on('command.run', { command: 'dryrun' }, async ($, e) => {
    const flag = onOff(e.args)

    if (flag === undefined) {
      return { text: `Dry-run is ${(await read($, cfgAtom)).dryrun ? 'ON' : 'off'}. Use /dryrun on or /dryrun off.` }
    }
    await saveCfg($, c => ({ ...c, dryrun: flag }))

    return {
      text: flag
        ? 'Dry-run ON: mutating shell commands and file edits are held and the model must describe them instead. /allow <prefix> exempts a command.'
        : 'Dry-run off.',
    }
  })

  on('command.run', { command: 'loopguard' }, async ($, e) => {
    const flag = onOff(e.args)

    if (flag === undefined) {
      return { text: `Loop guard is ${(await read($, cfgAtom)).loopguard ? 'ON' : 'off'}. Use /loopguard on or off.` }
    }
    await saveCfg($, c => ({ ...c, loopguard: flag }))
    loop = { key: '', count: 0 }

    return { text: flag ? `Loop guard ON: the ${LOOP_LIMIT}th identical consecutive call is denied.` : 'Loop guard off.' }
  })

  on('command.run', { command: 'safecompact' }, async ($, e) => {
    const flag = onOff(e.args)

    if (flag === undefined) {
      return { text: `Auto-compact is ${(await read($, cfgAtom)).autoCompact ? 'ON' : 'off'}. Use /safecompact on or off.` }
    }
    await saveCfg($, c => ({ ...c, autoCompact: flag }))

    return {
      text: flag
        ? `Auto-compact ON: after a turn ends with context at ${COMPACT_PERCENT}% or more, the conversation is compacted (at most once per 10 minutes).`
        : 'Auto-compact off.',
    }
  })

  on('command.run', { command: 'hardbudget' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace('$', '')
    const cfg = await read($, cfgAtom)

    if (arg === '') {
      const spent = (await $.session.usage()).cost?.usd
      const cap = cfg.hardBudget

      return { text: `Hard budget: ${cap === null ? 'not set' : usd(cap)}. Spent so far: ${spent === undefined ? 'n/a' : usd(spent)}. Usage: /hardbudget <usd> or /hardbudget off.` }
    }

    if (arg === 'off' || arg === 'clear') {
      await saveCfg($, c => ({ ...c, hardBudget: null }))

      return { text: 'Hard budget cleared. Tool calls are no longer capped by spend.' }
    }
    const value = Number(arg)

    if (!Number.isFinite(value) || value <= 0) {
      return { text: 'Usage: /hardbudget <usd> (a positive number) or /hardbudget off.' }
    }
    await saveCfg($, c => ({ ...c, hardBudget: value }))
    const spent = (await $.session.usage()).cost?.usd ?? 0

    return {
      text: `Hard budget set to ${usd(value)}. ${spent > value ? `Already over (${usd(spent)} spent): every tool call is blocked until you raise it.` : `${usd(spent)} spent so far.`}`,
    }
  })

  on('command.run', { command: 'allow' }, async ($, e) => {
    const cwd = await cwdOf($)
    const args = collapse(e.args)
    const list = (await read($, cfgAtom)).allow[cwd] ?? []
    const setList = (next: string[]) => saveCfg($, c => ({ ...c, allow: { ...c.allow, [cwd]: next } }))

    if (args === '' || args === 'list') {
      return {
        text:
          list.length === 0
            ? `No allowed prefixes for ${cwd}. Add one with /allow <command-prefix>.`
            : `Allowed prefixes for ${cwd} (exempt from dry-run only; tool-guard still applies):\n${list.map(p => `  ${p}`).join('\n')}`,
      }
    }
    const removing = /^rm\s+(.+)$/.exec(args)

    if (removing !== null) {
      const prefix = collapse(removing[1] ?? '')

      if (!list.includes(prefix)) {
        return { text: `"${prefix}" is not on the allowlist. (To allow a command that itself starts with rm, use /allow add rm ...)` }
      }
      await setList(list.filter(p => p !== prefix))

      return { text: `Removed "${prefix}" from the allowlist.` }
    }
    const prefix = collapse(args.replace(/^add\s+/, ''))

    if (hasChaining(prefix) || prefix.length < 2) {
      return { text: 'A prefix must be a plain command start without ; & | < > ` or $( ... ). Example: /allow npm test' }
    }

    if (list.includes(prefix)) {
      return { text: `"${prefix}" is already allowed.` }
    }
    await setList([...list, prefix])

    return { text: `Allowed "${prefix}" for this project: commands that start with it (and chain nothing else) skip dry-run holds. tool-guard's hard blocks still apply.` }
  })

  on('command.run', { command: 'protect' }, async ($, e) => {
    const cwd = await cwdOf($)
    const args = e.args.trim()
    const cfg = await read($, cfgAtom)

    if (args === '' || args === 'list') {
      const fileEntries = await $.fs
        .read(`${$.plugin.root}/protected-paths.txt`)
        .then(t => parseEntries(String(t)))
        .catch(() => [] as string[])

      return {
        text: [
          `Protected paths (file: ${$.plugin.root}/protected-paths.txt):`,
          ...(fileEntries.length === 0 ? ['  (none in the file)'] : fileEntries.map(p => `  ${p}`)),
          `Added with /protect (${cfg.protect.length}):`,
          ...(cfg.protect.length === 0 ? ['  (none)'] : cfg.protect.map(p => `  ${p}`)),
        ].join('\n'),
      }
    }
    const removing = /^rm\s+(.+)$/.exec(args)

    if (removing !== null) {
      const path = (removing[1] ?? '').trim()

      if (!cfg.protect.includes(path)) {
        return { text: `"${path}" was not added with /protect. Entries from protected-paths.txt are edited in that file.` }
      }
      await saveCfg($, c => ({ ...c, protect: c.protect.filter(p => p !== path) }))

      return { text: `Unprotected ${path}.` }
    }

    if (cfg.protect.includes(args)) {
      return { text: `${args} is already protected.` }
    }
    await saveCfg($, c => ({ ...c, protect: [...c.protect, args] }))

    return { text: `Protected ${args} (resolved against ${cwd}): Edit and Write on it are denied.` }
  })

  on('command.run', { command: 'precommit' }, async ($, e) => {
    const args = e.args.trim()
    const cfg = await read($, cfgAtom)

    if (args === '') {
      return { text: cfg.precommit === null ? 'No pre-commit check set. Use /precommit <command>, for example /precommit npm test.' : `Pre-commit check: ${cfg.precommit}` }
    }

    if (args === 'off') {
      await saveCfg($, c => ({ ...c, precommit: null }))

      return { text: 'Pre-commit check off.' }
    }
    await saveCfg($, c => ({ ...c, precommit: args }))

    return { text: `Pre-commit check set: "${args}" runs (via sh -c, in the project folder) before the model's git commit; a failure denies the commit.` }
  })

  on('command.run', { command: 'snapshot' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const list = await read($, checkpointsAtom)
    const cfg = await read($, cfgAtom)

    if (arg === 'on') {
      const snap = await recordSnapshot($, 'baseline')

      if (snap.cp === undefined) {
        return { text: `Checkpoints not enabled: ${snap.note}.` }
      }
      await saveCfg($, c => ({ ...c, checkpoint: true }))

      return { text: `Checkpoints ON. Baseline: ${snap.note}. After each turn a snapshot of tracked files is saved under refs/claude-checkpoints/ (working tree and branch untouched, nothing pushed). /rollback restores the previous one.` }
    }

    if (arg === 'off') {
      await saveCfg($, c => ({ ...c, checkpoint: false }))

      return { text: 'Checkpoints off. Existing refs/claude-checkpoints/* are kept; delete them yourself with git update-ref -d if you want.' }
    }

    if (arg === 'now') {
      const snap = await recordSnapshot($, 'manual')

      return { text: snap.cp === undefined ? `No snapshot: ${snap.note}.` : `Snapshot: ${snap.note}.` }
    }

    return {
      text: [
        `Checkpoints are ${cfg.checkpoint ? 'ON' : 'off'} (${list.length} recorded).`,
        ...list.slice(-10).map(c => `  #${c.n} ${c.label} ${clockText(c.at)} ${c.ref}`),
        'Usage: /snapshot on | off | now. Tracked files only (git stash create); untracked files are not captured.',
      ].join('\n'),
    }
  })

  on('command.run', { command: 'rollback' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    try {
      return { text: arg === 'confirm' ? await rollbackConfirm($) : await rollbackPreview($) }
    } catch (err) {
      return { text: `Rollback stopped, nothing was changed: ${String(err)}` }
    }
  })

  on('command.run', { command: 'safetylog' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, logAtom, () => [])
      await $.store.set('log', []).catch(() => undefined)

      return { text: 'Safety log cleared.' }
    }
    await $.ui.open({ id: LOG_PANE, title: 'Safety log' }).catch(() => undefined)
    const rows = (await read($, logAtom)).slice(-5)

    return {
      text:
        rows.length === 0
          ? 'Safety log opened. Nothing has been blocked yet.'
          : `Safety log opened. Latest:\n${rows.map(r => `  ${clockText(r.at)} ${r.kind} ${r.rule}: ${r.reason.split('\n')[0]}`).join('\n')}`,
    }
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    if (e.args.trim() === 'show') {
      const saved = (await $.store.get('handoff').catch(() => undefined)) as { text?: string } | undefined

      return { text: saved?.text ?? 'No handoff note saved yet. Run /handoff.' }
    }
    const text = await handoffNote($)
    await $.store.set('handoff', { at: await $.clock.now(), cwd: await cwdOf($), text })
    await $.prompt
      .fill({
        text: `Resume from this handoff note. Read it, check the current state (git status, the files it lists), then continue where it stopped and tell me your plan before changing anything.\n\n${text}`,
        mode: 'replace',
      })
      .catch(() => undefined)

    return { text: `${text}\n\n(Saved in the mod store, not in your project. The prompt box now holds a "resume from this note" prompt; /handoff show prints it again.)` }
  })

  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = await read($, logAtom)
    const cfg = await read($, cfgAtom)
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 8)
    const flags = [
      `dry-run ${cfg.dryrun ? 'ON' : 'off'}`,
      `loop guard ${cfg.loopguard ? 'on' : 'off'}`,
      `hard budget ${cfg.hardBudget === null ? 'none' : usd(cfg.hardBudget)}`,
      `checkpoints ${cfg.checkpoint ? 'on' : 'off'}`,
      `pre-commit ${cfg.precommit === null ? 'off' : 'on'}`,
    ]

    return (
      <Box flexDirection="column" padding="sm">
        <Box justifyContent="space-between" marginBottom="sm">
          <Text size="heading" weight="bold">
            Safety log
          </Text>
          <Text dimColor mono tabular>
            {rows.length}
          </Text>
        </Box>
        <Text dimColor size="caption">
          {flags.join(' · ')}
        </Text>
        {rows.length === 0 && <Text dimColor>Nothing blocked or allowed by safety-pro yet.</Text>}
        {rows
          .slice(-room)
          .reverse()
          .map(r => (
            <Box flexDirection="column" marginTop="sm">
              <Box gap="sm">
                <Text mono dimColor tabular>
                  {clockText(r.at)}
                </Text>
                <Text color={r.kind === 'deny' ? 'error' : r.kind === 'allow' ? 'success' : 'subtle'} weight="bold">
                  {r.kind === 'deny' ? 'blocked' : r.kind === 'allow' ? 'allowed' : 'info'}
                </Text>
                <Text weight="semibold">{r.rule}</Text>
                <Text dimColor>{r.tool}</Text>
              </Box>
              <Text mono dimColor>
                {r.detail}
              </Text>
              <Text>{r.reason.split('\n')[0]}</Text>
            </Box>
          ))}
        {rows.length > 0 && (
          <Box marginTop="md">
            <Button
              key="clear"
              label="Clear log"
              onPress={async () => {
                await update($, logAtom, () => [])
                await $.store.set('log', []).catch(() => undefined)
              }}
            />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cfg = await read($, cfgAtom)
    const active = [
      cfg.dryrun && 'DRY-RUN',
      cfg.hardBudget !== null && `hard cap ${usd(cfg.hardBudget)}`,
      cfg.precommit !== null && 'pre-commit check',
    ].filter(Boolean)

    if (e.props.hasSurvey || active.length === 0) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text color={cfg.dryrun ? 'warning' : 'subtle'} size="caption">
          safety-pro: {active.join(' · ')}
        </Text>
      </Box>
    )
  })
}
