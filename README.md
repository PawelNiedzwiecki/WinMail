# WinMail

Apple Mail-style email client for Windows. Electron + React + TypeScript.

## Run

Requires Node 18+ (Node 22 LTS recommended).

```bash
npm install
npm run dev        # dev mode with hot reload
npm run build      # production build into out/
npm run dist:win   # Windows installer into dist/ (run on Windows)
```

Open `out/renderer/index.html` through a local server in a plain browser to get a mock mode with fake accounts (`?empty` starts with none).

## Accounts

Add accounts from the welcome screen, the `+` in the sidebar, or Settings (`Ctrl+,`) > Accounts.

| Provider | Password to use |
| --- | --- |
| iCloud | App-specific password from account.apple.com |
| Google | Sign in with Google in your browser (see setup below), or an app password from myaccount.google.com/apppasswords |
| Yahoo! | App password from Yahoo Account Security |
| Fastmail | App password from Settings > Privacy & Security |
| Other (IMAP) | Your mail password; enter IMAP and SMTP servers |
| Outlook | Not supported yet. Microsoft requires OAuth sign-in |

Credentials are verified against IMAP and SMTP before saving. Passwords and Google refresh tokens are encrypted with Electron `safeStorage` (Windows DPAPI) and stored in `%APPDATA%\winmail\winmail.json`.

### Google sign-in setup

Sign in with Google needs your own OAuth client:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API** and the **People API** (for contacts).
2. **Google Auth Platform > Branding**: fill in the app name and your email.
3. **Audience**: choose External. While the app is in Testing, add your Gmail addresses as test users.
4. **Data Access**: add the scopes `https://mail.google.com/`, `.../auth/contacts.readonly` and `.../auth/contacts.other.readonly`.
5. **Clients > Create client**: type **Desktop app**. Copy the client ID and secret.
6. Copy `.env.example` to `.env.local`, fill in both values, then `npm run dev` or rebuild.

WinMail opens Google in your default browser and receives the answer on `http://127.0.0.1:<random port>` (PKCE). IMAP and SMTP then log in with XOAUTH2.

In Testing mode Google expires refresh tokens after 7 days, so you will have to sign in again weekly (Settings > Accounts > Server Settings > Sign In Again). To avoid that, set the app to **In production** under Audience. Without Google's verification, people see an "unverified app" warning, and at most 100 users can sign in.

Existing app-password Google accounts can switch with **Sign in with Google…** in the same place. Removing a Google account revokes its token.

## Features

- Multiple accounts, each with its own mailbox tree in the sidebar
- Unified "All Inboxes" plus per-account inboxes under Favourites
- Real IMAP: folders with unread counts, message list with previews, read/unread, flag, archive, delete, junk
- New mail push via IMAP IDLE, plus periodic check (Settings > General)
- SMTP sending with reply, reply all, forward and From account picker; copy saved to Sent where the server doesn't do it
- Recipient autocomplete in To and Cc from the From account's address book (Google Contacts with Google sign-in, iCloud and Fastmail over CardDAV with the app password) plus people in its Sent mail and Inbox; cached in `%APPDATA%\winmail\contacts.json`, status in Settings > Accounts
- HTML mail sanitised with DOMPurify in a sandboxed iframe; remote images blocked until you allow them
- Attachments: click to save
- Windows 11 Mica sidebar, native window buttons, light and dark mode

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+N | New message |
| Ctrl+R / Ctrl+Shift+R | Reply / Reply all |
| Ctrl+Shift+F | Forward |
| Ctrl+F | Search |
| Ctrl+, | Settings |
| Del | Delete |
| Up / Down | Previous / next message |
| Ctrl+Enter | Send |
| Esc | Close dialog |

## Structure

```
src/
  shared/     Types and provider presets used by both processes
  main/       Electron main process
    store.ts  Accounts, settings, encrypted passwords
    mail.ts   IMAP (imapflow) and SMTP (nodemailer)
    google.ts Google OAuth sign-in and access tokens
    contacts.ts / addressbook.ts  Autocomplete contacts: Google People API, CardDAV, mail history
    ipc.ts    IPC handlers
  preload/    Typed bridge (window.winmail)
  renderer/   React UI
    src/api.ts       Bridge, or mock when run in a browser
    src/components/  Sidebar, Toolbar, MessageList, MessageView, Compose,
                     SettingsWindow, AddAccount, Welcome, HtmlBody
```

## Next steps

1. OAuth2 for Microsoft (enables Outlook)
2. Local SQLite cache for offline reading and instant startup
3. Server-side search (IMAP SEARCH) across all mail
4. Rich-text compose and attachments on send
5. Threads / conversations
