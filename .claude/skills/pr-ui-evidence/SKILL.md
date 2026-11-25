---
name: pr-ui-evidence
description: Show a UI change in its pull request with screenshots, a subtitled demo.mp4, or both. Load this skill before you run gh pr create or gh pr edit --body on a branch that changes what a person sees in the desktop app, or when someone asks what proof a UI pull request needs.
---

# Show the UI change in the PR

Every PR that changes the UI shows the change: screenshots, a subtitled `demo.mp4`, or both. A reviewer must see the change without building the branch.

## 1. Does the branch change the UI?

Run `git diff --name-only origin/main...`. The branch changes the UI when it touches:

- `apps/desktop/src/**`: the page's HTML, CSS and any TypeScript that changes what is drawn or what text is shown
- window settings in `apps/desktop/src-tauri/tauri.conf.json` (size, title, decorations)
- Rust code whose result a person sees: a message, a badge, a menu, the Dock

Tests, docs, CI and Rust logic with no visible result are not UI. When unsure, treat it as UI.

## 2. Pick the evidence

| The change | Evidence |
| --- | --- |
| A state that stays on screen: layout, colour, text, an icon | Screenshots. Before and after when it changes UI that already exists |
| A flow, an animation, or anything that depends on order or timing | `demo.mp4` with subtitles |
| A flow that ends in a state worth a still | Both |

Take the "before" picture before your first UI edit. If you missed it, run the same recipe from a worktree of `origin/main`.

## 3. Capture it

Never use the person's own task folder or the installed app. There are two paths. Pick by where the change shows.

| Path | Runs | Use it for |
| --- | --- | --- |
| Page | The built page in headless Chromium, the Rust commands answered by a stand-in | The main window's page and the About page: layout, text, colour, keys, flows |
| Real window | A built `Plaintask.app` under a test identifier | Window size and chrome set in Rust (`inner_size`, title bar), WKWebView rendering, the sandbox, the folder panel, the Dock, menus |

When unsure, use the page path first. If the picture does not show the change, use the real window. A window-size change looks different in Chromium than in the app.

### Page path

**Screenshots** (load the `verify-desktop` skill for the full command list):

```sh
.claude/skills/verify-desktop/scripts/control-desktop.mjs launch --run ui
.claude/skills/verify-desktop/scripts/control-desktop.mjs screenshot after --run ui   # .verify/ui/evidence/after.png
.claude/skills/verify-desktop/scripts/control-desktop.mjs cleanup --run ui
```

Add `--theme dark` to `launch` for a dark-mode picture when the change touches colour.

**Subtitled `demo.mp4`** (needs Playwright and ffmpeg). Build first with `node apps/desktop/build.mjs`, then run a script that uses the `exploratory-qa` session:

```js
import { openApp } from '<repo>/.claude/skills/exploratory-qa/scripts/session.mjs';

const app = await openApp({ folder: OUT + '/tasks', inbox: '- [ ] Buy milk\n- [ ] Call the tiler\n',
  evidence: { dir: OUT + '/evidence', video: 'demo' } });
await app.say('Two open tasks.');
await app.check('Buy milk').click();
await app.say('Tick "Buy milk". It leaves the list and the file says done.');
await app.shot('after');           // optional still
await app.close();                 // writes $OUT/evidence/demo.mp4
```

`OUT` is a folder outside the repo. Call `say()` after the action it describes. Each subtitle states what the viewer sees, in the person's terms.

**The About page.** Pass `page: 'about.html'` and the window's size. The strip then shows only the subtitle. The version comes from `apps/desktop/package.json`; Check for Updates succeeds and shows no status.

```js
const app = await openApp({ folder: OUT + '/tasks', inbox: '', page: 'about.html', width: 300, height: 320,
  evidence: { dir: OUT + '/evidence' } });
await app.say('About, 300 x 320.', 300);
await app.shot('about-after');
await app.close();
```

### Real window path

Load the `checking-desktop-app` skill and follow "Make a separate copy". It takes about 2 minutes per build.

1. For before and after, build once per version: `pnpm --filter @plaintask/desktop app --config '{"identifier":"com.airshiplabs.plaintask.dev"}'`. For the "before" build, revert only the changed lines, build, then restore them with `git checkout -- <file>`. Copy each `Plaintask.app` out of `target/` before the next build overwrites it.
2. Run one copy at a time: both share the test identifier. Start its binary with `PLAINTASK_ROOT` set to a folder under `~/Library/Containers/com.airshiplabs.plaintask.dev/Data/tmp/`.
3. Drive it with the computer-use `app_*` tools: `app_menu` reaches the menus, for example `["Plaintask", "About Plaintask"]`. `app_list_windows` gives each window's id.
4. Save a picture of one window, at 2x, without its shadow: `screencapture -x -o -l <window id> before.png`.
5. Turn the pictures into a subtitled video. Each picture shows for 3.5 s above its subtitle:

   ```sh
   node .claude/skills/pr-ui-evidence/scripts/stills-to-demo.mjs demo.mp4 \
     before.png 'Before: About is 300 x 260. Check for Updates is cut off.' \
     after.png 'After: About is 300 x 320. The whole button shows.'
   ```

6. Clean up as `checking-desktop-app` says: quit the copy, delete it and its container, and build once more without `--config`.

## 4. Check it

Open every picture and watch the video once. Drop any claim in the PR body that the evidence does not show. Recapture if the change is cut off, hidden behind a toast, or not on screen.

## 5. Attach it

Use the `bostonaholic:attaching-pr-screenshots` skill to upload the files into one `## Screenshots` section of the PR body. Name each picture by what it shows ("Before: ...", "After: ..."). Do not add a `- [ ]` box for the evidence.

If you cannot capture the change (the person declined screen control for the real window, a tool is missing), write why as a plain bullet in the PR body and tell the user. Do not leave a UI PR without evidence silently.
