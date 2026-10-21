import type {
  Account,
  MessageDetail,
  MessageSummary,
  QueuedSend,
  ScheduledInfo,
  SendInput,
  Settings,
  SpecialUse
} from '@shared/types'
import { api } from '../api'
import { dismiss, toast } from '../toasts'
import { parseList } from './addresses'
import * as autosave from './autosave'
import { blockingProblem, confirmations } from './checks'
import { maxOpen } from './dockLayout'
import { insertHtml, insertText } from './editorCommands'
import { commitTyping, toInput } from './input'
import { htmlToPlain } from './outgoing'
import { forwardBlock, isForwardBlock, replyQuote, replyRecipients, splitDraft, subjectFor } from './quote'
import { IS_POPOUT, type PopoutMessage, type PopoutPayload } from './popout'
import { formatWhen } from './schedule'
import { sanitizeHtml, textToHtml } from './sanitize'
import {
  allSessions,
  editorOf,
  flush,
  getSession,
  putSession,
  removeSession,
  updateSession,
  type ComposeAttachment,
  type ComposeSession,
  type Confirm,
  type ReplyMode
} from './sessions'
import { sameMarkup, signatureBlock } from './signature'

/** What Compose needs from the rest of the app; App sets it on every render. */
export interface ComposeEnv {
  /** Enabled accounts. */
  accounts: Account[]
  settings: Settings
  /** The account of the mailbox on screen, or the first one. */
  defaultAccountId(): string
  /** Reloads the message list if it shows that account's mailbox of that kind. */
  refreshIfShowing(accountId: string, use: SpecialUse): void
  selectMailbox(accountId: string, use: SpecialUse): void
  setSettings(s: Settings): void
  /** Focus back to the message list, after a card closes. */
  focusList(): void
  selectedKey(): string | null
}

let env: ComposeEnv

export function setComposeEnv(e: ComposeEnv): void {
  env = e
}

/** Replies open under the message; the reading pane renders them. */
const REPLY_HOST: ComposeSession['host'] = 'inline'

/** Pasted images up to this size go into the text; bigger ones are attached. */
const INLINE_IMAGE_BYTES = 5 * 1024 * 1024
const INLINE_TOTAL_BYTES = 10 * 1024 * 1024
const ATTACHMENT_WAIT_MS = 10_000

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const newId = () => crypto.randomUUID()

function blank(accountId: string, patch: Partial<ComposeSession>): ComposeSession {
  const now = Date.now()
  return {
    id: newId(),
    host: 'docked',
    minimized: false,
    expanded: false,
    accountId,
    to: [],
    cc: [],
    bcc: [],
    typing: { to: '', cc: '', bcc: '' },
    showCc: false,
    showBcc: false,
    subject: '',
    body: '<div><br></div>',
    plain: false,
    quote: null,
    attachments: [],
    dirty: false,
    status: 'idle',
    openedAt: now,
    activeAt: now,
    focus: 'to',
    revision: 0,
    signature: null,
    ...patch
  }
}

const signatureText = (accountId: string) => env.accounts.find((a) => a.id === accountId)?.signature?.trim() ?? ''

/** The empty body a new message or reply starts with: room to type, then the signature. */
function startBody(accountId: string, plain: boolean, isNew: boolean): Pick<ComposeSession, 'body' | 'signature'> {
  const sig = signatureText(accountId)
  if (plain) return { body: sig ? `\n\n${isNew ? '-- \n' : ''}${sig}` : '', signature: null }
  if (!sig) return { body: '<div><br></div>', signature: null }
  const html = signatureBlock(sig, isNew)
  return { body: `<div><br></div><div><br></div>${html}`, signature: { accountId, html } }
}

// ---------- Cards ----------

/** Brings a card forward: restores it, ends any other full-screen card, and minimizes the oldest when too many are open. */
export function activate(id: string): void {
  const s = getSession(id)
  if (!s || s.hidden) return
  updateSession(id, { minimized: false, activeAt: Date.now() })
  if (s.host !== 'docked') return
  for (const o of allSessions()) if (o.id !== id && o.expanded) updateSession(o.id, { expanded: false })
  const open = allSessions()
    .filter((o) => o.host === 'docked' && !o.minimized && !o.hidden && !o.expanded)
    .sort((a, b) => b.activeAt - a.activeAt)
  for (const o of open.slice(maxOpen(window.innerWidth))) if (o.id !== id) updateSession(o.id, { minimized: true })
}

/** Marks a card as the one in use without moving anything, e.g. when it gets focus. */
export function touchActive(id: string): void {
  const s = getSession(id)
  const latest = Math.max(0, ...allSessions().map((o) => o.activeAt))
  if (s && s.activeAt < latest) updateSession(id, { activeAt: Date.now() })
}

