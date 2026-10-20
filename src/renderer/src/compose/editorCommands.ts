import { isIndent } from './outgoing'

/**
 * The only place that runs document.execCommand. It is deprecated but still the one API that keeps
 * the editor's undo history; keeping every call here contains any future move to something else.
 */
export type FormatCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'insertOrderedList'
  | 'insertUnorderedList'
  | 'indent'
  | 'outdent'
  | 'removeFormat'
  | 'undo'
  | 'redo'

let configured = false

/** Lines become <div>s and bold becomes <b> rather than styled spans, which mail apps handle best. */
function configure(): void {
  if (configured) return
  configured = true
  document.execCommand('defaultParagraphSeparator', false, 'div')
  document.execCommand('styleWithCSS', false, 'false')
}

export function exec(cmd: FormatCommand): void {
  configure()
  document.execCommand(cmd)
  // removeFormat leaves links alone; Gmail's "Remove formatting" doesn't.
  if (cmd === 'removeFormat') document.execCommand('unlink')
}

export function isActive(cmd: FormatCommand): boolean {
  try {
    return document.queryCommandState(cmd)
  } catch {
    return false
  }
}

/** Quote button: wraps the lines in a blockquote, or takes them out of one. */
export function toggleQuote(root: HTMLElement): void {
  configure()
  const anchor = window.getSelection()?.anchorNode ?? null
  const el = anchor instanceof Element ? anchor : anchor?.parentElement
  const quote = el?.closest('blockquote')
  if (quote && root.contains(quote) && !isIndent(quote)) document.execCommand('outdent')
  else document.execCommand('formatBlock', false, 'blockquote')
}

export function insertHtml(html: string): void {
  configure()
  document.execCommand('insertHTML', false, html)
}

export function insertText(text: string): void {
  configure()
  document.execCommand('insertText', false, text)
}

export function createLink(url: string): void {
  configure()
  document.execCommand('createLink', false, url)
}

export function unlink(): void {
  document.execCommand('unlink')
}
