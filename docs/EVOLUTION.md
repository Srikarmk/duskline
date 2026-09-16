# Duskline — Evolution

**From a 200-line pseudo-3D canvas prototype to a textured 3D arcade kart racer**, built
with Next.js 15, React 19, TypeScript and Three.js. Live at
**[duskline.vercel.app](https://duskline.vercel.app)**.

This page is the before → after story in pictures — drop the montage into a post, or
walk the six stages below.

---

## The one-image story

![Duskline evolution — six stages from prototype to today](screenshots/evolution.jpg)

---

## The six stages

### 01 · Prototype — pseudo-3D canvas
The very first playable build: a single-file **pseudo-3D road renderer** drawn on a 2D
canvas (projected road segments, parallax scenery, a hand-drawn HUD). No 3D engine yet —
just math, `<canvas>`, and a drivable kart.

![Prototype](screenshots/origin.jpg)

### 02 · Real 3D + textures
Rebuilt on **Three.js**: a genuine 3D `CatmullRom` track with elevation, hills and a chase
camera, dressed with procedural surfaces and per-realm lighting and fog.

![Real 3D](screenshots/textured.jpg)

### 03 · PBR materials
Swapped procedural surfaces for **photoreal CC0 PBR textures** (Poly Haven) — ground, road,
rock, bark and metal, each with albedo + normal maps, under ACES filmic tone mapping and
bloom.

![PBR materials](screenshots/real-assets.jpg)

### 04 · A field of rivals
A **9-racer grid** with deterministic, name-seeded AI personalities (corner caution, lane
bias, aggression, boost style) lined up under a start/finish gantry.

![9-racer grid](screenshots/grid.jpg)

### 05 · Hand-modeled arcade cars
Faceted, low-poly **"Hot Shot Racing"–style cars** built from scratch in code — stepped
hulls, flared arches, glass greenhouses, visible drivers — across four themed realms.

![Arcade cars](screenshots/stage2-cars.jpg)

### 06 · An arcade racer
Grip-limited arcade handling with **drift-boost, power-ups, boost pads, ramps and jumps**
across **eight realms, ten karts** and a Grand Prix mode.

![Today](screenshots/boost-pads.jpg)

---

## The chapters since — making it *feel* like a game

The montage above is how it came to *look* like a game. The harder, more interesting work
was making it *feel* like one — and, eventually, run like one.

### The world went solid
Props stopped being scenery you ghost through. Trees, rocks and buildings are now **real
obstacles** — hit one and you're shoved clear, your speed scrubs and sparks fly. Rivals are
solid too: **ram one Asphalt-style and it spins out** while you punch away on a boost. Going
off-track isn't a wall either — you get a grace window, then a clean respawn right where you
left the ribbon.

### A fair fight
The AI grid was re-tuned into an actual race: the pole rival matches your top speed and the
field strings out by personality, rubber-banded so one bad lap doesn't end your day — but
**capped at your nitro ceiling** so nobody rockets away uncatchably. It's a fight you win
with clean lines and well-timed boosts.

### Sound with a pulse, and drama on screen
The sleepy ambient loop became a **driving 4-bar groove** — kick, snare, hats, a rolling
bassline and an arpeggiated lead — that **lifts with your speed and nitro**, so the track is
flat-out when you are. Big call-outs punch in for the moments that matter: **OVERTAKE!** (with
the place you just took), **PASSED**, and **FINAL LAP**.

### The payoff
Crossing the line lands on a results screen where your **finishing position is the hero** —
gold/silver/bronze podium glow, your score and personal best, a one-tap rematch — with
championship and leaderboard screens cut to match.

---

## The engineering war-story — 33 → 85 fps

It looked finished. It didn't *feel* finished — the driving wasn't smooth. So instead of
guessing, I profiled it live in the running engine:

- The **physics was free**: ~0.05 ms/frame. Game logic was never the problem.
- The whole cost was **rendering**, and it was **draw-call bound** — the scene was **~12,500
  separate meshes** (but only 800k triangles, which a GPU eats for breakfast). Dropping the
  resolution did nothing; the cost was per-object CPU overhead.

The scene was heavy because every prop — every tree, rock and building — was a little cluster
of **5–8 sub-meshes**, one draw call apiece. Two fixes:

1. **Tighter shadows.** The sun's shadow frustum was drawing thousands of *distant* objects
   into the shadow map for shadows you can't even see. Shrinking it culls them by distance —
   and, as a bonus, the same shadow map over a smaller area comes out *sharper*.
2. **Batched scenery — in local space.** Each prop's sub-meshes now collapse into one mesh per
   material. The subtle part: the foliage **wind shader keys its sway off local vertex
   height**, so the merge had to happen in each prop's *own* space — a naïve world-space merge
   would've made every tree flail. It's fully defensive: anything it can't safely batch it
   leaves untouched, so it can never change how a prop looks.

Result, measured on a forest race:

| | before | after |
|---|---|---|
| Meshes / draw calls | 12,474 | **5,627** |
| Render time | ~24–30 ms | **11.75 ms** |
| Effective FPS | ~33 | **~85** |

Same lush forest, pixel-for-pixel — **2.5× the framerate**.

---

## Ready-to-post caption

> I built a 3D fantasy kart racer that runs entirely in the browser 🏎️✨
>
> It started as a 200-line pseudo-3D road on a `<canvas>` — and grew into a real Three.js
> game: eight PBR-textured worlds, ten hand-modeled low-poly karts, an 8-car AI grid with
> distinct personalities, a **physically solid world** (ram a rival and it spins out),
> **music that builds with your speed**, and drift-boost across four modes.
>
> The lesson I loved most: it *looked* done but didn't *feel* smooth. So I profiled it —
> found the render was draw-call bound on ~12,000 scenery meshes — and batched them per-prop
> (carefully, because the wind-sway shader keys off local vertex height). **33 → 85 fps, with
> the look untouched.**
>
> Stack: Next.js 15 · React 19 · TypeScript · Three.js · Web Audio — on Vercel.
> The rule that kept it sane: the game engine never imports React, and React never touches
> in-race state.
>
> Play it 👉 duskline.vercel.app
>
> #gamedev #threejs #webgl #typescript #nextjs #react #indiedev #performance

---

*Montage regenerated from in-game captures via `scripts/montage` — see
[PROGRESS.md](PROGRESS.md) for the full milestone-by-milestone devlog.*
