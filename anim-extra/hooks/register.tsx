import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import type { AxAnim, AxCfg, AxFired, AxLang, AxRun } from '../types'
import { CATALOG } from './catalog'
import {
  ALIAS_MAX,
  COMMANDS,
  BAND_MAX,
  BUNDLES,
  CONFETTI_MS,
  DEFAULT_CFG,
  DEFAULT_THRESHOLDS,
  LANGS,
  LOOP_MS,
  RECIPES,
  RULES_MAX,
  SAMPLE_CARDS,
  SELF,
  THRESHOLDS,
  THRESHOLD_KEYS,
  TICK_MS,
  URGENT_MS,
  addAlias,
  ageOf,
  arrangeRows,
  cardState,
  classifyCall,
  classifyEdit,
  classifyOutput,
  cleanCfg,
  clip,
  confettiLine,
  entriesOf,
  errorsIn,
  evaluateRules,
  extOf,
  glowTone,
  glyphFor,
  hourColor,
  hourOf,
  hourStrip,
  isLang,
  markerRow,
  parseAliasArgs,
  parseBandArgs,
  parseGlyphArgs,
  parseRateArgs,
  parseRule,
  removeAlias,
  resolveAlias,
  ringFrame,
  shimmer,
  shortPath,
  skeletonTotal,
  starsOf,
  sweepCell,
  testsPassed,
  thresholdKeyOf,
  tr,
  validateThreshold,
  RING_FRAME_MS,
  SWEEP_MS,
  ruleMatches,
} from './pure'
import type { Facts, LabelKey, Fire } from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]
type RenderE = Parameters<Hook<'ui.render'>>[1]
type UI = ReturnType<Dollar['ui']['resolve']>

// ---- foreign atoms: read only ------------------------------------------------------
// Reduced motion belongs to the `motion` mod, the shared look to the `settings` mod. Defaults hold when never written.
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const calmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
const presetA = atom({ plugin: 'settings', key: 'preset' } as const, 'full')

// ---- own atoms (bump a shape tag when its fields change) ---------------------------------
const NO_ANIM: AxAnim = { skelAt: 0, rippleAt: 0, sweepAt: 0, loopAt: 0, loopUntil: 0, confettiAt: 0, urgentAt: 0, urgentText: '', confettiText: '', notif: 0 }
const NO_RUN: AxRun = { calls: '', tests: 0, lastTool: '', lastMs: 0, files: [] }
const NO_FIRED: AxFired = { rules: {}, match: {}, toastAt: 0 }

const cfgA = atom({ plugin: 'anim-extra', key: 'cfg' } as const, DEFAULT_CFG, { shape: 'cfg-1' })
const nowA = atom({ plugin: 'anim-extra', key: 'now' } as const, 0)
const animA = atom({ plugin: 'anim-extra', key: 'anim' } as const, NO_ANIM, { shape: 'anim-1' })
const runA = atom({ plugin: 'anim-extra', key: 'run' } as const, NO_RUN, { shape: 'run-1' })
const firedA = atom({ plugin: 'anim-extra', key: 'fired' } as const, NO_FIRED, { shape: 'fired-1' })
const tabA = atom({ plugin: 'anim-extra', key: 'tab' } as const, 'hub')
const groupA = atom({ plugin: 'anim-extra', key: 'group' } as const, 'settings')
const sortA = atom({ plugin: 'anim-extra', key: 'sort' } as const, 'name')
const flashA = atom({ plugin: 'anim-extra', key: 'flash' } as const, '')

const PANE = 'anim-extra-main'
const STORE_KEY = 'ax.cfg'
const KNOWN = CATALOG.map(m => m.name)
const TABS = ['hub', 'presets', 'mods', 'alias', 'band', 'lab', 'motion', 'rules', 'tune', 'market', 'notes'] as const
const GROUPS = ['settings', 'look', 'safety', 'work', 'fun', 'other'] as const
const ACCENTS = ['suggestion', 'claude', 'success', 'warning', 'permission', 'remember'] as const


// ---- module state the drawings never read -------------------------------------------------
let ticker: Timer | undefined
let urgentTimer: Timer | undefined
let confettiTimer: Timer | undefined
let flashTimer: Timer | undefined

// ---- small helpers -----------------------------------------------------------------------
const isStoredOn = (flag: unknown) => !(flag === false || flag === 'off' || flag === 0 || flag === 'false')

/** The shared reduced-motion flag: the motion mod's atom, and the `motion` store key. */
const isMotion = async ($: Dollar) => (await read($, motionIsOn)) && isStoredOn(await $.store.get('motion'))

/** True when frames may move: motion on and the shared calm switch off. */
const isLive = async ($: Dollar) => (await isMotion($)) && !(await read($, calmA))

const saveCfg = async ($: Dollar, fn: (c: AxCfg) => AxCfg) => {
  await update($, cfgA, fn)
  await $.store.set(STORE_KEY, await read($, cfgA))
}

const fillPrompt = async ($: Dollar, text: string) => {
  await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)
}

const flash = async ($: Dollar, text: string) => {
  await update($, flashA, () => text)
  flashTimer?.cancel()
  flashTimer = $.clock.after(5000, () => {
    void update($, flashA, () => '')
  })
}

const copyText = async ($: Dollar, text: string, surface: string | undefined, lang: AxLang) => {
  const r = await $.ui.copy({ text, surface: surface as never }).catch(() => ({ isCopied: false }))
  await flash($, r.isCopied ? tr(lang, 'copied') : tr(lang, 'not_copied'))
}

// ---- the one shared ticker ------------------------------------------------------------------
/** What still needs frames at time `t`: a started demo, the loop, the urgent pulse, the confetti. */
const needsFrames = async ($: Dollar, t: number, live: boolean) => {
  if (!live) {
    return false
  }
  const a = await read($, animA)

  return (
    (a.skelAt > 0 && t - a.skelAt < skeletonTotal(SAMPLE_CARDS.length)) ||
    (a.rippleAt > 0 && t - a.rippleAt < 4 * RING_FRAME_MS) ||
    (a.sweepAt > 0 && t - a.sweepAt < 24 * SWEEP_MS) ||
    a.loopUntil > t ||
    (a.urgentAt > 0 && t - a.urgentAt < URGENT_MS) ||
    (a.confettiAt > 0 && t - a.confettiAt < CONFETTI_MS)
  )
}

const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
}

const step = async ($: Dollar) => {
  const t = await $.clock.now()
  await update($, nowA, () => t)

  if (!(await needsFrames($, t, await isLive($)))) {
    stopTicker()
  }
}

const ensureTicker = ($: Dollar) => {
  if (ticker === undefined) {
    ticker = $.clock.every(TICK_MS, () => {
      void step($)
    })
  }
}

