import { restoreRemoteImages, sanitizeFragment, sanitizeHtml } from './sanitize'

/** Font the message is written and sent in; the editor uses the same stack. */
export const MAIL_FONT = "'Segoe UI', system-ui, -apple-system, Arial, sans-serif"
export const MAIL_FONT_SIZE = '14px'

/** Gmail's quote style, so quotes look the same everywhere. */
export const QUOTE_STYLE = 'margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex'

/**
 * Colours of both app themes. Chromium copies the editor's computed colour into the markup when
 * lines are merged, which in dark mode means near-white text in the sent mail; any colour equal
 * to one of these is dropped. Both palettes, so switching theme mid-draft can't leave one behind.
 */
const THEME_TEXT = ['rgb(29, 29, 31)', 'rgb(110, 110, 115)', 'rgb(245, 245, 247)', 'rgb(161, 161, 166)']
const THEME_SURFACE = ['rgb(255, 255, 255)', 'rgb(30, 30, 30)', 'rgb(35, 35, 37)', 'rgb(251, 251, 253)', 'transparent']

/** Normalises any CSS colour to `rgb(r, g, b)` using the browser's own parser. */
function rgb(value: string): string {
  const probe = document.createElement('span')
  probe.style.color = value
  return probe.style.color
}

function stripThemeStyles(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const s = el.style
    if (s.color && THEME_TEXT.includes(rgb(s.color))) s.removeProperty('color')
    if (s.backgroundColor && THEME_SURFACE.includes(rgb(s.backgroundColor))) s.removeProperty('background-color')
    if (s.fontFamily && /segoe ui|inter variable|system-ui/i.test(s.fontFamily)) s.removeProperty('font-family')
    if (s.fontSize === MAIL_FONT_SIZE || s.fontSize === '13px') s.removeProperty('font-size')
    if (s.lineHeight && /^1\.5/.test(s.lineHeight)) s.removeProperty('line-height')
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style')
  })
  // Spans left with nothing to say are just noise.
  root.querySelectorAll('span:not([style]):not([class])').forEach((span) => span.replaceWith(...span.childNodes))
}

/** Chromium's indent writes blockquotes with a 40px margin; those are indentation, not quotes. */
export const isIndent = (el: Element) => /margin[^;]*40px/i.test(el.getAttribute('style') ?? '')

/** Editor content (plus a still-folded quote) as the message's HTML and plain-text parts. */
export function toOutgoing(body: string, quote: string | null): { html: string; text: string } {
  const root = document.createElement('div')
  root.append(sanitizeFragment(body + (quote ?? '')))
  restoreRemoteImages(root)
  stripThemeStyles(root)
  root.querySelectorAll('blockquote:not([style])').forEach((q) => q.setAttribute('style', QUOTE_STYLE))
  const inner = sanitizeHtml(root.innerHTML)
  return {
    html: `<div class="winmail-body" style="font-family:${MAIL_FONT};font-size:${MAIL_FONT_SIZE}">${inner}</div>`,
    text: toPlainText(root)
  }
}

/** Builds plain text line by line, the way the HTML would read. */
class Lines {
  lines: string[] = ['']
  get last() {
    return this.lines[this.lines.length - 1]!
  }
  /** The next text starts on a fresh line. */
  breakLine() {
    if (this.last !== '') this.lines.push('')
  }
  newline() {
    this.lines.push('')
  }
  text(s: string) {
    this.lines[this.lines.length - 1] = this.last === '' ? s.replace(/^ +/, '') : this.last + s
  }
  /** Starts a fresh line with an empty line before it, unless there is nothing above. */
  blank() {
    this.breakLine()
    const above = this.lines[this.lines.length - 2]
    if (above !== undefined && above !== '') this.lines.splice(this.lines.length - 1, 0, '')
  }
  /** Adds lines rendered elsewhere (a list, a quote with "> " in front) on lines of their own. */
  block(lines: string[], spaced = true) {
    if (spaced) this.blank()
    else this.breakLine()
    this.lines.pop()
    this.lines.push(...lines, '')
    if (spaced) this.blank()
  }
  result(): string[] {
    const out = [...this.lines]
    while (out.length && !out[0]!.trim()) out.shift()
    while (out.length && !out[out.length - 1]!.trim()) out.pop()
    return out
  }
}

const BLOCKS = new Set([
  'DIV', 'P', 'H1', 'H2', 'H3', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'CAPTION', 'PRE', 'HR'
])

function walk(node: Node, out: Lines): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.text((node.textContent ?? '').replace(/\s+/g, ' '))
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as HTMLElement
  const children = () => el.childNodes.forEach((c) => walk(c, out))
  const sub = (fill: (o: Lines) => void) => {
    const o = new Lines()
    fill(o)
    return o.result()
  }

  switch (el.tagName) {
    case 'BR':
      out.newline()
      return
    case 'IMG': {
      const alt = el.getAttribute('alt')
      if (alt) out.text(`[${alt}]`)
      return
    }
    case 'A': {
      const href = el.getAttribute('href') ?? ''
      const target = href.replace(/^mailto:/i, '')
      const before = out.last
      children()
      const shown = out.last.slice(before.length).trim()
      if (href && shown !== target && shown !== href) out.text(` <${target}>`)
      return
    }
    case 'PRE':
      out.block((el.textContent ?? '').split('\n'))
      return
    case 'HR':
      out.block(['———'])
      return
    case 'BLOCKQUOTE': {
      const lines = sub((o) => el.childNodes.forEach((c) => walk(c, o)))
      out.block(lines.map((l) => (isIndent(el) ? `    ${l}` : l ? `> ${l}` : '>')), false)
      return
    }
    case 'UL':
    case 'OL': {
      let n = Number(el.getAttribute('start')) || 1
      const items: string[] = []
      for (const li of Array.from(el.children)) {
        const lines = sub((o) => li.childNodes.forEach((c) => walk(c, o)))
        const mark = el.tagName === 'OL' ? `${n++}. ` : '• '
        lines.forEach((l, i) => items.push(i ? ' '.repeat(mark.length) + l : mark + l))
      }
      out.block(items)
      return
    }
    case 'TR': {
      const cells = Array.from(el.children).map((c) => sub((o) => walk(c, o)).join(' '))
      out.breakLine()
      out.text(cells.join(' | '))
      out.breakLine()
      return
    }
    case 'P':
      out.breakLine()
      children()
      out.breakLine()
      out.newline()
      return
  }
  if (BLOCKS.has(el.tagName)) {
    // A quoted message starts after an empty line, like the attribution line mail apps write.
    if (el.classList.contains('gmail_quote') && el.parentElement?.tagName !== 'BLOCKQUOTE') out.blank()
    else out.breakLine()
    children()
    out.breakLine()
  } else children()
}

/** Plain-text version of the message: "> " quotes, list bullets, "text <url>" links. */
export function toPlainText(root: Node): string {
  const out = new Lines()
  root.childNodes.forEach((c) => walk(c, out))
  return out
    .result()
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** Plain text of an HTML string, e.g. a quote added to a plain-text message. */
export function htmlToPlain(html: string): string {
  const root = document.createElement('div')
  root.append(sanitizeFragment(html))
  return toPlainText(root)
}
