import { expect, test } from 'claude-code/testing'

import {
  CHECKLIST,
  a11yIssues,
  addedLines,
  budgetState,
  dependencyDiff,
  detectA11y,
  detectApi,
  detectComments,
  detectComplexity,
  detectConfig,
  detectDead,
  detectDeps,
  detectErrors,
  detectLicense,
  detectLogging,
  detectMagic,
  detectMigration,
  detectNaming,
  detectPerf,
  detectRisky,
  detectTodos,
  findCycles,
  functionsIn,
  importsOf,
  lineDelta,
  magicNumbers,
  maxNesting,
  parseOnOff,
  redact,
  restates,
  runDetectors,
  testGaps,
  toFinding,
  visibleFindings,
} from './pure'
import type { Ctx } from './pure'

const ctx = (path: string, content: string, old = '', isWrite = false, corpus?: string): Ctx => ({ path, content, old, isWrite, corpus })

// ------------------------------------------------------------ pure detectors

test('22 risky paths', async () => {
  expect(detectRisky(ctx('/p/src/auth/login.ts', 'x'))[0]?.sev).toBe('warn')
  expect(detectRisky(ctx('/p/src/PaymentForm.tsx', 'x'))).toHaveLength(1)
  expect(detectRisky(ctx('/p/db/migrations/001.sql', 'x'))).toHaveLength(1)
  expect(detectRisky(ctx('/p/src/utils/strings.ts', 'x'))).toHaveLength(0)
})

test('23 test gaps by file name', async () => {
  const f = (path: string, added = 20) => ({ path, edits: 1, added, removed: 0, isNew: false, imports: [], at: 0 })
  const gaps = testGaps([f('/p/src/parser.ts'), f('/p/src/render.ts'), f('/p/src/parser.test.ts'), f('/p/src/tiny.ts', 2), f('/p/README.md')])
  expect(gaps.map(g => g.path)).toEqual(['/p/src/render.ts'])
  expect(testGaps([f('/p/app/user_service.py'), f('/p/tests/test_user_service.py')])).toHaveLength(0)
  expect(testGaps([f('/p/pkg/store.go'), f('/p/pkg/store_test.go')])).toHaveLength(0)
  expect(testGaps([f('/p/pkg/store.go')])).toHaveLength(1)
})

