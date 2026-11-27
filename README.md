# WinMail

Apple Mail-style email client for Windows. Electron + React + TypeScript.

## Run

Requires Node 18+ (Node 22 LTS recommended).

```bash
yarn install
yarn dev        # dev mode with hot reload
yarn build      # production build into out/
yarn test       # unit tests (Vitest) for the pure modules in src/shared
yarn dist:win   # Windows installer into dist/ (run on Windows)
```

Open `out/renderer/index.html` through a local server in a plain browser to get a mock mode with fake accounts (`?empty` starts with none, `?ai` acts as if a Claude key were saved; Summarise and Suggest a reply still start off until switched on in Settings > Claude; `?batch` turns Batched delivery on with three messages held and a Brief for the last Delivery, `?delivery` also makes a Delivery happen four seconds after launch, `?morning` makes the Brief a Morning brief, `?magazine` turns Newsletter magazine on with a week of issues).

## Website

The landing page lives in `website/`: a small Vite + React page that shares the app's colour tokens, Inter, lucide icons and `motion` curves. It has no build step in common with the Electron app.

```bash
yarn site:dev       # landing page with hot reload
yarn site:build     # static files into website/dist/ (relative paths, so any static host works)
```

Scrolling plays the page's animations: the app window tilts flat as it rises, sections and cards rise in, and the nav frosts over. Messages in the window can be clicked, and a Morning brief arrives a moment after the window comes into view. With reduced motion on in Windows or the browser, movement stops and only fades remain.

## Accounts

Add accounts from the welcome screen, the `+` in the sidebar, or Settings (`Ctrl+,`) > Accounts.

| Provider | Password to use |
| --- | --- |
| iCloud | App-specific password from account.apple.com |
| Google | **Sign in with Google** in your browser, or an app password from myaccount.google.com/apppasswords |
| Yahoo! | App password from Yahoo Account Security |
| Fastmail | App password from Settings > Privacy & Security |
| Other (IMAP) | Your mail password; enter IMAP and SMTP servers |
| Outlook | Not supported yet. Microsoft requires OAuth sign-in |

Credentials are verified against IMAP and SMTP before saving. Passwords and Google refresh tokens are encrypted with Electron `safeStorage` (Windows DPAPI) and stored in `%APPDATA%\winmail\winmail.json`.

### Adding Google accounts

Click **Sign in with Google** on the welcome screen (or `+` in the sidebar, then Google). WinMail opens Google in your browser, you pick the account and allow access, and it's added. Google always shows its account picker, so you can add several accounts one after another: the confirmation offers **Add Another Google Account**. Signing in to an address that is already added signs that account in again instead of failing.

WinMail receives the answer on `http://127.0.0.1:<random port>` (PKCE), and IMAP and SMTP then log in with XOAUTH2. Passwords and Google refresh tokens are encrypted with Electron `safeStorage` (Windows DPAPI).

Existing app-password Google accounts can switch with **Sign in with Google…** in Settings > Accounts > Server Settings. Removing a Google account revokes its token.

**"Google hasn't verified this app".** WinMail asks for full Gmail access (`https://mail.google.com/`), which Google treats as a restricted scope. Until the app passes Google's verification and security assessment, the installer's Google client shows this warning (click **Advanced**, then **Go to WinMail**) and at most 100 people can sign in through it. For more than that, or to avoid the warning, use your own client (below).

### Using your own Google client

Releases carry a Google client, but you can use your own with no rebuild: **Settings > Accounts > Google sign-in** > **Import client_secret.json…** (or enter the client ID and secret). Accounts keep using the client they signed in through; accounts that used a client you remove need to sign in again.

To make a client:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API** and the **People API** (for contacts).
2. **Google Auth Platform > Branding**: fill in the app name and your email.
3. **Audience**: choose External. While the app is in Testing, add your Gmail addresses as test users, and Google expires refresh tokens after 7 days (Settings > Accounts > Server Settings > Sign In Again). **In production** avoids that; without verification, 100 users can sign in.
4. **Data Access**: add the scopes `https://mail.google.com/`, `.../auth/contacts.readonly` and `.../auth/contacts.other.readonly`.
5. **Clients > Create client**: type **Desktop app**. Download the JSON.

