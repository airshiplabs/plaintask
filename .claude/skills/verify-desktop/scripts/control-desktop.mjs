#!/usr/bin/env node
// control-desktop.mjs - drives the desktop app's built page (apps/desktop/dist) in headless Chrome, one shell command per step.
// The Rust commands the page calls are answered from a real, disposable folder on disk. No dependencies.
//   node .claude/skills/verify-desktop/scripts/control-desktop.mjs help
// `launch` starts one background process per run (the daemon below). It serves the page, owns Chrome and holds the one
// DevTools connection, so focus and the console log last between commands. Every other command is a request to it.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '../../../..');
const VERIFY = join(ROOT, '.verify');
const DIST = join(ROOT, 'apps/desktop/dist');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEED = '# Inbox\n\n- [ ] Buy milk\n- [ ] Call the tiler\n- [x] Water the plants\n';
const WIDTH = 880, HEIGHT = 620;   // the viewport tests/desktop-app.test.mjs uses
const WAIT = 15000;                // the bound on every wait for Chrome or the daemon, in ms
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const COMMANDS = ['folder', 'choose_folder', 'read_inbox', 'write_inbox', 'set_badge', 'ready', 'first_frame', 'plugin:event|listen', 'check_for_updates', 'restart_for_update'];

const USAGE = `control-desktop.mjs <command> [--run <id>]     run id: letters, digits, - and _; default "default" or $VERIFY_RUN

  launch [--inbox <file> | --no-inbox] [--no-folder] [--panel pick|cancel] [--theme light|dark]
  doctor                         read-only health check; exit 0 when the run is worth driving
  cleanup                        stop what this run started, delete its scratch state, keep its evidence

  click  <target> [--double] [--expect <css>] [--screenshot <name>]
                                 real mouse events at the centre of the element; --screenshot writes evidence/<name>.png
                                 in the same command and prints how long after the click it was taken; --expect fails
                                 unless a visible element matches the selector within 500 ms of the click
  fill   <target> --value <text> click the field, select all, type the text
  type   <text>                  real key events into whatever has the keyboard
  press  <key> [--mod meta,ctrl,alt,shift]
                                 Enter Escape Space Tab Backspace Delete ArrowUp ArrowDown ArrowLeft ArrowRight Home End, or one character
  scroll <pixels>                real mouse wheel over the middle of the task list; a negative number scrolls up
  wait   <target> [--gone] [--timeout <ms>]   until the target is there (or gone); default 10000 ms

  snapshot [--save <name>]       state lines and the accessibility tree; --save writes evidence/<name>.snapshot.txt
  screenshot <name>              writes evidence/<name>.png
  file [--save <name>] [--path]  prints Inbox.md's bytes; --save copies them to evidence/<name>.Inbox.md; --path prints its path

  panel pick|cancel              what the folder panel answers the next time the page opens it
  fail read|write|folder <message>   make that command fail with the message;  fail <what> --off  ends it
  external --append <line> | --from <file> | --remove   change Inbox.md as another editor would
  external --move-folder | --return-folder              move the task folder away, as Finder would, or put it back
  refocus                        send the window a blur and a focus event, as switching back to the app does
  reload                         load the page again, as a relaunch of the app does

  <target> is one of:  --role <role> [--name <accessible name>]  |  --selector <css>  |  --text <exact text>
  add --nth <n> (from 1) when several elements match`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const die = (message, code = 1) => { console.error(message); process.exit(code); };

function paths(run) {
  const dir = join(VERIFY, run), scratch = join(dir, 'scratch'), tasks = join(scratch, 'Tasks');
  return { dir, scratch, tasks, evidence: join(dir, 'evidence'), inbox: join(tasks, 'Inbox.md'), dist: join(scratch, 'dist'),
    profile: join(scratch, 'chrome-profile'), launch: join(scratch, 'launch.json'), runFile: join(scratch, 'run.json'),
    moved: join(scratch, 'Tasks.moved'),
    daemonPid: join(scratch, 'daemon.pid'), chromePid: join(scratch, 'chrome.pid'), log: join(scratch, 'daemon.log') };
}

/** one hash over the page's files, so two runs can be told to serve the same build or not */
function buildSha(dir) {
  const h = createHash('sha256');
  for (const name of fs.readdirSync(dir).sort()) { h.update(name + '\0'); h.update(fs.readFileSync(join(dir, name))); }
  return h.digest('hex').slice(0, 12);
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** the command line of a process, or '' when there is none */
const commandOf = pid => { try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return ''; } };
/** every process whose command line names this run's scratch folder: the daemon, Chrome and Chrome's helpers */
function processesOf(scratch) {
  const out = execFileSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' });
  return out.split('\n').map(line => line.trim().match(/^(\d+)\s+(.*)$/)).filter(Boolean)
    .map(m => ({ pid: Number(m[1]), command: m[2] })).filter(p => p.pid !== process.pid && p.command.includes(scratch + '/'));
}

// ---------------------------------------------------------------- command line

const TARGET = { role: 'value', name: 'value', selector: 'value', text: 'value', nth: 'value' };
const SPEC = {
  launch: { flags: { inbox: 'value', 'no-inbox': 'bool', 'no-folder': 'bool', panel: 'value', theme: 'value' } },
  doctor: {}, cleanup: {}, refocus: {}, reload: {},
  click: { flags: { ...TARGET, double: 'bool', expect: 'value', screenshot: 'value' } },
  fill: { flags: { ...TARGET, value: 'value' } },
  type: { args: 1 },
  scroll: { args: 1 },
  press: { args: 1, flags: { mod: 'value' } },
  wait: { flags: { ...TARGET, gone: 'bool', timeout: 'value' } },
  snapshot: { flags: { save: 'value' } },
  screenshot: { args: 1 },
  file: { flags: { save: 'value', path: 'bool' } },
  panel: { args: 1 },
  fail: { args: 2, optional: 1, flags: { off: 'bool' } },
  external: { flags: { append: 'value', from: 'value', remove: 'bool', 'move-folder': 'bool', 'return-folder': 'bool' } },
};

