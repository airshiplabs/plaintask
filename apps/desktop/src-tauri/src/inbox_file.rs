//! Inbox.md in the task folder: read it whole, replace it whole. What the text means is the page's business (src/inbox.ts).

use std::ffi::CString;
use std::fs;
use std::io::{self, Write};
use std::os::macos::fs::FileTimesExt;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
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
/// A symlinked Inbox.md stays a symlink. An existing file keeps its permissions, and, where the volume allows, its
/// owner, ACL, extended attributes (Finder tags among them) and creation date. A read-only, locked or hard-linked
/// file is refused and left as it is.
pub fn write(folder: &Path, text: &str) -> Result<(), String> {
    let named = folder.join(FILE_NAME);
    let target = fs::canonicalize(&named).unwrap_or(named);
    let dir = target.parent().ok_or_else(|| format!("{} has no folder", target.display()))?;
    let temp = dir.join(format!(".{FILE_NAME}.{}.tmp", std::process::id()));
    let existing = fs::metadata(&target).ok();
    if let Some(existing) = &existing {
        refuse_unless_replaceable(&target, existing)?;
    }

    let replace = || -> io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(text.as_bytes())?;
        if let Some(existing) = &existing {
            for missed in keep_metadata(&target, &temp, &file, existing.created()) {
                eprintln!("plaintask: saved {} without its {missed}", target.display());
            }
            fs::set_permissions(&temp, existing.permissions())?;
        }
        file.sync_all()?;
        fs::rename(&temp, &target)
    };
    replace().map_err(|e| {
        let _ = fs::remove_file(&temp); // may not exist; the write's own error is the one to report
        format!("Could not save {}: {e}", target.display())
    })
}

/// The rename gives the file a new inode, so a second name (a hard link) would keep the old text, and a file the
/// person cannot write to would be replaced anyway. Both are refused before anything is written.
fn refuse_unless_replaceable(target: &Path, existing: &fs::Metadata) -> Result<(), String> {
    if existing.nlink() > 1 {
        return Err(format!(
            "{} has a hard link, which a save would leave with the old text, so Plaintask will not change it. A symlink works.",
            target.display()
        ));
    }
    match fs::OpenOptions::new().write(true).open(target) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            Err(format!("{} is read-only or locked, so Plaintask will not change it.", target.display()))
        }
        Err(e) => Err(format!("Could not save {}: {e}", target.display())),
    }
}

/// Carries the old file's owner, ACL, extended attributes and creation date onto the new one, as far as the volume
/// allows. A volume without creation dates, extended attributes or ACLs does not stop the save: each part not kept
/// is returned for the log. The mode is the caller's, and a failure there does stop the save.
fn keep_metadata(from: &Path, to: &Path, to_file: &fs::File, created: io::Result<std::time::SystemTime>) -> Vec<String> {
    let mut missed = Vec::new();
    if let Err(e) = copy_metadata(from, to) {
        missed.push(format!("owner, ACL and extended attributes: {e}"));
    }
    if let Err(e) = created.and_then(|created| to_file.set_times(fs::FileTimes::new().set_created(created))) {
        missed.push(format!("creation date: {e}"));
    }
    missed
}

/// Copies the old file's mode, owner, ACL and extended attributes onto the new one (copyfile's COPYFILE_METADATA).
fn copy_metadata(from: &Path, to: &Path) -> io::Result<()> {
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    // SAFETY: both pointers are NUL-terminated paths that outlive the call; a null state is allowed.
    match unsafe { libc::copyfile(from.as_ptr(), to.as_ptr(), std::ptr::null_mut(), libc::COPYFILE_METADATA) } {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
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

    fn xattr(args: &[&str], path: &Path) -> String {
        let out = std::process::Command::new("xattr").args(args).arg(path).output().unwrap();
        assert!(out.status.success(), "xattr {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8(out.stdout).unwrap()
    }

    #[test]
    fn an_existing_file_keeps_its_extended_attributes() {
        let folder = Folder::new();
        let path = folder.0.join(FILE_NAME);
        fs::write(&path, "- [ ] One\n").unwrap();
        xattr(&["-w", "com.apple.metadata:_kMDItemUserTags", "(\"Important\")"], &path); // a Finder tag
        xattr(&["-w", "user.note", "keep"], &path);
        write(&folder.0, "- [x] One\n").unwrap();
        assert_eq!(xattr(&["-p", "com.apple.metadata:_kMDItemUserTags"], &path), "(\"Important\")\n");
        assert_eq!(xattr(&["-p", "user.note"], &path), "keep\n");
    }

    #[test]
    fn an_existing_file_keeps_its_creation_date() {
        let folder = Folder::new();
        let path = folder.0.join(FILE_NAME);
        fs::write(&path, "- [ ] One\n").unwrap();
        let created = fs::metadata(&path).unwrap().created().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        write(&folder.0, "- [x] One\n").unwrap();
        assert_eq!(fs::metadata(&path).unwrap().created().unwrap(), created);
    }

    #[test]
    fn metadata_the_volume_cannot_keep_is_reported_not_raised() {
        let folder = Folder::new();
        let to = folder.0.join("new.md");
        fs::write(&to, "- [x] One\n").unwrap();
        let file = fs::OpenOptions::new().write(true).open(&to).unwrap();
        let no_creation_dates = Err(io::Error::from(io::ErrorKind::Unsupported));
        let missed = keep_metadata(&folder.0.join("gone.md"), &to, &file, no_creation_dates);
        assert_eq!(missed.len(), 2, "both failures should be reported: {missed:?}");
        assert!(missed[0].starts_with("owner, ACL and extended attributes"), "{missed:?}");
        assert!(missed[1].starts_with("creation date"), "{missed:?}");
        assert_eq!(fs::read_to_string(&to).unwrap(), "- [x] One\n");
    }

    #[test]
    fn a_read_only_file_is_refused_and_left_alone() {
        let folder = Folder::new();
        let path = folder.0.join(FILE_NAME);
        fs::write(&path, "- [ ] One\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        let error = write(&folder.0, "- [x] One\n").unwrap_err();
        assert!(error.contains("read-only"), "the error should say why: {error}");
        assert_eq!(read(&folder.0).unwrap().as_deref(), Some("- [ ] One\n"));
        assert_eq!(folder.names(), [FILE_NAME], "no temporary file should be left behind");
    }

    #[test]
    fn a_hard_linked_file_is_refused_and_both_names_keep_the_text() {
        let folder = Folder::new();
        let path = folder.0.join(FILE_NAME);
        let other = folder.0.join("hardlink.md");
        fs::write(&path, "- [ ] One\n").unwrap();
        fs::hard_link(&path, &other).unwrap();
        let error = write(&folder.0, "- [x] One\n").unwrap_err();
        assert!(error.contains("hard link"), "the error should say why: {error}");
        assert_eq!(read(&folder.0).unwrap().as_deref(), Some("- [ ] One\n"));
        assert_eq!(fs::read_to_string(&other).unwrap(), "- [ ] One\n");
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
