#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod about;
mod folder;
mod inbox_file;
mod update;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const SHOW_ANYWAY_AFTER: Duration = Duration::from_secs(2);

#[derive(Default)]
struct TaskFolder(Mutex<Option<PathBuf>>);

impl TaskFolder {
    fn set(&self, folder: Option<PathBuf>) {
        *self.0.lock().expect("the task folder lock was poisoned") = folder;
    }
    fn get(&self) -> Result<PathBuf, String> {
        self.0.lock().expect("the task folder lock was poisoned").clone().ok_or_else(|| "No task folder is chosen yet.".to_string())
    }
}

/// True while scripts/measure-launch.mjs is timing a launch: the app then reports its milestones on stdout.
fn measuring() -> bool {
    std::env::var_os("PLAINTASK_MEASURE_LAUNCH").is_some()
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("The app has no data folder: {e}"))
}

#[tauri::command]
async fn folder(app: AppHandle, state: State<'_, TaskFolder>) -> Result<Option<String>, String> {
    let found = match std::env::var_os("PLAINTASK_ROOT") {
        Some(root) => Some(PathBuf::from(root)),
        None => folder::recall(&data_dir(&app)?)?,
    };
    state.set(found.clone());
    Ok(found.map(|path| path.display().to_string()))
}

#[tauri::command]
async fn choose_folder(app: AppHandle, window: tauri::WebviewWindow, state: State<'_, TaskFolder>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_parent(&window).set_title("Choose a folder for your tasks").set_can_create_directories(true).blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    folder::remember(&data_dir(&app)?, &path)?;
    state.set(Some(path.clone()));
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
async fn read_inbox(state: State<'_, TaskFolder>) -> Result<Option<String>, String> {
    inbox_file::read(&state.get()?)
}

#[tauri::command]
async fn write_inbox(state: State<'_, TaskFolder>, text: String) -> Result<(), String> {
    inbox_file::write(&state.get()?, &text)
}

#[tauri::command]
fn ready(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if measuring() {
        println!("ready");
    } else {
        update::schedule_checks(&app);
    }
    window.show().map_err(|e| e.to_string())
}

#[tauri::command]
fn first_frame(app: AppHandle) {
    if measuring() {
        println!("first-frame");
        app.exit(0);
    }
}

#[tauri::command]
fn set_badge(window: tauri::WebviewWindow, count: u32) -> Result<(), String> {
    window.set_badge_count((count > 0).then_some(i64::from(count))).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(TaskFolder::default())
        // A page whose script failed never calls `ready`. Show its window anyway, so the failure is a visible
        // broken page and not an app with no window.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let window = webview.window();
                std::thread::spawn(move || {
                    std::thread::sleep(SHOW_ANYWAY_AFTER);
                    if !window.is_visible().unwrap_or(false) {
                        window.show().expect("the main window could not be shown");
                    }
                });
            }
        })
        .setup(|app| {
            app.set_menu(about::menu(app.handle())?)?;
            update::start(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| about::on_menu_event(app, event.id()))
        .invoke_handler(tauri::generate_handler![folder, choose_folder, read_inbox, write_inbox, set_badge, ready, first_frame, about::app_version, update::check_for_updates, update::restart_for_update])
        .run(tauri::generate_context!())
        .expect("Plaintask could not start");
}
