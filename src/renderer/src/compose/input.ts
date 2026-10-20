import type { SendInput } from '@shared/types'
import { chipsToString, parseList } from './addresses'
import { htmlToPlain, toOutgoing } from './outgoing'
import { getSession, updateSession, type ComposeSession, type RecipientField } from './sessions'

const FIELDS: RecipientField[] = ['to', 'cc', 'bcc']

/** Turns text still typed in the recipient fields into chips, as Gmail does on Send. */
export function commitTyping(id: string): ComposeSession | undefined {
  const s = getSession(id)
  if (!s || FIELDS.every((f) => !s.typing[f].trim())) return s
  const patch: Partial<ComposeSession> = { typing: { to: '', cc: '', bcc: '' } }
  for (const f of FIELDS) if (s.typing[f].trim()) patch[f] = [...s[f], ...parseList(s.typing[f])]
  return updateSession(id, patch)
}

/** What the main process sends or saves. The editor must be flushed first. */
export function toInput(s: ComposeSession): SendInput {
  const out = s.plain
    ? { html: undefined, text: s.body.trimEnd() + (s.quote ? `\n\n${htmlToPlain(s.quote)}` : '') }
    : toOutgoing(s.body, s.quote)
  return {
    accountId: s.accountId,
    to: chipsToString(s.to),
    cc: chipsToString(s.cc) || undefined,
    bcc: chipsToString(s.bcc) || undefined,
    subject: s.subject,
    text: out.text,
    html: out.html,
    attachments: s.attachments.filter((a) => !a.pending).map(({ path, filename, size }) => ({ path, filename, size })),
    inReplyTo: s.inReplyTo,
    references: s.references,
    draftUid: s.draftUid
  }
}
