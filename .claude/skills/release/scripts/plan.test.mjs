// plan.test.mjs - versions, commit classification, manifest edits, and phase derivation in plan.mjs.
//   node --test plan.test.mjs     (run from this directory)
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCommit, compareVersions, derivePhase, latestVersionTag, nextVersion, parseVersion,
  readManifestVersion, sectionFor, setManifestVersion,
} from './plan.mjs';

test('parseVersion accepts X.Y.Z only', () => {
  assert.deepEqual(parseVersion('1.20.3'), { major: 1, minor: 20, patch: 3 });
  for (const bad of ['v1.2.3', '1.2', '1.2.3-rc.1', '01.2.3', '1.2.3 ', '']) assert.equal(parseVersion(bad), null, bad);
});

test('compareVersions orders by number, not by text', () => {
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('2.3.4', '2.3.4'), 0);
  assert.throws(() => compareVersions('1.2', '1.2.3'), RangeError);
});

test('latestVersionTag takes the highest <prefix>X.Y.Z and ignores other tags', () => {
  assert.equal(latestVersionTag(['desktop-v0.9.0', 'desktop-v0.10.0', 'nightly', 'desktop-v1', 'mobile-v9.9.9', 'v8.0.0'], 'desktop-v'), '0.10.0');
  assert.equal(latestVersionTag(['mobile-v1.0.0'], 'desktop-v'), null);
});

test('classifyCommit reads type, scope, breaking, and the pull request number', () => {
  const feat = classifyCommit({ sha: 'a1', message: 'feat(desktop): add the macOS MVP app on Tauri 2 (#30)\n' });
  assert.deepEqual(feat, {
    sha: 'a1', subject: 'feat(desktop): add the macOS MVP app on Tauri 2 (#30)', pr: 30, conforming: true,
    type: 'feat', scope: 'desktop', breaking: false, description: 'add the macOS MVP app on Tauri 2', section: 'Added',
  });
  assert.equal(classifyCommit({ sha: 'b', message: 'fix!: drop the old file format' }).breaking, true);
  assert.equal(classifyCommit({ sha: 'c', message: 'fix: x\n\nBREAKING CHANGE: the folder moves' }).breaking, true);
  assert.equal(classifyCommit({ sha: 'd', message: 'fix: x\n\nBREAKING-CHANGE: the folder moves' }).breaking, true);
  assert.equal(classifyCommit({ sha: 'e', message: 'chore: tidy' }).section, null);
});

test('classifyCommit marks a non-conforming message and keeps its subject', () => {
  const old = classifyCommit({ sha: 'f', message: 'Add pricing page (#3)' });
  assert.deepEqual(old, {
    sha: 'f', subject: 'Add pricing page (#3)', pr: 3, conforming: false,
    type: null, scope: null, breaking: false, description: 'Add pricing page (#3)', section: null,
  });
  assert.equal(classifyCommit({ sha: 'g', message: 'feat(billing): unknown scope' }).conforming, false);
});

test('sectionFor maps user-facing types and nothing else', () => {
  assert.deepEqual(['feat', 'fix', 'perf', 'revert', 'docs', 'build'].map(sectionFor), ['Added', 'Fixed', 'Changed', 'Changed', null, null]);
});

test('nextVersion bumps by the changelog entries the release holds', () => {
  const added = { type: 'Added', text: 'Inbox list' };
  const fixed = { type: 'Fixed', text: 'Keep the folder' };
  const deprecated = { type: 'Deprecated', text: 'The old settings file goes away in 2.0.0' };
  const breaking = { type: 'Changed', text: '**Breaking:** Settings move to the new settings window' };
  const rows = [
    { name: 'the first release bumps from 0.0.0', input: { lastVersion: null, entries: [added, fixed] }, next: '0.1.0', bump: 'minor' },
    { name: 'a first release of fixes only', input: { lastVersion: null, entries: [fixed] }, next: '0.0.1', bump: 'patch' },
    { name: 'Fixed bumps patch', input: { lastVersion: '0.1.0', entries: [fixed] }, next: '0.1.1', bump: 'patch' },
    { name: 'Added bumps minor', input: { lastVersion: '0.1.4', entries: [fixed, added] }, next: '0.2.0', bump: 'minor' },
    { name: 'Deprecated bumps minor', input: { lastVersion: '1.4.2', entries: [deprecated] }, next: '1.5.0', bump: 'minor' },
    { name: 'breaking below 1.0.0 bumps minor', input: { lastVersion: '0.4.2', entries: [breaking] }, next: '0.5.0', bump: 'minor' },
    { name: 'breaking from 1.0.0 bumps major', input: { lastVersion: '1.4.2', entries: [added, breaking] }, next: '2.0.0', bump: 'major' },
    { name: 'explicit wins', input: { lastVersion: '0.1.0', entries: [fixed], explicit: '1.0.0' }, next: '1.0.0', bump: 'explicit' },
    { name: 'explicit equal to the computed version keeps its bump', input: { lastVersion: '0.1.0', entries: [fixed], explicit: '0.1.1' }, next: '0.1.1', bump: 'patch' },
  ];
  for (const { name, input, next, bump } of rows) {
    const result = nextVersion(input);
    assert.equal(result.next, next, name);
    assert.equal(result.bump, bump, name);
    assert.ok(result.reason.length > 0, name);
  }
  assert.equal(nextVersion({ lastVersion: null, entries: [added] }).reason, '1 Added or Deprecated entry, no release yet');
  assert.match(nextVersion({ lastVersion: '0.1.0', entries: [fixed], explicit: '1.0.0' }).reason, /the entries call for 0\.1\.1/);
});

