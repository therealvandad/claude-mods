import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Tab } from '../types'
import {
  CONFIRM_MS,
  COMMANDS,
  LEVELS,
  LEVEL_TEXT,
  MAX_ALLOW_CWDS,
  MAX_ALLOW_PREFIXES,
  MAX_BLOCK,
  MAX_OPS,
  MIN_TOAST_GAP_MIN,
  MAX_TOAST_GAP_MIN,
  PRESET_KINDS,
  SELF,
  TAB_KEYS,
  TAB_LABELS,
  TAB_ORDER,
  applyOrder,
  buildIndex,
  buildPlan,
  cleanAudit,
  cleanBlock,
  cleanChanges,
  cleanCwd,
  cleanDismissed,
  cleanHolds,
  cleanOrder,
  cleanPiece,
  cleanPrefs,
  cleanSnap,
  cleanTidy,
  clip,
  diffOverrides,
  disableLine,
  dueHolds,
  effectiveFlips,
  findMod,
  flipLine,
  fmtTime,
  helpText,
  holdOps,
  isLevel,
  isPersonOrigin,
  isPreset,
  judge,
  makePending,
  mayToast,
  moveInOrder,
  needsConfirm,
  needsTidy,
  networkMods,
  normalize,
  pageOf,
  paletteRows,
  panicDisableLines,
  parseDo,
  parseTidy,
  pendingState,
  permFlags,
  permLine,
  pickKeys,
  planSig,
  previewLines,
  pushAudit,
  pushChange,
  secondsLeft,
  tidyText,
  verdictText,
} from './pure'
import type { AuditEntry, BlockCfg, Change, Dismissed, Hold, Level, Op, Overrides, Pending, Plan, Prefs, Snap, Spec, Tidy, World } from './pure'
import { TABLE, TABLE_DATE } from './table'

type Dollar = Parameters<Hook<'session.start'>>[0]
type RenderEvent = Parameters<Hook<'ui.render'>>[1]
type Elements = ReturnType<Dollar['ui']['resolve']>

const PANE = 'control-kit-main'
const RUN_TIMEOUT_MS = 8000
const RETRY_MS = 5 * 60_000

// Foreign atoms, read only. The shape tag is required.
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')

// Pane state (plain values): where the person is.
const tabA = atom({ plugin: 'control-kit', key: 'tab' } as const, 'home')
const pageA = atom({ plugin: 'control-kit', key: 'page' } as const, 0)
const queryA = atom({ plugin: 'control-kit', key: 'query' } as const, '')
const presetA = atom({ plugin: 'control-kit', key: 'preset' } as const, 'off')
const probeA = atom({ plugin: 'control-kit', key: 'probe' } as const, '')
const noticeA = atom({ plugin: 'control-kit', key: 'notice' } as const, '')
const revA = atom({ plugin: 'control-kit', key: 'rev' } as const, 0)

// ------------------------------------------------------------------ recorded data (loaded at session start, saved on change)

type Data = {
  snap: Snap | null
  holds: Hold[]
  changes: Change[]
  audit: AuditEntry[]
  dismissed: Dismissed
  rowsBefore: Tidy | null
  block: BlockCfg
  order: string[]
  prefs: Prefs
  queue: string[]
}

const fresh = (): Data => ({ snap: null, holds: [], changes: [], audit: [], dismissed: {}, rowsBefore: null, block: { list: [], allow: {} }, order: [], prefs: { toastGapMin: MIN_TOAST_GAP_MIN, isLocked: false }, queue: [] })

let D: Data = fresh()
let pending: Pending | null = null
let cwd = '/'
let lastToastAt = 0
let timer: { cancel: () => void } | undefined
let liveRows: string[] = []
/** The block switch as the last tool call saw it: the fail-closed catch only holds a command back while this is true and the list is not empty. */
let blockArmed = false

const KEYS = ['snap', 'holds', 'changes', 'audit', 'dismissed', 'rowsBefore', 'block', 'order', 'prefs', 'queue'] as const
type Key = (typeof KEYS)[number]

const nowOf = (d: Dollar): Promise<number> => d.clock.now().catch(() => 0)

const save = (d: Dollar, key: Key): Promise<unknown> => d.store.set(key, D[key]).catch(() => undefined)

const load = async (d: Dollar) => {
  const get = (k: Key) => d.store.get(k).catch(() => undefined)
  const queue = await get('queue')
  D = {
    snap: cleanSnap(await get('snap')),
    holds: cleanHolds(await get('holds')),
    changes: cleanChanges(await get('changes')),
    audit: cleanAudit(await get('audit')),
    dismissed: cleanDismissed(await get('dismissed')),
    rowsBefore: cleanTidy(await get('rowsBefore')),
    block: cleanBlock(await get('block')),
    order: cleanOrder(await get('order')),
    prefs: cleanPrefs(await get('prefs')),
    queue: Array.isArray(queue) ? queue.filter((l): l is string => typeof l === 'string' && /^\/(cfg|tidy) [a-z0-9. -]{1,100}$/.test(l)).slice(0, MAX_OPS) : [],
  }
}

const bump = (d: Dollar) => update(d, revA, n => n + 1)

const record = async (d: Dollar, what: string, result: string) => {
  D = { ...D, audit: pushAudit(D.audit, { at: await nowOf(d), what, result }) }
  await save(d, 'audit')
}

const setNotice = (d: Dollar, text: string) => update(d, noticeA, () => clip(text, 220))

// ------------------------------------------------------------------ the levers: /cfg and /tidy through $.command.run

type Ran = { ok: boolean; text: string; why: 'ran' | 'refused' | 'rejected' | 'timeout' }

const raceTimeout = <T,>(d: Dollar, p: Promise<T>, ms: number): Promise<{ v: T } | { err: 'timeout' | 'rejected' }> =>
  new Promise(resolve => {
    const t = d.clock.after(ms, () => resolve({ err: 'timeout' }))
    p.then(
      v => {
        t.cancel()
        resolve({ v })
      },
      () => {
        t.cancel()
        resolve({ err: 'rejected' })
      },
    )
  })

const REFUSED = /^(No switch|No mod|Usage|Say on|".{0,60}" is not a switch|.{0,80} cannot be changed)/

const lineOf = (op: Op): string => `/${op.t} ${op.args}`

const runCommand = async (d: Dollar, op: Op): Promise<Ran> => {
  const got = await raceTimeout(d, d.command.run({ command: op.t, args: op.args }), RUN_TIMEOUT_MS)

  if ('err' in got) {
    return { ok: false, text: '', why: got.err }
  }
  const text = typeof got.v.text === 'string' ? got.v.text : ''

  return REFUSED.test(text.trim()) ? { ok: false, text, why: 'refused' } : { ok: true, text, why: 'ran' }
}

const fill = async (d: Dollar, text: string): Promise<boolean> => {
  const done = await d.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)

  return done?.isFilled === true
}

type OpsResult = { ran: number; refused: string[]; stoppedAt: number; filled: boolean; lines: string[] }

/**
 * Runs the commands one after the other. A refused answer is counted and the rest go on. If the host will not run a command
 * at all (rejected or no answer in time) and `canFill` is true, that line goes into the prompt box for the person to send and the
 * rest wait in a queue for /kcnext; with `canFill` false (a background timer) nothing touches the prompt.
 */
const runOps = async (d: Dollar, ops: readonly Op[], canFill: boolean): Promise<OpsResult> => {
  const out: OpsResult = { ran: 0, refused: [], stoppedAt: -1, filled: false, lines: [] }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]

    if (op === undefined) {
      continue
    }
    const r = await runCommand(d, op)

    if (r.ok) {
      out.ran++
      continue
    }

    if (r.why === 'refused') {
      out.refused.push(`${lineOf(op)}: ${clip(r.text, 80)}`)
      continue
    }
    out.stoppedAt = i

    if (canFill) {
      const rest = ops.slice(i).map(lineOf)
      const first = rest.shift() ?? ''
      D = { ...D, queue: rest.slice(0, MAX_OPS) }
      await save(d, 'queue')
      out.filled = await fill(d, first)
      out.lines.push(
        `${r.why === 'timeout' ? 'The host did not answer' : 'The host refused to run'} ${first}. ${out.filled ? 'It is in the prompt box: press Enter to send it.' : `Type it yourself: ${first}`}${rest.length > 0 ? ` ${rest.length} more wait: /kcnext puts the next one in the prompt.` : ''}`,
      )
    } else {
      out.lines.push(`Could not run ${lineOf(op)} (${r.why}).`)
    }
    break
  }

  return out
}

