import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import type { Data } from '../types'
import {
  CHARTS,
  addNote,
  applyCall,
  applyPrompt,
  applyTurn,
  chartOf,
  demoData,
  demoUsage,
  easeOut,
  emptyData,
  progress,
  ringBorder,
  sanitize,
  shownRows,
  sparkleRow,
  toneOf,
} from './pure'
import type { Row, UsageLite } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]

// ---- foreign atoms (read only): `motion` owns isOn, `settings` owns the rest -------------------
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const calmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')

// ---- this mod's own atoms ----------------------------------------------------------------------
// Change a shape tag when the stored fields change: it declines what an earlier version stored.
const dataA = atom({ plugin: 'charts-more', key: 'data' } as const, emptyData(), { shape: 'data-1' })
const tabA = atom({ plugin: 'charts-more', key: 'tab' } as const, 'hist')
const demoA = atom({ plugin: 'charts-more', key: 'demo' } as const, false)
const nowA = atom({ plugin: 'charts-more', key: 'now' } as const, 0)
const enterA = atom({ plugin: 'charts-more', key: 'enterAt' } as const, 0)
const openA = atom({ plugin: 'charts-more', key: 'openAt' } as const, 0)
const fadeA = atom({ plugin: 'charts-more', key: 'fadeAt' } as const, 0)
const sparkleA = atom({ plugin: 'charts-more', key: 'sparkleAt' } as const, 0)
const ctxPctA = atom({ plugin: 'charts-more', key: 'ctxPct' } as const, 0)

const PANE = 'charts-more-main'
const STORE_KEY = 'cm.data'
const TICK_MS = 150
const GROW_MS = 600
const SHUFFLE_MS = 400
const FADE_MS = 200
const SPARKLE_MS = 1500
const SPARKLE_SHOW_MS = 20_000
const RING_MIN = 60
const TOAST_GAP_MS = 180_000

// ---- the one shared ticker: it starts when a frame is needed and stops itself when none is --------
let ticker: Timer | undefined
let animUntil = 0
let lastToastAt = 0

const tickOnce = async ($: Dollar) => {
  const t = await $.clock.now()
  await update($, nowA, () => t)

  if (t >= animUntil) {
    ticker?.cancel()
    ticker = undefined
  }
}

const kick = async ($: Dollar, ms: number) => {
  const t = await $.clock.now()
  animUntil = Math.max(animUntil, t + ms + TICK_MS)

  if (ticker === undefined) {
    ticker = $.clock.every(TICK_MS, () => {
      void tickOnce($)
    })
  }
}

/** Animation is allowed only when the global motion switch is on and settings are not calm. */
const animOk = async ($: Dollar): Promise<boolean> => {
  const flag = await $.store.get('motion')
  const isStoredOff = flag === false || flag === 'off' || flag === 0 || flag === 'false'

  return (await read($, motionIsOn)) && !isStoredOff && !(await read($, calmA))
}

// ---- recording ----------------------------------------------------------------------------------
const mutate = async ($: Dollar, fn: (d: Data) => Data) => {
  await update($, dataA, fn)
  await $.store.set(STORE_KEY, await read($, dataA))
}

const asInput = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {})

const isFailure = (r: unknown): boolean => {
  const o = asInput(r)

  return typeof o.deny === 'string' || o.isError === true
}

const recordCall = async ($: Dollar, e: unknown, tool: string, start: number, ok: boolean) => {
  const end = await $.clock.now()
  const input = asInput(e)
  const isEdit = tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit'
  const file = isEdit ? (typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined) : undefined
  const edit = tool === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string' ? { old: input.old_string, neu: input.new_string } : undefined
  const before = await read($, dataA)
  await mutate($, d => applyCall(d, { tool, ms: end - start, ok, now: end, file, edit }))
  const after = await read($, dataA)

  // 140: a stored best is beaten (only from 10 in a row on, so early streaks stay quiet).
  if (after.best > before.best && after.best >= 10) {
    await update($, sparkleA, () => end)

    if (await animOk($)) {
      await kick($, SPARKLE_MS)
    }

    if (!(await read($, calmA)) && end - lastToastAt > TOAST_GAP_MS) {
      lastToastAt = end
      await $.ui.toast(`New best streak: ${after.best} successful tool calls in a row`, { timeoutMs: 4000 })
    }
  }
}

