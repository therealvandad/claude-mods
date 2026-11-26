// The safe formula language of layout-kit. Hand-written tokenizer and recursive-descent parser, NO eval, no
// Function, no property access: the only things a formula can name are the metrics listed in METRIC_NAMES.
//
//   formula   := term (('+' | '-') term)*                    (custom tiles, goals)
//   condition := and ('||' and)*                             (rules, badges)
//   and       := compare ('&&' compare)*
//   compare   := formula (('>' | '>=' | '<' | '<=' | '==' | '!=') formula)?
//   term      := unary (('*' | '/') unary)*
//   unary     := '-' unary | primary
//   primary   := number | metric | '(' formula-or-condition ')'
//
// Limits: 80 characters, 40 tokens, nesting depth 8, numbers of at most 9 digits plus up to 6 decimals, every
// intermediate result below 1e15. Division by zero is 0 (so errors/calls is 0 before the first call).

export const MAX_LEN = 80
export const MAX_TOKENS = 40
export const MAX_DEPTH = 8
const MAX_ABS = 1e15

/** The names a formula may use. Anything else is an error, never a lookup. */
export const METRIC_NAMES = [
  'calls',
  'errors',
  'files',
  'edits',
  'bash',
  'prompts',
  'turns',
  'spend',
  'budget',
  'ctx',
  'limit',
  'mins',
  'todo_open',
  'todo_done',
  'todo_all',
] as const

export type MetricName = (typeof METRIC_NAMES)[number]
export type Metrics = Record<MetricName, number>

const NAME_SET: ReadonlySet<string> = new Set(METRIC_NAMES)

type BinOp = '+' | '-' | '*' | '/' | '>' | '>=' | '<' | '<=' | '==' | '!=' | '&&' | '||'

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'name'; n: MetricName }
  | { k: 'neg'; a: Ast }
  | { k: 'bin'; op: BinOp; a: Ast; b: Ast }

export type Parsed = { ok: true; ast: Ast; names: MetricName[]; isCondition: boolean } | { ok: false; error: string }

type Tok = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'op'; v: string }

class FormulaError extends Error {}

const fail = (msg: string): never => {
  throw new FormulaError(msg)
}

const tokenize = (src: string): Tok[] => {
  const out: Tok[] = []
  let i = 0

  while (i < src.length) {
    const c = src.charAt(i)

    if (c === ' ') {
      i++
      continue
    }

    if (c >= '0' && c <= '9') {
      let j = i

      while (j < src.length && src.charAt(j) >= '0' && src.charAt(j) <= '9') {
        j++
      }
      const whole = src.slice(i, j)
      let text = whole

      if (src.charAt(j) === '.') {
        let k = j + 1

        while (k < src.length && src.charAt(k) >= '0' && src.charAt(k) <= '9') {
          k++
        }
        const frac = src.slice(j + 1, k)

        if (frac === '') {
          fail('a number needs digits after the point')
        }

        if (frac.length > 6) {
          fail('too many decimals (6 at most)')
        }
        text = `${whole}.${frac}`
        j = k
      }

      if (whole.length > 9) {
        fail('number too large (9 digits at most)')
      }
      const next = src.charAt(j)

      if ((next >= 'a' && next <= 'z') || next === '_' || next === '.') {
        fail(`unexpected "${next}" right after a number`)
      }
      out.push({ t: 'num', v: Number(text) })
      i = j
    } else if ((c >= 'a' && c <= 'z') || c === '_') {
      let j = i + 1

      while (j < src.length && ((src.charAt(j) >= 'a' && src.charAt(j) <= 'z') || (src.charAt(j) >= '0' && src.charAt(j) <= '9') || src.charAt(j) === '_')) {
        j++
      }
      out.push({ t: 'name', v: src.slice(i, j) })
      i = j
    } else if ('+-*/()'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
    } else if (c === '>' || c === '<') {
      if (src.charAt(i + 1) === '=') {
        out.push({ t: 'op', v: `${c}=` })
        i += 2
      } else {
        out.push({ t: 'op', v: c })
        i++
      }
    } else if (c === '=' && src.charAt(i + 1) === '=') {
      out.push({ t: 'op', v: '==' })
      i += 2
    } else if (c === '!' && src.charAt(i + 1) === '=') {
      out.push({ t: 'op', v: '!=' })
      i += 2
    } else if (c === '&' && src.charAt(i + 1) === '&') {
      out.push({ t: 'op', v: '&&' })
      i += 2
    } else if (c === '|' && src.charAt(i + 1) === '|') {
      out.push({ t: 'op', v: '||' })
      i += 2
    } else {
      fail(`character not allowed: ${JSON.stringify(c).slice(0, 12)}`)
    }

    if (out.length > MAX_TOKENS) {
      fail(`too long (${MAX_TOKENS} tokens at most)`)
    }
  }

  return out
}