function parse(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') { console.log(USAGE); process.exit(0); }
  const spec = SPEC[command];
  if (!spec) die('unknown command "' + command + '"\n\n' + USAGE);
  const known = { run: 'value', ...spec.flags }, flags = {}, args = [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word.startsWith('--')) { args.push(word); continue; }
    const name = word.slice(2);
    if (!known[name]) die(command + ' has no flag ' + word);
    if (known[name] === 'bool') flags[name] = true;
    else if (++i < rest.length) flags[name] = rest[i];
    else die(word + ' needs a value');
  }
  const most = spec.args ?? 0, least = most - (spec.optional ?? 0);
  if (args.length < least || args.length > most) die(command + ' takes ' + (least === most ? most : least + ' or ' + most) + ' argument(s), got ' + args.length + '. Quote text that has spaces.');
  const run = flags.run ?? process.env.VERIFY_RUN ?? 'default';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(run)) die('run id "' + run + '" must be 1 to 40 letters, digits, - or _');
  delete flags.run;
  return { command, run, flags, args };
}

async function launch(run, flags) {
  const p = paths(run);
  if (fs.existsSync(p.scratch)) die('run "' + run + '" already has scratch state at ' + p.scratch + '. Run `cleanup --run ' + run + '` first, or pick another --run id.');
  if (!fs.existsSync(CHROME)) die('Chrome not found at "' + CHROME + '": set the CHROME environment variable to a Chrome or Chromium binary');
  if (flags.inbox && flags['no-inbox']) die('give --inbox or --no-inbox, not both');
  for (const [flag, allowed] of [['panel', ['pick', 'cancel']], ['theme', ['light', 'dark']]])
    if (flags[flag] && !allowed.includes(flags[flag])) die('--' + flag + ' is ' + allowed.join(' or '));
  const seed = flags['no-inbox'] ? null : flags.inbox ? fs.readFileSync(resolve(flags.inbox)) : Buffer.from(SEED);

  fs.mkdirSync(p.evidence, { recursive: true });
  fs.mkdirSync(p.tasks, { recursive: true });
  if (seed) fs.writeFileSync(p.inbox, seed);

  // build.mjs empties apps/desktop/dist first, so two launches must not build at once
  const lock = join(VERIFY, '.build.lock');
  for (const end = Date.now() + 60000; ;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - fs.statSync(lock).mtimeMs > 60000) { fs.rmSync(lock, { recursive: true, force: true }); continue; }   // left by a launch that died
      if (Date.now() > end) die('another launch has held ' + lock + ' for 60 s');
      await sleep(100);
    }
  }
  try {
    execFileSync(process.execPath, [join(ROOT, 'apps/desktop/build.mjs')], { stdio: ['ignore', 'inherit', 'inherit'] });
    fs.cpSync(DIST, p.dist, { recursive: true });
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }

  const git = (...args) => { try { return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim(); } catch { return ''; } };
  const build = { sha: buildSha(p.dist), builtAt: Date.now(), commit: git('rev-parse', '--short', 'HEAD'),
    uncommitted: git('status', '--porcelain', '--', 'apps/desktop/src', 'apps/desktop/build.mjs', 'packages/design-system').split('\n').filter(Boolean).length };
  fs.writeFileSync(p.launch, JSON.stringify({ run, chosen: !flags['no-folder'], panel: flags.panel ?? 'pick', theme: flags.theme ?? 'light', build }, null, 2));

  const log = fs.openSync(p.log, 'a');
  const daemon = spawn(process.execPath, [SELF, '__daemon', p.launch], { detached: true, stdio: ['ignore', log, log] });
  fs.writeFileSync(p.daemonPid, String(daemon.pid));
  daemon.unref();

  let info = null;
  for (const end = Date.now() + 2 * WAIT; Date.now() < end && alive(daemon.pid) && !fs.existsSync(p.runFile); await sleep(50));
  if (fs.existsSync(p.runFile)) info = JSON.parse(fs.readFileSync(p.runFile, 'utf8'));   // read even when the daemon has exited: it reports its error there
  if (!info || info.error) {
    const why = info?.error ?? 'the daemon did not report within ' + 2 * WAIT + ' ms';
    const said = fs.readFileSync(p.log, 'utf8').trim();
    await cleanup(run, true);
    die('launch failed: ' + why + (said ? '\n--- daemon log ---\n' + said : ''));
  }
  console.log(['run: ' + run, 'url: ' + info.url,
    'folder: ' + p.tasks + (flags['no-folder'] ? ' (not chosen yet; the folder panel will ' + (flags.panel ?? 'pick') + ')' : ' (chosen)'),
    'Inbox.md: ' + (seed ? seed.length + ' bytes' : 'absent'),
    'build: ' + build.sha + ' at git ' + build.commit + (build.uncommitted ? ' + ' + build.uncommitted + ' uncommitted source file(s)' : ''),
    'evidence: ' + p.evidence, 'ready: the page drew and called `ready`'].join('\n'));
}

