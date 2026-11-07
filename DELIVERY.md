# Batched delivery and the Morning brief

Plan for two Tier 4 features, written before either is built so they fit together. Terms (Delivery, Brief, VIP, Waiting for) are defined in [CONTEXT.md](CONTEXT.md).

- **Part 1, Batched delivery**: holding Inbox mail, Deliveries at set times, VIPs, Deliver Now, the Delivery settings page, and a saved **Delivery record** for the Brief to read.
- **Part 2, the Brief and the Morning brief**: the Brief shown with each Delivery, and the richer Morning brief (the day's first Delivery), with an optional Claude-written version. Built in a separate session, on top of Part 1.

Part 1 is a working feature on its own: with Part 2 missing, a Delivery simply shows its mail and sends one notification.

## Decisions (agreed 2026-11-07)

- The Inbox strip shows the next Delivery time only, never how many messages are held.
- Replies to Waiting for messages are held like any other mail.
- The same Delivery times every day; no separate weekend times for now.
- A Brief, the Morning brief included, exists only with Batched delivery on.

## Part 1: Batched delivery

### What is held

A message is **held** when all of these are true:

1. It is in an account's **Inbox** (all Gmail tabs included).
2. It is **unread**. Mail already read on another device has nothing new to hide.
3. It **arrived after `deliveredUntil`** (see below). Arrival is the server's receive time (IMAP INTERNALDATE, new `MessageSummary.arrivedAt`), not the sender's Date header, which can be wrong or faked. INTERNALDATE survives moves, so snoozed mail coming back, or mail the user moves back to the Inbox, is not held. Rows saved before this have no `arrivedAt` and use `date`.
4. The sender is **not a VIP** and not one of the user's own accounts.

Held mail is hidden in WinMail only. Nothing moves on the server and no flag changes, so other devices see it as usual and nothing is lost if the PC is off.

**Hidden in:** the Inbox and All Inboxes lists, Gmail category tabs, conversation groups in the Inbox, the unread counts in the sidebar, the taskbar badge, and new-mail notifications.
**Not hidden in:** search and AI search results, All Mail and every other folder, label views, a message opened in its own window. Searching is the user asking, so it finds everything.

### `deliveredUntil`: one timestamp that only moves forward

`deliveredUntil = max(previous value, the last Delivery time at or before now, the last Deliver Now, the moment batching was turned on)`

It is stored in `winmail.json` (`delivery.deliveredUntil`) and only ever moves forward. So:

- Turning batching on hides nothing already shown, because mail from before that moment is delivered.
- Editing or removing Delivery times never hides mail that was already shown.
- If the PC was off or asleep at 13:00 and wakes at 15:00, mail from before 13:00 shows at once, and mail from 13:00 to 15:00 waits for 17:00.
- Turning batching off shows everything. Turning it on again starts from that moment.
- Removing a VIP can hide unread mail from that person that arrived since the last Delivery. That's rare and harmless: it shows at the next Delivery.

### Delivery times

- Default 09:00, 13:00, 17:00, every day, in local time. The user can have 1 to 6 times.
- Batching is **off by default**, so turning it on is a choice in Settings.
- Times are calculated with local-date arithmetic, so DST changes (Europe/London in March and October) neither skip a Delivery nor add an extra one.

### A Delivery

The 30-second timer (`index.ts` `tick`) moves `deliveredUntil` forward. When it passes a scheduled time:

1. Each enabled account's Inbox is searched for the mail that was held and is now delivered: `UID SEARCH UNSEEN SINCE <day of the previous deliveredUntil>`, then a small FETCH of INTERNALDATE and envelope, filtered with the same rule. This list goes into the **Delivery record**.
2. The windows get `delivery:changed`, so lists and counts refresh and the mail appears.
3. If anything came and WinMail is in the background, there's **one** notification: "7 new messages", "From Jane, Adam and 5 others". It uses the existing summary style and follows the existing settings: notifications on, the All/Primary/people filter, muted accounts, quiet hours, preview and sound. Click opens All Inboxes.

Kinds of Delivery:
- `scheduled`: a Delivery time passed while WinMail was running. Recorded and announced.
- `catch-up`: WinMail started (or woke up) after one or more Delivery times it missed. Recorded once, not announced. This matches the existing rule that mail which came while WinMail was closed is not announced.
- `now`: the user pressed **Deliver Now**. Recorded, not announced, since the user is looking.

### The Delivery record (what Part 2 builds on)

```ts
interface DeliveredItem {           // a held message that was delivered
  accountId: string; mailbox: string; uid: number; uidValidity?: string
  messageId?: string | null; parents?: string[]
  from: Address; to: Address[]; subject: string; preview: string
  arrivedAt: string; category?: GmailCategory; flagged: boolean; hasAttachments: boolean
}
interface DeliveryRecord {
  id: string
  at: string                        // ISO: the Delivery time it stands for (scheduled, catch-up), or the Deliver Now press
  kind: 'scheduled' | 'catch-up' | 'now'
  first: boolean                    // first Delivery of its local day: its Brief is the Morning brief
  items: DeliveredItem[]            // at most 200, newest first
  more: number                      // delivered beyond the 200
}
```

The last 14 records are kept in `winmail.json` (`delivery.records`) and removed with their account. API: `listDeliveries()`.

### The Inbox strip

While batching is on, a thin strip sits above the Inbox and All Inboxes list: **"Next delivery at 13:00"** with a **Deliver Now** button. It shows the time only, not how many messages are held, because a count pulls you in to check. After a Delivery the strip reads "Delivered at 13:00" until the next one. Part 2 puts the Brief here.

### VIPs

- One list of people (name and email, matched on the address in lower case) across all accounts, stored in `Settings.vips`. Their mail is never held.
- Added in **Settings > Delivery**: type a name or address (autocomplete from contacts), or pick from **Suggested**: the first 5 people in the accounts' contacts (saved contacts first, then people the user writes to, then people who write; taken from each account in turn; lists and the user's own addresses left out) who are not VIPs yet. A ranking by sent mail alone would need a new main-process method; this uses the existing `listContacts` order.
- Also from a message: **Add Jane to VIPs** / **Remove Jane from VIPs** in the message's right-click menu and the reading pane's More menu.

