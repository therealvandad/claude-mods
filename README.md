# claude-mods

49 mods for the Claude desktop app's Code tab and Claude Code. This is an unofficial hobby project, not affiliated with or endorsed by Anthropic.

**Read before installing.** A mod is code that runs inside your session with your permissions: it can see tool calls and prompts, and some run commands such as `git`. Read a mod's code before you install it. These mods were written with Claude and have had little real-world use.

## Install

Run in a Claude Code session:

```
/plugin install cockpit --marketplace therealvandad/claude-mods
```

Start with the set below. `cockpit` needs `motion` and `settings`; install those too if they are not added for you.

## The set in daily use

| Mod | What it does | Tests |
| --- | --- | --- |
| `cockpit` | One tabbed cockpit pane (overview, tool timeline, files, todo, history, errors, links, palette) plus a git/spend band, forecasts, shelves and pins | 92 |
| `helpers` | Quiet helpers: plain-words approvals, delete preview, secret and commit guards, changes and steps panels, time and cost under replies, welcome-back summary, right-click extras, notes and /quietmode | 11 |
| `motion` | Calm motion for the interface: eased gauges, number tickers, status typing and pulse, tool-row shimmer and check pops, spring timer ring, idle breathing, test celebration, and a /motion on\|off switch | 24 |
| `settings` | Shared look-and-feel settings (accent, density, icons, preset) that other mods can read; /cfg to change them | 45 |
| `mod-manager` | Front door for a collection of mods and other Claude plugins: catalog, installed list, bundles, remote update check, and install/enable/disable/update/uninstall command lines you can copy or run after a two-step confirm | 104 |
| `tool-guard` | Blocks risky tool calls, badges commands by risk, and shows a pass/fail card under test runs | 3 |
| `safety-pro` | Safety and power workflow: dry-run, allowlist, hard budget, loop breaker, protected paths, opt-in checkpoints with confirmed rollback, pre-commit check, auto-compact, handoff note and a block log | 11 |
| `controls` | Trust and transparency: what every mod can do, outbound-host and folder ledgers, rule tester, temporary allow, per-project profiles, incident mode and a guard self-test, around tool-guard and safety-pro | 33 |
| `control-kit` | Control surface for the other mods: one master quiet switch with exact restore, panic and safe mode, pause or snooze a mod for a while, previews and two-step confirms for bulk changes, undo, a read-only lock, a command palette, a permission summary, an audit log, a Bash block list, row pinning and ordering (/kc) | 79 |

### What `cockpit` adds

- A chat look: `/bar chat roomy|clean|off`
- Color themes: `/bar colors paper|midnight|contrast|app`
- Right-click a reply or selected text: explain simpler, shorter, how to test it, pin it
- Notes under rows (tested or not tested edits, why a command failed, how long a slow one has run): `/bar rows on|off`
- A step line under the working row while Claude has a task list
- A one-line row above the message box, and a Home panel: `/cockpit`
- Hide its row and pop-ups: `/clean`

### What `helpers` adds

- A plain-words line under permission prompts, and what a delete would remove
- Holds a prompt that looks like it contains a key, and a commit that would include `.env` or key files
- `/changes` (diffs, commit message request, your test command), `/steps`, `/mynotes`
- Under replies: time and cost, a summary after long tasks, and Claude's closing question
- Right-click extras and your own actions: `/shortcut add <name> = <what to ask>`
- `/helpers` switches parts on and off; `/quietmode` hides the extras

## Everything else

These are extras. Many overlap, and installing them all at once makes the app cluttered.