async function cleanup(run, quiet = false) {
  const p = paths(run), say = quiet ? () => {} : line => console.log(line);
  if (!fs.existsSync(p.scratch)) say('run "' + run + '" has no scratch state: nothing to stop');
  else {
    // Only processes whose command line names this run's scratch folder are stopped: ones this run started.
    const daemon = Number(fs.existsSync(p.daemonPid) && fs.readFileSync(p.daemonPid, 'utf8'));
    if (daemon && commandOf(daemon).includes(p.scratch + '/')) process.kill(daemon, 'SIGTERM');   // the daemon stops Chrome on its way out
    for (const end = Date.now() + 3000; Date.now() < end && daemon && alive(daemon); await sleep(50));
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const left = processesOf(p.scratch);
      for (const { pid } of left) { try { process.kill(pid, signal); } catch { /* gone between the listing and the signal */ } }
      for (const end = Date.now() + 3000; Date.now() < end && processesOf(p.scratch).length; await sleep(50));
    }
    const left = processesOf(p.scratch);
    if (left.length) die('could not stop: ' + left.map(x => x.pid + ' ' + x.command.slice(0, 80)).join('\n'));
    fs.rmSync(p.scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    say('stopped run "' + run + '" and removed ' + p.scratch);
  }
  const kept = fs.existsSync(p.evidence) ? fs.readdirSync(p.evidence).sort() : [];
  say('evidence kept: ' + p.evidence + (kept.length ? '\n' + kept.map(name => '  ' + name).join('\n') : ' (empty)'));
}

/** Sends one command to the run's daemon and returns { out, code }. */
async function ask(run, command, flags = {}, args = []) {
  const p = paths(run);
  if (!fs.existsSync(p.runFile)) die('run "' + run + '" is not launched. Run `launch --run ' + run + '` first.');
  const info = JSON.parse(fs.readFileSync(p.runFile, 'utf8'));
  let res;
  try {
    res = await fetch(info.url + '__control', { method: 'POST', headers: { 'x-verify-token': info.token }, body: JSON.stringify({ command, flags, args }) });
  } catch { die('run "' + run + '" does not answer at ' + info.url + '. Run `doctor --run ' + run + '`.'); }
  if (res.status !== 200) die('the process at ' + info.url + ' is not this run\'s daemon (HTTP ' + res.status + '). Run `doctor --run ' + run + '`.');
  return res.json();
}