/** Start an animation: stamps are set from the clock, and the ticker starts only when frames may move. */
const play = async ($: Dollar, patch: (t: number) => Partial<AxAnim>) => {
  const t = await $.clock.now()
  await update($, nowA, () => t)
  await update($, animA, a => ({ ...a, ...patch(t) }))

  if (await isLive($)) {
    ensureTicker($)

    return true
  }

  return false
}

const raiseUrgent = async ($: Dollar, text: string) => {
  if (!(await read($, cfgA)).glow) {
    return
  }
  await play($, t => ({ urgentAt: t, urgentText: clip(text, 100) }))
  urgentTimer?.cancel()
  urgentTimer = $.clock.after(URGENT_MS, () => {
    void update($, animA, a => ({ ...a, urgentAt: 0, urgentText: '' }))
  })
}

const clearUrgent = async ($: Dollar) => {
  urgentTimer?.cancel()
  await update($, animA, a => ({ ...a, urgentAt: 0, urgentText: '' }))
}

const confetti = async ($: Dollar, text: string) => {
  await play($, t => ({ confettiAt: t, confettiText: clip(text, 100) }))
  confettiTimer?.cancel()
  confettiTimer = $.clock.after(CONFETTI_MS, () => {
    void update($, animA, a => ({ ...a, confettiAt: 0, confettiText: '' }))
  })
}

const bumpNotif = async ($: Dollar) => {
  await update($, animA, a => ({ ...a, notif: Math.min(a.notif + 1, 99) }))
  await play($, t => ({ rippleAt: t }))
}

const playDemo = async ($: Dollar) =>
  play($, t => ({ skelAt: t, rippleAt: t, sweepAt: t }))

const setTab = async ($: Dollar, id: string) => {
  await update($, tabA, () => id)

  if (id === 'lab') {
    await play($, t => ({ skelAt: t, sweepAt: t }))
  } else if (id === 'motion') {
    await play($, t => ({ loopAt: t, loopUntil: t + LOOP_MS }))
  }
}

// ---- recording what the tool-call hook saw -----------------------------------------------------
type CallInfo = { tool: string; command?: unknown; file_path?: unknown; notebook_path?: unknown }

const afterCall = async ($: Dollar, e: CallInfo, startedAt: number, outcome: unknown, isThrown: boolean) => {
  const t = await $.clock.now()
  const r = outcome as { deny?: string; isError?: boolean; result?: { stdout?: unknown } } | undefined
  const isErr = isThrown || r?.deny !== undefined || r?.isError === true
  const stdout = typeof r?.result?.stdout === 'string' ? r.result.stdout : ''
  const passed = e.tool === 'Bash' && typeof e.command === 'string' && testsPassed(e.command, stdout, isErr)
  const path = typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : ''

  await update($, runA, run => ({
    calls: `${run.calls}${isErr ? 'e' : 'o'}`.slice(-10),
    tests: passed ? Math.min(run.tests + 1, 20) : run.tests,
    lastTool: e.tool,
    lastMs: Math.max(0, t - startedAt),
    files: path === '' ? run.files : [path, ...run.files.filter(f => f !== path)].slice(0, 8),
  }))
}

// ---- rule engine glue -----------------------------------------------------------------------------
const gatherFacts = async ($: Dollar, durationMs: number): Promise<{ facts: Facts; rateLimit: number }> => {
  const run = await read($, runA)
  let cost = 0
  let context = 0
  let rateLimit = 0

  try {
    const u = await $.session.usage()
    cost = u.cost?.usd ?? 0
    context = u.context.percent ?? 0
    rateLimit = Math.max(0, ...u.rateLimits.map(l => l.percentUsed ?? 0))
  } catch {
    // Usage unknown: the facts stay at zero and no rule on them fires.
  }

  return { facts: { cost, context, errors: errorsIn(run.calls), duration: durationMs / 1000, testpass: run.tests }, rateLimit }
}

const act = async ($: Dollar, f: Fire) => {
  if (f.kind === 'toast') {
    await $.ui.toast(f.text, { timeoutMs: 6000 })
  } else if (f.kind === 'fill') {
    await $.prompt.fill({ text: f.text, mode: 'append' }).catch(() => undefined)
  } else {
    await confetti($, f.text)
  }

  if (f.urgent) {
    await raiseUrgent($, f.text)
  }
}

const afterTurn = async ($: Dollar, durationMs: number) => {
  const cfg = await read($, cfgA)
  const isCalm = await read($, calmA)
  await bumpNotif($)
  const { facts, rateLimit } = await gatherFacts($, durationMs)

  if (cfg.glow && (facts.context >= 90 || rateLimit >= 95)) {
    await raiseUrgent($, facts.context >= 90 ? `context ${Math.round(facts.context)}% full` : `rate limit ${Math.round(rateLimit)}% used`)
  }
  const entries = entriesOf(cfg.rules, cfg.recipes)

  if (entries.length > 0) {
    const t = await $.clock.now()
    const prev = await read($, firedA)
    const out = evaluateRules({ entries, facts, now: t, isCalm, fired: prev.rules, match: prev.match, toastAt: prev.toastAt })
    const keep = Object.fromEntries(Object.entries(out.fired).slice(-40))
    await update($, firedA, () => ({ rules: keep, match: out.match, toastAt: out.toastAt }))

    for (const f of out.fire) {
      await act($, f).catch(() => undefined)
    }
  }
  await update($, runA, r => ({ ...r, tests: 0 }))
}

// ---- commands -------------------------------------------------------------------------------------
const helpText = () =>
  `Anim extra (prefix ax). Panel: /axpanel. Reads motion and settings: /motion off or the calm preset freezes every animation.\n${COMMANDS.map(([n, d]) => `/${n}: ${d}`).join('\n')}`

const describeRules = (cfg: AxCfg) =>
  [
    cfg.rules.length === 0 ? 'No rules yet. Example: /axrule if cost > 5 then toast "Cost is {cost}"' : cfg.rules.map((t, i) => `${i + 1}. ${t}`).join('\n'),
    `Recipes on: ${RECIPES.filter(r => cfg.recipes[r.id] === true).map(r => r.id).join(', ') || 'none'}.`,
    'Run at the end of each turn; each rule at most once per 5 minutes; toasts at most one per 3 minutes; calm runs only urgent rules.',
  ].join('\n')

