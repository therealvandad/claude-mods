// Static command list, written at BUILD time from the `description` strings in each mod's register file.
// Nothing here is read at run time. When another mod adds a command, add a row here.

export type Cheat = { name: string; description: string }
export type CheatGroup = { mod: string; commands: Cheat[] }

export const CHEATS: CheatGroup[] = [
  {
    mod: 'extras',
    commands: [
      { name: 'present', description: 'Screen-share mode: /present on | off (masks home, user, emails, secrets, project paths on screen only)' },
      { name: 'alerts', description: 'Desktop alert when a turn over 60 s ends: /alerts on | off | test' },
      { name: 'lint', description: 'Gentle hint when a draft prompt looks vague: /lint on | off' },
      { name: 'health', description: 'Session health score (0-100) and its four factors, in a pane' },
      { name: 'toolcost', description: 'Which tools produced the most output and time, in a pane' },
      { name: 'replay', description: 'Step through this session\'s tool calls with first/prev/next/last' },
      { name: 'cheats', description: 'This list: every slash command added by the mods, as buttons' },
      { name: 'snaps', description: 'Browse safety-pro snapshots (read-only; restore stays with /rollback)' },
    ],
  },
  {
    mod: 'workbench',
    commands: [
      { name: 'dashboard', description: 'Open the live session dashboard pane' },
      { name: 'files', description: 'Open the changed-files pane' },
      { name: 'notes', description: 'Open the notes pane' },
      { name: 'note', description: 'Save a note: /note <text>' },
      { name: 'timer', description: 'Start a timer: /timer <minutes> (or /timer off)' },
      { name: 'budget', description: 'Set a spend alert in dollars: /budget <usd> (or /budget off)' },
      { name: 'focus', description: 'Toggle focus mode: hides the band above the prompt' },
      { name: 'sessionrecap', description: 'Summarize this session as standup notes' },
    ],
  },
  {
    mod: 'cockpit',
    commands: [
      { name: 'cockpit', description: 'Open the cockpit pane: /cockpit [overview|timeline|files|todo|history|errors|links|palette]' },
      { name: 'ctodo', description: 'Add a todo: /ctodo <text> (tick them off in the cockpit Todo tab)' },
      { name: 'csearch', description: 'Search this session\'s prompts and tool calls: /csearch <text>' },
      { name: 'cshelf', description: 'Snippet shelf: /cshelf add <text>, /cshelf <n>, /cshelf rm <n>' },
      { name: 'cpin', description: 'Pin or unpin a note on top of the cockpit: /cpin <text>' },
      { name: 'cfocus', description: 'Hide or show only the cockpit bands' },
    ],
  },
  {
    mod: 'safety-pro',
    commands: [
      { name: 'allow', description: 'Per-project allowlist: /allow <command-prefix> | list | rm <prefix> | add <prefix>' },
      { name: 'dryrun', description: 'Hold mutating commands and edits so the model describes them instead: on | off' },
      { name: 'snapshot', description: 'Opt-in checkpoint after each turn under refs/claude-checkpoints: on | off | now | list' },
      { name: 'rollback', description: 'Restore files from the previous checkpoint: preview first, then /rollback confirm' },
      { name: 'hardbudget', description: 'Hard spend stop in dollars: /hardbudget <usd> | off' },
      { name: 'safecompact', description: 'Auto-compact at 85% context, at most every 10 minutes: on | off' },
      { name: 'loopguard', description: 'Deny the 4th identical consecutive tool call: on | off' },
      { name: 'protect', description: 'Protect paths from Edit and Write: /protect <path> | list | rm <path>' },
      { name: 'safetylog', description: 'Open the safety log pane (blocks and allows with reasons): /safetylog clear' },
      { name: 'precommit', description: 'Run a check before the model may git commit: /precommit <command> | off' },
      { name: 'handoff', description: 'Write a session handoff note (kept in the mod store) and fill the prompt: /handoff show' },
    ],
  },
  {
    mod: 'tool-guard',
    commands: [{ name: 'readonly', description: 'Toggle read-only mode: blocks file edits and mutating shell commands' }],
  },
  {
    mod: 'prompt-tools',
    commands: [
      { name: 'audit', description: 'Fill the prompt with a review request for this session' },
      { name: 'snip', description: 'Snippets: /snip save <name> <text>, /snip <name>, /snip list, /snip rm <name>' },
    ],
  },
  {
    mod: 'looks',
    commands: [{ name: 'look', description: 'Pick a look or a moving scene: /look <name>, /look off, /look scene <name>' }],
  },
  {
    mod: 'motion',
    commands: [{ name: 'motion', description: 'Motion on/off: /motion on|off|demo|timer <minutes>' }],
  },
  {
    mod: 'sound-pack',
    commands: [{ name: 'sound', description: 'Sound packs: /sound <retro|wood|glass|silent|off>, ticks, speak, quiet' }],
  },
  {
    mod: 'tool-visuals',
    commands: [{ name: 'toolvis', description: 'Tool-call visuals: /toolvis on | off | status (secret masking stays on either way)' }],
  },
  {
    mod: 'personality',
    commands: [
      { name: 'fun', description: 'Switch the quiet fun on or off: /fun on, /fun off, /fun motion on|off' },
      { name: 'streak', description: 'Show your edit streak: days in a row with a file edit' },
      { name: 'badges', description: 'List achievement badges and your progress' },
      { name: 'pet', description: 'Open the little pet pane (/pet off to close it)' },
      { name: 'tip', description: 'Show another tip about Claude Code' },
      { name: 'sprint', description: 'Focus sprint: /sprint <minutes> <what you will do> (also: stop, status)' },
      { name: 'sprintlog', description: 'List your recent focus sprints' },
      { name: 'weekly', description: 'Report on the last 7 days (/weekly pane opens it as a pane)' },
    ],
  },
]

export const cheatCount = () => CHEATS.reduce((sum, group) => sum + group.commands.length, 0)

// The text `/cheats` answers with.
export const cheatsText = (): string => {
  const lines: string[] = [`Slash commands added by the mods (${cheatCount()}):`]

  for (const group of CHEATS) {
    lines.push('', `${group.mod}`)

    for (const one of group.commands) {
      lines.push(`  /${one.name}  ${one.description}`)
    }
  }

  return lines.join('\n')
}

// What a row's button puts in the prompt box: the command and a space, ready for arguments.
export const fillFor = (name: string) => `/${name} `
