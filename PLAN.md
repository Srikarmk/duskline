# Fantasy Racer — Plan

A pseudo-3D (OutRun-style) fantasy kart racer for the web.
Vanilla JS + Canvas 2D, ES modules, Vite for dev/build. No runtime dependencies.

## Concept

Race a magical vehicle down winding roads through fantasy realms —
dodge obstacles, overtake AI racers, grab power-ups. Mario Kart spirit,
OutRun rendering.

## Rendering approach

The track is a list of road segments, each with a curve value and elevation.
Each frame, segments are projected to screen space with perspective division
and drawn back-to-front. Curves are faked by accumulating horizontal drift
across segments. Sprites scale with the same projection.

## Module layout (target)

- `src/main.js` — entry, canvas setup, fixed-timestep game loop
- `src/road.js` — track segments, projection, road rendering
- `src/player.js` — speed, steering, centrifugal force, off-road handling
- `src/sprites.js` — scenery/obstacle/opponent sprite drawing
- `src/input.js` — keyboard (touch later)
- `src/hud.js` — speed, lap, position, timer
- `src/game.js` — state machine: title → countdown → racing → results

## Roadmap (each phase ends playable)

- [ ] 1. Straight road: segment renderer, stripes, forward driving
- [ ] 2. Curves & hills + centrifugal force
- [ ] 3. Steering, off-road slowdown, track loop with laps
- [ ] 4. Fantasy scenery, themed realm palettes, parallax backgrounds
- [ ] 5. AI opponents, collisions, race positions
- [ ] 6. Power-ups: boost runes, shields, spells
- [ ] 7. Game shell: title, realm select, countdown, results, sound
- [ ] 8. Later: touch controls, desktop wrap (Tauri/Electron)
