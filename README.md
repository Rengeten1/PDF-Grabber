# Zen PDF Grabber

Batch-detect and download files (PDF and common document types) from the current page.
Works in Chrome and Firefox (MV3).

## Features
- Scan the active tab and detect downloadable files.
- Select specific files or use **Select All**.
- Batch-start downloads in one click.
- Copy selected file URLs.
- Cache the last scan for quick recovery on scan failures.

## Install (Local)

### Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Open a page with downloadable files and click the extension icon.

### Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` in this project folder.
4. Open a page with downloadable files and click the extension icon.

## Usage
1. Click **Scan**.
2. Select files.
3. Click **Download**.

## Build Package
Use this command from the project root:

```bash
rm -f grabber.zip && zip -r grabber.zip manifest.json popup.html popup.js content.js icon.png README.md LICENSE CHANGELOG.md
```

## Release Notes
- See [CHANGELOG.md](CHANGELOG.md).

## Roadmap
- Improve filename detection from response headers.
- Add optional export of detected links as CSV.
- Add simple filters by type (PDF, DOCX, XLSX, ZIP).

## Known Issues
- Browser-internal pages (`chrome://`, `about:`) cannot be scanned.
- Some protected viewer pages may hide true file URLs.

## Media
- Add screenshots/GIFs under `docs/media/`.
- A placeholder guide is available at `docs/media/README.md`.

## Legal
Only download files you are authorized to access and store.
