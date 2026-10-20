import type { ProviderId, ServerConfig } from './types'

export interface Provider {
  id: ProviderId
  name: string
  imap?: ServerConfig
  smtp?: ServerConfig
  /** Shown under the password field. */
  passwordHelp: string
  passwordUrl?: string
  /** Offers "Sign in with Google" instead of a password. */
  oauth?: boolean
  /** Server keeps a copy of sent mail itself, so we must not append one. */
  serverSavesSent: boolean
  /** Not usable yet (needs OAuth). */
  unsupported?: string
}

export const providers: Provider[] = [
  {
    id: 'icloud',
    name: 'iCloud',
    imap: { host: 'imap.mail.me.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
    passwordHelp: 'Use an app-specific password from your Apple Account, not your Apple ID password.',
    passwordUrl: 'https://account.apple.com/account/manage',
    serverSavesSent: false
  },
  {
    id: 'gmail',
    name: 'Google',
    imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
    passwordHelp: 'Turn on 2-Step Verification, then create an app password.',
    passwordUrl: 'https://myaccount.google.com/apppasswords',
    oauth: true,
    serverSavesSent: true
  },
  {
    id: 'yahoo',
    name: 'Yahoo!',
    imap: { host: 'imap.mail.yahoo.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'tls' },
    passwordHelp: 'Generate an app password in Yahoo Account Security.',
    passwordUrl: 'https://login.yahoo.com/account/security',
    serverSavesSent: false
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    imap: { host: 'imap.fastmail.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.fastmail.com', port: 465, security: 'tls' },
    passwordHelp: 'Create an app password in Settings > Privacy & Security.',
    passwordUrl: 'https://app.fastmail.com/settings/security/apppasswords',
    serverSavesSent: false
  },
  {
    id: 'outlook',
    name: 'Microsoft Outlook',
    imap: { host: 'outlook.office365.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' },
    passwordHelp: '',
    serverSavesSent: true,
    unsupported: 'Microsoft requires OAuth sign-in. Coming later.'
  },
  {
    id: 'other',
    name: 'Other Mail Account',
    passwordHelp: 'Your mail password, or an app password if your provider requires one.',
    serverSavesSent: false
  }
]

export function getProvider(id: ProviderId): Provider {
  return providers.find((p) => p.id === id) ?? providers[providers.length - 1]!
}
