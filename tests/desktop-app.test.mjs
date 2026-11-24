// Tauri's page-side API calls window.__TAURI_INTERNALS__.invoke(command, args); the stand-in below answers the same commands src-tauri/src/main.rs does.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openSite } from './browser.mjs';

before(() => { execFileSync(process.execPath, [fileURLToPath(new URL('../apps/desktop/build.mjs', import.meta.url))], { stdio: 'inherit' }); });

/** A value written into the JavaScript these tests run in the page: JSON, with the characters JSON leaves alone but
    script source must not carry raw (a tag's brackets and slash, the two Unicode line ends) written as escapes. */
const ESCAPES = { '<': '\\u003C', '>': '\\u003E', '/': '\\u002F', '\u2028': '\\u2028', '\u2029': '\\u2029' };
const js = value => JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, c => ESCAPES[c]);

/** Opens the app on a folder. `folder` null means none is chosen yet; `inbox` is the text of its Inbox.md ('' for no file);
    `pick` is the folder the open panel will return; `folderError`, `readError` and `writeError` make finding the folder, reading the file or saving it fail with that message;
    `gone` true means the folder itself no longer exists, which read_inbox answers with null. */
function openApp(t, { folder = '/Users/test/Tasks', inbox = '', pick = null, folderError = null, readError = null, writeError = null, gone = false } = {}) {
  const standIn = `window.__disk = ${js({ folder, inbox, pick, folderError, readError, writeError, gone, writes: [], calls: [], dock: null })};
    const callbacks = new Map(), listeners = new Map(); let nextId = 1;
    /** What the Rust layer sends the window, such as "update-available". */
    window.__emit = (event, payload) => { for (const id of listeners.get(event) ?? []) callbacks.get(id)({ event, id, payload }); };
    window.__TAURI_INTERNALS__ = { transformCallback: cb => { const id = nextId++; callbacks.set(id, cb); return id; }, invoke: async (command, args) => {
      const disk = window.__disk;
      disk.calls.push(command);
      if (command === 'plugin:event|listen') { listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]); return args.handler; }
      if (command === 'check_for_updates' || command === 'restart_for_update') return null;
      if (command === 'folder') { if (disk.folderError) throw disk.folderError; return disk.folder; }
      if (command === 'choose_folder') { if (disk.pick) { disk.folder = disk.pick; disk.gone = false; } return disk.pick; }
      if (command === 'read_inbox') { if (disk.readError) throw disk.readError; return disk.gone ? null : disk.inbox; }
      if (command === 'write_inbox') { if (disk.writeError) throw disk.writeError; disk.inbox = args.text; disk.writes.push(args.text); return null; }
      if (command === 'set_badge') { disk.dock = args.count; return null; }
      if (command === 'ready' || command === 'first_frame') return null;
      throw new Error('the page asked for a command the app does not have: ' + command);
    } };`;
  return openSite(t, 'apps/desktop/dist', 880, 620, { before: standIn });
}

const TEXT = selector => `document.querySelector(${js(selector)})?.innerText ?? null`;
const ROWS = '[...document.querySelectorAll("[data-list] .pt-task__title")].map(e => e.textContent)';
const DRAWN = 'window.__disk.calls.includes("ready")';
const click = selector => `document.querySelector(${js(selector)}).click()`;
const press = key => `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${js(key)}, bubbles: true, cancelable: true }))`;
/** text typed into the new-task field */
const type = text => `(() => { const field = document.querySelector('[data-composer] input'); field.value = ${js(text)}; field.dispatchEvent(new Event('input', { bubbles: true })); })()`;
/** Return in the new-task field: the browser submits a form on Return, which a made-up key event does not */
const RETURN = 'document.querySelector("[data-composer] form").requestSubmit()';
const COMPOSER_OPEN = '(c => !c.inert && !c.classList.contains("is-leaving"))(document.querySelector("[data-composer]"))';
const FOCUS = '(e => e.tagName + (e.name ? "[" + e.name + "]" : "") + (e.closest("[data-head]") ? " in header" : ""))(document.activeElement)';
const WRITES = 'window.__disk.writes';
const DOCK = 'window.__disk.dock';

test('with no folder chosen, the app asks for one and shows the Inbox once it is picked', { timeout: 60000 }, async t => {
  const page = await openApp(t, { folder: null, pick: '/Users/test/Tasks', inbox: '- [ ] Buy milk\n' });
  assert.ok(await page.poll(DRAWN), 'precondition: the page never asked for its window');
  assert.equal(await page.evaluate(TEXT('[data-list] strong')), 'Choose a folder for your tasks');
  assert.equal(await page.evaluate(TEXT('[data-list] .pt-btn')), 'Choose folder');
  assert.deepEqual(await page.evaluate('window.__disk.calls.filter(c => c === "read_inbox")'), [], 'no file should be read before a folder is chosen');

  await page.evaluate(click('[data-list] .pt-btn'));
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'after picking a folder the list should show its Inbox');
});

test('picking a folder with no Inbox.md replaces the request with the empty state', { timeout: 60000 }, async t => {
  const page = await openApp(t, { folder: null, pick: '/Users/test/Tasks', inbox: '' });
  assert.equal(await page.poll(TEXT('[data-list] strong')), 'Choose a folder for your tasks', 'precondition: the app did not ask for a folder');
  await page.evaluate(click('[data-list] .pt-btn'));
  assert.equal(await page.poll(TEXT('[data-list] strong'), text => text === 'Inbox zero'), 'Inbox zero');
  assert.equal(await page.evaluate('document.querySelector("[data-list] [data-choose]")'), null, 'the Choose folder button should be gone');
  assert.equal(await page.evaluate('document.querySelector("[data-head] .pt-btn").textContent.trim()'), 'New task N');
});

test('cancelling the folder panel leaves the app asking for a folder', { timeout: 60000 }, async t => {
  const page = await openApp(t, { folder: null, pick: null });
  assert.ok(await page.poll(DRAWN), 'precondition: the page never asked for its window');
  await page.evaluate(click('[data-list] .pt-btn'));
  assert.ok(await page.poll('window.__disk.calls.includes("choose_folder")'), 'precondition: the button did not open the folder panel');
  assert.equal(await page.evaluate(TEXT('[data-list] strong')), 'Choose a folder for your tasks');
});

test('a folder with no Inbox.md shows the empty state and nothing is written to it', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '' });
  assert.equal(await page.poll(TEXT('[data-list] .pt-empty strong')), 'Inbox zero');
  assert.equal(await page.evaluate(TEXT('[data-list] .pt-empty span:last-child')), 'New tasks you capture land here first.');
  assert.equal(await page.evaluate(TEXT('.pt-view-h h2')), 'Inbox');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '', 'an empty Inbox shows no count');
  assert.ok(!(await page.evaluate(DOCK)), 'an empty Inbox puts no count on the Dock icon');
  assert.deepEqual(await page.evaluate('window.__disk.writes'), [], 'opening a folder must not create or change Inbox.md');
});

test('the list is the file\'s open tasks, in file order, and the sidebar and the Dock icon count them', { timeout: 60000 }, async t => {
  const inbox = '---\ntags:\n- [ ] a YAML item, not a task\n---\n# Inbox\n\n- [ ] Order floor tiles due:2026-11-28 #call\n  - [ ] Measure the hallway\n- [x] Call the tiler\n- [ ] <b>Paint</b> & "prime"\n';
  const page = await openApp(t, { inbox });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Order floor tiles due:2026-11-28 #call', '<b>Paint</b> & "prime"'],
    'only open tasks at the left margin are rows; a title is shown as written, never run as HTML');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '2');
  assert.equal(await page.poll(DOCK, n => n !== null), 2, 'the Dock icon counts open tasks only, not ticked ones');
  assert.equal(await page.evaluate('document.querySelector("[data-list] .pt-check").getAttribute("aria-label")'), 'Complete: Order floor tiles due:2026-11-28 #call');
});

test('a task typed into the file in another editor shows when the window is used again', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the first task did not show');
  await page.evaluate('window.__disk.inbox = "- [ ] Buy milk\\n- [ ] Typed in Vim\\n"; window.dispatchEvent(new Event("focus"))');
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 1), ['Buy milk', 'Typed in Vim']);
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '2');
  assert.equal(await page.poll(DOCK, n => n === 2), 2, 'the Dock icon should count the task typed in another editor');
});

test('a file that stops being readable takes the count off the Dock icon', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.equal(await page.poll(DOCK, n => n !== null), 1, 'precondition: the Dock icon did not count the task');
  await page.evaluate('window.__disk.readError = "Inbox.md was moved"; window.dispatchEvent(new Event("focus"))');
  assert.equal(await page.poll(TEXT('[data-list] strong')), 'Could not open Inbox.md');
  assert.equal(await page.poll(DOCK, n => n === 0), 0);
});

