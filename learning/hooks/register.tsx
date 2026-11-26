import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { ArchEntry, Card, Flags, LogEntry, ReadItem, Term, WeekCounts } from '../types'
import {
  CAPS,
  COMMANDS,
  DEFAULT_FLAGS,
  FILLER_COMMANDS,
  TABS,
  addArch,
  archTree,
  barOf,
  boxCounts,
  buildPrompt,
  clip,
  dayKey,
  dueCards,
  formatDue,
  helpText,
  makeCard,
  nextDueAt,
  nextSchedule,
  normalizePath,
  parseCard,
  parseOnOff,
  parseRead,
  parseTerm,
  putProjectTerm,
  readingByTopic,
  removeTerm,
  searchTerms,
  shouldNudge,
  sortedTerms,
  standingSections,
  tabFromWord,
  timeOf,
  topCounts,
  touchSkills,
  upsertTerm,
  weekKey,
  weekTotal,
} from './logic'
import type { FillerKind, Tab } from './logic'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'learning-main'

const glossary = atom({ plugin: 'learning', key: 'glossary' } as const, [], { shape: 'glossary-1' })
const pglossary = atom({ plugin: 'learning', key: 'pglossary' } as const, {}, { shape: 'pglossary-1' })
const cards = atom({ plugin: 'learning', key: 'cards' } as const, [], { shape: 'cards-1' })
const log = atom({ plugin: 'learning', key: 'log' } as const, [], { shape: 'log-1' })
const reading = atom({ plugin: 'learning', key: 'reading' } as const, [], { shape: 'reading-1' })
const arch = atom({ plugin: 'learning', key: 'arch' } as const, [], { shape: 'arch-1' })
const skills = atom({ plugin: 'learning', key: 'skills' } as const, {}, { shape: 'skills-1' })
const flags = atom({ plugin: 'learning', key: 'flags' } as const, DEFAULT_FLAGS, { shape: 'flags-1' })
const nudgeDay = atom({ plugin: 'learning', key: 'nudgeDay' } as const, '')
const tab = atom({ plugin: 'learning', key: 'tab' } as const, 'Glossary')
const scope = atom({ plugin: 'learning', key: 'scope' } as const, 'global')
const isReviewing = atom({ plugin: 'learning', key: 'isReviewing' } as const, false)
const isAnswerShown = atom({ plugin: 'learning', key: 'isAnswerShown' } as const, false)

const KEY = (name: string) => `learning-${name}`

const asList = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
const asRecord = <T,>(value: unknown): Record<string, T> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, T>) : {}

// ---------- persistence ----------

const load = async (d: Dollar) => {
  const get = (name: string) => d.store.get(KEY(name)).catch(() => undefined)
  const [g, pg, c, l, r, a, s, f, n] = await Promise.all(
    ['glossary', 'pglossary', 'cards', 'log', 'reading', 'arch', 'skills', 'flags', 'nudgeDay'].map(get),
  )
  await update(d, glossary, () => asList<Term>(g))
  await update(d, pglossary, () => asRecord<Term[]>(pg))
  await update(d, cards, () => asList<Card>(c))
  await update(d, log, () => asList<LogEntry>(l))
  await update(d, reading, () => asList<ReadItem>(r))
  await update(d, arch, () => asList<ArchEntry>(a))
  await update(d, skills, () => asRecord<WeekCounts>(s))
  await update(d, flags, () => ({ ...DEFAULT_FLAGS, ...asRecord<boolean>(f) }) as Flags)
  await update(d, nudgeDay, () => (typeof n === 'string' ? n : ''))
}

const saveGlossary = async (d: Dollar) => d.store.set(KEY('glossary'), await read(d, glossary))
const savePglossary = async (d: Dollar) => d.store.set(KEY('pglossary'), await read(d, pglossary))
const saveCards = async (d: Dollar) => d.store.set(KEY('cards'), await read(d, cards))
const saveLog = async (d: Dollar) => d.store.set(KEY('log'), await read(d, log))
const saveReading = async (d: Dollar) => d.store.set(KEY('reading'), await read(d, reading))
const saveArch = async (d: Dollar) => d.store.set(KEY('arch'), await read(d, arch))
const saveSkills = async (d: Dollar) => d.store.set(KEY('skills'), await read(d, skills))
const saveFlags = async (d: Dollar) => d.store.set(KEY('flags'), await read(d, flags))

