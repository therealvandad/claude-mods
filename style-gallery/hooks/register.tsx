import { atom, read, update } from 'claude-code'
import type { ElementTable, Hook, Register } from 'claude-code'

import type { ChipId, GalleryView, SortId, TabId } from '../types'
import { CHIPS, COMMANDS, FEATURE_DEFAULTS, MOD, PANE_ID, SAMPLES, TABS, byId, tabLabel } from './catalog'
import type { Sample } from './catalog'
import {
  DEFAULT_VIEW,
  DEMO_ITEMS,
  DEMO_PAGE_SIZE,
  PAGE_SIZE,
  askText,
  cleanQuery,
  copyText,
  current,
  findSample,
  groupByTab,
  fromStore,
  hasFilter,
  helpText,
  inTab,
  listRows,
  listText,
  normView,
  paginate,
  parseSwitch,
  parseTarget,
  step,
  storable,
  tabCounts,
  visible,
  withSticky,
} from './pure'
import { sampleAlt, sampleSvg } from './svg'
import type { Accent } from './svg'

// The desktop needs both a width and a height, else it draws the picture in a short default box and shrinks it.
const svgSize = (source: string, want?: number) => {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(source)
  const w = Number(box?.[1] ?? 360)
  const h = Number(box?.[2] ?? 120)
  const width = Math.round(want ?? w)

  return { width, height: Math.max(1, Math.round((width * h) / w)) }
}

type Dollar = Parameters<Hook<'session.start'>>[0]

// Change a tag when a value's fields change: it declines what an earlier version stored.
const viewA = atom({ plugin: 'style-gallery', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-1' })

// Shared look and switch values owned by other mods (read only; this mod never writes them).
const motionIsOn = atom({ plugin: 'motion', key: 'isOn' } as const, true)
const isCalmA = atom({ plugin: 'settings', key: 'isCalm' } as const, false)
const accentA = atom({ plugin: 'settings', key: 'accent' } as const, 'suggestion')
const densityA = atom({ plugin: 'settings', key: 'density' } as const, 'normal')
const iconsA = atom({ plugin: 'settings', key: 'icons' } as const, 'symbols')
const featuresA = atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })

const on = (o: Record<string, boolean>, id: string, dflt: boolean) => o[id] ?? dflt
// The full switch name is `<mod>.<id>`; an absent override means the switch's default.
const sw = (o: Record<string, boolean>, id: string) => on(o, `${MOD}.${id}`, FEATURE_DEFAULTS[id] ?? false)

// ------------------------------------------------------------------ top-level actions (the only functions that get `$`)

const patch = async ($: Dollar, change: Partial<GalleryView>): Promise<GalleryView> => {
  const before = await read($, viewA)
  const next = normView({ ...before, ...change })
  await update($, viewA, () => next)
  const a = storable(before)
  const b = storable(next)

  if (a.tab !== b.tab || a.sort !== b.sort || a.grid !== b.grid) {
    await $.store.set('view', b)
  }

  return next
}

const setTab = ($: Dollar, tab: TabId) => patch($, { tab, page: 1, msg: '' })
const setQuery = ($: Dollar, text: string) => patch($, { query: cleanQuery(text), page: 1, msg: '' })
const clearFilters = ($: Dollar) => patch($, { query: '', chips: [], page: 1, msg: '' })
const setPage = ($: Dollar, page: number) => patch($, { page })
const setDemoPage = ($: Dollar, demoPage: number) => patch($, { demoPage })
const toggleGrid = async ($: Dollar) => patch($, { grid: !(await read($, viewA)).grid })
const select = async ($: Dollar, id: string) => patch($, { selected: (await read($, viewA)).selected === id ? '' : id, msg: '' })
const goto = ($: Dollar, id: string) => patch($, { selected: id, tab: byId(id)?.tab ?? 'surfaces', query: '', chips: [], msg: '' })

const toggleChip = async ($: Dollar, id: ChipId) => {
  const v = await read($, viewA)

  return patch($, { chips: v.chips.includes(id) ? v.chips.filter(c => c !== id) : [...v.chips, id], page: 1, msg: '' })
}

