import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register } from 'claude-code'

import type { SwitchView } from './pure'
import type { Bundles, CliState, Installed, InstalledState, LogEntry, Pending, RemoteResult, Step, Tab } from '../types'
import { CATALOG } from './catalog'
import {
  BUNDLE_RE,
  CATEGORIES,
  COMMANDS,
  DEFAULT_MARKET,
  FEATURE_PRESETS,
  FETCH_MAX_CHARS,
  FETCH_TIMEOUT_MS,
  GUARDS,
  LOG_MAX,
  MAX_BUNDLES,
  RUN_TIMEOUT_MS,
  SELF,
  YES_WORD,
  allBundleNames,
  buildReport,
  changedSwitches,
  cleanOverrides,
  bundleMembers,
  chipFor,
  clip,
  diffRemote,
  featureArgs,
  featureLine,
  featureRows,
  discoverBundled,
  findInstalled,
  findMod,
  fmtEntry,
  formatOutput,
  hasNewer,
  headLines,
  helpText,
  isBuiltinBundle,
  isMarketName,
  isPersonOrigin,
  isGuard,
  looksLikeVersionOutput,
  makePending,
  mkEntry,
  modsInCategory,
  normalizeLog,
  parseBundleArgs,
  parseDoArgs,
  parseModList,
  parsePluginList,
  parseSourceUrl,
  paginateUnits,
  parseFeaturesArgs,
  pendingState,
  presetArgs,
  planBundle,
  pushLog,
  repoFromUrl,
  resolveTarget,
  sanitize,
  searchCatalog,
  secondsLeft,
  statusOf,
  stepArgv,
  stepIsValid,
  stepLine,
  validateMarketplace,
  VERBS,
} from './pure'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'mod-manager-main'
const TABS: readonly (readonly [Tab, string])[] = [
  ['catalog', 'Catalog'],
  ['installed', 'Installed'],
  ['features', 'Features'],
  ['bundles', 'Bundles'],
  ['source', 'Source'],
  ['log', 'Log'],
]

// ------------------------------------------------------------------ state

const queryA = atom({ plugin: 'mod-manager', key: 'query' } as const, '')
const presetA = atom({ plugin: 'mod-manager', key: 'preset' } as const, { name: '', at: 0 }, { shape: 'preset-1' })

const BANNER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 76" width="420" height="76"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a3fc4"/><stop offset="1" stop-color="#0d7f76"/></linearGradient></defs><rect width="420" height="76" rx="14" fill="url(#g)"/><path d="M0 58C80 26 150 74 240 44S360 20 420 40L420 58C340 44 300 76 220 66S90 52 0 76Z" fill="#ffffff" fill-opacity="0.12"/><text x="20" y="35" font-family="-apple-system, sans-serif" font-size="22" font-weight="600" fill="#ffffff">Mod manager</text><text x="20" y="57" font-family="-apple-system, sans-serif" font-size="13" fill="#e8e6ff">Settings for your mods</text></svg>'
const tabA = atom({ plugin: 'mod-manager', key: 'tab' } as const, 'catalog')
const pageA = atom({ plugin: 'mod-manager', key: 'page' } as const, 0)
const categoryA = atom({ plugin: 'mod-manager', key: 'category' } as const, 'all')
const selectedA = atom({ plugin: 'mod-manager', key: 'selected' } as const, '')
const selectedBundleA = atom({ plugin: 'mod-manager', key: 'selectedBundle' } as const, '')
const noticeA = atom({ plugin: 'mod-manager', key: 'notice' } as const, '')
const marketA = atom({ plugin: 'mod-manager', key: 'market' } as const, DEFAULT_MARKET)
const sourceA = atom({ plugin: 'mod-manager', key: 'source' } as const, '')
const featureSearchA = atom({ plugin: 'mod-manager', key: 'featureSearch' } as const, '')
const installedA = atom({ plugin: 'mod-manager', key: 'installed' } as const, null, { shape: 'installed-1' })
const cliA = atom({ plugin: 'mod-manager', key: 'cli' } as const, { status: 'unknown', at: 0 }, { shape: 'cli-1' })
const pendingA = atom({ plugin: 'mod-manager', key: 'pending' } as const, null, { shape: 'pending-1' })
const logA = atom({ plugin: 'mod-manager', key: 'log' } as const, [], { shape: 'log-1' })
const remoteA = atom({ plugin: 'mod-manager', key: 'remote' } as const, null, { shape: 'remote-1' })
const bundlesA = atom({ plugin: 'mod-manager', key: 'bundles' } as const, {}, { shape: 'bundles-1' })

// Foreign atoms from the `settings` mod: read only, with defaults when it never wrote them.
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
// The feature switches: ONLY overrides, `{ '<mod>.<id>': boolean }`; an absent id means that switch's default. Read only:
// settings owns it, and this mod changes a switch by running `/cfg feature ...`, never by writing the atom.
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })

// Session memory only: the argv prefix that reached the CLI, and a lock against two applies at once.
let cliCache: { argv: string[]; via: 'path' | 'bundled' } | undefined
let isRunning = false

// ------------------------------------------------------------------ small helpers

const homeOf = ($: Dollar): Promise<string | undefined> => $.env.get('HOME').catch(() => undefined)

const nowOf = ($: Dollar): Promise<number> => $.clock.now().catch(() => 0)

const setNotice = ($: Dollar, text: string) => update($, noticeA, () => clip(text, 300))

const addLog = async ($: Dollar, entry: LogEntry) => {
  const next = pushLog(await read($, logA), entry)
  await update($, logA, () => next)
  await $.store.set('mm.log', next).catch(() => undefined)
}

const installedList = async ($: Dollar): Promise<Installed[] | null> => {
  const state = await read($, installedA)

  return state === null || state.error !== '' ? null : state.list
}

const fillPrompt = async ($: Dollar, text: string, what: string) => {
  const done = await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)
  await setNotice($, done?.isFilled === true ? `${what}: put in the prompt box. Nothing was sent.` : `${what}: could not fill the prompt box. Line: ${text}`)
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** Resolves 'timeout' after `ms`; `cancel()` stops the timer once the real answer is in. */
const timeoutAfter = ($: Dollar, ms: number) => {
  let cancel: () => void = () => undefined
  const promise = new Promise<'timeout'>(resolve => {
    const timer = $.clock.after(ms, () => resolve('timeout'))
    cancel = () => timer.cancel()
  })

  return { promise, cancel: () => cancel() }
}

// ------------------------------------------------------------------ the CLI

const probe = async ($: Dollar, argv: string[]): Promise<boolean> => {
  const r = await $.process.run([...argv, '--version'], { timeoutMs: 15_000 }).catch(() => undefined)

  return r !== undefined && r.exitCode === 0 && looksLikeVersionOutput(r.stdout)
}

