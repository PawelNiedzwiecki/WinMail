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
    mail.ts        MailService: IMAP connections, mailboxes, messages, search, move, send, drafts, folder sync
    cache.ts       MailCache: SQLite copy of folder lists and opened messages (mail-cache.db)
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
| `mail-cache.db` (+ `-wal`, `-shm`) | SQLite (`node:sqlite`): folder list and unread counts per account, the newest ≤ 500 messages of each folder visited (summaries and previews), bodies of messages opened (≤ 5 MB each, ≤ 250 MB in all), Gmail category tabs. Plain, unencrypted. Only a cache: a damaged or newer file is deleted and rebuilt, and it works from memory if the disk fails. Folders unopened for 60 days drop their messages. Cleared in Settings > General > Storage. See CACHE.md. |

## 4. IPC API

Defined in `src/shared/types.ts` (`WinMailApi`), bridged in `src/preload/index.ts`, handled in `src/main/ipc.ts`.

| Method | Channel | Purpose |
| --- | --- | --- |
| listAccounts / addAccount / updateAccount / removeAccount | `accounts:*` | Account CRUD |
| testAccount | `accounts:test` | Verify IMAP + SMTP credentials |
| addGoogleAccount / reauthGoogleAccount / cancelGoogleSignIn | `accounts:*Google` | Google sign-in |
| getSettings / setSettings | `settings:*` | App settings |
| listMailboxes | `mail:mailboxes` | Folder tree with unread counts |
| cachedMailboxes / cachedList / cacheSize / clearCache | `mail:cachedMailboxes`, `mail:cachedList`, `mail:cacheSize`, `mail:clearCache` | The saved copy on this PC, read without a connection |
| listMessages | `mail:messages` | Newest N summaries of a folder |
| getMessage | `mail:message` | Full message (marks read) |
| setFlags | `mail:flags` | Seen / flagged |
| move | `mail:move` | Move to inbox / archive / junk / trash |
| saveAttachment | `mail:saveAttachment` | Save dialog + write |
| answerInvite / openInvite | `mail:answerInvite`, `mail:openInvite` | RSVP to a calendar invitation (iMIP REPLY to the organiser); open its .ics in the default calendar app |
| send | `mail:send` | SMTP send (+ append to Sent where needed) |
| queueSend / cancelScheduled / takeFailedSends / onOutbox | `outbox:queue`, `outbox:cancel`, `outbox:takeFailed`, event `outbox:event` | Undo send: held for `undoSendSec`, then sent; failures come back once |
| addDroppedFiles / saveClipboardImage | `compose:addFiles`, `compose:saveImage` | Attach dropped files or a pasted image (paths are checked in main) |
| showEmojiPanel / onCloseRequested / closeReady | `app:emoji`, `app:close-requested`, `app:close-ready` | Emoji picker; save drafts before the window closes |
| listContacts / contactsStatus / onContactsChanged | `contacts:*` | Autocomplete |
| onMailChanged / onMailProgress | events | IDLE push, download progress |

New methods added by roadmap items are listed in the changelog entry that introduced them.

## 5. Feature spec (current behaviour)

**Accounts.** Added from Welcome, sidebar `+`, or Settings > Accounts. Credentials verified against IMAP and SMTP before saving. Google sign-in opens the browser (PKCE, loopback port). Accounts can be disabled, edited, removed (revokes Google token).

**Mailboxes.** Sidebar shows Favourites (unified Inbox + per-account inboxes) and each account's folder tree. Special folders detected via SPECIAL-USE and sorted: Inbox, Drafts, Sent, Junk, Bin, Archive, All Mail, Flagged. Unread counts for Inbox, Junk and custom folders.

**Message list.** Newest 60 per folder (unified inbox merges accounts by date); "Load Older Messages" raises the limit by 60. Rows show sender, date, subject, preview, unread dot, flag, attachment clip, account label in unified view. Right-click menu: reply, reply all, forward, read/unread, flag, move to inbox, archive, Move to…, Snooze…, junk, delete. Older messages load on scroll. Optional conversation grouping with a count badge. Multi-select with Ctrl/Shift-click. Search filters loaded messages at once, then searches the server (Gmail operators on Google). Gmail inboxes have category tabs.

