// Pure functions for the progress mod: no engine calls, so each is unit-testable.
// Everything that is recorded is bounded, and every loaded value goes through a cleaner.

export const MINUTE = 60_000
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

// ------------------------------------------------------------------ cleaners

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
export const clip = (s: string, n: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : [])

// -------------------------------------------------------------------- calendar

const pad2 = (n: number) => String(n).padStart(2, '0')

export const dayKey = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export const hourKey = (ms: number): string => `${dayKey(ms)} ${pad2(new Date(ms).getHours())}`

const utcOf = (key: string): number => {
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)

  return Date.UTC(y, m - 1, d)
}

export const isDayKey = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export const shiftDay = (key: string, n: number): string => {
  const d = new Date(utcOf(key) + n * DAY_MS)

  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

export const dayDiff = (a: string, b: string): number => Math.round((utcOf(b) - utcOf(a)) / DAY_MS)

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** 0 for Monday to 6 for Sunday. */
export const dowOf = (key: string): number => (new Date(utcOf(key)).getUTCDay() + 6) % 7

export const weekStart = (key: string): string => shiftDay(key, -dowOf(key))

export const weekDays = (key: string): string[] => Array.from({ length: 7 }, (_, i) => shiftDay(weekStart(key), i))

export const shortDay = (key: string): string => key.slice(5)

export const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))

  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)

  if (m < 60) {
    return `${m}m`
  }

  return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`
}

// -------------------------------------------------------------------- glyphs

export type Glyphs = { on: string; off: string; frozen: string; done: string; todo: string; full: string; empty: string; run: string }

/** The glyph style the settings mod's `icons` picks. */
export const glyphsOf = (icons: string): Glyphs =>
  icons === 'letters'
    ? { on: 'X', off: '.', frozen: 'F', done: '[x]', todo: '[ ]', full: '#', empty: '-', run: '>' }
    : icons === 'minimal'
      ? { on: '#', off: '.', frozen: 'f', done: 'x', todo: '-', full: '=', empty: ' ', run: '>' }
      : { on: '■', off: '·', frozen: '❄', done: '✓', todo: '○', full: '█', empty: '░', run: '▶' }

export const barOf = (frac: number, width: number, g: Glyphs): string => {
  const n = Math.round(clamp(Number.isFinite(frac) ? frac : 0, 0, 1) * width)

  return g.full.repeat(n) + g.empty.repeat(width - n)
}

const SPARK = '▁▂▃▄▅▆▇█'

export const sparkline = (values: number[]): string => {
  if (values.length === 0) {
    return ''
  }
  const lo = Math.min(...values)
  const hi = Math.max(...values)

  if (hi === lo) {
    return '▄'.repeat(values.length)
  }

  return values.map(v => SPARK[Math.min(7, Math.floor(((v - lo) / (hi - lo)) * 8))] ?? '▁').join('')
}

// ------------------------------------------------------------- 103/104/117 goals

export type Goal = { id: number; text: string; day: string; doneAt: number; doneDay: string; spentMs: number }
export type Running = { id: number; startedAt: number } | null
export type GoalData = { goals: Goal[]; nextId: number; target: number; running: Running }

export const MAX_GOALS = 100
export const DEFAULT_TARGET = 10

export const emptyGoals = (): GoalData => ({ goals: [], nextId: 1, target: DEFAULT_TARGET, running: null })

export const cleanGoals = (raw: unknown): GoalData => {
  const r = isObj(raw) ? raw : {}
  const goals = list(r.goals)
    .map(g => ({
      id: Math.max(1, Math.floor(num(g.id, 0))),
      text: clip(str(g.text), 120),
      day: isDayKey(g.day) ? g.day : '1970-01-01',
      doneAt: num(g.doneAt),
      doneDay: isDayKey(g.doneDay) ? g.doneDay : '',
      spentMs: Math.max(0, num(g.spentMs)),
    }))
    .filter(g => g.id > 0 && g.text !== '')
    .slice(-MAX_GOALS)
  const rr = isObj(r.running) ? r.running : {}
  const runId = num(rr.id, -1)
  const run = goals.some(g => g.id === runId && g.doneAt === 0)
  const nextId = Math.max(Math.floor(num(r.nextId, 1)), 1 + Math.max(0, ...goals.map(g => g.id)))

  return {
    goals,
    nextId,
    target: clamp(Math.floor(num(r.target, DEFAULT_TARGET)), 1, 99),
    running: run ? { id: runId, startedAt: num(rr.startedAt) } : null,
  }
}

/** Drops finished goals older than 60 days, then the oldest finished ones if there are too many. */
export const pruneGoals = (goals: Goal[], today: string): Goal[] => {
  let out = goals.filter(g => g.doneAt === 0 || dayDiff(g.doneDay || g.day, today) <= 60)

  while (out.length > MAX_GOALS) {
    const i = out.findIndex(g => g.doneAt !== 0)
    out = i >= 0 ? [...out.slice(0, i), ...out.slice(i + 1)] : out.slice(1)
  }

  return out
}

export const addGoal = (data: GoalData, text: string, today: string): { data: GoalData; goal?: Goal } => {
  const t = clip(text, 120)

  if (t === '') {
    return { data }
  }
  const goal: Goal = { id: data.nextId, text: t, day: today, doneAt: 0, doneDay: '', spentMs: 0 }

  return { data: { ...data, nextId: data.nextId + 1, goals: pruneGoals([...data.goals, goal], today) }, goal }
}

export const goalSpent = (g: Goal, running: Running, now: number): number =>
  g.spentMs + (running !== null && running.id === g.id ? Math.max(0, now - running.startedAt) : 0)

export const completeGoal = (data: GoalData, id: number, now: number): { data: GoalData; goal?: Goal } => {
  const g = data.goals.find(x => x.id === id)

  if (g === undefined || g.doneAt !== 0) {
    return { data }
  }
  const spent = goalSpent(g, data.running, now)
  const done: Goal = { ...g, doneAt: now, doneDay: dayKey(now), spentMs: spent }

  return {
    data: { ...data, goals: data.goals.map(x => (x.id === id ? done : x)), running: data.running?.id === id ? null : data.running },
    goal: done,
  }
}

/** Puts a done goal back to open. Time already spent stays. */
export const reopenGoal = (data: GoalData, id: number): { data: GoalData; goal?: Goal } => {
  const g = data.goals.find(x => x.id === id)

  if (g === undefined || g.doneAt === 0) {
    return { data }
  }
  const open: Goal = { ...g, doneAt: 0, doneDay: '' }

  return { data: { ...data, goals: data.goals.map(x => (x.id === id ? open : x)) }, goal: open }
}

export const removeGoal = (data: GoalData, id: number): { data: GoalData; goal?: Goal } => {
  const g = data.goals.find(x => x.id === id)

  return g === undefined
    ? { data }
    : { data: { ...data, goals: data.goals.filter(x => x.id !== id), running: data.running?.id === id ? null : data.running }, goal: g }
}

/** Starts the clock on a goal; a clock running on another goal is stopped and its time added first. */
export const startGoal = (data: GoalData, id: number, now: number): { data: GoalData; goal?: Goal; stopped?: Goal } => {
  const g = data.goals.find(x => x.id === id)

  if (g === undefined || g.doneAt !== 0) {
    return { data }
  }

  if (data.running?.id === id) {
    return { data, goal: g }
  }
  const stopped = stopGoal(data, now)

  return {
    data: { ...stopped.data, running: { id, startedAt: now } },
    goal: g,
    stopped: stopped.goal,
  }
}

export const stopGoal = (data: GoalData, now: number): { data: GoalData; goal?: Goal; ms: number } => {
  const run = data.running

  if (run === null) {
    return { data, ms: 0 }
  }
  const ms = Math.max(0, now - run.startedAt)
  let found: Goal | undefined
  const goals = data.goals.map(g => {
    if (g.id !== run.id) {
      return g
    }
    found = { ...g, spentMs: g.spentMs + ms }

    return found
  })

  return { data: { ...data, goals, running: null }, goal: found, ms }
}

/** Goals that belong to today: still open, or finished today. */
export const todaysGoals = (goals: Goal[], today: string): Goal[] => goals.filter(g => g.doneAt === 0 || g.doneDay === today)

export const dailyProgress = (goals: Goal[], today: string) => {
  const mine = todaysGoals(goals, today)
  const done = mine.filter(g => g.doneAt !== 0).length

  return { done, total: mine.length, frac: mine.length === 0 ? 0 : done / mine.length }
}

export const weekProgress = (goals: Goal[], today: string, target: number) => {
  const days = new Set(weekDays(today))
  const done = goals.filter(g => g.doneAt !== 0 && days.has(g.doneDay)).length

  return { done, target, frac: clamp(done / Math.max(1, target), 0, 1) }
}

/** A 5 row ring of 12 dots, filled clockwise from the top, with the percent in the middle. */
export const ringLines = (frac: number, g: Glyphs, label = `${Math.round(clamp(frac, 0, 1) * 100)}%`): string[] => {
  const cells: [number, number][] = [
    [0, 2], [0, 3], [1, 4], [2, 4], [3, 4], [4, 3], [4, 2], [4, 1], [3, 0], [2, 0], [1, 0], [0, 1],
  ]
  const filled = Math.round(clamp(frac, 0, 1) * cells.length)
  const rows = Array.from({ length: 5 }, () => Array.from({ length: 9 }, () => ' '))
  cells.forEach(([r, c], i) => {
    const row = rows[r]

    if (row !== undefined) {
      row[c * 2] = i < filled ? g.on : g.off
    }
  })
  const mid = rows[2]

  if (mid !== undefined) {
    const start = 1 + Math.max(0, Math.floor((7 - label.length) / 2))
    label.split('').forEach((ch, i) => {
      if (start + i < 8) {
        mid[start + i] = ch
      }
    })
  }

  return rows.map(r => r.join('').trimEnd())
}

export const goalLine = (g: Goal, running: Running, now: number, gl: Glyphs): string => {
  const spent = goalSpent(g, running, now)
  const live = running !== null && running.id === g.id
  const time = live ? `${gl.run} ${fmtDur(spent)}` : spent >= 1000 ? fmtDur(spent) : ''

  return `${g.doneAt !== 0 ? gl.done : gl.todo} #${g.id} ${g.text}${time === '' ? '' : `  ${time}`}`
}

