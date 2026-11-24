// release.test.mjs - the release.mjs CLI contract: exit codes, stdout JSON, what it runs, and what it refuses.
// Each test gets its own git repo with a bare "origin", and stub gh, cargo, security, xcrun, pnpm and Sparkle's sign_update and generate_keys on PATH
// that record their arguments and replay fixtures. No test calls GitHub or an Apple tool.
//   node --test release.test.mjs     (run from this directory)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateBranchName } from '../../branch-naming/branch-name.mjs';

const cliPath = fileURLToPath(new URL('./release.mjs', import.meta.url));
const VERSION = '0.1.0';
const DMG = `Plaintask_${VERSION}_aarch64.dmg`;
const STUBBED = ['gh', 'cargo', 'security', 'xcrun', 'pnpm', 'sign_update', 'generate_keys'];

// Replays the fixture whose key is the longest prefix of "<tool> <args>". A list fixture replays one reply per call, then repeats its last.
const STUB = `import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const line = process.argv.slice(2).join(' ');
const fixtures = JSON.parse(readFileSync(process.env.STUB_FIXTURES, 'utf8'));
const key = Object.keys(fixtures).filter((k) => line.startsWith(k)).sort((a, b) => b.length - a.length)[0];
const calls = existsSync(process.env.STUB_LOG) ? readFileSync(process.env.STUB_LOG, 'utf8').split('\\n').filter((l) => key && l.startsWith(key)).length : 0;
appendFileSync(process.env.STUB_LOG, line + '\\n');
const fixture = key ? fixtures[key] : { status: 1, stderr: 'stub: no fixture for ' + line };
const reply = Array.isArray(fixture) ? fixture[Math.min(calls, fixture.length - 1)] : fixture;
process.stdout.write(typeof reply.stdout === 'string' ? reply.stdout : JSON.stringify(reply.stdout ?? ''));
process.stderr.write(reply.stderr ?? '');
process.exitCode = reply.status ?? 0;
`;

const MANIFESTS = {
  'apps/desktop/package.json': '{\n  "name": "@plaintask/desktop",\n  "version": "0.0.0"\n}\n',
  'apps/desktop/src-tauri/tauri.conf.json': '{\n  "productName": "Plaintask",\n  "version": "0.0.0"\n}\n',
  'apps/desktop/src-tauri/Cargo.toml': '[package]\nname = "plaintask"\nversion = "0.0.0"\n',
  'apps/desktop/src-tauri/Cargo.lock': '[[package]]\nname = "plaintask"\nversion = "0.0.0"\n',
};
const CHANGELOG = 'apps/desktop/CHANGELOG.md';
/** The updates' EdDSA key: the app's Info.plist trusts its public half, and the stub sign_update signs with it. */
const SPARKLE_KEY = generateKeyPairSync('ed25519');
const SPARKLE_PUBLIC_KEY = Buffer.from(SPARKLE_KEY.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const INFO_PLIST = ['<?xml version="1.0" encoding="UTF-8"?>', '<plist version="1.0">', '<dict>',
  '  <key>SUFeedURL</key>', '  <string>https://github.com/airshiplabs/plaintask/releases/latest/download/appcast.xml</string>',
  '  <key>SUPublicEDKey</key>', `  <string>${SPARKLE_PUBLIC_KEY}</string>`, '</dict>', '</plist>', ''].join('\n');
/** What sign_update prints for `bytes`, signed with `key` from the login Keychain. */
const signUpdate = (bytes, key = SPARKLE_KEY.privateKey) => ({ stdout: `sparkle:edSignature="${sign(null, Buffer.from(bytes), key).toString('base64')}" sparkle:length="${bytes.length}"\n` });
// The empty template from .claude/skills/keep-a-changelog/FORMAT.md, for the desktop component.
const EMPTY_CHANGELOG = [
  '# Changelog', '', 'All notable changes to this project are documented in this file.', '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),',
  'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).', '',
  '## [Unreleased]', '', '[Unreleased]: https://github.com/airshiplabs/plaintask/commits/HEAD/apps/desktop', '',
].join('\n');
const TAG = `desktop-v${VERSION}`;
const BRANCH = 'chore--release-desktop-v0-1-0';
const ENTRIES = [{ type: 'Added', ref: '#1', text: 'Inbox list backed by Inbox.md' }];
const FIX = [{ type: 'Fixed', ref: '#4', text: 'The chosen folder is kept after the app restarts' }];
const NO_RELEASE = { status: 1, stderr: 'release not found\n' };
const GREEN = { stdout: { check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] } };
const RED = { stdout: { check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }] } };
const BASE_FIXTURES = { 'gh pr list': { stdout: [] }, 'gh release view': NO_RELEASE, 'gh api': GREEN, 'cargo update': {} };

