import type { CallKind, CallRec, Chip, ErrRow, FileRow, FixRow, Modes, PasteLabel, PromptRow, RecallRow } from '../types'

// Everything here is a pure function of its arguments: no engine calls.

// ---------------------------------------------------------------- limits

export const KEEP = { calls: 120, files: 200, errors: 50, fixes: 100, prompts: 20, recall: 300, decisions: 40, usage: 120 }
export const GAP_MS = 10 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000
export const TOAST_GAP_MS = 3 * 60 * 1000
export const READ_WORDS = 400

export const DEFAULT_MODES: Modes = { next: false, paste: true, read: false, coach: true, rec: true, recall: true }

export const readModes = (raw: unknown): Modes => {
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const flag = (key: keyof Modes) => (typeof r[key] === 'boolean' ? (r[key] as boolean) : DEFAULT_MODES[key])

  return { next: flag('next'), paste: flag('paste'), read: flag('read'), coach: flag('coach'), rec: flag('rec'), recall: flag('recall') }
}

// ---------------------------------------------------------------- text helpers

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

export const stripAnsi = (s: string): string => s.replace(ANSI, '')

export const oneLine = (s: string, max = 100): string => {
  const flat = stripAnsi(s).replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat
}

export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s)

export const addBounded = <T,>(list: readonly T[], item: T, max: number): T[] => [...list, item].slice(-max)

export const fmtTime = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export const dayOf = (ms: number): number => Math.floor(ms / DAY_MS)

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export const splitVerb = (args: string): [string, string] => {
  const t = args.trim()
  const at = t.search(/\s/)

  return at < 0 ? [t.toLowerCase(), ''] : [t.slice(0, at).toLowerCase(), t.slice(at).trim()]
}

export const onOff = (word: string): boolean | undefined => {
  const w = word.trim().toLowerCase()

  return w === 'on' || w === 'true' || w === 'yes' ? true : w === 'off' || w === 'false' || w === 'no' ? false : undefined
}

// ---------------------------------------------------------------- secrets

const SECRET_WORDS = '(?:token|secret|passwd|password|pwd|api[_-]?key|apikey|auth|authorization|credential|private[_-]?key|access[_-]?key)'

const MASKS: readonly [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '***'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '***'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '***'],
  [/\bAKIA[0-9A-Z]{12,}/g, '***'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '***'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/(:\/\/[^\s/:@]+:)[^\s/@]+@/g, '$1***@'],
  [new RegExp(`(--?[A-Za-z-]*${SECRET_WORDS}[A-Za-z-]*)(\\s+|=)(?:"[^"]*"|'[^']*'|\\S+)`, 'gi'), '$1$2***'],
  [new RegExp(`(\\b[A-Za-z0-9_.-]*${SECRET_WORDS}[A-Za-z0-9_.-]*)(\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&]+)`, 'gi'), '$1$2***'],
]

export const maskSecrets = (s: string): string => MASKS.reduce((text, [re, to]) => text.replace(re, to), s)

export const hasSecret = (s: string): boolean => maskSecrets(s) !== s

// ---------------------------------------------------------------- reading a tool result

export const outputText = (output: unknown): string => {
  if (typeof output === 'string') {
    return stripAnsi(output)
  }
  if (output !== null && typeof output === 'object') {
    const o = output as Record<string, unknown>
    const parts = [o.stderr, o.stdout].filter((x): x is string => typeof x === 'string' && x.trim() !== '')

    if (parts.length > 0) {
      return stripAnsi(parts.join('\n'))
    }
    try {
      return clip(JSON.stringify(output), 2000)
    } catch {
      return ''
    }
  }

  return ''
}

const TEST_CMD =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\w*|jest|vitest|pytest|py\.test|mocha|rspec|phpunit|go\s+test|cargo\s+(?:test|nextest)|make\s+test|dotnet\s+test|node\s+--test|tox|plugin\s+test)\b/i
const COMMIT_CMD = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/i

