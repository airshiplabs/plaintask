# Checkbox
The round checkbox that completes a task: the most-used control in the app and its one moment of celebration.

- A `button` with `role="checkbox"` and `aria-checked`; its label reads "Complete: <task title>".
- Ticking it: the circle fills `accent` with a 1.18× spring pop, the tick draws over `--d-3`, and six `accent` dots burst outward over 520ms. Use `Plaintask.complete(row)` to run the whole sequence on a TaskRow.
- Unchecked ring is `muted` (4.7:1 or more on every surface), hover turns it `accent`.
- `size-check` (22px). Row padding gives it a 40px+ target; never shrink the row padding.
