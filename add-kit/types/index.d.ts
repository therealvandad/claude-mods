/** One line of a pane tab: its text and an optional theme colour name. */
export type Line = { t: string; c?: 'success' | 'warning' | 'error' | 'subtle' | 'inactive' | 'suggestion' | 'claude' }
/** A Bash command seen this session or an earlier day, with secrets masked. */
export type Cmd = { t: number; cmd: string }
/** A task switch the person marked with /addistract. */
export type Distraction = { t: number; what: string }
/** A saved code snippet. */
export type Snippet = { lang: string; name: string; code: string }
/** Counters for one project folder, keyed by its path. */
export type Proj = { cwd: string; first: number; last: number; tools: number; bash: number; edits: number; reads: number; days: Record<string, number>; exts: Record<string, number> }
/** One test run read from a Bash result. */
export type TestRun = { t: number; fw: string; key: string; pass: number; fail: number; skip: number; failed: string[]; ms: number }
/** One coverage reading. */
export type CovPoint = { t: number; pct: number; key: string }
/** A test name that has failed, with how often it flipped between failing and passing. */
export type Flaky = { name: string; fw: string; fails: number; passes: number; flips: number; last: number; state: 'pass' | 'fail' }
/** One timed build or test command. */
export type BuildRec = { t: number; key: string; ms: number; ok: boolean }
/** One cluster of error messages that normalise to the same text. */
export type ErrCluster = { key: string; sample: string; count: number; first: number; last: number }
/** Meeting mode: whether it is on, when it began, and the feature-switch overrides to restore exactly. */
export type Meet = { isOn: boolean; at: number; snapshot: Record<string, boolean> }

/** Everything add-kit records. Bounded: every list has a cap. */
export type Data = {
  hist: Cmd[]
  distract: Distraction[]
  snips: Snippet[]
  projs: Record<string, Proj>
  runs: TestRun[]
  cov: CovPoint[]
  flaky: Record<string, Flaky>
  builds: BuildRec[]
  errors: ErrCluster[]
  edited: string[]
  meet: Meet
  isPresent: boolean
}

/** The pane: the selected tab, what is being read, the lines of each tab already read, and the form fields. */
export type ViewState = {
  tab: string
  sub: string
  isBusy: boolean
  note: string
  page: number
  lines: Record<string, Line[]>
  /** Figures last read by the refresh buttons, for the presentation view (numbers only). */
  figs: Record<string, number>
  logPath: string
  logQ: string
  histQ: string
  draft: { lang: string; name: string; code: string }
}

declare module 'claude-code' {
  interface PluginState {
    'add-kit': {
      view: Shaped<ViewState>
      data: Shaped<Data>
    }
  }
}
