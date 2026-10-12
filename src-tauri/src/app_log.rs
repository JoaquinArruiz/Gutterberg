//! The app's own log: what it did at start and, if it stopped, why. It exists so that "the app opens and closes"
//! can be diagnosed: a start that was never followed by `ready` died while starting, and a panic leaves its message
//! and a backtrace.
//!
//! One file, `gutterberg.log`, is added to across starts (so the record of a run that crashed is still there when the
//! app is opened again). It cannot fill the disk: a run writes at most `MAX_RUN_BYTES`, a file over `MAX_FILE_BYTES`
//! is moved to `gutterberg.old.log` at the next start (replacing the previous one), so the folder never holds more
//! than about half a megabyte. Nothing here ever panics or blocks the app: every failure to write is ignored.

use std::backtrace::Backtrace;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const FILE: &str = "gutterberg.log";
const OLD_FILE: &str = "gutterberg.old.log";
/// A log file over this size is rotated at the next start.
const MAX_FILE_BYTES: u64 = 256 * 1024;
/// What one run of the app may write in all.
const MAX_RUN_BYTES: usize = 64 * 1024;
/// The most "Copy log" hands over. GitHub accepts 65,536 characters in an issue, the rest of the form included.
pub const TAIL_CHARS: usize = 24_000;

struct Run {
    dir: PathBuf,
    written: usize,
}

static RUN: OnceLock<Mutex<Run>> = OnceLock::new();

/// Where the log lives: `~/Library/Logs/Gutterberg` on macOS, the app's `Gutterberg` data folder elsewhere.
pub fn dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        dirs::home_dir().map(|h| h.join("Library").join("Logs").join("Gutterberg"))
    } else {
        dirs::data_local_dir().map(|d| d.join("Gutterberg").join("logs"))
    }
}

/// Starts the log for this run and records panics. Call it once, after `data_dirs::migrate` (which must see the data
/// folder before anything creates it).
pub fn init() {
    let Some(dir) = dir() else { return };
    let _ = fs::create_dir_all(&dir);
    rotate(&dir);
    let _ = RUN.set(Mutex::new(Run { dir, written: 0 }));
    line(
        "start",
        &format!(
            "Gutterberg {} on {} {}",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        line("panic", &format!("{info}\n{}", Backtrace::force_capture()));
        default(info);
    }));
}

/// Adds one entry. Does nothing before `init`, or while another entry is being written (a panic while writing one
/// must not wait for itself).
pub fn line(level: &str, message: &str) {
    let Some(run) = RUN.get() else { return };
    let Ok(mut run) = run.try_lock() else { return };
    let text = entry(now(), level, message);
    let Run { dir, written } = &mut *run;
    append(dir, written, &text);
}

/// The end of the log (the previous file first when this one is short), at most `max_chars` characters and starting
/// on a whole line. Empty when there is no log.
pub fn read_tail(dir: &Path, max_chars: usize) -> String {
    let mut all = String::new();
    for name in [OLD_FILE, FILE] {
        if let Ok(bytes) = fs::read(dir.join(name)) {
            all.push_str(&String::from_utf8_lossy(&bytes));
        }
    }
    let count = all.chars().count();
    if count <= max_chars {
        return all;
    }
    let start = all
        .char_indices()
        .nth(count - max_chars)
        .map_or(0, |(i, _)| i);
    let tail = &all[start..];
    // Cut in the middle of a line? Drop that partial line.
    match tail.find('\n') {
        Some(i) if !all[..start].ends_with('\n') => tail[i + 1..].to_string(),
        _ => tail.to_string(),
    }
}

/// Moves a log file that has grown past the limit out of the way, replacing the previous old one.
fn rotate(dir: &Path) {
    let current = dir.join(FILE);
    if fs::metadata(&current).is_ok_and(|m| m.len() > MAX_FILE_BYTES) {
        let _ = fs::remove_file(dir.join(OLD_FILE));
        let _ = fs::rename(&current, dir.join(OLD_FILE));
    }
}

/// Appends `text`, never writing more than `MAX_RUN_BYTES` in a run; `written` counts what this run has written.
fn append(dir: &Path, written: &mut usize, text: &str) {
    if *written >= MAX_RUN_BYTES {
        return;
    }
    let room = MAX_RUN_BYTES - *written;
    let mut end = text.len().min(room);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let cut = end < text.len();
    let mut out = text[..end].to_string();
    if cut {
        out.push_str("\n(log limit for this run reached; the rest is not kept)\n");
    }
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(FILE))
    {
        if file.write_all(out.as_bytes()).is_ok() {
            *written = if cut {
                MAX_RUN_BYTES
            } else {
                *written + out.len()
            };
        }
    }
}

