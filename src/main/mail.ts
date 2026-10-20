import {
  ImapFlow,
  type ListResponse,
  type MessageAddressObject,
  type MessageEnvelopeObject,
  type MessageStructureObject,
  type SearchObject
} from 'imapflow'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type Mail from 'nodemailer/lib/mailer'
import { simpleParser, type AddressObject, type HeaderLines } from 'mailparser'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type {
  Account,
  AccountInput,
  Address,
  MailChangedEvent,
  MailProgressEvent,
  MailboxInfo,
  MessageDetail,
  MessageSummary,
  MoveResult,
  MoveTarget,
  OutgoingAttachment,
  SendInput,
  SpecialUse,
  TestResult,
  Unsubscribe
} from '../shared/types'
import { getProvider } from '../shared/providers'
import { categorize } from '../shared/categorize'
import type { Snoozed, Store } from './store'
import { decodeCharset, decodeTransfer, htmlToText, makePreview } from './text'
import { GoogleTokens, REAUTH_MESSAGE, signIn as googleSignIn } from './google'
import { TEMP_ROOT } from './attachments'

/** Either a password or an OAuth access token (XOAUTH2). */
export type Creds = Pick<Account, 'imap' | 'smtp' | 'username'> & { password?: string; accessToken?: string }

function imapClient(c: Creds): ImapFlow {
  return new ImapFlow({
    host: c.imap.host,
    port: c.imap.port,
    secure: c.imap.security === 'tls',
    doSTARTTLS: c.imap.security === 'starttls' ? true : c.imap.security === 'none' ? false : undefined,
    auth: c.accessToken ? { user: c.username, accessToken: c.accessToken } : { user: c.username, pass: c.password },
    logger: false,
    clientInfo: { name: 'WinMail', version: '0.1.0' }
  })
}

function smtpTransport(c: Creds) {
  return nodemailer.createTransport({
    host: c.smtp.host,
    port: c.smtp.port,
    secure: c.smtp.security === 'tls',
    requireTLS: c.smtp.security === 'starttls',
    ignoreTLS: c.smtp.security === 'none',
    auth: c.accessToken
      ? { type: 'OAuth2', user: c.username, accessToken: c.accessToken }
      : { user: c.username, pass: c.password }
  })
}

function isAuthError(err: unknown): boolean {
  const e = err as { authenticationFailed?: boolean; code?: string; responseCode?: number }
  return !!e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535
}

function friendlyError(err: unknown, oauth = false): string {
  if (oauth && isAuthError(err)) return REAUTH_MESSAGE
  const e = err as {
    authenticationFailed?: boolean
    responseText?: string
    code?: string
    responseCode?: number
    message?: string
  }
  if (isAuthError(err)) {
    return 'Username or password is incorrect. Most providers need an app-specific password.'
  }
  if (e.code === 'ENOTFOUND') return 'Server not found. Check the host name.'
  if (e.code === 'ECONNREFUSED') return 'Connection refused. Check the port and security setting.'
  if (e.code === 'ETIMEDOUT' || e.code === 'ETIMEOUT') return 'Connection timed out.'
  if (e.code === 'ESOCKET' || /certificate|SSL|TLS/i.test(e.message ?? '')) {
    return `Secure connection failed: ${e.message}`
  }
  return e.responseText || e.message || String(err)
}

const SPECIAL: Record<string, SpecialUse> = {
  '\\Inbox': 'inbox',
  '\\Drafts': 'drafts',
  '\\Sent': 'sent',
  '\\Junk': 'junk',
  '\\Trash': 'trash',
  '\\Archive': 'archive',
  '\\All': 'all',
  '\\Flagged': 'flagged'
}

const SPECIAL_NAME: Record<SpecialUse, string> = {
  inbox: 'Inbox',
  drafts: 'Drafts',
  sent: 'Sent',
  junk: 'Junk',
  trash: 'Bin',
  archive: 'Archive',
  all: 'All Mail',
  flagged: 'Flagged',
  snoozed: 'Snoozed'
}

const SPECIAL_ORDER: SpecialUse[] = [
  'inbox',
  'snoozed',
  'drafts',
  'sent',
  'junk',
  'trash',
  'archive',
  'all',
  'flagged'
]

/** Folder WinMail creates for snoozed mail. */
export const SNOOZE_FOLDER = 'WinMail Snoozed'

interface TextPart {
  part: string
  type: string
  encoding?: string
  charset?: string
}

function walk(node: MessageStructureObject, fn: (n: MessageStructureObject) => void): void {
  fn(node)
  node.childNodes?.forEach((c) => walk(c, fn))
}

function findTextPart(root: MessageStructureObject | undefined): TextPart | null {
  if (!root) return null
  let plain: TextPart | null = null
  let html: TextPart | null = null
  walk(root, (n) => {
    if (n.disposition === 'attachment' || n.childNodes) return
    const part = n.part ?? '1'
    const t = n.type.toLowerCase()
    const info = { part, type: t, encoding: n.encoding, charset: n.parameters?.charset }
    if (t === 'text/plain' && !plain) plain = info
    if (t === 'text/html' && !html) html = info
  })
  return plain ?? html
}

function hasAttachments(root: MessageStructureObject | undefined): boolean {
  let found = false
  if (root) walk(root, (n) => (found ||= n.disposition === 'attachment'))
  return found
}

