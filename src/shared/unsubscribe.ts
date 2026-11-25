/**
 * Unsubscribe audit: reading List-Unsubscribe, grouping list mail into mailing lists and ranking them by how little the
 * user opens them. Pure and shared by the main process (scan, unsubscribing) and the window (wording).
 */
import type { ListMessage, MailingList, Unsubscribe, UnsubscribeWay } from './types'

/** How far back the audit looks. */
export const AUDIT_DAYS = 90
/** Mail this long after an unsubscribe means the list is still sending. */
export const STILL_SENDING_MS = 7 * 86_400_000

/**
 * List-Unsubscribe (RFC 2369) with List-Unsubscribe-Post (RFC 8058). Only https links are used; a link with the
 * One-Click post header can be POSTed to directly. Null when the header offers no usable way out.
 */
export function parseUnsubscribe(header: string | null | undefined, post?: string | null): Unsubscribe | null {
  if (!header) return null
  const links = (header.match(/<([^>]+)>/g) ?? []).map((l) => l.slice(1, -1).trim())
  const url = links.find((l) => /^https:\/\//i.test(l))
  const mailto = links.find((l) => /^mailto:/i.test(l))
  if (!url && !mailto) return null
  return { url, mailto, oneClick: !!url && /List-Unsubscribe=One-Click/i.test(post ?? '') }
}

/** One-click if offered, then an email, then the web page. */
export function unsubscribeWay(u: Unsubscribe | null): UnsubscribeWay | null {
  if (!u) return null
  if (u.oneClick && u.url) return 'one-click'
  if (u.mailto) return 'email'
  return u.url ? 'web' : null
}

/** The identifier in a List-Id header ("Weekly news <weekly.example.com>" gives "weekly.example.com"), lower case. */
export function listIdOf(header: string | null | undefined): string | undefined {
  if (!header) return undefined
  const m = /<([^<>\s]+)>/.exec(header)
  const id = (m ? m[1]! : header).trim().toLowerCase()
  return id || undefined
}

/** A list is its List-Id, else its sender's address. */
export function listKey(m: Pick<ListMessage, 'listId' | 'from'>): string {
  return m.listId ? `list:${m.listId}` : `from:${m.from.email.trim().toLowerCase()}`
}

/** Where to send an unsubscribe email, from a mailto: link. Null when it has no address. */
export function parseMailto(link: string): { to: string; subject: string; body: string } | null {
  if (!/^mailto:/i.test(link)) return null
  const rest = link.slice(7)
  const q = rest.indexOf('?')
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, '%20'))
    } catch {
      return s
    }
  }
  const to = decode(q < 0 ? rest : rest.slice(0, q)).trim()
  if (!/^[^\s@,]+@[^\s@,]+$/.test(to)) return null
  const params = new URLSearchParams(q < 0 ? '' : rest.slice(q + 1))
  return { to, subject: params.get('subject')?.trim() || 'unsubscribe', body: params.get('body')?.trim() || 'unsubscribe' }
}

/** Remembered unsubscribes: list key -> ISO time. */
export type Unsubscribed = Record<string, string>

/**
 * Mailing lists from list mail, least opened first (the opened share, then the most mail). The user's own addresses
 * are left out. The name, address and way out come from the newest message that has them.
 */
export function rankLists(messages: ListMessage[], own: string[], unsubscribed: Unsubscribed = {}): MailingList[] {
  const mine = new Set(own.map((e) => e.toLowerCase()))
  const groups = new Map<string, ListMessage[]>()
  for (const m of messages) {
    if (!m.from.email || mine.has(m.from.email.toLowerCase())) continue
    const k = listKey(m)
    const g = groups.get(k)
    if (g) g.push(m)
    else groups.set(k, [m])
  }
  const lists: MailingList[] = []
  for (const [key, all] of groups) {
    // The same message in two scanned folders (Gmail's All Mail and a label) counts once.
    const seenIds = new Set<string>()
    const list = all
      .filter((m) => {
        if (!m.messageId) return true
        if (seenIds.has(m.messageId)) return false
        seenIds.add(m.messageId)
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
    const newest = list[0]!
    const offer = list.find((m) => unsubscribeWay(m.unsubscribe) !== null) ?? newest
    const at = unsubscribed[key]
    lists.push({
      key,
      name: list.find((m) => m.from.name && m.from.name !== m.from.email)?.from.name ?? newest.from.email,
      address: newest.from.email.toLowerCase(),
      total: list.length,
      opened: list.filter((m) => m.seen).length,
      lastAt: newest.date,
      accountIds: [...new Set(list.map((m) => m.accountId))],
      unsubscribe: offer.unsubscribe,
      way: unsubscribeWay(offer.unsubscribe),
      accountId: offer.accountId,
      ...(at
        ? { unsubscribedAt: at, stillSending: list.some((m) => Date.parse(m.date) - Date.parse(at) > STILL_SENDING_MS) }
        : {})
    })
  }
  // Lists already left (and quiet since) go last; the rest by opened share, then volume.
  const left = (l: MailingList) => (l.unsubscribedAt && !l.stillSending ? 1 : 0)
  return lists.sort(
    (a, b) => left(a) - left(b) || a.opened / a.total - b.opened / b.total || b.total - a.total || a.name.localeCompare(b.name)
  )
}

/** "You've opened 0 of 48 from these 12 lists." */
export function auditSummary(lists: Pick<MailingList, 'total' | 'opened'>[]): string {
  const total = lists.reduce((n, l) => n + l.total, 0)
  const opened = lists.reduce((n, l) => n + l.opened, 0)
  const these = lists.length === 1 ? 'this list' : `these ${lists.length} lists`
  return `You've opened ${opened} of ${total} from ${these}.`
}
