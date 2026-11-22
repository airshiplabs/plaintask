# Task: build, sign, and notarize the DMG

Run one command. It checks out the release commit, builds the app with the Developer ID identity, packages `Plaintask_<version>_aarch64.dmg`, signs it, has Apple notarize it, staples the ticket, and writes `build.json` and `SHA256SUMS.txt` into `dist/release/<version>/`.

## Inputs

- `version`: the version being released.
- `sha`: the full commit id on `main` to build, 40 characters.

## Steps

Run from the repo root. Allow 60 minutes or more: a cold Rust build takes about 10, and the build makes two notary submissions, the app and then the DMG. Each usually takes minutes, but a team's first submission can take hours.

1. Run `node .claude/skills/release/scripts/release.mjs build --version <version> --sha <sha>`.
2. Act on the exit code:

| Exit | Do |
| --- | --- |
| 0 | Done. Stdout is the build record. |
| 1 | Stop. Return `failed`. If stderr mentions notarization, read `dist/release/<version>/app-notary-log.json` (app step) or `notary-log.json` (DMG step) and put each issue's `path` and `message` in NOTES. |
| 2 | Stop. Return `blocked` with the last lines of stderr. A missing identity or notary profile is fixed by the person, not by you. |
| 3 | Notarization is still in progress. Run the same command again, up to 6 times, then return `blocked`. On the app step (`app notarization ... in progress`) and on the DMG step (`notarization ... in progress`) it resumes at the wait: it does not build or submit again. |

Tauri prints "skipping app notarization, no APPLE_ID ..." on every build. It is expected: the script notarizes with the `plaintask-notary` keychain profile itself. Do not report it.

## Do not

- Do not pass `--adhoc`. An ad-hoc build cannot be released.
- Do not set `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_API_KEY`, or any other credential variable. The command reads the keychain.
- Do not run `codesign`, `notarytool`, `stapler`, or `hdiutil` yourself to finish a failed build.
- Do not edit source files to make the build pass. A build failure goes back to the person.
- Do not delete anything in `dist/release/<version>/`.

## Return

End your reply with exactly this block and nothing after it:

```text
RESULT: ok | failed | blocked
PHASE: build-artifact
FACTS: <the command's stdout JSON, verbatim; "none" when it printed nothing>
NOTES: <at most 5 lines: on failure, the last lines of stderr or the notary log issues>
```
