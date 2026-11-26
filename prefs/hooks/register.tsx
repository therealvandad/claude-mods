import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register, Timer } from 'claude-code'

import type { Meta, Over, Pending, Tab, Target, Val, View } from '../types'
import { ctxFrom, displayPath, formatDateTime, relativeTime, truncate } from './format'
import { tabLabel, tr } from './i18n'
import type { Lang } from './i18n'
import {
  COMMANDS,
  GLOBAL_ONLY,
  PANE_COLUMNS,
  applyProfile,
  branchKey,
  describeSpec,
  diffText,
  effectiveOver,
  exportText,
  findProfile,
  hmText,
  helpText,
  isBranchText,
  isBuiltinProfile,
  isScopeText,
  layerOver,
  levelPolicy,
  makeEntry,
  matchesProfile,
  MAX_PROFILES,
  paginate,
  parseHM,
  parseImport,
  planSet,
  planValue,
  previewLines,
  profileNames,
  PROFILE_NAME_RE,
  pushHistory,
  rowPreview,
  sanitizeAuto,
  sanitizeHistory,
  sanitizeLayers,
  sanitizeMeta,
  sanitizeProfiles,
  searchLines,
  slotFor,
  slotId,
  splitLocale,
  splitWord,
  sourceOf,
  undoEntries,
  withLayer,
  withoutSlot,
  withSlot,
} from './logic'
import type { Layer, LayerFlags, Slot } from './logic'
import { MODS } from './modlist'
import { PREFS, acceptText, diffOver, nearKeys, nudge, prefsInGroup, sanitizeOverrides, searchPrefs, sectionsOf, showValue, specFor, valueOf } from './prefs'
import type { Change, PrefSpec } from './prefs'
import { chartAlt, chartSvg, chartText } from './svg'
import type { Accent, ChartType, Legend } from './svg'
import { GROUPS } from './table'
import type { Group } from './table'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'prefs-main'
export const TABS: readonly Tab[] = ['general', 'formats', 'interface', 'notices', 'charts', 'data', 'mods', 'profiles', 'projects', 'history']
const AUTO_MS = 30 * 60_000
const PENDING_MS = 5 * 60_000
const TOAST_GAP_MS = 3 * 60_000
/** Mods whose switches cannot be changed (the settings mod refuses them): shown as "always on". */
const LOCKED = ['tool-guard', 'safety-pro', 'controls', 'settings']
/** The only process this mod ever runs: a read-only question to git. */
const GIT_BRANCH_ARGV = ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] as const

const STORE = { base: 'pf.base', layers: 'pf.layers', history: 'pf.history', profiles: 'pf.profiles', auto: 'pf.auto', meta: 'pf.meta' } as const

// ------------------------------------------------------------------ state

const EMPTY_VIEW: View = { tab: 'general', section: 'all', page: 0, query: '', target: 'base', selected: '', notice: '', name: '' }

/** The one atom other mods read. Overrides only: an absent key means the preference's default. */
const prefsA = atom({ plugin: 'prefs', key: 'prefs' } as const, {}, { shape: 'prefs-1' })
const baseA = atom({ plugin: 'prefs', key: 'base' } as const, {}, { shape: 'base-1' })
const layersA = atom({ plugin: 'prefs', key: 'layers' } as const, { projects: {}, branches: {} }, { shape: 'layers-1' })
const historyA = atom({ plugin: 'prefs', key: 'history' } as const, [], { shape: 'history-1' })
const profilesA = atom({ plugin: 'prefs', key: 'profiles' } as const, {}, { shape: 'profiles-1' })
const autoA = atom({ plugin: 'prefs', key: 'auto' } as const, { on: false, schedule: [], last: '' }, { shape: 'auto-1' })
const metaA = atom({ plugin: 'prefs', key: 'meta' } as const, { applied: '', lastTab: '' }, { shape: 'meta-1' })
const whereA = atom({ plugin: 'prefs', key: 'where' } as const, { cwd: '', branch: '' }, { shape: 'where-1' })
const viewA = atom({ plugin: 'prefs', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-1' })
const pendingA = atom({ plugin: 'prefs', key: 'pending' } as const, null, { shape: 'pending-1' })

// Foreign atoms from the `settings` mod: read only, with defaults when it never wrote them.
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })

// Session memory only: the schedule timer and the time of the last toast.
let autoTimer: Timer | undefined
let lastToastAt = -Infinity

// ------------------------------------------------------------------ small helpers

const isOn = async ($: Dollar, id: string, dflt: boolean): Promise<boolean> => {
  const o = (await read($, featuresA)) as Record<string, boolean>

  return o[`prefs.${id}`] ?? dflt
}

const nowOf = ($: Dollar): Promise<number> => $.clock.now().catch(() => 0)

const save = ($: Dollar, key: string, value: unknown) => $.store.set(key, value).catch(() => undefined)

const setView = ($: Dollar, patch: Partial<View>) => update($, viewA, v => ({ ...v, ...patch }))

const notice = ($: Dollar, text: string) => setView($, { notice: text.split('\n')[0]?.slice(0, 200) ?? '' })

/** Only a person typing confirms: not a plugin, a schedule or a peer session. */
export const isPersonOrigin = (origin: unknown): boolean => {
  const kind = typeof origin === 'object' && origin !== null ? (origin as { kind?: unknown }).kind : undefined

  return kind === 'composer' || kind === 'bridge' || kind === 'unclassified'
}

const flagsOf = async ($: Dollar): Promise<LayerFlags> => ({ project: await isOn($, 'project-overrides', true), branch: await isOn($, 'branch-overrides', false) })

/** Recompute what other mods read from the global overrides and the layers. */
const recompute = async ($: Dollar) => {
  const base = await read($, baseA)
  const layers = await read($, layersA)
  const where = await read($, whereA)
  const eff = effectiveOver(base, layers, where.cwd, where.branch, await flagsOf($))
  await update($, prefsA, () => eff)
}

const langOf = async ($: Dollar): Promise<Lang> => {
  const l = valueOf(await read($, prefsA), 'lang')

  return l === 'es' || l === 'de' ? l : 'en'
}

// ------------------------------------------------------------------ loading

const readBranch = async ($: Dollar, cwd: string): Promise<string> => {
  if (cwd === '' || !(await isOn($, 'branch-overrides', false))) {
    return ''
  }
  const r = await $.process.run([...GIT_BRANCH_ARGV], { cwd, timeoutMs: 3000 }).catch(() => undefined)
  const out = r !== undefined && r.exitCode === 0 ? r.stdout.trim() : ''

  return isBranchText(out) ? out : ''
}

