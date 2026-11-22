#!/usr/bin/env node
// release.mjs - every deterministic step of a Plaintask macOS release. Run from anywhere inside the repo.
//   node release.mjs status    [--version V]                     where a release stands; read-only
//   node release.mjs preflight                                   one-time setup and repo checks, then the quality gates
//   node release.mjs plan      [--version V] [--entries FILE]    commits and changelog entries since the last release tag, and the next version
//   node release.mjs cut       --version V --entries FILE [--date YYYY-MM-DD] [--dry-run]
//                                                                adds the entries, cuts apps/desktop/CHANGELOG.md, writes the four version manifests
//   node release.mjs check     --version V                       the changelog must pass its format and hold V; the manifests must equal V
//   node release.mjs pr        --version V --entries FILE [--dry-run]
//                                                                release branch, signed commit, pull request, CI, squash merge
//   node release.mjs build     --version V --sha SHA [--identity NAME|HASH]
//                                                                builds at SHA; signs, packages, notarizes, staples the DMG
//   node release.mjs build     --version V --adhoc               rehearsal: ad-hoc build of the current checkout, no notarization
//   node release.mjs verify    --version V [--adhoc]             checks the built DMG; writes verify.json
//   node release.mjs stage     --version V [--dry-run]           signed tag, tag push, draft GitHub release with the assets
//   node release.mjs publish   --version V [--dry-run]           publishes the draft, downloads the asset, compares checksums
// Output: one JSON object on stdout, or nothing. Diagnostics and the output of wrapped tools go to stderr.
// --dry-run prints "would run: <command>" for each command that changes something, and runs the read-only ones.
// The changelog format, its scripts, and the desktop-v<V> tag name belong to .claude/skills/keep-a-changelog/.
// Files: dist/release/entries.json holds the changelog entries a release adds. dist/release/<V>/ holds the DMG, SHA256SUMS.txt, build.json, verify.json, notary-log.json,
// release-notes.md and release-report.md. An --adhoc rehearsal uses dist/release/<V>-adhoc/ and can never be staged.
// Exit 0: done. Exit 1: a check failed; do not go on. Exit 2: usage error or a missing prerequisite.
// Exit 3: outside work (CI, notarization) is still running; run the same command again.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assessArtifact, CHECKSUMS_NAME, checksumLine, developerIdProblems, DMG_IDENTIFIER, dmgName, parseCodesignDisplay,
  pickIdentity, PRODUCT_NAME, SIGNATURE, tauriEnv,
} from './artifact.mjs';
import { appendFooter, sessionFooter } from '../../pr-session-footer/session-footer.mjs';
import { componentFor, validate as validateChangelog } from '../../keep-a-changelog/changelog.mjs';
import { CHANGELOG, cutRelease, entriesOf, releaseBody, render, validateAdditions } from './changelog.mjs';
import {
  classifyCommit, compareVersions, derivePhase, INITIAL_VERSION, latestVersionTag, MANIFESTS, NEXT_TASK, nextVersion, parseVersion,
  readManifestVersion, setManifestVersion,
} from './plan.mjs';

const REPO = 'airshiplabs/plaintask';
const BASE = 'origin/main';
const REQUIRED_CHECK = 'test';
const NOTARY_PROFILE = 'plaintask-notary';
/** A commit that touches none of these paths is not part of a desktop release. build.mjs copies from the design system. */
const RELEASE_PATHS = Object.freeze(['apps/desktop', 'packages/design-system']);
/** The desktop component's tag prefix, from the keep-a-changelog skill: version 0.1.0 is the tag desktop-v0.1.0. */
const TAG_PREFIX = componentFor(CHANGELOG).tagPrefix;
const tagFor = (version) => `${TAG_PREFIX}${version}`;
// The release branch, in the branch-naming skill's <type>--<description> form: no "/" and no "." (0.1.0 is 0-1-0).
const BRANCH_PREFIX = `chore--release-${TAG_PREFIX}`;
const branchFor = (version) => `${BRANCH_PREFIX}${version.replaceAll('.', '-')}`;
/** The version a release branch name holds, or null for any other branch name. */
const branchVersion = (name) => (name.startsWith(BRANCH_PREFIX) && parseVersion(name.slice(BRANCH_PREFIX.length).replaceAll('-', '.')) ? name.slice(BRANCH_PREFIX.length).replaceAll('-', '.') : null);
const titleFor = (version) => `${PRODUCT_NAME} ${version} for macOS`;
const HOOKS = Object.freeze(['commit-msg', 'pre-commit']);
const CHANGELOG_VALIDATOR = '.claude/skills/keep-a-changelog/validate.mjs';
const CARGO_MANIFEST = 'apps/desktop/src-tauri/Cargo.toml';
const ENTITLEMENTS = 'apps/desktop/src-tauri/Entitlements.plist';
const APP_BUNDLE = `apps/desktop/src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app`;
const APP_BINARY = 'Contents/MacOS/plaintask';
const HOST_TRIPLE = 'aarch64-apple-darwin';
const NODE_MAJOR = 22;
const TOOLS = Object.freeze(['git', 'gh', 'pnpm', 'cargo', 'rustc', 'xcrun', 'codesign', 'security', 'hdiutil', 'spctl', 'syspolicy_check', 'ditto', 'plutil', 'lipo']);
const NOTARY_IN_PROGRESS = 'In Progress';
const NOTARY_ACCEPTED = 'Accepted';
const LAUNCH_LIMIT_MS = 15000;
const CI_LIMIT_MS = 20 * 60 * 1000;
const MERGE_LIMIT_MS = 2 * 60 * 1000;
// How often to ask GitHub again while waiting. Tests set RELEASE_POLL_MS to keep the wait short.
const POLL_MS = Number(process.env.RELEASE_POLL_MS ?? 10000);

const SEE = Object.freeze({
  setup: '.claude/skills/release/references/setup.md',
  recovery: '.claude/skills/release/references/recovery.md',
  rules: '.claude/skills/release/references/changelog.md',
  skill: '.claude/skills/release/SKILL.md',
});
const EXIT = Object.freeze({ failed: 1, usage: 2, pending: 3 });
const USAGE = 'usage: release.mjs <status|preflight|plan|cut|check|pr|build|verify|stage|publish> [--version V] [--entries FILE] [--sha SHA] [--date YYYY-MM-DD] [--identity NAME|HASH] [--adhoc] [--dry-run]';

