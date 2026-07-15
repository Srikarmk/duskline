# Fantasy Racer — Progress Log

A fantasy kart racer that started as a single 800×600 canvas and grew into a
full 3D game with four realms, AI opponents, a transforming sword-mech, drift,
stunts, a championship mode, sound, and a global leaderboard.

**Play it:** https://fantasy-racer.vercel.app

![Enchanted Forest, with bloom](screenshots/forest.jpg)
![Void Circuit — anti-gravity glass tube](screenshots/void.jpg)
![Power-ups — item boxes on track, missile held in the slot](screenshots/powerups.jpg)

> Screenshots live in `docs/screenshots/`. They're captured straight from the
> game canvas (512×384 JPEG). Add more any time — the renderer keeps its
> drawing buffer, so `renderer.domElement.toDataURL()` works.

---

## The evolution, milestone by milestone

Each milestone below shipped and deployed. Times are the order things were
built, not calendar dates.

### 1. Straight road (pseudo-3D)
A vanilla-JS/Canvas OutRun-style renderer: a list of road segments projected
back-to-front with perspective division. Accelerate, brake, steer, rumble
strips, a speed HUD. First playable.

### 2. Curves, hills & mechanics
Curve + elevation on segments, centrifugal force, an out-and-back track,
ramps + mid-air spins, gems, nitro, rocks to dodge, lane-discipline bonuses,
3 laps + timer. Parallax mountains, stars, fog.

### 3. Game shell + Transformer mode
Home screen with name entry and a localStorage leaderboard, countdown/finish
states, and a second mode: grab an orb → morph into a mech that flies and
smashes rocks.

### 4. Next.js + TypeScript
Rebuilt on the Next.js App Router with a strict rule that survives to today:
**the game engine never imports React, and React never touches in-race
state.** They talk only through a `GameOptions` (mode/realm + `onFinish`).

### 5. Real 3D (Three.js)
Threw out the pseudo-3D renderer for actual Three.js: a Catmull-Rom circuit,
a road-ribbon mesh, a chase camera, night sky dome, and **CC0 glTF models**
from Kenney (car + nature kits) for the racer and scenery.

### 6. Realism + maps + AI
Three distinct realms (Enchanted Forest, Ember Wastes, Crystal Peaks) with
their own tracks and palettes, a minimap, **3 AI opponents** with live race
position, 4 modes, camera angles (chase/cinematic/hood), a better mech, and
monster combat in Transformer mode.

### 7. Sound + combat + Grand Prix + global board
Fully **procedural Web Audio** (no assets): a speed-tracking engine hum,
per-event SFX, and an ambient music loop. Monsters that patrol and charge;
opponent bumping. **Grand Prix**: all three realms back-to-back for a
championship. A **global leaderboard** API (Vercel KV / Upstash with a local
fallback).

### 8. Drift, stunts, tube tracks, textures
A lateral-velocity **drift** model (brake+steer to slide, release for a
boost) that fixed the on-rails feel. **Stunt variety**: barrel rolls + flips
+ combos. A **Void Circuit** realm: an anti-gravity glass tube in deep space.
Textured car via the real Kenney atlas.

### 9. Grid, opponents & generated tracks
**8 AI opponents**; the player starts **mid-pack (P5 of 9)** on a real grid.
Tracks are now **generated** as smooth "wobbly-circle" loops with bounded
curvature — no more hand-placed hairpins pinching the road. Full-width menu.

### 10. Visual glow-up + pause/settings (this pass)
**Bloom post-processing** so gems, rails, crystals, nitro, and the sword
actually radiate; brighter, warmer lighting so nothing reads as a black
silhouette. A rebuilt **glowing jump ramp** that sits flush on hills. A
**pause menu** (Esc/P) with **settings** — music/SFX volume, glow toggle,
default camera — all persisted.

### 11. Toned-down glow + power-ups & combat (this pass)
The bloom from milestone 10 was **too strong** — halos everywhere. Dialed it
back (strength 0.9 → 0.4, threshold 0.68 → 0.85) so gems and crystals glint
instead of flare. Then the first roadmap item shipped: **power-ups**. Item
boxes line the track; drive through one to grab a random item into your slot,
fire it with **E**:

