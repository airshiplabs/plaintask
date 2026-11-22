#!/usr/bin/env node
// build-app.mjs - `tauri build` with the git commit as the macOS build number (CFBundleVersion),
// so the About window reads "Version 0.0.0 (8b64004)" and names the build that is running.
// `--dirty` marks a build made from uncommitted changes.
//   pnpm --filter @plaintask/desktop app
import { execFileSync } from 'node:child_process';

const commit = execFileSync('git', ['describe', '--always', '--dirty', '--abbrev=7'], { encoding: 'utf8' }).trim();
const config = JSON.stringify({ bundle: { macOS: { bundleVersion: commit } } });

execFileSync('tauri', ['build', '--config', config, ...process.argv.slice(2)], { stdio: 'inherit' });
