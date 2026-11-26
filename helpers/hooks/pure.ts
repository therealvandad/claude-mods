// Everything helpers decides without the engine: reading commands, spotting secrets, keeping notes.

export type Feature = { id: string; label: string }

export const FEATURES: readonly Feature[] = [
  { id: 'approvals', label: 'Plain-words line on approvals' },
  { id: 'delpreview', label: 'Show what a delete removes' },
  { id: 'secrets', label: 'Hold prompts that contain a key' },
  { id: 'commitguard', label: 'Hold commits that include .env or keys' },
  { id: 'usual', label: 'Usual time on slow commands' },
  { id: 'sound', label: 'Sound after long tasks' },
  { id: 'footer', label: 'Time and cost under replies' },
  { id: 'summary', label: 'Welcome-back summary' },
  { id: 'question', label: "Highlight Claude's questions" },
  { id: 'menu', label: 'Right-click extras' },
  { id: 'tomorrow', label: "Last time's recap" },
]

export const LONG_TURN_MS = 120_000
export const SOUND_TURN_MS = 60_000

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()

  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export const keyOf = (text: string): string => {
  let h = 0x811c9dc5

  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  }

  return h.toString(16)
}

// ------------------------------------------------------------------ reading shell commands

/** The words of one command, quotes removed. Good enough to describe, never to decide safety. */
export const words = (segment: string): string[] =>
  [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3] ?? '')

export const segments = (command: string): string[][] =>
  command
    .split(/&&|\|\||;|\||\n/)
    .map(s => words(s.trim().replace(/^((\w+=\S*|time|env|nohup)\s+)+/, '')))
    .filter(w => w.length > 0)

const args = (w: readonly string[]) => w.slice(1).filter(x => !x.startsWith('-') && !/^\d?>/.test(x))
const named = (list: readonly string[]) => (list.length === 0 ? 'files' : oneLine(list.slice(0, 3).join(', '), 60) + (list.length > 3 ? ` and ${list.length - 3} more` : ''))
const ONLY_READS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'rg', 'pwd', 'wc', 'which', 'file', 'stat', 'du', 'df', 'echo', 'sort', 'uniq', 'cut'])

