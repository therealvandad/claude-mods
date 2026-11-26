export type Kind =
  | 'risky'
  | 'testgap'
  | 'complexity'
  | 'todo'
  | 'dead'
  | 'naming'
  | 'cycle'
  | 'api'
  | 'deps'
  | 'license'
  | 'comment'
  | 'magic'
  | 'errors'
  | 'logging'
  | 'migration'
  | 'config'
  | 'perf'
  | 'a11y'
  | 'budget'

export type Sev = 'warn' | 'hint'

export type Finding = {
  id: string
  kind: Kind
  sev: Sev
  file: string
  line: number
  snippet: string
  msg: string
  turn: number
}

export type FileRec = {
  path: string
  edits: number
  added: number
  removed: number
  isNew: boolean
  imports: string[]
  at: number
}

export type Cfg = {
  budget: number | null
  off: string[]
  toast: boolean
  readFiles: boolean
}

export type Meta = {
  turn: number
  turnLines: number
  budgetWarned: boolean
  lastToastAt: number
  seen: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'review-kit': {
      files: Shaped<FileRec[]>
      findings: Shaped<Finding[]>
      dismissed: Shaped<string[]>
      checks: Shaped<Record<string, boolean>>
      cfg: Shaped<Cfg>
      meta: Shaped<Meta>
      tab: string
    }
  }
}
