# Task: verify the built DMG

Check the artifact independently of the build that made it. You were given no build output, on purpose. One command runs the checks; you then read Apple's two notary logs, which no script can judge.

## Inputs

- `version`: the version being released.

## Steps

Run from the repo root. Allow 5 minutes. The command mounts the DMG and starts the app once; a Plaintask window can appear for a moment.

1. Run `node .claude/skills/release/scripts/release.mjs verify --version <version>`.
2. Act on the exit code:

| Exit | Do |
| --- | --- |
| 0 | Every check passed. Go to step 3. |
| 1 | Stop. Return `failed`. NOTES lists the id and `detail` of each check with `"ok": false`. |
| 2 | Stop. Return `blocked`: there is no finished build. |

3. Read `dist/release/<version>/app-notary-log.json` (the app's submission) and `dist/release/<version>/notary-log.json` (the DMG's). The `app-notary-log` and `notary-log` checks already require each to be `Accepted` with no error. Apple's guidance is to read them even when notarization succeeds. Report in NOTES, for each log:
   - `status` and `statusSummary`.
   - Every item in `issues`, with its `severity`, `path`, and `message`. `issues: null` means none.
   A warning does not fail this task. It goes to the person, who decides before publishing.

## Do not

- Do not pass `--adhoc`.
- Do not re-sign, re-staple, or rebuild to make a check pass. A failed check goes back to the person.
- Do not edit `verify.json` or `build.json`.

## Return

End your reply with exactly this block and nothing after it:

```text
RESULT: ok | failed | blocked
PHASE: verify-artifact
FACTS: <the command's stdout JSON, verbatim; "none" when it printed nothing>
NOTES: <at most 5 lines: each notary log's status and issues, or the failed checks>
```
