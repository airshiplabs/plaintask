# Plaintask task folder format, version 1

This is the specification of how Plaintask stores tasks on disk. Every Plaintask app on every platform reads and writes this format. Today the desktop app implements only `Inbox.md` (section 6) with open and done tasks; the rest is the format the apps grow into.

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. A **reader** is any app that reads the folder. A **writer** is any app that changes it.

## 1. Principles

1. The folder is the only source of truth. Everything a person cares about is in plain files in the folder, readable without Plaintask. Anything else an app keeps MUST be rebuildable from the folder.
2. A writer MUST keep every byte it does not mean to change: lines, keys, tokens and files it does not understand stay exactly as they are.
3. No file in the folder holds an absolute path. Every path is relative to the root.
4. Sync copies files. Pro sync, iCloud, Dropbox and git all move the same files. There is no operation log and no server-side model of tasks.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Root | The folder the person picked. |
| Path | A file or folder's location relative to the root, segments joined by `/`, with no leading `/`. Example: `Work/Q1 launch.md`. |
| Hidden | A file or folder whose name starts with `.`. |
| Area | A folder directly in the root that is not hidden. |
| Project | A project file (section 4). |
| List | Inbox or a project: a file whose tasks the app shows. |

## 3. Text encoding

Every file this format defines:

- MUST be UTF-8. A reader MUST refuse to change a file that is not valid UTF-8, and SHOULD say so.
- MAY start with a byte order mark. A writer MUST keep it.
- MAY end lines with LF or CRLF, mixed. A writer MUST keep each line's ending, and MUST end a line it adds with the first line ending the file already uses (LF in a file that has none).
- MAY lack a final line ending. A writer that appends a line MUST first end the last line.

A writer MUST replace a file in one step (write a temporary file beside it, then rename it over the old one), so that another program never sees half a file.

## 4. Folder layout

```
Tasks/                      root
  .plaintask/               app files every device shares (section 9)
    format
    order
    ignore
  Inbox.md                  Inbox (section 6)
  Trash.md                  Trash (section 7)
  Work/                     area "Work"
    Q1 launch.md            project in area Work
    Clients/
      Acme.md               project in area Work
  Errands.md                project with no area
```

### 4.1 Classifying a path

A reader classifies each path under the root by the first rule that matches:

1. A hidden file or folder, and everything under a hidden folder, is not read. `.plaintask/` is read only as section 9 defines.
2. A path listed in `.plaintask/ignore`, and everything under a listed folder, is not read.
3. A file whose name does not end in `.md` (compared case-insensitively) is not read.
4. A conflict copy (section 4.4) is not a list. A reader SHOULD show it as a warning that offers to merge it into its original.
5. `Inbox.md` in the root is Inbox. `Trash.md` in the root is Trash. Both names are compared case-insensitively.
6. Any other `.md` file is a project.

### 4.2 Areas

- An area's name is its folder's name.
- An empty area folder is an empty area.
- A project directly in the root has no area.
- A project at any depth under an area folder belongs to that area. Folders below the area only group files; a reader SHOULD show them in the project's subtitle (for `Work/Clients/Acme.md`, "Clients/"). Format 1 has no nested areas.
- Format 1 stores no area details other than its name and its place in `.plaintask/order`.

### 4.3 File and folder names

- `Inbox.md` and `Trash.md` are the same English names on every device, whatever language the app shows.
- A project's name is its `title` front matter key (section 5.1), or else its filename without `.md`.
- A writer that makes a file or folder from a name MUST replace each of `/ \ : * ? " < > |` and each control character with `-`, and MUST remove spaces and dots at the end of the name. If that changes the name, it MUST write the full name in `title`.
- A writer MUST NOT create a file whose name differs from an existing file's only in letter case.

### 4.4 Conflict copies

A file is a conflict copy when its name matches one of these patterns and the original it names exists in the same folder:

| Sync tool | Name of the copy | Original |
| --- | --- | --- |
| Dropbox | `<base> (<anything>conflicted copy<anything>).md` | `<base>.md` |
| iCloud Drive | `<base> <n>.md`, where `<n>` is a number 2 or higher | `<base>.md` |
| Google Drive | `<base> (<n>).md` | `<base>.md` |
| Syncthing | `<base>.sync-conflict-<date>-<time>-<device>.md` | `<base>.md` |

The match is a guess: `Phase 2.md` next to `Phase.md` matches. A reader MUST let the person keep such a file as a project, by listing it in `.plaintask/ignore` under a `!keep` line (section 9.3).

## 5. Lists

Inbox, Trash and every project share one structure: optional front matter, then a body.

### 5.1 Front matter

Front matter is a first line of `---` up to and including the next line of `---` (trailing whitespace allowed on both). A first `---` with no closing line is not front matter; it is a horizontal rule, and the lines after it are body. A byte order mark before the first `---` is allowed.

Front matter is YAML. A reader reads only the keys below, and only when the value is a plain scalar on the key's own line. A writer that changes a key MUST change only that key's line, or add one line before the closing `---`, and MUST keep every other line. A writer that adds the first key to a file with no front matter MUST add both `---` lines.