export function newMessage(): string | null {
  const accountId = env.defaultAccountId()
  if (!accountId) return null
  const plain = env.settings.composeFormat === 'plain'
  const s = blank(accountId, { plain, ...startBody(accountId, plain, true) })
  putSession(s)
  activate(s.id)
  return s.id
}

export function minimize(id: string, on = true): void {
  if (!on) return activate(id)
  flush(id)
  updateSession(id, { minimized: true, expanded: false })
  void autosave.saveNow(id)
  env.focusList()
}

export function expand(id: string, on: boolean): void {
  if (on) activate(id)
  updateSession(id, { expanded: on, minimized: false })
  // The header button that was clicked keeps focus otherwise, and keys would miss the card's handler.
  requestAnimationFrame(() => editorOf(id)?.root()?.focus())
}

/** Moves an inline reply into a docked card, e.g. to edit its subject. */
export function popOut(id: string, focus: ComposeSession['focus'] = 'body'): void {
  flush(id)
  updateSession(id, { host: 'docked', minimized: false, focus })
  activate(id)
  void autosave.saveNow(id)
}

/** Save & close: an edited message is saved to Drafts first; an untouched one just goes. */
export async function close(id: string, force = false): Promise<void> {
  flush(id)
  const s = getSession(id)
  if (!s || s.hidden) return
  if (!s.dirty || force) {
    autosave.forget(id)
    removeSession(id)
    env.focusList()
    return
  }
  if (s.status === 'unsupported') {
    updateSession(id, {
      confirm: {
        kind: 'close-unsaved',
        text: "This account can't keep drafts, so the message would be lost. Close it anyway?",
        ok: 'Close'
      }
    })
    return
  }
  updateSession(id, { hidden: 'closing' })
  env.focusList()
  if (await autosave.saveNow(id)) {
    autosave.forget(id)
    removeSession(id)
  } else {
    updateSession(id, { hidden: undefined, host: 'docked', minimized: true })
    autosave.writeRecoveryNow()
    toast({ text: "The draft couldn't be saved, so it stays open.", tone: 'error' })
  }
}

/** Deletes the draft, with Undo for a few seconds. */
export async function discard(id: string): Promise<void> {
  flush(id)
  const s = getSession(id)
  if (!s || s.hidden) return
  autosave.cancel(id)
  removeSession(id)
  env.focusList()
  await autosave.settle(id)
  const uid = autosave.lastUid(id) ?? s.draftUid
  autosave.forget(id)
  if (uid) api.deleteDraft(s.accountId, uid).catch((e) => toast({ text: `Couldn't delete the draft: ${errText(e)}`, tone: 'error' }))
  if (!s.dirty && !uid) return
  // A pop-out closes with its card, so the main window shows the toast.
  if (IS_POPOUT) tell({ type: 'discarded', session: s })
  else discardedToast(s)
}

function discardedToast(s: ComposeSession): void {
  toast({
    text: 'Draft discarded',
    duration: 8000,
    actions: [
      {
        label: 'Undo',
        run: () => {
          putSession({ ...s, draftUid: undefined, hidden: undefined, revision: s.revision + 1, activeAt: Date.now() })
          if (s.host === 'docked') activate(s.id)
          autosave.touch(s.id)
        }
      }
    ]
  })
}

/** Next open card or inline reply, for Ctrl+. */
export function focusNext(): void {
  const open = allSessions()
    .filter((s) => !s.hidden && !s.minimized)
    .sort((a, b) => a.openedAt - b.openedAt)
  if (!open.length) return
  const current = (document.activeElement as HTMLElement | null)?.closest('[data-compose]')?.getAttribute('data-compose')
  const next = open[(open.findIndex((s) => s.id === current) + 1) % open.length]!
  activate(next.id)
  editorOf(next.id)?.focus('end')
}

// ---------- From and signature ----------

/** Switches the sending account: signature, contacts and the Drafts folder the copy lives in. */
export function changeFrom(id: string, accountId: string): void {
  flush(id)
  const s = getSession(id)
  if (!s || s.accountId === accountId) return
  const old = { accountId: s.accountId, uid: autosave.lastUid(id) ?? s.draftUid }
  updateSession(id, { accountId, draftUid: undefined, signature: swapSignature(s, accountId) })
  autosave.resetServerCopy(id)
  autosave.touch(id)
  void autosave.saveNow(id).then(() => {
    if (old.uid) api.deleteDraft(old.accountId, old.uid).catch((e) => console.error('Could not delete old draft:', e))
  })
}

/** The signature follows the account, unless the user edited it. Changes the editor directly. */
function swapSignature(s: ComposeSession, accountId: string): ComposeSession['signature'] {
  const root = editorOf(s.id)?.root()
  if (s.plain || !root) return s.signature
  const el = root.querySelector(':scope > .winmail-signature')
  const sig = signatureText(accountId)
  const html = sig ? signatureBlock(sig, !s.reply) : ''
  if (el) {
    if (!s.signature || !sameMarkup(el.outerHTML, s.signature.html)) return s.signature // edited: leave it
    if (html) el.outerHTML = html
    else el.remove()
  } else if (html && !s.dirty) {
    // No signature yet and nothing written: the new account's goes in.
    const forward = Array.from(root.children).find(isForwardBlock)
    if (forward) forward.insertAdjacentHTML('beforebegin', html)
    else root.insertAdjacentHTML('beforeend', html)
  } else return s.signature
  return html ? { accountId, html } : null
}

