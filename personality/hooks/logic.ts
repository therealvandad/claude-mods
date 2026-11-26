// Pure helpers for the personality mod: no `$`, no clock reads, so every rule
// here is tested directly with plain values.

export type DayStats = {
  sessions: number
  tools: number
  errors: number
  edits: number
  fileCount: number
  files: string[]
  toolCounts: Record<string, number>
}
export type Days = Record<string, DayStats>

export const emptyDay = (): DayStats => ({
  sessions: 0,
  tools: 0,
  errors: 0,
  edits: 0,
  fileCount: 0,
  files: [],
  toolCounts: {},
})

const MINUTE = 60_000
const DAY_MS = 24 * 60 * MINUTE
const pad2 = (n: number) => String(n).padStart(2, '0')

// ---------------------------------------------------------------- calendar

/** Local calendar day of a timestamp, as YYYY-MM-DD. */
export const dayKey = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const utcOf = (key: string): number => {
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)

  return Date.UTC(y, m - 1, d)
}

/** The day key `n` calendar days from `key` (negative for earlier). */
export const shiftDay = (key: string, n: number): string => {
  const d = new Date(utcOf(key) + n * DAY_MS)

  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

export const dayDiff = (a: string, b: string): number => Math.round((utcOf(b) - utcOf(a)) / DAY_MS)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export const weekdayOf = (key: string): string => WEEKDAYS[new Date(utcOf(key)).getUTCDay()] ?? ''

export const monthDay = (key: string): string => {
  const [, m = 1, d = 1] = key.split('-').map(Number)

  return `${MONTHS[m - 1] ?? ''} ${d}`
}

/** "Nov 25 14:02" in local time. */
export const stamp = (ms: number): string => {
  const d = new Date(ms)

  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export const hourOf = (ms: number): number => new Date(ms).getHours()

// -------------------------------------------------------------------- bars

/** A block-character bar: `frac` of `width` cells filled. */
export const bar = (frac: number, width = 12): string => {
  const n = Math.round(Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)) * width)

  return '█'.repeat(n).padEnd(width, '░')
}

// -------------------------------------------------------------------- mood

export type ToolEvent = { at: number; ok: boolean; tool: string; detail: string; isEdit: boolean }
export type Mood = 'cruising' | 'digging in' | 'stuck' | 'wrapping up'

export const MOOD_WINDOW_MS = 5 * MINUTE
export const IDLE_MS = 3 * MINUTE
const RATE_WINDOW_MS = 2 * MINUTE

export const MOOD_GLYPH: Record<Mood, string> = {
  cruising: '≈',
  'digging in': '◒',
  stuck: '✕',
  'wrapping up': '✓',
}

const WRAP_UP =
  /\bgit\s+(commit|push|status|diff|log)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint)\b|\bpytest\b|\bcargo\s+(test|build)\b|\bgo\s+test\b|\bmake\s+test\b|\bvitest\b|\bjest\b/

export const isWrapUp = (e: ToolEvent): boolean => e.tool === 'Bash' && WRAP_UP.test(e.detail)

/**
 * The mood of the session from its recent tool calls, or null when there is
 * nothing to say (idle for 3 minutes, or fewer than 3 calls in 5 minutes).
 */
export const moodOf = (events: readonly ToolEvent[], now: number): Mood | null => {
  const recent = events.filter(e => now - e.at <= MOOD_WINDOW_MS && e.at <= now)
  const last = recent[recent.length - 1]

  if (last === undefined || now - last.at > IDLE_MS || recent.length < 3) {
    return null
  }
  const errors = recent.filter(e => !e.ok).length
  const ratio = errors / recent.length
  let trailing = 0

  for (let i = recent.length - 1; i >= 0 && !recent[i]?.ok; i--) {
    trailing++
  }

  if (trailing >= 3 || (recent.length >= 5 && ratio >= 0.4)) {
    return 'stuck'
  }

  if (isWrapUp(last) && recent.slice(0, -1).some(e => e.isEdit)) {
    return 'wrapping up'
  }
  const rate = recent.filter(e => now - e.at <= RATE_WINDOW_MS).length

  if (rate >= 6 && ratio < 0.2) {
    return 'cruising'
  }

  return 'digging in'
}

