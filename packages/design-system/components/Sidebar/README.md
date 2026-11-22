# Sidebar
The desktop list of lists on macOS, Windows and Linux: the six views, then areas with their projects.

- Order is fixed: Inbox, Today, Upcoming, Anytime, Someday, Completed, Trash; then one uppercase `caption` header per area (Home, Work, Health) with its projects.
- The current item has `aria-current="true"`, `accent` text and icon. The `accent-soft` indicator behind it slides to the new item on `--ease-spring`: call `Plaintask.moveIndicator(nav)` after every change.
- Counts (Badge) on Inbox and Today only. `size-sidebar` wide on a mix of `surface-2` and `surface`, with a `line` divider.
