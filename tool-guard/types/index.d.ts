export type ReadOnlyFlag = boolean

declare module 'claude-code' {
  interface PluginState {
    'tool-guard': { isReadOnly: boolean }
  }
}
