// app.ts - the Inbox window: draws the task folder's Inbox.md with the design system's components
// (window.Plaintask, packages/design-system) and keeps the list in step with the file.
// It knows nothing of Tauri: everything outside the page comes through the Backend it is mounted with.
import { append, cleanTitle, NO_TITLE, parse, rename, serialize, tasks, toggle, type Doc, type Task, type TaskId } from './inbox.ts';

export interface Backend {
  /** The task folder's path, or null when the person has not chosen one. */
  folder(): Promise<string | null>;
  /** Asks the person for a folder. Null when they cancel. */
  chooseFolder(): Promise<string | null>;
  /** The text of Inbox.md, or '' when the folder has none yet. Rejects with the reason it cannot be read. */
  read(): Promise<string>;
  /** Replaces the text of Inbox.md. Rejects with the reason it cannot be saved. */
  write(text: string): Promise<void>;
}

const P = window.Plaintask;

const $ = <E extends HTMLElement = HTMLElement>(selector: string, within: ParentNode = document): E => {
  const el = within.querySelector<E>(selector);
  if (!el) throw new Error('the page has no ' + selector);
  return el;
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
/** Tauri rejects with the Rust error's text itself; anything else thrown is an Error. */
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A row's key: its task's id as one string, so it can sit in a data attribute. */
const key = (task: Task) => task.id.occurrence + ':' + task.id.title;
const idOf = (rowKey: string): TaskId => ({ occurrence: Number(rowKey.slice(0, rowKey.indexOf(':'))), title: rowKey.slice(rowKey.indexOf(':') + 1) });
const rowHTML = (task: Task) => P.TaskRow({ id: key(task), title: task.title });
const openTasks = (doc: Doc) => tasks(doc).filter(task => !task.done);

/** A message in place of the list with one button under it, in the empty state's layout. */
const notice = (title: string, body: string, button: string) =>
  '<div class="pt-empty" role="status"><span class="pt-empty__mark">' + P.icon('folder') + '</span><strong>' + esc(title) + '</strong><span>' + esc(body) + '</span>' +
  '<span class="app__choose" data-choose>' + P.Button({ label: button, variant: 'primary' }) + '</span></div>';

/** The new-task form. The design system's Composer also asks for a project, a day and tags; this app has none of those yet. */
const COMPOSER =
  '<form class="pt-composer pt-composer--card" novalidate>' + P.Field({ id: 'composer-title', name: 'title', label: 'Task', placeholder: 'e.g. Call the tiler' }) +
  '<p class="pt-error" aria-live="polite"></p><div class="pt-composer__actions">' + P.Button({ label: 'Cancel', variant: 'ghost' }) +
  P.Button({ label: 'Add task', variant: 'primary', type: 'submit' }) + '</div></form>';

const EMPTY = P.EmptyState({ title: 'Inbox zero', body: 'New tasks you capture land here first.' });

/** How long a ticked row stays drawn: the design system's complete() holds it for 620 ms, then folds it over 380 ms. A ticked
    row carries data-leaving for that second. It is no longer one of the list's tasks: keys skip it and it cannot be ticked again. */
const LEAVING = 'data-leaving';

/** Draws the window and resolves once it shows the folder's Inbox, or the request to choose a folder. */
export async function mount(backend: Backend): Promise<void> {
  const list = $('[data-list]'), head = $('[data-head]'), toasts = $('[data-toasts]');
  $('[data-side]').innerHTML = P.Sidebar({ items: [{ id: 'inbox', label: 'Inbox', icon: 'inbox', current: true }] });
  P.moveIndicator($('.pt-nav'));
  const badge = $('[data-badge="inbox"]');

  const composer = $('[data-composer]');
  $('div', composer).innerHTML = COMPOSER;
  const form = $<HTMLFormElement>('form', composer), field = $<HTMLInputElement>('input', form), error = $('.pt-error', form);

  let text: string | null = null;   // Inbox.md as last read or written; null while no Inbox is shown
  let composing = false;            // the new-task form is open
  let saving = false;               // an add is on its way to the file
  let renaming: HTMLElement | null = null;   // the row whose title is open in a field

  // ---- drawing ----

  /** The header: the list's name, and "New task" while there is an Inbox to add to. */
  function showHeader(canAdd: boolean) {
    head.innerHTML = P.ViewHeader({ title: 'Inbox', ...(canAdd && { action: { label: 'New task', variant: 'primary', icon: 'plus', kbd: 'N' } }) });
  }
  /** The rows of tasks that are staying, in order. */
  const rows = () => [...list.querySelectorAll<HTMLElement>('li[data-row]:not([' + LEAVING + '])')];
  const check = (li: Element) => $('.pt-check', li);
  /** The nearest row that is staying: the next one down, or failing that the next one up. */
  function stayingBeside(li: Element): Element | null {
    for (let el = li.nextElementSibling; el; el = el.nextElementSibling) if (!el.hasAttribute(LEAVING)) return el;
    for (let el = li.previousElementSibling; el; el = el.previousElementSibling) if (!el.hasAttribute(LEAVING)) return el;
    return null;
  }
  function showCount(count: number) {
    const label = count ? String(count) : '';
    if (badge.textContent === label) return;
    const first = text === null;
    badge.textContent = label;
    if (!first) P.bump(badge);
  }

  /** Makes the list show these open tasks. One new task among rows already drawn is added in place, and one changed
      task is redrawn in place, so a long list is not redrawn for either. */
  function showTasks(open: Task[]) {
    const keys = open.map(key), drawn = rows(), drawnKeys = drawn.map(li => li.dataset.row);
    const at = keys.findIndex((k, i) => k !== drawnKeys[i]);
    const oneNew = drawn.length > 0 && keys.length === drawn.length + 1 && sameList(keys.slice(at + 1), drawnKeys.slice(at));
    const oneChanged = at !== -1 && keys.length === drawn.length && sameList(keys.slice(at + 1), drawnKeys.slice(at + 1));
    if (oneNew) {
      const holder = document.createElement('ul');
      holder.innerHTML = rowHTML(open[at]!);
      $('ul', list).insertBefore(holder.firstElementChild!, drawn[at] ?? null);
    } else if (oneChanged) {
      drawn[at]!.outerHTML = rowHTML(open[at]!);
    } else if (!sameList(keys, drawnKeys) || !list.firstElementChild) {
      list.innerHTML = open.length ? '<ul>' + open.map(rowHTML).join('') + '</ul>' : EMPTY;
    }
    showCount(open.length);
  }
  function showNotice(html: string) {
    closeComposer(false);
    showHeader(false);
    list.innerHTML = html;
    badge.textContent = '';
    text = null;
  }
  const toast = (message: string) => { P.toast(toasts, message); };

  // ---- the file ----

  /** Reads and edits of the file run one at a time, in the order they were asked for, so none works from text another is about to replace. */
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  }

  /** Reads Inbox.md and redraws the list if the file's text has changed since it was last drawn.
      `redraw` draws it from the file regardless: the way back after an edit that failed part-way. */
  const load = (redraw = false) => inTurn(async () => {
    let fresh: string;
    try { fresh = await backend.read(); }
    catch (e) { showNotice(notice('Could not open Inbox.md', reason(e), 'Choose another folder')); return; }
    if (fresh === text && !redraw) return;
    if (text === null) showHeader(true);
    if (text === null || redraw) list.innerHTML = '';   // a message was standing in for the list, or the rows may be wrong
    showTasks(openTasks(parse(fresh)));
    text = fresh;
  });
  /** An edit failed: say why, and show the file as it is. */
  const failed = (e: unknown) => { toast(reason(e)); return load(true); };

  /** Applies one change to the file as it is on disk now, not as it was when last drawn, so another editor's lines survive. */
  const edit = (change: (doc: Doc) => Doc) => inTurn(async () => {
    const next = change(parse(await backend.read()));
    const out = serialize(next);
    await backend.write(out);
    text = out;
    return next;
  });

  // ---- adding a task ----

  function openComposer() {
    if (text === null || composing) return;
    composing = true;
    field.value = '';
    clearError();
    composer.classList.remove('is-leaving');
    composer.inert = false;
    field.focus({ preventScroll: true });
  }
  function closeComposer(returnFocus = true) {
    if (!composing) return;
    composing = false;
    composer.classList.add('is-leaving');
    composer.inert = true;
    if (returnFocus) head.querySelector<HTMLElement>('.pt-btn')?.focus({ preventScroll: true });
  }
  function clearError() {
    error.textContent = '';
    field.removeAttribute('aria-invalid');
  }

  async function add() {
    if (saving) return;
    const started = performance.now();
    const title = cleanTitle(field.value);
    if (!title) {
      error.textContent = NO_TITLE;
      field.setAttribute('aria-invalid', 'true');
      P.shake(form);
      field.focus();
      return;
    }
    saving = true;
    try {
      const open = openTasks(await edit(doc => append(doc, title)));
      closeComposer();
      showTasks(open);
      const added = $('ul', list).lastElementChild!;   // a new task is the file's last line, so its row is the list's last
      P.enter($('.pt-task', added));
      added.scrollIntoView({ block: 'nearest' });
      performance.measure('plaintask:add', { start: started });
    } catch (e) {
      toast(reason(e));   // the form stays open with the title, so nothing typed is lost
    } finally {
      saving = false;
    }
  }

  // ---- ticking a task ----

  /** Ticks a row's task: the file is saved at once, and the row celebrates, then folds away. Undo is offered for as long as the toast shows. */
  function complete(li: HTMLElement) {
    if (li.hasAttribute(LEAVING)) return;
    const started = performance.now();
    const id = idOf(li.dataset.row!);
    const hadFocus = li.contains(document.activeElement);
    li.setAttribute(LEAVING, '');
    showCount(rows().length);
    P.complete($('.pt-task', li), () => {
      if (!li.isConnected) return;   // the list was redrawn while the row was folding (Undo, or the file changed)
      const next = stayingBeside(li);
      li.remove();
      if (!list.querySelector('li')) list.innerHTML = EMPTY;
      // The fold moved the keyboard to the neighbouring row. If that row is leaving too, or there was none, find one that is staying.
      const lost = document.activeElement === document.body || document.activeElement?.closest('li[' + LEAVING + ']');
      if (hadFocus && lost && next) check(next).focus({ preventScroll: true });
    });
    P.toast(toasts, 'Completed: ' + id.title, 'Undo', () => { void undo(li, id); });
    edit(doc => toggle(doc, id)).catch(failed);
    performance.measure('plaintask:tick', { start: started });
  }

  /** Unticks the task in the file and puts its row back where the file has it. */
  async function undo(li: HTMLElement, id: TaskId) {
    try {
      const open = openTasks(await edit(doc => toggle(doc, id)));
      li.remove();   // if it is still folding away
      showTasks(open);
      const back = rows().find(row => row.dataset.row === li.dataset.row);
      if (back) P.enter($('.pt-task', back));
    } catch (e) { await failed(e); }
  }

  // ---- renaming a task ----

  /** Opens a row's title in a field, in the title's place. Return saves, and so does leaving the field. Escape keeps the
      old title, as does leaving the field with the title unchanged or empty. Only the title changes in the file. */
  function startRename(li: HTMLElement) {
    if (renaming || li.hasAttribute(LEAVING)) return;
    const id = idOf(li.dataset.row!), label = $('.pt-task__title', li), at = rows().indexOf(li);
    const input = document.createElement('input');
    input.className = 'app__rename';
    input.value = id.title;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Rename: ' + id.title);
    label.hidden = true;
    label.after(input);
    renaming = li;
    input.focus({ preventScroll: true });
    input.select();

    let settled = false;   // the field has been closed, or its title is on its way to the file
    const keep = (returnFocus: boolean) => {
      settled = true;
      renaming = null;
      input.remove();
      label.hidden = false;
      if (returnFocus) check(li).focus({ preventScroll: true });
    };
    const save = async (byKey: boolean) => {
      if (settled) return;
      const title = cleanTitle(input.value);
      if (!title && byKey) { input.setAttribute('aria-invalid', 'true'); P.shake($('.pt-task', li)); return; }
      if (!title || title === id.title) { keep(byKey); return; }
      settled = true;
      try {
        const open = openTasks(await edit(doc => rename(doc, id, title)));
        renaming = null;
        showTasks(open);
        const renamed = rows()[at];
        if (byKey && renamed) check(renamed).focus({ preventScroll: true });
      } catch (e) {
        renaming = null;
        await failed(e);
      }
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); void save(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); keep(true); }
    });
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    input.addEventListener('blur', () => { void save(false); });
  }

  async function choose() {
    if (await backend.chooseFolder()) await load();
  }

  // ---- input ----

  form.addEventListener('submit', e => { e.preventDefault(); void add(); });
  field.addEventListener('input', clearError);

  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const ticked = e.target.closest('.pt-check')?.closest<HTMLElement>('li[data-row]');
    if (ticked) { if (ticked !== renaming) complete(ticked); }   // a click on the checkbox of a title being edited only leaves the field
    else if (e.target.closest('[data-choose]')) void choose();
    else if (e.target.closest('[data-head] .pt-btn')) openComposer();
    else if (e.target.closest('[data-composer] .pt-btn--ghost')) closeComposer();
  });

  document.addEventListener('dblclick', e => {
    const li = e.target instanceof Element ? e.target.closest('.pt-task__title')?.closest<HTMLElement>('li[data-row]') : null;
    if (li) startRename(li);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && composing) { e.preventDefault(); closeComposer(); return; }
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey || text === null || composing) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openComposer(); return; }
    // Return on a row renames it. Cancelling the key stops it pressing the row's checkbox, which would tick the task: Space does that.
    const focused = e.target instanceof Element ? e.target.closest('.pt-check')?.closest<HTMLElement>('li[data-row]') : null;
    if (e.key === 'Enter' && focused) { e.preventDefault(); startRename(focused); return; }
    // j, k and the arrows move the keyboard between rows; Space then ticks the focused row, as it presses any focused button.
    const down = e.key === 'j' || e.key === 'ArrowDown', up = e.key === 'k' || e.key === 'ArrowUp';
    const staying = rows();
    if (!(down || up) || !staying.length) return;
    e.preventDefault();
    const at = staying.findIndex(li => li.contains(document.activeElement));
    check(staying[down ? Math.min(at + 1, staying.length - 1) : Math.max(at - 1, 0)]!).focus();
  });

  // A web page's own context menu (Reload, Back) has no place in an app window. A text field keeps its menu, for paste and spelling.
  document.addEventListener('contextmenu', e => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });

  // Another editor may have changed the file while this window was in the background.
  window.addEventListener('focus', () => { if (text !== null && !renaming) void load(); });

  let folder: string | null;
  try { folder = await backend.folder(); }
  catch (e) { showNotice(notice('Could not open your task folder', reason(e), 'Choose folder')); return; }
  if (folder !== null) await load();
  else showNotice(notice('Choose a folder for your tasks', 'Plaintask keeps them there as plain Markdown files.', 'Choose folder'));
}
