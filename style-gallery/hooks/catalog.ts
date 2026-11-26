// The gallery's samples: plain data, no `$`. Every sample has an id, a written spec (what /sgcopy puts in the prompt box)
// and a text version (what the terminal, VS Code and mobile draw, and what the desktop draws with vector samples off).
import type { ChipId, TabId } from '../types'

export type Kind = 'shape' | 'color' | 'state' | 'label' | 'feedback' | 'art' | 'mode' | 'nav' | 'layout' | 'control'
export type Family = 'look' | 'ui'
export type Status = 'live' | 'preview'

export type Sample = {
  /** The idea number in the brief (for the report and the tests; not shown). */
  no: number
  id: string
  tab: Exclude<TabId, 'list'>
  title: string
  kind: Kind
  family: Family
  status: Status
  /** One line: what the style is. */
  blurb: string
  /** What is real and what is not. */
  note: string
  /** The short written spec that /sgcopy and the buttons put in the prompt box. */
  spec: string
  /** Text version for surfaces without vector images. */
  text: readonly string[]
}

export const TABS: readonly { id: TabId; label: string; icons: Record<'letters' | 'symbols' | 'minimal', string> }[] = [
  { id: 'surfaces', label: 'Surfaces', icons: { letters: 'S', symbols: '▭', minimal: '' } },
  { id: 'controls', label: 'Controls', icons: { letters: 'C', symbols: '◉', minimal: '' } },
  { id: 'feedback', label: 'Feedback', icons: { letters: 'F', symbols: '◔', minimal: '' } },
  { id: 'navigation', label: 'Navigation', icons: { letters: 'N', symbols: '➤', minimal: '' } },
  { id: 'modes', label: 'Modes', icons: { letters: 'M', symbols: '◐', minimal: '' } },
  { id: 'list', label: 'List', icons: { letters: 'L', symbols: '☰', minimal: '' } },
]

export const CHIPS: readonly { id: ChipId; label: string; group: 'status' | 'family'; hint: string }[] = [
  { id: 'live', label: 'live', group: 'status', hint: 'works in this pane' },
  { id: 'preview', label: 'preview', group: 'status', hint: 'drawn only' },
  { id: 'look', label: 'look', group: 'family', hint: 'a look: colours, shapes, modes' },
  { id: 'ui', label: 'ui', group: 'family', hint: 'a UI pattern: navigation, controls' },
]

const NOT_RESTYLE = 'Preview: this gallery draws the style; it cannot restyle other mods or the app.'