test('nextVersion refuses nothing to release and a version that does not rise', () => {
  const fixed = { type: 'Fixed', text: 'Keep the folder' };
  assert.throws(() => nextVersion({ lastVersion: '0.1.0', entries: [] }), /no changelog entries to release/);
  assert.throws(() => nextVersion({ lastVersion: '0.2.0', entries: [fixed], explicit: '0.2.0' }), /not above/);
  assert.throws(() => nextVersion({ lastVersion: null, entries: [fixed], explicit: 'v1.0.0' }), /not a version/);
});

const PACKAGE_JSON = '{\n  "name": "@plaintask/desktop",\n  "private": true,\n  "version": "0.1.0",\n  "devDependencies": {\n    "x": { "version": "9.9.9" }\n  }\n}\n';
const TAURI_CONF = '{\n  "productName": "Plaintask",\n  "version": "0.1.0",\n  "identifier": "com.airshiplabs.plaintask"\n}\n';
const CARGO_TOML = '[package]\nname = "plaintask"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2", features = [] }\n';
const CARGO_LOCK = '[[package]]\nname = "pkg-config"\nversion = "0.3.34"\n\n[[package]]\nname = "plaintask"\nversion = "0.1.0"\ndependencies = [\n "tauri",\n]\n\n[[package]]\nname = "plist"\nversion = "1.10.4"\n';
const MANIFEST_TEXT = { 'package.json': PACKAGE_JSON, 'tauri.conf.json': TAURI_CONF, 'Cargo.toml': CARGO_TOML, 'Cargo.lock': CARGO_LOCK };

test('readManifestVersion finds the app version in each kind', () => {
  for (const [kind, text] of Object.entries(MANIFEST_TEXT)) assert.equal(readManifestVersion(kind, text), '0.1.0', kind);
});

test('setManifestVersion changes only the app version', () => {
  for (const [kind, text] of Object.entries(MANIFEST_TEXT)) {
    const updated = setManifestVersion(kind, text, '0.12.3');
    assert.equal(readManifestVersion(kind, updated), '0.12.3', kind);
    assert.equal(updated, text.replace('"0.1.0"', '"0.12.3"'), kind);
    assert.equal(setManifestVersion(kind, updated, '0.1.0'), text, `${kind} round trip`);
  }
});

test('manifest functions fail loud on a missing version, a bad version, and an unknown kind', () => {
  assert.throws(() => readManifestVersion('package.json', '{\n  "name": "x"\n}\n'), /no app version/);
  assert.throws(() => readManifestVersion('Cargo.toml', '[dependencies]\nversion = "1.0.0"\n'), /no app version/);
  assert.throws(() => readManifestVersion('Cargo.lock', '[[package]]\nname = "other"\nversion = "1.0.0"\n'), /no app version/);
  assert.throws(() => setManifestVersion('Cargo.toml', CARGO_TOML, '1.0'), /not a version/);
  assert.throws(() => readManifestVersion('pom.xml', ''), /unknown manifest kind/);
});

test('derivePhase reports the most advanced state the facts prove', () => {
  const none = { release: null, build: null, verify: null, mainHasRelease: false, pr: null };
  const built = { sha256: 'abc' };
  const rows = [
    [none, 'plan'],
    [{ ...none, pr: { state: 'CLOSED' } }, 'plan'],
    [{ ...none, pr: { state: 'OPEN' } }, 'pr-open'],
    [{ ...none, pr: { state: 'MERGED' }, mainHasRelease: true }, 'pr-merged'],
    [{ ...none, mainHasRelease: true, build: { notary: { id: 'x' } } }, 'pr-merged'],
    [{ ...none, mainHasRelease: true, build: built }, 'built'],
    [{ ...none, mainHasRelease: true, build: built, verify: { ok: false, sha256: 'abc' } }, 'built'],
    [{ ...none, mainHasRelease: true, build: built, verify: { ok: true, sha256: 'old' } }, 'built'],
    [{ ...none, mainHasRelease: true, build: built, verify: { ok: true, sha256: 'abc' } }, 'verified'],
    [{ ...none, mainHasRelease: true, build: built, verify: { ok: true, sha256: 'abc' }, release: { isDraft: true } }, 'staged'],
    [{ ...none, release: { isDraft: false } }, 'published'],
  ];
  for (const [facts, phase] of rows) assert.equal(derivePhase(facts), phase, JSON.stringify(facts));
});
