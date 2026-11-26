export type Verb = 'install' | 'enable' | 'disable' | 'update' | 'uninstall'
export type Scope = 'user' | 'project' | 'local'
export type Tab = 'catalog' | 'installed' | 'features' | 'bundles' | 'source' | 'log'
export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'
export type Density = 'compact' | 'normal' | 'airy'
export type IconPack = 'letters' | 'symbols' | 'minimal'

/** One command the manager can run: `claude plugin <verb> <target> --scope <scope>`. */
export type Step = { verb: Verb; target: string; scope: Scope }

/** An action that waits for `/mmdo confirm`. It lives in the session only and expires. */
export type Pending = { steps: Step[]; createdAt: number; expiresAt: number; label: string; note: string }

export type InstalledStatus = 'enabled' | 'disabled' | 'error'
export type Installed = { id: string; name: string; market: string; version: string; scope: string; status: InstalledStatus }

/** What the last read-only `plugin list` said. `list` is empty and `error` set when it could not be read. */
export type InstalledState = { loadedAt: number; list: Installed[]; error: string }

export type CliState = { status: 'unknown' | 'path' | 'bundled' | 'none'; at: number }

export type LogKind = 'pending' | 'confirm' | 'result' | 'cancel' | 'expired' | 'refused' | 'source' | 'check' | 'feature'
export type LogEntry = { at: number; kind: LogKind; text: string; argv: string; exit: number | null; head: string[] }

export type RemotePlugin = { name: string; source: string; description: string; version: string }
export type RemoteRow = { name: string; kind: 'new' | 'update'; installed: string; remote: string; description: string }
export type RemoteResult = { at: number; url: string; total: number; upToDate: number; rows: RemoteRow[]; error: string }

export type Bundles = Record<string, string[]>

declare module 'claude-code' {
  interface PluginState {
    'mod-manager': {
      tab: Tab
      page: number
      category: string
      selected: string
      selectedBundle: string
      notice: string
      market: string
      source: string
      /** The Features tab's search text (also what /mmfeatures <mod> sets). */
      featureSearch: string
      installed: Shaped<InstalledState | null>
      cli: Shaped<CliState>
      pending: Shaped<Pending | null>
      log: Shaped<LogEntry[]>
      remote: Shaped<RemoteResult | null>
      bundles: Shaped<Bundles>
    }
  }
}
