//! In-app updates through Sparkle 2. Sparkle.framework is bundled into Contents/Frameworks and reads the feed and the
//! public EdDSA key from Info.plist (`SUFeedURL`, `SUPublicEDKey`). Its Installer.xpc service replaces the bundle,
//! which the App Sandbox does not let the app do itself.
//!
//! The app checks at launch and every 24 hours with no window of Sparkle's. A newer version goes to the main window,
//! which offers it in a toast. The toast's Update and the menu's "Check for Updates…" open Sparkle's own window, which
//! downloads, verifies and installs. Sparkle then waits to restart the app until the main window calls
//! `restart_for_update`, which it does once the new-task form is closed.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Once;
use std::time::{Duration, SystemTime};

use sparkle_updater::{MainThreadMarker, RelaunchContinuation, SparkleUpdater, UpdateEvent, UpdaterConfig};
use tauri::{AppHandle, Emitter};

const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// How often the check thread looks at the clock. A sleeping Mac pauses the thread, so it compares wall-clock times.
const LOOK_EVERY: Duration = Duration::from_secs(60 * 60);
const MAIN_WINDOW: &str = "main";

thread_local! {
    /// Sparkle's objects live on the main thread only.
    static UPDATER: RefCell<Option<SparkleUpdater>> = const { RefCell::new(None) };
    /// True while a check with no window runs, so only what it finds becomes a toast.
    static QUIET_CHECK: Cell<bool> = const { Cell::new(false) };
    /// The restart Sparkle is waiting on.
    static RESTART: RefCell<Option<RelaunchContinuation>> = const { RefCell::new(None) };
}

/// Starts Sparkle. Call it on the main thread. Outside an app bundle (`tauri dev`) there are
/// no updates.
pub fn start(app: &AppHandle) {
    let Some(main_thread) = MainThreadMarker::new() else {
        eprintln!("plaintask: updates are off: Sparkle must start on the main thread");
        return;
    };
    let (events, restart) = (app.clone(), app.clone());
    let config = UpdaterConfig {
        event_callback: Some(Rc::new(move |event| on_event(&events, event))),
        relaunch_handler: Some(Rc::new(move |_update, continuation| {
            RESTART.with(|waiting| *waiting.borrow_mut() = Some(continuation));
            send(&restart, "update-restart", ());
        })),
        gentle_reminders: None,
    };
    match SparkleUpdater::new(main_thread, config) {
        Ok(Some(updater)) => UPDATER.with(|slot| *slot.borrow_mut() = Some(updater)),
        Ok(None) => {}
        Err(e) => eprintln!("plaintask: updates are off: {e}"),
    }
}

/// Starts the checks: one now, then one every 24 hours. The main window calls it through `ready`, once it is drawn
/// and listening, so the first check's finding reaches it. Later calls do nothing.
pub fn schedule_checks(app: &AppHandle) {
    static STARTED: Once = Once::new();
    let app = app.clone();
    STARTED.call_once(move || {
        std::thread::spawn(move || {
            let mut last: Option<SystemTime> = None;
            loop {
                if last.is_none_or(|at| at.elapsed().map_or(true, |since| since >= CHECK_EVERY)) {
                    last = Some(SystemTime::now());
                    if let Err(e) = app.run_on_main_thread(check_quietly) {
                        eprintln!("plaintask: the update check could not run: {e}");
                    }
                }
                std::thread::sleep(LOOK_EVERY);
            }
        });
    });
}

fn on_event(app: &AppHandle, event: UpdateEvent) {
    match event {
        UpdateEvent::DidFindValidUpdate(update) if QUIET_CHECK.get() => send(app, "update-available", update.version),
        UpdateEvent::DidFinishUpdateCycle(_) => QUIET_CHECK.set(false),
        _ => {}
    }
}

fn send<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(e) = app.emit_to(MAIN_WINDOW, event, payload) {
        eprintln!("plaintask: {event} could not reach the window: {e}");
    }
}

/// Reads the feed with no window. Offline, up to date, or with Sparkle's window already open, nothing shows.
fn check_quietly() {
    UPDATER.with(|slot| {
        let slot = slot.borrow();
        let Some(updater) = slot.as_ref() else { return };
        if updater.session_in_progress().unwrap_or(true) {
            return;
        }
        QUIET_CHECK.set(true);
        if let Err(e) = updater.check_for_update_information() {
            QUIET_CHECK.set(false);
            eprintln!("plaintask: the update check failed: {e}");
        }
    });
}

/// Opens Sparkle's window, which checks and offers what it finds: the menu's "Check for Updates…", the About window's
/// button and the toast's Update.
pub fn check_now(app: &AppHandle) -> Result<(), String> {
    app.run_on_main_thread(|| {
        UPDATER.with(|slot| match slot.borrow().as_ref() {
            Some(updater) => {
                QUIET_CHECK.set(false);
                if let Err(e) = updater.check_for_updates() {
                    eprintln!("plaintask: the update check failed: {e}");
                }
            }
            None => eprintln!("plaintask: updates need the built app"),
        })
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn check_for_updates(app: AppHandle) -> Result<(), String> {
    check_now(&app)
}

/// Lets Sparkle restart the app into the installed update.
#[tauri::command]
pub fn restart_for_update(app: AppHandle) -> Result<(), String> {
    app.run_on_main_thread(|| {
        let (Some(continuation), Some(main_thread)) = (RESTART.with(|waiting| waiting.borrow_mut().take()), MainThreadMarker::new()) else { return };
        continuation.resume(main_thread);
    })
    .map_err(|e| e.to_string())
}
