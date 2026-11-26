import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { ApprovalRow, Cfg, DirRow, LogRow, NetRow, Pacing, SelfTest, View } from '../types'
import {
  MAX_ALLOWS,
  MAX_BLOCKS,
  PRESETS,
  PROFILES,
  RULES_OF,
  TG_COPY_DATE,
  capsOf,
  clip,
  credHits,
  detailOf,
  dirsOf,
  disableCommand,
  evalOwn,
  hostsOf,
  incidentHit,
  looksSecret,
  mentionText,
  normalizeLiteral,
  parseAllow,
  plainOf,
  redact,
  sandboxNote,
  scrub,
  str,
  testReport,
} from './rules'
import type { Hit, Input, Preset, Profile } from './rules'
import { MODS, SNAPSHOT_AT } from './snapshot'

type Dollar = Parameters<Hook<'session.start'>>[0]
type RenderE = Parameters<Hook<'ui.render'>>[1]

const DEFAULT_CFG: Cfg = { preset: 'off', blocks: [], allows: [], profiles: {}, incident: false }
const DEFAULT_PACING: Pacing = { anyToast: 0, sandboxToast: 0 }
const DEFAULT_VIEW: View = { tab: 'mods', page: 0 }

const cfgAtom = atom({ plugin: 'controls', key: 'cfg' } as const, DEFAULT_CFG, { shape: 'cfg-1' })
const netAtom = atom({ plugin: 'controls', key: 'net' } as const, [], { shape: 'net-1' })
const dirsAtom = atom({ plugin: 'controls', key: 'dirs' } as const, [], { shape: 'dirs-1' })
const logAtom = atom({ plugin: 'controls', key: 'log' } as const, [], { shape: 'log-1' })
const approvalsAtom = atom({ plugin: 'controls', key: 'approvals' } as const, [], { shape: 'approvals-1' })
const selftestAtom = atom({ plugin: 'controls', key: 'selftest' } as const, null, { shape: 'selftest-1' })
const pacingAtom = atom({ plugin: 'controls', key: 'pacing' } as const, DEFAULT_PACING, { shape: 'pacing-1' })
const viewAtom = atom({ plugin: 'controls', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-1' })

const PANE = 'controls-main'
const NET_CAP = 50
const DIR_CAP = 60
const LOG_CAP = 150
const APPROVAL_CAP = 60
const PROFILE_CAP = 50
const ANY_TOAST_GAP_MS = 3 * 60_000
const SANDBOX_TOAST_GAP_MS = 10 * 60_000
const SELF_DIR = '/nonexistent-claude-selftest'

type CommandSpec = readonly [name: string, description: string, hint: string]

const COMMANDS: readonly CommandSpec[] = [
  ['ct', 'List every controls command (trust and transparency)', ''],
  ['ctmods', 'Privacy dashboard: what every installed mod can do (build-time snapshot)', '[mod name]'],
  ['ctperms', 'Permission summary in plain words, per mod', '[mod name]'],
  ['ctpause', 'Print the exact commands that disable mods, with copy buttons', ''],
  ['ctredact', 'Redaction presets for this mod\'s panes; or preview masking of text', '[work|personal|presenting|off | text]'],
  ['ctledger', 'Outbound hosts and folders touched in this and earlier sessions', '[net|files|clear]'],
  ['ctapprovals', 'Permission dialogs that opened and what happened next', ''],
  ['cttest', 'What tool-guard style rules would say about a command (never runs it)', '<command> | edit <path>'],
  ['ctblock', 'Edit this mod\'s own extra blocked substrings for Bash', 'add <text> | rm <text> | list'],
  ['ctallow', 'Let one of this mod\'s rules pass for N minutes', '<substring> <minutes> | clear'],
  ['ctprofile', 'Per-project profile for this mod\'s rules', 'strict|normal|off'],
  ['ctincident', 'Incident mode: hold every mutating Bash, Edit and Write', 'on|off'],
  ['ctselftest', 'Check that tool-guard still refuses protected files (harmless inputs only)', ''],
  ['ctshot', 'Screenshot-safe summary pane (counts only)', ''],
  ['ctreset', 'Clear everything this mod recorded (add "all" to clear its settings too)', '[all]'],
]

// Module-level, per load. A reload starts these over, which is fine: they only pace and link.
let startProfile: Profile = 'normal'
let pendingAsk: { at: number; tool: string; detail: string } | undefined

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const clockText = (ms: number) => new Date(ms).toISOString().slice(11, 19)

const onOff = (arg: string) => {
  const a = arg.trim().toLowerCase()

  return a === 'on' ? true : a === 'off' ? false : undefined
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const cleanCfg = (raw: unknown): Cfg => {
  const r = asRecord(raw)
  const profiles: Record<string, Profile> = {}

  for (const [key, value] of Object.entries(asRecord(r.profiles))) {
    if (value === 'strict' || value === 'normal' || value === 'off') {
      profiles[key] = value
    }
  }

  return {
    preset: PRESETS.includes(r.preset as Preset) ? (r.preset as Preset) : 'off',
    blocks: Array.isArray(r.blocks) ? r.blocks.filter((b): b is string => typeof b === 'string').slice(0, MAX_BLOCKS) : [],
    allows: Array.isArray(r.allows)
      ? r.allows
          .map(asRecord)
          .filter(a => typeof a.text === 'string' && typeof a.until === 'number')
          .map(a => ({ text: String(a.text), until: Number(a.until) }))
          .slice(0, MAX_ALLOWS)
      : [],
    profiles,
    incident: r.incident === true,
  }
}

const profileFor = (cfg: Cfg, cwd: string): Profile => cfg.profiles[cwd] ?? startProfile

const listOf = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

const minsLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / 60_000))

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

const cwdOf = ($: Dollar) => $.session.cwd().catch(() => '/')

const persist = async ($: Dollar) => {
  await $.store.set('controls:cfg', await read($, cfgAtom)).catch(() => undefined)
  await $.store
    .set('controls:data', {
      net: await read($, netAtom),
      dirs: await read($, dirsAtom),
      log: await read($, logAtom),
      approvals: await read($, approvalsAtom),
    })
    .catch(() => undefined)
}

const addLog = async ($: Dollar, kind: LogRow['kind'], rule: string, tool: string, detail: string) => {
  const row: LogRow = { at: await $.clock.now(), kind, rule, tool, detail: scrub(detail).slice(0, 160) }
  await update($, logAtom, list => [...list, row].slice(-LOG_CAP))
}

/** At most one toast per 3 minutes from this mod; the sandbox reminder at most one per 10. */
const toast = async ($: Dollar, text: string, kind: 'any' | 'sandbox') => {
  const now = await $.clock.now()
  const pacing = await read($, pacingAtom)

  if (now - pacing.anyToast < ANY_TOAST_GAP_MS || (kind === 'sandbox' && now - pacing.sandboxToast < SANDBOX_TOAST_GAP_MS)) {
    return false
  }
  await update($, pacingAtom, () => ({ anyToast: now, sandboxToast: kind === 'sandbox' ? now : pacing.sandboxToast }))
  try {
    $.ui.toast(text, { timeoutMs: 6000 })
  } catch {
    return false
  }

  return true
}

const refuse = async ($: Dollar, hit: Hit, tool: string, detail: string, message: string) => {
  await addLog($, 'deny', hit.id, tool, detail)
  await toast($, `controls: held (${hit.label})`, 'any')
  await persist($)

  return message
}

// ---------------------------------------------------------------------------
// The gate (can DENY: the hooks that call it carry a fail-closed .catch)
// ---------------------------------------------------------------------------

const gateCall = async ($: Dollar, input: Input): Promise<string | undefined> => {
  const tool = str(input.tool)
  const command = tool === 'Bash' ? str(input.command) : ''
  const detail = detailOf(tool, input)
  const cfg = await read($, cfgAtom)
  const now = await $.clock.now()

  if (cfg.incident) {
    const hit = incidentHit(tool, command)

    if (hit !== undefined) {
      return refuse(
        $,
        hit,
        tool,
        detail,
        `controls: held, ${hit.label}. Incident mode is on, so nothing that changes files or state may run. Reading and listing still work. Tell the user what you wanted to change and ask them to run /ctincident off when it is safe.`,
      )
    }
  }

  if (tool === 'Bash') {
    const profile = profileFor(cfg, await cwdOf($))
    const verdict = evalOwn(command, profile, cfg.blocks, cfg.allows, now)

    if (verdict.hit !== undefined) {
      return refuse(
        $,
        verdict.hit,
        tool,
        detail,
        `controls: blocked (${verdict.hit.label}). Propose a safer command, or ask the user to run /ctallow ${verdict.hit.id.replace(/^block:/, '')} <minutes> to let it pass for a while, or /ctprofile off.`,
      )
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// The observer (never denies): ledgers, warnings, approvals
// ---------------------------------------------------------------------------

const before = async ($: Dollar, input: Input) => {
  const tool = str(input.tool)
  const creds = credHits(mentionText(input))

  if (creds.length > 0) {
    await addLog($, 'warn', 'credential-path', tool, `mentions ${creds.join(', ')}`)
    await toast($, `controls: ${tool} mentions ${creds.join(', ')} (a warning, nothing was blocked)`, 'any')
  }

  if (tool === 'Bash') {
    const why = sandboxNote(str(input.command), await cwdOf($))

    if (why !== undefined) {
      await toast($, `controls: sandbox reminder: ${why}`, 'sandbox')
    }
  }
}

const after = async ($: Dollar, input: Input, isDenied: boolean) => {
  const tool = str(input.tool)
  const now = await $.clock.now()
  const cfg = await read($, cfgAtom)
  const detail = detailOf(tool, input)

  if (!isDenied) {
    const hosts = hostsOf(tool, input)

    if (hosts.length > 0) {
      await update($, netAtom, list => {
        const out = [...list]

        for (const hit of hosts) {
          const i = out.findIndex(r => r.host === hit.host)
          const old = out[i]

          if (old === undefined) {
            out.push({ host: hit.host, via: hit.via, n: 1, last: now })
          } else {
            out[i] = { ...old, n: old.n + 1, last: now, via: hit.via }
          }
        }

        return out.sort((a, b) => b.last - a.last).slice(0, NET_CAP)
      })
    }
    const dirs = dirsOf(tool, input, await cwdOf($))

    if (dirs.length > 0) {
      await update($, dirsAtom, list => {
        const out = [...list]

        for (const hit of dirs) {
          const i = out.findIndex(r => r.dir === hit.dir)
          const old = out[i]

          if (old === undefined) {
            out.push({ dir: hit.dir, r: hit.kind === 'r' ? 1 : 0, w: hit.kind === 'w' ? 1 : 0, last: now })
          } else {
            out[i] = { ...old, r: old.r + (hit.kind === 'r' ? 1 : 0), w: old.w + (hit.kind === 'w' ? 1 : 0), last: now }
          }
        }

        return out.sort((a, b) => b.last - a.last).slice(0, DIR_CAP)
      })
    }
  }

  if (cfg.incident) {
    await addLog($, 'call', isDenied ? 'incident: held' : 'incident: ran', tool, detail)
  }

  if (pendingAsk !== undefined && pendingAsk.tool === tool && pendingAsk.detail === detail) {
    const at = pendingAsk.at
    pendingAsk = undefined
    await update($, approvalsAtom, list =>
      list.map(r => (r.at === at && r.outcome === 'asked' ? { ...r, outcome: isDenied ? ('denied' as const) : ('approved' as const) } : r)),
    )
  }
  await persist($)
}

const onAsk = async ($: Dollar, tool: string, toolInput: unknown) => {
  const at = await $.clock.now()
  const detail = detailOf(tool, asRecord(toolInput))
  pendingAsk = { at, tool, detail }
  await update($, approvalsAtom, list => [...list, { at, tool, detail, outcome: 'asked' as const }].slice(-APPROVAL_CAP))

  return at
}

const onAnswered = async ($: Dollar, at: number, behavior: string | undefined) => {
  if (behavior !== 'allow' && behavior !== 'deny') {
    return
  }
  const outcome = behavior === 'allow' ? ('allowed by a hook' as const) : ('denied by a hook' as const)
  pendingAsk = undefined
  await update($, approvalsAtom, list => list.map(r => (r.at === at && r.outcome === 'asked' ? { ...r, outcome } : r)))
}

// ---------------------------------------------------------------------------
// Actions shared by commands and the pane
// ---------------------------------------------------------------------------

const setCfg = async ($: Dollar, fn: (cfg: Cfg) => Cfg) => {
  await update($, cfgAtom, fn)
  await persist($)
}

const addBlock = async ($: Dollar, raw: string) => {
  const text = normalizeLiteral(raw)

  if (typeof text !== 'string') {
    return text.error
  }
  const cfg = await read($, cfgAtom)

  if (cfg.blocks.includes(text)) {
    return `"${text}" is already blocked.`
  }

  if (cfg.blocks.length >= MAX_BLOCKS) {
    return `At most ${MAX_BLOCKS} blocks. Remove one first with /ctblock rm <text>.`
  }
  await setCfg($, c => ({ ...c, blocks: [...c.blocks, text] }))

  return `Blocked: Bash commands containing "${text}" are now denied (profiles normal and strict). Remove with /ctblock rm ${text}.`
}

const removeBlock = async ($: Dollar, raw: string) => {
  const text = raw.trim().replace(/^["']|["']$/g, '')
  const cfg = await read($, cfgAtom)

  if (!cfg.blocks.includes(text)) {
    return `"${text}" is not in the block list.`
  }
  await setCfg($, c => ({ ...c, blocks: c.blocks.filter(b => b !== text) }))

  return `Removed "${text}" from the block list.`
}

const setIncident = async ($: Dollar, on: boolean) => {
  await setCfg($, c => ({ ...c, incident: on }))
  await addLog($, 'info', 'incident', '-', on ? 'incident mode ON' : 'incident mode off')
  await persist($)

  return on
    ? 'INCIDENT MODE ON: every mutating Bash command and every Edit/Write/NotebookEdit is denied, and every call is logged. Reads still work. /ctincident off ends it.'
    : 'Incident mode off.'
}

const setProfile = async ($: Dollar, profile: Profile) => {
  const cwd = await cwdOf($)
  await setCfg($, c => {
    const profiles = { ...c.profiles }
    delete profiles[cwd]
    profiles[cwd] = profile
    const keys = Object.keys(profiles)

    for (const old of keys.slice(0, Math.max(0, keys.length - PROFILE_CAP))) {
      delete profiles[old]
    }

    return { ...c, profiles }
  })

  return `Profile for ${cwd} is now ${profile}.`
}

const clearData = async ($: Dollar, all: boolean) => {
  await update($, netAtom, () => [])
  await update($, dirsAtom, () => [])
  await update($, logAtom, () => [])
  await update($, approvalsAtom, () => [])
  await update($, selftestAtom, () => null)
  pendingAsk = undefined

  if (all) {
    await update($, cfgAtom, () => DEFAULT_CFG)
    await update($, pacingAtom, () => DEFAULT_PACING)
  }
  await persist($)
}

type SelfCase = { label: string; path: string }

const SELF_CASES: readonly SelfCase[] = [
  { label: 'Edit a .env file', path: `${SELF_DIR}/.env` },
  { label: 'Edit an id_rsa key', path: `${SELF_DIR}/id_rsa` },
  { label: 'Edit .aws/credentials', path: `${SELF_DIR}/.aws/credentials` },
]

/**
 * Only inputs that are harmless even if every guard failed: an Edit on a folder that does not
 * exist, with an old_string that cannot match. No Write, no Bash.
 */
const runSelfTest = async ($: Dollar): Promise<NonNullable<SelfTest>> => {
  const rows: NonNullable<SelfTest>['rows'] = []

  for (const c of SELF_CASES) {
    let text = ''
    let isDenied = false

    try {
      const ran = await $.tool.call({
        tool: 'Edit',
        file_path: c.path,
        old_string: 'controls-selftest-no-match',
        new_string: 'x',
      })
      isDenied = typeof ran.deny === 'string'
      text = isDenied ? String(ran.deny) : ''
    } catch (err) {
      isDenied = true
      text = String(err)
    }

    if (!isDenied) {
      rows.push({
        label: c.label,
        verdict: 'fail',
        note: 'NOT refused. Nothing was changed (the folder does not exist), but no guard stopped it. Is tool-guard enabled?',
      })
    } else if (/tool-guard/i.test(text) && /protected/i.test(text)) {
      rows.push({ label: c.label, verdict: 'pass', note: 'refused with tool-guard\'s own message' })
    } else {
      rows.push({
        label: c.label,
        verdict: 'other',
        note: `refused, but not by tool-guard's message, so tool-guard is not confirmed: ${clip(text, 90)}`,
      })
    }
  }
  const result = { at: await $.clock.now(), rows }
  await update($, selftestAtom, () => result)

  return result
}

const selfText = (t: NonNullable<SelfTest>) =>
  [
    ...t.rows.map(r => `  ${r.verdict === 'pass' ? 'PASS' : r.verdict === 'fail' ? 'FAIL' : 'NOTE'}  ${r.label}: ${r.note}`),
    t.rows.every(r => r.verdict === 'pass')
      ? 'Result: tool-guard refuses protected files.'
      : t.rows.some(r => r.verdict === 'fail')
        ? 'Result: FAIL. A protected-file edit was not refused. Check that tool-guard is enabled.'
        : 'Result: not confirmed. Something refused, but it was not tool-guard\'s message.',
  ].join('\n')

const openPane = async ($: Dollar, tab: View['tab']) => {
  await update($, viewAtom, () => ({ tab, page: 0 }))
  await $.ui.open({ id: PANE, title: 'Controls' }).catch(() => undefined)
}

const helpText = () =>
  [
    'controls: trust and transparency around tool-guard and safety-pro (it adds visibility and a few rules of its own; it does not repeat theirs).',
    ...COMMANDS.map(([name, description, hint]) => `  /${name}${hint === '' ? '' : ` ${hint}`}  ${description}`),
    'One pane: controls-main (tabs Mods, Ledger, Log, Rules, Pause, Shot).',
  ].join('\n')

const permsText = (name: string) => {
  const list = name === '' ? MODS : MODS.filter(m => m.name === name)

  if (list.length === 0) {
    return `No mod named "${name}" in the snapshot taken ${SNAPSHOT_AT}.`
  }

  return [
    `Snapshot from ${SNAPSHOT_AT} (taken when controls was built; mods added or changed since are not shown).`,
    ...list.map(m => {
      const plain = plainOf(m)

      return `${m.name}: ${plain.words.length === 0 ? 'only changes how things look, sound or which slash commands exist' : plain.words.join('; ')}.`
    }),
  ].join('\n')
}

const pauseLines = () => MODS.map(m => disableCommand(m.name))

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

const TABS: readonly { tab: View['tab']; label: string }[] = [
  { tab: 'mods', label: 'Mods' },
  { tab: 'ledger', label: 'Ledger' },
  { tab: 'log', label: 'Log' },
  { tab: 'rules', label: 'Rules' },
  { tab: 'pause', label: 'Pause' },
  { tab: 'shot', label: 'Shot' },
]

const modsTab = async ($: Dollar, e: RenderE) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const view = await read($, viewAtom)
  const per = Math.max(2, Math.floor(((e.viewport?.rows ?? 24) - 12) / 3))
  const pages = Math.max(1, Math.ceil(MODS.length / per))
  const page = Math.min(view.page, pages - 1)

  return (
    <Box flexDirection="column">
      <Text dimColor size="caption">
        Snapshot of {MODS.length} mods taken at build time on {SNAPSHOT_AT}. Mods added or changed since are not listed.
      </Text>
      {MODS.slice(page * per, page * per + per).map(m => {
        const caps = capsOf(m)
        const plain = plainOf(m)
        const mark = (on: boolean) => (on ? '●' : '·')

        return (
          <Box flexDirection="column" marginTop="sm">
            <Box gap="sm">
              <Text weight="semibold">{m.name}</Text>
              <Text dimColor>v{m.version}</Text>
              <Text color={plain.risk >= 3 ? 'error' : plain.risk === 2 ? 'warning' : 'subtle'}>
                {plain.risk >= 3 ? 'wide access' : plain.risk === 2 ? 'some access' : 'narrow'}
              </Text>
            </Box>
            <Text mono dimColor>
              {`shell ${mark(caps.shell)}  read ${mark(caps.read)}  write ${mark(caps.write)}  net ${mark(caps.net)}  store ${mark(caps.store)}`}
            </Text>
            <Text>{plain.words.length === 0 ? 'Only changes how things look, sound or which commands exist.' : `${plain.words.join('; ')}.`}</Text>
          </Box>
        )
      })}
      <Box gap="sm" marginTop="md">
        <Button
          key="prev"
          label="Previous"
          onPress={() => update($, viewAtom, v => ({ ...v, page: Math.max(0, page - 1) }))}
        />
        <Text dimColor>
          {page + 1} / {pages}
        </Text>
        <Button
          key="next"
          label="Next"
          onPress={() => update($, viewAtom, v => ({ ...v, page: Math.min(pages - 1, page + 1) }))}
        />
      </Box>
    </Box>
  )
}

const ledgerTab = async ($: Dollar, e: RenderE, cfg: Cfg) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const net = await read($, netAtom)
  const dirs = await read($, dirsAtom)
  const room = Math.max(4, Math.floor(((e.viewport?.rows ?? 24) - 10) / 2))
  const mask = (t: string) => redact(t, cfg.preset)

  return (
    <Box flexDirection="column">
      <Text weight="bold">Outbound hosts</Text>
      <Text dimColor size="caption">
        Host names only (never paths, queries or tokens), from WebFetch, WebSearch, mcp tools, curl, wget and git clone, while this mod was on.
      </Text>
      {net.length === 0 && <Text dimColor>None recorded yet.</Text>}
      {net.slice(0, room).map(r => (
        <Box gap="sm">
          <Text mono>{mask(r.host)}</Text>
          <Text dimColor>
            x{r.n} {r.via} {clockText(r.last)}
          </Text>
        </Box>
      ))}
      <Box marginTop="md" flexDirection="column">
        <Text weight="bold">Folders</Text>
        <Text dimColor size="caption">
          From Read, Edit, Write, Glob, Grep and Bash redirections (&gt; &gt;&gt; tee). Reads done inside other shell commands are not seen.
        </Text>
        {dirs.length === 0 && <Text dimColor>None recorded yet.</Text>}
        {dirs.slice(0, room).map(r => (
          <Box gap="sm">
            <Text mono>{mask(r.dir)}</Text>
            <Text dimColor>
              read {r.r} wrote {r.w}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop="md">
        <Button
          key="clear-ledger"
          label="Clear ledgers"
          onPress={async () => {
            await update($, netAtom, () => [])
            await update($, dirsAtom, () => [])
            await persist($)
          }}
        />
      </Box>
    </Box>
  )
}

const logTab = async ($: Dollar, e: RenderE, cfg: Cfg) => {
  const { Box, Text } = $.ui.resolve(e)
  const log = await read($, logAtom)
  const approvals = await read($, approvalsAtom)
  const room = Math.max(3, Math.floor(((e.viewport?.rows ?? 24) - 10) / 2))
  const mask = (t: string) => redact(t, cfg.preset)

  return (
    <Box flexDirection="column">
      <Text weight="bold">Denials, warnings and incident calls</Text>
      {log.length === 0 && <Text dimColor>Nothing yet.</Text>}
      {[...log]
        .reverse()
        .slice(0, room)
        .map(r => (
          <Box gap="sm">
            <Text mono dimColor>
              {clockText(r.at)}
            </Text>
            <Text color={r.kind === 'deny' ? 'error' : r.kind === 'warn' ? 'warning' : 'subtle'} weight="bold">
              {r.kind === 'deny' ? 'held' : r.kind === 'warn' ? 'warn' : r.kind}
            </Text>
            <Text>{r.rule}</Text>
            <Text mono dimColor>
              {r.tool} {mask(r.detail)}
            </Text>
          </Box>
        ))}
      <Box marginTop="md" flexDirection="column">
        <Text weight="bold">Permission dialogs</Text>
        <Text dimColor size="caption">
          The mod sees a dialog open and whether the call then ran. It cannot see your click itself, so approved/denied is inferred.
        </Text>
        {approvals.length === 0 && <Text dimColor>None recorded yet.</Text>}
        {[...approvals]
          .reverse()
          .slice(0, room)
          .map(r => (
            <Box gap="sm">
              <Text mono dimColor>
                {clockText(r.at)}
              </Text>
              <Text color={r.outcome === 'approved' || r.outcome === 'allowed by a hook' ? 'success' : r.outcome === 'asked' ? 'subtle' : 'error'}>
                {r.outcome}
              </Text>
              <Text mono dimColor>
                {r.tool} {mask(r.detail)}
              </Text>
            </Box>
          ))}
      </Box>
    </Box>
  )
}

const rulesTab = async ($: Dollar, e: RenderE, cfg: Cfg) => {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const cwd = await cwdOf($)
  const now = await $.clock.now()
  const self = await read($, selftestAtom)
  const profile = profileFor(cfg, cwd)

  return (
    <Box flexDirection="column">
      <Box gap="sm">
        <Text weight="bold">Incident mode</Text>
        <Text color={cfg.incident ? 'error' : 'subtle'}>{cfg.incident ? 'ON' : 'off'}</Text>
        <Button
          key="incident"
          label={cfg.incident ? 'Turn off' : 'Turn on'}
          onPress={async () => {
            await setIncident($, !cfg.incident)
          }}
        />
      </Box>
      <Box gap="sm" marginTop="sm">
        <Text weight="bold">Profile</Text>
        {PROFILES.map(p => (
          <Button
            key={`profile-${p}`}
            label={p}
            variant={p === profile ? 'primary' : 'secondary'}
            onPress={async () => {
              await setProfile($, p)
            }}
          />
        ))}
      </Box>
      <Text dimColor size="caption">
        for {redact(cwd, cfg.preset)}. strict adds sudo, git reset --hard, git clean -f, chmod -R, DROP TABLE and npm publish to your blocks. off disables this mod's block rules (incident mode still applies).
      </Text>
      <Box flexDirection="column" marginTop="sm">
        <Text weight="bold">Extra blocked substrings (Bash)</Text>
        {cfg.blocks.length === 0 && <Text dimColor>None. Default is empty.</Text>}
        {cfg.blocks.map(b => (
          <Box gap="sm">
            <Text mono>{redact(b, cfg.preset)}</Text>
            <Button
              key={`rm-${b}`}
              label="Remove"
              onPress={async () => {
                await removeBlock($, b)
              }}
            />
          </Box>
        ))}
        <Input
          key="add-block"
          label="Add"
          placeholder="substring to block, then Enter"
          submitLabel="add"
          onSubmit={async value => {
            await addBlock($, value)
          }}
        />
      </Box>
      <Box flexDirection="column" marginTop="sm">
        <Text weight="bold">Temporary allows</Text>
        {cfg.allows.filter(a => a.until > now).length === 0 && <Text dimColor>None. /ctallow &lt;substring&gt; &lt;minutes&gt;</Text>}
        {cfg.allows
          .filter(a => a.until > now)
          .map(a => (
            <Text mono>
              {a.text}: {minsLeft(a.until, now)} min left
            </Text>
          ))}
      </Box>
      <Box flexDirection="column" marginTop="sm">
        <Text weight="bold">Redaction preset (this mod's panes only)</Text>
        <Box gap="sm">
          {PRESETS.map(p => (
            <Button
              key={`preset-${p}`}
              label={p}
              variant={p === cfg.preset ? 'primary' : 'secondary'}
              onPress={() => setCfg($, c => ({ ...c, preset: p }))}
            />
          ))}
        </Box>
      </Box>
      <Box flexDirection="column" marginTop="sm">
        <Box gap="sm">
          <Text weight="bold">Guard self-test</Text>
          <Button
            key="selftest"
            label="Run"
            onPress={async () => {
              await runSelfTest($)
            }}
          />
        </Box>
        {self === null && <Text dimColor>Not run yet. It only edits files that do not exist.</Text>}
        {self !== null &&
          self.rows.map(r => (
            <Text color={r.verdict === 'pass' ? 'success' : r.verdict === 'fail' ? 'error' : 'warning'}>
              {r.verdict === 'pass' ? 'PASS' : r.verdict === 'fail' ? 'FAIL' : 'NOTE'} {r.label}
            </Text>
          ))}
      </Box>
    </Box>
  )
}

const pauseTab = async ($: Dollar, e: RenderE) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const lines = pauseLines()

  return (
    <Box flexDirection="column">
      <Text>This mod cannot turn other mods off. Run these in a terminal, one per line:</Text>
      <Text dimColor size="caption">
        Names come from the build-time snapshot ({SNAPSHOT_AT}). Undo any of them with `claude plugin enable &lt;name&gt;@local-mods`.
      </Text>
      <Box marginTop="sm">
        <Button
          key="copy-all"
          label="Copy all lines"
          variant="primary"
          onPress={press => $.ui.copy({ text: lines.join('\n'), surface: press.surface })}
        />
      </Box>
      {lines.map((line, i) => (
        <Box gap="sm">
          <Button key={`copy-${i}`} label="Copy" onPress={press => $.ui.copy({ text: line, surface: press.surface })} />
          <Text mono>{line}</Text>
        </Box>
      ))}
    </Box>
  )
}

const shotTab = async ($: Dollar, e: RenderE, cfg: Cfg) => {
  const { Box, Text } = $.ui.resolve(e)
  const net = await read($, netAtom)
  const dirs = await read($, dirsAtom)
  const log = await read($, logAtom)
  const approvals = await read($, approvalsAtom)
  const profile = profileFor(cfg, await cwdOf($))
  const widest = MODS.filter(m => plainOf(m).risk >= 3).length

  return (
    <Box flexDirection="column">
      <Text weight="bold">Safe summary (counts only)</Text>
      <Text dimColor size="caption">No names, paths, hosts or commands are shown on this tab.</Text>
      <Text>Mods in snapshot: {MODS.length}, with wide access: {widest}</Text>
      <Text>Hosts contacted: {net.length}</Text>
      <Text>Folders touched: {dirs.length}</Text>
      <Text>Held by this mod: {log.filter(r => r.kind === 'deny').length}</Text>
      <Text>Warnings: {log.filter(r => r.kind === 'warn').length}</Text>
      <Text>Permission dialogs seen: {approvals.length}</Text>
      <Text>Profile here: {profile}</Text>
      <Text color={cfg.incident ? 'error' : 'subtle'}>Incident mode: {cfg.incident ? 'ON' : 'off'}</Text>
    </Box>
  )
}

const paneView = async ($: Dollar, e: RenderE) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const view = await read($, viewAtom)
  const cfg = await read($, cfgAtom)

  return (
    <Box flexDirection="column" padding="sm">
      <Box justifyContent="space-between">
        <Text size="heading" weight="bold">
          Controls
        </Text>
        {cfg.preset !== 'off' && <Text dimColor>masking: {cfg.preset}</Text>}
      </Box>
      <Box gap="sm" flexWrap="wrap" marginY="sm">
        {TABS.map(t => (
          <Button
            key={`tab-${t.tab}`}
            label={t.label}
            variant={t.tab === view.tab ? 'primary' : 'secondary'}
            onPress={() => update($, viewAtom, () => ({ tab: t.tab, page: 0 }))}
          />
        ))}
      </Box>
      {view.tab === 'mods' && (await modsTab($, e))}
      {view.tab === 'ledger' && (await ledgerTab($, e, cfg))}
      {view.tab === 'log' && (await logTab($, e, cfg))}
      {view.tab === 'rules' && (await rulesTab($, e, cfg))}
      {view.tab === 'pause' && (await pauseTab($, e))}
      {view.tab === 'shot' && (await shotTab($, e, cfg))}
    </Box>
  )
}

// ---------------------------------------------------------------------------

const lastRows = (rows: readonly string[], n: number) => rows.slice(-n)

export const register: Register = (on, options) => {
  const wanted = options?.startProfile
  startProfile = wanted === 'strict' || wanted === 'off' ? wanted : 'normal'

  on('session.start', async ($, e, next) => {
    for (const [name, description, argumentHint] of COMMANDS) {
      await $.command.register({ name, description, argumentHint }).catch(() => undefined)
    }
    const saved = await $.store.get('controls:cfg').catch(() => undefined)

    if (saved !== undefined) {
      await update($, cfgAtom, () => cleanCfg(saved))
    }
    const data = asRecord(await $.store.get('controls:data').catch(() => undefined))
    await update($, netAtom, () => listOf<NetRow>(data.net).slice(0, NET_CAP))
    await update($, dirsAtom, () => listOf<DirRow>(data.dirs).slice(0, DIR_CAP))
    await update($, logAtom, () => listOf<LogRow>(data.log).slice(-LOG_CAP))
    await update($, approvalsAtom, () => listOf<ApprovalRow>(data.approvals).slice(-APPROVAL_CAP))

    return next(e)
  })

  // The gates. Both can DENY, so both fail closed: if the check throws, the call is held.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const reason = await gateCall($, e as unknown as Input)

    return reason === undefined ? next(e) : { deny: reason }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed, so the command was held.` },
  )

  on('tool.call', { tool: /^(Edit|Write|NotebookEdit)$/ }, async ($, e, next) => {
    const reason = await gateCall($, e as unknown as Input)

    return reason === undefined ? next(e) : { deny: reason }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed, so the edit was held.` },
  )

  // The observer. It NEVER denies: if it fails the call simply goes on (fail open, by design).
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Input
    await before($, input).catch(() => undefined)
    const ran = await next(e)
    await after($, input, ran.deny !== undefined).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    const at = await onAsk($, e.tool_name, e.tool_input).catch(() => undefined)
    const out = await next(e)

    if (at !== undefined) {
      await onAnswered($, at, out.decision?.behavior).catch(() => undefined)
    }

    return out
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, approvalsAtom, list =>
      [...list, { at, tool: e.tool_name, detail: clip(scrub(e.reason), 90), outcome: 'auto-denied' as const }].slice(-APPROVAL_CAP),
    ).catch(() => undefined)

    return next(e)
  })

  // Clipboard watch (174, partial): sees only copies a mod makes through $.ui.copy. Warn only.
  on('ui.copy', async ($, e, next) => {
    if (looksSecret(e.text)) {
      await addLog($, 'warn', 'clipboard', 'copy', 'a mod copied text that looks like a secret (text not kept)').catch(() => undefined)
      await toast($, 'controls: a mod is copying text that looks like a secret (warning only)', 'any').catch(() => false)
    }

    return next(e)
  })

  on('command.run', { command: 'ct' }, async ($, e) => {
    if (e.args.trim() === 'open') {
      await openPane($, 'mods')

      return { text: 'Controls pane opened.' }
    }

    return { text: helpText() }
  })

  on('command.run', { command: 'ctmods' }, async ($, e) => {
    const name = e.args.trim()

    if (name !== '') {
      return { text: permsText(name) }
    }
    await openPane($, 'mods')

    return { text: `Privacy dashboard opened: ${MODS.length} mods from the build-time snapshot of ${SNAPSHOT_AT}. /ctmods <name> prints one mod in plain words.` }
  })

  on('command.run', { command: 'ctperms' }, async (_$, e) => ({ text: permsText(e.args.trim()) }))

  on('command.run', { command: 'ctpause' }, async $ => {
    await openPane($, 'pause')

    return {
      text: [
        'controls cannot disable other mods itself. To disable them, run these in a terminal (one per line):',
        ...pauseLines().map(l => `  ${l}`),
        `(Names are from the build-time snapshot of ${SNAPSHOT_AT}. Undo with claude plugin enable <name>@local-mods. The Pause tab has copy buttons.)`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'ctredact' }, async ($, e) => {
    const arg = e.args.trim()
    const cfg = await read($, cfgAtom)

    if (arg === '') {
      return {
        text: `Masking preset: ${cfg.preset} (applies to this mod's own panes only, never to the transcript or other mods).\n${PRESETS.filter(p => p !== 'off').map(p => `  ${p}: ${RULES_OF(p).map(r => r.name).join(', ')}`).join('\n')}\nUsage: /ctredact work|personal|presenting|off sets the preset; /ctredact <text> previews masking.`,
      }
    }

    if (PRESETS.includes(arg as Preset)) {
      await setCfg($, c => ({ ...c, preset: arg as Preset }))

      return { text: `Masking preset is now ${arg}. It applies to the controls pane only.` }
    }

    return {
      text: ['Preview (the text is not stored):', ...(['work', 'personal', 'presenting'] as const).map(p => `  ${p}: ${redact(arg, p)}`)].join('\n'),
    }
  })

  on('command.run', { command: 'ctledger' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'clear') {
      await update($, netAtom, () => [])
      await update($, dirsAtom, () => [])
      await persist($)

      return { text: 'Ledgers cleared.' }
    }
    await openPane($, 'ledger')
    const cfg = await read($, cfgAtom)
    const net = await read($, netAtom)
    const dirs = await read($, dirsAtom)
    const mask = (t: string) => redact(t, cfg.preset)

    return {
      text: [
        'Ledger pane opened.',
        `Hosts (${net.length}): ${net.length === 0 ? 'none' : net.slice(0, 6).map(r => `${mask(r.host)} x${r.n}`).join(', ')}`,
        `Folders (${dirs.length}): ${dirs.length === 0 ? 'none' : dirs.slice(0, 6).map(r => `${mask(r.dir)} r${r.r}/w${r.w}`).join(', ')}`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'ctapprovals' }, async ($, _e) => {
    await openPane($, 'log')
    const cfg = await read($, cfgAtom)
    const rows = await read($, approvalsAtom)

    return {
      text: [
        'Permission dialogs (the mod sees a dialog open and whether the call then ran; it cannot see your click, so approved/denied is inferred):',
        ...(rows.length === 0
          ? ['  none recorded']
          : lastRows(
              rows.map(r => `  ${clockText(r.at)} ${r.outcome} ${r.tool} ${redact(r.detail, cfg.preset)}`),
              8,
            )),
      ].join('\n'),
    }
  })

  on('command.run', { command: 'cttest' }, async ($, e) => {
    const subject = e.args.trim()

    if (subject === '') {
      return { text: 'Usage: /cttest <command>   or   /cttest edit <path>. It only reports; it never runs anything.' }
    }
    const cfg = await read($, cfgAtom)
    const cwd = await cwdOf($)
    const lines = testReport(subject, profileFor(cfg, cwd), cfg.blocks, cfg.allows, cfg.incident, await $.clock.now(), cwd)

    return {
      text: [`Rule test (nothing was run). tool-guard lines use a COPY of its patterns from ${TG_COPY_DATE}, not the live rules.`, ...lines.map(l => `  ${l}`)].join('\n'),
    }
  })

  on('command.run', { command: 'ctblock' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const text = rest.join(' ')

    if (verb === 'add') {
      return { text: await addBlock($, text) }
    }

    if (verb === 'rm') {
      return { text: await removeBlock($, text) }
    }
    const cfg = await read($, cfgAtom)
    await openPane($, 'rules')

    return {
      text: `${cfg.blocks.length === 0 ? 'No extra blocks (default).' : `Extra blocked substrings:\n${cfg.blocks.map(b => `  ${redact(b, cfg.preset)}`).join('\n')}`}\nUsage: /ctblock add <text> | rm <text>. Matches Bash commands containing the text, case-insensitive, at least 3 characters. This only adds to tool-guard and safety-pro, it never loosens them.`,
    }
  })

  on('command.run', { command: 'ctallow' }, async ($, e) => {
    const parsed = parseAllow(e.args)
    const now = await $.clock.now()

    if (parsed.kind === 'error') {
      return { text: parsed.message }
    }

    if (parsed.kind === 'clear') {
      await setCfg($, c => ({ ...c, allows: [] }))

      return { text: 'All temporary allows cleared.' }
    }

    if (parsed.kind === 'list') {
      const live = (await read($, cfgAtom)).allows.filter(a => a.until > now)

      return {
        text:
          live.length === 0
            ? 'No temporary allows. Usage: /ctallow <substring> <minutes>. It lets one of THIS mod\'s rules pass; it cannot loosen tool-guard or safety-pro.'
            : `Active:\n${live.map(a => `  ${a.text}: ${minsLeft(a.until, now)} min left`).join('\n')}`,
      }
    }
    await setCfg($, c => ({
      ...c,
      allows: [...c.allows.filter(a => a.until > now && a.text !== parsed.text), { text: parsed.text, until: now + parsed.minutes * 60_000 }].slice(-MAX_ALLOWS),
    }))

    return {
      text: `Rules of this mod whose name contains "${parsed.text}" are waived for ${parsed.minutes} min, then they apply again by themselves. tool-guard and safety-pro are unaffected: if they refuse, this does not help. Incident mode is not waivable (use /ctincident off).`,
    }
  })

  on('command.run', { command: 'ctprofile' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const cwd = await cwdOf($)

    if (arg === 'strict' || arg === 'normal' || arg === 'off') {
      return { text: await setProfile($, arg) }
    }
    const cfg = await read($, cfgAtom)

    return {
      text: `Profile for ${redact(cwd, cfg.preset)}: ${profileFor(cfg, cwd)}${cfg.profiles[cwd] === undefined ? ' (default from the mod options)' : ''}.\nUsage: /ctprofile strict | normal | off. strict = your blocks plus built-in sudo, git reset --hard, git clean -f, chmod -R, DROP TABLE, npm publish. normal = your blocks. off = none of this mod's block rules (incident mode still applies).`,
    }
  })

  on('command.run', { command: 'ctincident' }, async ($, e) => {
    const flag = onOff(e.args)

    if (flag === undefined) {
      return { text: `Incident mode is ${(await read($, cfgAtom)).incident ? 'ON' : 'off'}. Usage: /ctincident on | off.` }
    }

    return { text: await setIncident($, flag) }
  })

  on('command.run', { command: 'ctselftest' }, async $ => {
    const result = await runSelfTest($)
    await openPane($, 'rules')

    return { text: `Guard self-test (3 harmless Edit calls on files that do not exist, no Write, no Bash):\n${selfText(result)}` }
  })

  on('command.run', { command: 'ctshot' }, async $ => {
    await openPane($, 'shot')

    return { text: 'Screenshot-safe pane opened: counts only, no names, paths, hosts or commands.' }
  })

  on('command.run', { command: 'ctreset' }, async ($, e) => {
    const all = e.args.trim().toLowerCase() === 'all'
    await clearData($, all)

    return {
      text: all
        ? 'Everything controls recorded and all of its settings were cleared (blocks, allows, profiles, preset, incident mode).'
        : 'Recorded data cleared (ledgers, log, approvals, self-test). Settings kept; /ctreset all clears those too.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => paneView($, e))

  // Banner: only while incident mode is on, otherwise nothing is drawn.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cfg = await read($, cfgAtom)

    if (!cfg.incident || e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text color="error" size="caption">
          controls: INCIDENT MODE. Edits and mutating commands are held and every call is logged. /ctincident off ends it.
        </Text>
      </Box>
    )
  })
}
