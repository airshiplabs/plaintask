#!/usr/bin/env node
// validate.mjs - checks one branch name against the branch-naming rule; output on stderr only.
//   node validate.mjs <branch-name>
// Exit 0: conforms. Exit 1: violations. Exit 2: usage error.
import { validateBranchName } from './branch-name.mjs';

const EXIT_VIOLATIONS = 1;
const EXIT_USAGE = 2;
const EXPECTED = '<type>--<description>, e.g. feat--checkout-banner';

function main(args) {
  if (args.length !== 1) {
    console.error('usage: validate.mjs <branch-name>');
    process.exitCode = EXIT_USAGE;
    return;
  }

  const [name] = args;
  const violations = validateBranchName(name);
  if (violations.length === 0) return;

  const lines = [`validate.mjs: branch "${name}" does not conform`];
  for (const { rule, message } of violations) lines.push(`  ${rule}: ${message}`);
  lines.push(`expected: ${EXPECTED}`);
  console.error(lines.join('\n'));
  process.exitCode = EXIT_VIOLATIONS;
}

main(process.argv.slice(2));
