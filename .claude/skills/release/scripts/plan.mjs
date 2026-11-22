// plan.mjs - the release's pure decisions: the next version, commit classification, manifest edits, and the
// phase a release is in. No I/O and no globals; release.mjs is the command-line front end.
import { SCOPES, TYPES, validateMessage } from '../../conventional-commits/conventional-commits.mjs';

/** The four files that record the app version, by kind. Paths are relative to the repo root. */
export const MANIFESTS = Object.freeze([
  { kind: 'package.json', path: 'apps/desktop/package.json' },
  { kind: 'tauri.conf.json', path: 'apps/desktop/src-tauri/tauri.conf.json' },
  { kind: 'Cargo.toml', path: 'apps/desktop/src-tauri/Cargo.toml' },
  { kind: 'Cargo.lock', path: 'apps/desktop/src-tauri/Cargo.lock' },
]);

/** The crate whose entry in Cargo.lock carries the app version. */
export const CRATE_NAME = 'plaintask';

/** Release phases in order. `status` reports one; NEXT_TASK names the brief that moves it forward. */
export const PHASES = Object.freeze(['plan', 'pr-open', 'pr-merged', 'built', 'verified', 'staged', 'published']);
export const NEXT_TASK = Object.freeze({
  plan: 'draft-changelog',
  'pr-open': 'land-release-pr',
  'pr-merged': 'build-artifact',
  built: 'verify-artifact',
  verified: 'stage-release',
  staged: 'publish-release',
  published: 'done',
});

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const HEADER = new RegExp(`^(${TYPES.join('|')})(?:\\((${SCOPES.join('|')})\\))?(!)?: (.+)$`);
const PR_SUFFIX = / \(#(\d+)\)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
const SECTION_BY_TYPE = Object.freeze({ feat: 'Added', fix: 'Fixed', perf: 'Changed', revert: 'Changed' });
const BREAKING_PREFIX = '**Breaking:** ';
const MINOR_TYPES = Object.freeze(['Added', 'Deprecated']);

/** "1.2.3" to { major, minor, patch }, or null. No "v" prefix, pre-release, or build metadata. */
export function parseVersion(text) {
  const match = VERSION.exec(text);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Negative, zero, or positive as version text `a` is below, equal to, or above `b`. Throws on a bad version. */
export function compareVersions(a, b) {
  const left = mustParse(a);
  const right = mustParse(b);
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function mustParse(text) {
  const version = parseVersion(text);
  if (!version) throw new RangeError(`not a version (expected X.Y.Z): ${JSON.stringify(text)}`);
  return version;
}

/** The changelog type a commit type suggests, or null when the commit type is not user-facing. */
export function sectionFor(type) {
  return SECTION_BY_TYPE[type] ?? null;
}

/**
 * Classify one commit by its full message. A message that fails the repo's Conventional Commits check has
 * `conforming: false` and null type, scope, and section; the changelog drafter reads it raw.
 * @param {{ sha: string, message: string }} commit
 */
export function classifyCommit({ sha, message }) {
  const subject = message.split('\n', 1)[0];
  const pr = PR_SUFFIX.exec(subject);
  const base = { sha, subject, pr: pr ? Number(pr[1]) : null };
  const header = validateMessage(message).length === 0 ? HEADER.exec(subject) : null;
  if (!header) return { ...base, conforming: false, type: null, scope: null, breaking: false, description: subject, section: null };
  const [, type, scope, bang, description] = header;
  return {
    ...base,
    conforming: true,
    type,
    scope: scope ?? null,
    breaking: Boolean(bang) || BREAKING_FOOTER.test(message),
    description: description.replace(PR_SUFFIX, ''),
    section: sectionFor(type),
  };
}

/** The version before the first release: the bump rules start from it. */
export const INITIAL_VERSION = '0.0.0';

/**
 * The version to release and why, from the changelog entries the release holds. This is the keep-a-changelog
 * skill's rule (its SKILL.md, "Release"):
 * - any entry that starts with "**Breaking:** " bumps major, or minor while the last version is below 1.0.0;
 * - any Added or Deprecated entry bumps minor;
 * - anything else bumps patch.
 * With no `lastVersion` (no release tag yet) the bump starts from 0.0.0.
 * `explicit` wins when given: it must be X.Y.Z and above `lastVersion`.
 * Throws RangeError on a bad `explicit`, and when there are no entries to release.
 * @param {{ lastVersion: string | null, entries: { type: string, text: string }[], explicit?: string }} input
 * @returns {{ next: string, bump: 'explicit' | 'major' | 'minor' | 'patch', reason: string }}
 */
export function nextVersion({ lastVersion, entries, explicit }) {
  if (entries.length === 0) throw new RangeError('no changelog entries to release');
  const since = lastVersion === null ? 'no release yet' : `since ${lastVersion}`;
  const computed = bumpFor(mustParse(lastVersion ?? INITIAL_VERSION), entries, since);
  if (explicit === undefined || explicit === computed.next) return computed;
  mustParse(explicit);
  if (lastVersion !== null && compareVersions(explicit, lastVersion) <= 0) {
    throw new RangeError(`version ${explicit} is not above the last release ${lastVersion}`);
  }
  return { next: explicit, bump: 'explicit', reason: `version given on the command line; the entries call for ${computed.next}` };
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function bumpFor(last, entries, since) {
  const breaking = entries.filter((entry) => entry.text.startsWith(BREAKING_PREFIX)).length;
  const minor = entries.filter((entry) => MINOR_TYPES.includes(entry.type)).length;
  if (breaking > 0 && last.major >= 1) {
    return { next: `${last.major + 1}.0.0`, bump: 'major', reason: `${count(breaking, 'breaking entry', 'breaking entries')}, ${since}` };
  }
  if (breaking > 0 || minor > 0) {
    const reason = breaking > 0
      ? `${count(breaking, 'breaking entry', 'breaking entries')} below 1.0.0, ${since}`
      : `${count(minor, 'Added or Deprecated entry', 'Added or Deprecated entries')}, ${since}`;
    return { next: `${last.major}.${last.minor + 1}.0`, bump: 'minor', reason };
  }
  return { next: `${last.major}.${last.minor}.${last.patch + 1}`, bump: 'patch', reason: `no Added, Deprecated, or breaking entry, ${since}` };
}

/** The highest X.Y.Z among tag names of the form <prefix>X.Y.Z, or null. Other tag names are ignored. */
export function latestVersionTag(tagNames, prefix) {
  const versions = tagNames.filter((name) => name.startsWith(prefix) && parseVersion(name.slice(prefix.length))).map((name) => name.slice(prefix.length));
  return versions.sort(compareVersions).at(-1) ?? null;
}

/** The app version a manifest's text records. Throws when the text has no version where `kind` keeps it. */
export function readManifestVersion(kind, text) {
  return locateVersion(kind, text).version;
}

/**
 * The manifest text with its app version replaced by `version`. Only the version's characters change.
 * Throws on a bad version or when the text has no version where `kind` keeps it.
 */
export function setManifestVersion(kind, text, version) {
  mustParse(version);
  const { start, end } = locateVersion(kind, text);
  return text.slice(0, start) + version + text.slice(end);
}

// Returns { version, start, end }: the version text and its character span inside `text`.
function locateVersion(kind, text) {
  const located = LOCATORS[kind]?.(text);
  if (located === undefined) throw new RangeError(`unknown manifest kind ${JSON.stringify(kind)}`);
  if (located === null) throw new RangeError(`no app version found in ${kind}`);
  return located;
}

const LOCATORS = Object.freeze({
  'package.json': locateJsonVersion,
  'tauri.conf.json': locateJsonVersion,
  'Cargo.toml': (text) => locateTomlVersion(text, (lines, index) => sectionOf(lines, index) === '[package]'),
  'Cargo.lock': (text) => locateTomlVersion(text, (lines, index) => lines[index - 1] === `name = "${CRATE_NAME}"`),
});

// The top-level "version" member. JSON.parse proves the located text is that member and not a nested one.
function locateJsonVersion(text) {
  const version = JSON.parse(text).version;
  if (typeof version !== 'string') return null;
  const pattern = /^ {2}"version"\s*:\s*"([^"]*)"/m;
  const match = pattern.exec(text);
  if (!match || match[1] !== version) return null;
  const start = match.index + match[0].length - 1 - version.length;
  return { version, start, end: start + version.length };
}

// The first `version = "…"` line that `accept(lines, index)` allows.
function locateTomlVersion(text, accept) {
  const lines = text.split('\n');
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const match = /^version = "([^"]*)"\r?$/.exec(lines[index]);
    if (match && accept(lines, index)) {
      const start = offset + 'version = "'.length;
      return { version: match[1], start, end: start + match[1].length };
    }
    offset += lines[index].length + 1;
  }
  return null;
}

// The nearest `[section]` header at or above a line.
function sectionOf(lines, index) {
  for (let i = index; i >= 0; i--) {
    if (lines[i].startsWith('[')) return lines[i].trim();
  }
  return null;
}

/**
 * The phase a release of one version is in, from facts `release.mjs status` gathers. The most advanced
 * state that the facts prove wins, so a rerun continues from there.
 * @param {{
 *   release: { isDraft: boolean } | null,
 *   build: { sha256?: string } | null,
 *   verify: { ok: boolean, sha256: string } | null,
 *   mainHasRelease: boolean,
 *   pr: { state: string } | null,
 * }} facts
 */
export function derivePhase({ release, build, verify, mainHasRelease, pr }) {
  if (release) return release.isDraft ? 'staged' : 'published';
  const built = Boolean(build?.sha256);
  if (built && verify?.ok && verify.sha256 === build.sha256) return 'verified';
  if (built) return 'built';
  if (mainHasRelease) return 'pr-merged';
  if (pr?.state === 'OPEN') return 'pr-open';
  return 'plan';
}