const readOverrides = async (d: Dollar): Promise<Overrides | null> => {
  try {
    const raw = await read(d, featuresA)

    return typeof raw === 'object' && raw !== null ? { ...raw } : {}
  } catch {
    return null
  }
}

const switchOn = async (d: Dollar, id: string, dflt: boolean): Promise<boolean> => ((await readOverrides(d)) ?? {})[id] ?? dflt

/** What /tidy last said. A command cannot start another command while it is still answering, so previews use this copy. */
let tidyCache: { tidy: Tidy | null; at: number } = { tidy: null, at: 0 }
let tidyBusy = false
let lastResult = ''

const readTidy = async (d: Dollar): Promise<Tidy | null> => {
  const r = await runCommand(d, { t: 'tidy', args: '' })
  const tidy = r.ok ? parseTidy(r.text) : null
  tidyCache = { tidy, at: await nowOf(d) }

  return tidy
}

/** Reads /tidy a moment later, outside the command that asked, so the next preview can show the rows. */
const refreshTidyLater = (d: Dollar) => {
  if (tidyBusy) {
    return
  }
  tidyBusy = true
  d.clock.after(100, () => {
    void readTidy(d).then(
      () => {
        tidyBusy = false
      },
      () => {
        tidyBusy = false
      },
    )
  })
}

const gather = async (d: Dollar, kind: Spec['kind'], fresh: boolean): Promise<World> => ({
  table: TABLE,
  ov: (await readOverrides(d)) ?? {},
  tidy: needsTidy(kind) ? (fresh ? await readTidy(d) : tidyCache.tidy) : null,
  snap: D.snap,
  holds: D.holds,
  changes: D.changes,
  dismissed: D.dismissed,
  rowsBefore: D.rowsBefore,
  now: await nowOf(d),
  cwd,
})

// ------------------------------------------------------------------ executing a plan: the one place that changes anything

const isLocked = () => D.prefs.isLocked

const LOCKED_TEXT = 'Read-only mode is on (/kclock on): this mod will not change anything. Type /kclock off to allow changes. (It only locks this mod’s own commands; other mods are not locked.)'

