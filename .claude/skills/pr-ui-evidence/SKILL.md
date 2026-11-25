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

Never use the person's own task folder or the installed app.

**Screenshots** (page tier, load the `verify-desktop` skill for the full command list):

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

**Real window.** A change only the built app shows (WKWebView rendering, the sandbox, the folder panel, the Dock, the About window) needs the `checking-desktop-app` skill. Screenshot the real window there.

## 4. Check it

Open every picture and watch the video once. Drop any claim in the PR body that the evidence does not show. Recapture if the change is cut off, hidden behind a toast, or not on screen.

## 5. Attach it

Use the `bostonaholic:attaching-pr-screenshots` skill to upload the files into one `## Screenshots` section of the PR body. Name each picture by what it shows ("Before: ...", "After: ..."). Do not add a `- [ ]` box for the evidence.

If you cannot capture the change (no screen access for the real window, a tool missing), write why as a plain bullet in the PR body and tell the user. Do not leave a UI PR without evidence silently.
