---
name: branch-naming
description: Name a git branch in this repo as <type>--<description>, such as feat--checkout-banner, never with "/". Load this skill before you run git branch, git switch -c, git checkout -b, git worktree add -b or gh pr create, before you rename a branch, or when someone asks if a branch name is valid.
---

# Branch naming

```text
<type>--<description>
```

- `feat--checkout-banner`
- `fix--issue-37-duplicate-version`
- `docs--desktop-readme-build-steps`

Check a name before you create the branch. Report the exit code and any violations, then stop:

```sh
node .claude/skills/branch-naming/validate.mjs <branch-name>
```

- Exit 0: the name conforms. No output.
- Exit 1: the name breaks one or more rules. Stderr names each rule.
- Exit 2: usage error. Pass exactly one name.

## Why no "/"

Git stores each branch as a file under `.git/refs/heads/`, so `feat/x` becomes a directory `feat` holding a file `x`. Then:

- A branch `feat` and a branch `feat/x` cannot both exist: one needs `feat` as a file, the other as a directory.
- Tools that build a path or a file name from the branch name, such as worktree folders, build output folders and artifact names, get a nested path or a broken one.

`--` keeps the name one path segment.

## Types

The types are the Conventional Commits types in `TYPES` (`.claude/skills/conventional-commits/conventional-commits.mjs`), so a branch and its commits use one list: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `test`.

Pick the type of the PR's main commit. A branch whose PR is `fix(desktop): …` is `fix--…`.

## Rules

| Rule id | Fails when | Fix |
|---|---|---|
| `branch-empty` | The name is empty. | Write a name. |
| `branch-slash` | The name contains `/`. | Replace `/` with `--` after the type, or `-` inside the description. |
| `branch-separator` | The name has no `--`. | Put `--` between the type and the description. |
| `branch-type-enum` | The text before the first `--` is not in `TYPES`. Case counts. | Use one of the types above. |
| `branch-description` | The text after the first `--` is not lowercase `a-z` and `0-9` words joined by single `-`. | Use lowercase kebab case, no `_`, no `--`, no leading or trailing `-`. |

## Branches made by a harness

A harness that names branches itself, such as `claude/repo-icon-update-1a7b59` for a worktree, breaks `branch-slash`. Rename the branch before you push it:

```sh
git branch -m feat--repo-icon-update
```

`main` and other long-lived branches are not topic branches. Do not check or rename them.