export const kindOfTool = (tool: string, command: string): CallKind => {
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    return 'edit'
  }
  if (tool === 'Read') {
    return 'read'
  }
  if (tool === 'Bash') {
    return COMMIT_CMD.test(command) ? 'commit' : TEST_CMD.test(command) ? 'test' : 'bash'
  }

  return 'other'
}

// The path a file tool names (never a directory argument of Glob or Grep).
export const fileOf = (tool: string, input: Record<string, unknown>): string => {
  if (tool !== 'Read' && tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit') {
    return ''
  }
  const v = input.file_path ?? input.notebook_path ?? input.path

  return typeof v === 'string' ? v : ''
}

// The first line of an error that says what went wrong.
export const errorLine = (text: string): string => {
  const lines = stripAnsi(text)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '')
  const hit = lines.find(l => /\b(?:error|exception|failed|failure|fatal|cannot|can't|not found|denied|no such|undefined|unexpected|invalid|refused|timed out)\b/i.test(l))

  return oneLine(hit ?? lines[0] ?? '', 160)
}

// The same mistake on another day or path reads the same.
export const errorSignature = (text: string): string => {
  const line = errorLine(text)

  if (line === '') {
    return ''
  }

  return oneLine(
    maskSecrets(line)
      .toLowerCase()
      .replace(/(?:[a-z]:)?(?:[\w.~-]*\/)+[\w.-]+/g, '<path>')
      .replace(/\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|json|ya?ml|toml|md|txt|css|html|sh|sql|lock)\b/g, '<file>')
      .replace(/0x[0-9a-f]+/g, 'N')
      .replace(/\b[0-9a-f]{7,}\b/g, 'N')
      .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"…"')
      .replace(/\d+/g, 'N'),
    90,
  )
}

export const failingName = (text: string): string => {
  const t = stripAnsi(text)
  const m =
    /--- FAIL: (\S+)/.exec(t) ??
    /^\s*(?:FAILED|ERROR)\s+(\S+::\S+)/m.exec(t) ??
    /^\s*test (\S+) \.\.\. FAILED/m.exec(t) ??
    /^\s*(?:FAIL|✕|✗|×|●)\s+(.+?)\s*$/m.exec(t)

  return m?.[1] === undefined ? '' : oneLine(m[1], 80)
}

// ---------------------------------------------------------------- 69: next-step chips

// Up to three chips from what the session's own calls say; a heuristic, not a model.
export const nextChips = (calls: readonly CallRec[], turn: number): Chip[] => {
  const chips: Chip[] = []
  const mine = calls.filter(c => c.turn === turn)
  const lastEdit = mine.reduce((m, c, i) => (c.kind === 'edit' ? i : m), -1)
  const tests = mine.map((c, i) => ({ c, i })).filter(x => x.c.kind === 'test')
  const lastTest = tests[tests.length - 1]
  const hasFailedTest = lastTest !== undefined && lastTest.c.isErr

  if (lastTest !== undefined && hasFailedTest) {
    const name = failingName(lastTest.c.line) || lastTest.c.line

    chips.push({
      label: 'fix the failing test',
      text: name === '' ? 'Fix the failing test.' : `Fix the failing test: ${oneLine(name, 90)}`,
    })
  }
  if (lastEdit >= 0 && !tests.some(x => x.i > lastEdit)) {
    chips.push({ label: 'run the tests', text: 'Run the tests and report what fails.' })
  }
  let lastCommit = -1
  let lastAnyEdit = -1
  calls.forEach((c, i) => {
    if (c.kind === 'commit' && !c.isErr) {
      lastCommit = i
    }
    if (c.kind === 'edit' && !c.isErr) {
      lastAnyEdit = i
    }
  })

  if (lastAnyEdit > lastCommit && !hasFailedTest) {
    chips.push({ label: 'commit', text: 'Commit these changes with a clear message (do not push).' })
  }
  if (chips.length === 0 && mine.some(c => c.isErr)) {
    chips.push({ label: 'explain the last error', text: 'Explain the last error and the likely cause.' })
  }

  return chips.slice(0, 3)
}

// ---------------------------------------------------------------- 70, 72: stuck and retry

