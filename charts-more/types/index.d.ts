export type Note = { id: number; text: string; tags: string[] }
/** One cost sample: when, which model, and the dollars that turn added. */
export type CostSample = { t: number; m: string; d: number }
/** One day's activity: first and last minute of the day, and how many events. */
export type Day = { a: number; b: number; n: number }

/** Everything this mod records. Counts and numbers only: never a prompt, a reply or a command. */
export type Data = {
  turns: number[]
  turnAt: number[]
  tools: Record<string, number[]>
  toolTotal: Record<string, number>
  words: Record<string, number>
  wordsWeek: string
  wordsOff: boolean
  notes: Note[]
  noteSeq: number
  dirs: Record<string, number>
  cwd: string
  cost: CostSample[]
  lastCost: number
  days: Record<string, Day>
  focusStart: number
  lastAct: number
  streak: number
  best: number
  budget: number
  before: string
  after: string
  split: number
  manual: boolean
  ringOff: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'charts-more': {
      data: Shaped<Data>
      tab: string
      demo: boolean
      now: number
      enterAt: number
      openAt: number
      fadeAt: number
      sparkleAt: number
      ctxPct: number
    }
  }
}
