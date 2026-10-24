# Animations

Tracking file for the motion pass across the renderer. The review found that nothing animated out, height changes snapped, most hover/press states were instant, and arrivals (new mail, chips) never animated.

## Decisions
- Motion language: 100–220 ms, ease-out, short exits (≈100 ms) so triage never waits on an animation.
- CSS for hover/press/entrances; `motion` (`motion/react`) only where something must animate out, change height, or slide between places (shared `layoutId`).
- Shared values: `src/renderer/src/motion.ts` (TS) and `--dur-*` / `--ease-*` tokens in `styles.css` `:root`. Hover/press/state-pop CSS lives together in the "Motion" block at the end of `styles.css`.
- Reduced motion: `<MotionConfig reducedMotion="user">` in `main.tsx` stops transform/layout animation; `Collapse` and `MessageList` also skip height animation themselves (MotionConfig doesn't cover height). Every CSS animation/transition has a `prefers-reduced-motion` override. Quick opacity fades on close remain, by design.
- Selection: `.row.is-selected` / `.sb-item.is-selected` turn on instantly (text colour flips with them) and fade off, so j/k never lags.
- Exits: CSS keyframes keep playing entrances; motion only adds `exit` (with `initial={false}`). A closing modal ignores clicks and lets go of Escape (`useIsPresent`, `components/Backdrop.tsx`).
- `Collapse` clips only while moving (dropdowns inside can overflow when open). `transitionEnd` never fires for `height: 'auto'`, hence the start/complete callbacks.
- Message list rows: grow in / collapse out, no `layout` (it would measure hundreds of rows on every j/k). A change of `view` (folder, category, search) swaps rows instantly via AnimatePresence `custom`.
- Compose card: motion owns its transform, so full-screen centring is motion `x: '-50%'` instead of CSS `translateX`. Leaving full screen replays `dock-in` on purpose (the card visibly re-docks).

## Done
- Foundations: `motion.ts`, `Collapse.tsx`, `Backdrop.tsx`, `MotionConfig`, CSS tokens.
- Hover/press transitions across buttons, rows, sidebar, picker, settings, compose; `.row:hover`; press scale on `.btn`, `.tb-btn`, `.compose-pill`, compose header/format/footer buttons, Send, reply buttons.
- Entrances: link popover, recipient suggestions, inline reply, recipient + attachment chips, drop overlay, attachments + reply buttons in the reading pane, settings pages (staggered), settings save bar, Welcome (staggered).
- Small state pops: unread dot, flags, sidebar counts (tick when the number changes), action-bar count.
- Exits: all App dialogs, UnsubscribeDialog, Settings, Add Account, Select list, compose popovers, toasts (with stack reflow), compose scrim, compose cards (close / send / pop-out).
- Height: sidebar sections + Favourites inbox rows + Scheduled, thread items, AI summary, mailing-list and remote-content banners, compose banner/confirm bar, Cc/Bcc rows, format bar.
- Sliding: category tab pill (`layoutId`, tabs `layout`), settings segmented thumb.
- Compose card minimize/restore (width/height transition); refresh icon finishes its turn.
- Bug fix: parked compose cards no longer remount when they move in/out of the dock (same element, `is-parked` class).

## Not done / ideas
- Context menus still close instantly (unmounted by many parents; Windows menus are near-instant anyway).
- Add Account step changes and Settings accounts list ↔ detail could slide.
- Settings "Saved" could fade out after a couple of seconds.
- Inline reply → pop-out morph (shared `layoutId`) — stretch.

## Verification
- `yarn typecheck` clean; built renderer driven in Electron mock mode (off-screen `showInactive`, CDP), sampling values per frame: pill/thumb slide, sidebar collapse/expand, row archive/undo, dialog/settings/toast/scrim/card fades, Cc/format-bar collapse, minimize/restore, full-screen centring, parked card keeps its element, search swaps instantly. Re-run with `--force-prefers-reduced-motion`: all height/transform motion instant.

## Reduce animations setting
- `Settings.reduceMotion` (Settings > General > Appearance). Effective value = setting OR OS `prefers-reduced-motion`.
- `motion.ts`: `applyReduceMotion` (sets `html[data-motion=reduce]`), `useReduceMotion` hook, `reduceMotionNow`. `main.tsx` feeds it to `MotionConfig`; `Collapse`, `MessageList`, `InlineReply` use it instead of OS-only checks.
- CSS: one global rule at the end of `styles.css` zeroes all CSS animation/transition durations; spinners are exempt.
- Pop-out window applies it from saved settings at boot (doesn't live-update).

## Change log
- 2026-10-21: Reduce animations setting.
- 2026-10-20: Created; foundations; phases 1–5 as above.