const recordPrompt = async ($: Dollar, text: string, isCommand: boolean) => {
  const now = await $.clock.now()
  await mutate($, d => applyPrompt(d, { text, now, isCommand }))
}

const recordTurn = async ($: Dollar, durationMs: number, model: string | undefined) => {
  const now = await $.clock.now()
  let usd: number | undefined

  try {
    usd = (await $.session.usage()).cost?.usd
  } catch {
    usd = undefined
  }
  await mutate($, d => applyTurn(d, { sec: durationMs / 1000, now, model, usd }))
}

// ---- opening and switching ----------------------------------------------------------------------
const openChart = async ($: Dollar, id?: string): Promise<boolean> => {
  const t = await $.clock.now()

  if (id !== undefined) {
    await update($, tabA, () => id)
  }
  await update($, enterA, () => t)
  await update($, openA, () => t)

  if (await animOk($)) {
    await kick($, Math.max(GROW_MS, SHUFFLE_MS))
  }
  const r = await $.ui.open({ id: PANE, title: 'More charts' })

  return r.isPlaced
}

const pickTab = async ($: Dollar, id: string) => {
  const t = await $.clock.now()
  await update($, tabA, () => id)
  await update($, enterA, () => t)
  await update($, fadeA, () => t)

  if (await animOk($)) {
    await kick($, GROW_MS)
  }
}

const moveSplit = async ($: Dollar, by: number | null) => {
  await mutate($, d => ({ ...d, split: by === null ? 50 : Math.max(0, Math.min(100, d.split + by)) }))
}

// ---- what the pane reads --------------------------------------------------------------------------
const gather = async ($: Dollar): Promise<{ data: Data; usage: UsageLite; demo: boolean }> => {
  const demo = await read($, demoA)
  const t = await $.clock.now()

  if (demo) {
    return { data: demoData(t), usage: demoUsage(), demo }
  }
  const data = await read($, dataA)
  let usage: UsageLite = { limits: [] }

  try {
    const u = await $.session.usage()
    usage = {
      ctxPct: u.context.percent,
      usd: u.cost?.usd,
      limits: u.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })),
    }
  } catch {
    usage = { limits: [] }
  }

  return { data, usage, demo }
}

const HELP = [
  'More charts (text visuals; one pane `charts-more-main` with a picker):',
  '/cmhist   histogram of turn lengths',
  '/cmbox    box plot of tool durations',
  '/cmring   context ring (/cmring off|on hides or shows the row above the prompt)',
  '/cmtherm  thermometers for rate limits',
  '/cmbudget <usd>  fuel gauge for a budget (off clears it)',
  '/cmspeed  speedometer, turns per hour',
  '/cmbattery  focus battery (90 min target)',
  '/cmwords  word cloud (on | off | clear): counts only, never your prompts',
  '/cmnote <text> #tag  note network (rm <id> removes one)',
  '/cmtree   folder tree with edit activity',
  '/cmarea   layered cost per model',
  '/cmcandle daily activity ranges, 30 days',
  '/cmpie    where tool time went (a proportional bar: a true pie is not possible in text)',
  '/cmslide  before/after slider (before|after <text, \\n for newline> | auto | split <0-100>)',
  '/cmdemo   sample data in the pane, nothing recorded (/cmdemo off)',
  '/cmreset  clear everything this mod recorded',
].join('\n')

const COMMANDS: { name: string; description: string }[] = [
  { name: 'cm', description: 'More charts: list every chart command' },
  ...CHARTS.map(c => ({ name: c.command, description: `More charts: ${c.label} chart` })),
  { name: 'cmdemo', description: 'More charts: show sample data (nothing recorded)' },
  { name: 'cmreset', description: 'More charts: clear recorded data' },
]
const UNIQUE_COMMANDS = COMMANDS.filter((c, i) => COMMANDS.findIndex(x => x.name === c.name) === i)

