export type ViewId = 'timeline' | 'files' | 'errors' | 'prompts' | 'spend' | 'activity' | 'lab'
/** One tool call. endedAt null means it is still running. msg is the (redacted, cut) failure text, only for failed calls. */
export type CallRec = {
  id: string
  tool: string
  detail: string
  startedAt: number
  endedAt: number | null
  isError: boolean
  msg: string
  out: number
}
/** One edited file with running totals. */
export type EditRec = { path: string; n: number; added: number; removed: number; last: number }
/** A prompt: when and how long. snip stays empty unless the prompt-snippets switch is on. */
export type PromptRec = { at: number; len: number; snip: string }
/** A reading taken when a turn completes. */
export type SampleRec = { t: number; usd: number; ctx: number }
/** What is remembered between sessions about the pane itself. */
export type UiPrefs = { view: ViewId; split: ViewId | 'none'; mini: boolean }
/** Pane state that lives for the session. */
export type UiState = {
  view: ViewId
  split: ViewId | 'none'
  mini: boolean
  sel: Record<string, string>
  open: string[]
  enterAt: number
  loadingUntil: number
  pulseAt: number
  pulseKeys: string[]
  celebrateAt: number
  celebrateN: number
  failOnce: boolean
  lastToastAt: number
}
export type LabItem = { id: number; name: string; on: boolean; list: 'a' | 'b'; pending: boolean; okAt: number }
export type LabState = {
  items: LabItem[]
  nextId: number
  editing: number
  step: number
  picks: number[]
  done: boolean
  undo: { item: LabItem; at: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    'ui-kit': {
      ui: Shaped<UiState>
      lab: Shaped<LabState>
      calls: Shaped<CallRec[]>
      edits: Shaped<EditRec[]>
      prompts: Shaped<PromptRec[]>
      samples: Shaped<SampleRec[]>
      days: Shaped<Record<string, number>>
      hours: Shaped<number[]>
      acc: Shaped<Record<string, boolean>>
      isDemo: boolean
      startedAt: number
      tick: number
      total: number
    }
  }
}
