export type Tab = 'home' | 'presets' | 'timers' | 'palette' | 'perms' | 'network' | 'changes' | 'log' | 'block' | 'rows'

declare module 'claude-code' {
  interface PluginState {
    'control-kit': {
      /** The pane's current tab. */
      tab: Tab
      /** The page of the list on that tab (0 based). */
      page: number
      /** The palette search text. */
      query: string
      /** The preset the Presets tab previews. */
      preset: string
      /** The command the Block tab tests. */
      probe: string
      /** One line the pane shows at the top after something happened. */
      notice: string
      /** Bumped whenever recorded data changes, so the pane and the row draw again. */
      rev: number
    }
  }
}
