/**
 * The Brief: what a Delivery brought, in a few lines. Which delivered messages likely need the user ("Needs you", with
 * a reason), everything else grouped, and for the day's first Delivery (the Morning brief) the replies still awaited
 * and the overnight count. Pure and shared by the window (the card) and the main process (the Morning brief
 * notification). Local only: nothing here talks to a server or to Claude.
 */
import { categorize } from './categorize'
import { hhmm, isVip, sameDay } from './delivery'
import { asksQuestion, isAutomatic, isListAddress } from './waiting'
import type { Contact, DeliveredItem, DeliveryRecord, GmailCategory, WaitingInfo } from './types'

/** Why a delivered message is in "Needs you", strongest first. */
export type NeedsReason = 'vip' | 'invite' | 'replied' | 'question' | 'flagged' | 'to-you'

export const REASON_TEXT: Record<NeedsReason, string> = {
  vip: 'VIP',
  invite: 'invitation',
  replied: 'replied to you',
  question: 'asks you a question',
  flagged: 'flagged',
  'to-you': 'sent to you'
}

/** What the rules need to know about the user. */
export interface BriefContext {
  /** The user's own addresses, any case. */
  own: string[]
  vips: Contact[]
  /** Message-IDs of sent messages the user is Waiting for a reply to. */
  waitingIds: string[]
}

export interface NeedsRow {
  item: DeliveredItem
  reason: NeedsReason
}

/** People in "Also": one row per sender, newest message first. */
export interface PersonGroup {
  name: string
  email: string
  items: DeliveredItem[]
}

/** Newsletters and notifications in "Also", counted by category. */
export interface KindGroup {
  category: Exclude<GmailCategory, 'primary'> | 'other'
  label: string
  items: DeliveredItem[]
}

export interface Brief {
  recordId: string
  /** ISO time of the Delivery. */
  at: string
  kind: DeliveryRecord['kind']
  /** The day's first Delivery: the Morning brief. */
  morning: boolean
  /** Every message the Delivery showed, including those beyond the listed 200. */
  count: number
  /** Delivered but not listed in the record (beyond the 200). */
  more: number
  needs: NeedsRow[]
  people: PersonGroup[]
  kinds: KindGroup[]
  /** How many messages the `kinds` groups hold. */
  kindCount: number
  /** Morning brief only: nudged Waiting for messages and those due today. */
  waiting: WaitingInfo[]
  /** Morning brief only: what came since the last Delivery of an earlier day, if WinMail made one. */
  overnight: { count: number; since: string } | null
}

const lower = (s: string) => s.trim().toLowerCase()

/**
 * Marks the local part of the Message-IDs WinMail gives the mail it sends ("<winmail.UUID@domain>"). Apple Mail and
 * Thunderbird also use bare UUIDs at the sender's domain, so without the mark another person on the same domain
 * (icloud.com, gmail.com) would look like the user.
 */
export const OWN_ID_PREFIX = 'winmail.'

const OWN_ID = /^<winmail\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@([^<>@\s]+)>$/i

/** Whether a Message-ID is one WinMail gave a message the user sent from one of `own`'s domains. */
export function isOwnMessageId(id: string, own: string[]): boolean {
  const m = OWN_ID.exec(id.trim())
  if (!m) return false
  const domain = lower(m[1]!)
  return own.some((e) => lower(e).split('@')[1] === domain)
}

/** The item's Inbox category: WinMail's own, or worked out here for a record saved without one. */
function categoryOf(m: DeliveredItem): GmailCategory {
  return m.category ?? categorize({ email: m.from.email, subject: m.subject, bulk: m.bulk, automated: m.automatic })
}

/**
 * Whether a delivered message comes from a person: not a list or robot address, not an out-of-office answer or bounce,
 * not bulk mail, and in Primary. Updates (receipts, statements, bookings) count only when they answer something, as a
 * person's "Re: booking for Friday" does; a sender whose address alone looks like a service (billing@) never does.
 */
export function fromPerson(m: DeliveredItem): boolean {
  const email = m.from.email
  if (!email || isListAddress(email) || m.bulk) return false
  if (isAutomatic({ from: email, subject: m.subject, autoSubmitted: m.automatic })) return false
  const category = categoryOf(m)
  if (category !== 'primary' && !(category === 'updates' && m.parents?.length)) return false
  return categorize({ email, subject: '', automated: m.automatic }) === 'primary'
}

/** Why a message needs the user, or null when it doesn't seem to. */
export function needsYou(m: DeliveredItem, ctx: BriefContext): NeedsReason | null {
  const own = ctx.own.map(lower)
  if (own.includes(lower(m.from.email)) || !fromPerson(m)) return null
  if (isVip(m.from.email, ctx.vips)) return 'vip'
  if (m.hasInvite) return 'invite'
  const waiting = new Set(ctx.waitingIds)
  if ((m.parents ?? []).some((p) => waiting.has(p) || isOwnMessageId(p, ctx.own))) return 'replied'
  if (asksQuestion(m.preview)) return 'question'
  if (m.flagged) return 'flagged'
  if (m.to.some((a) => own.includes(lower(a.email)))) return 'to-you'
  return null
}

const KIND_ORDER: KindGroup['category'][] = ['updates', 'promotions', 'social', 'forums', 'other']
const KIND_LABEL: Record<KindGroup['category'], [string, string]> = {
  updates: ['notification', 'notifications'],
  promotions: ['newsletter or offer', 'newsletters and offers'],
  social: ['social update', 'social updates'],
  forums: ['list message', 'list messages'],
  other: ['other message', 'other messages']
}

