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

## Three.js rewrite (done)
- [x] Real 3D engine in src/game3d: CatmullRom circuit, road ribbon mesh,
      chase camera, night sky dome, fog
- [x] CC0 glTF models (Kenney car kit + nature kit) for racer & scenery
- [x] All mechanics ported: nitro, stunts, lane bonus, OOB, collectibles,
      rocks, transformer mode with flight
- [x] HUD reused as 2D canvas layered over WebGL

## Realism + maps + AI overhaul (done)
- [x] 3 realms with distinct tracks + themes (Enchanted Forest, Ember Wastes,
      Crystal Peaks); realm select on home screen
- [x] Track elevation (hills) with grass verges to hide the road/ground gap
- [x] Dense environment: textured ground, two scenery bands per side,
      instanced grass + pebble clutter, mountain ring, twin moons, fog
- [x] Minimap (top-down track + player + opponent dots)
- [x] AI opponents (3) with rubber-band pacing + live race position
- [x] 4 modes: Classic, Time Trial, Nitro Sprint, Transformer Rush
- [x] Camera angles (chase / cinematic / hood), cycle with C
- [x] Improved mech model with an energy sword
- [x] Transformer combat: monsters to slash (sword swing + slash arc)
- [x] Controls swapped: SPACE = nitro, SHIFT = fly

## Sound + combat + GP + global board (done)
- [x] Procedural Web Audio: speed-tracking engine hum, per-event SFX, ambient
      music loop; M mutes (persisted)
- [x] Opponent bumping (side-to-side shove + speed loss)
- [x] Monsters patrol + charge the transformed player; slash with cooldown,
      take a hit if caught mid-recovery
- [x] Grand Prix mode: 3 realms back-to-back, championship points,
      intermission standings, final championship screen
- [x] Global leaderboard: /api/scores route (KV/Upstash REST + in-memory
      fallback), client submit + Global/Local tabs on the home screen

## To make the global board truly shared (one-time)
- [ ] Connect a KV store in Vercel dashboard (Storage → Upstash Redis). It
      auto-adds KV_REST_API_URL / KV_REST_API_TOKEN; the API activates on the
      next deploy (no code change). Until then it falls back to per-instance
      memory and the home screen shows a hint.

## Next up
- [ ] Playtest & tune: centrifugal, ramp launch, transform duration, AI skill
- [ ] Monsters that attack back with real damage / a health bar
- [ ] Touch controls (mobile), desktop wrap (Tauri/Electron)
