import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { DayRec, ImportRec, SprintRec, TodoEv, TodoRec } from '../types'

import { CHARTS, EDIT_TOOLS, GROUPS, importsOf, renderChart } from './charts'
import type { ChartData } from './charts'
import { demoData } from './demo'
import { clamp, dayKey } from './draw'
import type { Density, Icons, Opts, Row } from './draw'
import { CAP, asRecord, capDays, detailOf, editInfo, fileOf, parseBudget, parseSprint, todoApply } from './record'
import type { TodoStore } from './record'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'charts-main'

// ---------------------------------------------------------------- shared settings (read only, owned by the settings mod)

const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')

// ---------------------------------------------------------------- state

const tabA = atom({ plugin: 'charts', key: 'tab' } as const, 'donut')
const isDemoA = atom({ plugin: 'charts', key: 'isDemo' } as const, false)
const startA = atom({ plugin: 'charts', key: 'start' } as const, 0)
const usdA = atom({ plugin: 'charts', key: 'usd' } as const, null)
const lastUsdA = atom({ plugin: 'charts', key: 'lastUsd' } as const, null)
const ctxA = atom({ plugin: 'charts', key: 'ctx' } as const, null)
const limitA = atom({ plugin: 'charts', key: 'limit' } as const, null)
const budgetA = atom({ plugin: 'charts', key: 'budget' } as const, null)
const callsA = atom({ plugin: 'charts', key: 'calls' } as const, [], { shape: 'calls-1' })
const promptsA = atom({ plugin: 'charts', key: 'prompts' } as const, [], { shape: 'prompts-1' })
const turnsA = atom({ plugin: 'charts', key: 'turns' } as const, [], { shape: 'turns-1' })
const samplesA = atom({ plugin: 'charts', key: 'samples' } as const, [], { shape: 'samples-1' })
const editsA = atom({ plugin: 'charts', key: 'edits' } as const, [], { shape: 'edits-1' })
const importsA = atom({ plugin: 'charts', key: 'imports' } as const, [], { shape: 'imports-1' })
const daysA = atom({ plugin: 'charts', key: 'days' } as const, {}, { shape: 'days-1' })
const hoursA = atom({ plugin: 'charts', key: 'hours' } as const, [], { shape: 'hours-1' })
const sprintsA = atom({ plugin: 'charts', key: 'sprints' } as const, [], { shape: 'sprints-1' })
const todosA = atom({ plugin: 'charts', key: 'todos' } as const, [], { shape: 'todos-1' })
const todoEvA = atom({ plugin: 'charts', key: 'todoEv' } as const, [], { shape: 'todoev-1' })

const STORE = { days: 'chdays', hours: 'chhours', sprints: 'chsprints', todos: 'chtodos', todoEv: 'chtodoev', budget: 'chbudget' } as const

const CHART_IDS = CHARTS.map(c => c.id)

const HELP = [
  'Charts: twenty text charts (block, braille and box characters) in one pane, charts-main.',
  '/ch  this list',
  `/chshow [chart|group]  open the pane. Charts: ${CHART_IDS.join(' ')}`,
  '/chdonut  open the gauges (context, spend, rate limit)',
  '/chdemo [on|off]  fill every chart with made-up sample data (your real data is untouched)',
  '/chbudget <usd>|off  set the spend target for the bullet chart and the spend ring',
  '/chsprint <min> <label>  log a finished sprint for the calendar',
  '/chtodo add <text> | doing <n> | done <n> | open <n> | rm <n> | list  own todo list for burndown and flow',
  '/chreset [session]  clear everything this mod recorded (or only this session\'s calls and edits)',
].join('\n')

// ---------------------------------------------------------------- helpers that take `$`

const asNumbers = (v: unknown, n: number): number[] => (Array.isArray(v) ? v.slice(0, n).map(x => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)) : [])

