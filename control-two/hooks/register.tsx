import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register } from 'claude-code'

import type {
  Applied,
  CliState,
  ErrEntry,
  HealthRow,
  HealthState,
  InstalledState,
  Light,
  Note,
  Pending,
  Pin,
  Progress,
  Refusal,
  Rule,
  SaveMode,
  Snap,
  SnapOwn,
  Stat,
  StorageRow,
} from '../types'
import {
  CALL_GAP_MS,
  CALL_TIMEOUT_MS,
  COMMANDS,
  MAX_NOTES,
  MAX_PINS,
  MAX_RULES,
  PANE,
  RUN_TIMEOUT_MS,
  SELF,
  TABS,
  VERSION,
  addStat,
  allMods,
  bareName,
  buildDiag,
  changeLine,
  changelogRows,
  cleanOverrides,
  clip,
  compareUpdates,
  depLines,
  diffOverrides,
  discoverBundled,
  duplicateText,
  errorCounts,
  featureArgs,
  findMod,
  fmtBytes,
  fmtClock,
  fmtMs,
  healthFor,
  helpText,
  isErrorLine,
  isOn,
  isPersonOrigin,
  isTab,
  liveConflicts,
  looksLikeVersionOutput,
  makePending,
  makeSnap,
  metricText,
  metricsFromUsage,
  noResetMods,
  normalizeApplied,
  normalizeLive,
  normalizeNotes,
  normalizePins,
  normalizeRules,
  normalizeSnaps,
  orderRows,
  pad,
  pageOf,
  parseNote,
  parseOnOff,
  parsePin,
  parsePluginList,
  parseRule,
  pendingState,
  planRules,
  pushError,
  pushRefusal,
  pushSnap,
  resetCommands,
  resetListText,
  restoreCalls,
  rollbackText,
  ruleText,
  sanitize,
  secondsLeft,
  selfTests,
  sizeOf,
  soundsBatch,
  soundsPlan,
  soundsState,
  topStats,
  traceFailures,
  updateCount,
  updateLine,
  withNote,
  withPin,
} from './pure'
import type { TraceLike, UpdateRow } from './pure'
import { depGraphSvg, graphAlt } from './svg'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

// ------------------------------------------------------------------ state

const tabA = atom({ plugin: 'control-two', key: 'tab' } as const, 'quick')
const pageA = atom({ plugin: 'control-two', key: 'page' } as const, 0)
const noticeA = atom({ plugin: 'control-two', key: 'notice' } as const, '')
const selectedA = atom({ plugin: 'control-two', key: 'selected' } as const, '')
// The global recording flag this mod keeps. Other mods do not have to read it; it is here so one place says "recording".
const recordingA = atom({ plugin: 'control-two', key: 'recording' } as const, false)
const persistA = atom({ plugin: 'control-two', key: 'persist' } as const, 'saved')
const updatesAtA = atom({ plugin: 'control-two', key: 'updatesAt' } as const, 0)
const rulesA = atom({ plugin: 'control-two', key: 'rules' } as const, [], { shape: 'rules-1' })
const appliedA = atom({ plugin: 'control-two', key: 'applied' } as const, {}, { shape: 'applied-1' })
const pinsA = atom({ plugin: 'control-two', key: 'pins' } as const, [], { shape: 'pins-1' })
const notesA = atom({ plugin: 'control-two', key: 'notes' } as const, [], { shape: 'notes-1' })
const snapsA = atom({ plugin: 'control-two', key: 'snaps' } as const, [], { shape: 'snaps-1' })
const pendingA = atom({ plugin: 'control-two', key: 'pending' } as const, null, { shape: 'pending-1' })
const progressA = atom({ plugin: 'control-two', key: 'progress' } as const, null, { shape: 'progress-1' })
const installedA = atom({ plugin: 'control-two', key: 'installed' } as const, null, { shape: 'installed-1' })
const cliA = atom({ plugin: 'control-two', key: 'cli' } as const, { status: 'unknown', at: 0 }, { shape: 'cli-1' })
const healthA = atom({ plugin: 'control-two', key: 'health' } as const, null, { shape: 'health-1' })
const timingA = atom({ plugin: 'control-two', key: 'timing' } as const, {}, { shape: 'timing-1' })
const linksA = atom({ plugin: 'control-two', key: 'links' } as const, {}, { shape: 'links-1' })
const errorsA = atom({ plugin: 'control-two', key: 'errors' } as const, [], { shape: 'errors-1' })
const orderA = atom({ plugin: 'control-two', key: 'order' } as const, null, { shape: 'order-1' })
const refusalsA = atom({ plugin: 'control-two', key: 'refusals' } as const, [], { shape: 'refusals-1' })
const storageA = atom({ plugin: 'control-two', key: 'storage' } as const, [], { shape: 'storage-1' })

// Foreign atoms: read only, with defaults when their owners never wrote them.
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
const calmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const presetA = atom({ plugin: 'settings', key: 'preset' } as const, 'full')
// Overrides only: an absent id means that switch's default. Changed by `/cfg feature ...`, never written here.
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)

// Session memory only: the CLI that worked, and a lock so two call sequences never overlap.
let cliCache: { argv: string[]; via: 'path' | 'bundled' } | undefined
let isRunning = false

const STORE_OWN = ['kx.recording', 'kx.rules', 'kx.applied', 'kx.pins'] as const

// ------------------------------------------------------------------ small helpers

const nowOf = ($: Dollar): Promise<number> => $.clock.now().catch(() => 0)
const homeOf = ($: Dollar): Promise<string | undefined> => $.env.get('HOME').catch(() => undefined)
const setNotice = ($: Dollar, text: string) => update($, noticeA, () => clip(text, 400))

/** One of this mod's own switches (features.json), read the documented way. */
const flag = async ($: Dollar, id: string, dflt: boolean): Promise<boolean> => isOn(await read($, featuresA), `${SELF}.${id}`, dflt)

const fillPrompt = async ($: Dollar, text: string, what: string): Promise<string> => {
  const done = await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)
  const said = done?.isFilled === true ? `${what}: put in the prompt box. Nothing was sent.` : `${what}: could not fill the prompt box. Line: ${text}`
  await setNotice($, said)

  return said
}

/** Resolves 'timeout' after `ms`; `cancel()` stops the timer once the real answer is in. */
const timeoutAfter = ($: Dollar, ms: number) => {
  let cancel: () => void = () => undefined
  const promise = new Promise<'timeout'>(resolve => {
    const timer = $.clock.after(ms, () => resolve('timeout'))
    cancel = () => timer.cancel()
  })

  return { promise, cancel: () => cancel() }
}

/** Runs `fn` just after the current hook has returned: a hook the session waits on may not queue a command. */
const defer = ($: Dollar, fn: () => Promise<unknown>) => {
  $.clock.after(20, () => {
    fn().catch(() => undefined)
  })
}

const openPane = async ($: Dollar, tab?: string) => {
  if (tab !== undefined && isTab(tab)) {
    await update($, tabA, () => tab)
    await update($, pageA, () => 0)
  }
  await $.ui.open({ id: PANE, title: 'Control two' }).catch(() => undefined)
}

