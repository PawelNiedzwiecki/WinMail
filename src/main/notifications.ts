import { BrowserWindow, ipcMain, nativeImage, Notification, type NativeImage } from 'electron'
import { createHash } from 'crypto'
import type {
  Account,
  Address,
  DeliveryRecord,
  MailChangedEvent,
  MessageSummary,
  OpenMessageEvent,
  Settings,
  WaitingInfo,
  WaitingOpenEvent
} from '../shared/types'
import { inQuietHours } from '../shared/quietHours'
import { makeBrief, morningNotice } from '../shared/brief'
import { replySubject } from '../shared/subject'
import type { Contacts } from './contacts'
import type { MailService } from './mail'
import type { Outbox } from './outbox'
import type { Store } from './store'

/** More new messages than this are announced as one summary notification. */
const MAX_SINGLE = 3
/** How long a notification waits for the window to draw the sender's picture. */
const AVATAR_TIMEOUT_MS = 1500
/** Notifications kept referenced, so clicks on them in Notification Center still arrive. */
const KEEP = 40
/** Longest message preview in a notification. */
const PREVIEW_CHARS = 180
/** Largest PNG accepted from the renderer, as a data URL. */
const MAX_IMAGE_CHARS = 512 * 1024

interface Deps {
  store: Store
  mail: MailService
  outbox: Outbox
  contacts: Contacts
  /** The main window, which draws avatars. */
  window: () => BrowserWindow | null
  open: (e: OpenMessageEvent) => void
  changed: (e: MailChangedEvent) => void
  /** Shows the Waiting for list in the main window, or starts a follow-up from it. */
  showWaiting: (e: WaitingOpenEvent) => void
  /** Stops waiting for a reply to one message (the nudge's Done button). */
  stopWaiting: (id: string) => void
  /** Batched delivery holds this Inbox message until the next Delivery: no notification now. */
  held: (m: MessageSummary) => boolean
  /** Shows All Inboxes with the Brief at the top (the Morning brief notification). */
  showBrief: () => void
}

const SAMPLE: Omit<MessageSummary, 'accountId' | 'key'> = {
  mailbox: 'INBOX',
  uid: 0,
  from: { name: 'Jane Appleseed', email: 'jane@example.com' },
  to: [],
  subject: 'Lunch on Friday?',
  preview: "Hi! Are you free on Friday? There's a new place by the river I've been wanting to try.",
  date: new Date().toISOString(),
  seen: false,
  flagged: false,
  hasAttachments: false
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
const firstName = (a: Address) => (a.name ? a.name.split(/\s+/)[0]! : a.email.split('@')[0]!)
const addressText = (a: Address) => (a.name ? `"${a.name.replace(/["\\]/g, '')}" <${a.email}>` : a.email)
const who = (a: Address) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email)
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const isPng = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith('data:image/png;base64,') && url.length < MAX_IMAGE_CHARS
/** Windows keeps a toast's tag to 64 characters; message keys can be longer. */
const tag = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 32)

/** "Jane", "Jane and Adam", "Jane, Adam and 3 others". */
function senders(list: MessageSummary[]): string {
  const names = [...new Set(list.map((m) => m.from.name || m.from.email))]
  if (names.length <= 2) return names.join(' and ')
  const rest = names.length - 2
  return `${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? '' : 's'}`
}

/**
 * New-mail notifications: Windows toasts with the sender's picture, an inline reply and Archive /
 * Mark as read, or one summary when many arrive together. What shows, and when, follows Settings.
 */
export class Notifier {
  private live: Notification[] = []
  private avatars = new Map<number, (url: string) => void>()
  private seq = 0

