export type HelpersShow = { off: string[]; quiet: boolean }

declare module 'claude-code' {
  interface PluginState {
    helpers: {
      panelQuery: string
      show: Shaped<{ off: string[]; quiet: boolean }>
      tab: 'switches' | 'changes' | 'steps' | 'notes'
      changes: Shaped<{ path: string; added: number; removed: number }[]>
      turn: Shaped<{ usd: number | null; failed: number; isTested: boolean }>
      steps: Shaped<{ label: string; status: string; startedAt: number | null; endedAt: number | null }[]>
      footers: Shaped<{ tail: string; line: string; extra: string[] }[]>
      notes: Shaped<string[]>
      shortcuts: Shaped<{ label: string; text: string }[]>
      testCommand: string
      lastTime: string
      usualFor: Shaped<Record<string, number>>
      diff: Shaped<{ path: string; lines: string[] }>
    }
  }
}
