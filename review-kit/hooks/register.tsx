import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Cfg, FileRec, Finding, Meta } from '../types'
import {
  CHECKLIST,
  DEFAULT_CFG,
  DETECTORS,
  budgetState,
  deriveFindings,
  importsOf,
  isCode,
  lineDelta,
  openCount,
  parseOnOff,
  runDetectors,
  shortPath,
  summaryText,
  toFinding,
  visibleFindings,
} from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]
type Input = Record<string, unknown>
type ToolOut = { deny?: string; isError?: boolean }

const PANE = 'review-kit-main'
const FILES_CAP = 80
const FINDINGS_CAP = 150
const SEEN_CAP = 100
const TOAST_GAP_MS = 3 * 60_000
const READ_BYTES = 65_536
const MAX_CONTENT = 60_000

const filesAtom = atom({ plugin: 'review-kit', key: 'files' } as const, [], { shape: 'files-1' })
const findingsAtom = atom({ plugin: 'review-kit', key: 'findings' } as const, [], { shape: 'findings-1' })
const dismissedAtom = atom({ plugin: 'review-kit', key: 'dismissed' } as const, [], { shape: 'dismissed-1' })
const checksAtom = atom({ plugin: 'review-kit', key: 'checks' } as const, {}, { shape: 'checks-1' })
const cfgAtom = atom({ plugin: 'review-kit', key: 'cfg' } as const, DEFAULT_CFG, { shape: 'cfg-1' })
const metaAtom = atom(
  { plugin: 'review-kit', key: 'meta' } as const,
  { turn: 0, turnLines: 0, budgetWarned: false, lastToastAt: 0, seen: [] } as Meta,
  { shape: 'meta-1' },
)
const tabAtom = atom({ plugin: 'review-kit', key: 'tab' } as const, 'findings')

const COMMANDS: [string, string, string?][] = [
  ['rk', 'review-kit: list its commands'],
  ['rkpane', 'Open the review-kit pane: findings, checklist, files, detectors', '[findings|checklist|files|detectors]'],
  ['rkcheck', 'Show the review checklist, or tick/untick item <n>', '[n|reset]'],
  ['rkbudget', 'Warn once per turn when lines changed exceed <lines> (off to disable)', '<lines|off>'],
  ['rkdismiss', 'Dismiss finding <n> (numbers from the pane or /rkpane), or all', '<n|1,2,3|all>'],
  ['rkreset', 'Clear recorded findings, files, dismissals and ticks (all: settings too)', '[all]'],
  ['rkdetect', 'List detectors, or switch one on or off', '[name|all on|off]'],
  ['rkset', 'Settings: toast (the single serious-finding toast) and read (read back edited files)', '<toast|read> <on|off>'],
]

const cwdOf = ($: Dollar) => $.session.cwd().catch(() => '/')

// ---------------------------------------------------------------------------
// Engine glue (these take `$`, so they live at the top level)
// ---------------------------------------------------------------------------

const saveCfg = async ($: Dollar, fn: (c: Cfg) => Cfg) => {
  await update($, cfgAtom, fn)
  await $.store.set('cfg', await read($, cfgAtom)).catch(() => undefined)
}

const compute = async ($: Dollar): Promise<{ list: Finding[]; cwd: string }> => {
  const [files, stored, dismissed, cfg, cwd] = await Promise.all([
    read($, filesAtom),
    read($, findingsAtom),
    read($, dismissedAtom),
    read($, cfgAtom),
    cwdOf($),
  ])

  return { list: visibleFindings(stored, deriveFindings(files, cfg.off, cwd), dismissed, cfg.off), cwd }
}

/** Reads one file Claude just edited, read-only and bounded. */
const readEdited = async ($: Dollar, path: string): Promise<{ text: string; whole: boolean } | undefined> => {
  const stat = await $.fs.stat(path).catch(() => undefined)

  if (stat === undefined || typeof stat.size !== 'number') {
    return undefined
  }
  const text = await $.fs.read(path, { length: READ_BYTES }).catch(() => undefined)

  return typeof text === 'string' ? { text, whole: stat.size <= READ_BYTES } : undefined
}