test('24 complexity: long functions and nesting', async () => {
  const body = Array.from({ length: 60 }, (_, i) => `  const v${i} = ${i}`).join('\n')
  const long = `function big() {\n${body}\n}\n`
  expect(functionsIn(long)[0]).toMatchObject({ name: 'big', len: 62 })
  expect(detectComplexity(ctx('a.ts', long))[0]?.msg).toMatch(/big is 62 lines/)
  expect(detectComplexity(ctx('a.ts', 'function s() {\n  return 1\n}\n'))).toHaveLength(0)

  const py = `def slow():\n${Array.from({ length: 55 }, (_, i) => `    x${i} = ${i}`).join('\n')}\n\ndef other():\n    pass\n`
  expect(functionsIn(py).map(f => [f.name, f.len > 50])).toEqual([['slow', true], ['other', false]])

  const nested = [
    'function f(a) {',
    '  if (a) {',
    '    for (const x of a) {',
    '      while (x) {',
    '        if (x.y) {',
    '          switch (x.z) {',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n')
  expect(maxNesting(nested).depth).toBe(5)
  expect(detectComplexity(ctx('a.ts', nested))[0]?.msg).toMatch(/nested 5 deep/)
  expect(maxNesting('if (a) {\n  b()\n} else {\n  c()\n}\n').depth).toBe(1)
})

test('25 TODO collector only reports lines Claude added', async () => {
  const hits = detectTodos(ctx('a.ts', 'const a = 1\n// TODO: handle retries\n# FIXME later\nconst b = 2 // HACK for now\n', '# FIXME later\n'))
  expect(hits.map(h => h.msg)).toEqual(['hint: TODO left in code', 'hint: HACK left in code'])
  expect(detectTodos(ctx('a.ts', 'const todoList = []'))).toHaveLength(0)
})

test('26 dead-code hint needs the whole file and ignores used/exported names', async () => {
  const src = 'function used() { return 1 }\nfunction unused() { return 2 }\nconst arrow = () => 3\nexport function api() {}\nused()\n'
  const hits = detectDead(ctx('a.ts', src, '', true))
  expect(hits.map(h => h.msg.split(' ')[1])).toEqual(['unused', 'arrow'])
  // An Edit snippet alone is not enough to judge: no corpus, no hint.
  expect(detectDead(ctx('a.ts', src, 'old'))).toHaveLength(0)
  expect(detectDead(ctx('a.ts', 'function helper() {}', 'old', false, 'helper()\nfunction helper() {}'))).toHaveLength(0)
  expect(detectDead(ctx('a.test.ts', src, '', true))).toHaveLength(0)
})

test('27 naming consistency', async () => {
  const mixed = 'const userName = 1\nconst userAge = 2\nconst first_name = 3\nconst last_name = 4\n'
  expect(detectNaming(ctx('a.ts', mixed))[0]?.msg).toMatch(/camelCase and snake_case/)
  expect(detectNaming(ctx('a.ts', 'const userName = 1\nconst userAge = 2\nconst one_odd = 3\n'))).toHaveLength(0)
  expect(detectNaming(ctx('a.py', 'def get_user():\n    pass\ndef load_data():\n    pass\n'))).toHaveLength(0)
})

test('28 import cycles only among edited files', async () => {
  const files = [
    { path: '/p/a.ts', imports: importsOf("import { b } from './b'\n") },
    { path: '/p/b.ts', imports: importsOf("import {\n  a,\n} from './a.js'\nimport x from 'lodash'\n") },
    { path: '/p/c.ts', imports: importsOf("const d = require('./d')") },
  ]
  expect(importsOf("import x from 'lodash'\nexport * from './z'\nimport './side'")).toEqual(['./z', './side'])
  expect(importsOf('from .util import f\nfrom ..core.base import g')).toEqual(['./util', '../core/base'])
  const cycles = findCycles(files)
  expect(cycles).toHaveLength(1)
  expect(cycles[0]?.sort()).toEqual(['/p/a.ts', '/p/b.ts'])
  expect(findCycles([{ path: '/p/a.ts', imports: ['./b'] }, { path: '/p/b.ts', imports: [] }])).toHaveLength(0)
  expect(findCycles([{ path: '/p/x/index.ts', imports: ['../y'] }, { path: '/p/y.ts', imports: ['./x'] }])).toHaveLength(1)
})

test('29 public API change', async () => {
  const changed = detectApi(ctx('a.ts', 'export function f(a, b) {}', 'export function f(a) {}'))
  expect(changed[0]?.msg).toMatch(/changed/)
  expect(detectApi(ctx('a.ts', 'const x = 1', 'export const x = 1'))[0]?.msg).toMatch(/removed/)
  expect(detectApi(ctx('a.ts', 'export const y = 1\nconst z = 2', 'const z = 2'))[0]?.msg).toMatch(/new export/)
  expect(detectApi(ctx('a.ts', 'const z = 3', 'const z = 2'))).toHaveLength(0)
  expect(detectApi(ctx('a.ts', 'export const a = 1', '', true))[0]?.msg).toMatch(/overwriting/)
})

test('30 dependency diff and 31 license check', async () => {
  const pkgOld = '"name": "x",\n"version": "1.0.0",\n"react": "^18.0.0",\n'
  const pkgNew = '"name": "x",\n"version": "1.0.1",\n"react": "^18.2.0",\n"left-pad": "^1.3.0",\n'
  const d = dependencyDiff(ctx('/p/package.json', pkgNew, pkgOld))
  expect(d.added).toEqual(['react@^18.2.0', 'left-pad@^1.3.0'])
  expect(d.removed).toEqual(['react@^18.0.0'])
  expect(detectDeps(ctx('/p/package.json', pkgNew, pkgOld))[0]?.snippet).toMatch(/\+left-pad@\^1\.3\.0/)
  expect(detectDeps(ctx('/p/requirements.txt', 'requests==2.31.0\n# c\nflask>=2\n', 'requests==2.31.0\n'))[0]?.snippet).toMatch(/\+flask>=2/)
  expect(detectDeps(ctx('/p/Cargo.toml', 'serde = "1.0"\ntokio = { version = "1", features = ["full"] }\nname = "me"\n', ''))[0]?.snippet).toMatch(/serde@1\.0.*tokio@1/)
  expect(detectDeps(ctx('/p/src/a.ts', '"react": "^18"'))).toHaveLength(0)

  const lic = detectLicense(ctx('/p/package-lock.json', '"node_modules/foo": {\n"license": "AGPL-3.0-only",\n}\n"license": "MIT"\n'))
  expect(lic).toHaveLength(1)
  expect(lic[0]?.sev).toBe('warn')
  expect(detectLicense(ctx('/p/package.json', '"license": "MIT"'))).toHaveLength(0)
  expect(detectLicense(ctx('/p/src/a.ts', '"license": "GPL-3.0"'))).toHaveLength(0)
})

test('32 comment-quality lint', async () => {
  expect(restates('increment the counter', 'counter++')).toBe(true)
  expect(restates('loop over users', 'for (const user of users) {')).toBe(true)
  expect(restates('retry because the API drops connections under load', 'retry()')).toBe(false)
  expect(restates('set user name', 'const userName = input')).toBe(true)
  expect(restates('Workaround for Safari bug', 'el.focus()')).toBe(false)
  const hits = detectComments(ctx('a.ts', '// get user name\nconst userName = getName()\n// Safari needs a frame before focus\nel.focus()\n'))
  expect(hits).toHaveLength(1)
  expect(hits[0]?.snippet).toMatch(/get user name/)
})

test('33 magic numbers', async () => {
  expect(magicNumbers('if (retries > 250) stop()')).toEqual(['250'])
  expect(magicNumbers('const timeoutMs = 5000')).toEqual([])
  expect(magicNumbers('const MAX = 4096')).toEqual([])
  expect(magicNumbers('  width: 320,')).toEqual([])
  expect(magicNumbers('x = y * 3.14159')).toEqual(['3.14159'])
  expect(magicNumbers('const s = "port 8080"')).toEqual([])
  expect(magicNumbers('i += 1; j = 0; k = 100')).toEqual([])
  expect(magicNumbers('// 12345 in a comment')).toEqual([])
  expect(magicNumbers('data = [101, 202, 303, 404]')).toEqual([])
  expect(detectMagic(ctx('a.test.ts', 'expect(x).toBe(12345)'))).toHaveLength(0)
  expect(detectMagic(ctx('a.ts', 'wait(86400)\nwait(86400)', 'wait(86400)'))).toHaveLength(0)
  expect(detectMagic(ctx('a.ts', 'sleep(86400)'))[0]?.msg).toMatch(/86400/)
})

test('34 error-handling audit', async () => {
  expect(detectErrors(ctx('a.ts', 'try { f() } catch (e) {}'))[0]?.msg).toMatch(/empty catch/)
  expect(detectErrors(ctx('a.ts', 'try { f() } catch {\n  // ignore\n}'))[0]?.msg).toMatch(/empty catch/)
  expect(detectErrors(ctx('a.ts', 'p.catch(() => {})'))[0]?.msg).toMatch(/rejection/)
  expect(detectErrors(ctx('a.ts', 'p.catch(() => undefined)'))).toHaveLength(1)
  expect(detectErrors(ctx('a.ts', 'try { f() } catch (e) { console.log(e) }'))[0]?.msg).toMatch(/only logs/)
  expect(detectErrors(ctx('a.py', 'try:\n    f()\nexcept ValueError:\n    pass\n'))[0]?.msg).toMatch(/does nothing/)
  expect(detectErrors(ctx('a.py', 'try:\n    f()\nexcept:\n    handle()\n'))[0]?.msg).toMatch(/bare except/)
  expect(detectErrors(ctx('a.ts', 'try { f() } catch (e) { report(e); throw e }'))).toHaveLength(0)
  expect(detectErrors(ctx('a.ts', 'try { f() } catch (e) {}', 'try { f() } catch (e) {}'))).toHaveLength(0)
})

test('35 logging audit', async () => {
  expect(detectLogging(ctx('a.ts', 'console.log("user token", token)'))[0]?.sev).toBe('warn')
  expect(detectLogging(ctx('a.py', 'print(f"password={pw}")'))).toHaveLength(1)
  expect(detectLogging(ctx('a.ts', 'logger.info(`api_key ${cfg.apiKey}`)'))).toHaveLength(1)
  expect(detectLogging(ctx('a.ts', 'console.log("key pressed", k)'))).toHaveLength(0)
  expect(detectLogging(ctx('a.ts', 'const token = makeToken()'))).toHaveLength(0)
  expect(detectLogging(ctx('a.ts', 'console.log("Authorization", h)'))[0]?.snippet).not.toMatch(/xx/)
})

test('36 migration safety', async () => {
  expect(detectMigration(ctx('/p/db/migrations/002.sql', 'DROP TABLE users;'))[0]?.sev).toBe('warn')
  expect(detectMigration(ctx('/p/db/migrations/002.sql', 'ALTER TABLE a DROP COLUMN b;'))).toHaveLength(1)
  expect(detectMigration(ctx('/p/db/m.sql', 'ALTER TABLE a RENAME COLUMN b TO c;'))[0]?.sev).toBe('hint')
  expect(detectMigration(ctx('/p/db/m.sql', 'DELETE FROM users;'))[0]?.msg).toMatch(/WHERE/)
  expect(detectMigration(ctx('/p/db/m.sql', 'DELETE FROM users WHERE id = 3;'))).toHaveLength(0)
  expect(detectMigration(ctx('/p/db/m.sql', 'ALTER TABLE a ADD COLUMN b int NOT NULL;'))[0]?.msg).toMatch(/DEFAULT/)
  expect(detectMigration(ctx('/p/src/service.ts', 'db.run("DROP TABLE cache")'))).toHaveLength(1)
  expect(detectMigration(ctx('/p/src/service.ts', 'db.run("ALTER TABLE a DROP b")'))).toHaveLength(0)
  const irreversible = detectMigration(ctx('/p/migrations/003_add.py', 'def upgrade():\n    op.add_column("a", c)\n', '', true))
  expect(irreversible[0]?.msg).toMatch(/no down/)
  expect(detectMigration(ctx('/p/migrations/003_add.py', 'def upgrade():\n    pass\ndef downgrade():\n    pass\n', '', true))).toHaveLength(0)
})

test('37 config drift never shows env values', async () => {
  const env = detectConfig(ctx('/p/.env.local', 'API_URL=http://x\nSECRET_KEY=abcdefghijklmnopqrstuvwxyz123\n'))
  expect(env[0]?.snippet).toBe('keys: API_URL, SECRET_KEY (values hidden)')
  expect(env[0]?.snippet).not.toMatch(/abcdef/)
  expect(detectConfig(ctx('/p/.github/workflows/ci.yml', 'name: ci'))).toHaveLength(1)
  expect(detectConfig(ctx('/p/Dockerfile', 'FROM node:20'))).toHaveLength(1)
  expect(detectConfig(ctx('/p/config/app.json', '{}'))).toHaveLength(1)
  expect(detectConfig(ctx('/p/src/app.ts', 'x'))).toHaveLength(0)
  expect(detectConfig(ctx('/p/config.yml', 'token: abcdefghijklmnopqrstuvwxyz123'))[0]?.snippet).not.toMatch(/abcdefghij/)
})

test('38 performance hints', async () => {
  const nested = 'for (const a of items) {\n  for (const b of items) {\n    use(a, b)\n  }\n}\n'
  expect(detectPerf(ctx('a.ts', nested))[0]?.msg).toMatch(/same collection items/)
  expect(detectPerf(ctx('a.ts', 'for (const a of xs) {\n  for (const b of ys) {\n    use(a, b)\n  }\n}\n'))).toHaveLength(0)
  expect(detectPerf(ctx('a.ts', 'items.forEach(a => {\n  items.map(b => a + b)\n})\n'))[0]?.msg).toMatch(/items/)
  expect(detectPerf(ctx('a.ts', 'for (const f of files) {\n  const t = readFileSync(f)\n}\nconst x = readFileSync("a")\n'))).toHaveLength(1)
  expect(detectPerf(ctx('a.py', 'for u in users:\n    r = requests.get(u.url)\n'))[0]?.msg).toMatch(/synchronous/)
  expect(detectPerf(ctx('a.py', 'for a in rows:\n    for b in rows:\n        pass\n'))[0]?.msg).toMatch(/rows/)
})

test('39 accessibility hints', async () => {
  const src = [
    '<img src="a.png">',
    '<img src="b.png" alt="">',
    '<input type="text" />',
    '<input id="n" />',
    '<div onClick={go}>x</div>',
    '<a href="#">go</a>',
    '<html>',
    '<button onClick={f}></button>',
  ].join('\n')
  const issues = a11yIssues(src)
  expect(issues.map(i => i.msg.split(' ')[1])).toEqual(['<img>', 'form', 'clickable', 'link', '<html>', 'empty'])
  expect(detectA11y(ctx('a.tsx', src))).toHaveLength(3)
  expect(detectA11y(ctx('a.ts', src))).toHaveLength(0)
  expect(detectA11y(ctx('a.tsx', '<img src={u} alt={name} onLoad={() => go()} />'))).toHaveLength(0)
})

test('40 patch budget warns once per turn', async () => {
  let m = { turnLines: 0, budgetWarned: false }
  let r = budgetState(m, 100, 60)
  expect(r).toEqual({ turnLines: 60, warn: false })
  m = { turnLines: r.turnLines, budgetWarned: false }
  r = budgetState(m, 100, 60)
  expect(r.warn).toBe(true)
  r = budgetState({ turnLines: r.turnLines, budgetWarned: true }, 100, 60)
  expect(r.warn).toBe(false)
  expect(budgetState({ turnLines: 0, budgetWarned: false }, null, 9999).warn).toBe(false)
  expect(lineDelta('a\nb\nc', 'a\nX\nY\nc', false)).toEqual({ added: 2, removed: 1 })
  expect(lineDelta('', 'a\nb', true)).toEqual({ added: 2, removed: 0 })
})

test('helpers: redaction, added lines, parsing, findings order', async () => {
  expect(redact('token = "abcdefghijklmnopqrstuvwxyz0123"')).not.toMatch(/abcdef/)
  expect(redact('password: hunter22')).toBe('password: …')
  expect(addedLines('a\nb', 'a\nc\n\nb')).toEqual([{ n: 2, text: 'c' }])
  expect(parseOnOff('ON')).toBe(true)
  expect(parseOnOff('nope')).toBeUndefined()
  const warn = toFinding({ kind: 'logging', sev: 'warn', line: 1, snippet: 's', msg: 'm' }, '/p/a.ts', 1)
  const hint = toFinding({ kind: 'todo', sev: 'hint', line: 1, snippet: 's', msg: 'm' }, '/p/a.ts', 1)
  expect(visibleFindings([hint, warn], [], [], []).map(f => f.kind)).toEqual(['logging', 'todo'])
  expect(visibleFindings([hint, warn], [], [warn.id], []).map(f => f.kind)).toEqual(['todo'])
  expect(visibleFindings([hint, warn], [], [], ['todo']).map(f => f.kind)).toEqual(['logging'])
  expect(CHECKLIST.length).toBeGreaterThanOrEqual(8)
})

test('runDetectors respects switched-off detectors and survives odd input', async () => {
  const c = ctx('/p/auth/login.ts', 'console.log("token", t)\n// TODO fix\n')
  expect(runDetectors(c, []).map(h => h.kind).sort()).toEqual(['logging', 'risky', 'todo'])
  expect(runDetectors(c, ['risky', 'todo']).map(h => h.kind)).toEqual(['logging'])
  expect(() => runDetectors(ctx('x', '\u0000'.repeat(1000)), [])).not.toThrow()
})

// ------------------------------------------------------------ engine tests

type Engine = { registered: string[]; deny?: string; stored: Record<string, unknown>; toasts: string[]; clock: number; disk: Record<string, string>; reads: string[] }

const wire = (on: (...args: any[]) => unknown, st: Engine) => {
  on('clock.now', () => ({ value: st.clock }))
  on('command.register', (_: unknown, e: { name: string }) => {
    st.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    st.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: st.stored[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    st.stored[e.key] = e.value

    return { value: undefined }
  })
  on('fs.stat', (_: unknown, e: { path: string }) => {
    const text = st.disk[e.path]

    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: { size: text.length, kind: 'file' } }
  })
  on('fs.read', (_: unknown, e: { path: string }) => {
    st.reads.push(e.path)

    return { value: st.disk[e.path] ?? '' }
  })
  on('prompt.submit', (_: unknown, e: unknown) => e)
  on('tool.call', () => (st.deny === undefined ? { result: {} } : { deny: st.deny }))
}

const newEngine = (): Engine => ({ registered: [], stored: {}, toasts: [], clock: 1_000_000, disk: {}, reads: [] })

const cmd = ($: any, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } })

