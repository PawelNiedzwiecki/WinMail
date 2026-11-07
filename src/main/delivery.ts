import { randomUUID } from 'crypto'
import type { DeliveredItem, DeliveryKind, DeliveryRecord, DeliveryState, MessageSummary, Settings } from '../shared/types'
import { advance, nextDeliveryAt, sameDay, vipAddresses, type HoldRule } from '../shared/delivery'
import type { DeliveryStore, Store } from './store'

/** Deliveries kept for the Brief. */
const KEEP_RECORDS = 14
/** Messages listed in one record; the rest are only counted. */
const MAX_ITEMS = 200
/** A Delivery time noticed this long after it passed (the PC slept, WinMail was closed) is a catch-up, not announced. */
const ON_TIME_MS = 5 * 60_000

/** A delivered message as the mail service lists it, with what the Brief reads from its headers and structure. */
export type DeliveredMessage = MessageSummary & Pick<DeliveredItem, 'hasInvite' | 'bulk' | 'automatic'>

/** What Deliveries needs from the mail service. */
export interface DeliveryMail {
  /** Unread Inbox messages of an account that arrived after `after` and up to `until`, not from a VIP or the user. */
  heldBetween(accountId: string, after: string, until: string, rule: HoldRule): Promise<DeliveredMessage[]>
}

function toItem(m: DeliveredMessage): DeliveredItem {
  return {
    accountId: m.accountId,
    mailbox: m.mailbox,
    uid: m.uid,
    uidValidity: m.uidValidity,
    messageId: m.messageId,
    parents: m.parents,
    from: m.from,
    to: m.to,
    subject: m.subject,
    preview: m.preview,
    arrivedAt: m.arrivedAt ?? m.date,
    category: m.category,
    flagged: m.flagged,
    hasAttachments: m.hasAttachments,
    ...(m.hasInvite ? { hasInvite: true } : {}),
    ...(m.bulk ? { bulk: true } : {}),
    ...(m.automatic ? { automatic: true } : {})
  }
}

/**
 * Batched delivery: holds new Inbox mail until set times. One timestamp, `deliveredUntil`, decides what is held: Inbox
 * mail that arrived after it, unread and not from a VIP. It only moves forward (to each Delivery time as it passes, to
 * now on Deliver Now, to the moment batching is turned on), so nothing already shown is ever hidden again. Each move
 * becomes a Delivery record listing what it showed, for the Brief; Delivery times that pass while WinMail runs are
 * announced. Local only: nothing changes on the server.
 */
export class Deliveries {
  /** When the timer last ran; a Delivery time passed since then, and only just, is on time. */
  private lastTick: number | null = null
  /** The Delivery being made, while its search runs. */
  private running: Promise<void> | null = null

  constructor(
    private store: Store,
    private mail: DeliveryMail,
    private changed: () => void,
    private announce: (record: DeliveryRecord) => void
  ) {}

  private get settings(): Settings {
    return this.store.getSettings()
  }

  private saved(): DeliveryStore {
    return this.store.getDelivery()
  }

  /** `deliveredUntil` as it stands at `now`: the saved one, moved up to the last Delivery time if that has passed. */
  private until(now = new Date()): string | null {
    const s = this.settings
    if (!s.batchDelivery) return null
    const saved = this.saved().deliveredUntil
    // Batching on without a saved point (an older file, or set by hand): nothing before now is held.
    if (!saved) return now.toISOString()
    return advance(saved, now, s.deliveryTimes).deliveredUntil
  }

  /** What holds mail right now; null while batching is off. */
  rule(now = new Date()): HoldRule | null {
    const until = this.until(now)
    if (!until) return null
    return {
      deliveredUntil: until,
      vips: vipAddresses(this.settings.vips),
      own: this.store.listAccounts().map((a) => a.email.trim().toLowerCase())
    }
  }

  state(now = new Date()): DeliveryState {
    const s = this.settings
    const last = this.saved().records[0]
    return {
      on: s.batchDelivery,
      times: s.deliveryTimes,
      deliveredUntil: this.until(now),
      nextAt: s.batchDelivery ? nextDeliveryAt(now, s.deliveryTimes).toISOString() : null,
      last: last ? { at: last.at, kind: last.kind, count: last.items.length + last.more } : null
    }
  }

