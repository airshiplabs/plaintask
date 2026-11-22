---
name: conventional-commits
description: Check a commit message or a pull request title against Conventional Commits 1.0.0. Load this skill before you write a commit message, when a commit-msg hook rejects a commit, or when someone asks if a message or PR title is valid.
---

# Conventional Commits

Run the validator on the message text. Report its exit code and any violations, then stop.

```sh
node .claude/skills/conventional-commits/validate.mjs [--cleanup=whitespace|strip] <message-file | ->
```

- Pass a file path, or `-` to read the message from stdin.
- Pass `--cleanup=strip` only for a raw editor buffer, such as a copy of `COMMIT_EDITMSG`. It drops git's `#` lines and the `commit.verbose` scissors line and diff.
- Use the default, `--cleanup=whitespace`, for final message text and PR titles. It keeps `#` lines as message text, the way git stores a `-m` or `-F` message.
- The validator writes nothing to stdout. It writes violations to stderr.
- Exit 0: the message conforms.
- Exit 1: the message breaks one or more rules. Stderr names each rule, line number, and line text.
- Exit 2: usage error or read error. Fix the command, then run it again.

Write the message to a scratch file, or pipe it, so the shell does not change its text:

```sh
printf '%s\n' 'feat(app): add the checkout banner' | node .claude/skills/conventional-commits/validate.mjs -
```

## Header shape

```text
<type>[(<scope>)][!]: <description>
```

The spec does not fix the list of types. Any type passes when it holds no whitespace, `(`, `!`, or `:`. Types are not case-sensitive, so `FEAT: x` passes.

## Rules

| Rule id | Fails when | Fix |
|---|---|---|
| `message-empty` | The message has no lines after cleanup. | Write a header. |
| `header-type` | The header does not start with a type followed directly by `(`, `!`, or `:`. | Start with a type, such as `feat`, then an optional `(scope)`, an optional `!`, then `: `. |
| `header-scope` | A `(` follows the type, and no `)` closes it, or the scope is empty or holds whitespace or `(`. | Put a non-empty scope with no spaces inside the parentheses, or remove the parentheses. |
| `header-separator` | The character after the type, scope, and `!` is not `:`, or a character other than one space follows the `:`. | Put `: ` (a colon and one space) directly after the type, scope, and `!`. |
| `header-description` | Nothing follows the `:`, or the text after `: ` starts with whitespace. | Write the description directly after `: `. |
| `body-leading-blank` | The message has a second line, and that line is not empty. | Leave one blank line between the header and the body or footers. |
| `footer-breaking-change` | A line after the header starts with `BREAKING CHANGE #` or `BREAKING-CHANGE #`. | Write a breaking change as `BREAKING CHANGE: <description>`. |

Cleanup comes first. With `--cleanup=strip`, the validator drops the scissors line and every line below it, then each line that starts with `#`. In both modes, it then removes trailing whitespace from each line, collapses runs of empty lines to one, and drops empty lines at the start and end.

Footers such as `Refs: 123`, `Refs #123`, `BREAKING CHANGE: drop v1`, and `Co-Authored-By: Name <email>` pass. The validator reports only the two body rules above, so other body and footer text passes.

## Messages that git writes

- `fixup! `, `squash! `, and `amend! ` prefixes are removed, as many times as they repeat. The rest of the header must conform. `fixup! feat: x` passes. `fixup! Add pricing page` fails with `header-type`.
- `Merge …` headers fail with `header-type`. Rebase the branch, so no merge commit forms.
- `Revert "…"` headers fail with `header-type`. Write the revert as a `revert` commit with a `Refs` footer:

```text
revert: add the checkout banner

Refs: 676104e
```
