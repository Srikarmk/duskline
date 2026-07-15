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

---

## Where it stands now

- **4 realms**: Enchanted Forest, Ember Wastes, Crystal Peaks, Void Circuit
- **5 modes**: Classic, Time Trial, Nitro Sprint, Transformer Rush, Grand Prix
- **9-racer grid** with live position + a top-down minimap
- **Drift + boost**, barrel-roll/flip **stunts** with combos
- **Transformer mech** with an energy sword + monster combat
- **Power-ups**: boost / shield / homing missile / mines, item boxes, and
  opponents that fight back — press **E** to fire
- **Bloom** lighting (toned down), textured car, procedural sound, pause + settings
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