// ---------- small shared actions ----------

const openPane = async (d: Dollar, which?: Tab) => {
  if (which !== undefined) {
    await update(d, tab, () => which)
  }
  const placed = await d.ui.open({ id: PANE, title: 'Learning' })

  return placed.isPlaced
}

const fillPrompt = async (d: Dollar, kind: FillerKind, args: string) => {
  const text = buildPrompt(kind, args)
  const filled = await d.prompt.fill({ text, mode: 'replace' })

  return { text: filled.isFilled ? 'Prompt is in the box. Edit it if you like, then press Enter to send.' : `Could not fill the prompt box. The prompt:\n${text}` }
}

const listTerms = (list: Term[], query: string) => {
  const found = sortedTerms(searchTerms(list, query))

  if (found.length === 0) {
    return query === '' ? 'No terms yet. Add one with: <term> = <definition>' : `No terms match "${query}".`
  }

  return found.map(t => `${t.term}: ${t.def}`).join('\n')
}

// ---------- commands ----------

const runTerm = async ($: Dollar, args: string, isProject: boolean) => {
  const name = isProject ? '/lnpterm' : '/lnterm'
  const text = args.trim()
  const cwd = isProject ? await $.session.cwd() : ''
  const current = isProject ? asList<Term>((await read($, pglossary))[cwd]) : await read($, glossary)

  const parsed = parseTerm(text)

  if (parsed !== null) {
    const now = await $.clock.now()

    if (isProject) {
      await update($, pglossary, all => putProjectTerm(all, cwd, parsed.term, parsed.def, now))
      await savePglossary($)
    } else {
      await update($, glossary, list => upsertTerm(list, parsed.term, parsed.def, now, CAPS.terms))
      await saveGlossary($)
    }
    await update($, scope, () => (isProject ? 'project' : 'global'))

    return { text: `Saved "${parsed.term}"${isProject ? ' for this folder' : ''}.` }
  }
  const [verb = '', ...rest] = text.split(/\s+/)
  const tail = rest.join(' ')

  if (verb === 'rm' && tail !== '') {
    const next = removeTerm(current, tail)

    if (next.length === current.length) {
      return { text: `No term "${tail}".` }
    }

    if (isProject) {
      await update($, pglossary, all => ({ ...all, [cwd]: next }))
      await savePglossary($)
    } else {
      await update($, glossary, () => next)
      await saveGlossary($)
    }

    return { text: `Removed "${tail}".` }
  }

  if (verb === 'search') {
    return { text: listTerms(current, tail) }
  }

  if (text === '' || verb === 'list') {
    return { text: listTerms(current, '') }
  }

  return { text: `Usage: ${name} <term> = <definition>, ${name} list, ${name} search <q>, ${name} rm <term>` }
}

const runCard = async ($: Dollar, args: string) => {
  const text = args.trim()
  const parsed = parseCard(text)
  const now = await $.clock.now()

  if (parsed !== null) {
    const list = await read($, cards)
    await update($, cards, l => [...l, makeCard(`c${now}-${list.length}`, parsed.q, parsed.a, now)].slice(-CAPS.cards))
    await saveCards($)

    return { text: `Card added (${Math.min(list.length + 1, CAPS.cards)} total). /lnreview to practise.` }
  }
  const [verb = '', ...rest] = text.split(/\s+/)
  const list = await read($, cards)

  if (verb === 'gen') {
    return fillPrompt($, 'cardgen', rest.join(' '))
  }

  if (verb === 'rm') {
    const n = Number(rest[0])
    const card = list[n - 1]

    if (!Number.isInteger(n) || card === undefined) {
      return { text: 'Usage: /lncard rm <number from /lncard list>' }
    }
    await update($, cards, l => l.filter(c => c.id !== card.id))
    await saveCards($)

    return { text: `Removed card ${n}.` }
  }

  if (text === '' || verb === 'list') {
    if (list.length === 0) {
      return { text: 'No cards yet. /lncard <question> | <answer>' }
    }
    const due = dueCards(list, now).length

    return {
      text: [
        `${list.length} cards, ${due} due.`,
        ...list.map((c, i) => `${i + 1}. [box ${c.box}] ${clip(c.q, 70)} (${formatDue(c.due, now)})`),
      ].join('\n'),
    }
  }

  return { text: 'Usage: /lncard <question> | <answer>, /lncard list, /lncard rm <n>, /lncard gen [topic]' }
}