const announce = async ($: Dollar) => {
  const cfg = await read($, cfgAtom)

  if (!cfg.toast) {
    return
  }
  const meta = await read($, metaAtom)
  const { list } = await compute($)
  const fresh = list.filter(f => f.sev === 'warn' && !meta.seen.includes(f.id))

  if (fresh.length === 0) {
    return
  }
  const now = await $.clock.now()

  if (now - meta.lastToastAt < TOAST_GAP_MS) {
    return
  }
  const kinds = [...new Set(fresh.map(f => f.kind))].slice(0, 3).join(', ')
  $.ui.toast(`review-kit: ${fresh.length} serious hint(s) (${kinds}). /rkpane to look; heuristics only.`, { timeoutMs: 6000 })
  await update($, metaAtom, m => ({ ...m, lastToastAt: now, seen: [...m.seen, ...fresh.map(f => f.id)].slice(-SEEN_CAP) }))
}

const observe = async ($: Dollar, input: Input, out: ToolOut) => {
  if (typeof out.deny === 'string' || out.isError === true) {
    return
  }
  const path = typeof input.file_path === 'string' ? input.file_path : ''

  if (path === '') {
    return
  }
  const isWrite = input.tool === 'Write'
  const content = String((isWrite ? input.content : input.new_string) ?? '').slice(0, MAX_CONTENT)
  const old = isWrite ? '' : String(input.old_string ?? '').slice(0, MAX_CONTENT)
  const cfg = await read($, cfgAtom)
  const disk = cfg.readFiles && isCode(path) && !isWrite ? await readEdited($, path) : undefined
  const meta = await read($, metaAtom)
  const now = await $.clock.now()
  const delta = lineDelta(old, content, isWrite)

  const hits = runDetectors({ path, content, old, isWrite, corpus: disk?.whole === true ? disk.text : undefined }, cfg.off)
  const found = hits.map(h => toFinding(h, path, meta.turn))

  const imports = importsOf(disk !== undefined ? disk.text : content)
  await update($, filesAtom, list => {
    const prev = list.find(f => f.path === path)
    const rec: FileRec = {
      path,
      edits: (prev?.edits ?? 0) + 1,
      added: (prev?.added ?? 0) + delta.added,
      removed: (prev?.removed ?? 0) + delta.removed,
      isNew: prev?.isNew === true || isWrite,
      imports: disk !== undefined || isWrite ? imports : [...new Set([...(prev?.imports ?? []), ...imports])].slice(0, 40),
      at: now,
    }

    return [...list.filter(f => f.path !== path), rec].slice(-FILES_CAP)
  })

  const budget = budgetState(meta, cfg.budget, delta.added + delta.removed)

  if (budget.warn && cfg.budget !== null && !cfg.off.includes('budget')) {
    found.push(
      toFinding(
        { kind: 'budget', sev: 'warn', line: 0, snippet: `turn ${meta.turn}: ${budget.turnLines} lines changed (budget ${cfg.budget})`, msg: 'hint: this turn changed more lines than your /rkbudget; consider splitting the patch' },
        `turn ${meta.turn}`,
        meta.turn,
      ),
    )
  }
  await update($, metaAtom, m => ({ ...m, turnLines: budget.turnLines, budgetWarned: m.budgetWarned || budget.warn }))
  await update($, findingsAtom, list => {
    const ids = new Set(found.map(f => f.id))

    return [...list.filter(f => !ids.has(f.id)), ...found].slice(-FINDINGS_CAP)
  })
  await announce($)
}

const newTurn = async ($: Dollar) => {
  await update($, metaAtom, m => ({ ...m, turn: m.turn + 1, turnLines: 0, budgetWarned: false }))
}

const openPane = ($: Dollar) => $.ui.open({ id: PANE, title: 'Review kit' }).catch(() => undefined)

const loadSaved = async ($: Dollar) => {
  const saved = await $.store.get('cfg').catch(() => undefined)

  if (saved !== null && typeof saved === 'object') {
    await update($, cfgAtom, () => ({ ...DEFAULT_CFG, ...(saved as Partial<Cfg>) }))
  }
}

const helpText = () =>
  [
    'review-kit: heuristic review hints for code Claude changes this session. Hints only; nothing is ever blocked.',
    ...COMMANDS.map(([n, d, a]) => `/${n}${a ? ` ${a}` : ''}: ${d}`),
    `Detectors (${DETECTORS.length}): ${DETECTORS.map(d => d.kind).join(', ')}`,
  ].join('\n')

