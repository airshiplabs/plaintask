// changelog.test.mjs - entries-file checks, cutting a release through the keep-a-changelog module, reading a
// release back for the release notes, and render in changelog.mjs.
//   node --test changelog.test.mjs     (run from this directory)
import assert from 'node:assert/strict';
import test from 'node:test';
import { validate } from '../../keep-a-changelog/changelog.mjs';
import { CHANGELOG, cutRelease, entriesOf, releaseBody, render, validateAdditions } from './changelog.mjs';

const REPO = 'https://github.com/airshiplabs/plaintask';
// The empty template from .claude/skills/keep-a-changelog/FORMAT.md, for the desktop component.
const EMPTY = [
  '# Changelog', '', 'All notable changes to this project are documented in this file.', '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),',
  'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).', '',
  '## [Unreleased]', '', `[Unreleased]: ${REPO}/commits/HEAD/apps/desktop`, '',
].join('\n');
const INBOX = { type: 'Added', ref: '#30', text: 'Inbox list backed by Inbox.md in a folder you choose' };
const FOLDER = { type: 'Fixed', ref: '#52', text: 'The chosen folder is kept after the app restarts' };
const SPEED = { type: 'Changed', ref: '887e173', text: 'The window opens 50 ms sooner' };
const first = (additions = [FOLDER, INBOX]) => cutRelease(EMPTY, { version: '0.1.0', date: '2026-11-22', additions });

test('the fixture is a valid changelog for the desktop component', () => {
  assert.equal(CHANGELOG, 'apps/desktop/CHANGELOG.md');
  assert.deepEqual(validate(EMPTY, { path: CHANGELOG }), []);
});

test('validateAdditions accepts a list of entries, an empty one included', () => {
  assert.deepEqual(validateAdditions([]), []);
  assert.deepEqual(validateAdditions([INBOX, FOLDER]), []);
});

test('validateAdditions names each problem with the shape of the file', () => {
  const rows = [
    [{ Added: ['x'] }, /must hold a list/],
    [null, /must hold a list/],
    [['x'], /entry 1 must be an object/],
    [[INBOX, { type: 'Added', ref: '#1' }], /entry 2 needs a non-empty string "text"/],
    [[{ ...INBOX, ref: 30 }], /entry 1 needs a non-empty string "ref"/],
    [[{ ...INBOX, type: 'Improved' }], /entry 1 has type "Improved"; use one of: Added/],
    [[{ ...INBOX, pr: 30 }], /entry 1 has unknown keys: pr/],
  ];
  for (const [entries, expected] of rows) {
    const problems = validateAdditions(entries);
    assert.ok(problems.some((problem) => expected.test(problem)), `${JSON.stringify(entries)} -> ${JSON.stringify(problems)}`);
  }
});

test('cutRelease adds the entries, cuts the release, and writes a file the format accepts', () => {
  const text = first();
  assert.deepEqual(validate(text, { path: CHANGELOG }), []);
  assert.ok(text.endsWith([
    '## [Unreleased]', '', '## [0.1.0] - 2026-11-22', '', '### Added', '', `- ${INBOX.text} ([#30])`, '', '### Fixed', '', `- ${FOLDER.text} ([#52])`, '',
    `[Unreleased]: ${REPO}/compare/desktop-v0.1.0...HEAD`, `[0.1.0]: ${REPO}/releases/tag/desktop-v0.1.0`,
    `[#30]: ${REPO}/pull/30`, `[#52]: ${REPO}/pull/52`, '',
  ].join('\n')));
  assert.deepEqual(entriesOf(text), []);
  assert.deepEqual(entriesOf(text, '0.1.0'), [INBOX, FOLDER].map(({ type, text: entry, ref }) => ({ type, text: entry, ref })));
});

