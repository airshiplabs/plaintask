# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The Dock icon shows the number of open Inbox tasks ([#66])

### Fixed

- Inbox.md is read again when the window regains focus after it could not be opened ([#77])
- Task lines inside a code block or an HTML comment no longer show in the Inbox or its count ([#78])
- A double-click on Undo no longer completes the task again ([#79])

## [0.1.0] - 2026-11-22

### Added

- Inbox list backed by Inbox.md in a folder you choose, remembered across launches ([#30])
- Add a task with N or the New task button; it lands as the last line of Inbox.md ([#30])
- Tick a task with a click or Space, with Undo in a toast for 5 seconds ([#30])
- Rename a task in place with Return on its row or a double-click on its title ([#30])
- Move between tasks with j and k or the arrow keys ([#30])
- The list rereads Inbox.md when the window regains focus ([#30])
- Light and dark themes that follow the macOS appearance ([#30])
- The About window shows the build's git commit as its build number ([#44])

[Unreleased]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.1.0...HEAD
[0.1.0]: https://github.com/airshiplabs/plaintask/releases/tag/desktop-v0.1.0
[#30]: https://github.com/airshiplabs/plaintask/pull/30
[#44]: https://github.com/airshiplabs/plaintask/pull/44
[#66]: https://github.com/airshiplabs/plaintask/pull/66
[#77]: https://github.com/airshiplabs/plaintask/pull/77
[#78]: https://github.com/airshiplabs/plaintask/pull/78
[#79]: https://github.com/airshiplabs/plaintask/pull/79
