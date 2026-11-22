# Button
Buttons start an action; sentence case, verb first ("Add task", "New task").

- **primary** (`accent` fill, `on-accent` label): at most one per view, for the thing the view is for. The desktop view header's "New task" is the only one on the task list.
- **default** (`surface-2`): secondary actions beside a primary.
- **ghost** (`muted` text, `accent-soft` on hover): Cancel, toolbar icons.
- **danger** (`danger` fill, `on-danger` label): only the Delete forever step of Empty Trash.
- **iconOnly**: needs `label`; it becomes the `aria-label`.
- A `kbd` hint shows the desktop shortcut inside the button ("N"). For a shortcut with the command key, label it with `Plaintask.shortcut('K')`: ⌘K on macOS, Ctrl+K on Windows and Linux. Omit hints on iOS and Android.

Provide: `label`, optional `variant`, `icon` (an icon name), `kbd`, `type`. Press feedback is a 3% scale-down over `--d-1`.
