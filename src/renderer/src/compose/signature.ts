import { escapeHtml } from './sanitize'

/** A plain-text signature as HTML: escaped, line breaks kept, web addresses linked. */
export function signatureHtml(text: string): string {
  return escapeHtml(text.trim())
    .replace(/\r?\n/g, '<br>')
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`)
}

/**
 * The signature block. New messages get the "-- " line in front, as Gmail does by default;
 * replies and forwards put the signature above the quote without it.
 */
export function signatureBlock(text: string, dashes: boolean): string {
  return `<div class="winmail-signature">${dashes ? '<div>--&nbsp;</div>' : ''}<div>${signatureHtml(text)}</div></div>`
}

/** Compares signature markup the way the editor may have reserialised it. */
export function sameMarkup(a: string, b: string): boolean {
  const norm = (html: string) => {
    const box = document.createElement('div')
    box.innerHTML = html
    return box.innerHTML.replace(/\s+/g, ' ').trim()
  }
  return norm(a) === norm(b)
}