const load = async ($: Dollar, cwd: string) => {
  const get = (key: string) => $.store.get(key).catch(() => undefined)
  const [b, l, h, p, a, m] = await Promise.all([get(STORE.base), get(STORE.layers), get(STORE.history), get(STORE.profiles), get(STORE.auto), get(STORE.meta)])
  await update($, baseA, () => sanitizeOverrides(b))
  await update($, layersA, () => sanitizeLayers(l))
  await update($, historyA, () => sanitizeHistory(h))
  await update($, profilesA, () => sanitizeProfiles(p))
  await update($, autoA, () => sanitizeAuto(a))
  await update($, metaA, () => sanitizeMeta(m, TABS))
  const folder = isScopeText(cwd) ? cwd : ''
  await update($, whereA, () => ({ cwd: folder, branch: '' }))
  const branch = valueOf(sanitizeOverrides(b), 'sync.mode') === 'per-project' ? await readBranch($, folder) : ''
  await update($, whereA, () => ({ cwd: folder, branch }))
  await recompute($)
}

// ------------------------------------------------------------------ changing values

type LayerRef = { over: Over; scope: string }

const layerRef = async ($: Dollar, layer: Layer): Promise<LayerRef | string> => {
  const base = await read($, baseA)
  const where = await read($, whereA)
  const layers = await read($, layersA)

  if (layer === 'base') {
    return { over: base, scope: 'base' }
  }

  if (where.cwd === '') {
    return 'No project folder is known for this session.'
  }

  if (layer === 'project') {
    return { over: layerOver(layers, 'project', where.cwd), scope: where.cwd }
  }

  return where.branch === ''
    ? 'No git branch is known: switch prefs.branch-overrides on (/cfg feature prefs.branch-overrides on), then /pfproject refresh.'
    : { over: layerOver(layers, 'branch', branchKey(where.cwd, where.branch)), scope: branchKey(where.cwd, where.branch) }
}

/** Write one layer's new overrides, record the change in the history (when that switch is on) and recompute. */
const commit = async ($: Dollar, layer: Layer, scope: string, next: Over, changes: Change[], label: string) => {
  if (changes.length === 0) {
    return
  }

  if (layer === 'base') {
    await update($, baseA, () => next)
    await save($, STORE.base, next)
  } else {
    const layers = withLayer(await read($, layersA), layer, scope, next)
    await update($, layersA, () => layers)
    await save($, STORE.layers, layers)
  }

  if (await isOn($, 'history', true)) {
    const history = pushHistory(await read($, historyA), makeEntry(await nowOf($), label, layer, scope, changes))
    await update($, historyA, () => history)
    await save($, STORE.history, history)
  }
  await recompute($)
}

const layerNote = async ($: Dollar, layer: Layer): Promise<string> => {
  if (layer === 'base') {
    return ''
  }
  const base = await read($, baseA)

  return valueOf(base, 'sync.mode') === 'per-project' ? '' : ' (stored, but not in force: the scope is "synced"; /pfset sync.mode per-project turns layers on)'
}

const setOne = async ($: Dollar, layer: Layer, spec: PrefSpec, plan: ReturnType<typeof planValue>, ref: LayerRef): Promise<string> => {
  if (!plan.ok) {
    return plan.message
  }

  if (plan.changes.length === 0) {
    return `${spec.key} is already ${showValue(spec, valueOf(plan.next, spec.key))}.`
  }
  await commit($, layer, ref.scope, plan.next, plan.changes, `set ${spec.key}`)
  const eff = await read($, prefsA)

  return [
    `${spec.key} = ${showValue(spec, valueOf(plan.next, spec.key))}${layer === 'base' ? (plan.next[spec.key] === undefined ? ' (the default)' : '') : ` in the ${layer} layer`}${await layerNote($, layer)}.`,
    ...plan.notes,
    layer === 'base' && eff[spec.key] !== plan.next[spec.key] ? 'A project or branch layer overrides it in this project.' : '',
  ]
    .filter(t => t !== '')
    .join(' ')
}

/** /pfset and /pfproject set: text in, one message out. */
const setFromText = async ($: Dollar, layer: Layer, key: string, raw: string): Promise<string> => {
  const k = key.trim().toLowerCase()
  const spec = specFor(k)

  if (spec === undefined) {
    const miss = planSet({}, k, raw)

    return miss.ok ? `No preference named "${k.slice(0, 40)}".` : miss.message
  }

  if (layer !== 'base' && GLOBAL_ONLY.includes(spec.key)) {
    return `${spec.key} can only be set globally (/pfset): the scope itself cannot depend on a layer.`
  }
  const ref = await layerRef($, layer)

  if (typeof ref === 'string') {
    return ref
  }

  return setOne($, layer, spec, planSet(ref.over, k, raw, layer !== 'base'), ref)
}

/** A pane press: a typed value for the layer the pane edits. */
const setTyped = async ($: Dollar, spec: PrefSpec, value: Val) => {
  // The scope decision is always global, whatever the pane is editing.
  const layer: Layer = GLOBAL_ONLY.includes(spec.key) ? 'base' : (await read($, viewA)).target
  const r = await layerRef($, layer)

  if (typeof r === 'string') {
    return notice($, r)
  }

  return notice($, await setOne($, layer, spec, planValue(r.over, spec, value, layer !== 'base'), r))
}

const unsetKey = async ($: Dollar, layer: Layer, spec: PrefSpec): Promise<string> => {
  const ref = await layerRef($, layer)

  if (typeof ref === 'string') {
    return ref
  }

  if (!Object.prototype.hasOwnProperty.call(ref.over, spec.key)) {
    return layer === 'base' ? `${spec.key} is already at its default.` : `${spec.key} is not set in the ${layer} layer.`
  }
  const next = { ...ref.over }
  delete next[spec.key]
  await commit($, layer, ref.scope, next, diffOver(ref.over, next), `reset ${spec.key}`)

  return layer === 'base' ? `${spec.key} is back to its default (${showValue(spec, spec.default)}).` : `${spec.key} removed from the ${layer} layer.`
}

const resetFromPane = async ($: Dollar, spec: PrefSpec) => notice($, await unsetKey($, (await read($, viewA)).target, spec))

const clearLayer = async ($: Dollar, layer: Layer): Promise<string> => {
  const ref = await layerRef($, layer)

  if (typeof ref === 'string') {
    return ref
  }
  const next: Over = {}
  const changes = diffOver(ref.over, next)

  if (changes.length === 0) {
    return layer === 'base' ? 'Nothing to reset: every preference is at its default.' : `The ${layer} layer is already empty.`
  }
  await commit($, layer, ref.scope, next, changes, layer === 'base' ? 'reset all' : `clear ${layer} layer`)

  return layer === 'base' ? `All ${changes.length} changed preferences are back to their defaults. /pfundo brings them back.` : `The ${layer} layer is cleared (${changes.length} values). /pfundo brings them back.`
}

// ------------------------------------------------------------------ commands

