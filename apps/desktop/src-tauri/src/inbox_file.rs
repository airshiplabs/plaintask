//! Inbox.md in the task folder: read it whole, replace it whole. What the text means is the page's business (src/inbox.ts).

use std::fs;
use std::io::{self, Write};
use std::path::Path;

pub const FILE_NAME: &str = "Inbox.md";

/// The file's text, an empty string when the folder has no Inbox.md yet, or None when the folder itself is gone
/// (moved, renamed, deleted or unmounted). Both give NotFound; only the first is an empty Inbox.
pub fn read(folder: &Path) -> Result<Option<String>, String> {
    let path = folder.join(FILE_NAME);
    match fs::read(&path) {
        Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| {
            format!("{} is not UTF-8 text, so Plaintask will not change it.", path.display())
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => match fs::metadata(folder) {
            Ok(found) => Ok(found.is_dir().then(String::new)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("Could not read {}: {e}", path.display())),
        },
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

/// Replaces the file's text in one step: the new text goes to a temporary file beside it, which then takes its
/// place. A reader (an editor, a sync client) sees the old file or the new one, never half of either.
/// A symlinked Inbox.md stays a symlink, and an existing file keeps its permissions.
pub fn write(folder: &Path, text: &str) -> Result<(), String> {
    let named = folder.join(FILE_NAME);
    let target = fs::canonicalize(&named).unwrap_or(named);
    let dir = target.parent().ok_or_else(|| format!("{} has no folder", target.display()))?;
    let temp = dir.join(format!(".{FILE_NAME}.{}.tmp", std::process::id()));

    let replace = || -> io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        if let Ok(existing) = fs::metadata(&target) {
            fs::set_permissions(&temp, existing.permissions())?;
        }
        fs::rename(&temp, &target)
    };
    replace().map_err(|e| {
        let _ = fs::remove_file(&temp); // may not exist; the write's own error is the one to report
        format!("Could not save {}: {e}", target.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A fresh folder under the system's temporary directory, removed when the test ends.
    struct Folder(PathBuf);
    impl Folder {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!("plaintask-test-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&path).unwrap();
            Folder(path)
        }
        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.0).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
            names.sort();
            names
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o700));
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_folder_with_no_inbox_reads_as_empty_and_gets_no_file() {
        let folder = Folder::new();
        assert_eq!(read(&folder.0).unwrap().as_deref(), Some(""));
        assert!(folder.names().is_empty(), "reading must not create Inbox.md");
    }

    #[test]
    fn a_folder_that_is_gone_does_not_read_as_an_empty_inbox() {
        let gone = Folder::new().0.clone(); // the Folder is dropped at the end of this line, so its folder is removed
        assert!(!gone.exists(), "precondition: the folder should be gone");
        assert_eq!(read(&gone), Ok(None));
    }

    #[test]
    fn a_write_to_a_folder_that_is_gone_fails_and_does_not_recreate_it() {
        let parent = Folder::new();
        let gone = parent.0.join("Tasks");
        fs::create_dir(&gone).unwrap();
        fs::remove_dir(&gone).unwrap(); // removed between the read and the write
        let error = write(&gone, "- [ ] One\n").unwrap_err();
        assert!(error.contains(FILE_NAME), "the error should name the file: {error}");
        assert!(!gone.exists(), "the write must not recreate the folder");
        assert!(parent.names().is_empty(), "nothing should be written beside it: {:?}", parent.names());
    }

    #[test]
    fn a_folder_that_cannot_be_searched_is_an_error_not_an_empty_inbox_or_a_missing_folder() {
        let parent = Folder::new();
        let folder = parent.0.join("Tasks");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join(FILE_NAME), "- [ ] One\n").unwrap();
        fs::set_permissions(&parent.0, fs::Permissions::from_mode(0o000)).unwrap();
        let result = read(&folder);
        fs::set_permissions(&parent.0, fs::Permissions::from_mode(0o700)).unwrap();
        let error = result.unwrap_err();
        assert!(error.contains("Permission denied"), "the error should give the cause: {error}");
    }

    #[test]
    fn what_is_written_is_what_is_read_byte_for_byte() {
        let folder = Folder::new();
        let text = "\u{FEFF}# Inbox\r\n\r\n- [ ] Café run\r\n- [x] Done\n- [ ] no newline at the end";
        write(&folder.0, text).unwrap();
        assert_eq!(fs::read(folder.0.join(FILE_NAME)).unwrap(), text.as_bytes());
        assert_eq!(read(&folder.0).unwrap().as_deref(), Some(text));
    }

    #[test]
    fn a_write_leaves_only_inbox_md_in_the_folder() {
        let folder = Folder::new();
        write(&folder.0, "- [ ] One\n").unwrap();
        write(&folder.0, "- [x] One\n").unwrap();
        assert_eq!(folder.names(), [FILE_NAME], "no temporary file should be left behind");
        assert_eq!(read(&folder.0).unwrap().as_deref(), Some("- [x] One\n"));
    }

    #[test]
    fn a_file_that_is_not_utf8_is_refused_and_left_alone() {
        let folder = Folder::new();
        let bytes = [0xff, 0xfe, b'-', b' ', b'[', b' ', b']'];
        fs::write(folder.0.join(FILE_NAME), bytes).unwrap();
        let error = read(&folder.0).unwrap_err();
        assert!(error.contains("not UTF-8"), "the error should say why: {error}");
        assert_eq!(fs::read(folder.0.join(FILE_NAME)).unwrap(), bytes);
    }

    #[test]
    fn an_existing_file_keeps_its_permissions() {
        let folder = Folder::new();
        let path = folder.0.join(FILE_NAME);
        fs::write(&path, "- [ ] One\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        write(&folder.0, "- [x] One\n").unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn a_symlinked_inbox_stays_a_symlink_and_its_target_gets_the_text() {
        let folder = Folder::new();
        let elsewhere = Folder::new();
        let real = elsewhere.0.join("real.md");
        fs::write(&real, "- [ ] One\n").unwrap();
        std::os::unix::fs::symlink(&real, folder.0.join(FILE_NAME)).unwrap();
        write(&folder.0, "- [x] One\n").unwrap();
        assert!(fs::symlink_metadata(folder.0.join(FILE_NAME)).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "- [x] One\n");
    }

    #[test]
    fn a_folder_that_cannot_be_written_to_gives_an_error_that_names_the_file() {
        let folder = Folder::new();
        fs::write(folder.0.join(FILE_NAME), "- [ ] One\n").unwrap();
        fs::set_permissions(&folder.0, fs::Permissions::from_mode(0o500)).unwrap();
        let error = write(&folder.0, "- [x] One\n").unwrap_err();
        assert!(error.contains(FILE_NAME), "the error should name the file: {error}");
        assert_eq!(read(&folder.0).unwrap().as_deref(), Some("- [ ] One\n"), "the file should be as it was");
    }
}
