// Pure detectors for review-kit. No `$`, no I/O: text in, hits out.
// Every result is a heuristic "hint"; nothing here ever blocks anything.

import type { Cfg, FileRec, Finding, Kind, Sev } from '../types'

export type Hit = { kind: Kind; sev: Sev; line: number; snippet: string; msg: string }

export type Ctx = {
  path: string
  /** The new text: Write content, or an Edit's new_string. */
  content: string
  /** An Edit's old_string ('' for a Write). */
  old: string
  isWrite: boolean
  /** The whole edited file when it was read back (bounded), else undefined. */
  corpus?: string
}

export type Detector = {
  kind: Kind
  idea: number
  title: string
  sev: Sev
  info: string
}

export const DETECTORS: Detector[] = [
  { kind: 'risky', idea: 22, title: 'Risky-change radar', sev: 'warn', info: 'edits to paths containing auth, payment, billing, migration, secret, crypto, permission' },
  { kind: 'testgap', idea: 23, title: 'Test-gap finder', sev: 'hint', info: 'changed source files with no matching test file edited this session (name heuristic)' },
  { kind: 'complexity', idea: 24, title: 'Complexity meter', sev: 'hint', info: 'functions over 50 lines or control-flow nesting deeper than 4 in new content' },
  { kind: 'todo', idea: 25, title: 'TODO collector', sev: 'hint', info: 'TODO / FIXME / HACK / XXX added by Claude' },
  { kind: 'dead', idea: 26, title: 'Dead-code hint', sev: 'hint', info: 'top-level functions never referenced again in the same file' },
  { kind: 'naming', idea: 27, title: 'Naming consistency', sev: 'hint', info: 'camelCase and snake_case declarations mixed in one edit' },
  { kind: 'cycle', idea: 28, title: 'Import-cycle warning', sev: 'warn', info: 'import cycles among files edited this session' },
  { kind: 'api', idea: 29, title: 'Public API change', sev: 'hint', info: 'added, changed or removed lines starting with export' },
  { kind: 'deps', idea: 30, title: 'Dependency diff', sev: 'hint', info: 'dependency lines in package.json, requirements*.txt, Cargo.toml' },
  { kind: 'license', idea: 31, title: 'License check', sev: 'warn', info: 'copyleft or restrictive license names present in the edit content of package metadata' },
  { kind: 'comment', idea: 32, title: 'Comment-quality lint', sev: 'hint', info: 'comments that only restate the next line' },
  { kind: 'magic', idea: 33, title: 'Magic-number spotter', sev: 'hint', info: 'unnamed numeric literals (100 or more, or odd decimals) inside expressions' },
  { kind: 'errors', idea: 34, title: 'Error-handling audit', sev: 'hint', info: 'empty catch/except, swallowed or log-only errors' },
  { kind: 'logging', idea: 35, title: 'Logging audit', sev: 'warn', info: 'log statements that mention password, token, secret, api key' },
  { kind: 'migration', idea: 36, title: 'Migration safety', sev: 'hint', info: 'DROP, TRUNCATE, renames, irreversible migrations' },
  { kind: 'config', idea: 37, title: 'Config drift watcher', sev: 'hint', info: 'edits to .env*, config/, *.yml, *.toml, Dockerfile' },
  { kind: 'perf', idea: 38, title: 'Performance hint', sev: 'hint', info: 'nested loops over the same collection, sync calls in loops' },
  { kind: 'a11y', idea: 39, title: 'Accessibility checklist', sev: 'hint', info: 'missing alt, aria or label hints in .tsx/.jsx/.html/.vue' },
  { kind: 'budget', idea: 40, title: 'Patch size budget', sev: 'warn', info: 'lines changed in one turn above /rkbudget' },
]

export const KIND_ORDER: Kind[] = DETECTORS.map(d => d.kind)

export const DEFAULT_CFG: Cfg = { budget: null, off: [], toast: true, readFiles: true }

const MAX_HITS_PER_DETECTOR = 3
const MAX_SCAN_CHARS = 60_000

// ---------------------------------------------------------------- basics

