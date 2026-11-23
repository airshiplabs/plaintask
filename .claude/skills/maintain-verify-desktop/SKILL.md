---
name: maintain-verify-desktop
description: Audit the verify-desktop skill and the desktop feature map (docs/feature-map) against the app as it is now - read the source for each feature, drive every feature once, and ship at most one PR of proven corrections. Load this skill when asked to audit, refresh or maintain the verification skill or the feature map, or after a change to apps/desktop that adds, removes or changes user-facing behaviour.
---

# Maintaining verify-desktop and the feature map

The feature map describes the app on the day it was written. This pass compares it with the app today. The unit of work is the feature file: read each one against the source and drive each one once.

## Outcomes

End with exactly one, and say which:

- **clean**: every feature file was read against the source and driven. Nothing to change. No branch, no PR.
- **changed**: one PR holds the corrections, and each correction was driven before it went in.
- **blocked**: a feature could not be covered, or a correction could not be proven. Say what stopped it.

## What this pass may edit

- `.claude/skills/verify-desktop/` (SKILL.md and scripts)
- `docs/feature-map/`

Nothing under `apps/`, `packages/` or `tests/`. When the map describes behaviour the app no longer has, decide which is wrong. A wrong map is fixed here. A wrong app is reported to the person and left out of the PR.

## Pass

1. **Index.** Read `docs/feature-map/README.md` and list the files beside it. Fix entries that are missing, extra, duplicated or dead.

2. **Source wave.** Start one read-only subagent per feature file, all at once. Each reads the feature file, then `apps/desktop/src/`, `apps/desktop/src-tauri/src/` and `tests/desktop-app.test.mjs`, and returns four things: a summary of how the feature works, the source entry points, each statement in the feature file that the source contradicts (with `file:line`), and one recipe to check it live. These subagents do not launch the app and do not edit files.

3. **Reconcile.** Check each cited contradiction against the source yourself. Then look for user-facing behaviour with no feature file: read `git log --since=<date of the last pass> -- apps/desktop` and `apps/desktop/CHANGELOG.md`. Name a source path before calling a feature missing.

4. **Live pass.** Required even when step 2 found nothing. You do all the driving, following `verify-desktop`: launch, doctor, then every feature file's recipe at least once. Three rules hold for the whole pass:
   - Run doctor before the first drive and again after any drive that fails. When doctor passes but the page is in a state the recipe does not expect, clean up and launch again.
   - After every cleanup, list `.verify/<run>/evidence/` and confirm the evidence is there.
   - Clean up every run you launched, including runs that failed.

   A feature that cannot be reached is recorded as `unreachable` with the missing prerequisite and the command that was tried. When the feature file does not name that prerequisite, add it.

   The page tier does not cover the real window. For a feature file whose claims need the real window (folder panel, bookmark, window drag, Dock icon), follow `checking-desktop-app`, or record the claim as not checked in this pass.

5. **Triage.**
   - The feature file describes the user's path or result wrongly: fix the file.
   - The app behaves as described but `control-desktop` cannot drive it: fix the helper, document the new invocation in `verify-desktop/SKILL.md`, and drive the fix once.
   - The app is broken: report it to the person. Do not change the map to match.

6. **Ship or stop.** For **changed**: reread every changed file, run `pnpm test`, then open one PR. For **clean** or **blocked**: no PR.

Report: the outcome, each feature file with `driven` / `unreachable` / `not checked (real window)`, each correction made, and each product bug found.
