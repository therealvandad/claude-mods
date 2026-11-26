// The cards of the cockpit pane (desktop surface only). Pure drawing, no `$`.
// Same finish as the status strip: gradient glass card, three-colour gradient edge, heavy numbers,
// spaced uppercase labels, the four themes. Every picture is drawn at the width it is shown (never
// scaled), so 13px text stays 13px. No animation here: these are still images.

import { clamp, f, FONT, stop, themeCss } from './hud'
import type { HudTheme } from './hud'

export type PaneLook = { width: number; theme: HudTheme }
export type Picture = { source: string; alt: string; width: number; height: number }

export const PANE_MIN_W = 360
export const PANE_MAX_W = 600
/** About 7px per column, inside what reads well. */
export const paneWidth = (columns: number | undefined): number =>
  Math.round(clamp((columns ?? 80) * 7, PANE_MIN_W, PANE_MAX_W))

/** Stops adding rows here, so a picture stays far under the size limit whatever the text holds. */
const BUDGET = 33_000
const PAD = 16

// ------------------------------------------------------------------ text

/** Safe inside XML text and attributes: control characters and half surrogate pairs are dropped. */
export const xml = (s: string): string =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩\ud800-\udfff￾￿]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const flat = (s: string, max = 300): string => String(s).replace(/\s+/g, ' ').trim().slice(0, max)

/** A picture's description: the app refuses one that holds a control character. */
export const describe = (s: string, max = 1800): string =>
  flat(String(s).replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, ''), max).replace(/[\ud800-\udfff]/gu, '') || 'Cockpit'

// There is no way to measure text here, so widths are estimated, a little on the wide side.
const emOf = (ch: string): number => {
  const c = ch.codePointAt(0) ?? 0

  if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60) || c >= 0x1f000 || (c >= 0x2600 && c <= 0x27bf)) {
    return 1.15
  }

  if ("il.,:;'|!j ".includes(ch)) {
    return 0.3
  }

  if ('ftrI()[]{}/\\-"`'.includes(ch)) {
    return 0.42
  }

  if ('mwMW@%'.includes(ch)) {
    return 0.9
  }

  if (ch >= 'A' && ch <= 'Z') {
    return 0.68
  }

  return ch >= '0' && ch <= '9' ? 0.62 : 0.57
}

type Face = { size?: number; bold?: boolean; mono?: boolean }

export const textW = (s: string, face: Face = {}): number => {
  let em = 0

  for (const ch of s) {
    em += face.mono === true ? Math.max(0.62, emOf(ch)) : emOf(ch)
  }

  return em * (face.size ?? 13) * (face.bold === true ? 1.07 : 1)
}

/** Cuts the end (or, with `keepEnd`, the start) so the text fits `px`. Whole characters only. */
export const fit = (s: string, px: number, face: Face = {}, keepEnd = false): string => {
  if (textW(s, face) <= px) {
    return s
  }
  const chars = [...s]

  if (keepEnd) {
    chars.reverse()
  }
  let out = ''
  let used = textW('…', face)

  for (const ch of chars) {
    used += textW(ch, face)

    if (used > px) {
      break
    }
    out = keepEnd ? ch + out : out + ch
  }

  return keepEnd ? `…${out}` : `${out.trimEnd()}…`
}

/** Greedy word wrap into at most `lines` lines; the last one is cut when more is left. */
export const wrap = (s: string, px: number, lines: number, face: Face = {}): string[] => {
  const out: string[] = []
  let rest = flat(s, 600)

  while (rest !== '' && out.length < lines) {
    if (textW(rest, face) <= px) {
      out.push(rest)
      break
    }

    if (out.length === lines - 1) {
      out.push(fit(rest, px, face))
      break
    }
    let take = ''

    for (const ch of rest) {
      if (textW(take + ch, face) > px) {
        break
      }
      take += ch
    }
    const space = take.lastIndexOf(' ')
    const line = space > take.length * 0.5 ? take.slice(0, space) : take || rest.slice(0, 1)
    out.push(line)
    rest = rest.slice(line.length).trimStart()
  }

  return out
}

