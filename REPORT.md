# Duskline — work report

Covering 2026-09-10 → 2026-09-15. 42 commits, 56 files, +6 002 / −563 lines.
Live at https://duskline.vercel.app (verified 200 at time of writing).

---

## 1. Where it stands

**Not everything on RELEASE.md is done.** Everything that can be done from
inside the repository is done. Two items remain, and neither is something I can
complete from here:

| # | Item | Why it is still open |
| --- | --- | --- |
| 1 | **Connect a KV store** (or remove the GLOBAL tab) | Needs credentials on your Vercel project. `.env.example` names the exact variables. Until then scores live in per-instance serverless memory (they effectively vanish) and "RACER 3218" is a local random number, not the 3218th guest. |
| 2 | **A measured frame-time floor** | Needs hardware that is not this machine. Every attempt to sample one here returns a single frame, because the preview pane throttles `requestAnimationFrame` when it is not fronted. The FPS readout in the pause menu exists specifically so a real number can come back. |

Optional, also outside the repo: `NEXT_PUBLIC_SENTRY_DSN` (crash reports) and
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Google sign-in). Both degrade honestly when
unset rather than breaking or pretending.

One non-blocking item remains inside the repo: the five older realms (Forest,
Peaks, Void, Circuit, Metro) have had every global fix but not the bespoke
landmark pass the six photo realms got.

---

## 2. RELEASE.md, item by item

| Status | Item | Outcome |
| --- | --- | --- |
| ✅ | Error boundary + crash recovery | Render-phase errors and `requestAnimationFrame` errors both caught, with a route back to the menu |
| ✅ | WebGL capability gate | Distinguishes no-WebGL / WebGL-1-only / no-float-targets; `lowPower` hint drives the first-run quality tier |
| ✅ | Error reporting | `src/ui/report.ts`, DSN-gated, capped and deduped |
| ✅ | Memory across many races | Measured over 29 cycles: no leak. Teardown made deterministic anyway |
| ✅ | Audio autoplay | `TAP FOR SOUND` fallback for the iOS Safari gesture rule |
| ✅ | Self-hosted fonts | Zero third-party requests, verified live |
| ✅ | Dead modes | `timetrial`/`nitro` deleted, `transform` archived, schema bumped |
| ✅ | Service worker | Offline-capable; routing covered by a CI test |
| ✅ | Tutorial / controls reference | First-run card + nine-row pause reference |
| ✅ | Mobile | Touch pads, PWA manifest, quality tiers, non-scrolling home at 390×844 |
| ✅ | Saved-data migration | `SCHEMA` drops payloads containing ids that no longer exist |
| ✅ | Score validation | `spacewars`/`endless` were being filed as `classic`; plausibility gates added |
| ✅ | Share metadata | OG + Twitter cards |
| ✅ | Credits + licence audit | `CREDITS.md`; everything CC0 / MIT / OFL |
| ✅ | CI | `tsc`, service-worker routing test, `next build` on push and PR |
| ✅ | Dev preview writer locked down | Requires non-production **and** an explicit env opt-in |
| ✅ | Realm previews | All twelve regenerated against current art |
| ⛔ | KV store | See above |
| ⛔ | Frame-time floor | See above |
| ◻ | Older realms art pass | Not launch-blocking |

Two items in the first draft of that file were **wrong**, and the file now says
so: there is no music to licence (all audio is procedural, zero audio files in
the repo), and the leaderboard was never "lying" — it reports `global: hasKV`
and the UI says so when false. Acting on a wrong list wastes as much time as
having no list.

---

## 3. What changed in the game

### Art direction
Rebuilt around the Nagai/city-pop reference images: sunset gradients, poster
suns, silhouetted skylines, flat-faceted geometry.

- **The sky is computed, not painted.** Four rounds of art changes could not
  fix "blurry" because the blur was *magnification*, not drawing: the camera
  sees ~72° of a 2048-px equirect, i.e. 410 texels stretched across a 2560-px
  buffer — 6×. It is now a `ShaderMaterial`: continuous gradient, hard sun disc
  anti-aliased by `fwidth`, and clouds as an fbm field projected onto a deck
  and self-shadowed by a second sample stepped toward the sun. That
  self-shadowing is what makes them read as solid rather than cut paper.
- **Props de-plasticked.** `bumpScale` 0.25→0.05, metalness to 0, roughness
  0.97, env intensity 0.3, flat shading, and the per-instance tint spread
  widened ±0.12→±0.42 so a forest is not one colour.
- **Pickups**: the cheap diamond replaced by a chrome chip — dark octagonal
  body, mirror rim, neon face, chevron glyph.
- **God rays removed.** They read as "angels descending", which is not the
  brief.

### Worlds
Twelve offered (five more archived behind the scenes, as asked).

- Six new realms built from the reference photographs with real elevation —
  Cape Road went from 6 m to 227 m of relief, Hokkai 6→184, Sunset Hills
  10→239. Global hill amplitude raised from 9.5 m to ~24 m peak-to-peak.
- Bespoke landmarks per realm rather than one monument reused everywhere.
- **Sunset Bay**: sea right at the verge, instanced feathered palms.
- **Neon Run**: rebuilt as a 16 km endless highway with two 5.3 km straights —
  no laps, no rivals, no pickups, no minimap. 176 stepped towers, 260 neon
  signs with three-way light spill, ~200 overhead lamps, 9 overpasses,
  crushed-black palette.

### Cars
Ten, each with its own body — a Ferrari F40 in red, plus Tauro, Testa,
Meridian, Veloce, Zanza, Imprez, Firehawk, IROC and Fairlady.

