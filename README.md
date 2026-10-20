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
- Gmail-style compose in the main window: docked cards at the bottom right (minimize, full screen, several at once), recipient chips with To, Cc and Bcc, rich text with a formatting bar (or plain text mode), attachments by button, drag and drop or paste, per-account signatures, templates, emoji picker and spell check suggestions on right-click
- Drafts save to the account's Drafts folder as you type (and are kept locally in case of a crash), so they show up on your other devices; open one from Drafts to continue it
- Reply, reply all and forward open inline under the message, with the quote folded behind `···` and a button to pop the reply out into a docked card
- Undo send (Settings > General), Schedule send from the Send arrow, and an optional "Suggest a reply" with your Claude API key
- SMTP sending with the From account picker; copy saved to Sent where the server doesn't do it
- Recipient autocomplete in To and Cc from the From account's address book (Google Contacts with Google sign-in, iCloud and Fastmail over CardDAV with the app password) plus people in its Sent mail and Inbox; cached in `%APPDATA%\winmail\contacts.json`, status in Settings > Accounts
- Undo for archive, delete, junk and moves; Move to any folder; Snooze (the message comes back to the Inbox, unread)
- Select several messages (Ctrl-click, Shift-click, Ctrl+A) and act on them at once
- Conversation view (Settings > General): replies grouped with a count, earlier messages shown above the newest; Gmail includes your Sent replies
- Server search: the search box also searches the server, with Gmail search operators on Google accounts; older mail loads as you scroll
- Gmail inbox tabs (Primary, Social, Promotions, Updates, Forums) on Google accounts
- One-click unsubscribe banner for mailing lists; Print and Show Original from the message's ··· menu; Mark All as Read on a folder's right-click menu
- Windows notifications for new mail while WinMail is in the background; click one to open the message
- Scheduled list in the sidebar to edit or cancel scheduled mail
- Optional Claude features with your own API key (Settings > General): Summarise a message, Suggest a reply
- HTML mail sanitised with DOMPurify in a sandboxed iframe; remote images blocked until you allow them
- Attachments in received mail: click to save
- Windows 11 Mica sidebar, native window buttons, light and dark mode

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+N | New message |
| Ctrl+R / Ctrl+Shift+R | Reply / Reply all |
| Ctrl+Shift+F | Forward (in a message: choose the From account) |
| Ctrl+F | Search |
| Ctrl+, | Settings |
| Ctrl+. | Next open message card |
| Del | Delete |
| Up / Down | Previous / next message (with Shift: extend the selection) |
| Ctrl+A / Esc | Select all messages / clear the selection |
| Enter / double-click | Open a draft in Drafts |

With Gmail-style shortcuts on (Settings > General), outside text fields:

| Keys | Action |
| --- | --- |
| j / k | Next / previous message |
| e / # / ! | Archive / delete / junk |
| r / a / f | Reply / reply all / forward |
| s | Flag |
| Shift+I / Shift+U | Mark read / unread |
| x | Add to or remove from the selection |
| v / b | Move to… / Snooze |
| z | Undo the last move |
| c / / | Compose / search |

In a message card or inline reply:

| Keys | Action |
| --- | --- |
| Ctrl+Enter | Send |
| Ctrl+S | Save draft now |
| Esc / Ctrl+W | Save and close (Esc leaves full screen first; in an inline reply it returns to the list) |
| Ctrl+Shift+D | Discard draft |
| Ctrl+Shift+C / Ctrl+Shift+B | Add Cc / Bcc |
| Ctrl+K | Insert link |
| Ctrl+B / I / U | Bold / italic / underline |
| Ctrl+Shift+7 / 8 / 9 | Numbered list / bulleted list / quote |
| Ctrl+[ / Ctrl+] | Indent less / more |
| Ctrl+\ | Remove formatting |
| Ctrl+Shift+V | Paste as plain text |
| Shift+Esc | Back to the message list |

## Structure

```
src/
  shared/     Types and provider presets used by both processes
  main/       Electron main process
    store.ts  Accounts, settings, encrypted passwords
    mail.ts   IMAP (imapflow) and SMTP (nodemailer), drafts on a second IMAP connection
    outbox.ts Undo-send queue and scheduled mail
    attachments.ts  Which files the page may attach; temporary files for pasted images
    google.ts Google OAuth sign-in and access tokens
    contacts.ts / addressbook.ts  Autocomplete contacts: Google People API, CardDAV, mail history
    ipc.ts    IPC handlers
  preload/    Typed bridge (window.winmail)
  renderer/   React UI
    src/api.ts       Bridge, or mock when run in a browser
    src/components/  Sidebar, Toolbar, MessageList, MessageView, SettingsWindow,
                     AddAccount, Welcome, HtmlBody, ToastStack, Dialog, FolderPicker,
                     WhenPicker (snooze), SourceDialog, ScheduledDialog
    src/threads.ts   Conversation grouping
    src/print.ts     Printable copy of a message
    src/components/compose/  ComposeDock, ComposeWindow, ComposeForm, InlineReply,
                     RecipientField, RichEditor, FormatBar, ComposeFooter, ...
    src/compose/     Compose state and logic: sessions, actions, autosave, quote,
                     sanitize, outgoing (HTML and plain text), checks (see COMPOSE.md)
```

## Next steps

1. OAuth2 for Microsoft (enables Outlook)
2. Local SQLite cache for offline reading and instant startup
3. Check the Gmail features against real accounts (see SPEC.md changelog)
