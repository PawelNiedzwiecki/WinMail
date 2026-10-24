import { api } from '../api'
import { toInput } from './input'
import { htmlToPlain } from './outgoing'
import { allSessions, flush, getSession, liveBody, updateSession, type ComposeSession } from './sessions'

/**
 * Drafts save to the account's Drafts folder a few seconds after typing stops, at least every
 * 10 s while typing goes on, and right away on close, minimize and the like (saveNow). Large
 * drafts (attachments, pasted images) upload at most once a minute. One save runs at a time per
 * draft; edits made meanwhile are saved right after. A local copy in localStorage covers crashes.
 */
const DEBOUNCE_MS = 3000
const MAX_WAIT_MS = 10_000
const BIG_BYTES = 5 * 1024 * 1024
const BIG_INTERVAL_MS = 60_000
const RETRY_MS = [30_000, 120_000, 300_000]

interface State {
  timer?: number
  /** First edit not saved yet, for the 10 s ceiling. */
  since?: number
  running?: Promise<boolean>
  /** Hash of what the server has, to skip saves that would upload the same thing. */
  hash?: string
  savedAt?: number
  /** Latest UID, also known after the session is gone (discard deletes it). */
  uid?: number
  failures: number
  /** Edits so far, and how many of them the last good save included. */
  edits: number
  saved: number
}

const states = new Map<string, State>()
const stateOf = (id: string) => {
  let x = states.get(id)
  if (!x) states.set(id, (x = { failures: 0, edits: 0, saved: 0 }))
  return x
}

/** FNV-1a; only compared with itself, to notice unchanged drafts. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36) + s.length.toString(36)
}

const sizeOf = (s: ComposeSession) => s.body.length + s.attachments.reduce((n, a) => n + a.size, 0)

/** The user changed something: mark the draft edited and save it a little later. */
export function touch(id: string): void {
  const s = getSession(id)
  if (!s) return
  stateOf(id).edits++
  if (!s.dirty) updateSession(id, { dirty: true })
  schedule(id)
  scheduleRecovery()
}

function schedule(id: string, delay?: number): void {
  const x = stateOf(id)
  window.clearTimeout(x.timer)
  const s = getSession(id)
  if (!s || s.status === 'unsupported') return
  const now = Date.now()
  x.since ??= now
  let wait = delay ?? Math.min(DEBOUNCE_MS, Math.max(0, x.since + MAX_WAIT_MS - now))
  if (delay === undefined && x.savedAt && sizeOf(s) > BIG_BYTES) wait = Math.max(wait, x.savedAt + BIG_INTERVAL_MS - now)
  x.timer = window.setTimeout(() => void save(id), wait)
}

/** Saves now, e.g. on close. Resolves true once the server has the latest content. */
export function saveNow(id: string): Promise<boolean> {
  window.clearTimeout(states.get(id)?.timer)
  return save(id)
}

export function cancel(id: string): void {
  window.clearTimeout(states.get(id)?.timer)
}

/** Waits for a save in progress, e.g. before sending, so the draft's UID is final. */
export async function settle(id: string): Promise<void> {
  const x = states.get(id)
  while (x?.running) await x.running
}

export const lastUid = (id: string) => states.get(id)?.uid

/** The draft moved to another account; its next save starts a new copy there. */
export function resetServerCopy(id: string): void {
  const x = stateOf(id)
  x.uid = undefined
  x.hash = undefined
}

export function forget(id: string): void {
  cancel(id)
  states.delete(id)
  // Written now: a pop-out window closes right after, before a timer would fire.
  writeRecoveryNow()
}

/** Edits since the last good save, i.e. what only this window has. */
export const hasUnsaved = (id: string) => {
  const x = states.get(id)
  return !!x && x.edits > x.saved
}

