# Living Murals — Dina Saadi Studio (prototype)

Phone app that brings Dina Saadi's wall murals to life in AR. This is the
**web prototype**: it runs in iPhone Safari (and Android Chrome) from a link or
QR code, installs to the home screen, and shares its piece format and
animation presets with the native app that comes next.

The three murals in `pieces/` (Mirador, Zorro de medianoche, Garza) are
**placeholder art** built in the studio's file format so everything can be
tested before Dina's files arrive.

## What works now

| Mode | What it does |
|---|---|
| **Scan** | Recognises a mural through the camera (image tracking), lays the animated version exactly over it: depth layers with real parallax as you move, swaying foliage/tails, flowing hair and fur, drifting particles, breathing, blinking, eyes and head that follow you (or the person standing in front of it). People are cut out and kept in front of the art. |
| **Play controls** | Speed, amount of motion, who the eyes follow, keep-people-in-front, swap the subject with one from another mural, blink. |
| **Create** | Open the camera on any blank wall, drag four corners onto it (perspective-correct), drop in one work or pick 2–3 for an automatic blend (one background, subjects arranged across the wall, palettes harmonised, "try another arrangement"). *Lock to wall* uses the gyroscope to hold it in place. |
| **Capture** | Tap the shutter for a photo, hold for video. Captures camera + animation + people, so a portrait "looking at" someone is in the shot. Share/save sheet. |
| **QR pipeline** | Each mural's code opens `…/?p=<piece-id>&src=qr` → "You're standing in front of …" → straight into scanning that piece. The studio code (cards/postcards) opens the collection. Codes generated in-app (Studio tools) or by `tools/build_targets.py`. |
| **Install** | PWA: Add to Home Screen gives a full-screen app with offline cache. |

Not built yet (by request): selfie face filter from a mural's "DNA".

## Testing on an iPhone

The site must be served over **https** (camera access requires it). Any static
host works; GitHub Pages is set up for this repo.

1. Open the site on the iPhone, or scan its QR from the Studio tools page.
2. To test **Scan** without a painted wall: on a computer open the piece page →
   *Show as test target* (full-screen mural), then point the phone at the monitor.
3. First scan on a device without prebuilt targets compiles them (~20 s), then
   it's cached. This repo ships prebuilt targets, so it's instant.

## Piece format (what the studio supplies per mural)

```
pieces/<id>/
  art.svg        master vector file — one top-level <g id="…" data-role="…"> per animation layer
  piece.json     metadata, animation presets, rigs
  tracking.jpg   (optional) straight-on photo of the painted wall; used for recognition instead of the SVG
```

**Layers** are top-level groups, exactly as named layers export from
Illustrator: `data-role` = `background`, `subject` or `foreground`. Parts that
move independently need their own layer (hair behind the face, hair in front,
each eye's white / iris / lid). Eyelids are drawn *closed* and hidden with
`style="display:none"`; the app reveals them to blink.

**piece.json** (see `pieces/mirador/piece.json`):

- `layers[]`: `depth` (distance off the wall, in mural widths; 0 = paint) and `anim[]`:
  - `sway` root, dir, length, amp, speed, optional `radial`, `wave` — bends from a root (plants, tails, grass)
  - `flow` root, length, amp, speed, scale — rippling texture (hair, fur, feathers, water)
  - `drift` amp, speed — floating particles/petals
  - `breathe` pivot, amp, speed — slow scale pulse
  - `pulse` amp, speed — twinkling opacity
- `rigs.eyes[]`: white / iris / lid layer ids, centre, travel range, lid pivot
- `rigs.blink`: interval range, duration, chance of a double blink
- `rigs.head`: pivot, max turn, shift, and how strongly each layer follows the head
- `subject.box` + `subject.layers`: what can be swapped into other murals / blended

All coordinates are in the SVG's pixel space. **This is where Dina authors
animation directly**: new murals ship with their presets in piece.json, and the
app's controls only adjust them.

### Adding a mural

1. Add `pieces/<id>/art.svg` + `piece.json`, append the id to `pieces/manifest.json` and bump its `version`.
2. `pip install playwright && playwright install chromium`
3. `python3 tools/build_targets.py https://<site-url>/` → rebuilds `pieces/targets.mind`, `targets.json` and `qr/*.svg`.
4. Commit and push. (Skipping step 3 still works: phones compile targets on first scan.)

`tools/gen_placeholders.py` regenerates the placeholder murals.

## Code map

- `js/pieces.js` — loads pieces, splits the SVG into per-layer rasters (cropped to bounds so eyes stay sharp), flat composite for tracking
- `js/mural.js` — the animated mural: depth-stacked planes, shaders for every preset, eye/blink/head rigs, subject swap and blend compositions
- `js/scan.js` — MindAR image tracking + mural on the anchor, gaze ray-casting, people occlusion, capture
- `js/create.js` — camera + four-corner homography placement, gyro lock, blend
- `js/people.js` — MediaPipe person segmentation (occlusion mask + head point)
- `js/capture.js` — photo/video compositing and share sheet
- `js/targets.js` — prebuilt or on-device compiled tracking targets
- `js/app.js` — routes, home, piece page, QR arrival, studio tools

Libraries (pinned, from jsDelivr): three.js 0.160.0, MindAR 1.2.5, MediaPipe Tasks Vision 0.10.14, qrcode-generator 1.4.4.

## Road to the native app

| Web prototype | Native (iOS first) |
|---|---|
| MindAR image tracking | ARKit image anchors + world tracking: art stays put when the mural leaves the frame |
| Four-corner wall placement | ARKit plane detection (LiDAR where available) for Create mode |
| MediaPipe segmentation | ARKit person occlusion (`personSegmentationWithDepth`) and body tracking for gaze |
| QR → web page | QR → **App Clip**: the piece plays instantly without installing, with a banner to get the full app |
| Add to Home Screen | App Store / TestFlight |
| — | Geo-anchored murals (ARKit location anchors) for glasses and walk-by activation |

The piece format and presets above carry over unchanged; the renderer is
reimplemented in RealityKit/Metal. Building iOS needs a Mac with Xcode or a
cloud build service, plus an Apple Developer account for TestFlight.
