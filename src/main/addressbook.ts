import type { Account, Contact, ProviderId } from '../shared/types'
import type { Creds } from './mail'

export interface AddressBook {
  /** Shown in Settings, e.g. "Google Contacts". */
  source: string
  /** Contacts the person saved. */
  saved: Contact[]
  /** Addresses the service collected automatically (Google's "Other contacts"). */
  other: Contact[]
}

/** CardDAV servers that accept the same app password as IMAP. */
const CARDDAV: Partial<Record<ProviderId, { url: string; source: string }>> = {
  icloud: { url: 'https://contacts.icloud.com/', source: 'iCloud Contacts' },
  fastmail: { url: 'https://carddav.fastmail.com/', source: 'Fastmail Contacts' }
}

/** The account's own address book, or null when its provider has none we can read. */
export async function fetchAddressBook(acc: Account, creds: Creds): Promise<AddressBook | null> {
  if (acc.provider === 'gmail') {
    if (!creds.accessToken) {
      throw new Error('Google Contacts need Google sign-in. Use Sign in with Google in Server Settings.')
    }
    return googleContacts(creds.accessToken)
  }
  const dav = CARDDAV[acc.provider]
  if (dav && creds.password) {
    return { source: dav.source, saved: await carddavContacts(dav.url, creds.username, creds.password), other: [] }
  }
  return null
}

// ---------- Google (People API) ----------

const PEOPLE_API = 'https://people.googleapis.com/v1'

interface Person {
  names?: { displayName?: string; metadata?: { primary?: boolean } }[]
  emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[]
}

async function googleContacts(accessToken: string): Promise<AddressBook> {
  const saved = await peoplePages(
    accessToken,
    `${PEOPLE_API}/people/me/connections?personFields=names,emailAddresses&pageSize=1000`,
    'connections'
  )
  // Optional: people may untick this permission on Google's consent screen.
  const other = await peoplePages(
    accessToken,
    `${PEOPLE_API}/otherContacts?readMask=names,emailAddresses&pageSize=1000`,
    'otherContacts'
  ).catch((err) => {
    console.error('[contacts] Google other contacts:', err instanceof Error ? err.message : err)
    return []
  })
  return { source: 'Google Contacts', saved, other }
}

async function peoplePages(accessToken: string, url: string, key: 'connections' | 'otherContacts') {
  const out: Contact[] = []
  let pageToken = ''
  do {
    const res = await fetch(pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string }
      nextPageToken?: string
    } & Partial<Record<typeof key, Person[]>>
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`
      if (/insufficient.*scope/i.test(msg)) {
        throw new Error('WinMail may not read your Google Contacts yet. Sign in again in Server Settings and allow it.')
      }
      if (/has not been used|is disabled/i.test(msg)) {
        throw new Error('Turn on the People API in your Google Cloud project, then restart WinMail.')
      }
      throw new Error(`Google Contacts: ${msg}`)
    }
    for (const p of data[key] ?? []) {
      const name = (p.names?.find((n) => n.metadata?.primary) ?? p.names?.[0])?.displayName ?? ''
      for (const e of p.emailAddresses ?? []) if (e.value) out.push({ name, email: e.value })
    }
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return out
}

// ---------- CardDAV (RFC 6352) ----------

const MULTIGET_BATCH = 100

async function dav(url: string, method: string, depth: string, body: string, auth: string): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
    body
  })
  if (res.status === 401 || res.status === 403) throw new Error('The contacts server rejected the password.')
  if (res.status !== 207) throw new Error(`Contacts server answered ${res.status} to ${method}.`)
  return res.text()
}

const decode = (s: string) =>
  s
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** Inner XML of every <prefix:name> element; namespace prefixes vary by server. */
function elements(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, 'g')
  return [...xml.matchAll(re)].map((m) => m[1] ?? '')
}

const first = (xml: string, name: string) => elements(xml, name)[0]
const href = (xml: string | undefined) => (xml ? decode(first(xml, 'href')?.trim() ?? '') : '')

async function carddavContacts(base: string, user: string, password: string): Promise<Contact[]> {
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
  const NS = 'xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"'

  const principalXml = await dav(base, 'PROPFIND', '0',
    `<d:propfind ${NS}><d:prop><d:current-user-principal/></d:prop></d:propfind>`, auth)
  const principal = new URL(href(first(principalXml, 'current-user-principal')) || base, base).toString()

  const homeXml = await dav(principal, 'PROPFIND', '0',
    `<d:propfind ${NS}><d:prop><card:addressbook-home-set/></d:prop></d:propfind>`, auth)
  const homeHref = href(first(homeXml, 'addressbook-home-set'))
  if (!homeHref) throw new Error('The contacts server did not say where the address books are.')
  const home = new URL(homeHref, principal).toString()

  const booksXml = await dav(home, 'PROPFIND', '1',
    `<d:propfind ${NS}><d:prop><d:resourcetype/></d:prop></d:propfind>`, auth)
  const books = elements(booksXml, 'response')
    .filter((r) => /<(?:[\w-]+:)?addressbook[\s/>]/.test(first(r, 'resourcetype') ?? ''))
    .map((r) => new URL(href(r), home).toString())

  const contacts: Contact[] = []
  for (const book of books) {
    const listXml = await dav(book, 'PROPFIND', '1',
      `<d:propfind ${NS}><d:prop><d:getetag/></d:prop></d:propfind>`, auth)
    const cards = elements(listXml, 'response')
      .map((r) => href(r))
      .filter((h) => h && new URL(h, book).toString() !== book)
    for (let i = 0; i < cards.length; i += MULTIGET_BATCH) {
      const hrefs = cards
        .slice(i, i + MULTIGET_BATCH)
        .map((h) => `<d:href>${h.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</d:href>`)
        .join('')
      const xml = await dav(book, 'REPORT', '1',
        `<card:addressbook-multiget ${NS}><d:prop><card:address-data/></d:prop>${hrefs}</card:addressbook-multiget>`,
        auth)
      for (const data of elements(xml, 'address-data')) contacts.push(...parseVCard(decode(data)))
    }
  }
  return contacts
}

/** FN and EMAIL lines of one vCard; one contact per address. */
function parseVCard(card: string): Contact[] {
  const lines = card.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  /** Where the value starts: the first colon that isn't inside a quoted parameter (PID="1:2"). */
  const valueStart = (line: string) => {
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted
      else if (line[i] === ':' && !quoted) return i + 1
    }
    return 0
  }
  const value = (line: string) =>
    line
      .slice(valueStart(line))
      .replace(/\\([,;\\])/g, '$1')
      .replace(/\\n/gi, ' ')
      .trim()
  const fn = lines.find((l) => /^(?:[\w-]+\.)?FN[;:]/i.test(l))
  const name = fn ? value(fn) : ''
  return lines
    .filter((l) => /^(?:[\w-]+\.)?EMAIL[;:]/i.test(l))
    .map((l) => ({ name, email: value(l).replace(/^mailto:/i, '') }))
    .filter((c) => c.email.includes('@'))
}
