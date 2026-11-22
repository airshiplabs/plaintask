// commit-msg-hook.test.mjs - the tracked .githooks/commit-msg hook in throwaway git repos that sign every commit
// with a throwaway SSH key: commit-time rejection in the main checkout, a subdirectory, and a linked worktree,
// the hook's cleanup-mode choice, and the install contract (prepare copies only commit-msg and pre-commit into the git dir).
//   node --test tests/commit-msg-hook.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const repoPath = (path) => fileURLToPath(new URL(path, root));

// A child env that cannot reach the real repo or the user's git config, even when this file runs inside a git hook.
function childEnv(tmp) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: join(tmp, 'empty-global-gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_EDITOR: 'true',
    GIT_AUTHOR_NAME: 'Hook Test',
    GIT_AUTHOR_EMAIL: 'hook-test@example.invalid',
    GIT_COMMITTER_NAME: 'Hook Test',
    GIT_COMMITTER_EMAIL: 'hook-test@example.invalid',
  };
}

function git(cwd, args, env) {
  const { status, stdout, stderr } = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' });
  return { status, stdout, stderr };
}

function mustRun(command, args, env, cwd) {
  const result = spawnSync(command, args, { env, cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `setup: ${command} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

const HOOKS = Object.freeze(['commit-msg', 'pre-commit']);
const prepare = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')).scripts.prepare;

// A temp repo with SSH signing on, the repo's hook and skill directory committed in a signed seed commit,
// and the hook installed by running package.json's real prepare script. The seed commit is made before the
// install, so building the repo never depends on the hook under test.
async function makeRepo(t) {
  const tmp = await mkdtemp(join(tmpdir(), 'commit-msg-hook-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const env = childEnv(tmp);
  await writeFile(env.GIT_CONFIG_GLOBAL, '');

  mustRun('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', join(tmp, 'signing-key'), '-q'], env);
  mustRun('git', ['init', '-q', tmp], env);
  mustRun('git', ['-C', tmp, 'config', 'commit.gpgsign', 'true'], env);
  mustRun('git', ['-C', tmp, 'config', 'gpg.format', 'ssh'], env);
  mustRun('git', ['-C', tmp, 'config', 'user.signingkey', join(tmp, 'signing-key')], env);
  mustRun('git', ['-C', tmp, 'config', 'commit.verbose', 'true'], env);

  await mkdir(join(tmp, '.githooks'));
  for (const hook of HOOKS) {
    await cp(repoPath(`.githooks/${hook}`), join(tmp, `.githooks/${hook}`));
    await chmod(join(tmp, `.githooks/${hook}`), 0o755);
  }
  await cp(repoPath('.claude/skills/conventional-commits'), join(tmp, '.claude/skills/conventional-commits'), { recursive: true });
  mustRun('git', ['-C', tmp, 'add', '.githooks', '.claude'], env);
  mustRun('git', ['-C', tmp, 'commit', '-q', '-m', 'chore: seed the test repo'], env);
  mustRun('sh', ['-c', prepare], env, tmp);

  const seed = mustRun('git', ['-C', tmp, 'rev-parse', 'HEAD'], env).trim();
  return { tmp, env, seed };
}

// ---- Slice 1: header rejection at commit time, in every checkout ----

// A linked worktree shares the installed hook in the common git dir.
test('commit-msg hook in a signed temp repo: worktree', async (t) => {
  const { tmp, env } = await makeRepo(t);
  mustRun('git', ['-C', tmp, 'worktree', 'add', '-q', join(tmp, 'wt')], env);

  const commit = git(join(tmp, 'wt'), ['commit', '--allow-empty', '-m', 'Add pricing page'], env);

  assert.notEqual(commit.status, 0, 'the commit in the linked worktree succeeded');
  assert.match(commit.stderr, /header-type/);
});

// The installed copy runs, never the checked-out .githooks/commit-msg, so a branch cannot swap the hook.
test('commit-msg hook in a signed temp repo: worktree path', async (t) => {
  const { tmp, env } = await makeRepo(t);
  mustRun('git', ['-C', tmp, 'worktree', 'add', '-q', join(tmp, 'wt')], env);
  await writeFile(join(tmp, 'wt/.githooks/commit-msg'), '#!/bin/sh\necho "marker: worktree hook copy ran" >&2\nexit 1\n');
  await chmod(join(tmp, 'wt/.githooks/commit-msg'), 0o755);

  const commit = git(join(tmp, 'wt'), ['commit', '--allow-empty', '-m', 'feat: add x'], env);

  assert.equal(commit.status, 0, `the conforming commit failed: ${commit.stderr}`);
  assert.doesNotMatch(commit.stderr, /marker: worktree hook copy ran/);
});

// A checked-out branch that adds a hook under another name runs no code (security review, CWE-829).
test('commit-msg hook in a signed temp repo: branch hooks do not run', async (t) => {
  const { tmp, env } = await makeRepo(t);
  mustRun('git', ['-C', tmp, 'switch', '-q', '-c', 'untrusted'], env);
  await writeFile(join(tmp, '.githooks/post-checkout'), '#!/bin/sh\necho "marker: branch post-checkout ran" >&2\n');
  await chmod(join(tmp, '.githooks/post-checkout'), 0o755);
  mustRun('git', ['-C', tmp, 'add', '.githooks/post-checkout'], env);
  mustRun('git', ['-C', tmp, 'commit', '-q', '-m', 'chore: add a post-checkout hook'], env);
  mustRun('git', ['-C', tmp, 'switch', '-q', '-'], env);

  const checkout = git(tmp, ['switch', 'untrusted'], env);

  assert.equal(checkout.status, 0, `the checkout failed: ${checkout.stderr}`);
  assert.doesNotMatch(checkout.stderr, /marker: branch post-checkout ran/);
});

test('commit-msg hook in a signed temp repo: fail', async (t) => {
  const { tmp, env, seed } = await makeRepo(t);

  const commit = git(tmp, ['commit', '--allow-empty', '-m', 'Add pricing page'], env);

  assert.notEqual(commit.status, 0, 'the commit succeeded');
  assert.match(commit.stderr, /header-type/);
  assert.equal(git(tmp, ['rev-parse', 'HEAD'], env).stdout.trim(), seed, 'HEAD moved off the seed commit');
});

test('commit-msg hook in a signed temp repo: fail from a subdirectory', async (t) => {
  const { tmp, env, seed } = await makeRepo(t);
  await mkdir(join(tmp, 'sub'));

  const commit = git(join(tmp, 'sub'), ['commit', '--allow-empty', '-m', 'Add pricing page'], env);

  assert.notEqual(commit.status, 0, 'the commit from the subdirectory succeeded');
  assert.match(commit.stderr, /header-type/);
  assert.equal(git(tmp, ['rev-parse', 'HEAD'], env).stdout.trim(), seed, 'HEAD moved off the seed commit');
});

test('commit-msg hook in a signed temp repo: pass', async (t) => {
  const { tmp, env, seed } = await makeRepo(t);

  const commit = git(tmp, ['commit', '--allow-empty', '-m', 'feat: add x'], env);

  assert.equal(commit.status, 0, `the conforming commit failed: ${commit.stderr}`);
  assert.notEqual(git(tmp, ['rev-parse', 'HEAD'], env).stdout.trim(), seed, 'HEAD stayed at the seed commit');
  assert.match(git(tmp, ['cat-file', 'commit', 'HEAD'], env).stdout, /^gpgsig /m);
});

// One open file gives both the mode and the text, so the two cannot come from different files.
function modeAndText(path) {
  const fd = openSync(path, 'r');
  try {
    return { mode: fstatSync(fd).mode, text: readFileSync(fd, 'utf8') };
  } finally {
    closeSync(fd);
  }
}

// prepare copies only commit-msg and pre-commit, executable and byte-identical, and never sets core.hooksPath.
test('commit-msg hook in a signed temp repo: install contract', async (t) => {
  const { tmp, env } = await makeRepo(t);
  for (const hook of HOOKS) {
    const tracked = modeAndText(repoPath(`.githooks/${hook}`));
    const installed = modeAndText(join(tmp, `.git/hooks/${hook}`));

    assert.notEqual(tracked.mode & 0o111, 0, `.githooks/${hook} has no execute bit`);
    assert.notEqual(installed.mode & 0o111, 0, `the installed ${hook} has no execute bit`);
    assert.equal(installed.text, tracked.text);
  }
  assert.notEqual(git(tmp, ['config', '--get', 'core.hooksPath'], env).status, 0, 'prepare set core.hooksPath');
});

// ---- Slice 3: the hook picks the cleanup mode from GIT_EDITOR (E3) ----

test('commit-msg hook in a signed temp repo: no editor', async (t) => {
  const { tmp, env } = await makeRepo(t);

  const noteUnderHeader = git(tmp, ['commit', '--allow-empty', '-m', 'feat: add x\n# note'], env);
  const hashHeader = git(tmp, ['commit', '--allow-empty', '-m', '#42 fix login'], env);

  assert.notEqual(noteUnderHeader.status, 0, "the -m 'feat: add x\\n# note' commit succeeded");
  assert.match(noteUnderHeader.stderr, /body-leading-blank/);
  assert.notEqual(hashHeader.status, 0, "the -m '#42 fix login' commit succeeded");
  assert.match(hashHeader.stderr, /header-type/);
});

test('commit-msg hook in a signed temp repo: editor', async (t) => {
  const { tmp, env } = await makeRepo(t);
  await writeFile(join(tmp, 'msg.txt'), 'feat: add x\n# note\n');
  await writeFile(join(tmp, 'x.txt'), 'x\n');
  mustRun('git', ['-C', tmp, 'add', 'x.txt'], env);

  const commit = git(tmp, ['commit', '-e', '-F', join(tmp, 'msg.txt')], env);

  assert.equal(commit.status, 0, `the editor commit failed: ${commit.stderr}`);
});

test('commit-msg hook in a signed temp repo: -F without -e', async (t) => {
  const { tmp, env } = await makeRepo(t);
  await writeFile(join(tmp, 'msg.txt'), 'feat: add x\n# note\n');

  const commit = git(tmp, ['commit', '--allow-empty', '-F', join(tmp, 'msg.txt')], env);

  assert.notEqual(commit.status, 0, 'the -F commit succeeded');
  assert.match(commit.stderr, /body-leading-blank/);
});
