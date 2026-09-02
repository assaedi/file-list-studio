#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Local, SecondsFormat};
use md5::{Digest as Md5Digest, Md5};
use serde::Serialize;
use sha2::Sha256;
use std::{
    collections::HashSet,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    time::SystemTime,
};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
struct FileEntry {
    id: String,
    name: String,
    modified: String,
    created: String,
    kind: String,
    size: u64,
    path: String,
    comments: String,
    tags: String,
    title: String,
    md5: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
struct ScanResponse {
    entries: Vec<FileEntry>,
    errors: Vec<String>,
}

#[derive(Debug, Serialize)]
struct HashResult {
    path: String,
    md5: String,
    sha256: String,
    error: Option<String>,
}

fn format_time(time: Option<SystemTime>) -> String {
    time.map(|value| {
        let date: DateTime<Local> = value.into();
        date.to_rfc3339_opts(SecondsFormat::Secs, false)
    })
    .unwrap_or_default()
}

fn entry_from_path(path: &Path) -> Result<FileEntry, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let is_dir = metadata.is_dir();
    let path_string = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path_string.clone());
    let kind = if is_dir {
        "Folder".to_string()
    } else {
        path.extension()
            .map(|value| value.to_string_lossy().to_lowercase())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "file".to_string())
    };
    Ok(FileEntry {
        id: path_string.clone(),
        name,
        modified: format_time(metadata.modified().ok()),
        created: format_time(metadata.created().ok()),
        kind,
        size: if is_dir { 0 } else { metadata.len() },
        path: path_string,
        comments: String::new(),
        tags: String::new(),
        title: String::new(),
        md5: String::new(),
        sha256: String::new(),
    })
}

fn scan_entries_blocking(paths: Vec<String>, recursive: bool) -> ScanResponse {
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    let mut seen = HashSet::new();
    for raw_path in paths {
        let root = PathBuf::from(&raw_path);
        if !root.exists() {
            errors.push(format!("{}: path does not exist", raw_path));
            continue;
        }
        let walker = if root.is_dir() {
            let mut builder = WalkDir::new(&root).min_depth(0);
            if !recursive {
                builder = builder.max_depth(1);
            }
            builder.into_iter()
        } else {
            WalkDir::new(&root).max_depth(0).into_iter()
        };
        for result in walker {
            match result {
                Ok(item) => {
                    let item_path = item.path();
                    let key = item_path.to_string_lossy().to_string();
                    if !seen.insert(key) {
                        continue;
                    }
                    match entry_from_path(item_path) {
                        Ok(entry) => entries.push(entry),
                        Err(error) => errors.push(format!("{}: {}", item_path.display(), error)),
                    }
                }
                Err(error) => errors.push(error.to_string()),
            }
        }
    }
    entries.sort_by_key(|entry| entry.name.to_lowercase());
    ScanResponse { entries, errors }
}

fn calculate_one(path: &Path) -> HashResult {
    let path_string = path.to_string_lossy().to_string();
    let result = (|| -> io::Result<(String, String)> {
        let mut file = fs::File::open(path)?;
        let mut md5_hasher = Md5::new();
        let mut sha256_hasher = Sha256::new();
        let mut buffer = [0_u8; 1024 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            md5_hasher.update(&buffer[..read]);
            sha256_hasher.update(&buffer[..read]);
        }
        Ok((
            hex::encode(md5_hasher.finalize()),
            hex::encode(sha256_hasher.finalize()),
        ))
    })();
    match result {
        Ok((md5, sha256)) => HashResult {
            path: path_string,
            md5,
            sha256,
            error: None,
        },
        Err(error) => HashResult {
            path: path_string,
            md5: String::new(),
            sha256: String::new(),
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
async fn scan_entries(paths: Vec<String>, recursive: bool) -> Result<ScanResponse, String> {
    tauri::async_runtime::spawn_blocking(move || scan_entries_blocking(paths, recursive))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn calculate_hashes(paths: Vec<String>) -> Result<Vec<HashResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| calculate_one(Path::new(path)))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_csv(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_entries,
            calculate_hashes,
            save_csv
        ])
        .run(tauri::generate_context!())
        .expect("error while running File List Studio");
}

fn main() {
    run();
}
