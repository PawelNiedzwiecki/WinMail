/** Re:/Fwd: prefixes, including Polish (Odp:, PD:) and German (AW:, WG:) ones, so they don't pile up. */
export const stripPrefixes = (s: string) => s.replace(/^((re|fwd?|aw|wg|odp|pd|tr)\s*:\s*)+/i, '')

export const replySubject = (subject: string) => `Re: ${stripPrefixes(subject === '(No Subject)' ? '' : subject)}`
