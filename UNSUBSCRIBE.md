# Unsubscribe audit

Tier 4 feature. A list of the mailing lists you get mail from, ranked by how little you open them ("You've opened 0 of 48 from these 12 lists"), and leaving several in one go.

Issues: [#35](https://github.com/PawelNiedzwiecki/WinMail/issues/35) (ranking) and [#36](https://github.com/PawelNiedzwiecki/WinMail/issues/36) (bulk unsubscribe), epic [#83](https://github.com/PawelNiedzwiecki/WinMail/issues/83).

## Decisions (2026-11-25)

The four questions were put to the user, who moved on to filing issues without answering, so the recommended option was taken for each. Any of them can still change.

- **Stats come from the server.** The last 90 days of each account's Inbox, Newsletters and Archive (All Mail on Gmail, which already holds the other two). The opened flag (`\Seen`) counts reads on any device. Nothing leaves the mail server.
- **A dialog**, opened from Settings > Magazine and from a button in the Magazine's header. It works with the Magazine on or off.
- **Email-only lists are left by sending the email for the user** from the account that receives the list, with no compose window. One-click lists (RFC 8058) are left directly. Web-page-only lists can't be done in bulk: each gets an **Open page** button.
- **Old mail: offer to move it to the Bin.** A checkbox, off by default: "Also move their 312 messages from the last 90 days to the Bin".

Also decided:

- **What a list is:** mail with a List-Unsubscribe header, grouped by List-Id, otherwise by the sender's address (lower case). The name and the way out come from the newest message.
- **Ranking:** the opened share, lowest first, then the most mail. "0 of 48" comes before "0 of 2".
- **The user's own addresses are left out.**
- **Unsubscribed lists are remembered** on this PC (`winmail.json`, `unsubscribed`, the last 500). They show as "Unsubscribed 3 Nov" and can't be picked again. A list with mail more than 7 days after that is marked **Still sending**, and can be picked again.
- **The scan stays in the main process.** The window sends list keys, not URLs or UIDs, so it can't make the app POST to an arbitrary address or move arbitrary mail.
- **Limits:** the newest 5,000 messages per folder within the 90 days. Headers only, never bodies.

## Implementation

| Where | What |
| --- | --- |
| `shared/unsubscribe.ts` (+ test) | `parseUnsubscribe(listUnsubscribe, post)`, `listKey`, `rankLists`, `unsubscribeWay`, `parseMailto`, `auditSummary` |
| `shared/types.ts` | `MailingList`, `ListMessage`, `AuditResult`, `UnsubscribeResult`; API below |
| `main/mail.ts` | `listMail(accountId, since)`: list mail of the scanned folders, headers and flags only; `parseUnsubscribe` from shared |
| `main/unsubscribe.ts` (+ test) | `oneClick(url)` (moved from `ipc.ts`); `Unsubscriber`: `scan()`, `unsubscribe(keys, { moveToBin })`, remembered lists |
| `main/store.ts` | `unsubscribed`, kept per address/list key |
| IPC, preload | `audit:scan`, `audit:unsubscribe` |
| Renderer | `components/AuditDialog.tsx`, `audit.css`; opened from Settings > Magazine and the Magazine header |
| `mockApi.ts` | about a dozen lists with made-up counts; one one-click list fails |

**New API:** `scanMailingLists(): AuditResult`, `unsubscribeLists(keys: string[], opts: { moveToBin: boolean }): UnsubscribeResult[]`.

## Status

- [x] Plan (2026-11-25)
- [x] `shared/unsubscribe.ts` and tests (10)
- [x] Main: scan, `Unsubscriber` and tests (5), store, IPC, preload
- [x] Mock API
- [x] Window: AuditDialog, entry points
- [x] Checked in mock mode: both entry points, skeleton, ranking, picking, bulk unsubscribe with the Bin box (a planted failure), looking again; dark and light
- [x] Docs: SPEC, README
- [ ] Real accounts: scan on Gmail and an IMAP server; a real one-click unsubscribe; an email unsubscribe arriving; moving to the Bin (add to the verification epic #87)

## Change log

### 2026-11-25
- Plan written; built and checked in mock mode.
- Found while checking: lists already left stayed mixed in with the rest. `rankLists` now puts them last (unless still sending).
- `mail.ts`'s reading-pane List-Unsubscribe parser now calls the shared `parseUnsubscribe`, so both read the header the same way.
