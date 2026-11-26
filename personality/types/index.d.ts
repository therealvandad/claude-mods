export type PersonalityMood = 'cruising' | 'digging in' | 'stuck' | 'wrapping up'

declare module 'claude-code' {
  interface PluginState {
    personality: {
      now: number
      lastAt: number
      running: number
      happyUntil: number
      rev: number
    }
  }
}
