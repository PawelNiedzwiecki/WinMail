export type Security = 'tls' | 'starttls' | 'none'

export interface ServerConfig {
  host: string
  port: number
  security: Security
}

export type ProviderId = 'icloud' | 'gmail' | 'yahoo' | 'fastmail' | 'outlook' | 'other'

/** How the account logs in to IMAP and SMTP. Accounts saved before OAuth have none: password. */
export type AuthMethod = 'password' | 'oauth'

export interface Account {
  id: string
  provider: ProviderId
  /** Label shown in the sidebar, e.g. "iCloud" or "Work". */
  description: string
  /** Full name used in the From header. */
  name: string
  email: string
  username: string
  auth?: AuthMethod
  enabled: boolean
  /** Plain text added below new messages and above quoted text in replies. */
  signature?: string
  imap: ServerConfig
  smtp: ServerConfig
}

export type AccountInput = Omit<Account, 'id'> & { password: string }

export interface AccountUpdate {
  account: Account
  /** Only set when the password changed. */
  password?: string
}

export type SpecialUse =
  | 'inbox'
  | 'drafts'
  | 'sent'
  | 'junk'
  | 'trash'
  | 'archive'
  | 'all'
  | 'flagged'
  /** WinMail's own folder for snoozed mail. */
  | 'snoozed'

export interface MailboxInfo {
  path: string
  name: string
  specialUse: SpecialUse | null
  unseen: number
  depth: number
}

export interface Address {
  name: string
  email: string
}

/** Someone you've written to or heard from, for recipient autocomplete. */
export interface Contact {
  name: string
  email: string
}

export interface ContactsStatus {
  /** e.g. "Google Contacts"; null when the provider has no address book WinMail can read. */
  source: string | null
  /** Contacts from the address book. */
  saved: number
  /** People found in the account's mail. */
  fromMail: number
  /** Why the address book could not be read, if it couldn't. */
  error: string | null
  loading: boolean
}

export interface MessageSummary {
  /** accountId|mailbox|uid */
  key: string
  accountId: string
  mailbox: string
  uid: number
  from: Address
  to: Address[]
  subject: string
  preview: string
  date: string
  seen: boolean
  flagged: boolean
  hasAttachments: boolean
  /** Message-ID header, for grouping conversations. */
  messageId?: string | null
  /** Message-IDs this one replies to (In-Reply-To and References). */
  parents?: string[]
  /** Gmail's X-GM-THRID; groups conversations exactly on Google accounts. */
  threadId?: string
  /** Inbox category worked out by WinMail from sender and headers (see shared/categorize.ts). */
  category?: GmailCategory
  /**
   * The folder's UIDVALIDITY when this was listed. Sent back with anything that acts on `uid`, so a message list
   * saved before the server renumbered the folder cannot act on a different message.
   */
  uidValidity?: string
}

/** Inbox category tabs: Gmail's own on Google accounts, worked out by WinMail elsewhere. */
export type GmailCategory = 'primary' | 'social' | 'promotions' | 'updates' | 'forums'

export interface AttachmentInfo {
  index: number
  filename: string
  contentType: string
  size: number
}

export interface MessageDetail extends MessageSummary {
  cc: Address[]
  /** Only present on your own drafts and sent mail. */
  bcc: Address[]
  /** Reply-To header; replies go here instead of From when set. */
  replyTo: Address[]
  html: string | null
  text: string
  messageId: string | null
  references: string[]
  attachments: AttachmentInfo[]
  /** From List-Unsubscribe; null when the sender offers no way out. */
  unsubscribe: Unsubscribe | null
  /** A calendar invitation in the message, or null. Missing on messages saved before WinMail looked for them. */
  invite?: CalendarInvite | null
}

/** An RSVP answer, as the iCalendar PARTSTAT value. */
export type InviteAnswer = 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'

export interface InviteAttendee extends Address {
  /** iCalendar PARTSTAT: NEEDS-ACTION, ACCEPTED, TENTATIVE, DECLINED, DELEGATED. */
  status: string
}

/** An event sent by mail (iCalendar). */
export interface CalendarInvite {
  /** REQUEST: an invitation or update; CANCEL: called off; REPLY: a guest answered; PUBLISH: for information. */
  method: string
  uid: string
  summary: string
  /** An instant (ISO) for timed events; a date ("2026-10-27") for all-day ones, whose `end` is the day after. */
  start: string
  end: string | null
  allDay: boolean
  recurring: boolean
  location: string | null
  organizer: Address | null
  attendees: InviteAttendee[]
  /** Your answer: as the invitation has it, or the last one sent from WinMail. */
  answer: InviteAnswer | null
  /** You organised it: nothing to answer. */
  isOrganizer: boolean
}

export interface Unsubscribe {
  /** https link; with `oneClick` it is POSTed to directly (RFC 8058). */
  url?: string
  mailto?: string
  oneClick: boolean
}