- **BOOST** — a short burst above top speed.
- **SHIELD** — a cyan bubble that absorbs the next rock, monster, missile, or
  mine for a few seconds.
- **MISSILE** — a homing projectile that locks the nearest opponent ahead,
  stuns them, and scores a hit.
- **MINE** — drop a hazard behind you; whoever hits it spins out.

Opponents fight back — they scatter mines of their own. Getting stunned makes
a racer spin and bleed speed, so a well-timed missile can flip a position.
Shields block everything and flash **BLOCKED**. Projectiles clear on each new
lap so nothing lingers across the line.

### 12. Full-width, textures, karts & a clean grid (this pass)
A big look-and-feel pass:

- **Full-width, responsive canvas.** The race used to sit letterboxed in a
  4:3 box; now it fills the whole browser at its true aspect ratio and resizes
  live (a `ResizeObserver` re-sizes the renderer, bloom, camera and HUD). The
  HUD was rewritten to be resolution-aware and anchors to the real edges.
- **Real textures & a fuller world.** Ground is now organic multi-scale
  terrain (soft patches + grain, not flat color); the road is proper asphalt
  with aggregate, tire-wear bands, hairline cracks, crisp lane dashes and
  rumble strips. Every realm gets an **ambient particle field** — fireflies in
  the forest, rising embers in the wastes, falling snow on the peaks, drifting
  stardust in the void — plus a lit **START / FINISH gantry** over the line.
- **Four kart types with stats.** COMET (all-rounder), BOLT (top-speed),
  TITAN (heavy launcher), WISP (razor handling) — each a distinct hand-built
  low-poly hull with wheels, canopy, wing/fin and glowing trim. Stats
  (speed / accel / handling, shown as ★ ratings in a new **garage** on the
  home screen) feed real physics multipliers. Opponents now drive an assortment
  of types too, so the grid shows genuine variety.
- **Streamlined starting grid.** Karts line up on a clean staggered 3-column
  grid — no more overlapping/clumped spawns — with the player mid-pack at
  **P5 of 9**.

![Full-width grid start — nine distinct karts, staggered lanes](screenshots/grid.jpg)
![Full-width race — textured road, fireflies, the pack ahead](screenshots/race.jpg)

### 13. Grip, weight & a graded look (this pass)
The driving used to feel like a sprite sliding across a screen — on rails, no
weight. Studied Mario Kart / Hot Shots Racing / Asphalt for what makes them
feel and read well, and rebuilt around it:

- **Grip-limited handling.** Steering now asks the tires for lateral
  acceleration, and the tires have a **grip ceiling** — take a corner too fast
  and you wash wide (understeer), so you have to brake and commit to a line.
  **Weight transfer** (braking loads the front for sharper turn-in),
  **steering inertia** (the wheel eases in and self-centers), **speed-sensitive
  steering** (heavier at top speed), and tire scrub that settles the car. The
  kart visibly yaws into the slip.
- **Camera with feel.** FOV kicks with speed and flares on boost, the view
  banks into corners and looks *ahead into* the turn, and impacts / hard
  landings shake the camera.
- **A graded, finished look.** **ACES filmic tone mapping** + an output pass
  give richer colours and smooth highlight roll-off (the moons and neon now
  bloom cleanly). An **Asphalt-style speed overlay** — vignette + radial
  streaks that build with speed and flare on boost. Glowing **edge-marker
  posts** line the track for a real-circuit look and a speed reference that
  whips past.

![Grip + grading — banked camera, edge posts, speed streaks](screenshots/handling.jpg)

