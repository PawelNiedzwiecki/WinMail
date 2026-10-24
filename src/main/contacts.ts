import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import addressparser from 'nodemailer/lib/addressparser'
import type { Account, Address, Contact, ContactsStatus } from '../shared/types'
import { fetchAddressBook } from './addressbook'
import type { MailService } from './mail'
import type { Store } from './store'

/** Saved contacts first, then people you write to, then people who write to you. */
const SAVED_WEIGHT = 10
const SENT_WEIGHT = 5
const RECEIVED_WEIGHT = 1

/** Automated senders nobody wants to write to. */
const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([+._-]|@)/i

interface Entry {
  name: string
  email: string
  score: number
}

interface AccountContacts {
  /** From the account's mail. */
  mail: Entry[]
  /** From the account's address book. */
  book: Entry[]
  bookSaved: number
  bookSource: string | null
  bookError: string | null
  /** Lower-case addresses of saved contacts and people you've written to. */
  known?: string[]
}

interface ContactsFile {
  version: 2
  accounts: Record<string, AccountContacts>
}

const empty = (): AccountContacts => ({ mail: [], book: [], bookSaved: 0, bookSource: null, bookError: null })

export class Contacts {
  private file = join(app.getPath('userData'), 'contacts.json')
  private accounts: Record<string, AccountContacts> = {}
  /** Accounts scanned since launch; each is scanned once per session unless re-signed in. */
  private scanned = new Set<string>()
  private scanning: Promise<void> | null = null

  constructor(
    private store: Store,
    private mail: MailService,
    private emit: (accountId: string) => void
  ) {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as
        | ContactsFile
        | { version: 1; accounts: Record<string, Entry[]> }
      if (raw.version === 2) this.accounts = raw.accounts
      else for (const [id, mail] of Object.entries(raw.accounts ?? {})) this.accounts[id] = { ...empty(), mail }
    } catch (err) {
      // Only a cache, rebuilt on the next scan.
      console.error('Contacts file unreadable, starting empty:', err)
    }
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    const data: ContactsFile = { version: 2, accounts: this.accounts }
    writeFileSync(tmp, JSON.stringify(data), 'utf8')
    renameSync(tmp, this.file)
  }

  /** Saved contacts right away; a scan in the background sends `contacts:changed` when done. */
  list(accountId: string): Contact[] {
    void this.scan()
    const c = this.accounts[accountId]
    if (!c) return []
    const own = new Set(this.store.listAccounts().map((a) => a.email.toLowerCase()))
    const all = new Map<string, Entry>()
    // Address book first so its names win over whatever senders put in From.
    for (const e of [...c.book, ...c.mail]) {
      const key = e.email.toLowerCase()
      if (own.has(key)) continue
      const prev = all.get(key)
      if (prev) {
        prev.score += e.score
        prev.name ||= e.name
      } else all.set(key, { ...e })
    }
    return [...all.values()]
      .sort((a, b) => b.score - a.score || (a.name || a.email).localeCompare(b.name || b.email))
      .map(({ name, email }) => ({ name, email }))
  }

  status(accountId: string): ContactsStatus {
    const c = this.accounts[accountId] ?? empty()
    return {
      source: c.bookSource,
      saved: c.bookSaved,
      fromMail: c.mail.length,
      error: c.bookError,
      // A paused account is never scanned, so it would otherwise read "loading" forever.
      loading: !this.scanned.has(accountId) && !!this.store.listAccounts().find((a) => a.id === accountId)?.enabled
    }
  }

  /** A saved contact or someone you've written to, as opposed to anyone who has mailed you. */
  isKnown(accountId: string, email: string): boolean {
    return this.accounts[accountId]?.known?.includes(email.toLowerCase()) ?? false
  }

  /** Reads the account again, e.g. after signing in with new permissions. */
  rescan(accountId: string): void {
    this.scanned.delete(accountId)
    void this.scan()
  }

  /** Scans accounts not scanned this session, one at a time. Errors are kept per account, not thrown. */
  scan(): Promise<void> {
    if (this.scanning) return this.scanning
    this.scanning = (async () => {
      let acc: Account | undefined
      while ((acc = this.store.listAccounts().find((a) => a.enabled && !this.scanned.has(a.id)))) {
        await this.scanAccount(acc)
        this.scanned.add(acc.id)
        this.save()
        this.emit(acc.id)
      }
      const ids = new Set(this.store.listAccounts().map((a) => a.id))
      for (const id of Object.keys(this.accounts)) if (!ids.has(id)) delete this.accounts[id]
    })().finally(() => (this.scanning = null))
    return this.scanning
  }

  private async scanAccount(acc: Account): Promise<void> {
    const c = (this.accounts[acc.id] ??= empty())
    const [mail, book] = await Promise.allSettled([
      this.mail.collectAddresses(acc.id),
      this.mail.credentials(acc.id).then((creds) => fetchAddressBook(acc, creds))
    ])

    const known = new Set(c.known)
    if (mail.status === 'fulfilled') {
      const entries = new Map<string, Entry>()
      add(entries, mail.value.sent, SENT_WEIGHT)
      for (const a of mail.value.sent) known.add(a.email.trim().toLowerCase())
      add(entries, mail.value.received, RECEIVED_WEIGHT)
      c.mail = [...entries.values()]
    } else {
      console.error(`[contacts ${acc.email}] mail scan failed:`, errorText(mail.reason))
    }

    if (book.status === 'fulfilled') {
      const entries = new Map<string, Entry>()
      add(entries, book.value?.saved ?? [], SAVED_WEIGHT)
      for (const a of book.value?.saved ?? []) known.add(a.email.trim().toLowerCase())
      c.bookSaved = entries.size
      add(entries, book.value?.other ?? [], RECEIVED_WEIGHT)
      c.book = [...entries.values()]
      c.bookSource = book.value?.source ?? null
      c.bookError = null
    } else {
      // Keep the last good copy so autocomplete still works offline.
      c.bookError = errorText(book.reason)
      console.error(`[contacts ${acc.email}] address book failed:`, c.bookError)
    }
    c.known = [...known]
  }

  /** Counts recipients of a message just sent, so they show up before the next scan. */
  recordSent(accountId: string, ...fields: (string | undefined)[]): void {
    const addrs = fields
      .filter((f): f is string => !!f)
      .flatMap((f) => addressparser(f, { flatten: true }))
      .map((a) => ({ name: a.name, email: a.address }))
    const c = (this.accounts[accountId] ??= empty())
    const entries = new Map(c.mail.map((e) => [e.email.toLowerCase(), e]))
    add(entries, addrs, SENT_WEIGHT)
    c.mail = [...entries.values()]
    c.known = [...new Set([...(c.known ?? []), ...addrs.map((a) => a.email.toLowerCase())])]
    this.save()
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function add(entries: Map<string, Entry>, addrs: Address[], weight: number): void {
  for (const a of addrs) {
    const email = a.email.trim()
    if (!email.includes('@') || NO_REPLY.test(email)) continue
    // Some clients put the address itself in the name.
    const name = a.name.trim().replace(/^["']|["']$/g, '')
    const clean = name.toLowerCase() === email.toLowerCase() ? '' : name
    const key = email.toLowerCase()
    const e = entries.get(key)
    if (e) {
      e.score += weight
      e.name ||= clean
    } else entries.set(key, { name: clean, email, score: weight })
  }
}