/** A stop with an exit code. `see` names the skill file that explains what to do next. */
class Stop extends Error {
  constructor(code, message, see) {
    super(see ? `${message}\nsee ${see}` : message);
    this.code = code;
  }
}
const fail = (message, see = SEE.recovery) => { throw new Stop(EXIT.failed, message, see); };
const missing = (message, see = SEE.setup) => { throw new Stop(EXIT.usage, message, see); };
const pending = (message) => { throw new Stop(EXIT.pending, `${message}; run the same command again`, SEE.recovery); };

let dryRun = false;
let root = process.cwd();

// ---- running commands ----

/** Runs a command in the repo root. Never throws: a command that cannot start has status 127 and `notFound`. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) return { status: 127, stdout: '', stderr: `cannot run ${command}: ${result.error.code}`, notFound: true };
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Runs a command that must succeed and returns its stdout. The wrapped tool's own error text is passed on. */
function must(command, args, options) {
  const result = run(command, args, options);
  if (result.notFound) missing(result.stderr);
  if (result.status !== 0) fail(`${command} ${args.join(' ')}: exit ${result.status}\n${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

/** Runs a command that changes something; with --dry-run, prints it instead. */
function change(command, args, options) {
  if (dryRun) {
    console.error(`would run: ${[command, ...args].join(' ')}`);
    return '';
  }
  return must(command, args, options);
}

/** Runs a long command with its output sent to stderr as it comes. Returns the exit status. */
function stream(command, args, options = {}) {
  console.error(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: ['ignore', 2, 2], ...options });
  if (result.error) missing(`cannot run ${command}: ${result.error.code}`);
  return result.status ?? 1;
}

function mustStream(command, args, options) {
  const status = stream(command, args, options);
  if (status !== 0) fail(`${command} ${args.join(' ')}: exit ${status}`);
}

const print = (value) => console.log(JSON.stringify(value, null, 2));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Calls `probe` every POLL_MS until it returns something other than undefined. Exit 3 after `limitMs`. */
function waitFor(what, limitMs, probe) {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) pending(`${what} did not finish within ${Math.round(limitMs / 60000)} min`);
    sleep(POLL_MS);
  }
}

// ---- files ----

const inRoot = (path) => join(root, path);
const outDir = (version, adhoc = false) => inRoot(`dist/release/${version}${adhoc ? '-adhoc' : ''}`);
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const sha256Of = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const asset = (name) => readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');

/** Today's date in UTC, as the keep-a-changelog skill dates a release. */
const today = () => new Date().toISOString().slice(0, 10);

// ---- git ----

const git = (...args) => must('git', args).trim();
const fetchMain = () => must('git', ['fetch', '--quiet', '--tags', 'origin', 'main']);
const mainSha = () => git('rev-parse', BASE);
const headSha = () => git('rev-parse', 'HEAD');
const treeIsClean = () => git('status', '--porcelain') === '';

/** A file's text at a ref, or null when the ref has no such file. */
function showAt(ref, path) {
  const result = run('git', ['show', `${ref}:${path}`]);
  return result.status === 0 ? result.stdout : null;
}

function requireCleanTree() {
  if (treeIsClean()) return;
  if (dryRun) console.error('note: the working tree is not clean; a run without --dry-run stops here');
  else fail('the working tree is not clean: commit or remove the changes, then run again', SEE.skill);
}

const lastReleaseVersion = () => latestVersionTag(git('tag', '--list', `${TAG_PREFIX}*`, '--merged', BASE).split('\n').filter(Boolean), TAG_PREFIX);

/** The commit a tag on origin points at (annotated tags peeled), or null when origin has no such tag. */
function remoteTagSha(tag) {
  const lines = git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`).split('\n').filter(Boolean);
  const peeled = lines.find((line) => line.endsWith('^{}')) ?? lines[0];
  return peeled ? peeled.split('\t')[0] : null;
}

/** The app version each manifest records at a ref (null for a manifest the ref does not have). */
function manifestVersionsAt(read) {
  return MANIFESTS.map(({ kind, path }) => {
    const text = read(path);
    return { path, version: text === null ? null : readManifestVersion(kind, text) };
  });
}

// ---- GitHub ----