const runRule = async ($: Dollar, args: string): Promise<string> => {
  const cfg = await read($, cfgA)
  const [word = '', arg = ''] = args.trim().split(/\s+/)

  if (word === '' || word === 'list') {
    return describeRules(cfg)
  }
  if (word === 'clear') {
    await saveCfg($, c => ({ ...c, rules: [] }))

    return 'All rules removed.'
  }
  if (word === 'rm') {
    const n = Number(arg)

    if (!Number.isInteger(n) || n < 1 || n > cfg.rules.length) {
      return `Usage: /axrule rm <1-${Math.max(1, cfg.rules.length)}>`
    }
    await saveCfg($, c => ({ ...c, rules: c.rules.filter((_, i) => i !== n - 1) }))

    return `Rule ${n} removed.`
  }
  if (word === 'check') {
    const { facts } = await gatherFacts($, 0)
    const lines = cfg.rules.map((t, i) => {
      const p = parseRule(t)

      return `${i + 1}. ${p.ok && ruleMatches(p.rule, facts) ? 'true ' : 'false'} ${t}`
    })

    return `Now: cost $${facts.cost.toFixed(2)}, context ${Math.round(facts.context)}%, errors ${facts.errors}/10 (duration is known only at turn end).\n${lines.join('\n') || 'No rules.'}`
  }
  const text = word === 'add' ? args.trim().slice(3).trim() : args.trim()
  const p = parseRule(text)

  if (!p.ok) {
    return p.error
  }
  if (cfg.rules.length >= RULES_MAX) {
    return `At most ${RULES_MAX} rules: remove one first (/axrule rm <n>).`
  }
  if (cfg.rules.includes(p.text)) {
    return 'That rule is already there.'
  }
  await saveCfg($, c => ({ ...c, rules: [...c.rules, p.text] }))

  return `Rule ${cfg.rules.length + 1} added: ${p.text}${(await read($, calmA)) && !p.rule.urgent ? '\nCalm is on, so only urgent rules run until calm is off.' : ''}`
}

