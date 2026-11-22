Release Plaintask {{version}} for macOS.

## Changelog

{{changelogSection}}

## Changes

- `{{changelog}}`: `[Unreleased]` becomes `[{{version}}]`, and the link block is rewritten.
- `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/Cargo.lock`: version `{{version}}`.

`release.mjs check --version {{version}}` passed on this branch before the commit.

## After merge

The `release` skill builds `{{dmgName}}` from the merge commit, signs and notarizes it, tags the commit `{{tag}}`, and publishes the GitHub release. Nothing is tagged before the DMG passes verification.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
