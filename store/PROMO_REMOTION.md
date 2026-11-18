# Handmark: 15-second promo video (Remotion brief)

Instructions for building a 15-second promo video for Handmark in [Remotion](https://www.remotion.dev).
Hand this file to whoever builds it, person or AI. Everything on screen is recreated in code: no screen recordings.

**Audience:** people who record screens (YouTube tutorials, Loom, product demos) and teachers/presenters.
**Message:** draw on any webpage, it looks hand-drawn, and the controls stay out of your shot.
**Tone:** calm and crafted. Paper-like and tactile, with unhurried motion. Music and small sound effects only, no voiceover.

---

## 1. Specs

| | |
|---|---|
| Composition ID | `HandmarkPromo` |
| Size | 1920 × 1080 (16:9) |
| Frame rate | 30 fps |
| Duration | 450 frames (15.0 s) |
| Output | H.264 MP4 (`npx remotion render HandmarkPromo out/handmark-promo.mp4`) |
| Safe area | Keep text at least 96 px from every edge |

Only show features the extension really has. Everything in this brief is in the current build.

---

## 2. Brand kit

Take these from the extension so the video matches the product.

**Colours**
| Token | Hex | Use |
|---|---|---|
| `yellow` | `#FFC702` | Main marker colour, accents, the yellow button |
| `cream` | `#F6F0E2` | Paper background, light text on dark |
| `ink` | `#141312` | End card background, dark text |
| `orange` | `#FA4101` | Second marker colour, sparingly |
| `barBg` | `rgba(27,26,24,.96)` | Toolbar / side panel background |
| `barBorder` | `#3c3a35` | Toolbar border, dividers |
| `muted` | `#d9d2c2` | Secondary text on dark |

**Type**
- **Wordmark:** Georgia italic, as in `store/make-assets.mjs`.
- **Handwritten notes:** Caveat 700. Use the font files in `extension/fonts/` (`caveat-700-latin.woff2`, licence `OFL.txt`) and load them with `@remotion/fonts` or `loadFont` from `@remotion/google-fonts/Caveat`.
- **Captions and UI:** system sans (`system-ui`, Inter or similar), weight 500–600.
- **Mock article:** a serif (Georgia) at about 30 px, so it reads as "a webpage".

**Assets in this repo**
- App icon: `extension/icons/icon-128.png`
- Toolbar icons: the SVG path data in the `ICONS` object at the top of `extension/controls.js` (24 × 24 viewBox, stroked, round caps). Use these exact paths for the toolbar so it matches the real extension.
- Reference screenshots: `store/screenshots/*.png` show what the side panel and floating bar look like.

---

## 3. Shot list

There are 6 scenes. Frame numbers are absolute (30 fps). Each scene's caption sits bottom-left in the safe area, cream text on a soft dark pill (`rgba(20,19,18,.82)`, radius 12, padding 14 × 22, 40 px, weight 600). Captions fade and rise 12 px in over 10 frames and fade out over 8.

### Scene 1: The page (0–45, 0.0–1.5 s)
- A mock article fills the frame: a cream (`#F6F0E2`) page with a fake browser top bar (thin, neutral grey, three dots, address pill reading `example.com/how-it-works`). Headline "How compound interest works" plus 3–4 lines of body text and one simple chart image or grey block.
- The camera slowly pushes in (scale 1.00 → 1.04 across the whole video, `Easing.inOut(Easing.cubic)`). Keep this gentle push running under every scene up to the end card.
- No caption. Quiet start: the music fades in.

### Scene 2: Marker and arrow (45–135, 1.5–4.5 s)
- **45–75:** A yellow marker ellipse draws around a key phrase in the body text ("doubles every 7 years"). It is hand-drawn: slightly irregular, not closed, and the end overshoots past the start.
- **75–105:** A yellow arrow draws from the empty right margin and curves into the circled phrase. Its head appears in the last 4 frames as two short strokes, angled along the curve (like the real one: a long side and a shorter side).
- **100–130:** A handwritten note in Caveat, yellow, about 54 px, writes in next to the arrow tail: "this is the key bit". Reveal it letter by letter, 1 letter every 1.5 frames.
- **Caption (60–130):** "Draw on any webpage like it's paper."
- **Sound effects:** a soft felt-tip scratch under each stroke, matched to its length.

### Scene 3: Recording and laser (135–225, 4.5–7.5 s)
- A small recording indicator fades in at the top right of the browser frame: a red dot pulsing at 1 Hz and a timer counting `00:12`, `00:13`…
- **140–185:** A laser pointer dot (bright red-orange core, soft glow) sweeps across the chart in a loose loop, leaving a glowing trail. The trail shortens behind it and fades out within about 0.5 s.
- **185–220:** An orange underline draws under the headline, holds for 15 frames, then fades out over 15 frames. This shows fade mode: marks that clean themselves up.
- **Caption (145–220):** "Point, then let it fade. No clean-up."
- **Sound effects:** none for the laser, or a very faint airy whoosh. The fade is silent.

### Scene 4: Controls out of the shot (225–315, 7.5–10.5 s)
- The page shifts left by about 340 px as a side panel slides in from the right (`spring({ damping: 200 })`, about 20 frames).
- The panel matches the real side panel: dark `barBg`, `barBorder` edge, a column of tool buttons drawn from the `ICONS` paths, then a colour row: four round swatches (yellow, cream, ink, orange) and the rainbow colour wheel (conic gradient, see the `.custom` CSS in `extension/controls.js`).
- **250–280:** A cursor clicks the highlighter button; it gets the yellow selected state.
- **275–310:** Back on the page, a see-through yellow highlighter band sweeps across one full sentence (`mix-blend-mode: multiply`, about 38% opacity, so the text stays readable underneath).
- **Caption (235–310):** "Your tools stay in the side panel, out of the shot."
- **Sound effects:** a soft click on the button, and a broad, softer scratch for the highlighter.

### Scene 5: Still there next time (315–375, 10.5–12.5 s)
- **315–330:** The side panel slides back out. The whole page, with all its marks, dips to the cream background colour, like closing the tab.
- **330–345:** The page comes back without the marks, then the marks appear again in place over 10 frames (opacity 0 → 1, slight scale 0.98 → 1).
- **Caption (330–372):** "Close the tab. Your marks come back."
- **Sound effects:** a soft paper rustle as the marks return.

### Scene 6: End card (375–450, 12.5–15.0 s)
- Cross-fade (10 frames) to a solid `ink` (`#141312`) background.
- Centred lock-up:
  - App icon (`icon-128.png`, shown at 120 px), scaling in with a soft spring.
  - "Handmark" in Georgia italic, 128 px, `cream`.
  - Tagline under it: "Draw on any webpage like it's paper." in system sans, 40 px, `muted`.
- **395:** A single yellow marker underline draws under the wordmark (15 frames), echoing scene 2.
- **405:** Small line, 30 px, `muted`: "Free for Chrome · No account · Nothing leaves your computer".
- Hold still from frame 420 to 450. The music resolves on the last beat.

---

## 4. How to animate the strokes

The hand-drawn look is what sells the video, so take care here.

- **Paths:** draw each mark as an SVG `<path>`. Hand-author the paths with small irregularities: no perfect ellipses, slight wobble, ends that taper or overshoot.
- **Drawing on:** use `evolvePath(progress, d)` from `@remotion/paths`, which returns `strokeDasharray` and `strokeDashoffset`. Drive `progress` with `interpolate(frame, [start, end], [0, 1], { easing: Easing.out(Easing.quad), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })`. Strokes should start a little fast and slow down at the end, like a real hand.
- **Marker look:** `stroke-linecap="round"`, `stroke-linejoin="round"`, width about 9 px at 1080p. For the felt-tip texture, layer a second copy of the path 1 px narrower at 85% opacity, or apply a light `feTurbulence` + `feDisplacementMap` filter (scale 1.5) so the edge isn't machine-perfect.
- **Arrowheads:** two separate short paths that start drawing when the shaft reaches 95%. Angle them using `getTangentAtLength` at the end of the path (`@remotion/paths`).
- **Handwritten text:** render Caveat text and reveal it with a `clipPath` rectangle that grows left to right, or by slicing the string per frame.
- **Laser trail:** keep the last N cursor positions (compute them from `frame`, never from state) and draw them as circles with decreasing radius and opacity, using `filter: blur(6px)` for the glow layer.
- **Timing only from `useCurrentFrame()`:** no `setTimeout`, CSS animations or random numbers without a seed (`random('seed')` from `remotion`), so every render is identical.

---

## 5. Audio

- **Music:** one calm, warm instrumental bed (soft piano, felt piano or lo-fi guitar), about 80–95 BPM, mixed low (around −18 LUFS). Fade in over the first 15 frames and end on a resolved note at 15.0 s. Use a track you have a licence for. Put it in `public/music.mp3` and add `<Audio src={staticFile('music.mp3')} />`.
- **Sound effects:** `public/sfx/marker-1.wav`, `marker-2.wav`, `click.wav`, `rustle.wav`. Keep them quiet, well under the music. Put each one in a `<Sequence from={…}>` that starts on the stroke's first frame.
- No voiceover. Every message is in the on-screen captions, so the video also works muted (autoplay on social).

---

## 6. Suggested project structure

```
promo/
  src/
    Root.tsx                 // registers <Composition id="HandmarkPromo" … />
    HandmarkPromo.tsx        // <Series> or absolute <Sequence>s for the 6 scenes
    theme.ts                 // colours and fonts from section 2
    components/
      BrowserFrame.tsx       // fake browser chrome + mock article
      MarkerPath.tsx         // evolvePath-based hand-drawn stroke (props: d, color, width, from, duration)
      Arrow.tsx              // MarkerPath + two-stroke head
      HandwrittenText.tsx    // Caveat text with left-to-right reveal
      Highlighter.tsx        // multiply-blended band
      LaserTrail.tsx
      SidePanel.tsx          // tool buttons from ICONS + swatches + colour wheel
      Caption.tsx
      EndCard.tsx
    scenes/
      S1Page.tsx … S6EndCard.tsx
  public/
    icon-128.png             // copy from extension/icons
    fonts/caveat-700-latin.woff2
    music.mp3
    sfx/…
```

Set it up with `npx create-video@latest` (blank template, TypeScript), then add `@remotion/paths` and `@remotion/fonts`. Keep the promo in its own folder or repo, not inside `extension/`, so it never ends up in the store package.

---

## 7. Checklist before export

- [ ] Exactly 450 frames at 30 fps, 1920 × 1080
- [ ] Every caption stays on screen for at least 2 s and sits inside the safe area
- [ ] Every mark looks hand-drawn (no perfect circles or ruler-straight lines, except the straightened-line look if you choose to show it)
- [ ] The toolbar and side panel use the real icons and colours from the extension
- [ ] The video makes sense with the sound off
- [ ] The music and sound effects are licensed
- [ ] The end card holds for at least 1 s before the end
- [ ] Nothing on screen shows a feature the extension doesn't have
