// What sidekick decides without the engine: reading replies, commands and paths.

export type Feature = { id: string; label: string }

export const FEATURES: readonly Feature[] = [
  { id: 'claims', label: 'Claim checker' },
  { id: 'loose', label: 'Collect loose ends' },
  { id: 'scope', label: 'Many-files warning' },
  { id: 'sensitive', label: 'Mark sensitive files' },
  { id: 'branch', label: 'Main branch warning' },
  { id: 'bigfile', label: 'Big or generated file warning' },
  { id: 'rewind', label: 'Keep copies for rewind' },
  { id: 'advisor', label: 'Fresh chat advice' },
  { id: 'limits', label: 'Usage limit warning' },
  { id: 'speak', label: 'Read questions aloud' },
]

/** Everything is on by default except speaking: a voice nobody asked for is a surprise. */
export const DEFAULT_OFF: readonly string[] = ['speak']

export const PRESET_RULES: readonly string[] = [
  'Keep answers short and concrete.',
  'Ask before large changes or deleting anything.',
  'Use simple words and explain any technical term.',
]

export const SCOPE_FILES = 8
export const BIG_CHARS = 200_000

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

export const tailOf = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(-70)

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Prose only: code blocks and quoted lines are not claims. */
const sentences = (text: string): string[] =>
  text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.replace(/[*_`#]/g, '').trim())
    .filter(s => s.length > 3)

const NEGATED = /\b(not|no|never|haven'?t|hasn'?t|didn'?t|couldn'?t|can'?t|won'?t|isn'?t|aren'?t|before|if|whether|should|once|until|to see|untested|unverified)\b/i
const TESTS_PASS = /\btests?\b[^.]{0,30}\b(pass(es|ed|ing)?|green)\b|\bpass(es|ed|ing)?\b[^.]{0,20}\btests?\b/i
const CHECKED = /\b(i('ve| have)? )?(verified|confirmed|tested)\b|\b(now works|it works|works now|is fixed|are fixed|i fixed)\b/i

/** What a reply claims that this turn's commands do not back up. */
export const unbackedClaims = (answer: string, did: { isTestRun: boolean; isCommandRun: boolean }): string[] => {
  const said = sentences(answer).filter(s => !NEGATED.test(s))
  const out: string[] = []

  if (!did.isTestRun && said.some(s => TESTS_PASS.test(s))) {
    out.push('Check this: it says tests pass, but no test ran in this turn.')
  } else if (!did.isCommandRun && said.some(s => CHECKED.test(s))) {
    out.push('Check this: it says this works or was checked, but no command ran in this turn.')
  }

  return out
}

const LOOSE = /\b(not (yet )?(been )?(verified|tested|checked|confirmed|seen|tried)|haven'?t (verified|tested|checked|seen|tried|run)|couldn'?t (verify|test|check|run)|untested|unverified|follow[- ]up|for later|still (open|to do|needs)|TODO)\b/i

export const looseEnds = (answer: string): string[] => sentences(answer).filter(s => LOOSE.test(s)).map(s => oneLine(s, 160)).slice(0, 6)

export const addLoose = (kept: readonly string[], more: readonly string[]): string[] => [...kept.filter(k => !more.includes(k)), ...more].slice(-30)

export const closingQuestion = (text: string): string | null => {
  const last = sentences(text).pop() ?? ''

  return last.endsWith('?') ? oneLine(last, 200) : null
}

const TEST = /(^|&&|;|\|)\s*((npm|pnpm|yarn|bun)\s+(run\s+)?test|vitest|jest|pytest|python3?\s+-m\s+(pytest|unittest)|(go|cargo|swift|deno|dotnet|mvn|gradle)\s+test|(\.\/)?gradlew\s+test|make\s+(test|check)|rspec|[^\s&;|]*claude"?\s+plugin\s+test)\b/

export const isTestCommand = (command: string): boolean => TEST.test(command)

const WORTH_KEEPING = /^((npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|test|build|lint)|pytest|python3?\s+(-m\s+)?[\w./-]+(\.py)?|(go|cargo|swift)\s+(run|test|build)|make(\s+[\w-]+)?|docker compose up)(\s|$)/
const SECRETISH = /(sk-|ghp_|github_pat_|AKIA|passw|secret|token|api[_-]?key|\/Users\/|\/home\/|@\S+\.\w)/i

/** Remembers how this folder is run and tested. Anything that looks private is not kept. */
export const addCommand = (kept: readonly string[], command: string): string[] => {
  const text = command.trim()

  if (text.length > 80 || text.includes('\n') || /[&;|<>]/.test(text) || !WORTH_KEEPING.test(text) || SECRETISH.test(text)) {
    return [...kept]
  }

  return [...kept.filter(c => c !== text), text].slice(-8)
}

const SENSITIVE = /(^|[/_.-])(auth|login|signin|password|passwd|secret|token|credential|payment|billing|checkout|stripe|permission|security|\.env)([/_.-]|s\b|$)/i
const GENERATED = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|\.min\.(js|css)$|(^|\/)(dist|build|node_modules)\/)/

export const isSensitive = (path: string): boolean => SENSITIVE.test(path)

export const bigFileWarning = (path: string, size: number): string | null =>
  GENERATED.test(path)
    ? `${baseName(path)} is usually generated by a tool, not edited by hand.`
    : size > BIG_CHARS
      ? `${baseName(path)} is very large (${Math.round(size / 1000)} KB).`
      : null

export type Server = { name: string; pid: string; port: string }

/** Reads `lsof -nP -iTCP -sTCP:LISTEN`. */
export const parseServers = (out: string): Server[] => {
  const seen = new Map<string, Server>()

  for (const line of out.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    const port = /:(\d+)\s*(\(LISTEN\))?$/.exec(line.trim())?.[1]

    if (parts.length > 2 && port !== undefined) {
      seen.set(port, { name: parts[0] ?? '?', pid: parts[1] ?? '', port })
    }
  }

  return [...seen.values()].sort((a, b) => Number(a.port) - Number(b.port)).slice(0, 25)
}

export type Day = { date: string; turns: number; files: string[]; failed: number; asks: string[] }

export const emptyDay = (date: string): Day => ({ date, turns: 0, files: [], failed: 0, asks: [] })

export const addToDay = (day: Day | undefined, date: string, turn: { files: string[]; failed: number; ask: string }): Day => {
  const base = day?.date === date ? day : emptyDay(date)

  return {
    date,
    turns: base.turns + 1,
    files: [...new Set([...base.files, ...turn.files])].slice(-40),
    failed: base.failed + turn.failed,
    asks: turn.ask === '' || base.asks.includes(turn.ask) ? base.asks : [...base.asks, turn.ask].slice(-12),
  }
}

export const dayText = (d: Day): string =>
  [
    `Today (${d.date}): ${d.turns} turn${d.turns === 1 ? '' : 's'}, ${d.files.length} file${d.files.length === 1 ? '' : 's'} changed, ${d.failed} failed command${d.failed === 1 ? '' : 's'}.`,
    ...(d.asks.length === 0 ? [] : ['Asked for:', ...d.asks.map(a => `- ${a}`)]),
    ...(d.files.length === 0 ? [] : [`Files: ${d.files.join(', ')}`]),
  ].join('\n')

export const safeAsk = (text: string): string => (SECRETISH.test(text) ? '' : oneLine(text, 90))

export const quote = (text: string): string => (text.length > 600 ? `${text.slice(0, 599)}…` : text).replace(/^/gm, '> ')
