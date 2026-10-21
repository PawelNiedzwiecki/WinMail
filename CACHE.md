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
- [x] **2. UIDVALIDITY tokens + instant paint** (types, preload, ipc, mockApi, App.tsx, mail.ts, cache.ts)
- [x] **3. Incremental sync** (`mail.ts`, plus `applySync`/`uids`/`previews` in `cache.ts`)
- [x] **4. Eviction (`trim`), Settings "Storage" group, README / SPEC.md**

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

### 2026-10-21 — Milestone 2
- **UIDVALIDITY tokens.** `MessageSummary.uidValidity` / `MoveResult.uidValidity` (strings). `getMessage`, `getSource`, `setFlags`, `move`, `moveTo`, `snooze`, `saveAttachment` and `openDraft` take an optional trailing `uidValidity`. After taking the folder lock, `withMailbox` compares it with the live value; on a mismatch it wipes the folder's cache, emits `mail:changed { reset: true }` and throws "This folder changed on the server…". Compared on every call, not once, so a list painted from disk cannot act on a renumbered folder's messages.
- **Drafts.** `draftUid` isn't threaded through Compose. Instead main remembers the UIDVALIDITY of each draft UID it handed out (`saveDraft`, `openDraft`) and `removeDrafts` skips any UID whose remembered validity differs from the live one.
- **Reading from disk.** New API `cachedMailboxes`, `cachedList` (optionally a Gmail `category:x` view), `cacheSize`, `clearCache`. `getMessage` returns a saved body without a connection (and marks it read in the background if the list says it was unread). `search()` saves Gmail category results as views; `view()` overlays current flags.
- **Renderer.**
  - The sidebar and counts are seeded from disk before `setReady`, so `inboxPath()` is right from the first render.
  - Only the selection effect's memory-miss branch passes `fromDisk`, so Refresh, load-more and quiet refreshes never overwrite optimistic state with disk rows.
  - A disk hit paints rows with no skeleton and keeps the loading footer until the server answers.
  - All Inboxes keeps an unreachable account's rows (from disk, or the rows already shown) instead of dropping them.
  - On a `reset` event the folder's `listCache`/`detailCache` entries are purged and its selection cleared.
- **mockApi.** `cachedMailboxes`/`cachedList` (`?nocache` returns null), `?offline` makes listMailboxes/listMessages/search fail, `cacheSize`/`clearCache` stubs.

### 2026-10-21 — Milestone 3
- **`listMessages` now syncs instead of re-downloading.** After taking the lock it records a snapshot (UIDVALIDITY, UIDNEXT, EXISTS, HIGHESTMODSEQ if CONDSTORE) and then:
  - **First visit / renumbered folder / more than `max(limit, 200)` new messages:** starts the window again with today's sequence-range fetch (`replaceWindow`).
  - **Otherwise:** `UID SEARCH floor:*` gives the server's UIDs; the difference with the saved ones is the removed and the new messages, and only the new ones are fetched (UID list packed into ranges). A refused SEARCH (`false`) throws and writes nothing, so it can never be read as "folder is empty".
  - **Load more:** a shorter saved range than asked for fetches only the older sequence range, with one already-saved row as a witness; the floor is lowered only if the witness came back.
  - **Flags:** with CONDSTORE, `FETCH floor:* (FLAGS) CHANGEDSINCE checkpoint`; without it, a full flags read. Applied to every row in the window, newest answer wins. The checkpoint is max(old, lock-start HIGHESTMODSEQ, MODSEQ of rows that came back inside the range); it is never read from the connection after the fetch, and a row without a UID keeps the old checkpoint.
  - One `applySync` transaction writes it all (dropped if `gen` changed); the reply is read back from disk, or built in memory if the write failed.