test('a folder that is moved away says it cannot be found, offers the folder panel and is not shown as Inbox zero', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n- [ ] Call the tiler\n', pick: '/Users/test/Moved' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk', 'Call the tiler'], 'precondition: the list did not show the tasks');
  await page.evaluate('window.__disk.gone = true; window.dispatchEvent(new Event("focus"))');
  assert.equal(await page.poll(TEXT('[data-list] strong'), s => s !== null), 'Your task folder cannot be found');
  assert.equal(await page.evaluate(TEXT('[data-list] .pt-btn')), 'Choose folder');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '', 'the sidebar should not count tasks it cannot see');
  assert.equal(await page.evaluate('document.querySelector("[data-head] .pt-btn")'), null, 'there should be no New task button');
  await page.evaluate(press('n'));
  assert.equal(await page.evaluate(COMPOSER_OPEN), false, 'N should not open the form');
  assert.deepEqual(await page.evaluate(WRITES), [], 'nothing should be written');

  await page.evaluate(click('[data-list] .pt-btn'));
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk', 'Call the tiler'], 'after choosing the folder again the list should show its Inbox');
});

test('a task added after the folder is gone is not saved and the app says the folder cannot be found', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the list did not show the task');
  await page.evaluate(press('n'));
  assert.ok(await page.poll(COMPOSER_OPEN), 'precondition: N did not open the form');
  await page.evaluate('window.__disk.gone = true');
  await page.evaluate(type('Call the tiler'));
  await page.evaluate(RETURN);
  assert.equal(await page.poll(TEXT('[data-list] strong'), s => s !== null), 'Your task folder cannot be found');
  assert.deepEqual(await page.evaluate(WRITES), [], 'nothing should be written');
  assert.equal(await page.evaluate(COMPOSER_OPEN), false, 'the form should close');
});

test('a folder that goes away between the read and the save shows the folder notice after the failed add', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n', writeError: 'Could not save /Users/test/Tasks/Inbox.md: No such file or directory (os error 2)' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the list did not show the task');
  await page.evaluate('Object.defineProperty(window.__disk, "gone", { get: () => window.__disk.calls.includes("write_inbox") })');
  await page.evaluate(press('n'));
  assert.ok(await page.poll(COMPOSER_OPEN), 'precondition: N did not open the form');
  await page.evaluate(type('Call the tiler'));
  await page.evaluate(RETURN);
  assert.equal(await page.poll(TEXT('[data-list] strong'), s => s !== null), 'Your task folder cannot be found');
  assert.deepEqual(await page.evaluate(WRITES), [], 'nothing should be written');
});

test('a file that cannot be read says why and offers another folder', { timeout: 60000 }, async t => {
  const page = await openApp(t, { readError: '/Users/test/Tasks/Inbox.md is not UTF-8 text, so Plaintask will not change it.' });
  assert.equal(await page.poll(TEXT('[data-list] strong')), 'Could not open Inbox.md');
  assert.match(await page.evaluate(TEXT('[data-list] .pt-empty')), /is not UTF-8 text, so Plaintask will not change it\./);
  assert.equal(await page.evaluate(TEXT('[data-list] .pt-btn')), 'Choose another folder');
});

test('a file that was unreadable is read again when the window is used again, and its tasks come back', { timeout: 60000 }, async t => {
  const page = await openApp(t, { readError: '/Users/test/Tasks/Inbox.md is not UTF-8 text, so Plaintask will not change it.', inbox: '- [ ] Buy milk\n' });
  assert.equal(await page.poll(TEXT('[data-list] strong')), 'Could not open Inbox.md', 'precondition: the read error did not show');
  await page.evaluate('window.__disk.readError = null; window.dispatchEvent(new Event("focus"))');
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk']);
  assert.equal(await page.evaluate('document.querySelector("[data-head] .pt-btn").textContent.trim()'), 'New task N', 'the header should offer New task again');
});

test('a file that stays unreadable is read again on focus, and the same message stays put with the keyboard on its button', { timeout: 60000 }, async t => {
  const page = await openApp(t, { readError: '/Users/test/Tasks/Inbox.md is not UTF-8 text, so Plaintask will not change it.' });
  assert.equal(await page.poll(TEXT('[data-list] strong')), 'Could not open Inbox.md', 'precondition: the read error did not show');
  await page.evaluate('window.__shown = document.querySelector("[data-list] .pt-empty"); document.querySelector("[data-list] .pt-btn").focus()');
  const reads = 'window.__disk.calls.filter(c => c === "read_inbox").length';
  const before = await page.evaluate(reads);
  await page.evaluate('window.dispatchEvent(new Event("focus"))');
  assert.ok(await page.poll(reads, n => n > before), 'focus should read the file again');
  assert.equal(await page.evaluate('document.querySelector("[data-list] .pt-empty") === window.__shown'), true, 'the same message should not be drawn again');
  assert.equal(await page.evaluate(TEXT('[data-list] .pt-btn')), 'Choose another folder');
  assert.equal(await page.evaluate('document.activeElement === document.querySelector("[data-list] .pt-btn")'), true, 'the keyboard should stay on the button');

  await page.evaluate('window.__disk.readError = "/Users/test/Tasks/Inbox.md: Permission denied"; window.dispatchEvent(new Event("focus"))');
  assert.match(await page.poll(TEXT('[data-list] .pt-empty'), s => /Permission denied/.test(s ?? '')), /Permission denied/, 'a different reason should replace the message');
});

test('with no folder chosen, the window regaining focus reads no file', { timeout: 60000 }, async t => {
  const page = await openApp(t, { folder: null });
  assert.equal(await page.poll(TEXT('[data-list] strong')), 'Choose a folder for your tasks', 'precondition: the app did not ask for a folder');
  await page.evaluate('window.dispatchEvent(new Event("focus"))');
  await page.evaluate('new Promise(r => setTimeout(r, 200))');
  assert.deepEqual(await page.evaluate('window.__disk.calls.filter(c => c === "read_inbox")'), []);
  assert.equal(await page.evaluate(TEXT('[data-list] strong')), 'Choose a folder for your tasks');
});

test('a folder choice that cannot be recalled says why and offers the folder panel', { timeout: 60000 }, async t => {
  const page = await openApp(t, { folderError: 'Could not read the folder choice in /Users/test/Library: Permission denied' });
  assert.equal(await page.poll(TEXT('[data-list] strong')), 'Could not open your task folder');
  assert.match(await page.evaluate(TEXT('[data-list] .pt-empty')), /Could not read the folder choice in \/Users\/test\/Library: Permission denied/);
  assert.equal(await page.evaluate(TEXT('[data-list] .pt-btn')), 'Choose folder');
  assert.ok(await page.poll(DRAWN), 'the window should still be asked for, so the message can be seen');
});

test('N opens the new-task form, Return adds the task as the last line of the file and the last row', { timeout: 60000 }, async t => {
  const inbox = '# Inbox\n\n- [ ] Buy milk\n- [x] Done already\n';
  const page = await openApp(t, { inbox });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the first task did not show');
  assert.equal(await page.evaluate('document.querySelector("[data-head] .pt-btn").textContent.trim()'), 'New task N', 'the header\'s button should name the action and its key');
  assert.equal(await page.evaluate(COMPOSER_OPEN), false, 'the form starts closed and out of the Tab order');

  await page.evaluate(press('n'));
  assert.equal(await page.poll(COMPOSER_OPEN), true, 'N should open the form');
  assert.equal(await page.evaluate(FOCUS), 'INPUT[title]', 'the task field should have the keyboard');
  assert.equal(await page.evaluate('document.querySelector("[data-composer] input").placeholder'), 'e.g. Call the tiler');

  await page.evaluate(type('  Order floor tiles  '));
  await page.evaluate(RETURN);
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 1), ['Buy milk', 'Order floor tiles']);
  assert.deepEqual(await page.evaluate(WRITES), [inbox + '- [ ] Order floor tiles\n'], 'the file should gain one line and keep every other byte');
  assert.equal(await page.evaluate(COMPOSER_OPEN), false, 'the form should close after adding');
  assert.equal(await page.evaluate(FOCUS), 'BUTTON in header', 'the keyboard should return to the New task button');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '2');
  assert.equal(await page.evaluate(DOCK), 2, 'the Dock icon should count the added task');
  assert.equal(await page.evaluate('document.querySelector("[data-list] li:last-child .pt-task").classList.contains("is-entering")'), true, 'the new row should play the enter animation');
});

