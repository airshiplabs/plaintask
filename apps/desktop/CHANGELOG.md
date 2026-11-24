# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The app checks for updates daily and installs a new version in place when you choose Update ([#2])
- About Plaintask shows the version and checks for updates ([#2])

## [0.2.1] - 2026-11-23

### Fixed

- The About window shows the build commit again, not the previous release tag ([#100])

## [0.2.0] - 2026-11-23

### Added

- The Dock icon shows the number of open Inbox tasks ([#66])

### Changed

- Adding and ticking tasks in an Inbox of thousands of tasks no longer lags ([#88])

### Fixed

- Inbox.md is read again when the window regains focus after it could not be opened ([#77])
- Task lines inside a code block or an HTML comment no longer show in the Inbox or its count ([#78])
- A double-click on Undo no longer completes the task again ([#79])
- A task folder that was moved or deleted now says it cannot be found instead of showing Inbox zero ([#80])
- Saves keep Finder tags and creation date, and refuse a read-only or hard-linked Inbox.md, saying why ([#81])
- Long task titles wrap in the list, a ticked title is struck on every line, and Undo stays on screen ([#82])
- Ticking three tasks in a row no longer takes away the first task's Undo ([#83])
- Tasks under a first line of --- with no closing --- show, and adding one no longer shows an error ([#84])
- A task ticked while another is being renamed no longer shows as open again ([#85])
- Ticking a task now also shows what another editor changed in the file ([#91])
- Pressing N while a ticked task folds away keeps the keyboard in the new-task field ([#94])
- A save that lands after a failed reread no longer draws the list over the reason ([#93])
- A title being edited closes when a notice replaces the list, so later renames still work ([#93])

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

[Unreleased]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.2.1...HEAD
[0.2.1]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.2.0...desktop-v0.2.1
[0.2.0]: https://github.com/airshiplabs/plaintask/compare/desktop-v0.1.0...desktop-v0.2.0
[0.1.0]: https://github.com/airshiplabs/plaintask/releases/tag/desktop-v0.1.0
[#2]: https://github.com/airshiplabs/plaintask/pull/2
[#30]: https://github.com/airshiplabs/plaintask/pull/30
[#44]: https://github.com/airshiplabs/plaintask/pull/44
[#66]: https://github.com/airshiplabs/plaintask/pull/66
[#77]: https://github.com/airshiplabs/plaintask/pull/77
[#78]: https://github.com/airshiplabs/plaintask/pull/78
[#79]: https://github.com/airshiplabs/plaintask/pull/79
[#80]: https://github.com/airshiplabs/plaintask/pull/80
[#81]: https://github.com/airshiplabs/plaintask/pull/81
[#82]: https://github.com/airshiplabs/plaintask/pull/82
[#83]: https://github.com/airshiplabs/plaintask/pull/83
[#84]: https://github.com/airshiplabs/plaintask/pull/84
[#85]: https://github.com/airshiplabs/plaintask/pull/85
[#88]: https://github.com/airshiplabs/plaintask/pull/88
[#91]: https://github.com/airshiplabs/plaintask/pull/91
[#93]: https://github.com/airshiplabs/plaintask/pull/93
[#94]: https://github.com/airshiplabs/plaintask/pull/94
[#100]: https://github.com/airshiplabs/plaintask/pull/100