function toAddresses(list: { name?: string; address?: string }[] | undefined): Address[] {
  return (list ?? []).map((a) => ({ name: a.name || a.address || '', email: a.address ?? '' }))
}

function parsedAddresses(a: AddressObject | AddressObject[] | undefined): Address[] {
  const arr = Array.isArray(a) ? a : a ? [a] : []
  return arr.flatMap((x) =>
    x.value.map((v) => ({ name: v.name || v.address || '', email: v.address ?? '' }))
  )
}

/** Message-IDs in a References or In-Reply-To header. */
function messageIds(header: string | undefined): string[] {
  return header?.match(/<[^<>\s]+>/g) ?? []
}

function formatAddresses(list: Address[]): string {
  return list.map((a) => (a.name && a.name !== a.email ? `"${a.name.replace(/["\\]/g, '\\$&')}" <${a.email}>` : a.email)).join(', ')
}

/** List-Unsubscribe (RFC 2369) with List-Unsubscribe-Post (RFC 8058). */
function parseUnsubscribe(lines: HeaderLines): Unsubscribe | null {
  const value = (key: string) =>
    lines
      .find((l) => l.key === key)
      ?.line.replace(/^[^:]*:\s*/, '')
      .replace(/\r?\n\s+/g, ' ')
  const header = value('list-unsubscribe')
  if (!header) return null
  const links = (header.match(/<([^>]+)>/g) ?? []).map((l) => l.slice(1, -1).trim())
  const url = links.find((l) => /^https:\/\//i.test(l))
  const mailto = links.find((l) => /^mailto:/i.test(l))
  if (!url && !mailto) return null
  return { url, mailto, oneClick: !!url && /List-Unsubscribe=One-Click/i.test(value('list-unsubscribe-post') ?? '') }
}

/** Builds a message; `keepBcc` for copies that stay with you (Sent, Drafts), never for sending. */
async function compile(mail: Mail.Options, keepBcc: boolean): Promise<Buffer> {
  const node = new MailComposer(mail).compile()
  node.keepBcc = keepBcc
  return node.build()
}

const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }

/**
 * Pasted images arrive as `data:` URLs, which many mail apps don't show. Turns them into
 * inline parts referenced by `cid:`, as nodemailer's transport would (MailComposer doesn't).
 */