/** A work clone on main with the four manifests and an empty desktop changelog committed and pushed to a bare origin, plus the stub tools. */
function makeRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'plaintask-release-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const work = join(dir, 'work');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  for (const tool of STUBBED) {
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, 'stub.mjs')}" ${tool} "$@"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
    STUB_FIXTURES: join(dir, 'fixtures.json'), STUB_LOG: join(dir, 'stub.log'), RELEASE_POLL_MS: '1', CLAUDE_CODE_SESSION_ID: 'test-session',
  };
  const repo = { dir, work, env };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: existsSync(work) ? work : dir, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  repo.git = git;
  repo.write = (path, text) => {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  };
  repo.commit = (files, message) => {
    for (const [path, text] of Object.entries(files)) repo.write(path, text);
    git('add', '--all');
    git('commit', '--quiet', '--message', message);
    git('push', '--quiet', 'origin', 'HEAD:main');
    git('fetch', '--quiet', 'origin');
    return git('rev-parse', 'HEAD');
  };
  /** Runs release.mjs in the work clone. Returns status, stdout, stderr, parsed `json`, and the stub `log` lines. */
  repo.cli = (args, fixtures = {}) => {
    writeFileSync(env.STUB_FIXTURES, JSON.stringify({ ...BASE_FIXTURES, ...fixtures }));
    rmSync(env.STUB_LOG, { force: true });
    const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: work, env, encoding: 'utf8' });
    const log = existsSync(env.STUB_LOG) ? readFileSync(env.STUB_LOG, 'utf8').split('\n').filter(Boolean) : [];
    return { ...result, log, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  };

  git('init', '--quiet', '--bare', '--initial-branch', 'main', 'origin.git');
  git('init', '--quiet', '--initial-branch', 'main', 'work');
  git('remote', 'add', 'origin', join(dir, 'origin.git'));
  repo.write('.gitignore', 'dist/\n');
  repo.commit({ ...MANIFESTS, [CHANGELOG]: EMPTY_CHANGELOG, 'apps/desktop/src-tauri/Info.plist': INFO_PLIST }, 'feat(desktop): add the app (#1)');
  repo.entries = join(dir, 'entries.json');
  writeFileSync(repo.entries, JSON.stringify(ENTRIES));
  return repo;
}

/** Cuts the release in the work clone and lands it on origin/main, as a merged release pull request would. */
function landRelease(repo) {
  assert.equal(repo.cli(['cut', '--version', VERSION, '--entries', repo.entries, '--date', '2026-11-22']).status, 0);
  repo.git('add', '--all');
  repo.git('commit', '--quiet', '--message', `chore(desktop): release ${VERSION} (#2)`);
  repo.git('push', '--quiet', 'origin', 'HEAD:main');
  repo.git('fetch', '--quiet', 'origin');
  return repo.git('rev-parse', 'HEAD');
}

const DMG_BYTES = 'not a real disk image';

/** Writes dist/release/<V>/ as a finished build of `sha` would leave it. `verified` adds a passing verify.json, `qa` a passing qa.json. */
function fakeBuild(repo, sha, { signature = 'developer-id', verified = true, dirty = false, qa = verified } = {}) {
  const out = `dist/release/${VERSION}`;
  const bytes = DMG_BYTES;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  repo.write(`${out}/${DMG}`, bytes);
  repo.write(`${out}/SHA256SUMS.txt`, `${sha256}  ${DMG}\n`);
  repo.write(`${out}/build.json`, JSON.stringify({
    version: VERSION, sha, dirty, signature, identity: 'Developer ID Application: Test (AB12CD34EF)', teamName: 'Test', teamId: 'AB12CD34EF',
    dmg: DMG, notary: { id: 'n-1', status: 'Accepted' }, bytes: bytes.length, sha256,
  }));
  if (verified) repo.write(`${out}/verify.json`, JSON.stringify({ version: VERSION, ok: true, sha256, checks: [{ id: 'dmg-sha256', ok: true, detail: sha256 }] }));
  if (qa) repo.write(`${out}/qa.json`, JSON.stringify({ version: VERSION, ok: true, verdict: 'ready', sha, sha256, blockers: [], issues: [7], recordedAt: '2026-11-22T09:00:00Z' }));
  else rmSync(join(repo.work, `${out}/qa.json`), { force: true });
  return { sha256, bytes: bytes.length };
}

const release = (isDraft, bytes) => ({
  stdout: { isDraft, url: `https://github.com/airshiplabs/plaintask/releases/tag/${TAG}`, tagName: TAG, publishedAt: '2026-11-22T10:00:00Z', assets: [{ name: DMG, size: bytes }, { name: 'SHA256SUMS.txt', size: 90 }, { name: 'appcast.xml', size: 900 }] },
});