const loadStore = async (d: Dollar) => {
  const days = asRecord(await d.store.get(STORE.days))
  const clean: Record<string, DayRec> = {}

  for (const [k, v] of Object.entries(days)) {
    const r = asRecord(v)

    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof r.n === 'number' && Number.isFinite(r.n)) {
      clean[k] = { n: Math.max(0, r.n), usd: typeof r.usd === 'number' && Number.isFinite(r.usd) ? r.usd : 0 }
    }
  }
  await update(d, daysA, () => capDays(clean, CAP.days))
  const hours = asNumbers(await d.store.get(STORE.hours), 24)
  await update(d, hoursA, () => Array.from({ length: 24 }, (_, i) => hours[i] ?? 0))
  const sp = await d.store.get(STORE.sprints)
  const sprints: SprintRec[] = (Array.isArray(sp) ? sp : [])
    .map(asRecord)
    .filter(r => typeof r.at === 'number' && typeof r.min === 'number')
    .map(r => ({ at: Number(r.at), min: Number(r.min), label: String(r.label ?? '').slice(0, 60) }))
    .slice(-CAP.sprints)
  await update(d, sprintsA, () => sprints)
  const td = await d.store.get(STORE.todos)
  const todos: TodoRec[] = (Array.isArray(td) ? td : [])
    .map(asRecord)
    .filter(r => typeof r.id === 'number' && typeof r.text === 'string')
    .map(r => ({ id: Number(r.id), text: String(r.text).slice(0, 120) }))
    .slice(-CAP.todos)
  const ev = await d.store.get(STORE.todoEv)
  const events: TodoEv[] = (Array.isArray(ev) ? ev : [])
    .map(asRecord)
    .filter(r => typeof r.t === 'number' && typeof r.id === 'number' && (r.to === 'open' || r.to === 'doing' || r.to === 'done' || r.to === 'gone'))
    .map(r => ({ t: Number(r.t), id: Number(r.id), to: r.to as TodoEv['to'] }))
    .slice(-CAP.events)
  await update(d, todosA, () => todos)
  await update(d, todoEvA, () => events)
  const b = await d.store.get(STORE.budget)
  await update(d, budgetA, () => (typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : null))
}

const saveTodos = async (d: Dollar, st: TodoStore) => {
  await update(d, todosA, () => st.todos)
  await update(d, todoEvA, () => st.events)
  await d.store.set(STORE.todos, st.todos)
  await d.store.set(STORE.todoEv, st.events)
}

/** Counts one unit of use (a call or a prompt) on its day and hour, and any dollars spent, and keeps them. */
const bumpUse = async (d: Dollar, at: number, units: number, dollars: number) => {
  const key = dayKey(at)
  await update(d, daysA, cur => {
    const row = cur[key] ?? { n: 0, usd: 0 }

    return capDays({ ...cur, [key]: { n: row.n + units, usd: Math.round((row.usd + dollars) * 10_000) / 10_000 } }, CAP.days)
  })
  const hour = new Date(at).getHours()

  if (units > 0) {
    await update(d, hoursA, cur => Array.from({ length: 24 }, (_, i) => (cur[i] ?? 0) + (i === hour ? units : 0)))
  }
  await d.store.set(STORE.days, await read(d, daysA))
  await d.store.set(STORE.hours, await read(d, hoursA))
}

const sampleUsage = async (d: Dollar) => {
  const u = await d.session.usage()
  const t = await d.clock.now()
  const cost = u.cost?.usd ?? null
  const ctx = u.context.percent ?? null
  const limits = u.rateLimits.map(r => r.percentUsed)
  const limit = limits.length === 0 ? null : Math.max(...limits)
  await update(d, usdA, () => cost)
  await update(d, ctxA, () => ctx)
  await update(d, limitA, () => limit)
  await update(d, samplesA, list => [...list, { t, usd: cost, ctx, limit }].slice(-CAP.samples))
  const before = await read(d, lastUsdA)

  if (cost !== null) {
    await update(d, lastUsdA, () => cost)

    if (before !== null && cost > before) {
      await bumpUse(d, t, 0, cost - before)
    }
  }
}

