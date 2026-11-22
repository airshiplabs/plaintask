#!/usr/bin/env node
// require-git-hooks.mjs - Claude Code PreToolUse hook for Bash: lets a `git commit` run only when the
// repo's commit-msg and pre-commit git hooks will check its message and staged changelogs.
//   Claude Code runs it with the tool call as JSON on stdin ({ cwd, tool_input: { command } }).
// It blocks a commit when an installed hook in .git/hooks is missing or not executable, when
// core.hooksPath points git away from them, or when the command passes --no-verify (-n). The git hooks
// do the checks themselves (.githooks/), so this file holds no message or changelog rules.
// Exit 0: allow. Exit 2: block; the reason on stderr goes back to Claude.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const EXIT_BLOCK = 2;
const GIT_HOOKS = Object.freeze(['commit-msg', 'pre-commit']);

// One shell command per segment, so `cd x && git commit` and `git add . ; git commit` both match.
// Group 1 is the path of a leading `git -C <path>`, when present.
const GIT_COMMIT = /^\s*(?:\w+=\S*\s+)*git((?:\s+-C\s+\S+|\s+-c\s+\S+|\s+--?[\w-]+(?:=\S+)?)*)\s+commit\b(.*)$/;
const NO_VERIFY = /(?:^|\s)(?:--no-verify|-n)(?:\s|$)/;

function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(EXIT_BLOCK);
}

function git(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

const input = JSON.parse(readFileSync(0, 'utf8'));
const command = input.tool_input?.command ?? '';
const cwd = input.cwd ?? process.cwd();

for (const segment of command.split(/&&|\|\||[;|\n]/)) {
  const match = GIT_COMMIT.exec(segment);
  if (!match) continue;

  const [, gitOptions, commitArgs] = match;
  const dashC = /-C\s+(\S+)/.exec(gitOptions)?.[1]?.replace(/^['"]|['"]$/g, '');
  const repo = dashC ? resolve(cwd, dashC) : cwd;

  if (NO_VERIFY.test(commitArgs)) {
    block('Blocked: --no-verify (-n) skips the commit-msg and pre-commit hooks. Commit messages MUST follow Conventional Commits 1.0.0 (AGENTS.md), and changelogs .claude/skills/keep-a-changelog/FORMAT.md. Drop the flag and fix the message or changelog.');
  }

  const commonDir = git(repo, ['rev-parse', '--git-common-dir']);
  if (commonDir.status !== 0) continue; // not a git repo: git commit fails on its own

  const hooksPath = git(repo, ['config', '--get', 'core.hooksPath']).stdout.trim();
  if (hooksPath) {
    block(`Blocked: core.hooksPath is set to "${hooksPath}", so git skips the installed hooks. Run \`git config --unset core.hooksPath\`, then \`pnpm run prepare\`.`);
  }

  const dir = commonDir.stdout.trim();
  for (const name of GIT_HOOKS) {
    const hook = join(isAbsolute(dir) ? dir : resolve(repo, dir), 'hooks', name);
    try {
      accessSync(hook, constants.X_OK);
    } catch {
      block(`Blocked: the ${name} git hook is not installed at ${hook}. Run \`pnpm run prepare\`, then commit again.`);
    }
  }
}
