import Anthropic from '@anthropic-ai/sdk'
import type { AiInput } from '../shared/types'
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
  const apiKey = store.getAiKey()
  if (!apiKey) throw new Error('Add a Claude API key in Settings > General first.')
  const client = new Anthropic({ apiKey })
  const body = input.text.length > MAX_INPUT_CHARS ? `${input.text.slice(0, MAX_INPUT_CHARS)}\n[…]` : input.text

  let response: Anthropic.Beta.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      // Re-runs a declined request on a suitable model instead of failing.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM[input.task],
      messages: [{ role: 'user', content: `From: ${input.from}\nSubject: ${input.subject}\n\n${body}` }]
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Claude API key was rejected. Check it in Settings > General.')
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude is rate limited right now. Try again in a minute.')
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach Claude. Check your connection.')
    if (err instanceof Anthropic.APIError) throw new Error(`Claude returned an error: ${err.message}`)
    throw err
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to process this message.')
  const text = response.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim()
  if (!text) throw new Error('Claude returned no text.')
  return text
}
