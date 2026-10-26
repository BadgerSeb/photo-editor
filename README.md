# Photo Editor — Badger Metal & Machine Fabrication

A Photoshop-style picture editor that runs in the browser and installs as an app (PWA). It works
offline, and pictures never leave the computer. Plain ES modules, no build step, no CDN.

## Try it locally

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1      # then open http://localhost:8131/
```

## Tests

Both tests run in an invisible Edge with its own temporary profile and drive the app with
simulated mouse and keyboard input inside that Edge (never the real mouse, screen or clipboard).

```powershell
powershell -ExecutionPolicy Bypass -File tests\ui-test.ps1     # open, paint, layers, filter, undo, transform, text, save every format, reopen the PSD
powershell -ExecutionPolicy Bypass -File tests\tools-test.ps1  # every tool, Image/Layer/Select commands, every adjustment and filter
powershell -File tests\check-psd.ps1 some.psd                  # independent check of a PSD's structure
```

Screenshots and saved files land in `tests\out\` (not committed).

## Layout

| File | What it does |
| --- | --- |
| `index.html`, `css/app.css` | The page: band, menu bar, options bar, tools, canvas, panels, status bar. Always dark. |
| `js/app.js` | Menus, keyboard shortcuts, mouse handling on the canvas, open/save, dialogs. |
| `js/doc.js` | A document: layers, blending, copy-on-write undo history (memory-bounded). |
| `js/tools.js` | Every tool, brush engine, crop, Free Transform. |
| `js/selection.js` | Selection masks: shapes, magic wand, combine, feather, grow, marching-ants outline. |
| `js/ops.js` | Image size, canvas size, rotate/flip, layer commands, selection commands, clipboard. |
| `js/filters.js`, `js/filter-worker.js`, `js/adjust.js` | Adjustments and filters (run in a worker), their dialogs with live preview, the Curves editor. |
| `js/psd.js` | Reads and writes Photoshop files (layers, names, opacity, visibility, blend modes, lock). |
| `js/files.js` | Opening pictures (incl. TIFF and SVG) and writing PSD, PNG, JPEG, WebP, BMP, PDF. |
| `js/panels.js`, `js/view.js`, `js/dialogs.js`, `js/state.js`, `js/util.js` | Panels and tabs, the zoomable canvas, dialog building blocks, shared state, helpers. |
| `vendor/` | fflate (ZIP in PSD files, PDF compression) and UTIF (TIFF), with licenses. |
| `sw.js` | Offline copy of the app; `tools\stamp.ps1` writes its version and file list. |
| `tools/make-icons.ps1` | Draws the app icons. |

## Publishing

`publish.ps1 "What changed"` stamps a new version into `sw.js`, commits and pushes. It needs a
GitHub repository with Pages set up first; this one hasn't been created yet.
