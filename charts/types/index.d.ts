/** One tool call. out is the length of the result text; endedAt null means still running. */
export type CallRec = {
  id: string
  tool: string
  detail: string
  file?: string
  startedAt: number
  endedAt: number | null
  isError: boolean
  out: number
}
/** A prompt: only when and how long (the text is never kept). */
export type PromptRec = { at: number; len: number }
/** A finished turn. */
export type TurnRec = { start: number; end: number }
/** A reading taken when a turn completes. */
export type SampleRec = { t: number; usd: number | null; ctx: number | null; limit: number | null }
/** One edited file. marks are line numbers seen in tool inputs or results; lines is the file length when a Write gave it. */
export type EditRec = { path: string; n: number; added: number; removed: number; marks: number[]; lines: number }
/** The import specifiers found in what was written to one file. */
export type ImportRec = { path: string; imports: string[] }
/** One day's counters: tool calls plus prompts, and dollars. */
export type DayRec = { n: number; usd: number }
export type SprintRec = { at: number; min: number; label: string }
export type TodoRec = { id: number; text: string }
export type TodoState = 'open' | 'doing' | 'done' | 'gone'
export type TodoEv = { t: number; id: number; to: TodoState }

declare module 'claude-code' {
  interface PluginState {
    charts: {
      tab: string
      isDemo: boolean
      start: number
      usd: number | null
      lastUsd: number | null
      ctx: number | null
      limit: number | null
      budget: number | null
      calls: Shaped<CallRec[]>
      prompts: Shaped<PromptRec[]>
      turns: Shaped<TurnRec[]>
      samples: Shaped<SampleRec[]>
      edits: Shaped<EditRec[]>
      imports: Shaped<ImportRec[]>
      days: Shaped<Record<string, DayRec>>
      hours: Shaped<number[]>
      sprints: Shaped<SprintRec[]>
      todos: Shaped<TodoRec[]>
      todoEv: Shaped<TodoEv[]>
    }
  }
}
