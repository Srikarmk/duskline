# Duskline — work report

Covering 2026-09-10 → 2026-09-16.
Live at https://playduskline.vercel.app (verified 200 at time of writing).

The game was called Fantasy Racer until 2026-09-16. Saved data from before the
rename is migrated, not dropped — see §7.

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
| Bundle, before the audit | 295 kB page, 398 kB first load |
| Bundle, after code-splitting the engine | **23 kB page, 126 kB first load** |
| Textures for a first race, before → after | 12,114 kB → **916 kB** |
| Dead code removed by the first ESLint run | ~700 lines |

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

## 6. The audit pass (2026-09-16)

Thirteen findings, twelve fixed. Full detail in `AUDIT.md`; the ones that
mattered:

**A first visit cost 13.5 MB and now costs ~1.9 MB** — measured over the wire
on the deployed build as a genuine first-time visitor.

| | Before | After |
| --- | --- | --- |
| First-load JavaScript | 398 kB | 126 kB |
| Textures for the first race | 12,114 kB | 916 kB |
| Realm previews | 660 kB | 333 kB |

Three separate causes, all measured rather than guessed:

- `GameApp` imported `GameCanvas` statically, so **three.js shipped in the
  first chunk — 405 kB of JavaScript to display a menu that renders no
  triangles.** A `dynamic()` import moved it behind the DRIVE button, where it
  loads while the player is choosing a world.
- The Poly Haven textures were full-resolution JPEG, and the normal maps were
  the worst of it. Recompressed to WebP with a recipe per map type (normals get
  the quality budget — compression error in a normal map is lighting pointing
  the wrong way, not a soft edge): 17.6 MB of source down to 1.3 MB shipped,
  no visible difference in the render.
- The realm cards were CSS backgrounds, which cannot be lazy-loaded. Now
  `<img loading="lazy">` in WebP.

**The crash recovery had a hole exactly where failure was most likely.**
`start()` ended with `void this.init()`, and `init()` is async — so a model
that would not parse or a texture that 404'd became an unhandled rejection,
invisible to both the React boundary and the window listener. The player got a
frozen loading screen. There is now an `onError` channel through `GameOptions`.

**Both write endpoints were wide open.** Rate limiting added, KV-backed when
configured, and verified firing: 10 posts then 429, `Retry-After` correct. It
does not make the board trustworthy — the client computes the score — and
`AUDIT.md` says so rather than implying otherwise.

**ESLint had never been run here.** 25k lines written with only `tsc`
watching. The first run found 42 problems, and behind them ~700 lines of dead
code: seven superseded car builders from the kart era (`cars.ts` 2,085 → 1,402
lines), unused helpers, 16 dead imports — and one real bug. A comma operator in
the fog-lamp code added **two meshes per side** instead of one: the lamp, plus
a cylinder positioned by `.translateX(0).translateY(0)`, i.e. left at the car's
origin, buried inside the bodywork where it could never be seen, uploaded and
drawn every frame on every Imprez.

Also cleared: pinch-zoom was disabled site-wide (a WCAG 1.4.4 failure) and is
now scoped to the canvas; the leaderboard declared `aria-modal` without a focus
trap or Escape; `escape()` in the Google token decoder mangled any non-ASCII
name; two of four npm advisories fixed.

## 6b. Second audit batch

**The race assets now arrive while you are choosing.** Pressing DRIVE used to
start a ~900 kB download before the world could build. `src/ui/warm.ts` uses
the ten to twenty seconds a player spends on the setup steps: idle-scheduled,
low-priority, and skipped entirely on `saveData` or a 2g/3g connection.
Verified — all 19 texture loads at race start came from cache, `transferSize:
0`, median 4 ms.

**The engine honours `prefers-reduced-motion`.** The stylesheet always had; the
engine never did, so camera shake on every impact and the radial speed smear
ran regardless — which for vestibular sensitivity is the whole problem, not the
menu easing. Both suppressed now, verified with the render loop frozen.

**A data-invariants test**, in CI. It guards the class of bug that has actually
shipped here and that neither the compiler nor the build can see: realms added
with no ground-texture mapping (silently falling back to a green forest floor
that a multiply tint can never make into snow), realms with no preview art,
a texture missed in the `.webp` conversion. Proven to fail before trusting it.

**A trap worth naming.** A service worker is scoped to an origin, not a build.
A production build served on `localhost:3000` installs one that cache-firsts
`/_next/static/**` — and it then serves those chunks to the **dev** server on
the same port, so the dev server silently hands back pre-edit code. Neither
`rm -rf .next` nor a hard reload clears it. I diagnosed a working accessibility
guard as broken three times before checking `g.render.toString()` and finding
pre-edit source in the running bundle. Registration is now refused on localhost
outright.

**The city was 21,151 meshes.** Profiling the scene graph rather than guessing
found 18,066 plain 24-vertex boxes — about a hundred per tower, 176 towers.
Most get culled, but each still costs a matrix update and a frustum test every
frame. The `mergeStaticParts` helper written for cars now runs on each tower
too: Neon Run went **21,151 meshes → 4,971** and **1,838 draw calls → 843**,
Sunset Bay **641 → 433**, with triangle counts unchanged and nothing displaced.

**Every static file was being re-checked on every request.** Vercel serves
`public/` with `max-age=0, must-revalidate`, so the 916 kB of textures, the
333 kB of previews and the models were revalidated on every visit and every
race — 30 conditional round trips at ~112 ms median. The hashed build output
already had a year and `immutable`; this art had nothing. Now a week of hard
caching plus a month of stale-while-revalidate, with `sw.js` pinned to
`no-cache`. Found only because the asset warming *looked* ineffective on a
first-ever visit; it was working, and this was why it didn't look like it.

**Photo mode.** The audit's own note was that the art direction is the point of
this game and there was no way to show it off — the chase camera is fixed and
the HUD covers the corners. Pause → PHOTO MODE now freezes the sim, hides the
HUD and hands over a camera you orbit, reusing the same render path so the
photograph is the game's own image. Reading the frame loop before running it
caught the flaw that would have killed it: `frame()` returns before `render()`
while paused, so the free camera would have drawn one frame and then sat there.

## 7. The rename

Fantasy Racer → **Duskline**. Code, UI, manifest, share tags, package name,
console prefix, service-worker cache version, KV key prefixes, every document.
GitHub repo and Vercel project renamed to match.

`duskline.vercel.app` turned out to belong to an unrelated app, and Vercel does
not swap a project's `.vercel.app` alias on rename anyway, so the game is at
**playduskline.vercel.app**. The old `fantasy-racer.vercel.app` still resolves.

**Saved data is migrated, not wiped.** Everything the game stored was prefixed
`fantasy-racer-`; renaming carelessly would have silently reset every returning
player's car, scores, settings and identity. `src/ui/storage.ts` is now the only
place localStorage is touched, and the migration is lazy rather than a startup
pass: a read misses the new key, finds the old one, adopts it, deletes the old.
No ordering problem, idempotent, and free for a player who never returns.
Verified by seeding the old keys — identity and car migrate on the home screen,
settings and mute on the first race, and afterwards no legacy key remains.

## 8. What I could not verify

- **Frame time on any hardware.** Stated plainly because object counts have
  been the proxy throughout, and a proxy is not a measurement.
- ~~Service worker registration in a real browser.~~ **Now verified.** On the
  deployed site it is registered and `activated`, all three caches are
  populated, and a second visit transfers **0 bytes** — every texture served
  from cache. The earlier failure was specific to `localhost` in the preview
  pane.
- **The shared leaderboard and guest sequence**, which cannot be exercised
  until a KV store exists.