export const commandKey = (tool: string, command: string, file: string): string =>
  oneLine(tool === 'Bash' ? command : file === '' ? tool : `${tool} ${file}`, 80)

// The run of failures since the last success; a success ends it.
export const trackRun = (run: readonly string[], key: string, isErr: boolean): string[] => (isErr ? [...run, key].slice(-12) : [])

export const isStuck = (run: readonly string[]): boolean => new Set(run).size >= 3

export const unstickPrompt = (lines: readonly string[]): string => {
  const list = lines.slice(-5).map(l => `- ${l}`)

  return [
    'Stop. Several different attempts in a row failed:',
    ...(list.length > 0 ? list : ['- (see the transcript)']),
    '',
    'Reset before trying anything else: say in two sentences what you were trying to do, what the errors have in common, and what you have assumed without checking. Then propose one different approach and wait for me to agree before you run it.',
  ].join('\n')
}

export const retryPrompt = (command: string, change: string): { text: string; cursor: number } => {
  const head = command === '' ? 'Retry the last failed command' : `Retry the last failed command (\`${oneLine(command, 160)}\`)`
  const c = change.trim()

  if (c === '') {
    const text = `${head} with ___`

    return { text, cursor: text.indexOf('___') }
  }
  const text = `${head} with ${c}`

  return { text, cursor: text.length }
}

export const lastFailure = (calls: readonly CallRec[]): CallRec | undefined => {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const c = calls[i]

    if (c !== undefined && c.isErr) {
      return c
    }
  }

  return undefined
}

// Failures with no later success of the same call.
export const openFailures = (calls: readonly CallRec[]): CallRec[] => {
  const last = new Map<string, CallRec>()

  for (const c of calls) {
    last.set(c.key, c)
  }

  return [...last.values()].filter(c => c.isErr)
}

// ---------------------------------------------------------------- 71: explain

export const explainPrompt = (tool: string, input: unknown, output: unknown): string => {
  const cmd =
    input !== null && typeof input === 'object' && typeof (input as { command?: unknown }).command === 'string'
      ? (input as { command: string }).command
      : ''
  const body = clip(maskSecrets(outputText(output)).trim(), 900)
  const what = cmd === '' ? `The ${tool} call failed.` : `This command failed: \`${oneLine(maskSecrets(cmd), 160)}\``

  return `${what}\n\nExplain this error in plain words, say the most likely cause, and suggest one fix:\n\n\`\`\`\n${body}\n\`\`\``
}

// ---------------------------------------------------------------- 73: compressor

export type Heavy = { label: string; size: number; times: number; file: string }

export const compressRows = (calls: readonly CallRec[], max = 8): Heavy[] => {
  const reads = new Map<string, number>()

  for (const c of calls) {
    if (c.kind === 'read' && c.file !== '') {
      reads.set(c.file, (reads.get(c.file) ?? 0) + 1)
    }
  }

  return [...calls]
    .filter(c => c.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, max)
    .map(c => ({ label: c.label, size: c.size, times: c.file === '' ? 1 : (reads.get(c.file) ?? 1), file: c.file }))
}

export const fmtSize = (chars: number): string => (chars >= 1000 ? `${(chars / 1000).toFixed(chars >= 10_000 ? 0 : 1)}k` : String(chars))

export const avoidPrompt = (rows: readonly Heavy[]): string => {
  const files = rows.filter(r => r.file !== '').map(r => r.file)
  const named = files.length > 0 ? `Avoid re-reading ${files.slice(0, 5).join(', ')}. ` : ''

  return `${named}You already have their contents; refer back to what you saw, and when you need more, read only the specific lines. Prefer narrow commands (head, grep, a line range) over dumping whole files or long outputs.`
}

// ---------------------------------------------------------------- 74: smart paste

