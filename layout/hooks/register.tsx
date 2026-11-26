import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { LayoutSettings, RecentFile, SplitBlobs } from '../types'
import {
  AUTO_MODES,
  COLS_MODES,
  COMMANDS,
  DEFAULTS,
  GROUPS,
  ICONS,
  ICON_SETS,
  LEGEND,
  LEGEND_GROUPS,
  LONG_LINES,
  MAX_BLOB,
  PANES,
  PATH_MODES,
  SURFACES,
  VIEWS,
  VIEW_LABEL,
  addRecent,
  asView,
  chipText,
  clampWidth,
  diffRows,
  diffStats,
  errorLine,
  fenceLanguages,
  helpText,
  isCompact,
  longOutput,
  nextOf,
  normSettings,
  paneId,
  parseSplitArgs,
  parseSwitch,
  pathLabel,
  pathOfCall,
  relTime,
  toLines,
  tune,
  useTwoCols,
  whenText,
  withSticky,
} from './pure'
import type { View } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]

// Change a tag when a value's fields change: it declines what an earlier version stored.
const settings = atom({ plugin: 'layout', key: 'settings' } as const, DEFAULTS, { shape: 'settings-1' })
const recent = atom({ plugin: 'layout', key: 'recent' } as const, [], { shape: 'recent-1' })
const split = atom({ plugin: 'layout', key: 'split' } as const, { a: '', b: '' }, { shape: 'split-1' })
const folds = atom({ plugin: 'layout', key: 'folds' } as const, {}, { shape: 'folds-1' })
const pins = atom({ plugin: 'layout', key: 'pins' } as const, [], { shape: 'pins-1' })
const note = atom({ plugin: 'layout', key: 'note' } as const, '')
const view = atom({ plugin: 'layout', key: 'view' } as const, 'settings')

const NOTE_MAX = 500

// ------------------------------------------------------------ top-level actions

const patch = async ($: Dollar, change: Partial<LayoutSettings>) => {
  const next = normSettings({ ...(await read($, settings)), ...change })
  await update($, settings, () => next)
  await $.store.set('layout.settings', next)

  return next
}

const setView = ($: Dollar, next: View) => update($, view, () => next)

const toggleFold = async ($: Dollar, id: string) => {
  const next = { ...(await read($, folds)) }

  if (next[id] === true) {
    delete next[id]
  } else {
    next[id] = true
  }
  await update($, folds, () => next)
  await $.store.set('layout.folds', next)
}

const saveNote = async ($: Dollar, text: string) => {
  const next = text.slice(0, NOTE_MAX)
  await update($, note, () => next)
  await $.store.set('layout.note', next)
}

const saveSplit = async ($: Dollar, change: Partial<SplitBlobs>) => {
  const next = { ...(await read($, split)), ...change }
  next.a = next.a.slice(0, MAX_BLOB)
  next.b = next.b.slice(0, MAX_BLOB)
  await update($, split, () => next)
  await $.store.set('layout.split', next)
}

const savePins = async ($: Dollar, next: string[]) => {
  await update($, pins, () => next)
  await $.store.set('layout.pins', next)
}

const togglePin = async ($: Dollar, id: string) => {
  const list = await read($, pins)
  await savePins($, list.includes(id) ? list.filter(one => one !== id) : [...list, id])
}

const openPane = async ($: Dollar, id: string) => {
  const spec = PANES[id]

  if (spec === undefined) {
    return { isPlaced: false as const, reason: 'unknown pane' }
  }
  const result = await $.ui.open({
    id,
    title: spec.title,
    rows: spec.rows,
    columns: spec.columns,
    ...(spec.placement === undefined ? {} : { placement: spec.placement }),
  })

  return result.isPlaced ? { isPlaced: true as const, reason: '' } : { isPlaced: false as const, reason: String((result as { reason?: unknown }).reason ?? 'not placed') }
}

const showPane = async ($: Dollar, id: string) => {
  const opened = await openPane($, id)

  return opened.isPlaced ? `Opened the ${PANES[id]?.title ?? id} pane (${id}).` : `The ${PANES[id]?.title ?? id} pane is waiting: ${opened.reason}.`
}

