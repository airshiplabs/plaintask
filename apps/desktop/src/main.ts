// main.ts - starts the app in its Tauri window: mounts the page on the Rust layer's commands (src-tauri/src/main.rs),
// asks for the window once the page is drawn, and reports the first painted frame.
import { invoke } from '@tauri-apps/api/core';
import { mount } from './app.ts';

await mount({
  folder: () => invoke<string | null>('folder'),
  chooseFolder: () => invoke<string | null>('choose_folder'),
  read: () => invoke<string>('read_inbox'),
  write: text => invoke<void>('write_inbox', { text }),
});

// The window is hidden until the page is drawn. Frames only run once it is visible:
// the first is requested before layout, the second runs after that layout has been painted.
await invoke('ready');
requestAnimationFrame(() => requestAnimationFrame(() => { void invoke('first_frame'); }));
