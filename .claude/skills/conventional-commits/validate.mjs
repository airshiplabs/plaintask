#!/usr/bin/env node
// validate.mjs - checks one commit message against Conventional Commits 1.0.0; output on stderr only.
//   node validate.mjs <message-file>                    reads the message from a file
//   node validate.mjs -                                 reads the message from stdin
//   node validate.mjs --cleanup=strip <message-file>    drops git "#" lines and the scissors section first
// --cleanup=whitespace (the default) keeps "#" lines as message text.
// Exit 0: conforms. Exit 1: violations. Exit 2: usage or read error.
import { readFile } from 'node:fs/promises';
import { CLEANUP, validateMessage } from './conventional-commits.mjs';

const EXIT_VIOLATIONS = 1;
const EXIT_USAGE = 2;
const STDIN = '-';
const CLEANUP_OPTION = '--cleanup=';
const OPTION_PREFIX = '--';
const USAGE = `usage: validate.mjs [${CLEANUP_OPTION}${Object.values(CLEANUP).join('|')}] <message-file | ->`;
const SPEC_URL = 'https://www.conventionalcommits.org/en/v1.0.0/';
const EXPECTED_HEADER = '<type>[(<scope>)][!]: <description>';

// Returns { cleanup, source }, or null on a usage error. The option and the positional may come in either order.
function parseArgs(args) {
  let cleanup;
  const positionals = [];
  for (const arg of args) {
    if (arg.startsWith(CLEANUP_OPTION)) {
      const value = arg.slice(CLEANUP_OPTION.length);
      if (cleanup !== undefined || !Object.values(CLEANUP).includes(value)) return null;
      cleanup = value;
    } else if (arg.startsWith(OPTION_PREFIX)) {
      return null;
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== 1) return null;
  return { cleanup: cleanup ?? CLEANUP.whitespace, source: positionals[0] };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function report(violations) {
  const lines = ['validate.mjs: commit message does not conform to Conventional Commits 1.0.0'];
  for (const { rule, line, text, message } of violations) {
    lines.push(`  line ${line}: ${text}`, `  ${rule}: ${message}`);
  }
  lines.push(`expected header: ${EXPECTED_HEADER}`, `spec: ${SPEC_URL}`);
  return lines.join('\n');
}

// Sets process.exitCode instead of calling process.exit(): stderr to a pipe is asynchronous on macOS,
// and process.exit() can cut the report short before git or the caller reads it.
async function main(args) {
  const parsed = parseArgs(args);
  if (!parsed) {
    console.error(USAGE);
    process.exitCode = EXIT_USAGE;
    return;
  }

  const { cleanup, source } = parsed;
  let bytes;
  try {
    bytes = source === STDIN ? await readStdin() : await readFile(source);
  } catch (error) {
    console.error(`cannot read ${source}: ${error.code}`);
    process.exitCode = EXIT_USAGE;
    return;
  }

  // Buffer#toString decodes bytes that are not UTF-8 to U+FFFD instead of throwing.
  const violations = validateMessage(bytes.toString('utf8'), { cleanup });
  if (violations.length === 0) return;
  console.error(report(violations));
  process.exitCode = EXIT_VIOLATIONS;
}

await main(process.argv.slice(2));