**Tuning after playtest feedback:** the tracks were **flattened** so the road
hugs the terrain instead of sitting on a tall embankment (no more "valley"
beside the road); **ambient particles cut** by ~70% and kept low so they don't
bury the cars; **out-of-bounds tightened** (you can put a wheel on the grass
but can't drive off into the scenery); grip made a little more forgiving so you
hold the road; and the **contrast softened** (lifted ambient light + lower
exposure) so it's less harsh neon-on-black.

**Second fix round:** ramps had a collision window narrower than the ramp
itself, so you could drive straight through one — widened it (you now launch
reliably) and added **four ramp kinds** (standard / mega / kicker / wide) with
their own launch power and colour. Item boxes only respond when your slot is
empty; hitting one while full now shows a **"SLOT FULL"** prompt instead of
silently doing nothing, and pickup tolerances were widened so gems/boxes catch
reliably. And the **motion-sickness culprits** were dialled right back — the
FOV kick, camera bank, look-ahead swing and shake are now gentle, and the speed
streaks no longer strobe (re-seeded ~5 Hz, far fewer, faint), with bloom
reduced so bright edges don't halo.

### 14. Real textures, curved ramps & a brighter world (this pass)
The long-standing ask: **texture**. Everything was flat-shaded solid colour, so
nothing read as a real surface. Added a procedural texture module and wired it
through:

- **Cars** wear brushed-metal panelling (a grayscale map that multiplies the
  livery colour, plus a bump map for seams + rivets that catch the light).
- **Road** is proper asphalt now (colour map + aggregate bump — grain and
  hairline relief), **ground** has terrain bump, and **rocks / crystals** get
  cracked-stone colour + bump. The CC0 nature props (trees, mushrooms) were
  switched to a lit, lightly bump-textured material so they stop looking flat.
- **Curved ramps.** The ramps were straight wedges; they're now genuinely
  **curved** surfaces (built from a slope profile) — a smooth standard, a
  concave mega kicker, a sharp late-kick, and a quarter-pipe — with glowing
  rails that follow the curve.
- **Ramp launches no longer throw you off track** — you launch straight (no
  sideways carry), snap toward the ramp's centre, and land back on the road.
- **Brighter, clearer world.** The scenes were so dark the textures (and the
  cars) were hard to see and everything read as harsh neon-on-black. Raised the
  key light, ambient and exposure so surfaces and their texture actually read,
  which also softened the contrast.

![Textured asphalt, brushed-metal car, brighter readable world](screenshots/textured.jpg)

**Polish round:** ramps sometimes did nothing because they'd been centred in
one lane while the hit window was narrower than a lane — now they **span the
full road** (and the window with them), so you launch from any line. The
**glow was dialled back** (bloom + emissive intensities down, edge-post markers
and neon kerbs dimmed) so it's less distracting, and the forest gets
**per-instance colour variation** so it's not a wall of identical trees.

---

## Where it stands now

- **4 realms**: Enchanted Forest, Ember Wastes, Crystal Peaks, Void Circuit
- **5 modes**: Classic, Time Trial, Nitro Sprint, Transformer Rush, Grand Prix
- **9-racer grid** with live position + a top-down minimap
- **Grip-limited handling** (weight transfer, drift + boost) with a camera
  that banks and kicks FOV; barrel-roll/flip **stunts** with combos
- **Transformer mech** with an energy sword + monster combat
- **Power-ups**: boost / shield / homing missile / mines, item boxes, and
  opponents that fight back — press **E** to fire
- **Bloom** + **ACES tone mapping**, speed-FX overlay, edge-post markers,
  procedural sound, pause + settings
- **Global leaderboard** (activates fully once a KV store is connected)

**Stack:** Next.js 15 · React 19 · TypeScript · Three.js · Web Audio ·
Vercel. Assets: Kenney CC0 kits. ~60 fps (measured ~1.4 ms/frame with bloom).

---

## Gameplay roadmap (next)

The look and UX are in good shape; the next arc is depth of play.

- ~~**Power-ups & combat**~~ — ✅ shipped in milestone 11: item boxes, boost,
  shield, homing missile, mines, and opponents that fight back.
- **Karts & progression** — unlockable karts with distinct speed / accel /
  handling stats, gems as currency, a garage/select screen, unlock
  milestones.
- **More content & routes** — shortcuts and alternate paths, hazards,
  weather / time-of-day variety, more tracks and modes.
- **Feel & polish** — real counter-steer drift, boost chaining, speed lines,
  screen shake, dynamic camera, juicier hit/pickup feedback.

Also open: textured foliage (the nature kit ships no atlas — needs custom UV
maps), banked curves, a shared KV leaderboard, and touch controls for mobile.
