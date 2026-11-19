# Handmark security review

Version 1.0.0 · reviewed 2026-11-17

Handmark draws on web pages, so it runs next to pages it does not control, some of them hostile. This review lists what an attacker could try and what stops it. Each item marked **Tested** is covered by the end-to-end tests in `tests/e2e.test.mjs` (`npm test`), which load the real extension into Chromium.

## What Handmark can access

| Permission | Why | Risk if misused |
|---|---|---|
| `activeTab` | Draw on the tab where you clicked the icon or pressed the shortcut | Access to that one tab until it navigates |
| `scripting` | Inject the drawing layer into that tab | Same as above |
| `storage`, `unlimitedStorage` | Keep drawings on your computer | Local data only |
| `sidePanel` | Show the controls in Chrome's side panel | None |
| `downloads` | Save screenshots to Downloads/Handmark | Could create files; rate-limited, fixed file names |
| `tabCapture` | Record an area of the tab, only after you choose an area | Chrome only allows it on a tab where you clicked the icon or pressed the shortcut |
| `offscreen` | Encode a recording in a hidden extension page | None; the page exists only while recording |
| `<all_urls>` (**optional**, off by default) | Only for "Show drawings automatically when I come back" | Script on every page; it only draws its own layer |

There is no `tabs`, `history`, `cookies`, `webRequest` or `clipboard` permission, no `externally_connectable` and no `web_accessible_resources`.

## Threats and mitigations

### 1. A page fakes input to draw, erase, clear or take screenshots
Pages can fire synthetic `KeyboardEvent`s and `PointerEvent`s. Every Handmark handler (canvas, keyboard, toolbar buttons, notice buttons) checks `event.isTrusted` and ignores anything that did not come from a real user. **Tested:** a page dispatching `c` (clear) and `f` (toggle) while Handmark was active changed nothing.

### 2. A page reads your drawings, notes or other sites' history
- The drawing layer sits in a **closed shadow root**. Page scripts cannot reach the canvas, the controls or the note input.
- Extension storage is locked to **trusted contexts** (`storage.local.setAccessLevel('TRUSTED_CONTEXTS')`). Content scripts, and therefore a compromised page renderer, cannot read it directly.
- A page gets its drawings by asking the service worker, which only returns records for addresses on the **same origin** as the requesting tab, and only accepts writes for that origin.
- Change notices broadcast to tabs contain only a short hash of the changed key, never addresses.

**Tested:** a script injected into `localhost` could not read or write `https://ok.example/b`, and direct `chrome.storage` access failed with "Access to storage is not allowed from this context".

### 3. Malicious backup files (import)
Imported files are untrusted input:
- 50 MB size limit and strict `JSON.parse`; the `app` and `version` fields must match.
- Every page and stroke is rebuilt field by field. Unknown fields are dropped, so a `__proto__` key cannot cause prototype pollution.
- URLs must be `http`, `https` or `file`, are normalised, and the storage key is recomputed from the URL instead of trusting the file.
- Colours must be `#RRGGBB`, numbers must be finite and within ±1,000,000, and there are caps on strokes per page, points per stroke, text length and title length.

**Tested** with a crafted file containing a `javascript:` URL, an HTML/`<script>` title and note, a named colour, an infinite coordinate, extra fields and `__proto__` keys:
- the `javascript:` page was rejected and the bad strokes were dropped
- no prototype pollution happened
- the title showed as plain text, with no `<img>` element created

### 4. Script injection through titles, notes or URLs (XSS)
No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval` anywhere in the extension. All UI is built with DOM methods, and page-derived strings (titles, URLs, notes) are set with `textContent` or drawn on a canvas with `fillText`. The extension pages use a strict CSP: `script-src 'self'; object-src 'none'; base-uri 'none'`.

### 5. Opening dangerous links from the saved-pages list
"Open" only works for `http:` and `https:` URLs, checked both in the page and in the service worker before `chrome.tabs.create`.

### 6. Messages from places they should not come from
Every `onMessage` handler requires `sender.id === chrome.runtime.id`, then checks the message type against a fixed list. Actions that target a tab (start, capture, resize) need either the tab itself or an extension page as sender, and the tab must be the active one. Web pages cannot message the extension at all (no `externally_connectable`).

### 7. Abuse by a compromised page (denial of service)
- Screenshots: one at a time, at least 2 s apart per tab; full-page height is capped (40 screens, 30,000 px).
- Window resize: only for the active tab, at most every 3 s, width clamped to 500–7680 px.
- Settings page: opened at most every 2 s.
- Storage: one page's record is capped at 5 MB, 5,000 marks and 20,000 points per mark.

### 7b. Screenshots and recordings
- Area selection, the Stop button and the editor only accept trusted input. A page cannot start a recording: the worker requires a real tab message, the active tab, a rate limit, and Chrome's own tabCapture rule that the user invoked Handmark on that tab.
- Captures are kept in the extension's IndexedDB (not readable by pages), pruned after a day, and only saved to disk when you choose. Only the offscreen recorder page may report a finished recording.

### 8. Keylogging concerns
The keyboard listener only runs while you have started Handmark on that tab. It ignores text fields, text areas, selects and editable content (including password fields), only reacts to its own shortcut keys, and never stores or sends what you type.

### 9. Fingerprinting and tracking
- No `web_accessible_resources`, so pages cannot detect Handmark by probing extension URLs.
- The note font is bundled and passed to the page as bytes, so there is no request to Google Fonts and no URL to probe.
- Handmark makes **no network requests** of its own: no analytics, no server, no account.
- Known, accepted leak: while Handmark is drawing on a page, that page can tell that *something* added an element to it, and after you use the text tool it can see a font named "Handmark Caveat". It cannot read your drawings.

### 10. Incognito
If you allow Handmark in incognito, nothing is saved there. The content script skips saving, and the service worker refuses writes from incognito tabs.

### 11. Supply chain
No third-party code, no build step, no remote code, no CDN. The only third-party asset is the Caveat font (SIL Open Font License, `extension/fonts/OFL.txt`).

## Pages Handmark cannot run on
Chrome blocks extensions on `chrome://` pages, the Chrome Web Store, other extensions' pages and the built-in PDF viewer. This is by design.

## Known limitations (not security issues)
- Drawings are pinned to page coordinates. If a site changes its layout, or you use a different window width, marks can drift. Handmark warns and offers "Match width".
- On apps that scroll inside a panel rather than the whole page (some web mail and docs apps), drawings follow the window, not the panel.
- Full-page screenshots repeat sticky headers on each screen.

## Reporting
If you find a security problem, please report it privately through GitHub's **Security → Report a vulnerability** on this repository instead of opening a public issue.
