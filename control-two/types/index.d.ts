export type Tab = 'quick' | 'rules' | 'health' | 'updates' | 'backups' | 'hooks' | 'graph' | 'changes' | 'feedback' | 'diag'
export type Kind = 'band' | 'toasts' | 'sounds' | 'status'
export type Metric = 'ctx' | 'cost' | 'limit'
export type SaveMode = 'saved' | 'session'
export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'
export type Density = 'compact' | 'normal' | 'airy'
export type IconPack = 'letters' | 'symbols' | 'minimal'

/** One row visibility rule: while the metric passes the test, the mod's row (or toast, sound, status) is hidden or shown. */
export type Rule = { mod: string; kind: Kind; action: 'hide' | 'show'; metric: Metric; op: 'ge' | 'lt'; value: number }
/** What a rule changed: the value before (`orig`) and the value the rule set. Only a switch a rule moved is restored. */
export type Applied = Record<string, { orig: boolean; set: boolean }>

export type Pin = { mod: string; version: string; note: string }
export type Note = { at: number; mod: string; text: string }
export type SnapOwn = { recording: boolean; persist: SaveMode; rules: Rule[]; pins: Pin[] }
export type Snap = { at: number; label: string; overrides: Record<string, boolean>; own: SnapOwn }

export type InstalledStatus = 'enabled' | 'disabled' | 'error'
export type Installed = { id: string; name: string; market: string; version: string; scope: string; status: InstalledStatus }
export type InstalledState = { loadedAt: number; list: Installed[]; error: string }
export type CliState = { status: 'unknown' | 'path' | 'bundled' | 'none'; at: number }

/** An action waiting for its second command. It lives in the session only and expires. */
export type Pending = { kind: 'reset' | 'restore'; createdAt: number; expiresAt: number; n: number; steps: string[] }
export type Progress = { label: string; done: number; total: number; failed: string; isRunning: boolean }

export type Light = 'green' | 'amber' | 'red' | 'grey'
export type HealthRow = { mod: string; light: Light; found: number; expected: number; note: string }
export type HealthState = { at: number; rows: HealthRow[]; conflicts: string[] }
export type Stat = { n: number; ms: number; max: number }
export type ErrEntry = { at: number; plugin: string; text: string }
export type OrderRow = { index: number; plugin: string; tier: string; outcome: string; ms: number }
export type OrderState = { event: string; at: number; rows: OrderRow[] }
export type Refusal = { at: number; plugin: string; name: string; reason: string }
export type StorageRow = { key: string; bytes: number }

declare module 'claude-code' {
  interface PluginState {
    'control-two': {
      tab: Tab
      page: number
      notice: string
      selected: string
      /** The global recording flag this mod keeps. Other mods do not have to read it; this mod documents it. */
      recording: boolean
      persist: SaveMode
      updatesAt: number
      rules: Shaped<Rule[]>
      applied: Shaped<Applied>
      pins: Shaped<Pin[]>
      notes: Shaped<Note[]>
      snaps: Shaped<Snap[]>
      pending: Shaped<Pending | null>
      progress: Shaped<Progress | null>
      installed: Shaped<InstalledState | null>
      cli: Shaped<CliState>
      health: Shaped<HealthState | null>
      timing: Shaped<Record<string, Stat>>
      links: Shaped<Record<string, Stat>>
      errors: Shaped<ErrEntry[]>
      order: Shaped<OrderState | null>
      refusals: Shaped<Refusal[]>
      storage: Shaped<StorageRow[]>
    }
  }
}
