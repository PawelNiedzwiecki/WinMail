import Anthropic from '@anthropic-ai/sdk'
import type { AiInput, MailQuery } from '../shared/types'
import type { Store } from './store'

const MODEL = 'claude-opus-5-5'

/** Long newsletters are cut here; the start of a message carries what matters for a summary or reply. */
const MAX_INPUT_CHARS = 60_000

const SYSTEM: Record<AiInput['task'], string> = {
  summarise:
    'Summarise the email for its recipient in 2 to 4 short bullet points: what it is about, anything they must ' +
    'do, and any dates, amounts or deadlines. Plain text, bullets start with "• ". No preamble.',
  reply:
    'Draft a reply to the email on behalf of its recipient. Match the language and formality of the email, keep it ' +
    'short, and leave placeholders like [time] for facts you do not know. Output only the reply body, no subject ' +
    'line, greeting-only lines are fine, no signature.'
}

/** Summaries and suggested replies with the user's own Claude API key. */
export async function runAi(store: Store, input: AiInput): Promise<string> {
  const body = input.text.length > MAX_INPUT_CHARS ? `${input.text.slice(0, MAX_INPUT_CHARS)}\n[…]` : input.text
  const response = await request(store, {
    max_tokens: 4000,
    system: SYSTEM[input.task],
    messages: [{ role: 'user', content: `From: ${input.from}\nSubject: ${input.subject}\n\n${body}` }]
  })
  const text = textOf(response)
  if (!text) throw new Error('Claude returned no text.')
  return text
}

/** Longer questions are cut; a search question is a sentence or two. */
const MAX_QUESTION_CHARS = 500

const SEARCH_SYSTEM = `You turn a question about the user's own email into a search for their mail app. Fill in only what \
the question asks for and leave everything else empty, null or false.

- from / to: people, companies, addresses or domains as the user wrote them ("Jamie", "Northwind", "example.com"). \
Several values mean any of them. For mail the user sent, use folder "sent" and put the recipients in "to".
- subject: only when the question says the subject or title contains something.
- words: topic words likely to appear literally in the matching emails, all of which must appear ("about the hike" \
gives "hike", "invoices" gives "invoice"). Use the singular and as few words as possible. Never use filler such as \
"email", "message", "mail" or names already in from / to.
- after / before: the first and last day included, as YYYY-MM-DD, resolved against today's date in the user's time \
zone. Weeks start on Monday. "today" is today to today; "this week" is Monday of this week to today; "last week" is \
Monday to Sunday of the previous week; "this month" is the 1st to today; "last month" is the whole previous calendar \
month; "in March" is the most recent March that has started; "since June" sets only after; "the last 7 days" is 6 \
days ago to today. Null when the question has no date.
- read: "unread" or "read" only when the question asks for it.
- flagged: true only for flagged, starred or important mail.
- hasAttachment: true for mail with attachments, files, documents, PDFs or photos attached.
- category: only when the question is about a kind of mail rather than a topic: "promotions" for newsletters, \
marketing and offers; "social" for social networks; "updates" for automated notifications; "forums" for mailing \
lists and groups; "primary" for mail from real people. Null for a topic such as invoices or receipts (use words).
- folder: "sent", "drafts", "archive", "junk" (spam), "trash" (bin, deleted) or "inbox" when the question names that \
place; "all" for anywhere, everywhere or all mail; otherwise null, which searches where the user is looking.`

const CATEGORIES = ['primary', 'social', 'promotions', 'updates', 'forums'] as const
const FOLDERS = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'all'] as const

const list = { type: 'array', items: { type: 'string' } }
const day = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] }
const choice = (values: readonly string[]) => ({ anyOf: [{ type: 'string', enum: values }, { type: 'null' }] })

/** The JSON schema Claude's answer must follow; the same fields as `MailQuery`. */
const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    from: list,
    to: list,
    subject: list,
    words: list,
    after: day,
    before: day,
    read: choice(['unread', 'read']),
    flagged: { type: 'boolean' },
    hasAttachment: { type: 'boolean' },
    category: choice(CATEGORIES),
    folder: choice(FOLDERS)
  },
  required: ['from', 'to', 'subject', 'words', 'after', 'before', 'read', 'flagged', 'hasAttachment', 'category', 'folder'],
  additionalProperties: false
}

/** YYYY-MM-DD of a moment in this computer's time zone. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** What Claude is told about "now", so "last month" and "this week" resolve in the user's calendar. */
export function todayLine(now: Date): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const long = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `Today is ${long} (${localDay(now)}), time zone ${zone}.`
}

/** Turns a question like "invoices from Northwind last month" into a `MailQuery`. Only the question is sent. */
export async function askSearch(store: Store, question: string, now = new Date()): Promise<MailQuery> {
  const q = question.trim().slice(0, MAX_QUESTION_CHARS)
  if (!q) throw new Error('Type what you are looking for.')
  const response = await request(store, {
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SEARCH_SCHEMA } },
    system: SEARCH_SYSTEM,
    messages: [{ role: 'user', content: `${todayLine(now)}\n\nQuestion: ${q}` }]
  })
  if (response.stop_reason === 'max_tokens') throw new Error('Claude could not finish reading the question. Try a shorter one.')
  try {
    return toMailQuery(JSON.parse(textOf(response)))
  } catch {
    throw new Error('Claude returned a search WinMail could not read. Try rephrasing.')
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Checks and tidies Claude's answer: unknown values are dropped, swapped dates put right. */
export function toMailQuery(raw: unknown): MailQuery {
  if (!raw || typeof raw !== 'object') throw new Error('not an object')
  const r = raw as Record<string, unknown>
  const strings = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))] : []
  const date = (v: unknown) => (typeof v === 'string' && YMD.test(v) && !isNaN(Date.parse(v)) ? v : null)
  const oneOf = <T extends string>(v: unknown, values: readonly T[]) => (values.includes(v as T) ? (v as T) : null)
  let after = date(r.after)
  let before = date(r.before)
  if (after && before && after > before) [after, before] = [before, after]
  return {
    from: strings(r.from),
    to: strings(r.to),
    subject: strings(r.subject),
    words: strings(r.words),
    after,
    before,
    read: oneOf(r.read, ['unread', 'read'] as const),
    flagged: r.flagged === true,
    hasAttachment: r.hasAttachment === true,
    category: oneOf(r.category, CATEGORIES),
    folder: oneOf(r.folder, FOLDERS)
  }
}

type Params = Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, 'max_tokens' | 'system' | 'messages'> & {
  output_config?: Anthropic.Beta.BetaOutputConfig
}

/** One Claude call with the saved key; API errors come back as messages for the user. */
async function request(store: Store, params: Params): Promise<Anthropic.Beta.BetaMessage> {
  const apiKey = store.getAiKey()
  if (!apiKey) throw new Error('Add a Claude API key in Settings > General first.')
  const client = new Anthropic({ apiKey })
  let response: Anthropic.Beta.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      output_config: { effort: 'low' },
      // Re-runs a declined request on a suitable model instead of failing.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      ...params
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Claude API key was rejected. Check it in Settings > General.')
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude is rate limited right now. Try again in a minute.')
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach Claude. Check your connection.')
    if (err instanceof Anthropic.APIError) throw new Error(`Claude returned an error: ${err.message}`)
    throw err
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to process this message.')
  return response
}

const textOf = (response: Anthropic.Beta.BetaMessage) =>
  response.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim()