/** `claude` on PATH first, then the desktop app's bundled binary. Cached for the session once it works. */
const findCli = async ($: Dollar): Promise<{ argv: string[]; via: 'path' | 'bundled' } | undefined> => {
  if (cliCache !== undefined) {
    return cliCache
  }
  const now = await nowOf($)

  if (await probe($, ['claude'])) {
    cliCache = { argv: ['claude'], via: 'path' }
  } else {
    const found = await discoverBundled(await homeOf($), path => $.fs.list(path))

    for (const candidate of found) {
      if (await probe($, [candidate])) {
        cliCache = { argv: [candidate], via: 'bundled' }
        break
      }
    }
  }
  const state: CliState = { status: cliCache?.via ?? 'none', at: now }
  await update($, cliA, () => state)

  return cliCache
}

const NO_CLI = [
  'The Claude CLI could not be reached (not `claude` on PATH, and no bundled copy under the desktop app folder).',
  'Nothing was run. Run the command lines yourself in a terminal, or use the copy buttons in the pane.',
].join('\n')

/** Read-only: `plugin list`. Updates the installed state either way. */
const refreshInstalled = async ($: Dollar): Promise<InstalledState> => {
  const now = await nowOf($)
  const cli = await findCli($)
  let state: InstalledState

  if (cli === undefined) {
    state = { loadedAt: now, list: [], error: 'Claude CLI not reachable' }
  } else {
    let r = await $.process.run([...cli.argv, 'plugin', 'list', '--json'], { timeoutMs: 30_000 }).catch(() => undefined)

    if (r !== undefined && r.exitCode !== 0 && /unknown option|--json/i.test(r.stderr)) {
      r = await $.process.run([...cli.argv, 'plugin', 'list'], { timeoutMs: 30_000 }).catch(() => undefined)
    }

    if (r === undefined) {
      state = { loadedAt: now, list: [], error: 'plugin list could not be started or timed out' }
    } else if (r.exitCode !== 0) {
      state = { loadedAt: now, list: [], error: clip(sanitize(r.stderr || r.stdout, await homeOf($)), 160) || `plugin list exited ${r.exitCode}` }
    } else {
      const parsed = parsePluginList(r.stdout)
      state = parsed.ok ? { loadedAt: now, list: parsed.list, error: '' } : { loadedAt: now, list: [], error: parsed.error }
    }
  }
  await update($, installedA, () => state)

  return state
}

const ensureInstalled = async ($: Dollar): Promise<Installed[] | null> => {
  const have = await installedList($)

  if (have !== null) {
    return have
  }
  const state = await refreshInstalled($)

  return state.error === '' ? state.list : null
}

// ------------------------------------------------------------------ loading and resetting

const normalizeBundles = (raw: unknown): Bundles => {
  const out: Bundles = {}

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out
  }

  for (const [name, mods] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_BUNDLES)) {
    if (!BUNDLE_RE.test(name) || isBuiltinBundle(name) || !Array.isArray(mods)) {
      continue
    }
    const parsed = parseModList(mods.filter((m): m is string => typeof m === 'string').join(' '))

    if (parsed.ok) {
      out[name] = parsed.mods
    }
  }

  return out
}

const load = async ($: Dollar) => {
  const [market, source, bundles, log] = await Promise.all(['mm.market', 'mm.source', 'mm.bundles', 'mm.log'].map(k => $.store.get(k).catch(() => undefined)))
  await update($, marketA, () => (typeof market === 'string' && isMarketName(market) ? market : DEFAULT_MARKET))
  const url = typeof source === 'string' ? parseSourceUrl(source) : undefined
  await update($, sourceA, () => (url?.ok === true ? url.url : ''))
  await update($, bundlesA, () => normalizeBundles(bundles))
  await update($, logA, () => normalizeLog(log))
}

const resetAll = async ($: Dollar): Promise<string> => {
  for (const key of ['mm.market', 'mm.source', 'mm.bundles', 'mm.log']) {
    await $.store.delete(key).catch(() => undefined)
  }
  await update($, marketA, () => DEFAULT_MARKET)
  await update($, sourceA, () => '')
  await update($, featureSearchA, () => '')
  await update($, bundlesA, () => ({}))
  await update($, logA, () => [])
  await update($, pendingA, () => null)
  await update($, remoteA, () => null)
  await update($, installedA, () => null)
  await update($, selectedA, () => '')
  await update($, selectedBundleA, () => '')
  await update($, noticeA, () => '')
  cliCache = undefined
  await update($, cliA, () => ({ status: 'unknown', at: 0 }))

  return 'Mod manager data cleared: log, pending action, user bundles, source URL, marketplace name (back to local-mods) and the installed-list cache.'
}

// ------------------------------------------------------------------ actions: pending, confirm, cancel

const planLines = (steps: readonly Step[]): string[] => steps.map((s, i) => `  ${steps.length > 1 ? `${i + 1}. ` : ''}${stepLine(s)}`)

const storePending = async ($: Dollar, steps: Step[], label: string, note: string): Promise<string> => {
  const now = await nowOf($)
  const had = (await read($, pendingA)) !== null
  const pending = makePending(steps, label, now, note)
  await update($, pendingA, () => pending)
  await addLog($, mkEntry(now, 'pending', `${label}${note === '' ? '' : ` (${note})`}`, { argv: steps.map(stepLine).join(' ; ') }))

  return [
    `Pending (${steps.length} step${steps.length === 1 ? '' : 's'}, expires in 2 minutes${had ? '; it replaced an earlier pending action' : ''}). This will run, with no shell:`,
    ...planLines(steps),
    ...(note === '' ? [] : [note]),
    'Nothing has run. Type /mmdo confirm to run exactly this, or /mmdo cancel. (The binary shows as `claude`; it is the one found at run time.)',
  ].join('\n')
}

const startAction = async ($: Dollar, args: string): Promise<string> => {
  const parsed = parseDoArgs(args)

  if (parsed.kind === 'help') {
    const p = await read($, pendingA)
    const now = await nowOf($)
    const state = pendingState(p, now)

    return [
      'Usage: /mmdo <install|enable|disable|update|uninstall> <name[@marketplace]> [--scope user|project|local]',
      '       /mmdo confirm   run the pending action, exactly as printed',
      '       /mmdo cancel    drop it',
      `Guards (${GUARDS.join(', ')}) need ${YES_WORD} to be disabled or uninstalled. ${SELF} is never disabled or uninstalled from here.`,
      state === 'valid' && p !== null ? `Pending now (${secondsLeft(p, now)} s left):\n${planLines(p.steps).join('\n')}` : 'Nothing is pending.',
    ].join('\n')
  }

  if (parsed.kind === 'cancel') {
    return cancelPending($)
  }

  if (parsed.kind === 'confirm') {
    return confirmPending($)
  }

  if (parsed.kind === 'error') {
    await addLog($, mkEntry(await nowOf($), 'refused', parsed.message))

    return parsed.message
  }
  const target = resolveTarget(parsed.verb, parsed.name, await read($, marketA), await installedList($))
  const step: Step = { verb: parsed.verb, target, scope: parsed.scope }

  return storePending($, [step], `${parsed.verb} ${target}`, '')
}