const askOpen = async ($: Dollar, id: string, said: string): Promise<{ text: string }> => {
  const isPlaced = await openChart($, id)

  return { text: isPlaced ? said : `${said} (no surface is showing panes right now, so it will appear when one does)` }
}

const parseUsd = (s: string): number | undefined => {
  const n = Number(s.replace(/^\$/, ''))

  return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : undefined
}

const runWords = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  if (arg === 'off') {
    await mutate($, d => ({ ...d, wordsOff: true }))

    return { text: 'Word counting is off: nothing is recorded. Counts already kept stay until /cmwords clear.' }
  }

  if (arg === 'on') {
    await mutate($, d => ({ ...d, wordsOff: false }))

    return { text: 'Word counting is on: counts only (max 200 words, this week), never your prompts.' }
  }

  if (arg === 'clear') {
    await mutate($, d => ({ ...d, words: {}, wordsWeek: '' }))

    return { text: 'Word counts cleared.' }
  }
  const off = (await read($, dataA)).wordsOff

  return askOpen($, 'cloud', `Word cloud opened. Counting is ${off ? 'off' : 'on'} (/cmwords off to stop).`)
}

const runNote = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  const rm = /^rm\s+(\d+)$/.exec(arg)

  if (rm !== null) {
    const id = Number(rm[1])
    await mutate($, d => ({ ...d, notes: d.notes.filter(n => n.id !== id) }))

    return { text: `Note ${id} removed.` }
  }

  if (arg === '') {
    return askOpen($, 'notes', 'Note network opened. Add notes with /cmnote <text> #tag.')
  }
  const before = (await read($, dataA)).noteSeq
  await mutate($, d => addNote(d, arg))
  const d = await read($, dataA)

  return d.noteSeq === before ? { text: 'That note was empty.' } : { text: `Note ${d.noteSeq} saved (${d.notes.length} kept, max 60).` }
}

const runSlide = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  const m = /^(before|after)\s+([\s\S]*)$/.exec(arg)

  if (m !== null) {
    const body = m[2]!.replace(/\\n/g, '\n').slice(0, 1500)
    await mutate($, d => ({ ...d, [m[1]!]: body, manual: true }))

    return askOpen($, 'slide', `Stored the ${m[1]} text. The last Edit no longer overwrites it until /cmslide auto.`)
  }

  if (arg === 'auto') {
    await mutate($, d => ({ ...d, manual: false }))

    return { text: 'The slider follows your last Edit again.' }
  }
  const sp = /^split\s+(\d+)$/.exec(arg)

  if (sp !== null) {
    await mutate($, d => ({ ...d, split: Math.min(100, Number(sp[1])) }))
  }

  return askOpen($, 'slide', 'Before/after slider opened. Use the buttons to move the divider.')
}

const runRing = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  if (arg === 'off' || arg === 'on') {
    await mutate($, d => ({ ...d, ringOff: arg === 'off' }))

    return { text: `The context ring row above the prompt is ${arg === 'off' ? 'hidden' : 'shown (only above 60% context)'}.` }
  }

  return askOpen($, 'ring', 'Context ring opened.')
}

const runBudget = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  if (arg === '') {
    const b = (await read($, dataA)).budget

    return askOpen($, 'fuel', b > 0 ? `Budget is $${b}. Fuel gauge opened.` : 'No budget yet: type /cmbudget <usd>. Fuel gauge opened.')
  }

  if (arg === 'off' || arg === '0') {
    await mutate($, d => ({ ...d, budget: 0 }))

    return { text: 'Budget cleared.' }
  }
  const n = parseUsd(arg)

  if (n === undefined) {
    return { text: 'Give a number of dollars, like /cmbudget 10.' }
  }
  await mutate($, d => ({ ...d, budget: n }))

  return askOpen($, 'fuel', `Budget set to $${n}. This is a gauge only: nothing is blocked.`)
}

