// Pure helpers for tool-visuals: no `$`, no engine calls, so tests can reach them directly.

export type Input = Record<string, unknown>

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
export const stripAnsi = (text: string) => text.replace(ANSI, '')

const str = (value: unknown) => (typeof value === 'string' ? value : '')

// ---------------------------------------------------------------- formatting

export const fmtCount = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const fmtDuration = (ms: number) => {
  if (!(ms >= 0)) {
    return '0ms'
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 10_000) {
    return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s`
  }
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${minutes}m ${pad(seconds)}s`
}

export const SLOW_MS = 10_000
export const isSlow = (ms: number) => ms >= SLOW_MS

export const ordinal = (n: number) => {
  const tail = n % 100
  const suffix = tail >= 11 && tail <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'

  return `${n}${suffix}`
}

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// ---------------------------------------------------------------- 61 risk edge

const WRITES =
  /\b(rm|rmdir|mv|cp|touch|mkdir|tee|chmod|chown|ln|dd|truncate|sudo|kill|pkill|sed\s+-i|git\s+(add|commit|push|checkout|switch|reset|rebase|merge|clean|stash|pull|cherry-pick|apply|rm|mv)|npm\s+(i|install|ci|publish|uninstall)|pnpm\s+(add|install|remove)|yarn\s+(add|install|remove)|pip3?\s+(install|uninstall)|brew\s+(install|uninstall))\b|(^|[^=>-])>>?\s*(?!\/dev\/null|&)[^\s&>]/

export const isWritingCommand = (command: string) => WRITES.test(command)

export type Edge = 'error' | 'warning' | 'inactive'

export const edgeOf = (tool: string, input: Input, isErrored: boolean): Edge => {
  if (isErrored) {
    return 'error'
  }
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    return 'warning'
  }
  if (tool === 'Bash') {
    return isWritingCommand(str(input.command)) ? 'error' : 'inactive'
  }

  return 'inactive'
}

// ---------------------------------------------------------------- 62 glyphs

const GLYPHS: Record<string, string> = {
  ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', py: 'PY', go: 'GO', rs: 'RS',
  swift: 'SW', java: 'JV', kt: 'KT', rb: 'RB', c: 'C', h: 'H', cpp: 'C++', cc: 'C++', cs: 'C#',
  php: 'PHP', sh: '$_', zsh: '$_', bash: '$_', json: '{}', yaml: '≡', yml: '≡', toml: '≡',
  md: 'MD', mdx: 'MD', txt: 'TXT', html: '<>', css: 'CSS', scss: 'CSS', sql: 'SQL', lock: 'LOCK',
  ipynb: 'NB', png: 'IMG', jpg: 'IMG', jpeg: 'IMG', gif: 'IMG', webp: 'IMG', svg: 'SVG', pdf: 'PDF',
}

const NAMED: Record<string, string> = { dockerfile: 'DOCK', makefile: 'MAKE', '.env': 'ENV', '.gitignore': 'GIT' }

export const glyphFor = (path: string): string | null => {
  const base = (path.split('/').pop() ?? '').toLowerCase()
  const named = NAMED[base] ?? (base.startsWith('.env.') ? 'ENV' : undefined)

  if (named !== undefined) {
    return `‹${named}›`
  }
  const dot = base.lastIndexOf('.')

  if (dot <= 0 || dot === base.length - 1) {
    return null
  }
  const ext = base.slice(dot + 1)

  return `‹${GLYPHS[ext] ?? ext.toUpperCase().slice(0, 4)}›`
}

export const pathOf = (input: Input) => str(input.file_path) || str(input.notebook_path) || str(input.path)

// ---------------------------------------------------------------- 63 mini diff

export type DiffLine = { sign: '+' | '-'; text: string }

export const miniDiff = (before: string, after: string, max = 3): { lines: DiffLine[]; more: number } => {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  let head = 0

  while (head < a.length && head < b.length && a[head] === b[head]) {
    head += 1
  }
  let tail = 0

  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail += 1
  }
  const removed = a.slice(head, a.length - tail)
  const added = b.slice(head, b.length - tail)
  const r = Math.min(removed.length, added.length === 0 ? max : Math.max(1, max - Math.min(added.length, 2)))
  const n = Math.min(added.length, max - r)
  const lines: DiffLine[] = [
    ...removed.slice(0, r).map((text): DiffLine => ({ sign: '-', text: clip(text.trimEnd(), 90) })),
    ...added.slice(0, n).map((text): DiffLine => ({ sign: '+', text: clip(text.trimEnd(), 90) })),
  ]
  const more = removed.length - r + (added.length - n)
  const last = lines[lines.length - 1]

  if (more > 0 && last !== undefined) {
    last.text = `${last.text}  …+${more}`
  }

  return { lines, more }
}

// ---------------------------------------------------------------- 65 output size

