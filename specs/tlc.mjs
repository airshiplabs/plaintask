// tlc.mjs - runs the TLC model checker on a spec in this folder and reads back the state graph it explored.
// The jar is TLA+ Tools 1.7.4, fetched once into the cache folder below and checked against its SHA-256.
// Java 11 or later must be on PATH.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPECS = fileURLToPath(new URL('.', import.meta.url));
const VERSION = '1.7.4';
const JAR_URL = `https://github.com/tlaplus/tlaplus/releases/download/v${VERSION}/tla2tools.jar`;
const JAR_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const CACHE = process.env.TLA_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'plaintask-tla');

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The path of tla2tools.jar, downloaded on first use. Throws when the download's checksum is not the pinned one. */
export function jar() {
  const path = join(CACHE, `tla2tools-${VERSION}.jar`);
  if (existsSync(path) && sha256(path) === JAR_SHA256) return path;
  mkdirSync(CACHE, { recursive: true });
  const part = path + '.part';
  execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--output', part, JAR_URL], { stdio: ['ignore', 'ignore', 'inherit'] });
  const got = sha256(part);
  if (got !== JAR_SHA256) { rmSync(part, { force: true }); throw new Error(`${JAR_URL} has SHA-256 ${got}, not the pinned ${JAR_SHA256}`); }
  renameSync(part, path);
  return path;
}

/** Runs TLC on specs/<spec>.tla with specs/<config>.cfg: every invariant, property and deadlock check the config asks
    for. Returns whether every check passed, TLC's output, and the state graph it explored (null when a check failed). */
export function run(spec, config = spec) {
  const out = mkdtempSync(join(tmpdir(), `tlc-${config}-`));
  try {
    const dot = join(out, 'graph.dot');
    const result = spawnSync('java', [
      '-XX:+UseParallelGC', '-cp', jar(), 'tlc2.TLC',
      '-workers', '1', '-cleanup', '-metadir', join(out, 'states'),
      '-config', join(SPECS, config + '.cfg'), '-dump', 'dot,actionlabels', dot, join(SPECS, spec + '.tla'),
    ], { cwd: SPECS, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new Error(`cannot run java (TLC needs Java 11 or later on PATH): ${result.error.message}`);
    const output = result.stdout + result.stderr;
    const ok = result.status === 0 && /Model checking completed\. No error has been found\./.test(output);
    return { ok, output, graph: ok ? readGraph(readFileSync(dot, 'utf8')) : null };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** run(), throwing with TLC's output when a check fails. */
export function check(spec, config = spec) {
  const result = run(spec, config);
  if (!result.ok) throw new Error(`TLC: specs/${config}.cfg fails on specs/${spec}.tla:\n${result.output}`);
  return result;
}

// ---- the state graph ----

/** TLC's DOT dump as { states: Map<id, state>, initial: id[], edges: [{ from, to, action }] }. A state is its variables
    as plain values. TLC fills the node of an initial state. */
export function readGraph(dot) {
  const states = new Map(), initial = [], edges = [];
  for (const line of dot.split('\n')) {
    const edge = /^(-?\d+) -> (-?\d+) \[label="([^"]*)"/.exec(line);
    if (edge) { edges.push({ from: edge[1], to: edge[2], action: edge[3] }); continue; }
    const node = /^(-?\d+) \[label="((?:[^"\\]|\\.)*)"/.exec(line);
    if (!node) continue;
    states.set(node[1], readState(unescape(node[2])));
    if (/style = filled\]$/.test(line)) initial.push(node[1]);
  }
  return { states, initial, edges };
}

const unescape = s => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));

/** "/\ a = 1\n/\ b = "x"" (or "a = 1" for a spec with one variable) as { a: 1, b: 'x' }. TLC breaks a long value
    over several lines; only a line starting "/\ " starts a variable. */
function readState(label) {
  const state = {};
  for (const line of label.split(/\n(?=\/\\ )/)) {
    const m = /^(?:\/\\ )?(\w+) = ([\s\S]*)$/.exec(line);
    if (!m) throw new Error('not a TLC state line: ' + line);
    state[m[1]] = readValue(m[2]);
  }
  return state;
}

/** A TLA+ value as TLC prints it: integers, strings, booleans, <<sequences>> as arrays, {sets} as sorted arrays, and
    [records] as objects. Throws on anything else, so a spec cannot slip a value past a test that cannot read it. */
export function readValue(text) {
  let i = 0;
  const fail = () => { throw new Error(`cannot read the TLA+ value at ${i} of ${text}`); };
  const space = () => { while (text[i] === ' ' || text[i] === '\n') i++; };
  const eat = s => { space(); if (!text.startsWith(s, i)) fail(); i += s.length; };
  const list = close => {
    const items = [];
    space();
    if (text.startsWith(close, i)) { i += close.length; return items; }
    for (;;) { items.push(value()); space(); if (text.startsWith(close, i)) { i += close.length; return items; } eat(','); }
  };
  function value() {
    space();
    if (text.startsWith('<<', i)) { i += 2; return list('>>'); }
    if (text[i] === '{') { i++; return list('}').sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)); }
    if (text[i] === '[') {
      i++;
      const record = {};
      for (;;) {
        space();
        const key = /^\w+/.exec(text.slice(i))?.[0] ?? fail();
        i += key.length;
        eat('|->');
        record[key] = value();
        space();
        if (text[i] === ']') { i++; return record; }
        eat(',');
      }
    }
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      if (end === -1) fail();
      const s = text.slice(i + 1, end);
      i = end + 1;
      return s;
    }
    if (text.startsWith('TRUE', i)) { i += 4; return true; }
    if (text.startsWith('FALSE', i)) { i += 5; return false; }
    const n = /^-?\d+/.exec(text.slice(i))?.[0] ?? fail();
    i += n.length;
    return Number(n);
  }
  const v = value();
  space();
  if (i !== text.length) fail();
  return v;
}

/** A value as one string with its object keys sorted, so two equal states are one key. */
export const canon = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** The picked variables of a state, as an object. */
export const pick = (state, names) => Object.fromEntries(names.map(n => {
  if (!(n in state)) throw new Error(`the spec has no variable ${n}`);
  return [n, state[n]];
}));
