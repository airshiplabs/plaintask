# The task folder format

How Plaintask stores tasks on disk, on every platform. This is format 1. Today the desktop app reads and writes only `Inbox.md`; the rest of this file is the layout the apps grow into, so that new features add files and keys instead of changing the ones already written.

## Rules that hold everywhere

- **The folder is the source of truth.** Everything a person cares about is in plain files in the folder they chose, readable without Plaintask. Anything else the app keeps can be thrown away and rebuilt from the folder.
- **Keep what you don't understand.** The app changes only the characters an edit needs. Lines, keys and files it does not know are carried through unchanged.
- **Paths are relative to the root.** No file in the folder holds an absolute path, so a folder can be moved, synced or opened on a phone.
- **Sync copies files.** Pro sync, iCloud, Dropbox and git all move the same files and merge them line by line. There is no separate operation log and no server-side model of tasks.

## Layout

```
Tasks/                      the root the person picked
  .plaintask/               shared app files (synced)
    format                  the format version: 1
    order                   sidebar order of areas and projects
    ignore                  paths under the root that are not projects
  Inbox.md                  reserved name, root only
  Trash.md                  reserved name, root only
  Work/                     an area
    Q1 launch.md            a project in Work
    Clients/
      Acme.md               a project in Work; Clients/ only groups files
  Errands.md                a project with no area
```

- **Area:** a top-level folder. Its name is the area's name. An empty folder is an empty area.
- **Project:** any `.md` file under the root, except `Inbox.md` and `Trash.md` at the root, files in hidden folders, and paths listed in `.plaintask/ignore`. The project's name is its `title:` front matter, or else its filename without `.md`.
- **Deeper folders** group files only. `Work/Clients/Acme.md` is a project in area Work, and the app shows `Clients/` in its subtitle.
- **Reserved names** are English on every device, whatever language the app shows. A project called `Inbox.md` inside an area is an ordinary project.
- **Filenames** follow the strictest platform: `/ \ : * ? " < > |` become `-`, and the full name goes in `title:`.
- **Conflict copies** from sync tools (`Inbox (conflicted copy 2026-11-23).md`, `Q1 launch 2.md`) are not shown as projects. The app shows them as a warning that offers to merge them.

## A project file

```markdown
---
title: Q1 / Q2 plan
deadline: 2026-12-12
status: active
---
Notes about the project, as body text.

- [ ] First task
## Phase 2
- [ ] Later task
```

- Front matter keys: `title`, `deadline` (ISO date), `status` (`active`, `someday`, `done` or `cancelled`; missing means `active`). Other keys are kept.
- A finished project keeps its place and gets `status: done`. It does not move to an archive folder.
- `##` headings split a project into sections.

## A task line

```markdown
- [ ] Pay rent when:2026-12-01 due:2026-12-03 repeat:monthly #home ^a1b2c3
    - [ ] Check the amount
    Landlord changed bank in November.
```

- A task is `- [ ] ` at the left margin followed by its title.
- **Metadata** is `key:value` words on the line. Dates are ISO (`2026-12-01`). A time is optional and has no time zone: `when:2026-11-24T18:00` is 6pm wherever the person is. Unknown keys are kept.
- **Tags** are `#tag`, shown as written.
- **Indented lines** belong to the task above: an indented `- [ ]` is a checklist item (no dates or id of its own), any other indented line is the task's notes. Moving or deleting a task takes its indented lines with it.
- **Order** is line order. Reordering rewrites lines.

### States

| State | Written as |
| --- | --- |
| Open | `- [ ] Title` |
| Done | `- [x] Title done:2026-11-23` |
| Cancelled | `- [x] Title cancelled:2026-11-23` |
| Deleted | the task's lines move to `Trash.md` with `from:Work/Q1 launch.md` |

Cancelled is ticked so that other editors show it as closed. Restoring a deleted task moves it back to its `from:` file. Emptying Trash removes those lines.

### Ids

- A task gets an id only when the app needs to track it: when it moves between files, repeats, or is edited during a sync conflict. Until then, it is named by its title and the number of tasks with that title above it in the file.
- An id is `^` plus 6 lowercase letters and digits, at the end of the line: `^a1b2c3`. This is the standard Markdown block reference, so other editors can link to the task.
- Ids are unique within the root. If a merge finds two tasks with the same id, the one written later gets a new id.

### Repeating tasks

Ticking `- [ ] Pay rent when:2026-12-01 repeat:monthly ^a1b2c3`:

1. marks that line `- [x] Pay rent when:2026-12-01 done:2026-12-01 ^a1b2c3` and drops its `repeat:`;
2. writes a new open line below it: `- [ ] Pay rent when:2027-01-01 repeat:monthly`.

Only the open copy carries the rule, so editing it edits the series.

## Views

Views are computed from the files. None of them has a file of its own except Inbox.

| View | Shows open tasks that |
| --- | --- |
| Inbox | are in `Inbox.md` |
| Today | have `when:` today or earlier |
| Upcoming | have `when:` after today |
| Someday | have `when:someday` |
| Anytime | are not in Inbox and have no `when:` |
| Completed | are ticked (done or cancelled) |
| Trash | are in `Trash.md` |

## `.plaintask/`

Only files every device shares go here.

- `format`: the format version, an integer. A folder with no `.plaintask/` is format 1.
- `order`: the sidebar order of areas and projects. A missing or stale entry sorts alphabetically.
- `ignore`: paths under the root that are not projects, one per line.

Per-device state (the cache, window state, the folder choice) stays in the app's own data folder, beside `folder.bookmark`. In the folder, it would sync and conflict on every launch.

## Changing the format

- Adding a key or an optional file does not raise the version, because older apps keep what they don't understand.
- Only a change that would make an older app damage the folder raises the version.
- An app that finds a version newer than its own opens the folder read-only and says why.