export type MoveTarget = 'trash' | 'archive' | 'junk' | 'inbox'

/** Where moved messages ended up, so the move can be undone. */
export interface MoveResult {
  path: string
  uids: number[]
  /** UIDVALIDITY of the destination, for undoing the move. */
  uidValidity?: string
}

/** A file on disk to attach when sending. */
export interface OutgoingAttachment {
  path: string
  filename: string
  size: number
}

export interface SendInput {
  accountId: string
  to: string
  cc?: string
  bcc?: string
  subject: string
  /** Plain-text body, or the plain-text alternative of `html`. */
  text: string
  /** Rich-text body. */
  html?: string
  attachments?: OutgoingAttachment[]
  inReplyTo?: string
  references?: string[]
  /** UID of this message's copy in the Drafts folder, deleted once it is sent. */
  draftUid?: number
}

export interface ScheduledInfo {
  id: string
  accountId: string
  to: string
  subject: string
  /** ISO time. */
  sendAt: string
  /** Why the last attempt failed; it is retried on the next check. */
  error?: string
}

/** Why a message waits in the outbox: the undo-send delay, or Schedule send. */
export type OutboxKind = 'undo' | 'scheduled'

/** A message held for the undo-send delay. */
export interface QueuedSend {
  id: string
  /** ISO time it goes out unless taken back with `cancelScheduled`. */
  sendAt: string
}

export interface OutboxEvent {
  id: string
  kind: OutboxKind
  state: 'sent' | 'failed'
  error?: string
}

/** An undo-send message that could not be sent, handed back once so Compose can reopen it. */
export interface FailedSend {
  id: string
  input: SendInput
  error: string
}

export interface Template {
  id: string
  name: string
  text: string
}

/** A message the user asked to open, e.g. by clicking a notification. */
export interface OpenMessageEvent {
  accountId: string
  path: string
  uid: number
}

export type AiTask = 'summarise' | 'reply'

export interface AiInput {
  task: AiTask
  from: string
  subject: string
  text: string
}

/** Where a `MailQuery` looks, by folder role; null in the query means the open mailbox. */
export type MailQueryFolder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'junk' | 'trash' | 'all'

/**
 * A structured search: what Claude made of a question like "invoices from Northwind last month", and what the
 * chips under the search box edit. Empty lists and nulls match everything; everything set must match.
 */
export interface MailQuery {
  /** Sender names, addresses or domains; any of them. */
  from: string[]
  /** Recipient names, addresses or domains; any of them. */
  to: string[]
  /** Words or phrases that must all be in the subject. */
  subject: string[]
  /** Words or phrases that must all appear somewhere in the message. */
  words: string[]
  /** First day included, YYYY-MM-DD in the user's time zone. */
  after: string | null
  /** Last day included, YYYY-MM-DD. */
  before: string | null
  read: 'unread' | 'read' | null
  /** Only flagged (starred) messages. */
  flagged: boolean
  hasAttachment: boolean
  category: GmailCategory | null
  folder: MailQueryFolder | null
}

export type Appearance = 'system' | 'light' | 'dark'

/** How message bodies are drawn; 'app' follows the app's appearance. */
export type MessageAppearance = 'light' | 'dark' | 'app'

export type ComposeFormat = 'rich' | 'plain'

/** Row spacing in the message list. */
export type ListDensity = 'compact' | 'comfortable'

/** Which new mail gets a notification: everything, the Primary category, or people you know. */
export type NotifyFilter = 'all' | 'primary' | 'people'

/** How much of a message its notification shows. */
export type NotifyPreview = 'full' | 'sender' | 'none'

export interface Settings {
  /** Lines of message text shown under the subject in the list; 0 shows the title only. */
  listPreviewLines: 0 | 1 | 2 | 3
  listDensity: ListDensity
  /** 0 = manual only */
  checkIntervalMin: number
  loadRemoteContent: boolean
  appearance: Appearance
  messageAppearance: MessageAppearance
  /** Seconds a sent message can still be undone; 0 sends at once. */
  undoSendSec: number
  notifyNewMail: boolean
  notifyFilter: NotifyFilter
  /** Accounts that never notify. */
  notifyMutedAccounts: string[]
  notifySound: boolean
  notifyPreview: NotifyPreview
  /** No notifications from `quietStart` to `quietEnd` ("HH:MM", local time; may cross midnight). */
  quietHours: boolean
  quietStart: string
  quietEnd: string
  /** Unread inbox count on the taskbar button. */
  taskbarBadge: boolean
  /** Single-key shortcuts like Gmail's (j/k, e, #, r, c, /). */
  gmailShortcuts: boolean
  /** Group the list into conversations. */
  conversations: boolean
  /** Show category tabs (Primary, Social, …) above the inbox. */
  inboxCategories: boolean
  /** Ask before moving messages to the Bin. */
  confirmDelete: boolean
  composeFormat: ComposeFormat
  /** Turn animations off in the app; Windows' own "Animation effects" setting also applies. */
  reduceMotion: boolean
  templates: Template[]
}

