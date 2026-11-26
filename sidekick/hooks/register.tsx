import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import {
  addCommand,
  addLoose,
  addToDay,
  baseName,
  BIG_CHARS,
  bigFileWarning,
  closingQuestion,
  dayOf,
  dayText,
  DEFAULT_OFF,
  emptyDay,
  FEATURES,
  isSensitive,
  isTestCommand,
  keyOf,
  looseEnds,
  parseServers,
  PRESET_RULES,
  quote,
  safeAsk,
  SCOPE_FILES,
  tailOf,
  unbackedClaims,
} from './pure'
import type { Day, Server } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]
type Tab = 'loose' | 'rules' | 'queue' | 'today' | 'project' | 'servers' | 'rewind'
type Rule = { text: string; isOn: boolean }
type Under = { tail: string; lines: string[] }
type Copy = { path: string; before: string | null; after: string }

const PANE = 'sidekick'
const TABS = [
  ['loose', 'Loose ends'],
  ['rules', 'Rules'],
  ['queue', 'Queue'],
  ['today', 'Today'],
  ['project', 'Project'],
  ['servers', 'Servers'],
  ['rewind', 'Rewind'],
] as const
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit'])

const panelQuery = atom({ plugin: 'sidekick', key: 'panelQuery' } as const, '')
const off = atom({ plugin: 'sidekick', key: 'off' } as const, [...DEFAULT_OFF] as string[], { shape: 'off-1' })
const tab = atom({ plugin: 'sidekick', key: 'tab' } as const, 'loose' as Tab)
const rules = atom({ plugin: 'sidekick', key: 'rules' } as const, [] as Rule[], { shape: 'rules-1' })
const loose = atom({ plugin: 'sidekick', key: 'loose' } as const, [] as string[], { shape: 'loose-1' })
const queue = atom({ plugin: 'sidekick', key: 'queue' } as const, [] as string[], { shape: 'queue-1' })
const commands = atom({ plugin: 'sidekick', key: 'commands' } as const, [] as string[], { shape: 'commands-1' })
const day = atom({ plugin: 'sidekick', key: 'day' } as const, emptyDay('') as Day, { shape: 'day-1' })
const under = atom({ plugin: 'sidekick', key: 'under' } as const, [] as Under[], { shape: 'under-1' })
const marks = atom({ plugin: 'sidekick', key: 'marks' } as const, [] as string[], { shape: 'marks-1' })
const servers = atom({ plugin: 'sidekick', key: 'servers' } as const, [] as Server[], { shape: 'servers-1' })
const second = atom({ plugin: 'sidekick', key: 'second' } as const, '')
const rewind = atom({ plugin: 'sidekick', key: 'rewind' } as const, { tail: '', files: [] as string[], report: '' }, { shape: 'rewind-1' })

// This turn, and what the right-click menu needs. Not state: nothing redraws when these change.
let project = 'all'
let ask = ''
let turnFiles = new Set<string>()
let turnCopies: Copy[] = []
let turnFailed = 0
let isTestRun = false
let isCommandRun = false
let isBranchTold = false
let isAdviceGiven = false
const limitsTold = new Set<string>()
const history: { tail: string; copies: Copy[] }[] = []
const replyTexts = new Map<string, string>()
const failures = new Map<string, string>()

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const keep = <V,>(map: Map<string, V>, key: string, value: V) => {
  map.delete(key)
  map.set(key, value)

  if (map.size > 150) {
    map.delete(map.keys().next().value as string)
  }
}

const load = async (d: Dollar) => {
  const savedOff = await d.store.get('off')
  await update(d, off, () => (savedOff === undefined ? [...DEFAULT_OFF] : strings(savedOff)))
  const savedRules = await d.store.get('rules')
  await update(d, rules, () =>
    Array.isArray(savedRules) ? (savedRules as Rule[]).filter(r => typeof r?.text === 'string').map(r => ({ text: r.text, isOn: r.isOn !== false })) : [],
  )
  const ends = strings(await d.store.get(`loose:${project}`))
  await update(d, loose, () => ends)
  const cmds = strings(await d.store.get(`commands:${project}`))
  await update(d, commands, () => cmds)
  const today = (await d.store.get('day')) as Day | undefined
  await update(d, day, () => (today !== undefined && Array.isArray(today.files) ? today : emptyDay('')))
}

