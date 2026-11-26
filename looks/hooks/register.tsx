import { atom, read } from 'claude-code'
import type { Hook, Register, ThemeSetArgs, Timer } from 'claude-code'

// Global reduced-motion switch: owned by the `motion` mod (`/motion on|off`).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)

import {
  DYNAMIC,
  LOOKS,
  MODEL_ACCENTS,
  build,
  familyOf,
  isDynamic,
  isLookName,
  resolveLook,
  withAccent,
} from './palettes'
import { SCENES, SCENE_NAMES } from './scenes'

type Dollar = Parameters<Hook<'session.start'>>[0]

// The default is NO theme: the app draws its own look until someone picks one here.
// What was picked lives in $.store, so a new session starts with the same choice.
type State = {
  cwd: string
  saved: string | null
  project: string | null
  // Picked in this session: wins over the folder's binding until the session ends. null is /look off.
  picked: string | null | undefined
  scene: string | null
  isModelAccent: boolean
  family: string | null
}

const state: State = {
  cwd: '',
  saved: null,
  project: null,
  picked: undefined,
  scene: null,
  isModelAccent: false,
  family: null,
}

const TICK_MS = 30 * 60_000
let ticker: Timer | undefined
let lastKey = ''

const ALIASES: Record<string, string> = {
  winter: 'snow',
  midnight: 'terminal',
  frost: 'nord',
  hc: 'contrast',
  highcontrast: 'contrast',
  'high-contrast': 'contrast',
  cb: 'colorblind',
  reading: 'sepia',
  day: 'solarized-day',
  night: 'solarized-night',
  default: 'off',
  none: 'off',
  clear: 'off',
}

const effective = (): string | null =>
  state.picked !== undefined ? state.picked : (state.project ?? state.saved)

const readMotion = async ($: Dollar) => (await read($, motionIsOn)) && (await $.store.get('motion')) !== false

const save = async ($: Dollar, key: string, value: unknown) => {
  if (value === null || value === undefined || value === false) {
    await $.store.delete(key)
  } else {
    await $.store.set(key, value)
  }
}

const load = async ($: Dollar, cwd: string) => {
  const look = await $.store.get('look')
  const projects = ((await $.store.get('projects')) ?? {}) as Record<string, string>
  const scene = await $.store.get('scene')
  const family = await $.store.get('family')
  const bound = projects[cwd]

  state.cwd = cwd
  state.saved = typeof look === 'string' && isLookName(look) ? look : null
  state.project = typeof bound === 'string' && isLookName(bound) ? bound : null
  state.picked = undefined
  state.scene = typeof scene === 'string' && scene in SCENES ? scene : null
  state.isModelAccent = (await $.store.get('modelAccent')) === true
  state.family = typeof family === 'string' ? family : null
}

// Works out the whole theme from the choices and sends it. Nothing chosen: clears.
async function apply($: Dollar, isForced = true): Promise<string> {
  const when = new Date(await $.clock.now())
  const id = effective()
  const resolved = id === null ? undefined : resolveLook(id, when)
  const accent = state.isModelAccent && state.family !== null ? MODEL_ACCENTS[state.family] : undefined
  const def = accent === undefined ? resolved?.def : withAccent(resolved?.def ?? {}, accent)
  const isMotion = await readMotion($)
  const scene = isMotion && state.scene !== null ? SCENES[state.scene] : undefined
  const args: ThemeSetArgs = {}
  let note = ''

  if (def !== undefined) {
    try {
      const { theme, problems } = build({ id: resolved?.id ?? 'model', label: resolved?.label ?? 'Model accent', def })
      const refused = problems.find(line => line.startsWith("Desktop won't paint"))

      if (refused !== undefined) {
        note = refused
      } else {
        args.colors = theme
      }
    } catch (error) {
      note = String(error)
    }
  }

  if (scene !== undefined && state.scene !== null) {
    args.backdrop = { scene: state.scene, ...(scene.glass === undefined ? {} : { glass: scene.glass }) }
  }
  const key = JSON.stringify(args)

  if (!isForced && key === lastKey) {
    return note
  }
  lastKey = key

  if (args.colors === undefined && args.backdrop === undefined) {
    await $.theme.clear()

    return note
  }

  try {
    const set = await $.theme.set(args)

    if (!set.isDrawn) {
      note = note === '' ? set.reason : note
    }
  } catch (error) {
    note = String(error)

    if (args.backdrop !== undefined && args.colors !== undefined) {
      // An older build may not take a scene: keep the colors.
      await $.theme.set({ colors: args.colors }).catch(() => undefined)
    }
  }

  return note
}

