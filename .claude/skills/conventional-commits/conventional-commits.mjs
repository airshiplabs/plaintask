// conventional-commits.mjs - validateMessage, a pure Conventional Commits 1.0.0 check of one commit message.
// No I/O and no globals; validate.mjs is the command-line front end.

const RULES = Object.freeze({
  messageEmpty: 'message-empty',
  headerType: 'header-type',
  headerScope: 'header-scope',
  headerSeparator: 'header-separator',
  headerDescription: 'header-description',
  bodyLeadingBlank: 'body-leading-blank',
  footerBreakingChange: 'footer-breaking-change',
});

const MESSAGES = Object.freeze({
  [RULES.messageEmpty]: 'the message is empty after cleanup',
  [RULES.headerType]: 'start with a type, an optional (scope), an optional "!", then ": "',
  [RULES.headerScope]: 'put a non-empty scope with no spaces inside the parentheses',
  [RULES.headerSeparator]: 'put ": " (a colon and one space) after the type, scope, and "!"',
  [RULES.headerDescription]: 'write the description directly after ": "',
  [RULES.bodyLeadingBlank]: 'leave one blank line after the header',
  [RULES.footerBreakingChange]: 'write a breaking change as "BREAKING CHANGE: <description>"',
});

/** The git cleanup modes validateMessage can apply before it judges the text. */
export const CLEANUP = Object.freeze({ whitespace: 'whitespace', strip: 'strip' });
const CLEANUP_MODES = Object.values(CLEANUP);

// git's commit.verbose marker: git drops this line and the diff below it from an editor buffer.
const SCISSORS_LINE = '# ------------------------ >8 ------------------------';
const COMMENT_PREFIX = '#';
// The spec allows only ": " after a breaking-change token; "<token> #<value>" is valid for other footers.
const BREAKING_CHANGE_HASH_FOOTERS = Object.freeze(['BREAKING CHANGE #', 'BREAKING-CHANGE #']);

// git's autosquash prefixes; git removes them when it squashes, so only the rest of the header must conform.
const AUTOSQUASH_PREFIXES = Object.freeze(['fixup! ', 'squash! ', 'amend! ']);

// git's whitespace cleanup trims these characters (git's isspace) from each line end.
const TRAILING_WHITESPACE = new Set([' ', '\t', '\r']);

const WHITESPACE = /\s/;
const SCOPE_OPEN = '(';
const SCOPE_CLOSE = ')';
const BREAKING_MARK = '!';
const SEPARATOR_COLON = ':';
const SEPARATOR_SPACE = ' ';

// Characters that end a type: whitespace (tested separately), "(", "!", ":".
const TYPE_TERMINATORS = new Set([SCOPE_OPEN, BREAKING_MARK, SEPARATOR_COLON]);
// Characters a scope may not hold: whitespace (tested separately), "(", ")".
const SCOPE_FORBIDDEN = new Set([SCOPE_OPEN, SCOPE_CLOSE]);

/**
 * Validate one commit message against Conventional Commits 1.0.0.
 * Before any rule runs, the text is cleaned the way git stores it under `options.cleanup`:
 * `whitespace` (the default) keeps "#" lines as message text; `strip` drops the scissors section and every
 * "#" line first, for a raw editor buffer. Any other mode throws a RangeError.
 * Returns [] on pass; otherwise at most one header violation, then body violations in line order. Each has
 * a 1-based `line` in the cleaned message, that line's cleaned `text`, the `rule` id, and a one-sentence
 * `message` that names the fix.
 * @param {string} text
 * @param {{ cleanup?: 'whitespace' | 'strip' }} [options]
 * @returns {{ rule: string, line: number, text: string, message: string }[]}
 */
export function validateMessage(text, options = {}) {
  const { cleanup = CLEANUP.whitespace } = options;
  if (!CLEANUP_MODES.includes(cleanup)) {
    throw new RangeError(`unknown cleanup mode ${JSON.stringify(cleanup)}: use ${CLEANUP_MODES.join(' or ')}`);
  }

  const rawLines = text.split('\n');
  const lines = cleanWhitespace(cleanup === CLEANUP.strip ? stripComments(rawLines) : rawLines);
  if (lines.length === 0) return [violation(RULES.messageEmpty, 1, '')];

  const header = removeAutosquashPrefixes(lines[0]);
  const headerRule = headerViolation(header);
  const headerViolations = headerRule ? [violation(headerRule, 1, header)] : [];
  return [...headerViolations, ...bodyViolations(lines)];
}

function violation(rule, line, text) {
  return { rule, line, text, message: MESSAGES[rule] };
}

// Matches git's `strip` cleanup with commit.verbose; the `whitespace` cleanup runs after it.
function stripComments(rawLines) {
  const scissors = rawLines.indexOf(SCISSORS_LINE);
  const message = scissors === -1 ? rawLines : rawLines.slice(0, scissors);
  return message.filter((line) => !line.startsWith(COMMENT_PREFIX));
}

// Matches git's `whitespace` cleanup, so the rules judge the text git stores. Lines that start with "#" stay.
function cleanWhitespace(rawLines) {
  const cleaned = [];
  for (const raw of rawLines) {
    const line = trimTrailingWhitespace(raw);
    const previousIsEmpty = cleaned.length === 0 || cleaned[cleaned.length - 1] === '';
    if (line === '' && previousIsEmpty) continue;
    cleaned.push(line);
  }
  if (cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned;
}

// A position scan, not a /\s+$/ regex: that regex retries from each space in a long run, which is quadratic.
function trimTrailingWhitespace(line) {
  let end = line.length;
  while (end > 0 && TRAILING_WHITESPACE.has(line[end - 1])) end--;
  return line.slice(0, end);
}

function removeAutosquashPrefixes(header) {
  let rest = header;
  let prefix;
  while ((prefix = AUTOSQUASH_PREFIXES.find((p) => rest.startsWith(p)))) rest = rest.slice(prefix.length);
  return rest;
}

// Scans `<type>[(<scope>)][!]: <description>` by position, so time stays linear in the header length.
// Returns the first rule the header breaks, or null.
function headerViolation(header) {
  let i = 0;
  while (i < header.length && !WHITESPACE.test(header[i]) && !TYPE_TERMINATORS.has(header[i])) i++;
  if (i === 0 || !TYPE_TERMINATORS.has(header[i])) return RULES.headerType;

  if (header[i] === SCOPE_OPEN) {
    const scopeStart = ++i;
    while (i < header.length && !WHITESPACE.test(header[i]) && !SCOPE_FORBIDDEN.has(header[i])) i++;
    if (i === scopeStart || header[i] !== SCOPE_CLOSE) return RULES.headerScope;
    i++;
  }

  if (header[i] === BREAKING_MARK) i++;
  if (header[i] !== SEPARATOR_COLON) return RULES.headerSeparator;
  i++;

  if (i === header.length) return RULES.headerDescription;
  if (header[i] !== SEPARATOR_SPACE) return RULES.headerSeparator;
  i++;

  if (i === header.length || WHITESPACE.test(header[i])) return RULES.headerDescription;
  return null;
}

// Runs on every line after the header, also when the header failed, so one run lists every problem.
function bodyViolations(lines) {
  const found = [];
  lines.forEach((line, index) => {
    if (index === 0) return;
    const lineNumber = index + 1;
    if (index === 1 && line !== '') found.push(violation(RULES.bodyLeadingBlank, lineNumber, line));
    if (BREAKING_CHANGE_HASH_FOOTERS.some((footer) => line.startsWith(footer))) {
      found.push(violation(RULES.footerBreakingChange, lineNumber, line));
    }
  });
  return found;
}