async function save(id: string): Promise<boolean> {
  const x = stateOf(id)
  while (x.running) await x.running
  flush(id)
  const s = getSession(id)
  if (!s || !s.dirty || s.hidden === 'sending' || s.status === 'unsupported') return true
  const input = toInput(s)
  const h = hash(JSON.stringify({ ...input, draftUid: undefined }))
  const edits = x.edits
  if (h === x.hash && s.draftUid !== undefined) {
    x.saved = edits
    return true
  }
  x.since = undefined
  updateSession(id, { status: 'saving' })
  const run = (async () => {
    try {
      const uid = await api.saveDraft(input)
      Object.assign(x, { uid: uid ?? undefined, hash: h, savedAt: Date.now(), failures: 0, saved: edits })
      updateSession(id, { draftUid: uid ?? undefined, status: 'saved', statusError: undefined })
      scheduleRecovery()
      return true
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      const unsupported = /can't be saved/i.test(text)
      updateSession(id, { status: unsupported ? 'unsupported' : 'error', statusError: text })
      if (!unsupported) schedule(id, RETRY_MS[Math.min(x.failures++, RETRY_MS.length - 1)])
      return false
    }
  })()
  x.running = run
  try {
    return await run
  } finally {
    x.running = undefined
  }
}

// ---------- Local recovery copy ----------

const RECOVERY_KEY = 'winmail.compose.recovery'
/** A pop-out window keeps its own copy, so it and the main window never overwrite each other's. */
const POPOUT_KEY = `${RECOVERY_KEY}.popout.`
let recoveryKey = RECOVERY_KEY
let popout = false

/** This window is a pop-out for the card `id`. */
export function useWindowRecovery(id: string): void {
  recoveryKey = POPOUT_KEY + id
  popout = true
}
const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60_000
/** Bodies bigger than this (pasted images) are kept as plain text only. */
const RECOVERY_MAX_BODY = 2 * 1024 * 1024

/** The parts of a session worth bringing back after a crash. */
export type Recovered = Pick<
  ComposeSession,
  | 'id'
  | 'accountId'
  | 'to'
  | 'cc'
  | 'bcc'
  | 'typing'
  | 'showCc'
  | 'showBcc'
  | 'subject'
  | 'body'
  | 'plain'
  | 'quote'
  | 'attachments'
  | 'inReplyTo'
  | 'references'
  | 'draftUid'
> & { savedAt: number }

let recoveryTimer: number | undefined

function scheduleRecovery(): void {
  window.clearTimeout(recoveryTimer)
  recoveryTimer = window.setTimeout(writeRecoveryNow, 1000)
}

function toRecovered(s: ComposeSession): Recovered {
  let body = liveBody(s.id) ?? s.body
  let plain = s.plain
  if (body.length > RECOVERY_MAX_BODY) {
    body = plain ? body.slice(0, RECOVERY_MAX_BODY) : htmlToPlain(body)
    plain = true
  }
  return {
    id: s.id,
    accountId: s.accountId,
    to: s.to,
    cc: s.cc,
    bcc: s.bcc,
    typing: s.typing,
    showCc: s.showCc,
    showBcc: s.showBcc,
    subject: s.subject,
    body,
    plain,
    quote: s.quote,
    attachments: s.attachments.filter((a) => !a.pending),
    inReplyTo: s.inReplyTo,
    references: s.references,
    draftUid: lastUid(s.id) ?? s.draftUid,
    savedAt: Date.now()
  }
}

/** Writes edited drafts the server doesn't have yet; called on edits, saves and before closing. */
export function writeRecoveryNow(): void {
  window.clearTimeout(recoveryTimer)
  const list = allSessions()
    .filter((s) => s.dirty && s.hidden !== 'sending' && hasUnsaved(s.id))
    .map(toRecovered)
  try {
    if (list.length) localStorage.setItem(recoveryKey, JSON.stringify(list))
    else localStorage.removeItem(recoveryKey)
  } catch {
    // Storage full or blocked: the server copy is all there is.
  }
}

/**
 * Drafts left by a crash or an offline close, newest first; each is returned once. The main window
 * also takes those of pop-outs that are gone (`live` lists the ones still open); a pop-out only its own.
 */
export function takeRecovered(live: string[] = []): Recovered[] {
  try {
    const keys = [recoveryKey]
    if (!popout) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(POPOUT_KEY) && !live.includes(k.slice(POPOUT_KEY.length))) keys.push(k)
      }
    }
    const all: Recovered[] = []
    for (const k of keys) {
      const raw = localStorage.getItem(k)
      localStorage.removeItem(k)
      if (raw) all.push(...(JSON.parse(raw) as Recovered[]))
    }
    return all.filter((r) => Date.now() - r.savedAt < RECOVERY_MAX_AGE_MS).sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}
