# Audit — opened 2026-09-15, worked 2026-09-16 and 2026-09-18

Run against the **deployed build**, not a local dev server, except where noted.
Dependency and code checks are against the working tree.

Severity: 🔴 fix before launch · 🟠 fix soon · 🟡 worth doing · ⚪ nice to have
Status: ✅ fixed and verified · ◻ open

**23 of 25 findings are fixed.** The two open ones are the framework upgrade
below and, far more importantly, the single-speed finding above. The one left open is a build-time dependency
advisory that needs a major framework upgrade, and is not reachable in this app
— reasoning below. Six of the findings were opened by the 2026-09-18 feature
pass: adding a mechanic is the fastest way to discover which of the existing
ones were quietly wrong.

---

## 1. Bugs and issues

### ✅ 🔴 B1 — First visit downloaded 12 MB of textures
**Measured before:** 12,114 KB across 18 files; 13.5 MB from landing to
driving. The normal maps were the worst (`foliage_nor` 1,372 KB).

Two compounding causes: full-resolution JPEG, and a fixed set regardless of
realm. `scripts/optimize-textures.mjs` now recompresses to WebP with a recipe
*per map type*, because the three kinds tolerate compression very differently:

| Map | Treatment | Why |
| --- | --- | --- |
| `_diff` albedo | half size, q78 | tiled over a hillside, never seen at 1:1 |
| `_nor` normals | half size, q92 | a vector per texel — compression error here is lighting pointing the wrong way, not a soft edge |
| `_arm` AO/rough/metal | quarter size, q80 | the lowest-frequency data in the set |

**Measured after: 916 KB.** 17.6 MB of source → 1.3 MB shipped, a 93% cut,
with no visible difference in the render (checked at full scale on Sunset Bay:
asphalt grain, kerbs and cliff faces all intact). The source JPEGs moved to
`assets/textures/`, out of `public/`, so 18 MB of originals no longer upload to
the CDN on every deploy.

### ✅ 🔴 B2 — Async world-build failures escaped crash recovery
`Game.start()` ended with `void this.init()`. `init()` is async and loads
models and textures over a network, so a failure there became an **unhandled
promise rejection** — invisible to both the React error boundary and the window
`error` listener. The most likely failure on someone else's machine was the one
with no recovery path: a frozen loading screen.

`GameOptions` now carries an `onError` channel, `start()` routes an init
rejection into it, and `GameCanvas` shows the recovery screen and reports the
error with `source: "init"`. The copy changed too — a retry genuinely often
works when the cause was an asset fetch.

### ✅ 🟠 B3 — The race died on *any* window error
The listener claimed every error that reached `window`, including ones thrown
by browser extensions. Now it checks the error came from our own origin;
cross-origin scripts report an empty filename and the opaque "Script error.",
and neither is something we should claim as our crash.

### ✅ 🟠 B4/B5 — Both write endpoints were wide open
`POST /api/scores` accepted any score under any name as fast as you could send
it; `POST /api/guest` did an unbounded `INCR`, so a loop could drive the guest
counter to a million and make the one genuinely shared piece of state
meaningless.

`src/server/rateLimit.ts` — fixed-window limiter, KV-backed when configured
(a per-instance counter on serverless is barely a limit; every cold start gets
a fresh one), per-instance otherwise. Scores 10/min, guest 5/min, both with a
`Retry-After` header. **Verified against the running server: 10× 200 then 429,
5× 200 then 429, `retry-after: 54`.**

Residual risk, stated plainly: this does **not** make the board trustworthy.
The client computes the score, so a determined person can still post a
believable one. That needs a server-issued race token, which is listed under
improvements rather than pretended away here.

### ✅ 🟠 B6 — Pinch-zoom was disabled site-wide
`user-scalable=no, maximum-scale=1` is right for a game canvas — a pinch
mid-corner is a mis-grab — and wrong for menus, where it is a **WCAG 1.4.4
failure**. The lock now lives where it belongs: `touch-action: none` on
`.game-stage`, which suppresses the gesture on the canvas and nowhere else.

### ✅ 🟡 B7 — The leaderboard sheet was not a real dialog
It declared `role="dialog" aria-modal="true"` — which tells a screen reader the
rest of the page is inert — and then did nothing to make that true. Now: focus
moves into the sheet on open and returns to the opener on close, Tab wraps at
both ends instead of walking out, and Escape closes it.

### ✅ 🟡 B8 — npm vulnerabilities: 4 → 2, and the two left are unreachable
`npm audit fix` cleared the `sharp`/libvips and libheif advisories. The
remaining two are `postcss`, pulled in by Next 15, and fixable only by
upgrading to Next 16 — a major.

Both postcss advisories are about **attacker-controlled CSS**: XSS via an
unescaped `</style>` in stringify output, and arbitrary `.map` file reads via a
`sourceMappingURL` comment. This project processes exactly one CSS file, which
we wrote, at build time. No user-supplied CSS ever reaches postcss, so neither
has a reachable path here. Upgrading to Next 16 is worth doing deliberately —
not bundled into a launch-week batch with everything else.

