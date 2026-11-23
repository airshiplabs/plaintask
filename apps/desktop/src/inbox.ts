// inbox.ts - the rules of a Plaintask task file, as pure functions over its text. No imports, no IO.
//
// A file is kept as its lines, each with the exact line ending that followed it, so serialize(parse(text)) === text
// for any text. The app makes three edits, and each touches as little as it can: ticking a task changes one character,
// renaming one changes its title, and adding one appends a line. Every line the app does not understand (headings, notes, front matter,
// indented subtasks) is carried through unchanged and never shown.

export type Ending = '' | '\n' | '\r\n';
export interface Line { readonly text: string; readonly ending: Ending }
export type Doc = readonly Line[];

/** A task has no id in the file, so it is named by its title and how many tasks with that title come before it.
    That name survives ticking the task and lines being added or removed elsewhere in the file. */
export interface TaskId { readonly title: string; readonly occurrence: number }
export interface Task { readonly id: TaskId; readonly title: string; readonly done: boolean }

export const NO_TITLE = 'Give the task a name first.';

const BOM = '﻿';
const TASK = /^- \[([ xX])\] (.*)$/;   // at the left margin: an indented line is a subtask, which the app does not show yet
const FENCE = '---';
const CODE_OPEN = /^ {0,3}(`{3,}(?!.*`)|~{3,})/;   // CommonMark: a backtick fence's info string has no backtick
const CODE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;   // the opening fence's character, at least as many of it
const COMMENT_OPEN = /^ {0,3}<!--/;
const COMMENT_CLOSE = '-->';

export function parse(text: string): Doc {
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) { lines.push({ text: text.slice(start), ending: '' }); break; }
    const crlf = nl > start && text[nl - 1] === '\r';
    lines.push({ text: text.slice(start, crlf ? nl - 1 : nl), ending: crlf ? '\r\n' : '\n' });
    start = nl + 1;
  }
  return lines;
}

export function serialize(doc: Doc): string {
  let text = '';
  for (const line of doc) text += line.text + line.ending;
  return text;
}

/** The last line of the fenced code block or HTML comment that `text`, line `at`, opens; -1 if it opens none, or opens one
    that never closes. A block with no closing line hides nothing, so a stray fence or "<!--" cannot hide the tasks below it,
    or a task the app adds at the end. A task line never closes a comment, so ticking, renaming or adding a task never
    changes which lines are tasks, and a task's id stays on its line. */
function blockEnd(doc: Doc, at: number, text: string): number {
  const fence = CODE_OPEN.exec(text)?.[1];
  const closes = fence
    ? (line: string) => { const close = CODE_CLOSE.exec(line)?.[1]; return !!close && close[0] === fence[0] && close.length >= fence.length; }
    : COMMENT_OPEN.test(text) ? (line: string) => line.includes(COMMENT_CLOSE) && !TASK.test(line) : null;
  if (!closes) return -1;
  if (!fence && text.includes(COMMENT_CLOSE)) return at;
  for (let i = at + 1; i < doc.length; i++) if (closes(doc[i]!.text)) return i;
  return -1;
}

/** A task and where it sits: its line, and the position in that line of the character between the brackets. */
interface Found extends Task { readonly line: number; readonly mark: number }

/** The line that closes the front matter, or -1 when the file has none. Front matter is a first line of `---` up to the
    next line of `---`. A first `---` that is never closed is a horizontal rule, and the lines after it are read as usual. */
function frontMatterEnd(doc: Doc): number {
  const first = doc[0]?.text;
  if (first === undefined || (first.startsWith(BOM) ? first.slice(1) : first).trimEnd() !== FENCE) return -1;
  return doc.findIndex((line, i) => i > 0 && line.text.trimEnd() === FENCE);
}

function find(doc: Doc): Found[] {
  const found: Found[] = [];
  const seen = new Map<string, number>();
  const frontMatter = frontMatterEnd(doc);
  for (let i = 0; i < doc.length; i++) {
    const raw = doc[i]!.text;
    const skip = i === 0 && raw.startsWith(BOM) ? 1 : 0;
    const text = skip ? raw.slice(skip) : raw;
    if (i <= frontMatter) continue;
    const end = blockEnd(doc, i, text);
    if (end !== -1) { i = end; continue; }
    const match = TASK.exec(text);
    const title = match?.[2]?.trim();
    if (!match || !title) continue;
    const occurrence = seen.get(title) ?? 0;
    seen.set(title, occurrence + 1);
    found.push({ id: { title, occurrence }, title, done: match[1] !== ' ', line: i, mark: skip + 3 });
  }
  return found;
}

/** The file's tasks in file order, done ones included. */
export function tasks(doc: Doc): Task[] {
  return find(doc).map(({ id, title, done }) => ({ id, title, done }));
}

/** The task with this id and where it sits. Throws, naming the task, if it is not in the file. */
function locate(doc: Doc, id: TaskId): Found {
  const task = find(doc).find(t => t.id.title === id.title && t.id.occurrence === id.occurrence);
  if (!task) throw new Error('"' + id.title + '" is no longer in the file.');
  return task;
}

/** The file with one line's text replaced. */
function withLine(doc: Doc, at: number, text: string): Doc {
  const next = doc.slice();
  next[at] = { text, ending: doc[at]!.ending };
  return next;
}

/** Ticks an open task or unticks a done one: one character of one line changes. Throws if the task is not in the file. */
export function toggle(doc: Doc, id: TaskId): Doc {
  const task = locate(doc, id), text = doc[task.line]!.text;
  return withLine(doc, task.line, text.slice(0, task.mark) + (task.done ? ' ' : 'x') + text.slice(task.mark + 1));
}

/** Gives a task a new title: only the title's characters change, not its box, its tick or the space around it.
    The same title returns the file as it was. Throws NO_TITLE for a blank title, or if the task is not in the file. */
export function rename(doc: Doc, id: TaskId, rawTitle: string): Doc {
  const title = cleanTitle(rawTitle);
  if (!title) throw new Error(NO_TITLE);
  const task = locate(doc, id), text = doc[task.line]!.text;
  if (title === task.title) return doc;
  const start = text.indexOf(task.title, task.mark + 3);   // past "] ", and past any space before the title
  return withLine(doc, task.line, text.slice(0, start) + title + text.slice(start + task.title.length));
}

/** A title as it will be written: one line, no space around it. Empty when there is nothing to write. */
export function cleanTitle(raw: string): string {
  return raw.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** Adds an open task as the last line, in the line ending the file already uses. Throws NO_TITLE for a blank title. */
export function append(doc: Doc, rawTitle: string): Doc {
  const title = cleanTitle(rawTitle);
  if (!title) throw new Error(NO_TITLE);
  const eol = doc.find(line => line.ending)?.ending || '\n';
  const last = doc.at(-1);
  const head = last && !last.ending ? [...doc.slice(0, -1), { text: last.text, ending: eol }] : doc;
  return [...head, { text: '- [ ] ' + title, ending: eol }];
}
