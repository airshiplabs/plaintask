// changelog.mjs - parse, validate, render, and edit one CHANGELOG.md in the format FORMAT.md defines.
// Pure: no I/O and no globals. validate.mjs, add.mjs, and release.mjs are the command-line front ends.

/** Every changelog in the repo, relative to the repo root. Add a path here and to FORMAT.md, in its own commit. */
export const CHANGELOGS = Object.freeze([
  'apps/desktop/CHANGELOG.md',
  'apps/mobile/CHANGELOG.md',
]);

/** The six Keep a Changelog types, in the order a release lists them. */
export const TYPES = Object.freeze(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);

/** The longest entry text, in Unicode code points, not counting the " ([ref])" suffix. */
export const MAX_ENTRY_CHARS = 100;

export const REPO_URL = 'https://github.com/airshiplabs/plaintask';

/** The file, next to a changelog, that names releases tagged other than `<tagPrefix><version>`: { "<version>": "<tag>" }. */
export const MOVED_TAGS_FILE = 'moved-tags.json';

/** The git tag of a component's version: its name in `moved`, else `<tagPrefix><version>`. */
export function tagName(tagPrefix, version, moved = {}) {
  return moved[version] ?? `${tagPrefix}${version}`;
}

const HEADER = Object.freeze([
  '# Changelog',
  '',
  'All notable changes to this project are documented in this file.',
  '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),',
  'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
]);

const UNRELEASED = 'Unreleased';
const UNRELEASED_HEADING = `## [${UNRELEASED}]`;
const BREAKING_PREFIX = '**Breaking:** ';
const BREAKING_TYPES = Object.freeze(['Changed', 'Removed']);
const CVE_TYPE = 'Security';

// semver.org's official SemVer 2.0.0 pattern.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_HEADING = /^## \[([^\]]+)\] - (\S+)( \[YANKED\])?$/;
const REF = /^(?:#[1-9]\d*|[0-9a-f]{7,40})$/;
const ENTRY = /^- (\S(?:.*\S)?) \(\[([^\]]+)\]\)$/;
const LIST_ITEM = /^\s*[-*+]\s/;
const LINK = /^\[([^\]]+)\]: (\S+)$/;
const CVE = /^CVE-\d{4}-\d{4,}: \S/;

export const RULES = Object.freeze({
  title: 'title',
  preamble: 'preamble',
  unreleased: 'unreleased',
  versionHeading: 'version-heading',
  versionUnique: 'version-unique',
  versionOrder: 'version-order',
  versionEmpty: 'version-empty',
  headingLevel: 'heading-level',
  sectionName: 'section-name',
  sectionUnique: 'section-unique',
  sectionOrder: 'section-order',
  sectionEmpty: 'section-empty',
  summary: 'summary',
  entry: 'entry',
  entryLength: 'entry-length',
  breaking: 'breaking',
  cve: 'cve',
  links: 'links',
  whitespace: 'whitespace',
});

const MESSAGES = Object.freeze({
  [RULES.title]: 'start the file with "# Changelog"',
  [RULES.preamble]: 'copy the preamble from the FORMAT.md template',
  [RULES.unreleased]: `keep one "${UNRELEASED_HEADING}" heading, as the first release`,
  [RULES.versionHeading]: 'write "## [<semver>] - <YYYY-MM-DD>", optionally followed by " [YANKED]"',
  [RULES.versionUnique]: 'remove the duplicate release',
  [RULES.versionOrder]: 'order releases newest first: each version and date at or below the one above',
  [RULES.versionEmpty]: 'add at least one entry to the release',
  [RULES.headingLevel]: 'use a "##" release heading or a "###" type heading',
  [RULES.sectionName]: `use one of these types: ${TYPES.join(', ')}`,
  [RULES.sectionUnique]: 'merge the two sections of the same type',
  [RULES.sectionOrder]: `order sections ${TYPES.join(', ')}`,
  [RULES.sectionEmpty]: 'add an entry or remove the heading',
  [RULES.summary]: 'put a release summary between its "##" heading and its first "###" heading',
  [RULES.entry]: 'write "- <text> ([<ref>])" on one line under a "###" type, ref "#<pr>" or a 7-40 char lowercase sha',
  [RULES.entryLength]: `state the change in at most ${MAX_ENTRY_CHARS} characters`,
  [RULES.breaking]: `start the entry with "${BREAKING_PREFIX}" under ${BREAKING_TYPES.join(' or ')}`,
  [RULES.cve]: `lead with "CVE-YYYY-NNNN: " under ${CVE_TYPE}`,
  [RULES.links]: 'match the computed link block',
  [RULES.whitespace]: 'match the template spacing: one empty line between blocks, no trailing spaces, one final newline',
});