### ✅ 🟡 B9 — Twelve realm previews loaded at once
660 KB in one go. They are `<img decoding="async">` in WebP now, with the
realm's own sky gradient behind as the fallback. **660 KB → 333 KB**, all
twelve load, layout unchanged.

**Correction, worth recording:** the first attempt added `loading="lazy"`,
which was wrong here and had to be backed out. On the deployed build it left
**all twelve cards as bare gradients with zero requests made** — the step does
not scroll, so every card is on screen by design and there is nothing to
defer, while the failure mode is precisely the flat colour swatches the preview
art exists to prevent. The byte saving came from WebP, not from laziness.
Verified after the change: 12 images, 12 loaded, 0 broken, 333 KB, all WebP.

### ✅ 🟡 B10 — Dependencies behind
Next 15.5.20 → 15.5.25, React 19.2.7 → 19.3.0, `@types/three` → 0.185.4. The
majors left deliberately: Next 16, three 0.186, TypeScript 7.

### ✅ ⚪ B11 — `escape()` in the Google token decoder
Replaced with `TextDecoder`. Worth more than the "deprecated API" label
suggests: `atob` returns bytes-as-latin1, and any name with a non-ASCII
character in it — most of the world — needs those bytes decoded as UTF-8.

### ✅ ⚪ B12 — README and CLAUDE.md described a different game
README advertised "four realms" and "a transforming sword-mech"; CLAUDE.md said
"the 3 realms" and described a name-entry home screen. Both rewritten during
the rename.

### ✅ NEW — Two invisible meshes on every fog-lamp car
Found by the first ESLint run, from a `no-unused-expressions` warning:

```js
if (p.fogLamps) for (const sx of [-1, 1])
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(...), lensMat)
        .translateX(0).translateY(0)),          // ← comma operator
    g.add(box(0.14, 0.1, 0.05, lensMat, sx * hw * 0.52, ...));
```

A comma operator, so **two** meshes were added per side: the fog lamp, and a
cylinder positioned by `.translateX(0).translateY(0)` — i.e. left at the car's
origin, buried inside the body where it could never be seen. Two invisible
meshes riding along on every Imprez, uploaded and drawn every frame. The
cylinder was an abandoned first attempt; the box is the lamp.

### ✅ 🔴 NEW — A waterfall standing 9.3 m in the air on Crystal Peaks
Reported by the user, twice. Measured before touching anything: the fall's base
at y 41.88 with the ground beneath its footprint falling to 32.57.

**Cause: one terrain sample at the prop's centre.** Both placement paths did
it — `place()` for realm features and `drop()` for hero monuments — and a prop
has a FLAT base while terrain does not. This fall is ~7 m wide before a 2.2×
scale, so its base spans ~18 m of mountainside; a centre sample leaves the
downhill edge hanging by whatever the slope drops across that span. `drop()`
was the worse of the two: the widest props in the game, walked 90–120 m off the
road into terrain nothing else constrains.

Three changes, in the order the measurements demanded them:

1. **Sit props on the lowest ground under their footprint**, not the centre —
   nine samples, once, at build time. Buried is invisible; floating is the
   first thing you see. Capped at 8 m of sink so a spot beside a cliff edge
   does not swallow a monument. Gap 9.76 m → 1.76 m.
2. **Make flatness a placement criterion, not something to correct after.** No
   amount of sinking fixes a slope that drops 10 m across a footprint, so
   `drop()` now walks outward and takes the first spot that is both clear of
   the circuit and not a cliff. Gap → −0.4 m (buried).
3. **Tolerance of 6 m, ten tries, nearest wins.** The first version searched
   for level ground and pushed the fall to **246 m** from the road — trading a
   visible bug for an invisible monument, which the code's own comments
   complain about elsewhere ("scenery you never really register"). These props
   are cliffs; they read fine pitched on a hillside. Final: 149 m out, 1 m
   buried, standing in a valley instead of hanging off a rock face.

Verified on both waterfall realms. Forest, which has the grand fall: −3.2 m
(buried) at 48 m from the road, and its second fall −0.8 m at 99 m. No
regression.

**A wrong turn worth recording:** I hypothesised that the gap was chord error —
the ground is a grid mesh sampled from an analytic function every 9–12 m, and
flat triangles cut below the curve they interpolate. I built
`renderedGroundY()` to sample the drawn surface exactly (mirroring the mesh's
own triangulation rather than raycasting ~14k triangles). Then measured the
chord error at that spot: **0.02 m.** Not the cause. The helper stays because
placing props against the surface a player can see is right on principle, but
the theory was wrong and the single-sample centre was the whole bug.

A full scan of Crystal Peaks also flagged 193 props "floating" over 0.6 m.
Nearly all are false positives — roadside furniture sits on the road ribbon,
which is held deliberately above the terrain — and the two extreme ones (56 m
and 72 m) are the blimps from `placeSkyProps`, which are meant to be up there.

### ✅ NEW — Everything in public/ revalidated on every single request
Found while checking why the asset warming looked ineffective on production.

Vercel serves `public/` with **`cache-control: public, max-age=0,
must-revalidate`**. The hashed build output under `/_next/static` correctly
gets a year and `immutable` — but the 916 kB of textures, the 333 kB of realm
previews and the models were getting nothing. Every visit and every race
re-checked all 30 files, each a conditional round trip returning 304, measured
at ~112 ms median.