const loadAll = async ($: Dollar) => {
  const stored = await $.store.get('layout.settings')
  await update($, settings, () => normSettings(stored))
  const blobs = (await $.store.get('layout.split')) as { a?: unknown; b?: unknown } | null | undefined
  await update($, split, () => ({
    a: typeof blobs?.a === 'string' ? blobs.a.slice(0, MAX_BLOB) : '',
    b: typeof blobs?.b === 'string' ? blobs.b.slice(0, MAX_BLOB) : '',
  }))
  const text = await $.store.get('layout.note')
  await update($, note, () => (typeof text === 'string' ? text.slice(0, NOTE_MAX) : ''))
  const savedFolds = await $.store.get('layout.folds')
  const nextFolds: Record<string, boolean> = {}

  if (savedFolds !== null && typeof savedFolds === 'object') {
    for (const [id, flag] of Object.entries(savedFolds as Record<string, unknown>).slice(0, 40)) {
      if (flag === true) {
        nextFolds[id] = true
      }
    }
  }
  await update($, folds, () => nextFolds)
  const savedPins = await $.store.get('layout.pins')
  const nextPins = Array.isArray(savedPins) ? savedPins.filter((id): id is string => typeof id === 'string' && PANES[id] !== undefined) : []
  await update($, pins, () => nextPins)

  return nextPins
}

const resetAll = async ($: Dollar) => {
  for (const key of ['settings', 'split', 'note', 'folds', 'pins']) {
    await $.store.delete(`layout.${key}`)
  }
  await update($, settings, () => DEFAULTS)
  await update($, recent, () => [])
  await update($, split, () => ({ a: '', b: '' }))
  await update($, folds, () => ({}))
  await update($, pins, () => [])
  await update($, note, () => '')
  await update($, view, () => 'settings')
}

const describe = (label: string, value: string, options: readonly string[]) => `${label} is ${value} (${options.join(' | ')}).`

