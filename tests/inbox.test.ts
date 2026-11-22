// inbox.test.ts - the task file rules (apps/desktop/src/inbox.ts): what counts as a task, and that the app's two
// edits (tick a task, add a task) change nothing else in a file a person also edits by hand.
//   node --experimental-strip-types --test "tests/*.test.ts"      (PLAINTASK_PERF=1 also runs the speed budget)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { append, parse, rename, serialize, tasks, toggle } from '../apps/desktop/src/inbox.ts';

const titles = (text: string) => tasks(parse(text)).map(t => (t.done ? 'x ' : '. ') + t.title);
/** the positions at which two strings of the same length differ */
const changed = (a: string, b: string) => { assert.equal(a.length, b.length, 'the two texts differ in length'); return [...a].flatMap((c, i) => (c === b[i] ? [] : [i])); };

const PROJECT_FILE = [
  '---', 'area: Home', 'tags:', '- [ ] not a task, a YAML list item', '---', '',
  '# Kitchen renovation', '', 'Notes about the tiler.', '',
  '- [ ] Order floor tiles due:2026-11-28 #call', '  - [ ] Measure the hallway', '- [x] Call the tiler', '* [ ] Star bullet', '',
  '## Later', '- [ ] Paint the ceiling', '',
].join('\n');

test('a file comes back byte for byte after parse and serialize, whatever is in it', () => {
  const files = {
    'an empty file': '',
    'one line with no newline at the end': '- [ ] Buy milk',
    'a project file with front matter, headings, prose and subtasks': PROJECT_FILE,
    'Windows line endings': '# Inbox\r\n\r\n- [ ] One\r\n- [x] Two\r\n',
    'mixed line endings': '- [ ] One\r\n- [ ] Two\n- [ ] Three\r\n',
    'a byte order mark': '﻿- [ ] One\n',
    'blank lines only': '\n\n\n',
    'accents written as two code points': '- [ ] Café run\n',
  };
  for (const [what, text] of Object.entries(files)) assert.equal(serialize(parse(text)), text, what + ' changed');
});

test('a task is a "- [ ]" or "- [x]" line that starts at the left margin and has a title', () => {
  assert.deepEqual(titles('- [ ] Open\n- [x] Done\n- [X] Done too\n'), ['. Open', 'x Done', 'x Done too']);
  assert.deepEqual(titles('-[ ] no space\n- [] no gap\n- [ ]\n- [ ]   \n  - [ ] indented\n* [ ] star\n+ [ ] plus\n1. [ ] numbered\n'), [],
    'none of these lines is a task, so the app shows none of them');
  assert.deepEqual(titles('- [ ] Order floor tiles due:2026-11-28 #call\n'), ['. Order floor tiles due:2026-11-28 #call'], 'the title is the text as written');
  assert.deepEqual(titles('﻿- [ ] First line after a byte order mark\n'), ['. First line after a byte order mark']);
});

test('lines inside the front matter at the top of a file are never tasks', () => {
  assert.deepEqual(titles(PROJECT_FILE), ['. Order floor tiles due:2026-11-28 #call', 'x Call the tiler', '. Paint the ceiling']);
  assert.deepEqual(titles('---\n- [ ] in a file whose front matter never closes\n'), [], 'front matter with no closing line runs to the end of the file');
  assert.deepEqual(titles('# Inbox\n---\n- [ ] after a rule, not front matter\n'), ['. after a rule, not front matter']);
});

test('ticking a task changes one character of the file and nothing else', () => {
  for (const text of [PROJECT_FILE, PROJECT_FILE.replaceAll('\n', '\r\n'), '﻿- [ ] Order floor tiles due:2026-11-28 #call']) {
    const doc = parse(text);
    const [first] = tasks(doc);
    assert.ok(first, 'precondition: the fixture has a task');
    const ticked = serialize(toggle(doc, first.id));
    const at = changed(text, ticked);
    assert.equal(at.length, 1, 'ticking should change exactly one character; it changed ' + at.length);
    assert.equal(text.charAt(at[0]!) + ticked.charAt(at[0]!), ' x', 'the changed character should go from a space to an x');
    assert.equal(serialize(toggle(parse(ticked), first.id)), text, 'ticking the same task again should restore the file exactly');
  }
});

