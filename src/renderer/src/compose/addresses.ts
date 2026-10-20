import addressparser from 'nodemailer/lib/addressparser'
import type { Address, Contact } from '@shared/types'

/** One recipient as shown in the To, Cc and Bcc fields. */
export interface Chip {
  name: string
  email: string
  /** Shown red and blocks Send; can still be saved in a draft. */
  valid: boolean
}

/** Start of the address being typed: after the last comma or semicolon that isn't inside a quoted name. */
export function tokenStart(v: string): number {
  let start = 0
  let quoted = false
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '"' && v[i - 1] !== '\\') quoted = !quoted
    else if ((v[i] === ',' || v[i] === ';') && !quoted) start = i + 1
  }
  return start
}

/** True while the text ends inside a quoted name, where a comma is part of the name. */
export function inQuotes(v: string): boolean {
  let quoted = false
  for (let i = 0; i < v.length; i++) if (v[i] === '"' && v[i - 1] !== '\\') quoted = !quoted
  return quoted
}

/** "Name <email>"; names with punctuation are quoted or the address parser splits them. */
export function format(a: { name: string; email: string }): string {
  if (!a.name || a.name === a.email) return a.email
  const name = /[",;<>@()[\]:\\.]/.test(a.name) ? `"${a.name.replace(/["\\]/g, '\\$&')}"` : a.name
  return `${name} <${a.email}>`
}

export function matches(c: Contact, q: string): boolean {
  const email = c.email.toLowerCase()
  const name = c.name.toLowerCase()
  return (
    email.startsWith(q) ||
    email.slice(email.indexOf('@') + 1).startsWith(q) ||
    name.startsWith(q) ||
    name.split(/\s+/).some((w) => w.startsWith(q))
  )
}

const EMAIL_RE = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\.]+(\.[^\s@<>()[\],;:"\\.]+)+$/

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email)
}

export function toChip(a: { name: string; email: string }): Chip {
  const email = a.email.trim()
  const name = a.name.trim()
  return { name: name === email ? '' : name, email, valid: isValidEmail(email) }
}

/** Splits typed or pasted text into chips; pieces that aren't addresses become invalid chips. */
export function parseList(text: string): Chip[] {
  return addressparser(text.replace(/\r?\n/g, ','), { flatten: true })
    .filter((a) => a.address || a.name)
    .map((a) => (a.address ? toChip({ name: a.name, email: a.address }) : toChip({ name: '', email: a.name })))
}

/** Address strings as SendInput carries them, e.g. `Anna <anna@x.com>, b@y.com`. */
export function chipsToString(chips: Chip[]): string {
  return chips.map(format).join(', ')
}

export function chipsFromAddresses(list: Address[]): Chip[] {
  return list.filter((a) => a.email).map(toChip)
}

/** Label for a chip or summary: the name, or the address when there is none. */
export const chipLabel = (c: Chip) => c.name || c.email