const restartTicker = ($: Dollar) => {
  ticker?.cancel()
  ticker = undefined
  const id = effective()

  if (id !== null && isDynamic(id)) {
    ticker = $.clock.every(TICK_MS, () => {
      void apply($, false).catch(() => undefined)
    })
  }
}

async function noteModel($: Dollar, model: string, agentId: string | undefined) {
  if (agentId !== undefined) {
    return
  }
  const family = familyOf(model)

  if (family === state.family) {
    return
  }
  state.family = family
  await save($, 'family', family)

  if (state.isModelAccent) {
    await apply($, false)
  }
}

const nameOfLook = (id: string | null) => {
  if (id === null) {
    return "none (the app's own look)"
  }

  return id in LOOKS ? `${id}, ${LOOKS[id]!.label}` : id
}

const listing = async ($: Dollar): Promise<string> => {
  const isMotion = await readMotion($)
  const lines = [
    `Look: ${nameOfLook(effective())}`,
    `Scene: ${state.scene ?? 'none'}${isMotion ? '' : ' (held back, motion is off)'}`,
    `Model accent: ${state.isModelAccent ? `on (${state.family ?? 'no model seen yet'})` : 'off'}`,
    `This folder: ${state.project === null ? 'not bound' : `bound to ${state.project}`}`,
    `Motion: ${isMotion ? 'on' : 'off'}`,
    '',
    'Looks:',
    ...Object.values(LOOKS).map(p => `  ${p.id.padEnd(16)} ${p.blurb}`),
    ...Object.entries(DYNAMIC).map(([name, blurb]) => `  ${name.padEnd(16)} ${blurb}`),
    `  ${'sunset'.padEnd(16)} accent drifts amber to violet through the day`,
    '',
    'Commands:',
    '  /look <name>            switch now and remember it',
    "  /look off               back to the app's own look",
    '  /look project <name>    bind this folder to a look (/look project off to unbind)',
    '  /look model on|off      accent follows the model family',
    `  /look scene <name|off>  ${SCENE_NAMES.join(', ')}`,
    '  /look motion on|off     scenes need motion on',
    '  /look reset             look, scene and model accent all off',
  ]

  return lines.join('\n')
}

