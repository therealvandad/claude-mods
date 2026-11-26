import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isReadOnly = atom({ plugin: 'tool-guard', key: 'isReadOnly' } as const, false)

const MUTATING = /\b(rm|mv|cp|touch|mkdir|tee|sed\s+-i|git\s+(commit|push|checkout|reset|rebase|merge|clean)|npm\s+(install|publish)|pip\s+install)\b|>\s*[^&\s]/

const PROTECTED = /(^|\/)(\.env(\..+)?|id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials)/

const BLOCKED: readonly [RegExp, string][] = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive)\b[^|;&]*\s(\/|~|\$HOME|\*)(\s|$)/, 'recursive delete of root, home or *'],
  [/\bgit\s+push\b[^|;&]*(--force\b|\s-f\b)(?!-with-lease)/, 'force push (use --force-with-lease)'],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'piping a download into a shell'],
  [/\bmkfs\b|\bdd\s+if=.*\sof=\/dev\//, 'disk-level write'],
]

const HIGH = /\b(sudo|rm\s+-[a-z]*r|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|chmod\s+-R|drop\s+(table|database))\b/i
const MEDIUM = /\b(rm|mv|git\s+(checkout|rebase|push)|npm\s+(publish|uninstall)|pip\s+uninstall|kill|pkill)\b/i
const TESTS = /\b(npm\s+(run\s+)?test|pnpm\s+test|yarn\s+test|vitest|jest|pytest|go\s+test|cargo\s+test|swift\s+test|mocha|rspec)\b/

type Risk = 'high' | 'medium' | null

const riskOf = (command: string): Risk =>
  HIGH.test(command) ? 'high' : MEDIUM.test(command) ? 'medium' : null

const countOf = (text: string, word: string) => {
  const hit = new RegExp(`(\\d+)\\s+${word}`, 'i').exec(text)

  return hit === null ? 0 : Number(hit[1])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'readonly',
      description: 'Toggle read-only mode: blocks file edits and mutating shell commands',
    }).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'readonly' }, async $ => {
    const next = !(await read($, isReadOnly))
    await update($, isReadOnly, () => next)
    $.ui.status(next ? 'READ-ONLY' : undefined)

    return { text: next ? 'Read-only mode ON: edits and mutating commands are blocked.' : 'Read-only mode off.' }
  })

  {
    on('tool.call', { tool: /^(Edit|Write|NotebookEdit)$/ }, async ($, e, next) => {
      if (await read($, isReadOnly)) {
        return { deny: `${$.plugin.name}: read-only mode is on. Ask the user to run /readonly to allow edits.` }
      }
      const path = String((e as unknown as { file_path?: string; notebook_path?: string }).file_path ?? (e as unknown as { notebook_path?: string }).notebook_path ?? '')

      return PROTECTED.test(path)
        ? { deny: `${$.plugin.name}: ${path} is protected (secrets). Ask the user to edit it.` }
        : next(e)
    }).catch(($, e, next) =>
      next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed, so the edit was held.` },
    )
  }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String((e as unknown as { command?: string }).command ?? '')
    const hit = BLOCKED.find(([pattern]) => pattern.test(command))

    if (hit === undefined && (await read($, isReadOnly)) && MUTATING.test(command)) {
      return { deny: `${$.plugin.name}: read-only mode is on, so this command was held. Ask the user to run /readonly.` }
    }

    if (hit !== undefined) {
      $.ui.toast(`Blocked: ${hit[1]}`)

      return { deny: `${$.plugin.name}: blocked (${hit[1]}). Propose a safer command or ask the user.` }
    }

    return next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed, so the command was held.` },
  )

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'Bash') {
      return next(e)
    }
    const command = String((e.props.input as { command?: string } | undefined)?.command ?? '')
    const risk = riskOf(command)
    const isTest = TESTS.test(command)

    if (risk === null && !isTest) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const out = e.props.output as { stdout?: string; stderr?: string } | undefined
    const text = `${out?.stdout ?? ''}\n${out?.stderr ?? ''}`
    const failed = countOf(text, 'failed') + countOf(text, 'failures?') + countOf(text, 'errors?')
    const passed = countOf(text, 'passed') + countOf(text, 'passing')
    const showCard = isTest && !e.props.isRunning && (passed > 0 || failed > 0)

    return (
      <Box
        flexDirection="column"
        borderStyle={showCard ? 'round' : undefined}
        borderColor={showCard ? (failed > 0 ? 'error' : 'success') : undefined}
      >
        {await next(e)}
        {risk !== null && (
          <Text color={risk === 'high' ? 'error' : 'warning'}>
            {risk === 'high' ? '▲ high-risk command' : '△ changes things'}
          </Text>
        )}
        {showCard && (
          <Text color={failed > 0 ? 'error' : 'success'} bold>
            {failed > 0 ? `✗ ${failed} failed, ${passed} passed` : `✓ ${passed} passed`}
          </Text>
        )}
      </Box>
    )
  })
}
