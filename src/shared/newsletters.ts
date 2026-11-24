/**
 * Newsletter magazine: which mail is a Newsletter, and which Magazine issue it belongs to. Pure and shared by the
 * main process (which moves Newsletters out of the Inbox) and the window (which shows them as issues).
 */
import { PROMO_SUBJECT, SOCIAL_DOMAINS, TRANSACTIONAL_SUBJECT } from './categorize'
import type { Address, MessageSummary, NewsletterRuleEntry } from './types'

/** Folder (a label on Gmail) that Newsletters are moved to. An existing folder with this name is reused. */
export const NEWSLETTER_FOLDER = 'Newsletters'

/** What the heuristic reads from a message's headers. */
export interface NewsletterHeaders {
  from: string
  subject: string
  /** The List-Unsubscribe header's value, if any. */
  listUnsubscribe?: string | null
  /** The List-Post header's value, if any. */
  listPost?: string | null
  /** In-Reply-To or References name another message. */
  isReply: boolean
  /** Auto-Submitted other than "no". */
  automated: boolean
}

/**
 * The header part of the rule: true when the message looks like a Newsletter whoever sent it. Sender rules, VIPs
 * and the user's own addresses are applied on top by `isNewsletter`.
 */
export function looksLikeNewsletter(h: NewsletterHeaders): boolean {
  // Subscribed to something: the sender offers a way out.
  if (!h.listUnsubscribe?.trim()) return false
  // A discussion list: people post to it (Google Groups, mailing lists). "List-Post: NO" is a newsletter saying so.
  if (h.listPost?.trim() && !/^no\b/i.test(h.listPost.trim())) return false
  if (h.isReply || h.automated) return false
  const domain = h.from.slice(h.from.lastIndexOf('@') + 1)
  if (SOCIAL_DOMAINS.test(domain)) return false
  // Receipts, codes, security alerts, bookings and shipping stay in the Inbox, unless the subject also sells.
  if (TRANSACTIONAL_SUBJECT.test(h.subject) && !PROMO_SUBJECT.test(h.subject)) return false
  return true
}

/** Who decides about a message beyond its headers. */
export interface NewsletterRule {
  /** Sender rules from the user, keyed by lower-case address. */
  rules: Record<string, 'always' | 'never'>
  /** VIP addresses, lower case: never Newsletters unless a rule says always. */
  vips: string[]
  /** The user's own addresses, lower case. */
  own: string[]
}

export function ruleMap(list: NewsletterRuleEntry[]): Record<string, 'always' | 'never'> {
  const out: Record<string, 'always' | 'never'> = {}
  for (const r of list) if (r.email) out[r.email.toLowerCase()] = r.rule
  return out
}

/** The rule for this sender, or undefined when the heuristic decides. */
export function senderRule(email: string, rule: NewsletterRule): 'always' | 'never' | undefined {
  return rule.rules[email.toLowerCase()]
}

/** Whether a message is a Newsletter: the user's sender rule first, then VIPs and own mail, then the headers. */
export function isNewsletter(m: Pick<MessageSummary, 'from' | 'newsletter'>, rule: NewsletterRule): boolean {
  const email = m.from.email.toLowerCase()
  const said = rule.rules[email]
  if (said) return said === 'always'
  if (!email || rule.vips.includes(email) || rule.own.includes(email)) return false
  return !!m.newsletter
}

/** Sender rules with one changed: `null` removes the sender's rule. Newest first. */
export function withRule(list: NewsletterRuleEntry[], sender: Address, rule: 'always' | 'never' | null): NewsletterRuleEntry[] {
  const email = sender.email.trim().toLowerCase()
  const rest = list.filter((r) => r.email.toLowerCase() !== email)
  if (!email || !rule) return rest
  return [{ email, name: sender.name?.trim() || undefined, rule }, ...rest]
}

// ---------- Issues ----------

export type MagazinePeriod = 'day' | 'week'

export interface Issue {
  /** Stable id, e.g. "day:2026-11-24" or "week:2026-11-23". */
  key: string
  period: MagazinePeriod
  /** Local midnight it starts at. */
  start: Date
  /** Local midnight the next issue starts at. */
  end: Date
}

function midnight(d: Date, addDays = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays)
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The issue `at` belongs to. Daily issues run from local midnight to midnight; weekly ones start at 00:00 on
 * `weekday` (0 Sunday … 6 Saturday). Built from date parts, so clock changes don't move a boundary.
 */
export function issueOf(at: Date, period: MagazinePeriod, weekday = 1): Issue {
  if (period === 'day') {
    const start = midnight(at)
    return { key: `day:${dayKey(start)}`, period, start, end: midnight(at, 1) }
  }
  const back = (at.getDay() - (((weekday % 7) + 7) % 7) + 7) % 7
  const start = midnight(at, -back)
  return { key: `week:${dayKey(start)}`, period, start, end: midnight(start, 7) }
}

/** When a message arrived, for its issue: the server's receive time, else its Date header. */
export function arrivedOf(m: Pick<MessageSummary, 'arrivedAt' | 'date'>): Date {
  return new Date(m.arrivedAt ?? m.date)
}

export interface IssueGroup<T> {
  issue: Issue
  /** Newest first. */
  items: T[]
}

/** Messages grouped into issues, newest issue first and newest message first within each. */
export function groupIssues<T extends Pick<MessageSummary, 'arrivedAt' | 'date'>>(
  list: T[],
  period: MagazinePeriod,
  weekday = 1
): IssueGroup<T>[] {
  const groups = new Map<string, IssueGroup<T>>()
  for (const m of list) {
    const at = arrivedOf(m)
    if (Number.isNaN(at.getTime())) continue
    const issue = issueOf(at, period, weekday)
    const g = groups.get(issue.key) ?? { issue, items: [] }
    g.items.push(m)
    groups.set(issue.key, g)
  }
  const out = [...groups.values()].sort((a, b) => b.issue.start.getTime() - a.issue.start.getTime())
  for (const g of out) g.items.sort((a, b) => arrivedOf(b).getTime() - arrivedOf(a).getTime())
  return out
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const SHORT_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' })

/** "Today", "Yesterday", "Monday 23 November", "This week", "Last week" or "Week of 9 November". */
export function issueTitle(issue: Issue, now: Date): string {
  const current = issueOf(now, issue.period, issue.period === 'week' ? issue.start.getDay() : 1)
  const before = issueOf(new Date(current.start.getTime() - 1), issue.period, issue.start.getDay())
  if (issue.key === current.key) return issue.period === 'day' ? 'Today' : 'This week'
  if (issue.key === before.key) return issue.period === 'day' ? 'Yesterday' : 'Last week'
  const sameYear = issue.start.getFullYear() === now.getFullYear()
  const text = issue.period === 'day' ? DAY_FMT.format(issue.start) : `Week of ${SHORT_FMT.format(issue.start)}`
  return sameYear ? text.replace(',', '') : `${text.replace(',', '')} ${issue.start.getFullYear()}`
}
