# Fantasy Racer — what's left before this is public

Written 2026-09-13. This is the honest list, not a wish list. Everything here
is something that will bite when real people hit it, ordered by whether it
*blocks* a public launch.

Legend: **[BLOCKER]** must be done first · **[SHIP-SOON]** days after launch is
fine · **[LATER]** real work, not urgent.

---

## 1. Data and persistence

### [BLOCKER] The leaderboard is a lie across devices
`src/ui/leaderboard.ts` keeps scores in `localStorage`. The home screen shows a
**GLOBAL** tab next to **THIS DEVICE**, and Global currently shows the same
local data. The moment two people compare scores, that's an obvious bug.

Either wire up a real store or remove the Global tab before launch. A real
store needs:

- **Database.** Postgres is the default choice on Vercel (Neon/Supabase both
  fine). One table is enough to start:
  `scores(id, name, car, realm, mode, laps, time_ms, score, created_at)`.
- **Write path.** `app/api/scores/route.ts` already exists as a stub — it needs
  a real `POST` that validates and inserts, and a `GET` that returns a top-N
  per (realm, mode).
- **Anti-cheat, at least token effort.** The client currently computes the
  score and would POST whatever it likes. Minimum viable: rate-limit by IP,
  cap implausible values (a lap time below the theoretical minimum for the
  car/realm, a score above what the pickup count allows), and reject
  mismatched (time, score, laps) triples. Anything stronger means running the
  sim server-side, which is not worth it for this.
- **Name moderation.** Free-text names go on a public board. A blocklist and a
  length cap at minimum.

### [BLOCKER] No privacy notice, and we store a name
Even a localStorage-only build stores a user-entered name. If the leaderboard
goes server-side that's personal data leaving the device. Needs a one-page
privacy note and a line on the name entry saying the name will be public.

### [SHIP-SOON] No migration for saved data
`fantasy-racer-car` in localStorage holds a `CarId`. The car IDs were renamed
wholesale (`comet` → `f40` etc.) and the realm IDs have grown. An old visitor
gets `CAR_SPECS[undefined]`. There's a guard on the car read but the saved
*scores* still carry dead realm/car IDs and will render blank. Add a version
key and drop or remap old entries.

---

## 2. Correctness and robustness

### [BLOCKER] No error boundary
If `Game.init()` throws — a bad GLTF, a WebGL context failure, an out-of-memory
on a weak GPU — the canvas is black and nothing tells the user. Needs a React
error boundary around `GameCanvas` and a "something broke, back to menu"
screen.

### [BLOCKER] No WebGL capability check
The engine assumes WebGL2, float render targets, and a working PMREM. On
hardware without them it fails silently. Detect up front and show a plain
message instead of a black screen.

### [SHIP-SOON] Unbounded memory across races
Each race builds a new `Game`, new textures, new geometry. `stop()` exists but
I have not audited that every texture/geometry/material is disposed. Play
twenty races in one session and find out. Needs a leak test: race → menu →
race ×20, watching `renderer.info.memory`.

### [SHIP-SOON] The dev-only preview writer ships in the bundle
`app/api/devpreview/route.ts` writes files to disk. It refuses when
`NODE_ENV === "production"`, which is correct on Vercel, but it should not be
in the production bundle at all. Move it behind a build-time exclusion or
delete it and regenerate previews locally when needed.

---

## 3. Performance

### [BLOCKER] No performance floor established
Everything has been tuned on one machine. There is no data on a mid-range
laptop, an integrated GPU, or a phone. Before launch: measure median frame
time on at least a low-end integrated GPU, and add a quality toggle (shadow
resolution, scenery density, the radial blur, bloom) that a user can drop.

Known heavy spots, in order: scenery draw calls, the GTAO pass (off by
default — keep it off), shadow map size, and now 108 meshes × 10 cars.

### [SHIP-SOON] No frame-time telemetry
There is no way to know whether real users are getting 60 fps. A simple
opt-in counter posted with the score would answer it.

### [LATER] Mobile is unhandled
Touch controls do not exist, the HUD is laid out for a wide viewport, and the
texture budget assumes desktop VRAM. Either commit to mobile properly or
detect and tell the user it's desktop-only.

---

## 4. Audio

### [BLOCKER] Music is not licensed
Whatever is playing needs to be either original, CC0, or properly licensed,
with attribution recorded. This is the single easiest thing to get sued over.
Same audit for every model and texture: `public/models/LICENSE-*` covers the
Kenney assets, but the PBR textures in `public/textures/` need their source
and licence written down in the repo.

### [SHIP-SOON] No audio autoplay handling
Browsers block audio until a user gesture. If the first race starts silent
there is no recovery and no prompt.

---

## 5. Content and polish

### [SHIP-SOON] Three modes were removed, one archived
Time Trial and Nitro Sprint are off the picker; Transformer Rush is archived.
They still exist in `GameMode` and `MODE_CONFIG`. Decide whether to delete
them properly or finish and restore them — leaving dead branches in the union
means every `Record<GameMode, …>` carries entries nothing can reach.

### [SHIP-SOON] Realm previews go stale
`public/previews/realm-*.jpg` are renders of the game. Every art change makes
them wrong. They were regenerated on 2026-09-12; regenerate before launch.

### [LATER] Nine realms have no bespoke landmarks tuned
Six photo realms got a landmark pass; the older realms (forest, peaks, void,
circuit, metro) predate the current art direction and have not been revisited.

### [LATER] No tutorial or controls screen
Controls are a single line of text on the last step. There is no pause-menu
reference and no first-run explanation of drift, nitro or ramps.

---

## 6. Release mechanics

### [BLOCKER] No analytics or error reporting
Launching blind means never finding out what broke. Minimum: a client error
reporter (Sentry or equivalent) and basic page analytics.

### [SHIP-SOON] No SEO or share metadata
No Open Graph image, no description. Every share link will look broken.

### [SHIP-SOON] The repo is private with no licence
Decide: source-available, or closed with only the deployment public. Either
way the asset licences must be honoured in a visible `CREDITS`.

### [LATER] No CI
Nothing runs `tsc` or the build on push. A broken commit reaches production
the moment it lands.

---

## Suggested order

1. Licensing audit (music, textures, models) — legal, and it can invalidate art.
2. Error boundary + WebGL check — stops black screens.
3. Leaderboard: either the DB or remove the Global tab.
4. Performance floor + quality toggle.
5. Analytics/error reporting.
6. Privacy note, name moderation, saved-data migration.
7. Everything else.
