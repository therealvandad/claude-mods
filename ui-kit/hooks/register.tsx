import { atom, read, update } from 'claude-code'
import type { BoxProps, ButtonProps, ElementConstructor, ElementTable, Hook, InputProps, ProgressProps, Register, SvgProps, TextProps } from 'claude-code'

import type { CallRec, LabItem, LabState, UiState, ViewId } from '../types'
import {
  CAP,
  DATA_VIEWS,
  DEFAULT_LAB,
  DEFAULT_UI,
  EDIT_TOOLS,
  VIEWS,
  addPrompt,
  addSample,
  asRecord,
  bumpEdit,
  cleanAcc,
  cleanDays,
  cleanHours,
  cleanLab,
  cleanName,
  cleanPrefs,
  demoData,
  detailOf,
  dayKey,
  dur,
  editSize,
  emptyData,
  endCall,
  fileOf,
  isView,
  labToStore,
  milestoneCrossed,
  redact,
  startCall,
  trimDays,
} from './data'
import type { Data } from './data'
import { breakpointOf, clampN, glyphs, isIcons, nb, svgWidth } from './fmt'
import type { Breakpoint, Icons } from './fmt'
import type { Item, Line, Num } from './model'
import { SWITCH_DEFAULTS } from './switches'
import { checkSvg, confettiSvg, isAccent, miniSvg, skeletonSvg, stepperSvg, tinySpark } from './svg'
import type { Accent, Look } from './svg'
import { buildView, miniNums, toolLine } from './views'
import type { ViewOut } from './views'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'ui-kit-main'
const WIDGET = 'ui-kit-widget'
/** Only the desktop app draws vector images here. (The types list Svg on mobile and VS Code too; this mod keeps text there.) */
const SVG_SURFACES: readonly string[] = ['desktop']

const ENTER_MS = 1500
const PULSE_MS = 1300
const CELEBRATE_MS = 6000
const UNDO_MS = 30_000
const LOAD_MS = 450
const TOAST_GAP_MS = 180_000

// ---------------------------------------------------------------- state

const uiA = atom({ plugin: 'ui-kit', key: 'ui' } as const, DEFAULT_UI, { shape: 'ui-1' })
const labA = atom({ plugin: 'ui-kit', key: 'lab' } as const, DEFAULT_LAB, { shape: 'lab-1' })
const callsA = atom({ plugin: 'ui-kit', key: 'calls' } as const, [], { shape: 'calls-1' })
const editsA = atom({ plugin: 'ui-kit', key: 'edits' } as const, [], { shape: 'edits-1' })
const promptsA = atom({ plugin: 'ui-kit', key: 'prompts' } as const, [], { shape: 'prompts-1' })
const samplesA = atom({ plugin: 'ui-kit', key: 'samples' } as const, [], { shape: 'samples-1' })
const daysA = atom({ plugin: 'ui-kit', key: 'days' } as const, {}, { shape: 'days-1' })
const hoursA = atom({ plugin: 'ui-kit', key: 'hours' } as const, [], { shape: 'hours-1' })
const accA = atom({ plugin: 'ui-kit', key: 'acc' } as const, {}, { shape: 'acc-1' })
const isDemoA = atom({ plugin: 'ui-kit', key: 'isDemo' } as const, false)
const startedA = atom({ plugin: 'ui-kit', key: 'startedAt' } as const, 0)
const tickA = atom({ plugin: 'ui-kit', key: 'tick' } as const, 0)
const totalA = atom({ plugin: 'ui-kit', key: 'total' } as const, 0)

// Shared switches owned by other mods (read only).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const isCalmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })

type Overrides = Record<string, boolean>
const switchOn = (o: Overrides, id: string): boolean => o[`ui-kit.${id}`] ?? SWITCH_DEFAULTS[id] ?? false

type Gates = {
  /** Motion is on and calm is off: the only time anything may move. */
  animate: boolean
  accent: Accent
  gap: 'xs' | 'sm' | 'md'
  icons: Icons
  on: (id: string) => boolean
}

const readGates = async (d: Dollar): Promise<Gates> => {
  const o = (await read(d, featuresA)) as Overrides
  const motion = (await read(d, motionIsOn)) !== false
  const calm = (await read(d, isCalmA)) === true
  const accent = String(await read(d, accentA))
  const density = String(await read(d, densityA))
  const icons = await read(d, iconsA)

  return {
    animate: motion && !calm,
    accent: isAccent(accent) ? accent : 'suggestion',
    gap: density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm',
    icons: isIcons(icons) ? icons : 'symbols',
    on: id => switchOn(o, id),
  }
}

const sw = async (d: Dollar, id: string): Promise<boolean> => switchOn((await read(d, featuresA)) as Overrides, id)

// ---------------------------------------------------------------- recording

const bump = (d: Dollar) => update(d, tickA, n => n + 1)

const pulse = (d: Dollar, keys: string[], at: number) => update(d, uiA, s => ({ ...s, pulseAt: at, pulseKeys: keys }))

const bumpUse = async (d: Dollar, at: number) => {
  const key = dayKey(at)
  await update(d, daysA, cur => trimDays({ ...cur, [key]: (cur[key] ?? 0) + 1 }))
  const h = new Date(at).getHours()
  await update(d, hoursA, cur => cleanHours(cur).map((v, i) => (i === h ? v + 1 : v)))
  await d.store.set('days', await read(d, daysA))
  await d.store.set('hours', await read(d, hoursA))
}

let etaStop: (() => void) | undefined

/** One 1 s ticker, only while a call runs and the eta-live switch is on. It stops itself when nothing runs. */
const syncTicker = async (d: Dollar) => {
  const running = (await read(d, callsA)).some(c => c.endedAt === null)
  const want = running && (await sw(d, 'eta-live'))

  if (want && etaStop === undefined) {
    const timer = d.clock.every(1000, () => {
      void bump(d).then(() => syncTicker(d))
    })
    etaStop = () => timer.cancel()
  }

  if (!want && etaStop !== undefined) {
    etaStop()
    etaStop = undefined
  }
}

const beginCall = async (d: Dollar, rec: CallRec) => {
  await update(d, callsA, list => startCall(list, rec))
  await syncTicker(d)
}

