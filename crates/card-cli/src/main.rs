use card_cli::{check, describe, export, load, parse_args, Command, USAGE};
use std::process::ExitCode;

fn main() -> ExitCode {
    let command = match parse_args(std::env::args().skip(1)) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    // The PDF of an images document is built here, as the app builds it in its cache.
    let cache = std::env::temp_dir().join("gutterberg-cli");
    let (project, force) = match &command {
        Command::Help => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Command::Version => {
            println!("gutterberg-cli {}", env!("GUTTERBERG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Command::Export { project, force, .. } | Command::Check { project, force } => {
            (project, *force)
        }
    };
    let loaded = match load(project, force, &cache) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("error: {}", describe(&e));
            return ExitCode::FAILURE;
        }
    };
    for w in &loaded.warnings {
        eprintln!("warning: {w}");
    }
    match &command {
        Command::Check { .. } => match check(&loaded) {
            Ok(c) if c.problems.is_empty() => {
                println!(
                    "ok: an export writes {} sheet{}",
                    c.sheets,
                    if c.sheets == 1 { "" } else { "s" }
                );
                ExitCode::SUCCESS
            }
            Ok(c) => {
                for p in &c.problems {
                    eprintln!("error: {p}");
                }
                ExitCode::FAILURE
            }
            Err(e) => {
                eprintln!("error: {}", describe(&e));
                ExitCode::FAILURE
            }
        },
        Command::Export { output, .. } => match export(&loaded, output) {
            Ok(n) => {
                println!(
                    "wrote {n} sheet{} to {}",
                    if n == 1 { "" } else { "s" },
                    output.display()
                );
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("error: {}", describe(&e));
                ExitCode::FAILURE
            }
        },
        Command::Help | Command::Version => ExitCode::SUCCESS,
    }
}
