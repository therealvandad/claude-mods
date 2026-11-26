/** One line of a pane tab: its text and an optional theme colour name. */
export type Line = { t: string; c?: 'success' | 'warning' | 'error' | 'subtle' | 'inactive' | 'suggestion' | 'claude' }
/** The pane's state: the selected tab, whether git is being read, and the lines of each tab already read. */
export type ViewState = { tab: string; isBusy: boolean; at: number; note: string; views: Record<string, Line[]> }
/** A tickable release item. */
export type CheckItem = { t: string; done: boolean }
/** The release checklist shown in the pane, for one repository root. */
export type ReleaseState = { repo: string; items: CheckItem[] }
/** What this session has seen of test runs: when a test command last passed or failed, and the last edit. 0 means never. */
export type TestState = { lastPassAt: number; lastFailAt: number; lastCmd: string; editAt: number }

declare module 'claude-code' {
  interface PluginState {
    'git-kit': {
      view: Shaped<ViewState>
      release: Shaped<ReleaseState>
      tests: Shaped<TestState>
    }
  }
}