function ghJson(args) {
  const result = run('gh', args);
  if (result.notFound) missing(result.stderr);
  if (result.status !== 0) fail(`gh ${args.join(' ')}: exit ${result.status}\n${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

/** The newest pull request from the release branch, or null. */
function findPr(version) {
  const [pr] = ghJson(['pr', 'list', '--head', branchFor(version), '--state', 'all', '--limit', '1', '--json', 'number,state,url,mergeCommit,headRefOid']);
  return pr ?? null;
}

/** The GitHub release for a version's tag (drafts included), or null when there is none. */
function viewRelease(version) {
  const args = ['release', 'view', tagFor(version), '--json', 'isDraft,url,tagName,assets,publishedAt'];
  const result = run('gh', args);
  if (result.notFound) missing(result.stderr);
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/release not found/i.test(result.stderr)) return null;
  return fail(`gh ${args.join(' ')}: exit ${result.status}\n${result.stderr.trim()}`);
}

/** The required check's state on a commit: 'none' (no run yet), 'pending', 'pass', or 'fail'. */
function ciState(sha) {
  const runs = ghJson(['api', `repos/${REPO}/commits/${sha}/check-runs`]).check_runs.filter((check) => check.name === REQUIRED_CHECK);
  if (runs.length === 0) return 'none';
  if (runs.some((check) => check.status !== 'completed')) return 'pending';
  return runs.every((check) => ['success', 'skipped', 'neutral'].includes(check.conclusion)) ? 'pass' : 'fail';
}

function requireGreen(sha, what) {
  const state = ciState(sha);
  if (state === 'pending' || state === 'none') pending(`the "${REQUIRED_CHECK}" check on ${what} ${sha} is ${state === 'none' ? 'not reported yet' : 'still running'}`);
  if (state === 'fail') fail(`the "${REQUIRED_CHECK}" check failed on ${what} ${sha}`);
}

// ---- plan ----

/**
 * What a release would hold: the commits on the release paths since the last release tag, classified; the
 * [Unreleased] entries on origin/main; and the next version those entries plus `additions` call for.
 * `next` is null while there is no entry. Throws RangeError on an `explicit` version that does not rise.
 */
function gatherPlan(explicit, additions = []) {
  const last = lastReleaseVersion();
  const range = last === null ? BASE : `${tagFor(last)}..${BASE}`;
  const log = must('git', ['log', '--format=%H%x1f%B%x1e', range, '--', ...RELEASE_PATHS]);
  const commits = log.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [sha, message] = record.split('\x1f');
    return classifyCommit({ sha, message });
  });
  const unreleased = entriesOf(showAt(BASE, CHANGELOG) ?? '');
  const entries = [...unreleased, ...additions];
  const version = entries.length > 0
    ? nextVersion({ lastVersion: last, entries, explicit })
    : { next: null, bump: null, reason: `${CHANGELOG} has no [Unreleased] entry and the entries file adds none` };
  return { last, ...version, range, paths: RELEASE_PATHS, changelog: CHANGELOG, unreleased, additions, commits };
}

function plan({ version, entries }) {
  fetchMain();
  let planned;
  try {
    planned = gatherPlan(version, entries ? readEntries(resolve(entries)) : []);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    fail(error.message, SEE.skill);
  }
  if (planned.commits.length === 0 && planned.next === null) fail(`nothing to release: no commit on ${RELEASE_PATHS.join(' or ')} since ${planned.last ?? 'the first commit'}, and no changelog entry`, SEE.skill);
  print(planned);
}

// ---- cut and check ----

function readEntries(path) {
  if (!existsSync(path)) missing(`no entries file at ${path}`, SEE.rules);
  let entries;
  try {
    entries = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${path} is not JSON: ${error.message}`, SEE.rules);
  }
  const problems = validateAdditions(entries);
  if (problems.length > 0) fail(`${path} is not an entries file:\n${problems.map((problem) => `  ${problem}`).join('\n')}`, SEE.rules);
  return entries;
}

/** The changelog text with the entries added and the release cut. A changelog already cut this way comes back unchanged. */
function cutText(version, additions, date) {
  const current = readText(inRoot(CHANGELOG));
  if (current === null) fail(`${CHANGELOG} does not exist`, SEE.rules);
  try {
    return cutRelease(current, { version, date: date ?? today(), additions });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return fail(`cannot cut ${version}: ${error.message}`, SEE.rules);
  }
}

function cut({ version, entries: entriesPath, date }) {
  const text = cutText(version, readEntries(resolve(entriesPath)), date);
  if (dryRun) {
    const heading = text.split('\n').find((line) => line.startsWith(`## [${version}] - `));
    print({ version, section: `${heading}\n\n${releaseBody(text, version)}` });
    return;
  }
  writeFileSync(inRoot(CHANGELOG), text);
  for (const { kind, path } of MANIFESTS) writeFileSync(inRoot(path), setManifestVersion(kind, readFileSync(inRoot(path), 'utf8'), version));
  // Exits non-zero when Cargo.lock no longer matches Cargo.toml. Reads the cached index only: no network, no downloads.
  must('cargo', ['update', '--workspace', '--locked', '--offline', '--manifest-path', CARGO_MANIFEST]);
}

/** Why the files `read` returns are not a release of `version`: one line each, [] when they are. */
function releaseProblems(version, read) {
  const problems = manifestVersionsAt(read).filter((manifest) => manifest.version !== version)
    .map((manifest) => `${manifest.path} records ${manifest.version}, expected ${version}`);
  const changelog = read(CHANGELOG);
  if (changelog === null) return [...problems, `${CHANGELOG} does not exist`];
  for (const { rule, line, text, message } of validateChangelog(changelog, { path: CHANGELOG })) problems.push(`${CHANGELOG} line ${line}: ${text}\n  ${rule}: ${message}`);
  if (releaseBody(changelog, version) === null) problems.push(`${CHANGELOG} has no "## [${version}]" release`);
  return problems;
}

const readWorktree = (path) => readText(inRoot(path));

function requireRelease(version, read, where) {
  const problems = releaseProblems(version, read);
  if (problems.length > 0) fail(`${where} is not a release of ${version}:\n${problems.map((problem) => `  ${problem}`).join('\n')}`, SEE.rules);
}

function check({ version }) {
  requireRelease(version, readWorktree, 'the working tree');
}

// ---- status ----

/**
 * The version a bare `status` reports on, or null when no version is settled yet.
 * In order: a release whose version bump is on origin/main and not yet tagged; an open release pull request;
 * the version the [Unreleased] entries on origin/main call for.
 */