test('a usage error exits 2 with the usage line and nothing on stdout', (t) => {
  const repo = makeRepo(t);
  const rows = [[], ['nope'], ['cut', '--version', VERSION], ['check', '--version', 'v0.1.0'], ['check'], ['build', '--version', VERSION],
    ['build', '--version', VERSION, '--sha', 'abc', '--adhoc'], ['status', '--entries', 'x'], ['stage', '--version']];
  for (const args of rows) {
    const result = repo.cli(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /^usage: release\.mjs /, args.join(' '));
    assert.equal(result.stdout, '', args.join(' '));
  }
});

test('outside a git checkout exits 2', (t) => {
  const repo = makeRepo(t);
  const result = spawnSync(process.execPath, [cliPath, 'status'], { cwd: repo.dir, env: { ...repo.env, GIT_CEILING_DIRECTORIES: repo.dir }, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must run inside the plaintask git checkout/);
});

test('plan lists the commits on the release paths and bumps by the changelog entries', (t) => {
  const repo = makeRepo(t);
  const fixes = join(repo.dir, 'fixes.json');
  writeFileSync(fixes, JSON.stringify(FIX));

  const undrafted = repo.cli(['plan']);
  assert.equal(undrafted.status, 0, undrafted.stderr);
  assert.deepEqual({ last: undrafted.json.last, next: undrafted.json.next, commits: undrafted.json.commits.length }, { last: null, next: null, commits: 1 });
  const drafted = repo.cli(['plan', '--entries', repo.entries]);
  assert.deepEqual({ next: drafted.json.next, bump: drafted.json.bump, additions: drafted.json.additions }, { next: '0.1.0', bump: 'minor', additions: ENTRIES });

  repo.git('tag', TAG);
  repo.git('tag', 'v9.0.0');
  repo.git('push', '--quiet', 'origin', TAG, 'v9.0.0');
  const none = repo.cli(['plan']);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /nothing to release: no commit on apps\/desktop or packages\/design-system since 0\.1\.0/);

  repo.commit({ 'sites/index.html': 'x' }, 'feat(sites): add a page (#3)');
  assert.equal(repo.cli(['plan']).status, 1, 'a commit outside the release paths is not a release');

  repo.commit({ 'apps/desktop/src/app.ts': 'x' }, 'fix(desktop): keep the folder (#4)');
  const pending = repo.cli(['plan']);
  assert.deepEqual({ next: pending.json.next, subjects: pending.json.commits.map((c) => c.subject) }, { next: null, subjects: ['fix(desktop): keep the folder (#4)'] });
  const patch = repo.cli(['plan', '--entries', fixes]);
  assert.deepEqual({ last: patch.json.last, next: patch.json.next, bump: patch.json.bump }, { last: '0.1.0', next: '0.1.1', bump: 'patch' });

  assert.equal(repo.cli(['plan', '--entries', fixes, '--version', '1.0.0']).json.bump, 'explicit');
  const stale = repo.cli(['plan', '--entries', fixes, '--version', '0.1.0']);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /version 0\.1\.0 is not above the last release 0\.1\.0/);
});

test('cut adds the entries, cuts the changelog, writes the four manifests, and a second cut changes nothing', (t) => {
  const repo = makeRepo(t);
  const dry = repo.cli(['cut', '--version', '0.2.0', '--entries', repo.entries, '--date', '2026-11-22', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.json.section, '## [0.2.0] - 2026-11-22\n\n### Added\n\n- Inbox list backed by Inbox.md (#1)');
  assert.equal(repo.git('status', '--porcelain'), '', '--dry-run writes nothing');
  assert.equal(repo.cli(['check', '--version', '0.2.0']).status, 1);

  const cut = repo.cli(['cut', '--version', '0.2.0', '--entries', repo.entries, '--date', '2026-11-22']);
  assert.equal(cut.status, 0, cut.stderr);
  assert.equal(cut.stdout, '');
  assert.ok(cut.log.some((line) => line.startsWith('cargo update --workspace --locked --offline')));
  for (const path of Object.keys(MANIFESTS)) assert.match(readFileSync(join(repo.work, path), 'utf8'), /"0\.2\.0"/, path);
  const changelog = readFileSync(join(repo.work, CHANGELOG), 'utf8');
  assert.match(changelog, /## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-11-22\n\n### Added\n\n- Inbox list backed by Inbox\.md \(\[#1\]\)\n/);
  assert.match(changelog, /\[0\.2\.0\]: https:\/\/github\.com\/airshiplabs\/plaintask\/releases\/tag\/desktop-v0\.2\.0\n/);
  assert.equal(repo.cli(['check', '--version', '0.2.0']).status, 0);

  assert.equal(repo.cli(['cut', '--version', '0.2.0', '--entries', repo.entries]).status, 0);
  assert.equal(readFileSync(join(repo.work, CHANGELOG), 'utf8'), changelog, 'the release keeps its date');

  const stale = repo.cli(['check', '--version', '0.3.0']);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /apps\/desktop\/package\.json records 0\.2\.0, expected 0\.3\.0/);
  assert.match(stale.stderr, /has no "## \[0\.3\.0\]" release/);

  repo.write(CHANGELOG, changelog.replace('### Added', '### Improved'));
  const broken = repo.cli(['check', '--version', '0.2.0']);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /section-name: /);
});