const cancelPending = async ($: Dollar): Promise<string> => {
  const p = await read($, pendingA)

  if (p === null) {
    return 'Nothing is pending.'
  }
  await update($, pendingA, () => null)
  await addLog($, mkEntry(await nowOf($), 'cancel', `cancelled: ${p.label}`))

  return 'Pending action dropped. Nothing ran.'
}

const confirmPending = async ($: Dollar): Promise<string> => {
  const p: Pending | null = await read($, pendingA)
  const now = await nowOf($)
  const state = pendingState(p, now)

  if (state === 'none' || p === null) {
    return 'Nothing is pending. Start with /mmdo <verb> <name>.'
  }
  // A pending action is single use, however the run ends.
  await update($, pendingA, () => null)

  if (state === 'expired') {
    await addLog($, mkEntry(now, 'expired', `expired: ${p.label}`))

    return 'That pending action expired (2 minutes). Nothing ran. Start again with /mmdo <verb> <name>.'
  }

  if (isRunning) {
    return 'Another action is still running. Nothing new was started.'
  }
  const bad = p.steps.find(s => !stepIsValid(s))

  if (bad !== undefined) {
    await addLog($, mkEntry(now, 'refused', 'a stored step failed validation and was not run'))

    return 'Refused: a stored step failed validation. Nothing ran.'
  }
  const cli = await findCli($)

  if (cli === undefined) {
    await addLog($, mkEntry(now, 'refused', 'CLI not reachable', { argv: p.steps.map(stepLine).join(' ; ') }))

    return `${NO_CLI}\n${planLines(p.steps).join('\n')}`
  }
  isRunning = true
  const home = await homeOf($)
  const out: string[] = []
  let failed = false
  let ran = 0

  try {
    await addLog($, mkEntry(now, 'confirm', `confirmed: ${p.label} (${p.steps.length} step${p.steps.length === 1 ? '' : 's'})`, { argv: p.steps.map(stepLine).join(' ; ') }))

    for (const [i, step] of p.steps.entries()) {
      const line = stepLine(step)
      out.push(`[${i + 1}/${p.steps.length}] ${line}`)
      const result = await $.process.run(stepArgv(cli.argv, step), { timeoutMs: RUN_TIMEOUT_MS }).catch((e: unknown) => ({
        exitCode: -1,
        stdout: '',
        stderr: `could not run or timed out after ${RUN_TIMEOUT_MS / 1000} s: ${e instanceof Error ? e.message : String(e)}`,
      }))
      ran++
      const lines = formatOutput(result.stdout, result.stderr, home)
      out.push(`exit ${result.exitCode}`, ...lines.slice(-(p.steps.length > 1 ? 40 : 200)))
      await addLog($, mkEntry(await nowOf($), 'result', `exit ${result.exitCode}`, { argv: line, exit: result.exitCode, head: headLines(lines), home }))

      if (result.exitCode !== 0) {
        failed = true
        break
      }
    }
  } finally {
    isRunning = false
  }

  if (failed && ran < p.steps.length) {
    out.push(`Stopped at the first failure; ${p.steps.length - ran} step${p.steps.length - ran === 1 ? '' : 's'} not run.`)
  } else if (!failed) {
    out.push('Done. A restart or reload may be needed before Claude shows the change.')
    await refreshInstalled($)
  }
  const summary = failed ? `mod-manager: ${p.label} failed (see /mmdo output or the Log tab)` : `mod-manager: ${p.label} done`
  $.ui.toast(summary, { timeoutMs: 6000 })

  return out.join('\n')
}

// ------------------------------------------------------------------ commands

const installedLines = (list: readonly Installed[]): string[] =>
  [...list]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(i => `${i.status === 'enabled' ? '●' : i.status === 'disabled' ? '○' : '✕'} ${i.id}  ${i.version === '' ? '?' : i.version}  ${i.scope}  ${i.status}`)

const listCommand = async ($: Dollar): Promise<string> => {
  const state = await refreshInstalled($)
  const cli = await read($, cliA)

  if (state.error !== '') {
    return [`Could not read the installed plugins: ${state.error}.`, cli.status === 'none' ? NO_CLI : '', 'Run `claude plugin list` yourself to see them.'].filter(l => l !== '').join('\n')
  }
  const via = cli.status === 'bundled' ? " (the desktop app's bundled CLI)" : cli.status === 'path' ? ' (claude on PATH)' : ''

  return [`${state.list.length} installed plugin${state.list.length === 1 ? '' : 's'}${via}:`, ...installedLines(state.list)].join('\n')
}

const catCommand = async ($: Dollar, args: string): Promise<string> => {
  const want = args.trim().toLowerCase()
  const known: readonly string[] = CATEGORIES

  if (want !== '' && !known.includes(want)) {
    return `Categories: ${CATEGORIES.join(', ')}`
  }
  const list = await installedList($)
  const lines: string[] = []

  for (const cat of CATEGORIES) {
    if (want !== '' && cat !== want) {
      continue
    }
    const mods = modsInCategory(CATALOG, cat)

    if (mods.length === 0) {
      continue
    }
    lines.push(`${cat} (${mods.length})`)

    for (const m of mods) {
      const chip = chipFor(statusOf(list, m.name), 'symbols', hasNewer(list, m))
      lines.push(`  ${chip.text} ${m.name} ${m.version}${m.help === null ? '' : `  /${m.help}`}  ${clip(m.description, 80)}`)
    }
  }

  return [`${CATALOG.length} mods in the catalog${list === null ? ' (status unknown: run /mmlist)' : ''}:`, ...lines].join('\n')
}

