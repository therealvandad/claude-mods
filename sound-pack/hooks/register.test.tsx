import { expect, test } from 'claude-code/testing'

declare const setTimeout: (fn: () => void, ms: number) => unknown

import {
  clipFor,
  formatQuiet,
  gainForDuration,
  isQuiet,
  isQuietAt,
  isTickDue,
  minutesOfDay,
  normalizeSettings,
  parseAction,
  parseQuiet,
  summaryText,
} from './sound-logic'

// ---- pure functions -------------------------------------------------------

test('parseQuiet reads HH:MM-HH:MM and rejects the rest', () => {
  expect(parseQuiet('22:00-07:00')).toEqual({ start: 1320, end: 420 })
  expect(parseQuiet('7:05-9:30')).toEqual({ start: 425, end: 570 })
  for (const bad of ['', '22:00', '22:00-', '24:00-07:00', '22:60-07:00', '22:00-22:00', 'a-b', '1:2-3:4', '22:00-07:00-08:00']) {
    expect(parseQuiet(bad), bad).toBeUndefined()
  }
  expect(formatQuiet({ start: 425, end: 570 })).toBe('07:05-09:30')
})

test('isQuiet handles ranges that wrap past midnight', () => {
  const night = parseQuiet('22:00-07:00')
  expect(isQuiet(night, 22 * 60)).toBe(true)
  expect(isQuiet(night, 23 * 60 + 59)).toBe(true)
  expect(isQuiet(night, 0)).toBe(true)
  expect(isQuiet(night, 6 * 60 + 59)).toBe(true)
  expect(isQuiet(night, 7 * 60)).toBe(false)
  expect(isQuiet(night, 12 * 60)).toBe(false)
  expect(isQuiet(night, 21 * 60 + 59)).toBe(false)

  const day = parseQuiet('09:00-17:30')
  expect(isQuiet(day, 9 * 60)).toBe(true)
  expect(isQuiet(day, 17 * 60 + 29)).toBe(true)
  expect(isQuiet(day, 17 * 60 + 30)).toBe(false)
  expect(isQuiet(day, 8 * 60 + 59)).toBe(false)
  expect(isQuiet(undefined, 0)).toBe(false)
})

test('quiet hours are read from local time of a clock reading', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 25, h, m).getTime()
  expect(minutesOfDay(at(23, 30))).toBe(23 * 60 + 30)
  const settings = normalizeSettings({ pack: 'wood', quiet: '22:00-07:00' })
  expect(isQuietAt(settings, at(23, 30))).toBe(true)
  expect(isQuietAt(settings, at(6, 0))).toBe(true)
  expect(isQuietAt(settings, at(12, 0))).toBe(false)
  expect(isQuietAt(normalizeSettings({}), at(23, 30))).toBe(false)
})

test('gainForDuration runs from 0.3 up to 1.0 and never leaves that range', () => {
  expect(gainForDuration(0)).toBe(0.3)
  expect(gainForDuration(5_000)).toBe(0.3)
  expect(gainForDuration(180_000)).toBe(1)
  expect(gainForDuration(3_600_000)).toBe(1)
  expect(gainForDuration(Number.NaN)).toBe(0.3)
  expect(gainForDuration(-10)).toBe(0.3)
  const mid = gainForDuration(92_500)
  expect(mid).toBeGreaterThan(0.6)
  expect(mid).toBeLessThan(0.7)
  let last = 0
  for (let s = 0; s <= 240; s += 5) {
    const g = gainForDuration(s * 1000)
    expect(g).toBeGreaterThanOrEqual(last)
    expect(g).toBeGreaterThanOrEqual(0.3)
    expect(g).toBeLessThanOrEqual(1)
    last = g
  }
})

test('ticks are limited to one per 400 ms', () => {
  expect(isTickDue(0, 1000)).toBe(true)
  expect(isTickDue(1000, 1399)).toBe(false)
  expect(isTickDue(1000, 1400)).toBe(true)
})

test('summaryText is plain text', () => {
  expect(summaryText(42_000, 3)).toBe('Done in 42 seconds, 3 files changed')
  expect(summaryText(42_000, 1)).toBe('Done in 42 seconds, 1 file changed')
  expect(summaryText(42_000, 0)).toBe('Done in 42 seconds')
  expect(summaryText(60_000, 0)).toBe('Done in 1 minute')
  expect(summaryText(135_000, 2)).toBe('Done in 2 minutes 15 seconds, 2 files changed')
})