const getCommand = async ($: Dollar, args: string): Promise<string> => {
  const a = args.trim()
  const eff = await read($, prefsA)

  if (a === '') {
    const keys = Object.keys(eff).sort()
    const where = await read($, whereA)
    const base = await read($, baseA)
    const layers = await read($, layersA)
    const flags = await flagsOf($)

    return [
      `${PREFS.length} preferences listed, ${keys.length} changed from default (what other mods read; scope: ${String(valueOf(base, 'sync.mode'))}).`,
      ...keys.slice(0, 25).map(k => {
        const s = specFor(k)!
        const src = sourceOf(k, base, layers, where.cwd, where.branch, flags)

        return `  ${k} = ${showValue(s, valueOf(eff, k))}  (default ${showValue(s, s.default)}${src === 'base' ? '' : `; from the ${src} layer`})`
      }),
      keys.length > 25 ? `  ...and ${keys.length - 25} more` : '',
      'Show one: /pfget <key>. Search: /pfget <words>. Change: /pfset <key> <value>.',
    ]
      .filter(l => l !== '')
      .join('\n')
  }
  const spec = specFor(a.toLowerCase())

  if (spec !== undefined) {
    const where = await read($, whereA)
    const src = sourceOf(spec.key, await read($, baseA), await read($, layersA), where.cwd, where.branch, await flagsOf($))
    const ctxLine = rowPreview(spec.key, eff, await nowOf($))

    return [...describeSpec(spec, eff), `  decided by: ${src}`, ctxLine === undefined ? '' : `  preview: ${ctxLine}`].filter(l => l !== '').join('\n')
  }

  if (/^[a-z0-9.-]+$/i.test(a) && a.includes('.') && searchPrefs(a).length === 0) {
    const near = nearKeys(a)

    return `No preference named "${a.slice(0, 40)}".${near.length > 0 ? ` Closest: ${near.join(', ')}.` : ''}`
  }
  const lines = searchLines(a, eff)

  return lines.join('\n')
}

const resetCommand = async ($: Dollar, args: string): Promise<string> => {
  const a = args.trim().toLowerCase()

  if (a === '') {
    return clearLayer($, 'base')
  }

  if (a === 'history') {
    await update($, historyA, () => [])
    await save($, STORE.history, [])

    return 'The change history is cleared (so /pfundo has nothing to undo).'
  }

  if (a === 'everything' || a.startsWith('everything ')) {
    if (a !== 'everything confirm') {
      return 'This clears ALL prefs data: every value, the project and branch layers, the history, your profiles and the schedule. It cannot be undone. Type /pfreset everything confirm to do it.'
    }
    await update($, baseA, () => ({}))
    await update($, layersA, () => ({ projects: {}, branches: {} }))
    await update($, historyA, () => [])
    await update($, profilesA, () => ({}))
    await update($, autoA, () => ({ on: false, schedule: [], last: '' }))
    await update($, metaA, () => ({ applied: '', lastTab: '' }))
    await update($, pendingA, () => null)
    autoTimer?.cancel()
    autoTimer = undefined

    for (const key of Object.values(STORE)) {
      await $.store.delete(key).catch(() => undefined)
    }
    await recompute($)

    return 'Everything prefs recorded is cleared: values, layers, history, profiles, schedule. Defaults are in force.'
  }
  const spec = specFor(a)

  return spec === undefined ? `No preference named "${a.slice(0, 40)}". /pfreset alone resets all of them.` : unsetKey($, 'base', spec)
}

const exportCommand = async ($: Dollar): Promise<string> => {
  const base = await read($, baseA)
  const n = Object.keys(base).length

  return [
    `Your global preferences (${n} changed). Copy the block; /pfimport <json> on another machine checks it and shows a diff first. Nothing was written to a file.`,
    '```json',
    exportText(base),
    '```',
  ].join('\n')
}

const importCommand = async ($: Dollar, args: string, origin: unknown): Promise<string> => {
  const a = args.trim()
  const word = a.toLowerCase()

  if (word === 'cancel') {
    await update($, pendingA, () => null)

    return 'Import cancelled.'
  }

  if (word === 'confirm') {
    if (!isPersonOrigin(origin)) {
      return 'Refused: /pfimport confirm must be typed by you.'
    }
    const pending = await read($, pendingA)
    const now = await nowOf($)

    if (pending === null) {
      return 'Nothing waiting. Paste JSON with /pfimport <json> first.'
    }

    if (now - pending.at > PENDING_MS) {
      await update($, pendingA, () => null)

      return 'That import waited more than 5 minutes and expired. Run /pfimport <json> again.'
    }
    const base = await read($, baseA)
    const changes = diffOver(base, pending.over)
    await update($, pendingA, () => null)

    if (changes.length === 0) {
      return 'Nothing to change: your preferences already match.'
    }
    await commit($, 'base', 'base', pending.over, changes, 'import')

    return `Imported: ${changes.length} ${changes.length === 1 ? 'change' : 'changes'} applied. /pfundo reverts them.`
  }
  const result = parseImport(a)

  if (!result.ok) {
    return ['Not imported:', ...result.errors.map(e => `  ${e}`), 'Expected the block from /pfexport.'].join('\n')
  }
  const base = await read($, baseA)
  const changes = diffOver(base, result.over)

  if (changes.length === 0) {
    await update($, pendingA, () => null)

    return 'Valid, but it changes nothing: your preferences already match.'
  }
  const lines = diffText(changes)
  const pending: Pending = { at: await nowOf($), over: result.over, lines }
  await update($, pendingA, () => pending)
  const resets = changes.filter(c => c.after === null).length

  return [
    `Valid. Applying would change ${changes.length} ${changes.length === 1 ? 'preference' : 'preferences'} (${resets} go back to default, because the import replaces your global set):`,
    ...lines,
    'Nothing is changed yet. Type /pfimport confirm within 5 minutes to apply (undo with /pfundo), or /pfimport cancel.',
  ].join('\n')
}

const undoCommand = async ($: Dollar, args: string): Promise<string> => {
  const history = await read($, historyA)
  const a = args.trim().toLowerCase()
  const now = await nowOf($)

  if (a === 'list') {
    return history.length === 0
      ? 'No changes recorded (history keeps the last 30, and is off if the prefs.history switch is off).'
      : [`Last ${history.length} changes, newest first:`, ...[...history].reverse().map((e, i) => `  ${i + 1}. ${relativeTime(e.at, now)}: ${e.label} (${e.layer}, ${e.changes.length})`)].join('\n')
  }
  const n = a === '' ? 1 : /^\d{1,2}$/.test(a) ? Number(a) : 0

  if (n < 1) {
    return 'Usage: /pfundo | /pfundo <n> (1 to 30) | /pfundo list'
  }

  if (history.length === 0) {
    return 'Nothing to undo: no changes recorded.'
  }
  const out = undoEntries(await read($, baseA), await read($, layersA), history, n)
  await update($, baseA, () => out.base)
  await update($, layersA, () => out.layers)
  await update($, historyA, () => out.history)
  await save($, STORE.base, out.base)
  await save($, STORE.layers, out.layers)
  await save($, STORE.history, out.history)
  await recompute($)

  return [`Undid ${out.undone.length} ${out.undone.length === 1 ? 'change' : 'changes'}:`, ...out.undone.map(e => `  ${e.label} (${e.layer}, ${e.changes.length} ${e.changes.length === 1 ? 'value' : 'values'})`), `${out.history.length} left to undo.`].join('\n')
}

