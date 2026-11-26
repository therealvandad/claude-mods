export type Call = { id: string; tool: string; detail: string; isDone: boolean; startedAt: number }
export type Limit = { kind: string; percent: number }
export type TimerState = { endsAt: number; totalMs: number; label: string } | null

declare module 'claude-code' {
  interface PluginState {
    workbench: {
      calls: Shaped<Call[]>
      files: Shaped<string[]>
      notes: Shaped<string[]>
      timer: Shaped<TimerState>
      now: number
      sessionStart: number
      turns: number
      contextPercent: number | null
      isBandHidden: boolean
      costUsd: number | null
      limits: Shaped<Limit[]>
      budget: number | null
      isFocus: boolean
    }
  }
}
