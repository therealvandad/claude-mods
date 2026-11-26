import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register, Timer } from 'claude-code'

import type { Config, LogRow, Run } from '../types'
import { ease, framesOf, samples, strip } from './curves'
import {
  KNOWN_SHORTCUTS,
  GENERIC_FONTS,
  editBranch,
  editBundle,
  editCheck,
  editCurve,
  editDnd,
  editEmpty,
  editExport,
  editFilter,
  editFile,
  editFocus,
  editFont,
  editGloss,
  editGreet,
  editIcon,
  editKeys,
  editLogo,
  editMacro,
  editRange,
  editReport,
  editRules,
  editSched,
  editSearch,
  editSound,
  editTip,
  editTitle,
  bundleLines,
  greetingNow,
} from './edit'
import type { Ctx as EditCtx, Edit } from './edit'
import { buildTheme, swatchesOf } from './palette'
import {
  BUILTIN_FOCUS,
  CFG,
  DEFAULT_EMPTY,
  EVENTS,
  FEATURE_DEFAULTS,
  LIMITS,
  MOD,
  PACKS,
  PACK_IDS,
  PANE,
  PREFIX,
  TABS,
  TAB_IDS,
  accentOfBranch,
  allTips,
  checkFocusStep,
  checkMacroStep,
  cleanConfig,
  cleanLog,
  clip,
  colourOfFile,
  defaultConfig,
  desiredHidden,
  dndStep,
  exportRows,
  extOf,
  holds,
  iconOf,
  isAllowedRun,
  looksFailed,
  parseBranch,
  pickByDay,
  pushRow,
  renderGreeting,
  renderTemplate,
  reportVars,
  ruleSteps,
  schedNow,
  statsOf,
  toRow,
  viewOf,
} from './pure'
import type { ColourKey, SoundEvent, StepCheck } from './pure'
import { SOUND_FILES } from './sounds'
import { curveSvg, fontSvg, swatchSvg } from './svg'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

// ------------------------------------------------------------------ the switches (features.json) and shared atoms

// Read-only foreign atoms. Defaults apply when the other mods never wrote them.
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const isCalmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })

// This mod's own atoms. Change a shape tag when a stored value's fields change.
const configA = atom({ plugin: 'custom-two', key: 'config' } as const, defaultConfig(), { shape: 'config-1' })
const logA = atom({ plugin: 'custom-two', key: 'log' } as const, [], { shape: 'log-1' })
const runsA = atom({ plugin: 'custom-two', key: 'runs' } as const, [], { shape: 'runs-1' })
const tabA = atom({ plugin: 'custom-two', key: 'tab' } as const, 'look')
const pageA = atom({ plugin: 'custom-two', key: 'page' } as const, 0)
const noticeA = atom({ plugin: 'custom-two', key: 'notice' } as const, '')
const branchA = atom({ plugin: 'custom-two', key: 'branch' } as const, '')
const frameA = atom({ plugin: 'custom-two', key: 'frame' } as const, -1)
const selectedA = atom({ plugin: 'custom-two', key: 'selected' } as const, '')
const fmtA = atom({ plugin: 'custom-two', key: 'fmt' } as const, 'csv')

const FRAMES = 10
const FRAME_MS = 150
const DND_MS = 5 * 60_000
const TOAST_GAP_MS = 3 * 60_000
const SOUND_GAP_MS = 1500
const BRANCH_GAP_MS = 30_000

// Session memory only: locks and timers. Nothing here is saved.
let isRunning = false
let isReconciling = false
let isBusy = false
let lastToastAt = 0
let lastSoundAt = 0
let lastBranchAt = 0
let dndTimer: Timer | undefined
let demoTimer: Timer | undefined
let reconcileTimer: Timer | undefined

const isFeatureOn = async ($: Dollar, id: string): Promise<boolean> => {
  const overrides = (await read($, featuresA)) as Record<string, boolean>

  return overrides[`${MOD}.${id}`] ?? FEATURE_DEFAULTS[id] ?? false
}

const nowOf = ($: Dollar): Promise<number> => $.clock.now().catch(() => 0)

const minutesOfDay = (ms: number): number => {
  const d = new Date(ms)

  return d.getHours() * 60 + d.getMinutes()
}

// ------------------------------------------------------------------ load and save

const saveConfig = async ($: Dollar, cfg: Config): Promise<Config> => {
  const clean = cleanConfig(cfg)
  await update($, configA, () => clean)
  await $.store.set('config', clean).catch(() => undefined)

  return clean
}

/** Reads the config fresh, applies the change, saves. Used from timers so a stale copy never overwrites an edit. */
const changeConfig = async ($: Dollar, fn: (cfg: Config) => Config): Promise<Config> => saveConfig($, fn(await read($, configA)))

const load = async ($: Dollar) => {
  const [cfg, log, runs] = await Promise.all([$.store.get('config').catch(() => undefined), $.store.get('log').catch(() => undefined), $.store.get('runs').catch(() => undefined)])
  await update($, configA, () => cleanConfig(cfg))
  await update($, logA, () => cleanLog(log))
  await update($, runsA, () => cleanRuns(runs))
}

const cleanRuns = (raw: unknown): Run[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((r): r is Run => typeof r === 'object' && r !== null && typeof (r as Run).at === 'number' && typeof (r as Run).line === 'string' && typeof (r as Run).ok === 'boolean')
    .map(r => ({ at: r.at, kind: clip(String(r.kind), 12), line: clip(r.line, 100), ok: r.ok, note: clip(String(r.note ?? ''), 120) }))
    .slice(-LIMITS.runs)

const addRun = async ($: Dollar, kind: string, line: string, ok: boolean, note: string) => {
  const next = [...(await read($, runsA)), { at: await nowOf($), kind, line: clip(line, 100), ok, note: clip(note, 120) }].slice(-LIMITS.runs)
  await update($, runsA, () => next)
  await $.store.set('runs', next).catch(() => undefined)
}

const setNotice = ($: Dollar, text: string) => update($, noticeA, () => clip(text, 300))

// ------------------------------------------------------------------ the one place this mod runs another command

/**
 * Every `$.command.run` this mod makes goes through here, and is refused unless it is on the allow list: `cfg` with a strict
 * argument shape (never a guard mod), `tidy`, `motion`, and own `cx*` commands that cannot loop. A failure is a value.
 */
const runOne = async ($: Dollar, command: string, args: string): Promise<{ ok: boolean; text: string }> => {
  if (!isAllowedRun(command, args)) {
    return { ok: false, text: `refused: /${command} ${clip(args, 40)} is not on the allow list` }
  }

  try {
    // A plugin's own hooks are skipped for its own `$.command.run`, so an own `cx*` step is answered here, by the same
    // function the slash command calls. Anything else goes through the engine to the mod that owns it.
    let text = ''

    if (command.startsWith(PREFIX)) {
      text = await runCommand($, command, args)
    } else {
      const result = await $.command.run({ command, args })
      text = typeof result.text === 'string' ? result.text : ''
    }

    return { ok: !looksFailed(text), text }
  } catch (error) {
    return { ok: false, text: `could not run: ${clip(String(error), 100)}` }
  }
}

/** Starts work after the current hook has returned, so a command hook never waits on a command it started. */
const defer = ($: Dollar, fn: () => Promise<unknown>) => {
  $.clock.after(0, () => {
    void fn().catch(() => undefined)
  })
}

const fillPrompt = async ($: Dollar, text: string): Promise<boolean> => {
  const done = await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)

  return done?.isFilled === true
}

