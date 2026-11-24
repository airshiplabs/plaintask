#!/usr/bin/env node
// build.mjs - the desktop app's front end into dist/: src/main.ts and src/about-main.ts bundled, the shells copied,
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
  entryPoints: { main: path('src/main.ts'), about: path('src/about-main.ts') },
  outdir: out,
  bundle: true,
  format: 'esm',
  target: 'safari15',
  minify: true,
  logLevel: 'warning',
});

const copies = [
  ['src/index.html', 'index.html'],
  ['src/app.css', 'app.css'],
  ['src/about.html', 'about.html'],
  ['src/about.css', 'about.css'],
  ['src-tauri/icons/icon.png', 'icon.png'],
  ['../../packages/design-system/tokens.css', 'tokens.css'],
  ['../../packages/design-system/components/bundle.css', 'bundle.css'],
  ['../../packages/design-system/components/bundle.js', 'bundle.js'],
];
await Promise.all(copies.map(([from, to]) => copyFile(path(from), out + to)));
