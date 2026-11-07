/**
 * Batched delivery: the rules that decide which Inbox mail is held, and when it is delivered. Pure and shared by
 * the main process (counts, notifications, the Delivery timer) and the window (which rows the Inbox shows). Local
 * only: held mail is hidden in WinMail and nothing changes on the server.
 */
import type { Address, Contact } from './types'

/** Delivery times offered when batching is first turned on. */
export const DEFAULT_DELIVERY_TIMES = ['09:00', '13:00', '17:00']

/** Most Delivery times in a day. */
export const MAX_DELIVERY_TIMES = 6

/** Minutes after midnight of "HH:MM" (or "H:MM"), or null when it is not a time of day. */
export function parseTime(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/** "09:00" from minutes after midnight. */
export function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Delivery times as saved: valid, "HH:MM", in order, each once, at most six. Nothing usable gives the defaults. */
export function normaliseTimes(list: unknown): string[] {
  const mins = Array.isArray(list) ? list.map(parseTime).filter((m): m is number => m !== null) : []
  const out = [...new Set(mins)].sort((a, b) => a - b).slice(0, MAX_DELIVERY_TIMES).map(formatTime)
  return out.length ? out : [...DEFAULT_DELIVERY_TIMES]
}

/**
 * The local time `minutes` after midnight on `day`'s date. Built from the date's parts, so a day on which the clocks
 * change still gets each Delivery once; a time that does not exist that day (skipped by the clocks going forward)
 * comes out an hour later, as Date does.
 */
function onDay(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0)
}

function addDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n, 12)
}

function minutesOf(times: string[]): number[] {
  return normaliseTimes(times).map((t) => parseTime(t)!)
}

/** The latest Delivery time at or before `now`: today's, or yesterday's last. */
export function lastDeliveryAt(now: Date, times: string[]): Date {
  const mins = minutesOf(times)
  for (let i = mins.length - 1; i >= 0; i--) {
    const at = onDay(now, mins[i]!)
    if (at.getTime() <= now.getTime()) return at
  }
  return onDay(addDays(now, -1), mins[mins.length - 1]!)
}

/** The first Delivery time after `now`: later today, or tomorrow's first. */
export function nextDeliveryAt(now: Date, times: string[]): Date {
  const mins = minutesOf(times)
  for (const m of mins) {
    const at = onDay(now, m)
    if (at.getTime() > now.getTime()) return at
  }
  return onDay(addDays(now, 1), mins[0]!)
}

/**
 * Moves `deliveredUntil` forward to the last Delivery time, never back. `crossed` is that Delivery time when it
 * moved, so the caller can make a Delivery of it; null when nothing was due.
 */
export function advance(deliveredUntil: string | null, now: Date, times: string[]): { deliveredUntil: string; crossed: Date | null } {
  const last = lastDeliveryAt(now, times)
  const prev = deliveredUntil ? Date.parse(deliveredUntil) : NaN
  if (Number.isFinite(prev) && prev >= last.getTime()) return { deliveredUntil: new Date(prev).toISOString(), crossed: null }
  return { deliveredUntil: last.toISOString(), crossed: last }
}

/** Whether two times fall on the same local calendar day. */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// ---------- Which mail is held ----------

/** What decides holding while batching is on. Addresses are lower case. */
export interface HoldRule {
  /** ISO time: Inbox mail that arrived after this waits for the next Delivery. */
  deliveredUntil: string
  /** VIPs' addresses: never held. */
  vips: string[]
  /** The user's own accounts: never held. */
  own: string[]
}

/** The parts of a message holding looks at. */
export interface Holdable {
  seen: boolean
  from: Address
  /** The Date header; stands in for `arrivedAt` on rows saved before WinMail read it. */
  date: string
  /** When the server received it (IMAP INTERNALDATE). */
  arrivedAt?: string
}

/** Lower-case addresses of a VIP list, for `HoldRule.vips`. */
export function vipAddresses(vips: Contact[]): string[] {
  return [...new Set(vips.map((v) => v.email.trim().toLowerCase()).filter(Boolean))]
}

export function isVip(email: string, vips: Contact[]): boolean {
  const e = email.trim().toLowerCase()
  return !!e && vips.some((v) => v.email.trim().toLowerCase() === e)
}

/**
 * An arrival time further ahead of this PC's clock than this is not believed (a server clock that is wrong, or mail
 * stored with a made-up date): such mail is shown, not held until real time catches up with it.
 */
export const FUTURE_SLACK_MS = 10 * 60_000

/**
 * Whether an Inbox message is held until the next Delivery: unread, arrived after the last one, and not from a VIP or
 * the user. The caller checks that it is in an Inbox; a null rule means batching is off.
 */
export function isHeld(m: Holdable, rule: HoldRule | null, now = Date.now()): boolean {
  if (!rule || m.seen) return false
  const arrived = Date.parse(m.arrivedAt ?? m.date)
  const until = Date.parse(rule.deliveredUntil)
  if (!Number.isFinite(arrived) || !Number.isFinite(until) || arrived <= until) return false
  if (arrived > now + FUTURE_SLACK_MS) return false
  const from = m.from.email.trim().toLowerCase()
  return !rule.vips.includes(from) && !rule.own.includes(from)
}
