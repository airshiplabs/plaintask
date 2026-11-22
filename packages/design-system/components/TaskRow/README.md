# TaskRow
One task: checkbox, title, a meta line (project · repeat · tags) and the dates on the right.

- Provide a task object with display-ready text: `{ id, title, project, tags, repeat, when, due, dueSoon, done, doneLabel }`. `due` reads "Due Fri"; set `dueSoon` for two days or less and it turns `warn`.
- Hide the project (`showProject: false`) inside a project view; show `when` (`showWhen: true`) where dates are mixed (a project, search results).
- Render rows inside a `ul`. Completing: `Plaintask.complete(row, commit)` ticks, strikes the title (a line drawn left to right), holds 620ms, collapses the row, then calls `commit` to update your data. Always pair it with an Undo toast.
- A new row runs `Plaintask.enter(row)`: it drops 8px into place on an `accent-soft` flash.
- `trashButton: true` adds a "Move to Trash" icon button that shows on hover or focus (always on touch screens). Run `Plaintask.trash(row, commit)`: the row folds away at once, with no tick. Pair it with "Moved to Trash: <title>" and Undo. Delete or Backspace on a focused row does the same.
- In Trash, pass `trashed: true`: the checkbox gives way to an empty slot so titles stay aligned, and the row shows Restore. The day it was deleted goes in a GroupHeader ("Deleted yesterday"), not on the row.
- Hover and keyboard focus tint the row `accent-soft`. `j`/`k` or arrow keys move between rows; Space completes.