export const classifyPaste = (raw: string): PasteLabel | null => {
  const text = stripAnsi(raw)
  const lines = text.split('\n').filter(l => l.trim() !== '')
  const chars = text.length

  if (chars < 30 && lines.length < 2) {
    return null
  }
  const count = (re: RegExp) => lines.filter(l => re.test(l)).length
  const mk = (kind: string): PasteLabel => ({ kind, lines: lines.length, chars })

  if (count(/^diff --git /) > 0 || (count(/^@@ .* @@/) > 0 && count(/^[-+]/) > 1) || (count(/^--- /) > 0 && count(/^\+\+\+ /) > 0)) {
    return mk('diff')
  }
  if (
    count(/^\s+at .+(?:\(.+:\d+(?::\d+)?\)|:\d+:\d+)/) >= 2 ||
    /Traceback \(most recent call last\)/.test(text) ||
    count(/^\s+File ".+", line \d+/) >= 2 ||
    /^(?:goroutine \d+|panic: )/m.test(text) ||
    /Exception in thread /.test(text)
  ) {
    return mk('stack trace')
  }
  const t = text.trim()

  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t)

      return mk('JSON')
    } catch {
      // Not JSON after all; fall through to the log check.
    }
  }
  const stamped = count(/^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/) + count(/^\[?\d{2}:\d{2}:\d{2}/) + count(/^\S*\s*\[?(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\]?\b/)

  if (lines.length >= 3 && stamped >= 3) {
    return mk('log lines')
  }

  return null
}

// ---------------------------------------------------------------- 75: file finder

// A subsequence score: higher is better, 0 when the letters are not all there in order.
export const fuzzyScore = (query: string, path: string): number => {
  const q = query.toLowerCase().replace(/\s+/g, '')

  if (q === '') {
    return 1
  }
  const p = path.toLowerCase()
  const base = p.slice(p.lastIndexOf('/') + 1)
  const sub = (hay: string) => {
    let at = 0
    let score = 0
    let streak = 0

    for (const ch of q) {
      const found = hay.indexOf(ch, at)

      if (found < 0) {
        return 0
      }
      streak = found === at && at > 0 ? streak + 1 : 0
      score += 1 + streak * 2 + (found === 0 || '/._-'.includes(hay[found - 1] ?? '') ? 3 : 0)
      at = found + 1
    }

    return score
  }
  const inBase = sub(base)
  const inPath = sub(p)

  if (inBase === 0 && inPath === 0) {
    return 0
  }

  return (inBase > 0 ? inBase * 2 + (base.includes(q) ? 20 : 0) : 0) + inPath + (p.includes(q) ? 10 : 0) - p.length / 100
}

export const findFiles = (files: readonly FileRow[], query: string, max = 12): FileRow[] =>
  files
    .map(f => ({ f, s: fuzzyScore(query, f.path) + f.edits * 0.5 }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || b.f.at - a.f.at)
    .slice(0, max)
    .map(x => x.f)

export const touch = (files: readonly FileRow[], path: string, kind: 'read' | 'edit', now: number): FileRow[] => {
  const old = files.find(f => f.path === path)
  const row: FileRow = {
    path,
    reads: (old?.reads ?? 0) + (kind === 'read' ? 1 : 0),
    edits: (old?.edits ?? 0) + (kind === 'edit' ? 1 : 0),
    at: now,
  }

  return [...files.filter(f => f.path !== path), row].slice(-KEEP.files)
}

// ---------------------------------------------------------------- 76: recall

export const recallAdd = (rows: readonly RecallRow[], command: string, now: number): RecallRow[] => {
  const c = clip(maskSecrets(command.trim()), 300)

  if (c === '') {
    return [...rows]
  }

  return [...rows.filter(r => r.c !== c), { c, at: now }].slice(-KEEP.recall)
}

export const recallFind = (rows: readonly RecallRow[], query: string, max = 10): RecallRow[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)

  return [...rows]
    .reverse()
    .filter(r => words.every(w => r.c.toLowerCase().includes(w)))
    .slice(0, max)
}

export const readRecall = (raw: unknown): RecallRow[] =>
  Array.isArray(raw)
    ? raw
        .filter((r): r is RecallRow => r !== null && typeof r === 'object' && typeof (r as RecallRow).c === 'string' && typeof (r as RecallRow).at === 'number')
        .map(r => ({ c: clip(maskSecrets(r.c), 300), at: r.at }))
        .slice(-KEEP.recall)
    : []

// ---------------------------------------------------------------- 77: recap

export const recapPrompt = (prompts: readonly PromptRow[], open: readonly string[]): string => {
  const last = prompts.slice(-4).map((p, i) => `${i + 1}. ${oneLine(p.text, 140)}`)
  const lines = ['Summarize where we left off.']

  if (last.length > 0) {
    lines.push('', 'My last prompts were:', ...last)
  }
  if (open.length > 0) {
    lines.push('', 'Unresolved errors:', ...open.slice(0, 3).map(o => `- ${oneLine(o, 120)}`))
  }
  lines.push('', 'Say what is done, what is unfinished, and the single next step.')

  return lines.join('\n')
}

// ---------------------------------------------------------------- 78, 79: checklists

export const preflight = (task: string): string => {
  const t = task.trim()

  return [
    t === '' ? 'Before we start this refactor, confirm each of these with me:' : `Before we start "${oneLine(t, 120)}", confirm each of these with me:`,
    '1. Scope: which files and modules change, and which must not.',
    '2. Tests: which tests cover this today, and do they pass right now?',
    '3. Behaviour: what must stay exactly the same?',
    '4. Plan: the steps in order, each small enough to review.',
    '5. Safety: work on a branch, commit after each step, nothing destructive without asking.',
    '6. Stop conditions: what would make you stop and ask me.',
    'Answer these first and wait for my go-ahead before you change anything.',
  ].join('\n')
}

export const postflight = (task: string): string => {
  const t = task.trim()

  return [
    t === '' ? 'Now that the change is done, go through this checklist and report each item:' : `Now that "${oneLine(t, 120)}" is done, go through this checklist and report each item:`,
    '1. Tests: run them and report the result.',
    '2. Lint and types: run them and report anything new.',
    '3. Diff: list the files changed and anything unexpected in the diff.',
    '4. Commit: propose a commit message (do not push).',
    '5. Notes: what to write down for next time (decisions, follow-ups, known gaps).',
  ].join('\n')
}

// ---------------------------------------------------------------- 80, 81: report and handoff

export const helpReport = (errors: readonly ErrRow[], calls: readonly CallRec[], now: number): string => {
  const recent = [...errors].sort((a, b) => b.last - a.last).slice(0, 3)
  const cmds = calls.filter(c => c.kind !== 'read' && c.kind !== 'edit').slice(-8)
  const lines = ['Bug report (draft, not sent anywhere)', `Date: ${fmtTime(now)}`, '', 'What happened', recent.length === 0 ? '- No errors were recorded this session. Describe what went wrong here.' : `- ${recent[0]?.sig ?? ''}`]

  lines.push('', 'Errors seen')

  if (recent.length === 0) {
    lines.push('- none recorded')
  }
  for (const e of recent) {
    lines.push(`- ${e.sig} (x${e.count}, last ${fmtTime(e.last)})${e.cmd === '' ? '' : `\n  command: ${oneLine(e.cmd, 120)}`}`, `  output: ${oneLine(e.sample, 160)}`)
  }
  lines.push('', 'Recent commands (secrets masked)')

  if (cmds.length === 0) {
    lines.push('- none recorded')
  }
  for (const c of cmds) {
    lines.push(`- ${c.isErr ? '[failed] ' : ''}${oneLine(c.label, 120)}`)
  }
  lines.push('', 'Steps to reproduce', '1. ___', '', 'Expected', '- ___', '', 'Actual', '- ___')

  return lines.join('\n')
}

export const handoffText = (prompts: readonly PromptRow[], decisions: readonly string[], files: readonly FileRow[], open: readonly CallRec[]): string => {
  const edited = files.filter(f => f.edits > 0).slice(-15)
  const lines = ['Handoff pack', '', 'Prompts so far']

  lines.push(...(prompts.length === 0 ? ['- none recorded'] : prompts.slice(-8).map(p => `- ${oneLine(p.text, 140)}`)))
  lines.push('', 'Decisions')
  lines.push(...(decisions.length === 0 ? ['- none noted (add with /ashandoff decide <text>)'] : decisions.slice(-10).map(d => `- ${oneLine(d, 140)}`)))
  lines.push('', 'Files changed')
  lines.push(...(edited.length === 0 ? ['- none'] : edited.map(f => `- ${f.path} (${plural(f.edits, 'edit')})`)))
  lines.push('', 'Open errors')
  lines.push(...(open.length === 0 ? ['- none'] : open.slice(-6).map(c => `- ${oneLine(c.label, 80)}: ${oneLine(c.line, 100)}`)))
  lines.push('', 'Next step', '- ___')

  return lines.join('\n')
}

// ---------------------------------------------------------------- 82: reading time

export const wordCount = (text: string): number => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length)

