// It knows nothing of Tauri: everything outside the page comes through the Backend it is mounted with.
import { append, cleanTitle, NO_TITLE, parse, rename, serialize, tasks, toggle, type Doc, type Task, type TaskId } from './inbox.ts';
import { rowList } from './rows.ts';
import { can, initial, step, type SessionEvent } from './session.ts';

export interface Backend {
  /** The task folder's path, or null when the person has not chosen one. */
  folder(): Promise<string | null>;
  /** Asks the person for a folder. Null when they cancel. */
  chooseFolder(): Promise<string | null>;
  /** The text of Inbox.md, '' when the folder has none yet, or null when the folder itself is gone (moved, renamed,
      deleted or unmounted). Rejects with an Error whose message is the reason it cannot be read. */
  read(): Promise<string | null>;
  /** Replaces the text of Inbox.md. Rejects with an Error whose message is the reason it cannot be saved. */
  write(text: string): Promise<void>;
  /** Shows this number on the app's Dock icon. 0 removes it. */
  badge(count: number): Promise<void>;
  /** Starts listening for the app's update checks, which run at launch and every 24 hours once the window is drawn.
      `offer` gets each newer version a check finds; `restart` runs once an installed update waits to restart the app. */
  onUpdate(listener: { offer(version: string): void; restart(): void }): Promise<void>;
  /** Opens the app's update window, which downloads and installs the newest version. */
  installUpdate(): Promise<void>;
  /** Lets the installed update restart the app. */
  restartForUpdate(): Promise<void>;
}

const P = window.Plaintask;

