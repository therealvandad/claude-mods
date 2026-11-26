export type Kind = 'tool' | 'edit' | 'error' | 'prompt'
/** One recorded event. `f` is a file path, `x` a short prompt excerpt (only when its switch is on). */
export type Ev = { t: number; k: Kind; n: string; f?: string; ms?: number; ok?: boolean; x?: string }
/** One day's counters. */
export type DayRow = { tools: number; edits: number; errors: number; prompts: number; usd: number; pomos: number }
/** One finished turn. `usd` is the cost delta (a client-side estimate). */
export type Turn = { t: number; model: string; ms: number; usd: number; tools: number; errs: number }
export type Notice = { id: number; t: number; kind: string; text: string; read: boolean }
export type Col = 'todo' | 'doing' | 'done'
export type Card = { id: number; text: string; col: Col; pomos: number }
export type Goal = { id: number; text: string; due: number; done: boolean; fired: boolean }
export type Lib = { id: number; title: string; text: string; tags: string[] }
export type PStat = { t: number; tags: string[]; ms: number; tools: number; errs: number }
export type Session = { start: number; tools: number; edits: number; errors: number; prompts: number; usd: number }
export type Pomo = { kind: 'work' | 'break'; startedAt: number; endsAt: number; card: number; task: string }
export type Budget = { perDay: number; carry: number; asOf: string; w80: string; w100: string }

/** Everything this mod records. Counts, names and paths only: prompt text only when its switch is on. */
export type Data = {
  events: Ev[]
  days: Record<string, DayRow>
  sessions: Session[]
  turns: Turn[]
  samples: { t: number; tot: number }[]
  total: number
  lastUsd: number | null
  files: Record<string, number>
  edges: Record<string, number>
  notices: Notice[]
  noticeSeq: number
  cards: Card[]
  cardSeq: number
  goals: Goal[]
  goalSeq: number
  lib: Lib[]
  libSeq: number
  pstats: PStat[]
  pending: { tags: string[] } | null
  turnTools: number
  turnErrs: number
  turnUsd: number
  cmds: string[]
  budget: Budget
  pomo: Pomo | null
  lastDigest: string
}

/** What the pane remembers while it is open: view, filters, page, replay position, inputs. */
export type Ui = {
  group: string
  view: string
  kind: string
  page: number
  sort: string
  dir: 'asc' | 'desc'
  cols: string[]
  pos: number
  q: string
  pop: boolean
  calOff: number
  win: number
  cmp: string
  tag: string
  msg: string
  exp: string
  dig: string
}

declare module 'claude-code' {
  interface PluginState {
    'ui-two': {
      data: Shaped<Data>
      ui: Shaped<Ui>
      now: number
    }
  }
}
