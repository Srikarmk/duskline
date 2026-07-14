# Fantasy Racer

A 3D fantasy kart racer built with Next.js + TypeScript + Three.js, using CC0
glTF models from Kenney (see `public/models/LICENSE-*`).

## Commands

- `npm run dev` — dev server at http://localhost:3000
- `npm run build` — production build
- `npm run typecheck` — `tsc --noEmit`; run after engine changes

## Architecture

The core rule: **game logic never imports React, and React never touches
in-race state.** React owns the menus (home screen, leaderboard); the engine
owns the race. They communicate only via `GameOptions` (mode + `onFinish`
callback, which delivers a `GameResult`).

- `app/` — Next.js App Router shell (all client components):
  - `GameApp.tsx` — screen state machine: home ↔ race
  - `HomeScreen.tsx` — name entry, mode select, leaderboard display
  - `GameCanvas.tsx` — hands a container div to `Game`, stops it on unmount
- `src/game3d/` — the active Three.js engine:
  - `engine.ts` — `Game` class: fixed-timestep loop, driving/altitude/nitro/
    transform state, entity collisions (distance-bucket lookup), scoring,
    laps, AI update + ranking, camera presets, monster/sword combat, HUD +
    minimap orchestration
  - `realms.ts` — the 3 realms (control points + palette + scenery mix). Pure
    data, no three.js import, so the home screen can read realm metadata.
  - `track.ts` — closed 3D CatmullRom circuit with elevation, road-ribbon +
    grass-verge meshes, procedural textures, curvature, minimap sampling
  - `objects.ts` — sky dome, textured ground, mountain ring, instanced
    clutter, pickups, crystal clusters, monsters, the mech (with sword),
    opponent tinting, effects
  - `ai.ts` — `Opponent`: follows the track, changes lanes, eases through
    curves; engine feeds it a rubber-banded target speed each frame
  - `minimap.ts` — top-down circuit + racer dots on the HUD canvas
  - `assets.ts` — GLTF loading (redirects Kenney's missing palette texture to
    a white pixel; converts unlit materials to lit), model instancing helper
  - `constants.ts` — all tuning (meters, m/s), AI + camera presets; tweak here

## Modes, realms, controls

Modes live in `MODE_CONFIG` in engine.ts (laps / opponents / orbs / monsters /
startNitro). Realms live in `realms.ts`. Both are chosen on the home screen and
passed via `GameOptions`. Controls: arrows/WASD drive, **SPACE = nitro**,
**SHIFT = fly** (mech), **C = cycle camera**.
- `src/game/` — the original pseudo-3D canvas engine. Still provides shared
  pieces to game3d: `input.ts` (keyboard), `render.ts` HUD/toast drawing
  (drawn on a 2D canvas layered over WebGL), and the `GameMode`/`GameResult`
  types. The full 2D engine remains runnable if GameCanvas points back at it.
- `src/ui/leaderboard.ts` — localStorage score table + last-used name

## Game coordinates

Everything gameplay-related lives in **(distance along track, lateral
offset)** space: `position` is meters along the curve, `playerX` is -1..1
across the road (|playerX| > 1 = off-road grass, > 2.3 = out of bounds).
Entities store the same pair, so collision = distance window + lateral
overlap. Only rendering converts to world XYZ via `Track.pointAt`.

`window.__frGame` exposes the running engine in dev builds (fields are
TS-private but reachable from the console) — used for testing transform,
laps, and the finish flow without full races.

## Roadmap

See TODO.md for phase status; PLAN.md for the original design.