const recordEdit = async (d: Dollar, tool: string, input: Record<string, unknown>, text: string) => {
  const info = editInfo(tool, input, text)

  if (info.path === '') {
    return
  }
  await update(d, editsA, list => {
    const cur = list.find(r => r.path === info.path)
    const marks = [...(cur?.marks ?? []), ...(info.mark === null ? [] : [info.mark])].slice(-CAP.marks)
    const row = {
      path: info.path,
      n: (cur?.n ?? 0) + 1,
      added: (cur?.added ?? 0) + info.added,
      removed: (cur?.removed ?? 0) + info.removed,
      marks,
      lines: info.lines > 0 ? info.lines : (cur?.lines ?? 0),
    }

    return cur === undefined ? [...list, row].slice(-CAP.edits) : list.map(r => (r.path === info.path ? row : r))
  })
  const found = importsOf(info.src)

  if (found.length > 0) {
    await update(d, importsA, list => {
      const cur = list.find(r => r.path === info.path)
      const merged: ImportRec = { path: info.path, imports: [...new Set([...(cur?.imports ?? []), ...found])].slice(0, 24) }

      return cur === undefined ? [...list, merged].slice(-CAP.imports) : list.map(r => (r.path === info.path ? merged : r))
    })
  }
}

const buildData = async (d: Dollar): Promise<ChartData> => {
  const now = await d.clock.now()

  if (await read(d, isDemoA)) {
    return demoData(now)
  }

  return {
    now,
    start: await read(d, startA),
    calls: await read(d, callsA),
    prompts: await read(d, promptsA),
    turns: await read(d, turnsA),
    samples: await read(d, samplesA),
    edits: await read(d, editsA),
    imports: await read(d, importsA),
    days: await read(d, daysA),
    hours: await read(d, hoursA),
    sprints: await read(d, sprintsA),
    todos: await read(d, todosA),
    todoEv: await read(d, todoEvA),
    budget: await read(d, budgetA),
    usd: await read(d, usdA),
    ctx: await read(d, ctxA),
    limit: await read(d, limitA),
  }
}

const optsOf = async (d: Dollar, width: number, now: number): Promise<Opts> => ({
  width,
  accent: String(await read(d, accentA)),
  density: (await read(d, densityA)) as Density,
  icons: (await read(d, iconsA)) as Icons,
  now,
})