const finishCall = async (d: Dollar, id: string, tool: string, input: Record<string, unknown>, isFailed: boolean, text: string) => {
  const at = await d.clock.now()
  const showMsg = await sw(d, 'error-text')
  await update(d, callsA, list => endCall(list, id, at, isFailed, showMsg ? text : '', text.length))

  if (!isFailed && EDIT_TOOLS.test(tool)) {
    const path = fileOf(input)

    if (path !== undefined) {
      const size = editSize(tool, input)
      await update(d, editsA, list => bumpEdit(list, path, size.added, size.removed, at))
    }
  }
  await bumpUse(d, at)
  const before = await read(d, totalA)
  await update(d, totalA, n => n + 1)
  await pulse(d, ['calls', 'errors', 'edits', 'files', 'lines', 'rate', 'kinds', 'today', 'span', ...(isFailed ? ['errors'] : [])], at)
  const hit = milestoneCrossed(before, before + 1)

  if (hit !== undefined && (await sw(d, 'confetti'))) {
    await update(d, uiA, s => ({ ...s, celebrateAt: at, celebrateN: hit }))
    d.clock.after(CELEBRATE_MS + 200, () => {
      void bump(d)
    })
  }
  await syncTicker(d)
}

const sampleSpend = async (d: Dollar) => {
  const u = await d.session.usage()
  const t = await d.clock.now()
  const usd = u.cost?.usd ?? 0
  const ctx = u.context.percent ?? 0
  await update(d, samplesA, list => addSample(list, { t, usd: clampN(usd, 0, 1e6), ctx: clampN(ctx, 0, 100) }))
  await update(d, startedA, () => u.startedAt)
  await pulse(d, ['spend', 'ctx', 'avg'], t)
}

const loadStore = async (d: Dollar) => {
  const days = await d.store.get('days').catch(() => undefined)
  const hours = await d.store.get('hours').catch(() => undefined)
  const acc = await d.store.get('acc').catch(() => undefined)
  const lab = await d.store.get('lab').catch(() => undefined)
  const prefs = cleanPrefs(await d.store.get('prefs').catch(() => undefined))
  await update(d, daysA, () => cleanDays(days))
  await update(d, hoursA, () => cleanHours(hours))
  await update(d, accA, () => cleanAcc(acc))
  await update(d, labA, () => cleanLab(lab))
  await update(d, uiA, s => ({ ...s, ...prefs }))
}

const buildData = async (d: Dollar): Promise<Data> => {
  const now = await d.clock.now()

  if (await read(d, isDemoA)) {
    return demoData(now)
  }

  return {
    ...emptyData(now),
    startedAt: (await read(d, startedA)) || now,
    calls: await read(d, callsA),
    edits: await read(d, editsA),
    prompts: await read(d, promptsA),
    samples: await read(d, samplesA),
    days: await read(d, daysA),
    hours: cleanHours(await read(d, hoursA)),
  }
}

// ---------------------------------------------------------------- actions (each takes `$`)

const savePrefs = async (d: Dollar) => {
  const s = await read(d, uiA)
  await d.store.set('prefs', { view: s.view, split: s.split, mini: s.mini })
}

const saveLab = async (d: Dollar) => d.store.set('lab', labToStore(await read(d, labA)))

const actView = async (d: Dollar, v: ViewId) => {
  const now = await d.clock.now()
  const skeleton = await sw(d, 'skeleton')
  await update(d, uiA, s => ({ ...s, view: v, split: s.split === v ? 'none' : s.split, enterAt: now, loadingUntil: skeleton ? now + LOAD_MS : 0 }))
  await savePrefs(d)

  if (skeleton) {
    d.clock.after(LOAD_MS + 60, () => {
      void bump(d)
    })
  }
}

const actSplit = async (d: Dollar) => {
  const s = await read(d, uiA)
  const cycle: (ViewId | 'none')[] = ['none', ...DATA_VIEWS.filter(v => v !== s.view)]
  const next = cycle[(cycle.indexOf(s.split) + 1) % cycle.length] ?? 'none'
  const now = await d.clock.now()
  await update(d, uiA, x => ({ ...x, split: next, enterAt: now }))
  await savePrefs(d)
}

const actMini = async (d: Dollar) => {
  await update(d, uiA, s => ({ ...s, mini: !s.mini }))
  await savePrefs(d)
}

const actDemo = async (d: Dollar, value?: boolean) => {
  const now = await d.clock.now()
  await update(d, isDemoA, v => value ?? !v)
  await update(d, uiA, s => ({ ...s, enterAt: now }))
}

const actRow = (d: Dollar, key: string) =>
  update(d, uiA, s => ({ ...s, open: s.open.includes(key) ? s.open.filter(k => k !== key) : [...s.open, key].slice(-CAP.open) }))

const actSel = (d: Dollar, view: string, id: string) => update(d, uiA, s => ({ ...s, sel: { ...s.sel, [view]: id } }))

const actAcc = async (d: Dollar, key: string, isOpen: boolean) => {
  await update(d, accA, a => ({ ...a, [key]: !isOpen }))
  await d.store.set('acc', await read(d, accA))
}

const actRetry = async (d: Dollar) => {
  const now = await d.clock.now()
  await update(d, uiA, s => ({ ...s, failOnce: false, enterAt: now }))
  await bump(d)
}

const toastUndo = async (d: Dollar, text: string) => {
  const now = await d.clock.now()
  const s = await read(d, uiA)

  if ((await sw(d, 'undo-toast')) && now - s.lastToastAt >= TOAST_GAP_MS) {
    await update(d, uiA, x => ({ ...x, lastToastAt: now }))
    d.ui.toast(text, { timeoutMs: 6000 })
  }
}

const labSet = async (d: Dollar, fn: (l: LabState) => LabState) => {
  await update(d, labA, fn)
  await saveLab(d)
}

const labConfirm = async (d: Dollar, id: number) => {
  const now = await d.clock.now()
  await update(d, labA, l => ({ ...l, items: l.items.map(x => (x.id === id ? { ...x, pending: false, okAt: now } : x)) }))
  // the word "confirmed" goes away on its own
  d.clock.after(1600, () => {
    void bump(d)
  })
}

/** Optimistic: the new state shows at once, marked saving; a moment later the clock marks it confirmed. */
const labToggle = async (d: Dollar, id: number) => {
  const g = await readGates(d)
  const slow = g.on('optimistic') && g.animate
  await labSet(d, l => ({ ...l, items: l.items.map(x => (x.id === id ? { ...x, on: !x.on, pending: slow } : x)) }))

  if (slow) {
    d.clock.after(900, () => {
      void labConfirm(d, id)
    })
  } else {
    await labConfirm(d, id)
  }
}

