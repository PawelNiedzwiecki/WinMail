/** Reading raw header lines fetched with a message summary. */

/** Message-IDs in a References or In-Reply-To header. */
export function messageIds(header: string | undefined): string[] {
  return header?.match(/<[^<>\s]+>/g) ?? []
}

/** A header's value from raw header lines, folded lines joined; null when it is missing. */
export function headerValue(raw: string, name: string): string | null {
  const m = new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, 'im').exec(raw)
  return m ? m[1]!.replace(/\r?\n[ \t]+/g, ' ').trim() : null
}

/** The References Message-IDs in raw header lines. List-Id and List-Unsubscribe also hold `<…>`, so not every header. */
export function referenceIds(hdr: string): string[] {
  return messageIds(headerValue(hdr, 'references') ?? undefined)
}

/** The messages this one answers: References, then In-Reply-To, without repeats. */
export function parentIds(hdr: string, inReplyTo: string | undefined): string[] {
  return [...new Set([...referenceIds(hdr), ...messageIds(inReplyTo)])]
}

/**
 * Whether `<…>` can be a Message-ID: it has an `@` (a List-Id never does) and is not a List-Unsubscribe link.
 * Only for summaries saved before #69, which took every `<…>` in the headers as a parent.
 */
export function isMessageId(id: string): boolean {
  return id.includes('@') && !/^<(mailto|https?):/i.test(id)
}

/** In-Reply-To or References name another message. */
export function isReplyHeaders(hdr: string, inReplyTo: string | undefined): boolean {
  return parentIds(hdr, inReplyTo).length > 0
}