const projectShow = async ($: Dollar): Promise<string> => {
  const where = await read($, whereA)
  const base = await read($, baseA)
  const layers = await read($, layersA)
  const flags = await flagsOf($)
  const proj = layerOver(layers, 'project', where.cwd)
  const br = where.branch === '' ? {} : layerOver(layers, 'branch', branchKey(where.cwd, where.branch))
  const line = (o: Over) => (Object.keys(o).length === 0 ? '  (empty)' : Object.keys(o).sort().map(k => `  ${k} = ${showValue(specFor(k)!, o[k] as Val)}`).join('\n'))
  const mode = valueOf(base, 'sync.mode')

  return [
    `Scope: ${String(mode)} (${mode === 'per-project' ? 'project and branch layers are in force' : 'one set for every project: layers are stored but not in force; /pfset sync.mode per-project'}).`,
    `Project: ${where.cwd === '' ? 'unknown' : where.cwd} (layer ${flags.project ? 'on' : 'off via the prefs.project-overrides switch'})`,
    line(proj),
    `Branch: ${where.branch === '' ? 'unknown (needs the prefs.branch-overrides switch, then /pfproject refresh)' : where.branch}`,
    line(br),
    'Change: /pfproject set <key> <value> | unset <key> | clear, and the same after "branch".',
  ].join('\n')
}

const projectCommand = async ($: Dollar, args: string): Promise<string> => {
  let [word, rest] = splitWord(args)
  let layer: Layer = 'project'
  word = word.toLowerCase()

  if (word === 'branch') {
    layer = 'branch'
    ;[word, rest] = splitWord(rest)
    word = word.toLowerCase()
  }

  if (word === '' || word === 'show') {
    return projectShow($)
  }

  if (word === 'refresh' && layer === 'project') {
    const cwd = await $.session.cwd().catch(() => '')
    const folder = isScopeText(cwd) ? cwd : (await read($, whereA)).cwd
    const branch = await readBranch($, folder)
    await update($, whereA, () => ({ cwd: folder, branch }))
    await recompute($)

    return `Project ${folder === '' ? 'unknown' : folder}; branch ${branch === '' ? 'not read (the prefs.branch-overrides switch is off, or this is not a git repository)' : branch}.`
  }

  if (word === 'set') {
    const [key, value] = splitWord(rest)

    return key === '' ? 'Usage: /pfproject [branch] set <key> <value>' : setFromText($, layer, key, value)
  }

  if (word === 'unset') {
    const spec = specFor(rest.trim().toLowerCase())

    return spec === undefined ? 'Usage: /pfproject [branch] unset <key>' : unsetKey($, layer, spec)
  }

  if (word === 'clear') {
    return clearLayer($, layer)
  }

  return 'Usage: /pfproject [show | set <key> <value> | unset <key> | clear | refresh | branch set|unset|clear ...]'
}

const profileSummary = async ($: Dollar): Promise<string[]> => {
  const user = await read($, profilesA)
  const base = await read($, baseA)
  const meta = await read($, metaA)

  return profileNames(user).map(n => {
    const bundle = findProfile(n, user) ?? {}
    const mark = n === meta.applied ? (matchesProfile(base, bundle) ? ' <- in use' : ' <- last used, since changed') : ''

    return `  ${n} (${isBuiltinProfile(n) ? 'built in' : 'yours'}, ${Object.keys(bundle).length} values)${mark}`
  })
}

/** Use a profile: your locale settings stay, everything else becomes the bundle. One history entry. */
const useProfile = async ($: Dollar, name: string, how: 'manual' | 'auto'): Promise<string> => {
  const user = await read($, profilesA)
  const bundle = findProfile(name, user)

  if (bundle === undefined) {
    return `No profile named "${name.slice(0, 30)}". /pfprofile list shows them.`
  }
  const base = await read($, baseA)
  const next = applyProfile(base, bundle)
  const changes = diffOver(base, next)
  await commit($, 'base', 'base', next, changes, `${how === 'auto' ? 'auto ' : ''}profile ${name}`)
  const meta: Meta = { ...(await read($, metaA)), applied: name }
  await update($, metaA, () => meta)
  await save($, STORE.meta, meta)

  return changes.length === 0 ? `Profile ${name} is already in force.` : `Profile ${name} applied: ${changes.length} ${changes.length === 1 ? 'value' : 'values'} changed (your language, zone, money, date and number settings stayed). /pfundo reverts it.`
}

const saveProfile = async ($: Dollar, name: string): Promise<string> => {
  if (!PROFILE_NAME_RE.test(name)) {
    return 'A profile name is 1 to 24 lowercase letters, digits or dashes, starting with a letter or digit.'
  }

  if (isBuiltinProfile(name)) {
    return `${name} is a built-in profile and cannot be replaced: pick another name.`
  }
  const user = await read($, profilesA)

  if (!Object.prototype.hasOwnProperty.call(user, name) && Object.keys(user).length >= MAX_PROFILES) {
    return `At most ${MAX_PROFILES} profiles of your own: delete one first (/pfprofile del <name>).`
  }
  const bundle = splitLocale(await read($, baseA)).style
  const next = { ...user, [name]: bundle }
  await update($, profilesA, () => next)
  await save($, STORE.profiles, next)
  const meta: Meta = { ...(await read($, metaA)), applied: name }
  await update($, metaA, () => meta)
  await save($, STORE.meta, meta)

  return `Profile ${name} saved (${Object.keys(bundle).length} values; locale settings are not part of a profile).`
}

const deleteProfile = async ($: Dollar, name: string): Promise<string> => {
  const user = await read($, profilesA)

  if (isBuiltinProfile(name)) {
    return `${name} is built in and cannot be deleted.`
  }

  if (!Object.prototype.hasOwnProperty.call(user, name)) {
    return `No profile of yours named "${name.slice(0, 30)}".`
  }
  const next = { ...user }
  delete next[name]
  await update($, profilesA, () => next)
  await save($, STORE.profiles, next)
  const auto = await read($, autoA)
  const cleaned = { ...auto, schedule: auto.schedule.filter(s => s.profile !== name) }

  if (cleaned.schedule.length !== auto.schedule.length) {
    await update($, autoA, () => cleaned)
    await save($, STORE.auto, cleaned)
  }

  return `Profile ${name} deleted${cleaned.schedule.length !== auto.schedule.length ? ' (and removed from the schedule)' : ''}.`
}

const profileCommand = async ($: Dollar, args: string): Promise<string> => {
  const [word, rest] = splitWord(args)
  const name = rest.trim().toLowerCase()

  switch (word.toLowerCase()) {
    case '':
    case 'list':
      return ['Profiles (a bundle of everything except your locale settings; using one replaces your other values):', ...(await profileSummary($)), 'Use: /pfprofile use <name>. Keep the current set: /pfprofile save <name>.'].join('\n')
    case 'save':
      return saveProfile($, name)
    case 'use':
      return useProfile($, name, 'manual')
    case 'del':
    case 'delete':
      return deleteProfile($, name)
    default:
      return 'Usage: /pfprofile save <name> | use <name> | list | del <name>'
  }
}

// ------------------------------------------------------------------ the automatic profile

const stopAuto = () => {
  autoTimer?.cancel()
  autoTimer = undefined
}