const runCommand = async ($: Dollar, name: string, args: string): Promise<string> => {
  const cfg = await read($, cfgA)
  const a = args.trim()

  switch (name) {
    case 'ax':
      return helpText()
    case 'axpanel': {
      const tab = a.toLowerCase() === 'about' ? 'notes' : a.toLowerCase()

      if (a !== '' && !(TABS as readonly string[]).includes(tab)) {
        return `Tabs: ${TABS.map(t => (t === 'notes' ? 'about' : t)).join(', ')}`
      }
      const placed = await $.ui.open({ id: PANE, title: tr(cfg.lang, 'title'), focus: true }).catch(() => undefined)
      await setTab($, a === '' ? await read($, tabA) : tab)

      return placed?.isPlaced === false ? 'The pane could not be placed (the window may be too narrow); widen it and try again.' : 'Anim extra pane opened.'
    }
    case 'axdemo': {
      const isMoving = await playDemo($)

      return isMoving ? 'Playing the skeleton, ripple and day-night demos (about 4 s). Open /axpanel lab to watch.' : 'Motion is off or calm is on, so every demo shows its still frame. Turn motion on (/motion on) and calm off (/cfg calm off).'
    }
    case 'axglow': {
      const w = a.toLowerCase()

      if (w === 'on' || w === 'off') {
        await saveCfg($, c => ({ ...c, glow: w === 'on' }))

        if (w === 'off') {
          await clearUrgent($)
        }

        return w === 'on' ? 'Urgent glow on: the pane edge pulses and one band line shows while an urgent event (context 90%, a rate limit at 95%, or an urgent rule) is active.' : 'Urgent glow off.'
      }
      if (w === 'clear') {
        await clearUrgent($)

        return 'Cleared.'
      }
      if (w === 'test') {
        if (!cfg.glow) {
          return 'Glow is off: /axglow on first.'
        }
        await raiseUrgent($, 'test event')

        return 'Urgent test event for 10 s.'
      }

      return `Glow is ${cfg.glow ? 'on' : 'off'}. /axglow on | off | test | clear. Still colour only when motion is off or calm is on.`
    }
    case 'axalias': {
      const cmd = parseAliasArgs(a)

      if (cmd.kind === 'bad') {
        return cmd.error
      }
      if (cmd.kind === 'list') {
        const keys = Object.keys(cfg.aliases)

        return keys.length === 0
          ? 'No aliases. /axalias add s dashboard, then /axrun s fills the prompt with /dashboard. (This mod cannot register /s itself: commands are registered by name at session start.)'
          : keys.map(k => `${k} -> ${cfg.aliases[k]}`).join('\n')
      }
      if (cmd.kind === 'rm') {
        const r = removeAlias(cfg.aliases, cmd.name)

        if (!r.ok) {
          return r.error
        }
        await saveCfg($, c => ({ ...c, aliases: r.aliases }))

        return `Alias ${cmd.name} removed.`
      }
      const r = addAlias(cfg.aliases, cmd.name, cmd.target)

      if (!r.ok) {
        return r.error
      }
      await saveCfg($, c => ({ ...c, aliases: r.aliases }))

      return `Alias ${cmd.name.toLowerCase()} -> ${r.aliases[cmd.name.toLowerCase()]}. Use /axrun ${cmd.name.toLowerCase()} to fill the prompt (max ${ALIAS_MAX}).`
    }
    case 'axrun': {
      if (a === '') {
        const keys = Object.keys(cfg.aliases)

        return keys.length === 0 ? 'No aliases yet: /axalias add <name> <command>' : `Aliases: ${keys.join(', ')}. /axrun <alias> fills the prompt.`
      }
      const target = resolveAlias(cfg.aliases, a.split(/\s+/)[0] ?? '')

      if (target === undefined) {
        return `No alias "${clip(a, 20)}". /axalias list`
      }
      await fillPrompt($, target)

      return `Prompt filled with ${target}. Press Enter to run it.`
    }
    case 'axband': {
      const cmd = parseBandArgs(a)

      if (cmd.kind === 'bad') {
        return cmd.error
      }
      if (cmd.kind === 'status') {
        return `Hidden rows: ${cfg.band.hidden.join(', ') || 'none'}. Order: ${cfg.band.order.join(', ') || 'default'}. Default is no change; your own row (${SELF}) is never hidden.`
      }
      if (cmd.kind === 'reset') {
        await saveCfg($, c => ({ ...c, band: { hidden: [], order: [] } }))

        return 'Band back to its default.'
      }
      if (cmd.kind === 'order') {
        await saveCfg($, c => ({ ...c, band: { ...c.band, order: cmd.names } }))

        return `Band order: ${cmd.names.join(', ')} first, any others after.`
      }
      if (cmd.name === SELF) {
        return 'This mod\'s own row is never hidden.'
      }
      if (cmd.kind === 'hide' && !cfg.band.hidden.includes(cmd.name) && cfg.band.hidden.length >= BAND_MAX) {
        return `At most ${BAND_MAX} hidden rows.`
      }
      await saveCfg($, c => ({
        ...c,
        band: { ...c.band, hidden: cmd.kind === 'hide' ? [...new Set([...c.band.hidden, cmd.name])] : c.band.hidden.filter(n => n !== cmd.name) },
      }))

      return cmd.kind === 'hide' ? `Rows from ${cmd.name} are hidden above the prompt.` : `Rows from ${cmd.name} are shown again.`
    }
    case 'axrule':
      return runRule($, args)
    case 'axrecipe': {
      const [id = '', sw = ''] = a.split(/\s+/)

      if (id === '' || id === 'list') {
        return RECIPES.map(r => `${r.id} [${cfg.recipes[r.id] === true ? 'on' : 'off'}] ${r.title}`).join('\n')
      }
      const recipe = RECIPES.find(r => r.id === id)

      if (recipe === undefined || (sw !== 'on' && sw !== 'off')) {
        return `Usage: /axrecipe <${RECIPES.map(r => r.id).join('|')}> on|off`
      }
      await saveCfg($, c => ({ ...c, recipes: { ...c.recipes, [id]: sw === 'on' } }))

      return `Recipe ${id} ${sw}. Recipes run at the end of each turn on the same engine as /axrule (not when calm is on).`
    }
    case 'axthresh': {
      const [k = '', v = ''] = a.split(/\s+/)

      if (k === 'reset') {
        await saveCfg($, c => ({ ...c, thresholds: DEFAULT_THRESHOLDS }))

        return 'Thresholds back to defaults.'
      }
      if (k === '') {
        const t = cfg.thresholds

        return `slow call ${t.slowCallSec} s · large output ${t.largeOutputLines} lines · risky edit ${t.riskyEditLines} lines. /axthresh slow|output|edit <number>. Used only by this mod's own pane examples: no other mod reads them.`
      }
      const key = thresholdKeyOf(k)

      if (key === undefined) {
        return `Usage: /axthresh ${THRESHOLD_KEYS.map(x => THRESHOLDS[x].short).join('|')} <number> | reset`
      }
      const r = validateThreshold(key, v)

      if (!r.ok) {
        return r.error
      }
      await saveCfg($, c => ({ ...c, thresholds: { ...c.thresholds, [key]: r.value } }))

      return `${THRESHOLDS[key].label} is now ${r.value} ${THRESHOLDS[key].unit}. Used only in this mod's own examples.`
    }
    case 'axlang': {
      const l = a.toLowerCase()

      if (!isLang(l)) {
        return `Language of this mod's pane labels: ${LANGS.join(', ')} (now ${cfg.lang}). /axlang en|es|de`
      }
      await saveCfg($, c => ({ ...c, lang: l }))

      return `Pane labels are now in ${l}.`
    }
    case 'axglyph': {
      const cmd = parseGlyphArgs(a)

      if (cmd.kind === 'bad') {
        return cmd.error
      }
      if (cmd.kind === 'list') {
        const keys = Object.keys(cfg.glyphs)

        return keys.length === 0 ? 'No custom glyphs. /axglyph ts ★ (used only in this mod\'s pane).' : keys.map(k => `.${k} ${cfg.glyphs[k]}`).join('\n')
      }
      if (cmd.kind === 'rm') {
        await saveCfg($, c => ({ ...c, glyphs: Object.fromEntries(Object.entries(c.glyphs).filter(([k]) => k !== cmd.ext)) }))

        return `Glyph for .${cmd.ext} removed.`
      }
      if (!(cmd.ext in cfg.glyphs) && Object.keys(cfg.glyphs).length >= 40) {
        return 'At most 40 glyphs: remove one first.'
      }
      await saveCfg($, c => ({ ...c, glyphs: { ...c.glyphs, [cmd.ext]: cmd.glyph } }))

      return `.${cmd.ext} is now ${cmd.glyph} in this mod's pane.`
    }
    case 'axrate': {
      const cmd = parseRateArgs(a, KNOWN)

      if (cmd.kind === 'bad') {
        return cmd.error
      }
      if (cmd.kind === 'list') {
        const rows = Object.entries(cfg.ratings)

        return rows.length === 0 ? 'No ratings yet. /axrate <mod> <1-5> [note]' : rows.map(([m, r]) => `${m} ${starsOf(r.stars)}${r.note === '' ? '' : ` ${r.note}`}`).join('\n')
      }
      await saveCfg($, c => {
        const ratings = { ...c.ratings }

        if (cmd.stars === 0) {
          delete ratings[cmd.mod]
        } else {
          ratings[cmd.mod] = { stars: cmd.stars, note: cmd.note ?? c.ratings[cmd.mod]?.note ?? '' }
        }

        return { ...c, ratings }
      })

      return cmd.stars === 0 ? `Rating for ${cmd.mod} cleared.` : `${cmd.mod} ${starsOf(cmd.stars)}${cmd.note === null ? '' : ` "${cmd.note}"`}`
    }
    case 'axpreset': {
      const list = a === '' ? BUNDLES : BUNDLES.filter(b => b.id === a.toLowerCase())

      if (list.length === 0) {
        return `Presets: ${BUNDLES.map(b => b.id).join(', ')}`
      }

      return `${list.map(b => `${b.title}: ${b.about}\n${b.lines.map(l => `  ${l}`).join('\n')}`).join('\n')}\nThis mod cannot run other mods' commands: type each line, or use the Presets tab to fill the prompt.`
    }
    case 'axreset': {
      stopTicker()
      urgentTimer?.cancel()
      confettiTimer?.cancel()
      await update($, cfgA, () => DEFAULT_CFG)
      await update($, animA, () => NO_ANIM)
      await update($, runA, () => NO_RUN)
      await update($, firedA, () => NO_FIRED)
      await update($, flashA, () => '')
      await $.store.delete(STORE_KEY)

      return 'Anim extra: settings, aliases, rules, ratings, glyphs, thresholds and recorded calls cleared.'
    }
    default:
      return helpText()
  }
}

// ---- pane ------------------------------------------------------------------------------------------------
type Ctx = {
  lang: AxLang
  cfg: AxCfg
  now: number
  hour: number
  anim: AxAnim
  run: AxRun
  isMotion: boolean
  isCalm: boolean
  live: boolean
  accent: string
  density: string
  icons: string
  preset: string
  tab: string
  group: string
  sort: string
  flash: string
}

const t = (c: Ctx, key: LabelKey) => tr(c.lang, key)

const fillBtn = ($: Dollar, ui: UI, key: string, label: string, text: string) => {
  const { Button } = ui

  return <Button key={key} label={label} onPress={() => fillPrompt($, text)} />
}

