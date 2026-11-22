# Plaintask desktop

The desktop app, built with Tauri 2: one list, Inbox, backed by `Inbox.md` in a folder the person picks. A Rust layer owns the folder and the file; a page draws the list with the design system's own `tokens.css`, `bundle.css` and `bundle.js` (`packages/design-system`). macOS first: the sandbox entitlements, the folder bookmark and the window's traffic lights are the macOS-specific parts.

Closed source. Plaintask Sync and the agent log are not started.

## What it does

- No folder chosen: asks for one. The choice is remembered across launches.
- Shows the open tasks of `Inbox.md` in file order. A folder with no `Inbox.md` shows "Inbox zero" and is not written to.
- `N` or "New task" opens the form; Return adds the task as the last line of the file; Escape cancels.
- Clicking a checkbox, or Space on a focused row, ticks the task: one character of the file changes, the row folds away, and a toast offers Undo for 5 s.
- Return on a focused row, or a double-click on a title, opens the title in a field in its place. Return or leaving the field saves; Escape keeps the old title. Only the title's characters change in the file.
- `j`/`k` or the arrow keys move between rows.
- Rereads the file when the window regains focus.

Not built yet: other lists, projects, areas, tags, dates, repeating tasks, Trash, reordering, a view of completed tasks, a live file watcher, sync.

## Commands

Run from the repo root.

| Command | Does |
| --- | --- |
| `pnpm install` | Installs the Tauri CLI and TypeScript for this package |
| `PLAINTASK_ROOT=~/Tasks pnpm --filter @plaintask/desktop tauri dev` | Runs the app from source on that folder, with no folder panel and no sandbox |
| `pnpm --filter @plaintask/desktop app` | Builds `src-tauri/target/release/bundle/macos/Plaintask.app`: sandboxed, ad-hoc signed |
| `pnpm --filter @plaintask/desktop typecheck` | Type-checks `src/` |
| `pnpm test` | Runs the task file rules and the page tests with the repo's other tests |
| `pnpm --filter @plaintask/desktop check:rust` | Runs clippy on the Rust layer with warnings as errors, then its file and folder tests. CI runs it on macOS when `src-tauri/` changes (`.github/workflows/desktop-rust.yml`) |
| `pnpm --filter @plaintask/desktop measure` | Times launches of the built app |

## Layout

| Path | Holds |
| --- | --- |
| `src/inbox.ts` | The task file rules as pure functions: parse, list tasks, tick, rename, append, serialize |
| `src/app.ts` | The window: draws the list, the new-task form, ticking, Undo, renaming, keys. Reaches the outside only through its `Backend` |
| `src/main.ts` | Mounts `app.ts` on the Rust commands and asks for the window |
| `src/index.html`, `src/app.css` | Shell markup; the layout `bundle.css` leaves to the app |
| `build.mjs` | Bundles `src/` and copies the design system's three files into `dist/` |
| `src-tauri/src/main.rs` | The commands the page calls: `folder`, `choose_folder`, `read_inbox`, `write_inbox`, `ready`, `first_frame` |
| `src-tauri/src/folder.rs` | Remembers the chosen folder as a security-scoped bookmark |
| `src-tauri/src/inbox_file.rs` | Reads `Inbox.md`; replaces it through a temporary file and a rename |
| `scripts/measure-launch.mjs` | Launch timing |

Tests: `tests/inbox.test.ts` (file rules), `tests/desktop-app.test.mjs` (the built page in headless Chrome, with the Rust commands replaced by a folder held in memory), and the `#[cfg(test)]` modules in `src-tauri/src/`.

## File rules

- A task is a line that starts at the left margin with `- [ ] ` or `- [x] ` and has a title. Every other line is kept as it is and never shown: headings, notes, front matter, indented subtasks.
- Ticking changes one character. Renaming changes the title's characters and nothing else on the line. Adding appends one line, in the file's own line ending.
- No id is written to the file. A task is named by its title and its order among tasks with that title.
- Every change reads the file as it is on disk, applies the change and saves, so lines written by another editor since the last read survive.

## Sandbox

The app runs in the macOS App Sandbox (`src-tauri/Entitlements.plist`). `com.apple.security.network.client` is there because WKWebView loads no page without it inside the sandbox, the app's own bundled page included. The app makes no network requests.

## Speed budgets

Measured 2026-11-21 on an M-series Mac at a load average of 6 to 8, sandboxed release build, screen unlocked.

| Budget | Threshold | Measured | Met | Command |
| --- | --- | --- | --- | --- |
| Launch to first painted frame, median of 10, folder chosen | 400 ms | 483 ms | No | `pnpm --filter @plaintask/desktop measure` |
| Parse + tick + serialize, 10,000 lines, p95 | 5 ms | 3.3 ms (median 2.5 ms) | Yes | `PLAINTASK_PERF=1 pnpm test` |
| Add a task, 10,000 rows, key press to row drawn, median | 16 ms | 23.6 ms | No | same |
| Tick a task, 10,000 rows, click to row changed, median | 16 ms | 13.8 ms | Yes | same |

Where the launch time goes, same machine and minute:

| Launch | Median first frame |
| --- | --- |
| A bare AppKit window (no web view) | 132 ms |
| Plaintask, no folder chosen: Tauri, WKWebView and the page, no bookmark and no file read | 417 ms |
| Plaintask, folder chosen: the above plus resolving the bookmark and reading `Inbox.md` | 483 ms |
| Plaintask outside the sandbox, folder from `PLAINTASK_ROOT`: no bookmark, file read | 432 ms |

About 285 ms of the launch is the web view starting, which this stack cannot avoid. Resolving the security-scoped bookmark costs about 50 ms; it runs after the page loads and could run beside it.

`measure` reports two milestones per launch, in ms from process start: `ready` (the page has drawn itself and asked for its window) and `first-frame` (that page's first frame is painted). macOS paints no new window while the screen is locked, so only `ready` is reported then.

## Checked in the built app's window

Checked by hand on 2026-11-21 and 2026-11-22 in the sandboxed build: the folder panel, picking an empty folder, the bookmark across a relaunch and across an ad-hoc-signed rebuild, the traffic lights over the sidebar, dragging the window by its top strip with a real mouse, `N` / Return / Escape, the blank-title message, `j` and the arrow keys, Space and a click to tick, Undo, renaming by Return and by a real double-click, the reread when the window regains focus, the light and dark themes, and the file on disk after each step.

Background input that is not a real mouse does not drag the window or count as a double-click: a synthetic drag left the window in place and a synthetic double-click did not open the rename field.