const COMPARE = new Set(['>', '>=', '<', '<=', '==', '!='])

/** Parses `src`. With `allowCompare` the comparison and && || operators are accepted (a condition); without, only numbers, metrics, + - * / and parentheses. */
export const parse = (input: unknown, allowCompare: boolean): Parsed => {
  if (typeof input !== 'string') {
    return { ok: false, error: 'a formula is text' }
  }

  if (input.length > MAX_LEN) {
    return { ok: false, error: `too long (${MAX_LEN} characters at most)` }
  }
  const src = input.toLowerCase().trim()

  if (src === '') {
    return { ok: false, error: 'empty' }
  }
  const names = new Set<MetricName>()

  try {
    const toks = tokenize(src)
    let pos = 0
    let depth = 0
    let isCondition = false
    const peek = (): Tok | undefined => toks[pos]
    const isOp = (v: string): boolean => {
      const t = peek()

      return t !== undefined && t.t === 'op' && t.v === v
    }
    const enter = () => {
      depth++

      if (depth > MAX_DEPTH) {
        fail(`nested too deeply (${MAX_DEPTH} levels at most)`)
      }
    }

    const parseOr = (): Ast => {
      let left = parseAnd()

      while (isOp('||')) {
        if (!allowCompare) {
          fail('|| is only allowed in conditions')
        }
        pos++
        isCondition = true
        left = { k: 'bin', op: '||', a: left, b: parseAnd() }
      }

      return left
    }

    const parseAnd = (): Ast => {
      let left = parseCompare()

      while (isOp('&&')) {
        if (!allowCompare) {
          fail('&& is only allowed in conditions')
        }
        pos++
        isCondition = true
        left = { k: 'bin', op: '&&', a: left, b: parseCompare() }
      }

      return left
    }

    const parseCompare = (): Ast => {
      const left = parseSum()
      const t = peek()

      if (t !== undefined && t.t === 'op' && COMPARE.has(t.v)) {
        if (!allowCompare) {
          fail(`${t.v} is only allowed in conditions`)
        }
        pos++
        isCondition = true
        const right = parseSum()
        const again = peek()

        if (again !== undefined && again.t === 'op' && COMPARE.has(again.v)) {
          fail('compare once: use && to combine comparisons')
        }

        return { k: 'bin', op: t.v as BinOp, a: left, b: right }
      }

      return left
    }

    const parseSum = (): Ast => {
      let left = parseTerm()

      for (;;) {
        const t = peek()

        if (t !== undefined && t.t === 'op' && (t.v === '+' || t.v === '-')) {
          pos++
          left = { k: 'bin', op: t.v as BinOp, a: left, b: parseTerm() }
        } else {
          return left
        }
      }
    }

    const parseTerm = (): Ast => {
      let left = parseUnary()

      for (;;) {
        const t = peek()

        if (t !== undefined && t.t === 'op' && (t.v === '*' || t.v === '/')) {
          pos++
          left = { k: 'bin', op: t.v as BinOp, a: left, b: parseUnary() }
        } else {
          return left
        }
      }
    }

    const parseUnary = (): Ast => {
      if (isOp('-')) {
        pos++
        enter()
        const a = parseUnary()
        depth--

        return { k: 'neg', a }
      }

      return parsePrimary()
    }

    const parsePrimary = (): Ast => {
      const t = peek()

      if (t === undefined) {
        return fail('the formula ends too early')
      }
      pos++

      if (t.t === 'num') {
        return { k: 'num', v: t.v }
      }

      if (t.t === 'name') {
        if (!NAME_SET.has(t.v)) {
          return fail(`"${t.v.slice(0, 20)}" is not a metric (try ${METRIC_NAMES.slice(0, 6).join(', ')} ...)`)
        }
        names.add(t.v as MetricName)

        return { k: 'name', n: t.v as MetricName }
      }

      if (t.v === '(') {
        enter()
        const inner = allowCompare ? parseOr() : parseSum()

        if (!isOp(')')) {
          fail('missing )')
        }
        pos++
        depth--

        return inner
      }

      return fail(`unexpected "${t.v}"`)
    }

    const ast = allowCompare ? parseOr() : parseSum()

    if (pos < toks.length) {
      const t = toks[pos]

      fail(`unexpected "${t === undefined ? '' : t.v}"`)
    }

    return { ok: true, ast, names: [...names], isCondition }
  } catch (e) {
    if (e instanceof FormulaError) {
      return { ok: false, error: e.message }
    }

    return { ok: false, error: 'not a valid formula' }
  }
}