const isOn = async (d: Dollar, id: string) => !(await read(d, off)).includes(id)

const toggle = async (d: Dollar, id: string) => {
  const list = await read(d, off)
  const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  await update(d, off, () => next)
  await d.store.set('off', next)
}

const saveRules = async (d: Dollar, list: Rule[]) => {
  await update(d, rules, () => list)
  await d.store.set('rules', list)
}

const addRule = async (d: Dollar, text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 200)
  const list = await read(d, rules)

  if (clean !== '') {
    await saveRules(d, [...list.filter(r => r.text !== clean), { text: clean, isOn: true }].slice(-20))
    d.ui.toast('Saved as a rule. It applies from your next new chat.')
  }
}

const saveLoose = async (d: Dollar, list: string[]) => {
  await update(d, loose, () => list)
  await d.store.set(`loose:${project}`, list)
}

const fill = async (d: Dollar, text: string) => {
  const filled = await d.prompt.fill({ text, mode: 'insert' })

  if (filled?.isFilled === false) {
    d.ui.toast('Could not fill the prompt box.')
  }
}

const openTab = async (d: Dollar, to: Tab) => {
  await update(d, tab, () => to)
  await d.ui.open({ id: PANE, title: 'Sidekick' })
}

const refreshServers = async (d: Dollar) => {
  const out = await d.process.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'], { timeoutMs: 8000 }).catch(() => null)
  await update(d, servers, () => (out === null ? [] : parseServers(out.stdout)))
}

const secondOpinion = async (d: Dollar) => {
  const out = await d.process.run(['git', '--no-optional-locks', 'diff', '--no-color'], { timeoutMs: 8000 }).catch(() => null)
  const change = out?.stdout.slice(0, 12_000) ?? ''

  if (change.trim() === '') {
    await update(d, second, () => 'Nothing to review: no uncommitted changes, or not a git project.')

    return
  }
  await update(d, second, () => 'Asking…')
  const reply = await d.model.complete({
    model: 'claude-haiku-5-5',
    system: 'You review a diff. List only real problems, most serious first, in at most five short lines. If there are none, say so.',
    prompt: change,
    maxTokens: 600,
    timeoutMs: 60_000,
  })
  await update(d, second, () => (reply.isAnswered ? reply.text : 'No answer from the model.'))
}

/** Which files a rewind to before one reply would touch: that turn's and every later one's. */
const copiesFrom = (tail: string): Map<string, { before: string | null; after: string }> => {
  const at = history.findIndex(h => h.tail === tail)
  const all = new Map<string, { before: string | null; after: string }>()

  for (const entry of at < 0 ? [] : history.slice(at)) {
    for (const c of entry.copies) {
      all.set(c.path, { before: all.get(c.path)?.before === undefined ? c.before : (all.get(c.path)?.before ?? null), after: c.after })
    }
  }

  return all
}

const showRewind = async (d: Dollar, tail: string) => {
  await update(d, rewind, () => ({ tail, files: [...copiesFrom(tail).keys()], report: '' }))
  await openTab(d, 'rewind')
}

/** Puts files back. A file changed since Claude left it is skipped, never overwritten. */
const doRewind = async (d: Dollar) => {
  const { tail } = await read(d, rewind)
  const done: string[] = []
  const skipped: string[] = []

  for (const [path, c] of copiesFrom(tail)) {
    const current = await d.fs.read(path).catch(() => null)

    if (current !== c.after) {
      skipped.push(`${baseName(path)} (changed since)`)
    } else if (c.before === null) {
      skipped.push(`${baseName(path)} (it was new: delete it yourself if you want)`)
    } else {
      await d.fs.write(path, c.before)
      done.push(baseName(path))
    }
  }
  const report = `Put back: ${done.join(', ') || 'nothing'}.${skipped.length > 0 ? ` Left alone: ${skipped.join(', ')}.` : ''}`
  await update(d, rewind, r => ({ ...r, files: [], report }))
}

