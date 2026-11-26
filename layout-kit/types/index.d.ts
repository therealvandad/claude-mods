export type Size = 'S' | 'M' | 'L'
/** One tile on a page: a built-in id (calls, errors, ...) or `c:<name>` for a custom tile. */
export type TileRef = { id: string; size: Size }
/** A named dashboard page of tiles (up to 6 pages). */
export type Page = { name: string; tiles: TileRef[] }
/** A custom tile: text, a number you set, or a formula over the metrics. Unused fields are empty / 0. */
export type CustomDef = { id: string; kind: 'text' | 'number' | 'formula'; label: string; text: string; num: number; unit: string; expr: string }
export type RuleDef = { cond: string; msg: string; isOn: boolean }
export type BadgeDef = { name: string; cond: string }
export type GoalDef = { name: string; expr: string; target: number }
export type ButtonDef = { label: string; text: string }
/** warn and bad levels for the tile colours, in the metric's own unit. */
export type Thresholds = { ctx: number[]; limit: number[]; errors: number[]; spend: number[] }

/** Everything the user configured. Kept in the store, validated on load. */
export type Cfg = {
  pages: Page[]
  defs: CustomDef[]
  saved: Record<string, Page[]>
  byProject: Record<string, string>
  snippets: Record<string, string>
  aliases: Record<string, string>
  templates: Record<string, string>
  vars: Record<string, string>
  buttons: ButtonDef[]
  statusTpl: string
  sprite: string[]
  badges: BadgeDef[]
  goals: GoalDef[]
  rules: RuleDef[]
  recipes: Record<string, boolean>
  toolColor: Record<string, string>
  toolGlyph: Record<string, string>
  toolName: Record<string, string>
  thr: Thresholds
  budgets: Record<string, number>
}

/** What this mod recorded this session. Paths stay in memory only. */
export type Rec = {
  calls: number
  errors: number
  edits: number
  bash: number
  prompts: number
  turns: number
  todoOpen: number
  todoDone: number
  startedAt: number
  byTool: Record<string, { n: number; err: number }>
  files: string[]
}

/** Where the pane is: main tab, page, sub-tab, list page, and the last button's result line. */
export type Ui = { tab: string; page: number; sub: string; pg: number; note: string }
/** A layout import that is waiting for `/cuimport confirm`. */
export type Pending = { has: boolean; pages: Page[]; defs: CustomDef[]; diff: string }

declare module 'claude-code' {
  interface PluginState {
    'layout-kit': {
      cfg: Shaped<Cfg>
      rec: Shaped<Rec>
      ui: Shaped<Ui>
      pending: Shaped<Pending>
      armed: Shaped<Record<string, boolean>>
      earned: Shaped<string[]>
      cwd: string
      lastStatusAt: number
      lastToastAt: number
    }
  }
}