const runCommand = async ($: Dollar, name: string, raw: string): Promise<string> => {
  const args = raw.trim()
  const word = args.toLowerCase()
  const s = await read($, settings)

  switch (name) {
    case 'ly':
      return helpText()
    case 'lymain': {
      if (word !== '' && !(VIEWS as readonly string[]).includes(word)) {
        return `Unknown tab "${word}". Tabs: ${VIEWS.join(' | ')}.`
      }
      if (word !== '') {
        await setView($, asView(word))
      }

      return showPane($, 'layout-main')
    }
    case 'lylegend':
      await setView($, 'legend')

      return showPane($, 'layout-main')
    case 'lytime':
      await setView($, 'recent')

      return showPane($, 'layout-main')
    case 'lysplit': {
      if (word === 'clear') {
        await saveSplit($, { a: '', b: '' })

        return 'Split view cleared.'
      }
      if (word === 'swap') {
        const cur = await read($, split)
        await saveSplit($, { a: cur.b, b: cur.a })

        return 'Swapped the two sides.'
      }
      if (args === '') {
        return showPane($, 'layout-split')
      }
      const parsed = parseSplitArgs(args)

      if (parsed === null) {
        return 'Usage: /lysplit left text | right text   (use \\n for a line break, \\| for a literal bar)'
      }
      await saveSplit($, parsed)
      const stats = diffStats(diffRows(toLines(parsed.a), toLines(parsed.b)))

      return `${await showPane($, 'layout-split')} ${stats.differ} differing row(s), ${stats.same} equal.`
    }
    case 'lynote': {
      if (word === 'clear') {
        await saveNote($, '')

        return 'Note cleared.'
      }
      if (args !== '') {
        await saveNote($, args)
      }

      return showPane($, 'layout-note')
    }
    case 'lypin': {
      const list = await read($, pins)

      if (word === 'clear') {
        await savePins($, [])

        return 'No panes are pinned any more.'
      }
      if (word === '' || word === 'list') {
        return `Pinned panes (reopened at session start): ${list.length === 0 ? 'none' : list.join(', ')}. Pin one with /lypin main | note | split.`
      }
      const id = paneId(word)

      if (id === null) {
        return `Only this mod's panes can be pinned: ${Object.keys(PANES).join(', ')}. (A pane belongs to the plugin that opened it, so another mod's cannot be reopened from here.)`
      }
      await togglePin($, id)

      return list.includes(id) ? `Unpinned ${id}.` : `Pinned ${id}: it reopens at every session start.`
    }
    case 'lyzen': {
      const on = parseSwitch(word, s.zen)

      if (on === null) {
        return 'Usage: /lyzen on | off'
      }
      await patch($, { zen: on })

      return on ? 'Zen on: band rows and status text are hidden. /lyzen off brings them back.' : 'Zen off.'
    }
    case 'lycols':
    case 'lycompact':
    case 'lyicons':
    case 'lypath': {
      const spec =
        name === 'lycols'
          ? { key: 'cols', list: COLS_MODES as readonly string[] }
          : name === 'lycompact'
            ? { key: 'compact', list: AUTO_MODES as readonly string[] }
            : name === 'lyicons'
              ? { key: 'icons', list: ICON_SETS as readonly string[] }
              : { key: 'path', list: PATH_MODES as readonly string[] }
      const current = String(s[spec.key as keyof LayoutSettings])

      if (word === '') {
        return describe(spec.key, current, spec.list)
      }
      if (!spec.list.includes(word)) {
        return `Unknown value "${word}". ${describe(spec.key, current, spec.list)}`
      }
      await patch($, { [spec.key]: word })

      return `${spec.key} is now ${word}.`
    }
    case 'lystripe':
    case 'lyerr':
    case 'lylong':
    case 'lychips': {
      const key = name === 'lystripe' ? 'stripes' : name === 'lyerr' ? 'errBanner' : name === 'lylong' ? 'longBanner' : 'chips'
      const on = parseSwitch(word, s[key])

      if (on === null) {
        return `Usage: /${name} on | off`
      }
      await patch($, { [key]: on })

      return `${key} is now ${on ? 'on' : 'off'}${key === 'longBanner' ? ` (results over ${LONG_LINES} lines)` : ''}.`
    }
    case 'lywidth': {
      if (word === '') {
        return `Reading width is ${s.width === 0 ? 'off' : `${s.width} cells`}. Use /lywidth 80..120 or /lywidth off.`
      }
      const n = word === 'off' || word === '0' ? 0 : Number(word)

      if (!Number.isFinite(n)) {
        return 'Usage: /lywidth <cells> | off'
      }
      const width = clampWidth(n)
      await patch($, { width })

      return width === 0 ? 'Reading width limit off.' : `Assistant text now draws at most ${width} cells wide.`
    }
    case 'lyreset':
      await resetAll($)

      return 'Layout reset: settings, split blobs, note, folds and pins cleared.'
    default:
      return `Unknown layout command /${name}.`
  }
}

// --------------------------------------------------------------- list rows

type Row = {
  id: string
  isHeader?: boolean
  isSticky?: boolean
  title?: string
  count?: number
  left?: string
  right?: string
  tail?: string
  color?: string
}

const legendRows = (isFolded: Record<string, boolean>): Row[] => {
  const rows: Row[] = []

  for (const group of LEGEND_GROUPS) {
    const keys = LEGEND.filter(k => k.group === group)
    rows.push({ id: `leg:${group}`, isHeader: true, title: group, count: keys.length })

    if (isFolded[`leg:${group}`] !== true) {
      for (const k of keys) {
        rows.push({
          id: `leg:key:${k.key}`,
          left: `■ ${k.key}`,
          color: k.key,
          right: k.meaning,
          tail: k.usedBy.length === 0 ? undefined : k.usedBy.join(', '),
        })
      }
    }
  }

  return rows
}

