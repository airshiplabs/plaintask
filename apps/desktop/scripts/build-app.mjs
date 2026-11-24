#!/usr/bin/env node
// build-app.mjs - `tauri build`, then Sparkle's nested code signed again, so the app can install updates and passes
// notarization. Tauri signs Sparkle's XPC services with the app's own sandbox entitlements, which stops
// Installer.xpc from launching the installer, and leaves Autoupdate and Updater.app ad-hoc signed.
// https://sparkle-project.org/documentation/sandboxing/ gives the order: the nested code, the framework, the app.
// It signs with APPLE_SIGNING_IDENTITY, as tauri build does, or ad-hoc without it. An ad-hoc build has no Team ID, so it
// is signed without the hardened runtime: the runtime's library validation would refuse to load Sparkle.framework.
//   pnpm --filter @plaintask/desktop app [-- tauri build options]
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = (path) => new URL('../' + path, import.meta.url).pathname;
const APP = here('src-tauri/target/release/bundle/macos/Plaintask.app');
const ENTITLEMENTS = here('src-tauri/Entitlements.plist');
const RELEASE_ID = 'com.airshiplabs.plaintask';

const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

run('tauri', ['build', ...process.argv.slice(2)]);

const identity = process.env.APPLE_SIGNING_IDENTITY || '-';
const developerId = identity === '-' ? [] : ['--options', 'runtime', '--timestamp'];
const sign = (path, ...extra) => run('codesign', ['--force', '--sign', identity, ...developerId, ...extra, path]);

const framework = join(APP, 'Contents/Frameworks/Sparkle.framework');
for (const nested of ['XPCServices/Installer.xpc', 'XPCServices/Downloader.xpc', 'Autoupdate', 'Updater.app']) sign(join(framework, 'Versions/B', nested));
sign(framework);

// Sparkle's mach-lookup names carry the bundle identifier: a build under a test identifier needs its own.
const id = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(APP, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const entitlements = (await readFile(ENTITLEMENTS, 'utf8')).replaceAll(`<string>${RELEASE_ID}-sp`, `<string>${id}-sp`);
const work = await mkdtemp(join(tmpdir(), 'plaintask-sign-'));
try {
  await writeFile(join(work, 'Entitlements.plist'), entitlements);
  sign(APP, '--entitlements', join(work, 'Entitlements.plist'));
} finally {
  await rm(work, { recursive: true, force: true });
}
run('codesign', ['--verify', '--deep', '--strict', APP]);
