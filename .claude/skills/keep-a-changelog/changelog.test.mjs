// changelog.test.mjs - the FORMAT.md rule table, render round-trips, addEntry and release, and the CLI
// contract (exit code, empty stdout, stderr text) of validate.mjs, add.mjs, and release.mjs.
//   node --test changelog.test.mjs     (run from the skill directory)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { addEntry, CHANGELOGS, compareSemver, MAX_ENTRY_CHARS, parse, release, render, validate } from './changelog.mjs';

const PATH = 'apps/desktop/CHANGELOG.md';
const REPO = 'https://github.com/airshiplabs/plaintask';
const HEADER = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`;
const EMPTY = `${HEADER}
## [Unreleased]

[Unreleased]: ${REPO}/commits/HEAD/apps/desktop
`;
const FULL = `${HEADER}
## [Unreleased]

### Fixed

- Sync no longer drops tasks edited offline ([#41])

## [0.2.0] - 2026-11-22

The first release with sync.

### Added

- Sync tasks between devices ([#38])

### Changed

- **Breaking:** Settings move to the new settings window ([887e173])

### Security

- CVE-2026-12345: Escape task titles in the share sheet ([#40])

## [0.1.0] - 2026-10-01 [YANKED]

### Added

- Menu bar quick-add window ([#30])

[Unreleased]: ${REPO}/compare/desktop-v0.2.0...HEAD
[0.2.0]: ${REPO}/compare/desktop-v0.1.0...desktop-v0.2.0
[0.1.0]: ${REPO}/releases/tag/desktop-v0.1.0
[#30]: ${REPO}/pull/30
[#38]: ${REPO}/pull/38
[#40]: ${REPO}/pull/40
[#41]: ${REPO}/pull/41
[887e173]: ${REPO}/commit/887e173
`;

// Only rule and line are contract; message wording is the builder's choice.
const verdict = (text) => validate(text, { path: PATH }).map(({ rule, line }) => ({ rule, line }));
const lineOf = (text, needle) => text.split('\n').findIndex((line) => line.includes(needle)) + 1;
const replace = (text, from, to) => {
  assert.ok(text.includes(from), `fixture lacks ${JSON.stringify(from)}`);
  return text.replace(from, to);
};

// One valid release whose single entry is the given line, under the given type.
function withEntry(entryLine, type = 'Added', ref = '#1') {
  return `${HEADER}
## [Unreleased]

### ${type}

${entryLine}

[Unreleased]: ${REPO}/commits/HEAD/apps/desktop
[${ref}]: ${ref.startsWith('#') ? `${REPO}/pull/${ref.slice(1)}` : `${REPO}/commit/${ref}`}
`;
}

test('the FORMAT.md templates pass', () => {
  assert.deepEqual(verdict(EMPTY), []);
  assert.deepEqual(verdict(FULL), []);
});

test('every CHANGELOGS path gets its own component links', () => {
  for (const path of CHANGELOGS) {
    const dir = path.replace('/CHANGELOG.md', '');
    const text = EMPTY.replace('apps/desktop', dir);
    assert.deepEqual(validate(text, { path }), [], path);
  }
  const prefix = /\[0\.1\.0\]: .*releases\/tag\/mobile-v0\.1\.0$/m;
  const site = 'apps/mobile/CHANGELOG.md';
  const released = render(release(parse(withEntry('- X ([#1])')).doc, { version: '0.1.0', date: '2026-01-01' }), { path: site });
  assert.match(released, prefix);
});

test('validate throws on a path outside CHANGELOGS', () => {
  assert.throws(() => validate(EMPTY, { path: 'packages/site-css/CHANGELOG.md' }), RangeError);
});

test('each rule fails at its line', () => {
  const rows = [
    ['title', replace(EMPTY, '# Changelog', '# Change log'), 1],
    ['title', '', 1],
    ['preamble', replace(EMPTY, 'documented in this file.', 'documented here.'), 3],
    ['preamble', replace(EMPTY, 'keepachangelog.com/en/2.0.0/', 'keepachangelog.com/en/1.1.0/'), 5],
    ['unreleased', replace(EMPTY, '## [Unreleased]\n\n', ''), 8],
    ['unreleased', replace(FULL, '## [Unreleased]', '## [0.3.0] - 2026-11-23'), 8],
    ['unreleased', replace(FULL, '## [0.1.0] - 2026-10-01 [YANKED]', '## [Unreleased]'), lineOf(FULL, '## [0.1.0]')],
    ['version-heading', replace(FULL, '## [0.2.0] - 2026-11-22', '## [0.2.0] 2026-11-22'), lineOf(FULL, '## [0.2.0]')],
    ['version-heading', replace(FULL, '## [0.2.0] - 2026-11-22', '## [0.2.0] - 2026-02-30'), lineOf(FULL, '## [0.2.0]')],
    ['version-heading', replace(FULL, '## [0.2.0] - 2026-11-22', '## [v0.2.0] - 2026-11-22'), lineOf(FULL, '## [0.2.0]')],
    ['version-heading', replace(FULL, '[YANKED]', '[yanked]'), lineOf(FULL, '## [0.1.0]')],
    ['version-unique', replace(FULL, '## [0.1.0] - 2026-10-01', '## [0.2.0] - 2026-10-01'), lineOf(FULL, '## [0.1.0]')],
    ['version-order', replace(FULL, '## [0.1.0] - 2026-10-01', '## [0.3.0] - 2026-10-01'), lineOf(FULL, '## [0.1.0]')],
    ['version-order', replace(FULL, '## [0.1.0] - 2026-10-01', '## [0.1.0] - 2026-12-01'), lineOf(FULL, '## [0.1.0]')],
    ['version-empty', replace(FULL, '### Added\n\n- Menu bar quick-add window ([#30])\n\n', ''), lineOf(FULL, '## [0.1.0]')],
    ['heading-level', replace(FULL, '### Fixed', '#### Fixed'), lineOf(FULL, '### Fixed')],
    ['section-name', replace(FULL, '### Fixed', '### Improved'), lineOf(FULL, '### Fixed')],
    ['section-name', replace(FULL, '### Fixed', '### fixed'), lineOf(FULL, '### Fixed')],
    ['section-unique', replace(FULL, '### Changed', '### Added'), lineOf(FULL, '### Changed')],
    ['section-order', replace(replace(FULL, '### Added\n\n- Sync', '### Fixed\n\n- Sync'), '### Security', '### Added'), lineOf(FULL, '### Changed')],
    ['section-empty', replace(FULL, '### Fixed\n\n- Sync no longer drops tasks edited offline ([#41])\n', '### Fixed\n'), lineOf(FULL, '### Fixed')],
    ['summary', replace(FULL, '- Menu bar quick-add window ([#30])', '- Menu bar quick-add window ([#30])\n\nMore notes.'), lineOf(FULL, '- Menu bar') + 2],
    ['preamble', replace(EMPTY, '## [Unreleased]', 'Stray text.\n\n## [Unreleased]'), 8],
  ];
  for (const [rule, text, line] of rows) {
    assert.deepEqual(verdict(text).slice(0, 1), [{ rule, line }], `${rule} at ${line}`);
  }
});

test('entry rules', () => {
  const rows = [
    // Conforming entries.
    ['- Add the quick-add window ([#1])', 'Added', '#1', []],
    ['- Add the quick-add window ([887e173])', 'Added', '887e173', []],
    ['- Add `config.toml` support ([#1])', 'Added', '#1', []],
    [`- ${'x'.repeat(MAX_ENTRY_CHARS)} ([#1])`, 'Added', '#1', []],
    [`- ${'é'.repeat(MAX_ENTRY_CHARS)} ([#1])`, 'Added', '#1', []],
    ['- **Breaking:** Drop the v1 file format ([#1])', 'Removed', '#1', []],
    ['- CVE-2026-1234: Escape titles ([#1])', 'Security', '#1', []],
    // entry: shape, reference, and placement.
    ['- Add the window (#1)', 'Added', '#1', ['entry']],
    ['- Add the window', 'Added', '#1', ['entry']],
    ['* Add the window ([#1])', 'Added', '#1', ['entry']],
    ['  - Add the window ([#1])', 'Added', '#1', ['entry']],
    ['- Add the window ([#01])', 'Added', '#01', ['entry']],
    ['- Add the window ([887E173])', 'Added', '887E173', ['entry']],
    ['- Add the window ([887e17])', 'Added', '887e17', ['entry']],
    ['- Add the window ([#1], [#2])', 'Added', '#1', ['entry']],
    ['-  Add the window ([#1])', 'Added', '#1', ['entry']],
    // entry-length.
    [`- ${'x'.repeat(MAX_ENTRY_CHARS + 1)} ([#1])`, 'Added', '#1', ['entry-length']],
    // breaking.
    ['- **Breaking:** Drop the v1 file format ([#1])', 'Added', '#1', ['breaking']],
    ['- **Breaking**: Drop the v1 file format ([#1])', 'Changed', '#1', ['breaking']],
    ['- Drop v1, **Breaking:** for scripts ([#1])', 'Changed', '#1', ['breaking']],
    // cve.
    ['- CVE-2026-1234 Escape titles ([#1])', 'Security', '#1', ['cve']],
    ['- CVE-2026-1234: Escape titles ([#1])', 'Fixed', '#1', ['cve']],
  ];
  for (const [line, type, ref, rules] of rows) {
    const got = verdict(withEntry(line, type, ref)).map((v) => v.rule);
    assert.deepEqual(got, rules, line);
  }
});

test('an entry outside a section fails entry', () => {
  const text = replace(EMPTY, '## [Unreleased]\n', '## [Unreleased]\n\n- Loose ([#1])\n');
  assert.deepEqual(verdict(text).slice(0, 1), [{ rule: 'entry', line: 10 }]);
});

test('links rule names the expected line', () => {
  const rows = [
    // Wrong compare base.
    [replace(FULL, 'compare/desktop-v0.1.0...desktop-v0.2.0', 'compare/v0.1.0...v0.2.0'), '[0.2.0]: '],
    // Unused definition.
    [replace(FULL, `[887e173]: ${REPO}/commit/887e173\n`, `[887e173]: ${REPO}/commit/887e173\n[#99]: ${REPO}/pull/99\n`), '[#99]: '],
    // Out of order: PRs ascending by number.
    [replace(replace(FULL, `[#30]: ${REPO}/pull/30\n`, ''), `[#38]: ${REPO}/pull/38\n`, `[#38]: ${REPO}/pull/38\n[#30]: ${REPO}/pull/30\n`), '[#38]: '],
    // Text after the link block.
    [`${FULL}\nTrailing text.\n`, 'Trailing text.'],
  ];
  for (const [text, needle] of rows) {
    const got = validate(text, { path: PATH });
    assert.equal(got.length, 1, needle);
    assert.equal(got[0].rule, 'links', needle);
    assert.equal(got[0].line, lineOf(text, needle), needle);
  }
  const missing = replace(FULL, `[#41]: ${REPO}/pull/41\n`, '');
  const [v] = validate(missing, { path: PATH });
  assert.equal(v.rule, 'links');
  assert.match(v.message, /\[#41\]: https:\/\/github\.com\/airshiplabs\/plaintask\/pull\/41/);
  const none = replace(EMPTY, `[Unreleased]: ${REPO}/commits/HEAD/apps/desktop\n`, '');
  assert.deepEqual(verdict(none.trimEnd() + '\n'), [{ rule: 'links', line: 9 }]);
});

test('whitespace rule', () => {
  const rows = [
    [FULL.trimEnd(), lineOf(FULL, '[887e173]:')],
    [`${FULL}\n`, lineOf(FULL, '[887e173]:') + 1],
    [replace(FULL, '## [0.2.0]', '\n## [0.2.0]'), lineOf(FULL, '## [0.2.0]')],
    [replace(FULL, '### Added\n\n- Sync', '### Added\n- Sync'), lineOf(FULL, '### Added') + 1],
    [replace(FULL, '- Sync tasks between devices ([#38])\n', '- Sync tasks between devices ([#38])\n\n'), lineOf(FULL, '- Sync tasks') + 2],
    [replace(FULL, '### Fixed', '### Fixed '), lineOf(FULL, '### Fixed')],
    [replace(FULL, '- Sync no longer', '-\tSync no longer'), lineOf(FULL, '- Sync no longer')],
    [FULL.replaceAll('\n', '\r\n'), 1],
  ];
  for (const [text, line] of rows) {
    assert.deepEqual(verdict(text).slice(0, 1), [{ rule: 'whitespace', line }], JSON.stringify(text.split('\n')[line - 1]));
  }
});

test('render(parse(x)) === x for valid files', () => {
  for (const text of [EMPTY, FULL]) assert.equal(render(parse(text).doc, { path: PATH }), text);
});

test('compareSemver follows SemVer 2.0.0 precedence', () => {
  const ascending = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0', '10.0.0'];
  for (let i = 1; i < ascending.length; i++) {
    assert.ok(compareSemver(ascending[i - 1], ascending[i]) < 0, `${ascending[i - 1]} < ${ascending[i]}`);
    assert.ok(compareSemver(ascending[i], ascending[i - 1]) > 0, `${ascending[i]} > ${ascending[i - 1]}`);
  }
  assert.equal(compareSemver('1.0.0+a', '1.0.0+b'), 0);
});

test('addEntry places entries by type and dedupes link lines', () => {
  let doc = parse(EMPTY).doc;
  doc = addEntry(doc, { type: 'Fixed', ref: '#5', text: 'Fix the sync badge' });
  doc = addEntry(doc, { type: 'Added', ref: '#7', text: 'Add the share sheet' });
  doc = addEntry(doc, { type: 'Fixed', ref: '#5', text: 'Fix the sync timer' });
  doc = addEntry(doc, { type: 'Added', ref: 'abc1234', text: 'Add dark mode' });
  const text = render(doc, { path: PATH });
  assert.deepEqual(verdict(text), []);
  assert.equal(text, `${HEADER}
## [Unreleased]

### Added

- Add the share sheet ([#7])
- Add dark mode ([abc1234])

### Fixed

- Fix the sync badge ([#5])
- Fix the sync timer ([#5])

[Unreleased]: ${REPO}/commits/HEAD/apps/desktop
[#5]: ${REPO}/pull/5
[#7]: ${REPO}/pull/7
[abc1234]: ${REPO}/commit/abc1234
`);
  assert.throws(() => addEntry(doc, { type: 'Improved', ref: '#1', text: 'x' }), RangeError);
});

test('release moves Unreleased into a dated version and rewrites links', () => {
  const doc = release(parse(FULL).doc, { version: '0.3.0', date: '2026-11-23' });
  const text = render(doc, { path: PATH });
  assert.deepEqual(verdict(text), []);
  assert.match(text, /## \[Unreleased\]\n\n## \[0\.3\.0\] - 2026-11-23\n\n### Fixed\n\n- Sync no longer/);
  assert.match(text, /^\[Unreleased\]: .*compare\/desktop-v0\.3\.0\.\.\.HEAD$/m);
  assert.match(text, /^\[0\.3\.0\]: .*compare\/desktop-v0\.2\.0\.\.\.desktop-v0\.3\.0$/m);

  const first = render(release(parse(withEntry('- X ([#1])')).doc, { version: '0.1.0', date: '2026-01-01' }), { path: PATH });
  assert.deepEqual(verdict(first), []);
  assert.match(first, /^\[0\.1\.0\]: .*releases\/tag\/desktop-v0\.1\.0$/m);

  const rows = [
    [EMPTY, '0.1.0', '2026-01-01', /no entries/],
    [FULL, '0.2.0', '2026-11-23', /not above/],
    [FULL, '0.1.5', '2026-11-23', /not above/],
    [FULL, 'v0.3.0', '2026-11-23', /SemVer/],
    [FULL, '0.3.0', '2026-13-01', /calendar date/],
  ];
  for (const [text, version, date, message] of rows) {
    assert.throws(() => release(parse(text).doc, { version, date }), message, `${version} ${date}`);
  }
});

// ---- CLI contract ----

const script = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));
const run = (name, args, input) =>
  spawnSync(process.execPath, [script(name), ...args], { input: input ?? '', encoding: 'utf8' });

async function withRepo(files, fn) {
  const root = await mkdtemp(join(tmpdir(), 'changelog-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), text);
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('validate.mjs exit codes and output', async () => {
  await withRepo({ [PATH]: FULL, 'apps/mobile/CHANGELOG.md': FULL }, async (root) => {
    const ok = run('validate.mjs', [join(root, PATH)]);
    assert.deepEqual([ok.status, ok.stdout, ok.stderr], [0, '', '']);

    const bad = run('validate.mjs', [join(root, 'apps/mobile/CHANGELOG.md')]);
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /apps\/mobile\/CHANGELOG\.md: does not match/);
    assert.match(bad.stderr, /links: expected "\[Unreleased\]: .*compare\/mobile-v0\.2\.0\.\.\.HEAD"/);

    const unlisted = run('validate.mjs', [join(root, 'apps', 'CHANGELOG.md')]);
    assert.equal(unlisted.status, 2);
  });

  const stdin = run('validate.mjs', ['--path=' + PATH, '-'], replace(FULL, '### Fixed', '### Fixes'));
  assert.equal(stdin.status, 1);
  assert.match(stdin.stderr, /section-name/);
  assert.match(stdin.stderr, /line 10: ### Fixes/);
  assert.equal(run('validate.mjs', ['--path=' + PATH, '-'], FULL).status, 0);
  assert.equal(run('validate.mjs', ['--path=packages/x/CHANGELOG.md', '-'], FULL).status, 2);
  assert.equal(run('validate.mjs', ['--path=' + PATH]).status, 2);
  assert.equal(run('validate.mjs', ['--bogus']).status, 2);
});

test('add.mjs writes only a valid result', async () => {
  await withRepo({ [PATH]: EMPTY }, async (root) => {
    const file = join(root, PATH);
    const ok = run('add.mjs', [file, 'Fixed', '#99', 'Fix the sync badge']);
    assert.deepEqual([ok.status, ok.stdout, ok.stderr], [0, '', '']);
    const after = await readFile(file, 'utf8');
    assert.match(after, /### Fixed\n\n- Fix the sync badge \(\[#99\]\)\n/);
    assert.match(after, /^\[#99\]: https:\/\/github\.com\/airshiplabs\/plaintask\/pull\/99$/m);

    const long = run('add.mjs', [file, 'Fixed', '#100', 'x'.repeat(MAX_ENTRY_CHARS + 1)]);
    assert.equal(long.status, 1);
    assert.match(long.stderr, /entry-length/);
    assert.equal(await readFile(file, 'utf8'), after);

    assert.equal(run('add.mjs', [file, 'Fixed', '99', 'No hash']).status, 1);
    assert.equal(run('add.mjs', [file, 'Improved', '#1', 'x']).status, 2);
    assert.equal(run('add.mjs', [file, 'Fixed', '#1']).status, 2);
    assert.equal(await readFile(file, 'utf8'), after);
  });
});

test('add.mjs and release.mjs refuse a file that is already invalid', async () => {
  const broken = replace(FULL, '### Fixed', '### Fixes');
  await withRepo({ [PATH]: broken }, async (root) => {
    const file = join(root, PATH);
    assert.equal(run('add.mjs', [file, 'Added', '#1', 'x']).status, 1);
    assert.equal(run('release.mjs', [file, '0.3.0', '--date=2026-11-23']).status, 1);
    assert.equal(await readFile(file, 'utf8'), broken);
  });
});

test('release.mjs releases and refuses bad versions', async () => {
  await withRepo({ [PATH]: FULL }, async (root) => {
    const file = join(root, PATH);
    const low = run('release.mjs', [file, '0.2.0', '--date=2026-11-23']);
    assert.equal(low.status, 1);
    assert.match(low.stderr, /not above the newest release, 0\.2\.0/);
    assert.equal(await readFile(file, 'utf8'), FULL);

    const ok = run('release.mjs', [file, '0.3.0', '--date=2026-11-23']);
    assert.deepEqual([ok.status, ok.stdout, ok.stderr], [0, '', '']);
    assert.match(await readFile(file, 'utf8'), /## \[0\.3\.0\] - 2026-11-23/);

    const empty = run('release.mjs', [file, '0.4.0', '--date=2026-11-24']);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /no entries/);
    assert.equal(run('release.mjs', [file]).status, 2);
  });
});
