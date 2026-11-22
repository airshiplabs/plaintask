---
name: keep-a-changelog
description: Add an entry to, release, or check a CHANGELOG.md in this repo, in the strict Keep a Changelog 2.0.0 format that FORMAT.md defines. Load this skill before you edit any CHANGELOG.md, when a change is user-facing and ready for a PR, when you cut a release, or when the pre-commit hook or CI rejects a changelog.
---

# Keep a Changelog

`FORMAT.md` is the exact format. The scripts do every mechanical step: placing entries, ordering sections, writing link definitions, dating releases. Never hand-edit a changelog's structure or link block. Your job is the judgment below.

## Scripts

Run from the repo root. Each script writes nothing to stdout and reports violations on stderr. Exit 0: done. Exit 1: violations; the file is unchanged. Exit 2: usage or read error.

```sh
node .claude/skills/keep-a-changelog/add.mjs <changelog> <type> <#pr|sha> <text>
node .claude/skills/keep-a-changelog/release.mjs <changelog> <version> [--date=YYYY-MM-DD]
node .claude/skills/keep-a-changelog/validate.mjs [<changelog>...]
```

- `validate.mjs` with no argument checks every path in `CHANGELOGS` (`changelog.mjs`). CI runs that. The pre-commit hook checks each staged `CHANGELOG.md`.
- `add.mjs` and `release.mjs` refuse a file that already fails, and refuse to write a result that would fail. Fix the reported rule and run the script again.

## Add an entry

1. **Decide if the change is notable.** A user of that component would notice it, or must act on it. Skip refactors, tests, CI, docs-only changes, and dependency bumps with no user-facing effect. Always record deprecations, removals, breaking changes, and security fixes.
2. **Pick the changelog.** One per component that the user sees change, from the `CHANGELOGS` list. A change that ships in two components gets an entry in each. `packages/*` changes go in the changelog of the app or site whose behavior changed.
3. **Pick the type.** Ask: was the old behavior a bug?
   - Yes, and it is a vulnerability: `Security`. Lead with the CVE id when one exists: `CVE-2026-1234: …`.
   - Yes: `Fixed`.
   - No, it was intended and now works differently: `Changed`.
   - New capability: `Added`. Still works but will go: `Deprecated`, naming the version that removes it. Gone: `Removed`.
   - Breaking: prefix `**Breaking:** ` under `Changed` or `Removed`, and say what breaks.
4. **Write the text.** At most 100 characters. One line, high-level, for a user, plain words. Say what changed for them, not how the code changed. No trailing period. Link details from the PR instead of writing them here.
5. **Pick the reference.** Use the PR number, `#34`, once the PR exists. A squash merge gives the change a new sha on `main`, so cite a sha only for a commit already on `main`.
6. **Run `add.mjs`**, then commit the changelog with the change.

```sh
node .claude/skills/keep-a-changelog/add.mjs apps/desktop/CHANGELOG.md Fixed '#41' 'Sync no longer drops tasks edited offline'
```

## Release

1. **Pick the version** from the `[Unreleased]` entries, by SemVer: any `**Breaking:**` → major (minor while below 1.0.0); any `Added` or `Deprecated` → minor; else patch.
2. **Run `release.mjs`.** It moves `[Unreleased]` into `## [<version>] - <today>` and rewrites the compare links for tag `<component>-v<version>`.
3. Tag the release commit with that tag, signed: `git tag -s desktop-v0.2.0`.

## When a check fails

Read the rule id in the report, then the rule's row in `FORMAT.md`, and fix that line. For `links` and `whitespace`, run `add.mjs` or `release.mjs` on a valid file instead of editing by hand; for an already-broken file, fix the named line to the expected text in the report.

To add a changelog for a new component, add its path to `CHANGELOGS` and to the `FORMAT.md` table, then create the file from the empty template in `FORMAT.md`.