test('the first task added to an empty Inbox replaces the empty state and creates the file', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '' });
  assert.equal(await page.poll(TEXT('[data-list] .pt-empty strong')), 'Inbox zero', 'precondition: the empty state did not show');
  await page.evaluate(click('[data-head] .pt-btn'));
  await page.evaluate(type('Buy milk'));
  await page.evaluate(RETURN);
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk']);
  assert.equal(await page.evaluate('document.querySelector("[data-list] .pt-empty")'), null, 'the empty state should be gone');
  assert.deepEqual(await page.evaluate(WRITES), ['- [ ] Buy milk\n']);
});

test('a file whose first line is --- with no closing --- shows its tasks, and a task added to it shows with no toast', { timeout: 60000 }, async t => {
  const inbox = '---\n- [ ] Buy milk\n- [ ] Call the tiler\n';
  const page = await openApp(t, { inbox });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk', 'Call the tiler'], 'a --- that never closes is a rule, so the tasks below it are rows');
  await page.evaluate(press('n'));
  await page.evaluate(type('New one'));
  await page.evaluate(RETURN);
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 2), ['Buy milk', 'Call the tiler', 'New one']);
  assert.deepEqual(await page.evaluate(WRITES), [inbox + '- [ ] New one\n']);
  assert.deepEqual(await page.evaluate('[...document.querySelectorAll("[data-toasts] .pt-toast")].map(e => e.textContent)'), [], 'adding a task that shows needs no toast');
});

test('a task added with the title of a task already listed plays the enter animation on the new row only', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n- [ ] Call the tiler\n' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk', 'Call the tiler'], 'precondition: the tasks did not show');
  await page.evaluate(press('n'));
  await page.evaluate(type('Buy milk'));
  await page.evaluate(RETURN);
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 2), ['Buy milk', 'Call the tiler', 'Buy milk']);
  assert.deepEqual(await page.evaluate('[...document.querySelectorAll("[data-list] .pt-task")].map(e => e.classList.contains("is-entering"))'), [false, false, true]);
  assert.deepEqual(await page.evaluate('[...document.querySelectorAll("[data-toasts] .pt-toast")].map(e => e.textContent)'), []);
});

test('Return with no title keeps the form open, says what to do and writes nothing', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.ok(await page.poll(DRAWN), 'precondition: the page never asked for its window');
  await page.evaluate(press('n'));
  await page.evaluate(type('   '));
  await page.evaluate(RETURN);
  assert.equal(await page.poll(TEXT('[data-composer] .pt-error')), 'Give the task a name first.');
  assert.equal(await page.evaluate('document.querySelector("[data-composer] input").getAttribute("aria-invalid")'), 'true');
  assert.equal(await page.evaluate('document.querySelector("[data-composer] form").classList.contains("is-shaking")'), true, 'the form should shake');
  assert.equal(await page.evaluate(COMPOSER_OPEN), true);
  assert.equal(await page.evaluate(FOCUS), 'INPUT[title]');
  assert.deepEqual(await page.evaluate(WRITES), []);

  await page.evaluate(type('B'));
  assert.equal(await page.evaluate(TEXT('[data-composer] .pt-error')), '', 'typing should clear the message');
  assert.equal(await page.evaluate('document.querySelector("[data-composer] input").getAttribute("aria-invalid")'), null);
});

test('Escape and Cancel close the form without adding, and N typed in the field is a letter', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.ok(await page.poll(DRAWN), 'precondition: the page never asked for its window');
  await page.evaluate(press('N'));
  assert.equal(await page.poll(COMPOSER_OPEN), true, 'precondition: N did not open the form');
  await page.evaluate(type('Not yet'));
  assert.equal(await page.evaluate(press('n')), true, 'N pressed in the field should be left to the field (not cancelled)');
  assert.equal(await page.evaluate('document.querySelector("[data-composer] input").value'), 'Not yet', 'the half-typed title should still be there');
  await page.evaluate(press('Escape'));
  assert.equal(await page.poll(COMPOSER_OPEN, open => !open), false, 'Escape should close the form');
  assert.equal(await page.evaluate(FOCUS), 'BUTTON in header');

  await page.evaluate(press('n'));
  assert.equal(await page.evaluate('document.querySelector("[data-composer] input").value'), '', 'the form should open empty the next time');
  await page.evaluate(click('[data-composer] .pt-btn--ghost'));
  assert.equal(await page.poll(COMPOSER_OPEN, open => !open), false, 'Cancel should close the form');
  assert.deepEqual(await page.evaluate(WRITES), []);
  assert.deepEqual(await page.evaluate(ROWS), ['Buy milk']);
});

test('adding a task keeps what another editor wrote to the file since the app last read it', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the first task did not show');
  await page.evaluate('window.__disk.inbox = "# Shopping\\r\\n- [ ] Buy milk\\r\\n- [ ] Typed in Vim\\r\\n"');
  await page.evaluate(press('n'));
  await page.evaluate(type('Added in the app'));
  await page.evaluate(RETURN);
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 2), ['Buy milk', 'Typed in Vim', 'Added in the app']);
  assert.deepEqual(await page.evaluate(WRITES), ['# Shopping\r\n- [ ] Buy milk\r\n- [ ] Typed in Vim\r\n- [ ] Added in the app\r\n']);
});

test('a task that cannot be saved is not shown as added, and a toast says why', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n', writeError: 'Could not save /Users/test/Tasks/Inbox.md: Permission denied' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the first task did not show');
  await page.evaluate(press('n'));
  await page.evaluate(type('Order floor tiles'));
  await page.evaluate(RETURN);
  assert.equal(await page.poll(TEXT('[data-toasts] .pt-toast')), 'Could not save /Users/test/Tasks/Inbox.md: Permission denied');
  assert.deepEqual(await page.evaluate(ROWS), ['Buy milk']);
  assert.equal(await page.evaluate(COMPOSER_OPEN), true, 'the form should stay open with the title, so nothing typed is lost');
  assert.equal(await page.evaluate('document.querySelector("[data-composer] input").value'), 'Order floor tiles');
});

const tick = n => `document.querySelectorAll("[data-list] li:not([data-leaving]) .pt-check")[${n}].click()`;
const STAYING = '[...document.querySelectorAll("[data-list] li:not([data-leaving]) .pt-task__title")].map(e => e.textContent)';
const TOAST = '[...document.querySelectorAll("[data-toasts] .pt-toast")].map(e => e.querySelector("span").textContent)';
const FOCUSED_ROW = 'document.activeElement.closest("[data-list] li")?.querySelector(".pt-task__title").textContent ?? null';
const THREE = '# Inbox\r\n\r\n- [ ] Buy milk\r\n- [ ] Call mum\r\n  - [ ] a subtask the app leaves alone\r\n- [ ] Water plants\r\n';

test('ticking a task changes one character of the file at once, celebrates, folds the row away and offers Undo', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 3), ['Buy milk', 'Call mum', 'Water plants'], 'precondition: the three tasks did not show');

  await page.evaluate(tick(1));
  assert.deepEqual(await page.poll(WRITES, w => w.length > 0), [THREE.replace('- [ ] Call mum', '- [x] Call mum')], 'the file should be saved before the row has folded away, with only the one mark changed');
  assert.deepEqual(await page.evaluate('(row => [row.classList.contains("is-done"), row.querySelector(".pt-check").getAttribute("aria-checked"), row.querySelector(".pt-check").classList.contains("is-celebrating")])(document.querySelectorAll("[data-list] .pt-task")[1])'),
    [true, 'true', true], 'the row should be struck through, its checkbox ticked and celebrating, while it is still on screen');
  assert.deepEqual(await page.evaluate(TOAST), ['Completed: Call mum']);
  assert.equal(await page.evaluate(TEXT('[data-toasts] .pt-toast button')), 'Undo');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '2', 'the count should drop at once');
  assert.equal(await page.evaluate(DOCK), 2, 'the Dock icon count should drop at once');

  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 2), ['Buy milk', 'Water plants'], 'the ticked row should fold away and leave the list');
});

test('Undo puts the task back in its place and restores the file exactly', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(tick(1));
  assert.equal((await page.poll(WRITES, w => w.length === 1)).length, 1, 'precondition: the tick was not saved');

  await page.evaluate(click('[data-toasts] .pt-toast button'));
  assert.deepEqual(await page.poll(STAYING, rows => rows.length === 3), ['Buy milk', 'Call mum', 'Water plants'], 'the task should be back between its neighbours');
  assert.equal(await page.evaluate('window.__disk.inbox'), THREE, 'after Undo the file should be byte for byte what it was');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '3');
  assert.equal(await page.evaluate(DOCK), 3, 'Undo should put the Dock icon count back');
  await new Promise(r => setTimeout(r, 1300));   // longer than the hold and the fold: the cancelled fold must not take the row away after all
  assert.deepEqual(await page.evaluate(ROWS), ['Buy milk', 'Call mum', 'Water plants'], 'the restored row should still be there once the cancelled fold would have finished');
  assert.equal(await page.evaluate('document.querySelectorAll("[data-list] .pt-check")[1].getAttribute("aria-checked")'), 'false');
});

