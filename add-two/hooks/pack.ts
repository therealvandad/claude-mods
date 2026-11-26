// Static data and pure builders for the project tab group and the mods tab group: the 8 theme palettes (DATA),
// the sharing guide, docs search, the onboarding outline, the cheatsheet parsers and the handoff pack. No `$`.
import type { CheatItem, Decision, Line } from '../types'
import { clip, note, plural } from './gitparse'

// ------------------------------------------------------------------ 299 theme gallery (data only)

export type Palette = {
  id: string
  label: string
  blurb: string
  /** Six raw hex swatches: page, card, text, accent, good, warning. A preview, not the real theme. */
  sw: readonly [string, string, string, string, string, string]
  look?: string
  skuse?: string
}

export const PALETTES: readonly Palette[] = [
  { id: 'paper', label: 'Warm paper', blurb: 'cream surfaces, ink-blue accent', sw: ['#f6f1e6', '#fbf8f1', '#2b2a27', '#2f5d8c', '#4e7d3a', '#a86f14'], look: 'paper' },
  { id: 'nord', label: 'Nord frost', blurb: 'cool grays and blues', sw: ['#2e3440', '#3b4252', '#eceff4', '#88c0d0', '#a3be8c', '#ebcb8b'], look: 'nord' },
  { id: 'terminal', label: 'Midnight terminal', blurb: 'near-black with neon green', sw: ['#05080a', '#0b1115', '#d7ffe3', '#39ff7a', '#7ee787', '#f3c13a'], look: 'terminal' },
  { id: 'sunset', label: 'Sunset', blurb: 'amber drifting to violet', sw: ['#1d1426', '#2a1c36', '#f6e8da', '#ff9f43', '#7ed6a5', '#f6c453'], look: 'sunset' },
  { id: 'ocean', label: 'Ocean', blurb: 'sea-glass blues and teal', sw: ['#07151d', '#0c1e29', '#e2f2fa', '#1d7fa6', '#2f8f6a', '#b07a18'], skuse: 'ocean' },
  { id: 'forest', label: 'Forest', blurb: 'moss greens, warm wood', sw: ['#0d1812', '#13211a', '#e3f3e8', '#3f7d4f', '#4f8f3a', '#a87a1c'], skuse: 'forest' },
  { id: 'amber', label: 'Amber screen', blurb: 'phosphor amber on black', sw: ['#0c0900', '#161000', '#ffd98a', '#ffb000', '#9ccc65', '#ff8f00'], skuse: 'amber' },
  { id: 'blueprint', label: 'Blueprint', blurb: 'white lines on drafting blue', sw: ['#0b2a4a', '#103457', '#e8f1fb', '#7fb8ff', '#8fe3b0', '#ffd479'], skuse: 'blueprint' },
]

export const HEX = /^#[0-9a-fA-F]{6}$/

export const paletteCommands = (p: Palette): { label: string; text: string }[] => [
  ...(p.look !== undefined ? [{ label: `/look ${p.look}`, text: `/look ${p.look}` }] : []),
  ...(p.skuse !== undefined ? [{ label: `/skuse ${p.skuse}`, text: `/skuse ${p.skuse}` }] : []),
]

export const themeLines = (): Line[] => [
  note('Theme gallery: 8 palettes (swatches are previews drawn from raw hex values)', 'suggestion'),
  ...PALETTES.map(p => note(`  ${p.id.padEnd(10)} ${p.label.padEnd(18)} ${p.blurb}   ${paletteCommands(p).map(c => c.text).join('  ')}`)),
  note('This mod applies nothing. A button fills the prompt with the command of the mod that owns the theme (/look or /skuse); it does nothing if that mod is not installed.', 'inactive'),
]

// ------------------------------------------------------------------ 300 sharing guide