const edit = ($: any, file_path: string, old_string: string, new_string: string) => $.tool.call({ tool: 'Edit', file_path, old_string, new_string })
const write = ($: any, file_path: string, content: string) => $.tool.call({ tool: 'Write', file_path, content })
const submit = ($: any, text = 'go') => $.prompt.submit({ text, origin: { kind: 'composer' } })

const PANE = {
  plugin: 'review-kit',
  component: 'Pane',
  requestId: 'review-kit-main',
  props: { title: 'Review kit', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('/rk lists every command and registers them all with the rk prefix', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  const registered = st.registered
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  expect(registered.length).toBeGreaterThanOrEqual(8)
  expect(registered.every(n => n.startsWith('rk'))).toBe(true)
  const help = (await cmd($, 'rk')).text as string

  for (const n of registered) {
    expect(help).toContain(`/${n}`)
  }
})

test('edits produce findings, one serious toast, and never block the edit', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await submit($)

  const ran = await write($, '/proj/src/auth/session.ts', 'export const a = 1\nconsole.log("token", t)\ntry { f() } catch (e) {}\n// TODO: later\n')
  expect(ran.deny).toBeUndefined()
  expect(st.toasts).toHaveLength(1)
  expect(st.toasts[0]).toMatch(/serious hint/)

  // a second serious finding inside three minutes does not toast again
  await write($, '/proj/src/payment/pay.ts', 'console.log("secret", s)\n')
  expect(st.toasts).toHaveLength(1)

  const text = (await cmd($, 'rkpane')).text as string
  expect(text).toMatch(/serious/)
  expect(text).toMatch(/logging/)
  expect(text).toMatch(/risky/)
  expect(text).toMatch(/src\/auth\/session\.ts/)
  expect(text).toMatch(/errors/)
  expect(text).toMatch(/todo/)

  // after three minutes a new serious finding toasts again
  st.clock += 4 * 60_000
  await write($, '/proj/src/billing/b.ts', 'console.log("password", p)\n')
  expect(st.toasts).toHaveLength(2)
})

