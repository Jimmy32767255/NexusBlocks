//! Nexus Blocks desktop shell.
//!
//! The WebView runs the same editor bundle as the browser build; this process
//! owns the things a browser sandbox cannot provide. Capabilities requested by
//! the language (`fs.read`, `fs.write`, ...) arrive through `capability_invoke`
//! and are resolved inside a single workspace directory chosen by the user.

use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Mirrors `MAX_FILE_CHARS` in `@nexus/engine`.
const MAX_FILE_CHARS: usize = 1_000_000;
const MAX_PATH: usize = 256;

struct AppState {
    root: Mutex<PathBuf>,
}

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

/// Workspace paths are relative, slash separated and free of traversal.
fn clean_relative(raw: &str) -> Result<PathBuf, &'static str> {
    let path = raw.trim().replace('\\', "/");
    if path.is_empty() || path.chars().count() > MAX_PATH {
        return Err("runtime.error.filePath");
    }
    if path.starts_with('/') {
        return Err("runtime.error.filePath");
    }
    let mut relative = PathBuf::new();
    for segment in path.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.chars().any(char::is_control)
        {
            return Err("runtime.error.filePath");
        }
        relative.push(segment);
    }
    Ok(relative)
}

/// Resolve `raw` inside `root`. Traversal is rejected lexically, then existing
/// paths (or their deepest existing parent) are checked against the canonical
/// root so a symlink cannot point the workspace at the rest of the disk.
fn resolve(root: &Path, raw: &str) -> Result<PathBuf, &'static str> {
    let relative = clean_relative(raw)?;
    let target = root.join(relative);
    let Ok(canonical_root) = fs::canonicalize(root) else {
        return Ok(target);
    };
    if let Ok(canonical_target) = fs::canonicalize(&target) {
        if !canonical_target.starts_with(&canonical_root) {
            return Err("runtime.error.fileDenied");
        }
        return Ok(target);
    }
    let mut probe = target.parent();
    while let Some(parent) = probe {
        if let Ok(canonical_parent) = fs::canonicalize(parent) {
            if !canonical_parent.starts_with(&canonical_root) {
                return Err("runtime.error.fileDenied");
            }
            break;
        }
        probe = parent.parent();
    }
    Ok(target)
}

fn map_io(error: &std::io::Error) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::NotFound => "runtime.error.fileNotFound",
        std::io::ErrorKind::PermissionDenied => "runtime.error.fileDenied",
        _ => "runtime.error.fileStorage",
    }
}

fn config_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("workspace.json"))
}

fn load_root(app: &tauri::AppHandle) -> PathBuf {
    if let Some(file) = config_file(app) {
        if let Ok(text) = fs::read_to_string(&file) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                if let Some(root) = value.get("root").and_then(Value::as_str) {
                    let path = PathBuf::from(root);
                    if path.is_dir() {
                        return path;
                    }
                }
            }
        }
    }
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("workspace"))
        .unwrap_or_else(|_| std::env::temp_dir().join("nexus-blocks-workspace"))
}

fn save_root(app: &tauri::AppHandle, root: &Path) {
    if let Some(file) = config_file(app) {
        if let Some(parent) = file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let text = json!({ "root": root.to_string_lossy() }).to_string();
        let _ = fs::write(file, text);
    }
}

#[tauri::command]
fn capability_invoke(state: tauri::State<'_, AppState>, request: HostRequest) -> Value {
    let root = match state.root.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => return fail("runtime.error.fileStorage"),
    };
    match request.capability.as_str() {
        "fs.read" => {
            let path = match resolve(&root, &string_arg(&request.args, 0)) {
                Ok(path) => path,
                Err(key) => return fail(key),
            };
            match fs::read_to_string(&path) {
                Ok(text) if text.chars().count() > MAX_FILE_CHARS => {
                    fail("runtime.error.fileTooLarge")
                }
                Ok(text) => ok(json!(text)),
                Err(error) => fail(map_io(&error)),
            }
        }
        "fs.write" => {
            let text = string_arg(&request.args, 1);
            if text.chars().count() > MAX_FILE_CHARS {
                return fail("runtime.error.fileTooLarge");
            }
            let path = match resolve(&root, &string_arg(&request.args, 0)) {
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
            let temp = path.with_extension("nexus-tmp");
            match fs::write(&temp, text).and_then(|_| fs::rename(&temp, &path)) {
                Ok(()) => ok(json!(true)),
                Err(error) => {
                    let _ = fs::remove_file(&temp);
                    fail(map_io(&error))
                }
            }
        }
        "fs.exists" => match resolve(&root, &string_arg(&request.args, 0)) {
            Ok(path) => ok(json!(path.is_file())),
            Err(key) => fail(key),
        },
        "fs.delete" => {
            let path = match resolve(&root, &string_arg(&request.args, 0)) {
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
                root.clone()
            } else {
                match resolve(&root, &raw) {
                    Ok(path) => path,
                    Err(key) => return fail(key),
                }
            };
            match fs::read_dir(&dir) {
                Ok(entries) => {
                    let mut names: Vec<String> = entries
                        .flatten()
                        .filter(|entry| entry.path().is_file())
                        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
                        .collect();
                    names.sort();
                    ok(json!(names))
                }
                Err(error) => fail(map_io(&error)),
            }
        }
        _ => fail("runtime.error.capability"),
    }
}

#[tauri::command]
fn workspace_get(state: tauri::State<'_, AppState>) -> Value {
    match state.root.lock() {
        Ok(root) => json!({ "path": root.to_string_lossy() }),
        Err(_) => json!({ "path": null }),
    }
}

#[tauri::command]
fn workspace_choose(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Value {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return json!({ "path": null });
    };
    let Ok(path) = folder.into_path() else {
        return json!({ "path": null });
    };
    if let Err(error) = fs::create_dir_all(&path) {
        return fail(map_io(&error));
    }
    if let Ok(mut root) = state.root.lock() {
        *root = path.clone();
    }
    save_root(&app, &path);
    json!({ "path": path.to_string_lossy() })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = load_root(app.handle());
            let _ = fs::create_dir_all(&root);
            app.manage(AppState { root: Mutex::new(root) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capability_invoke,
            workspace_get,
            workspace_choose
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nexus-blocks-test-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        for raw in ["", "..", "a/../../b", "/etc/passwd", "a//b", "a\nb"] {
            assert!(clean_relative(raw).is_err(), "expected {raw:?} to be rejected");
        }
        assert_eq!(clean_relative("notes/hello.txt").unwrap(), PathBuf::from("notes/hello.txt"));
    }

    #[test]
    fn resolves_inside_the_root_only() {
        let root = scratch();
        assert!(resolve(&root, "notes.txt").is_ok());
        assert_eq!(resolve(&root, "../notes.txt"), Err("runtime.error.filePath"));
        #[cfg(unix)]
        {
            let outside = std::env::temp_dir().join(format!("nexus-outside-{}", std::process::id()));
            fs::create_dir_all(&outside).unwrap();
            std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
            assert_eq!(resolve(&root, "escape/secret.txt"), Err("runtime.error.fileDenied"));
            fs::remove_dir_all(&outside).ok();
        }
        fs::remove_dir_all(&root).ok();
    }
}
