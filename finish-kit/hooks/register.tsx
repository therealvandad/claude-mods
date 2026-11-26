import { atom, read, update } from 'claude-code'
import type { Hook, Register, ThemeSetArgs } from 'claude-code'

import { CVDS, MONTHS, monthAccent, parseHexList, pickAccent } from './color'
import type { Cvd } from './color'
import {
  ACCENT_CHOICES,
  BORDERS,
  CARDS,
  CONTRASTS,
  DEFAULT_FINISH,
  GRAYS,
  GROUNDS,
  HEADINGS,
  PREVIEW_ONLY,
  PRESETS,
  PRESET_IDS,
  SHAPES,
  SKIPPED,
  TONES,
  WEIGHTS,
  anchorsOf,
  describe,
  parseFinish,
  parseOpts,
  resolve,
  rolesOf,
  withPreset,
} from './finish'
import type { Finish } from './finish'
import { colourSvg, dataSvg, iconsSvg, miniSvg, sampleSvg, surfaceSvg, typeSvg } from './preview'
import type { Opts } from './preview'
import { SCENE_ALT, sceneSvg } from './scenes'
import { withGlyph } from './titles'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'finish-kit-main'

const TABS = ['finishes', 'colour', 'surface', 'type', 'data', 'icons', 'about'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = { finishes: 'Finishes', colour: 'Colour', surface: 'Surface', type: 'Type', data: 'Data', icons: 'Icons', about: 'About' }
const STROKES = [1, 1.5, 1.75, 2, 2.5, 3] as const

type View = { tab: Tab; cvd: Cvd; stroke: number; focus: string }
const DEFAULT_VIEW: View = { tab: 'finishes', cvd: 'none', stroke: 1.75, focus: '' }

// Atoms re-render the pane. They hold only the draft and the view: nothing is applied by holding them.
const draftA = atom({ plugin: 'finish-kit', key: 'draft' } as const, DEFAULT_FINISH, { shape: 'draft-1' })
const viewA = atom({ plugin: 'finish-kit', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-1' })
const appliedA = atom({ plugin: 'finish-kit', key: 'applied' } as const, '')
const monthA = atom({ plugin: 'finish-kit', key: 'month' } as const, -1)

// Feature switches are owned by the settings mod; this mod only reads them. Absent means the default.
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')

const isOn = (o: Record<string, boolean>, id: string, dflt: boolean): boolean => o[id] ?? dflt

const featureOn = async ($: Dollar, id: string, dflt: boolean): Promise<boolean> => isOn((await read($, featuresA)) as Record<string, boolean>, `finish-kit.${id}`, dflt)

// What the user chose with commands in this session. Nothing here applies anything.
const state = { remember: false, month: false, isApplied: false }

const getDraft = async ($: Dollar): Promise<Finish> => parseFinish(await read($, draftA)) ?? DEFAULT_FINISH

const getView = async ($: Dollar): Promise<View> => {
  const v = (await read($, viewA)) as Record<string, unknown>
  const tab = TABS.find(t => t === v.tab) ?? 'finishes'
  const cvd = CVDS.find(c => c === v.cvd) ?? 'none'
  const stroke = STROKES.find(s => s === v.stroke) ?? 1.75

  return { tab, cvd, stroke, focus: typeof v.focus === 'string' ? v.focus.slice(0, 40) : '' }
}

const setDraft = ($: Dollar, f: Finish) => update($, draftA, () => f)

const monthOf = async ($: Dollar): Promise<number> => new Date(await $.clock.now()).getMonth()

async function persist($: Dollar, f: Finish) {
  if (state.remember) {
    await $.store.set('finish', f)
  }
}

const LAST_WINS =
  'Note: the looks, skins and skins-plus mods also apply themes. A theme set is the whole theme, so whichever mod called last wins.'

// The only place that calls $.theme.set or $.theme.clear: exactly once per command (a retry happens only after a refusal).
async function applyFinish($: Dollar, f: Finish): Promise<string> {
  const resolved = resolve(f)

  if (resolved.refusal !== null || resolved.args === undefined) {
    return `Not applied: ${resolved.refusal ?? 'nothing to apply'}`
  }
  let args: ThemeSetArgs = resolved.args
  const dropped: string[] = []
  let drawn = ''
  let isSet = false

  // An older build may not take `style` or a scene: keep the colours and say what was left out.
  for (let attempt = 0; attempt < 3 && !isSet; attempt++) {
    try {
      const set = await $.theme.set(args)

      isSet = true
      drawn = set.isDrawn ? '' : ` (not drawn here: ${set.reason})`
    } catch (error) {
      if (args.style !== undefined) {
        const { style: _style, ...rest } = args

        args = rest
        dropped.push('style (this build refused it)')
      } else if (args.backdrop !== undefined) {
        const { backdrop: _backdrop, ...rest } = args

        args = rest
        dropped.push('backdrop (this build refused it)')
      } else {
        return `Not applied: ${String(error)}`
      }
    }
  }

  if (!isSet) {
    return 'Not applied: this build refused every attempt.'
  }
  state.isApplied = true
  await persist($, f)
  await update($, appliedA, () => describe(f))
  const soft = resolved.notes.length === 0 ? '' : ` (${resolved.notes.length} contrast note${resolved.notes.length === 1 ? '' : 's'}, still paints)`
  const extra = dropped.length === 0 ? '' : ` Left out: ${dropped.join(', ')}.`

  return `Applied: ${describe(f)}.${soft}${extra}${drawn}\n${LAST_WINS}`
}

const HELP = [
  '/fn                       this help',
  '/fnapply [options]        apply the draft finish with ONE theme call; options change the draft first',
  '                          gray=neutral|warm|cool tone=standard|off-white|true-black|sepia accent=#hex neutral=on|off',
  '                          contrast=normal|high ground=none|band|paper|noise|glass card=default|matte|glossy',
  '                          border=default|hairline|bold shape=default|pill|square headings=default|serif',
  '                          weights=default|hierarchy hand=on|off accents=#hex,#hex,... preset=<name> | off',
  `                          presets: ${PRESET_IDS.join(', ')}`,
  '/fnset [options]          change the draft only (the pane previews it); no theme call',
  '/fnpreview [tab]          open the studio pane: finishes, colour, surface, type, data, icons, about',
  '/fnaccent <hexes|name>    pick an accent: the most saturated mid-lightness colour of a pasted list of hex colours',
  '/fnmonth [on|off]         accent of the month for /fnapply when no accent is given (default off, command time only)',
  '/fnremember [on|off]      bring your applied finish back at session start (default off; also needs the remember switch)',
  '/fncvd [kind]             colour-blind preview: none, deuteranopia, protanopia, tritanopia (a simulation)',
  '/fnstroke [width]         icon stroke width of the previews: 1, 1.5, 1.75, 2, 2.5, 3',
  '/fnreset                  forget the saved finish, the month and remember settings, and reset the draft',
  'Nothing is applied until you type /fnapply. The last mod to call $.theme.set wins (looks and skins apply themes too).',
].join('\n')

const parseOnOff = (raw: string): boolean | null => {
  const w = raw.trim().toLowerCase()

  return w === 'on' || w === 'yes' ? true : w === 'off' || w === 'no' ? false : null
}

const namedAccent = (word: string): string | undefined => ACCENT_CHOICES.find(a => a.id === word)?.hex

// Works out the accent from a pasted list, a name, or `month`. Returns the hex and a sentence, or an error.
async function accentFrom($: Dollar, raw: string): Promise<{ hex: string; text: string } | { error: string }> {
  const word = raw.trim().toLowerCase()

  if (word === 'month') {
    const m = await monthOf($)

    return { hex: monthAccent(m), text: `the accent of ${MONTHS[m]}` }
  }
  const named = namedAccent(word)

  if (named !== undefined) {
    return { hex: named, text: `the named accent ${word}` }
  }
  const { colors, ignored } = parseHexList(raw)
  const picked = pickAccent(colors)

  if (picked === null) {
    return { error: 'No hex colours found. Paste colours such as #3b6fd4 #e8643c, or a name: ' + ACCENT_CHOICES.map(a => a.id).join(', ') + ', or month.' }
  }
  const skip = ignored === 0 ? '' : `; ${ignored} item${ignored === 1 ? '' : 's'} ignored`
  const how = picked.isMid
    ? `the most saturated mid-lightness colour of ${colors.length}`
    : `the most saturated of ${colors.length}, with its lightness pulled into the middle because none was mid-lightness`

  return { hex: picked.hex, text: `${how}${skip}. (An image cannot be decoded here: paste its colours as hex.)` }
}

async function runSet($: Dollar, raw: string): Promise<string> {
  const base = await getDraft($)
  const parsed = parseOpts(raw, base)

  if (parsed.errors.length > 0) {
    return `Nothing changed: ${parsed.errors.join('; ')}.`
  }
  let finish = parsed.finish
  let note = ''

  if (parsed.accentList !== null) {
    const got = await accentFrom($, parsed.accentList.replace(/,/g, ' '))

    if ('error' in got) {
      return `Nothing changed: ${got.error}`
    }
    finish = { ...finish, accent: got.hex }
    note = ` Accent ${got.hex}: ${got.text}`
  }
  await setDraft($, finish)

  return `Draft: ${describe(finish)}.${note}\nNothing is applied: /fnapply applies it, /fnpreview shows it.`
}

async function runApply($: Dollar, raw: string): Promise<string> {
  const word = raw.trim().toLowerCase()

  if (word === 'off' || word === 'clear' || word === 'none') {
    await $.theme.clear()
    state.isApplied = false
    await update($, appliedA, () => '')

    return `Cleared: the app's own look. (/fnapply off clears any mod's theme, not only this one's.)`
  }
  const base = await getDraft($)
  const parsed = parseOpts(raw, base)

  if (parsed.errors.length > 0) {
    return `Nothing applied: ${parsed.errors.join('; ')}.`
  }
  let finish = parsed.finish
  const lines: string[] = []

  if (parsed.accentList !== null) {
    const got = await accentFrom($, parsed.accentList.replace(/,/g, ' '))

    if ('error' in got) {
      return `Nothing applied: ${got.error}`
    }
    finish = { ...finish, accent: got.hex }
    lines.push(`Accent ${got.hex}: ${got.text}`)
  } else if (state.month && !parsed.changed.some(c => c.startsWith('accent=')) && (await featureOn($, 'month', true))) {
    const m = await monthOf($)

    finish = { ...finish, accent: monthAccent(m) }
    lines.push(`Accent of ${MONTHS[m]} (/fnmonth is on): ${finish.accent}`)
  }
  await setDraft($, finish)

  return [await applyFinish($, finish), ...lines].join('\n')
}

async function runMonth($: Dollar, raw: string): Promise<string> {
  const want = parseOnOff(raw)

  if (raw.trim() === '') {
    const m = await monthOf($)

    return `Accent of the month is ${state.month ? 'on' : 'off'}. This month (${MONTHS[m]}): ${monthAccent(m)}. When on, /fnapply uses it unless you give accent= or accents=. It never changes by itself: only when you type a command.`
  }

  if (want === null) {
    return 'Usage: /fnmonth on|off'
  }
  state.month = want

  if (want) {
    await $.store.set('month', true)
  } else {
    await $.store.delete('month')
  }

  return want ? 'Accent of the month on: the next /fnapply without an accent uses this month\'s colour. Nothing is applied now.' : 'Accent of the month off.'
}

async function runRemember($: Dollar, raw: string): Promise<string> {
  const want = parseOnOff(raw)

  if (raw.trim() === '') {
    return `Remember is ${state.remember ? 'on' : 'off'}. When on, your last applied finish comes back once at session start.`
  }

  if (want === null) {
    return 'Usage: /fnremember on|off'
  }
  state.remember = want

  if (!want) {
    await $.store.delete('remember')
    await $.store.delete('finish')

    return 'Remember off: the saved finish is deleted. New sessions start with whatever theme is already there.'
  }
  await $.store.set('remember', true)
  const armed = await featureOn($, 'remember', false)
  const tail = armed ? '' : ' The switch finish-kit.remember is off, so nothing comes back yet: /cfg feature finish-kit.remember on.'

  return `Remember on. The next /fnapply is saved and re-applied once at session start.${tail}`
}

async function runCvd($: Dollar, raw: string): Promise<string> {
  const word = raw.trim().toLowerCase()

  if (word === '') {
    const v = await getView($)

    return `Colour-blind preview: ${v.cvd}. Choices: ${CVDS.join(', ')}. It is a simulation by standard matrices, not a medical test, and it changes the previews only.`
  }
  const kind = CVDS.find(c => c === word)

  if (kind === undefined) {
    return `Usage: /fncvd ${CVDS.join('|')}`
  }
  await update($, viewA, v => ({ ...v, cvd: kind }))

  return `Previews now simulate ${kind}. (A simulation, previews only: the applied theme is never changed.)`
}

async function runStroke($: Dollar, raw: string): Promise<string> {
  const word = raw.trim()

  if (word === '') {
    return `Preview icon stroke width: ${(await getView($)).stroke}. Choices: ${STROKES.join(', ')}.`
  }
  const w = STROKES.find(s => String(s) === word)

  if (w === undefined) {
    return `Usage: /fnstroke ${STROKES.join('|')}`
  }
  await update($, viewA, v => ({ ...v, stroke: w }))

  return `Preview icons drawn at stroke width ${w}. (Previews only: the app draws its own icons.)`
}

async function runPreview($: Dollar, raw: string): Promise<string> {
  const word = raw.trim().toLowerCase()
  const tab = TABS.find(t => t === word)

  if (word !== '' && tab === undefined) {
    return `No tab called "${word}". Tabs: ${TABS.join(', ')}.`
  }
  const m = await monthOf($)

  await update($, monthA, () => m)

  if (tab !== undefined) {
    await update($, viewA, v => ({ ...v, tab }))
  }
  await $.ui.open({ id: PANE, title: 'Finish studio' }).catch(() => undefined)

  return 'Finish studio opened: previews of every finish, with Apply buttons. Nothing is applied until you press one.'
}

async function runReset($: Dollar): Promise<string> {
  state.remember = false
  state.month = false
  await $.store.delete('remember')
  await $.store.delete('month')
  await $.store.delete('finish')
  await setDraft($, DEFAULT_FINISH)
  await update($, viewA, () => DEFAULT_VIEW)
  await update($, appliedA, () => '')

  return "Finish studio reset: saved finish, remember and month settings deleted, draft and previews back to the defaults. The theme itself is untouched: /fnapply off clears it."
}

async function loadSaved($: Dollar) {
  state.remember = (await $.store.get('remember')) === true
  state.month = (await $.store.get('month')) === true

  if (!state.remember || !(await featureOn($, 'remember', false))) {
    return
  }
  const saved = parseFinish(await $.store.get('finish'))

  if (saved !== null) {
    await setDraft($, saved)
    await applyFinish($, saved)
  }
}

// ---- pane buttons: the same as typing the commands ----

async function press($: Dollar, kind: 'set' | 'apply' | 'tab' | 'cvd' | 'stroke' | 'preset', arg: string): Promise<void> {
  if (kind === 'set') {
    await runSet($, arg)
  } else if (kind === 'apply') {
    await runApply($, arg)
  } else if (kind === 'tab') {
    const tab = TABS.find(t => t === arg)

    if (tab !== undefined) {
      await update($, viewA, v => ({ ...v, tab }))
    }
  } else if (kind === 'cvd') {
    await runCvd($, arg)
  } else if (kind === 'stroke') {
    await runStroke($, arg)
  } else if (PRESETS[arg] !== undefined) {
    await setDraft($, withPreset(await getDraft($), arg))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['fn', 'Finish studio help: every /fn command in one line each'],
      ['fnapply', 'Apply the draft finish with one theme call: /fnapply warm paper serif, /fnapply preset oled, /fnapply off'],
      ['fnset', 'Change the draft finish only, to preview it: /fnset gray=warm tone=sepia'],
      ['fnpreview', 'Open the studio pane with live vector previews of every finish'],
      ['fnaccent', 'Pick an accent from a pasted list of hex colours, a name, or month'],
      ['fnmonth', 'Use the accent of the month in /fnapply: /fnmonth on|off (default off)'],
      ['fnremember', 'Bring your applied finish back at session start: /fnremember on|off (default off)'],
      ['fncvd', 'Colour-blind preview: /fncvd deuteranopia|protanopia|tritanopia|none'],
      ['fnstroke', 'Icon stroke width in the previews: /fnstroke 1|1.5|1.75|2|2.5|3'],
      ['fnreset', 'Forget the saved finish and settings, reset the draft'],
    ] as const) {
      await $.command.register({ name, description }).catch(() => undefined)
    }
    // Nothing is applied here unless the user turned /fnremember on, switched finish-kit.remember on, and has a saved finish.
    await loadSaved($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'fn' }, () => ({ text: HELP }))
  on('command.run', { command: 'fnapply' }, async ($, e) => ({ text: await runApply($, e.args) }))
  on('command.run', { command: 'fnset' }, async ($, e) => ({ text: await runSet($, e.args) }))
  on('command.run', { command: 'fnpreview' }, async ($, e) => ({ text: await runPreview($, e.args) }))
  on('command.run', { command: 'fnaccent' }, async ($, e) => {
    const got = await accentFrom($, e.args)

    if ('error' in got) {
      return { text: got.error }
    }
    await setDraft($, { ...(await getDraft($)), accent: got.hex })

    return { text: `Accent ${got.hex}: ${got.text}\nIt is in the draft; /fnapply applies it.` }
  })
  on('command.run', { command: 'fnmonth' }, async ($, e) => ({ text: await runMonth($, e.args) }))
  on('command.run', { command: 'fnremember' }, async ($, e) => ({ text: await runRemember($, e.args) }))
  on('command.run', { command: 'fncvd' }, async ($, e) => ({ text: await runCvd($, e.args) }))
  on('command.run', { command: 'fnstroke' }, async ($, e) => ({ text: await runStroke($, e.args) }))
  on('command.run', { command: 'fnreset' }, async $ => ({ text: await runReset($) }))

  // Idea 14 (switch finish-kit.title-icons, default off): a small icon in front of every pane title.
  on('ui.open', async ($, e, next) => {
    if (!(await featureOn($, 'title-icons', false))) {
      return next(e)
    }
    const pack = String(await read($, iconsA))

    return next({ ...e, title: withGlyph(e.title ?? e.id, e.id, pack) })
  })

  // The three still backdrops are drawn here; a scene from any other plugin goes on to the engine.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const svg = e.props.plugin === 'finish-kit' ? sceneSvg(e.props.scene, await getDraft($)) : undefined

    if (svg === undefined) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={svg} alt={SCENE_ALT[e.props.scene as keyof typeof SCENE_ALT] ?? 'A still backdrop'} isInteractive />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // The terminal has no Svg: it gets the text fallback.
    const Svg = 'Svg' in els ? els.Svg : undefined

    await read($, appliedA)
    const draft = await getDraft($)
    const view = await getView($)
    const month = (await read($, monthA)) as number
    const wantSvg = e.surface === 'desktop' && Svg !== undefined && (await featureOn($, 'svg-previews', true))
    const showCvd = await featureOn($, 'cvd-preview', true)
    const cvd: Cvd = showCvd ? view.cvd : 'none'
    const o: Opts = { cvd, stroke: view.stroke, month }
    const row = (name: string, items: readonly string[], active: string, make: (item: string) => string) => (
      <Box gap="sm" flexWrap="wrap">
        <Text dimColor mono>
          {name.padEnd(10)}
        </Text>
        {items.map(item => (
          <Button key={`${name}-${item}`} label={item === active ? `[${item}]` : item} onPress={() => press($, 'set', make(item))} />
        ))}
      </Box>
    )
    const art = (svg: string, alt: string, width: number, interactive = false) =>
      Svg === undefined ? null : <Svg source={svg} alt={alt} isInteractive={interactive} {...svgSize(svg, width)} />
    const sample = sampleSvg(draft, o)
    const a = anchorsOf(draft)
    const chip = (key: string, hex: string) => <Box key={key} width={4} height={1} backgroundColor={hex} />
    const fallback = (
      <Box flexDirection="column" gap="xs">
        <Text dimColor>No vector previews here (desktop only). Draft colours, light then dark: page, card, text, accent.</Text>
        <Box gap="xs">
          {[a.light.s0, a.light.s1, a.light.t1, rolesOf(draft).accent].map((hex, i) => chip(`l${i}`, hex))}
          <Text> </Text>
          {[a.dark.s0, a.dark.s1, a.dark.t1, rolesOf(draft).accent].map((hex, i) => chip(`d${i}`, hex))}
        </Box>
        <Text dimColor>Accent covers about {sample.share}% of the sample window.</Text>
      </Box>
    )
    let body: JSX.Element

    if (view.tab === 'finishes') {
      body = (
        <Box flexWrap="wrap" gap="sm">
          {PRESET_IDS.map(id => {
            const p = PRESETS[id]!
            const f = withPreset(draft, id)
            const mini = miniSvg(f, o)

            return (
              <Box key={`card-${id}`} flexDirection="column" width={44} padding="xs" borderStyle="round" borderColor="inactive" gap="xs">
                <Text weight="bold">{p.label}</Text>
                <Text dimColor size="caption">
                  {p.blurb}
                </Text>
                {wantSvg ? art(mini.svg, mini.alt, 330) : <Text dimColor>{describe(f)}</Text>}
                <Box gap="sm">
                  <Button key={`load-${id}`} label="Load into studio" onPress={() => press($, 'preset', id)} />
                  <Button key={`apply-${id}`} label="Apply" onPress={() => press($, 'apply', `preset=${id}`)} />
                </Box>
              </Box>
            )
          })}
        </Box>
      )
    } else if (view.tab === 'colour') {
      const c = colourSvg(draft, o, sample.share)

      body = (
        <Box flexDirection="column" gap="sm">
          {wantSvg ? art(sample.svg, sample.alt, 560) : fallback}
          {row('grays', GRAYS, draft.gray, i => `gray=${i}`)}
          {row('tone', TONES, draft.tone, i => `tone=${i}`)}
          {row('roles', ['on', 'off'], draft.neutralFirst ? 'on' : 'off', i => `neutral=${i}`)}
          <Box gap="sm" flexWrap="wrap">
            <Text dimColor mono>
              {'accent'.padEnd(10)}
            </Text>
            {ACCENT_CHOICES.map(ac => (
              <Button key={`accent-${ac.id}`} label={ac.hex === draft.accent ? `[${ac.label}]` : ac.label} onPress={() => press($, 'set', `accent=${ac.hex}`)} />
            ))}
            <Button key="accent-month" label="This month" onPress={() => press($, 'set', `accent=${monthAccentNow(month)}`)} />
          </Box>
          <Text dimColor size="caption">
            Neutral-first keeps the status roles muted so the grays carry the screen. Paste hex colours with /fnaccent #aaa #bbb ... to pick one.
          </Text>
          {wantSvg ? art(c.svg, c.alt, 560, true) : null}
        </Box>
      )
    } else if (view.tab === 'surface') {
      const s = surfaceSvg(draft, o)

      body = (
        <Box flexDirection="column" gap="sm">
          {wantSvg ? art(sample.svg, sample.alt, 560) : fallback}
          {row('ground', GROUNDS, draft.ground, i => `ground=${i}`)}
          {row('card', CARDS, draft.card, i => `card=${i}`)}
          {row('border', BORDERS, draft.border, i => `border=${i}`)}
          {row('corners', SHAPES, draft.shape, i => `shape=${i}`)}
          {row('contrast', CONTRASTS, draft.contrast, i => `contrast=${i}`)}
          <Text dimColor size="caption">
            Applied through the theme: ground, card, border, corners and contrast reach the person's bubble, tool rows and the backdrop. Buttons, chart insets, glow and dimming are previews only.
          </Text>
          {wantSvg ? art(s.svg, s.alt, 560) : null}
        </Box>
      )
    } else if (view.tab === 'type') {
      const t = typeSvg(draft, o)

      body = (
        <Box flexDirection="column" gap="sm">
          {wantSvg ? art(sample.svg, sample.alt, 560) : fallback}
          {row('headings', HEADINGS, draft.headings, i => `headings=${i}`)}
          {row('weights', WEIGHTS, draft.weights, i => `weights=${i}`)}
          {row('hand', ['on', 'off'], draft.hand ? 'on' : 'off', i => `hand=${i}`)}
          <Text dimColor size="caption">
            Only generic font families exist in the theme: serif headings and a handwriting face for your own messages are applied. Code ligatures and a slashed-zero font are skipped: no way to name a font or a font feature.
          </Text>
          {wantSvg ? art(t.svg, t.alt, 560) : null}
        </Box>
      )
    } else if (view.tab === 'data') {
      const d = dataSvg(draft, o)

      body = (
        <Box flexDirection="column" gap="sm">
          {row('simulate', CVDS, view.cvd, i => i)}
          <Text dimColor size="caption">
            Colour-blind view: a simulation by the standard matrices, not a medical test. It recolours every preview here, never the applied theme. Chart palettes and bars are previews only: other mods keep their own colours.
          </Text>
          {wantSvg ? art(d.svg, d.alt, 560, true) : <Text dimColor>Vector charts show on the desktop app.</Text>}
        </Box>
      )
    } else if (view.tab === 'icons') {
      const ic = iconsSvg(draft, o)

      body = (
        <Box flexDirection="column" gap="sm">
          <Box gap="sm" flexWrap="wrap">
            <Text dimColor mono>
              {'stroke'.padEnd(10)}
            </Text>
            {STROKES.map(s => (
              <Button key={`stroke-${s}`} label={s === view.stroke ? `[${s}]` : String(s)} onPress={() => press($, 'stroke', String(s))} />
            ))}
          </Box>
          <Text dimColor size="caption">
            Icons, empty states, glow and dimming are previews: the theme has no icon colour or width, and the app and other mods draw their own. Pane titles with an icon are real behind the finish-kit.title-icons switch (off by default).
          </Text>
          {wantSvg ? art(ic.svg, ic.alt, 560) : <Text dimColor>Vector icons show on the desktop app.</Text>}
        </Box>
      )
    } else {
      body = (
        <Box flexDirection="column" gap="xs">
          <Text weight="bold">Applied through the theme (one call per command)</Text>
          <Text dimColor>1 neutral-first palette, 2 warm or cool grays, 3 accent from a hex list, 4 monthly accent (command time only), 5 gradient header band, 6 frosted panes (glass), 8 paper backdrop, 18 noise on dark, 9 matte or glossy cards, 10 borders, 13 corner shape, 21 off-white, 22 true black, 23 sepia, 24 high contrast, 25 weights, 26 serif headings.</Text>
          <Text weight="bold">Partial</Text>
          <Text dimColor>9, 10 and 13 reach the person's bubble and tool rows, not buttons. 14 titles with an icon needs its switch. 27 handwriting is for your own messages, not notes. 20 colour-blind view is a preview simulation.</Text>
          <Text weight="bold">Previews only</Text>
          {PREVIEW_ONLY.map(p => (
            <Text key={`po-${p.n}`} dimColor>
              {p.n} {p.what}: {p.why}.
            </Text>
          ))}
          <Text weight="bold">Skipped</Text>
          {SKIPPED.map(p => (
            <Text key={`sk-${p.n}`} dimColor>
              {p.n} {p.what}: {p.why}.
            </Text>
          ))}
          <Text dimColor>{LAST_WINS}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding="sm" gap="sm">
        <Text size="heading" weight="bold">
          Finish studio
        </Text>
        <Text dimColor>Draft: {describe(draft)}. Nothing changes until you press Apply or type /fnapply.</Text>
        <Box gap="sm" flexWrap="wrap">
          {TABS.map(t => (
            <Button key={`tab-${t}`} label={t === view.tab ? `[${TAB_LABEL[t]}]` : TAB_LABEL[t]} onPress={() => press($, 'tab', t)} />
          ))}
        </Box>
        <Box gap="sm" flexWrap="wrap">
          <Button key="apply-draft" label="Apply this draft" onPress={() => press($, 'apply', '')} />
          <Button key="apply-off" label="Back to the app's own look" onPress={() => press($, 'apply', 'off')} />
        </Box>
        {body}
      </Box>
    )
  })
}

const monthAccentNow = (month: number): string => monthAccent(month >= 0 ? month : 0)
