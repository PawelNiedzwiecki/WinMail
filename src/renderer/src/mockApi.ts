// Browser-only stand-in for the Electron bridge, used for UI development.
import {
  DEFAULT_SETTINGS,
  type Account,
  type MailboxInfo,
  type MessageDetail,
  type MessageSummary,
  type ScheduledInfo,
  type SendInput,
  type Settings,
  type WinMailApi
} from '@shared/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()

export function createMockApi(): WinMailApi {
  const empty = new URLSearchParams(location.search).has('empty')
  let settings: Settings = { ...DEFAULT_SETTINGS }
  let aiKey: string | null = null
  let scheduled: (ScheduledInfo & { input: SendInput })[] = []
  const scheduledListeners = new Set<() => void>()
  const scheduledChanged = () => scheduledListeners.forEach((cb) => cb())

  let accounts: Account[] = empty
    ? []
    : [
        {
          id: 'icloud',
          provider: 'icloud',
          description: 'iCloud',
          name: 'Pawel Niedzwiecki',
          email: 'pawel@icloud.com',
          username: 'pawel@icloud.com',
          enabled: true,
          signature: 'Pawel',
          imap: { host: 'imap.mail.me.com', port: 993, security: 'tls' },
          smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' }
        },
        {
          id: 'gmail',
          provider: 'gmail',
          description: 'Google',
          name: 'Pawel Niedzwiecki',
          email: 'pawel@gmail.com',
          username: 'pawel@gmail.com',
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
      to: [{ name: 'Pawel Niedzwiecki', email: `pawel@${accountId}.com` }],
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
    msg('icloud', 'INBOX', ['Adam Baumgartner', 'adam@example.com'], 'Flat keys and move-in day',
      'Hey,\n\nAgent says keys are ready from Friday. Can you do 10:00 at Old Station House? I can bring the van.\n\nAdam', 40, { flagged: true }),
    msg('gmail', 'INBOX', ['Monzo', 'help@monzo.com'], 'Your October statement is ready',
      'Hi Pawel, your statement for October is now available in the app.', 12, {
        html: '<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#14233c">Your statement is ready</h2><p>Hi Pawel,</p><p>Your statement for October is now available in the app. <a href="https://monzo.com">Open Monzo</a></p><img src="https://example.com/tracker.png" width="1" height="1"></div>',
        unsubscribe: { url: 'https://monzo.example/unsubscribe', oneClick: true }
      }),
    msg('gmail', 'INBOX', ['GitHub', 'noreply@github.com'], '[bumbag] PR #42: Offline map caching',
      'Review requested. 14 files changed, 612 additions, 88 deletions.\n\nhttps://github.com/pawel/bumbag/pull/42', 300, {
        seen: true, hasAttachments: true,
        attachments: [{ index: 0, filename: 'diff-summary.txt', contentType: 'text/plain', size: 4096 }]
      }),
    msg('icloud', 'INBOX', ['Transport for London', 'contactless@tfl.gov.uk'], 'Your weekly journey summary',
      'You travelled 9 times this week.\n\nTotal charged: £27.40', 60 * 26, { seen: true }),
    msg('gmail', 'INBOX', ['Sam, Acme Talent', 'talent@acme.example'], 'Senior React Native Engineer role',
      'Hi Pawel,\n\nI came across your profile and think you could be a great fit. Hybrid, London Bridge.\n\nSam', 60 * 50, { seen: true, flagged: true }),
    msg('icloud', 'Receipts', ['Apple', 'no_reply@email.apple.com'], 'Your receipt from Apple',
      'Thanks for your purchase.', 60 * 24 * 9, { seen: true })
  ]
  // A reply to the first message, so conversations have something to group.
  messages.push(
    msg('icloud', 'INBOX', ['Adam Baumgartner', 'adam@example.com'], 'Re: Flat keys and move-in day',
      'Friday works. See you at 10.\n\nAdam', 20, { parents: [messages[0]!.messageId!] })
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
        name: 'Pawel Niedzwiecki',
        email: `pawel.${accounts.length}@gmail.com`,
        username: `pawel.${accounts.length}@gmail.com`,
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
      await sleep(80)
      recount()
      return structuredClone(boxes[id] ?? [])
    },
    async listMessages(id, mailbox, limit = 60) {
      await sleep(120)
      return messages
        .filter((m) => m.accountId === id && m.mailbox === mailbox)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(summary)
    },
    async search(id, mailbox, q, limit = 60) {
      await sleep(300)
      const needle = q.replace(/category:\w+\s*/, '').toLowerCase()
      return messages
        .filter((m) => m.accountId === id && m.mailbox === mailbox)
        .filter((m) => [m.from.name, m.from.email, m.subject, m.text].some((s) => s.toLowerCase().includes(needle)))
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
    async send(input) {
      await sleep(500)
      const sent = boxes[input.accountId]?.find((b) => b.specialUse === 'sent')
      if (sent) {
        messages.push(msg(input.accountId, sent.path, ['Me', 'me'], input.subject, input.text, 0, { seen: true }))
      }
      if (input.draftUid) await api.deleteDraft(input.accountId, input.draftUid)
    },
    async saveDraft(input) {
      await sleep(150)
      const drafts = boxes[input.accountId]?.find((b) => b.specialUse === 'drafts')
      if (!drafts) return null
      if (input.draftUid) await api.deleteDraft(input.accountId, input.draftUid)
      const d = msg(input.accountId, drafts.path, ['Me', 'me'], input.subject || '(No Subject)', input.text, 0, {
        seen: true,
        html: input.html ?? null
      })
      messages.push(d)
      return d.uid
    },
    async deleteDraft(id, u) {
      messages = messages.filter((m) => !(m.accountId === id && m.uid === u))
    },
    async openDraft(id, mailbox, u) {
      const m = find(id, mailbox, u)
      const drafts = boxes[id]?.find((b) => b.specialUse === 'drafts')
      return {
        accountId: id,
        to: m.to.map((a) => a.email).join(', '),
        subject: m.subject,
        text: m.text,
        html: m.html ?? undefined,
        draftUid: drafts?.path === mailbox ? u : undefined
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
        { name: 'Adam Baumgartner', email: 'adam@example.com' },
        { name: 'Sam, Acme Talent', email: 'talent@acme.example' },
        { name: 'Anna Kowalska', email: 'anna.kowalska@gmail.com' },
        { name: '', email: 'accounts@landlord.example' },
        { name: 'Transport for London', email: 'contactless@tfl.gov.uk' }
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
    }
  }
  return api
}
