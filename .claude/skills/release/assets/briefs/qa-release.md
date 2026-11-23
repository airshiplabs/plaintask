# Task: QA the release commit and give a verdict

Run the release QA checklist once on the commit the verified DMG was built from, decide whether the release is ready, and file what you found as GitHub issues. You test the flows most people use, not every edge case. Nothing is fixed during this task.

## Inputs

- `version`: the version being released.
- `sha`: the commit the verified DMG was built from.

## What you test, and why not the DMG

The notarized DMG carries the identifier `com.airshiplabs.plaintask`. It shares its container and remembered folder with the installed app, so driving it would write to the person's own `Inbox.md`. You test the same commit two ways instead:

- The page tier: `control-desktop` from the `verify-desktop` skill.
- The real window: a build of the same commit under the test identifier, from the `checking-desktop-app` skill.

## Steps

Allow 30 minutes. `$OUT` is a new folder under the system temporary folder. Keep every file you make there.

1. Read `.claude/skills/release/assets/qa-checklist.md`, `docs/feature-map/README.md`, and the feature files its rows name.
2. Check out the commit: `git worktree add --detach "$OUT/src" <sha>`, then `pnpm install --frozen-lockfile` in `$OUT/src`. Run every app command from `$OUT/src`, so you test `<sha>` and not this checkout.
3. Run the `page` rows. Load the `verify-desktop` skill and follow each row's recipes in its feature file. Compare `Inbox.md` with the expected bytes after every step that writes.
4. Run the `window` rows. Load the `checking-desktop-app` skill and follow it in `$OUT/src`, with a disposable folder under the test container. List every step that needs full-screen control, and ask the person once. If they decline, mark those rows `not covered: control declined` and do not drive the window another way.
5. For each failure, reproduce it once more, alone. A failure you saw once and cannot reproduce is reported in NOTES, not filed.
6. Classify each reproduced failure. It is a **blocker** if any of these hold:
   - `Inbox.md` loses data or holds bytes the person did not ask for.
   - The app does not launch, crashes, or shows a blank window.
   - A person cannot finish a row's flow: choose a folder, add, tick, Undo, rename, or see another editor's change.
   - A flow that worked in the last release no longer works.

   Everything else is not a blocker. Pick its label: `bug` for wrong behaviour, `accessibility` for a barrier to a person using assistive technology or the keyboard, `enhancement` for something that works as built and should work better, `documentation` for a feature file or README that disagrees with the app.
7. File the issues. Follow steps 5 and 6 of the `exploratory-qa` skill: evidence, a duplicate search, one body per issue from `.claude/skills/exploratory-qa/assets/issue-body.md`, and one read-back. A blocker gets `--label bug --label release-blocker`. If the label is missing, create it once: `gh label create release-blocker --color B60205 --description "Stops a release until fixed"`. Put `Found by release QA of <version> at <sha>.` as the first line under "How it was checked".
8. Write the report into `$OUT/qa-report.md` from `.claude/skills/release/assets/qa-report.md`. The verdict is `blocked` when any blocker was filed, else `ready`.
9. From the repo root, record it:

   ```sh
   node .claude/skills/release/scripts/release.mjs qa --version <version> --verdict <ready|blocked> --report "$OUT/qa-report.md" [--blockers N,N] [--issues N,N]
   ```

   `--blockers` lists the blocker issues, `--issues` every other issue filed. Leave out a list that is empty.

| Exit | Do |
| --- | --- |
| 0 | Recorded. Go to step 10. |
| 1 | Stop. Return `failed` with the last lines of stderr. |
| 2 | A flag is wrong, or the verified build is missing. Fix a flag you got wrong and run it again once; otherwise return `blocked`. |

10. Clean up: "Afterwards" in `checking-desktop-app`, `control-desktop cleanup` for each run, `git worktree remove --force "$OUT/src"`, then delete `$OUT`. `git status --short` in the repo root must print nothing new.

## Do not

- Do not launch, mount, or copy the DMG in `dist/release/<version>/`.
- Do not drive a build with the identifier `com.airshiplabs.plaintask`, the installed app, or the person's task folder.
- Do not change code, a feature file, or a test to make a row pass.
- Do not file a missing feature that `apps/desktop/README.md` lists under "Not built yet".
- Do not edit `qa.json`, `verify.json`, or `build.json` by hand.

## Return

End your reply with exactly this block and nothing after it:

```text
RESULT: ok | failed | blocked
PHASE: qa-release
FACTS: <the qa command's stdout JSON, verbatim; "none" when it printed nothing>
NOTES: <at most 5 lines: verdict; each blocker as #n and title; other issue numbers; rows not covered>
```

`RESULT: ok` means the verdict was recorded, whether it is `ready` or `blocked`.
