#!/usr/bin/env node
// release.mjs - moves [Unreleased] into a new dated version and rewrites the links, in canonical form.
//   node release.mjs <changelog> <version> [--date=YYYY-MM-DD]     the date defaults to today, UTC
// The file is written only when the result passes FORMAT.md; it must pass before the edit too.
// Exit 0: released. Exit 1: violations, an empty [Unreleased], or a version not above the newest (file
// unchanged). Exit 2: usage or read error.
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse, release, render, validate } from './changelog.mjs';
import { EXIT_VIOLATIONS, listedPath, readMovedTags, readText, report, usage } from './cli.mjs';

const USAGE = 'usage: release.mjs <changelog> <version> [--date=YYYY-MM-DD]';
const DATE_OPTION = '--date=';

function fail(text) {
  console.error(text);
  process.exitCode = EXIT_VIOLATIONS;
}

async function main(args) {
  const dateArg = args.find((arg) => arg.startsWith(DATE_OPTION));
  const rest = args.filter((arg) => arg !== dateArg);
  if (rest.length !== 2 || rest.some((arg) => arg.startsWith('-'))) return usage(USAGE);
  const [file, version] = rest;
  const date = dateArg ? dateArg.slice(DATE_OPTION.length) : new Date().toISOString().slice(0, 10);
  const path = listedPath(file);
  if (!path) return usage(`${file} is not in CHANGELOGS (changelog.mjs)`);

  let before;
  try {
    before = await readText(file);
  } catch (error) {
    return usage(`cannot read ${file}: ${error.code}`);
  }
  const moved = await readMovedTags(dirname(file));
  const existing = validate(before, { path, moved });
  if (existing.length > 0) return fail(report(`${path} (before the release)`, existing));

  let doc;
  try {
    doc = release(parse(before).doc, { version, date });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return fail(`release.mjs: ${error.message}`);
  }
  const after = render(doc, { path, moved });
  const violations = validate(after, { path, moved });
  if (violations.length > 0) return fail(report(`${path} (after the release, not written)`, violations));
  await writeFile(file, after);
}

await main(process.argv.slice(2));