test('failed or denied edits record nothing', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  st.deny = 'blocked by someone'
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ran = await write($, '/proj/auth/x.ts', 'console.log("token", t)')
  expect(ran.deny).toBe('blocked by someone')
  expect((await cmd($, 'rkpane')).text).toMatch(/no hints/)
})

test('/rkdismiss, /rkreset, /rkdetect and the toast setting', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await submit($)
  await write($, '/proj/src/a.ts', '// TODO one\nconsole.log("token", t)\n')
  expect((await cmd($, 'rkpane')).text).toMatch(/2 hint/)

  expect((await cmd($, 'rkdismiss', '1')).text).toMatch(/Dismissed 1/)
  expect((await cmd($, 'rkpane')).text).toMatch(/1 hint/)
  expect((await cmd($, 'rkdismiss', '9')).text).toMatch(/Use \/rkdismiss/)

  expect((await cmd($, 'rkdetect', 'todo off')).text).toMatch(/off/)
  expect((await cmd($, 'rkdetect')).text).toMatch(/off {2}todo|off\s+todo/)
  expect((await cmd($, 'rkdetect', 'bogus on')).text).toMatch(/Use \/rkdetect/)
  expect(st.stored.cfg).toMatchObject({ off: ['todo'] })

  expect((await cmd($, 'rkreset')).text).toMatch(/cleared/)
  expect((await cmd($, 'rkpane')).text).toMatch(/no hints/)
  // settings survive a plain reset and go with "all"
  expect(st.stored.cfg).toMatchObject({ off: ['todo'] })
  await cmd($, 'rkreset', 'all')
  expect(st.stored.cfg).toMatchObject({ off: [] })

  st.toasts.length = 0
  await cmd($, 'rkset', 'toast off')
  st.clock += 10 * 60_000
  await write($, '/proj/src/auth/b.ts', 'console.log("token", t)')
  expect(st.toasts).toHaveLength(0)
  expect((await cmd($, 'rkset', 'toast maybe')).text).toMatch(/Settings: toast off/)
})