export const dailyLines = (data: GoalData, today: string, now: number, gl: Glyphs): string[] => {
  const p = dailyProgress(data.goals, today)
  const mine = todaysGoals(data.goals, today)
  const out = [`Today ${barOf(p.frac, 12, gl)} ${p.done}/${p.total}${p.total > 0 && p.done === p.total ? '  all done' : ''}`]

  if (mine.length === 0) {
    out.push('No goals yet. /pggoal add <text>')
  }

  return [...out, ...mine.map(g => goalLine(g, data.running, now, gl))]
}

export const weekRingLines = (data: GoalData, today: string, gl: Glyphs): string[] => {
  const w = weekProgress(data.goals, today, data.target)
  const days = weekDays(today)

  return [
    ...ringLines(w.frac, gl),
    `${w.done} of ${w.target} goals this week (${shortDay(days[0] ?? today)} to ${shortDay(days[6] ?? today)})`,
    w.done >= w.target ? 'Weekly target reached.' : `${w.target - w.done} to go. /pggoal target <n> changes it.`,
  ]
}

// ------------------------------------------------------------------ 108 confetti

export const CONFETTI_MS = 1500
export const CONFETTI_STEP = 150
export const CONFETTI_STILL = '✦ · ✧ · ✦ · ✧ · ✦'
const CONFETTI_GLYPHS = ['✦', '✧', '·', '*', '•', '+']

const hash = (a: number, b: number): number => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** One frame of the 1.5 s burst: it spreads from the middle and thins out. Empty once over. */
export const confettiFrame = (age: number, width = 28): string => {
  if (age < 0 || age >= CONFETTI_MS) {
    return ''
  }
  const step = Math.floor(age / CONFETTI_STEP)
  const radius = (width / 2) * Math.min(1, (age + CONFETTI_STEP) / 600)
  const density = 0.75 * (1 - age / CONFETTI_MS) + 0.05
  let out = ''

  for (let i = 0; i < width; i++) {
    const inside = Math.abs(i + 0.5 - width / 2) <= radius
    out += inside && hash(i + step * 7, step) < density ? (CONFETTI_GLYPHS[Math.floor(hash(i, step + 99) * CONFETTI_GLYPHS.length)] ?? '*') : ' '
  }

  return out
}

/** What the burst row shows: animated, or one still row when motion is off, or nothing when calm. */
export const confettiView = (age: number, motion: boolean, calm: boolean): string => {
  if (calm) {
    return ''
  }

  if (!motion) {
    return age >= 0 && age < 60_000 ? CONFETTI_STILL : ''
  }

  return confettiFrame(age)
}

// ---------------------------------------------------------- days, XP, streaks

export type DayRec = { tools: number; sessions: number; tests: number; commits: number; notes: number; goals: number }
export type Days = Record<string, DayRec>
export type XpSource = 'tests' | 'commits' | 'notes' | 'goals'
export type XpArchive = Record<XpSource, number>

export const emptyDay = (): DayRec => ({ tools: 0, sessions: 0, tests: 0, commits: 0, notes: 0, goals: 0 })
export const emptyArchive = (): XpArchive => ({ tests: 0, commits: 0, notes: 0, goals: 0 })
export const XP_VALUES: Record<XpSource, number> = { tests: 2, commits: 3, notes: 1, goals: 5 }
export const XP_LABELS: Record<XpSource, string> = { tests: 'Test run', commits: 'Commit', notes: 'Note', goals: 'Goal done' }
export const XP_SOURCES: XpSource[] = ['tests', 'commits', 'notes', 'goals']
/** Habits that could be farmed pay out for this many a day. */
export const XP_DAILY_CAP = 10
export const KEEP_DAYS = 120

export const cleanDays = (raw: unknown): Days => {
  const out: Days = {}

  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (isDayKey(k) && isObj(v)) {
        out[k] = {
          tools: Math.max(0, num(v.tools)),
          sessions: Math.max(0, num(v.sessions)),
          tests: Math.max(0, num(v.tests)),
          commits: Math.max(0, num(v.commits)),
          notes: Math.max(0, num(v.notes)),
          goals: Math.max(0, num(v.goals)),
        }
      }
    }
  }

  return out
}

export const cleanArchive = (raw: unknown): XpArchive => {
  const r = isObj(raw) ? raw : {}

  return { tests: Math.max(0, num(r.tests)), commits: Math.max(0, num(r.commits)), notes: Math.max(0, num(r.notes)), goals: Math.max(0, num(r.goals)) }
}

export const unitsOf = (d: DayRec, src: XpSource): number => (src === 'goals' ? d.goals : Math.min(d[src], XP_DAILY_CAP))

export const xpOfDay = (d: DayRec | undefined): number =>
  d === undefined ? 0 : XP_SOURCES.reduce((sum, s) => sum + unitsOf(d, s) * XP_VALUES[s], 0)

/** Folds days older than KEEP_DAYS into the archive so the record stays bounded. */
export const pruneDays = (days: Days, archive: XpArchive, today: string): { days: Days; archive: XpArchive } => {
  const keep: Days = {}
  const arch = { ...archive }

  for (const [k, v] of Object.entries(days)) {
    if (dayDiff(k, today) > KEEP_DAYS) {
      for (const s of XP_SOURCES) {
        arch[s] += unitsOf(v, s)
      }
    } else {
      keep[k] = v
    }
  }

  return { days: keep, archive: arch }
}

