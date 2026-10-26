//! Nexus Blocks desktop shell.
//!
//! The WebView runs the same editor bundle as the browser build; this process
//! owns the things a browser sandbox cannot provide. Capabilities requested by
//! the language (`fs.read`, `fs.write`, ...) arrive through `capability_invoke`
//! and act on the real file system, with no sandboxed workspace root.

use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Output kept from a shell command per stream (UTF-8 bytes).

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostRequest {
    capability: String,
    #[serde(default)]
    args: Vec<Value>,
    /// Reserved for permission prompts and error attribution.
    #[serde(default)]
    #[allow(dead_code)]
    block_id: Option<String>,
}

fn ok(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

fn fail(message_key: &str) -> Value {
    json!({ "ok": false, "error": { "messageKey": message_key } })
}

fn string_arg(args: &[Value], index: usize) -> String {
    args.get(index)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Turn a block-supplied path into a real path: absolute paths are used as-is,
/// `~/…` and relative paths are resolved against the user's home directory.
fn resolve_path(raw: &str, home: &Path) -> Result<PathBuf, &'static str> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("runtime.error.filePath");
    }
    if text.chars().any(char::is_control) {
        return Err("runtime.error.filePath");
    }
    let path = Path::new(text);
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    let rest = text.strip_prefix("~/").or_else(|| text.strip_prefix('~'));
    if let Some(rest) = rest {
        let rest = rest.trim_start_matches(['/', '\\']);
        return Ok(if rest.is_empty() {
            home.to_path_buf()
        } else {
            home.join(rest)
        });
    }
    Ok(home.join(path))
}

fn map_io(error: &std::io::Error) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::NotFound => "runtime.error.fileNotFound",
        std::io::ErrorKind::PermissionDenied => "runtime.error.fileDenied",
        _ => "runtime.error.fileStorage",
    }
}

#[tauri::command]
fn capability_invoke(app: tauri::AppHandle, request: HostRequest) -> Value {
    let home = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    match request.capability.as_str() {
        "fs.read" => {
            let path = match resolve_path(&string_arg(&request.args, 0), &home) {
                Ok(path) => path,
                Err(key) => return fail(key),
            };
            match fs::read_to_string(&path) {
                Ok(text) => ok(json!(text)),
                Err(error) => fail(map_io(&error)),
            }
        }
        "fs.write" => {
            let text = string_arg(&request.args, 1);
            let path = match resolve_path(&string_arg(&request.args, 0), &home) {
                Ok(path) => path,
                Err(key) => return fail(key),
            };
            if let Some(parent) = path.parent() {
                if let Err(error) = fs::create_dir_all(parent) {
                    return fail(map_io(&error));
                }
            }
            // Write beside the target, then rename, so a failure never leaves a
            // half written file behind.
            let mut temp = path.clone();
            temp.set_extension("nexus-tmp");
            match fs::write(&temp, text).and_then(|_| fs::rename(&temp, &path)) {
                Ok(()) => ok(json!(true)),
                Err(error) => {
                    let _ = fs::remove_file(&temp);
                    fail(map_io(&error))
                }
            }
        }
        "fs.exists" => match resolve_path(&string_arg(&request.args, 0), &home) {
            Ok(path) => ok(json!(path.is_file())),
            Err(key) => fail(key),
        },
        "fs.delete" => {
            let path = match resolve_path(&string_arg(&request.args, 0), &home) {
                Ok(path) => path,
                Err(key) => return fail(key),
            };
            match fs::remove_file(&path) {
                Ok(()) => ok(json!(true)),
                Err(error) => fail(map_io(&error)),
            }
        }
        "fs.list" => {
            let raw = string_arg(&request.args, 0);
            let dir = if raw.trim().is_empty() {
                home.clone()
            } else {
                match resolve_path(&raw, &home) {
                    Ok(path) => path,
                    Err(key) => return fail(key),
                }
            };
            match fs::read_dir(&dir) {
                Ok(entries) => {
                    let mut names: Vec<String> = entries
                        .flatten()
                        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
                        .collect();
                    names.sort();
                    ok(json!(names))
                }
                Err(error) => fail(map_io(&error)),
            }
        }
        "os.exec" => {
            let command = string_arg(&request.args, 0);
            if command.trim().is_empty() {
                return fail("runtime.error.emptyCommand");
            }
            run_shell(&command)
        }
        _ => fail("runtime.error.capability"),
    }
}

