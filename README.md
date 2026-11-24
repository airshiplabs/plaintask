# Plaintask

A task app that keeps your tasks in plain Markdown files, in a folder you pick. Free and open source under the [MIT License](LICENSE).

Plaintask Pro adds sync across devices. Sync is a paid service; the app itself stays free and its code stays here.

## Download

The macOS app is on the [releases page](https://github.com/airshiplabs/plaintask/releases). The app checks this repo's releases for updates.

## What's here

| Path | What |
| --- | --- |
| `apps/desktop` | The desktop app (Tauri 2, macOS first). Build, test and release commands are in its [README](apps/desktop/README.md) |
| `apps/mobile` | The mobile app. Not started |
| `packages/design-system` | Tokens and components the apps draw with |
| `specs` | TLA+ models of the app's state machines, and the tests that compare the code with them |
| `docs/feature-map` | Each user-facing feature, where it lives in the code, and how to drive it in a test |
| `.claude/skills` | Agent skills for releases, changelogs, commit messages, branch names and checking the app |

## Develop

Needs Node 22, pnpm 10, Rust (for the desktop app's native layer), Java 11+ (for `check:specs`) and Google Chrome (for the browser tests).

```bash
pnpm install
pnpm test
pnpm --filter @plaintask/desktop typecheck
pnpm --filter @plaintask/desktop check:rust
pnpm check:specs
```

`pnpm install` installs the repo's git hooks: commit messages must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
