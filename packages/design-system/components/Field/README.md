# Field
A labelled text input or select. The label wraps the control and sits above it.

- Label `callout` in `muted`; control `body` in `ink` on `surface`, `line` border, `radius-md`.
- Focus: `accent` border plus a 3px `accent-soft` halo. Invalid: `aria-invalid="true"` turns the border `danger`; put the message in a `pt-error` paragraph below with `aria-live="polite"`.
- Errors say what to do: "Give the task a name first." Clear the error as soon as the person types.