/// Run `command` through the platform shell and capture both streams.
fn run_shell(command: &str) -> Value {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(command)
        .output();
    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            ok(json!({
                "stdout": stdout,
                "stderr": stderr,
                "code": output.status.code().unwrap_or(-1),
            }))
        }
        Err(_) => fail("runtime.error.commandFailed"),
    }
}

/// Extension used for project files written by the desktop shell.
const PROJECT_EXTENSION: &str = "nblk";

/// Strip path separators and control characters so a project name cannot
/// escape the directory the user picks.
fn file_stem(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' => '-',
            ch if ch.is_control() => '-',
            ch => ch,
        })
        .collect();
    let trimmed = cleaned.trim_matches(['.', ' ']).to_string();
    if trimmed.is_empty() {
        "nexus-blocks".to_string()
    } else {
        trimmed
    }
}

/// Append the project extension unless the suggestion already carries it.
fn file_name(raw: &str) -> String {
    let stem = file_stem(raw);
    if stem.ends_with(PROJECT_EXTENSION) {
        stem
    } else {
        format!("{stem}.{PROJECT_EXTENSION}")
    }
}

fn write_text(path: &Path, text: &str) -> Result<(), &'static str> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| map_io(&error))?;
        }
    }
    fs::write(path, text).map_err(|error| map_io(&error))
}

/// Ask for a destination and write the serialized document there.
///
/// Returns `Ok(None)` when the user cancels the native dialog. The WebView
/// cannot open a system save dialog, and WebKitGTK ignores `<a download>`, so
/// this is the only way "save" can actually produce a file.
#[tauri::command]
async fn project_save(app: tauri::AppHandle, content: String, suggested_name: String) -> Value {
    let name = file_name(&suggested_name);
    let picked = app
        .dialog()
        .file()
        .set_file_name(name)
        .add_filter("Nexus Blocks project", &["nblk"])
        .blocking_save_file();
    let Some(picked) = picked else {
        return ok(Value::Null);
    };
    let path = match picked.into_path() {
        Ok(path) => path,
        Err(_) => return fail("runtime.error.filePath"),
    };
    match write_text(&path, &content) {
        Ok(()) => ok(json!({ "path": path.to_string_lossy() })),
        Err(key) => fail(key),
    }
}

