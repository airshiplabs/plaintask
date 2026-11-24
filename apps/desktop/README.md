# Plaintask desktop

The desktop app, built with Tauri 2: one list, Inbox, backed by `Inbox.md` in a folder the person picks. A Rust layer owns the folder, the file and updates; a page draws the list with the design system's own `tokens.css`, `bundle.css` and `bundle.js` (`packages/design-system`). macOS first: the sandbox entitlements, the folder bookmark, Sparkle's updates and the window's traffic lights are the macOS-specific parts.

Open source under the MIT License. Plaintask Sync and the agent log are not started.

## What it does

- No folder chosen: asks for one. The choice is remembered across launches.
- Shows the open tasks of `Inbox.md` in file order. A folder with no `Inbox.md` shows "Inbox zero" and is not written to.
- A folder that is gone (moved, renamed, deleted or on a disk that is not connected) shows "Your task folder cannot be found" and "Choose folder", not "Inbox zero".
- The Dock icon's badge shows the number of open tasks in `Inbox.md`, the same number as the sidebar. No open tasks, no badge.
- `N` or "New task" opens the form; Return adds the task as the last line of the file; Escape cancels.
- Clicking a checkbox, or Space on a focused row, ticks the task: one character of the file changes, the row folds away, and a toast offers Undo for 5 s.
- Return on a focused row, or a double-click on a title, opens the title in a field in its place. Return or leaving the field saves; Escape keeps the old title. Only the title's characters change in the file.
- `j`/`k` or the arrow keys move between rows.
- Rereads the file when the window regains focus.
- Checks for a new version at launch and every 24 hours. A newer one shows the toast "Plaintask <V> is available" with Update, which stays until it is clicked or closed. Update opens Sparkle's update window, which installs the version in place and restarts the app; the restart waits while the new-task form is open. App menu → "About Plaintask" shows the version and Check for Updates; "Check for Updates…" checks at once.

Not built yet: other lists, projects, areas, tags, dates, repeating tasks, Trash, reordering, a view of completed tasks, a live file watcher, sync.

## Commands

Run from the repo root.

| Command | Does |
| --- | --- |
| `pnpm install` | Installs the Tauri CLI and TypeScript for this package |
| `PLAINTASK_ROOT=~/Tasks pnpm --filter @plaintask/desktop tauri dev` | Runs the app from source on that folder, with no folder panel and no sandbox |
| `pnpm --filter @plaintask/desktop app` | Builds `src-tauri/target/release/bundle/macos/Plaintask.app`: sandboxed, ad-hoc signed without the hardened runtime (Developer ID and hardened runtime with `APPLE_SIGNING_IDENTITY`), Sparkle's nested code signed again afterwards. Use it, not `tauri build`, for any app that must install an update |
| `pnpm --filter @plaintask/desktop typecheck` | Type-checks `src/` |
| `pnpm test` | Runs the task file rules and the page tests with the repo's other tests |
| `pnpm test:perf` | Runs the speed budgets below, one test file at a time |
| `pnpm --filter @plaintask/desktop check:rust` | Runs clippy on the Rust layer with warnings as errors, then its file and folder tests. CI runs it on macOS when `src-tauri/` changes (`.github/workflows/desktop-rust.yml`) |
| `pnpm --filter @plaintask/desktop measure` | Times launches of the built app |
| `node .claude/skills/release/scripts/release.mjs build --version <V> --adhoc` | Builds an ad-hoc-signed `dist/release/<V>-adhoc/Plaintask_<V>_aarch64.dmg` to rehearse a release. The `release` skill makes the signed, notarized one |

## Layout

