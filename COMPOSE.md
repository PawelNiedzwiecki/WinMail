# Compose redesign tracker

Working record for the Gmail-style compose redesign. Update it at the end of every step: tick the to-do, add a change-log entry, and move items between "to verify" and "verified". The finished features also go into `SPEC.md` (Changelog and Roadmap) in step 12.

## Goal

Replace the centered, blocking Apple Mail-style compose dialog with Gmail's compose experience, keeping WinMail's Apple / Windows 11 look (existing tokens, Inter, radii, light and dark).

## Decisions (2026-10-20, planning session)

| Topic | Decision |
|---|---|
| Where compose lives | Docked cards at the bottom right of the main window. Non-blocking, minimize to a title bar, full screen, several at once. A card can also pop out into a window of its own (see "Pop-out windows"). |
| Close | Close (x), Esc and Ctrl+W mean Save & close. Clicking outside never closes a card. Discard (trash, Ctrl+Shift+D) deletes the draft, with Undo. |
| Recipients | Chips for To, Cc and Bcc; invalid addresses turn red and block Send; From picker when there are several accounts. |
| Body | Rich text with Gmail's formatting bar (toggled by "A", shown by default). Sends HTML plus a plain-text copy. Plain-text mode per message (default from `composeFormat`). |
| Attachments | Paperclip, drag and drop, pasted files and images (inline up to 5 MB). Provider attachment limit and Gmail's blocked types checked before sending. |
| Drafts | Auto-saved to the account's server Drafts folder (Gmail-like) and reopened from Drafts. A local recovery copy covers crashes and being offline. |
| Undo send | Delay from `undoSendSec` (default 10 s), run by the main-process Outbox so it survives a quit or crash. |
| Replies | Reply, Reply all and Forward open inline under the message; pop out to a docked card; quote folded behind `···`. |
| Signatures | One per account (plain-text `Account.signature`), with `-- ` in new mail only, above the quote in replies, swapped on From change if unedited. |
| Extras | Schedule send (Send ▾), Templates (More ⋮), AI suggested reply (inline replies, needs a Claude key), emoji (Windows panel), spellcheck right-click menu. |

Full plan: `C:\Users\ivell\.claude\plans\i-want-to-improve-tranquil-nova.md`.

## Work split with the other session

The other Claude session, `port-gmail-features-spec`, implements the rest of the `SPEC.md` roadmap.

- **This session (compose)**: everything inside the compose cards and the inline reply, plus these pieces:
  - the shared `ToastStack`
  - the backend fixes listed below
  - Settings rows for Undo send, Compose format and Signature
- **Other session**: the Scheduled list in the sidebar, AI summarise, undo for archive / delete / move, server search, conversation view, snooze, notifications, Gmail single-key shortcuts, and the rest of SPEC Tiers 1-3.
- **Shared files**: `App.tsx` (keyboard handler), `MessageView.tsx`, `MessageList.tsx`, `SettingsWindow.tsx`, `styles.css`, `types.ts`, `mail.ts`, `outbox.ts`, `ipc.ts`, `preload/index.ts`, `mockApi.ts`. Re-read before every edit and keep edits small.
- **Notes for the other session**:
  - Use `toasts.ts` (`toast({ text, actions, duration })`) for undo-archive and other notifications instead of a second toast system.
  - Single-key shortcuts must ignore events whose target is inside `.compose, [data-compose]`, is contentEditable, or is an input, textarea or select.
  - Use `keys.ts` (`e.code` plus `!e.altKey`) for new shortcuts. On Polish layouts AltGr is reported as Ctrl+Alt, so ą ę ś ć ń ł ż ź ó must never trigger a shortcut.
  - MessageView has an inline-reply slot under the message. In conversation view, put it under the newest message of the thread.

## To-do