### Building a release with a Google client

For a dev build, copy `.env.example` to `.env.local`, fill in the client ID and secret, then `yarn dev` or rebuild. For GitHub releases, add the repository secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; `.github/workflows/release.yml` builds them into the installer. A desktop app's client secret isn't confidential (Google's own guidance for installed apps), and PKCE protects the sign-in. Without these, the build has no Google client and people add their own in Settings.

## Features

- Multiple accounts, each with its own mailbox tree in the sidebar
- Unified "All Inboxes" plus per-account inboxes under Favourites
- Real IMAP: folders with unread counts, message list with previews, read/unread, flag, archive, delete, junk
- New mail push via IMAP IDLE, plus periodic check (Settings > General)
- Gmail-style compose in the main window: docked cards at the bottom right (minimize, full screen, several at once), recipient chips with To, Cc and Bcc, rich text with a formatting bar (or plain text mode), attachments by button, drag and drop or paste, per-account signatures, templates, emoji picker and spell check suggestions on right-click
- Drafts save to the account's Drafts folder as you type (and are kept locally in case of a crash), so they show up on your other devices; open one from Drafts to continue it
- Reply, reply all and forward open inline under the message, with the quote folded behind `···` and a button to pop the reply out into a docked card
- Undo send (Settings > General), Schedule send from the Send arrow, and an optional "Suggest a reply" with your Claude API key (switched on separately in Settings > Claude)
- SMTP sending with the From account picker; copy saved to Sent where the server doesn't do it
- Recipient autocomplete in To and Cc from the From account's address book (Google Contacts with Google sign-in, iCloud and Fastmail over CardDAV with the app password) plus people in its Sent mail and Inbox; cached in `%APPDATA%\winmail\contacts.json`, status in Settings > Accounts
- Mail is saved on this PC (`%APPDATA%\winmail\mail-cache.db`, not encrypted, size and Clear in Settings > General > Storage): folders you have opened and messages you have read show at once at startup and work offline, and a refresh downloads only what is new, removed or flagged instead of the whole list
- Undo for archive, delete, junk and moves; Move to any folder; Snooze (the message comes back to the Inbox, unread)
- Select several messages (Ctrl-click, Shift-click, Ctrl+A) and act on them at once
- Conversation view (Settings > General): replies grouped with a count, earlier messages shown above the newest; Gmail includes your Sent replies
- Server search: the search box also searches the server, with Gmail search operators on Google accounts; older mail loads as you scroll
- Gmail inbox tabs (Primary, Social, Promotions, Updates, Forums) on Google accounts
- One-click unsubscribe banner for mailing lists; Print and Show Original from the message's ··· menu; Mark All as Read on a folder's right-click menu
- Windows notifications for new mail while WinMail is in the background; click one to open the message
- Scheduled list in the sidebar to edit or cancel scheduled mail
- Waiting for: the hourglass in Compose's footer marks a message you expect an answer to. It turns on by itself when you ask people a question (not lists or no-reply addresses), and you can turn it off or pick 1 day to 2 weeks. If nobody replies in time (3 days by default), the message comes back as a nudge: a notification, and a count on **Waiting for** in the sidebar, whose list offers Follow Up, Wait Longer and Done. Out-of-office answers and bounces don't count as replies. All local: nothing moves on the server and nothing goes to Claude
- Batched delivery (Settings > Delivery, off by default): new Inbox mail waits and arrives together at set times (09:00, 13:00 and 17:00 to start with), with one notification. Mail from VIPs comes through at once; add them in Settings or from a message's menu. Above the Inbox, "Next delivery at 13:00" and **Deliver Now**. Held mail is hidden in WinMail only, so nothing changes on the server and search still finds it
- Newsletter magazine (Settings > Magazine, off by default): new newsletters leave the Inbox on the server for a Newsletters folder (a label on Gmail), so every device gets a calmer Inbox, and you read them under **Magazine** as one issue a day or a week. Receipts, codes, discussion lists and mail from people stay. **Not a Newsletter** and **Always a Newsletter** in a message's menu move it and remember the sender; Settings offers to move the newsletters already in your Inbox once. Nothing goes to Claude
- Unsubscribe audit (Settings > Magazine, or the envelope in the Magazine's header): every mailing list of the last 90 days, ranked by how much of it you actually open ("opened 0 of 48"). Tick several and leave them in one go: one-click lists are left directly, email-only lists get their unsubscribe email sent for you, and you can move their mail to the Bin too. Lists you left are remembered, and flagged if they keep sending
- The Brief: after each Delivery, a card at the top of the Inbox lists what needs you and why ("asks you a question", "invitation", "replied to you", "VIP"), everyone else by name, and the newsletters and notifications counted. The day's first is the Morning brief, which adds the replies you're still waiting for and a notification ("Morning brief · 12 messages, 3 need you"). Worked out on your PC; a Claude-written paragraph is optional and has its own switch in Settings > Claude
- Optional Claude features with your own API key (Settings > Claude): Summarise a message, Suggest a reply, AI search (ask for mail in plain language with the sparkle in the search box, or start with `?`). The key alone sends no mail to Claude: Summarise and Suggest a reply each send the message's sender, subject and text, so each has its own switch under "Send message content to Claude" (off until you turn it on), and their results are marked "Sent to Claude". AI search sends only your question
- HTML mail sanitised with DOMPurify in a sandboxed iframe; remote images blocked until you allow them
- Tracker shield: a banner such as "Tracked by Mailchimp · 3 tracked links" on mail that tracks you. Tracking pixels are removed even after you allow remote images; tracked links lose their tracking parameters, redirects that carry their destination are opened directly, and other click links are marked with the host they go through. All local: links are never fetched to see where they go
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
  shared/     Types and provider presets used by both processes; trackers.ts is the Tracker shield's rules, waiting.ts the
              Waiting for rules, delivery.ts and brief.ts Batched delivery and the Brief, newsletters.ts
              Newsletter magazine (all with tests)
  main/       Electron main process
    store.ts  Accounts, settings, encrypted passwords
    mail.ts   IMAP (imapflow) and SMTP (nodemailer), drafts on a second IMAP connection, incremental folder sync
    cache.ts  SQLite copy of folder lists and opened messages (node:sqlite), see CACHE.md
    outbox.ts Undo-send queue and scheduled mail
    waiting.ts  Waiting for: sent messages expecting a reply, reply detection and nudges (with tests)
    newsletters.ts  Newsletter magazine: moves new Newsletters out of the Inbox, sender rules (with tests)
    unsubscribe.ts  Unsubscribe audit: scanning list mail and leaving lists (with tests)
    attachments.ts  Which files the page may attach; temporary files for pasted images
    google.ts Google OAuth sign-in and access tokens
    contacts.ts / addressbook.ts  Autocomplete contacts: Google People API, CardDAV, mail history
    ipc.ts    IPC handlers
  preload/    Typed bridge (window.winmail)
  renderer/   React UI
    src/api.ts       Bridge, or mock when run in a browser
    src/components/  Sidebar, Toolbar, MessageList, MessageView, SettingsWindow,
                     AddAccount, Welcome, HtmlBody, ToastStack, Dialog, FolderPicker,
                     WhenPicker (snooze), SourceDialog, ScheduledDialog, WaitingDialog
    src/threads.ts   Conversation grouping
    src/print.ts     Printable copy of a message
    src/trackerShield.ts  Removes tracking pixels and cleans links in a message's HTML
    src/components/compose/  ComposeDock, ComposeWindow, ComposeForm, InlineReply,
                     RecipientField, RichEditor, FormatBar, ComposeFooter, ...
    src/compose/     Compose state and logic: sessions, actions, autosave, quote,
                     sanitize, outgoing (HTML and plain text), checks (see COMPOSE.md)
```

## Next steps

1. OAuth2 for Microsoft (enables Outlook)
2. Check the Gmail features against real accounts (see SPEC.md changelog)
