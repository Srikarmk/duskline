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

## 6c. Giving the circuit something to do (2026-09-18)

Five features, none of which needed a new asset, plus the visual and layout
faults they exposed.

**Ghost lap.** Your own best lap, per realm, driving beside you. The point is
that a solo lap had nothing to measure itself against: the AI is rubber-banded,
so beating it says more about the band than about the driver. Stored in track
space rather than world XYZ so it survives any change to the road art, and
sampled by *distance* rather than time — the only question a replay ever asks
is "where was I at this point on the track", and distance-indexed that is an
array index rather than a search.

That indexing is what makes the delta honest, and getting it wrong first taught
me why. Version one divided the gap in metres by the current speed, which is
wrong in exactly the moment a driver looks at the number: measured while
coasting, a 36 m gap read as 4.5 seconds down when it was 0.8. The recording
already knows how long the best lap took to reach any distance, so the delta is
now that minus your own lap time — stable through braking, and the number the
readout was always pretending to be.

**Style chain.** Drift, near miss, overtake, stunt and pad chain now feed one
pot that *pends* rather than scores, at up to x6, banked when the fuse lapses
cleanly and lost entirely on contact. Each of those was previously a flat
payout you could collect by accident; a risk bank turns them into a decision
about when to stop pushing.

**Drift zones.** Drifting was the deepest mechanic in the game and the one
nothing ever asked for — you could finish a race without sliding once and the
track would never notice. Zones are painted corners that pay in proportion to
how much of them you spent sideways, placed by the *lap's own* curvature
percentiles rather than authored, because twelve realms generate twelve
different circuits. A first pass with absolute thresholds found exactly one
zone on a 3.9 km lap: the 0.010 floor I had picked as a guardrail was above the
90th percentile of a circuit whose tightest hairpin measured 0.0116, so the
floor had quietly replaced the percentile it was meant to protect.

The zone only fills on tarmac, which I did not think to guard until I watched
the gauge fill faster off the road than on it. The grass is deliberately looser
than asphalt so the car slides on it — which would have made the optimal play
in a drift zone "steer onto the verge".

**Boost pads, back but placed to cost something.** They had been pulled for
being a conveyor belt, and that was a fair description of a pad you cannot
miss: the deck was 8.5 m wide on a 10 m road, and its collision band turned out
to be five metres either side of centre — the whole road. Any attempt to make a
pad a decision by moving it off the racing line would have been silently
undone. Now a lane's width with a lane's hit band, in chains of three on the
outside of corner exits, and the later decks extend the surge rather than
refresh it so committing to the chain beats clipping the first one.

**Slipstream.** Following a rival used to be strictly worse than being alone —
same speed, spoiled air, nowhere to go — which is why the pack strung out and
stayed strung out. The tow is strongest right behind the gearbox, gone by 30 m,
and bleeds out slowly so pulling out to pass keeps the speed you earned.
Measured over a lap in traffic it averages +2.0% top speed with the strong band
on 3% of frames: worth chasing, not enough to make following better than
leading.

**The road from below.** Reported by eye — driving downhill, you saw the
underside of the tarmac. The camera's floor clamp was against the *terrain*,
and the terrain is deliberately held below the road ribbon so the verge can
meet the tarmac without a step. On a descent the chase camera trails into the
gap between the two, where a terrain clamp is still under the road. It now
clamps to whichever is higher. Zero frames below the road over a 5,400-frame
lap, on a circuit that showed it on every descent.

**The grid.** Asked to put every car behind the line with assigned positions
and the player last, I found the stagger was *added* where it should have been
subtracted. One sign, three consequences: pole was not the frontmost car, every
row was ordered backwards against its slot numbers, and the player — the odd
slot of the last row — started 1.6 m ahead of the ninth rival. Now pole at −7,
five rows of two at 8 m intervals, player at −40.6 with all nine ahead.

**Sharpening.** The features exposed how noisy the screen had become. Toasts
were laid out at y 150 and the drama callout at `vh * 0.3`, two independent
magic numbers that on a 600 px view printed "NEAR MISS x1" straight through
"PASSED"; the callout now exports where it sits. A gem run is six chips 3.5 m
apart, which at racing speed is six `+100` toasts in half a second into a
four-slot stack — so collecting one reliably evicted every line that meant
something, and chips now coalesce into a single counting line. The first drift
zone texture was a 0.7 m violet chevron every six metres, which stopped reading
as road markings and started reading as a purple road. And anisotropy, which
`textures.ts` itself calls the biggest single sharpness win available, was
still 8 on the road and 4 on the cars while the GLTF maps were on 16.

## 6d. The four that were left (2026-09-18)

**Weather stopped being scenery.** It already rolled over mid-race and already
changed the sky; it had no consequence. Rain, snow, sand and ash now take
lateral grip and nothing else, because that is the interesting half: the
straights are unchanged, every corner becomes a decision, and since the drift
threshold is a side-slip *speed* the car breaks loose earlier — so a wet lap
pays more style than a dry one. Eased in over a couple of seconds rather than
switched, with the road surface visibly wetting first and the HUD naming both
the cause and the number, because a car that has quietly lost a fifth of its
grip with nothing on screen is indistinguishable from a car that has started
handling badly, and the player will blame the game rather than the rain. The
AI lifts on the same curve; a weather effect only the human felt would be a
handicap, not a condition.