/** Footer pen: puts the signature in, or takes it out. */
export function toggleSignature(id: string): void {
  const s = getSession(id)
  const root = editorOf(id)?.root()
  if (!s || s.plain || !root) return
  const el = root.querySelector(':scope > .winmail-signature')
  if (el) {
    el.remove()
    updateSession(id, { signature: null })
  } else {
    const sig = signatureText(s.accountId)
    if (!sig) return
    const html = signatureBlock(sig, !s.reply)
    const forward = Array.from(root.children).find(isForwardBlock)
    if (forward) forward.insertAdjacentHTML('beforebegin', html)
    else root.insertAdjacentHTML('beforeend', html)
    updateSession(id, { signature: { accountId: s.accountId, html } })
  }
  autosave.touch(id)
}

// ---------- Plain text ----------

/** More > Plain text mode. Going plain drops formatting, so the card asks first (see ComposeFooter). */
export function setPlain(id: string, plain: boolean): void {
  flush(id)
  const s = getSession(id)
  if (!s || s.plain === plain) return
  const root = editorOf(id)?.root()
  const body = plain ? (root?.innerText ?? '') : textToHtml(s.body)
  updateSession(id, { plain, body, signature: null, revision: s.revision + 1 })
  autosave.touch(id)
  // Changing the editor's mode drops its focus.
  requestAnimationFrame(() => editorOf(id)?.focus('end'))
  if (plain) toast('Formatting removed. Turn Plain text mode off to format again.')
}

// ---------- Attachments ----------

let attachSeq = 0
const attachmentId = () => `a${++attachSeq}`

function addAttachments(id: string, list: Omit<ComposeAttachment, 'id'>[]): void {
  if (!list.length) return
  updateSession(id, (s) => ({ attachments: [...s.attachments, ...list.map((a) => ({ ...a, id: attachmentId() }))] }))
  autosave.touch(id)
}

export async function pickAttachments(id: string): Promise<void> {
  try {
    addAttachments(id, await api.pickAttachments())
  } catch (e) {
    toast({ text: errText(e), tone: 'error' })
  }
}

/** Files dropped on a card, or copied files pasted into it. */
export async function addFiles(id: string, files: File[]): Promise<void> {
  if (!files.length) return
  try {
    addAttachments(id, await api.addDroppedFiles(files))
  } catch (e) {
    toast({ text: errText(e), tone: 'error' })
  }
}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

/** Pasted images go into the text when small enough, otherwise they are attached. */
export async function pasteImages(id: string, files: File[]): Promise<void> {
  const s = getSession(id)
  if (!s) return
  let inline = (editorOf(id)?.read() ?? s.body).length
  for (const file of files) {
    if (!s.plain && file.type.startsWith('image/') && file.size <= INLINE_IMAGE_BYTES && inline + file.size * 1.4 <= INLINE_TOTAL_BYTES) {
      const url = await readDataUrl(file)
      inline += url.length
      insertHtml(`<img src="${url}" alt="${file.name ? file.name.replace(/"/g, '') : 'Pasted image'}">`)
      continue
    }
    try {
      const saved = await (file.type.startsWith('image/') ? api.saveClipboardImage(file) : api.addDroppedFiles([file]).then((l) => l[0]!))
      addAttachments(id, [saved])
    } catch (e) {
      toast({ text: errText(e), tone: 'error' })
    }
  }
  autosave.touch(id)
}

export function removeAttachment(id: string, attachmentKey: string): void {
  updateSession(id, (s) => ({ attachments: s.attachments.filter((a) => a.id !== attachmentKey) }))
  autosave.touch(id)
}

// ---------- Replies ----------

const ownAddresses = () => new Set(env.accounts.map((a) => a.email.toLowerCase()))

/** Would reply all add anyone beyond plain reply? Decides whether the button shows. */
export function canReplyAll(summary: MessageSummary, detail: MessageDetail | null): boolean {
  const own = ownAddresses()
  const one = replyRecipients('reply', summary, detail, own)
  const all = replyRecipients('all', summary, detail, own)
  return all.to.length + all.cc.length > one.to.length + one.cc.length
}

