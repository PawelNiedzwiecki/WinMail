# WinMail

A local-first, calm desktop mail client for Windows. Mail is kept on the user's PC and the app works to keep mail from taking over the day.

## Language

### Mail on this PC

**Cache**:
The disposable copy of an account's mail on this PC: recent messages per folder and the bodies the user has opened, trimmed automatically and safe to clear.
_Avoid_: Local store, offline mail

**Vault**:
An account's full mail history kept on this PC indefinitely, never trimmed, chosen per account with "Keep a full copy on this PC".
_Avoid_: Archive (that is a folder), backup, full cache

**Retired account**:
An account WinMail no longer connects to, whose Vault is kept so its mail stays readable and searchable on this PC.
_Avoid_: Archived account, disabled account (a disabled account still has its server)

### Calm

**Delivery**:
A set time of day when held Inbox mail is shown to the user, as part of Batched delivery.
_Avoid_: Batch, sync, check (a check fetches mail; a Delivery shows it)

**Held**:
Inbox mail that arrived since the last Delivery and is hidden in WinMail until the next one: unread, and not from a VIP or the user. Nothing about it changes on the server.
_Avoid_: Queued, delayed, hidden mail

**Brief**:
The short summary that comes with each Delivery: who wrote and what needs the user. The first Delivery of the day is the Morning brief.
_Avoid_: Digest, summary (Summarise is a per-message feature)

**VIP**:
A person whose mail skips Batched delivery and appears at once. VIPs are chosen explicitly by the user.
_Avoid_: Known person, contact (being in contacts does not make someone a VIP)

**Newsletter**:
Mail sent to a list the user subscribed to, read for interest rather than acted on.
_Avoid_: Promotion, marketing, bulk mail

**Magazine**:
One readable issue that gathers the Newsletters held out of the Inbox for a period.
_Avoid_: Digest, Brief

**Waiting for**:
A sent message the user expects a reply to, which comes back as a nudge if nobody answers in time.
_Avoid_: Follow-up, reminder, snooze (Snooze brings back received mail)

**Nudge**:
A Waiting for message coming back because nobody answered in time: a notification and a place at the top of the Waiting for list.
_Avoid_: Reminder, alert

**Follow-up**:
A message the user sends in the conversation after a Nudge. It ends the earlier wait and usually waits again.
_Avoid_: Reminder, chaser

### Privacy

**Tracker**:
Anything in a message that tells the sender the user opened it or clicked: a tracking pixel or a tracked link.
_Avoid_: Spy pixel, beacon, remote image (most remote images are not trackers)

**Tracked link**:
A link that passes through the sender's click-counting service or carries tracking parameters before reaching its destination.
_Avoid_: Redirect, unsafe link

**Tracking pixel**:
An image whose only job is to tell the sender the message was opened, usually tiny or hidden. A real picture is not one, even when it is hosted by the same service.
_Avoid_: Spy pixel, beacon, web bug

**Tracking service**:
The company that counts a sender's opens or clicks, such as Mailchimp. The banner names it, or names the pixel's host when WinMail does not know it.
_Avoid_: ESP, vendor

### Claude

**Content opt-in**:
A per-feature switch that allows that one feature to send message content to Claude.
_Avoid_: AI enabled, Claude key (a saved key alone allows nothing)
