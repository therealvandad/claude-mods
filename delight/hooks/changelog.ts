// Hand-written, plain-language changelog, embedded at build time. One entry per mod:
// what it does for you today, in a few lines, and the command to start with.
// Written for the mods that existed when delight was built; newer mods are added by editing this file.

export type ChangeEntry = { mod: string; version: string; summary: string; lines: string[]; start: string }

export const CHANGELOG: readonly ChangeEntry[] = [
  {
    mod: 'delight',
    version: '0.1.0',
    summary: 'A small box of extras. Everything is off except the gallery and the help.',
    lines: [
      'New: /dlgallery lists every mod with its commands and a button that fills the prompt with its help command.',
      'New: a seven-step tour, fortune cookies, a look and a sound for the week, ambient suggestions and two mini-games.',
      'New, opt-in with /dltrack on: milestone postcards, a pet accessory preview, usage by mod and mod recommendations.',
      'New, each opt-in: rare compliments (/dlkind), a typing-speed meter (/dltype) and a weekly check-in card (/dlaudit).',
    ],
    start: '/dl',
  },
  {
    mod: 'workbench',
    version: '0.1.0',
    summary: 'A live session dashboard and small work panes.',
    lines: [
      'A dashboard of the session, a list of changed files, notes and a timer, each in its own pane.',
      'A band above the prompt with context use and quick replies, and a spend alert you set yourself.',
      '/sessionrecap writes the session as standup notes.',
    ],
    start: '/dashboard',
  },
  {
    mod: 'tool-guard',
    version: '0.1.0',
    summary: 'Stops risky tool calls before they run.',
    lines: [
      'Blocks risky shell commands and marks commands by how risky they are.',
      'Shows a pass or fail card under test runs.',
      '/readonly blocks file edits and changing shell commands until you switch it off.',
    ],
    start: '/readonly',
  },
  {
    mod: 'look-and-sound',
    version: '0.1.0',
    summary: 'Sound cues when a turn finishes or fails.',
    lines: ['Plays a short chime when Claude finishes and a different tone when something fails.', 'The Dusk ink theme it once shipped is switched off.'],
    start: '(no command: it just plays sounds)',
  },
  {
    mod: 'prompt-tools',
    version: '0.1.0',
    summary: 'Shortcuts for writing prompts.',
    lines: [
      'Right-click prompt shortcuts and standing prompt preferences.',
      '/snip saves and reuses snippets of text; /audit fills the prompt with a review request for the session.',
    ],
    start: '/snip',
  },
  {
    mod: 'looks',
    version: '0.1.0',
    summary: 'Colour looks you choose yourself.',
    lines: [
      'No theme is applied until you pick one: paper, nord, solarized, sepia, high contrast, the seasons, time of day and more.',
      'A look can be bound to a folder or follow the model in use; subtle moving backdrops need motion on.',
    ],
    start: '/look',
  },
  {
    mod: 'motion',
    version: '0.1.0',
    summary: 'Calm motion, with one switch.',
    lines: [
      'Eased gauges, number tickers, a shimmer on running tools, check pops and a spring timer ring.',
      '/motion off stops the animation of every mod at once.',
    ],
    start: '/motion',
  },
  {
    mod: 'cockpit',
    version: '0.1.0',
    summary: 'One tabbed pane for the whole session.',
    lines: [
      'Tabs for overview, tool timeline, files, todo, history, errors, links and a command palette.',
      'A git and spend band, forecasts, pinned notes and a snippet shelf.',
    ],
    start: '/cockpit',
  },
  {
    mod: 'tool-visuals',
    version: '0.1.0',
    summary: 'Richer tool-call rows.',
    lines: [
      'Risk edges, file glyphs, mini diffs, duration and size chips, network badges and retry counts on tool rows.',
      'Failing-test and build-error cards. Secrets stay masked either way.',
    ],
    start: '/toolvis',
  },
  {
    mod: 'sound-pack',
    version: '0.1.0',
    summary: 'Sound packs for turns, errors and questions.',
    lines: [
      'Three packs (retro, wood, glass) plus silent, with a finish chime, error tones and an approval cue.',
      'Optional ticks, spoken summaries, quiet hours and volume that follows turn length.',
    ],
    start: '/sound',
  },
  {
    mod: 'safety-pro',
    version: '0.1.0',
    summary: 'Guard rails you switch on yourself.',
    lines: [
      'Dry run, an allowlist, a hard spend stop, a loop breaker and protected paths.',
      'Opt-in checkpoints with a confirmed rollback, a pre-commit check, auto-compact and a handoff note.',
      '/safetylog shows what was blocked and why.',
    ],
    start: '/safetylog',
  },
  {
    mod: 'personality',
    version: '0.1.0',
    summary: 'Quiet, switchable fun.',
    lines: [
      'A mood status, edit streaks, badges, a tiny pet, a greeting and a tip of the day.',
      'Focus sprints and a weekly report. /fun off silences all of it.',
    ],
    start: '/fun',
  },
  {
    mod: 'animations',
    version: '0.1.0',
    summary: 'Fourteen small terminal animations.',
    lines: [
      'Heartbeat, context tank, coin drop, confetti on commit, flip clock, sky strip and more, all on one shared ticker.',
      'A lab pane shows each one on its own.',
    ],
    start: '/anim lab',
  },
  {
    mod: 'extras',
    version: '0.1.0',
    summary: 'A drawer of useful extras.',
    lines: [
      'Screen-share masking, an away digest, smart alerts, a prompt linter, a session health score and per-tool cost.',
      'A replay scrubber, a command cheat sheet and a read-only snapshot browser.',
    ],
    start: '/cheats',
  },
  {
    mod: 'alerts',
    version: '0.1.0',
    summary: 'One quiet place for this mod\u2019s notices.',
    lines: [
      'Notices have priority levels, can be snoozed, muted by category and held back during quiet hours.',
      'Alerts for deadlines, spend, rate limits, context use, idle time, disk space and the network, with a history and a digest.',
    ],
    start: '/al',
  },
  {
    mod: 'controls',
    version: '0.1.0',
    summary: 'See and control what the mods are allowed to do.',
    lines: [
      'Lists what every mod can do, which hosts and folders were touched, and lets you test a rule before relying on it.',
      'Temporary allows, per-project profiles, an incident mode and a self-test of the guards around tool-guard and safety-pro.',
    ],
    start: '/ct',
  },
  {
    mod: 'debug-kit',
    version: '0.1.0',
    summary: 'Helpers for when something is broken.',
    lines: [
      'Focus on the failing test, a bisect guide, a stack-trace explainer and a repro recorder.',
      'Flaky, coverage and timing insights, a log tail, error clusters, a hypothesis board, breadcrumbs and a postmortem draft.',
    ],
    start: '/db',
  },
  {
    mod: 'git-kit',
    version: '0.1.0',
    summary: 'Read-only git helpers.',
    lines: [
      'Learns your commit style, suggests branch names and drafts pull request text and changelogs.',
      'A status map, merge preview, stash, worktree and submodule views, repo health and merge readiness. It never changes the repository.',
    ],
    start: '/gk',
  },
  {
    mod: 'layout',
    version: '0.1.0',
    summary: 'How things are drawn.',
    lines: [
      'Zen mode, a split view, a floating note, sticky headers and collapsible sections.',
      'Width and density controls, error and long-output banners, icon packs and a colour legend.',
    ],
    start: '/ly',
  },
  {
    mod: 'learning',
    version: '0.1.0',
    summary: 'Learn while you work.',
    lines: [
      'Glossaries, flashcards with spaced repetition, a learning log, a reading list and a skill tracker.',
      'Explainer prompts, plus opt-in mentor, rubber-duck and beginner modes.',
    ],
    start: '/ln',
  },
  {
    mod: 'notes',
    version: '0.1.0',
    summary: 'A searchable notes archive.',
    lines: [
      'Notes per folder with tags and links, snippets, a command cookbook and a daily journal.',
      'Reminders, recurring tasks, backup and restore.',
    ],
    start: '/nt',
  },
  {
    mod: 'prompting',
    version: '0.1.0',
    summary: 'Prompt craft, all off by default.',
    lines: [
      'Templates, context blocks, macros, a queue, A/B prompts, a scorecard, diffs and rewording.',
      'Clean-up, tone and other standing instructions you switch on yourself.',
    ],
    start: '/pm',
  },
  {
    mod: 'review-kit',
    version: '0.1.0',
    summary: 'A review helper for code Claude changed.',
    lines: [
      'A tickable checklist and 19 heuristic detectors in one pane: risky paths, test gaps, complexity, TODOs, dead code, naming and more.',
      'Also patch size, error handling, logging, migrations, performance and accessibility hints.',
    ],
    start: '/rk',
  },
]