export const xpTotal = (days: Days, archive: XpArchive): number =>
  XP_SOURCES.reduce((sum, s) => sum + archive[s] * XP_VALUES[s], 0) + Object.values(days).reduce((sum, d) => sum + xpOfDay(d), 0)

export const xpLines = (days: Days, archive: XpArchive, today: string): string[] => {
  const week = weekDays(today)
  const out = [`XP ${xpTotal(days, archive)} total, ${xpOfDay(days[today])} today, ${week.reduce((s, k) => s + xpOfDay(days[k]), 0)} this week`]
  out.push('source        pts  today  week  total')

  for (const s of XP_SOURCES) {
    const todayN = days[today] === undefined ? 0 : unitsOf(days[today], s)
    const weekN = week.reduce((n, k) => n + (days[k] === undefined ? 0 : unitsOf(days[k], s)), 0)
    const totalN = archive[s] + Object.values(days).reduce((n, d) => n + unitsOf(d, s), 0)
    out.push(`${XP_LABELS[s].padEnd(12)} +${String(XP_VALUES[s]).padEnd(2)} ${String(todayN).padStart(5)} ${String(weekN).padStart(5)} ${String(totalN).padStart(6)}`)
  }
  out.push(`Tests, commits and notes pay for up to ${XP_DAILY_CAP} a day.`)

  return out
}

export const isActive = (d: DayRec | undefined): boolean => d !== undefined && (d.tools > 0 || d.goals > 0)

export type StreakInfo = { current: number; longest: number; isTodayDone: boolean }

export const streakInfo = (days: Days, frozen: string[], today: string): StreakInfo => {
  const fz = new Set(frozen)
  const ok = (k: string) => isActive(days[k]) || fz.has(k)
  const isTodayDone = isActive(days[today])
  let d = ok(today) ? today : shiftDay(today, -1)
  let current = 0

  for (let i = 0; i < 400 && ok(d); i++) {
    current += isActive(days[d]) ? 1 : 0
    d = shiftDay(d, -1)
  }
  const first = [...Object.keys(days).filter(k => isActive(days[k])), ...frozen].sort()[0]
  let longest = 0

  if (first !== undefined) {
    let run = 0
    let k = first

    for (let i = 0; i < 600 && dayDiff(k, today) >= 0; i++) {
      run = ok(k) ? run + (isActive(days[k]) ? 1 : 0) : 0
      longest = Math.max(longest, run)
      k = shiftDay(k, 1)
    }
  }

  return { current, longest: Math.max(longest, current), isTodayDone }
}

export const cleanFrozen = (raw: unknown, today: string): string[] =>
  (Array.isArray(raw) ? raw.filter(isDayKey) : []).filter(k => dayDiff(k, today) <= 120).sort().slice(-40)

/** One freeze a week, for today or yesterday, and only for a day with no activity. */
export const canFreeze = (day: string, today: string, frozen: string[], days: Days): { ok: boolean; reason: string } => {
  const age = dayDiff(day, today)

  if (age < 0 || age > 1) {
    return { ok: false, reason: 'A freeze covers today or yesterday only.' }
  }

  if (isActive(days[day])) {
    return { ok: false, reason: `${day} already has activity, no freeze needed.` }
  }

  if (frozen.includes(day)) {
    return { ok: false, reason: `${day} is already frozen.` }
  }
  const week = new Set(weekDays(day))
  const used = frozen.find(k => week.has(k))

  if (used !== undefined) {
    return { ok: false, reason: `This week's freeze is used (${used}). One freeze per week, Monday to Sunday.` }
  }

  return { ok: true, reason: '' }
}

export const calendarLines = (days: Days, frozen: string[], today: string, gl: Glyphs, weeks = 5): string[] => {
  const fz = new Set(frozen)
  const first = shiftDay(weekStart(today), -7 * (weeks - 1))
  const out = [`       ${WEEKDAYS.map(w => `${w} `).join('')}`.trimEnd()]

  for (let w = 0; w < weeks; w++) {
    const start = shiftDay(first, w * 7)
    let row = `${shortDay(start)}  `

    for (let i = 0; i < 7; i++) {
      const k = shiftDay(start, i)
      const g = dayDiff(k, today) < 0 ? ' ' : isActive(days[k]) ? gl.on : fz.has(k) ? gl.frozen : gl.off
      row += k === today ? `[${g}] ` : ` ${g}  `
    }
    out.push(row.trimEnd())
  }

  return out
}

export const streakLines = (days: Days, frozen: string[], today: string, gl: Glyphs): string[] => {
  const s = streakInfo(days, frozen, today)
  const week = new Set(weekDays(today))
  const usedFreeze = frozen.find(k => week.has(k))

  return [
    `Streak ${plural(s.current, 'day')}, longest ${s.longest}. ${s.isTodayDone ? 'Today is counted.' : 'Work on something today to keep it.'}`,
    ...calendarLines(days, frozen, today, gl),
    `${gl.on} active  ${gl.frozen} frozen  ${gl.off} quiet  [today]`,
    usedFreeze === undefined ? 'Freeze: 1 left this week. /pgfreeze (or /pgfreeze yesterday)' : `Freeze: used on ${usedFreeze}. The next one is available on Monday.`,
  ]
}

// ------------------------------------------------------------ 105 ladder

export type Totals = { tools: number; sessions: number }
export const LEVELS = [
  { name: 'Newcomer', tools: 0, sessions: 0 },
  { name: 'Tinkerer', tools: 25, sessions: 2 },
  { name: 'Builder', tools: 100, sessions: 5 },
  { name: 'Crafter', tools: 300, sessions: 10 },
  { name: 'Maker', tools: 750, sessions: 20 },
  { name: 'Engineer', tools: 1500, sessions: 40 },
  { name: 'Architect', tools: 3000, sessions: 80 },
  { name: 'Wizard', tools: 6000, sessions: 150 },
  { name: 'Legend', tools: 12000, sessions: 300 },
] as const

/** The index of the highest level whose tool-call and session thresholds are both met. */
export const levelOf = (t: Totals): number => {
  let at = 0
  LEVELS.forEach((l, i) => {
    if (t.tools >= l.tools && t.sessions >= l.sessions) {
      at = i
    }
  })

  return at
}

export const nextLevelText = (t: Totals): string => {
  const i = levelOf(t)
  const next = LEVELS[i + 1]

  if (next === undefined) {
    return 'Top of the ladder.'
  }
  const needs = [
    next.tools > t.tools ? plural(next.tools - t.tools, 'more tool call') : '',
    next.sessions > t.sessions ? plural(next.sessions - t.sessions, 'more session') : '',
  ].filter(Boolean)

  return `Next: ${next.name} needs ${needs.join(' and ')}.`
}

export const levelFrac = (t: Totals): number => {
  const next = LEVELS[levelOf(t) + 1]

  return next === undefined ? 1 : (Math.min(1, t.tools / next.tools) + Math.min(1, t.sessions / next.sessions)) / 2
}

export const ladderLines = (t: Totals, gl: Glyphs): string[] => {
  const at = levelOf(t)
  const out = [`Level ${at + 1}: ${LEVELS[at]?.name} (${plural(t.tools, 'tool call')}, ${plural(t.sessions, 'session')} counted here)`]
  out.push(`${barOf(levelFrac(t), 14, gl)} ${Math.round(levelFrac(t) * 100)}% to the next level`)

  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const l = LEVELS[i]!
    out.push(`${i === at ? gl.run : i < at ? gl.done : gl.todo} ${String(i + 1).padStart(2)} ${l.name.padEnd(10)} ${String(l.tools).padStart(6)} calls ${String(l.sessions).padStart(4)} sessions`)
  }
  out.push(nextLevelText(t))

  return out
}