const applyEffects = async (d: Dollar, plan: Plan, phase: 'before' | 'after') => {
  const e = plan.effects

  if (phase === 'before') {
    if (e.snap !== undefined && e.snap !== null) {
      D = { ...D, snap: e.snap }
      await save(d, 'snap')
    }

    if (e.holds !== undefined && (plan.kind === 'pause' || plan.kind === 'snooze')) {
      D = { ...D, holds: e.holds }
      await save(d, 'holds')
      await armTimer(d)
    }

    return
  }

  if (e.snap === null) {
    D = { ...D, snap: null }
    await save(d, 'snap')
  }

  if (e.holds !== undefined && plan.kind !== 'pause' && plan.kind !== 'snooze') {
    D = { ...D, holds: e.holds }
    await save(d, 'holds')
    await armTimer(d)
  }

  if (e.dismissed !== undefined) {
    D = { ...D, dismissed: e.dismissed }
    await save(d, 'dismissed')
  }

  if (e.rowsBefore !== undefined) {
    D = { ...D, rowsBefore: e.rowsBefore }
    await save(d, 'rowsBefore')
  }

  if (e.popChange === true) {
    D = { ...D, changes: D.changes.slice(0, -1) }
    await save(d, 'changes')
  }

  if (e.resetAll !== undefined) {
    const keepLock = D.prefs.isLocked
    const keep = e.resetAll === 'data' ? { snap: D.snap, holds: D.holds } : { snap: null, holds: [] }
    D = { ...fresh(), ...keep, prefs: { toastGapMin: MIN_TOAST_GAP_MIN, isLocked: keepLock } }

    for (const k of KEYS) {
      await save(d, k)
    }
    await armTimer(d)
  }
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

const execute = async (d: Dollar, plan: Plan, canFill: boolean): Promise<string> => {
  const index = buildIndex(TABLE)

  if (D.queue.length > 0) {
    // Lines left over from an earlier refused run no longer fit the state this change starts from.
    D = { ...D, queue: [] }
    await save(d, 'queue')
  }
  const before = await readOverrides(d)
  await applyEffects(d, plan, 'before')
  const res = await runOps(d, plan.ops, canFill)
  const after = await readOverrides(d)
  const isComplete = res.stoppedAt === -1
  const lines: string[] = [`${plan.label}: ${isComplete ? 'done' : 'started'}.`]

  let actual = plan.flips

  if (before !== null && after !== null) {
    actual = effectiveFlips(index, diffOverrides(normalize(index, before), normalize(index, after)))
    const wanted = plan.flips.map(f => f.id)
    const saw = actual.map(f => f.id)
    const verified = !isComplete || sameIds(wanted, saw)

    lines.push(
      verified
        ? `Checked against the live switches: ${actual.length} switch${actual.length === 1 ? '' : 'es'} changed${isComplete ? ', as previewed' : ' so far'}.`
        : `The live switches differ from the preview: expected ${wanted.length}, saw ${saw.length} change${saw.length === 1 ? '' : 's'}. Look at /cfg feature.`,
    )

    for (const f of actual.slice(0, 12)) {
      lines.push(`  ${flipLine(index, f)}`)
    }

    if (actual.length > 12) {
      lines.push(`  ... and ${actual.length - 12} more`)
    }
  } else {
    lines.push('The live switch state could not be read, so the result was not checked.')
  }
  lines.push(...res.lines)

  if (res.refused.length > 0) {
    lines.push(`${res.refused.length} command${res.refused.length === 1 ? ' was' : 's were'} refused: ${res.refused.slice(0, 3).join(' | ')}`)
  }

  if (isComplete && res.refused.length === 0) {
    await applyEffects(d, plan, 'after')

    if (plan.kind !== 'undo' && plan.kind !== 'reset' && (actual.length > 0 || plan.tidy !== null)) {
      D = { ...D, changes: pushChange(D.changes, { at: await nowOf(d), label: plan.label, flips: actual, tidy: plan.tidy }) }
      await save(d, 'changes')
    }
  } else if (isComplete) {
    // Some commands were refused: keep the restore point and the timers, do not claim a clean change.
    lines.push('The change was not recorded as complete, so the restore point (if any) is kept.')
  }
  await record(d, plan.label, [lines[0], ...res.lines, lines[1]].filter(l => l !== undefined).join(' '))
  await bump(d)
  await setNotice(d, lines[0] ?? '')

  return lines.join('\n')
}

// ------------------------------------------------------------------ requests: preview, confirm, then a queued job

const requireUnlocked = (): string | undefined => (isLocked() ? LOCKED_TEXT : undefined)

/**
 * The host refuses `$.command.run` from inside a command.run hook (it would wait on the turn the hook holds). So a typed command only
 * previews and queues a job; the job runs a moment later from a timer, where /cfg and /tidy can be started. Every change goes through here.
 */
type Job = { spec: Spec; sig: string | undefined; canFill: boolean }

let jobs: Job[] = []
let draining = false

const runJob = async (d: Dollar, job: Job): Promise<void> => {
  const locked = requireUnlocked()

  if (locked !== undefined) {
    await record(d, `${job.spec.kind} not run`, 'read-only mode is on')

    return
  }
  const built = buildPlan(job.spec, await gather(d, job.spec.kind, true))

  if (!built.ok) {
    lastResult = `${job.spec.kind}: ${built.message}`
    await record(d, `${job.spec.kind} not run`, built.message)
    await setNotice(d, lastResult)
    await bump(d)

    return
  }

  if (job.sig !== undefined && planSig(built.plan) !== job.sig) {
    lastResult = `${built.plan.label}: the switches changed after the preview, so nothing was run. Ask again to see a fresh preview.`
    await record(d, `${built.plan.label} not run`, 'the switches changed after the preview')
    await setNotice(d, lastResult)
    await bump(d)

    return
  }
  const text = await execute(d, built.plan, job.canFill)
  lastResult = text.split('\n').slice(0, 2).join(' ')
  await bump(d)
}

const drain = async (d: Dollar): Promise<void> => {
  if (draining) {
    return
  }
  draining = true

  try {
    for (let job = jobs.shift(); job !== undefined; job = jobs.shift()) {
      await runJob(d, job).catch(() => record(d, `${job.spec.kind} failed`, 'an unexpected error; nothing more was run'))
    }
  } finally {
    draining = false
  }
}

const enqueue = (d: Dollar, job: Job) => {
  jobs = [...jobs, job].slice(-20)
  d.clock.after(50, () => {
    void drain(d)
  })
}

const QUEUED = 'Running in a moment: a command cannot start /cfg while it is still answering, so this runs right after. The result is in /kclog and the pane.'

const request = async (d: Dollar, spec: Spec): Promise<string> => {
  const locked = requireUnlocked()

  if (locked !== undefined) {
    return locked
  }

  if (needsTidy(spec.kind) && (tidyCache.tidy === null || spec.kind.startsWith('rows'))) {
    refreshTidyLater(d)
  }
  const built = buildPlan(spec, await gather(d, spec.kind, false))

  if (!built.ok) {
    return built.message
  }
  const plan = built.plan
  const index = buildIndex(TABLE)

  if (!needsConfirm(plan)) {
    enqueue(d, { spec, sig: planSig(plan), canFill: true })

    return [...previewLines(index, plan), '', QUEUED].join('\n')
  }
  pending = makePending(spec, plan, await nowOf(d))
  await setNotice(d, `Waiting for /kcdo confirm: ${plan.label}`)
  await bump(d)

  return [...previewLines(index, plan), '', `Nothing has run. Type /kcdo confirm within ${CONFIRM_MS / 1000} seconds to apply exactly this, or /kcdo cancel.`].join('\n')
}

const confirmPending = async (d: Dollar, origin: unknown, fromPane: boolean): Promise<string> => {
  const now = await nowOf(d)

  if (!fromPane && !isPersonOrigin(origin)) {
    return 'A confirm must be typed by you. Nothing was run.'
  }
  const state = pendingState(pending, now)

  if (state === 'none' || pending === null) {
    return 'Nothing is pending. Start with /kcoff, /kcon, /kcsafe or /kcdo <preset>; it shows a preview first.'
  }
  const p = pending

  if (state === 'expired') {
    pending = null
    await bump(d)

    return 'The pending change expired after 2 minutes and nothing was run. Ask for it again to see a fresh preview.'
  }
  const locked = requireUnlocked()

  if (locked !== undefined) {
    return locked
  }
  const built = buildPlan(p.spec, await gather(d, p.spec.kind, false))

  if (!built.ok) {
    pending = null
    await bump(d)

    return `${built.message} Nothing was run.`
  }

  if (planSig(built.plan) !== p.sig) {
    // The world moved since the preview: show the new preview instead of running something the person did not see.
    const index = buildIndex(TABLE)
    pending = makePending(p.spec, built.plan, now)
    await bump(d)

    return ['Things changed since the preview, so nothing was run. This is the new preview:', ...previewLines(index, built.plan), '', 'Type /kcdo confirm to apply exactly this.'].join('\n')
  }
  pending = null
  enqueue(d, { spec: p.spec, sig: p.sig, canFill: true })
  await bump(d)

  return `Confirmed: ${p.label}. ${QUEUED}`
}

// ------------------------------------------------------------------ timed pauses and snoozes

const armTimer = async (d: Dollar) => {
  timer?.cancel()
  timer = undefined

  if (D.holds.length === 0) {
    return
  }
  const now = await nowOf(d)
  const next = Math.min(...D.holds.map(h => h.until))
  const ms = Math.max(1000, next - now)

  timer = d.clock.after(Math.min(ms, 2 ** 31 - 1), () => {
    void sweep(d)
  })
}

const sweep = async (d: Dollar): Promise<void> => {
  // One change at a time: if a queued job is running, look again in a moment.
  if (draining) {
    timer = d.clock.after(2000, () => {
      void sweep(d)
    })

    return
  }
  draining = true

  try {
    await sweepNow(d)
  } finally {
    draining = false
  }
}

const sweepNow = async (d: Dollar): Promise<void> => {
  const now = await nowOf(d)
  const { due, rest } = dueHolds(D.holds, now)

  if (due.length === 0) {
    await armTimer(d)

    return
  }
  const ops = holdOps(due)
  const res = await runOps(d, ops, false)

  if (res.stoppedAt !== -1) {
    await record(d, 'timed restore', `could not put ${due.length} switch(es) back (${res.lines.join(' ')}); will retry. /kcpause <mod> off ends it by hand.`)
    timer = d.clock.after(RETRY_MS, () => {
      void sweep(d)
    })

    return
  }
  D = { ...D, holds: rest }
  await save(d, 'holds')
  await record(d, 'timed restore', `put back ${due.map(h => h.id).join(', ')}${res.refused.length > 0 ? `; ${res.refused.length} refused` : ''}`)
  await bump(d)
  await armTimer(d)

  if (await switchOn(d, `${SELF}.notify-restore`, false)) {
    await notice(d, 'notice', `A pause or snooze ended: ${due.map(h => h.id.split('.')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')} back to normal.`)
  }
}

// ------------------------------------------------------------------ notices: priority levels and the rate limit (this mod's own; the central gate does not rate-limit)

const notice = async (d: Dollar, level: Level, text: string): Promise<string> => {
  const now = await nowOf(d)

  if (level === 'info') {
    await record(d, 'notice (info)', text)

    return 'info: kept in the audit log, no pop-up.'
  }

  if (!mayToast(level, lastToastAt, now, D.prefs.toastGapMin)) {
    await record(d, 'notice held back', `${level}: ${text} (rate limit ${D.prefs.toastGapMin} min)`)

    return `${level}: held back by the rate limit (${D.prefs.toastGapMin} min between pop-ups from this mod). It is in /kclog.`
  }
  lastToastAt = now
  d.ui.toast(clip(`control-kit: ${text}`, 140), { timeoutMs: 6000 })

  return `${level}: shown as a pop-up (unless the control-kit.toasts switch is off).`
}

// ------------------------------------------------------------------ command text helpers

const cwdKey = () => cleanCwd(cwd) ?? '/'

const show = (list: readonly string[], max = 40) => (list.length <= max ? list : [...list.slice(0, max), `... and ${list.length - max} more`])

const holdLines = (now: number): string[] => {
  const mods = [...new Set(D.holds.map(h => h.id.split('.')[0] ?? ''))]

  return mods.map(m => {
    const mine = D.holds.filter(h => h.id.startsWith(`${m}.`))
    const until = Math.max(...mine.map(h => h.until))

    return `${m}: ${mine.map(h => h.id.split('.')[1]).join(', ')} off until ${fmtTime(until)} (${Math.max(0, Math.round((until - now) / 60_000))} min left, ${mine.some(h => h.src === 'pause') ? 'pause' : 'snooze'})`
  })
}

const statusText = async (d: Dollar): Promise<string> => {
  const now = await nowOf(d)
  const lines = [
    `Read-only lock: ${isLocked() ? 'ON' : 'off'}`,
    `Quiet mode restore point: ${D.snap === null ? 'none' : `since ${fmtTime(D.snap.at)} (${D.snap.src}); /kcon restores`}`,
    `Pending confirm: ${pending !== null && pendingState(pending, now) === 'valid' ? `${pending.label} (${secondsLeft(pending, now)} s left)` : 'none'}`,
    `Timed pauses and snoozes: ${D.holds.length === 0 ? 'none' : ''}`,
    ...holdLines(now).map(l => `  ${l}`),
    `Change log: ${D.changes.length}/30 · audit log: ${D.audit.length}/200 · block list: ${D.block.list.length} (switch ${blockArmed ? 'on' : 'off or unread'}) · order: ${D.order.join(', ') || 'none'}`,
    `Commands waiting for /kcnext: ${D.queue.length}`,
    `Last result: ${lastResult || 'none yet'}`,
  ]

  return lines.join('\n')
}

const changesText = (): string => {
  if (D.changes.length === 0) {
    return 'No switch change has been logged yet.'
  }
  const index = buildIndex(TABLE)

  return [
    `The last ${D.changes.length} change${D.changes.length === 1 ? '' : 's'}, newest first (/kcundo undoes the newest):`,
    ...[...D.changes].reverse().slice(0, 30).map(c => `  ${fmtTime(c.at)}  ${c.label}: ${c.flips.length} switch${c.flips.length === 1 ? '' : 'es'}${c.flips.length > 0 && c.flips.length <= 2 ? ` (${c.flips.map(f => flipLine(index, f)).join('; ')})` : ''}${c.tidy !== null ? ' + rows' : ''}`),
  ].join('\n')
}

const logText = (page: number): string => {
  const rows = [...D.audit].reverse()
  const pg = pageOf(rows, page, 15)

  return [`Audit log: everything this mod did (newest first), page ${pg.page + 1} of ${pg.pages}, ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}.`, ...pg.rows.map(a => `  ${fmtTime(a.at)}  ${a.what}: ${a.result}`), ...(rows.length === 0 ? ['  (nothing yet)'] : [])].join('\n')
}

const permsText = (name: string): string => {
  if (name.trim() === '') {
    return [`What each mod's code touches (from the build-time table, ${TABLE_DATE}; a mod added later is missing until the table is rebuilt):`, ...TABLE.map(m => `  ${permLine(m)}`), 'shell = $.process, files = $.fs, network = $.http or $.mcp, store = $.store, watches WebFetch = it has a hook on that tool. Disabling a mod: /kcdisable <mod>.'].join('\n')
  }
  const found = findMod(TABLE, name)

  if (found.mod === undefined) {
    return `No mod named "${clip(name, 40)}".${found.near.length > 0 ? ` Closest: ${found.near.join(', ')}.` : ''}`
  }
  const m = found.mod

  return [`${permLine(m)}`, `  calls seen by claude plugin validate: ${m.uses.families.map(f => `$.${f}`).join(', ') || 'none'}`, `  ${m.cmds.length} command${m.cmds.length === 1 ? '' : 's'}, ${m.own.length} own switch${m.own.length === 1 ? '' : 'es'}`, `  to turn it off for good (a person runs this, this mod cannot): ${disableLine(m.name)}${m.guard ? '  (a guard: this removes protection)' : ''}`].join('\n')
}

const netText = (): string => {
  const list = networkMods(TABLE)

  return [
    'There is no network on/off switch for mods: this mod cannot cut a mod off the network, and no setting does. What it can show is which mods use it (build-time table, ' + TABLE_DATE + ').',
    ...list.map(m => `  ${m.name}: ${m.uses.network ? 'uses $.http or $.mcp' : ''}${m.uses.network && m.uses.webfetch ? '; ' : ''}${m.uses.webfetch ? 'watches WebFetch calls' : ''}`),
    list.length === 0 ? '  (none)' : 'To stop one for good: /kcdisable <mod> prints and fills the claude plugin disable line.',
  ].join('\n')
}

const rowsShow = async (d: Dollar): Promise<string> => {
  refreshTidyLater(d)
  const t = tidyCache.tidy

  return [`Row filter (/tidy): ${t === null ? 'has not been read yet or did not answer (is band-tidy on? it is read in the background: ask again in a moment)' : tidyText(t)}`, `Rows drawn above the prompt right now: ${liveRows.join(', ') || '(none seen yet)'}`, `Saved row order: ${D.order.join(', ') || '(none)'}${D.rowsBefore !== null ? `\nBefore the last collapse: ${tidyText(D.rowsBefore)} (/kcrows expand restores it)` : ''}`].join('\n')
}

// ------------------------------------------------------------------ the commands

const needLock = (): string | undefined => requireUnlocked()

/** The panic button: confirm-free by design. It only changes feature switches and the row filter, both put back by /kcon. */
const panic = async (d: Dollar): Promise<string> => {
  const locked = needLock()

  if (locked !== undefined) {
    return locked
  }

  if (tidyCache.tidy === null) {
    refreshTidyLater(d)
  }
  const built = buildPlan({ kind: 'panic' }, await gather(d, 'panic', false))

  if (!built.ok) {
    return built.message
  }
  const lines = built.plan.disableLines
  const index = buildIndex(TABLE)
  enqueue(d, { spec: { kind: 'panic' }, sig: undefined, canFill: true })
  const filled = await fill(d, lines.join('\n'))

  return [
    ...previewLines(index, built.plan, 12),
    '',
    'Panic runs without a confirm: it only changes feature switches and the row filter.',
    QUEUED,
    'Undo with /kcon (it restores the switches and rows exactly).',
    '',
    'Mods you can turn off for good (this mod cannot; a person runs these):',
    ...show(lines, 12),
    filled ? 'The full list is in the prompt box: it is not sent.' : 'The prompt box could not be filled: copy the lines above.',
  ].join('\n')
}

const handle = async (d: Dollar, name: string, rawArgs: string, origin: unknown): Promise<string> => {
  const args = rawArgs.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 400)
  const [first = '', ...restWords] = args.split(/\s+/).filter(w => w !== '')
  const word = first.toLowerCase()
  const rest = restWords.join(' ')
  const index = buildIndex(TABLE)

  switch (name) {
    case 'kc':
      await d.ui.open({ id: PANE, title: 'Control kit' }).catch(() => undefined)

      return `${helpText()}\n\n${await statusText(d)}`
    case 'kcoff':
      return request(d, { kind: 'off' })
    case 'kcon':
      return request(d, { kind: 'on' })
    case 'kcsafe':
      return [await request(d, { kind: 'safe' }), '', 'Honest scope: a startup flag that loads only the guards does not exist. This is the closest: every non-guard switch off now, plus the lines below that a person can run to turn the mods off for good.', ...show(panicDisableLines(TABLE), 12)].join('\n')
    case 'kcpanic':
      return panic(d)
    case 'kcdo': {
      const cmd = parseDo(args)

      if (cmd.kind === 'error') {
        return cmd.message
      }

      if (cmd.kind === 'stage') {
        return request(d, cmd.spec)
      }

      if (cmd.kind === 'confirm') {
        return confirmPending(d, origin, false)
      }

      if (cmd.kind === 'cancel') {
        const had = pending !== null

        pending = null
        await bump(d)

        return had ? 'Cancelled. Nothing was run.' : 'Nothing was pending.'
      }
      const now = await nowOf(d)

      return pending !== null && pendingState(pending, now) === 'valid' ? `Pending now (${secondsLeft(pending, now)} s left): ${pending.label}. /kcdo confirm applies it, /kcdo cancel drops it.` : `Nothing is pending. /kcdo ${PRESET_KINDS.join('|')} shows a preview first.`
    }
    case 'kcpreview': {
      if (!isPreset(word)) {
        return `Usage: /kcpreview ${PRESET_KINDS.join('|')} (a dry run: it lists the switches that would flip and changes nothing).`
      }
      const built = buildPlan({ kind: word }, await gather(d, word, false))

      return built.ok ? [...previewLines(index, built.plan, 200), '', 'Dry run: nothing was changed and nothing is staged.'].join('\n') : built.message
    }
    case 'kcundo':
      if (word === 'list') {
        return changesText()
      }

      return request(d, { kind: 'undo' })
    case 'kcpause':
    case 'kcsnooze': {
      const kind = name === 'kcpause' ? 'pause' : 'snooze'
      const second = (restWords[0] ?? '').toLowerCase()

      if (word === '' || word === 'list') {
        const now = await nowOf(d)

        return D.holds.length === 0 ? `Nothing is ${kind === 'pause' ? 'paused' : 'snoozed'}. Usage: /${name} <mod> [minutes up to 240]` : ['Timed holds (pause = all four switches, snooze = pop-ups and sounds):', ...holdLines(now).map(l => `  ${l}`), `/${name} <mod> off ends one now.`].join('\n')
      }

      if (second === 'off' || second === 'end' || second === 'stop') {
        return request(d, { kind: 'release', arg: word })
      }

      return request(d, { kind, arg: `${word} ${second}`.trim() })
    }
    case 'kcdismiss':
      if (word === '') {
        const names = Object.entries(D.dismissed)

        return names.length === 0 ? 'No pop-ups are dismissed. Usage: /kcdismiss <mod> [note] (turns that mod’s pop-ups off for good); /kcdismiss <mod> undo.' : ['Dismissed pop-ups:', ...names.map(([m, v]) => `  ${m}  ${fmtTime(v.at)}  ${v.note}`)].join('\n')
      }

      return (restWords[0] ?? '').toLowerCase() === 'undo' ? request(d, { kind: 'undismiss', arg: word }) : request(d, { kind: 'dismiss', arg: `${word} ${rest}`.trim() })
    case 'kclock': {
      if (word === 'on') {
        D = { ...D, prefs: { ...D.prefs, isLocked: true } }
        await save(d, 'prefs')
        await record(d, 'lock', 'read-only mode on')
        await bump(d)

        return 'Read-only mode ON. This mod’s own commands refuse changes until /kclock off. Honest limit: it cannot lock other mods, and timed pauses already running still put their switches back.'
      }

      if (word === 'off') {
        if (!isPersonOrigin(origin)) {
          return 'Turning the lock off must be typed by you. Nothing changed.'
        }
        D = { ...D, prefs: { ...D.prefs, isLocked: false } }
        await save(d, 'prefs')
        await record(d, 'lock', 'read-only mode off')
        await bump(d)

        return 'Read-only mode off.'
      }

      return `Read-only mode is ${isLocked() ? 'ON' : 'off'}. Usage: /kclock on|off`
    }
    case 'kclog': {
      const n = Number(word)

      return logText(Number.isInteger(n) && n >= 1 ? n - 1 : 0)
    }
    case 'kcfind': {
      const rows = paletteRows(TABLE, args)

      return rows.length === 0 ? `No command matches "${clip(args, 40)}".` : [`${rows.length} command${rows.length === 1 ? '' : 's'}${args === '' ? '' : ` matching "${clip(args, 40)}"`} (first 25):`, ...rows.slice(0, 25).map(r => `  /${r.n}  ${r.d}  [${r.mod}]`)].join('\n')
    }
    case 'kcperms':
      return permsText(args)
    case 'kcnet':
      return netText()
    case 'kcdisable': {
      const found = findMod(TABLE, word)

      if (found.mod === undefined) {
        return `Usage: /kcdisable <mod>. ${word === '' ? '' : `No mod named "${clip(word, 40)}". `}${found.near.length > 0 ? `Closest: ${found.near.join(', ')}.` : '/kcperms lists the mods.'}`
      }
      const line = disableLine(found.mod.name)
      const filled = await fill(d, line)
      await record(d, 'disable line shown', line)

      return `${line}\n${filled ? 'It is in the prompt box (not sent).' : 'Copy it from here.'} This mod cannot disable plugins itself: run it in a terminal, then restart.${found.mod.guard ? '\nThis is a guard mod: turning it off removes protection.' : ''}`
    }
    case 'kcblock':
      return blockCommand(d, word, rest)
    case 'kctest': {
      if (args === '') {
        return 'Usage: /kctest <a command line>. It is only checked against the block list; it is never run.'
      }
      const v = judge(args, D.block, cwd)

      return `${verdictText(v, await switchOn(d, `${SELF}.block`, false))}\nChecked against ${D.block.list.length} piece${D.block.list.length === 1 ? '' : 's'}; project ${cwdKey()}.`
    }
    case 'kcallow':
      return allowCommand(d, word, rest)
    case 'kclimit': {
      if (word === '') {
        return `Pop-ups from this mod: at most one per ${D.prefs.toastGapMin} minute${D.prefs.toastGapMin === 1 ? '' : 's'}. /kclimit <${MIN_TOAST_GAP_MIN} to ${MAX_TOAST_GAP_MIN}> changes it. (The central pop-up switch does not rate-limit: this limit covers only this mod's own pop-ups.)`
      }
      const locked = needLock()

      if (locked !== undefined) {
        return locked
      }
      const n = Number(word)

      if (!Number.isInteger(n) || n < MIN_TOAST_GAP_MIN || n > MAX_TOAST_GAP_MIN) {
        return `Minutes is a whole number from ${MIN_TOAST_GAP_MIN} to ${MAX_TOAST_GAP_MIN}.`
      }
      D = { ...D, prefs: { ...D.prefs, toastGapMin: n } }
      await save(d, 'prefs')
      await record(d, 'rate limit', `${n} min`)

      return `Pop-ups from this mod: at most one per ${n} minutes.`
    }
    case 'kcprio': {
      if (word === 'test') {
        const level = (restWords[0] ?? '').toLowerCase()

        return isLevel(level) ? notice(d, level, `test ${level} notice`) : `Usage: /kcprio test ${LEVELS.join('|')}`
      }

      return ['Notice priority levels (a helper this mod uses for its own notices; other mods are not touched):', ...LEVELS.map(l => `  ${l.padEnd(7)} ${LEVEL_TEXT[l]}`), `Rate limit now ${D.prefs.toastGapMin} min (/kclimit). /kcprio test <level> sends a sample.`].join('\n')
    }
    case 'kcrows':
      return rowsCommand(d, word, rest)
    case 'kcorder':
      return orderCommand(d, word, restWords.map(w => w.toLowerCase()))
    case 'kckeys':
      return ['Pane hotkeys (work while the pane has the focus; ctrl+x tab or a click focuses it):', ...TAB_ORDER.map(t => `  ${TAB_KEYS[t]}  ${TAB_LABELS[t]} tab`), '  n / p  next / previous page', '  letters  the buttons of the tab you are on, each one drawn with its key', 'Honest note: I could not try keys in the live app; they follow the documented Button hotkey rules.'].join('\n')
    case 'kcnext': {
      const locked = needLock()

      if (locked !== undefined) {
        return locked
      }
      const next = D.queue[0]

      if (next === undefined) {
        return 'Nothing is queued.'
      }
      D = { ...D, queue: D.queue.slice(1) }
      await save(d, 'queue')
      const filled = await fill(d, next)

      return `${filled ? 'In the prompt box (press Enter):' : 'Type it yourself:'} ${next}${D.queue.length > 0 ? `\n${D.queue.length} more waiting.` : '\nThat was the last one.'}`
    }
    case 'kcreset':
      return request(d, { kind: 'reset', arg: word })
    default:
      return `Unknown command /${name}.`
  }
}

