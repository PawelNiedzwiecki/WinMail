# Newsletter magazine

Tier 4 feature. Newsletters leave the Inbox on the server, so every device gets a calmer Inbox, and WinMail shows them as one **Magazine** issue per day or week. Terms (Newsletter, Magazine, VIP) are defined in [CONTEXT.md](CONTEXT.md).

## Decisions (agreed 2026-11-24)

- **Off by default.** Moving mail on the server is a choice the user makes in Settings > Magazine.
- **Only new mail moves by itself.** When the feature is on, Settings offers a one-time "Move the 37 newsletters already in your Inbox" button. Nothing already in the Inbox moves without that press.
- **Issues: daily by default.** The user can choose Weekly, which starts on a weekday they pick (Monday by default). The current issue fills as mail arrives ("Today", "This week").
- **Reading: a contents page plus the reading pane.** **Magazine** in the sidebar opens the issue as a list of cards (sender, subject, preview). Clicking one opens it in the normal reading pane, so the Tracker shield, remote images, Unsubscribe and the menus all work as usual.
- **Claude summaries per article: a follow-up PR** with its own Content opt-in (ADR 0001). Not in this one.

Also decided while planning, not asked:

- **One folder, `Newsletters`**, created when first needed (like `WinMail Snoozed`). On Gmail it is a label: moving from INBOX into a label's folder over IMAP adds the label and removes Inbox, so one `moveTo` path serves every provider. An existing `Newsletters` folder is reused.
- **Read state is kept.** A newsletter read on the phone before it moved still moves, and shows as read in the Magazine.
- **No count in the sidebar.** Magazine is read for interest; an unread number would pull the user in. The entry shows while the feature is on.
- **Newsletters never notify** and never count in the taskbar badge while the feature is on, even in the seconds before they move.
- **VIPs are never Newsletters**, unless the user said "Always a Newsletter" for that sender.
- **Batched delivery** doesn't change: a Newsletter leaves the Inbox before any Delivery would show it, so it is never held, delivered or in a Brief.

## Detection (`shared/newsletters.ts`, pure, tested)

A message is a Newsletter when the **sender rule** says so, otherwise by this **heuristic**:

1. It has a `List-Unsubscribe` header: the user subscribed to something.
2. It is not a **discussion list**: a `List-Post` header that isn't `NO` means people write to the list (Google Groups, mailing lists).
3. It is not a **reply** (no In-Reply-To or References).
4. It is not **automatic** (`Auto-Submitted` other than `no`).
5. It is not **transactional**: receipts, codes, security alerts, bookings, shipping and other subject words from `categorize.ts`, unless the subject is also promotional.
6. It is not **social**: notifications from social networks (`categorize.ts`'s list of domains).
7. The sender is not a **VIP** and not one of the user's own addresses.

**Sender rules** (`Settings.newsletterRules`): "Always a Newsletter" or "Never a Newsletter" per sender address (lower case). They come from the message menus and are listed in Settings > Magazine with ×.

`MessageSummary.newsletter` holds the heuristic's header part (1 to 6), worked out in `fetchSummaries`. Rules, VIPs and own addresses are applied on top at the moment of use (`isNewsletter(m, rule)`), so changing them needs no new fetch.

## Moving (`main/newsletters.ts`, `Newsletters` class)

- A **mark** per account: the Inbox's UIDVALIDITY and the highest UID already looked at. The first look starts at UIDNEXT − 1, so turning the feature on moves nothing already there. Marks are saved in `winmail.json` (`newsletters.marks`), so mail that came while WinMail was closed moves at the next start.
- A **sweep** per account: `UID SEARCH <mark+1>:*` in the Inbox, then fetch summaries for those UIDs (at most 500 per sweep), pick the Newsletters, move them to `Newsletters` (created if missing), and move the mark forward. A new UIDVALIDITY resets the mark to UIDNEXT − 1.
- **When:** on an Inbox EXISTS (new mail), at start, when the feature is turned on, and every 5 minutes from the timer. One sweep per account runs at a time; a request during a sweep runs once more afterwards.
- **One-time move:** `countInboxNewsletters()` looks at the newest 2,000 Inbox messages of each account and counts the Newsletters. `moveInboxNewsletters()` moves them.
- **Sender rules from a message:** "Never a Newsletter" on a message in `Newsletters` moves it back to the Inbox. "Always a Newsletter" on an Inbox message moves it to `Newsletters`. Each also saves the rule.
- An account whose sweep fails is logged and tried again at the next trigger; the mark only moves when the move succeeded.

## Issues (`shared/newsletters.ts`)

`issueOf(date, period, weekday)` → `{ key, start, end }` in local time. Daily issues run midnight to midnight; weekly issues start at 00:00 on the chosen weekday. A message belongs to the issue in which it arrived (`arrivedAt`, else `date`). `issueTitle(issue, now)` gives "Today", "Yesterday", "Monday 23 November", "This week", "Last week" or "Week of 9 November".

## The Magazine (window)

- **Sidebar:** a **Magazine** entry (newspaper icon) under Favourites while the feature is on. Each account's `Newsletters` folder also shows in its own section, like any folder.
- **Selection** `{ kind: 'magazine' }`. The list pane shows **MagazineContents**:
  - a header with the issue's title and ‹ › for the issue before and after, and the article count;
  - cards: sender name, subject, two lines of preview, time, an unread dot; the selected card highlighted;
  - a skeleton that matches the cards while it loads;
  - an empty state: "No newsletters yet. New ones will collect here."
- Messages come from every enabled account's `Newsletters` folder (the newest 200 each, painted from disk first), merged, grouped into issues, newest issue first.
- Clicking a card opens it in the reading pane. ↓/↑ (and j/k with Gmail shortcuts) move between cards.
- **Menus:** "Not a Newsletter" on a message in the Magazine or a `Newsletters` folder; "Always a Newsletter" on a message in an Inbox (feature on only). Both in the message's right-click menu and the reading pane's More menu.

## Settings > Magazine (new page)

- **Newsletter magazine** switch: "Move newsletters out of the Inbox on the server and read them as one issue a day or a week."
- **Issues:** Daily / Weekly, and for Weekly the starting day.
- **Already in your Inbox:** "Move the 37 newsletters already in your Inbox", counted when the page opens; hidden when there are none.
- **Sender rules:** "Always a Newsletter" and "Never a Newsletter" lists, chips with ×.

## Implementation

| Where | What |
| --- | --- |
| `shared/newsletters.ts` (+ test) | `newsletterHeaders(h)`, `isNewsletter(m, rule)`, `NewsletterRule`, `issueOf`, `issueTitle`, `groupIssues` |
| `shared/types.ts` | `MessageSummary.newsletter`; `SpecialUse` `'newsletters'`; `Settings.newsletters`, `magazinePeriod`, `magazineWeekday`, `newsletterRules`; API methods below |
| `main/store.ts` | `newsletters: { marks }`, removed with the account |
| `main/mail.ts` | `list-post` header; `newsletter` in `fetchSummaries`; `Newsletters` folder recognised; `ensureFolder`, `inboxSince(accountId, mark)`, `inboxNewest(accountId, n)` |
| `main/newsletters.ts` (+ test) | `Newsletters`: `sweep(accountId?)`, `tick()`, `settingsChanged`, `countInbox()`, `moveInbox()`, `setRule()` |
| `main/notifications.ts` | `announce` drops Newsletters while the feature is on |
| `main/index.ts`, `ipc.ts`, preload | wiring; EXISTS → sweep; `newsletters:count`, `newsletters:moveInbox`, `newsletters:rule`, event `newsletters:changed` |
| Renderer | `Selection` `magazine`; `components/MagazineContents.tsx`; `components/settings/MagazinePage.tsx`; sidebar entry; menu items |
| `mockApi.ts` | a `Newsletters` folder with a week of issues; `?magazine` starts with the feature on |

**New API:** `countInboxNewsletters(): number`, `moveInboxNewsletters(): number`, `setNewsletterRule(sender: Address, rule: 'always' \| 'never' \| null, message?: MessageRef): void`, `onNewslettersChanged(cb)`.

## Status

- [x] Plan agreed (2026-11-24)
- [x] `shared/newsletters.ts` and tests (14)
- [x] Types, store, mail service, `main/newsletters.ts` and tests (11)
- [x] Notifier, IPC, preload
- [x] Mock API (`?magazine`)
- [x] Window: sidebar entry, MagazineContents, menus, Settings > Magazine
- [x] Checked in mock mode: contents, issues ‹ ›, reading, Not a Newsletter, Settings (count, Move all, weekly), dark and light
- [ ] Not yet checked in mock mode: a narrow window, Always a Newsletter from the Inbox, the skeleton and the empty state
- [x] Docs: SPEC (changelog, feature spec, IPC, data, roadmap), README
- [ ] Real accounts: the folder is created and mail moves on Gmail and an IMAP server; mail that came while WinMail was closed moves at start; the one-time move; Not a Newsletter brings it back; no notification for a Newsletter

## Follow-ups

- Claude summaries per article (Content opt-in).
- Unsubscribe audit (Tier 4) reads the same List-Unsubscribe data.

## Change log

### 2026-11-24
- Plan written and agreed.
- Built. Added while building:
  - The mark also keeps `since` (when watching began), and the store keeps the Message-IDs of the last 5,000 moved messages. A Newsletter that shows up in the Inbox again (moved back by hand with plain Move to Inbox, or woken from Snooze) or that arrived before watching began is left alone, so WinMail never fights the user.
  - Sender rules live in `Settings.newsletterRules` but `setSettings` keeps the saved ones; they change only through `setNewsletterRule`, so a Settings window with an older copy can't undo a rule made from a menu (the same reason labels and Delivery state are kept apart).
  - The Newsletters folder is recognised by name at the top level or under INBOX (servers with an `INBOX.` prefix).
  - "Is a reply" reads only References and In-Reply-To. `fetchSummaries` builds `parents` from every `<…>` in the fetched headers, which includes List-Id and List-Unsubscribe; that pre-existing behaviour is left as it is here (see open questions).
  - When an issue empties (its last article was Not a Newsletter), the Magazine shows the newest issue.

## Open questions

- `MessageSummary.parents` includes List-Id and List-Unsubscribe values (all `<…>` in the fetched headers), so newsletters from one list may group into a single conversation in the Inbox. Probably a bug; fixing it changes conversation grouping, so it's left for its own change.
