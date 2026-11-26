/** What the spend and context figures were at the last look. isKnown is false until the first reading. */
export type Usage = { ctx: number; spend: number; isKnown: boolean }
/** Recent readings for the sparklines, newest last, each list bounded. */
export type Hist = { spend: number[]; ctx: number[] }
/** A coin falling because the cost rose: `at` 0 means none. */
export type Coin = { at: number; delta: number }
/** An error shake: `at` 0 means none; `text` is the status line's words. */
export type Shake = { at: number; text: string }
/** A confetti burst: `at` 0 means none; `seed` fixes where the pieces fly. */
export type Confetti = { at: number; seed: number }
/** The lab's tab strip: the selected tab, where the underline came from, and when it began gliding (0 = settled). */
export type Tab = { sel: number; from: number; at: number }
/** A flip-clock timer: it ends at `endAt` and lasted `totalMs`. */
export type TimerState = { endAt: number; totalMs: number; label: string } | null
/** The badge label and when its sweep began (0 = settled). */
export type BadgeState = { text: string; at: number } | null
/** The lab sections that are loading, shown as skeleton bars. */
export type Loading = { ids: string[] }
/** One tool call on the conveyor. endAt 0 means it is still running. */
export type Cell = { id: string; tool: string; startAt: number; endAt: number; isErr: boolean }
/** One edited file row; `at` is when it was last edited. */
export type Edit = { path: string; at: number }
/** A running /anim demo: when it began. */
export type DemoState = { at: number } | null

declare module 'claude-code' {
  interface PluginState {
    animations: {
      now: number
      busy: boolean
      lab: boolean
      outcomes: string
      reveal: number
      usage: Shaped<Usage>
      hist: Shaped<Hist>
      coin: Shaped<Coin>
      shake: Shaped<Shake>
      confetti: Shaped<Confetti>
      tab: Shaped<Tab>
      timer: Shaped<TimerState>
      badge: Shaped<BadgeState>
      loading: Shaped<Loading>
      cells: Shaped<Cell[]>
      edits: Shaped<Edit[]>
      demo: Shaped<DemoState>
    }
  }
}
