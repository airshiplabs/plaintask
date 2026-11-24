#!/usr/bin/env node
// sparkle.mjs - puts Sparkle 2 in src-tauri/: Sparkle.framework, which the Rust build links and the bundle copies
// into the app, and sparkle-bin/ (sign_update, generate_keys, generate_appcast), which the release skill uses.
// Downloaded once from Sparkle's GitHub release and checked against a pinned SHA-256; a second run does nothing.
//   node apps/desktop/scripts/sparkle.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const VERSION = '2.9.6';
const SHA256 = '52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192';
const ARCHIVE = `https://github.com/sparkle-project/Sparkle/releases/download/${VERSION}/Sparkle-${VERSION}.tar.xz`;

const dest = new URL('../src-tauri/', import.meta.url).pathname;
const stamp = join(dest, 'sparkle-bin', '.sha256');

/** The SHA-256 of the archive already in place, or null when there is none. */
function installed() {
  try { return readFileSync(stamp, 'utf8').trim(); } catch { return null; }
}
if (installed() === SHA256 && existsSync(join(dest, 'Sparkle.framework'))) process.exit(0);

const response = await fetch(ARCHIVE);
if (!response.ok) throw new Error(`${ARCHIVE}: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const found = createHash('sha256').update(archive).digest('hex');
if (found !== SHA256) throw new Error(`${ARCHIVE}: SHA-256 is ${found}, expected ${SHA256}`);

const work = await mkdtemp(join(tmpdir(), 'sparkle-'));
try {
  // The checked bytes go straight to tar, so nothing can swap the archive between the check and the unpacking.
  execFileSync('tar', ['-xJf', '-', '-C', work], { input: archive });
  for (const name of ['Sparkle.framework', 'sparkle-bin']) await rm(join(dest, name), { recursive: true, force: true });
  await cp(join(work, 'Sparkle.framework'), join(dest, 'Sparkle.framework'), { recursive: true, verbatimSymlinks: true });
  await cp(join(work, 'bin'), join(dest, 'sparkle-bin'), { recursive: true, verbatimSymlinks: true });
  await writeFile(stamp, found + '\n');
  console.log(`Sparkle ${VERSION} is in ${dest}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