// ------------------------------------------------------- command analysis

export const tokenize = (s: string): string[] => {
  const out: string[] = []

  for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }

  return out
}

export const segmentsOf = (command: string): string[] =>
  command
    .split(/&&|\|\||;|\||\n/)
    .map(s => s.trim())
    .filter(Boolean)

const WRAPPERS = new Set(['sudo', 'time', 'env', 'command', 'nohup', 'exec'])

/** The tokens of one command with env assignments and wrappers dropped. */
export const bareTokens = (segment: string): string[] => {
  const t = tokenize(segment)

  while (t.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0] ?? '') || WRAPPERS.has(t[0] ?? ''))) {
    t.shift()
  }

  return t
}

export const gitSub = (tokens: string[]): string => {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i] ?? ''

    if (t === '-C' || t === '-c') {
      i++
    } else if (!t.startsWith('-')) {
      return t
    }
  }

  return ''
}

const baseName = (s: string) => s.replace(/^.*\//, '')

/** The command names a Bash call runs: `git` and `git commit`, `ls`, `npm`. Bounded to 8. */
export const commandHeads = (command: string): string[] => {
  const out: string[] = []

  for (const seg of segmentsOf(command)) {
    const t = bareTokens(seg)
    const head = baseName(t[0] ?? '').replace(/[^\w.+-]/g, '')

    if (head === '' || head.length > 24) {
      continue
    }
    out.push(head)

    if (head === 'git') {
      const sub = gitSub(t)

      if (/^[a-z-]{2,20}$/.test(sub)) {
        out.push(`git ${sub}`)
      }
    }
  }

  return out.slice(0, 8)
}

const TEST_RES = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t)\b/,
  /^(npx|bunx|pnpm\s+dlx|pnpm\s+exec)\s+(vitest|jest|mocha|ava|playwright\s+test)\b/,
  /^(vitest|jest|pytest|py\.test|mocha|ava|phpunit|rspec|tox|nosetests)\b/,
  /^python3?\s+-m\s+(pytest|unittest)\b/,
  /^(cargo|go|dotnet|swift|mix|flutter|dart|deno)\s+test\b/,
  /^(\.\/)?(mvnw?|gradlew?)\s+.*\btest\b/,
  /^make\s+(test|check)\b/,
  /\bplugin\s+test\b/,
]

export const isTestCommand = (command: string): boolean =>
  segmentsOf(command).some(seg => {
    const s = bareTokens(seg).join(' ')

    return TEST_RES.some(re => re.test(s))
  })

// --------------------------------------------------------------- 112 skill tree

export type Skills = { tools: Record<string, number>; cmds: Record<string, number> }
export const emptySkills = (): Skills => ({ tools: {}, cmds: {} })
const MAX_SKILL_KEYS = 60

const cleanCounts = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {}

  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw).slice(0, 200)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0 && k.length <= 40) {
        out[k] = v
      }
    }
  }

  return out
}

export const cleanSkills = (raw: unknown): Skills => {
  const r = isObj(raw) ? raw : {}

  return { tools: cleanCounts(r.tools), cmds: cleanCounts(r.cmds) }
}

const bump = (rec: Record<string, number>, key: string) => {
  if (rec[key] !== undefined || Object.keys(rec).length < MAX_SKILL_KEYS) {
    rec[key] = (rec[key] ?? 0) + 1
  }
}

export const toolKey = (tool: string): string => (tool.startsWith('mcp__') ? 'mcp' : tool.slice(0, 30))

/** Counts one tool call, and for Bash the command names and the markers the tree reads. */
export const noteSkill = (s: Skills, tool: string, command: string): Skills => {
  const out: Skills = { tools: { ...s.tools }, cmds: { ...s.cmds } }
  bump(out.tools, toolKey(tool))

  if (tool === 'Bash') {
    for (const h of commandHeads(command)) {
      bump(out.cmds, h)
    }

    if (isTestCommand(command)) {
      bump(out.cmds, 'test run')
    }
  }

  return out
}

const shellCount = (s: Skills) => Object.keys(s.cmds).filter(k => !k.includes(' ')).length
const used = (s: Skills, ...tools: string[]) => tools.some(t => (s.tools[t] ?? 0) > 0)

type SkillNode = { name: string; need: string; has: (s: Skills) => boolean }
export const BRANCHES: { name: string; nodes: SkillNode[] }[] = [
  {
    name: 'Explore',
    nodes: [
      { name: 'Reader', need: 'use Read', has: s => used(s, 'Read') },
      { name: 'Searcher', need: 'use Grep or Glob', has: s => used(s, 'Grep', 'Glob') },
      { name: 'Cartographer', need: 'use Read, Grep and Glob', has: s => used(s, 'Read') && used(s, 'Grep') && used(s, 'Glob') },
    ],
  },
  {
    name: 'Craft',
    nodes: [
      { name: 'Editor', need: 'use Edit', has: s => used(s, 'Edit') },
      { name: 'Author', need: 'use Write', has: s => used(s, 'Write') },
      { name: 'Refactorer', need: '25 Edit calls', has: s => (s.tools.Edit ?? 0) >= 25 },
    ],
  },
  {
    name: 'Shell',
    nodes: [
      { name: 'Shell hand', need: 'use Bash', has: s => used(s, 'Bash') },
      { name: 'Toolsmith', need: '5 different commands', has: s => shellCount(s) >= 5 },
      { name: 'Operator', need: '15 different commands', has: s => shellCount(s) >= 15 },
    ],
  },
  {
    name: 'Ship',
    nodes: [
      { name: 'Tester', need: 'run a test command', has: s => (s.cmds['test run'] ?? 0) > 0 },
      { name: 'Committer', need: 'git commit', has: s => (s.cmds['git commit'] ?? 0) > 0 },
      { name: 'Releaser', need: 'git tag or git merge', has: s => (s.cmds['git tag'] ?? 0) + (s.cmds['git merge'] ?? 0) > 0 },
    ],
  },
  {
    name: 'Reach',
    nodes: [
      { name: 'Fetcher', need: 'use WebFetch or WebSearch', has: s => used(s, 'WebFetch', 'WebSearch') },
      { name: 'Delegator', need: 'use an Agent', has: s => used(s, 'Agent', 'Task') },
      { name: 'Integrator', need: 'use an MCP tool', has: s => used(s, 'mcp') },
    ],
  },
]

export const skillCount = (s: Skills) => {
  const all = BRANCHES.flatMap(b => b.nodes)

  return { got: all.filter(n => n.has(s)).length, total: all.length }
}

/** A tier unlocks only after the one above it on its branch. */
export const treeLines = (s: Skills, gl: Glyphs): string[] => {
  const c = skillCount(s)
  const out = [`Skill tree: ${c.got} of ${c.total} unlocked (${plural(Object.keys(s.tools).length, 'tool')}, ${plural(shellCount(s), 'shell command')} seen)`]

  for (const b of BRANCHES) {
    let open = true
    out.push(b.name)
    b.nodes.forEach((n, i) => {
      const has = open && n.has(s)
      open = has
      out.push(`${i === b.nodes.length - 1 ? '└─' : '├─'} ${has ? gl.done : gl.todo} T${i + 1} ${n.name}${has ? '' : `  (${n.need})`}`)
    })
  }

  return out
}

// ----------------------------------------------------- 109/110 projects, checklists

export type Item = { id: number; text: string; done: boolean; parent: number }
export type Project = { name: string; items: Item[]; nextId: number }
export type ProjData = { projects: Project[]; current: string }
export const MAX_PROJECTS = 8
export const MAX_ITEMS = 100
export const MAX_DEPTH = 3

