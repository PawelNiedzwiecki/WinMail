import { randomUUID } from 'crypto'
import type { SendInput, WaitingInfo } from '../shared/types'
import { nudgeTime } from '../shared/waiting'
import type { MailService, ReplyCandidate } from './mail'
import type { Store } from './store'

/** A due message whose account could not be searched is tried again after this long. */
const RETRY_MS = 10 * 60_000
/** A due message whose account can't be searched for this long comes back anyway. */
const GIVE_UP_MS = 12 * 60 * 60_000
/** Longest wait accepted, whatever the caller asks for. */
const MAX_DAYS = 60

const clampDays = (days: number) => Math.min(MAX_DAYS, Math.max(1, Math.round(days)))

/** Nudged first (newest nudge on top), then by when they come back. */
function order(a: WaitingInfo, b: WaitingInfo): number {
  if (!!a.nudgedAt !== !!b.nudgedAt) return a.nudgedAt ? -1 : 1
  if (a.nudgedAt && b.nudgedAt) return b.nudgedAt.localeCompare(a.nudgedAt)
  return a.dueAt.localeCompare(b.dueAt)
}

function isWaitingInfo(x: unknown): x is WaitingInfo {
  const w = x as WaitingInfo
  return (
    !!w &&
    typeof w.id === 'string' &&
    typeof w.accountId === 'string' &&
    typeof w.messageId === 'string' &&
    typeof w.to === 'string' &&
    typeof w.subject === 'string' &&
    typeof w.days === 'number' &&
    !Number.isNaN(Date.parse(w.sentAt)) &&
    !Number.isNaN(Date.parse(w.dueAt))
  )
}

/**
 * Waiting for: sent messages that expect a reply, kept in winmail.json. A reply is any message from someone else
 * (not an out-of-office answer or a bounce) whose In-Reply-To or References names the sent message; WinMail sees
 * those as it syncs any folder, and searches the server once more when a message is due. With no reply by then it
 * comes back as a nudge. Local only: nothing moves on the server.
 */
export class WaitingFor {
  private checking = false
  /** Item id -> when its account last failed to be searched. */
  private failedAt = new Map<string, number>()

  constructor(
    private store: Store,
    private mail: MailService,
    private changed: () => void,
    private nudge: (items: WaitingInfo[]) => void
  ) {
    mail.watchReplies((rows) => this.seen(rows))
  }

  list(): WaitingInfo[] {
    return [...this.store.listWaiting()].sort(order)
  }

  /**
   * A message went out. Writing again in a conversation ends the wait for the earlier message in it; the new
   * message's own switch (`waitDays`) decides whether WinMail waits for a reply to it.
   */
  sent(input: SendInput, messageId: string, at = new Date()): void {
    const before = this.store.listWaiting()
    const earlier = new Set([...(input.references ?? []), ...(input.inReplyTo ? [input.inReplyTo] : [])])
    const list = before.filter((w) => !(w.accountId === input.accountId && earlier.has(w.messageId)))
    const days = input.waitDays && input.waitDays > 0 ? clampDays(input.waitDays) : 0
    if (days) {
      list.push({
        id: randomUUID(),
        accountId: input.accountId,
        messageId,
        to: [input.to, input.cc, input.bcc].filter(Boolean).join(', '),
        subject: input.subject,
        sentAt: at.toISOString(),
        days,
        dueAt: nudgeTime(at, days).toISOString()
      })
    }
    if (list.length === before.length && !days) return
    this.store.setWaiting(list)
    this.changed()
  }

  /** Mail WinMail fetched: anything that answers a waited-for message ends the wait. */
  private seen(rows: ReplyCandidate[]): void {
    const list = this.store.listWaiting()
    if (!list.length) return
    const own = new Set(this.store.listAccounts().map((a) => a.email.toLowerCase()))
    const people = rows.filter((r) => !r.automatic && r.from && !own.has(r.from.toLowerCase()))
    if (!people.length) return
    // A message that names ours in its References was written after ours, so no date check is needed.
    const answered = list.filter((w) => people.some((r) => r.accountId === w.accountId && r.parents.includes(w.messageId)))
    if (!answered.length) return
    for (const w of answered) this.failedAt.delete(w.id)
    this.store.setWaiting(list.filter((w) => !answered.includes(w)))
    this.changed()
  }

