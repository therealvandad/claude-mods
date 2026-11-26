export type ProgressTab = 'goals' | 'level' | 'streak' | 'plans' | 'stats' | 'log' | 'skills'

declare module 'claude-code' {
  interface PluginState {
    progress: {
      tab: ProgressTab
      now: number
      confettiAt: number
      rev: number
    }
  }
}
