#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Local, SecondsFormat};
use exif::{In, Reader as ExifReader, Tag, Value};
use image::{DynamicImage, ImageFormat};
use md5::{Digest as Md5Digest, Md5};
use rust_xlsxwriter::Workbook;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::Sha256;
use std::{
    collections::HashSet,
    fs,
    io::{self, Cursor, Read},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::SystemTime,
};
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
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
    thumbnail: String,
    width: String,
    height: String,
    duration: String,
    bit_rate: String,
    sample_rate: String,
    channels: String,
    camera_make: String,
    camera_model: String,
    date_taken: String,
    iso: String,
    f_number: String,
    focal_length: String,
    latitude: String,
    longitude: String,
    album: String,
    artist: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResponse {
    entries: Vec<FileEntry>,
    errors: Vec<String>,
    cancelled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HashResult {
    path: String,
    md5: String,
    sha256: String,
    error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    job_id: String,
    current: usize,
    total: usize,
    stage: String,
    path: String,
    cancelled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFile {
    version: u32,
    entries: Vec<FileEntry>,
    visible_columns: Vec<String>,
    excluded_dirs: Vec<String>,
    excluded_extensions: Vec<String>,
}

#[derive(Clone)]
struct AppState {
    cancelled: Arc<Mutex<HashSet<String>>>,
}

fn is_cancelled(state: &Arc<Mutex<HashSet<String>>>, id: &str) -> bool {
    state.lock().map(|set| set.contains(id)).unwrap_or(false)
}
fn clear_job(state: &Arc<Mutex<HashSet<String>>>, id: &str) {
    if let Ok(mut set) = state.lock() {
        set.remove(id);
    }
}
fn format_time(time: Option<SystemTime>) -> String {
    time.map(|value| {
        let date: DateTime<Local> = value.into();
        date.to_rfc3339_opts(SecondsFormat::Secs, false)
    })
    .unwrap_or_default()
}
fn ext(path: &Path) -> String {
    path.extension()
        .map(|v| v.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}
fn text_exif(field: Option<&Value>) -> String {
    match field {
        Some(Value::Ascii(values)) => values
            .first()
            .map(|v| String::from_utf8_lossy(v).trim().to_string())
            .unwrap_or_default(),
        Some(value) => format!("{value:?}"),
        None => String::new(),
    }
}
fn thumbnail(path: &Path) -> String {
    let Ok(image) = image::open(path) else {
        return String::new();
    };
    let image: DynamicImage = image.thumbnail(180, 180);
    let mut bytes = Cursor::new(Vec::new());
    if image.write_to(&mut bytes, ImageFormat::Jpeg).is_ok() {
        format!(
            "data:image/jpeg;base64,{}",
            BASE64.encode(bytes.into_inner())
        )
    } else {
        String::new()
    }
}
fn ffprobe(path: &Path) -> (String, String, String, String, String, String, String) {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path.to_string_lossy(),
        ])
        .output();
    let Ok(output) = output else {
        return Default::default();
    };
    let Ok(json) = serde_json::from_slice::<JsonValue>(&output.stdout) else {
        return Default::default();
    };
    let format = json.get("format").cloned().unwrap_or_default();
    let streams = json
        .get("streams")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let stream = streams
        .iter()
        .find(|v| v.get("codec_type").and_then(|v| v.as_str()) == Some("audio"))
        .or_else(|| {
            streams
                .iter()
                .find(|v| v.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
        });
    let s = stream.cloned().unwrap_or_default();
    let duration = format
        .get("duration")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let bitrate = format
        .get("bit_rate")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let sample_rate = s
        .get("sample_rate")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let channels = s.get("channels").map(|v| v.to_string()).unwrap_or_default();
    let width = s.get("width").map(|v| v.to_string()).unwrap_or_default();
    let height = s.get("height").map(|v| v.to_string()).unwrap_or_default();
    let tags = s
        .get("tags")
        .or_else(|| format.get("tags"))
        .cloned()
        .unwrap_or_default();
    let album = tags
        .get("album")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let artist = tags
        .get("artist")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    (
        duration,
        bitrate,
        sample_rate,
        channels,
        width,
        height,
        format!("{}|{}", album, artist),
    )
}
fn entry_from_path(path: &Path) -> Result<FileEntry, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let is_dir = metadata.is_dir();
    let path_string = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_else(|| path_string.clone());
    let kind = if is_dir { "Folder".into() } else { ext(path) };
    let mut entry = FileEntry {
        id: path_string.clone(),
        name,
        modified: format_time(metadata.modified().ok()),
        created: format_time(metadata.created().ok()),
        kind: kind.clone(),
        size: if is_dir { 0 } else { metadata.len() },
        path: path_string,
        comments: String::new(),
        tags: String::new(),
        title: String::new(),
        md5: String::new(),
        sha256: String::new(),
        thumbnail: String::new(),
        width: String::new(),
        height: String::new(),
        duration: String::new(),
        bit_rate: String::new(),
        sample_rate: String::new(),
        channels: String::new(),
        camera_make: String::new(),
        camera_model: String::new(),
        date_taken: String::new(),
        iso: String::new(),
        f_number: String::new(),
        focal_length: String::new(),
        latitude: String::new(),
        longitude: String::new(),
        album: String::new(),
        artist: String::new(),
    };
    if !is_dir {
        if let Ok(file) = fs::File::open(path) {
            let mut reader = io::BufReader::new(file);
            if let Ok(exif) = ExifReader::new().read_from_container(&mut reader) {
                entry.camera_make =
                    text_exif(exif.get_field(Tag::Make, In::PRIMARY).map(|f| &f.value));
                entry.camera_model =
                    text_exif(exif.get_field(Tag::Model, In::PRIMARY).map(|f| &f.value));
                entry.date_taken = text_exif(
                    exif.get_field(Tag::DateTimeOriginal, In::PRIMARY)
                        .map(|f| &f.value),
                );
                entry.iso = text_exif(
                    exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY)
                        .map(|f| &f.value),
                );
                entry.f_number =
                    text_exif(exif.get_field(Tag::FNumber, In::PRIMARY).map(|f| &f.value));
                entry.focal_length = text_exif(
                    exif.get_field(Tag::FocalLength, In::PRIMARY)
                        .map(|f| &f.value),
                );
            }
        }
        if let Ok((w, h)) = image::image_dimensions(path) {
            entry.width = w.to_string();
            entry.height = h.to_string();
            entry.thumbnail = thumbnail(path);
        }
        let (duration, bitrate, sample, channels, w, h, tags) = ffprobe(path);
        if !duration.is_empty() {
            entry.duration = duration;
            entry.bit_rate = bitrate;
            entry.sample_rate = sample;
            entry.channels = channels;
            if entry.width.is_empty() {
                entry.width = w;
                entry.height = h;
            }
            let mut parts = tags.splitn(2, '|');
            entry.album = parts.next().unwrap_or_default().to_string();
            entry.artist = parts.next().unwrap_or_default().to_string();
        }
    }
    Ok(entry)
}

