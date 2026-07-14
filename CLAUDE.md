# Fantasy Racer

A pseudo-3D (OutRun-style) fantasy kart racer built with Next.js + TypeScript +
Canvas 2D. No game engine, no runtime dependencies beyond React/Next.

## Commands

- `npm run dev` — dev server at http://localhost:3000
- `npm run build` — production build
- `npm run typecheck` — `tsc --noEmit`; run after engine changes

## Architecture

The core rule: **game logic never imports React, and React never touches game
state.** React/Next is only the shell that mounts the canvas.

- `app/` — Next.js App Router shell. `app/components/GameCanvas.tsx` is the
  only client component; it instantiates `Game` in a `useEffect` and calls
  `game.stop()` on unmount.
- `src/game/` — framework-agnostic engine, plain TypeScript:
  - `engine.ts` — `Game` class: fixed-timestep loop (60 Hz update, rAF render),
    player driving state (position, playerX, speed)
  - `road.ts` — track as a list of segments; `project()` does the
    world→camera→screen perspective math
  - `render.ts` — all canvas drawing (background, road segments, player, HUD)
  - `input.ts` — keyboard state (arrows + WASD)
  - `constants.ts` — tuning values and realm color palettes; tweak feel here

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
