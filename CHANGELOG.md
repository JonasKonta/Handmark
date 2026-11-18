# Changelog

## Unreleased

- Floating bar: a dotted drag handle on each end makes it clear how to move the bar. The yellow button still drags too.
- The custom colour button is now a rainbow wheel, so it no longer looks like one of the preset colours. When a custom colour is in use, it shows as a dot in the centre of the wheel.
- Arrows are smoothed into a clean curve; strength follows the Smooth setting (Off / Low / High). Start and end points stay put.
- The settings icon is now a gear (it looked like a light/dark mode switch).

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
