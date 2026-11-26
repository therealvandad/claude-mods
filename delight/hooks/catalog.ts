// GENERATED at build time by reading every mod folder next to this one (plugin.json and hook sources).
// A runtime check of which mods are installed is not possible, so this is the marketplace folder as it was on the build date.
export type CatalogCommand = { name: string; desc: string }
export type CatalogMod = { name: string; description: string; version: string; help: string | null; commands: CatalogCommand[] }

export const BUILT_ON = "2026-11-25"

export const CATALOG: readonly CatalogMod[] = [
  {
    "name": "alerts",
    "description": "One quiet notifier for this mod's notices: priority levels, digest, snooze, quiet hours, per-category mute, history, waiting-on-you band, deadline, cost, rate-limit, context, idle, disk and network alerts (all /al commands)",
    "version": "0.1.0",
    "help": "al",
    "commands": [
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
        "desc": "Mute one of this mod's notice categories: /almute <name> (toggles) | clear. Cannot silence other mods"
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
    ]
  },
  {
    "name": "animations",
    "description": "Fourteen state-driven terminal animations (heartbeat, context tank, coin drop, sparkline draw-in, sliding tab underline, error shake, commit confetti, flip clock, badge flash, sky strip, skeleton shimmer, conveyor queue, ink-spread edits, ambient waves) on one shared ticker, with a lab pane and /anim",
    "version": "0.1.0",
    "help": "anim",
    "commands": [
      {
        "name": "anim",
        "desc": "Animations: /anim | demo | lab | timer <minutes> | badge <text> | skeleton"
      }
    ]
  },
  {
    "name": "cockpit",
    "description": "One tabbed cockpit pane (overview, tool timeline, files, todo, history, errors, links, palette) plus a git/spend band, forecasts, shelves and pins",
    "version": "0.1.0",
    "help": "cockpit",
    "commands": [
      {
        "name": "cfocus",
        "desc": "Hide or show only the cockpit bands"
      },
      {
        "name": "cockpit",
        "desc": "Open the cockpit pane: /cockpit [overview|timeline|files|todo|history|errors|links|palette]"
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
    ]
  },
  {
    "name": "controls",
    "description": "Trust and transparency: what every mod can do, outbound-host and folder ledgers, rule tester, temporary allow, per-project profiles, incident mode and a guard self-test, around tool-guard and safety-pro",
    "version": "0.1.0",
    "help": "ct",
    "commands": [
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
    ]
  },
  {
    "name": "debug-kit",
    "description": "Debugging helpers: failing-test focus, bisect guide, stack-trace explainer, repro recorder, flaky/coverage/timing/snapshot test insights, log tail, error clusters, hypothesis board, breadcrumbs, env snapshot, port finder, mock map, crash-loop and regression guards, postmortem draft",
    "version": "0.1.0",
    "help": "db",
    "commands": [
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
    ]
  },
  {
    "name": "delight",
    "description": "Small delights, all off by default except the gallery and /dl help: theme and sound of the week, fortune cookies, mini-games, pet wardrobe preview, milestone postcards, rare compliments, mod gallery, tour, changelog and usage heat (/dl lists the commands)",
    "version": "0.1.0",
    "help": "dl",
    "commands": [
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
    ]
  },
  {
    "name": "extras",
    "description": "Screen-share masking, away digest, smart alerts, prompt linter, session health, per-tool cost, replay scrubber, command cheatsheet, auto-title and a read-only snapshot browser",
    "version": "0.1.0",
    "help": "cheats",
    "commands": [
      {
        "name": "alerts",
        "desc": "Desktop alert when a turn over 60 s ends: /alerts on | off | test"
      },
      {
        "name": "cheats",
        "desc": "Every slash command the mods add, as buttons that fill the prompt box"
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
        "desc": "Screen-share mode: /present on | off (masks home, user, emails, secrets and project paths on screen only)"
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
    ]
  },
  {
    "name": "git-kit",
    "description": "Read-only git helpers: commit-style learner, branch names, PR drafts, changelog, status map, merge preview, stash/worktree/submodule views, repo health and merge readiness. Every command starts with gk.",
    "version": "0.1.0",
    "help": "gk",
    "commands": [
      {
        "name": "gk",
        "desc": "/gk"
      },
      {
        "name": "gkblame",
        "desc": "/gkblame <file>"
      },
      {
        "name": "gkbranch",
        "desc": "/gkbranch <task>"
      },
      {
        "name": "gkfixup",
        "desc": "/gkfixup [file...]"
      },
      {
        "name": "gkhealth",
        "desc": "/gkhealth"
      },
      {
        "name": "gkhooks",
        "desc": "/gkhooks"
      },
      {
        "name": "gkignore",
        "desc": "/gkignore [fill]"
      },
      {
        "name": "gklarge",
        "desc": "/gklarge [on|off|<MB>|now]"
      },
      {
        "name": "gklog",
        "desc": "/gklog"
      },
      {
        "name": "gkmerge",
        "desc": "/gkmerge [branch]"
      },
      {
        "name": "gkmsg",
        "desc": "/gkmsg"
      },
      {
        "name": "gkpr",
        "desc": "/gkpr [base]"
      },
      {
        "name": "gkready",
        "desc": "/gkready"
      },
      {
        "name": "gkrelease",
        "desc": "/gkrelease [tick n|add text|del n|clear]"
      },
      {
        "name": "gkremote",
        "desc": "/gkremote [on|off|now]"
      },
      {
        "name": "gkreset",
        "desc": "/gkreset"
      },
      {
        "name": "gksplit",
        "desc": "/gksplit"
      },
      {
        "name": "gkstash",
        "desc": "/gkstash"
      },
      {
        "name": "gkstatus",
        "desc": "/gkstatus"
      },
      {
        "name": "gksub",
        "desc": "/gksub"
      },
      {
        "name": "gktag",
        "desc": "/gktag"
      },
      {
        "name": "gktree",
        "desc": "/gktree"
      }
    ]
  },
  {
    "name": "layout",
    "description": "How things are drawn: zen mode, split view, floating note, sticky headers, collapsible sections, width and density controls, error and long-output banners, icon packs and a colour legend",
    "version": "0.1.0",
    "help": "ly",
    "commands": [
      {
        "name": "ly",
        "desc": ""
      },
      {
        "name": "lychips",
        "desc": ""
      },
      {
        "name": "lycols",
        "desc": ""
      },
      {
        "name": "lycompact",
        "desc": ""
      },
      {
        "name": "lyerr",
        "desc": ""
      },
      {
        "name": "lyicons",
        "desc": ""
      },
      {
        "name": "lylegend",
        "desc": ""
      },
      {
        "name": "lylong",
        "desc": ""
      },
      {
        "name": "lymain",
        "desc": ""
      },
      {
        "name": "lynote",
        "desc": ""
      },
      {
        "name": "lypath",
        "desc": ""
      },
      {
        "name": "lypin",
        "desc": ""
      },
      {
        "name": "lyreset",
        "desc": ""
      },
      {
        "name": "lysplit",
        "desc": ""
      },
      {
        "name": "lystripe",
        "desc": ""
      },
      {
        "name": "lytime",
        "desc": ""
      },
      {
        "name": "lywidth",
        "desc": ""
      },
      {
        "name": "lyzen",
        "desc": ""
      }
    ]
  },
  {
    "name": "learning",
    "description": "Learning tools: glossaries, flashcards with spaced repetition, learning log, reading list, architecture map, skill tracker, explainer prompt-fillers and opt-in mentor, rubber-duck and beginner modes (/ln lists the commands)",
    "version": "0.1.0",
    "help": "ln",
    "commands": [
      {
        "name": "ln",
        "desc": "List every learning command"
      },
      {
        "name": "lnalt",
        "desc": "Fill the prompt: two other ways, with trade-offs"
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
        "name": "lncomplex",
        "desc": "Fill the prompt: explain the time and space complexity"
      },
      {
        "name": "lndiagram",
        "desc": "Fill the prompt: ask for a diagram"
      },
      {
        "name": "lndiff",
        "desc": "Fill the prompt: annotated diff with a one-line reason per change"
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
        "name": "lnpattern",
        "desc": "Fill the prompt: spot the patterns and idioms used"
      },
      {
        "name": "lnpterm",
        "desc": "Per-folder glossary (keyed by the current folder), same forms as /lnterm"
      },
      {
        "name": "lnquiz",
        "desc": "Fill the prompt: three questions about what was built"
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
      },
      {
        "name": "lnwalk",
        "desc": "Fill the prompt: walk through <file> one block at a time"
      },
      {
        "name": "lnwhy",
        "desc": "Fill the prompt: justify the approach taken"
      }
    ]
  },
  {
    "name": "look-and-sound",
    "description": "Sound cues when a turn finishes or fails (the Dusk ink theme is off)",
    "version": "0.1.0",
    "help": null,
    "commands": []
  },
  {
    "name": "looks",
    "description": "A /look picker: no theme by default, then opt-in palettes (paper, nord, solarized, sepia, high contrast, seasons, time of day, per project, per model) and subtle moving backdrops",
    "version": "0.1.0",
    "help": "look",
    "commands": [
      {
        "name": "look",
        "desc": "Pick a look or a moving scene: /look <name>, /look off, /look scene <name>"
      }
    ]
  },
  {
    "name": "motion",
    "description": "Calm motion for the interface: eased gauges, number tickers, status typing and pulse, tool-row shimmer and check pops, spring timer ring, idle breathing, test celebration, and a /motion on|off switch",
    "version": "0.1.0",
    "help": "motion",
    "commands": [
      {
        "name": "motion",
        "desc": "Motion on/off: /motion on|off|demo|timer <minutes>"
      }
    ]
  },
  {
    "name": "notes",
    "description": "Searchable notes archive: per-folder notes with tags, links, snippets, command cookbook, daily journal, reminders, recurring tasks, backup and restore (commands start with nt)",
    "version": "0.1.0",
    "help": "nt",
    "commands": [
      {
        "name": "nt",
        "desc": ""
      },
      {
        "name": "ntattach",
        "desc": "<name> <path> [desc]"
      },
      {
        "name": "ntcmd",
        "desc": "<name> <command>"
      },
      {
        "name": "ntdel",
        "desc": "<id>..."
      },
      {
        "name": "ntevery",
        "desc": "daily|weekly|monthly <text>"
      },
      {
        "name": "ntexport",
        "desc": ""
      },
      {
        "name": "ntfile",
        "desc": "<path>"
      },
      {
        "name": "ntfind",
        "desc": "<text|#tag>"
      },
      {
        "name": "ntfix",
        "desc": ""
      },
      {
        "name": "ntimport",
        "desc": "[replace] <json>"
      },
      {
        "name": "ntjot",
        "desc": "<text>"
      },
      {
        "name": "ntjournal",
        "desc": ""
      },
      {
        "name": "ntkeep",
        "desc": "<days>|off|run"
      },
      {
        "name": "ntlink",
        "desc": "<url> <title>"
      },
      {
        "name": "ntmd",
        "desc": ""
      },
      {
        "name": "ntnotes",
        "desc": "[all|#tag]"
      },
      {
        "name": "ntopen",
        "desc": "[tab]"
      },
      {
        "name": "ntprofile",
        "desc": "save|load|list|del <name>"
      },
      {
        "name": "ntput",
        "desc": "<name>"
      },
      {
        "name": "ntremind",
        "desc": "15:30|in 20 <text>"
      },
      {
        "name": "ntreset",
        "desc": ""
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
        "desc": ""
      },
      {
        "name": "ntterm",
        "desc": "<word> => <replacement>"
      },
      {
        "name": "ntwipe",
        "desc": "confirm"
      }
    ]
  },
  {
    "name": "personality",
    "description": "Quiet, switchable fun: mood status, streaks, badges, a tiny pet, greeting, tip of the day, focus sprints and a weekly report (/fun on|off)",
    "version": "0.1.0",
    "help": "fun",
    "commands": [
      {
        "name": "badges",
        "desc": "List achievement badges and your progress"
      },
      {
        "name": "fun",
        "desc": "Switch the quiet fun on or off: /fun on, /fun off, /fun motion on|off"
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
    ]
  },
  {
    "name": "prompt-tools",
    "description": "Right-click prompt shortcuts, /review, and standing prompt preferences",
    "version": "0.1.0",
    "help": "snip",
    "commands": [
      {
        "name": "audit",
        "desc": "Fill the prompt with a review request for this session"
      },
      {
        "name": "snip",
        "desc": "Snippets: /snip save <name> <text>, /snip <name>, /snip list, /snip rm <name>"
      }
    ]
  },
  {
    "name": "prompting",
    "description": "Prompt craft: templates, context blocks, macros, queue, A/B, scorecard, diff, reword, clean-up, tone and other standing instructions (all off by default). Commands start with pm; /pm lists them.",
    "version": "0.1.0",
    "help": "pm",
    "commands": [
      {
        "name": "pm",
        "desc": ""
      },
      {
        "name": "pmab",
        "desc": "new <A> || <B> | use n a|b | better n a|b [note]"
      },
      {
        "name": "pmask",
        "desc": "on|off"
      },
      {
        "name": "pmassume",
        "desc": "list | clear | fill"
      },
      {
        "name": "pmclean",
        "desc": "[text]"
      },
      {
        "name": "pmctx",
        "desc": "[name]"
      },
      {
        "name": "pmdecide",
        "desc": "<text> | list | rm n | fill"
      },
      {
        "name": "pmdiff",
        "desc": "[a b]"
      },
      {
        "name": "pmexample",
        "desc": "on|off"
      },
      {
        "name": "pmlang",
        "desc": "<language>|off"
      },
      {
        "name": "pmmacro",
        "desc": "add <name> <text> | rm | list"
      },
      {
        "name": "pmmark",
        "desc": "<label> | list | go n | rm n"
      },
      {
        "name": "pmpin",
        "desc": "<rule> | rm n | off"
      },
      {
        "name": "pmq",
        "desc": "add <text> | next | list | rm n | clear"
      },
      {
        "name": "pmquote",
        "desc": "[lines]"
      },
      {
        "name": "pmrec",
        "desc": "on|off"
      },
      {
        "name": "pmreset",
        "desc": "[all]"
      },
      {
        "name": "pmrestore",
        "desc": ""
      },
      {
        "name": "pmreword",
        "desc": "[text] | apply | hint on|off"
      },
      {
        "name": "pmscore",
        "desc": "[text]"
      },
      {
        "name": "pmsum",
        "desc": ""
      },
      {
        "name": "pmtone",
        "desc": "terse|teach|review|off"
      },
      {
        "name": "pmtpl",
        "desc": "[name] [a | b | c]"
      }
    ]
  },
  {
    "name": "review-kit",
    "description": "Review helper for code Claude changes: tickable checklist and 19 heuristic detectors (risky paths, test gaps, complexity, TODOs, dead code, naming, import cycles, API/dependency/config changes, error handling, logging, migrations, performance, accessibility, patch size) in one pane",
    "version": "0.1.0",
    "help": "rk",
    "commands": [
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
    ]
  },
  {
    "name": "safety-pro",
    "description": "Safety and power workflow: dry-run, allowlist, hard budget, loop breaker, protected paths, opt-in checkpoints with confirmed rollback, pre-commit check, auto-compact, handoff note and a block log",
    "version": "0.1.0",
    "help": "safetylog",
    "commands": [
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
        "name": "protect",
        "desc": "Protect paths from Edit and Write: /protect <path> | list | rm <path>"
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
    ]
  },
  {
    "name": "sound-pack",
    "description": "Sound packs (retro, wood, glass) with finish chime, error tones, approval cue, optional ticks, spoken summaries, quiet hours and volume by turn length",
    "version": "0.1.0",
    "help": "sound",
    "commands": [
      {
        "name": "sound",
        "desc": "Sound packs: /sound <retro|wood|glass|silent|off>, ticks, speak, quiet"
      }
    ]
  },
  {
    "name": "tool-guard",
    "description": "Blocks risky tool calls, badges commands by risk, and shows a pass/fail card under test runs",
    "version": "0.1.0",
    "help": "readonly",
    "commands": [
      {
        "name": "readonly",
        "desc": "Toggle read-only mode: blocks file edits and mutating shell commands"
      }
    ]
  },
  {
    "name": "tool-visuals",
    "description": "Richer tool-call rows: risk edge, file glyphs, mini diffs, duration and size chips, network badges and progress, secret masking, retry counts, failing-test and build-error cards",
    "version": "0.1.0",
    "help": "toolvis",
    "commands": [
      {
        "name": "toolvis",
        "desc": "Tool-call visuals: /toolvis on | off | status (secret masking stays on either way)"
      }
    ]
  },
  {
    "name": "workbench",
    "description": "Live session dashboard, changed-files, notes and timer panes, context band with quick replies, and /standup",
    "version": "0.1.0",
    "help": "dashboard",
    "commands": [
      {
        "name": "budget",
        "desc": "Set a spend alert in dollars: /budget <usd> (or /budget off)"
      },
      {
        "name": "dashboard",
        "desc": "Open the live session dashboard pane"
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
    ]
  }
]

// Static looks the looks mod offers (build-time read of its palettes; dynamic looks are left out).
export const LOOK_CHOICES: readonly { id: string; label: string; blurb: string }[] = [
  {
    "id": "autumn",
    "label": "Autumn",
    "blurb": "leaf-brown surfaces, burnt orange accent"
  },
  {
    "id": "snow",
    "label": "Snow",
    "blurb": "blue-white surfaces, ice accent"
  },
  {
    "id": "spring",
    "label": "Spring",
    "blurb": "fresh green surfaces, blossom pink accent"
  },
  {
    "id": "summer",
    "label": "Summer",
    "blurb": "sand surfaces, sea teal accent"
  },
  {
    "id": "paper",
    "label": "Warm paper",
    "blurb": "cream surfaces, ink-blue accent"
  },
  {
    "id": "terminal",
    "label": "Midnight terminal",
    "blurb": "near-black, neon green (dark only)"
  },
  {
    "id": "nord",
    "label": "Nord frost",
    "blurb": "cool grays and blues, code theme nord"
  },
  {
    "id": "solarized",
    "label": "Solarized",
    "blurb": "day and night pair, follows your mode"
  },
  {
    "id": "solarized-day",
    "label": "Solarized day",
    "blurb": "solarized light, always"
  },
  {
    "id": "solarized-night",
    "label": "Solarized night",
    "blurb": "solarized dark, always"
  },
  {
    "id": "sunset",
    "label": "Sunset",
    "blurb": "accent drifts amber to violet through the day"
  },
  {
    "id": "contrast",
    "label": "High contrast",
    "blurb": "black and white, stronger borders and focus rings"
  },
  {
    "id": "muted",
    "label": "Muted dark",
    "blurb": "neutral grays, one steel-blue accent"
  },
  {
    "id": "sepia",
    "label": "Sepia",
    "blurb": "low blue light reading mode"
  },
  {
    "id": "colorblind",
    "label": "Colorblind safe",
    "blurb": "blue for success, orange for errors"
  }
]
