#!/usr/bin/env node
// serve.mjs - a static server for one folder of the repo (no dependencies).
//   node scripts/serve.mjs apps/desktop/dist 4310   the desktop app's built page on :4310
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };

function serve(dir, port) {
  const base = join(root, dir);
  http.createServer(async (req, res) => {
    try {
      let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      let file = join(base, path);
      if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); }
  }).listen(port, '127.0.0.1', () => console.log(dir + '  http://127.0.0.1:' + port + '/'));
}

const [dir, port] = process.argv.slice(2);
if (!dir) { console.error('usage: node scripts/serve.mjs <folder> [port]'); process.exit(1); }
serve(dir, Number(port) || 4301);