export const readMinutes = (text: string): number | null => {
  const words = wordCount(text)

  return words > READ_WORDS ? Math.max(2, Math.round(words / 220)) : null
}

// ---------------------------------------------------------------- 83: skimmer

export const skimPoints = (text: string, max = 8): string[] => {
  const out: string[] = []
  let isFence = false
  const blocks: string[] = []
  let cur: string[] = []

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      isFence = !isFence
      continue
    }
    if (isFence) {
      continue
    }
    if (line.trim() === '') {
      if (cur.length > 0) {
        blocks.push(cur.join(' '))
      }
      cur = []
    } else {
      cur.push(line.trim())
    }
  }
  if (cur.length > 0) {
    blocks.push(cur.join(' '))
  }
  for (const block of blocks) {
    const plain = block.replace(/^#{1,6}\s+/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/[*_`]/g, '').trim()
    const first = /^.*?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain

    if (first.length >= 12) {
      out.push(oneLine(first, 160))
    }
  }

  return out.slice(0, max)
}

export const SKIM_PROMPT =
  'Give me the key points of your last answer as at most five short bullets, most important first, then one line on what I should do next.'

// ---------------------------------------------------------------- 84: question bank

export const QUESTIONS: Readonly<Record<string, readonly string[]>> = {
  error: ['What is the root cause, not just the symptom?', 'What is the smallest change that fixes this?', 'How can I reproduce this in one command?', 'What else could produce this same error?'],
  edited: ['What could this change break?', 'Which tests should I add or update for this?', 'Is there a simpler way to do the same thing?', 'Review the diff as a skeptical teammate would.'],
  stuck: ['What have we tried, and what did each attempt tell us?', 'What assumption have we not checked yet?', 'What is a completely different way to approach this?', 'What would you look at first if you were starting over?'],
  unclear: ['What are you unsure about in what I asked?', 'List the assumptions you are making.', 'What question would you ask me before starting?', 'Restate the task in your own words.'],
  learn: ['Explain this as if I were new to the codebase.', 'What are the two or three files I should read first?', 'Why was it built this way, and what are the trade-offs?', 'Give a short example of how this is used.'],
  wrap: ['What is left to do, in order?', 'What did we decide and why?', 'Is anything half-done or risky to leave?', 'Write a commit message for the work so far.'],
}