export const DEFAULT_SETTINGS: Settings = {
  listPreviewLines: 2,
  listDensity: 'comfortable',
  checkIntervalMin: 5,
  loadRemoteContent: false,
  appearance: 'system',
  messageAppearance: 'light',
  undoSendSec: 10,
  notifyNewMail: true,
  notifyFilter: 'all',
  notifyMutedAccounts: [],
  notifySound: true,
  notifyPreview: 'full',
  quietHours: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  taskbarBadge: true,
  gmailShortcuts: false,
  conversations: true,
  inboxCategories: true,
  confirmDelete: false,
  composeFormat: 'rich',
  reduceMotion: false,
  templates: []
}

export interface TestResult {
  ok: boolean
  stage?: 'imap' | 'smtp'
  error?: string
}

export interface MailChangedEvent {
  accountId: string
  path: string
  /** The folder's UIDs were renumbered: anything remembered about its messages is wrong. */
  reset?: boolean
}

/** New messages a mailbox is downloading; `incoming: 0` once the download finishes. */
export interface MailProgressEvent {
  accountId: string
  path: string
  incoming: number
}

export interface WinMailApi {
  platform: string
  mica: boolean

  listAccounts(): Promise<Account[]>
  testAccount(input: AccountInput): Promise<TestResult>
  addAccount(input: AccountInput): Promise<Account>
  updateAccount(update: AccountUpdate): Promise<Account>
  removeAccount(id: string): Promise<void>
  /** Opens Google sign-in in the browser, then verifies and saves the account. */
  addGoogleAccount(): Promise<Account>
  /** Signs an existing Google account in again; also moves a password account to OAuth. */
  reauthGoogleAccount(id: string): Promise<Account>
  cancelGoogleSignIn(): Promise<void>

  getSettings(): Promise<Settings>
  setSettings(settings: Settings): Promise<Settings>

  listMailboxes(accountId: string): Promise<MailboxInfo[]>
  listMessages(accountId: string, mailbox: string, limit?: number): Promise<MessageSummary[]>
  /** Server-side search; on Google accounts `query` accepts Gmail operators. Newest first. */
  search(accountId: string, mailbox: string, query: string, limit?: number): Promise<MessageSummary[]>
  /**
   * Runs a structured query: Gmail operators on Google accounts, IMAP SEARCH elsewhere. `mailbox` is searched
   * unless `query.folder` names another folder of the account. Newest first.
   */
  searchQuery(accountId: string, mailbox: string, query: MailQuery, limit?: number): Promise<MessageSummary[]>
  /** Every message of a Gmail conversation, from All Mail. Empty on other providers. */
  listThread(accountId: string, threadId: string): Promise<MessageSummary[]>
  getMessage(accountId: string, mailbox: string, uid: number, uidValidity?: string): Promise<MessageDetail>
  /** Raw RFC 822 source. */
  getSource(accountId: string, mailbox: string, uid: number, uidValidity?: string): Promise<string>
  setFlags(
    accountId: string,
    mailbox: string,
    uids: number[],
    flags: { seen?: boolean; flagged?: boolean },
    uidValidity?: string
  ): Promise<void>
  markAllRead(accountId: string, mailbox: string): Promise<void>
  /** Null when the messages were deleted for good or the server did not say where they went. */
  move(accountId: string, mailbox: string, uids: number[], target: MoveTarget, uidValidity?: string): Promise<MoveResult | null>
  moveTo(accountId: string, mailbox: string, uids: number[], dest: string, uidValidity?: string): Promise<MoveResult | null>
  /** Moves to the Snoozed folder; back to the inbox, unread, at `until` (ISO). */
  snooze(accountId: string, mailbox: string, uids: number[], until: string, uidValidity?: string): Promise<void>
  saveAttachment(accountId: string, mailbox: string, uid: number, index: number, uidValidity?: string): Promise<string | null>
  /** Answers a calendar invitation: emails the organiser an iCalendar reply. Returns the invite with your answer. */
  answerInvite(accountId: string, mailbox: string, uid: number, answer: InviteAnswer, uidValidity?: string): Promise<CalendarInvite>
  /** Opens a message's invitation in the default calendar app (Outlook, Calendar) to add it there. */
  openInvite(accountId: string, mailbox: string, uid: number, uidValidity?: string): Promise<void>
  /** Save dialog for text, e.g. a message's source. */
  saveText(defaultName: string, text: string): Promise<string | null>
  /** Prints a complete HTML document. */
  print(html: string): Promise<void>
  /** RFC 8058 one-click unsubscribe. */
  unsubscribe(url: string): Promise<void>

