---
name: verify-desktop
description: Launch the Plaintask desktop app's page (apps/desktop) in headless Chrome on a disposable task folder, drive it with real mouse and key events, and capture proof - accessibility snapshot, screenshot and the bytes of Inbox.md. Load this skill before you prove that a desktop app feature works, reproduce a desktop app bug, or write or run a recipe in docs/feature-map. For WKWebView, the sandbox, the folder panel or the Dock, it sends you to checking-desktop-app.
---

# Verify the desktop app

The desktop app is one page (`apps/desktop/src`) that reaches the outside only through seven Rust commands. This skill drives that page with a scripted helper. Each command of the helper is one shell command, so a proof is a list of commands and their output.

There are two tiers. Use the page tier for every check it covers.

| Tier | Runs | Drives it | Use it for |
| --- | --- | --- | --- |
| Page | The built page in headless Chrome. The Rust commands are answered from a real folder under `.verify/` | `scripts/control-desktop.mjs` in this skill | The list, adding, ticking, Undo, renaming, keys, the folder request, error messages, the counts, the file's bytes after each step |
| Real window | The built, sandboxed `Plaintask.app` | Screen control, by the `checking-desktop-app` skill | What the page tier does not cover, listed under "Real-window tier" |

Per-feature recipes are in `docs/feature-map/`. Read `docs/feature-map/README.md` first; it is the index. This skill is the reference for the commands those recipes use.

Use this skill to prove that a named feature or fix works, with a recipe that is kept in the feature map. Use the `exploratory-qa` skill to hunt for bugs nobody has named yet and file them as GitHub issues; its harness (`scripts/harness.mjs`, `scripts/session.mjs`) is a separate one with its own task folder outside the repo.

Run every command from the repo root. Needs: `pnpm install` done once, and Google Chrome (or set `CHROME` to a Chrome or Chromium binary).

## Launch

```sh
.claude/skills/verify-desktop/scripts/control-desktop.mjs launch --run <id>
```

`<id>` names the run: 1 to 40 letters, digits, `-` or `_`. Every later command takes the same `--run <id>`. Without `--run`, the id is `$VERIFY_RUN`, or `default`.

`launch` does this, in order:

1. Builds the page (`node apps/desktop/build.mjs`) and copies `apps/desktop/dist` into the run, so a later build does not change what this run serves.
2. Creates the task folder `.verify/<id>/scratch/Tasks` and writes the seed `Inbox.md` into it.
3. Starts one background process, the daemon. It serves the page on a free port, starts headless Chrome with its own profile at 880 x 620, and loads the page.
4. Waits until the page calls the `ready` command, then prints the run.

The run is ready when `launch` prints `ready: the page drew and called \`ready\`` and exits 0. On a failure it prints the reason and the daemon's log, removes what it started, and exits 1.

The seed `Inbox.md` is these 68 bytes. It shows two rows; the third task is ticked, so it is not shown.

```
# Inbox

- [ ] Buy milk
- [ ] Call the tiler
- [x] Water the plants
```

| Launch flag | Effect |
| --- | --- |
| `--inbox <file>` | Use this file's bytes as `Inbox.md` in place of the seed |
| `--no-inbox` | The task folder has no `Inbox.md` |
| `--no-folder` | No folder is chosen yet: the page asks for one. The task folder still exists on disk, and the folder panel returns it |
| `--panel pick\|cancel` | What the folder panel answers. Default `pick` |
| `--theme light\|dark` | The colour scheme the page sees. Default `light` |

`launch` refuses a run id that already has scratch state. Run `cleanup` for that id first, or use another id.

Do not run `launch` while `pnpm test` is running in the same checkout. Both rebuild `apps/desktop/dist`.

## Doctor

```sh
.claude/skills/verify-desktop/scripts/control-desktop.mjs doctor --run <id>
```

Read-only. Run it first whenever a command fails in a way you did not expect. It exits 0 and ends with `healthy`, or exits 1 and ends with `NOT HEALTHY`. It checks:

- The daemon and Chrome pids are alive, and their command lines name this run's scratch folder.
- The page port is answered by this run's daemon (checked with the run's token), and the DevTools port answers.
- The page called `ready` since its last load, and logged no console error.
- The served files still hash to the build recorded at launch, and no file in `apps/desktop/src` or the design system's three files changed after that build.

It also prints the build hash, git commit, URL, task folder, the size and hash of `Inbox.md`, the two badges and the evidence folder. If it says page source changed after the build, run `cleanup` and `launch` again: the run is serving the old page.

## Drive