export const shareLines = (): Line[] => [
  note('Sharing a mod through GitHub (a guide: this mod runs no git write, no push and no network request)', 'suggestion'),
  note(''),
  note('Status: publishing is a manual step for you. Nothing has been or will be published from here.', 'warning'),
  note(''),
  note('1. Safety scan checklist, before anything leaves your computer', 'suggestion'),
  note('   [ ] No API keys, tokens, passwords or .env files anywhere in the mod folder'),
  note('   [ ] No internal hostnames, URLs or customer / employer names in code, tests or text'),
  note('   [ ] No other people\'s data (recorded prompts, store dumps, sample files)'),
  note('   [ ] No symbolic links, no .git folder copied in, no .log or editor backup files'),
  note('   [ ] Tests pass and `claude plugin validate <mod folder>` says Validation passed'),
  note('   [ ] The README says what the mod reads and writes, and that it makes no network calls'),
  note(''),
  note('2. Make the repository yourself on github.com (public: anyone can read and install; private: only people you invite)', 'suggestion'),
  note('   Put the mod folder in it with .claude-plugin/marketplace.json listing the mod:'),
  note('   { "name": "<marketplace>", "owner": { "name": "<you>" }, "plugins": [{ "name": "<mod>", "source": "./" }] }'),
  note(''),
  note('3. Others add the marketplace and install, with your placeholders filled in', 'suggestion'),
  note('   claude plugin marketplace add <owner>/<repo>'),
  note('   claude plugin install <mod> --marketplace <owner>/<repo>'),
  note('   In a terminal session: /plugin install <mod> --marketplace <owner>/<repo>'),
  note('   A private repository installs only for people who can read it on GitHub and have a git credential for github.com.'),
  note(''),
  note('Replace <owner>, <repo> and <mod> with your own values. The mod manager and the plugin-authoring skill can scan for secrets first.', 'inactive'),
]

// ------------------------------------------------------------------ 287 docs search

const SECRET_NAME = /(^|[._-])(env|secret|secrets|credential|credentials|token|tokens|password|passwords|passwd|apikey|api-key|id_rsa|id_ed25519|private|privatekey|npmrc|netrc|pypirc|keystore)([._-]|$)|\.(pem|key|p12|pfx|kdbx|jks|crt)$/i

export const isSecretName = (name: string): boolean => SECRET_NAME.test(name)

export const isDocName = (name: string): boolean => /^README([._-].*)?$/i.test(name) && !/\.(png|jpe?g|gif|svg|pdf|zip)$/i.test(name)

export type DocHit = { path: string; heading: string; why: string }

export const firstHeading = (text: string): string => {
  const lines = text.split('\n').slice(0, 80)

  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] as string).trim()
    const m = /^#{1,6}\s+(.+?)\s*#*$/.exec(l)

    if (m !== null) return clip(m[1], 100)

    if (/^(=+|-+)\s*$/.test((lines[i + 1] ?? '').trim()) && l !== '' && i + 1 < lines.length && (lines[i + 1] ?? '').trim().length >= 3) return clip(l, 100)
  }

  return ''
}

export const searchDocs = (docs: readonly { path: string; heading: string }[], query: string): DocHit[] => {
  const q = query.trim().toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)

  return docs
    .map(d => {
      const name = d.path.toLowerCase()
      const head = d.heading.toLowerCase()
      const inName = words.length > 0 && words.every(w => name.includes(w))
      const inHead = words.length > 0 && words.every(w => head.includes(w))

      return { ...d, why: words.length === 0 ? '' : inName && inHead ? 'name + heading' : inName ? 'name' : inHead ? 'heading' : '' }
    })
    .filter(d => words.length === 0 || d.why !== '')
}

export const docLines = (hits: readonly DocHit[], query: string, skipped: readonly string[], total: number): Line[] => {
  const out: Line[] = [note(query.trim() === '' ? `Docs: ${plural(hits.length, 'file')} (README* and docs/*.md, names and first headings)` : `Docs matching "${clip(query, 40)}": ${plural(hits.length, 'file')} of ${total}`, 'suggestion')]

  if (hits.length === 0) out.push(note('Nothing matched. Only file names and first headings are searched, not the text.', 'warning'))

  for (const h of hits.slice(0, 40)) out.push(note(`  ${h.path}${h.heading !== '' ? `  -  ${h.heading}` : ''}${h.why !== '' ? `   (${h.why})` : ''}`))

  if (skipped.length > 0) out.push(note(`Skipped (secret-like name, never opened): ${skipped.slice(0, 6).join(', ')}`, 'warning'))
  out.push(note('Read-only: at most 40 files, 32 KB read per file.', 'inactive'))

  return out
}

