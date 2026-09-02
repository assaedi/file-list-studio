# File List Studio

File List Studio is a native Tauri 2 desktop application for creating structured lists of local files and folders. The frontend uses Vue 3 and TypeScript; filesystem scanning, hashing, and CSV saving are implemented as Rust commands.

## Run in development

Install Node.js, pnpm, Rust, and the Tauri system prerequisites for your operating system. Then run:

```bash
pnpm install
pnpm tauri dev
```

## Build a distributable application

```bash
pnpm install
pnpm tauri build
```

The application opens directly to the working file-list screen. Use **Choose folder** or drag files/folders into the drop zone, select whether subfolders should be included, filter/search the result, choose visible columns, edit name/comments/tags/title, calculate hashes explicitly, and export the current filtered view to CSV through the native save dialog.

## Metadata coverage

The initial Rust scan extracts the file name, modified date, creation date when the operating system exposes it, extension/kind, size, path, and empty editable comments/tags/title fields. MD5 and SHA-256 are calculated only after the user presses **Calculate hashes**, and only for files. Folder rows keep empty hash values.

The following optional columns are prepared in the interface but are not extracted in this version: Version, Pages, Authors / Artist, Album, Track No, Genre, Year, Duration, Audio BitRate, Audio Sample Rate, Audio Channels, Dimensions, Pixel Width, Pixel Height, Camera Make, Camera Model Name, Date Taken, ISO, FNumber, Focal Length, Latitude, Longitude, and Maps URL.

Individual access or read errors are collected and shown in the status area without terminating the whole scan or hash operation. Hashing is invoked one file at a time from the responsive frontend so progress is visible while Rust performs the actual reading and hashing work.

## Build for Windows

The current build environment is Linux, so the Windows installer is produced through the included GitHub Actions workflow at `.github/workflows/build-windows.yml`. Push the repository to GitHub, then open **Actions → Build Windows Desktop App → Run workflow**. The workflow runs on `windows-latest` and uploads both NSIS (`.exe`) and MSI (`.msi`) installers as an artifact. It also runs automatically for version tags such as `v0.1.0`.

Windows users need the WebView2 runtime, which is present by default on current Windows 10 and Windows 11 installations. The application itself does not require a server or account.