**Reading.** HTML sanitised with DOMPurify in a sandboxed iframe; remote content blocked until allowed (or setting on). Message appearance light/dark/same as app. Plain text linkified. Attachments listed above the body, click to save. Double-click a message in the list to open it in its own window. Opening marks read (the whole conversation when grouped). More menu: Print, Show Original, Summarise (Claude key), Move to, Snooze. Mailing lists get an Unsubscribe banner. Calendar invitations show an event card: date, time in your time zone, place, organiser and guests, Yes / Maybe / No, Add to Calendar.

**Compose.** Docked cards (bottom right; minimize, full screen, several at once) and inline replies under the message. Recipient chips (To, Cc, Bcc), From when several accounts, rich text or plain text, attachments, signature, templates. Reply uses Reply-To when present; reply all drops yourself and never uses the original Bcc. Drafts autosave to the Drafts folder; Esc or Ctrl+W saves and closes; Ctrl+Enter sends after the undo delay. See COMPOSE.md.

**Sync.** IMAP IDLE on INBOX pushes new mail; periodic check every 1/5/15/30/60 min or manual. "Downloading N new messages" status in the list footer. Folders and opened messages are saved on this PC (`mail-cache.db`): the sidebar, counts and every folder seen before show at once at startup and work offline, then are brought up to date. A refresh asks the server for its UIDs from the saved range (new and removed mail), the flags that changed (CONDSTORE `CHANGEDSINCE` where available, a full flag read otherwise) and fetches only the new messages; a non-inbox folder whose last LIST-STATUS shows no change is not opened at all. More than 200 new messages in a folder start its list again. Everything that acts on a message sends the folder's UIDVALIDITY with it and is refused if the server renumbered the folder. Mail that arrived while WinMail was closed is not announced.

**Settings.** General: appearance, message content appearance, check interval, load remote content, Storage (size of the saved mail, Clear). Accounts: info, server settings, Google re-sign-in, contacts status.

**Notifications.** Windows toasts for new inbox mail while no WinMail window is focused: sender avatar, subject and preview, inline reply (sent through the undo-send outbox), Archive and Mark as read; more than 3 at once become one summary with Mark all as read. Settings > Notifications: on/off, all mail / Primary only / people I know, per-account switches, preview (full / sender / hidden), sound, quiet hours, test button, unread count on the taskbar button. See NOTIFICATIONS.md.

**Shortcuts.** Ctrl+N new, Ctrl+R reply, Ctrl+Shift+R reply all, Ctrl+Shift+F forward, Ctrl+F search, Ctrl+, settings, Del delete, Up/Down move selection (Shift extends), Ctrl+A select all, Ctrl+Enter send, Esc close. Optional Gmail keys: j/k, e, #, !, r, a, f, s, Shift+I/U, x, b, v, z, c, /.

## 6. Changelog

