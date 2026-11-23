import { invoke } from '@tauri-apps/api/core';
import { mount } from './app.ts';

await mount({
  folder: () => invoke<string | null>('folder'),
  chooseFolder: () => invoke<string | null>('choose_folder'),
  read: () => invoke<string | null>('read_inbox'),
  write: text => invoke<void>('write_inbox', { text }),
  badge: count => invoke<void>('set_badge', { count }),
});

// The window is hidden until the page is drawn. Frames only run once it is visible:
// the first is requested before layout, the second runs after that layout has been painted.
await invoke('ready');
requestAnimationFrame(() => requestAnimationFrame(() => { void invoke('first_frame'); }));