const checklistText = async ($: Dollar) => {
  const checks = await read($, checksAtom)
  const { list } = await compute($)

  return [
    'Review checklist (tick with /rkcheck <n>):',
    ...CHECKLIST.map((c, i) => {
      const n = openCount(c, list)

      return `${i + 1}. [${checks[c.id] === true ? 'x' : ' '}] ${c.label}: ${c.ask}${n > 0 ? ` (${n} open hint${n === 1 ? '' : 's'})` : ''}`
    }),
  ].join('\n')
}

const runCheck = async ($: Dollar, args: string) => {
  const a = args.trim().toLowerCase()

  if (a === 'reset') {
    await update($, checksAtom, () => ({}))

    return 'Checklist cleared.'
  }
  const n = Number(a)

  if (a !== '' && Number.isInteger(n) && n >= 1 && n <= CHECKLIST.length) {
    const item = CHECKLIST[n - 1]

    if (item !== undefined) {
      await update($, checksAtom, c => ({ ...c, [item.id]: c[item.id] !== true }))
    }
  } else if (a !== '') {
    return `Use /rkcheck <1-${CHECKLIST.length}>, /rkcheck reset, or /rkcheck alone.`
  }
  await update($, tabAtom, () => 'checklist')
  await openPane($)

  return checklistText($)
}

const runBudget = async ($: Dollar, args: string) => {
  const a = args.trim().toLowerCase()
  const cfg = await read($, cfgAtom)

  if (a === '') {
    return cfg.budget === null ? 'Patch budget is off. Use /rkbudget <lines>.' : `Patch budget: ${cfg.budget} lines changed per turn (added plus removed). Use /rkbudget off to disable.`
  }

  if (a === 'off') {
    await saveCfg($, c => ({ ...c, budget: null }))

    return 'Patch budget off.'
  }
  const n = Number(a)

  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
    return 'Give a whole number of lines, e.g. /rkbudget 300, or off.'
  }
  await saveCfg($, c => ({ ...c, budget: n }))

  return `Patch budget set to ${n} lines per turn: one warning per turn when exceeded.`
}

const runDismiss = async ($: Dollar, args: string) => {
  const a = args.trim().toLowerCase()
  const { list } = await compute($)

  if (list.length === 0) {
    return 'No findings to dismiss.'
  }
  const picked =
    a === 'all'
      ? list
      : a
          .split(/[\s,]+/)
          .map(s => Number(s))
          .filter(n => Number.isInteger(n) && n >= 1 && n <= list.length)
          .map(n => list[n - 1])
          .filter((f): f is Finding => f !== undefined)

  if (picked.length === 0) {
    return `Use /rkdismiss <n> with n from 1 to ${list.length}, or /rkdismiss all.`
  }
  await update($, dismissedAtom, d => [...new Set([...d, ...picked.map(f => f.id)])].slice(-300))

  return `Dismissed ${picked.length} finding(s).`
}

const runReset = async ($: Dollar, args: string) => {
  await update($, filesAtom, () => [])
  await update($, findingsAtom, () => [])
  await update($, dismissedAtom, () => [])
  await update($, checksAtom, () => ({}))
  await update($, metaAtom, () => ({ turn: 0, turnLines: 0, budgetWarned: false, lastToastAt: 0, seen: [] }))

  if (args.trim().toLowerCase() === 'all') {
    await saveCfg($, () => DEFAULT_CFG)

    return 'review-kit: recorded data and settings cleared.'
  }

  return 'review-kit: recorded findings, files, dismissals and ticks cleared (settings kept; /rkreset all clears those too).'
}

const runDetect = async ($: Dollar, args: string) => {
  const [name = '', flagText = ''] = args.trim().toLowerCase().split(/\s+/)
  const cfg = await read($, cfgAtom)
  const flag = parseOnOff(flagText)
  const list = () => DETECTORS.map(d => `${cfg.off.includes(d.kind) ? ' off' : '  on'}  ${d.kind} (#${d.idea} ${d.title}): ${d.info}`).join('\n')

  if (name === '') {
    return `Detectors (switch with /rkdetect <name> on|off):\n${list()}`
  }
  const kinds = name === 'all' ? DETECTORS.map(d => d.kind as string) : DETECTORS.filter(d => d.kind === name).map(d => d.kind as string)

  if (kinds.length === 0 || flag === undefined) {
    return `Use /rkdetect <name|all> on|off. Names: ${DETECTORS.map(d => d.kind).join(', ')}`
  }
  await saveCfg($, c => ({ ...c, off: flag ? c.off.filter(k => !kinds.includes(k)) : [...new Set([...c.off, ...kinds])] }))

  return `${name} is now ${flag ? 'on' : 'off'}.`
}