export const SAMPLES: readonly Sample[] = [
  {
    no: 31, id: 'radius', tab: 'surfaces', title: 'Radius scale', kind: 'shape', family: 'look', status: 'preview',
    blurb: 'Three corner sizes shown on cards: small, medium, large.',
    note: NOT_RESTYLE,
    spec: 'Radius scale: 4 px for inputs, chips and badges; 8 px for cards and menus; 16 px for panels, sheets and dialogs. Pills (fully round) only for toasts and tags. A shape nested inside another uses the outer radius minus the gap between them.',
    text: ['sm   4 px  ┌──────┐  inputs, chips, badges', 'md   8 px  ╭──────╮  cards, menus', 'lg  16 px  (      )  panels, sheets, dialogs'],
  },
  {
    no: 32, id: 'elevation', tab: 'surfaces', title: 'Elevation scale', kind: 'shape', family: 'look', status: 'preview',
    blurb: 'Four levels from flat to modal, with shadow and surface lift.',
    note: NOT_RESTYLE,
    spec: 'Elevation scale, four levels: 0 flat (no shadow), 1 raised (1 px offset, 2 px blur, 12% black; cards), 2 overlay (4 px, 10 px blur, 16%; menus and popovers), 3 modal (12 px, 28 px blur, 22%; dialogs). In dark mode lift the surface colour one step per level instead of relying on shadow.',
    text: ['0 flat     no shadow', '1 raised   ░ 1/2 px   cards', '2 overlay  ▒ 4/10 px  menus, popovers', '3 modal    ▓ 12/28 px dialogs'],
  },
  {
    no: 33, id: 'spacing', tab: 'surfaces', title: 'Spacing guide (4 px grid)', kind: 'shape', family: 'look', status: 'live',
    blurb: 'The 4 px scale, with a toggle that draws the grid over every vector sample.',
    note: 'Live: the grid toggle in the footer (or /sggrid) draws the 4 px grid over this gallery\'s own samples. It cannot draw over other mods.',
    spec: 'Spacing on a 4 px grid: 4, 8, 12, 16, 24, 32 (xs to 2xl). Gaps inside a control 4 to 8, between controls 8 to 12, card padding 16, section gaps 24 to 32. Never use a value that is not a multiple of 4.',
    text: ['xs  4   ▪', 'sm  8   ▪▪', 'md 12   ▪▪▪', 'lg 16   ▪▪▪▪', 'xl 24   ▪▪▪▪▪▪', '2xl 32  ▪▪▪▪▪▪▪▪'],
  },
  {
    no: 34, id: 'zebra', tab: 'surfaces', title: 'Zebra rows (2%)', kind: 'color', family: 'look', status: 'live',
    blurb: 'Every second row tinted at about 2% contrast.',
    note: 'Live in the List tab: desktop uses a subtle background, other surfaces dim every second row. Unverified without the live app.',
    spec: 'Zebra rows at about 2% contrast: every second row gets the text colour at 2% opacity, no borders. If rows need more separation use a 1 px divider, not a stronger stripe. Do not stripe tables with fewer than 6 rows.',
    text: ['row 1  name    value', 'row 2  name    value   (dimmed: the 2% stripe)', 'row 3  name    value', 'row 4  name    value   (dimmed)'],
  },
  {
    no: 35, id: 'highlight', tab: 'surfaces', title: 'Highlight band', kind: 'color', family: 'look', status: 'live',
    blurb: 'The current row gets an accent band and a bar on its left edge.',
    note: 'Live in the List tab: the selected row has a band on desktop and a marker everywhere.',
    spec: 'Current-row highlight band: the active row gets the accent colour at 12% as a full-width band, a 3 px solid accent bar on its left edge and semibold text. Hover is the same band at 5%. Keep the band inside the row radius.',
    text: ['  row one', '▌ row two   <- the current row (accent band, bar on the left)', '  row three'],
  },
  {
    no: 39, id: 'divider', tab: 'surfaces', title: 'Dividers with a label', kind: 'layout', family: 'look', status: 'live',
    blurb: 'A line broken by a centred label.',
    note: 'Live: this pane uses one between the samples and the footer.',
    spec: 'Dividers with a centred label: a 1 px line in the border colour, interrupted by a small label (11 px, muted) with 12 px padding each side. Use for "or", dates and section breaks; the accent variant marks the current section.',
    text: ['──────────── or ────────────', '──────────── Today ────────────', 'Section ─────────────────────'],
  },
  {
    no: 36, id: 'selection', tab: 'controls', title: 'Selection colour', kind: 'color', family: 'look', status: 'preview',
    blurb: 'Selected text uses the accent at 28%, so it follows the accent setting.',
    note: 'Preview: the app\'s own text selection cannot be recoloured.',
    spec: 'Text selection colour tied to the accent: selected text background is the accent at 28% opacity (light and dark), the text colour is unchanged. When the accent setting changes, the selection colour follows it.',
    text: ['Some text with [a selected span] in the accent colour', 'accents: suggestion claude success warning permission remember'],
  },
  {
    no: 37, id: 'focus', tab: 'controls', title: 'Focus ring with offset and glow', kind: 'state', family: 'look', status: 'preview',
    blurb: 'A 2 px ring, 2 px away from the control, with a soft glow.',
    note: NOT_RESTYLE,
    spec: 'Focus ring: 2 px accent ring, offset 2 px from the control, plus a soft glow (accent at 35%, 6 px blur). Shown for keyboard focus only; the ring never clips and follows the control radius plus the offset.',
    text: ['[ Button ]            resting', '( [ Button ] )          focused: ring, 2 px gap, glow'],
  },
  {
    no: 38, id: 'scrollbar', tab: 'controls', title: 'Thin overlay scrollbar', kind: 'control', family: 'look', status: 'preview',
    blurb: 'A 6 px thumb floating over the content that widens on hover.',
    note: 'Preview only: the app\'s own scrollbars cannot be restyled.',
    spec: 'Thin overlay scrollbars: 6 px thumb that floats over content (no track, no layout shift), muted text colour at 40%; it widens to 10 px and darkens to 70% on hover or drag, and fades out after 1 s idle.',
    text: ['│ content          ▕', '│ content          ▕█', '│ content          ▕█   6 px, widens to 10 px on hover', '│ content          ▕'],
  },
  {
    no: 40, id: 'badge', tab: 'controls', title: 'Badges: filled, outline, soft', kind: 'label', family: 'look', status: 'preview',
    blurb: 'Three badge styles in three tones.',
    note: NOT_RESTYLE,
    spec: 'Three badge styles, 20 px tall, 4 px radius, 11 px semibold text: filled (solid tone, inverse text), outline (1 px tone border, tone text), soft (tone at 16% fill, tone text). Tones: info (accent), success, warning. Use soft by default, filled only for counts that need attention.',
    text: ['filled   ■ info   ■ ok   ■ warn', 'outline  [info]  [ok]  [warn]', 'soft     ░info░  ░ok░  ░warn░'],
  },
  {
    no: 41, id: 'chip', tab: 'controls', title: 'Chips with a leading dot', kind: 'label', family: 'look', status: 'preview',
    blurb: 'Pill chips that start with a status dot.',
    note: 'Preview: the filter chips of this pane use the same dot (on: filled, off: hollow).',
    spec: 'Chips with a leading dot: 24 px tall, pill shape, 1 px border, 8 px dot in the status colour before the label, 8 px gap. Selected chips get a soft accent fill; removable chips end with a small x.',
    text: ['● build passing   ● review needed   ○ draft   ● live ×'],
  },
  {
    no: 209, id: 'fab', tab: 'controls', title: 'Floating action button', kind: 'control', family: 'ui', status: 'live',
    blurb: 'One primary action pinned last: the + Ask button at the end of this pane.',
    note: 'Live: the button at the end of the pane. It is the last row of the pane, not a floating layer (panes cannot draw over content).',
    spec: 'Floating action button: one primary action pinned to the bottom right, 48 px circle with a plus, accent fill, elevation 2, 16 px from the edges; the extended form adds a label. Only one per pane.',
    text: ['                                    ( + )', '                         [ + Ask for this style ]'],
  },
  {
    no: 210, id: 'ctxmenu', tab: 'controls', title: 'Context menu on a tile', kind: 'control', family: 'ui', status: 'preview',
    blurb: 'A right-click menu with shortcut hints and a highlighted row.',
    note: 'Preview only: the app\'s ContextMenu hook fires on transcript rows, links, selections and code, so it cannot attach to this pane\'s own drawings or boxes.',
    spec: 'Context menus on tiles: right-click (or long press) a tile opens a 200 px menu, 8 px radius, elevation 2, items 32 px tall with a shortcut hint on the right, a divider before the main action, the active item uses the highlight band.',
    text: ['┌ tile ┐ ╭──────────────────╮', '│      │ │ Copy spec      C │', '└──────┘ │ Open in List   L │', '         │──────────────────│', '         │ Ask for this   A │', '         ╰──────────────────╯'],
  },
  {
    no: 42, id: 'toast', tab: 'feedback', title: 'Toast: pill and card', kind: 'feedback', family: 'look', status: 'preview',
    blurb: 'Two toast styles, side by side.',
    note: 'Preview only: the real $.ui.toast is plain text, it has no pill or card look.',
    spec: 'Toast styles: pill (single line, fully rounded, dot plus text, bottom centre, 3 s) and card (title, one line of body, optional action, 8 px radius, elevation 2, top right, 5 s). Never stack more than 3; newest on top.',
    text: ['( ● Saved to the project )            pill', '╭────────────────────────╮', '│ Build finished         │   card', '│ 12 tests passed  [View]│', '╰────────────────────────╯'],
  },
  {
    no: 43, id: 'tooltip', tab: 'feedback', title: 'Tooltip with a pointer', kind: 'feedback', family: 'look', status: 'preview',
    blurb: 'A dark bubble with a pointer, above and below its target.',
    note: 'Preview: the bubble is drawn. The only real tooltip is an SVG title: hover the Copy target in the vector sample to see one.',
    spec: 'Tooltips with a pointer: dark bubble (inverse colours), 6 px radius, 12 px text, an 8 by 6 px pointer centred on the target, 6 px away from it; appears after 500 ms hover or on keyboard focus, may include a shortcut chip.',
    text: ['  ╭──────────╮', '  │ Copy spec│', '  ╰────╲╱────╯', '    [ Copy ]'],
  },
  {
    no: 44, id: 'skeleton', tab: 'feedback', title: 'Skeleton that matches the layout', kind: 'feedback', family: 'look', status: 'preview',
    blurb: 'Placeholder shapes with the same boxes as the loaded content.',
    note: 'Preview: shimmer only with the animated previews switch on (and motion on, calm off).',
    spec: 'Skeletons that match the final layout: use the same boxes, sizes and gaps as the loaded content (avatar circle, two text lines at 70% and 45% width, image block, button), muted fill at 8% with a slow 1.4 s shimmer; swap with no layout shift. Still version when motion is off.',
    text: ['loading            loaded', '(●) ▬▬▬▬▬▬▬▬▬     (A) Ada Lovelace', '    ▬▬▬▬▬           First programmer', '▭▭▭▭▭▭▭▭▭▭▭▭▭    [ image ]', '▭ button            [ Open ]'],
  },
  {
    no: 45, id: 'onboarding', tab: 'feedback', title: 'Illustrated onboarding cards', kind: 'art', family: 'look', status: 'preview',
    blurb: 'Three cards (Ask, Watch, Ship) with a small illustration each.',
    note: NOT_RESTYLE,
    spec: 'Illustrated onboarding cards: three cards in a row (Ask, Watch, Ship), each with a simple line illustration on top, a two-word title, one sentence and progress dots below; 16 px radius, 156 px wide, illustrations use the accent plus two neutrals.',
    text: ['1 Ask    "Describe the change"   ●○○', '2 Watch  "Follow each step"      ○●○', '3 Ship   "Review and keep it"    ○○●'],
  },
  {
    no: 46, id: 'mascot', tab: 'feedback', title: 'Mascot silhouettes', kind: 'art', family: 'look', status: 'preview',
    blurb: 'Three simple silhouettes for empty states: cat, robot, ghost.',
    note: NOT_RESTYLE,
    spec: 'Mascot silhouettes in empty states: three simple solid silhouettes (cat, robot, ghost) in a neutral tone at 25% contrast, 64 px tall, with a one-line friendly message below. Rotate by context; never animate them.',
    text: ['/\\_/\\   [■_■]   .-.', '(o.o)   /|_|\\   (o o)', ' > ^ <   d   b   |  |', 'No sessions yet · No tools ran · All quiet'],
  },
  {
    no: 47, id: 'pixel', tab: 'modes', title: 'Pixel-art mode', kind: 'mode', family: 'look', status: 'preview',
    blurb: 'A short word in a 5 by 5 pixel font, drawn as square cells.',
    note: 'Preview: fonts cannot be chosen in the app; the word is drawn as SVG rects.',
    spec: 'Pixel-art mode: a 5 by 5 pixel font drawn as square cells (8 px for titles, 4 px for labels) with crisp edges, a hard offset shadow of 4 px, a 4-colour palette, no gradients or blur, 4 px radius at most on containers.',
    text: ['█████ █████ █   █ █     █████', '█       █    █ █  █     █    ', '█████   █     █   █     ████ ', '    █   █     █   █     █    ', '█████   █     █   █████ █████'],
  },
  {
    no: 48, id: 'blueprint', tab: 'modes', title: 'Blueprint grid mode', kind: 'mode', family: 'look', status: 'preview',
    blurb: 'Deep blue page, fine white grid, outline-only shapes, dimension lines.',
    note: 'Preview: colours are fixed in the drawing. Applying a whole theme is the job of a theme mod.',
    spec: 'Blueprint grid mode: deep blue page (#0d3b72), white 1 px lines at 25% on a 50 px grid with a finer 10 px grid at 12%, outline-only shapes, monospace 11 px labels, dimension lines with arrows, no fills or shadows.',
    text: ['┼───┼───┼───┼───┼───┼', '│   ┌───────┐   │', '├───┤ A-A   ├───┤  <- outlines only', '│   └───────┘   │', '┼─ 320 ─────────┼'],
  },
  {
    no: 49, id: 'terminal', tab: 'modes', title: 'Terminal-green mode', kind: 'mode', family: 'look', status: 'preview',
    blurb: 'Near-black page, phosphor green monospace text, block cursor.',
    note: 'Preview: colours are fixed in the drawing. Applying a whole theme is the job of a theme mod.',
    spec: 'Terminal-green mode: near-black page (#0a0f0a), phosphor green text (#33ff66) with dimmer greens (#1fae45, #0f6a29) for secondary text, monospace everywhere, no radius, block cursor, optional faint glow, borders as single green lines.',
    text: ['$ gallery --mode terminal-green', 'ok  radius scale loaded', 'ok  elevation scale loaded', '$ █'],
  },
  {
    no: 50, id: 'print', tab: 'modes', title: 'Print-friendly mode', kind: 'mode', family: 'look', status: 'preview',
    blurb: 'White page, black outlines, hatching instead of colour.',
    note: 'Preview: light only. Printing the pane is not something a mod can start.',
    spec: 'Print-friendly mode: white page, black ink at 1 px, no background fills or shadows, hatching instead of colour for emphasis, badges as outlines, page margins 16 mm, links show their address; light only, ink-saving.',
    text: ['┌────────────────────┐', '│ Report      [draft]│', '├────────────────────┤', '│ ▨▨▨▨ ▧▧ ░░         │', '└────────────────────┘'],
  },
  {
    no: 201, id: 'tabbar', tab: 'navigation', title: 'Tab bar with icons', kind: 'nav', family: 'ui', status: 'live',
    blurb: 'Icon plus label tabs; the active one has an accent underline.',
    note: 'Live: the tab row at the top of this pane. Its icons follow the icon style setting (letters, symbols, minimal).',
    spec: 'Tab bars with icons: 36 px tall, 16 px icon plus 13 px label, 8 px gap; the active tab has a 2 px accent underline and accent icon, inactive tabs are muted. Collapse to icons only under 400 px; never more than 6 tabs.',
    text: ['▭ Surfaces  ◉ Controls  ◔ Feedback  ➤ Navigation  ◐ Modes  ☰ List', '  ▔▔▔▔▔▔▔▔▔  (active tab underline)'],
  },
  {
    no: 202, id: 'breadcrumb', tab: 'navigation', title: 'Breadcrumbs', kind: 'nav', family: 'ui', status: 'live',
    blurb: 'Gallery > Tab > Sample, with the last item as plain text.',
    note: 'Live: the row above the tabs. Each part is a button.',
    spec: 'Breadcrumbs in panes: Gallery › Section › Page, 12 px muted links with a chevron separator, the last item is plain bold text, middle items collapse to an ellipsis under 40 columns.',
    text: ['Gallery › Navigation › Breadcrumbs', 'Gallery › … › Breadcrumbs   (narrow)'],
  },
  {
    no: 203, id: 'searchbox', tab: 'navigation', title: 'Search box', kind: 'control', family: 'ui', status: 'live',
    blurb: 'A text field that filters the gallery\'s own list as you type.',
    note: 'Live: the box at the top. This gallery has one pane, so that is its search box. It filters this gallery only.',
    spec: 'A search box in every pane: 34 px tall input, 8 px radius, magnifier icon on the left, placeholder "Search...", a clear button appears when text is present, it filters the pane\'s own list as you type and shows "n of total".',
    text: ['⌕ radius______________ ×   1 of 30', '⌕ Search..._____________'],
  },
  {
    no: 204, id: 'filterchips', tab: 'navigation', title: 'Filter chips', kind: 'control', family: 'ui', status: 'live',
    blurb: 'Dot chips (live, preview, look, ui) that filter the gallery.',
    note: 'Live: the chips under the search box. Same group: OR. Different groups: AND.',
    spec: 'Filter chips: pill chips above the list; the leading dot is filled when on, hollow when off; chips of the same group combine with OR, different groups with AND; a "clear" ghost button appears when any chip is on; counts in muted text.',
    text: ['● live  ○ preview  ● look  ○ ui   clear'],
  },
  {
    no: 205, id: 'sortmenu', tab: 'navigation', title: 'Sort menu', kind: 'control', family: 'ui', status: 'live',
    blurb: 'Two sort buttons: name and kind. Press again for the default order.',
    note: 'Live: the sort buttons under the search box.',
    spec: 'Sort menu: a segmented control with the sort options (Name, Kind); the active one is filled with a check; pressing it again returns to the default order; the choice is remembered.',
    text: ['sort: [ name ✓ ] [ kind ]   (press again = default order)'],
  },
  {
    no: 206, id: 'paging', tab: 'navigation', title: 'Pagination and endless scroll', kind: 'nav', family: 'ui', status: 'live',
    blurb: 'Working page buttons on the left, an endless-scroll preview on the right.',
    note: 'The page buttons work. The endless list is a preview: it only draws the idea.',
    spec: 'Pagination and endless scroll side by side: a pager with previous and next buttons and page pills (current filled with accent), 8 rows per page; the endless list keeps loading rows with 3 skeleton rows and a "loading more" hint at the bottom. Prefer pages for tables, endless for feeds.',
    text: ['pages: ◀ 1 2 3 ▶        endless: row … row … ▒▒▒ loading more'],
  },
  {
    no: 207, id: 'stickyhead', tab: 'navigation', title: 'Sticky headers', kind: 'layout', family: 'ui', status: 'live',
    blurb: 'The group header repeats at the top while you scroll its rows.',
    note: 'Live in the List tab: a copy of the header takes the first row once you scroll past it (computed from the pane\'s scroll offset, so it can be a row off when lines wrap).',
    spec: 'Sticky headers: while scrolling a grouped list, the current group\'s header stays pinned at the top (accent label, 1 px bottom border, elevation 1) and is replaced by the next group\'s header when it arrives.',
    text: ['▼ Controls ↑   (pinned copy)', '  badge', '  chip'],
  },
  {
    no: 208, id: 'stickyfoot', tab: 'navigation', title: 'Sticky footer with actions', kind: 'layout', family: 'ui', status: 'live',
    blurb: 'An action bar at the bottom: previous, next, copy spec, grid.',
    note: 'Live: the row at the bottom of this pane. It is the last row, not a floating bar (a pane cannot pin a row over its content).',
    spec: 'Sticky footers with actions: a 44 px bar pinned to the bottom of the pane with a 1 px top border; the primary action on the right, secondary actions on the left; content gets bottom padding so nothing hides behind it.',
    text: ['────────────────────────────────', '[ ◀ prev ] [ next ▶ ]  [ copy spec ]'],
  },
]

