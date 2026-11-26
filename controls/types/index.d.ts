export type Cfg = {
  preset: 'off' | 'work' | 'personal' | 'presenting'
  blocks: string[]
  allows: { text: string; until: number }[]
  profiles: Record<string, 'strict' | 'normal' | 'off'>
  incident: boolean
}

export type NetRow = { host: string; via: string; n: number; last: number }

export type DirRow = { dir: string; r: number; w: number; last: number }

export type LogRow = { at: number; kind: 'deny' | 'warn' | 'call' | 'info'; rule: string; tool: string; detail: string }

export type ApprovalRow = {
  at: number
  tool: string
  detail: string
  outcome: 'asked' | 'approved' | 'denied' | 'auto-denied' | 'allowed by a hook' | 'denied by a hook'
}

export type SelfRow = { label: string; verdict: 'pass' | 'other' | 'fail'; note: string }

export type SelfTest = { at: number; rows: SelfRow[] } | null

export type Pacing = { anyToast: number; sandboxToast: number }

export type View = { tab: 'mods' | 'ledger' | 'log' | 'rules' | 'pause' | 'shot'; page: number }

declare module 'claude-code' {
  interface PluginState {
    controls: {
      cfg: Shaped<Cfg>
      net: Shaped<NetRow[]>
      dirs: Shaped<DirRow[]>
      log: Shaped<LogRow[]>
      approvals: Shaped<ApprovalRow[]>
      selftest: Shaped<SelfTest>
      pacing: Shaped<Pacing>
      view: Shaped<View>
    }
  }
}
