import { atom, read, update } from 'claude-code'
import type { Hook, Register, RenderChildren } from 'claude-code'

import type { Cfg, Data, Goal, Intent, Sess } from '../types'
import {
  COMMANDS,
  MAX_GOALS,
  MAX_INTENTS,
  MAX_TEMPLATES,
  MAX_TIPS,
  MAX_WINS,
  RULE_EVENTS,
  STARTER_TEMPLATES,
  TILE_IDS,
  TILE_INFO,
  addPoint,
  addRev,
  addRule,
  bar,
  bashEvent,
  cardText,
  check,
  clip,
  defaultCfg,
  defaultFmt,
  dayKey,
  docsStats,
  emptyData,
  emptySess,
  exportedFns,
  fmtClock,
  fmtMoney,
  fmtSize,
  goalLine,
  grepArgv,
  isSourceFile,
  isTestFile,
  isoWeek,
  keepDays,
  mergeDocs,
  migrationLines,
  moveTile,
  normalizeCfg,
  normalizeData,
  parseGoalAdd,
  parseGrepCounts,
  parseKeep,
  parseOnOff,
  parseOutdated,
  parsePlanItems,
  parseTileList,
  per100,
  pickRule,
  plural,
  pruneData,
  ratingTrend,
  refactorLines,
  revProgress,
  spark,
  splitArgs,
  summarizeUpgrades,
  testDebtNow,
  tileLines,
  todoDelta,
  toastAllowed,
  touchDay,
  trendText,
  upgradeLines,
  validSymbol,
  validatePattern,
  weekTotals,
  weeklyTrend,
  wrapText,
} from './pure'
import type { Ctx, GrepCounts, Outdated } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]
type Input = Record<string, unknown>
type ToolOut = { deny?: string; isError?: boolean; text?: string; result?: unknown }

const PANE = 'progress-more-main'
const MAX_CONTENT = 60_000
const SAVE_GAP_MS = 30_000
const GREP_TIMEOUT_MS = 20_000
const UPGRADE_TIMEOUT_MS = 30_000

const dataA = atom({ plugin: 'progress-more', key: 'data' } as const, emptyData(), { shape: 'data-1' })
const cfgA = atom({ plugin: 'progress-more', key: 'cfg' } as const, defaultCfg(), { shape: 'cfg-1' })
const sessA = atom({ plugin: 'progress-more', key: 'sess' } as const, emptySess(), { shape: 'sess-1' })
const tabA = atom({ plugin: 'progress-more', key: 'tab' } as const, 'home')

// Shared look-and-feel values owned by the `settings` mod. Read only; the defaults apply when it never wrote them.
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
const calmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)

const TABS: [string, string][] = [
  ['home', 'Home'],
  ['quality', 'Quality'],
  ['review', 'Review'],
  ['track', 'Track'],
  ['me', 'Me'],
  ['custom', 'Custom'],
]

// ---------------------------------------------------------------------------
// Engine glue (these take `$`, so they live at the top level)
// ---------------------------------------------------------------------------

const ctxOf = async ($: Dollar): Promise<Ctx> => ({
  data: await read($, dataA),
  cfg: await read($, cfgA),
  sess: await read($, sessA),
  now: await $.clock.now(),
  icons: String(await read($, iconsA)),
})

const persist = async ($: Dollar) => {
  await $.store.set('data', await read($, dataA)).catch(() => undefined)
  await $.store.set('cfg', await read($, cfgA)).catch(() => undefined)
  const now = await $.clock.now()
  await update($, sessA, s => ({ ...s, lastSaveAt: now }))
}

const setData = async ($: Dollar, fn: (d: Data) => Data) => {
  await update($, dataA, fn)
  await persist($)
}

const setCfg = async ($: Dollar, fn: (c: Cfg) => Cfg) => {
  await update($, cfgA, fn)
  await persist($)
}

/** One toast at most every 3 minutes from this mod, and never while the shared calm switch is on. */
const toastIf = async ($: Dollar, text: string): Promise<boolean> => {
  const sess = await read($, sessA)
  const now = await $.clock.now()
  const isCalm = (await read($, calmA)) === true

  if (!toastAllowed(isCalm, now, sess.lastToastAt)) {
    return false
  }
  $.ui.toast(text, { timeoutMs: 5000 })
  await update($, sessA, s => ({ ...s, lastToastAt: now }))

  return true
}

const fireEvent = async ($: Dollar, event: string) => {
  const cfg = await read($, cfgA)
  const sess = await read($, sessA)
  const now = await $.clock.now()
  const rule = pickRule(cfg.rules, event, now, sess.ruleLast)

  if (rule === undefined) {
    return
  }

  if (await toastIf($, rule.text)) {
    await update($, sessA, s => ({ ...s, ruleLast: { ...s.ruleLast, [rule.id]: now } }))
  }
}

const outText = (out: ToolOut): string => (typeof out.text === 'string' ? out.text : typeof out.result === 'string' ? out.result : JSON.stringify(out.result ?? '').slice(0, 20_000))