/** Runs a list of already-checked steps one by one, stopping at the first failure. Only one list runs at a time. */
const runList = async ($: Dollar, kind: string, steps: StepCheck[]): Promise<void> => {
  if (isRunning) {
    await addRun($, kind, '(not started)', false, 'another macro or focus mode is still running')

    return
  }
  isRunning = true

  try {
    for (const step of steps) {
      if (!step.ok) {
        await addRun($, kind, '(invalid step)', false, step.why)
        break
      }
      const result = await runOne($, step.command, step.args)
      await addRun($, kind, step.line, result.ok, result.text.split('\n')[0] ?? '')

      if (!result.ok) {
        const isFilled = await fillPrompt($, step.line)
        await addRun($, kind, '(stopped)', false, isFilled ? `${step.line} is in the prompt box: press Enter to run it yourself` : `type ${step.line} yourself`)
        break
      }
    }
  } finally {
    isRunning = false
  }
}

const startList = async ($: Dollar, kind: 'macro' | 'focus', name: string, raw: readonly string[], toStep: (s: string) => StepCheck): Promise<string> => {
  const steps = raw.map(toStep)
  const bad = steps.find(s => !s.ok)

  if (bad !== undefined && !bad.ok) {
    return `${kind} ${name} was not run: ${bad.why}.`
  }

  if (isRunning) {
    return 'Another macro or focus mode is still running. See /cxmacro log.'
  }
  defer($, () => runList($, kind, steps))

  return `Started ${kind} ${name}: ${steps.length} step${steps.length === 1 ? '' : 's'}, one by one, stopping at the first failure. Results: /cxmacro log, or the Run tab.`
}

const macroStep = (s: string): StepCheck => checkMacroStep(s)
const focusStep = (s: string): StepCheck => checkFocusStep(s)

const runFocus = async ($: Dollar, name: string): Promise<string> => {
  const cfg = await read($, configA)
  const mode = [...BUILTIN_FOCUS, ...cfg.focus].find(f => f.name === name)

  return mode === undefined ? `No focus mode named ${clip(name, 20)}: /cxfocus list` : startList($, 'focus', name, mode.steps, focusStep)
}

const runMacro = async ($: Dollar, name: string): Promise<string> => {
  const cfg = await read($, configA)
  const macro = cfg.macros.find(m => m.name === name)

  return macro === undefined ? `No macro named ${clip(name, 20)}: /cxmacro list` : startList($, 'macro', name, macro.steps, macroStep)
}

// ------------------------------------------------------------------ do-not-disturb (145)

const dndTick = async ($: Dollar): Promise<void> => {
  const cfg = await read($, configA)

  if (!cfg.dnd.on || !(await isFeatureOn($, 'dnd'))) {
    return
  }
  const step = dndStep(cfg.dnd, minutesOfDay(await nowOf($)))

  if (step === null) {
    return
  }
  const result = await runOne($, CFG, step.args)
  await addRun($, 'dnd', `/${CFG} ${step.args}`, result.ok, result.text.split('\n')[0] ?? '')

  if (result.ok) {
    await changeConfig($, c => ({ ...c, dnd: { ...c.dnd, applied: step.args === 'feature quiet' } }))
  }
}

const startDnd = ($: Dollar) => {
  dndTimer?.cancel()
  dndTimer = $.clock.every(DND_MS, () => {
    void dndTick($).catch(() => undefined)
  })
}

const stopDnd = () => {
  dndTimer?.cancel()
  dndTimer = undefined
}

const dndCommand = async ($: Dollar, args: string): Promise<string> => {
  const v = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()
  const cfg = await read($, configA)

  if (v === 'on') {
    await saveConfig($, { ...cfg, dnd: { ...cfg.dnd, on: true } })
    startDnd($)
    defer($, () => dndTick($))
    const note = (await isFeatureOn($, 'dnd')) ? '' : ' The switch custom-two.dnd is off, so nothing runs until: /cfg feature custom-two.dnd on'

    return `Do-not-disturb on: ${cfg.dnd.from} to ${cfg.dnd.to}, checked every 5 minutes. Entering the window runs /cfg feature quiet; leaving it runs /cfg feature full (which clears all your switch overrides). The safety mods can never be muted.${note}`
  }

  if (v === 'off') {
    stopDnd()
    await saveConfig($, { ...cfg, dnd: { ...cfg.dnd, on: false } })

    return cfg.dnd.applied ? 'Do-not-disturb off. This mod had applied "quiet" and will not undo it: run /cfg feature full yourself when you want everything back.' : 'Do-not-disturb off.'
  }
  const ctx = await ctxOf($)
  const out = editDnd(cfg, args, ctx)

  if (out.cfg !== cfg) {
    await saveConfig($, out.cfg)
  }

  return out.text
}

// ------------------------------------------------------------------ hide rules (146)

const reconcile = async ($: Dollar): Promise<void> => {
  if (isReconciling) {
    return
  }
  isReconciling = true

  try {
    // One step at a time, re-deciding after each: a queued command can run late, so what was wanted may have changed.
    for (let i = 0; i < LIMITS.rules * 2; i++) {
      const cfg = await read($, configA)
      const enabled = await isFeatureOn($, 'hide-rules')
      const ctx = { busy: isBusy, calm: await read($, isCalmA), minutes: minutesOfDay(await nowOf($)) }
      const want = enabled ? desiredHidden(cfg.rules, ctx) : []
      const step = ruleSteps(cfg.hidden, want)[0]

      if (step === undefined) {
        return
      }
      const result = await runOne($, 'cfg', step.args)
      await addRun($, 'rule', `/cfg ${step.args}`, result.ok, result.text.split('\n')[0] ?? '')

      if (!result.ok) {
        return
      }
      const hides = step.args.endsWith(' off')
      await changeConfig($, c => ({ ...c, hidden: hides ? [...c.hidden.filter(m => m !== step.mod), step.mod] : c.hidden.filter(m => m !== step.mod) }))
    }
  } finally {
    isReconciling = false
  }
}

const scheduleReconcile = ($: Dollar) => {
  reconcileTimer?.cancel()
  reconcileTimer = $.clock.after(300, () => {
    void reconcile($).catch(() => undefined)
  })
}

/** Puts every row this mod hid back (`<mod>.band on`), for `/cxrules clear` and `/cxreset`. */
const restoreHidden = async ($: Dollar): Promise<void> => {
  for (const mod of [...(await read($, configA)).hidden]) {
    const result = await runOne($, 'cfg', `feature ${mod}.band on`)
    await addRun($, 'rule', `/cfg feature ${mod}.band on`, result.ok, result.text.split('\n')[0] ?? '')

    if (result.ok) {
      await changeConfig($, c => ({ ...c, hidden: c.hidden.filter(m => m !== mod) }))
    }
  }
}