| Mod | What it does | Tests |
| --- | --- | --- |
| `add-kit` | Project and code companion: repo scorecard, test/flaky/coverage/build/error trends, TODO board, command history, snippets, dependency and hygiene checks, ports and processes, log tail, distraction log, meeting and presentation modes. Read-only shell only. Every command starts with ad. | 82 |
| `add-two` | Git graph, release notes and changelog, PR checklist, docs search, disk usage, onboarding and cheatsheets, plus learning tools (paths, flashcards, quiz, glossary), design logs, handoff pack, mod ratings, theme gallery and a sharing guide. Read-only shell, no network. Every command starts with ae. | 89 |
| `alerts` | One quiet notifier for this mod's notices: priority levels, digest, snooze, quiet hours, per-category mute, history, waiting-on-you band, deadline, cost, rate-limit, context, idle, disk and network alerts (all /al commands) | 43 |
| `anim-extra` | Settings hub pane (every mod's help command, presets, enable/disable list, aliases, band order), extra animations (skeleton, ripple, urgent edge glow, day-night strip, reduced-motion previews), and customizing: language, thresholds, file glyphs, alert rule builder, recipes, mod ratings (all /ax commands) | 68 |
| `anim-more` | Twenty more calm, state-driven terminal animations (pop-in hint, breathing glow, underline draw, button squish, staged toast, wave, spinners, typewriter, marquee, pulsing badge, spend drip, growing plant, rain, fireworks, balloons, page flip, dial, pendulum, walking pet, rocket) on one shared ticker, with a lab pane at /aylab and /ay | 69 |
| `animations` | Fourteen state-driven terminal animations (heartbeat, context tank, coin drop, sparkline draw-in, sliding tab underline, error shake, commit confetti, flip clock, badge flash, sky strip, skeleton shimmer, conveyor queue, ink-spread edits, ambient waves) on one shared ticker, with a lab pane and /anim | 42 |
| `assist` | Quiet helpers that fill the prompt box and never send: next-step chips, stuck detector, explain-error chip, retry, context compressor, smart paste label, file finder, command recall, recap, pre/post-flight checklists, bug-report and handoff drafts, reading time, skimmer, question bank, shortcut coach, error museum and fix library (all /as commands) | 54 |
| `assist-more` | More helpers: environment doctor, project card, run-books, time estimates, split and decide helpers, risk and typo nudges, undo guide, plain-language mode, contrast checker, profiles, quiet hours, own sounds, sprite and goals. Every command starts with am (/am lists them). | 35 |
| `band-tidy` | Tidies the area above the prompt: keeps a short list of rows, hides the rest, and lets you choose with /tidy | 5 |
| `charts` | Twenty text charts (donut gauges, 24h clock, treemap, heatmap, Gantt, flame, mini-map, radar, scatter, burndown and more) in one tabbed pane, drawn with block, braille and box characters from this session's recorded tool calls | 74 |
| `charts-more` | More text charts (histogram, box plot, context ring, thermometer, fuel gauge, speedometer, battery, tag cloud, note network, folder tree, area, candlestick, pie bar, before/after slider) in one picker pane, with quiet state-driven animations | 34 |
| `control-two` | Quick controls and diagnostics: toggles for motion, calm, sounds and recording, row visibility rules, backups and restore of your feature switches, a two-step reset, read-only update checks, health lights, error log, hook timing and order, storage meter, command conflicts, dependency graph, changelog, diagnostics text and notes per mod (prefix kx) | 80 |
| `custom-two` | Customizing, part two: colours per file type, a branch accent, event sounds, greetings and tips, empty states and pane titles, date ranges, saved filters and searches, report templates and exports, a hotkey map, a theme from a logo colour, icon sets, easing curves, a look schedule, focus modes, do-not-disturb, row-hiding rules, bundles, a checklist, a glossary and macros | 67 |
| `debug-kit` | Debugging helpers: failing-test focus, bisect guide, stack-trace explainer, repro recorder, flaky/coverage/timing/snapshot test insights, log tail, error clusters, hypothesis board, breadcrumbs, env snapshot, port finder, mock map, crash-loop and regression guards, postmortem draft | 47 |
| `delight` | Small delights, all off by default except the gallery and /dl help: theme and sound of the week, fortune cookies, mini-games, pet wardrobe preview, milestone postcards, rare compliments, mod gallery, tour, changelog and usage heat (/dl lists the commands) | 47 |
| `extras` | Screen-share masking, away digest, smart alerts, prompt linter, session health, per-tool cost, replay scrubber, command cheatsheet, auto-title and a read-only snapshot browser | 31 |
| `finish-kit` | A style studio: live vector previews of finishes (grays, tones, surfaces, type, data palettes, icons) on sample cards, and commands that apply a finish with one theme call. Nothing is applied until you type a command | 62 |
| `git-kit` | Read-only git helpers: commit-style learner, branch names, PR drafts, changelog, status map, merge preview, stash/worktree/submodule views, repo health and merge readiness. Every command starts with gk. | 55 |
| `layout` | How things are drawn: zen mode, split view, floating note, sticky headers, collapsible sections, width and density controls, error and long-output banners, icon packs and a colour legend | 31 |
| `layout-kit` | A customizable dashboard builder: one pane of tiles (calls, errors, files, spend, context, time, todos and your own text, number and formula tiles) with named pages, saved and per-project layouts, snippets, aliases, templates, rules, badges and goals. Affects only its own pane. | 87 |
| `learning` | Learning tools: glossaries, flashcards with spaced repetition, learning log, reading list, architecture map, skill tracker, explainer prompt-fillers and opt-in mentor, rubber-duck and beginner modes (/ln lists the commands) | 25 |
| `look-and-sound` | Sound cues when a turn finishes or fails (the Dusk ink theme is off) | none |
| `looks` | A /look picker: no theme by default, then opt-in palettes (paper, nord, solarized, sepia, high contrast, seasons, time of day, per project, per model) and subtle moving backdrops | 18 |
| `notes` | Searchable notes archive: per-folder notes with tags, links, snippets, command cookbook, daily journal, reminders, recurring tasks, backup and restore (commands start with nt) | 39 |
| `personality` | Quiet, switchable fun: mood status, streaks, badges, a tiny pet, greeting, tip of the day, focus sprints and a weekly report (/fun on\|off) | 37 |
| `prefs` | A second set of shared preferences (formats, language, time zone, toasts, charts, data, per-mod tables) that other mods can read from one atom, with formatting helpers, a Preferences pane, import and export, undo, per-project and per-branch layers, and work/home/demo profiles; /pf | 156 |
| `progress` | Progress and achievement: goals with a daily bar, weekly ring and confetti, milestone ladder, XP, streak calendar with freeze days, projects and checklists, learning, skill tree, habits, personal bests, journal, focus and momentum, backlog, ship log and test metrics (all /pg commands) | 38 |
| `progress-more` | Progress extras in one pane: quality trend, review bar, refactor/migration/upgrade trackers, test debt, docs coverage, cleanup meter, intentions, wrap/plan/win/share cards, season goals, and your own tips, prompt templates, toast rules, retention, tiles and number formats | 39 |
| `prompt-tools` | Right-click prompt shortcuts, /audit, and standing prompt preferences | none |
| `prompting` | Prompt craft: templates, context blocks, macros, queue, A/B, scorecard, diff, reword, clean-up, tone and other standing instructions (all off by default). Commands start with pm; /pm lists them. | 31 |
| `review-kit` | Review helper for code Claude changes: tickable checklist and 19 heuristic detectors (risky paths, test gaps, complexity, TODOs, dead code, naming, import cycles, API/dependency/config changes, error handling, logging, migrations, performance, accessibility, patch size) in one pane | 30 |
| `skins` | A palette and style library you apply on demand with /skuse: 15 named palettes, an accent picker, contrast steps, rounded or square corners, glass cards and a paper grain. Nothing is applied by default | 42 |
| `skins-plus` | More looks, opt-in only: cyber, cozy night, high-visibility, print, weekday, per-project and per-branch tints, a look scheduler, sunrise accent, custom roles, theme import/export, dyslexia and large-type settings, a custom status line template | 32 |
| `sound-pack` | Sound packs (retro, wood, glass) with finish chime, error tones, approval cue, optional ticks, spoken summaries, quiet hours and volume by turn length | 16 |
| `style-gallery` | A design-system gallery: one pane with 30 labelled style samples (radius, elevation, badges, toasts, modes, navigation patterns) drawn as vector images on the desktop and as text elsewhere, with /sgcopy to put a short written spec of any style in the prompt box | 61 |
| `tool-visuals` | Richer tool-call rows: risk edge, file glyphs, mini diffs, duration and size chips, network badges and progress, secret masking, retry counts, failing-test and build-error cards | 17 |
| `ui-kit` | Six views over what this session did (timeline, files treemap, errors, prompts, spend, activity) in one switchable pane: real vector charts on the desktop app, text charts elsewhere, with split view, master-detail, mini and widget modes, breakpoints, accordions, a stepper, optimistic updates and undo | 98 |
| `ui-two` | One pane with a view switcher: command bar, popover menu, activity feed, timeline, kanban, table, cards, calendar, treemap, graph, compare, replay, notices, print and presentation views, budget guard with rollover, forecast, prompt library with stats, model log, digest, goals, pomodoro and focus score | 60 |
| `visuals` | Real vector dashboards for the desktop app: smooth animated rings, sparklines, bars and heat strips drawn as SVG, with a static version for reduced motion | 12 |
| `workbench` | Live session dashboard, changed-files, notes and timer panes, context band with quick replies, and /sessionrecap | 3 |

## Status

- Built and tested on macOS with Claude Code 2.1.330. Other systems are untested.
- 2258 automated tests across 47 mods pass; 2 mods have no tests. Tests do not paint the screen, so a passing mod can still look wrong in the app.
- The safety mods (`tool-guard`, `safety-pro`, `controls`, `control-kit`) and the guards in `helpers` are aids, **not a security boundary**. Do not rely on them to stop a harmful command.
- The marketplace is named `local-mods`.

## Check a mod yourself

```
claude plugin validate <mod folder>
claude plugin test <mod folder>
```

## Third-party files

The `make-colors.js` and `make-colors.d.ts` files inside some mods come from Claude Code's mod kit and keep their original terms.

## License

MIT, see [LICENSE](LICENSE). The third-party files above are not covered by it.
