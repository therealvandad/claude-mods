/** One eased number: it slides `from` to `to` over GAUGE_MS from time `at`. Settled when from === to. */
export type Gauge = { from: number; to: number; at: number }
/** A damped spring: `pos` chases `target` with velocity `vel` (all unitless, 0 to 1). */
export type Ring = { pos: number; vel: number; target: number }
export type TimerState = {
  startAt: number
  totalMs: number
  stepMs: number
  k: number
  steps: number
  label: string
} | null
/** One tool call as the animations need it. doneAt 0 means still running; popUntil/cheerUntil 0 mean no animation is live. */
export type Run = {
  tool: string
  startedAt: number
  doneAt: number
  isTest: boolean
  popUntil: number
  cheerUntil: number
}
/** The press ripple: when it started and which chip it is on. at 0 means none. */
export type Ripple = { at: number; key: string }
export type Pulse = { until: number; tool: string }
export type Away = { at: number; breathing: boolean } | null
export type SummaryItem = { tool: string; count: number }
export type Summary = { at: number; items: SummaryItem[]; live: boolean } | null

declare module 'claude-code' {
  interface PluginState {
    motion: {
      now: number
      isOn: boolean
      gauges: Shaped<Record<string, Gauge>>
      ring: Shaped<Ring>
      timer: Shaped<TimerState>
      runs: Shaped<Record<string, Run>>
      pulse: Shaped<Pulse>
      away: Shaped<Away>
      summary: Shaped<Summary>
      ripple: Shaped<Ripple>
    }
  }
}