export const cleanProjects = (raw: unknown): ProjData => {
  const r = isObj(raw) ? raw : {}
  const projects = list(r.projects)
    .map(p => {
      const items = list(p.items)
        .map(i => ({ id: Math.max(1, Math.floor(num(i.id))), text: clip(str(i.text), 100), done: i.done === true, parent: Math.max(0, Math.floor(num(i.parent))) }))
        .filter(i => i.text !== '')
        .slice(0, MAX_ITEMS)
      const ids = new Set(items.map(i => i.id))
      // An item whose parent is gone moves to the top level.
      const fixed = items.map(i => (i.parent === 0 || ids.has(i.parent) ? i : { ...i, parent: 0 }))

      return { name: clip(str(p.name), 40), items: fixed, nextId: Math.max(Math.floor(num(p.nextId, 1)), 1 + Math.max(0, ...fixed.map(i => i.id))) }
    })
    .filter(p => p.name !== '')
    .slice(0, MAX_PROJECTS)
  const current = str(r.current)

  return { projects, current: projects.some(p => p.name === current) ? current : (projects[0]?.name ?? '') }
}

export const childrenOf = (items: Item[], id: number) => items.filter(i => i.parent === id)

export const itemDone = (items: Item[], item: Item, depth = 0): boolean => {
  const kids = childrenOf(items, item.id)

  return kids.length === 0 || depth > 8 ? item.done : kids.every(k => itemDone(items, k, depth + 1))
}

const leavesOf = (items: Item[], id: number, depth = 0): Item[] => {
  const kids = childrenOf(items, id)

  return kids.length === 0 || depth > 8 ? [] : kids.flatMap(k => (childrenOf(items, k.id).length === 0 ? [k] : leavesOf(items, k.id, depth + 1)))
}

/** Done and total leaves under one item, or for the whole project with id 0. */
export const leafStats = (items: Item[], id = 0): { done: number; total: number; percent: number } => {
  const leaves = id === 0 ? items.filter(i => childrenOf(items, i.id).length === 0) : leavesOf(items, id)
  const done = leaves.filter(l => l.done).length

  return { done, total: leaves.length, percent: leaves.length === 0 ? 0 : Math.round((done / leaves.length) * 100) }
}

export const depthOf = (items: Item[], id: number): number => {
  let d = 1
  let cur = items.find(i => i.id === id)

  for (let n = 0; cur !== undefined && cur.parent !== 0 && n < 10; n++) {
    d++
    cur = items.find(i => i.id === cur?.parent)
  }

  return d
}

const descendants = (items: Item[], id: number, depth = 0): number[] =>
  depth > 8 ? [] : childrenOf(items, id).flatMap(k => [k.id, ...descendants(items, k.id, depth + 1)])

/** Checks or unchecks an item; a parent takes all of its children with it. */
export const setItemDone = (items: Item[], id: number, value: boolean): Item[] | undefined => {
  if (!items.some(i => i.id === id)) {
    return undefined
  }
  const ids = new Set([id, ...descendants(items, id)])

  return items.map(i => (ids.has(i.id) ? { ...i, done: value } : i))
}

export const addItem = (p: Project, text: string, parent = 0): { project?: Project; item?: Item; error?: string } => {
  const t = clip(text, 100)

  if (t === '') {
    return { error: 'Say what the item is.' }
  }

  if (parent !== 0 && !p.items.some(i => i.id === parent)) {
    return { error: `No item #${parent} in ${p.name}.` }
  }

  if (parent !== 0 && depthOf(p.items, parent) >= MAX_DEPTH) {
    return { error: `Items nest ${MAX_DEPTH} levels deep at most.` }
  }

  if (p.items.length >= MAX_ITEMS) {
    return { error: `A checklist holds ${MAX_ITEMS} items at most.` }
  }
  const item: Item = { id: p.nextId, text: t, done: false, parent }

  return { project: { ...p, nextId: p.nextId + 1, items: [...p.items, item] }, item }
}

export const removeItem = (items: Item[], id: number): Item[] | undefined => {
  if (!items.some(i => i.id === id)) {
    return undefined
  }
  const gone = new Set([id, ...descendants(items, id)])

  return items.filter(i => !gone.has(i.id))
}

export const projectLines = (p: Project, gl: Glyphs): string[] => {
  const s = leafStats(p.items)
  const out = [`${p.name} ${barOf(s.total === 0 ? 0 : s.done / s.total, 12, gl)} ${s.percent}% (${s.done}/${s.total})`]

  if (p.items.length === 0) {
    out.push('Empty. /pgproj add <text>, /pgproj sub <n> <text>')
  }
  const walk = (parent: number, depth: number) => {
    for (const i of childrenOf(p.items, parent)) {
      const kids = childrenOf(p.items, i.id).length
      const st = kids > 0 ? leafStats(p.items, i.id) : undefined
      out.push(`${'  '.repeat(depth)}${itemDone(p.items, i) ? gl.done : gl.todo} #${i.id} ${i.text}${st === undefined ? '' : `  ${st.done}/${st.total} ${st.percent}%`}`)

      if (depth < MAX_DEPTH) {
        walk(i.id, depth + 1)
      }
    }
  }
  walk(0, 0)

  return out
}

export const projectListLines = (d: ProjData, gl: Glyphs): string[] =>
  d.projects.length === 0
    ? ['No projects. /pgproj new <name>']
    : d.projects.map(p => {
        const s = leafStats(p.items)

        return `${p.name === d.current ? gl.run : ' '} ${p.name} ${barOf(s.total === 0 ? 0 : s.done / s.total, 10, gl)} ${s.percent}% (${s.done}/${s.total})`
      })

// ------------------------------------------------------------------ 111 learning

export type LearnEntry = { at: number; day: string; topic: string }
export type LearnData = { entries: LearnEntry[]; target: number }
export const MAX_LEARN = 200

export const cleanLearn = (raw: unknown): LearnData => {
  const r = isObj(raw) ? raw : {}

  return {
    entries: list(r.entries)
      .map(e => ({ at: num(e.at), day: isDayKey(e.day) ? e.day : '1970-01-01', topic: clip(str(e.topic), 80) }))
      .filter(e => e.topic !== '')
      .slice(-MAX_LEARN),
    target: clamp(Math.floor(num(r.target, 5)), 1, 99),
  }
}

export const learnLines = (d: LearnData, today: string, gl: Glyphs): string[] => {
  const week = new Set(weekDays(today))
  const mine = d.entries.filter(e => week.has(e.day))
  const topics = [...new Set(mine.map(e => e.topic.toLowerCase()))]
  const out = [`Learning ${barOf(mine.length / d.target, 12, gl)} ${mine.length}/${d.target} this week${mine.length >= d.target ? '  target reached' : ''}`]

  for (const e of mine.slice(-8)) {
    out.push(`${gl.done} ${shortDay(e.day)} ${e.topic}`)
  }

  if (mine.length === 0) {
    out.push('Nothing yet this week. /pglearn <topic>')
  } else if (topics.length < mine.length) {
    out.push(`${plural(topics.length, 'different topic')}.`)
  }

  return out
}

// ----------------------------------------------------------------- 113 habits

export const HABITS = ['Write a note', 'Run tests', 'Commit'] as const
export type Habits = Record<string, number>

export const cleanHabits = (raw: unknown, today: string): Habits => {
  const out: Habits = {}

  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (isDayKey(k) && typeof v === 'number' && dayDiff(k, today) <= 60) {
        out[k] = Math.floor(v) & 7
      }
    }
  }

  return out
}

export const setHabit = (h: Habits, day: string, index: number, on: boolean): Habits => {
  const bit = 1 << index
  const cur = h[day] ?? 0

  return { ...h, [day]: on ? cur | bit : cur & ~bit }
}

export const habitOn = (h: Habits, day: string, index: number): boolean => ((h[day] ?? 0) & (1 << index)) !== 0