export const statusText = (mood: Mood): string => `${MOOD_GLYPH[mood]} ${mood}`

export type StatusMemo = { text: string | undefined; at: number }

/**
 * What to do with the shared status line: clear it when the mood goes quiet,
 * set it only when the words change and at most every 15 seconds.
 */
export const statusPlan = (
  prev: StatusMemo,
  next: string | undefined,
  now: number,
  gapMs = 15_000,
): 'set' | 'clear' | 'skip' => {
  if (next === undefined) {
    return prev.text === undefined ? 'skip' : 'clear'
  }

  if (next === prev.text || now - prev.at < gapMs) {
    return 'skip'
  }

  return 'set'
}

// ------------------------------------------------------------------ streak

export const qualifies = (d: DayStats | undefined): boolean => d !== undefined && d.edits > 0

/**
 * Days in a row with at least one file edit. The run may end today or
 * yesterday (today is still to come); `best` is the longest run on record.
 */
export const streakOf = (days: Days, today: string): { current: number; best: number; isTodayDone: boolean } => {
  const isTodayDone = qualifies(days[today])
  let cursor = isTodayDone ? today : shiftDay(today, -1)
  let current = 0

  while (qualifies(days[cursor])) {
    current++
    cursor = shiftDay(cursor, -1)
  }
  const keys = Object.keys(days)
    .filter(k => qualifies(days[k]))
    .sort()
  let best = 0
  let run = 0
  let prev: string | undefined

  for (const k of keys) {
    run = prev !== undefined && dayDiff(prev, k) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = k
  }

  return { current, best: Math.max(best, current), isTodayDone }
}

