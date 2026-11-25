#!/usr/bin/env node
// stills-to-demo.mjs - turns window captures into a subtitled demo.mp4, for changes that only the built app shows.
//
//   node .claude/skills/pr-ui-evidence/scripts/stills-to-demo.mjs <out.mp4> <image> <subtitle> [<image> <subtitle> ...]
//
// Each image shows for 3.5 s above a strip with its subtitle, in the style of the exploratory-qa evidence strip.
// Images are 2x captures (screencapture -l <window id>). Needs Playwright and ffmpeg.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { playwright } from '../../exploratory-qa/scripts/session.mjs';

const SECONDS = 3.5, STRIP = 150, SCALE = 2;
const [out, ...pairs] = process.argv.slice(2);
if (!out || pairs.length < 2 || pairs.length % 2) {
  console.error('usage: stills-to-demo.mjs <out.mp4> <image> <subtitle> [<image> <subtitle> ...]');
  process.exit(2);
}
const shots = [];
for (let i = 0; i < pairs.length; i += 2) shots.push({ image: resolve(pairs[i]), say: pairs[i + 1] });

const size = file => execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' }).match(/\d+/g).slice(-2).map(Number);
const sizes = shots.map(s => size(s.image));
const width = Math.ceil(Math.max(...sizes.map(([w]) => w)) / SCALE / 2) * 2;
const height = Math.ceil(Math.max(...sizes.map(([, h]) => h)) / SCALE / 2) * 2;

const work = mkdtempSync(join(tmpdir(), 'demo-'));
const { chromium } = playwright();
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width, height: height + STRIP }, deviceScaleFactor: SCALE });
const escape = text => text.replace(/[&<]/g, c => '&#' + c.charCodeAt(0) + ';');
const frames = [];
for (const [i, shot] of shots.entries()) {
  const src = 'data:image/png;base64,' + readFileSync(shot.image).toString('base64');
  await page.setContent(`<body style="margin:0;background:#fff">
    <div style="height:${height}px;display:flex;justify-content:center;align-items:flex-start"><img src="${src}" style="width:${sizes[i][0] / SCALE}px"></div>
    <div style="height:${STRIP - 2}px;border-top:2px solid #f5c400;background:#111;color:#fff;display:flex;align-items:center;padding:0 16px;font:600 17px/1.35 -apple-system,sans-serif">${escape(shot.say)}</div></body>`);
  await page.waitForFunction(() => document.images[0].complete);
  frames.push(join(work, i + '.png'));
  await page.screenshot({ path: frames.at(-1) });
}
await browser.close();

const inputs = frames.flatMap(f => ['-loop', '1', '-t', String(SECONDS), '-i', f]);
const concat = frames.map((_, i) => `[${i}:v]`).join('') + `concat=n=${frames.length}:v=1:a=0,fps=30,format=yuv420p[v]`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', concat, '-map', '[v]', '-c:v', 'libx264', '-movflags', '+faststart', resolve(out)]);
rmSync(work, { recursive: true });
console.log('saved: ' + resolve(out));