Every drive command sends real input to Chrome over the DevTools protocol (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`) and returns after the page has drawn two frames and has no command in flight. No drive command calls `.click()`, sets a field's value or calls a function of the page.

### Naming an element

A target is exactly one of:

| Target | Matches |
| --- | --- |
| `--role <role> --name <accessible name>` | The element with that role and exact accessible name in Chrome's accessibility tree. `--name` is optional. Use this first |
| `--text <exact text>` | The innermost visible element whose text is exactly this. Use it for a task's title, which has no role |
| `--selector <css>` | Visible elements that match the CSS selector |

When several elements match, the command fails and says how many. Add `--nth <n>`, counted from 1 in page order. Two tasks with the same title need it.

An element inside an `inert` part of the page does not match. The new-task form is inert while it is closed.

Roles and names in this app:

| Element | Target |
| --- | --- |
| New task button | `--role button --name "New task N"` |
| New-task field | `--role textbox --name "Task"` |
| Add and Cancel in the form | `--role button --name "Add task"`, `--role button --name "Cancel"` |
| A task's checkbox | `--role checkbox --name "Complete: <title>"` |
| A task's title | `--text "<title>"` |
| The rename field | `--role textbox --name "Rename: <title>"` |
| Undo in a toast | `--role button --name "Undo"` |
| The folder button | `--role button --name "Choose folder"`, or `"Choose another folder"` after a read failure |
| A notice's bold line | `--text "Your task folder cannot be found"`, `--text "Could not open Inbox.md"` |
| A toast's message | `--text "Completed: <title>"` |
| The empty state | `--text "Inbox zero"` |
| The sidebar count | `--selector '[data-badge="inbox"]'` |

Other handles the page keeps stable: `[data-list]`, `[data-head]`, `[data-composer]`, `[data-choose]`, `[data-toasts]`, `li[data-row]`.

### Examples

Add a task with the keyboard:

```sh
.claude/skills/verify-desktop/scripts/control-desktop.mjs press n --run <id>
.claude/skills/verify-desktop/scripts/control-desktop.mjs type "Order floor tiles" --run <id>
.claude/skills/verify-desktop/scripts/control-desktop.mjs press Enter --run <id>
```

Tick a task with the mouse, then wait for its row to leave:

```sh
.claude/skills/verify-desktop/scripts/control-desktop.mjs click --role checkbox --name "Complete: Buy milk" --run <id>
.claude/skills/verify-desktop/scripts/control-desktop.mjs wait --role checkbox --name "Complete: Buy milk" --gone --run <id>
```

Rename a task:

```sh
.claude/skills/verify-desktop/scripts/control-desktop.mjs click --text "Call the tiler" --double --run <id>
.claude/skills/verify-desktop/scripts/control-desktop.mjs fill --role textbox --name "Rename: Call the tiler" --value "Call the plumber" --run <id>
.claude/skills/verify-desktop/scripts/control-desktop.mjs press Enter --run <id>
```

### Timing

- A ticked row stays on the page for about 1 s, with its checkbox still named `Complete: <title>`. Use `wait ... --gone` before you assert that it left.
- One command takes 0.5 s to 1.2 s, so a `snapshot` or `screenshot` sent after a tick can find the row gone. Assert the ticked state in the click itself with `click ... --expect <css>`: it fails unless a visible element matches the selector within 500 ms of the click. For a picture of the ticked row, use `click ... --screenshot <name>`: it takes the picture in the same command and prints how many ms after the click that was. Under 600 ms shows the row before it folds. The first pictures of a run can take 1 s or more; `reload` and run it again with a new name.
- A toast stays for about 5 s. Click `Undo` within that time.
- `type` and `press` go to whatever has the keyboard. Their output names it. With no element focused, keys go to the document, where `n`, `j`, `k` and the arrows are the app's shortcuts.

### Simulating what is outside the page

| Situation | Commands |
| --- | --- |
| No folder chosen, the person picks one | `launch --no-folder`, then `click --role button --name "Choose folder"` |
| No folder chosen, the person cancels the panel | `launch --no-folder --panel cancel`, then the same click. `panel pick` changes the answer for the next click |
| A folder with no `Inbox.md` | `launch --no-inbox` |
| Another editor changes the file | `external --append "- [ ] Typed elsewhere"` (or `--from <file>`, or `--remove`), then `refocus` |
| The file cannot be read | `external --from <a file that is not UTF-8>`, or `fail read "<message>"` for any other reason. Then `refocus` or `reload` |
| The file can be read again | `external --from <a UTF-8 file>` or `fail read --off`, then `refocus` |
| The task folder is moved, renamed or deleted | `external --move-folder`, then `refocus`, `reload` or an edit |
| The task folder is back where it was | `external --return-folder`, then `refocus` |
| The person picks the folder again after it moved | `click --role button --name "Choose folder"` with `panel pick`: the pick puts the folder back |
| The file is read-only or locked | `chmod 444 "$(control-desktop.mjs file --path --run <id>)"`, then the edit. `chmod 644` ends it |
| The file has a hard link | `ln "$(control-desktop.mjs file --path --run <id>)" .verify/<id>/scratch/hardlink.md`, then the edit |
| The file cannot be saved for another reason | `fail write "<message>"`, then the edit |
| The folder choice cannot be recalled | `fail folder "<message>"`, then `reload` |
| The failure ends | `fail read --off`, `fail write --off`, `fail folder --off` |
| The app is relaunched | `reload`. The folder stays chosen, as a remembered folder does |

You can also write to the file yourself. `file --path` prints its path.

### Where the input is not a real event

- `refocus` makes a `blur` and a `focus` event on `window` inside the page. Headless Chrome fires no real window focus event. A field that has the keyboard gets no `blur` from it, so "leaving the rename field by switching apps" is not covered here.
- `fill` selects the field's text with Chrome's select-all editing command, then types. The click before it and the typing after it are real events.
- The folder panel, the file layer and the Dock are answered by the daemon. See "Real-window tier".

## Evidence

Evidence goes to `.verify/<id>/evidence/`. `.verify/` is in `.gitignore`. A name is letters, digits, `.`, `-` and `_`. An existing evidence file is never overwritten: the command fails and you choose another name.

```sh
.claude/skills/verify-desktop/scripts/control-desktop.mjs snapshot --save <name> --run <id>     # evidence/<name>.snapshot.txt
.claude/skills/verify-desktop/scripts/control-desktop.mjs screenshot <name> --run <id>          # evidence/<name>.png
.claude/skills/verify-desktop/scripts/control-desktop.mjs file --save <name> --run <id>         # evidence/<name>.Inbox.md, a byte copy
```

The daemon also writes `evidence/transcript.log`: one timestamped line for each drive, simulation and evidence command with its result, and one for each command the page called (`read_inbox`, `write_inbox` with its byte count, `set_badge` with its count, and the rest).

A snapshot is eleven state lines, then the accessibility tree:

```
run: proof
url: http://127.0.0.1:57438/
build: 1ac2cee8fcf2
folder: chosen /path/to/repo/.verify/proof/scratch/Tasks
Inbox.md: 68 bytes, sha256 78e04e20c3ad
sidebar badge: 2
dock badge: 2
focus: the document, no element
commands since load: folder 1, choose_folder 0, read_inbox 1, write_inbox 0, set_badge 1, ready 1, first_frame 1, plugin:event|listen 2, check_for_updates 0, restart_for_update 0
failing: nothing
console errors: 0
--- accessibility tree ---
RootWebArea "Plaintask" [focused]
  navigation "Lists"
    button "Inbox 2"
      text "Inbox"
      text "2"
  main
    sectionheader
      heading "Inbox"
      button "New task N"
        text "New task"
        text "N"
    list
      listitem
        checkbox "Complete: Buy milk" [checked=false]
        text "Buy milk"
      listitem
        checkbox "Complete: Call the tiler" [checked=false]
        text "Call the tiler"
```

- `folder` ends with ` (gone)` while the chosen folder is moved away.
- `dock badge` is the last count the page sent with `set_badge`. `never set` means the page has not called it; `0` means the page removed the badge.
- `commands since load` counts each command the page called since the page last loaded. `write_inbox 0` shows that nothing was saved, but a refused save still counts, so compare the bytes from `file` too; `read_inbox 0` shows that no file was read.
- Marks in brackets: `focused`, `checked=true|false`, `value="..."`, `disabled`, `invalid`.

### Proof standards

- Drive the user's own path: the click or key a person uses. Do not prove a feature through a command of this helper that a person has no equivalent for.
- Capture the action and the state it produced. Take a snapshot before the action and one after it; the transcript records the action between them.
- Check the side effect with the visible result. A row on screen does not show what was written. After each change, compare the file with the bytes you expect:

  ```sh
  .claude/skills/verify-desktop/scripts/control-desktop.mjs file --run <id> | cmp - <(printf '# Inbox\n\n- [x] Buy milk\n- [ ] Call the tiler\n- [x] Water the plants\n')
  ```

  `cmp` prints nothing and exits 0 when the bytes match.
- Check what must not happen. "Nothing is written" is `write_inbox 0` in the snapshot and unchanged bytes from `file`.
- A feature with several entry points (a key and a button) is proved once per entry point. A proof through one of them does not cover the other.
- The page tier answers the Rust commands itself. A proof from this tier says the page is right. It says nothing about the parts listed under "Real-window tier". State which tier each proof came from.
- A step that fails is reported as failed, with the command and its output. Do not change the step until it passes.

## Cleanup

```sh
.claude/skills/verify-desktop/scripts/control-desktop.mjs cleanup --run <id>
```

- Stops the daemon, which stops Chrome. Then stops any process whose command line still names `.verify/<id>/scratch/`. No process is chosen by its name, so another run's Chrome and the person's own Chrome are left alone.
- Deletes `.verify/<id>/scratch/`: the task folder, the Chrome profile, the copied build and the daemon's log.
- Keeps `.verify/<id>/evidence/` and lists it.

Run it after every run, including a failed one. It is safe to run twice. The evidence folder is yours to delete when the proof has been reported.

## Helpers

One helper: `.claude/skills/verify-desktop/scripts/control-desktop.mjs`. It is executable, has no dependencies beyond Node and Chrome, and prints its usage with `help`.

Every command takes `--run <id>`. Exit codes: 0 done; 1 refused or not found (the reason is on stderr); 2 the helper itself failed; 3 `file` when `Inbox.md` is absent.

| Command | Does | Prints |
| --- | --- | --- |
| `launch [--inbox <file> \| --no-inbox] [--no-folder] [--panel pick\|cancel] [--theme light\|dark]` | Builds, seeds the folder, starts the daemon and Chrome, waits for `ready` | `run`, `url`, `folder`, `Inbox.md`, `build`, `evidence`, `ready` lines |
| `doctor` | Read-only health check | One `ok` or `FAIL` line per check, the run's facts, then `healthy` or `NOT HEALTHY` |
| `cleanup` | Stops the run's processes, deletes scratch state, keeps evidence | What it stopped and the evidence files kept |
| `click <target> [--double] [--expect <css>] [--screenshot <name>]` | Moves the mouse to the element's centre and clicks, or double-clicks. Fails if the element has no size or is covered. `--expect` exits 1 unless a visible element matches the selector within 500 ms of the click. `--screenshot` writes `evidence/<name>.png` 0.35 s after the click, in the same command | `clicked checkbox "Complete: Buy milk" at 259,87`. With `--expect`, also `then found: <css>`. With `--screenshot`, also `saved: <path> (taken within <n> ms of the click)` |
| `fill <target> --value <text>` | Clicks the field, selects all, types the text. `--value ""` empties it | `filled textbox "Task" with "Buy milk"` |
| `type <text>` | Key events for each character, to whatever has the keyboard | `typed "Buy milk" with the keyboard in textbox "Task"` |
| `scroll <pixels>` | One real mouse wheel event over the middle of the task list. A negative number scrolls up | `turned the wheel 4000 px over the task list: it moved from 0 to 4000 px` |
| `press <key> [--mod meta,ctrl,alt,shift]` | One key. `Enter`, `Escape`, `Space`, `Tab`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, or one character | `pressed Enter with the keyboard in textbox "Task"` |
| `wait <target> [--gone] [--timeout <ms>]` | Waits until the target matches, or with `--gone` until it does not. Default 10000 ms. Exits 1 on the timeout | `found after 3 ms: text "Inbox zero"` |
| `snapshot [--save <name>]` | Reads the state lines and the accessibility tree | The snapshot; with `--save`, also `saved: <path>` |
| `screenshot <name>` | Writes a PNG of the 880 x 620 window | `saved: <path>` |
| `file [--save <name>] [--path]` | Reads `Inbox.md` from disk | The file's bytes, unchanged. With `--save`: `saved: <path> (<n> bytes, sha256 <12 hex>)`. With `--path`: the path |
| `panel pick\|cancel` | Sets what the folder panel answers from now on | `the folder panel will return <folder>` or `the folder panel will be cancelled` |
| `fail read\|write\|folder <message>` | That command rejects with the message until turned off | `read now fails with: <message>` |
| `fail read\|write\|folder --off` | Ends the failure | `read works again` |
| `external --append <line>` | Appends the line and a newline to `Inbox.md` | `Inbox.md is now <n> bytes, sha256 <12 hex>. The page has not been told: run \`refocus\`.` |
| `external --from <file>` | Replaces `Inbox.md` with the file's bytes | The same line |
| `external --remove` | Deletes `Inbox.md` | `removed <path>` |
| `external --move-folder` | Moves the task folder to `.verify/<id>/scratch/Tasks.moved`, so the chosen path no longer exists | `moved <folder> to <path>. The page has not been told: run \`refocus\`.` |
| `external --return-folder` | Moves the task folder back | `put the task folder back at <folder>. The page has not been told: run \`refocus\`.` |
| `refocus` | Sends `window` a blur and a focus event, so the page rereads the file | `sent the window a blur event and a focus event` |
| `reload` | Loads the page again and waits for `ready` | `reloaded <url>` |
| `help` | | The usage text |

Target flags, for `click`, `fill` and `wait`: `--role <role>`, `--name <accessible name>`, `--text <exact text>`, `--selector <css>`, `--nth <n>`.

### Isolation

Each run id has its own page port, DevTools port, Chrome profile, task folder and evidence folder, all under `.verify/<id>/`. The ports are free ports the operating system assigns. Several runs can be driven at the same time; give each agent its own id.

The helper reads and writes only inside `.verify/` and rebuilds `apps/desktop/dist`. It does not touch `~/Library/Containers/com.airshiplabs.plaintask*`, `~/Applications`, or any task folder of the person.

### How the stand-in differs from the app

- The served `index.html` has one added `<script>` ahead of the page's own. It defines `window.__TAURI_INTERNALS__.invoke`, which sends each command to the daemon, and `transformCallback`, which `listen` from `@tauri-apps/api/event` needs. Every other served byte is the build's.
- The stand-in answers each command with the same values as `src-tauri/src/main.rs`:

| Command | Answer |
| --- | --- |
| `folder` | The folder's path, or `null` when none is chosen. Rejects with the `fail folder` message |
| `choose_folder` | The folder's path after `panel pick`, `null` after `panel cancel` |
| `read_inbox` | The file's text. `''` when the folder has no `Inbox.md`. `null` when the folder itself is gone. Rejects with `<path> is not UTF-8 text, so Plaintask will not change it.` for bytes that are not UTF-8, with `No task folder is chosen yet.` before a pick, and with the `fail read` message |
| `write_inbox` | `null` after the save. Rejects, and leaves the file as it is, with `<path> is read-only or locked, so Plaintask will not change it.`, with `<path> has a hard link, which a save would leave with the old text, so Plaintask will not change it. A symlink works.`, with `Could not save <path>: <reason>` (a folder that is gone among them), and with the `fail write` message |
| `set_badge` | `null`. The count is kept for the `dock badge` line |
| `ready`, `first_frame` | `null` |
| `plugin:event\|listen` | The handler's id. No `update-available` or `update-restart` event is ever sent, so the update offer never shows |
| `check_for_updates`, `restart_for_update` | `null` |

- `write_inbox` writes a temporary file beside `Inbox.md` and renames it over the file. It follows a symlink and keeps the file's permission bits. It does not keep the owner, ACL, extended attributes or creation date, which the app keeps.
- The file and the folder are real. The code that reads and writes them is this helper's, not `src-tauri/src/inbox_file.rs`. A refusal seen here shows what the page does with it. It does not show that the app refuses.
- The three refusal texts above are copied from `inbox_file.rs`. The `<reason>` in `Could not save` and `Could not read` is Node's wording, not Rust's. Every other error text is the one you give to `fail`.
- `choose_folder` returns the run's one folder. A second folder cannot be picked. After `external --move-folder`, a pick moves the folder back first, as a person who picks the moved folder gives the app the same files.

## Real-window tier

The page tier does not cover:

- WKWebView. The page runs in Chrome here.
- The App Sandbox and its entitlements.
- The system folder panel.
- The security-scoped bookmark that remembers the folder across launches.
- Dragging the window by its top strip, and the traffic lights.
- The Rust file layer: `src-tauri/src/inbox_file.rs` and `folder.rs`. That includes the refusal of a file that is not UTF-8, read-only, locked or hard-linked, the answer for a folder that is gone, and the metadata a save keeps.
- The real Dock badge. The page tier records the count the page asks for, and no more.
- Launch time.

For the Rust file and folder layer, run:

```sh
pnpm --filter @plaintask/desktop check:rust
```

For everything else on that list, load the `checking-desktop-app` skill and follow it. It builds the app under the test identifier `com.airshiplabs.plaintask.dev`, so the check never writes to the installed app's container or the person's task folder. This skill's helper does not launch the real app.
