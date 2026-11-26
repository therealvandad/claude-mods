/** One line of a text view: its text and an optional theme colour name. */
export type Line = { t: string; c?: 'success' | 'warning' | 'error' | 'subtle' | 'inactive' | 'suggestion' | 'claude' }
/** One commit of the graph: full hash, parent hashes, subject and the decoration text (refs). */
export type GraphRow = { hash: string; parents: string[]; subject: string; refs: string }
/** One script, make target or console command found in a manifest. */
export type CheatItem = { src: string; name: string; cmd: string; note: string }
/** The pane's state: group and tab, whether something is being read, and what each tab last read. */
export type ViewState = {
  group: string
  tab: string
  isBusy: boolean
  at: number
  page: number
  isCardShown: boolean
  repo: string
  views: Record<string, Line[]>
  graph: GraphRow[]
  cheats: CheatItem[]
}
/** A tickable item. */
export type CheckItem = { t: string; done: boolean }
export type Topic = { title: string; steps: CheckItem[] }
export type Card = { id: number; front: string; back: string; box: number; due: number; seen: number }
export type Term = { term: string; def: string }
export type QNote = { q: string; a: string }
export type ArchNode = { id: number; parent: number; name: string; note: string }
export type Decision = { id: number; date: string; title: string; status: string; note: string }
export type Retro = { well: string[]; improve: string[]; actions: CheckItem[] }
/** Everything the person writes in this mod (kept across sessions). */
export type Data = {
  pr: Record<string, CheckItem[]>
  path: Topic[]
  cards: Card[]
  nextCard: number
  seq: number
  words: Term[]
  qnotes: QNote[]
  arch: ArchNode[]
  nextArch: number
  decisions: Decision[]
  nextDecision: number
  retros: Record<string, Retro>
  ratings: Record<string, number>
}
/** What was recorded in this session only (switches decide what is kept). */
export type Rec = { prompts: string[]; files: string[]; todos: { t: string; s: string }[] }

declare module 'claude-code' {
  interface PluginState {
    'add-two': {
      view: Shaped<ViewState>
      data: Shaped<Data>
      rec: Shaped<Rec>
    }
  }
}
