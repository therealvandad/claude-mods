export type Note = { id: string; t: number; cwd: string; text: string; tags: string[] }
export type Link = { id: string; t: number; url: string; title: string; tags: string[] }
export type Snip = { id: string; t: number; lang: string; name: string; code: string }
export type Cmd = { id: string; t: number; name: string; cmd: string }
export type Attach = { id: string; t: number; name: string; path: string; desc: string }
export type Term = { id: string; from: string; to: string }
export type Remind = { id: string; at: number; text: string }
export type EveryKind = 'daily' | 'weekly' | 'monthly'
export type Every = { id: string; kind: EveryKind; text: string; last: string }
export type ToolCount = { tool: string; n: number }
export type Journal = { day: string; tools: number; edits: number; prompts: number; files: string[]; top: ToolCount[] }
export type LogKind = 'tool' | 'edit' | 'prompt' | 'note' | 'remind'
export type LogRow = { t: number; kind: LogKind; text: string }
export type Settings = { keepDays: number; journal: boolean; startupToast: boolean; ci: boolean; findMax: number }
export type Profile = { name: string; settings: Settings }
export type Db = {
  v: 1
  seq: number
  notes: Note[]
  links: Link[]
  snips: Snip[]
  cmds: Cmd[]
  attach: Attach[]
  terms: Term[]
  remind: Remind[]
  every: Every[]
  journal: Journal[]
  log: LogRow[]
  profiles: Profile[]
  settings: Settings
}

declare module 'claude-code' {
  interface PluginState {
    notes: {
      db: Shaped<Db>
      tab: string
      cwd: string
      sessionStart: number
      scopeAll: boolean
      tagFilter: string
      query: string
      viewTitle: string
      viewText: string
      isArmed: boolean
    }
  }
}
