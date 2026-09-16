# Duskline

A browser racing game built with Next.js + TypeScript + Three.js. Twelve
worlds, ten procedurally-built road cars, procedural audio. CC0 glTF models
from Kenney for scenery (see `public/models/LICENSE-*`).

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
  - `HomeScreen.tsx` — four-step setup (world/car/mode/go), sign-in gate,
    leaderboard sheet. No name entry: you are a numbered guest or a Google
    account (`src/ui/identity.ts`).
  - `GameCanvas.tsx` — hands a container div to `Game`, stops it on unmount
- `src/game3d/` — the active Three.js engine:
  - `engine.ts` — `Game` class: fixed-timestep loop, driving/altitude/nitro/
    transform state, entity collisions (distance-bucket lookup), scoring,
    laps, AI update + ranking, camera presets, monster/sword combat, HUD +
    minimap orchestration
  - `realms.ts` — the realms (control points + palette + scenery mix + banking,
    off-camber, hill scale, coast side/sea). Twelve offered, five hidden. Pure
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

Offered modes: classic, endless (Neon Run), grandprix, spacewars. `transform`
is archived — off the picker, still wired up. `timetrial` and `nitro` were
deleted from `GameMode` entirely.
- `src/game/` — the original pseudo-3D canvas engine. Still provides shared
  pieces to game3d: `input.ts` (keyboard), `render.ts` HUD/toast drawing
  (drawn on a 2D canvas layered over WebGL), and the `GameMode`/`GameResult`
  types. The full 2D engine remains runnable if GameCanvas points back at it.
- `src/ui/storage.ts` — the ONLY place localStorage is touched. Namespaced
  `duskline-*`, with a lazy fallback that adopts the pre-rename
  `fantasy-racer-*` keys so a returning player keeps their car and scores.
- `src/ui/leaderboard.ts` — score table + global board API
- `src/ui/report.ts` — crash reporting, DSN-gated
- `src/game3d/capability.ts` — WebGL gate + `lowPower` hint

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

`RELEASE.md` — what is left before launch (two items, both needing something
outside the repo). `AUDIT.md` — open bugs and the improvement list.
`REPORT.md` — what changed and why. TODO.md and PLAN.md are historical.
