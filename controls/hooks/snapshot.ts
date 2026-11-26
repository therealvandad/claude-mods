// Generated at BUILD time by a script that read every plugin.json and the
// `calls:` / `hooks:` / `gating hook` lines of `claude plugin validate --json`.
// It is a SNAPSHOT: mods installed or changed later are not in it.
export type ModInfo = {
  name: string
  version: string
  description: string
  deps: string[]
  events: string[]
  commands: string[]
  calls: string[]
  gatesCaught: string[]
  gatesBare: string[]
}

export const SNAPSHOT_AT = "2026-11-25"

export const MODS: readonly ModInfo[] = [
  {
    "name": "alerts",
    "version": "0.1.0",
    "description": "One quiet notifier for this mod's notices: priority levels, digest, snooze, quiet hours, per-category mute, history, waiting-on-you band, deadline, cost, rate-limit, context, idle, disk and network alerts (all /al commands)",
    "deps": [],
    "events": [
      "session.start",
      "session.end",
      "classic.PermissionRequest",
      "tool.call",
      "turn.start",
      "turn.complete",
      "prompt.submit",
      "ui.render"
    ],
    "commands": [
      "?"
    ],
    "calls": [
      "$.audio.play",
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.process.run",
      "$.session.usage",
      "$.state.get",
      "$.state.set",
      "$.store.delete",
      "$.store.get",
      "$.store.set",
      "$.ui.notify",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "classic.PermissionRequest",
      "prompt.submit",
      "tool.call"
    ]
  },
  {
    "name": "animations",
    "version": "0.1.0",
    "description": "Fourteen state-driven terminal animations (heartbeat, context tank, coin drop, sparkline draw-in, sliding tab underline, error shake, commit confetti, flip clock, badge flash, sky strip, skeleton shimmer, conveyor queue, ink-spread edits, ambient waves) on one shared ticker, with a lab pane and /anim",
    "deps": [
      "motion"
    ],
    "events": [
      "session.start",
      "turn.start",
      "turn.complete",
      "turn.abort",
      "tool.call",
      "ui.close",
      "ui.render"
    ],
    "commands": [
      "anim"
    ],
    "calls": [
      "$.clock.after",
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.session.usage",
      "$.state.get",
      "$.state.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.status",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "tool.call",
      "turn.abort",
      "ui.close"
    ],
    "gatesBare": []
  },
  {
    "name": "cockpit",
    "version": "0.1.0",
    "description": "One tabbed cockpit pane (overview, tool timeline, files, todo, history, errors, links, palette) plus a git/spend band, forecasts, shelves and pins",
    "deps": [
      "motion"
    ],
    "events": [
      "session.start",
      "prompt.submit",
      "tool.call",
      "turn.complete",
      "ui.render"
    ],
    "commands": [
      "cockpit",
      "ctodo",
      "csearch",
      "cshelf",
      "cpin",
      "cfocus"
    ],
    "calls": [
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.process.run",
      "$.prompt.fill",
      "$.session.usage",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.copy",
      "$.ui.open",
      "$.ui.resolve"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "prompt.submit",
      "tool.call"
    ]
  },
  {
    "name": "controls",
    "version": "0.1.0",
    "description": "Trust and transparency: what every mod can do, outbound-host and folder ledgers, rule tester, temporary allow, per-project profiles, incident mode and a guard self-test, around tool-guard and safety-pro",
    "deps": [],
    "events": [
      "session.start",
      "tool.call",
      "classic.PermissionRequest",
      "classic.PermissionDenied",
      "ui.copy",
      "ui.render"
    ],
    "commands": [
      "ct",
      "ctmods",
      "ctperms",
      "ctpause",
      "ctredact",
      "ctledger",
      "ctapprovals",
      "cttest",
      "ctblock",
      "ctallow",
      "ctprofile",
      "ctincident",
      "ctselftest",
      "ctshot",
      "ctreset"
    ],
    "calls": [
      "$.clock.now",
      "$.command.register",
      "$.session.cwd",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.tool.call",
      "$.ui.copy",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "tool.call",
      "tool.call{tool=/\"^(Edit|Write|NotebookEdit)$\"/}",
      "tool.call{tool=Bash}"
    ],
    "gatesBare": [
      "classic.PermissionDenied",
      "classic.PermissionRequest",
      "ui.copy"
    ]
  },
  {
    "name": "debug-kit",
    "version": "0.1.0",
    "description": "Debugging helpers: failing-test focus, bisect guide, stack-trace explainer, repro recorder, flaky/coverage/timing/snapshot test insights, log tail, error clusters, hypothesis board, breadcrumbs, env snapshot, port finder, mock map, crash-loop and regression guards, postmortem draft",
    "deps": [
      "motion"
    ],
    "events": [
      "session.start",
      "tool.call",
      "turn.complete",
      "ui.close",
      "ui.render"
    ],
    "commands": [
      "?"
    ],
    "calls": [
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.fs.read",
      "$.fs.stat",
      "$.process.run",
      "$.prompt.fill",
      "$.prompt.suggest",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.ui.open",
      "$.ui.panes",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "ui.close"
    ],
    "gatesBare": [
      "tool.call"
    ]
  },
  {
    "name": "delight",
    "version": "0.1.0",
    "description": "Small delights, all off by default except the gallery and /dl help: theme and sound of the week, fortune cookies, mini-games, pet wardrobe preview, milestone postcards, rare compliments, mod gallery, tour, changelog and usage heat (/dl lists the commands)",
    "deps": [],
    "events": [
      "session.start",
      "session.end",
      "turn.complete",
      "command.run",
      "tool.call",
      "prompt.edit",
      "prompt.submit",
      "ui.render"
    ],
    "commands": [
      "dl",
      "dlgallery",
      "dlpane",
      "dltour",
      "dlweek",
      "dlsound",
      "dlmusic",
      "dlcookie",
      "dlwear",
      "dlgame",
      "dlcard",
      "dlretro",
      "dlhunt",
      "dltrack",
      "dlkind",
      "dltype",
      "dlaudit",
      "dlheat",
      "dlrecommend",
      "dlfeedback",
      "dlfeedbacks",
      "dlnew",
      "dlchangelog",
      "dlreset",
      "dlxyzzy",
      "dlplugh",
      "dlquack",
      "dlsudo",
      "dlmeow"
    ],
    "calls": [
      "$.clock.now",
      "$.command.register",
      "$.prompt.fill",
      "$.state.get",
      "$.state.set",
      "$.store.delete",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "prompt.submit",
      "tool.call"
    ],
    "gatesBare": []
  },
  {
    "name": "extras",
    "version": "0.1.0",
    "description": "Screen-share masking, away digest, smart alerts, prompt linter, session health, per-tool cost, replay scrubber, command cheatsheet, auto-title and a read-only snapshot browser",
    "deps": [],
    "events": [
      "session.start",
      "session.end",
      "tool.call",
      "turn.start",
      "turn.complete",
      "prompt.submit",
      "prompt.edit",
      "classic.UserPromptSubmit",
      "ui.render"
    ],
    "commands": [
      "present",
      "alerts",
      "lint",
      "health",
      "toolcost",
      "replay",
      "cheats",
      "snaps"
    ],
    "calls": [
      "$.clock.after",
      "$.clock.now",
      "$.command.register",
      "$.env.get",
      "$.process.run",
      "$.prompt.fill",
      "$.prompt.read",
      "$.session.cwd",
      "$.session.usage",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.notify",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.status",
      "$.ui.toast"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "classic.UserPromptSubmit",
      "prompt.submit",
      "tool.call"
    ]
  },
  {
    "name": "git-kit",
    "version": "0.1.0",
    "description": "Read-only git helpers: commit-style learner, branch names, PR drafts, changelog, status map, merge preview, stash/worktree/submodule views, repo health and merge readiness. Every command starts with gk.",
    "deps": [],
    "events": [
      "session.start",
      "turn.complete",
      "tool.call",
      "ui.render"
    ],
    "commands": [
      "?"
    ],
    "calls": [
      "$.clock.now",
      "$.command.register",
      "$.fs.list",
      "$.fs.stat",
      "$.process.run",
      "$.prompt.fill",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "tool.call"
    ],
    "gatesBare": []
  },
  {
    "name": "layout",
    "version": "0.1.0",
    "description": "How things are drawn: zen mode, split view, floating note, sticky headers, collapsible sections, width and density controls, error and long-output banners, icon packs and a colour legend",
    "deps": [],
    "events": [
      "session.start",
      "tool.call",
      "ui.render",
      "ui.status"
    ],
    "commands": [
      "?"
    ],
    "calls": [
      "$.clock.now",
      "$.command.register",
      "$.state.get",
      "$.state.set",
      "$.store.delete",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve"
    ],
    "gatesCaught": [
      "tool.call{tool=/\"^(Read|Edit|Write|NotebookEdit)$\"/}",
      "ui.status"
    ],
    "gatesBare": []
  },
  {
    "name": "learning",
    "version": "0.1.0",
    "description": "Learning tools: glossaries, flashcards with spaced repetition, learning log, reading list, architecture map, skill tracker, explainer prompt-fillers and opt-in mentor, rubber-duck and beginner modes (/ln lists the commands)",
    "deps": [],
    "events": [
      "session.start",
      "turn.complete",
      "prompt.compose",
      "tool.call",
      "ui.render"
    ],
    "commands": [
      "ln",
      "lnpane",
      "?",
      "lneli5",
      "lnterm",
      "lnpterm",
      "lncard",
      "lnreview",
      "lnread",
      "lnlearned",
      "lnarch",
      "lnmentor",
      "lnduck",
      "lnbeginner",
      "lnnudge",
      "lnskills",
      "lnreset"
    ],
    "calls": [
      "$.clock.now",
      "$.command.register",
      "$.prompt.fill",
      "$.session.cwd",
      "$.state.get",
      "$.state.set",
      "$.store.delete",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "tool.call"
    ],
    "gatesBare": []
  },
  {
    "name": "look-and-sound",
    "version": "0.1.0",
    "description": "Sound cues when a turn finishes or fails (the Dusk ink theme is off)",
    "deps": [],
    "events": [
      "session.start",
      "prompt.submit",
      "turn.complete"
    ],
    "commands": [],
    "calls": [
      "$.audio.play",
      "$.clock.now",
      "$.theme.clear"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "prompt.submit"
    ]
  },
  {
    "name": "looks",
    "version": "0.1.0",
    "description": "A /look picker: no theme by default, then opt-in palettes (paper, nord, solarized, sepia, high contrast, seasons, time of day, per project, per model) and subtle moving backdrops",
    "deps": [
      "motion"
    ],
    "events": [
      "session.start",
      "turn.step",
      "ui.render"
    ],
    "commands": [
      "look"
    ],
    "calls": [
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.state.get",
      "$.store.delete",
      "$.store.get",
      "$.store.set",
      "$.theme.clear",
      "$.theme.set",
      "$.ui.resolve"
    ],
    "gatesCaught": [],
    "gatesBare": []
  },
  {
    "name": "motion",
    "version": "0.1.0",
    "description": "Calm motion for the interface: eased gauges, number tickers, status typing and pulse, tool-row shimmer and check pops, spring timer ring, idle breathing, test celebration, and a /motion on|off switch",
    "deps": [],
    "events": [
      "session.start",
      "prompt.submit",
      "tool.call",
      "turn.complete",
      "ui.render"
    ],
    "commands": [
      "motion"
    ],
    "calls": [
      "$.clock.after",
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.session.usage",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.resolve",
      "$.ui.status",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "prompt.submit",
      "tool.call"
    ],
    "gatesBare": []
  },
  {
    "name": "notes",
    "version": "0.1.0",
    "description": "Searchable notes archive: per-folder notes with tags, links, snippets, command cookbook, daily journal, reminders, recurring tasks, backup and restore (commands start with nt)",
    "deps": [],
    "events": [
      "session.start",
      "prompt.change",
      "prompt.submit",
      "tool.call",
      "turn.complete",
      "session.end",
      "ui.render"
    ],
    "commands": [
      "?"
    ],
    "calls": [
      "$.clock.after",
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.fs.read",
      "$.fs.stat",
      "$.prompt.fill",
      "$.prompt.read",
      "$.state.get",
      "$.state.set",
      "$.store.delete",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "prompt.submit",
      "tool.call"
    ]
  },
  {
    "name": "personality",
    "version": "0.1.0",
    "description": "Quiet, switchable fun: mood status, streaks, badges, a tiny pet, greeting, tip of the day, focus sprints and a weekly report (/fun on|off)",
    "deps": [
      "motion"
    ],
    "events": [
      "session.start",
      "session.end",
      "prompt.submit",
      "tool.call",
      "turn.complete",
      "ui.close",
      "ui.render"
    ],
    "commands": [
      "fun",
      "streak",
      "badges",
      "tip",
      "pet",
      "sprint",
      "sprintlog",
      "weekly"
    ],
    "calls": [
      "$.clock.after",
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.close",
      "$.ui.open",
      "$.ui.panes",
      "$.ui.resolve",
      "$.ui.status",
      "$.ui.toast"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "prompt.submit",
      "tool.call",
      "ui.close{id=personality-pet}"
    ]
  },
  {
    "name": "prompt-tools",
    "version": "0.1.0",
    "description": "Right-click prompt shortcuts, /review, and standing prompt preferences",
    "deps": [],
    "events": [
      "session.start",
      "prompt.compose",
      "ui.render"
    ],
    "commands": [
      "snip",
      "audit"
    ],
    "calls": [
      "$.command.register",
      "$.prompt.fill",
      "$.store.get",
      "$.store.set",
      "$.ui.resolve"
    ],
    "gatesCaught": [],
    "gatesBare": []
  },
  {
    "name": "prompting",
    "version": "0.1.0",
    "description": "Prompt craft: templates, context blocks, macros, queue, A/B, scorecard, diff, reword, clean-up, tone and other standing instructions (all off by default). Commands start with pm; /pm lists them.",
    "deps": [],
    "events": [
      "session.start",
      "prompt.compose",
      "prompt.submit",
      "prompt.edit",
      "turn.complete",
      "ui.render"
    ],
    "commands": [
      "pm",
      "pmtpl",
      "pmdiff",
      "pmctx",
      "pmtone",
      "pmask",
      "pmexample",
      "pmscore",
      "pmreword",
      "pmquote",
      "pmmacro",
      "pmmark",
      "pmsum",
      "pmdecide",
      "pmassume",
      "pmpin",
      "pmrestore",
      "pmq",
      "pmab",
      "pmclean",
      "pmlang",
      "pmrec",
      "pmreset"
    ],
    "calls": [
      "$.clock.after",
      "$.clock.now",
      "$.command.register",
      "$.prompt.fill",
      "$.prompt.read",
      "$.session.messages",
      "$.state.get",
      "$.state.set",
      "$.store.delete",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "prompt.submit"
    ]
  },
  {
    "name": "review-kit",
    "version": "0.1.0",
    "description": "Review helper for code Claude changes: tickable checklist and 19 heuristic detectors (risky paths, test gaps, complexity, TODOs, dead code, naming, import cycles, API/dependency/config changes, error handling, logging, migrations, performance, accessibility, patch size) in one pane",
    "deps": [],
    "events": [
      "session.start",
      "prompt.submit",
      "tool.call",
      "ui.render"
    ],
    "commands": [
      "rk",
      "rkpane",
      "rkcheck",
      "rkbudget",
      "rkdismiss",
      "rkreset",
      "rkdetect",
      "rkset"
    ],
    "calls": [
      "$.clock.now",
      "$.command.register",
      "$.fs.read",
      "$.fs.stat",
      "$.session.cwd",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "prompt.submit",
      "tool.call{tool=/\"^(Edit|Write)$\"/}"
    ],
    "gatesBare": []
  },
  {
    "name": "safety-pro",
    "version": "0.1.0",
    "description": "Safety and power workflow: dry-run, allowlist, hard budget, loop breaker, protected paths, opt-in checkpoints with confirmed rollback, pre-commit check, auto-compact, handoff note and a block log",
    "deps": [],
    "events": [
      "session.start",
      "prompt.submit",
      "tool.call",
      "turn.complete",
      "ui.render"
    ],
    "commands": [
      "dryrun",
      "loopguard",
      "safecompact",
      "hardbudget",
      "allow",
      "protect",
      "precommit",
      "snapshot",
      "rollback",
      "safetylog",
      "handoff"
    ],
    "calls": [
      "$.clock.now",
      "$.clock.sleep",
      "$.command.register",
      "$.fs.read",
      "$.fs.stat",
      "$.process.run",
      "$.prompt.fill",
      "$.session.compact",
      "$.session.cwd",
      "$.session.usage",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "prompt.submit",
      "tool.call"
    ],
    "gatesBare": []
  },
  {
    "name": "sound-pack",
    "version": "0.1.0",
    "description": "Sound packs (retro, wood, glass) with finish chime, error tones, approval cue, optional ticks, spoken summaries, quiet hours and volume by turn length",
    "deps": [],
    "events": [
      "session.start",
      "turn.start",
      "turn.complete",
      "classic.PermissionRequest",
      "tool.call",
      "classic.PostToolUse"
    ],
    "commands": [
      "sound"
    ],
    "calls": [
      "$.audio.play",
      "$.audio.speak",
      "$.clock.now",
      "$.command.register",
      "$.store.get",
      "$.store.set"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "classic.PermissionRequest",
      "classic.PostToolUse",
      "tool.call{tool=AskUserQuestion}"
    ]
  },
  {
    "name": "tool-guard",
    "version": "0.1.0",
    "description": "Blocks risky tool calls, badges commands by risk, and shows a pass/fail card under test runs",
    "deps": [],
    "events": [
      "session.start",
      "tool.call",
      "ui.render"
    ],
    "commands": [
      "readonly"
    ],
    "calls": [
      "$.command.register",
      "$.state.get",
      "$.state.set",
      "$.ui.resolve",
      "$.ui.status",
      "$.ui.toast"
    ],
    "gatesCaught": [
      "tool.call{tool=/\"^(Edit|Write|NotebookEdit)$\"/}",
      "tool.call{tool=Bash}"
    ],
    "gatesBare": []
  },
  {
    "name": "tool-visuals",
    "version": "0.1.0",
    "description": "Richer tool-call rows: risk edge, file glyphs, mini diffs, duration and size chips, network badges and progress, secret masking, retry counts, failing-test and build-error cards",
    "deps": [
      "motion"
    ],
    "events": [
      "session.start",
      "tool.call",
      "ui.render"
    ],
    "commands": [
      "toolvis"
    ],
    "calls": [
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.resolve"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "tool.call"
    ]
  },
  {
    "name": "workbench",
    "version": "0.1.0",
    "description": "Live session dashboard, changed-files, notes and timer panes, context band with quick replies, and /standup",
    "deps": [],
    "events": [
      "session.start",
      "prompt.submit",
      "tool.call",
      "turn.complete",
      "ui.render"
    ],
    "commands": [
      "dashboard",
      "files",
      "notes",
      "note",
      "timer",
      "budget",
      "focus",
      "sessionrecap"
    ],
    "calls": [
      "$.clock.after",
      "$.clock.every",
      "$.clock.now",
      "$.command.register",
      "$.prompt.fill",
      "$.session.usage",
      "$.state.get",
      "$.state.set",
      "$.store.get",
      "$.store.set",
      "$.ui.open",
      "$.ui.resolve",
      "$.ui.status",
      "$.ui.toast"
    ],
    "gatesCaught": [],
    "gatesBare": [
      "prompt.submit",
      "tool.call"
    ]
  }
]
