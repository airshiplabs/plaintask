// session.ts - the window's session as a state machine: what the list area shows, the new-task form, and a rename.
// Pure: app.ts keeps the one Session, asks can() before it acts and step() after, and does the drawing itself.
// specs/DesktopSession.tla is its model, with the queue of reads and saves behind it; TLC checks the model, and
// tests/spec-desktop-session.test.mjs fails when a transition here differs from one there.

export type View = 'starting' | 'choose' | 'folderError' | 'inbox' | 'gone' | 'unreadable';

export interface Session {
  /** What the list area shows: the Inbox, or the notice of why it cannot ('choose': no folder is chosen yet). */
  readonly view: View;
  /** A folder is chosen, so Inbox.md is read again when the window regains focus, even after it failed to read. */
  readonly chosen: boolean;
  readonly composer: 'closed' | 'open';
  /** A new task is on its way to the file. */
  readonly adding: boolean;
  /** 'editing': a row's title is a field. 'saving': its new title is on its way to the file. */
  readonly rename: 'none' | 'editing' | 'saving';
}

export const initial: Session = { view: 'starting', chosen: false, composer: 'closed', adding: false, rename: 'none' };

/** A notice in place of the list: it closes the form and takes a title being edited away with the rows. */
const notice = (s: Session, view: View): Session => ({ ...s, view, composer: 'closed', rename: s.rename === 'editing' ? 'none' : s.rename });

interface Rule { readonly when: (s: Session) => boolean; readonly then: (s: Session) => Session }

const RULES = {
  // The folder the app remembers, asked for once at launch.
  folderFound: { when: s => s.view === 'starting' && !s.chosen, then: s => ({ ...s, chosen: true }) },
  folderNone: { when: s => s.view === 'starting' && !s.chosen, then: s => ({ ...s, view: 'choose' }) },
  folderFailed: { when: s => s.view === 'starting' && !s.chosen, then: s => ({ ...s, view: 'folderError' }) },
  // The person.
  /** The folder panel's result. The panel opens from a notice, but a read queued before may have drawn the list meanwhile. */
  folderPicked: { when: s => s.view !== 'starting', then: s => ({ ...s, chosen: true }) },
  focus: { when: s => s.chosen && s.rename === 'none', then: s => s },
  openComposer: { when: s => s.view === 'inbox' && s.composer === 'closed' && s.rename !== 'editing', then: s => ({ ...s, composer: 'open' }) },
  closeComposer: { when: s => s.composer === 'open', then: s => ({ ...s, composer: 'closed' }) },
  startAdd: { when: s => s.composer === 'open' && !s.adding && s.rename !== 'editing', then: s => ({ ...s, adding: true }) },
  startRename: { when: s => s.view === 'inbox' && s.rename === 'none', then: s => ({ ...s, rename: 'editing' }) },
  /** Escape, a title left unchanged or empty, or the row drawn again without its field. */
  keepRename: { when: s => s.rename === 'editing', then: s => ({ ...s, rename: 'none' }) },
  saveRename: { when: s => s.rename === 'editing', then: s => ({ ...s, rename: 'saving' }) },
  // Reads of Inbox.md.
  shown: { when: s => s.chosen, then: s => ({ ...s, view: 'inbox' }) },
  gone: { when: s => s.chosen, then: s => notice(s, 'gone') },
  unreadable: { when: s => s.chosen, then: s => notice(s, 'unreadable') },
  // Saves of Inbox.md.
  addSaved: { when: s => s.adding, then: s => ({ ...s, adding: false, composer: 'closed' }) },
  addFailed: { when: s => s.adding, then: s => ({ ...s, adding: false }) },
  renameSaved: { when: s => s.rename === 'saving', then: s => ({ ...s, rename: 'none' }) },
  renameFailed: { when: s => s.rename === 'saving', then: s => ({ ...s, rename: 'none' }) },
} satisfies Record<string, Rule>;

export type SessionEvent = keyof typeof RULES;
export const EVENTS = Object.keys(RULES) as SessionEvent[];

/** Whether `event` may happen now. */
export const can = (s: Session, event: SessionEvent): boolean => RULES[event].when(s);

/** The session after `event`. Throws when the event may not happen now: app.ts asks can() first, or knows it may. */
export function step(s: Session, event: SessionEvent): Session {
  const rule: Rule = RULES[event];
  if (!rule.when(s)) throw new Error(`the window cannot take "${event}" while ${JSON.stringify(s)}`);
  return rule.then(s);
}
