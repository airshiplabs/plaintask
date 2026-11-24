import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mount } from './app.ts';

/** Runs a Rust command. Tauri rejects with the Rust error's text itself; the Backend rejects with an Error. */
const call = <T>(command: string, args?: Record<string, unknown>) =>
  invoke<T>(command, args).catch((e: unknown) => { throw e instanceof Error ? e : new Error(String(e)); });

await mount({
  folder: () => call<string | null>('folder'),
  chooseFolder: () => call<string | null>('choose_folder'),
  read: () => call<string | null>('read_inbox'),
  write: text => call<void>('write_inbox', { text }),
  badge: count => call<void>('set_badge', { count }),
  onUpdate: async ({ offer, restart }) => {
    await listen<string>('update-available', e => offer(e.payload));
    await listen('update-restart', () => restart());
  },
  installUpdate: () => call<void>('check_for_updates'),
  restartForUpdate: () => call<void>('restart_for_update'),
});

// The window is hidden until the page is drawn. Frames only run once it is visible:
// the first is requested before layout, the second runs after that layout has been painted.
await invoke('ready');
requestAnimationFrame(() => requestAnimationFrame(() => { void invoke('first_frame'); }));