function inlineImages(html: string): { html: string; parts: Mail.Attachment[] } {
  const parts: Mail.Attachment[] = []
  const out = html.replace(
    /(<img\b[^>]*?\ssrc\s*=\s*)(["'])data:(image\/\w+);base64,([^"']*)\2/gi,
    (_m, pre: string, q: string, type: string, data: string) => {
      const cid = `${randomUUID()}@winmail`
      const ext = IMAGE_EXT[type.toLowerCase()] ?? type.split('/')[1]!.replace(/\W.*$/, '')
      parts.push({
        cid,
        filename: `image-${parts.length + 1}.${ext}`,
        contentType: type,
        content: Buffer.from(data, 'base64'),
        contentDisposition: 'inline'
      })
      return `${pre}${q}cid:${cid}${q}`
    }
  )
  return { html: out, parts }
}

/** Previews kept in memory; oldest are dropped first. */
const MAX_PREVIEWS = 5000

/** How long to stay in another folder before re-selecting the inbox so IDLE watches it. */
const INBOX_RETURN_MS = 3000

/** The second connection used for uploads closes after this long without work. */
const UPLOAD_IDLE_MS = 60_000

/** A second IMAP connection for draft saves and Sent copies; see `withUpload`. */
interface Upload {
  client: Promise<ImapFlow>
  /** Operations running on it now; the idle timer starts when this drops to zero. */
  active: number
  idle?: NodeJS.Timeout
}

export class MailService {
  private clients = new Map<string, ImapFlow>()
  private pending = new Map<string, Promise<ImapFlow>>()
  private previews = new Map<string, string>()
  private specialPaths = new Map<string, Partial<Record<SpecialUse, string>>>()
  private inboxTimers = new Map<string, NodeJS.Timeout>()
  /** Highest UID listed per account|path|uidValidity, to count what's new on the next check. */
  private newestUid = new Map<string, number>()
  /** Raw source of the last opened message, so saving an attachment doesn't download it again. */
  private lastSource: { key: string; source: Buffer } | null = null
  /** Highest inbox UID already announced per account|uidValidity, for new-mail notifications. */
  private announced = new Map<string, number>()
  private uploads = new Map<string, Upload>()
  /** Old draft versions that could not be removed yet, retried with the account's next draft change. */
  private staleDrafts = new Map<string, Set<number>>()
  private tokens = new GoogleTokens()

  constructor(
    private store: Store,
    private emit: (e: MailChangedEvent) => void,
    private progress: (e: MailProgressEvent) => void = () => {},
    /** Unread messages that arrived in an inbox since the last check. */
    private arrived: (accountId: string, messages: MessageSummary[]) => void = () => {}
  ) {}

  // ---------- Connections ----------

  /** Password or a fresh access token; also used for the account's contacts server. */
  async credentials(accountId: string): Promise<Creds> {
    return this.creds(this.store.getAccount(accountId))
  }

  private async creds(acc: Account): Promise<Creds> {
    const secret = this.store.getPassword(acc.id)
    if (acc.auth !== 'oauth') return { ...acc, password: secret }
    return { ...acc, accessToken: await this.tokens.get(acc.id, secret) }
  }

  private async client(accountId: string): Promise<ImapFlow> {
    const existing = this.clients.get(accountId)
    if (existing?.usable) return existing
    const inflight = this.pending.get(accountId)
    if (inflight) return inflight

    const p = (async () => {
      const acc = this.store.getAccount(accountId)
      const c = imapClient(await this.creds(acc))
      c.on('error', (err) => console.error(`[imap ${acc.email}]`, err.message))
      c.on('close', () => {
        if (this.clients.get(accountId) === c) this.clients.delete(accountId)
      })
      c.on('exists', (d) => {
        this.emit({ accountId, path: d.path })
        if (d.path === this.inboxOf(accountId)) void this.checkArrived(accountId)
      })
      try {
        await c.connect()
      } catch (err) {
        if (isAuthError(err)) this.tokens.forget(accountId)
        throw new Error(friendlyError(err, acc.auth === 'oauth'))
      }
      this.clients.set(accountId, c)
      return c
    })().finally(() => this.pending.delete(accountId))

    this.pending.set(accountId, p)
    return p
  }

  async disconnect(accountId: string): Promise<void> {
    const c = this.clients.get(accountId)
    this.clients.delete(accountId)
    this.specialPaths.delete(accountId)
    clearTimeout(this.inboxTimers.get(accountId))
    this.inboxTimers.delete(accountId)
    if (this.lastSource?.key.startsWith(`${accountId}|`)) this.lastSource = null
    const upload = this.uploads.get(accountId)
    this.uploads.delete(accountId)
    if (upload) {
      clearTimeout(upload.idle)
      void upload.client.then((u) => u.logout()).catch(() => {})
    }
    try {
      await c?.logout()
    } catch {
      c?.close()
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = new Set([...this.clients.keys(), ...this.uploads.keys()])
    await Promise.all([...ids].map((id) => this.disconnect(id)))
  }

  /**
   * Runs `fn` on a second connection, used for draft saves and Sent copies. Uploads can be
   * large and drafts are saved often; on the main connection they would block reading mail
   * and move IDLE off the inbox. The connection closes after a minute without work.
   */
  private async withUpload<T>(accountId: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    let u = this.uploads.get(accountId)
    if (u && !(await u.client.then((c) => c.usable, () => false))) {
      if (this.uploads.get(accountId) === u) this.uploads.delete(accountId)
      u = undefined
    }
    if (!u) {
      u = { client: this.connectUpload(accountId), active: 0 }
      this.uploads.set(accountId, u)
    }
    const entry = u
    clearTimeout(entry.idle)
    entry.active++
    try {
      return await fn(await entry.client)
    } finally {
      entry.active--
      if (!entry.active) {
        entry.idle = setTimeout(() => {
          if (this.uploads.get(accountId) === entry) this.uploads.delete(accountId)
          void entry.client.then((c) => c.logout()).catch(() => {})
        }, UPLOAD_IDLE_MS)
      }
    }
  }

  private async connectUpload(accountId: string): Promise<ImapFlow> {
    const acc = this.store.getAccount(accountId)
    const c = imapClient(await this.creds(acc))
    c.on('error', (err) => console.error(`[imap upload ${acc.email}]`, err.message))
    try {
      await c.connect()
    } catch (err) {
      if (isAuthError(err)) this.tokens.forget(accountId)
      throw new Error(friendlyError(err, acc.auth === 'oauth'))
    }
    return c
  }

  private async withMailbox<T>(accountId: string, path: string, fn: (c: ImapFlow) => Promise<T>) {
    const c = await this.client(accountId)
    const lock = await c.getMailboxLock(path)
    try {
      return await fn(c)
    } finally {
      lock.release()
      this.scheduleInboxReturn(accountId, c, path)
    }
  }

  /**
   * IMAP IDLE only reports changes in the selected mailbox, so after work in another
   * folder go back to the inbox, otherwise new mail only shows up on the periodic check.
   */
  private scheduleInboxReturn(accountId: string, c: ImapFlow, path: string): void {
    clearTimeout(this.inboxTimers.get(accountId))
    this.inboxTimers.delete(accountId)
    const inbox = this.inboxOf(accountId)
    if (path === inbox) return
    const t = setTimeout(() => {
      this.inboxTimers.delete(accountId)
      if (!c.usable || this.clients.get(accountId) !== c || (c.mailbox && c.mailbox.path === inbox)) return
      c.getMailboxLock(inbox)
        .then((l) => l.release())
        .catch((err) => console.error(`[imap] could not reselect inbox:`, err.message))
    }, INBOX_RETURN_MS)
    this.inboxTimers.set(accountId, t)
  }

  // ---------- Accounts ----------

  async test(input: Creds): Promise<TestResult> {
    const imap = imapClient(input)
    imap.on('error', () => {})
    try {
      await imap.connect()
      await imap.logout()
    } catch (err) {
      imap.close()
      return { ok: false, stage: 'imap', error: friendlyError(err, !!input.accessToken) }
    }
    const smtp = smtpTransport(input)
    try {
      await smtp.verify()
    } catch (err) {
      return { ok: false, stage: 'smtp', error: friendlyError(err, !!input.accessToken) }
    } finally {
      smtp.close()
    }
    return { ok: true }
  }

  private async testGoogle(c: Creds): Promise<void> {
    const res = await this.test(c)
    if (!res.ok) {
      const where = res.stage === 'smtp' ? 'Outgoing server (SMTP)' : 'Incoming server (IMAP)'
      throw new Error(`${where}: ${res.error}`)
    }
  }

  async addGoogleAccount(): Promise<Account> {
    const g = await googleSignIn()
    const existing = this.store.listAccounts()
    if (existing.some((a) => a.email.toLowerCase() === g.email.toLowerCase())) {
      throw new Error(
        `${g.email} is already added. To switch it to Google sign-in, use Settings > Accounts > Server Settings.`
      )
    }
    const p = getProvider('gmail')
    const input: AccountInput = {
      provider: 'gmail',
      auth: 'oauth',
      description: existing.some((a) => a.description === p.name) ? `${p.name} (${g.email})` : p.name,
      name: g.name,
      email: g.email,
      username: g.email,
      enabled: true,
      imap: p.imap!,
      smtp: p.smtp!,
      password: g.refreshToken
    }
    await this.testGoogle({ ...input, accessToken: g.accessToken })
    const acc = this.store.addAccount(input)
    this.tokens.remember(acc.id, g.accessToken, g.expiresAt)
    return acc
  }

  async reauthGoogleAccount(accountId: string): Promise<Account> {
    const acc = this.store.getAccount(accountId)
    const g = await googleSignIn(acc.email)
    if (g.email.toLowerCase() !== acc.email.toLowerCase()) {
      throw new Error(`You signed in as ${g.email}. Sign in as ${acc.email} instead.`)
    }
    const next: Account = { ...acc, auth: 'oauth', username: g.email }
    await this.testGoogle({ ...next, accessToken: g.accessToken })
    const saved = this.store.updateAccount({ account: next, password: g.refreshToken }, 'oauth')
    await this.disconnect(acc.id)
    this.tokens.remember(acc.id, g.accessToken, g.expiresAt)
    return saved
  }

  // ---------- Mailboxes ----------

  async listMailboxes(accountId: string): Promise<MailboxInfo[]> {
    const c = await this.client(accountId)
    const list = await c.list({ statusQuery: { unseen: true } })
    const selectable = list.filter((l) => l.listed !== false && !l.flags.has('\\Noselect'))
    const paths = new Set(selectable.map((l) => l.path))

    const special: Partial<Record<SpecialUse, string>> = {}
    const depthOf = (l: ListResponse) => {
      // Count only ancestors we actually show, so "[Gmail]/Sent Mail" sits at the top level.
      const parts = l.path.split(l.delimiter || '/')
      let d = 0
      for (let i = 1; i < parts.length; i++) {
        if (paths.has(parts.slice(0, i).join(l.delimiter))) d++
      }
      return d
    }

    const out = selectable.map((l): MailboxInfo => {
      const use =
        l.path.toUpperCase() === 'INBOX'
          ? 'inbox'
          : l.name === SNOOZE_FOLDER
            ? 'snoozed'
            : (SPECIAL[l.specialUse ?? ''] ?? null)
      if (use && !special[use]) special[use] = l.path
      return {
        path: l.path,
        name: use ? SPECIAL_NAME[use] : l.name,
        specialUse: use,
        unseen: l.status?.unseen ?? 0,
        depth: use ? 0 : depthOf(l)
      }
    })
    this.specialPaths.set(accountId, special)

    const rank = (m: MailboxInfo) => (m.specialUse ? SPECIAL_ORDER.indexOf(m.specialUse) : 99)
    return out.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
  }

  private async specialPath(accountId: string, use: SpecialUse): Promise<string | undefined> {
    if (!this.specialPaths.has(accountId)) await this.listMailboxes(accountId)
    return this.specialPaths.get(accountId)?.[use]
  }

  // ---------- Messages ----------

  private inboxOf(accountId: string): string {
    return this.specialPaths.get(accountId)?.inbox ?? 'INBOX'
  }

  async listMessages(accountId: string, path: string, limit = 60): Promise<MessageSummary[]> {
    const { list, fresh } = await this.withMailbox(accountId, path, async (c) => {
      const mb = c.mailbox
      if (!mb || !mb.exists) return { list: [], fresh: [] }

      // Count arrivals since the last listing so the UI can say "Downloading 3 new messages".
      const box = `${accountId}|${path}|${mb.uidValidity}`
      const last = this.newestUid.get(box)
      let incoming = 0
      if (last !== undefined && mb.uidNext > last + 1) {
        const uids = await c.search({ uid: `${last + 1}:*` }, { uid: true })
        incoming = uids ? uids.filter((u) => u > last).length : 0
      }
      if (incoming) this.progress({ accountId, path, incoming })
      try {
        const list = await this.fetchSummaries(c, accountId, path, `${Math.max(1, mb.exists - limit + 1)}:*`, false)
        this.newestUid.set(box, list.reduce((max, m) => Math.max(max, m.uid), last ?? 0))
        const fresh = path === this.inboxOf(accountId) ? await this.unannounced(c, accountId) : []
        return { list, fresh }
      } finally {
        if (incoming) this.progress({ accountId, path, incoming: 0 })
      }
    })
    if (fresh.length) this.arrived(accountId, fresh)
    return list
  }

  /**
   * Unread inbox messages newer than the last ones announced. The first look at an inbox
   * starts from what was there when it was selected, so old unread mail is never announced.
   */
  private async unannounced(c: ImapFlow, accountId: string): Promise<MessageSummary[]> {
    const mb = c.mailbox
    if (!mb) return []
    const key = `${accountId}|${mb.uidValidity}`
    const last = this.announced.get(key) ?? mb.uidNext - 1
    this.announced.set(key, last)
    const found = await c.search({ uid: `${last + 1}:*` }, { uid: true })
    const uids = (found || []).filter((u) => u > last)
    if (!uids.length) return []
    this.announced.set(key, Math.max(...uids))
    const list = await this.fetchSummaries(c, accountId, mb.path, uids.join(','), true)
    return list.filter((m) => !m.seen)
  }

  private async checkArrived(accountId: string): Promise<void> {
    try {
      const fresh = await this.withMailbox(accountId, this.inboxOf(accountId), (c) => this.unannounced(c, accountId))
      if (fresh.length) this.arrived(accountId, fresh)
    } catch (err) {
      console.error('[imap] new mail check failed:', err instanceof Error ? err.message : err)
    }
  }

  /** Server-side search, newest first. Google accounts take Gmail search operators. */
  async search(accountId: string, path: string, query: string, limit = 60): Promise<MessageSummary[]> {
    const gmail = this.store.getAccount(accountId).provider === 'gmail'
    const q: SearchObject = gmail
      ? { gmraw: query }
      : { or: [{ from: query }, { to: query }, { subject: query }, { body: query }] }
    return this.withMailbox(accountId, path, async (c) => {
      if (!c.mailbox || !c.mailbox.exists) return []
      const uids = (await c.search(q, { uid: true })) || []
      if (!uids.length) return []
      const newest = uids.sort((a, b) => b - a).slice(0, limit)
      return this.fetchSummaries(c, accountId, path, newest.join(','), true)
    })
  }

  /** The whole Gmail conversation, including your replies, from All Mail. */
  async listThread(accountId: string, threadId: string): Promise<MessageSummary[]> {
    if (this.store.getAccount(accountId).provider !== 'gmail') return []
    const all = await this.specialPath(accountId, 'all')
    if (!all) return []
    return this.withMailbox(accountId, all, async (c) => {
      const uids = (await c.search({ threadId }, { uid: true })) || []
      return uids.length ? this.fetchSummaries(c, accountId, all, uids.join(','), true) : []
    })
  }

  private async fetchSummaries(
    c: ImapFlow,
    accountId: string,
    path: string,
    range: string,
    byUid: boolean
  ): Promise<MessageSummary[]> {
    const mb = c.mailbox
    if (!mb) return []
    const rows = await c.fetchAll(
      range,
      {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        bodyStructure: true,
        threadId: true,
        headers: ['references', 'list-id', 'list-unsubscribe', 'precedence', 'auto-submitted']
      },
      { uid: byUid }
    )

    const cacheKey = (uid: number) => `${accountId}|${path}|${mb.uidValidity}|${uid}`

    // Fetch the first ~3 KB of the text part for previews, grouped by part id.
    const groups = new Map<string, number[]>()
    const partInfo = new Map<number, TextPart>()
    for (const r of rows) {
      if (this.previews.has(cacheKey(r.uid))) continue
      const tp = findTextPart(r.bodyStructure)
      if (!tp) continue
      partInfo.set(r.uid, tp)
      groups.set(tp.part, [...(groups.get(tp.part) ?? []), r.uid])
    }
    for (const [part, uids] of groups) {
      const got = await c.fetchAll(
        uids.join(','),
        { uid: true, bodyParts: [{ key: part, maxLength: 3072 }] },
        { uid: true }
      )
      for (const m of got) {
        const info = partInfo.get(m.uid)
        const buf = m.bodyParts?.get(part) ?? [...(m.bodyParts?.values() ?? [])][0]
        if (!info || !buf) continue
        let text = decodeCharset(decodeTransfer(buf, info.encoding), info.charset)
        if (info.type === 'text/html') text = htmlToText(text)
        this.previews.set(cacheKey(m.uid), makePreview(text))
      }
    }
    // Maps iterate in insertion order, so the first keys are the oldest.
    for (const k of this.previews.keys()) {
      if (this.previews.size <= MAX_PREVIEWS) break
      this.previews.delete(k)
    }

    return rows
      .map((r): MessageSummary => {
        const env = r.envelope
        const date = env?.date ?? r.internalDate ?? new Date()
        const hdr = r.headers?.toString() ?? ''
        const refs = messageIds(hdr)
        const from = toAddresses(env?.from)[0] ?? { name: '(Unknown)', email: '' }
        const subject = env?.subject || '(No Subject)'
        return {
          key: `${accountId}|${path}|${r.uid}`,
          accountId,
          mailbox: path,
          uid: r.uid,
          from,
          to: toAddresses(env?.to),
          subject,
          preview: this.previews.get(cacheKey(r.uid)) ?? '',
          date: new Date(date).toISOString(),
          seen: r.flags?.has('\\Seen') ?? false,
          flagged: r.flags?.has('\\Flagged') ?? false,
          hasAttachments: hasAttachments(r.bodyStructure),
          messageId: env?.messageId || undefined,
          parents: [...new Set([...refs, ...messageIds(env?.inReplyTo)])],
          threadId: r.threadId,
          category: categorize({
            email: from.email,
            subject,
            listId: /^list-id:/im.test(hdr),
            listUnsubscribe: /^list-unsubscribe:/im.test(hdr),
            bulk: /^precedence:\s*(bulk|list|junk)/im.test(hdr),
            automated: /^auto-submitted:\s*(?!no\b)\S/im.test(hdr)
          })
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  async getMessage(accountId: string, path: string, uid: number): Promise<MessageDetail> {
    return this.withMailbox(accountId, path, async (c) => {
      const m = await c.fetchOne(
        String(uid),
        { uid: true, source: true, flags: true, bodyStructure: true, internalDate: true, threadId: true },
        { uid: true }
      )
      if (!m || !m.source) throw new Error('Message not found. It may have been moved.')
      this.lastSource = { key: `${accountId}|${path}|${c.mailbox && c.mailbox.uidValidity}|${uid}`, source: m.source }
      const p = await simpleParser(m.source)
      if (!m.flags?.has('\\Seen')) await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })

      const text = p.text ?? (p.html ? htmlToText(p.html) : '')
      const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : []
      return {
        key: `${accountId}|${path}|${uid}`,
        accountId,
        mailbox: path,
        uid,
        from: parsedAddresses(p.from)[0] ?? { name: '(Unknown)', email: '' },
        to: parsedAddresses(p.to),
        cc: parsedAddresses(p.cc),
        bcc: parsedAddresses(p.bcc),
        replyTo: parsedAddresses(p.replyTo),
        subject: p.subject || '(No Subject)',
        preview: makePreview(text),
        date: (p.date ?? new Date(m.internalDate ?? Date.now())).toISOString(),
        seen: true,
        flagged: m.flags?.has('\\Flagged') ?? false,
        hasAttachments: hasAttachments(m.bodyStructure),
        html: p.html || null,
        text,
        messageId: p.messageId ?? null,
        references: refs,
        parents: [...new Set([...refs, ...messageIds(p.inReplyTo)])],
        threadId: m.threadId,
        unsubscribe: parseUnsubscribe(p.headerLines),
        attachments: p.attachments
          .map((a, index) => ({ a, index }))
          .filter(({ a }) => !a.related)
          .map(({ a, index }) => ({
            index,
            filename: a.filename || 'attachment',
            contentType: a.contentType,
            size: a.size
          }))
      }
    })
  }

  async getSource(accountId: string, path: string, uid: number): Promise<string> {
    return this.withMailbox(accountId, path, async (c) => {
      const m = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      if (!m || !m.source) throw new Error('Message not found. It may have been moved.')
      return m.source.toString('utf8')
    })
  }

  async getAttachment(accountId: string, path: string, uid: number, index: number) {
    return this.withMailbox(accountId, path, async (c) => {
      const key = `${accountId}|${path}|${c.mailbox && c.mailbox.uidValidity}|${uid}`
      let source = this.lastSource?.key === key ? this.lastSource.source : undefined
      if (!source) {
        const m = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
        if (!m || !m.source) throw new Error('Message not found.')
        source = m.source
      }
      const p = await simpleParser(source)
      const a = p.attachments[index]
      if (!a) throw new Error('Attachment not found.')
      return { filename: a.filename || 'attachment', content: a.content }
    })
  }

  async setFlags(
    accountId: string,
    path: string,
    uids: number[],
    flags: { seen?: boolean; flagged?: boolean }
  ): Promise<void> {
    await this.withMailbox(accountId, path, async (c) => {
      const add: string[] = []
      const remove: string[] = []
      if (flags.seen !== undefined) (flags.seen ? add : remove).push('\\Seen')
      if (flags.flagged !== undefined) (flags.flagged ? add : remove).push('\\Flagged')
      const range = uids.join(',')
      if (add.length) await c.messageFlagsAdd(range, add, { uid: true })
      if (remove.length) await c.messageFlagsRemove(range, remove, { uid: true })
    })
  }

  async markAllRead(accountId: string, path: string): Promise<void> {
    await this.withMailbox(accountId, path, async (c) => {
      if (c.mailbox && c.mailbox.exists) await c.messageFlagsAdd({ seen: false }, ['\\Seen'])
    })
  }

  async move(accountId: string, path: string, uids: number[], target: MoveTarget): Promise<MoveResult | null> {
    let dest = target === 'inbox' ? this.inboxOf(accountId) : await this.specialPath(accountId, target)
    // Gmail has no Archive folder; archiving there means "All Mail".
    if (!dest && target === 'archive') dest = await this.specialPath(accountId, 'all')
    if (!dest) throw new Error(`This account has no ${SPECIAL_NAME[target].toLowerCase()} mailbox.`)

    if (dest === path) {
      if (target === 'trash') {
        await this.withMailbox(accountId, path, (c) => c.messageDelete(uids.join(','), { uid: true }))
      }
      return null
    }
    return this.moveTo(accountId, path, uids, dest)
  }

  async moveTo(accountId: string, path: string, uids: number[], dest: string): Promise<MoveResult | null> {
    if (dest === path) return null
    return this.withMailbox(accountId, path, async (c) => {
      const res = await c.messageMove(uids.join(','), dest, { uid: true })
      if (!res) throw new Error('The server refused to move the message.')
      const moved = uids.map((u) => res.uidMap?.get(u)).filter((u): u is number => u !== undefined)
      return moved.length === uids.length ? { path: res.destination, uids: moved } : null
    })
  }

  // ---------- Snooze ----------

  async snooze(accountId: string, path: string, uids: number[], until: string): Promise<void> {
    let folder = await this.specialPath(accountId, 'snoozed')
    if (!folder) {
      const c = await this.client(accountId)
      folder = (await c.mailboxCreate(SNOOZE_FOLDER)).path
      await this.listMailboxes(accountId)
    }
    const ids = await this.withMailbox(accountId, path, async (c) => {
      const rows = await c.fetchAll(uids.join(','), { uid: true, envelope: true }, { uid: true })
      return rows.map((r) => r.envelope?.messageId).filter((id): id is string => !!id)
    })
    if (ids.length < uids.length) throw new Error('Messages without a Message-ID cannot be snoozed.')
    await this.moveTo(accountId, path, uids, folder)
    this.store.setSnoozed([
      ...this.store.listSnoozed(),
      ...ids.map((messageId) => ({ accountId, messageId, until }))
    ])
  }

  /** Moves snoozed mail that is due back to the inbox, unread. */
  async wakeSnoozed(now = Date.now()): Promise<void> {
    const due = this.store.listSnoozed().filter((s) => Date.parse(s.until) <= now)
    if (!due.length) return
    const done = new Set<Snoozed>()
    const enabled = new Set(this.store.listAccounts().filter((a) => a.enabled).map((a) => a.id))
    for (const accountId of new Set(due.map((s) => s.accountId))) {
      const mine = due.filter((s) => s.accountId === accountId)
      if (!enabled.has(accountId)) continue
      try {
        const folder = await this.specialPath(accountId, 'snoozed')
        if (!folder) {
          mine.forEach((s) => done.add(s))
          continue
        }
        const inbox = this.inboxOf(accountId)
        await this.withMailbox(accountId, folder, async (c) => {
          for (const s of mine) {
            const uids = (await c.search({ header: { 'message-id': s.messageId } }, { uid: true })) || []
            if (uids.length) {
              await c.messageFlagsRemove(uids.join(','), ['\\Seen'], { uid: true })
              await c.messageMove(uids.join(','), inbox, { uid: true })
            }
            done.add(s)
          }
        })
        this.emit({ accountId, path: inbox })
        this.emit({ accountId, path: folder })
      } catch (err) {
        console.error('[imap] could not wake snoozed mail:', err instanceof Error ? err.message : err)
      }
    }
    if (done.size) this.store.setSnoozed(this.store.listSnoozed().filter((s) => !done.has(s)))
  }

  // ---------- Contacts ----------

  /** Recipients of recent sent mail and senders of recent inbox mail, from envelopes only. */
  async collectAddresses(accountId: string, limit = 1000): Promise<{ sent: Address[]; received: Address[] }> {
    const scan = (path: string, pick: (e: MessageEnvelopeObject) => MessageAddressObject[] | undefined) =>
      this.withMailbox(accountId, path, async (c) => {
        const mb = c.mailbox
        if (!mb || !mb.exists) return []
        const rows = await c.fetchAll(`${Math.max(1, mb.exists - limit + 1)}:*`, { envelope: true })
        return rows.flatMap((r) =>
          (r.envelope ? (pick(r.envelope) ?? []) : [])
            .filter((a) => a.address)
            .map((a) => ({ name: a.name ?? '', email: a.address! }))
        )
      })

    const sentPath = await this.specialPath(accountId, 'sent')
    const sent = sentPath ? await scan(sentPath, (e) => [...(e.to ?? []), ...(e.cc ?? []), ...(e.bcc ?? [])]) : []
    const received = await scan(this.inboxOf(accountId), (e) => e.from)
    return { sent, received }
  }

  // ---------- Sending and drafts ----------

  /** One Message-ID and Date so the sent message and its saved copy match. */
  private mailOptions(acc: Account, input: SendInput): Mail.Options {
    const inline = input.html ? inlineImages(input.html) : null
    return {
      from: { name: acc.name, address: acc.email },
      to: input.to || undefined,
      cc: input.cc || undefined,
      bcc: input.bcc || undefined,
      subject: input.subject,
      text: input.text,
      html: inline?.html || undefined,
      attachments: [
        ...(input.attachments ?? []).map((a) => ({ filename: a.filename, path: a.path })),
        ...(inline?.parts ?? [])
      ],
      inReplyTo: input.inReplyTo,
      references: input.references,
      messageId: `<${randomUUID()}@${acc.email.split('@')[1] ?? 'winmail'}>`,
      date: new Date(),
      // Attachments are local files only; never let a path fetch a URL.
      disableUrlAccess: true
    }
  }

  /** `delivered` runs as soon as the server has accepted the message, before the Sent copy and draft clean-up. */
  async send(input: SendInput, delivered?: () => void): Promise<void> {
    const acc = this.store.getAccount(input.accountId)
    const creds = await this.creds(acc)
    const mail = this.mailOptions(acc, input)
    const raw = await compile(mail, false)
    const transport = smtpTransport(creds)
    try {
      await transport.sendMail({ ...mail, raw })
    } catch (err) {
      if (isAuthError(err)) this.tokens.forget(acc.id)
      throw new Error(friendlyError(err, acc.auth === 'oauth'))
    } finally {
      transport.close()
    }
    delivered?.()

    if (!getProvider(acc.provider).serverSavesSent) {
      const sent = await this.specialPath(acc.id, 'sent')
      if (sent) {
        try {
          const copy = input.bcc ? await compile(mail, true) : raw
          await this.withUpload(acc.id, (c) => c.append(sent, copy, ['\\Seen']))
        } catch (err) {
          console.error('Could not save to Sent:', err)
        }
      }
    }
    if (input.draftUid) await this.removeDrafts(acc.id, [input.draftUid], true)
  }

  async saveDraft(input: SendInput): Promise<number | null> {
    const acc = this.store.getAccount(input.accountId)
    const drafts = await this.specialPath(acc.id, 'drafts')
    if (!drafts) {
      throw new Error(
        acc.provider === 'gmail'
          ? "Drafts can't be saved: turn on \"Show in IMAP\" for Drafts in Gmail's settings (Labels)."
          : "Drafts can't be saved: this account has no Drafts folder."
      )
    }
    const mail = this.mailOptions(acc, input)
    const raw = await compile(mail, true)
    const uid = await this.withUpload(acc.id, async (c) => {
      const res = await c.append(drafts, raw, ['\\Draft', '\\Seen'])
      if (res && res.uid) return res.uid
      // Without UIDPLUS the server doesn't say; find the copy by the Message-ID it was just given.
      // The message is stored by now, so a failed lookup must not fail the save (a retry would add a copy).
      try {
        const lock = await c.getMailboxLock(drafts)
        try {
          const found = (await c.search({ header: { 'message-id': String(mail.messageId) } }, { uid: true })) || []
          return found.length ? Math.max(...found) : null
        } finally {
          lock.release()
        }
      } catch (err) {
        console.error('[imap] could not look up the saved draft:', err instanceof Error ? err.message : err)
        return null
      }
    })
    if (input.draftUid) await this.removeDrafts(acc.id, [input.draftUid], true)
    return uid
  }

  async deleteDraft(accountId: string, uid: number): Promise<void> {
    await this.removeDrafts(accountId, [uid], false)
  }

  /**
   * Deletes draft versions, plus any earlier ones that failed to go. On Gmail a plain expunge
   * only removes the Drafts label and the old version stays in All Mail, so drafts take a detour
   * through Trash and are deleted there. `quiet` keeps failures for the next try instead of throwing.
   */
  private async removeDrafts(accountId: string, uids: number[], quiet: boolean): Promise<void> {
    const acc = this.store.listAccounts().find((a) => a.id === accountId)
    if (!acc) {
      this.staleDrafts.delete(accountId)
      return
    }
    const all = [...new Set([...uids, ...(this.staleDrafts.get(accountId) ?? [])])]
    if (!acc.enabled) {
      // Never connect for a disabled account; try again once it is back.
      this.staleDrafts.set(accountId, new Set(all))
      return
    }
    try {
      const drafts = await this.specialPath(accountId, 'drafts')
      if (!drafts || !all.length) return
      const trash = acc.provider === 'gmail' ? await this.specialPath(accountId, 'trash') : undefined
      await this.withUpload(accountId, async (c) => {
        let inTrash: number[] = []
        const lock = await c.getMailboxLock(drafts)
        try {
          if (trash) {
            const res = await c.messageMove(all.join(','), trash, { uid: true })
            if (!res) throw new Error('The server refused to remove the old draft.')
            inTrash = all.map((u) => res.uidMap?.get(u)).filter((u): u is number => u !== undefined)
          } else if (c.capabilities.has('UIDPLUS')) {
            if (!(await c.messageDelete(all.join(','), { uid: true }))) {
              throw new Error('The server refused to remove the old draft.')
            }
          } else {
            // Plain EXPUNGE would also remove messages other apps flagged but kept; expunge only when all flagged are ours.
            await c.messageFlagsAdd(all.join(','), ['\\Deleted'], { uid: true })
            const flagged = (await c.search({ deleted: true }, { uid: true })) || []
            if (flagged.every((u) => all.includes(u))) await c.messageDelete(all.join(','), { uid: true })
          }
        } finally {
          // One lock at a time per connection: Trash is locked only after Drafts is released.
          lock.release()
        }
        if (trash && inTrash.length) {
          const t = await c.getMailboxLock(trash)
          try {
            await c.messageDelete(inTrash.join(','), { uid: true })
          } finally {
            t.release()
          }
        }
      })
      this.staleDrafts.delete(accountId)
    } catch (err) {
      this.staleDrafts.set(accountId, new Set(all))
      if (!quiet) throw err
      console.error('[imap] could not remove old draft:', err instanceof Error ? err.message : err)
    }
  }

  /** A saved message as Compose input; attachments go to temporary files. */
  async openDraft(accountId: string, path: string, uid: number): Promise<SendInput> {
    const source = await this.withMailbox(accountId, path, async (c) => {
      const m = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      if (!m || !m.source) throw new Error('Message not found. It may have been moved.')
      return m.source
    })
    const p = await simpleParser(source)
    const dir = join(TEMP_ROOT, randomUUID())
    const attachments: OutgoingAttachment[] = []
    for (const [i, a] of p.attachments.entries()) {
      if (a.related) continue
      const filename = basename(a.filename || 'attachment')
      const file = join(dir, String(i), filename)
      await mkdir(join(dir, String(i)), { recursive: true })
      await writeFile(file, a.content)
      attachments.push({ path: file, filename, size: a.size })
    }
    const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : []
    const isDraft = path === (await this.specialPath(accountId, 'drafts'))
    return {
      accountId,
      to: formatAddresses(parsedAddresses(p.to)),
      cc: formatAddresses(parsedAddresses(p.cc)),
      bcc: formatAddresses(parsedAddresses(p.bcc)),
      subject: p.subject ?? '',
      text: p.text ?? '',
      html: p.html || undefined,
      attachments,
      inReplyTo: p.inReplyTo,
      references: refs,
      draftUid: isDraft ? uid : undefined
    }
  }
}
