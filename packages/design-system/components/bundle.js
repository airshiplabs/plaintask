/* @ds-bundle: {"format":4,"namespace":"Plaintask","components":[{"name":"Button"},{"name":"Fab"},{"name":"Checkbox"},{"name":"TaskRow"},{"name":"Tag"},{"name":"Badge"},{"name":"GroupHeader"},{"name":"EmptyState"},{"name":"Sidebar"},{"name":"TabBar"},{"name":"ViewHeader"},{"name":"Field"},{"name":"Composer"},{"name":"Sheet"},{"name":"Toast"}]} */
// Plaintask components: plain functions that return HTML strings, plus the behaviours that animate them.
// No framework. Wrap a screen in class="pt-root". Every component reads tokens.css and bundle.css.
(function () {
  var ICON = {
    inbox: '<path d="M3 13l2.5-8h9L17 13v3H3z"/><path d="M3 13h4l1 2h4l1-2h4"/>',
    today: '<circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3"/>',
    upcoming: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2.5v3M13 2.5v3"/>',
    anytime: '<rect x="3" y="3.5" width="14" height="4" rx="1.2"/><rect x="3" y="9.5" width="14" height="4" rx="1.2"/><path d="M5 16.5h10"/>',
    someday: '<path d="M3 6h14v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M2 3h16v3H2zM8 9.5h4"/>',
    completed: '<rect x="4" y="2.5" width="12" height="15" rx="2"/><path d="M7 10l2 2 4-4.5"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    folder: '<path d="M2.5 5.5a1 1 0 0 1 1-1h4l1.5 1.8h7.5a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/>',
    chevron: '<path d="M8 5l5 5-5 5"/>',
    back: '<path d="M12 5l-5 5 5 5"/>',
    repeat: '<path d="M4 8a5 5 0 0 1 9-2.5L15 7M16 12a5 5 0 0 1-9 2.5L5 13"/><path d="M15 3.5V7h-3.5M5 16.5V13h3.5"/>',
    close: '<path d="M5 5l10 10M15 5L5 15"/>',
    search: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/>',
    tick: '<path d="M5.5 10.5l3 3 6-7"/>',
    'arrow-back': '<path d="M16 10H4M9 5l-5 5 5 5"/>',
    trash: '<path d="M3.5 5.5h13M8 5.5v-2h4v2M5 5.5l.8 11a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9l.8-11M8.5 9v5M11.5 9v5"/>',
    restore: '<path d="M4 10a6 6 0 1 0 1.8-4.3L4 7.5"/><path d="M4 3.5v4h4"/>'
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var icon = function (name, cls) { return '<svg class="' + (cls || 'pt-icon') + '" viewBox="0 0 20 20" aria-hidden="true">' + (ICON[name] || '') + '</svg>'; };
  var TICK = '<svg viewBox="0 0 20 20" aria-hidden="true">' + ICON.tick + '</svg>';
  // Restarts a CSS animation. Reading a computed style flushes style but not layout: offsetWidth would lay out the whole
  // page, and the browser lays it out again for the new class (each costs ~12 ms in a 10,000-row list).
  var restart = function (el, cls) { el.classList.remove(cls); void getComputedStyle(el).animationName; el.classList.add(cls); };

  // ---- markup ----
  function Button(p) {
    var v = p.variant ? ' pt-btn--' + p.variant : '';
    return '<button type="' + (p.type || 'button') + '" class="pt-btn' + v + (p.iconOnly ? ' pt-btn--icon' : '') + '"' + (p.iconOnly ? ' aria-label="' + esc(p.label) + '"' : '') + '>' +
      (p.icon ? icon(p.icon) : '') + (p.iconOnly ? '' : esc(p.label)) + (p.kbd ? ' <kbd class="pt-kbd">' + esc(p.kbd) + '</kbd>' : '') + '</button>';
  }
  function Fab(p) { return '<button type="button" class="pt-fab" aria-label="' + esc(p.label || 'New task') + '" aria-expanded="' + !!p.expanded + '">' + icon('plus') + '</button>'; }
  function Checkbox(p) {
    return '<button type="button" class="pt-check" role="checkbox" aria-checked="' + !!p.checked + '" aria-label="' + (p.checked ? 'Mark not done' : 'Complete') + ': ' + esc(p.label) + '">' + TICK +
      '<span class="pt-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></button>';
  }
  function Tag(text) { return '<span class="pt-tag">#' + esc(text) + '</span>'; }
  function Badge(n, key) { return '<span class="pt-badge"' + (key ? ' data-badge="' + esc(key) + '"' : '') + '>' + (n || '') + '</span>'; }
  // task: { id, title, project?, tags?, repeat?, when?, due?, dueSoon?, done?, doneLabel?, trashed? } — dates arrive as display text.
  // opts.trashButton adds "Move to Trash"; a trashed task shows Restore instead of a checkbox.
  function TaskRow(task, opts) {
    opts = opts || {};
    var meta = [];
    if (task.project && opts.showProject !== false) meta.push('<span>' + esc(task.project) + '</span>');
    if (task.repeat) meta.push('<span>' + icon('repeat') + ' ' + esc(task.repeat) + '</span>');
    (task.tags || []).forEach(function (t) { meta.push(Tag(t)); });
    var side = [];
    if (task.done && task.doneLabel) side.push('<span>' + esc(task.doneLabel) + '</span>');
    if (!task.done && opts.showWhen && task.when) side.push('<span>' + esc(task.when) + '</span>');
    if (!task.done && !task.trashed && task.due) side.push('<span class="' + (task.dueSoon ? 'pt-due-soon' : '') + '">' + esc(task.due) + '</span>');
    if (task.trashed) side.push('<button type="button" class="pt-btn pt-btn--ghost pt-restore" aria-label="Restore: ' + esc(task.title) + '">' + icon('restore') + 'Restore</button>');
    else if (opts.trashButton) side.push('<button type="button" class="pt-btn pt-btn--ghost pt-btn--icon pt-trash-btn" aria-label="Move to Trash: ' + esc(task.title) + '">' + icon('trash') + '</button>');
    return '<li class="pt-collapse" data-row="' + esc(task.id) + '"><div><div class="pt-task' + (task.done ? ' is-done' : '') + (task.trashed ? ' is-trashed' : '') + '" data-task="' + esc(task.id) + '">' +
      (task.trashed ? '<span class="pt-check-slot" aria-hidden="true"></span>' : Checkbox({ checked: task.done, label: task.title })) +
      '<div class="pt-task__body"><span class="pt-task__title">' + esc(task.title) + '</span>' + (meta.length ? '<span class="pt-task__meta">' + meta.join('') + '</span>' : '') + '</div>' +
      '<div class="pt-task__side">' + side.join('') + '</div></div></div></li>';
  }
  function GroupHeader(p) { return '<h3 class="pt-group-h">' + esc(p.label) + (p.note ? ' <small>' + esc(p.note) + '</small>' : '') + '</h3>'; }
  function EmptyState(p) { return '<div class="pt-empty" role="status"><span class="pt-empty__mark">' + TICK + '</span><strong>' + esc(p.title) + '</strong><span>' + esc(p.body) + '</span></div>'; }
  // items: [{ id, label, icon, count?, current? }], sections: [{ label, items }]
  function Sidebar(p) {
    var item = function (it) { return '<button type="button" class="pt-nav-item" data-view="' + esc(it.id) + '" aria-current="' + !!it.current + '">' + icon(it.icon || 'folder') + '<span>' + esc(it.label) + '</span>' + Badge(it.count, it.id) + '</button>'; };
    return '<nav class="pt-sidebar" aria-label="Lists"><div class="pt-nav"><span class="pt-nav__ind" aria-hidden="true"></span>' + p.items.map(item).join('') +
      (p.sections || []).map(function (s) { return '<h3 class="pt-nav-h">' + esc(s.label) + '</h3>' + s.items.map(item).join(''); }).join('') + '</div></nav>';
  }
  function TabBar(p) {
    return '<nav class="pt-tabbar" aria-label="Tabs">' + p.tabs.map(function (t) { return '<button type="button" class="pt-tab" data-view="' + esc(t.id) + '" aria-current="' + !!t.current + '">' + icon(t.icon) + '<span>' + esc(t.label) + '</span></button>'; }).join('') + '</nav>';
  }
  function ViewHeader(p) {
    if (p.large) return '<header class="pt-view-h pt-view-h--large">' + (p.back ? '<button type="button" class="pt-back" aria-label="Back to ' + esc(p.back) + '">' + icon('back', 'pt-icon pt-icon--apple') + icon('arrow-back', 'pt-icon pt-icon--android') + '<span>' + esc(p.back) + '</span></button>' : '') + '<h2>' + esc(p.title) + '</h2>' + (p.subtitle ? '<p>' + esc(p.subtitle) + '</p>' : '') + '</header>';
    return '<header class="pt-view-h"><div><h2>' + esc(p.title) + '</h2>' + (p.subtitle ? '<p>' + esc(p.subtitle) + '</p>' : '') + '</div>' + (p.action ? Button(p.action) : '') + '</header>';
  }
  // Field: a label wrapping one control. p.options turns it into a select: [[value, label, selected?]]
  function Field(p) {
    var control = p.options
      ? '<select class="pt-select" id="' + esc(p.id) + '" name="' + esc(p.name) + '">' + p.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[2] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'
      : '<input class="pt-input" id="' + esc(p.id) + '" name="' + esc(p.name) + '" autocomplete="off" placeholder="' + esc(p.placeholder || '') + '" value="' + esc(p.value || '') + '"' + (p.invalid ? ' aria-invalid="true"' : '') + '>';
    return '<label class="pt-field" for="' + esc(p.id) + '"><span>' + esc(p.label) + '</span>' + control + '</label>';
  }
  function Composer(p) {
    p = p || {};
    var pre = p.idPrefix || 'composer';
    return '<form class="pt-composer' + (p.card ? ' pt-composer--card' : '') + (p.stacked ? ' pt-composer--stacked' : '') + '" novalidate>' +
      Field({ id: pre + '-title', name: 'title', label: 'Task', placeholder: 'e.g. Call the tiler', value: p.title }) +
      '<div class="pt-composer__row">' + Field({ id: pre + '-project', name: 'project', label: 'Project', options: p.projects || [['', 'No project (Inbox)']] }) +
      Field({ id: pre + '-when', name: 'when', label: 'When', options: p.whens || [['0', 'Today', true], ['1', 'Tomorrow'], ['', 'Anytime'], ['someday', 'Someday']] }) +
      Field({ id: pre + '-tags', name: 'tags', label: 'Tags', placeholder: '#call' }) + '</div>' +
      '<p class="pt-error" aria-live="polite">' + esc(p.error || '') + '</p>' +
      '<div class="pt-composer__actions">' + Button({ label: 'Cancel', variant: 'ghost' }) + Button({ label: 'Add task', variant: 'primary', type: 'submit' }) + '</div></form>';
  }
  function Sheet(p) { return '<div class="pt-scrim" data-sheet-close></div><div class="pt-sheet" role="dialog" aria-modal="true" aria-label="' + esc(p.title) + '" inert><h3>' + esc(p.title) + '</h3>' + p.body + '</div>'; }
  function Toast(p) { return '<div class="pt-toast"><span>' + esc(p.message) + '</span>' + (p.action ? '<button type="button">' + esc(p.action) + '</button>' : '') + '</div>'; }

  // ---- behaviour ----
  // Tick, strike, hold, collapse, then call onCommit. Keyboard focus moves to the neighbouring row.
  function complete(row, onCommit) {
    var check = row.querySelector('.pt-check');
    row.classList.add('is-done'); check.setAttribute('aria-checked', 'true'); restart(check, 'is-celebrating');
    setTimeout(function () { fold(row, onCommit); }, 620);
  }
  // Moves a row out at once: no tick, no strike. Pair it with a "Moved to Trash" toast and Undo.
  function trash(row, onCommit) { fold(row, onCommit); }
  // Folds a row to zero height, then calls onCommit. Keyboard focus moves to the neighbouring row.
  function fold(row, onCommit) {
    var li = row.closest('.pt-collapse');
    var hadFocus = li && li.contains(document.activeElement);
    var near = li && (li.nextElementSibling || li.previousElementSibling);
    if (li) li.classList.add('is-leaving');
    setTimeout(function () {
      if (hadFocus && near) { var c = near.querySelector('.pt-check, .pt-restore'); if (c) c.focus({ preventScroll: true }); }
      if (onCommit) onCommit();
    }, 380);
  }
  function enter(row) { restart(row, 'is-entering'); }
  function bump(badge) { restart(badge, 'is-bumping'); }
  // Slides the sidebar's indicator under the item with aria-current="true".
  function moveIndicator(nav) {
    var cur = nav.querySelector('[aria-current="true"]'), ind = nav.querySelector('.pt-nav__ind');
    if (!cur || !ind) return;
    ind.style.transform = 'translateY(' + cur.offsetTop + 'px)'; ind.style.height = cur.offsetHeight + 'px';
  }
  function openSheet(host) { var s = host.querySelector('.pt-sheet'); s.inert = false; host.classList.add('is-open'); var f = s.querySelector('input, select, button'); if (f) f.focus({ preventScroll: true }); }
  function closeSheet(host) { host.classList.remove('is-open'); host.querySelector('.pt-sheet').inert = true; }
  // Shows a toast for 5 s; action runs onAction and closes it. Toasts stack, so each action stays reachable for its full 5 s.
  function toast(host, message, action, onAction) {
    var wrap = document.createElement('div'); wrap.innerHTML = Toast({ message: message, action: action });
    // is-scrolling marks a host whose stack overflows it, so the app can let the wheel reach it
    var fit = function () { host.classList.toggle('is-scrolling', host.scrollHeight > host.clientHeight); };
    var el = wrap.firstChild; host.appendChild(el); host.scrollTop = host.scrollHeight; fit();   // a host that scrolls keeps the newest in view
    el.addEventListener('animationend', fit);   // the rise-in transform overflows the host for a moment
    var close = function () { el.classList.add('is-leaving'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); fit(); }, 220); };
    if (action) el.querySelector('button').onclick = function () { this.onclick = null; try { if (onAction) onAction(); } finally { close(); } };
    setTimeout(close, 5000);
    return el;
  }
  function shake(el) { restart(el, 'is-shaking'); }

  // ---- platform ----
  // Apps know their platform and should set data-platform on .pt-root themselves; this guess is for web builds and previews.
  function platform() {
    var ua = navigator.userAgent || '';
    var os = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(os) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Mac/i.test(os)) return 'macos';
    if (/Win/i.test(os)) return 'windows';
    return 'linux';
  }
  // The label for a shortcut that uses the platform's command key: shortcut('K') is "⌘K" on Apple platforms, "Ctrl+K" elsewhere.
  function shortcut(key, on) {
    var p = on || platform();
    return (p === 'macos' || p === 'ios' ? '\u2318' : 'Ctrl+') + key;
  }

  window.Plaintask = {
    icon: icon, esc: esc,
    Button: Button, Fab: Fab, Checkbox: Checkbox, TaskRow: TaskRow, Tag: Tag, Badge: Badge, GroupHeader: GroupHeader, EmptyState: EmptyState,
    Sidebar: Sidebar, TabBar: TabBar, ViewHeader: ViewHeader, Field: Field, Composer: Composer, Sheet: Sheet, Toast: Toast,
    complete: complete, trash: trash, enter: enter, bump: bump, moveIndicator: moveIndicator, openSheet: openSheet, closeSheet: closeSheet, toast: toast, shake: shake,
    platform: platform, shortcut: shortcut
  };
})();