- [x] **0. Prepare**
  - [x] Other session idle; its renderer pass not landed. The tree failed typecheck with 4 errors.
  - [x] Baseline commit `804cc99` (everything as found, both sessions' work).
  - [x] Minimal fixes so the tree typechecks (see change log).
  - [x] `npm run typecheck` and `npm run build` pass.
- [x] **1. Backend fixes** (code done and reviewed; Electron checks with real accounts still to do, see "To verify")
  - [x] 1. Undo-send queue:
    - `queueSend`
    - `kind: 'undo'` items with their own timer
    - a `sending` state, so `cancel` says "Too late to undo"
    - `takeFailedSends`
    - `onOutbox`
    - 15 min launch rule
    - quit flush of undo items with a 15 s deadline and `app.exit()`
    - `recordSent` for Outbox sends
  - [x] 2. Drafts (the retry list is in memory only, not kept across launches: UIDs without UIDVALIDITY are unsafe to keep):
    - `withUpload` second connection
    - Gmail Trash detour for old versions
    - retry list for failed removals
    - Message-ID fallback when `append` returns no UID
    - error text when there's no Drafts folder
  - [x] 3. `data:` images to `cid` parts in `mailOptions`; `disableUrlAccess: true`.
  - [x] 4. Attachments:
    - `addDroppedFiles`
    - `saveClipboardImage`
    - accept only main-issued paths in `send`, `saveDraft`, `queueSend` and `scheduleSend`
    - temp clean-up after 7 days
  - [x] 5. `accounts:update` reconnects only when server, login or enabled settings change.
  - [x] 6. Window lifecycle:
    - minimal app menu (no Ctrl+R / Ctrl+Shift+R / Ctrl+W accelerators)
    - close handshake
    - reload on `render-process-gone`
  - [x] 7. Context menu with spelling suggestions and edit roles; `showEmojiPanel`.
  - [x] 8. Providers: `maxAttachmentsMB`, `blockedExtensions` (gmail).
  - [x] 9. Mock API for all of the above.
- [x] **2. Toasts**: `toasts.ts` and `ToastStack` (bottom left, with actions); App's string toast moves onto it.
- [x] **3. Cards**
  - `sessions`, `dockLayout`, `keys`, `actions` (new message)
  - `ComposeDock`, `ComposeWindow`, `ComposeForm`
  - Esc and keyboard rules, z-index
  - Delete `Compose.tsx`.
- [x] **4. Recipients**: `addresses`, `RecipientField`, `RecipientsBlock`, Bcc, From; delete `RecipientInput.tsx`.
- [x] **5. Editor**: `RichEditor`, `editorCommands`, `FormatBar`, `LinkPopover`, `sanitize`, `outgoing`, plain-text mode, paste and drop.
- [x] **6. Attachments**: picker, drop overlay, chips, pasted images, limits.
- [x] **7. Drafts**: autosave (with hash), status, Save & close, discard with Undo, recovery copy, close handshake, opening from a Drafts mailbox, list refresh.
- [x] **8. Send**: checks, undo send, `takeFailedSends`, Schedule send.
- [x] **9. Inline replies**:
  - `quote.ts` (replaces `App.respond`)
  - `InlineReply`, reply buttons, type switching, pop-out
  - the selection-change rule, "Draft" tags
  - Bcc line, Forward attachments
  - `allowRemote` lifted to App
- [x] **10. Signatures**: Settings field, insert, swap and toggle.
- [x] **11. Extras**: Templates, AI suggested reply, emoji, Settings General rows.
- [x] **12. Docs and pass** (README and SPEC.md done; dark mode and 900 x 560 checked in mock mode; Mica and reduced motion not checked):
  - Docs: `README.md`, and `SPEC.md` (changelog, IPC table, roadmap ticks).
  - Pass: dark mode, Mica, reduced motion, the 900 × 560 minimum window.

## Change log

### 2026-10-20: step 0 (prepare)
- **Baseline commit `804cc99`**: the whole working tree as found, including the other session's uncommitted backend work.
- **Minimal typecheck fixes**: the other session's new API had not been wired into the renderer yet.
  - `src/renderer/src/App.tsx`:
    - The initial settings now come from `DEFAULT_SETTINGS` (`@shared/types`).
    - `api.move` and `api.setFlags` get `[uid]`; the API now takes UID arrays.
  - `src/renderer/src/components/Sidebar.tsx`: added a `snoozed: AlarmClock` icon for the new `snoozed` special-use folder.
- `npm run typecheck` and `npm run build` now pass.

### 2026-10-20: step 1 (backend fixes)
- **`src/shared/types.ts`**:
  - New types `OutboxKind`, `QueuedSend`, `OutboxEvent`, `FailedSend`.
  - New `WinMailApi` methods: `addDroppedFiles`, `saveClipboardImage`, `queueSend`, `takeFailedSends`, `onOutbox`, `showEmojiPanel`, `onCloseRequested`, `closeReady`.
- **`src/shared/providers.ts`**: `maxAttachmentsMB` per provider; `blockedExtensions` for Gmail.
- **`src/main/store.ts`**: `Scheduled` gains `kind` (`undo` or `scheduled`, missing means scheduled) and `failed`.
- **`src/main/outbox.ts`**:
  - `queue()` holds a message for the undo delay (capped at 60 s), on its own timer.
  - `cancel()` refuses messages already being sent.
  - `takeFailed()` hands failures back once.
  - `resume()` re-arms timers at launch; anything more than 15 min overdue becomes a failure.
  - `flushUndo()` sends pending undo items at quit.
  - `sendDue()` handles scheduled items only.
  - Sends call `recordSent`.
  - Attachment copies are named with `basename(filename)`.
  - `cleanup()` keeps unqueued copies for 7 days.
- **New `src/main/attachments.ts`**:
  - `AttachmentGrants`: paths the user picked or dropped, plus WinMail's own folders (outbox, `%TEMP%\winmail`).
  - `saveTempFile`: pasted images, 25 MB at most.
  - `cleanTemp`: deletes temp files older than 7 days.
- **`src/main/mail.ts`**:
  - `withUpload` second connection, closed after 60 s idle and on disconnect. `saveDraft`, `deleteDraft` and the Sent copy use it.
  - `removeDrafts`: Gmail goes through Trash; failed removals go to an in-memory retry list; disabled accounts are skipped.
  - `saveDraft` finds the UID by Message-ID when the server doesn't return one.
  - Clearer error when there is no Drafts folder (Gmail: "Show in IMAP").
  - `mailOptions` turns `data:` images into cid parts and sets `disableUrlAccess`.
  - `openDraft` uses `TEMP_ROOT`.
- **`src/main/ipc.ts`**:
  - Attachment paths are checked on `mail:send`, `mail:saveDraft`, `outbox:schedule` and `outbox:queue`.
  - New channels: `compose:addFiles`, `compose:saveImage`, `outbox:queue`, `outbox:takeFailed`, and `app:emoji` (fire-and-forget).
  - `accounts:update` reconnects only for server, login or enabled changes.
- **`src/main/index.ts`**:
  - Minimal app menu: Edit, plus View > DevTools when unpackaged.
  - Close handshake (`app:close-requested` / `app:close-ready`, 10 s fallback, immediate while loading or crashed).
  - Reload on `render-process-gone`.
  - Spelling context menu.
  - Outbox events go out on `outbox:event`, with `resume()`, `cleanup()` and `cleanTemp()` at start.
  - `before-quit` flushes undo items and disconnects under a 15 s deadline, then `app.exit(0)`.
- **`src/preload/index.ts`**: the new bridge methods. `saveClipboardImage` checks the 25 MB limit before reading the file.
- **`src/renderer/src/mockApi.ts`**:
  - `queueSend` with its timer; a subject containing "fail" makes it fail.
  - `takeFailedSends`, `onOutbox`, `addDroppedFiles`, `saveClipboardImage`, emoji and close stubs.
  - Drafts keep their full `SendInput`, so `openDraft` returns every field.
- **`src/renderer/src/App.tsx`**: answers `onCloseRequested` immediately, until Compose saves drafts there (step 7).

### 2026-10-20: step 2 (toasts)
- **New `src/renderer/src/toasts.ts`**:
  - `toast(text | { text, tone, actions, busy, duration, id })` returns an id; passing that id replaces the toast in place.
  - `dismiss(id)` and `useToasts()`.
  - At most 3 at once. Info lasts 6 s, errors 10 s; a duration of 0 keeps the toast until dismissed.
- **New `src/renderer/src/components/ToastStack.tsx`**: bottom left, with action buttons and a close x.
- **`App.tsx`**: errors go through `showError` and the toast store; the single-string toast state is gone.
- **`styles.css`**:
  - Tokens: `--sidebar-w`, `--toast-bg`, `--toast-action`, and z-index layers `--z-dock` (100), `--z-scrim` (200), `--z-modal` (300), `--z-toast` (400).
  - `.modal-backdrop` gets `z-index: var(--z-modal)`.
  - The toast moves to the bottom left with `-webkit-app-region: no-drag`.
  - `.sidebar` width now uses `var(--sidebar-w)`.
- **Visual-check harness** (session scratchpad, not in the repo): an offscreen Electron window loads `out/renderer/index.html` with the mock API, runs scripted steps and saves screenshots.

### 2026-10-20: steps 3-12 (compose UI)
- **New `src/renderer/src/compose/`** (state and logic):
  - `sessions.ts`: external store, so typing never re-renders App.
  - `actions.ts`: new, reply, forward, close, discard, send, undo, schedule, templates, AI reply, recovery.
  - `autosave.ts`: debounce 3 s (10 s ceiling), hash to skip unchanged saves, 60 s limit for big drafts, retry, localStorage recovery copy.
  - `dockLayout.ts`, `keys.ts` (matched on `e.code`, never with Alt), `addresses.ts`, `sanitize.ts`, `outgoing.ts`, `editorCommands.ts`, `quote.ts`, `signature.ts`, `checks.ts`, `schedule.ts`, `input.ts`, `ComposeContext.ts`, and `compose.css` (its own stylesheet, to keep clear of the other session's `styles.css` edits).
- **New `components/compose/`**: ComposeDock, ComposeWindow, ComposeForm, InlineReply, RecipientsBlock, RecipientField, RichEditor, FormatBar, LinkPopover, AttachmentChips, ComposeFooter, SmallPopovers (schedule, template name).
- **Changed**:
  - `App.tsx`: no modal compose; dock, inline reply wiring, new keyboard handler, recovery, close handshake, drop guard, compose context provider.
  - `MessageView.tsx`: reply buttons, inline slot, Drafts bar, Bcc line; remote-content choice now lifted to App.
  - `MessageList.tsx`: "Draft" tag, double-click opens a draft.
  - `SettingsWindow.tsx`: Undo send, Compose format, Signature.
  - `useEscape.ts`: `hasEscapeLayer()`.
- **Deleted**: `Compose.tsx`, `RecipientInput.tsx`.
- **Backend review fixes** (library-API reviewer; the other two reviewers stalled and were replaced by my own pass):
  - `addDroppedFiles` accepts only real arrays, so a page can't smuggle paths in.
  - Quit waits for sends in flight, and an outbox item is removed as soon as the server accepts the message, so a quit during the Sent copy can't send it twice.
  - Renderer reload on crash is limited to 3 per minute and only for crash-like reasons; a gone renderer no longer delays closing.
  - A failed draft UID lookup no longer fails the save (a retry would add a duplicate).
  - Only image types mailparser can restore are made inline.
  - Without UIDPLUS, an expunge happens only if every message flagged \\Deleted is ours.
- **Plain-text part**: a blank line around lists and before a quoted message.
- **Docs**: README (features, shortcuts, structure) and SPEC.md (changelog, IPC table, roadmap ticks).

### 2026-10-20: pop-out windows
A docked card gets "Open in new window" (header, between Minimize and Full screen); the pop-out has "Move to main window".
- **Design**: the pop-out is a second `BrowserWindow` running the same renderer with `#popout`. It owns one card and its own autosave, so typing, Save & close, Discard and Schedule use the same code as in the dock. What must outlive the window (the Undo toast after Send, the scheduled and discarded toasts, "Message sent") is relayed to the main window, which keeps the outbox bookkeeping.
- **Main**: `src/main/index.ts` splits the shared window wiring into `wireWindow`; adds `createPopout` and the IPC `popout:open` (main window only), `popout:payload`, `popout:list`, `popout:send` (pop-outs only). `mainWindow()` replaces `getAllWindows()[0]`. Pop-outs close, saving first, when the main window closes.
- **Renderer**: `compose/popout.ts` (payload and message types), `PopoutApp.tsx`, actions `openInWindow`, `returnToMain`, `startPopout`, `startPopoutEvents`; `main.tsx` picks `PopoutApp` for `#popout`.
- **Recovery copy**: one localStorage key per pop-out (`winmail.compose.recovery.popout.<id>`), so windows don't overwrite each other. The main window restores keys of pop-outs that are no longer open. `forget` now writes the copy at once, because a pop-out closes before a timer would fire.
- **Checked in the real Electron app** (throwaway profile, account that can't connect): pop out, pop back in, discard from the pop-out (window closes, Undo toast in the main window, Undo works), closing the window with an unsent draft and the recovery on the next load.
- **Not checked**: sending from a pop-out with a working account (Undo toast in main, "Message sent"), Schedule send, drag and drop and paste into a pop-out, Mica and dark title bar buttons, several pop-outs at once.

## Verification done so far (mock mode in an offscreen Electron window; real accounts not used)
- `npm run typecheck` and `npm run build` pass. The real main process starts with a temporary empty profile and no errors.
- 32 checks of the pure modules in a real DOM (plain-text output, sanitizing, theme colours, quotes, addresses, dock layout, send checks, schedule presets, shortcuts): all pass.
- Flows checked by script and screenshot:
  - New message, chips and suggestions, invalid chip, Cc/Bcc shortcuts, send check bar, Undo send, discard with Undo.
  - Drafts autosave and "Draft saved", opening from Drafts, Continue editing, reopening with chips, body and attachment.
  - Schedule send and More menus, link popover, paste sanitizing, templates (save, insert), plain text mode, forward with attachment.
  - Inline reply, switching message (edited reply moves to the dock, "Draft" tag), full screen, Esc, Ctrl+W.
  - 1280 x 820 and 900 x 560, light and dark, Settings rows.

## Open questions and things to verify

| # | Question | How to check | Result |
|---|---|---|---|
| 1 | Does a plain UID EXPUNGE of an old draft version from `[Gmail]/Drafts` leave it in All Mail? (The plan uses the Trash detour on Gmail regardless.) | Edit a draft 5 times, then search All Mail and Trash in Gmail web for the subject. | – |
| 2 | Does Gmail web treat an IMAP-appended message with `\Draft` as an editable draft? | Save a draft from WinMail, open Drafts in Gmail web, and edit it. | – |
| 3 | Does iCloud.com and iOS Mail show WinMail's drafts, with one copy only? | Same as row 1, on iCloud. | – |
| 4 | Attachment limits per provider (iCloud 20 MB, Fastmail 50 MB, Outlook 20 MB). | Send near each limit; read the SMTP SIZE value from EHLO. | – |
| 5 | Electron's default menu: does Ctrl+R reload today? | `npm run dev`, press Ctrl+R with a message selected. | – |
| 6 | Does `execCommand` produce `<b>`/`<i>`, not styled spans, with `styleWithCSS` set to `'false'`? | Inspect the editor DOM after formatting. | Not checked with real typing; pasted HTML is clean. |
| 7 | Real send: Gmail "Show original" shows `multipart/alternative`, no Bcc header, `> ` quoting, `-- `; the Sent copy keeps Bcc. | Send to yourself with Cc and Bcc, formatting, an image and a file. | – |
| 8 | Undo send in Electron: closing during the delay sends exactly once; a crash then relaunch within 15 min sends it, later it reopens as a draft. | Try each with a real account. | – |
| 9 | Ctrl+R in Electron no longer reloads (the minimal menu), and the Edit menu roles still work. | `npm run dev`, press Ctrl+R in a message card. | – |
| 10 | Spelling suggestions menu and the Windows emoji panel. | Right-click a misspelled word; click the smiley. | – |
| 11 | Dropping files from Explorer onto a card, and pasting a screenshot (needs real `webUtils.getPathForFile`). | `npm run dev`. | – |
| 12 | Rendering of a sent HTML message in Gmail web and iOS Mail. | Look at the message you sent to yourself. | – |

## Risks and known limitations

- The other session may resume and edit the same files. Re-read before editing, and keep this file's "Notes for the other session" current.
- Drafts are last-writer-wins. If the same draft is edited on two devices at once, both versions may remain on the server.
- Servers without UIDPLUS: the plain EXPUNGE also removes other messages already flagged `\Deleted` in Drafts.
- The local recovery copy (localStorage) holds unsent text in plain form until the message is sent, discarded or closed cleanly (at most 7 days).
- Undo-send items: a crash during the delay sends the message at the next launch if within 15 min; after that it reopens as a draft.

## Verification checklist

Tick each check and note the account or provider used.

- [x] **Dock** (mock mode):
  - Several cards, minimize, full screen, and "+N" at 900 × 560, 1280 × 820 and 1920 × 1080.
  - The list and reading pane stay usable.
  - Clicking outside does nothing.
- [ ] **Keys**:
  - The Esc order is right.
  - Ctrl+Shift+F means From inside compose and Forward outside.
  - Delete and the arrows do nothing while typing.
  - AltGr letters (ą ę ś ć ń ł ż ź ó) trigger nothing.
  - Ctrl+R doesn't reload; Ctrl+W saves and closes the card.
  - Ctrl+R typed in the link popover doesn't reply.
- [x] **Chips** (mock mode; reply-all-from-Sent not tried):
  - Pasting `a@x.com, B <b@y.com>; c@z` gives 3 chips with the last one red.
  - Backspace twice removes a chip; double-click edits one; dragging between fields works; the block folds to one line.
  - Reply-all from Sent never adds the original Bcc.
- [ ] **Formatting**:
  - The bar items and Ctrl+K work.
  - Pasting from Word or a web page doesn't restyle the app.
  - Plain-text mode works; dragging text inside the editor works.
  - Switching the theme mid-draft leaves no theme colours in sent mail.
- [ ] **Received source** (Gmail "Show original"):
  - multipart/alternative, related and mixed as appropriate
  - no Bcc header
  - `> ` quoting in the text part
  - `-- ` with a normal space
  - the `gmail_quote` block
- [ ] **Drafts**:
  - A draft appears in Gmail web about 3 s after typing stops.
  - Edits leave exactly one copy, with nothing in All Mail or Trash.
  - A draft started on the phone can be continued here.
  - The draft is gone after sending.
  - IDLE keeps working during autosave.
  - The same checks pass on iCloud.
- [ ] **Offline and crashes**:
  - Offline shows "Couldn't save draft", then recovers.
  - Killing the process while typing restores the card minimized.
  - Closing the window saves first.
  - A renderer crash reloads with the cards restored.
- [ ] **Undo send**:
  - At 5 and 30 s, Undo means nothing is delivered and the card reopens unchanged.
  - Closing during the delay sends exactly once.
  - The crash-relaunch rule holds.
  - A wrong password reopens the card with the error.
- [ ] **Schedule send**: the menu shows (checked); picking a time, the draft leaving Drafts and Undo are not yet tried.
- [ ] **Attachments**:
  - The picker, Explorer drops, a pasted screenshot, and Forward with originals work.
  - 26 MB and `.exe` are blocked on Gmail.
  - A dropped folder is refused.
  - A path that main didn't issue is rejected.
- [ ] **Inline reply**:
  - Type switching keeps the text; `···` and Pop out work.
  - The selection-change rule holds, and Draft tags appear.
  - Remote images in the quote follow the per-message choice.
- [ ] **Signatures**:
  - Saving one doesn't reconnect IMAP.
  - `-- ` in new mail only; above the quote in replies.
  - Changing From swaps an unedited signature.
- [ ] **Templates**: save and the insert menu work in mock mode; overwrite, delete and persistence after a restart are not yet tried.
- [ ] **AI suggested reply**: it works with a key; there's no button without one.
- [ ] **Right-click** spelling suggestions and Add to Dictionary; the emoji panel opens.
- [ ] **Appearance**: light, dark and Mica; reduced motion; toasts bottom left; the scrim doesn't drag the window.

## Follow-ups (out of scope for now)

- Pop-outs: opening a draft from the Drafts list while its card is popped out opens a second copy; Undo send brings the card back to the main window's dock, not the pop-out; inline replies pop out to the dock first.
- Font family, size and colour; alignment; image resize handles; @-mentions.
- Rich (HTML) or multiple signatures per account; send-as aliases.
- Unit tests (no test framework yet): `dockLayout`, `addresses`, `checks`, `quote`, `outgoing` are good first candidates.
