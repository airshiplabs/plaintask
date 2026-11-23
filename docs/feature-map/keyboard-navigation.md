# Keyboard navigation

A person moves between task rows with `j` and `k` or the arrow keys. The keyboard sits on a row's checkbox. From a focused row, Space ticks the task and Return opens its title for renaming. `N` opens the new-task form from anywhere outside a text field. Keys typed in a text field are text.

## Use cases

- As a person who works from the keyboard, I move down and up the list without the mouse.
- As a person who processes the Inbox top to bottom, I tick a row and the keyboard moves to the next one.

## Sub-features

- `nav-first-row` moves the keyboard to the first row on `j` or the Down arrow when no row has it.
- `nav-down` moves the keyboard to the next row on `j` or the Down arrow.
- `nav-up` moves the keyboard to the previous row on `k` or the Up arrow.
- `nav-stop-at-ends` keeps the keyboard on the last row on `j` and on the first row on `k`. It does not wrap.
- `nav-skip-leaving` skips a row that is folding away after a tick.
- `nav-keys-in-field` leaves `j`, `k`, `n` and the arrow keys to a text field that has the keyboard.
- `nav-modifiers-ignored` leaves a key alone while Command, Control or Option is held.
- `nav-form-open` ignores row keys while the new-task form is open.
- `nav-needs-inbox` ignores every key while a notice is shown in place of the list.
- `nav-empty-list` does nothing on `j`, `k` and the arrow keys when the list shows `Inbox zero`.

The full key list:

| Key | Where the keyboard is | Does | Feature file |
| --- | --- | --- | --- |
| `N` or `n` | Outside a text field | Opens the new-task form | [Add a task](./add-task.md) |
| Return | `Task` field | Adds the task | [Add a task](./add-task.md) |
| Escape | New-task form open | Closes the form | [Add a task](./add-task.md) |
| `j` or Down arrow | Outside a text field | Moves to the next row | this file |
| `k` or Up arrow | Outside a text field | Moves to the previous row | this file |
| Space | A row's checkbox | Ticks the task | [Complete a task and Undo](./complete-task.md) |
| Return | A row's checkbox | Opens the rename field | [Rename a task](./rename-task.md) |
| Return | Rename field | Saves the title | [Rename a task](./rename-task.md) |
| Escape | Rename field | Keeps the old title | [Rename a task](./rename-task.md) |
- `nav-long-list` moves to a row that is not in the page yet: the list scrolls and the row is drawn before it gets the keyboard.
- `nav-focus-lost-on-scroll` takes the keyboard off a row that the mouse wheel scrolls more than one view's height away. The next `j` or `k` goes to the first row and scrolls the list back to the top.

## How to get to it (user POV)

- Press `j` or the Down arrow while an Inbox with rows is shown and the keyboard is not in a text field.
- Press `k` or the Up arrow in the same state.
- After a row has the keyboard, press Space, Return, `j`, `k` or an arrow key.

A mouse click on a title does not give a row the keyboard. A click on a checkbox ticks the task.

## Driving it with control-desktop

Preconditions:

- The app instance was started by this run on a disposable task folder.
- The folder holds the baseline file.
- The three rows `Buy milk`, `Call mum`, `Water plants` are showing. The new-task form is closed. No rename field is open. No row has the keyboard.
- No bullet in this file writes to `Inbox.md`. After every bullet the file is byte for byte the baseline file.
- Write the baseline file once: `mkdir -p .verify && printf '# Inbox\n\n- [ ] Buy milk\n- [ ] Call mum\n  - [ ] a subtask the app leaves alone\n- [x] Done already\n- [ ] Water plants\n' > .verify/baseline.md`.
- Start the run with `control-desktop launch --inbox .verify/baseline.md`, then `control-desktop doctor`. A bullet that names another launch command needs its own run id.
- Before each bullet, return to the baseline state: `control-desktop external --from .verify/baseline.md`, then `control-desktop reload`. After a reload no row has the keyboard.
- `control-desktop snapshot` prints a `focus:` line. That line is the handle `the focused element's accessible name`.
- Every command below was run in the page tier, in headless Chrome. Keys in WKWebView are real window only: follow the checking-desktop-app skill.