export const SITUATIONS = Object.keys(QUESTIONS)

export const guessSituation = (calls: readonly CallRec[], isStuckNow: boolean): string => {
  if (isStuckNow) {
    return 'stuck'
  }
  const last = calls[calls.length - 1]

  if (last?.isErr === true) {
    return 'error'
  }
  if (calls.some(c => c.kind === 'edit')) {
    return 'edited'
  }

  return 'unclear'
}

// ---------------------------------------------------------------- 86: coach

export const COACH: readonly (readonly [string, string])[] = [
  ['/aspre', 'fills a checklist of confirmations before a big refactor'],
  ['/asunstick', 'fills a reset prompt when several attempts in a row have failed'],
  ['/asrecall', 'searches shell commands you ran earlier, secrets masked'],
  ['/asfind', 'fuzzy-finds files touched this session and fills @path'],
  ['/ascompress', 'lists the biggest outputs so you can avoid re-reading them'],
  ['/asskim', 'fills a prompt asking for the key points of the last answer'],
  ['/ashandoff', 'bundles prompts, decisions, files changed and open errors'],
  ['/asfix', 'notes how you fixed the latest error so it can be found again'],
  ['/aspost', 'fills a post-flight checklist: tests, lint, commit, notes'],
  ['/pmtpl', 'fills the prompt from a template with blanks'],
  ['/pmsum', 'asks for a short recap of the conversation so far'],
]