### 2026-10-23 — Calendar invitations
- Messages with an iCalendar part (Outlook, Google Calendar, iCloud invitations; a text/calendar alternative or an attached .ics) show an **event card** above the attachments: title, date tile, when (in your time zone, all-day and multi-day handled), place with links, organiser and guest count (hover for each guest's answer), Repeats for series. Cancellations are struck through; a guest's reply reads "Sam Patel accepted".
- **Yes / Maybe / No** emails the organiser an iMIP REPLY (RFC 5546): `Accepted: …` with a `text/calendar; method=REPLY` part holding the event's UID, SEQUENCE, times and time zones and you as the only attendee, so the organiser's calendar records it. Sent through SMTP like other mail, with a copy in Sent. The answer is kept with the saved message.
- **Add to Calendar** (Open in Calendar for cancellations and replies) writes the .ics to a temporary file and opens it in the default calendar app, which adds, updates or removes the event.
- The inline text/calendar part no longer shows as an unnamed attachment.
- New: `main/calendar.ts` (`parseInvite`, `buildReply`, using `ical.js` for Outlook's own time zone definitions), `components/InviteCard.tsx`, `MessageDetail.invite`, `CalendarInvite` / `InviteAnswer` types, `mail.answerInvite` / `inviteFile`; `send()` takes an optional calendar part. Messages saved locally before this are fetched once more if they carry an invitation (the saved copy is used offline).
- Checked: parser and reply tests (Outlook VTIMEZONE in winter and summer time, UTC, all-day, recurring, cancel, bad input, reply round-trip, UTC DTSTAMP); the MIME nodemailer builds; mock mode UI in light, dark and a narrow window. Not checked against a real organiser's calendar.

### 2026-10-21 — Mail saved on this PC and incremental sync (details, decisions and checklist in CACHE.md)
- **Saved copy:** new `main/cache.ts` (`MailCache`, `node:sqlite`, no native module) writes the folder list, each visited folder's newest messages and the bodies of opened messages to `%APPDATA%\winmail\mail-cache.db`. Startup seeds the sidebar and counts from it; the first visit to a folder paints from it with no skeleton and then updates quietly; opened messages and Gmail category tabs work offline. All Inboxes keeps an unreachable account's rows.
- **Incremental sync:** `listMessages` fetches only new messages, removes expunged ones, re-reads only changed flags, and can skip a non-inbox folder entirely when LIST-STATUS shows no change. A refused SEARCH never empties the window; rows the server volunteers are ignored.
- **Safety:** `uidValidity` travels with every message and with every call that acts on one (`getMessage`, `getSource`, `setFlags`, `move`, `moveTo`, `snooze`, `saveAttachment`, `openDraft`); a renumbered folder refuses the call, wipes its saved copy and emits `mail:changed { reset: true }`. Draft UIDs are remembered with their validity in main. `setFlags` and trash delete now fail when the server refuses (imapflow returns false).
- **Upkeep:** newest 500 messages per folder, 60-day idle folders dropped, 250 MB of bodies (oldest opened first); account removal or a changed IMAP host/port/user clears an account. Settings > General > Storage shows the size and has Clear.
- New API methods (with mocks; `?nocache` and `?offline` in mock mode): `cachedMailboxes`, `cachedList`, `cacheSize`, `clearCache`; optional trailing `uidValidity` on the calls above; `MessageSummary.uidValidity`, `MoveResult.uidValidity`, `MailChangedEvent.reset`.
- Checked with a fake IMAP server driving the real `listMessages` (first visit, no-change refresh downloads nothing, new/flagged/expunged mail, refused search, volunteered rows, load more, 300-message burst, no CONDSTORE, UIDVALIDITY change, skip-without-select), cache unit scripts (write-through, recovery, trim) and the mock UI (instant paint, offline). Not checked with a real account: Gmail and non-Gmail sync, relaunch offline, the renumbered-folder refusal.

### 2026-10-21 — Message windows, attachments on top, reading pane scrolls again
- **Fix:** the reading pane didn't scroll. The toolbar refactor put `MessageView` in the column-flex `.reader`, and `.viewer` had no `min-height: 0`, so it grew to the message's height and was clipped. Checked in mock mode: before, the pane was taller than its space with no scroll; after, it scrolls, also with the wheel over an HTML body.
- **Double-click a message** in the list to open it in a window of its own (drafts still open in compose). The same message again brings its window forward; message windows close with the main window. Reply, Reply All and Forward there open a compose window via the main window (`PopoutMessage` `reply`, `replyInWindow` in `compose/actions.ts`; `reply()` takes a `host`). The More menu has Print.
- **Attachments** are listed above the message body instead of below it.
- New: `components/MessageWindow.tsx` (page `#message`), `openReader` / `childWindow` in `main/index.ts` (pop-outs share `childWindow`). API: `openMessageWindow` (`reader:open`, main window only), `messageWindowPayload` (`reader:payload`); message windows may use `popoutSend`.
- Checked in Electron with Playwright: the window opens with the message, de-duplicates, closes at once and with the main window. Not checked with a real account: loading a real message, replying from the window.

### 2026-10-21 — Notifications redesign (details in NOTIFICATIONS.md)
- New `main/notifications.ts` (`Notifier`) replaces the inline `announce` in `index.ts`: avatar drawn by the renderer (`notifyArt.ts`), inline reply via `Outbox.queue`, Archive / Mark as read buttons, summary toast, account headers when several accounts are on.
- Settings: `notifyFilter`, `notifyMutedAccounts`, `notifySound`, `notifyPreview`, `quietHours` / `quietStart` / `quietEnd`, `taskbarBadge`; new Settings > Notifications page (the switch left General). `Contacts.isKnown()` backs "People I know".
- API: `testNotification`, `onNotificationAvatar`, `setTaskbarBadge`. Shared helpers `quietHours.ts`, `subject.ts`.

### 2026-10-20 — Inbox categories for every account, optional
- Setting `inboxCategories` (default on), in Settings → General → Message list. Off hides the tabs and clears any active category filter.
- Tabs now show on every account's inbox and on All inboxes, with a segmented-control design and icons; inactive tabs collapse to icons when the list is narrow.
- Google accounts still use Gmail's own sorting (`category:` search). Other accounts are sorted by WinMail: `shared/categorize.ts` looks at the sender domain and address, subject, and the List-Id, List-Unsubscribe, Precedence and Auto-Submitted headers (fetched with the list in `fetchSummaries`; `MessageSummary.category`). It is a heuristic and errs towards Primary. The category filter applies to the messages already loaded, so use Load more to dig further.
- Each tab has its own colour (icon tint, fill when active). Switching tab, folder or account shows skeleton rows (`ListSkeleton` in `MessageList.tsx`, `listSwitching` in `App.tsx`) instead of the old rows vanishing and returning; the sidebar folder list shows skeleton lines while mailboxes load.
- Not yet checked in the running app or with real non-Google accounts.

### 2026-10-20 — Settings redesign
- Settings window rebuilt: navigation on the left (General, Composing, Shortcuts, Claude, Accounts), cards of settings with a title and description on the left and a control on the right, switches instead of checkboxes, segmented choices for theme and format, a shortcuts reference, and account details in cards with a Save bar pinned to the bottom. Same settings and behaviour as before.
- New settings rows go in `components/SettingsWindow.tsx` using `Group` / `Item` / `Switch` / `Segmented` from `components/settings/controls.tsx`; styles are in `settings.css`. The old `.settings*` rules in `styles.css` are no longer used.

### 2026-10-20 — Gmail features in the reading and list UI (all roadmap tiers done; real-account checks still to do)
- **Undo for moves:** archive, delete, junk, Move to… and Move to Inbox show a toast with Undo (moves back using the `MoveResult` UIDs); `z` undoes the last one.
- **Multi-select:** Ctrl-click, Shift-click, Shift+Up/Down, Ctrl+A; Esc clears. Toolbar, context menu and shortcuts act on every selected message; the reading pane shows "N Messages Selected".
- **Server search:** after 400 ms the search box asks the server (Gmail operators on Google accounts) for the open mailbox, or every inbox in All Inboxes; the loaded list is filtered instantly first.
- **Load on scroll:** older messages load when the list is scrolled near the end (the button stays as a fallback).
- **Conversations** (Settings, on by default): rows grouped by Gmail thread id, else Message-ID / References within an account, with a count badge; opening one marks it all read and shows earlier messages as collapsible cards above the newest (Gmail adds your Sent replies from All Mail). Actions apply to the whole conversation.
- **Move to…** folder picker (type to filter), **Snooze** (later today, tomorrow, this weekend, next week, or a date) from the toolbar, context menu, More menu, `v` / `b`.
- **Reading pane:** More menu (Print, Show Original with Copy / Save as .eml, Summarise with a Claude key, Move to, Snooze); mailing-list banner with Unsubscribe (RFC 8058 one-click POST, else a prefilled mailto message, else the link).
- **Sidebar:** Scheduled entry while sends are scheduled (Edit or Cancel send, with Undo); right-click a folder for Mark All as Read.
- **Gmail inbox tabs:** All, Primary, Social, Promotions, Updates, Forums on a Google account's Inbox (`category:` search).
- **Notifications:** clicking one opens that message.
- **Settings > General:** Notifications, Group by conversation, Gmail-style single-key shortcuts, Claude API key.
- New files: `components/Dialog.tsx`, `FolderPicker.tsx`, `WhenPicker.tsx`, `SourceDialog.tsx`, `ScheduledDialog.tsx`, `threads.ts`, `print.ts`; `compose/actions.ts` gained `openInput`.
- Checked in mock mode (offscreen Electron): conversation grouping and expansion, multi-select, archive + Undo, Show Original, unsubscribe, snooze, Move to…, server search, Gmail tabs, folder menu. Not yet checked with real accounts.

### 2026-10-20 — Gmail-style compose (compose UI done; details and checklist in COMPOSE.md)
- Compose is no longer a modal. Docked cards at the bottom right (minimize, full screen, several at once, "+N" overflow), recipient chips with To/Cc/Bcc, rich-text editor with formatting bar (plain text mode per message or by default), attachments (picker, drag and drop, paste), signatures, templates, emoji, spell check menu, Schedule send, Undo send, "Suggest a reply" (Claude key). Replies and forwards are inline under the message with a pop-out. Drafts autosave to the server Drafts folder with a local recovery copy; Drafts open for editing.
- Renderer: `src/renderer/src/compose/` (state and logic), `components/compose/` (UI), `toasts.ts` + `ToastStack` (bottom-left notifications with actions, for everyone to use). `Compose.tsx` and `RecipientInput.tsx` are gone.
- Main: undo-send queue in `outbox.ts` (`queueSend`, `takeFailedSends`, `onOutbox`); drafts and Sent copies on a second IMAP connection (Gmail drafts go via Trash so old versions don't pile up in All Mail); `data:` images sent as inline parts; attachment paths accepted only if the user picked or dropped them (`attachments.ts`); minimal app menu (Ctrl+R no longer reloads); close handshake so drafts are saved before the window closes; spelling context menu; `accounts:update` reconnects only when connection settings change.
- Fixed so the renderer typechecks with the new API: `App.tsx` uses `DEFAULT_SETTINGS` and UID arrays, `Sidebar.tsx` has an icon for the Snoozed folder.
- For other features: use `toast()` from `toasts.ts` for notifications (e.g. undo archive); single-key shortcuts must ignore events inside `.compose, [data-compose]`, contentEditable and inputs; shortcuts go in `compose/keys.ts` (matched on `e.code`, never with Alt, because AltGr is Ctrl+Alt on Windows).

### 2026-10-20 — Gmail feature survey + backend for all tiers
- Compared WinMail with Gmail; selected 20 features in three tiers (see Roadmap). Added this SPEC.md.
- **Done (main process + preload + mock):** new `WinMailApi` contract in `shared/types.ts` (search, listThread, getSource, multi-UID setFlags/move with `MoveResult` for undo, moveTo, markAllRead, snooze, saveText, print, unsubscribe, pickAttachments, pathForFile, saveDraft/deleteDraft/openDraft, scheduleSend/listScheduled/cancelScheduled, AI key + `ai()`, onOpenMessage); new settings (`undoSendSec`, `notifyNewMail`, `gmailShortcuts`, `conversations`, `composeFormat`, `templates`) and `Account.signature`.
- `mail.ts`: server search (X-GM-RAW on Gmail), threading fields (Message-ID, References, X-GM-THRID/THREADID), List-Unsubscribe parsing, Bcc + attachments + HTML sending with matching Message-ID in Sent copy, drafts in the Drafts folder, snooze to `WinMail Snoozed` with wake-up timer, new-mail detection for notifications.
- New `outbox.ts` (scheduled send, attachment copies in `%APPDATA%\winmail\outbox`), `ai.ts` (Claude Opus 5.5 via `@anthropic-ai/sdk`, low effort, server-side refusal fallback), store queues for snoozed/scheduled and encrypted AI key, Windows notifications with click-to-open, 30 s timer for snooze/schedule.
- The renderer for these landed in the two entries above.

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
- [x] Undo send (configurable delay)
- [x] Undo archive / delete / junk / move
- [x] Server-side search (IMAP SEARCH; Gmail operators via X-GM-RAW)
- [x] Load more on scroll
- [x] Compose: Bcc, attachments (picker + drag and drop), drafts autosave and reopen
- [x] Desktop notifications for new mail
- [x] Mail saved on this PC: offline reading, instant startup, incremental sync

### Tier 2 — productivity
- [x] Multi-select and bulk actions
- [x] Gmail-style single-key shortcuts (optional)
- [x] Conversation view
- [x] Move to any folder
- [x] Per-account signatures (plain text)
- [x] One-click unsubscribe (List-Unsubscribe, RFC 8058)

### Tier 3 — nice to have
- [x] Snooze
- [x] Schedule send (from compose; Scheduled list in the sidebar)
- [x] Rich-text compose
- [x] Templates (canned responses)
- [x] Mark all as read
- [x] Print and show original
- [x] Inbox categories *(Gmail-only)*
- [x] AI summarise and suggested reply (opt-in, Claude API key)

### Not planned
- Confidential mode, Chat/Meet/Spaces: Google services, not mail.
- Server-side filters UI and vacation responder: need the Gmail API or per-provider Sieve.
- Outlook: needs Microsoft OAuth (tracked separately).
- ~~double click should open the mail in new window~~ done 2026-10-21
- ~~mails are not scrollable~~ fixed 2026-10-21
- labels in mails
- integrating AI to summarise mails or search specific criteria
- ~~picking up attachments at the top of the mail~~ done 2026-10-21
- ~~picking up any additional events etc.~~ calendar invitations done 2026-10-23
- ~~redesign notifications~~ done 2026-10-21 (NOTIFICATIONS.md)
