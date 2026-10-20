# WinMail specification

Living document: what the app does, how it is built, what changed, and what is planned. Update the **Changelog** and **Roadmap** with every feature. User-facing setup lives in [README.md](README.md).

## 1. Overview

WinMail is an Apple Mail-style desktop email client for Windows.

- **Stack:** Electron 44, React 18, TypeScript, electron-vite. IMAP via `imapflow`, SMTP via `nodemailer`, parsing via `mailparser`, HTML sanitising via `DOMPurify`, icons from `lucide-react`.
- **Providers:** iCloud, Google (app password or Google sign-in with OAuth/XOAUTH2), Yahoo!, Fastmail, any IMAP/SMTP server. Outlook is listed but unsupported (needs Microsoft OAuth).
- **Principles:** standard IMAP/SMTP first so every provider benefits; Gmail-only extras (X-GM-RAW search, categories) are layered on when the account is Google.

## 2. Architecture

```
src/
  shared/      types.ts (data types + WinMailApi contract), providers.ts (presets)
  main/        Electron main process
    index.ts       Window creation, single instance, wiring, notifications, timers
    store.ts       winmail.json: accounts, settings, encrypted secrets
    mail.ts        MailService: IMAP connections, mailboxes, messages, search, move, send, drafts
    google.ts      Google OAuth (PKCE, loopback), access-token cache, revoke
    contacts.ts    Contact ranking and cache (contacts.json)
    addressbook.ts Google People API and CardDAV address books
    text.ts        Charset/transfer decoding, HTML-to-text, previews
    ipc.ts         IPC handlers (errors returned as data)
  preload/     index.ts: typed `window.winmail` bridge
  renderer/src/
    App.tsx        State, loading, actions, keyboard shortcuts
    api.ts         Real bridge or in-browser mock (mockApi.ts)
    components/    Sidebar, Toolbar, MessageList, MessageView, Compose, SettingsWindow,
                   AddAccount, Welcome, HtmlBody, RecipientInput, ContextMenu, Select, Toast, forms
```

- **IMAP connections:** one `ImapFlow` per account, reused; `withMailbox` locks a folder for each operation, then returns to INBOX after 3 s so IDLE keeps watching it.
- **Mock mode:** opening `out/renderer/index.html` in a browser uses `mockApi.ts` (`?empty` for no accounts). Every new API method must have a mock.

## 3. Data and storage