export const parseFormula = (src: unknown): Parsed => parse(src, false)
export const parseCondition = (src: unknown): Parsed => parse(src, true)

const check = (n: number): number => {
  if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS) {
    throw new FormulaError('result too large')
  }

  return n
}

const run = (a: Ast, m: Metrics): number => {
  switch (a.k) {
    case 'num':
      return a.v
    case 'name': {
      const v = m[a.n]

      return typeof v === 'number' && Number.isFinite(v) ? v : 0
    }
    case 'neg':
      return -run(a.a, m)
    case 'bin': {
      if (a.op === '&&') {
        return run(a.a, m) !== 0 && run(a.b, m) !== 0 ? 1 : 0
      }

      if (a.op === '||') {
        return run(a.a, m) !== 0 || run(a.b, m) !== 0 ? 1 : 0
      }
      const x = run(a.a, m)
      const y = run(a.b, m)

      switch (a.op) {
        case '+':
          return check(x + y)
        case '-':
          return check(x - y)
        case '*':
          return check(x * y)
        case '/':
          return y === 0 ? 0 : check(x / y)
        case '>':
          return x > y ? 1 : 0
        case '>=':
          return x >= y ? 1 : 0
        case '<':
          return x < y ? 1 : 0
        case '<=':
          return x <= y ? 1 : 0
        case '==':
          return Math.abs(x - y) < 1e-9 ? 1 : 0
        default:
          return Math.abs(x - y) < 1e-9 ? 0 : 1
      }
    }
  }
}

/** Evaluates a parsed formula. Never throws: a too-large result is `null`. */
export const evaluate = (p: Parsed, m: Metrics): number | null => {
  if (!p.ok) {
    return null
  }

  try {
    return check(run(p.ast, m))
  } catch {
    return null
  }
}

/** Parse and evaluate in one step; `null` when the text is not a valid formula or the result is too large. */
export const calc = (src: string, m: Metrics, allowCompare = false): number | null => evaluate(parse(src, allowCompare), m)

/** A condition is true when it evaluates to something other than 0. A bad condition is false. */
export const holds = (src: string, m: Metrics): boolean => {
  const v = calc(src, m, true)

  return v !== null && v !== 0
}

export const zeroMetrics = (): Metrics => Object.fromEntries(METRIC_NAMES.map(n => [n, 0])) as Metrics
