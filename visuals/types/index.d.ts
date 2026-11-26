export type Sample = { cost: number; ctx: number }
export type VisData = {
  startedAt: number
  contextPct: number
  spendUsd: number
  budgetUsd: number
  limitPct: number
  limitKind: string
  samples: Sample[]
  tools: Record<string, number>
  days: Record<string, number>
  isLive: boolean
  isDemo: boolean
}

declare module 'claude-code' {
  interface PluginState {
    visuals: {
      data: Shaped<VisData>
      now: number
    }
  }
}
