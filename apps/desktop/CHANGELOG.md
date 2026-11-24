# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-11-24

### Added

- The app checks for updates daily and installs a new version in place when you choose Update ([#2])
- About Plaintask shows the version and checks for updates ([#2])

## [0.2.1] - 2026-11-23

### Fixed

- The About window shows the build commit again, not the previous release tag ([df84b28])

## [0.2.0] - 2026-11-23

### Added

- The Dock icon shows the number of open Inbox tasks ([10274cb])

### Changed

- Adding and ticking tasks in an Inbox of thousands of tasks no longer lags ([928beac])

### Fixed

- Inbox.md is read again when the window regains focus after it could not be opened ([e21ed95])
- Task lines inside a code block or an HTML comment no longer show in the Inbox or its count ([2e5a5b0])
- A double-click on Undo no longer completes the task again ([fac2086])
- A task folder that was moved or deleted now says it cannot be found instead of showing Inbox zero ([437eed7])
- Saves keep Finder tags and creation date, and refuse a read-only or hard-linked Inbox.md, saying why ([c12ac3e])
- Long task titles wrap in the list, a ticked title is struck on every line, and Undo stays on screen ([d930459])
- Ticking three tasks in a row no longer takes away the first task's Undo ([06546ee])
- Tasks under a first line of --- with no closing --- show, and adding one no longer shows an error ([f6f5fb3])
- A task ticked while another is being renamed no longer shows as open again ([f821732])
- Ticking a task now also shows what another editor changed in the file ([85f97e9])
- Pressing N while a ticked task folds away keeps the keyboard in the new-task field ([e956d2f])
- A save that lands after a failed reread no longer draws the list over the reason ([0518c85])
- A title being edited closes when a notice replaces the list, so later renames still work ([0518c85])

## [0.1.0] - 2026-11-22

### Added

- Inbox list backed by Inbox.md in a folder you choose, remembered across launches ([a7f6353])
- Add a task with N or the New task button; it lands as the last line of Inbox.md ([a7f6353])
- Tick a task with a click or Space, with Undo in a toast for 5 seconds ([a7f6353])
- Rename a task in place with Return on its row or a double-click on its title ([a7f6353])
- Move between tasks with j and k or the arrow keys ([a7f6353])
- The list rereads Inbox.md when the window regains focus ([a7f6353])
- Light and dark themes that follow the macOS appearance ([a7f6353])
- The About window shows the build's git commit as its build number ([6c9119d])

[Unreleased]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.3.0...HEAD
[0.3.0]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.2.1-moved...desktop-v0.3.0
[0.2.1]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.2.0-moved...desktop-v0.2.1-moved
[0.2.0]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.1.0-moved...desktop-v0.2.0-moved
[0.1.0]: https://github.com/airshiplabs/plaintask/releases/tag/desktop-v0.1.0-moved
[#2]: https://github.com/airshiplabs/plaintask/pull/2
[0518c85]: https://github.com/airshiplabs/plaintask/commit/0518c85
[06546ee]: https://github.com/airshiplabs/plaintask/commit/06546ee
[10274cb]: https://github.com/airshiplabs/plaintask/commit/10274cb
[2e5a5b0]: https://github.com/airshiplabs/plaintask/commit/2e5a5b0
[437eed7]: https://github.com/airshiplabs/plaintask/commit/437eed7
[6c9119d]: https://github.com/airshiplabs/plaintask/commit/6c9119d
[85f97e9]: https://github.com/airshiplabs/plaintask/commit/85f97e9
[928beac]: https://github.com/airshiplabs/plaintask/commit/928beac
[a7f6353]: https://github.com/airshiplabs/plaintask/commit/a7f6353
[c12ac3e]: https://github.com/airshiplabs/plaintask/commit/c12ac3e
[d930459]: https://github.com/airshiplabs/plaintask/commit/d930459
[df84b28]: https://github.com/airshiplabs/plaintask/commit/df84b28
[e21ed95]: https://github.com/airshiplabs/plaintask/commit/e21ed95
[e956d2f]: https://github.com/airshiplabs/plaintask/commit/e956d2f
[f6f5fb3]: https://github.com/airshiplabs/plaintask/commit/f6f5fb3
[f821732]: https://github.com/airshiplabs/plaintask/commit/f821732
[fac2086]: https://github.com/airshiplabs/plaintask/commit/fac2086