const runDemo = async ($: Dollar, arg: string): Promise<{ text: string }> => {
  const on = arg !== 'off'
  await update($, demoA, () => on)

  if (!on) {
    return { text: 'Demo data is off: the pane shows your own data again.' }
  }

  return askOpen($, 'hist', 'Demo data shown in the pane (sample numbers, nothing is recorded). /cmdemo off to stop.')
}

const runReset = async ($: Dollar): Promise<{ text: string }> => {
  const keep = await read($, dataA)
  const fresh = { ...emptyData(), wordsOff: keep.wordsOff, ringOff: keep.ringOff, budget: keep.budget, cwd: keep.cwd }
  await update($, dataA, () => fresh)
  await $.store.set(STORE_KEY, fresh)
  await update($, sparkleA, () => 0)

  return { text: 'Cleared everything charts-more recorded (kept your budget and the word and ring on/off choices).' }
}

const rowsToShow = (rows: Row[], n: number) => rows.slice(0, n)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const c of UNIQUE_COMMANDS) {
      await $.command.register({ name: c.name, description: c.description }).catch(() => undefined)
    }
    const stored = await $.store.get(STORE_KEY)
    const data = sanitize(stored)
    await update($, dataA, () => ({ ...data, cwd: e.cwd }))
    await $.store.set(STORE_KEY, { ...data, cwd: e.cwd })

    return next(e)
  })

  // ---- commands ----
  on('command.run', { command: 'cm' }, () => ({ text: HELP }))
  on('command.run', { command: 'cmhist' }, $ => askOpen($, 'hist', 'Turn-length histogram opened.'))
  on('command.run', { command: 'cmbox' }, $ => askOpen($, 'box', 'Tool-duration box plot opened.'))
  on('command.run', { command: 'cmring' }, ($, e) => runRing($, e.args.trim().toLowerCase()))
  on('command.run', { command: 'cmtherm' }, $ => askOpen($, 'therm', 'Rate-limit thermometers opened.'))
  on('command.run', { command: 'cmbudget' }, ($, e) => runBudget($, e.args.trim().toLowerCase()))
  on('command.run', { command: 'cmspeed' }, $ => askOpen($, 'speed', 'Speedometer opened.'))
  on('command.run', { command: 'cmbattery' }, $ => askOpen($, 'battery', 'Focus battery opened.'))
  on('command.run', { command: 'cmwords' }, ($, e) => runWords($, e.args.trim().toLowerCase()))
  on('command.run', { command: 'cmnote' }, ($, e) => runNote($, e.args.trim()))
  on('command.run', { command: 'cmtree' }, $ => askOpen($, 'tree', 'Project tree opened.'))
  on('command.run', { command: 'cmarea' }, $ => askOpen($, 'area', 'Cost-per-model chart opened.'))
  on('command.run', { command: 'cmcandle' }, $ => askOpen($, 'candle', 'Daily activity ranges opened.'))
  on('command.run', { command: 'cmpie' }, $ => askOpen($, 'pie', 'Time-by-tool bar opened (a true pie is not possible as text).'))
  on('command.run', { command: 'cmslide' }, ($, e) => runSlide($, e.args.trim()))
  on('command.run', { command: 'cmdemo' }, ($, e) => runDemo($, e.args.trim().toLowerCase()))
  on('command.run', { command: 'cmreset' }, $ => runReset($))

  // ---- recording: counts and durations only ----
  on('tool.call', async ($, e, next) => {
    const start = await $.clock.now()
    let result: unknown

    try {
      result = await next(e)
    } catch (err) {
      await recordCall($, e, e.tool, start, false).catch(() => undefined)
      throw err
    }
    await recordCall($, e, e.tool, start, !isFailure(result)).catch(() => undefined)

    return result as Awaited<ReturnType<typeof next>>
  })

  on('prompt.submit', async ($, e, next) => {
    const isCommand = e.command !== undefined || e.isMeta === true || e.text.trim().startsWith('/')
    await recordPrompt($, e.text, isCommand).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      await recordTurn($, e.durationMs, e.usage?.model).catch(() => undefined)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const p = e.context.percent

    if (typeof p === 'number') {
      await update($, ctxPctA, () => p)
    }

    return next(e)
  })

  // 57: one quiet row above the prompt, only while the context is over 60% full.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    const pct = await read($, ctxPctA)

    if (pct <= RING_MIN) {
      return inner
    }
    const data = await read($, dataA)
    const isCalm = await read($, calmA)

    // Calm means no band segments, except when the window is nearly full.
    if (data.ringOff || (isCalm && pct < 90)) {
      return inner
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {inner}
        <Text mono color={toneOf(pct)}>
          {ringBorder(pct, e.props.bodyColumns)}
        </Text>
      </Box>
    )
  })

  // ---- the pane ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const g = await gather($)
    const tab = await read($, tabA)
    const accent = await read($, accentA)
    const density = await read($, densityA)
    const t = await $.clock.now()
    const ok = await animOk($)
    const [enter, open, fade, sparkle] = [await read($, enterA), await read($, openA), await read($, fadeA), await read($, sparkleA)]
    const live = ok && ((enter > 0 && t - enter < GROW_MS) || (open > 0 && t - open < SHUFFLE_MS) || (fade > 0 && t - fade < FADE_MS) || (sparkle > 0 && t - sparkle < SPARKLE_MS))

    if (live) {
      await read($, nowA)
    }
    const p = easeOut(progress(enter, t, GROW_MS, ok))
    const chart = chartOf(tab, { data: g.data, usage: g.usage, now: t, cols: e.props.bodyColumns, p })
    const rows = rowsToShow(chart.rows, shownRows(chart.rows.length, t - open, SHUFFLE_MS, ok && open > 0))
    const isDim = ok && fade > 0 && t - fade < FADE_MS
    const gap = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
    const glint = sparkle > 0 && t - sparkle < SPARKLE_SHOW_MS ? sparkleRow(`new best streak: ${g.data.best} in a row`, t - sparkle, ok, SPARKLE_MS) : undefined

    return (
      <Box flexDirection="column" gap={gap}>
        <Box justifyContent="space-between">
          <Text size="heading" weight="bold" color={accent}>
            More charts
          </Text>
          <Text dimColor mono tabular>
            streak {g.data.streak} · best {g.data.best}
          </Text>
        </Box>
        {g.demo && <Text color="warning">DEMO DATA: sample numbers, nothing is recorded. /cmdemo off to stop.</Text>}
        {glint !== undefined && (
          <Box flexDirection="row">
            {glint.map(s => (
              <Text mono color={s.c} dimColor={s.d} weight={s.b ? 'bold' : undefined}>
                {s.t}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" gap="xs">
          {CHARTS.map(c => (
            <Button key={`cm-tab-${c.id}`} label={c.label} variant={c.id === tab ? 'primary' : 'secondary'} onPress={() => pickTab($, c.id)} />
          ))}
        </Box>
        <Text weight="semibold">{chart.title}</Text>
        <Box flexDirection="column">
          {rows.map(r =>
            r.length === 0 || r.every(s => s.t === '') ? (
              <Text> </Text>
            ) : (
              <Box flexDirection="row">
                {r.map(s =>
                  s.t === '' ? null : (
                    <Text mono color={s.c} dimColor={isDim || s.d} weight={s.b ? 'bold' : undefined}>
                      {s.t}
                    </Text>
                  ),
                )}
              </Box>
            ),
          )}
        </Box>
        {tab === 'slide' && (
          <Box flexDirection="row" gap="xs">
            <Button key="cm-slide-left" label="◀ 10%" onPress={() => moveSplit($, -10)} />
            <Button key="cm-slide-right" label="10% ▶" onPress={() => moveSplit($, 10)} />
            <Button key="cm-slide-reset" label="reset 50%" dimColor onPress={() => moveSplit($, null)} />
          </Box>
        )}
        {chart.note !== undefined && (
          <Text dimColor size="caption">
            {chart.note}
          </Text>
        )}
      </Box>
    )
  })
}
