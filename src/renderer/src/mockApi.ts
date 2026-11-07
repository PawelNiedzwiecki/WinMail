// Browser-only stand-in for the Electron bridge, used for UI development.
import { assertOptedIn } from '@shared/contentFeatures'
import { nudgeTime } from '@shared/waiting'
import { makeBrief } from '@shared/brief'
import { advance, formatTime, isHeld, nextDeliveryAt, sameDay, vipAddresses, type HoldRule } from '@shared/delivery'
import {
  DEFAULT_SETTINGS,
  type Account,
  type DeliveryKind,
  type DeliveryRecord,
  type DeliveryState,
  type FailedSend,
  type LabelColour,
  type LabelInfo,
  type MailboxInfo,
  type MailQuery,
  type MessageDetail,
  type MessageSummary,
  type OutboxEvent,
  type ScheduledInfo,
  type SendInput,
  type Settings,
  type WaitingInfo,
  type WaitingOpenEvent,
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
  /** `?nolabels`: the iCloud server refuses keywords, so labels can't be stored there. */
  const noLabels = params.has('nolabels')
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
      { path: 'Receipts', name: 'Receipts', specialUse: null, unseen: 0, depth: 0 },
      { path: 'Travel', name: 'Travel', specialUse: null, unseen: 0, depth: 0 },
      { path: 'Travel/Flights', name: 'Flights', specialUse: null, unseen: 0, depth: 1 },
      { path: 'Travel/Hotels', name: 'Hotels', specialUse: null, unseen: 0, depth: 1 },
      { path: 'Work', name: 'Work', specialUse: null, unseen: 0, depth: 0 },
      { path: 'Work/Invoices', name: 'Invoices', specialUse: null, unseen: 0, depth: 1 }
    ]
  }
  /** Names and colours kept "on this PC"; keyword accounts also remember keywords created here. */
  const labelStyles: Record<string, Record<string, { name?: string; colour?: LabelColour; deleted?: boolean }>> = {
    icloud: { $label3: { colour: 'green' } },
    gmail: { Work: { colour: 'blue' }, Receipts: { colour: 'teal' }, Travel: { colour: 'pink' } }
  }
  const isGmail = (id: string) => accounts.find((a) => a.id === id)?.provider === 'gmail'
  /** A Gmail folder that is a label rather than a system folder. */
  const isLabelBox = (id: string, path: string) =>
    isGmail(id) && (boxes[id] ?? []).some((b) => b.path === path && !b.specialUse)

  const b64url = (v: string) => btoa(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

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
      'Hey,\n\nThe trail opens at 9. Shall we meet at the car park at 8:30? I can drive.\n\nJamie', 40, { flagged: true, labels: ['$label3'] }),
    // A reply to the message above, so the list shows a conversation.
    msg('icloud', 'INBOX', ['Jamie Rivera', 'jamie.rivera@example.com'], 'Re: Saturday hike',
      'Actually 9:00 works better, the car park opens late. Still fine for you?\n\nJamie', 8, { parents: [`<${uid}@mock>`] }),
    msg('gmail', 'INBOX', ['Northwind Bank', 'statements@northwind.example'], 'Your monthly statement is ready',
      'Hi Alex, your statement for this month is now available in the app.', 12, {
        html: '<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#14233c">Your statement is ready</h2><p>Hi Alex,</p><p>Your statement for this month is now available in the app. <a href="https://northwind.example">Open Northwind</a></p><img src="https://example.com/tracker.png" width="1" height="1"></div>',
        unsubscribe: { url: 'https://northwind.example/unsubscribe', oneClick: true },
        labels: ['Receipts']
      }),
    // Pixels and tracked links for the Tracker shield: two pixels (Mailchimp's and a hidden one), a real remote image,
    // and links that are cleaned, unwrapped (Google, Substack) and marked (a Mailchimp click link, used twice).
    msg('gmail', 'INBOX', ['Contoso Weekly', 'news@contoso.example'], 'Contoso Weekly: offline mode and a London meetup',
      'Hi Alex, here is what happened this week at Contoso.', 5, {
        html: `<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#14233c">Contoso Weekly</h2>
<div style="width:520px;max-width:100%;height:110px;background:#dbe4f3;margin:0 0 12px"><img src="https://images.example.com/contoso/hero.jpg" width="520" height="110" alt="Offline mode" style="max-width:100%"></div>
<p>Hi Alex, here is what happened this week.</p>
<p><a href="https://contoso.example/blog/offline-mode?utm_source=newsletter&utm_medium=email&utm_campaign=weekly&mc_eid=ab12cd34&ref=weekly">How offline mode works</a></p>
<p><a href="https://www.google.com/url?q=https%3A%2F%2Fcontoso.example%2Fevents%2Flondon-meetup%3Futm_source%3Dnews&sa=D&usg=AOvVaw0x">Join the London meetup</a></p>
<p><a href="https://substack.com/redirect/2/${b64url(JSON.stringify({ e: 'https://contoso.example/notes/editor', p: 1 }))}.sig">A note from the editor</a></p>
<p><a href="https://contoso.us12.list-manage.com/track/click?u=1234567890abcdef&id=0a1b2c3d4e&e=5f6a7b8c9d">See the full roadmap</a> &middot; <a href="https://contoso.us12.list-manage.com/track/click?u=1234567890abcdef&id=0a1b2c3d4e&e=5f6a7b8c9d">roadmap again</a></p>
<p style="color:#666;font-size:12px">You are getting this because you signed up at contoso.example.</p>
<img src="https://contoso.us12.list-manage.com/track/open.php?u=1234567890abcdef&id=0a1b2c3d4e&e=5f6a7b8c9d" width="1" height="1" alt="">
<img src="https://stats.contoso.example/px.gif?m=5521" alt="" style="display:none"></div>`,
        unsubscribe: { url: 'https://contoso.us12.list-manage.com/unsubscribe?u=1234567890abcdef&id=0a1b2c3d4e', oneClick: false }
      }),
    msg('icloud', 'INBOX', ['Sam Patel', 'sam.patel@example.org'], 'Worth a read: offline-first mail',
      'Hey Alex,\n\nThis is the post I mentioned: https://blog.example.org/offline-first-mail?utm_source=twitter&utm_medium=social&fbclid=IwAR0abc123 and the talk is here https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2Ftalks%2F42%3Futm_campaign%3Dshare&h=AT0x\n\nSam', 18),
    msg('gmail', 'INBOX', ['GitHub', 'noreply@github.com'], '[sample-app] PR #42: Offline caching',
      'Review requested. 14 files changed, 612 additions, 88 deletions.\n\nhttps://github.com/example/sample-app/pull/42', 300, {
        seen: true, hasAttachments: true, labels: ['Work'],
        attachments: [{ index: 0, filename: 'diff-summary.txt', contentType: 'text/plain', size: 4096 }]
      }),
    msg('icloud', 'INBOX', ['City Transit', 'journeys@citytransit.example'], 'Your weekly journey summary',
      'You travelled 9 times this week.\n\nTotal charged: £27.40', 60 * 26, { seen: true, labels: ['$label4', '$label2'] }),
    msg('gmail', 'INBOX', ['Taylor, Contoso Careers', 'careers@contoso.example'], 'Frontend Engineer role',
      'Hi Alex,\n\nI came across your profile and think you could be a great fit. Hybrid, two days in the office.\n\nTaylor', 60 * 50, { seen: true, flagged: true, labels: ['Work', 'Travel'] }),
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
      'Thanks for your purchase.', 60 * 24 * 9, { seen: true, labels: ['$label1'] })
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

  /** The folder list with held mail left out of the Inbox count, as MailService does it. */
  const withoutHeld = (id: string): MailboxInfo[] => {
    recount()
    const held = heldIn(id).filter((m) => !m.seen).length
    return structuredClone(boxes[id] ?? []).map((b) =>
      b.specialUse === 'inbox' && settings.batchDelivery ? { ...b, unseen: b.unseen - held, held } : b
    )
  }

  const recount = () => {
    for (const [id, list] of Object.entries(boxes)) {
      for (const b of list) {
        b.unseen = messages.filter((m) => m.accountId === id && m.mailbox === b.path && !m.seen).length
      }
    }
  }

  // Waiting for: two sent messages expecting a reply, the first already nudged. `?nowaiting` starts with none.
  const sentCopy = (accountId: string, to: [string, string], subject: string, body: string, mins: number) => {
    const a = accounts.find((x) => x.id === accountId)
    const path = boxes[accountId]?.find((b) => b.specialUse === 'sent')?.path ?? 'Sent'
    return msg(accountId, path, [a?.name ?? 'Me', a?.email ?? 'me'], subject, body, mins, {
      seen: true,
      to: [{ name: to[0], email: to[1] }]
    })
  }
  const inMins = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString()
  let waiting: WaitingInfo[] = []
  const waitingListeners = new Set<() => void>()
  const waitingChanged = () => waitingListeners.forEach((cb) => cb())
  const waitingOpenListeners = new Set<(e: WaitingOpenEvent) => void>()
  if (!empty && !params.has('nowaiting')) {
    const quote = sentCopy('icloud', ['Priya Shah', 'priya.shah@example.com'], 'Quote for the kitchen',
      'Hi Priya,\n\nCould you send the updated quote for the kitchen by Friday?\n\nAlex', 4 * 24 * 60)
    const venue = sentCopy('gmail', ['Sam Okafor', 'sam.okafor@example.com'], 'Venue for the offsite',
      'Hi Sam,\n\nDoes the riverside venue work for the 20th? Let me know.\n\nAlex', 26 * 60)
    messages.push(quote, venue)
    waiting = [
      { id: 'w-quote', accountId: 'icloud', messageId: quote.messageId!, to: 'Priya Shah <priya.shah@example.com>',
        subject: quote.subject, sentAt: quote.date, days: 3, dueAt: ago(24 * 60), nudgedAt: ago(24 * 60) },
      { id: 'w-venue', accountId: 'gmail', messageId: venue.messageId!, to: 'Sam Okafor <sam.okafor@example.com>',
        subject: venue.subject, sentAt: venue.date, days: 3, dueAt: nudgeTime(new Date(venue.date), 3).toISOString() }
    ]
    // `?nudge`: the first nudge arrives a few seconds after launch, as it would from the main process.
    if (params.has('nudge')) {
      waiting[0] = { ...waiting[0]!, nudgedAt: undefined, dueAt: inMins(0.1) }
      window.setTimeout(() => {
        waiting = waiting.map((w) => (w.id === 'w-quote' ? { ...w, nudgedAt: new Date().toISOString() } : w))
        waitingChanged()
      }, 4000)
    }
  }
  /** Like WaitingFor.sent in main: a reply in the conversation ends the earlier wait; `waitDays` starts a new one. */
  const waitingSent = (input: SendInput, messageId: string) => {
    const earlier = new Set([...(input.references ?? []), ...(input.inReplyTo ? [input.inReplyTo] : [])])
    waiting = waiting.filter((w) => !(w.accountId === input.accountId && earlier.has(w.messageId)))
    if (input.waitDays && input.waitDays > 0) {
      const now = new Date()
      waiting.push({ id: crypto.randomUUID(), accountId: input.accountId, messageId, to: input.to, subject: input.subject,
        sentAt: now.toISOString(), days: input.waitDays, dueAt: nudgeTime(now, input.waitDays).toISOString() })
    }
    waitingChanged()
  }

  // Batched delivery, as Deliveries does it in main. `?batch` starts with it on and three messages held (the last
  // Delivery a few minutes ago, the next in three hours); `?delivery` also makes a Delivery four seconds after launch.
  let deliveredUntil: string | null = null
  let deliveryRecords: DeliveryRecord[] = []
  const deliveryListeners = new Set<() => void>()
  const deliveryChanged = () => deliveryListeners.forEach((cb) => cb())
  const until = () =>
    settings.batchDelivery ? advance(deliveredUntil ?? new Date().toISOString(), new Date(), settings.deliveryTimes).deliveredUntil : null
  const holdRule = (): HoldRule | null => {
    const u = until()
    return u ? { deliveredUntil: u, vips: vipAddresses(settings.vips), own: accounts.map((a) => a.email.toLowerCase()) } : null
  }
  const inboxOf = (id: string) => boxes[id]?.find((b) => b.specialUse === 'inbox')?.path
  const heldIn = (id: string, rule = holdRule()) =>
    rule ? messages.filter((m) => m.accountId === id && m.mailbox === inboxOf(id) && isHeld(m, rule)) : []
  /** A delivered message as MailService lists it for the record, with what the Brief reads. */
  const toItem = (m: MessageDetail) => ({
    ...summary(m),
    arrivedAt: m.arrivedAt ?? m.date,
    ...(m.invite ? { hasInvite: true } : {}),
    ...(m.unsubscribe ? { bulk: true } : {})
  })
  const deliver = (kind: DeliveryKind, at: Date) => {
    const items = accounts.flatMap((a) => heldIn(a.id)).sort((a, b) => b.date.localeCompare(a.date))
    deliveredUntil = at.toISOString()
    const newest = deliveryRecords[0]
    deliveryRecords = [
      {
        id: crypto.randomUUID(),
        at: at.toISOString(),
        kind,
        first: !newest || !sameDay(new Date(newest.at), at),
        items: items.map(toItem),
        more: 0
      },
      ...deliveryRecords
    ].slice(0, 14)
    deliveryChanged()
  }
  const deliveryState = (): DeliveryState => {
    const last = deliveryRecords[0]
    return {
      on: settings.batchDelivery,
      times: settings.deliveryTimes,
      deliveredUntil: until(),
      nextAt: settings.batchDelivery ? nextDeliveryAt(new Date(), settings.deliveryTimes).toISOString() : null,
      last: last ? { at: last.at, kind: last.kind, count: last.items.length + last.more } : null
    }
  }
  if (!empty && (params.has('batch') || params.has('delivery'))) {
    const now = new Date()
    const mins = (d: Date) => d.getHours() * 60 + d.getMinutes()
    settings = {
      ...settings,
      batchDelivery: true,
      deliveryTimes: [formatTime(mins(new Date(now.getTime() - 5 * 60_000))), formatTime(mins(new Date(now.getTime() + 3 * 3600_000)))].sort()
    }
    deliveredUntil = ago(4)
    const quoteId = waiting.find((w) => w.id === 'w-quote')?.messageId
    messages.push(
      msg('gmail', 'INBOX', ['Priya Shah', 'priya.shah@example.com'], 'Re: Quote for the kitchen',
        'Hi Alex,\n\nHere is the updated quote. Can you confirm the worktop colour by Monday?\n\nPriya', 3,
        { parents: quoteId ? [quoteId] : [] }),
      msg('icloud', 'INBOX', ['Lena Novak', 'lena.novak@example.com'], 'Dinner next week?',
        'Are you free on Thursday? The new place on Upper Street has a table at 7.', 2),
      msg('gmail', 'INBOX', ['Fabrikam Store', 'news@fabrikam.example'], 'Autumn sale starts today',
        'Up to 40% off everything in store and online.', 1)
    )
    // The Delivery a few minutes ago, so the Brief shows: the Inbox mail of the last half day. `?morning` makes it the
    // day's first (the Morning brief, after yesterday's 17:00); with `?delivery` the new Delivery is the first instead.
    const morning = params.has('morning')
    const lastAt = new Date(now.getTime() - 5 * 60_000)
    lastAt.setSeconds(0, 0)
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 17)
    const earlier: DeliveryRecord = {
      id: 'mock-earlier', at: morning ? yesterday.toISOString() : ago(3 * 60), kind: 'scheduled', first: !morning,
      items: [], more: 0
    }
    const recent = messages
      .filter((m) => m.mailbox === 'INBOX' && Date.parse(m.date) < lastAt.getTime() && Date.now() - Date.parse(m.date) < 12 * 3600_000)
      .sort((a, b) => b.date.localeCompare(a.date))
    deliveryRecords =
      morning && params.has('delivery')
        ? [earlier]
        : [{ id: 'mock-last', at: lastAt.toISOString(), kind: 'scheduled', first: morning, items: recent.map(toItem), more: 0 }, earlier]
    if (params.has('delivery')) window.setTimeout(() => deliver('scheduled', new Date()), 4000)
  }
  window.setInterval(() => {
    if (!settings.batchDelivery || !deliveredUntil) return
    const step = advance(deliveredUntil, new Date(), settings.deliveryTimes)
    if (step.crossed) deliver('scheduled', step.crossed)
  }, 30_000)

  const find = (accountId: string, mailbox: string, u: number) => {
    // A Gmail label folder lists the messages carrying the label, wherever they are.
    const m = isLabelBox(accountId, mailbox)
      ? messages.find((x) => x.accountId === accountId && x.uid === u)
      : messages.find((x) => x.accountId === accountId && x.mailbox === mailbox && x.uid === u)
    if (!m) throw new Error('Message not found.')
    return m
  }

  /** Messages listed in a folder; a Gmail label folder shows every message with that label. */
  const inBox = (id: string, mailbox: string): MessageDetail[] =>
    isLabelBox(id, mailbox)
      ? messages
          .filter((m) => m.accountId === id && m.labels?.includes(mailbox))
          .map((m) => ({ ...m, mailbox, key: `${id}|${mailbox}|${m.uid}` }))
      : messages.filter((m) => m.accountId === id && m.mailbox === mailbox)

  const MOCK_DEFAULTS: { id: string; name: string; colour: LabelColour }[] = [
    { id: '$label1', name: 'Important', colour: 'red' },
    { id: '$label2', name: 'Work', colour: 'orange' },
    { id: '$label3', name: 'Personal', colour: 'green' },
    { id: '$label4', name: 'To Do', colour: 'blue' },
    { id: '$label5', name: 'Later', colour: 'purple' }
  ]
  const labelInfo = (accountId: string, id: string): LabelInfo => {
    const st = labelStyles[accountId]?.[id] ?? {}
    const d = MOCK_DEFAULTS.find((x) => x.id === id)
    return { id, name: st.name ?? d?.name ?? id, colour: st.colour ?? d?.colour ?? 'grey' }
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
      const before = settings
      settings = s
      if (!before.batchDelivery && s.batchDelivery) deliveredUntil = new Date().toISOString()
      if (before.batchDelivery && !s.batchDelivery) deliveredUntil = null
      if (
        before.batchDelivery !== s.batchDelivery ||
        before.deliveryTimes.join() !== s.deliveryTimes.join() ||
        vipAddresses(before.vips).join() !== vipAddresses(s.vips).join()
      )
        deliveryChanged()
      return s
    },
    async listMailboxes(id) {
      await unreachable(80)
      return withoutHeld(id)
    },
    async cachedMailboxes(id) {
      if (noCache) return null
      return withoutHeld(id)
    },
    async cachedList(id, mailbox, limit, view) {
      if (noCache) return null
      const all = inBox(id, mailbox).sort((a, b) => b.date.localeCompare(a.date))
      const list = (view ? all.filter((m) => m.category === view.replace('category:', '')) : all).slice(0, limit)
      return { messages: list.map((m) => ({ ...summary(m), uidValidity: '1' })), more: all.length > limit }
    },
    async cacheSize() {
      return 34_000_000
    },
    async clearCache() {},
    async listMessages(id, mailbox, limit = 60) {
      await unreachable(120)
      return inBox(id, mailbox)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(summary)
    },
    async search(id, mailbox, q, limit = 60) {
      await unreachable(300)
      const needle = q.replace(/category:\w+\s*/, '').toLowerCase()
      return inBox(id, mailbox)
        .filter((m) => [m.from.name, m.from.email, m.subject, m.text].some((s) => s.toLowerCase().includes(needle)))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(summary)
    },
    async searchQuery(id, mailbox, q, limit = 60) {
      await unreachable(300)
      const places = q.folder
        ? (boxes[id] ?? []).filter((b) => (q.folder === 'all' ? b.specialUse !== 'trash' && b.specialUse !== 'junk' && !isLabelBox(id, b.path) : b.specialUse === q.folder)).map((b) => b.path)
        : [mailbox]
      return places
        .flatMap((p) => inBox(id, p))
        .filter((m) => matchesQuery(m, q))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map(summary)
    },
    async listThread() {
      return []
    },
    async listLabels(id) {
      await unreachable(60)
      const styles = (labelStyles[id] ??= {})
      if (isGmail(id)) {
        const labels = (boxes[id] ?? []).filter((b) => !b.specialUse).map((b) => labelInfo(id, b.path))
        return { support: 'gmail', labels: labels.sort((a, b) => a.name.localeCompare(b.name)) }
      }
      if (noLabels && id === 'icloud') return { support: 'none', labels: [] }
      const used = messages.filter((m) => m.accountId === id).flatMap((m) => m.labels ?? [])
      const ids = [...new Set([...MOCK_DEFAULTS.map((d) => d.id), ...Object.keys(styles), ...used])].filter(
        (k) => !styles[k]?.deleted
      )
      return { support: 'keywords', labels: ids.map((k) => labelInfo(id, k)) }
    },
    async setLabels(id, mailbox, uids, change) {
      await sleep(150)
      if (noLabels && id === 'icloud') throw new Error("This account's server can't store labels on messages.")
      for (const u of uids) {
        const m = find(id, mailbox, u)
        const next = new Set(m.labels ?? [])
        for (const l of change.add ?? []) next.add(l)
        for (const l of change.remove ?? []) next.delete(l)
        m.labels = [...next].sort()
      }
      if (isLabelBox(id, mailbox) && change.remove?.includes(mailbox)) {
        const all = boxes[id]?.find((b) => b.specialUse === 'all')
        return all ? { path: all.path, uids } : null
      }
      return null
    },
    async createLabel(id, name, colour) {
      await sleep(120)
      const clean = name.trim()
      if (!clean) throw new Error('Give the label a name.')
      const styles = (labelStyles[id] ??= {})
      if (isGmail(id)) {
        if (!boxes[id]?.some((b) => b.path === clean)) boxes[id]?.push({ path: clean, name: clean, specialUse: null, unseen: 0, depth: 0 })
        styles[clean] = { ...styles[clean], colour: colour ?? 'blue' }
        return labelInfo(id, clean)
      }
      const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      styles[key] = { name: clean, colour: colour ?? 'teal' }
      return labelInfo(id, key)
    },
    async updateLabel(id, label, patch) {
      await sleep(120)
      const styles = (labelStyles[id] ??= {})
      let key = label
      if (patch.name && isGmail(id) && patch.name !== label) {
        key = patch.name.trim()
        const b = boxes[id]?.find((x) => x.path === label)
        if (b) Object.assign(b, { path: key, name: key })
        for (const m of messages) if (m.accountId === id && m.labels) m.labels = m.labels.map((l) => (l === label ? key : l))
        styles[key] = { ...styles[label] }
        delete styles[label]
      } else if (patch.name) styles[key] = { ...styles[key], name: patch.name.trim() }
      if (patch.colour) styles[key] = { ...styles[key], colour: patch.colour }
      return labelInfo(id, key)
    },
    async deleteLabel(id, label) {
      await sleep(200)
      for (const m of messages) if (m.accountId === id && m.labels) m.labels = m.labels.filter((l) => l !== label)
      const styles = (labelStyles[id] ??= {})
      if (isGmail(id)) {
        boxes[id] = (boxes[id] ?? []).filter((b) => b.path !== label)
        delete styles[label]
      } else styles[label] = { deleted: true }
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
      const held = new Set(mailbox === inboxOf(id) ? heldIn(id) : [])
      messages.filter((m) => m.accountId === id && m.mailbox === mailbox && !held.has(m)).forEach((m) => (m.seen = true))
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
      const copy = msg(input.accountId, sent?.path ?? 'Sent', ['Me', 'me'], input.subject, input.text, 0, { seen: true, html: input.html ?? null })
      if (sent) messages.push(copy)
      waitingSent(input, copy.messageId!)
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
    async listWaiting() {
      return [...waiting].sort((a, b) =>
        !!a.nudgedAt !== !!b.nudgedAt ? (a.nudgedAt ? -1 : 1) : a.nudgedAt && b.nudgedAt ? b.nudgedAt.localeCompare(a.nudgedAt) : a.dueAt.localeCompare(b.dueAt)
      )
    },
    async stopWaiting(id) {
      const item = waiting.find((w) => w.id === id)
      if (!item) throw new Error('This message is no longer waiting for a reply.')
      waiting = waiting.filter((w) => w.id !== id)
      waitingChanged()
      return item
    },
    async restoreWaiting(item) {
      if (!waiting.some((w) => w.id === item.id)) waiting.push(item)
      waitingChanged()
    },
    async waitLonger(id, days) {
      const item = waiting.find((w) => w.id === id)
      if (!item) throw new Error('This message is no longer waiting for a reply.')
      const next = { ...item, days, dueAt: nudgeTime(new Date(), days).toISOString(), nudgedAt: undefined }
      waiting = waiting.map((w) => (w.id === id ? next : w))
      waitingChanged()
      return next
    },
    async waitingMessage(id) {
      await sleep(150)
      const item = waiting.find((w) => w.id === id)
      const m = item && messages.find((x) => x.accountId === item.accountId && x.messageId === item.messageId)
      return m ? summary(m) : null
    },
    onWaitingChanged(cb) {
      waitingListeners.add(cb)
      return () => waitingListeners.delete(cb)
    },
    onWaitingOpen(cb) {
      waitingOpenListeners.add(cb)
      return () => waitingOpenListeners.delete(cb)
    },
    async getDelivery() {
      return deliveryState()
    },
    async deliverNow() {
      await sleep(200)
      if (!settings.batchDelivery) throw new Error('Batched delivery is off.')
      deliver('now', new Date())
      return deliveryState()
    },
    async listDeliveries() {
      return structuredClone(deliveryRecords)
    },
    onDeliveryChanged(cb) {
      deliveryListeners.add(cb)
      return () => deliveryListeners.delete(cb)
    },
    async briefSummary(id) {
      await sleep(1200)
      // Like briefParagraph in main: refused while the Brief Content opt-in is off.
      assertOptedIn(settings, 'brief')
      if (!aiKey) throw new Error('Add a Claude API key in Settings > Claude first.')
      const r = deliveryRecords.find((x) => x.id === id)
      if (!r) throw new Error('That delivery is no longer kept.')
      const b = makeBrief(r, { own: accounts.map((a) => a.email), vips: settings.vips, waitingIds: waiting.map((w) => w.messageId) })
      const names = [...new Set(b.needs.map((n) => (n.item.from.name || n.item.from.email).split(' ')[0]))]
      return `${names.slice(0, 2).join(' and ') || 'Nobody'} wrote to you directly and may need an answer today. ` +
        `The other ${r.items.length - b.needs.length} messages are updates and newsletters that can wait.`
    },
    onShowBrief() {
      return () => {}
    },
    async aiAvailable() {
      return !!aiKey
    },
    async setAiKey(key) {
      aiKey = key
    },
    async ai(input) {
      await sleep(900)
      // Like runAi in main: no message content goes out while the feature's Content opt-in is off.
      assertOptedIn(settings, input.task)
      if (!aiKey) throw new Error('Add a Claude API key in Settings > Claude first.')
      return input.task === 'summarise'
        ? `• ${input.subject}\n• Mock summary of a message from ${input.from}.`
        : 'Thanks, that works for me. See you then.'
    },
    async aiSearch(question) {
      await sleep(700)
      if (!aiKey) throw new Error('Add a Claude API key in Settings > Claude first.')
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
  if (q.labels?.some((l) => !m.labels?.includes(l))) return false
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
