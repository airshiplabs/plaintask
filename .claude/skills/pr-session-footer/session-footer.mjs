#!/usr/bin/env node
// session-footer.mjs - appends the agent harness session footer to a PR body.
//   node session-footer.mjs < body.md > body-with-footer.md
// Reads the PR body on stdin and writes it to stdout ending in "<Harness> session: <id>".
// Leaves the body unchanged when that exact line is already in it.
// Exit 0: body written. Exit 1: no known harness session id in the environment.
import { fileURLToPath } from 'node:url';

// First match wins. Each entry: harness label, env var holding its session id.
export const HARNESSES = [
  { label: 'Claude Code', envVar: 'CLAUDE_CODE_SESSION_ID' },
  { label: 'Codex', envVar: 'CODEX_THREAD_ID' },
];

// Returns the footer line for the first harness whose env var is set, or null.
export function sessionFooter(env) {
  for (const { label, envVar } of HARNESSES) {
    const id = env[envVar]?.trim();
    if (id) return `${label} session: ${id}`;
  }
  return null;
}

// Returns body ending in footer, separated by one blank line.
export function appendFooter(body, footer) {
  const trimmed = body.replace(/\s+$/, '');
  if (trimmed.split('\n').includes(footer)) return `${trimmed}\n`;
  return trimmed ? `${trimmed}\n\n${footer}\n` : `${footer}\n`;
}

async function main() {
  const footer = sessionFooter(process.env);
  if (!footer) {
    const vars = HARNESSES.map(({ envVar }) => envVar).join(', ');
    process.stderr.write(`session-footer: no session id found; set one of: ${vars}\n`);
    process.exit(1);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  process.stdout.write(appendFooter(Buffer.concat(chunks).toString('utf8'), footer));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
