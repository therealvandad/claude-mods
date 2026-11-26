import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import {
  COMMANDS,
  CONFETTI_MS,
  CONFETTI_STEP,
  CONFETTI_STILL,
  HABITS,
  MAX_PROJECTS,
  MAX_SHIPS,
  TABS,
  XP_VALUES,
  addBacklog,
  addGoal,
  addItem,
  addLive,
  backlogLines,
  backlogOpen,
  bestLines,
  canFreeze,
  canToast,
  cleanBacklog,
  cleanBests,
  cleanDays,
  cleanGoals,
  cleanHabits,
  cleanJournal,
  cleanLearn,
  cleanLive,
  cleanMeta,
  cleanMetrics,
  cleanProjects,
  cleanShips,
  cleanSkills,
  clip,
  completeGoal,
  confettiView,
  dailyLines,
  dayKey,
  emptyBests,
  emptyDay,
  emptyGoals,
  emptySkills,
  fmtDur,
  focusLines,
  glyphsOf,
  habitLines,
  helpLines,
  isDayKey,
  isObj,
  isTestCommand,
  journalLines,
  ladderLines,
  leafStats,
  learnLines,
  levelOf,
  levelToast,
  metricsLines,
  momentumLines,
  noteSkill,
  parseShips,
  parseTestDuration,
  projectLines,
  projectListLines,
  pruneDays,
  pruneGoals,
  recordMetrics,
  removeGoal,
  removeItem,
  reopenGoal,
  setHabit,
  setItemDone,
  setJournal,
  shiftDay,
  shipLines,
  splitPrompt,
  startGoal,
  stopGoal,
  str,
  streakLines,
  tabOf,
  treeLines,
  updateBestTest,
  weekRingLines,
  xpLines,
  xpTotal,
} from './logic'
import type { Tab } from './logic'
import { blocksFor } from './view'
import type { Cache } from './view'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'progress-main'

// Reduced motion (the `motion` mod) and the shared look (the `settings` mod): read only.
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
const calmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)

// What the pane draws from. Scalars only: a hot reload keeps them.
const tabA = atom({ plugin: 'progress', key: 'tab' } as const, 'goals')
const nowA = atom({ plugin: 'progress', key: 'now' } as const, 0)
const confettiAtA = atom({ plugin: 'progress', key: 'confettiAt' } as const, 0)
const revA = atom({ plugin: 'progress', key: 'rev' } as const, 0)

const KEYS = {
  goals: 'pg-goals',
  days: 'pg-days',
  meta: 'pg-meta',
  skills: 'pg-skills',
  proj: 'pg-proj',
  learn: 'pg-learn',
  habits: 'pg-habits',
  bests: 'pg-bests',
  journal: 'pg-journal',
  backlog: 'pg-backlog',
  live: 'pg-live',
  ships: 'pg-ships',
  metrics: 'pg-metrics',
} as const
type Key = keyof typeof KEYS

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])
const SAVE_GAP_MS = 5000

// Module state: lost at a hot reload, rebuilt lazily from $.store.
let cache: Cache | undefined
let loading: Promise<Cache> | undefined
let lastSave = -Infinity
let ticker: Timer | undefined
const dirty = new Set<Key>()

// ----------------------------------------------------------------- storage

const emptyCache = (today: string): Cache => ({
  goals: emptyGoals(),
  days: {},
  meta: cleanMeta({}, today),
  skills: emptySkills(),
  proj: { projects: [], current: '' },
  learn: cleanLearn({}),
  habits: {},
  bests: emptyBests(),
  journal: [],
  backlog: { items: [], nextId: 1 },
  live: { events: [], hours: {} },
  ships: [],
  metrics: { passed: [], failed: [], coverage: [] },
})

const readData = (d: Dollar): Promise<Cache> => {
  if (cache !== undefined) {
    return Promise.resolve(cache)
  }
  loading ??= (async () => {
    const now = await d.clock.now()
    const today = dayKey(now)
    const raw = await Promise.all((Object.keys(KEYS) as Key[]).map(k => d.store.get(KEYS[k])))
    const at = (k: Key) => raw[(Object.keys(KEYS) as Key[]).indexOf(k)]
    const loaded: Cache = {
      goals: cleanGoals(at('goals')),
      days: cleanDays(at('days')),
      meta: cleanMeta(at('meta'), today),
      skills: cleanSkills(at('skills')),
      proj: cleanProjects(at('proj')),
      learn: cleanLearn(at('learn')),
      habits: cleanHabits(at('habits'), today),
      bests: cleanBests(at('bests')),
      journal: cleanJournal(at('journal')),
      backlog: cleanBacklog(at('backlog')),
      live: cleanLive(at('live'), now),
      ships: cleanShips(at('ships')),
      metrics: cleanMetrics(at('metrics')),
    }
    cache = loaded

    return loaded
  })().finally(() => {
    loading = undefined
  })

  return loading
}

