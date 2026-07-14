# TODO

## Phase 1 — Straight road (in progress)
- [x] Next.js + TypeScript scaffold, canvas shell
- [x] Fixed-timestep game loop
- [x] Segment-based road projection & rendering (grass, rumble, lanes)
- [x] Driving: accelerate, brake, coast, steering, off-road drag
- [x] Speed HUD
- [ ] Playtest and tune feel (accel curve, steer rate)

## Phase 2 — Curves & hills
- [ ] Curve values on segments + accumulated horizontal drift in projection
- [ ] Hills: segment elevation, interpolated camera height
- [ ] Centrifugal force pushing player outward in curves
- [ ] Track builder helpers (addStraight/addCurve/addHill)

## Phase 3 — Laps & track loop
- [ ] Proper looping circuit track
- [ ] Lap counter + lap timer
- [ ] Start/finish line rendering

## Phase 4 — Fantasy scenery
- [ ] Roadside sprites (crystals, glowing trees, ruins) with projection scaling
- [ ] Parallax background layers (mountains, floating islands)
- [ ] Realm palettes: enchanted forest, lava realm, sky citadel

## Phase 5 — Opponents & collisions
- [ ] AI racers with speed/lane behavior
- [ ] Sprite collision (obstacles + opponents)
- [ ] Race position tracking

## Phase 6 — Power-ups & magic
- [ ] Boost runes, shields, projectile spells
- [ ] Pickup rendering + effects

## Phase 7 — Game shell
- [ ] State machine: title → realm select → countdown → race → results
- [ ] Sound (engine hum, pickups, music)
- [ ] Polish pass

## Later
- [ ] Touch controls (mobile)
- [ ] Desktop wrap (Tauri/Electron)
