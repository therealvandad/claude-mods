export type SkinsApplied = string

declare module 'claude-code' {
  interface PluginState {
    skins: {
      applied: SkinsApplied
      focus: string
    }
  }
}
