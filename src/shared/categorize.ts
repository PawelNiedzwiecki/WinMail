import type { GmailCategory } from './types'

/** What the classifier looks at. The header fields are only known for messages fetched from a server. */
export interface CategoryInput {
  email: string
  subject: string
  listId?: boolean
  listUnsubscribe?: boolean
  /** Precedence: bulk | list | junk */
  bulk?: boolean
  /** Auto-Submitted other than "no" */
  automated?: boolean
}

const SOCIAL_DOMAINS =
  /(^|\.)(facebookmail|facebook|linkedin|twitter|x|instagram|pinterest|reddit|redditmail|tiktok|snapchat|discord|whatsapp|youtube|meetup|quora|tumblr|nextdoor|threads|mastodon|bsky)\.(com|net|app|social)$/i

const TRANSACTIONAL_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|alerts?|billing|receipts?|orders?|invoices?|support|security|account|accounts|service|system|mailer-daemon|postmaster)([+._-]|$)/i
const TRANSACTIONAL_SUBJECT =
  /\b(receipt|invoice|order|payment|statement|confirm(ed|ation)?|verif(y|ication)|security alert|sign-?in|password|one-?time|your code|shipped|delivered|delivery|tracking|booking|reservation|itinerary|ticket|appointment|reminder|renewal|subscription)\b/i

const PROMO_LOCAL = /^(news(letter)?|marketing|offers?|deals?|promo(tions?)?|digest|shop|store|sales)([+._-]|$)/i
const PROMO_SUBJECT = /(\d+\s?%\s?off|\bsale\b|discount|\bdeal(s)?\b|coupon|free shipping|limited time|exclusive|\boffer\b|save \d|last chance|\bnew arrivals?\b|newsletter|weekly digest)/i

/**
 * Gmail-style category for a message. Google accounts get theirs from Gmail itself; this is for every
 * other account. It is a heuristic, so it errs towards Primary.
 */
export function categorize(m: CategoryInput): GmailCategory {
  const at = m.email.lastIndexOf('@')
  const local = at > 0 ? m.email.slice(0, at) : m.email
  const domain = at > 0 ? m.email.slice(at + 1) : ''

  if (SOCIAL_DOMAINS.test(domain)) return 'social'
  if (m.listId && !m.listUnsubscribe) return 'forums'
  if (TRANSACTIONAL_SUBJECT.test(m.subject) && !PROMO_SUBJECT.test(m.subject)) {
    // A receipt or code is an update, unless it comes from a marketing sender.
    if (!m.bulk) return 'updates'
  }
  if (m.listUnsubscribe || m.bulk || PROMO_LOCAL.test(local) || PROMO_SUBJECT.test(m.subject)) {
    return m.listId && !PROMO_SUBJECT.test(m.subject) ? 'forums' : 'promotions'
  }
  if (m.automated || TRANSACTIONAL_LOCAL.test(local)) return 'updates'
  return 'primary'
}
