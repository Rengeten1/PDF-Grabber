# Changelog

All notable changes to PDF Down will be documented in this file.

## [1.2.1] - 2026-09-04

### Fixed
- **Moodle / iLearn File Resolution:** Fixed resolution failure for Moodle resource links (e.g., `mod/resource/view.php?id=858304` to `pluginfile.php/.../20260317_Exercice_Prime_Solution.pdf`).
- **Zero-Payload Header Inspection:** Implemented stream-aborted `fetch` with `AbortController`, preventing full multi-megabyte PDF body downloads during link resolution.
- **Uncapped LMS Background Resolution:** Removed the 20-file limit (`slice(0, 20)`); all course resources are now resolved in fast progressive chunks.
- **Moodle 4 DOM & Course Section Extraction:** Added deep activity card inspection (`.activity-item`, `.activity-grid`, `.activityiconcontainer`, `.activitybadge`), correctly extracting activity names, file types, and sizes even when icons and badges are in sibling elements.
- **Download Permissions & Fallback:** Added `<all_urls>` host permissions in `manifest.json` and resilient dual-mode downloader to prevent failed downloads with custom headers.
- **Direct Resource Page Detection:** Opening the extension directly on a Moodle `view.php` resource page now automatically detects and resolves the file.

## [1.2.0] - 2026-09-04

### Fixed
- **Filename Mangling:** Fixed critical bug where the domain and URL path was appended to downloaded filenames (e.g. `.pdfilearn.university.edu...`).
- **LMS / iLearn Performance:** Eliminated redundant in-page full GET downloads for direct files. Large files no longer double-download or choke browser tab memory.
- **Session Protection (403 Forbidden):** Attached `Referer` headers to download calls to prevent session drop/rejection on academic and university LMS servers.
- **False Positives:** Eliminated false detection of generic navigation words ("download", "file", "resource") across the web.
- **Domain Collisions:** Fixed regex flaw where `.zip` and `.mov` top-level domains were falsely classified as downloadable files.
- **Manifest Compatibility:** Lowered Firefox `strict_min_version` from `140.0` to `115.0` for broad compatibility across Zen Browser and Firefox ESR. Removed unsupported gecko manifest keys.
- **Icon Optimization:** Created optimized 16x16, 48x48, and 128x128 icons, reducing extension package size by over 98%.

### Added
- **Live Search Bar:** Search and filter detected files in real-time by title, domain, or URL.
- **Category Filter Tabs:** Filter files instantly by **All**, **PDF**, **Docs**, **Sheets**, **Zip**, and **Media** with dynamic count badges.
- **CSV Export:** One-click export of all discovered links with filenames and types as a `.csv` file.
- **Link Preview (Open in New Tab):** Direct `↗` button on each file item to preview documents in a new tab without downloading.
- **System Theme Auto-Detection:** Automatically synchronizes with system dark/light mode on startup while preserving manual toggle preferences.
- **Batch Download Throttling:** Bounded concurrent download queue with real-time download progress counters (`Downloading X of Y...`).
- **Deep Shadow DOM Support:** Recursive shadow root traversal to detect embedded documents inside nested Web Components.

## [1.1.1] - Earlier Release
- Initial MV3 implementation with basic detection and download capabilities.
