export type Val = string | number | boolean
/** Only the preferences that differ from their default: `{ 'money.symbol': 'eur', 'toast.ms': 3000 }`. */
export type Over = Record<string, Val>
export type HistChange = { key: string; before: Val | null; after: Val | null }
export type HistEntry = { at: number; label: string; layer: 'base' | 'project' | 'branch'; scope: string; changes: HistChange[] }
export type Layers = { projects: Record<string, Over>; branches: Record<string, Over> }
export type Slot = { at: string; profile: string }
export type AutoState = { on: boolean; schedule: Slot[]; last: string }
export type Meta = { applied: string; lastTab: string }
export type Where = { cwd: string; branch: string }
export type Tab = 'general' | 'formats' | 'interface' | 'notices' | 'charts' | 'data' | 'mods' | 'profiles' | 'projects' | 'history'
export type Target = 'base' | 'project' | 'branch'
export type View = { tab: Tab; section: string; page: number; query: string; target: Target; selected: string; notice: string; name: string }
export type Pending = { at: number; over: Over; lines: string[] }

declare module 'claude-code' {
  interface PluginState {
    prefs: {
      /**
       * THE shared atom other mods read: the overrides in force right now (global, with the project and branch layers on
       * top when the scope is per-project). An absent key means that preference's default. Only prefs writes it.
       */
      prefs: Shaped<Over>
      base: Shaped<Over>
      layers: Shaped<Layers>
      history: Shaped<HistEntry[]>
      profiles: Shaped<Record<string, Over>>
      auto: Shaped<AutoState>
      meta: Shaped<Meta>
      where: Shaped<Where>
      view: Shaped<View>
      pending: Shaped<Pending | null>
    }
  }
}