test('a double-click on Undo puts the task back once, and the second click does nothing', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(tick(0));
  assert.equal((await page.poll(WRITES, w => w.length === 1)).length, 1, 'precondition: the tick was not saved');

  await page.evaluate('(b => { b.click(); b.click(); })(document.querySelector("[data-toasts] .pt-toast button"))');
  assert.deepEqual(await page.poll(STAYING, rows => rows.length === 3), ['Buy milk', 'Call mum', 'Water plants'], 'the task should be back');
  await new Promise(r => setTimeout(r, 500));   // longer than the toast's exit: a second Undo would have saved by now
  assert.equal(await page.evaluate('window.__disk.writes.length'), 2, 'the second click should not save again');
  assert.equal(await page.evaluate('window.__disk.inbox'), THREE, 'the task should stay open in the file');
  assert.deepEqual(await page.evaluate(STAYING), ['Buy milk', 'Call mum', 'Water plants'], 'the task should stay on screen');
});

test('a long title with no space wraps inside its row, and its toast fits the window with Undo on screen', { timeout: 60000 }, async t => {
  const long = 'Read https://files.example.com/download/' + 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'.repeat(4);
  const page = await openApp(t, { inbox: '- [ ] ' + long + '\n- [ ] Call the tiler\n' });
  assert.equal((await page.poll(ROWS, rows => rows.length === 2)).length, 2, 'precondition: the two tasks did not show');
  const [title, row] = await page.evaluate('["[data-list] .pt-task__title", "[data-list] .pt-task"].map(s => document.querySelector(s).getBoundingClientRect().right)');
  assert.ok(title <= row, `the title should end inside its row: title right ${title}, row right ${row}`);

  await page.evaluate(tick(0));
  const box = await page.poll('(t => t && [t.getBoundingClientRect().left, t.querySelector("button").getBoundingClientRect().right])(document.querySelector("[data-toasts] .pt-toast"))');
  assert.ok(box[0] >= 0 && box[1] <= 880, `the toast and its Undo button should be inside the 880 px window: left ${box[0]}, Undo right ${box[1]}`);
});

test('ticking the last open task shows the empty state', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [x] Done before\n- [ ] Buy milk\n' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the task did not show');
  await page.evaluate(tick(0));
  assert.equal(await page.poll(TEXT('[data-list] .pt-empty strong')), 'Inbox zero');
  assert.equal(await page.evaluate('window.__disk.inbox'), '- [x] Done before\n- [x] Buy milk\n');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '');
  assert.equal(await page.evaluate(DOCK), 0, 'no open tasks takes the count off the Dock icon');
});

test('j, k and the arrow keys move between rows, Space ticks, and the keyboard lands on the next row', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');

  await page.evaluate(press('j'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Buy milk', 'j with no row focused should go to the first row');
  await page.evaluate(press('ArrowDown'));
  await page.evaluate(press('j'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Water plants');
  await page.evaluate(press('j'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Water plants', 'j on the last row should stay there');
  await page.evaluate(press('k'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Call mum');
  await page.evaluate(press('ArrowUp'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Buy milk');

  await page.evaluate('document.activeElement.click()');   // what Space does on a focused button
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 2), ['Call mum', 'Water plants'], 'precondition: the ticked row did not leave');
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Call mum', 'after the row folds away the keyboard should be on the row that took its place');

  await page.evaluate(press('j'));
  await page.evaluate('document.activeElement.click()');
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 1), ['Call mum'], 'precondition: the second ticked row did not leave');
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Call mum', 'with no row below, the keyboard should move to the row above');
});

const FIELD_FOCUSED = 'document.activeElement === document.querySelector("[data-composer] input")';

test('N pressed while a ticked row folds away keeps the keyboard in the new-task field', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');

  await page.evaluate(press('j'));
  await page.evaluate('document.activeElement.click()');   // what Space does on a focused button
  // N during the fold, which starts 620 ms after the tick and runs 380 ms: the fold notes then that the row had the keyboard
  assert.equal(await page.poll('document.querySelector("[data-list] li.is-leaving") !== null'), true, 'precondition: the ticked row did not start to fold');
  await page.evaluate(press('n'));
  assert.equal(await page.poll(COMPOSER_OPEN), true, 'precondition: N did not open the form');
  assert.equal(await page.evaluate(FIELD_FOCUSED), true, 'precondition: the task field did not get the keyboard');

  // the fold drops the row and moves the keyboard in the same callback
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 2), ['Call mum', 'Water plants'], 'precondition: the ticked row did not leave');
  assert.equal(await page.evaluate(FIELD_FOCUSED), true, 'the fold should not take the keyboard from the task field');
});

test('two tasks ticked one straight after the other are both saved, and a second click on a ticked row does nothing', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate('(checks => { checks[0].click(); checks[0].click(); checks[2].click(); })(document.querySelectorAll("[data-list] .pt-check"))');
  assert.deepEqual(await page.evaluate(TOAST), ['Completed: Buy milk', 'Completed: Water plants']);
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 1), ['Call mum']);
  assert.equal(await page.evaluate('window.__disk.inbox'), THREE.replace('- [ ] Buy milk', '- [x] Buy milk').replace('- [ ] Water plants', '- [x] Water plants'));
  assert.equal(await page.evaluate('window.__disk.writes.length'), 2, 'the second click on the first row should not save again');
});

test('three tasks ticked in a row each keep their Undo, and the first can still be undone', { timeout: 60000 }, async t => {
  const FOUR = '- [ ] Buy milk\n- [ ] Call mum\n- [ ] Water plants\n- [ ] Rake leaves\n';
  const page = await openApp(t, { inbox: FOUR });
  assert.equal((await page.poll(ROWS, rows => rows.length === 4)).length, 4, 'precondition: the four tasks did not show');
  await page.evaluate('(checks => { checks[0].click(); checks[1].click(); checks[2].click(); })(document.querySelectorAll("[data-list] .pt-check"))');
  assert.deepEqual(await page.evaluate(TOAST), ['Completed: Buy milk', 'Completed: Call mum', 'Completed: Water plants'], 'a third tick should not take the first Undo away');
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 1), ['Rake leaves'], 'precondition: the ticked rows did not fold away');

  await page.evaluate(click('[data-toasts] .pt-toast button'));
  assert.deepEqual(await page.poll(STAYING, rows => rows.length === 2), ['Buy milk', 'Rake leaves'], 'Undo on the first toast should bring back the first task');
  assert.equal(await page.evaluate('window.__disk.inbox'), FOUR.replace('- [ ] Call mum', '- [x] Call mum').replace('- [ ] Water plants', '- [x] Water plants'));
});

test('a stack of toasts taller than the window stays inside it, and the oldest Undo can be scrolled to and clicked', { timeout: 60000 }, async t => {
  const MANY = Array.from({ length: 15 }, (_, i) => '- [ ] Task ' + (i + 1) + '\n').join('');
  const page = await openApp(t, { inbox: MANY });
  assert.equal((await page.poll(ROWS, rows => rows.length === 15)).length, 15, 'precondition: the fifteen tasks did not show');
  await page.evaluate('(checks => { for (let i = 0; i < 14; i++) checks[i].click(); })(document.querySelectorAll("[data-list] .pt-check"))');
  assert.equal((await page.evaluate(TOAST)).length, 14, 'precondition: fourteen ticks should leave fourteen toasts');
  assert.deepEqual(await page.evaluate('(h => [h.scrollHeight > h.clientHeight, h.getBoundingClientRect().top >= 0, h.getBoundingClientRect().bottom <= innerHeight])(document.querySelector("[data-toasts]"))'),
    [true, true, true], 'the stack should scroll inside the window, not run off its top');
  assert.ok(await page.evaluate('(h => h.lastElementChild.getBoundingClientRect().bottom <= h.getBoundingClientRect().bottom + 1)(document.querySelector("[data-toasts]"))'), 'the newest toast should be in view');

  const reachable = '(b => { b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; })(document.querySelector("[data-toasts] .pt-toast button"))';
  assert.ok(await page.evaluate(reachable), 'the oldest toast\'s Undo should be on screen and under the pointer once scrolled to');
  await page.evaluate(click('[data-toasts] .pt-toast button'));
  assert.ok((await page.poll(STAYING, rows => rows.includes('Task 1'))).includes('Task 1'), 'Undo on the oldest toast should bring back the first task');
});

