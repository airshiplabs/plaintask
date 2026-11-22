# The changelog in a release

The desktop app's changelog is `apps/desktop/CHANGELOG.md`. Its format, its scripts, and the rules for writing an entry belong to the `keep-a-changelog` skill:

| Question | Read |
| --- | --- |
| What may an entry say, which type is it, which reference does it cite | `.claude/skills/keep-a-changelog/SKILL.md`, "Add an entry" |
| What does a rule id in an error mean | `.claude/skills/keep-a-changelog/FORMAT.md`, "Rules" |

This file covers only what a release adds.

## Where entries come from

A pull request adds its own entry under `[Unreleased]` with that skill's `add.mjs`. CI does not require one, so by release time some changes have no entry. The release closes that gap:

1. `release.mjs plan` lists the commits on `apps/desktop` and `packages/design-system` since the last `desktop-v*` tag, and the entries already under `[Unreleased]`.
2. A drafter writes the missing entries to `dist/release/entries.json`.
3. An independent reviewer checks the entries, old and new, against the diffs.
4. `release.mjs cut` adds the new entries, moves `[Unreleased]` into `## [<version>] - <date>`, and writes the version into the four manifests. It uses the `keep-a-changelog` module, so the result always passes that skill's `validate.mjs`.

Nobody edits `apps/desktop/CHANGELOG.md` by hand during a release.

## The entries file

`dist/release/entries.json`: a list of the entries to add. `[]` when `[Unreleased]` is already complete.

```json
[
  { "type": "Added", "ref": "#30", "text": "Inbox list backed by Inbox.md in a folder you choose" },
  { "type": "Fixed", "ref": "#52", "text": "The chosen folder is kept after the app restarts" }
]
```

- `type`: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security`.
- `ref`: `#<pr-number>` of the merged pull request that made the change. `plan` gives it as `pr` on each commit. A commit with no pull request cites its sha, 7 to 40 lowercase hex characters.
- `text`: one line, at most 100 characters, no trailing period, written for a person using the app.

`cut` rejects the file when it is not a list of such objects, when an entry is already under `[Unreleased]`, and when the changelog with the entries added breaks a format rule. The error names the rule.

The file cannot change or remove an entry already under `[Unreleased]`. A wrong existing entry is fixed in a normal pull request before the release.

## The version

The version comes from the entries the release holds, by the `keep-a-changelog` rule:

| The entries include | Bump |
| --- | --- |
| One that starts with `**Breaking:** ` | Major. Minor while the last version is below 1.0.0. |
| An `Added` or `Deprecated` entry | Minor |
| Anything else | Patch |

The first release bumps from `0.0.0`. `release.mjs plan --entries dist/release/entries.json` prints the result as `next`, with `bump` and `reason`. The person can choose another version at the first approval stop; it must be above the last release.

## The tag

Version `0.1.0` of the desktop app is the git tag `desktop-v0.1.0`. The changelog's link block points at that tag, so `stage` creates exactly that name.

## When `check` fails

`release.mjs check --version <V>` fails when a manifest does not record `<V>`, when the changelog breaks a format rule, or when it has no `[<V>]` release. A format failure in a file `cut` wrote means the file was edited afterwards. Restore it with `git checkout -- apps/desktop/CHANGELOG.md` and cut again.