/** One cell per day for the last `n` days, oldest first. */
export const streakStrip = (days: Days, today: string, n = 14): string => {
  let out = ''

  for (let i = n - 1; i >= 0; i--) {
    out += qualifies(days[shiftDay(today, -i)]) ? '■' : '□'
  }

  return out
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const streakText = (days: Days, today: string, best: number): string => {
  const s = streakOf(days, today)
  const top = Math.max(best, s.best)
  const lines = [`Streak: ${plural(s.current, 'day')} (best ${top}).`, streakStrip(days, today)]

  if (s.current === 0) {
    lines.push('Edit a file today to start one.')
  } else if (!s.isTodayDone) {
    lines.push('Edit a file today to keep it going.')
  } else {
    lines.push('Today is counted.')
  }

  return lines.join('\n')
}

// ------------------------------------------------------------ achievements

export type BadgeCtx = {
  days: Days
  today: string
  lifetimeTools: number
  sessionFiles: number
  hour: number
  sprintsDone: number
}
export type Badge = { id: string; name: string; hint: string; test: (c: BadgeCtx) => boolean }

const streakAtLeast = (n: number) => (c: BadgeCtx) => streakOf(c.days, c.today).current >= n

export const BADGES: readonly Badge[] = [
  { id: 'tools-100', name: 'First 100 tool calls', hint: '100 tool calls in total', test: c => c.lifetimeTools >= 100 },
  { id: 'tools-1000', name: '1,000 tool calls', hint: '1,000 tool calls in total', test: c => c.lifetimeTools >= 1000 },
  {
    id: 'zero-error-day',
    name: 'Zero-error day',
    hint: '20 or more tool calls in a day, none failing',
    test: c => {
      const d = c.days[c.today]

      return d !== undefined && d.tools >= 20 && d.errors === 0
    },
  },
  { id: 'ten-files', name: 'Ten files in a session', hint: 'edit 10 different files in one session', test: c => c.sessionFiles >= 10 },
  { id: 'busy-day', name: 'Busy day', hint: '200 tool calls in a single day', test: c => (c.days[c.today]?.tools ?? 0) >= 200 },
  { id: 'night-owl', name: 'Night owl', hint: 'a tool call between midnight and 5 a.m.', test: c => c.hour >= 0 && c.hour < 5 },
  { id: 'early-bird', name: 'Early bird', hint: 'a tool call between 5 and 7 a.m.', test: c => c.hour >= 5 && c.hour < 7 },
  { id: 'streak-3', name: 'Three in a row', hint: 'a 3-day edit streak', test: streakAtLeast(3) },
  { id: 'streak-7', name: 'A full week', hint: 'a 7-day edit streak', test: streakAtLeast(7) },
  { id: 'streak-30', name: 'Thirty days', hint: 'a 30-day edit streak', test: streakAtLeast(30) },
  { id: 'sprint-1', name: 'First sprint', hint: 'finish a focus sprint', test: c => c.sprintsDone >= 1 },
  { id: 'sprint-5', name: 'Sprint habit', hint: 'finish 5 focus sprints', test: c => c.sprintsDone >= 5 },
]

/** The badges whose test passes now and that are not unlocked yet. */
export const newBadges = (ctx: BadgeCtx, unlocked: Record<string, number>): Badge[] =>
  BADGES.filter(b => unlocked[b.id] === undefined && b.test(ctx))

export const badgesText = (unlocked: Record<string, number>): string => {
  const got = BADGES.filter(b => unlocked[b.id] !== undefined)
  const lines = [`Badges: ${got.length} of ${BADGES.length}`]

  for (const b of BADGES) {
    const at = unlocked[b.id]
    lines.push(at !== undefined ? `  ★ ${b.name}  (${stamp(at)})` : `  ☆ ${b.name}  -  ${b.hint}`)
  }

  return lines.join('\n')
}

// ------------------------------------------------------------------ weekly

export type WeekRow = {
  day: string
  label: string
  sessions: number
  tools: number
  errors: number
  edits: number
  files: number
}
export type Week = {
  from: string
  to: string
  rows: WeekRow[]
  totals: { sessions: number; tools: number; errors: number; edits: number; files: number }
  topTools: [string, number][]
  busiest: WeekRow | undefined
}

/** The last `n` days ending today, from the daily stats this mod recorded. */
export const weekOf = (days: Days, today: string, n = 7, top = 5): Week => {
  const rows: WeekRow[] = []
  const tools = new Map<string, number>()

  for (let i = n - 1; i >= 0; i--) {
    const day = shiftDay(today, -i)
    const d = days[day]
    rows.push({
      day,
      label: weekdayOf(day),
      sessions: d?.sessions ?? 0,
      tools: d?.tools ?? 0,
      errors: d?.errors ?? 0,
      edits: d?.edits ?? 0,
      files: d?.fileCount ?? 0,
    })

    for (const [tool, count] of Object.entries(d?.toolCounts ?? {})) {
      tools.set(tool, (tools.get(tool) ?? 0) + count)
    }
  }
  const sum = (pick: (r: WeekRow) => number) => rows.reduce((a, r) => a + pick(r), 0)
  const busiest = rows.reduce<WeekRow | undefined>((a, r) => (r.tools > (a?.tools ?? 0) ? r : a), undefined)

  return {
    from: rows[0]?.day ?? today,
    to: today,
    rows,
    totals: {
      sessions: sum(r => r.sessions),
      tools: sum(r => r.tools),
      errors: sum(r => r.errors),
      edits: sum(r => r.edits),
      files: sum(r => r.files),
    },
    topTools: [...tools.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top),
    busiest,
  }
}

export const weeklyText = (week: Week, days: Days, best: number): string => {
  const s = streakOf(days, week.to)
  const maxDay = Math.max(1, ...week.rows.map(r => r.tools))
  const maxTool = Math.max(1, ...week.topTools.map(([, n]) => n))
  const t = week.totals
  const lines = [
    `Weekly report, ${monthDay(week.from)} to ${monthDay(week.to)}`,
    `${plural(t.sessions, 'session')} · ${plural(t.tools, 'tool call')} · ${plural(t.files, 'file')} edited · ${plural(t.errors, 'error')}`,
    `Streak: ${plural(s.current, 'day')} (best ${Math.max(best, s.best)})`,
    '',
    'Tool calls per day',
    ...week.rows.map(r => `${r.label} ${bar(r.tools / maxDay)} ${String(r.tools).padStart(4)}  ${r.sessions} sess`),
    '',
    'Top tools',
    ...(week.topTools.length === 0
      ? ['(none recorded yet)']
      : week.topTools.map(([tool, n]) => `${tool.slice(0, 12).padEnd(12)} ${bar(n / maxTool, 10)} ${n}`)),
  ]

  return lines.join('\n')
}

// ----------------------------------------------------------------- greeting

export const partOfDay = (hour: number): string =>
  hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : hour >= 17 && hour < 22 ? 'Good evening' : 'Still up'

export const greetingText = (hour: number, days: Days, today: string): string => {
  const hello = partOfDay(hour) === 'Still up' ? 'Late one' : partOfDay(hour)
  const y = days[shiftDay(today, -1)]
  const parts = [`${hello}.`]

  if (y !== undefined && (y.sessions > 0 || y.tools > 0)) {
    parts.push(`Yesterday: ${plural(y.sessions, 'session')}, ${plural(y.tools, 'tool call')}.`)
  }
  const s = streakOf(days, today)

  if (s.current >= 2) {
    parts.push(`Streak: ${s.current} days.`)
  }

  return parts.join(' ')
}

// -------------------------------------------------------------------- toasts

export type Pending = {
  kind: 'greeting' | 'sprint' | 'badge' | 'tip'
  text: string
  priority: number
  at: number
  ttlMs: number
  names?: string[]
}

/** The mod raises at most one toast per this long. */
export const TOAST_GAP_MS = 5 * MINUTE

export const canToast = (now: number, lastAt: number): boolean => lastAt <= 0 || now < lastAt - 60_000 || now - lastAt >= TOAST_GAP_MS

export const badgeToastText = (names: readonly string[]): string =>
  names.length === 1 ? `Badge unlocked: ${names[0]}` : `Badges unlocked: ${names.join(', ')}`

/** Adds a toast to the queue; badge toasts join into one. */
export const enqueue = (queue: readonly Pending[], item: Pending): Pending[] => {
  if (item.kind === 'badge') {
    const have = queue.find(q => q.kind === 'badge')
    const names = [...(have?.names ?? []), ...(item.names ?? [])]
    const merged: Pending = { ...item, names, text: badgeToastText(names) }

    return [...queue.filter(q => q.kind !== 'badge'), merged]
  }

  return [...queue.filter(q => q.kind !== item.kind), item]
}

/**
 * The one toast to show now (highest priority, oldest first), if the gap since
 * the last has passed; stale items are dropped. `waitMs` is how long until the
 * gate opens when something is still waiting.
 */
export const pickToast = (
  queue: readonly Pending[],
  now: number,
  lastAt: number,
): { toast: Pending | undefined; rest: Pending[]; waitMs: number } => {
  const live = queue.filter(q => now - q.at <= q.ttlMs)
  const order = [...live].sort((a, b) => b.priority - a.priority || a.at - b.at)
  const first = order[0]

  if (first === undefined) {
    return { toast: undefined, rest: [], waitMs: 0 }
  }

  if (!canToast(now, lastAt)) {
    return { toast: undefined, rest: live, waitMs: Math.max(1000, lastAt + TOAST_GAP_MS - now) }
  }
  const rest = live.filter(q => q !== first)

  return { toast: first, rest, waitMs: rest.length > 0 ? TOAST_GAP_MS : 0 }
}

// -------------------------------------------------------------------- sprint

export const CHEERS = [
  'Sprint done. Nicely focused.',
  'Time. That was a solid stretch.',
  'Done, and well earned.',
  'Sprint complete. Stretch your legs.',
  'That is a wrap on this one.',
  'Good run. Take a breath.',
  'Finished. Small steps add up.',
  'Bell rings: you did the thing.',
] as const

export type SprintState = { startedAt: number; endsAt: number; minutes: number; goal: string; files: string[]; tools: number }
export type SprintRecord = {
  goal: string
  minutes: number
  startedAt: number
  endedAt: number
  files: string[]
  tools: number
  isDone: boolean
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export const filesLine = (files: readonly string[], max = 4): string => {
  if (files.length === 0) {
    return 'No files changed.'
  }
  const names = files.slice(0, max).map(base)
  const more = files.length > max ? ` +${files.length - max} more` : ''

  return `Changed: ${names.join(', ')}${more}.`
}

export const sprintToast = (s: SprintRecord, cheerIndex: number): string =>
  `${CHEERS[Math.abs(cheerIndex) % CHEERS.length]} ${s.minutes} min on "${s.goal.slice(0, 60)}". ${filesLine(s.files)}`

export const parseSprint = (args: string): { minutes: number; goal: string } | undefined => {
  const m = /^\s*(\d+(?:\.\d+)?)\s+(\S[\s\S]*)$/.exec(args)

  if (m === null) {
    return undefined
  }
  const minutes = Number(m[1])

  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
    return undefined
  }

  return { minutes, goal: (m[2] ?? '').trim().replace(/\s+/g, ' ') }
}

export const sprintLogText = (log: readonly SprintRecord[], max = 10): string => {
  if (log.length === 0) {
    return 'No sprints yet. Try /sprint 25 what you will do'
  }
  const done = log.filter(s => s.isDone)
  const minutes = done.reduce((a, s) => a + s.minutes, 0)

  return [
    `Sprints: ${done.length} finished, ${minutes} min focused`,
    ...log
      .slice(-max)
      .reverse()
      .map(s => `  ${s.isDone ? '✓' : '·'} ${stamp(s.startedAt)}  ${s.minutes} min  ${s.goal.slice(0, 50)}  (${plural(s.files.length, 'file')})`),
  ].join('\n')
}

// ---------------------------------------------------------------------- pet

export type PetState = 'idle' | 'working' | 'happy' | 'sleepy'
export const SLEEP_MS = 5 * MINUTE
export const TICK_MS = 500

export const petStateOf = (p: { now: number; lastAt: number; running: number; happyUntil: number }): PetState => {
  if (p.running > 0) {
    return 'working'
  }

  if (p.now < p.happyUntil) {
    return 'happy'
  }

  return p.lastAt > 0 && p.now - p.lastAt >= SLEEP_MS ? 'sleepy' : 'idle'
}

/** The frame index for a time; with motion off the pet holds still on frame 0. */
export const frameOf = (now: number, isMotion: boolean): number => (isMotion ? Math.floor(now / TICK_MS) : 0)

export const petFrame = (state: PetState, frame: number): { lines: string[]; caption: string } => {
  const f = Math.abs(frame)

  if (state === 'working') {
    return {
      lines: ['        ', ' /\\_/\\ ', '( o.o ) ', f % 2 === 0 ? ' /|=|\\  ' : ' \\|=|/  '],
      caption: 'busy paws',
    }
  }

  if (state === 'happy') {
    return {
      lines: [f % 2 === 0 ? '  *   * ' : ' *     *', ' /\\_/\\ ', '( ^.^ ) ', f % 2 === 0 ? ' \\( ^ )/' : ' /( ^ )\\'],
      caption: 'nice one',
    }
  }

  if (state === 'sleepy') {
    return {
      lines: ['        ', ` /\\_/\\   ${['z', 'zz', 'zZ', 'Zz'][f % 4]}`, '( -.- ) ', ' (   )_)'],
      caption: 'zzz',
    }
  }

  return {
    lines: ['        ', ' /\\_/\\ ', f % 8 === 7 ? '( -.- ) ' : '( o.o ) ', ' > ^ <  '],
    caption: 'waiting',
  }
}

// ---------------------------------------------------------------------- tips

export const TIPS: readonly string[] = [
  'Press Esc twice to rewind: jump back to an earlier message and undo what came after it.',
  'Shift+Tab cycles permission modes: ask each time, auto-accept edits, and plan mode.',
  'For anything risky, start in plan mode. Read the plan, correct it, then let Claude edit.',
  'Run /compact with a focus, for example "/compact keep the failing test names", to shrink context on purpose.',
  'Use /clear between unrelated tasks. A fresh context is faster, cheaper and less confused.',
  'Type /context to see what is filling the context window before it fills up.',
  'Type @ and a path to attach a file to your prompt; a folder gives Claude a listing.',
  'Start a prompt with ! to run a shell command yourself and put its output in the conversation.',
  'Run /init once per repository: it drafts a CLAUDE.md with build and test commands for you to trim.',
  'Keep CLAUDE.md short: build and test commands, conventions that are not obvious, and traps. Long files get skimmed.',
  '/memory opens your memory files, so you can fix a wrong assumption at its source.',
  'Press the up arrow to bring back an earlier prompt; Ctrl+R searches your prompt history.',
  'Continue where you left off with "claude --continue", or pick an older conversation with /resume.',
  'Ctrl+O expands the transcript so you can see full tool output instead of the short summary.',
  'Esc stops Claude mid-turn without losing context. Then steer with a one-line correction.',
  'You can type your next message while Claude is still working; it is picked up when the step finishes.',
  'Paste or drag a screenshot into the prompt to show a UI bug instead of describing it.',
  'Use /model to switch models in the middle of a session: a lighter one for simple edits, a stronger one for hard design work.',
  'Give Claude a way to check itself: a failing test, a command with expected output, a screenshot to match.',
  'Ask for the failing test first, then the fix. A red test is a clear definition of done.',
  'Use /permissions to allow the safe commands you keep approving, such as your test runner, and stop the prompts.',
  'Ask Claude to use a subagent for broad searches; the digging stays out of your main context.',
  'Hooks in settings.json can run your formatter or linter after every edit, so style never needs a prompt.',
  'Custom slash commands are markdown files in .claude/commands; put a prompt you repeat in one.',
  '/mcp shows connected MCP servers and lets you sign in to the ones that need it.',
  'Use "claude -p" for scripts: "git diff | claude -p \'review this\'" prints the answer and exits.',
  'Be specific: name the files, the constraint and what "done" looks like. Vague prompts get vague diffs.',
  'End a task with "what did you not verify?" It surfaces the gaps you would otherwise find in production.',
  'Commit before a big change. Small commits make any Claude edit easy to inspect and to revert.',
  'Ctrl+B sends a long-running command to the background so Claude can keep working while it runs.',
  '/doctor checks your installation and settings when something behaves oddly.',
  '/export saves the conversation as text, handy for a handoff or a bug report.',
  '/status shows the version, account and model in use, the first thing to include in a bug report.',
  '/vim turns on vim-style editing in the prompt box if your fingers prefer it.',
  'For a new line in the prompt, use Shift+Enter (run /terminal-setup once) or end the line with a backslash.',
  'Use /add-dir to give a session access to a second folder, such as a sibling library.',
  'Run parallel sessions in separate git worktrees so two Claudes never edit the same files.',
  'On an unfamiliar codebase, ask for an architecture overview first, then ask about the part you will change.',
  'Do not paste huge logs. Tell Claude the command or file and let it read or tail the part that matters.',
  'Mods can add panes, toasts and commands to the app. Try "/sprint 25 write the parser" and keep one focus.',
]

/** A stable tip for a day (its key hashed), so the tip of the day is the same all day. */
export const tipIndexFor = (key: string): number => {
  let h = 0

  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) % 100_003
  }

  return h % TIPS.length
}