const labRemove = async (d: Dollar, id: number) => {
  const lab = await read(d, labA)
  const item = lab.items.find(x => x.id === id)

  if (item === undefined) {
    return
  }
  const now = await d.clock.now()
  await labSet(d, l => ({ ...l, items: l.items.filter(x => x.id !== id), editing: 0, undo: { item, at: now } }))
  d.clock.after(UNDO_MS + 200, () => {
    void bump(d)
  })
  await toastUndo(d, `Removed "${item.name}". Type /uiundo within 30 seconds to bring it back.`)
}

/** Restores the last removed Lab item, if it was removed less than 30 seconds ago. */
const labUndo = async (d: Dollar): Promise<string> => {
  const lab = await read(d, labA)
  const now = await d.clock.now()

  if (lab.undo === null || now - lab.undo.at > UNDO_MS) {
    return 'Nothing to undo: the last removal is more than 30 seconds old, or nothing was removed.'
  }
  const item = lab.undo.item
  await labSet(d, l => ({ ...l, items: [...l.items.filter(x => x.id !== item.id), { ...item, pending: false, okAt: 0 }].sort((a, b) => a.id - b.id).slice(0, CAP.lab), undo: null }))

  return `Brought back "${item.name}".`
}

const labAdd = async (d: Dollar, raw: string) => {
  const name = cleanName(raw)
  const lab = await read(d, labA)

  if (name === '' || lab.items.length >= CAP.lab) {
    return
  }
  await labSet(d, l => ({ ...l, items: [...l.items, { id: l.nextId, name, on: false, list: 'a', pending: false, okAt: 0 }], nextId: l.nextId + 1 }))
}

const labRename = async (d: Dollar, id: number, raw: string) => {
  const name = cleanName(raw)
  await labSet(d, l => ({ ...l, editing: 0, items: name === '' ? l.items : l.items.map(x => (x.id === id ? { ...x, name } : x)) }))
}

const labMove = (d: Dollar, id: number) => labSet(d, l => ({ ...l, items: l.items.map(x => (x.id === id ? { ...x, list: x.list === 'a' ? 'b' : 'a' } : x)) }))

const labEdit = (d: Dollar, id: number) => update(d, labA, l => ({ ...l, editing: id }))

const labStep = (d: Dollar, delta: number) => update(d, labA, l => ({ ...l, step: clampN(l.step + delta, 0, 3), done: false }))

const labPick = (d: Dollar, step: number, i: number) => update(d, labA, l => ({ ...l, picks: l.picks.map((p, k) => (k === step ? i : p)) }))

const labFinish = async (d: Dollar) => {
  const now = await d.clock.now()
  await update(d, labA, l => ({ ...l, done: true }))
  await update(d, uiA, s => ({ ...s, enterAt: now }))
}

const labRestart = (d: Dollar) => update(d, labA, l => ({ ...l, step: 0, picks: [0, 0, 0], done: false }))

// ---------------------------------------------------------------- drawing helpers

type UI = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input: ElementConstructor<InputProps>
  Progress: ElementConstructor<ProgressProps>
  Svg: ElementConstructor<SvgProps> | undefined
}

type Acts = {
  view: (v: ViewId) => Promise<void>
  split: () => Promise<void>
  mini: () => Promise<void>
  demo: () => Promise<void>
  row: (key: string) => Promise<unknown>
  sel: (view: string, id: string) => Promise<unknown>
  acc: (key: string, isOpen: boolean) => Promise<void>
  retry: () => Promise<void>
  toggle: (id: number) => Promise<void>
  edit: (id: number) => Promise<unknown>
  rename: (id: number, v: string) => Promise<void>
  cancel: () => Promise<unknown>
  move: (id: number) => Promise<unknown>
  remove: (id: number) => Promise<void>
  add: (v: string) => Promise<void>
  step: (n: number) => Promise<unknown>
  pick: (step: number, i: number) => Promise<unknown>
  finish: () => Promise<void>
  restart: () => Promise<unknown>
  undo: () => Promise<string>
}

const makeActs = (d: Dollar): Acts => ({
  view: v => actView(d, v),
  split: () => actSplit(d),
  mini: () => actMini(d),
  demo: () => actDemo(d),
  row: k => actRow(d, k),
  sel: (v, id) => actSel(d, v, id),
  acc: (k, o) => actAcc(d, k, o),
  retry: () => actRetry(d),
  toggle: id => labToggle(d, id),
  edit: id => labEdit(d, id),
  rename: (id, v) => labRename(d, id, v),
  cancel: () => update(d, labA, l => ({ ...l, editing: 0 })),
  move: id => labMove(d, id),
  remove: id => labRemove(d, id),
  add: v => labAdd(d, v),
  step: n => labStep(d, n),
  pick: (s, i) => labPick(d, s, i),
  finish: () => labFinish(d),
  restart: () => labRestart(d),
  undo: () => labUndo(d),
})

type PaneCtx = {
  u: UI
  g: Gates
  st: UiState
  lab: LabState
  acc: Record<string, boolean>
  now: number
  cols: number
  bp: Breakpoint
  act: Acts
  hot: boolean
  large: boolean
  data: Data
  pulseKeys: readonly string[]
  isDesktop: boolean
}

const toneColor = (t: Line['tone'] | Num['tone'], accent: Accent): string | undefined =>
  t === 'accent' ? accent : t === 'ok' ? 'success' : t === 'bad' ? 'error' : t === 'warn' ? 'warning' : t === 'mut' ? 'subtle' : undefined

type Btn = { key: string; label: string; onPress: () => Promise<unknown> | void; hot?: string; primary?: boolean; dim?: boolean }

/** A button; with `large targets` on it gets padding around it, with `hotkeys` on it gets its hotkey. */
const B = (c: PaneCtx, p: Btn) => {
  const { Box, Button } = c.u
  const btn = (
    <Button
      key={p.key}
      label={p.label}
      onPress={() => p.onPress()}
      {...(c.hot && p.hot !== undefined ? { hotkey: p.hot } : {})}
      {...(p.primary === true ? { variant: 'primary' as const } : {})}
      {...(p.dim === true ? { dimColor: true } : {})}
    />
  )

  return c.large ? <Box padding="sm">{btn}</Box> : btn
}

const TextLine = (c: PaneCtx, l: Line) => (
  <c.u.Text mono dimColor={l.dim === true} bold={l.bold === true} color={toneColor(l.tone, c.g.accent)}>
    {l.t === '' ? ' ' : nb(l.t)}
  </c.u.Text>
)