const blockCommand = async (d: Dollar, word: string, rest: string): Promise<string> => {
  if (word === 'on' || word === 'off') {
    return request(d, { kind: word === 'on' ? 'block-on' : 'block-off' })
  }

  if (word === 'list' || word === '') {
    const on = await switchOn(d, `${SELF}.block`, false)

    return [`Bash block list: switch ${on ? 'ON' : 'off'}, ${D.block.list.length} piece${D.block.list.length === 1 ? '' : 's'} (max ${MAX_BLOCK}). Case is ignored; a command that contains a piece is refused.`, ...D.block.list.map(p => `  "${p}"`), D.block.list.length === 0 ? '  (empty: nothing is blocked)' : '', 'Usage: /kcblock on|off|add <piece>|rm <piece>|list. /kctest <command> tries a command. tool-guard keeps its own rules either way.'].filter(l => l !== '').join('\n')
  }
  const locked = needLock()

  if (locked !== undefined) {
    return locked
  }

  if (word === 'add' || word === 'rm') {
    const piece = cleanPiece(rest)

    if (piece === undefined) {
      return 'A piece is 2 to 80 characters, for example: /kcblock add git push --force'
    }

    if (word === 'add') {
      if (D.block.list.includes(piece)) {
        return `"${piece}" is already on the list.`
      }

      if (D.block.list.length >= MAX_BLOCK) {
        return `The list is full (${MAX_BLOCK}). Remove one with /kcblock rm <piece>.`
      }
      D = { ...D, block: { ...D.block, list: [...D.block.list, piece] } }
    } else {
      if (!D.block.list.includes(piece)) {
        return `"${piece}" is not on the list.`
      }
      D = { ...D, block: { ...D.block, list: D.block.list.filter(p => p !== piece) } }
    }
    await save(d, 'block')
    await record(d, `block list ${word}`, piece)
    await bump(d)

    return `${word === 'add' ? 'Added' : 'Removed'} "${piece}". ${D.block.list.length} piece${D.block.list.length === 1 ? '' : 's'} now.${(await switchOn(d, `${SELF}.block`, false)) ? '' : ' The block switch is off: /kcblock on turns it on (asks you to confirm).'}`
  }

  return 'Usage: /kcblock on|off|add <piece>|rm <piece>|list'
}