const runReview = async ($: Dollar) => {
  const now = await $.clock.now()
  const list = await read($, cards)
  const due = dueCards(list, now)

  if (list.length === 0) {
    return { text: 'No cards yet. Add one with /lncard <question> | <answer>.' }
  }

  if (due.length === 0) {
    const next = nextDueAt(list, now)

    return { text: `Nothing due. ${next === null ? '' : `Next card is due ${formatDue(next, now)}.`}` }
  }
  await update($, isReviewing, () => true)
  await update($, isAnswerShown, () => false)
  const isPlaced = await openPane($, 'Cards')
  const first = due[0] as Card

  return {
    text: isPlaced
      ? `${due.length} card(s) due. Review is open in the Learning pane.`
      : `${due.length} card(s) due. The pane is not available here, so: ${first.q}\n(answer: ${first.a})`,
  }
}

/** Grade the first due card: Knew it moves it up a box, Again sends it back. */
const grade = async ($: Dollar, knew: boolean) => {
  const now = await $.clock.now()
  const first = dueCards(await read($, cards), now)[0]

  if (first === undefined) {
    return
  }
  await update($, cards, list => list.map(c => (c.id === first.id ? nextSchedule(c, knew, now) : c)))
  await update($, isAnswerShown, () => false)
  await saveCards($)
}