export const habitLines = (h: Habits, today: string, gl: Glyphs): string[] => {
  const days = weekDays(today)
  const out = [`Habits, week of ${shortDay(days[0] ?? today)}`, `${' '.repeat(17)}${WEEKDAYS.map(w => `${w} `).join('')}`.trimEnd()]

  HABITS.forEach((name, i) => {
    let row = `${i + 1} ${name.padEnd(14)} `
    let n = 0

    for (const k of days) {
      const on = habitOn(h, k, i)
      n += on ? 1 : 0
      row += ` ${dayDiff(k, today) < 0 ? ' ' : on ? gl.on : gl.off}  `
    }
    out.push(`${row.trimEnd()}  ${n}/7`)
  })
  out.push('/pghabit mark <n> or unmark <n> for today. Notes, test runs and commits mark themselves.')

  return out
}

// -------------------------------------------------------------- 114 personal bests

export type Bests = { testMs: number; testAt: number; testSource: 'parsed' | 'measured' | ''; testCmd: string }
export const emptyBests = (): Bests => ({ testMs: 0, testAt: 0, testSource: '', testCmd: '' })

export const cleanBests = (raw: unknown): Bests => {
  const r = isObj(raw) ? raw : {}
  const src = r.testSource === 'parsed' || r.testSource === 'measured' ? r.testSource : ''

  return { testMs: Math.max(0, num(r.testMs)), testAt: num(r.testAt), testSource: src, testCmd: clip(str(r.testCmd), 60) }
}

const toMs = (v: string, unit: string) => Math.round(parseFloat(v) * (unit === 'ms' ? 1 : 1000))

/** The run time a test tool prints (jest, vitest, pytest, unittest, cargo, go, node:test), in ms. */
export const parseTestDuration = (text: string): number | undefined => {
  const pats: [RegExp, (m: RegExpMatchArray) => number][] = [
    [/^\s*Duration\s+([\d.]+)\s*(ms|s)\b/m, m => toMs(m[1] ?? '0', m[2] ?? 's')],
    [/^\s*Time:\s+([\d.]+)\s*(ms|s)\b/m, m => toMs(m[1] ?? '0', m[2] ?? 's')],
    [/\bfinished in\s+([\d.]+)\s*s\b/, m => toMs(m[1] ?? '0', 's')],
    [/\bRan \d+ tests? in\s+([\d.]+)\s*s\b/, m => toMs(m[1] ?? '0', 's')],
    [/\bpassed.*?\bin\s+([\d.]+)\s*s\b/, m => toMs(m[1] ?? '0', 's')],
    [/^# duration_ms\s+([\d.]+)/m, m => toMs(m[1] ?? '0', 'ms')],
    [/^ok\s+\S+\s+([\d.]+)s\b/m, m => toMs(m[1] ?? '0', 's')],
  ]

  for (const [re, f] of pats) {
    const m = text.match(re)

    if (m !== null) {
      const ms = f(m)

      if (Number.isFinite(ms) && ms > 0) {
        return ms
      }
    }
  }

  return undefined
}

/** A new best only when this successful run was faster than the stored one. */
export const updateBestTest = (b: Bests, ms: number, source: 'parsed' | 'measured', now: number, command: string): { bests: Bests; isBest: boolean } =>
  ms > 0 && (b.testMs === 0 || ms < b.testMs)
    ? { bests: { testMs: ms, testAt: now, testSource: source, testCmd: clip(command, 60) }, isBest: true }
    : { bests: b, isBest: false }

export const bestLines = (b: Bests, days: Days, frozen: string[], today: string): string[] => {
  const s = streakInfo(days, frozen, today)
  const big = Object.entries(days).reduce<[string, number]>((m, [k, v]) => (v.tools > m[1] ? [k, v.tools] : m), ['', 0])

  return [
    b.testMs === 0
      ? 'Fastest passing test run: none seen yet'
      : `Fastest passing test run: ${b.testMs < 1000 ? `${b.testMs} ms` : `${(b.testMs / 1000).toFixed(2)} s`} (${b.testSource === 'parsed' ? 'read from the output' : 'measured around the call'}) on ${dayKey(b.testAt)}`,
    `Longest streak: ${plural(s.longest, 'day')}`,
    big[1] === 0 ? 'Biggest day: none yet' : `Biggest day: ${plural(big[1], 'tool call')} on ${big[0]}`,
  ]
}

// ------------------------------------------------------------------- 115 journal

export type JournalEntry = { day: string; text: string }
export const MAX_JOURNAL = 90

export const cleanJournal = (raw: unknown): JournalEntry[] =>
  list(raw)
    .map(e => ({ day: isDayKey(e.day) ? e.day : '', text: clip(str(e.text), 160) }))
    .filter(e => e.day !== '' && e.text !== '')
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-MAX_JOURNAL)

/** One line a day: a second entry the same day replaces the first. */
export const setJournal = (j: JournalEntry[], day: string, text: string): JournalEntry[] => {
  const t = clip(text, 160)

  return t === '' ? j : [...j.filter(e => e.day !== day), { day, text: t }].sort((a, b) => a.day.localeCompare(b.day)).slice(-MAX_JOURNAL)
}

export const journalLines = (j: JournalEntry[], today: string, max = 10): string[] => {
  if (j.length === 0) {
    return ['Journal is empty. /pgjournal <one line about today>']
  }
  const out: string[] = []
  const recent = j.slice(-max).reverse()
  let prev = ''

  for (const e of recent) {
    if (prev !== '') {
      const gap = dayDiff(e.day, prev) - 1
      out.push(gap > 0 ? `│  ${plural(gap, 'quiet day')}` : '│')
    }
    out.push(`● ${shortDay(e.day)} ${WEEKDAYS[dowOf(e.day)]}  ${e.text}`)
    prev = e.day
  }

  if (j.length > max) {
    out.push(`… ${j.length - max} older`)
  }

  return out
}

// ---------------------------------------------------------------- 116 splitter

export const splitPrompt = (goal: string): string =>
  `Split this goal into three concrete steps. For each step give a one-line check I can run or look at to confirm it is done (a command, a test, or something visible). Keep every step small enough for one sitting.\n\nGoal: ${clip(goal, 300)}`

// ------------------------------------------------------------------- 120 backlog

export type BacklogItem = { id: number; text: string; done: boolean; day: string }
export type BacklogData = { items: BacklogItem[]; nextId: number }
export const MAX_BACKLOG = 100

export const cleanBacklog = (raw: unknown): BacklogData => {
  const r = isObj(raw) ? raw : {}
  const items = list(r.items)
    .map(i => ({ id: Math.max(1, Math.floor(num(i.id))), text: clip(str(i.text), 120), done: i.done === true, day: isDayKey(i.day) ? i.day : '1970-01-01' }))
    .filter(i => i.text !== '')
    .slice(-MAX_BACKLOG)

  return { items, nextId: Math.max(Math.floor(num(r.nextId, 1)), 1 + Math.max(0, ...items.map(i => i.id))) }
}

export const backlogOpen = (d: BacklogData) => d.items.filter(i => !i.done).length

export const addBacklog = (d: BacklogData, text: string, today: string): { data: BacklogData; item?: BacklogItem } => {
  const t = clip(text, 120)

  if (t === '') {
    return { data: d }
  }
  const item = { id: d.nextId, text: t, done: false, day: today }
  let items = [...d.items, item]

  while (items.length > MAX_BACKLOG) {
    const i = items.findIndex(x => x.done)
    items = i >= 0 ? [...items.slice(0, i), ...items.slice(i + 1)] : items.slice(1)
  }

  return { data: { items, nextId: d.nextId + 1 }, item }
}