/** One check of the schedule. Does nothing unless /pfauto on AND the prefs.auto-profile switch is on. */
const autoStep = async ($: Dollar): Promise<string> => {
  const auto = await read($, autoA)

  if (!auto.on || !(await isOn($, 'auto-profile', false))) {
    stopAuto()

    return 'off'
  }
  const now = await nowOf($)
  const eff = await read($, prefsA)
  const ctx = ctxFrom(eff, now)
  const minute = (((Math.floor(now / 60_000) + ctx.tzMin) % 1440) + 1440) % 1440
  const slot = slotFor(auto.schedule, minute)

  if (slot === undefined) {
    return 'no schedule'
  }

  if (slotId(slot) === auto.last) {
    return 'unchanged'
  }
  const text = await useProfile($, slot.profile, 'auto')
  const next = { ...(await read($, autoA)), last: slotId(slot) }
  await update($, autoA, () => next)
  await save($, STORE.auto, next)

  if (!text.startsWith('No profile') && (await isOn($, 'auto-toast', false)) && now - lastToastAt >= TOAST_GAP_MS) {
    lastToastAt = now
    $.ui.toast(`Profile ${slot.profile} applied (${slot.at} schedule).`, { timeoutMs: Number(valueOf(await read($, prefsA), 'toast.ms')) })
  }

  return `applied ${slot.profile}`
}

const startAuto = ($: Dollar) => {
  if (autoTimer === undefined) {
    autoTimer = $.clock.every(AUTO_MS, () => {
      void autoStep($).catch(() => undefined)
    })
  }
}

const autoCommand = async ($: Dollar, args: string): Promise<string> => {
  const [word, rest] = splitWord(args)
  const auto = await read($, autoA)
  const putAuto = async (next: typeof auto) => {
    await update($, autoA, () => next)
    await save($, STORE.auto, next)
  }
  const switchOn = await isOn($, 'auto-profile', false)

  switch (word.toLowerCase()) {
    case 'on':
      await putAuto({ ...auto, on: true })

      if (switchOn) {
        startAuto($)
        const step = await autoStep($)

        return `Auto profile on: checked now (${step}) and every 30 minutes.`
      }

      return 'Auto profile is on, but nothing will run until the switch is on too: /cfg feature prefs.auto-profile on (both are needed, and the switch is off by default).'
    case 'off':
      await putAuto({ ...auto, on: false })
      stopAuto()

      return 'Auto profile off: nothing is checked any more.'
    case 'add': {
      const [at, profile] = splitWord(rest)
      const p = profile.trim().toLowerCase()

      if (parseHM(at) === null) {
        return 'Usage: /pfauto add HH:MM <profile> (24-hour time in your zone setting).'
      }

      if (findProfile(p, await read($, profilesA)) === undefined) {
        return `No profile named "${p.slice(0, 30)}": /pfprofile list.`
      }

      if (auto.schedule.length >= 6 && !auto.schedule.some(s => parseHM(s.at) === parseHM(at))) {
        return 'At most 6 schedule entries: remove one with /pfauto rm HH:MM.'
      }
      await putAuto({ ...auto, schedule: withSlot(auto.schedule, at, p), last: '' })

      return `Schedule: from ${hmText(parseHM(at)!)} use ${p}.`
    }
    case 'rm': {
      if (parseHM(rest.trim()) === null) {
        return 'Usage: /pfauto rm HH:MM'
      }
      await putAuto({ ...auto, schedule: withoutSlot(auto.schedule, rest.trim()), last: '' })

      return 'Entry removed (if there was one).'
    }
    case 'clear':
      await putAuto({ ...auto, schedule: [], last: '' })

      return 'Schedule cleared.'
    case '':
    case 'status': {
      const now = await nowOf($)
      const ctx = ctxFrom(await read($, prefsA), now)
      const minute = (((Math.floor(now / 60_000) + ctx.tzMin) % 1440) + 1440) % 1440
      const slot = slotFor(auto.schedule, minute)

      return [
        `Auto profile: ${auto.on ? 'on' : 'off'} (command); switch prefs.auto-profile: ${switchOn ? 'on' : 'off'}. It only runs when both are on. Checked at session start and every 30 minutes while on.`,
        auto.schedule.length === 0 ? 'Schedule: empty. Add: /pfauto add 09:00 work, /pfauto add 18:30 home' : `Schedule: ${auto.schedule.map(s => `${s.at} ${s.profile}`).join(', ')}`,
        slot === undefined ? '' : `In force now: ${slot.profile} (since ${slot.at}).`,
        'The schedule applies a profile once when its time arrives; your edits afterwards stay until the next slot.',
      ]
        .filter(l => l !== '')
        .join('\n')
    }
    default:
      return 'Usage: /pfauto on | off | status | add HH:MM <profile> | rm HH:MM | clear'
  }
}

// ------------------------------------------------------------------ the mod list

/** A switch's id inside a mod's row: `<mod>.<id>`, its label, its default. */
const UNIVERSAL: readonly (readonly [string, string])[] = [['toasts', 'Pop-ups'], ['sounds', 'Sounds'], ['status', 'Status line'], ['band', 'Row above prompt']]

const modsMatching = (query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== '')

  return MODS.filter(m => words.every(w => `${m.name} ${m.description}`.toLowerCase().includes(w)))
}

const modsCommand = async ($: Dollar, args: string): Promise<string> => {
  const q = args.trim().slice(0, 40)
  await setView($, { tab: 'mods', query: q, page: 0, selected: '' })
  await openPane($)
  const list = modsMatching(q)
  const overrides = (await read($, featuresA)) as Record<string, boolean>

  return [
    `${list.length} of ${MODS.length} mods${q === '' ? '' : ` match "${q}"`} (a snapshot made when prefs was built):`,
    ...list.slice(0, 12).map(m => {
      const off = [...UNIVERSAL.map(([id]) => ({ id, d: true })), ...m.own.map(o => ({ id: o.id, d: o.default }))].filter(s => (overrides[`${m.name}.${s.id}`] ?? s.d) === false).map(s => s.id)

      return `  ${m.name}: ${truncate(m.description, 80)}${off.length > 0 ? ` [off: ${off.join(', ')}]` : ''}`
    }),
    list.length > 12 ? `  ...and ${list.length - 12} more (narrow with /pfmods <words>)` : '',
    'Change a switch from the Mods tab (a button puts the /cfg line in the prompt) or type /cfg feature <mod>.<id> on|off.',
  ]
    .filter(l => l !== '')
    .join('\n')
}

// ------------------------------------------------------------------ the pane

const openPane = async ($: Dollar) => {
  const eff = await read($, prefsA)
  const lang = await langOf($)
  const meta = await read($, metaA)
  const remember = valueOf(eff, 'pane.remember') === true && (await isOn($, 'remember-tab', true))
  const dflt = String(valueOf(eff, 'pane.tab.prefs'))
  const want = (remember && meta.lastTab !== '' ? meta.lastTab : dflt) as Tab
  const tab: Tab = TABS.includes(want) ? want : 'general'
  await update($, viewA, v => (v.tab === 'mods' && v.query !== '' ? v : { ...v, tab, page: 0, section: 'all' }))
  const float = valueOf(eff, 'pane.placement') === 'float'

  return $.ui
    .open({ id: PANE, title: tr(lang, 'title'), columns: PANE_COLUMNS[String(valueOf(eff, 'pane.width'))] ?? 80, ...(float ? { placement: 'widget' as const } : {}) })
    .catch(() => undefined)
}