- **`nav-first-row`.** Action: press `j`. Result: the checkbox `Complete: Buy milk` has the keyboard. File: unchanged. Handle: the focused element's accessible name. Command: Run `control-desktop press j`. `control-desktop snapshot` prints `focus: checkbox "Complete: Buy milk"` and `write_inbox 0`. `control-desktop file | cmp - .verify/baseline.md` prints nothing and exits 0. After `control-desktop reload`, `control-desktop press ArrowDown` gives the same focus line.
- **`nav-down`.** Action: with `Buy milk` focused, press the Down arrow, then press `j`. Result: after the first key `Complete: Call mum` has the keyboard. After the second, `Complete: Water plants` has it. File: unchanged. Handle: the focused element's accessible name. Command: Run `control-desktop press j` to focus `Buy milk`. Run `control-desktop press ArrowDown`: `control-desktop snapshot` prints `focus: checkbox "Complete: Call mum"`. Run `control-desktop press j`: `control-desktop snapshot` prints `focus: checkbox "Complete: Water plants"`. `control-desktop file | cmp - .verify/baseline.md` prints nothing and exits 0.
- **`nav-up`.** Action: with `Water plants` focused, press `k`, then press the Up arrow. Result: after the first key `Complete: Call mum` has the keyboard. After the second, `Complete: Buy milk` has it. File: unchanged. Handle: the focused element's accessible name. Command: Run `control-desktop press j` three times to focus `Water plants`. Run `control-desktop press k`: `control-desktop snapshot` prints `focus: checkbox "Complete: Call mum"`. Run `control-desktop press ArrowUp`: `control-desktop snapshot` prints `focus: checkbox "Complete: Buy milk"`. `control-desktop file | cmp - .verify/baseline.md` prints nothing and exits 0.
- **`nav-stop-at-ends`.** Action: with `Water plants` focused, press `j`. Result: `Complete: Water plants` still has the keyboard. Then move to `Buy milk` and press `k`. Result: `Complete: Buy milk` still has the keyboard. File: unchanged. Handle: the focused element's accessible name. Command: Run `control-desktop press j` three times to focus `Water plants`. Run `control-desktop press j`: `control-desktop snapshot` prints `focus: checkbox "Complete: Water plants"`. Run `control-desktop press k` twice to focus `Buy milk`. Run `control-desktop press k`: `control-desktop snapshot` prints `focus: checkbox "Complete: Buy milk"`. `control-desktop file | cmp - .verify/baseline.md` prints nothing and exits 0.
- **`nav-skip-leaving`.** Action: restore the baseline file after this bullet, because it ticks a task. Focus `Buy milk`, press Space, and within 0.5 s press `j`. Result: `Complete: Call mum`, the first row that is staying, has the keyboard. File: the baseline file with `- [x] Buy milk`. This bullet is the one exception to the no-write precondition. Handle: the focused element's accessible name; `li[data-row]:not([data-leaving])`. Command: Run `control-desktop press j` to focus `Buy milk`. Run `control-desktop type " j"`: one command sends Space and then `j`, a few milliseconds apart. Its output is `typed " j" with the keyboard in checkbox "Complete: Buy milk"`. Run `control-desktop wait --selector 'li[data-row="0:Buy milk"][data-leaving]' --timeout 100` at once: it prints `found`, so the ticked row was still on the page. `control-desktop snapshot` prints `focus: checkbox "Complete: Call mum"`. Then `control-desktop wait --selector 'li[data-row="0:Buy milk"]' --gone` prints `gone`, and `control-desktop snapshot` still prints `focus: checkbox "Complete: Call mum"`. `control-desktop file | cmp - <(printf '# Inbox\n\n- [x] Buy milk\n- [ ] Call mum\n  - [ ] a subtask the app leaves alone\n- [x] Done already\n- [ ] Water plants\n')` prints nothing and exits 0.
- **`nav-keys-in-field`.** Action: press `N`, then type `jk`. Result: the `Task` field reads `jk` and keeps the keyboard. No row gains the keyboard. Press Escape to close the form. File: unchanged. Handle: textbox `Task`. Command: Run `control-desktop press n`, `control-desktop type "jk"`, `control-desktop press ArrowDown`, `control-desktop press ArrowUp`. `control-desktop snapshot` prints `focus: textbox "Task"` and `textbox "Task" [value="jk", focused]`. Run `control-desktop press Escape`: `control-desktop wait --role textbox --name "Task" --gone` prints `gone`. `control-desktop file | cmp - .verify/baseline.md` prints nothing and exits 0.
- **`nav-modifiers-ignored`.** Action: press Control-`j`, then Option-`k`, then Control-`n`. Result: no row gains the keyboard. The new-task form stays closed. File: unchanged. Handle: `[data-composer]` is `inert`; the focused element. Command: Run `control-desktop press j --mod ctrl`, `control-desktop press k --mod alt`, `control-desktop press n --mod ctrl`, `control-desktop press j --mod meta`. After each one `control-desktop snapshot` prints `focus: the document, no element`. `control-desktop wait --role textbox --name "Task" --gone` prints `gone`. `control-desktop file | cmp - .verify/baseline.md` prints nothing and exits 0.
- **`nav-form-open`.** Action: press `N`, click an empty part of the list area so the `Task` field loses the keyboard, then press `j`. Result: the form is still open. No row gains the keyboard. Press Escape to close the form. File: unchanged. Handle: `[data-composer]` is not `inert`; the focused element. Command: Run `control-desktop press n`, then `control-desktop click --selector '[data-list]'`. The click lands at the centre of the list area, below the rows. `control-desktop snapshot` prints `focus: the document, no element`. Run `control-desktop press j`: `control-desktop snapshot` prints `focus: the document, no element`, `control-desktop wait --selector '[data-composer]:not([inert])'` prints `found` and `control-desktop wait --role textbox --name "Task"` prints `found`. Run `control-desktop press Escape`: `control-desktop wait --role textbox --name "Task" --gone` prints `gone`. `control-desktop file | cmp - .verify/baseline.md` prints nothing and exits 0.
- **`nav-needs-inbox`.** Precondition: a notice is shown, for example `Choose a folder for your tasks`. Action: press `j`, `k` and `N`. Result: nothing changes. The form stays closed. File: unchanged. Handle: status region inside `[data-list]`. Command: Start a run with `control-desktop launch --no-folder --inbox .verify/baseline.md`. `control-desktop wait --text "Choose a folder for your tasks"` prints `found`. Run `control-desktop press j`, `control-desktop press k`, `control-desktop press N`. `control-desktop snapshot` prints `focus: the document, no element`, `read_inbox 0`, `write_inbox 0` and the status region with `Choose a folder for your tasks`. `control-desktop wait --role textbox --name "Task" --gone` prints `gone`. `control-desktop wait --selector '[data-list] [role="status"]'` prints `found`. `control-desktop file | cmp - .verify/baseline.md` prints nothing and exits 0.
- **`nav-empty-list`.** Precondition: the folder has no `Inbox.md` and the list shows `Inbox zero`. Action: press `j`, `k`, the Down arrow and the Up arrow. Result: `Inbox zero` still shows. No element inside `[data-list]` has the keyboard. File: the folder still has no `Inbox.md`. Handle: status region `Inbox zero`. Command: Start a run with `control-desktop launch --no-inbox`. `control-desktop wait --text "Inbox zero"` prints `found`. Run `control-desktop press j`, `control-desktop press k`, `control-desktop press ArrowDown`, `control-desktop press ArrowUp`. `control-desktop snapshot` prints `focus: the document, no element`, `Inbox.md: absent` and `write_inbox 0`. `control-desktop wait --text "Inbox zero"` prints `found`. `control-desktop wait --selector '[data-list] :focus' --gone` prints `gone`. `control-desktop file` exits 3 and prints that `Inbox.md` is absent.
- **`nav-long-list`.** Action: on a file of 500 tasks, press `j` 60 times, then `k` once. Result: after the 60 presses the keyboard is on `Complete: Task 060` and `Task 001` is no longer in the page. After `k` it is on `Complete: Task 059`. File: unchanged. Handle: the `focus:` line of `snapshot`. Run `for i in $(seq -w 1 500); do printf -- '- [ ] Task %s\n' $i; done > .verify/long.md`, then `control-desktop launch --inbox .verify/long.md`. Run `control-desktop type "$(printf 'j%.0s' $(seq 1 60))"`, then `control-desktop snapshot | grep '^focus'`. It prints `focus: checkbox "Complete: Task 060"`. Run `control-desktop wait --text "Task 001" --gone --timeout 500`. It exits 0. Run `control-desktop press k`, then `control-desktop snapshot | grep '^focus'`. It prints `focus: checkbox "Complete: Task 059"`. `control-desktop file | cmp - .verify/long.md` prints nothing.
- **`nav-focus-lost-on-scroll`.** Action: after `nav-long-list`, turn the mouse wheel 6000 px down over the list, then press `j`. Result: after the wheel no element has the keyboard. After `j` the keyboard is on `Complete: Task 001` and the list is back at the top. File: unchanged. Handle: the `focus:` line of `snapshot`. On the `nav-long-list` run, run `control-desktop scroll 6000`, then `control-desktop snapshot | grep '^focus'`. It prints `focus: the document, no element`. Run `control-desktop press j`, then `control-desktop snapshot | grep '^focus'`. It prints `focus: checkbox "Complete: Task 001"`. Run `control-desktop wait --text "Task 001" --timeout 500`. It exits 0.

