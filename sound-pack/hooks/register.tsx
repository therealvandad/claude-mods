import type { Hook, Register } from 'claude-code'

import {
  ASK_GAP_MS,
  CHIME_MIN_MS,
  PACKS,
  SPEAK_MIN_MS,
  clipFor,
  formatQuiet,
  gainForDuration,
  isQuietAt,
  isTickDue,
  normalizeSettings,
  parseAction,
  summaryText,
} from './sound-logic'
import type { Choice, Kind, Settings } from './sound-logic'

type Dollar = Parameters<Hook<'session.start'>>[0]

const STORE_KEY = 'sound'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Per-session working state; settings themselves live in $.store.
let cached: Settings | undefined
let lastTickAt = 0
let lastAskAt = 0
const changed = new Set<string>()

const load = async ($: Dollar): Promise<Settings> => {
  if (cached !== undefined) return cached
  const raw = await $.store.get(STORE_KEY).catch(() => undefined)
  cached = normalizeSettings(raw)

  return cached
}

const save = async ($: Dollar, next: Settings): Promise<boolean> => {
  cached = next

  return $.store.set(STORE_KEY, next).then(
    () => true,
    () => false,
  )
}

// True when nothing may play right now: the pack is off or quiet hours are on.
const isMuted = async ($: Dollar, settings: Settings): Promise<boolean> => {
  if (settings.pack === 'off') return true
  const now = await $.clock.now()

  return isQuietAt(settings, now)
}

const playKind = ($: Dollar, pack: Choice, kind: Kind, gain: number): Promise<void> => {
  const asset = clipFor(pack, kind)
  if (asset === undefined) return Promise.resolve()

  return $.audio.play({ asset }, { gain }).catch(() => undefined)
}

const speakLine = ($: Dollar, text: string): Promise<boolean> =>
  $.audio.speak(text).then(
    () => true,
    () => false,
  )

const onTurnStart = () => {
  lastTickAt = 0
  changed.clear()
}

const onTurnComplete = async ($: Dollar, reason: string, took: number) => {
  const settings = await load($)
  if (await isMuted($, settings)) return
  const files = changed.size
  let kind: Kind | undefined

  if (reason === 'error' || reason === 'refusal') kind = 'error'
  else if (reason === 'answer' && took >= CHIME_MIN_MS) kind = 'done'

  const speech = settings.speak && reason === 'answer' && took > SPEAK_MIN_MS ? summaryText(took, files) : undefined
  const gain = kind === 'error' ? 0.7 : gainForDuration(took)

  // Chime first, then the spoken line; neither blocks the turn.
  const chime = kind === undefined ? Promise.resolve() : playKind($, settings.pack, kind, gain)
  void chime.then(() => (speech === undefined ? undefined : speakLine($, speech)))
}

const onAsk = async ($: Dollar) => {
  const settings = await load($)
  if (await isMuted($, settings)) return
  const now = await $.clock.now()
  if (lastAskAt > 0 && now - lastAskAt < ASK_GAP_MS) return
  lastAskAt = now
  await playKind($, settings.pack, 'ask', 0.7)
}

const onToolDone = async ($: Dollar, tool: string, input: unknown) => {
  if (EDIT_TOOLS.has(tool) && typeof input === 'object' && input !== null) {
    const o = input as Record<string, unknown>
    const path = o.file_path ?? o.notebook_path
    if (typeof path === 'string') changed.add(path)
  }

  const settings = await load($)
  if (!settings.ticks || (await isMuted($, settings))) return
  const now = await $.clock.now()
  if (!isTickDue(lastTickAt, now)) return
  lastTickAt = now
  await playKind($, settings.pack, 'tick', 0.4)
}

const PACK_NOTES: Record<Choice, string> = {
  off: 'silent until you pick a pack (the default, so nothing plays twice)',
  retro: 'square-wave blips',
  wood: 'short low knocks',
  glass: 'high bell partials',
  silent: 'no clips at all; spoken summaries still work if on',
}

