// cli.mjs - shared I/O for validate.mjs, add.mjs, and release.mjs: path lookup, file reads, and reports.
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { CHANGELOGS, MOVED_TAGS_FILE } from './changelog.mjs';

export const EXIT_VIOLATIONS = 1;
export const EXIT_USAGE = 2;
export const FORMAT_DOC = '.claude/skills/keep-a-changelog/FORMAT.md';

/** The CHANGELOGS entry a file path names: the one its absolute path ends with. null when none matches. */
export function listedPath(file) {
  const absolute = resolve(file).split(sep).join('/');
  return CHANGELOGS.find((path) => absolute.endsWith(`/${path}`)) ?? null;
}

/** The moved tags named in a changelog's directory (MOVED_TAGS_FILE), or {} when the file is absent. */
export async function readMovedTags(dir) {
  try {
    return JSON.parse(await readFile(join(dir, MOVED_TAGS_FILE), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function readText(source) {
  if (source !== '-') return (await readFile(source)).toString('utf8');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function report(name, violations) {
  const lines = [`${name}: does not match the changelog format`];
  for (const { rule, line, text, message } of violations) {
    lines.push(`  line ${line}: ${text}`, `  ${rule}: ${message}`);
  }
  lines.push(`format: ${FORMAT_DOC}`);
  return lines.join('\n');
}

/** Ends the command with a usage error. Sets process.exitCode, so stderr to a pipe is not cut short. */
export function usage(text) {
  console.error(text);
  process.exitCode = EXIT_USAGE;
}