const runSet = async ($: Dollar, args: string) => {
  const [key = '', flagText = ''] = args.trim().toLowerCase().split(/\s+/)
  const flag = parseOnOff(flagText)

  if ((key !== 'toast' && key !== 'read') || flag === undefined) {
    const cfg = await read($, cfgAtom)

    return `Settings: toast ${cfg.toast ? 'on' : 'off'} (one short toast, at most every 3 minutes, only for serious hints); read ${cfg.readFiles ? 'on' : 'off'} (read back, bounded to ${READ_BYTES} bytes, only files Claude edited). Use /rkset <toast|read> <on|off>.`
  }
  await saveCfg($, c => (key === 'toast' ? { ...c, toast: flag } : { ...c, readFiles: flag }))

  return `${key} is now ${flag ? 'on' : 'off'}.`
}

const runPane = async ($: Dollar, args: string) => {
  const tab = args.trim().toLowerCase()

  if (['findings', 'checklist', 'files', 'detectors'].includes(tab)) {
    await update($, tabAtom, () => tab)
  }
  await openPane($)
  const { list, cwd } = await compute($)

  return summaryText(list, cwd, 8)
}

// ---------------------------------------------------------------------------

const TABS: [string, string][] = [
  ['findings', 'Findings'],
  ['checklist', 'Checklist'],
  ['files', 'Files'],
  ['detectors', 'Detectors'],
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description, argumentHint] of COMMANDS) {
      await $.command.register({ name, description, argumentHint }).catch(() => undefined)
    }
    await loadSaved($).catch(() => undefined)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined) {
      await newTurn($).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /^(Edit|Write)$/ }, async ($, e, next) => {
    const out = await next(e)
    await observe($, e as unknown as Input, out as unknown as ToolOut).catch(() => undefined)

    return out
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'rk' }, async () => ({ text: helpText() })).catch(($, e, next) => next(e))

  on('command.run', { command: 'rkpane' }, async ($, e) => ({ text: await runPane($, e.args) })).catch(($, e, next) => next(e))

  on('command.run', { command: 'rkcheck' }, async ($, e) => ({ text: await runCheck($, e.args) })).catch(($, e, next) => next(e))

  on('command.run', { command: 'rkbudget' }, async ($, e) => ({ text: await runBudget($, e.args) })).catch(($, e, next) => next(e))

  on('command.run', { command: 'rkdismiss' }, async ($, e) => ({ text: await runDismiss($, e.args) })).catch(($, e, next) => next(e))

  on('command.run', { command: 'rkreset' }, async ($, e) => ({ text: await runReset($, e.args) })).catch(($, e, next) => next(e))

  on('command.run', { command: 'rkdetect' }, async ($, e) => ({ text: await runDetect($, e.args) })).catch(($, e, next) => next(e))

  on('command.run', { command: 'rkset' }, async ($, e) => ({ text: await runSet($, e.args) })).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const tab = await read($, tabAtom)
    const { list, cwd } = await compute($)
    const cfg = await read($, cfgAtom)
    const meta = await read($, metaAtom)
    const files = await read($, filesAtom)
    const checks = await read($, checksAtom)
    const rows = e.viewport?.rows ?? 24
    const warn = list.filter(f => f.sev === 'warn').length

    const header = (
      <Box flexDirection="column" marginBottom="sm">
        <Box justifyContent="space-between">
          <Text size="heading" weight="bold">
            Review kit
          </Text>
          <Text dimColor mono tabular>
            {list.length} hint{list.length === 1 ? '' : 's'}
            {warn > 0 ? ` · ${warn} serious` : ''}
          </Text>
        </Box>
        <Text dimColor size="caption">
          Heuristics only: every item is a hint and nothing is blocked.
          {cfg.budget !== null ? ` Turn size ${meta.turnLines}/${cfg.budget} lines.` : ''}
        </Text>
        <Box gap="sm" marginTop="sm">
          {TABS.map(([id, label]) => (
            <Button
              key={`tab-${id}`}
              label={label}
              variant={tab === id ? 'primary' : 'secondary'}
              onPress={() => update($, tabAtom, () => id)}
            />
          ))}
        </Box>
      </Box>
    )

    if (tab === 'checklist') {
      return (
        <Box flexDirection="column" padding="sm">
          {header}
          {CHECKLIST.map(item => {
            const n = openCount(item, list)

            return (
              <Box flexDirection="column" marginTop="sm">
                <Button
                  key={`ck-${item.id}`}
                  label={`${checks[item.id] === true ? '[x]' : '[ ]'} ${item.label}${n > 0 ? `  (${n} hint${n === 1 ? '' : 's'})` : ''}`}
                  onPress={() => update($, checksAtom, c => ({ ...c, [item.id]: c[item.id] !== true }))}
                />
                <Text dimColor size="caption">
                  {item.ask}
                </Text>
              </Box>
            )
          })}
        </Box>
      )
    }

    if (tab === 'files') {
      const room = Math.max(4, rows - 12)
      const sorted = [...files].sort((a, b) => b.at - a.at).slice(0, room)

      return (
        <Box flexDirection="column" padding="sm">
          {header}
          {files.length === 0 && <Text dimColor>No files edited by Claude yet this session.</Text>}
          {sorted.map(f => {
            const flags = list.filter(x => x.file === f.path).length

            return (
              <Box gap="sm">
                <Text mono tabular color="success">
                  +{f.added}
                </Text>
                <Text mono tabular color="error">
                  -{f.removed}
                </Text>
                <Text>{shortPath(f.path, cwd)}</Text>
                <Text dimColor>
                  {f.edits}x{f.isNew ? ' new' : ''}
                  {flags > 0 ? ` · ${flags} hint${flags === 1 ? '' : 's'}` : ''}
                </Text>
              </Box>
            )
          })}
          {files.length > sorted.length && <Text dimColor>... and {files.length - sorted.length} more</Text>}
        </Box>
      )
    }

    if (tab === 'detectors') {
      return (
        <Box flexDirection="column" padding="sm">
          {header}
          {DETECTORS.map(d => {
            const isOff = cfg.off.includes(d.kind)

            return (
              <Box flexDirection="column" marginTop="sm">
                <Button
                  key={`dt-${d.kind}`}
                  label={`${isOff ? 'off' : 'on '}  #${d.idea} ${d.title}`}
                  onPress={() => saveCfg($, c => ({ ...c, off: isOff ? c.off.filter(k => k !== d.kind) : [...c.off, d.kind] }))}
                />
                <Text dimColor size="caption">
                  {d.info}
                </Text>
              </Box>
            )
          })}
          <Box gap="sm" marginTop="md">
            <Button key="set-toast" label={`toast ${cfg.toast ? 'on' : 'off'}`} onPress={() => saveCfg($, c => ({ ...c, toast: !c.toast }))} />
            <Button key="set-read" label={`read edited files ${cfg.readFiles ? 'on' : 'off'}`} onPress={() => saveCfg($, c => ({ ...c, readFiles: !c.readFiles }))} />
          </Box>
        </Box>
      )
    }
    const room = Math.max(2, Math.floor((rows - 12) / 4))
    const shown = list.slice(0, room)

    return (
      <Box flexDirection="column" padding="sm">
        {header}
        {list.length === 0 && <Text dimColor>No hints yet. They appear as Claude edits files.</Text>}
        {shown.map((f, i) => (
          <Box flexDirection="column" marginTop="sm">
            <Box gap="sm">
              <Text mono dimColor tabular>
                {i + 1}.
              </Text>
              <Text color={f.sev === 'warn' ? 'warning' : 'subtle'} weight="bold">
                {f.sev === 'warn' ? 'serious hint' : 'hint'}
              </Text>
              <Text weight="semibold">{f.kind}</Text>
              <Text dimColor>{shortPath(f.file, cwd)}</Text>
            </Box>
            <Text>{f.msg.replace(/^hint:\s*/, '')}</Text>
            {f.snippet !== '' && (
              <Text mono dimColor>
                {f.snippet}
              </Text>
            )}
            <Box>
              <Button key={`dismiss-${f.id}`} label="Dismiss" dimColor onPress={() => update($, dismissedAtom, d => [...d, f.id].slice(-300))} />
            </Box>
          </Box>
        ))}
        {list.length > shown.length && (
          <Text dimColor>
            ... {list.length - shown.length} more; /rkdismiss to clear some, or enlarge the pane.
          </Text>
        )}
      </Box>
    )
  })
}