async function doctor(run) {
  const p = paths(run), lines = [];
  let bad = 0;
  const check = (ok, text) => { lines.push((ok ? 'ok    ' : 'FAIL  ') + text); if (!ok) bad++; };
  if (!fs.existsSync(p.runFile)) die('FAIL  run "' + run + '" is not launched (no ' + p.runFile + ')');
  const info = JSON.parse(fs.readFileSync(p.runFile, 'utf8'));
  check(alive(info.daemonPid) && commandOf(info.daemonPid).includes(p.scratch + '/'), 'daemon pid ' + info.daemonPid + ' is alive and is this run\'s');
  check(alive(info.chromePid) && commandOf(info.chromePid).includes(p.profile), 'Chrome pid ' + info.chromePid + ' is alive and uses this run\'s profile');
  let state = null;
  try {
    const res = await fetch(info.url + '__control', { method: 'POST', headers: { 'x-verify-token': info.token }, body: JSON.stringify({ command: 'info' }) });
    if (res.status === 200) state = JSON.parse((await res.json()).out);
  } catch { /* reported below */ }
  check(state?.daemonPid === info.daemonPid, 'page port ' + info.port + ' is answered by this run\'s daemon');
  let debug = null;
  try { debug = await (await fetch('http://127.0.0.1:' + info.debugPort + '/json/version')).json(); } catch { /* reported below */ }
  check(Boolean(debug?.webSocketDebuggerUrl), 'DevTools port ' + info.debugPort + ' answers' + (debug ? ' (' + debug.Browser + ')' : ''));
  check(state?.calls.ready > 0, 'the page drew: `ready` called ' + (state?.calls.ready ?? 0) + ' time(s) since the last load');
  check(state?.consoleErrors === 0, 'console errors: ' + (state?.consoleErrors ?? 'unknown'));
  const served = fs.existsSync(p.dist) ? buildSha(p.dist) : null;
  check(served === info.build.sha, 'serving build ' + info.build.sha + ' from ' + p.dist);
  const sources = [join(ROOT, 'apps/desktop/src'), join(ROOT, 'packages/design-system/tokens.css'), join(ROOT, 'packages/design-system/components/bundle.css'), join(ROOT, 'packages/design-system/components/bundle.js')];
  const newest = Math.max(...sources.flatMap(s => fs.statSync(s).isDirectory() ? fs.readdirSync(s).map(name => join(s, name)) : [s]).map(f => fs.statSync(f).mtimeMs));
  check(newest <= info.build.builtAt, newest <= info.build.builtAt ? 'no page source changed since this build' : 'page source changed after this build: cleanup and launch again');
  lines.push('      build ' + info.build.sha + ' built ' + new Date(info.build.builtAt).toISOString() + ' at git ' + info.build.commit + (info.build.uncommitted ? ' + ' + info.build.uncommitted + ' uncommitted source file(s)' : ''));
  lines.push('      url ' + info.url);
  lines.push('      data folder ' + p.tasks + (fs.existsSync(p.tasks) ? '' : ' (gone)') + (state ? (state.chosen ? ' (chosen)' : ' (not chosen; panel will ' + state.panel + ')') : ''));
  lines.push('      Inbox.md ' + (fs.existsSync(p.inbox) ? fs.statSync(p.inbox).size + ' bytes, sha256 ' + sha(fs.readFileSync(p.inbox)).slice(0, 12) : 'absent'));
  if (state) lines.push('      sidebar badge ' + (state.sidebar || 'none') + ', Dock badge ' + (state.dock ?? 'never set'));
  lines.push('      evidence ' + p.evidence);
  lines.push(bad ? 'NOT HEALTHY: ' + bad + ' check(s) failed. Run cleanup, then launch.' : 'healthy');
  console.log(lines.join('\n'));
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- the daemon

async function daemon(launchFile) {
  const opts = JSON.parse(fs.readFileSync(launchFile, 'utf8')), p = paths(opts.run);
  const state = { chosen: opts.chosen, panel: opts.panel, fail: { read: null, write: null, folder: null }, dock: null,
    calls: Object.fromEntries(COMMANDS.map(c => [c, 0])), inFlight: 0, lastCall: 0, consoleErrors: [] };
  const token = randomBytes(16).toString('hex');
  const transcript = join(p.evidence, 'transcript.log');
  const record = line => fs.appendFileSync(transcript, new Date().toISOString() + '  ' + line + '\n');

  /** Answers a command as src-tauri/src/main.rs does, from the run's folder. A thrown string is the rejection the page gets. */
  async function tauri(command, args) {
    if (!(command in state.calls)) throw 'the page asked for a command the app does not have: ' + command;
    state.calls[command]++;
    if (command === 'folder') { if (state.fail.folder) throw state.fail.folder; return state.chosen ? p.tasks : null; }
    if (command === 'choose_folder') {
      if (state.panel !== 'pick') return null;
      if (fs.existsSync(p.moved) && !fs.existsSync(p.tasks)) fs.renameSync(p.moved, p.tasks);   // a panel returns a folder that is there: the pick finds the moved folder
      state.chosen = true;
      return p.tasks;
    }
    if (command === 'set_badge') { state.dock = args.count; return null; }
    if (command === 'ready' || command === 'first_frame') return null;
    if (command === 'plugin:event|listen') return args.handler;   // no update events are sent
    if (command === 'check_for_updates' || command === 'restart_for_update') return null;
    if (!state.chosen) throw 'No task folder is chosen yet.';
    if (command === 'read_inbox') {
      if (state.fail.read) throw state.fail.read;
      let bytes;
      try { bytes = await fsp.readFile(p.inbox); } catch (e) {
        if (e.code !== 'ENOENT') throw 'Could not read ' + p.inbox + ': ' + e.message;
        // as inbox_file.rs: no file in a folder that is there is an empty Inbox; a folder that is gone is null
        try { return (await fsp.stat(p.tasks)).isDirectory() ? '' : null; } catch (e2) { if (e2.code === 'ENOENT') return null; throw 'Could not read ' + p.inbox + ': ' + e2.message; }
      }
      try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw p.inbox + ' is not UTF-8 text, so Plaintask will not change it.'; }
    }
    if (state.fail.write) throw state.fail.write;
    if (typeof args.text !== 'string') throw 'write_inbox needs text';
    // as inbox_file.rs: a symlink is followed, a hard-linked or read-only file is refused, the mode is kept, and a temporary file is renamed into place
    const target = await fsp.realpath(p.inbox).catch(() => p.inbox), existing = await fsp.stat(target).catch(() => null);
    if (existing) {
      if (existing.nlink > 1) throw target + ' has a hard link, which a save would leave with the old text, so Plaintask will not change it. A symlink works.';
      try { await (await fsp.open(target, 'r+')).close(); } catch (e) {
        throw e.code === 'EACCES' || e.code === 'EPERM' ? target + ' is read-only or locked, so Plaintask will not change it.' : 'Could not save ' + target + ': ' + e.message;
      }
    }
    const temp = join(dirname(target), '.Inbox.md.' + process.pid + '.tmp');
    try {
      await fsp.writeFile(temp, args.text);
      if (existing) await fsp.chmod(temp, existing.mode & 0o7777);
      await fsp.rename(temp, target);
    } catch (e) { await fsp.rm(temp, { force: true }).catch(() => {}); throw 'Could not save ' + target + ': ' + e.message; }
    return null;
  }

  // @tauri-apps/api/event's listen calls transformCallback for the handler's id, then invokes plugin:event|listen.
  const STAND_IN = '<script>let nextCallback = 1; window.__TAURI_INTERNALS__ = { transformCallback: () => nextCallback++, invoke: async (command, args) => {' +
    ' const answer = await (await fetch("/__tauri/" + encodeURIComponent(command), { method: "POST", body: JSON.stringify(args ?? {}) })).json();' +
    ' if (!answer.ok) throw answer.error; return answer.value; } };</script>\n';
  const body = req => new Promise((res, rej) => { let text = ''; req.on('data', d => { text += d; }); req.on('end', () => res(text)); req.on('error', rej); });
  const json = (res, status, value) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value));

  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://x').pathname;
      if (path.startsWith('/__tauri/') && req.method === 'POST') {
        const command = decodeURIComponent(path.slice(9)), args = JSON.parse(await body(req) || '{}');
        state.inFlight++; state.lastCall = Date.now();
        try {
          const value = await tauri(command, args);
          record('page   ' + command + (command === 'write_inbox' ? ' ' + Buffer.byteLength(args.text) + ' bytes' : command === 'set_badge' ? ' ' + args.count : '') + ' -> ' + (typeof value === 'string' && command === 'read_inbox' ? Buffer.byteLength(value) + ' bytes' : JSON.stringify(value)));
          json(res, 200, { ok: true, value });
        } catch (e) {
          const error = typeof e === 'string' ? e : String(e?.message ?? e);
          record('page   ' + command + ' -> rejected: ' + error);
          json(res, 200, { ok: false, error });
        } finally { state.inFlight--; state.lastCall = Date.now(); }
        return;
      }
      if (path === '/__control' && req.method === 'POST') {
        if (req.headers['x-verify-token'] !== token) { json(res, 403, { out: 'wrong token', code: 1 }); return; }
        const { command, flags = {}, args = [] } = JSON.parse(await body(req));
        const logged = !['info', 'snapshot', 'file', 'wait'].includes(command) || flags.save;
        try {
          const out = await control[command](flags, args);
          if (logged) record('agent  ' + command + ' ' + JSON.stringify({ ...flags, ...(flags.from !== undefined && { from: '<' + Buffer.from(flags.from, 'base64').length + ' bytes>' }), ...(args.length && { args }) }) + ' -> ' + out.split('\n')[0]);
          json(res, 200, { out, code: 0 });
        } catch (e) {
          const out = e instanceof Refusal ? e.message : 'control-desktop failed: ' + (e?.stack ?? e);
          if (logged) record('agent  ' + command + ' ' + JSON.stringify({ ...flags, ...(flags.from !== undefined && { from: '<' + Buffer.from(flags.from, 'base64').length + ' bytes>' }), ...(args.length && { args }) }) + ' -> FAILED: ' + out.split('\n')[0]);
          json(res, 200, { out, code: e instanceof Refusal ? e.code : 2 });
        }
        return;
      }
      const name = path === '/' ? 'index.html' : path.slice(1);
      if (name.includes('/') || name.includes('..')) { res.writeHead(404).end(); return; }
      let file = await fsp.readFile(join(p.dist, name));
      if (name === 'index.html') {
        const html = file.toString(), at = html.indexOf('<script');
        if (at === -1) throw new Error('index.html has no <script> to put the command stand-in before');
        file = html.slice(0, at) + STAND_IN + html.slice(at);
        for (const c of COMMANDS) state.calls[c] = 0;   // counts are per page load
        state.consoleErrors = [];
      }
      res.writeHead(200, { 'content-type': TYPES[extname(name)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(file);
    } catch (e) { res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' }).end(String(e.message)); }
  });
  await new Promise((res, rej) => server.once('error', rej).listen(0, '127.0.0.1', res));
  const port = server.address().port, url = 'http://127.0.0.1:' + port + '/';

  const chrome = spawn(CHROME, ['--headless=new', '--user-data-dir=' + p.profile, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=' + WIDTH + ',' + HEIGHT, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.writeFileSync(p.chromePid, String(chrome.pid));
  const stop = code => { chrome.kill(); server.close(); process.exit(code); };
  process.on('SIGTERM', () => stop(0));
  process.on('SIGINT', () => stop(0));
  const giveUp = error => { fs.writeFileSync(p.runFile, JSON.stringify({ error })); stop(1); };
  chrome.once('exit', code => { console.error('Chrome exited with ' + code); giveUp('Chrome exited with ' + code); });

  const debugPort = await new Promise(res => {
    let seen = '';
    const timer = setTimeout(() => giveUp('Chrome did not open a DevTools port within ' + WAIT + ' ms: ' + seen.trim()), WAIT);
    chrome.stderr.on('data', d => { seen += d; const m = seen.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) { clearTimeout(timer); res(Number(m[1])); } });
  });
  const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
  const ws = new WebSocket(targets.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('no DevTools connection to Chrome')); });

  let id = 0, loaded = () => {};
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Page.loadEventFired') loaded();
    if (m.method === 'Runtime.exceptionThrown') state.consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') state.consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    const call = pending.get(m.id);
    if (!call) return;
    pending.delete(m.id); clearTimeout(call.timer);
    if (m.error) call.rej(new Error(call.method + ': ' + m.error.message)); else call.res(m.result);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(method + ' had no answer within ' + WAIT + ' ms')), WAIT);
    pending.set(++id, { res, rej, method, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('in the page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  /** runs a function in the page with `this` set to an element */
  const on = async (objectId, fn) => {
    const r = await send('Runtime.callFunctionOn', { objectId, functionDeclaration: String(fn), returnByValue: true });
    if (r.exceptionDetails) throw new Error('in the page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  /** Resolves once the page has had two frames and no command from it has been in flight for 60 ms, or after 3 s. */
  async function settle() {
    await Promise.race([evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'), sleep(500)]);
    for (const end = Date.now() + 3000; Date.now() < end; await sleep(20)) if (state.inFlight === 0 && Date.now() - state.lastCall > 60) return;
  }
  async function load(how) {
    const done = new Promise(res => { loaded = res; });
    await send(...how);
    await Promise.race([done, sleep(WAIT)]);
    for (const end = Date.now() + WAIT; Date.now() < end && !state.calls.ready; await sleep(20));
    await settle();
    return state.calls.ready > 0;
  }

  // ---- finding elements

  const describe = flags => (flags.role ? flags.role + (flags.name !== undefined ? ' "' + flags.name + '"' : '') : flags.selector ? flags.selector : 'text "' + flags.text + '"');
  /** the object ids of the visible elements a target names, in document order */
  async function find(flags) {
    const kinds = ['role', 'selector', 'text'].filter(k => flags[k] !== undefined);
    if (kinds.length !== 1) throw new Refusal('name the target with exactly one of --role [--name], --selector or --text');
    if (flags.name !== undefined && !flags.role) throw new Refusal('--name needs --role');
    if (flags.role) {
      const doc = (await send('Runtime.evaluate', { expression: 'document' })).result.objectId;
      const { nodes } = await send('Accessibility.queryAXTree', { objectId: doc, role: flags.role, ...(flags.name !== undefined && { accessibleName: flags.name }) });
      const ids = [];
      for (const n of nodes) if (!n.ignored && n.backendDOMNodeId) ids.push((await send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId })).object.objectId);
      return ids;
    }
    const list = flags.selector
      ? '[...document.querySelectorAll(' + JSON.stringify(flags.selector) + ')]'
      : '[...document.body.querySelectorAll("*")].filter(e => e.textContent.trim() === ' + JSON.stringify(flags.text) + ' && ![...e.children].some(c => c.textContent.trim() === ' + JSON.stringify(flags.text) + '))';
    const r = await send('Runtime.evaluate', { expression: list + '.filter(e => e.getClientRects().length > 0 && !e.closest("[inert]"))' });
    if (r.exceptionDetails) throw new Refusal('bad target ' + describe(flags) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    const { result } = await send('Runtime.getProperties', { objectId: r.result.objectId, ownProperties: true });
    return result.filter(prop => /^\d+$/.test(prop.name)).map(prop => prop.value.objectId);
  }
  async function one(flags) {
    const found = await find(flags);
    if (!found.length) throw new Refusal('no visible element matches ' + describe(flags) + '. Run `snapshot` to see what is on the page.');
    if (flags.nth !== undefined) {
      const n = Number(flags.nth);
      if (!Number.isInteger(n) || n < 1 || n > found.length) throw new Refusal('--nth ' + flags.nth + ' is outside the ' + found.length + ' element(s) that match ' + describe(flags));
      return found[n - 1];
    }
    if (found.length > 1) throw new Refusal(found.length + ' elements match ' + describe(flags) + '. Add --nth <n> (from 1).');
    return found[0];
  }

  // ---- input

  const NAMED = { Enter: { code: 'Enter', vk: 13, text: '\r' }, Escape: { code: 'Escape', vk: 27 }, Space: { key: ' ', code: 'Space', vk: 32, text: ' ' }, Tab: { code: 'Tab', vk: 9 },
    Backspace: { code: 'Backspace', vk: 8 }, Delete: { code: 'Delete', vk: 46 }, ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowDown: { code: 'ArrowDown', vk: 40 },
    ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 } };
  const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  async function key(name, modifiers = 0, commands) {
    let k = NAMED[name];
    if (!k) {
      if ([...name].length !== 1) throw new Refusal('unknown key "' + name + '". Use one character or one of: ' + Object.keys(NAMED).join(' '));
      const upper = name.toUpperCase();
      k = { key: name, text: name, code: /^[A-Z]$/.test(upper) ? 'Key' + upper : /^\d$/.test(name) ? 'Digit' + name : '', vk: /^[A-Z0-9]$/.test(upper) ? upper.charCodeAt(0) : 0 };
    }
    const base = { key: k.key ?? name, code: k.code, windowsVirtualKeyCode: k.vk, modifiers };
    const text = modifiers & (MODS.ctrl | MODS.meta) ? undefined : k.text;   // a held Command or Control types nothing
    await send('Input.dispatchKeyEvent', { type: text === undefined ? 'rawKeyDown' : 'keyDown', ...base, ...(text !== undefined && { text, unmodifiedText: text }), ...(commands && { commands }) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async function mouse(objectId, flags) {
    const at = await on(objectId, function () {
      this.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = this.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
      return { x, y, size: r.width * r.height, hit: Boolean(hit) && this.contains(hit), over: hit ? '<' + hit.tagName.toLowerCase() + (hit.className ? ' class="' + hit.className + '"' : '') + '>' : 'nothing' };
    });
    if (!at.size) throw new Refusal(describe(flags) + ' has no size on screen, so a person cannot click it');
    if (!at.hit) throw new Refusal('the centre of ' + describe(flags) + ' is covered by ' + at.over + ', so a click would not reach it');
    const point = { x: at.x, y: at.y, button: 'left' };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    for (let count = 1; count <= (flags.double ? 2 : 1); count++) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, buttons: 1, clickCount: count });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, clickCount: count });
    }
    return Math.round(at.x) + ',' + Math.round(at.y);
  }
  const typeText = async text => { for (const ch of text) await key(ch === '\n' ? 'Enter' : ch); };

  // ---- reading the page

  async function tree() {
    const { nodes } = await send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map(n => [n.nodeId, n])), lines = [];
    let focus = null;
    const label = n => (n.role.value === 'StaticText' ? 'text' : n.role.value) + (n.name?.value ? ' ' + JSON.stringify(n.name.value) : '');
    const walk = (n, depth, parentName) => {
      const role = n.role?.value, name = n.name?.value ?? '';
      const hidden = n.ignored || role === 'InlineTextBox' || ((role === 'generic' || role === 'none') && !name) || (role === 'StaticText' && name === parentName);
      if (!hidden) {
        const props = Object.fromEntries((n.properties ?? []).map(prop => [prop.name, prop.value.value]));
        const marks = [n.value?.value !== undefined && n.value.value !== '' && 'value=' + JSON.stringify(n.value.value), props.checked !== undefined && 'checked=' + props.checked,
          props.focused && 'focused', props.disabled && 'disabled', props.invalid && props.invalid !== 'false' && 'invalid'].filter(Boolean);
        if (props.focused && role !== 'RootWebArea') focus = label(n);
        lines.push('  '.repeat(depth) + label(n) + (marks.length ? ' [' + marks.join(', ') + ']' : ''));
      }
      for (const child of n.childIds ?? []) if (byId.has(child)) walk(byId.get(child), hidden ? depth : depth + 1, hidden ? parentName : name);
    };
    walk(nodes.find(n => !n.parentId), 0, '');
    return { lines, focus };
  }
  const sidebar = () => evaluate('document.querySelector(\'[data-badge="inbox"]\')?.textContent ?? ""');
  const evidence = (name, suffix) => {
    if (!/^[A-Za-z0-9._-]+$/.test(name ?? '')) throw new Refusal('an evidence name is letters, digits, ".", "-" and "_"; got "' + name + '"');
    const file = join(p.evidence, name + suffix);
    if (fs.existsSync(file)) throw new Refusal(file + ' already exists. Evidence is never overwritten: use another name.');
    return file;
  };

  class Refusal extends Error { constructor(message, code = 1) { super(message); this.code = code; } }

  const control = {
    async info() {
      return JSON.stringify({ daemonPid: process.pid, chosen: state.chosen, panel: state.panel, calls: state.calls, dock: state.dock, sidebar: await sidebar(), consoleErrors: state.consoleErrors.length });
    },
    async click(flags) {
      const file = flags.screenshot === undefined ? null : evidence(flags.screenshot, '.png');
      const at = await mouse(await one(flags), flags);
      const clicked = Date.now();
      // A second command can come after a ticked row has left, so what the click must produce is checked here.
      if (flags.expect !== undefined) for (;;) {
        if ((await find({ selector: flags.expect })).length) break;
        if (Date.now() - clicked > 500) throw new Refusal('clicked ' + describe(flags) + ' at ' + at + ', but nothing matched ' + flags.expect + ' within 500 ms of the click');
        await sleep(25);
      }
      // A ticked row is held for 0.6 s and folds away by 1 s, so its picture is taken here too.
      // Chrome's first captures in a run can take over 1 s, so the output says how long this one took.
      if (file) { await sleep(350); fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
      const took = Date.now() - clicked;
      await settle();
      return (flags.double ? 'double-clicked ' : 'clicked ') + describe(flags) + ' at ' + at + (flags.expect !== undefined ? '\nthen found: ' + flags.expect : '') + (file ? '\nsaved: ' + file + ' (taken within ' + took + ' ms of the click)' : '');
    },
    async fill(flags) {
      if (flags.value === undefined) throw new Refusal('fill needs --value <text>');
      const target = await one(flags);
      await mouse(target, flags);
      if (!(await on(target, function () { return this === document.activeElement && (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA'); })))
        throw new Refusal(describe(flags) + ' did not take the keyboard when clicked, so it is not a field a person can type in');
      await key('a', MODS.meta, ['selectAll']);
      if (flags.value) await typeText(flags.value); else await key('Backspace');
      await settle();
      return 'filled ' + describe(flags) + ' with ' + JSON.stringify(flags.value);
    },
    async type(flags, [text]) {
      const { focus } = await tree();
      await typeText(text);
      await settle();
      return 'typed ' + JSON.stringify(text) + ' with the keyboard in ' + (focus ?? 'the document, no element');
    },
    async press(flags, [name]) {
      let modifiers = 0;
      for (const m of (flags.mod ?? '').split(',').filter(Boolean)) { if (!MODS[m]) throw new Refusal('unknown modifier "' + m + '". Use meta, ctrl, alt or shift.'); modifiers |= MODS[m]; }
      const { focus } = await tree();
      await key(name, modifiers);
      await settle();
      return 'pressed ' + (flags.mod ? flags.mod.split(',').join('+') + '+' : '') + name + ' with the keyboard in ' + (focus ?? 'the document, no element');
    },
    async wait(flags) {
      const limit = flags.timeout === undefined ? 10000 : Number(flags.timeout), started = Date.now();
      if (!Number.isFinite(limit) || limit < 0) throw new Refusal('--timeout is a number of ms');
      const nth = flags.nth === undefined ? 1 : Number(flags.nth);
      if (!Number.isInteger(nth) || nth < 1) throw new Refusal('--nth is a whole number from 1');
      for (;;) {
        const n = (await find(flags)).length;   // with --nth, the target is the nth match: there when n or more match
        if (flags.gone ? n < nth : n >= nth) return (flags.gone ? 'gone' : 'found') + ' after ' + (Date.now() - started) + ' ms: ' + describe(flags);
        if (Date.now() - started > limit) throw new Refusal(describe(flags) + (flags.gone ? ' was still there' : ' did not appear') + ' after ' + limit + ' ms');
        await sleep(50);
      }
    },
    async snapshot(flags) {
      const file = flags.save === undefined ? null : evidence(flags.save, '.snapshot.txt');
      const { lines, focus } = await tree();
      const inbox = fs.existsSync(p.inbox) ? fs.readFileSync(p.inbox) : null;
      const out = ['run: ' + opts.run, 'url: ' + url, 'build: ' + opts.build.sha,
        'folder: ' + (state.chosen ? 'chosen ' + p.tasks + (fs.existsSync(p.tasks) ? '' : ' (gone)') : 'not chosen (the folder panel will ' + state.panel + ')'),
        'Inbox.md: ' + (inbox ? inbox.length + ' bytes, sha256 ' + sha(inbox).slice(0, 12) : 'absent'),
        'sidebar badge: ' + (await sidebar() || 'none'), 'dock badge: ' + (state.dock ?? 'never set'),
        'focus: ' + (focus ?? 'the document, no element'),
        'commands since load: ' + COMMANDS.map(c => c + ' ' + state.calls[c]).join(', '),
        'failing: ' + (Object.entries(state.fail).filter(([, message]) => message).map(([what, message]) => what + ' ' + JSON.stringify(message)).join(', ') || 'nothing'),
        'console errors: ' + state.consoleErrors.length + state.consoleErrors.slice(-5).map(e => '\n  ' + e.split('\n')[0]).join(''),
        '--- accessibility tree ---', ...lines].join('\n');
      if (file) fs.writeFileSync(file, out + '\n');
      return out + (file ? '\nsaved: ' + file : '');
    },
    async screenshot(flags, [name]) {
      const file = evidence(name, '.png');
      fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      return 'saved: ' + file;
    },
    async file(flags) {
      if (flags.path) return p.inbox;
      if (!fs.existsSync(p.inbox)) throw new Refusal('Inbox.md is absent from ' + p.tasks, 3);
      if (flags.save === undefined) return '\0raw';   // the caller prints the bytes itself, unchanged
      const file = evidence(flags.save, '.Inbox.md');
      fs.copyFileSync(p.inbox, file);
      return 'saved: ' + file + ' (' + fs.statSync(file).size + ' bytes, sha256 ' + sha(fs.readFileSync(file)).slice(0, 12) + ')';
    },
    async panel(flags, [answer]) {
      if (answer !== 'pick' && answer !== 'cancel') throw new Refusal('panel takes pick or cancel');
      state.panel = answer;
      return 'the folder panel will ' + (answer === 'pick' ? 'return ' + p.tasks : 'be cancelled');
    },
    async fail(flags, [what, message]) {
      if (!(what in state.fail)) throw new Refusal('fail takes read, write or folder');
      if (Boolean(flags.off) === (message !== undefined)) throw new Refusal('give a message to start failing, or --off to stop');
      state.fail[what] = flags.off ? null : message;
      return flags.off ? what + ' works again' : what + ' now fails with: ' + message;
    },
    async external(flags) {
      const given = ['append', 'from', 'remove', 'move-folder', 'return-folder'].filter(k => flags[k] !== undefined);
      if (given.length !== 1) throw new Refusal('external takes exactly one of --append <line>, --from <file>, --remove, --move-folder or --return-folder');
      const there = fs.existsSync(p.tasks);
      if (flags['move-folder']) {
        if (!there) throw new Refusal('the task folder is already gone from ' + p.tasks);
        fs.renameSync(p.tasks, p.moved);
        return 'moved ' + p.tasks + ' to ' + p.moved + '. The page has not been told: run `refocus`.';
      }
      if (flags['return-folder']) {
        if (there) throw new Refusal('the task folder is at ' + p.tasks + ': nothing to put back');
        fs.renameSync(p.moved, p.tasks);
        return 'put the task folder back at ' + p.tasks + '. The page has not been told: run `refocus`.';
      }
      if (!there) throw new Refusal('the task folder is gone from ' + p.tasks + '. Run `external --return-folder` first.');
      if (flags.remove) { fs.rmSync(p.inbox, { force: true }); return 'removed ' + p.inbox; }
      if (flags.from !== undefined) fs.writeFileSync(p.inbox, Buffer.from(flags.from, 'base64')); else fs.appendFileSync(p.inbox, flags.append + '\n');
      return 'Inbox.md is now ' + fs.statSync(p.inbox).size + ' bytes, sha256 ' + sha(fs.readFileSync(p.inbox)).slice(0, 12) + '. The page has not been told: run `refocus`.';
    },
    async scroll(flags, [amount]) {
      const dy = Number(amount);
      if (!Number.isFinite(dy) || dy === 0) throw new Refusal('scroll takes a number of pixels other than 0; a negative number scrolls up');
      const at = await evaluate('(e => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: e.scrollTop }; })(document.querySelector("[data-scroll]"))');
      if (!at) throw new Refusal('the page has no task list to scroll');
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: dy });
      await settle();
      const top = await evaluate('document.querySelector("[data-scroll]").scrollTop');
      return 'turned the wheel ' + dy + ' px over the task list: it moved from ' + Math.round(at.top) + ' to ' + Math.round(top) + ' px';
    },
    async refocus() {
      // Headless Chrome under focus emulation never fires a real window focus event, so these two are made in the page.
      await evaluate('window.dispatchEvent(new Event("blur")), window.dispatchEvent(new Event("focus")), true');
      await settle();
      return 'sent the window a blur event and a focus event';
    },
    async reload() {
      if (!(await load(['Page.reload', { ignoreCache: true }]))) throw new Refusal('the page loaded but did not call `ready` within ' + WAIT + ' ms');
      return 'reloaded ' + url;
    },
  };

  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'prefers-color-scheme', value: opts.theme }] });
  // a headless page does not hold the keyboard, and a page without it gets no focus or blur events
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Accessibility.enable');
  record('launch ' + url + ' build ' + opts.build.sha + ' folder ' + p.tasks + (opts.chosen ? '' : ' (not chosen)'));
  if (!(await load(['Page.navigate', { url }]))) giveUp('the page loaded but did not call `ready` within ' + WAIT + ' ms. Console: ' + (state.consoleErrors.join(' | ') || 'no errors'));
  fs.writeFileSync(p.runFile, JSON.stringify({ run: opts.run, url, port, debugPort, token, daemonPid: process.pid, chromePid: chrome.pid, build: opts.build }, null, 2));
}

// ---------------------------------------------------------------- entry

if (process.argv[2] === '__daemon') {
  await daemon(process.argv[3]);
} else {
  const { command, run, flags, args } = parse(process.argv.slice(2));
  if (command === 'launch') await launch(run, flags);
  else if (command === 'cleanup') await cleanup(run);
  else if (command === 'doctor') await doctor(run);
  else {
    if (flags.from) flags.from = fs.readFileSync(resolve(flags.from)).toString('base64');   // read here: the path is relative to this process, and may be a pipe
    const { out, code } = await ask(run, command, flags, args);
    process.stdout.on('error', e => { if (e.code !== 'EPIPE') throw e; });   // `file | head` closes the pipe early
    if (out === '\0raw') process.stdout.write(fs.readFileSync(paths(run).inbox));
    else (code ? console.error : console.log)(out);
    process.exitCode = code;
  }
}
