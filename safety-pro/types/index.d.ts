export type Cfg = {
  dryrun: boolean
  loopguard: boolean
  hardBudget: number | null
  autoCompact: boolean
  checkpoint: boolean
  precommit: string | null
  protect: string[]
  allow: Record<string, string[]>
}

export type LogRow = { at: number; kind: 'deny' | 'allow' | 'info'; rule: string; tool: string; detail: string; reason: string }

export type Checkpoint = { n: number; ref: string; sha: string; tree: string; at: number; label: string }

export type Pending = { n: number; ref: string; sha: string; top: string; files: string[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    'safety-pro': {
      cfg: Shaped<Cfg>
      log: Shaped<LogRow[]>
      checkpoints: Shaped<Checkpoint[]>
      pending: Shaped<Pending | null>
      activity: Shaped<string[]>
      files: Shaped<string[]>
      lastPrompt: string
      lastAnswer: string
      lastCompactAt: number
    }
  }
}
