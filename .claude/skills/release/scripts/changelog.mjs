// changelog.mjs - what a release does to the desktop changelog, on top of the keep-a-changelog skill's module:
// check the entries a drafter adds, add them and cut the release, and read a release back for the release notes.
// Also renders a {{placeholder}} template. The format and its rules live in .claude/skills/keep-a-changelog/.
// No I/O and no globals.
import { addEntry, parse, release, render as renderChangelog, TYPES, validate } from '../../keep-a-changelog/changelog.mjs';

/** The changelog a desktop release cuts, relative to the repo root. One of the keep-a-changelog CHANGELOGS. */
export const CHANGELOG = 'apps/desktop/CHANGELOG.md';

const ENTRY_KEYS = Object.freeze(['type', 'ref', 'text']);
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;

/**
 * Check the shape of an entries file: a list of { type, ref, text }, possibly empty. The text and ref rules
 * are the changelog format's, and cutRelease applies them. Returns [] on pass, otherwise one sentence per problem.
 * @param {unknown} entries
 * @returns {string[]}
 */
export function validateAdditions(entries) {
  if (!Array.isArray(entries)) return ['the entries file must hold a list of { "type", "ref", "text" } objects; an empty list adds nothing'];
  const problems = [];
  entries.forEach((entry, index) => {
    const where = `entry ${index + 1}`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${where} must be an object with ${ENTRY_KEYS.join(', ')}`);
      return;
    }
    for (const key of ENTRY_KEYS) if (typeof entry[key] !== 'string' || entry[key] === '') problems.push(`${where} needs a non-empty string "${key}"`);
    const extra = Object.keys(entry).filter((key) => !ENTRY_KEYS.includes(key));
    if (extra.length > 0) problems.push(`${where} has unknown keys: ${extra.join(', ')}`);
    if (typeof entry.type === 'string' && !TYPES.includes(entry.type)) problems.push(`${where} has type ${JSON.stringify(entry.type)}; use one of: ${TYPES.join(', ')}`);
  });
  return problems;
}

/** The entries of a release, flat and in file order: [{ type, text, ref }]. `version` null reads [Unreleased]. */
export function entriesOf(text, version = null) {
  const found = parse(text).doc.releases.find((item) => item.version === version);
  return found ? found.sections.flatMap((section) => section.entries.map(({ text: entry, ref }) => ({ type: section.type, text: entry, ref }))) : [];
}

const sameEntry = (a) => (b) => a.type === b.type && a.text === b.text && a.ref === b.ref;

/**
 * The changelog text with `additions` added under [Unreleased] and [Unreleased] then cut as `version`.
 * A text that already holds `version` with every addition, and an empty [Unreleased], comes back unchanged,
 * so a second cut with the same input changes nothing.
 * Throws RangeError, naming each rule, when the text fails the format before or after, when an addition is
 * already under [Unreleased], when there is nothing to release, or when `version` is not above the newest release.
 * @param {string} text
 * `moved` maps a version to its tag when that tag is not desktop-v<version> (keep-a-changelog's MOVED_TAGS_FILE).
 * @param {{ version: string, date: string, additions: { type: string, ref: string, text: string }[], moved?: Record<string, string> }} cut
 */
export function cutRelease(text, { version, date, additions, moved = {} }) {
  requireValid(text, 'before the release', moved);
  const { doc } = parse(text);
  if (doc.releases.some((item) => item.version === version)) {
    const released = entriesOf(text, version);
    if (entriesOf(text).length === 0 && additions.every((entry) => released.some(sameEntry(entry)))) return text;
    throw new RangeError(`${CHANGELOG} already has a [${version}] release that differs; restore the file with "git checkout -- ${CHANGELOG}" and cut again`);
  }
  const unreleased = entriesOf(text);
  const repeated = additions.find((entry) => unreleased.some(sameEntry(entry)));
  if (repeated) throw new RangeError(`[Unreleased] already has the entry ${JSON.stringify(repeated.text)}; remove it from the entries file`);

  const cut = renderChangelog(release(additions.reduce(addEntry, doc), { version, date }), { path: CHANGELOG, moved });
  requireValid(cut, 'after the release', moved);
  return cut;
}

function requireValid(text, when, moved) {
  const violations = validate(text, { path: CHANGELOG, moved });
  if (violations.length === 0) return;
  const lines = violations.map(({ rule, line, text: found, message }) => `  line ${line}: ${found}\n  ${rule}: ${message}`);
  throw new RangeError(`${CHANGELOG} does not match the changelog format ${when}:\n${lines.join('\n')}`);
}

/**
 * A release as Markdown for a GitHub release or pull request body: its summary, then each section with its
 * entries. A reference is written bare, `(#30)` or `(887e173)`, which GitHub links by itself; the changelog's
 * `([#30])` form needs the file's link block. null when the changelog has no such release.
 */
export function releaseBody(text, version) {
  const found = parse(text).doc.releases.find((item) => item.version === version);
  if (!found) return null;
  const blocks = found.summary.length > 0 ? [found.summary.join('\n')] : [];
  for (const section of found.sections) blocks.push(`### ${section.type}`, section.entries.map((entry) => `- ${entry.text} (${entry.ref})`).join('\n'));
  return blocks.join('\n\n');
}

/**
 * Fill a template's {{name}} placeholders from `values`. Throws RangeError when a placeholder has no value
 * and when a value has no placeholder, so a template and its caller cannot drift apart.
 * @param {string} template
 * @param {Record<string, string>} values
 */
export function render(template, values) {
  const used = new Set();
  const text = template.replace(PLACEHOLDER, (whole, name) => {
    if (!Object.hasOwn(values, name)) throw new RangeError(`the template has {{${name}}} but no value was given for it`);
    used.add(name);
    return String(values[name]);
  });
  const unused = Object.keys(values).filter((name) => !used.has(name));
  if (unused.length > 0) throw new RangeError(`no {{placeholder}} in the template for: ${unused.join(', ')}`);
  return text;
}