## Gotchas

- A key typed while a text field has the keyboard is text. After a save, Escape or `Cancel` in the new-task form, the keyboard is on the `New task` button, so row keys work again, and Return or Space there opens the form.
- The keyboard sits on the row's checkbox. Read the focused element's name (`Complete: <title>`) to learn which row has it.
- `k` with no row focused moves to the first row, the same as `j`.
- Return on a focused row opens the rename field. It does not tick. Space ticks.
- After a tick, the keyboard moves to the next row only when the ticked row has folded away, about 1 s later. A `j` or `k` sent before that moves to the first row that is staying.
- The page tests (`tests/desktop-app.test.mjs`) send keys as made-up key events and stand in for Space with a click. `control-desktop press` and `control-desktop type` send real key events to headless Chrome. Keys in WKWebView are proved only in the real window.
- Two `control-desktop` commands run about 0.75 s apart. A ticked row leaves after 1 s. To send Space and `j` inside that time, use one command: `control-desktop type " j"`. Two commands, `control-desktop press Space` then `control-desktop press j`, do not prove `nav-skip-leaving` unless the output of the second names `Complete: Buy milk`. If it names `Complete: Call mum`, the row had left before the key.
- Keys reach the app's window while it is in the background.
- A key pressed with Command, Control or Option held is left alone by the page.
- Capital `J` and `K` do nothing. `n` and `N` both open the form.
- A wheel scroll of less than one view's height leaves the focused row in the page, and it keeps the keyboard.
