// build-number.test.mjs - the macOS build number (CFBundleVersion) is the bare commit, in throwaway
// git repos that sign every commit and tag with a throwaway SSH key. 0.2.0 shipped as
// "Version 0.2.0 (desktop-v0.1.0-26-gbd0db8c)" because the build number picked up the last tag.
//   node --test tests/build-number.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildNumber } from '../apps/desktop/scripts/build-number.mjs';

// A child env that cannot reach the real repo or the user's git config.
function childEnv(tmp) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: join(tmp, 'empty-global-gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Build Number Test',
    GIT_AUTHOR_EMAIL: 'build-number-test@example.invalid',
    GIT_COMMITTER_NAME: 'Build Number Test',
    GIT_COMMITTER_EMAIL: 'build-number-test@example.invalid',
  };
}

function mustRun(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8' });
  assert.equal(result.status, 0, `setup: ${command} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function makeRepo(t) {
  const tmp = await mkdtemp(join(tmpdir(), 'build-number-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const env = childEnv(tmp);
  await writeFile(env.GIT_CONFIG_GLOBAL, '');
  mustRun('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', join(tmp, 'signing-key'), '-q'], env);
  const repo = join(tmp, 'repo');
  mustRun('git', ['init', '-q', repo], env);
  mustRun('git', ['-C', repo, 'config', 'commit.gpgsign', 'true'], env);
  mustRun('git', ['-C', repo, 'config', 'tag.gpgsign', 'true'], env);
  mustRun('git', ['-C', repo, 'config', 'gpg.format', 'ssh'], env);
  mustRun('git', ['-C', repo, 'config', 'user.signingkey', join(tmp, 'signing-key')], env);

  const git = (...args) => mustRun('git', ['-C', repo, ...args], env);
  const commit = async (body) => {
    await writeFile(join(repo, 'file.txt'), body);
    git('add', '-A');
    git('commit', '-q', '-m', 'test');
    return git('rev-parse', '--short=7', 'HEAD');
  };
  const tag = (name) => git('tag', '-s', '-m', name, name);
  const number = () => buildNumber(repo, env);
  return { repo, commit, tag, number };
}

test('untagged commit: the bare commit', async (t) => {
  const { commit, number } = await makeRepo(t);
  const sha = await commit('v1');
  assert.equal(number(), sha);
});

test('commit is the release tag: the bare commit, not the tag name', async (t) => {
  const { commit, tag, number } = await makeRepo(t);
  const sha = await commit('v1');
  tag('desktop-v0.2.0');
  assert.equal(number(), sha);
});

test('commits after an earlier release tag: the bare commit, not <tag>-<n>-g<sha>', async (t) => {
  const { commit, tag, number } = await makeRepo(t);
  await commit('v1');
  tag('desktop-v0.1.0');
  await commit('v2');
  const sha = await commit('v3');
  assert.equal(number(), sha);
});

test('uncommitted change on a tagged commit: the commit with -dirty', async (t) => {
  const { repo, commit, tag, number } = await makeRepo(t);
  const sha = await commit('v1');
  tag('desktop-v0.2.0');
  await writeFile(join(repo, 'file.txt'), 'edited');
  assert.equal(number(), `${sha}-dirty`);
});
