# Task: land the release pull request

Run one command. It creates the release branch from `origin/main`, adds the approved entries to `apps/desktop/CHANGELOG.md`, cuts the release there, writes the four version manifests, commits with a signature, pushes, opens the pull request, waits for the `test` check, and squash-merges. The person has approved this version and these entries.

## Inputs

- `version`: the version being released.
- `entriesFile`: the approved entries, `dist/release/entries.json`.

## Steps

Run from the repo root. Allow 25 minutes: the command waits for CI.

1. Run `node .claude/skills/release/scripts/release.mjs pr --version <version> --entries <entriesFile>`.
2. Act on the exit code:

| Exit | Do |
| --- | --- |
| 0 | Done. Stdout is `{"pr", "url", "mergeSha"}`. |
| 1 | Stop. Return `failed` with the last lines of stderr. |
| 2 | Stop. Return `blocked` with the last lines of stderr. |
| 3 | CI or the merge has not finished. Run the same command again, up to 3 times. Then return `blocked`. |

## Do not

- Do not pass `--no-verify` to any git command, and do not force-push.
- Do not edit `apps/desktop/CHANGELOG.md`, the manifests, or the entries file. A wrong changelog goes back to the person, not into a fix here.
- Do not fix a failed `test` check yourself. Return `failed` with the check's URL.
- Do not merge the pull request by any other command.

## Return

End your reply with exactly this block and nothing after it:

```text
RESULT: ok | failed | blocked
PHASE: land-release-pr
FACTS: <the command's stdout JSON, verbatim; "none" when it printed nothing>
NOTES: <at most 5 lines: on failure, the last lines of stderr>
```
