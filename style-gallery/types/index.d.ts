export type TabId = 'surfaces' | 'controls' | 'feedback' | 'navigation' | 'modes' | 'list'
export type SortId = 'id' | 'name' | 'kind'
export type ChipId = 'live' | 'preview' | 'look' | 'ui'

/** Everything the pane shows depends on this one value. Bump the shape tag when a field changes. */
export type GalleryView = {
  tab: TabId
  query: string
  chips: ChipId[]
  sort: SortId
  page: number
  selected: string
  grid: boolean
  demoPage: number
  msg: string
}

declare module 'claude-code' {
  interface PluginState {
    'style-gallery': {
      view: Shaped<GalleryView>
    }
  }
}
