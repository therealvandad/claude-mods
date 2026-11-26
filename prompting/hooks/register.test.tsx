import { expect, mock, test } from 'claude-code/testing'

type Fill = { text: string; mode: string; cursor?: number }

type Box = {
  registered: string[]
  refuse: string[]
  toasts: string[]
  fills: Fill[]
  draft: string
  messages: { role: 'user' | 'assistant'; text: string; toolUses: unknown[] }[]
  submitted: { text: string; context?: readonly string[] }[]
  isFilled: boolean
}

const newBox = (): Box => ({ registered: [], refuse: [], toasts: [], fills: [], draft: '', messages: [], submitted: [], isFilled: true })

const wire = (on: (...args: any[]) => unknown, box: Box) => {
  on('command.register', (_: unknown, e: { name: string }) => {
    if (box.refuse.includes(e.name)) {
      throw new Error('name taken')
    }
    box.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    box.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.read', () => ({ value: { text: box.draft, cursor: box.draft.length } }))
  on('prompt.fill', (_: unknown, e: Fill) => {
    box.fills.push({ text: e.text, mode: e.mode, ...(e.cursor === undefined ? {} : { cursor: e.cursor }) })

    return { isFilled: box.isFilled, text: e.text, cursor: e.text.length }
  })
  on('prompt.edit', (_: unknown, e: { text: string; inputText: string }) => ({ text: e.text + e.inputText, cursor: 0 }))
  on('session.messages', () => ({ value: box.messages }))
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    box.submitted.push({ text: e.text, ...(e.context === undefined ? {} : { context: e.context }) })

    return { text: e.text }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  on('turn.complete', () => ({ text: '' }))
}

const cmd = ($: any, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })

const send = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

const FACTS = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] }

const sections = async ($: any) => ((await $.prompt.compose(FACTS)) as { sections: { id: string; text: string }[] }).sections

const standing = async ($: any) => (await sections($)).find(s => s.id === 'prompting:standing')?.text

const done = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }) as any

