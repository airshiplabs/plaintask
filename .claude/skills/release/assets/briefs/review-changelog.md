# Task: review the changelog entries of a release

Judge the entries a release will publish against the commits they describe. You were given no account of how they were drafted, on purpose: check them against the code, not against anyone's reasoning. You report findings. You change no file.

## Inputs

- `version`: the version being released.
- `entriesFile`: the entries the release adds, `dist/release/entries.json`.

## Steps

Run every command from the repo root.

1. Run `node .claude/skills/release/scripts/release.mjs plan --version <version> --entries <entriesFile>`. Its stdout lists the `commits` in this release, the entries already `unreleased` in `apps/desktop/CHANGELOG.md`, the `additions` from the entries file, and the version those entries call for.
2. Read `.claude/skills/release/references/changelog.md` in full, then the "Add an entry" section of `.claude/skills/keep-a-changelog/SKILL.md`.
3. Run `node .claude/skills/release/scripts/release.mjs cut --version <version> --entries <entriesFile> --dry-run`. Exit 1 is a finding: quote the message. Exit 0: its stdout holds the release as it will be published.
4. For each entry in that release, existing or added, read the diff of the pull request or commit it cites (`git show <sha> -- apps/desktop packages/design-system`; `plan` maps a pull request number to its commit). Ask:
   - Is it true? Does the diff show the shipped app doing exactly this? `apps/desktop/README.md` lists what is not built.
   - Does the reference point at the change that made it?
   - Would a person using the app understand it without knowing the code?
   - Is it under the right type, by the "Pick the type" questions?
5. For each commit in `plan` that no entry covers, read its diff. Ask: would a person using the app notice this change? If yes, the omission is a finding.
6. Check the version against the table in the references file. A breaking change with no `**Breaking:** ` prefix is a finding, because it also makes the version too low.

## Verdict

- `APPROVE`: no finding.
- `CHANGES`: one or more findings. A finding names the entry or commit, the problem, and the fix. Report only what would mislead a reader or break a rule. Do not report wording you would merely have chosen differently.

A finding about an entry already under `[Unreleased]` says so: the entries file cannot change it, and the person decides.

## Do not

- Do not edit `entriesFile`, the changelog, or any other file.
- Do not run `cut` without `--dry-run`, and do not run `pr`, `build`, `stage`, or `publish`.

## Return

End your reply with exactly this block and nothing after it:

```text
RESULT: ok | failed | blocked
PHASE: review-changelog
FACTS: {"verdict": "APPROVE | CHANGES", "findings": [{"about": "<the entry text, or a commit sha>", "problem": "<one line>", "fix": "<one line>"}]}
NOTES: <at most 5 lines>
```

`RESULT` is `ok` when you reached a verdict, whichever it is.
