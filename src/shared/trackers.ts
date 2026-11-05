/**
 * Tracker shield: finds the Trackers in a message (see CONTEXT.md) and cleans them, offline.
 *
 * Pure logic, no DOM and no network: WinMail never fetches a link to find out where it goes. A link is only
 * unwrapped when its destination is written inside the link itself. The lists below are WinMail's own and ship
 * with the app; they are never downloaded.
 */

// ---------------------------------------------------------------------------------------------------------------
// Known tracking services
// ---------------------------------------------------------------------------------------------------------------

interface TrackingService {
  name: string
  /** Host names the service uses; every sub-domain of them counts too. */
  hosts?: string[]
  hostRe?: RegExp
  /**
   * The shape of the service's URLs (path and query) on a sender's own, white-labelled domain, so
   * `links.example.com/ls/click?upn=…` is still recognised as SendGrid. Only for shapes that are unmistakable.
   */
  signature?: RegExp
  /** Path and query of its open-tracking images. */
  pixel?: RegExp
  /** Path and query of its click-tracking links. */
  click?: RegExp
  /** Reads the destination out of a click link when the destination is in the link (not only `?url=`). */
  unwrap?: (u: URL) => string | null
}

const ANY = /./

const SERVICES: TrackingService[] = [
  { name: 'Mailchimp', hosts: ['list-manage.com'], pixel: /^\/track\/open\.php/i, click: /^\/track\/click/i },
  { name: 'Mandrill', hosts: ['mandrillapp.com'], pixel: /^\/track\/open/i, click: /^\/track\/click/i },
  {
    name: 'Amazon SES',
    hosts: ['awstrack.me'],
    signature: /^\/L0\/https?(?::|%3A)(?:\/|%2F){2}/i,
    pixel: /^\/I0\//,
    click: /^\/L0\//,
    unwrap: (u) => {
      const m = /^\/L0\/([^/]+)/.exec(u.pathname)
      return m ? asHttpUrl(m[1]!) : null
    }
  },
  {
    name: 'Klaviyo',
    hosts: ['klaviyomail.com', 'klclick.com', 'klclick1.com', 'klclick2.com', 'klclick3.com'],
    pixel: /^\/wf\/open/i,
    click: /^\/(?:ls|wf)\/click/i
  },
  {
    name: 'SendGrid',
    hosts: ['sendgrid.net'],
    signature: /^\/(?:ls\/click|wf\/open)\?(?:[^#]*&)?upn=/i,
    pixel: /^\/wf\/open/i,
    click: /^\/ls\/click/i
  },
  {
    name: 'HubSpot',
    hosts: ['hubspotlinks.com', 'hubspotemail.net', 'hubspot.com'],
    pixel: /^\/(?:e2t\/o\/|__ptq\.gif)/i,
    click: /^\/(?:e2t\/c\/|[A-Z][a-z]c\/)/
  },
  { name: 'Mailgun', hosts: ['mailgun.org', 'mailgun.net'], pixel: /^\/o\//, click: /^\/c\// },
  { name: 'Customer.io', hosts: ['customeriomail.com'], pixel: /^\/e\/o\//, click: /^\/e\/c\// },
  {
    name: 'Salesforce Marketing Cloud',
    hosts: ['exacttarget.com', 'exct.net'],
    signature: /^\/(?:open\.aspx\?ffcb10-|\?qs=[0-9a-f]{40,})/i,
    pixel: /^\/open\.aspx/i,
    click: /^\/\?qs=/i
  },
  { name: 'Constant Contact', hosts: ['rs6.net', 'constantcontact.com'], pixel: /^\/on\.jsp/i, click: /^\/tn\.jsp/i },
  {
    name: 'Campaign Monitor',
    hostRe: /(^|\.)(?:cmail\d+\.com|createsend\d*\.com)$/i,
    pixel: /\/o\.gif/i,
    click: /^\/t\//i
  },
  { name: 'Mailjet', hosts: ['mjt.lu'], pixel: /^\/oo\//i, click: /^\/lnk\//i },
  { name: 'MailerLite', hosts: ['mlsend.com'], pixel: /^\/link\/o\//i, click: /^\/link\/c\//i },
  {
    name: 'ActiveCampaign',
    hosts: ['acemlna.com', 'acemlnb.com', 'acemlnc.com', 'acemlnd.com', 'activehosted.com'],
    pixel: /^\/lt\.php\?[^#]*open/i,
    click: /^\/lt\.php/i
  },
  { name: 'Pardot', hosts: ['pardot.com'], click: /^\/r\//i },
  { name: 'Postmark', hosts: ['pstmrk.it'], pixel: /^\/open\//i, click: /^\/\d[a-z]\//i },
  {
    name: 'Brevo',
    hostRe: /(^|\.)(?:sendibt\d+\.com|sendibm\d+\.com|sendinblue\.com|brevo\.com)$/i,
    pixel: /^\/tr\/op\//i,
    click: /^\/tr\/cl\//i
  },
  { name: 'Beehiiv', hosts: ['beehiiv.com'], pixel: /^\/ss\/o\//i, click: /^\/ss\/c\//i },
  {
    name: 'Substack',
    hosts: ['substack.com'],
    pixel: /^\/(?:api\/v1\/)?email\/open\//i,
    click: /^\/redirect\//i,
    unwrap: (u) => {
      // /redirect/2/<base64url JSON>.<signature>, or the older /redirect/<id>?j=<same>. The JSON's "e" is the destination.
      const raw = /^\/redirect\/2\/([^/.]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('j')?.split('.')[0]
      const json = raw ? decodeBase64(raw) : null
      if (!json) return null
      try {
        const e = (JSON.parse(json) as { e?: unknown }).e
        return typeof e === 'string' ? asHttpUrl(e) : null
      } catch {
        return null
      }
    }
  },
  {
    name: 'ConvertKit',
    hostRe: /(^|\.)(?:convertkit-mail\d*\.com|kit-mail\d*\.com|ckeml\.com)$/i,
    pixel: ANY,
    click: ANY
  },
  { name: 'Intercom', hosts: ['intercom-clicks.com'], click: ANY },
  { name: 'Sailthru', hosts: ['sailthru.com'], click: /^\/click\//i },
  { name: 'Litmus', hosts: ['emltrk.com'], pixel: ANY },
  { name: 'Mailtrack', hosts: ['mailtrack.io'], pixel: /^\/trace\/mail\//i, click: /^\/trace\/link\//i },
  { name: 'Yesware', hosts: ['yesware.com'], pixel: /^\/t\//i, click: /^\/k\//i },
  { name: 'Streak', hosts: ['mailfoogae.appspot.com'], pixel: /^\/t\?/i },
  { name: 'Facebook', hosts: ['facebook.com', 'facebookmail.com'], pixel: /^\/email_open_log_pic\.php/i },
  { name: 'LinkedIn', hosts: ['linkedin.com'], pixel: /^\/emimp\//i },
  { name: 'GitHub', hosts: ['github.com'], pixel: /^\/notifications\/beacon\//i }
]

/** Links that are the reader's own organisation scanning mail, not a Tracker. They are left exactly as they are. */
const LINK_SCANNERS = [
  'safelinks.protection.outlook.com',
  'urldefense.com',
  'urldefense.proofpoint.com',
  'mimecast.com',
  'linkprotect.cudasvc.com',
  'url.emailprotection.link'
]

/** Redirects run by a site that carry their destination in a query parameter. Not Tracking services: unwrapped only. */
const REDIRECTORS: { host: RegExp; path: RegExp; params: string[] }[] = [
  { host: /^(?:www\.)?google\.[a-z.]+$/i, path: /^\/url$/, params: ['q', 'url'] },
  { host: /^l[m]?\.facebook\.com$/i, path: /^\/l\.php$/, params: ['u'] },
  { host: /^(?:www\.)?linkedin\.com$/i, path: /^\/(?:redir\/redirect|safety\/go)\/?$/, params: ['url'] },
  { host: /^(?:www\.|m\.)?youtube\.com$/i, path: /^\/redirect$/, params: ['q'] },
  { host: /^slack-redir\.net$/i, path: /^\/link$/, params: ['url'] }
]

/** Where a known click link may keep its destination, in the order tried. Only a valid web address counts. */
const DESTINATION_PARAMS = ['url', 'u', 'redirect', 'redirect_url', 'redirecturl', 'dest', 'destination', 'target', 'link', 'q']

/** Parameters that only tell the sender who clicked and from where. */
const TRACKING_PARAMS = new Set(
  [
    'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'gclsrc', 'msclkid', 'yclid', 'twclid', 'ttclid', 'igshid',
    'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'hsctatracking', 'mkt_tok', 'li_fat_id', 'ck_subscriber_id', '_kx',
    'ml_subscriber', 'ml_subscriber_hash', '_ga', '_gl', 'rb_clickid', 'oly_anon_id', 'oly_enc_id', 'vero_id',
    'vero_conv', 's_cid', 'sc_cid'
  ].map((p) => p.toLowerCase())
)
const TRACKING_PARAM_PREFIXES = ['utm_', '__hs', 'vero_', 'oly_', 'pk_', 'mtm_']

/** Parameters that only mean "tracking" on one site (elsewhere `trk` or `eid` could be a real setting). */
const SITE_PARAMS: { host: RegExp; params: Set<string> }[] = [
  {
    host: /(^|\.)linkedin\.com$/i,
    params: new Set(['trk', 'trkemail', 'trackingid', 'refid', 'midtoken', 'midsig', 'lipi', 'eid'])
  }
]

const MAX_UNWRAP_DEPTH = 3
const MAX_URL_LENGTH = 8192

// ---------------------------------------------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------------------------------------------

const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith('.' + suffix)

function parseUrl(raw: string): URL | null {
  const s = raw.trim()
  if (!s || s.length > MAX_URL_LENGTH) return null
  try {
    const u = new URL(s.startsWith('//') ? 'https:' + s : s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

function decodeBase64(s: string): string | null {
  if (!/^[A-Za-z0-9_\-+/]{12,}={0,2}$/.test(s)) return null
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/** The value as a web address if it is one, plain, percent-encoded once more, or base64; else null. */
function asHttpUrl(value: string): string | null {
  let v = value.trim()
  if (/^https?%3A/i.test(v)) {
    try {
      v = decodeURIComponent(v)
    } catch {
      return null
    }
  }
  if (!/^https?:\/\//i.test(v)) {
    const decoded = decodeBase64(v)
    if (!decoded || !/^https?:\/\//i.test(decoded)) return null
    v = decoded
  }
  return parseUrl(v) ? v : null
}

const isScanner = (host: string) => LINK_SCANNERS.some((s) => hostMatches(host, s))

function serviceFor(u: URL): TrackingService | null {
  const host = u.hostname.toLowerCase()
  const shape = u.pathname + u.search
  const byHost = SERVICES.find((s) => s.hosts?.some((h) => hostMatches(host, h)) || s.hostRe?.test(host))
  if (byHost) return byHost
  return SERVICES.find((s) => s.signature?.test(shape)) ?? null
}

// ---------------------------------------------------------------------------------------------------------------
// Tracking pixels
// ---------------------------------------------------------------------------------------------------------------

export interface PixelCandidate {
  /** The image's `src` attribute. */
  src: string
  /** The `width` and `height` attributes and the `style` attribute, as written. */
  width?: string | null
  height?: string | null
  style?: string | null
}

export interface TrackingPixel {
  /** Name of the Tracking service when WinMail knows it; null for an unknown one. */
  service: string | null
  host: string
}

/** Paths that are open trackers on any host. Only taken when the image does not say it is bigger than a speck. */
const GENERIC_PIXEL_PATH = new RegExp(
  [
    '\\/(?:track(?:ing)?\\/)?(?:email\\/)?opens?(?:\\/|\\.(?:gif|php|aspx?)$|$)',
    '\\/(?:o|pixel|beacon|px|trk|tracker|spacer)\\.(?:gif|png)$',
    '\\/(?:pixel|beacon|tracking?)(?:\\/|$)',
    '\\/wf\\/open$'
  ].join('|'),
  'i'
)

/** "1", "1px", "0.5" → the number; "100%", "auto", missing → null. */
function pixels(v: string | null | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(v ?? '')
  return m ? Number(m[1]) : null
}

function styleSize(style: string, prop: string): number | null {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style)
  return m ? pixels(m[1]) : null
}

function sizes(p: PixelCandidate): { w: number | null; h: number | null; hidden: boolean } {
  const style = p.style ?? ''
  const w = styleSize(style, 'width') ?? styleSize(style, 'max-width') ?? pixels(p.width)
  const h = styleSize(style, 'height') ?? styleSize(style, 'max-height') ?? pixels(p.height)
  const hidden =
    /(?:^|;)\s*display\s*:\s*none\b/i.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*hidden\b/i.test(style) ||
    /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$)/i.test(style)
  return { w, h, hidden }
}

/**
 * Whether a remote image is a Tracking pixel, and whose. It is one when it is hidden or tiny (both sides 2 px
 * or less, or one side 1 px with the other left to the image), when it is a known service's open-tracking
 * address at any size, or when its path is an open-tracking path and the page does not call it bigger than a
 * speck. Images from a Tracking service's host that are none of these (logos, photos) are not pixels.
 */
export function findTrackingPixel(p: PixelCandidate): TrackingPixel | null {
  const u = parseUrl(p.src)
  if (!u) return null // data:, cid: and relative addresses reach no server
  const svc = serviceFor(u)
  const { w, h, hidden } = sizes(p)
  const known = [w, h].filter((x): x is number => x !== null)
  const tiny =
    known.length === 2 ? known.every((x) => x <= 2) : known.length === 1 && known[0]! <= 1
  const big = known.some((x) => x > 2)
  const shape = u.pathname + u.search
  const isOpenUrl = !!svc?.pixel?.test(shape)
  const genericOpen = !big && GENERIC_PIXEL_PATH.test(u.pathname)
  if (!(hidden || tiny || isOpenUrl || genericOpen)) return null
  return { service: svc?.name ?? null, host: u.hostname.replace(/^www\./i, '') }
}

// ---------------------------------------------------------------------------------------------------------------
// Tracked links
// ---------------------------------------------------------------------------------------------------------------

/**
 * none: nothing to clean. stripped: tracking parameters removed. unwrapped: replaced by the destination written
 * inside it. marked: goes through a click-counting service whose destination is not in the link, so it is left
 * as it is and flagged.
 */
export type LinkChange = 'none' | 'stripped' | 'unwrapped' | 'marked'

export interface LinkResult {
  /** The address to use: the cleaned one, or the original when nothing could be done. */
  href: string
  change: LinkChange
  /** For marked links the host the click goes through; for unwrapped ones the host that was unwrapped. */
  via: string | null
  /** The Tracking service, when known. */
  service: string | null
}

function isTrackingParam(name: string, host: string): boolean {
  const n = name.toLowerCase()
  if (TRACKING_PARAMS.has(n) || TRACKING_PARAM_PREFIXES.some((p) => n.startsWith(p))) return true
  return SITE_PARAMS.some((s) => s.host.test(host) && s.params.has(n))
}

/** Removes tracking parameters, leaving every other part of the address as written. Returns null if none. */
function stripParams(u: URL): URL | null {
  if (!u.search) return null
  const parts = u.search.slice(1).split('&')
  const kept = parts.filter((part) => {
    const name = part.split('=')[0]!
    let decoded = name
    try {
      decoded = decodeURIComponent(name.replace(/\+/g, ' '))
    } catch {
      /* keep the raw name */
    }
    return !isTrackingParam(decoded, u.hostname)
  })
  if (kept.length === parts.length) return null
  const out = new URL(u.href)
  out.search = kept.length ? '?' + kept.join('&') : ''
  return out
}

interface Step {
  dest: string
  via: string
  service: string | null
}

/** One layer of wrapping removed, if the destination is written in the link. */
function unwrapOnce(u: URL): Step | null {
  const host = u.hostname.toLowerCase()
  for (const r of REDIRECTORS) {
    if (!r.host.test(host) || !r.path.test(u.pathname)) continue
    for (const name of r.params) {
      const dest = asHttpUrl(u.searchParams.get(name) ?? '')
      if (dest) return { dest, via: host, service: null }
    }
  }
  const svc = serviceFor(u)
  if (svc?.click?.test(u.pathname + u.search)) {
    const dest =
      svc.unwrap?.(u) ??
      DESTINATION_PARAMS.map((name) => asHttpUrl(u.searchParams.get(name) ?? '')).find((d) => d !== null) ??
      null
    if (dest) return { dest, via: host, service: svc.name }
  }
  return null
}

/**
 * Cleans one link without any network access: unwraps known redirects whose destination is in the link (up to
 * three layers), then strips tracking parameters. A link that still passes through a click-counting service
 * afterwards is returned unchanged and marked. Links the reader's own security scanner rewrote are never touched.
 */
export function cleanLink(href: string): LinkResult {
  const none: LinkResult = { href, change: 'none', via: null, service: null }
  let u = parseUrl(href)
  if (!u || isScanner(u.hostname.toLowerCase())) return none

  let first: Step | null = null
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    const step = unwrapOnce(u)
    if (!step) break
    const next = parseUrl(step.dest)
    if (!next) break
    first ??= step
    u = next
    if (isScanner(u.hostname.toLowerCase())) break // a scanner link inside: leave it as it is
  }

  const svc = serviceFor(u)
  if (svc?.click?.test(u.pathname + u.search)) {
    return { href: first ? u.href : href, change: 'marked', via: u.hostname.toLowerCase(), service: svc.name }
  }
  const stripped = isScanner(u.hostname.toLowerCase()) ? null : stripParams(u)
  if (first) {
    return { href: (stripped ?? u).href, change: 'unwrapped', via: first.via, service: first.service }
  }
  if (stripped) return { href: stripped.href, change: 'stripped', via: null, service: null }
  return none
}

// ---------------------------------------------------------------------------------------------------------------
// What a message contains
// ---------------------------------------------------------------------------------------------------------------

export interface TrackedPixel extends TrackingPixel {
  /** The image address, to count each once. */
  key: string
}

export interface TrackedLink {
  /** The link as the sender wrote it, to count each once. */
  key: string
  change: Exclude<LinkChange, 'none'>
  via: string | null
  service: string | null
}

export interface TrackerReport {
  pixels: TrackedPixel[]
  links: TrackedLink[]
}

export const newReport = (): TrackerReport => ({ pixels: [], links: [] })

export function addPixel(r: TrackerReport, src: string, pixel: TrackingPixel): void {
  if (!r.pixels.some((p) => p.key === src)) r.pixels.push({ key: src, ...pixel })
}

export function addLink(r: TrackerReport, original: string, res: LinkResult): void {
  if (res.change === 'none' || r.links.some((l) => l.key === original)) return
  r.links.push({ key: original, change: res.change, via: res.via, service: res.service })
}

export const hasTrackers = (r: TrackerReport) => r.pixels.length > 0 || r.links.length > 0

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/**
 * Who the message is tracked by: the services WinMail knows, in order of appearance. A pixel from an unknown host
 * is named by that host only when no known service is involved, so a sender's own hidden pixel does not read as
 * a second company.
 */
function trackerNames(r: TrackerReport): string[] {
  const known: string[] = []
  const add = (n: string | null) => n && !known.includes(n) && known.push(n)
  for (const p of r.pixels) add(p.service)
  for (const l of r.links) add(l.service)
  if (known.length) return known
  return [...new Set(r.pixels.map((p) => p.host))]
}

/** "Tracked by Mailchimp · 3 tracked links"; null when there is nothing to say. */
export function trackerHeadline(r: TrackerReport): string | null {
  if (!hasTrackers(r)) return null
  const names = trackerNames(r)
  const who =
    names.length === 0
      ? ''
      : 'Tracked by ' +
        (names.length <= 2
          ? names.join(' and ')
          : `${names[0]}, ${names[1]} and ${plural(names.length - 2, 'other')}`)
  const links = r.links.length ? plural(r.links.length, 'tracked link') : ''
  return [who, links].filter(Boolean).join(' · ')
}

/** The lines under the banner's Details. */
export function trackerDetails(r: TrackerReport): string[] {
  const lines: string[] = []
  const pixels = new Map<string, number>()
  for (const p of r.pixels) {
    const label = p.service ? `${p.service} (${p.host})` : p.host
    pixels.set(label, (pixels.get(label) ?? 0) + 1)
  }
  for (const [label, n] of pixels) {
    lines.push(`${n === 1 ? 'Tracking pixel' : plural(n, 'tracking pixel')} removed · ${label}`)
  }
  const count = (c: TrackedLink['change']) => r.links.filter((l) => l.change === c).length
  if (count('stripped')) lines.push(`${plural(count('stripped'), 'link')} cleaned · tracking parameters removed`)
  if (count('unwrapped')) lines.push(`${plural(count('unwrapped'), 'link')} unwrapped · opens the destination directly`)
  const marked = new Map<string, number>()
  for (const l of r.links) if (l.change === 'marked') marked.set(l.via ?? '', (marked.get(l.via ?? '') ?? 0) + 1)
  for (const [via, n] of marked) lines.push(`${plural(n, 'tracked link')} · goes through ${via}`)
  return lines
}

/** The note on a marked link. */
export const markedTitle = (via: string | null) => `Tracked link · goes through ${via ?? 'a tracking service'}`

// ---------------------------------------------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------------------------------------------

/** Web addresses in plain text, as one capture group so `text.split(URL_RE)` puts them at odd positions. */
export const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

export type TextPart = { text: string } | { text: string; href: string; change: LinkChange; via: string | null }

/** Plain text split into text and (cleaned) links, with what the shield found. */
export function shieldText(text: string): { parts: TextPart[]; report: TrackerReport } {
  const report = newReport()
  const parts = text.split(URL_RE).flatMap((piece, i): TextPart[] => {
    if (i % 2 === 0) return piece ? [{ text: piece }] : []
    const res = cleanLink(piece)
    addLink(report, piece, res)
    return [{ text: res.change === 'none' ? piece : res.href, href: res.href, change: res.change, via: res.via }]
  })
  return { parts, report }
}

/** The text with its links cleaned, for quoting and printing. */
export const cleanedText = (text: string): string =>
  shieldText(text)
    .parts.map((p) => p.text)
    .join('')