function replyParts(mode: ReplyMode, summary: MessageSummary, detail: MessageDetail | null, allowRemote: boolean) {
  const recipients =
    mode === 'forward' ? { to: [], cc: [] } : replyRecipients(mode, summary, detail, ownAddresses())
  const refs = detail ? [...detail.references, ...(detail.messageId ? [detail.messageId] : [])] : summary.parents ?? []
  return {
    ...recipients,
    showCc: recipients.cc.length > 0,
    subject: subjectFor(mode, summary.subject),
    quote: mode === 'forward' ? null : replyQuote(summary, detail, allowRemote),
    forward: mode === 'forward' ? forwardBlock(summary, detail, allowRemote) : '',
    inReplyTo: mode === 'forward' ? undefined : (detail?.messageId ?? summary.messageId ?? undefined),
    references: mode === 'forward' ? undefined : refs.length ? refs : undefined
  }
}

/** Opens a reply, reply all or forward of a message, or brings back the one already open for it. */
export async function reply(
  mode: ReplyMode,
  summary: MessageSummary,
  detail: MessageDetail | null,
  allowRemote: boolean,
  host: ComposeSession['host'] = REPLY_HOST
): Promise<string | null> {
  const existing = allSessions().find((s) => s.reply?.key === summary.key && !s.hidden)
  if (existing) {
    if (existing.reply!.mode !== mode) switchReplyMode(existing.id, mode)
    activate(existing.id)
    editorOf(existing.id)?.focus('start')
    return existing.id
  }
  // Leave any other inline reply first: there is one slot under the message.
  if (host === 'inline') for (const o of allSessions()) if (o.host === 'inline' && !o.hidden) leaveInline(o.id)

  const src = detail ?? (await api.getMessage(summary.accountId, summary.mailbox, summary.uid, summary.uidValidity).catch(() => null))
  const accountId = env.accounts.some((a) => a.id === summary.accountId) ? summary.accountId : env.defaultAccountId()
  if (!accountId) return null
  const parts = replyParts(mode, summary, src, allowRemote)
  const plain = env.settings.composeFormat === 'plain'
  const start = startBody(accountId, plain, false)
  const s = blank(accountId, {
    host,
    to: parts.to,
    cc: parts.cc,
    showCc: parts.showCc,
    subject: parts.subject,
    plain,
    body: plain ? start.body + (parts.forward ? `\n\n${htmlToPlain(parts.forward)}` : '') : start.body + parts.forward,
    signature: start.signature,
    quote: parts.quote,
    inReplyTo: parts.inReplyTo,
    references: parts.references,
    reply: { key: summary.key, mode, summary, detail: src, allowRemote },
    focus: mode === 'forward' ? 'to' : 'body'
  })
  putSession(s)
  activate(s.id)
  if (mode === 'forward' && summary.hasAttachments) void attachOriginals(s.id, summary)
  return s.id
}

/** A forward carries the original's attachments, as Gmail's does. */
async function attachOriginals(id: string, summary: MessageSummary): Promise<void> {
  const placeholder: ComposeAttachment = {
    id: attachmentId(),
    path: '',
    filename: 'Attachments…',
    size: 0,
    pending: true,
    fromOriginal: true
  }
  updateSession(id, (s) => ({ attachments: [...s.attachments, placeholder] }))
  try {
    const original = await api.openDraft(summary.accountId, summary.mailbox, summary.uid, summary.uidValidity)
    const files = (original.attachments ?? []).map((a) => ({ ...a, id: attachmentId(), fromOriginal: true }))
    updateSession(id, (s) => ({ attachments: [...s.attachments.filter((a) => a.id !== placeholder.id), ...files] }))
  } catch (e) {
    updateSession(id, (s) => ({ attachments: s.attachments.filter((a) => a.id !== placeholder.id) }))
    toast({ text: `Couldn't add the original attachments: ${errText(e)}`, tone: 'error' })
  }
}

/** Reply-type menu: rebuilds recipients, subject and quote, and keeps what the user wrote. */
export function switchReplyMode(id: string, mode: ReplyMode): void {
  flush(id)
  const s = getSession(id)
  if (!s?.reply || s.reply.mode === mode) return
  const { summary, detail, allowRemote } = s.reply
  const parts = replyParts(mode, summary, detail, allowRemote)
  const root = editorOf(id)?.root()
  let body = s.body
  if (root && !s.plain) {
    Array.from(root.children).filter(isForwardBlock).forEach((el) => el.remove())
    if (parts.forward) root.insertAdjacentHTML('beforeend', parts.forward)
    body = root.innerHTML
  }
  updateSession(id, {
    reply: { ...s.reply, mode },
    to: mode === 'forward' ? [] : parts.to,
    cc: mode === 'forward' ? [] : parts.cc,
    showCc: parts.showCc,
    subject: parts.subject,
    quote: parts.quote,
    inReplyTo: parts.inReplyTo,
    references: parts.references,
    body,
    attachments: s.attachments.filter((a) => !a.fromOriginal)
  })
  if (mode === 'forward' && summary.hasAttachments) void attachOriginals(id, summary)
  if (s.dirty) autosave.touch(id)
}

