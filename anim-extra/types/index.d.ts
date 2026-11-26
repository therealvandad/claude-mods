export type AxLang = 'en' | 'es' | 'de'

export type AxThresholds = { slowCallSec: number; largeOutputLines: number; riskyEditLines: number }

export type AxRating = { stars: number; note: string }

/** Everything the person configures; kept whole in `$.store` key `ax.cfg`. */
export type AxCfg = {
  glow: boolean
  lang: AxLang
  aliases: Record<string, string>
  band: { hidden: string[]; order: string[] }
  thresholds: AxThresholds
  glyphs: Record<string, string>
  rules: string[]
  recipes: Record<string, boolean>
  ratings: Record<string, AxRating>
  checks: Record<string, boolean>
}

/** Start stamps (ms of the shared clock) of the animations that are playing; 0 is none. */
export type AxAnim = {
  skelAt: number
  rippleAt: number
  sweepAt: number
  loopAt: number
  loopUntil: number
  confettiAt: number
  urgentAt: number
  urgentText: string
  confettiText: string
  notif: number
}

/** What the tool-call hook saw: bounded, session only. */
export type AxRun = {
  calls: string
  tests: number
  lastTool: string
  lastMs: number
  files: string[]
}

export type AxFired = { rules: Record<string, number>; match: Record<string, boolean>; toastAt: number }

declare module 'claude-code' {
  interface PluginState {
    'anim-extra': {
      cfg: Shaped<AxCfg>
      now: number
      anim: Shaped<AxAnim>
      run: Shaped<AxRun>
      fired: Shaped<AxFired>
      tab: string
      group: string
      sort: string
      flash: string
    }
  }
}
