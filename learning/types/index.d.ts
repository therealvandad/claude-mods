export type Term = { term: string; def: string; at: number }
export type Card = { id: string; q: string; a: string; box: number; due: number; seen: number; at: number }
export type LogEntry = { at: number; text: string }
export type ReadItem = { id: string; title: string; url: string; topic: string; isDone: boolean; at: number }
export type ArchEntry = { path: string; desc: string }
export type WeekCounts = { ext: Record<string, number>; tools: Record<string, number> }
export type Flags = { mentor: boolean; duck: boolean; beginner: boolean; eli5: boolean; nudge: boolean }

declare module 'claude-code' {
  interface PluginState {
    learning: {
      glossary: Shaped<Term[]>
      pglossary: Shaped<Record<string, Term[]>>
      cards: Shaped<Card[]>
      log: Shaped<LogEntry[]>
      reading: Shaped<ReadItem[]>
      arch: Shaped<ArchEntry[]>
      skills: Shaped<Record<string, WeekCounts>>
      flags: Shaped<Flags>
      nudgeDay: string
      tab: string
      scope: string
      isReviewing: boolean
      isAnswerShown: boolean
    }
  }
}
