#!/usr/bin/env node
// measure-launch.mjs - how long the built app takes to start, from the start of "open" to two milestones:
//   ready        the page has drawn itself and asked for its window
//   first-frame  that page's first frame is painted on screen
//   node apps/desktop/scripts/measure-launch.mjs [runs]      (default 10; build first: pnpm --filter @plaintask/desktop app)
// Each run opens the app through Launch Services ("open") with PLAINTASK_MEASURE_LAUNCH=1; the app prints the milestones and quits at the second.
// Not a direct exec of the binary: a Developer ID signed, sandboxed build started that way never draws its page.
// macOS paints no new window while the screen is locked or the display sleeps: "ready" is then the only number.
// The disk cache is warm after the first run, so the first run is reported apart from the median of the rest.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../src-tauri/target/release/bundle/macos/Plaintask.app', import.meta.url));
const BINARY = join(APP, 'Contents/MacOS/plaintask');
const READY_LIMIT = 15000;   // a launch whose page is not drawn within this many ms is a failure, not a slow run
const FRAME_LIMIT = 2000;    // after "ready", how long to wait for a painted frame before recording that none came
const POLL = 5;              // how often the app's stdout file is read, in ms: the resolution of both numbers
const runs = Number(process.argv[2]) || 10;

await access(BINARY).catch(() => { throw new Error('no built app at ' + BINARY + ': run "pnpm --filter @plaintask/desktop app" first'); });

/** One launch: { ready, frame } in ms since "open" was started; frame is null when nothing was painted. */
const launch = () => new Promise((resolve, reject) => {
  const logs = mkdtempSync(join(tmpdir(), 'plaintask-measure-'));
  const outFile = join(logs, 'stdout.txt'), errFile = join(logs, 'stderr.txt');
  writeFileSync(outFile, '');
  writeFileSync(errFile, '');
  const started = performance.now();
  const child = spawn('open', ['-W', '-n', '--env', 'PLAINTASK_MEASURE_LAUNCH=1', '--stdout', outFile, '--stderr', errFile, APP], { stdio: 'ignore' });
  let ready = null, timer, settled = false;
  // Stops the poll, the app if it still runs (it quits itself only after a painted frame) and "open", then deletes the log files: nothing reads them after this.
  const settle = () => { settled = true; clearInterval(poll); clearTimeout(timer); spawnSync('pkill', ['-f', BINARY]); child.kill(); rmSync(logs, { recursive: true, force: true }); };
  const finish = frame => { settle(); resolve({ ready, frame }); };
  const fail = message => { const err = readFileSync(errFile, 'utf8').trim(); settle(); reject(new Error(message + '. stderr: ' + err)); };
  const check = () => {
    const now = performance.now() - started;
    const out = readFileSync(outFile, 'utf8');
    if (ready === null && out.includes('ready')) { ready = now; clearTimeout(timer); timer = setTimeout(() => finish(null), FRAME_LIMIT); }
    if (out.includes('first-frame')) finish(now);
  };
  const poll = setInterval(check, POLL);
  timer = setTimeout(() => fail('the page was not drawn within ' + READY_LIMIT + ' ms'), READY_LIMIT);
  child.once('error', e => { settle(); reject(e); });
  child.once('exit', code => {
    if (settled) return;
    check();
    if (settled) return;
    if (ready === null) fail('the app exited (open: ' + code + ') before its page was drawn');
    else finish(null);
  });
});

const median = sorted => (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
const report = (label, times) => {
  if (!times.length) return;
  const sorted = [...times].sort((a, b) => a - b);
  console.log(label.padEnd(12) + 'median ' + median(sorted).toFixed(0) + ' ms   (min ' + sorted[0].toFixed(0) + ', max ' + sorted.at(-1).toFixed(0) + ', ' + sorted.length + ' runs)');
};

const first = await launch();
const rest = [];
for (let i = 0; i < runs; i++) rest.push(await launch());

console.log('first run   ready ' + first.ready.toFixed(0) + ' ms' + (first.frame === null ? '' : ', first-frame ' + first.frame.toFixed(0) + ' ms'));
report('ready', rest.map(r => r.ready));
const frames = rest.filter(r => r.frame !== null).map(r => r.frame);
report('first-frame', frames);
if (frames.length < rest.length) console.log((rest.length - frames.length) + ' of ' + rest.length + ' runs painted no frame within ' + FRAME_LIMIT + ' ms of "ready": is the screen locked or the display asleep?');