**The pack tows.** The personality system was already there — apex hunting,
corner caution, preferred line, weave, nitro style, mistake rate, all seeded
from the racer's name. What was missing is that a rival could never reel in a
car it was following, so one that dropped two lengths back stayed there and
the field never fought over anything. Their tow gain is lower than the
player's, because the AI holds a line and never thinks to pull out, so it sits
in dirty air far more of the time; the player's number compounded into the
pack circulating faster than anyone driving it.

**The crossing** is the only thing on the circuit whose answer changes. Two
boulders sweep across a painted hazard band on a cycle, behind flashing
beacons and a HUD callout, so the same corner is a different problem on lap 1
and lap 3. Almost all the work was finding out where a boulder is allowed to
be. One is nothing to do — nine metres of road stay clear. Two with a 4.5 m
gap turned out to be a *wall*, because each blocks 2.8 m once the car's own
width is counted, so the "gap" was negative. And there is no good place to
park them beside the road: at Sunset Bay a parked boulder sat in mid-air over
a ten-metre drop to the beach, on a slope steep enough that fifteen
centimetres of sideways slide moved it more than a metre vertically. They now
exist only while they are over the tarmac, which is also the only surface they
were ever meant to be touching.

**The fork** was the one I said would need the corridor that had been removed,
and the note explaining its removal — that it let the car wander off-road and
sink, and that the separate curve felt bad — turned out to be blaming the
feature for the engine's ignorance of it. `freeDrive` had always been able to
put you on a second road and keep you there. Nothing else knew. Every system
in the game reads the car's lateral offset as metres from the main centreline,
and on a branch that number means metres from the *branch*, so parked on the
fork the game believed the car was dead on the racing line — seventeen metres
from where it actually was, with thirteen pickups in reach that were on a road
I was not driving.

That is nine separate faults sharing one cause, and they are the interesting
part of the day: the height read from the wrong road (the "sink"), the
steering assist dutifully steering you back off the fork it had just let you
take, the scenery bands planting a forest down the middle of it, an island
sized by formula that overlapped both roads, a branch ribbon narrower than its
own containment walls, and a gantry sign with its posts on the racing line
that you drove through at 115 mph. Each one is small. Together they are a
feature that "feels bad" for reasons no single reading of the code explains,
which is exactly how it came to be deleted instead of fixed.

The last of the nine was the only one that is a design question rather than a
bug: a fork on a straight is geometrically always the longer road, because a
lens is longer than its chord. It now finds the bendiest stretch of the lap and
bows to the measured inside of it, which on the Void Circuit makes it a
genuine shortcut and on the gentler Forest circuit leaves it eight metres
down — and when it is the slower road it pays a style-chain link for seeing it
through, which is the one currency available. It cannot pay in pickups:
entities are addressed in main-track coordinates, and on a branch the second
of those coordinates means something else, so "a boost pad on the fork" is not
expressible without re-addressing every entity in the game. That is written
down rather than worked around.

## 6e. Two days later: less paint, and get out of the sightline (2026-09-20)

**The drift zones are gone.** They worked — the corner finder was sound, the
gauge filled, the chain paid — and they were still wrong, because four 130 m
bands of violet chevrons covered a tenth of the circuit. On a game whose whole
pitch is how it looks, a scoring hook should not be the thing hiding the view.
They were also the third mechanic paying for the same input: the drift boost
pays for sliding, the style chain pays for sliding, and then a painted corner
paid for sliding again.

What replaced them asks for the opposite skill and needs no paint at all. An
apex is a *point*, so marking it takes two red-and-white kerb blocks on the
inside of the bend and nothing on the road. Clip it at speed and it pays. The
corner-finding code is the same — it was always the good half — but it now
locates the tightest point of each corner rather than its span, which matters
more than I expected: two of the four corners on the test circuit are tightest
on ENTRY, so their apex is early, and marking the midpoint would have pointed
at the wrong piece of road.

The property I care most about is one I could only get by measuring: a
hands-off lap clips **zero** apexes, because the steering assist holds the
centreline. The drift zone could be partly satisfied by the car driving itself.
An apex cannot — it is something you have to decide to do.

One thing the swap surfaced: `obstacleClear` lets a tree's collision circle
reach 5.5 m from the centreline, so there is no lateral offset outside the
ribbon that is guaranteed empty, and the first marker position landed inside a
roadside tree. The markers now sit on the kerb at 6.6 m and anything solid
within reach of one is pruned — the marker wins, because it is the one thing
on that verge the game is actively telling you to aim at.

**And the score notifications moved to the top of the screen.** They started at
y 190, which on a 600 px view is the middle of the frame — directly over the
road a few car lengths ahead, which is exactly where you are looking while
driving. Four of them stacked put a column of text through the apex of the
corner you were trying to take. They are now along the top, which also removes
the dodge that used to be needed when a drama callout fired: the two lived in
the same place and the stack had to be pushed out of the way. The ghost delta
moved to the left column with the speed and the grip, where an instrument you
glance at belongs.

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