export const SAMPLE_IDS: readonly string[] = SAMPLES.map(s => s.id)

export const byId = (id: string): Sample | undefined => SAMPLES.find(s => s.id === id)

export const tabLabel = (id: TabId): string => TABS.find(t => t.id === id)?.label ?? id

/** Defaults of the mod's own switches; features.json has to say the same (a test checks it). */
export const FEATURE_DEFAULTS: Readonly<Record<string, boolean>> = {
  svg: true,
  tooltips: true,
  animate: false,
  toolbar: true,
  zebra: true,
  'sticky-headers': true,
  footer: true,
  fab: true,
  'grid-overlay': true,
}

export const MOD = 'style-gallery'
export const PANE_ID = 'style-gallery-main'

export const COMMANDS: readonly { name: string; usage: string; description: string }[] = [
  { name: 'sg', usage: '/sg', description: 'List the commands of the style gallery' },
  { name: 'sgdemo', usage: '/sgdemo [tab|id]', description: 'Open the gallery pane, on a tab or a sample' },
  { name: 'sgcopy', usage: '/sgcopy <id>', description: 'Put a short written spec of a style in the prompt box' },
  { name: 'sggrid', usage: '/sggrid [on|off]', description: 'Draw the 4 px spacing grid over the gallery samples' },
  { name: 'sglist', usage: '/sglist [text]', description: 'List sample ids, optionally filtered by text' },
  { name: 'sgreset', usage: '/sgreset', description: 'Reset the gallery view and forget what it kept' },
]
