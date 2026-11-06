import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_SETTINGS,
  type Account,
  type AccountInput,
  type AccountUpdate,
  type AuthMethod,
  type LabelColour,
  type LabelSupport,
  type OutboxKind,
  type ScheduledInfo,
  type SendInput,
  type Settings
} from '../shared/types'
import { normaliseOptIns } from '../shared/contentFeatures'

/** A snoozed message, found again by Message-ID when it is due. */
export interface Snoozed {
  accountId: string
  messageId: string
  /** ISO time. */
  until: string
}

/** A message waiting to be sent at `sendAt`. Attachments are copies kept in the outbox folder. */
export interface Scheduled extends ScheduledInfo {
  input: SendInput
  /** Missing on items saved before undo send existed, which are all scheduled. */
  kind?: OutboxKind
  /** An undo-send message that failed; it waits here until Compose takes it back. */
  failed?: boolean
}

/** What WinMail keeps about one label on this PC. */
export interface LabelStyle {
  /** Display name; keywords only (a Gmail label's name is its name on the server). */
  name?: string
  colour?: LabelColour
  /** Deleted in WinMail: a keyword the server still lists, or a default, is not offered again. */
  deleted?: boolean
}

/** Labels of one account: what the server allows, keywords seen there, and names and colours set here. */
export interface AccountLabelStore {
  support?: LabelSupport
  /** Keywords the server listed (FLAGS of the inbox), for working offline. */
  seen?: string[]
  styles: Record<string, LabelStyle>
}

/** Secret slot for the Claude API key, next to the account secrets. */
const AI_SECRET = 'ai:anthropic'

interface StoreFile {
  version: 1
  accounts: Account[]
  /**
   * accountId -> base64 of safeStorage-encrypted password (DPAPI on Windows),
   * or the Google refresh token for OAuth accounts.
   */
  secrets: Record<string, string>
  settings: Settings
  snoozed: Snoozed[]
  scheduled: Scheduled[]
  /** accountId -> labels; kept apart from `settings` so a settings save from the renderer never overwrites them. */
  labels: Record<string, AccountLabelStore>
}

const fresh = (): StoreFile => ({
  version: 1,
  accounts: [],
  secrets: {},
  settings: { ...DEFAULT_SETTINGS },
  snoozed: [],
  scheduled: [],
  labels: {}
})

/** Saved settings over the defaults; Content opt-ins missing from an older file are off (ADR 0001). */
function withDefaults(s: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...s, contentOptIns: normaliseOptIns(s?.contentOptIns) }
}

export class Store {
  private file = join(app.getPath('userData'), 'winmail.json')
  /** Attachment copies for scheduled mail. */
  readonly outboxDir = join(app.getPath('userData'), 'outbox')
  private data: StoreFile
  /** Set when the settings file could not be read and was moved aside. */
  recoveredFrom: string | null = null

  constructor() {
    this.data = this.load()
  }

  private load(): StoreFile {
    if (!existsSync(this.file)) {
      return fresh()
    }
    let raw: Partial<StoreFile>
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoreFile>
    } catch (err) {
      // Keep the unreadable file for recovery and start fresh rather than failing to launch.
      const backup = `${this.file}.corrupt-${Date.now()}`
      renameSync(this.file, backup)
      this.recoveredFrom = backup
      console.error('Settings file unreadable, moved to', backup, err)
      return fresh()
    }
    return {
      version: 1,
      accounts: raw.accounts ?? [],
      secrets: raw.secrets ?? {},
      settings: withDefaults(raw.settings),
      snoozed: raw.snoozed ?? [],
      scheduled: raw.scheduled ?? [],
      labels: raw.labels ?? {}
    }
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  private encrypt(password: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system.')
    }
    return safeStorage.encryptString(password).toString('base64')
  }

  listAccounts(): Account[] {
    return this.data.accounts
  }

  getAccount(id: string): Account {
    const a = this.data.accounts.find((x) => x.id === id)
    if (!a) throw new Error('Account not found.')
    return a
  }

  getPassword(id: string): string {
    const s = this.data.secrets[id]
    if (!s) throw new Error('No password saved for this account.')
    return safeStorage.decryptString(Buffer.from(s, 'base64'))
  }

  addAccount(input: AccountInput): Account {
    const { password, ...rest } = input
    const account: Account = { ...rest, id: randomUUID() }
    this.data.secrets[account.id] = this.encrypt(password)
    this.data.accounts.push(account)
    this.save()
    return account
  }

  /** `auth` is set only by sign-in; settings edits keep the saved method. */
  updateAccount({ account, password }: AccountUpdate, auth?: AuthMethod): Account {
    const i = this.data.accounts.findIndex((x) => x.id === account.id)
    if (i < 0) throw new Error('Account not found.')
    const saved: Account = { ...account, auth: auth ?? this.data.accounts[i]!.auth }
    this.data.accounts[i] = saved
    if (password) this.data.secrets[account.id] = this.encrypt(password)
    this.save()
    return saved
  }

  removeAccount(id: string): void {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)
    delete this.data.secrets[id]
    this.data.snoozed = this.data.snoozed.filter((x) => x.accountId !== id)
    this.data.scheduled = this.data.scheduled.filter((x) => x.accountId !== id)
    delete this.data.labels[id]
    this.save()
  }

  getSettings(): Settings {
    return this.data.settings
  }

  setSettings(s: Settings): Settings {
    this.data.settings = withDefaults(s)
    this.save()
    return this.data.settings
  }

  // ---------- Labels ----------

  accountLabels(accountId: string): AccountLabelStore {
    return this.data.labels[accountId] ?? { styles: {} }
  }

  setAccountLabels(accountId: string, labels: AccountLabelStore): void {
    this.data.labels[accountId] = labels
    this.save()
  }

  // ---------- Snoozed and scheduled mail ----------

  listSnoozed(): Snoozed[] {
    return this.data.snoozed
  }

  setSnoozed(list: Snoozed[]): void {
    this.data.snoozed = list
    this.save()
  }

  listScheduled(): Scheduled[] {
    return this.data.scheduled
  }

  setScheduled(list: Scheduled[]): void {
    this.data.scheduled = list
    this.save()
  }

  // ---------- Claude API key ----------

  hasAiKey(): boolean {
    return !!this.data.secrets[AI_SECRET]
  }

  getAiKey(): string | null {
    const s = this.data.secrets[AI_SECRET]
    return s ? safeStorage.decryptString(Buffer.from(s, 'base64')) : null
  }

  setAiKey(key: string | null): void {
    if (key) this.data.secrets[AI_SECRET] = this.encrypt(key)
    else delete this.data.secrets[AI_SECRET]
    this.save()
  }
}