| Path | Holds |
| --- | --- |
| `src/inbox.ts` | The task file rules as pure functions: parse, list tasks, tick, rename, append, serialize |
| `src/app.ts` | The window: draws the list, the new-task form, ticking, Undo, renaming, keys. Reaches the outside only through its `Backend` |
| `src/session.ts` | The window's session as a state machine: what the list area shows, the form, a rename. `specs/DesktopSession.tla` models it |
| `src/rows.ts` | The list's rows, drawn only in and one view's height around the scroll view, so a 10,000-task Inbox draws ~50 rows |
| `src/main.ts` | Mounts `app.ts` on the Rust commands and asks for the window |
| `src/about.ts`, `src/about-main.ts`, `src/about.html`, `src/about.css` | The About window: the version and Check for Updates |
| `src/index.html`, `src/app.css` | Shell markup; the layout `bundle.css` leaves to the app |
| `build.mjs` | Bundles `src/` and copies the design system's three files into `dist/` |
| `src-tauri/src/main.rs` | The commands the page calls: `folder`, `choose_folder`, `read_inbox`, `write_inbox`, `ready`, `first_frame` |
| `src-tauri/src/folder.rs` | Remembers the chosen folder as a security-scoped bookmark |
| `src-tauri/src/update.rs` | Sparkle 2: the checks at launch and every 24 hours, the `update-available` and `update-restart` events, `check_for_updates`, `restart_for_update` |
| `src-tauri/src/about.rs` | The app menu's About Plaintask and Check for Updates… items, the About window, `app_version` |
| `src-tauri/Info.plist` | Sparkle's feed URL, the updates' public EdDSA key, and its switches: install through Installer.xpc, no checks or installs of its own |
| `scripts/sparkle.mjs` | Downloads Sparkle 2.9.6 (pinned SHA-256) into `src-tauri/Sparkle.framework` and `src-tauri/sparkle-bin/`, both git-ignored. The build, `tauri dev` and `check:rust` run it |
| `scripts/build-app.mjs` | `tauri build`, then Sparkle's XPC services, Autoupdate and Updater.app signed again without the app's entitlements, then the framework and the app |
| `src-tauri/src/inbox_file.rs` | Reads `Inbox.md`; replaces it through a temporary file and a rename that keeps its metadata |
| `scripts/measure-launch.mjs` | Launch timing |

Tests: `tests/inbox.test.ts` (file rules), `tests/desktop-app.test.mjs` (the built page in headless Chrome, with the Rust commands replaced by a folder held in memory), `tests/spec-desktop-session.test.mjs` (`session.ts` against its TLA+ spec, see `specs/README.md`; needs Java), and the `#[cfg(test)]` modules in `src-tauri/src/`.

## File rules