const rulesCommand = async ($: Dollar, args: string): Promise<string> => {
  const v = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()
  const cfg = await read($, configA)

  if (v === 'check') {
    defer($, () => reconcile($))

    return `Checking the ${cfg.rules.length} rules now (switch custom-two.hide-rules is ${(await isFeatureOn($, 'hide-rules')) ? 'on' : 'off: with it off, rows this mod hid are put back'}). Results: Auto tab or /cxmacro log.`
  }

  if (v === 'clear') {
    await saveConfig($, { ...cfg, rules: [] })
    defer($, () => restoreHidden($))

    return `Rules cleared.${cfg.hidden.length > 0 ? ` Putting back ${cfg.hidden.join(', ')}.` : ''}`
  }
  const out = editRules(cfg, args)

  if (out.cfg !== cfg) {
    await saveConfig($, out.cfg)
  }

  return out.text
}

// ------------------------------------------------------------------ recording (switch `record`), sounds, toasts

const isFailed = (ran: unknown): boolean => typeof ran === 'object' && ran !== null && (ran as { isError?: boolean }).isError === true

const playEvent = async ($: Dollar, ev: SoundEvent, force = false): Promise<string> => {
  const cfg = await read($, configA)
  const file = cfg.sounds[ev] ?? ''

  if (file === '' || !SOUND_FILES.includes(file)) {
    return `No sound set for ${ev}.`
  }

  if (!force && !(await isFeatureOn($, 'event-sounds'))) {
    return 'off'
  }
  const now = await nowOf($)

  if (!force && lastSoundAt !== 0 && now - lastSoundAt < SOUND_GAP_MS) {
    return 'throttled'
  }
  lastSoundAt = now
  await $.audio.play({ asset: `sounds/${file}` }, { gain: 0.6 }).catch(() => undefined)

  return `Played ${file}.`
}

const afterCall = async ($: Dollar, e: Record<string, unknown>, isErr: boolean): Promise<void> => {
  const isRecording = await isFeatureOn($, 'record')
  const isSounding = await isFeatureOn($, 'event-sounds')

  // Both switches are off by default: a tool call then costs this mod two reads and nothing else.
  if (!isRecording && !isSounding) {
    return
  }
  const row = toRow(await nowOf($), String(e.tool ?? ''), !isErr, e, await read($, branchA))

  if (row.tool === '') {
    return
  }

  if (isRecording) {
    const next = pushRow(await read($, logA), row)
    await update($, logA, () => next)
    await $.store.set('log', next).catch(() => undefined)
  }

  if (isErr) {
    await playEvent($, 'error')
  } else if (row.commit) {
    await playEvent($, 'commit')
  }
}

const toast = async ($: Dollar, text: string): Promise<boolean> => {
  const now = await nowOf($)

  if ((lastToastAt !== 0 && now - lastToastAt < TOAST_GAP_MS) || (await read($, isCalmA)) === true) {
    return false
  }
  lastToastAt = now
  try {
    $.ui.toast(text, { timeoutMs: 6000 })
  } catch {
    return false
  }

  return true
}

const refreshBranch = async ($: Dollar, force: boolean): Promise<string> => {
  const now = await nowOf($)

  if (!force && lastBranchAt !== 0 && now - lastBranchAt < BRANCH_GAP_MS) {
    return read($, branchA)
  }
  lastBranchAt = now
  // Read-only: `git rev-parse --abbrev-ref HEAD` changes nothing and sends nothing anywhere.
  const out = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 }).catch(() => undefined)
  const branch = out !== undefined && out.exitCode === 0 ? parseBranch(out.stdout) : ''
  await update($, branchA, () => branch)

  return branch
}

const afterTurn = async ($: Dollar, reason: string): Promise<void> => {
  if (await isFeatureOn($, 'branch-accent')) {
    await refreshBranch($, false)
  }

  if (reason === 'answer') {
    await playEvent($, 'turn-end')
  }

  if (await isFeatureOn($, 'tip-toast')) {
    const cfg = await read($, configA)
    const now = await nowOf($)
    const today = Math.floor(now / 86400000)
    const tip = pickByDay(allTips(cfg), now)

    if (cfg.tipDay !== today && tip !== undefined && (await toast($, `Tip: ${tip}`))) {
      await changeConfig($, c => ({ ...c, tipDay: today }))
    }
  }
}

const greetAtStart = async ($: Dollar): Promise<void> => {
  if (!(await isFeatureOn($, 'greet-toast'))) {
    return
  }
  const cfg = await read($, configA)
  const now = await nowOf($)
  await toast($, greetingNow(cfg, now, new Date(now).getHours()))
}

// ------------------------------------------------------------------ the demo animation (142)

const demoStop = () => {
  demoTimer?.cancel()
  demoTimer = undefined
}

const demoStep = async ($: Dollar): Promise<void> => {
  const gated = !(await read($, motionIsOn)) || (await read($, isCalmA)) === true || !(await isFeatureOn($, 'demo-motion'))
  const next = (await read($, frameA)) + 1

  if (gated || next >= FRAMES - 1) {
    demoStop()
    await update($, frameA, () => FRAMES - 1)

    return
  }
  await update($, frameA, () => next)
}

const startDemo = async ($: Dollar): Promise<string> => {
  demoStop()

  if (!(await isFeatureOn($, 'demo-motion'))) {
    await update($, frameA, () => FRAMES - 1)

    return 'Static final frame: the curve demo motion is off (/cfg feature custom-two.demo-motion on).'
  }

  if (!(await read($, motionIsOn)) || (await read($, isCalmA)) === true) {
    await update($, frameA, () => FRAMES - 1)

    return 'Static final frame: motion is off (/motion on) or calm is on (/cfg calm off).'
  }
  await update($, frameA, () => 0)
  demoTimer = $.clock.every(FRAME_MS, () => {
    void demoStep($).catch(() => undefined)
  })

  return `Demo running: ${FRAMES} frames, one ticker of ${FRAME_MS} ms that stops by itself.`
}

// ------------------------------------------------------------------ theme from a logo colour (139)

const applyLogo = async ($: Dollar): Promise<string> => {
  const cfg = await read($, configA)

  if (cfg.logoHex === '') {
    return 'No logo colour yet: /cxlogo #e8643c'
  }
  const built = buildTheme(cfg.logoHex)

  if (built.args === undefined) {
    return `Not applied: ${built.refusal ?? 'refused'}`
  }

  // One theme call per command. Another mod that sets a theme later wins; /skuse off or the looks mod puts it back.
  try {
    const set = await $.theme.set(built.args)

    return `Applied a theme from ${cfg.logoHex}.${set.isDrawn ? '' : ` (not drawn here: ${set.reason})`}${built.notes.length > 0 ? ` ${built.notes.length} contrast note${built.notes.length === 1 ? '' : 's'}, still paints.` : ''} Last theme call wins; /skuse off clears it.`
  } catch (error) {
    return `Not applied: ${clip(String(error), 120)}`
  }
}

// ------------------------------------------------------------------ commands