  constructor(private d: Deps) {
    const fromWindow = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => e.sender === d.window()?.webContents
    ipcMain.on('notify:avatar-done', (e, id: unknown, url: unknown) => {
      if (fromWindow(e) && typeof id === 'number') this.avatars.get(id)?.(isPng(url) ? url : '')
    })
    ipcMain.handle('notify:test', async () => {
      try {
        return { ok: true, value: await this.test() }
      } catch (err) {
        return { ok: false, error: errorText(err) }
      }
    })
    // The taskbar overlay: the window draws the count, this puts it on the button.
    ipcMain.on('app:badge', (e, count: unknown, image: unknown) => {
      const win = d.window()
      if (!win || !fromWindow(e)) return
      const n = typeof count === 'number' ? count : 0
      const icon = n > 0 && isPng(image) ? nativeImage.createEmpty() : null
      icon?.addRepresentation({ scaleFactor: 2, dataURL: image as string })
      win.setOverlayIcon(icon, icon ? `${n} unread` : '')
    })
  }

  async announce(accountId: string, list: MessageSummary[]): Promise<void> {
    const s = this.d.store.getSettings()
    if (!s.notifyNewMail || s.notifyMutedAccounts.includes(accountId) || inQuietHours(s)) return
    if (BrowserWindow.getAllWindows().some((w) => w.isFocused()) || !Notification.isSupported()) return
    const account = this.d.store.listAccounts().find((a) => a.id === accountId)
    if (!account) return
    const wanted = list.filter((m) => !this.d.held(m) && this.wanted(s, m))
    if (!wanted.length) return
    if (wanted.length > MAX_SINGLE) this.summary(account, wanted, s)
    else for (const m of wanted) await this.single(account, m, s, false)
  }

  /** A sample with the current settings; its buttons do nothing. Ignores focus and quiet hours. */
  async test(): Promise<void> {
    if (!Notification.isSupported()) throw new Error('Windows notifications are not available on this PC.')
    const account = this.d.store.listAccounts().find((a) => a.enabled) ?? this.d.store.listAccounts()[0]
    if (!account) throw new Error('Add an account first.')
    const m: MessageSummary = { ...SAMPLE, accountId: account.id, key: `test|${Date.now()}`, date: new Date().toISOString() }
    await this.single(account, m, this.d.store.getSettings(), true)
  }

