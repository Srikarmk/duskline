# Fantasy Racer

A pseudo-3D (OutRun-style) fantasy kart racer built with Next.js + TypeScript +
Canvas 2D. No game engine, no runtime dependencies beyond React/Next.

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
  - `GameCanvas.tsx` — mounts `Game` in a `useEffect`, stops it on unmount
- `src/game/` — framework-agnostic engine, plain TypeScript:
  - `engine.ts` — `Game` class: fixed-timestep loop (60 Hz update, rAF render),
    driving/altitude/nitro/transform state, collisions, scoring, laps
  - `road.ts` — segment list with curves + hills, track builder, sprite
    placement (deterministic PRNG), `project()` perspective math
  - `sprites.ts` — procedural sprite drawing + per-type scale/collision widths
  - `render.ts` — canvas drawing: parallax background, segments, sprites,
    player (kart + mech), HUD, toasts
  - `input.ts` — keyboard state (arrows/WASD, Shift = nitro, Space = fly)
  - `constants.ts` — tuning values and realm color palettes; tweak feel here
- `src/ui/leaderboard.ts` — localStorage score table + last-used name

In dev builds the running `Game` instance is exposed as `window.__frGame` for
debugging (all fields are TS-private but reachable from the console).

## Rendering model (pseudo-3D)

The track is segments of `SEGMENT_LENGTH` world units. Each frame, segments
from the camera forward (`DRAW_DISTANCE` of them) are projected with
perspective division and drawn front-to-back, clipping against `maxY` so
hidden geometry is skipped. Curves will be faked by accumulating per-segment
horizontal drift (phase 2) — nothing is real 3D.

`playerX` is normalized: -1..1 spans the road; beyond that is off-road (grass
drag applies).

## Conventions

- Speeds/positions are in world units per second; `dt` is seconds. All tuning
  constants derive from `MAX_SPEED`/`SEGMENT_LENGTH` in `constants.ts`.
- Canvas is fixed 800×600 logical pixels, scaled by CSS (4:3, pixelated).
- Colors come from the `COLORS` palette object — never hardcode hex values in
  render code, so realm themes can swap palettes later.

## Roadmap

See TODO.md for phase status; PLAN.md for the full design.
