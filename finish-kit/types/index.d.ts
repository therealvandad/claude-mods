export type FinishKitDraft = {
  gray: string
  tone: string
  accent: string
  neutralFirst: boolean
  contrast: string
  ground: string
  card: string
  border: string
  shape: string
  headings: string
  weights: string
  hand: boolean
}

export type FinishKitView = {
  tab: string
  cvd: string
  stroke: number
  focus: string
}

declare module 'claude-code' {
  interface PluginState {
    'finish-kit': {
      draft: Shaped<FinishKitDraft>
      view: Shaped<FinishKitView>
      applied: string
      month: number
    }
  }
}
