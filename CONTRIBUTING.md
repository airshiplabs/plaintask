# Contributing

Pull requests from anyone are welcome. There is no CLA and no DCO sign-off: by opening a pull request you agree your change is released under this repo's [MIT License](LICENSE).

## Before you open a pull request

1. Open an issue first for a large change, so we can agree on the approach.
2. Name the branch `<type>--<description>`, such as `fix--toast-timing` (no `/`).
3. Write each commit message, and the PR title, in [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The `commit-msg` hook and the `Commit messages` check enforce it.
4. Run `pnpm test` and `pnpm --filter @plaintask/desktop typecheck`. Run `pnpm --filter @plaintask/desktop check:rust` if you touched `apps/desktop/src-tauri`.
5. For a user-facing change, add a line to `apps/desktop/CHANGELOG.md` under `[Unreleased]` (format in `.claude/skills/keep-a-changelog/FORMAT.md`).

## Review

- Keep history linear: update your branch with `git rebase origin/main`, not a merge.
- Every `- [ ]` box in the PR body must be checked before merge, so list only steps you will finish.
- A maintainer reviews and merges. CI runs on every pull request.
