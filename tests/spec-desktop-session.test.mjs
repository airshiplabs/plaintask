// apps/desktop/src/session.ts against specs/DesktopSession.tla: TLC explores every state of the spec, and each
// transition it finds must be one session.ts makes. A rule changed on one side only fails here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { can, EVENTS, initial, step } from '../apps/desktop/src/session.ts';
import { conform } from '../specs/conform.mjs';

/** Each spec action, as the session events app.ts sends for it, in order. [] for a step of the queue alone. */
const ACTIONS = {
  FolderFound: ['folderFound'], FolderNone: ['folderNone'], FolderFailed: ['folderFailed'],
  FolderPicked: ['folderPicked'], Focus: ['focus'],
  OpenComposer: ['openComposer'], CloseComposer: ['closeComposer'], StartAdd: ['startAdd'],
  StartRename: ['startRename'], KeepRename: ['keepRename'], SaveRename: ['saveRename'], EditRow: [],
  Shown: ['shown'], LoadGone: ['gone'], LoadUnreadable: ['unreadable'],
  AddOk: [], AddFailed: ['addFailed'], AddGone: ['gone', 'addFailed'], AddSettled: ['addSaved'],
  RenameOk: [], RenameFailed: ['renameFailed'], RenameGone: ['gone', 'renameFailed'], RenameSettled: ['renameSaved'],
  RowOk: [], RowFailed: [], RowGone: ['gone'],
};

test('session.ts makes every transition of specs/DesktopSession.tla, and refuses the person\'s actions exactly where the spec does', { timeout: 120000 }, () => {
  const { states, checked } = conform({
    spec: 'DesktopSession',
    machine: { initial, step, can, events: EVENTS },
    variables: ['view', 'chosen', 'composer', 'adding', 'rename'],
    actions: ACTIONS,
    // An action the person takes is refused by can() alone, wherever the queue has room for what it asks.
    guarded: ['FolderPicked', 'Focus', 'OpenComposer', 'CloseComposer', 'StartAdd', 'StartRename', 'KeepRename', 'SaveRename'],
    room: state => state.queue.length < 3,
  });
  assert.ok(states > 1000 && checked > 1000, `the spec should explore over a thousand states: ${states} states, ${checked} transitions`);
});
