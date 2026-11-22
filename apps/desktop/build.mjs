#!/usr/bin/env node
// build.mjs - the desktop app's front end into dist/: src/main.ts bundled, the shell copied,
// and the design system's three files copied unchanged (tokens.css, bundle.css, bundle.js).
//   node apps/desktop/build.mjs
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const path = rel => fileURLToPath(new URL(rel, import.meta.url));
const out = path('dist/');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [path('src/main.ts')],
  outfile: out + 'main.js',
  bundle: true,
  format: 'esm',
  target: 'safari15',
  minify: true,
  logLevel: 'warning',
});

const copies = [
  ['src/index.html', 'index.html'],
  ['src/app.css', 'app.css'],
  ['../../packages/design-system/tokens.css', 'tokens.css'],
  ['../../packages/design-system/components/bundle.css', 'bundle.css'],
  ['../../packages/design-system/components/bundle.js', 'bundle.js'],
];
await Promise.all(copies.map(([from, to]) => copyFile(path(from), out + to)));
