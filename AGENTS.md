# Agent rules

* Commit messages MUST follow conventional commits 1.0.0
* PR bodies MUST end with the agent session footer: run the `pr-session-footer` skill (`.claude/skills/pr-session-footer/SKILL.md`)
* Before you build, measure or test the desktop app, read `apps/desktop/README.md`: it holds the sandbox entitlements, the build and measure commands, and what a check in the real window needs
* Every unchecked `- [ ]` box in a PR body fails the `task-list-completed` check and blocks merging. Put a box only on a step that will be done before merge; write a known miss or a deferred item as a plain bullet
* Update a PR branch with `git rebase` onto `origin/main`, then `git push --force-with-lease`. Never merge `main` into it: a merge commit fails the `Commit messages` job
* Branch names MUST be `<type>--<description>` with no `/`: run the `branch-naming` skill (`.claude/skills/branch-naming/SKILL.md`) before you create or rename a branch
* To boot and drive the desktop app from scripts, load the `verify-desktop` skill (`.claude/skills/verify-desktop/SKILL.md`). `docs/feature-map/README.md` lists each user-facing feature with its entry points and a proven drive recipe; when you add, remove or change one, update its file there
* Every PR that changes the UI MUST show the change: screenshots, a subtitled `demo.mp4`, or both. Run the `pr-ui-evidence` skill (`.claude/skills/pr-ui-evidence/SKILL.md`)
