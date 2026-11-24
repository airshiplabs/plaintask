# specs

TLA+ models of the state machines in the code, checked with TLC, and the tests that fail when the code and a model disagree.

| Spec | Code it models | What TLC checks |
| --- | --- | --- |
| `DesktopSession.tla` | `apps/desktop/src/session.ts` (and the queue of reads and saves in `app.ts`) | The form and a title field only show over the list; an add or a rename is "saving" exactly while its save is queued or settling; reads need a chosen folder |
| `DesktopSessionSettles.tla` | the same | Once the person stops, every save settles and the window shows the list or a notice |
| `ReleasePhases.tla` | `derivePhase()` and `nextTask()` in `.claude/skills/release/scripts/plan.mjs` | A release is only made or published from a verified build whose QA run found no blocker, and keeps that build; the brief `status` names can run; phases only go back for a closed pull request, a new build, a failed verify or a QA blocker |

## Commands

Run from the repo root. Java 11 or later must be on `PATH`. The first run downloads TLA+ Tools 1.7.4 (`tla2tools.jar`) into `~/.cache/plaintask-tla` and checks its SHA-256; `TLA_CACHE` sets another folder.

| Command | Does |
| --- | --- |
| `pnpm check:specs` | Model-checks every config (`check.mjs`). CI's `test` job runs it before `pnpm test` |
| `node --experimental-strip-types --test tests/spec-*.test.mjs` | The conformance tests alone. `pnpm test` runs them with the rest |

## How a conformance test works

TLC dumps the state graph it explored (`tlc.mjs` reads it). The code's machine is pure: a state with the spec's variable names and values, and the step that moves it. For every edge of the graph the test takes the step in the code and compares where it lands with where the spec lands (`conform.mjs` for `session.ts`). For the person's actions it also checks that the code refuses exactly what the spec refuses. A rule changed on one side only fails the test, naming the state and the action.

What the tests do not prove: that `app.ts` sends `session.ts` the right event at the right time, or that `release.mjs`'s commands make the checks `ReleasePhases.tla` gives them. The browser tests in `tests/desktop-app.test.mjs` and `release.test.mjs` cover those.

## Adding a machine

1. Make the state machine a pure table or function in the code, with its states named as the spec names them.
2. Write `specs/<Name>.tla` and `specs/<Name>.cfg`, and add the config to `CHECKS` in `check.mjs`.
3. Write `tests/spec-<name>.test.mjs`: run `check('<Name>')` and compare every edge with the code.
4. Change the code by hand once and watch the test fail.