const describe = (s: Settings): string => {
  const lines = ['Sound packs:']
  for (const name of ['off', ...PACKS] as const) {
    lines.push(`  ${name === s.pack ? '*' : ' '} ${name.padEnd(7)} ${PACK_NOTES[name]}`)
  }
  lines.push(
    `Current: ${s.pack}. Ticks: ${s.ticks ? 'on' : 'off'}. Speak: ${s.speak ? 'on' : 'off'}. Quiet hours: ${s.quiet ?? 'none'}.`,
    'Use: /sound <pack> | /sound ticks on|off | /sound speak on|off | /sound quiet 22:00-07:00 | /sound quiet off',
  )

  return lines.join('\n')
}

const runSound = async ($: Dollar, args: string): Promise<{ text: string }> => {
  const settings = await load($)
  const action = parseAction(args)
  const quietNow = await isMuted($, { ...settings, pack: settings.pack === 'off' ? 'silent' : settings.pack })

  if (action.type === 'list') return { text: describe(settings) }
  if (action.type === 'error') return { text: action.message }

  if (action.type === 'pack') {
    const saved = await save($, { ...settings, pack: action.pack })
    const mute = isQuietAt({ ...settings, pack: action.pack }, await $.clock.now())
    let text = `Sound pack: ${action.pack}.`
    if (action.pack === 'off') text += ' The mod is silent.'
    else if (action.pack === 'silent') text += ' No clips will play.'
    else if (mute) text += ' Quiet hours are on, so no preview played.'
    else void playKind($, action.pack, 'done', 0.7)
    if (!saved) text += ' (Could not save the choice; it lasts until the session ends.)'

    return { text }
  }

  if (action.type === 'ticks') {
    const saved = await save($, { ...settings, ticks: action.on })
    let text = `Typing ticks ${action.on ? 'on' : 'off'}: one very quiet tick per finished tool call, at most one per 400 ms.`
    if (action.on && (settings.pack === 'off' || settings.pack === 'silent')) text += ` Pick a pack to hear them: the pack is ${settings.pack}.`
    if (!saved) text += ' (Could not save.)'

    return { text }
  }

  if (action.type === 'speak') {
    const saved = await save($, { ...settings, speak: action.on })
    let text = `Spoken summary ${action.on ? 'on' : 'off'}: a short line after turns longer than ${SPEAK_MIN_MS / 1000} seconds.`
    if (action.on && settings.pack === 'off') text += ' The pack is off, so nothing speaks until you pick a pack (silent is fine for speech only).'
    else if (action.on && !quietNow) {
      const ok = await speakLine($, 'Spoken summaries are on')
      if (!ok) text += ' No speech synthesizer answered, so summaries will be skipped.'
    }
    if (!saved) text += ' (Could not save.)'

    return { text }
  }

  const quiet = action.range === null ? null : formatQuiet(action.range)
  const saved = await save($, { ...settings, quiet })
  const text = quiet === null ? 'Quiet hours off.' : `Quiet hours ${quiet} (local time): no sounds or speech then.`

  return { text: saved ? text : `${text} (Could not save.)` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cached = undefined
    await $.command
      .register({
        name: 'sound',
        description: 'Sound packs: /sound <retro|wood|glass|silent|off>, ticks, speak, quiet',
        argumentHint: '[pack | ticks on|off | speak on|off | quiet HH:MM-HH:MM|off]',
      })
      .catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'sound' }, ($, e) => runSound($, e.args))

  on('turn.start', (_, e, next) => {
    if (e.agentId === undefined) onTurnStart()

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await onTurnComplete($, e.reason, e.durationMs)

    return next(e)
  })

  // The engine raises this whenever it is about to show a permission dialog.
  on('classic.PermissionRequest', async ($, e, next) => {
    await onAsk($)

    return next(e)
  })

  // AskUserQuestion is the question dialog: Claude asking for an answer.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await onAsk($)

    return next(e)
  })

  // One tick per finished tool call (throttled), and the files the turn changed.
  on('classic.PostToolUse', async ($, e, next) => {
    await onToolDone($, e.tool_name, e.tool_input)

    return next(e)
  })
}