/** The component a listed changelog path belongs to: { dir, tagPrefix }. Throws on an unlisted path. */
export function componentFor(path) {
  if (!CHANGELOGS.includes(path)) {
    throw new RangeError(`${JSON.stringify(path)} is not in CHANGELOGS: ${CHANGELOGS.join(', ')}`);
  }
  const dir = path.slice(0, path.lastIndexOf('/'));
  return { dir, tagPrefix: `${dir.slice(dir.lastIndexOf('/') + 1)}-v` };
}

const violation = (rule, line, text, message = MESSAGES[rule]) => ({ rule, line, text, message });

function isCalendarDate(text) {
  if (!DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** SemVer 2.0.0 precedence: negative when a < b, 0 when equal (build metadata ignored), positive when a > b. */
export function compareSemver(a, b) {
  const [, aMaj, aMin, aPat, aPre] = SEMVER.exec(a);
  const [, bMaj, bMin, bPat, bPre] = SEMVER.exec(b);
  for (const [x, y] of [[aMaj, bMaj], [aMin, bMin], [aPat, bPat]]) {
    if (Number(x) !== Number(y)) return Number(x) - Number(y);
  }
  if (aPre === undefined || bPre === undefined) return (aPre === undefined) - (bPre === undefined);
  const aIds = aPre.split('.');
  const bIds = bPre.split('.');
  for (let i = 0; i < Math.min(aIds.length, bIds.length); i++) {
    const [x, y] = [aIds[i], bIds[i]];
    if (x === y) continue;
    const [xNum, yNum] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xNum && yNum) return Number(x) - Number(y);
    if (xNum !== yNum) return xNum ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return aIds.length - bIds.length;
}

/**
 * Parse a changelog into a document, with the structural violations found on the way.
 * The document: { releases: [{ version: string | null, date, yanked, line, summary: string[],
 * sections: [{ type, line, entries: [{ text, ref, line }] }] }], links: [{ label, url, line }] }.
 * version is null for Unreleased. Lines are 1-based. Unparseable lines are left out of the document.
 * @param {string} text
 */
export function parse(text) {
  const violations = [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const doc = { releases: [], links: [] };
  // A carriage return is a file-wide line-ending problem; one report beats one per rule it breaks.
  const crLine = lines.findIndex((line) => line.includes('\r'));
  if (crLine !== -1) return { doc, violations: [violation(RULES.whitespace, crLine + 1, lines[crLine])] };

  const firstBody = lines.findIndex((line) => line.startsWith('## ') || LINK.test(line));
  const headerEnd = firstBody === -1 ? lines.length : firstBody;
  const expectedHeader = firstBody === -1 ? HEADER : [...HEADER, ''];
  for (let i = 0; i < Math.max(headerEnd, expectedHeader.length); i++) {
    if (lines[i] === expectedHeader[i] && i < headerEnd) continue;
    violations.push(violation(i === 0 ? RULES.title : RULES.preamble, i + 1, lines[i] ?? ''));
    break;
  }

  let release = null;
  let section = null;
  let inLinks = false;
  // Sections with a list line, valid or not, so a malformed entry does not also report an empty section.
  const listed = new WeakSet();
  for (let i = headerEnd; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const fail = (rule, message) => violations.push(violation(rule, lineNo, line, message));

    if (line === '') continue;
    if (line.includes('\t') || line.trim() === '' || line !== line.trimEnd()) {
      fail(RULES.whitespace);
      if (section) listed.add(section);
      continue;
    }

    const link = LINK.exec(line);
    if (link) {
      inLinks = true;
      doc.links.push({ label: link[1], url: link[2], line: lineNo });
      continue;
    }
    if (inLinks) {
      fail(RULES.links, 'keep the link block last: no other lines after the first link');
      continue;
    }

    if (line.startsWith('## ')) {
      section = null;
      release = parseReleaseHeading(line, lineNo, doc.releases.length === 0, fail);
      if (release) doc.releases.push(release);
      // A heading that failed still opens a release, kept out of the document, so its lines do not join the one above.
      else release = { version: undefined, line: lineNo, summary: [], sections: [] };
      continue;
    }
    if (line.startsWith('### ')) {
      section = null;
      if (!release) {
        fail(RULES.summary);
        continue;
      }
      const type = line.slice(4);
      const index = TYPES.indexOf(type);
      if (index === -1) {
        fail(RULES.sectionName);
        continue;
      }
      const previous = release.sections.at(-1);
      const previousIndex = previous ? TYPES.indexOf(previous.type) : -1;
      if (release.sections.some((s) => s.type === type)) fail(RULES.sectionUnique);
      else if (index < previousIndex) fail(RULES.sectionOrder);
      section = { type, line: lineNo, entries: [] };
      release.sections.push(section);
      continue;
    }
    if (/^#+ /.test(line) || /^#+$/.test(line)) {
      fail(RULES.headingLevel);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      if (section) listed.add(section);
      const entry = parseEntry(line, lineNo, section, fail);
      if (entry) section.entries.push(entry);
      continue;
    }
    if (!release || release.sections.length > 0) {
      fail(RULES.summary);
      continue;
    }
    release.summary.push(line);
  }

  if (doc.releases.length === 0 && !violations.some((v) => v.rule === RULES.unreleased)) {
    violations.push(violation(RULES.unreleased, headerEnd + 1, lines[headerEnd] ?? ''));
  }
  checkReleases(doc.releases, listed, violations);
  return { doc, violations };
}

function parseReleaseHeading(line, lineNo, isFirst, fail) {
  const base = { yanked: false, line: lineNo, summary: [], sections: [] };
  if (line === UNRELEASED_HEADING) {
    if (!isFirst) fail(RULES.unreleased);
    return isFirst ? { ...base, version: null, date: null } : null;
  }
  if (isFirst) fail(RULES.unreleased);
  const match = VERSION_HEADING.exec(line);
  if (!match || !SEMVER.test(match[1]) || !isCalendarDate(match[2])) {
    fail(RULES.versionHeading);
    return null;
  }
  return { ...base, version: match[1], date: match[2], yanked: Boolean(match[3]) };
}

function parseEntry(line, lineNo, section, fail) {
  const match = ENTRY.exec(line);
  if (!section || !match || !REF.test(match[2])) {
    fail(RULES.entry);
    return null;
  }
  const [, text, ref] = match;
  const length = [...text].length;
  if (length > MAX_ENTRY_CHARS) {
    fail(RULES.entryLength, `${MESSAGES[RULES.entryLength]}; this entry has ${length}`);
  }
  const breaking = /\*\*breaking/i.test(text);
  if (breaking && (!text.startsWith(BREAKING_PREFIX) || !BREAKING_TYPES.includes(section.type))) {
    fail(RULES.breaking);
  }
  if (text.startsWith('CVE-') && (!CVE.test(text) || section.type !== CVE_TYPE)) fail(RULES.cve);
  return { text, ref, line: lineNo };
}

function checkReleases(releases, listed, violations) {
  const fail = (rule, release) =>
    violations.push(violation(rule, release.line, headingText(release)));
  for (const release of releases) {
    for (const section of release.sections) {
      if (!listed.has(section)) {
        violations.push(violation(RULES.sectionEmpty, section.line, `### ${section.type}`));
      }
    }
    if (release.version !== null && !release.sections.some((s) => listed.has(s))) {
      fail(RULES.versionEmpty, release);
    }
  }
  const versions = releases.filter((r) => r.version !== null);
  for (let i = 1; i < versions.length; i++) {
    const [above, below] = [versions[i - 1], versions[i]];
    if (versions.slice(0, i).some((r) => r.version === below.version)) fail(RULES.versionUnique, below);
    else if (compareSemver(above.version, below.version) <= 0 || below.date > above.date) {
      fail(RULES.versionOrder, below);
    }
  }
}

function headingText(release) {
  if (release.version === null) return UNRELEASED_HEADING;
  return `## [${release.version}] - ${release.date}${release.yanked ? ' [YANKED]' : ''}`;
}

/** The link lines a document implies, in FORMAT.md order. */
export function expectedLinks(doc, path, moved = {}) {
  const { dir, tagPrefix } = componentFor(path);
  const tag = (version) => tagName(tagPrefix, version, moved);
  const versions = doc.releases.filter((r) => r.version !== null).map((r) => r.version);
  const lines = [
    versions.length === 0
      ? `[${UNRELEASED}]: ${REPO_URL}/commits/HEAD/${dir}`
      : `[${UNRELEASED}]: ${REPO_URL}/compare/${tag(versions[0])}...HEAD`,
  ];
  versions.forEach((version, i) => {
    const below = versions[i + 1];
    lines.push(
      below === undefined
        ? `[${version}]: ${REPO_URL}/releases/tag/${tag(version)}`
        : `[${version}]: ${REPO_URL}/compare/${tag(below)}...${tag(version)}`,
    );
  });
  const refs = new Set(doc.releases.flatMap((r) => r.sections.flatMap((s) => s.entries.map((e) => e.ref))));
  const prs = [...refs].filter((ref) => ref.startsWith('#')).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const shas = [...refs].filter((ref) => !ref.startsWith('#')).sort();
  for (const pr of prs) lines.push(`[${pr}]: ${REPO_URL}/pull/${pr.slice(1)}`);
  for (const sha of shas) lines.push(`[${sha}]: ${REPO_URL}/commit/${sha}`);
  return lines;
}

/** The canonical text of a document. render(parse(x).doc, { path }) === x for every valid x. */
export function render(doc, { path, moved = {} }) {
  const blocks = [[HEADER[0]], [HEADER[2]], [HEADER[4], HEADER[5]]];
  for (const release of doc.releases) {
    blocks.push([headingText(release)]);
    if (release.summary.length > 0) blocks.push(release.summary);
    for (const section of release.sections) {
      blocks.push([`### ${section.type}`]);
      if (section.entries.length > 0) blocks.push(section.entries.map((e) => `- ${e.text} ([${e.ref}])`));
    }
  }
  blocks.push(expectedLinks(doc, path, moved));
  return `${blocks.map((block) => block.join('\n')).join('\n\n')}\n`;
}

/**
 * Validate one changelog against FORMAT.md. `path` is the file's path from the repo root, one of CHANGELOGS;
 * it sets the component directory and tag prefix of the expected links. Throws a RangeError on another path.
 * `moved` maps a version to its tag when that tag is not `<tagPrefix><version>` (MOVED_TAGS_FILE).
 * Returns [] on pass; otherwise violations in line order, each { rule, line, text, message }.
 * The links and whitespace rules run only when the file has no other violation.
 * @param {string} text
 * @param {{ path: string, moved?: Record<string, string> }} options
 */
export function validate(text, { path, moved = {} }) {
  componentFor(path);
  const { doc, violations } = parse(text);
  if (violations.length > 0) return violations.sort((a, b) => a.line - b.line);

  const lines = text.split('\n');
  const lineCount = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  const expected = expectedLinks(doc, path, moved);
  for (let i = 0; i < Math.max(expected.length, doc.links.length); i++) {
    const actual = doc.links[i];
    if (actual && `[${actual.label}]: ${actual.url}` === expected[i]) continue;
    const line = actual?.line ?? (doc.links.at(-1)?.line ?? lineCount) + 1;
    const message = expected[i] === undefined ? 'remove this link: nothing uses it' : `expected "${expected[i]}"`;
    return [violation(RULES.links, line, actual ? lines[line - 1] : '', message)];
  }

  const canonical = render(doc, { path, moved }).split('\n');
  for (let i = 0; i < Math.max(canonical.length, lines.length); i++) {
    if (canonical[i] !== lines[i]) {
      const line = Math.min(i + 1, lineCount);
      return [violation(RULES.whitespace, line, lines[line - 1] ?? '')];
    }
  }
  return [];
}

/**
 * Add an entry under [Unreleased], creating its type section in TYPES order. Returns a new document.
 * Throws when the document has no Unreleased release or the type is not one of TYPES.
 * The caller validates the rendered result; this function does not judge the text or ref.
 */
export function addEntry(doc, { type, ref, text }) {
  if (!TYPES.includes(type)) throw new RangeError(`unknown type ${JSON.stringify(type)}: use ${TYPES.join(', ')}`);
  const [unreleased, ...rest] = doc.releases;
  if (unreleased?.version !== null) throw new RangeError(`the changelog has no ${UNRELEASED_HEADING} release`);
  const entry = { text, ref, line: 0 };
  const sections = unreleased.sections.some((s) => s.type === type)
    ? unreleased.sections.map((s) => (s.type === type ? { ...s, entries: [...s.entries, entry] } : s))
    : [...unreleased.sections, { type, line: 0, entries: [entry] }].sort(
        (a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type),
      );
  return { ...doc, releases: [{ ...unreleased, sections }, ...rest] };
}

/**
 * Move the Unreleased entries and summary into a new release, above the previous newest version,
 * and leave an empty Unreleased. Returns a new document. Throws when Unreleased is missing or empty,
 * the version is not SemVer or not above the newest version, or the date is not a calendar date.
 */
export function release(doc, { version, date }) {
  if (!SEMVER.test(version)) throw new RangeError(`${JSON.stringify(version)} is not a SemVer 2.0.0 version`);
  if (!isCalendarDate(date)) throw new RangeError(`${JSON.stringify(date)} is not a YYYY-MM-DD calendar date`);
  const [unreleased, ...rest] = doc.releases;
  if (unreleased?.version !== null) throw new RangeError(`the changelog has no ${UNRELEASED_HEADING} release`);
  if (unreleased.sections.every((s) => s.entries.length === 0)) {
    throw new RangeError(`${UNRELEASED_HEADING} has no entries to release`);
  }
  const newest = rest.find((r) => r.version !== null);
  if (newest && compareSemver(version, newest.version) <= 0) {
    throw new RangeError(`${version} is not above the newest release, ${newest.version}`);
  }
  const released = { ...unreleased, version, date, yanked: false };
  const empty = { version: null, date: null, yanked: false, line: 0, summary: [], sections: [] };
  return { ...doc, releases: [empty, released, ...rest] };
}