test('/rkbudget warns once per turn and again in the next turn', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  expect((await cmd($, 'rkbudget', 'abc')).text).toMatch(/whole number/)
  expect((await cmd($, 'rkbudget', '10')).text).toMatch(/10 lines/)
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `const v${i} = ${i}`).join('\n')

  await submit($)
  await write($, '/proj/src/one.ts', lines(8))
  expect(((await cmd($, 'rkpane')).text as string)).not.toMatch(/budget/)
  await write($, '/proj/src/two.ts', lines(8))
  await write($, '/proj/src/three.ts', lines(8))
  const text = (await cmd($, 'rkpane')).text as string
  expect(text.match(/\[serious hint: budget\]/g)).toHaveLength(1)

  await submit($)
  st.clock += 5 * 60_000
  await write($, '/proj/src/four.ts', lines(12))
  expect(((await cmd($, 'rkpane')).text as string).match(/\[serious hint: budget\]/g)).toHaveLength(2)

  expect((await cmd($, 'rkbudget', 'off')).text).toMatch(/off/)
  expect((await cmd($, 'rkbudget')).text).toMatch(/off/)
})

test('/rkcheck ticks items and shows open hints', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await write($, '/proj/src/a.ts', '// TODO x\n')
  const first = (await cmd($, 'rkcheck')).text as string
  expect(first).toMatch(/\[ \] Leftovers.*1 open hint/)
  expect((await cmd($, 'rkcheck', '8')).text).toMatch(/\[x\] Leftovers/)
  expect((await cmd($, 'rkcheck', '8')).text).toMatch(/\[ \] Leftovers/)
  expect((await cmd($, 'rkcheck', '99')).text).toMatch(/Use \/rkcheck/)
  await cmd($, 'rkcheck', '1')
  expect((await cmd($, 'rkcheck', 'reset')).text).toMatch(/cleared/)
})