const bundleCommand = async ($: Dollar, args: string): Promise<string> => {
  const parsed = parseBundleArgs(args)
  const user = await read($, bundlesA)

  if (parsed.kind === 'error') {
    return parsed.message
  }

  if (parsed.kind === 'list') {
    return [
      'Bundles:',
      ...allBundleNames(user).map(n => `  ${n} (${bundleMembers(n, user, CATALOG)?.length ?? 0} mods${isBuiltinBundle(n) ? '' : ', yours'}): ${clip((bundleMembers(n, user, CATALOG) ?? []).join(', '), 90)}`),
      'Use /mmbundle show <name>, /mmbundle apply <name> [verb], /mmbundle add <name> <mod,mod>, /mmbundle rm <name>.',
    ].join('\n')
  }

  if (parsed.kind === 'add') {
    if (Object.keys(user).length >= MAX_BUNDLES && !hasOwn(user, parsed.name)) {
      return `At most ${MAX_BUNDLES} bundles of your own.`
    }
    const next = { ...user, [parsed.name]: parsed.mods }
    await update($, bundlesA, () => next)
    await $.store.set('mm.bundles', next).catch(() => undefined)
    const unknown = parsed.mods.filter(m => findMod(CATALOG, m) === undefined)

    return `Bundle ${parsed.name} saved: ${parsed.mods.join(', ')}.${unknown.length > 0 ? ` Not in the catalog (fine for other plugins): ${unknown.join(', ')}.` : ''}`
  }

  if (parsed.kind === 'rm') {
    if (isBuiltinBundle(parsed.name)) {
      return `"${parsed.name}" is built in and cannot be removed.`
    }

    if (!hasOwn(user, parsed.name)) {
      return `No bundle of yours named "${parsed.name}".`
    }
    const { [parsed.name]: _gone, ...rest } = user
    await update($, bundlesA, () => rest)
    await $.store.set('mm.bundles', rest).catch(() => undefined)

    return `Bundle ${parsed.name} removed.`
  }
  const members = bundleMembers(parsed.name, user, CATALOG)

  if (members === undefined) {
    return `No bundle named "${clip(parsed.name, 30)}". Try /mmbundle list.`
  }
  const installed = await installedList($)
  const market = await read($, marketA)

  if (parsed.kind === 'show') {
    const plan = planBundle(members, 'auto', 'user', false, installed, market, CATALOG)

    return [
      `Bundle ${parsed.name}: ${members.join(', ')}`,
      plan.steps.length > 0 ? `Command lines (what /mmbundle apply ${parsed.name} would store):` : 'Nothing to do.',
      ...planLines(plan.steps),
      ...(plan.skipped.length > 0 ? [`Skipped: ${plan.skipped.join('; ')}`] : []),
      installed === null ? 'The installed list is unknown (run /mmlist), so every mod is shown as an install.' : '',
    ]
      .filter(l => l !== '')
      .join('\n')
  }
  const plan = planBundle(members, parsed.verb, parsed.scope, parsed.hasYes, installed, market, CATALOG)

  if (plan.steps.length === 0) {
    return `Nothing to do for ${parsed.name}.${plan.skipped.length > 0 ? ` Skipped: ${plan.skipped.join('; ')}` : ''}`
  }
  const note = [plan.skipped.length > 0 ? `Skipped: ${plan.skipped.join('; ')}.` : '', installed === null && parsed.verb === 'auto' ? 'Installed list unknown: every mod is an install.' : '']
    .filter(l => l !== '')
    .join(' ')

  return storePending($, plan.steps, `bundle ${parsed.name} (${parsed.verb})`, note)
}

const sourceCommand = async ($: Dollar, args: string): Promise<string> => {
  const text = args.trim()

  if (text === '') {
    const url = await read($, sourceA)

    return url === '' ? 'No source stored. Use /mmsource <https url of a marketplace.json> (hosts: github.com, raw.githubusercontent.com, gist.githubusercontent.com).' : `Source: ${url}\nRun /mmcheck to compare.`
  }

  if (text.toLowerCase() === 'off') {
    await update($, sourceA, () => '')
    await update($, remoteA, () => null)
    await $.store.delete('mm.source').catch(() => undefined)

    return 'Source cleared.'
  }
  const parsed = parseSourceUrl(text)
  const now = await nowOf($)

  if (!parsed.ok) {
    await addLog($, mkEntry(now, 'refused', `source refused: ${parsed.error}`))

    return `Not stored: ${parsed.error}`
  }
  await update($, sourceA, () => parsed.url)
  await update($, remoteA, () => null)
  await $.store.set('mm.source', parsed.url).catch(() => undefined)
  await addLog($, mkEntry(now, 'source', `source stored: ${parsed.url}`))

  return `Source stored: ${parsed.url}${parsed.note === '' ? '' : `\n${parsed.note}`}\nRun /mmcheck to compare it with this machine. Nothing is fetched until you do.`
}

