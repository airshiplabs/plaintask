# Composer
The new-task form: title, project, when, tags, then Cancel and Add task.

- Desktop (`card: true`, macOS, Windows, Linux): opens inline at the top of the list, expanding from zero height, with the title focused. `N` opens it, Return or Enter adds, Escape cancels.
- Mobile (`stacked: true`, iOS, Android): the body of a Sheet; project and when share a row, tags take the next.
- Defaults come from the current view: Today sets When to Today, a project sets Project, Someday sets Someday.
- Empty title: keep the form open, show "Give the task a name first.", shake the form (`Plaintask.shake`) and refocus the title.
- If the new task lands outside the current view, show a toast "Added to Upcoming" with a Show action.
- While closed, set `inert` on its container so it stays out of the Tab order.