const allowCommand = async (d: Dollar, word: string, rest: string): Promise<string> => {
  const key = cwdKey()
  const mine = D.block.allow[key] ?? []

  if (word === '' || word === 'list') {
    const all = Object.entries(D.block.allow)

    return [`Allow-list for this project (${key}): ${mine.length === 0 ? 'empty' : mine.map(p => `"${p}"`).join(', ')}`, `Other projects with an allow-list: ${all.filter(([k]) => k !== key).length}`, 'A command that starts with an allowed prefix is exempt from THIS mod’s block list only, and only when it has no ; & | ` $( or redirect. tool-guard is never affected.'].join('\n')
  }
  const locked = needLock()

  if (locked !== undefined) {
    return locked
  }
  const piece = cleanPiece(rest)

  if ((word !== 'add' && word !== 'rm') || piece === undefined) {
    return 'Usage: /kcallow add <command prefix> | rm <command prefix> | list (2 to 80 characters)'
  }

  if (word === 'add') {
    if (mine.length >= MAX_ALLOW_PREFIXES || (D.block.allow[key] === undefined && Object.keys(D.block.allow).length >= MAX_ALLOW_CWDS)) {
      return 'The allow-list is full. Remove one with /kcallow rm <prefix>.'
    }
    D = { ...D, block: { ...D.block, allow: { ...D.block.allow, [key]: [...new Set([...mine, piece])] } } }
  } else {
    const left = mine.filter(p => p !== piece)
    const allow = { ...D.block.allow }

    if (left.length === 0) {
      delete allow[key]
    } else {
      allow[key] = left
    }
    D = { ...D, block: { ...D.block, allow } }
  }
  await save(d, 'block')
  await record(d, `allow ${word}`, `${key}: ${piece}`)
  await bump(d)

  return `${word === 'add' ? 'Allowed' : 'No longer allowed'} the prefix "${piece}" in ${key}.`
}

