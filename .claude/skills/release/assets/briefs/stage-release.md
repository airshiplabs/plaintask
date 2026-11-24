# Task: tag the release commit and stage the draft release

Run one command. It creates the signed tag `desktop-v<version>` on the built commit, pushes the tag, signs the DMG with Sparkle's `sign_update` (the updates' EdDSA key in the login Keychain), writes `appcast.xml`, and creates a draft GitHub release with the release notes, the DMG, `SHA256SUMS.txt` and `appcast.xml`. A draft is visible only to people with write access to the repository. This task does not publish.

## Inputs

- `version`: the version being released.

## Steps

Run from the repo root. Allow 10 minutes.

1. Run `node .claude/skills/release/scripts/release.mjs stage --version <version>`.
2. Act on the exit code:

| Exit | Do |
| --- | --- |
| 0 | Done. Stdout is `{"tag", "sha", "url", "isDraft", "assets"}`. |
| 1 | Stop. Return `failed` with the last lines of stderr. |
| 2 | Stop. Return `blocked` with the last lines of stderr. |
| 3 | The `test` check on the release commit has not finished. Wait 60 seconds and run the same command again, up to 10 times. Then return `blocked`. |

## Do not

- Do not create, move, or delete a tag by any other command. A tag on the wrong commit goes back to the person: `references/recovery.md`, "Undo a stage".
- Do not create an unsigned tag. `git tag -a` makes one.
- Do not run `gh release edit --draft=false` or `publish`. Publishing waits for the person's approval.
- Do not upload, replace, or delete a release asset.

## Return

End your reply with exactly this block and nothing after it:

```text
RESULT: ok | failed | blocked
PHASE: stage-release
FACTS: <the command's stdout JSON, verbatim; "none" when it printed nothing>
NOTES: <at most 5 lines: on failure, the last lines of stderr>
```
