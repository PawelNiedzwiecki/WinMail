import { randomUUID } from 'crypto'
import { copyFile, mkdir, readdir, rm } from 'fs/promises'
import { join } from 'path'
import type { ScheduledInfo, SendInput } from '../shared/types'
import type { MailService } from './mail'
import type { Scheduled, Store } from './store'

const info = ({ input: _input, ...rest }: Scheduled): ScheduledInfo => rest

/**
 * Mail scheduled for later. Kept in winmail.json, with attachment copies in the outbox
 * folder so moving or editing the originals doesn't change what gets sent. Sending needs
 * WinMail to be running; anything overdue goes out at the next start.
 */
export class Outbox {
  private sending = false

  constructor(
    private store: Store,
    private mail: MailService,
    private changed: () => void
  ) {}

  list(): ScheduledInfo[] {
    return this.store
      .listScheduled()
      .map(info)
      .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
  }

  async schedule(input: SendInput, sendAt: string): Promise<ScheduledInfo> {
    const id = randomUUID()
    const attachments = []
    for (const [i, a] of (input.attachments ?? []).entries()) {
      const dir = join(this.store.outboxDir, id, String(i))
      await mkdir(dir, { recursive: true })
      const path = join(dir, a.filename)
      await copyFile(a.path, path)
      attachments.push({ ...a, path })
    }
    const item: Scheduled = {
      id,
      accountId: input.accountId,
      to: input.to,
      subject: input.subject,
      sendAt,
      input: { ...input, attachments }
    }
    this.store.setScheduled([...this.store.listScheduled(), item])
    this.changed()
    return info(item)
  }

  /** Takes a message out of the queue for editing; its attachment copies stay until the next start. */
  cancel(id: string): SendInput {
    const item = this.store.listScheduled().find((s) => s.id === id)
    if (!item) throw new Error('This message has already been sent.')
    this.store.setScheduled(this.store.listScheduled().filter((s) => s.id !== id))
    this.changed()
    return item.input
  }

  async sendDue(now = Date.now()): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      for (const item of this.store.listScheduled().filter((s) => Date.parse(s.sendAt) <= now)) {
        try {
          await this.mail.send(item.input)
          this.store.setScheduled(this.store.listScheduled().filter((s) => s.id !== item.id))
          await rm(join(this.store.outboxDir, item.id), { recursive: true, force: true })
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          this.store.setScheduled(this.store.listScheduled().map((s) => (s.id === item.id ? { ...s, error } : s)))
        }
        this.changed()
      }
    } finally {
      this.sending = false
    }
  }

  /** Removes attachment copies of messages no longer queued. */
  async cleanup(): Promise<void> {
    const queued = new Set(this.store.listScheduled().map((s) => s.id))
    const dirs = await readdir(this.store.outboxDir).catch(() => [] as string[])
    await Promise.all(
      dirs.filter((d) => !queued.has(d)).map((d) => rm(join(this.store.outboxDir, d), { recursive: true, force: true }))
    )
  }
}