const mark = (...keys: Key[]) => {
  for (const k of keys) {
    dirty.add(k)
  }
}

const flush = async (d: Dollar, now: number, force = false) => {
  if (dirty.size === 0 || (!force && now - lastSave < SAVE_GAP_MS)) {
    return
  }
  const c = await readData(d)
  const keys = [...dirty]
  dirty.clear()
  lastSave = now

  for (const k of keys) {
    await d.store.set(KEYS[k], c[k])
  }
}

const bump = (d: Dollar) => update(d, revA, n => n + 1)

const today0 = async (d: Dollar) => dayKey(await d.clock.now())

type Look = { accent: string; density: string; icons: string; isCalm: boolean; isMotion: boolean }

const lookOf = async (d: Dollar): Promise<Look> => ({
  accent: await read(d, accentA),
  density: await read(d, densityA),
  icons: await read(d, iconsA),
  isCalm: await read(d, calmA),
  isMotion: await read(d, motionIsOn),
})

const dayOf = (c: Cache, today: string) => (c.days[today] ??= emptyDay())

// ---------------------------------------------------------------- recording

const hasPane = async (d: Dollar) => {
  try {
    return (await d.ui.panes()).some(p => p.id === PANE)
  } catch {
    return false
  }
}

const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
}

// 108: one ticker for the burst, only with the pane open and neither calm nor reduced motion.
const startConfetti = async (d: Dollar) => {
  const look = await lookOf(d)
  const at = await d.clock.now()
  await update(d, confettiAtA, () => at)

  if (!look.isMotion || look.isCalm || !(await hasPane(d))) {
    return
  }
  stopTicker()
  ticker = d.clock.every(CONFETTI_STEP, () => {
    void d.clock.now().then(async t => {
      await update(d, nowA, () => t)

      if (t - at >= CONFETTI_MS + CONFETTI_STEP) {
        stopTicker()
      }
    })
  })
}

const markHabit = (c: Cache, today: string, index: number) => {
  if (c.habits[today] === undefined || (c.habits[today]! & (1 << index)) === 0) {
    c.habits = setHabit(c.habits, today, index, true)
    mark('habits')
  }
}

const levelCheck = async (d: Dollar, c: Cache, now: number) => {
  const lvl = levelOf(c.meta.totals)

  if (lvl <= c.meta.level) {
    return
  }
  c.meta.level = lvl
  mark('meta')

  if (canToast(now, c.meta.lastToastAt) && !(await read(d, calmA))) {
    c.meta.lastToastAt = now
    d.ui.toast(levelToast(lvl), { timeoutMs: 6000 })
  }
}

const recordNote = async (d: Dollar) => {
  const c = await readData(d)
  const now = await d.clock.now()
  const today = dayKey(now)
  dayOf(c, today).notes++
  markHabit(c, today, 0)
  mark('days')
  await flush(d, now)
  await bump(d)
}

const outputOf = (ran: unknown): string => {
  const r = isObj(ran) ? ran : {}

  if (typeof r.text === 'string') {
    return r.text.slice(-60_000)
  }
  const res = r.result

  if (typeof res === 'string') {
    return res.slice(-60_000)
  }

  return isObj(res)
    ? [res.stdout, res.stderr, res.output].filter((x): x is string => typeof x === 'string').join('\n').slice(-60_000)
    : ''
}

