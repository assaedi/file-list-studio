# File List Studio — Expanded Feature Set

## Implemented

- Native Rust scanning with recursive folders and comma-separated excluded directory names and extensions.
- Per-job progress events and cancellation for scanning and hashing.
- Filesystem metadata: name, path, type, size, modified time, and creation time where the OS exposes it.
- Image metadata: dimensions, EXIF camera make/model, capture date, ISO, F-number, focal length, and thumbnail data URLs when supported by the image decoder.
- Media metadata through `ffprobe`: duration, bitrate, sample rate, channels, video width/height, album, and artist when available.
- On-demand MD5 and SHA-256 hashing with progress events.
- Project save/open using `.flsp` JSON files.
- CSV export and XLSX workbook export using the current filtered rows and visible columns.
- Arabic/English interface mode with localized primary labels and LTR/RTL direction switching.
- GitHub Actions Windows build producing NSIS and MSI installers.
- Explicit Tauri Windows icon configuration using `src-tauri/icons/icon.ico` and `icon.png`.

## External runtime note

The application invokes `ffprobe` for media metadata. The GitHub Actions build installs FFmpeg for the build environment, but a production Windows distribution should bundle or install FFmpeg/ffprobe if media metadata must work on machines that do not already have it on PATH.

## Code signing

Windows code signing requires a publisher-owned certificate and private key. The repository documents the requirement but does not contain a certificate or secret. Signing must be enabled in the release workflow after the publisher configures secure GitHub secrets and an approved signing command/action.

## Verification

The current source passes `cargo fmt --check`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `pnpm build`. A Linux Tauri debug DEB was also built successfully. Windows NSIS/MSI builds are configured for GitHub Actions.