export const backlogLines = (d: BacklogData, gl: Glyphs, max = 12): string[] => {
  const open = d.items.filter(i => !i.done)
  const out = [`Backlog: ${open.length} open, ${d.items.length - open.length} done`]

  for (const i of open.slice(0, max)) {
    out.push(`${gl.todo} #${i.id} ${i.text}`)
  }

  if (open.length > max) {
    out.push(`… ${open.length - max} more`)
  }

  if (open.length === 0) {
    out.push('Nothing waiting. /pgbacklog add <text>')
  }

  return out
}

// -------------------------------------------------------- 118 focus, 119 momentum

export type FocusEvent = { at: number; dir: string }
export type Live = { events: FocusEvent[]; hours: Record<string, number> }
export const FOCUS_WINDOW_MS = 2 * HOUR_MS
export const MAX_FOCUS = 300
export const KEEP_HOURS = 7 * 24

export const dirOf = (path: string): string => {
  const d = path.replace(/\/+$/, '').replace(/\/[^/]*$/, '')

  return d === '' ? '/' : d.slice(-120)
}

export const cleanLive = (raw: unknown, now: number): Live => {
  const r = isObj(raw) ? raw : {}
  const hours: Record<string, number> = {}

  if (isObj(r.hours)) {
    for (const [k, v] of Object.entries(r.hours)) {
      if (/^\d{4}-\d{2}-\d{2} \d{2}$/.test(k) && typeof v === 'number' && v > 0 && dayDiff(k.slice(0, 10), dayKey(now)) <= 7) {
        hours[k] = v
      }
    }
  }

  return {
    events: list(r.events)
      .map(e => ({ at: num(e.at), dir: clip(str(e.dir), 120) }))
      .filter(e => e.dir !== '' && now - e.at <= FOCUS_WINDOW_MS && e.at <= now + MINUTE)
      .slice(-MAX_FOCUS),
    hours,
  }
}

export const addLive = (live: Live, now: number, path: string): Live => {
  const hk = hourKey(now)
  const hours = { ...live.hours, [hk]: (live.hours[hk] ?? 0) + 1 }
  const keys = Object.keys(hours).sort()

  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_HOURS))) {
    delete hours[k]
  }
  const events = path === '' ? live.events : [...live.events, { at: now, dir: dirOf(path) }]

  return { events: events.filter(e => now - e.at <= FOCUS_WINDOW_MS).slice(-MAX_FOCUS), hours }
}

export const focusScore = (events: FocusEvent[], now: number): { score?: number; dir: string; count: number; total: number } => {
  const recent = events.filter(e => now - e.at <= FOCUS_WINDOW_MS)
  const counts = new Map<string, number>()

  for (const e of recent) {
    counts.set(e.dir, (counts.get(e.dir) ?? 0) + 1)
  }
  let dir = ''
  let count = 0

  for (const [d, n] of counts) {
    if (n > count || (n === count && d < dir)) {
      dir = d
      count = n
    }
  }

  return { score: recent.length >= 3 ? Math.round((count / recent.length) * 100) : undefined, dir, count, total: recent.length }
}

export const focusLines = (events: FocusEvent[], now: number, gl: Glyphs): string[] => {
  const f = focusScore(events, now)

  if (f.score === undefined) {
    return [`Focus score: needs at least 3 file calls in the last 2 hours (${f.total} so far)`]
  }

  return [
    `Focus score ${f.score}% ${barOf(f.score / 100, 12, gl)}`,
    `${f.count} of ${plural(f.total, 'file call')} in the last 2 hours were in ${f.dir}`,
  ]
}

export const momentum = (hours: Record<string, number>, now: number): { current: number; average?: number; ratio?: number; samples: number } => {
  const here = hourKey(now)
  const current = hours[here] ?? 0
  const others = Object.entries(hours).filter(([k, v]) => k !== here && v > 0)
  const samples = others.length

  if (samples < 3) {
    return { current, samples }
  }
  const average = others.reduce((s, [, v]) => s + v, 0) / samples

  return { current, average, ratio: current / average, samples }
}

export const momentumLines = (hours: Record<string, number>, now: number, gl: Glyphs): string[] => {
  const m = momentum(hours, now)

  if (m.average === undefined || m.ratio === undefined) {
    return [`Momentum: ${plural(m.current, 'tool call')} this hour; an hourly average needs 3 earlier active hours (${m.samples} so far)`]
  }
  const pct = Math.round(m.ratio * 100)

  return [
    `Momentum ${pct}% ${barOf(m.ratio / 2, 12, gl)} ${m.ratio >= 1.4 ? 'hot' : m.ratio < 0.6 ? 'slow' : 'steady'}`,
    `${plural(m.current, 'tool call')} this hour against ${m.average.toFixed(1)} on an average active hour (${m.samples} hours)`,
  ]
}

// ----------------------------------------------------------------- 121 ship log

export type Ship = { at: number; kind: 'commit' | 'merge' | 'tag'; text: string; ref: string }
export const MAX_SHIPS = 200

export const cleanShips = (raw: unknown): Ship[] =>
  list(raw)
    .map(s => ({ at: num(s.at), kind: (s.kind === 'merge' || s.kind === 'tag' ? s.kind : 'commit') as Ship['kind'], text: clip(str(s.text), 100), ref: clip(str(s.ref), 40) }))
    .filter(s => s.text !== '')
    .slice(-MAX_SHIPS)

const flagValue = (tokens: string[], names: string[]): string => {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? ''

    if (names.includes(t)) {
      return tokens[i + 1] ?? ''
    }
    const eq = names.map(n => `${n}=`).find(p => t.startsWith(p))

    if (eq !== undefined) {
      return t.slice(eq.length)
    }
  }

  return ''
}

/** The commits, merges and tags a successful Bash call made, read from its command and output. */
export const parseShips = (command: string, output: string, isError: boolean, now: number): Ship[] => {
  if (isError) {
    return []
  }
  const out: Ship[] = []

  for (const seg of segmentsOf(command)) {
    const t = bareTokens(seg)

    if (baseName(t[0] ?? '') !== 'git') {
      continue
    }
    const sub = gitSub(t)
    const rest = t.slice(t.indexOf(sub) + 1)

    if (sub === 'commit' && !out.some(s => s.kind === 'commit')) {
      const m = output.match(/^\[([^\]\n]*?)\s([0-9a-f]{7,40})\]\s+(.+)$/m)

      if (m !== null) {
        out.push({ at: now, kind: 'commit', text: clip(m[3] ?? '', 100), ref: m[2]?.slice(0, 10) ?? '' })
      }
    } else if (sub === 'merge') {
      const branch = rest.find(x => !x.startsWith('-')) ?? ''

      if (/Merge made by|Fast-forward|^Updating [0-9a-f]+\.\.[0-9a-f]+/m.test(output) && branch !== '') {
        const msg = flagValue(rest, ['-m', '--message'])
        out.push({ at: now, kind: 'merge', text: clip(msg || `Merge ${branch}`, 100), ref: clip(branch, 40) })
      }
    } else if (sub === 'tag') {
      const bad = rest.some(x => /^(-l|--list|-d|--delete|-v|--verify|-n\d*|--contains|--points-at|--sort.*|--merged|--no-merged)$/.test(x))
      const valueFlags = new Set(['-m', '-F', '-u', '-s', '-f', '--message', '--file'])
      let name = ''

      for (let i = 0; i < rest.length; i++) {
        const x = rest[i] ?? ''

        if (valueFlags.has(x)) {
          i++
        } else if (!x.startsWith('-')) {
          name = x
          break
        }
      }

      if (!bad && name !== '') {
        const msg = flagValue(rest, ['-m', '--message'])
        out.push({ at: now, kind: 'tag', text: clip(msg || name, 100), ref: clip(name, 40) })
      }
    }
  }

  return out
}