test('settings and commands parse safely', () => {
  expect(normalizeSettings(undefined)).toEqual({ pack: 'off', ticks: false, speak: false, quiet: null })
  expect(normalizeSettings({ pack: 'nope', ticks: 'yes', quiet: 'bad' })).toEqual({ pack: 'off', ticks: false, speak: false, quiet: null })
  expect(normalizeSettings({ pack: 'glass', ticks: true, speak: true, quiet: '22:00-07:00' }).pack).toBe('glass')
  expect(parseAction('')).toEqual({ type: 'list' })
  expect(parseAction('Wood')).toEqual({ type: 'pack', pack: 'wood' })
  expect(parseAction('off')).toEqual({ type: 'pack', pack: 'off' })
  expect(parseAction('ticks on')).toEqual({ type: 'ticks', on: true })
  expect(parseAction('speak off')).toEqual({ type: 'speak', on: false })
  expect(parseAction('quiet 22:00-07:00')).toEqual({ type: 'quiet', range: { start: 1320, end: 420 } })
  expect(parseAction('quiet 22:00 - 07:00').type).toBe('quiet')
  expect(parseAction('quiet off')).toEqual({ type: 'quiet', range: null })
  expect(parseAction('quiet banana').type).toBe('error')
  expect(parseAction('ticks maybe').type).toBe('error')
  expect(parseAction('retro extra').type).toBe('error')
  expect(clipFor('retro', 'done')).toBe('sounds/retro/done.wav')
  expect(clipFor('silent', 'done')).toBeUndefined()
  expect(clipFor('off', 'tick')).toBeUndefined()
})

// ---- the mod against the engine --------------------------------------------

type Play = { asset: string; gain: number | undefined }

