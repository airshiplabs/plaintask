# Task: draft the missing changelog entries

Find the changes in this release that `apps/desktop/CHANGELOG.md` does not yet list, and write an entry for each to the entries file. You decide which commits a person using the app would notice and how to word them. You do not edit the changelog, commit, or push.

## Inputs

- `findings` (optional): a reviewer's findings on an earlier draft. Resolve each one.
- `notes` (optional): the person's own instructions for this draft. They outrank your judgment.

## Steps

Run every command from the repo root.

1. Run `node .claude/skills/release/scripts/release.mjs plan`. Its stdout lists `commits`, the commits since the last release that touch the desktop app, and `unreleased`, the entries already under `[Unreleased]`. Exit 1 with "nothing to release": stop and return `blocked`.
2. Read `.claude/skills/release/references/changelog.md` in full, then the "Add an entry" section of `.claude/skills/keep-a-changelog/SKILL.md`. That section's rules for what is notable, which type, and how to word the text are the rules here.
3. For each commit, read what it changed: `git show --stat <sha>`, then the diff of the files under `apps/desktop` and `packages/design-system`. When the subject is unclear and `pr` is set, read `gh pr view <pr> --json title,body`. `apps/desktop/README.md` says what the app does and what is not built.
4. Decide, per commit: an entry in `unreleased` already covers it; it needs a new entry; or it is omitted, with a one-line reason. One commit with two visible changes gets two entries, each citing that commit's pull request.
5. Write `dist/release/entries.json`: the list of new entries, in the shape the references file gives. Write `[]` when `[Unreleased]` already covers every notable change. With `findings` or `notes`, start from the existing file.
6. Run `node .claude/skills/release/scripts/release.mjs plan --entries dist/release/entries.json`. Its `next`, `bump`, and `reason` are the version the entries call for. `next: null` means the release would hold no entry: return `blocked` and say that no commit is notable.
7. Run `node .claude/skills/release/scripts/release.mjs cut --version <next> --entries dist/release/entries.json --dry-run`. Exit 1: the message names the rule; fix the entry and run it again. Exit 0: its stdout holds the release as it will be published.

## Do not

- Do not run `cut` without `--dry-run`, and do not run the `keep-a-changelog` scripts `add.mjs` or `release.mjs`. `release.mjs pr` writes the changelog on the release branch.
- Do not run `pr`, `build`, `stage`, or `publish`.
- Do not write an entry for something the diff does not show the shipped app doing.
- Do not repeat an entry that is already in `unreleased`.
- Do not drop a `feat` or `fix` commit without a reason in `omitted`.

## Return

End your reply with exactly this block and nothing after it:

```text
RESULT: ok | failed | blocked
PHASE: draft-changelog
FACTS: {"version": "<next>", "bump": "<bump>", "reason": "<reason>", "entriesFile": "dist/release/entries.json", "section": "<the section from step 7>", "omitted": [{"sha": "<sha>", "subject": "<subject>", "why": "<one line>"}]}
NOTES: <at most 5 lines: anything the person should decide, or the stderr of a failed command>
```