Project keys:

| Key | Value | Missing means |
| --- | --- | --- |
| `title` | Text | The filename without `.md` |
| `deadline` | Date (section 5.4) | No deadline |
| `status` | `active`, `someday`, `done` or `cancelled` | `active` |

A finished project keeps its place and gets `status: done`. Inbox and Trash have no keys in format 1; a reader ignores their front matter and a writer keeps it.

### 5.2 Body

The body is every line after the front matter. A reader skips these blocks, and a writer never changes lines inside them:

- A fenced code block: a line of 0–3 spaces then three or more `` ` `` (with no `` ` `` after them on the line) or three or more `~`, up to a line of 0–3 spaces then at least as many of the same character and only whitespace after them.
- An HTML comment: a line of 0–3 spaces then `<!--`, up to the first line that contains `-->` and is not a task line. A comment that opens and closes on one line hides only that line.

A block with no closing line hides nothing: the lines after its opening line are read as usual.

Other lines:

- A task line (section 5.3) starts a task.
- A line that starts with a space or tab, directly below a task or below a line that belongs to it, belongs to that task (section 5.6). A blank line belongs to the task only if the next line that is not blank is indented.
- A `##` heading starts a section of a project. A reader MAY show sections; it shows tasks in file order either way.
- Any other line (headings, paragraphs, other list items) is text the reader does not show and a writer keeps.

Task order is line order. A writer reorders tasks by moving their lines, together with the lines that belong to them.

### 5.3 Task line

```
task-line = "- [" mark "] " content
mark      = " " | "x" | "X"
content   = token *( whitespace token )
token     = field | tag | id | word
```

- The `-` is the first character on the line (after a byte order mark on line 1). `*` and `+` bullets are not tasks. An indented task line is a checklist item (section 5.6).
- `mark` is a space for an open task and `x` or `X` for a closed one. A writer that ticks a task MUST write `x` and change only that character.
- `content` splits on runs of spaces and tabs. Each token is a field (5.4), a tag (5.5), an id (5.7) or a word, checked in that order.
- The **title** is the words, in order, joined by single spaces. A line whose title is empty is not a task.

A reader reads fields, tags and an id anywhere in `content`. A writer adds a new field after the last token that is not an id, so the id stays last, and changes an existing field in place. Renaming a task changes only its words.

### 5.4 Fields

```
field  = key ":" value
key    = one of the keys in the table below
value  = 1*( any character except space and tab )
       | '"' *( any character except '"' and '\' | '\"' | '\\' ) '"'
```

- Only the keys in the table are fields. Any other `word:word` token (`http://example.com`, `ratio:3`, `10:30`) is a word in the title. A key a later format adds therefore reads as title text in a format 1 reader, and is kept.
- A token whose key is in the table but whose value does not parse as that key's type is a word, not a field.
- A task has at most one of each field. If a key appears twice, the first is the field and the rest are words.
- A writer MUST quote a value that contains a space, tab or `"`, and MAY quote any value.

Value types:

| Type | Form | Example |
| --- | --- | --- |
| Date | `YYYY-MM-DD` | `2026-12-01` |
| Date-time | `YYYY-MM-DDTHH:MM`, 24-hour, no time zone | `2026-11-24T18:00` |
| Path | A path (section 2) | `"Work/Q1 launch.md"` |
| Repeat rule | `daily`, `weekly`, `monthly`, `yearly`, or `<n>d`, `<n>w`, `<n>m`, `<n>y` for every n days, weeks, months or years | `2w` |

Dates and date-times are local to the person wherever they are: `when:2026-11-24T18:00` is 6pm in the device's current time zone. A writer writes the current date in the device's time zone.

Field registry:

| Key | Type | Meaning | Lists |
| --- | --- | --- | --- |
| `when` | Date, date-time, or `someday` | The day the person plans to do the task, or that it is for some day | All |
| `due` | Date | The day the task must be done by | All |
| `repeat` | Repeat rule | How often the task comes back (section 5.8) | All |
| `done` | Date | The day it was completed | All |
| `cancelled` | Date | The day it was cancelled | All |
| `from` | Path | The list it was deleted from | Trash |
| `deleted` | Date | The day it was deleted | Trash |

### 5.5 Tags

```
tag = "#" 1*( letter | digit | "_" | "-" | "/" )
```

- `letter` and `digit` are any Unicode letter or number. A tag has at least one letter, so `#1` is a word.
- Tags compare case-insensitively; a reader shows a tag as written.
- `/` in a tag groups tags (`#work/calls`). Format 1 gives the grouping no other meaning.

### 5.6 Checklist items and notes

Lines that belong to a task (section 5.2):

- An indented line that would be a task line without its indent is a **checklist item**. Its mark is open or closed as in 5.3. It has no fields, tags or id: those tokens are words in its title. Deeper indents are checklist items of the same task.
- Any other line that belongs to the task is part of its **notes**.

A writer that moves or deletes a task MUST move or delete every line that belongs to it.

### 5.7 Ids

```
id = "^" 1*( lowercase-letter | digit | "-" )
```