const gapKey = (density: Density): 'xs' | 'sm' | 'md' => (density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm')

const openChart = async (d: Dollar, to?: string) => {
  if (to !== undefined) {
    await update(d, tabA, () => to)
  }
  await sampleUsage(d).catch(() => undefined)
  await d.ui.open({ id: PANE, title: 'Charts' })
}

const findChart = (word: string): string | undefined => {
  const w = word.trim().toLowerCase()
  const byId = CHARTS.find(c => c.id === w || c.label.toLowerCase() === w)

  if (byId !== undefined) {
    return byId.id
  }

  return CHARTS.find(c => c.group === w)?.id
}

const resetData = async (d: Dollar, all: boolean) => {
  await update(d, callsA, () => [])
  await update(d, promptsA, () => [])
  await update(d, turnsA, () => [])
  await update(d, samplesA, () => [])
  await update(d, editsA, () => [])
  await update(d, importsA, () => [])
  await update(d, isDemoA, () => false)

  if (all) {
    await update(d, daysA, () => ({}))
    await update(d, hoursA, () => Array.from({ length: 24 }, () => 0))
    await update(d, sprintsA, () => [])
    await update(d, todosA, () => [])
    await update(d, todoEvA, () => [])
    await update(d, budgetA, () => null)
    await d.store.set(STORE.days, {})
    await d.store.set(STORE.hours, [])
    await d.store.set(STORE.sprints, [])
    await d.store.set(STORE.todos, [])
    await d.store.set(STORE.todoEv, [])
    await d.store.set(STORE.budget, null)
  }
}

// ---------------------------------------------------------------- the mod

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['ch', 'Charts: list every command of the charts mod'],
      ['chshow', 'Open the charts pane: /chshow [chart|group]'],
      ['chdonut', 'Open the donut gauges (context, spend, rate limit)'],
      ['chdemo', 'Fill every chart with sample data: /chdemo [on|off]'],
      ['chbudget', 'Spend target for the bullet chart: /chbudget <usd>|off'],
      ['chsprint', 'Log a finished sprint: /chsprint <min> <label>'],
      ['chtodo', 'Chart todo list: /chtodo add|doing|done|open|rm|list'],
      ['chreset', 'Clear what the charts mod recorded: /chreset [session]'],
    ] as const) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await loadStore($).catch(() => undefined)

    try {
      const usage = await $.session.usage()
      await update($, startA, () => usage.startedAt)
      await update($, lastUsdA, () => usage.cost?.usd ?? null)
    } catch {
      await update($, startA, () => 0)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta !== true && e.text.trim() !== '') {
      const at = await $.clock.now()
      await update($, promptsA, list => [...list, { at, len: e.text.length }].slice(-CAP.prompts))
      await bumpUse($, at, 1, 0).catch(() => undefined)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const startedAt = await $.clock.now()
    const id = e.tool_use_id ?? `${e.tool}-${startedAt}`
    const file = fileOf(input)
    const call = { id, tool: e.tool, detail: detailOf(e.tool, input), startedAt, endedAt: null, isError: false, out: 0, ...(file === undefined ? {} : { file }) }
    await update($, callsA, list => [...list, call].slice(-CAP.calls))

    let ran: Awaited<ReturnType<typeof next>>

    try {
      ran = await next(e)
    } catch (err) {
      const endedAt = await $.clock.now()
      await update($, callsA, list => list.map(c => (c.id === id ? { ...c, endedAt, isError: true } : c)))
      throw err
    }
    const endedAt = await $.clock.now()
    const isFailed = ran.deny !== undefined || ran.isError === true
    const out = ran.text ?? ''
    await update($, callsA, list => list.map(c => (c.id === id ? { ...c, endedAt, isError: isFailed, out: out.length } : c)))

    if (!isFailed && EDIT_TOOLS.test(e.tool)) {
      await recordEdit($, e.tool, input, out).catch(() => undefined)
    }
    await bumpUse($, endedAt, 1, 0).catch(() => undefined)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    await sampleUsage($).catch(() => undefined)
    const end = await $.clock.now()
    await update($, turnsA, list => [...list, { start: end - Math.max(0, e.durationMs), end }].slice(-CAP.turns))

    return next(e)
  })

  // ------------------------------------------------------------ commands

  on('command.run', { command: 'ch' }, async () => ({ text: HELP }))

  on('command.run', { command: 'chshow' }, async ($, e) => {
    const word = e.args.trim()
    const hit = word === '' ? undefined : findChart(word)

    if (word !== '' && hit === undefined) {
      return { text: `No chart "${word}". Charts: ${CHART_IDS.join(', ')}. Groups: ${GROUPS.map(g => g[0]).join(', ')}.` }
    }
    await openChart($, hit)

    return { text: hit === undefined ? 'Charts opened.' : `Charts opened on ${hit}.` }
  })

  on('command.run', { command: 'chdonut' }, async $ => {
    await openChart($, 'donut')

    return { text: 'Gauges opened.' }
  })

  on('command.run', { command: 'chdemo' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const next = arg === 'on' ? true : arg === 'off' ? false : !(await read($, isDemoA))
    await update($, isDemoA, () => next)
    await openChart($)

    return { text: next ? 'Demo on: every chart shows made-up sample data. /chdemo off to go back.' : 'Demo off: charts show your recorded data again.' }
  })

  on('command.run', { command: 'chbudget' }, async ($, e) => {
    if (e.args.trim() === '') {
      const b = await read($, budgetA)

      return { text: b === null ? 'No budget set. /chbudget <usd> sets one, /chbudget off clears it.' : `Budget is $${b.toFixed(2)}.` }
    }
    const v = parseBudget(e.args)

    if (v === undefined) {
      return { text: 'Usage: /chbudget <usd> (for example 5 or 2.50) or /chbudget off' }
    }
    await update($, budgetA, () => v)
    await $.store.set(STORE.budget, v)

    return { text: v === null ? 'Budget cleared.' : `Budget set to $${v.toFixed(2)}. See Gauges > Budget.` }
  })

  on('command.run', { command: 'chsprint' }, async ($, e) => {
    const v = parseSprint(e.args)

    if (v === undefined) {
      await openChart($, 'sprints')

      return { text: 'Usage: /chsprint <minutes> <label>, for example /chsprint 25 write the parser. Calendar opened.' }
    }
    const at = await $.clock.now()
    await update($, sprintsA, list => [...list, { at, min: v.min, label: v.label }].slice(-CAP.sprints))
    await $.store.set(STORE.sprints, await read($, sprintsA))

    return { text: `Logged ${v.min} min: ${v.label}. See Plan > Sprints.` }
  })

  on('command.run', { command: 'chtodo' }, async ($, e) => {
    const at = await $.clock.now()
    const res = todoApply(e.args, { todos: await read($, todosA), events: await read($, todoEvA) }, at)

    if (/^\s*(add|doing|done|open|rm)\b/i.test(e.args)) {
      await saveTodos($, res.store)
    }

    return { text: res.text }
  })

  on('command.run', { command: 'chreset' }, async ($, e) => {
    const sessionOnly = e.args.trim().toLowerCase() === 'session'
    await resetData($, !sessionOnly)

    return { text: sessionOnly ? 'Cleared this session\'s calls, prompts, edits and samples. Daily counters, sprints, todos and budget kept.' : 'Cleared everything the charts mod recorded: session data, daily counters, hours, sprints, todos and budget.' }
  })

  // ------------------------------------------------------------ pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const data = await buildData($)
    const cols = e.props.bodyColumns
    const o = await optsOf($, clamp(cols - 4, 30, 100), data.now)
    const active = await read($, tabA)
    const meta = CHARTS.find(c => c.id === active) ?? CHARTS[0]
    const isDemo = await read($, isDemoA)
    const pad = gapKey(o.density)
    const rows: Row[] = meta === undefined ? [] : renderChart(meta.id, data, o)
    const nb = (t: string): string => t.replace(/ /g, ' ')
    const line = (row: Row) => (
      <Text mono>
        {row.length === 0 || row.every(s => s.t === '')
          ? ' '
          : row.map(s => (
              <Text mono color={s.c as never} dimColor={s.d === true} weight={s.b === true ? 'bold' : undefined}>
                {nb(s.t)}
              </Text>
            ))}
      </Text>
    )

    return (
      <Box flexDirection="column" padding={pad} gap={pad}>
        <Box gap={pad} flexWrap="wrap">
          {GROUPS.map(([gid, glabel]) => {
            const mine = meta?.group === gid

            return (
              <Button
                key={`grp-${gid}`}
                variant={mine ? 'primary' : undefined}
                label={mine ? `* ${glabel}` : glabel}
                onPress={() => update($, tabA, () => CHARTS.find(c => c.group === gid)?.id ?? 'donut')}
              />
            )
          })}
          <Button key="demo-toggle" dimColor={!isDemo} label={isDemo ? 'Demo: on' : 'Demo: off'} onPress={() => update($, isDemoA, v => !v)} />
        </Box>
        <Box gap={pad} flexWrap="wrap">
          {CHARTS.filter(c => c.group === meta?.group).map(c => (
            <Button
              key={`ch-${c.id}`}
              variant={c.id === meta?.id ? 'primary' : undefined}
              label={c.id === meta?.id ? `[${c.label}]` : c.label}
              onPress={() => update($, tabA, () => c.id)}
            />
          ))}
        </Box>
        {isDemo && <Text color="warning">DEMO DATA: made up, nothing here was recorded. /chdemo off returns to your data.</Text>}
        <Box flexDirection="column">
          <Text size="heading" weight="bold">
            {meta?.title ?? 'Charts'}
          </Text>
          <Text dimColor>{meta?.about ?? ''}</Text>
        </Box>
        <Box flexDirection="column">{rows.map(line)}</Box>
        <Text size="caption" dimColor>
          Text charts: block, braille and box characters, not images. /ch lists every command.
        </Text>
      </Box>
    )
  })
}
