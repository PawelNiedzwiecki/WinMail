/**
 * Waiting for: the rules that decide when a sent message waits for a reply, when it comes back as a nudge, and
 * which incoming mail counts as a reply. Pure and shared by the main process (nudges, reply checks) and Compose (the
 * switch that turns on by itself). Local only: nothing here talks to a server or to Claude.
 */

/** How long a message waits before it comes back, unless changed for that message. */
export const DEFAULT_WAIT_DAYS = 3

/** The choices offered in Compose and in the Waiting for list. */
export const WAIT_DAY_CHOICES = [1, 2, 3, 5, 7, 14] as const

/** "1 day", "3 days", "1 week", "2 weeks". */
export function daysLabel(days: number): string {
  if (days % 7 === 0) return days === 7 ? '1 week' : `${days / 7} weeks`
  return days === 1 ? '1 day' : `${days} days`
}

/** Nudges come back in the day, not in the middle of the night. */
const DAY_START_HOUR = 8
const DAY_END_HOUR = 18

/**
 * When a message sent at `from` comes back: `days` later, moved to 08:00 when that falls before 08:00 or from
 * 18:00 on (to the next morning). Local time, so a nudge is due at the same clock time the user saw when sending.
 */
export function nudgeTime(from: Date, days: number): Date {
  const at = new Date(from)
  at.setDate(at.getDate() + days)
  if (at.getHours() >= DAY_END_HOUR) at.setDate(at.getDate() + 1)
  if (at.getHours() < DAY_START_HOUR || at.getHours() >= DAY_END_HOUR) at.setHours(DAY_START_HOUR, 0, 0, 0)
  return at
}

// ---------- Does the message ask something? ----------

/** Phrases that ask for an answer without a question mark, in the languages the attachment check knows. */
const ASKS =
  /(^|[^\p{L}])(let me know|please (confirm|advise|reply|respond|let me know|get back)|get back to me|looking forward to (hearing|your reply|your response)|await(ing)? your (reply|response|answer)|i('| a)m waiting for|daj(cie)? (mi )?zna[cć]|prosz[eę] o (odpowied[zź]|potwierdzenie|informacj[eę])|czekam na (odpowied[zź]|informacj[eę])|bitte (um )?(r[uü]ckmeldung|best[aä]tigung)|gib mir bescheid|merci de (me )?(confirmer|r[ée]pondre)|tenez-moi au courant|av[ií]same|quedo a la espera)(?=$|[^\p{L}])/iu

/** The writer's own words: quoted lines, the "On … wrote:" block below them and the signature are dropped. */
export function ownWords(text: string): string {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    // A signature, or the start of a quoted message in any of the usual forms.
    if (t === '--' || /^-{2,}\s*(original message|forwarded message)/i.test(t) || /^(on|w dniu|am|le|el) .+(wrote|napisał\(a\)|napisał|napisała|schrieb|a écrit|escribió):$/i.test(t)) break
    if (/^(from|od|von|de):\s/i.test(t) && out.some((l) => l.trim())) break
    if (t.startsWith('>')) continue
    out.push(line)
  }
  return out.join('\n')
}

/** Whether the writer asks something: a question mark ending a sentence (links aside), or a phrase like "let me know". */
export function asksQuestion(text: string): boolean {
  const words = ownWords(text)
    .replace(/\b(https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\S+@\S+/g, ' ')
  // "?" closing a sentence: after a letter, digit, quote or bracket, and followed by space, punctuation or the end.
  if (/[\p{L}\p{N}"'”’)\]]\s?[?？]+(?=$|[\s"'”’)\].,!:;]|\p{Extended_Pictographic})/mu.test(words)) return true
  return ASKS.test(words)
}

// ---------- People or lists? ----------

/** Local parts of addresses nobody reads replies from, or that send to many people. */
const LIST_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|noreply-\S*|notifications?|notify|mailer-daemon|postmaster|bounces?|list|lists|listserv|majordomo|announce(ments)?|newsletters?|news|digest|updates?|marketing|all|everyone|all-?staff|staff-?all)([+._-]|$)/i
/** Hosts and suffixes of mailing list services. */
const LIST_HOST = /(^|\.)(googlegroups\.com|groups\.io|lists\.[^.]+\..+|listserv\.[^.]+\..+|freelists\.org|mailman\.[^.]+\..+|discoursemail\.com)$/i

/** Whether an address belongs to a mailing list or a robot rather than a person. */
export function isListAddress(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at <= 0) return false
  const local = email.slice(0, at)
  const host = email.slice(at + 1)
  return LIST_LOCAL.test(local) || /-(list|l|announce|users|devel|dev|discuss)$/i.test(local) || LIST_HOST.test(host)
}

/** More recipients than this is a broadcast, not a question to people. */
const MAX_PEOPLE = 10

/**
 * Whether a message goes to people rather than lists: someone other than yourself, nobody on a list address, not
 * a broadcast, and not a reply to list mail.
 */
export function goesToPeople(recipients: string[], own: string[], replyToList = false): boolean {
  if (replyToList) return false
  const mine = new Set(own.map((e) => e.toLowerCase()))
  const others = recipients.map((e) => e.trim().toLowerCase()).filter((e) => e && !mine.has(e))
  if (!others.length || others.length > MAX_PEOPLE) return false
  return !others.some(isListAddress)
}

export interface AutoWaitInput {
  /** What the user wrote (signature and quote may still be in it; they are ignored). */
  text: string
  /** Every To, Cc and Bcc address. */
  recipients: string[]
  /** The user's own addresses. */
  own: string[]
  /** The message being answered came from a mailing list or newsletter. */
  replyToList?: boolean
  /** A follow-up written from a nudge: it waits again unless turned off. */
  followUp?: boolean
}

/** Why the Waiting for switch turns on by itself, or null to leave it off. */
export function autoWait(m: AutoWaitInput): 'followUp' | 'question' | null {
  if (!goesToPeople(m.recipients, m.own, m.replyToList)) return null
  if (m.followUp) return 'followUp'
  return asksQuestion(m.text) ? 'question' : null
}

// ---------- Which mail is a reply? ----------

export interface IncomingMail {
  from: string
  subject: string
  /** Auto-Submitted other than "no", or X-Autoreply / X-Autorespond present. */
  autoSubmitted?: boolean
}

const AUTO_SUBJECT =
  /^(auto(matic|matische)?[ -]?(reply|response|antwort|odpowied[zź])|out of (the )?office(?=\s*([:\-–(]|$))|ooo\b|abwesenheit|absence|r[ée]ponse automatique|respuesta autom[aá]tica|autosvar|nieobecno[sś][cć]|undeliver(able|ed)|delivery (status notification|failure|has failed)|mail delivery (failed|subsystem)|returned mail|failure notice)/i
const ROBOT_FROM = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|noreply)([+._-]|@)/i

/** Out-of-office answers and bounces say nothing about whether a person replied. */
export function isAutomatic(m: IncomingMail): boolean {
  return !!m.autoSubmitted || AUTO_SUBJECT.test(m.subject.replace(/^((re|aw|fw|fwd|odp|sv)\s*:\s*)+/i, '')) || ROBOT_FROM.test(m.from)
}