/** "···": shows the quote in the editor, after the signature, for editing. It can't fold again. */
export function unfoldQuote(id: string): void {
  const s = getSession(id)
  const root = editorOf(id)?.root()
  if (!s?.quote || !root) return
  root.insertAdjacentHTML('beforeend', s.quote)
  updateSession(id, { quote: null, body: root.innerHTML })
  autosave.touch(id)
}

/**
 * The reading pane moved on from an inline reply: an edited one is saved and parked in the dock,
 * minimized; an untouched one simply goes.
 */
export function leaveInline(id: string): void {
  flush(id)
  const s = getSession(id)
  if (!s || s.host !== 'inline' || s.hidden) return
  if (!s.dirty) {
    autosave.forget(id)
    removeSession(id)
    return
  }
  updateSession(id, { host: 'docked', minimized: true })
  void autosave.saveNow(id)
}

// ---------- Drafts ----------

/** A session from a saved message: a draft reopened from Drafts, a failed send, an undone one. */
function fromInput(input: SendInput, patch: Partial<ComposeSession>): ComposeSession {
  const html = input.html ? sanitizeHtml(input.html) : null
  const split = html ? splitDraft(html) : { body: input.text, quote: null }
  const accountId = env.accounts.some((a) => a.id === input.accountId) ? input.accountId : env.defaultAccountId()
  const to = parseList(input.to)
  const cc = parseList(input.cc ?? '')
  const bcc = parseList(input.bcc ?? '')
  return blank(accountId, {
    to,
    cc,
    bcc,
    showCc: cc.length > 0,
    showBcc: bcc.length > 0,
    subject: input.subject,
    plain: !html,
    body: split.body,
    quote: split.quote,
    attachments: (input.attachments ?? []).map((a) => ({ ...a, id: attachmentId() })),
    inReplyTo: input.inReplyTo,
    references: input.references,
    draftUid: accountId === input.accountId ? input.draftUid : undefined,
    focus: to.length ? 'body' : 'to',
    ...patch
  })
}

/** Opens a message from a Drafts mailbox for editing, or the card that already has it. */
export async function openFromDrafts(m: MessageSummary): Promise<void> {
  const open = allSessions().find((s) => s.accountId === m.accountId && s.draftUid === m.uid)
  if (open) {
    if (!open.hidden) activate(open.id)
    return
  }
  try {
    const s = fromInput(await api.openDraft(m.accountId, m.mailbox, m.uid, m.uidValidity), {})
    putSession(s)
    activate(s.id)
  } catch (e) {
    toast({ text: errText(e), tone: 'error' })
  }
}

/** Opens a card with a prepared message, e.g. a cancelled scheduled send or a mailto unsubscribe. */
export function openInput(input: SendInput, dirty = true): void {
  const s = fromInput(input, { dirty })
  putSession(s)
  activate(s.id)
}

/** Brings back drafts a crash or an offline close left behind, minimized. */
export async function restoreRecovered(): Promise<void> {
  // Pop-outs still open keep their own copies.
  const live = await api.listPopouts().catch(() => [])
  const list = autosave.takeRecovered(live)
  for (const r of list) {
    if (getSession(r.id)) continue
    const accountId = env.accounts.some((a) => a.id === r.accountId) ? r.accountId : env.defaultAccountId()
    if (!accountId) continue
    const { savedAt: _savedAt, ...rest } = r
    putSession(blank(accountId, { ...rest, accountId, minimized: true, dirty: true }))
    autosave.touch(r.id)
  }
  if (list.length) toast(`Recovered ${list.length === 1 ? 'an unsent message' : `${list.length} unsent messages`}`)
}

/** Saves everything before the window closes; the recovery copy covers whatever doesn't make it. */
export async function flushAll(): Promise<void> {
  for (const s of allSessions()) flush(s.id)
  autosave.writeRecoveryNow()
  const dirty = allSessions().filter((s) => s.dirty && !s.hidden)
  const deadline = new Promise((resolve) => setTimeout(resolve, 8000))
  await Promise.race([Promise.all(dirty.map((s) => autosave.saveNow(s.id))), deadline])
  autosave.writeRecoveryNow()
}

// ---------- Sending ----------

/** Outbox items this window queued: which card they came from and their toast. */
const queued = new Map<string, { sessionId: string; toastId: number; accountId: string }>()

/** Text the user wrote, without signature and quote, for the send checks. */
export function ownText(id: string): string {
  const s = getSession(id)
  const root = editorOf(id)?.root()
  if (!s) return ''
  if (s.plain || !root) return s.body
  const copy = root.cloneNode(true) as HTMLElement
  copy.querySelectorAll('.winmail-signature, .gmail_quote').forEach((el) => el.remove())
  return copy.innerText
}

