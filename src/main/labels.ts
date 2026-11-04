import { LABEL_COLOURS, type LabelColour } from '../shared/types'

/**
 * Labels on IMAP: what counts as a label, how a name becomes a keyword, and default names and colours.
 * Pure functions, so they can be checked without a server.
 */

/** Thunderbird's five built-in tags; Apple Mail shows these keywords too when another app set them. */
export const KEYWORD_DEFAULTS: { id: string; name: string; colour: LabelColour }[] = [
  { id: '$label1', name: 'Important', colour: 'red' },
  { id: '$label2', name: 'Work', colour: 'orange' },
  { id: '$label3', name: 'Personal', colour: 'green' },
  { id: '$label4', name: 'To Do', colour: 'blue' },
  { id: '$label5', name: 'Later', colour: 'purple' }
]

/** Keywords without a `$` that mail apps use for their own bookkeeping, not as labels. */
const BOOKKEEPING = new Set(['junk', 'nonjunk', 'notjunk', 'forwarded', 'redirected', 'mdnsent', 'answered', 'seen'])

/**
 * Whether a flag is a label. System flags (`\Seen`) never are; `$` keywords are reserved for apps' bookkeeping
 * ($Forwarded, $Junk, $MailFlagBit0…) except Thunderbird's `$label1`…`$label5`.
 */
export function isLabelKeyword(flag: string): boolean {
  if (!flag || flag.startsWith('\\')) return false
  if (flag.startsWith('$')) return /^\$label[1-5]$/i.test(flag)
  return !BOOKKEEPING.has(flag.toLowerCase())
}

/** The labels among a message's flags, `$labelN` in lower case so they match the defaults. */
export function keywordLabels(flags: Iterable<string> | undefined): string[] {
  const out = new Set<string>()
  for (const f of flags ?? []) if (isLabelKeyword(f)) out.add(/^\$label/i.test(f) ? f.toLowerCase() : f)
  return [...out].sort()
}

/** Gmail folders that are not labels: the [Gmail] system folders and old [Imap] ones. */
export const GMAIL_SYSTEM_FOLDER = /^\[(Gmail|Google Mail|Imap)\](\/|$)/i

/**
 * The user labels among a Gmail message's X-GM-LABELS. System labels (`\Inbox`, `\Important`, `\Starred`, `\Sent`…)
 * start with a backslash. `folder` is the label folder the message was listed in, which belongs in the set.
 */
export function gmailLabels(labels: Iterable<string> | undefined, folder?: string): string[] {
  const out = new Set<string>()
  for (const l of labels ?? []) if (l && !l.startsWith('\\') && !GMAIL_SYSTEM_FOLDER.test(l)) out.add(l)
  if (folder) out.add(folder)
  return [...out].sort()
}

/** Characters IMAP does not allow in a keyword (atom-specials, `]`), turned into `_` as Thunderbird does. */
const NOT_ATOM = /[\s(){%*"\\\]<>/\x00-\x1f\x7f]/g

/**
 * The keyword for a new label, as Thunderbird makes one from a tag name: lower case, specials as `_`, and
 * non-ASCII in modified UTF-7 (RFC 3501 §5.1.3), since keywords are ASCII atoms. Empty when nothing usable is left.
 */
export function keywordFor(name: string): string {
  const k = encodeUtf7(name.trim().toLowerCase().replace(NOT_ATOM, '_'))
  if (!k.replace(/_/g, '')) return ''
  // A name that starts with $ would look like an app's own keyword.
  return k.startsWith('$') ? `_${k.slice(1)}` : k
}

/** A name for a keyword nobody named in WinMail: Thunderbird's defaults, else the keyword decoded. */
export function keywordName(id: string): string {
  const d = KEYWORD_DEFAULTS.find((x) => x.id === id.toLowerCase())
  if (d) return d.name
  return decodeUtf7(id).replace(/_/g, ' ').trim() || id
}

/** A stable colour for a label that has none yet, so it keeps the same one everywhere. */
export function defaultColour(id: string): LabelColour {
  const d = KEYWORD_DEFAULTS.find((x) => x.id === id.toLowerCase())
  if (d) return d.colour
  let h = 0
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  // Grey is kept for labels the user chooses it for.
  return LABEL_COLOURS[h % (LABEL_COLOURS.length - 1)]!
}

/**
 * The Gmail search term for a label, as Gmail writes it when you click one: lower case, with spaces and the `/`
 * of nested labels as dashes (`label:receipts-2026`).
 */
export function gmailLabelTerm(id: string): string {
  const t = id
    .toLowerCase()
    .replace(/["(){}]/g, '')
    .replace(/[\s/]+/g, '-')
  return `label:${t}`
}

// ---------- Modified UTF-7 (RFC 3501 §5.1.3) ----------

function encodeUtf7(s: string): string {
  let out = ''
  let run = ''
  const flush = () => {
    if (!run) return
    const buf = Buffer.alloc(run.length * 2)
    for (let i = 0; i < run.length; i++) buf.writeUInt16BE(run.charCodeAt(i), i * 2)
    out += `&${buf.toString('base64').replace(/=+$/, '').replace(/\//g, ',')}-`
    run = ''
  }
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (ch.length === 1 && c >= 0x20 && c <= 0x7e) {
      flush()
      out += ch === '&' ? '&-' : ch
    } else run += ch
  }
  flush()
  return out
}

function decodeUtf7(s: string): string {
  return s.replace(/&([^-]*)-/g, (_m, b64: string) => {
    if (!b64) return '&'
    const buf = Buffer.from(b64.replace(/,/g, '/'), 'base64')
    let r = ''
    for (let i = 0; i + 1 < buf.length; i += 2) r += String.fromCharCode(buf.readUInt16BE(i))
    return r
  })
}