const tabBar = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Button } = ui

  return (
    <Box gap="sm" flexWrap="wrap">
      {TABS.map(id => (
        <Button key={`tab-${id}`} label={id === c.tab ? `[${t(c, `tab_${id}` as LabelKey)}]` : t(c, `tab_${id}` as LabelKey)} onPress={() => setTab($, id)} />
      ))}
    </Box>
  )
}

const modRow = ($: Dollar, ui: UI, c: Ctx, m: (typeof CATALOG)[number]) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column">
      <Box gap="sm" flexWrap="wrap">
        <Text weight="bold" color={c.accent}>
          {m.name}
        </Text>
        {m.help !== null ? fillBtn($, ui, `help-${m.name}`, `/${m.help}`, `/${m.help}`) : <Text dimColor>(no command)</Text>}
      </Box>
      <Text dimColor wrap="truncate-end">
        {clip(m.desc, 110)}
      </Text>
    </Box>
  )
}

const settingsBlock = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text } = ui
  const row = (label: string, items: readonly string[], current: string, cmd: (v: string) => string) => (
    <Box gap="sm" flexWrap="wrap">
      <Text dimColor mono>
        {label.padEnd(8)}
      </Text>
      {items.map(v => fillBtn($, ui, `cfg-${label}-${v}`, v === current ? `[${v}]` : v, cmd(v)))}
    </Box>
  )

  return (
    <Box flexDirection="column" gap="xs">
      <Text>
        {t(c, 'current')}: preset {c.preset} · accent {c.accent} · density {c.density} · icons {c.icons} · calm {c.isCalm ? t(c, 'on') : t(c, 'off')}
      </Text>
      {row('preset', ['calm', 'focus', 'full'], c.preset, v => `/cfg preset ${v}`)}
      {row('accent', ACCENTS, c.accent, v => `/cfg accent ${v}`)}
      {row('density', ['compact', 'normal', 'airy'], c.density, v => `/cfg density ${v}`)}
      {row('icons', ['letters', 'symbols', 'minimal'], c.icons, v => `/cfg icons ${v}`)}
      {row('calm', ['on', 'off'], c.isCalm ? 'on' : 'off', v => `/cfg calm ${v}`)}
    </Box>
  )
}

const hubTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui
  const groups = GROUPS.filter(g => CATALOG.some(m => m.group === g))
  const group = groups.includes(c.group as (typeof GROUPS)[number]) ? c.group : 'settings'

  return (
    <Box flexDirection="column" gap="sm">
      <Box gap="sm" flexWrap="wrap">
        {groups.map(g => (
          <Button key={`group-${g}`} label={g === group ? `[${t(c, `g_${g}` as LabelKey)}]` : t(c, `g_${g}` as LabelKey)} onPress={() => update($, groupA, () => g)} />
        ))}
      </Box>
      {group === 'settings' && settingsBlock($, ui, c)}
      {CATALOG.filter(m => m.group === group).map(m => modRow($, ui, c, m))}
      <Text dimColor>{t(c, 'hint_fill')}</Text>
    </Box>
  )
}

const presetsTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="column" gap="sm">
      <Text dimColor>{t(c, 'hint_fill')}</Text>
      {BUNDLES.map(b => (
        <Box flexDirection="column">
          <Text weight="bold" color={c.accent}>
            {b.title}
          </Text>
          <Text dimColor>{b.about}</Text>
          {b.lines.map((line, i) => (
            <Box gap="sm">
              <Button
                key={`chk-${b.id}-${i}`}
                label={c.cfg.checks[`${b.id}:${i}`] === true ? '[x]' : '[ ]'}
                onPress={() => saveCfg($, cfg => ({ ...cfg, checks: { ...cfg.checks, [`${b.id}:${i}`]: cfg.checks[`${b.id}:${i}`] !== true } }))}
              />
              <Text mono>{line}</Text>
              {fillBtn($, ui, `pfill-${b.id}-${i}`, t(c, 'fill'), line)}
            </Box>
          ))}
          <Box>
            <Button key={`pcopy-${b.id}`} label={t(c, 'copy_all')} onPress={press => copyText($, b.lines.join('\n'), press.surface, c.lang)} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

const modsTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="column" gap="sm">
      <Text dimColor>Disabling is done with the claude command line, not from here. Copy a line and run it in a terminal, then restart the session.</Text>
      {CATALOG.map(m => {
        const users = CATALOG.filter(o => o.deps.includes(m.name)).map(o => o.name)
        const line = `claude plugin disable ${m.name}@local-mods`

        return (
          <Box flexDirection="column">
            <Text weight="bold" color={c.accent}>
              {m.name}
            </Text>
            <Text dimColor wrap="truncate-end">
              {clip(m.desc, 140)}
            </Text>
            {users.length > 0 && (
              <Text color="warning">
                {t(c, 'needed_by')}: {users.join(', ')}
              </Text>
            )}
            <Box gap="sm" flexWrap="wrap">
              <Text mono>{line}</Text>
              <Button key={`dis-${m.name}`} label={t(c, 'copy')} onPress={press => copyText($, line, press.surface, c.lang)} />
            </Box>
            <Text dimColor mono>
              {t(c, 'enable')}: claude plugin enable {m.name}@local-mods
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

const aliasTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui
  const keys = Object.keys(c.cfg.aliases)

  return (
    <Box flexDirection="column" gap="sm">
      <Text>/axalias add s dashboard, then /axrun s fills the prompt with /dashboard.</Text>
      <Text dimColor>An alias is not a new slash command: commands are registered by name when the session starts, so this mod fills the prompt for you to run.</Text>
      {keys.length === 0 && <Text dimColor>{t(c, 'no_aliases')}</Text>}
      {keys.map(k => (
        <Box gap="sm">
          <Text mono weight="bold">
            {k}
          </Text>
          <Text dimColor mono>
            {c.cfg.aliases[k]}
          </Text>
          {fillBtn($, ui, `afill-${k}`, t(c, 'fill'), c.cfg.aliases[k] ?? '')}
          <Button
            key={`arm-${k}`}
            label={t(c, 'remove')}
            onPress={() =>
              saveCfg($, cfg => {
                const r = removeAlias(cfg.aliases, k)

                return r.ok ? { ...cfg, aliases: r.aliases } : cfg
              })
            }
          />
        </Box>
      ))}
    </Box>
  )
}

const bandTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui
  const { hidden, order } = c.cfg.band

  return (
    <Box flexDirection="column" gap="sm">
      <Text>
        {t(c, 'hidden')}: {hidden.join(', ') || t(c, 'none')} · {t(c, 'order')}: {order.join(', ') || 'default'}
      </Text>
      <Text dimColor>Default is no change. This applies to rows other mods draw above the prompt; a mod with no row there is unaffected. Command: /axband hide|show &lt;plugin&gt; | order a,b,c | reset.</Text>
      <Box gap="sm" flexWrap="wrap">
        {CATALOG.filter(m => m.name !== SELF).map(m => (
          <Button
            key={`band-${m.name}`}
            label={`${hidden.includes(m.name) ? '✗' : '✓'} ${m.name}`}
            onPress={() => saveCfg($, cfg => ({ ...cfg, band: { ...cfg.band, hidden: cfg.band.hidden.includes(m.name) ? cfg.band.hidden.filter(n => n !== m.name) : [...cfg.band.hidden, m.name].slice(-BAND_MAX) } }))}
          />
        ))}
      </Box>
    </Box>
  )
}

/** One bar the width of `text`: sliding bright run when live, plain grey when still. */
const skeletonBar = (ui: UI, c: Ctx, width: number, now: number, live: boolean) => {
  const { Box, Text } = ui
  const s = shimmer(width, now, live)

  return (
    <Box>
      {s.before !== '' && <Text dimColor>{s.before}</Text>}
      {s.hot !== '' && <Text color={c.accent}>{s.hot}</Text>}
      {s.after !== '' && <Text dimColor>{s.after}</Text>}
    </Box>
  )
}

/** The card list: every card has the same rows in both states, so nothing jumps when content arrives. */
const cardList = (ui: UI, c: Ctx, age: number, live: boolean) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column" gap="xs">
      {SAMPLE_CARDS.map((card, i) => {
        const isSkeleton = cardState(i, age, live) === 'skeleton'

        return (
          <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="sm">
            {isSkeleton ? skeletonBar(ui, c, card.title.length, c.now, live) : <Text weight="bold">{card.title}</Text>}
            {isSkeleton ? skeletonBar(ui, c, card.meta.length, c.now + 160, live) : <Text dimColor>{card.meta}</Text>}
            {isSkeleton ? skeletonBar(ui, c, card.body.length, c.now + 320, live) : <Text>{card.body}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

const stripView = (ui: UI, c: Ctx, hour: number, sweep: number) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column">
      <Text color={c.accent} mono>
        {sweep >= 0 ? markerRow(sweep, '▼') : ' '}
      </Text>
      <Box>
        {hourStrip().map(cell => (
          <Text color={cell.color}>{cell.ch}</Text>
        ))}
      </Box>
      <Text color={c.accent} mono>
        {markerRow(hour, '▲')}
      </Text>
      <Text dimColor mono>
        {'0    6    12   18   24'}
      </Text>
    </Box>
  )
}

const labTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui
  const skelAge = ageOf(c.anim.skelAt, c.now)
  const ringAge = ageOf(c.anim.rippleAt, c.now)
  const isUrgent = c.anim.urgentAt > 0
  const tone = glowTone(ageOf(c.anim.urgentAt, c.now), c.live)

  return (
    <Box flexDirection="column" gap="sm">
      {!c.live && <Text color="warning">{t(c, 'motion_off')}</Text>}
      <Text weight="bold" color={c.accent}>
        {t(c, 'skeleton')}
      </Text>
      {cardList(ui, c, skelAge, c.live)}
      <Box>
        <Button key="skel-replay" label={t(c, 'replay')} onPress={() => play($, tm => ({ skelAt: tm }))} />
      </Box>
      <Text weight="bold" color={c.accent}>
        {t(c, 'ripple')}
      </Text>
      <Box gap="sm">
        <Text mono>{ringFrame(ringAge, c.live)}</Text>
        <Text>
          {c.anim.notif} {t(c, 'notifications')}
        </Text>
        <Button key="notif-new" label={t(c, 'new_notification')} onPress={() => bumpNotif($)} />
      </Box>
      <Text weight="bold" color={c.accent}>
        {t(c, 'glow')}
      </Text>
      <Box gap="sm">
        <Text color={isUrgent ? tone : 'inactive'} mono>
          {'━━━━━━━━━━━━'}
        </Text>
        <Text dimColor>
          {c.cfg.glow ? t(c, 'on') : t(c, 'off')}
          {isUrgent ? ` · ${c.anim.urgentText}` : ''}
        </Text>
        <Button key="glow-toggle" label={c.cfg.glow ? `${t(c, 'off')}` : `${t(c, 'on')}`} onPress={() => runCommand($, 'axglow', c.cfg.glow ? 'off' : 'on')} />
        <Button key="glow-test" label={t(c, 'test_glow')} onPress={() => runCommand($, 'axglow', 'test')} />
      </Box>
      <Text weight="bold" color={c.accent}>
        {t(c, 'daynight')}
      </Text>
      {stripView(ui, c, c.hour, sweepCell(ageOf(c.anim.sweepAt, c.now), c.live))}
    </Box>
  )
}

const motionTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui
  const isLooping = c.live && c.anim.loopUntil > c.now
  const loop = isLooping ? c.now - c.anim.loopAt : -1
  const hour = c.hour
  const skelCycle = skeletonTotal(SAMPLE_CARDS.length) + 800
  const skelAge = loop < 0 ? 600 : loop % skelCycle
  const ringAge = loop < 0 ? RING_FRAME_MS : loop % 1200
  const glowAge = loop < 0 ? 0 : loop
  const sweepAge = loop < 0 ? 6 * SWEEP_MS : loop % (24 * SWEEP_MS + 600)
  const label = (isLooping ? t(c, 'animated') : t(c, 'paused')) + (c.live ? '' : ` (${t(c, 'off')})`)
  const head = (name: string) => (
    <Text weight="bold" color={c.accent}>
      {name}
    </Text>
  )
  const small = SAMPLE_CARDS.slice(0, 1)

  return (
    <Box flexDirection="column" gap="sm">
      <Text dimColor>Each animation twice: the still frame you get with motion off or calm on, and the moving one. The right side moves for {LOOP_MS / 1000} s after Play.</Text>
      <Box>
        <Button key="loop-play" label={t(c, 'play')} onPress={() => play($, tm => ({ loopAt: tm, loopUntil: tm + LOOP_MS }))} />
      </Box>
      {head(t(c, 'skeleton'))}
      <Box gap="md" flexWrap="wrap">
        <Box flexDirection="column">
          <Text dimColor>{t(c, 'still')}</Text>
          {small.map(card => (
            <Box flexDirection="column">
              <Text weight="bold">{card.title}</Text>
              <Text dimColor>{card.meta}</Text>
              <Text>{card.body}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text dimColor>{label}</Text>
          {small.map(card => (
            <Box flexDirection="column">
              {cardState(0, skelAge, true) === 'skeleton' ? skeletonBar(ui, c, card.title.length, c.now, true) : <Text weight="bold">{card.title}</Text>}
              {cardState(0, skelAge, true) === 'skeleton' ? skeletonBar(ui, c, card.meta.length, c.now + 160, true) : <Text dimColor>{card.meta}</Text>}
              {cardState(0, skelAge, true) === 'skeleton' ? skeletonBar(ui, c, card.body.length, c.now + 320, true) : <Text>{card.body}</Text>}
            </Box>
          ))}
        </Box>
      </Box>
      {head(t(c, 'ripple'))}
      <Box gap="md">
        <Text mono>
          {t(c, 'still')} {ringFrame(-1, false)} 3
        </Text>
        <Text mono>
          {label} {ringFrame(ringAge, true)} 3
        </Text>
      </Box>
      {head(t(c, 'glow'))}
      <Box gap="md">
        <Text color={glowTone(0, false)} mono>
          {t(c, 'still')} {'━━━━━━'}
        </Text>
        <Text color={glowTone(glowAge, true)} mono>
          {label} {'━━━━━━'}
        </Text>
      </Box>
      {head(t(c, 'daynight'))}
      <Text dimColor>{t(c, 'still')}</Text>
      {stripView(ui, c, hour, -1)}
      <Text dimColor>{label}</Text>
      {stripView(ui, c, hour, loop < 0 ? 6 : sweepCell(sweepAge, true))}
      <Text dimColor mono>
        {`gradient: ${hourColor(0.5)} ${hourColor(6.5)} ${hourColor(12)} ${hourColor(18.5)} ${hourColor(23.5)}`}
      </Text>
    </Box>
  )
}

const rulesTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="column" gap="sm">
      <Text weight="bold" color={c.accent}>
        {t(c, 'rules')} ({c.cfg.rules.length}/{RULES_MAX})
      </Text>
      <Text dimColor>/axrule [urgent] if cost &gt; 5 and context &gt;= 50 then toast "text" | fill "text". Fields: cost, context, errors (last 10 calls), duration (turn seconds), testpass.</Text>
      <Text dimColor>Checked when a turn ends. Calm: only urgent rules run. Each rule at most once per 5 minutes, toasts at most one per 3 minutes.</Text>
      {c.cfg.rules.length === 0 && <Text dimColor>{t(c, 'no_rules')}</Text>}
      {c.cfg.rules.map((text, i) => (
        <Box gap="sm" flexWrap="wrap">
          <Text mono>
            {i + 1}. {text}
          </Text>
          <Button key={`rule-rm-${i}`} label={t(c, 'remove')} onPress={() => saveCfg($, cfg => ({ ...cfg, rules: cfg.rules.filter((_, j) => j !== i) }))} />
        </Box>
      ))}
      {fillBtn($, ui, 'rule-new', t(c, 'fill'), '/axrule if cost > 5 then toast "Cost is {cost}"')}
      <Text weight="bold" color={c.accent}>
        {t(c, 'recipes')}
      </Text>
      {RECIPES.map(r => (
        <Box gap="sm" flexWrap="wrap">
          <Button
            key={`recipe-${r.id}`}
            label={c.cfg.recipes[r.id] === true ? `[${t(c, 'on')}]` : `[${t(c, 'off')}]`}
            onPress={() => saveCfg($, cfg => ({ ...cfg, recipes: { ...cfg.recipes, [r.id]: cfg.recipes[r.id] !== true } }))}
          />
          <Text>{r.title}</Text>
        </Box>
      ))}
    </Box>
  )
}

const SAMPLE_FILES = ['src/app.ts', 'src/ui.tsx', 'tools/build.py', 'README.md', 'package.json', 'main.rs', 'cmd/main.go', 'run.sh', 'styles.css', 'index.html', 'ci.yml', 'notes.txt'] as const

const tuneTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui
  const th = c.cfg.thresholds
  const examples: [string, string][] = [
    [`12 s call`, classifyCall(12, th)],
    [`45 s call`, classifyCall(45, th)],
    [`150 lines of output`, classifyOutput(150, th)],
    [`900 lines of output`, classifyOutput(900, th)],
    [`20-line edit`, classifyEdit(20, th)],
    [`120-line edit`, classifyEdit(120, th)],
  ]
  const files = c.run.files.length > 0 ? c.run.files : [...SAMPLE_FILES]

  return (
    <Box flexDirection="column" gap="sm">
      <Text weight="bold" color={c.accent}>
        {t(c, 'language')}
      </Text>
      <Box gap="sm">
        {LANGS.map(l => (
          <Button key={`lang-${l}`} label={l === c.lang ? `[${l}]` : l} onPress={() => runCommand($, 'axlang', l)} />
        ))}
      </Box>
      <Text dimColor>Labels of this pane only; other mods stay in their own language.</Text>
      <Text weight="bold" color={c.accent}>
        {t(c, 'thresholds')}
      </Text>
      {THRESHOLD_KEYS.map(k => (
        <Box gap="sm">
          <Text mono>
            {THRESHOLDS[k].label.padEnd(13)} {String(th[k]).padStart(5)} {THRESHOLDS[k].unit}
          </Text>
          {fillBtn($, ui, `th-${k}`, t(c, 'fill'), `/axthresh ${THRESHOLDS[k].short} ${th[k]}`)}
        </Box>
      ))}
      <Text dimColor>Only the examples below use them; other mods cannot read these numbers.</Text>
      <Text>
        {t(c, 'example')}: {examples.map(([a, b]) => `${a} → ${b}`).join(' · ')}
      </Text>
      <Text>
        {t(c, 'last_call')}: {c.run.lastTool === '' ? t(c, 'none') : `${c.run.lastTool} ${(c.run.lastMs / 1000).toFixed(1)} s → ${classifyCall(c.run.lastMs / 1000, th)}`}
      </Text>
      <Text weight="bold" color={c.accent}>
        {t(c, 'glyphs')}
      </Text>
      <Box gap="md" flexWrap="wrap">
        {files.map(f => (
          <Text mono>
            {glyphFor(extOf(f), c.icons, c.cfg.glyphs)} {shortPath(f)}
          </Text>
        ))}
      </Box>
      <Text dimColor>/axglyph ts ★ sets one; the settings icon pack ({c.icons}) is used for the rest.</Text>
    </Box>
  )
}

const marketTab = ($: Dollar, ui: UI, c: Ctx) => {
  const { Box, Text, Button } = ui
  const rate = (m: string) => c.cfg.ratings[m]?.stars ?? 0
  const list = [...CATALOG].sort((a, b) => (c.sort === 'rating' ? rate(b.name) - rate(a.name) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)))

  return (
    <Box flexDirection="column" gap="sm">
      <Box gap="sm">
        <Button key="market-sort" label={c.sort === 'rating' ? t(c, 'sort_rating') : t(c, 'sort_name')} onPress={() => update($, sortA, s => (s === 'rating' ? 'name' : 'rating'))} />
        <Text dimColor>{CATALOG.length} mods · {Object.keys(c.cfg.ratings).length} {t(c, 'rating')}</Text>
      </Box>
      {list.map(m => (
        <Box flexDirection="column">
          <Box gap="sm" flexWrap="wrap">
            <Text weight="bold" color={c.accent}>
              {m.name}
            </Text>
            <Button
              key={`rate-${m.name}`}
              label={starsOf(rate(m.name))}
              onPress={() => runCommand($, 'axrate', `${m.name} ${(rate(m.name) + 1) % 6}`)}
            />
            {fillBtn($, ui, `note-${m.name}`, 'note', `/axrate ${m.name} ${Math.max(1, rate(m.name))} `)}
          </Box>
          <Text dimColor wrap="truncate-end">
            {clip(m.desc, 110)}
          </Text>
          {(c.cfg.ratings[m.name]?.note ?? '') !== '' && <Text>{c.cfg.ratings[m.name]?.note}</Text>}
        </Box>
      ))}
    </Box>
  )
}

const notesTab = (ui: UI, c: Ctx) => {
  const { Box, Text } = ui
  const lines = [
    'Not built (no API): 164 cursor trail (there is no pointer event), 167 soft vignette (a mod cannot draw over the app), 175 custom shortcuts (a mod cannot register a keybinding; edit the keybindings file of the app).',
    'This pane cannot run other mods\' commands or their disable/enable lines: buttons fill the prompt or copy text, you press Enter.',
    '/axalias fills the prompt; it cannot create a new slash command at run time.',
    'The mod list is a snapshot made when this mod was built (tools/gen-catalog.py regenerates it).',
    'Thresholds, glyphs and language here are read only by this mod: no other mod sees them.',
    'The band controls (/axband) hide or reorder other mods\' rows with AbovePromptList; the result also depends on other mods\' own hooks.',
  ]

  return (
    <Box flexDirection="column" gap="sm">
      {lines.map(l => (
        <Text>{l}</Text>
      ))}
    </Box>
  )
}

const renderPane = async ($: Dollar, e: RenderE) => {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const cfg = await read($, cfgA)
  const motion = await isMotion($)
  const isCalm = await read($, calmA)
  const c: Ctx = {
    lang: cfg.lang,
    cfg,
    now: await read($, nowA),
    hour: hourOf(await $.clock.now()),
    anim: await read($, animA),
    run: await read($, runA),
    isMotion: motion,
    isCalm,
    live: motion && !isCalm,
    accent: await read($, accentA),
    density: await read($, densityA),
    icons: await read($, iconsA),
    preset: await read($, presetA),
    tab: await read($, tabA),
    group: await read($, groupA),
    sort: await read($, sortA),
    flash: await read($, flashA),
  }
  const pad = c.density === 'compact' ? 'xs' : c.density === 'airy' ? 'md' : 'sm'
  const body =
    c.tab === 'presets' ? presetsTab($, ui, c)
    : c.tab === 'mods' ? modsTab($, ui, c)
    : c.tab === 'alias' ? aliasTab($, ui, c)
    : c.tab === 'band' ? bandTab($, ui, c)
    : c.tab === 'lab' ? labTab($, ui, c)
    : c.tab === 'motion' ? motionTab($, ui, c)
    : c.tab === 'rules' ? rulesTab($, ui, c)
    : c.tab === 'tune' ? tuneTab($, ui, c)
    : c.tab === 'market' ? marketTab($, ui, c)
    : c.tab === 'notes' ? notesTab(ui, c)
    : hubTab($, ui, c)
  // The pane's own edge: drawn only when the glow is on; it pulses while an urgent event is active.
  const isUrgent = c.cfg.glow && c.anim.urgentAt > 0
  const edge = isUrgent ? glowTone(ageOf(c.anim.urgentAt, c.now), c.live) : 'inactive'

  return (
    <Box flexDirection="column" padding={pad} gap={pad} {...(c.cfg.glow ? { borderStyle: 'round', borderColor: edge } : {})}>
      <Text size="heading" weight="bold">
        {t(c, 'title')}
      </Text>
      {tabBar($, ui, c)}
      {c.flash !== '' && <Text color="success">{c.flash}</Text>}
      {body}
    </Box>
  )
}

const renderBand = async ($: Dollar, e: RenderE) => {
  const a = await read($, animA)
  const cfg = await read($, cfgA)
  const live = await isLive($)
  const now = await read($, nowA)
  const { Box, Text } = $.ui.resolve(e)

  if (cfg.glow && a.urgentAt > 0) {
    return (
      <Box>
        <Text color={glowTone(ageOf(a.urgentAt, now), live)}>⚠ urgent: {a.urgentText}</Text>
      </Box>
    )
  }

  return (
    <Box gap="sm">
      <Text color="success" mono>
        {confettiLine(ageOf(a.confettiAt, now), live)}
      </Text>
      <Text>{a.confettiText}</Text>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const raw = await $.store.get(STORE_KEY)
    await update($, cfgA, () => cleanCfg(raw, KNOWN))

    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description }).catch(() => undefined)
    }

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({ text: await runCommand($, name, e.args) })).catch(() => ({ text: `/${name} failed; nothing was changed.` }))
  }

  on('tool.call', async ($, e, next) => {
    const info = e as unknown as CallInfo
    const started = await $.clock.now()
    let outcome: unknown
    let isThrown = true

    try {
      const ran = await next(e)
      outcome = ran
      isThrown = false

      return ran
    } finally {
      await afterCall($, info, started, outcome, isThrown).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await afterTurn($, e.durationMs).catch(() => undefined)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))

  // One band segment, and only while there is something to say: an urgent event, or a recipe's confetti line.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const a = await read($, animA)
    const cfg = await read($, cfgA)

    if (e.props.hasSurvey || !((cfg.glow && a.urgentAt > 0) || a.confettiAt > 0)) {
      return next(e)
    }

    return renderBand($, e)
  })

  // Hide or reorder other mods' rows, only when the person set it up: the default is no change.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const { band } = await read($, cfgA)

    if (e.props.hasSurvey || (band.hidden.length === 0 && band.order.length === 0)) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, rows: arrangeRows(e.props.rows, band.hidden, band.order) } })
  })
}
