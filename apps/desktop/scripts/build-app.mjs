#!/usr/bin/env node
// build-app.mjs - `tauri build` with the git commit as the macOS build number (CFBundleVersion),
// so the About window reads "Version 0.0.0 (8b64004)" and names the build that is running.
// `-dirty` marks a build made from uncommitted changes. build-number.mjs computes it.
//   pnpm --filter @plaintask/desktop app
import { execFileSync } from 'node:child_process';
import { buildNumber } from './build-number.mjs';

const config = JSON.stringify({ bundle: { macOS: { bundleVersion: buildNumber() } } });

execFileSync('tauri', ['build', '--config', config, ...process.argv.slice(2)], { stdio: 'inherit' });
