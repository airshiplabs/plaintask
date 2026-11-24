---
name: release
description: Release a new version of the Plaintask macOS desktop app from start to finish - changelog, version bump, release pull request, signed and notarized DMG, a QA run of the core user flows, signed git tag, and published GitHub release with the DMG attached. Use this skill whenever the user asks to release, ship, cut, tag, or publish a Plaintask version, to build the DMG for distribution, or to check on, resume, or recover a release in progress. Not for a development build of the app (`pnpm --filter @plaintask/desktop app`).
---

# Release

You are the orchestrator of one release. You run two read-only commands yourself, hand every other task to a subagent with a fresh context, and stop twice for the person's approval. `release.mjs` does every deterministic step; subagents add judgment where a script cannot, and keep build logs out of your context.

```sh
node .claude/skills/release/scripts/release.mjs <subcommand> [flags]
```

Run it from the repo root. Its header lists every subcommand. Exit 0: done. Exit 1: a check failed. Exit 2: usage error or a missing prerequisite. Exit 3: CI or notarization is still running; run the same command again.

A release ships `Plaintask_<version>_aarch64.dmg`, for Apple Silicon Macs, built on this Mac, with `SHA256SUMS.txt` and `appcast.xml`. The tag is `desktop-v<version>`. The app updates itself through Sparkle from `appcast.xml` on the repository's latest release, which offers that same DMG, signed with the updates' EdDSA key (`references/setup.md`, `sparkle-key`).

The changelog is `apps/desktop/CHANGELOG.md`. Its format, its scripts, and that tag name belong to the `keep-a-changelog` skill; this skill calls its module and never restates its rules.

## What you must not do

- Do not run `cut`, `pr`, `build`, `verify`, `qa`, `stage`, or `publish` yourself. Each belongs to a subagent.
- Do not edit `apps/desktop/CHANGELOG.md` or a version manifest, and do not run the `keep-a-changelog` scripts `add.mjs` or `release.mjs` during a release. `cut` adds the entries and cuts the release on the release branch.
- Do not treat a subagent's reply as proof. After each one, run `status` and go on only when the phase advanced.
- Do not pass either stop without the person's own answer in this conversation. Approval of one release, or of stop 1, is not approval of stop 2.
- Do not create an unsigned commit or tag, pass `--no-verify`, or force-push. When signing fails, stop and report the command, its error, and the fix from `references/setup.md`.
- Do not move, delete, or re-point a tag, or replace an asset, once the release is published.

## 1. Find where the release stands

```sh
node .claude/skills/release/scripts/release.mjs status [--version <V>]
```

Pass `--version` only when the person named one. Stdout:

| Field | Use |
| --- | --- |
| `version` | The release in flight, or the one the `[Unreleased]` entries call for. `null` with `next: draft-changelog`: no version is known until the entries are drafted. `null` with `next: none`: there is nothing to release; say so and stop. |
| `phase` | One of `plan`, `pr-open`, `pr-merged`, `built`, `verified`, `qa-passed`, `staged`, `published`. |
| `next` | The task that moves the release forward. Go to its row in section 3. |
| `releaseSha` | The commit to build, once the release pull request is merged. Before a tag exists, a commit on `main` after the build makes this the new `origin/main` commit, with `next: build-artifact`. |
| `problems` | Each one needs an answer before you go on. `references/recovery.md` has the fix. |

A phase other than `plan` means an earlier run stopped partway. Tell the person "resuming <version> at <phase>" and continue from `next`. Do not start over.

## 2. Preflight (phase `plan` only)

```sh
node .claude/skills/release/scripts/release.mjs preflight
```

| Exit | Do |
| --- | --- |
| 0 | Go on. A check with `warn: true` passed; show the person its `id`, `detail`, and `fix` first. `notary-profile` warns when the team has no notary submission yet: point them to "One-time test submission" in `references/setup.md`. |
| 2 | A setup or checkout check failed, and no quality gate ran. Show each failing check's `id`, `detail`, and `fix`. Fix what is yours to fix: `head-at-main` (`git switch --detach origin/main`) and `git-hooks` (`pnpm run prepare`). `signing-identity`, `signing-probe`, and `notary-profile` are the person's: point them to `references/setup.md` and stop. |
| 1 | A quality gate failed on `origin/main`: the changelog format check, `pnpm test`, the desktop `typecheck`, or `check:rust`. Report it and stop. A release does not start from failing code. |

The gates take about 5 minutes.

## 3. Run the phases

Start at the row `status` named in `next`. One subagent per row, one at a time.

| `next` | Brief | Inputs | Then |
| --- | --- | --- | --- |
| `draft-changelog` | `draft-changelog.md` | none | Review, then stop 1 |
| | `review-changelog.md` | `version`, `entriesFile` | See "Draft and review" |
| `land-release-pr` | `land-release-pr.md` | `version`, `entriesFile` | Only after stop 1 |
| `build-artifact` | `build-artifact.md` | `version`, `sha` = `releaseSha` | About 10 to 25 minutes |
| `verify-artifact` | `verify-artifact.md` | `version` | |
| `qa-release` | `qa-release.md` | `version`, `sha` = `releaseSha` | About 30 minutes. The subagent asks the person once for screen control. See "QA verdict" |
| `stage-release` | `stage-release.md` | `version` | Then stop 2 |
| `publish-release` | `publish-release.md` | `version` | Only after stop 2 |
| `done` | | | Section 5 |

