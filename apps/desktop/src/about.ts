// The About window: the app's name and version, and a button that opens the app's update window. Like app.ts it
// knows nothing of Tauri: everything outside the page comes through the AboutBackend it is mounted with.

export interface AboutBackend {
  /** The running app's version, such as "0.2.0". */
  version(): Promise<string>;
  /** Opens the app's update window, which checks the release feed and offers what it finds. */
  check(): Promise<void>;
}

const P = window.Plaintask;
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function mount(backend: AboutBackend, root: HTMLElement): Promise<void> {
  root.innerHTML = '<img class="about__icon" src="icon.png" alt="" width="96" height="96"><h1 class="about__name">Plaintask</h1>' +
    '<p class="about__version" data-version></p><div class="about__button" data-button>' + P.Button({ label: 'Check for Updates' }) + '</div>' +
    '<p class="about__status" role="status" aria-live="polite" data-status></p>';
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  root.querySelector('[data-button] .pt-btn')!.addEventListener('click', () => {
    status.textContent = '';
    backend.check().catch((e: unknown) => { status.textContent = 'Could not check for updates: ' + reason(e); });
  });
  root.querySelector<HTMLElement>('[data-version]')!.textContent = 'Version ' + await backend.version();
}