export const text = (x: number, y: number, s: string, cls: string, extra = ''): string =>
  `<text x="${f(x)}" y="${f(y)}" class="${cls}"${extra}>${xml(s)}</text>`

export const hhmm = (at: number): string => {
  const d = new Date(at)

  return Number.isFinite(d.getTime()) && at > 0
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : ''
}

const count = (n: number) => Math.round(clamp(n, 0, 1_000_000))
const plural = (n: number, word: string) => `${count(n)} ${word}${count(n) === 1 ? '' : 's'}`

// ------------------------------------------------------------------ the card

const BG = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--top)"/><stop offset="1" style="stop-color:var(--bottom)"/></linearGradient>'
const ROW_GRADIENTS = [
  ['g-ok', stop('g-ok', '--ok1', '--ok2')],
  ['g-run', stop('g-run', '--e3', '--e1')],
] as const
const DEFS = `${BG}
<linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--e1);stop-opacity:.9"/><stop offset=".5" style="stop-color:var(--e2);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--e3);stop-opacity:.9"/></linearGradient>
${stop('g-ok', '--ok1', '--ok2')}${stop('g-warn', '--warn1', '--warn2')}${stop('g-bad', '--bad1', '--bad2')}${stop('g-run', '--e3', '--e1')}`

export const CSS = `text{font-family:${FONT};fill:var(--text);font-variant-numeric:tabular-nums}
.cap{font-size:10px;font-weight:700;letter-spacing:.08em;fill:var(--mut)}
.big{font-size:19px;font-weight:800;letter-spacing:-.02em}
.r{font-size:13px;font-weight:500}
.rb{font-size:13px;font-weight:800;letter-spacing:-.005em}
.s{font-size:12px;fill:var(--mut)}
.sb{font-size:12px;font-weight:700}
.m{fill:var(--mut)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.hair{stroke:var(--hair);stroke-width:1}
.track{fill:var(--track)}`

/** One glass card with the gradient edge. */
export const card = (x: number, y: number, w: number, h: number): string => {
  const box = `x="${f(x + 1)}" y="${f(y + 1)}" width="${f(w - 2)}" height="${f(h - 2)}" rx="${h < 46 ? 12 : 18}"`

  return `<rect ${box} fill="url(#bg)"/><rect ${box} fill="none" stroke="url(#edge)" stroke-width="1.5"/>`
}