/** A foldable section. With the accordion switch off every section is simply open. */
const Section = (c: PaneCtx, id: string, title: string, dflt: boolean, body: () => ReturnType<typeof TextLine>) => {
  const { Box, Text, Button } = c.u

  if (!c.g.on('accordion')) {
    return (
      <Box flexDirection="column" gap="xs">
        <Text weight="semibold">{title}</Text>
        {body()}
      </Box>
    )
  }
  const isOpen = c.acc[id] ?? dflt

  return (
    <Box flexDirection="column" gap="xs">
      <Button key={`acc-${id}`} plain label={`${isOpen ? '▾' : '▸'} ${title}`} onPress={() => c.act.acc(id, isOpen)} />
      {isOpen && body()}
    </Box>
  )
}

const EMPTY_ACTIONS = (c: PaneCtx) => (
  <c.u.Box gap="sm" flexWrap="wrap">
    {B(c, { key: 'empty-demo', label: 'Show sample data', onPress: c.act.demo, primary: true })}
    {B(c, { key: 'empty-lab', label: 'Try the Lab', onPress: () => c.act.view('lab') })}
  </c.u.Box>
)

const EmptyState = (c: PaneCtx, text: string) => (
  <c.u.Box flexDirection="column" gap="xs" borderStyle="round" borderColor="subtle" padding="sm">
    <c.u.Text>{text}</c.u.Text>
    <c.u.Text dimColor size="caption">
      Sample data fills every view with made-up numbers so you can see how it looks. /ui lists every command.
    </c.u.Text>
    {EMPTY_ACTIONS(c)}
  </c.u.Box>
)

const ErrorState = (c: PaneCtx, what: string, why: string) => (
  <c.u.Box flexDirection="column" gap="xs" borderStyle="round" borderColor="error" padding="sm">
    <c.u.Text color="error" weight="semibold">
      {what} could not be drawn.
    </c.u.Text>
    <c.u.Text dimColor size="caption">
      {why.slice(0, 120)}
    </c.u.Text>
    {B(c, { key: 'retry', label: 'Retry', onPress: c.act.retry, hot: 'r', primary: true })}
  </c.u.Box>
)

const Skeleton = (c: PaneCtx, look: Look) => {
  const { Svg, Box, Text } = c.u

  if (c.isDesktop && Svg !== undefined) {
    return <Svg source={skeletonSvg(look)} alt="Loading" {...svgSize(skeletonSvg(look))} />
  }

  return (
    <Box flexDirection="column">
      {['░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░'].map(t => (
        <Text mono dimColor>
          {t}
        </Text>
      ))}
    </Box>
  )
}

const LIST_TITLES: Record<string, string> = {
  timeline: 'Calls',
  files: 'Files',
  errors: 'Kinds of failure',
  prompts: 'Prompts',
  spend: 'Turns',
  activity: 'Busiest days',
}