async function waitForAttachments(id: string): Promise<boolean> {
  const until = Date.now() + ATTACHMENT_WAIT_MS
  while (getSession(id)?.attachments.some((a) => a.pending)) {
    if (Date.now() > until) return false
    await new Promise((r) => setTimeout(r, 200))
  }
  return true
}

/** Cards in the middle of send(), so a double Ctrl+Enter can't queue the message twice. */
const sendingNow = new Set<string>()

/** Checks, then queues the message; it goes out after the undo delay. `skip` answers questions already asked. */
export async function send(id: string, skip: Confirm['kind'][] = []): Promise<void> {
  if (sendingNow.has(id)) return
  sendingNow.add(id)
  try {
    flush(id)
    let s = commitTyping(id)
    if (!s || s.hidden) return
    updateSession(id, { banner: undefined, confirm: undefined })
    if (s.attachments.some((a) => a.pending)) {
      updateSession(id, { banner: { tone: 'info', text: 'Waiting for attachments…' } })
      if (!(await waitForAttachments(id))) {
        updateSession(id, { banner: { tone: 'error', text: "Some attachments couldn't be loaded. Remove them and try again." } })
        return
      }
      updateSession(id, { banner: undefined })
      s = getSession(id)!
    }
    const account = env.accounts.find((a) => a.id === s!.accountId)
    if (!account) {
      updateSession(id, { banner: { tone: 'error', text: 'Choose an account to send from.' } })
      return
    }
    const problem = blockingProblem(s, account)
    if (problem) {
      updateSession(id, { banner: { tone: 'error', text: problem } })
      return
    }
    const ask = confirmations(s, ownText(id)).find((c) => !skip.includes(c.kind))
    if (ask) {
      updateSession(id, { confirm: ask })
      return
    }

    autosave.cancel(id)
    await autosave.settle(id)
    s = getSession(id)!
    const input = toInput(s)
    updateSession(id, { hidden: 'sending' })
    env.focusList()
    try {
      const q = await api.queueSend(input)
      if (IS_POPOUT) {
        // The main window keeps the Undo toast and the sent notice; this window is done.
        tell({ type: 'queued', queued: q, accountId: s.accountId })
        autosave.forget(id)
        removeSession(id)
        return
      }
      trackQueued(q, id, s.accountId)
      autosave.writeRecoveryNow()
    } catch (e) {
      updateSession(id, { hidden: undefined, banner: { tone: 'error', text: errText(e) } })
    }
  } finally {
    sendingNow.delete(id)
  }
}

/** The "Sending…" toast with Undo, and the link from the outbox item to its card (none for a pop-out's). */
function trackQueued(q: QueuedSend, sessionId: string, accountId: string): void {
  const undoable = Date.parse(q.sendAt) - Date.now() > 500
  const toastId = toast({
    text: 'Sending…',
    busy: true,
    duration: 0,
    actions: undoable ? [{ label: 'Undo', run: () => void undoSend(q.id) }] : []
  })
  queued.set(q.id, { sessionId, toastId, accountId })
}

/** Puts a card back after Undo or a failed send: inline if its message is still open, else docked. */
function bringBack(id: string, patch: Partial<ComposeSession>): void {
  const s = getSession(id)
  if (!s) return
  const inline = s.host === 'inline' && s.reply?.key === env.selectedKey()
  updateSession(id, { ...patch, hidden: undefined, host: inline ? 'inline' : 'docked', minimized: false })
  activate(id)
}

async function undoSend(outboxId: string): Promise<void> {
  const q = queued.get(outboxId)
  try {
    const input = await api.cancelScheduled(outboxId)
    queued.delete(outboxId)
    if (q && getSession(q.sessionId)) bringBack(q.sessionId, { dirty: true })
    else {
      const s = fromInput(input, { dirty: true })
      putSession(s)
      activate(s.id)
    }
    toast('Sending undone')
  } catch (e) {
    toast({ text: errText(e), tone: 'error' })
  }
}

/** Undo-send messages that failed, also ones from before this window opened. */
async function collectFailed(): Promise<void> {
  const list = await api.takeFailedSends().catch(() => [])
  for (const f of list) {
    const q = queued.get(f.id)
    queued.delete(f.id)
    if (q) dismiss(q.toastId)
    const banner = { tone: 'error' as const, text: `Couldn't send: ${f.error}` }
    if (q && getSession(q.sessionId)) bringBack(q.sessionId, { banner, dirty: true })
    else {
      const s = fromInput(f.input, { banner, dirty: true })
      putSession(s)
      activate(s.id)
      autosave.touch(s.id)
    }
  }
  if (list.length) toast({ text: list.length === 1 ? 'Message not sent' : `${list.length} messages not sent`, tone: 'error' })
}