export const outputText = (value: unknown, depth = 0): string => {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(one => outputText(one, depth + 1)).join('\n')
  }
  if (value !== null && typeof value === 'object' && depth < 4) {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^(base64|image|rawOutputPath)$/.test(key))
      .map(([, one]) => outputText(one, depth + 1))
      .filter(text => text.length > 0)
      .join('\n')
  }

  return ''
}

export const countLines = (text: string) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length)

const SIZED = /^(Bash|Read|Grep|Glob|LS|WebFetch|WebSearch|mcp__.*)$/

export const sizeBadge = (tool: string, output: unknown): string | null => {
  if (!SIZED.test(tool)) {
    return null
  }
  const file = (output as { file?: { content?: unknown } } | null | undefined)?.file
  const text = tool === 'Read' && typeof file?.content === 'string' ? file.content : outputText(output)
  const lines = countLines(text)

  if (lines >= 20) {
    return `${fmtCount(lines)} lines`
  }

  return text.length >= 4000 ? `${fmtCount(Math.round(text.length / 1024))} KB` : null
}

// ---------------------------------------------------------------- 67 network

const NET_BASH =
  /\b(curl|wget)\b|\bgit\s+(clone|fetch|pull|push)\b|\b(npm|pnpm|yarn|bun)\s+(i|install|add|publish)\b|\bpip3?\s+install\b|\b(ssh|scp)\b/

export const networkKind = (tool: string, input: Input): string | null => {
  if (tool === 'WebFetch') {
    return 'web'
  }
  if (tool === 'WebSearch') {
    return 'search'
  }
  if (tool.startsWith('mcp__')) {
    return 'mcp'
  }
  if (tool === 'Bash') {
    const command = str(input.command)

    return /\b(curl|wget)\b/.test(command) ? 'curl' : NET_BASH.test(command) ? 'net' : null
  }

  return null
}

// ---------------------------------------------------------------- 68 redaction

const RULES: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted:private-key]'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, '[redacted:api-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, '[redacted:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted:github-token]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted:aws-key]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[redacted:slack-token]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[redacted:google-key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted:jwt]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, '$1[redacted:bearer]'],
  [
    /\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|auth)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)(?=[A-Za-z0-9+])(?=[^\s"']*\d)[A-Za-z0-9+/=_.~-]{16,}/gi,
    '$1[redacted:secret]',
  ],
]

export const redact = (text: string): { text: string; count: number } => {
  let count = 0
  let out = text

  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, (...match: unknown[]) => {
      count += 1

      // Expand `$1` by hand: the replacement function form has no template.
      return replacement.replace('$1', () => String(match[1] ?? ''))
    })
  }

  return { text: out, count }
}

export const redactDeep = (value: unknown, depth = 0): { value: unknown; count: number } => {
  if (typeof value === 'string') {
    const hit = redact(value)

    return hit.count === 0 ? { value, count: 0 } : { value: hit.text, count: hit.count }
  }
  if (depth > 8 || value === null || typeof value !== 'object') {
    return { value, count: 0 }
  }
  let count = 0

  if (Array.isArray(value)) {
    const next = value.map(one => {
      const hit = redactDeep(one, depth + 1)
      count += hit.count

      return hit.value
    })

    return count === 0 ? { value, count: 0 } : { value: next, count }
  }
  const next: Record<string, unknown> = {}

  for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'base64') {
      next[key] = one
      continue
    }
    const hit = redactDeep(one, depth + 1)
    count += hit.count
    next[key] = hit.value
  }

  return count === 0 ? { value, count: 0 } : { value: next, count }
}

// ---------------------------------------------------------------- 69 retry signature

const hash = (text: string) => {
  let h = 0x811c9dc5

  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return `${h.toString(16)}-${text.length}`
}

export const signatureOf = (tool: string, input: Input) => {
  const keys = Object.keys(input)
    .filter(key => key !== 'tool' && key !== 'tool_use_id')
    .sort()

  return hash(`${tool}|${keys.map(key => `${key}=${JSON.stringify(input[key])}`).join('&')}`)
}

// ---------------------------------------------------------------- 70 failing tests

const TESTS = /\b(npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+test|vitest|jest|pytest|go\s+test|cargo\s+test|swift\s+test|mocha|rspec)\b/

export const isTestCommand = (command: string) => TESTS.test(command)

