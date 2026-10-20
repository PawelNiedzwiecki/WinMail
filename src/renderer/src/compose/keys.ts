/**
 * Keyboard shortcuts, matched so keyboard layouts can't trigger them by accident: Windows reports
 * AltGr as Ctrl+Alt (ą ę ś ć ń ł ż ź ó on Polish layouts), so Ctrl shortcuts never match with Alt held,
 * and digits or punctuation are matched by physical key because Shift and the layout change e.key.
 */
export interface Shortcut {
  /** A letter or named key, compared case-insensitively with e.key. */
  key?: string
  /** Physical key (e.code), for digits and punctuation. */
  code?: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export function isKey(e: KeyLike, s: Shortcut): boolean {
  if ((e.ctrlKey || e.metaKey) !== !!s.ctrl || e.shiftKey !== !!s.shift || e.altKey !== !!s.alt) return false
  return s.code ? e.code === s.code : e.key.toLowerCase() === s.key!.toLowerCase()
}

export const KEYS = {
  // Anywhere in the app
  newMessage: { key: 'n', ctrl: true },
  settings: { code: 'Comma', ctrl: true },
  nextCompose: { code: 'Period', ctrl: true },
  // Message list and reading pane
  reply: { key: 'r', ctrl: true },
  replyAll: { key: 'r', ctrl: true, shift: true },
  forward: { key: 'f', ctrl: true, shift: true },
  search: { key: 'f', ctrl: true },
  // Inside a compose card or inline reply
  send: { key: 'Enter', ctrl: true },
  save: { key: 's', ctrl: true },
  close: { key: 'w', ctrl: true },
  discard: { key: 'd', ctrl: true, shift: true },
  cc: { key: 'c', ctrl: true, shift: true },
  bcc: { key: 'b', ctrl: true, shift: true },
  from: { key: 'f', ctrl: true, shift: true },
  link: { key: 'k', ctrl: true },
  numbered: { code: 'Digit7', ctrl: true, shift: true },
  bulleted: { code: 'Digit8', ctrl: true, shift: true },
  quote: { code: 'Digit9', ctrl: true, shift: true },
  outdent: { code: 'BracketLeft', ctrl: true },
  indent: { code: 'BracketRight', ctrl: true },
  removeFormat: { code: 'Backslash', ctrl: true },
  strike: { code: 'Digit5', alt: true, shift: true },
  plainPaste: { key: 'v', ctrl: true, shift: true }
} satisfies Record<string, Shortcut>
