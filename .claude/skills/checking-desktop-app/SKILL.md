---
name: checking-desktop-app
description: Check a change to the desktop app (apps/desktop) in its real macOS window without touching the installed app or the person's task folder. Load this skill before you launch, click through or screenshot a built Plaintask app.
---

# Checking the desktop app in its real window

`pnpm test` runs the app's page in headless Chrome. It does not cover WKWebView, the App Sandbox, the folder panel, the remembered folder or window dragging. A check of any of those needs the built app.

## Before you start

- The screen must be unlocked and awake. macOS paints no new window while it is locked, so a launch looks hung and a request to control the app is refused.
- A build from this repo and the app in `~/Applications` share the identifier `com.airshiplabs.plaintask`. They share one container and one remembered folder, so typing into a build under that identifier writes to the person's own `Inbox.md`. Never check with that identifier.

## Make a separate copy

1. Build under a test identifier:
   `pnpm --filter @plaintask/desktop tauri build --config '{"identifier":"com.airshiplabs.plaintask.dev"}'`
2. Copy `apps/desktop/src-tauri/target/release/bundle/macos/Plaintask.app` somewhere outside the repo. The next build overwrites it.
3. Open the copy once and quit it. macOS creates `~/Library/Containers/com.airshiplabs.plaintask.dev` on first launch.
4. Write a test `Inbox.md` into a folder under that container's `Data/tmp/`. The sandboxed copy can read its own container with no folder panel.
5. Start the copy's binary (`Contents/MacOS/plaintask`) with `PLAINTASK_ROOT` set to that folder.

## Input a background window does not accept

- Input sent to a window that is not frontmost is not a real event for three things: the system folder panel, a drag of the window by its top strip, and a double-click.
- Each of those needs full-screen control. List every such step first, ask for full-screen control once, and do them all in that grant.
- In the folder panel, Command-Shift-G takes a typed path.
- Keys work in the background: N, Return, Escape, j, k, the arrows and Space.

## What counts as checked

- After each step, compare `Inbox.md` on disk with the bytes you expect (`cmp`). A row on screen does not show what was written.

## Afterwards

- Quit the copy, delete it, and delete `~/Library/Containers/com.airshiplabs.plaintask.dev`.
- Build again without `--config`, so the bundle under `target/` carries the real identifier.
- Record what was checked, and what was not, in `apps/desktop/README.md` under "Checked in the built app's window".
