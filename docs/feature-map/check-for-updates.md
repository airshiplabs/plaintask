# Check for updates

The app checks the release feed at launch and every 24 hours. When a newer Plaintask is out, the main window shows a toast that offers it. Update opens Sparkle's update window, which downloads the new version, checks its EdDSA signature, replaces the app in place and restarts it. The About window shows the version and checks on request. `Inbox.md` is never read or written by this feature.

Sparkle 2 does the work (`apps/desktop/src-tauri/src/update.rs`). Its Installer.xpc service replaces the bundle, which the App Sandbox does not let the app do itself.

## Use cases

- As a person who wants the newest version, I click Update when the app offers one, and it installs and restarts.
- As a person who wants to know which version runs, I open About Plaintask from the app menu.
- As a person who does not want to wait for the daily check, I choose Check for Updates.

## Sub-features

- `check-scheduled`: a check with no window at launch, once the main window is drawn, then every 24 hours. Offline, up to date, or with Sparkle's window already open, nothing shows.
- `offer-toast`: a check that finds a newer version shows the toast `Plaintask <version> is available` with the button `Update` and a close button. It stays until one of them is clicked. A second check that finds the same version adds no second toast.
- `offer-closed`: the close button takes the toast away. The next check that finds the version offers it again.
- `offer-update`: `Update` takes the toast away and opens Sparkle's update window: the version, its release notes and `Install Update`. Sparkle downloads and installs, then offers `Install and Relaunch`.
- `restart-waits`: when Sparkle is ready to restart into the new version and the new-task form is open, the restart waits until the form closes: the task is added, or the form is cancelled.
- `about-open`: the app menu item `About Plaintask` opens a small window: the app icon, `Plaintask`, `Version <version>` and `Check for Updates`. It does not check by itself.
- `check-now`: the app menu item `Check for Updates…`, and the About window's button, open Sparkle's update window, which checks at once and says what it found: an update, `You're up to date!`, or why the feed cannot be read.
- No install on quit: Sparkle never checks, downloads or installs without the person choosing Update or Install (`SUEnableAutomaticChecks` and `SUAllowsAutomaticUpdates` are off in `Info.plist`).

## How to get to it (user POV)

- The toast at the bottom of the main window, when an update is out.
- App menu `Plaintask` → `About Plaintask`.
- App menu `Plaintask` → `Check for Updates…`.

## Driving it with control-desktop

Preconditions:

- `control-desktop` drives the main window's page only, with no Rust layer behind it, so no check runs there. The page-tier proofs are tests in `tests/desktop-app.test.mjs`, which send the window the events the Rust layer sends: `node --test --test-name-pattern="update|About" tests/desktop-app.test.mjs`.
- Sparkle's window, the download, the signature check, the bundle swap and the restart are real window only: see "A real install" below.

- **`offer-toast`.** Action: the window receives `update-available` with `0.3.0`. Result: the toast `Plaintask 0.3.0 is available` with `Update`, still there after 5 s. Handle: `[data-toasts] .pt-toast[data-update]`. Page tier: the test `an update the check finds is offered in a toast that stays; Update opens the update window`. It also proves the window listens before it calls `ready`, which starts the checks.
- **`offer-update`.** Action: click `Update`. Result: the toast goes and `check_for_updates` runs. Page tier: same test. Sparkle's window: real window only.
- **`offer-closed`.** Action: click the close button, then a second `update-available`. Result: the toast goes, no update window opens, and the second event shows the toast again. Page tier: the test `a closed update toast comes back with the next check that finds the update`.
- **`restart-waits`.** Action: open the form, type a title, receive `update-restart`, then press Return. Result: no `restart_for_update` while the form is open; it runs once the task is saved. With the form closed it runs at once. Page tier: the test `an installed update restarts the app at once, or waits while the new-task form is open`.
- **`about-open`, `check-now`.** Action: open `about.html`, click `Check for Updates`. Result: `Version 0.2.0`, no check until the click, then `check_for_updates`. Page tier: the tests `About shows the version, and Check for Updates opens the update window` and `About says why the update window could not open`. The menu items: real window only.

## A real install

Outside the repo, never on `/Applications/Plaintask.app`. The `checking-desktop-app` skill covers the test identifier and cleaning up.

1. Make a throwaway key: `openssl genpkey -algorithm ed25519 -out k.pem`, then `openssl pkey -in k.pem -outform DER | tail -c 32 | base64 > priv.b64` and `openssl pkey -in k.pem -pubout -outform DER | tail -c 32 | base64` for the public key.
2. In `apps/desktop/src-tauri/Info.plist`, for these builds only: `SUFeedURL` = `http://127.0.0.1:<port>/appcast.xml`, `SUPublicEDKey` = the public key, and `NSAppTransportSecurity` → `NSAllowsLocalNetworking` = true. Put the file back afterwards.
3. Build the older and the newer version: `pnpm --filter @plaintask/desktop app --config '{"identifier":"com.airshiplabs.plaintask.dev","version":"<V>"}'`, copying the bundle out after each. Run `node apps/desktop/scripts/sparkle.mjs` first if `src-tauri/sparkle-bin` is missing.
4. Put the newer one in a DMG or a zip (`ditto -c -k --sequesterRsrc --keepParent Plaintask.app <file>.zip`), sign it (`apps/desktop/src-tauri/sparkle-bin/sign_update --ed-key-file priv.b64 <file>`), and write an `appcast.xml` around what it prints (`appcastXml` in `.claude/skills/release/scripts/artifact.mjs`). Serve the folder on `127.0.0.1`.
5. Open the older copy with `open -n`, wait for the toast, click `Update`, then `Install Update` and `Install and Relaunch` in Sparkle's window. Result: `CFBundleShortVersionString` of the copy is the newer version, a new process runs, and `codesign -d --entitlements - <pid>` still lists `com.apple.security.app-sandbox`.

## Gotchas

- The feed is `appcast.xml` on the latest release of `airshiplabs/plaintask`. A draft or pre-release there is never offered, and the repository must be public.
- Sparkle compares the appcast's `sparkle:version` with `CFBundleVersion`, so both are the release's version.
- A plain `tauri build` signs Sparkle's Installer.xpc with the app's sandbox entitlements. The download and the signature check then pass, and the install fails with "An error occurred while launching the installer". `pnpm --filter @plaintask/desktop app` signs it again without them; `release.mjs verify` checks it (`app-sparkle-installer`).
- `tauri dev` runs no bundle, so Sparkle does not start and no check runs.
- Versions up to 0.2.1 have no updater: the first version with one is installed by hand.