### Other behaviour

- **Mark All as Read** on an Inbox marks only delivered mail, so held mail is never marked read unseen. (Held unread UIDs are excluded from the STORE.)
- **Replies you're Waiting for** are held like any other mail. The wait still ends as soon as the reply is fetched, because reply detection reads every fetched message whether or not it's shown, so you get no nudge for it.
- **New mail while the window is focused** that is held: nothing shows, as intended.
- **Opening a held message by other means** (search, a message window) works as normal. It is read, so it is no longer held.
- **A Gmail conversation that is opened** shows all its messages, from All Mail, including a held reply. Opening a conversation is asking for it.

### Settings > Delivery (new page)

- **Batched delivery** switch, with one line of explanation: "Hold new Inbox mail and show it at set times. Nothing changes on the server."
- **Delivery times**: rows of time pickers with ×, plus **Add a time** (up to 6).
- **VIPs**: chips with ×, an add field, and Suggested.
- (Part 2 adds the Brief options here.)

### Implementation

| Where | What |
| --- | --- |
| `shared/delivery.ts` (pure, tested) | `parseTime`, `normaliseTimes` (valid, sorted, unique, 1–6), `lastDeliveryAt(now, times)`, `nextDeliveryAt(now, times)`, `advance(state, now, times)` → `{ deliveredUntil, crossed: Date \| null }`, `HoldRule` and `isHeld(m, rule)`, `DEFAULT_DELIVERY_TIMES` |
| `shared/types.ts` | `Settings.batchDelivery` (false), `deliveryTimes`, `vips: Contact[]`; `MessageSummary.arrivedAt`; `MailboxInfo.held`; `DeliveryState`, `DeliveryRecord`, `DeliveredItem`; API methods below |
| `main/store.ts` | `delivery: { deliveredUntil: string \| null; records: DeliveryRecord[] }`; records removed with the account; `setSettings` passes the change to `Deliveries` |
| `main/delivery.ts` | `Deliveries`: `tick()`, `deliverNow()`, `settingsChanged(prev, next)`, `state()`, `records()`, `rule()`; builds records through `MailService.delivered(…)`; calls `Notifier.delivered(record)` for scheduled ones |
| `main/mail.ts` | `arrivedAt` from INTERNALDATE in `fetchSummaries` and `getMessage`; `holdBy(rule)`; `listMailboxes` and `cachedMailboxes` take held unread mail out of the Inbox's `unseen` and set `held` (one SEARCH plus a small FETCH on the Inbox, only when batching is on and the Inbox has unread mail, remembered by UIDVALIDITY, UIDNEXT, unseen, deliveredUntil and the VIPs; offline, from the saved Inbox rows); `markAllRead` skips held UIDs; `heldBetween(accountId, after, until, rule)` for records |
| `main/notifications.ts` | `announce` drops held messages; new `delivered(record)` |
| `main/index.ts`, `ipc.ts`, `preload` | wiring; `delivery:state`, `delivery:now`, `delivery:list`, event `delivery:changed` |
| Renderer | `App.tsx` filters Inbox rows with `isHeld` (rule from `getDelivery()`) and refreshes on `delivery:changed`; `components/DeliveryBar.tsx`; `components/settings/DeliveryPage.tsx`; VIP items in the context and More menus |
| `mockApi.ts` | batching state, records, Deliver Now; `?batch` starts with batching on (the last Delivery a few minutes ago, the next in three hours) and three held messages; `?delivery` also makes a scheduled Delivery 4 s after launch |