async function runLook($: Dollar, raw: string): Promise<string> {
  const words = raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w !== '')
  const first = words[0] ?? ''
  const cmd = ALIASES[first] ?? first
  const arg = words[1] ?? ''
  const finish = async (text: string) => {
    restartTicker($)
    const note = await apply($)

    return note === '' ? text : `${text}\n(${note})`
  }

  if (cmd === '' || cmd === 'list' || cmd === 'help' || cmd === '?') {
    return listing($)
  }

  if (cmd === 'off') {
    state.saved = null
    state.picked = null
    await save($, 'look', null)

    return finish(
      state.project === null
        ? "Look cleared: the app's own look."
        : `Look cleared for now. This folder is bound to ${state.project}, which returns next session: /look project off to unbind.`,
    )
  }

  if (cmd === 'reset') {
    state.saved = null
    state.picked = null
    state.scene = null
    state.isModelAccent = false
    await save($, 'look', null)
    await save($, 'scene', null)
    await save($, 'modelAccent', false)

    return finish("Everything off: the app's own look, no scene, no model accent.")
  }

  if (cmd === 'project') {
    const target = ALIASES[arg] ?? arg

    if (arg === '') {
      return state.project === null
        ? 'This folder is not bound. /look project <name> binds it.'
        : `This folder (${state.cwd}) is bound to ${state.project}.`
    }
    const projects = ((await $.store.get('projects')) ?? {}) as Record<string, string>

    if (target === 'off' || arg === 'unbind') {
      delete projects[state.cwd]
      await $.store.set('projects', projects)
      state.project = null
      state.picked = undefined

      return finish('Folder unbound. The saved look applies here again.')
    }

    if (!isLookName(target)) {
      return `No look called "${arg}". /look lists them.`
    }
    projects[state.cwd] = target
    await $.store.set('projects', projects)
    state.project = target
    state.picked = undefined

    return finish(`${state.cwd} is bound to ${target}. It applies whenever a session starts in this folder.`)
  }

  if (cmd === 'model') {
    if (arg !== 'on' && arg !== 'off') {
      return 'Usage: /look model on|off'
    }
    state.isModelAccent = arg === 'on'
    await save($, 'modelAccent', state.isModelAccent)

    return finish(
      state.isModelAccent
        ? `Accent now follows the model: ${Object.keys(MODEL_ACCENTS).join(', ')}. ${state.family === null ? 'It shows after the next reply.' : `Now: ${state.family}.`}`
        : 'Accent no longer follows the model.',
    )
  }

  if (cmd === 'scene') {
    if (arg === '') {
      return `Scenes: ${SCENE_NAMES.join(', ')}. /look scene <name>, or /look scene off. Now: ${state.scene ?? 'none'}.`
    }

    if (arg === 'off' || arg === 'none') {
      state.scene = null
      await save($, 'scene', null)

      return finish('Scene off.')
    }
    const scene = SCENES[arg]

    if (scene === undefined) {
      return `No scene called "${arg}". Scenes: ${SCENE_NAMES.join(', ')}.`
    }
    state.scene = arg
    await save($, 'scene', arg)
    const isMotion = await readMotion($)

    return finish(
      isMotion
        ? `Scene: ${scene.label}. Slow and quiet; /look scene off stops it.`
        : `Scene ${scene.label} saved, but motion is off, so none is drawn. /look motion on to see it.`,
    )
  }

  if (cmd === 'motion') {
    if (arg !== 'on' && arg !== 'off') {
      return 'Usage: /look motion on|off'
    }
    await $.store.set('motion', arg === 'on')

    return finish(arg === 'on' ? 'Motion on: scenes can play.' : 'Motion off: no scene is drawn.')
  }

  if (isLookName(cmd)) {
    state.saved = cmd
    state.picked = cmd
    await save($, 'look', cmd)
    const hint =
      state.project !== null && state.project !== cmd
        ? ` (This folder is bound to ${state.project}, which wins next session.)`
        : ''
    const palette = LOOKS[cmd]

    return finish(`Look: ${palette === undefined ? cmd : palette.label}.${hint}`)
  }

  return `No look called "${first}". /look lists them.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'look', description: 'Pick a look or a moving scene: /look <name>, /look off, /look scene <name>' })
      .catch(() => undefined)
    await load($, e.cwd)
    await apply($)
    restartTicker($)

    return next(e)
  })

  on('command.run', { command: 'look' }, async ($, e) => ({ text: await runLook($, e.args) }))

  // The model family steers the accent, when that is on.
  on('turn.step', async function* ($, e, next) {
    await noteModel($, e.model, e.agentId)

    return yield* next(e)
  })

  // A scene is drawn here. With motion off, or from another plugin, the engine draws nothing of its own.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const scene = e.props.plugin === 'looks' ? SCENES[e.props.scene] : undefined

    if (scene === undefined || !(await readMotion($))) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={scene.svg} alt={scene.alt} isInteractive />
  })
}
