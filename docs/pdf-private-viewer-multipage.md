# Private PDF viewer — multipage (staging proposal)

## Problem
The existing in-app `iframe` PDF reader can display only the first page of a PDF in an iPhone PWA. The earlier viewer fix intentionally kept users inside Freya when opening private documents; this behavior must remain.

## Implementation
- `domain/pdf-viewer.mjs` uses **PDF.js 4.10.38**, pinned in package and lockfile, copied with its matching worker by `scripts/package-pages.mjs`.
- The service worker precaches the two PDF.js resources and the reader module for cold offline use. This is application code, not the private document content.
- Existing `openDocument` authorization flow is preserved: private signed Storage URL online, or a user-scoped encrypted local Blob offline. No new database objects, public document endpoints or third-party document uploads.
- For PDFs only, `showDocumentViewer` mounts one canvas page at a time with previous/next and zoom. Image handling and return navigation are unchanged.
- Closing the viewer aborts pending fetches and render tasks, revokes temporary Blob URLs and releases PDF worker state. Renders are token-guarded and canvas buffers capped at five million pixels.

## Verification
- `node --test scripts/pdf-viewer.test.mjs`: paging, zoom, bounded canvases, Blob URL, cancellation and local asset contract.
- Existing `scripts/offline-v2-readonly.test.mjs`, `scripts/app-entries.test.mjs` and `scripts/check-travel-book-runtime-browser.mjs`: updated to preserve cache, private document and offline parking invariants.
- `scripts/check-pdf-browser.mjs`: actual three-page synthetic PDF via the shipped PDF.js engine and worker in a Chromium mobile-sized browser, including zoom and an offline Blob source.
- GitHub PR CI runs build, regression suites, Pages packaging/parity and both browser suites. Physical iOS/Safari has **not** yet been verified.

## Release gate
This PR is **not a PROVES deployment or a production release**. Do not merge to main or activate the public GitHub Pages workflow from this change until the isolated Freya PROVES frontend is configured and an iPhone PWA test confirms:
1. Real previously uploaded multipage PDF allows pages 1 through N and zoom.
2. Encrypted offline copy remains readable with airplane mode and a valid local offline grant.
3. Closing returns to the correct section; switching documents, trips or accounts does not reuse stale canvases.
4. Images, private access, activity documents, accommodation vouchers and parking documents remain functional.

The separate simplification of Documents explanatory copy is not part of this bug fix.