const runRead = async ($: Dollar, args: string) => {
  const text = args.trim()
  const now = await $.clock.now()
  const list = await read($, reading)
  const [verb = '', ...rest] = text.split(/\s+/)

  if (text === '' || verb === 'list') {
    if (list.length === 0) {
      return { text: 'Reading list is empty. /lnread <title> <url> [#topic]' }
    }
    const index = new Map(list.map((r, i) => [r.id, i + 1]))
    const wanted = rest.join(' ').replace(/^#/, '').toLowerCase()
    const groups = readingByTopic(list).filter(([topic]) => wanted === '' || topic === wanted)

    return {
      text: groups
        .map(([topic, items]) =>
          [`#${topic}`, ...items.map(r => `${index.get(r.id)}. ${r.isDone ? '[x]' : '[ ]'} ${r.title} ${r.url}`)].join('\n'),
        )
        .join('\n'),
    }
  }

  if (verb === 'done' || verb === 'rm') {
    const n = Number(rest[0])
    const item = list[n - 1]

    if (!Number.isInteger(n) || item === undefined) {
      return { text: `Usage: /lnread ${verb} <number from /lnread list>` }
    }

    if (verb === 'rm') {
      await update($, reading, l => l.filter(r => r.id !== item.id))
    } else {
      await update($, reading, l => l.map(r => (r.id === item.id ? { ...r, isDone: !r.isDone } : r)))
    }
    await saveReading($)

    return { text: verb === 'rm' ? `Removed "${item.title}".` : `Marked "${item.title}" ${item.isDone ? 'unread' : 'read'}.` }
  }
  const parsed = parseRead(text)

  if (parsed === null) {
    return { text: 'Usage: /lnread <title> <url> [#topic] (the url must start with http:// or https://)' }
  }
  const item: ReadItem = { id: `r${now}-${list.length}`, ...parsed, isDone: false, at: now }
  await update($, reading, l => [...l, item].slice(-CAPS.reading))
  await saveReading($)

  return { text: `Added to #${parsed.topic}: ${parsed.title}` }
}

const runLearned = async ($: Dollar, args: string) => {
  const text = args.trim()
  const now = await $.clock.now()

  if (text === '') {
    const list = await read($, log)

    return {
      text:
        list.length === 0
          ? 'Nothing logged yet. /lnlearned <what you learned>'
          : list
              .slice(-10)
              .reverse()
              .map(l => `${dayKey(l.at)} ${timeOf(l.at)}  ${l.text}`)
              .join('\n'),
    }
  }
  await update($, log, list => [...list, { at: now, text: clip(text, 500) }].slice(-CAPS.log))
  await saveLog($)

  return { text: `Logged for ${dayKey(now)}.` }
}

const runArch = async ($: Dollar, args: string) => {
  const text = args.trim()
  const [verb = '', first = '', ...rest] = text.split(/\s+/)

  if (verb === 'add') {
    if (normalizePath(first) === '') {
      return { text: 'Usage: /lnarch add <path> <description>' }
    }
    await update($, arch, list => addArch(list, first, rest.join(' '), CAPS.arch))
    await saveArch($)

    return { text: `Mapped ${normalizePath(first)}.` }
  }

  if (verb === 'rm') {
    const path = normalizePath(first)
    await update($, arch, list => list.filter(a => a.path !== path))
    await saveArch($)

    return { text: `Removed ${path} from the map.` }
  }

  if (verb === 'suggest') {
    return fillPrompt($, 'archsuggest', [first, ...rest].join(' '))
  }
  await openPane($, 'Arch')
  const lines = archTree(await read($, arch))

  return { text: lines.length === 0 ? 'The map is empty. /lnarch add <path> <description>' : lines.join('\n') }
}

const runFlag = async ($: Dollar, key: 'mentor' | 'duck' | 'beginner' | 'eli5' | 'nudge', args: string, label: string) => {
  const want = parseOnOff(args)
  const current = (await read($, flags))[key]

  if (want === null) {
    return { text: `${label} is ${current ? 'on' : 'off'}. Use on or off to change it.` }
  }
  await update($, flags, f => ({ ...f, [key]: want }))
  await saveFlags($)

  return { text: `${label} is now ${want ? 'on' : 'off'}.` }
}

const skillsSummary = (weeks: Record<string, WeekCounts>, now: number) => {
  const week = weeks[weekKey(now)]

  if (week === undefined) {
    return 'No activity recorded this week yet.'
  }
  const fmt = (rec: Record<string, number>) =>
    topCounts(rec, 6)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')

  return `This week (from ${weekKey(now)}): ${weekTotal(week)} tool calls\nTools: ${fmt(week.tools)}\nFiles: ${fmt(week.ext) || 'none yet'}`
}

const record = async ($: Dollar, tool: string, path: string | undefined) => {
  const now = await $.clock.now()
  await update($, skills, weeks => touchSkills(weeks, tool, path, now))
  await saveSkills($)
}

const maybeNudge = async ($: Dollar) => {
  const now = await $.clock.now()
  const today = dayKey(now)
  const due = dueCards(await read($, cards), now).length

  if (!shouldNudge(due, (await read($, flags)).nudge, await read($, nudgeDay), today)) {
    return
  }
  await update($, nudgeDay, () => today)
  await $.store.set(KEY('nudgeDay'), today)
  $.ui.toast(`${due} flashcard${due === 1 ? '' : 's'} due. Type /lnreview to practise.`, { timeoutMs: 8000 })
}

const resetAll = async ($: Dollar) => {
  await update($, glossary, () => [])
  await update($, pglossary, () => ({}))
  await update($, cards, () => [])
  await update($, log, () => [])
  await update($, reading, () => [])
  await update($, arch, () => [])
  await update($, skills, () => ({}))
  await update($, nudgeDay, () => '')
  await update($, isReviewing, () => false)
  await update($, isAnswerShown, () => false)

  for (const name of ['glossary', 'pglossary', 'cards', 'log', 'reading', 'arch', 'skills', 'nudgeDay']) {
    await $.store.delete(KEY(name))
  }
}

// ---------- the module ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await load($).catch(() => undefined)
    await maybeNudge($).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await maybeNudge($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'ln' }, () => ({ text: helpText() }))

  on('command.run', { command: 'lnpane' }, async ($, e) => {
    const word = e.args.trim()
    const which = word === '' ? undefined : tabFromWord(word)

    if (word !== '' && which === null) {
      return { text: `Unknown tab "${word}". Tabs: ${TABS.join(', ')}.` }
    }
    const isPlaced = await openPane($, which ?? undefined)

    return { text: isPlaced ? 'Learning pane opened.' : 'No pane is available on this surface.' }
  })

  for (const [name, kind] of Object.entries(FILLER_COMMANDS)) {
    on('command.run', { command: name }, ($, e) => fillPrompt($, kind, e.args))
  }

  on('command.run', { command: 'lneli5' }, async ($, e) => {
    if (parseOnOff(e.args) !== null) {
      return runFlag($, 'eli5', e.args, 'ELI5 mode')
    }

    return fillPrompt($, 'eli5', '')
  })

  on('command.run', { command: 'lnterm' }, ($, e) => runTerm($, e.args, false))
  on('command.run', { command: 'lnpterm' }, ($, e) => runTerm($, e.args, true))
  on('command.run', { command: 'lncard' }, ($, e) => runCard($, e.args))
  on('command.run', { command: 'lnreview' }, $ => runReview($))
  on('command.run', { command: 'lnread' }, ($, e) => runRead($, e.args))
  on('command.run', { command: 'lnlearned' }, ($, e) => runLearned($, e.args))
  on('command.run', { command: 'lnarch' }, ($, e) => runArch($, e.args))
  on('command.run', { command: 'lnmentor' }, ($, e) => runFlag($, 'mentor', e.args, 'Mentor mode'))
  on('command.run', { command: 'lnduck' }, ($, e) => runFlag($, 'duck', e.args, 'Rubber-duck mode'))
  on('command.run', { command: 'lnbeginner' }, ($, e) => runFlag($, 'beginner', e.args, 'Beginner guardrails'))
  on('command.run', { command: 'lnnudge' }, ($, e) => runFlag($, 'nudge', e.args, 'The daily flashcard nudge'))

  on('command.run', { command: 'lnskills' }, async $ => {
    const now = await $.clock.now()
    await openPane($, 'Skills')

    return { text: skillsSummary(await read($, skills), now) }
  })

  on('command.run', { command: 'lnreset' }, async ($, e) => {
    if (e.args.trim().toLowerCase() !== 'yes') {
      return {
        text: 'This clears your glossaries, cards, log, reading list, architecture map and skill counts (settings stay). Run /lnreset yes to confirm.',
      }
    }
    await resetAll($)

    return { text: 'Learning data cleared.' }
  })

  // Standing instructions: only added while a switch is on (all default off).
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const extra = standingSections(await read($, flags))

    return extra.length === 0 ? composed : { ...composed, sections: [...composed.sections, ...extra] }
  })

  // Skill tracker: counts only, never the contents of a call.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const path =
      typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined
    await record($, e.tool, path).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const stored = await read($, tab)
    const current: Tab = (TABS as readonly string[]).includes(stored) ? (stored as Tab) : 'Glossary'
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 8)

    const Heading = (title: string, right?: string) => (
      <Box justifyContent="space-between" marginBottom="sm">
        <Text size="heading" weight="bold">
          {title}
        </Text>
        {right !== undefined && (
          <Text dimColor mono tabular>
            {right}
          </Text>
        )}
      </Box>
    )

    const Section = (label: string) => (
      <Box marginTop="md">
        <Text size="caption" weight="semibold" dimColor>
          {label.toUpperCase()}
        </Text>
      </Box>
    )

    const body = async () => {
      if (current === 'Glossary') {
        const isProject = (await read($, scope)) === 'project'
        const cwd = await $.session.cwd()
        const list = sortedTerms(isProject ? asList<Term>((await read($, pglossary))[cwd]) : await read($, glossary))

        return (
          <Box flexDirection="column">
            {Heading('Glossary', String(list.length))}
            <Box gap="sm" marginBottom="sm">
              <Button key="scope-global" label="All projects" variant={isProject ? 'secondary' : 'primary'} onPress={() => update($, scope, () => 'global')} />
              <Button key="scope-project" label="This folder" variant={isProject ? 'primary' : 'secondary'} onPress={() => update($, scope, () => 'project')} />
            </Box>
            {list.length === 0 && (
              <Text dimColor>{isProject ? 'No terms for this folder. /lnpterm <term> = <definition>' : 'No terms yet. /lnterm <term> = <definition>'}</Text>
            )}
            {list.slice(0, room).map(t => (
              <Box gap="sm">
                <Text weight="semibold">{t.term}</Text>
                <Text dimColor>{t.def}</Text>
              </Box>
            ))}
            {list.length > room && <Text dimColor>+{list.length - room} more. /lnterm search to filter.</Text>}
          </Box>
        )
      }

      if (current === 'Cards') {
        const list = await read($, cards)
        const due = dueCards(list, now)
        const reviewing = await read($, isReviewing)

        if (reviewing) {
          const card = due[0]

          if (card === undefined) {
            const next = nextDueAt(list, now)

            return (
              <Box flexDirection="column">
                {Heading('Review')}
                <Text color="success">All caught up.</Text>
                {next !== null && <Text dimColor>Next card is due {formatDue(next, now)}.</Text>}
                <Box marginTop="md">
                  <Button key="review-close" label="Back to cards" onPress={() => update($, isReviewing, () => false)} />
                </Box>
              </Box>
            )
          }
          const shown = await read($, isAnswerShown)

          return (
            <Box flexDirection="column">
              {Heading('Review', `${due.length} due`)}
              <Text dimColor size="caption">
                QUESTION
              </Text>
              <Text size="heading">{card.q}</Text>
              {shown && (
                <Box flexDirection="column" marginTop="sm">
                  <Text dimColor size="caption">
                    ANSWER
                  </Text>
                  <Text color="suggestion">{card.a}</Text>
                </Box>
              )}
              <Box gap="sm" marginTop="md">
                {!shown && <Button key="review-show" label="Show answer" hotkey="s" variant="primary" onPress={() => update($, isAnswerShown, () => true)} />}
                {shown && <Button key="review-knew" label="Knew it" hotkey="k" variant="primary" onPress={() => grade($, true)} />}
                {shown && <Button key="review-again" label="Again" hotkey="a" onPress={() => grade($, false)} />}
                <Button key="review-stop" label="Stop" dimColor onPress={() => update($, isReviewing, () => false)} />
              </Box>
            </Box>
          )
        }
        const counts = boxCounts(list)
        const max = Math.max(1, ...counts)

        return (
          <Box flexDirection="column">
            {Heading('Cards', `${list.length} total · ${due.length} due`)}
            {list.length === 0 && <Text dimColor>No cards yet. /lncard {'<question> | <answer>'}, or /lncard gen to ask Claude for some.</Text>}
            {due.length > 0 && (
              <Box marginBottom="sm">
                <Button
                  key="review-start"
                  label={`Review ${due.length} due`}
                  variant="primary"
                  onPress={async () => {
                    await update($, isAnswerShown, () => false)
                    await update($, isReviewing, () => true)
                  }}
                />
              </Box>
            )}
            {list.length > 0 && Section('Boxes')}
            {list.length > 0 &&
              counts.map((n, i) => (
                <Box gap="sm">
                  <Text dimColor mono>
                    box {i}
                  </Text>
                  <Text mono color="suggestion">
                    {barOf(n, max, 12)}
                  </Text>
                  <Text tabular>{n}</Text>
                </Box>
              ))}
            {list.length > 0 && Section('Cards')}
            {list.slice(-room).map(c => (
              <Box gap="sm">
                <Text>{clip(c.q, 60)}</Text>
                <Text dimColor>{formatDue(c.due, now)}</Text>
              </Box>
            ))}
          </Box>
        )
      }

      if (current === 'Log') {
        const list = [...(await read($, log))].reverse().slice(0, room)
        let lastDay = ''

        return (
          <Box flexDirection="column">
            {Heading('Learning log', String((await read($, log)).length))}
            {list.length === 0 && <Text dimColor>Nothing logged yet. /lnlearned {'<what you learned>'}</Text>}
            {list.map(l => {
              const day = dayKey(l.at)
              const header = day !== lastDay
              lastDay = day

              return (
                <Box flexDirection="column">
                  {header && Section(day)}
                  <Box gap="sm">
                    <Text dimColor mono>
                      {timeOf(l.at)}
                    </Text>
                    <Text>{l.text}</Text>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )
      }

      if (current === 'Reading') {
        const list = await read($, reading)
        const index = new Map(list.map((r, i) => [r.id, i + 1]))
        const open = list.filter(r => !r.isDone).length

        return (
          <Box flexDirection="column">
            {Heading('Reading list', `${open} to read`)}
            {list.length === 0 && <Text dimColor>Empty. /lnread {'<title> <url> [#topic]'}</Text>}
            {readingByTopic(list).map(([topic, items]) => (
              <Box flexDirection="column">
                {Section(topic)}
                {items.map(r => (
                  <Box gap="sm">
                    <Text dimColor tabular>
                      {index.get(r.id)}.
                    </Text>
                    <Text dimColor={r.isDone}>
                      {r.isDone ? '✓ ' : ''}
                      {r.title}
                    </Text>
                    <Text dimColor>{r.url}</Text>
                    <Button
                      key={`read-${r.id}`}
                      label={r.isDone ? 'Unread' : 'Done'}
                      dimColor
                      onPress={async () => {
                        await update($, reading, l => l.map(x => (x.id === r.id ? { ...x, isDone: !x.isDone } : x)))
                        await saveReading($)
                      }}
                    />
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        )
      }

      if (current === 'Arch') {
        const lines = archTree(await read($, arch))

        return (
          <Box flexDirection="column">
            {Heading('Architecture map', String((await read($, arch)).length))}
            {lines.length === 0 && (
              <Text dimColor>Empty. /lnarch add {'<path> <description>'}, or /lnarch suggest to ask Claude for lines to run.</Text>
            )}
            {lines.slice(0, room * 2).map(l => (
              <Text mono>{l}</Text>
            ))}
          </Box>
        )
      }

      const weeks = await read($, skills)
      const week = weeks[weekKey(now)]
      const exts = topCounts(week?.ext ?? {}, 6)
      const tools = topCounts(week?.tools ?? {}, 6)
      const recent = Object.keys(weeks).sort().slice(-6)
      const maxWeek = Math.max(1, ...recent.map(k => weekTotal(weeks[k])))

      const Bars = (rows: [string, number][]) => {
        const max = Math.max(1, ...rows.map(r => r[1]))

        return rows.map(([name, n]) => (
          <Box gap="sm">
            <Text dimColor mono>
              {name.slice(0, 12).padEnd(12)}
            </Text>
            <Text mono color="suggestion">
              {barOf(n, max, 14)}
            </Text>
            <Text tabular>{n}</Text>
          </Box>
        ))
      }

      return (
        <Box flexDirection="column">
          {Heading('Skills', `week of ${weekKey(now)}`)}
          {week === undefined && <Text dimColor>Nothing recorded this week yet. Counts build as Claude uses tools.</Text>}
          {exts.length > 0 && Section('File types touched')}
          {Bars(exts)}
          {tools.length > 0 && Section('Tools used')}
          {Bars(tools)}
          {recent.length > 1 && Section('Recent weeks')}
          {recent.length > 1 &&
            recent.map(k => (
              <Box gap="sm">
                <Text dimColor mono>
                  {k}
                </Text>
                <Text mono color="suggestion">
                  {barOf(weekTotal(weeks[k]), maxWeek, 14)}
                </Text>
                <Text tabular>{weekTotal(weeks[k])}</Text>
              </Box>
            ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding="sm">
        <Box gap="sm" marginBottom="md">
          {TABS.map(t => (
            <Button key={`tab-${t}`} label={t} variant={t === current ? 'primary' : 'secondary'} onPress={() => update($, tab, () => t)} />
          ))}
        </Box>
        {await body()}
      </Box>
    )
  })
}
