export type Call = { id: string; tool: string; detail: string; startedAt: number; endedAt: number | null; isError: boolean }
export type ErrorRow = { tool: string; detail: string; reason: string; at: number }
export type EditRow = { path: string; n: number }
export type LimitSample = { t: number; kind: string; p: number; resetsAt: number | null }
export type GitInfo = { branch: string; ahead: number; behind: number; dirty: number } | null
export type TestRun = { at: number; ok: boolean }
export type Todo = { id: number; text: string; done: boolean }
export type PromptRow = { text: string; at: number }
export type SearchState = { query: string; hits: string[] }
export type LinkRow = { url: string; at: number }
export type DayRow = { sessions: number; calls: number; usd: number }

export type BarMode = 'thinking' | 'reading' | 'editing' | 'testing' | 'running' | 'asking'
export type BarConfig = {
  /** Item ids that are on, in the person's order (which is also their priority). */
  items: string[]
  size: 'slim' | 'normal' | 'expanded'
  theme: 'glass' | 'midnight' | 'paper' | 'neon'
  quiet: boolean
  note: string
  /** This session only: never stored. */
  goal: string
  deadline: { at: number; label: string } | null
  budget: number | null
  buttons: { label: string; text: string }[]
}
export type BarRunning = {
  id: string
  tool: string
  file: string
  plain: string
  mode: BarMode
  startedAt: number
  estimateMs: number | null
}
/** One digest of everything the bar shows, written by the event hooks so drawing reads little state. */
export type BarLive = {
  isTurn: boolean
  turnStartedAt: number
  sessionStartedAt: number
  cwd: string
  calls: number
  running: BarRunning[]
  trail: { tool: string; isOk: boolean }[]
  waiting: 'question' | 'permission' | null
  question: string
  failure: { tool: string; key: string; plain: string; reason: string; at: number } | null
  saves: number
  savedFile: string
  outcome: 'ok' | 'error' | null
  isCelebrating: boolean
  tasks: { id: string; status: string; label: string }[]
  background: number
  contextPct: number | null
  prevContextPct: number | null
  tokensLeft: number | null
  costUsd: number | null
  prevCostUsd: number | null
  turnStartUsd: number | null
  turnUsd: number | null
  todayUsd: number | null
  limit: { kind: string; pct: number; resetsAt: number | null; paceMin: number | null } | null
  trend: number[]
  added: number
  removed: number
  edited: string[]
  editedThisTurn: number
  isUntested: boolean
  /** Edited files that no passing test run has covered yet. */
  unproven?: string[]
  isCoding: boolean
  test: { ok: boolean; passed: number | null; failed: number | null } | null
  build: boolean | null
  errorCount: number
  beats: number[]
  turnsDone: number
  before: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      tab: string
      now: number
      sessionStart: number
      turns: number
      contextPercent: number | null
      costUsd: number | null
      calls: Shaped<Call[]>
      errors: Shaped<ErrorRow[]>
      edits: Shaped<EditRow[]>
      costSamples: Shaped<number[]>
      ctxSamples: Shaped<number[]>
      limitSamples: Shaped<LimitSample[]>
      git: Shaped<GitInfo>
      tests: Shaped<TestRun[]>
      todos: Shaped<Todo[]>
      prompts: Shaped<PromptRow[]>
      search: Shaped<SearchState>
      links: Shaped<LinkRow[]>
      shelf: Shaped<string[]>
      pins: Shaped<string[]>
      daily: Shaped<Record<string, DayRow>>
      lastUsd: number | null
      isSessionCounted: boolean
      isFocus: boolean
      isBandHidden: boolean
      barConfig: Shaped<BarConfig>
      barLive: Shaped<BarLive>
      isTypingHidden: boolean
      view: Shaped<{ look: 'plain' | 'rich'; clean: boolean; alert: boolean; chat: boolean; chatStyle: 'roomy' | 'clean'; rows: boolean; colors: 'app' | 'aurora' | 'midnightpro' | 'editorial' | 'obsidian' | 'abyss' | 'ember' | 'paper' | 'midnight' | 'contrast' | 'nord' | 'forest' | 'ocean' | 'rose' | 'mocha' | 'sunset' | 'lavender' | 'graphite' | 'mint' | 'berry' | 'sand' | 'solar'; size: 'small' | 'medium' | 'large'; glass: 'clear' | 'frosted' | 'solid'; corners: 'soft' | 'sharp' }>
      myPrompts: Shaped<Record<string, number>>
      editMarks: Shaped<Record<string, 'untested' | 'tested' | 'failed'>>
      slow: Shaped<Record<string, number>>
    }
  }
}
