#!/usr/bin/env node
// validate.mjs - checks changelogs against FORMAT.md; output on stderr only.
//   node validate.mjs                          every path in CHANGELOGS, from the repo root
//   node validate.mjs <file>...                the named files; each must end with a CHANGELOGS path
//   node validate.mjs --path=<listed-path> -   stdin, judged as that listed path (the pre-commit hook)
// Exit 0: every file conforms. Exit 1: violations or a missing listed file. Exit 2: usage or read error.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGELOGS, validate } from './changelog.mjs';
import { EXIT_USAGE, EXIT_VIOLATIONS, listedPath, readMovedTags, readText, report, usage } from './cli.mjs';

const USAGE = 'usage: validate.mjs [<file>... | --path=<listed-path> -]';
const PATH_OPTION = '--path=';
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Returns [{ source, path }], or a string naming the usage error.
function parseArgs(args) {
  const pathArg = args.find((arg) => arg.startsWith(PATH_OPTION));
  const rest = args.filter((arg) => arg !== pathArg);
  if (pathArg) {
    const path = pathArg.slice(PATH_OPTION.length);
    if (rest.length !== 1 || rest[0] !== '-') return USAGE;
    if (!CHANGELOGS.includes(path)) return `${path} is not in CHANGELOGS (changelog.mjs)`;
    return [{ source: '-', path }];
  }
  if (rest.some((arg) => arg.startsWith('-'))) return USAGE;
  if (rest.length === 0) return CHANGELOGS.map((path) => ({ source: `${repoRoot}${path}`, path }));
  const targets = [];
  for (const source of rest) {
    const path = listedPath(source);
    if (!path) return `${source} is not in CHANGELOGS (changelog.mjs)`;
    targets.push({ source, path });
  }
  return targets;
}

async function main(args) {
  const targets = parseArgs(args);
  if (typeof targets === 'string') return usage(targets);
  let failed = false;
  for (const { source, path } of targets) {
    let text;
    try {
      text = await readText(source);
    } catch (error) {
      if (error.code !== 'ENOENT') return usage(`cannot read ${source}: ${error.code}`);
      console.error(`${path}: missing; every CHANGELOGS path must exist`);
      failed = true;
      continue;
    }
    const moved = await readMovedTags(source === '-' ? dirname(`${repoRoot}${path}`) : dirname(source));
    const violations = validate(text, { path, moved });
    if (violations.length === 0) continue;
    console.error(report(path, violations));
    failed = true;
  }
  if (failed) process.exitCode = EXIT_VIOLATIONS;
}

await main(process.argv.slice(2));