test('cutRelease releases entries already under [Unreleased] together with the additions', () => {
  const pending = first().replace('## [Unreleased]\n', `## [Unreleased]\n\n### Changed\n\n- ${SPEED.text} ([887e173])\n`)
    .replace(`[#52]: ${REPO}/pull/52\n`, `[#52]: ${REPO}/pull/52\n[887e173]: ${REPO}/commit/887e173\n`);
  assert.deepEqual(validate(pending, { path: CHANGELOG }), []);
  assert.deepEqual(entriesOf(pending), [SPEED]);

  const second = cutRelease(pending, { version: '0.2.0', date: '2026-12-01', additions: [] });
  assert.deepEqual(validate(second, { path: CHANGELOG }), []);
  assert.deepEqual(entriesOf(second, '0.2.0'), [SPEED]);
  assert.match(second, /\[0\.2\.0\]: .*\/compare\/desktop-v0\.1\.0\.\.\.desktop-v0\.2\.0\n/);
});

test('cutRelease returns the same text when the release is already cut with the same entries', () => {
  const text = first();
  assert.equal(cutRelease(text, { version: '0.1.0', date: '2026-12-25', additions: [INBOX, FOLDER] }), text, 'the release keeps its date');
  assert.throws(() => cutRelease(text, { version: '0.1.0', date: '2026-11-22', additions: [SPEED] }), /already has a \[0\.1\.0\] release that differs/);
});

test('cutRelease refuses what the changelog format or the release order does not allow', () => {
  const cut = (text, change) => () => cutRelease(text, { version: '0.1.0', date: '2026-11-22', additions: [INBOX], ...change });
  assert.throws(cut(EMPTY, { additions: [] }), /has no entries to release/);
  assert.throws(cut(EMPTY, { version: 'v0.1.0' }), /not a SemVer/);
  assert.throws(cut(EMPTY, { date: '2026-02-30' }), /not a YYYY-MM-DD calendar date/);
  assert.throws(cut(first(), { version: '0.0.9' }), /0\.0\.9 is not above the newest release, 0\.1\.0/);
  assert.throws(cut(EMPTY, { additions: [{ ...INBOX, text: 'x'.repeat(101) }] }), /after the release:\n {2}line \d+: .*\n {2}entry-length: /);
  assert.throws(cut(EMPTY, { additions: [{ ...INBOX, ref: 'PR 30' }] }), /after the release:\n {2}line \d+: .*\n {2}entry: /);
  assert.throws(cut(EMPTY.replace('# Changelog', '# Change log'), {}), /before the release:\n {2}line 1: # Change log\n {2}title: /);

  const pending = EMPTY.replace('## [Unreleased]\n', `## [Unreleased]\n\n### Added\n\n- ${INBOX.text} ([#30])\n`).replace(/\n$/, `\n[#30]: ${REPO}/pull/30\n`);
  assert.throws(cut(pending, {}), /\[Unreleased\] already has the entry "Inbox list backed/);
});

test('releaseBody writes a release for GitHub, with bare references, and null for a missing release', () => {
  const text = first();
  assert.equal(releaseBody(text, '0.1.0'), `### Added\n\n- ${INBOX.text} (#30)\n\n### Fixed\n\n- ${FOLDER.text} (#52)`);
  assert.equal(releaseBody(text, '9.9.9'), null);
  const withSummary = text.replace('## [0.1.0] - 2026-11-22\n', '## [0.1.0] - 2026-11-22\n\nThe first release.\n');
  assert.deepEqual(validate(withSummary, { path: CHANGELOG }), []);
  assert.ok(releaseBody(withSummary, '0.1.0').startsWith('The first release.\n\n### Added\n\n'));
});

test('render fills placeholders and refuses a template and values that do not match', () => {
  assert.equal(render('v{{version}} at {{sha}}, again {{version}}', { version: '0.1.0', sha: 'abc' }), 'v0.1.0 at abc, again 0.1.0');
  assert.throws(() => render('{{version}} {{sha}}', { version: '0.1.0' }), /\{\{sha\}\} but no value/);
  assert.throws(() => render('{{version}}', { version: '0.1.0', sha: 'abc' }), /no \{\{placeholder\}\} in the template for: sha/);
});
