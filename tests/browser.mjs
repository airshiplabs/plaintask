// browser.mjs - one site in headless Chrome for a node:test test, driven over the DevTools protocol with
// Node's own WebSocket and fetch (no dependencies). Same Chrome and software WebGL as scripts/make-stills.mjs.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WAIT = 15000;   // the bound on every wait below, in ms

const freePort = () => new Promise((res, rej) => {
  const s = createServer().once('error', rej).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

// the first output of a child that matches, or an error naming what never came
const output = (child, stream, re, what) => new Promise((res, rej) => {
  let seen = '';
  const timer = setTimeout(() => rej(new Error(what + ' did not start within ' + WAIT + ' ms: ' + seen.trim())), WAIT);
  child.once('exit', code => { clearTimeout(timer); rej(new Error(what + ' exited with ' + code + ': ' + seen.trim())); });
  child.once('error', e => { clearTimeout(timer); rej(e); });
  stream.on('data', d => { seen += d; const m = seen.match(re); if (m) { clearTimeout(timer); res(m); } });
});

// Runs in the page, which can decode a PNG (Node cannot): how many pixels of two same-size PNGs have a channel more than
// 64 of 255 apart. Two captures of an unchanged screen differ by a few levels where an image is resampled; a shape that moved differs by far more.
async function changedPixels(a, b) {
  const pixels = async png => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(img.width, img.height).getContext('2d');
    c.drawImage(img, 0, 0);
    return c.getImageData(0, 0, img.width, img.height).data;
  };
  const A = await pixels(a), B = await pixels(b);
  let n = 0;
  for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) > 64 || Math.abs(A[i + 1] - B[i + 1]) > 64 || Math.abs(A[i + 2] - B[i + 2]) > 64) n++;
  return n;
}

const stop = async child => {
  // Chrome's crash handler is detached, can outlive Chrome by a minute or two and keeps the far end of this pipe open: let go of it, or Node waits that long to exit
  child.stdout?.destroy(); child.stderr?.destroy();
  if (!child.pid || child.exitCode !== null || child.signalCode) return;   // never started, or already gone: no exit to wait for
  child.kill();
  await once(child, 'exit');
};

/** Serves one site (app | sh | ai, or a folder of the repo such as apps/desktop/dist) on a spare port and opens it
    in a width x height viewport. `before` is JavaScript that runs in the page ahead of the page's own scripts.
    Everything started here is stopped and removed when the test ends, whatever its outcome. */
export async function openSite(t, site, width, height, { before } = {}) {
  await access(CHROME).catch(() => { throw new Error('Chrome not found at "' + CHROME + '": set the CHROME environment variable to a Chrome or Chromium binary'); });
  const undo = [];   // newest first: the profile goes only after Chrome has exited
  t.after(async () => { for (const step of undo) await step(); });

  const port = await freePort();
  const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), site, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  undo.unshift(() => stop(server));
  await output(server, server.stdout, /http:\/\/127\.0\.0\.1:\d+\//, 'scripts/serve.mjs');

  const prof = await mkdtemp(join(tmpdir(), 'pt-test-'));
  undo.unshift(() => rm(prof, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const chrome = spawn(CHROME, ['--headless=new', '--user-data-dir=' + prof, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  undo.unshift(() => stop(chrome));
  const [, debugPort] = await output(chrome, chrome.stderr, /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//, 'Chrome');

  const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
  const ws = new WebSocket(targets.find(x => x.type === 'page').webSocketDebuggerUrl);
  undo.unshift(() => ws.close());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('no DevTools connection to Chrome')); });

  let id = 0, loaded;
  const calls = new Map();
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Page.loadEventFired') loaded();
    const call = calls.get(m.id);
    if (!call) return;   // an event, or the late answer to a call that already timed out
    calls.delete(m.id); clearTimeout(call.timer);
    if (m.error) call.rej(new Error(call.method + ': ' + m.error.message)); else call.res(m.result);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(method + ' had no answer within ' + WAIT + ' ms')), WAIT);
    calls.set(++id, { res, rej, method, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });

  /** the value of a JavaScript expression in the page (a promise is awaited) */
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('in the page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  // the scenes rest under reduced motion: the machine's own setting must not decide the test
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  // a headless page does not hold the keyboard, and a page without it gets no focus or blur events: tests of leaving a field need them
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.enable');
  if (before) await send('Page.addScriptToEvaluateOnNewDocument', { source: before });
  const load = new Promise(res => { loaded = res; });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' });
  await load;

  return {
    evaluate,
    /** Polls an expression until ok(value) or the bound, and returns the last value either way,
        so a miss is reported by the test's own assertion and not by a timeout in here. */
    async poll(expression, ok = Boolean) {
      const end = performance.now() + WAIT;
      for (;;) {
        const v = await evaluate(expression);
        if (ok(v) || performance.now() > end) return v;
        await new Promise(r => setTimeout(r, 50));
      }
    },
    /** Resolves once the browser has reported the element outside the viewport. Intersection observers are all
        told in the same frame, so a page's own observers have heard about the scroll by then too. */
    leftView: selector => evaluate('new Promise(done => new IntersectionObserver((es, io) => { if (!es[0].isIntersecting) { io.disconnect(); done(true); } }).observe(document.querySelector(' + JSON.stringify(selector) + ')))'),
    /** a PNG (base64) of what the screen shows inside the element's box */
    async screenshot(selector) {
      const clip = await evaluate('(r => ({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 1 }))(document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect())');
      return (await send('Page.captureScreenshot', { format: 'png', clip })).data;
    },
    /** Real mouse input from the browser, as a person's mouse or trackpad sends it: hit-testing and pointer-events apply. */
    mouse: {
      wheel: (x, y, deltaY) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }),
      async click(x, y) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      },
    },
    /** the number of pixels that differ visibly between two screenshots of the same box */
    changedPixels: (a, b) => evaluate('(' + changedPixels + ')(' + JSON.stringify(a) + ', ' + JSON.stringify(b) + ')'),
  };
}