const warnBranch = async (d: Dollar) => {
  if (isBranchTold || !(await isOn(d, 'branch'))) {
    return
  }
  isBranchTold = true
  const out = await d.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 4000 }).catch(() => null)
  const branch = out?.exitCode === 0 ? out.stdout.trim() : ''

  if (branch === 'main' || branch === 'master') {
    d.ui.toast(`Heads up: these edits are on the ${branch} branch.`)
  }
}

const advise = async (d: Dollar) => {
  const usage = await d.session.usage().catch(() => null)

  if (usage === null) {
    return
  }

  if (!isAdviceGiven && (usage.context.percent ?? 0) >= 70 && (await isOn(d, 'advisor'))) {
    isAdviceGiven = true
    d.ui.toast('This chat is getting long. /sidekick can prepare a handoff note for a fresh one.')
  }

  for (const limit of usage.rateLimits) {
    if (limit.percentUsed >= 80 && !limitsTold.has(limit.kind) && (await isOn(d, 'limits'))) {
      limitsTold.add(limit.kind)
      d.ui.toast(`Usage limit ${Math.round(limit.percentUsed)}% used (${limit.kind.replace(/_/g, ' ')}).`)
    }
  }
}

const applyPreset = async (d: Dollar, name: string) => {
  const calm = ['scope', 'advisor', 'limits', 'speak', 'sensitive', 'bigfile', 'loose']
  const next = name === 'calm' ? [...new Set([...(await read(d, off)), ...calm])] : name === 'careful' || name === 'everything' ? [...DEFAULT_OFF] : null

  if (next !== null) {
    await update(d, off, () => next)
    await d.store.set('off', next)
  }
}