const COMMANDS: readonly (readonly [string, string, string])[] = [
  ['cx', 'custom-two help: every command, one line each', ''],
  ['cxpane', 'Open the custom-two pane', '[tab]'],
  ['cxfile', '126 Colours per file type', '[list | <ext> <colour> | rm <ext> | reset]'],
  ['cxbranch', '127 An accent per git branch', '[list | <pattern> <colour> | rm | now]'],
  ['cxsound', '128 A sound per event', '[list | <event> <file|off> | test <event>]'],
  ['cxgreet', '129 Custom greetings', '[list | add <text> | rm <n> | name <name>]'],
  ['cxtip', '130 Custom tips', '[list | add <text> | rm <n> | today]'],
  ['cxempty', '131 Empty-state messages for this mod pane', '[list | <tab> <text> | rm <tab>]'],
  ['cxtitle', '132 Custom pane titles', '[list | <tab|main> <text> | rm <id>]'],
  ['cxrange', '133 Named date ranges for the log', '[list | add <name> <start> <end> | use <name|off>]'],
  ['cxfilter', '134 Saved log filters', '[list | save <name> k=v | use <name|off>]'],
  ['cxsearch', '135 Saved searches over the log', '[<text> | save <name> <text> | run <name>]'],
  ['cxreport', '136 Report template, rendered as text', '[set <text> | reset | template]'],
  ['cxexport', '137 Log as CSV, Markdown or JSON text', 'csv|md|json'],
  ['cxkeys', '138 Hotkey map: key to prompt text', '[list | add <key> <text> | use <key> | builtin]'],
  ['cxlogo', '139 A theme from a logo colour', '[<hex> | apply | clear]'],
  ['cxfont', '140 Font stack preview (preview only)', '[list | add <family> | rm <family>]'],
  ['cxicon', '141 Custom icon set', '[list | pack <name|auto> | <name> <glyph>]'],
  ['cxcurve', '142 Easing curves and a demo', '[list | <name> | add <name> x1 y1 x2 y2 | demo]'],
  ['cxsched', '143 Time-of-day look schedule (never automatic)', '[list | add <HH:MM> [skuse|look] <name> | now]'],
  ['cxfocus', '144 Focus modes: sets of /cfg feature steps', '[list | <name> | add <name> <steps> | rm <name>]'],
  ['cxdnd', '145 Do-not-disturb schedule (default off)', '[on | off | from <HH:MM> | to <HH:MM>]'],
  ['cxrules', '146 Hide mod rows by condition', '[list | add <mod> <cond> | rm <n> | check | clear]'],
  ['cxbundle', '147 Mod bundles: prints plugin enable and disable lines', '[list | add <name> <mods> | show <name>]'],
  ['cxcheck', '148 Onboarding checklist with ticks', '[list | add <text> | tick <n> | starter]'],
  ['cxgloss', '149 Personal glossary', '[list | add <term> = <meaning> | find <text>]'],
  ['cxmacro', '150 Macros: up to 6 allow-listed commands', '[list | add <name> <cmd ; cmd> | run <name> | log]'],
  ['cxlog', 'The recorded tool-call log: status and last rows', '[status | last [n]]'],
  ['cxreset', 'Clear the log and run list, put hidden rows back, stop do-not-disturb', '[all]'],
]

const helpText = (): string =>
  [
    'custom-two: customizing, part two. Nothing proactive is on by default; every switch is /cfg feature custom-two.<id> on|off.',
    ...COMMANDS.map(([name, description]) => `/${name.padEnd(9)} ${description}`),
    'Switches: record, file-colours, branch-accent, event-sounds, greet-toast, tip-toast, demo-motion, dnd, hide-rules. The pane: /cxpane.',
  ].join('\n')

const ctxOf = async ($: Dollar): Promise<EditCtx> => {
  const now = await nowOf($)
  const d = new Date(now)
  const usage = await $.session.usage().catch(() => undefined)

  return { now, hour: d.getHours(), minutes: d.getHours() * 60 + d.getMinutes(), log: await read($, logA), usd: usage?.cost?.usd ?? 0, branch: await read($, branchA) }
}

const runEdit = async ($: Dollar, fn: (cfg: Config, args: string, ctx: EditCtx) => Edit, args: string): Promise<string> => {
  const cfg = await read($, configA)
  const out = fn(cfg, args, await ctxOf($))

  if (out.cfg !== cfg) {
    await saveConfig($, out.cfg)
  }

  if (out.fill !== undefined && !(await fillPrompt($, out.fill))) {
    return `${out.text}\n(The prompt box could not be filled: type the line yourself.)`
  }

  return out.text
}

const openPane = async ($: Dollar, tab?: string): Promise<void> => {
  if (tab !== undefined) {
    await update($, tabA, () => tab)
    await update($, pageA, () => 0)
  }
  const cfg = await read($, configA)
  await $.ui.open({ id: PANE, title: cfg.titles.main ?? 'Custom two' }).catch(() => undefined)
}

const logText = async ($: Dollar, args: string): Promise<string> => {
  const cfg = await read($, configA)
  const now = await nowOf($)
  const all = await read($, logA)
  const rows = viewOf(all, cfg, now)
  const on = await isFeatureOn($, 'record')
  const n = Math.min(20, Math.max(1, Number(args.trim().split(/\s+/)[1]) || 8))
  const head = `Recording is ${on ? 'on' : 'off (/cfg feature custom-two.record on)'}. ${all.length} of at most ${LIMITS.log} rows kept, ${rows.length} in view (range ${cfg.range === '' ? 'all' : cfg.range}, filter ${cfg.filter === '' ? 'none' : cfg.filter}). Stored per call: tool, ok, file path, first word of a Bash command, branch.`

  return args.trim().startsWith('last') ? [head, ...rows.slice(-n).map(r => `${new Date(r.at).toISOString().slice(5, 16).replace('T', ' ')} ${r.ok ? 'ok   ' : 'ERROR'} ${r.tool} ${r.detail} ${r.file}`.trimEnd())].join('\n') : head
}

const resetCommand = async ($: Dollar, args: string): Promise<string> => {
  const all = args.trim().toLowerCase() === 'all'
  stopDnd()
  demoStop()
  await update($, logA, () => [])
  await update($, runsA, () => [])
  await update($, branchA, () => '')
  await update($, frameA, () => -1)
  await $.store.delete('log').catch(() => undefined)
  await $.store.delete('runs').catch(() => undefined)
  const cfg = await read($, configA)
  await saveConfig($, all ? { ...defaultConfig(), hidden: cfg.hidden, dnd: { ...defaultConfig().dnd, applied: cfg.dnd.applied } } : { ...cfg, dnd: { ...cfg.dnd, on: false }, rules: cfg.rules })
  defer($, () => restoreHidden($))

  return `Reset: the recorded log and run list are cleared, do-not-disturb is stopped${cfg.hidden.length > 0 ? `, and ${cfg.hidden.join(', ')} ${cfg.hidden.length === 1 ? 'is' : 'are'} being put back` : ''}.${all ? ' All your tables went back to the defaults too.' : ' Your tables are kept: /cxreset all clears those as well.'}${cfg.dnd.applied ? ' This mod had applied "quiet": run /cfg feature full to undo it.' : ''}`
}