const noteDone = async (d: Dollar, tool: string, input: Record<string, unknown>, outcome: 'ok' | 'error' | 'denied', output: string, startedAt: number) => {
  try {
    if (outcome === 'denied') {
      return
    }
    const c = await readData(d)
    const now = await d.clock.now()
    const today = dayKey(now)
    const rec = dayOf(c, today)
    const command = tool === 'Bash' ? str(input.command) : ''
    const path = FILE_TOOLS.has(tool) ? str(input.file_path ?? input.notebook_path) : ''
    rec.tools++
    c.meta.totals.tools++
    c.skills = noteSkill(c.skills, tool, command)
    c.live = addLive(c.live, now, path)
    mark('days', 'meta', 'skills', 'live')

    if (command !== '') {
      const isTest = isTestCommand(command)

      if (isTest) {
        rec.tests++
        markHabit(c, today, 1)

        if (outcome === 'ok') {
          const parsed = parseTestDuration(output)
          const ms = parsed ?? Math.max(0, now - startedAt)
          const best = updateBestTest(c.bests, ms, parsed === undefined ? 'measured' : 'parsed', now, command)
          c.bests = best.bests
          mark('bests')
        }
      }

      if (isTest || /cover/i.test(command)) {
        c.metrics = recordMetrics(c.metrics, output, now, isTest)
        mark('metrics')
      }
      const ships = parseShips(command, output, outcome !== 'ok', now)

      if (ships.length > 0) {
        c.ships = [...c.ships, ...ships].slice(-MAX_SHIPS)
        mark('ships')

        if (ships.some(s => s.kind === 'commit')) {
          rec.commits++
          markHabit(c, today, 2)
        }
      }
    }
    await levelCheck(d, c, now)
    await flush(d, now)
    await bump(d)
  } catch {
    // Bookkeeping only: it must never reach the tool call.
  }
}

// ----------------------------------------------------------------- commands

const idOf = (s: string): number | undefined => {
  const m = s.trim().match(/^#?(\d+)$/)

  return m === null ? undefined : Number(m[1])
}

const wordOf = (args: string): [string, string] => {
  const t = args.trim()
  const i = t.search(/\s/)

  return i < 0 ? [t.toLowerCase(), ''] : [t.slice(0, i).toLowerCase(), t.slice(i).trim()]
}

const finish = async (d: Dollar, now: number, ...keys: Key[]) => {
  mark(...keys)
  await flush(d, now, true)
  await bump(d)
}

const cmdGoal = async (d: Dollar, args: string): Promise<string> => {
  const c = await readData(d)
  const now = await d.clock.now()
  const today = dayKey(now)
  const gl = glyphsOf((await lookOf(d)).icons)
  const [sub, rest] = wordOf(args)
  const view = () => dailyLines(c.goals, today, now, gl).join('\n')

  if (sub === '' || sub === 'list') {
    return `${view()}\n${weekRingLines(c.goals, today, gl).join('\n')}`
  }

  if (sub === 'add') {
    const r = addGoal(c.goals, rest, today)

    if (r.goal === undefined) {
      return 'Usage: /pggoal add <text>'
    }
    c.goals = r.data
    await finish(d, now, 'goals')

    return `Added #${r.goal.id}.\n${view()}`
  }

  if (sub === 'target') {
    const n = idOf(rest)

    if (n === undefined || n < 1 || n > 99) {
      return `The weekly target is ${c.goals.target}. /pggoal target <1-99>`
    }
    c.goals = { ...c.goals, target: n }
    await finish(d, now, 'goals')

    return `Weekly target is now ${n} goals.`
  }

  if (sub === 'stop') {
    const r = stopGoal(c.goals, now)

    if (r.goal === undefined) {
      return 'No goal clock is running.'
    }
    c.goals = r.data
    await finish(d, now, 'goals')

    return `Stopped #${r.goal.id}: ${fmtDur(r.ms)} this time, ${fmtDur(r.goal.spentMs)} in all.`
  }
  const n = idOf(rest)

  if (n === undefined) {
    return 'Usage: /pggoal add <text> | done <n> | undo <n> | rm <n> | start <n> | stop | target <n> | list'
  }

  if (sub === 'done') {
    const r = completeGoal(c.goals, n, now)

    if (r.goal === undefined) {
      return `No open goal #${n}.`
    }
    c.goals = r.data
    const rec = dayOf(c, today)
    rec.goals++
    await levelCheck(d, c, now)
    await finish(d, now, 'goals', 'days')
    await startConfetti(d)
    const look = await lookOf(d)
    const row = look.isCalm ? '' : `${CONFETTI_STILL}\n`

    return `${row}Goal #${n} done: ${r.goal.text}. +${XP_VALUES.goals} XP (${xpTotal(c.days, c.meta.archive)} total).\n${view()}`
  }

  if (sub === 'undo') {
    const r = reopenGoal(c.goals, n)

    if (r.goal === undefined) {
      return `Goal #${n} is not finished.`
    }
    const before = c.goals.goals.find(g => g.id === n)
    const rec = before === undefined ? undefined : c.days[before.doneDay]

    if (rec !== undefined && rec.goals > 0) {
      rec.goals--
    }
    c.goals = r.data
    await finish(d, now, 'goals', 'days')

    return `Reopened #${n}.\n${view()}`
  }

  if (sub === 'rm') {
    const r = removeGoal(c.goals, n)

    if (r.goal === undefined) {
      return `No goal #${n}.`
    }
    c.goals = r.data
    await finish(d, now, 'goals')

    return `Removed #${n}: ${r.goal.text}`
  }

  if (sub === 'start') {
    const r = startGoal(c.goals, n, now)

    if (r.goal === undefined) {
      return `No open goal #${n}.`
    }
    c.goals = r.data
    await finish(d, now, 'goals')

    return `${r.stopped === undefined ? '' : `Stopped #${r.stopped.id} (${fmtDur(r.stopped.spentMs)} in all). `}Clock running on #${n}: ${r.goal.text}`
  }

  return 'Usage: /pggoal add <text> | done <n> | undo <n> | rm <n> | start <n> | stop | target <n> | list'
}

const cmdXp = async (d: Dollar) => {
  const c = await readData(d)

  return xpLines(c.days, c.meta.archive, await today0(d)).join('\n')
}

const cmdLevel = async (d: Dollar) => {
  const c = await readData(d)

  return ladderLines(c.meta.totals, glyphsOf((await lookOf(d)).icons)).join('\n')
}

const cmdFreeze = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const now = await d.clock.now()
  const today = dayKey(now)
  const gl = glyphsOf((await lookOf(d)).icons)
  const arg = args.trim().toLowerCase()
  const target = /^(use|today)$/.test(arg) ? today : /^(y|yesterday)$/.test(arg) ? shiftDay(today, -1) : undefined

  if (target === undefined) {
    return `${streakLines(c.days, c.meta.frozen, today, gl).join('\n')}\nTo spend this week's freeze: /pgfreeze use (today) or /pgfreeze yesterday.`
  }
  const can = canFreeze(target, today, c.meta.frozen, c.days)

  if (!can.ok) {
    return can.reason
  }
  c.meta.frozen = [...c.meta.frozen, target].sort()
  await finish(d, now, 'meta')

  return `Froze ${target}: the streak holds through it.\n${streakLines(c.days, c.meta.frozen, today, gl).join('\n')}`
}

