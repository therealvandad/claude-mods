export type Config = {
  fileColours: Record<string, string>
  branchRules: { pattern: string; accent: string }[]
  sounds: Record<string, string>
  greetTemplates: string[]
  greetName: string
  tips: string[]
  tipCursor: number
  tipDay: number
  empty: Record<string, string>
  titles: Record<string, string>
  ranges: { name: string; start: string; end: string }[]
  range: string
  filters: { name: string; tool: string; ok: string; ext: string; branch: string }[]
  filter: string
  searches: { name: string; text: string }[]
  template: string
  keys: Record<string, string>
  logoHex: string
  fonts: string[]
  icons: Record<string, string>
  pack: string
  curves: { name: string; x1: number; y1: number; x2: number; y2: number }[]
  curve: string
  sched: { at: string; via: string; look: string }[]
  focus: { name: string; steps: string[] }[]
  dnd: { on: boolean; from: string; to: string; applied: boolean }
  rules: { mod: string; cond: string }[]
  hidden: string[]
  bundles: { name: string; mods: string[] }[]
  checklist: { text: string; done: boolean }[]
  glossary: { term: string; meaning: string }[]
  macros: { name: string; steps: string[] }[]
}

export type LogRow = { at: number; tool: string; ok: boolean; detail: string; file: string; branch: string; commit: boolean }
export type Run = { at: number; kind: string; line: string; ok: boolean; note: string }

declare module 'claude-code' {
  interface PluginState {
    'custom-two': {
      config: Shaped<Config>
      log: Shaped<LogRow[]>
      runs: Shaped<Run[]>
      tab: string
      page: number
      notice: string
      branch: string
      frame: number
      selected: string
      fmt: string
    }
  }
}
