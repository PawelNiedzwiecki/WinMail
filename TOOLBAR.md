# Toolbar refactor (contextual split)

## Decisions
- Direction from Mobbin refs (Notion Mail, Front, Skiff, Superhuman): slim global top bar, per-message actions beside the message.
- Top bar: labeled accent Compose pill, Refresh, Search (260px, `Ctrl F` hint, clear button).
- `ActionBar` above the reading pane: Archive/Delete/Snooze | Reply/Reply All/Forward | Flag/Read/More. "More" (reuses `ContextMenu`) holds Move to…, Mark read/unread, Flag, Move to Junk.
- Handlers and shortcuts unchanged.

## Change log
- `Toolbar.tsx` reduced to global bar; `TbButton` exported.
- New `ActionBar.tsx`; `App.tsx` renders it inside a new `.reader` wrapper around `MessageView`.
- `styles.css`: `.compose-pill`, `.tb-divider`, `.reader`, `.action-bar`, `.action-count`, `.search-kbd`, `.search-clear`.
- `npm run typecheck` and `npm run build` pass.

## Todo / open
- [ ] Visual check in the running app: light/dark, Mica, narrow window, no selection, multi-select, Welcome screen.
- [ ] Decide whether the action bar should hide (not just disable) when nothing is selected.
