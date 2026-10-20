import { useRef, useSyncExternalStore } from 'react'
import type { MessageDetail, MessageSummary, OutgoingAttachment } from '@shared/types'
import type { Chip } from './addresses'

export type ReplyMode = 'reply' | 'all' | 'forward'
export type RecipientField = 'to' | 'cc' | 'bcc'

/** idle: nothing to save yet; unsupported: the account has no Drafts folder. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsupported'

export interface ComposeAttachment extends OutgoingAttachment {
  /** Local key; two attachments may share a file name. */
  id: string
  /** Still being fetched, e.g. a forwarded message's own attachments. */
  pending?: boolean
  /** Came with a forwarded message, and goes again if the reply stops being a forward. */
  fromOriginal?: boolean
}

/** The message a reply or forward answers. */
export interface ReplySource {
  key: string
  mode: ReplyMode
  summary: MessageSummary
  /** Null when the full message couldn't be loaded; the preview stands in. */
  detail: MessageDetail | null
  /** The reader allowed this message's remote images, so its quote may show them. */
  allowRemote: boolean
}

/** A question shown above the fields before something happens, e.g. "Send without a subject?". */
export interface Confirm {
  text: string
  ok: string
  /** What OK does. */
  kind: 'send-empty' | 'send-no-attachment' | 'close-unsaved'
  /** Second button next to Cancel, e.g. "Attach files…". */
  alt?: { label: string; kind: 'attach' }
}

export interface ComposeSession {
  id: string
  host: 'docked' | 'inline'
  minimized: boolean
  expanded: boolean
  accountId: string
  to: Chip[]
  cc: Chip[]
  bcc: Chip[]
  /** Text typed in a recipient field that isn't a chip yet. */
  typing: Record<RecipientField, string>
  showCc: boolean
  showBcc: boolean
  subject: string
  /** Editor content as of the last flush: HTML, or plain text in plain-text mode. */
  body: string
  plain: boolean
  /** Reply quote kept out of the editor behind "···" and sent after the body; null once shown. */
  quote: string | null
  attachments: ComposeAttachment[]
  inReplyTo?: string
  references?: string[]
  reply?: ReplySource
  /** UID of the saved copy in the account's Drafts folder. */
  draftUid?: number
  /** Edited since it opened; untouched sessions leave no draft. */
  dirty: boolean
  /** Hidden while it waits in the outbox, or while closing saves it. */
  hidden?: 'sending' | 'closing'
  status: SaveStatus
  statusError?: string
  banner?: { tone: 'error' | 'info'; text: string }
  confirm?: Confirm
  openedAt: number
  activeAt: number
  /** Where focus goes when the card mounts or is restored. */
  focus: 'to' | 'subject' | 'body'
  /** Bumped when the body is replaced from outside, so the editor shows the new content. */
  revision: number
  /** The signature as inserted, to tell an untouched one from an edited one. */
  signature: { accountId: string; html: string } | null
}

/** What the dock and the message list need, without the body: it changes rarely. */
export interface SessionEntry {
  id: string
  host: ComposeSession['host']
  minimized: boolean
  expanded: boolean
  hidden: boolean
  openedAt: number
  activeAt: number
  replyKey?: string
  accountId: string
  draftUid?: number
}

type Listener = () => void

const sessions = new Map<string, ComposeSession>()
const sessionListeners = new Map<string, Set<Listener>>()
const listListeners = new Set<Listener>()
let entries: SessionEntry[] = []

const entryOf = (s: ComposeSession): SessionEntry => ({
  id: s.id,
  host: s.host,
  minimized: s.minimized,
  expanded: s.expanded,
  hidden: !!s.hidden,
  openedAt: s.openedAt,
  activeAt: s.activeAt,
  replyKey: s.reply?.key,
  accountId: s.accountId,
  draftUid: s.draftUid
})

function sameEntries(a: SessionEntry[], b: SessionEntry[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]!
    return (Object.keys(x) as (keyof SessionEntry)[]).every((k) => x[k] === y[k])
  })
}

function notify(id: string): void {
  sessionListeners.get(id)?.forEach((l) => l())
  const next = [...sessions.values()].map(entryOf)
  if (!sameEntries(entries, next)) {
    entries = next
    listListeners.forEach((l) => l())
  }
}

export const getSession = (id: string) => sessions.get(id)
export const allSessions = () => [...sessions.values()]

export function putSession(s: ComposeSession): void {
  sessions.set(s.id, s)
  notify(s.id)
}

export function updateSession(
  id: string,
  patch: Partial<ComposeSession> | ((s: ComposeSession) => Partial<ComposeSession>)
): ComposeSession | undefined {
  const s = sessions.get(id)
  if (!s) return undefined
  const next = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }
  sessions.set(id, next)
  notify(id)
  return next
}

export function removeSession(id: string): void {
  if (!sessions.delete(id)) return
  notify(id)
}

export function useSession(id: string): ComposeSession | undefined {
  return useSyncExternalStore(
    (cb) => {
      let set = sessionListeners.get(id)
      if (!set) sessionListeners.set(id, (set = new Set()))
      set.add(cb)
      return () => {
        set!.delete(cb)
        if (!set!.size) sessionListeners.delete(id)
      }
    },
    () => sessions.get(id)
  )
}

/**
 * Like useSession, but keeps the last state once the session is gone, so a card that was
 * just closed or sent can still draw itself while it animates out.
 */
export function useLastSession(id: string): ComposeSession | undefined {
  const live = useSession(id)
  const last = useRef(live)
  if (live) last.current = live
  return live ?? last.current
}

export function useSessionList(): SessionEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listListeners.add(cb)
      return () => {
        listListeners.delete(cb)
      }
    },
    () => entries
  )
}

// ---------- Editors ----------

/** What a mounted editor offers the rest of Compose. */
export interface EditorHandle {
  /** Copies the live content into the session. */
  flush(): void
  /** The live content without touching the session. */
  read(): string
  focus(where: 'start' | 'end'): void
  root(): HTMLElement | null
}

const editors = new Map<string, EditorHandle>()

export function registerEditor(id: string, handle: EditorHandle): () => void {
  editors.set(id, handle)
  return () => {
    if (editors.get(id) === handle) editors.delete(id)
  }
}

export const editorOf = (id: string) => editors.get(id)

/** Copies what the editor shows into the session, before saving, sending or moving the card. */
export function flush(id: string): void {
  editors.get(id)?.flush()
}

/** The body as the editor shows it right now. */
export function liveBody(id: string): string | undefined {
  return editors.get(id)?.read() ?? sessions.get(id)?.body
}
