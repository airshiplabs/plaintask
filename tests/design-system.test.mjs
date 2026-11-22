// design-system.test.mjs - packages/design-system/components/bundle.css in a real browser: each component that sets its
// own color, background or radius resolves to the token it names, so no other rule in the file outranks it.
//   node --test tests/design-system.test.mjs     (CHROME=/path/to/chrome for a Chrome somewhere else)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSite } from './browser.mjs';

// One element per case, rendered inside .pt-root. `want` maps a CSS property to the value the component's own rule gives it.
// `focus` focuses the element first, so the case covers the focus ring's rule too.
const CASES = [
  { name: 'Button', html: '<button class="pt-btn">Save</button>', want: { color: 'var(--ink)', 'background-color': 'var(--surface-2)', 'border-radius': 'var(--radius-md)' } },
  { name: 'Button, focused', focus: true, html: '<button class="pt-btn">Save</button>', want: { 'border-radius': 'var(--radius-md)' } },
  { name: 'Button primary', html: '<button class="pt-btn pt-btn--primary">Add task</button>', want: { color: 'var(--on-accent)', 'background-color': 'var(--accent)' } },
  { name: 'Button danger', html: '<button class="pt-btn pt-btn--danger">Empty Trash</button>', want: { color: 'var(--on-danger)', 'background-color': 'var(--danger)' } },
  { name: 'Button ghost', html: '<button class="pt-btn pt-btn--ghost">Cancel</button>', want: { color: 'var(--muted)', 'background-color': 'transparent' } },
  { name: 'Button icon', html: '<button class="pt-btn pt-btn--icon">x</button>', want: { 'border-radius': 'var(--radius-sm)' } },
  { name: 'Fab', html: '<button class="pt-fab">+</button>', want: { color: 'var(--on-accent)', 'background-color': 'var(--accent)', 'border-radius': 'var(--radius-pill)' } },
  { name: 'Fab, focused', focus: true, html: '<button class="pt-fab">+</button>', want: { 'border-radius': 'var(--radius-pill)' } },
  { name: 'Checkbox', html: '<button class="pt-check" role="checkbox" aria-checked="false"></button>', want: { 'background-color': 'transparent', 'border-radius': 'var(--radius-pill)' } },
  { name: 'Checkbox, focused', focus: true, html: '<button class="pt-check" role="checkbox" aria-checked="false"></button>', want: { 'border-radius': 'var(--radius-pill)' } },
  { name: 'Checkbox, checked', html: '<button class="pt-check" role="checkbox" aria-checked="true"></button>', want: { 'background-color': 'var(--accent)' } },
  { name: 'Sidebar item, current', html: '<button class="pt-nav-item" aria-current="true">Today</button>', want: { color: 'var(--accent)', 'border-radius': 'var(--radius-md)' } },
  { name: 'Sidebar item, current, focused', focus: true, html: '<button class="pt-nav-item" aria-current="true">Today</button>', want: { 'border-radius': 'var(--radius-md)' } },
  { name: 'Tab', html: '<button class="pt-tab">Today</button>', want: { color: 'var(--muted)' } },
  { name: 'Tab, current', html: '<button class="pt-tab" aria-current="true">Today</button>', want: { color: 'var(--accent)' } },
  { name: 'Back button', html: '<button class="pt-back">Browse</button>', want: { color: 'var(--accent)' } },
  { name: 'Input', html: '<input class="pt-input">', want: { color: 'var(--ink)', 'background-color': 'var(--surface)', 'border-radius': 'var(--radius-md)' } },
  { name: 'Select', html: '<select class="pt-select"><option>Inbox</option></select>', want: { color: 'var(--ink)', 'background-color': 'var(--surface)', 'border-radius': 'var(--radius-md)' } },
  { name: 'Toast button', html: '<div class="pt-toast"><button>Undo</button></div>', target: 'button', want: { color: 'var(--bg)', 'border-radius': 'var(--radius-sm)' } },
  { name: 'Tag', html: '<span class="pt-tag">#home</span>', want: { color: 'var(--accent)', 'background-color': 'var(--accent-soft)', 'border-radius': 'var(--radius-pill)' } },
];

// Runs in the page: renders each case in .pt-root and reads each property from the component and from a bare probe
// whose inline style is the wanted value, so both go through the same token and the same serialization.
async function measure(cases) {
  await Promise.all(['/tokens.css', '/components/bundle.css'].map(href => new Promise((done, fail) => {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href, onload: done, onerror: () => fail(new Error(href + ' did not load')) });
    document.head.append(link);
  })));
  const root = Object.assign(document.createElement('div'), { className: 'pt-root' });
  document.body.replaceChildren(root);
  const out = [];
  for (const c of cases) {
    const host = document.createElement('div');
    host.innerHTML = c.html;
    root.replaceChildren(host);
    const el = c.target ? host.querySelector(c.target) : host.firstElementChild;
    if (c.focus) el.focus();
    const probe = document.createElement('div');
    root.append(probe);
    for (const [prop, value] of Object.entries(c.want)) {
      probe.style.setProperty(prop, value);
      out.push({ name: c.name, prop, value, focusVisible: !c.focus || el.matches(':focus-visible'),
        got: getComputedStyle(el).getPropertyValue(prop), want: getComputedStyle(probe).getPropertyValue(prop) });
    }
  }
  return out;
}

test('design-system components resolve to the tokens their own rules name', { timeout: 60000 }, async t => {
  // serve.mjs answers / with a 404 page; the test builds its own document on that origin
  const page = await openSite(t, 'packages/design-system', 800, 600);
  const results = await page.evaluate('(' + measure + ')(' + JSON.stringify(CASES) + ')');
  for (const r of results) {
    assert.ok(r.focusVisible, 'precondition: ' + r.name + ' did not match :focus-visible after focus()');
    assert.equal(r.got, r.want, r.name + ': ' + r.prop + ' should be ' + r.value + ' (' + r.want + '); another rule in bundle.css outranks the component\'s own');
  }
});
