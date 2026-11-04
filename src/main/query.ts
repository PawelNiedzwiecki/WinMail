import type { SearchObject } from 'imapflow'
import type { MailQuery, MessageSummary } from '../shared/types'

/** Turns a structured `MailQuery` into what the server understands: Gmail operators, or IMAP SEARCH criteria. */

/** YYYY-MM-DD plus `n` days, as YYYY-MM-DD. Calendar arithmetic, so clock changes don't matter. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** Seconds since the epoch at the start of a day in this computer's time zone (Gmail takes these exactly). */
function localMidnight(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.floor(new Date(y!, m! - 1, d!).getTime() / 1000)
}

/** One Gmail search term: brackets and quotes would change the query's structure, phrases get quoted. */
function gmailTerm(v: string): string {
  const t = v.replace(/["(){}]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^-+/, '')
  return /\s/.test(t) ? `"${t}"` : t
}

const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean)

/** Gmail search operators for X-GM-RAW; empty when the query matches everything. */
export function toGmailQuery(q: MailQuery): string {
  const out: string[] = []
  const anyOf = (op: string, list: string[]) => {
    const terms = clean(list).map((v) => `${op}:${gmailTerm(v)}`)
    if (terms.length) out.push(terms.length === 1 ? terms[0]! : `(${terms.join(' OR ')})`)
  }
  anyOf('from', q.from)
  anyOf('to', q.to)
  for (const s of clean(q.subject)) out.push(`subject:${gmailTerm(s)}`)
  for (const w of clean(q.words)) out.push(gmailTerm(w))
  if (q.after) out.push(`after:${localMidnight(q.after)}`)
  if (q.before) out.push(`before:${localMidnight(addDays(q.before, 1))}`)
  if (q.read) out.push(`is:${q.read}`)
  if (q.flagged) out.push('is:starred')
  if (q.hasAttachment) out.push('has:attachment')
  if (q.category) out.push(`category:${q.category}`)
  return out.join(' ')
}

/** Every one of `parts` must match. Keys can't repeat in one object, so repeats use NOT (OR (NOT a) (NOT b)). */
function allOf(parts: SearchObject[]): SearchObject {
  if (!parts.length) return { all: true }
  if (parts.length === 1) return parts[0]!
  const keys = parts.flatMap((p) => Object.keys(p))
  if (new Set(keys).size === keys.length) return Object.assign({}, ...parts) as SearchObject
  return { not: { or: parts.map((p) => ({ not: p })) } }
}

function oneOf(parts: SearchObject[]): SearchObject[] {
  if (parts.length < 2) return parts
  return [{ or: parts }]
}

/**
 * IMAP SEARCH criteria (RFC 3501). Dates are whole days on the server's calendar. IMAP has no attachment or
 * category search: attachments are narrowed to multipart/mixed here and checked with `keepImap`.
 */
export function toImapSearch(q: MailQuery): SearchObject {
  const parts: SearchObject[] = [
    ...oneOf(clean(q.from).map((from) => ({ from }))),
    ...oneOf(clean(q.to).map((to) => ({ to }))),
    ...clean(q.subject).map((subject) => ({ subject })),
    ...clean(q.words).map((text) => ({ text }))
  ]
  if (q.after) parts.push({ since: q.after })
  if (q.before) parts.push({ before: addDays(q.before, 1) })
  if (q.read) parts.push({ seen: q.read === 'read' })
  if (q.flagged) parts.push({ flagged: true })
  if (q.hasAttachment) parts.push({ header: { 'content-type': 'multipart/mixed' } })
  return allOf(parts)
}

/** Whether IMAP results need `keepImap`, so more are fetched than will be shown. */
export const imapNeedsCheck = (q: MailQuery) => q.hasAttachment || !!q.category

/** What IMAP SEARCH can't check, from the fetched summaries. */
export function keepImap(q: MailQuery, m: MessageSummary): boolean {
  if (q.hasAttachment && !m.hasAttachments) return false
  if (q.category && (m.category ?? 'primary') !== q.category) return false
  return true
}
