//! The app menu's "About Plaintask" and "Check for Updates…". About opens a small window of its own, as About windows
//! are on macOS, with its own page (about.html): the app's version and a Check for Updates button. Both checks open
//! Sparkle's update window (update.rs).

use tauri::menu::{Menu, MenuId, MenuItem};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

const WINDOW: &str = "about";
const ABOUT: &str = "about";
const CHECK: &str = "check-for-updates";

/// The stock menu, with its About item replaced by these two items.
pub fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let Some(app_menu) = menu.items()?.into_iter().next().and_then(|item| item.as_submenu().cloned()) else { return Ok(menu) };
    app_menu.remove_at(0)?;
    app_menu.insert(&MenuItem::with_id(app, CHECK, "Check for Updates…", true, None::<&str>)?, 0)?;
    app_menu.insert(&MenuItem::with_id(app, ABOUT, "About Plaintask", true, None::<&str>)?, 0)?;
    Ok(menu)
}

pub fn on_menu_event(app: &AppHandle, id: &MenuId) {
    let result = match id.as_ref() {
        ABOUT => open(app).map_err(|e| e.to_string()),
        CHECK => crate::update::check_now(app),
        _ => return,
    };
    if let Err(e) = result {
        eprintln!("plaintask: {} failed: {e}", id.as_ref());
    }
}

/// Shows the About window, opening it if it is not open.
fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.show()?;
        return window.set_focus();
    }
    WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("about.html".into()))
        .title("About Plaintask")
        .inner_size(300.0, 260.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .build()?;
    Ok(())
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}