  /** File picker for attachments. */
  pickAttachments(): Promise<OutgoingAttachment[]>
  /** Disk path of a file dropped into the window. */
  pathForFile(file: File): string
  /** Files dropped or pasted into Compose, ready to attach; folders and unsaved items are refused. */
  addDroppedFiles(files: File[]): Promise<OutgoingAttachment[]>
  /** Saves a pasted image to a temporary file so it can be attached. */
  saveClipboardImage(file: File): Promise<OutgoingAttachment>
  send(input: SendInput): Promise<void>
  /** Sends after the undo delay (`undoSendSec`); `cancelScheduled(id)` takes it back until then. */
  queueSend(input: SendInput): Promise<QueuedSend>
  /** Undo-send messages that failed since the last call, for reopening in Compose. */
  takeFailedSends(): Promise<FailedSend[]>
  /** A queued or scheduled message was sent, or failed. */
  onOutbox(cb: (e: OutboxEvent) => void): () => void
  /** Saves to Drafts, replacing `input.draftUid`; returns the new copy's UID when known. */
  saveDraft(input: SendInput): Promise<number | null>
  deleteDraft(accountId: string, uid: number): Promise<void>
  /** A saved draft, attachments extracted to temporary files, ready for Compose. */
  openDraft(accountId: string, mailbox: string, uid: number, uidValidity?: string): Promise<SendInput>
  scheduleSend(input: SendInput, sendAt: string): Promise<ScheduledInfo>
  listScheduled(): Promise<ScheduledInfo[]>
  /** Removes it from the queue and returns it for editing. */
  cancelScheduled(id: string): Promise<SendInput>
  onScheduledChanged(cb: () => void): () => void

  /** Whether a Claude API key is saved. */
  aiAvailable(): Promise<boolean>
  /** Saves the key (encrypted), or removes it with null. */
  setAiKey(key: string | null): Promise<void>
  ai(input: AiInput): Promise<string>
  /** Turns a question about the user's mail into a structured query with Claude. Sends only the question. */
  aiSearch(question: string): Promise<MailQuery>

  /** The account's address book plus people from its mail, best match first. */
  listContacts(accountId: string): Promise<Contact[]>
  contactsStatus(accountId: string): Promise<ContactsStatus>
  /** Fires when an account's contacts finish loading. */
  onContactsChanged(cb: (accountId: string) => void): () => void

  /** Folder list as last saved on this PC; null when nothing has been saved for the account. */
  cachedMailboxes(accountId: string): Promise<MailboxInfo[] | null>
  /**
   * A folder's newest messages as last saved on this PC, without asking the server; null when the folder has
   * not been synced. `view` is a Gmail search such as `category:promotions`, saved from the last time it ran.
   */
  cachedList(
    accountId: string,
    mailbox: string,
    limit: number,
    view?: string
  ): Promise<{ messages: MessageSummary[]; more: boolean } | null>
  /** Bytes the saved mail takes on disk. */
  cacheSize(): Promise<number>
  /** Deletes the saved mail; it is saved again as mail is read. */
  clearCache(): Promise<void>

  onMailChanged(cb: (e: MailChangedEvent) => void): () => void
  onMailProgress(cb: (e: MailProgressEvent) => void): () => void
  onOpenMessage(cb: (e: OpenMessageEvent) => void): () => void

  /** Shows a sample new-mail notification with the current settings. */
  testNotification(): Promise<void>
  /** Draws sender pictures for notifications, as PNG data URLs; the main window answers. */
  onNotificationAvatar(draw: (name: string, email: string) => Promise<string>): () => void
  /** Unread count on the taskbar button: `image` is the badge as a PNG data URL, null clears it. */
  setTaskbarBadge(count: number, image: string | null): void

  /** Opens the Windows emoji picker at the cursor. */
  showEmojiPanel(): void
  /** The window is about to close: save open drafts, then call `closeReady()`. */
  onCloseRequested(cb: () => void): () => void
  closeReady(): void

  /**
   * Pop-out compose windows: a card moves to a window of its own and back. The payloads belong to
   * the renderer; the main process only carries them.
   */
  openComposeWindow(payload: unknown): Promise<void>
  /** In a pop-out window: what it was opened with. */
  popoutPayload(): Promise<unknown | null>
  /** Ids of the pop-out windows that are open. */
  listPopouts(): Promise<string[]>
  /** In a pop-out window: tells the main window something, e.g. to take the card back. */
  popoutSend(message: unknown): void
  onPopoutMessage(cb: (message: unknown) => void): () => void

  /** Opens a message in a window of its own (double-click in the list), or focuses the one showing it. */
  openMessageWindow(summary: MessageSummary): Promise<void>
  /** In a message window: the message it shows. */
  messageWindowPayload(): Promise<MessageSummary | null>
}
