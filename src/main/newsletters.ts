import type { Address, MessageRef, MessageSummary, Settings } from '../shared/types'
import { isNewsletter, ruleMap, withRule, type NewsletterRule } from '../shared/newsletters'
import { vipAddresses } from '../shared/delivery'
import type { NewsletterCandidate } from './mail'
import type { NewsletterMark, Store } from './store'

/** Inbox messages looked at in one go; more wait for the next round of the same sweep. */
const MAX_PER_SWEEP = 500
/** The one-time move looks at this many of the newest Inbox messages per account. */
const INBOX_LOOK = 2000
/** The timer sweeps this often, in case IDLE missed new mail. */
const SWEEP_EVERY_MS = 5 * 60_000

/** What Newsletters needs from the mail service. */
export interface NewsletterMail {
  inboxPath(accountId: string): string
  inboxAfter(
    accountId: string,
    mark: { uidValidity: string; uid: number } | null,
    max: number
  ): Promise<{ uidValidity: string; uid: number; items: NewsletterCandidate[] }>
  inboxNewest(accountId: string, n: number): Promise<{ uidValidity: string; items: NewsletterCandidate[] }>
  moveToNewsletters(accountId: string, path: string, uids: number[], uidValidity?: string): Promise<number>
  moveToInbox(accountId: string, path: string, uids: number[], uidValidity?: string): Promise<void>
}

/**
 * Newsletter magazine: moves Newsletters out of the Inbox to the `Newsletters` folder (a label on Gmail), so every
 * device gets a calmer Inbox. A mark per account says how far into the Inbox WinMail has looked; it starts at the
 * newest message when the feature is turned on, so only new mail moves by itself. Mail that came while WinMail was
 * closed moves at the next start, since the mark is saved.
 */
export class Newsletters {
  /** Sweeps running, per account. */
  private running = new Map<string, Promise<void>>()
  /** Accounts asked to sweep while a sweep ran: it goes round once more. */
  private again = new Set<string>()
  private lastTick = 0

  constructor(
    private store: Store,
    private mail: NewsletterMail,
    private changed: () => void
  ) {}

  private get settings(): Settings {
    return this.store.getSettings()
  }

  private enabledAccounts(): string[] {
    return this.store
      .listAccounts()
      .filter((a) => a.enabled)
      .map((a) => a.id)
  }

  rule(): NewsletterRule {
    const s = this.settings
    return {
      rules: ruleMap(s.newsletterRules),
      vips: vipAddresses(s.vips),
      own: this.store.listAccounts().map((a) => a.email.trim().toLowerCase())
    }
  }

  /** An Inbox message that is about to move to Newsletters: it is not announced. */
  willMove(m: Pick<MessageSummary, 'from' | 'newsletter'>): boolean {
    return this.settings.newsletters && isNewsletter(m, this.rule())
  }

  /** Turned on: start watching from now. Turned off: forget the marks, so turning on again starts from then. */
  settingsChanged(before: Settings, after: Settings): void {
    if (before.newsletters === after.newsletters) return
    for (const a of this.store.listAccounts()) this.store.setNewsletterMark(a.id, null)
    this.changed()
    if (after.newsletters) void this.sweep()
  }

  /** Called from the 30-second timer: sweeps every few minutes. */
  async tick(now = Date.now()): Promise<void> {
    if (!this.settings.newsletters || now - this.lastTick < SWEEP_EVERY_MS) return
    this.lastTick = now
    await this.sweep()
  }

  /** Moves new Newsletters out of the Inbox of one account, or of every enabled account. */
  async sweep(accountId?: string): Promise<void> {
    if (!this.settings.newsletters) return
    const ids = accountId ? [accountId] : this.enabledAccounts()
    await Promise.all(ids.map((id) => this.sweepAccount(id)))
  }

  private sweepAccount(accountId: string): Promise<void> {
    const running = this.running.get(accountId)
    if (running) {
      this.again.add(accountId)
      return running
    }
    const p = this.sweepRounds(accountId).finally(() => this.running.delete(accountId))
    this.running.set(accountId, p)
    return p
  }

  private async sweepRounds(accountId: string): Promise<void> {
    let moved = 0
    try {
      do {
        this.again.delete(accountId)
        const n = await this.sweepOnce(accountId)
        if (n < 0) break
        moved += n
      } while (this.again.has(accountId))
    } catch (err) {
      console.error('[newsletters] sweep failed:', err instanceof Error ? err.message : err)
    } finally {
      this.again.delete(accountId)
      if (moved) this.changed()
    }
  }