const runCommand = async ($: Dollar, name: string, args: string): Promise<string> => {
  const first = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()

  switch (name) {
    case 'cx':
      return helpText()
    case 'cxpane': {
      const tab = first === '' ? undefined : TAB_IDS.includes(first) ? first : null

      if (tab === null) {
        return `Tabs: ${TAB_IDS.join(', ')}`
      }
      await openPane($, tab)

      return `Pane opened${tab === undefined ? '' : ` on ${tab}`}.`
    }
    case 'cxfile':
      return runEdit($, editFile, args)
    case 'cxbranch': {
      if (first === 'now') {
        const branch = await refreshBranch($, true)
        const cfg = await read($, configA)

        return branch === '' ? 'No branch read (not a git folder, or git is missing).' : `Branch ${branch}: accent ${accentOfBranch(cfg, branch) ?? 'none (the settings accent is used)'}. The pane header only uses it while custom-two.branch-accent is on.`
      }

      return runEdit($, editBranch, args)
    }
    case 'cxsound': {
      if (first === 'test') {
        const ev = (args.trim().split(/\s+/)[1] ?? '') as SoundEvent

        return (EVENTS as readonly string[]).includes(ev) ? await playEvent($, ev, true) : `Event is one of ${EVENTS.join(', ')}.`
      }

      return runEdit($, editSound, args)
    }
    case 'cxgreet':
      return runEdit($, editGreet, args)
    case 'cxtip':
      return runEdit($, editTip, args)
    case 'cxempty':
      return runEdit($, editEmpty, args)
    case 'cxtitle':
      return runEdit($, editTitle, args)
    case 'cxrange':
      return runEdit($, editRange, args)
    case 'cxfilter':
      return runEdit($, editFilter, args)
    case 'cxsearch':
      return runEdit($, editSearch, args)
    case 'cxreport':
      return runEdit($, editReport, args)
    case 'cxexport':
      return runEdit($, editExport, args)
    case 'cxkeys':
      return runEdit($, editKeys, args)
    case 'cxlogo':
      return first === 'apply' ? applyLogo($) : runEdit($, editLogo, args)
    case 'cxfont':
      return runEdit($, editFont, args)
    case 'cxicon':
      return runEdit($, editIcon, args)
    case 'cxcurve':
      return first === 'demo' ? startDemo($) : runEdit($, editCurve, args)
    case 'cxsched':
      return runEdit($, editSched, args)
    case 'cxfocus': {
      if (['', 'list', 'add', 'rm'].includes(first)) {
        return runEdit($, editFocus, args)
      }

      return runFocus($, first)
    }
    case 'cxdnd':
      return dndCommand($, args)
    case 'cxrules':
      return rulesCommand($, args)
    case 'cxbundle':
      return runEdit($, editBundle, args)
    case 'cxcheck':
      return runEdit($, editCheck, args)
    case 'cxgloss':
      return runEdit($, editGloss, args)
    case 'cxmacro': {
      if (first === 'run') {
        return runMacro($, (args.trim().split(/\s+/)[1] ?? '').toLowerCase())
      }

      if (first === 'log') {
        const runs = await read($, runsA)

        return runs.length === 0 ? 'No macro, focus, rule or do-not-disturb runs yet.' : [`Last ${Math.min(15, runs.length)} runs (newest last):`, ...runs.slice(-15).map(r => `  ${r.ok ? 'ok  ' : 'FAIL'} ${r.kind.padEnd(5)} ${r.line}${r.note === '' ? '' : `  ${r.note}`}`)].join('\n')
      }

      return runEdit($, editMacro, args)
    }
    case 'cxlog':
      return logText($, args)
    case 'cxreset':
      return resetCommand($, args)
    default:
      return `Unknown command /${name}.`
  }
}

// ------------------------------------------------------------------ pane actions

const selectTab = async ($: Dollar, id: string) => {
  await update($, tabA, () => id)
  await update($, pageA, () => 0)
}

const editFromPane = async ($: Dollar, fn: (cfg: Config, args: string, ctx: EditCtx) => Edit, args: string) => setNotice($, await runEdit($, fn, args))

const runFromPane = async ($: Dollar, kind: 'macro' | 'focus', name: string) => setNotice($, kind === 'macro' ? await runMacro($, name) : await runFocus($, name))

const fillFromPane = async ($: Dollar, text: string, what: string) =>
  setNotice($, (await fillPrompt($, text)) ? `${what}: put in the prompt box. Nothing was sent.` : `${what}: could not fill the prompt box. Type: ${clip(text, 100)}`)

