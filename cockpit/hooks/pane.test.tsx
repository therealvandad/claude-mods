import { expect, test } from 'claude-code/testing'

import {
  barHero,
  commandCard,
  daysCard,
  errorsCard,
  fieldsCard,
  filesCard,
  fit,
  historyRow,
  linkRow,
  paneWidth,
  pinRow,
  searchCard,
  shelfRow,
  textW,
  timelineCard,
  titleCard,
  todoCard,
  wrap,
} from './panesvg'
import type { PaneLook, Picture } from './panesvg'
import { vecDashSvg } from './vecdash'

// ------------------------------------------------------------------ checks

/** A strict enough XML reader: every tag is well formed and closed, and text holds no stray < or &. */
const checkXml = (svg: string): string => {
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y
  const stack: string[] = []
  let at = 0
  let roots = 0

  while (at < svg.length) {
    if (svg[at] === '<') {
      tag.lastIndex = at
      const m = tag.exec(svg)

      if (m === null) {
        return `bad tag at ${at}: ${svg.slice(at, at + 80)}`
      }
      const [whole, closing, name = '', attrs = '', selfClosing] = m
      const names = [...attrs.matchAll(/\s([\w:-]+)="/g)].map(x => x[1])

      if (new Set(names).size !== names.length) {
        return `repeated attribute in <${name}>: ${whole.slice(0, 120)}`
      }

      // Only markup can do harm: the same words inside a text node are just words.
      if (/^(script|foreignObject|image|a|iframe)$/i.test(name) || /\s(on[a-z]+|href|xlink:href)=|javascript:|url\((?!#)/i.test(attrs)) {
        return `unsafe markup: ${whole.slice(0, 120)}`
      }

      if (closing === '/') {
        if (stack.pop() !== name) {
          return `mismatched </${name}> at ${at}`
        }
      } else {
        roots += stack.length === 0 ? 1 : 0

        if (selfClosing !== '/') {
          stack.push(name)
        }
      }
      at += whole.length
    } else {
      const next = svg.indexOf('<', at)
      const piece = svg.slice(at, next < 0 ? svg.length : next)

      if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(piece)) {
        return `stray & in: ${piece.slice(0, 60)}`
      }

      // Characters XML does not allow at all.
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff￾￿]/u.test(piece)) {
        return `forbidden character in: ${JSON.stringify(piece.slice(0, 60))}`
      }
      at += piece.length
    }
  }

  return stack.length > 0 ? `unclosed: ${stack.join(' ')}` : roots === 1 ? '' : `${roots} roots`
}

const fine = (source: string) => {
  expect(checkXml(source)).toBe('')
  expect(source).not.toMatch(/="[^"<>]*"[A-Za-z]/)
  expect(source).not.toMatch(/NaN|undefined|Infinity|\[object/)
  expect(source).not.toMatch(/<script/i)
  expect(source.length).toBeLessThan(40_000)
  expect(source).toMatch(/^<svg [^>]*width="\d+" height="\d+"/)

  for (const [, size] of source.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) {
    expect(Number(size)).toBeGreaterThanOrEqual(10)
  }

  // Every gradient or clip that is referred to is in the same picture.
  for (const [, id] of source.matchAll(/url\(#([\w-]+)\)/g)) {
    expect(source).toContain(`id="${id}"`)
  }
}

/** Fine, and drawn at exactly the size it is shown. */
const sized = (p: { source: string; alt: string; width: number; height: number }, max: number) => {
  fine(p.source)
  expect(p.alt.length).toBeGreaterThan(0)
  expect(p.width).toBeGreaterThan(0)
  expect(p.height).toBeGreaterThan(0)
  expect(p.width).toBeLessThanOrEqual(max)
  expect(p.source).toContain(`viewBox="0 0 ${p.width} ${p.height}" width="${p.width}" height="${p.height}"`)
}

// ------------------------------------------------------------------ a stand-in engine

const NASTY = '<a b="c">&\'" </svg><script>x</script> \u0000\u0007 😀😀 ]]> 漢字漢字 averyveryveryveryveryveryveryveryverylongunbrokenwordaveryveryveryveryveryveryvery'
const TABS = ['overview', 'timeline', 'files', 'todo', 'history', 'errors', 'links', 'palette', 'bar'] as const

type World = {
  filled: string[]
  copied: string[]
  reads: string[]
  runs: number
  saved: Record<string, unknown>
  clock: { t: number }
}

const world = (on: (...args: any[]) => unknown, branch = 'main'): World => {
  const w: World = { filled: [], copied: [], reads: [], runs: 0, saved: { view: { look: 'rich' } }, clock: { t: 100_000 } }

  on('clock.now', () => ({ value: w.clock.t }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', (_: unknown, e: { text: string }) => {
    w.copied.push(e.text)

    return { value: { isCopied: true } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: w.saved[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    w.saved[e.key] = e.value

    return { value: undefined }
  })
  on('process.run', () => {
    w.runs += 1

    return { value: { exitCode: 0, stdout: `## ${branch}...origin/main [ahead 2]\n M a.ts\n`, stderr: '' } }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, percent: 40 },
      rateLimits: [{ kind: 'five_hour', percentUsed: Math.min(99, w.clock.t / 10_000) }],
      cost: { usd: w.clock.t / 100_000 },
    },
  }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    w.filled.push(e.text)

    return { isFilled: true }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('state.get', (_: unknown, e: any, next: any) => {
    w.reads.push(`${e.plugin}.${e.key}`)

    return next(e)
  })

  return w
}

const START = { cwd: '/work/demo', surface: 'desktop', isInteractive: true } as const
const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
const command = (name: string, args: string) => ({ command: name, args, origin: 'user' }) as any

const pane = (surface: 'desktop' | 'terminal', columns = 80, rows = 40) =>
  ({
    plugin: 'cockpit',
    component: 'Pane',
    requestId: 'cockpit',
    surface,
    viewport: { columns: 160, rows },
    props: { title: 'Cockpit', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} },
  }) as any

const svgs = async (ui: any): Promise<Picture[]> => (await ui.findAll({ type: 'Svg' })).map((n: any) => n.props as Picture)
const keys = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Button' })).map((n: any) => String(n.key)).sort()

/** Fills every tab, with whatever text is asked for, far past what fits on one screen. */
const busy = async ($: any, w: World, label: string, n: number) => {
  await $.session.start(START)

  for (let i = 0; i < n; i += 1) {
    w.clock.t += 1000
    await $.prompt.submit({ text: `${label} prompt ${i} https://example.com/p/${i}?q=a&b=${'x'.repeat(i % 3 === 0 ? 300 : 3)}`, wait: false, origin: { kind: 'composer' } })
    await $.tool.call({ tool: 'Edit', file_path: `/work/demo/src/dir${i % 9}/${label}-${i}.ts`, old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: `fail ${label} ${i}` })
    await $.command.run(command('ctodo', `${label} todo ${i}`))
  }

  for (let i = 0; i < 6; i += 1) {
    w.clock.t += 60_000
    await $.turn.complete(done)
  }
  await $.command.run(command('cshelf', `add ${label} snippet`))
  await $.command.run(command('cpin', `${label} pin`))
  await $.command.run(command('csearch', 'prompt'))
  await $.command.run(command('bar', `note ${label}`))
  await $.command.run(command('bar', `goal ${label}`))
  await $.command.run(command('bar', `button add ${label.slice(0, 12)} = go`))
}

const failing = (on: (...args: any[]) => unknown, text: string) =>
  on('tool.call', (_: unknown, e: { tool: string }) =>
    e.tool === 'Bash' ? { isError: true, result: 'exit 1', text } : { result: {}, text: 'ok' },
  )

// ------------------------------------------------------------------ every tab

test('every tab draws well formed pictures with nothing at all to show', async ($, on) => {
  world(on)
  await $.session.start(START)

  for (const columns of [30, 52, 70, 80, 140]) {
    const ui = await $.ui.mount(pane('desktop', columns))

    for (const id of TABS) {
      await ui.press({ key: `tab-${id}` })
      const all = await svgs(ui)
      expect(all.length).toBeGreaterThan(0)

      for (const p of all) {
        sized(p, paneWidth(columns))
      }
    }
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('every tab survives hostile text and long lists', async ($, on) => {
  const w = world(on, '<b>"&\'br')
  failing(on, `${NASTY} boom https://example.com/e`)
  await busy($, w, NASTY.slice(0, 90), 45)

  for (const columns of [44, 80]) {
    const ui = await $.ui.mount(pane('desktop', columns, 200))

    for (const id of TABS) {
      await ui.press({ key: `tab-${id}` })
      const all = await svgs(ui)
      expect(all.length).toBeGreaterThan(0)

      for (const p of all) {
        sized(p, paneWidth(columns))
      }
    }
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('long lists are capped and say how many more there are', async ($, on) => {
  const w = world(on)
  failing(on, 'boom')
  await busy($, w, 'x', 45)
  const ui = await $.ui.mount(pane('desktop', 80, 200))

  await ui.press({ key: 'tab-timeline' })
  expect((await svgs(ui)).at(-1)?.source).toMatch(/\+50 earlier/)
  await ui.press({ key: 'tab-errors' })
  expect((await svgs(ui)).at(-1)?.source).toMatch(/\+20 older/)
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()

  // A short pane shows fewer folders, and says how many files that leaves out.
  const small = await $.ui.mount(pane('desktop', 80, 20))
  await small.press({ key: 'tab-files' })
  expect((await svgs(small)).at(-1)?.source).toMatch(/\+\d+ more/)
  await small.press({ key: 'tab-overview' })
  await small.unmount()
})

test('no action is lost: each tab has the same buttons on the desktop as on the terminal', async ($, on) => {
  const w = world(on)
  failing(on, 'boom')
  await busy($, w, 'x', 14)

  for (const rows of [20, 60]) {
    const desk = await $.ui.mount(pane('desktop', 80, rows))
    const term = await $.ui.mount(pane('terminal', 80, rows))

    for (const id of TABS) {
      await desk.press({ key: `tab-${id}` })
      expect(await keys(desk)).toEqual(await keys(term))
      expect(await term.findAll({ type: 'Svg' })).toHaveLength(0)
    }
    await desk.press({ key: 'tab-overview' })
    await desk.unmount()
    await term.unmount()
  }
})

// ------------------------------------------------------------------ tab by tab

test('timeline: a ribbon per call with its duration, failures and running calls named', async ($, on) => {
  const w = world(on)
  on('tool.call', (_: unknown, e: { tool: string }) => {
    w.clock.t += 2500

    return e.tool === 'Bash' ? { isError: true, result: 'x', text: 'boom' } : { result: {}, text: 'ok' }
  })
  await $.session.start(START)
  await $.tool.call({ tool: 'Read', file_path: '/work/demo/a.ts' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-timeline' })
  const [card] = await svgs(ui)
  expect(card?.alt).toMatch(/Tool timeline, 5\.0s window: Read 2\.5s, Bash failed 2\.5s/)
  expect(card?.source).toContain('fill="url(#g-ok)"')
  expect(card?.source).toContain('fill="url(#g-bad)"')
  expect(card?.source).toContain('failed · 2.5s')
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

test('files: bold names, folder lines and edit-count pills', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start(START)

  for (const file of ['/work/demo/src/a.ts', '/work/demo/src/a.ts', '/work/demo/docs/readme.md']) {
    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' })
  }
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-files' })
  const [card] = await svgs(ui)
  expect(card?.alt).toMatch(/2 files, 3 edits under \/work\/demo/)
  expect(card?.source).toContain('>docs/<')
  expect(card?.source).toContain('>src/<')
  expect(card?.source).toMatch(/class="rb">a\.ts</)
  expect(card?.source).toMatch(/>x2</)
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

test('todo: a progress ring above buttons that still tick and clear', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run(command('ctodo', 'one'))
  await $.command.run(command('ctodo', 'two'))
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-todo' })
  expect((await svgs(ui))[0]?.alt).toMatch(/2 open of 2, 0 percent done\. Next: one/)
  await ui.press({ key: 'todo-1' })
  expect((await svgs(ui))[0]?.alt).toMatch(/1 open of 2, 50 percent done\. Next: two/)
  expect((await svgs(ui))[0]?.source).toContain('>50%<')
  await ui.press({ key: 'todo-clear' })
  expect((w.saved.ctodos as unknown[]).length).toBe(1)
  expect((await svgs(ui))[0]?.alt).toMatch(/1 open of 1/)
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

test('history: a row per prompt with use and pin beside it, then search and days', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'write the changelog', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-history' })
  const alts = (await svgs(ui)).map(p => p.alt)
  expect(alts).toContain('Prompt 1: write the changelog')
  expect(alts.join('\n')).toMatch(/Use \/csearch text/)
  expect(alts.join('\n')).toMatch(/Days: \d{4}-\d\d-\d\d 1 session, 0 calls, \$/)
  await ui.press({ key: 'histpin-0' })
  expect(w.saved.cpins).toEqual(['write the changelog'])
  expect((await svgs(ui)).map(p => p.alt)).toContain('Prompt 1, pinned: write the changelog')
  await ui.press({ key: 'hist-0' })
  expect(w.filled).toEqual(['write the changelog'])
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

test('errors: the cause comes first on a red-edged card', async ($, on) => {
  world(on)
  failing(on, 'permission denied while opening the socket')
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'serve' })
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-errors' })
  const [card] = await svgs(ui)
  const source = card?.source ?? ''
  expect(source).toContain('stroke="url(#g-bad)"')
  expect(source.indexOf('permission denied')).toBeGreaterThan(0)
  expect(source.indexOf('permission denied')).toBeLessThan(source.indexOf('>Bash<'))
  expect(card?.alt).toMatch(/Errors: 1\. permission denied while opening the socket \(Bash: serve\)/)
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

test('links: rows with copy, and the shelf with use and drop', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: {}, text: 'see https://example.com/docs/page' }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.command.run(command('cshelf', 'add first snippet'))
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-links' })
  const all = await svgs(ui)
  expect(all.map(p => p.alt)).toContain('https://example.com/docs/page')
  expect(all.map(p => p.source).join('')).toMatch(/>example\.com<[\s\S]*>\/docs\/page</)
  expect(all.map(p => p.alt)).toContain('Shelf 1: first snippet')
  await ui.press({ key: 'link-0' })
  await ui.press({ key: 'shelf-0' })
  expect(w.copied).toEqual(['https://example.com/docs/page'])
  expect(w.filled).toEqual(['first snippet'])
  await ui.press({ key: 'shelfrm-0' })
  expect(w.saved.shelf).toEqual([])
  expect((await svgs(ui)).map(p => p.alt).join('\n')).toMatch(/Empty\. \/cshelf add/)
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

test('palette: a card per group of commands, each command still one press', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-palette' })
  const alts = (await svgs(ui)).map(p => p.alt).join('\n')

  for (const group of ['Cockpit: /cockpit', 'Guard: /readonly', 'Claude Code: /compact']) {
    expect(alts).toContain(group)
  }
  await ui.press({ key: 'cmd-/ctodo' })
  await ui.press({ key: 'cmd-/readonly' })
  expect(w.filled).toEqual(['/ctodo ', '/readonly'])
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

test('bar: section cards that follow the settings, with the same switches', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'tab-bar' })
  const alts = async () => (await svgs(ui)).map(p => p.alt).join('\n')
  expect(await alts()).toMatch(/Bar settings: size normal, theme glass, quiet off/)
  expect(await alts()).toMatch(/^Live: 0 of 10 on$/m)
  await ui.press({ key: 'bar-item-timer' })
  expect(await alts()).toMatch(/^Live: 1 of 10 on$/m)
  expect(await ui.find({ key: 'bar-left-timer' })).toBeDefined()
  await ui.press({ key: 'bar-quiet-toggle' })
  expect(await alts()).toMatch(/quiet on/)
  expect(await alts()).toMatch(/Your text: Note: none \(\/bar note text\)/)
  expect((w.saved[Object.keys(w.saved).find(k => k.startsWith('bar:')) ?? ''] as { quiet: boolean }).quiet).toBe(true)
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

// ------------------------------------------------------------------ themes, motion, cost

test('the /bar theme applies to every picture of the pane', async ($, on) => {
  const w = world(on)
  failing(on, 'boom')
  await busy($, w, 'x', 3)
  const marks = { midnight: '--top:#16213f', paper: '--top:#fdf9ee', neon: '--top:#0b0714', glass: '@media (prefers-color-scheme:dark){:root{--top:#2a2a33' } as const

  for (const [theme, mark] of Object.entries(marks)) {
    await $.command.run(command('bar', `theme ${theme}`))
    const ui = await $.ui.mount(pane('desktop'))

    for (const id of TABS) {
      await ui.press({ key: `tab-${id}` })

      for (const p of await svgs(ui)) {
        expect(p.source).toContain(mark)

        if (theme !== 'glass') {
          expect(p.source).not.toContain('prefers-color-scheme')
        }
      }
    }
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('the entrance plays once, only the Overview moves, and nothing loops', async ($, on) => {
  const w = world(on)
  failing(on, 'boom')
  await busy($, w, 'x', 3)
  const ui = await $.ui.mount(pane('desktop'))
  // The search above left the History tab open; this is the Overview being shown.
  await ui.press({ key: 'tab-overview' })
  // The pin sits above it, so the Overview's picture is the last one.
  const overview = async () => (await svgs(ui)).at(-1)?.source ?? ''
  const first = await overview()
  expect(first).toMatch(/@keyframes sweep/)
  expect(first).not.toContain('infinite')

  // Something changes later: the picture is redrawn still.
  w.clock.t += 60_000
  await $.tool.call({ tool: 'Read', file_path: '/work/demo/a.ts' })
  expect(await overview()).not.toMatch(/@keyframes|animation:/)

  for (const id of TABS.slice(1)) {
    await ui.press({ key: `tab-${id}` })

    for (const p of await svgs(ui)) {
      expect(p.source).not.toMatch(/@keyframes|animation|<animate/)
      expect((p as any).isInteractive).toBeUndefined()
    }
  }
  // Coming back is an entrance again.
  await ui.press({ key: 'tab-overview' })
  expect(await overview()).toMatch(/@keyframes sweep/)
  await ui.unmount()
})

test('a tab reads only what it shows, and drawing starts no process', async ($, on) => {
  const w = world(on)
  failing(on, 'boom')
  await busy($, w, 'x', 2)
  const ui = await $.ui.mount(pane('desktop'))
  const runs = w.runs
  const read = async (id: string) => {
    await ui.press({ key: 'tab-palette' })
    w.reads.length = 0
    await ui.press({ key: `tab-${id}` })

    return [...new Set(w.reads)].filter(k => !['cockpit.tab', 'cockpit.now', 'cockpit.sessionStart', 'cockpit.pins', 'cockpit.barConfig', 'cockpit.view'].includes(k)).sort()
  }
  expect(await read('timeline')).toEqual(['cockpit.calls'])
  expect(await read('files')).toEqual(['cockpit.edits'])
  expect(await read('todo')).toEqual(['cockpit.todos'])
  expect(await read('errors')).toEqual(['cockpit.errors'])
  expect(await read('history')).toEqual(['cockpit.daily', 'cockpit.prompts', 'cockpit.search'])
  expect(await read('links')).toEqual(['cockpit.links', 'cockpit.shelf'])
  expect(w.runs).toBe(runs)
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

// ------------------------------------------------------------------ the drawing functions alone

test('every card is well formed with hostile, empty and impossible values', () => {
  const nan = Number.NaN

  for (const theme of ['glass', 'midnight', 'paper', 'neon'] as const) {
    for (const width of [360, 483, 600]) {
      const look: PaneLook = { width, theme }
      const many = Array.from({ length: 200 }, (_, i) => i)
      const cards: Picture[] = [
        timelineCard([], NASTY, 0, look),
        timelineCard(many.map(i => ({ tool: NASTY, detail: NASTY, off: i % 2 === 0 ? nan : 7, len: i % 3 === 0 ? nan : -1, state: (['ok', 'bad', 'run'] as const)[i % 3]!, duration: NASTY })), NASTY, nan, look),
        filesCard({ root: '', groups: [], files: 0, edits: 0 }, look),
        filesCard({ root: NASTY, groups: many.map(() => ({ dir: NASTY, files: [{ name: NASTY, n: nan }, { name: NASTY, n: 1e12 }] })), files: 400, edits: nan }, look),
        todoCard({ done: 0, total: 0, next: '', hidden: 0 }, look),
        todoCard({ done: nan, total: 5, next: NASTY, hidden: -4 }, look),
        todoCard({ done: 9, total: 3, next: '', hidden: 2 }, look),
        titleCard(NASTY.slice(0, 20), NASTY, look),
        titleCard('Links', '0', look, NASTY),
        pinRow(NASTY, 220, look),
        historyRow({ n: nan, prompt: NASTY, time: '', isPinned: true }, 240, look),
        linkRow(`https://${'h'.repeat(200)}.example/<>"&`, 300, look),
        linkRow('', 300, look),
        shelfRow({ n: 1e12, snippet: NASTY }, 260, look),
        searchCard('', [], look),
        searchCard(NASTY, [], look),
        searchCard(NASTY, many.map(() => `error: ${NASTY}`), look),
        daysCard([], look),
        daysCard(many.map(() => ({ day: NASTY, sessions: nan, calls: -1, usd: Number.POSITIVE_INFINITY })), look),
        errorsCard([], 0, look),
        errorsCard(many.map(() => ({ tool: NASTY, detail: NASTY, reason: NASTY.repeat(3), time: '' })), nan, look),
        errorsCard([{ tool: '', detail: '', reason: '', time: '' }], 0, look),
        commandCard(NASTY.slice(0, 20), many.map(() => [NASTY, NASTY] as const), look),
        barHero({ name: 'bar', size: 'normal', theme, quiet: false, on: nan }, look),
        fieldsCard('Your text', many.map(() => [NASTY.slice(0, 10), NASTY.repeat(4)] as const), look),
      ]

      for (const p of cards) {
        sized(p, width)
      }
      fine(
        vecDashSvg(
          {
            contextPct: nan,
            spendUsd: 1e12,
            costSamples: many.map(() => nan),
            ctxSamples: many.map(i => i * 9),
            limits: many.map(() => ({ kind: NASTY, pct: nan, forecast: { text: NASTY.repeat(4), isUrgent: true } })),
            tests: many.map(i => ({ ok: i % 2 === 0 })),
            tools: { [NASTY]: 5, Bash: nan },
            stats: { prompts: nan, tools: 1e12, files: -1, errors: 3 },
            git: { branch: NASTY, ahead: nan, behind: -2, dirty: 1e12 },
          },
          { accent: NASTY, animate: true, width, theme },
        ),
      )
      fine(vecDashSvg({ contextPct: null, spendUsd: null, costSamples: [], ctxSamples: [], limits: [], tests: [], tools: {}, git: null }, { accent: 'suggestion', animate: false, width: nan, theme }))
    }
  }
  // The checker itself catches what it is there for.
  expect(checkXml('<svg><rect a="1"b="2"/></svg>')).not.toBe('')
  expect(checkXml('<svg><script></script></svg>')).not.toBe('')
  expect(checkXml('<svg><rect onload="x"/></svg>')).not.toBe('')
  expect(checkXml('<svg><text>a & b</text></svg>')).not.toBe('')
})

test('text is cut and wrapped to the room it has', () => {
  expect(paneWidth(undefined)).toBe(560)
  expect(paneWidth(10)).toBe(360)
  expect(paneWidth(500)).toBe(600)
  expect(fit('short', 200)).toBe('short')
  const cut = fit('a rather long sentence that cannot fit', 80)
  expect(cut.endsWith('…')).toBe(true)
  expect(textW(cut)).toBeLessThanOrEqual(80)
  expect(fit('/very/long/folder/path/name', 80, {}, true).startsWith('…')).toBe(true)
  // An emoji is never cut in half.
  expect(/[\ud800-\udfff]/u.test(fit('😀'.repeat(40), 100))).toBe(false)
  const lines = wrap('one two three four five six seven eight nine ten eleven twelve', 90, 3)
  expect(lines).toHaveLength(3)
  expect(lines.every(l => textW(l) <= 90)).toBe(true)
  expect(wrap('x'.repeat(100), 60, 2).every(l => textW(l) <= 60)).toBe(true)
  expect(wrap('', 60, 2)).toEqual([])
})