/// Ask for a project file and return its text; `None` when cancelled.
#[tauri::command]
async fn project_open(app: tauri::AppHandle) -> Value {
    let picked = app
        .dialog()
        .file()
        .add_filter("Nexus Blocks project", &["nblk"])
        .blocking_pick_file();
    let Some(picked) = picked else {
        return ok(Value::Null);
    };
    let path = match picked.into_path() {
        Ok(path) => path,
        Err(_) => return fail("runtime.error.filePath"),
    };
    match fs::read_to_string(&path) {
        Ok(text) => ok(json!({ "path": path.to_string_lossy(), "content": text })),
        Err(error) => fail(map_io(&error)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CliProcess(Mutex::new(None)))
        // Native file dialogs for project save/open: a WebView cannot show a
        // system file picker, and `<a download>` is ignored by WebKitGTK, so
        // "save" would silently do nothing without this plugin.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            capability_invoke,
            project_save,
            project_open,
            cli_status,
            cli_run,
            cli_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


/// The standalone interpreter process started by the editor, if any.
struct CliProcess(Mutex<Option<Child>>);

/// Find the standalone `nblk` executable: explicit override, next to the app,
/// then PATH. Returns None when the user has not installed it.
fn find_cli() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("NEXUS_NBLK") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["nblk", "nblk.exe"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in ["nblk", "nblk.exe"] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[tauri::command]
fn cli_status() -> Option<String> {
    find_cli().map(|path| path.display().to_string())
}

#[tauri::command]
fn cli_stop(state: State<'_, CliProcess>) -> bool {
    let child = state.0.lock().ok().and_then(|mut guard| guard.take());
    match child {
        Some(mut process) => process.kill().is_ok(),
        None => false,
    }
}

/// Run `.nblk` source in the standalone interpreter and stream its JSON events
/// to the WebView. Falls back to the in-process engine when `nblk` is missing.
#[tauri::command]
fn cli_run(
    app: AppHandle,
    state: State<'_, CliProcess>,
    source: String,
    locale: String,
    args: Vec<String>,
) -> Result<String, String> {
    let path = find_cli().ok_or_else(|| "cli.notFound".to_string())?;
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut previous) = guard.take() {
            let _ = previous.kill();
        }
    }
    let mut command = Command::new(&path);
    command.args(["--json", "-", "--lang", &locale, "--"]);
    command.args(&args);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(source.as_bytes());
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(child);
    }
    let app_handle = app.clone();
    std::thread::spawn(move || {
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let payload = serde_json::from_str::<Value>(&line)
                    .unwrap_or_else(|_| json!({ "kind": "raw", "text": line }));
                let _ = app_handle.emit("cli-event", payload);
            }
        }
        if let Some(err) = stderr {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                let _ = app_handle.emit("cli-event", json!({ "kind": "stderr", "text": line }));
            }
        }
        let _ = app_handle.emit("cli-exit", json!({}));
    });
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/home/tester")
    }

    #[test]
    fn shell_commands_capture_stdout_and_status() {
        let value = run_shell("printf 'hi'");
        assert_eq!(value["ok"], true);
        assert_eq!(value["value"]["stdout"], "hi");
        assert_eq!(value["value"]["code"], 0);

        let failed = run_shell("sh -c 'echo boom >&2; exit 3'");
        assert_eq!(failed["value"]["code"], 3);
        assert_eq!(failed["value"]["stderr"], "boom\n");
    }

    #[test]
    fn accepts_absolute_tilde_and_relative_paths() {
        assert_eq!(
            resolve_path("/tmp/notes.txt", &home()),
            Ok(PathBuf::from("/tmp/notes.txt"))
        );
        assert_eq!(
            resolve_path("~/notes.txt", &home()),
            Ok(PathBuf::from("/home/tester/notes.txt"))
        );
        assert_eq!(
            resolve_path("projects/demo.txt", &home()),
            Ok(PathBuf::from("/home/tester/projects/demo.txt"))
        );
    }

    #[test]
    fn sanitizes_project_names_into_file_stems() {
        assert_eq!(file_stem("  My project  "), "My project");
        assert_eq!(file_stem("a/b:c"), "a-b-c");
        assert_eq!(file_stem("..."), "nexus-blocks");
        assert_eq!(file_stem(""), "nexus-blocks");
        assert_eq!(file_stem("..hidden"), "hidden");
        assert_eq!(file_name("demo"), "demo.nblk");
        assert_eq!(file_name("demo.nblk"), "demo.nblk");
    }

    #[test]
    fn writes_the_project_file_into_a_missing_directory() {
        let dir = std::env::temp_dir().join(format!("nexus-save-{}", std::process::id()));
        let file = dir.join("nested").join("demo.nblk");
        assert_eq!(write_text(&file, "{}"), Ok(()));
        assert_eq!(fs::read_to_string(&file).unwrap(), "{}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_empty_or_control_paths() {
        assert_eq!(resolve_path("", &home()), Err("runtime.error.filePath"));
        assert_eq!(resolve_path("a\nb", &home()), Err("runtime.error.filePath"));
    }
}