test('cut refuses a bad entries file, an entry the format rejects, an empty release, and a lock file cargo rejects', (t) => {
  const repo = makeRepo(t);
  const cutWith = (entries, fixtures) => {
    writeFileSync(repo.entries, JSON.stringify(entries));
    return repo.cli(['cut', '--version', VERSION, '--entries', repo.entries], fixtures);
  };
  const shape = cutWith({ Added: ['x'] });
  assert.equal(shape.status, 1);
  assert.match(shape.stderr, /is not an entries file:\n.*must hold a list/);
  assert.match(shape.stderr, /see .*references\/changelog\.md/);

  const long = cutWith([{ type: 'Added', ref: '#1', text: 'x'.repeat(101) }]);
  assert.equal(long.status, 1);
  assert.match(long.stderr, /entry-length: /);

  const empty = cutWith([]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /has no entries to release/);
  assert.equal(repo.git('status', '--porcelain'), '', 'a refused cut writes nothing');

  assert.equal(repo.cli(['cut', '--version', VERSION, '--entries', join(repo.dir, 'absent.json')]).status, 2);
  const locked = cutWith(ENTRIES, { 'cargo update': { status: 101, stderr: 'error: cannot update the lock file\n' } });
  assert.equal(locked.status, 1);
  assert.match(locked.stderr, /cannot update the lock file/);
});

test('status reports each phase from the facts it finds', (t) => {
  const repo = makeRepo(t);
  const open = { stdout: [{ number: 2, state: 'OPEN', url: 'https://example.test/pr/2', mergeCommit: null, headRefOid: 'h', headRefName: BRANCH }] };
  const phase = (fixtures, args = ['status']) => {
    const result = repo.cli(args, fixtures);
    assert.equal(result.status, 0, result.stderr);
    return [result.json.version, result.json.phase, result.json.next];
  };
  assert.deepEqual(phase(), [null, 'plan', 'draft-changelog'], 'no version until the entries are drafted');
  assert.deepEqual(phase({}, ['status', '--version', VERSION]), [VERSION, 'plan', 'draft-changelog']);
  assert.deepEqual(phase({ 'gh pr list': open }), [VERSION, 'pr-open', 'land-release-pr'], 'the open release pull request names the version');

  const sha = landRelease(repo);
  assert.deepEqual(phase(), [VERSION, 'pr-merged', 'build-artifact'], 'the version bump on main names the version');
  assert.equal(repo.cli(['status']).json.releaseSha, sha);

  const { bytes } = fakeBuild(repo, sha, { verified: false });
  assert.deepEqual(phase(), [VERSION, 'built', 'verify-artifact']);
  fakeBuild(repo, sha, { qa: false });
  assert.deepEqual(phase(), [VERSION, 'verified', 'qa-release']);
  fakeBuild(repo, sha);
  assert.deepEqual(phase(), [VERSION, 'qa-passed', 'stage-release']);
  assert.deepEqual(phase({ 'gh release view': release(true, bytes) }), [VERSION, 'staged', 'publish-release']);
  assert.deepEqual(phase({ 'gh release view': release(false, bytes) }), [VERSION, 'published', 'done']);

  repo.git('tag', TAG);
  repo.git('push', '--quiet', 'origin', TAG);
  const idle = repo.cli(['status']);
  assert.deepEqual([idle.json.version, idle.json.next], [null, 'none']);
  assert.match(idle.json.problems[0], /nothing to release/);
  assert.match(repo.cli(['status', '--version', VERSION]).json.problems.join('\n'), /tag desktop-v0\.1\.0 is on origin and no GitHub release exists/);
});

test('status names build-artifact and a problem when verify.json records a failed check', (t) => {
  const repo = makeRepo(t);
  const sha = landRelease(repo);
  const { sha256 } = fakeBuild(repo, sha, { verified: false });
  repo.write(`dist/release/${VERSION}/verify.json`, JSON.stringify({
    version: VERSION, ok: false, sha256, checks: [{ id: 'dmg-sha256', ok: true, detail: sha256 }, { id: 'launch', ok: false, detail: 'no "ready" within 15000 ms' }],
  }));
  const failed = repo.cli(['status']);
  assert.equal(failed.status, 0, failed.stderr);
  assert.deepEqual([failed.json.phase, failed.json.next, failed.json.releaseSha], ['built', 'build-artifact', sha]);
  assert.equal(failed.json.problems.length, 1);
  assert.match(failed.json.problems[0], /verify\.json records a failed verify \(launch\): fix the cause and build again/);

  fakeBuild(repo, sha);
  const passed = repo.cli(['status']);
  assert.deepEqual([passed.json.next, passed.json.problems], ['stage-release', []], 'a passing verify.json raises nothing');
});

