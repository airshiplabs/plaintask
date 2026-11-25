// session.mjs - one scripted run of the desktop app's page: real keys and clicks, the file read back
// from disk, and evidence (screenshots, a subtitled video) for a bug report.
//
//   import { openApp } from './session.mjs';
//   const app = await openApp({ folder, inbox: '- [ ] Buy milk\n', evidence: { dir, video: 'double-undo' } });
//   await app.say('Tick "Buy milk".');               // subtitle; also refreshes the Inbox.md panel
//   await app.check('Buy milk').click();
//   console.log(await app.state());                  // rows, count, toasts, notice, file, page errors
//   await app.shot('after-tick');                    // <dir>/after-tick.png
//   await app.close();                               // writes <dir>/double-undo.mp4
//
// Needs Playwright (its own package, or the one inside a global @playwright/cli) and, for video, ffmpeg.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { serve } from './harness.mjs';

const WIDTH = 880, HEIGHT = 620;   // the app window's default size (src-tauri/tauri.conf.json)
const STRIP = 150;                 // the evidence strip under the app

export function playwright() {
  const roots = [import.meta.url];
  try { roots.push(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@playwright/cli/node_modules/')); } catch { /* no npm: the local package is the only place to look */ }
  for (const root of roots) { try { return createRequire(root)('playwright'); } catch { /* try the next place */ } }
  throw new Error('Playwright not found. Install it: npm install -g @playwright/cli && playwright-cli install');
}

// The strip holds the subtitle and Inbox.md as it is on disk, so one frame shows the screen and the file together.
const STRIP_CSS = `.app{height:${HEIGHT}px!important}.app__toasts{bottom:${STRIP + 20}px!important}
#qa{position:fixed;inset:auto 0 0 0;height:${STRIP}px;display:grid;grid-template-columns:1fr 300px;z-index:99;background:#111;color:#fff;border-top:2px solid #f5c400}
#qa-say{padding:12px 16px;align-self:center;font:600 17px/1.35 -apple-system,sans-serif}
#qa-file{padding:8px 12px;overflow:hidden;white-space:pre;background:#000;color:#9f9;font:12px/1.4 ui-monospace,Menlo,monospace}
#qa-file b{color:#f5c400;font-weight:400}`;

/** Opens the page on `folder`. `inbox` is written to Inbox.md first: a string, null for no file, undefined to leave the folder as it is.
    `evidence.dir` turns on the strip and `shot()`; `evidence.video` also records <dir>/<video>.mp4. `chosen: false` starts with no folder picked.
    `page: 'about.html'` opens the About window's page instead; `ready` is the selector that shows the page has drawn. */
export async function openApp({ folder, inbox, evidence, chosen = true, width = WIDTH, height = HEIGHT, page: path = '', ready = path ? '[data-version]:not(:empty)' : '[data-list] > *' }) {
  const file = join(folder, 'Inbox.md');
  mkdirSync(folder, { recursive: true });
  if (inbox === null) rmSync(file, { force: true });
  else if (inbox !== undefined) writeFileSync(file, inbox);
  if (evidence) mkdirSync(evidence.dir, { recursive: true });

  const harness = await serve(folder, { chosen });
  const { chromium } = playwright();
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
  const size = { width, height: height + (evidence ? STRIP : 0) };
  const raw = evidence?.video && join(evidence.dir, 'raw-' + evidence.video);
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: raw ? 1 : 2, ...(raw && { recordVideo: { dir: raw, size } }) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(harness.url + path);
  await page.waitForSelector(ready);
  if (evidence) {
    await page.addStyleTag({ content: STRIP_CSS + (path ? `html{height:${height}px!important}#qa{grid-template-columns:1fr}#qa-file{display:none}` : '') });
    await page.evaluate(() => { const strip = document.createElement('div'); strip.id = 'qa'; strip.innerHTML = '<div id="qa-say"></div><div id="qa-file"></div>'; document.body.append(strip); });
  }
  const onDisk = () => existsSync(file) ? readFileSync(file, 'utf8') : null;

  return {
    page, file,
    /** A task row's checkbox, by a piece of its title. */
    check: title => page.locator('li[data-row]', { hasText: title }).locator('.pt-check').first(),
    /** What the app does when its window regains focus: reread the file. */
    refocus: async () => { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(300); },
    /** Shows a subtitle and the file as it is on disk now, then holds for `ms` so a viewer can read it. */
    async say(text, ms = 1800) {
      if (!evidence) return;
      await page.evaluate(([said, disk]) => {
        document.getElementById('qa-say').textContent = said;
        document.getElementById('qa-file').innerHTML = '<b>Inbox.md on disk</b>\n' + disk.replace(/[&<]/g, c => '&#' + c.charCodeAt(0) + ';');
      }, [text, onDisk() ?? '(no Inbox.md)']);
      await page.waitForTimeout(ms);
    },
    /** What is on screen and what is on disk. Compare the two after every step: a row on screen does not show what was written. */
    state: async () => ({
      rows: await page.$$eval('[data-list] li[data-row] .pt-task__title', els => els.map(e => e.textContent)),
      count: await page.$eval('[data-badge="inbox"]', e => e.textContent),
      dock: harness.dock(),
      toasts: await page.$$eval('[data-toasts] .pt-toast', els => els.map(e => e.innerText.replace(/\n/g, ' | '))),
      notice: await page.$eval('[data-list]', e => e.querySelector('.pt-empty')?.innerText.replace(/\n/g, ' | ') ?? null),
      file: onDisk(),
      errors,
    }),
    async shot(name) {
      if (!evidence) throw new Error('shot() needs evidence.dir');
      const path = join(evidence.dir, name + '.png');
      await page.screenshot({ path });
      return path;
    },
    /** Stops everything. With a video, converts it to mp4 (GitHub plays mp4, mov and webm) and returns its path. */
    async close() {
      await context.close();
      await browser.close();
      await harness.close();
      if (!raw) return null;
      const out = join(evidence.dir, evidence.video + '.mp4');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(raw, readdirSync(raw)[0]), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
      rmSync(raw, { recursive: true });
      return out;
    },
  };
}