const setSort = async ($: Dollar, sort: SortId) => patch($, { sort: (await read($, viewA)).sort === sort ? 'id' : sort })

// Appends to what is in the prompt box (never replaces a draft); a refusal is reported, not hidden.
const fillPrompt = async ($: Dollar, text: string): Promise<boolean> => {
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const prefix = box.text.trim() === '' ? '' : '\n\n'
  const done = await $.prompt.fill({ text: prefix + text, mode: 'append' }).catch(() => undefined)

  return done?.isFilled === true
}

const copySpec = async ($: Dollar, s: Sample, ask: boolean): Promise<string> => {
  const ok = await fillPrompt($, ask ? askText(s) : copyText(s))
  const msg = ok ? `${ask ? 'Asked for' : 'Copied the spec of'} "${s.title}" (${s.id}) into the prompt box.` : `The prompt box did not take the text for "${s.title}". Try /sgcopy ${s.id}.`
  await patch($, { msg })

  return msg
}

const openPane = ($: Dollar) => $.ui.open({ id: PANE_ID, title: 'Style gallery' })

const stepFrom = async ($: Dollar, dir: 1 | -1) => {
  const v = await read($, viewA)
  const shown = inTab(visible(v, hasFilter(v)), v.tab)

  return patch($, { selected: step({ selected: current(v, shown)?.id ?? '' }, shown, dir), msg: '' })
}

// ------------------------------------------------------------------ small pure view helpers

const dividerLine = (label: string, width: number) => {
  const room = Math.max(8, Math.min(width, 100) - label.length - 4)
  const left = Math.floor(room / 2)

  return `${'─'.repeat(left)} ${label} ${'─'.repeat(room - left)}`
}

const padFor = (density: string): 'xs' | 'sm' | 'md' => (density === 'compact' ? 'xs' : density === 'airy' ? 'md' : 'sm')

const markers = (icons: string) => (icons === 'letters' ? { on: '[x]', off: '[ ]' } : { on: '●', off: '○' })