test('status names build-artifact and the new commit when main is ahead of the build and no tag exists', (t) => {
  const repo = makeRepo(t);
  const sha = landRelease(repo);
  const { bytes } = fakeBuild(repo, sha);
  const main = repo.commit({ 'apps/desktop/src/app.ts': 'x' }, 'fix(desktop): keep the folder (#4)');

  const ahead = repo.cli(['status']);
  assert.equal(ahead.status, 0, ahead.stderr);
  assert.deepEqual([ahead.json.phase, ahead.json.next, ahead.json.releaseSha], ['qa-passed', 'build-artifact', main]);
  assert.equal(ahead.json.problems.length, 1);
  assert.match(ahead.json.problems[0], new RegExp(`origin/main is at ${main}, ahead of the build of ${sha}: build again with --sha ${main}`));

  repo.git('tag', TAG, sha);
  repo.git('push', '--quiet', 'origin', TAG);
  const staged = repo.cli(['status', '--version', VERSION], { 'gh release view': release(true, bytes) });
  assert.deepEqual([staged.json.next, staged.json.releaseSha, staged.json.problems], ['publish-release', sha, []], 'a tagged release is not rebuilt for a later commit');
});

test('preflight warns, and does not fail the check, when the notary history is empty', (t) => {
  const repo = makeRepo(t);
  const notary = (reply) => repo.cli(['preflight'], { 'xcrun notarytool history': reply }).json.checks.find((item) => item.id === 'notary-profile');

  const empty = notary({ stdout: { history: [], message: 'No submission history.' } });
  assert.deepEqual([empty.ok, empty.warn], [true, true]);
  assert.match(empty.detail, /keychain profile "plaintask-notary" has no notary submission/);
  assert.match(empty.fix, /one-time test submission.*references\/setup\.md/);

  assert.deepEqual(notary({ stdout: { history: [{ id: 'n-1', status: 'Accepted' }] } }), { id: 'notary-profile', ok: true, detail: 'ok' });

  const unreachable = notary({ status: 1, stderr: 'Error: No Keychain password item found for profile: plaintask-notary\n' });
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.fix, /store the notary credentials/);
});

test('preflight exits 2 and runs no quality gate when the signing identity is missing', (t) => {
  const repo = makeRepo(t);
  const result = repo.cli(['preflight'], {
    'security find-identity': { stdout: '     0 valid identities found\n' }, 'gh auth status': {}, 'gh repo view': { stdout: { nameWithOwner: 'airshiplabs/plaintask' } },
  });
  assert.equal(result.status, 2);
  const byId = Object.fromEntries(result.json.checks.map((item) => [item.id, item]));
  assert.equal(result.json.ok, false);
  assert.match(byId['signing-identity'].detail, /no Developer ID Application identity/);
  assert.match(byId['signing-identity'].fix, /references\/setup\.md/);
  assert.equal(byId['notary-profile'].ok, false);
  assert.equal(byId['ci-main'].ok, true);
  assert.match(byId['git-hooks'].detail, /not installed: commit-msg, pre-commit/);
  for (const gate of ['gate-changelogs', 'gate-test', 'gate-typecheck', 'gate-rust']) assert.equal(byId[gate].detail, 'not run: a setup check failed');
  assert.ok(!result.log.some((line) => line.startsWith('pnpm ')));
  assert.match(result.stderr, /preflight: .*signing-identity.* failed\nsee .*references\/setup\.md/);
});

