import {
  addLink,
  addPixel,
  cleanLink,
  findTrackingPixel,
  markedTitle,
  newReport,
  shieldText,
  type TextPart,
  type TrackerReport
} from '@shared/trackers'

/** What the shield made of one message: the body to show and what it found. */
export interface Shielded {
  /** The HTML with Tracking pixels removed and links cleaned; null for a plain-text message. */
  html: string | null
  /** The plain text split into text and links; null for an HTML message. */
  parts: TextPart[] | null
  report: TrackerReport
}

/**
 * Removes the Tracking pixels from an HTML message and cleans its links (see shared/trackers.ts).
 * Runs on the raw message in an inert document, before sanitising: nothing in it loads or runs. A message the
 * shield finds nothing in comes back as it was written, byte for byte.
 */
export function shieldHtml(html: string): { html: string; report: TrackerReport } {
  const report = newReport()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false

  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')!
    const pixel = findTrackingPixel({
      src,
      width: img.getAttribute('width'),
      height: img.getAttribute('height'),
      style: img.getAttribute('style')
    })
    if (!pixel) return
    addPixel(report, src.trim(), pixel)
    img.remove()
    changed = true
  })

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')!.trim()
    const res = cleanLink(href)
    if (res.change === 'none') return
    addLink(report, href, res)
    changed = true
    if (res.change !== 'marked') {
      a.setAttribute('href', res.href)
      return
    }
    // Left as written, but flagged: a note on hover, and a small glyph after links that have text.
    if (res.href !== href) a.setAttribute('href', res.href)
    const note = markedTitle(res.via)
    const title = a.getAttribute('title')
    a.setAttribute('title', title ? `${title} (${note.toLowerCase()})` : note)
    a.setAttribute('data-winmail-tracked', a.textContent?.trim() ? 'text' : 'image')
  })

  // outerHTML leaves out the doctype, which is harmless: the body goes through DOMPurify next, which drops it too.
  return changed ? { html: doc.documentElement.outerHTML, report } : { html, report }
}

/** Shields a message's body, HTML or plain text. */
export function shieldMessage(m: { html: string | null; text: string }): Shielded {
  if (m.html) {
    const { html, report } = shieldHtml(m.html)
    return { html, parts: null, report }
  }
  const { parts, report } = shieldText(m.text)
  return { html: null, parts, report }
}
