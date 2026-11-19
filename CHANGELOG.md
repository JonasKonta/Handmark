# Changelog

## 1.1.0 (2026-11-19)

- New capture menu: **Full page**, **Visible window**, **Select an area** (`Ctrl+Shift+E`) and **Record an area** as video (`Ctrl+Shift+K`). Drawings, the laser and scrolling are included.
- New **editor** for captures: gradient, colour or transparent background; browser or window frame; aspect ratios (16:9, 4:3, 1:1, 4:5, 9:16); padding, corners and shadow; download PNG, copy, save original; styled video export (MP4 or WebM). The style is remembered.
- Setting **After a screenshot**: open the editor (default) or save straight away.
- Recording bar with Stop in the side panel and pop-up; a frame and Stop button on the page, kept outside the recorded area.
- New permissions: `tabCapture` (record the tab you choose) and `offscreen` (encode the recording in the background).
- 30 end-to-end checks.

## 1.0.0 (2026-11-17)

First release.

- Tools: marker brush with speed-based width, pen, highlighter, arrow with automatic head, text notes (Caveat, with Latin Extended), laser pointer, eraser, click-through.
- Line correction: stabiliser (Off / Low / High) and hold-to-straighten.
- Fade mode (3 / 5 / 8 s) for live use; fading marks are never saved.
- Controls in Chrome's side panel (default), a pop-up from the toolbar icon, or a floating bar on the page.
- Drawings saved per page, with cleaned addresses (tracking parameters removed). Saved pages list with previews, per-page "Keep drawings" switch, export/import, delete all.
- Optional "Show drawings automatically" with on-demand site access.
- Window-width check with "Match width".
- Screenshots of the visible area or the full page, with drawings.
- Undo, redo and clear page.
- Security hardening: storage locked to the extension with same-origin access through the service worker, trusted-input checks, closed shadow DOM, no `innerHTML`/`eval`, validated imports, rate limits, no network requests.
- Fix: pressing two shortcut keys quickly (e.g. a size, then a tool) could lose the second one; setting changes are now saved one at a time.
- MIT licence and a Chrome Web Store kit (listing text, screenshots, promo tiles).
- End-to-end test suite (20 checks).
