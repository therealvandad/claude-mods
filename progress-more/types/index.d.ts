export type Day = {
  day: string
  calls: number
  errors: number
  todoAdd: number
  todoDone: number
  bytes: number
  peakChanged: number
  peakUntested: number
  docsExported: number
  docsDocumented: number
}

/** a/b are counts (refactor: a = remaining; migration: a = old, b = new); fa/fb are file counts. */
export type Point = { at: number; a: number; b: number; fa: number; fb: number }
export type Refactor = { pattern: string; points: Point[] }
export type Migration = { oldP: string; newP: string; points: Point[] }
export type Upgrade = {
  at: number
  mgr: string
  total: number
  major: number
  minor: number
  patch: number
  other: number
  top: string[]
}
export type RevItem = { id: string; text: string; done: boolean; at: number }
export type Intent = { id: string; at: number; text: string; rating: number | null }
export type Win = { at: number; text: string }
export type PlanItem = { text: string; done: boolean }
export type Plan = { week: string; items: PlanItem[] }
export type Goal = { id: string; text: string; due: string; done: boolean; at: number }

export type Data = {
  days: Day[]
  review: RevItem[]
  refactor: Refactor | null
  migration: Migration | null
  upgrades: Upgrade[]
  intents: Intent[]
  wins: Win[]
  plan: Plan | null
  goals: Goal[]
}

export type Template = { name: string; text: string }
export type RuleEvent = 'turn.complete' | 'tests-pass' | 'tests-fail' | 'commit'
export type Rule = { id: string; event: RuleEvent; text: string; everyMin: number }
export type Fmt = { currency: string; clock: '12' | '24'; units: 'si' | 'iec' }

export type Cfg = {
  tips: string[]
  tipsOn: boolean
  templates: Template[]
  rules: Rule[]
  tiles: string[]
  keep: Record<string, number>
  fmt: Fmt
}

/** This session only (not stored across sessions). */
export type Sess = {
  startedAt: number
  changed: string[]
  tests: string[]
  docs: Record<string, Record<string, number>>
  lastToastAt: number
  lastSaveAt: number
  ruleLast: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'progress-more': {
      data: Shaped<Data>
      cfg: Shaped<Cfg>
      sess: Shaped<Sess>
      tab: string
    }
  }
}