**New API:** `getDelivery(): DeliveryState` (`{ on, times, deliveredUntil, nextAt, last }`), `deliverNow()`, `listDeliveries(): DeliveryRecord[]`, `onDeliveryChanged(cb)`.

**Tests:**
- `shared/delivery.test.ts`: times across midnight, unsorted and duplicate input, the first and last Delivery of a day, both DST change days in Europe/London (with `TZ` set for the test run), `advance` never moving back, and `isHeld` for each rule (read, VIP, own address, before and after the boundary, missing `arrivedAt`).
- `main/delivery.test.ts` (stubbed store, mail and notifier): a scheduled crossing makes a record and one notification; catch-up is silent; Deliver Now; turning on and off; editing times never moves back; the `first` flag across days; disabled accounts; a failing account search still delivers.

**Docs:** SPEC changelog, feature spec, IPC table, architecture and roadmap; README features; a **Held** entry in CONTEXT.md.

**Not checkable here:** real IMAP servers' INTERNALDATE and `SEARCH SINCE`, and Windows notifications. Mock mode with Playwright covers the UI.

### Status (2026-11-07)

- [x] Plan agreed, with the four decisions above
- [x] `shared/delivery.ts` and its tests (19), `main/delivery.ts` and its tests (13)
- [x] Mail service, notifier, store, IPC, preload, mock API
- [x] Window: held rows dropped from Inbox lists, the strip, Settings > Delivery, VIP menu items
- [x] Checked in mock mode with Playwright: held mail hidden and left out of the counts, Deliver Now, a scheduled Delivery, search still finding held mail, adding a VIP showing their held mail, VIP menu items, turning off and on, Mark All as Read leaving held mail unread, light, dark, 900 × 560
- [ ] Real accounts: the held count and Inbox list on Gmail and an IMAP server, a Delivery notification on Windows, Mark All as Read with held mail
- [ ] Part 2: the Brief and the Morning brief

## Part 2: the Brief and the Morning brief (separate session)

Starts from Part 1's branch and builds on `DeliveryRecord`. It may add fields to `DeliveredItem` (for example `hasInvite`).

### The Brief

- It comes with every Delivery that brought mail, as a card at the top of the Inbox and All Inboxes, in place of Part 1's "Delivered at" strip. It stays until dismissed or the next Delivery.
- Heading: "13:00 delivery · 7 messages".
- **Needs you**: the messages that likely need the user, each as a row (sender, subject, why: "asks you a question", "invitation", "replied to you", "VIP").
- **Also**: everything else, grouped: people by name, then "4 newsletters and notifications" counted by category. Click a row to open the message.
- If the Delivery is `now` or `catch-up`, the Brief is the same, without a notification.

### "Needs you" (local, `shared/brief.ts`, pure, tested)

From a person (not a list or an automatic sender: reuse `isListAddress`, `isAutomatic` and `categorize`) **and** at least one of:
- the user is directly in To (not only Cc);
- it asks something (`asksQuestion` from `shared/waiting.ts`, on the preview);
- it is a calendar invitation;
- it replies to something the user sent (its `parents` name a Waiting for Message-ID, or the user's own Message-ID domain);
- the sender is a VIP, or it is flagged.

### The Morning brief

The Brief of the day's `first` Delivery. It adds:
- **Still waiting for a reply**: nudged Waiting for messages, and those due today.
- **Overnight**: how many messages came since the last Delivery of the day before.
- A notification when WinMail is in the background ("Morning brief · 12 messages, 3 need you"), following the same notification settings, quiet hours included.

### Claude-written version (optional)

- A new Content opt-in, **Brief**, in `CONTENT_FEATURES`: "Sends the sender, subject and preview of each delivered message." Off by default (ADR 0001).
- When it is on, the Brief gets a short Claude-written paragraph at the top, marked "Sent to Claude". The local Brief is always there underneath and never waits for Claude.
- Enforced in `runAi` with `assertOptedIn(settings, 'brief')`, the same as Summarise.

### Settings > Delivery additions

- **Brief** on/off (default on).
- **Morning brief notification** on/off (default on).
- The Content opt-in itself lives on the Claude page with the others.

### Left for Part 2's session

- No Brief when batching is off (decided). With batching off, Part 2 adds nothing to the Inbox.
- The exact layout of the Brief card at narrow widths (900 px window).