const observeEdit = async ($: Dollar, e: Input, key: string) => {
  const path = typeof e.file_path === 'string' ? e.file_path : ''

  if (path === '') {
    return
  }
  const isWrite = e.tool === 'Write'
  const content = String((isWrite ? e.content : e.new_string) ?? '').slice(0, MAX_CONTENT)
  const old = isWrite ? '' : String(e.old_string ?? '').slice(0, MAX_CONTENT)
  const todos = todoDelta(old, content, isWrite)
  const fns = exportedFns(content, path, isWrite)

  await update($, sessA, s => {
    const isSrc = isSourceFile(path)

    return {
      ...s,
      changed: isSrc && !s.changed.includes(path) ? [...s.changed, path].slice(-100) : s.changed,
      tests: isTestFile(path) && !s.tests.includes(path) ? [...s.tests, path].slice(-100) : s.tests,
      docs: isSrc ? mergeDocs(s.docs, path, fns, isWrite) : s.docs,
    }
  })
  const sess = await read($, sessA)
  const debt = testDebtNow(sess)
  const docs = docsStats(sess.docs)

  await update($, dataA, d => ({
    ...d,
    days: touchDay(d.days, key, x => ({
      ...x,
      todoAdd: x.todoAdd + todos.added,
      todoDone: x.todoDone + todos.removed,
      bytes: x.bytes + content.length,
      peakChanged: Math.max(x.peakChanged, debt.changed),
      peakUntested: Math.max(x.peakUntested, debt.untested),
      docsExported: docs.exported > 0 ? docs.exported : x.docsExported,
      docsDocumented: docs.exported > 0 ? docs.documented : x.docsDocumented,
    })),
  }))
}

const observe = async ($: Dollar, e: Input, out: ToolOut) => {
  // A call another mod refused is not a quality signal.
  if (typeof out.deny === 'string') {
    return
  }
  const now = await $.clock.now()
  const key = dayKey(now)
  const tool = String(e.tool ?? '')
  const isErr = out.isError === true

  await update($, dataA, d => ({ ...d, days: touchDay(d.days, key, x => ({ ...x, calls: x.calls + 1, errors: x.errors + (isErr ? 1 : 0) })) }))

  if ((tool === 'Edit' || tool === 'Write') && !isErr) {
    await observeEdit($, e, key)
  }

  if (tool === 'Bash') {
    const event = bashEvent(String(e.command ?? ''), isErr, outText(out))

    if (event !== undefined) {
      await fireEvent($, event)
    }
  }
  const sess = await read($, sessA)

  if (now - sess.lastSaveAt > SAVE_GAP_MS) {
    await persist($)
  }
}

const loadSaved = async ($: Dollar) => {
  const now = await $.clock.now()
  const cfg = normalizeCfg(await $.store.get('cfg').catch(() => undefined))
  const data = pruneData(normalizeData(await $.store.get('data').catch(() => undefined)), cfg, now)
  await update($, cfgA, () => cfg)
  await update($, dataA, () => data)
  await update($, sessA, () => emptySess(now))
}

/** At most one toast a day: the Monday plan reminder, else one of your own tips. */
const dailyToast = async ($: Dollar) => {
  const c = await ctxOf($)
  const today = dayKey(c.now)
  const last = await $.store.get('tipday').catch(() => undefined)

  if (last === today) {
    return
  }
  const isMonday = new Date(c.now).getDay() === 1
  const needsPlan = c.data.plan === null || c.data.plan.week !== isoWeek(c.now)
  let text: string | undefined

  if (isMonday && needsPlan) {
    text = 'Monday: set three items for the week with /pqplan a; b; c'
  } else if (c.cfg.tipsOn && c.cfg.tips.length > 0) {
    text = `Tip: ${c.cfg.tips[Math.floor(c.now / 86_400_000) % c.cfg.tips.length]}`
  }

  if (text !== undefined && (await toastIf($, text))) {
    await $.store.set('tipday', today).catch(() => undefined)
  }
}

const openPane = ($: Dollar) => $.ui.open({ id: PANE, title: 'Progress+' }).catch(() => undefined)

const costOf = async ($: Dollar): Promise<number | undefined> => {
  try {
    const u = await $.session.usage()

    return typeof u?.cost?.usd === 'number' ? u.cost.usd : undefined
  } catch {
    return undefined
  }
}

// ----------------------------------------------------------------- read-only commands this mod may run

type Counted = { ok: true; counts: GrepCounts } | { ok: false; error: string }

/** 125/126: counts a validated literal with `grep -rIF -c`. Read-only, 20 s limit, output parsed with a cap. */
const grepCount = async ($: Dollar, pattern: string): Promise<Counted> => {
  const v = validatePattern(pattern)

  if (!v.ok) {
    return { ok: false, error: v.reason }
  }

  try {
    const r = await $.process.run(grepArgv(v.pattern), { timeoutMs: GREP_TIMEOUT_MS })

    if (r.exitCode > 1 && r.stdout.trim() === '') {
      return { ok: false, error: `grep failed: ${clip(r.stderr.trim() || `exit ${r.exitCode}`, 140)}` }
    }

    return { ok: true, counts: parseGrepCounts(r.stdout) }
  } catch (err) {
    return { ok: false, error: `grep could not run: ${clip(err instanceof Error ? err.message : String(err), 140)}` }
  }
}

const countLine = (c: GrepCounts) => `${plural(c.total, 'occurrence')} in ${plural(c.fileCount, 'file')}${c.isCut ? ' (output cut)' : ''}`