const selectTab = async ($: Dollar, tab: Tab) => {
  await setView($, { tab, page: 0, section: 'all', selected: '', notice: '' })

  if (valueOf(await read($, prefsA), 'pane.remember') === true && (await isOn($, 'remember-tab', true))) {
    const meta: Meta = { ...(await read($, metaA)), lastTab: tab }
    await update($, metaA, () => meta)
    await save($, STORE.meta, meta)
  }
}

const fillPrompt = async ($: Dollar, text: string, said: string) => {
  const done = await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)

  return notice($, done?.isFilled === true ? `${said}: press Enter to send it.` : `Could not fill the prompt box. Type it yourself: ${text}`)
}

const accentOf = async ($: Dollar): Promise<Accent> => {
  const a = await read($, accentA)

  return a === 'claude' || a === 'success' || a === 'warning' || a === 'permission' || a === 'remember' ? a : 'suggestion'
}

const runCommand = async ($: Dollar, name: string, args: string, origin: unknown): Promise<string> => {
  switch (name) {
    case 'pf':
      await openPane($)

      return helpText()
    case 'pfset': {
      const [key, value] = splitWord(args)

      if (key === '') {
        return 'Usage: /pfset <key> <value>. /pfget lists what is changed; /pfget <words> searches.'
      }
      const spec = specFor(key.toLowerCase())

      if (spec !== undefined && value === '') {
        return `${spec.key} accepts ${acceptText(spec)}. Now: ${showValue(spec, valueOf(await read($, prefsA), spec.key))}.`
      }

      return setFromText($, 'base', key, value)
    }
    case 'pfget':
      return getCommand($, args)
    case 'pfreset':
      return resetCommand($, args)
    case 'pfexport':
      return exportCommand($)
    case 'pfimport':
      return importCommand($, args, origin)
    case 'pfundo':
      return undoCommand($, args)
    case 'pfproject':
      return projectCommand($, args)
    case 'pfprofile':
      return profileCommand($, args)
    case 'pfauto':
      return autoCommand($, args)
    case 'pfmods':
      return modsCommand($, args)
    default:
      return helpText()
  }
}

