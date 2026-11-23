---
name: exploratory-qa
description: Find bugs in the Plaintask desktop app (apps/desktop) by using it as a person would, then trying to break it, and file each confirmed bug as a GitHub issue with steps, screenshots and a subtitled video. Use this skill when asked to QA, bug-hunt, stress, break or exploratory-test the desktop app, or to record a reproduction of a desktop bug. Not for checking one change in the built window (use checking-desktop-app) and not for writing regression tests.
---

# Exploratory QA of the desktop app

The result is a set of GitHub issues. Each one has steps a person can follow, what the screen showed, what `Inbox.md` held on disk, and evidence. Nothing is fixed during a QA run.

Keep every temporary file (task folders, evidence, built probes) outside the repo. `$OUT` below is that folder.

## Rules

- Never run against the person's own task folder or the installed app. The harness and the probe take a folder you create under `$OUT`.
- A bug is confirmed only when you compared the screen with the file on disk. A row on screen does not show what was written.
- File only what you reproduced in this run. A fault read from the code and not reproduced is not an issue.
- State in each issue where it ran and what was not rerun.
- A missing feature the README lists under "Not built yet" is not a bug. Report it in the summary, not as an issue.

## 1. Read before you test

1. Read `apps/desktop/README.md`: "What it does", "File rules" and "Not built yet" define expected behaviour.
2. Read `apps/desktop/src/app.ts`, `apps/desktop/src/inbox.ts` and `apps/desktop/src-tauri/src/inbox_file.rs`. Write down every place where two things can happen at once, where an error is caught, and where the file's text is matched by a pattern. Those are the scenarios to try in step 4.
3. List the open issues, so you file no duplicate: `gh issue list --state open --limit 100`.

## 2. Pick where each check runs

| Where | Covers | How |
| --- | --- | --- |
| The page on the harness | Everything `app.ts` and `inbox.ts` do: keys, clicks, the list, toasts, counts, the file's text | `scripts/session.mjs` or `scripts/harness.mjs` |
| The write probe | What a save does to the file itself: extended attributes, dates, links, permissions | `scripts/write-probe.rs` |
| The built app's window | WKWebView, the App Sandbox, the folder panel, the remembered folder, window dragging, menus, the Dock badge | the `checking-desktop-app` skill |

Start with the first two. They need no access to the screen. The built window needs the person to grant control of the test copy; if they decline, do not drive the window another way, and list its rows under "not covered" in the summary.

The harness differs from the app in two ways, and each issue found on it must say so: the engine is Chromium, not WKWebView, and its write is a plain overwrite.

## 3. Use it as a person would

Build the page, then open it on a test folder:

```sh
node apps/desktop/build.mjs
node .claude/skills/exploratory-qa/scripts/harness.mjs "$OUT/tasks" 4173
```

Open the printed URL in a browser tool at 880 x 620 and go through the README's "What it does" list once by hand: add, tick, Undo, rename, `j`/`k`, the empty state, a reread after the file changes. This finds what looks wrong, which a script does not.

## 4. Try to break it

Write one script that runs each scenario on a fresh file and prints `state()`:

```js
import { openApp } from '<repo>/.claude/skills/exploratory-qa/scripts/session.mjs';

const app = await openApp({ folder: OUT + '/tasks', inbox: '- [ ] Buy milk\n- [ ] Call the tiler\n' });
await app.check('Buy milk').click();
await app.page.waitForTimeout(1500);
await app.page.locator('.pt-toast button').dblclick();
await app.page.waitForTimeout(1500);
console.log(await app.state());   // rows, count, dock, toasts, notice, file, errors
await app.close();
```

`app.page` is a Playwright page. `app.refocus()` does what the window regaining focus does. Change the file between steps with `fs.writeFileSync(app.file, ...)` to act as another editor.

Cover each group. Cap a first pass at about 25 scenarios.

