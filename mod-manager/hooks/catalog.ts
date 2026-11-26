// First generated from the mod folders next to this one. The script is gone, so entries are now kept by hand.
// A snapshot: a mod added or changed later shows up after the script is run again.
// It holds names, versions, descriptions and command names only: no paths.
export type Category =
  | 'look'
  | 'charts'
  | 'animation'
  | 'assist'
  | 'progress'
  | 'safety'
  | 'notes'
  | 'prompts'
  | 'git'
  | 'learning'
  | 'alerts'
  | 'layout'
  | 'fun'
  | 'settings'
  | 'manager'

export type CatalogCmd = { name: string; desc: string }
export type CatalogFeature = { id: string; label: string; description: string; default: boolean; group: string }
export type CatalogMod = {
  name: string
  version: string
  description: string
  /** The bare-prefix command that lists the mod's commands, or null. */
  help: string | null
  helpDesc: string
  category: Category
  deps: string[]
  /** True when plugin.json declares `dependencies`. */
  hasDeps: boolean
  cmds: CatalogCmd[]
  /** The mod's own switches (its features.json); the four universal ones are not listed here. */
  features: CatalogFeature[]
}

export const CATALOG: readonly CatalogMod[] = [
  {
    "name": "add-kit",
    "version": "0.2.0",
    "description": "Project and code companion: repo scorecard, test/flaky/coverage/build/error trends, TODO board, command history, snippets, dependency and hygiene checks, ports and processes, log tail, distraction log, meeting and presentation modes. Read-only shell only. Eve…",
    "help": "ad",
    "helpDesc": "List every add-kit command",
    "category": "assist",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "ad",
        "desc": "List every add-kit command"
      },
      {
        "name": "adbuild",
        "desc": "Build and test command durations (275)"
      },
      {
        "name": "adcov",
        "desc": "Coverage trend (274)"
      },
      {
        "name": "addistract",
        "desc": "Mark a task switch; no text shows the counts by day (261)"
      },
      {
        "name": "aderr",
        "desc": "Error messages grouped by normalised text (276)"
      },
      {
        "name": "adflaky",
        "desc": "Tests that failed and later passed (273)"
      },
      {
        "name": "adhist",
        "desc": "Search the Bash commands recorded (secrets masked, newest 500) (265)"
      },
      {
        "name": "adlicense",
        "desc": "Licence summary from package.json and the LICENSE file (270)"
      },
      {
        "name": "adlog",
        "desc": "Tail the last 16 KB of a log file you name, filtered; refuses secret-like paths (277)"
      },
      {
        "name": "admeet",
        "desc": "Meeting mode: runs /cfg feature quiet and restores your switches exactly (262)"
      },
      {
        "name": "adoutdated",
        "desc": "Outdated dependencies: runs only when you type it; npm contacts the registry (268)"
      },
      {
        "name": "adpane",
        "desc": "Open the add-kit pane (tabs: project repo tests builds errors todo history snippets health system l…"
      },
      {
        "name": "adports",
        "desc": "Listening TCP ports (279)"
      },
      {
        "name": "adpresent",
        "desc": "Pane view with figures only; fills /present for real masking (263)"
      },
      {
        "name": "adprocs",
        "desc": "Top 15 processes by CPU (280)"
      },
      {
        "name": "adproj",
        "desc": "Dashboard for this project folder: counters, languages, disk (266)"
      },
      {
        "name": "adrec",
        "desc": "Show or set the recording switches (history tests builds errors todos activity)"
      },
      {
        "name": "adrepo",
        "desc": "Repository health scorecard from read-only git (267)"
      },
      {
        "name": "adreset",
        "desc": "Clear everything add-kit recorded"
      },
      {
        "name": "adsec",
        "desc": "Security hygiene: secret-like file names, tracked .env, .gitignore (269)"
      },
      {
        "name": "adsnip",
        "desc": "Code snippet manager; use fills the prompt with a fenced block (264)"
      },
      {
        "name": "adtests",
        "desc": "Test results dashboard: counts per run, trend, chart (272)"
      },
      {
        "name": "adtodo",
        "desc": "TODO, FIXME and HACK notes in the files edited this session (271)"
      },
      {
        "name": "builds",
        "desc": "Build timings"
      },
      {
        "name": "errors",
        "desc": "Error clustering"
      },
      {
        "name": "history",
        "desc": "Command history"
      },
      {
        "name": "tests",
        "desc": "Test, flaky and coverage tracking"
      }
    ],
    "features": [
      {
        "id": "history",
        "label": "Command history",
        "description": "Record the Bash commands Claude runs (secrets masked, newest 500) so /adhist can search them",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "tests",
        "label": "Test, flaky and coverage tracking",
        "description": "Read test summaries (jest, vitest, pytest, go, cargo) and coverage from Bash output: runs, trend, flaky names",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "builds",
        "label": "Build timings",
        "description": "Time Bash commands that look like builds or tests, grouped by command",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "errors",
        "label": "Error clustering",
        "description": "Group failing tool results by normalised message",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "todos",
        "label": "Edited-file list for the TODO board",
        "description": "Remember which files Claude edited this session so /adtodo can scan them",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "activity",
        "label": "Project activity counters",
        "description": "Count tool calls and file types per project folder for the project dashboard",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "svg",
        "label": "Vector chart on the Tests tab",
        "description": "Draw the test and coverage chart as an image on the desktop app (text chart elsewhere)",
        "default": true,
        "group": "Display"
      }
    ]
  },
  {
    "name": "add-two",
    "version": "0.2.0",
    "description": "Git graph, release notes and changelog, PR checklist, docs search, disk usage, onboarding and cheatsheets, plus learning tools (paths, flashcards, quiz, glossary), design logs, handoff pack, mod ratings, theme gallery and a sharing guide. Read-only shell, no…",
    "help": "ae",
    "helpDesc": "List every add-two command",
    "category": "assist",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "ae",
        "desc": "List every add-two command"
      },
      {
        "name": "aearch",
        "desc": "292 Architecture sketch: component tree, box diagram on desktop"
      },
      {
        "name": "aecard",
        "desc": "/aecard [add|review|show|good|again|list|del]"
      },
      {
        "name": "aechange",
        "desc": "285 Changelog in Keep a Changelog layout since the last tag (shown only)"
      },
      {
        "name": "aecheat",
        "desc": "297 Cheatsheet of npm scripts, make targets and pyproject scripts"
      },
      {
        "name": "aedecide",
        "desc": "293 Decision log with date and status"
      },
      {
        "name": "aedisk",
        "desc": "281 Disk usage of the top-level entries of this folder (du -sk, 20 s limit)"
      },
      {
        "name": "aedocs",
        "desc": "287 Search README and docs/*.md file names and first headings"
      },
      {
        "name": "aegraph",
        "desc": "282 Git graph of the last 40 to 60 commits (SVG on desktop, text elsewhere)"
      },
      {
        "name": "aeissues",
        "desc": "286 Issue links (#123, owner/repo#123) from your recorded prompts or pasted text"
      },
      {
        "name": "aenotes",
        "desc": "284 Release notes draft since the last tag, grouped by commit prefix (shown only)"
      },
      {
        "name": "aeonboard",
        "desc": "296 Onboarding outline from the top-level listing, README and script names"
      },
      {
        "name": "aepack",
        "desc": "295 Handoff pack: goals, decisions, open todos, changed files (shown only)"
      },
      {
        "name": "aepane",
        "desc": "Open the add-two pane (tabs grouped Git, Project, Learn, Design, Mods)"
      },
      {
        "name": "aepath",
        "desc": "288 Learning path tracker with steps and ticks"
      },
      {
        "name": "aepr",
        "desc": "283 Pull-request checklist for this repo"
      },
      {
        "name": "aequiz",
        "desc": "290 Fill a prompt asking for a 3-question quiz; keep answers you note"
      },
      {
        "name": "aerate",
        "desc": "298 Rate the mods in the list (local only, no network)"
      },
      {
        "name": "aereset",
        "desc": "Clear everything add-two recorded or stored"
      },
      {
        "name": "aeretro",
        "desc": "/aeretro [well|improve|action|tick|del|list]"
      },
      {
        "name": "aeshare",
        "desc": "300 Guide to sharing a mod through GitHub (publishing is manual)"
      },
      {
        "name": "aetheme",
        "desc": "299 Theme gallery of 8 palettes; fills /look or /skuse, applies nothing itself"
      },
      {
        "name": "aeword",
        "desc": "291 Glossary with word-frequency suggestions (heuristic)"
      }
    ],
    "features": [
      {
        "id": "git-reads",
        "label": "Read git history",
        "description": "Allow the read-only git commands (graph, release notes, changelog, status) behind the /ae commands",
        "default": true,
        "group": "Reads"
      },
      {
        "id": "disk-scan",
        "label": "Disk usage scan",
        "description": "Allow /aedisk to run du -sk on the top-level folders of the working directory (20 s limit)",
        "default": true,
        "group": "Reads"
      },
      {
        "id": "file-reads",
        "label": "Read project files",
        "description": "Allow docs search, onboarding guide and cheatsheet to read README, docs and manifest files (32 KB at most each)",
        "default": true,
        "group": "Reads"
      },
      {
        "id": "svg",
        "label": "Vector drawings",
        "description": "Draw the git graph and architecture sketch as SVG on the desktop app (text elsewhere)",
        "default": true,
        "group": "Look"
      },
      {
        "id": "record-prompts",
        "label": "Record my prompts",
        "description": "Keep your last 60 prompts (clipped, tokens masked) for issue links, the quiz and glossary suggestions; session only",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "record-edits",
        "label": "Record edited files",
        "description": "Keep the paths of files Claude edits or writes this session, for the handoff pack",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "record-todos",
        "label": "Record the todo list",
        "description": "Keep the latest todo list Claude wrote this session, for the handoff pack",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "due-toast",
        "label": "Flashcards due toast",
        "description": "At session start, one toast when flashcards are due",
        "default": false,
        "group": "Reminders"
      }
    ]
  },
  {
    "name": "alerts",
    "version": "0.1.0",
    "description": "One quiet notifier for this mod's notices: priority levels, digest, snooze, quiet hours, per-category mute, history, waiting-on-you band, deadline, cost, rate-limit, context, idle, disk and network alerts (all /al commands)",
    "help": "al",
    "helpDesc": "Help: every alerts command in one line each, and the current quiet settings",
    "category": "alerts",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "al",
        "desc": "Help: every alerts command in one line each, and the current quiet settings"
      },
      {
        "name": "alcheckin",
        "desc": "Take-a-breath prompt after 90 minutes of activity: /alcheckin on | off (default off)"
      },
      {
        "name": "aldeadline",
        "desc": "Countdown: /aldeadline 17:30 <label> | off (band in the last 60 min, toasts at 30/10/0)"
      },
      {
        "name": "aldigest",
        "desc": "Pending low-priority notices: /aldigest | now (send the summary) | clear"
      },
      {
        "name": "alhistory",
        "desc": "Every toast this mod showed lately: /alhistory [count]"
      },
      {
        "name": "almute",
        "desc": "Mute one of this mod's notice categories: /almute <name> (toggles) | clear. Cannot silence other mo…"
      },
      {
        "name": "alquiet",
        "desc": "Quiet hours in local time: /alquiet 22:00-07:00 | off"
      },
      {
        "name": "alreset",
        "desc": "Clear everything this mod recorded; /alreset all also restores the settings"
      },
      {
        "name": "alsnooze",
        "desc": "Pause this mod's non-urgent notices: /alsnooze 30 (minutes) | off"
      },
      {
        "name": "alsound",
        "desc": "Notice sounds: /alsound on | off | test (default off)"
      },
      {
        "name": "altest",
        "desc": "Send a test notice through the notifier: /altest info | notice | urgent"
      }
    ],
    "features": []
  },
  {
    "name": "anim-extra",
    "version": "0.1.0",
    "description": "Settings hub pane (every mod's help command, presets, enable/disable list, aliases, band order), extra animations (skeleton, ripple, urgent edge glow, day-night strip, reduced-motion previews), and customizing: language, thresholds, file glyphs, alert rule bu…",
    "help": "ax",
    "helpDesc": "Anim extra help: every /ax command in one line each",
    "category": "settings",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "ax",
        "desc": "Anim extra help: every /ax command in one line each"
      },
      {
        "name": "axalias",
        "desc": "Command aliases: /axalias add <name> <command...> | rm <name> | list"
      },
      {
        "name": "axband",
        "desc": "Hide or reorder other mods' band rows: /axband hide|show <plugin> | order a,b,c | reset | status"
      },
      {
        "name": "axdemo",
        "desc": "Play the skeleton, ripple and day-night demos once (needs motion on and not calm)"
      },
      {
        "name": "axglow",
        "desc": "Urgent edge glow on this mod's pane and one band line: /axglow on | off | test | clear (default off)"
      },
      {
        "name": "axglyph",
        "desc": "File-type glyphs for this mod's pane: /axglyph <ext> <glyph> | rm <ext> | list"
      },
      {
        "name": "axlang",
        "desc": "Language of this mod's pane labels: /axlang en|es|de"
      },
      {
        "name": "axpanel",
        "desc": "Open the hub pane: /axpanel [hub|presets|mods|alias|band|lab|motion|rules|tune|market|about]"
      },
      {
        "name": "axpreset",
        "desc": "Print a preset bundle's command lines: /axpreset [calm|focus|full|demo]"
      },
      {
        "name": "axrate",
        "desc": "Rate a mod and add a note: /axrate <mod> <1-5> [note] | list"
      },
      {
        "name": "axrecipe",
        "desc": "Prebuilt automation recipes: /axrecipe list | <id> on|off"
      },
      {
        "name": "axreset",
        "desc": "Clear everything this mod stored and recorded"
      },
      {
        "name": "axrule",
        "desc": "Alert rules at turn end: /axrule [urgent] if cost > 5 then toast \"...\" | list | rm <n> | clear | ch…"
      },
      {
        "name": "axrun",
        "desc": "Fill the prompt with an alias's command: /axrun <alias>"
      },
      {
        "name": "axthresh",
        "desc": "Your own numeric thresholds: /axthresh [slow|output|edit] [number] | reset"
      }
    ],
    "features": []
  },
  {
    "name": "anim-more",
    "version": "0.1.0",
    "description": "Twenty more calm, state-driven terminal animations (pop-in hint, breathing glow, underline draw, button squish, staged toast, wave, spinners, typewriter, marquee, pulsing badge, spend drip, growing plant, rain, fireworks, balloons, page flip, dial, pendulum,…",
    "help": "ay",
    "helpDesc": "More animations: list every piece and command",
    "category": "animation",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "ay",
        "desc": "More animations: list every piece and command"
      },
      {
        "name": "aydemo",
        "desc": "Play every animation once in the lab (about 7 s)"
      },
      {
        "name": "aygrow",
        "desc": "Show the plant that grows with the days you work"
      },
      {
        "name": "ayjot",
        "desc": "Add to today's mini journal, or list it: /ayjot [text]"
      },
      {
        "name": "aylab",
        "desc": "Open the animation lab pane: /aylab [ui|text|fun]"
      },
      {
        "name": "aymarquee",
        "desc": "Scroll a long string in the lab: /aymarquee [text]"
      },
      {
        "name": "ayrain",
        "desc": "Rain after a build, fireworks after a git tag: /ayrain on|off (default off)"
      },
      {
        "name": "ayreset",
        "desc": "Clear everything anim-more recorded"
      },
      {
        "name": "ayrocket",
        "desc": "Rocket progress: /ayrocket <percent> | todo"
      },
      {
        "name": "ayspin",
        "desc": "Spinner variant: /ayspin [dots|orbit|round|quad|arc|pulse|next]"
      },
      {
        "name": "aysprint",
        "desc": "Own sprint timer: /aysprint <minutes> | off"
      },
      {
        "name": "aytoast",
        "desc": "Staged status-line toast, once per 3 minutes: /aytoast <text>"
      },
      {
        "name": "aytodo",
        "desc": "Todos for the rocket: /aytodo [add <text> | done <n> | undo <n> | rm <n> | clear]"
      },
      {
        "name": "aytype",
        "desc": "Reveal a text with a typewriter in the lab: /aytype <text>"
      },
      {
        "name": "aywave",
        "desc": "Band wave while a turn runs: /aywave on|off (default off)"
      }
    ],
    "features": []
  },
  {
    "name": "animations",
    "version": "0.1.0",
    "description": "Fourteen state-driven terminal animations (heartbeat, context tank, coin drop, sparkline draw-in, sliding tab underline, error shake, commit confetti, flip clock, badge flash, sky strip, skeleton shimmer, conveyor queue, ink-spread edits, ambient waves) on on…",
    "help": "anim",
    "helpDesc": "Animations: /anim | demo | lab | timer <minutes> | badge <text> | skeleton",
    "category": "animation",
    "deps": [
      "motion"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "anim",
        "desc": "Animations: /anim | demo | lab | timer <minutes> | badge <text> | skeleton"
      }
    ],
    "features": []
  },
  {
    "name": "assist",
    "version": "0.1.0",
    "description": "Quiet helpers that fill the prompt box and never send: next-step chips, stuck detector, explain-error chip, retry, context compressor, smart paste label, file finder, command recall, recap, pre/post-flight checklists, bug-report and handoff drafts, reading ti…",
    "help": "as",
    "helpDesc": "List these commands; \"pane\" opens the Assist pane",
    "category": "assist",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "as",
        "desc": "List these commands; \"pane\" opens the Assist pane"
      },
      {
        "name": "ascoach",
        "desc": "Shortcut coach: at most one toast a day naming a command you have not used (default on, not calm)"
      },
      {
        "name": "ascompress",
        "desc": "List the biggest recorded outputs to drop or avoid re-reading; fill puts an avoid prompt in the box"
      },
      {
        "name": "asfind",
        "desc": "Fuzzy-find files touched this session; the pane click fills @path"
      },
      {
        "name": "asfix",
        "desc": "Note how you fixed the latest error; it is attached to that error signature"
      },
      {
        "name": "asfixes",
        "desc": "Search the saved fixes"
      },
      {
        "name": "ashandoff",
        "desc": "Bundle prompts, decisions, files changed and open errors into one text block in the pane"
      },
      {
        "name": "ashelp",
        "desc": "Draft a bug report from recorded errors and commands in the pane (never sent)"
      },
      {
        "name": "asnext",
        "desc": "Next-step suggester: up to three chips (fix the test, run the tests, commit); one dim suggestion li…"
      },
      {
        "name": "aspaste",
        "desc": "Smart paste label: a one-line note when a stack trace, log lines, JSON or a diff is pasted (default…"
      },
      {
        "name": "aspost",
        "desc": "Fill a post-flight checklist: tests, lint, diff, commit, notes"
      },
      {
        "name": "aspre",
        "desc": "Fill a pre-flight checklist of confirmations before a big refactor"
      },
      {
        "name": "asq",
        "desc": "Question bank: follow-up prompts by situation (error, edited, stuck, unclear, learn, wrap)"
      },
      {
        "name": "asread",
        "desc": "Dim \"~N min read\" under assistant text over 400 words (default off)"
      },
      {
        "name": "asrec",
        "desc": "Recording of calls, prompts, errors and file names for the features above (default on, local only)"
      },
      {
        "name": "asrecall",
        "desc": "Search shell commands from this and earlier days (secrets masked, last 300); off stops recording"
      },
      {
        "name": "asrecap",
        "desc": "Fill \"Summarize where we left off\" with your last prompts listed"
      },
      {
        "name": "asreset",
        "desc": "Clear everything recorded; \"all\" also clears your fixes, decisions and settings"
      },
      {
        "name": "asretry",
        "desc": "Fill \"Retry the last failed command with <change>\""
      },
      {
        "name": "asskim",
        "desc": "Fill a key-points request; also lists the first sentence of each paragraph of the last answer"
      },
      {
        "name": "asunstick",
        "desc": "After 3+ different failures in a row: fill a reset prompt (one toast per episode)"
      },
      {
        "name": "read",
        "desc": "under long assistant text"
      }
    ],
    "features": []
  },
  {
    "name": "assist-more",
    "version": "0.1.0",
    "description": "More helpers: environment doctor, project card, run-books, time estimates, split and decide helpers, risk and typo nudges, undo guide, plain-language mode, contrast checker, profiles, quiet hours, own sounds, sprite and goals. Every command starts with am (/a…",
    "help": "am",
    "helpDesc": "This list",
    "category": "assist",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "am",
        "desc": "This list"
      },
      {
        "name": "amcontrast",
        "desc": "WCAG contrast ratio with AA and AAA verdicts"
      },
      {
        "name": "amdecide",
        "desc": "Start a decision and show its weighted table"
      },
      {
        "name": "amdefaults",
        "desc": "Remember your usual answer to repeated questions and show it as a hint (default off)"
      },
      {
        "name": "amdoctor",
        "desc": "Environment doctor: reads the version of git, node, python and friends; flags missing or old ones (…"
      },
      {
        "name": "amgoal",
        "desc": "Your own goals with a counter; finishing one earns a badge"
      },
      {
        "name": "amlearn",
        "desc": "Learning moments: one toast when the same fix happens twice (default off)"
      },
      {
        "name": "amopt",
        "desc": "Add an option with weighted pros (+) and cons (-); weight 1-5 in brackets"
      },
      {
        "name": "ampane",
        "desc": "Open the pane (buttons for scans, run-books, quiet hours, goals, sprite, profiles)"
      },
      {
        "name": "amplain",
        "desc": "Plain-language mode: ask the model to avoid jargon (default off)"
      },
      {
        "name": "amprofile",
        "desc": "Named bundles of this mod's settings: work, personal, demo, your own; bind one to a folder"
      },
      {
        "name": "amproject",
        "desc": "Project card from top-level file names and the first 4 KB of package manifests"
      },
      {
        "name": "amquiet",
        "desc": "Quiet hours for this mod's toasts (the pane has a 24 hour strip)"
      },
      {
        "name": "amreset",
        "desc": "Clear recorded data (run-books, tasks, decision, goals, answers, fixes); \"all\" also resets settings"
      },
      {
        "name": "amrisk",
        "desc": "Toast when an edit touches Dockerfile, CI yml, Makefile or package.json scripts (default on)"
      },
      {
        "name": "amrun",
        "desc": "/amrun start <name> | stop | show <name> | list | fill <name> | del <name>"
      },
      {
        "name": "amsound",
        "desc": "Play a sound from this mod's own sounds/ folder (copy your wav files there)"
      },
      {
        "name": "amsplit",
        "desc": "Fill the prompt with a request to split a big task into small steps"
      },
      {
        "name": "amsprite",
        "desc": "Your own sprite glyphs and name, shown in this mod's pane only"
      },
      {
        "name": "amsummary",
        "desc": "One-line banner above destructive-looking rm, mv, git clean (default on; never blocks)"
      },
      {
        "name": "amtask",
        "desc": "Time a task and get a text-only estimate from similar past tasks"
      },
      {
        "name": "amtypo",
        "desc": "Toast when a Bash path looks like a typo of a nearby existing one; never blocks (default on)"
      },
      {
        "name": "amundo",
        "desc": "Explain how to roll back the last change with git; checks status read-only, never runs the commands"
      }
    ],
    "features": []
  },
  {
    "name": "band-tidy",
    "version": "0.1.0",
    "description": "Tidies the area above the prompt: keeps a short list of rows, hides the rest, and lets you choose with /tidy",
    "help": "tidy",
    "helpDesc": "Choose which mods may draw a row above the prompt",
    "category": "layout",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "tidy",
        "desc": "Choose which mods may draw a row above the prompt"
      }
    ],
    "features": []
  },
  {
    "name": "charts",
    "version": "0.1.0",
    "description": "Twenty text charts (donut gauges, 24h clock, treemap, heatmap, Gantt, flame, mini-map, radar, scatter, burndown and more) in one tabbed pane, drawn with block, braille and box characters from this session's recorded tool calls",
    "help": "ch",
    "helpDesc": "Charts: list every command of the charts mod",
    "category": "charts",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "ch",
        "desc": "Charts: list every command of the charts mod"
      },
      {
        "name": "chbudget",
        "desc": "Spend target for the bullet chart: /chbudget <usd>|off"
      },
      {
        "name": "chdemo",
        "desc": "Fill every chart with sample data: /chdemo [on|off]"
      },
      {
        "name": "chdonut",
        "desc": "Open the donut gauges (context, spend, rate limit)"
      },
      {
        "name": "chreset",
        "desc": "Clear what the charts mod recorded: /chreset [session]"
      },
      {
        "name": "chshow",
        "desc": "Open the charts pane: /chshow [chart|group]"
      },
      {
        "name": "chsprint",
        "desc": "Log a finished sprint: /chsprint <min> <label>"
      },
      {
        "name": "chtodo",
        "desc": "Chart todo list: /chtodo add|doing|done|open|rm|list"
      }
    ],
    "features": []
  },
  {
    "name": "charts-more",
    "version": "0.1.0",
    "description": "More text charts (histogram, box plot, context ring, thermometer, fuel gauge, speedometer, battery, tag cloud, note network, folder tree, area, candlestick, pie bar, before/after slider) in one picker pane, with quiet state-driven animations",
    "help": "cm",
    "helpDesc": "More charts: list every chart command",
    "category": "charts",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "cm",
        "desc": "More charts: list every chart command"
      },
      {
        "name": "cmdemo",
        "desc": "More charts: show sample data (nothing recorded)"
      },
      {
        "name": "cmreset",
        "desc": "More charts: clear recorded data"
      }
    ],
    "features": []
  },
  {
    "name": "cockpit",
    "version": "0.8.0",
    "description": "One tabbed cockpit pane (overview, tool timeline, files, todo, history, errors, links, palette) plus a git/spend band, forecasts, shelves and pins",
    "help": "cockpit",
    "helpDesc": "Open the cockpit pane: /cockpit [overview|timeline|files|todo|history|errors|links|palette]",
    "category": "layout",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "cockpit",
        "desc": "Open the cockpit pane: /cockpit [overview|timeline|files|todo|history|errors|links|palette]"
      },
      {
        "name": "cfocus",
        "desc": "Hide or show only the cockpit bands"
      },
      {
        "name": "cpin",
        "desc": "Pin or unpin a note on top of the cockpit: /cpin <text>"
      },
      {
        "name": "csearch",
        "desc": "Search this session's prompts and tool calls: /csearch <text>"
      },
      {
        "name": "cshelf",
        "desc": "Snippet shelf: /cshelf add <text>, /cshelf <n>, /cshelf rm <n>"
      },
      {
        "name": "ctodo",
        "desc": "Add a todo: /ctodo <text> (tick them off in the cockpit Todo tab)"
      }
    ],
    "features": []
  },
  {
    "name": "control-kit",
    "version": "0.1.0",
    "description": "Control surface for the other mods: one master quiet switch with exact restore, panic and safe mode, pause or snooze a mod for a while, previews and two-step confirms for bulk changes, undo, a read-only lock, a command palette, a permission summary, an audit…",
    "help": "kc",
    "helpDesc": "Open the control pane and list every control-kit command",
    "category": "assist",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "kc",
        "desc": "Open the control pane and list every control-kit command"
      },
      {
        "name": "kcallow",
        "desc": "Per-project allow prefixes for the block list: /kcallow add|rm|list [prefix]"
      },
      {
        "name": "kcblock",
        "desc": "Bash block list: /kcblock on|off|add <piece>|rm <piece>|list"
      },
      {
        "name": "kcdisable",
        "desc": "Show the exact claude plugin disable line for a mod and put it in the prompt"
      },
      {
        "name": "kcdismiss",
        "desc": "Turn one mod pop-ups off for good, with a note: /kcdismiss <mod> [note] or <mod> undo"
      },
      {
        "name": "kcdo",
        "desc": "Two-step engine: /kcdo off|on|safe|quiet|calm|full then /kcdo confirm or cancel"
      },
      {
        "name": "kcfind",
        "desc": "Search every mod command by name or words: /kcfind <words>"
      },
      {
        "name": "kckeys",
        "desc": "List the pane hotkeys"
      },
      {
        "name": "kclimit",
        "desc": "Minutes between this mod pop-ups: /kclimit <3 to 120>"
      },
      {
        "name": "kclock",
        "desc": "Read-only mode for this mod: /kclock on|off (cannot lock other mods)"
      },
      {
        "name": "kclog",
        "desc": "Audit log of everything this mod did, with time and result: /kclog [page]"
      },
      {
        "name": "kcnet",
        "desc": "Which mods use the network (no network switch exists), with disable lines"
      },
      {
        "name": "kcnext",
        "desc": "Put the next queued /cfg or /tidy line in the prompt (after a refused run)"
      },
      {
        "name": "kcoff",
        "desc": "Master quiet switch: shows what would change, then /kcdo confirm"
      },
      {
        "name": "kcon",
        "desc": "Restore the switches and rows exactly as they were before quiet mode"
      },
      {
        "name": "kcorder",
        "desc": "Row order (needs the reorder switch): /kcorder show|set <mods>|up|down|top <mod>|clear"
      },
      {
        "name": "kcpanic",
        "desc": "Panic button: quiet everything now, fill the prompt with the disable lines"
      },
      {
        "name": "kcpause",
        "desc": "Pause one mod: /kcpause <mod> [minutes up to 240] or /kcpause <mod> off"
      },
      {
        "name": "kcperms",
        "desc": "Which of shell, files, network and store each mod touches: /kcperms [mod]"
      },
      {
        "name": "kcpreview",
        "desc": "Dry run: list the switches a preset would flip: /kcpreview <preset>"
      },
      {
        "name": "kcprio",
        "desc": "Notice priority levels, with a preview: /kcprio or /kcprio test <info|notice|urgent>"
      },
      {
        "name": "kcreset",
        "desc": "Clear what this mod recorded (two-step): /kcreset or /kcreset all"
      },
      {
        "name": "kcrows",
        "desc": "Rows above the prompt: /kcrows keep|hide <mod>, only <mod>, expand, show"
      },
      {
        "name": "kcsafe",
        "desc": "Safe mode preview: all non-guard switches off plus the disable list"
      },
      {
        "name": "kcsnooze",
        "desc": "Snooze only the pop-ups and sounds of one mod: /kcsnooze <mod> [minutes]"
      },
      {
        "name": "kctest",
        "desc": "Test a command against the block list without running it: /kctest <command>"
      },
      {
        "name": "kcundo",
        "desc": "Undo the last logged switch change, or /kcundo list the last 30"
      }
    ],
    "features": [
      {
        "id": "block",
        "label": "Bash block list",
        "description": "Your own list of command pieces that this mod's tool.call hook refuses to run in Bash. The list starts empty; nothing is blocked until you add a piece with /kcblock add",
        "default": false,
        "group": "Guards"
      },
      {
        "id": "reorder",
        "label": "Reorder rows above the prompt",
        "description": "Applies the order saved with /kcorder to the rows above the prompt. Rows are never dropped",
        "default": false,
        "group": "Rows"
      },
      {
        "id": "band-state",
        "label": "Show a row while quiet mode or a pause is on",
        "description": "One short row above the prompt, only while a restore point or a pause or snooze exists",
        "default": false,
        "group": "Rows"
      },
      {
        "id": "notify-restore",
        "label": "Pop-up when a pause or snooze ends",
        "description": "One pop-up, at most one per rate-limit window, when switches are put back",
        "default": false,
        "group": "Notices"
      }
    ]
  },
  {
    "name": "control-two",
    "version": "0.2.0",
    "description": "Quick controls and diagnostics: toggles for motion, calm, sounds and recording, row visibility rules, backups and restore of your feature switches, a two-step reset, read-only update checks, health lights, error log, hook timing and order, storage meter, comm…",
    "help": "kx",
    "helpDesc": "Control two: open the pane and list every command",
    "category": "assist",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "kx",
        "desc": "Control two: open the pane and list every command"
      },
      {
        "name": "kxbackup",
        "desc": "Snapshot this mod's settings and the current switch overrides (last 5 kept)"
      },
      {
        "name": "kxcalm",
        "desc": "Quick calm toggle: runs /cfg calm on|off"
      },
      {
        "name": "kxchanges",
        "desc": "Plain-language changelog of all mods"
      },
      {
        "name": "kxconflicts",
        "desc": "Duplicate command scan, live owners and refused registrations"
      },
      {
        "name": "kxdeps",
        "desc": "Which mod needs which: a graph on the desktop, a list elsewhere"
      },
      {
        "name": "kxdiag",
        "desc": "Diagnostics text: versions, mods, switch overrides, counts (no paths, no user name)"
      },
      {
        "name": "kxerrors",
        "desc": "Error log per mod from log lines and hook failures (needs the errors switch)"
      },
      {
        "name": "kxfeedback",
        "desc": "Keep a note about a mod: list, add or clear"
      },
      {
        "name": "kxhealth",
        "desc": "Health light per mod from what this session can observe"
      },
      {
        "name": "kxhooks",
        "desc": "Order of the hooks beneath this mod (needs the hookorder switch)"
      },
      {
        "name": "kxmotion",
        "desc": "Quick motion toggle: runs /motion on|off"
      },
      {
        "name": "kxpin",
        "desc": "A note list of versions you want to stay on (nothing enforces it)"
      },
      {
        "name": "kxquick",
        "desc": "Open the quick controls (motion, calm, sounds, recording) or another tab"
      },
      {
        "name": "kxrecording",
        "desc": "Quick recording flag kept by this mod (other mods do not read it)"
      },
      {
        "name": "kxreset",
        "desc": "Reset this mod's data and /cfg feature reset, in two steps (second step: confirm)"
      },
      {
        "name": "kxresetmod",
        "desc": "Show and fill the reset command of one mod (never runs it)"
      },
      {
        "name": "kxrestore",
        "desc": "Preview, then re-apply, the switch overrides of a snapshot"
      },
      {
        "name": "kxrollback",
        "desc": "Why a local mod cannot be rolled back here, and how git could do it"
      },
      {
        "name": "kxrules",
        "desc": "Row visibility rules, evaluated after each turn when the rules switch is on"
      },
      {
        "name": "kxsave",
        "desc": "Keep this mod's own settings for later sessions (saved) or for this session only"
      },
      {
        "name": "kxselftest",
        "desc": "List documented self-test commands and put one in the prompt box"
      },
      {
        "name": "kxsounds",
        "desc": "Quick sounds toggle: flips the sounds switch of every mod, one /cfg feature call each"
      },
      {
        "name": "kxstorage",
        "desc": "Size of the keys this mod keeps in its own store"
      },
      {
        "name": "kxtiming",
        "desc": "Time the hooks of pop-ups and status writes per mod (needs the timing switch)"
      },
      {
        "name": "kxupdates",
        "desc": "Read-only check: installed versions against the versions this mod was built with"
      }
    ],
    "features": [
      {
        "id": "bar",
        "label": "Quick-toggle bar",
        "description": "One row above the prompt with four buttons: motion, calm, sounds, recording",
        "default": false,
        "group": "Rows"
      },
      {
        "id": "rules",
        "label": "Row visibility rules",
        "description": "After each turn, show or hide a mod's row, pop-ups, sounds or status by context, cost or limit (your rules, max 10)",
        "default": false,
        "group": "Rules"
      },
      {
        "id": "autobackup",
        "label": "Auto backup",
        "description": "Take a snapshot of your switches and this mod's settings before a confirmed reset or restore (only when you type the confirm)",
        "default": true,
        "group": "Backups"
      },
      {
        "id": "badge",
        "label": "Update badge",
        "description": "Show how many mods are newer in the table on the Updates tab, after /kxupdates ran",
        "default": true,
        "group": "Updates"
      },
      {
        "id": "timing",
        "label": "Hook timing",
        "description": "Count and time the hooks of pop-ups and status writes per mod (coarse, this session only)",
        "default": false,
        "group": "Recorders"
      },
      {
        "id": "errors",
        "label": "Error log",
        "description": "Keep log lines that look like errors and hook failures seen beneath this mod, per mod (this session only)",
        "default": false,
        "group": "Recorders"
      },
      {
        "id": "hookorder",
        "label": "Hook order",
        "description": "Keep the order of the hooks beneath this mod's own for pop-ups and status writes",
        "default": false,
        "group": "Recorders"
      },
      {
        "id": "refusals",
        "label": "Refused commands",
        "description": "Keep command registrations the engine refused, as they pass through this mod's hook",
        "default": false,
        "group": "Recorders"
      }
    ]
  },
  {
    "name": "controls",
    "version": "0.1.0",
    "description": "Trust and transparency: what every mod can do, outbound-host and folder ledgers, rule tester, temporary allow, per-project profiles, incident mode and a guard self-test, around tool-guard and safety-pro",
    "help": "ct",
    "helpDesc": "List every controls command (trust and transparency)",
    "category": "safety",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "ct",
        "desc": "List every controls command (trust and transparency)"
      },
      {
        "name": "ctallow",
        "desc": "Let one of this mod's rules pass for N minutes"
      },
      {
        "name": "ctapprovals",
        "desc": "Permission dialogs that opened and what happened next"
      },
      {
        "name": "ctblock",
        "desc": "Edit this mod's own extra blocked substrings for Bash"
      },
      {
        "name": "ctincident",
        "desc": "Incident mode: hold every mutating Bash, Edit and Write"
      },
      {
        "name": "ctledger",
        "desc": "Outbound hosts and folders touched in this and earlier sessions"
      },
      {
        "name": "ctmods",
        "desc": "Privacy dashboard: what every installed mod can do (build-time snapshot)"
      },
      {
        "name": "ctpause",
        "desc": "Print the exact commands that disable mods, with copy buttons"
      },
      {
        "name": "ctperms",
        "desc": "Permission summary in plain words, per mod"
      },
      {
        "name": "ctprofile",
        "desc": "Per-project profile for this mod's rules"
      },
      {
        "name": "ctredact",
        "desc": "Redaction presets for this mod's panes; or preview masking of text"
      },
      {
        "name": "ctreset",
        "desc": "Clear everything this mod recorded (add \"all\" to clear its settings too)"
      },
      {
        "name": "ctselftest",
        "desc": "Check that tool-guard still refuses protected files (harmless inputs only)"
      },
      {
        "name": "ctshot",
        "desc": "Screenshot-safe summary pane (counts only)"
      },
      {
        "name": "cttest",
        "desc": "What tool-guard style rules would say about a command (never runs it)"
      }
    ],
    "features": []
  },
  {
    "name": "custom-two",
    "version": "0.2.0",
    "description": "Customizing, part two: colours per file type, a branch accent, event sounds, greetings and tips, empty states and pane titles, date ranges, saved filters and searches, report templates and exports, a hotkey map, a theme from a logo colour, icon sets, easing c…",
    "help": "cx",
    "helpDesc": "custom-two help: every command, one line each",
    "category": "assist",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "cx",
        "desc": "custom-two help: every command, one line each"
      },
      {
        "name": "cxbranch",
        "desc": "[list | <pattern> <colour> | rm | now]"
      },
      {
        "name": "cxbundle",
        "desc": "147 Mod bundles: prints plugin enable and disable lines"
      },
      {
        "name": "cxcheck",
        "desc": "[list | add <text> | tick <n> | starter]"
      },
      {
        "name": "cxcurve",
        "desc": "[list | <name> | add <name> x1 y1 x2 y2 | demo]"
      },
      {
        "name": "cxdnd",
        "desc": "145 Do-not-disturb schedule (default off)"
      },
      {
        "name": "cxempty",
        "desc": "131 Empty-state messages for this mod pane"
      },
      {
        "name": "cxexport",
        "desc": "137 Log as CSV, Markdown or JSON text"
      },
      {
        "name": "cxfile",
        "desc": "[list | <ext> <colour> | rm <ext> | reset]"
      },
      {
        "name": "cxfilter",
        "desc": "[list | save <name> k=v | use <name|off>]"
      },
      {
        "name": "cxfocus",
        "desc": "[list | <name> | add <name> <steps> | rm <name>]"
      },
      {
        "name": "cxfont",
        "desc": "140 Font stack preview (preview only)"
      },
      {
        "name": "cxgloss",
        "desc": "[list | add <term> = <meaning> | find <text>]"
      },
      {
        "name": "cxgreet",
        "desc": "[list | add <text> | rm <n> | name <name>]"
      },
      {
        "name": "cxicon",
        "desc": "[list | pack <name|auto> | <name> <glyph>]"
      },
      {
        "name": "cxkeys",
        "desc": "[list | add <key> <text> | use <key> | builtin]"
      },
      {
        "name": "cxlog",
        "desc": "The recorded tool-call log: status and last rows"
      },
      {
        "name": "cxlogo",
        "desc": "139 A theme from a logo colour"
      },
      {
        "name": "cxmacro",
        "desc": "[list | add <name> <cmd ; cmd> | run <name> | log]"
      },
      {
        "name": "cxpane",
        "desc": "Open the custom-two pane"
      },
      {
        "name": "cxrange",
        "desc": "[list | add <name> <start> <end> | use <name|off>]"
      },
      {
        "name": "cxreport",
        "desc": "136 Report template, rendered as text"
      },
      {
        "name": "cxreset",
        "desc": "Clear the log and run list, put hidden rows back, stop do-not-disturb"
      },
      {
        "name": "cxrules",
        "desc": "[list | add <mod> <cond> | rm <n> | check | clear]"
      },
      {
        "name": "cxsched",
        "desc": "143 Time-of-day look schedule (never automatic)"
      },
      {
        "name": "cxsearch",
        "desc": "[<text> | save <name> <text> | run <name>]"
      },
      {
        "name": "cxsound",
        "desc": "[list | <event> <file|off> | test <event>]"
      },
      {
        "name": "cxtip",
        "desc": "[list | add <text> | rm <n> | today]"
      },
      {
        "name": "cxtitle",
        "desc": "[list | <tab|main> <text> | rm <id>]"
      }
    ],
    "features": [
      {
        "id": "record",
        "label": "Record tool calls",
        "description": "Keep a bounded log (300) of tool name, result, file and branch, for the Log and Report tabs. Off: nothing is recorded",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "file-colours",
        "label": "File-type colours",
        "description": "Colour file names in the pane by extension",
        "default": true,
        "group": "Look"
      },
      {
        "id": "branch-accent",
        "label": "Branch accent",
        "description": "Read the git branch (read-only git rev-parse) and tint the pane header by branch",
        "default": false,
        "group": "Look"
      },
      {
        "id": "event-sounds",
        "label": "Event sounds",
        "description": "Play a sound from this mod's sounds folder on turn end, error and commit",
        "default": false,
        "group": "Sound"
      },
      {
        "id": "greet-toast",
        "label": "Greeting at session start",
        "description": "One greeting toast when a session starts",
        "default": false,
        "group": "Toasts"
      },
      {
        "id": "tip-toast",
        "label": "Daily tip",
        "description": "One tip toast per day, after a turn ends",
        "default": false,
        "group": "Toasts"
      },
      {
        "id": "demo-motion",
        "label": "Curve demo motion",
        "description": "The easing demo in the Curves tab animates (needs /motion on and calm off)",
        "default": false,
        "group": "Effects"
      },
      {
        "id": "dnd",
        "label": "Do-not-disturb schedule",
        "description": "Lets /cxdnd on run /cfg feature quiet and full at its times; nothing happens until /cxdnd on",
        "default": true,
        "group": "Automation"
      },
      {
        "id": "hide-rules",
        "label": "Row-hiding rules",
        "description": "Apply the /cxrules rules: turn a mod's row off while a condition holds, restore after",
        "default": false,
        "group": "Automation"
      }
    ]
  },
  {
    "name": "debug-kit",
    "version": "0.1.0",
    "description": "Debugging helpers: failing-test focus, bisect guide, stack-trace explainer, repro recorder, flaky/coverage/timing/snapshot test insights, log tail, error clusters, hypothesis board, breadcrumbs, env snapshot, port finder, mock map, crash-loop and regression g…",
    "help": "db",
    "helpDesc": "Debug kit help: every /db command in one line each",
    "category": "assist",
    "deps": [
      "motion"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "db",
        "desc": "Debug kit help: every /db command in one line each"
      },
      {
        "name": "dbassert",
        "desc": "Fill the prompt: suggest precise assertions for a test"
      },
      {
        "name": "dbbisect",
        "desc": "Git bisect step-by-step guide and a prompt (never runs bisect itself)"
      },
      {
        "name": "dbcov",
        "desc": "Coverage % per test run and the change between runs"
      },
      {
        "name": "dbenv",
        "desc": "Record node/python/git etc. versions (read-only --version commands)"
      },
      {
        "name": "dberr",
        "desc": "Tool errors grouped by normalised message"
      },
      {
        "name": "dbflaky",
        "desc": "Tests that failed then passed with no edit in between"
      },
      {
        "name": "dbfocus",
        "desc": "Fill the prompt: re-run only the failing tests from the last failed test run"
      },
      {
        "name": "dbguard",
        "desc": "Regression-test offer and crash-loop toast: /dbguard on | off"
      },
      {
        "name": "dbhyp",
        "desc": "Hypothesis board: /dbhyp <text> | ok <n> | no <n> | open <n> | rm <n>"
      },
      {
        "name": "dbmocks",
        "desc": "Mock map: mocks and patches in test files edited this session"
      },
      {
        "name": "dbport",
        "desc": "Who listens on a port: /dbport <1-65535> (read-only lsof)"
      },
      {
        "name": "dbpost",
        "desc": "Draft a postmortem from the trail, hypotheses and errors (shown only, no file written)"
      },
      {
        "name": "dbrec",
        "desc": "Repro recorder: /dbrec start | stop | show (records Bash commands)"
      },
      {
        "name": "dbreset",
        "desc": "Clear everything debug-kit has recorded"
      },
      {
        "name": "dbshrink",
        "desc": "Fill the prompt: shrink a failing case to a minimal repro"
      },
      {
        "name": "dbsnap",
        "desc": "Snapshot-test summary: written / updated / obsolete counts"
      },
      {
        "name": "dbtail",
        "desc": "Read-only tail of a file, refreshed every 3 s while the pane is open: /dbtail <path> | off"
      },
      {
        "name": "dbtime",
        "desc": "Slowest tests from the last run that printed durations"
      },
      {
        "name": "dbtrace",
        "desc": "Explain the last stack trace seen: top app frames and file:line list"
      },
      {
        "name": "dbtrail",
        "desc": "Debug breadcrumbs: ordered list of attempts and outcomes"
      }
    ],
    "features": []
  },
  {
    "name": "delight",
    "version": "0.1.0",
    "description": "Small delights, all off by default except the gallery and /dl help: theme and sound of the week, fortune cookies, mini-games, pet wardrobe preview, milestone postcards, rare compliments, mod gallery, tour, changelog and usage heat (/dl lists the commands)",
    "help": "dl",
    "helpDesc": "List every delight command, one line each",
    "category": "fun",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "dl",
        "desc": "List every delight command, one line each"
      },
      {
        "name": "dlaudit",
        "desc": "Weekly helped/annoyed check-in card on|off (off by default)"
      },
      {
        "name": "dlcard",
        "desc": "Milestone postcards at 100, 1000 and 10000 tool calls (needs /dltrack on)"
      },
      {
        "name": "dlchangelog",
        "desc": "Plain-language changelog for every mod: /dlchangelog [mod]"
      },
      {
        "name": "dlcookie",
        "desc": "One fortune-cookie line about code and rest (60 of them)"
      },
      {
        "name": "dlfeedback",
        "desc": "Save a note about a mod: /dlfeedback <mod> <text>"
      },
      {
        "name": "dlfeedbacks",
        "desc": "List your notes: /dlfeedbacks [mod] | del <n>"
      },
      {
        "name": "dlgallery",
        "desc": "Open the mod gallery pane: every mod, its commands, a button that fills its help command"
      },
      {
        "name": "dlgame",
        "desc": "Tiny turn-based games in the pane: /dlgame higher | memory | stop"
      },
      {
        "name": "dlheat",
        "desc": "Which mods you use: command runs per mod, as bars (needs /dltrack on)"
      },
      {
        "name": "dlhunt",
        "desc": "Easter-egg hunt: five hidden words, how many you have found"
      },
      {
        "name": "dlkind",
        "desc": "Rare, specific compliments on|off|status (off by default, needs counters)"
      },
      {
        "name": "dlmusic",
        "desc": "Ambient soundtrack ideas as text: /dlmusic [focus|calm|late|upbeat]"
      },
      {
        "name": "dlnew",
        "desc": "The what-is-new card for this version (shows once)"
      },
      {
        "name": "dlpane",
        "desc": "Open the delight pane at a tab: gallery today tour pet games cards retro type heat notes log"
      },
      {
        "name": "dlrecommend",
        "desc": "Mods whose commands did not run in the last 14 days"
      },
      {
        "name": "dlreset",
        "desc": "Clear everything delight recorded and switch every option back off"
      },
      {
        "name": "dlretro",
        "desc": "Retro terminal pane in box characters, green by theme key"
      },
      {
        "name": "dlsound",
        "desc": "Sound of the day: names the sound pack to run with /sound <pack>"
      },
      {
        "name": "dltour",
        "desc": "Seven-step tour of the main features (pane with Back and Next)"
      },
      {
        "name": "dltrack",
        "desc": "Own counters on|off|status: tool calls and command names (off by default)"
      },
      {
        "name": "dltype",
        "desc": "Typing-speed meter on|off (off by default, lengths only, never the text)"
      },
      {
        "name": "dlwear",
        "desc": "Preview pet accessories you have unlocked: /dlwear [id|none|list]"
      },
      {
        "name": "dlweek",
        "desc": "Look of the week: suggests one of the looks and fills /look <name> into the prompt"
      }
    ],
    "features": []
  },
  {
    "name": "extras",
    "version": "0.1.0",
    "description": "Screen-share masking, away digest, smart alerts, prompt linter, session health, per-tool cost, replay scrubber, command cheatsheet, auto-title and a read-only snapshot browser",
    "help": "cheats",
    "helpDesc": "Every slash command the mods add, as buttons that fill the prompt box",
    "category": "assist",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "cheats",
        "desc": "Every slash command the mods add, as buttons that fill the prompt box"
      },
      {
        "name": "alerts",
        "desc": "Desktop alert when a turn over 60 s ends: /alerts on | off | test"
      },
      {
        "name": "health",
        "desc": "Session health score (0-100) and its four factors, in a pane"
      },
      {
        "name": "lint",
        "desc": "Gentle hint when a draft prompt looks vague: /lint on | off"
      },
      {
        "name": "present",
        "desc": "Screen-share mode: /present on | off (masks home, user, emails, secrets and project paths on screen…"
      },
      {
        "name": "replay",
        "desc": "Step through this session's tool calls: /replay [first|prev|next|last]"
      },
      {
        "name": "snaps",
        "desc": "Browse safety-pro snapshots, read-only (restore stays with /rollback)"
      },
      {
        "name": "toolcost",
        "desc": "Which tools produced the most output and time, in a pane"
      }
    ],
    "features": []
  },
  {
    "name": "finish-kit",
    "version": "0.2.0",
    "description": "A style studio: live vector previews of finishes (grays, tones, surfaces, type, data palettes, icons) on sample cards, and commands that apply a finish with one theme call. Nothing is applied until you type a command",
    "help": "fn",
    "helpDesc": "Finish studio help: every /fn command in one line each",
    "category": "assist",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "fn",
        "desc": "Finish studio help: every /fn command in one line each"
      },
      {
        "name": "fnaccent",
        "desc": "Pick an accent from a pasted list of hex colours, a name, or month"
      },
      {
        "name": "fnapply",
        "desc": "Apply the draft finish with one theme call: /fnapply warm paper serif, /fnapply preset oled, /fnapp…"
      },
      {
        "name": "fncvd",
        "desc": "Colour-blind preview: /fncvd deuteranopia|protanopia|tritanopia|none"
      },
      {
        "name": "fnmonth",
        "desc": "Use the accent of the month in /fnapply: /fnmonth on|off (default off)"
      },
      {
        "name": "fnpreview",
        "desc": "Open the studio pane with live vector previews of every finish"
      },
      {
        "name": "fnremember",
        "desc": "Bring your applied finish back at session start: /fnremember on|off (default off)"
      },
      {
        "name": "fnreset",
        "desc": "Forget the saved finish and settings, reset the draft"
      },
      {
        "name": "fnset",
        "desc": "Change the draft finish only, to preview it: /fnset gray=warm tone=sepia"
      },
      {
        "name": "fnstroke",
        "desc": "Icon stroke width in the previews: /fnstroke 1|1.5|1.75|2|2.5|3"
      }
    ],
    "features": [
      {
        "id": "remember",
        "label": "Bring back my finish at start",
        "description": "Re-apply the finish you last applied, once, when a session starts (also needs /fnremember on)",
        "default": false,
        "group": "Startup"
      },
      {
        "id": "month",
        "label": "Accent of the month",
        "description": "Let /fnapply use the month's accent when you give none (also needs /fnmonth on; never changes by itself)",
        "default": true,
        "group": "Colour"
      },
      {
        "id": "title-icons",
        "label": "Icons in pane titles",
        "description": "Put a small icon in front of every pane title, in this and other mods' panes",
        "default": false,
        "group": "Panes"
      },
      {
        "id": "svg-previews",
        "label": "Vector previews",
        "description": "Draw the live SVG previews in the studio pane on the desktop app",
        "default": true,
        "group": "Studio"
      },
      {
        "id": "cvd-preview",
        "label": "Colour-blind preview",
        "description": "Allow the colour-blind simulation to recolour the previews",
        "default": true,
        "group": "Studio"
      }
    ]
  },
  {
    "name": "git-kit",
    "version": "0.1.0",
    "description": "Read-only git helpers: commit-style learner, branch names, PR drafts, changelog, status map, merge preview, stash/worktree/submodule views, repo health and merge readiness. Every command starts with gk.",
    "help": "gk",
    "helpDesc": "List every git-kit command",
    "category": "git",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "gk",
        "desc": "List every git-kit command"
      },
      {
        "name": "gkblame",
        "desc": "Who wrote a file: authors by lines (size capped)"
      },
      {
        "name": "gkbranch",
        "desc": "Suggest branch names that match the existing naming"
      },
      {
        "name": "gkfixup",
        "desc": "Which recent commit last touched a file (or your staged files)"
      },
      {
        "name": "gkhealth",
        "desc": "Repo health card: branch ages, stale and merged branches, big files (pane tab)"
      },
      {
        "name": "gkhooks",
        "desc": "List the git hook files that exist (never runs them)"
      },
      {
        "name": "gkignore",
        "desc": "Untracked files that look like build output or secrets; \"fill\" asks Claude to update .gitignore"
      },
      {
        "name": "gklarge",
        "desc": "Large-file watcher: toast when a changed file passes the threshold"
      },
      {
        "name": "gklog",
        "desc": "Changelog from commit subjects since the last tag"
      },
      {
        "name": "gkmerge",
        "desc": "Preview merge conflicts with a read-only merge-tree"
      },
      {
        "name": "gkmsg",
        "desc": "Learn this repo's commit-message style and fill a prompt asking Claude to follow it"
      },
      {
        "name": "gkpr",
        "desc": "Fill a prompt to draft a PR description from the diff stat and commits since the base"
      },
      {
        "name": "gkready",
        "desc": "Merge-readiness score: tests seen passing, clean tree, no conflict markers (pane tab)"
      },
      {
        "name": "gkrelease",
        "desc": "Per-repo release checklist you can tick (pane tab)"
      },
      {
        "name": "gkremote",
        "desc": "Toast when you are ahead of upstream after a turn (max one per 10 min)"
      },
      {
        "name": "gkreset",
        "desc": "Clear everything git-kit recorded"
      },
      {
        "name": "gksplit",
        "desc": "Propose how to split the changed files into commits (text only)"
      },
      {
        "name": "gkstash",
        "desc": "Browse stashes with their stat (pane tab)"
      },
      {
        "name": "gkstatus",
        "desc": "Staged / unstaged / untracked map of every file (pane tab)"
      },
      {
        "name": "gksub",
        "desc": "Submodule status"
      },
      {
        "name": "gktag",
        "desc": "Suggest the next version from commit prefixes since the last tag"
      },
      {
        "name": "gktree",
        "desc": "Worktrees, submodules and hooks in one tab"
      },
      {
        "name": "log",
        "desc": "--format=%h %s"
      }
    ],
    "features": []
  },
  {
    "name": "helpers",
    "version": "0.1.0",
    "description": "Quiet helpers: plain-words approvals, delete preview, secret and commit guards, changes and steps panels, time and cost under replies, welcome-back summary, right-click extras, notes and /quietmode",
    "help": "helpers",
    "helpDesc": "Helpers: switches, changes, steps and notes. /helpers allow-commit lets one held commit through",
    "category": "assist",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "helpers",
        "desc": "Helpers: switches, changes, steps and notes. /helpers allow-commit lets one held commit through"
      },
      {
        "name": "changes",
        "desc": "Files changed in the last turn, with diffs"
      },
      {
        "name": "steps",
        "desc": "Claude's task list with how long each step took"
      },
      {
        "name": "mynotes",
        "desc": "Replies you saved as notes"
      },
      {
        "name": "shortcut",
        "desc": "Your right-click actions: /shortcut add <name> = <what to ask>"
      },
      {
        "name": "quietmode",
        "desc": "Hide extra lines, sounds and pop-ups (safety checks stay)"
      }
    ],
    "features": []
  },
  {
    "name": "layout",
    "version": "0.1.0",
    "description": "How things are drawn: zen mode, split view, floating note, sticky headers, collapsible sections, width and density controls, error and long-output banners, icon packs and a colour legend",
    "help": "ly",
    "helpDesc": "this list",
    "category": "layout",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "ly",
        "desc": "this list"
      },
      {
        "name": "lychips",
        "desc": "language chips under code in assistant text"
      },
      {
        "name": "lycols",
        "desc": "one or two columns in this mod's panes"
      },
      {
        "name": "lycompact",
        "desc": "dense panes for small windows"
      },
      {
        "name": "lyerr",
        "desc": "one-line banner under a failed tool call"
      },
      {
        "name": "lyicons",
        "desc": "icon pack for this mod's panes and banners"
      },
      {
        "name": "lylegend",
        "desc": "colour legend: each theme key and where these mods use it"
      },
      {
        "name": "lymain",
        "desc": "open the showcase and settings pane"
      },
      {
        "name": "lynote",
        "desc": "small floating note pane; clear"
      },
      {
        "name": "lypath",
        "desc": "how file paths are cut in this mod's lists"
      },
      {
        "name": "lypin",
        "desc": "reopen that pane at every session start; list, clear"
      },
      {
        "name": "lyreset",
        "desc": "reset settings and clear everything this mod stored"
      },
      {
        "name": "lysplit",
        "desc": "compare two text blobs side by side; clear, swap"
      },
      {
        "name": "lystripe",
        "desc": "alternate row tone in this mod's lists"
      },
      {
        "name": "lytime",
        "desc": "relative-and-exact time demo (the Recent tab)"
      },
      {
        "name": "lywidth",
        "desc": "reading width limit for assistant text"
      },
      {
        "name": "lyzen",
        "desc": "hide every band row and status text other mods draw"
      }
    ],
    "features": []
  },
  {
    "name": "layout-kit",
    "version": "0.2.0",
    "description": "A customizable dashboard builder: one pane of tiles (calls, errors, files, spend, context, time, todos and your own text, number and formula tiles) with named pages, saved and per-project layouts, snippets, aliases, templates, rules, badges and goals. Affects…",
    "help": "cu",
    "helpDesc": "Layout kit: list every command",
    "category": "assist",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "cu",
        "desc": "Layout kit: list every command"
      },
      {
        "name": "cualias",
        "desc": "Command aliases: /cualias list | add <alias> <text> | rm <alias>"
      },
      {
        "name": "cubadge",
        "desc": "Badges: /cubadge \"100 calls\" when calls >= 100 | list | rm <name>"
      },
      {
        "name": "cubtn",
        "desc": "Custom buttons (max 5): /cubtn list | add <label> | <text> | rm <n> | use <n>"
      },
      {
        "name": "cubudget",
        "desc": "Budget for this project folder: /cubudget <usd> | off"
      },
      {
        "name": "cucustom",
        "desc": "Custom tiles: /cucustom text|number|formula <id> <label> | <value> ; set <id> <v> ; rm <id>"
      },
      {
        "name": "cuexport",
        "desc": "Print the current layout as text to share"
      },
      {
        "name": "cugoal",
        "desc": "Goals: /cugoal \"ship it\" files target 10 | list | rm <name>"
      },
      {
        "name": "cuimport",
        "desc": "Import a layout: /cuimport <json> shows the changes, /cuimport confirm applies them"
      },
      {
        "name": "culayout",
        "desc": "Saved layouts: /culayout list | save <name> | load <name> | rm <name> | project <name>|off"
      },
      {
        "name": "curecipe",
        "desc": "Ready-made rules: /curecipe list | on <id> | off <id>"
      },
      {
        "name": "cureset",
        "desc": "Clear what was recorded: /cureset | /cureset all confirm (also your settings)"
      },
      {
        "name": "curule",
        "desc": "Alert rules: /curule add if errors > 5 then toast \"...\" | list | rm|on|off <n>"
      },
      {
        "name": "curun",
        "desc": "Put an alias in the prompt box: /curun <alias>"
      },
      {
        "name": "cushow",
        "desc": "Open the dashboard pane: /cushow [dashboard|edit|library|snippets|rules]"
      },
      {
        "name": "cusnip",
        "desc": "Text snippets: /cusnip list | add <name> <text> | rm <name> | <name> (puts it in the prompt box)"
      },
      {
        "name": "cusprite",
        "desc": "Sprite: /cusprite <line|line|line|line|line> | preset cat|robot|ghost | clear"
      },
      {
        "name": "custatus",
        "desc": "Status template: /custatus <text with {calls} {errors} {spend} {ctx}> | off | show"
      },
      {
        "name": "cutab",
        "desc": "Dashboard pages: /cutab list | add <name> | rm <n> | rename <n> <name> | use <n>"
      },
      {
        "name": "cutile",
        "desc": "Tiles: /cutile list | add <id> [S|M|L] | rm <id> | up <id> | down <id> | size <id> S|M|L"
      },
      {
        "name": "cutool",
        "desc": "Tool style (this pane only): /cutool color|glyph|name <tool> <value> | clear <tool> | list"
      },
      {
        "name": "cutpl",
        "desc": "Templates: /cutpl list | add <name> <text with {1} {2} {name}> | rm <name> | <name> <args>"
      },
      {
        "name": "cuvar",
        "desc": "Template variables: /cuvar name=value | list | rm <name>"
      },
      {
        "name": "cuwarn",
        "desc": "Warning levels: /cuwarn <ctx|limit|errors|spend> <warn> <bad> | list | reset"
      }
    ],
    "features": [
      {
        "id": "record",
        "label": "Record counters for the tiles",
        "description": "Count tool calls, errors, edited file paths (kept in memory only), prompts, turns and the todo list this session so the tiles have something to show",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "badges",
        "label": "Earn badges",
        "description": "Check your own badge rules (/cubadge) when a turn ends and remember which are earned this session",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "badge-toasts",
        "label": "Toast when a badge is earned",
        "description": "A short toast the first time one of your badges is earned (at most one toast per 3 minutes)",
        "default": false,
        "group": "Toasts"
      },
      {
        "id": "rules",
        "label": "Run my alert rules",
        "description": "Evaluate your /curule rules when a turn ends and show a toast when one turns true (once per change, at most one toast per 3 minutes)",
        "default": false,
        "group": "Rules"
      },
      {
        "id": "recipes",
        "label": "Run the ready-made rules",
        "description": "Evaluate the six recipe rules you switched on with /curecipe when a turn ends (same throttle as your own rules)",
        "default": false,
        "group": "Rules"
      },
      {
        "id": "status-template",
        "label": "Write my status-line template",
        "description": "Write your /custatus template (for example {calls} {errors} {spend} {ctx}) to the status line when a turn ends, at most every 15 seconds",
        "default": false,
        "group": "Status"
      },
      {
        "id": "buttons-band",
        "label": "Show my buttons above the prompt",
        "description": "One row of up to 5 of your /cubtn buttons above the prompt box; each button puts its text in the prompt box",
        "default": false,
        "group": "Band"
      },
      {
        "id": "per-project",
        "label": "Open the project's layout",
        "description": "When a session starts in a project folder that has a saved layout bound to it (/culayout project), show that layout in the pane",
        "default": true,
        "group": "Layouts"
      }
    ]
  },
  {
    "name": "learning",
    "version": "0.1.0",
    "description": "Learning tools: glossaries, flashcards with spaced repetition, learning log, reading list, architecture map, skill tracker, explainer prompt-fillers and opt-in mentor, rubber-duck and beginner modes (/ln lists the commands)",
    "help": "ln",
    "helpDesc": "List every learning command",
    "category": "learning",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "ln",
        "desc": "List every learning command"
      },
      {
        "name": "lnarch",
        "desc": "Architecture map: /lnarch add <path> <description>, rm <path>, suggest, bare opens the pane"
      },
      {
        "name": "lnbeginner",
        "desc": "/lnbeginner on|off: explain terms, confirm before destructive steps (default off)"
      },
      {
        "name": "lncard",
        "desc": "Flashcards: /lncard <q> | <a>, /lncard list, /lncard rm <n>, /lncard gen [topic] fills a prompt"
      },
      {
        "name": "lnduck",
        "desc": "/lnduck on|off: Claude mostly asks questions (default off)"
      },
      {
        "name": "lneli5",
        "desc": "Fill the prompt: explain the last answer simply. /lneli5 on|off keeps it as a standing instruction"
      },
      {
        "name": "lnlearned",
        "desc": "Learning log: /lnlearned <text> adds a dated entry, bare lists the latest"
      },
      {
        "name": "lnmentor",
        "desc": "/lnmentor on|off: hint-first answers (default off)"
      },
      {
        "name": "lnnudge",
        "desc": "/lnnudge on|off: one toast a day when cards are due (default on)"
      },
      {
        "name": "lnpane",
        "desc": "Open the learning pane: /lnpane [glossary|cards|log|reading|arch|skills]"
      },
      {
        "name": "lnpterm",
        "desc": "Per-folder glossary (keyed by the current folder), same forms as /lnterm"
      },
      {
        "name": "lnread",
        "desc": "Reading list: /lnread <title> <url> [#topic], /lnread list, /lnread done <n>, /lnread rm <n>"
      },
      {
        "name": "lnreset",
        "desc": "Clear recorded learning data: /lnreset yes (settings kept)"
      },
      {
        "name": "lnreview",
        "desc": "Quiz yourself on due cards, one at a time, in the pane"
      },
      {
        "name": "lnskills",
        "desc": "File extensions and tools used per week, in the pane"
      },
      {
        "name": "lnterm",
        "desc": "Glossary: /lnterm <term> = <definition>, /lnterm list, /lnterm search <q>, /lnterm rm <term>"
      }
    ],
    "features": []
  },
  {
    "name": "look-and-sound",
    "version": "0.1.0",
    "description": "Sound cues when a turn finishes or fails (the Dusk ink theme is off)",
    "help": null,
    "helpDesc": "",
    "category": "look",
    "deps": [],
    "hasDeps": false,
    "cmds": [],
    "features": []
  },
  {
    "name": "looks",
    "version": "0.1.0",
    "description": "A /look picker: no theme by default, then opt-in palettes (paper, nord, solarized, sepia, high contrast, seasons, time of day, per project, per model) and subtle moving backdrops",
    "help": "look",
    "helpDesc": "Pick a look or a moving scene: /look <name>, /look off, /look scene <name>",
    "category": "look",
    "deps": [
      "motion"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "look",
        "desc": "Pick a look or a moving scene: /look <name>, /look off, /look scene <name>"
      }
    ],
    "features": []
  },
  {
    "name": "mod-manager",
    "version": "0.3.0",
    "description": "Front door for a collection of mods and other Claude plugins: catalog, installed list, bundles, remote update check, and install/enable/disable/update/uninstall command lines you can copy or run after a two-step confirm; a Features tab turns each mod's pop-up…",
    "help": "mm",
    "helpDesc": "Mod manager: open the pane and list every command",
    "category": "manager",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "mm",
        "desc": "Mod manager: open the pane and list every command"
      },
      {
        "name": "mmbundle",
        "desc": "list | show <name> | apply <name> [verb] | add <name> <mod,mod> | rm <name>"
      },
      {
        "name": "mmcat",
        "desc": "List the catalog of mods by category"
      },
      {
        "name": "mmcheck",
        "desc": "Fetch the stored marketplace.json and show NEW mods and newer versions (installs nothing)"
      },
      {
        "name": "mmcmds",
        "desc": "Show the commands of one catalog mod"
      },
      {
        "name": "mmdo",
        "desc": "Install, enable, disable, update or uninstall a plugin: prints the command, then /mmdo confirm runs…"
      },
      {
        "name": "mmfeatures",
        "desc": "Open the Features tab: switch each mod's pop-ups, sounds, status and row on or off (runs /cfg featu…"
      },
      {
        "name": "mmlist",
        "desc": "Show the installed plugins (read-only plugin list) and the reachable CLI"
      },
      {
        "name": "mmmarket",
        "desc": "Marketplace name used in command lines (default local-mods)"
      },
      {
        "name": "mmreport",
        "desc": "Text report of installed plugins (names, versions, status only) for a bug report"
      },
      {
        "name": "mmreset",
        "desc": "Clear everything this mod recorded: log, pending action, bundles, source, market"
      },
      {
        "name": "mmsearch",
        "desc": "Search the catalog by name, description, category or command"
      },
      {
        "name": "mmsource",
        "desc": "Store one https URL of a marketplace.json to compare against"
      }
    ],
    "features": []
  },
  {
    "name": "motion",
    "version": "0.1.0",
    "description": "Calm motion for the interface: eased gauges, number tickers, status typing and pulse, tool-row shimmer and check pops, spring timer ring, idle breathing, test celebration, and a /motion on|off switch",
    "help": "motion",
    "helpDesc": "Motion on/off: /motion on|off|demo|timer <minutes>",
    "category": "animation",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "motion",
        "desc": "Motion on/off: /motion on|off|demo|timer <minutes>"
      }
    ],
    "features": []
  },
  {
    "name": "notes",
    "version": "0.1.0",
    "description": "Searchable notes archive: per-folder notes with tags, links, snippets, command cookbook, daily journal, reminders, recurring tasks, backup and restore (commands start with nt)",
    "help": "nt",
    "helpDesc": "List the commands of the notes mod",
    "category": "notes",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "nt",
        "desc": "List the commands of the notes mod"
      },
      {
        "name": "ntattach",
        "desc": "Shelve a file path with a description (the file is never copied)"
      },
      {
        "name": "ntcmd",
        "desc": "Save a shell command in the cookbook (never run)"
      },
      {
        "name": "ntdel",
        "desc": "Delete one record by id (n3 note, l2 link, s1 snippet, c1 command, a1 file, g1 term, r1 reminder, e…"
      },
      {
        "name": "ntevery",
        "desc": "Add a recurring task, shown as a toast at session start when due"
      },
      {
        "name": "ntexport",
        "desc": "Show a JSON backup of this mod's data in the pane (never written to disk)"
      },
      {
        "name": "ntfile",
        "desc": "Import a text file (max 200 KB) as notes, one per line"
      },
      {
        "name": "ntfind",
        "desc": "Search every store of this mod"
      },
      {
        "name": "ntfix",
        "desc": "Apply the glossary to the draft in the prompt box"
      },
      {
        "name": "ntimport",
        "desc": "Restore from a pasted /ntexport backup (merges unless \"replace\")"
      },
      {
        "name": "ntjot",
        "desc": "Quick-capture a note for this folder (#tag words become tags)"
      },
      {
        "name": "ntjournal",
        "desc": "Open the daily journal (tool calls and files edited per day)"
      },
      {
        "name": "ntkeep",
        "desc": "Retention: delete notes, links and journal older than N days at session start"
      },
      {
        "name": "ntlink",
        "desc": "Save a link with a title (never fetched)"
      },
      {
        "name": "ntmd",
        "desc": "Show this session as Markdown in the pane (never written to disk)"
      },
      {
        "name": "ntnotes",
        "desc": "Open the notes of this folder, all folders, or one tag"
      },
      {
        "name": "ntprofile",
        "desc": "Save or restore this mod's own settings under a name"
      },
      {
        "name": "ntput",
        "desc": "Fill the prompt with a snippet or a saved command"
      },
      {
        "name": "ntremind",
        "desc": "Set a reminder; a toast appears when due"
      },
      {
        "name": "ntreset",
        "desc": "Same as /ntwipe confirm"
      },
      {
        "name": "ntset",
        "desc": "[key value]"
      },
      {
        "name": "ntsnip",
        "desc": "<lang> <name> <code>"
      },
      {
        "name": "nttags",
        "desc": "Count the tags used in notes and links"
      },
      {
        "name": "ntterm",
        "desc": "Add a glossary term (no args lists them)"
      },
      {
        "name": "ntwipe",
        "desc": "Delete ALL data of this mod (needs \"confirm\")"
      }
    ],
    "features": []
  },
  {
    "name": "personality",
    "version": "0.1.0",
    "description": "Quiet, switchable fun: mood status, streaks, badges, a tiny pet, greeting, tip of the day, focus sprints and a weekly report (/fun on|off)",
    "help": "fun",
    "helpDesc": "Switch the quiet fun on or off: /fun on, /fun off, /fun motion on|off",
    "category": "fun",
    "deps": [
      "motion"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "fun",
        "desc": "Switch the quiet fun on or off: /fun on, /fun off, /fun motion on|off"
      },
      {
        "name": "badges",
        "desc": "List achievement badges and your progress"
      },
      {
        "name": "pet",
        "desc": "Open the little pet pane (/pet off to close it)"
      },
      {
        "name": "sprint",
        "desc": "Focus sprint: /sprint <minutes> <what you will do> (also: stop, status)"
      },
      {
        "name": "sprintlog",
        "desc": "List your recent focus sprints"
      },
      {
        "name": "streak",
        "desc": "Show your edit streak: days in a row with a file edit"
      },
      {
        "name": "tip",
        "desc": "Show another tip about Claude Code"
      },
      {
        "name": "weekly",
        "desc": "Report on the last 7 days (/weekly pane opens it as a pane)"
      }
    ],
    "features": []
  },
  {
    "name": "prefs",
    "version": "0.2.0",
    "description": "A second set of shared preferences (formats, language, time zone, toasts, charts, data, per-mod tables) that other mods can read from one atom, with formatting helpers, a Preferences pane, import and export, undo, per-project and per-branch layers, and work/h…",
    "help": "pf",
    "helpDesc": "Help: every prefs command in one line each; opens the Preferences pane",
    "category": "assist",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "pf",
        "desc": "Help: every prefs command in one line each; opens the Preferences pane"
      },
      {
        "name": "pfauto",
        "desc": "Profile by time of day: /pfauto on|off|status|add HH:MM <profile>|rm HH:MM (default off)"
      },
      {
        "name": "pfexport",
        "desc": "Show your preferences as a JSON block (never written to a file)"
      },
      {
        "name": "pfget",
        "desc": "Show one preference, or a summary, or search by words: /pfget [key or words]"
      },
      {
        "name": "pfimport",
        "desc": "Check pasted JSON and show what would change: /pfimport <json>, then /pfimport confirm"
      },
      {
        "name": "pfmods",
        "desc": "Searchable mod list with the /cfg feature line for each switch: /pfmods [words]"
      },
      {
        "name": "pfprofile",
        "desc": "Named bundles: /pfprofile save <name> | use <name> | list | del <name>"
      },
      {
        "name": "pfproject",
        "desc": "Per-project and per-branch layers: /pfproject [show|set|unset|clear|branch ...|refresh]"
      },
      {
        "name": "pfreset",
        "desc": "Back to default: /pfreset <key> | /pfreset (all) | /pfreset history | /pfreset everything confirm"
      },
      {
        "name": "pfset",
        "desc": "Set one preference: /pfset <key> <value> (key with no value shows what it accepts)"
      },
      {
        "name": "pfundo",
        "desc": "Undo the last change: /pfundo | /pfundo <n> | /pfundo list (last 30 changes are kept)"
      },
      {
        "name": "status",
        "desc": "Status line"
      }
    ],
    "features": [
      {
        "id": "auto-open",
        "label": "Open Preferences at start",
        "description": "At session start, open the Preferences pane when the preference autoopen.prefs is on",
        "default": false,
        "group": "Start-up"
      },
      {
        "id": "auto-profile",
        "label": "Profile by time of day",
        "description": "Apply a profile on a schedule (also needs /pfauto on); checked at start and every 30 minutes while on",
        "default": false,
        "group": "Profiles"
      },
      {
        "id": "auto-toast",
        "label": "Say when a profile was applied",
        "description": "One short toast (at most one per 3 minutes) when the schedule switches the profile",
        "default": false,
        "group": "Profiles"
      },
      {
        "id": "remember-tab",
        "label": "Remember the last tab",
        "description": "Keep the last tab you used when the preference pane.remember is on",
        "default": true,
        "group": "Pane"
      },
      {
        "id": "history",
        "label": "Record the change history",
        "description": "Keep the last 30 changes so /pfundo works; off means no undo",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "project-overrides",
        "label": "Apply per-project layers",
        "description": "Use the project layer when the scope is per-project",
        "default": true,
        "group": "Scope"
      },
      {
        "id": "branch-overrides",
        "label": "Read the git branch for branch layers",
        "description": "Runs a read-only git rev-parse at start (and on /pfproject refresh) so a per-branch layer can apply",
        "default": false,
        "group": "Scope"
      }
    ]
  },
  {
    "name": "progress",
    "version": "0.1.0",
    "description": "Progress and achievement: goals with a daily bar, weekly ring and confetti, milestone ladder, XP, streak calendar with freeze days, projects and checklists, learning, skill tree, habits, personal bests, journal, focus and momentum, backlog, ship log and test…",
    "help": "pg",
    "helpDesc": "List every progress command",
    "category": "progress",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "pg",
        "desc": "List every progress command"
      },
      {
        "name": "pgbacklog",
        "desc": "Backlog: add <text>, done <n>, rm <n>, clear, list"
      },
      {
        "name": "pgbest",
        "desc": "Personal bests: fastest passing test run, longest streak, biggest day"
      },
      {
        "name": "pgfocus",
        "desc": "Focus score of the last 2 hours"
      },
      {
        "name": "pgfreeze",
        "desc": "Streak calendar; spend this week's one freeze day: /pgfreeze [yesterday]"
      },
      {
        "name": "pggoal",
        "desc": "Goals: add <text>, done <n>, undo <n>, rm <n>, start <n>, stop, target <n>, list"
      },
      {
        "name": "pghabit",
        "desc": "Habit grid: /pghabit, /pghabit mark|unmark <n>"
      },
      {
        "name": "pgjournal",
        "desc": "One line a day: /pgjournal <text>, or /pgjournal to see the timeline"
      },
      {
        "name": "pglearn",
        "desc": "Learning log: /pglearn <topic>, /pglearn target <n>"
      },
      {
        "name": "pglevel",
        "desc": "Milestone ladder: your level and the distance to the next"
      },
      {
        "name": "pgmetrics",
        "desc": "Test counts and coverage over time, with sparklines"
      },
      {
        "name": "pgmomentum",
        "desc": "This hour against your hourly average"
      },
      {
        "name": "pgpane",
        "desc": "Open the progress pane: /pgpane [goals|level|streak|plans|stats|log|skills]"
      },
      {
        "name": "pgproj",
        "desc": "Checklists: new, use, add, sub <n> <text>, check, uncheck, rm, drop, list"
      },
      {
        "name": "pgreset",
        "desc": "Clear everything this mod recorded: /pgreset yes"
      },
      {
        "name": "pgship",
        "desc": "Ship log of commits, merges and tags seen in Bash results"
      },
      {
        "name": "pgsplit",
        "desc": "Fill the prompt asking for three steps with checks: /pgsplit <goal>"
      },
      {
        "name": "pgtree",
        "desc": "Skill tree unlocked by the tools and commands you have used"
      },
      {
        "name": "pgxp",
        "desc": "XP for good habits: tests +2, commit +3, note +1, goal done +5"
      }
    ],
    "features": []
  },
  {
    "name": "progress-more",
    "version": "0.1.0",
    "description": "Progress extras in one pane: quality trend, review bar, refactor/migration/upgrade trackers, test debt, docs coverage, cleanup meter, intentions, wrap/plan/win/share cards, season goals, and your own tips, prompt templates, toast rules, retention, tiles and n…",
    "help": "pq",
    "helpDesc": "This list",
    "category": "progress",
    "deps": [
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "pq",
        "desc": "This list"
      },
      {
        "name": "pqcard",
        "desc": "135 This week as a compact text block (printed here, never sent)"
      },
      {
        "name": "pqclean",
        "desc": "130 TODO/FIXME added versus removed"
      },
      {
        "name": "pqdocs",
        "desc": "129 Exported functions with a comment, in files edited this session"
      },
      {
        "name": "pqfmt",
        "desc": "/pqfmt [currency <sym>|clock 12|24|units si|iec]"
      },
      {
        "name": "pqgoal",
        "desc": "/pqgoal [add <text> @<week|date|+n>|done <n>|del <n>]"
      },
      {
        "name": "pqintent",
        "desc": "131 Say what this session is for"
      },
      {
        "name": "pqkeep",
        "desc": "192 Retention per data list (days, trends, intents, wins)"
      },
      {
        "name": "pqmigrate",
        "desc": "126 Count old and new text over time (quote text with spaces)"
      },
      {
        "name": "pqpane",
        "desc": "Open the pane (tabs: Home tiles, Quality, Review, Track, Me, Custom)"
      },
      {
        "name": "pqplan",
        "desc": "133 Monday plan card (three items)"
      },
      {
        "name": "pqrate",
        "desc": "131 Rate how the latest intention went"
      },
      {
        "name": "pqrefactor",
        "desc": "125 Count what is left of a literal text (read-only grep -F)"
      },
      {
        "name": "pqreset",
        "desc": "Clear recorded data (all: your tips, templates, rules, tiles and formats too)"
      },
      {
        "name": "pqrev",
        "desc": "/pqrev [add <text>|tick <n>|untick <n>|del <n>|clear]"
      },
      {
        "name": "pqrule",
        "desc": "191 Toast rules over turn.complete, tests-pass, tests-fail, commit (max 20)"
      },
      {
        "name": "pqtestdebt",
        "desc": "128 Changed source files with no test file touched"
      },
      {
        "name": "pqtiles",
        "desc": "/pqtiles [show a,b,c|hide <id>|up <id>|down <id>|reset]"
      },
      {
        "name": "pqtips",
        "desc": "189 Your own tips (one toast a day at most, never when calm)"
      },
      {
        "name": "pqtpl",
        "desc": "190 Your prompt templates; a name fills the prompt box"
      },
      {
        "name": "pqtrend",
        "desc": "123 Errors per 100 tool calls by week"
      },
      {
        "name": "pqupgrade",
        "desc": "127 Outdated dependencies (read-only npm outdated / pip list --outdated, 30 s limit, never installs)"
      },
      {
        "name": "pqwin",
        "desc": "134 Log a win, or list the latest"
      },
      {
        "name": "pqwrap",
        "desc": "132 End-of-day wrap card from your own counters"
      }
    ],
    "features": []
  },
  {
    "name": "prompt-tools",
    "version": "0.1.0",
    "description": "Right-click prompt shortcuts, /review, and standing prompt preferences",
    "help": "snip",
    "helpDesc": "Snippets: /snip save <name> <text>, /snip <name>, /snip list, /snip rm <name>",
    "category": "prompts",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "snip",
        "desc": "Snippets: /snip save <name> <text>, /snip <name>, /snip list, /snip rm <name>"
      },
      {
        "name": "audit",
        "desc": "Fill the prompt with a review request for this session"
      }
    ],
    "features": []
  },
  {
    "name": "prompting",
    "version": "0.1.0",
    "description": "Prompt craft: templates, context blocks, macros, queue, A/B, scorecard, diff, reword, clean-up, tone and other standing instructions (all off by default). Commands start with pm; /pm lists them.",
    "help": "pm",
    "helpDesc": "List these commands and the state of the standing instructions: /pm pane opens the pane",
    "category": "prompts",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "pm",
        "desc": "List these commands and the state of the standing instructions: /pm pane opens the pane"
      },
      {
        "name": "pmab",
        "desc": "Store two phrasings and which result was better; never sends"
      },
      {
        "name": "pmask",
        "desc": "Question-first mode: up to three clarifying questions before big tasks (default off)"
      },
      {
        "name": "pmassume",
        "desc": "Lines the assistant started with \"Assuming\" or \"I assume\""
      },
      {
        "name": "pmclean",
        "desc": "Tidy a dictated draft: filler words, repeats, spacing, capitals"
      },
      {
        "name": "pmctx",
        "desc": "Reusable context blocks: /pmctx <name> attaches one to the next prompt. add | rm | show | off | list"
      },
      {
        "name": "pmdecide",
        "desc": "<text> | list | rm n | fill"
      },
      {
        "name": "pmdiff",
        "desc": "Compare two earlier prompts word by word in the pane (default: the last two)"
      },
      {
        "name": "pmexample",
        "desc": "Example-first mode: start explanations with an example (default off)"
      },
      {
        "name": "pmlang",
        "desc": "Standing instruction to reply in a language (default off)"
      },
      {
        "name": "pmmacro",
        "desc": "Prefix macros: //name at the start of a prompt expands to the stored text"
      },
      {
        "name": "pmmark",
        "desc": "Star a reply or moment with a label; go shows where it is"
      },
      {
        "name": "pmpin",
        "desc": "Pin a constraint (up to 3): shown above the prompt and added to the system prompt while pinned"
      },
      {
        "name": "pmq",
        "desc": "Prompt queue: next fills the box, never sends"
      },
      {
        "name": "pmquote",
        "desc": "Fill the prompt with a quote of the last assistant reply"
      },
      {
        "name": "pmrec",
        "desc": "Recording of prompt history, scores and drafts (default on, local only, secrets skipped)"
      },
      {
        "name": "pmreset",
        "desc": "Clear recorded data (history, drafts, marks, decisions, assumptions); all also clears your library…"
      },
      {
        "name": "pmrestore",
        "desc": "Fill the prompt with the autosaved draft (or the last prompt you sent)"
      },
      {
        "name": "pmreword",
        "desc": "Heuristic tidier version of a long draft; no model call"
      },
      {
        "name": "pmscore",
        "desc": "Private clarity, scope and constraints score of each sent prompt, in the pane"
      },
      {
        "name": "pmsum",
        "desc": "Fill the prompt with a request for a ten-line recap of the conversation so far"
      },
      {
        "name": "pmtone",
        "desc": "Standing tone instruction (default off)"
      },
      {
        "name": "pmtpl",
        "desc": "Fill the prompt from a template with blanks (bug, feature, ...): /pmtpl bug login | 500 | blank. ad…"
      },
      {
        "name": "queue",
        "desc": "Queue and A/B"
      }
    ],
    "features": []
  },
  {
    "name": "review-kit",
    "version": "0.1.0",
    "description": "Review helper for code Claude changes: tickable checklist and 19 heuristic detectors (risky paths, test gaps, complexity, TODOs, dead code, naming, import cycles, API/dependency/config changes, error handling, logging, migrations, performance, accessibility,…",
    "help": "rk",
    "helpDesc": "review-kit: list its commands",
    "category": "git",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "rk",
        "desc": "review-kit: list its commands"
      },
      {
        "name": "rkbudget",
        "desc": "Warn once per turn when lines changed exceed <lines> (off to disable)"
      },
      {
        "name": "rkcheck",
        "desc": "Show the review checklist, or tick/untick item <n>"
      },
      {
        "name": "rkdetect",
        "desc": "List detectors, or switch one on or off"
      },
      {
        "name": "rkdismiss",
        "desc": "Dismiss finding <n> (numbers from the pane or /rkpane), or all"
      },
      {
        "name": "rkpane",
        "desc": "Open the review-kit pane: findings, checklist, files, detectors"
      },
      {
        "name": "rkreset",
        "desc": "Clear recorded findings, files, dismissals and ticks (all: settings too)"
      },
      {
        "name": "rkset",
        "desc": "Settings: toast (the single serious-finding toast) and read (read back edited files)"
      }
    ],
    "features": []
  },
  {
    "name": "safety-pro",
    "version": "0.1.0",
    "description": "Safety and power workflow: dry-run, allowlist, hard budget, loop breaker, protected paths, opt-in checkpoints with confirmed rollback, pre-commit check, auto-compact, handoff note and a block log",
    "help": "protect",
    "helpDesc": "Protect paths from Edit and Write: /protect <path> | list | rm <path>",
    "category": "safety",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "protect",
        "desc": "Protect paths from Edit and Write: /protect <path> | list | rm <path>"
      },
      {
        "name": "allow",
        "desc": "Per-project allowlist: /allow <command-prefix> | list | rm <prefix> | add <prefix>"
      },
      {
        "name": "dryrun",
        "desc": "Hold mutating commands and edits so the model describes them instead: on | off"
      },
      {
        "name": "handoff",
        "desc": "Write a session handoff note (kept in the mod store) and fill the prompt: /handoff show"
      },
      {
        "name": "hardbudget",
        "desc": "Hard spend stop in dollars: /hardbudget <usd> | off"
      },
      {
        "name": "loopguard",
        "desc": "Deny the 4th identical consecutive tool call: on | off"
      },
      {
        "name": "precommit",
        "desc": "Run a check before the model may git commit: /precommit <command> | off"
      },
      {
        "name": "rollback",
        "desc": "Restore files from the previous checkpoint: preview first, then /rollback confirm"
      },
      {
        "name": "safecompact",
        "desc": "Auto-compact at 85% context, at most every 10 minutes: on | off"
      },
      {
        "name": "safetylog",
        "desc": "Open the safety log pane (blocks and allows with reasons): /safetylog clear"
      },
      {
        "name": "snapshot",
        "desc": "Opt-in checkpoint after each turn under refs/claude-checkpoints: on | off | now | list"
      }
    ],
    "features": []
  },
  {
    "name": "settings",
    "version": "0.2.0",
    "description": "Shared look-and-feel settings (accent, density, icons, preset) and per-mod feature switches (pop-ups, sounds, status line, rows above the prompt) that other mods can read; /cfg to change them",
    "help": "cfg",
    "helpDesc": "Shared look and feel and per-mod feature switches: /cfg preset calm|focus|full, /cfg accent|density|icons <value>, /cfg…",
    "category": "settings",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "cfg",
        "desc": "Shared look and feel and per-mod feature switches: /cfg preset calm|focus|full, /cfg accent|density…"
      }
    ],
    "features": []
  },
  {
    "name": "skins",
    "version": "0.1.0",
    "description": "A palette and style library you apply on demand with /skuse: 15 named palettes, an accent picker, contrast steps, rounded or square corners, glass cards and a paper grain. Nothing is applied by default",
    "help": "sk",
    "helpDesc": "Skins help: every /sk command in one line each",
    "category": "look",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "sk",
        "desc": "Skins help: every /sk command in one line each"
      },
      {
        "name": "skpreview",
        "desc": "A pane of swatches for every palette, with an Apply button each"
      },
      {
        "name": "skremember",
        "desc": "Bring your /skuse choice back at session start: /skremember on|off (default off)"
      },
      {
        "name": "skreset",
        "desc": "Forget the saved skin choice and clear what skins applied"
      },
      {
        "name": "skuse",
        "desc": "Apply a palette or style: /skuse <name>, /skuse accent <hex>, /skuse contrast sharp, /skuse off"
      }
    ],
    "features": []
  },
  {
    "name": "skins-plus",
    "version": "0.1.0",
    "description": "More looks, opt-in only: cyber, cozy night, high-visibility, print, weekday, per-project and per-branch tints, a look scheduler, sunrise accent, custom roles, theme import/export, dyslexia and large-type settings, a custom status line template",
    "help": "sp",
    "helpDesc": "Skins plus: list every /sp command",
    "category": "look",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "sp",
        "desc": "Skins plus: list every /sp command"
      },
      {
        "name": "spauto",
        "desc": "Apply a project or branch tint at session start: /spauto on|project|branch|off"
      },
      {
        "name": "spcustom",
        "desc": "Edit your custom palette: /spcustom hue 200 sat 20 mode both accent #2288cc"
      },
      {
        "name": "spday",
        "desc": "Apply today's weekday palette at session start: /spday on|off"
      },
      {
        "name": "spdensity",
        "desc": "Compact or airy density for this mod: /spdensity compact|normal|airy"
      },
      {
        "name": "spdys",
        "desc": "Dyslexia-friendly spacing: /spdys on|off"
      },
      {
        "name": "spexport",
        "desc": "Show your custom palette as JSON"
      },
      {
        "name": "spimport",
        "desc": "Import JSON with a preview: /spimport <json>, then /spimport confirm"
      },
      {
        "name": "spnight",
        "desc": "Apply the cozy night palette (low blue, amber on dark)"
      },
      {
        "name": "sppane",
        "desc": "Open the skins-plus pane"
      },
      {
        "name": "spproject",
        "desc": "Accent colour for this folder: /spproject <colour|#hex|off>"
      },
      {
        "name": "spreset",
        "desc": "Forget everything this mod stored (the theme itself is left alone)"
      },
      {
        "name": "sprole",
        "desc": "Semantic colours for these palettes: /sprole danger #aa0000"
      },
      {
        "name": "spsched",
        "desc": "Look scheduler: /spsched on|off|add 22:00 night|del 22:00|list"
      },
      {
        "name": "spscheme",
        "desc": "Colour mode for palettes: /spscheme system|light|dark"
      },
      {
        "name": "spshare",
        "desc": "Show this mod's settings as one JSON block"
      },
      {
        "name": "spskin",
        "desc": "Apply a palette now: /spskin cyber|night|hivis|print|mon..sun|custom|project|branch|sun|plain"
      },
      {
        "name": "spstatus",
        "desc": "Custom status line: /spstatus on|off or /spstatus {branch} {cost} {context}"
      },
      {
        "name": "spsun",
        "desc": "Accent hue follows the hour: /spsun on|off"
      },
      {
        "name": "sptype",
        "desc": "Large-type scale: /sptype 1|1.15|1.3|1.5"
      },
      {
        "name": "spuse",
        "desc": "Palette profile for this folder: /spuse set <name>, /spuse, /spuse off"
      }
    ],
    "features": []
  },
  {
    "name": "sound-pack",
    "version": "0.1.0",
    "description": "Sound packs (retro, wood, glass) with finish chime, error tones, approval cue, optional ticks, spoken summaries, quiet hours and volume by turn length",
    "help": "sound",
    "helpDesc": "Sound packs: /sound <retro|wood|glass|silent|off>, ticks, speak, quiet",
    "category": "look",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "sound",
        "desc": "Sound packs: /sound <retro|wood|glass|silent|off>, ticks, speak, quiet"
      }
    ],
    "features": []
  },
  {
    "name": "style-gallery",
    "version": "0.2.0",
    "description": "A design-system gallery: one pane with 30 labelled style samples (radius, elevation, badges, toasts, modes, navigation patterns) drawn as vector images on the desktop and as text elsewhere, with /sgcopy to put a short written spec of any style in the prompt b…",
    "help": null,
    "helpDesc": "",
    "category": "assist",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [],
    "features": [
      {
        "id": "svg",
        "label": "Vector samples",
        "description": "Draw each style as a real vector image on the desktop app (off: text samples everywhere)",
        "default": true,
        "group": "Gallery"
      },
      {
        "id": "tooltips",
        "label": "Hover tooltips",
        "description": "Add hover titles to the parts of the vector samples",
        "default": true,
        "group": "Gallery"
      },
      {
        "id": "animate",
        "label": "Animated previews",
        "description": "Shimmer, pulse and slide-in on a few vector samples (also needs /motion on and calm off)",
        "default": false,
        "group": "Effects"
      },
      {
        "id": "toolbar",
        "label": "Search, filter and sort",
        "description": "The search box, filter chips and sort buttons above the samples",
        "default": true,
        "group": "Navigation"
      },
      {
        "id": "zebra",
        "label": "Zebra rows and highlight band",
        "description": "Stripes and a band on the current row of the List tab (desktop: subtle backgrounds; elsewhere dimmed rows)",
        "default": true,
        "group": "Navigation"
      },
      {
        "id": "sticky-headers",
        "label": "Sticky group headers",
        "description": "Repeat the group header at the top of the List tab once you scroll past it",
        "default": true,
        "group": "Navigation"
      },
      {
        "id": "footer",
        "label": "Action footer",
        "description": "The row of actions (previous, next, copy spec, grid) at the bottom of the pane",
        "default": true,
        "group": "Navigation"
      },
      {
        "id": "fab",
        "label": "Ask button",
        "description": "The primary + Ask for this style button at the end of the pane",
        "default": true,
        "group": "Navigation"
      },
      {
        "id": "grid-overlay",
        "label": "Spacing grid overlay",
        "description": "Allow the 4 px grid to be drawn over the vector samples",
        "default": true,
        "group": "Gallery"
      }
    ]
  },
  {
    "name": "tool-guard",
    "version": "0.1.0",
    "description": "Blocks risky tool calls, badges commands by risk, and shows a pass/fail card under test runs",
    "help": "readonly",
    "helpDesc": "Toggle read-only mode: blocks file edits and mutating shell commands",
    "category": "safety",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "readonly",
        "desc": "Toggle read-only mode: blocks file edits and mutating shell commands"
      }
    ],
    "features": []
  },
  {
    "name": "tool-visuals",
    "version": "0.1.0",
    "description": "Richer tool-call rows: risk edge, file glyphs, mini diffs, duration and size chips, network badges and progress, secret masking, retry counts, failing-test and build-error cards",
    "help": "toolvis",
    "helpDesc": "Tool-call visuals: /toolvis on | off | status (secret masking stays on either way)",
    "category": "look",
    "deps": [
      "motion"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "toolvis",
        "desc": "Tool-call visuals: /toolvis on | off | status (secret masking stays on either way)"
      }
    ],
    "features": []
  },
  {
    "name": "ui-kit",
    "version": "0.2.0",
    "description": "Six views over what this session did (timeline, files treemap, errors, prompts, spend, activity) in one switchable pane: real vector charts on the desktop app, text charts elsewhere, with split view, master-detail, mini and widget modes, breakpoints, accordio…",
    "help": "ui",
    "helpDesc": "List every UI kit command",
    "category": "assist",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "ui",
        "desc": "List every UI kit command"
      },
      {
        "name": "uidemo",
        "desc": "Fill every view with made-up sample data: /uidemo on|off"
      },
      {
        "name": "uifail",
        "desc": "Make the next draw of a view fail once, to try the Retry button"
      },
      {
        "name": "uifull",
        "desc": "Open the pane as large as the app allows, with the keyboard"
      },
      {
        "name": "uimini",
        "desc": "Switch the pane to its mini mode (three numbers) and back"
      },
      {
        "name": "uireset",
        "desc": "Clear what this mod recorded (add \"all\" to also reset the Lab, folds and layout)"
      },
      {
        "name": "uiswitches",
        "desc": "Show every ui-kit switch (on or off) and how to change it"
      },
      {
        "name": "uiundo",
        "desc": "Bring back the Lab item removed in the last 30 seconds"
      },
      {
        "name": "uiviews",
        "desc": "Open the pane: /uiviews [timeline|files|errors|prompts|spend|activity|lab] [split <view>|split off]"
      },
      {
        "name": "uiwidget",
        "desc": "Open a second small pane as a widget where the app has widgets"
      }
    ],
    "features": [
      {
        "id": "record",
        "label": "Record calls and edits",
        "description": "Keep a bounded list of tool calls, edited files and errors for the views (this session, plus daily totals)",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "record-prompts",
        "label": "Record prompt times and lengths",
        "description": "Count each prompt with its time and length; the text is never kept",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "prompt-snippets",
        "label": "Keep prompt snippets",
        "description": "Also keep the first 40 characters of each prompt, this session only",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "record-spend",
        "label": "Sample spend and context",
        "description": "Take a cost and context reading when a turn finishes",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "error-text",
        "label": "Keep error messages",
        "description": "Keep a short scrubbed message for failed calls so the Errors view can group them (this session only)",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "split",
        "label": "Split view",
        "description": "Show a second view next to or below the first",
        "default": true,
        "group": "Layout"
      },
      {
        "id": "master-detail",
        "label": "Master-detail lists",
        "description": "On a wide pane, list on the left and the picked row's detail on the right",
        "default": true,
        "group": "Layout"
      },
      {
        "id": "expand-rows",
        "label": "Expandable rows",
        "description": "Rows open in place to show their detail",
        "default": true,
        "group": "Layout"
      },
      {
        "id": "accordion",
        "label": "Accordion sections",
        "description": "Sections fold open and shut; the choice is remembered between sessions",
        "default": true,
        "group": "Layout"
      },
      {
        "id": "inline-sparks",
        "label": "Inline sparklines",
        "description": "A tiny chart at the end of a text row (an image on the desktop app, block characters elsewhere)",
        "default": true,
        "group": "Layout"
      },
      {
        "id": "skeleton",
        "label": "Skeleton loader",
        "description": "Show grey placeholder bars for a moment when you switch views (only with motion on and calm off)",
        "default": false,
        "group": "Layout"
      },
      {
        "id": "large-targets",
        "label": "Large touch targets",
        "description": "More padding around every button in the pane",
        "default": false,
        "group": "Access"
      },
      {
        "id": "hotkeys",
        "label": "Keyboard-first",
        "description": "Give the pane's buttons hotkeys and open the pane with the keyboard",
        "default": false,
        "group": "Access"
      },
      {
        "id": "entrance",
        "label": "Entrance animation",
        "description": "Charts rise into place when you open or switch a view (only with motion on and calm off)",
        "default": true,
        "group": "Motion"
      },
      {
        "id": "pulse",
        "label": "Pulse on change",
        "description": "Briefly highlight a number that just changed (only with motion on and calm off)",
        "default": true,
        "group": "Motion"
      },
      {
        "id": "checkmark",
        "label": "Checkmark animation",
        "description": "Draw a tick when the demo wizard finishes (still tick when motion is off)",
        "default": true,
        "group": "Motion"
      },
      {
        "id": "confetti",
        "label": "Confetti on milestones",
        "description": "A short burst in the pane at 10, 25, 50, 100 ... tool calls",
        "default": false,
        "group": "Motion"
      },
      {
        "id": "eta",
        "label": "Estimated time for a running call",
        "description": "A progress bar with a guess of the time left, from earlier calls of the same tool",
        "default": true,
        "group": "Progress"
      },
      {
        "id": "eta-live",
        "label": "Refresh the estimate every second",
        "description": "Redraw once a second while a call runs, so the bar moves",
        "default": false,
        "group": "Progress"
      },
      {
        "id": "optimistic",
        "label": "Optimistic toggle demo",
        "description": "In the Lab a toggle shows its new state at once, then confirms a moment later",
        "default": true,
        "group": "Lab"
      },
      {
        "id": "undo-toast",
        "label": "Undo toast",
        "description": "A toast after removing a Lab item, saying /uiundo restores it for 30 seconds (one toast per 3 minutes)",
        "default": true,
        "group": "Lab"
      }
    ]
  },
  {
    "name": "ui-two",
    "version": "0.2.0",
    "description": "One pane with a view switcher: command bar, popover menu, activity feed, timeline, kanban, table, cards, calendar, treemap, graph, compare, replay, notices, print and presentation views, budget guard with rollover, forecast, prompt library with stats, model l…",
    "help": "uj",
    "helpDesc": "UI two: list every command",
    "category": "assist",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "uj",
        "desc": "UI two: list every command"
      },
      {
        "name": "ujbudget",
        "desc": "UI two: daily budget with rollover"
      },
      {
        "name": "ujcmd",
        "desc": "UI two: manage the stored command list"
      },
      {
        "name": "ujdigest",
        "desc": "UI two: daily or weekly digest"
      },
      {
        "name": "ujfeed",
        "desc": "UI two: activity feed"
      },
      {
        "name": "ujfocus",
        "desc": "UI two: focus score"
      },
      {
        "name": "ujforecast",
        "desc": "UI two: projected spend for today"
      },
      {
        "name": "ujgoal",
        "desc": "UI two: goals with due dates"
      },
      {
        "name": "ujkanban",
        "desc": "UI two: kanban board, or add a card"
      },
      {
        "name": "ujnotice",
        "desc": "UI two: notification center"
      },
      {
        "name": "ujpomo",
        "desc": "UI two: pomodoro timer"
      },
      {
        "name": "ujpresent",
        "desc": "UI two: presentation view"
      },
      {
        "name": "ujprint",
        "desc": "UI two: plain print view"
      },
      {
        "name": "ujprompt",
        "desc": "UI two: shareable prompt library"
      },
      {
        "name": "ujreplay",
        "desc": "UI two: session replay"
      },
      {
        "name": "ujreset",
        "desc": "UI two: clear recorded data"
      },
      {
        "name": "ujspend",
        "desc": "UI two: spend, budget and forecast view"
      },
      {
        "name": "ujview",
        "desc": "UI two: open a view of the pane"
      }
    ],
    "features": [
      {
        "id": "record-activity",
        "label": "Record tool calls",
        "description": "Keep a bounded list of tool calls, edits, errors and file paths (this mod's own copy, local only) for the feed, table, timeline, treemap, graph and replay.",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "record-prompts",
        "label": "Record prompt counts",
        "description": "Keep each prompt's length and kind (never its text) for the feed and daily counters.",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "record-spend",
        "label": "Record spend samples",
        "description": "Sample the session cost estimate for daily spend, the budget guard and the forecast.",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "record-turns",
        "label": "Record turns",
        "description": "Keep each turn's model name, duration and cost delta, and measure prompts sent from your library.",
        "default": true,
        "group": "Recording"
      },
      {
        "id": "prompt-excerpts",
        "label": "Keep prompt excerpts",
        "description": "Also keep the first 80 characters of each prompt for the feed and print view. Off keeps lengths only.",
        "default": false,
        "group": "Recording"
      },
      {
        "id": "command-bar",
        "label": "Command bar",
        "description": "An input at the top of the pane that filters your stored commands and fills the prompt box.",
        "default": true,
        "group": "Pane"
      },
      {
        "id": "popover-menu",
        "label": "Actions menu",
        "description": "The inline Actions menu under a button at the top of the pane.",
        "default": true,
        "group": "Pane"
      },
      {
        "id": "svg-charts",
        "label": "Vector charts (desktop)",
        "description": "Draw the overview, timeline, treemap and graph as vector images with hover tooltips on the desktop app. Off keeps text charts.",
        "default": true,
        "group": "Pane"
      },
      {
        "id": "presentation",
        "label": "Presentation view",
        "description": "The masked, figures-only presentation view.",
        "default": true,
        "group": "Pane"
      },
      {
        "id": "notice-log",
        "label": "Notification center log",
        "description": "Log the budget warnings, due goals, finished pomodoros and digests this mod raises into the Notices view (no toast).",
        "default": true,
        "group": "Alerts"
      },
      {
        "id": "budget-warn-80",
        "label": "Budget toast at 80%",
        "description": "A toast when today's spend reaches 80 percent of the daily allowance. Never blocks anything.",
        "default": false,
        "group": "Alerts"
      },
      {
        "id": "budget-warn-100",
        "label": "Budget toast at 100%",
        "description": "A toast when today's spend reaches 100 percent of the daily allowance. Never blocks anything.",
        "default": false,
        "group": "Alerts"
      },
      {
        "id": "goal-toasts",
        "label": "Goal due toast",
        "description": "A toast when a goal's due time passes.",
        "default": false,
        "group": "Alerts"
      },
      {
        "id": "pomo-toast",
        "label": "Pomodoro end toast",
        "description": "A toast when a pomodoro or break ends.",
        "default": false,
        "group": "Alerts"
      },
      {
        "id": "digest-morning",
        "label": "Morning digest toast",
        "description": "One toast with yesterday's figures at the first session start of a morning.",
        "default": false,
        "group": "Alerts"
      },
      {
        "id": "live-timer",
        "label": "Live pomodoro countdown",
        "description": "Redraw the countdown each second while a pomodoro runs. Static when motion is off or settings are calm.",
        "default": false,
        "group": "Effects"
      }
    ]
  },
  {
    "name": "visuals",
    "version": "0.2.0",
    "description": "Real vector dashboards for the desktop app: smooth animated rings, sparklines, bars and heat strips drawn as SVG, with a static version for reduced motion",
    "help": "vis",
    "helpDesc": "Open the vector dashboard pane",
    "category": "charts",
    "deps": [
      "motion",
      "settings"
    ],
    "hasDeps": true,
    "cmds": [
      {
        "name": "vis",
        "desc": "Open the vector dashboard pane"
      },
      {
        "name": "visdemo",
        "desc": "Fill the dashboard with made-up sample data: /visdemo on|off"
      },
      {
        "name": "visreset",
        "desc": "Clear what the dashboard recorded"
      }
    ],
    "features": []
  },
  {
    "name": "workbench",
    "version": "0.1.0",
    "description": "Live session dashboard, changed-files, notes and timer panes, context band with quick replies, and /standup",
    "help": "dashboard",
    "helpDesc": "Open the live session dashboard pane",
    "category": "layout",
    "deps": [],
    "hasDeps": false,
    "cmds": [
      {
        "name": "dashboard",
        "desc": "Open the live session dashboard pane"
      },
      {
        "name": "budget",
        "desc": "Set a spend alert in dollars: /budget <usd> (or /budget off)"
      },
      {
        "name": "files",
        "desc": "Open the changed-files pane"
      },
      {
        "name": "focus",
        "desc": "Toggle focus mode: hides the band above the prompt"
      },
      {
        "name": "note",
        "desc": "Save a note: /note <text>"
      },
      {
        "name": "notes",
        "desc": "Open the notes pane"
      },
      {
        "name": "sessionrecap",
        "desc": "Summarize this session as standup notes"
      },
      {
        "name": "timer",
        "desc": "Start a timer: /timer <minutes> (or /timer off)"
      }
    ],
    "features": []
  }
]