  /**
   * Brings back due messages nobody answered. Each account is searched once more first, since the reply may sit in
   * a folder WinMail hasn't synced; an account that can't be reached is tried again later, and after half a day its
   * messages come back anyway. Disabled accounts wait until they are on again.
   */
  async check(now = Date.now()): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const enabled = new Set(this.store.listAccounts().filter((a) => a.enabled).map((a) => a.id))
      const due = this.store
        .listWaiting()
        .filter((w) => !w.nudgedAt && Date.parse(w.dueAt) <= now && enabled.has(w.accountId))
        .filter((w) => now - (this.failedAt.get(w.id) ?? 0) >= RETRY_MS)
      if (!due.length) return
      const nudged: string[] = []
      for (const accountId of new Set(due.map((w) => w.accountId))) {
        const mine = due.filter((w) => w.accountId === accountId)
        try {
          await this.mail.lookForReplies(accountId, mine.map((w) => w.messageId))
          for (const w of mine) this.failedAt.delete(w.id)
          nudged.push(...mine.map((w) => w.id))
        } catch (err) {
          console.error('[waiting] could not look for replies:', err instanceof Error ? err.message : err)
          for (const w of mine) {
            this.failedAt.set(w.id, now)
            if (now - Date.parse(w.dueAt) >= GIVE_UP_MS) nudged.push(w.id)
          }
        }
      }
      // Replies found by the search have already left the list.
      const at = new Date(now).toISOString()
      const back: WaitingInfo[] = []
      const list = this.store.listWaiting().map((w) => {
        if (!nudged.includes(w.id) || w.nudgedAt) return w
        const n = { ...w, nudgedAt: at }
        back.push(n)
        return n
      })
      if (!back.length) return
      this.store.setWaiting(list)
      this.changed()
      this.nudge(back)
    } finally {
      this.checking = false
    }
  }

  stop(id: string): WaitingInfo {
    const list = this.store.listWaiting()
    const item = list.find((w) => w.id === id)
    if (!item) throw new Error('This message is no longer waiting for a reply.')
    this.failedAt.delete(id)
    this.store.setWaiting(list.filter((w) => w.id !== id))
    this.changed()
    return item
  }

  /** Puts back an item taken off with `stop` (Undo). */
  restore(item: WaitingInfo): void {
    if (!isWaitingInfo(item)) throw new Error('Nothing to put back.')
    if (!this.store.listAccounts().some((a) => a.id === item.accountId)) throw new Error('The account was removed.')
    const list = this.store.listWaiting()
    if (list.some((w) => w.id === item.id || (w.accountId === item.accountId && w.messageId === item.messageId))) return
    const { id, accountId, messageId, to, subject, sentAt, days, dueAt, nudgedAt } = item
    this.store.setWaiting([...list, { id, accountId, messageId, to, subject, sentAt, days: clampDays(days), dueAt, nudgedAt }])
    this.changed()
  }

  /** Waits `days` more from now; a nudged message goes back to waiting. */
  longer(id: string, days: number, now = new Date()): WaitingInfo {
    const list = this.store.listWaiting()
    const item = list.find((w) => w.id === id)
    if (!item) throw new Error('This message is no longer waiting for a reply.')
    const d = clampDays(days)
    const next: WaitingInfo = { ...item, days: d, dueAt: nudgeTime(now, d).toISOString(), nudgedAt: undefined }
    this.failedAt.delete(id)
    this.store.setWaiting(list.map((w) => (w.id === id ? next : w)))
    this.changed()
    return next
  }

  /** The sent copy, for opening it or writing a follow-up. */
  async message(id: string) {
    const item = this.store.listWaiting().find((w) => w.id === id)
    if (!item) throw new Error('This message is no longer waiting for a reply.')
    return this.mail.findSent(item.accountId, item.messageId)
  }
}