export const shell = (width: number, height: number, theme: HudTheme, body: string, css = '', defs = ''): string => {
  const W = Math.round(width)
  const H = Math.round(height)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
<defs>${DEFS}${defs}</defs>
<style>${themeCss(theme)}
${CSS}${css}</style>
${body}
</svg>`
}

const picture = (look: PaneLook, width: number, height: number, body: string, alt: string): Picture => ({
  source: shell(width, height, look.theme, body),
  alt: describe(alt),
  width: Math.round(width),
  height: Math.round(height),
})

/** The title line of a card: spaced label on the left, a heavy figure on the right. */
const header = (W: number, title: string, right = '', y = 0) =>
  `${text(PAD, y + 24, title.toUpperCase(), 'cap')}${right === '' ? '' : text(W - PAD, y + 27, fit(right, W * 0.62, { size: 19, bold: true }), 'big', ' text-anchor="end"')}`

const rule = (W: number, y: number) => `<line x1="${PAD}" y1="${f(y)}" x2="${W - PAD}" y2="${f(y)}" class="hair"/>`

const note = (W: number, y: number, s: string) =>
  wrap(s, W - PAD * 2, 3, { size: 13 })
    .map((line, i) => text(PAD, y + i * 18, line, 'r m'))
    .join('')

const noteHeight = (W: number, s: string) => wrap(s, W - PAD * 2, 3, { size: 13 }).length * 18

/** A card with a title and a quiet message: the empty states. */
const emptyCard = (look: PaneLook, title: string, right: string, message: string): Picture => {
  const W = look.width
  const H = 52 + noteHeight(W, message)

  return picture(look, W, H, card(0, 0, W, H) + header(W, title, right) + note(W, 52, message), `${title}: ${message}`)
}

/** Draws rows until the list ends, the cap is reached or the picture would grow too big. */
const stack = <T>(
  items: readonly T[],
  max: number,
  from: number,
  draw: (item: T, y: number, i: number) => { body: string; h: number },
): { body: string; y: number; drawn: number } => {
  let body = ''
  let y = from
  let drawn = 0

  for (const item of items) {
    if (drawn >= max) {
      break
    }
    const row = draw(item, y, drawn)

    if (body.length + row.body.length > BUDGET) {
      break
    }
    body += row.body
    y += row.h
    drawn += 1
  }

  return { body, y, drawn }
}

const moreLine = (W: number, y: number, n: number, word = 'more') =>
  n > 0 ? text(W / 2, y + 12, `+${count(n)} ${word}`, 's', ' text-anchor="middle"') : ''

// ------------------------------------------------------------------ timeline

export type TimelineRow = {
  tool: string
  detail: string
  /** Where the call starts and how long it ran, as parts of the window (0 to 1). */
  off: number
  len: number
  state: 'ok' | 'bad' | 'run'
  duration: string
}

export const timelineCard = (rows: readonly TimelineRow[], window: string, hidden: number, look: PaneLook): Picture => {
  const W = look.width

  if (rows.length === 0) {
    return emptyCard(look, 'Tool timeline', '', 'No tool calls yet. Each call will draw a bar here.')
  }
  const inner = W - PAD * 2
  // The newest rows matter most: when something has to go, it is the oldest.
  const newest = rows.slice(-40)
  const drawn = stack(newest, 40, 42, (r, y) => {
    const label = r.state === 'bad' ? `failed · ${r.duration}` : r.duration
    const right = fit(label, 110, { size: 12, bold: true })
    const tool = fit(flat(r.tool, 80), inner * 0.34, { bold: true })
    const detailX = PAD + textW(tool, { bold: true }) + 8
    const room = W - PAD - textW(right, { size: 12, bold: true }) - 10 - detailX
    const len = Math.max(6, clamp(r.len, 0, 1) * inner)
    const x = PAD + Math.min(clamp(r.off, 0, 1) * inner, inner - len)
    const fill = r.state === 'bad' ? 'url(#g-bad)' : r.state === 'run' ? 'url(#g-run)' : 'url(#g-ok)'
    const tip = r.state === 'run' ? `<circle cx="${f(x + len - 3)}" cy="${y + 23}" r="7" style="fill:var(--e3)" opacity=".3"/>` : ''

    return {
      body: `${text(PAD, y + 12, tool, 'rb')}${room > 30 ? text(detailX, y + 12, fit(flat(r.detail, 100), room, { size: 12 }), 's') : ''}${text(W - PAD, y + 12, right, 'sb', ` text-anchor="end"${r.state === 'bad' ? ' style="fill:var(--bad1)"' : r.state === 'run' ? ' style="fill:var(--live)"' : ''}`)}
<rect x="${PAD}" y="${y + 20}" width="${inner}" height="6" rx="3" class="track"/><rect x="${f(x)}" y="${y + 19}" width="${f(len)}" height="8" rx="4" fill="${fill}"/>${tip}`,
      h: 37,
    }
  })
  const left = hidden + rows.length - drawn.drawn
  const H = drawn.y + (left > 0 ? 20 : 0) + 6
  const alt = `Tool timeline, ${window}: ${newest
    .slice(-drawn.drawn)
    .map(r => `${flat(r.tool, 40)} ${r.state === 'bad' ? 'failed ' : ''}${r.duration}`)
    .join(', ')}.`

  return picture(look, W, H, card(0, 0, W, H) + header(W, 'Tool timeline', window) + drawn.body + moreLine(W, drawn.y, left, 'earlier'), alt)
}

// ------------------------------------------------------------------ files

export type FileGroup = { dir: string; files: readonly { name: string; n: number }[] }

const heatOfEdits = (n: number): 'g-bad' | 'g-warn' | 'g-ok' | '' => (n >= 8 ? 'g-bad' : n >= 4 ? 'g-warn' : n >= 2 ? 'g-ok' : '')

export const filesCard = (
  o: { root: string; groups: readonly FileGroup[]; files: number; edits: number },
  look: PaneLook,
): Picture => {
  const W = look.width

  if (o.files === 0) {
    return emptyCard(look, 'Edited files', '', 'Nothing edited yet. Files Claude changes will collect here.')
  }
  type Line = { dir: string } | { name: string; n: number }
  const lines: Line[] = o.groups.flatMap(g => [{ dir: g.dir }, ...g.files])
  const most = Math.max(1, ...o.groups.flatMap(g => g.files.map(x => count(x.n))))
  let names = 0
  const drawn = stack(lines, 60, 60, (line, y) => {
    if ('dir' in line) {
      return { body: text(PAD, y + 16, fit(flat(line.dir, 200), W - PAD * 2, { size: 12, mono: true }, true), 's mono'), h: 24 }
    }
    names += 1
    const n = count(line.n)
    const heat = heatOfEdits(n)
    const label = `x${n}`
    const pill = Math.max(34, textW(label, { size: 12, bold: true }) + 16)
    const px = W - PAD - pill
    const barX = px - 74

    return {
      body: `${text(PAD + 12, y + 16, fit(flat(line.name, 200), barX - PAD - 24, { bold: true }), 'rb')}<rect x="${f(barX)}" y="${y + 10}" width="62" height="4" rx="2" class="track"/><rect x="${f(barX)}" y="${y + 10}" width="${f(Math.max(4, (n / most) * 62))}" height="4" rx="2" fill="url(#${heat || 'g-ok'})"/>
<rect x="${f(px)}" y="${y + 3}" width="${f(pill)}" height="19" rx="9.5" ${heat === '' ? 'class="track"' : `fill="url(#${heat})" fill-opacity=".3" stroke="url(#${heat})" stroke-width="1.2"`}/>${text(px + pill / 2, y + 16.5, label, 'sb', ' text-anchor="middle"')}`,
      h: 26,
    }
  })
  const left = Math.max(0, o.files - names)
  const H = drawn.y + (left > 0 ? 20 : 0) + 8
  const body =
    card(0, 0, W, H) +
    header(W, 'Edited files', `${plural(o.files, 'file')}, ${plural(o.edits, 'edit')}`) +
    text(PAD, 46, fit(flat(o.root, 300), W - PAD * 2, { size: 12, mono: true }, true), 's mono') +
    rule(W, 56) +
    drawn.body +
    moreLine(W, drawn.y, left)
  const alt = `Edited files: ${plural(o.files, 'file')}, ${plural(o.edits, 'edit')} under ${o.root}. ${o.groups.flatMap(g => g.files.map(x => `${x.name} x${count(x.n)}`)).join(', ')}.`

  return picture(look, W, H, body, alt)
}

// ------------------------------------------------------------------ todo

export const todoCard = (o: { done: number; total: number; next: string; hidden: number }, look: PaneLook): Picture => {
  const W = look.width

  if (count(o.total) === 0) {
    return emptyCard(look, 'Todo', '', 'Nothing yet. Add one with /ctodo your text.')
  }
  const total = count(o.total)
  const done = Math.min(total, count(o.done))
  const open = total - done
  const pct = (done / total) * 100
  const r = 34
  const cx = 52
  const cy = 55
  const c = 2 * Math.PI * r
  const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2
  const tx = cx + r * Math.cos(angle)
  const ty = cy + r * Math.sin(angle)
  const x = 106
  const lines = open === 0 ? ['Everything is ticked off.'] : wrap(o.next, W - x - PAD, 2, { size: 13 })
  const H = Math.max(110, 80 + lines.length * 18) + (o.hidden > 0 ? 16 : 0)
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="8" style="stroke:var(--track)"/>${
    done === 0
      ? ''
      : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="8" stroke-linecap="round" stroke="url(#g-ok)" transform="rotate(-90 ${cx} ${cy})" stroke-dasharray="${f(c)}" stroke-dashoffset="${f(c * (1 - pct / 100))}"/><circle cx="${f(tx)}" cy="${f(ty)}" r="8" style="fill:var(--ok2)" opacity=".28"/><circle cx="${f(tx)}" cy="${f(ty)}" r="2.8" style="fill:var(--shine)"/>`
  }${text(cx, cy + 7, `${Math.round(pct)}%`, 'big', ' text-anchor="middle"')}`
  const body =
    card(0, 0, W, H) +
    ring +
    text(x, 26, 'TODO', 'cap') +
    text(x, 48, `${open} open / ${total}`, 'big') +
    text(x, 70, open === 0 ? 'DONE' : 'NEXT UP', 'cap') +
    lines.map((line, i) => text(x, 89 + i * 18, line, 'r')).join('') +
    (o.hidden > 0 ? text(x, H - 10, `+${count(o.hidden)} older not listed below`, 's') : '')

  return picture(look, W, H, body, `Todo: ${open} open of ${total}, ${Math.round(pct)} percent done. ${open === 0 ? '' : `Next: ${o.next}`}`)
}

// ------------------------------------------------------------------ rows that sit beside buttons

/** A section title on its own small card, with a figure or a word on the right. */
export const titleCard = (title: string, right: string, look: PaneLook, message = ''): Picture => {
  if (message !== '') {
    return emptyCard(look, title, right, message)
  }
  const W = look.width
  const shown = fit(flat(right, 120), W - 40 - textW(title, { size: 11, bold: true }) - 20, { size: 13, bold: true })

  return picture(
    look,
    W,
    36,
    card(0, 0, W, 36) + text(PAD, 22, title.toUpperCase(), 'cap') + (shown === '' ? '' : text(W - PAD, 23, shown, 'rb', ' text-anchor="end"')),
    `${title}: ${right}`,
  )
}

const rowShell = (width: number, h: number) =>
  `<rect x=".75" y=".75" width="${f(width - 1.5)}" height="${h - 1.5}" rx="10" fill="url(#bg)" style="stroke:var(--track)" stroke-width="1.2"/>`

// A pane can hold fifty of these, so a row carries only the styles and gradients a row uses.
const rowPicture = (look: PaneLook, width: number, height: number, body: string, alt: string): Picture => {
  const W = Math.round(width)
  const used = [BG, ...ROW_GRADIENTS.filter(([id]) => body.includes(`url(#${id})`)).map(([, def]) => def)].join('')

  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img">
<defs>${used}</defs>
<style>${themeCss(look.theme)}
text{font-family:${FONT};fill:var(--text);font-variant-numeric:tabular-nums}
.r{font-size:13px;font-weight:500}.rb{font-size:13px;font-weight:800}.s{font-size:12px;fill:var(--mut)}.sb{font-size:12px;font-weight:700}</style>
${rowShell(W, height)}${body}
</svg>`,
    alt: describe(alt, 700),
    width: W,
    height,
  }
}

export const pinRow = (pin: string, width: number, look: PaneLook): Picture =>
  rowPicture(
    look,
    width,
    30,
    `<rect x="8" y="7" width="4" height="16" rx="2" fill="url(#g-run)"/>${text(20, 19.5, fit(flat(pin, 200), width - 30, { bold: true }), 'rb')}`,
    `Pinned: ${pin}`,
  )

export const historyRow = (
  o: { n: number; prompt: string; time: string; isPinned: boolean },
  width: number,
  look: PaneLook,
): Picture => {
  const right = width - 10
  // A narrow row gives the time up so the prompt keeps its room.
  const time = width < 300 ? '' : o.time
  const timeW = time === '' ? 0 : textW(time, { size: 12 }) + 10
  const room = width - 38 - 10 - timeW - (o.isPinned ? 12 : 0)
  const body = `<rect x="6" y="6" width="24" height="18" rx="6" fill="url(#g-ok)" fill-opacity=".26"/>${text(18, 19, String(count(o.n)), 'sb', ' text-anchor="middle"')}${text(38, 19.5, fit(flat(o.prompt, 300), room), 'r')}${o.isPinned ? `<circle cx="${f(right - timeW - 3)}" cy="15" r="3.5" fill="url(#g-run)"/>` : ''}${time === '' ? '' : text(right, 19.5, time, 's', ' text-anchor="end"')}`

  return rowPicture(look, width, 30, body, `Prompt ${count(o.n)}${o.isPinned ? ', pinned' : ''}: ${o.prompt}`)
}

export const linkParts = (url: string): { host: string; rest: string } => {
  const m = /^[a-z]+:\/\/([^/?#]*)(.*)$/i.exec(url)

  return m === null ? { host: url, rest: '' } : { host: m[1] ?? url, rest: m[2] ?? '' }
}

export const linkRow = (url: string, width: number, look: PaneLook): Picture => {
  const { host, rest } = linkParts(flat(url, 600))
  const path = rest === '' || rest === '/' ? '/' : rest
  const body = `<rect x="8" y="9" width="4" height="22" rx="2" fill="url(#g-run)"/>${text(20, 18, fit(host, width - 30, { bold: true }), 'rb')}${text(20, 33, fit(path, width - 30, { size: 12 }), 's')}`

  return rowPicture(look, width, 40, body, url === '' ? 'Link' : url)
}

export const shelfRow = (o: { n: number; snippet: string }, width: number, look: PaneLook): Picture => {
  const body = `<rect x="6" y="6" width="24" height="18" rx="6" fill="url(#g-run)" fill-opacity=".24"/>${text(18, 19, String(count(o.n)), 'sb', ' text-anchor="middle"')}${text(38, 19.5, fit(flat(o.snippet, 300), width - 48), 'r')}`

  return rowPicture(look, width, 30, body, `Shelf ${count(o.n)}: ${o.snippet}`)
}

// ------------------------------------------------------------------ history extras

const kindOfHit: Record<string, string> = { prompt: 'g-ok', tool: 'g-warn', error: 'g-bad', link: 'g-run' }

export const searchCard = (query: string, hits: readonly string[], look: PaneLook): Picture => {
  const W = look.width

  if (query === '') {
    return emptyCard(look, 'Search', '', 'Use /csearch text to search prompts and tool calls.')
  }

  if (hits.length === 0) {
    return emptyCard(look, 'Search', fit(flat(query, 80), W * 0.5, { size: 19, bold: true }), 'No matches.')
  }
  const shown = hits.slice(-6)
  const drawn = stack(shown, 6, 38, (hit, y) => {
    const m = /^(prompt|tool|error|link): ([\s\S]*)$/.exec(hit)
    const kind = m?.[1] ?? 'prompt'

    return {
      body: `<rect x="${PAD}" y="${y + 3}" width="52" height="18" rx="9" fill="url(#${kindOfHit[kind] ?? 'g-ok'})" fill-opacity=".26"/>${text(PAD + 26, y + 15.5, kind, 'sb', ' text-anchor="middle"')}${text(PAD + 62, y + 17, fit(flat(m?.[2] ?? hit, 300), W - PAD * 2 - 62), 'r')}`,
      h: 25,
    }
  })
  const H = drawn.y + 10

  return picture(
    look,
    W,
    H,
    card(0, 0, W, H) + header(W, 'Search', fit(flat(query, 80), W * 0.55, { size: 19, bold: true })) + drawn.body,
    `Search: ${query}. ${shown.join('. ')}`,
  )
}

export const daysCard = (days: readonly { day: string; sessions: number; calls: number; usd: number }[], look: PaneLook): Picture => {
  const W = look.width

  if (days.length === 0) {
    return emptyCard(look, 'Days', '', 'No daily stats yet.')
  }
  const most = Math.max(1, ...days.map(d => count(d.calls)))
  const usd = (n: number) => `$${clamp(n, 0, 1_000_000).toFixed(2)}`
  const drawn = stack(days, 5, 34, (d, y) => ({
    body: `${text(PAD, y + 16, flat(d.day, 20), 'rb')}${text(PAD + 100, y + 16, `${plural(d.sessions, 'session')} · ${plural(d.calls, 'call')}`, 's')}${text(W - PAD, y + 16, usd(d.usd), 'rb', ' text-anchor="end"')}
<rect x="${PAD}" y="${y + 23}" width="${W - PAD * 2}" height="3" rx="1.5" class="track"/><rect x="${PAD}" y="${y + 23}" width="${f(Math.max(3, (count(d.calls) / most) * (W - PAD * 2)))}" height="3" rx="1.5" fill="url(#g-ok)"/>`,
    h: 32,
  }))
  const H = drawn.y + 10

  return picture(
    look,
    W,
    H,
    card(0, 0, W, H) + header(W, 'Days') + drawn.body,
    `Days: ${days.map(d => `${d.day} ${plural(d.sessions, 'session')}, ${plural(d.calls, 'call')}, ${usd(d.usd)}`).join('; ')}.`,
  )
}

// ------------------------------------------------------------------ errors

export const errorsCard = (
  rows: readonly { tool: string; detail: string; reason: string; time: string }[],
  hidden: number,
  look: PaneLook,
): Picture => {
  const W = look.width

  if (rows.length === 0) {
    return emptyCard(look, 'Errors', '0', 'No failed tool calls. Good.')
  }
  const x = PAD + 10
  const room = W - x - PAD - 10
  const drawn = stack(rows, 20, 40, (r, y) => {
    const cause = wrap(r.reason === '' ? 'No reason given' : r.reason, room, 3, { bold: true })
    const h = cause.length * 18 + 34
    const box = `x="${PAD - 4}" y="${y + 2}" width="${W - PAD * 2 + 8}" height="${h - 4}" rx="11"`
    const timeW = r.time === '' ? 0 : textW(r.time, { size: 12 }) + 10
    const tool = fit(flat(r.tool, 80), room * 0.4, { size: 12, bold: true })
    const detailX = x + textW(tool, { size: 12, bold: true }) + 8
    const detailW = W - PAD - 6 - timeW - detailX

    return {
      body: `<rect ${box} style="fill:var(--bad2)" fill-opacity=".09"/><rect ${box} fill="none" stroke="url(#g-bad)" stroke-opacity=".75" stroke-width="1.2"/><rect x="${PAD + 1}" y="${y + 10}" width="3.5" height="${h - 20}" rx="1.75" fill="url(#g-bad)"/>
${cause.map((line, i) => text(x, y + 21 + i * 18, line, 'rb')).join('')}
${text(x, y + h - 11, tool, 'sb', ' style="fill:var(--bad1)"')}${detailW > 30 ? text(detailX, y + h - 11, fit(flat(r.detail, 100), detailW, { size: 12 }), 's') : ''}${r.time === '' ? '' : text(W - PAD - 6, y + h - 11, r.time, 's', ' text-anchor="end"')}`,
      h: h + 4,
    }
  })
  const left = hidden + rows.length - drawn.drawn
  const H = drawn.y + (left > 0 ? 20 : 0) + 8
  const alt = `Errors: ${count(rows.length + hidden)}. ${rows
    .slice(0, drawn.drawn)
    .map(r => `${flat(r.reason, 160)} (${flat(r.tool, 40)}: ${flat(r.detail, 60)})`)
    .join('; ')}`

  return picture(look, W, H, card(0, 0, W, H) + header(W, 'Errors', String(count(rows.length + hidden))) + drawn.body + moreLine(W, drawn.y, left, 'older'), alt)
}

// ------------------------------------------------------------------ palette and bar tab

/** One group of commands: the name in mono, what it does beside it. The buttons sit under the card. */
export const commandCard = (title: string, rows: readonly (readonly [string, string])[], look: PaneLook): Picture => {
  const W = look.width
  const col = Math.min(138, Math.round(W * 0.34))
  const drawn = stack(rows, 20, 34, ([cmd, about], y) => {
    const said = about.replace(/^(Workbench|Tool guard|Prompt tools): /, '')
    const lines = wrap(said.charAt(0).toUpperCase() + said.slice(1), W - PAD * 2 - col, 2, { size: 13 })

    return {
      body: `${text(PAD, y + 16, fit(cmd, col - 8, { bold: true, mono: true }), 'rb mono', ' style="fill:var(--ok1)"')}${lines.map((line, i) => text(PAD + col, y + 16 + i * 17, line, 'r m')).join('')}`,
      h: 8 + lines.length * 17,
    }
  })
  const H = drawn.y + 10

  return picture(
    look,
    W,
    H,
    card(0, 0, W, H) + header(W, title) + drawn.body,
    `${title}: ${rows.map(([c, a]) => `${c}, ${a}`).join('; ')}.`,
  )
}

export const barHero = (o: { name: string; size: string; theme: string; quiet: boolean; on: number }, look: PaneLook): Picture => {
  const W = look.width
  const about = `The strip above the prompt. Same choices as /${o.name}.`
  const lines = wrap(about, W - PAD * 2, 2, { size: 13 })
  const y = 50 + lines.length * 18
  const H = y + 52
  const third = (W - PAD * 2) / 3
  const stat = (i: number, value: string, label: string) =>
    `${text(PAD + i * third, y + 22, fit(value, third - 8, { size: 19, bold: true }), 'big')}${text(PAD + i * third, y + 39, label, 'cap')}`
  const body =
    card(0, 0, W, H) +
    header(W, 'Bar', `${plural(o.on, 'item')} on`) +
    lines.map((line, i) => text(PAD, 48 + i * 18, line, 'r m')).join('') +
    rule(W, y) +
    stat(0, o.size, 'SIZE') +
    stat(1, o.theme, 'THEME') +
    stat(2, o.quiet ? 'on' : 'off', 'QUIET')

  return picture(look, W, H, body, `Bar settings: size ${o.size}, theme ${o.theme}, quiet ${o.quiet ? 'on' : 'off'}, ${plural(o.on, 'item')} on. ${about}`)
}

export const fieldsCard = (title: string, fields: readonly (readonly [string, string])[], look: PaneLook): Picture => {
  const W = look.width
  const drawn = stack(fields, 8, 32, ([label, value], y) => {
    const lines = wrap(value, W - PAD * 2, 3, { size: 13 })

    return {
      body: `${text(PAD, y + 14, label.toUpperCase(), 'cap')}${lines.map((line, i) => text(PAD, y + 32 + i * 18, line, 'r')).join('')}`,
      h: 22 + lines.length * 18,
    }
  })
  const H = drawn.y + 12

  return picture(look, W, H, card(0, 0, W, H) + header(W, title) + drawn.body, `${title}: ${fields.map(([l, v]) => `${l}: ${v}`).join('; ')}.`)
}
