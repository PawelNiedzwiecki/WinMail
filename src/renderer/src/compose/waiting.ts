import { autoWait, DEFAULT_WAIT_DAYS } from '@shared/waiting'
import { getSession, ownText, updateSession, type ComposeSession, type WaitChoice } from './sessions'

/** How long after the last edit the switch looks at the text again. */
const SETTLE_MS = 400

/** The user's own addresses, from the compose environment. */
let own: string[] = []

export function setOwnAddresses(list: string[]): void {
  own = list
}

/** Answering a newsletter, a list post or other bulk mail: nobody is expected to write back. */
function answersList(s: ComposeSession): boolean {
  const r = s.reply
  if (!r || r.mode === 'forward') return false
  if (r.detail?.unsubscribe) return true
  return r.summary.category === 'promotions' || r.summary.category === 'forums' || r.summary.category === 'social'
}

/**
 * Sets the Waiting for switch from what the message says now: on when it asks people something (or is a follow-up
 * from a nudge), off otherwise. Leaves it alone once the user has set it.
 */
export function refreshAutoWait(id: string): ComposeSession | undefined {
  const s = getSession(id)
  if (!s || s.wait.manual) return s
  const reason = autoWait({
    text: ownText(id),
    recipients: [...s.to, ...s.cc, ...s.bcc].map((c) => c.email),
    own,
    replyToList: answersList(s),
    followUp: s.wait.followUp
  })
  if (!!reason === s.wait.on && (reason ?? undefined) === s.wait.reason) return s
  return updateSession(id, { wait: { ...s.wait, on: !!reason, reason: reason ?? undefined } })
}

const timers = new Map<string, number>()

/** Looks again a moment after the user stops typing. */
export function scheduleAutoWait(id: string): void {
  window.clearTimeout(timers.get(id))
  timers.set(
    id,
    window.setTimeout(() => {
      timers.delete(id)
      refreshAutoWait(id)
    }, SETTLE_MS)
  )
}

/** The user turned the switch on or off, or chose how long to wait (which turns it on). */
export function setWait(id: string, patch: Partial<Pick<WaitChoice, 'on' | 'days'>>): void {
  updateSession(id, (s) => ({
    wait: {
      ...s.wait,
      on: patch.on ?? (patch.days !== undefined ? true : s.wait.on),
      days: patch.days ?? s.wait.days ?? DEFAULT_WAIT_DAYS,
      manual: true
    }
  }))
}