export const register: Register = on => {
  // This mod's own section in the shared "Mod manager" settings panel.
  on('ui.render', { component: 'Pane', plugin: '*', requestId: 'mod-settings' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, off)
    const query = await read($, panelQuery)
    const hit = (label: string) => query === '' || label.toLowerCase().includes(query)
    const Row = (key: string, label: string, value: string, press: () => unknown) =>
      hit(label) ? (
        <Box justifyContent="space-between" gap="sm">
          <Text>{label}</Text>
          <Button key={key} variant={value === 'On' ? 'primary' : undefined} label={value} onPress={press} />
        </Box>
      ) : null
    const rows = [
      ...FEATURES.map(f => Row(`sk-${f.id}`, f.label, list.includes(f.id) ? 'Off' : 'On', () => toggle($, f.id))),
      Row('sk-open', 'Loose ends, rules and more', 'Open', () => openTab($, 'loose')),
    ].filter(Boolean)

    return (
      <Box flexDirection="column">
        {await next(e)}
        {rows.length > 0 && (
          <Box flexDirection="column" marginTop="md" gap="sm">
            <Text weight="bold">Sidekick</Text>
            {rows}
          </Box>
        )}
      </Box>
    )
  })

  // The panel's search box and preset buttons belong to mod-manager; this mod follows them.
  on('ui.input', { plugin: 'mod-manager', element: 'find-setting' }, async ($, e, next) => {
    const done = await next(e)
    await update($, panelQuery, () => String((e as unknown as { value?: unknown }).value ?? '').toLowerCase().trim())

    return done
  })

  on('ui.press', { plugin: 'mod-manager', element: /^preset-(calm|careful|everything)$/ }, async ($, e, next) => {
    const done = await next(e)
    await applyPreset($, String((e as unknown as { element?: unknown }).element ?? '').replace('preset-', ''))

    return done
  })

  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['sidekick', 'Loose ends, rules, queue, today, project card, servers and rewind'],
      ['queue', 'Line up a next request: /queue <text>. It is put in the box when Claude finishes'],
      ['myrules', 'Your standing rules for Claude'],
      ['loose', "Things Claude left unverified or for later"],
      ['today', "What got done today"],
      ['servers', 'Programs listening on your Mac'],
    ] as const) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    project = keyOf(e.cwd)
    ask = ''
    turnFiles = new Set()
    turnCopies = []
    isBranchTold = false
    isAdviceGiven = false
    limitsTold.clear()
    history.length = 0
    await load($).catch(() => undefined)

    return next(e)
  })

  // Standing rules join Claude's instructions. A chat already under way keeps what it started with.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const active = (await read($, rules).catch(() => [] as Rule[])).filter(r => r.isOn)

    return active.length === 0
      ? composed
      : { ...composed, sections: [...composed.sections, { id: 'sidekick-rules', scope: 'session' as const, text: `The person's standing rules:\n${active.map(r => `- ${r.text}`).join('\n')}` }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta !== true && e.text.trim() !== '') {
      ask = safeAsk(e.text)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnFiles = new Set()
      turnCopies = []
      turnFailed = 0
      isTestRun = false
      isCommandRun = false
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const isEdit = EDITS.has(e.tool)
    const path = isEdit ? String(input.file_path ?? input.notebook_path ?? '') : ''
    let before: string | null = null
    const wantsCopy = path !== '' && (await isOn($, 'rewind'))

    if (path !== '') {
      await warnBranch($)

      if (wantsCopy) {
        before = await $.fs.read(path).catch(() => null)
      }
    }
    const ran = await next(e)
    const isFailed = ran.deny !== undefined || ran.isError === true

    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const command = String(input.command ?? '')

      if (ran.deny === undefined) {
        isCommandRun = isCommandRun || !isFailed
        isTestRun = isTestRun || (!isFailed && isTestCommand(command))
      }

      if (isFailed && e.tool_use_id !== undefined) {
        turnFailed += 1
        keep(failures, e.tool_use_id, String(ran.text ?? ran.deny ?? '').slice(0, 600))
      } else if (!isFailed) {
        const next_ = addCommand(await read($, commands), command)
        await update($, commands, () => next_)
        await $.store.set(`commands:${project}`, next_)
      }
    }

    if (path !== '' && !isFailed) {
      turnFiles.add(path)

      if (wantsCopy && (before === null || before.length <= BIG_CHARS)) {
        const after = await $.fs.read(path).catch(() => null)

        if (after !== null && after.length <= BIG_CHARS && after !== before) {
          turnCopies.push({ path, before, after })
        }
      }

      if (isSensitive(path) && e.tool_use_id !== undefined && (await isOn($, 'sensitive'))) {
        const id = e.tool_use_id
        await update($, marks, list => [...list, id].slice(-100))
      }
      const warning = bigFileWarning(path, typeof input.content === 'string' ? input.content.length : 0)

      if (warning !== null && (await isOn($, 'bigfile'))) {
        $.ui.toast(warning)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || e.reason !== 'answer') {
      return next(e)
    }
    const tail = tailOf(e.answer)
    const lines: string[] = []

    if (await isOn($, 'claims')) {
      lines.push(...unbackedClaims(e.answer, { isTestRun, isCommandRun }))
    }

    if (turnFiles.size >= SCOPE_FILES && (await isOn($, 'scope'))) {
      lines.push(`This turn changed ${turnFiles.size} files.`)
    }

    if (lines.length > 0 && tail !== '') {
      await update($, under, list => [...list, { tail, lines }].slice(-30))
    }
    const ends = (await isOn($, 'loose')) ? looseEnds(e.answer) : []

    if (ends.length > 0) {
      await saveLoose($, addLoose(await read($, loose), ends))
    }

    if (turnCopies.length > 0 && tail !== '') {
      history.push({ tail, copies: turnCopies })

      if (history.length > 20) {
        history.shift()
      }
    }
    const at = await $.clock.now()
    const nextDay = addToDay(await read($, day), dayOf(at), { files: [...turnFiles].map(baseName), failed: turnFailed, ask })
    await update($, day, () => nextDay)
    await $.store.set('day', nextDay)

    const waiting = await read($, queue)
    const upNext = waiting[0]

    if (upNext !== undefined) {
      const box = await $.prompt.read().catch(() => null)

      // put in the box only, and only into an empty one: the person sends it
      if (box !== null && box.text === '') {
        await $.prompt.fill({ text: upNext, mode: 'replace' })
        await update($, queue, list => list.slice(1))
      }
    }
    await advise($)
    const question = closingQuestion(e.answer)

    if (question !== null && e.durationMs >= 60_000 && (await isOn($, 'speak'))) {
      await $.audio.speak(question).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    keep(replyTexts, e.requestId, e.props.text.slice(0, 1500))
    const tail = tailOf(e.props.text)
    const found = tail === '' ? undefined : [...(await read($, under))].reverse().find(u => u.tail === tail)

    if (found === undefined) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        {found.lines.map(l => (
          <Text color="warning">{l}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!EDITS.has(e.props.tool) || !(await read($, marks)).includes(e.props.tool_use_id)) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text color="warning">Sensitive file: worth a look.</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'ContextMenu' }, async ($, e, next) => {
    const row = e.props.row
    const selected = e.props.selection?.text.trim() ?? ''
    const reply = row?.component === 'AssistantMessage' ? (replyTexts.get(row.requestId) ?? '').trim() : ''
    const text = selected !== '' ? selected : reply
    const failure = row?.component === 'ToolUse' ? failures.get(row.requestId) : undefined

    if (text === '' && failure === undefined) {
      return next(e)
    }
    const { Box, Button } = $.ui.resolve(e)
    const tail = reply === '' ? '' : tailOf(reply)
    const canRewind = tail !== '' && history.some(h => h.tail === tail)
    const about = (lead: string) => () => fill($, `${lead}\n${quote(text)}\n`)

    return (
      <Box flexDirection="column">
        {failure !== undefined && <Button key="s-error" label="What does this error mean?" onPress={() => fill($, `What does this error mean, in plain words?\n${quote(failure)}\n`)} />}
        {text !== '' && <Button key="s-prove" label="Prove it" onPress={about('Prove it: for each claim here, run something that shows it is true.')} />}
        {text !== '' && <Button key="s-teach" label="Teach me this" onPress={about('Teach me this, step by step, as if I am new to it:')} />}
        {text !== '' && <Button key="s-quiz" label="Quiz me" onPress={about('Ask me three short questions to check I understand this:')} />}
        {selected !== '' && <Button key="s-rule" label="Make this a rule" onPress={() => addRule($, selected)} />}
        {canRewind && <Button key="s-rewind" label="Put files back to before this…" onPress={() => showRewind($, tail)} />}
        {await next(e)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const active = await read($, tab)
    let body: unknown = null

    if (active === 'loose') {
      const list = await read($, loose)

      body = (
        <Box flexDirection="column">
          {list.length === 0 && <Text dimColor>Nothing left open. Sentences like "not verified" or "for later" collect here.</Text>}
          {list.map((l, i) => (
            <Box flexDirection="column" marginBottom="sm">
              <Text>{l}</Text>
              <Box gap="sm">
                <Button key={`ask-${i}`} label="Ask about it" onPress={() => fill($, `About this loose end, finish or check it:\n> ${l}\n`)} />
                <Button key={`done-${i}`} dimColor label="Done" onPress={async () => saveLoose($, (await read($, loose)).filter(x => x !== l))} />
              </Box>
            </Box>
          ))}
        </Box>
      )
    } else if (active === 'rules') {
      const list = await read($, rules)

      body = (
        <Box flexDirection="column" alignItems="flex-start">
          <Text dimColor>Rules join Claude's instructions from your next new chat. Select text and right-click to add one.</Text>
          {list.map((r, i) => (
            <Box gap="sm">
              <Button key={`rule-${i}`} label={r.isOn ? 'on' : 'off'} onPress={async () => saveRules($, (await read($, rules)).map((x, j) => (j === i ? { ...x, isOn: !x.isOn } : x)))} />
              <Text dimColor={!r.isOn}>{r.text}</Text>
              <Button key={`rm-${i}`} dimColor label="Remove" onPress={async () => saveRules($, (await read($, rules)).filter((_, j) => j !== i))} />
            </Box>
          ))}
          {PRESET_RULES.filter(p => !list.some(r => r.text === p)).map((p, i) => (
            <Button key={`preset-${i}`} label={`Add: ${p}`} onPress={() => addRule($, p)} />
          ))}
        </Box>
      )
    } else if (active === 'queue') {
      const list = await read($, queue)

      body = (
        <Box flexDirection="column">
          <Text dimColor>Add with /queue followed by your request. The first goes into the box when Claude finishes.</Text>
          {list.map((q, i) => (
            <Box gap="sm">
              <Text>{`${i + 1}. ${q}`}</Text>
              <Button key={`drop-${i}`} dimColor label="Remove" onPress={() => update($, queue, l => l.filter((_, j) => j !== i))} />
            </Box>
          ))}
        </Box>
      )
    } else if (active === 'today') {
      const today = await read($, day)
      const opinion = await read($, second)
      const report = dayText(today.date === '' ? emptyDay(dayOf(await $.clock.now())) : today)

      body = (
        <Box flexDirection="column" alignItems="flex-start">
          {report.split('\n').map(l => (
            <Text>{l}</Text>
          ))}
          <Button key="copy-day" label="Put summary in prompt box" onPress={() => fill($, report)} />
          <Button key="handoff" label="Prepare a handoff note" onPress={() => fill($, 'Write a short handoff note for a new chat: what this work is, its current state, how to continue, and what is not verified.')} />
          <Button key="second" label="Second opinion on uncommitted changes (costs extra)" onPress={() => secondOpinion($)} />
          {opinion !== '' && <Text>{opinion}</Text>}
        </Box>
      )
    } else if (active === 'project') {
      const list = await read($, commands)

      body = (
        <Box flexDirection="column" alignItems="flex-start">
          {list.length === 0 && <Text dimColor>Commands that run, test or build this folder are remembered after they work.</Text>}
          {list.map((c, i) => (
            <Button key={`run-${i}`} label={c} onPress={() => fill($, `Run \`${c}\` and tell me the result.`)} />
          ))}
        </Box>
      )
    } else if (active === 'servers') {
      const list = await read($, servers)

      body = (
        <Box flexDirection="column" alignItems="flex-start">
          <Button key="refresh" label="Refresh" onPress={() => refreshServers($)} />
          {list.length === 0 && <Text dimColor>Press Refresh to see what is listening.</Text>}
          {list.map((s, i) => (
            <Box gap="sm">
              <Text mono>{`:${s.port}  ${s.name}`}</Text>
              <Button key={`stop-${i}`} dimColor label="Ask to stop it" onPress={() => fill($, `Stop the program ${s.name} (process ${s.pid}) listening on port ${s.port}, after telling me what it is.`)} />
            </Box>
          ))}
        </Box>
      )
    } else {
      const plan = await read($, rewind)

      body = (
        <Box flexDirection="column" alignItems="flex-start">
          {plan.report !== '' && <Text>{plan.report}</Text>}
          {plan.files.length === 0 && plan.report === '' && <Text dimColor>Right-click a reply that edited files and choose "Put files back to before this".</Text>}
          {plan.files.length > 0 && <Text weight="semibold">These files would go back (from this reply on):</Text>}
          {plan.files.map(f => (
            <Text mono>{baseName(f)}</Text>
          ))}
          {plan.files.length > 0 && <Button key="confirm" label="Put them back" onPress={() => doRewind($)} />}
          {plan.files.length > 0 && <Button key="cancel" dimColor label="Cancel" onPress={() => update($, rewind, () => ({ tail: '', files: [], report: '' }))} />}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding="sm">
        <Box gap="sm" flexWrap="wrap" marginBottom="sm">
          {TABS.map(([id, label]) => (
            <Button key={`tab-${id}`} variant={id === active ? 'primary' : undefined} label={label} onPress={() => update($, tab, () => id)} />
          ))}
        </Box>
        {body as never}
      </Box>
    )
  })

  on('command.run', { command: 'sidekick' }, async $ => {
    await openTab($, 'loose')

    return { text: 'Sidekick opened.' }
  })

  on('command.run', { command: 'queue' }, async ($, e) => {
    const text = e.args.trim()

    if (text === '') {
      await openTab($, 'queue')

      return { text: 'Queue opened. Add with /queue <your request>.' }
    }
    await update($, queue, list => [...list, text.slice(0, 500)].slice(-10))

    return { text: 'Queued. It goes into the box when Claude finishes; you send it.' }
  })

  on('command.run', { command: 'myrules' }, async $ => {
    await openTab($, 'rules')

    return { text: 'Rules opened.' }
  })

  on('command.run', { command: 'loose' }, async $ => {
    await openTab($, 'loose')

    return { text: 'Loose ends opened.' }
  })

  on('command.run', { command: 'today' }, async $ => {
    await openTab($, 'today')

    return { text: 'Today opened.' }
  })

  on('command.run', { command: 'servers' }, async $ => {
    await refreshServers($)
    await openTab($, 'servers')

    return { text: 'Servers opened.' }
  })
}
