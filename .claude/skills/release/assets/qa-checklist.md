# Release QA checklist

The flows a person uses on most days, and the file rules they rely on. Each row names the sub-features it proves; the recipe for each one is in its file under `docs/feature-map/`. Run the rows in order. Do not add rows for edge cases: `pnpm test` and exploratory QA cover those.

Tier `page` is `control-desktop` from the `verify-desktop` skill, on the baseline file. Tier `window` is the test-identifier build from the `checking-desktop-app` skill.

| # | Flow | Feature file | Sub-features | Tier |
| --- | --- | --- | --- | --- |
| 1 | First launch asks for a folder; the pick shows its Inbox; the next launch opens it with no panel | `choose-task-folder.md` | `folder-ask`, `folder-pick`, `folder-remembered` | window |
| 2 | The list shows the open tasks in file order, with the sidebar count | `view-inbox.md` | `inbox-list`, `inbox-done-hidden`, `inbox-not-tasks`, `inbox-sidebar-count` | page |
| 3 | The Dock badge matches the sidebar count | `view-inbox.md` | `inbox-dock-badge` | window |
| 4 | Add a task by key and by button | `add-task.md` | `add-open-key`, `add-open-button`, `add-save`, `add-keeps-other-lines` | page |
| 5 | A blank title is refused; Escape adds nothing | `add-task.md` | `add-blank-title`, `add-cancel-escape` | page |
| 6 | Tick a task by click and by Space; the file changes by one character | `complete-task.md` | `complete-click`, `complete-space`, `complete-one-character` | page |
| 7 | Undo puts the task back byte for byte | `complete-task.md` | `undo-restore` | page |
| 8 | Ticking the last task shows `Inbox zero` | `complete-task.md` | `complete-last-task` | page |
| 9 | Rename by Return; Escape cancels | `rename-task.md` | `rename-open-return`, `rename-save-return`, `rename-cancel-escape` | page |
| 10 | `j` and `k` move between rows | `keyboard-navigation.md` | `nav-first-row`, `nav-down`, `nav-up` | page |
| 11 | Another editor changes the file; the window regains focus and shows it | `view-inbox.md` | `inbox-reread-on-focus` | page |
| 12 | Add, tick and rename in the built app save to the sandboxed folder | `add-task.md`, `complete-task.md`, `rename-task.md` | `add-save`, `complete-click`, `rename-save-return` | window |

Rows 1, 3 and 12 need one full-screen control grant from the person. A run takes about 30 minutes: 10 on the page tier, 20 for the window build and its rows.
