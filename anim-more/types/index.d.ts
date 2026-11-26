/** Spinner choice and the two opt-in switches for the band segment. All default off. */
export type Cfg = { wave: boolean; rain: boolean; spin: string }
/** When each one-shot piece last started (ms on the shared clock); 0 means never. */
export type Marks = Record<string, number>
/** The texts the typewriter, the marquee and the sample hint show. */
export type Texts = { type: string; marquee: string }
/** The staged status-line toast: `at` 0 means none; `isStatus` is true while the status line is being painted; `last` is when the status line last showed one (0 = never). */
export type ToastState = { at: number; text: string; isStatus: boolean; last: number }
/** The spend figure and the drip: it ticks from `from` to `to` starting at `at` (0 = settled). */
export type Spend = { to: number; from: number; at: number; isKnown: boolean }
/** Days a tool call ran, the last such day, and the stage before the latest growth. */
export type Grow = { days: number; last: string; prev: number }
/** One journal day. */
export type Entry = { d: string; t: string }
/** The journal page showing and the one flipped from. */
export type JFlip = { idx: number; from: number }
/** The own sprint timer: it ends at `endAt`, `totalMs` long; null when none. */
export type SprintState = { endAt: number; totalMs: number } | null
/** The rocket's percent, where it glided from, when, and whether it follows the todos. */
export type Rocket = { pct: number; from: number; at: number; mode: 'manual' | 'todo' }
/** One todo for the rocket. */
export type Todo = { t: string; done: boolean }

declare module 'claude-code' {
  interface PluginState {
    'anim-more': {
      now: number
      busy: boolean
      lab: boolean
      tab: number
      active: number
      demo: number
      seed: number
      errs: number
      cfg: Shaped<Cfg>
      marks: Shaped<Marks>
      texts: Shaped<Texts>
      toast: Shaped<ToastState>
      spend: Shaped<Spend>
      grow: Shaped<Grow>
      journal: Shaped<Entry[]>
      jflip: Shaped<JFlip>
      sprint: Shaped<SprintState>
      rocket: Shaped<Rocket>
      todos: Shaped<Todo[]>
    }
  }
}