const findProject = (c: Cache) => c.proj.projects.find(p => p.name === c.proj.current)

const cmdProj = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const now = await d.clock.now()
  const gl = glyphsOf((await lookOf(d)).icons)
  const [sub, rest] = wordOf(args)
  const cur = findProject(c)
  const show = () => (findProject(c) === undefined ? 'No project yet. /pgproj new <name>' : projectLines(findProject(c)!, gl).join('\n'))
  const replace = (p: NonNullable<typeof cur>) => {
    c.proj = { ...c.proj, projects: c.proj.projects.map(x => (x.name === p.name ? p : x)) }
  }

  if (sub === '' || sub === 'show') {
    return show()
  }

  if (sub === 'list') {
    return projectListLines(c.proj, gl).join('\n')
  }

  if (sub === 'new') {
    const name = clip(rest, 40)

    if (name === '') {
      return 'Usage: /pgproj new <name>'
    }

    if (c.proj.projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return `A project called "${name}" exists. /pgproj use ${name}`
    }

    if (c.proj.projects.length >= MAX_PROJECTS) {
      return `${MAX_PROJECTS} projects at most. /pgproj drop one first.`
    }
    c.proj = { projects: [...c.proj.projects, { name, items: [], nextId: 1 }], current: name }
    await finish(d, now, 'proj')

    return show()
  }

  if (sub === 'use') {
    const p = c.proj.projects.find(x => x.name.toLowerCase() === rest.toLowerCase())

    if (p === undefined) {
      return `No project "${rest}". /pgproj list`
    }
    c.proj = { ...c.proj, current: p.name }
    await finish(d, now, 'proj')

    return show()
  }

  if (cur === undefined) {
    return 'No project yet. /pgproj new <name>'
  }

  if (sub === 'drop') {
    const projects = c.proj.projects.filter(p => p.name !== cur.name)
    c.proj = { projects, current: projects[0]?.name ?? '' }
    await finish(d, now, 'proj')

    return `Dropped ${cur.name}.\n${show()}`
  }

  if (sub === 'add' || sub === 'sub') {
    let parent = 0
    let text = rest

    if (sub === 'sub') {
      const [first, tail] = wordOf(rest)
      const id = idOf(first)

      if (id === undefined) {
        return 'Usage: /pgproj sub <n> <text>'
      }
      parent = id
      text = tail
    }
    const r = addItem(cur, text, parent)

    if (r.project === undefined) {
      return r.error ?? 'Could not add.'
    }
    replace(r.project)
    await finish(d, now, 'proj')

    return show()
  }
  const id = idOf(rest)

  if (id === undefined) {
    return 'Usage: /pgproj new|use|add|sub|check|uncheck|rm|drop|list'
  }

  if (sub === 'check' || sub === 'uncheck') {
    const items = setItemDone(cur.items, id, sub === 'check')

    if (items === undefined) {
      return `No item #${id}.`
    }
    replace({ ...cur, items })
    await finish(d, now, 'proj')
    const s = leafStats(items)

    return `${show()}${sub === 'check' && s.total > 0 && s.done === s.total ? '\nThe checklist is complete.' : ''}`
  }

  if (sub === 'rm') {
    const items = removeItem(cur.items, id)

    if (items === undefined) {
      return `No item #${id}.`
    }
    replace({ ...cur, items })
    await finish(d, now, 'proj')

    return show()
  }

  return 'Usage: /pgproj new|use|add|sub|check|uncheck|rm|drop|list'
}

