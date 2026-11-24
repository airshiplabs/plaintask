#!/usr/bin/env node
// add.mjs - adds one entry under [Unreleased] in a changelog and rewrites the file in canonical form.
//   node add.mjs <changelog> <type> <ref> <text>
//   type: Added | Changed | Deprecated | Removed | Fixed | Security
//   ref:  #<pr-number> or a 7-40 char lowercase commit sha
// The file is written only when the result passes FORMAT.md; it must pass before the edit too.
// Exit 0: added. Exit 1: violations, before or after the edit (file unchanged). Exit 2: usage or read error.
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { addEntry, parse, render, TYPES, validate } from './changelog.mjs';
import { EXIT_VIOLATIONS, listedPath, readMovedTags, readText, report, usage } from './cli.mjs';

const USAGE = `usage: add.mjs <changelog> <${TYPES.join('|')}> <#pr|sha> <text>`;

async function main(args) {
  if (args.length !== 4) return usage(USAGE);
  const [file, type, ref, text] = args;
  if (!TYPES.includes(type)) return usage(`unknown type ${JSON.stringify(type)}\n${USAGE}`);
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
  if (existing.length > 0) {
    console.error(report(`${path} (before the edit)`, existing));
    process.exitCode = EXIT_VIOLATIONS;
    return;
  }

  const after = render(addEntry(parse(before).doc, { type, ref, text }), { path, moved });
  const violations = validate(after, { path, moved });
  if (violations.length > 0) {
    console.error(report(`${path} (after the edit, not written)`, violations));
    process.exitCode = EXIT_VIOLATIONS;
    return;
  }
  await writeFile(file, after);
}

await main(process.argv.slice(2));
