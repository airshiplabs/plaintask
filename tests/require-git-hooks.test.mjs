// require-git-hooks.test.mjs - the Claude Code PreToolUse hook .claude/hooks/require-git-hooks.mjs,
// fed tool calls on stdin against throwaway git repos: it blocks `git commit` (exit 2) unless the
// commit-msg and pre-commit git hooks will run, and allows every other command (exit 0).
//   node --test tests/require-git-hooks.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const hookScript = fileURLToPath(new URL('../.claude/hooks/require-git-hooks.mjs', import.meta.url));

// A child env that cannot reach the real repo or the user's git config.
function childEnv(tmp) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return { ...env, GIT_CONFIG_GLOBAL: join(tmp, 'empty-global-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
}

// Repos in one temp dir: `bare` has no hooks, `half` only commit-msg, `ready` both, executable.
async function makeRepos(t) {
  const tmp = await mkdtemp(join(tmpdir(), 'require-git-hooks-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const env = childEnv(tmp);
  await writeFile(env.GIT_CONFIG_GLOBAL, '');
  for (const name of ['bare', 'half', 'ready']) {
    const init = spawnSync('git', ['init', '-q', join(tmp, name)], { env, encoding: 'utf8' });
    assert.equal(init.status, 0, `setup: git init ${name} failed: ${init.stderr}`);
  }
  for (const [repo, hooks] of [['half', ['commit-msg']], ['ready', ['commit-msg', 'pre-commit']]]) {
    await mkdir(join(tmp, repo, '.git/hooks'), { recursive: true });
    for (const hook of hooks) {
      await writeFile(join(tmp, repo, '.git/hooks', hook), '#!/bin/sh\nexit 0\n');
      await chmod(join(tmp, repo, '.git/hooks', hook), 0o755);
    }
  }
  await mkdir(join(tmp, 'plain'));
  return { tmp, env };
}

function runHook(env, cwd, command) {
  const input = JSON.stringify({ cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  return spawnSync(process.execPath, [hookScript], { env, input, encoding: 'utf8' });
}

test('require-git-hooks allows or blocks each Bash command', async (t) => {
  const { tmp, env } = await makeRepos(t);
  const rows = [
    { cwd: 'bare', command: 'ls -la', exit: 0 },
    { cwd: 'bare', command: 'git log --grep commit', exit: 0 },
    { cwd: 'bare', command: 'git commit -m "feat: add x"', exit: 2, stderr: /not installed/ },
    { cwd: 'bare', command: 'git add . && git commit -m "feat: add x"', exit: 2, stderr: /not installed/ },
    { cwd: 'half', command: 'git commit -m "feat: add x"', exit: 2, stderr: /pre-commit git hook is not installed/ },
    { cwd: 'ready', command: 'git commit -m "feat: add x"', exit: 0 },
    { cwd: 'ready', command: 'git commit --no-verify -m "feat: add x"', exit: 2, stderr: /--no-verify/ },
    { cwd: 'ready', command: 'git commit -n -m "feat: add x"', exit: 2, stderr: /--no-verify/ },
    { cwd: 'plain', command: `git -C ${join(tmp, 'ready')} commit -m "feat: add x"`, exit: 0 },
    { cwd: 'plain', command: `git -C ${join(tmp, 'bare')} commit -m "feat: add x"`, exit: 2, stderr: /not installed/ },
    { cwd: 'plain', command: 'git commit -m "feat: add x"', exit: 0 },
  ];

  for (const row of rows) {
    const result = runHook(env, join(tmp, row.cwd), row.command);
    assert.equal(result.status, row.exit, `${row.cwd}: ${row.command}: exit ${result.status}, stderr ${result.stderr}`);
    if (row.stderr) assert.match(result.stderr, row.stderr, `${row.cwd}: ${row.command}`);
  }
});

test('require-git-hooks blocks a commit when core.hooksPath bypasses the installed hooks', async (t) => {
  const { tmp, env } = await makeRepos(t);
  const config = spawnSync('git', ['-C', join(tmp, 'ready'), 'config', 'core.hooksPath', '.githooks'], { env, encoding: 'utf8' });
  assert.equal(config.status, 0, `setup: git config failed: ${config.stderr}`);

  const result = runHook(env, join(tmp, 'ready'), 'git commit -m "feat: add x"');

  assert.equal(result.status, 2, `exit ${result.status}, stderr ${result.stderr}`);
  assert.match(result.stderr, /core\.hooksPath/);
});
