export type Tone = 'off' | 'terse' | 'teach' | 'review'

export type Modes = {
  tone: Tone
  ask: boolean
  lang: string
  example: boolean
  rec: boolean
  hints: boolean
}

export type Named = Record<string, string>

export type AbRow = { n: number; a: string; b: string; better: '' | 'a' | 'b'; note: string; at: number }

export type MarkRow = { n: number; label: string; at: number; reply: number; total: number; excerpt: string }

export type DecisionRow = { n: number; text: string; at: number }

export type HistRow = {
  n: number
  at: number
  text: string
  clarity: number
  scope: number
  constraints: number
  total: number
  tip: string
}

export type DiffSel = { a: number; b: number }

export type Rewrite = { orig: string; text: string; notes: string[] } | null

export type DraftInfo = { chars: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    prompting: {
      modes: Shaped<Modes>
      tpls: Shaped<Named>
      ctxs: Shaped<Named>
      macros: Shaped<Named>
      queue: Shaped<string[]>
      abs: Shaped<AbRow[]>
      marks: Shaped<MarkRow[]>
      decisions: Shaped<DecisionRow[]>
      history: Shaped<HistRow[]>
      assumptions: Shaped<string[]>
      pins: Shaped<string[]>
      attached: Shaped<string[]>
      diffSel: Shaped<DiffSel>
      rewrite: Shaped<Rewrite>
      scratch: Shaped<HistRow | null>
      draftInfo: Shaped<DraftInfo>
      tab: string
      lastAnswer: string
      lastToastAt: number
    }
  }
}
