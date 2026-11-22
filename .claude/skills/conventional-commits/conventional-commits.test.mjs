// conventional-commits.test.mjs - validateMessage against the Conventional Commits 1.0.0 rule table, and the
// validate.mjs CLI contract (exit code, empty stdout, stderr text) that the hook, CI, and the skill call.
//   node --test conventional-commits.test.mjs     (run from the skill directory)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateMessage } from './conventional-commits.mjs';

const cliPath = fileURLToPath(new URL('./validate.mjs', import.meta.url));

// Only rule, line, and text are contract; message wording is the builder's choice.
const verdict = (violations) => violations.map(({ rule, line, text }) => ({ rule, line, text }));
const label = (text) => JSON.stringify(text.slice(0, 80));
const literally = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const runCli = (args, input) =>
  spawnSync(process.execPath, [cliPath, ...args], { input: input ?? '', encoding: 'utf8' });

// ---- Slice 1: header rules, whitespace cleanup, autosquash prefixes ----

test('validateMessage returns the header rule for each header', () => {
  const rows = [
    // Conforming headers (3-prd.md:20-23).
    { text: 'feat: add x', expected: [] },
    { text: 'feat(scope): add x', expected: [] },
    { text: 'fix!: x', expected: [] },
    { text: 'feat(scope)!: x', expected: [] },
    { text: 'FEAT: x', expected: [] },
    // D7 character sets: one-character tokens, digits in the type, any non-space scope.
    { text: 'a: x', expected: [] },
    { text: 'feat(a): x', expected: [] },
    { text: 'i18n: x', expected: [] },
    { text: 'a11y: x', expected: [] },
    { text: 'feat(API): x', expected: [] },
    { text: 'feat(api/v2): x', expected: [] },
    { text: 'feat(sites/plaintask.app): x', expected: [] },
    // Dependabot subjects (3-prd.md:66), the squash-merge suffix, and the D7 typo-type trade-off.
    { text: 'chore(deps): Bump stripe from 20.4.1 to 23.1.0', expected: [] },
    { text: 'ci(deps): Bump the actions group with 3 updates', expected: [] },
    { text: 'feat: add dark mode (#27)', expected: [] },
    { text: 'feat;: x', expected: [] },
    // Whitespace cleanup: no trailing newline, CRLF, a --cleanup=verbatim commit, no length limit.
    { text: 'docs: a header with no trailing newline', expected: [] },
    { text: 'feat: add x\r\n', expected: [] },
    { text: '\n\nfeat: add x  \n', expected: [] },
    { text: 'feat: ' + 'd'.repeat(1000), expected: [] },
    // D9 autosquash prefixes are removed, as often as they repeat.
    { text: 'fixup! feat(app): add the checkout banner', expected: [] },
    { text: 'squash! feat: x', expected: [] },
    { text: 'amend! feat: x', expected: [] },
    { text: 'fixup! fixup! feat: x', expected: [] },
    // message-empty.
    { text: '', expected: [{ rule: 'message-empty', line: 1, text: '' }] },
    // header-type: no type, leading whitespace or BOM, git-generated Merge and Revert, a bad subject under fixup!.
    { text: 'Add pricing page', expected: [{ rule: 'header-type', line: 1, text: 'Add pricing page' }] },
    { text: ': add x', expected: [{ rule: 'header-type', line: 1, text: ': add x' }] },
    { text: '#42 fix login', expected: [{ rule: 'header-type', line: 1, text: '#42 fix login' }] },
    { text: ' feat: x', expected: [{ rule: 'header-type', line: 1, text: ' feat: x' }] },
    { text: '﻿feat: x', expected: [{ rule: 'header-type', line: 1, text: '﻿feat: x' }] },
    { text: "Merge branch 'main' into dark-mode", expected: [{ rule: 'header-type', line: 1, text: "Merge branch 'main' into dark-mode" }] },
    { text: 'Revert "feat: add x"', expected: [{ rule: 'header-type', line: 1, text: 'Revert "feat: add x"' }] },
    { text: 'fixup! Add pricing page', expected: [{ rule: 'header-type', line: 1, text: 'Add pricing page' }] },
    // header-scope.
    { text: 'feat(): x', expected: [{ rule: 'header-scope', line: 1, text: 'feat(): x' }] },
    { text: 'feat(a b): x', expected: [{ rule: 'header-scope', line: 1, text: 'feat(a b): x' }] },
    { text: 'feat(a: x', expected: [{ rule: 'header-scope', line: 1, text: 'feat(a: x' }] },
    // header-separator.
    { text: 'feat:x', expected: [{ rule: 'header-separator', line: 1, text: 'feat:x' }] },
    // header-description: cleanup removes the trailing space of 'feat: '.
    { text: 'feat:', expected: [{ rule: 'header-description', line: 1, text: 'feat:' }] },
    { text: 'feat: ', expected: [{ rule: 'header-description', line: 1, text: 'feat:' }] },
    { text: 'feat:  x', expected: [{ rule: 'header-description', line: 1, text: 'feat:  x' }] },
    // An unclosed 100 000-character scope; a backtracking regex hangs here. No timing assertion.
    { text: 'feat(' + 'a'.repeat(100000), expected: [{ rule: 'header-scope', line: 1, text: 'feat(' + 'a'.repeat(100000) }] },
  ];

  for (const row of rows) {
    assert.deepEqual(verdict(validateMessage(row.text)), row.expected, label(row.text));
  }
});

