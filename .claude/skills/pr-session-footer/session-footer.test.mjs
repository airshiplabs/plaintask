// session-footer.test.mjs - harness detection, footer placement, and the CLI contract.
//   node --test session-footer.test.mjs     (run from the skill directory)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendFooter, sessionFooter } from './session-footer.mjs';

const cliPath = fileURLToPath(new URL('./session-footer.mjs', import.meta.url));
const runCli = (env, input) =>
  spawnSync(process.execPath, [cliPath], { env: { PATH: process.env.PATH, ...env }, input, encoding: 'utf8' });

test('sessionFooter names the harness whose session id is set', () => {
  assert.equal(sessionFooter({ CLAUDE_CODE_SESSION_ID: 'abc' }), 'Claude Code session: abc');
  assert.equal(sessionFooter({ CODEX_THREAD_ID: 'xyz' }), 'Codex session: xyz');
});

test('sessionFooter returns null when no id is set or the id is blank', () => {
  assert.equal(sessionFooter({}), null);
  assert.equal(sessionFooter({ CLAUDE_CODE_SESSION_ID: '  ' }), null);
});

test('appendFooter puts the footer last, after one blank line', () => {
  assert.equal(appendFooter('Summary\n\n🤖 Generated\n\n', 'Codex session: x'), 'Summary\n\n🤖 Generated\n\nCodex session: x\n');
  assert.equal(appendFooter('', 'Codex session: x'), 'Codex session: x\n');
});

test('appendFooter does not add the same footer twice', () => {
  const body = 'Summary\n\nCodex session: x\n';
  assert.equal(appendFooter(body, 'Codex session: x'), body);
});

test('CLI writes the body with the footer and exits 0', () => {
  const result = runCli({ CLAUDE_CODE_SESSION_ID: 'abc' }, 'Summary\n');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'Summary\n\nClaude Code session: abc\n');
});

test('CLI exits 1 with nothing on stdout when no session id is set', () => {
  const result = runCli({}, 'Summary\n');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /CLAUDE_CODE_SESSION_ID, CODEX_THREAD_ID/);
});