const PANE = {
  plugin: 'prompting',
  component: 'Pane',
  requestId: 'prompting',
  surface: 'desktop',
  props: { title: 'Prompting', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as any

const BAND = {
  plugin: 'prompting',
  surface: 'desktop',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as any

// The kit's `$` carries events only, so the store is a plain object the test reads back.
const stored: Record<string, unknown> = {}

const wireStore = (on: (...args: any[]) => unknown, entries: Record<string, unknown>) => {
  for (const key of Object.keys(stored)) {
    delete stored[key]
  }
  Object.assign(stored, JSON.parse(JSON.stringify(entries)))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: stored[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(stored[e.key])) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    delete stored[e.key]

    return { value: undefined }
  })
}

const setup = async ($: any, on: any, entries: Record<string, unknown> = {}) => {
  const box = newBox()
  wire(on, box)
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  wireStore(on, entries)
  await start($)

  return { box, clock }
}

// ------------------------------------------------------------------ session start and help

test('session start registers all 23 commands, each starting with pm, and survives a refused name', async ($, on) => {
  const box = newBox()
  wire(on, box)
  mock.clock(on, { now: 1000 })
  wireStore(on, {})
  box.refuse = ['pmq']
  await start($)

  expect(box.registered.length).toBe(22)
  expect(box.registered.every(n => n === 'pm' || n.startsWith('pm'))).toBe(true)
  expect(box.registered).toContain('pmtpl')
  expect(box.toasts.some(t => /\/pmq could not be registered/.test(t))).toBe(true)
})

test('/pm lists every command and shows that every standing instruction is off by default', async ($, on) => {
  const { box } = await setup($, on)
  const names = box.registered.slice()
  const help = (await cmd($, 'pm')).text as string

  for (const name of names) {
    expect(help).toContain(`/${name}`)
  }
  expect(help).toContain('tone: off   question-first: off   language: off   example-first: off')
  expect(help).toContain('pinned constraints: none')
  expect(box.toasts).toEqual([])
  expect(await standing($)).toBeUndefined()
  expect((await sections($)).map(s => s.id)).toEqual(['intro'])
})

test('a standing instruction stored by an earlier session is announced once at start', async ($, on) => {
  const { box } = await setup($, on, { 'prompting.modes': { tone: 'terse', ask: false, lang: '', example: false, rec: true, hints: true } })

  expect(box.toasts.some(t => /standing instructions on \(tone terse\)/.test(t))).toBe(true)
  expect(await standing($)).toContain('Tone preset (terse)')
})

// ------------------------------------------------------------------ 4, 5, 19, 20, 14: standing instructions

test('4, 5, 19, 20: each switch adds its own line to the system prompt and off removes it', async ($, on) => {
  await setup($, on)

  expect((await cmd($, 'pmtone', 'terse')).text).toMatch(/Tone preset "terse" is on/)
  expect(await standing($)).toContain('Tone preset (terse)')
  await cmd($, 'pmtone', 'review')
  expect(await standing($)).toContain('Tone preset (review)')
  expect(await standing($)).not.toContain('(terse)')
  expect((await cmd($, 'pmtone', 'nonsense')).text).toMatch(/Tone preset: review\. Usage/)
  await cmd($, 'pmtone', 'off')
  expect(await standing($)).toBeUndefined()

  await cmd($, 'pmask', 'on')
  expect(await standing($)).toContain('at most three short clarifying questions')
  await cmd($, 'pmexample', 'on')
  expect(await standing($)).toContain('Example-first mode')
  await cmd($, 'pmlang', 'Brazilian Portuguese')
  expect(await standing($)).toContain('reply in Brazilian Portuguese')
  expect((await cmd($, 'pmlang', '12345')).text).toMatch(/Usage/)

  const help = (await cmd($, 'pm')).text as string
  expect(help).toContain('tone: off   question-first: on   language: Brazilian Portuguese   example-first: on')

  await cmd($, 'pmask', 'off')
  await cmd($, 'pmexample', 'off')
  await cmd($, 'pmlang', 'off')
  expect(await standing($)).toBeUndefined()
  expect((stored['prompting.modes'] as any).lang).toBe('')
})

test('14: a pin shows above the prompt only while pinned and rides in the system prompt', async ($, on) => {
  await setup($, on)

  let band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^pinned$/ })).toBeUndefined()
  await band.unmount()

  expect((await cmd($, 'pmpin', 'never touch the migrations folder')).text).toMatch(/Pinned/)
  expect(await standing($)).toContain('- never touch the migrations folder')

  band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^pinned$/ })).toBeDefined()
  expect((await band.find({ type: 'Text', text: /migrations/ }))?.text).toContain('never touch the migrations folder')
  await band.press({ key: 'prompting-unpin' })
  expect(await band.find({ type: 'Text', text: /^pinned$/ })).toBeUndefined()
  await band.unmount()
  expect(await standing($)).toBeUndefined()

  for (const rule of ['a', 'b', 'c']) {
    await cmd($, 'pmpin', rule)
  }
  expect((await cmd($, 'pmpin', 'd')).text).toMatch(/Three pins at most/)
  await cmd($, 'pmpin', 'rm 2')
  expect(((await cmd($, 'pmpin')).text as string)).toContain('2. c')
  await cmd($, 'pmpin', 'off')
  expect((await cmd($, 'pmpin')).text).toMatch(/No pinned/)
})

// ------------------------------------------------------------------ 1: templates