test('unticking a task written with a capital X leaves a space', () => {
  const doc = parse('- [X] Done\n');
  assert.equal(serialize(toggle(doc, tasks(doc)[0]!.id)), '- [ ] Done\n');
});

test('two tasks with the same title are told apart by their order in the file', () => {
  const text = '- [ ] Water plants\n- [ ] Call mum\n- [ ] Water plants\n';
  const doc = parse(text);
  const [, , second] = tasks(doc);
  assert.equal(serialize(toggle(doc, second!.id)), '- [ ] Water plants\n- [ ] Call mum\n- [x] Water plants\n', 'ticking the second of two same-named tasks should tick the second line');
  const [firstAgain, , secondAgain] = tasks(toggle(doc, second!.id));
  assert.deepEqual([firstAgain!.id, secondAgain!.id], [tasks(doc)[0]!.id, second!.id], 'a task keeps its id when it is ticked');
});

test('a task keeps its id when someone adds lines above it in another editor', () => {
  const before = parse('- [ ] Buy milk\n');
  const id = tasks(before)[0]!.id;
  const after = parse('# Inbox\n\n- [ ] Something new\n- [ ] Buy milk\n');
  assert.equal(serialize(toggle(after, id)), '# Inbox\n\n- [ ] Something new\n- [x] Buy milk\n');
});

test('ticking a task that is no longer in the file fails and names the task', () => {
  const id = tasks(parse('- [ ] Buy milk\n'))[0]!.id;
  assert.throws(() => toggle(parse('- [ ] Something else\n'), id), /Buy milk/);
});

test('a new task goes on its own line at the end of the file, in the file\'s own line endings', () => {
  const add = (text: string, title: string) => serialize(append(parse(text), title));
  assert.equal(add('', 'Buy milk'), '- [ ] Buy milk\n', 'into an empty file');
  assert.equal(add('- [ ] One\n', 'Two'), '- [ ] One\n- [ ] Two\n');
  assert.equal(add('- [ ] One', 'Two'), '- [ ] One\n- [ ] Two\n', 'after a last line that had no newline');
  assert.equal(add('# Inbox\r\n- [ ] One\r\n', 'Two'), '# Inbox\r\n- [ ] One\r\n- [ ] Two\r\n', 'into a file with Windows line endings');
  assert.equal(add('- [ ] One\r\n- [ ] Two', 'Three'), '- [ ] One\r\n- [ ] Two\r\n- [ ] Three\r\n');
  assert.equal(add(PROJECT_FILE, 'Buy grout'), PROJECT_FILE + '- [ ] Buy grout\n', 'everything already in the file stays as it was');
});

test('a new task\'s title is one line with no space around it, and a blank title is refused', () => {
  const add = (title: string) => serialize(append(parse(''), title));
  assert.equal(add('  Buy milk  '), '- [ ] Buy milk\n');
  assert.equal(add('Buy milk\nand eggs\r\n'), '- [ ] Buy milk and eggs\n', 'a pasted line break becomes a space, so one task stays one line');
  assert.throws(() => add(''), /name/);
  assert.throws(() => add('  \n '), /name/);
});

test('the new task is the last task the app lists', () => {
  const doc = append(parse(PROJECT_FILE), 'Buy grout');
  assert.deepEqual(tasks(doc).at(-1), { id: { title: 'Buy grout', occurrence: 0 }, title: 'Buy grout', done: false });
});