const rowsCommand = async (d: Dollar, word: string, rest: string): Promise<string> => {
  const name = rest.split(/\s+/)[0]?.toLowerCase() ?? ''

  if (word === '' || word === 'show') {
    return rowsShow(d)
  }

  if (word === 'keep' || word === 'pin') {
    return request(d, { kind: 'rows-keep', arg: name })
  }

  if (word === 'hide' || word === 'unpin') {
    return request(d, { kind: 'rows-hide', arg: name })
  }

  if (word === 'only' || word === 'collapse') {
    return request(d, { kind: 'rows-only', arg: name === '' ? 'cockpit' : name })
  }

  if (word === 'expand') {
    return request(d, { kind: 'rows-expand' })
  }

  return 'Usage: /kcrows show | keep <mod> | hide <mod> | only <mod> (collapse all but one) | expand'
}

const orderCommand = async (d: Dollar, word: string, names: string[]): Promise<string> => {
  if (word === '' || word === 'show') {
    return `Row order: ${D.order.join(' > ') || '(none)'} · switch ${(await switchOn(d, `${SELF}.reorder`, false)) ? 'ON' : 'off (/cfg feature control-kit.reorder on)'}. Listed rows come first in this order, all other rows follow; no row is ever dropped. Rows drawn now: ${liveRows.join(', ') || '(none seen)'}.`
  }
  const locked = needLock()

  if (locked !== undefined) {
    return locked
  }
  const okName = (n: string | undefined): n is string => n !== undefined && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(n)

  if (word === 'clear') {
    D = { ...D, order: [] }
  } else if (word === 'set') {
    const list = cleanOrder(names)

    if (list.length === 0) {
      return 'Usage: /kcorder set <mod> <mod> ... (first is drawn first)'
    }
    D = { ...D, order: list }
  } else if ((word === 'up' || word === 'down' || word === 'top') && okName(names[0])) {
    D = { ...D, order: moveInOrder(D.order, names[0], word) }
  } else {
    return 'Usage: /kcorder show | set <mods...> | up|down|top <mod> | clear'
  }
  await save(d, 'order')
  await record(d, `order ${word}`, D.order.join(' > ') || 'cleared')
  await bump(d)

  return `Row order: ${D.order.join(' > ') || '(none)'}${(await switchOn(d, `${SELF}.reorder`, false)) ? '' : '. The reorder switch is off, so nothing moves yet: /cfg feature control-kit.reorder on'}`
}

// ------------------------------------------------------------------ the block hook

const blockCheck = async (d: Dollar, command: unknown): Promise<string | undefined> => {
  const ov = await readOverrides(d)

  // An unreadable switch keeps the last state this hook saw, so a read error never quietly switches a block list off.
  if (ov !== null) {
    blockArmed = ov[`${SELF}.block`] ?? false
  }

  if (!blockArmed || typeof command !== 'string') {
    return undefined
  }
  const v = judge(command, D.block, cwd)

  return v.kind === 'blocked' ? `${SELF}: this command contains "${v.by}", which is on your Bash block list. Ask the user (they can test it with /kctest or edit the list with /kcblock).` : undefined
}

// ------------------------------------------------------------------ the pane

const fillBtn = ($: Dollar, U: Elements, key: string, label: string, text: string, hotkey?: string) => (
  <U.Button key={key} label={label} hotkey={hotkey} onPress={() => void fill($, text).then(ok => setNotice($, ok ? `In the prompt box: ${clip(text.split('\n')[0] ?? '', 60)}` : 'The prompt box could not be filled.'))} />
)

const go = (d: Dollar, tab: Tab) => Promise.all([update(d, tabA, () => tab), update(d, pageA, () => 0)])

const PAGE = 8

const lines = (_$: Dollar, U: Elements, list: readonly string[], dim = false) => list.map(l => <U.Text dimColor={dim} mono>{l}</U.Text>)

const pager = ($: Dollar, U: Elements, page: number, pages: number) =>
  pages <= 1 ? null : (
    <U.Box gap="sm">
      <U.Button key="prev" label="< prev" hotkey="p" onPress={() => void update($, pageA, p => Math.max(0, p - 1))} />
      <U.Text dimColor>{`page ${page + 1} of ${pages}`}</U.Text>
      <U.Button key="next" label="next >" hotkey="n" onPress={() => void update($, pageA, p => p + 1)} />
    </U.Box>
  )

type View = { tab: Tab; page: number; query: string; preset: string; probe: string; notice: string; ov: Overrides; now: number; accent: string }

const homeTab = ($: Dollar, U: Elements, v: View) => {
  const active = pending !== null && pendingState(pending, v.now) === 'valid'

  return (
    <U.Box flexDirection="column" gap="sm">
      {lines($, U, (statusLines(v)).split('\n'))}
      <U.Box gap="sm" flexWrap="wrap">
        <U.Button key="panic" label="Panic: quiet now" hotkey="p" onPress={() => void handle($, 'kcpanic', '', { kind: 'composer' }).then(t => setNotice($, t.split('\n')[0] ?? ''))} />
        {fillBtn($, U, 'off', 'Quiet (preview)', '/kcoff', 'o')}
        {fillBtn($, U, 'on', 'Restore (preview)', '/kcon', 'r')}
        {fillBtn($, U, 'undo', 'Undo last', '/kcundo', 'u')}
        {fillBtn($, U, 'lock', isLocked() ? 'Unlock' : 'Lock', isLocked() ? '/kclock off' : '/kclock on', 'l')}
        {active ? <U.Button key="confirm" label="Confirm pending" hotkey="c" onPress={() => void confirmPending($, { kind: 'composer' }, true).then(t => setNotice($, t.split('\n')[0] ?? ''))} /> : null}
        {active ? <U.Button key="cancel" label="Cancel pending" hotkey="x" onPress={() => void handle($, 'kcdo', 'cancel', { kind: 'composer' }).then(t => setNotice($, t))} /> : null}
      </U.Box>
      <U.Text dimColor>The panic button runs at once (it only changes switches and rows, and /kcon puts them back). Every other button fills the prompt or only confirms a plan you already previewed.</U.Text>
    </U.Box>
  )
}