  /**
   * Sent messages nobody answered in time (Waiting for). Shown only while WinMail is in the background; in the
   * window the list and an in-app toast say it. Quiet hours and muted accounts apply, as for new mail.
   */
  nudge(items: WaitingInfo[]): void {
    const s = this.d.store.getSettings()
    if (inQuietHours(s) || !Notification.isSupported()) return
    if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return
    const list = items.filter((w) => !s.notifyMutedAccounts.includes(w.accountId))
    if (!list.length) return
    const hidden = s.notifyPreview === 'none'
    if (list.length > 1) {
      const n = new Notification({
        id: tag('waiting|summary'),
        title: `No reply to ${list.length} messages`,
        body: hidden ? 'Open Waiting for to follow up.' : list.map((w) => w.subject || '(No Subject)').slice(0, 3).join('\n'),
        silent: !s.notifySound
      })
      n.on('click', () => this.d.showWaiting({}))
      this.show(n)
      return
    }
    const w = list[0]!
    const account = this.d.store.listAccounts().find((a) => a.id === w.accountId)
    const sent = new Date(w.sentAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    const n = new Notification({
      id: tag(`waiting|${w.id}`),
      title: 'No reply yet',
      body: hidden ? (account?.description ?? 'Waiting for') : `${w.subject || '(No Subject)'}\nTo ${oneLine(w.to, 80)} · sent ${sent}`,
      silent: !s.notifySound,
      ...(account ? this.group(account) : {}),
      actions: [
        { type: 'button', text: 'Follow up' },
        { type: 'button', text: 'Done' }
      ]
    })
    n.on('click', () => this.d.showWaiting({ id: w.id }))
    n.on('action', (e) => (e.actionIndex === 0 ? this.d.showWaiting({ id: w.id, followUp: true }) : this.d.stopWaiting(w.id)))
    this.show(n)
  }

  /**
   * A Delivery time showed held mail: one notification for all of it, whatever the accounts, and only while WinMail is
   * in the background. The usual settings apply: which mail notifies, muted accounts, quiet hours, preview and sound.
   * The day's first Delivery is announced as the Morning brief ("12 messages, 3 need you") while the Brief and its
   * notification are on; it gives counts only, so it reads the same whatever the preview setting.
   */
  delivered(record: DeliveryRecord): void {
    const s = this.d.store.getSettings()
    if (!s.notifyNewMail || inQuietHours(s) || !Notification.isSupported()) return
    if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return
    const list = record.items
      .map((i): MessageSummary => ({ ...i, key: `${i.accountId}|${i.mailbox}|${i.uid}`, date: i.arrivedAt, seen: false }))
      .filter((m) => !s.notifyMutedAccounts.includes(m.accountId) && this.wanted(s, m))
    if (!list.length) return
    const newest = list[0]!
    if (record.first && s.batchDelivery && s.brief && s.morningBriefNotify) {
      // Counted from the mail that may notify: muted accounts and filtered-out mail are left out of the numbers too.
      const keys = new Set(list.map((m) => m.key))
      const items = record.items.filter((i) => keys.has(`${i.accountId}|${i.mailbox}|${i.uid}`))
      const waiting = this.d.store.listWaiting().filter((w) => !s.notifyMutedAccounts.includes(w.accountId))
      const brief = makeBrief(
        { ...record, items, more: items.length === record.items.length ? record.more : 0 },
        { own: this.d.store.listAccounts().map((a) => a.email), vips: s.vips, waitingIds: waiting.map((w) => w.messageId) },
        { records: this.d.store.getDelivery().records, waiting }
      )
      const notice = morningNotice(brief)
      const n = new Notification({ id: tag(`delivery|${record.id}`), ...notice, silent: !s.notifySound })
      n.on('click', () => this.d.showBrief())
      this.show(n)
      return
    }
    const n = new Notification({
      id: tag(`delivery|${record.id}`),
      title: list.length === 1 ? 'New message' : `${list.length} new messages`,
      body:
        s.notifyPreview === 'none'
          ? 'Delivered just now'
          : list.length === 1 && s.notifyPreview === 'full'
            ? `${newest.from.name || newest.from.email}\n${newest.subject || '(No Subject)'}`
            : `From ${senders(list)}`,
      silent: !s.notifySound
    })
    n.on('click', () => this.d.open({ accountId: newest.accountId, path: newest.mailbox, uid: newest.uid }))
    this.show(n)
  }

  private wanted(s: Settings, m: MessageSummary): boolean {
    if (s.notifyFilter === 'primary') return (m.category ?? 'primary') === 'primary'
    if (s.notifyFilter === 'people') return this.d.contacts.isKnown(m.accountId, m.from.email)
    return true
  }

  /** Account header in Notification Center, when there's more than one account to tell apart. */
  private group(account: Account) {
    const several = this.d.store.listAccounts().filter((a) => a.enabled).length > 1
    return several ? { groupId: account.id, groupTitle: account.description } : {}
  }

  private async single(account: Account, m: MessageSummary, s: Settings, test: boolean): Promise<void> {
    const sender = m.from.name || m.from.email
    const subject = m.subject || '(No Subject)'
    const preview = oneLine(m.preview, PREVIEW_CHARS)
    const hidden = s.notifyPreview === 'none'
    const body = {
      full: [subject, preview].filter(Boolean).join('\n'),
      sender: `New message · ${account.description}`,
      none: account.description
    }[s.notifyPreview]
    const n = new Notification({
      id: tag(m.key),
      title: hidden ? 'New message' : sender,
      body,
      icon: hidden ? undefined : await this.avatar(m.from),
      silent: !s.notifySound,
      ...this.group(account),
      hasReply: !hidden,
      replyPlaceholder: `Reply to ${firstName(m.from)}…`,
      actions: [
        { type: 'button', text: 'Archive' },
        { type: 'button', text: 'Mark as read' }
      ]
    })
    const target = { accountId: m.accountId, path: m.mailbox, uid: m.uid }
    n.on('click', () => (test ? this.d.window()?.focus() : this.d.open(target)))
    if (!test) {
      n.on('action', (e) => void (e.actionIndex === 0 ? this.archive([m]) : this.markRead([m])))
      n.on('reply', (e) => void this.reply(m, e.reply))
    }
    this.show(n)
  }

  private summary(account: Account, list: MessageSummary[], s: Settings): void {
    const newest = list.reduce((a, b) => (b.uid > a.uid ? b : a))
    const n = new Notification({
      id: tag(`${account.id}|summary`),
      title: `${list.length} new messages`,
      body: s.notifyPreview === 'none' ? account.description : `From ${senders(list)}`,
      silent: !s.notifySound,
      ...this.group(account),
      actions: [{ type: 'button', text: 'Mark all as read' }]
    })
    n.on('click', () => this.d.open({ accountId: account.id, path: newest.mailbox, uid: newest.uid }))
    n.on('action', () => void this.markRead(list))
    this.show(n)
  }

  private show(n: Notification): void {
    n.on('failed', (_e, error) => console.error('[notify] could not show:', error))
    this.live.push(n)
    if (this.live.length > KEEP) this.live.shift()
    n.show()
  }

  /** The sender's initials in a coloured circle, drawn by the window; nothing if it doesn't answer in time. */
  private avatar(from: Address): Promise<NativeImage | undefined> {
    const win = this.d.window()
    if (!win) return Promise.resolve(undefined)
    const id = ++this.seq
    return new Promise((resolve) => {
      const done = (url: string) => {
        clearTimeout(timer)
        this.avatars.delete(id)
        resolve(url ? nativeImage.createFromDataURL(url) : undefined)
      }
      const timer = setTimeout(() => done(''), AVATAR_TIMEOUT_MS)
      this.avatars.set(id, done)
      win.webContents.send('notify:avatar', { id, name: from.name, email: from.email })
    })
  }

  private async archive(list: MessageSummary[]): Promise<void> {
    const m = list[0]!
    try {
      await this.d.mail.move(m.accountId, m.mailbox, list.map((x) => x.uid), 'archive')
    } catch (err) {
      this.problem("Couldn't archive the message", err)
    }
    this.d.changed({ accountId: m.accountId, path: m.mailbox })
  }

  private async markRead(list: MessageSummary[]): Promise<void> {
    const m = list[0]!
    try {
      await this.d.mail.setFlags(m.accountId, m.mailbox, list.map((x) => x.uid), { seen: true })
    } catch (err) {
      this.problem("Couldn't mark the message as read", err)
    }
    this.d.changed({ accountId: m.accountId, path: m.mailbox })
  }

  /**
   * Sends a plain-text reply through the outbox, so Undo send applies and a failure reopens it in
   * Compose. The reply goes to Reply-To when set, otherwise the sender, with the original quoted.
   */
  private async reply(m: MessageSummary, text: string): Promise<void> {
    const reply = text.trim()
    if (!reply) return
    try {
      const d = await this.d.mail.getMessage(m.accountId, m.mailbox, m.uid)
      const signature = this.d.store.getAccount(m.accountId).signature?.trim()
      const quoted = (d.text || d.preview).trimEnd().split(/\r?\n/).map((l) => `> ${l}`).join('\n')
      const body = [reply, signature, `On ${when(d.date)}, ${who(d.from)} wrote:\n${quoted}`].filter(Boolean).join('\n\n')
      await this.d.outbox.queue({
        accountId: m.accountId,
        to: (d.replyTo.length ? d.replyTo : [d.from]).map(addressText).join(', '),
        subject: replySubject(d.subject),
        text: body,
        inReplyTo: d.messageId ?? undefined,
        references: d.messageId ? [...d.references, d.messageId] : d.references
      })
      await this.d.mail.setFlags(m.accountId, m.mailbox, [m.uid], { seen: true })
    } catch (err) {
      this.problem("Couldn't send your reply", err)
    }
    this.d.changed({ accountId: m.accountId, path: m.mailbox })
  }

  private problem(title: string, err: unknown): void {
    console.error(`[notify] ${title}:`, errorText(err))
    this.show(new Notification({ title, body: errorText(err), silent: true }))
  }
}
