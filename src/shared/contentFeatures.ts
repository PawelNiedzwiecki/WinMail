/**
 * Content opt-ins (ADR 0001): a saved Claude key alone lets no message content leave this PC. Every feature that
 * sends content (subjects, bodies, attachments, addresses) to Claude is declared here, and each one gets:
 * - its own switch in Settings > Claude, with `sends` as the description (off by default),
 * - a check in the main process, which refuses the request while the switch is off.
 * To add one (e.g. Brief or Magazine summaries), add an entry below and call `assertOptedIn` before the request.
 * Features that send only the user's own words (AI search sends the question) need no entry.
 */
export const CONTENT_FEATURES = {
  summarise: {
    title: 'Summarise',
    sends: 'Sends the sender, subject and text of the message you summarise.'
  },
  reply: {
    title: 'Suggest a reply',
    sends: 'Sends the sender, subject and text of the message you are replying to.'
  }
} as const satisfies Record<string, { title: string; sends: string }>

export type ContentFeatureId = keyof typeof CONTENT_FEATURES

/** Which features may send message content to Claude. */
export type ContentOptIns = Record<ContentFeatureId, boolean>

export const CONTENT_FEATURE_IDS = Object.keys(CONTENT_FEATURES) as ContentFeatureId[]

/** Every feature off: the default for new and existing users. */
export const NO_OPT_INS = Object.fromEntries(CONTENT_FEATURE_IDS.map((id) => [id, false])) as ContentOptIns

/** Saved opt-ins with every declared feature present; anything missing or not exactly true is off. */
export function normaliseOptIns(saved: unknown): ContentOptIns {
  const s = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
  return Object.fromEntries(CONTENT_FEATURE_IDS.map((id) => [id, s[id] === true])) as ContentOptIns
}

export const optedIn = (s: { contentOptIns?: Partial<ContentOptIns> }, id: ContentFeatureId): boolean =>
  s.contentOptIns?.[id] === true

/** What the user is told when a feature is used while its opt-in is off. */
export const optInOffMessage = (id: ContentFeatureId): string =>
  `${CONTENT_FEATURES[id].title} is off. Turn it on in Settings > Claude.`

/** Throws unless the feature's opt-in is on; call before any message content is sent. */
export function assertOptedIn(s: { contentOptIns?: Partial<ContentOptIns> }, id: ContentFeatureId): void {
  if (!optedIn(s, id)) throw new Error(optInOffMessage(id))
}
