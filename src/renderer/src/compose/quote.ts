import type { Address, MessageDetail, MessageSummary } from '@shared/types'
import { stripPrefixes } from '@shared/subject'
import { chipsFromAddresses, type Chip } from './addresses'
import { QUOTE_STYLE } from './outgoing'
import { escapeHtml, sanitizeHtml, textToHtml } from './sanitize'
import type { ReplyMode } from './sessions'

export const subjectFor = (mode: ReplyMode, subject: string) =>
  `${mode === 'forward' ? 'Fwd' : 'Re'}: ${stripPrefixes(subject === '(No Subject)' ? '' : subject)}`

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const who = (a: Address) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email)

function dedupe(list: Address[]): Address[] {
  const seen = new Set<string>()
  return list.filter((a) => {
    const k = a.email.toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Who a reply goes to: Reply-To when the sender set it (mailing lists, support desks), otherwise
 * From; reply all adds the other To and Cc recipients. Your own addresses are left out, and the
 * original Bcc never is used. Replying to your own message (from Sent) goes to its recipients.
 */
export function replyRecipients(
  mode: Exclude<ReplyMode, 'forward'>,
  summary: MessageSummary,
  detail: MessageDetail | null,
  own: Set<string>
): { to: Chip[]; cc: Chip[] } {
  const isOwn = (a: Address) => own.has(a.email.toLowerCase())
  const origTo = detail?.to ?? summary.to
  const fromMe = isOwn(summary.from)
  let to: Address[] = fromMe ? origTo : detail?.replyTo.length ? detail.replyTo : [summary.from]
  let cc: Address[] = []
  if (mode === 'all') {
    const others = fromMe ? (detail?.cc ?? []) : [...origTo, ...(detail?.cc ?? [])]
    cc = others.filter((a) => !isOwn(a) && !to.some((t) => t.email.toLowerCase() === a.email.toLowerCase()))
  }
  if (!fromMe) to = to.filter((a) => !isOwn(a) || to.length === 1)
  return { to: chipsFromAddresses(dedupe(to)), cc: chipsFromAddresses(dedupe(cc)) }
}

/** The message's own content for quoting: its HTML cleaned for the editor, or its text. */
function original(summary: MessageSummary, detail: MessageDetail | null, allowRemote: boolean): string {
  if (detail?.html) return sanitizeHtml(detail.html, { blockRemote: !allowRemote })
  return textToHtml(detail?.text ?? summary.preview)
}

/** Gmail's quote markup, so Gmail users get "Show trimmed content" for it too. */
export function replyQuote(summary: MessageSummary, detail: MessageDetail | null, allowRemote: boolean): string {
  const attr = `On ${escapeHtml(when(summary.date))}, ${escapeHtml(who(summary.from))} wrote:`
  return (
    `<div class="gmail_quote"><div class="gmail_attr" dir="ltr">${attr}<br></div>` +
    `<blockquote class="gmail_quote" style="${QUOTE_STYLE}">${original(summary, detail, allowRemote)}</blockquote></div>`
  )
}

const FORWARD_LINE = '---------- Forwarded message ---------'

export function forwardBlock(summary: MessageSummary, detail: MessageDetail | null, allowRemote: boolean): string {
  const line = (k: string, v: string) => `${k}: ${escapeHtml(v)}<br>`
  const from = summary.from
  const head =
    `${FORWARD_LINE}<br>` +
    `From: <strong class="gmail_sendername">${escapeHtml(from.name || from.email)}</strong> &lt;${escapeHtml(from.email)}&gt;<br>` +
    line('Date', when(summary.date)) +
    line('Subject', summary.subject) +
    line('To', (detail?.to ?? summary.to).map(who).join(', ')) +
    (detail?.cc.length ? line('Cc', detail.cc.map(who).join(', ')) : '')
  return (
    `<div class="gmail_quote"><div class="gmail_attr" dir="ltr">${head}</div><br>` +
    `${original(summary, detail, allowRemote)}</div>`
  )
}

export const isForwardBlock = (el: Element) =>
  el.matches('div.gmail_quote') && !!el.querySelector(':scope > .gmail_attr')?.textContent?.startsWith(FORWARD_LINE)

/** Last child that shows anything, skipping empty lines. */
function lastMeaningful(root: Element): Element | null {
  for (let n = root.lastChild; n; n = n.previousSibling) {
    if (n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()) continue
    if (n instanceof Element && n.matches('div, p') && !n.textContent?.trim() && !n.querySelector('img')) continue
    return n instanceof Element ? n : null
  }
  return null
}

/**
 * A reopened draft, already sanitized: our wrapper comes off, and a reply quote at the very end goes
 * back behind "···". A quote with text written below it stays in the body.
 */
export function splitDraft(html: string): { body: string; quote: string | null } {
  const root = document.createElement('div')
  root.innerHTML = html
  const wrapper = root.children.length === 1 ? root.querySelector(':scope > div.winmail-body') : null
  if (wrapper) wrapper.replaceWith(...wrapper.childNodes)
  const last = lastMeaningful(root)
  if (last?.matches('div.gmail_quote') && !isForwardBlock(last)) {
    last.remove()
    return { body: root.innerHTML || '<div><br></div>', quote: last.outerHTML }
  }
  return { body: root.innerHTML || '<div><br></div>', quote: null }
}
