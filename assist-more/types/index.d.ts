/** One line of a pane tab: its text and an optional theme colour name. */
export type Line = { t: string; c?: 'success' | 'warning' | 'error' | 'subtle' | 'inactive' | 'suggestion' | 'claude' }

/** The on/off switches of this mod. */
export type Flags = { risk: boolean; typo: boolean; summary: boolean; learn: boolean; defaults: boolean; plain: boolean }

/** A recorded run-book: the Bash commands seen between `/amrun start` and `/amrun stop`, secrets already masked. */
export type Runbook = { name: string; cmds: string[]; at: number }

/** A finished task and how long it took. */
export type TaskRec = { label: string; ms: number; at: number }

/** One pro or con of a decision option with its weight (1 to 5). */
export type Mark = { t: string; w: number }
export type Option = { name: string; pros: Mark[]; cons: Mark[] }
export type Decision = { question: string; options: Option[] }

/** A goal with a counter. */
export type Goal = { text: string; target: number; count: number; doneAt: number }
export type Badge = { text: string; at: number }

/** A fix pattern the user chose to keep. */
export type Fix = { from: string; to: string; at: number }

/** The small sprite set used in this mod's own pane. */
export type Sprite = { name: string; frames: string[]; pick: number }

/** A named bundle of this mod's settings. */
export type Profile = { flags: Flags; quiet: boolean[] }

/** Everything this mod stores. */
export type Db = {
  flags: Flags
  /** 24 cells, true means quiet (no toasts) in that local hour. */
  quiet: boolean[]
  runbooks: Runbook[]
  recording: { name: string; cmds: string[] } | null
  tasks: TaskRec[]
  active: { label: string; at: number } | null
  decision: Decision
  goals: Goal[]
  badges: Badge[]
  /** question -> answer -> times chosen (only while `/amdefaults on`). */
  answers: Record<string, Record<string, number>>
  fixes: Fix[]
  sprite: Sprite
  profiles: Record<string, Profile>
  /** cwd -> profile name. */
  bound: Record<string, string>
}

/** The pane's state: which tab, which run-book is open, and the scans already read. */
export type View = { tab: string; sel: string; isBusy: boolean; doctor: Line[]; project: Line[] }

declare module 'claude-code' {
  interface PluginState {
    'assist-more': {
      db: Shaped<Db>
      view: Shaped<View>
    }
  }
}