// ------------------------------------------------------------------ the module

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A new session starts clean: no timer from an earlier load, no toast clock.
    stopAuto()
    lastToastAt = -Infinity

    for (const [name, description, hint] of COMMANDS) {
      await $.command.register(hint === '' ? { name, description } : { name, description, argumentHint: hint }).catch(() => undefined)
    }

    try {
      await load($, e.cwd)
      const eff = await read($, prefsA)

      if (valueOf(eff, 'autoopen.prefs') === true && (await isOn($, 'auto-open', false))) {
        await openPane($)
      }

      if ((await read($, autoA)).on && (await isOn($, 'auto-profile', false))) {
        startAuto($)
        await autoStep($)
      }
    } catch {
      // A failing load never stops the session: the defaults stay in force.
    }

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({
      text: await runCommand($, name, e.args, e.origin).catch(() => `/${name} hit an unexpected error. Nothing was changed.`),
    }))
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Input } = ui
    const Svg = e.surface === 'desktop' ? (ui as ElementTable<'desktop'>).Svg : undefined
    const view = await read($, viewA)
    const eff = await read($, prefsA)
    const base = await read($, baseA)
    const lang = await langOf($)
    const accent = await accentOf($)
    const density = await read($, densityA)
    const gap = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
    const now = await nowOf($)
    const policy = levelPolicy(valueOf(eff, 'level'))
    const cols = e.props.bodyColumns
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24
    const per = Math.max(3, Math.min(14, Math.floor((bodyRows - 15) / (policy.description ? 3 : 2))))
    const where = await read($, whereA)
    const changed = Object.keys(eff).length
    const tab = view.tab
    const searching = view.query.trim() !== '' && tab !== 'mods'

    const Section = (label: string) => (
      <Text size="caption" weight="semibold" dimColor>
        {label.toUpperCase()}
      </Text>
    )

    const Pager = (total: number, page: number, pages: number, sec: string) => (
      <Box gap="sm">
        <Button key={`${sec}-prev`} label="<" onPress={() => setView($, { page: Math.max(0, page - 1) })} />
        <Text dimColor>{tr(lang, 'page', { a: page + 1, b: pages, n: total })}</Text>
        <Button key={`${sec}-next`} label=">" onPress={() => setView($, { page: Math.min(pages - 1, page + 1) })} />
      </Box>
    )

    const Row = (spec: PrefSpec) => {
      const value = valueOf(eff, spec.key)
      const isChanged = Object.prototype.hasOwnProperty.call(eff, spec.key)
      const preview = rowPreview(spec.key, eff, now)

      return (
        <Box flexDirection="column">
          <Box gap="sm" flexWrap="wrap">
            <Text weight="semibold" color={isChanged ? accent : undefined}>
              {`${spec.label}${isChanged ? ' *' : ''}`}
            </Text>
            {spec.type === 'enum' &&
              (spec.values ?? []).map(v => <Button key={`set-${spec.key}-${v}`} label={v === value ? `[${v}]` : v} onPress={() => setTyped($, spec, v)} />)}
            {spec.type === 'boolean' && <Button key={`tog-${spec.key}`} label={value === true ? 'On' : 'Off'} onPress={() => setTyped($, spec, value !== true)} />}
            {spec.type === 'number' && (
              <Box gap="xs">
                <Button key={`decb-${spec.key}`} label="--" onPress={() => setTyped($, spec, nudge(spec, value, -1, true))} />
                <Button key={`dec-${spec.key}`} label="-" onPress={() => setTyped($, spec, nudge(spec, value, -1))} />
                <Text mono>{showValue(spec, value)}</Text>
                <Button key={`inc-${spec.key}`} label="+" onPress={() => setTyped($, spec, nudge(spec, value, 1))} />
                <Button key={`incb-${spec.key}`} label="++" onPress={() => setTyped($, spec, nudge(spec, value, 1, true))} />
              </Box>
            )}
            {isChanged && <Button key={`rst-${spec.key}`} label={tr(lang, 'reset')} onPress={() => resetFromPane($, spec)} />}
          </Box>
          {policy.description && (
            <Text size="caption" dimColor>
              {truncate(`${spec.description}  [${spec.isUsedHere ? tr(lang, 'usedHere') : tr(lang, 'storedOnly')}]`, Math.max(30, cols - 4))}
            </Text>
          )}
          {policy.key && (
            <Text size="caption" mono dimColor>
              {`${spec.key}  default ${showValue(spec, spec.default)}${spec.type === 'number' ? `  range ${spec.min} to ${spec.max}, step ${spec.step}` : ''}`}
            </Text>
          )}
          {preview !== undefined && (
            <Text mono dimColor>
              {`-> ${truncate(preview, Math.max(30, cols - 6))}`}
            </Text>
          )}
        </Box>
      )
    }

    const Preview = (group: Group) => {
      const lines = previewLines(group, eff, now, lang)
      const metric = 'cost'
      const chart = {
        type: String(valueOf(eff, 'chart.type.cost')) as ChartType,
        smooth: valueOf(eff, 'chart.smooth') === true,
        grid: valueOf(eff, 'chart.grid') === true,
        labels: valueOf(eff, 'chart.labels') === true,
        legend: String(valueOf(eff, 'chart.legend')) as Legend,
        ramp: String(valueOf(eff, 'chart.ramp')),
        range: String(valueOf(eff, 'chart.range')),
        metric,
        accent,
      }

      return (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
          {Section(tr(lang, 'preview'))}
          {lines.map(l => (
            <Text mono>{truncate(l, Math.max(30, cols - 4))}</Text>
          ))}
          {group === 'charts' && Svg !== undefined && <Svg source={chartSvg(chart)} alt={chartAlt(chart)} isInteractive {...svgSize(chartSvg(chart), 360)} />}
          {group === 'charts' && Svg === undefined && chartText(chart).map(l => <Text mono dimColor>{truncate(l, Math.max(30, cols - 4))}</Text>)}
        </Box>
      )
    }

    let body: JSX.Element | null = null

    if (searching) {
      const hits = searchPrefs(view.query)
      const pg = paginate(hits.length, per, view.page)
      body = (
        <Box flexDirection="column" gap="xs">
          {hits.length === 0 && <Text dimColor>{tr(lang, 'nothing')}</Text>}
          {hits.slice(pg.start, pg.end).map(Row)}
          {Pager(hits.length, pg.page, pg.pages, 'sp')}
        </Box>
      )
    } else if (GROUPS.includes(tab as Group)) {
      const group = tab as Group
      const sections = sectionsOf(group)
      const sec = sections.includes(view.section) ? view.section : 'all'
      const list = prefsInGroup(group).filter(p => sec === 'all' || p.section === sec)
      const pg = paginate(list.length, per, view.page)
      body = (
        <Box flexDirection="column" gap="xs">
          {sections.length > 1 && (
            <Box gap="xs" flexWrap="wrap">
              <Button key="sec-all" label={sec === 'all' ? `[${tr(lang, 'all')}]` : tr(lang, 'all')} onPress={() => setView($, { section: 'all', page: 0 })} />
              {sections.map((s, i) => (
                <Button key={`sec-${i}`} label={s === sec ? `[${s}]` : s} onPress={() => setView($, { section: s, page: 0 })} />
              ))}
            </Box>
          )}
          {list.slice(pg.start, pg.end).map(Row)}
          {Pager(list.length, pg.page, pg.pages, 'pg')}
          {Preview(group)}
        </Box>
      )
    } else if (tab === 'mods') {
      const mods = modsMatching(view.query)
      const pg = paginate(mods.length, Math.max(3, per + 2), view.page)
      const overrides = (await read($, featuresA)) as Record<string, boolean>
      const sel = MODS.find(m => m.name === view.selected)
      body = (
        <Box flexDirection="column" gap="xs">
          <Text dimColor size="caption">{`${mods.length} of ${MODS.length} mods (a snapshot made when prefs was built). A switch button puts its /cfg line in the prompt box; nothing is changed until you press Enter.`}</Text>
          {mods.length === 0 && <Text dimColor>{tr(lang, 'nothing')}</Text>}
          {mods.slice(pg.start, pg.end).map(m => (
            <Box gap="sm">
              <Button key={`msel-${m.name}`} label={m.name === view.selected ? `[${m.name}]` : m.name} onPress={() => setView($, { selected: m.name })} />
              <Text dimColor>{truncate(m.description, Math.max(12, cols - m.name.length - 8))}</Text>
            </Box>
          ))}
          {Pager(mods.length, pg.page, pg.pages, 'mp')}
          {sel !== undefined && (
            <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm" gap="xs">
              <Text weight="bold" color={accent}>
                {sel.name}
              </Text>
              {LOCKED.includes(sel.name) ? (
                <Text dimColor>Always on: a safety mod's (or the settings mod's) messages cannot be muted.</Text>
              ) : (
                [...UNIVERSAL.map(([id, label]) => ({ id, label, d: true, own: false })), ...sel.own.map(o => ({ id: o.id, label: o.label, d: o.default, own: true }))].map(s => {
                  const lit = overrides[`${sel.name}.${s.id}`] ?? s.d

                  return (
                    <Box gap="sm" flexWrap="wrap">
                      <Button key={`msw-${sel.name}.${s.id}`} label={`${s.label} ${lit ? 'On' : 'Off'}`} onPress={() => fillPrompt($, `/cfg feature ${sel.name}.${s.id} ${lit ? 'off' : 'on'}`, `Switch ${sel.name}.${s.id}`)} />
                      <Text mono dimColor>{`${sel.name}.${s.id}${s.d === lit ? '' : ' *'}`}</Text>
                    </Box>
                  )
                })
              )}
            </Box>
          )}
        </Box>
      )
    } else if (tab === 'profiles') {
      const user = await read($, profilesA)
      const meta = await read($, metaA)
      const auto = await read($, autoA)
      const switchOn = await isOn($, 'auto-profile', false)
      const names = profileNames(user)
      body = (
        <Box flexDirection="column" gap="xs">
          <Text dimColor size="caption">A profile is a bundle of everything except your locale settings (language, zone, week, money, date, number and unit). Using one replaces your other values; /pfundo reverts it.</Text>
          {names.map(n => {
            const bundle = findProfile(n, user) ?? {}
            const inUse = n === meta.applied && matchesProfile(base, bundle)

            return (
              <Box gap="sm">
                <Text weight={inUse ? 'bold' : 'regular'} color={inUse ? accent : undefined}>{`${n}${inUse ? ' (in use)' : n === meta.applied ? ' (changed since)' : ''}`}</Text>
                <Text dimColor>{`${isBuiltinProfile(n) ? 'built in' : 'yours'}, ${Object.keys(bundle).length} values`}</Text>
                <Button key={`puse-${n}`} label={tr(lang, 'use')} onPress={async () => notice($, await useProfile($, n, 'manual'))} />
                {!isBuiltinProfile(n) && <Button key={`pdel-${n}`} label={tr(lang, 'del')} onPress={async () => notice($, await deleteProfile($, n))} />}
              </Box>
            )
          })}
          <Input key="pname" label="save current as" placeholder="name, e.g. review" value={view.name} submitLabel={tr(lang, 'save')} onInput={(v: string) => setView($, { name: v.slice(0, 24) })} onSubmit={async (v: string) => { await setView($, { name: '' }); await notice($, await saveProfile($, v.trim().toLowerCase())) }} />
          {Section('Automatic by time of day')}
          <Box gap="sm" flexWrap="wrap">
            <Button key="auto-toggle" label={`Auto: ${auto.on ? 'On' : 'Off'}`} onPress={async () => notice($, await autoCommand($, auto.on ? 'off' : 'on'))} />
            <Text dimColor>{`switch prefs.auto-profile: ${switchOn ? 'on' : 'off'} (default off; both must be on)`}</Text>
            <Button key="auto-switch" label={`switch ${switchOn ? 'off' : 'on'}`} onPress={() => fillPrompt($, `/cfg feature prefs.auto-profile ${switchOn ? 'off' : 'on'}`, 'Switch prefs.auto-profile')} />
          </Box>
          {auto.schedule.length === 0 && <Text dimColor>No schedule. Add one below, e.g. 09:00 work</Text>}
          {auto.schedule.map((s: Slot) => (
            <Box gap="sm">
              <Text mono>{`${s.at}  ${s.profile}`}</Text>
              <Button key={`srm-${s.at}`} label={tr(lang, 'del')} onPress={async () => notice($, await autoCommand($, `rm ${s.at}`))} />
            </Box>
          ))}
          <Input key="pslot" label="add entry" placeholder="HH:MM profile" value="" submitLabel="add" onSubmit={async (v: string) => notice($, await autoCommand($, `add ${v.trim()}`))} />
        </Box>
      )
    } else if (tab === 'projects') {
      const layers = await read($, layersA)
      const mode = valueOf(base, 'sync.mode')
      const proj = layerOver(layers, 'project', where.cwd)
      const br = where.branch === '' ? {} : layerOver(layers, 'branch', branchKey(where.cwd, where.branch))
      const flags = await flagsOf($)
      const LayerList = (layer: 'project' | 'branch', over: Over) => (
        <Box flexDirection="column">
          {Object.keys(over).length === 0 && <Text dimColor>{`(${layer} layer is empty)`}</Text>}
          {Object.keys(over).sort().slice(0, 10).map(k => (
            <Box gap="sm">
              <Text mono>{`${k} = ${showValue(specFor(k)!, over[k] as Val)}`}</Text>
              <Button key={`unset-${layer}-${k}`} label={tr(lang, 'reset')} onPress={async () => notice($, await unsetKey($, layer, specFor(k)!))} />
            </Box>
          ))}
        </Box>
      )
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="sm" flexWrap="wrap">
            <Text weight="semibold">Scope</Text>
            <Button key="scope-synced" label={mode === 'synced' ? '[synced]' : 'synced'} onPress={() => setTyped($, specFor('sync.mode')!, 'synced')} />
            <Button key="scope-per" label={mode === 'per-project' ? '[per-project]' : 'per-project'} onPress={() => setTyped($, specFor('sync.mode')!, 'per-project')} />
          </Box>
          <Text dimColor size="caption">synced = one set for every project (layers are stored but not in force). per-project = the project layer, then the branch layer, apply on top of your global values. sync.mode itself is always global.</Text>
          <Text mono>{`project: ${where.cwd === '' ? 'unknown' : displayPath(where.cwd, 'full', '')}`}</Text>
          <Text mono>{`branch: ${where.branch === '' ? 'not read (switch prefs.branch-overrides on, then refresh)' : where.branch}`}</Text>
          <Text dimColor size="caption">{`layers in force: project ${flags.project && mode === 'per-project' ? 'yes' : 'no'}, branch ${flags.branch && mode === 'per-project' && where.branch !== '' ? 'yes' : 'no'}`}</Text>
          <Box gap="sm" flexWrap="wrap">
            <Text weight="semibold">{tr(lang, 'editing', { where: '' })}</Text>
            {(['base', 'project', 'branch'] as const).map(t => (
              <Button key={`target-${t}`} label={view.target === t ? `[${tr(lang, t === 'base' ? 'global' : t === 'project' ? 'thisProject' : 'thisBranch')}]` : tr(lang, t === 'base' ? 'global' : t === 'project' ? 'thisProject' : 'thisBranch')} onPress={() => setView($, { target: t as Target })} />
            ))}
            <Button key="p-refresh" label="refresh" onPress={async () => notice($, await projectCommand($, 'refresh'))} />
          </Box>
          {Section('Project layer')}
          {LayerList('project', proj)}
          {Section('Branch layer')}
          {LayerList('branch', br)}
          <Box gap="sm">
            <Button key="clear-project" label="clear project layer" onPress={async () => notice($, await clearLayer($, 'project'))} />
            <Button key="clear-branch" label="clear branch layer" onPress={async () => notice($, await clearLayer($, 'branch'))} />
          </Box>
        </Box>
      )
    } else {
      const history = [...(await read($, historyA))].reverse()
      const pg = paginate(history.length, Math.max(3, per + 2), view.page)
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="sm">
            <Button key="undo-last" label={tr(lang, 'undoLast')} onPress={async () => notice($, await undoCommand($, ''))} />
            <Text dimColor>{`${history.length}/30`}</Text>
          </Box>
          {history.length === 0 && <Text dimColor>{tr(lang, 'noHistory')}</Text>}
          {history.slice(pg.start, pg.end).map(item => (
            <Text mono>{truncate(`${relativeTime(item.at, now).padEnd(10)} ${item.label}  (${item.layer}, ${item.changes.length})`, Math.max(30, cols - 2))}</Text>
          ))}
          {Pager(history.length, pg.page, pg.pages, 'hp')}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding={gap} gap={gap}>
        <Box justifyContent="space-between">
          <Text size="heading" weight="bold" color={accent}>
            {tr(lang, 'title')}
          </Text>
          <Text color={changed > 0 ? accent : undefined} dimColor={changed === 0}>
            {tr(lang, 'changed', { n: changed })}
          </Text>
        </Box>
        <Text size="caption" color="warning">
          {tr(lang, 'honest')}
        </Text>
        <Box gap="xs" flexWrap="wrap">
          {TABS.map(id => (
            <Button key={`tab-${id}`} label={id === tab ? `[${tabLabel(lang, id)}]` : tabLabel(lang, id)} onPress={() => selectTab($, id)} />
          ))}
        </Box>
        <Input key="psearch" label={tr(lang, 'search')} placeholder={tr(lang, 'searchHint')} value={view.query} submitLabel={tr(lang, 'filter')} onInput={(v: string) => setView($, { query: v.slice(0, 40), page: 0 })} onSubmit={(v: string) => setView($, { query: v.trim().slice(0, 40), page: 0 })} />
        {view.query !== '' && <Button key="clear-search" label={tr(lang, 'clearSearch')} onPress={() => setView($, { query: '', page: 0 })} />}
        {view.target !== 'base' && (
          <Text color="warning" size="caption">
            {tr(lang, 'editing', { where: tr(lang, view.target === 'project' ? 'thisProject' : 'thisBranch') })}
          </Text>
        )}
        {view.notice !== '' && <Text color={accent}>{view.notice}</Text>}
        {body}
        <Text size="caption" dimColor>
          {tr(lang, 'footer')}
        </Text>
        <Text size="caption" dimColor>{`${formatDateTime(now, ctxFrom(eff, now))} · ${PREFS.length} preferences`}</Text>
      </Box>
    )
  })
}