/** "3 notifications", "1 newsletter or offer". */
export function kindLabel(category: KindGroup['category'], n: number): string {
  return `${n} ${KIND_LABEL[category][n === 1 ? 0 : 1]}`
}

/** Sent messages still waiting for a reply that the Morning brief mentions: nudged ones, and those due by tonight. */
export function stillWaiting(list: WaitingInfo[], now: Date): WaitingInfo[] {
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return list
    .filter((w) => !!w.nudgedAt || Date.parse(w.dueAt) < endOfDay)
    .sort((a, b) => (!!a.nudgedAt !== !!b.nudgedAt ? (a.nudgedAt ? -1 : 1) : a.dueAt.localeCompare(b.dueAt)))
}

/**
 * The Brief of one Delivery. `records` are the saved Deliveries, newest first (the record's predecessor gives the
 * Morning brief's "overnight since"); `waiting` is the Waiting for list.
 */
export function makeBrief(
  record: DeliveryRecord,
  ctx: BriefContext,
  opts: { records?: DeliveryRecord[]; waiting?: WaitingInfo[]; now?: Date } = {}
): Brief {
  const needs: NeedsRow[] = []
  const people = new Map<string, PersonGroup>()
  const kinds = new Map<KindGroup['category'], DeliveredItem[]>()
  for (const item of record.items) {
    const reason = needsYou(item, ctx)
    if (reason) {
      needs.push({ item, reason })
    } else if (fromPerson(item)) {
      const key = lower(item.from.email)
      const g = people.get(key) ?? { name: item.from.name || item.from.email, email: item.from.email, items: [] }
      g.items.push(item)
      people.set(key, g)
    } else {
      const cat = categoryOf(item)
      const c: KindGroup['category'] = cat === 'primary' ? 'other' : cat
      kinds.set(c, [...(kinds.get(c) ?? []), item])
    }
  }
  const rank: Record<NeedsReason, number> = { vip: 0, invite: 1, replied: 2, question: 3, flagged: 4, 'to-you': 5 }
  needs.sort((a, b) => rank[a.reason] - rank[b.reason] || b.item.arrivedAt.localeCompare(a.item.arrivedAt))
  const kindGroups = KIND_ORDER.filter((c) => kinds.has(c)).map((c) => ({
    category: c,
    label: kindLabel(c, kinds.get(c)!.length),
    items: kinds.get(c)!
  }))

  const morning = record.first
  const count = record.items.length + record.more
  let overnight: Brief['overnight'] = null
  if (morning) {
    const list = opts.records ?? []
    const i = list.findIndex((r) => r.id === record.id)
    const before = i >= 0 ? list[i + 1] : list.find((r) => r.at < record.at)
    if (before) overnight = { count, since: before.at }
  }
  return {
    recordId: record.id,
    at: record.at,
    kind: record.kind,
    morning,
    count,
    more: record.more,
    needs,
    people: [...people.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)),
    kinds: kindGroups,
    kindCount: kindGroups.reduce((n, g) => n + g.items.length, 0),
    waiting: morning ? stillWaiting(opts.waiting ?? [], opts.now ?? new Date()) : [],
    overnight
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "13:00 delivery · 7 messages", or "Morning brief · 09:00 · 12 messages". */
export function briefHeading(b: Pick<Brief, 'at' | 'morning' | 'count'>): string {
  const n = plural(b.count, 'message')
  return b.morning ? `Morning brief · ${hhmm(b.at)} · ${n}` : `${hhmm(b.at)} delivery · ${n}`
}

/** "17:00 yesterday", "Thursday at 17:00", for the overnight line. */
export function sinceText(iso: string, now: Date): string {
  const d = new Date(iso)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12)
  if (sameDay(d, now)) return hhmm(iso)
  if (sameDay(d, yesterday)) return `${hhmm(iso)} yesterday`
  return `${d.toLocaleDateString('en-GB', { weekday: 'long' })} at ${hhmm(iso)}`
}

/** The Morning brief notification: "Morning brief", "12 messages, 3 need you". */
export function morningNotice(b: Brief): { title: string; body: string } {
  const parts = [plural(b.count, 'message')]
  if (b.needs.length) parts[0] += `, ${b.needs.length} need${b.needs.length === 1 ? 's' : ''} you`
  if (b.waiting.length) parts.push(`${plural(b.waiting.length, 'reply', 'replies')} still awaited`)
  return { title: 'Morning brief', body: parts.join('\n') }
}

/** Longest preview sent per message for the Claude paragraph. */
const PREVIEW_CHARS = 300

/**
 * What the Brief's optional Claude paragraph sends (the Brief Content opt-in): the sender, subject and preview of
 * each delivered message, and nothing else.
 */
export function briefPrompt(record: DeliveryRecord): string {
  const lines = record.items.map((m, i) => {
    const from = m.from.name && m.from.name !== m.from.email ? `${m.from.name} <${m.from.email}>` : m.from.email
    const preview = m.preview.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS)
    return `${i + 1}. From: ${from}\nSubject: ${m.subject || '(No Subject)'}\nPreview: ${preview}`
  })
  if (record.more) lines.push(`(and ${record.more} more not listed)`)
  return lines.join('\n\n')
}