const runRefactor = async ($: Dollar, args: string) => {
  const a = args.trim()
  const data = await read($, dataA)

  if (a.toLowerCase() === 'stop') {
    await setData($, d => ({ ...d, refactor: null }))

    return 'Refactor tracker stopped; its history is cleared.'
  }
  const toks = splitArgs(a)
  const pattern = a === '' ? (data.refactor?.pattern ?? '') : /^["']/.test(a) && toks.length === 1 ? (toks[0] ?? '') : a

  if (pattern === '') {
    return 'Use /pqrefactor <literal text>, e.g. /pqrefactor oldHelper(. It counts the text as typed (no regex) with a read-only grep.'
  }
  const r = await grepCount($, pattern)

  if (!r.ok) {
    return `Not counted: ${r.error}.`
  }
  const now = await $.clock.now()
  await setData($, d => ({
    ...d,
    refactor: {
      pattern,
      points: addPoint(d.refactor?.pattern === pattern ? d.refactor.points : [], { at: now, a: r.counts.total, b: 0, fa: r.counts.fileCount, fb: 0 }),
    },
  }))
  const after = (await read($, dataA)).refactor

  return [
    `"${pattern}": ${countLine(r.counts)}.`,
    ...r.counts.files.slice(0, 8).map(f => `  ${f.count}  ${f.path}`),
    r.counts.fileCount > 8 ? `  ... and ${r.counts.fileCount - 8} more files` : '',
    ...refactorLines(after ?? null).slice(1),
  ]
    .filter(Boolean)
    .join('\n')
}

const runMigrate = async ($: Dollar, args: string) => {
  const a = args.trim()
  const data = await read($, dataA)

  if (a.toLowerCase() === 'stop') {
    await setData($, d => ({ ...d, migration: null }))

    return 'Migration tracker stopped; its history is cleared.'
  }
  const toks = splitArgs(a)
  const oldP = a === '' ? (data.migration?.oldP ?? '') : (toks[0] ?? '')
  const newP = a === '' ? (data.migration?.newP ?? '') : (toks[1] ?? '')

  if (oldP === '' || newP === '' || (a !== '' && toks.length !== 2) || oldP === newP) {
    return 'Use /pqmigrate <old text> <new text> with two different literals (put "quotes" around text with spaces).'
  }
  const ro = await grepCount($, oldP)
  const rn = await grepCount($, newP)

  if (!ro.ok || !rn.ok) {
    return `Not counted: ${!ro.ok ? `old: ${ro.error}` : !rn.ok ? `new: ${rn.error}` : ''}.`
  }
  const now = await $.clock.now()
  await setData($, d => ({
    ...d,
    migration: {
      oldP,
      newP,
      points: addPoint(d.migration?.oldP === oldP && d.migration.newP === newP ? d.migration.points : [], {
        at: now,
        a: ro.counts.total,
        b: rn.counts.total,
        fa: ro.counts.fileCount,
        fb: rn.counts.fileCount,
      }),
    },
  }))

  return [`old "${oldP}": ${countLine(ro.counts)}`, `new "${newP}": ${countLine(rn.counts)}`, ...migrationLines((await read($, dataA)).migration).slice(1, 3)].join('\n')
}

const exists = async ($: Dollar, path: string) => {
  try {
    await $.fs.stat(path)

    return true
  } catch {
    return false
  }
}

/** 127: only when the user types /pqupgrade. Read-only listing commands with a 30 s limit; nothing is installed. */
const runUpgrade = async ($: Dollar, args: string) => {
  const cwd = await $.session.cwd().catch(() => '.')
  const want = args.trim().toLowerCase()
  const mgr: 'npm' | 'pip' | undefined =
    want === 'npm' || want === 'pip'
      ? want
      : (await exists($, `${cwd}/package.json`))
        ? 'npm'
        : (await Promise.all(['pyproject.toml', 'requirements.txt', 'setup.py'].map(f => exists($, `${cwd}/${f}`)))).some(Boolean)
          ? 'pip'
          : undefined

  if (mgr === undefined) {
    return 'No package.json, pyproject.toml, requirements.txt or setup.py here. Use /pqupgrade npm or /pqupgrade pip to choose.'
  }
  const tries: string[][] = mgr === 'npm' ? [['npm', 'outdated', '--json']] : [['pip', 'list', '--outdated', '--format', 'json'], ['python3', '-m', 'pip', 'list', '--outdated', '--format', 'json']]
  let items: Outdated[] | undefined
  let why = ''

  for (const argv of tries) {
    try {
      const r = await $.process.run(argv, { timeoutMs: UPGRADE_TIMEOUT_MS })
      // npm exits 1 when something is outdated, so the exit code alone says nothing
      const parsed = parseOutdated(mgr, r.stdout)

      if (parsed.ok && (r.exitCode <= 1 || r.stdout.trim() !== '')) {
        items = parsed.items
        break
      }
      why = parsed.ok ? clip(r.stderr.trim() || `exit ${r.exitCode}`, 140) : parsed.reason
    } catch (err) {
      why = clip(err instanceof Error ? err.message : String(err), 140)
    }
  }

  if (items === undefined) {
    return `Could not list outdated ${mgr} packages: ${why}.`
  }
  const now = await $.clock.now()
  const rec = summarizeUpgrades(mgr, items, now)
  await setData($, d => ({ ...d, upgrades: [...d.upgrades.filter(u => dayKey(u.at) !== dayKey(now)), rec].slice(-30) }))

  return [...upgradeLines((await read($, dataA)).upgrades, now), '(Read-only: nothing was installed or changed.)'].join('\n')
}

// ----------------------------------------------------------------- other commands

const runRev = async ($: Dollar, args: string) => {
  const a = args.trim()
  const [sub = ''] = a.split(/\s+/)
  const rest = a.slice(sub.length).trim()
  const now = await $.clock.now()
  const icons = String(await read($, iconsA))
  let note = ''

  if (sub === 'add') {
    const r = addRev((await read($, dataA)).review, rest, now)

    if (r.error !== undefined) {
      return r.error
    }
    await setData($, d => ({ ...d, review: r.list }))
    note = 'Added.\n'
  } else if (sub === 'tick' || sub === 'untick' || sub === 'del') {
    const n = Number(rest)
    const list = (await read($, dataA)).review
    const item = list[n - 1]

    if (!Number.isInteger(n) || item === undefined) {
      return `Use /pqrev ${sub} <1-${Math.max(1, list.length)}>.`
    }
    await setData($, d => ({ ...d, review: sub === 'del' ? d.review.filter(i => i.id !== item.id) : d.review.map(i => (i.id === item.id ? { ...i, done: sub === 'tick' } : i)) }))
    note = sub === 'del' ? 'Removed.\n' : ''
  } else if (sub === 'clear') {
    await setData($, d => ({ ...d, review: [] }))

    return 'Review list cleared.'
  } else if (sub !== '') {
    return 'Use /pqrev add <text>, tick <n>, untick <n>, del <n>, or clear.'
  }
  const list = (await read($, dataA)).review
  const p = revProgress(list)

  return list.length === 0
    ? 'The review list is empty. /pqrev add <what to check>'
    : `${note}${bar(p.frac)} ${p.done}/${p.total}\n${list.map((i, k) => `${check(icons, i.done)} ${k + 1}. ${i.text}`).join('\n')}`
}

const runIntent = async ($: Dollar, args: string) => {
  const t = args.trim()

  if (t === '' || t.length > 120) {
    return 'Use /pqintent <what this session is for>, up to 120 characters. Then /pqrate 1-5 at the end.'
  }
  const now = await $.clock.now()
  await setData($, d => ({
    ...d,
    intents: [...d.intents, { id: `i${Math.max(0, ...d.intents.map(i => Number(i.id.slice(1)) || 0)) + 1}`, at: now, text: t, rating: null } as Intent].slice(-MAX_INTENTS),
  }))

  return `Intention noted: ${t}\nRate it at the end with /pqrate 1-5.`
}

const runRate = async ($: Dollar, args: string) => {
  const n = Number(args.trim())
  const list = (await read($, dataA)).intents
  const last = list[list.length - 1]

  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return 'Use /pqrate <1-5> (5 is best).'
  }

  if (last === undefined) {
    return 'No intention yet. /pqintent <text> first.'
  }
  await setData($, d => ({ ...d, intents: d.intents.map(i => (i.id === last.id ? { ...i, rating: n } : i)) }))
  const t = ratingTrend((await read($, dataA)).intents)

  return `Rated "${clip(last.text, 40)}" ${n}/5. Ratings ${t.spark} (avg ${t.avg}).`
}

