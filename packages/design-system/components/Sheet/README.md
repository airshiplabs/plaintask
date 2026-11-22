# Sheet
The mobile bottom sheet that holds the Composer, on iOS and Android.

- Slides up from below on `--ease-out` over `--d-3` while the `scrim` fades in. A grabber (36×5, `surface-2`) sits at the top; corners `radius-sheet`.
- Put the sheet inside a `pt-sheet-host` that covers the screen. `Plaintask.openSheet(host)` removes `inert` and focuses the first field; `closeSheet(host)` puts it back. Tapping the scrim, Cancel, Escape or Android's system back closes it. On Android, back closes the sheet before it leaves the view.
- One sheet at a time. Never stack a sheet on a sheet.
