#!/usr/bin/env node
// check.mjs - model-checks every TLA+ spec in this folder with TLC. CI's `test` job runs it before the tests.
//   node specs/check.mjs
// Exit 0: every config passes, and each known race still fails as recorded. 1: a check went the other way; TLC's
// output says which property and the behaviour that breaks it.
import { run } from './tlc.mjs';

/** Each config, the module it checks, and whether TLC must find no error; `fails` names the property a known race breaks. */
const CHECKS = [
  { spec: 'DesktopSession', config: 'DesktopSession', holds: true },
  { spec: 'DesktopSessionSettles', config: 'DesktopSessionSettles', holds: true },
  { spec: 'ReleasePhases', config: 'ReleasePhases', holds: true },
];

let failed = false;
for (const { spec, config, holds, fails } of CHECKS) {
  const started = Date.now();
  const { ok, output } = run(spec, config);
  const states = [...output.matchAll(/([\d,]+) distinct states found/g)].at(-1)?.[1] ?? '?';
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (ok === holds && (holds || new RegExp(`property ${fails} is violated`).test(output))) {
    console.log(`ok   ${config}.cfg on ${spec}.tla: ${holds ? 'no error' : 'fails as recorded'}, ${states} states, ${seconds} s`);
  } else {
    failed = true;
    console.log(`FAIL ${config}.cfg on ${spec}.tla: ${holds ? 'TLC found an error' : ok ? `${fails} now holds, so the recorded race is gone: move it to the main config` : `TLC failed, but not on ${fails}`}`);
    console.log(output);
  }
}
process.exitCode = failed ? 1 : 0;