- **Skip without selecting:** a non-inbox folder on a CONDSTORE server whose last LIST-STATUS (< 10 s old) matches the saved UIDVALIDITY/UIDNEXT/EXISTS and has HIGHESTMODSEQ ≤ the checkpoint is answered from disk with no command. Every change this app makes to a folder drops that folder's saved status.
- `listMailboxes` asks LIST-STATUS for messages/uidNext/uidValidity/highestModseq as well (same command, more fields) and saves valid answers.
- `fetchSummaries` reuses previews already saved on disk; `onlyAsked` understands packed ranges.
- "Downloading N new messages" is counted from the saved UIDNEXT and only for folders already synced this session (`syncedThisSession`), as before; `newestUid` is gone. A renumbered folder emits `mail:changed { reset: true }`.
- Not changed: `unannounced()` / `checkArrived()` / the inbox path (inbox is never skipped).

### 2026-10-21 — Milestone 4
- `MailCache.trim(busy, limits?)`: keeps the newest 500 messages per folder (raises `floor_uid`, bumps `gen`), drops the messages of folders unopened for 60 days (floor/checkpoints cleared, UIDVALIDITY kept so opened bodies stay valid), evicts bodies oldest-opened first down to 250 MB (≤ 200 per pass), then `incremental_vacuum` and `wal_checkpoint(TRUNCATE)`. Folders in `MailService.syncing` are skipped. Runs at the 20 s startup timer and after every 50th saved body (`MailService.trimCache`).
- Settings > General > Storage: size (`formatSize`) and Clear (`clear()` = close, delete the files, reopen).
- README (features, structure, next steps) and SPEC.md (§2 tree, §3 storage table, §4 API, §5 Sync/Settings, changelog, roadmap) updated.

### 2026-10-21 — Follow-up: draft validity survives restarts
- The UIDVALIDITY each draft UID was handed out under (from `saveDraft` and `openDraft`) is now stored in a `drafts` table in `mail-cache.db` instead of a Map in `MailService`, so a draft restored from the recovery copy after a relaunch is still refused for deletion if the Drafts folder was renumbered meanwhile. Schema version 2; a version-1 file is upgraded in place (the new table is added, nothing is lost). Cleared with the account, pruned for unknown accounts, and dropped once the draft is removed.
- Checked with a script: v1 → v2 upgrade keeps data, values survive close/reopen, forget/prune/forgetAccount.

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

Milestone 4
- [x] `yarn typecheck` and `yarn build`; trim script (keeps newest N per folder, busy folder untouched, bodies evicted oldest-opened first, idle folder loses messages but keeps its row)
- [ ] Settings > General > Storage in the real app: size shows, Clear empties it, mail reloads afterwards

Milestone 3
- [x] `yarn typecheck` and `yarn build`
- [x] Fake IMAP server driving the real `MailService.listMessages` (bundled with rolldown): first visit; unchanged folder fetches 0 envelopes; new + flagged + expunged mail fetches only the new message; refused SEARCH leaves the window intact; volunteered flag-only rows ignored; flag change from another client; load more fetches only older rows; 300 new messages restart the window instead of fetching all; no-CONDSTORE flag re-read with empty checkpoint; UIDVALIDITY change emits `reset`; skip-without-select sends no command and stops when HIGHESTMODSEQ moves
- [ ] Real accounts (Gmail + a non-Gmail): second refresh of an unchanged folder downloads nothing; flag/delete/move/new mail in webmail show up on the next refresh; load more after a relaunch
- [ ] Gmail: confirm LIST-STATUS accepts HIGHESTMODSEQ (if not, the skip simply never fires) and that CHANGEDSINCE flags come back

Milestone 2
- [x] `yarn typecheck` and `yarn build`; cache `body`/`view`/`saveView`/wipe tested with a script
- [x] Mock mode (CDP-less probe in an offscreen window): default paints rows at ~20 ms with no skeleton; `?nocache` shows the skeleton; `?offline` keeps rows and the sidebar and shows the error line; `?offline&nocache` ends empty with the error (as before)
- [ ] Real accounts: relaunch offline shows sidebar, lists and opened bodies; relaunch online has no skeleton
- [ ] UIDVALIDITY: change a folder's saved `uid_validity` and the rows' tokens, launch, act on a painted row before the sync lands (needs a slow connection or a temporary delay); expect the refusal and a reload
- [ ] Gmail category tab paints from disk; an opened-then-unread message is marked read again when reopened from disk
