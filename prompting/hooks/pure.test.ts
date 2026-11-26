import { expect, test } from 'claude-code/testing'

import {
  BUILTIN_TEMPLATES,
  cleanDictation,
  cleanLanguage,
  diffInline,
  diffSummary,
  expandMacros,
  extractAssumptions,
  fillBlanks,
  hasSecret,
  maskSecrets,
  parseParts,
  quoteBlock,
  readModes,
  rewordDraft,
  scorePrompt,
  splitVerb,
  standingNames,
  standingText,
  wordDiff,
  DEFAULT_MODES,
} from './pure'

test('templates: blanks fill in order and the caret lands on the first blank left', async () => {
  const bug = BUILTIN_TEMPLATES.bug ?? ''
  expect(bug).toBe('Bug in ___, expected ___, got ___.')

  const full = fillBlanks(bug, ['login', '200', '500'])
  expect(full.text).toBe('Bug in login, expected 200, got 500.')
  expect(full.left).toBe(0)
  expect(full.cursor).toBe(full.text.length)

  const partial = fillBlanks(bug, ['login page', '', 'a blank page'])
  expect(partial.text).toBe('Bug in login page, expected ___, got a blank page.')
  expect(partial.left).toBe(1)
  expect(partial.cursor).toBe(partial.text.indexOf('___'))

  expect(fillBlanks(bug, []).left).toBe(3)
  expect(parseParts('a | b |c')).toEqual(['a', 'b', 'c'])
  expect(parseParts('  ')).toEqual([])
  expect(splitVerb('Add  bug  x y')).toEqual(['add', 'bug  x y'])
  expect(splitVerb('')).toEqual(['', ''])
})

test('scorecard: a vague prompt scores below a specific one on every axis it should', async () => {
  const vague = scorePrompt('make it better somehow, fix the stuff')
  const good = scorePrompt(
    'Fix the null check in `src/auth/session.ts` so that refresh() returns early when the token is missing. Only touch that function, do not change the public API, and keep the existing tests passing.',
  )

  expect(good.total).toBeGreaterThan(vague.total)
  expect(good.clarity).toBeGreaterThan(vague.clarity)
  expect(good.scope).toBeGreaterThan(vague.scope)
  expect(good.constraints).toBeGreaterThan(vague.constraints)
  for (const n of [vague.total, vague.clarity, vague.scope, vague.constraints, good.total]) {
    expect(n).toBeGreaterThanOrEqual(0)
    expect(n).toBeLessThanOrEqual(100)
  }
  expect(scorePrompt('rewrite everything from scratch').scope).toBeLessThan(scorePrompt('rename `foo` in a.ts').scope)
  expect(scorePrompt('').total).toBeLessThan(40)
  expect(vague.tip.length).toBeGreaterThan(10)
})

test('diff: words added and removed, merged into runs', async () => {
  const { segs, isCut } = wordDiff('fix the login bug today', 'fix the signup bug')
  expect(isCut).toBe(false)
  expect(diffInline(segs)).toBe('fix the [-login] [+signup] bug [-today]')
  expect(diffSummary(segs)).toBe('+1 words, -2 words, 3 kept')
  expect(diffSummary(wordDiff('a b', 'a b').segs)).toBe('identical wording')

  const long = Array.from({ length: 450 }, (_, i) => `w${i}`).join(' ')
  expect(wordDiff(long, long).isCut).toBe(true)
  expect(wordDiff('', 'new text').segs).toEqual([{ kind: 'add', text: 'new text' }])
})

test('reword: short drafts are left alone, long ones are grouped, nothing is invented', async () => {
  expect('reason' in rewordDraft('fix the bug')).toBe(true)

  const draft =
    'Hi, I was wondering if you could please look at our checkout flow. The cart total is wrong when a coupon is applied twice. ' +
    'You must not change the public API. Keep the existing tests passing. Also the order summary page is slow, honestly really slow on mobile. ' +
    'Why does the coupon code run twice? The cart total is wrong when a coupon is applied twice. Make sure to add a regression test for it.'
  const out = rewordDraft(draft)

  expect('text' in out).toBe(true)

  if ('text' in out) {
    expect(out.text.startsWith('Goal: ')).toBe(true)
    expect(out.text).toContain('Constraints:')
    expect(out.text).toContain('- You must not change the public API.')
    expect(out.text).toContain('Questions:')
    expect(out.text).not.toMatch(/honestly|really/i)
    expect(out.text.split('The cart total is wrong').length - 1).toBe(1)
    expect(out.notes.join(' ')).toMatch(/Heuristic/)
  }
})

