export type Level = 'info' | 'notice' | 'urgent'

export type Deadline = { at: number; label: string }

export type Cfg = {
  snoozeUntil: number
  quiet: string
  muted: string[]
  sounds: boolean
  checkin: boolean
  deadline: Deadline | null
}

export type Pending = { t: number; category: string; level: Level; text: string; why: string }

export type HistoryRow = { t: number; category: string; level: Level; text: string; via: 'toast' | 'native' | 'digest' }

export type Limiter = { last: Record<string, number>; lastShown: number; lastUrgent: number; lastDigest: number }

export type Stats = { muted: number; held: number; digested: number; limited: number }

export type Waiting = { kind: 'permission' | 'question'; tool: string; since: number }

export type Run = {
  promptSeen: boolean
  turnRunning: boolean
  turnEnd: number
  turnMs: number
  taskDoneDone: boolean
  idleDone: boolean
  stretchStart: number
  stretchLast: number
  checkinDone: boolean
  edits: number
  editsDone: boolean
  netFails: number
  netDown: boolean
  lastDiskAt: number
  diskOff: boolean
  usageAt: number
  ctxAt: number
  calls: number
}

declare module 'claude-code' {
  interface PluginState {
    alerts: {
      cfg: Shaped<Cfg>
      pending: Shaped<Pending[]>
      history: Shaped<HistoryRow[]>
      limiter: Shaped<Limiter>
      stats: Shaped<Stats>
      fired: Shaped<string[]>
      waiting: Shaped<Waiting | null>
      run: Shaped<Run>
      tick: number
    }
  }
}
