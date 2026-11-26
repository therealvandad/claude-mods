export type CallRec = {
  id: string
  tool: string
  sig: string
  summary: string
  file: string
  start: number
  end: number | null
  bytes: number
  isErr: boolean
}

export type ToolTotal = { n: number; bytes: number; ms: number; errors: number }

export type Mark = { at: number; kind: 'turn-error' | 'turn-done'; ms: number }

export type Vitals = { ctx: number | null; usd: number | null; startedAt: number; at: number }

export type SpendSample = { t: number; usd: number }

export type MaskCtx = { home: string; user: string; cwd: string }

export type Digest = {
  at: number
  awayMs: number
  calls: number
  files: string[]
  filesMore: number
  errors: number
  isRunning: boolean
}

export type SnapFile = { path: string; change: string }

export type SnapRow = {
  ref: string
  n: number
  sha: string
  at: number
  subject: string
  files: SnapFile[]
  summary: string
  note: string
}

export type SnapState = { rows: SnapRow[]; loadedAt: number; error: string; isLoading: boolean }

declare module 'claude-code' {
  interface PluginState {
    extras: {
      calls: Shaped<CallRec[]>
      totals: Shaped<Record<string, ToolTotal>>
      marks: Shaped<Mark[]>
      vitals: Shaped<Vitals>
      spend: Shaped<SpendSample[]>
      maskCtx: Shaped<MaskCtx>
      digest: Shaped<Digest | null>
      snaps: Shaped<SnapState>
      snapSel: string
      replayPos: number
      lastActive: number
      isTurnRunning: boolean
      isPresenting: boolean
      isAlertsOn: boolean
      lastAlertAt: number
      isLintOn: boolean
      lintHint: string
      lastLintToastAt: number
      titleTries: number
      isTitled: boolean
    }
  }
}