test('1: /pmtpl fills blanks in order, puts the caret on the first blank, and keeps user templates', async ($, on) => {
  const { box } = await setup($, on)

  await cmd($, 'pmtpl', 'bug')
  expect(box.fills.at(-1)).toEqual({ text: 'Bug in ___, expected ___, got ___.', mode: 'replace', cursor: 7 })

  await cmd($, 'pmtpl', 'bug login page | a redirect')
  expect(box.fills.at(-1)?.text).toBe('Bug in login page, expected a redirect, got ___.')
  expect(box.fills.at(-1)?.cursor).toBe('Bug in login page, expected a redirect, got '.length)

  expect((await cmd($, 'pmtpl', 'nope')).text).toMatch(/No template "nope"/)
  expect((await cmd($, 'pmtpl', 'add hotfix Hotfix ___ now, then ___.')).text).toMatch(/2 blanks/)
  expect((await cmd($, 'pmtpl', 'add bad!name x')).text).toMatch(/Usage/)
  await cmd($, 'pmtpl', 'hotfix auth')
  expect(box.fills.at(-1)?.text).toBe('Hotfix auth now, then ___.')
  expect((stored['prompting.tpls'] as any).hotfix).toBe('Hotfix ___ now, then ___.')
  expect((await cmd($, 'pmtpl', 'list')).text).toContain('hotfix (yours)')
  expect((await cmd($, 'pmtpl', 'rm bug')).text).toMatch(/Built-in/)
  await cmd($, 'pmtpl', 'rm hotfix')
  expect((await cmd($, 'pmtpl', 'hotfix')).text).toMatch(/No template/)

  // A draft in the box is never replaced.
  box.draft = 'half a thought'
  await cmd($, 'pmtpl', 'test')
  expect(box.fills.at(-1)?.mode).toBe('append')
  expect(box.fills.at(-1)?.text.startsWith('\n\nWrite tests')).toBe(true)
})

// ------------------------------------------------------------------ 3: context blocks

test('3: an attached context block goes with the next prompt only, and the band says so', async ($, on) => {
  const { box } = await setup($, on)

  expect((await cmd($, 'pmctx')).text).toMatch(/No context blocks yet/)
  await cmd($, 'pmctx', 'add style Use two spaces. No semicolons.')
  expect((await cmd($, 'pmctx', 'nothere')).text).toMatch(/No context "nothere"/)
  expect((await cmd($, 'pmctx', 'style')).text).toMatch(/will be sent with your next prompt/)

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^context$/ })).toBeDefined()
  expect((await band.find({ type: 'Text', text: /style/ }))?.text).toBe('style')
  await band.unmount()

  await send($, 'tidy up utils.ts')
  expect(box.submitted.at(-1)?.text).toBe('tidy up utils.ts')
  expect(box.submitted.at(-1)?.context).toEqual(['<context name="style">\nUse two spaces. No semicolons.\n</context>'])

  await send($, 'and again')
  expect(box.submitted.at(-1)?.context).toBeUndefined()

  // Toggle on and off, from the pane too.
  await cmd($, 'pmctx', 'style')
  expect((await cmd($, 'pmctx', 'style')).text).toMatch(/detached/)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-library' })
  await ui.press({ key: 'ctx-style' })
  expect(((await cmd($, 'pmctx')).text as string)).toContain('[attached] style')
  await ui.unmount()
  await cmd($, 'pmctx', 'off')
  expect(((await cmd($, 'pmctx')).text as string)).not.toContain('[attached]')
  await cmd($, 'pmctx', 'rm style')
  expect((await cmd($, 'pmctx', 'show style')).text).toMatch(/No context/)
})

// ------------------------------------------------------------------ 9: macros

