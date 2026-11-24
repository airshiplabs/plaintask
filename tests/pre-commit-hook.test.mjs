// pre-commit-hook.test.mjs - the tracked .githooks/pre-commit hook in throwaway git repos that sign every commit
// with a throwaway SSH key: it rejects a staged CHANGELOG.md that breaks FORMAT.md, judges the staged blob
// rather than the working tree, rejects an unlisted CHANGELOG.md, and ignores commits with no changelog.
//   node --test tests/pre-commit-hook.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const repoPath = (path) => fileURLToPath(new URL(path, root));
const prepare = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')).scripts.prepare;
const CHANGELOG = 'apps/desktop/CHANGELOG.md';
const VALID = readFileSync(repoPath(CHANGELOG), 'utf8');

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
  return spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' });
}

function mustRun(command, args, env, cwd) {
  const result = spawnSync(command, args, { env, cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `setup: ${command} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

// A signed temp repo with both hooks and both skills committed, and the hooks installed by the real prepare script.
async function makeRepo(t) {
  const tmp = await mkdtemp(join(tmpdir(), 'pre-commit-hook-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const env = childEnv(tmp);
  await writeFile(env.GIT_CONFIG_GLOBAL, '');

  mustRun('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', join(tmp, 'signing-key'), '-q'], env);
  mustRun('git', ['init', '-q', tmp], env);
  mustRun('git', ['-C', tmp, 'config', 'commit.gpgsign', 'true'], env);
  mustRun('git', ['-C', tmp, 'config', 'gpg.format', 'ssh'], env);
  mustRun('git', ['-C', tmp, 'config', 'user.signingkey', join(tmp, 'signing-key')], env);

  await mkdir(join(tmp, '.githooks'));
  for (const hook of ['commit-msg', 'pre-commit']) {
    await cp(repoPath(`.githooks/${hook}`), join(tmp, `.githooks/${hook}`));
    await chmod(join(tmp, `.githooks/${hook}`), 0o755);
  }
  for (const skill of ['conventional-commits', 'keep-a-changelog']) {
    await cp(repoPath(`.claude/skills/${skill}`), join(tmp, `.claude/skills/${skill}`), { recursive: true });
  }
  mustRun('git', ['-C', tmp, 'add', '.githooks', '.claude'], env);
  mustRun('git', ['-C', tmp, 'commit', '-q', '-m', 'chore: seed the test repo'], env);
  mustRun('sh', ['-c', prepare], env, tmp);
  return { tmp, env };
}

async function stage(tmp, env, path, text) {
  await mkdir(join(tmp, path, '..'), { recursive: true });
  await writeFile(join(tmp, path), text);
  mustRun('git', ['-C', tmp, 'add', path], env);
}

test('pre-commit passes a valid changelog and commits with none', async (t) => {
  const { tmp, env } = await makeRepo(t);
  await stage(tmp, env, 'apps/desktop/moved-tags.json', readFileSync(repoPath('apps/desktop/moved-tags.json'), 'utf8'));
  await stage(tmp, env, CHANGELOG, VALID);
  const valid = git(tmp, ['commit', '-m', 'docs: add the desktop changelog'], env);
  assert.equal(valid.status, 0, valid.stderr);

  await stage(tmp, env, 'notes.txt', 'x\n');
  const other = git(tmp, ['commit', '-m', 'docs: add notes'], env);
  assert.equal(other.status, 0, other.stderr);
});

test('pre-commit rejects a broken staged changelog', async (t) => {
  const { tmp, env } = await makeRepo(t);
  await stage(tmp, env, CHANGELOG, VALID.replace('## [Unreleased]', '## [Unreleased]\n\n### Improved\n\n- X ([#1])'));
  const commit = git(tmp, ['commit', '-m', 'docs: add the desktop changelog'], env);
  assert.notEqual(commit.status, 0, 'the commit succeeded');
  assert.match(commit.stderr, /apps\/desktop\/CHANGELOG\.md: does not match/);
  assert.match(commit.stderr, /section-name/);
});

test('pre-commit judges the staged blob, not the working tree', async (t) => {
  const { tmp, env } = await makeRepo(t);
  await stage(tmp, env, CHANGELOG, 'not a changelog\n');
  await writeFile(join(tmp, CHANGELOG), VALID);
  const commit = git(tmp, ['commit', '-m', 'docs: add the desktop changelog'], env);
  assert.notEqual(commit.status, 0, 'the commit succeeded');
  assert.match(commit.stderr, /title/);
});

test('pre-commit rejects a CHANGELOG.md outside CHANGELOGS', async (t) => {
  const { tmp, env } = await makeRepo(t);
  await stage(tmp, env, 'packages/site-css/CHANGELOG.md', VALID);
  const commit = git(tmp, ['commit', '-m', 'docs: add a package changelog'], env);
  assert.notEqual(commit.status, 0, 'the commit succeeded');
  assert.match(commit.stderr, /not in CHANGELOGS/);
});
