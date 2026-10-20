import { randomUUID } from 'crypto'
import { copyFile, mkdir, readdir, rm, stat } from 'fs/promises'
import { basename, join } from 'path'
import type { FailedSend, OutboxEvent, OutboxKind, QueuedSend, ScheduledInfo, SendInput } from '../shared/types'
import type { MailService } from './mail'
import type { Scheduled, Store } from './store'

/** Longest undo-send delay honoured, whatever the setting says. */
const MAX_UNDO_MS = 60_000
/** Undo-send messages still waiting this long after their time (WinMail was closed) reopen as drafts. */
const STALE_UNDO_MS = 15 * 60_000
/** Attachment copies of messages no longer queued stay this long, for Undo and recovered drafts. */
const KEEP_COPIES_MS = 7 * 24 * 60 * 60_000

const info = ({ input: _input, kind: _kind, failed: _failed, ...rest }: Scheduled): ScheduledInfo => rest
const kindOf = (s: Scheduled): OutboxKind => s.kind ?? 'scheduled'

/**
 * Mail waiting to go out: scheduled sends, and sends held for the undo delay. Kept in
 * winmail.json, with attachment copies in the outbox folder so moving or editing the originals
 * doesn't change what gets sent. Sending needs WinMail to be running; anything overdue goes out
 * at the next start.
 */
