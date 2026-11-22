# Badge
The count beside Inbox and Today in the sidebar: open tasks, nothing else.

- Shows only on Inbox and Today; other lists stay uncounted so the sidebar stays quiet. Empty when zero.
- `muted`, 11px/600, tabular figures. When the number changes, call `Plaintask.bump(badge)`: it grows 1.35× and flashes `accent` once.