const runPlan = async ($: Dollar, args: string) => {
  const a = args.trim()
  const c = await ctxOf($)
  const week = isoWeek(c.now)
  const [sub = ''] = a.split(/\s+/)

  if (a.toLowerCase() === 'clear') {
    await setData($, d => ({ ...d, plan: null }))

    return 'Plan cleared.'
  }

  if (sub === 'tick') {
    const n = Number(a.slice(4).trim())
    const item = c.data.plan?.items[n - 1]

    if (c.data.plan === null || item === undefined) {
      return 'Use /pqplan tick <1-3> once a plan exists.'
    }
    await setData($, d => ({ ...d, plan: d.plan === null ? null : { ...d.plan, items: d.plan.items.map((x, i) => (i === n - 1 ? { ...x, done: !x.done } : x)) } }))
  } else if (a !== '') {
    const p = parsePlanItems(a)

    if ('error' in p) {
      return p.error
    }
    await setData($, d => ({ ...d, plan: { week, items: p.items.map(text => ({ text, done: false })) } }))
  }
  const plan = (await read($, dataA)).plan

  return plan === null ? 'No plan yet. /pqplan <item>; <item>; <item>' : [`Plan for ${plan.week}${plan.week === week ? '' : ' (an earlier week: set a new one with /pqplan)'}`, ...plan.items.map((i, k) => `${check(c.icons, i.done)} ${k + 1}. ${i.text}`)].join('\n')
}

const runWin = async ($: Dollar, args: string) => {
  const t = args.trim()

  if (t.length > 140) {
    return 'Keep a win under 140 characters.'
  }

  if (t !== '') {
    const now = await $.clock.now()
    await setData($, d => ({ ...d, wins: [...d.wins, { at: now, text: t }].slice(-MAX_WINS) }))
  }
  const wins = (await read($, dataA)).wins.slice(-10).reverse()

  return wins.length === 0 ? 'No wins yet. /pqwin <what went well>' : `${t === '' ? '' : 'Logged. '}Latest wins:\n${wins.map(w => `${dayKey(w.at)}  ${w.text}`).join('\n')}`
}

const runGoal = async ($: Dollar, args: string) => {
  const a = args.trim()
  const [sub = ''] = a.split(/\s+/)
  const rest = a.slice(sub.length).trim()
  const now = await $.clock.now()

  if (sub === 'add') {
    const p = parseGoalAdd(rest, now)

    if ('error' in p) {
      return p.error
    }

    if ((await read($, dataA)).goals.length >= MAX_GOALS) {
      return `At most ${MAX_GOALS} goals; /pqgoal del <n> first.`
    }
    await setData($, d => ({
      ...d,
      goals: [...d.goals, { id: `g${Math.max(0, ...d.goals.map(g => Number(g.id.slice(1)) || 0)) + 1}`, text: p.text, due: p.due, done: false, at: now } as Goal],
    }))
  } else if (sub === 'done' || sub === 'del') {
    const sorted = sortedGoals((await read($, dataA)).goals)
    const g = sorted[Number(rest) - 1]

    if (g === undefined) {
      return `Use /pqgoal ${sub} <1-${Math.max(1, sorted.length)}> (numbers as listed by /pqgoal).`
    }
    await setData($, d => ({ ...d, goals: sub === 'del' ? d.goals.filter(x => x.id !== g.id) : d.goals.map(x => (x.id === g.id ? { ...x, done: !x.done } : x)) }))
  } else if (a !== '') {
    return 'Use /pqgoal add <text> @<due week>, done <n>, or del <n>.'
  }
  const list = sortedGoals((await read($, dataA)).goals)
  const icons = String(await read($, iconsA))

  return list.length === 0 ? 'No season goals. /pqgoal add <text> @2026-W50 (or @2026-12-15, or @+4 weeks)' : list.map((g, i) => `${i + 1}. ${goalLine(g, isoWeek(now), icons)}`).join('\n')
}

