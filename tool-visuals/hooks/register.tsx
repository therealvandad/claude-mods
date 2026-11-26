import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

// Global reduced-motion switch: owned by the `motion` mod (`/motion on|off`).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)

import {
  FOLD_MIN,
  buildSummary,
  edgeOf,
  failingTests,
  fmtCount,
  fmtDuration,
  glyphFor,
  groupSummary,
  isBuildCommand,
  isSlow,
  isTestCommand,
  miniDiff,
  networkKind,
  ordinal,
  outputText,
  parseBuildErrors,
  pathOf,
  redactDeep,
  signatureOf,
  sizeBadge,
} from './pure'
import type { Input } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]

// Change a tag when the stored fields change: it declines what an earlier version stored.
const calls = atom({ plugin: 'tool-visuals', key: 'calls' } as const, [], { shape: 'calls-1' })
const tick = atom({ plugin: 'tool-visuals', key: 'tick' } as const, 0)
const isOff = atom({ plugin: 'tool-visuals', key: 'isOff' } as const, false)

const KEEP = 200

// The reduced-motion flag other mods share: `$.store` key `motion`, on unless stored as off.
const isMotionOn = async ($: Dollar) => {
  const flag = await $.store.get('motion')

  return (await read($, motionIsOn)) && !(flag === false || flag === 'off' || flag === 0 || flag === 'false')
}

// Drives the indeterminate network bar: one write of the clock to `tick` every half second.
const startTick = ($: Dollar) =>
  $.clock.every(500, async () => {
    const now = await $.clock.now()
    await update($, tick, () => now)
  })

const asInput = (value: unknown): Input =>
  value !== null && typeof value === 'object' ? (value as Input) : {}