const $ = <E extends HTMLElement = HTMLElement>(selector: string, within: ParentNode = document): E => {
  const el = within.querySelector<E>(selector);
  if (!el) throw new Error('the page has no ' + selector);
  return el;
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A row's key: its task's id as one string, so it can sit in a data attribute. */
const key = (id: TaskId) => id.occurrence + ':' + id.title;
const rowKey = (task: Task) => key(task.id);
const rowHTML = (task: Task) => P.TaskRow({ id: rowKey(task), title: task.title });
/** The task row `target` is in, or null. With `part`, only when `target` is inside that part of the row, such as its checkbox. */
function rowOf(target: EventTarget | null, part?: string): HTMLElement | null {
  if (!(target instanceof Element) || (part && !target.closest(part))) return null;
  return target.closest<HTMLElement>('li[data-row]');
}
const openTasks = (doc: Doc) => tasks(doc).filter(task => !task.done);

const notice = (title: string, body: string, button: string) =>
  '<div class="pt-empty" role="status"><span class="pt-empty__mark">' + P.icon('folder') + '</span><strong>' + esc(title) + '</strong><span>' + esc(body) + '</span>' +
  '<span class="app__choose" data-choose>' + P.Button({ label: button, variant: 'primary' }) + '</span></div>';

const COMPOSER =
  '<form class="pt-composer pt-composer--card" novalidate>' + P.Field({ id: 'composer-title', name: 'title', label: 'Task', placeholder: 'e.g. Call the tiler' }) +
  '<p class="pt-error" aria-live="polite"></p><div class="pt-composer__actions">' + P.Button({ label: 'Cancel', variant: 'ghost' }) +
  P.Button({ label: 'Add task', variant: 'primary', type: 'submit' }) + '</div></form>';

const FOLDER_GONE = 'Your task folder cannot be found';
const folderGone = () => notice(FOLDER_GONE, 'It may have been moved, renamed or deleted, or its disk is not connected.', 'Choose folder');

const EMPTY = P.EmptyState({ title: 'Inbox zero', body: 'New tasks you capture land here first.' });

/** Draws the window and resolves once it shows the folder's Inbox, or the request to choose a folder. */
export async function mount(backend: Backend): Promise<void> {
  const list = $('[data-list]'), head = $('[data-head]'), toasts = $('[data-toasts]');
  const rows = rowList(list, $('[data-scroll]'), rowHTML, rowKey, EMPTY);
  $('[data-side]').innerHTML = P.Sidebar({ items: [{ id: 'inbox', label: 'Inbox', icon: 'inbox', current: true }] });
  P.moveIndicator($('.pt-nav'));
  const badge = $('[data-badge="inbox"]');

  const composer = $('[data-composer]');
  $('div', composer).innerHTML = COMPOSER;
  const form = $<HTMLFormElement>('form', composer), input = $<HTMLInputElement>('input', form), error = $('.pt-error', form);

  let text: string | null = null;   // Inbox.md as last read or written; null while no Inbox is shown
  let s = initial;                  // the session: what shows, the form, a rename (session.ts)
  /** Moves the session on by one event, and returns it as it was. */
  const go = (event: SessionEvent) => { const was = s; s = step(s, event); return was; };
  let renamed: HTMLElement | null = null;   // the row whose title is a field or is saving, while s.rename is not 'none'
  /** The title field open now: drop() takes it away with no save, keep() puts the old title back. */
  let field: { drop(): void; keep(): void } | null = null;

  function showHeader(canAdd: boolean) {
    head.innerHTML = P.ViewHeader({ title: 'Inbox', ...(canAdd && { action: { label: 'New task', variant: 'primary', icon: 'plus', kbd: 'N' } }) });
  }
  const check = (li: Element) => $('.pt-check', li);
  const showDockCount = (count: number) => { backend.badge(count).catch((e: unknown) => console.error('Dock badge:', reason(e))); };
  function showCount(count: number, animate: boolean) {
    const label = count ? String(count) : '';
    if (badge.textContent === label) return;
    badge.textContent = label;
    showDockCount(count);
    if (animate) P.bump(badge);
  }

  function showTasks(open: Task[], animate = true) {
    rows.show(open);
    showCount(open.length, animate);
    if (s.rename === 'editing' && !renamed?.isConnected) field?.keep();   // drawn again without the row being renamed
  }
  let noticeShown: string | null = null;
  function showNotice(event: 'folderNone' | 'folderFailed' | 'gone' | 'unreadable', html: string) {
    if (s.rename === 'editing') field?.drop();   // the field goes with the rows
    const was = go(event);
    if (text === null && html === noticeShown) return;   // the same notice again, as after a reread on focus: keep it, and the keyboard on its button
    noticeShown = html;
    text = null;
    if (was.composer === 'open') hideComposer(false);
    showHeader(false);
    rows.clear(html);
    showCount(0, false);
  }
  const toast = (message: string) => { P.toast(toasts, message); };

  /** The toast offering an update. Unlike other toasts it stays until it is clicked or closed; a closed one comes
      back with the next check that finds the update. */
  let offered: { version: string; toast: HTMLElement } | null = null;
  function offerUpdate(version: string) {
    if (offered && offered.version === version && offered.toast.isConnected && !offered.toast.classList.contains('is-leaving')) return;
    if (offered) dismiss(offered.toast);
    const wrap = document.createElement('div');
    wrap.innerHTML = P.Toast({ message: 'Plaintask ' + version + ' is available', action: 'Update' });
    const el = wrap.firstElementChild as HTMLElement;
    el.dataset.update = version;
    el.insertAdjacentHTML('beforeend', '<button type="button" class="app__toast-close" aria-label="Close">' + P.icon('close') + '</button>');
    el.addEventListener('click', e => {
      const button = e.target instanceof Element ? e.target.closest('button') : null;
      if (!button) return;
      dismiss(el);
      if (button.classList.contains('app__toast-close')) return;
      backend.installUpdate().catch((error: unknown) => { toast(reason(error)); });
    });
    toasts.appendChild(el);
    offered = { version, toast: el };
  }
  function dismiss(el: HTMLElement) {
    if (el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    setTimeout(() => { el.remove(); }, 220);
  }
  /** An installed update restarts the app, but not while the new-task form is open: then it waits for the form to close. */
  let restartWaits = false;
  function restartForUpdate() {
    restartWaits = s.composer === 'open';
    if (!restartWaits) backend.restartForUpdate().catch((e: unknown) => { toast(reason(e)); });
  }
  await backend.onUpdate({ offer: offerUpdate, restart: restartForUpdate });

  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  }

  /** The text of Inbox.md, or null once the window shows that the task folder cannot be found. Rejects as Backend.read does. */
  async function readInbox(): Promise<string | null> {
    const fresh = await backend.read();
    if (fresh === null) showNotice('gone', folderGone());
    return fresh;
  }

  /** Reads Inbox.md and redraws the list if the file's text has changed since it was last drawn.
      `redraw` draws it from the file regardless: the way back after an edit that failed part-way. */
  const load = (redraw = false) => inTurn(async () => {
    let fresh: string | null;
    try { fresh = await readInbox(); }
    catch (e) { showNotice('unreadable', notice('Could not open Inbox.md', reason(e), 'Choose another folder')); return; }
    if (fresh === null) return;
    go('shown');
    if (fresh === text && !redraw) return;
    const shown = text !== null;
    text = fresh;
    if (!shown) showHeader(true);
    if (!shown || redraw) rows.clear('');
    showTasks(openTasks(parse(fresh)), shown);
  });
  const failed = (e: unknown) => { toast(reason(e)); return load(true); };

  /** Saves one change, waits until no edit or read is left in the queue, and resolves with the file as it then is: this
      change and every one asked for while it waited, such as a tick clicked while a rename was saving. A caller draws that,
      never a file older than the screen. Null when a read failed meanwhile and the window shows why instead of the list.
      Rejects when this change cannot be made or saved. */
  const edit = async (change: (doc: Doc) => Doc): Promise<Doc | null> => {
    await inTurn(async () => {
      const fresh = await readInbox();
      if (fresh === null) throw new Error(FOLDER_GONE + '.');
      const out = serialize(change(parse(fresh)));
      await backend.write(out);
      if (text !== null) text = out;   // over a notice the notice stays: only a read draws the list again
    });
    let last: Promise<unknown>;
    do { last = queue; await last; } while (last !== queue);   // a turn queued while waiting is waited for too
    return text === null ? null : parse(text);
  };

  function openComposer() {
    if (!can(s, 'openComposer')) return;
    go('openComposer');
    input.value = '';
    clearError();
    composer.classList.remove('is-leaving');
    composer.inert = false;
    input.focus({ preventScroll: true });
  }
  function closeComposer(returnFocus = true) {
    if (!can(s, 'closeComposer')) return;
    go('closeComposer');
    hideComposer(returnFocus);
  }
  function hideComposer(returnFocus: boolean) {
    composer.classList.add('is-leaving');
    composer.inert = true;
    if (returnFocus) head.querySelector<HTMLElement>('.pt-btn')?.focus({ preventScroll: true });
    if (restartWaits) restartForUpdate();
  }
  function clearError() {
    error.textContent = '';
    input.removeAttribute('aria-invalid');
  }

  async function add() {
    if (!can(s, 'startAdd')) return;
    const started = performance.now();
    const title = cleanTitle(input.value);
    if (!title) {
      error.textContent = NO_TITLE;
      input.setAttribute('aria-invalid', 'true');
      P.shake(form);
      input.focus();
      return;
    }
    go('startAdd');
    let next: Doc | null;
    try {
      next = await edit(doc => append(doc, title));
    } catch (e) {
      go('addFailed');
      toast(reason(e));   // the file could not be read or saved: the reason is for the person
      void load();   // a folder that went away after the read shows its notice
      return;
    }
    const was = go('addSaved');
    if (!next) return;   // a reread failed while the add waited: its notice stays
    if (was.composer === 'open') hideComposer(true);
    const open = openTasks(next);
    showTasks(open);
    // Tasks are in file order, so a new line the file's rules do not hide is the last open task.
    if (open.at(-1)?.title === title) {
      const added = rows.reveal(open.length - 1);
      if (added) P.enter($('.pt-task', added));
    } else {
      toast('"' + title + '" is saved at the end of Inbox.md, but a line above it hides it.');
    }
    performance.measure('plaintask:add', { start: started });
  }

  function complete(li: HTMLElement) {
    const id = rows.taskOf(li)?.id;
    if (!id) return;
    const started = performance.now();
    const hadFocus = li.contains(document.activeElement);
    rows.leave(li);
    showCount(rows.count(), true);
    P.complete($('.pt-task', li), () => {
      const next = hadFocus ? rows.beside(li) : undefined;
      if (!rows.drop(li)) return;   // the list was drawn again while the row was folding (Undo, or the file changed)
      // The fold moved the keyboard to the neighbouring row. If that row is leaving too, or there was none, find one that is staying.
      const at = rowOf(document.activeElement);
      const lost = document.activeElement === document.body || (at && !rows.taskOf(at));
      if (hadFocus && lost && next) check(next).focus({ preventScroll: true });
    });
    P.toast(toasts, 'Completed: ' + id.title, 'Undo', () => { void undo(li, id); });
    // Draws the list from the saved file, which holds what another editor changed since the last read. With no such
    // change the file's open tasks are the rows on screen less the ticked one, and rows.show() then changes nothing.
    edit(doc => toggle(doc, id)).then(saved => { if (saved) showTasks(openTasks(saved)); }).catch(failed);
    performance.measure('plaintask:tick', { start: started });
  }

  async function undo(li: HTMLElement, id: TaskId) {
    try {
      const saved = await edit(doc => toggle(doc, id));
      if (!saved) return;
      rows.drop(li);
      const open = openTasks(saved);
      showTasks(open);
      const back = rows.row(open.findIndex(task => rowKey(task) === key(id)));
      if (back) P.enter($('.pt-task', back));
    } catch (e) { await failed(e); }
  }

  function startRename(li: HTMLElement) {
    const id = rows.taskOf(li)?.id;
    if (!can(s, 'startRename') || !id) return;
    const at = rows.indexOf(li), label = $('.pt-task__title', li);
    const input = document.createElement('input');
    input.className = 'app__rename';
    input.value = id.title;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Rename: ' + id.title);
    label.hidden = true;
    label.after(input);
    renamed = li;
    go('startRename');
    input.focus({ preventScroll: true });
    input.select();

    let settled = false;
    const drop = () => {
      settled = true;   // before the field leaves the page, so the blur that may cause does not save it
      field = null;
      input.remove();
      label.hidden = false;
    };
    const keep = (returnFocus: boolean) => {
      drop();
      go('keepRename');
      if (returnFocus) check(li).focus({ preventScroll: true });
    };
    field = { drop, keep: () => keep(false) };
    const save = async (byKey: boolean) => {
      if (settled) return;
      const title = cleanTitle(input.value);
      if (!title && byKey) { input.setAttribute('aria-invalid', 'true'); P.shake($('.pt-task', li)); return; }
      if (!title || title === id.title) { keep(byKey); return; }
      settled = true;
      field = null;
      go('saveRename');
      try {
        const saved = await edit(doc => rename(doc, id, title));
        go('renameSaved');
        if (!saved) return;
        showTasks(openTasks(saved));
        const renamed = byKey ? rows.reveal(at) : undefined;
        if (renamed) check(renamed).focus({ preventScroll: true });
      } catch (e) {
        go('renameFailed');
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
    if (!(await backend.chooseFolder())) return;
    go('folderPicked');
    await load();
  }

  form.addEventListener('submit', e => { e.preventDefault(); void add(); });
  input.addEventListener('input', clearError);

  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const ticked = rowOf(e.target, '.pt-check');
    if (ticked) { if (s.rename === 'none' || ticked !== renamed) complete(ticked); }
    else if (e.target.closest('[data-choose]')) void choose();
    else if (e.target.closest('[data-head] .pt-btn')) openComposer();
    else if (e.target.closest('[data-composer] .pt-btn--ghost')) closeComposer();
  });

  document.addEventListener('dblclick', e => {
    const li = rowOf(e.target, '.pt-task__title');
    if (li) startRename(li);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && s.composer === 'open') { e.preventDefault(); closeComposer(); return; }
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey || s.view !== 'inbox' || s.composer === 'open') return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openComposer(); return; }
    const focused = rowOf(e.target, '.pt-check');
    if (e.key === 'Enter' && focused) { e.preventDefault(); startRename(focused); return; }
    const down = e.key === 'j' || e.key === 'ArrowDown', up = e.key === 'k' || e.key === 'ArrowUp';
    const count = rows.count();
    if (!(down || up) || !count) return;
    e.preventDefault();
    const current = rowOf(document.activeElement);
    const at = current ? rows.indexOf(current) : -1;
    const next = rows.reveal(down ? Math.min(at + 1, count - 1) : Math.max(at - 1, 0));
    if (next) check(next).focus();
  });

  document.addEventListener('contextmenu', e => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });

  window.addEventListener('focus', () => { if (can(s, 'focus')) { go('focus'); void load(); } });

  let folder: string | null;
  try { folder = await backend.folder(); }
  catch (e) { showNotice('folderFailed', notice('Could not open your task folder', reason(e), 'Choose folder')); return; }
  if (folder !== null) { go('folderFound'); await load(); }
  else showNotice('folderNone', notice('Choose a folder for your tasks', 'Plaintask keeps them there as plain Markdown files.', 'Choose folder'));
}
