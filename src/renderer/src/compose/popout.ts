import type { QueuedSend, ScheduledInfo, Settings } from '@shared/types'
import type { ComposeSession } from './sessions'

/** This page is a pop-out compose window: one card, no mailbox. */
export const IS_POPOUT = location.hash === '#popout'

/** What the main window hands a new pop-out window. */
export interface PopoutPayload {
  session: ComposeSession
  /** Edits the server's draft doesn't have yet, so the new window saves them. */
  unsaved: boolean
}

/**
 * What a pop-out tells the main window. It outlives the pop-out, which closes as soon as its card
 * is gone, so toasts with Undo and the sent-mail bookkeeping live in the main window.
 */
export type PopoutMessage =
  | { type: 'adopt'; session: ComposeSession; unsaved: boolean }
  | { type: 'queued'; queued: QueuedSend; accountId: string }
  | { type: 'scheduled'; info: ScheduledInfo; at: string; reply: ComposeSession['reply'] }
  | { type: 'discarded'; session: ComposeSession }
  | { type: 'settings'; settings: Settings }