const saveOwn = async ($: Dollar, key: (typeof STORE_OWN)[number], value: unknown) => {
  if ((await read($, persistA)) === 'saved') {
    await $.store.set(key, value).catch(() => undefined)
  }
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

// ------------------------------------------------------------------ running other mods' commands (178-180, 176)

type Call = { command: string; args: string }
type CallResult = { ok: boolean; text: string; line: string }

/**
 * Runs one slash command as a plugin call (`$.command.run`). If it is refused, rejects or nobody answers within 10 s, the
 * same line is put in the prompt box for the person to send, and the result says so.
 */
const runCommand = async ($: Dollar, command: string, args: string): Promise<CallResult> => {
  const line = `/${command} ${args}`.trim()
  const timer = timeoutAfter($, CALL_TIMEOUT_MS)
  const answer = await Promise.race([
    $.command.run({ command, args }).then(
      r => (typeof r.text === 'string' ? r.text : ''),
      () => undefined,
    ),
    timer.promise,
  ])
  timer.cancel()

  if (answer === undefined || answer === 'timeout') {
    const done = await $.prompt.fill({ text: line, mode: 'replace' }).catch(() => undefined)

    return {
      ok: false,
      line,
      text: done?.isFilled === true ? `Could not run ${line} from here, so it is in the prompt box: press Enter to send it.` : `Could not run ${line} from here. Type it yourself: ${line}`,
    }
  }

  return { ok: true, line, text: answer }
}

/**
 * Runs the calls one after the other with a short pause, one at a time (never two sequences at once). It stops at the first
 * call that cannot be run, and says how far it got. Progress shows in the Quick tab.
 */
const runSeq = async ($: Dollar, label: string, calls: readonly Call[]): Promise<{ done: number; total: number; failed: string; text: string }> => {
  const total = calls.length

  if (isRunning) {
    return { done: 0, total, failed: '', text: 'Another change is still running: wait for it to finish (see the Quick tab).' }
  }
  isRunning = true
  let done = 0
  let failed = ''
  let last = ''

  try {
    for (const [i, call] of calls.entries()) {
      await update($, progressA, () => ({ label, done, total, failed: '', isRunning: true }))
      const r = await runCommand($, call.command, call.args)

      if (!r.ok) {
        failed = r.text
        break
      }
      last = r.text
      done++

      if (i < calls.length - 1) {
        await $.clock.sleep(CALL_GAP_MS).catch(() => undefined)
      }
    }
  } finally {
    isRunning = false
    await update($, progressA, () => ({ label, done, total, failed, isRunning: false }))
  }
  const text = failed !== '' ? `${label}: stopped after ${done} of ${total}. ${failed}` : `${label}: ${done} of ${total} done.${total === 1 && last !== '' ? ` ${clip(last, 160)}` : ''}`
  await setNotice($, text)

  return { done, total, failed, text }
}

// ------------------------------------------------------------------ quick toggles (177-182)

const doMotion = async ($: Dollar, mode: 'on' | 'off' | 'toggle' | 'status', isDeferred: boolean): Promise<string> => {
  const cur = await read($, motionIsOn)

  if (mode === 'status') {
    return `Motion is ${cur ? 'on' : 'off'}.`
  }
  const target = mode === 'toggle' ? !cur : mode === 'on'
  const args = target ? 'on' : 'off'
  const go = async () => {
    const r = await runCommand($, 'motion', args)
    await setNotice($, r.ok ? clip(r.text, 200) || `Motion ${args}.` : r.text)
  }

  if (isDeferred) {
    defer($, go)
  } else {
    await go()
  }

  return `Motion is ${cur ? 'on' : 'off'}. Asking the motion mod: /motion ${args}. If nothing changes, type /motion ${args} yourself.`
}

const doCalm = async ($: Dollar, mode: 'on' | 'off' | 'toggle' | 'status', isDeferred: boolean): Promise<string> => {
  const cur = await read($, calmA)

  if (mode === 'status') {
    return `Calm is ${cur ? 'on' : 'off'}.`
  }
  const target = mode === 'toggle' ? !cur : mode === 'on'
  const args = `calm ${target ? 'on' : 'off'}`
  const go = async () => {
    const r = await runCommand($, 'cfg', args)
    await setNotice($, r.ok ? clip(r.text, 200) || `Calm ${target ? 'on' : 'off'}.` : r.text)
  }

  if (isDeferred) {
    defer($, go)
  } else {
    await go()
  }

  return `Calm is ${cur ? 'on' : 'off'}. Asking the settings mod: /cfg ${args}. If nothing changes, type it yourself.`
}

const soundsWord = (s: 'on' | 'off' | 'mixed'): string => (s === 'on' ? 'all on' : s === 'off' ? 'all off' : 'some off')

const doSounds = async ($: Dollar, mode: 'on' | 'off' | 'toggle' | 'status', isDeferred: boolean): Promise<string> => {
  const o = cleanOverrides(await read($, featuresA))
  const state = soundsState(o)

  if (mode === 'status') {
    return `Sounds: ${soundsWord(state)} (the sounds switch of each mod except the locked ones: ${['settings', 'tool-guard', 'safety-pro', 'controls'].join(', ')}).`
  }
  // From a mixed state a toggle makes everything quiet; say `on` to turn every sound back on.
  const target: 'on' | 'off' = mode === 'toggle' ? (state === 'off' ? 'on' : 'off') : mode
  const plan = soundsPlan(o, target)

  if (plan.length === 0) {
    return `Nothing to do: every sound switch is already ${target}.`
  }
  const { calls, rest } = soundsBatch(plan)
  const go = () => runSeq($, `sounds ${target}`, calls.map(args => ({ command: 'cfg', args })))

  if (isDeferred) {
    defer($, go)
  } else {
    await go()
  }

  return `Sounds ${target}: ${calls.length} calls of /cfg feature <mod>.sounds ${target}, one per mod, one after the other (about ${Math.ceil((calls.length * CALL_GAP_MS) / 1000) + 1} s). Progress is in the Quick tab.${rest > 0 ? ` ${rest} more mods remain: run /kxsounds ${target} again when it has finished (at most 39 calls go out at a time).` : ''}`
}

const doRecording = async ($: Dollar, mode: 'on' | 'off' | 'toggle' | 'status'): Promise<string> => {
  const cur = await read($, recordingA)

  if (mode === 'status') {
    return `Recording flag: ${cur ? 'on' : 'off'}. Only this mod keeps it: no other mod reads it unless it reads the atom control-two.recording.`
  }
  const target = mode === 'toggle' ? !cur : mode === 'on'
  await update($, recordingA, () => target)
  await saveOwn($, 'kx.recording', target)

  return `Recording flag ${target ? 'on' : 'off'}. Honest note: this is a flag kept by control-two (atom control-two.recording); other mods do not read it, so nothing starts or stops recording by itself.`
}

const doSave = async ($: Dollar, args: string): Promise<string> => {
  const word = args.trim().toLowerCase()
  const cur = await read($, persistA)

  if (word === '' || word === 'status') {
    return `This mod's own settings (recording flag, rules, pins) are ${cur === 'saved' ? 'saved for later sessions' : 'kept for this session only'}. /kxsave saved | session`
  }

  if (word !== 'saved' && word !== 'session') {
    return 'Usage: /kxsave saved | session'
  }
  const mode: SaveMode = word
  await update($, persistA, () => mode)
  await $.store.set('kx.persist', mode).catch(() => undefined)

  if (mode === 'session') {
    for (const key of STORE_OWN) {
      await $.store.delete(key).catch(() => undefined)
    }

    return 'Session only: the saved copies of the recording flag, rules and pins were removed; what is set now lasts until the session ends. Snapshots and notes are always kept.'
  }
  await $.store.set('kx.recording', await read($, recordingA)).catch(() => undefined)
  await $.store.set('kx.rules', await read($, rulesA)).catch(() => undefined)
  await $.store.set('kx.applied', await read($, appliedA)).catch(() => undefined)
  await $.store.set('kx.pins', await read($, pinsA)).catch(() => undefined)

  return 'Saved: the recording flag, rules and pins are kept for later sessions.'
}

// ------------------------------------------------------------------ rules (176)

const applyRules = async ($: Dollar): Promise<string> => {
  const rules = await read($, rulesA)
  const applied = await read($, appliedA)

  if (rules.length === 0 && Object.keys(applied).length === 0) {
    return 'No rules.'
  }
  const usage = await $.session.usage().catch(() => undefined)
  const overrides = cleanOverrides(await read($, featuresA))
  const plan = planRules(rules, applied, overrides, metricsFromUsage(usage))

  if (plan.calls.length === 0) {
    await update($, appliedA, () => plan.applied)
    await saveOwn($, 'kx.applied', plan.applied)

    return 'Rules checked: nothing to change.'
  }
  const result = await runSeq(
    $,
    'rules',
    plan.calls.map(c => ({ command: 'cfg', args: featureArgs(c.id, c.on ? 'on' : 'off') })),
  )
  const final: Applied = { ...plan.applied }

  for (const c of plan.calls.slice(result.done)) {
    const before = applied[c.id]

    if (before === undefined) {
      delete final[c.id]
    } else {
      final[c.id] = before
    }
  }
  await update($, appliedA, () => final)
  await saveOwn($, 'kx.applied', final)

  return result.text
}

const cmdRules = async ($: Dollar, args: string): Promise<string> => {
  const [sub = 'list', ...rest] = args.trim().split(/\s+/).filter(w => w !== '')
  const word = sub.toLowerCase()
  const rules = await read($, rulesA)
  const on = await flag($, 'rules', false)
  const status = `Rules are evaluated after each turn only while the rules switch is on (now ${on ? 'on' : 'off'}): /cfg feature control-two.rules ${on ? 'off' : 'on'}`

  if (word === 'add') {
    if (rules.length >= MAX_RULES) {
      return `At most ${MAX_RULES} rules. Remove one first: /kxrules rm <n>`
    }
    const parsed = parseRule(rest.join(' '))

    if (!parsed.ok) {
      return parsed.message
    }
    const next = [...rules, parsed.rule]
    await update($, rulesA, () => next)
    await saveOwn($, 'kx.rules', next)

    return `Rule ${next.length} added: ${ruleText(parsed.rule)}.\n${status}`
  }

  if (word === 'rm' || word === 'remove') {
    const n = Number(rest[0])

    if (!Number.isInteger(n) || n < 1 || n > rules.length) {
      return `Say which rule: /kxrules rm <1-${Math.max(1, rules.length)}>`
    }
    const next = rules.filter((_, i) => i !== n - 1)
    await update($, rulesA, () => next)
    await saveOwn($, 'kx.rules', next)

    return `Rule ${n} removed. A switch it had moved is put back on the next evaluation or /kxrules restore.`
  }

  if (word === 'run') {
    defer($, () => applyRules($))

    return 'Evaluating the rules now (the /cfg calls run just after this command).'
  }

  if (word === 'restore' || word === 'clear') {
    const applied = await read($, appliedA)
    const calls = restoreCalls(applied, cleanOverrides(await read($, featuresA)))
    await update($, appliedA, () => ({}))
    await saveOwn($, 'kx.applied', {})

    if (word === 'clear') {
      await update($, rulesA, () => [])
      await saveOwn($, 'kx.rules', [])
    }

    if (calls.length > 0) {
      defer($, () =>
        runSeq(
          $,
          'rules restore',
          calls.map(c => ({ command: 'cfg', args: featureArgs(c.id, c.on ? 'on' : 'off') })),
        ),
      )
    }

    return `${word === 'clear' ? 'All rules removed. ' : ''}${calls.length === 0 ? 'No switch needed putting back.' : `Putting ${calls.length} switches back: ${calls.map(c => `${c.id} ${c.on ? 'on' : 'off'}`).join(', ')}.`}`
  }
  const applied = await read($, appliedA)

  return [
    rules.length === 0 ? 'No rules yet.' : `${rules.length} of ${MAX_RULES} rules:`,
    ...rules.map((r, i) => `  ${i + 1}. ${ruleText(r)}`),
    `Moved by rules now: ${Object.keys(applied).length === 0 ? 'nothing' : Object.keys(applied).join(', ')}`,
    status,
    'Add: /kxrules add <mod> <band|toasts|sounds|status> <hide|show> when <ctx|cost|limit> >= <n> · Remove: /kxrules rm <n> · Now: /kxrules run · Undo: /kxrules restore · Delete all: /kxrules clear',
  ].join('\n')
}

// ------------------------------------------------------------------ snapshots, restore, reset (183-185)

const ownSnapshot = async ($: Dollar): Promise<SnapOwn> => ({
  recording: await read($, recordingA),
  persist: (await read($, persistA)) === 'session' ? 'session' : 'saved',
  rules: await read($, rulesA),
  pins: await read($, pinsA),
})

const takeSnapshot = async ($: Dollar, label: string): Promise<Snap> => {
  const snap = makeSnap(await nowOf($), label, cleanOverrides(await read($, featuresA)), await ownSnapshot($))
  const next = pushSnap(await read($, snapsA), snap)
  await update($, snapsA, () => next)
  await $.store.set('kx.snaps', next).catch(() => undefined)

  return snap
}

const snapLine = (s: Snap, n: number): string =>
  `${n}) ${fmtClock(s.at)} ${s.label === '' ? 'snapshot' : s.label} · ${Object.keys(s.overrides).length} overrides · ${s.own.rules.length} rules · ${s.own.pins.length} pins`

const newestFirst = (snaps: readonly Snap[]): Snap[] => [...snaps].reverse()

const cmdBackup = async ($: Dollar, args: string): Promise<string> => {
  const word = args.trim().toLowerCase()
  const snaps = newestFirst(await read($, snapsA))

  if (word === 'list') {
    return snaps.length === 0 ? 'No snapshots yet: /kxbackup takes one.' : ['Snapshots, newest first (restore with /kxrestore <n>):', ...snaps.map((s, i) => `  ${snapLine(s, i + 1)}`)].join('\n')
  }

  if (word === 'clear') {
    await update($, snapsA, () => [])
    await $.store.delete('kx.snaps').catch(() => undefined)

    return 'All snapshots deleted.'
  }

  if (word !== '') {
    return 'Usage: /kxbackup | /kxbackup list | /kxbackup clear'
  }
  const snap = await takeSnapshot($, 'manual')

  return `Snapshot taken: ${Object.keys(snap.overrides).length} switch overrides and this mod's settings. The last 5 are kept; /kxbackup list shows them.`
}

const cmdRestore = async ($: Dollar, args: string, origin: unknown): Promise<string> => {
  const [first = '', second = ''] = args.trim().split(/\s+/).filter(w => w !== '')
  const snaps = newestFirst(await read($, snapsA))

  if (first === '') {
    return snaps.length === 0
      ? 'No snapshots yet: /kxbackup takes one.'
      : ['Snapshots, newest first:', ...snaps.map((s, i) => `  ${snapLine(s, i + 1)}`), 'Preview one: /kxrestore <n> (changes nothing). Then /kxrestore <n> confirm.'].join('\n')
  }
  const n = Number(first)
  const snap = Number.isInteger(n) ? snaps[n - 1] : undefined

  if (snap === undefined) {
    return `No snapshot ${clip(first, 12)}. /kxrestore lists them.`
  }
  const now = await nowOf($)
  const current = cleanOverrides(await read($, featuresA))
  const { changes, skipped } = diffOverrides(current, snap.overrides)

  if (second.toLowerCase() === 'confirm') {
    const pending = await read($, pendingA)

    if (!isPersonOrigin(origin)) {
      return 'A restore must be typed by you, not sent by another mod. Nothing was changed.'
    }

    if (pending === null || pending.kind !== 'restore' || pending.n !== n || pendingState(pending, now) !== 'valid') {
      return `Preview first: /kxrestore ${n} shows what would change, then /kxrestore ${n} confirm within 2 minutes.`
    }

    if (await flag($, 'autobackup', true)) {
      await takeSnapshot($, 'before restore')
    }
    await update($, pendingA, () => null)
    await update($, recordingA, () => snap.own.recording)
    await update($, persistA, () => snap.own.persist)
    await update($, rulesA, () => snap.own.rules)
    await update($, pinsA, () => snap.own.pins)
    await update($, appliedA, () => ({}))
    await $.store.set('kx.persist', snap.own.persist).catch(() => undefined)
    await saveOwn($, 'kx.recording', snap.own.recording)
    await saveOwn($, 'kx.rules', snap.own.rules)
    await saveOwn($, 'kx.pins', snap.own.pins)
    await saveOwn($, 'kx.applied', {})
    const calls = pending.steps.map(args2 => ({ command: 'cfg', args: args2 }))

    if (calls.length > 0) {
      defer($, () => runSeq($, `restore ${n}`, calls))
    }

    return `Restoring snapshot ${n}: this mod's settings are back now; ${calls.length} switch changes follow, one /cfg call at a time (progress in the Quick tab).`
  }
  const steps = changes.map(c => featureArgs(c.id, c.to))
  const kept = steps.slice(0, 60)
  await update($, pendingA, () => makePending('restore', now, n, kept))
  await openPane($, 'backups')

  return [
    `Preview of snapshot ${n} (${fmtClock(snap.at)}): nothing has been changed.`,
    changes.length === 0 ? 'No switch differs from now.' : `${changes.length} switch changes${changes.length > kept.length ? ` (the first ${kept.length} would be applied)` : ''}:`,
    ...changes.slice(0, 20).map(c => `  ${changeLine(c)}`),
    changes.length > 20 ? `  ... and ${changes.length - 20} more` : '',
    skipped > 0 ? `${skipped} ids were skipped (locked mods or unknown names).` : '',
    `This mod's own settings in it: recording ${snap.own.recording ? 'on' : 'off'}, ${snap.own.rules.length} rules, ${snap.own.pins.length} pins.`,
    `To apply, type: /kxrestore ${n} confirm (valid for 2 minutes).`,
  ]
    .filter(l => l !== '')
    .join('\n')
}

const resetOwn = async ($: Dollar) => {
  await update($, recordingA, () => false)
  await update($, persistA, () => 'saved')
  await update($, rulesA, () => [])
  await update($, appliedA, () => ({}))
  await update($, pinsA, () => [])
  await update($, notesA, () => [])
  await update($, pendingA, () => null)
  await update($, progressA, () => null)
  await update($, installedA, () => null)
  await update($, updatesAtA, () => 0)
  await update($, healthA, () => null)
  await update($, timingA, () => ({}))
  await update($, linksA, () => ({}))
  await update($, errorsA, () => [])
  await update($, orderA, () => null)
  await update($, refusalsA, () => [])
  await update($, storageA, () => [])
  await update($, noticeA, () => '')
  await update($, selectedA, () => '')

  for (const key of [...STORE_OWN, 'kx.persist', 'kx.notes']) {
    await $.store.delete(key).catch(() => undefined)
  }
}

const cmdReset = async ($: Dollar, args: string, origin: unknown): Promise<string> => {
  const word = args.trim().toLowerCase()
  const now = await nowOf($)

  if (word === 'list') {
    return fillPrompt($, resetListText(), 'List of reset commands (one per line; each is another mod\'s own command: send them one at a time, or delete the lines you do not want)')
  }

  if (word === 'cancel') {
    await update($, pendingA, () => null)

    return 'Reset cancelled.'
  }

  if (word === 'confirm') {
    const pending = await read($, pendingA)

    if (!isPersonOrigin(origin)) {
      return 'A reset must be typed by you, not sent by another mod. Nothing was changed.'
    }

    if (pending === null || pending.kind !== 'reset') {
      return 'Nothing is waiting. Type /kxreset first, then /kxreset confirm within 2 minutes.'
    }

    if (pendingState(pending, now) !== 'valid') {
      await update($, pendingA, () => null)

      return 'That reset expired. Type /kxreset again.'
    }
    const backed = await flag($, 'autobackup', true)

    if (backed) {
      await takeSnapshot($, 'before reset')
    }
    await resetOwn($)
    defer($, async () => {
      const r = await runCommand($, 'cfg', 'feature reset')
      await setNotice($, r.ok ? `Switches reset: ${clip(r.text, 160)}` : r.text)
    })

    return [
      'Reset done for this mod: recording flag, rules, pins, notes, recorders and the update check were cleared.',
      backed ? 'A snapshot was taken first: /kxbackup list, /kxrestore <n>.' : 'No snapshot was taken (the autobackup switch is off).',
      'Now asking the settings mod to reset every feature switch to its default: /cfg feature reset. Older snapshots were kept.',
    ].join('\n')
  }

  if (word !== '') {
    return 'Usage: /kxreset | /kxreset confirm | /kxreset cancel | /kxreset list'
  }
  await update($, pendingA, () => makePending('reset', now, 0, []))
  const filled = await $.prompt.fill({ text: resetListText(), mode: 'replace' }).catch(() => undefined)
  await openPane($, 'backups')

  return [
    'Reset everything: nothing has been changed yet.',
    'Step 2, within 2 minutes: type /kxreset confirm. It will (1) take a snapshot of your switches and this mod\'s settings, (2) clear everything this mod recorded, (3) run /cfg feature reset.',
    'It never runs another mod\'s own reset.',
    filled?.isFilled === true
      ? `The prompt box now holds the ${resetCommands().length} reset commands of the other mods, one per line. They are NOT sent: delete the box, or copy single lines and send them one at a time yourself. /kxreset cancel drops this.`
      : 'The prompt box could not be filled: /kxreset list tries again.',
    `No reset command found for: ${noResetMods().join(', ')}.`,
  ].join('\n')
}

const cmdResetMod = async ($: Dollar, args: string): Promise<string> => {
  const name = args.trim()

  if (name === '') {
    return [
      'Reset commands of the mods in the table (nothing is run; /kxresetmod <mod> puts one in the prompt box):',
      ...resetCommands().map(r => `  ${pad(r.mod, 16)} /${r.command}`),
      `No reset command: ${noResetMods().join(', ')}`,
    ].join('\n')
  }
  const mod = findMod(name)

  if (mod === undefined) {
    return `"${clip(name, 40)}" is not a mod this table knows. /kxresetmod lists them.`
  }

  if (mod.reset === null || mod.name === SELF) {
    return mod.name === SELF ? 'For this mod use /kxreset (two steps).' : `${mod.name} has no reset command in the table. Its data (if any) can be cleared from its own pane.`
  }

  return `${mod.name}: ${await fillPrompt($, `/${mod.reset}`, `Reset line /${mod.reset}`)} Press Enter yourself to run it; this mod never runs another mod's reset.`
}

// ------------------------------------------------------------------ the CLI and the update check (186, 198)

const probe = async ($: Dollar, argv: string[]): Promise<boolean> => {
  const r = await $.process.run([...argv, '--version'], { timeoutMs: 15_000 }).catch(() => undefined)

  return r !== undefined && r.exitCode === 0 && looksLikeVersionOutput(r.stdout)
}

/** `claude` on PATH first, then the desktop app's bundled binary. Cached for the session once it works. */
const findCli = async ($: Dollar): Promise<{ argv: string[]; via: 'path' | 'bundled' } | undefined> => {
  if (cliCache !== undefined) {
    return cliCache
  }
  const now = await nowOf($)

  if (await probe($, ['claude'])) {
    cliCache = { argv: ['claude'], via: 'path' }
  } else {
    const found = await discoverBundled(await homeOf($), path => $.fs.list(path))

    for (const candidate of found) {
      if (await probe($, [candidate])) {
        cliCache = { argv: [candidate], via: 'bundled' }
        break
      }
    }
  }
  const state: CliState = { status: cliCache?.via ?? 'none', at: now }
  await update($, cliA, () => state)

  return cliCache
}

/** Read-only: `plugin list` (never an install, update, enable or disable). */
const refreshInstalled = async ($: Dollar): Promise<InstalledState> => {
  const now = await nowOf($)
  const cli = await findCli($)
  let state: InstalledState

  if (cli === undefined) {
    state = { loadedAt: now, list: [], error: 'Claude CLI not reachable' }
  } else {
    let r = await $.process.run([...cli.argv, 'plugin', 'list', '--json'], { timeoutMs: RUN_TIMEOUT_MS }).catch(() => undefined)

    if (r !== undefined && r.exitCode !== 0 && /unknown option|--json/i.test(r.stderr)) {
      r = await $.process.run([...cli.argv, 'plugin', 'list'], { timeoutMs: RUN_TIMEOUT_MS }).catch(() => undefined)
    }

    if (r === undefined) {
      state = { loadedAt: now, list: [], error: 'plugin list could not be started or timed out' }
    } else if (r.exitCode !== 0) {
      state = { loadedAt: now, list: [], error: clip(sanitize(r.stderr || r.stdout, await homeOf($)), 160) || `plugin list exited ${r.exitCode}` }
    } else {
      const parsed = parsePluginList(r.stdout)
      state = parsed.ok ? { loadedAt: now, list: parsed.list, error: '' } : { loadedAt: now, list: [], error: parsed.error }
    }
  }
  await update($, installedA, () => state)
  await update($, updatesAtA, () => now)

  return state
}

const updateRowsOf = (state: InstalledState | null, pins: readonly Pin[]): UpdateRow[] | null =>
  state === null || state.error !== '' ? null : compareUpdates(state.list, pins)

const cmdUpdates = async ($: Dollar): Promise<string> => {
  const state = await refreshInstalled($)
  await openPane($, 'updates')

  if (state.error !== '') {
    return [
      `Could not read the installed plugins: ${state.error}.`,
      'Nothing was run except a read-only version check and `plugin list`. Run `claude plugin list` yourself to see versions.',
    ].join('\n')
  }
  const rows = compareUpdates(state.list, await read($, pinsA))
  const newer = updateCount(rows)
  const interesting = rows.filter(r => r.state !== 'same')

  return [
    `Installed versions read (read-only) against the versions this mod was built with: ${newer} newer in the table, ${rows.filter(r => r.state === 'same').length} the same, ${rows.filter(r => r.state === 'not-installed').length} not installed.`,
    ...interesting.slice(0, 40).map(r => `  ${clip(updateLine(r), 150)}`),
    interesting.length > 40 ? `  ... and ${interesting.length - 40} more (Updates tab)` : '',
    'The table is a snapshot of the mod folders at build time: a mod changed later is not seen. Nothing was installed, updated or changed.',
  ]
    .filter(l => l !== '')
    .join('\n')
}

// ------------------------------------------------------------------ health, conflicts, self-tests (189, 191, 196)

const refreshHealth = async ($: Dollar): Promise<HealthState> => {
  const live = normalizeLive(await $.command.list().catch(() => []))
  const errs = errorCounts(await read($, errorsA))
  const rows: HealthRow[] = allMods().map(m => healthFor(m, live, errs[m.name] ?? 0))
  const state: HealthState = { at: await nowOf($), rows, conflicts: liveConflicts(live) }
  await update($, healthA, () => state)

  return state
}

const lightCounts = (rows: readonly HealthRow[]) => ({
  green: rows.filter(r => r.light === 'green').length,
  amber: rows.filter(r => r.light === 'amber').length,
  red: rows.filter(r => r.light === 'red').length,
  grey: rows.filter(r => r.light === 'grey').length,
})

const cmdHealth = async ($: Dollar, args: string): Promise<string> => {
  const state = await refreshHealth($)
  await openPane($, 'health')
  const name = args.trim()

  if (name !== '') {
    const row = state.rows.find(r => r.mod === bareName(name))

    return row === undefined ? `"${clip(name, 40)}" is not a mod this table knows.` : `${row.mod}: ${row.light} · ${row.note}`
  }
  const c = lightCounts(state.rows)

  return [
    `Health from what this session can see (${state.rows.length} mods): ${c.green} good · ${c.amber} partly · ${c.red} missing · ${c.grey} no commands to check.`,
    ...state.rows.filter(r => r.light === 'amber' || r.light === 'red').slice(0, 30).map(r => `  ${pad(r.light, 5)} ${pad(r.mod, 16)} ${r.note}`),
    'A good light means its commands are registered now; it cannot prove a hook or pane works. Details: Health tab.',
  ].join('\n')
}

const cmdConflicts = async ($: Dollar): Promise<string> => {
  const state = await refreshHealth($)
  const refusals = await read($, refusalsA)
  const on = await flag($, 'refusals', false)
  await openPane($, 'health')

  return [
    duplicateText(),
    state.conflicts.length === 0 ? 'Live check: every command name has one owner and the table\'s owners match.' : `Live check, ${state.conflicts.length} findings:`,
    ...state.conflicts.slice(0, 20).map(l => `  ${l}`),
    refusals.length === 0
      ? `Refused registrations seen: none${on ? '' : ' (the refusals switch is off, so none are recorded: /cfg feature control-two.refusals on, then /reload or restart so registrations pass through it)'}.`
      : `Refused registrations seen (${refusals.length}):`,
    ...refusals.slice(-10).map(r => `  ${fmtClock(r.at)} ${r.plugin} /${r.name}: ${r.reason}`),
  ].join('\n')
}

const cmdSelftest = async ($: Dollar, args: string): Promise<string> => {
  const tests = selfTests()
  const name = bareName(args)

  if (name === '') {
    return [
      'Documented self-test commands (from the table; this mod knows of no others):',
      ...tests.map(t => `  ${pad(t.mod, 12)} ${t.line}`),
      'Put one in the prompt box with /kxselftest <mod>. It is never run for you.',
    ].join('\n')
  }
  const hit = tests.find(t => t.mod === name)

  return hit === undefined ? `${name} has no documented self-test command in the table.` : `${hit.mod}: ${await fillPrompt($, hit.line, `Self-test ${hit.line}`)}`
}

// ------------------------------------------------------------------ errors, timing, hook order, storage (190, 193, 194, 195)

const cmdErrors = async ($: Dollar, args: string): Promise<string> => {
  const word = args.trim().toLowerCase()
  const on = await flag($, 'errors', false)

  if (word === 'clear') {
    await update($, errorsA, () => [])

    return 'Error log cleared.'
  }
  const all = await read($, errorsA)
  const list = word === '' ? all : all.filter(e => bareName(e.plugin) === word)
  await openPane($, 'hooks')

  return [
    on ? 'Error log: log lines that look like errors, and hook failures seen beneath this mod\'s hooks (this session only).' : 'The errors switch is off, so nothing new is recorded: /cfg feature control-two.errors on',
    list.length === 0 ? 'Nothing recorded.' : `${list.length} lines (newest last):`,
    ...list.slice(-15).map(e => `  ${fmtClock(e.at)} ${pad(e.plugin, 14)} ${e.text}`),
    'It sees only what is passed through this mod\'s hooks: a mod that fails in a hook none of this mod\'s chain touches is not seen.',
  ].join('\n')
}

const statLines = (table: Readonly<Record<string, Stat>>, count: number): string[] =>
  topStats(table, count).map(s => `  ${pad(s.key, 18)} ${String(s.stat.n).padStart(5)} calls  avg ${fmtMs(s.avg).padStart(9)}  max ${fmtMs(s.stat.max)}`)

const cmdTiming = async ($: Dollar, args: string): Promise<string> => {
  const on = await flag($, 'timing', false)

  if (args.trim().toLowerCase() === 'clear') {
    await update($, timingA, () => ({}))
    await update($, linksA, () => ({}))

    return 'Timing cleared.'
  }
  const timing = await read($, timingA)
  const links = await read($, linksA)
  await openPane($, 'hooks')

  return [
    on ? 'Timing is on.' : 'The timing switch is off, so nothing new is recorded: /cfg feature control-two.timing on',
    'Per mod that raised pop-ups or status writes: calls and the average time from this mod\'s hook entry to its return (everything beneath it included):',
    ...(Object.keys(timing).length === 0 ? ['  nothing yet'] : statLines(timing, 12)),
    'Per hook beneath this mod (its own time, from the engine\'s trace):',
    ...(Object.keys(links).length === 0 ? ['  nothing yet'] : statLines(links, 12)),
    'It measures only ui.toast and ui.status events, and only the hooks beneath this mod\'s own: not whole turns, not tools, not other events. Times are coarse (milliseconds, the engine clock).',
  ].join('\n')
}

const measureStorage = async ($: Dollar): Promise<StorageRow[]> => {
  const keys = await $.store.keys().catch(() => [] as string[])
  const rows: StorageRow[] = []

  for (const key of keys.slice(0, 40)) {
    rows.push({ key: clip(key, 40), bytes: sizeOf(await $.store.get(key).catch(() => undefined)) })
  }
  rows.sort((a, b) => b.bytes - a.bytes)
  await update($, storageA, () => rows)

  return rows
}

const cmdStorage = async ($: Dollar): Promise<string> => {
  const rows = await measureStorage($)
  await openPane($, 'hooks')
  const total = rows.reduce((n, r) => n + r.bytes, 0)

  return [
    `This mod's own store: ${rows.length} keys, ${fmtBytes(total)} of JSON text (the limit is 4 MiB per plugin).`,
    ...rows.map(r => `  ${pad(r.key, 16)} ${fmtBytes(r.bytes)}`),
    'It cannot see the stores of other mods: each plugin can read only its own.',
  ].join('\n')
}

const cmdHooks = async ($: Dollar): Promise<string> => {
  const order = await read($, orderA)
  const on = await flag($, 'hookorder', false)
  await openPane($, 'hooks')

  return [
    on ? 'Hook order is on.' : 'The hookorder switch is off, so nothing new is recorded: /cfg feature control-two.hookorder on',
    order === null
      ? 'Nothing seen yet: it fills in when a pop-up or status line goes through this mod\'s hooks.'
      : `Hooks beneath this mod for ${order.event} at ${fmtClock(order.at)}, outermost first:`,
    ...(order?.rows ?? []).slice(0, 30).map(r => `  ${String(r.index).padStart(2)} ${pad(r.plugin, 18)} ${pad(r.tier, 8)} ${pad(r.outcome, 9)} ${fmtMs(r.ms)}`),
    'This is the order of the links beneath this mod\'s own hook only: the engine does not list the whole chain, so links above it are not shown.',
  ].join('\n')
}

// ------------------------------------------------------------------ diagnostics, graph, changes, notes, pins (192, 197, 199, 200, 188, 187)

const diagText = async ($: Dollar): Promise<string> => {
  const health = await read($, healthA)
  const c = health === null ? null : lightCounts(health.rows)

  return buildDiag(
    {
      now: await nowOf($),
      installed: await read($, installedA),
      overrides: cleanOverrides(await read($, featuresA)),
      motionOn: await read($, motionIsOn),
      calmOn: await read($, calmA),
      preset: String(await read($, presetA)),
      own: {
        rules: (await read($, rulesA)).length,
        pins: (await read($, pinsA)).length,
        notes: (await read($, notesA)).length,
        snaps: (await read($, snapsA)).length,
        recording: await read($, recordingA),
        persist: (await read($, persistA)) === 'session' ? 'session' : 'saved',
      },
      recorders: {
        timing: Object.keys(await read($, timingA)).length,
        errors: (await read($, errorsA)).length,
        order: (await read($, orderA))?.rows.length ?? 0,
        refusals: (await read($, refusalsA)).length,
      },
      health: health === null || c === null ? null : { at: health.at, ...c },
    },
    await homeOf($),
  )
}

const changeLines = (mod: string): string[] =>
  changelogRows().filter(c => mod === '' || c.mod === mod).map(c => `${pad(c.mod, 15)} ${c.version}  ${c.text}`)

const cmdChanges = async ($: Dollar, args: string): Promise<string> => {
  const name = bareName(args)

  if (name !== '' && findMod(name) === undefined) {
    return `"${clip(name, 40)}" is not a mod this table knows.`
  }
  await update($, selectedA, () => name)
  await openPane($, 'changes')
  const lines = changeLines(name)

  return [`Changelog (${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}; every mod is still at its first version):`, ...lines.slice(0, 40).map(l => `  ${clip(l, 170)}`), lines.length > 40 ? `  ... and ${lines.length - 40} more (Changes tab)` : ''].filter(l => l !== '').join('\n')
}

const cmdPin = async ($: Dollar, args: string): Promise<string> => {
  const cmd = parsePin(args)
  const pins = await read($, pinsA)

  if (cmd.kind === 'error') {
    return cmd.message
  }

  if (cmd.kind === 'rm') {
    const next = pins.filter(p => p.mod !== cmd.mod)
    await update($, pinsA, () => next)
    await saveOwn($, 'kx.pins', next)

    return pins.length === next.length ? `${cmd.mod} had no pin.` : `Pin on ${cmd.mod} removed.`
  }

  if (cmd.kind === 'add') {
    if (pins.length >= MAX_PINS && !pins.some(p => p.mod === cmd.pin.mod)) {
      return `At most ${MAX_PINS} pins. Remove one: /kxpin rm <mod>`
    }
    const next = withPin(pins, cmd.pin)
    await update($, pinsA, () => next)
    await saveOwn($, 'kx.pins', next)

    return `Noted: ${cmd.pin.mod} should stay on ${cmd.pin.version}. Honest: this is only a note. Nothing stops an update; /kxupdates shows when the installed version differs.`
  }

  return pins.length === 0
    ? 'No pins. /kxpin <mod> <version> [note] keeps a note of a version you want to stay on (nothing enforces it).'
    : ['Pins (notes only, nothing enforces them):', ...pins.map(p => `  ${pad(p.mod, 15)} ${p.version}${p.note === '' ? '' : `  ${p.note}`}`)].join('\n')
}

const cmdFeedback = async ($: Dollar, args: string): Promise<string> => {
  const cmd = parseNote(args)
  const notes = await read($, notesA)

  if (cmd.kind === 'error') {
    return cmd.message
  }
  const persist = async (next: Note[]) => {
    await update($, notesA, () => next)
    await $.store.set('kx.notes', next).catch(() => undefined)
  }

  if (cmd.kind === 'clear') {
    const next = cmd.mod === 'all' ? [] : notes.filter(n => n.mod !== cmd.mod)
    await persist(next)

    return `Cleared ${notes.length - next.length} notes.`
  }

  if (cmd.kind === 'add') {
    await persist(withNote(notes, { at: await nowOf($), mod: cmd.mod, text: cmd.text }))

    return `Note kept for ${cmd.mod} (the last ${MAX_NOTES} are kept; they stay on this machine and are not sent anywhere).`
  }
  const list = notes.filter(n => cmd.mod === '' || n.mod === cmd.mod)

  return list.length === 0 ? 'No notes yet. /kxfeedback <mod> <text> keeps one.' : [`${list.length} notes (newest last):`, ...list.slice(-20).map(n => `  ${pad(n.mod, 15)} ${n.text}`)].join('\n')
}

const cmdDeps = async ($: Dollar): Promise<string> => {
  await openPane($, 'graph')

  return ['Which mod needs which (from each plugin.json at build time):', ...depLines().map(l => `  ${l}`), 'The Graph tab draws it on the desktop app.'].join('\n')
}

// ------------------------------------------------------------------ commands

const runCommandNamed = async ($: Dollar, name: string, args: string, origin: unknown): Promise<string> => {
  const onoff = parseOnOff(args)

  switch (name) {
    case 'kx':
      await openPane($)

      return helpText()
    case 'kxquick': {
      const tab = args.trim().toLowerCase()

      if (tab !== '' && !isTab(tab)) {
        return `Tabs: ${TABS.map(t => t[0]).join(', ')}`
      }
      await openPane($, tab === '' ? 'quick' : tab)

      return 'Control two opened. Quick toggles: /kxmotion /kxcalm /kxsounds /kxrecording. All commands: /kx'
    }
    case 'kxmotion':
      return onoff.ok ? doMotion($, onoff.value, true) : onoff.message
    case 'kxcalm':
      return onoff.ok ? doCalm($, onoff.value, true) : onoff.message
    case 'kxsounds':
      return onoff.ok ? doSounds($, onoff.value, true) : onoff.message
    case 'kxrecording':
      return onoff.ok ? doRecording($, onoff.value) : onoff.message
    case 'kxsave':
      return doSave($, args)
    case 'kxrules':
      await openPane($, 'rules')

      return cmdRules($, args)
    case 'kxreset':
      return cmdReset($, args, origin)
    case 'kxresetmod':
      return cmdResetMod($, args)
    case 'kxbackup':
      return cmdBackup($, args)
    case 'kxrestore':
      return cmdRestore($, args, origin)
    case 'kxupdates':
      return cmdUpdates($)
    case 'kxrollback':
      return rollbackText(args.trim())
    case 'kxpin':
      return cmdPin($, args)
    case 'kxhealth':
      return cmdHealth($, args)
    case 'kxerrors':
      return cmdErrors($, args)
    case 'kxselftest':
      return cmdSelftest($, args)
    case 'kxdiag': {
      await openPane($, 'diag')

      return diagText($)
    }
    case 'kxtiming':
      return cmdTiming($, args)
    case 'kxstorage':
      return cmdStorage($)
    case 'kxhooks':
      return cmdHooks($)
    case 'kxconflicts':
      return cmdConflicts($)
    case 'kxdeps':
      return cmdDeps($)
    case 'kxchanges':
      return cmdChanges($, args)
    case 'kxfeedback':
      return cmdFeedback($, args)
    default:
      return helpText()
  }
}

// ------------------------------------------------------------------ loading

const load = async ($: Dollar) => {
  const keys = ['kx.persist', 'kx.recording', 'kx.rules', 'kx.applied', 'kx.pins', 'kx.notes', 'kx.snaps']
  const [persist, recording, rules, applied, pins, notes, snaps] = await Promise.all(keys.map(k => $.store.get(k).catch(() => undefined)))
  await update($, persistA, () => (persist === 'session' ? 'session' : 'saved'))
  await update($, recordingA, () => recording === true)
  await update($, rulesA, () => normalizeRules(rules))
  await update($, appliedA, () => normalizeApplied(applied))
  await update($, pinsA, () => normalizePins(pins))
  await update($, notesA, () => normalizeNotes(notes))
  await update($, snapsA, () => normalizeSnaps(snaps))
}

// ------------------------------------------------------------------ recorders (190, 193, 195, 196)

type NextLike = { readonly origin: { readonly plugin: string }; readonly trace: readonly TraceLike[] }
type Watch = { timing: boolean; errors: boolean; order: boolean; t0: number }

/** Reads the three recorder switches; null when all are off, so an idle recorder costs one read. */
const startWatch = async ($: Dollar): Promise<Watch | null> => {
  const o = await read($, featuresA)
  const timing = o[`${SELF}.timing`] === true
  const errors = o[`${SELF}.errors`] === true
  const order = o[`${SELF}.hookorder`] === true

  if (!timing && !errors && !order) {
    return null
  }

  return { timing, errors, order, t0: timing ? await nowOf($) : 0 }
}

/** Never throws: a recorder must not be able to break the call it watches. */
const finishWatch = async ($: Dollar, w: Watch, next: NextLike, event: string): Promise<void> => {
  try {
    const plugin = next.origin.plugin
    const trace = Array.isArray(next.trace) ? next.trace : []

    if (w.timing) {
      const ms = (await nowOf($)) - w.t0
      await update($, timingA, t => addStat(t, plugin, ms))
      await update($, linksA, t => trace.reduce((acc, link) => addStat(acc, link.plugin, link.ms), t))
    }

    if (w.errors) {
      const now = await nowOf($)

      for (const f of traceFailures(trace)) {
        await update($, errorsA, list => pushError(list, { at: now, plugin: f.plugin, text: `hook failed (${f.outcome}) at ${event}` }))
      }
    }

    if (w.order) {
      await update($, orderA, () => ({ event, at: 0, rows: orderRows(trace) }))
    }
  } catch {
    // fail open
  }
}

// ------------------------------------------------------------------ the module

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await load($).catch(() => undefined)

    for (const [name, description, usage] of COMMANDS) {
      await $.command.register(usage === '' ? { name, description } : { name, description, argumentHint: usage }).catch(() => undefined)
    }

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({
      text: await runCommandNamed($, name, e.args, e.origin).catch(() => `/${name} hit an unexpected error. Nothing was changed.`),
    }))
  }

  // 176: rules, after a turn. Switch control-two.rules, default off. The /cfg calls run just after the hook has returned.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined && (await flag($, 'rules', false)) && (await read($, rulesA)).length + Object.keys(await read($, appliedA)).length > 0) {
      defer($, () => applyRules($))
    }

    return result
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // 193, 195, 190: three recorders on the pop-up and status events, each behind its own switch (all off by default).
  on('ui.toast', async ($, e, next) => {
    const w = await startWatch($)
    const result = await next(e)

    if (w !== null) {
      await finishWatch($, w, next, 'ui.toast')
    }

    return result
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('ui.status', async ($, e, next) => {
    const w = await startWatch($)
    const result = await next(e)

    if (w !== null) {
      await finishWatch($, w, next, 'ui.status')
    }

    return result
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // 190: log lines that look like errors, by the mod that wrote them. Switch control-two.errors.
  on('ui.log', async ($, e, next) => {
    try {
      if (isErrorLine(e.text) && (await read($, featuresA))[`${SELF}.errors`] === true) {
        const now = await nowOf($)
        await update($, errorsA, list => pushError(list, { at: now, plugin: next.origin.plugin, text: e.text }))
      }
    } catch {
      // fail open
    }

    return next(e)
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // 196: a refused command registration, seen as it passes through (a thrown refusal, or a result that carries `deny`).
  // Switch control-two.refusals. The refusal still reaches the mod: it is passed on untouched.
  on('command.register', async ($, e, next) => {
    let isOnNow = false

    try {
      isOnNow = (await read($, featuresA))[`${SELF}.refusals`] === true
    } catch {
      isOnNow = false
    }

    if (!isOnNow) {
      return next(e)
    }
    const keep = async (reason: string) => {
      try {
        const now = await nowOf($)
        await update($, refusalsA, list => pushRefusal(list, { at: now, plugin: next.origin.plugin, name: String(e.name ?? ''), reason }))
      } catch {
        // fail open
      }
    }
    let result: Awaited<ReturnType<typeof next>>

    try {
      result = await next(e)
    } catch (error) {
      await keep(error instanceof Error ? error.message : String(error))
      throw error
    }
    const denied = (result as unknown as { deny?: unknown } | null)?.deny

    if (typeof denied === 'string') {
      await keep(denied)
    }

    return result
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // 177: the quick-toggle bar, one row above the prompt. Switch control-two.bar, default off. Calm shows only the calm button.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)

    if (e.props.hasSurvey || !(await flag($, 'bar', false))) {
      return inner
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const calm = await read($, calmA)
    const motion = await read($, motionIsOn)
    const sounds = soundsState(cleanOverrides(await read($, featuresA)))
    const recording = await read($, recordingA)
    const accent = await read($, accentA)

    return (
      <Box flexDirection="column">
        {inner}
        <Box gap="sm">
          <Text color={accent} size="caption">
            Quick
          </Text>
          {!calm && <Button key="bar-motion" label={`Motion ${motion ? 'On' : 'Off'}`} onPress={() => doMotion($, 'toggle', false)} />}
          <Button key="bar-calm" label={`Calm ${calm ? 'On' : 'Off'}`} onPress={() => doCalm($, 'toggle', false)} />
          {!calm && <Button key="bar-sounds" label={`Sounds ${soundsWord(sounds)}`} onPress={() => doSounds($, 'toggle', false)} />}
          {!calm && <Button key="bar-recording" label={`Recording ${recording ? 'On' : 'Off'}`} onPress={() => doRecording($, 'toggle')} />}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // ------------------------------------------------------------ the pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = e.surface === 'desktop' ? (ui as ElementTable<'desktop'>).Svg : undefined
    const tab = await read($, tabA)
    const accent = await read($, accentA)
    const density = await read($, densityA)
    const icons = await read($, iconsA)
    const gap = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
    const rows = e.viewport?.rows ?? 24
    const room = Math.max(4, rows - 14)
    const cols = e.props.bodyColumns
    const notice = await read($, noticeA)
    const page = await read($, pageA)
    const selected = await read($, selectedA)
    const overrides = cleanOverrides(await read($, featuresA))
    const now = await nowOf($)

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
    const lightColor = (l: Light) => (l === 'green' ? 'success' : l === 'amber' ? 'warning' : l === 'red' ? 'error' : 'subtle')
    const lightGlyph = (l: Light) => (icons === 'letters' ? { green: 'G', amber: 'A', red: 'R', grey: '-' }[l] : icons === 'minimal' ? '*' : '●')
    const SwitchRow = (id: string, label: string, what: string) => {
      const full = `${SELF}.${id}`
      const isNow = isOn(overrides, full, id === 'autobackup' || id === 'badge')

      return (
        <Box gap="sm" flexWrap="wrap">
          <Button key={`sw-${id}`} label={`${label} ${isNow ? 'On' : 'Off'}`} onPress={async () => setNotice($, (await runCommand($, 'cfg', featureArgs(full, isNow ? 'off' : 'on'))).text)} />
          <Text dimColor>{clip(what, Math.max(12, cols - label.length - 14))}</Text>
        </Box>
      )
    }

    let body: JSX.Element | null = null

    if (tab === 'quick') {
      const motion = await read($, motionIsOn)
      const calm = await read($, calmA)
      const recording = await read($, recordingA)
      const persist = await read($, persistA)
      const sounds = soundsState(overrides)
      const progress = await read($, progressA)
      const rules = await read($, rulesA)
      body = (
        <Box flexDirection="column" gap="xs">
          {Section('Quick toggles')}
          <Box gap="xs" flexWrap="wrap">
            <Button key="q-motion" label={`Motion ${motion ? 'On' : 'Off'}`} onPress={async () => setNotice($, await doMotion($, 'toggle', false))} />
            <Button key="q-calm" label={`Calm ${calm ? 'On' : 'Off'}`} onPress={async () => setNotice($, await doCalm($, 'toggle', false))} />
            <Button key="q-sounds" label={`Sounds ${soundsWord(sounds)}`} onPress={async () => setNotice($, await doSounds($, 'toggle', false))} />
            <Button key="q-recording" label={`Recording ${recording ? 'On' : 'Off'}`} onPress={async () => setNotice($, await doRecording($, 'toggle'))} />
          </Box>
          <Text dimColor>Motion runs /motion; Calm runs /cfg calm; Sounds flips the sounds switch of each mod, one /cfg call each; Recording is a flag only this mod keeps.</Text>
          {progress !== null && (
            <Text color={progress.failed !== '' ? 'warning' : accent}>
              {progress.isRunning
                ? `${progress.label}: ${progress.done} of ${progress.total} ...`
                : `${progress.label}: ${progress.done} of ${progress.total} done${progress.failed !== '' ? ` · ${clip(progress.failed, Math.max(20, cols - 40))}` : ''}`}
            </Text>
          )}
          {Section('Own settings')}
          <Box gap="sm" flexWrap="wrap">
            <Button key="q-save" label={persist === 'saved' ? 'Saved for later' : 'This session only'} onPress={async () => setNotice($, await doSave($, persist === 'saved' ? 'session' : 'saved'))} />
            <Text dimColor>{`recording flag, ${rules.length} rules, pins: ${persist === 'saved' ? 'kept in later sessions' : 'gone when the session ends'}`}</Text>
          </Box>
          {Section('Switches of this mod')}
          {SwitchRow('bar', 'Quick bar', 'One row above the prompt with these four toggles')}
          {SwitchRow('rules', 'Row rules', 'Evaluate the Rules tab after each turn')}
          {SwitchRow('autobackup', 'Auto backup', 'Snapshot before /kxreset confirm and /kxrestore confirm')}
          {SwitchRow('badge', 'Update badge', 'Show the number of newer mods on the Updates tab')}
          <Text dimColor>Recorders (timing, errors, hook order, refusals) are on the Hooks tab.</Text>
        </Box>
      )
    } else if (tab === 'rules') {
      const rules = await read($, rulesA)
      const applied = await read($, appliedA)
      body = (
        <Box flexDirection="column" gap="xs">
          {SwitchRow('rules', 'Row rules', 'Off by default: rules run after each turn only while this is On')}
          {rules.length === 0 && <Text dimColor>No rules yet. Add one with a command or fill a template below.</Text>}
          {rules.map((r: Rule, i: number) => (
            <Box gap="sm">
              <Button key={`rule-rm-${i}`} label="remove" onPress={async () => setNotice($, await cmdRules($, `rm ${i + 1}`))} />
              <Text>{`${i + 1}. ${ruleText(r)}`}</Text>
              <Text dimColor>{metricText(r.metric)}</Text>
            </Box>
          ))}
          <Box gap="xs" flexWrap="wrap">
            <Button key="rule-run" label="Evaluate now" onPress={async () => setNotice($, await cmdRules($, 'run'))} />
            <Button key="rule-restore" label="Put switches back" onPress={async () => setNotice($, await cmdRules($, 'restore'))} />
          </Box>
          <Text dimColor>{`Moved by rules now: ${Object.keys(applied).length === 0 ? 'nothing' : Object.keys(applied).join(', ')}`}</Text>
          {Section('Templates (they only fill the prompt box)')}
          <Box gap="xs" flexWrap="wrap">
            <Button key="rt-ctx" label="hide a row at 70% context" onPress={() => fillPrompt($, '/kxrules add cockpit band hide when ctx >= 70', 'Rule template')} />
            <Button key="rt-cost" label="mute sounds at $5" onPress={() => fillPrompt($, '/kxrules add sound-pack sounds hide when cost >= 5', 'Rule template')} />
            <Button key="rt-limit" label="quiet toasts at 80% limit" onPress={() => fillPrompt($, '/kxrules add alerts toasts hide when limit >= 80', 'Rule template')} />
          </Box>
          <Text dimColor>{`Up to ${MAX_RULES} rules. A rule uses /cfg feature <mod>.<kind> on|off, so safety and settings mods can never be hidden. A switch is put back when its rule stops matching.`}</Text>
        </Box>
      )
    } else if (tab === 'health') {
      const health = await read($, healthA)
      const errs = errorCounts(await read($, errorsA))
      const all = health?.rows ?? []
      const view = pageOf(all, page, room)
      const mod = selected === '' ? undefined : findMod(selected)
      const hrow = all.find(r => r.mod === selected)
      const refusals = await read($, refusalsA)
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="sm">
            <Button key="h-refresh" label="Check health" onPress={async () => setNotice($, (await cmdHealth($, '')).split('\n')[0] ?? '')} />
            <Text dimColor>
              {health === null
                ? 'not checked yet'
                : `${fmtClock(health.at)} · ${lightCounts(all).green} good · ${lightCounts(all).amber} partly · ${lightCounts(all).red} missing`}
            </Text>
          </Box>
          {health === null && <Text dimColor>Checks which of each mod's commands (from the build-time table) are registered now. It cannot see hooks or panes.</Text>}
          {view.items.map(r => (
            <Box gap="sm">
              <Text mono color={lightColor(r.light)}>
                {lightGlyph(r.light)}
              </Text>
              <Button key={`hsel-${r.mod}`} label={r.mod === selected ? `[${r.mod}]` : r.mod} onPress={() => update($, selectedA, () => r.mod)} />
              <Text dimColor>{clip(`${r.found}/${r.expected} ${errs[r.mod] === undefined ? '' : `· ${errs[r.mod]} errors `}${r.note}`, Math.max(12, cols - r.mod.length - 12))}</Text>
            </Box>
          ))}
          {all.length > 0 && Pager(all.length)}
          {mod !== undefined && (
            <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm" gap="xs">
              <Text weight="bold" color={accent}>
                {`${mod.name} ${mod.version}`}
              </Text>
              <Text dimColor>{clip(mod.desc, Math.max(30, cols - 8))}</Text>
              <Text dimColor>{`${mod.cmds.length} commands${mod.help === null ? '' : ` · help /${mod.help}`} · ${mod.deps.length === 0 ? 'no dependencies' : `needs ${mod.deps.join(', ')}`} · ${mod.own} own switches at build${hrow === undefined ? '' : ` · ${LIGHT_TEXT[hrow.light]}`}`}</Text>
              <Box gap="xs" flexWrap="wrap">
                {mod.reset !== null && mod.name !== SELF && <Button key="h-reset" label={`reset: /${mod.reset}`} onPress={async () => setNotice($, await cmdResetMod($, mod.name))} />}
                {mod.selftest !== null && <Button key="h-selftest" label={`self-test: /${mod.selftest}`} onPress={async () => setNotice($, await cmdSelftest($, mod.name))} />}
                <Button key="h-note" label="note" onPress={() => fillPrompt($, `/kxfeedback ${mod.name} `, 'Note line')} />
                <Button key="h-changes" label="changelog" onPress={async () => { await update($, tabA, () => 'changes'); await update($, pageA, () => 0) }} />
              </Box>
            </Box>
          )}
          {Section('Command conflicts')}
          <Text dimColor>{clip(duplicateText(), Math.max(30, cols - 2))}</Text>
          {health !== null && health.conflicts.length === 0 && <Text dimColor>Live check: no duplicates, owners match the table.</Text>}
          {(health?.conflicts ?? []).slice(0, 6).map(l => (
            <Text color="warning">{clip(l, Math.max(20, cols - 2))}</Text>
          ))}
          {refusals.slice(-4).map(r => (
            <Text color="warning">{clip(`${r.plugin} /${r.name} refused: ${r.reason}`, Math.max(20, cols - 2))}</Text>
          ))}
          {Section('Self-tests')}
          {selfTests().map(t => (
            <Box gap="sm">
              <Button key={`st-${t.mod}`} label={`${t.mod}: ${t.line}`} onPress={async () => setNotice($, await cmdSelftest($, t.mod))} />
            </Box>
          ))}
        </Box>
      )
    } else if (tab === 'updates') {
      const installed = await read($, installedA)
      const pins = await read($, pinsA)
      const cli = await read($, cliA)
      const list = updateRowsOf(installed, pins)
      const interesting = (list ?? []).filter(r => r.state !== 'same')
      const view = pageOf(interesting, page, room)
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="sm">
            <Button key="u-check" label="Check (read-only)" onPress={async () => setNotice($, (await cmdUpdates($)).split('\n')[0] ?? '')} />
            <Text dimColor>
              {installed === null
                ? 'not checked yet'
                : installed.error !== ''
                  ? `could not read: ${installed.error}`
                  : `${installed.list.length} installed · read at ${fmtClock(installed.loadedAt)} · cli ${cli.status === 'bundled' ? 'bundled with the app' : cli.status === 'path' ? 'on PATH' : cli.status}`}
            </Text>
          </Box>
          {list === null && <Text dimColor>Runs `claude plugin list` (read-only) and compares versions with the table built into this mod.</Text>}
          {view.items.map(r => (
            <Box gap="sm">
              <Text color={r.state === 'newer-in-table' ? 'suggestion' : 'subtle'}>{r.state === 'newer-in-table' ? 'NEWER' : r.state === 'not-installed' ? 'none ' : r.state === 'disabled' ? 'off  ' : 'info '}</Text>
              <Button key={`usel-${r.mod}`} label={r.mod === selected ? `[${r.mod}]` : r.mod} onPress={() => update($, selectedA, () => r.mod)} />
              <Text dimColor>{clip(updateLine(r).slice(r.mod.length + 2), Math.max(12, cols - r.mod.length - 16))}</Text>
            </Box>
          ))}
          {list !== null && Pager(interesting.length)}
          {selected !== '' && findMod(selected) !== undefined && (
            <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
              {rollbackText(selected)
                .split('\n')
                .slice(0, 4)
                .map(l => (
                  <Text dimColor mono>
                    {clip(l, Math.max(20, cols - 6))}
                  </Text>
                ))}
              <Box gap="xs" flexWrap="wrap">
                <Button key="u-pin" label="note a pin" onPress={() => fillPrompt($, `/kxpin ${selected} ${findMod(selected)?.version ?? '0.1.0'}`, 'Pin line')} />
                <Button key="u-rollback" label="rollback how-to" onPress={() => fillPrompt($, `/kxrollback ${selected}`, 'Rollback line')} />
              </Box>
            </Box>
          )}
          {Section('Version notes (pins)')}
          {pins.length === 0 && <Text dimColor>None. A pin is only a note: nothing stops an update.</Text>}
          {pins.map(p => (
            <Box gap="sm">
              <Button key={`unpin-${p.mod}`} label="remove" onPress={async () => setNotice($, await cmdPin($, `rm ${p.mod}`))} />
              <Text>{`${p.mod} ${p.version}`}</Text>
              <Text dimColor>{p.note}</Text>
            </Box>
          ))}
          <Text dimColor>Rolling back a local mod is not possible from here (no history is kept); /kxrollback shows how git could.</Text>
        </Box>
      )
    } else if (tab === 'backups') {
      const snaps = newestFirst(await read($, snapsA))
      const pending = await read($, pendingA)
      const isValid = pendingState(pending, now) === 'valid' && pending !== null
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="xs" flexWrap="wrap">
            <Button key="b-now" label="Back up now" onPress={async () => setNotice($, await cmdBackup($, ''))} />
            <Button key="b-reset" label="Reset everything (step 1)" onPress={async () => setNotice($, (await cmdReset($, '', { kind: 'composer' })).split('\n')[0] ?? '')} />
            <Button key="b-clear" label="Delete snapshots" onPress={async () => setNotice($, await cmdBackup($, 'clear'))} />
          </Box>
          {pending !== null && (
            <Box flexDirection="column" borderStyle="round" borderColor={isValid ? 'warning' : 'subtle'} paddingX="sm">
              <Text weight="bold">
                {isValid
                  ? `Pending ${pending.kind === 'reset' ? 'reset' : `restore of snapshot ${pending.n}`} (about ${secondsLeft(pending, now)} s left)`
                  : 'Expired: nothing will run'}
              </Text>
              {pending.steps.slice(0, 6).map(s => (
                <Text mono dimColor>{`/cfg ${s}`}</Text>
              ))}
              {isValid && (
                <Box gap="sm">
                  <Button key="b-confirm" label="put the confirm line in the prompt" onPress={() => fillPrompt($, pending.kind === 'reset' ? '/kxreset confirm' : `/kxrestore ${pending.n} confirm`, 'Confirm line')} />
                  <Button key="b-cancel" label="cancel" onPress={async () => { await update($, pendingA, () => null); await setNotice($, 'Cancelled.') }} />
                </Box>
              )}
            </Box>
          )}
          {Section('Snapshots (newest first, last 5)')}
          {snaps.length === 0 && <Text dimColor>None yet. A snapshot holds your switch overrides and this mod's settings; /kxreset confirm takes one first.</Text>}
          {snaps.map((s, i) => (
            <Box gap="sm">
              <Button key={`b-prev-${i + 1}`} label={`preview ${i + 1}`} onPress={async () => setNotice($, (await cmdRestore($, `${i + 1}`, { kind: 'composer' })).split('\n')[1] ?? '')} />
              <Text dimColor>{clip(snapLine(s, i + 1), Math.max(20, cols - 14))}</Text>
            </Box>
          ))}
          <Text dimColor>Restore changes switches by running /cfg feature calls one at a time, only after you type /kxrestore &lt;n&gt; confirm. Resetting never runs another mod's own reset.</Text>
        </Box>
      )
    } else if (tab === 'hooks') {
      const timing = await read($, timingA)
      const links = await read($, linksA)
      const errors = await read($, errorsA)
      const order = await read($, orderA)
      const storage = await read($, storageA)
      const shown: ErrEntry[] = (selected === '' ? errors : errors.filter(x => bareName(x.plugin) === selected)).slice(-8)
      const refusals: Refusal[] = await read($, refusalsA)
      body = (
        <Box flexDirection="column" gap="xs">
          {SwitchRow('timing', 'Timing', 'Time the hooks of pop-ups and status writes per mod')}
          {SwitchRow('errors', 'Errors', 'Keep log lines that look like errors, and hook failures')}
          {SwitchRow('hookorder', 'Hook order', 'Keep the order of hooks beneath this mod')}
          {SwitchRow('refusals', 'Refusals', 'Keep refused command registrations (takes effect for later registrations)')}
          {Section('Time per mod (ui.toast, ui.status)')}
          {Object.keys(timing).length === 0 && <Text dimColor>Nothing yet. Needs the Timing switch and a pop-up or status write.</Text>}
          {topStats(timing, 6).map(s => (
            <Text mono>{clip(`${pad(s.key, 16)} ${String(s.stat.n).padStart(4)} calls  avg ${fmtMs(s.avg)}  max ${fmtMs(s.stat.max)}`, Math.max(20, cols - 2))}</Text>
          ))}
          {Section('Time per hook beneath this mod')}
          {topStats(links, 6).map(s => (
            <Text mono>{clip(`${pad(s.key, 16)} ${String(s.stat.n).padStart(4)} runs   avg ${fmtMs(s.avg)}  max ${fmtMs(s.stat.max)}`, Math.max(20, cols - 2))}</Text>
          ))}
          <Text dimColor>Measures only ui.toast and ui.status events and the links beneath this mod's hook; times are coarse.</Text>
          {Section(`Errors${selected === '' ? '' : ` of ${selected}`}`)}
          {shown.length === 0 && <Text dimColor>Nothing recorded.</Text>}
          {shown.map(x => (
            <Text mono color="warning">
              {clip(`${fmtClock(x.at)} ${pad(x.plugin, 12)} ${x.text}`, Math.max(20, cols - 2))}
            </Text>
          ))}
          {selected !== '' && <Button key="hk-all" label="all mods" onPress={() => update($, selectedA, () => '')} />}
          {refusals.slice(-3).map(r => (
            <Text mono color="warning">
              {clip(`${r.plugin} /${r.name} refused: ${r.reason}`, Math.max(20, cols - 2))}
            </Text>
          ))}
          {Section('Hook order beneath this mod')}
          {order === null && <Text dimColor>Nothing yet. Needs the Hook order switch and a pop-up or status write.</Text>}
          {(order?.rows ?? []).slice(0, 14).map(r => (
            <Text mono>{clip(`${String(r.index).padStart(2)} ${pad(r.plugin, 16)} ${pad(r.tier, 8)} ${pad(r.outcome, 9)} ${fmtMs(r.ms)}`, Math.max(20, cols - 2))}</Text>
          ))}
          {Section('Storage of this mod')}
          <Box gap="sm">
            <Button key="hk-storage" label="Measure" onPress={async () => setNotice($, (await cmdStorage($)).split('\n')[0] ?? '')} />
            <Button key="hk-clear" label="Clear recorders" onPress={async () => { await update($, timingA, () => ({})); await update($, linksA, () => ({})); await update($, errorsA, () => []); await update($, orderA, () => null); await update($, refusalsA, () => []); await setNotice($, 'Recorders cleared.') }} />
          </Box>
          {storage.slice(0, 8).map((r: StorageRow) => (
            <Text mono dimColor>{`${pad(r.key, 16)} ${fmtBytes(r.bytes)}`}</Text>
          ))}
        </Box>
      )
    } else if (tab === 'graph') {
      body = (
        <Box flexDirection="column" gap="xs">
          {Svg !== undefined ? (
            <Svg source={depGraphSvg(allMods(), accent)} alt={graphAlt(allMods())} isInteractive={false} {...svgSize(depGraphSvg(allMods(), accent), 560)} />
          ) : (
            depLines().map(l => <Text>{clip(l, Math.max(30, cols - 2))}</Text>)
          )}
          <Text dimColor>From each plugin.json at build time. Hover a line or box for the pair (desktop). Other surfaces show the list.</Text>
        </Box>
      )
    } else if (tab === 'changes') {
      const lines = changelogRows().filter(c => selected === '' || c.mod === selected)
      const view = pageOf(lines, page, room)
      body = (
        <Box flexDirection="column" gap="xs">
          {selected !== '' && <Button key="ch-all" label={`showing ${selected}: show all`} onPress={() => update($, selectedA, () => '')} />}
          {view.items.map(c => (
            <Box gap="sm">
              <Button key={`chsel-${c.mod}`} label={c.mod} onPress={() => update($, selectedA, () => c.mod)} />
              <Text dimColor mono>
                {c.version}
              </Text>
              <Text>{clip(c.text, Math.max(20, cols - c.mod.length - 14))}</Text>
            </Box>
          ))}
          {Pager(lines.length)}
        </Box>
      )
    } else if (tab === 'feedback') {
      const notes = await read($, notesA)
      const view = pageOf(allMods(), page, room)
      body = (
        <Box flexDirection="column" gap="xs">
          <Text dimColor>A note is kept on this machine only. Press a mod to put /kxfeedback &lt;mod&gt; in the prompt box, then type your text.</Text>
          {view.items.map(m => (
            <Box gap="sm">
              <Button key={`fb-${m.name}`} label={m.name} onPress={() => fillPrompt($, `/kxfeedback ${m.name} `, 'Note line')} />
              <Text dimColor>{`${notes.filter(n => n.mod === m.name).length} notes`}</Text>
            </Box>
          ))}
          {Pager(allMods().length)}
          {Section('Latest notes')}
          {notes.length === 0 && <Text dimColor>None yet.</Text>}
          {notes.slice(-5).map(n => (
            <Text>{clip(`${n.mod}: ${n.text}`, Math.max(20, cols - 2))}</Text>
          ))}
        </Box>
      )
    } else {
      const text = await diagText($)
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="sm">
            <Button key="d-fill" label="put in the prompt box" onPress={() => fillPrompt($, text, 'Diagnostics text')} />
            <Text dimColor>No paths, no user name, no notes; never written to a file.</Text>
          </Box>
          {text.split('\n').slice(0, Math.max(10, rows - 12)).map(l => (
            <Text mono>{clip(l, Math.max(20, cols - 2))}</Text>
          ))}
        </Box>
      )
    }
    const updatesAt = await read($, updatesAtA)
    const installedNow = await read($, installedA)
    const badgeRows = updateRowsOf(installedNow, await read($, pinsA))
    const showBadge = updatesAt > 0 && badgeRows !== null && isOn(overrides, `${SELF}.badge`, true) && updateCount(badgeRows) > 0

    return (
      <Box flexDirection="column" padding={gap} gap={gap}>
        <Box justifyContent="space-between">
          <Text size="heading" weight="bold" color={accent}>
            Control two
          </Text>
          <Text dimColor>{`${allMods().length} mods in the table · ${VERSION}`}</Text>
        </Box>
        <Box gap="xs" flexWrap="wrap">
          {TABS.map(([id, label]) => {
            const text = id === 'updates' && showBadge && badgeRows !== null ? `${label} (${updateCount(badgeRows)})` : label

            return <Button key={`tab-${id}`} label={id === tab ? `[${text}]` : text} onPress={async () => { await update($, tabA, () => id); await update($, pageA, () => 0) }} />
          })}
        </Box>
        {notice !== '' && <Text color={accent}>{clip(notice, Math.max(30, cols * 2))}</Text>}
        {body}
      </Box>
    )
  })
}

const LIGHT_TEXT: Record<Light, string> = { green: 'good', amber: 'partly', red: 'missing', grey: 'no commands to check' }
