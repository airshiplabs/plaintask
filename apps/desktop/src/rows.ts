// rows.ts - the Inbox's rows, drawn a window at a time: only the rows in the scroll view and one view's height above and
// below it are in the page. The browser lays out every row of a list again after any change to one of them, ~1 µs a row,
// so 10,000 drawn rows cost ~12 ms a change and a window of ~50 rows costs well under 1 ms.
//
// It keeps every task in file order, with the rows that are folding away after a tick. The space of the rows it does not
// draw is the list's padding above and below the window, from each row's measured height, or the first row's height for a
// row not drawn yet. app.ts names rows by their place among the staying rows; a row it asks for is drawn first.
import type { Task } from './inbox.ts';

/** How long a ticked row stays drawn: the design system's complete() holds it for 620 ms, then folds it over 380 ms. A ticked
    row carries data-leaving for that second. It is no longer one of the list's tasks: places skip it and it cannot be ticked again.
    No code here reads the attribute: tests/desktop-app.test.mjs and the docs/feature-map recipes select rows by it. */
const LEAVING = 'data-leaving';

interface Row {
  readonly key: string;
  readonly task: Task;
  leaving: boolean;
  /** Its element while drawn. A leaving row keeps its element when scrolled away, for the fold that will drop it. */
  el: HTMLElement | null;
  /** Its height when last drawn; -1 before it is drawn. */
  height: number;
}

export interface Rows {
  /** Shows these open tasks in this order. A list that differs by one new task or one changed task keeps the other rows'
      elements, and the rows folding away; any other difference draws the list again without them. */
  show(open: readonly Task[]): void;
  /** Puts this content (a notice, or nothing) in place of the rows, and forgets them. */
  clear(html: string): void;
  /** The number of staying rows. */
  count(): number;
  /** The place among the staying rows of this row, or -1. */
  indexOf(li: Element): number;
  /** The task of this row while it is a staying row; undefined once it is leaving or not listed. */
  taskOf(li: Element): Task | undefined;
  /** The staying row at this place if it is drawn. */
  row(at: number): HTMLElement | undefined;
  /** The staying row at this place, drawn and scrolled into view. */
  reveal(at: number): HTMLElement | undefined;
  /** Marks a row as folding away. */
  leave(li: HTMLElement): void;
  /** The staying row after a row, or before it if none is after, drawn. Undefined when the row is no longer listed. */
  beside(li: Element): HTMLElement | undefined;
  /** Takes a row out of the list, and shows the empty state when no row is left. False when the row was not listed. */
  drop(li: Element): boolean;
}

/** The first i with tops[i] > y. */
function after(tops: Float64Array, y: number): number {
  let lo = 0, hi = tops.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid]! > y) hi = mid; else lo = mid + 1; }
  return lo;
}