test('validate.mjs exits 0, 1, or 2 and reports on stderr', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'conventional-commits-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const passFile = join(dir, 'pass.txt');
  const failFile = join(dir, 'fail.txt');
  const emptyFile = join(dir, 'empty.txt');
  const badUtf8File = join(dir, 'bad-utf8.txt');
  const missingFile = join(dir, 'missing.txt');
  const directory = join(dir, 'a-directory');
  await writeFile(passFile, 'feat: add x');
  await writeFile(failFile, 'Add pricing page');
  await writeFile(emptyFile, '');
  await writeFile(badUtf8File, Buffer.from([0x66, 0x69, 0x78, 0x3a, 0xff, 0x78])); // "fix:", 0xFF, "x"
  await mkdir(directory);

  const rows = [
    { name: 'conforming file', args: [passFile], status: 0, stderr: [/^$/] },
    { name: 'non-conforming file', args: [failFile], status: 1, stderr: [/header-type/, /line 1:/, /Add pricing page/] },
    { name: 'stdin, bad scope', args: ['-'], input: 'feat(): x', status: 1, stderr: [/header-scope/] },
    { name: 'stdin, conforming', args: ['-'], input: 'feat: x', status: 0, stderr: [/^$/] },
    { name: '0-byte file', args: [emptyFile], status: 1, stderr: [/message-empty/] },
    { name: 'empty stdin', args: ['-'], input: '', status: 1, stderr: [/message-empty/] },
    { name: 'invalid UTF-8 decodes to U+FFFD', args: [badUtf8File], status: 1, stderr: [/header-separator/, /fix:�x/] },
    { name: 'no argument', args: [], status: 2, stderr: [/^usage: validate\.mjs /] },
    { name: 'two arguments', args: [passFile, failFile], status: 2, stderr: [/^usage: validate\.mjs /] },
    { name: 'unknown option', args: ['--bogus', passFile], status: 2, stderr: [/^usage: validate\.mjs /] },
    { name: 'missing path', args: [missingFile], status: 2, stderr: [literally(`cannot read ${missingFile}: ENOENT`)] },
    { name: 'directory path', args: [directory], status: 2, stderr: [literally(`cannot read ${directory}: EISDIR`)] },
  ];

  for (const row of rows) {
    const result = runCli(row.args, row.input);
    assert.equal(result.status, row.status, `${row.name}: exit code; stderr was ${JSON.stringify(result.stderr)}`);
    assert.equal(result.stdout, '', `${row.name}: stdout`);
    for (const pattern of row.stderr) assert.match(result.stderr, pattern, `${row.name}: stderr`);
  }
});