- A task is a line that starts at the left margin with `- [ ] ` or `- [x] `, has a title, and is not inside front matter, a fenced code block (```` ``` ```` or `~~~`) or an HTML comment (`<!--` … `-->`) that starts a line. A block counts only once it closes: an unclosed fence or `<!--` hides nothing. A task line never closes a comment. Every other line is kept as it is and never shown: headings, notes, front matter, code blocks, comments, indented subtasks.
- Front matter is a first line of `---` up to the next line of `---`. A first `---` with no closing `---` is a horizontal rule, and the tasks after it are shown.
- Ticking changes one character. Renaming changes the title's characters and nothing else on the line. Adding appends one line, in the file's own line ending.
- No id is written to the file. A task is named by its title and its order among tasks with that title.
- Every change reads the file as it is on disk, applies the change and saves, so lines written by another editor since the last read survive.
- A save writes a temporary file beside `Inbox.md` and renames it into place, so a reader sees the old text or the new, never half. The new file keeps the old one's permissions. It also keeps the owner, ACL, extended attributes (Finder tags among them) and creation date where the volume supports them; one it cannot keep is logged and does not stop the save. A symlinked `Inbox.md` stays a symlink.
- A read-only or locked `Inbox.md` is not changed, and neither is one with a hard link: the rename would leave the other name with the old text. The app says which in a toast. A symlink works in place of a hard link.

## Sandbox

The app runs in the macOS App Sandbox (`src-tauri/Entitlements.plist`). `com.apple.security.network.client` is there because WKWebView loads no page without it inside the sandbox, the app's own bundled page included; Sparkle also reads the feed and downloads updates through it. The app makes no other network requests. Two `mach-lookup` exceptions, `<bundle id>-spks` and `<bundle id>-spki`, let it reach Sparkle's Installer.xpc, which installs an update from outside the sandbox (https://sparkle-project.org/documentation/sandboxing/).

Launch a Developer ID signed build through Launch Services: `open -W -n --env PLAINTASK_MEASURE_LAUNCH=1 --stdout <file> Plaintask.app`. Executing `Contents/MacOS/plaintask` directly starts the process, but the page never draws and "ready" never prints. An ad-hoc-signed build draws either way. `scripts/measure-launch.mjs` launches through `open`, so it times either build.

## Speed budgets

Launch: measured 2026-11-21 on an M-series Mac at a load average of 6 to 8, sandboxed release build, screen unlocked. The other three: measured 2026-11-22 on the same Mac at a load average of about 65, by `pnpm test:perf`, which runs one test file at a time: run beside the other test files, the p95 measures the other files, not this code.

| Budget | Threshold | Measured | Met | Command |
| --- | --- | --- | --- | --- |
| Launch to first painted frame, median of 10, folder chosen | 400 ms | 483 ms | No | `pnpm --filter @plaintask/desktop measure` |
| Parse + tick + serialize, 10,000 lines, p95 | 5 ms | 2.8 ms (median 1.6 ms) | Yes | `pnpm test:perf` |
| Add a task, 10,000 tasks, key press to row drawn, median | 16 ms | 6.0 ms | Yes | same |
| Tick a task, 10,000 tasks, click to row changed, median | 16 ms | 1.0 ms | Yes | same |

Where the launch time goes, same machine and minute:

| Launch | Median first frame |
| --- | --- |
| A bare AppKit window (no web view) | 132 ms |
| Plaintask, no folder chosen: Tauri, WKWebView and the page, no bookmark and no file read | 417 ms |
| Plaintask, folder chosen: the above plus resolving the bookmark and reading `Inbox.md` | 483 ms |
| Plaintask outside the sandbox, folder from `PLAINTASK_ROOT`: no bookmark, file read | 432 ms |

About 285 ms of the launch is the web view starting, which this stack cannot avoid. Resolving the security-scoped bookmark costs about 50 ms; it runs after the page loads and could run beside it.

`measure` reports two milestones per launch, in ms from the start of `open`: `ready` (the page has drawn itself and asked for its window) and `first-frame` (that page's first frame is painted). macOS paints no new window while the screen is locked, so only `ready` is reported then.

## Checked in the built app's window

Checked by hand on 2026-11-21 and 2026-11-22 in the sandboxed build: the folder panel, picking an empty folder, the bookmark across a relaunch and across an ad-hoc-signed rebuild, the traffic lights over the sidebar, dragging the window by its top strip with a real mouse, `N` / Return / Escape, the blank-title message, `j` and the arrow keys, Space and a click to tick, Undo, renaming by Return and by a real double-click, the reread when the window regains focus, the light and dark themes, and the file on disk after each step.

Checked by hand on 2026-11-23, sandboxed Developer ID build under `com.airshiplabs.plaintask.dev`, local appcast on `127.0.0.1`: 0.2.1 read the feed by itself at launch and showed "Plaintask 0.2.2 is available"; Update opened Sparkle's window with the release notes; Install Update downloaded the DMG, checked its EdDSA signature, replaced the bundle and relaunched it as 0.2.2, still sandboxed; About read "Version 0.2.2". Not checked in the window: the restart waiting for an open new-task form (page tests only), the close button, and a Developer ID build that is also notarized.

Background input that is not a real mouse does not drag the window or count as a double-click: a synthetic drag left the window in place and a synthetic double-click did not open the rename field.
