# Plaintask design system

The design language for the Plaintask desktop apps (macOS, Windows, Linux) and mobile apps (iOS, Android), from prototype 1 (sidebar and lists). Files: `tokens.json` (source of every token), `tokens.css` (generated: `node packages/design-system/build-tokens.mjs`), `components/` (`bundle.css`, `bundle.js` as `window.Plaintask`, `index.d.ts`, and per component a `README.md` and a `preview.html` that expects tokens.css, bundle.css and bundle.js preloaded), `assets/` (icons, logo mark). A browsable copy lives at https://claude.ai/artifact/N2X9Ng1gCdJKKHXNP8Xd6G (private).

Plaintask is a personal task manager whose tasks live as plain Markdown files in a folder the person owns. The apps on all five platforms share one design language: a sidebar of lists on desktop, a tab bar on mobile, and the same task row, checkbox, form and feedback everywhere. The look is quiet cool grey with one cobalt accent; the life comes from small, quick motion when work gets done.

## Principles

- **The list is the product.** Chrome stays out of the way: one ground (`bg`/`surface`), hairlines (`line`) instead of boxes, no cards around rows.
- **One accent, one meaning.** `accent` (cobalt) marks what you can act on or what is current: the primary button, the checked checkbox, the current list, focus, tags. Never use it for decoration.
- **Reward the tick.** Completing a task is the moment that gets the most motion: spring pop, tick drawn, six-dot burst, title struck through, row folds away. Everything else moves less.
- **Show what happened.** Every change that moves a task out of view answers with a toast ("Completed: Order floor tiles · Undo", "Moved to Trash: Rake the leaves · Undo", "Added to Upcoming · Show").
- **One language, native manners.** Every platform gets the same colors, type scale, components and motion. Each platform keeps its own conventions where people expect them: system font, shortcut modifier, back navigation, window controls, touch target size.

## Platforms

| | Shell | Adapts to the platform |
| --- | --- | --- |
| macOS | Sidebar, inline Composer | SF Pro; ⌘ shortcuts; traffic lights over the sidebar's top-left |
| Windows | Sidebar, inline Composer | Segoe UI Variable; Ctrl shortcuts; caption buttons top-right; contrast themes |
| Linux | Sidebar, inline Composer | The desktop's UI font (Adwaita Sans or Cantarell on GNOME, Noto Sans on KDE); Ctrl shortcuts; window controls on the side the desktop puts them |
| iOS | TabBar + Browse, Fab, Sheet | SF Pro; "‹ Browse" back button; home-indicator inset |
| Android | TabBar + Browse, Fab, Sheet | Roboto; arrow back button and the system back gesture; pill behind the current tab; 48dp targets |

- Set `data-platform` on `.pt-root` to `macos`, `windows`, `linux`, `ios` or `android`. The app knows its platform; `Plaintask.platform()` guesses from the user agent for web builds and previews.
- The colors and the cobalt accent stay the same on every platform. Do not take the system accent color.
- Touch screens (phones, and touch laptops on Windows and Linux) get `size-target` (48px) rows, tabs and back buttons through `@media (pointer: coarse)`.
- Under Windows contrast themes and other forced-colors modes, the checkbox, current list and tags switch to system colors (`Highlight`, `ButtonText`, `CanvasText`), so state stays visible.
- Dark theme follows the system setting on all five (`prefers-color-scheme`); `data-theme` overrides it.

## Content

- Sentence case everywhere: "New task", "Add task", "Kitchen renovation".
- Buttons start with a verb. Toasts name the task: "Completed: Rake the leaves".
- Errors say what to do, with no apology: "Give the task a name first."
- Empty states are a small reward and specific to the list: "All clear for today", "Nothing left on Today. Enjoy the evening."
- Dates are relative within a week ("Today", "Tomorrow", "Tue"), then short dates ("Sat 12 Dec"). Due dates read "Due Fri"; two days or less reads "Due soon · Mon" in `warn`.
- Tags keep their `#` and render in `font-mono`, as they are written in the file.
- The lists are always named Inbox, Today, Upcoming, Anytime, Someday, Completed, Trash.
- Shortcut labels use the platform's modifier: ⌘K on macOS, Ctrl+K on Windows and Linux (`Plaintask.shortcut('K')`). Single-letter shortcuts ("N") read the same everywhere.
- No emoji, no exclamation marks.

## Color

- Ground: `bg` for the desktop window and page; `surface` for the content pane, the mobile screen, sheets and the composer card; `surface-2` for default buttons, kbd hints and hover.
- Text: `ink` for titles and body, `muted` for meta, dates, counts and labels. Both reach 4.5:1 on `bg`, `surface` and `surface-2` in light and dark.
- `accent` with `on-accent` on top for fills (primary button, checked checkbox, FAB). `accent-soft` behind accent text (tags), for the current sidebar item, row hover and the add flash.
- `warn` only for due soon and overdue. `danger` only for validation errors and the confirm step of Empty Trash.
- Dark theme lightens `accent` to `#8a93ff`, so `on-accent` turns near-black there. Never hard-code white on accent.
- `line` is ink at 9% (10% in dark): pane dividers, tab bar border, input borders.

