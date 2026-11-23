// write-probe.rs - calls the app's own inbox_file::write on a folder, so a check can look at what a save
// does to the file itself (inode, extended attributes, dates, permissions, links) without the app's window.
//
//   rustc -O -o "$OUT/write-probe" .claude/skills/exploratory-qa/scripts/write-probe.rs
//   "$OUT/write-probe" <folder> '<new text of Inbox.md>'
//
// Prints the Result that write() returned. Build it outside the repo.
#[path = "../../../../apps/desktop/src-tauri/src/inbox_file.rs"]
#[allow(dead_code)]
mod inbox_file;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(folder), Some(text)) = (args.next(), args.next()) else {
        eprintln!("usage: write-probe <folder> <text>");
        std::process::exit(2);
    };
    println!("{:?}", inbox_file::write(std::path::Path::new(&folder), &text));
}