test('the mouse wheel scrolls a tall toast stack, and the oldest Undo can then be clicked where it is drawn', { timeout: 60000 }, async t => {
  const MANY = Array.from({ length: 15 }, (_, i) => '- [ ] Task ' + (i + 1) + '\n').join('');
  const page = await openApp(t, { inbox: MANY });
  assert.equal((await page.poll(ROWS, rows => rows.length === 15)).length, 15, 'precondition: the fifteen tasks did not show');
  await page.evaluate('(checks => { for (let i = 0; i < 14; i++) checks[i].click(); })(document.querySelectorAll("[data-list] .pt-check"))');
  assert.ok(await page.poll('(h => h.scrollHeight > h.clientHeight && h.scrollTop > 0)(document.querySelector("[data-toasts]"))'), 'precondition: the stack should overflow and show its newest toast');
  assert.equal((await page.poll(ROWS, rows => rows.length === 1)).length, 1, 'precondition: the ticked rows did not fold away');

  assert.equal(await page.evaluate('(c => { const r = c.getBoundingClientRect(); return c.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })(document.querySelector("[data-list] li:not([data-leaving]) .pt-check"))'), true,
    'the checkbox of the row left beside the stack should still be under the pointer');

  // the wheel turned over the gap between two toasts, where nothing but the host is drawn
  const gap = await page.evaluate('(ts => { const a = ts[ts.length - 2].getBoundingClientRect(), b = ts[ts.length - 1].getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round((a.bottom + b.top) / 2)]; })(document.querySelectorAll("[data-toasts] .pt-toast"))');
  await page.mouse.wheel(gap[0], gap[1], -2000);
  assert.deepEqual(await page.poll('(h => [h.scrollTop, h.children.length])(document.querySelector("[data-toasts]"))', ([top]) => top === 0), [0, 14],
    'the wheel should scroll the stack to its oldest toast while all fourteen are still up');

  const undo = await page.evaluate('(r => [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)])(document.querySelector("[data-toasts] .pt-toast button").getBoundingClientRect())');
  await page.mouse.click(undo[0], undo[1]);
  assert.ok((await page.poll(STAYING, rows => rows.includes('Task 1'))).includes('Task 1'), 'a click on the oldest Undo should bring back the first task');
});

test('a tall toast stack with a long title stays inside the window, with every Undo inside it', { timeout: 60000 }, async t => {
  const long = 'Read https://files.example.com/download/' + 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'.repeat(4);
  const MANY = '- [ ] ' + long + '\n' + Array.from({ length: 14 }, (_, i) => '- [ ] Task ' + (i + 2) + '\n').join('');
  const page = await openApp(t, { inbox: MANY });
  assert.equal((await page.poll(ROWS, rows => rows.length === 15)).length, 15, 'precondition: the fifteen tasks did not show');
  await page.evaluate('(checks => { for (let i = 0; i < 14; i++) checks[i].click(); })(document.querySelectorAll("[data-list] .pt-check"))');
  assert.ok(await page.poll('(h => h.classList.contains("is-scrolling"))(document.querySelector("[data-toasts]"))'), 'precondition: the stack should overflow');
  const edges = await page.evaluate('(h => [h.getBoundingClientRect().left, h.getBoundingClientRect().right, ...[...h.querySelectorAll(".pt-toast button")].map(b => b.getBoundingClientRect().right)])(document.querySelector("[data-toasts]"))');
  assert.ok(edges.every(x => x >= 0 && x <= 880), `the stack and every Undo should be inside the 880 px window: ${edges.join(', ')}`);
});

test('with one toast up, a click on the list beside it still reaches the list', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(tick(0));
  assert.equal((await page.poll(TOAST, toasts => toasts.length === 1)).length, 1, 'precondition: the tick showed no toast');
  assert.equal(await page.poll('(h => { const r = h.getBoundingClientRect(); return document.elementFromPoint(r.x + 10, r.y + r.height / 2) === h; })(document.querySelector("[data-toasts]"))', hit => !hit), false,
    'the host beside a single toast should let the pointer through to the list');
});

test('ticking a task another editor has deleted says so and shows the file as it is', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate('window.__disk.inbox = "- [ ] Buy milk\\n- [ ] Something new\\n"');
  await page.evaluate(tick(1));
  assert.deepEqual(await page.poll(STAYING, rows => rows.includes('Something new')), ['Buy milk', 'Something new'], 'the list should be redrawn from the file');
  assert.ok((await page.evaluate(TOAST)).includes('"Call mum" is no longer in the file.'), 'a toast should say the task is gone');
  assert.deepEqual(await page.evaluate(WRITES), [], 'nothing should be written');
});

test('ticking a task in a file another editor has changed shows the file\'s other changes too', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate('window.__disk.inbox = "- [ ] Buy milk\\n- [ ] Something new\\n- [ ] Water plants\\n"');
  await page.evaluate(tick(0));
  // Both lists are read in one step, so no time passes between them in which the ticked row could finish folding.
  const drawn = await page.poll(`({ staying: ${STAYING}, all: ${ROWS} })`, lists => lists.staying.includes('Something new'));
  assert.deepEqual(drawn.staying, ['Something new', 'Water plants'], 'the list should show the task added elsewhere and not the one deleted elsewhere');
  assert.ok(drawn.all.includes('Buy milk'), 'the ticked row should still be folding away, not taken off early');
  assert.equal(await page.evaluate('window.__disk.inbox'), '- [x] Buy milk\n- [ ] Something new\n- [ ] Water plants\n');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '2');
  assert.equal(await page.evaluate(DOCK), 2);
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 2), ['Something new', 'Water plants'], 'the ticked row should fold away');
});

test('a tick that cannot be saved says why and puts the row back unticked', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE, writeError: 'Could not save /Users/test/Tasks/Inbox.md: Permission denied' });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(tick(0));
  assert.ok((await page.poll(TOAST, toasts => toasts.length > 1)).includes('Could not save /Users/test/Tasks/Inbox.md: Permission denied'));
  assert.deepEqual(await page.evaluate(STAYING), ['Buy milk', 'Call mum', 'Water plants']);
  assert.equal(await page.evaluate('document.querySelector("[data-list] .pt-check").getAttribute("aria-checked")'), 'false');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '3');
});