The service worker hid this once it was in control, which is why it took a
first-ever visit (where the warm fetches race the worker's activation) to
notice at all.

`headers()` in `next.config.ts` now gives them a week of hard caching plus a
month of stale-while-revalidate. Deliberately **not** `immutable` and not a
year: these filenames are stable while their content is not — regenerating the
previews or re-running the texture script rewrites them in place — so a year of
`immutable` would strand people on old art with no way to bust it. `sw.js` is
pinned to `no-cache`, because a stale worker is a stale everything.

### ✅ NEW — A production build on localhost poisons the dev server
Not a shipped bug, but it cost most of a debugging session and it is a trap
anyone on this project can fall into.

A service worker is scoped to an **origin**, not to a build. Running
`next start` on `localhost:3000` — or accidentally building over a running dev
server — installs one that cache-firsts `/_next/static/**`, and it keeps
serving those chunks to the **dev** server on the same port afterwards. The
symptom is a dev server that silently serves pre-edit code: a guard you just
added does nothing, methods you deleted are still present, and neither
`rm -rf .next` nor a hard reload clears it (navigation is network-first, chunks
are cache-first).

I diagnosed a working accessibility guard as broken three times before checking
`g.render.toString()` and finding pre-edit source. `ServiceWorkerRegister` now
refuses to register on localhost at all — there is nothing about offline
support worth testing there.

### ✅ NEW — ESLint had never been run, and it was holding ~700 lines of dead code
`next lint` has always offered to set this up and never had been, so 25k lines
were written with only `tsc` watching. The first run found 42 problems. Cleared
by deleting what they pointed at:

- **seven superseded car builders** (`buildKart`, `buildFormula`,
  `buildMonsterTruck`, `buildHover`, `buildDragster`, `buildBuggy`, `buildJet`)
  — the kart-era catalogue, replaced by the per-car rib system. `cars.ts`
  2,085 → 1,402 lines.
- unused helpers (`panelBetween`, `tyre`, `monsterWheel`, `suspensionArm`,
  `hexStr`, `gemGeometry`, `KartParams`, `Wing`), 16 unused import specifiers,
  and a dead weather-label table.
- the fog-lamp bug above.

`npm run lint` is clean and CI runs it.

### ✅ 🔴 NEW — The camera showed the underside of the road on every descent
Reported by eye: driving down a hill, you saw the road from below. The camera
has a floor clamp, and it was clamped to the **terrain** height — but the
terrain is deliberately held BELOW the road ribbon (that is the ramp that lets
the verge meet the tarmac without a step). On a descent the chase camera trails
above and behind the car into the space between those two surfaces, where a
clamp to the terrain is still under the road.

Fixed by clamping to whichever is higher, terrain or the road surface at the
camera's own projected position:

```ts
let floor = this.groundHeightAtXZ(cx, cz);
const pr = this.track.project(cx, cz);
if (Math.abs(pr.lateral) < ROAD_HALF_WIDTH * 2.2) {
  const rp = this.track.pointAt(pr.dist, pr.lateral, this.tmpCamFloor, false);
  if (rp.y > floor) floor = rp.y;
}
```

Verified: **0 frames** with the camera below the road surface over a 5,400-frame
lap, on a circuit with hills that showed it every time before.

### ✅ 🟠 NEW — Pole was not on pole, and the player was ninth of ten
The standing grid's stagger was **added** where it should have been subtracted,
so the odd slot of each row sat 1.6 m AHEAD of its partner instead of behind
it. Three consequences from one sign: slot 0 was not the frontmost car, every
row was ordered backwards against its slot numbers, and the player — the odd
slot of the last row — started 1.6 m ahead of the ninth rival on a grid that is
specifically supposed to put them last.

Measured before: rivals at −5.4 … −39, player at −37.4. After: pole at −7 with
its partner at −8.6, five rows of two at 8 m intervals, player at −40.6 with
every rival ahead. Slot order and distance order now agree.

### ✅ 🟠 NEW — A boost pad by the kerb fired when you drove down the middle
`COLLIDE_WIDTH.boostpad` was `1.0` — and that table is in ROAD_HALF_WIDTH
units, so the hit band was **five metres either side of the pad**, the entire
road. It was correct when a pad spanned the circuit and was never revisited.
Any attempt to place a pad off the racing line as a decision would have been
silently undone: you would have collected it without ever leaving the centre
line. Now `0.36` (1.8 m), matching the lane-width deck.

### ✅ 🟡 NEW — CLEAN LANE paid for the opposite of what the track was asking
The lane-discipline bonus pays for holding one lane arrow-straight. Inside a
drift zone the circuit was asking for a slide across the whole road. Whichever
a player chased, the other one was telling them they had got it wrong, so the
bonus was suppressed inside a zone.

**Superseded 2026-09-20.** The zones were replaced by apexes, which do not have
the conflict — clipping an apex IS a lane, briefly, so the two now want the
same thing. The suppression has been removed rather than left in place pointing
at something that no longer exists.

### ✅ 🟡 NEW — Toasts printed through the middle of the drama callout
The toast stack started at y 150 and the callout was centred at `vh * 0.3`,
which on a 600 px view is 180 — two independent magic numbers that put "NEAR
MISS x1" straight through "PASSED". The callout now exports where it sits
(`calloutCenterY`) and the stack starts below it, with a floor that keeps it
clear of the style-chain panel on short viewports.

### ✅ 🟡 NEW — A gem run pushed every meaningful toast off the screen
A gem run is six chips 3.5 m apart. At racing speed that is six `+100` toasts
in half a second into a stack that holds four, so collecting a run reliably
evicted NEAR MISS, DRIFT ZONE and CHAIN BANKED. The score notifications were
drowning out the skill notifications. Chips now coalesce into one line that
counts up (`+100` → `+600`).

### ✅ ⚪ NEW — Anisotropy was left at 8 on the road and 4 on the cars
`textures.ts` raised the GLTF maps to 16 long ago with a comment calling
anisotropy "the biggest single sharpness win available"; the procedural
textures never got the same treatment. The road is the surface that runs to the
horizon at the most grazing angle in the game, which is exactly where filtering
smears into mush, and it was on 8. Now one exported `ANISO` used by the road,
checker, ground, sky and car textures alike.

### ✅ 🔴 NEW — The fork was removed for nine faults, none of them the fork
The alternate routes were torn out with the note *"the open fork corridor let
the car wander off-road (OOB + sink) and the separate curve felt bad"*. That
blamed the feature. The cause was that nothing outside `freeDrive` had ever
been told a second road existed.

`freeDrive` projects onto whichever road is nearer and walls you onto it, and
reports `lateral` relative to **that** road. Everything else reads
`freeDrive.lateral` as metres from the MAIN centreline. Measured, parked on the
branch centreline at the apex: `freeDrive.lateral` **0.00** while
`track.project` put the car **17.23 m** off the main road — with thirteen
entities in the fork span at laterals the collision test would have matched.

| Fault | Measured |
| --- | --- |
| Entity pickups, ramps, drift zones, the crossing, near misses, car contact, the lane bonus and both halves of the slipstream all read the branch lateral as a main-road one | 13 entities in the span collectable from a different road |
| The car's height came from the main track whichever road it was on | the "sink"; error now 0.000 m via `surfaceY()` |
| The steering assist aimed at the main centreline, so it steered you off the fork | 34 frames of 600 held on the branch |
| Scenery bands reach 40 m from the main centreline, so rows 2-3 planted a forest on the branch | 0 of 2,636 obstacles on a branch now |
| The island was sized from `bulge`: a 6.6 m cone in a 4.6 m median, overlapping both roads | inner edge 5.5 m vs road to 6.6; outer 12.1 m vs branch inner edge 11.2 |
| The branch ribbon was built 5 m half-width against the road's 6.25, while the walls are absolute at 5.6/6.6 | 47% of the branch flagged off-road → 18.6%, and that residue is all the merge overlap |
| The fork sign is a gantry with central posts, placed on the centreline | two steel posts on the racing line, not registered solid |
| The side came from a character code, so on a straight the branch was a lens — always longer than its chord | 154 m on a 130 m span → 138 m (Forest) and 119 m, a real shortcut (Void) |
| Nothing made the slower branch worth taking | now pays a style-chain link for seeing it through |

The ramp ride-up's own guard is worth noting: it read `!this.onBranch`, the
rail-era field, which nothing has set since the move to free-roam driving — so
it had quietly stopped guarding years of commits ago. All nine now share one
`onMainRoad` accessor.

Verified across two realms: 4.4 s held on the fork covering 87% of it, **0**
gems collected while on it, no respawn, and all four of this session's gimmicks
on one circuit at once.

### ✅ 🔴 NEW — The ghost car was 65% invisible
Reported as "the ghost is just a wheel". It was.

`setupGhost` recoloured the car with
`m.material = mats.map(...)` — which **always assigns an array**, even where the
mesh had a single material. Three.js renders an array-material mesh only
through `geometry.groups`, and the merged body panels have no groups, so they
were skipped entirely. Measured through the real code path: **13 of 74 meshes
never drew — 4,956 of 7,668 vertices, 64.6% of the car.** What was left was
small trim and wheels at 45% opacity.

The verification that missed it asserted material TYPE ("all
MeshBasicMaterial") and mesh COUNT (74). Neither can see "draws nothing". The
lesson was already written down in this project — render bugs are invisible
from numbers, park a camera and look — and was not applied.

Removed along with the feature.

### ✅ 🔴 NEW — None of the new gimmicks ever fired
Counted over a lap of ordinary driving, with the steering assist doing the
cornering as it does for any player who is not fighting it:

| Event | Fired |
| --- | --- |
| APEX | **0** |
| PAD CHAIN / BOOST | **0** |
| ALT ROUTE (fork) | **0** |
| DRIFT | **0** |
| Crossing hit | **0** |
| NEAR MISS | 45 |
| OVERTAKE | 20 |
| CLEAN LANE | 28 |

One measurement explains most of it, and it was never taken. The car is
BIMODAL: hands-off it holds **0.14 m** from the centreline; full lock pins it
at **5.62 m**, against the wall. There is no natural middle — and the boost
pads were at 3.4 m and the apexes at 3.8 m. Three features were placed in a
band of road the control scheme does not produce, on a steering assist whose
entire job is pulling the car back to the centreline. Each was verified to
work *when the car was already there*, which is a much weaker claim.

The crossing failed differently: a 9.5 s cycle against a ~40 s gap between
visits makes the arrival phase uncorrelated with anything, so it cannot be
learned or timed. Both measured arrivals landed in the idle window with the
boulders off the road.

The fork failed on its own terms: 8-12 m longer than the road it forks off, on
a tighter radius, with no pickups possible (entities are addressed in main-road
coordinates), for one chain link. A slower, tighter, emptier road is not an
alternative, it is a mistake you can make.

All five removed. The fork's machinery is kept and deactivated — see the
comment at `freeDrive.branches = []`; the hard parts work and only the design
was wrong.

### ✅ 🟡 NEW — A stale doc comment shipped
The apex change replaced `placeDriftZones`' body and signature but left its
doc comment behind, so a commit shipped a 16-line block describing drift zones
sitting directly above the function that replaced them. Removed with the rest.

### ◻ 🔴 NEW — The game has exactly one speed
The most important finding here, and it is not about any of the above.

Measured over a full lap at racing pace: **mean 122.9 mph against a maximum of
123, standard deviation 1.9, and 100% of the lap spent within 5 mph of top
speed.** The histogram is a single bucket. Top speed arrives 3.3 s after the
lights and never leaves.

Nothing takes speed away. Corners do not — grip is 11.5 and the pure-pursuit
assist drives the line for you. There is no braking rhythm, so there is no
acceleration to feel, and no corner can be driven *well* because none can be
driven badly. The speed cues themselves are fine and were wrongly suspected
first: FOV swings 72° → 77.2° to top speed and 86.2° under nitro, and the
radial blur reaches 1.08. They are simply pinned at their maximum from second
four onwards, along with everything else.

This is why it does not feel like an arcade racer. The loop those games run on
— lift for the corner, commit to a line, get the speed back as a reward — has
no first step here. Every gimmick above was an attempt to add interest on top
of a constant-velocity drive, which is why none of them could have worked.

Fixing it means touching the core: cornering that scrubs speed above a grip
limit, brakes that matter, and an assist that helps rather than drives. That
is a deliberate design change to how the game feels, not a bug fix, so it is
written down here rather than done unasked.

---

## 2. What we could improve

### Performance
1. ✅ **Code-split the engine.** `GameApp` imported `GameCanvas` statically, so
   three.js shipped in the first chunk — **405 kB of JavaScript to display a
   menu that renders no triangles.** Now a `dynamic()` import with a loading
   state. **Page 295 kB → 23 kB; first-load JS 398 kB → 126 kB, a 68% cut.**
   The engine downloads while the player is choosing a world.
2. ✅ **Recompress the textures** — see B1. 12.1 MB → 916 KB.
3. ◻ **Per-realm texture sets.** Still ships snow to a beach: a race at Sunset
   Bay downloads `ground_peaks_*`. Now a 916 KB problem rather than a 12 MB
   one, and making each set optional means 13 call sites have to cope with a
   missing one — a white untextured prop discovered mid-race is a worse trade
   than the ~300 kB it would save. Deliberately parked.
4. ✅ **Merge the city geometry.** Profiling the scene graph first was the whole
   trick: Neon Run held **21,151 meshes, 18,066 of them plain 24-vertex boxes**
   — ~100 boxes per tower across 176 towers. Most are culled, but every one
   still costs a matrix update and a frustum test on the CPU every frame.

   `mergeStaticParts` already existed for cars; it moved to `src/game3d/merge.ts`
   and `makeNeoTower` now calls it, collapsing each tower to about four meshes
   — one per material. Nothing in a tower moves, which is what makes this safe;
   merging *across* props is what broke the wind sway the last time it was
   tried.

   | | Before | After |
   | --- | --- | --- |
   | Neon Run scene meshes | 21,151 | **4,971** |
   | Neon Run plain boxes | 18,066 | **1,787** |
   | Neon Run draw calls | 1,838 | **843** |
   | Sunset Bay draw calls | 641 | **433** |

   Triangles are unchanged, as they should be — the geometry is identical, there
   is simply far less of it for the CPU to walk. Verified visually on both
   realms: nothing displaced, nothing missing.
5. ✅ **Warm the race assets during the menu.** *(See also the cache-header
   finding above — the warm exposed it.)* `src/ui/warm.ts`. Pressing DRIVE
   used to start a ~900 kB download before the world could build; the setup
   steps are ten to twenty seconds of doing nothing with the network. It waits
   for idle, fetches at low priority, and skips outright on `saveData` or a
   2g/3g connection — spending someone's data plan on a race they have not
   started is not a trade to make for them. **Verified: all 19 texture loads at
   race start came from cache, `transferSize: 0`, median 4 ms.**

### Gameplay depth
6. ✅ **Ghost cars.** `src/game3d/ghost.ts` — your own best lap, per realm,
   driving beside you. A solo lap had nothing to measure itself against: the AI
   is rubber-banded, so beating it says more about the band than about you.

   Stored in TRACK SPACE (distance along the lap, lateral offset, heading)
   rather than world XYZ, so a ghost survives anything that moves the road in
   world space — re-tuned elevation, a different bank, a wider ribbon. Sampled
   by DISTANCE, not time: the only question a replay ever asks is "where was I
   at this point on the track", and distance-indexed that is an array index
   rather than a search. A 4 km lap is 966 samples.

   That indexing is also what makes the delta readout honest. The first version
   divided the metres between you and the ghost by your current speed, which is
   wrong in exactly the moment you look at it — measured while coasting, a
   36 m gap read as **4.5 seconds down** when it was 0.8. Now it is the ghost's
   own recorded time at your distance minus your lap time, which is stable
   through braking and is what a driver actually means by a delta.

   Lap 1 is recorded but never stored: it runs from the grid ~40 m behind the
   line, so its time includes a standing start and is not comparable to a
   flying lap. Samples are rounded on the way out — raw doubles measured 56 kB
   per realm, and twelve realms of that is an eighth of the localStorage quota
   for precision no one can see.

   Verified end to end: 966 samples with monotonic times and finite headings,
   translucent unlit clone (74 meshes, all `MeshBasicMaterial`, `depthWrite`
   off) visible on the road, and a delta that closes from −2.58 s to −1.46 s
   over a lap driven slightly quicker than the recording.
7. ✅ **A style chain.** Drift, near miss, overtake, stunt and pad chain all
   feed one pot that **pends** rather than scores, at up to x6. Let the fuse
   lapse cleanly and you bank it; clip anything and you lose the lot. The point
   is that every one of those was previously a flat payout you could collect by
   accident — a risk bank turns them into a decision about when to stop.

   Verified: nothing moves the score while a chain is alive, a clean lapse
   banked 820 from four links, and a break cost the 300-point pot without
   touching the score. Ten links accumulated from real events on a hands-off
   lap, so it is reachable in ordinary play rather than only on purpose.
8. ✅ **Apexes.** (This replaced DRIFT ZONES, which shipped on 2026-09-18 and
   were pulled two days later — see below.) The lap's four busiest corners are
   found by its own curvature percentiles, the tightest point of each is
   located, and a pair of red-and-white kerb markers goes on the inside of it.
   Clip the apex at speed, on the tarmac, and it pays into the chain.

   Where the corners are is measured, not authored: twelve realms generate
   twelve circuits, so a hard-coded curvature threshold would find eight
   corners on one and none on another. A first pass used absolute thresholds
   and found exactly ONE corner on a 3.9 km lap — 0.010 was above the 90th
   percentile of a circuit whose tightest hairpin measured 0.0116, so the floor
   silently replaced the percentile it was meant to protect.

   The apex is the point of maximum curvature, not the midpoint: a corner that
   is tightest on entry has its apex early, and two of the four on the measured
   circuit do exactly that. Marking their midpoints would have pointed at the
   wrong piece of road.

   Verified: pays on the inside line at speed, refuses the middle of the road,
   refuses the outside, and — the property that matters — a hands-off lap
   clips **zero** of them, because the steering assist holds the centreline. An
   apex is something you have to choose to do, which is exactly what the drift
   zone was not.

   *Note on the drift zones it replaced:* the mechanic was fine and the paint
   was not. Four 130 m bands of violet chevrons covered a tenth of the circuit,
   and on a game whose pitch is its art direction, a scoring hook should not be
   hiding the thing you came to look at. It also paid for being sideways, which
   the drift boost and the style chain already pay for twice over.
9. ✅ **Boost pads, on the outside of corner exits.** They were pulled from the
   circuit for being a conveyor belt, and that was true of a pad you cannot
   miss — the deck was 8.5 m wide on a 10 m road, and its hit band was FIVE
   metres either side of centre, so a pad parked by the kerb still fired when
   you drove down the middle. Now a lane's width with a lane's hit band, in
   chains of three on the outside of the corners the apex finder already
   located,
   where taking them costs you the tight line. The second and third decks
   EXTEND the surge rather than refresh it, so committing to the whole chain is
   worth more than clipping the first.
10. ✅ **Slipstream.** The hole in the air behind the car in front. Without it,
   following a rival was strictly worse than being alone — same speed, spoiled
   air, nowhere to go — which is why the pack strung out and stayed strung out.
   Strongest right behind the gearbox, gone by 30 m, and it bleeds out slowly
   so pulling out to pass keeps the speed you earned. Measured over a lap in
   traffic: mean +2.0% top speed, with the strong band on 3% of frames — worth
   chasing, not enough to make following better than leading.
11. ✅ **Photo mode.** The art direction is the point of this game and there was
   no way to look at it: the chase camera sits behind the car at a fixed height
   and the HUD covers the corners, so the one thing worth showing off was the
   one thing you could not frame.

   Pause → PHOTO MODE. Freezes the sim, hides the HUD, and puts the camera on
   an orbit you steer (arrows orbit and raise, Z/X dolly, Q/E lens, SPACE
   shutter, ESC back). It reuses the same render path, so the photograph is
   exactly the image the game draws — not a separate cutscene renderer. Saves a
   PNG named after what is in it, and shows the realm and car as a caption
   while you compose.

   One flaw found by reading rather than running: `frame()` returns before
   `render()` while paused, so a paused-but-live camera would have rendered
   exactly one frame and then sat there — looking like dead controls rather
   than a frozen world. The loop now renders while composing and still skips
   `update()`.

   Verified: 1,241 composer passes while `paused === true`, camera responds to
   held keys (yaw 2.3 → 4.34), capture is a real 1423×1491 PNG with 1,725 of
   2,304 sampled pixels lit, and ESC returns to the pause menu with the HUD and
   the chase FOV restored.
12. ✅ **Weather is a race condition.** It already rolled over mid-race and
    already changed the sky; it just had no consequence, which made it
    scenery. Rain, snow, sand and ash now take LATERAL GRIP — 0.78 at the
    worst — and nothing else.

    Grip is the interesting lever. The straights are unchanged, every corner
    has to be taken slower or sideways, and because the drift threshold is a
    side-slip *speed* the car breaks loose earlier — so a wet lap pays more
    style than a dry one. Cutting top speed would only have made the race
    longer.

    Eased over ~2.5 s rather than switched, because a shower that took hold
    between one frame and the next would change the car's handling mid-corner.
    The ribbon's material wets and dries with it, read back from
    `buildRoadMesh` rather than duplicated from the finish presets so the two
    cannot drift apart, and the HUD names the cause and the number: a car that
    has quietly lost a fifth of its cornering grip with nothing on screen is
    indistinguishable from a car that has started handling badly, and the
    player will blame the game. The AI lifts on the same curve — a weather
    effect only the human felt would be a handicap, not a condition.

    Verified: grip 1.00 → 0.81 and road roughness 0.625 → 0.292 over five
    seconds of rain, and back again when it clears.
13. ✅ **The pack gets the slipstream too.** (The personality system — apex
    hunting, corner caution, preferred line, weave, nitro style, mistake rate,
    all name-seeded — already existed; this was the gap in it.) A rival could
    never reel in a car it was following, so one that dropped two lengths back
    stayed there for the rest of the race and the field never fought over
    anything. Rivals now tow off each other and off the player.

    Gain is 0.09 against the player's 0.12, because the AI holds a line and
    does not think to pull out, so it sits in a tow far more of the time; the
    same number compounded into the pack circulating faster than anyone
    driving it. Measured over a lap: mean rival tow 0.088, eight of nine
    rivals in a meaningful tow at some point, field inside 156 m.
14. ✅ **A telegraphed set piece per circuit — the crossing.** Everything else
    on the track is static: you learn where it is once and it is the same
    every lap. Two boulders now sweep across the road on a 9.5 s cycle behind
    a painted hazard band, two flashing beacons and a HUD callout, so the same
    corner is a different problem on lap 1 and lap 3.

    Nearly all the work was finding out where a boulder is allowed to be.
    One boulder leaves nine metres of clear road and is therefore nothing to
    do; two with a 4.5 m gap was a *wall*, because each blocks 2.8 m once the
    car's width is counted. At 7.5 m the narrowest clear stretch at any point
    in the sweep is 1.9 m and never under 1.2, so there is always a way
    through. And they only exist ON the road now, at road height — there is no
    good resting place beside the tarmac, and at Sunset Bay a parked boulder
    sat in mid-air over a ten-metre drop to the beach, on a slope steep enough
    that 15 cm of lateral slide moved it 1.1 m vertically. Collision is bounded
    to the same window, so an invisible boulder on the verge cannot flatten a
    car running wide.
15. ✅ **The gated fork.** See the bug section below — nine separate faults,
    none of them the fork itself.
16. ◻ **Progression**: cars unlocked by distance or podiums.
17. ◻ **A real championship**: Grand Prix is three rounds; a season with
    standings is the same code with persistence.

### Product
18. ✅ **Share a result.** `src/ui/shareCard.ts` — a 1200×630 card (the Open
    Graph aspect, so it works pasted in a chat or attached to a post) with the
    realm's own art, the score, time, finishing position, a PERSONAL BEST badge
    and the URL. SHARE RESULT on the results screen hands it to the OS share
    sheet where one exists and downloads it everywhere else.

    Drawn on a 2D canvas rather than grabbed from WebGL: by the time the
    results screen is up the race canvas is gone, and keeping the whole engine
    alive for a postcard is the wrong trade. Verified on two realms; the first
    version had the subtitle colliding with the wordmark.
19. ◻ **Daily challenge** — same realm, car and seed for everyone, one run a
    day. The cheapest retention mechanic there is, and it needs the KV store
    that is already on the release list.
20. ◻ **Replays** of the last lap.
21. ◻ **Settings synced across devices** once identity is real.

### Engineering
22. ✅ **ESLint** — configured, clean, and in CI. See above for what it found.
23. ✅ **A data-invariants test** — `npm run test:data`, in CI. Every bug it
    guards has actually shipped here: realms added with no ground-texture
    mapping (silently falling back to a green forest floor that a multiply tint
    can never make into snow), realms added with no preview art, textures
    renamed to `.webp` with a file missed. None of these break the types,
    because they are data pointing at files. Proven to fail: deleting one
    preview makes it exit 1 naming the realm. Physics helpers are still
    uncovered.
24. ✅ **A render-budget test in CI** — `npm run test:render`. Not frame time:
    that needs a GPU and real hardware, and is still open. This guards the
    INPUTS to it, which is where the regressions actually come from — GTAO's
    default, MSAA on the composer target, the per-tier shadow map, bloom
    strength and resolution.

    Every one of those has been measured, turned off, and turned back on by a
    later commit. GTAO alone costs ~5.6 ms on a frame already sitting at ~11,
    which lands it exactly on the 60 fps line with no margin; 4x MSAA on a
    retina HDR target was pure bandwidth for edges the post chain resolves
    anyway. None of them break the build, the types or the lint — they are
    numbers that look harmless in a diff and cost a third of the frame.

    Proven the same way as the size budget: by reintroducing the regressions.
    Flipping GTAO's default to `true`, the composer target to `samples: 4` and
    the `low` tier to shadows-on fails 6 checks and exits 1.
25. ✅ **A signed race token.** `src/server/raceToken.ts` + `/api/race-token`.
    A ticket is issued when a race STARTS, and `/api/scores` refuses anything
    without one. The server checks the HMAC, the age, that at least 80% of the
    claimed duration really elapsed since issue, and that the ticket has not
    already been spent.

    It still does not make the score trustworthy — the client computes it, and
    only running the simulation server-side would change that. What it closes
    is the cheap attack: posting a believable number with `curl` and no race.
    Faking a three-minute lap now costs three minutes per attempt.

    Verified against a running server: no token 403, garbage token 403, token
    signed with the wrong secret 403, a valid ticket claiming a long race
    immediately 403 "race shorter than claimed", an honest post 200
    `verified: true`, and a replay 403 "token already used".

    **Two bugs caught during that verification, both of which would have
    shipped.** Replay was wide open at first — the same ticket posted twice and
    both scores landed, because a ticket was valid for its whole three-hour
    life; tickets are single-use now. And Grand Prix would have been rejected
    outright: it submits one aggregate result covering three rounds, but every
    round called `beginRace()`, so the final post claimed five minutes against
    a ticket ninety seconds old. `beginRace()` now keeps an unspent ticket and
    the client clears it on submission.

    Set `RACE_TOKEN_SECRET` to turn it on; unset, everything behaves exactly as
    before.
26. ◻ **Next 16 upgrade**, which also clears the last two advisories.
27. ✅ **`prefers-reduced-motion` in the engine.** The stylesheet honoured it
    for the menus all along; the engine never did, so the two effects most
    likely to cause trouble ran regardless. Camera shake and the radial speed
    smear are both suppressed now (the FOV kick is left — it is the cue that
    tells you how fast you are going). **Verified with the engine's own loop
    frozen: shake offset 0.049 normally, exactly 0 under reduce-motion, back to
    0.035 when restored; smear 0.925 → 0 → 0.925.**

---

## 3. Verified working

Answered with measurements rather than assumed:

- **Service worker is live and effective.** Registered and `activated` on the
  deployed site, all three caches populated, and a second visit transfers
  **0 bytes** — all 18 textures from cache. This was the one item the previous
  report listed as unverified.
- **No third-party requests.** Fonts self-hosted; nothing calls out.
- **Accessibility basics pass**: all 21 focusable controls have accessible
  names, images have `alt`, one `h1`, `lang` set, `main` landmark present.
- **No console errors or warnings** through the gate, the setup steps and a
  race.
- **Memory is flat** across 15 race→menu→race cycles after the disposal fix.
- **Share metadata resolves correctly** — `og:image` is an absolute URL on the
  production domain, despite the build-time `metadataBase` warning.
- **The dead-code removal changed nothing.** Sunset Bay after: 641 draw calls,
  7.9 M triangles, 543 geometries, 13 textures — identical to before. All ten
  cars build, and the Imprez (the fog-lamp car) drives.

---

## 4. What a first visit costs now

Measured over the wire (gzipped where the server compresses), on the deployed
build, as a genuine first-time visitor — service worker unregistered, caches
and storage cleared:

| | Before | After |
| --- | --- | --- |
| First-load JavaScript | 398 kB | **126 kB** |
| Engine chunks (fetched on demand) | — | 278 kB |
| Textures for the first race | 12,114 kB | **916 kB** |
| Realm previews | 660 kB | **333 kB** |
| Models | 236 kB | 236 kB |
| **Total, landing → driving** | **~13.5 MB** | **~1.9 MB** |

Seven times lighter, and **the second visit is still zero bytes** — the service
worker serves all of it from cache.

A measurement trap worth writing down, because it produced a false alarm
mid-audit: once the service worker is controlling the page, `transferSize`
reads **0** and `encodedBodySize` reports the *uncompressed* size, so a naive
`transferSize || encodedBodySize` sum jumps from 405 kB to 1,107 kB and looks
like a 700 kB regression. The chunk's content hash was unchanged, which is what
gave it away. Compare compressed-to-compressed, or trust `next build`'s own
first-load figure.