/// `2026-10-12 14:03:09Z  level  message`, with the lines after the first one indented so entries stay apart.
fn entry(secs: u64, level: &str, message: &str) -> String {
    let mut lines = message.trim_end().lines();
    let mut out = format!(
        "{}  {level:<5}  {}\n",
        utc(secs),
        lines.next().unwrap_or("")
    );
    for rest in lines {
        out.push_str("    ");
        out.push_str(rest);
        out.push('\n');
    }
    out
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Seconds since 1970 as `YYYY-MM-DD HH:MM:SSZ` (UTC), without a date library.
fn utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // Days since 1970-01-01 to a calendar date (Howard Hinnant's civil_from_days).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn scratch() -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "gutterberg-app-log-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn folder_bytes(dir: &Path) -> u64 {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().metadata().unwrap().len())
            .sum()
    }

    #[test]
    fn formats_utc_dates() {
        assert_eq!(utc(0), "1970-01-01 00:00:00Z");
        assert_eq!(utc(951_782_400), "2000-02-29 00:00:00Z"); // a leap day
        assert_eq!(utc(1_700_000_000), "2023-11-14 22:13:20Z");
        assert_eq!(utc(1_791_000_000), "2026-10-03 04:00:00Z");
    }

    #[test]
    fn an_entry_is_one_line_and_continuation_lines_are_indented() {
        let e = entry(0, "panic", "boom\nat a.rs:1\nat b.rs:2\n");
        assert_eq!(
            e,
            "1970-01-01 00:00:00Z  panic  boom\n    at a.rs:1\n    at b.rs:2\n"
        );
        assert_eq!(entry(0, "info", ""), "1970-01-01 00:00:00Z  info   \n");
    }

    #[test]
    fn the_log_is_added_to_across_starts_not_cleared() {
        let dir = scratch();
        let mut written = 0;
        append(&dir, &mut written, "first run\n");
        rotate(&dir); // the next start: a small file stays as it is
        let mut written = 0;
        append(&dir, &mut written, "second run\n");
        assert_eq!(
            fs::read_to_string(dir.join(FILE)).unwrap(),
            "first run\nsecond run\n"
        );
    }

    #[test]
    fn one_run_cannot_write_more_than_its_limit_and_says_so_once() {
        let dir = scratch();
        let mut written = 0;
        let line = "x".repeat(1_000) + "\n";
        for _ in 0..500 {
            append(&dir, &mut written, &line);
        }
        let text = fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(
            text.len() <= MAX_RUN_BYTES + 100,
            "wrote {} bytes",
            text.len()
        );
        assert_eq!(text.matches("log limit for this run reached").count(), 1);
    }

    #[test]
    fn never_cuts_a_character_in_half() {
        let dir = scratch();
        let mut written = MAX_RUN_BYTES - 3;
        append(&dir, &mut written, "ééééé"); // 2 bytes each: only one fits whole in 3 bytes
        let text = fs::read_to_string(dir.join(FILE)).expect("valid UTF-8");
        assert!(text.starts_with("é") && !text.starts_with("éé"));
    }

    #[test]
    fn a_big_file_is_rotated_and_the_folder_stays_small_however_often_the_app_starts() {
        let dir = scratch();
        let chunk = "y".repeat(60_000) + "\n";
        let mut peak = 0;
        for _ in 0..40 {
            rotate(&dir); // every start
            let mut written = 0;
            for _ in 0..5 {
                append(&dir, &mut written, &chunk); // a run that writes as much as it is allowed to
            }
            peak = peak.max(folder_bytes(&dir));
        }
        assert!(dir.join(OLD_FILE).exists());
        // Two files at most: one rotated at the limit, one being written.
        assert!(
            peak <= 2 * (MAX_FILE_BYTES + MAX_RUN_BYTES as u64),
            "folder reached {peak} bytes"
        );
    }

    #[test]
    fn a_small_file_is_not_rotated() {
        let dir = scratch();
        let mut written = 0;
        append(&dir, &mut written, "hello\n");
        rotate(&dir);
        assert!(dir.join(FILE).exists() && !dir.join(OLD_FILE).exists());
    }

    #[test]
    fn the_tail_is_the_end_of_the_log_from_a_whole_line_and_within_the_limit() {
        let dir = scratch();
        fs::write(dir.join(OLD_FILE), "old 1\nold 2\n").unwrap();
        fs::write(dir.join(FILE), "new 1\nnew 2\nnew 3\n").unwrap();
        assert_eq!(
            read_tail(&dir, 1_000),
            "old 1\nold 2\nnew 1\nnew 2\nnew 3\n"
        ); // short: all of it, old first
        let tail = read_tail(&dir, 14); // the last 14 characters start inside "new 1": that partial line is dropped
        assert!(tail.chars().count() <= 14);
        assert_eq!(tail, "new 2\nnew 3\n");
        assert_eq!(read_tail(&dir, 12), "new 2\nnew 3\n"); // the cut falls exactly between lines: nothing is dropped
        assert_eq!(read_tail(&scratch(), 100), ""); // no log at all
    }
}