- **Two actions close together.** A second action while the first is still saving or animating: rename then tick, tick then add, double-click on every button, three ticks in a row, Undo during the fold.
- **The file changes under the app.** Another editor adds, removes or reorders lines; the file becomes unreadable and readable again; the folder is moved or deleted. With and without `refocus()`.
- **Files the app did not write.** A first line of `---`, code fences, HTML comments, other list markers, CRLF and CR line endings, a BOM, no final newline, non-UTF-8 bytes, 10,000 lines.
- **Titles.** Duplicates, 200 characters with no space, 300 characters of words, HTML, quotes, emoji, right-to-left text, leading and trailing spaces, a title that is only spaces.
- **Keys and focus.** Each key from the README in each state: form open, rename open, toast focused, empty list. Tab order. Where focus is after each action.
- **Layout.** The minimum window (640 x 400), a long list, a long toast, the light and dark themes. Take a screenshot and look at it; measure with `getBoundingClientRect` when an element may be off screen.
- **The saved file.** Build the probe and compare the file before and after a write:

  ```sh
  rustc -O -o "$OUT/write-probe" .claude/skills/exploratory-qa/scripts/write-probe.rs
  "$OUT/write-probe" "$OUT/probe-folder" '- [x] One
  '
  ```

  Check `xattr`, `stat -f '%i %B'`, `ls -l`, a hard link, a read-only file, a locked file (`chflags uchg`).

For each scenario decide the expected result from the README before you read the output. A result is a bug when the screen and the file disagree, when data is lost or changed that the person did not change, when an action cannot be undone as the README says, when internal text reaches the person, or when text or a control cannot be read or reached.

## 5. Record evidence for each confirmed bug

Rerun the bug alone with `evidence`. The page gets a strip under the app that shows a subtitle and `Inbox.md` as it is on disk, so one frame shows both.

```js
const app = await openApp({ folder, inbox, evidence: { dir: OUT + '/evidence', video: '2-double-click-undo' } });
await app.say('Four open tasks.');
await app.check('Buy milk').click();
await app.say('Tick "Buy milk". The toast offers Undo.');
await app.page.locator('.pt-toast button').dblclick();
await app.say('BUG: "Buy milk" was completed again. The file says done.', 4000);
await app.shot('2-double-click-undo');
await app.close();                // writes 2-double-click-undo.mp4
```

- Record a video when the bug depends on order or timing. A screenshot is enough for a state that stays on screen.
- Call `say()` after the action it describes, so the file panel shows the file after that action.
- Open two or three of the screenshots and read them before filing. Drop any claim the picture does not show.
- Use realistic input. If the bug needs unusual input, say which input in the issue.

## 6. File the issues

1. Search again for a duplicate of each bug: `gh issue list --state all --search "<words> in:title"`.
2. Write one body per bug from `assets/issue-body.md` into the evidence folder, next to its files. Refer to screenshots as `./name.png`. Do not refer to videos in the body.
3. Create each issue. `gh` uploads the files, rewrites the `./name.png` references, and appends each video as a player:

   ```sh
   cd "$OUT/evidence" && gh issue create --label bug \
     --title "desktop: <what goes wrong, in the person's terms>" \
     --body-file 2.md --attach ./2-double-click-undo.png --attach ./2-double-click-undo.mp4
   ```

4. Read one issue back and confirm its body holds `user-attachments` links and no local path: `gh issue view <n> --json body -q .body`.

One bug per issue. Faults with one cause and one fix go in one issue.

## 7. Clean up and report

1. Stop the harness. Delete `$OUT`.
2. If you used the built window, follow "Afterwards" in the `checking-desktop-app` skill.
3. Run `git status --short`. It must print nothing.
4. Report a table of the issues, worst first: data loss or a wrong file, then actions that cannot be undone, then wrong or missing messages, then layout. Under it: where each was reproduced, what was not covered, and what you saw that is a missing feature.
