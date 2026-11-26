// Strict validation of everything read back from `$.store`. A value that does not fit is dropped, never trusted.
import { cleanOverrides } from './parse'
import { LANG_RE, MAX_BUILDS, MAX_CLUSTERS, MAX_COV, MAX_DISTRACT, MAX_FLAKY, MAX_HIST, MAX_PROJECTS, MAX_RUNS, MAX_SNIPPETS, MAX_CODE, NAME_RE } from './runs'
import type { BuildRec, Cmd, CovPoint, Distraction, ErrCluster, Flaky, Proj, Snippet, TestRun } from './runs'

const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, lo = 0, hi = 1e15): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined)
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(-max) : [])

export const cleanHist = (v: unknown): Cmd[] =>
  list(v, MAX_HIST).flatMap(x => {
    const t = isRec(x) ? num(x.t) : undefined
    const cmd = isRec(x) ? str(x.cmd, 300) : undefined

    return t !== undefined && cmd !== undefined && cmd !== '' ? [{ t, cmd }] : []
  })

export const cleanDistract = (v: unknown): Distraction[] =>
  list(v, MAX_DISTRACT).flatMap(x => {
    const t = isRec(x) ? num(x.t) : undefined
    const what = isRec(x) ? str(x.what, 120) : undefined

    return t !== undefined && what !== undefined ? [{ t, what }] : []
  })

export const cleanSnips = (v: unknown): Snippet[] =>
  list(v, MAX_SNIPPETS).flatMap(x => {
    const lang = isRec(x) ? str(x.lang, 20) : undefined
    const name = isRec(x) ? str(x.name, 40) : undefined
    const code = isRec(x) ? str(x.code, MAX_CODE) : undefined

    return lang !== undefined && name !== undefined && code !== undefined && LANG_RE.test(lang) && NAME_RE.test(name) && code.trim() !== '' ? [{ lang, name, code }] : []
  })

const cleanCounts = (v: unknown, maxKeys: number): Record<string, number> => {
  const out: Record<string, number> = {}

  if (!isRec(v)) return out

  for (const [k, n] of Object.entries(v).slice(0, maxKeys)) {
    const c = num(n)

    if (c !== undefined && k.length <= 40) out[k] = c
  }

  return out
}

export const cleanProjs = (v: unknown): Record<string, Proj> => {
  const out: Record<string, Proj> = {}

  if (!isRec(v)) return out

  for (const [k, x] of Object.entries(v).slice(0, MAX_PROJECTS)) {
    if (!isRec(x) || k.length > 1024 || !k.startsWith('/')) continue
    const first = num(x.first)
    const last = num(x.last)

    if (first === undefined || last === undefined) continue
    out[k] = { cwd: k, first, last, tools: num(x.tools) ?? 0, bash: num(x.bash) ?? 0, edits: num(x.edits) ?? 0, reads: num(x.reads) ?? 0, days: cleanCounts(x.days, 30), exts: cleanCounts(x.exts, 40) }
  }

  return out
}

const names = (v: unknown, max: number): string[] => list(v, max).filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 90))

export const cleanRuns = (v: unknown): { runs: TestRun[]; cov: CovPoint[]; flaky: Record<string, Flaky>; builds: BuildRec[]; errors: ErrCluster[] } => {
  const o = isRec(v) ? v : {}
  const runs = list(o.runs, MAX_RUNS).flatMap((x): TestRun[] => {
    if (!isRec(x)) return []
    const t = num(x.t)
    const fw = str(x.fw, 12)
    const key = str(x.key, 40)
    const pass = num(x.pass)
    const fail = num(x.fail)
    const skip = num(x.skip)

    return t !== undefined && fw !== undefined && key !== undefined && pass !== undefined && fail !== undefined && skip !== undefined ? [{ t, fw, key, pass, fail, skip, failed: names(x.failed, 40), ms: num(x.ms) ?? 0 }] : []
  })
  const cov = list(o.cov, MAX_COV).flatMap((x): CovPoint[] => {
    const t = isRec(x) ? num(x.t) : undefined
    const pct = isRec(x) ? num(x.pct, 0, 100) : undefined

    return t !== undefined && pct !== undefined && isRec(x) ? [{ t, pct, key: str(x.key, 40) ?? '' }] : []
  })
  const flaky: Record<string, Flaky> = {}

  if (isRec(o.flaky)) {
    for (const [id, x] of Object.entries(o.flaky).slice(0, MAX_FLAKY)) {
      if (!isRec(x)) continue
      const name = str(x.name, 90)
      const fw = str(x.fw, 12)
      const state = x.state === 'pass' || x.state === 'fail' ? x.state : undefined

      if (name !== undefined && fw !== undefined && state !== undefined && id.length < 120) flaky[id] = { name, fw, fails: num(x.fails) ?? 0, passes: num(x.passes) ?? 0, flips: num(x.flips) ?? 0, last: num(x.last) ?? 0, state }
    }
  }
  const builds = list(o.builds, MAX_BUILDS).flatMap((x): BuildRec[] => {
    const t = isRec(x) ? num(x.t) : undefined
    const key = isRec(x) ? str(x.key, 60) : undefined
    const ms = isRec(x) ? num(x.ms, 0, 1e9) : undefined

    return t !== undefined && key !== undefined && ms !== undefined && isRec(x) ? [{ t, key, ms, ok: x.ok === true }] : []
  })
  const errors = list(o.errors, MAX_CLUSTERS).flatMap((x): ErrCluster[] => {
    const key = isRec(x) ? str(x.key, 140) : undefined
    const sample = isRec(x) ? str(x.sample, 140) : undefined

    return key !== undefined && sample !== undefined && isRec(x) ? [{ key, sample, count: num(x.count) ?? 1, first: num(x.first) ?? 0, last: num(x.last) ?? 0 }] : []
  })

  return { runs, cov, flaky, builds, errors }
}

export const cleanMeet = (v: unknown): { isOn: boolean; at: number; snapshot: Record<string, boolean> } => {
  const o = isRec(v) ? v : {}

  return { isOn: o.isOn === true, at: num(o.at) ?? 0, snapshot: cleanOverrides(o.snapshot) }
}

export const cleanSessionPaths = (v: unknown): string[] => list(v, 50).filter((x): x is string => typeof x === 'string' && x.startsWith('/') && x.length <= 1024)