test('clean-up: filler words, repeats, spacing and capitals, code left alone', async () => {
  const out = cleanDictation('um so  i want to to rename the the function ,uh  `foo  bar` in a.ts. then run the tests')

  expect(out.text).toBe('So i want to rename the function, `foo  bar` in a.ts. Then run the tests')
  expect(out.changes).toBeGreaterThan(3)
  expect(cleanDictation('Already tidy.').changes).toBe(0)
  expect(cleanDictation('src/a.ts needs a look').text).toBe('src/a.ts needs a look')
  expect(cleanDictation('```\num  um\n```\nok').text).toBe('```\num  um\n```\nok')
  expect(cleanDictation('line one  \n\n\n\nline two').text).toBe('Line one\n\nline two')
})

test('assumptions: only the stated lines, not code or other text', async () => {
  const text = [
    'Done.',
    '- Assuming the config lives in `app.json`, I edited it.',
    '**I assume** you want the tests too.',
    "I'm assuming Node 20.",
    '```',
    'Assuming this is code',
    '```',
    'We are assuming nothing here.',
  ].join('\n')

  expect(extractAssumptions(text)).toEqual([
    'Assuming the config lives in `app.json`, I edited it.',
    'I assume you want the tests too.',
    "I'm assuming Node 20.",
  ])
})

test('macros: a defined //name prefix expands, an unknown one and a path do not', async () => {
  const table = { t: 'Answer tersely.', r: 'Review it.' }

  expect(expandMacros('//t what is a monad', table)).toEqual({ text: 'Answer tersely.\n\nwhat is a monad', used: ['t'] })
  expect(expandMacros('//t //r look', table).text).toBe('Answer tersely.\nReview it.\n\nlook')
  expect(expandMacros('//t', table).text).toBe('Answer tersely.')
  expect(expandMacros('//x hi', table)).toEqual({ text: '//x hi', used: [] })
  expect(expandMacros('//usr/bin is where', table).used).toEqual([])
  expect(expandMacros('see //t', table).used).toEqual([])
})

test('standing instructions: nothing by default, each switch adds its own line', async () => {
  expect(standingText(DEFAULT_MODES, [])).toBeNull()
  expect(standingNames(DEFAULT_MODES, [])).toEqual([])

  const all = standingText({ ...DEFAULT_MODES, tone: 'terse', ask: true, lang: 'German', example: true }, ['no new deps'])
  expect(all).toContain('Tone preset (terse)')
  expect(all).toContain('Question-first mode')
  expect(all).toContain('reply in German')
  expect(all).toContain('Example-first mode')
  expect(all).toContain('- no new deps')
  expect(standingNames({ ...DEFAULT_MODES, tone: 'review', lang: 'French' }, ['x'])).toEqual(['tone review', 'language French', '1 pinned'])

  // Stored junk falls back to the defaults.
  expect(readModes(null)).toEqual(DEFAULT_MODES)
  expect(readModes({ tone: 'loud', ask: 'yes', lang: 'Fr<script>', rec: false }).tone).toBe('off')
  expect(readModes({ tone: 'loud', ask: 'yes', lang: 'Fr<script>', rec: false })).toEqual({ ...DEFAULT_MODES, lang: 'Frscript', rec: false })
  expect(cleanLanguage('Brazilian Portuguese!!')).toBe('Brazilian Portuguese')
})

test('secrets are detected and masked, quotes are blockquotes', async () => {
  expect(hasSecret('use sk-ant-api03-abcdefghijklmnop')).toBe(true)
  expect(hasSecret(`token ghp_${'a'.repeat(30)}`)).toBe(true)
  expect(hasSecret('password: hunter2hunter2')).toBe(true)
  expect(hasSecret('fix the login page')).toBe(false)
  expect(maskSecrets('key sk-ant-api03-abcdefghijklmnop end')).toBe('key [hidden] end')

  expect(quoteBlock('one\n\ntwo')).toBe('> one\n>\n> two\n\n')
  expect(quoteBlock('x'.repeat(2000), 100).length).toBeLessThan(110)
})