/** Listens for the outbox; App starts this once. */
export function startComposeEvents(): () => void {
  const off = api.onOutbox((e) => {
    if (e.state === 'failed') {
      if (e.kind === 'undo') void collectFailed()
      else toast({ text: `A scheduled message couldn't be sent: ${e.error ?? 'unknown error'}`, tone: 'error' })
      return
    }
    const q = queued.get(e.id)
    if (!q) return
    queued.delete(e.id)
    autosave.forget(q.sessionId)
    removeSession(q.sessionId)
    toast({
      id: q.toastId,
      text: 'Message sent',
      actions: [{ label: 'View Message', run: () => env.selectMailbox(q.accountId, 'sent') }]
    })
    env.refreshIfShowing(q.accountId, 'sent')
    env.refreshIfShowing(q.accountId, 'drafts')
  })
  void collectFailed()
  return off
}

/** Send ▾ > Schedule send: the outbox holds it, and the draft leaves Drafts meanwhile. */
export async function schedule(id: string, at: Date): Promise<void> {
  if (at.getTime() <= Date.now()) {
    updateSession(id, { banner: { tone: 'error', text: 'Pick a time in the future.' } })
    return
  }
  flush(id)
  const s = commitTyping(id)
  if (!s || s.hidden) return
  const account = env.accounts.find((a) => a.id === s.accountId)
  const problem = account ? blockingProblem(s, account) : 'Choose an account to send from.'
  if (problem) {
    updateSession(id, { banner: { tone: 'error', text: problem } })
    return
  }
  autosave.cancel(id)
  await autosave.settle(id)
  const current = getSession(id)!
  const uid = autosave.lastUid(id) ?? current.draftUid
  try {
    const info = await api.scheduleSend({ ...toInput(current), draftUid: undefined }, at.toISOString())
    autosave.forget(id)
    removeSession(id)
    env.focusList()
    if (uid) api.deleteDraft(current.accountId, uid).catch((e) => console.error('Could not delete draft:', e))
    if (IS_POPOUT) tell({ type: 'scheduled', info, at: at.toISOString(), reply: current.reply })
    else scheduledToast(info, at, current.reply)
  } catch (e) {
    updateSession(id, { banner: { tone: 'error', text: errText(e) } })
  }
}

function scheduledToast(info: ScheduledInfo, at: Date, reply: ComposeSession['reply']): void {
  toast({
    text: `Send scheduled for ${formatWhen(at)}`,
    actions: [
      {
        label: 'Undo',
        run: async () => {
          try {
            const s2 = fromInput(await api.cancelScheduled(info.id), { dirty: true, reply, host: 'docked' })
            putSession(s2)
            bringBack(s2.id, {})
            autosave.touch(s2.id)
          } catch (e) {
            toast({ text: errText(e), tone: 'error' })
          }
        }
      }
    ]
  })
}

/** Answers the question bar: OK continues what asked, the second button does its own thing. */
export function answerConfirm(id: string, choice: 'ok' | 'alt' | 'cancel'): void {
  const c = getSession(id)?.confirm
  updateSession(id, { confirm: undefined })
  if (!c || choice === 'cancel') return
  if (choice === 'alt' && c.alt?.kind === 'attach') return void pickAttachments(id)
  if (c.kind === 'close-unsaved') return void close(id, true)
  void send(id, [...(c.kind === 'send-no-attachment' ? ['send-empty' as const] : []), c.kind])
}

// ---------- Templates and AI ----------

/** Inserts a saved template at the cursor. */
export function insertTemplate(id: string, text: string): void {
  const s = getSession(id)
  if (!s) return
  editorOf(id)?.focus('end')
  if (s.plain) insertText(text)
  else insertHtml(textToHtml(text))
  autosave.touch(id)
}

/** Saves what was written (without signature and quote) as a template; `overwriteId` replaces one. */
export function saveTemplate(id: string, name: string, overwriteId?: string): void {
  flush(id)
  const text = ownText(id).trim()
  if (!text) return void toast({ text: "There's nothing to save yet.", tone: 'error' })
  const templates = env.settings.templates
  const next = overwriteId
    ? templates.map((t) => (t.id === overwriteId ? { ...t, text } : t))
    : [...templates, { id: newId(), name: name.trim() || 'Untitled', text }]
  env.setSettings({ ...env.settings, templates: next })
  toast(overwriteId ? 'Template updated' : 'Template saved')
}

export function deleteTemplate(templateId: string): void {
  env.setSettings({ ...env.settings, templates: env.settings.templates.filter((t) => t.id !== templateId) })
}

/** Asks Claude for a reply to the message being answered and puts it at the top of the body. */
export async function suggestReply(id: string): Promise<void> {
  const s = getSession(id)
  const src = s?.reply
  if (!s || !src) return
  const from = src.summary.from
  try {
    const text = await api.ai({
      task: 'reply',
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      subject: src.summary.subject,
      text: src.detail?.text ?? src.summary.preview
    })
    const root = editorOf(id)?.root()
    if (!root || !getSession(id)) return
    if (s.plain) root.textContent = `${text}\n\n${root.textContent}`
    else root.insertAdjacentHTML('afterbegin', textToHtml(text))
    flush(id)
    autosave.touch(id)
    editorOf(id)?.focus('start')
  } catch (e) {
    updateSession(id, { banner: { tone: 'error', text: errText(e) } })
  }
}