export const pickCoach = (usage: Readonly<Record<string, number>>, day: number): readonly [string, string] | undefined => {
  const unused = COACH.filter(([cmd]) => (usage[cmd.slice(1)] ?? 0) === 0)

  return unused.length === 0 ? undefined : unused[day % unused.length]
}

export const bump = (usage: Readonly<Record<string, number>>, name: string): Record<string, number> => {
  const next = { ...usage, [name]: (usage[name] ?? 0) + 1 }
  const keys = Object.keys(next)

  if (keys.length <= KEEP.usage) {
    return next
  }
  const small = keys.sort((a, b) => (next[a] ?? 0) - (next[b] ?? 0))[0]

  if (small !== undefined && small !== name) {
    delete next[small]
  }

  return next
}

// ---------------------------------------------------------------- 87, 88: museum and fixes

export const noteError = (errors: readonly ErrRow[], row: Omit<ErrRow, 'count' | 'first' | 'fix'>, now: number): ErrRow[] => {
  const old = errors.find(e => e.sig === row.sig)
  const next: ErrRow = old === undefined ? { ...row, count: 1, first: now, fix: '' } : { ...old, ...row, count: old.count + 1, first: old.first, fix: old.fix }
  const rest = errors.filter(e => e.sig !== row.sig)

  return [...rest, next].sort((a, b) => a.last - b.last).slice(-KEEP.errors)
}

// The list is kept oldest first, so on equal times the later row wins.
export const latestError = (errors: readonly ErrRow[]): ErrRow | undefined =>
  errors.reduce<ErrRow | undefined>((best, e) => (best === undefined || e.last >= best.last ? e : best), undefined)

export const attachFix = (errors: readonly ErrRow[], sig: string, text: string): ErrRow[] => errors.map(e => (e.sig === sig ? { ...e, fix: text } : e))

export const nextFixN = (fixes: readonly FixRow[]): number => fixes.reduce((m, f) => Math.max(m, f.n), 0) + 1

export const findFixes = (fixes: readonly FixRow[], query: string, max = 10): FixRow[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)

  return [...fixes]
    .reverse()
    .filter(f => words.every(w => `${f.text} ${f.sig} ${f.sample}`.toLowerCase().includes(w)))
    .slice(0, max)
}

export const ordinal = (n: number): string => {
  const mod = n % 100

  if (mod >= 11 && mod <= 13) {
    return `${n}th`
  }

  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

// ---------------------------------------------------------------- loading stored rows

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object'

export const readRows = <T,>(raw: unknown, ok: (x: Record<string, unknown>) => boolean, max: number): T[] =>
  Array.isArray(raw) ? (raw.filter(x => isObj(x) && ok(x)).slice(-max) as T[]) : []

export const readPrompts = (raw: unknown): PromptRow[] =>
  readRows<PromptRow>(raw, r => typeof r.text === 'string' && typeof r.at === 'number', KEEP.prompts)

export const readErrors = (raw: unknown): ErrRow[] =>
  readRows<ErrRow>(raw, r => typeof r.sig === 'string' && typeof r.count === 'number' && typeof r.last === 'number' && typeof r.fix === 'string', KEEP.errors)

export const readFixes = (raw: unknown): FixRow[] =>
  readRows<FixRow>(raw, r => typeof r.n === 'number' && typeof r.text === 'string' && typeof r.sig === 'string', KEEP.fixes)

export const readUsage = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {}

  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = v
      }
    }
  }

  return out
}