export class Outbox {
  private sending = false
  /** Messages being handed to the server right now; too late to undo. */
  private inFlight = new Map<string, Promise<void>>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private store: Store,
    private mail: MailService,
    private changed: () => void,
    private event: (e: OutboxEvent) => void = () => {},
    private sent: (input: SendInput) => void = () => {}
  ) {}

  /** Scheduled mail; undo-send messages belong to Compose and are not listed. */
  list(): ScheduledInfo[] {
    return this.store
      .listScheduled()
      .filter((s) => kindOf(s) === 'scheduled')
      .map(info)
      .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
  }

  async schedule(input: SendInput, sendAt: string): Promise<ScheduledInfo> {
    return info(await this.add(input, sendAt, 'scheduled'))
  }

  /** Holds a message for the undo-send delay, then sends it. */
  async queue(input: SendInput): Promise<QueuedSend> {
    const delay = Math.min(Math.max(0, this.store.getSettings().undoSendSec * 1000), MAX_UNDO_MS)
    const item = await this.add(input, new Date(Date.now() + delay).toISOString(), 'undo')
    this.arm(item)
    return { id: item.id, sendAt: item.sendAt }
  }

  private async add(input: SendInput, sendAt: string, kind: OutboxKind): Promise<Scheduled> {
    const id = randomUUID()
    const attachments = []
    for (const [i, a] of (input.attachments ?? []).entries()) {
      const dir = join(this.store.outboxDir, id, String(i))
      await mkdir(dir, { recursive: true })
      const path = join(dir, basename(a.filename))
      await copyFile(a.path, path)
      attachments.push({ ...a, path })
    }
    const item: Scheduled = {
      id,
      accountId: input.accountId,
      to: input.to,
      subject: input.subject,
      sendAt,
      input: { ...input, attachments },
      kind
    }
    this.store.setScheduled([...this.store.listScheduled(), item])
    this.changed()
    return item
  }

  /** Takes a message out of the queue for editing; its attachment copies stay for a week. */
  cancel(id: string): SendInput {
    if (this.inFlight.has(id)) throw new Error('Too late to undo. The message is already being sent.')
    const item = this.store.listScheduled().find((s) => s.id === id)
    if (!item) throw new Error('This message has already been sent.')
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    this.store.setScheduled(this.store.listScheduled().filter((s) => s.id !== id))
    this.changed()
    return item.input
  }

  /** Undo-send messages that failed, handed back once so Compose can reopen them. */
  takeFailed(): FailedSend[] {
    const failed = this.store.listScheduled().filter((s) => s.failed)
    if (!failed.length) return []
    this.store.setScheduled(this.store.listScheduled().filter((s) => !s.failed))
    this.changed()
    return failed.map((s) => ({ id: s.id, input: s.input, error: s.error ?? 'The message could not be sent.' }))
  }

  /** At launch: re-arm undo-send timers; messages that waited too long go back to Compose instead. */
  resume(now = Date.now()): void {
    let stale = false
    const list = this.store.listScheduled().map((s) => {
      if (kindOf(s) !== 'undo' || s.failed || now - Date.parse(s.sendAt) <= STALE_UNDO_MS) return s
      stale = true
      return { ...s, failed: true, error: 'WinMail closed before this message was sent.' }
    })
    if (stale) this.store.setScheduled(list)
    for (const s of list) if (kindOf(s) === 'undo' && !s.failed) this.arm(s)
  }

  private arm(item: Scheduled): void {
    clearTimeout(this.timers.get(item.id))
    const wait = Math.max(0, Date.parse(item.sendAt) - Date.now())
    const t = setTimeout(() => {
      this.timers.delete(item.id)
      void this.sendOne(item.id)
    }, wait)
    this.timers.set(item.id, t)
  }

  /** Scheduled mail that is due. Undo-send messages have their own timers. */
  async sendDue(now = Date.now()): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      const due = this.store.listScheduled().filter((s) => kindOf(s) === 'scheduled' && Date.parse(s.sendAt) <= now)
      for (const item of due) await this.sendOne(item.id)
    } finally {
      this.sending = false
    }
  }

  /** Sends waiting undo-send messages right away and waits for every send under way, when WinMail quits. */
  async flush(): Promise<void> {
    const pending = this.store.listScheduled().filter((s) => kindOf(s) === 'undo' && !s.failed)
    for (const s of pending) {
      clearTimeout(this.timers.get(s.id))
      this.timers.delete(s.id)
    }
    for (const s of pending) await this.sendOne(s.id)
    await Promise.allSettled([...this.inFlight.values()])
  }

  private sendOne(id: string): Promise<void> {
    const item = this.store.listScheduled().find((s) => s.id === id)
    if (!item || item.failed) return Promise.resolve()
    const running = this.inFlight.get(id)
    if (running) return running
    const run = this.deliver(item).finally(() => {
      this.inFlight.delete(id)
      this.changed()
    })
    this.inFlight.set(id, run)
    return run
  }

  private async deliver(item: Scheduled): Promise<void> {
    const { id } = item
    const kind = kindOf(item)
    let delivered = false
    try {
      await this.mail.send(item.input, () => {
        // The server has the message: leave the queue now, so a quit during the Sent copy can't resend it.
        delivered = true
        this.store.setScheduled(this.store.listScheduled().filter((s) => s.id !== id))
      })
      await rm(join(this.store.outboxDir, id), { recursive: true, force: true })
      this.sent(item.input)
      this.event({ id, kind, state: 'sent' })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      if (delivered) {
        console.error('[outbox] after-send step failed:', error)
        this.event({ id, kind, state: 'sent' })
        return
      }
      // Scheduled mail is retried on the next check; an undo-send message goes back to Compose.
      this.store.setScheduled(
        this.store.listScheduled().map((s) => (s.id === id ? { ...s, error, failed: kind === 'undo' } : s))
      )
      this.event({ id, kind, state: 'failed', error })
    }
  }

  /** Removes attachment copies of messages no longer queued, once they are a week old. */
  async cleanup(now = Date.now()): Promise<void> {
    const queued = new Set(this.store.listScheduled().map((s) => s.id))
    const dirs = await readdir(this.store.outboxDir).catch(() => [] as string[])
    await Promise.all(
      dirs
        .filter((d) => !queued.has(d))
        .map(async (d) => {
          const dir = join(this.store.outboxDir, d)
          const s = await stat(dir).catch(() => null)
          if (s && now - s.mtimeMs > KEEP_COPIES_MS) await rm(dir, { recursive: true, force: true })
        })
    )
  }
}
