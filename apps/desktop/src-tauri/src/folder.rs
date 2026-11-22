//! The task folder the person chose, remembered across launches.
//!
//! In the App Sandbox the app may only reach a folder the person picked in an open panel, and only until it
//! quits. A security-scoped bookmark is macOS's record of that pick: stored in the app's own data folder, it
//! gives the same access back on the next launch.

use objc2::runtime::Bool;
use objc2_foundation::{NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const BOOKMARK_FILE: &str = "folder.bookmark";

/// Stores a bookmark for `folder` in `data_dir`, replacing any earlier one.
pub fn remember(data_dir: &Path, folder: &Path) -> Result<(), String> {
    let path = folder.to_str().ok_or_else(|| format!("{} is not a UTF-8 path", folder.display()))?;
    let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(path), true);
    let bookmark = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(NSURLBookmarkCreationOptions::WithSecurityScope, None, None)
        .map_err(|e| format!("macOS could not remember {}: {}", folder.display(), e.localizedDescription()))?;
    fs::create_dir_all(data_dir).and_then(|()| fs::write(data_dir.join(BOOKMARK_FILE), bookmark.to_vec()))
        .map_err(|e| format!("Could not save the folder choice in {}: {e}", data_dir.display()))
}

/// The remembered folder with access to it switched on, or None when no folder was chosen yet or macOS no longer
/// honours the bookmark (the folder was deleted, or the app's signature changed). The person then chooses again.
pub fn recall(data_dir: &Path) -> Result<Option<PathBuf>, String> {
    let file = data_dir.join(BOOKMARK_FILE);
    let bytes = match fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not read the folder choice in {}: {e}", file.display())),
    };
    let mut stale = Bool::NO;
    // SAFETY: `stale` is a valid, writable Bool for the length of the call, which is all the method requires.
    let resolved = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &NSData::with_bytes(&bytes),
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut stale,
        )
    };
    let url = match resolved {
        Ok(url) => url,
        Err(e) => {
            eprintln!("plaintask: the remembered folder is no longer reachable: {}", e.localizedDescription());
            return Ok(None);
        }
    };
    // SAFETY: the URL came from a security-scoped bookmark. Access stays on until the app quits, so there is no matching stop call.
    if !unsafe { url.startAccessingSecurityScopedResource() } {
        eprintln!("plaintask: macOS refused access to the remembered folder");
        return Ok(None);
    }
    let Some(path) = url.path() else { return Ok(None) };
    let folder = PathBuf::from(path.to_string());
    if stale.as_bool() {
        remember(data_dir, &folder)?; // macOS asks for a fresh bookmark when it marks one stale
    }
    Ok(Some(folder))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder under the system's temporary directory, removed when the test ends.
    struct Temp(PathBuf);
    impl Temp {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("plaintask-test-{}-{name}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Temp(fs::canonicalize(path).unwrap())
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn with_nothing_remembered_there_is_no_folder() {
        let data = Temp::new("folder-none");
        assert_eq!(recall(&data.0).unwrap(), None);
    }

    #[test]
    fn a_remembered_folder_is_recalled_on_the_next_launch() {
        let data = Temp::new("folder-data");
        let tasks = Temp::new("folder-tasks");
        remember(&data.0, &tasks.0).unwrap();
        assert_eq!(recall(&data.0).unwrap(), Some(tasks.0.clone()));
    }

    #[test]
    fn a_remembered_folder_that_was_deleted_is_forgotten_not_an_error() {
        let data = Temp::new("folder-data-gone");
        let tasks = Temp::new("folder-tasks-gone");
        remember(&data.0, &tasks.0).unwrap();
        fs::remove_dir_all(&tasks.0).unwrap();
        assert_eq!(recall(&data.0).unwrap(), None);
    }
}