fn scan_blocking(
    paths: Vec<String>,
    recursive: bool,
    excluded_dirs: Vec<String>,
    excluded_extensions: Vec<String>,
    job_id: String,
    app: AppHandle,
    cancelled: Arc<Mutex<HashSet<String>>>,
) -> ScanResponse {
    let mut candidates = Vec::new();
    let excluded_dirs: HashSet<String> = excluded_dirs
        .into_iter()
        .map(|v| v.to_lowercase())
        .collect();
    let excluded_extensions: HashSet<String> = excluded_extensions
        .into_iter()
        .map(|v| v.trim_start_matches('.').to_lowercase())
        .collect();
    for raw in paths {
        let root = PathBuf::from(&raw);
        if !root.exists() {
            continue;
        }
        let walker = if root.is_dir() {
            let mut w = WalkDir::new(&root).min_depth(0);
            if !recursive {
                w = w.max_depth(1);
            }
            w.into_iter()
        } else {
            WalkDir::new(&root).max_depth(0).into_iter()
        };
        for result in walker.filter_entry(|item| {
            let p = item.path();
            !p.is_dir()
                || !excluded_dirs.contains(
                    &p.file_name()
                        .map(|v| v.to_string_lossy().to_lowercase())
                        .unwrap_or_default(),
                )
        }) {
            if let Ok(item) = result {
                let p = item.path().to_path_buf();
                if p.is_file() && excluded_extensions.contains(&ext(&p)) {
                    continue;
                }
                candidates.push(p);
            }
        }
    }
    let total = candidates.len();
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    let _ = app.emit(
        "scan-progress",
        Progress {
            job_id: job_id.clone(),
            current: 0,
            total,
            stage: "scanning".into(),
            path: String::new(),
            cancelled: false,
        },
    );
    for (index, path) in candidates.iter().enumerate() {
        if is_cancelled(&cancelled, &job_id) {
            let _ = app.emit(
                "scan-progress",
                Progress {
                    job_id: job_id.clone(),
                    current: index,
                    total,
                    stage: "cancelled".into(),
                    path: path.to_string_lossy().into(),
                    cancelled: true,
                },
            );
            break;
        }
        match entry_from_path(path) {
            Ok(entry) => entries.push(entry),
            Err(e) => errors.push(format!("{}: {e}", path.display())),
        };
        let _ = app.emit(
            "scan-progress",
            Progress {
                job_id: job_id.clone(),
                current: index + 1,
                total,
                stage: "scanning".into(),
                path: path.to_string_lossy().into(),
                cancelled: false,
            },
        );
    }
    let was_cancelled = is_cancelled(&cancelled, &job_id);
    clear_job(&cancelled, &job_id);
    ScanResponse {
        entries,
        errors,
        cancelled: was_cancelled,
    }
}

