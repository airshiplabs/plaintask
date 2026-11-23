// build-number.mjs - the macOS build number (CFBundleVersion): the commit that `cwd` has checked out,
// as "8b64004", with "-dirty" when tracked files have uncommitted changes. build-app.mjs writes it
// into the app; the release skill records it and checks the built app against it.
import { execFileSync } from 'node:child_process';

export function buildNumber(cwd = process.cwd(), env = process.env) {
  return execFileSync('git', ['describe', '--always', '--dirty', '--abbrev=7', '--exclude=*'], { cwd, env, encoding: 'utf8' }).trim();
}