const cmdLearn = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const now = await d.clock.now()
  const today = dayKey(now)
  const gl = glyphsOf((await lookOf(d)).icons)
  const [sub, rest] = wordOf(args)

  if (sub === 'target') {
    const n = idOf(rest)

    if (n === undefined || n < 1 || n > 99) {
      return `The weekly target is ${c.learn.target}. /pglearn target <1-99>`
    }
    c.learn = { ...c.learn, target: n }
    await finish(d, now, 'learn')

    return learnLines(c.learn, today, gl).join('\n')
  }
  const topic = clip(args, 80)

  if (topic !== '') {
    c.learn = { ...c.learn, entries: [...c.learn.entries, { at: now, day: today, topic }].slice(-200) }
    await finish(d, now, 'learn')
  }

  return learnLines(c.learn, today, gl).join('\n')
}

const cmdHabit = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const now = await d.clock.now()
  const today = dayKey(now)
  const gl = glyphsOf((await lookOf(d)).icons)
  const [sub, rest] = wordOf(args)

  if (sub === 'mark' || sub === 'unmark') {
    const n = idOf(rest)

    if (n === undefined || n < 1 || n > HABITS.length) {
      return `Usage: /pghabit ${sub} <1-${HABITS.length}> (${HABITS.map((h, i) => `${i + 1} ${h}`).join(', ')})`
    }
    c.habits = setHabit(c.habits, today, n - 1, sub === 'mark')
    await finish(d, now, 'habits')
  }

  return habitLines(c.habits, today, gl).join('\n')
}

const cmdJournal = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const now = await d.clock.now()
  const today = dayKey(now)

  if (args.trim() !== '') {
    const first = !c.journal.some(e => e.day === today)
    c.journal = setJournal(c.journal, today, args)

    // A first line for the day counts as a note for the habit and XP.
    if (first) {
      const rec = dayOf(c, today)
      rec.notes++
      markHabit(c, today, 0)
      mark('days')
    }
    await finish(d, now, 'journal')

    return `Journal for ${today} saved.\n${journalLines(c.journal, today, 5).join('\n')}`
  }

  return journalLines(c.journal, today).join('\n')
}

const cmdSplit = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const id = idOf(args)
  const goal = id === undefined ? clip(args, 300) : (c.goals.goals.find(g => g.id === id)?.text ?? '')

  if (goal === '') {
    return 'Usage: /pgsplit <goal> or /pgsplit <goal number>. It fills the prompt box; you press Enter.'
  }
  await d.prompt.fill({ text: splitPrompt(goal), mode: 'replace' })

  return 'The prompt box now asks for three steps with a check for each. Edit it or press Enter.'
}