- An id is only an id as the last token on the line. Elsewhere, `^abc` is a word.
- This is the Markdown block-reference syntax, so other editors can link to a task.
- A writer adds an id only when it needs to track the task: when it moves the task to another file, when it writes a repeating task's next copy, or when it edits a task during a sync conflict. A writer MUST NOT add ids to tasks it does not otherwise change.
- A writer makes a new id of 6 characters from `a`–`z` and `0`–`9`, unique within the root. A reader MUST accept any id that matches the grammar.
- If two tasks in the root have the same id, a writer MUST give the one in the file written later a new id.

A task with no id is named by its title and the number of tasks with the same title above it in the same file. That name survives ticking the task and adding fields, because neither changes the title.

### 5.8 Task state

| State | Line |
| --- | --- |
| Open | mark is a space |
| Done | mark is `x` or `X`, and the task has no `cancelled` |
| Cancelled | mark is `x` or `X`, and the task has `cancelled` |
| Deleted | the task is in `Trash.md` |

- A writer that completes a task MUST write `x` and add `done:<today>`.
- A writer that cancels a task MUST write `x` and add `cancelled:<today>`.
- A writer that reopens a task MUST write a space and remove `done` and `cancelled`.
- A closed task with neither `done` nor `cancelled` is done on an unknown date. An open task with `done` or `cancelled` is open; a reader ignores the field and a writer keeps it.

A writer that completes a task with `repeat`:

1. removes `repeat` from that line and completes it;
2. writes a new open task directly after that task's lines, with the same title, tags, checklist items (all open) and notes, and the same `repeat`;
3. sets the new task's `when` to the old `when` plus one interval, and its `due` to the old `due` plus the same interval, keeping each field only if the old task had it. If the old task had no `when`, the new `when` is the completion date plus one interval.

Only the open copy carries `repeat`, so editing it edits the series. Adding a month to a day the target month lacks gives that month's last day (2026-01-31 plus `monthly` is 2026-02-28).

## 6. Inbox

`Inbox.md` holds tasks that are in no project. It follows section 5. A root with no `Inbox.md` has an empty Inbox; a reader MUST NOT create the file until a writer adds a task to it.

## 7. Trash

`Trash.md` holds deleted tasks. It follows section 5.

- A writer that deletes a task moves its lines to the end of `Trash.md`, adds `from:<path of its list>` and `deleted:<today>`, and adds an id if it has none.
- A writer that restores a task moves its lines to the end of its `from` list, or to Inbox if that list is gone, and removes `from` and `deleted`.
- Emptying Trash removes every task in `Trash.md` and the lines that belong to them, and keeps every other line.

## 8. Views

Views are computed. None has a file of its own except Inbox and Trash.

| View | Shows |
| --- | --- |
| Inbox | Open tasks in `Inbox.md` |
| Today | Open tasks in any list except Trash whose `when` is a date or date-time on or before today |
| Upcoming | Open tasks in any list except Trash whose `when` is after today |
| Anytime | Open tasks in projects with `status: active` that have no `when` |
| Someday | Open tasks with `when:someday`, and open tasks in projects with `status: someday` that have no `when` |
| Completed | Closed tasks in any list except Trash, grouped by `done` or `cancelled` date |
| Trash | Tasks in `Trash.md`, grouped by `deleted` date |

A project with `status: done` or `cancelled` shows its open tasks only in its own list.

## 9. `.plaintask/`

Holds the app files that every device shares. Every file in it is UTF-8 text, one entry per line, with `#` lines and blank lines ignored. A reader keeps files in it that it does not know.

Per-device state (caches, window state, the folder choice) MUST NOT be written in the root. It belongs in the app's own data folder.

### 9.1 `format`

One line: the format version, a whole number. A root with no `.plaintask/format` is format 1.

- A version is raised only by a change that would make an older writer damage the folder. Adding a field, a front matter key, a view or an optional file does not raise it.
- A reader that finds a version higher than its own MUST open the folder read-only and say why.
- A writer MUST NOT lower the version.

### 9.2 `order`

The sidebar order of areas and projects: one path per line. An area is written as its folder path ending in `/` (`Work/`). A project is written as its file path.

- Entries for root-level projects and areas order the top of the sidebar. Entries under an area order that area's projects.
- Things not listed sort after the listed ones, alphabetically by name, case-insensitively.
- A reader ignores a line that names nothing. A writer SHOULD remove such lines when it next writes the file.

### 9.3 `ignore`

Paths that are not lists: one path per line. A path names a file, or a folder and everything under it. Format 1 has no patterns or wildcards.

A line `!keep <path>` marks a file that looks like a conflict copy (section 4.4) as a project.

## 10. Conformance

A format 1 reader:

- classifies paths as section 4.1 says;
- reads front matter, task lines, fields, tags, ids, checklist items and notes as section 5 says;
- refuses to write a file that is not UTF-8 and a folder whose version is higher than its own.

A format 1 writer, in addition:

- changes only the bytes an edit needs (sections 3, 5.1, 5.3);
- keeps every line, token, key and file it does not understand;
- replaces files in one step (section 3).

A reader MAY implement only some features (Inbox only, say). It MUST still keep what it does not implement when it writes.
