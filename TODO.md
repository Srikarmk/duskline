# TODO

## Phase 1 — Straight road (done)
- [x] Next.js + TypeScript scaffold, canvas shell
- [x] Fixed-timestep game loop
- [x] Segment-based road projection & rendering
- [x] Driving: accelerate, brake, coast, steering, off-road drag
- [x] Speed HUD

## Phase 2 — Curves, hills & mechanics (done)
- [x] Curve values + accumulated horizontal drift in projection
- [x] Hills: segment elevation, interpolated camera height
- [x] Centrifugal force in curves
- [x] Track builder (straights, curves, hills, S-curves, rolling hills, loop closure)
- [x] Out of bounds: hauled back + score penalty
- [x] Lane discipline bonus (hold a lane 4s at speed)
- [x] Stunts: ramps launch you airborne, steer mid-air to spin, land clean for points
- [x] Collectibles: gems (ground), air gems (above ramps), nitro canisters
- [x] Nitro boost (Shift, max 3 charges)
- [x] Rocks to dodge (crash = big slowdown)
- [x] Environment: scenery sprites, parallax mountains, stars, horizon glow, fog
- [x] 3 laps, lap counter, race timer, finish bonus
- [x] Toast messages for all events

## Game shell (done)
- [x] Home screen: name entry, mode select, controls help
- [x] localStorage leaderboard ("Hall of Legends", top 10) + last-name recall
- [x] Results banner after each race
- [x] Countdown (3-2-1-GO) and FINISH states

## Mode 2 — Transformer Rush (done)
- [x] Transform orbs on track
- [x] Mech form: auto-run, higher top speed, smash rocks for points
- [x] Flight (hold Space): altitude physics, collect air gems, double gem value

## Next up
- [ ] Look & feel overhaul: better car/mech art, richer realm theming (user request)
- [ ] Playtest & tune: centrifugal strength, ramp launch, transform duration
- [ ] Sound: engine hum, pickups, nitro, music
- [ ] More realms (lava, sky citadel) with palette swaps
- [ ] AI opponents & race positions
- [ ] Projectile spells / shields power-ups
- [ ] Touch controls (mobile), desktop wrap (Tauri/Electron)