const cmdBacklog = async (d: Dollar, args: string) => {
  const c = await readData(d)
  const now = await d.clock.now()
  const gl = glyphsOf((await lookOf(d)).icons)
  const [sub, rest] = wordOf(args)

  if (sub === 'add') {
    const r = addBacklog(c.backlog, rest, dayKey(now))

    if (r.item === undefined) {
      return 'Usage: /pgbacklog add <text>'
    }
    c.backlog = r.data
    await finish(d, now, 'backlog')

    return `Added #${r.item.id}. ${backlogOpen(c.backlog)} open.`
  }

  if (sub === 'done' || sub === 'rm') {
    const n = idOf(rest)
    const item = n === undefined ? undefined : c.backlog.items.find(i => i.id === n)

    if (item === undefined) {
      return `Usage: /pgbacklog ${sub} <n>`
    }
    c.backlog = {
      ...c.backlog,
      items: sub === 'rm' ? c.backlog.items.filter(i => i.id !== item.id) : c.backlog.items.map(i => (i.id === item.id ? { ...i, done: true } : i)),
    }
    await finish(d, now, 'backlog')

    return `${sub === 'rm' ? 'Removed' : 'Done'} #${item.id}. ${backlogOpen(c.backlog)} open.`
  }

  if (sub === 'clear') {
    c.backlog = { ...c.backlog, items: c.backlog.items.filter(i => !i.done) }
    await finish(d, now, 'backlog')

    return `Cleared finished items. ${backlogOpen(c.backlog)} open.`
  }

  return backlogLines(c.backlog, gl, 30).join('\n')
}

const cmdPane = async (d: Dollar, args: string) => {
  const tab = tabOf(args)

  if (args.trim() !== '' && tab === undefined) {
    return `Unknown tab "${args.trim()}". Tabs: ${TABS.join(', ')}.`
  }

  if (tab !== undefined) {
    await update(d, tabA, () => tab)
  }
  const opened = await d.ui.open({ id: PANE, title: 'Progress' })

  return opened.isPlaced ? 'Progress pane opened.' : `The progress pane is waiting for room: ${opened.reason}`
}

const cmdReset = async (d: Dollar, args: string) => {
  if (args.trim().toLowerCase() !== 'yes') {
    return 'This clears your goals, XP, calendar, projects, learning, habits, bests, journal, backlog, ship log and metrics. Run /pgreset yes to confirm.'
  }
  const now = await d.clock.now()
  stopTicker()
  cache = emptyCache(dayKey(now))
  dirty.clear()

  for (const k of Object.keys(KEYS) as Key[]) {
    await d.store.set(KEYS[k], cache[k])
  }
  await update(d, confettiAtA, () => 0)
  await bump(d)

  return 'Progress data cleared.'
}

const startSession = async (d: Dollar) => {
  const c = await readData(d)
  const now = await d.clock.now()
  const today = dayKey(now)
  const pruned = pruneDays(c.days, c.meta.archive, today)
  c.days = pruned.days
  c.meta.archive = pruned.archive
  c.goals = { ...c.goals, goals: pruneGoals(c.goals.goals, today) }
  c.meta.frozen = c.meta.frozen.filter(k => isDayKey(k))
  dayOf(c, today).sessions++
  c.meta.totals.sessions++
  await levelCheck(d, c, now)
  mark('days', 'meta', 'goals')
  await flush(d, now, true)
}