test('9: //name at the start of a prompt expands when sent; commands and plugin prompts are left alone', async ($, on) => {
  const { box } = await setup($, on)

  expect((await cmd($, 'pmmacro')).text).toMatch(/No macros yet/)
  expect((await cmd($, 'pmmacro', 'add t Answer tersely, no preamble.')).text).toMatch(/Saved \/\/t/)
  expect((await cmd($, 'pmmacro', 'add bad!name x')).text).toMatch(/Usage/)
  expect(((await cmd($, 'pmmacro', 'list')).text as string)).toContain('//t: Answer tersely')

  await send($, '//t why is the sky blue')
  expect(box.submitted.at(-1)?.text).toBe('Answer tersely, no preamble.\n\nwhy is the sky blue')
  await send($, '//zz stays as typed')
  expect(box.submitted.at(-1)?.text).toBe('//zz stays as typed')

  await $.prompt.submit({ text: '//t from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } })
  expect(box.submitted.at(-1)?.text).toBe('//t from a plugin')

  await cmd($, 'pmmacro', 'rm //t')
  await send($, '//t gone')
  expect(box.submitted.at(-1)?.text).toBe('//t gone')
})

// ------------------------------------------------------------------ 2, 6: history, scorecard, diff

test('2, 6: sent prompts are scored privately and compared word by word; secrets and commands are not kept', async ($, on) => {
  const { box } = await setup($, on)

  await send($, 'fix stuff somehow')
  await send($, 'Fix the null check in `src/auth.ts` so that refresh() returns early. Only touch that function and keep the tests passing.')
  await send($, 'use key sk-ant-api03-abcdefghijklmnopqrstuvwx for the call')
  await $.prompt.submit({ text: '/pm', command: { name: 'pm', args: '' }, wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'meta nudge', isMeta: true, wait: false, origin: { kind: 'composer' } })

  const rows = (stored['prompting.history']) as any[]
  expect(rows.map(r => r.n)).toEqual([1, 2, 3])
  expect(rows[1].total).toBeGreaterThan(rows[0].total)
  expect(rows[2].text).toBe('use key [hidden] for the call')
  expect(JSON.stringify(rows)).not.toContain('sk-ant-api03')

  // The score never reaches the model: the submit carried only the text.
  expect(box.submitted.every(s => s.context === undefined)).toBe(true)

  const diff = (await cmd($, 'pmdiff', '1 2')).text as string
  expect(diff).toMatch(/^#1 against #2: \+\d+ words, -\d+ words/)
  expect(diff).toContain('Shown in the pane')

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^Scorecard \(private\)$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^Last prompt #3/ }))?.text).toMatch(/Last prompt #3: \d+\/100/)
  expect((await ui.find({ type: 'Text', text: /^#1 to #2:/ }))?.text).toMatch(/^#1 to #2: \+/)
  // Pick two rows in the pane.
  await ui.press({ key: 'hist-3' })
  await ui.press({ key: 'hist-2' })
  expect((await ui.find({ type: 'Text', text: /^#3 to #2:/ }))?.text).toBeDefined()
  await ui.unmount()

  expect((await cmd($, 'pmdiff', '1 99')).text).toMatch(/#99 is not recorded/)
  expect(((await cmd($, 'pmscore')).text as string)).toMatch(/Scorecard is in the pane \(private/)
  expect(((await cmd($, 'pmscore', 'fix it')).text as string)).toMatch(/Scored; the card is in the pane/)
})

test('recording off keeps no history, no draft and no assumptions; /pmreset clears the rest', async ($, on) => {
  const { box, clock } = await setup($, on)

  await cmd($, 'pmrec', 'off')
  await send($, 'a prompt that is not recorded')
  expect((stored['prompting.history']) ?? []).toEqual([])
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: 'dra', cursor: 3, start: 3, end: 3, inputText: 'ft' })
  await clock.advance(4000)
  expect(stored['prompting.draft']).toBeUndefined()
  await $.turn.complete(done('Assuming Node 20.'))
  expect(((await cmd($, 'pmassume')).text as string)).toMatch(/No assumptions seen/)

  await cmd($, 'pmrec', 'on')
  await send($, 'recorded now, in file a.ts')
  await cmd($, 'pmdecide', 'use sqlite')
  await cmd($, 'pmmark', 'start')
  await cmd($, 'pmctx', 'add keepme text')
  await cmd($, 'pmtone', 'terse')
  expect((stored['prompting.history'] as any[]).length).toBe(1)

  expect((await cmd($, 'pmreset')).text).toMatch(/Your library and settings are untouched/)
  expect(stored['prompting.history']).toBeUndefined()
  expect(stored['prompting.draft']).toBeUndefined()
  expect(stored['prompting.decisions']).toBeUndefined()
  expect(stored['prompting.marks']).toBeUndefined()
  expect((stored['prompting.ctxs'] as any).keepme).toBe('text')
  expect(await standing($)).toContain('terse')

  await cmd($, 'pmreset', 'all')
  expect(stored['prompting.ctxs']).toBeUndefined()
  expect(await standing($)).toBeUndefined()
  expect(box.toasts).toEqual([])
})

test('the history is bounded to 40 prompts', async ($, on) => {
  await setup($, on)

  for (let i = 0; i < 45; i += 1) {
    await send($, `prompt number ${i} for src/a.ts`)
  }
  const rows = (stored['prompting.history']) as any[]
  expect(rows.length).toBe(40)
  expect(rows[0].n).toBe(6)
  expect(rows.at(-1).n).toBe(45)
})

// ------------------------------------------------------------------ 15, 7, 18: the draft

test('15: the draft is saved every few seconds, restored with /pmrestore, and secrets and commands are not saved', async ($, on) => {
  const { box, clock } = await setup($, on)
  const type = (text: string) => ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: text.slice(0, -1), cursor: 0, start: 0, end: 0, inputText: text.slice(-1) })

  await type('first draft')
  expect(stored['prompting.draft']).toBeUndefined()
  await clock.advance(3100)
  expect((stored['prompting.draft'] as any).text).toBe('first draft')

  // Typing on inside the window saves the latest text at its end, not on every key.
  await type('first draft, longer')
  await type('first draft, longer still')
  await clock.advance(3100)
  expect((stored['prompting.draft'] as any).text).toBe('first draft, longer still')

  await type('/pmrestore')
  await clock.advance(3100)
  expect((stored['prompting.draft'] as any).text).toBe('first draft, longer still')

  await type('token sk-ant-api03-abcdefghijklmnopqrstuvwx')
  await clock.advance(3100)
  expect((stored['prompting.draft'] as any).text).toBe('first draft, longer still')

  box.draft = ''
  expect((await cmd($, 'pmrestore')).text).toMatch(/Restored the saved draft \(25 characters/)
  expect(box.fills.at(-1)).toEqual({ text: 'first draft, longer still', mode: 'replace' })

  await cmd($, 'pmreset')
  expect((await cmd($, 'pmrestore')).text).toMatch(/No saved draft/)
})

test('7: a long draft earns one quiet toast, and /pmreword offers a structured version without a model call', async ($, on) => {
  const { box, clock } = await setup($, on)
  const long =
    'Hi, could you please look at the checkout flow. The cart total is wrong when a coupon is applied twice. You must not change the public API. ' +
    'Keep the existing tests passing. The order summary page is also slow on mobile. Why does the coupon code run twice? Make sure to add a regression test. ' +
    'Also please check that the discount rounds the same way on the server and in the browser, because finance reported a one cent difference last week. ' +
    'Please also write down every place that formats currency, since the mobile app and the website use different helpers for it, and list which ones should move into the shared package. ' +
    'Do not rewrite anything outside the checkout folder, and tell me what you could not verify at the end. Also keep a short list of the follow-ups you would suggest, ordered by risk, so I can plan the next sprint around them.'

  expect(long.length).toBeGreaterThan(800)
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: long.slice(0, -1), cursor: 0, start: 0, end: 0, inputText: long.slice(-1) })
  await clock.advance(3100)
  expect(box.toasts.filter(t => /Long draft/.test(t)).length).toBe(1)

  // Another long draft within three minutes stays quiet.
  await send($, 'sent')
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: long.slice(0, -2), cursor: 0, start: 0, end: 0, inputText: long.slice(-2) })
  await clock.advance(3100)
  expect(box.toasts.filter(t => /Long draft/.test(t)).length).toBe(1)

  // The command reads the last draft typed (the box holds the command itself by then).
  box.draft = ''
  const out = (await cmd($, 'pmreword')).text as string
  expect(out.startsWith('Goal: ')).toBe(true)
  expect(out).toContain('Constraints:')
  expect(out).toContain('/pmreword apply')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-prompts' })
  expect(await ui.find({ type: 'Text', text: /^Suggested rewrite$/ })).toBeDefined()
  await ui.press({ key: 'rewrite-use' })
  expect(box.fills.at(-1)?.text.startsWith('Goal: ')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^Suggested rewrite$/ })).toBeUndefined()
  await ui.unmount()

  expect((await cmd($, 'pmreword', 'too short')).text).toMatch(/a rewrite is offered from 300/)
  expect((await cmd($, 'pmreword', 'apply')).text).toMatch(/No rewrite waiting/)
  await cmd($, 'pmreword', 'hint off')
  expect((stored['prompting.modes'] as any).hints).toBe(false)
})

test('18: /pmclean tidies the given text or the last draft, keeps the original for /pmrestore', async ($, on) => {
  const { box, clock } = await setup($, on)

  await cmd($, 'pmclean', 'um so  i want to to rename the the function ,uh please')
  expect(box.fills.at(-1)).toEqual({ text: 'So i want to rename the function, please', mode: 'replace' })

  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: 'uh refactor  the parser', cursor: 0, start: 0, end: 0, inputText: '' })
  await clock.advance(3100)
  box.draft = ''
  expect((await cmd($, 'pmclean')).text).toMatch(/Tidied \d+ things?/)
  expect(box.fills.at(-1)?.text).toBe('Refactor the parser')
  expect((stored['prompting.draft'] as any).text).toBe('uh refactor  the parser')

  expect((await cmd($, 'pmclean', 'Already tidy.')).text).toMatch(/already tidy/)
  await cmd($, 'pmreset')
  box.draft = ''
  expect((await cmd($, 'pmclean')).text).toMatch(/Nothing to clean/)
})

// ------------------------------------------------------------------ 8, 11: quote and summary

test('8: /pmquote quotes the last assistant text, optionally its last lines', async ($, on) => {
  const { box } = await setup($, on)

  expect((await cmd($, 'pmquote')).text).toMatch(/No assistant reply/)
  box.messages = [
    { role: 'user', text: 'hi', toolUses: [] },
    { role: 'assistant', text: 'First line.\n\nSecond line.\nThird line.', toolUses: [] },
    { role: 'user', text: 'ok', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [] },
  ]
  await cmd($, 'pmquote')
  expect(box.fills.at(-1)).toEqual({ text: '> First line.\n>\n> Second line.\n> Third line.\n\n', mode: 'replace' })
  await cmd($, 'pmquote', '2')
  expect(box.fills.at(-1)?.text).toBe('> Second line.\n> Third line.\n\n')
  box.draft = 'my note'
  await cmd($, 'pmquote', '1')
  expect(box.fills.at(-1)?.mode).toBe('append')
})

test('11: /pmsum fills a ten-line recap request and never sends it', async ($, on) => {
  const { box } = await setup($, on)

  expect((await cmd($, 'pmsum')).text).toMatch(/press Enter/)
  expect(box.fills.at(-1)?.text).toMatch(/exactly ten lines/)
  expect(box.submitted).toEqual([])
  box.isFilled = false
  expect((await cmd($, 'pmsum')).text).toMatch(/could not take the text/)
})

// ------------------------------------------------------------------ 10, 12, 13: marks, decisions, assumptions

test('10: /pmmark stars the latest reply with a label and tells where it is', async ($, on) => {
  const { box } = await setup($, on)
  box.messages = [
    { role: 'user', text: 'q', toolUses: [] },
    { role: 'assistant', text: 'The migration plan has three steps and a rollback.', toolUses: [] },
    { role: 'user', text: 'q2', toolUses: [] },
    { role: 'assistant', text: 'Here is the schema change.', toolUses: [] },
  ]

  expect((await cmd($, 'pmmark', 'schema change')).text).toMatch(/Marked 1: "schema change" at reply 2/)
  const list = (await cmd($, 'pmmark', 'list')).text as string
  expect(list).toContain('1. schema change (reply 2')
  expect(list).toContain('Here is the schema change.')
  expect((await cmd($, 'pmmark', 'go 1')).text).toMatch(/assistant reply 2 of 4 messages then.*cannot scroll/)
  expect((await cmd($, 'pmmark', 'go 9')).text).toMatch(/Usage/)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-notes' })
  expect(await ui.find({ type: 'Text', text: /^1\. schema change$/ })).toBeDefined()
  await ui.unmount()

  await cmd($, 'pmmark', 'rm 1')
  expect((await cmd($, 'pmmark')).text).toMatch(/No marks yet/)
})

test('12: the decision log adds, lists, removes and fills the box', async ($, on) => {
  const { box } = await setup($, on)

  expect((await cmd($, 'pmdecide', 'use sqlite, not postgres')).text).toBe('Logged decision 1: use sqlite, not postgres')
  await cmd($, 'pmdecide', 'ship behind a flag')
  expect(((await cmd($, 'pmdecide')).text as string)).toMatch(/1\. use sqlite.*\n.*2\. ship behind a flag/)
  await cmd($, 'pmdecide', 'fill')
  expect(box.fills.at(-1)?.text).toBe('Decisions so far:\n- use sqlite, not postgres\n- ship behind a flag\n')
  await cmd($, 'pmdecide', 'rm 1')
  expect(((await cmd($, 'pmdecide')).text as string)).not.toContain('sqlite')
  expect((stored['prompting.decisions'] as any[]).length).toBe(1)
})

test('13: assumption lines from assistant answers are collected, deduplicated and bounded', async ($, on) => {
  const { box } = await setup($, on)

  await $.turn.complete(done('Done.\nAssuming the API is v2, I changed the client.\nI assume you want tests.'))
  await $.turn.complete(done('Assuming the API is v2, I changed the client.\nNothing else.'))
  await $.turn.complete({ ...done('Assuming this is from a subagent.'), agentId: 'sub1' })
  const list = (await cmd($, 'pmassume')).text as string

  expect(list).toContain('1. Assuming the API is v2, I changed the client.')
  expect(list).toContain('2. I assume you want tests.')
  expect(list).not.toContain('subagent')
  expect(list.split('\n').length).toBe(3)

  await cmd($, 'pmassume', 'fill')
  expect(box.fills.at(-1)?.text).toMatch(/^Please confirm or correct these assumptions/)
  await cmd($, 'pmassume', 'clear')
  expect(((await cmd($, 'pmassume')).text as string)).toMatch(/No assumptions seen/)

  for (let i = 0; i < 70; i += 1) {
    await $.turn.complete(done(`Assuming case ${i}.`))
  }
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-notes' })
  expect(await ui.find({ type: 'Text', text: /^60\. Assuming case 69\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^61\./ })).toBeUndefined()
  await ui.unmount()
})

// ------------------------------------------------------------------ 16, 17: queue and A/B

test('16: the queue fills the box one prompt at a time and never sends', async ($, on) => {
  const { box } = await setup($, on)

  expect((await cmd($, 'pmq')).text).toMatch(/empty/)
  await cmd($, 'pmq', 'add first step')
  await cmd($, 'pmq', 'add second step')
  expect(((await cmd($, 'pmq')).text as string)).toMatch(/1\. first step\n\s+2\. second step/)

  expect((await cmd($, 'pmq', 'next')).text).toMatch(/1 left.*nothing is sent/)
  expect(box.fills.at(-1)).toEqual({ text: 'first step', mode: 'replace' })
  expect(box.submitted).toEqual([])
  expect((stored['prompting.queue'] as string[])).toEqual(['second step'])

  // A refused fill keeps the item.
  box.isFilled = false
  expect((await cmd($, 'pmq', 'next')).text).toMatch(/could not take the text/)
  expect((stored['prompting.queue'] as string[])).toEqual(['second step'])
  box.isFilled = true

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-queue' })
  await ui.press({ key: 'queue-next' })
  expect(box.fills.at(-1)?.text).toBe('second step')
  await ui.unmount()
  expect((await cmd($, 'pmq', 'next')).text).toMatch(/empty/)

  for (let i = 0; i < 31; i += 1) {
    await cmd($, 'pmq', `add item ${i}`)
  }
  expect((stored['prompting.queue'] as string[]).length).toBe(30)
  await cmd($, 'pmq', 'rm 1')
  await cmd($, 'pmq', 'clear')
  expect((stored['prompting.queue'] as string[])).toEqual([])
})

test('17: A/B pairs store two phrasings, fill either, and note which result was better', async ($, on) => {
  const { box } = await setup($, on)

  expect((await cmd($, 'pmab', 'new only one side')).text).toMatch(/Usage/)
  expect((await cmd($, 'pmab', 'new Summarize this file || Give me a three bullet summary of this file')).text).toMatch(/Stored pair 1/)
  await cmd($, 'pmab', 'use 1 b')
  expect(box.fills.at(-1)?.text).toBe('Give me a three bullet summary of this file')
  expect(box.submitted).toEqual([])
  expect((await cmd($, 'pmab', 'use 1 z')).text).toMatch(/Usage/)

  await cmd($, 'pmab', 'better 1 b more concrete answer')
  expect(((await cmd($, 'pmab')).text as string)).toContain('-> B better (more concrete answer)')

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-queue' })
  expect(await ui.find({ type: 'Text', text: /^Pair 1: B was better/ })).toBeDefined()
  await ui.press({ key: 'ab-win-a-1' })
  expect(await ui.find({ type: 'Text', text: /^Pair 1: A was better/ })).toBeDefined()
  await ui.press({ key: 'ab-use-a-1' })
  expect(box.fills.at(-1)?.text).toBe('Summarize this file')
  await ui.unmount()

  await cmd($, 'pmab', 'rm 1')
  expect((await cmd($, 'pmab')).text).toMatch(/No A\/B pairs yet/)
})

// ------------------------------------------------------------------ the pane

test('the pane has five tabs on every surface and its buttons flip the standing instructions', async ($, on) => {
  await setup($, on)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Standing instructions$/ })).toBeDefined()

    for (const [id, heading] of [
      ['library', /^Templates$/],
      ['queue', /^Queue$/],
      ['prompts', /^Scorecard \(private\)$/],
      ['notes', /^Marks$/],
      ['modes', /^Standing instructions$/],
    ] as const) {
      await ui.press({ key: `tab-${id}` })
      expect(await ui.find({ type: 'Text', text: heading })).toBeDefined()
    }
    await ui.unmount()
  }

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tone-teach' })
  expect(await standing($)).toContain('Tone preset (teach)')
  await ui.press({ key: 'tone-off' })
  await ui.press({ key: 'ask-on' })
  expect(await standing($)).toContain('Question-first')
  await ui.press({ key: 'ask-off' })
  await ui.press({ key: 'example-on' })
  await ui.press({ key: 'example-off' })
  expect(await standing($)).toBeUndefined()
  await ui.press({ key: 'sum' })
  await ui.unmount()

  expect((await cmd($, 'pm', 'pane')).text).toBe('Prompting pane opened.')
})