// ------------------------------------------------------------- store hygiene

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Reads whatever the store holds back as safe day stats. */
export const cleanDays = (raw: unknown): Days => {
  const out: Days = {}

  if (!isObj(raw)) {
    return out
  }

  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isObj(v)) {
      continue
    }
    const counts: Record<string, number> = {}

    if (isObj(v.toolCounts)) {
      for (const [t, n] of Object.entries(v.toolCounts)) {
        counts[t] = num(n)
      }
    }
    const files = Array.isArray(v.files) ? v.files.filter((f): f is string => typeof f === 'string').slice(0, 100) : []
    out[k] = {
      sessions: num(v.sessions),
      tools: num(v.tools),
      errors: num(v.errors),
      edits: num(v.edits),
      fileCount: Math.max(num(v.fileCount), files.length),
      files,
      toolCounts: counts,
    }
  }

  return out
}

/** Keeps the last `keep` days; only today keeps its file list. */
export const pruneDays = (days: Days, today: string, keep = 60): Days => {
  const out: Days = {}

  for (const [k, d] of Object.entries(days)) {
    const age = dayDiff(k, today)

    if (age < 0 || age >= keep) {
      continue
    }
    out[k] = k === today ? d : { ...d, files: [] }
  }

  return out
}

/** Notes one tool call in a day's stats (mutates the day). */
export const addTool = (d: DayStats, tool: string, ok: boolean, file: string | undefined): void => {
  d.tools++
  d.toolCounts[tool] = (d.toolCounts[tool] ?? 0) + 1

  if (!ok) {
    d.errors++
  }

  if (file !== undefined && file !== '') {
    d.edits++

    if (!d.files.includes(file)) {
      d.fileCount++

      if (d.files.length < 100) {
        d.files.push(file)
      }
    }
  }
}