export const clip = (text: string, n = 110): string => {
  const t = text.trim().replace(/\s+/g, ' ')

  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Masks long quoted tokens and `secret = value` so a snippet never shows a secret. */
export const redact = (text: string): string =>
  text
    .replace(/(["'`])[A-Za-z0-9_\-/+=.]{20,}\1/g, '"…"')
    .replace(/\b(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization)(\s*[:=]\s*)(?!["'`]?…)[^\s,;)}]{4,}/gi, '$1$2…')

export const extOf = (path: string): string => {
  const m = /\.([A-Za-z0-9]+)$/.exec(path)

  return m ? (m[1] ?? '').toLowerCase() : ''
}

export const baseOf = (path: string): string => path.split('/').pop() ?? path

export const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

export const isCode = (path: string): boolean =>
  /\.(m?[jt]sx?|cjs|cts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|sh|lua|scala|dart)$/i.test(path) && !/\.d\.ts$/.test(path)

export const isTestPath = (path: string): boolean =>
  /(^|\/)(tests?|__tests__|specs?|e2e)\//i.test(path) ||
  /\.(test|spec)\.[A-Za-z]+$/.test(path) ||
  /_test\.(go|py|rs|rb)$/.test(path) ||
  /(^|\/)test_[^/]+\.py$/.test(path) ||
  /Tests?\.(java|kt|swift|cs)$/.test(path)

const trimLines = (text: string): string[] => text.split('\n')

const normText = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** New lines (with 1-based line numbers) that the old text did not already have. */
export const addedLines = (old: string, content: string): { n: number; text: string }[] => {
  const had = new Set(trimLines(old).map(l => l.trim()).filter(l => l !== ''))
  const out: { n: number; text: string }[] = []
  trimLines(content).forEach((text, i) => {
    const t = text.trim()

    if (t !== '' && !had.has(t)) {
      out.push({ n: i + 1, text })
    }
  })

  return out
}

/** Lines added and removed once the common head and tail lines are cut away. */
export const lineDelta = (old: string, content: string, isWrite: boolean): { added: number; removed: number } => {
  if (isWrite) {
    return { added: content === '' ? 0 : trimLines(content).length, removed: 0 }
  }
  const a = old === '' ? [] : trimLines(old)
  const b = content === '' ? [] : trimLines(content)
  let head = 0

  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++
  }
  let tail = 0

  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail++
  }

  return { added: b.length - head - tail, removed: a.length - head - tail }
}

const fresh = (matched: string, old: string): boolean => old === '' || !normText(old).includes(normText(matched))

const lineOfIndex = (text: string, index: number): number => text.slice(0, index).split('\n').length

const lineText = (text: string, n: number): string => trimLines(text)[n - 1] ?? ''

const cap = (hits: Hit[]): Hit[] => hits.slice(0, MAX_HITS_PER_DETECTOR)

// ---------------------------------------------------------------- 22 risky

const RISKY_WORDS = ['auth', 'payment', 'billing', 'migration', 'secret', 'crypto', 'permission']

export const riskyWords = (path: string): string[] => {
  const low = path.toLowerCase()

  return RISKY_WORDS.filter(w => low.includes(w))
}

export const detectRisky = (c: Ctx): Hit[] => {
  const words = riskyWords(c.path)

  return words.length === 0
    ? []
    : [{ kind: 'risky', sev: 'warn', line: 0, snippet: clip(baseOf(c.path)), msg: `hint: path mentions ${words.join(', ')}; worth a careful human look` }]
}

// ---------------------------------------------------------------- 23 test gap

const stem = (path: string): string =>
  baseOf(path)
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/\.(test|spec)$/i, '')
    .replace(/(_test|Tests?|_spec)$/i, '')
    .replace(/^test_/i, '')
    .replace(/[-_.]/g, '')
    .toLowerCase()

export const testGaps = (files: FileRec[]): { path: string; changed: number }[] => {
  const tests = files.filter(f => isTestPath(f.path)).map(f => stem(f.path))
  const out: { path: string; changed: number }[] = []

  for (const f of files) {
    const changed = f.added + f.removed

    if (!isCode(f.path) || isTestPath(f.path) || changed < 5) {
      continue
    }
    const s = stem(f.path)

    if (s === '' || tests.some(t => t === s || (s.length >= 4 && t.includes(s)))) {
      continue
    }
    out.push({ path: f.path, changed })
  }

  return out
}

// ---------------------------------------------------------------- 24 complexity

export type Fn = { name: string; line: number; len: number }

const NOT_FN = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'try', 'with', 'constructor'])

const stripStr = (line: string): string => line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')

const FN_PATTERNS: RegExp[] = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*(?:(?:public|private|protected|static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
]

const indentOf = (line: string): number => {
  const m = /^[ \t]*/.exec(line)
  const ws = m ? m[0] : ''

  return ws.replace(/\t/g, '    ').length
}

export const functionsIn = (content: string): Fn[] => {
  const lines = trimLines(content.slice(0, MAX_SCAN_CHARS))
  const out: Fn[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const py = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(line)

    if (py) {
      const base = (py[1] ?? '').replace(/\t/g, '    ').length
      let end = i

      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? ''

        if (l.trim() === '') {
          continue
        }

        if (indentOf(l) <= base) {
          break
        }
        end = j
      }
      out.push({ name: py[2] ?? '?', line: i + 1, len: end - i + 1 })
      continue
    }
    let name: string | undefined

    for (const re of FN_PATTERNS) {
      const m = re.exec(line)

      if (m && m[1] !== undefined && !NOT_FN.has(m[1])) {
        name = m[1]
        break
      }
    }

    if (name === undefined) {
      continue
    }
    let depth = 0
    let opened = false
    let end = -1

    for (let j = i; j < lines.length && j < i + 2000; j++) {
      const l = stripStr(lines[j] ?? '').replace(/\/\/.*$/, '')

      for (const ch of l) {
        if (ch === '{') {
          depth++
          opened = true
        } else if (ch === '}') {
          depth--
        }
      }

      if (opened && depth <= 0) {
        end = j
        break
      }

      if (!opened && j >= i + 3) {
        break
      }
    }

    if (end >= 0) {
      out.push({ name, line: i + 1, len: end - i + 1 })
    }
  }

  return out
}

const CONTROL = /^\s*(?:\}\s*)?(?:else\s+if|else|elif|if|for|while|switch|try|catch|except|finally|with|match|do|foreach)\b/

export const maxNesting = (content: string): { depth: number; line: number } => {
  const lines = trimLines(content.slice(0, MAX_SCAN_CHARS))
  const stack: number[] = []
  let best = { depth: 0, line: 0 }

  lines.forEach((raw, i) => {
    if (raw.trim() === '' || /^\s*(\/\/|#|\*|\/\*)/.test(raw)) {
      return
    }
    const ind = indentOf(raw)

    while (stack.length > 0 && ind <= (stack[stack.length - 1] ?? 0) && !/^\s*\}?\s*(else|elif|catch|except|finally)\b/.test(raw)) {
      stack.pop()
    }

    if (/^\s*\}?\s*(else|elif|catch|except|finally)\b/.test(raw)) {
      while (stack.length > 0 && ind <= (stack[stack.length - 1] ?? 0)) {
        stack.pop()
      }
    }

    if (CONTROL.test(raw)) {
      stack.push(ind)

      if (stack.length > best.depth) {
        best = { depth: stack.length, line: i + 1 }
      }
    }
  })

  return best
}

export const LONG_FN = 50
export const MAX_NEST = 4