const commandRows = (isFolded: Record<string, boolean>): Row[] => {
  const rows: Row[] = []

  for (const group of GROUPS) {
    const list = COMMANDS.filter(c => c.group === group)
    rows.push({ id: `cmd:${group}`, isHeader: true, title: group, count: list.length })

    if (isFolded[`cmd:${group}`] !== true) {
      for (const c of list) {
        rows.push({ id: `cmd:${c.name}`, left: `/${c.name}`, right: `${c.args === '' ? '' : `${c.args}  `}${c.desc}` })
      }
    }
  }

  return rows
}

const DEMO_AGES = [3_000, 75_000, 2 * 3_600_000, 26 * 3_600_000, 40 * 86_400_000]

const recentRows = (list: readonly RecentFile[], now: number, s: LayoutSettings, isFolded: Record<string, boolean>, isTight: boolean, room: number): Row[] => {
  const rows: Row[] = [{ id: 'rec:files', isHeader: true, title: 'Files this session', count: list.length }]

  if (isFolded['rec:files'] !== true) {
    if (list.length === 0) {
      rows.push({ id: 'rec:none', left: '', right: 'No Read, Edit or Write call yet this session.' })
    }
    for (const one of list) {
      const when = whenText(one.at, now, !isTight)

      rows.push({
        id: `rec:${one.path}`,
        left: one.tool,
        right: pathLabel(one.path, s.path, Math.max(8, room - when.length - 14)),
        tail: when,
      })
    }
  }
  rows.push({ id: 'rec:time', isHeader: true, title: 'Time helper: relative, with exact', count: DEMO_AGES.length })

  if (isFolded['rec:time'] !== true) {
    for (const age of DEMO_AGES) {
      rows.push({ id: `rec:age:${age}`, left: `${Math.round(age / 1000)}s ago`, right: whenText(now - age, now, !isTight), tail: relTime(now - age, now) })
    }
  }

  return rows
}

