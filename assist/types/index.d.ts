export type Modes = {
  next: boolean
  paste: boolean
  read: boolean
  coach: boolean
  rec: boolean
  recall: boolean
}

export type CallKind = 'test' | 'commit' | 'edit' | 'read' | 'bash' | 'other'

export type CallRec = {
  id: string
  tool: string
  kind: CallKind
  key: string
  label: string
  isErr: boolean
  line: string
  size: number
  at: number
  turn: number
  file: string
}

export type FileRow = { path: string; reads: number; edits: number; at: number }

export type ErrRow = { sig: string; count: number; first: number; last: number; tool: string; cmd: string; sample: string; fix: string }

export type FixRow = { n: number; sig: string; text: string; sample: string; at: number }

export type PromptRow = { text: string; at: number }

export type RecallRow = { c: string; at: number }

export type PasteLabel = { kind: string; lines: number; chars: number }

export type RecapCard = { gapMin: number; at: number }

export type Stuck = { run: string[]; lines: string[]; isEpisode: boolean }

export type Chip = { label: string; text: string }

export type Sel = { find: string; recall: string; fixes: string; task: string }

declare module 'claude-code' {
  interface PluginState {
    assist: {
      modes: Shaped<Modes>
      calls: Shaped<CallRec[]>
      files: Shaped<FileRow[]>
      errors: Shaped<ErrRow[]>
      fixes: Shaped<FixRow[]>
      prompts: Shaped<PromptRow[]>
      recall: Shaped<RecallRow[]>
      usage: Shaped<Record<string, number>>
      decisions: Shaped<string[]>
      stuck: Shaped<Stuck>
      paste: Shaped<PasteLabel | null>
      card: Shaped<RecapCard | null>
      sel: Shaped<Sel>
      tab: string
      sit: string
      report: string
      handoff: string
      skim: string
      lastAnswer: string
      turn: number
      lastToastAt: number
    }
  }
}