export const detectComplexity = (c: Ctx): Hit[] => {
  if (!isCode(c.path) && c.content.length === 0) {
    return []
  }
  const hits: Hit[] = []

  for (const f of functionsIn(c.content)) {
    if (f.len > LONG_FN && fresh(f.name, c.old)) {
      hits.push({ kind: 'complexity', sev: 'hint', line: f.line, snippet: clip(lineText(c.content, f.line)), msg: `hint: function ${f.name} is ${f.len} lines (over ${LONG_FN}); consider splitting` })
    }
  }
  const nest = maxNesting(c.content)

  if (nest.depth > MAX_NEST) {
    hits.push({ kind: 'complexity', sev: 'hint', line: nest.line, snippet: clip(lineText(c.content, nest.line)), msg: `hint: control flow nested ${nest.depth} deep (over ${MAX_NEST}); consider early returns or helpers` })
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 25 todo

const TODO_RE = /(?:\/\/|#|--|\/\*|\*|<!--|;)\s*(TODO|FIXME|HACK|XXX)\b[:(]?\s*(.*)$/

export const detectTodos = (c: Ctx): Hit[] => {
  const hits: Hit[] = []

  for (const l of addedLines(c.old, c.content)) {
    const m = TODO_RE.exec(l.text)

    if (m) {
      hits.push({ kind: 'todo', sev: 'hint', line: l.n, snippet: clip(redact(l.text)), msg: `hint: ${m[1]} left in code` })
    }
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 26 dead code

const SKIP_DEAD = new Set(['main', 'init', 'setup', 'handler', 'default', 'constructor', 'render', 'register'])

export const definedFunctions = (content: string): { name: string; line: number }[] => {
  const out: { name: string; line: number }[] = []
  const res: RegExp[] = [
    /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/,
    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
    /^fn\s+([A-Za-z_]\w*)/,
    /^func\s+([a-z_]\w*)\s*\(/,
  ]
  trimLines(content.slice(0, MAX_SCAN_CHARS)).forEach((line, i) => {
    for (const re of res) {
      const m = re.exec(line)

      if (m && m[1] !== undefined) {
        out.push({ name: m[1], line: i + 1 })
        break
      }
    }
  })

  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const detectDead = (c: Ctx): Hit[] => {
  if (isTestPath(c.path) || !isCode(c.path)) {
    return []
  }
  const corpus = c.corpus ?? (c.isWrite ? c.content : undefined)

  if (corpus === undefined) {
    return []
  }
  const hits: Hit[] = []

  for (const f of definedFunctions(c.content)) {
    if (SKIP_DEAD.has(f.name) || /^(__|test|it$|describe$)/.test(f.name)) {
      continue
    }
    const count = (corpus.match(new RegExp(`(?<![\\w$])${escapeRe(f.name)}(?![\\w$])`, 'g')) ?? []).length

    if (count <= 1) {
      hits.push({ kind: 'dead', sev: 'hint', line: f.line, snippet: clip(lineText(c.content, f.line)), msg: `hint: ${f.name} is defined but never referenced in this file (it may be used elsewhere)` })
    }
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 27 naming

export const declaredNames = (content: string): string[] => {
  const names: string[] = []
  const res: RegExp[] = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /\bdef\s+([A-Za-z_]\w*)/g,
    /\bfn\s+([A-Za-z_]\w*)/g,
    /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g,
    /^\s*([a-z_][A-Za-z0-9_]*)\s*=(?!=)/gm,
  ]

  for (const re of res) {
    for (const m of content.slice(0, MAX_SCAN_CHARS).matchAll(re)) {
      if (m[1] !== undefined) {
        names.push(m[1])
      }
    }
  }

  return names
}

const isCamel = (n: string) => /^_?[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(n)
const isSnake = (n: string) => /^_?[a-z][a-z0-9]*(?:_[a-z0-9]+)+_?$/.test(n)

export const namingMix = (content: string): { camel: string[]; snake: string[] } => {
  const uniq = [...new Set(declaredNames(content))]

  return { camel: uniq.filter(isCamel), snake: uniq.filter(isSnake) }
}

export const detectNaming = (c: Ctx): Hit[] => {
  if (!isCode(c.path)) {
    return []
  }
  const mix = namingMix(c.content)

  if (mix.camel.length < 2 || mix.snake.length < 2) {
    return []
  }

  return [{ kind: 'naming', sev: 'hint', line: 0, snippet: clip(`camelCase: ${mix.camel.slice(0, 3).join(', ')} | snake_case: ${mix.snake.slice(0, 3).join(', ')}`), msg: 'hint: both camelCase and snake_case names are declared in this edit' }]
}

// ---------------------------------------------------------------- 28 import cycles

export const importsOf = (text: string): string[] => {
  const specs = new Set<string>()
  const src = text.slice(0, MAX_SCAN_CHARS)
  const res: RegExp[] = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?['"]([^'"\n]+)['"]/g,
    /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ]

  for (const re of res) {
    for (const m of src.matchAll(re)) {
      if (m[1] !== undefined && m[1].startsWith('.')) {
        specs.add(m[1])
      }
    }
  }

  for (const m of src.matchAll(/^\s*from\s+(\.+)([\w.]+)\s+import\b/gm)) {
    const dots = (m[1] ?? '.').length
    const mod = (m[2] ?? '').replace(/\./g, '/')
    specs.add(`${dots === 1 ? './' : '../'.repeat(dots - 1)}${mod}`)
  }

  return [...specs].slice(0, 40)
}

export const normPath = (path: string): string => {
  const out: string[] = []

  for (const seg of path.split('/')) {
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

const nodeKey = (path: string): string => normPath(path).replace(/\.(m?[jt]sx?|cjs|cts|py)$/, '').replace(/\/index$/, '')

export const resolveSpec = (from: string, spec: string): string => nodeKey(`${dirOf(from)}/${spec}`)

export const findCycles = (files: { path: string; imports: string[] }[]): string[][] => {
  const graph = new Map<string, Set<string>>()
  const names = new Map<string, string>()

  for (const f of files) {
    const k = nodeKey(f.path)
    names.set(k, f.path)
    graph.set(k, new Set(f.imports.map(s => resolveSpec(f.path, s))))
  }
  const cycles: string[][] = []
  const seen = new Set<string>()
  const color = new Map<string, number>()
  const stack: string[] = []

  const visit = (k: string): void => {
    color.set(k, 1)
    stack.push(k)

    for (const next of graph.get(k) ?? []) {
      if (!graph.has(next) || next === k) {
        continue
      }
      const c = color.get(next) ?? 0

      if (c === 1) {
        const cyc = stack.slice(stack.indexOf(next))
        const id = [...cyc].sort().join('|')

        if (!seen.has(id) && cycles.length < 5) {
          seen.add(id)
          cycles.push(cyc.map(x => names.get(x) ?? x))
        }
      } else if (c === 0) {
        visit(next)
      }
    }
    stack.pop()
    color.set(k, 2)
  }

  for (const k of graph.keys()) {
    if ((color.get(k) ?? 0) === 0) {
      visit(k)
    }
  }

  return cycles
}

// ---------------------------------------------------------------- 29 public API

const EXPORT_RE = /^\s*export\b/

export const detectApi = (c: Ctx): Hit[] => {
  if (!isCode(c.path)) {
    return []
  }
  const oldEx = trimLines(c.old).filter(l => EXPORT_RE.test(l)).map(l => l.trim())
  const newEx = trimLines(c.content).filter(l => EXPORT_RE.test(l)).map(l => l.trim())
  const hits: Hit[] = []

  if (c.isWrite) {
    if (newEx.length > 0) {
      hits.push({ kind: 'api', sev: 'hint', line: 0, snippet: clip(newEx[0] ?? ''), msg: `hint: file written with ${newEx.length} export line(s); overwriting may change its public API` })
    }

    return hits
  }
  const removed = oldEx.filter(l => !newEx.includes(l))
  const added = newEx.filter(l => !oldEx.includes(l))

  if (removed.length > 0 && added.length > 0) {
    hits.push({ kind: 'api', sev: 'hint', line: 0, snippet: clip(`${removed[0]} -> ${added[0]}`), msg: `hint: ${removed.length} export line(s) changed; callers may break` })
  } else if (removed.length > 0) {
    hits.push({ kind: 'api', sev: 'hint', line: 0, snippet: clip(removed[0] ?? ''), msg: `hint: ${removed.length} export line(s) removed; callers may break` })
  } else if (added.length > 0) {
    hits.push({ kind: 'api', sev: 'hint', line: 0, snippet: clip(added[0] ?? ''), msg: `hint: ${added.length} new export line(s); public surface grew` })
  }

  return hits
}

// ---------------------------------------------------------------- 30 dependency diff / 31 license

export const isDepFile = (path: string): boolean => /(^|\/)(package\.json|requirements[\w.-]*\.txt|Cargo\.toml)$/.test(path)

const NON_DEP_KEYS = new Set(['name', 'version', 'description', 'main', 'module', 'types', 'license', 'author', 'type', 'homepage', 'repository', 'url', 'node', 'npm', 'edition', 'rust-version', 'publish', 'readme', 'resolver'])

const depName = (line: string, path: string): string | undefined => {
  const t = line.trim()

  if (/package\.json$/.test(path)) {
    const m = /^"(@?[\w./-]+)"\s*:\s*"([^"]*)"\s*,?$/.exec(t)

    if (m && !NON_DEP_KEYS.has(m[1] ?? '') && /^([\^~<>=*]|\d|latest|git|file:|github:|workspace:|npm:|https?:)/.test(m[2] ?? '')) {
      return `${m[1]}@${m[2]}`
    }

    return undefined
  }

  if (/requirements/.test(path)) {
    const m = /^([A-Za-z0-9][\w.-]*)\s*((?:==|>=|<=|~=|!=|>|<)[^\s#;]+)?/.exec(t)

    return m && !t.startsWith('#') && !t.startsWith('-') ? `${m[1]}${m[2] ?? ''}` : undefined
  }
  const m = /^([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|\{[^}]*version\s*=\s*"([^"]*)"[^}]*\}|\{[^}]*\})/.exec(t)

  if (m && !NON_DEP_KEYS.has(m[1] ?? '')) {
    return `${m[1]}@${m[2] ?? m[3] ?? '*'}`
  }

  return undefined
}

export const dependencyDiff = (c: Ctx): { added: string[]; removed: string[] } => {
  const names = (text: string) =>
    trimLines(text.slice(0, MAX_SCAN_CHARS)).map(l => depName(l, c.path)).filter((x): x is string => x !== undefined)
  const before = names(c.old)
  const after = names(c.content)

  return { added: after.filter(x => !before.includes(x)), removed: before.filter(x => !after.includes(x)) }
}

export const detectDeps = (c: Ctx): Hit[] => {
  if (!isDepFile(c.path)) {
    return []
  }
  const d = dependencyDiff(c)

  if (d.added.length === 0 && d.removed.length === 0) {
    return []
  }
  const parts = [...d.added.slice(0, 3).map(x => `+${x}`), ...d.removed.slice(0, 2).map(x => `-${x}`)]

  return [{ kind: 'deps', sev: 'hint', line: 0, snippet: clip(parts.join('  ')), msg: `hint: dependencies changed (${d.added.length} added or changed, ${d.removed.length} removed or changed); check necessity and size` }]
}

const COPYLEFT = /\b(A?GPL(?:-\d(?:\.\d)?)?(?:-only|-or-later|\+)?|LGPL(?:-\d(?:\.\d)?)?|SSPL(?:-1\.0)?|BUSL(?:-1\.1)?|EUPL(?:-\d\.\d)?|CC-BY-NC[\w.-]*|Commons[ -]Clause|Proprietary|WTFPL|OSL-\d\.\d|CPAL-1\.0)\b/i

export const isMetaFile = (path: string): boolean => /(^|\/)(package\.json|package-lock\.json|Cargo\.toml|pyproject\.toml|setup\.cfg|METADATA)$/.test(path)

export const detectLicense = (c: Ctx): Hit[] => {
  if (!isMetaFile(c.path)) {
    return []
  }
  const hits: Hit[] = []

  for (const l of addedLines(c.old, c.content)) {
    const m = /["']?(licen[sc]es?|license_file)["']?\s*[:=]\s*(.*)$/i.exec(l.text)

    if (m) {
      const lic = COPYLEFT.exec(m[2] ?? '')

      if (lic) {
        hits.push({ kind: 'license', sev: 'warn', line: l.n, snippet: clip(l.text), msg: `hint: license name ${lic[1]} is unusual or restrictive; check it fits the project (only license text present in the edit was examined)` })
      }
    }
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 32 comment quality

const STOP = new Set(['the', 'a', 'an', 'to', 'this', 'that', 'is', 'are', 'of', 'for', 'and', 'in', 'on', 'it', 'we', 'i', 'here', 'now', 'then', 'with', 'be', 'by', 'at', 'or', 'as', 'if', 'our', 'its', 'from', 'all', 'over', 'each'])
const EXPLAINS = /\b(because|why|since|so that|note|workaround|warning|nb|todo|fixme|hack|xxx|eslint|prettier|noqa|ts-ignore|istanbul|pragma|type:|must|careful|otherwise|avoid|bug|issue|see )\b|@\w|https?:/i

export const wordsOf = (text: string): string[] =>
  (text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z]+/g) ?? [])

const codeTokens = (code: string): Set<string> => {
  const t = new Set(wordsOf(code))

  if (/\+\+|\+=\s*1\b/.test(code)) {
    ;['increment', 'add', 'plus', 'increase'].forEach(w => t.add(w))
  }

  if (/--|-=\s*1\b/.test(code)) {
    ;['decrement', 'subtract', 'decrease', 'reduce'].forEach(w => t.add(w))
  }

  if (/\b(for|while|foreach)\b/.test(code)) {
    ;['loop', 'iterate', 'each'].forEach(w => t.add(w))
  }

  if (/\bif\b/.test(code)) {
    ;['check', 'whether', 'test'].forEach(w => t.add(w))
  }

  if (/(?<![=!<>])=(?!=)/.test(code)) {
    ;['set', 'assign', 'initialize', 'store'].forEach(w => t.add(w))
  }

  if (/\bnew\b/.test(code)) {
    ;['create', 'init', 'initialize', 'instantiate', 'instance'].forEach(w => t.add(w))
  }

  if (/\b(import|require|from)\b/.test(code)) {
    ;['import', 'load'].forEach(w => t.add(w))
  }

  return t
}

export const restates = (comment: string, nextCode: string): boolean => {
  if (EXPLAINS.test(comment)) {
    return false
  }
  const cw = [...new Set(wordsOf(comment).filter(w => !STOP.has(w) && w.length > 1))]

  if (cw.length < 2 || cw.length > 7) {
    return false
  }
  const code = codeTokens(nextCode)
  const hit = cw.filter(w => code.has(w) || code.has(w.replace(/(ing|es|s|ed)$/, ''))).length

  return hit / cw.length >= 0.8
}

export const detectComments = (c: Ctx): Hit[] => {
  if (!isCode(c.path)) {
    return []
  }
  const lines = trimLines(c.content.slice(0, MAX_SCAN_CHARS))
  const had = new Set(trimLines(c.old).map(l => l.trim()))
  const hits: Hit[] = []

  for (let i = 0; i < lines.length - 1; i++) {
    const m = /^\s*(?:\/\/+|#(?!!)|--)\s?(.+)$/.exec(lines[i] ?? '')

    if (!m || had.has((lines[i] ?? '').trim())) {
      continue
    }
    let j = i + 1

    while (j < lines.length && (lines[j] ?? '').trim() === '') {
      j++
    }
    const next = lines[j] ?? ''

    if (next.trim() === '' || /^\s*(\/\/|#|--|\/\*|\*)/.test(next)) {
      continue
    }

    if (restates(m[1] ?? '', next)) {
      hits.push({ kind: 'comment', sev: 'hint', line: i + 1, snippet: clip(`${(lines[i] ?? '').trim()}  ⏎  ${next.trim()}`), msg: 'hint: comment seems to restate the code below it; a why-comment would add more' })
    }
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 33 magic numbers

const NAMED_ASSIGN = /^\s*(?:export\s+)?(?:(?:const|let|var|val|final|static|private|public|readonly|pub|type)\s+)+[^=()]*=\s*-?[\d._]+[a-zA-Z%]*\s*[;,]?\s*$/
const PY_ASSIGN = /^\s*[A-Za-z_]\w*\s*=\s*-?[\d._]+\s*$/
const PROP_NUM = /^\s*["']?[\w-]+["']?\s*:\s*-?[\d._]+(?:px|em|rem|%|ms|s)?\s*[,;]?\s*$/
const UPPER_DECL = /^\s*(?:(?:export|const|final|static|let|var|pub|public|private|readonly)\s+)*[A-Z][A-Z0-9_]*\s*[:=]/
const ALLOWED_NUMS = new Set([100, 1000, 10000, 1024, 255, 256, 360, 3600, 0.5, 0.25, 0.75, 0.1, 0.2, 1.5, 2.5, 0.01, 0.001])

export const magicNumbers = (line: string): string[] => {
  const t = line.trim()

  if (t === '' || /^(\/\/|#|\*|\/\*|--)/.test(t) || /^(import|from|export\s+\*|case\b|#include)/.test(t)) {
    return []
  }

  if (NAMED_ASSIGN.test(line) || PY_ASSIGN.test(line) || PROP_NUM.test(line) || UPPER_DECL.test(line)) {
    return []
  }
  const code = stripStr(line).replace(/\/\/.*$/, '').replace(/\s#\s.*$/, '')
  const found = [...code.matchAll(/(?<![\w.$#])(-?\d+(?:\.\d+)?)(?![\w.])/g)].map(m => m[1] ?? '')

  if (found.length >= 4) {
    return []
  }

  return found.filter(s => {
    const v = Number(s)

    return !ALLOWED_NUMS.has(Math.abs(v)) && (Math.abs(v) >= 100 || !Number.isInteger(v))
  })
}

export const detectMagic = (c: Ctx): Hit[] => {
  if (!isCode(c.path) || isTestPath(c.path)) {
    return []
  }
  const hits: Hit[] = []

  for (const l of addedLines(c.old, c.content)) {
    const nums = magicNumbers(l.text)

    if (nums.length > 0) {
      hits.push({ kind: 'magic', sev: 'hint', line: l.n, snippet: clip(redact(l.text)), msg: `hint: unnamed number ${nums[0]}; a named constant would say what it means` })
    }
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 34 error handling

const ERR_PATTERNS: { re: RegExp; msg: string }[] = [
  { re: /\bcatch\s*(?:\([^)]*\))?\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/g, msg: 'hint: empty catch block swallows the error' },
  { re: /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)?\s*=>\s*(?:\{\s*\}|undefined|null|void 0)\s*\)/g, msg: 'hint: promise rejection silently ignored' },
  { re: /\bcatch\s*(?:\(\s*(\w+)\s*\))?\s*\{\s*(?:console\.\w+|print|logger\.\w+)\(\s*\1?\s*\)\s*;?\s*\}/g, msg: 'hint: catch only logs the error; the caller never learns it failed' },
  { re: /^[ \t]*except\b[^\n:]*:[ \t]*(?:\n[ \t]*)?(?:pass|\.\.\.|continue)\b/gm, msg: 'hint: except block does nothing (pass); the error is swallowed' },
  { re: /^[ \t]*except\s*:/gm, msg: 'hint: bare except catches everything, including KeyboardInterrupt' },
  { re: /^[ \t]*rescue\b[^\n]*\n[ \t]*(?:nil|end)\b/gm, msg: 'hint: empty rescue swallows the error' },
  { re: /\b_\s*=\s*err\b/g, msg: 'hint: error value discarded' },
]

export const detectErrors = (c: Ctx): Hit[] => {
  if (!isCode(c.path)) {
    return []
  }
  const hits: Hit[] = []
  const text = c.content.slice(0, MAX_SCAN_CHARS)

  for (const p of ERR_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      if (fresh(m[0], c.old)) {
        const line = lineOfIndex(text, m.index ?? 0)
        hits.push({ kind: 'errors', sev: 'hint', line, snippet: clip(m[0]), msg: p.msg })
      }
    }
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 35 logging

const LOG_CALL = /\b(console\.(?:log|info|warn|error|debug|trace)|logger\.\w+|logging\.\w+|log\.(?:debug|info|warn|warning|error|fatal|trace|print\w*)|print|println!?|printf|fmt\.Print\w*|System\.out\.print\w*|NSLog|os_log|Log\.[a-z]|puts|echo)\s*[(!:\s`"']/
const SECRET_WORD = /(password|passwd|secret|token|credential|authorization|bearer|(?:api|secret|private|access|auth)[_-]?key)/i

export const detectLogging = (c: Ctx): Hit[] => {
  const hits: Hit[] = []

  for (const l of addedLines(c.old, c.content)) {
    if (LOG_CALL.test(l.text) && SECRET_WORD.test(l.text.replace(/^[^(]*\(/, ''))) {
      hits.push({ kind: 'logging', sev: 'warn', line: l.n, snippet: clip(redact(l.text)), msg: 'hint: log statement mentions a credential-like word; make sure the value itself is never printed' })
    }
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 36 migration safety

export const isMigrationPath = (path: string): boolean => /migrat|\.sql$|alembic|flyway|liquibase/i.test(path)

const MIGRATION_PATTERNS: { re: RegExp; msg: string; sev: Sev; strong: boolean }[] = [
  { re: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA|COLUMN|VIEW|INDEX|CONSTRAINT)\b/i, msg: 'hint: DROP cannot be undone without a backup', sev: 'warn', strong: true },
  { re: /\bALTER\s+TABLE\b[^;\n]*\bDROP\b/i, msg: 'hint: ALTER ... DROP removes data or a constraint', sev: 'warn', strong: false },
  { re: /\bTRUNCATE\b/i, msg: 'hint: TRUNCATE removes every row', sev: 'warn', strong: true },
  { re: /\bDELETE\s+FROM\s+[\w."]+\s*(?:;|$)/i, msg: 'hint: DELETE without WHERE removes every row', sev: 'warn', strong: false },
  { re: /\bRENAME\s+(?:COLUMN|TO)\b/i, msg: 'hint: rename breaks code still running during rollout', sev: 'hint', strong: false },
  { re: /\bALTER\s+(?:TABLE|COLUMN)\b[^;\n]*\b(?:ALTER\s+COLUMN\s+\w+\s+)?TYPE\b/i, msg: 'hint: column type change may rewrite the table or lose data', sev: 'hint', strong: false },
  { re: /\bADD\s+COLUMN\b(?![^;\n]*\bDEFAULT\b)[^;\n]*\bNOT\s+NULL\b/i, msg: 'hint: NOT NULL column without DEFAULT fails on existing rows', sev: 'hint', strong: false },
  { re: /\b(?:drop_table|remove_column|drop_column|dropTable|dropColumn|RemoveField|DeleteModel|op\.drop_\w+)\b/, msg: 'hint: destructive migration helper', sev: 'warn', strong: false },
]

export const detectMigration = (c: Ctx): Hit[] => {
  const inMigration = isMigrationPath(c.path)
  const hits: Hit[] = []

  for (const l of addedLines(c.old, c.content)) {
    for (const p of MIGRATION_PATTERNS) {
      if ((inMigration || p.strong) && p.re.test(l.text)) {
        hits.push({ kind: 'migration', sev: p.sev, line: l.n, snippet: clip(l.text), msg: p.msg })
        break
      }
    }
  }

  if (c.isWrite && /migrat/i.test(c.path) && /\b(upgrade|exports\.up|def up|def change|up\s*[:=(])/i.test(c.content) && !/\b(down|downgrade|rollback|revert|\+migrate Down)\b/i.test(c.content)) {
    hits.push({ kind: 'migration', sev: 'warn', line: 0, snippet: clip(baseOf(c.path)), msg: 'hint: migration has an up step but no down/downgrade/rollback; it may be irreversible' })
  }

  return cap(hits)
}

// ---------------------------------------------------------------- 37 config drift

export const isConfigPath = (path: string): boolean =>
  /(^|\/)\.env(\.[\w.-]+)?$/.test(path) ||
  /(^|\/)(config|configs|conf|settings)\//i.test(path) ||
  /\.(ya?ml|toml|ini|cfg)$/i.test(path) ||
  /(^|\/)(Dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|\.dockerignore)$/.test(path)

export const isEnvFile = (path: string): boolean => /(^|\/)\.env(\.[\w.-]+)?$/.test(path)

export const detectConfig = (c: Ctx): Hit[] => {
  if (!isConfigPath(c.path) || /(^|\/)(Cargo\.toml)$/.test(c.path)) {
    return []
  }
  const changed = addedLines(c.old, c.content)

  if (isEnvFile(c.path)) {
    const keys = changed.map(l => /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=/.exec(l.text)?.[1]).filter((k): k is string => k !== undefined)

    return [{ kind: 'config', sev: 'hint', line: 0, snippet: clip(keys.length > 0 ? `keys: ${keys.slice(0, 6).join(', ')} (values hidden)` : 'values hidden'), msg: 'hint: environment file changed; deployments and teammates need the same variables' }]
  }
  const first = changed[0]

  return [{ kind: 'config', sev: 'hint', line: first?.n ?? 0, snippet: clip(redact(first?.text ?? baseOf(c.path))), msg: `hint: config changed (${baseOf(c.path)}); behaviour may differ per environment` }]
}

// ---------------------------------------------------------------- 38 performance

const LOOP_FOR = /\bfor\s*\(?\s*(?:(?:const|let|var|auto)\s+)?[\w$,\s[\]{}]*?\s(?:of|in)\s+([\w$.]+)/
const LOOP_FOR_PY = /^\s*for\s+[\w,\s()]+\s+in\s+([\w.]+)\s*[:(]/
const LOOP_FOR_IDX = /\bfor\s*\([^;]*;[^;]*<\s*([\w$.]+)\.length\b/
const LOOP_HOF = /([\w$.]+)\.(?:forEach|map|filter|reduce|flatMap|some|every|find|findIndex)\s*\(/
const LOOP_WHILE = /^\s*while\b/
const SYNC_CALL = /\b(?:readFileSync|writeFileSync|appendFileSync|readdirSync|statSync|existsSync|execSync|spawnSync|execFileSync|time\.sleep|requests\.(?:get|post|put|delete)|urllib\.request\.urlopen|subprocess\.(?:run|check_output|call)|Thread\.sleep|sleep\s*\()/

const loopCollection = (line: string): string | null => {
  const m = LOOP_FOR_PY.exec(line) ?? LOOP_FOR_IDX.exec(line) ?? LOOP_FOR.exec(line) ?? LOOP_HOF.exec(line)

  return m ? (m[1] ?? '').replace(/^this\./, '') : LOOP_WHILE.test(line) ? '' : null
}

export const perfHits = (content: string): { line: number; msg: string }[] => {
  const lines = trimLines(content.slice(0, MAX_SCAN_CHARS))
  const stack: { ind: number; coll: string }[] = []
  const out: { line: number; msg: string }[] = []

  lines.forEach((raw, i) => {
    if (raw.trim() === '' || /^\s*(\/\/|#|\*|\/\*)/.test(raw)) {
      return
    }
    const ind = indentOf(raw)

    while (stack.length > 0 && ind <= (stack[stack.length - 1]?.ind ?? 0) && !/^\s*\}\s*(else|catch|finally)/.test(raw)) {
      stack.pop()
    }
    const code = stripStr(raw)
    const coll = loopCollection(code)

    if (coll !== null) {
      if (coll !== '' && stack.some(s => s.coll === coll)) {
        out.push({ line: i + 1, msg: `hint: nested loop over the same collection ${coll} (quadratic); a Map/Set lookup may be enough` })
      }
      stack.push({ ind, coll })
    } else if (stack.length > 0 && SYNC_CALL.test(code)) {
      out.push({ line: i + 1, msg: 'hint: synchronous call inside a loop blocks on every iteration' })
    }
  })

  return out
}

export const detectPerf = (c: Ctx): Hit[] => {
  if (!isCode(c.path)) {
    return []
  }
  const had = new Set(trimLines(c.old).map(l => l.trim()))

  return cap(
    perfHits(c.content)
      .filter(h => !had.has(lineText(c.content, h.line).trim()))
      .map(h => ({ kind: 'perf' as const, sev: 'hint' as const, line: h.line, snippet: clip(lineText(c.content, h.line)), msg: h.msg })),
  )
}

// ---------------------------------------------------------------- 39 accessibility

export const isUiFile = (path: string): boolean => /\.(tsx|jsx|html?|vue|svelte)$/i.test(path)

const TAG = /<(img|input|textarea|select|button|a|div|span|html|svg|iframe)\b((?:=>|"[^"]*"|'[^']*'|\{[^}]*\}|[^>])*)>/gi

export const a11yIssues = (content: string): { index: number; tag: string; msg: string }[] => {
  const out: { index: number; tag: string; msg: string }[] = []

  for (const m of content.slice(0, MAX_SCAN_CHARS).matchAll(TAG)) {
    const tag = (m[1] ?? '').toLowerCase()
    const attrs = m[2] ?? ''
    const has = (re: RegExp) => re.test(attrs)
    const at = m.index ?? 0

    if (tag === 'img' && !has(/\balt\b\s*=?/)) {
      out.push({ index: at, tag: m[0], msg: 'hint: <img> has no alt text (use alt="" if purely decorative)' })
    } else if ((tag === 'input' || tag === 'textarea' || tag === 'select') && !has(/\b(aria-label|aria-labelledby|id|title)\b/) && !has(/type\s*=\s*["']?(hidden|submit|button|reset|image)/)) {
      out.push({ index: at, tag: m[0], msg: 'hint: form field has no aria-label or id (a <label for> needs an id)' })
    } else if (tag === 'button' && /\/\s*$/.test(attrs) === false && !has(/\b(aria-label|aria-labelledby|title)\b/) && /<button\b[^>]*>\s*<\/button>/i.test(content.slice(at, at + m[0].length + 20))) {
      out.push({ index: at, tag: m[0], msg: 'hint: empty <button> has no accessible name' })
    } else if ((tag === 'div' || tag === 'span') && has(/\bonClick\b|\bonclick\b|@click\b|v-on:click/) && !has(/\brole\s*=/)) {
      out.push({ index: at, tag: m[0], msg: `hint: clickable <${tag}> without role/keyboard support; a <button> is accessible by default` })
    } else if (tag === 'a' && (has(/\bhref\s*=\s*["']#["']/) || (!has(/\bhref\b/) && has(/\bonClick\b|\bonclick\b|@click\b/))) && !has(/\brole\s*=/)) {
      out.push({ index: at, tag: m[0], msg: 'hint: link acts as a button (no real href); consider <button>' })
    } else if (tag === 'html' && !has(/\blang\b/)) {
      out.push({ index: at, tag: m[0], msg: 'hint: <html> has no lang attribute' })
    } else if (tag === 'iframe' && !has(/\btitle\b/)) {
      out.push({ index: at, tag: m[0], msg: 'hint: <iframe> has no title' })
    } else if (has(/\btabindex\s*=\s*["{]?[1-9]/i)) {
      out.push({ index: at, tag: m[0], msg: 'hint: positive tabindex disturbs the natural tab order' })
    }
  }

  return out
}

export const detectA11y = (c: Ctx): Hit[] => {
  if (!isUiFile(c.path)) {
    return []
  }
  const hits: Hit[] = []

  for (const i of a11yIssues(c.content)) {
    if (fresh(i.tag, c.old)) {
      hits.push({ kind: 'a11y', sev: 'hint', line: lineOfIndex(c.content, i.index), snippet: clip(i.tag), msg: i.msg })
    }
  }

  return cap(hits)
}

// ---------------------------------------------------------------- run all per-edit detectors

const PER_EDIT: Record<string, (c: Ctx) => Hit[]> = {
  risky: detectRisky,
  complexity: detectComplexity,
  todo: detectTodos,
  dead: detectDead,
  naming: detectNaming,
  api: detectApi,
  deps: detectDeps,
  license: detectLicense,
  comment: detectComments,
  magic: detectMagic,
  errors: detectErrors,
  logging: detectLogging,
  migration: detectMigration,
  config: detectConfig,
  perf: detectPerf,
  a11y: detectA11y,
}

export const runDetectors = (c: Ctx, off: readonly string[]): Hit[] => {
  const hits: Hit[] = []

  for (const [kind, fn] of Object.entries(PER_EDIT)) {
    if (off.includes(kind)) {
      continue
    }

    try {
      hits.push(...fn(c))
    } catch {
      // A detector must never break the edit it observes.
    }
  }

  return hits.slice(0, 14)
}

// ---------------------------------------------------------------- findings plumbing

export const hash = (text: string): string => {
  let h = 5381

  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }

  return (h >>> 0).toString(36)
}

export const toFinding = (hit: Hit, file: string, turn: number): Finding => ({
  id: `${hit.kind}:${hash(`${file}|${hit.msg}|${hit.snippet}`)}`,
  kind: hit.kind,
  sev: hit.sev,
  file,
  line: hit.line,
  snippet: hit.snippet,
  msg: hit.msg,
  turn,
})

export const shortPath = (path: string, cwd: string): string => {
  const root = cwd.replace(/\/$/, '')

  return root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** Findings that are computed from the whole file list rather than one edit. */
export const deriveFindings = (files: FileRec[], off: readonly string[], cwd: string): Finding[] => {
  const out: Finding[] = []

  if (!off.includes('testgap')) {
    for (const g of testGaps(files)) {
      out.push(toFinding({ kind: 'testgap', sev: 'hint', line: 0, snippet: clip(shortPath(g.path, cwd)), msg: `hint: ${g.changed} lines changed and no matching test file was edited this session (name-based guess)` }, g.path, 0))
    }
  }

  if (!off.includes('cycle')) {
    for (const cyc of findCycles(files)) {
      const names = cyc.map(p => baseOf(p))
      out.push(toFinding({ kind: 'cycle', sev: 'warn', line: 0, snippet: clip(`${names.join(' -> ')} -> ${names[0]}`), msg: 'hint: import cycle among files edited this session' }, cyc[0] ?? '', 0))
    }
  }

  return out
}

export const sortFindings = (list: Finding[]): Finding[] =>
  list
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.sev === b.f.sev ? KIND_ORDER.indexOf(a.f.kind) - KIND_ORDER.indexOf(b.f.kind) || b.i - a.i : a.f.sev === 'warn' ? -1 : 1))
    .map(x => x.f)

export const visibleFindings = (stored: Finding[], derived: Finding[], dismissed: readonly string[], off: readonly string[]): Finding[] =>
  sortFindings([...stored, ...derived].filter(f => !dismissed.includes(f.id) && !off.includes(f.kind)))

// ---------------------------------------------------------------- 21 checklist

export type CheckItem = { id: string; label: string; ask: string; kinds: Kind[] }

export const CHECKLIST: CheckItem[] = [
  { id: 'security', label: 'Security', ask: 'No secrets, auth or permission gaps; inputs validated', kinds: ['risky', 'logging', 'config'] },
  { id: 'tests', label: 'Tests', ask: 'New behaviour has tests and they pass', kinds: ['testgap'] },
  { id: 'naming', label: 'Naming', ask: 'Names are clear and consistent; no dead code', kinds: ['naming', 'dead', 'comment'] },
  { id: 'errors', label: 'Errors', ask: 'Failures are handled or surfaced, not swallowed', kinds: ['errors'] },
  { id: 'simple', label: 'Simplicity', ask: 'Functions are small; no avoidable nesting or loops', kinds: ['complexity', 'perf'] },
  { id: 'contract', label: 'Contracts', ask: 'API, dependency and license changes are intended', kinds: ['api', 'deps', 'license', 'cycle'] },
  { id: 'rollout', label: 'Rollout', ask: 'Migrations and config are safe to deploy and undo', kinds: ['migration', 'config'] },
  { id: 'leftovers', label: 'Leftovers', ask: 'TODOs and magic numbers resolved or ticketed', kinds: ['todo', 'magic'] },
  { id: 'size', label: 'Size', ask: 'The patch is small enough to review in one sitting', kinds: ['budget'] },
  { id: 'a11y', label: 'Accessibility', ask: 'UI changes work by keyboard and screen reader', kinds: ['a11y'] },
]

export const openCount = (item: CheckItem, findings: Finding[]): number => findings.filter(f => item.kinds.includes(f.kind)).length

// ---------------------------------------------------------------- 40 budget

export const budgetState = (meta: { turnLines: number; budgetWarned: boolean }, budget: number | null, delta: number): { turnLines: number; warn: boolean } => {
  const turnLines = meta.turnLines + delta

  return { turnLines, warn: budget !== null && !meta.budgetWarned && turnLines > budget }
}

// ---------------------------------------------------------------- commands text

export const parseOnOff = (text: string): boolean | undefined => {
  const t = text.trim().toLowerCase()

  return t === 'on' || t === 'true' || t === 'yes' ? true : t === 'off' || t === 'false' || t === 'no' ? false : undefined
}

export const findingLine = (n: number, f: Finding, cwd: string): string =>
  `${n}. [${f.sev === 'warn' ? 'serious hint' : 'hint'}: ${f.kind}] ${shortPath(f.file, cwd)}: ${f.msg.replace(/^hint:\s*/, '')}${f.snippet ? `\n     ${f.snippet}` : ''}`

export const summaryText = (findings: Finding[], cwd: string, limit = 12): string => {
  if (findings.length === 0) {
    return 'review-kit: no hints so far. They are heuristics only and never block anything.'
  }
  const warn = findings.filter(f => f.sev === 'warn').length

  return [
    `review-kit: ${findings.length} hint(s), ${warn} serious. Heuristics only; nothing is blocked.`,
    ...findings.slice(0, limit).map((f, i) => findingLine(i + 1, f, cwd)),
    ...(findings.length > limit ? [`... and ${findings.length - limit} more (see the pane)`] : []),
  ].join('\n')
}