export const shipLines = (ships: Ship[], max = 12): string[] => {
  if (ships.length === 0) {
    return ['Ship log is empty. Commits, merges and tags made through Bash show up here.']
  }
  const counts = { commit: 0, merge: 0, tag: 0 }
  ships.forEach(s => counts[s.kind]++)
  const out = [`Shipped: ${plural(counts.commit, 'commit')}, ${plural(counts.merge, 'merge')}, ${plural(counts.tag, 'tag')} (newest first)`]

  for (const s of ships.slice(-max).reverse()) {
    const d = new Date(s.at)
    out.push(`${s.kind.padEnd(6)} ${dayKey(s.at).slice(5)} ${pad2(d.getHours())}:${pad2(d.getMinutes())} ${s.ref === '' || s.kind === 'tag' ? '' : `${s.ref} `}${s.text}`)
  }

  return out
}

// ------------------------------------------------------------- 122 metrics

export type Point = { at: number; v: number }
export type Metrics = { passed: Point[]; failed: Point[]; coverage: Point[] }
export const MAX_POINTS = 60

const cleanPoints = (raw: unknown): Point[] =>
  list(raw)
    .map(p => ({ at: num(p.at), v: num(p.v, NaN) }))
    .filter(p => Number.isFinite(p.v) && p.v >= 0)
    .slice(-MAX_POINTS)

export const cleanMetrics = (raw: unknown): Metrics => {
  const r = isObj(raw) ? raw : {}

  return { passed: cleanPoints(r.passed), failed: cleanPoints(r.failed), coverage: cleanPoints(r.coverage) }
}

/** Test counts from the last summary line of a test run (jest, vitest, pytest, cargo, node:test). */
export const parseTestCounts = (text: string): { passed: number; failed: number } | undefined => {
  const lines = text.split('\n')
  let hit = ''

  for (const l of lines) {
    if (/\b\d+ passed\b/i.test(l)) {
      hit = l
    }
  }

  if (hit !== '') {
    return { passed: parseInt(hit.match(/(\d+) passed/i)?.[1] ?? '0', 10), failed: parseInt(hit.match(/(\d+) failed/i)?.[1] ?? '0', 10) }
  }
  const pass = text.match(/^# pass (\d+)/m)

  if (pass !== null) {
    return { passed: parseInt(pass[1] ?? '0', 10), failed: parseInt(text.match(/^# fail (\d+)/m)?.[1] ?? '0', 10) }
  }

  return undefined
}

/** A total coverage percent from istanbul/nyc, coverage.py, jest, go or tarpaulin output. */
export const parseCoverage = (text: string): number | undefined => {
  const pats = [
    /All files\s*\|\s*([\d.]+)/,
    /^TOTAL\s+.*?(\d+(?:\.\d+)?)%\s*$/m,
    /Statements\s*:\s*([\d.]+)%/,
    /coverage:\s*([\d.]+)% of statements/,
    /([\d.]+)%\s+coverage/,
  ]

  for (const re of pats) {
    const v = parseFloat(text.match(re)?.[1] ?? '')

    if (Number.isFinite(v) && v >= 0 && v <= 100) {
      return v
    }
  }

  return undefined
}

const push = (pts: Point[], at: number, v: number): Point[] => [...pts, { at, v }].slice(-MAX_POINTS)

export const recordMetrics = (m: Metrics, text: string, now: number, isTestRun: boolean): Metrics => {
  const counts = isTestRun ? parseTestCounts(text) : undefined
  const cov = isTestRun || /cover/i.test(text.slice(0, 4000)) ? parseCoverage(text) : undefined

  return {
    passed: counts === undefined ? m.passed : push(m.passed, now, counts.passed),
    failed: counts === undefined ? m.failed : push(m.failed, now, counts.failed),
    coverage: cov === undefined ? m.coverage : push(m.coverage, now, cov),
  }
}

export const metricsLines = (m: Metrics): string[] => {
  const row = (label: string, pts: Point[], unit: string) => {
    if (pts.length === 0) {
      return `${label.padEnd(9)} no data yet`
    }
    const first = pts[0]!.v
    const last = pts[pts.length - 1]!.v
    const d = last - first

    return `${label.padEnd(9)} ${sparkline(pts.slice(-24).map(p => p.v))}  ${first}${unit} to ${last}${unit} (${d >= 0 ? '+' : ''}${Math.round(d * 10) / 10}${unit}, ${plural(pts.length, 'run')})`
  }

  return [row('Passed', m.passed, ''), row('Failed', m.failed, ''), row('Coverage', m.coverage, '%'), 'Read from test output as it scrolls past. Last 60 points each.']
}

// ------------------------------------------------------------------ meta

export type Meta = { totals: Totals; archive: XpArchive; frozen: string[]; level: number; lastToastAt: number }

export const cleanMeta = (raw: unknown, today: string): Meta => {
  const r = isObj(raw) ? raw : {}
  const t = isObj(r.totals) ? r.totals : {}
  const totals = { tools: Math.max(0, Math.floor(num(t.tools))), sessions: Math.max(0, Math.floor(num(t.sessions))) }

  return {
    totals,
    archive: cleanArchive(r.archive),
    frozen: cleanFrozen(r.frozen, today),
    level: Math.max(0, Math.floor(num(r.level))),
    lastToastAt: num(r.lastToastAt),
  }
}

export const levelToast = (level: number): string => `Level up: ${LEVELS[level]?.name ?? ''}. ${nextLevelText({ tools: LEVELS[level]?.tools ?? 0, sessions: LEVELS[level]?.sessions ?? 0 })}`

export const TOAST_GAP_MS = 3 * MINUTE
export const canToast = (now: number, last: number): boolean => now - last >= TOAST_GAP_MS

// ------------------------------------------------------------------ help

export const COMMANDS = [
  ['pg', 'List every progress command'],
  ['pgpane', 'Open the progress pane: /pgpane [goals|level|streak|plans|stats|log|skills]'],
  ['pggoal', 'Goals: add <text>, done <n>, undo <n>, rm <n>, start <n>, stop, target <n>, list'],
  ['pglevel', 'Milestone ladder: your level and the distance to the next'],
  ['pgxp', 'XP for good habits: tests +2, commit +3, note +1, goal done +5'],
  ['pgfreeze', 'Streak calendar; spend this week\'s one freeze day: /pgfreeze [yesterday]'],
  ['pgproj', 'Checklists: new, use, add, sub <n> <text>, check, uncheck, rm, drop, list'],
  ['pglearn', 'Learning log: /pglearn <topic>, /pglearn target <n>'],
  ['pgtree', 'Skill tree unlocked by the tools and commands you have used'],
  ['pghabit', 'Habit grid: /pghabit, /pghabit mark|unmark <n>'],
  ['pgbest', 'Personal bests: fastest passing test run, longest streak, biggest day'],
  ['pgjournal', 'One line a day: /pgjournal <text>, or /pgjournal to see the timeline'],
  ['pgsplit', 'Fill the prompt asking for three steps with checks: /pgsplit <goal>'],
  ['pgfocus', 'Focus score of the last 2 hours'],
  ['pgmomentum', 'This hour against your hourly average'],
  ['pgbacklog', 'Backlog: add <text>, done <n>, rm <n>, clear, list'],
  ['pgship', 'Ship log of commits, merges and tags seen in Bash results'],
  ['pgmetrics', 'Test counts and coverage over time, with sparklines'],
  ['pgreset', 'Clear everything this mod recorded: /pgreset yes'],
] as const

export const helpLines = (): string[] => COMMANDS.map(([n, d]) => `/${n}  ${d}`)

export const TABS = ['goals', 'level', 'streak', 'plans', 'stats', 'log', 'skills'] as const
export type Tab = (typeof TABS)[number]
export const tabOf = (word: string): Tab | undefined => TABS.find(t => t === word.trim().toLowerCase())
