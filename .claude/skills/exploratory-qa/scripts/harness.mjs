#!/usr/bin/env node
// harness.mjs - the desktop app's page on a real task folder, with no Tauri and no window.
// Serves apps/desktop/dist and answers the commands of src-tauri/src/main.rs against the folder, so
// every edit the page makes lands in a real Inbox.md that a check can read back from disk.
//
//   node .claude/skills/exploratory-qa/scripts/harness.mjs <folder> [port] [--no-folder]
//
// --no-folder starts with no folder chosen; "Choose folder" then picks <folder>.
// Build the page first: node apps/desktop/build.mjs
//
// What differs from the app: the write is a plain overwrite, not inbox_file.rs's temporary file and
// rename (write-probe.rs checks that), and the engine is the browser you open it in, not WKWebView.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../../../../apps/desktop/dist/', import.meta.url));
const VERSION = JSON.parse(await readFile(join(DIST, '../package.json'), 'utf8')).version;   // About's app_version
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// Tauri's page-side API calls window.__TAURI_INTERNALS__.invoke; a rejected command rejects with the Rust error's text.
// @tauri-apps/api/event's listen calls transformCallback for the handler's id, then invokes plugin:event|listen.
const STAND_IN = `<script>
let nextCallback = 1;
window.__TAURI_INTERNALS__ = { transformCallback: () => nextCallback++, invoke: async (command, args) => {
  const out = await (await fetch('/ipc', { method: 'POST', body: JSON.stringify({ command, args }) })).json();
  if ('error' in out) throw out.error;
  return out.value;
} };
</script>`;

/** Starts the harness. Resolves to its URL, the last Dock count the page set, and a way to stop it. */
export async function serve(folder, { port = 0, chosen = true } = {}) {
  const picked = resolve(folder);
  let current = chosen ? picked : null;
  let dock = null;

  async function command(name, args) {
    const file = () => { if (!current) throw 'No task folder is chosen yet.'; return join(current, 'Inbox.md'); };
    if (name === 'folder') return current;
    if (name === 'choose_folder') return (current = picked);
    if (name === 'read_inbox') {
      const path = file();
      let bytes;
      try { bytes = await readFile(path); }
      catch (e) { if (e.code === 'ENOENT') return ''; throw `Could not read ${path}: ${e.message}`; }
      try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw `${path} is not UTF-8 text, so Plaintask will not change it.`; }
    }
    if (name === 'write_inbox') {
      const path = file();
      try { await writeFile(path, args.text); } catch (e) { throw `Could not save ${path}: ${e.message}`; }
      return null;
    }
    if (name === 'set_badge') { dock = args.count; return null; }
    if (name === 'ready' || name === 'first_frame') return null;
    if (name === 'plugin:event|listen') return args.handler;   // no update events are sent
    if (name === 'check_for_updates' || name === 'restart_for_update') return null;
    if (name === 'app_version') return VERSION;
    throw 'the page asked for a command the app does not have: ' + name;
  }

  // Only the harness's own page may call it. Any other site open in a browser on this machine could otherwise
  // POST to /ipc and rewrite the folder's Inbox.md; a rebound DNS name fails the Host check.
  let own = '';
  const server = createServer(async (req, res) => {
    if (req.headers.host !== own || (req.headers.origin && req.headers.origin !== 'http://' + own)) { res.writeHead(403).end('not the harness page'); return; }
    try {
      if (req.url === '/ipc') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { command: name, args } = JSON.parse(body);
        let out;
        try { out = { value: await command(name, args) }; } catch (e) { out = { error: typeof e === 'string' ? e : String(e) }; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
        return;
      }
      const name = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
      let data = await readFile(join(DIST, name));
      if (extname(name) === '.html') data = String(data).replace('<script src="bundle.js">', STAND_IN + '<script src="bundle.js">');
      res.writeHead(200, { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
    } catch (e) { res.writeHead(404).end(String(e)); }
  });
  await new Promise((done, fail) => server.once('error', fail).listen(port, '127.0.0.1', done));
  own = '127.0.0.1:' + server.address().port;
  return { url: 'http://' + own + '/', dock: () => dock, close: () => new Promise(done => server.close(done)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), [folder, port] = args.filter(a => !a.startsWith('--'));
  if (!folder) { console.error('usage: harness.mjs <folder> [port] [--no-folder]'); process.exit(2); }
  const { url } = await serve(folder, { port: Number(port ?? 4173), chosen: !flags.includes('--no-folder') });
  console.log('Plaintask page on ' + url + ' with task folder ' + resolve(folder));
}
