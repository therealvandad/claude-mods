export type CallRec = {
  id: string
  sig: string
  start: number
  end: number | null
  attempt: number
}

declare module 'claude-code' {
  interface PluginState {
    'tool-visuals': {
      calls: Shaped<CallRec[]>
      tick: number
      isOff: boolean
    }
  }
}