// ------------------------------------------------------------------ 297 cheatsheet parsers

const NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,59}$/

/** The "scripts" object of a package.json, from at most its first 8 KB (a cut file still gives what is complete). */
export const parsePackageScripts = (text: string): { name: string; body: string }[] => {
  const out: { name: string; body: string }[] = []

  try {
    const j = JSON.parse(text) as { scripts?: unknown }

    if (j !== null && typeof j === 'object' && j.scripts !== null && typeof j.scripts === 'object' && !Array.isArray(j.scripts)) {
      for (const [k, v] of Object.entries(j.scripts as Record<string, unknown>)) {
        if (NAME.test(k) && typeof v === 'string') out.push({ name: k, body: clip(v, 80) })
      }

      return out.slice(0, 40)
    }
  } catch {
    // Cut or invalid JSON: fall through to the tolerant scan.
  }
  const block = /"scripts"\s*:\s*\{([^}]*)\}?/.exec(text)

  if (block === null) return out

  for (const m of (block[1] as string).matchAll(/"([^"\\]{1,60})"\s*:\s*"((?:[^"\\]|\\.){0,300})"/g)) {
    if (NAME.test(m[1] as string)) out.push({ name: m[1] as string, body: clip((m[2] as string).replace(/\\"/g, '"'), 80) })
  }

  return out.slice(0, 40)
}

export const parseMakeTargets = (text: string): { name: string; note: string }[] => {
  const out: { name: string; note: string }[] = []
  const seen = new Set<string>()

  for (const line of text.split('\n')) {
    if (line.startsWith('\t') || line.startsWith('#')) continue
    const m = /^([A-Za-z0-9_./ -]+?)\s*:(?![=:])\s*(.*)$/.exec(line)

    if (m === null) continue
    const help = /##\s*(.+)$/.exec(m[2] as string)

    for (const name of (m[1] as string).trim().split(/\s+/)) {
      if (!NAME.test(name) || name.startsWith('.') || name.includes('%') || seen.has(name)) continue
      seen.add(name)
      out.push({ name, note: help !== null ? clip(help[1], 60) : '' })
    }

    if (out.length >= 40) break
  }

  return out
}

const PY_SECTIONS: readonly (readonly [string, string, (n: string) => string])[] = [
  ['project.scripts', 'console script', n => n],
  ['tool.poetry.scripts', 'poetry script', n => n],
  ['tool.pdm.scripts', 'pdm script', n => `pdm run ${n}`],
  ['tool.poe.tasks', 'poe task', n => `poe ${n}`],
]

export const parsePyproject = (text: string): { name: string; cmd: string; kind: string }[] => {
  const out: { name: string; cmd: string; kind: string }[] = []
  let current: (typeof PY_SECTIONS)[number] | undefined

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const sec = /^\[([^\]]+)\]\s*$/.exec(line)

    if (sec !== null) {
      current = PY_SECTIONS.find(s => s[0] === (sec[1] as string).trim())
      continue
    }

    if (current === undefined || line === '' || line.startsWith('#')) continue
    const kv = /^"?([A-Za-z0-9][A-Za-z0-9_.-]{0,59})"?\s*=/.exec(line)

    if (kv !== null) out.push({ name: kv[1] as string, cmd: current[2](kv[1] as string), kind: current[1] })

    if (out.length >= 40) break
  }

  return out
}

export const cheatItems = (pkg: string | undefined, make: string | undefined, py: string | undefined): CheatItem[] => [
  ...(pkg !== undefined ? parsePackageScripts(pkg).map(s => ({ src: 'package.json', name: s.name, cmd: s.name === 'start' || s.name === 'test' ? `npm ${s.name}` : `npm run ${s.name}`, note: s.body })) : []),
  ...(make !== undefined ? parseMakeTargets(make).map(t => ({ src: 'Makefile', name: t.name, cmd: `make ${t.name}`, note: t.note })) : []),
  ...(py !== undefined ? parsePyproject(py).map(p => ({ src: 'pyproject.toml', name: p.name, cmd: p.cmd, note: p.kind })) : []),
].slice(0, 80)

export const cheatLines = (items: readonly CheatItem[], found: readonly string[]): Line[] => {
  if (items.length === 0) {
    return [note(`No commands found${found.length > 0 ? ` in ${found.join(', ')}` : ' (no package.json, Makefile or pyproject.toml here)'}.`, 'warning')]
  }

  return [
    note(`Cheatsheet: ${plural(items.length, 'command')} from ${found.join(', ')}`, 'suggestion'),
    ...items.map(i => note(`  ${i.cmd.padEnd(28)} ${i.note}`)),
    note('Only the first 8 KB of each manifest is read. Nothing is run: the pane buttons copy a command into the prompt box.', 'inactive'),
  ]
}

// ------------------------------------------------------------------ 296 onboarding outline

const NOTABLE: Record<string, string> = {
  'package.json': 'Node project manifest',
  'pyproject.toml': 'Python project manifest',
  'requirements.txt': 'Python dependencies',
  'Cargo.toml': 'Rust crate',
  'go.mod': 'Go module',
  Makefile: 'make targets',
  Dockerfile: 'container build',
  'docker-compose.yml': 'local services',
  'tsconfig.json': 'TypeScript config',
  'CONTRIBUTING.md': 'how to contribute',
  'CHANGELOG.md': 'release history',
  LICENSE: 'license',
  '.github': 'CI workflows and templates',
  src: 'source code',
  lib: 'library code',
  app: 'application code',
  tests: 'tests',
  test: 'tests',
  docs: 'documentation',
  scripts: 'helper scripts',
}

export const onboardingLines = (a: {
  dir: string
  entries: readonly { name: string; kind: string }[]
  readme?: string
  readmeName?: string
  scripts: readonly string[]
  targets: readonly string[]
  skipped: readonly string[]
}): Line[] => {
  const dirs = a.entries.filter(e => e.kind === 'dir').map(e => e.name).sort()
  const files = a.entries.filter(e => e.kind !== 'dir').map(e => e.name).sort()
  const out: Line[] = [note(`Onboarding outline: ${a.dir}`, 'suggestion'), note('')]
  out.push(note('1. What this is', 'suggestion'))

  if (a.readme !== undefined && a.readme.trim() !== '') {
    const h = firstHeading(a.readme)
    const para =
      a.readme
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .find(p => p !== '' && !p.startsWith('#') && !p.startsWith('![') && !p.startsWith('[![') && !/^[=-]+$/.test(p)) ?? ''
    out.push(note(`   ${a.readmeName ?? 'README'}: ${h !== '' ? h : '(no heading)'}`), ...(para !== '' ? [note(`   ${clip(para, 260)}`)] : []))
  } else {
    out.push(note('   No README found or readable here.', 'warning'))
  }
  out.push(note(''), note('2. Layout (top level)', 'suggestion'))

  for (const d of dirs.filter(n => !n.startsWith('.git') || n === '.github').slice(0, 24)) out.push(note(`   ${d}/${NOTABLE[d] !== undefined ? `  - ${NOTABLE[d]}` : ''}`))

  for (const f of files.slice(0, 24)) out.push(note(`   ${f}${NOTABLE[f] !== undefined ? `  - ${NOTABLE[f]}` : ''}`))

  if (dirs.length + files.length > 48) out.push(note(`   … ${dirs.length + files.length - 48} more entries`, 'inactive'))
  out.push(note(''), note('3. How to run things', 'suggestion'))

  if (a.scripts.length > 0) out.push(note(`   package.json scripts: ${a.scripts.slice(0, 16).join(', ')}`))

  if (a.targets.length > 0) out.push(note(`   make targets: ${a.targets.slice(0, 16).join(', ')}`))

  if (a.scripts.length === 0 && a.targets.length === 0) out.push(note('   No scripts or make targets found; look in the README.', 'inactive'))
  out.push(note(''), note('4. Where to start reading', 'suggestion'))
  const start = ['README', 'CONTRIBUTING.md', 'docs', 'src', 'tests'].filter(n => files.some(f => f.startsWith(n)) || dirs.includes(n))
  out.push(note(`   ${start.length > 0 ? start.join('  ->  ') : 'Open the README, then the largest source folder.'}`))

  if (a.skipped.length > 0) out.push(note(`Skipped (secret-like names, never opened): ${a.skipped.slice(0, 6).join(', ')}`, 'warning'))
  out.push(note(''), note('Built from the top-level listing, the first 2 KB of the README and script names. A text outline shown here only; nothing was written.', 'inactive'))

  return out
}

// ------------------------------------------------------------------ 295 handoff pack

export const handoffLines = (a: {
  branch: string
  goals: readonly string[]
  decisions: readonly Decision[]
  todos: readonly { t: string; s: string }[]
  files: readonly string[]
  gitFiles: readonly string[]
  isRecording: { prompts: boolean; edits: boolean; todos: boolean }
  isGit: boolean
}): Line[] => {
  const out: Line[] = [note(`Handoff pack${a.branch !== '' ? ` (branch ${a.branch})` : ''}`, 'suggestion'), note('')]
  out.push(note('Goals', 'suggestion'))

  if (a.goals.length > 0) for (const g of a.goals) out.push(note(`- ${clip(g, 140)}`))
  else out.push(note(a.isRecording.prompts ? '- (no prompts recorded yet)' : '- (switch add-two.record-prompts is off: goals come from your recorded prompts)', 'inactive'))
  out.push(note(''), note('Decisions', 'suggestion'))
  const recent = a.decisions.filter(d => d.status === 'accepted' || d.status === 'proposed').slice(-6)

  if (recent.length > 0) for (const d of recent) out.push(note(`- [${d.status}] ${d.title} (${d.date})`))
  else out.push(note('- (none in /aedecide)', 'inactive'))
  out.push(note(''), note('Open todos', 'suggestion'))
  const open = a.todos.filter(t => t.s !== 'completed')

  if (open.length > 0) for (const t of open.slice(0, 15)) out.push(note(`- [${t.s === 'in_progress' ? '~' : ' '}] ${t.t}`))
  else out.push(note(a.isRecording.todos ? '- (no open todos recorded)' : '- (switch add-two.record-todos is off)', 'inactive'))
  out.push(note(''), note('Changed files', 'suggestion'))
  const files = [...new Set([...a.files, ...a.gitFiles])]

  if (files.length > 0) {
    for (const f of files.slice(0, 30)) out.push(note(`- ${clip(f, 120)}${a.files.includes(f) ? '' : '  (uncommitted, from git status)'}`))

    if (files.length > 30) out.push(note(`- … ${files.length - 30} more`, 'inactive'))
  } else {
    out.push(note(a.isGit ? '- (working tree clean, nothing edited this session recorded)' : '- (not a git repository, and edit recording is off)', 'inactive'))
  }
  out.push(note(''), note('Shown here only: nothing was written to a file. /aepack fill puts it in the prompt box.', 'inactive'))

  return out
}

/** `git status --porcelain=v1` paths (renames take the new name). */
export const parsePorcelain = (out: string): string[] =>
  out
    .split('\n')
    .map(l => /^.{2} (.+)$/.exec(l)?.[1])
    .filter((p): p is string => p !== undefined)
    .map(p => (p.includes(' -> ') ? (p.split(' -> ').pop() as string) : p).replace(/^"|"$/g, ''))
    .slice(0, 100)
