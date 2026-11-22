# Fab
The floating add button on mobile (iOS and Android): one per screen, bottom-right, 20px from the edge and above the tab bar.

- Opens the composer Sheet; set `expanded: true` while the sheet is open and the plus turns 45° into a close mark.
- Hide it in Browse, Completed and Trash, where nothing can be added.
- `size-fab`, `accent` fill, `on-accent` icon, `shadow-2`. Hover grows 6%; press shrinks 8% on `--ease-spring`.
