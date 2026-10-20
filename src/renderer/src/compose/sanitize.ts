import DOMPurify from 'dompurify'

/**
 * HTML that enters the editor (pasted, quoted, forwarded, reopened drafts) or leaves it. The editor
 * lives in the app's own document, not in a sandboxed frame like HtmlBody, so this is stricter:
 * no <style> or <link>, a few known classes only, and inline CSS limited to what mail needs.
 * Its own DOMPurify instance, so HtmlBody's hook (links open in a new window) doesn't apply.
 */
const purify = DOMPurify(window)

const TAGS = [
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'span', 'font', 'br', 'p', 'div',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'hr', 'img', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'td', 'th', 'caption'
]
const ATTRS = [
  'href', 'src', 'alt', 'title', 'style', 'dir', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan',
  'cellpadding', 'cellspacing', 'border', 'bgcolor', 'color', 'face', 'size', 'start', 'type', 'class',
  'data-winmail-src'
]
/** Classes kept: Gmail's quote markup (so Gmail users get "Show trimmed content") and ours. */
const CLASSES = new Set([
  'gmail_quote',
  'gmail_attr',
  'gmail_sendername',
  'gmail_signature',
  'winmail-signature',
  'winmail-body'
])
const CSS_PROPS =
  /^(color|background|background-color|font|font-(family|size|style|weight|variant)|text-(align|decoration|decoration-line|indent|transform)|line-height|letter-spacing|white-space|vertical-align|direction|margin(-(top|right|bottom|left))?|padding(-(top|right|bottom|left))?|border(-(top|right|bottom|left))?(-(width|style|color))?|border-(collapse|spacing|radius)|width|min-width|max-width|height|max-height|display|list-style(-type)?|table-layout|word-break|overflow-wrap)$/
const CSS_DISPLAY = /^(block|inline|inline-block|table|table-row|table-cell|list-item|none)$/
const CSS_UNSAFE = /url\(|expression\(|var\(|javascript:|@import|behavior|-moz-binding/i

function cleanStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => {
      const i = d.indexOf(':')
      if (i < 1) return false
      const prop = d.slice(0, i).trim().toLowerCase()
      const value = d.slice(i + 1).trim()
      if (!CSS_PROPS.test(prop) || CSS_UNSAFE.test(value)) return false
      return prop !== 'display' || CSS_DISPLAY.test(value.toLowerCase())
    })
    .join('; ')
}

purify.addHook('uponSanitizeAttribute', (node, data) => {
  const value = data.attrValue.trim()
  if (data.attrName === 'class') {
    const kept = value.split(/\s+/).filter((c) => CLASSES.has(c))
    if (kept.length) data.attrValue = kept.join(' ')
    else data.keepAttr = false
  } else if (data.attrName === 'style') {
    data.attrValue = cleanStyle(value)
    if (!data.attrValue) data.keepAttr = false
  } else if (data.attrName === 'href') {
    if (!/^(https?:|mailto:|tel:)/i.test(value)) data.keepAttr = false
  } else if (data.attrName === 'src') {
    const image = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(value)
    if (node.nodeName !== 'IMG' || !(image || /^https?:/i.test(value))) data.keepAttr = false
  } else if (data.attrName === 'data-winmail-src') {
    if (!/^https?:/i.test(value)) data.keepAttr = false
  }
})

const CONFIG = {
  ALLOWED_TAGS: TAGS,
  ALLOWED_ATTR: ATTRS,
  ALLOW_DATA_ATTR: false,
  RETURN_DOM_FRAGMENT: true as const
}

export interface SanitizeOptions {
  /** Park remote images (see `parkRemoteImages`); for quoted and forwarded mail. */
  blockRemote?: boolean
}

export function sanitizeFragment(html: string, opts: SanitizeOptions = {}): DocumentFragment {
  const frag = purify.sanitize(html, CONFIG)
  if (opts.blockRemote) parkRemoteImages(frag)
  return frag
}

export function sanitizeHtml(html: string, opts: SanitizeOptions = {}): string {
  const box = document.createElement('div')
  box.append(sanitizeFragment(html, opts))
  return box.innerHTML
}

/**
 * Remote images wait in data-winmail-src while composing, so replying to a newsletter doesn't
 * fire its tracking pixels. The address goes back on when the message is sent.
 */
export function parkRemoteImages(root: ParentNode): void {
  root.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')!
    if (!/^https?:/i.test(src)) return
    img.setAttribute('data-winmail-src', src)
    img.removeAttribute('src')
  })
}

export function restoreRemoteImages(root: ParentNode): void {
  root.querySelectorAll('img[data-winmail-src]').forEach((img) => {
    img.setAttribute('src', img.getAttribute('data-winmail-src')!)
    img.removeAttribute('data-winmail-src')
  })
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Plain text as HTML lines, the way the editor writes them (one <div> per line). */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => `<div>${l ? escapeHtml(l) : '<br>'}</div>`)
    .join('')
}