test('pr --dry-run prints each command and changes nothing', (t) => {
  const repo = makeRepo(t);
  const result = repo.cli(['pr', '--version', VERSION, '--entries', repo.entries, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  const would = result.stderr.split('\n').filter((line) => line.startsWith('would '));
  assert.deepEqual(would.map((line) => line.split(' ').slice(0, 4).join(' ')), [
    'would run: git switch', 'would write: apps/desktop/CHANGELOG.md and', 'would run: git add', 'would run: git commit', 'would run: git push', 'would run: gh pr', 'would run: gh pr',
  ]);
  assert.match(would[3], /--message chore\(desktop\): release 0\.1\.0$/);
  assert.equal(repo.git('status', '--porcelain'), '');
  assert.equal(repo.git('branch', '--list', 'chore--release-*'), '');
  assert.ok(!result.log.some((line) => line.startsWith('gh pr create')));
});

test('pr commits the release on its branch and pushes nothing when the commit is not signed', (t) => {
  const repo = makeRepo(t);
  const result = repo.cli(['pr', '--version', VERSION, '--entries', repo.entries]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the release commit has no valid signature/);
  assert.equal(repo.git('log', '-1', '--format=%s', BRANCH), 'chore(desktop): release 0.1.0');
  assert.deepEqual(repo.git('show', '--format=', '--name-only', BRANCH).split('\n'), [CHANGELOG, ...Object.keys(MANIFESTS)].sort());
  assert.deepEqual(validateBranchName(BRANCH), [], 'the release branch name passes the branch-naming skill');
  assert.equal(repo.git('ls-remote', 'origin', `refs/heads/${BRANCH}`), '', 'nothing was pushed');
  assert.ok(!result.log.some((line) => line.startsWith('gh pr create')));

  const body = readFileSync(join(repo.work, `dist/release/${VERSION}/release-pr-body.md`), 'utf8');
  assert.match(body, /^Release Plaintask 0\.1\.0 for macOS\.\n/);
  assert.match(body, /## Changelog\n\n### Added\n\n- Inbox list backed by Inbox\.md \(#1\)\n/);
  assert.match(body, /tags the commit `desktop-v0\.1\.0`/);
  assert.ok(!body.includes('- [ ]'), 'an unchecked box would block the merge');
  assert.ok(body.endsWith('\n\nClaude Code session: test-session\n'), 'the body ends with the agent session footer');
});

test('pr merges an open pull request once the required check passes, and never when it fails', (t) => {
  const repo = makeRepo(t);
  const main = repo.git('rev-parse', 'origin/main');
  const found = (state, mergeCommit) => ({ stdout: [{ number: 7, state, url: 'https://example.test/pr/7', mergeCommit, headRefOid: 'headsha' }] });

  const red = repo.cli(['pr', '--version', VERSION, '--entries', repo.entries], { 'gh pr list': found('OPEN', null), 'gh api': RED });
  assert.equal(red.status, 1);
  assert.match(red.stderr, /"test" check failed on pull request #7/);
  assert.ok(!red.log.some((line) => line.startsWith('gh pr merge')));

  const pending = { stdout: { check_runs: [{ name: 'test', status: 'in_progress', conclusion: null }] } };
  const green = repo.cli(['pr', '--version', VERSION, '--entries', repo.entries], {
    'gh pr list': [found('OPEN', null), found('OPEN', null), found('MERGED', { oid: main })], 'gh api': [{ stdout: { check_runs: [] } }, pending, GREEN], 'gh pr merge': {},
  });
  assert.equal(green.status, 0, green.stderr);
  assert.deepEqual(green.json, { pr: 7, url: 'https://example.test/pr/7', mergeSha: main });
  assert.ok(green.log.includes('gh pr merge 7 --squash --match-head-commit headsha'));
  assert.equal(green.log.filter((line) => line.startsWith('gh api')).length, 3, 'polled until the check finished');

  const again = repo.cli(['pr', '--version', VERSION, '--entries', repo.entries], { 'gh pr list': found('MERGED', { oid: main }) });
  assert.deepEqual(again.json, green.json, 'a rerun after the merge reports the same result');
  assert.ok(!again.log.some((line) => line.startsWith('gh pr merge')));
});

test('build refuses to rebuild over an existing release, and stops without a signing identity', (t) => {
  const repo = makeRepo(t);
  const sha = repo.git('rev-parse', 'HEAD');
  const exists = repo.cli(['build', '--version', VERSION, '--sha', sha], { 'gh release view': release(true, 1) });
  assert.equal(exists.status, 1);
  assert.match(exists.stderr, /a GitHub release for desktop-v0\.1\.0 exists/);

  const noIdentity = repo.cli(['build', '--version', VERSION, '--sha', sha], { 'security find-identity': { stdout: '     0 valid identities found\n' } });
  assert.equal(noIdentity.status, 2);
  assert.match(noIdentity.stderr, /no Developer ID Application identity is in the keychain\nsee .*references\/setup\.md/);
  assert.ok(!noIdentity.log.some((line) => line.startsWith('pnpm')));
});

test('verify, stage and publish exit 2 when there is no finished build', (t) => {
  const repo = makeRepo(t);
  for (const command of ['verify', 'stage', 'publish']) {
    const result = repo.cli([command, '--version', VERSION]);
    assert.equal(result.status, 2, command);
    assert.match(result.stderr, /no finished build in .*run build first/, command);
  }
});

test('stage refuses a build that is ad-hoc, dirty, unverified, or changed since it was verified', (t) => {
  const repo = makeRepo(t);
  const sha = landRelease(repo);
  const refused = (expected) => {
    const result = repo.cli(['stage', '--version', VERSION]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.ok(!result.log.some((line) => line.startsWith('gh release create')));
    assert.equal(repo.git('tag', '--list'), '');
  };
  fakeBuild(repo, sha, { signature: 'adhoc' });
  refused(/signed adhoc; only a Developer ID build can be released/);
  fakeBuild(repo, sha, { dirty: true });
  refused(/uncommitted changes/);
  fakeBuild(repo, sha, { verified: false });
  rmSync(join(repo.work, `dist/release/${VERSION}/verify.json`));
  refused(/no passing verify\.json/);
  fakeBuild(repo, sha);
  repo.write(`dist/release/${VERSION}/${DMG}`, 'tampered');
  refused(/changed after it was built and verified/);
});

test('stage waits for CI, and --dry-run prints the tag, push and draft release without making them', (t) => {
  const repo = makeRepo(t);
  const sha = landRelease(repo);
  fakeBuild(repo, sha);

  const waiting = repo.cli(['stage', '--version', VERSION], { 'gh api': { stdout: { check_runs: [] } } });
  assert.equal(waiting.status, 3);
  assert.match(waiting.stderr, /run the same command again/);
  assert.equal(repo.cli(['stage', '--version', VERSION], { 'gh api': RED }).status, 1);

  const forged = repo.cli(['stage', '--version', VERSION, '--dry-run'], { sign_update: signUpdate(DMG_BYTES, generateKeyPairSync('ed25519').privateKey) });
  assert.equal(forged.status, 1);
  assert.match(forged.stderr, /would not install as an update: the signature does not match the file and SUPublicEDKey/);

  const dry = repo.cli(['stage', '--version', VERSION, '--dry-run'], { sign_update: signUpdate(DMG_BYTES) });
  assert.equal(dry.status, 0, dry.stderr);
  const would = dry.stderr.split('\n').filter((line) => line.startsWith('would run: '));
  assert.equal(would[0], `would run: git tag --sign desktop-v0.1.0 ${sha} --message Plaintask 0.1.0 for macOS`);
  assert.equal(would[1], 'would run: git push origin refs/tags/desktop-v0.1.0');
  assert.match(would[2], /^would run: gh release create desktop-v0\.1\.0 .*Plaintask_0\.1\.0_aarch64\.dmg .*SHA256SUMS\.txt .*appcast\.xml --draft --verify-tag --title Plaintask 0\.1\.0 for macOS --notes-file /);
  assert.equal(repo.git('tag', '--list'), '');
  assert.equal(existsSync(join(repo.work, `dist/release/${VERSION}/release-notes.md`)), false);

  const published = repo.cli(['stage', '--version', VERSION], { 'gh release view': release(false, 1) });
  assert.equal(published.status, 1);
  assert.match(published.stderr, /already published/);
});

test('publish needs a staged release whose tag and assets match the verified build', (t) => {
  const repo = makeRepo(t);
  const sha = landRelease(repo);
  const { bytes } = fakeBuild(repo, sha);

  const none = repo.cli(['publish', '--version', VERSION]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no GitHub release for desktop-v0\.1\.0: run stage first/);
  assert.match(repo.cli(['publish', '--version', VERSION], { 'gh release view': release(true, bytes) }).stderr, /tag desktop-v0\.1\.0 on origin does not point at the built commit/);

  repo.git('tag', '--annotate', TAG, sha, '--message', 'Plaintask 0.1.0 for macOS');
  repo.git('push', '--quiet', 'origin', TAG);
  assert.match(repo.cli(['publish', '--version', VERSION], { 'gh release view': release(true, bytes + 1) }).stderr, /the verified build is \d+ bytes/);

  const dry = repo.cli(['publish', '--version', VERSION, '--dry-run'], { 'gh release view': release(true, bytes) });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stderr, /would run: gh release edit desktop-v0\.1\.0 --draft=false --latest/);
  assert.ok(!dry.log.some((line) => line.startsWith('gh release edit') || line.startsWith('gh release download')));
});

test('qa records the verdict of the verified build, and refuses a verdict its issue lists contradict', (t) => {
  const repo = makeRepo(t);
  const sha = landRelease(repo);
  const report = join(repo.dir, 'qa-report.md');
  writeFileSync(report, '# QA\n');
  const qa = (...args) => repo.cli(['qa', '--version', VERSION, ...args]);

  assert.equal(qa('--verdict', 'ready').status, 2, 'qa needs --report');
  assert.equal(qa('--verdict', 'ready', '--report', report).status, 2, 'qa needs a finished build');
  fakeBuild(repo, sha, { qa: false });
  assert.match(qa('--verdict', 'maybe', '--report', report).stderr, /--verdict must be ready or blocked/);
  assert.match(qa('--verdict', 'blocked', '--report', report).stderr, /a blocked verdict needs --blockers/);
  assert.match(qa('--verdict', 'ready', '--report', report, '--blockers', '3').stderr, /a ready verdict cannot list --blockers/);
  assert.match(qa('--verdict', 'ready', '--report', report, '--issues', '#3').stderr, /--issues must list issue numbers/);
  assert.match(qa('--verdict', 'ready', '--report', join(repo.dir, 'none.md')).stderr, /no QA report at/);

  const issue = (state, labels) => ({ stdout: { number: 1, state, labels: labels.map((name) => ({ name })) } });
  const found = { 'gh issue view': issue('OPEN', ['bug', 'release-blocker']) };
  const blockedBy = (fixtures) => repo.cli(['qa', '--version', VERSION, '--verdict', 'blocked', '--report', report, '--blockers', '12,13', '--issues', '14'], fixtures);
  assert.match(blockedBy({ 'gh issue view': issue('CLOSED', ['bug', 'release-blocker']) }).stderr, /blocker #12 is CLOSED, not OPEN/);
  assert.match(blockedBy({ 'gh issue view': issue('OPEN', ['bug']) }).stderr, /blocker #12 has no release-blocker label/);
  assert.equal(blockedBy({ 'gh issue view': { status: 1, stderr: 'issue not found\n' } }).status, 1, 'an issue that does not exist is refused');
  const blocked = blockedBy(found);
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.deepEqual([blocked.json.ok, blocked.json.blockers, blocked.json.issues, blocked.json.sha], [false, [12, 13], [14], sha]);
  assert.equal(readFileSync(join(repo.work, `dist/release/${VERSION}/qa-report.md`), 'utf8'), '# QA\n');
  const status = repo.cli(['status']);
  assert.deepEqual([status.json.phase, status.json.next], ['verified', 'build-artifact']);
  assert.match(status.json.problems.join('\n'), /qa\.json records release blockers \(#12, #13\): fix forward/);
  const refused = repo.cli(['stage', '--version', VERSION]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /qa\.json records release blockers \(#12, #13\)/);
  assert.ok(!refused.log.some((line) => line.startsWith('gh release create')));

  const ready = repo.cli(['qa', '--version', VERSION, '--verdict', 'ready', '--report', report, '--issues', '14'], { 'gh issue view': issue('OPEN', ['bug']) });
  assert.equal(ready.status, 0, ready.stderr);
  assert.deepEqual([repo.cli(['status']).json.phase, repo.cli(['status']).json.next], ['qa-passed', 'stage-release']);

  const staged = repo.cli(['qa', '--version', VERSION, '--verdict', 'ready', '--report', report], { 'gh release view': release(true, 1) });
  assert.equal(staged.status, 1);
  assert.match(staged.stderr, /a GitHub release for desktop-v0\.1\.0 exists; QA runs before stage/);
});

test('stage and publish refuse a verified build with no qa.json, or a qa.json of another build', (t) => {
  const repo = makeRepo(t);
  const sha = landRelease(repo);
  fakeBuild(repo, sha, { qa: false });
  for (const command of ['stage', 'publish']) {
    const result = repo.cli([command, '--version', VERSION]);
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /has no qa\.json for sha256 .*run the qa-release task/, command);
  }
  repo.write(`dist/release/${VERSION}/qa.json`, JSON.stringify({ ok: true, verdict: 'ready', sha256: 'other', blockers: [], issues: [] }));
  assert.match(repo.cli(['stage', '--version', VERSION]).stderr, /has no qa\.json for sha256/);
});

test('plan reads a tag named in moved-tags.json as the release it names', (t) => {
  const repo = makeRepo(t);
  repo.commit({ 'apps/desktop/moved-tags.json': '{ "0.1.0": "desktop-v0.1.0-moved" }\n' }, 'chore(desktop): name the moved tag (#2)');
  repo.git('tag', 'desktop-v0.1.0-moved');
  repo.git('push', '--quiet', 'origin', 'desktop-v0.1.0-moved');
  repo.commit({ 'apps/desktop/src/app.ts': 'x' }, 'fix(desktop): keep the folder (#4)');
  const fixes = join(repo.dir, 'fixes.json');
  writeFileSync(fixes, JSON.stringify(FIX));
  const plan = repo.cli(['plan', '--entries', fixes]);
  assert.equal(plan.status, 0, plan.stderr);
  assert.deepEqual({ last: plan.json.last, next: plan.json.next, subjects: plan.json.commits.map((c) => c.subject) }, { last: '0.1.0', next: '0.1.1', subjects: ['fix(desktop): keep the folder (#4)'] });
});