// ----------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    await startSession($).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopTicker()
    await flush($, await $.clock.now(), true).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await flush($, await $.clock.now(), true).catch(() => undefined)

    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopTicker()

    return next(e)
  })

  // 106, 113: a `/note` that writes something counts once, by name only.
  on('command.run', async ($, e, next) => {
    const ran = await next(e)

    if (e.command === 'note' && e.args.trim() !== '') {
      await recordNote($).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const startedAt = await $.clock.now().catch(() => 0)
    let ran

    try {
      ran = await next(e)
    } catch (err) {
      await noteDone($, tool, input, 'error', '', startedAt)
      throw err
    }
    const result = ran as { deny?: string; isError?: boolean }
    await noteDone($, tool, input, result.deny !== undefined ? 'denied' : result.isError === true ? 'error' : 'ok', outputOf(ran), startedAt)

    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pg' }, async () => ({ text: helpLines().join('\n') }))
  on('command.run', { command: 'pgpane' }, async ($, e) => ({ text: await cmdPane($, e.args) }))
  on('command.run', { command: 'pggoal' }, async ($, e) => ({ text: await cmdGoal($, e.args) }))
  on('command.run', { command: 'pglevel' }, async $ => ({ text: await cmdLevel($) }))
  on('command.run', { command: 'pgxp' }, async $ => ({ text: await cmdXp($) }))
  on('command.run', { command: 'pgfreeze' }, async ($, e) => ({ text: await cmdFreeze($, e.args) }))
  on('command.run', { command: 'pgproj' }, async ($, e) => ({ text: await cmdProj($, e.args) }))
  on('command.run', { command: 'pglearn' }, async ($, e) => ({ text: await cmdLearn($, e.args) }))
  on('command.run', { command: 'pgtree' }, async $ => ({ text: treeLines((await readData($)).skills, glyphsOf((await lookOf($)).icons)).join('\n') }))
  on('command.run', { command: 'pghabit' }, async ($, e) => ({ text: await cmdHabit($, e.args) }))
  on('command.run', { command: 'pgbest' }, async $ => {
    const c = await readData($)

    return { text: bestLines(c.bests, c.days, c.meta.frozen, await today0($)).join('\n') }
  })
  on('command.run', { command: 'pgjournal' }, async ($, e) => ({ text: await cmdJournal($, e.args) }))
  on('command.run', { command: 'pgsplit' }, async ($, e) => ({ text: await cmdSplit($, e.args) }))
  on('command.run', { command: 'pgfocus' }, async $ => {
    const c = await readData($)

    return { text: focusLines(c.live.events, await $.clock.now(), glyphsOf((await lookOf($)).icons)).join('\n') }
  })
  on('command.run', { command: 'pgmomentum' }, async $ => {
    const c = await readData($)

    return { text: momentumLines(c.live.hours, await $.clock.now(), glyphsOf((await lookOf($)).icons)).join('\n') }
  })
  on('command.run', { command: 'pgbacklog' }, async ($, e) => ({ text: await cmdBacklog($, e.args) }))
  on('command.run', { command: 'pgship' }, async $ => ({ text: shipLines((await readData($)).ships, 20).join('\n') }))
  on('command.run', { command: 'pgmetrics' }, async $ => ({ text: metricsLines((await readData($)).metrics).join('\n') }))
  on('command.run', { command: 'pgreset' }, async ($, e) => ({ text: await cmdReset($, e.args) }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await readData($)
    await read($, revA)
    const look = await lookOf($)
    const gl = glyphsOf(look.icons)
    const clockNow = await $.clock.now()
    const today = dayKey(clockNow)
    const stored = await read($, tabA)
    const tab: Tab = tabOf(stored) ?? 'goals'
    const at = await read($, confettiAtA)
    const age = clockNow - at
    const live = at > 0 && age < CONFETTI_MS + CONFETTI_STEP

    if (live) {
      // Reading the clock atom is what redraws the pane each frame.
      await read($, nowA)
    }
    const burst = tab === 'goals' && at > 0 ? confettiView(age, look.isMotion, look.isCalm) : ''
    const pad = look.density === 'compact' ? 'xs' : look.density === 'airy' ? 'md' : 'sm'
    const accent = look.accent as 'suggestion'
    const blocks = blocksFor(tab, c, today, clockNow, gl)

    return (
      <Box flexDirection="column" padding={pad} gap={pad}>
        <Box gap="sm" flexWrap="wrap">
          {TABS.map(t => (
            <Button key={`tab-${t}`} label={t[0]!.toUpperCase() + t.slice(1)} variant={t === tab ? 'primary' : 'secondary'} onPress={() => update($, tabA, () => t)} />
          ))}
        </Box>
        {burst !== '' && (
          <Text mono color={accent}>
            {burst}
          </Text>
        )}
        {blocks.map(b => (
          <Box flexDirection="column">
            <Text size="caption" weight="semibold" color={accent}>
              {b.title}
            </Text>
            {b.lines.map(line => (
              <Text mono>{line === '' ? ' ' : line}</Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