export const failingTests = (text: string, max = 5): { names: string[]; more: number } => {
  const bullets = new Set<string>()
  const vitest = new Set<string>()
  const marks = new Set<string>()
  const other = new Set<string>()
  const files = new Set<string>()

  for (const raw of stripAnsi(text).split('\n')) {
    const line = raw.trimEnd()
    let hit: RegExpExecArray | null

    if ((hit = /^\s*●\s+(.+)$/.exec(line)) !== null) {
      const name = (hit[1] ?? '').trim()

      if (!/^(Console|Test suite failed to run|Validation Warning|Deprecation)/i.test(name) && name !== '') {
        bullets.add(name)
      }
    } else if ((hit = /^\s*FAIL\s+(.+)$/.exec(line)) !== null) {
      const name = (hit[1] ?? '').trim()
      ;(name.includes(' > ') ? vitest : files).add(name)
    } else if ((hit = /^\s*(?:✕|✗|×|✘)\s+(.+)$/.exec(line)) !== null) {
      marks.add((hit[1] ?? '').replace(/\s+\(?\d+(?:\.\d+)?\s*m?s\)?$/, '').trim())
    } else if ((hit = /^(?:FAILED|ERROR)\s+(\S+)/.exec(line)) !== null) {
      other.add(hit[1] ?? '')
    } else if ((hit = /^\s*--- FAIL:\s+(\S+)/.exec(line)) !== null) {
      other.add(hit[1] ?? '')
    } else if ((hit = /^test\s+(\S+)\s+\.\.\.\s+FAILED/.exec(line)) !== null) {
      other.add(hit[1] ?? '')
    } else if ((hit = /^rspec\s+(\S+)\s*#\s*(.*)$/.exec(line)) !== null) {
      other.add(((hit[2] ?? '') || (hit[1] ?? '')).trim())
    }
  }
  const pick = [bullets, vitest, marks, other, files].find(set => set.size > 0)
  const all = pick === undefined ? [] : [...pick].filter(name => name !== '')

  return { names: all.slice(0, max).map(name => clip(name, 80)), more: Math.max(0, all.length - max) }
}

// ---------------------------------------------------------------- 71 build errors

const BUILD =
  /\b(tsc|swiftc|swift\s+build|xcodebuild|cargo\s+(build|check|clippy|test|run)|go\s+(build|vet|test|install|run)|(npm|pnpm|yarn)\s+(run\s+)?build|vite\s+build|next\s+build|make|gcc|g\+\+|clang)\b/

export const isBuildCommand = (command: string) => BUILD.test(command)

export const shortPath = (path: string) => {
  const parts = path.replace(/^\.\//, '').split('/').filter(part => part !== '')

  return parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/')
}

export const parseBuildErrors = (text: string): [string, number][] => {
  const counts = new Map<string, number>()
  const bump = (path: string) => counts.set(shortPath(path), (counts.get(shortPath(path)) ?? 0) + 1)
  let pendingRust = false

  for (const raw of stripAnsi(text).split('\n')) {
    const line = raw.trimEnd()
    let hit: RegExpExecArray | null

    if ((hit = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:/.exec(line)) !== null) {
      bump(hit[1] ?? '')
    } else if ((hit = /^(\S.*?):(\d+):(\d+)\s+-\s+error\s+TS\d+:/.exec(line)) !== null) {
      bump(hit[1] ?? '')
    } else if ((hit = /^([^\s:][^:]*?):(\d+):(\d+):\s+(?:fatal )?error:/.exec(line)) !== null) {
      bump(hit[1] ?? '')
    } else if ((hit = /^(?:\.\/)?(\S+\.go):(\d+):(\d+):\s+\S/.exec(line)) !== null) {
      bump(hit[1] ?? '')
    } else if ((hit = /^error(?:\[[A-Z]\d+\])?:\s+(.*)$/.exec(line)) !== null) {
      pendingRust = !/^(aborting|could not compile|.*warning)/.test(hit[1] ?? '')
    } else if (pendingRust && (hit = /^\s*-->\s+(.+?):(\d+):(\d+)/.exec(line)) !== null) {
      bump(hit[1] ?? '')
      pendingRust = false
    }
  }

  return [...counts.entries()].sort((x, y) => y[1] - x[1])
}

export const buildSummary = (entries: readonly [string, number][], maxFiles = 3): string | null => {
  if (entries.length === 0) {
    return null
  }
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  const shown = entries.slice(0, maxFiles).map(([file, n]) => `${file} (${n})`)
  const rest = entries.length - maxFiles

  return `${total} ${total === 1 ? 'error' : 'errors'} in ${entries.length} ${entries.length === 1 ? 'file' : 'files'}: ${shown.join(', ')}${rest > 0 ? ` +${rest} more` : ''}`
}

// ---------------------------------------------------------------- 66 group fold

export const FOLD_MIN = 6

export type GroupCall = { tool: string; tool_use_id?: string; output?: unknown }

export const groupSummary = (calls: readonly GroupCall[], durations: Readonly<Record<string, number>>) => {
  const counts = new Map<string, number>()
  let lines = 0
  let ms = 0

  for (const call of calls) {
    counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1)
    lines += countLines(call.tool === 'Read' ? str((call.output as { file?: { content?: unknown } } | undefined)?.file?.content) : outputText(call.output))
    ms += (call.tool_use_id === undefined ? undefined : durations[call.tool_use_id]) ?? 0
  }
  const parts = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([tool, n]) => `${n} ${tool}`)

  return { parts, lines, ms }
}