## Type

- One family: the system sans (`font-sans` resolves to SF Pro on macOS and iOS, Segoe UI Variable on Windows, Roboto on Android, the desktop's UI font on Linux). `font-mono` only for tags and kbd hints.
- Titles: `large-title` (mobile view title), `view-title` (desktop view title), `title`, `headline` (sheet title, empty-state headline).
- Text: `body` for task titles, nav, inputs and buttons; `callout` for task meta, field labels, toasts and group headers; `caption` for uppercase sidebar area headers; `tab-label` under tab bar icons.
- Numbers that line up (badges) use tabular figures.

## Space, shape, depth

- Spacing steps `space-1` to `space-6` (4 to 32px). Task rows pad 9px × `space-3` with a mouse, 13px on touch screens to reach `size-target`.
- Radius: `radius-sm` icon buttons and focus corners, `radius-md` buttons, inputs, rows and nav items, `radius-lg` composer card and toasts, `radius-sheet` sheet tops, `radius-pill` checkbox, tags, FAB.
- Shadows only on things that float: `shadow-1` resting, `shadow-2` composer and toasts, `shadow-3` sheets and windows. Rows and the sidebar have none.

## Motion

Motion has three durations and two curves, defined in `components/bundle.css`: `--d-1` 120ms (press), `--d-2` 220ms (hover, colour), `--d-3` 380ms (layout: sheet, collapse, tick); `--ease-out` for things settling, `--ease-spring` for things that should feel alive (checkbox pop, sidebar indicator, FAB, badge bump, toast in). The same values run on every platform.

- Complete: pop 1.18× → tick draws → 6-dot burst (520ms) → title struck left to right → hold 620ms → row folds to zero height (380ms).
- Move to Trash: the row folds away at once (380ms), with no tick or strike.
- Add: the new row drops 8px into place on an `accent-soft` flash (460ms), on every device that shows it.
- Navigate: the sidebar indicator slides to the new item; the list rises 6px into view (desktop) or slides 24px in from the right for a pushed view (mobile).
- Count change: the badge grows 1.35× and flashes accent once.
- Error: the form shakes 4px twice (320ms).
- Empty state: the tick mark floats 4px on a 3.2s loop.
- Under `prefers-reduced-motion` (on Linux, also GNOME's "Reduce animation"), every animation and transition drops to 1ms; state still changes.

## Interaction

- Desktop keys (macOS, Windows, Linux): `N` new task, Return or Enter adds, Escape cancels, `j`/`k` or arrows move between rows, Space completes the focused row, Delete or Backspace moves it to Trash.
- After completing or trashing with the keyboard, focus moves to the neighbouring row.
- Mobile back (iOS edge swipe, Android back gesture or button) closes an open sheet first, then leaves a pushed view.
- Focus ring: 2px solid `accent`, 2px offset (5.7:1 or more on every surface in both themes).
- Hidden UI (closed composer, closed sheet) is `inert`, so Tab never lands in it.
- Every completion and every move to Trash offers Undo for 5 s.
- Haptics on mobile: a light tap when a task completes (iOS light impact, Android click). Nothing else vibrates.

## Trash

- Moving a task to Trash takes it out of every list and puts it in Trash, newest first, grouped by the day it was deleted.
- Each row's "Move to Trash" button shows on hover or keyboard focus with a mouse, and stays visible on touch screens.
- Trash rows have no checkbox; Restore puts the task back where it was.
- The Trash view's header action is "Empty Trash" (ghost). It asks first in place, "Delete 3 tasks forever?", with a `danger` "Delete forever" button and Cancel. This is the one action without Undo.
- Trash never empties on its own; nothing counts down. Tasks leave Trash only through Restore or Empty Trash.
- Trash has no count badge.

## Iconography

- 20×20 stroke icons, 1.7 stroke, round caps and joins, drawn at 16px (24px in the tab bar). In the app they come from `Plaintask.icon(name)` and draw in `currentColor`; the files in Assets › Icons are the same paths in `muted`.
- One icon per list: inbox, today, upcoming, anytime, someday, completed, trash; `folder` for projects; plus, chevron, back (iOS), arrow-back (Android), repeat, close, search, tick, restore for actions.
- The same icons on every platform. No emoji, no filled icons.

## Logo

The mark is three ink circles and one cobalt square (Assets › Logos › `plaintask-mark.svg`, from the plaintask.app favicon). Its circles are fixed `#0b0c0e`, so place it on light grounds only. There is no wordmark file: set "Plaintask" in the system sans.

## Using the components

Load `tokens.css`, `components/bundle.css`, then `components/bundle.js`; it defines `window.Plaintask` with no framework needed. Wrap each screen in `class="pt-root"` with its `data-platform`. Components are functions that return HTML strings (`Plaintask.TaskRow(task)`), and the behaviours animate the elements they made (`Plaintask.complete(row, commit)`, `Plaintask.trash(row, commit)`, `Plaintask.toast(host, message, 'Undo', undo)`). Pass display-ready text in (dates already formatted); keep data and state in the app.