const statusLines = (v: View): string =>
  [
    `Lock: ${isLocked() ? 'ON (this mod refuses changes)' : 'off'}`,
    `Quiet mode: ${D.snap === null ? 'not active' : `ON since ${fmtTime(D.snap.at)} (${D.snap.src}); restore point holds ${Object.keys(D.snap.before).length} override(s)`}`,
    `Pending confirm: ${pending !== null && pendingState(pending, v.now) === 'valid' ? `${pending.label}, ${secondsLeft(pending, v.now)} s left` : 'none'}`,
    `Timed pauses: ${D.holds.length === 0 ? 'none' : [...new Set(D.holds.map(h => h.id.split('.')[0]))].join(', ')}`,
    `Block list: ${D.block.list.length} piece(s) · rows order: ${D.order.length} · changes logged: ${D.changes.length}/30`,
  ].join('\n')

const presetsTab = ($: Dollar, U: Elements, v: View) => {
  const index = buildIndex(TABLE)
  const chosen = isPreset(v.preset) ? v.preset : 'off'
  const built = buildPlan({ kind: chosen }, { table: TABLE, ov: v.ov, tidy: null, snap: D.snap, holds: D.holds, changes: D.changes, dismissed: D.dismissed, rowsBefore: D.rowsBefore, now: v.now, cwd })
  const keys = pickKeys(PRESET_KINDS.length, ['n', 'p', 's', 'c', 'x'])
  const plan = built.ok ? built.plan : null
  const flips = plan?.flips ?? []
  const pg = pageOf(flips, v.page, 10)
  const active = pending !== null && pendingState(pending, v.now) === 'valid'

  return (
    <U.Box flexDirection="column" gap="sm">
      <U.Box gap="sm" flexWrap="wrap">
        {PRESET_KINDS.map((k, i) => (
          <U.Button key={`pre-${k}`} label={k === chosen ? `[${k}]` : k} hotkey={keys[i]} onPress={() => void Promise.all([update($, presetA, () => k), update($, pageA, () => 0)])} />
        ))}
      </U.Box>
      {built.ok ? (
        <U.Box flexDirection="column">
          <U.Text weight="bold">{built.plan.label}</U.Text>
          <U.Text dimColor>{`${flips.length} switch${flips.length === 1 ? '' : 'es'} would flip (dry run: nothing is changed by looking). The row filter is not read in this view.`}</U.Text>
          {lines($, U, pg.rows.map(f => flipLine(index, f)))}
          {flips.length === 0 ? <U.Text dimColor>None.</U.Text> : null}
          {lines($, U, built.plan.lines, true)}
        </U.Box>
      ) : (
        <U.Text color="warning">{built.message}</U.Text>
      )}
      {pager($, U, pg.page, pg.pages)}
      <U.Box gap="sm">
        {fillBtn($, U, 'stage', 'Preview in chat', `/kcdo ${chosen}`, 's')}
        {active ? <U.Button key="confirm" label="Confirm pending" hotkey="c" onPress={() => void confirmPending($, { kind: 'composer' }, true).then(t => setNotice($, t.split('\n')[0] ?? ''))} /> : null}
        {active ? <U.Button key="cancel" label="Cancel pending" hotkey="x" onPress={() => void handle($, 'kcdo', 'cancel', { kind: 'composer' }).then(t => setNotice($, t))} /> : null}
      </U.Box>
    </U.Box>
  )
}

const timersTab = ($: Dollar, U: Elements, v: View) => {
  const mods = [...new Set(D.holds.map(h => h.id.split('.')[0] ?? ''))]
  const pg = pageOf(mods, v.page, PAGE)
  const keys = pickKeys(PAGE, ['n', 'p', 'a', 'z', 'd'])

  return (
    <U.Box flexDirection="column" gap="sm">
      <U.Text dimColor>Pause = a mod's four switches off for a while; snooze = only pop-ups and sounds. They are put back by a timer (and again at the next start).</U.Text>
      {mods.length === 0 ? <U.Text>Nothing is paused or snoozed.</U.Text> : null}
      {pg.rows.map((m, i) => (
        <U.Box key={`hold-${m}`} gap="sm">
          <U.Text mono>{holdLines(v.now).find(l => l.startsWith(`${m}:`)) ?? m}</U.Text>
          {fillBtn($, U, `end-${m}`, 'End now', `/kcpause ${m} off`, keys[i])}
        </U.Box>
      ))}
      {pager($, U, pg.page, pg.pages)}
      <U.Box gap="sm">
        {fillBtn($, U, 'pause', 'Pause a mod', '/kcpause ', 'a')}
        {fillBtn($, U, 'snooze', 'Snooze a mod', '/kcsnooze ', 'z')}
        {fillBtn($, U, 'dismiss', 'Dismiss pop-ups', '/kcdismiss ', 'd')}
      </U.Box>
    </U.Box>
  )
}

const paletteTab = ($: Dollar, U: Elements, v: View) => {
  const rows = paletteRows(TABLE, v.query)
  const pg = pageOf(rows, v.page, PAGE)
  const keys = pickKeys(PAGE, ['n', 'p'])

  return (
    <U.Box flexDirection="column" gap="sm">
      <U.Input key="q" label="search" placeholder="a command or words" value={v.query} submitLabel="filter" onInput={(t: string) => void Promise.all([update($, queryA, () => t.slice(0, 40)), update($, pageA, () => 0)])} onSubmit={(t: string) => void update($, queryA, () => t.trim().slice(0, 40))} />
      <U.Text dimColor>{`${rows.length} command${rows.length === 1 ? '' : 's'} from ${TABLE.length} mods (build-time table, ${TABLE_DATE}). A button puts the command in the prompt; it is not sent.`}</U.Text>
      {pg.rows.map((r, i) => (
        <U.Box key={`pal-${r.n}`} gap="sm">
          {fillBtn($, U, `pal-${r.n}`, `/${r.n}`, `/${r.n} `, keys[i])}
          <U.Text dimColor>{clip(`${r.d} [${r.mod}]`, 90)}</U.Text>
        </U.Box>
      ))}
      {pager($, U, pg.page, pg.pages)}
    </U.Box>
  )
}

const permsTab = ($: Dollar, U: Elements, v: View) => {
  const pg = pageOf(TABLE, v.page, PAGE)
  const keys = pickKeys(PAGE, ['n', 'p'])

  return (
    <U.Box flexDirection="column" gap="sm">
      <U.Text dimColor>{`What each mod's code touches, from claude plugin validate (${TABLE_DATE}). Turning one off for good is a line a person runs: the button only fills it in.`}</U.Text>
      {pg.rows.map((m, i) => (
        <U.Box key={`perm-${m.name}`} gap="sm">
          <U.Text mono>{clip(`${m.name}${m.guard ? ' (guard)' : ''}: ${permFlags(m)}`, 80)}</U.Text>
          {fillBtn($, U, `dis-${m.name}`, 'disable line', disableLine(m.name), keys[i])}
        </U.Box>
      ))}
      {pager($, U, pg.page, pg.pages)}
    </U.Box>
  )
}

const networkTab = ($: Dollar, U: Elements, v: View) => {
  const list = networkMods(TABLE)
  const pg = pageOf(list, v.page, PAGE)
  const keys = pickKeys(PAGE, ['n', 'p'])

  return (
    <U.Box flexDirection="column" gap="sm">
      <U.Text color="warning">There is no network on/off switch for mods. This tab only shows who uses the network.</U.Text>
      <U.Text dimColor>{`${list.length} of ${TABLE.length} mods use $.http or $.mcp, or watch the WebFetch tool (${TABLE_DATE}).`}</U.Text>
      {pg.rows.map((m, i) => (
        <U.Box key={`net-${m.name}`} gap="sm">
          <U.Text mono>{clip(`${m.name}: ${m.uses.network ? '$.http/$.mcp' : ''}${m.uses.network && m.uses.webfetch ? ' + ' : ''}${m.uses.webfetch ? 'watches WebFetch' : ''}`, 70)}</U.Text>
          {fillBtn($, U, `dis-${m.name}`, 'disable line', disableLine(m.name), keys[i])}
        </U.Box>
      ))}
      {pager($, U, pg.page, pg.pages)}
    </U.Box>
  )
}