function versionInFlight() {
  const manifest = manifestVersionsAt((path) => showAt(BASE, path))[0].version;
  if (compareVersions(manifest, lastReleaseVersion() ?? INITIAL_VERSION) > 0) return manifest;
  const open = ghJson(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'])
    .map((found) => branchVersion(found.headRefName ?? '')).filter(Boolean);
  return open.sort(compareVersions).at(-1) ?? gatherPlan().next;
}

function status({ version: explicit }) {
  fetchMain();
  const version = explicit ?? versionInFlight();
  if (version === null) {
    const { last, commits } = gatherPlan();
    print({
      version: null,
      phase: 'plan',
      next: commits.length > 0 ? NEXT_TASK.plan : 'none',
      releaseSha: null,
      facts: { main: mainSha(), lastVersion: last, commits: commits.length, unreleased: 0 },
      problems: commits.length > 0 ? [] : [`nothing to release: no commit on ${RELEASE_PATHS.join(' or ')} since ${last ?? 'the first commit'}, and no changelog entry`],
    });
    return;
  }

  const tag = tagFor(version);
  const dir = outDir(version);
  const build = readJson(join(dir, 'build.json'));
  const verify = readJson(join(dir, 'verify.json'));
  const pr = findPr(version);
  const release = viewRelease(version);
  const tagSha = remoteTagSha(tag);
  const main = mainSha();
  const mainProblems = releaseProblems(version, (path) => showAt(BASE, path));
  const phase = derivePhase({ release, build, verify, mainHasRelease: mainProblems.length === 0, pr });

  const problems = [];
  if (build && !build.sha256) problems.push(`notarization ${build.notary?.id} was submitted and has not finished: run build again with --sha ${build.sha}`);
  if (tagSha && build?.sha && tagSha !== build.sha) problems.push(`tag ${tag} on origin points at ${tagSha}, but the build is of ${build.sha}`);
  if (tagSha && !release) problems.push(`tag ${tag} is on origin and no GitHub release exists: run stage again`);
  if (existsSync(join(outDir(version, true), 'build.json'))) problems.push(`an --adhoc rehearsal build is in dist/release/${version}-adhoc; it is not part of this release`);

  print({
    version,
    phase,
    next: NEXT_TASK[phase],
    releaseSha: build?.sha ?? (mainProblems.length === 0 ? main : null),
    facts: {
      main,
      lastVersion: lastReleaseVersion(),
      mainHasRelease: mainProblems.length === 0,
      pr: pr && { number: pr.number, state: pr.state, url: pr.url, mergeSha: pr.mergeCommit?.oid ?? null },
      build: build && { sha: build.sha, signature: build.signature, sha256: build.sha256 ?? null, notary: build.notary ?? null },
      verify: verify && { ok: verify.ok, sha256: verify.sha256 },
      remoteTagSha: tagSha,
      release: release && { isDraft: release.isDraft, url: release.url, assets: release.assets.map(({ name }) => name) },
    },
    problems,
  });
}

// ---- preflight ----

function findIdentity(override) {
  const listed = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (listed.notFound) return { ok: false, reason: listed.stderr };
  return pickIdentity(listed.stdout, override);
}

function requireIdentity(override) {
  const identity = findIdentity(override);
  if (!identity.ok) missing(identity.reason);
  return identity;
}

/** Signs a copy of /usr/bin/true: proves the key signs without a prompt and the timestamp server answers. */
function signingProbe(identity) {
  const dir = mkdtempSync(join(tmpdir(), 'plaintask-sign-'));
  try {
    const target = join(dir, 'probe');
    copyFileSync('/usr/bin/true', target);
    const signed = run('codesign', ['--force', '--sign', identity, '--timestamp', '--options', 'runtime', target]);
    if (signed.status !== 0) return signed.stderr.trim();
    const verified = run('codesign', ['--verify', '--strict', target]);
    return verified.status === 0 ? null : verified.stderr.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function gitConfig(name) {
  const result = run('git', ['config', '--get', name]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The setup and repo checks, in order. Each returns null on pass or a one-line reason. */
function setupChecks() {
  const identity = findIdentity();
  const commonDir = resolve(root, git('rev-parse', '--git-common-dir'));
  return [
    ['tools', 'install the missing tools; Xcode supplies the Apple ones', () => {
      const absent = TOOLS.filter((tool) => run('/bin/sh', ['-c', `command -v ${tool}`]).status !== 0);
      for (const tool of ['notarytool', 'stapler']) if (run('xcrun', ['--find', tool]).status !== 0) absent.push(`xcrun ${tool}`);
      if (Number(process.versions.node.split('.')[0]) < NODE_MAJOR) absent.push(`node >= ${NODE_MAJOR}`);
      return absent.length === 0 ? null : `missing: ${absent.join(', ')}`;
    }],
    ['host', `build on an Apple Silicon Mac with a Rust toolchain for ${HOST_TRIPLE}`, () => {
      const host = /^host: (.+)$/m.exec(run('rustc', ['-vV']).stdout)?.[1];
      return host === HOST_TRIPLE ? null : `rustc host is ${host ?? 'unknown'}, expected ${HOST_TRIPLE}`;
    }],
    ['signing-identity', `install a Developer ID Application certificate: ${SEE.setup}`, () => (identity.ok ? null : identity.reason)],
    ['signing-probe', `allow codesign to use the key without a prompt: ${SEE.setup}`, () => (identity.ok ? signingProbe(identity.identity) : 'not run: no signing identity')],
    ['notary-profile', `store the notary credentials as keychain profile "${NOTARY_PROFILE}": ${SEE.setup}`, () => {
      const history = run('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE, '--output-format', 'json']);
      return history.status === 0 ? null : `notarytool cannot use keychain profile "${NOTARY_PROFILE}"`;
    }],
    ['git-signing', 'set commit.gpgsign=true, user.signingkey, and for ssh signing gpg.ssh.allowedSignersFile', () => {
      if (gitConfig('commit.gpgsign') !== 'true') return 'commit.gpgsign is not true';
      if (!gitConfig('user.signingkey')) return 'user.signingkey is not set';
      if (gitConfig('gpg.format') !== 'ssh') return null;
      const signers = gitConfig('gpg.ssh.allowedSignersFile');
      return signers && existsSync(signers.replace(/^~/, process.env.HOME ?? '~')) ? null : 'gpg.ssh.allowedSignersFile is not set or names no file, so git cannot verify a tag';
    }],
    ['git-hooks', 'run "pnpm run prepare" to install the commit-msg and pre-commit hooks; unset core.hooksPath', () => {
      if (gitConfig('core.hooksPath')) return 'core.hooksPath is set, which bypasses the installed hooks';
      const absent = HOOKS.filter((hook) => !isExecutable(join(commonDir, 'hooks', hook)));
      return absent.length === 0 ? null : `not installed: ${absent.join(', ')}`;
    }],
    ['github', `sign in with "gh auth login" as a user who can write to ${REPO}`, () => {
      if (run('gh', ['auth', 'status']).status !== 0) return 'gh is not signed in';
      const repo = run('gh', ['repo', 'view', '--json', 'nameWithOwner']);
      const name = repo.status === 0 ? JSON.parse(repo.stdout).nameWithOwner : null;
      return name === REPO ? null : `gh resolves this checkout to ${name}, expected ${REPO}`;
    }],
    ['clean-tree', 'commit or remove the changes', () => (treeIsClean() ? null : 'the working tree has changes or untracked files')],
    ['head-at-main', `run "git switch --detach ${BASE}" so the gates test the code being released`, () => (headSha() === mainSha() ? null : `HEAD is ${headSha()}, ${BASE} is ${mainSha()}`)],
    ['manifests', 'make the four version manifests agree', () => {
      const versions = manifestVersionsAt((path) => showAt(BASE, path));
      return new Set(versions.map(({ version }) => version)).size === 1 ? null : versions.map(({ path, version }) => `${path}=${version}`).join(', ');
    }],
    ['ci-main', `wait for, or fix, the "${REQUIRED_CHECK}" check on ${BASE}`, () => {
      const state = ciState(mainSha());
      return state === 'pass' ? null : `the "${REQUIRED_CHECK}" check on ${BASE} is ${state}`;
    }],
  ];
}

const GATES = Object.freeze([
  ['gate-changelogs', process.execPath, [CHANGELOG_VALIDATOR]],
  ['gate-test', 'pnpm', ['test']],
  ['gate-typecheck', 'pnpm', ['--filter', '@plaintask/desktop', 'typecheck']],
  ['gate-rust', 'pnpm', ['--filter', '@plaintask/desktop', 'check:rust']],
]);

function preflight() {
  fetchMain();
  const checks = setupChecks().map(([id, fix, probe]) => {
    const reason = probe();
    return reason === null ? { id, ok: true, detail: 'ok' } : { id, ok: false, detail: reason, fix };
  });
  const setupOk = checks.every((item) => item.ok);
  for (const [id, command, args] of GATES) {
    if (!setupOk) {
      checks.push({ id, ok: false, detail: 'not run: a setup check failed' });
      continue;
    }
    const exit = stream(command, args);
    checks.push(exit === 0 ? { id, ok: true, detail: 'ok' } : { id, ok: false, detail: `exit ${exit}`, fix: `make "${[command, ...args].join(' ')}" pass on ${BASE}` });
  }
  const ok = checks.every((item) => item.ok);
  print({ ok, checks });
  if (!setupOk) missing(`preflight: ${checks.filter((item) => !item.ok && item.fix).map((item) => item.id).join(', ')} failed`);
  if (!ok) fail('preflight: a quality gate failed', SEE.skill);
}

// ---- pr ----

/** The release pull request body. AGENTS.md requires an agent-written body to end with the session footer. */
function releasePrBody(version) {
  const body = render(asset('release-pr-body.md'), {
    version, tag: tagFor(version), changelog: CHANGELOG, changelogSection: releaseBody(readWorktree(CHANGELOG), version), dmgName: dmgName(version),
  });
  const footer = sessionFooter(process.env);
  if (footer) return appendFooter(body, footer);
  console.error('note: no agent session id is in the environment, so the pull request body has no session footer');
  return body;
}

function openReleasePr(version, entriesPath) {
  readEntries(resolve(entriesPath));
  const branch = branchFor(version);
  const title = `chore(desktop): release ${version}`;
  requireCleanTree();
  change('git', ['switch', '--force-create', branch, BASE]);
  if (dryRun) console.error(`would write: ${CHANGELOG} and ${MANIFESTS.map(({ path }) => path).join(', ')}`);
  else cut({ version, entries: entriesPath });
  const bodyFile = join(outDir(version), 'release-pr-body.md');
  if (!dryRun) {
    requireRelease(version, readWorktree, 'the release branch');
    writeFileSync(bodyFile, releasePrBody(version));
  }
  change('git', ['add', '--', CHANGELOG, ...MANIFESTS.map(({ path }) => path)]);
  change('git', ['commit', '--message', title]);
  if (!dryRun && run('git', ['verify-commit', 'HEAD']).status !== 0) fail('the release commit has no valid signature', SEE.setup);
  change('git', ['push', '--set-upstream', 'origin', branch]);
  change('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body-file', bodyFile]);
}

function pr({ version, entries }) {
  fetchMain();
  if (!dryRun) mkdirSync(outDir(version), { recursive: true });
  let found = findPr(version);
  if (found?.state !== 'MERGED' && found?.state !== 'OPEN') {
    openReleasePr(version, entries);
    if (dryRun) {
      console.error(`would run: gh pr merge <number> --squash --match-head-commit <head> (after the "${REQUIRED_CHECK}" check passes)`);
      return;
    }
    found = waitFor('the new pull request', MERGE_LIMIT_MS, () => {
      const now = findPr(version);
      return now?.state === 'OPEN' ? now : undefined;
    });
  }

  if (found.state === 'OPEN') {
    const head = found.headRefOid;
    const state = waitFor(`the "${REQUIRED_CHECK}" check on pull request #${found.number}`, CI_LIMIT_MS, () => {
      const now = ciState(head);
      return now === 'pass' || now === 'fail' ? now : undefined;
    });
    if (state === 'fail') fail(`the "${REQUIRED_CHECK}" check failed on pull request #${found.number} (${found.url})`);
    change('gh', ['pr', 'merge', String(found.number), '--squash', '--match-head-commit', head]);
    if (dryRun) return;
    found = waitFor(`the merge of pull request #${found.number}`, MERGE_LIMIT_MS, () => {
      const now = findPr(version);
      return now.state === 'MERGED' && now.mergeCommit ? now : undefined;
    });
  }

  const mergeSha = found.mergeCommit.oid;
  fetchMain();
  if (!dryRun && treeIsClean()) {
    git('switch', '--detach', mergeSha);
    run('git', ['branch', '--delete', '--force', branchFor(version)]);
  }
  print({ pr: found.number, url: found.url, mergeSha });
}

// ---- build ----

const NOTARY_AUTH = Object.freeze(['--keychain-profile', NOTARY_PROFILE]);

function codesignDisplay(path) {
  return parseCodesignDisplay(run('codesign', ['-dvv', path]).stderr);
}

/** Steps 1 to 9: build the app at the release commit, package the DMG, sign it, submit it. Returns the build record. */
function buildAndSubmit({ version, sha, adhoc, identity: override }, dir, dmg) {
  const identity = adhoc ? null : requireIdentity(override);
  if (adhoc) {
    const wrong = manifestVersionsAt(readWorktree).filter((manifest) => manifest.version !== version);
    if (wrong.length > 0) fail(`the checkout is not at ${version}: ${wrong.map(({ path, version: found }) => `${path}=${found}`).join(', ')}`, SEE.skill);
  } else {
    requireCleanTree();
    fetchMain();
    git('switch', '--detach', sha);
    if (headSha() !== sha) fail(`HEAD is ${headSha()} after switching to ${sha}; pass the full commit id`);
    requireRelease(version, readWorktree, `commit ${sha}`);
  }
  const record = {
    version, sha: headSha(), dirty: !treeIsClean(), signature: adhoc ? SIGNATURE.adhoc : SIGNATURE.developerId, identity: identity?.identity ?? '-', teamName: identity?.teamName ?? null, teamId: identity?.teamId ?? null, dmg: dmgName(version),
    // What apps/desktop/scripts/build-app.mjs writes as the macOS build number (CFBundleVersion).
    buildNumber: git('describe', '--always', '--dirty', '--abbrev=7'),
  };

  mustStream('pnpm', ['install', '--frozen-lockfile']);
  mustStream('pnpm', ['--filter', '@plaintask/desktop', 'app'], { env: tauriEnv(process.env, identity?.identity ?? null) });

  const app = inRoot(APP_BUNDLE);
  must('codesign', ['--verify', '--deep', '--strict', app]);
  const display = codesignDisplay(app);
  if (!display.flags.includes('runtime')) fail(`${APP_BUNDLE} is signed without the hardened runtime`);
  if (!adhoc) {
    const problems = developerIdProblems(display, identity.teamId);
    if (problems.length > 0) fail(`${APP_BUNDLE} is not signed for distribution: ${problems.join('; ')}`);
    mustStream('syspolicy_check', ['notary-submission', app]);
  }

  const stage = join(dir, 'dmg-stage');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  must('ditto', [app, join(stage, `${PRODUCT_NAME}.app`)]);
  symlinkSync('/Applications', join(stage, 'Applications'));
  must('hdiutil', ['create', '-volname', PRODUCT_NAME, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-ov', dmg]);
  rmSync(stage, { recursive: true, force: true });
  if (adhoc) return record;

  must('codesign', ['--sign', identity.identity, '--timestamp', '--identifier', DMG_IDENTIFIER, dmg]);
  const submitted = JSON.parse(must('xcrun', ['notarytool', 'submit', dmg, ...NOTARY_AUTH, '--no-wait', '--output-format', 'json']));
  return { ...record, notary: { id: submitted.id, status: NOTARY_IN_PROGRESS } };
}

/** Steps 10 to 12: wait for the notary service, save its log, staple the ticket to the DMG. */
function notarize(record, dir, dmg, buildFile) {
  const { id } = record.notary;
  stream('xcrun', ['notarytool', 'wait', id, ...NOTARY_AUTH, '--timeout', '30m']);
  const info = JSON.parse(must('xcrun', ['notarytool', 'info', id, ...NOTARY_AUTH, '--output-format', 'json']));
  if (info.status === NOTARY_IN_PROGRESS) pending(`notarization ${id} is still in progress`);
  must('xcrun', ['notarytool', 'log', id, ...NOTARY_AUTH, join(dir, 'notary-log.json')]);
  record.notary.status = info.status;
  writeJson(buildFile, record);
  if (info.status !== NOTARY_ACCEPTED) fail(`notarization ${id} ended as ${info.status}; dist/release/${record.version}/notary-log.json names each problem`);
  must('xcrun', ['stapler', 'staple', dmg]);
  must('xcrun', ['stapler', 'validate', dmg]);
}

function build(options) {
  const { version, sha, adhoc } = options;
  const dir = outDir(version, adhoc);
  const dmg = join(dir, dmgName(version));
  const buildFile = join(dir, 'build.json');
  mkdirSync(dir, { recursive: true });

  let record = adhoc ? null : readJson(buildFile);
  const sameBuild = record !== null && record.sha === sha && record.signature === SIGNATURE.developerId && existsSync(dmg);
  if (sameBuild && record.sha256 === sha256Of(dmg)) {
    print(record);
    return;
  }
  if (!adhoc && viewRelease(version)) fail(`a GitHub release for ${tagFor(version)} exists; a new build would not match its assets`);

  const resume = sameBuild && record.notary?.id && !record.sha256;
  if (!resume) {
    record = buildAndSubmit(options, dir, dmg);
    rmSync(join(dir, 'verify.json'), { force: true });
    writeJson(buildFile, record);
  }
  if (!adhoc) notarize(record, dir, dmg, buildFile);

  record = { ...record, bytes: statSync(dmg).size, sha256: sha256Of(dmg), builtAt: new Date().toISOString() };
  writeFileSync(join(dir, CHECKSUMS_NAME), checksumLine(record.sha256, record.dmg));
  writeJson(buildFile, record);
  print(record);
}

// ---- verify ----

const succeeds = (command, args) => run(command, args).status === 0;

/** Where a symbolic link points, or null when the path is not one. */
function linkTarget(path) {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

const plistValue = (plist, key) => run('plutil', ['-extract', key, 'raw', '-o', '-', plist]).stdout.trim();

function plistToJson(xml) {
  if (xml.trim() === '') return {};
  return JSON.parse(must('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml }));
}

/** Starts the app's binary the way scripts/measure-launch.mjs does and waits for it to report "ready". */
function launchProbe(binary) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(binary, [], { env: { ...process.env, PLAINTASK_MEASURE_LAUNCH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const settle = (ready, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      done({ ready, detail });
    };
    const timer = setTimeout(() => settle(false, `no "ready" within ${LAUNCH_LIMIT_MS} ms; stderr: ${err.trim()}`), LAUNCH_LIMIT_MS);
    child.stderr.on('data', (data) => { err += data; });
    child.stdout.on('data', (data) => {
      out += data;
      if (out.includes('ready')) settle(true, `"ready" after ${Date.now() - started} ms`);
    });
    child.once('error', (error) => settle(false, `the app did not start: ${error.code}`));
    child.once('exit', (code) => settle(false, `the app exited with ${code} before "ready"; stderr: ${err.trim()}`));
  });
}

async function gatherFacts(dir, dmg, adhoc) {
  const mount = mkdtempSync(join(tmpdir(), 'plaintask-dmg-'));
  must('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg]);
  try {
    const app = join(mount, `${PRODUCT_NAME}.app`);
    const hasApp = existsSync(join(app, APP_BINARY));
    const notaryLog = readJson(join(dir, 'notary-log.json'));
    return {
      dmgSha256: sha256Of(dmg),
      dmgImageValid: succeeds('hdiutil', ['verify', dmg]),
      dmgSignature: { verified: succeeds('codesign', ['--verify', '--strict', dmg]), display: codesignDisplay(dmg) },
      dmgStapled: !adhoc && succeeds('xcrun', ['stapler', 'validate', dmg]),
      dmgGatekeeper: !adhoc && succeeds('spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-vv', dmg]),
      volume: { hasApp, applicationsLink: linkTarget(join(mount, 'Applications')) },
      appSignature: { verified: hasApp && succeeds('codesign', ['--verify', '--deep', '--strict', app]), display: codesignDisplay(app) },
      appNotarized: !adhoc && succeeds('codesign', ['-vvvv', '-R=notarized', '--check-notarization', app]),
      appDistribution: !adhoc && succeeds('syspolicy_check', ['distribution', app]),
      entitlements: hasApp ? plistToJson(run('codesign', ['-d', '--entitlements', '-', '--xml', app]).stdout) : {},
      bundleVersion: hasApp ? plistValue(join(app, 'Contents/Info.plist'), 'CFBundleShortVersionString') : null,
      bundleBuild: hasApp ? plistValue(join(app, 'Contents/Info.plist'), 'CFBundleVersion') : null,
      archs: hasApp ? run('lipo', ['-archs', join(app, APP_BINARY)]).stdout.trim() : null,
      launch: hasApp ? await launchProbe(join(app, APP_BINARY)) : { ready: false, detail: 'no app to launch' },
      notaryLog: notaryLog && { status: notaryLog.status, issues: notaryLog.issues ?? null },
    };
  } finally {
    if (run('hdiutil', ['detach', mount]).status !== 0) run('hdiutil', ['detach', mount, '-force']);
    rmSync(mount, { recursive: true, force: true });
  }
}

async function verify({ version, adhoc }) {
  const dir = outDir(version, adhoc);
  const dmg = join(dir, dmgName(version));
  const record = readJson(join(dir, 'build.json'));
  if (!record?.sha256 || !existsSync(dmg)) missing(`no finished build in ${dir}: run build first`, SEE.skill);

  // A rehearsal of an uncommitted checkout compares against the file on disk; a release build against its commit.
  const expectedPlist = record.dirty ? readWorktree(ENTITLEMENTS) : showAt(record.sha, ENTITLEMENTS);
  const facts = await gatherFacts(dir, dmg, adhoc);
  const verdict = assessArtifact(facts, { sha256: record.sha256, version, buildNumber: record.buildNumber, teamId: record.teamId, entitlements: plistToJson(expectedPlist ?? ''), adhoc });
  const result = { version, adhoc, sha256: facts.dmgSha256, ...verdict, verifiedAt: new Date().toISOString() };
  writeJson(join(dir, 'verify.json'), result);
  print(result);
  if (!verdict.ok) fail(`${verdict.checks.filter((item) => !item.ok).map((item) => item.id).join(', ')} failed for ${record.dmg}`);
}

// ---- stage and publish ----

/** The finished, verified Developer ID build of a version, or a stop that says what is missing. */
function requireVerifiedBuild(version) {
  const dir = outDir(version);
  const record = readJson(join(dir, 'build.json'));
  const verdict = readJson(join(dir, 'verify.json'));
  const dmg = join(dir, dmgName(version));
  if (!record?.sha256 || !existsSync(dmg)) missing(`no finished build in ${dir}: run build first`, SEE.skill);
  if (record.signature !== SIGNATURE.developerId) fail(`the build in ${dir} is signed ${record.signature}; only a Developer ID build can be released`);
  if (record.dirty) fail(`the build in ${dir} was made from a checkout with uncommitted changes`);
  if (!verdict?.ok || verdict.sha256 !== record.sha256) fail(`the build in ${dir} has no passing verify.json for sha256 ${record.sha256}: run verify`);
  if (sha256Of(dmg) !== record.sha256) fail(`${dmg} changed after it was built and verified`);
  return { dir, record, verdict, dmg, checksums: join(dir, CHECKSUMS_NAME) };
}

function requireAssets(release, record) {
  const names = release.assets.map(({ name }) => name).sort();
  const expected = [record.dmg, CHECKSUMS_NAME].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) fail(`release ${release.tagName} has assets [${names.join(', ')}], expected [${expected.join(', ')}]`);
  const size = release.assets.find(({ name }) => name === record.dmg).size;
  if (size !== record.bytes) fail(`release asset ${record.dmg} is ${size} bytes; the verified build is ${record.bytes} bytes`);
}

function stage({ version }) {
  const { dir, record, dmg, checksums } = requireVerifiedBuild(version);
  const tag = tagFor(version);
  const { sha } = record;
  fetchMain();
  if (run('git', ['merge-base', '--is-ancestor', sha, BASE]).status !== 0) fail(`commit ${sha} is not on ${BASE}`);
  requireGreen(sha, 'release commit');
  let release = viewRelease(version);
  if (release && !release.isDraft) fail(`${tag} is already published at ${release.url}`);

  const local = run('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}^{commit}`]);
  if (local.status === 0 && local.stdout.trim() !== sha) fail(`local tag ${tag} points at ${local.stdout.trim()}, not ${sha}`);
  if (local.status !== 0) change('git', ['tag', '--sign', tag, sha, '--message', titleFor(version)]);
  if (!dryRun && run('git', ['tag', '--verify', tag]).status !== 0) fail(`tag ${tag} has no valid signature`, SEE.setup);

  const remote = remoteTagSha(tag);
  if (remote && remote !== sha) fail(`tag ${tag} on origin points at ${remote}, not ${sha}`);
  if (!remote) {
    change('git', ['push', 'origin', `refs/tags/${tag}`]);
    if (!dryRun && remoteTagSha(tag) !== sha) fail(`tag ${tag} on origin does not point at ${sha} after the push`);
  }

  const section = releaseBody(showAt(sha, CHANGELOG) ?? '', version);
  if (section === null) fail(`${CHANGELOG} at ${sha} has no "## [${version}]" release`, SEE.rules);
  const notes = join(dir, 'release-notes.md');
  const notesText = render(asset('release-notes.md'), {
    changelogSection: section, dmgName: record.dmg, checksumsName: CHECKSUMS_NAME, sha256: record.sha256, teamName: record.teamName, teamId: record.teamId,
  });
  if (!dryRun) writeFileSync(notes, notesText);
  if (!release) change('gh', ['release', 'create', tag, dmg, checksums, '--draft', '--verify-tag', '--title', titleFor(version), '--notes-file', notes]);
  if (dryRun) return;

  release = viewRelease(version);
  if (!release?.isDraft) fail(`no draft release for ${tag} after "gh release create"`);
  requireAssets(release, record);
  print({ tag, sha, url: release.url, isDraft: true, assets: release.assets.map(({ name, size }) => ({ name, size })) });
}

function publish({ version }) {
  const { dir, record, verdict } = requireVerifiedBuild(version);
  const tag = tagFor(version);
  let release = viewRelease(version);
  if (!release) fail(`no GitHub release for ${tag}: run stage first`, SEE.skill);
  if (remoteTagSha(tag) !== record.sha) fail(`tag ${tag} on origin does not point at the built commit ${record.sha}`);
  requireAssets(release, record);
  if (release.isDraft) change('gh', ['release', 'edit', tag, '--draft=false']);
  if (dryRun) return;

  release = viewRelease(version);
  if (release.isDraft) fail(`release ${tag} is still a draft after "gh release edit"`);
  const downloads = mkdtempSync(join(tmpdir(), 'plaintask-release-'));
  try {
    must('gh', ['release', 'download', tag, '--dir', downloads, '--pattern', record.dmg, '--pattern', CHECKSUMS_NAME]);
    const downloaded = sha256Of(join(downloads, record.dmg));
    if (downloaded !== record.sha256) fail(`the published ${record.dmg} has sha256 ${downloaded}; the verified build has ${record.sha256}`);
    if (readFileSync(join(downloads, CHECKSUMS_NAME), 'utf8') !== checksumLine(record.sha256, record.dmg)) fail(`the published ${CHECKSUMS_NAME} does not list the verified build`);
    must('xcrun', ['stapler', 'validate', join(downloads, record.dmg)]);
  } finally {
    rmSync(downloads, { recursive: true, force: true });
  }

  const report = join(dir, 'release-report.md');
  writeFileSync(report, render(asset('release-report.md'), {
    version, tag, sha: record.sha, releaseUrl: release.url, prUrl: findPr(version)?.url ?? 'none', publishedAt: release.publishedAt,
    dmgName: record.dmg, bytes: String(record.bytes), sha256: record.sha256, identity: record.identity, teamId: record.teamId,
    notaryId: record.notary.id, notaryStatus: record.notary.status,
    checks: verdict.checks.map((item) => `| ${item.id} | ${item.ok ? 'pass' : 'FAIL'} | ${item.detail} |`).join('\n'),
  }));
  print({ url: release.url, publishedAt: release.publishedAt, sha256: record.sha256, report });
}

// ---- command line ----

const COMMANDS = Object.freeze({
  status: { run: status, allowed: ['version'] },
  preflight: { run: preflight, allowed: [] },
  plan: { run: plan, allowed: ['version', 'entries'] },
  cut: { run: cut, required: ['version', 'entries'], allowed: ['date', 'dryRun'] },
  check: { run: check, required: ['version'], allowed: [] },
  pr: { run: pr, required: ['version', 'entries'], allowed: ['dryRun'] },
  build: { run: build, required: ['version'], allowed: ['sha', 'adhoc', 'identity'] },
  verify: { run: verify, required: ['version'], allowed: ['adhoc'] },
  stage: { run: stage, required: ['version'], allowed: ['dryRun'] },
  publish: { run: publish, required: ['version'], allowed: ['dryRun'] },
});
const VALUE_FLAGS = Object.freeze({ '--version': 'version', '--entries': 'entries', '--sha': 'sha', '--date': 'date', '--identity': 'identity' });
const SWITCHES = Object.freeze({ '--adhoc': 'adhoc', '--dry-run': 'dryRun' });

/** Returns { command, options }, or null on a usage error. A value flag takes "--flag value" or "--flag=value". */
function parseArgs(args) {
  const [name, ...rest] = args;
  const command = Object.hasOwn(COMMANDS, name ?? '') ? COMMANDS[name] : null;
  if (!command) return null;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const [flag, inline] = rest[i].split(/=(.*)/s, 2);
    if (Object.hasOwn(SWITCHES, flag) && inline === undefined) options[SWITCHES[flag]] = true;
    else if (Object.hasOwn(VALUE_FLAGS, flag)) {
      const value = inline ?? rest[++i];
      if (value === undefined || value === '') return null;
      options[VALUE_FLAGS[flag]] = value;
    } else return null;
  }
  const required = command.required ?? [];
  const known = [...required, ...command.allowed];
  if (Object.keys(options).some((key) => !known.includes(key)) || required.some((key) => options[key] === undefined)) return null;
  if (options.version !== undefined && !parseVersion(options.version)) return null;
  if (name === 'build' && Boolean(options.sha) === Boolean(options.adhoc)) return null;
  return { command, options };
}

// Sets process.exitCode instead of calling process.exit(): output to a pipe is asynchronous on macOS,
// and process.exit() can cut it short before the caller reads it.
async function main(args) {
  const parsed = parseArgs(args);
  if (!parsed) {
    console.error(USAGE);
    process.exitCode = EXIT.usage;
    return;
  }
  try {
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (top.status !== 0) missing('release.mjs must run inside the plaintask git checkout', SEE.skill);
    root = top.stdout.trim();
    dryRun = Boolean(parsed.options.dryRun);
    await parsed.command.run(parsed.options);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    console.error(`release.mjs: ${error.message}`);
    process.exitCode = error.code;
  }
}

await main(process.argv.slice(2));
