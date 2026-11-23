# Toast
A short status line after an action, with at most one action button.

- Completing a task always shows "Completed: <title>" with Undo. Adding a task outside the view shows "Added to <list>" with Show.
- `ink` ground with `bg` text (inverted in both themes), `radius-lg`, `shadow-2`. Rises in on `--ease-spring`, stays 5 s, falls out over 200ms. Toasts stack, newest at the bottom; none is removed early, so each Undo lasts its full 5 s.
- Place the toast host bottom-centre of the window or screen with `aria-live="polite"`.