  records(): DeliveryRecord[] {
    return this.saved().records
  }

  /**
   * Settings were saved. Turning batching on starts holding from now; turning it off forgets the point (turning it on
   * again starts afresh). New times or VIPs change what is held, so the windows are told.
   */
  settingsChanged(before: Settings, after: Settings, now = new Date()): void {
    const d = this.saved()
    if (!before.batchDelivery && after.batchDelivery) this.store.setDelivery({ ...d, deliveredUntil: now.toISOString() })
    else if (before.batchDelivery && !after.batchDelivery) this.store.setDelivery({ ...d, deliveredUntil: null })
    const same =
      before.batchDelivery === after.batchDelivery &&
      before.deliveryTimes.join() === after.deliveryTimes.join() &&
      vipAddresses(before.vips).join() === vipAddresses(after.vips).join()
    if (!same) this.changed()
  }

  /** The 30-second timer: makes a Delivery when a Delivery time has passed. */
  async tick(now = new Date()): Promise<void> {
    const previous = this.lastTick
    this.lastTick = now.getTime()
    const s = this.settings
    if (!s.batchDelivery || this.running) return
    const saved = this.saved().deliveredUntil
    if (!saved) {
      this.store.setDelivery({ ...this.saved(), deliveredUntil: now.toISOString() })
      return
    }
    const { deliveredUntil, crossed } = advance(saved, now, s.deliveryTimes)
    if (!crossed) return
    const onTime = previous !== null && previous < crossed.getTime() && now.getTime() - crossed.getTime() <= ON_TIME_MS
    await this.deliver(saved, deliveredUntil, onTime ? 'scheduled' : 'catch-up', crossed)
  }

  /**
   * Shows everything held now. A Delivery already under way finishes first, so this one lists only what is left. It
   * starts from the saved point, not the last Delivery time, so mail from a Delivery time the timer has not reached
   * yet is in this record rather than in none.
   */
  async deliverNow(now = new Date()): Promise<DeliveryState> {
    if (this.running) await this.running
    if (!this.until(now)) throw new Error('Batched delivery is off.')
    const from = this.saved().deliveredUntil ?? now.toISOString()
    await this.deliver(from, now.toISOString(), 'now', now)
    return this.state(now)
  }

  /**
   * Moves the point to `to` (the windows show the mail at once), then lists what came between `from` and `to` for
   * the record. An account that can't be searched is left out of the record; its mail shows all the same.
   */
  private deliver(from: string, to: string, kind: DeliveryKind, at: Date): Promise<void> {
    const run = this.make(from, to, kind, at).finally(() => {
      if (this.running === run) this.running = null
    })
    this.running = run
    return run
  }

  private async make(from: string, to: string, kind: DeliveryKind, at: Date): Promise<void> {
    this.store.setDelivery({ ...this.saved(), deliveredUntil: to })
    this.changed()
    const rule = this.rule(at)
    const found: DeliveredMessage[] = []
    if (rule) {
      for (const a of this.store.listAccounts().filter((x) => x.enabled)) {
        try {
          found.push(...(await this.mail.heldBetween(a.id, from, to, rule)))
        } catch (err) {
          console.error('[delivery] could not list delivered mail:', err instanceof Error ? err.message : err)
        }
      }
    }
    found.sort((a, b) => (b.arrivedAt ?? b.date).localeCompare(a.arrivedAt ?? a.date))
    const records = this.saved().records
    const newest = records[0]
    const record: DeliveryRecord = {
      id: randomUUID(),
      at: at.toISOString(),
      kind,
      first: !newest || !sameDay(new Date(newest.at), at),
      items: found.slice(0, MAX_ITEMS).map(toItem),
      more: Math.max(0, found.length - MAX_ITEMS)
    }
    // Batching may have been turned off while the search ran; the record still says what was shown.
    this.store.setDelivery({ ...this.saved(), records: [record, ...records].slice(0, KEEP_RECORDS) })
    this.changed()
    if (kind === 'scheduled' && record.items.length) this.announce(record)
  }
}
