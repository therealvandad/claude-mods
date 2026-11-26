export type DelightTab =
  | 'gallery'
  | 'today'
  | 'tour'
  | 'pet'
  | 'games'
  | 'cards'
  | 'retro'
  | 'type'
  | 'heat'
  | 'notes'
  | 'log'

declare module 'claude-code' {
  interface PluginState {
    delight: {
      rev: number
      tab: DelightTab
    }
  }
}