const sortedGoals = (goals: readonly Goal[]): Goal[] => [...goals].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id < b.id ? -1 : 1))

const runTips = async ($: Dollar, args: string) => {
  const a = args.trim()
  const [sub = ''] = a.split(/\s+/)
  const rest = a.slice(sub.length).trim()

  if (sub === 'add') {
    const cfg = await read($, cfgA)

    if (rest === '' || rest.length > 120 || /[\u0000-\u001f]/.test(rest)) {
      return 'A tip is one line of 1 to 120 characters: /pqtips add <text>'
    }

    if (cfg.tips.length >= MAX_TIPS) {
      return `At most ${MAX_TIPS} tips; /pqtips del <n> first.`
    }
    await setCfg($, c => ({ ...c, tips: [...c.tips, rest] }))
  } else if (sub === 'del') {
    const n = Number(rest)

    if (!Number.isInteger(n) || (await read($, cfgA)).tips[n - 1] === undefined) {
      return 'Use /pqtips del <n> (numbers as listed by /pqtips).'
    }
    await setCfg($, c => ({ ...c, tips: c.tips.filter((_, i) => i !== n - 1) }))
  } else if (sub === 'on' || sub === 'off') {
    await setCfg($, c => ({ ...c, tipsOn: sub === 'on' }))
  } else if (a !== '') {
    return 'Use /pqtips add <text>, del <n>, on, or off.'
  }
  const cfg = await read($, cfgA)

  return `Tips are ${cfg.tipsOn ? 'on' : 'off'} (one toast a day at most, at session start, never while calm).\n${cfg.tips.length === 0 ? 'No tips yet: /pqtips add <text>' : cfg.tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
}

const fillTemplate = async ($: Dollar, name: string): Promise<string> => {
  const t = (await read($, cfgA)).templates.find(x => x.name === name)

  if (t === undefined) {
    return `No template "${name}". /pqtpl lists yours.`
  }
  const r = await $.prompt.fill({ text: t.text, mode: 'insert' }).catch(() => undefined)

  return r !== undefined && r.isFilled === false ? 'The prompt box could not be filled right now.' : `Filled the prompt box with "${name}".`
}

const runTpl = async ($: Dollar, args: string) => {
  const a = args.trim()
  const [sub = ''] = a.split(/\s+/)
  const rest = a.slice(sub.length).trim()

  if (sub === 'add') {
    const [name = ''] = rest.split(/\s+/)
    const text = rest.slice(name.length).trim()

    if (!/^[\w-]{1,20}$/.test(name) || text === '' || text.length > 400) {
      return 'Use /pqtpl add <name> <text>: a name of up to 20 letters, digits, _ or -, then 1 to 400 characters of text.'
    }
    const cfg = await read($, cfgA)

    if (!cfg.templates.some(t => t.name === name) && cfg.templates.length >= MAX_TEMPLATES) {
      return `At most ${MAX_TEMPLATES} templates; /pqtpl del <name> first.`
    }
    await setCfg($, c => ({ ...c, templates: [...c.templates.filter(t => t.name !== name), { name, text }] }))
  } else if (sub === 'del') {
    await setCfg($, c => ({ ...c, templates: c.templates.filter(t => t.name !== rest) }))
  } else if (sub === 'starter') {
    await setCfg($, c => ({ ...c, templates: [...c.templates, ...STARTER_TEMPLATES.filter(s => !c.templates.some(t => t.name === s.name))].slice(0, MAX_TEMPLATES) }))
  } else if (a !== '') {
    return fillTemplate($, a)
  }
  const cfg = await read($, cfgA)

  return cfg.templates.length === 0
    ? 'No templates yet. /pqtpl add <name> <text>, or /pqtpl starter for three examples. /pqtpl <name> fills the prompt box.'
    : `Your templates (/pqtpl <name> fills the prompt box):\n${cfg.templates.map(t => `${t.name}: ${clip(t.text, 70)}`).join('\n')}`
}

const runRule = async ($: Dollar, args: string) => {
  const a = args.trim()
  const [sub = ''] = a.split(/\s+/)
  const rest = a.slice(sub.length).trim()

  if (sub === 'add' || sub === 'on') {
    const r = addRule((await read($, cfgA)).rules, sub === 'on' ? a : rest)

    if (r.error !== undefined) {
      return `Rule not added: ${r.error}`
    }
    await setCfg($, c => ({ ...c, rules: r.rules }))
  } else if (sub === 'del') {
    const n = Number(rest)

    if (!Number.isInteger(n) || (await read($, cfgA)).rules[n - 1] === undefined) {
      return 'Use /pqrule del <n> (numbers as listed by /pqrule).'
    }
    await setCfg($, c => ({ ...c, rules: c.rules.filter((_, i) => i !== n - 1) }))
  } else if (sub === 'clear') {
    await setCfg($, c => ({ ...c, rules: [] }))
  } else if (a !== '') {
    return `Use /pqrule add on <${RULE_EVENTS.join('|')}> toast "<text>" [every <n>m], del <n>, or clear.`
  }
  const cfg = await read($, cfgA)

  return [
    `Toast rules (${cfg.rules.length}/20). Events: ${RULE_EVENTS.join(', ')}. Only action: a toast. At most one toast every 3 minutes overall; none while calm.`,
    ...(cfg.rules.length === 0 ? ['No rules yet. Example: /pqrule add on tests-pass toast "nice" every 10m'] : cfg.rules.map((r, i) => `${i + 1}. on ${r.event} toast "${r.text}" every ${r.everyMin}m`)),
  ].join('\n')
}

const runKeep = async ($: Dollar, args: string) => {
  const cfg = await read($, cfgA)

  if (args.trim() !== '') {
    const p = parseKeep(args)

    if ('error' in p) {
      return p.error
    }
    await setCfg($, c => {
      const keep = { ...c.keep }

      if (p.days === 'default') {
        delete keep[p.list]
      } else {
        keep[p.list] = p.days
      }

      return { ...c, keep }
    })
    const now = await $.clock.now()
    await setData($, d => pruneData(d, { ...cfg, keep: { ...cfg.keep, ...(p.days === 'default' ? {} : { [p.list]: p.days }) } }, now))
  }
  const now = (await read($, cfgA))

  return ['Retention (older records are dropped at session start and when you change it):', ...['days', 'trends', 'intents', 'wins'].map(l => `${l}: ${keepDays(now, l)} days${now.keep[l] === undefined ? ' (default)' : ''}`), 'Review list, plan and goals are yours and never expire.'].join('\n')
}

const runTiles = async ($: Dollar, args: string) => {
  const a = args.trim()
  const [sub = ''] = a.split(/\s+/)
  const rest = a.slice(sub.length).trim().toLowerCase()

  if (sub === 'show') {
    const p = parseTileList(rest)

    if ('error' in p) {
      return p.error
    }
    await setCfg($, c => ({ ...c, tiles: p.tiles }))
  } else if (sub === 'add' || sub === 'hide' || sub === 'up' || sub === 'down') {
    if (!TILE_IDS.includes(rest as never)) {
      return `Tiles: ${TILE_IDS.join(', ')}.`
    }
    await setCfg($, c => ({
      ...c,
      tiles: sub === 'add' ? (c.tiles.includes(rest) ? c.tiles : [...c.tiles, rest]) : sub === 'hide' ? c.tiles.filter(t => t !== rest) : moveTile(c.tiles, rest, sub === 'up' ? -1 : 1),
    }))
  } else if (sub === 'reset') {
    await setCfg($, c => ({ ...c, tiles: [...TILE_IDS] }))
  } else if (a !== '') {
    return 'Use /pqtiles show a,b,c | add <id> | hide <id> | up <id> | down <id> | reset.'
  }
  const cfg = await read($, cfgA)

  return `Home tiles, in order: ${cfg.tiles.join(', ') || '(none)'}\nHidden: ${TILE_IDS.filter(t => !cfg.tiles.includes(t)).join(', ') || '(none)'}`
}

const runFmt = async ($: Dollar, args: string) => {
  const [key = '', ...rest] = args.trim().split(/\s+/)
  const value = rest.join(' ')

  if (key === 'currency' && validSymbol(value)) {
    await setCfg($, c => ({ ...c, fmt: { ...c.fmt, currency: value } }))
  } else if (key === 'clock' && (value === '12' || value === '24')) {
    await setCfg($, c => ({ ...c, fmt: { ...c.fmt, clock: value } }))
  } else if (key === 'units' && (value === 'si' || value === 'iec')) {
    await setCfg($, c => ({ ...c, fmt: { ...c.fmt, units: value } }))
  } else if (args.trim() !== '') {
    return 'Use /pqfmt currency <1-4 characters, e.g. € or kr>, clock 12|24, units si|iec. (A symbol only: nothing is converted.)'
  }
  const f = (await read($, cfgA)).fmt
  const now = await $.clock.now()

  return `Formats: currency ${f.currency} (symbol only, no conversion), clock ${f.clock} h, units ${f.units}.\nPreview: ${fmtMoney(1.2345, f.currency)} · ${fmtClock(now, f.clock)} · ${fmtSize(1_234_567, f.units)}`
}

const runReset = async ($: Dollar, args: string) => {
  const now = await $.clock.now()
  await update($, dataA, () => emptyData())
  await update($, sessA, () => emptySess(now))
  await $.store.set('tipday', '').catch(() => undefined)

  if (args.trim().toLowerCase() === 'all') {
    await update($, cfgA, () => defaultCfg())
    await persist($)

    return 'progress-more: all recorded data and your settings (tips, templates, rules, tiles, retention, formats) cleared.'
  }
  await persist($)

  return 'progress-more: recorded data cleared (days, review, trackers, intentions, wins, plan, goals). Your tips, templates, rules, tiles, retention and formats are kept; /pqreset all clears those too.'
}

const helpText = () => ['progress-more: progress cards, trackers and your own customizations. Nothing runs shell commands unless you type /pqrefactor, /pqmigrate or /pqupgrade (all read-only).', ...COMMANDS.map(([, usage, d]) => `${usage}: ${d}`)].join('\n')

const runPane = async ($: Dollar, args: string) => {
  const tab = args.trim().toLowerCase()

  if (tab !== '' && !TABS.some(([id]) => id === tab)) {
    return `Tabs: ${TABS.map(([id]) => id).join(', ')}.`
  }

  if (tab !== '') {
    await update($, tabA, () => tab)
  }
  await openPane($)

  return 'Progress+ pane opened.'
}

const runCommand = async ($: Dollar, name: string, args: string): Promise<string> => {
  const c = async () => ctxOf($)

  switch (name) {
    case 'pq':
      return helpText()
    case 'pqpane':
      return runPane($, args)
    case 'pqtrend':
      return trendText(await c())
    case 'pqrev':
      return runRev($, args)
    case 'pqrefactor':
      return runRefactor($, args)
    case 'pqmigrate':
      return runMigrate($, args)
    case 'pqupgrade':
      return runUpgrade($, args)
    case 'pqtestdebt':
      return tileLines('testdebt', await c()).join('\n')
    case 'pqdocs':
      return tileLines('docs', await c()).join('\n')
    case 'pqclean':
      return tileLines('cleanup', await c()).join('\n')
    case 'pqintent':
      return runIntent($, args)
    case 'pqrate':
      return runRate($, args)
    case 'pqwrap':
      return wrapText(await c())
    case 'pqplan':
      return runPlan($, args)
    case 'pqwin':
      return runWin($, args)
    case 'pqcard':
      return `${cardText(await c())}\n(Printed here only; nothing is sent. Copy it yourself if you want to share it.)`
    case 'pqgoal':
      return runGoal($, args)
    case 'pqtips':
      return runTips($, args)
    case 'pqtpl':
      return runTpl($, args)
    case 'pqrule':
      return runRule($, args)
    case 'pqkeep':
      return runKeep($, args)
    case 'pqtiles':
      return runTiles($, args)
    case 'pqfmt':
      return runFmt($, args)
    case 'pqreset':
      return runReset($, args)
    default:
      return helpText()
  }
}

// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, usage, description] of COMMANDS) {
      await $.command.register({ name, description, argumentHint: usage.split(' ').slice(1).join(' ') || undefined }).catch(() => undefined)
    }
    await loadSaved($).catch(() => undefined)
    await dailyToast($).catch(() => undefined)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const out = await next(e)
    await observe($, e as unknown as Input, out as unknown as ToolOut).catch(() => undefined)

    return out
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId === undefined) {
      await persist($).catch(() => undefined)

      if (e.reason === 'answer') {
        await fireEvent($, 'turn.complete').catch(() => undefined)
      }
    }

    return out
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await persist($).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({ text: await runCommand($, name, e.args) })).catch(() => ({ text: 'progress-more hit an unexpected error.' }))
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await ctxOf($)
    const tab = await read($, tabA)
    const accent = (await read($, accentA)) as 'suggestion'
    const dens = await read($, densityA)
    const pad = dens === 'compact' ? 'xs' : dens === 'airy' ? 'md' : 'sm'
    const rows = e.viewport?.rows ?? 24
    const usd = await costOf($)
    const today = c.data.days.find(d => d.day === dayKey(c.now))
    const fmt = c.cfg.fmt
    const week = isoWeek(c.now)
    const icons = c.icons
    const calm = (await read($, calmA)) === true

    const section = (id: string, lines: string[]) => (
      <Box flexDirection="column" marginTop={pad}>
        <Text weight="bold" color={accent}>
          {TILE_INFO[id]?.title ?? id}
        </Text>
        {lines.map(l => (
          <Text mono dimColor={false}>
            {l}
          </Text>
        ))}
      </Box>
    )

    const header = (
      <Box flexDirection="column" marginBottom={pad}>
        <Box justifyContent="space-between">
          <Text size="heading" weight="bold" color={accent}>
            Progress+
          </Text>
          <Text dimColor mono tabular>
            {week}
            {calm ? ' · calm' : ''}
          </Text>
        </Box>
        <Text dimColor size="caption">
          since {fmtClock(c.sess.startedAt || c.now, fmt.clock)} · cost estimate {usd === undefined ? 'n/a' : fmtMoney(usd, fmt.currency)} · wrote about {fmtSize(today?.bytes ?? 0, fmt.units)} today
        </Text>
        <Box gap={pad} marginTop={pad}>
          {TABS.map(([id, label]) => (
            <Button key={`tab-${id}`} label={label} variant={tab === id ? 'primary' : 'secondary'} onPress={() => update($, tabA, () => id)} />
          ))}
        </Box>
      </Box>
    )

    const body: RenderChildren[] = []

    if (tab === 'quality') {
      const tr = weeklyTrend(c.data.days, c.now, 8)
      const top = Math.max(1, ...tr.map(w => w.per100 ?? 0))

      body.push(
        <Box flexDirection="column" marginTop={pad}>
          <Text weight="bold" color={accent}>
            Errors per 100 tool calls
          </Text>
          {tr.map(w => (
            <Text mono tabular>
              {w.week} {bar((w.per100 ?? 0) / top, 14)} {w.per100 === null ? '  -' : String(w.per100).padStart(4)}  {w.errors}/{w.calls}
            </Text>
          ))}
        </Box>,
        section('testdebt', tileLines('testdebt', c)),
        section('docs', tileLines('docs', c)),
        section('cleanup', tileLines('cleanup', c)),
      )
    } else if (tab === 'review') {
      const p = revProgress(c.data.review)

      body.push(
        <Box flexDirection="column" marginTop={pad}>
          <Text mono weight="bold" color={accent}>
            {bar(p.frac, 24)} {p.done}/{p.total}
          </Text>
          {c.data.review.length === 0 && <Text dimColor>Empty. Add items with /pqrev add &lt;text&gt;.</Text>}
          {c.data.review.map(i => (
            <Box gap={pad}>
              <Button key={`rev-${i.id}`} label={`${check(icons, i.done)} ${i.text}`} onPress={() => setData($, d => ({ ...d, review: d.review.map(x => (x.id === i.id ? { ...x, done: !x.done } : x)) }))} />
            </Box>
          ))}
        </Box>,
      )
    } else if (tab === 'track') {
      body.push(
        section('refactor', tileLines('refactor', c)),
        <Box gap={pad} marginTop={pad}>
          <Button key="again-ref" label="Count again" onPress={() => void runRefactor($, '')} />
          <Button key="stop-ref" label="Stop" onPress={() => void runRefactor($, 'stop')} />
        </Box>,
        section('migration', tileLines('migration', c)),
        <Box gap={pad} marginTop={pad}>
          <Button key="again-mig" label="Count again" onPress={() => void runMigrate($, '')} />
          <Button key="stop-mig" label="Stop" onPress={() => void runMigrate($, 'stop')} />
        </Box>,
        section('upgrade', tileLines('upgrade', c)),
        <Box gap={pad} marginTop={pad}>
          <Button key="run-upg" label="Check now (read-only)" onPress={() => void runUpgrade($, '')} />
        </Box>,
        <Text dimColor size="caption">
          Counting and checking run only when you press or type; they only read.
        </Text>,
      )
    } else if (tab === 'me') {
      const last = c.data.intents[c.data.intents.length - 1]

      body.push(
        section('intent', tileLines('intent', c)),
        last !== undefined && (
          <Box gap={pad} marginTop={pad}>
            <Text dimColor>Rate:</Text>
            {[1, 2, 3, 4, 5].map(n => (
              <Button key={`rate-${n}`} label={String(n)} variant={last.rating === n ? 'primary' : 'secondary'} onPress={() => void runRate($, String(n))} />
            ))}
          </Box>
        ),
        section('plan', c.data.plan === null ? tileLines('plan', c) : [`Week ${c.data.plan.week}`]),
        ...(c.data.plan?.items ?? []).map((it, i) => (
          <Button key={`plan-${i}`} label={`${check(icons, it.done)} ${it.text}`} onPress={() => void runPlan($, `tick ${i + 1}`)} />
        )),
        section('goals', c.data.goals.length === 0 ? tileLines('goals', c) : []),
        ...sortedGoals(c.data.goals).slice(0, Math.max(3, rows - 24)).map((g, i) => (
          <Button key={`goal-${g.id}`} label={`${i + 1}. ${goalLine(g, week, icons)}`} onPress={() => void runGoal($, `done ${i + 1}`)} />
        )),
        section('wins', c.data.wins.slice(-5).reverse().map(w => `${dayKey(w.at)}  ${w.text}`).concat(c.data.wins.length === 0 ? ['No wins logged yet. /pqwin <text>'] : [])),
      )
    } else if (tab === 'custom') {
      body.push(
        <Box flexDirection="column" marginTop={pad}>
          <Text weight="bold" color={accent}>
            Prompt templates
          </Text>
          {c.cfg.templates.length === 0 && <Text dimColor>None yet. /pqtpl add &lt;name&gt; &lt;text&gt; or /pqtpl starter.</Text>}
          <Box gap={pad}>
            {c.cfg.templates.map(t => (
              <Button key={`tpl-${t.name}`} label={t.name} onPress={() => void fillTemplate($, t.name)} />
            ))}
          </Box>
        </Box>,
        <Box flexDirection="column" marginTop={pad}>
          <Text weight="bold" color={accent}>
            Tiles on Home
          </Text>
          {TILE_IDS.map(id => {
            const shown = c.cfg.tiles.includes(id)

            return (
              <Box gap={pad}>
                <Button key={`vis-${id}`} label={`${shown ? 'shown' : 'hidden'}  ${TILE_INFO[id]?.title ?? id}`} onPress={() => setCfg($, x => ({ ...x, tiles: shown ? x.tiles.filter(t => t !== id) : [...x.tiles, id] }))} />
                {shown && <Button key={`up-${id}`} label="up" onPress={() => setCfg($, x => ({ ...x, tiles: moveTile(x.tiles, id, -1) }))} />}
                {shown && <Button key={`dn-${id}`} label="down" onPress={() => setCfg($, x => ({ ...x, tiles: moveTile(x.tiles, id, 1) }))} />}
              </Box>
            )
          })}
        </Box>,
        <Box flexDirection="column" marginTop={pad}>
          <Text weight="bold" color={accent}>
            Formats
          </Text>
          <Box gap={pad}>
            <Button key="fmt-clock" label={`clock ${fmt.clock} h`} onPress={() => setCfg($, x => ({ ...x, fmt: { ...x.fmt, clock: x.fmt.clock === '24' ? '12' : '24' } }))} />
            <Button key="fmt-units" label={`units ${fmt.units}`} onPress={() => setCfg($, x => ({ ...x, fmt: { ...x.fmt, units: x.fmt.units === 'si' ? 'iec' : 'si' } }))} />
            <Button key="fmt-cur" label={`currency ${fmt.currency}`} onPress={() => setCfg($, x => ({ ...x, fmt: { ...x.fmt, currency: ['$', '€', '£', '¥'][(['$', '€', '£', '¥'].indexOf(x.fmt.currency) + 1) % 4] ?? defaultFmt().currency } }))} />
          </Box>
          <Text dimColor size="caption">
            Symbol only, no conversion. Any symbol: /pqfmt currency kr
          </Text>
        </Box>,
        <Box flexDirection="column" marginTop={pad}>
          <Text weight="bold" color={accent}>
            Tips and toast rules
          </Text>
          <Button key="tips-toggle" label={`tips ${c.cfg.tipsOn ? 'on' : 'off'} (${plural(c.cfg.tips.length, 'tip')})`} onPress={() => setCfg($, x => ({ ...x, tipsOn: !x.tipsOn }))} />
          {c.cfg.rules.map((r, i) => (
            <Text mono>
              {i + 1}. on {r.event} toast "{r.text}" every {r.everyMin}m
            </Text>
          ))}
          {c.cfg.rules.length === 0 && <Text dimColor>No rules. /pqrule add on tests-pass toast "nice"</Text>}
          <Text dimColor size="caption">
            Retention: days {keepDays(c.cfg, 'days')}, trends {keepDays(c.cfg, 'trends')}, intents {keepDays(c.cfg, 'intents')}, wins {keepDays(c.cfg, 'wins')} (/pqkeep)
          </Text>
        </Box>,
      )
    } else {
      for (const id of c.cfg.tiles) {
        body.push(section(id, tileLines(id, c)))
      }

      if (c.cfg.tiles.length === 0) {
        body.push(<Text dimColor>All tiles are hidden. /pqtiles reset, or the Custom tab.</Text>)
      }
    }

    return (
      <Box flexDirection="column" padding={pad}>
        {header}
        {body}
      </Box>
    )
  })
}
