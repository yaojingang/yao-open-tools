# tokscr Privacy Policy

Effective date: May 12, 2026

tokscr is a local-first Chrome extension for capturing webpage screenshots.

## Data Collection

tokscr does not collect, sell, share, or transfer user data.

## Local Processing

Screenshots are generated locally in the browser. The extension may temporarily store generated screenshot blobs and basic metadata, such as title, URL, image size, and capture time, in the browser's local IndexedDB storage so the result preview page can display and export the screenshot.

## Network Transfer

tokscr does not upload screenshots, webpage content, URLs, browsing history, or personal information to any external server.

## Permissions

tokscr uses Chrome extension permissions only for its screenshot workflow:

- `activeTab`: access the current page when the user starts a capture.
- `scripting`: inject the helper used for scrolling, selected-area capture, and main-content detection.
- `downloads`: save exported files.
- `clipboardWrite`: copy screenshots to the clipboard.
- `offscreen`: compose screenshots and convert image blobs in a hidden extension page.
- `storage`: support local extension state.

## Contact

For privacy questions, contact the extension publisher through the Chrome Web Store listing.