const RENAME = '[data-list] input.app__rename';
const renameTo = text => `(() => { const field = document.querySelector(${js(RENAME)}); field.value = ${js(text)}; field.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const doubleClick = selector => `document.querySelector(${js(selector)}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`;
const EDITING = `document.querySelector(${js(RENAME)}) !== null`;

test('Return on a focused row edits its title in place, and Return again saves only the title', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(press('j'));
  await page.evaluate(press('j'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Call mum', 'precondition: the second row does not have the keyboard');

  assert.equal(await page.evaluate(press('Enter')), false, 'Return on a row should be taken by the app, so it does not press the checkbox and tick the task');
  assert.equal(await page.poll(EDITING), true, 'Return should open a field for the title');
  assert.deepEqual(await page.evaluate(`(f => [f.value, f.selectionStart, f.selectionEnd, document.activeElement === f, f.getAttribute('aria-label')])(document.querySelector(${js(RENAME)}))`),
    ['Call mum', 0, 8, true, 'Rename: Call mum'], 'the field should hold the title, all selected, with the keyboard in it');
  assert.equal(await page.evaluate('getComputedStyle(document.querySelectorAll("[data-list] .pt-task__title")[1]).display'), 'none', 'the field replaces the title while it is open');

  await page.evaluate(renameTo('  Call mum about Sunday  '));
  await page.evaluate(press('Enter'));
  assert.deepEqual(await page.poll(ROWS, rows => rows[1] !== 'Call mum'), ['Buy milk', 'Call mum about Sunday', 'Water plants']);
  assert.deepEqual(await page.evaluate(WRITES), [THREE.replace('- [ ] Call mum', '- [ ] Call mum about Sunday')], 'only the title should change in the file');
  assert.equal(await page.evaluate(EDITING), false, 'the field should close');
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Call mum about Sunday', 'the keyboard should be back on the renamed row');
  assert.equal(await page.evaluate('document.querySelectorAll("[data-list] .pt-check")[1].getAttribute("aria-label")'), 'Complete: Call mum about Sunday');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '3');
  assert.deepEqual(await page.evaluate(TOAST), [], 'a rename leaves the task in view, so there is no toast');
});

test('a double-click on a title edits it, and Escape leaves the task as it was', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(doubleClick('[data-list] li:nth-child(3) .pt-task__title'));
  assert.equal(await page.poll(EDITING), true, 'a double-click on the title should open the field');
  assert.equal(await page.evaluate(`document.querySelector(${js(RENAME)}).value`), 'Water plants');

  await page.evaluate(renameTo('Something else entirely'));
  assert.equal(await page.evaluate(press('j')), true, 'j typed in the field is a letter, not a move to the next row');
  await page.evaluate(press('Escape'));
  assert.equal(await page.poll(EDITING, editing => !editing), false, 'Escape should close the field');
  assert.deepEqual(await page.evaluate(ROWS), ['Buy milk', 'Call mum', 'Water plants']);
  assert.deepEqual(await page.evaluate(WRITES), [], 'nothing should be written');
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Water plants', 'the keyboard should be back on the row');
});

test('Return on an empty title keeps the field open and marks it; leaving the field empty puts the old title back', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('   '));
  await page.evaluate(press('Enter'));
  assert.equal(await page.evaluate(EDITING), true, 'an empty title should not be saved, and what was typed should not be thrown away');
  assert.equal(await page.evaluate(`document.querySelector(${js(RENAME)}).getAttribute('aria-invalid')`), 'true');
  assert.equal(await page.evaluate('document.querySelector("[data-list] .pt-task").classList.contains("is-shaking")'), true, 'the row should shake');

  await page.evaluate(renameTo('B'));
  assert.equal(await page.evaluate(`document.querySelector(${js(RENAME)}).getAttribute('aria-invalid')`), null, 'typing should clear the mark');
  await page.evaluate(renameTo(''));
  await page.evaluate('document.activeElement.blur()');
  assert.equal(await page.poll(EDITING, editing => !editing), false, 'leaving the field should close it');
  assert.deepEqual(await page.evaluate(ROWS), ['Buy milk', 'Call mum', 'Water plants']);
  assert.deepEqual(await page.evaluate(WRITES), []);
});

test('clicking away from the field saves a changed title, and an unchanged title writes nothing', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(press('Enter'));
  assert.equal(await page.poll(EDITING, editing => !editing), false, 'Return on an unchanged title should close the field');
  assert.deepEqual(await page.evaluate(WRITES), [], 'an unchanged title should not be saved');

  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('Buy oat milk'));
  await page.evaluate('document.activeElement.blur()');
  assert.deepEqual(await page.poll(ROWS, rows => rows[0] !== 'Buy milk'), ['Buy oat milk', 'Call mum', 'Water plants']);
  assert.deepEqual(await page.evaluate(WRITES), [THREE.replace('- [ ] Buy milk', '- [ ] Buy oat milk')]);
});

test('renaming keeps what another editor wrote, and a task deleted elsewhere says so', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n- [ ] Call mum\n' });
  assert.equal((await page.poll(ROWS, rows => rows.length === 2)).length, 2, 'precondition: the two tasks did not show');
  await page.evaluate('window.__disk.inbox = "# Shopping\\n- [ ] Buy milk\\n- [ ] Typed in Vim\\n"');
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('Buy oat milk'));
  await page.evaluate(press('Enter'));
  assert.deepEqual(await page.poll(ROWS, rows => rows.includes('Typed in Vim')), ['Buy oat milk', 'Typed in Vim'], 'the list should show the file as it now is');
  assert.deepEqual(await page.evaluate(WRITES), ['# Shopping\n- [ ] Buy oat milk\n- [ ] Typed in Vim\n']);

  await page.evaluate('window.__disk.inbox = "- [ ] Typed in Vim\\n"');
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('Buy soya milk'));
  await page.evaluate(press('Enter'));
  assert.ok((await page.poll(TOAST, toasts => toasts.length > 0)).includes('"Buy oat milk" is no longer in the file.'));
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 1), ['Typed in Vim']);
  assert.equal((await page.evaluate(WRITES)).length, 1, 'the failed rename should write nothing');
});

test('a row whose title is being edited cannot be ticked by a click on its checkbox', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('Buy oat milk'));
  await page.evaluate('document.querySelector("[data-list] .pt-check").click()');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await page.evaluate('window.__disk.inbox.includes("[x]")'), false, 'the click should not tick the task while its title is open');
  assert.deepEqual(await page.evaluate(TOAST), []);
});

test('ticking another task while a title is open saves both, and the ticked row stays gone', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('Buy oat milk'));
  // A real click on another checkbox blurs the field on mouse down, before the click itself.
  await page.evaluate('document.activeElement.blur(); document.querySelectorAll("[data-list] .pt-check")[2].click()');
  const both = THREE.replace('- [ ] Buy milk', '- [ ] Buy oat milk').replace('- [ ] Water plants', '- [x] Water plants');
  assert.equal(await page.poll('window.__disk.inbox', inbox => inbox === both), both, 'the file should hold the new title and the tick');
  assert.deepEqual(await page.evaluate(STAYING), ['Buy oat milk', 'Call mum'], 'the ticked row should not be drawn again as open');
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 2), ['Buy oat milk', 'Call mum'], 'the ticked row should fold away');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '2');
  assert.equal(await page.evaluate(DOCK), 2);
});

/** Holds each save until the test lets it through, so a test can click while one is on its way to the file. */
const HOLD_WRITES = `(() => { const invoke = window.__TAURI_INTERNALS__.invoke; window.__held = [];
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'write_inbox') await new Promise(go => window.__held.push(go));
    return invoke(command, args);
  }; })()`;
const HELD = 'window.__held.length';
const LET_ONE_THROUGH = 'window.__held.shift()()';

test('ticks clicked while a rename and another tick are saving, then a reread, leave the list matching the file', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(HOLD_WRITES);
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('Buy oat milk'));
  await page.evaluate('document.activeElement.blur(); document.querySelectorAll("[data-list] .pt-check")[2].click()');
  assert.equal(await page.poll(HELD, n => n === 1), 1, 'precondition: the rename is not on its way to the file');
  await page.evaluate(LET_ONE_THROUGH);
  assert.equal(await page.poll(HELD, n => n === 1), 1, 'precondition: the first tick is not on its way to the file');
  // The rename's save is done and the first tick's is in flight: tick a third row now.
  await page.evaluate('document.querySelectorAll("[data-list] li:not([data-leaving]) .pt-check")[1].click()');
  await page.evaluate(LET_ONE_THROUGH);
  assert.equal(await page.poll(HELD, n => n === 1), 1, 'precondition: the second tick is not on its way to the file');
  await page.evaluate(LET_ONE_THROUGH);
  const all = THREE.replace('- [ ] Buy milk', '- [ ] Buy oat milk').replace('- [ ] Call mum', '- [x] Call mum').replace('- [ ] Water plants', '- [x] Water plants');
  assert.equal(await page.poll('window.__disk.inbox', inbox => inbox === all), all, 'the file should hold the new title and both ticks');
  assert.deepEqual(await page.poll(STAYING, rows => rows.length === 1), ['Buy oat milk'], 'neither ticked row should be drawn again as open');

  await page.evaluate('window.__disk.inbox += "- [ ] Typed in Vim\\r\\n"; window.dispatchEvent(new Event("focus"))');
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 2), ['Buy oat milk', 'Typed in Vim'], 'the reread should leave the screen showing the file\'s open tasks');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '2');
  assert.equal(await page.evaluate(DOCK), 2);
});

test('an Undo saved while the file stops being readable leaves the reason on screen, not a list', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(tick(1));
  assert.equal((await page.poll(WRITES, w => w.length === 1)).length, 1, 'precondition: the tick was not saved');
  await page.evaluate(HOLD_WRITES);
  await page.evaluate(click('[data-toasts] .pt-toast button'));
  assert.equal(await page.poll(HELD, n => n === 1), 1, 'precondition: the Undo is not on its way to the file');
  // The reread waits in the queue behind the Undo's save, so it fails after the save and before the Undo draws.
  await page.evaluate('window.__disk.readError = "Could not read /Users/test/Tasks/Inbox.md: Permission denied"; window.dispatchEvent(new Event("focus"))');
  await page.evaluate(LET_ONE_THROUGH);
  assert.equal(await page.poll('window.__disk.inbox', inbox => inbox === THREE), THREE, 'the Undo should still be saved');
  assert.equal(await page.poll(TEXT('[data-list] .pt-empty strong'), s => s !== null), 'Could not open Inbox.md', 'the failed reread should say why');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await page.evaluate(TEXT('[data-list] .pt-empty strong')), 'Could not open Inbox.md', 'the Undo should not draw a list over the reason');
  assert.deepEqual(await page.evaluate(ROWS), []);
  assert.deepEqual((await page.evaluate(TOAST)).filter(s => !s.startsWith('Completed')), [], 'no error toast should follow');
});

// specs/DesktopSession.tla found the next two: a read queued before an edit comes back after the person has acted.
const FAIL_NEXT_READ = `(() => { const invoke = window.__TAURI_INTERNALS__.invoke; let failed = false;
  window.__TAURI_INTERNALS__.invoke = (command, args) => {
    if (command === 'read_inbox' && !failed) { failed = true; return Promise.reject('Could not read /Users/test/Tasks/Inbox.md: Permission denied'); }
    return invoke(command, args);
  }; })()`;

test('a rename saved after a reread queued before it failed leaves the reason on screen, not a list', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  // One task: the reread is queued first and fails; the rename's save comes after it and succeeds.
  await page.evaluate(`${FAIL_NEXT_READ}; window.dispatchEvent(new Event("focus"));
    ${doubleClick('[data-list] li:nth-child(1) .pt-task__title')}; ${renameTo('Buy oat milk')}; ${press('Enter')}`);
  const renamed = THREE.replace('- [ ] Buy milk', '- [ ] Buy oat milk');
  assert.equal(await page.poll('window.__disk.inbox', inbox => inbox === renamed), renamed, 'the rename should still be saved');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await page.evaluate(TEXT('[data-list] .pt-empty strong')), 'Could not open Inbox.md', 'the rename should not draw a list over the reason');
  assert.deepEqual(await page.evaluate(ROWS), []);

  await page.evaluate('window.dispatchEvent(new Event("focus"))');
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 3), ['Buy oat milk', 'Call mum', 'Water plants'], 'the next reread should draw the file');
  assert.equal(await page.evaluate('document.querySelector("[data-head] .pt-btn")?.textContent.trim()'), 'New task N', 'the header should offer New task again');
});

test('a title being edited when a reread finds the folder gone closes, and the window still rereads on focus', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(`window.__disk.gone = true; window.dispatchEvent(new Event("focus")); ${doubleClick('[data-list] li:nth-child(2) .pt-task__title')}`);
  assert.equal(await page.poll(TEXT('[data-list] .pt-empty strong'), s => s !== null), 'Your task folder cannot be found');
  assert.equal(await page.evaluate(EDITING), false, 'no title field should be left open');

  await page.evaluate('window.__disk.gone = false; window.dispatchEvent(new Event("focus"))');
  assert.deepEqual(await page.poll(ROWS, rows => rows.length === 3), ['Buy milk', 'Call mum', 'Water plants'], 'focus should read the file again');
  await page.evaluate(doubleClick('[data-list] li:nth-child(2) .pt-task__title'));
  assert.equal(await page.poll(EDITING), true, 'a title should open for editing again');
  assert.deepEqual(await page.evaluate(WRITES), [], 'nothing should have been written');
});

test('a rename and a tick that cannot be saved say why and leave the list as the file is', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: THREE, writeError: 'Could not save /Users/test/Tasks/Inbox.md: Permission denied' });
  assert.equal((await page.poll(ROWS, rows => rows.length === 3)).length, 3, 'precondition: the three tasks did not show');
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('Buy oat milk'));
  await page.evaluate('document.activeElement.blur(); document.querySelectorAll("[data-list] .pt-check")[2].click()');
  assert.equal((await page.poll(TOAST, toasts => toasts.filter(s => s.startsWith('Could not save')).length === 2)).filter(s => s.startsWith('Could not save')).length, 2, 'both failed saves should say why');
  assert.deepEqual(await page.poll(STAYING, rows => rows.length === 3), ['Buy milk', 'Call mum', 'Water plants']);
  assert.equal(await page.evaluate('document.querySelectorAll("[data-list] .pt-check")[2].getAttribute("aria-checked")'), 'false');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '3');
  assert.equal(await page.evaluate('window.__disk.inbox'), THREE);
});

test('a right-click shows no web page menu on the window, and the usual menu in the task field', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the task did not show');
  const rightClick = selector => `document.querySelector(${js(selector)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`;
  assert.equal(await page.evaluate(rightClick('[data-list] .pt-task')), false, 'a right-click on a row should be cancelled');
  await page.evaluate(press('n'));
  assert.equal(await page.evaluate(rightClick('[data-composer] input')), true, 'a right-click in the task field should be left alone');
});

/** A long Inbox: `n` open tasks named "Task 0" to "Task n-1". */
const LONG = n => Array.from({ length: n }, (_, i) => '- [ ] Task ' + i).join('\n') + '\n';
const DRAWN_ROWS = 'document.querySelectorAll("[data-list] li").length';
const SCROLL = '[data-scroll]';
/** Scrolls the list to `top` px (or to its end when 'end'), as the wheel or the scroll bar would. */
const scrollList = top => `(s => { s.scrollTop = ${top === 'end' ? 's.scrollHeight' : top}; })(document.querySelector(${js(SCROLL)}))`;
/** Whether the element is drawn inside the list's scroll view, not under its top or bottom edge. */
const inView = selector => `(e => { const v = document.querySelector(${js(SCROLL)}).getBoundingClientRect(), r = e.getBoundingClientRect(); return r.top >= v.top - 1 && r.bottom <= v.bottom + 1; })(${selector})`;

test('a long Inbox draws only the rows near the view, and scrolling draws the rows that come into it', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: LONG(2000) });
  assert.equal(await page.poll(TEXT('[data-badge="inbox"]'), s => s === '2000'), '2000', 'precondition: the sidebar did not count the 2,000 tasks');
  assert.equal((await page.evaluate(ROWS))[0], 'Task 0');
  assert.ok(await page.evaluate(DRAWN_ROWS) <= 80, 'only the rows near the view should be drawn');
  const [height, view] = await page.evaluate(`(s => [s.scrollHeight, s.clientHeight])(document.querySelector(${js(SCROLL)}))`);
  assert.ok(height > 2000 * 30, 'the list should scroll as far as 2,000 rows reach, not only as far as the drawn ones');
  assert.ok(view < height, 'precondition: the list does not scroll');

  await page.evaluate(scrollList('end'));
  assert.equal((await page.poll(ROWS, rows => rows.at(-1) === 'Task 1999')).at(-1), 'Task 1999', 'scrolled to its end, the list should draw its last task');
  assert.ok(await page.evaluate(inView('document.querySelector("[data-list] li:last-child")')), 'the last task should be in view');
  assert.ok(await page.evaluate(DRAWN_ROWS) <= 80, 'the rows scrolled past should no longer be drawn');

  await page.evaluate(scrollList(Math.round(height / 2)));
  const middle = await page.poll(ROWS, rows => !rows.includes('Task 1999') && !rows.includes('Task 0'));
  const at = Number(middle[0].slice(5));
  assert.ok(at > 800 && at < 1200, 'halfway down, the list should draw the tasks halfway through the file, not ' + middle[0]);
  assert.deepEqual(middle, Array.from({ length: middle.length }, (_, i) => 'Task ' + (at + i)), 'the drawn rows should be one run of tasks in file order');
});

test('in a long Inbox, j moves the keyboard past the rows drawn so far and the list scrolls to keep it in view', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: LONG(300) });
  assert.equal(await page.poll(TEXT('[data-badge="inbox"]'), s => s === '300'), '300', 'precondition: the 300 tasks did not show');
  await page.evaluate(press('j'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Task 0');
  for (let i = 0; i < 150; i++) await page.evaluate(press('j'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Task 150');
  assert.ok(await page.evaluate(inView('document.activeElement')), 'the row with the keyboard should be in view');
  for (let i = 0; i < 20; i++) await page.evaluate(press('k'));
  assert.equal(await page.evaluate(FOCUSED_ROW), 'Task 130');
  assert.ok(await page.evaluate(inView('document.activeElement')), 'the row with the keyboard should still be in view');
});

test('a task added to a long Inbox shows as its last row, scrolled into view', { timeout: 60000 }, async t => {
  const inbox = LONG(2000);
  const page = await openApp(t, { inbox });
  assert.equal(await page.poll(TEXT('[data-badge="inbox"]'), s => s === '2000'), '2000', 'precondition: the 2,000 tasks did not show');
  await page.evaluate(press('n'));
  await page.evaluate(type('Order floor tiles'));
  await page.evaluate(RETURN);
  assert.equal((await page.poll(ROWS, rows => rows.at(-1) === 'Order floor tiles')).at(-1), 'Order floor tiles');
  assert.deepEqual(await page.evaluate(WRITES), [inbox + '- [ ] Order floor tiles\n']);
  assert.ok(await page.evaluate(inView('document.querySelector("[data-list] li:last-child")')), 'the new row should be in view');
  assert.equal(await page.evaluate('document.querySelector("[data-list] li:last-child .pt-task").classList.contains("is-entering")'), true, 'the new row should play the enter animation');
  assert.equal(await page.evaluate(TEXT('[data-badge="inbox"]')), '2001');
});

test('a title being edited is saved when its row is scrolled out of the list', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: LONG(2000) });
  assert.equal(await page.poll(TEXT('[data-badge="inbox"]'), s => s === '2000'), '2000', 'precondition: the 2,000 tasks did not show');
  await page.evaluate(doubleClick('[data-list] li:nth-child(1) .pt-task__title'));
  await page.evaluate(renameTo('Task zero'));
  await page.evaluate(scrollList('end'));
  assert.equal((await page.poll(WRITES, w => w.length > 0))[0]?.split('\n')[0], '- [ ] Task zero', 'leaving the field by scrolling its row away should save the title, as clicking away does');
  assert.equal(await page.evaluate(EDITING), false);
  await page.evaluate(scrollList(0));
  assert.equal((await page.poll(ROWS, rows => rows[0] === 'Task zero'))[0], 'Task zero', 'scrolled back, the row should show the new title');
});

test('in a 10,000-task Inbox, adding a task and ticking one each take under 16 ms from the key press to the list changing', { timeout: 120000, skip: !process.env.PLAINTASK_PERF && 'run pnpm test:perf for the speed budget: it runs one test file at a time, so no other test shares the CPU' }, async t => {
  const inbox = Array.from({ length: 10000 }, (_, i) => '- [ ] Task number ' + i).join('\n') + '\n';
  const page = await openApp(t, { inbox });
  assert.equal(await page.poll(TEXT('[data-badge="inbox"]'), s => s === '10000'), '10000', 'precondition: the 10,000 tasks did not show');
  const median = async name => { const d = await page.evaluate(`performance.getEntriesByName(${js(name)}).map(e => e.duration).sort((a, b) => a - b)`); return d[Math.floor(d.length / 2)]; };

  for (let i = 0; i < 7; i++) {
    await page.evaluate(press('n'));
    await page.evaluate(type('Speed test ' + i));
    await page.evaluate(RETURN);
    assert.equal(await page.poll('performance.getEntriesByName("plaintask:add").length', n => n > i), i + 1, 'precondition: add number ' + i + ' did not finish');
  }
  // ticks in the middle of the file: scroll halfway, then click the middle drawn row each time
  await page.evaluate(scrollList(`s.scrollHeight / 2`));
  await page.poll(ROWS, rows => rows.some(r => /^Task number 5\d\d\d$/.test(r)));
  const MIDDLE = '(c => c[c.length >> 1].click())(document.querySelectorAll("[data-list] li:not([data-leaving]) .pt-check"))';
  for (let i = 0; i < 7; i++) await page.evaluate(MIDDLE);
  const add = await median('plaintask:add'), ticked = await median('plaintask:tick');
  console.log('10,000 tasks: add median ' + add.toFixed(1) + ' ms, tick median ' + ticked.toFixed(1) + ' ms');
  assert.ok(add <= 16, 'adding took a median of ' + add.toFixed(1) + ' ms; the budget is 16 ms');
  assert.ok(ticked <= 16, 'ticking took a median of ' + ticked.toFixed(1) + ' ms; the budget is 16 ms');
});

const UPDATE_TOAST = '[data-toasts] .pt-toast[data-update]:not(.is-leaving)';
const UPDATE_TOASTS = `document.querySelectorAll(${js(UPDATE_TOAST)}).length`;
const CALLS = command => `window.__disk.calls.filter(c => c === ${js(command)}).length`;

test('an update the check finds is offered in a toast that stays; Update opens the update window', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the Inbox did not show');
  assert.ok(await page.evaluate('window.__disk.calls.indexOf("plugin:event|listen") < window.__disk.calls.indexOf("ready")'), 'the window should listen for updates before it says it is ready, which starts the checks');
  await page.evaluate('window.__emit("update-available", "0.3.0")');
  assert.equal(await page.poll(TEXT(UPDATE_TOAST + ' span')), 'Plaintask 0.3.0 is available');
  await page.evaluate('window.__emit("update-available", "0.3.0")');
  assert.equal(await page.evaluate(UPDATE_TOASTS), 1, 'a second check that finds the same version should not add a second toast');
  await new Promise(resolve => setTimeout(resolve, 5600));
  assert.equal(await page.evaluate(UPDATE_TOASTS), 1, 'the toast should still show after the 5 s other toasts last');
  await page.evaluate(click(UPDATE_TOAST + ' button:not(.app__toast-close)'));
  assert.equal(await page.poll(CALLS('check_for_updates'), n => n === 1), 1, 'Update should open the update window');
  assert.equal(await page.evaluate(UPDATE_TOASTS), 0, 'the toast should go once Update is clicked');
});

test('a closed update toast comes back with the next check that finds the update', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.ok(await page.poll(DRAWN), 'precondition: the page never asked for its window');
  await page.evaluate('window.__emit("update-available", "0.3.0")');
  assert.equal(await page.poll(UPDATE_TOASTS, n => n === 1), 1, 'precondition: no update toast');
  await page.evaluate(click(UPDATE_TOAST + ' .app__toast-close'));
  assert.equal(await page.evaluate(UPDATE_TOASTS), 0, 'Close should take the toast away');
  assert.equal(await page.evaluate(CALLS('check_for_updates')), 0, 'Close should not open the update window');
  await page.evaluate('window.__emit("update-available", "0.3.0")');
  assert.equal(await page.poll(UPDATE_TOASTS, n => n === 1), 1, 'the next check should offer it again');
});

test('an installed update restarts the app at once, or waits while the new-task form is open', { timeout: 60000 }, async t => {
  const page = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.deepEqual(await page.poll(ROWS, rows => rows.length > 0), ['Buy milk'], 'precondition: the Inbox did not show');
  await page.evaluate(click('[data-head] .pt-btn'));
  assert.ok(await page.poll(COMPOSER_OPEN), 'precondition: the form did not open');
  await page.evaluate(type('Call mum'));
  await page.evaluate('window.__emit("update-restart", null)');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await page.evaluate(CALLS('restart_for_update')), 0, 'the restart should wait while the form is open');
  await page.evaluate(RETURN);
  assert.equal(await page.poll(CALLS('restart_for_update'), n => n === 1), 1, 'the restart should happen once the task is added and the form closes');
  assert.deepEqual(await page.evaluate(WRITES), ['- [ ] Buy milk\n- [ ] Call mum\n'], 'the task typed before the restart should be saved');

  const closed = await openApp(t, { inbox: '- [ ] Buy milk\n' });
  assert.ok(await closed.poll(DRAWN), 'precondition: the page never asked for its window');
  await closed.evaluate('window.__emit("update-restart", null)');
  assert.equal(await closed.poll('window.__disk.calls.filter(c => c === "restart_for_update").length', n => n === 1), 1, 'with the form closed the restart should happen at once');
});

/** Opens the About window. `checkError` makes opening the update window fail with that message. */
function openAbout(t, { checkError = null } = {}) {
  const standIn = `window.__about = ${js({ checkError, calls: [] })};
    window.__TAURI_INTERNALS__ = {
      invoke: async command => {
        const about = window.__about;
        about.calls.push(command);
        if (command === 'app_version') return '0.2.0';
        if (command === 'check_for_updates') { if (about.checkError) throw about.checkError; return null; }
        throw new Error('the page asked for a command the app does not have: ' + command);
      } };`;
  return openSite(t, 'apps/desktop/dist', 300, 320, { before: standIn, page: 'about.html' });
}
const STATUS = TEXT('[data-status]');
const BUTTON = TEXT('[data-button] .pt-btn');

test('About shows the version, and Check for Updates opens the update window', { timeout: 60000 }, async t => {
  const page = await openAbout(t);
  assert.equal(await page.poll(TEXT('[data-version]')), 'Version 0.2.0');
  assert.equal(await page.evaluate(BUTTON), 'Check for Updates');
  assert.deepEqual(await page.evaluate('window.__about.calls.filter(c => c === "check_for_updates")'), [], 'opening About should not check by itself');
  await page.evaluate(click('[data-button] .pt-btn'));
  assert.equal(await page.poll('window.__about.calls.filter(c => c === "check_for_updates").length', n => n === 1), 1);
  assert.equal(await page.evaluate(STATUS), '');
});

test('About fits its window, with the button and status inside it', { timeout: 60000 }, async t => {
  const page = await openAbout(t, { checkError: 'updates need the built app' });
  assert.equal(await page.poll(TEXT('[data-version]')), 'Version 0.2.0', 'precondition: the version did not show');
  await page.evaluate(click('[data-button] .pt-btn'));
  assert.ok(await page.poll(STATUS, s => s?.startsWith('Could')), 'precondition: the status did not show');
  const bottom = await page.evaluate('Math.ceil(document.querySelector("[data-status]").getBoundingClientRect().bottom)');
  const height = await page.evaluate('window.innerHeight');
  assert.ok(bottom <= height, `the status ends at ${bottom}px, below the ${height}px window`);
});

test('About says why the update window could not open', { timeout: 60000 }, async t => {
  const page = await openAbout(t, { checkError: 'updates need the built app' });
  assert.equal(await page.poll(TEXT('[data-version]')), 'Version 0.2.0', 'precondition: the version did not show');
  await page.evaluate(click('[data-button] .pt-btn'));
  assert.equal(await page.poll(STATUS, s => s?.startsWith('Could')), 'Could not check for updates: updates need the built app');
});
