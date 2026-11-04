// Browser-only stand-in for the Electron bridge, used for UI development.
import {
  DEFAULT_SETTINGS,
  type Account,
  type FailedSend,
  type MailboxInfo,
  type MailQuery,
  type MessageDetail,
  type MessageSummary,
  type OutboxEvent,
  type ScheduledInfo,
  type SendInput,
  type Settings,
  type WinMailApi
} from '@shared/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()
/** Tomorrow at `hour`:00, local time. */
const tomorrowAt = (hour: number) => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

export function createMockApi(): WinMailApi {
  const params = new URLSearchParams(location.search)
  const empty = params.has('empty')
  /** `?nocache`: nothing is saved on this PC yet (first launch). `?offline`: the server cannot be reached. */
  const noCache = params.has('nocache')
  const offline = params.has('offline')
  const unreachable = async (ms: number) => {
    await sleep(ms)
    if (offline) throw new Error('Server not found. Check the host name.')
  }
  let settings: Settings = { ...DEFAULT_SETTINGS }
  /** `?ai`: a Claude key is already saved, so AI search and summaries show. */
  let aiKey: string | null = params.has('ai') ? 'mock-key' : null
  let scheduled: (ScheduledInfo & { input: SendInput })[] = []
  const scheduledListeners = new Set<() => void>()
  const scheduledChanged = () => scheduledListeners.forEach((cb) => cb())
  /** Messages inside the undo-send delay. A subject containing "fail" fails, for testing. */
  const undoQueue = new Map<string, { input: SendInput; timer: number }>()
  let failedSends: FailedSend[] = []
  const outboxListeners = new Set<(e: OutboxEvent) => void>()
  const outboxEvent = (e: OutboxEvent) => outboxListeners.forEach((cb) => cb(e))
  /** What each saved draft was made from, so reopening it gets every field back. */
  const draftInputs = new Map<string, SendInput>()

  let accounts: Account[] = empty
    ? []
    : [
        {
          id: 'icloud',
          provider: 'icloud',
          description: 'iCloud',
          name: 'Alex Morgan',
          email: 'alex.morgan@icloud.example',
          username: 'alex.morgan@icloud.example',
          enabled: true,
          signature: 'Alex',
          imap: { host: 'imap.mail.me.com', port: 993, security: 'tls' },
          smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' }
        },
        {
          id: 'gmail',
          provider: 'gmail',
          description: 'Google',
          name: 'Alex Morgan',
          email: 'alex.morgan@gmail.example',
          username: 'alex.morgan@gmail.example',
          enabled: true,
          imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
          smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' }
        }
      ]

  const boxes: Record<string, MailboxInfo[]> = {
    icloud: [
      { path: 'INBOX', name: 'Inbox', specialUse: 'inbox', unseen: 0, depth: 0 },
      { path: 'Drafts', name: 'Drafts', specialUse: 'drafts', unseen: 0, depth: 0 },
      { path: 'Sent Messages', name: 'Sent', specialUse: 'sent', unseen: 0, depth: 0 },
      { path: 'Junk', name: 'Junk', specialUse: 'junk', unseen: 0, depth: 0 },
      { path: 'Deleted Messages', name: 'Bin', specialUse: 'trash', unseen: 0, depth: 0 },
      { path: 'Archive', name: 'Archive', specialUse: 'archive', unseen: 0, depth: 0 },
      { path: 'Receipts', name: 'Receipts', specialUse: null, unseen: 0, depth: 0 },
      { path: 'Receipts/2026', name: '2026', specialUse: null, unseen: 0, depth: 1 }
    ],
    gmail: [
      { path: 'INBOX', name: 'Inbox', specialUse: 'inbox', unseen: 0, depth: 0 },
      { path: '[Gmail]/Drafts', name: 'Drafts', specialUse: 'drafts', unseen: 0, depth: 0 },
      { path: '[Gmail]/Sent Mail', name: 'Sent', specialUse: 'sent', unseen: 0, depth: 0 },
      { path: '[Gmail]/Spam', name: 'Junk', specialUse: 'junk', unseen: 0, depth: 0 },
      { path: '[Gmail]/Bin', name: 'Bin', specialUse: 'trash', unseen: 0, depth: 0 },
      { path: '[Gmail]/All Mail', name: 'All Mail', specialUse: 'all', unseen: 0, depth: 0 },
      { path: 'Work', name: 'Work', specialUse: null, unseen: 0, depth: 0 }
    ]
  }

  let uid = 100
  const msg = (
    accountId: string,
    mailbox: string,
    from: [string, string],
    subject: string,
    body: string,
    mins: number,
    extra: Partial<MessageDetail> = {}
  ): MessageDetail => {
    const u = ++uid
    return {
      key: `${accountId}|${mailbox}|${u}`,
      accountId,
      mailbox,
      uid: u,
      from: { name: from[0], email: from[1] },
      to: [{ name: 'Alex Morgan', email: `alex.morgan@${accountId}.example` }],
      cc: [],
      bcc: [],
      replyTo: [],
      subject,
      preview: body.replace(/\s+/g, ' ').slice(0, 200),
      date: ago(mins),
      seen: false,
      flagged: false,
      hasAttachments: false,
      html: null,
      text: body,
      messageId: `<${u}@mock>`,
      parents: [],
      references: [],
      attachments: [],
      unsubscribe: null,
      ...extra
    }
  }

  let messages: MessageDetail[] = [
    msg('icloud', 'INBOX', ['Jamie Rivera', 'jamie.rivera@example.com'], 'Saturday hike',
      'Hey,\n\nThe trail opens at 9. Shall we meet at the car park at 8:30? I can drive.\n\nJamie', 40, { flagged: true }),
    // A reply to the message above, so the list shows a conversation.
    msg('icloud', 'INBOX', ['Jamie Rivera', 'jamie.rivera@example.com'], 'Re: Saturday hike',
      'Actually 9:00 works better, the car park opens late. Still fine for you?\n\nJamie', 8, { parents: [`<${uid}@mock>`] }),
    msg('gmail', 'INBOX', ['Northwind Bank', 'statements@northwind.example'], 'Your monthly statement is ready',
      'Hi Alex, your statement for this month is now available in the app.', 12, {
        html: '<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#14233c">Your statement is ready</h2><p>Hi Alex,</p><p>Your statement for this month is now available in the app. <a href="https://northwind.example">Open Northwind</a></p><img src="https://example.com/tracker.png" width="1" height="1"></div>',
        unsubscribe: { url: 'https://northwind.example/unsubscribe', oneClick: true }
      }),
    msg('gmail', 'INBOX', ['GitHub', 'noreply@github.com'], '[sample-app] PR #42: Offline caching',
      'Review requested. 14 files changed, 612 additions, 88 deletions.\n\nhttps://github.com/example/sample-app/pull/42', 300, {
        seen: true, hasAttachments: true,
        attachments: [{ index: 0, filename: 'diff-summary.txt', contentType: 'text/plain', size: 4096 }]
      }),
    msg('icloud', 'INBOX', ['City Transit', 'journeys@citytransit.example'], 'Your weekly journey summary',
      'You travelled 9 times this week.\n\nTotal charged: £27.40', 60 * 26, { seen: true }),
    msg('gmail', 'INBOX', ['Taylor, Contoso Careers', 'careers@contoso.example'], 'Frontend Engineer role',
      'Hi Alex,\n\nI came across your profile and think you could be a great fit. Hybrid, two days in the office.\n\nTaylor', 60 * 50, { seen: true, flagged: true }),
    msg('gmail', 'INBOX', ['Jamie Rivera', 'jamie.rivera@example.com'], 'Invitation: Design review',
      'Jamie Rivera has invited you to Design review.\n\nWalk through the new compose, then questions.', 25, {
        invite: {
          method: 'REQUEST',
          uid: 'design-review@mock',
          summary: 'Design review',
          start: tomorrowAt(14),
          end: tomorrowAt(15),
          allDay: false,
          recurring: false,
          location: 'Room 4 / https://meet.example.com/design-review',
          organizer: { name: 'Jamie Rivera', email: 'jamie.rivera@example.com' },
          attendees: [
            { name: 'Alex Morgan', email: 'alex.morgan@gmail.example', status: 'NEEDS-ACTION' },
            { name: 'Sam Patel', email: 'sam.patel@example.org', status: 'ACCEPTED' }
          ],
          answer: null,
          isOrganizer: false
        }
      }),
    msg('icloud', 'Receipts', ['Fabrikam Store', 'orders@fabrikam.example'], 'Your receipt from Fabrikam',
      'Thanks for your purchase.', 60 * 24 * 9, { seen: true })
  ]
  // A reply to the first message, so conversations have something to group.
  messages.push(
    msg('icloud', 'INBOX', ['Jamie Rivera', 'jamie.rivera@example.com'], 'Re: Saturday hike',
      'Saturday works. See you at 8:30.\n\nJamie', 20, { parents: [messages[0]!.messageId!] })
  )

  const summary = ({
    html: _h,
    text: _t,
    cc: _c,
    bcc: _b,
    replyTo: _rt,
    attachments: _a,
    references: _r,
    unsubscribe: _u,
    invite: _i,
    ...s
  }: MessageDetail) => s as MessageSummary

  const recount = () => {
    for (const [id, list] of Object.entries(boxes)) {
      for (const b of list) {
        b.unseen = messages.filter((m) => m.accountId === id && m.mailbox === b.path && !m.seen).length
      }
    }
  }

  const find = (accountId: string, mailbox: string, u: number) => {
    const m = messages.find((x) => x.accountId === accountId && x.mailbox === mailbox && x.uid === u)
    if (!m) throw new Error('Message not found.')
    return m
  }

  const api: WinMailApi = {
    platform: 'browser',
    mica: false,
    async listAccounts() {
      return structuredClone(accounts)
    },
    async testAccount(input) {
      await sleep(900)
      if (input.password === 'wrong') {
        return { ok: false, stage: 'imap', error: 'Username or password is incorrect.' }
      }
      return { ok: true }
    },
    async addAccount(input) {
      const { password: _pw, ...rest } = input
      const a: Account = { ...rest, id: crypto.randomUUID() }
      accounts.push(a)
      boxes[a.id] = [{ path: 'INBOX', name: 'Inbox', specialUse: 'inbox', unseen: 0, depth: 0 }]
      return a
    },
    async updateAccount({ account }) {
      accounts = accounts.map((a) => (a.id === account.id ? account : a))
      return account
    },
    async removeAccount(id) {
      accounts = accounts.filter((a) => a.id !== id)
      messages = messages.filter((m) => m.accountId !== id)
    },
    async addGoogleAccount() {
      await sleep(1500)
      const a: Account = {
        id: crypto.randomUUID(),
        provider: 'gmail',
        auth: 'oauth',
        description: 'Google (mock)',
        name: 'Alex Morgan',
        email: `alex.${accounts.length}@gmail.example`,
        username: `alex.${accounts.length}@gmail.example`,
        enabled: true,
        imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
        smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' }
      }
      accounts.push(a)
      boxes[a.id] = [{ path: 'INBOX', name: 'Inbox', specialUse: 'inbox', unseen: 0, depth: 0 }]
      return a
    },
    async reauthGoogleAccount(id) {
      await sleep(1500)
      accounts = accounts.map((a) => (a.id === id ? { ...a, auth: 'oauth' } : a))
      return accounts.find((a) => a.id === id)!
    },
    async cancelGoogleSignIn() {},
    async getSettings() {
      return settings
    },
    async setSettings(s) {
      settings = s
      return s
    },
    async listMailboxes(id) {
      await unreachable(80)
      recount()
      return structuredClone(boxes[id] ?? [])
    },
    async cachedMailboxes(id) {
      if (noCache) return null
      recount()
      return structuredClone(boxes[id] ?? [])
    },
    async cachedList(id, mailbox, limit, view) {
      if (noCache) return null
      const all = messages
        .filter((m) => m.accountId === id && m.mailbox === mailbox)
        .sort((a, b) => b.date.localeCompare(a.date))
      const list = (view ? all.filter((m) => m.category === view.replace('category:', '')) : all).slice(0, limit)
      return { messages: list.map((m) => ({ ...summary(m), uidValidity: '1' })), more: all.length > limit }
    },
    async cacheSize() {
      return 34_000_000
    },
    async clearCache() {},
    async listMessages(id, mailbox, limit = 60) {
      await unreachable(120)
      return messages
        .filter((m) => m.accountId === id && m.mailbox === mailbox)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(summary)
    },
    async search(id, mailbox, q, limit = 60) {
      await unreachable(300)
      const needle = q.replace(/category:\w+\s*/, '').toLowerCase()
      return messages
        .filter((m) => m.accountId === id && m.mailbox === mailbox)
        .filter((m) => [m.from.name, m.from.email, m.subject, m.text].some((s) => s.toLowerCase().includes(needle)))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(summary)
    },
    async searchQuery(id, mailbox, q, limit = 60) {
      await unreachable(300)
      const places = q.folder
        ? (boxes[id] ?? []).filter((b) => (q.folder === 'all' ? b.specialUse !== 'trash' && b.specialUse !== 'junk' : b.specialUse === q.folder)).map((b) => b.path)
        : [mailbox]
      return messages
        .filter((m) => m.accountId === id && places.includes(m.mailbox) && matchesQuery(m, q))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(summary)
    },
    async listThread() {
      return []
    },
    async getMessage(id, mailbox, u) {
      await sleep(60)
      const m = find(id, mailbox, u)
      m.seen = true
      return structuredClone(m)
    },
    async getSource(id, mailbox, u) {
      const m = find(id, mailbox, u)
      return `From: ${m.from.name} <${m.from.email}>\r\nSubject: ${m.subject}\r\nDate: ${m.date}\r\nMessage-ID: ${m.messageId}\r\n\r\n${m.text}`
    },
    async setFlags(id, mailbox, uids, f) {
      for (const u of uids) {
        const m = find(id, mailbox, u)
        if (f.seen !== undefined) m.seen = f.seen
        if (f.flagged !== undefined) m.flagged = f.flagged
      }
    },
    async markAllRead(id, mailbox) {
      messages.filter((m) => m.accountId === id && m.mailbox === mailbox).forEach((m) => (m.seen = true))
    },
    async move(id, mailbox, uids, target) {
      const dest =
        boxes[id]?.find((b) => b.specialUse === target) ??
        (target === 'archive' ? boxes[id]?.find((b) => b.specialUse === 'all') : undefined)
      if (!dest) throw new Error(`This account has no ${target} mailbox.`)
      return api.moveTo(id, mailbox, uids, dest.path)
    },
    async moveTo(id, mailbox, uids, dest) {
      const moved = uids.map((u) => {
        const m = find(id, mailbox, u)
        m.mailbox = dest
        m.uid = ++uid
        m.key = `${id}|${dest}|${m.uid}`
        return m.uid
      })
      return { path: dest, uids: moved }
    },
    async snooze(id, mailbox, uids, until) {
      let box = boxes[id]?.find((b) => b.specialUse === 'snoozed')
      if (!box) {
        box = { path: 'WinMail Snoozed', name: 'Snoozed', specialUse: 'snoozed', unseen: 0, depth: 0 }
        boxes[id]?.splice(1, 0, box)
      }
      await api.moveTo(id, mailbox, uids, box.path)
      console.info('Snoozed until', until)
    },
    async saveAttachment() {
      return null
    },
    async answerInvite(id, mailbox, uid, answer) {
      await sleep(600)
      const m = messages.find((x) => x.accountId === id && x.mailbox === mailbox && x.uid === uid)
      if (!m?.invite) throw new Error('This message has no calendar invitation.')
      m.invite = {
        ...m.invite,
        answer,
        attendees: m.invite.attendees.map((a) => (a.email.startsWith('alex.') ? { ...a, status: answer } : a))
      }
      return m.invite
    },
    async openInvite() {
      console.info('The invitation opens in the calendar app here in WinMail.')
    },
    async saveText(name) {
      return `Downloads\\${name}`
    },
    async print() {
      window.print()
    },
    async unsubscribe() {
      await sleep(400)
    },
    async pickAttachments() {
      return [{ path: 'C:\\mock\\report.pdf', filename: 'report.pdf', size: 248_000 }]
    },
    pathForFile(file) {
      return file.name
    },
    async addDroppedFiles(files) {
      return files.map((f) => ({ path: `C:\\mock\\${f.name}`, filename: f.name, size: f.size }))
    },
    async saveClipboardImage(file) {
      const filename = file.name || 'image.png'
      return { path: `C:\\mock\\paste\\${filename}`, filename, size: file.size }
    },
    async send(input) {
      await sleep(500)
      const sent = boxes[input.accountId]?.find((b) => b.specialUse === 'sent')
      if (sent) {
        messages.push(
          msg(input.accountId, sent.path, ['Me', 'me'], input.subject, input.text, 0, { seen: true, html: input.html ?? null })
        )
      }
      if (input.draftUid) await api.deleteDraft(input.accountId, input.draftUid)
    },
    async queueSend(input) {
      const id = crypto.randomUUID()
      const delay = settings.undoSendSec * 1000
      const timer = window.setTimeout(async () => {
        undoQueue.delete(id)
        if (/fail/i.test(input.subject)) {
          const error = 'Mock failure: the server refused the message.'
          failedSends.push({ id, input, error })
          outboxEvent({ id, kind: 'undo', state: 'failed', error })
          return
        }
        await api.send(input)
        outboxEvent({ id, kind: 'undo', state: 'sent' })
      }, delay)
      undoQueue.set(id, { input, timer })
      return { id, sendAt: new Date(Date.now() + delay).toISOString() }
    },
    async takeFailedSends() {
      const list = failedSends
      failedSends = []
      return list
    },
    onOutbox(cb) {
      outboxListeners.add(cb)
      return () => outboxListeners.delete(cb)
    },
    async saveDraft(input) {
      await sleep(150)
      const drafts = boxes[input.accountId]?.find((b) => b.specialUse === 'drafts')
      if (!drafts) throw new Error("Drafts can't be saved: this account has no Drafts folder.")
      if (input.draftUid) await api.deleteDraft(input.accountId, input.draftUid)
      const d = msg(input.accountId, drafts.path, ['Me', 'me'], input.subject || '(No Subject)', input.text, 0, {
        seen: true,
        html: input.html ?? null
      })
      messages.push(d)
      draftInputs.set(`${input.accountId}|${d.uid}`, { ...input, draftUid: undefined })
      return d.uid
    },
    async deleteDraft(id, u) {
      messages = messages.filter((m) => !(m.accountId === id && m.uid === u))
      draftInputs.delete(`${id}|${u}`)
    },
    async openDraft(id, mailbox, u) {
      const m = find(id, mailbox, u)
      const drafts = boxes[id]?.find((b) => b.specialUse === 'drafts')
      const draftUid = drafts?.path === mailbox ? u : undefined
      const saved = draftInputs.get(`${id}|${u}`)
      if (saved) return { ...saved, draftUid }
      return {
        accountId: id,
        to: m.to.map((a) => a.email).join(', '),
        cc: m.cc.map((a) => a.email).join(', '),
        subject: m.subject,
        text: m.text,
        html: m.html ?? undefined,
        attachments: m.attachments.map((a) => ({ path: `C:\\mock\\${a.filename}`, filename: a.filename, size: a.size })),
        draftUid
      }
    },
    async scheduleSend(input, sendAt) {
      const item = { id: crypto.randomUUID(), accountId: input.accountId, to: input.to, subject: input.subject, sendAt, input }
      scheduled.push(item)
      scheduledChanged()
      const { input: _i, ...info } = item
      return info
    },
    async listScheduled() {
      return scheduled.map(({ input: _i, ...info }) => info)
    },
    async cancelScheduled(id) {
      const queued = undoQueue.get(id)
      if (queued) {
        window.clearTimeout(queued.timer)
        undoQueue.delete(id)
        return queued.input
      }
      const item = scheduled.find((s) => s.id === id)
      if (!item) throw new Error('This message has already been sent.')
      scheduled = scheduled.filter((s) => s.id !== id)
      scheduledChanged()
      return item.input
    },
    onScheduledChanged(cb) {
      scheduledListeners.add(cb)
      return () => scheduledListeners.delete(cb)
    },
    async aiAvailable() {
      return !!aiKey
    },
    async setAiKey(key) {
      aiKey = key
    },
    async ai(input) {
      await sleep(900)
      if (!aiKey) throw new Error('Add a Claude API key in Settings > General first.')
      return input.task === 'summarise'
        ? `• ${input.subject}\n• Mock summary of a message from ${input.from}.`
        : 'Thanks, that works for me. See you then.'
    },
    async aiSearch(question) {
      await sleep(700)
      if (!aiKey) throw new Error('Add a Claude API key in Settings > General first.')
      return mockParse(question)
    },
    async contactsStatus(id) {
      const google = accounts.find((a) => a.id === id)?.provider === 'gmail'
      return { source: google ? 'Google Contacts' : 'iCloud Contacts', saved: 3, fromMail: 2, error: null, loading: false }
    },
    onContactsChanged() {
      return () => {}
    },
    async listContacts() {
      await sleep(100)
      return [
        { name: 'Jamie Rivera', email: 'jamie.rivera@example.com' },
        { name: 'Taylor, Contoso Careers', email: 'careers@contoso.example' },
        { name: 'Sam Patel', email: 'sam.patel@example.org' },
        { name: '', email: 'accounts@lettings.example' },
        { name: 'City Transit', email: 'journeys@citytransit.example' }
      ]
    },
    onMailChanged() {
      return () => {}
    },
    onMailProgress() {
      return () => {}
    },
    onOpenMessage() {
      return () => {}
    },
    async testNotification() {
      console.info('A sample notification shows here in WinMail.')
    },
    onNotificationAvatar() {
      return () => {}
    },
    setTaskbarBadge() {},
    showEmojiPanel() {
      console.info('Emoji panel opens here in WinMail.')
    },
    onCloseRequested() {
      return () => {}
    },
    closeReady() {},
    async openComposeWindow() {
      throw new Error('Pop-out windows need the desktop app.')
    },
    async popoutPayload() {
      return null
    },
    async listPopouts() {
      return []
    },
    popoutSend() {},
    onPopoutMessage() {
      return () => {}
    },
    async openMessageWindow() {
      throw new Error('Message windows need the desktop app.')
    },
    async messageWindowPayload() {
      return null
    }
  }
  return api
}