- Built from per-car half cross-section rib tables through `loftBody`, with
  four roof kinds (canopy / fastback / notch / targa).
- Detail pass: mirrors, shut-lines, window surrounds, side intakes, bumper
  ducts, plates, badges, diffuser fins, brake discs with calipers and lug nuts.
- Static parts merged per material afterwards: **167 → 108 meshes per car**.

### Driving
- **Speed capped.** Multipliers had stacked to 2.31× and everything breezed
  past at ~300. Now 164 flat out, ~195 on nitro.
- **Banking** (`BANK_K` 11→46), **off-camber** corners via smooth harmonic
  inversion, and **compressions**: `verticalCurvature` feeds a g-load that
  drives grip between 0.72× and 1.28× and a 0.05 m suspension squat.
- **Drift marks** appear — the threshold was 3.5 m/s of side-slip, which no
  normal drift reaches; now 1.8.
- Speed smear via radial blur so fast driving reads as fast.

### Interface
- **Home screen**: four steps (WORLD → CAR → MODE → GO), each exactly one
  screen with nothing to scroll, full width via auto-fitting grids. Twelve
  worlds lay out 6×2 at 1800 px, 4×3 at 1280, 2×6 on a phone. `DRIVE NOW`
  beside `NEXT` so anyone happy with the defaults never walks the flow.
- **Sign-in**: Continue as guest (numbered, no typing) or Connect with Google.
  Google Identity Services — public client id only, no secret, no callback, no
  session store.
- **Leaderboard** is a sheet you open, not a slab bolted under the last step.
- **First-run card** says how to drive, once, and the pause menu has a real
  nine-row reference. Both say the thing nothing in the game said before:
  drifting through a corner is what refills nitro.

### Platform
- Touch controls synthesising the same key events the engine already listens
  for, PWA manifest with `display: fullscreen` (a browser tab costs a phone
  15–20% of its screen), quality tiers (dpr cap / shadow map / post chain /
  scenery density) with `capability.lowPower` picking the first-run default.
- Service worker: hashed assets cache-first, art stale-while-revalidate,
  navigation network-first, `/api/**` never touched.

---

## 4. Numbers actually measured

| Measurement | Value |
| --- | --- |
| Sunset Bay, high quality | 640 draw calls, 7.9 M triangles/frame |
| Neon Run, high quality | 3 060 draw calls, 5.9 M triangles/frame |
| Geometries / textures / programs per race | 542 / 13 / 29 |
| Memory, 29 race→menu→race cycles (before fix) | heap 118–173 MB, no runaway climb |
| Memory, 15 cycles (after explicit disposal) | flat — an 8-race stretch inside 2.8 MB |
| Meshes per car after merge | 167 → 108 |
| Third-party requests on page load | 0 |
| Bundle | 295 kB page, 398 kB first load |

Neon Run is ~5× the circuit realms in draw calls. That is the number to attack
first if a phone struggles — it is city geometry that could merge further.

---

## 5. Bugs found, with their actual causes

The cause matters more than the fix in most of these, because in nearly every
case the obvious fix was the wrong one.

| Symptom | Actual cause |
| --- | --- |
| Sky "blurry", reported four times | Magnification, not art: 410 texels across 2560 px. No art change could have worked |
| Sky rendered near-black at the zenith | A raw `ShaderMaterial` does not get three's tonemapping/colorspace stages — linear colour written un-encoded |
| Sky vanished on Neon Run | The dome sat at the world origin; a 7 km lap drives outside a 900 m sphere. It now follows the camera |
| Clouds painted over the whole world | Transparent material with `depthTest: false` draws after every opaque mesh |
| Cape Road was a floating ribbon | The coast carve is radial and unsigned, so it cut *both* sides of the road |
| Hokkai Pass was olive, not snow | All six new realms fell through to `ground_forest`, and `groundTint` is a multiply — it cannot lighten |
| Car floated 20 cm | `CAR_LIFT = 0.2` while `makeWheel` already puts the contact patch at the origin |
| Car sank half a metre at the verge | Placement *switched* between banked road and terrain, and terrain is held below the ribbon. Now a ramped blend |
| Camera under the road on descents | Ground height sampled at the car's position, not the camera's |
| Neon Run scores filed as circuit races | `spacewars` and `endless` were missing from `VALID_MODES` |
| Home page layout overlapping | New generic class names (`.row`, `.panel`, `.bar`) collided with 2 244 lines of legacy stylesheet |
| Selected card lost its highlight | `.card.car` set its resting border *after* `.card.on` at equal specificity — the later rule won |
| Shadows softer/harder than configured | `PCFSoftShadowMap` deprecated in three r18x; silently downgraded, warning every race. The soft edges came from `shadow.radius`, which only the fallback honours |

Two process mistakes worth recording: I rewrote the home screen twice when you
had asked me to *modify* it, throwing away first the steps and then the preview
art and 3D garage. It is now the original with only the length changed. And I
repeatedly broke the dev server by running `npm run build` against a running
`.next`.

---

## 6. What I could not verify

- **Frame time on any hardware.** Stated plainly because object counts have
  been the proxy throughout, and a proxy is not a measurement.
- **Service worker registration in a real browser.** `/sw.js` serves 200 with
  the correct MIME type and `npm run test:sw` asserts every routing decision
  against the real file, but the in-app preview pane refuses to register any
  worker, so the install path is inspection-only. Chrome DevTools → Application
  → Service Workers settles it in half a minute.
- **The shared leaderboard and guest sequence**, which cannot be exercised
  until a KV store exists.