/** Rows drawn into `list`, which scrolls inside `scroller`. `draw` makes a task's <li>; `empty` shows when no row is left. */
export function rowList(list: HTMLElement, scroller: HTMLElement, draw: (task: Task) => string, keyOf: (task: Task) => string, empty: string): Rows {
  let rows: Row[] = [];
  let showing = false;              // the list shows rows or the empty state, not a notice
  let ul: HTMLUListElement | null = null;
  let estimate = 40;                // a row's height before any row is measured
  let measured = false;
  const drawn = new Set<Row>();      // the rows whose elements are in the list now
  const template = document.createElement('template');

  const make = (task: Task): Row => ({ key: keyOf(task), task, leaving: false, el: null, height: -1 });
  const staying = () => rows.filter(r => !r.leaving);
  const at = (place: number) => staying()[place];
  const of = (li: Element) => rows.find(r => r.el === li);
  /** A row leaves the list: its element goes with it, as a list drawn again drops every element. */
  const forget = (row: Row) => { row.el?.remove(); row.el = null; drawn.delete(row); };

  function positions(): Float64Array {
    const tops = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) { const h = rows[i]!.height; tops[i + 1] = tops[i]! + (h >= 0 ? h : estimate); }
    return tops;
  }
  /** Where the list starts in the scroller's content. */
  const origin = (el: HTMLElement) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

  function render() {
    if (!showing) return;
    if (!rows.length) {
      if (ul || !list.firstElementChild) { list.innerHTML = empty; ul = null; }
      return;
    }
    if (!ul) { list.innerHTML = '<ul></ul>'; ul = list.firstElementChild as HTMLUListElement; }
    const tops = positions(), view = scroller.clientHeight;
    const top = scroller.scrollTop - origin(ul);
    const start = Math.max(0, after(tops, top - view) - 1), end = Math.min(rows.length, after(tops, top + 2 * view));

    const inWindow = new Set(rows.slice(start, end));
    for (const row of drawn) {
      if (inWindow.has(row)) continue;
      // Scrolled out of the window. A field or button inside it is left first, so a title being edited is saved as on a
      // click elsewhere, and the keyboard is not left on a row that is gone.
      if (row.el!.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      row.el!.remove();
      if (!row.leaving) row.el = null;
      drawn.delete(row);
    }
    let cursor = ul.firstElementChild;
    const total = staying().length;
    let place = rows.slice(0, start).filter(r => !r.leaving).length;
    for (let i = start; i < end; i++) {
      const row = rows[i]!;
      if (!row.el) { template.innerHTML = draw(row.task); row.el = template.content.firstElementChild as HTMLElement; }
      if (row.el === cursor) cursor = cursor.nextElementSibling;
      else ul.insertBefore(row.el, cursor);
      drawn.add(row);
      if (!row.leaving) { row.el.setAttribute('aria-posinset', String(++place)); row.el.setAttribute('aria-setsize', String(total)); }
    }
    ul.style.paddingTop = tops[start] + 'px';
    ul.style.paddingBottom = tops[rows.length]! - tops[end]! + 'px';

    for (let i = start; i < end; i++) rows[i]!.height = rows[i]!.el!.offsetHeight;
    if (!measured) {   // the first drawing guessed every row's height: draw again with the real one
      measured = true;
      estimate = rows[start]!.height || estimate;
      render();
    }
  }

  function reveal(place: number): HTMLElement | undefined {
    const row = at(place);
    if (!row || !ul) return undefined;
    if (!row.el?.isConnected) {   // scroll to it by the rows' heights, so the window takes it in
      const tops = positions(), i = rows.indexOf(row), base = origin(ul), view = scroller.clientHeight;
      scroller.scrollTop = tops[i]! + base < scroller.scrollTop ? tops[i]! + base : tops[i + 1]! + base - view;
      render();
    }
    if (!row.el?.isConnected) return undefined;
    row.el.scrollIntoView({ block: 'nearest' });
    return row.el;
  }

  scroller.addEventListener('scroll', render, { passive: true });
  window.addEventListener('resize', render);

  return {
    show(open) {
      const was = staying(), keys = open.map(keyOf), drawnKeys = was.map(r => r.key);
      const same = (a: readonly string[], i: number, b: readonly string[], j: number) => a.length - i === b.length - j && a.slice(i).every((k, n) => k === b[j + n]);
      const first = keys.findIndex((k, i) => k !== drawnKeys[i]);
      if (showing && was.length > 0 && keys.length === was.length + 1 && same(keys, first + 1, drawnKeys, first)) {
        const before = was[first];
        rows.splice(before ? rows.indexOf(before) : rows.length, 0, make(open[first]!));
      } else if (showing && first !== -1 && keys.length === was.length && same(keys, first + 1, drawnKeys, first + 1)) {
        forget(was[first]!);
        rows[rows.indexOf(was[first]!)] = make(open[first]!);
      } else if (!showing || first !== -1 || keys.length !== was.length) {
        rows.forEach(forget);
        rows = open.map(make);
      }
      showing = true;
      render();
    },
    clear(html) {
      rows.forEach(forget);
      rows = [];
      showing = false;
      ul = null;
      list.innerHTML = html;
    },
    count: () => staying().length,
    indexOf(li) { const row = of(li); return row && !row.leaving ? staying().indexOf(row) : -1; },
    taskOf(li) { const row = of(li); return row && !row.leaving ? row.task : undefined; },
    row(place) { const el = at(place)?.el; return el?.isConnected ? el : undefined; },
    reveal,
    leave(li) {
      const row = of(li);
      if (!row) return;
      row.leaving = true;
      li.setAttribute(LEAVING, '');
    },
    beside(li) {
      const i = rows.findIndex(r => r.el === li);
      if (i === -1) return undefined;
      const next = rows.slice(i + 1).find(r => !r.leaving) ?? rows.slice(0, i).reverse().find(r => !r.leaving);
      return next ? reveal(staying().indexOf(next)) : undefined;
    },
    drop(li) {
      const row = of(li);
      if (!row) return false;
      forget(row);
      rows.splice(rows.indexOf(row), 1);
      render();
      return true;
    },
  };
}