const lower = (s: string) => s.toLowerCase()
const has = (hay: string[], needle: string) => hay.some((h) => lower(h).includes(lower(needle)))

/** Mock mode's stand-in for IMAP SEARCH. */
function matchesQuery(m: MessageDetail, q: MailQuery): boolean {
  const day = localDay(new Date(m.date))
  if (q.from.length && !q.from.some((f) => has([m.from.name, m.from.email], f))) return false
  if (q.to.length && !q.to.some((t) => has(m.to.flatMap((a) => [a.name, a.email]), t))) return false
  if (!q.subject.every((w) => has([m.subject], w))) return false
  if (!q.words.every((w) => has([m.subject, m.text ?? '', m.from.name, m.from.email], w))) return false
  if (q.after && day < q.after) return false
  if (q.before && day > q.before) return false
  if (q.read && m.seen !== (q.read === 'read')) return false
  if (q.flagged && !m.flagged) return false
  if (q.hasAttachment && !m.hasAttachments) return false
  if (q.category && (m.category ?? 'primary') !== q.category) return false
  return true
}

function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Mock mode's stand-in for Claude: picks out a few phrases so the chips have something to show. */
function mockParse(question: string): MailQuery {
  const t = lower(question)
  const now = new Date()
  const dayOf = (y: number, m: number, d: number) => localDay(new Date(y, m, d))
  const today = localDay(now)
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  let after: string | null = null
  let before: string | null = null
  if (t.includes('last month')) {
    after = dayOf(now.getFullYear(), now.getMonth() - 1, 1)
    before = dayOf(now.getFullYear(), now.getMonth(), 0)
  } else if (t.includes('this month')) {
    after = dayOf(now.getFullYear(), now.getMonth(), 1)
    before = today
  } else if (t.includes('last week')) {
    after = dayOf(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)
    before = dayOf(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1)
  } else if (t.includes('this week')) {
    after = localDay(monday)
    before = today
  } else if (t.includes('today')) {
    after = before = today
  }
  const from = /\bfrom ([\w.@-]+)/.exec(t)?.[1]
  const about = /\babout (?:the )?([\w-]+)/.exec(t)?.[1]
  const topic = ['invoice', 'receipt', 'statement', 'hike', 'review'].filter((w) => t.includes(w))
  return {
    from: from ? [from[0]!.toUpperCase() + from.slice(1)] : [],
    to: [],
    subject: [],
    words: [...new Set([...(about ? [about] : []), ...topic])],
    after,
    before,
    read: t.includes('unread') ? 'unread' : null,
    flagged: /flagged|starred|important/.test(t),
    hasAttachment: /attach/.test(t),
    category: /newsletter|promotion/.test(t) ? 'promotions' : null,
    folder: /\b(i sent|sent)\b/.test(t) ? 'sent' : /anywhere|everywhere|all mail/.test(t) ? 'all' : null
  }
}
