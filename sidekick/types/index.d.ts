declare module 'claude-code' {
  interface PluginState {
    sidekick: {
      off: Shaped<string[]>
      tab: 'loose' | 'rules' | 'queue' | 'today' | 'project' | 'servers' | 'rewind'
      rules: Shaped<{ text: string; isOn: boolean }[]>
      loose: Shaped<string[]>
      queue: Shaped<string[]>
      commands: Shaped<string[]>
      day: Shaped<{ date: string; turns: number; files: string[]; failed: number; asks: string[] }>
      under: Shaped<{ tail: string; lines: string[] }[]>
      marks: Shaped<string[]>
      servers: Shaped<{ name: string; pid: string; port: string }[]>
      second: string
      rewind: Shaped<{ tail: string; files: string[]; report: string }>
    }
  }
}