### Dispatching a subagent

Start a general-purpose subagent, not a fork: a fork inherits this conversation, and the reviewer and the verifier are worth having only because they do not. Send this prompt and nothing else:

```text
Release task for Plaintask. Work in the repo at <absolute repo root>; do not change directory out of it.
Read .claude/skills/release/assets/briefs/<brief> and follow it exactly.
Inputs:
<name>: <value>
```

Do not add a summary of earlier phases, what you expect to find, or advice. The brief holds the task.

Every brief ends in the same block:

```text
RESULT: ok | failed | blocked
PHASE: <task>
FACTS: <the script's stdout JSON>
NOTES: <at most 5 lines>
```

After each reply from `land-release-pr` onward, run `status --version <V>`:

- The phase advanced: go to the next row.
- `RESULT: failed` or `blocked`, or the phase did not advance: stop. Report NOTES and the matching row of `references/recovery.md` to the person. Do not dispatch the same task again until the cause is fixed.

### Draft and review

Drafting and review change no phase: `status` stays at `plan` until the release pull request opens. Their proof is the exit code of `cut --dry-run`, which each of them runs.

1. Dispatch `draft-changelog.md`. Its FACTS give `version`, `bump`, `reason`, `entriesFile`, the rendered `section`, and `omitted`.
2. Dispatch `review-changelog.md` with that `version` and `entriesFile`. Pass nothing from the drafter's reply.
3. Verdict `CHANGES`: dispatch `draft-changelog.md` again with the input `findings: <the reviewer's findings JSON>`, then review again. At most 2 rounds. Findings still open after round 2 go to the person at stop 1.

### QA verdict

`qa-release` tests the release commit, not the DMG, against `assets/qa-checklist.md`: the flows most people use, not every edge case. It files each problem it reproduces as a GitHub issue, and a blocker also gets the label `release-blocker`. Its brief defines a blocker.

- `status` reports `qa-passed`: the verdict is `ready`. Go on to `stage-release`.
- `status` reports `verified` with a `qa.json records release blockers` problem: stop. Show the person each blocker issue and its link. A blocker is fixed forward with a normal pull request; then `status` names `build-artifact`, and the release runs build, verify and QA again with the same version.

### Stop 1: version and changelog

Show the person:

1. The version, and `bump` and `reason` from the drafter.
2. The rendered section, as it will appear in the release notes. It holds the entries already in `apps/desktop/CHANGELOG.md` and the ones the drafter adds.
3. Each omitted commit with its reason.
4. The reviewer's verdict and any open finding.

Ask whether to open the release pull request. This is the last point where nothing has changed outside this Mac. After it, the subagent pushes a branch, opens a pull request, and merges it into `main` when the `test` check passes.

| Answer | Do |
| --- | --- |
| Approve | Dispatch `land-release-pr.md`. |
| Change the entries | Dispatch `draft-changelog.md` with `notes: <their words, verbatim>`, review, and return to this stop. |
| A different version | Dispatch `review-changelog.md` with `version: <theirs>` and the same `entriesFile`, then return to this stop. It must be above the last release. |

### Stop 2: publish

After `stage-release`, show the person:

1. The draft release URL, the tag, and the commit.
2. The asset name, size, and SHA-256. Publishing marks the release latest, so every installed copy offers it within 24 hours.
3. How many `verify` checks passed, by count, and every notary log issue the verifier reported.
4. The QA verdict, each checklist row marked `not covered` and why, and each issue QA filed, with its link. These are not blockers; the person decides whether any of them should hold the release.

Ask whether to publish. A published release cannot be withdrawn: the tag and the asset stay as they are, and a fix ships as the next version.

| Answer | Do |
| --- | --- |
| Publish | Dispatch `publish-release.md`. |
| Not now | Stop. The draft stays. `status` reports `staged`, and a later run resumes at this stop. |
| Something is wrong | `references/recovery.md`, "Undo a stage". Ask before running it: it deletes a tag on origin. |

## 4. When something fails

`references/recovery.md` lists each failure by phase with the command that recovers it. The usual fix is to remove the cause and run the same task again: every subcommand skips work that is already done.

A build that fails after the release pull request merged is fixed forward with a normal pull request, then built from the new `origin/main` commit with the same version. Nothing is tagged until a DMG passes `verify`.

## 5. Report

When `status` reports `published`, show the person:

1. The release URL.
2. The contents of `dist/release/<version>/release-report.md`. `qa-report.md` sits next to it.
3. Its last section: the one check no script ran, which is theirs to do.

## Rehearsal

To try the build and the checks without credentials, on any checkout:

```sh
node .claude/skills/release/scripts/release.mjs build --version <V> --adhoc
node .claude/skills/release/scripts/release.mjs verify --version <V> --adhoc
```

This writes an ad-hoc-signed DMG to `dist/release/<V>-adhoc/`. It is never part of a release: `stage` refuses it, and `status` reports its presence under `problems`.

## Reference files

| File | Read it when |
| --- | --- |
| `references/setup.md` | Preflight exits 2, or signing or notarization credentials fail |
| `references/recovery.md` | A task fails, `status` lists a problem, or the person wants to undo a step |
| `references/changelog.md` | The person asks where entries come from, how the version is picked, or why `cut` rejected the entries file |
| `assets/` | Templates the scripts fill: release notes, pull request body, report, the QA checklist and report, and the subagent briefs |