/** Ctrl+S: saves the draft now and says so. */
export async function save(id: string): Promise<void> {
  flush(id)
  const s = commitTyping(id)
  if (!s) return
  if (!s.dirty) updateSession(id, { dirty: true })
  const ok = await autosave.saveNow(id)
  if (ok) toast('Draft saved')
}

/** Focus back to the message list, e.g. Shift+Esc from a card. */
export function focusList(): void {
  env.focusList()
}

/** Synchronous: copies every editor into its session and writes the recovery copy; for `beforeunload`. */
export function stash(): void {
  for (const s of allSessions()) flush(s.id)
  autosave.writeRecoveryNow()
}

// ---------- Pop-out windows ----------

const tell = (m: PopoutMessage) => api.popoutSend(m)

/** The card as the other window needs it: saved to the server first, with the latest draft UID. */
async function handoff(id: string): Promise<{ session: ComposeSession; unsaved: boolean } | null> {
  flush(id)
  if (!commitTyping(id)) return null
  autosave.cancel(id)
  await autosave.settle(id)
  const s = getSession(id)
  if (!s || s.hidden) return null
  return {
    session: {
      ...s,
      host: 'docked',
      minimized: false,
      expanded: false,
      confirm: undefined,
      banner: undefined,
      draftUid: autosave.lastUid(id) ?? s.draftUid
    },
    unsaved: autosave.hasUnsaved(id)
  }
}

/** Opens the card in a window of its own. The card leaves the dock once the window exists. */
export async function openInWindow(id: string): Promise<void> {
  const out = await handoff(id)
  if (!out) return
  const payload: PopoutPayload = out
  updateSession(id, { hidden: 'closing' })
  try {
    await api.openComposeWindow(payload)
  } catch (e) {
    updateSession(id, { hidden: undefined })
    if (autosave.hasUnsaved(id)) autosave.touch(id)
    toast({ text: errText(e), tone: 'error' })
    return
  }
  autosave.forget(id)
  removeSession(id)
  env.focusList()
}

/** Pop-out window: the card goes back to the main window's dock; this window closes with it. */
export async function returnToMain(id: string): Promise<void> {
  const out = await handoff(id)
  if (!out) return
  tell({ type: 'adopt', ...out })
  autosave.forget(id)
  removeSession(id)
}

/** The card a pop-out window opened with, or the newer copy a crash left in its recovery storage. */
export function startPopout(p: PopoutPayload): string {
  autosave.useWindowRecovery(p.session.id)
  const recovered = autosave.takeRecovered().find((r) => r.id === p.session.id)
  const { savedAt: _savedAt, ...rest } = recovered ?? { savedAt: 0 }
  putSession({ ...p.session, ...rest, dirty: p.session.dirty || !!recovered, minimized: false, activeAt: Date.now() })
  if (recovered || p.unsaved) autosave.touch(p.session.id)
  return p.session.id
}

/** Main window: a card comes back from a pop-out. */
function adoptSession(s: ComposeSession, unsaved: boolean): void {
  if (getSession(s.id)) return
  putSession({ ...s, hidden: undefined, activeAt: Date.now() })
  activate(s.id)
  if (unsaved) autosave.touch(s.id)
}

/** Main window: listens to its pop-outs; App starts this once. */
export function startPopoutEvents(): () => void {
  return api.onPopoutMessage((raw) => {
    const m = raw as PopoutMessage
    if (m.type === 'adopt') adoptSession(m.session, m.unsaved)
    else if (m.type === 'queued') trackQueued(m.queued, '', m.accountId)
    else if (m.type === 'scheduled') scheduledToast(m.info, new Date(m.at), m.reply)
    else if (m.type === 'discarded') discardedToast(m.session)
    else if (m.type === 'settings') env.setSettings(m.settings)
    else if (m.type === 'reply') void replyInWindow(m)
  })
}

/**
 * Main window: a message window asked for a reply. It opens in a compose window of its own, next to
 * the message; a reply already being written in the dock is brought forward instead.
 */
async function replyInWindow(m: Extract<PopoutMessage, { type: 'reply' }>): Promise<void> {
  const open = allSessions().some((s) => s.reply?.key === m.summary.key && !s.hidden)
  const id = await reply(m.mode, m.summary, m.detail, m.allowRemote, 'docked')
  if (id && !open) await openInWindow(id)
}

/** Pop-out window: the settings with new templates, merged into what is saved so other changes survive. */
export async function saveTemplatesFromPopout(templates: Settings['templates']): Promise<Settings> {
  const saved = await api.setSettings({ ...(await api.getSettings()), templates })
  tell({ type: 'settings', settings: saved })
  return saved
}