// -------------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) {
      await $.command.register({ name: c.name, description: c.desc }).catch(() => undefined)
    }
    const pinned = await loadAll($)

    for (const id of pinned) {
      const spec = PANES[id]

      if (spec !== undefined) {
        void $.ui
          .open({ id, title: spec.title, rows: spec.rows, columns: spec.columns, ...(spec.placement === undefined ? {} : { placement: spec.placement }) })
          .catch(() => undefined)
      }
    }

    return next(e)
  })

  for (const c of COMMANDS) {
    on('command.run', { command: c.name }, async ($, e) => ({
      text: await runCommand($, c.name, e.args),
      isTextDisplayOnly: true as const,
    })).catch(() => ({ text: `/${c.name} failed; nothing was changed.`, isTextDisplayOnly: true as const }))
  }

  // 120 support: the files the model read or wrote, for the Recent tab (bounded, this session only).
  on('tool.call', { tool: /^(Read|Edit|Write|NotebookEdit)$/ }, async ($, e, next) => {
    try {
      const path = pathOfCall(e as unknown as Record<string, unknown>)

      if (path !== null) {
        const at = await $.clock.now()
        await update($, recent, list => addRecent(list, { path, tool: e.tool, at }))
      }
    } catch {
      // Recording is a nicety; the call goes on.
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // 103 Zen: hide every row of the band, whoever drew it, unless a survey holds it.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const s = await read($, settings)

    if (!s.zen || e.props.hasSurvey) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, rows: [] } })
  })

  // 103 Zen, status part: a status another mod pins passes this hook (when it sits above that mod in the
  // chain) and is cleared. A status pinned before zen went on stays until its owner writes again.
  on('ui.status', async ($, e, next) => {
    const s = await read($, settings)

    return s.zen ? next({ ...e, text: undefined }) : next(e)
  }).catch(($, e, next) => next(e))

  // 117 Emphasis on errors: one quiet line under a failed call, keeping every row beneath it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const inner = await next(e)
    const s = await read($, settings)

    if (!s.errBanner || !e.props.isErrored || e.props.isInterrupted || e.props.isRunning) {
      return inner
    }
    const { Box, Text } = $.ui.resolve(e)
    const icon = ICONS[s.icons]
    const line = errorLine(e.props.output, 120)

    return (
      <Box flexDirection="column">
        {inner}
        <Box flexDirection="row" gap={1}>
          <Text color="error">{`${icon.error} failed`}</Text>
          {line !== '' && (
            <Text color="error" dimColor wrap="truncate-end">
              {line}
            </Text>
          )}
        </Box>
      </Box>
    )
  })

  // 119 Long-output banner: only above 300 lines; tool-visuals' size chip (20 lines and up) is left alone.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const inner = await next(e)
    const s = await read($, settings)

    if (!s.longBanner) {
      return inner
    }
    const long = longOutput(e.props.tool, e.props.output)

    if (long === null) {
      return inner
    }
    const { Box, Text } = $.ui.resolve(e)
    const icon = ICONS[s.icons]

    return (
      <Box flexDirection="column">
        <Text color="warning" dimColor>{`${icon.long} long output · ${long.lines} lines · ${long.kb} KB`}</Text>
        {inner}
      </Box>
    )
  })

  // 112 Language chips and 114 reading width, both around the engine's own message.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const inner = await next(e)
    const s = await read($, settings)

    if ((!s.chips && s.width === 0) || e.props.isSummary === true) {
      return inner
    }
    const langs = s.chips ? fenceLanguages(e.props.text) : []
    const columns = e.viewport?.columns
    const limit = s.width > 0 && columns !== undefined && columns > s.width ? s.width : 0

    if (langs.length === 0 && limit === 0) {
      return inner
    }
    const { Box, Text } = $.ui.resolve(e)
    const shown = langs.slice(0, 5)

    return (
      <Box flexDirection="column" {...(limit > 0 ? { width: limit } : {})}>
        {inner}
        {shown.length > 0 && (
          <Box flexDirection="row" gap={1}>
            {shown.map(lang => (
              <Text dimColor>{chipText(s.icons, lang)}</Text>
            ))}
            {langs.length > shown.length && <Text dimColor>{`+${langs.length - shown.length}`}</Text>}
          </Box>
        )}
      </Box>
    )
  })

  // 102 Floating note: one editable text; where the desktop seats it as a widget, just the words.
  on('ui.render', { component: 'Pane', requestId: 'layout-note' }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const text = await read($, note)
    const s = await read($, settings)
    const t = tune(e.surface)
    const icon = ICONS[s.icons]

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text maxLines={5} wrap="wrap">{text === '' ? '(empty note)' : text}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={t.pad}>
        <Input
          key="note"
          label={`${icon.file} `}
          placeholder="type a note, Enter keeps it"
          value={text}
          rows={4}
          submitLabel="keep"
          onInput={value => saveNote($, value)}
          onSubmit={value => saveNote($, value)}
        />
        {e.surface === 'mobile' && text !== '' && <Text wrap="wrap">{text}</Text>}
        <Box flexDirection="row" gap={1}>
          <Button key="note:clear" label="clear" {...(t.hotkeys ? { hotkey: 'c' } : {})} onPress={() => saveNote($, '')} />
          <Text dimColor>{`${text.length}/${NOTE_MAX}`}</Text>
        </Box>
      </Box>
    )
  })

  // 101 Split view: two stored blobs, aligned line by line (longest common run), side by side or stacked.
  on('ui.render', { component: 'Pane', requestId: 'layout-split' }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const sp = await read($, split)
    const s = await read($, settings)
    const isFolded = await read($, folds)
    const t = tune(e.surface)
    const icon = ICONS[s.icons]
    const compact = isCompact(s.compact, e.viewport?.columns ?? e.props.bodyColumns, e.viewport?.rows)
    const cols = Math.max(20, e.props.bodyColumns - 2 * t.pad)
    const isStacked = compact || cols < 48
    const half = Math.max(8, Math.floor((cols - 3) / 2))
    const rows = diffRows(toLines(sp.a), toLines(sp.b))
    const stats = diffStats(rows)
    const hide = isFolded['split:edit'] === true

    return (
      <Box flexDirection="column" paddingX={t.pad}>
        <Text dimColor wrap="truncate-end">{`${icon.info} A ${toLines(sp.a).length} lines · B ${toLines(sp.b).length} lines · ${stats.differ} differ`}</Text>
        <Button key="fold:split:edit" plain onPress={() => toggleFold($, 'split:edit')}>
          {`${hide ? icon.closed : icon.open} Edit the two sides`}
        </Button>
        {!hide && (
          <Box flexDirection={isStacked ? 'column' : 'row'} gap={1}>
            <Box flexGrow={1} flexDirection="column">
              <Input key="split-a" label="A " placeholder="left text" value={sp.a} rows={2} onInput={v => saveSplit($, { a: v })} onSubmit={v => saveSplit($, { a: v })} />
            </Box>
            <Box flexGrow={1} flexDirection="column">
              <Input key="split-b" label="B " placeholder="right text" value={sp.b} rows={2} onInput={v => saveSplit($, { b: v })} onSubmit={v => saveSplit($, { b: v })} />
            </Box>
          </Box>
        )}
        {rows.length === 0 && <Text dimColor>Nothing to compare yet: /lysplit left | right, or type above.</Text>}
        {rows.slice(0, 200).map(row =>
          isStacked ? (
            <Box flexDirection="column">
              {row.kind === 'same' && <Text dimColor wrap="truncate-end">{`  ${row.l ?? ''}`}</Text>}
              {row.l !== undefined && row.kind !== 'same' && <Text color="diffRemoved" wrap="truncate-end">{`- ${row.l}`}</Text>}
              {row.r !== undefined && row.kind !== 'same' && <Text color="diffAdded" wrap="truncate-end">{`+ ${row.r}`}</Text>}
            </Box>
          ) : (
            <Box flexDirection="row">
              <Box width={half}>
                <Text
                  {...(row.kind === 'same' ? { dimColor: true } : { color: row.kind === 'chg' ? 'warning' : 'diffRemoved' })}
                  wrap="truncate-end"
                >{`${row.l ?? ''}`}</Text>
              </Box>
              <Text dimColor>{` ${row.kind === 'same' ? '│' : row.kind === 'chg' ? '~' : row.kind === 'del' ? '<' : '>'} `}</Text>
              <Box width={half}>
                <Text
                  {...(row.kind === 'same' ? { dimColor: true } : { color: row.kind === 'chg' ? 'warning' : 'diffAdded' })}
                  wrap="truncate-end"
                >{`${row.r ?? ''}`}</Text>
              </Box>
            </Box>
          ),
        )}
        {rows.length > 200 && <Text dimColor>{`+${rows.length - 200} more rows`}</Text>}
      </Box>
    )
  })

  // The showcase and settings page: tabs, collapsible sections (115), sticky headers (120), two columns (104),
  // compact (105), per-surface tuning (118), icon packs (108), stripes (109), path cuts (110), times (111).
  on('ui.render', { component: 'Pane', requestId: 'layout-main' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, settings)
    const isFolded = await read($, folds)
    const current = asView(await read($, view))
    const files = await read($, recent)
    const pinned = await read($, pins)
    const now = await $.clock.now()
    const t = tune(e.surface)
    const icon = ICONS[s.icons]
    const columns = e.viewport?.columns ?? e.props.bodyColumns
    const compact = isCompact(s.compact, columns, e.viewport?.rows)
    const room = Math.max(20, e.props.bodyColumns - 2 * t.pad)
    const isWide = useTwoCols(s.cols, e.props.bodyColumns)
    const lw = compact ? 12 : 17
    const labels = room < 64 || compact ? 1 : 0

    const head = (id: string, title: string, count?: number, isSticky = false) => (
      <Button key={`fold:${id}${isSticky ? ':sticky' : ''}`} plain onPress={() => toggleFold($, id)}>
        {`${isFolded[id] === true ? icon.closed : icon.open} ${title}${isSticky ? ' ↑' : ''}`}
        {count !== undefined && <Text dimColor>{` ${count}`}</Text>}
      </Button>
    )

    const tabs = (
      <Box flexDirection="row" gap={1}>
        {VIEWS.map((v, i) => (
          <Button
            key={`tab:${v}`}
            {...(current !== v ? { plain: true as const } : {})}
            {...(current === v ? { variant: 'primary' as const } : {})}
            {...(t.hotkeys ? { hotkey: String(i + 1) } : {})}
            onPress={() => setView($, v)}
          >
            {`${current === v ? `${icon.here} ` : ''}${VIEW_LABEL[v][labels]}`}
          </Button>
        ))}
      </Box>
    )

    const subtitle = compact ? null : (
      <Text dimColor wrap="truncate-end" {...(t.sizes ? { size: 'footnote' as const } : {})}>
        {`${e.surface} · ${e.props.bodyColumns} cols · ${isWide ? '2-col' : '1-col'} · ${compact ? 'compact' : 'roomy'} · ${e.props.placement}`}
      </Text>
    )
    const base = 1 + (subtitle === null ? 0 : 1)

    const listRows = (all: Row[]) => {
      const items = withSticky(all, e.props.scroll.offset, base)
      let n = 0

      return (
        <Box flexDirection="column">
          {items.map(r => {
            if (r.isHeader === true) {
              return head(r.id, r.title ?? '', r.count, r.isSticky === true)
            }
            n += 1
            const isOdd = s.stripes && n % 2 === 0

            return (
              <Box flexDirection="row">
                <Box width={lw} flexShrink={0}>
                  <Text {...(r.color === undefined ? { dimColor: isOdd } : { color: r.color })} wrap="truncate-end">{r.left ?? ''}</Text>
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  <Text dimColor={isOdd} wrap="truncate-end">{r.right ?? ''}</Text>
                </Box>
                {r.tail !== undefined && !compact && (
                  <Box flexShrink={0} paddingLeft={1}>
                    <Text dimColor wrap="truncate-end">{r.tail}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )
    }

    const setting = (n: number, key: string, label: string, value: string, onPress: () => void, hotkey: string, hint?: string) => (
      <Box flexDirection="row" gap={1}>
        <Box width={lw} flexShrink={0}>
          <Text dimColor={s.stripes && n % 2 === 1} wrap="truncate-end">{label}</Text>
        </Box>
        <Button key={`set:${key}`} label={value} {...(t.hotkeys ? { hotkey } : {})} onPress={onPress} />
        {hint !== undefined && !compact && (
          <Text dimColor wrap="truncate-end">{hint}</Text>
        )}
      </Box>
    )

    const display = (
      <Box flexDirection="column">
        {head('set:display', 'Display')}
        {isFolded['set:display'] !== true && (
          <Box flexDirection="column">
            {setting(0, 'zen', 'zen mode', s.zen ? 'on' : 'off', () => patch($, { zen: !s.zen }), 'z', 'hides band rows and status text')}
            {setting(1, 'compact', 'compact', s.compact, () => patch($, { compact: nextOf(AUTO_MODES, s.compact) }), 'c', 'auto: small windows')}
            {setting(2, 'cols', 'columns', s.cols, () => patch($, { cols: nextOf(COLS_MODES, s.cols) }), 'l', `auto: two from ${100}`)}
            {setting(3, 'icons', 'icons', s.icons, () => patch($, { icons: nextOf(ICON_SETS, s.icons) }), 'i', `${icon.ok} ${icon.warn} ${icon.error} ${icon.info}`)}
            {setting(4, 'stripes', 'row stripes', s.stripes ? 'on' : 'off', () => patch($, { stripes: !s.stripes }), 's', 'alternate tone')}
            {setting(5, 'path', 'path cut', s.path, () => patch($, { path: nextOf(PATH_MODES, s.path) }), 'p', pathLabel('/Users/me/app/src/deep/file.ts', s.path, 30))}
          </Box>
        )}
      </Box>
    )

    const transcript = (
      <Box flexDirection="column">
        {head('set:transcript', 'Transcript')}
        {isFolded['set:transcript'] !== true && (
          <Box flexDirection="column">
            {setting(0, 'err', 'error banner', s.errBanner ? 'on' : 'off', () => patch($, { errBanner: !s.errBanner }), 'e', 'under a failed call')}
            {setting(1, 'long', 'long output', s.longBanner ? 'on' : 'off', () => patch($, { longBanner: !s.longBanner }), 'g', `over ${LONG_LINES} lines`)}
            {setting(2, 'chips', 'language chips', s.chips ? 'on' : 'off', () => patch($, { chips: !s.chips }), 'h', chipText(s.icons, 'ts'))}
            {setting(3, 'width', 'reading width', s.width === 0 ? 'off' : String(s.width), () => patch($, { width: s.width === 0 ? 80 : s.width < 120 ? s.width + 20 : 0 }), 'w', 'cells, assistant text')}
          </Box>
        )}
      </Box>
    )

    const panes = (
      <Box flexDirection="column">
        {head('set:panes', 'Panes and pins', Object.keys(PANES).length)}
        {isFolded['set:panes'] !== true && (
          <Box flexDirection="column">
            {Object.entries(PANES).map(([id, spec]) => (
              <Box flexDirection="row" gap={1}>
                <Box width={lw} flexShrink={0}>
                  <Text wrap="truncate-end">{spec.title}</Text>
                </Box>
                <Button key={`open:${id}`} label="open" onPress={() => openPane($, id)} />
                <Button key={`pin:${id}`} label={pinned.includes(id) ? `${icon.pin} pinned` : 'pin'} onPress={() => togglePin($, id)} />
              </Box>
            ))}
          </Box>
        )}
        <Button key="reset" label="reset layout" onPress={() => resetAll($)} />
      </Box>
    )

    let body
    if (current === 'settings') {
      body = isWide ? (
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column" width={Math.floor(room * 0.55)}>
            {display}
            {transcript}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {panes}
            <Text dimColor>{`${icon.info} /ly lists every command`}</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {display}
          {transcript}
          {panes}
        </Box>
      )
    } else if (current === 'legend') {
      body = listRows(legendRows(isFolded))
    } else if (current === 'recent') {
      body = listRows(recentRows(files, now, s, isFolded, compact, room))
    } else if (current === 'commands') {
      body = listRows(commandRows(isFolded))
    } else {
      const here: Row[] = [{ id: 'srf:all', isHeader: true, title: 'Surfaces', count: SURFACES.length }]

      if (isFolded['srf:all'] !== true) {
        for (const name of SURFACES) {
          const x = tune(name)
          here.push({
            id: `srf:${name}`,
            left: `${name === e.surface ? icon.here : ' '} ${name}`,
            right: `hotkeys ${x.hotkeys ? 'on' : 'off'} · sizes ${x.sizes ? 'on' : 'off'} · pad ${x.pad} · input: ${x.input}`,
          })
        }
      }
      here.push({ id: 'srf:now', isHeader: true, title: 'This pane right now', count: 7 })

      if (isFolded['srf:now'] !== true) {
        here.push(
          { id: 'srf:a', left: 'surface', right: e.surface },
          { id: 'srf:b', left: 'body columns', right: String(e.props.bodyColumns) },
          { id: 'srf:c', left: 'viewport', right: e.viewport === undefined ? 'not measured' : `${e.viewport.columns} x ${e.viewport.rows}${e.viewport.isFullscreen === true ? ' fullscreen' : ''}` },
          { id: 'srf:d', left: 'seat', right: e.props.placement },
          { id: 'srf:e', left: 'layout', right: `${compact ? 'compact' : 'roomy'}, ${isWide ? 'two columns' : 'one column'}` },
          { id: 'srf:f', left: 'scroll', right: `offset ${e.props.scroll.offset} of window ${e.props.scroll.bodyRows}; ${t.scroll}` },
          { id: 'srf:g', left: 'keys', right: t.hotkeys ? 'hotkeys drawn on buttons' : 'touch only, no hotkeys' },
        )
      }
      body = listRows(here)
    }

    return (
      <Box flexDirection="column" paddingX={t.pad}>
        {tabs}
        {subtitle}
        {body}
      </Box>
    )
  })
}