test('an Edit reads the edited file back, bounded, to judge dead code and imports; /rkset read off stops it', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  st.disk['/proj/src/a.ts'] = "import { b } from './b'\nfunction helper() {}\nhelper()\nfunction lonely() {}\n"
  st.disk['/proj/src/b.ts'] = "import { a } from './a'\n"
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await edit($, '/proj/src/a.ts', '', 'function helper() {}\nfunction lonely() {}\n')
  await edit($, '/proj/src/b.ts', '', "import { a } from './a'\n")
  expect(st.reads.sort()).toEqual(['/proj/src/a.ts', '/proj/src/b.ts'])
  const text = (await cmd($, 'rkpane')).text as string
  expect(text).toMatch(/lonely is defined but never referenced/)
  expect(text).not.toMatch(/helper is defined/)
  expect(text).toMatch(/import cycle/)

  st.reads.length = 0
  await cmd($, 'rkset', 'read off')
  await edit($, '/proj/src/a.ts', 'x', 'y')
  expect(st.reads).toHaveLength(0)
})

test('derived findings: test gaps clear when a test is edited', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await write($, '/proj/src/widget.ts', Array.from({ length: 12 }, (_, i) => `export const w${i} = ${i}`).join('\n'))
  expect((await cmd($, 'rkpane')).text).toMatch(/testgap/)
  await write($, '/proj/src/widget.test.ts', 'test("w", () => {})\n')
  expect((await cmd($, 'rkpane')).text).not.toMatch(/testgap/)
})

