# New-mail notifications

Redesign of WinMail's new-mail notifications and a Notifications page in Settings. Started 2026-10-21.

## Decisions

- **Rich native Windows toast** (chosen over a custom WinMail popup window): it keeps Do Not Disturb,
  Focus and Notification Center working for free.
- Built with Electron 44's **structured notification options**, not raw `toastXml`. Electron documents
  `click` / `action` / `reply` events on Windows for these. With custom XML it doesn't say which events
  fire, so the structured options are the safer choice.
- One message: sender as title, subject + first lines as body, round initials avatar, inline reply box,
  **Archive** and **Mark as read** buttons. Account header (`groupId`/`groupTitle`) when more than one
  account is enabled.
- More than 3 at once: one summary toast ("5 new messages", "From Jane, Adam and 3 others") with
  **Mark all as read**.
- Avatars and the taskbar badge are drawn by the main window's renderer (canvas, Inter font) and sent to
  main as PNG data URLs; the main process has no text rendering of its own. A 1.5 s timeout falls back to no avatar.
- Inline reply goes through the outbox (`Outbox.queue`), so it honours Undo send, records contacts, and a
  failed send reopens in Compose with an error banner (existing `collectFailed`). Plain text: reply,
  signature, then `On <date>, <sender> wrote:` and the quoted text.
- Mail that arrived while WinMail was closed still doesn't notify on launch (the user's earlier decision;
  `MailService.unannounced()` is untouched; the cache session owns `mail.ts`).
- Notifications still only show while no WinMail window is focused.

## Settings (all in `Settings`, Notifications page)

| Field | Values | Default |
|---|---|---|
| `notifyNewMail` | master switch | `true` |
| `notifyFilter` | `all` / `primary` (inbox category) / `people` (saved contacts + people you've written to) | `all` |
| `notifyMutedAccounts` | account ids that never notify | `[]` |
| `notifySound` | Windows notification sound | `true` |
| `notifyPreview` | `full` / `sender` / `none` | `full` |
| `quietHours`, `quietStart`, `quietEnd` | mute between `HH:MM` times, may cross midnight | off, 22:00–07:00 |
| `taskbarBadge` | unread inbox count as a taskbar overlay icon | `true` |

Plus a **Send test notification** button.

## Todo

- [x] Types + defaults (`shared/types.ts`), quiet-hours helper (`shared/quietHours.ts`)
- [x] `main/notifications.ts`: `Notifier` (filter, quiet hours, toast, summary, actions, reply, test)
- [x] `Contacts.isKnown()` + `known` list (saved contacts and people written to)
- [x] Wire in `main/index.ts`, IPC (`notify:test`, `notify:avatar`, `app:badge`), preload, mock API
- [x] Renderer art: `notifyArt.ts` (avatar + badge), taskbar badge effect in `App.tsx`
- [x] Notifications settings page; the old switch moves out of General
- [x] Verify in the real app (throwaway profile, `--user-data-dir`): test notification shows sender, subject,
      preview, reply box, Archive, Mark as read; settings page renders and saves; taskbar overlay badge shows
- [ ] Verify with a real account: Archive, Mark as read, Reply from a toast; summary toast; account header
- [ ] Avatar is tiny (~16 px). Windows 11 draws the `icon` of Electron's built-in template that small.
      A `toastXml` version with `appLogoOverride hint-crop="circle"` might give a 48 px round avatar plus
      an attribution line and the Windows mail sound. A first try got Electron's `show` event, but no toast
      appeared on screen (01:48, possibly Windows' night-time Do Not Disturb). Needs another try, with someone
      clicking the buttons to see whether `action` / `reply` / `handleActivation` fire.

## Verification notes

- Dev builds show "Electron" as the toast's app name; packaged builds use the AUMID `com.pawel.winmail`.
- Driver: scratchpad `drive/cdp.mjs` (DevTools on port 9333) and `drive/screen.ps1` (screen corner capture).

## Coordination

- Peer session `winmail-65` is planning a SQLite cache: it will edit `mail.ts`, `index.ts` (cache open/close,
  away from `announce`), `ipc.ts`, `preload`, `types.ts` (API methods only), `mockApi.ts`, `App.tsx`.
  My edits in those shared files are small and additive.
- The uncommitted Appearance tab in `SettingsWindow.tsx` predates this work and is kept as is.

## Change log

- 2026-10-21: plan agreed (native toast + all four settings groups); implementation; typecheck and build
  pass; checked in the real app on a throwaway profile. SPEC.md changelog, feature spec and roadmap updated.