// ---- Slice 3: body and footer rules, cleanup modes ----

const SCISSORS = '# ------------------------ >8 ------------------------';

// What git hands the commit-msg hook for an editor commit with commit.verbose=true.
const VERBOSE_EDITOR_BUFFER = [
  'feat: add x',
  '',
  '# Please enter the commit message for your changes. Lines starting',
  "# with '#' will be ignored, and an empty message aborts the commit.",
  '#',
  '# On branch main',
  '# Changes to be committed:',
  '#\tnew file:   x.txt',
  '#',
  SCISSORS,
  '# Do not modify or remove the line above.',
  '# Everything below it will be ignored.',
  'diff --git a/x.txt b/x.txt',
  'new file mode 100644',
  'index 0000000..587be6b',
  '--- /dev/null',
  '+++ b/x.txt',
  '@@ -0,0 +1 @@',
  '+x',
  '',
].join('\n');

const SCISSORS_AND_DIFF_ONLY = [
  SCISSORS,
  '# Do not modify or remove the line above.',
  '# Everything below it will be ignored.',
  'diff --git a/x.txt b/x.txt',
  '+x',
  '',
].join('\n');

test('validateMessage judges body, footer, and comment lines by cleanup mode', () => {
  const rows = [
    // Both modes: blank line between header and body (3-prd.md:26-27), collapsed blank runs, CRLF.
    { cleanup: 'whitespace', text: 'feat: add x\n\nbody', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\n\nbody', expected: [] },
    { cleanup: 'whitespace', text: 'feat: add x\nbody', expected: [{ rule: 'body-leading-blank', line: 2, text: 'body' }] },
    { cleanup: 'strip', text: 'feat: add x\nbody', expected: [{ rule: 'body-leading-blank', line: 2, text: 'body' }] },
    { cleanup: 'whitespace', text: 'feat: add x\n\n\n\nbody', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\n\n\n\nbody', expected: [] },
    { cleanup: 'whitespace', text: 'feat: add x\r\n\r\nbody\r\n', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\r\n\r\nbody\r\n', expected: [] },
    // Both modes: footers that pass (3-prd.md:28), and a lowercase breaking-change line read as body text (D8).
    { cleanup: 'whitespace', text: 'feat: add x\n\nRefs: 123', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\n\nRefs: 123', expected: [] },
    { cleanup: 'whitespace', text: 'feat: add x\n\nRefs #123', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\n\nRefs #123', expected: [] },
    { cleanup: 'whitespace', text: 'feat: add x\n\nBREAKING CHANGE: drop v1', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\n\nBREAKING CHANGE: drop v1', expected: [] },
    { cleanup: 'whitespace', text: 'feat: add x\n\nBREAKING-CHANGE: drop v1', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\n\nBREAKING-CHANGE: drop v1', expected: [] },
    { cleanup: 'whitespace', text: 'feat: add x\n\nCo-Authored-By: Claude <noreply@anthropic.com>', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\n\nCo-Authored-By: Claude <noreply@anthropic.com>', expected: [] },
    { cleanup: 'whitespace', text: 'feat: add x\n\nbreaking change: x', expected: [] },
    { cleanup: 'strip', text: 'feat: add x\n\nbreaking change: x', expected: [] },
    // Both modes: a breaking-change footer with " #" fails on its own line number.
    { cleanup: 'whitespace', text: 'feat: add x\n\nBREAKING CHANGE #1', expected: [{ rule: 'footer-breaking-change', line: 3, text: 'BREAKING CHANGE #1' }] },
    { cleanup: 'strip', text: 'feat: add x\n\nBREAKING CHANGE #1', expected: [{ rule: 'footer-breaking-change', line: 3, text: 'BREAKING CHANGE #1' }] },
    { cleanup: 'whitespace', text: 'feat: add x\n\nbody\n\nBREAKING-CHANGE #1', expected: [{ rule: 'footer-breaking-change', line: 5, text: 'BREAKING-CHANGE #1' }] },
    { cleanup: 'strip', text: 'feat: add x\n\nbody\n\nBREAKING-CHANGE #1', expected: [{ rule: 'footer-breaking-change', line: 5, text: 'BREAKING-CHANGE #1' }] },
    // whitespace only: '#' lines are message text.
    { cleanup: 'whitespace', text: 'feat: add x\n# note', expected: [{ rule: 'body-leading-blank', line: 2, text: '# note' }] },
    {
      cleanup: 'whitespace',
      text: '# a\n# b',
      expected: [
        { rule: 'header-type', line: 1, text: '# a' },
        { rule: 'body-leading-blank', line: 2, text: '# b' },
      ],
    },
    // strip only: '#' lines and the scissors section are dropped (3-prd.md:31-32).
    { cleanup: 'strip', text: 'feat: add x\n# note', expected: [] },
    { cleanup: 'strip', text: '#42 fix login', expected: [{ rule: 'message-empty', line: 1, text: '' }] },
    { cleanup: 'strip', text: '# a\n# b', expected: [{ rule: 'message-empty', line: 1, text: '' }] },
    { cleanup: 'strip', text: '', expected: [{ rule: 'message-empty', line: 1, text: '' }] },
    { cleanup: 'strip', text: SCISSORS_AND_DIFF_ONLY, expected: [{ rule: 'message-empty', line: 1, text: '' }] },
    { cleanup: 'strip', text: VERBOSE_EDITOR_BUFFER, expected: [] },
  ];

  for (const row of rows) {
    assert.deepEqual(verdict(validateMessage(row.text, { cleanup: row.cleanup })), row.expected, `${row.cleanup} ${label(row.text)}`);
  }

  assert.throws(() => validateMessage('feat: x', { cleanup: 'verbatim' }), RangeError);
});

test('validate.mjs exits 0, 1, or 2 and reports on stderr: --cleanup rows', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'conventional-commits-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const noteFile = join(dir, 'note.txt');
  await writeFile(noteFile, 'feat: add x\n# note');

  const rows = [
    { name: 'no option', args: [noteFile], status: 1, stderr: [/body-leading-blank/, /line 2: # note/] },
    { name: '--cleanup=whitespace', args: ['--cleanup=whitespace', noteFile], status: 1, stderr: [/body-leading-blank/, /line 2: # note/] },
    { name: '--cleanup=strip', args: ['--cleanup=strip', noteFile], status: 0, stderr: [/^$/] },
    { name: 'stdin, option first', args: ['--cleanup=strip', '-'], input: 'feat: add x\n# note', status: 0, stderr: [/^$/] },
    { name: 'stdin, option last', args: ['-', '--cleanup=strip'], input: 'feat: add x\n# note', status: 0, stderr: [/^$/] },
    {
      name: 'bad value',
      args: ['--cleanup=verbatim', noteFile],
      status: 2,
      stderr: [/^usage: validate\.mjs \[--cleanup=whitespace\|strip\] <message-file \| ->$/m],
    },
    { name: 'repeated option', args: ['--cleanup=strip', '--cleanup=strip', noteFile], status: 2, stderr: [/^usage: validate\.mjs /] },
  ];

  for (const row of rows) {
    const result = runCli(row.args, row.input);
    assert.equal(result.status, row.status, `${row.name}: exit code; stderr was ${JSON.stringify(result.stderr)}`);
    assert.equal(result.stdout, '', `${row.name}: stdout`);
    for (const pattern of row.stderr) assert.match(result.stderr, pattern, `${row.name}: stderr`);
  }
});