fn hash_one(
    path: &Path,
    job_id: &str,
    app: &AppHandle,
    cancelled: &Arc<Mutex<HashSet<String>>>,
    current: usize,
    total: usize,
) -> HashResult {
    let path_string = path.to_string_lossy().to_string();
    let result = (|| -> io::Result<(String, String)> {
        let mut file = fs::File::open(path)?;
        let mut md5_hasher = Md5::new();
        let mut sha_hasher = Sha256::new();
        let mut buffer = [0_u8; 1024 * 1024];
        loop {
            if is_cancelled(cancelled, job_id) {
                break;
            }
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            md5_hasher.update(&buffer[..read]);
            sha_hasher.update(&buffer[..read]);
        }
        Ok((
            hex::encode(md5_hasher.finalize()),
            hex::encode(sha_hasher.finalize()),
        ))
    })();
    let _ = app.emit(
        "hash-progress",
        Progress {
            job_id: job_id.into(),
            current,
            total,
            stage: "hashing".into(),
            path: path_string.clone(),
            cancelled: is_cancelled(cancelled, job_id),
        },
    );
    match result {
        Ok((md5, sha256)) => HashResult {
            path: path_string,
            md5,
            sha256,
            error: None,
        },
        Err(e) => HashResult {
            path: path_string,
            md5: String::new(),
            sha256: String::new(),
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
async fn scan_entries(
    paths: Vec<String>,
    recursive: bool,
    excluded_dirs: Vec<String>,
    excluded_extensions: Vec<String>,
    job_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScanResponse, String> {
    let cancelled = state.cancelled.clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan_blocking(
            paths,
            recursive,
            excluded_dirs,
            excluded_extensions,
            job_id,
            app,
            cancelled,
        )
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn cancel_scan(job_id: String, state: State<'_, AppState>) {
    if let Ok(mut set) = state.cancelled.lock() {
        set.insert(job_id);
    }
}
#[tauri::command]
async fn calculate_hashes(
    paths: Vec<String>,
    job_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<HashResult>, String> {
    let cancelled = state.cancelled.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let total = paths.len();
        let values = paths
            .iter()
            .enumerate()
            .map(|(i, p)| hash_one(Path::new(p), &job_id, &app, &cancelled, i + 1, total))
            .collect();
        clear_job(&cancelled, &job_id);
        values
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn cancel_hashes(job_id: String, state: State<'_, AppState>) {
    if let Ok(mut set) = state.cancelled.lock() {
        set.insert(job_id);
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    entries: Vec<FileEntry>,
    columns: Vec<String>,
    headers: Vec<String>,
}

fn export_value(entry: &FileEntry, column: &str) -> String {
    match column {
        "name" => entry.name.clone(),
        "modified" => entry.modified.clone(),
        "created" => entry.created.clone(),
        "kind" => entry.kind.clone(),
        "size" => entry.size.to_string(),
        "path" => entry.path.clone(),
        "comments" => entry.comments.clone(),
        "tags" => entry.tags.clone(),
        "title" => entry.title.clone(),
        "md5" => entry.md5.clone(),
        "sha256" => entry.sha256.clone(),
        "thumbnail" => entry.thumbnail.clone(),
        "width" => entry.width.clone(),
        "height" => entry.height.clone(),
        "duration" => entry.duration.clone(),
        "bitRate" => entry.bit_rate.clone(),
        "sampleRate" => entry.sample_rate.clone(),
        "channels" => entry.channels.clone(),
        "cameraMake" => entry.camera_make.clone(),
        "cameraModel" | "cameraModelName" => entry.camera_model.clone(),
        "dateTaken" => entry.date_taken.clone(),
        "iso" => entry.iso.clone(),
        "fNumber" => entry.f_number.clone(),
        "focalLength" => entry.focal_length.clone(),
        "latitude" => entry.latitude.clone(),
        "longitude" => entry.longitude.clone(),
        "album" => entry.album.clone(),
        "artist" | "authors" => entry.artist.clone(),
        _ => String::new(),
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[tauri::command]
fn export_csv(path: String, request: ExportRequest) -> Result<(), String> {
    if request.headers.len() != request.columns.len() {
        return Err("Headers and columns must have the same length".into());
    }
    let mut content = String::from("\u{FEFF}");
    content.push_str(
        &request
            .headers
            .iter()
            .map(|value| csv_escape(value))
            .collect::<Vec<_>>()
            .join(","),
    );
    content.push('\n');
    for entry in &request.entries {
        content.push_str(
            &request
                .columns
                .iter()
                .map(|column| csv_escape(&export_value(entry, column)))
                .collect::<Vec<_>>()
                .join(","),
        );
        content.push('\n');
    }
    fs::write(path, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_xlsx(path: String, request: ExportRequest) -> Result<(), String> {
    if request.headers.len() != request.columns.len() {
        return Err("Headers and columns must have the same length".into());
    }
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    for (col, header) in request.headers.iter().enumerate() {
        worksheet
            .write_string(0, col as u16, header)
            .map_err(|e| e.to_string())?;
    }
    for (row, entry) in request.entries.iter().enumerate() {
        for (col, column) in request.columns.iter().enumerate() {
            worksheet
                .write_string((row + 1) as u32, col as u16, &export_value(entry, column))
                .map_err(|e| e.to_string())?;
        }
    }
    workbook.save(path).map_err(|e| e.to_string())
}
#[tauri::command]
fn save_project(path: String, project: ProjectFile) -> Result<(), String> {
    let data = serde_json::to_string_pretty(&project).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}
#[tauri::command]
fn load_project(path: String) -> Result<ProjectFile, String> {
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            cancelled: Arc::new(Mutex::new(HashSet::new())),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_entries,
            cancel_scan,
            calculate_hashes,
            cancel_hashes,
            export_csv,
            export_xlsx,
            save_project,
            load_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running File List Studio");
}
fn main() {
    run();
}
