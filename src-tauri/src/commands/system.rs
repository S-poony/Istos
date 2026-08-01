//! Handing an entity to the operating system.
//!
//! These are the three things a file explorer is expected to be able to do to
//! anything it shows: open it, open it with a chosen application, and show it
//! where it lives. They are implemented with `std::process::Command` rather
//! than through a plugin so that the launch strategy for each platform is
//! visible and adjustable in one place — the correct incantation differs enough
//! per platform that one shared call would be a lie.
//!
//! Each command is `async`: all three touch the filesystem to check the path
//! before launching anything, and the threading rule in DESIGN.md keeps that
//! off the main thread. None of them holds a lock, so the futures are `Send` as
//! Tauri requires.

use log::{error, info};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Resolves the path a command was asked to act on.
///
/// Older builds persisted file paths with a trailing separator, which turns a
/// real file into a non-existent directory-like path. `move_entity_impl`
/// already recovers from this; opening has to do the same, or a trove written
/// by an older build has un-openable files in it.
fn resolve(raw: &str) -> Result<PathBuf, String> {
    let direct = PathBuf::from(raw);
    if direct.exists() {
        return Ok(direct);
    }

    let trimmed = raw.trim_end_matches(['/', '\\']);
    if !trimmed.is_empty() {
        let normalized = PathBuf::from(trimmed);
        if normalized.exists() {
            return Ok(normalized);
        }
    }

    Err(format!("This entity is no longer on disk: {}", raw))
}

/// Starts a launcher and reports only what actually happened: that it started.
///
/// Nothing here waits. The handler the OS picks is a separate, possibly
/// long-lived process, so blocking on it would hang the command for as long as
/// the user leaves the application open.
///
/// Exit status is deliberately never inspected — `explorer.exe` returns a
/// non-zero code even when it has done exactly what was asked, so reading one
/// would report a failure for a window the user is looking at.
fn launch(command: &mut Command) -> Result<(), String> {
    no_console(command);
    let program = command.get_program().to_string_lossy().into_owned();
    command.spawn().map(|_| ()).map_err(|e| {
        error!("Failed to launch {}: {}", program, e);
        format!("Could not start {}: {}", program, e)
    })
}

/// Keeps a console window from flashing up behind the thing the user asked for.
/// `rundll32` and friends are console subsystem programs; without this, every
/// "Open" blinks a black rectangle onto the screen.
#[cfg(target_os = "windows")]
fn no_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn no_console(_command: &mut Command) {}

// ---------------------------------------------------------------- open

#[cfg(target_os = "windows")]
fn launch_open(target: &Path) -> Result<(), String> {
    // `url.dll,FileProtocolHandler` takes the path as a single argument, so
    // there is no shell to quote for. `cmd /C start` would re-parse the string
    // and mangle any path containing `&` or `^`.
    launch(
        Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(target),
    )
}

#[cfg(target_os = "macos")]
fn launch_open(target: &Path) -> Result<(), String> {
    launch(Command::new("open").arg(target))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_open(target: &Path) -> Result<(), String> {
    launch(Command::new("xdg-open").arg(target))
}

/// Opens an entity with the system's default handler.
#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    let target = resolve(&path)?;
    info!("Opening {}", target.display());
    launch_open(&target)
}

// -------------------------------------------------------------- reveal

#[cfg(target_os = "windows")]
fn launch_reveal(target: &Path) -> Result<(), String> {
    // The comma is part of the switch, not a separator: `/select,<path>` has to
    // arrive as one argument or Explorer opens the parent and selects nothing.
    let mut selector = std::ffi::OsString::from("/select,");
    selector.push(target.as_os_str());
    launch(Command::new("explorer.exe").arg(selector))
}

#[cfg(target_os = "macos")]
fn launch_reveal(target: &Path) -> Result<(), String> {
    launch(Command::new("open").arg("-R").arg(target))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_reveal(target: &Path) -> Result<(), String> {
    // The freedesktop interface is the only one that can select an item. Where
    // it is unavailable, opening the containing directory is the closest
    // honest approximation.
    let uri = format!("file://{}", target.display());
    let dbus = launch(
        Command::new("dbus-send")
            .arg("--session")
            .arg("--dest=org.freedesktop.FileManager1")
            .arg("--type=method_call")
            .arg("/org/freedesktop/FileManager1")
            .arg("org.freedesktop.FileManager1.ShowItems")
            .arg(format!("array:string:{}", uri))
            .arg("string:"),
    );
    if dbus.is_ok() {
        return Ok(());
    }

    let parent = target
        .parent()
        .ok_or_else(|| "This entity has no containing directory".to_string())?;
    launch(Command::new("xdg-open").arg(parent))
}

/// Shows an entity in the system file manager, selected rather than opened.
#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let target = resolve(&path)?;
    info!("Revealing {}", target.display());
    launch_reveal(&target)
}

// ----------------------------------------------------------- open with

#[cfg(target_os = "windows")]
fn launch_open_with(target: &Path) -> Result<(), String> {
    launch(
        Command::new("rundll32.exe")
            .arg("shell32.dll,OpenAs_RunDLL")
            .arg(target),
    )
}

#[cfg(target_os = "macos")]
fn launch_open_with(target: &Path) -> Result<(), String> {
    // macOS has no command-line equivalent of the Windows "Open with" dialog,
    // so this drives the chooser AppleScript exposes.
    let script = format!(
        "set chosen to (choose application with title \"Open With\" \
         with prompt \"Choose an application to open this item:\")\n\
         tell application \"Finder\" to open (POSIX file \"{}\") using (chosen as alias)",
        target.display()
    );
    launch(Command::new("osascript").arg("-e").arg(script))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_open_with(_target: &Path) -> Result<(), String> {
    // No desktop-independent chooser exists. Saying so is better than silently
    // opening the default application, which is a different action from the one
    // the user asked for.
    Err("Choosing an application is not supported on this desktop".to_string())
}

/// Opens the system's "open with" chooser for an entity.
#[tauri::command]
pub async fn open_with(path: String) -> Result<(), String> {
    let target = resolve(&path)?;
    info!("Opening {} with a chosen application", target.display());
    launch_open_with(&target)
}

#[cfg(test)]
mod tests {
    use super::resolve;
    use std::fs;

    #[test]
    fn resolves_a_path_that_exists() {
        let dir = tempdir::TempDir::new("deskshell-open").unwrap();
        let file = dir.path().join("note.txt");
        fs::write(&file, "hello").unwrap();

        assert_eq!(resolve(file.to_str().unwrap()).unwrap(), file);
    }

    #[test]
    fn recovers_a_path_stored_with_a_trailing_separator() {
        let dir = tempdir::TempDir::new("deskshell-open").unwrap();
        let file = dir.path().join("note.txt");
        fs::write(&file, "hello").unwrap();

        let with_separator = format!("{}/", file.to_str().unwrap());
        assert_eq!(resolve(&with_separator).unwrap(), file);
    }

    #[test]
    fn refuses_a_path_that_is_gone() {
        let dir = tempdir::TempDir::new("deskshell-open").unwrap();
        let missing = dir.path().join("not-here.txt");

        let error = resolve(missing.to_str().unwrap()).unwrap_err();
        assert!(error.contains("no longer on disk"), "unexpected error: {error}");
    }
}
