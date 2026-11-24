import { invoke } from '@tauri-apps/api/core';
import { mount } from './about.ts';

/** Runs a Rust command. Tauri rejects with the Rust error's text itself; the backend rejects with an Error. */
const call = <T>(command: string, args?: Record<string, unknown>) =>
  invoke<T>(command, args).catch((e: unknown) => { throw e instanceof Error ? e : new Error(String(e)); });

await mount({
  version: () => call<string>('app_version'),
  check: () => call<void>('check_for_updates'),
}, document.querySelector<HTMLElement>('[data-about]')!);