const rig = (on: (...args: any[]) => unknown, initial: unknown, startMs = 1_000_000) => {
  const state = { now: startMs, stored: initial as unknown, plays: [] as Play[], spoken: [] as string[], speakFails: false }
  on('clock.now', () => ({ value: state.now }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('command.register', () => ({ value: { command: 'sound' } }))
  on('store.get', () => ({ value: state.stored }))
  on('store.set', (_: unknown, e: { value: unknown }) => {
    state.stored = e.value

    return { value: undefined }
  })
  on('audio.play', (_: unknown, e: { clip: { asset: string }; gain?: number }) => {
    state.plays.push({ asset: e.clip.asset, gain: e.gain })

    return { value: undefined }
  })
  on('audio.speak', (_: unknown, e: { text: string }) => {
    if (state.speakFails) throw new Error('no synthesizer')
    state.spoken.push(e.text)

    return { value: { via: 'system' } }
  })

  return state
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 20))

const done = (turnId: string, seconds: number, reason: 'answer' | 'error') =>
  ({ turnId, reason, answer: 'ok', durationMs: seconds * 1000, isAborted: false }) as const

const run = (args: string) =>
  ({ command: 'sound', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }) as const

const runTurn = async ($: any, state: ReturnType<typeof rig>, seconds: number, reason: 'answer' | 'error' = 'answer') => {
  await $.turn.start({ text: 'hi', turnId: 't1' })
  state.now += seconds * 1000
  await $.turn.complete(done('t1', seconds, reason))
  await flush()
}

test('the default pack is off: a long turn plays nothing', async ($, on) => {
  const s = rig(on, undefined)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await runTurn($, s, 120)
  await runTurn($, s, 60, 'error')
  expect(s.plays).toEqual([])
  expect(s.spoken).toEqual([])
})

test('a finished turn chimes louder the longer it ran; errors get the two-tone', async ($, on) => {
  const s = rig(on, { pack: 'glass' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await runTurn($, s, 2)
  expect(s.plays).toEqual([])

  await runTurn($, s, 10)
  await runTurn($, s, 200)
  await runTurn($, s, 3, 'error')

  expect(s.plays.map(p => p.asset)).toEqual(['sounds/glass/done.wav', 'sounds/glass/done.wav', 'sounds/glass/error.wav'])
  expect(s.plays[0]!.gain!).toBeGreaterThanOrEqual(0.3)
  expect(s.plays[0]!.gain!).toBeLessThan(s.plays[1]!.gain!)
  expect(s.plays[1]!.gain).toBe(1)
})

test('the silent pack plays no clips', async ($, on) => {
  const s = rig(on, { pack: 'silent' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await runTurn($, s, 90)
  expect(s.plays).toEqual([])
})

test('quiet hours silence sounds and speech', async ($, on) => {
  const midnight = new Date(2026, 10, 25, 23, 30).getTime()
  const s = rig(on, { pack: 'retro', speak: true, ticks: true, quiet: '22:00-07:00' }, midnight)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await runTurn($, s, 90)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'u1' })
  await flush()
  expect(s.plays).toEqual([])
  expect(s.spoken).toEqual([])

  // The same settings at noon do play.
  s.now = new Date(2026, 10, 26, 12, 0).getTime()
  await runTurn($, s, 90)
  expect(s.plays.map(p => p.asset)).toEqual(['sounds/retro/done.wav'])
  expect(s.spoken.length).toBe(1)
})

test('a permission request plays a distinct ask cue, once per burst', async ($, on) => {
  const s = rig(on, { pack: 'wood' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  s.now += 500
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  s.now += 5000
  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: {} })
  expect(s.plays.map(p => p.asset)).toEqual(['sounds/wood/ask.wav', 'sounds/wood/ask.wav'])
})

test('ticks are off by default and at most one per 400 ms when on', async ($, on) => {
  const s = rig(on, { pack: 'wood' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const done = () => $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 'u' })
  await done()
  expect(s.plays).toEqual([])

  s.stored = { pack: 'wood', ticks: true }
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await done()
  s.now += 100
  await done()
  s.now += 100
  await done()
  s.now += 300
  await done()
  expect(s.plays.map(p => p.asset)).toEqual(['sounds/wood/tick.wav', 'sounds/wood/tick.wav'])
  expect(s.plays[0]!.gain!).toBeLessThanOrEqual(0.5)
})

test('speech follows long turns only, counts changed files, and survives a missing synthesizer', async ($, on) => {
  const s = rig(on, { pack: 'silent', speak: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await runTurn($, s, 20)
  expect(s.spoken).toEqual([])

  await $.turn.start({ text: 'go', turnId: 't2' })
  for (const file of ['/a.ts', '/b.ts', '/a.ts']) {
    await $.classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path: file }, tool_response: {}, tool_use_id: 'u' })
  }
  s.now += 42_000
  await $.turn.complete(done('t2', 42, 'answer'))
  await flush()
  expect(s.spoken).toEqual(['Done in 42 seconds, 2 files changed'])

  s.speakFails = true
  await runTurn($, s, 60)
  expect(s.spoken.length).toBe(1)
})

test('/sound lists packs, selects one with a preview, and persists it', async ($, on) => {
  const s = rig(on, undefined)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const listed = await $.command.run(run(''))
  expect(listed.text).toMatch(/Current: off/)
  for (const name of ['retro', 'wood', 'glass', 'silent']) expect(listed.text).toContain(name)

  const picked = await $.command.run(run('retro'))
  await flush()
  expect(picked.text).toMatch(/Sound pack: retro/)
  expect(s.stored).toMatchObject({ pack: 'retro' })
  expect(s.plays.map(p => p.asset)).toEqual(['sounds/retro/done.wav'])

  await $.command.run(run('speak on'))
  expect(s.spoken).toEqual(['Spoken summaries are on'])
  expect(s.stored).toMatchObject({ speak: true, ticks: false, pack: 'retro' })

  const quiet = await $.command.run(run('quiet 22:00-07:00'))
  expect(quiet.text).toMatch(/22:00-07:00/)
  expect(s.stored).toMatchObject({ pack: 'retro', quiet: '22:00-07:00', speak: true })

  const bad = await $.command.run(run('quiet nonsense'))
  expect(bad.text).toMatch(/Use \/sound quiet/)
  expect(s.stored).toMatchObject({ quiet: '22:00-07:00' })

})

test('/sound speak on tells the user when there is no synthesizer', async ($, on) => {
  const s = rig(on, { pack: 'silent' })
  s.speakFails = true
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const out = await $.command.run(run('speak on'))
  expect(out.text).toMatch(/No speech synthesizer/)
})
