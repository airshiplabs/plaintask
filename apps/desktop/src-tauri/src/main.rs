// Plaintask desktop: a window onto one folder of Markdown task files.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod folder;
mod inbox_file;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// How long a loaded page gets to ask for its window before the window is shown anyway.
const SHOW_ANYWAY_AFTER: Duration = Duration::from_secs(2);

/// The task folder in use, once one is known.
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

/// The task folder's path, or null when the person has not chosen one (or macOS no longer honours the choice).
/// PLAINTASK_ROOT names a folder directly, for development and tests.
#[tauri::command]
async fn folder(app: AppHandle, state: State<'_, TaskFolder>) -> Result<Option<String>, String> {
    let found = match std::env::var_os("PLAINTASK_ROOT") {
        Some(root) => Some(PathBuf::from(root)),
        None => folder::recall(&data_dir(&app)?)?,
    };
    state.set(found.clone());
    Ok(found.map(|path| path.display().to_string()))
}

/// Asks the person for a folder and remembers it. Null when they cancel.
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
async fn read_inbox(state: State<'_, TaskFolder>) -> Result<String, String> {
    inbox_file::read(&state.get()?)
}

#[tauri::command]
async fn write_inbox(state: State<'_, TaskFolder>, text: String) -> Result<(), String> {
    inbox_file::write(&state.get()?, &text)
}

/// The page calls this when it has drawn itself. The window starts hidden, so no blank frame is ever shown.
#[tauri::command]
fn ready(window: tauri::WebviewWindow) -> Result<(), String> {
    if measuring() {
        println!("ready");
    }
    window.show().map_err(|e| e.to_string())
}

/// The page calls this once its first frame is painted. When a launch is being timed, the app quits here.
#[tauri::command]
fn first_frame(app: AppHandle) {
    if measuring() {
        println!("first-frame");
        app.exit(0);
    }
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
        .invoke_handler(tauri::generate_handler![folder, choose_folder, read_inbox, write_inbox, ready, first_frame])
        .run(tauri::generate_context!())
        .expect("Plaintask could not start");
}