All under `%APPDATA%\winmail\`:

| File | Contents |
| --- | --- |
| `winmail.json` | `accounts`, `settings`, `secrets` (passwords / Google refresh tokens, encrypted with `safeStorage` = DPAPI), plus queues for snoozed and scheduled mail. Written atomically (tmp + rename); unreadable file is moved aside and the user warned. |
| `contacts.json` | Per-account contacts from address book and mail history. |

## 4. IPC API

Defined in `src/shared/types.ts` (`WinMailApi`), bridged in `src/preload/index.ts`, handled in `src/main/ipc.ts`.

| Method | Channel | Purpose |
| --- | --- | --- |
| listAccounts / addAccount / updateAccount / removeAccount | `accounts:*` | Account CRUD |
| testAccount | `accounts:test` | Verify IMAP + SMTP credentials |
| addGoogleAccount / reauthGoogleAccount / cancelGoogleSignIn | `accounts:*Google` | Google sign-in |
| getSettings / setSettings | `settings:*` | App settings |
| listMailboxes | `mail:mailboxes` | Folder tree with unread counts |
| listMessages | `mail:messages` | Newest N summaries of a folder |
| getMessage | `mail:message` | Full message (marks read) |
| setFlags | `mail:flags` | Seen / flagged |
| move | `mail:move` | Move to inbox / archive / junk / trash |
| saveAttachment | `mail:saveAttachment` | Save dialog + write |
| send | `mail:send` | SMTP send (+ append to Sent where needed) |
| listContacts / contactsStatus / onContactsChanged | `contacts:*` | Autocomplete |
| onMailChanged / onMailProgress | events | IDLE push, download progress |

New methods added by roadmap items are listed in the changelog entry that introduced them.

## 5. Feature spec (current behaviour)

**Accounts.** Added from Welcome, sidebar `+`, or Settings > Accounts. Credentials verified against IMAP and SMTP before saving. Google sign-in opens the browser (PKCE, loopback port). Accounts can be disabled, edited, removed (revokes Google token).

**Mailboxes.** Sidebar shows Favourites (unified Inbox + per-account inboxes) and each account's folder tree. Special folders detected via SPECIAL-USE and sorted: Inbox, Drafts, Sent, Junk, Bin, Archive, All Mail, Flagged. Unread counts for Inbox, Junk and custom folders.

**Message list.** Newest 60 per folder (unified inbox merges accounts by date); "Load Older Messages" raises the limit by 60. Rows show sender, date, subject, preview, unread dot, flag, attachment clip, account label in unified view. Right-click menu: reply, reply all, forward, read/unread, flag, move to inbox, archive, junk, delete. Search box filters loaded messages by sender, subject, preview.

**Reading.** HTML sanitised with DOMPurify in a sandboxed iframe; remote content blocked until allowed (or setting on). Message appearance light/dark/same as app. Plain text linkified. Attachments listed, click to save. Opening marks read.

**Compose.** To, Cc, Subject, From (when several accounts), plain-text body. Reply uses Reply-To when present; reply all drops yourself. Recipient autocomplete from the From account's address book and mail history. Ctrl+Enter sends; Esc closes.

**Sync.** IMAP IDLE on INBOX pushes new mail; periodic check every 1/5/15/30/60 min or manual. "Downloading N new messages" status in the list footer.

**Settings.** General: appearance, message content appearance, check interval, load remote content. Accounts: info, server settings, Google re-sign-in, contacts status.

**Shortcuts.** Ctrl+N new, Ctrl+R reply, Ctrl+Shift+R reply all, Ctrl+Shift+F forward, Ctrl+F search, Ctrl+, settings, Del delete, Up/Down move selection, Ctrl+Enter send, Esc close.

## 6. Changelog

### 2026-10-20 — Gmail feature survey + backend for all tiers (IN PROGRESS, renderer not done)
- Compared WinMail with Gmail; selected 20 features in three tiers (see Roadmap). Added this SPEC.md.
- **Done (main process + preload + mock):** new `WinMailApi` contract in `shared/types.ts` (search, listThread, getSource, multi-UID setFlags/move with `MoveResult` for undo, moveTo, markAllRead, snooze, saveText, print, unsubscribe, pickAttachments, pathForFile, saveDraft/deleteDraft/openDraft, scheduleSend/listScheduled/cancelScheduled, AI key + `ai()`, onOpenMessage); new settings (`undoSendSec`, `notifyNewMail`, `gmailShortcuts`, `conversations`, `composeFormat`, `templates`) and `Account.signature`.
- `mail.ts`: server search (X-GM-RAW on Gmail), threading fields (Message-ID, References, X-GM-THRID/THREADID), List-Unsubscribe parsing, Bcc + attachments + HTML sending with matching Message-ID in Sent copy, drafts in the Drafts folder, snooze to `WinMail Snoozed` with wake-up timer, new-mail detection for notifications.
- New `outbox.ts` (scheduled send, attachment copies in `%APPDATA%\winmail\outbox`), `ai.ts` (Claude Opus 5.5 via `@anthropic-ai/sdk`, low effort, server-side refusal fallback), store queues for snoozed/scheduled and encrypted AI key, Windows notifications with click-to-open, 30 s timer for snooze/schedule.
- **Not done yet:** all renderer UI (App, Compose, MessageList, MessageView, Sidebar, Toolbar, Settings, new dialogs, styles). The renderer does not typecheck until App.tsx is updated to the new `setFlags`/`move` signatures.

### Before 2026-10-20 — Contacts and UI polish (uncommitted work)
- Recipient autocomplete: Google Contacts (People API), iCloud/Fastmail CardDAV, plus people from Sent and Inbox (`contacts.ts`, `addressbook.ts`, `RecipientInput.tsx`); cached in `contacts.json`; status in Settings > Accounts.
- Right-click context menu on messages (`ContextMenu.tsx`).
- Custom `Select` component replacing native selects.
- `usePrefersDark` hook; message content appearance setting.

### Initial build
- Electron + React app with Mica sidebar, multi-account IMAP/SMTP, unified inbox, IDLE push, read/flag/archive/junk/delete, reply/forward, sanitised HTML, attachments, Google OAuth sign-in, settings window, mock mode.

## 7. Roadmap

Status: `[x]` done, `[ ]` planned. *Gmail-only* items only apply to Google accounts.

### Tier 1 — high value
- [ ] Undo send (configurable delay)
- [ ] Undo archive / delete / junk / move
- [ ] Server-side search (IMAP SEARCH; Gmail operators via X-GM-RAW)
- [ ] Load more on scroll
- [ ] Compose: Bcc, attachments (picker + drag and drop), drafts autosave and reopen
- [ ] Desktop notifications for new mail

### Tier 2 — productivity
- [ ] Multi-select and bulk actions
- [ ] Gmail-style single-key shortcuts (optional)
- [ ] Conversation view
- [ ] Move to any folder
- [ ] Per-account signatures
- [ ] One-click unsubscribe (List-Unsubscribe, RFC 8058)

### Tier 3 — nice to have
- [ ] Snooze
- [ ] Schedule send
- [ ] Rich-text compose
- [ ] Templates (canned responses)
- [ ] Mark all as read
- [ ] Print and show original
- [ ] Inbox categories *(Gmail-only)*
- [ ] AI summarise and suggested reply (opt-in, Claude API key)

### Not planned
- Confidential mode, Chat/Meet/Spaces: Google services, not mail.
- Server-side filters UI and vacation responder: need the Gmail API or per-provider Sieve.
- Outlook: needs Microsoft OAuth (tracked separately).
