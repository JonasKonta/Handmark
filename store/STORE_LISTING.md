# Chrome Web Store listing

Copy and paste these into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) when you upload `handmark.zip`.

## Before you start
1. Sign in with the Google account you want to publish under and register as a developer (one-time registration fee; the dashboard shows the current amount).
2. Fill in the publisher profile, including a contact email. Google requires it; it can be shown to users.
3. Build the package: `npm run zip`, which creates `handmark.zip` from the `extension` folder.
4. Put `PRIVACY.md` somewhere public with a stable URL. The GitHub link to the file in your public repo works, e.g. `https://github.com/<you>/handmark/blob/main/PRIVACY.md`.

---

## Store listing tab

**Item name** (from the manifest)
> Handmark

**Summary** (max 132 characters; from the manifest description)
> Draw on any webpage like it's paper: hand-drawn marker, arrows, highlighter, notes and a laser pointer. Drawings stay on the page.

**Description**
> Point, circle and scribble on any webpage while you record or present, with marks that look hand-drawn instead of like a mouse.
>
> Handmark puts a drawing layer over the page you're on. Circle the button you're talking about, draw an arrow to the line that matters, write a quick note in your own handwriting style. It feels like marking up paper, and it looks that way on camera.
>
> BUILT FOR RECORDING AND TEACHING
> • Controls live in Chrome's side panel, so they never cover the page and stay out of your shot
> • Laser pointer: a glowing trail that disappears on its own and is never saved
> • Fade mode: new marks melt away after 3, 5 or 8 seconds, so you can keep talking without stopping to clean up
> • Or use a floating bar you can drag anywhere on the page, or a pop-up from the toolbar icon
>
> MARKS THAT LOOK HAND-DRAWN
> • Felt-tip marker that thins slightly when you move fast
> • Arrows that draw their own heads and smooth into clean curves
> • See-through highlighter that blends with the text underneath
> • Handwritten notes (accents and diacritics included)
> • Pen for precise lines, eraser for whole marks
> • Four colours plus a colour wheel for any colour, in three sizes
>
> STEADY HANDS NOT REQUIRED
> • The Smooth setting takes the wobble out of lines and handwriting
> • Pause at the end of a stroke and it snaps straight, still with a hand-drawn edge
> • Undo, redo and clear page
>
> YOUR MARKS STAY PUT
> • Drawings save automatically and come back when you reopen the page, weeks later too
> • Saved pages list with previews, plus export and import for backups
> • Screenshots of the visible area or the full page, drawings included
>
> PRIVATE BY DESIGN
> • No account, no server, no analytics: Handmark never makes a network request
> • Everything stays on your computer, and nothing is saved in incognito
> • Open source (MIT)
>
> QUICK KEYS
> Alt+Shift+D to start · F drawing on/off · B marker · A arrow · H highlighter · T text · L laser · E eraser · G fade · S smooth · Esc to click the page

**Category**
> Tools

**Language**
> English

**Graphic assets** (all in this folder)
| Field | File |
|---|---|
| Store icon (128×128) | `extension/icons/icon-128.png` |
| Screenshots (1280×800) | `store/screenshots/1-draw-on-any-page.png`, `2-side-panel.png`, `3-saved-pages.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |
| Marquee promo tile (1400×560, optional) | `store/promo-marquee-1400x560.png` |

Regenerate the images after UI changes with `npm run store-assets`.

**Official URL / Homepage URL**
> Your GitHub repository URL.

**Support URL**
> `https://github.com/<you>/handmark/issues`

---

## Privacy practices tab

**Single purpose description**
> Handmark lets users draw and write notes on web pages, and keeps those drawings so they reappear when the user returns to the page.

**Permission justifications**

| Permission | Justification |
|---|---|
| `activeTab` | Gives Handmark access only to the tab where the user clicks the Handmark icon or presses its shortcut, so it can show the drawing layer there. |
| `scripting` | Injects the drawing layer into the tab the user started Handmark on. |
| `storage` | Saves the user's drawings and settings locally in the browser. |
| `unlimitedStorage` | Users can keep drawings on many pages; this prevents saved drawings from hitting the default storage limit. All data stays on the device. |
| `sidePanel` | Shows Handmark's drawing tools in Chrome's side panel so they don't cover the page. |
| `downloads` | Saves screenshots of the page with the user's drawings to the Downloads folder when the user asks for one. |
| Host permission `<all_urls>` (optional) | Off by default. Requested only if the user turns on "Show drawings automatically when I come back", so saved drawings can appear as soon as a page opens. Handmark only draws its own layer and never reads, changes or transmits page content. |

**Remote code**
> No, I am not using remote code. (All code is in the package; no external scripts, no `eval`.)

**Data usage**: tick **none** of the data types. Handmark does not collect or transmit any user data. Page addresses, titles and drawings are stored only locally on the user's device and never leave it.

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**
> The public URL of `PRIVACY.md` (see "Before you start").

---

## Distribution tab
- **Visibility:** Public (or Unlisted to share a link first and test).
- **Regions:** All regions.
- **Pricing:** Free.

## After submitting
- Review usually takes a few days. Extensions that request broad host access can take longer; Handmark's is optional, which helps.
- For every update: raise `version` in `extension/manifest.json`, add a line to `CHANGELOG.md`, run `npm test`, `npm run zip`, and upload the new zip on the **Package** tab.
