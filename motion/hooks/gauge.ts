// Reusable eased-gauge pattern. Copy this file into any mod.
//
// The UI is declarative: nothing moves unless state changes and readers redraw.
// So a gauge is plain data, `{ from, to, at }`, kept in an atom. A clock-driven
// ticker (one shared ticker for the whole mod, see register.tsx) writes a `now`
// atom every frame while any gauge is live; a render computes
// `gaugeValue(g, now)` and so draws the in-between number. When the time is up
// the ticker calls `gaugeSettle`, after which readers need not read `now`, so
// idle gauges cost nothing.
//
//   retarget:  gauges[key] = gaugeTo(old, newValue, await $.clock.now(), isMotionOn)
//   per tick:  now = t; every gauge with gaugeDone(g, t) -> gaugeSettle(g)
//   render:    g.from === g.to ? g.to : gaugeValue(g, await read($, now))
import type { Gauge } from '../types'

/** How long a gauge takes to reach its new number. */
export const GAUGE_MS = 400

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)

/** The value at time `now`. A stale `now` before `at` reads as the start. */
export const gaugeValue = (g: Gauge, now: number): number =>
  g.from + (g.to - g.from) * easeOutCubic((now - g.at) / GAUGE_MS)

/** A gauge sent to `to`, starting from wherever the old one is drawn now. Instant when motion is off or there is no old gauge. */
export const gaugeTo = (old: Gauge | undefined, to: number, now: number, isMotionOn: boolean): Gauge =>
  old === undefined || !isMotionOn ? { from: to, to, at: now } : { from: gaugeValue(old, now), to, at: now }

export const gaugeIsLive = (g: Gauge) => g.from !== g.to

/** True once its time is up: the ticker then settles it. */
export const gaugeDone = (g: Gauge, now: number) => now >= g.at + GAUGE_MS

export const gaugeSettle = (g: Gauge): Gauge => ({ from: g.to, to: g.to, at: g.at })