test('renaming a task changes its title and nothing else in the file', () => {
  const change = (text: string, n: number, title: string) => { const doc = parse(text); return serialize(rename(doc, tasks(doc)[n]!.id, title)); };
  assert.equal(change(PROJECT_FILE, 0, 'Order wall tiles'), PROJECT_FILE.replace('- [ ] Order floor tiles due:2026-11-28 #call', '- [ ] Order wall tiles'),
    'the title is everything after the box, so text such as due: and #tags is the person\'s to keep or drop');
  assert.equal(change(PROJECT_FILE, 1, 'Call the plumber'), PROJECT_FILE.replace('- [x] Call the tiler', '- [x] Call the plumber'), 'a done task keeps its tick');
  assert.equal(change('# Inbox\r\n- [ ] One\r\n- [ ] Two\r\n', 1, 'Second'), '# Inbox\r\n- [ ] One\r\n- [ ] Second\r\n', 'Windows line endings stay');
  assert.equal(change('﻿- [ ] One', 0, 'First'), '﻿- [ ] First', 'a byte order mark and a missing final newline stay');
  assert.equal(change('- [ ]   Spaced out  \n', 0, 'Tidy'), '- [ ]   Tidy  \n', 'space around the old title is left as it was');
  assert.equal(change('- [ ] Water plants\n- [ ] Call mum\n- [ ] Water plants\n', 2, 'Water the garden'), '- [ ] Water plants\n- [ ] Call mum\n- [ ] Water the garden\n',
    'the second of two same-named tasks is the one renamed');
});

test('a renamed task\'s new title is one line with no space around it, and a blank title is refused', () => {
  const doc = parse('- [ ] Buy milk\n');
  const id = tasks(doc)[0]!.id;
  assert.equal(serialize(rename(doc, id, '  Buy oat milk \n')), '- [ ] Buy oat milk\n');
  assert.equal(serialize(rename(doc, id, 'Buy milk\nand eggs')), '- [ ] Buy milk and eggs\n');
  assert.throws(() => rename(doc, id, '   '), /name/);
  assert.equal(rename(doc, id, 'Buy milk'), doc, 'the same title changes nothing, so there is nothing to save');
});

test('a task renamed to a title another task has is told apart from it by order', () => {
  const doc = parse('- [ ] Buy milk\n- [ ] Call mum\n');
  const renamed = rename(doc, tasks(doc)[1]!.id, 'Buy milk');
  assert.deepEqual(tasks(renamed).map(t => t.id), [{ title: 'Buy milk', occurrence: 0 }, { title: 'Buy milk', occurrence: 1 }]);
});

test('renaming a task that is no longer in the file fails and names the task', () => {
  const id = tasks(parse('- [ ] Buy milk\n'))[0]!.id;
  assert.throws(() => rename(parse('- [ ] Something else\n'), id, 'Buy oat milk'), /Buy milk/);
});

test('ticking a task in a 10,000-line file takes under 5 ms from text to text', { skip: !process.env.PLAINTASK_PERF && 'set PLAINTASK_PERF=1 to run the speed budget' }, () => {
  const text = Array.from({ length: 10000 }, (_, i) => (i % 10 ? '- [ ] Task number ' + i : '## Section ' + i)).join('\n') + '\n';
  const id = { title: 'Task number 9999', occurrence: 0 };
  const run = () => { const t = performance.now(); const out = serialize(toggle(parse(text), id)); const ms = performance.now() - t; assert.equal(out.length, text.length); return ms; };
  for (let i = 0; i < 20; i++) run();   // let the engine compile the hot path before timing it
  const times = Array.from({ length: 200 }, run).sort((a, b) => a - b);
  const p95 = times[189]!;
  console.log('parse + tick + serialize, 10,000 lines: median ' + times[100]!.toFixed(2) + ' ms, p95 ' + p95.toFixed(2) + ' ms');
  assert.ok(p95 <= 5, 'p95 was ' + p95.toFixed(2) + ' ms; the budget is 5 ms');
});
