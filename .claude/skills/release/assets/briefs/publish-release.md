# Task: publish the release and check what was published

Run one command. It turns the draft GitHub release into a published one, downloads the DMG and `SHA256SUMS.txt` from the published release, compares the download with the verified build, and writes `dist/release/<version>/release-report.md`. The person has approved publishing this version.

## Inputs

- `version`: the version being released.

## Steps

Run from the repo root. Allow 5 minutes.

1. Run `node .claude/skills/release/scripts/release.mjs publish --version <version>`.
2. Act on the exit code:

| Exit | Do |
| --- | --- |
| 0 | Done. Stdout is `{"url", "publishedAt", "sha256", "report"}`. |
| 1 | Stop. Return `failed` with the last lines of stderr. A checksum mismatch after publishing is urgent: say so first in NOTES. |
| 2 | Stop. Return `blocked` with the last lines of stderr. |

## Do not

- Do not move or delete the tag, and do not replace an asset. A published release is never changed.
- Do not set the release back to draft or delete it. That decision is the person's: `references/recovery.md`.
- Do not edit the release notes.

## Return

End your reply with exactly this block and nothing after it:

```text
RESULT: ok | failed | blocked
PHASE: publish-release
FACTS: <the command's stdout JSON, verbatim; "none" when it printed nothing>
NOTES: <at most 5 lines: on failure, the last lines of stderr>
```