const changesTab = ($: Dollar, U: Elements, v: View) => {
  const rows = [...D.changes].reverse()
  const pg = pageOf(rows, v.page, PAGE)
  const index = buildIndex(TABLE)

  return (
    <U.Box flexDirection="column" gap="sm">
      <U.Text dimColor>The last 30 switch changes this mod made. /kcundo undoes the newest; a big one asks you to confirm first.</U.Text>
      {rows.length === 0 ? <U.Text>No change yet.</U.Text> : null}
      {lines($, U, pg.rows.map(c => `${fmtTime(c.at)}  ${clip(c.label, 50)}  (${c.flips.length} switch${c.flips.length === 1 ? '' : 'es'}${c.flips.length === 1 && c.flips[0] !== undefined ? `: ${flipLine(index, c.flips[0])}` : ''})`))}
      {pager($, U, pg.page, pg.pages)}
      {fillBtn($, U, 'undo', 'Undo newest', '/kcundo', 'u')}
    </U.Box>
  )
}

const logTab = ($: Dollar, U: Elements, v: View) => {
  const rows = [...D.audit].reverse()
  const pg = pageOf(rows, v.page, 12)

  return (
    <U.Box flexDirection="column" gap="sm">
      <U.Text dimColor>Everything this mod did, newest first (bounded to 200). /kcreset clears it.</U.Text>
      {rows.length === 0 ? <U.Text>Nothing yet.</U.Text> : null}
      {lines($, U, pg.rows.map(a => clip(`${fmtTime(a.at)}  ${a.what}: ${a.result}`, 110)))}
      {pager($, U, pg.page, pg.pages)}
    </U.Box>
  )
}

const blockTab = ($: Dollar, U: Elements, v: View) => {
  const verdict = v.probe === '' ? undefined : judge(v.probe, D.block, cwd)
  const isOn = v.ov[`${SELF}.block`] ?? false
  const mine = D.block.allow[cwdKey()] ?? []

  return (
    <U.Box flexDirection="column" gap="sm">
      <U.Text>{`Bash block list: switch ${isOn ? 'ON' : 'off'} · ${D.block.list.length} piece(s) · allow-list for ${cwdKey()}: ${mine.length}`}</U.Text>
      {lines($, U, D.block.list.slice(0, 10).map(p => `block: "${p}"`), true)}
      <U.Input key="probe" label="test" placeholder="type a command to test it (it is not run)" value={v.probe} submitLabel="test" onInput={(t: string) => void update($, probeA, () => t.slice(0, 200))} onSubmit={(t: string) => void update($, probeA, () => t.trim().slice(0, 200))} />
      {verdict !== undefined ? <U.Text>{verdictText(verdict, isOn)}</U.Text> : null}
      <U.Box gap="sm" flexWrap="wrap">
        {fillBtn($, U, 'add', 'Add a piece', '/kcblock add ', 'a')}
        {fillBtn($, U, 'rm', 'Remove a piece', '/kcblock rm ', 'r')}
        {fillBtn($, U, 'allow', 'Allow a prefix here', '/kcallow add ', 'l')}
        {fillBtn($, U, isOn ? 'off' : 'on', isOn ? 'Switch off' : 'Switch on', isOn ? '/kcblock off' : '/kcblock on', 'o')}
      </U.Box>
      <U.Text dimColor>The list is this mod's own: it never overrides tool-guard, and starts empty.</U.Text>
    </U.Box>
  )
}

const rowsTab = ($: Dollar, U: Elements) => (
  <U.Box flexDirection="column" gap="sm">
    <U.Text>{`Rows seen above the prompt: ${liveRows.join(', ') || '(none yet)'}`}</U.Text>
    <U.Text>{`Saved order: ${D.order.join(' > ') || '(none)'} · reorder switch: use /kcorder show`}</U.Text>
    <U.Text dimColor>Collapse and pin go through /tidy; the order is applied by this mod's own hook when the reorder switch is on. No row is ever dropped.</U.Text>
    <U.Box gap="sm" flexWrap="wrap">
      {fillBtn($, U, 'only', 'Collapse all but cockpit', '/kcrows only cockpit', 'c')}
      {fillBtn($, U, 'expand', 'Expand rows', '/kcrows expand', 'e')}
      {fillBtn($, U, 'keep', 'Pin a row', '/kcrows keep ', 'k')}
      {fillBtn($, U, 'hide', 'Hide a row', '/kcrows hide ', 'h')}
      {fillBtn($, U, 'orderset', 'Set the order', `/kcorder set ${liveRows.join(' ')}`, 's')}
      {fillBtn($, U, 'orderclear', 'Clear the order', '/kcorder clear', 'x')}
    </U.Box>
  </U.Box>
)

const renderPane = async ($: Dollar, e: RenderEvent) => {
  const U = $.ui.resolve(e)
  const tab = (await read($, tabA)) as Tab
  const view: View = {
    tab,
    page: await read($, pageA),
    query: await read($, queryA),
    preset: await read($, presetA),
    probe: await read($, probeA),
    notice: await read($, noticeA),
    ov: (await readOverrides($)) ?? {},
    now: await nowOf($),
    accent: await read($, accentA),
  }
  await read($, revA)
  const density = await read($, densityA)
  const gap = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
  const body =
    tab === 'presets'
      ? presetsTab($, U, view)
      : tab === 'timers'
        ? timersTab($, U, view)
        : tab === 'palette'
          ? paletteTab($, U, view)
          : tab === 'perms'
            ? permsTab($, U, view)
            : tab === 'network'
              ? networkTab($, U, view)
              : tab === 'changes'
                ? changesTab($, U, view)
                : tab === 'log'
                  ? logTab($, U, view)
                  : tab === 'block'
                    ? blockTab($, U, view)
                    : tab === 'rows'
                      ? rowsTab($, U)
                      : homeTab($, U, view)

  return (
    <U.Box flexDirection="column" padding={gap} gap={gap}>
      <U.Text size="heading" weight="bold">
        Control kit
      </U.Text>
      <U.Box gap="sm" flexWrap="wrap">
        {TAB_ORDER.map(t => (
          <U.Button key={`tab-${t}`} label={t === tab ? `[${TAB_LABELS[t]}]` : (TAB_LABELS[t] ?? t)} hotkey={TAB_KEYS[t]} onPress={() => void go($, t)} />
        ))}
      </U.Box>
      {view.notice !== '' ? <U.Text color={view.accent as 'suggestion'}>{view.notice}</U.Text> : null}
      {body}
    </U.Box>
  )
}

// ------------------------------------------------------------------ rows above the prompt

const bandRow = async ($: Dollar, e: Parameters<Hook<'ui.render'>>[1], inner: unknown) => {
  const U = $.ui.resolve(e)
  const parts: string[] = []

  if (D.snap !== null) {
    parts.push(`quiet mode on since ${fmtTime(D.snap.at)} (/kcon restores)`)
  }

  if (D.holds.length > 0) {
    parts.push(`paused: ${[...new Set(D.holds.map(h => h.id.split('.')[0]))].slice(0, 3).join(', ')}`)
  }

  return (
    <U.Box flexDirection="column">
      {inner as never}
      <U.Text dimColor>{`control-kit: ${parts.join(' · ')}`}</U.Text>
    </U.Box>
  )
}

// ------------------------------------------------------------------ registration

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await load($)
    cwd = cleanCwd(typeof e.cwd === 'string' ? e.cwd : '/') ?? '/'

    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await armTimer($)

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({
      text: await handle($, name, e.args, e.origin).catch(() => `/${name} hit an unexpected error. Nothing more was run.`),
    }))
  }

  // Bash block list: this mod's own, off by default, empty by default. Fail closed, but only while it is armed with a non-empty list,
  // so a bug can never lock Bash for someone who never opted in.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const why = await blockCheck($, e.command)

    return why === undefined ? next(e) : { deny: why }
  }).catch(($, e, next) => (next.called ? next(e) : blockArmed && D.block.list.length > 0 ? { deny: `${SELF}: its block-list check failed, so the command was held back.` } : next(e)))

  // Row order: behind its switch; never drops a row; never touches a survey.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    liveRows = e.props.rows.map(r => (r.plugin.split('@')[0] ?? '').toLowerCase()).slice(0, 30)

    if (e.props.hasSurvey || D.order.length === 0 || !(await switchOn($, `${SELF}.reorder`, false))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, rows: applyOrder(e.props.rows, D.order) } })
  }).catch(($, e, next) => next(e))

  // One quiet row, only while a restore point or a pause exists and its switch is on.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    await read($, revA)

    if (e.props.hasSurvey || (D.snap === null && D.holds.length === 0) || !(await switchOn($, `${SELF}.band-state`, false))) {
      return inner
    }

    return bandRow($, e, inner)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => renderPane($, e))
}
