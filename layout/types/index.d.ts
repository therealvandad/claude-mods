export type IconSet = 'letters' | 'symbols' | 'minimal'
export type PathMode = 'short' | 'mid' | 'full'
export type Auto = 'auto' | 'on' | 'off'
export type ColsMode = 'auto' | '1' | '2'

export type LayoutSettings = {
  zen: boolean
  icons: IconSet
  path: PathMode
  stripes: boolean
  errBanner: boolean
  longBanner: boolean
  chips: boolean
  // 0 is off; otherwise the widest an assistant message may draw, in cells.
  width: number
  compact: Auto
  cols: ColsMode
}

export type RecentFile = { path: string; tool: string; at: number }
export type SplitBlobs = { a: string; b: string }

declare module 'claude-code' {
  interface PluginState {
    layout: {
      settings: Shaped<LayoutSettings>
      recent: Shaped<RecentFile[]>
      split: Shaped<SplitBlobs>
      folds: Shaped<Record<string, boolean>>
      pins: Shaped<string[]>
      note: string
      view: string
    }
  }
}