  /** One look past the mark. Returns how many moved, or -1 when the feature was turned off meanwhile. */
  private async sweepOnce(accountId: string): Promise<number> {
    const before = this.store.newsletterMark(accountId)
    const got = await this.mail.inboxAfter(accountId, before, MAX_PER_SWEEP)
    if (!this.settings.newsletters) return -1
    const sameInbox = before && before.uidValidity === got.uidValidity
    const mark: NewsletterMark = { uidValidity: got.uidValidity, uid: got.uid, since: sameInbox ? before.since : new Date().toISOString() }
    const picked = this.pick(got.items, mark.since)
    let moved = 0
    if (picked.length) {
      moved = await this.mail.moveToNewsletters(accountId, this.mail.inboxPath(accountId), picked.map((c) => c.uid), got.uidValidity)
      this.store.addNewslettersMoved(picked.map((c) => c.messageId).filter((id): id is string => !!id))
    }
    // Only after the move worked: a failed move is tried again next time.
    if (!this.settings.newsletters) return -1
    this.store.setNewsletterMark(accountId, mark)
    if (got.items.length >= MAX_PER_SWEEP) this.again.add(accountId)
    return moved
  }

  /**
   * The Newsletters among `items`. Mail that arrived before WinMail started watching (`since`) and mail WinMail
   * moved before and that is back in the Inbox (the user moved it back, or it woke from Snooze) stays where it is.
   */
  private pick(items: NewsletterCandidate[], since: string | null): NewsletterCandidate[] {
    const rule = this.rule()
    const moved = new Set(this.store.newslettersMoved())
    return items.filter(
      (c) =>
        isNewsletter(c, rule) &&
        !(since && c.arrivedAt && c.arrivedAt < since) &&
        !(c.messageId && moved.has(c.messageId))
    )
  }

  /** The Newsletters already in the Inboxes, per account, among the newest messages. */
  private async inInboxes(): Promise<{ accountId: string; uidValidity: string; items: NewsletterCandidate[] }[]> {
    const rule = this.rule()
    const ids = this.enabledAccounts()
    const settled = await Promise.allSettled(ids.map((id) => this.mail.inboxNewest(id, INBOX_LOOK)))
    const out: { accountId: string; uidValidity: string; items: NewsletterCandidate[] }[] = []
    let failed: unknown = null
    settled.forEach((s, i) => {
      if (s.status === 'rejected') {
        failed = s.reason
        console.error('[newsletters] could not look in the Inbox:', s.reason instanceof Error ? s.reason.message : s.reason)
        return
      }
      out.push({ accountId: ids[i]!, uidValidity: s.value.uidValidity, items: s.value.items.filter((c) => isNewsletter(c, rule)) })
    })
    if (failed && !out.length) throw failed
    return out
  }

  /** How many Newsletters are already in the Inboxes. */
  async countInbox(): Promise<number> {
    return (await this.inInboxes()).reduce((n, a) => n + a.items.length, 0)
  }

  /** Moves the Newsletters already in the Inboxes (the one-time move). Returns how many moved. */
  async moveInbox(): Promise<number> {
    if (!this.settings.newsletters) throw new Error('Newsletter magazine is off.')
    let moved = 0
    let failed: unknown = null
    for (const a of await this.inInboxes()) {
      if (!a.items.length) continue
      try {
        moved += await this.mail.moveToNewsletters(a.accountId, this.mail.inboxPath(a.accountId), a.items.map((c) => c.uid), a.uidValidity)
        this.store.addNewslettersMoved(a.items.map((c) => c.messageId).filter((id): id is string => !!id))
      } catch (err) {
        failed = err
        console.error('[newsletters] one-time move failed:', err instanceof Error ? err.message : err)
      }
    }
    if (moved) this.changed()
    if (failed && !moved) throw failed
    return moved
  }

  /**
   * Saves a sender rule (or removes it with null). With a message: "never" moves it back to the Inbox, "always"
   * moves it from the Inbox to Newsletters.
   */
  async setRule(sender: Address, rule: 'always' | 'never' | null, message?: MessageRef): Promise<void> {
    this.store.setNewsletterRules(withRule(this.settings.newsletterRules, sender, rule))
    this.changed()
    if (!message || !rule) return
    const inbox = this.mail.inboxPath(message.accountId)
    if (rule === 'never' && message.mailbox !== inbox) {
      await this.mail.moveToInbox(message.accountId, message.mailbox, [message.uid], message.uidValidity)
    } else if (rule === 'always' && message.mailbox === inbox && this.settings.newsletters) {
      await this.mail.moveToNewsletters(message.accountId, inbox, [message.uid], message.uidValidity)
    } else return
    this.changed()
  }
}
