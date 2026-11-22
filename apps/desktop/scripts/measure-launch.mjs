#!/usr/bin/env node
// measure-launch.mjs - how long the built app takes to start, from process start to two milestones:
//   ready        the page has drawn itself and asked for its window
//   first-frame  that page's first frame is painted on screen
//   node apps/desktop/scripts/measure-launch.mjs [runs]      (default 10; build first: pnpm --filter @plaintask/desktop app)
// Each run starts the app's binary with PLAINTASK_MEASURE_LAUNCH=1; the app prints the milestones and quits at the second.
// macOS paints no new window while the screen is locked or the display sleeps: "ready" is then the only number.
// The disk cache is warm after the first run, so the first run is reported apart from the median of the rest.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BINARY = fileURLToPath(new URL('../src-tauri/target/release/bundle/macos/Plaintask.app/Contents/MacOS/plaintask', import.meta.url));
const READY_LIMIT = 15000;   // a launch whose page is not drawn within this many ms is a failure, not a slow run
const FRAME_LIMIT = 2000;    // after "ready", how long to wait for a painted frame before recording that none came
const runs = Number(process.argv[2]) || 10;

await access(BINARY).catch(() => { throw new Error('no built app at ' + BINARY + ': run "pnpm --filter @plaintask/desktop app" first'); });

/** One launch: { ready, frame } in ms since the process was started; frame is null when nothing was painted. */
const launch = () => new Promise((resolve, reject) => {
  const started = performance.now();
  const child = spawn(BINARY, [], { env: { ...process.env, PLAINTASK_MEASURE_LAUNCH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', ready = null, timer;
  const finish = frame => { clearTimeout(timer); child.kill(); resolve({ ready, frame }); };
  timer = setTimeout(() => { child.kill(); reject(new Error('the page was not drawn within ' + READY_LIMIT + ' ms. stderr: ' + err.trim())); }, READY_LIMIT);
  child.stderr.on('data', d => { err += d; });
  child.stdout.on('data', d => {
    const now = performance.now() - started;
    out += d;
    if (ready === null && out.includes('ready')) { ready = now; clearTimeout(timer); timer = setTimeout(() => finish(null), FRAME_LIMIT); }
    if (out.includes('first-frame')) finish(now);
  });
  child.once('error', e => { clearTimeout(timer); reject(e); });
  child.once('exit', code => { if (ready === null) { clearTimeout(timer); reject(new Error('the app exited with ' + code + ' before its page was drawn. stderr: ' + err.trim())); } });
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
