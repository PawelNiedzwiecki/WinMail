# Mail saved on disk and incremental sync — tracking

Goal: the sidebar, every folder seen before and every message opened before paint instantly from disk (even
offline), and a refresh asks the server only what changed. Plan: `C:\Users\ivell\.claude\plans\limitation-the-cache-starts-curious-octopus.md`.
Update this file at the end of every step.

## Decisions
- Saved: folder lists (summaries, previews, folder state, unread counts) for folders visited, and bodies of messages opened. No background body prefetch.
- Mail that arrived while WinMail was closed does not notify on launch (`announced` / `unannounced()` untouched).
- Plain SQLite file `%APPDATA%\winmail\mail-cache.db` (`node:sqlite`, no native module), like `contacts.json`.
- "Downloading N new messages" stays session-scoped.
- No QRESYNC in v1; a UID SEARCH diff over the cached window works on every server.
- Every change a user makes is written to the cache only after the server confirmed it (imapflow returns `false`, not an error, on refusal).

## Milestones
- [x] **1. Storage + write path (invisible)** — `src/main/cache.ts`; wiring in `index.ts` / `ipc.ts`; `mail.ts` saves the folder list and each folder's window, saves opened bodies, and writes changes through.
- [ ] 2. UIDVALIDITY tokens + instant paint (types, preload, ipc, mockApi, App.tsx)
- [ ] 3. Incremental sync (`mail.ts` only)
- [ ] 4. Eviction (`trim`), Settings "Storage" group, README / SPEC.md

## Change log
### 2026-10-21 — Milestone 1
- New `src/main/cache.ts`: `MailCache`. Tables `folders`, `messages`, `bodies`, `views`; WAL; `auto_vacuum = INCREMENTAL`; `user_version` schema gate. A damaged, unreadable or newer file is deleted and rebuilt; if that fails it runs in memory. No public method throws. After 3 failed writes in a row, or a corrupt/IO error, it works from memory for the session and deletes the file at the next start.
- `folders` rows are written with `ON CONFLICT DO UPDATE` only; `INSERT OR REPLACE` would cascade-delete the folder's messages.
- A sync stamps what it saved with a snapshot taken when it took the lock (UIDVALIDITY, UIDNEXT, EXISTS, HIGHESTMODSEQ if CONDSTORE). `gen` makes a sync that raced a trim/reset/clear drop its write.
- `mail.ts`: `listMailboxes` saves the folder list; `listMessages` keeps today's fetch and stores it with `replaceWindow`; `getMessage` saves the body (≤ 5 MB, only while UIDVALIDITY matches); `setFlags`, `markAllRead`, trash delete, `moveTo` (re-keys opened bodies by COPYUID), `wakeSnoozed` and `removeDrafts` update the cache after the server confirmed.
- `setFlags` and trash delete now throw when the server refuses instead of silently continuing (the renderer already reverts on error).
- `fetchSummaries` drops rows the server volunteered (no envelope, or not asked for) and merges split rows, so nothing half-empty is saved.
- `index.ts` opens the cache after the store, passes it on, prunes unknown accounts after 20 s and closes it before `app.exit`. `ipc.ts` forgets an account on removal and when its IMAP host, port or username changes.
- Nothing visible changes yet: lists are written but not read back until milestone 2.

## Open questions / to verify
- With a real Gmail and a non-Gmail account: that `messageFlagsAdd` returns `true` on success on both (setFlags now relies on it).
- Whether any server returns `uidValidity` in a MOVE result without `uidMap` (handled: bodies are then simply not re-keyed).
- `replaceWindow` stores exactly the window `listMessages` fetched, so a smaller later fetch (page size after a load-more) shrinks what is stored. Milestone 3 changes this.

## Verification
Milestone 1
- [x] `yarn typecheck` and `yarn build`
- [x] Cache behaviour script (stale `gen` refused, no cascade on folder-list refresh, write-through and unread counts, body kept only for matching UIDVALIDITY, re-key on move, validity change wipes bodies, prune/forget, corruption and newer-schema recovery, `auto_vacuum` = 2, `clear`)
- [x] Built app starts on an empty profile and creates `mail-cache.db`
- [ ] Real accounts: visit Inbox, Sent, a custom folder, open messages, quit, inspect the DB (`ELECTRON_RUN_AS_NODE=1 electron.exe -e` with `node:sqlite`)
- [ ] Real accounts: flag, mark all read, move, delete, then check the rows
- [ ] Account removed / IMAP host changed clears its rows; a password change keeps them