const describe = (w: readonly string[]): string | null => {
  const [cmd = '', sub = ''] = w
  const rest = args(w)

  if (cmd === 'sudo') {
    return `runs with administrator rights: ${describe(w.slice(1)) ?? w.slice(1, 3).join(' ')}`
  }

  if (cmd === 'rm' || cmd === 'rmdir') {
    return `deletes ${named(rest)}${w.some(x => /^-\w*r/i.test(x)) ? ' and everything inside' : ''}`
  }

  if (cmd === 'mv') {
    return `moves or renames ${named(rest.slice(0, -1))} to ${rest[rest.length - 1] ?? 'somewhere'}`
  }

  if (cmd === 'cp') {
    return `copies ${named(rest.slice(0, -1))} to ${rest[rest.length - 1] ?? 'somewhere'}`
  }

  if (cmd === 'mkdir') {
    return `makes the folder ${named(rest)}`
  }

  if (cmd === 'chmod' || cmd === 'chown') {
    return `changes who can use ${named(rest.slice(1))}`
  }

  if (cmd === 'curl' || cmd === 'wget') {
    const host = rest.map(x => /^https?:\/\/([^/]+)/.exec(x)?.[1]).find(Boolean)

    return `talks to ${host ?? 'a server on the internet'}`
  }

  if (cmd === 'git') {
    const git: Record<string, string> = {
      push: 'uploads commits to the remote repository',
      pull: 'downloads and merges changes from the remote',
      commit: 'records a commit',
      add: `stages ${named(args(w.slice(1)))}`,
      status: 'only reads the repository',
      log: 'only reads the repository',
      diff: 'only reads the repository',
      checkout: 'switches branch or puts files back',
      switch: 'switches branch',
      restore: 'puts files back, dropping edits to them',
      clean: 'deletes files git does not track',
      clone: 'downloads a repository',
    }

    if (sub === 'reset') {
      return w.includes('--hard') ? 'throws away all uncommitted changes' : 'unstages or moves commits'
    }

    if (sub === 'push' && w.some(x => x === '--force' || x === '-f')) {
      return 'overwrites history on the remote repository'
    }

    return git[sub] ?? null
  }

  if ((cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn' || cmd === 'bun' || cmd === 'pip' || cmd === 'pip3' || cmd === 'brew') && (sub === 'install' || sub === 'i' || sub === 'add')) {
    return `installs software from the internet (${cmd})`
  }

  if (cmd === 'cd') {
    return ''
  }

  return ONLY_READS.has(cmd) ? 'only reads' : null
}

/** One plain sentence about a command, or null when there is nothing worth saying that is known. */
export const plainWords = (command: string): string | null => {
  const parts = segments(command)
  const said = parts.map(describe)
  const known = said.filter((s): s is string => s !== null && s !== '')
  const unknown = parts.filter((_, i) => said[i] === null).map(w => w[0] ?? '')
  const writes = /(^|[^0-9&>])>{1,2}\s*(?!\/dev\/null|&)[^\s>|;]+/.test(command)

  if (known.every(s => s === 'only reads' || s === 'only reads the repository') && !writes && unknown.length === 0) {
    return known.length === 0 ? null : 'Only reads. Changes nothing.'
  }

  if (known.length === 0 && !writes) {
    return null
  }
  const list = [...new Set(known.filter(s => !s.startsWith('only reads')))]

  if (writes) {
    list.push('writes into a file')
  }

  if (unknown.length > 0) {
    list.push(`runs ${[...new Set(unknown)].slice(0, 3).join(', ')}, which this cannot describe`)
  }
  const text = list.join('; ')

  return text === '' ? null : oneLine(`${text.charAt(0).toUpperCase()}${text.slice(1)}.`, 220)
}

/** The paths an `rm` names, and whether any is a pattern that cannot be listed. */
export const deleteTargets = (command: string): { paths: string[]; hasPattern: boolean } => {
  const all = segments(command)
    .map(w => (w[0] === 'sudo' ? w.slice(1) : w))
    .filter(w => w[0] === 'rm')
    .flatMap(args)

  return { paths: all.filter(p => !/[*?$`{[~]/.test(p)).slice(0, 4), hasPattern: all.some(p => /[*?$`{[]/.test(p)) }
}

// ------------------------------------------------------------------ secrets and commits

const SECRET =
  /(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(password|passwd|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*['"]?[^\s'"]{8,})/i

export const looksSecret = (text: string): boolean => SECRET.test(text)

const RISKY_FILE = /(^|\/)(\.env(?!\.(example|sample|template))(\.[\w-]+)?|id_(rsa|ed25519|ecdsa)|[^/]*\.(pem|p12|pfx|key)|credentials(\.json)?|\.netrc|\.npmrc)$/i

export const riskyFiles = (files: readonly string[]): string[] => files.map(f => f.trim()).filter(f => f !== '' && RISKY_FILE.test(f))

/** What a command line does with git commits: whether it commits, with `-a`, and which files it adds first. */
export const commitPlan = (command: string): { isCommit: boolean; isAll: boolean; isAddAll: boolean; added: string[] } => {
  const git = segments(command).filter(w => w[0] === 'git')
  const commit = git.find(w => w.includes('commit'))

  return {
    isCommit: commit !== undefined,
    isAll: commit?.some(x => x === '--all' || /^-\w*a/.test(x)) ?? false,
    isAddAll: git.some(w => w[1] === 'add' && w.some(x => x === '-A' || x === '--all' || x === '.')),
    added: git.filter(w => w[1] === 'add').flatMap(w => args(w.slice(1))),
  }
}

// ------------------------------------------------------------------ tests, durations

const TEST = /^((npm|pnpm|yarn|bun)\s+(run\s+)?test|vitest|jest|mocha|pytest|unittest|rspec|(go|cargo|swift|deno|dotnet|mvn|gradle)\s+test|(\.\/)?gradlew\s+test|make\s+(test|check)|claude\s+plugin\s+test)(?![\w.-])/

export const isTestCommand = (command: string): boolean =>
  segments(command).some(w => TEST.test(w.join(' ').replace(/^((npx|bunx|poetry run|bundle exec|python3? -m|pnpm exec)\s+)+/, '')))

export const commandKey = (command: string): string => (segments(command).pop() ?? []).slice(0, 2).join(' ').slice(0, 60)

export const remember = (kept: Record<string, number[]>, key: string, ms: number): Record<string, number[]> => {
  if (key === '' || ms < 2000) {
    return kept
  }
  const next = { ...kept, [key]: [...(kept[key] ?? []), Math.round(ms / 1000)].slice(-5) }
  const keys = Object.keys(next)

  return keys.length > 80 ? Object.fromEntries(keys.slice(-80).map(k => [k, next[k] ?? []])) : next
}

export const usual = (times: readonly number[] | undefined): number | null => {
  if (times === undefined || times.length === 0) {
    return null
  }
  const sorted = [...times].sort((a, b) => a - b)
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0

  return middle >= 10 ? middle : null
}

export const spanOf = (seconds: number): string => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`)

// ------------------------------------------------------------------ changes, steps

export type Change = { path: string; added: number; removed: number }

export const lineDelta = (tool: string, input: Record<string, unknown>, result: unknown): { added: number; removed: number } => {
  const patch = (result as { structuredPatch?: { lines?: unknown[] }[] } | null | undefined)?.structuredPatch
  const lines = Array.isArray(patch) ? patch.flatMap(h => h.lines ?? []).map(String) : []

  if (lines.length > 0) {
    return { added: lines.filter(l => l.startsWith('+')).length, removed: lines.filter(l => l.startsWith('-')).length }
  }
  const count = (v: unknown) => (typeof v === 'string' && v !== '' ? v.replace(/\n$/, '').split('\n').length : 0)

  return tool === 'Edit' ? { added: count(input.new_string), removed: count(input.old_string) } : { added: count(input.content), removed: 0 }
}

export const addChange = (list: readonly Change[], c: Change): Change[] => {
  const old = list.find(x => x.path === c.path)

  return old === undefined
    ? [...list, c].slice(-60)
    : list.map(x => (x.path === c.path ? { path: x.path, added: x.added + c.added, removed: x.removed + c.removed } : x))
}

export type Step = { label: string; status: string; startedAt: number | null; endedAt: number | null }

/** Follows the task list tools: a whole list replaces, moves change statuses, times are noted as they happen. */
export const stepsAfter = (steps: readonly Step[], tool: string, input: Record<string, unknown>, at: number): Step[] => {
  const stamp = (s: Step, status: string): Step =>
    status === s.status
      ? s
      : { ...s, status, startedAt: status === 'in_progress' ? at : s.startedAt, endedAt: status === 'completed' ? at : null }
  const fresh = (label: unknown, status: unknown): Step => {
    const text = oneLine(String(label ?? ''), 70)
    const old = steps.find(s => s.label === text)

    return stamp(old ?? { label: text, status: 'pending', startedAt: null, endedAt: null }, String(status ?? 'pending'))
  }
  const list = tool === 'TodoWrite' ? input.todos : tool === 'mcp__ccd_turn__update_plan' ? input.items : undefined

  if (Array.isArray(list)) {
    return (list as { content?: unknown; status?: unknown }[]).slice(0, 40).map(t => fresh(t.content, t.status))
  }

  if (tool === 'mcp__ccd_turn__wrap_up') {
    return steps.map(s => stamp(s, 'completed'))
  }

  if (tool !== 'mcp__ccd_turn__update_plan') {
    return [...steps]
  }
  let moved = [...steps]

  if (input.advance === true) {
    const now = moved.findIndex(s => s.status === 'in_progress')
    moved = moved.map((s, i) => (i === now ? stamp(s, 'completed') : s))
    const following = moved.findIndex(s => s.status === 'pending')
    moved = moved.map((s, i) => (i === following ? stamp(s, 'in_progress') : s))
  }
  const done = Array.isArray(input.done) ? input.done.map(Number) : []
  const start = Number(input.start)

  return moved.map((s, i) => (done.includes(i + 1) ? stamp(s, 'completed') : i + 1 === start ? stamp(s, 'in_progress') : s))
}

// ------------------------------------------------------------------ under a reply

export type Footer = { tail: string; line: string; extra: string[] }

export const tailOf = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(-70)

export const footerFor = (footers: readonly Footer[], text: string): Footer | undefined => {
  const end = tailOf(text)

  return end === '' ? undefined : [...footers].reverse().find(f => f.tail === end)
}

export const factsLine = (ms: number, usd: number | null): string =>
  [spanOf(Math.max(1, Math.round(ms / 1000))), usd === null || usd < 0.005 ? '' : `$${usd.toFixed(2)}`].filter(Boolean).join(' · ')

export const summaryLines = (o: { files: number; isTested: boolean; failed: number; answer: string }): string[] =>
  [
    o.files > 0 ? `${o.files} file${o.files === 1 ? '' : 's'} changed, ${o.isTested ? 'tested' : 'not tested'}` : '',
    o.failed > 0 ? `${o.failed} command${o.failed === 1 ? '' : 's'} failed` : '',
    /\?\s*$/.test(o.answer.trim()) ? 'Claude is waiting for your answer' : '',
  ].filter(Boolean)

/** The question a reply ends with, if it ends with one outside a code block. */
export const closingQuestion = (text: string): string | null => {
  const prose = text.replace(/```[\s\S]*?(```|$)/g, ' ')
  const last = prose.trim().split('\n').filter(l => l.trim() !== '').pop() ?? ''
  const clean = last.replace(/[*_`#>]/g, '').trim()

  if (!clean.endsWith('?')) {
    return null
  }
  const sentence = clean.split(/(?<=[.!?])\s+/).pop() ?? clean

  return oneLine(sentence, 160)
}

// ------------------------------------------------------------------ notes and shortcuts

export type Shortcut = { label: string; text: string }

export const parseShortcut = (input: string): { add?: Shortcut; remove?: string; error?: string } => {
  const add = /^add\s+([^=]{1,30}?)\s*=\s*([\s\S]{1,500})$/i.exec(input.trim())

  if (add !== null) {
    return { add: { label: (add[1] ?? '').trim(), text: (add[2] ?? '').trim() } }
  }
  const rm = /^(remove|rm)\s+(.{1,30})$/i.exec(input.trim())

  return rm !== null ? { remove: (rm[2] ?? '').trim() } : { error: 'Usage: /shortcut add <name> = <what to ask> | /shortcut remove <name>' }
}

export const quote = (text: string): string => (text.length > 600 ? `${text.slice(0, 599)}…` : text).replace(/^/gm, '> ')
