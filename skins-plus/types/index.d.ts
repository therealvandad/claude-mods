export type SkinsPlusRev = number

declare module 'claude-code' {
  interface PluginState {
    'skins-plus': {
      // Bumped after every change so the pane redraws. The settings themselves live in $.store.
      rev: number
    }
  }
}