export const register: Register = on => {
  let active = 0
  let timer: ReturnType<typeof startTick> | undefined

  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'toolvis',
        description: 'Tool-call visuals: /toolvis on | off | status (secret masking stays on either way)',
      })
      .catch(() => undefined)
    const stored = await $.store.get('toolvis.off')
    await update($, isOff, () => stored === true)

    return next(e)
  })

  on('command.run', { command: 'toolvis' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'on' || arg === 'off') {
      await update($, isOff, () => arg === 'off')
      await $.store.set('toolvis.off', arg === 'off')
    }
    const off = await read($, isOff)
    const motion = (await isMotionOn($)) ? 'on' : 'off'

    return {
      text: `Tool visuals are ${off ? 'off' : 'on'} (animation ${motion}, secret masking always on). Use /toolvis on or /toolvis off.`,
    }
  })

  // 64, 69, 72: capture the start, the finish and the attempt number around the call.
  on('tool.call', async ($, e, next) => {
    const input = asInput(e)
    const id = e.tool_use_id
    const sig = signatureOf(e.tool, input)
    const start = await $.clock.now()

    await update($, calls, list =>
      list.some(one => one.id === id)
        ? list
        : [...list, { id, sig, start, end: null, attempt: 1 + list.filter(one => one.sig === sig).length }].slice(-KEEP),
    )
    const isCounted = networkKind(e.tool, input) !== null && (await isMotionOn($))

    if (isCounted) {
      active += 1

      if (active === 1) {
        timer = startTick($)
      }
    }

    try {
      return await next(e)
    } finally {
      const end = await $.clock.now()

      await update($, calls, list => list.map(one => (one.id === id ? { ...one, end } : one)))

      if (isCounted) {
        active = Math.max(0, active - 1)

        if (active === 0) {
          timer?.cancel()
          timer = undefined
        }
      }
    }
  })

  // 61-65, 67, 69, 70, 71, 72: the row's edge and the lines under it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, isRunning, isErrored, tool_use_id: id } = e.props
    const input = asInput(e.props.input)
    const hidden = redactDeep(e.props.output)
    const inner = await next(hidden.count > 0 ? { ...e, props: { ...e.props, output: hidden.value } } : e)

    if (await read($, isOff)) {
      return inner
    }
    const { Box, Progress, Text } = $.ui.resolve(e)
    const rec = (await read($, calls)).find(one => one.id === id)
    const edge = edgeOf(tool, input, isErrored)
    const path = pathOf(input)
    const glyph = tool === 'Read' || tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' ? glyphFor(path) : null
    const ms = rec !== undefined && rec.end !== null && !isRunning ? Math.max(0, rec.end - rec.start) : null
    const size = isRunning ? null : sizeBadge(tool, e.props.output)
    const net = networkKind(tool, input)
    const attempt = rec?.attempt ?? 1
    const command = typeof input.command === 'string' ? input.command : ''
    const out = outputText(e.props.output)
    const diff =
      tool === 'Edit' && !isErrored && typeof input.old_string === 'string' && typeof input.new_string === 'string'
        ? miniDiff(input.old_string, input.new_string)
        : null
    const failing = tool === 'Bash' && !isRunning && isTestCommand(command) ? failingTests(out) : null
    const build = tool === 'Bash' && !isRunning && isBuildCommand(command) ? buildSummary(parseBuildErrors(out)) : null
    const hasChips = glyph !== null || ms !== null || size !== null || net !== null || attempt > 1
    let waiting: string | null = null

    if (isRunning && net !== null) {
      const isMoving = await isMotionOn($)
      const now = isMoving && rec !== undefined ? await read($, tick) : 0
      waiting = rec !== undefined && now > rec.start ? `${net} · ${fmtDuration(now - rec.start)}` : net
    }
    const isAnimated = waiting !== null && (await isMotionOn($))

    return (
      <Box flexDirection="row">
        <Box width={1} flexShrink={0} backgroundColor={edge}>
          <Text> </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
          {inner}
          {hasChips && (
            <Box flexDirection="row" gap={1}>
              {glyph !== null && <Text dimColor>{glyph}</Text>}
              {ms !== null && <Text color={isSlow(ms) ? 'warning' : undefined} dimColor={!isSlow(ms)}>{isSlow(ms) ? `⏱ ${fmtDuration(ms)} slow` : fmtDuration(ms)}</Text>}
              {size !== null && <Text dimColor>{size}</Text>}
              {net !== null && <Text color="suggestion">⇄ {net}</Text>}
              {attempt > 1 && <Text color={attempt >= 3 ? 'warning' : undefined} dimColor={attempt < 3}>↻ {ordinal(attempt)} attempt</Text>}
            </Box>
          )}
          {diff !== null && diff.lines[0] !== undefined && (
            <Text color={diff.lines[0].sign === '+' ? 'diffAdded' : 'diffRemoved'}>{diff.lines[0].sign} {diff.lines[0].text}</Text>
          )}
          {diff !== null && diff.lines[1] !== undefined && (
            <Text color={diff.lines[1].sign === '+' ? 'diffAdded' : 'diffRemoved'}>{diff.lines[1].sign} {diff.lines[1].text}</Text>
          )}
          {diff !== null && diff.lines[2] !== undefined && (
            <Text color={diff.lines[2].sign === '+' ? 'diffAdded' : 'diffRemoved'}>{diff.lines[2].sign} {diff.lines[2].text}</Text>
          )}
          {waiting !== null && isAnimated && <Progress label={`waiting on network · ${waiting}`} color="suggestion" />}
          {waiting !== null && !isAnimated && <Text color="suggestion">⇄ waiting on network</Text>}
          {failing !== null && failing.names.length > 0 && (
            <Box flexDirection="column">
              {failing.names[0] !== undefined && <Text color="error">✗ {failing.names[0]}</Text>}
              {failing.names[1] !== undefined && <Text color="error">✗ {failing.names[1]}</Text>}
              {failing.names[2] !== undefined && <Text color="error">✗ {failing.names[2]}</Text>}
              {failing.names[3] !== undefined && <Text color="error">✗ {failing.names[3]}</Text>}
              {failing.names[4] !== undefined && <Text color="error">✗ {failing.names[4]}</Text>}
              {failing.more > 0 && <Text dimColor>+{failing.more} more failing</Text>}
            </Box>
          )}
          {build !== null && <Text color="error">⚒ {build}</Text>}
        </Box>
      </Box>
    )
  })

  // 68: mask likely secrets in the displayed result only; the model reads the stored one.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const hit = redactDeep(e.props.output)

    if (hit.count === 0) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next({ ...e, props: { ...e.props, output: hit.value } })}
        <Text color="warning" dimColor>
          ⚿ {fmtCount(hit.count)} possible {hit.count === 1 ? 'secret' : 'secrets'} masked in this display
        </Text>
      </Box>
    )
  })

  // 66: a long finished run of reads and searches becomes one summary line.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { calls: grouped, isActive, isExpanded, isCallsOnly } = e.props

    if (isActive || isExpanded || isCallsOnly !== true || grouped.length < FOLD_MIN || (await read($, isOff))) {
      return next(e)
    }
    const durations: Record<string, number> = {}

    for (const one of await read($, calls)) {
      if (one.end !== null) {
        durations[one.id] = Math.max(0, one.end - one.start)
      }
    }
    const sum = groupSummary(grouped, durations)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>▸ {grouped.length} quiet calls: {sum.parts.join(' · ')}</Text>
        {sum.ms > 0 && <Text dimColor>· {fmtDuration(sum.ms)}</Text>}
        {sum.lines > 0 && <Text dimColor>· {fmtCount(sum.lines)} lines</Text>}
        <Text dimColor>(ctrl+o to expand)</Text>
      </Box>
    )
  })
}
