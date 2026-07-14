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
    laps, chase camera, HUD orchestration
  - `track.ts` — closed CatmullRom circuit, road-ribbon mesh with procedural
    canvas texture, precomputed signed curvature, start-line mesh
  - `assets.ts` — GLTF loading (redirects Kenney's missing palette texture to
    a white pixel; converts unlit materials to lit), model instancing helper
  - `objects.ts` — sky dome, ground, pickups (gems/nitro/orbs/ramps),
    crystal clusters, the primitive-built mech, flame/under-glow effects
  - `constants.ts` — all tuning (meters, m/s); tweak feel here
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