export const register: Register = on_ => {
  on_('session.start', async ($, e, next) => {
    const saved = await $.store.get('view')
    await update($, viewA, () => fromStore(saved))

    for (const c of COMMANDS) {
      await $.command.register({ name: c.name, description: c.description }).catch(() => undefined)
    }

    return next(e)
  })

  on_('command.run', { command: 'sg' }, async () => ({ text: helpText() }))

  on_('command.run', { command: 'sglist' }, async (_$, e) => ({ text: listText(e.args) }))

  on_('command.run', { command: 'sgdemo' }, async ($, e) => {
    const target = parseTarget(e.args)

    if (target.error !== undefined) {
      return { text: target.error }
    }

    if (target.sample !== undefined) {
      await goto($, target.sample.id)
    } else {
      await patch($, { tab: target.tab ?? 'surfaces', query: '', chips: [], page: 1, msg: '' })
    }
    const opened = await openPane($).catch(() => ({ isPlaced: false }))

    return {
      text: `${opened.isPlaced ? 'Opened' : 'Prepared'} the Style gallery pane on ${target.sample === undefined ? tabLabel(target.tab ?? 'surfaces') : `the "${target.sample.title}" sample`}. The gallery shows styles only: it cannot restyle other mods or the app.`,
    }
  })

  on_('command.run', { command: 'sgcopy' }, async ($, e) => {
    const found = findSample(e.args)

    if (found.sample === undefined) {
      return { text: found.error ?? 'No such sample.' }
    }

    return { text: await copySpec($, found.sample, false) }
  })

  on_('command.run', { command: 'sggrid' }, async ($, e) => {
    const arg = e.args.trim()
    const asked = parseSwitch(arg)

    if (arg !== '' && asked === undefined) {
      return { text: 'Use /sggrid on, /sggrid off, or /sggrid to flip it.' }
    }
    const overrides = await read($, featuresA)

    if (!sw(overrides, 'grid-overlay')) {
      return { text: 'The grid overlay switch is off. Turn it on with /cfg feature style-gallery.grid-overlay on.' }
    }
    const v = await read($, viewA)
    const next = await patch($, { grid: asked ?? !v.grid })

    return { text: `Spacing grid ${next.grid ? 'on' : 'off'}: it is drawn over the vector samples of the gallery only, on the desktop app.` }
  })

  on_('command.run', { command: 'sgreset' }, async $ => {
    await update($, viewA, () => DEFAULT_VIEW)
    await $.store.set('view', storable(DEFAULT_VIEW))

    return { text: 'Style gallery reset: tab, search, filters, sort, selection and grid are back to the defaults.' }
  })

  on_('ui.render', { component: 'Pane', requestId: 'style-gallery-main' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Input } = ui
    const Svg = e.surface === 'desktop' ? (ui as ElementTable<'desktop'>).Svg : undefined
    const v = await read($, viewA)
    const o = await read($, featuresA)
    const accent = (await read($, accentA)) as Accent
    const icons = await read($, iconsA)
    const pad = padFor(await read($, densityA))
    const calm = await read($, isCalmA)
    const motion = await read($, motionIsOn)
    const mk = markers(icons)
    const isDesktop = e.surface === 'desktop'
    const small = e.surface !== 'terminal'

    const useSvg = Svg !== undefined && sw(o, 'svg')
    const ctx = { accent, animate: sw(o, 'animate') && motion && !calm, grid: v.grid && sw(o, 'grid-overlay'), tips: sw(o, 'tooltips') }
    const toolbar = sw(o, 'toolbar')
    const filtered = toolbar && hasFilter(v)
    const shown = visible({ query: toolbar ? v.query : '', chips: toolbar ? v.chips : [], sort: v.sort }, filtered)
    const counts = tabCounts(shown)
    const inThisTab = inTab(shown, v.tab)
    const sel = current(v, inThisTab)
    const selected = v.selected === '' ? undefined : byId(v.selected)
    const cols = e.props.bodyColumns

    // ---- header rows (each one tree row: the sticky headers count them)
    let above = 0
    const crumbs = (
      <Box flexDirection="row" gap={1}>
        <Button key="crumb:home" plain onPress={() => setTab($, 'surfaces')}>
          Gallery
        </Button>
        <Text dimColor>›</Text>
        <Button key="crumb:tab" plain onPress={() => patch($, { selected: '', msg: '' })}>
          {tabLabel(v.tab)}
        </Button>
        {selected !== undefined && <Text dimColor>›</Text>}
        {selected !== undefined && <Text bold>{selected.title}</Text>}
      </Box>
    )
    above += 1
    const note = (
      <Text dimColor wrap="truncate-end" {...(small ? { size: 'caption' as const } : {})}>
        A gallery of styles: it shows them, it cannot restyle other mods or the app.
      </Text>
    )
    above += 1
    const tabs = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {TABS.map(t => {
          const icon = t.icons[icons === 'letters' || icons === 'minimal' ? icons : 'symbols']

          return (
            <Button key={`tab:${t.id}`} {...(v.tab === t.id ? { variant: 'primary' as const } : { plain: true as const })} onPress={() => setTab($, t.id)}>
              {`${icon === '' ? '' : `${icon} `}${t.label} ${counts[t.id]}`}
            </Button>
          )
        })}
      </Box>
    )
    above += 1

    const bar = toolbar ? (
        <Box flexDirection="column">
          <Input
            key="sg-q"
            label="⌕ "
            placeholder="search id, name, kind (radius, badge, nav...)"
            value={v.query}
            submitLabel="search"
            onInput={text => setQuery($, text)}
            onSubmit={text => setQuery($, text)}
          />
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>filter</Text>
            {CHIPS.map(c => (
              <Button key={`chip:${c.id}`} {...(v.chips.includes(c.id) ? { variant: 'primary' as const } : { plain: true as const })} onPress={() => toggleChip($, c.id)}>
                {`${v.chips.includes(c.id) ? mk.on : mk.off} ${c.label}`}
              </Button>
            ))}
            {filtered && (
              <Button key="clear" plain dimColor onPress={() => clearFilters($)}>
                clear
              </Button>
            )}
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>sort</Text>
            {(['name', 'kind'] as const).map(s => (
              <Button key={`sort:${s}`} {...(v.sort === s ? { variant: 'primary' as const } : { plain: true as const })} onPress={() => setSort($, s)}>
                {v.sort === s ? `${s} ✓` : s}
              </Button>
            ))}
            <Text dimColor>{`${shown.length} of ${SAMPLES.length} samples`}</Text>
          </Box>
        </Box>
    ) : null
    above += toolbar ? 3 : 0
    above += filtered ? 1 : 0

    // ---- one sample as a card
    const card = (s: Sample) => {
      const isSel = sel?.id === s.id
      const svg = useSvg && Svg !== undefined ? sampleSvg(s.id, ctx) : ''

      return (
        <Box flexDirection="column" borderStyle="round" borderColor={isSel ? accent : 'subtle'} paddingX={1}>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text bold color={accent}>
              {s.id}
            </Text>
            <Text bold>{s.title}</Text>
            <Text dimColor>{`${s.status} · ${s.kind} · ${s.family}`}</Text>
          </Box>
          {svg !== '' && Svg !== undefined && <Svg source={svg} alt={sampleAlt(s)} isInteractive={ctx.tips || ctx.animate} {...svgSize(svg, 520)} />}
          {svg === '' &&
            s.text.map(line => (
              <Text mono wrap="truncate-end">
                {line}
              </Text>
            ))}
          <Text dimColor wrap="wrap">
            {s.blurb}
          </Text>
          {s.note !== '' && (
            <Text dimColor italic wrap="wrap">
              {s.note}
            </Text>
          )}
          {s.id === 'divider' && <Text dimColor>{dividerLine('live example', cols - 4)}</Text>}
          {s.id === 'paging' && demo()}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key={`sel:${s.id}`} plain onPress={() => select($, s.id)}>
              {isSel && v.selected === s.id ? 'selected ✓' : 'select'}
            </Button>
            <Button key={`copy:${s.id}`} plain onPress={() => copySpec($, s, false)}>
              copy spec
            </Button>
            {s.id === 'spacing' && sw(o, 'grid-overlay') && (
              <Button key="grid:card" {...(v.grid ? { variant: 'primary' as const } : { plain: true as const })} onPress={() => toggleGrid($)}>
                {`grid overlay ${v.grid ? 'on' : 'off'}`}
              </Button>
            )}
          </Box>
        </Box>
      )
    }

    // ---- 206: pages that work, endless scroll as a preview, side by side
    const demo = () => {
      const items = Array.from({ length: DEMO_ITEMS }, (_, i) => `Sample row ${i + 1}`)
      const p = paginate(items, v.demoPage, DEMO_PAGE_SIZE)

      return (
        <Box flexDirection="row" gap={3} flexWrap="wrap">
          <Box flexDirection="column">
            <Text bold>pages</Text>
            {p.items.map(item => (
              <Text>{item}</Text>
            ))}
            <Box flexDirection="row" gap={1}>
              <Button key="demo:prev" plain onPress={() => setDemoPage($, p.page - 1)}>
                ‹ prev
              </Button>
              <Text>{`${p.page} / ${p.pages}`}</Text>
              <Button key="demo:next" plain onPress={() => setDemoPage($, p.page + 1)}>
                next ›
              </Button>
            </Box>
          </Box>
          <Box flexDirection="column">
            <Text bold dimColor>
              endless (preview)
            </Text>
            {items.slice(0, 3).map(item => (
              <Text dimColor>{item}</Text>
            ))}
            <Text dimColor>░░░░░░░░░░</Text>
            <Text dimColor>▒ loading more…</Text>
          </Box>
        </Box>
      )
    }

    // ---- the List tab: grouped rows, zebra, a band on the current row, sticky group headers
    const listBody = () => {
      const page = paginate(groupByTab(shown), v.page, PAGE_SIZE)
      const rows = listRows(page.items, counts)
      const sticky = sw(o, 'sticky-headers')
      const items = sticky ? withSticky(rows, e.props.scroll.offset, above + 1) : rows
      let n = 0

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="list:prev" plain onPress={() => setPage($, page.page - 1)}>
              ‹ prev
            </Button>
            <Text dimColor>{`page ${page.page} / ${page.pages}`}</Text>
            <Button key="list:next" plain onPress={() => setPage($, page.page + 1)}>
              next ›
            </Button>
          </Box>
          {items.map(r => {
            if (r.isHeader === true) {
              return (
                <Text bold color={accent} wrap="truncate-end">
                  {`▼ ${r.title ?? ''} ${r.count ?? 0}${r.isSticky === true ? ' ↑' : ''}`}
                </Text>
              )
            }
            const s = r.sample

            if (s === undefined) {
              return null
            }
            n += 1
            const isCur = v.selected === s.id
            const isOdd = sw(o, 'zebra') && n % 2 === 0
            const bg = !sw(o, 'zebra') || !isDesktop ? {} : isCur ? { backgroundColor: 'rgba(128,128,128,0.18)' } : isOdd ? { backgroundColor: 'rgba(128,128,128,0.02)' } : {}

            return (
              <Box flexDirection="row" gap={1} {...bg}>
                <Text color={accent}>{isCur ? '▌' : ' '}</Text>
                <Button key={`row:${s.id}`} plain dimColor={isOdd && !isDesktop} onPress={() => select($, s.id)}>
                  {`${s.id.padEnd(11)} ${s.title}`}
                </Button>
                <Text dimColor>{`${s.status} · ${s.kind}`}</Text>
                <Button key={`open:${s.id}`} plain dimColor onPress={() => goto($, s.id)}>
                  open
                </Button>
              </Box>
            )
          })}
          {rows.length === 0 && <Text dimColor>No sample matches. Press clear to see all of them.</Text>}
        </Box>
      )
    }

    const body =
      v.tab === 'list' ? (
        listBody()
      ) : inThisTab.length === 0 ? (
        <Box flexDirection="column">
          <Text dimColor>{`No sample in ${tabLabel(v.tab)} matches the search or filters.`}</Text>
          <Button key="to-list" plain onPress={() => setTab($, 'list')}>
            {`see the ${counts.list} matches in the List tab`}
          </Button>
        </Box>
      ) : (
        <Box flexDirection="column" gap={pad === 'xs' ? 0 : 1}>
          {inThisTab.map(s => card(s))}
        </Box>
      )

    const footer = sw(o, 'footer') && (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="foot:prev" plain onPress={() => stepFrom($, -1)}>
          ◀ prev
        </Button>
        <Button key="foot:next" plain onPress={() => stepFrom($, 1)}>
          next ▶
        </Button>
        <Button key="foot:copy" plain onPress={() => (sel === undefined ? undefined : copySpec($, sel, false))}>
          {`copy spec${sel === undefined ? '' : `: ${sel.id}`}`}
        </Button>
        {sw(o, 'grid-overlay') && (
          <Button key="foot:grid" plain onPress={() => toggleGrid($)}>
            {`grid ${v.grid ? 'on' : 'off'}`}
          </Button>
        )}
      </Box>
    )

    const fab = sw(o, 'fab') && sel !== undefined && (
      <Box flexDirection="row" justifyContent="flex-end">
        <Button key="fab" variant="primary" onPress={() => copySpec($, sel, true)}>
          + Ask for this style
        </Button>
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={pad === 'xs' ? 0 : 1}>
        {crumbs}
        {note}
        {tabs}
        {bar}
        {filtered && (
          <Text dimColor wrap="truncate-end">
            {`Filtered: ${shown.length} of ${SAMPLES.length} samples match (all tabs).`}
          </Text>
        )}
        {body}
        <Text dimColor wrap="truncate-end">
          {dividerLine(v.tab === 'list' ? 'list' : tabLabel(v.tab), cols - 2)}
        </Text>
        {v.msg !== '' && <Text color="success">{v.msg}</Text>}
        {footer}
        {fab}
      </Box>
    )
  })
}