// ------------------------------------------------------------------ the module

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await load($).catch(() => undefined)

    for (const [name, description, hint] of COMMANDS) {
      await $.command.register(hint === '' ? { name, description } : { name, description, argumentHint: hint }).catch(() => undefined)
    }
    const cfg = await read($, configA)

    if (cfg.dnd.on) {
      startDnd($)
    }
    defer($, async () => {
      if (await isFeatureOn($, 'branch-accent')) {
        await refreshBranch($, true)
      }
      await reconcile($)
      await greetAtStart($)
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopDnd()
    demoStop()

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({
      text: await runCommand($, name, e.args).catch(() => `/${name} hit an unexpected error. Nothing was changed.`),
    }))
  }

  // Recording and sounds only watch: the call's result is passed through untouched.
  on('tool.call', async ($, e, next) => {
    let ran: Awaited<ReturnType<typeof next>>

    try {
      ran = await next(e)
    } catch (error) {
      await afterCall($, e as unknown as Record<string, unknown>, true).catch(() => undefined)
      throw error
    }
    await afterCall($, e as unknown as Record<string, unknown>, isFailed(ran)).catch(() => undefined)

    return ran
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = true
      scheduleReconcile($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      isBusy = false
      scheduleReconcile($)
      await afterTurn($, e.reason).catch(() => undefined)
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // Only the desktop surface draws vector images; every other surface keeps the text version.
    const Svg = e.surface === 'desktop' ? (ui as ElementTable<'desktop'>).Svg : undefined
    const tab = await read($, tabA)
    const cfg = await read($, configA)
    const settingsAccent = (await read($, accentA)) as ColourKey
    const density = await read($, densityA)
    const settingsIcons = (await read($, iconsA)) as string
    const gap = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 12)
    const cols = e.props.bodyColumns
    const notice = await read($, noticeA)
    const page = await read($, pageA)
    const now = await nowOf($)
    const branch = await read($, branchA)
    const branchOn = await isFeatureOn($, 'branch-accent')
    const coloursOn = await isFeatureOn($, 'file-colours')
    const accent: ColourKey = (branchOn && branch !== '' ? accentOfBranch(cfg, branch) : undefined) ?? settingsAccent
    const icon = (n: string) => iconOf(cfg, n, settingsIcons)
    const empty = (id: string) => cfg.empty[id] ?? DEFAULT_EMPTY[id] ?? ''
    const labelOf = (id: string, label: string) => cfg.titles[id] ?? label

    const Section = (label: string) => (
      <Text size="caption" weight="semibold" dimColor>
        {label.toUpperCase()}
      </Text>
    )

    const Pager = (total: number) => {
      const pages = Math.max(1, Math.ceil(total / room))

      return (
        <Box gap="sm">
          <Button key="page-prev" label="<" onPress={() => update($, pageA, p => Math.max(0, p - 1))} />
          <Text dimColor>{`page ${Math.min(page, pages - 1) + 1}/${pages} · ${total} rows`}</Text>
          <Button key="page-next" label=">" onPress={() => update($, pageA, p => Math.min(pages - 1, p + 1))} />
        </Box>
      )
    }

    const startAt = (total: number) => Math.min(page, Math.max(0, Math.ceil(total / room) - 1)) * room

    const FileName = (file: string) => (
      <Text mono color={coloursOn ? colourOfFile(cfg, file) : undefined}>
        {clip(file, Math.max(12, cols - 24))}
      </Text>
    )

    let body: JSX.Element | null = null

    if (tab === 'look') {
      const log = await read($, logA)
      const files = [...new Set([...log].reverse().map(r => r.file).filter(f => f !== ''))]
      const samplesFiles = ['src/app.ts', 'src/view.tsx', 'package.json', 'README.md', 'build.py', 'styles.css', 'run.sh', 'notes.txt']
      body = (
        <Box flexDirection="column" gap="xs">
          {Section('Branch accent')}
          <Box gap="sm">
            <Text color={accent}>{branchOn ? (branch === '' ? 'no branch read yet' : `${icon('branch')} ${branch}`) : 'off: /cfg feature custom-two.branch-accent on'}</Text>
            <Button key="branch-now" label="Read branch now" onPress={async () => setNotice($, await runCommand($, 'cxbranch', 'now'))} />
          </Box>
          <Text dimColor>{cfg.branchRules.map(r => `${r.pattern}=${r.accent}`).join('  ') || 'no branch rules'}</Text>
          {Section(files.length === 0 ? 'Files (sample names: nothing recorded yet)' : 'Files touched (newest first)')}
          {(files.length === 0 ? samplesFiles : files.slice(startAt(files.length), startAt(files.length) + room)).map(f => FileName(f))}
          {files.length > room && Pager(files.length)}
          {!coloursOn && <Text dimColor>Colours are off: /cfg feature custom-two.file-colours on</Text>}
          {Section('Colour table')}
          <Box gap="sm" flexWrap="wrap">
            {Object.entries(cfg.fileColours).map(([ext, c]) => (
              <Text mono color={c as ColourKey}>{`.${ext}`}</Text>
            ))}
            {Object.keys(cfg.fileColours).length === 0 && <Text dimColor>{empty('look')}</Text>}
          </Box>
          {Section(`Icons (${cfg.pack === '' ? `follows /cfg icons: ${settingsIcons}` : cfg.pack})`)}
          <Text mono>{['ok', 'error', 'warn', 'file', 'branch', 'tip', 'sound', 'clock', 'tick', 'dot'].map(n => `${n}:${icon(n)}`).join('  ')}</Text>
          <Box gap="xs" flexWrap="wrap">
            {PACK_IDS.map(p => (
              <Button key={`pack-${p}`} label={p === cfg.pack ? `[${p}]` : p} onPress={() => editFromPane($, editIcon, `pack ${p}`)} />
            ))}
            <Button key="pack-auto" label={cfg.pack === '' ? '[auto]' : 'auto'} onPress={() => editFromPane($, editIcon, 'pack auto')} />
          </Box>
        </Box>
      )
    } else if (tab === 'theme') {
      const hex = cfg.logoHex
      const sw = hex === '' ? [] : swatchesOf(hex)
      const stack = cfg.fonts.map(f => `'${f}'`).join(', ')
      body = (
        <Box flexDirection="column" gap="xs">
          {Section('Theme from a logo colour')}
          {hex === '' ? (
            <Text dimColor>{empty('theme')}</Text>
          ) : (
            <Box flexDirection="column" gap="xs">
              {Svg !== undefined ? <Svg source={swatchSvg(sw)} alt={`Palette from ${hex}: ${sw.map(s => `${s.label} ${s.hex}`).join(', ')}`} {...svgSize(swatchSvg(sw), Math.min(620, sw.length * 76 + 8))} /> : <Text mono>{sw.map(s => `${s.label} ${s.hex}`).join(' · ')}</Text>}
              <Box gap="sm">
                <Button key="logo-apply" label="Apply theme (one call)" onPress={async () => setNotice($, await applyLogo($))} />
                <Text dimColor>{`from ${hex}; the last mod to set a theme wins; /skuse off clears it`}</Text>
              </Box>
            </Box>
          )}
          {Section('Font stack (preview only)')}
          {Svg !== undefined ? (
            <Svg source={fontSvg([{ label: 'sans', family: 'sans-serif' }, { label: 'serif', family: 'serif' }, { label: 'mono', family: 'monospace' }, { label: 'cursive', family: 'cursive' }, ...(cfg.fonts.length > 0 ? [{ label: 'your stack', family: `${stack}, sans-serif` }] : [])])} alt={`Font preview of sans, serif, mono, cursive${cfg.fonts.length > 0 ? ` and your stack ${cfg.fonts.join(', ')}` : ''}`} {...svgSize(fontSvg([{ label: 'sans', family: 'sans-serif' }, { label: 'serif', family: 'serif' }, { label: 'mono', family: 'monospace' }, { label: 'cursive', family: 'cursive' }, ...(cfg.fonts.length > 0 ? [{ label: 'your stack', family: `${stack}, sans-serif` }] : [])]), 440)} />
          ) : (
            <Text dimColor>{`Preview needs the desktop app. Stack: ${cfg.fonts.join(', ') || 'none'}`}</Text>
          )}
          <Text dimColor>{`The theme API takes exactly one generic family (${GENERIC_FONTS.join(', ')}), never a named font, and theme.set would replace the current look, so this mod only previews: ${cfg.fonts.join(', ') || 'no stack stored (/cxfont add <family>)'}`}</Text>
        </Box>
      )
    } else if (tab === 'curves') {
      const motion = await read($, motionIsOn)
      const calm = (await read($, isCalmA)) === true
      const demoOn = await isFeatureOn($, 'demo-motion')
      const animate = motion && !calm && demoOn
      const frame = await read($, frameA)
      const values = samples(cfg.curve, cfg.curves)
      const progress = frame < 0 ? 0 : (framesOf(cfg.curve, cfg.curves, FRAMES)[Math.min(frame, FRAMES - 1)] ?? 1)
      const line = Array.from({ length: 60 }, (_, i) => ease(cfg.curve, i / 59, cfg.curves))
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="xs" flexWrap="wrap">
            {['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack', 'easeOutBounce', 'easeOutElastic', 'step', ...cfg.curves.map(c => c.name)].map(n => (
              <Button key={`curve-${n}`} label={n === cfg.curve ? `[${n}]` : n} onPress={() => editFromPane($, editCurve, n)} />
            ))}
          </Box>
          {Svg !== undefined ? (
            <Svg source={curveSvg({ name: cfg.curve, values, line, progress, accent, isAnimated: animate })} alt={`Easing curve ${cfg.curve}, 12 sample dots: ${values.map(v => v.toFixed(2)).join(' ')}`} isInteractive={animate} {...svgSize(curveSvg({ name: cfg.curve, values, line, progress, accent, isAnimated: animate }), 360)} />
          ) : (
            <Box flexDirection="column">
              <Text mono color={accent}>{strip(values)}</Text>
              <Text mono dimColor>{values.map(v => v.toFixed(2)).join(' ')}</Text>
            </Box>
          )}
          <Text mono color={accent}>{`${cfg.curve.padEnd(15)} ${strip(values)}  (12 dots)`}</Text>
          <Box gap="sm">
            <Button key="demo" label="Play demo" onPress={async () => setNotice($, await startDemo($))} />
            <Text dimColor>{animate ? 'motion on: the ball runs once' : demoOn ? 'static: motion is off or calm is on' : 'static: custom-two.demo-motion is off'}</Text>
          </Box>
        </Box>
      )
    } else if (tab === 'sounds') {
      const soundsOn = await isFeatureOn($, 'event-sounds')
      body = (
        <Box flexDirection="column" gap="xs">
          <Text color={soundsOn ? 'success' : undefined} dimColor={!soundsOn}>{soundsOn ? `${icon('sound')} Event sounds are on` : 'Event sounds are off: /cfg feature custom-two.event-sounds on'}</Text>
          {EVENTS.map(ev => {
            const file = cfg.sounds[ev] ?? ''
            const options = ['', ...SOUND_FILES]
            const nextFile = options[(options.indexOf(file) + 1) % options.length] ?? ''

            return (
              <Box gap="sm">
                <Text mono>{ev.padEnd(9)}</Text>
                <Button key={`snd-${ev}`} label={file === '' ? 'off' : file} onPress={() => editFromPane($, editSound, `${ev} ${nextFile === '' ? 'off' : nextFile}`)} />
                <Button key={`play-${ev}`} label="play" onPress={async () => setNotice($, await playEvent($, ev, true))} />
              </Box>
            )
          })}
          <Text dimColor>{`Files in sounds/: ${SOUND_FILES.join(', ')}. A button cycles the file. Plays at most once per 1.5 s, quietly.`}</Text>
        </Box>
      )
    } else if (tab === 'words') {
      const tips = allTips(cfg)
      body = (
        <Box flexDirection="column" gap="xs">
          {Section('Greeting now')}
          <Text color={accent}>{greetingNow(cfg, now, new Date(now).getHours())}</Text>
          <Text dimColor>{`${cfg.greetTemplates.length} templates · name ${cfg.greetName === '' ? '(none)' : cfg.greetName} · /cxgreet add <text with {time} {name}>`}</Text>
          {Section('Tip')}
          <Text>{pickByDay(tips, now) ?? ''}</Text>
          <Text dimColor>{`${tips.length} tips (${cfg.tips.length} yours) · /cxtip add <text>`}</Text>
          {Section('Empty-state messages and titles (used by this pane)')}
          <Text dimColor>{`Empty: ${Object.keys(cfg.empty).join(', ') || 'defaults'} · Titles: ${Object.keys(cfg.titles).join(', ') || 'defaults'}`}</Text>
          <Text dimColor>{`/cxempty <tab> <text> and /cxtitle <tab|main> <text>; tabs: ${TAB_IDS.join(', ')}`}</Text>
        </Box>
      )
    } else if (tab === 'log') {
      const all = await read($, logA)
      const rows = viewOf(all, cfg, now)
      const shown = [...rows].reverse()
      const start = startAt(shown.length)
      body = (
        <Box flexDirection="column" gap="xs">
          <Text dimColor>{`${(await isFeatureOn($, 'record')) ? 'Recording' : 'Recording is OFF (/cfg feature custom-two.record on)'} · ${all.length}/${LIMITS.log} kept · ${rows.length} in view`}</Text>
          <Box gap="xs" flexWrap="wrap">
            {Section('range')}
            {['', 'today', 'week', ...cfg.ranges.slice(0, 8).map(r => r.name)].map(n => (
              <Button key={`range-${n || 'all'}`} label={n === cfg.range ? `[${n || 'all'}]` : n || 'all'} onPress={() => editFromPane($, editRange, `use ${n || 'off'}`)} />
            ))}
          </Box>
          <Box gap="xs" flexWrap="wrap">
            {Section('filter')}
            {['', ...cfg.filters.slice(0, 8).map(f => f.name)].map(n => (
              <Button key={`filter-${n || 'none'}`} label={n === cfg.filter ? `[${n || 'none'}]` : n || 'none'} onPress={() => editFromPane($, editFilter, `use ${n || 'off'}`)} />
            ))}
          </Box>
          {cfg.searches.length > 0 && <Text dimColor>{`saved searches: ${cfg.searches.map(s => s.name).join(', ')} (/cxsearch run <name>)`}</Text>}
          {shown.length === 0 && <Text dimColor>{empty('log')}</Text>}
          {shown.slice(start, start + room).map(r => (
            <Box gap="sm">
              <Text mono dimColor>{new Date(r.at).toISOString().slice(5, 16).replace('T', ' ')}</Text>
              <Text color={r.ok ? 'success' : 'error'}>{r.ok ? icon('ok') : icon('error')}</Text>
              <Text>{`${r.tool}${r.detail === '' ? '' : ` ${r.detail}`}`}</Text>
              {r.file !== '' && FileName(r.file)}
              {r.commit && <Text color="success">commit</Text>}
            </Box>
          ))}
          {Pager(shown.length)}
        </Box>
      )
    } else if (tab === 'report') {
      const rows = viewOf(await read($, logA), cfg, now)
      const usage = await $.session.usage().catch(() => undefined)
      const text = renderTemplate(cfg.template, reportVars(rows, cfg, usage?.cost?.usd ?? 0, branch, now))
      const fmtStored = await read($, fmtA)
      const fmt = (['csv', 'md', 'json'] as const).find(f => f === fmtStored) ?? 'csv'
      const stats = statsOf(rows)
      body = (
        <Box flexDirection="column" gap="xs">
          {Section('Report (text only, never written)')}
          {rows.length === 0 ? <Text dimColor>{empty('report')}</Text> : null}
          {text.split('\n').map(l => (
            <Text color={accent}>{l}</Text>
          ))}
          <Text dimColor>{`${stats.calls} calls · ${stats.errors} errors · ${stats.files} files · ${stats.commits} commits in view. Template: /cxreport set <text with {calls} {errors} {files} {commits} {spend} {range} {filter} {branch} {date}>`}</Text>
          {Section(`Export as ${fmt} (last 12 rows; /cxexport ${fmt} prints up to 60)`)}
          <Box gap="xs">
            {(['csv', 'md', 'json'] as const).map(f => (
              <Button key={`fmt-${f}`} label={f === fmt ? `[${f}]` : f} onPress={() => update($, fmtA, () => f)} />
            ))}
          </Box>
          {exportRows(rows, fmt, 12).split('\n').slice(0, 40).map(l => (
            <Text mono dimColor>{clip(l, Math.max(20, cols - 2))}</Text>
          ))}
        </Box>
      )
    } else if (tab === 'keys') {
      const entries = Object.entries(cfg.keys)
      body = (
        <Box flexDirection="column" gap="xs">
          <Text color="warning">This mod cannot register keys. A row is prompt text you put in the prompt box with its button (or /cxkeys use).</Text>
          {entries.length === 0 && <Text dimColor>{empty('keys')}</Text>}
          {entries.map(([k, t]) => (
            <Box gap="sm">
              <Button key={`key-${k}`} label={k} onPress={() => fillFromPane($, t, `Key ${k}`)} />
              <Text dimColor>{clip(t, Math.max(12, cols - k.length - 8))}</Text>
            </Box>
          ))}
          {Section('Common shortcuts of the app (from memory, may differ by version and surface)')}
          {KNOWN_SHORTCUTS.map(([k, d]) => (
            <Box gap="sm">
              <Text mono>{k.padEnd(10)}</Text>
              <Text dimColor>{d}</Text>
            </Box>
          ))}
        </Box>
      )
    } else if (tab === 'auto') {
      const calm = (await read($, isCalmA)) === true
      const minutes = minutesOfDay(now)
      const current = schedNow(cfg.sched, minutes)
      const hideOn = await isFeatureOn($, 'hide-rules')
      const dndOn = await isFeatureOn($, 'dnd')
      body = (
        <Box flexDirection="column" gap="xs">
          {Section('Look schedule (never applied for you)')}
          {cfg.sched.length === 0 && <Text dimColor>{empty('auto')}</Text>}
          {[...cfg.sched].sort((a, b) => a.at.localeCompare(b.at)).map(s => (
            <Text mono color={current !== undefined && current.at === s.at ? accent : undefined}>{`${s.at}  /${s.via} ${s.look}${current !== undefined && current.at === s.at ? '   <- in force' : ''}`}</Text>
          ))}
          {current !== undefined && <Button key="sched-fill" label={`Put /${current.via} ${current.look} in the prompt`} onPress={() => fillFromPane($, `/${current.via} ${current.look}`, 'Look command')} />}
          {Section('Do-not-disturb')}
          <Box gap="sm">
            <Text>{`${cfg.dnd.on ? 'ON' : 'off'} · ${cfg.dnd.from} to ${cfg.dnd.to}${cfg.dnd.applied ? ' · quiet applied' : ''}${dndOn ? '' : ' · switch custom-two.dnd is off'}`}</Text>
            <Button key="dnd-toggle" label={cfg.dnd.on ? 'Turn off' : 'Turn on'} onPress={async () => setNotice($, await dndCommand($, cfg.dnd.on ? 'off' : 'on'))} />
          </Box>
          <Text dimColor>Entering the window runs /cfg feature quiet, leaving it /cfg feature full (clears all overrides). The safety mods cannot be muted.</Text>
          {Section(`Hide rules (${hideOn ? 'switch on' : 'switch custom-two.hide-rules is off'})`)}
          {cfg.rules.length === 0 && <Text dimColor>no rules: /cxrules add workbench idle</Text>}
          {cfg.rules.map((r, i) => (
            <Text>{`${i + 1}. hide ${r.mod} while ${r.cond}${holds(r.cond, { busy: isBusy, calm, minutes }) ? '  (condition holds)' : ''}${cfg.hidden.includes(r.mod) ? '  (hidden now)' : ''}`}</Text>
          ))}
          <Box gap="sm">
            <Button key="rules-check" label="Check rules now" onPress={async () => setNotice($, await rulesCommand($, 'check'))} />
            <Button key="rules-clear" label="Clear and restore" onPress={async () => setNotice($, await rulesCommand($, 'clear'))} />
          </Box>
        </Box>
      )
    } else if (tab === 'run') {
      const runs = await read($, runsA)
      body = (
        <Box flexDirection="column" gap="xs">
          {Section('Focus modes (sets of /cfg feature steps)')}
          {[...BUILTIN_FOCUS, ...cfg.focus].map(f => (
            <Box gap="sm">
              <Button key={`focus-${f.name}`} label={`run ${f.name}`} onPress={() => runFromPane($, 'focus', f.name)} />
              <Text dimColor>{clip(f.steps.join(' ; '), Math.max(12, cols - 20))}</Text>
            </Box>
          ))}
          {Section('Macros (cfg, tidy, motion, own cx* commands; stop at the first failure)')}
          {cfg.macros.length === 0 && <Text dimColor>{empty('run')}</Text>}
          {cfg.macros.map(m => (
            <Box gap="sm">
              <Button key={`macro-${m.name}`} label={`run ${m.name}`} onPress={() => runFromPane($, 'macro', m.name)} />
              <Text dimColor>{clip(m.steps.join(' ; '), Math.max(12, cols - 20))}</Text>
            </Box>
          ))}
          {Section('Runs (newest last)')}
          {runs.slice(-Math.max(3, room - 8)).map(r => (
            <Text mono color={r.ok ? undefined : 'error'}>{clip(`${r.ok ? 'ok  ' : 'FAIL'} ${r.kind.padEnd(5)} ${r.line}${r.note === '' ? '' : ` ${r.note}`}`, Math.max(20, cols - 2))}</Text>
          ))}
        </Box>
      )
    } else {
      const selectedName = await read($, selectedA)
      const chosen = cfg.bundles.find(b => b.name === selectedName)
      const g = cfg.glossary
      const start = startAt(g.length)
      const done = cfg.checklist.filter(c => c.done).length
      body = (
        <Box flexDirection="column" gap="xs">
          {Section(`Checklist ${done}/${cfg.checklist.length}`)}
          {cfg.checklist.length === 0 && <Text dimColor>{empty('lists')}</Text>}
          {cfg.checklist.map((c, i) => (
            <Box gap="sm">
              <Button key={`tick-${i}`} label={c.done ? '[x]' : '[ ]'} onPress={() => editFromPane($, editCheck, `${c.done ? 'untick' : 'tick'} ${i + 1}`)} />
              <Text dimColor={c.done}>{c.text}</Text>
            </Box>
          ))}
          {Section('Bundles (lines are printed, never run)')}
          {cfg.bundles.map(b => (
            <Box gap="sm">
              <Button key={`bundle-${b.name}`} label={b.name} onPress={() => update($, selectedA, () => b.name)} />
              <Text dimColor>{clip(b.mods.join(', '), Math.max(12, cols - 20))}</Text>
            </Box>
          ))}
          {chosen !== undefined && bundleLines(chosen).map(l => <Text mono dimColor>{clip(l, Math.max(20, cols - 2))}</Text>)}
          {Section(`Glossary (${g.length})`)}
          {g.length === 0 && <Text dimColor>no terms: /cxgloss add term = meaning</Text>}
          {g.slice(start, start + Math.max(4, room - 6)).map(t => (
            <Box gap="sm">
              <Text weight="semibold">{t.term}</Text>
              <Text dimColor>{clip(t.meaning, Math.max(12, cols - t.term.length - 6))}</Text>
            </Box>
          ))}
          {g.length > room - 6 && Pager(g.length)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding={gap} gap={gap}>
        <Box justifyContent="space-between">
          <Text size="heading" weight="bold" color={accent}>
            {cfg.titles.main ?? 'Custom two'}
          </Text>
          <Text dimColor>{branchOn && branch !== '' ? `${icon('branch')} ${branch}` : `${Object.keys(cfg.fileColours).length} colours · ${cfg.macros.length} macros`}</Text>
        </Box>
        <Box gap="xs" flexWrap="wrap">
          {TABS.map(([id, label]) => (
            <Button key={`tab-${id}`} label={id === tab ? `[${labelOf(id, label)}]` : labelOf(id, label)} onPress={() => selectTab($, id)} />
          ))}
        </Box>
        {notice !== '' && <Text color={accent}>{clip(notice, 300)}</Text>}
        {body}
      </Box>
    )
  })
}
