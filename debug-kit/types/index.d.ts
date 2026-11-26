export type Crumb = {
  id: string
  n: number
  tool: string
  detail: string
  outcome: 'run' | 'ok' | 'fail' | 'denied'
  at: number
}

export type TestRun = {
  at: number
  cmd: string
  runner: string
  failed: string[]
  passed: string[]
  nFailed: number
  nPassed: number
  isGreen: boolean
  cov: number | null
  edits: number
}

export type Timing = { name: string; ms: number }

export type SnapCounts = {
  written: number
  updated: number
  obsolete: number
  removed: number
  failed: number
  passed: number
  unused: number
}

export type TestInfo = { at: number; cmd: string; timings: Timing[]; snaps: SnapCounts | null; snapLines: string[] }

export type Cluster = { key: string; count: number; sample: string; tools: string[]; lastAt: number }

export type Frame = { file: string; line: number; col: number; fn: string; isApp: boolean }

export type TraceInfo = { kind: string; message: string; frames: Frame[]; at: number; cmd: string }

export type Hyp = { n: number; text: string; status: 'open' | 'ok' | 'no'; at: number }

export type RecStep = { cmd: string; outcome: 'ok' | 'fail' }

export type RecState = { isOn: boolean; startedAt: number; steps: RecStep[] }

export type EnvRow = { cmd: string; out: string; isOk: boolean }

export type EnvSnap = { at: number; rows: EnvRow[] }

export type TailState = {
  path: string
  lines: string[]
  size: number
  mtimeMs: number
  at: number
  error: string
}

export type MockHit = { file: string; kind: string; name: string; line: number }

export type MockScan = { at: number; files: number; hits: MockHit[]; error: string }

export type PortInfo = { port: number; at: number; text: string; rows: string[] }

export type CmdRec = { sig: string; isOk: boolean; at: number }

export type Offer = { cmd: string; at: number }

export type LoopMark = { sig: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'debug-kit': {
      crumbs: Shaped<Crumb[]>
      crumbSeq: number
      runs: Shaped<TestRun[]>
      info: Shaped<TestInfo | null>
      clusters: Shaped<Cluster[]>
      trace: Shaped<TraceInfo | null>
      hyps: Shaped<Hyp[]>
      hypSeq: number
      rec: Shaped<RecState>
      env: Shaped<EnvSnap | null>
      tail: Shaped<TailState>
      mocks: Shaped<MockScan | null>
      port: Shaped<PortInfo | null>
      cmds: Shaped<CmdRec[]>
      offer: Shaped<Offer | null>
      loopMark: Shaped<LoopMark | null>
      testFiles: Shaped<string[]>
      edits: number
      lastToastAt: number
      isGuardOn: boolean
      tab: string
      post: string
    }
  }
}
