# Chrome Web Store Listing Draft

## Name

tokscr

## Summary

Capture, crop, and export full-page, visible-area, selected-area, and content screenshots to PNG, JPEG, PDF, clipboard, or print.

## Description

tokscr is a local-first webpage screenshot tool for Chrome.

Capture what you need:

- Full page: automatically scroll and stitch the entire webpage.
- Visible area: capture only what is currently visible in the browser.
- Selected area: drag to select a precise region on the page.
- Main-content cleanup: detect the primary content area and crop away navigation, sidebars, and page noise.
- Result-page crop: adjust the final screenshot with a draggable crop box before exporting.

Export the result:

- Save as PNG
- Save as JPEG
- Save as PDF
- Copy the screenshot to clipboard
- Print directly from the preview page

Privacy-first by design:

- Screenshots are generated locally in your browser.
- Screenshots are not uploaded to any server.
- tokscr only accesses the current tab when you actively start a capture.

## Category

Productivity

## Language

English

## Privacy Practices

Data collection: No user data collected.

Single-purpose statement:

tokscr captures screenshots of the current webpage at the user's request and lets the user crop, export, copy, or print the screenshot locally.

Permission justifications:

- activeTab: access the current page only after the user clicks a capture action.
- scripting: inject the capture helper used for page scrolling, main-content detection, and selected-area overlays.
- downloads: save exported PNG, JPEG, and PDF files.
- clipboardWrite: copy generated screenshots to the clipboard.
- offscreen: compose screenshots and convert image blobs in a hidden extension document.
- storage: temporarily store generated screenshots locally so the result preview page can load them.

Remote code: none.

User data handling:

Screenshots and metadata are processed locally in the browser. The extension does not transmit screenshots, page content, URLs, browsing history, or personal information to any external server.

## Store Assets

- Screenshot 1: `store-assets/screenshot-1-capture-modes.png`
- Screenshot 2: `store-assets/screenshot-2-result-workbench.png`
- Screenshot 3: `store-assets/screenshot-3-privacy.png`
- Small promo tile: `store-assets/promo-small-440x280.png`
- Extension package: `dist/tokscr-0.3.0.zip`
