# Changelog format

The exact format of every `CHANGELOG.md` in this repo. It is a strict subset of [Keep a Changelog 2.0.0](https://keepachangelog.com/en/2.0.0/): each file that passes these rules follows Keep a Changelog, and each file has one valid spelling. `validate.mjs` enforces every rule below. `add.mjs` and `release.mjs` write only files that pass.

## Files

`CHANGELOGS` in `changelog.mjs` lists every changelog. One per shipped component:

| Path | Tag prefix |
|---|---|
| `apps/desktop/CHANGELOG.md` | `desktop-v` |
| `apps/mobile/CHANGELOG.md` | `mobile-v` |

- The tag prefix is the directory's last segment plus `-v`. Version `0.1.0` of the desktop app is the git tag `desktop-v0.1.0`.
- `packages/*` have no changelog. They are internal, and the apps' changelogs describe their user-facing effects.
- To add a changelog, add its path to `CHANGELOGS` and to this table, then create the file from the empty template below, with that component's directory in the `[Unreleased]` link.
- Every listed file must exist. CI fails when one is missing.

## Template

An empty changelog, with no release yet:

```markdown
# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

[Unreleased]: https://github.com/airshiplabs/plaintask/commits/HEAD/apps/desktop
```

A changelog with releases:

```markdown
# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Sync no longer drops tasks edited offline ([#41])

## [0.2.0] - 2026-11-22

The first release with sync.

### Added

- Sync tasks between devices ([#38])

### Changed

- **Breaking:** Settings move to the new settings window ([887e173])

## [0.1.0] - 2026-10-01 [YANKED]

### Added

- Menu bar quick-add window ([#30])

[Unreleased]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.2.0...HEAD
[0.2.0]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.1.0...desktop-v0.2.0
[0.1.0]: https://github.com/airshiplabs/plaintask/releases/tag/desktop-v0.1.0
[#30]: https://github.com/airshiplabs/plaintask/pull/30
[#38]: https://github.com/airshiplabs/plaintask/pull/38
[#41]: https://github.com/airshiplabs/plaintask/pull/41
[887e173]: https://github.com/airshiplabs/plaintask/commit/887e173
```

## Grammar

A file is a sequence of blocks separated by exactly one empty line, ending in one newline:

```text
file      = header release* links
header    = "# Changelog" / preamble (the six lines of the template, verbatim)
release   = heading summary? section*
heading   = "## [Unreleased]"
          | "## [" semver "] - " date [" [YANKED]"]
summary   = one paragraph of plain text lines
section   = "### " type / entry+          (entries on consecutive lines)
type      = Added | Changed | Deprecated | Removed | Fixed | Security
entry     = "- " text " ([" ref "])"
ref       = "#" pr-number | commit-sha     (pr-number: no leading 0; sha: 7-40 lowercase hex)
links     = link+                          (consecutive lines)
link      = "[" label "]: " url
```

- `semver` is a [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html) version. `date` is `YYYY-MM-DD` and a real calendar date.
- `text` is one line of at most **100 characters**, counted as Unicode code points. It starts and ends with a non-space character. The ` ([ref])` suffix does not count.

## Rules

| Rule id | Fails when | Fix |
|---|---|---|
| `title` | Line 1 is not `# Changelog`. | Start the file with the template header. |
| `preamble` | The lines between the title and the first `##` heading are not the template preamble. | Copy the preamble from the template. |
| `unreleased` | The first release is not `## [Unreleased]`, or `## [Unreleased]` appears twice or below a version. | Keep one `## [Unreleased]`, first. It may be empty. |
| `version-heading` | A `##` heading is not `## [<semver>] - <YYYY-MM-DD>`, optionally followed by ` [YANKED]`. | Fix the version or the date. |
| `version-unique` | Two releases have the same version. | Remove the duplicate. |
| `version-order` | A version is not lower than the one above it, or its date is later. | Order releases newest first. |
| `version-empty` | A released version has no entry. | Add an entry. Every release lists at least one change. |
| `heading-level` | A heading is not `#` (line 1), `##`, or `###`. | Use a `##` release or a `###` type heading. |
| `section-name` | A `###` heading is not one of the six types. | Use `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security`. |
| `section-unique` | A release has the same type twice. | Merge the two sections. |
| `section-order` | A release lists types out of the order above. | Reorder the sections. |
| `section-empty` | A `###` section has no entry. | Add an entry or remove the heading. |
| `summary` | Text that is not an entry sits after a `###` heading of a release. | Put a release summary between its `##` heading and its first `###` heading. |
| `entry` | A list line is not `- <text> ([<ref>])`, is nested, uses `*` or `+`, or sits outside a `###` section. | Write one line, ending in one reference such as `([#34])` or `([887e173])`. |
| `entry-length` | The entry text is longer than 100 characters. | State the change at a higher level. Link details from the PR. |
| `breaking` | `**Breaking:**` sits under a type other than `Changed` or `Removed`, or is not the exact prefix `**Breaking:** `. | Start the entry with `**Breaking:** ` under `Changed` or `Removed`. |
| `cve` | An entry that starts with `CVE-` is not `CVE-YYYY-NNNN: …`, or sits outside `Security`. | Lead with the CVE id and a colon, under `Security`. |
| `links` | The link block is not the exact list the releases and entries imply (see below). | Use the expected line the error names. |
| `whitespace` | The file has `\r`, a tab, trailing spaces, a line of only spaces, more or fewer than one empty line between blocks, or no single final newline. | Match the template spacing. |

## Link block

The link block is computed from the file, so each file has one valid block. In order:

1. `[Unreleased]`: `<repo>/compare/<tag of newest version>...HEAD`. With no release, `<repo>/commits/HEAD/<component directory>`.
2. One line per version, newest first: `<repo>/compare/<tag of the version below>...<tag>`. The oldest version: `<repo>/releases/tag/<tag>`.
3. One line per PR reference, ascending by number: `[#N]: <repo>/pull/N`.
4. One line per commit reference, ascending by sha: `[sha]: <repo>/commit/sha`.

`<repo>` is `https://github.com/airshiplabs/plaintask`. A reference used by several entries has one link line. A link line with no matching reference fails `links`.

## Choices this format makes

Keep a Changelog leaves these open. This repo fixes them:

- SemVer for every component, and the preamble always names SemVer.
- Exactly one reference per entry, as a reference-style link. Keep a Changelog prefers reference links over bare `(#123)`.
- Prefer a PR number. A squash merge gives the change a new sha, so a branch sha in a changelog points at a commit that `main` does not contain.
- `[YANKED]` stays on a release heading; the release keeps its entries.
- CI checks the format of each listed file. It never requires a changelog edit in a pull request: Keep a Changelog says not to make one a required check.