const fetchRemote = async ($: Dollar, url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
  const timer = timeoutAfter($, FETCH_TIMEOUT_MS)
  const answer = await Promise.race([
    $.http.fetch(url, { method: 'GET' }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
    timer.promise,
  ])
  timer.cancel()

  if (answer === 'timeout') {
    return { ok: false, error: `no answer within ${FETCH_TIMEOUT_MS / 1000} s` }
  }

  if (answer instanceof Error) {
    return { ok: false, error: clip(sanitize(answer.message), 120) }
  }

  if (!answer.ok) {
    return { ok: false, error: `the server answered ${answer.status}` }
  }
  const declared = Number(answer.headers['content-length'] ?? 0)

  if (declared > FETCH_MAX_CHARS || answer.text.length > FETCH_MAX_CHARS) {
    return { ok: false, error: 'the answer is over 1 MB; refused' }
  }

  return { ok: true, text: answer.text }
}

const checkCommand = async ($: Dollar): Promise<string> => {
  const url = await read($, sourceA)

  if (url === '') {
    return 'No source stored. Use /mmsource <https url of a marketplace.json> first.'
  }
  const now = await nowOf($)
  const fetched = await fetchRemote($, url)

  if (!fetched.ok) {
    const result: RemoteResult = { at: now, url, total: 0, upToDate: 0, rows: [], error: fetched.error }
    await update($, remoteA, () => result)
    await addLog($, mkEntry(now, 'check', `check failed: ${fetched.error}`))

    return `Could not fetch the source: ${fetched.error}.`
  }
  const parsed = validateMarketplace(fetched.text)

  if (!parsed.ok) {
    const result: RemoteResult = { at: now, url, total: 0, upToDate: 0, rows: [], error: parsed.error }
    await update($, remoteA, () => result)
    await addLog($, mkEntry(now, 'check', `check refused: ${parsed.error}`))

    return `The source was refused: ${parsed.error}`
  }
  const installed = await ensureInstalled($)
  const diff = diffRemote(parsed.plugins, installed, CATALOG)
  const result: RemoteResult = { at: now, url, total: parsed.plugins.length, upToDate: diff.upToDate, rows: diff.rows, error: '' }
  await update($, remoteA, () => result)
  await addLog($, mkEntry(now, 'check', `checked ${parsed.plugins.length} plugins: ${diff.rows.filter(r => r.kind === 'new').length} new, ${diff.rows.filter(r => r.kind === 'update').length} newer`))
  const market = await read($, marketA)
  const repo = repoFromUrl(url)

  return [
    `Source has ${parsed.plugins.length} plugin${parsed.plugins.length === 1 ? '' : 's'}; ${diff.upToDate} up to date${installed === null ? ' (compared with the catalog: installed list unknown)' : ''}.`,
    ...(diff.rows.length === 0 ? ['Nothing new, nothing newer.'] : remoteLines(diff.rows, market)),
    ...(repo !== undefined && diff.rows.length > 0 ? [`If that marketplace is not added yet: claude plugin marketplace add ${repo}`] : []),
    'Nothing was installed. Copy a line, or use /mmdo to confirm and run one.',
  ].join('\n')
}

const remoteLines = (rows: RemoteResult['rows'], market: string): string[] =>
  rows.flatMap(r => [
    `${r.kind === 'new' ? 'NEW   ' : 'NEWER '} ${r.name} ${r.kind === 'update' ? `${r.installed} -> ${r.remote}` : r.remote}${r.description === '' ? '' : `  ${clip(r.description, 80)}`}`,
    `        ${stepLine({ verb: r.kind === 'new' ? 'install' : 'update', target: `${r.name}@${market}`, scope: 'user' })}`,
  ])

const marketCommand = async ($: Dollar, args: string): Promise<string> => {
  const name = args.trim()

  if (name === '') {
    return `Marketplace name for command lines: ${await read($, marketA)} (default ${DEFAULT_MARKET}). Change it with /mmmarket <name>.`
  }

  if (!isMarketName(name)) {
    return 'A marketplace name is lowercase letters, digits, . _ - (max 63), starting with a letter or digit.'
  }
  await update($, marketA, () => name)
  await $.store.set('mm.market', name).catch(() => undefined)

  return `Command lines will use @${name}.`
}

const searchCommand = (args: string): string => {
  const hits = searchCatalog(CATALOG, args)

  if (args.trim() === '') {
    return 'Usage: /mmsearch <text>'
  }

  return hits.length === 0
    ? `Nothing in the catalog matches "${clip(args, 40)}".`
    : [`${hits.length} match${hits.length === 1 ? '' : 'es'}:`, ...hits.map(m => `  ${m.name} ${m.version} [${m.category}]${m.help === null ? '' : ` /${m.help}`}  ${clip(m.description, 90)}`)].join('\n')
}

const cmdsCommand = (args: string): string => {
  const name = args.trim()

  if (name === '') {
    return 'Usage: /mmcmds <mod>. Mods: ' + CATALOG.map(m => m.name).join(', ')
  }
  const mod = findMod(CATALOG, name)

  if (mod === undefined) {
    const near = CATALOG.filter(m => m.name.includes(name.toLowerCase())).map(m => m.name)

    return `No catalog mod named "${clip(name, 40)}".${near.length > 0 ? ` Did you mean: ${near.join(', ')}?` : ''}`
  }

  return [
    `${mod.name} ${mod.version} [${mod.category}]${mod.deps.length > 0 ? ` (needs ${mod.deps.join(', ')})` : ''}`,
    mod.help === null ? 'No help command: it has no slash commands of its own that this catalog could read.' : `Help: /${mod.help}`,
    ...mod.cmds.map(c => `  /${c.name}${c.desc === '' ? '' : `: ${c.desc}`}`),
  ].join('\n')
}

const reportCommand = async ($: Dollar): Promise<string> => {
  const list = await ensureInstalled($)
  const cli = await read($, cliA)
  const me = findMod(CATALOG, SELF)

  return buildReport(me?.version ?? '0.1.0', cli.status, list, CATALOG.length)
}

const runCommand = async ($: Dollar, name: string, args: string, origin: unknown): Promise<string> => {
  switch (name) {
    case 'mm':
      await $.ui.open({ id: PANE, title: 'Mod manager' }).catch(() => undefined)

      return helpText()
    case 'mmsettings':
      await $.ui.open({ id: 'mod-settings', title: 'Mod manager' }).catch(() => undefined)

      return 'Mod manager settings opened.'
    case 'mmlist':
      return listCommand($)
    case 'mmcat':
      return catCommand($, args)
    case 'mmdo':
      // Only a person confirms: not a plugin, a schedule, a peer session or the SDK.
      if (args.trim().toLowerCase() === 'confirm' && !isPersonOrigin(origin)) {
        await addLog($, mkEntry(await nowOf($), 'refused', 'confirm refused: it did not come from a person typing'))

        return 'Refused: /mmdo confirm must be typed by you.'
      }

      return startAction($, args)
    case 'mmbundle':
      return bundleCommand($, args)
    case 'mmsource':
      return sourceCommand($, args)
    case 'mmcheck':
      return checkCommand($)
    case 'mmmarket':
      return marketCommand($, args)
    case 'mmfeatures':
      return featuresCommand($, args)
    case 'mmsearch':
      return searchCommand(args)
    case 'mmcmds':
      return cmdsCommand(args)
    case 'mmreport':
      return reportCommand($)
    case 'mmreset':
      return resetAll($)
    default:
      return helpText()
  }
}

// ------------------------------------------------------------------ pane actions (buttons)

const selectTab = async ($: Dollar, tab: Tab) => {
  await update($, tabA, () => tab)
  await update($, pageA, () => 0)

  if (tab === 'installed' && (await read($, installedA)) === null) {
    await refreshInstalled($)
  }
}

const verbLine = async ($: Dollar, verb: (typeof VERBS)[number], name: string): Promise<Step> => ({
  verb,
  target: resolveTarget(verb, name, await read($, marketA), await installedList($)),
  scope: 'user',
})

const applyText = (verb: (typeof VERBS)[number], name: string): string => `/mmdo ${verb} ${name}${(verb === 'disable' || verb === 'uninstall') && isGuard(name) ? ` ${YES_WORD}` : ''}`

const refreshFromPane = async ($: Dollar) => {
  const state = await refreshInstalled($)
  await setNotice($, state.error === '' ? `Installed list read: ${state.list.length} plugins.` : `Could not read the installed list: ${state.error}.`)
}

const checkFromPane = async ($: Dollar) => {
  const text = await checkCommand($)
  await setNotice($, text.split('\n')[0] ?? '')
}

// ------------------------------------------------------------------ feature switches

/**
 * Runs `/cfg <args>` as a plugin call (`$.command.run`), which the settings mod answers. If the call is refused, rejects or
 * nobody answers it, the same line is put in the prompt box for the person to send, and the Log tab says so.
 */
const runCfg = async ($: Dollar, args: string): Promise<string> => {
  const line = `/cfg ${args}`
  const now = await nowOf($)
  const answer = await $.command.run({ command: 'cfg', args }).then(
    r => (typeof r.text === 'string' && r.text.trim() !== '' ? r.text : undefined),
    () => undefined,
  )

  if (answer !== undefined) {
    await addLog($, mkEntry(now, 'feature', line, { head: answer.split('\n').filter(l => l.trim() !== '') }))
    await setNotice($, answer)

    return answer
  }
  const done = await $.prompt.fill({ text: line, mode: 'replace' }).catch(() => undefined)
  const said =
    done?.isFilled === true
      ? `Could not run ${line} from here, so it is in the prompt box: press Enter to send it.`
      : `Could not run ${line} from here, and the prompt box could not be filled. Type it yourself: ${line}`
  await addLog($, mkEntry(now, 'feature', `fallback: ${said}`, { argv: line }))
  await setNotice($, said)

  return said
}

const toggleFeature = ($: Dollar, s: SwitchView) => runCfg($, featureArgs(s.id, !s.on))

const setSearch = ($: Dollar, text: string) =>
  Promise.all([update($, featureSearchA, () => text.slice(0, 40)), update($, pageA, () => 0)])

const featuresCommand = async ($: Dollar, args: string): Promise<string> => {
  const parsed = parseFeaturesArgs(args)

  if (!parsed.ok) {
    return parsed.message
  }
  await update($, featureSearchA, () => parsed.query)
  await update($, tabA, () => 'features')
  await update($, pageA, () => 0)
  await $.ui.open({ id: PANE, title: 'Mod manager' }).catch(() => undefined)
  const overrides = cleanOverrides(await read($, featuresA))
  const rows = featureRows(CATALOG, overrides, parsed.query)
  const changed = changedSwitches(CATALOG, overrides)

  return [
    `Features tab opened${parsed.query === '' ? '' : ` for "${parsed.query}"`}. ${changed} ${changed === 1 ? 'switch' : 'switches'} changed from default.`,
    rows.length === 0 ? 'No mod matches that.' : '',
    ...rows.slice(0, 12).map(r => `  ${clip(featureLine(r), 150)}`),
    rows.length > 12 ? `  ... and ${rows.length - 12} more mods (narrow it with /mmfeatures <mod>)` : '',
    'Change one with the buttons, or /cfg feature <mod>.<id> on|off. Nothing here disables a plugin.',
  ]
    .filter(l => l !== '')
    .join('\n')
}

// ------------------------------------------------------------------ the module

export const register: Register = on => {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box marginBottom="sm">
          <Button key="open-settings" label="All settings" onPress={() => $.ui.open({ id: 'mod-settings', title: 'Mod manager' })} />
        </Box>
        {await next(e)}
      </Box>
    )
  })

  // One panel for every mod's settings: this draws the top, and each mod adds its own section.
  on('ui.render', { component: 'Pane', requestId: 'mod-settings' }, async ($, e, next) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Input } = ui
    const Svg = e.surface === 'desktop' ? (ui as ElementTable<'desktop'>).Svg : undefined
    const query = (await read($, queryA)).toLowerCase().trim()
    const chosen = await read($, presetA)
    const fillIn = (text: string) => $.prompt.fill({ text, mode: 'replace' })
    const find = (v: string) => update($, queryA, () => v)
    const safety = (
      [
        ['Read-only mode', '/readonly'],
        ['Dry run', '/dryrun'],
        ['Spending limit', '/hardbudget 5'],
        ['Safety log', '/safetylog'],
      ] as const
    ).filter(([label]) => query === '' || label.toLowerCase().includes(query))

    return (
      <Box flexDirection="column" padding="sm">
        {Svg !== undefined ? (
          <Svg source={BANNER} alt="Mod manager: settings for your mods" width={420} height={76} />
        ) : (
          <Text size="heading" weight="bold">
            Mod manager
          </Text>
        )}
        <Box flexDirection="column" marginTop="md" gap="sm">
          <Text weight="bold">Presets</Text>
          <Box gap="sm" flexWrap="wrap">
            {(['calm', 'careful', 'everything'] as const).map(name => (
              <Button
                key={`preset-${name}`}
                variant={chosen.name === name ? 'primary' : undefined}
                label={`${name.charAt(0).toUpperCase()}${name.slice(1)}`}
                onPress={async () => {
                  const at = await $.clock.now()
                  await update($, presetA, () => ({ name, at }))
                }}
              />
            ))}
          </Box>
          <Text dimColor>Calm hides extras. Careful and Everything switch the checks back on. Safety mods are never switched off.</Text>
          <Input key="find-setting" placeholder="Search settings" value={query} onInput={find} onSubmit={find} />
        </Box>
        {await next(e)}
        {safety.length > 0 && (
          <Box flexDirection="column" marginTop="md" gap="sm">
            <Text weight="bold">Safety</Text>
            <Text dimColor>These put the command in the message box; you press Enter.</Text>
            {safety.map(([label, command]) => (
              <Box justifyContent="space-between" gap="sm">
                <Text>{label}</Text>
                <Button key={`safe-${command.split(' ')[0]}`} label={command} onPress={() => fillIn(command)} />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('session.start', async ($, e, next) => {
    await load($).catch(() => undefined)

    for (const [name, description, usage] of COMMANDS) {
      await $.command.register(usage === '' ? { name, description } : { name, description, argumentHint: usage }).catch(() => undefined)
    }

    return next(e)
  })

  for (const [name] of COMMANDS) {
    on('command.run', { command: name }, async ($, e) => ({
      text: await runCommand($, name, e.args, e.origin).catch(() => `/${name} hit an unexpected error. Nothing was run.`),
    }))
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const tab = await read($, tabA)
    const accent = await read($, accentA)
    const density = await read($, densityA)
    const icons = await read($, iconsA)
    const gap = density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm'
    const rows = e.viewport?.rows ?? 24
    const room = Math.max(4, rows - 14)
    const cols = e.props.bodyColumns
    const notice = await read($, noticeA)
    const pending = await read($, pendingA)
    const installed = await read($, installedA)
    const list = installed === null || installed.error !== '' ? null : installed.list
    const cli = await read($, cliA)
    const market = await read($, marketA)
    const now = await nowOf($)
    const page = await read($, pageA)
    const selected = await read($, selectedA)

    const Chip = (name: string, version?: string) => {
      const chip = chipFor(statusOf(list, name), icons, version !== undefined && hasNewer(list, { name, version }))

      return (
        <Text mono color={chip.color}>
          {chip.text.padEnd(4)}
        </Text>
      )
    }

    const Pager = (total: number) => {
      const pages = Math.max(1, Math.ceil(total / room))

      return (
        <Box gap="sm">
          <Button key="page-prev" label="<" onPress={() => update($, pageA, p => Math.max(0, p - 1))} />
          <Text dimColor>{`page ${Math.min(page, pages - 1) + 1}/${pages} · ${total} rows`}</Text>
          <Button key="page-next" label=">" onPress={() => update($, pageA, p => Math.min(pages - 1, p + 1))} />
        </Box>
      )
    }

    const Detail = (name: string) => {
      const mod = findMod(CATALOG, name)
      const have = findInstalled(list, name)
      const base = mod?.name ?? have?.name ?? name
      const status = statusOf(list, base)
      const offered = VERBS.filter(v => !((v === 'disable' || v === 'uninstall') && base === SELF))

      return (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm" gap="xs">
          <Text weight="bold" color={accent}>
            {`${have?.id ?? base} ${have?.version ?? mod?.version ?? ''}`.trim()} {isGuard(base) ? '(guard)' : ''}
          </Text>
          {mod !== undefined && <Text dimColor>{clip(mod.description, Math.max(30, cols - 8))}</Text>}
          <Text dimColor>
            {`status ${status}${mod === undefined ? '' : ` · ${mod.category}${mod.help === null ? '' : ` · /${mod.help}`}${mod.deps.length > 0 ? ` · needs ${mod.deps.join(', ')}` : ''}`}`}
          </Text>
          {offered.map(verb => {
            const step: Step = { verb, target: resolveTarget(verb, base, market, list), scope: 'user' }

            return (
              <Box gap="sm">
                <Button key={`copy-${verb}`} label="copy" onPress={() => fillPrompt($, stepLine(step), `${verb} line`)} />
                <Button key={`apply-${verb}`} label="apply" onPress={() => fillPrompt($, applyText(verb, base), 'Apply (then press Enter, then /mmdo confirm)')} />
                <Text mono dimColor>
                  {stepLine(step)}
                </Text>
              </Box>
            )
          })}
        </Box>
      )
    }

    const Section = (label: string) => (
      <Text size="caption" weight="semibold" dimColor>
        {label.toUpperCase()}
      </Text>
    )

    let body: JSX.Element | null = null

    if (tab === 'catalog') {
      const category = await read($, categoryA)
      const mods = modsInCategory(CATALOG, category)
      const start = Math.min(page, Math.max(0, Math.ceil(mods.length / room) - 1)) * room
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="xs" flexWrap="wrap">
            {['all', ...CATEGORIES].map(c => (
              <Button key={`cat-${c}`} label={c === category ? `[${c}]` : c} onPress={async () => { await update($, categoryA, () => c); await update($, pageA, () => 0) }} />
            ))}
          </Box>
          {list === null && <Text dimColor>Status unknown: open Installed or press Refresh there (read-only plugin list).</Text>}
          {mods.slice(start, start + room).map(m => (
            <Box gap="sm">
              {Chip(m.name, m.version)}
              <Button key={`sel-${m.name}`} label={m.name === selected ? `[${m.name}]` : m.name} onPress={() => update($, selectedA, () => m.name)} />
              <Text dimColor mono>
                {m.version}
              </Text>
              <Text dimColor>{clip(m.description, Math.max(12, cols - m.name.length - 22))}</Text>
            </Box>
          ))}
          {Pager(mods.length)}
          {selected !== '' && Detail(selected)}
        </Box>
      )
    } else if (tab === 'installed') {
      const all = list ?? []
      const start = Math.min(page, Math.max(0, Math.ceil(all.length / room) - 1)) * room
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="sm">
            <Button key="refresh" label="Refresh" onPress={() => refreshFromPane($)} />
            <Text dimColor>
              {installed === null
                ? 'not read yet'
                : installed.error !== ''
                  ? `could not read: ${installed.error}`
                  : `${all.length} plugins · cli ${cli.status === 'bundled' ? 'bundled with the app' : cli.status === 'path' ? 'on PATH' : cli.status}`}
            </Text>
          </Box>
          {installed !== null && installed.error !== '' && (
            <Text color="warning">No CLI reachable: use the copy buttons and run the lines yourself in a terminal.</Text>
          )}
          {all.slice(start, start + room).map(i => {
            const chip = chipFor(i.status, icons, (findMod(CATALOG, i.name) !== undefined && hasNewer(list, findMod(CATALOG, i.name) ?? { name: i.name, version: '' })))

            return (
              <Box gap="sm">
                <Text mono color={chip.color}>
                  {chip.text.padEnd(4)}
                </Text>
                <Button key={`isel-${i.id}`} label={i.id === selected ? `[${i.id}]` : i.id} onPress={() => update($, selectedA, () => i.id)} />
                <Text dimColor mono>{`${i.version === '' ? '?' : i.version} ${i.scope}`}</Text>
              </Box>
            )
          })}
          {Pager(all.length)}
          {selected !== '' && Detail(selected)}
        </Box>
      )
    } else if (tab === 'features') {
      const overrides = cleanOverrides(await read($, featuresA))
      const query = await read($, featureSearchA)
      const all = featureRows(CATALOG, overrides, query)
      const changed = changedSwitches(CATALOG, overrides)
      const sizes = all.map((r, i) => 1 + r.own.length + (i === 0 || all[i - 1]?.mod.category !== r.mod.category ? 1 : 0))
      // the pane's own body height when it says one, else the viewport's; about nine rows go to the title, tabs, presets, search and footer
      const pages = paginateUnits(sizes, Math.max(6, (e.props.scroll?.bodyRows ?? rows) - 9))
      const pageNo = Math.min(page, Math.max(0, pages.length - 1))
      const shown = (pages[pageNo] ?? []).map(i => all[i]).filter((r): r is NonNullable<typeof r> => r !== undefined)
      body = (
        <Box flexDirection="column" gap="xs">
          <Box gap="xs" flexWrap="wrap">
            {FEATURE_PRESETS.map(({ name, label }) => (
              <Button key={`fp-${name}`} label={label} onPress={() => runCfg($, presetArgs(name))} />
            ))}
          </Box>
          <Input key="fsearch" label="search" placeholder="mod name or words" value={query} submitLabel="filter" onInput={(v: string) => setSearch($, v)} onSubmit={(v: string) => setSearch($, v.trim())} />
          <Text color={changed > 0 ? accent : undefined} dimColor={changed === 0}>{`${changed} ${changed === 1 ? 'switch' : 'switches'} changed from default`}</Text>
          {all.length === 0 && <Text dimColor>No mod matches that.</Text>}
          {shown.map((r, i) => {
            const first = i === 0 || shown[i - 1]?.mod.category !== r.mod.category

            return (
              <Box flexDirection="column">
                {first && Section(r.mod.category)}
                <Box gap="sm" flexWrap="wrap">
                  <Text weight="semibold">{r.mod.name}</Text>
                  {r.locked ? (
                    <Text dimColor>always on: a safety mod's messages cannot be muted</Text>
                  ) : (
                    r.universal.map(s => <Button key={`ft-${s.id}`} label={`${s.label} ${s.on ? 'On' : 'Off'}${s.changed ? '*' : ''}`} onPress={() => toggleFeature($, s)} />)
                  )}
                </Box>
                {r.own.map(s => (
                  <Box gap="sm" flexWrap="wrap" paddingLeft="sm">
                    <Button key={`ft-${s.id}`} label={`${s.label} ${s.on ? 'On' : 'Off'}${s.changed ? '*' : ''}`} onPress={() => toggleFeature($, s)} />
                    <Text dimColor>{clip(`${s.group === '' ? '' : `${s.group}: `}${s.description}`, Math.max(12, cols - s.label.length - 14))}</Text>
                  </Box>
                ))}
              </Box>
            )
          })}
          <Box gap="sm">
            <Button key="fpage-prev" label="<" onPress={() => update($, pageA, p => Math.max(0, p - 1))} />
            <Text dimColor>{`page ${pageNo + 1}/${Math.max(1, pages.length)} · ${all.length} mods`}</Text>
            <Button key="fpage-next" label=">" onPress={() => update($, pageA, p => Math.min(Math.max(0, pages.length - 1), p + 1))} />
            {query !== '' && <Button key="fclear" label="clear search" onPress={() => setSearch($, '')} />}
          </Box>
          <Text dimColor>{`* = changed from default. A switch hides what a mod shows or plays; it never disables the mod. The safety mods (${GUARDS.join(', ')}) and settings cannot be muted.`}</Text>
        </Box>
      )
    } else if (tab === 'bundles') {
      const user = await read($, bundlesA)
      const names = allBundleNames(user)
      const chosen = await read($, selectedBundleA)
      const members = chosen === '' ? undefined : bundleMembers(chosen, user, CATALOG)
      body = (
        <Box flexDirection="column" gap="xs">
          {names.map(n => (
            <Box gap="sm">
              <Button key={`bsel-${n}`} label={n === chosen ? `[${n}]` : n} onPress={() => update($, selectedBundleA, () => n)} />
              <Text dimColor>{`${bundleMembers(n, user, CATALOG)?.length ?? 0} mods${isBuiltinBundle(n) ? '' : ' · yours'}`}</Text>
              <Button key={`bapply-${n}`} label="apply" onPress={() => fillPrompt($, `/mmbundle apply ${n}`, `Bundle ${n}`)} />
            </Box>
          ))}
          <Text dimColor>Add your own with /mmbundle add &lt;name&gt; &lt;mod,mod&gt;. Apply stores a pending action; /mmdo confirm runs it.</Text>
          {members !== undefined && (
            <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm">
              <Text weight="bold" color={accent}>
                {chosen}
              </Text>
              {members.map(m => (
                <Box gap="sm">
                  {Chip(m, findMod(CATALOG, m)?.version)}
                  <Text>{m}</Text>
                  <Text dimColor>{clip(findMod(CATALOG, m)?.description ?? 'not in the catalog', Math.max(12, cols - m.length - 16))}</Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )
    } else if (tab === 'source') {
      const url = await read($, sourceA)
      const remote = await read($, remoteA)
      body = (
        <Box flexDirection="column" gap="xs">
          {Section('Remote catalog')}
          <Text mono dimColor>
            {url === '' ? 'none stored: /mmsource <https url of a marketplace.json>' : url}
          </Text>
          <Text dimColor>{`marketplace name in command lines: ${market} (change: /mmmarket <name>)`}</Text>
          <Box gap="sm">
            <Button key="check" label="Check now" onPress={() => checkFromPane($)} />
            {repoFromUrl(url) !== undefined && <Button key="copy-market-add" label="copy marketplace add" onPress={() => fillPrompt($, `claude plugin marketplace add ${repoFromUrl(url) ?? ''}`, 'Marketplace line')} />}
          </Box>
          {remote !== null && remote.error !== '' && <Text color="warning">{`last check failed: ${remote.error}`}</Text>}
          {remote !== null && remote.error === '' && (
            <Text dimColor>{`${remote.total} plugins in the source · ${remote.upToDate} up to date · ${remote.rows.length} to look at`}</Text>
          )}
          {(remote?.rows ?? []).slice(0, room).map(r => {
            const step: Step = { verb: r.kind === 'new' ? 'install' : 'update', target: `${r.name}@${market}`, scope: 'user' }

            return (
              <Box gap="sm">
                <Text color={r.kind === 'new' ? 'success' : 'suggestion'}>{r.kind === 'new' ? 'NEW' : 'NEWER'}</Text>
                <Button key={`rcopy-${r.name}`} label={r.name} onPress={() => fillPrompt($, stepLine(step), `${step.verb} line`)} />
                <Text dimColor>{r.kind === 'update' ? `${r.installed} -> ${r.remote}` : r.remote}</Text>
              </Box>
            )
          })}
          <Text dimColor>Nothing here installs anything: a name puts its command line in the prompt box.</Text>
        </Box>
      )
    } else {
      const log = [...(await read($, logA))].reverse()
      const start = Math.min(page, Math.max(0, Math.ceil(log.length / room) - 1)) * room
      body = (
        <Box flexDirection="column" gap="xs">
          {log.length === 0 && <Text dimColor>Nothing logged yet. Pending actions, confirms and results appear here (last {LOG_MAX}).</Text>}
          {log.slice(start, start + room).map(entry => (
            <Box flexDirection="column">
              <Text mono color={entry.kind === 'result' && entry.exit !== 0 ? 'error' : entry.kind === 'refused' ? 'warning' : undefined}>
                {clip(fmtEntry(entry), Math.max(20, cols - 2))}
              </Text>
              {entry.head.map(line => (
                <Text mono dimColor>
                  {`    ${clip(line, Math.max(20, cols - 6))}`}
                </Text>
              ))}
            </Box>
          ))}
          {Pager(log.length)}
        </Box>
      )
    }
    const pendingOk = pendingState(pending, now) === 'valid' && pending !== null

    return (
      <Box flexDirection="column" padding={gap} gap={gap}>
        <Box justifyContent="space-between">
          <Text size="heading" weight="bold" color={accent}>
            Mod manager
          </Text>
          <Text dimColor>{`${CATALOG.length} mods in the catalog`}</Text>
        </Box>
        <Box gap="xs" flexWrap="wrap">
          {TABS.map(([id, label]) => (
            <Button key={`tab-${id}`} label={id === tab ? `[${label}]` : label} onPress={() => selectTab($, id)} />
          ))}
        </Box>
        {notice !== '' && <Text color={accent}>{notice}</Text>}
        {pending !== null && (
          <Box flexDirection="column" borderStyle="round" borderColor={pendingOk ? 'warning' : 'subtle'} paddingX="sm">
            <Text weight="bold">{pendingOk ? `Pending: ${pending.label} (about ${secondsLeft(pending, now)} s left)` : `Expired: ${pending.label}`}</Text>
            {pending.steps.slice(0, 6).map(s => (
              <Text mono dimColor>
                {stepLine(s)}
              </Text>
            ))}
            {pendingOk && (
              <Box gap="sm">
                <Button key="pending-fill" label="put /mmdo confirm in the prompt" onPress={() => fillPrompt($, '/mmdo confirm', 'Confirm')} />
                <Button key="pending-cancel" label="cancel" onPress={async () => setNotice($, await cancelPending($))} />
              </Box>
            )}
          </Box>
        )}
        {body}
      </Box>
    )
  })
}