test('the pane has tabs, shows findings, dismisses and ticks by button', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await write($, '/proj/src/a.ts', '// TODO one\n')

  for (const surface of ['terminal', 'desktop'] as const) {
    await cmd($, 'rkcheck', 'reset')
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Review kit/ }))?.text).toBe('Review kit')
    expect((await ui.find({ type: 'Text', text: /TODO left in code/ }))?.text).toBe('TODO left in code')
    await ui.press({ key: 'tab-checklist' })
    expect(await ui.find({ type: 'Button', text: /Leftovers/ }), 'btn1').toBeDefined()
    await ui.press({ key: 'ck-leftovers' })
    expect(await ui.find({ type: 'Button', text: /\[x\] Leftovers/ }), 'btn2').toBeDefined()
    await ui.press({ key: 'tab-files' })
    expect((await ui.find({ type: 'Text', text: /src\/a\.ts/ }))?.text).toBe('src/a.ts')
    await ui.press({ key: 'tab-detectors' })
    await ui.press({ key: 'dt-todo' })
    expect(await ui.find({ type: 'Button', text: /off {2}#25/ }), 'btn3').toBeDefined()
    await ui.press({ key: 'dt-todo' })
    await ui.press({ key: 'tab-findings' })
    expect(await ui.find({ type: 'Button', text: /Dismiss/ }), 'dismiss').toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const dismiss = await ui.find({ type: 'Button', text: /Dismiss/ })
  await ui.press({ key: String(dismiss?.key) })
  expect((await ui.find({ type: 'Text', text: /No hints yet/ }))?.text).toMatch(/No hints yet/)
  await ui.unmount()
})

test('a value an earlier version stored is declined, not crashed on', async ($, on) => {
  const st = newEngine()
  wire(on, st)
  on('state.get', () => ({ value: { value: [{ nope: true }], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /No hints yet/ }))?.text).toMatch(/No hints yet/)
  await ui.unmount()
})
