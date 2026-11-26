import type { Register } from 'claude-code'

const REVIEW =
  'Review the changes in this session for correctness bugs, risky edge cases and missing tests. List findings by severity with file and line, and say what you did not check.'

const PREFERENCES = {
  id: 'prompt-tools:preferences',
  scope: 'session',
  text: 'Standing preferences: keep answers short and concrete; ask before large refactors or deleting files; say plainly what was not verified.',
} as const

const ACTIONS = [
  { key: 'explain', label: 'Explain this', prefix: 'Explain this:\n' },
  { key: 'test', label: 'Write a test for this', prefix: 'Write a test for this:\n' },
  { key: 'simplify', label: 'Simplify this', prefix: 'Suggest a simpler version of this:\n' },
] as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'audit',
      description: 'Fill the prompt with a review request for this session',
    })

    await $.command.register({
      name: 'snip',
      description: 'Snippets: /snip save <name> <text>, /snip <name>, /snip list, /snip rm <name>',
    }).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'snip' }, async ($, e) => {
    const saved = (await $.store.get('snippets')) as Record<string, string> | undefined
    const snippets: Record<string, string> = { ...(saved ?? {}) }
    const [verb = '', name = '', ...rest] = e.args.trim().split(/\s+/)

    if (verb === 'save' && name !== '' && rest.length > 0) {
      snippets[name] = rest.join(' ')
      await $.store.set('snippets', snippets)

      return { text: `Saved snippet "${name}".` }
    }

    if (verb === 'rm' && name in snippets) {
      delete snippets[name]
      await $.store.set('snippets', snippets)

      return { text: `Removed "${name}".` }
    }

    if (verb === '' || verb === 'list') {
      const names = Object.keys(snippets)

      return { text: names.length === 0 ? 'No snippets yet. /snip save <name> <text>' : names.map(n => `${n}: ${snippets[n]}`).join('\n') }
    }

    if (verb in snippets) {
      await $.prompt.fill({ text: snippets[verb] ?? '', mode: 'replace' })

      return { text: `Snippet "${verb}" is in the prompt box.` }
    }

    return { text: 'Usage: /snip save <name> <text> | /snip <name> | /snip list | /snip rm <name>' }
  })

  on('command.run', { command: 'audit' }, async $ => {
    await $.prompt.fill({ text: REVIEW, mode: 'replace' })

    return { text: 'Audit prompt is in the box. Press Enter to send.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { ...composed, sections: [...composed.sections, PREFERENCES] }
  })

  on('ui.render', { component: 'ContextMenu' }, ($, e, next) => {
    const selected = e.props.selection?.text

    if (selected === undefined || selected.trim() === '') {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {ACTIONS.map(action => (
          <Button
            key={action.key}
            onPress={() => $.prompt.fill({ text: `${action.prefix}${selected.replace(/^/gm, '> ')}\n`, mode: 'insert' })}
          >
            {action.label} <Text dimColor>Adds to the prompt</Text>
          </Button>
        ))}
      </Box>
    )
  })
}
