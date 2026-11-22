// branch-name.test.mjs - validateBranchName rules and the validate.mjs CLI contract (exit code, empty stdout).
//   node --test branch-name.test.mjs     (run from the skill directory)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TYPES } from '../conventional-commits/conventional-commits.mjs';
import { validateBranchName } from './branch-name.mjs';

const cliPath = fileURLToPath(new URL('./validate.mjs', import.meta.url));
const rules = (name) => validateBranchName(name).map(({ rule }) => rule);
const runCli = (args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });

test('every commit type makes a valid branch prefix', () => {
  for (const type of TYPES) assert.deepEqual(rules(`${type}--x`), [], type);
});

test('validateBranchName returns the rules each name breaks', () => {
  const rows = [
    { name: 'feat--checkout-banner', expected: [] },
    { name: 'fix--issue-37', expected: [] },
    { name: '', expected: ['branch-empty'] },
    { name: 'feat/checkout-banner', expected: ['branch-slash', 'branch-separator'] },
    { name: 'feat--checkout/banner', expected: ['branch-slash', 'branch-description'] },
    { name: 'claude/repo-icon-update-1a7b59', expected: ['branch-slash', 'branch-separator'] },
    { name: 'feat-checkout-banner', expected: ['branch-separator'] },
    { name: 'feature--checkout-banner', expected: ['branch-type-enum'] },
    { name: 'FEAT--checkout-banner', expected: ['branch-type-enum'] },
    { name: 'feat--', expected: ['branch-description'] },
    { name: 'feat--Checkout-Banner', expected: ['branch-description'] },
    { name: 'feat--checkout--banner', expected: ['branch-description'] },
    { name: 'feat--checkout_banner', expected: ['branch-description'] },
    { name: 'feat---checkout', expected: ['branch-description'] },
    { name: 'feat--checkout-', expected: ['branch-description'] },
  ];
  for (const { name, expected } of rows) assert.deepEqual(rules(name), expected, JSON.stringify(name));
});

test('validate.mjs exits 0 with no output for a conforming name', () => {
  const result = runCli(['feat--checkout-banner']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('validate.mjs exits 1 and names the rule on stderr only', () => {
  const result = runCli(['feat/checkout-banner']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /branch-slash/);
});

test('validate.mjs exits 2 on a usage error', () => {
  assert.equal(runCli([]).status, 2);
  assert.equal(runCli(['a', 'b']).status, 2);
});
