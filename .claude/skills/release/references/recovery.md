# Recovering a release

`release.mjs status --version <V>` reports the phase a release is in and the task that moves it forward. Every subcommand inspects first and skips finished work, so the default recovery is: fix the cause, run the same command again.

`R` below is `node .claude/skills/release/scripts/release.mjs`. `<branch>` is the release branch: `chore--release-desktop-v0-1-0` for version 0.1.0, the form the `branch-naming` skill requires.

## Exit codes

| Exit | Means | Do |
| --- | --- | --- |
| 1 | A check failed | Read stderr. Find the row below. Do not run the next phase. |
| 2 | Usage error or missing prerequisite | Fix the command, or follow `references/setup.md`. |
| 3 | CI or notarization is still running | Run the same command again. |

## By phase

| Phase | Failure | Recovery |
| --- | --- | --- |
| `cut` | `cannot cut <V>: ... does not match the changelog format` | The message names the rule and line. `after the release` means an entry in `dist/release/entries.json` breaks it: fix that entry. `before the release` means `apps/desktop/CHANGELOG.md` on `main` is already invalid: fix it in a pull request. |
| `cut` | `[Unreleased] already has the entry` | Remove that entry from `dist/release/entries.json`. |
| `pr` | `the working tree is not clean` | Commit or remove the changes. `dist/` is ignored and can stay. |
| `pr` | The commit is rejected by a hook | `commit-msg` judges the message, `pre-commit` the staged changelog. Read the hook's stderr. Never pass `--no-verify`. |
| `pr` | `the release commit has no valid signature` | Nothing was pushed. Fix signing (`references/setup.md`, `git-signing`), delete the local release branch with `git branch -D <branch>`, run `pr` again. |
| `pr` | `git push` rejected | The release branch from an earlier attempt is on origin. Close its pull request if one is open, delete the branch with `git push origin --delete <branch>`, run `pr` again. |
| `pr` | The `test` check failed on the pull request | Fix the cause on the release branch with a new signed commit and push. Do not amend and force-push. Run `pr` again: it finds the open pull request and waits for the check. |
| `pr` | Pull request conflicts with `main` | Rebase the release branch onto `origin/main` (no merge commit), push, run `pr` again. |
| `build` | `pnpm` or `cargo` failed | Fix forward through a normal pull request. Do not revert the release pull request. Then `R build --version <V> --sha <new origin/main commit>`. The version is not used up: no tag exists yet. |
| `build` | `would fail notarization` | The message names each problem. No secure timestamp or the wrong team: check the network and `signing-probe` in `references/setup.md`. No hardened runtime or `com.apple.security.get-task-allow`: the build was not a release build. Then build again. |
| `build` | Exit 3, notarization in progress | Run the same `build` command. It resumes at the wait and does not rebuild. A team's first submission can take hours. |
| `build` | `notarization ... ended as Invalid` | `dist/release/<V>/notary-log.json` lists each file and message. Fix forward as for a build failure. Remove `dist/release/<V>/` before building the same commit again. |
| `build` | Exit 3, `app notarization ... is still in progress` | The `.app` is notarized before the DMG is made, with a 60-minute wait. Run the same `build` command: it builds and submits the app again. |
| `build` | `app notarization ... ended as Invalid` | `dist/release/<V>/app-notary-log.json` lists each file and message. Fix forward as for a build failure. |
| `build` | `a GitHub release for desktop-v<V> exists` | A rebuild makes a different DMG than the one staged. To rebuild, undo the stage first (below). |
| `verify` | Any check fails | Do not stage. The failed check ids are in `verify.json`. Fix the cause and build again. |
| `stage` | Exit 3, `test` check not finished on the release commit | Run `stage` again when the check on `main` finishes. |
| `stage` | `no passing verify.json`, or the DMG `changed after it was built and verified` | Run `verify` again. If the DMG changed, remove `dist/release/<V>/` and build again. |
| `stage` | Tag pushed, `gh release create` failed | Run `stage` again. It keeps the tag when origin's tag points at the release commit. |
| `stage` | `tag desktop-v<V> on origin points at <other>` | See "Undo a stage". |
| `publish` | `the published ... has sha256 <other>` | `gh release edit desktop-v<V> --draft=true`, then find out why the asset differs. Re-upload only from the verified `dist/release/<V>/`: `gh release upload desktop-v<V> dist/release/<V>/<dmg> --clobber`. Run `publish` again. |

## Undo a stage

Allowed only while the release is a draft. Ask the person first: this deletes a tag on origin.

```sh
gh release delete desktop-v<V> --yes
git push origin :refs/tags/desktop-v<V>
git tag -d desktop-v<V>
```

Then run `build` and `verify` again if the artifact is to change, and `stage` again.

## After publishing

A published release is never changed.

- Do not move or delete the tag.
- Do not replace the asset.
- A bad release: add a line to its notes on GitHub saying so, then release the fix as the next patch version.

## A change lands after the release pull request

A fix-forward pull request after the release pull request can add a change the `[<V>]` release in `apps/desktop/CHANGELOG.md` does not mention. Its own entry goes under `[Unreleased]`, with the `keep-a-changelog` skill's `add.mjs`, and ships in the next version's notes. The DMG built from the newer commit still contains the change. Tell the person, who decides whether that is acceptable or whether to release `<V>` as it is and follow with a patch.

## Start a release over

Before `stage`, nothing public exists except the release commit on `main`. Remove `dist/release/<V>/` and run `status`.
