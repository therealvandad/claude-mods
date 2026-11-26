import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { VisData } from '../types'
import { altText, dashboardSvg, demoData } from './svg'
import type { Accent } from './svg'

type Dollar = Parameters<Hook<'session.start'>>[0]

const empty = (startedAt: number): VisData => ({
  startedAt,
  contextPct: 0,
  spendUsd: 0,
  budgetUsd: 0,
  limitPct: 0,
  limitKind: '',
  samples: [],
  tools: {},
  days: {},
  isLive: false,
  isDemo: false,
})

const dataA = atom({ plugin: 'visuals', key: 'data' } as const, empty(0), { shape: 'data-1' })
const nowA = atom({ plugin: 'visuals', key: 'now' } as const, 0)

// Shared switches owned by other mods (read only).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const isCalm = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')

const KEEP_DAYS = 90
const KEEP_SAMPLES = 40

let realBackup: VisData | undefined

const dayKey = (t: number) => {
  const d = new Date(t)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const trimDays = (days: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(days).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-KEEP_DAYS))

const elapsedText = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))

  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

const loadDays = async (d: Dollar): Promise<Record<string, number>> => {
  const saved = await d.store.get('days')
  const out: Record<string, number> = {}

  if (typeof saved === 'object' && saved !== null && !Array.isArray(saved)) {
    for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out[k] = Math.min(v, 100_000)
      }
    }
  }

  return trimDays(out)
}

const openPane = (d: Dollar) => d.ui.open({ id: 'visuals-main', title: 'Visuals' })

// The desktop needs BOTH width and height: with only a width it draws the picture in a short
// default box and shrinks everything. Fit the pane (about 7px per column) and keep the aspect ratio.
const sizeFor = (source: string, columns: number | undefined) => {
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(source)
  const w = Number(box?.[1] ?? 760)
  const h = Number(box?.[2] ?? 760)
  const width = Math.round(Math.max(360, Math.min(w, (columns ?? 80) * 7)))

  return { width, height: Math.round((width * h) / w) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const t = await $.clock.now()
    const days = await loadDays($)
    await update($, dataA, () => ({ ...empty(t), days }))
    await update($, nowA, () => t)

    for (const [name, description] of [
      ['vis', 'Open the vector dashboard pane'],
      ['visdemo', 'Fill the dashboard with made-up sample data: /visdemo on|off'],
      ['visreset', 'Clear what the dashboard recorded'],
    ] as const) {
      await $.command.register({ name, description }).catch(() => undefined)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, dataA, d => ({ ...d, isLive: true }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const t = await $.clock.now()
    await update($, nowA, () => t)
    const key = dayKey(t)
    await update($, dataA, d => {
      const tools = { ...d.tools, [e.tool]: (d.tools[e.tool] ?? 0) + 1 }
      const days = trimDays({ ...d.days, [key]: (d.days[key] ?? 0) + 1 })

      return d.isDemo ? d : { ...d, tools, days }
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const usage = await $.session.usage()
    const nowT = await $.clock.now()
    await update($, nowA, () => nowT)
    const limit = usage.rateLimits[0]
    await update($, dataA, d =>
      d.isDemo
        ? d
        : {
            ...d,
            isLive: false,
            startedAt: usage.startedAt,
            contextPct: usage.context.percent ?? d.contextPct,
            spendUsd: usage.cost?.usd ?? d.spendUsd,
            limitPct: limit?.percentUsed ?? d.limitPct,
            limitKind: limit === undefined ? d.limitKind : limit.kind.replace(/_/g, ' '),
            samples: [...d.samples, { cost: usage.cost?.usd ?? 0, ctx: usage.context.percent ?? 0 }].slice(-KEEP_SAMPLES),
          },
    )
    await $.store.set('days', (await read($, dataA)).days)

    return next(e)
  })

  on('command.run', { command: 'vis' }, async $ => {
    await openPane($).catch(() => undefined)

    return { text: 'Visuals pane opened. /visdemo on shows sample data.' }
  })

  on('command.run', { command: 'visdemo' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const t = await $.clock.now()

    if (arg === 'off') {
      await update($, dataA, d => (d.isDemo ? (realBackup ?? { ...empty(t), days: {} }) : d))
      realBackup = undefined

      return { text: 'Demo data off.' }
    }
    const current = await read($, dataA)

    if (!current.isDemo) {
      realBackup = current
    }
    await update($, dataA, () => demoData(t))
    await openPane($).catch(() => undefined)

    return { text: 'Showing made-up sample data in the Visuals pane. /visdemo off returns to your data.' }
  })

  on('command.run', { command: 'visreset' }, async $ => {
    const t = await $.clock.now()
    realBackup = undefined
    await update($, dataA, () => empty(t))
    await $.store.set('days', {})

    return { text: 'Visuals data cleared.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'visuals-main' }, async ($, e) => {
    const { Box, Svg, Text } = $.ui.resolve(e)
    const d = await read($, dataA)
    const t = await read($, nowA)
    const animate = (await read($, motionIsOn)) && !(await read($, isCalm))
    const accent = (await read($, accentA)) as Accent
    const now = d.isDemo ? d.startedAt + 47 * 60_000 : t
    const source = dashboardSvg(d, {
      accent,
      animate,
      elapsed: elapsedText(now - d.startedAt),
      today: dayKey(t > 0 ? t : now),
    })

    return (
      <Box flexDirection="column" padding="sm" gap="sm">
        <Svg source={source} alt={altText(d)} {...sizeFor(source, e.props.bodyColumns)} isInteractive={animate} />
        <Text dimColor size="caption">
          {animate ? 'Smooth motion is on. /motion off or /cfg calm on makes this still.' : 'Still version: motion is off or calm is on.'}
        </Text>
      </Box>
    )
  })
}