/** The list under a chart: master-detail when wide, expandable rows otherwise, plain rows if both are off. */
const ItemList = (c: PaneCtx, view: ViewOut, opts: { compact: boolean }) => {
  const { Box, Text, Button } = c.u
  const limit = opts.compact ? 5 : c.bp === 'narrow' ? 8 : 12
  const items: Item[] = view.items.slice(0, limit)

  if (items.length === 0) {
    return <Text dimColor>Nothing to list yet.</Text>
  }
  const rowKey = (it: Item) => `${view.id}:${it.id}`
  const head = (it: Item, mark: string) => `${mark} ${it.title.slice(0, 48)} `
  const tone = (it: Item) => toneColor(it.tone, c.g.accent)

  if (c.g.on('master-detail') && c.bp === 'wide' && !opts.compact) {
    const selId = c.st.sel[view.id] ?? items[0]?.id
    const sel = items.find(i => i.id === selId) ?? items[0]

    return (
      <Box flexDirection="row" gap="md">
        <Box flexDirection="column" flexGrow={1}>
          {items.map(it => (
            <Button key={`pick-${rowKey(it)}`} plain onPress={() => c.act.sel(view.id, it.id)}>
              {head(it, it.id === sel?.id ? '●' : '○')}
              <Text color={tone(it)} dimColor={it.tone === undefined}>
                {it.meta}
              </Text>
            </Button>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="subtle" paddingX="sm">
          {sel === undefined ? (
            <Text dimColor>Pick a row.</Text>
          ) : (
            <Box flexDirection="column">
              <Text weight="semibold">{sel.title.slice(0, 60)}</Text>
              <Box flexDirection="column">
                {sel.detail.map(l => (
                  <Text dimColor>{l}</Text>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  if (c.g.on('expand-rows')) {
    return (
      <Box flexDirection="column">
        {items.map(it => {
          const isOpen = c.st.open.includes(rowKey(it))

          return (
            <Box flexDirection="column">
              <Button key={`row-${rowKey(it)}`} plain onPress={() => c.act.row(rowKey(it))}>
                {head(it, isOpen ? '▾' : '▸')}
                <Text color={tone(it)} dimColor={it.tone === undefined}>
                  {it.meta}
                </Text>
              </Button>
              {isOpen && (
                <Box flexDirection="column" paddingLeft="md">
                  {it.detail.map(l => (
                    <Text dimColor>{l}</Text>
                  ))}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {items.map(it => (
        <Text>
          {it.title.slice(0, 48)} <Text dimColor>{it.meta}</Text>
        </Text>
      ))}
    </Box>
  )
}

/** Tool rows with a tiny chart at the end: an image on the desktop app, block characters elsewhere. */
const ToolRows = (c: PaneCtx, view: ViewOut, cols: number) => {
  const { Box, Text, Svg } = c.u

  return (
    <Box flexDirection="column">
      {view.tools.map(r =>
        c.g.on('inline-sparks') && c.isDesktop && Svg !== undefined ? (
          <Box gap="sm" alignItems="center">
            <Text mono>{nb(r.tool.padEnd(10).slice(0, 10))}</Text>
            <Svg source={tinySpark(r.series, `${r.tool}: ${r.count} calls, spread over this session`, c.g.accent)} alt={`${r.tool} calls over time`} isInteractive {...svgSize(tinySpark(r.series, `${r.tool}: ${r.count} calls, spread over this session`, c.g.accent))} />
            <Text dimColor>{String(r.count)}</Text>
          </Box>
        ) : c.g.on('inline-sparks') ? (
          TextLine(c, toolLine(r, cols))
        ) : (
          <Text mono>{nb(`${r.tool.padEnd(10).slice(0, 10)} ${r.count}`)}</Text>
        ),
      )}
    </Box>
  )
}

const Nums = (c: PaneCtx, nums: readonly Num[]) => {
  const hot = nums.some(n => c.pulseKeys.includes(n.key))

  return (
    <c.u.Text bold color={hot ? 'warning' : undefined}>
      {nums.map(n => `${n.label} ${n.value}`).join('  ·  ')}
    </c.u.Text>
  )
}

const viewPanel = (c: PaneCtx, id: Exclude<ViewId, 'lab'>, opts: { cols: number; half: boolean; compact: boolean }) => {
  const { Box, Text, Svg, Progress } = c.u
  const enter = c.g.animate && c.g.on('entrance') && c.now - c.st.enterAt < ENTER_MS
  const look: Look = { accent: c.g.accent, animate: c.g.animate, enter, pulse: c.pulseKeys, W: svgWidth(c.bp, c.st.mini ? 280 : c.cols, opts.half) }
  const loading = c.g.on('skeleton') && c.g.animate && c.now < c.st.loadingUntil

  if (loading) {
    return (
      <Box flexDirection="column" gap={c.g.gap}>
        <Text size="heading" weight="bold">
          {VIEWS.find(v => v.id === id)?.label ?? id}
        </Text>
        {Skeleton(c, look)}
      </Box>
    )
  }
  const view = buildView(id, c.data, { cols: opts.cols, svg: c.isDesktop && Svg !== undefined, look, icons: c.g.icons, compact: opts.compact, showMsg: c.g.on('error-text') })

  if (view.empty !== undefined) {
    return (
      <Box flexDirection="column" gap={c.g.gap}>
        <Text size="heading" weight="bold">
          {view.title}
        </Text>
        {EmptyState(c, view.empty)}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={c.g.gap}>
      <Text size="heading" weight="bold">
        {view.title}
      </Text>
      {view.svg !== undefined && Svg !== undefined ? <Svg source={view.svg.source} alt={view.svg.alt} isInteractive {...svgSize(view.svg.source)} /> : (
        <>
          {Nums(c, view.nums)}
          <Box flexDirection="column">{view.lines.map(l => TextLine(c, l))}</Box>
        </>
      )}
      {id === 'timeline' && c.g.on('eta') && view.running !== undefined && (
        <Progress
          label={`Running: ${view.running} (${dur(view.runningMs)})`}
          {...(view.eta === undefined ? {} : { value: view.eta.fraction })}
          valueText={
            view.eta === undefined
              ? 'no estimate yet (needs 3 earlier calls of this tool)'
              : `about ${dur(view.eta.leftMs)} left, a guess from ${view.eta.samples} similar calls`
          }
        />
      )}
      {view.tools.length > 0 && Section(c, `${id}.tools`, 'Tools this session', true, () => ToolRows(c, view, opts.cols))}
      {Section(c, `${id}.list`, LIST_TITLES[id] ?? 'List', true, () => ItemList(c, view, { compact: opts.compact }))}
      {!opts.compact &&
        Section(c, `${id}.about`, 'About this view', false, () => (
          <Box flexDirection="column">
            {view.about.map(t => (
              <Text dimColor>{t}</Text>
            ))}
            <Text dimColor>Hover a mark in the picture for its details. Text charts on other surfaces use block characters.</Text>
          </Box>
        ))}
    </Box>
  )
}

// ---------------------------------------------------------------- the lab

const STEPS = ['Pick a view', 'Pick a layout', 'Pick an option', 'Review'] as const
const CHOICES: readonly (readonly string[])[] = [
  ['Timeline', 'Files', 'Errors'],
  ['Single', 'Split', 'Mini'],
  ['Large targets', 'Hotkeys', 'Neither'],
]

const labRow = (c: PaneCtx, x: LabItem) => {
  const { Box, Text, Button, Input } = c.u
  const state = x.pending ? 'saving…' : c.now - x.okAt < 1500 && x.okAt > 0 ? 'confirmed' : ''
  const tick = x.on ? '☑' : '☐'

  return (
    <Box gap="sm" flexWrap="wrap" alignItems="center">
      <Button key={`lab-tg-${x.id}`} plain onPress={() => c.act.toggle(x.id)}>
        {`${tick} `}
        <Text dimColor={!x.on}>{x.name}</Text>
      </Button>
      {state !== '' && (
        <Text color={x.pending ? 'warning' : 'success'} size="caption">
          {state}
        </Text>
      )}
      {c.lab.editing === x.id ? (
        <>
          <Input key={`lab-in-${x.id}`} label="Name" value={x.name} autoFocus onSubmit={v => c.act.rename(x.id, v)} />
          {B(c, { key: `lab-cancel-${x.id}`, label: 'Cancel', onPress: c.act.cancel, dim: true })}
        </>
      ) : (
        <>
          {B(c, { key: `lab-ren-${x.id}`, label: 'Rename', onPress: () => c.act.edit(x.id), dim: true })}
          {B(c, { key: `lab-mv-${x.id}`, label: x.list === 'a' ? 'Move →' : '← Move', onPress: () => c.act.move(x.id), dim: true })}
          {B(c, { key: `lab-rm-${x.id}`, label: 'Remove', onPress: () => c.act.remove(x.id), dim: true })}
        </>
      )}
    </Box>
  )
}

const labPanel = (c: PaneCtx) => {
  const { Box, Text, Input, Svg } = c.u
  const lab = c.lab
  const stepper = c.isDesktop && Svg !== undefined
  const look: Look = { accent: c.g.accent, animate: c.g.animate, enter: false, pulse: [], W: svgWidth(c.bp, c.cols, false) }
  const checkLook: Look = { ...look, animate: c.g.animate && c.g.on('checkmark') }
  const lists = (
    <Box flexDirection={c.bp === 'wide' ? 'row' : 'column'} gap="md">
      {(['a', 'b'] as const).map(l => (
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="subtle" paddingX="sm">
          <Text weight="semibold">{l === 'a' ? 'Inbox' : 'Done'}</Text>
          {lab.items.filter(x => x.list === l).length === 0 && <Text dimColor>Empty. Use Move on a row in the other list.</Text>}
          {lab.items.filter(x => x.list === l).map(x => labRow(c, x))}
        </Box>
      ))}
    </Box>
  )
  const undo = lab.undo !== null && c.now - lab.undo.at <= UNDO_MS ? lab.undo : null
  const picks = lab.picks
  const review = `You picked: ${CHOICES[0]?.[picks[0] ?? 0] ?? ''}, ${CHOICES[1]?.[picks[1] ?? 0] ?? ''}, ${CHOICES[2]?.[picks[2] ?? 0] ?? ''}. Nothing is applied: this is a demo of Next and Back.`

  return (
    <Box flexDirection="column" gap={c.g.gap}>
      <Text size="heading" weight="bold">
        Lab
      </Text>
      <Text dimColor>Working demos of the interaction patterns. Nothing here records anything about your session.</Text>
      {undo !== null && (
        <Box gap="sm" alignItems="center">
          <Text color="warning">{`Removed "${undo.item.name}".`}</Text>
          {B(c, { key: 'lab-undo', label: 'Undo', onPress: c.act.undo, hot: 'u' })}
        </Box>
      )}
      {Section(c, 'lab.lists', 'Two lists: move, rename, toggle, remove', true, () => (
        <Box flexDirection="column" gap="xs">
          {lists}
          <Input key="lab-add" label="Add" placeholder="New item, then Enter" onSubmit={v => c.act.add(v)} />
          <Text dimColor size="caption">
            Toggle shows the new state at once, then confirms a moment later (only with motion on). Remove can be undone for 30 s with the Undo button or /uiundo.
          </Text>
        </Box>
      ))}
      {Section(c, 'lab.stepper', 'A four step wizard', true, () => (
        <Box flexDirection="column" gap="xs">
          {stepper && Svg !== undefined ? (
            <Svg source={stepperSvg(STEPS, lab.step, look)} alt={`Step ${lab.step + 1} of 4: ${STEPS[lab.step]}`} {...svgSize(stepperSvg(STEPS, lab.step, look))} />
          ) : (
            <Text mono>{nb(STEPS.map((s, i) => `${i < lab.step ? '✓' : i === lab.step ? '●' : '○'} ${s}`).join('  '))}</Text>
          )}
          {lab.done ? (
            <Box flexDirection="column" gap="xs">
              {c.g.on('checkmark') && stepper && Svg !== undefined ? <Svg source={checkSvg(checkLook, 'Done')} alt="Done" {...svgSize(checkSvg(checkLook, 'Done'))} /> : <Text color="success">✓ Done</Text>}
              <Text>{review}</Text>
              {B(c, { key: 'lab-restart', label: 'Start over', onPress: c.act.restart })}
            </Box>
          ) : (
            <Box flexDirection="column" gap="xs">
              <Text weight="semibold">{`Step ${lab.step + 1}: ${STEPS[lab.step]}`}</Text>
              {lab.step < 3 ? (
                <Box gap="sm" flexWrap="wrap">
                  {(CHOICES[lab.step] ?? []).map((name, i) =>
                    B(c, { key: `lab-pick-${lab.step}-${i}`, label: name, primary: (picks[lab.step] ?? 0) === i, onPress: () => c.act.pick(lab.step, i) }),
                  )}
                </Box>
              ) : (
                <Text>{review}</Text>
              )}
              <Box gap="sm">
                {lab.step > 0 && B(c, { key: 'lab-back', label: 'Back', onPress: () => c.act.step(-1), hot: 'b' })}
                {lab.step < 3
                  ? B(c, { key: 'lab-next', label: 'Next', onPress: () => c.act.step(1), hot: 'n', primary: true })
                  : B(c, { key: 'lab-finish', label: 'Finish', onPress: c.act.finish, hot: 'n', primary: true })}
              </Box>
            </Box>
          )}
        </Box>
      ))}
      {Section(c, 'lab.notes', 'What this app cannot do', false, () => (
        <Box flexDirection="column">
          <Text dimColor>Drag and drop: plugins get no pointer or drag events, so the lists use Move buttons.</Text>
          <Text dimColor>Detaching a pane: not possible; /uiwidget opens a small second pane where the app has widgets.</Text>
          <Text dimColor>Hover cards: only the plain tooltips of the vector pictures (SVG titles), nothing richer.</Text>
          <Text dimColor>Offline banner: the app tells plugins nothing about the connection, so there is none.</Text>
        </Box>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------- the pane

const miniPanel = (c: PaneCtx, widget: boolean) => {
  const { Box, Text, Svg } = c.u
  const nums = miniNums(c.data)
  const enter = c.g.animate && c.g.on('entrance') && c.now - c.st.enterAt < ENTER_MS
  const look: Look = { accent: c.g.accent, animate: c.g.animate, enter, pulse: c.pulseKeys, W: 280 }

  return (
    <Box flexDirection="column" gap={c.g.gap}>
      {c.isDesktop && Svg !== undefined ? (
        <Svg source={miniSvg(nums, look)} alt={nums.map(n => `${n.label} ${n.value}`).join(', ')} isInteractive={!widget} {...svgSize(miniSvg(nums, look))} />
      ) : (
        <Text mono bold color={nums.some(n => c.pulseKeys.includes(n.key)) ? 'warning' : undefined}>
          {nb(nums.map(n => `${n.label} ${n.value}`).join('   '))}
        </Text>
      )}
      {c.data.isDemo && <Text color="warning" size="caption">sample data</Text>}
      {!widget && B(c, { key: 'ui-expand', label: 'Full view', onPress: c.act.mini, hot: 'm', primary: true })}
    </Box>
  )
}

const bodyOf = (c: PaneCtx, id: ViewId, half: boolean, compact: boolean, cols: number) => {
  try {
    if (c.st.failOnce) {
      throw new Error('forced by /uifail: press Retry')
    }

    return id === 'lab' ? labPanel(c) : viewPanel(c, id, { cols, half, compact })
  } catch (err) {
    return ErrorState(c, VIEWS.find(v => v.id === id)?.label ?? 'This view', err instanceof Error ? err.message : String(err))
  }
}

type RenderEvent = Parameters<Hook<'ui.render'>>[1]

const paneTree = async ($: Dollar, e: RenderEvent, isWidget: boolean) => {
  const ui = $.ui.resolve(e)
  const isDesktop = SVG_SURFACES.includes(e.surface)
  const u: UI = {
    Box: ui.Box,
    Text: ui.Text,
    Button: ui.Button,
    Input: ui.Input,
    Progress: ui.Progress,
    Svg: isDesktop ? (ui as ElementTable<'desktop'>).Svg : undefined,
  }
  const g = await readGates($)
  const st = await read($, uiA)
  const now = await $.clock.now()
  const cols = Math.max(20, (e.props as { bodyColumns: number }).bodyColumns)
  const placement = (e.props as { placement?: string }).placement
  const data = await buildData($)
  await read($, tickA)
  const c: PaneCtx = {
    u,
    g,
    st,
    lab: await read($, labA),
    acc: (await read($, accA)) as Record<string, boolean>,
    now,
    cols,
    bp: breakpointOf(cols),
    act: makeActs($),
    hot: g.on('hotkeys'),
    large: g.on('large-targets'),
    data,
    pulseKeys: g.animate && g.on('pulse') && now - st.pulseAt < PULSE_MS ? st.pulseKeys : [],
    isDesktop,
  }
  const { Box, Text } = u

  if (isWidget || placement === 'widget') {
    return <Box padding="xs">{miniPanel(c, true)}</Box>
  }

  if (st.mini) {
    return <Box padding={g.gap}>{miniPanel(c, false)}</Box>
  }
  const split = g.on('split') && st.view !== 'lab' && st.split !== 'none' ? st.split : undefined
  const wide = c.bp === 'wide'
  const label = (v: { short: string; label: string }) => (c.bp === 'narrow' ? v.short : v.label)
  const celebrating = g.on('confetti') && st.celebrateN > 0 && now - st.celebrateAt < CELEBRATE_MS
  const undo = c.lab.undo !== null && now - c.lab.undo.at <= UNDO_MS && st.view !== 'lab'

  return (
    <Box flexDirection="column" padding={g.gap} gap={g.gap}>
      <Box gap="xs" flexWrap="wrap">
        {VIEWS.map(v =>
          B(c, { key: `view-${v.id}`, label: st.view === v.id ? `[${label(v)}]` : label(v), primary: st.view === v.id, hot: v.key, onPress: () => c.act.view(v.id) }),
        )}
      </Box>
      <Box gap="xs" flexWrap="wrap" alignItems="center">
        {g.on('split') && st.view !== 'lab' && B(c, { key: 'ui-split', label: `Split: ${split === undefined ? 'off' : (VIEWS.find(v => v.id === split)?.label ?? split)}`, onPress: c.act.split, hot: 's', dim: split === undefined })}
        {B(c, { key: 'ui-mini', label: 'Mini', onPress: c.act.mini, hot: 'm', dim: true })}
        {B(c, { key: 'ui-demo', label: data.isDemo ? 'Sample data: on' : 'Sample data: off', onPress: c.act.demo, hot: 'd', dim: !data.isDemo })}
        {undo && B(c, { key: 'ui-undo', label: 'Undo removal', onPress: c.act.undo, hot: 'u' })}
      </Box>
      {data.isDemo && (
        <Text color="warning" size="caption">
          SAMPLE DATA: made up, nothing here was recorded. Press Sample data to go back to your own.
        </Text>
      )}
      {celebrating &&
        (isDesktop && u.Svg !== undefined ? (
          <u.Svg source={confettiSvg({ accent: g.accent, animate: g.animate, enter: false, pulse: [], W: svgWidth(c.bp, cols, false) }, `${st.celebrateN} tool calls this session`)} alt={`Milestone: ${st.celebrateN} tool calls`} />
        ) : (
          <Text color="success">{`★ Milestone: ${st.celebrateN} tool calls this session`}</Text>
        ))}
      {split === undefined ? (
        bodyOf(c, st.view, false, false, cols)
      ) : (
        <Box flexDirection={wide ? 'row' : 'column'} gap="md">
          <Box flexDirection="column" flexGrow={1}>
            {bodyOf(c, st.view, wide, true, wide ? Math.floor((cols - 3) / 2) : cols)}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {bodyOf(c, split, wide, true, wide ? Math.floor((cols - 3) / 2) : cols)}
          </Box>
        </Box>
      )}
      <Text dimColor size="caption">
        {isDesktop ? 'Pictures are vector drawings; hover a mark for details.' : 'Text charts: block and box characters, not images.'} /ui lists every command.
      </Text>
    </Box>
  )
}

/** Whatever goes wrong while the pane is built, the person gets a sentence and a Retry, never a blank pane. */
const safePane = async ($: Dollar, e: RenderEvent, isWidget: boolean) => {
  try {
    return await paneTree($, e, isWidget)
  } catch (err) {
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" padding="sm" gap="xs">
        <Text color="error">The UI kit pane could not be drawn.</Text>
        <Text dimColor size="caption">
          {String(err instanceof Error ? err.message : err).slice(0, 120)}
        </Text>
        <Button key="retry" label="Retry" variant="primary" onPress={() => bump($)} />
      </Box>
    )
  }
}

// ---------------------------------------------------------------- commands

const COMMANDS = [
  ['ui', 'List every UI kit command'],
  ['uiviews', 'Open the pane: /uiviews [timeline|files|errors|prompts|spend|activity|lab] [split <view>|split off]'],
  ['uimini', 'Switch the pane to its mini mode (three numbers) and back'],
  ['uiwidget', 'Open a second small pane as a widget where the app has widgets'],
  ['uifull', 'Open the pane as large as the app allows, with the keyboard'],
  ['uiundo', 'Bring back the Lab item removed in the last 30 seconds'],
  ['uidemo', 'Fill every view with made-up sample data: /uidemo on|off'],
  ['uifail', 'Make the next draw of a view fail once, to try the Retry button'],
  ['uiswitches', 'Show every ui-kit switch (on or off) and how to change it'],
  ['uireset', 'Clear what this mod recorded (add "all" to also reset the Lab, folds and layout)'],
] as const

const HELP = [
  'UI kit: six views over what this session did (timeline, files, errors, prompts, spend, activity) plus a Lab of UI patterns, in one pane, ui-kit-main.',
  ...COMMANDS.map(([name, text]) => `/${name}  ${text}`),
  'Switches: /cfg feature ui-kit.<id> on|off (see /uiswitches). Large targets and keyboard-first are switches too.',
].join('\n')

const openPane = async ($: Dollar, full = false): Promise<{ isPlaced: boolean }> => {
  const hot = await sw($, 'hotkeys')
  const now = await $.clock.now()
  await update($, uiA, s => ({ ...s, enterAt: now }))

  try {
    const res = await $.ui.open({
      id: PANE,
      title: 'UI kit',
      ...(hot || full ? { focus: true as const } : {}),
      ...(full ? { closeOnEscape: true as const, rows: 200, columns: 200 } : {}),
    })

    return { isPlaced: res.isPlaced }
  } catch {
    return { isPlaced: false }
  }
}

const parseViews = (args: string): { view?: ViewId; split?: ViewId | 'none'; error?: string } => {
  const words = args.toLowerCase().split(/\s+/).filter(Boolean)
  const out: { view?: ViewId; split?: ViewId | 'none'; error?: string } = {}

  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? ''

    if (w === 'split') {
      const v = words[i + 1] ?? ''

      if (v === 'off' || v === 'none') {
        out.split = 'none'
      } else if (isView(v) && v !== 'lab') {
        out.split = v
      } else {
        out.error = `split needs a view (${DATA_VIEWS.join(', ')}) or off.`
      }
      i += 1
    } else if (isView(w)) {
      out.view = w
    } else {
      out.error = `Unknown word "${w.slice(0, 20)}". Views: ${VIEWS.map(v => v.id).join(', ')}.`
    }
  }

  return out
}

const switchList = async ($: Dollar): Promise<string> => {
  const o = (await read($, featuresA)) as Overrides

  return [
    'ui-kit switches (change with /cfg feature ui-kit.<id> on|off):',
    ...Object.keys(SWITCH_DEFAULTS).map(id => `ui-kit.${id}: ${switchOn(o, id) ? 'on' : 'off'}${o[`ui-kit.${id}`] === undefined ? '' : ' (changed)'}`),
  ].join('\n')
}

const resetData = async ($: Dollar, all: boolean) => {
  const t = await $.clock.now()
  await update($, callsA, () => [])
  await update($, editsA, () => [])
  await update($, promptsA, () => [])
  await update($, samplesA, () => [])
  await update($, daysA, () => ({}))
  await update($, hoursA, () => cleanHours(undefined))
  await update($, totalA, () => 0)
  await update($, isDemoA, () => false)
  await update($, uiA, s => ({ ...s, open: [], sel: {}, pulseKeys: [], pulseAt: 0, celebrateAt: 0, celebrateN: 0, failOnce: false, ...(all ? { view: 'timeline' as const, split: 'none' as const, mini: false, enterAt: t } : {}) }))
  await $.store.set('days', {})
  await $.store.set('hours', cleanHours(undefined))

  if (all) {
    await update($, labA, () => DEFAULT_LAB)
    await update($, accA, () => ({}))
    await $.store.set('lab', labToStore(DEFAULT_LAB))
    await $.store.set('acc', {})
    await $.store.set('prefs', { view: 'timeline', split: 'none', mini: false })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await loadStore($).catch(() => undefined)
    await update($, startedA, () => 0)
    await update($, totalA, () => 0)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta !== true && e.text.trim() !== '' && (await sw($, 'record-prompts'))) {
      const at = await $.clock.now()
      const snip = (await sw($, 'prompt-snippets')) ? redact(e.text, CAP.snip) : ''
      await update($, promptsA, list => addPrompt(list, { at, len: e.text.length, snip }))
      await pulse($, ['prompts', 'median', 'longest'], at)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!(await sw($, 'record').catch(() => false))) {
      return next(e)
    }
    const input = asRecord(e)
    const t = await $.clock.now()
    const id = `${e.tool_use_id ?? e.tool}-${t}`
    await beginCall($, { id, tool: e.tool, detail: detailOf(e.tool, input), startedAt: t, endedAt: null, isError: false, msg: '', out: 0 }).catch(() => undefined)
    let ran: Awaited<ReturnType<typeof next>>

    try {
      ran = await next(e)
    } catch (err) {
      await finishCall($, id, e.tool, input, true, String(err)).catch(() => undefined)
      throw err
    }
    const isFailed = ran.deny !== undefined || ran.isError === true
    await finishCall($, id, e.tool, input, isFailed, ran.deny ?? ran.text ?? '').catch(() => undefined)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (await sw($, 'record-spend')) {
      await sampleSpend($).catch(() => undefined)
    }
    await syncTicker($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'ui' }, async () => ({ text: HELP }))

  on('command.run', { command: 'uiviews' }, async ($, e) => {
    const p = parseViews(e.args)

    if (p.error !== undefined) {
      return { text: p.error }
    }

    if (p.view !== undefined) {
      await actView($, p.view)
    }

    if (p.split !== undefined) {
      await update($, uiA, s => ({ ...s, split: p.split === s.view ? 'none' : (p.split ?? 'none') }))
      await savePrefs($)
    }
    await update($, uiA, s => ({ ...s, mini: false }))
    const res = await openPane($)
    const s = await read($, uiA)

    return { text: `UI kit: ${s.view}${s.split === 'none' ? '' : ` with ${s.split} beside it`}.${res.isPlaced ? '' : ' The pane is open but not drawn yet: it needs a wider window or a surface that draws panes.'}` }
  })

  on('command.run', { command: 'uimini' }, async $ => {
    await actMini($)
    await openPane($)

    return { text: (await read($, uiA)).mini ? 'Mini mode on: three numbers.' : 'Mini mode off.' }
  })

  on('command.run', { command: 'uiwidget' }, async $ => {
    try {
      const res = await $.ui.open({ id: WIDGET, title: 'UI kit mini', placement: 'widget' })

      return {
        text: res.isPlaced
          ? 'Opened the small pane. On the desktop app it starts as a widget; anywhere else (terminal, VS Code) it opens as an ordinary pane, since only the desktop app has widgets.'
          : 'The small pane is open but not drawn yet (it needs a surface that draws panes).',
      }
    } catch {
      return { text: 'The app refused to open the small pane.' }
    }
  })

  on('command.run', { command: 'uifull' }, async $ => {
    const res = await openPane($, true)

    return {
      text: `Asked for the largest pane the app allows (200 rows, 200 columns, keyboard focus, Esc closes). The app caps this: the dock is at most 45% of the terminal width, so it is large, not true full screen.${res.isPlaced ? '' : ' It is not drawn yet.'}`,
    }
  })

  on('command.run', { command: 'uiundo' }, async $ => ({ text: await labUndo($) }))

  on('command.run', { command: 'uidemo' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg !== '' && arg !== 'on' && arg !== 'off') {
      return { text: 'Use /uidemo on or /uidemo off.' }
    }
    await actDemo($, arg === '' ? undefined : arg === 'on')

    if (arg !== 'off') {
      await openPane($)
    }

    return { text: (await read($, isDemoA)) ? 'Showing made-up sample data in every view. /uidemo off returns to your own.' : 'Sample data off.' }
  })

  on('command.run', { command: 'uifail' }, async $ => {
    await update($, uiA, s => ({ ...s, failOnce: true }))
    await openPane($)

    return { text: 'The next draw of a view will fail once, so you can try the Retry button.' }
  })

  on('command.run', { command: 'uiswitches' }, async $ => ({ text: await switchList($) }))

  on('command.run', { command: 'uireset' }, async ($, e) => {
    const all = e.args.trim().toLowerCase() === 'all'
    await resetData($, all)

    return { text: all ? 'Cleared everything this mod recorded, plus the Lab, folds and layout.' : 'Cleared the recorded calls, edits, prompts, readings and daily totals.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => safePane($, e, false))
  on('ui.render', { component: 'Pane', requestId: WIDGET }, ($, e) => safePane($, e, true))
}
