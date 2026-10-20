import { getProvider } from '@shared/providers'
import type { Account } from '@shared/types'
import { chipLabel } from './addresses'
import type { ComposeSession, Confirm } from './sessions'

const FIELD_NAME = { to: 'To', cc: 'Cc', bcc: 'Bcc' } as const
const MB = 1024 * 1024

export const extensionOf = (filename: string) => {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/** Files the account's provider refuses to send. */
export function isBlocked(filename: string, account: Account | undefined): boolean {
  const blocked = account ? getProvider(account.provider).blockedExtensions : undefined
  return !!blocked?.includes(extensionOf(filename))
}

/** Reasons the message can't be sent as it is, shown in the card's error banner. */
export function blockingProblem(s: ComposeSession, account: Account): string | null {
  if (!s.to.length && !s.cc.length && !s.bcc.length) return 'Add at least one recipient.'
  for (const field of ['to', 'cc', 'bcc'] as const) {
    const bad = s[field].find((c) => !c.valid)
    if (bad) return `Check the address “${chipLabel(bad)}” in ${FIELD_NAME[field]}.`
  }
  const provider = getProvider(account.provider)
  const blocked = s.attachments.find((a) => isBlocked(a.filename, account))
  if (blocked) return `${provider.name} doesn't allow sending ${blocked.filename}. Remove it or put it in a cloud folder.`
  const total = s.attachments.reduce((sum, a) => sum + a.size, 0)
  if (total > provider.maxAttachmentsMB * MB) {
    return `Too large to send: ${(total / MB).toFixed(1)} MB of attachments, ${provider.name} allows ${provider.maxAttachmentsMB} MB.`
  }
  return null
}

/** "attached" and friends in a few languages, for the forgotten-attachment check. */
const MENTIONS_ATTACHMENT =
  /(^|[^\p{L}])(attach(ed|ment|ments|ing)?|enclosed|za[łl][aą]cz\p{L}*|anbei|anhang|pi[eè]ces? jointes?|ci-joint|adjunt[oa]s?)(?=$|[^\p{L}])/iu

/** Questions asked before sending, in the order Gmail asks them; Send anyway skips one. */
export function confirmations(s: ComposeSession, ownText: string): Confirm[] {
  const out: Confirm[] = []
  if (!s.subject.trim() && !ownText.trim()) {
    out.push({ kind: 'send-empty', text: 'Send this message without a subject or text?', ok: 'Send Anyway' })
  }
  if (!s.attachments.length && MENTIONS_ATTACHMENT.test(ownText)) {
    out.push({
      kind: 'send-no-attachment',
      text: 'You mentioned an attachment, but nothing is attached.',
      ok: 'Send Anyway',
      alt: { label: 'Attach Files…', kind: 'attach' }
    })
  }
  return out
}
