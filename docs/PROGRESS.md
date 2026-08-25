# Fantasy Racer — Progress Log

A fantasy kart racer that started as a single 800×600 canvas and grew into a
full 3D game with eight realms, a competitive AI grid, a physically solid world
with takedowns, a transforming sword-mech, drift, stunts, a championship mode,
dynamic music, and a global leaderboard.

**Play it:** https://fantasy-racer.vercel.app

![Fantasy Racer — six stages from prototype to today](screenshots/evolution.jpg)

> **The full before → after story lives in [EVOLUTION.md](EVOLUTION.md)** — a
> LinkedIn-ready montage plus each stage broken out.

![Enchanted Forest — moonlit woods, rebuilt cars](screenshots/cars-forest.jpg)

> Screenshots live in `docs/screenshots/`. They're captured straight from the
> game canvas via `renderer.domElement.toDataURL()`.

---

## The evolution, milestone by milestone

Each milestone below shipped and deployed. Times are the order things were
built, not calendar dates.

### 1. Straight road (pseudo-3D)
A vanilla-JS/Canvas OutRun-style renderer: a list of road segments projected
back-to-front with perspective division. Accelerate, brake, steer, rumble
strips, a speed HUD. First playable.

### 2. Curves, hills & mechanics
Curve + elevation on segments, centrifugal force, an out-and-back track,
ramps + mid-air spins, gems, nitro, rocks to dodge, lane-discipline bonuses,
3 laps + timer. Parallax mountains, stars, fog.

### 3. Game shell + Transformer mode
Home screen with name entry and a localStorage leaderboard, countdown/finish
states, and a second mode: grab an orb → morph into a mech that flies and
smashes rocks.

### 4. Next.js + TypeScript
Rebuilt on the Next.js App Router with a strict rule that survives to today:
**the game engine never imports React, and React never touches in-race
state.** They talk only through a `GameOptions` (mode/realm + `onFinish`).

### 5. Real 3D (Three.js)
Threw out the pseudo-3D renderer for actual Three.js: a Catmull-Rom circuit,
a road-ribbon mesh, a chase camera, night sky dome, and **CC0 glTF models**
from Kenney (car + nature kits) for the racer and scenery.

### 6. Realism + maps + AI
Three distinct realms (Enchanted Forest, Ember Wastes, Crystal Peaks) with
their own tracks and palettes, a minimap, **3 AI opponents** with live race
position, 4 modes, camera angles (chase/cinematic/hood), a better mech, and
monster combat in Transformer mode.

### 7. Sound + combat + Grand Prix + global board
Fully **procedural Web Audio** (no assets): a speed-tracking engine hum,
per-event SFX, and an ambient music loop. Monsters that patrol and charge;
opponent bumping. **Grand Prix**: all three realms back-to-back for a
championship. A **global leaderboard** API (Vercel KV / Upstash with a local
fallback).

### 8. Drift, stunts, tube tracks, textures
A lateral-velocity **drift** model (brake+steer to slide, release for a
boost) that fixed the on-rails feel. **Stunt variety**: barrel rolls + flips
+ combos. A **Void Circuit** realm: an anti-gravity glass tube in deep space.
Textured car via the real Kenney atlas.

### 9. Grid, opponents & generated tracks
**8 AI opponents**; the player starts **mid-pack (P5 of 9)** on a real grid.
Tracks are now **generated** as smooth "wobbly-circle" loops with bounded
curvature — no more hand-placed hairpins pinching the road. Full-width menu.

### 10. Visual glow-up + pause/settings (this pass)
**Bloom post-processing** so gems, rails, crystals, nitro, and the sword
actually radiate; brighter, warmer lighting so nothing reads as a black
silhouette. A rebuilt **glowing jump ramp** that sits flush on hills. A
**pause menu** (Esc/P) with **settings** — music/SFX volume, glow toggle,
default camera — all persisted.

### 11. Toned-down glow + power-ups & combat (this pass)
The bloom from milestone 10 was **too strong** — halos everywhere. Dialed it
back (strength 0.9 → 0.4, threshold 0.68 → 0.85) so gems and crystals glint
instead of flare. Then the first roadmap item shipped: **power-ups**. Item
boxes line the track; drive through one to grab a random item into your slot,
fire it with **E**:

- **BOOST** — a short burst above top speed.
- **SHIELD** — a cyan bubble that absorbs the next rock, monster, missile, or
  mine for a few seconds.
- **MISSILE** — a homing projectile that locks the nearest opponent ahead,
  stuns them, and scores a hit.
- **MINE** — drop a hazard behind you; whoever hits it spins out.

Opponents fight back — they scatter mines of their own. Getting stunned makes
a racer spin and bleed speed, so a well-timed missile can flip a position.
Shields block everything and flash **BLOCKED**. Projectiles clear on each new
lap so nothing lingers across the line.

### 12. Full-width, textures, karts & a clean grid (this pass)
A big look-and-feel pass:

- **Full-width, responsive canvas.** The race used to sit letterboxed in a
  4:3 box; now it fills the whole browser at its true aspect ratio and resizes
  live (a `ResizeObserver` re-sizes the renderer, bloom, camera and HUD). The
  HUD was rewritten to be resolution-aware and anchors to the real edges.
- **Real textures & a fuller world.** Ground is now organic multi-scale
  terrain (soft patches + grain, not flat color); the road is proper asphalt
  with aggregate, tire-wear bands, hairline cracks, crisp lane dashes and
  rumble strips. Every realm gets an **ambient particle field** — fireflies in
  the forest, rising embers in the wastes, falling snow on the peaks, drifting
  stardust in the void — plus a lit **START / FINISH gantry** over the line.
- **Four kart types with stats.** COMET (all-rounder), BOLT (top-speed),
  TITAN (heavy launcher), WISP (razor handling) — each a distinct hand-built
  low-poly hull with wheels, canopy, wing/fin and glowing trim. Stats
  (speed / accel / handling, shown as ★ ratings in a new **garage** on the
  home screen) feed real physics multipliers. Opponents now drive an assortment
  of types too, so the grid shows genuine variety.
- **Streamlined starting grid.** Karts line up on a clean staggered 3-column
  grid — no more overlapping/clumped spawns — with the player mid-pack at
  **P5 of 9**.

![Full-width grid start — nine distinct karts, staggered lanes](screenshots/grid.jpg)
![Full-width race — textured road, fireflies, the pack ahead](screenshots/race.jpg)

### 13. Grip, weight & a graded look (this pass)
The driving used to feel like a sprite sliding across a screen — on rails, no
weight. Studied Mario Kart / Hot Shots Racing / Asphalt for what makes them
feel and read well, and rebuilt around it:

- **Grip-limited handling.** Steering now asks the tires for lateral
  acceleration, and the tires have a **grip ceiling** — take a corner too fast
  and you wash wide (understeer), so you have to brake and commit to a line.
  **Weight transfer** (braking loads the front for sharper turn-in),
  **steering inertia** (the wheel eases in and self-centers), **speed-sensitive
  steering** (heavier at top speed), and tire scrub that settles the car. The
  kart visibly yaws into the slip.
- **Camera with feel.** FOV kicks with speed and flares on boost, the view
  banks into corners and looks *ahead into* the turn, and impacts / hard
  landings shake the camera.
- **A graded, finished look.** **ACES filmic tone mapping** + an output pass
  give richer colours and smooth highlight roll-off (the moons and neon now
  bloom cleanly). An **Asphalt-style speed overlay** — vignette + radial
  streaks that build with speed and flare on boost. Glowing **edge-marker
  posts** line the track for a real-circuit look and a speed reference that
  whips past.

![Grip + grading — banked camera, edge posts, speed streaks](screenshots/handling.jpg)

**Tuning after playtest feedback:** the tracks were **flattened** so the road
hugs the terrain instead of sitting on a tall embankment (no more "valley"
beside the road); **ambient particles cut** by ~70% and kept low so they don't
bury the cars; **out-of-bounds tightened** (you can put a wheel on the grass
but can't drive off into the scenery); grip made a little more forgiving so you
hold the road; and the **contrast softened** (lifted ambient light + lower
exposure) so it's less harsh neon-on-black.

**Second fix round:** ramps had a collision window narrower than the ramp
itself, so you could drive straight through one — widened it (you now launch
reliably) and added **four ramp kinds** (standard / mega / kicker / wide) with
their own launch power and colour. Item boxes only respond when your slot is
empty; hitting one while full now shows a **"SLOT FULL"** prompt instead of
silently doing nothing, and pickup tolerances were widened so gems/boxes catch
reliably. And the **motion-sickness culprits** were dialled right back — the
FOV kick, camera bank, look-ahead swing and shake are now gentle, and the speed
streaks no longer strobe (re-seeded ~5 Hz, far fewer, faint), with bloom
reduced so bright edges don't halo.

### 14. Real textures, curved ramps & a brighter world (this pass)
The long-standing ask: **texture**. Everything was flat-shaded solid colour, so
nothing read as a real surface. Added a procedural texture module and wired it
through:

- **Cars** wear brushed-metal panelling (a grayscale map that multiplies the
  livery colour, plus a bump map for seams + rivets that catch the light).
- **Road** is proper asphalt now (colour map + aggregate bump — grain and
  hairline relief), **ground** has terrain bump, and **rocks / crystals** get
  cracked-stone colour + bump. The CC0 nature props (trees, mushrooms) were
  switched to a lit, lightly bump-textured material so they stop looking flat.
- **Curved ramps.** The ramps were straight wedges; they're now genuinely
  **curved** surfaces (built from a slope profile) — a smooth standard, a
  concave mega kicker, a sharp late-kick, and a quarter-pipe — with glowing
  rails that follow the curve.
- **Ramp launches no longer throw you off track** — you launch straight (no
  sideways carry), snap toward the ramp's centre, and land back on the road.
- **Brighter, clearer world.** The scenes were so dark the textures (and the
  cars) were hard to see and everything read as harsh neon-on-black. Raised the
  key light, ambient and exposure so surfaces and their texture actually read,
  which also softened the contrast.

![Textured asphalt, brushed-metal car, brighter readable world](screenshots/textured.jpg)

**Polish round:** ramps sometimes did nothing because they'd been centred in
one lane while the hit window was narrower than a lane — now they **span the
full road** (and the window with them), so you launch from any line. The
**glow was dialled back** (bloom + emissive intensities down, edge-post markers
and neon kerbs dimmed) so it's less distracting, and the forest gets
**per-instance colour variation** so it's not a wall of identical trees.

### 15. Real CC0 PBR textures (this pass)
Swapped the hand-drawn canvas textures for **real 1K CC0 PBR sets from Poly
Haven** (`public/textures/`, public domain): a per-realm ground (forest floor /
red volcanic soil / snow), asphalt, rock, and metal — each with an albedo +
normal map. They load asynchronously alongside the models, so the **ground now
has genuine terrain detail**, the **road is real asphalt** (procedural lane
markings kept, real normal for the surface), **rocks and mountains** use a rock
set, and the **cars** get metal-plate surface relief from a normal map while
keeping their bright livery colour. Falls back to the procedural maps if a set
fails to load.

![Real CC0 ground / asphalt / rock textures](screenshots/real-assets.jpg)

### 16. Real rivals, editable laps, a proper home screen (this pass)
The opponents felt fake — they clustered around the player and ignored
everything. Fixed:

- **They string out** now: each rival holds its own top-speed **pace** (1.02
  down to 0.86) instead of rubber-banding to the player, so the field spreads
  across the track (a 15-second sim spread them ~140 m apart).
- **They hop the ramps** (full ballistic launch, any lane) and **fire nitro
  bursts** with rear flames — verified opponents reaching ~4.6 m of air.
- **Editable laps**: pick 1 / 2 / 3 / 5 / 7 before the race (single-race modes),
  threaded through `GameOptions`.
- **Cars aren't stacked boxes** anymore — the hull is a single **extruded car
  silhouette**, tapered narrower toward the cabin so it reads as a rounded car
  from behind (the main camera), each type its own shape + livery.
- **Home screen redesign**: animated gradient title, tagline, feature chips,
  pill lap-selector, a proper gradient CTA that shows the lap count, richer
  background, and hover-lift cards.
- A touch more **ambient light** so the textures and scene read better.

![Spread-out rivals, tapered car body, brighter textured world](screenshots/opponents-cars.jpg)

### 17. Real cars, rival brains, a proper asteroid field (this pass)
A big multi-front pass (two focused sub-agents rebuilt the cars and the AI in
parallel while the engine work went in alongside):

- **Cars are actual cars now.** Rebuilt each kart as a smooth width-tapered
  hull (tucked sills, full fenders, a narrow glass greenhouse, sloped
  windshield/backlight), real tyres + rims with a suspension gap, headlights,
  a slim tail-light bar, and type-specific wings — comet/bolt/titan/wisp each a
  distinct silhouette. Emissive dialled right down.
- **Each rival has a brain.** Every opponent now has a deterministic
  personality seeded from its name: cornering caution (some send it and wash
  wide, some brake clean), a preferred racing line + how much it weaves, apex
  aggression, its own nitro trigger (straights / corner-exit / comeback /
  wildcard) and cadence, and mistake-proneness by skill — so no two race alike.
- **Cars no longer sink into the road** (the surface renders slightly above the
  centreline; cars are lifted to sit on it).
- **The space realm looks like space.** A dense floating **asteroid field**
  (textured rock chunks at varied sizes/depths, some huge and distant) around
  the glass tube, plus a ringed **gas-giant** backdrop.
- **Calmer + fuller:** bloom + emissives cut again (no blown-out glow), the
  fixed square "stars" are now soft round dots, three scenery bands fill the
  empty flats, ramp collision widened (no clipping the sides; every rival hops),
  and the car's lean/slip on turns reduced so it stops shearing.

![Rebuilt cars + a dense, fuller forest](screenshots/cars-forest.jpg)
![The void realm as a real asteroid field](screenshots/space.jpg)

### 18. Stage 2 — real cars, textured trees, a wizard menu (this pass)
Three focused sub-agents + engine work, in parallel:

- **Cars now read as real cars** (Hot-Shot-Racing / arcade-GT feel): crisp
  *faceted* (flat-shaded) bodywork instead of a smooth blob — a front grille +
  bumper, flared **wheel arches** over every tyre, a proper greenhouse with
  slanted windshield/backlight and A/B **pillars**, and a **visible driver**
  (helmet) in the cockpit; distinct silhouettes per type (GT coupe / long
  prototype / wide muscle-car / open kart), glow kept subtle.
- **Textured trees.** Swapped the flat kit foliage for procedural trees with a
  real **bark** trunk and **leaf** canopy (CC0 Poly Haven bark + foliage
  textures), tinted per realm — the world finally has surface texture, not just
  shaded shapes.
- **The menu is a 3-step wizard.** Map → Machine → Race, with a **real preview
  image above every realm and car**, a breadcrumb + progress rail, back/next,
  and a "professionally funky" neon layout — captured straight from the game.
- Cars **no longer sink** into the road; opponents each have a **distinct
  personality** (cornering, lane bias, boost strategy); the **void** is a dense
  **asteroid field** with a gas-giant backdrop; glow, stars, density and turn
  feel all tuned.

![Faceted cars with drivers + textured world (Ember)](screenshots/stage2-cars.jpg)
![Crystal Peaks — textured snow, open-kart driver](screenshots/stage2-peaks.jpg)

### 19. Easier to control + more to do on track (this pass)
- **Handling is much more forgiving.** Cranked up grip and steering response and
  eased the centrifugal push — the car now holds its line instead of washing
  wide, so it's arcade-easy to control (a hold-the-line test that used to drift
  ~1.35 off-centre now stays within ~0.33), with a slightly more generous
  out-of-bounds margin.
- **Boost pads.** Glowing chevron pads on the track — drive over the arrows for
  a speed surge. Something to aim for on every lap.
- **Livelier tracks.** Gem runs are now patterned (straight / zigzag /
  lane-sweep) as mini skill lines, ramps come ~25% more often, and the forest
  and ember layouts got extra corner harmonics so the circuits have more
  character (tighter turns + sweeps) instead of one monotonous curve.

![Boost pad chevrons on a livelier forest circuit](screenshots/boost-pads.jpg)

---

## Eight machines + a live 3D garage

The roster doubled to **eight karts**, and the select screen became a real
showroom.

**Four new cars**, each a distinct hand-built silhouette (not recolors):

- **APEX** — a Formula open-wheeler: pointed nose cone, exposed wheels on
  suspension arms, front + rear wings, driver halo, airbox.
- **GOLIATH** — a monster truck towering on four enormous tyres, with a roll
  cage and visible shocks.
- **CORSAIR** — a landlocked galleon: raised bow, portholed deckhouse, a mast
  and pennant.
- **BARON** — an absurd **six-wheel** stretch limo with a row of side windows.

Each carries its own speed / accel / grip, so the pick changes how it drives.

**The garage is now a live 3D showroom.** Instead of a flat thumbnail, the
chosen car rotates in a lit studio with a soft contact shadow — built from the
exact same mesh the race uses (`makeKart`), so it never drifts from the in-game
model and there are no pre-rendered images to go stale. It scales to any number
of cars for free.

And the docs got what they were missing: a **before → after evolution gallery**
(the montage up top, and **[EVOLUTION.md](EVOLUTION.md)**) — six stages from the
day-one pseudo-3D canvas to today, each captured straight from that build.

---

## Eight worlds

Four new themed realms join the original four:

![Eight worlds — the full realm lineup](screenshots/realms.jpg)

- **Sunspire Sands** — a blazing Egyptian desert of pyramids, obelisks and palms.
- **Ravenspire Keep** — a torchlit medieval castle circuit with towers, ramparts and banners.
- **Apex Speedway** — a real F1 stadium: grandstands, tyre barriers, floodlights, red-and-white kerbs.
- **Neon Metro** — a midnight New-York street circuit under a skyline of lit towers and neon billboards.

Each realm ships its own track shape, sky, lighting and a full set of hand-built
procedural props (a dedicated builder file per theme), and drops straight into the
same wizard, Grand Prix and time-trial flow as the rest.

---

## Space Wars — deep-space combat

A new combat mode that turns the anti-gravity tubes into a running firefight.
Space Wars is always fought in space: it swaps your realm pick for one of **two
battle arenas** — Void Circuit or the otherwise-hidden **Nebula Run** — and
rewrites the rules of engagement:

- you **start armed** with a missile,
- **item boxes are packed** three-across every ~85 m, weighted heavily toward
  missiles and mines,
- **rivals are trigger-happy**, seeding the tube with far more mines,
- press **E** to fire; big points for every hit.

It reuses the existing missile / mine / shield combat, so it slotted in as a
mode config flag rather than a new system.

---

## Weather & atmosphere — every world feels different

A camera-following weather system (`weather.ts`) gives each realm its own sky:

- **Crystal Peaks** — dense falling **snow**.
- **Ember Wastes** — glowing **embers rising** through drifting ash.
- **Sunspire Sands** — a hot **sandstorm** of blowing dust under a hazed horizon.
- **Enchanted Forest** — floating glowing **spores**.
- **Ravenspire Keep** — low drifting **mist**.
- **Neon Metro** — cool **rain** streaking down a wet city night.

Alongside it: **Neon Metro was de-glowed** (window emissive cut to ~a third,
mostly-dark facades with sparse clustered lit windows, glass-vs-masonry material
variety) so it reads as a real skyline instead of a neon blur; and the **trees,
rocks and distant mountains got a realism pass** — tapered trunks + tiered,
tonally-shaded canopies, weathered boulders, and layered hazy ridgelines with
atmospheric perspective.

---

## Track identity — no two laps feel the same

Every circuit was redrawn longer and busier (more, sharper, distinct turns
instead of "a circle with two bends"), and the space tubes got **rollercoaster
elevation** — huge climbs and dives through the void.

On top of the layouts:

- **Tunnels** — realm-tinted vaulted **tunnel** runs (a colonnade of arches with
  glowing crown light strips + decorated entry/exit portals) that hug the track
  curve. The castle plunges into a long red-lit tunnel; the city dives through
  cyan underpasses.
- **Lore** — every world now has a line of flavour, shown on the loadout before
  you launch.
- **Ambient audio** — each realm has its own procedural sound bed: forest breeze,
  a volcanic rumble, mountain wind, a city hum, a deep-space drone, eerie castle
  mist.

---

## Banked corners + a real F1 grid

- **Banked corners** — the road now leans INTO turns (velodrome-style, up to
  ~25°), computed from the smoothed track curvature. The road ribbon, the player
  and every rival roll with the bank (and stop rolling mid-jump so flips stay
  clean). The camera holds level so you *see* the lean. Gated off on the void
  tubes (they use dramatic elevation instead).
- **F1 standing grid** — the field is 8 cars total (7 rivals + you) in a proper
  two-column staggered grid, with you at the back so the whole field lines up
  ahead. Rivals are snapped onto the grid before the lights instead of popping in
  when the race starts.
- **Finish placement fix** — the HUD position no longer drifts to "1st" as you
  coast past the line; it freezes to the placement taken at the line.

---

## A fun front-end + a real Hogwarts (this pass)

- **Four-step launch wizard** — Realm → Machine → **Mode** → Race. Mode is now its
  own step (it used to be buried), and the home page leads with visuals, not walls
  of text: a trimmed hero (`drift · boost · jump · blast`, `8 WORLDS / 8 KARTS /
  4 MODES`) and a live 3D kart in the garage step.
- **Better type** — a display face (Orbitron) for titles + a body face (Rajdhani)
  for everything else, so the UI reads like an arcade cabinet, not a form.
- **Hogwarts, properly** — the castle realm is a real wizarding lap: the castle
  itself, the Hogwarts Express, Quidditch hoops, a Whomping Willow, floating
  candles and a golden snitch strewn around the course as easter eggs.
- **Trimmed the fat** — Grand Prix and the half-baked Space Wars were cut; the
  mode list is now four tight, distinct choices.
- **Single-race results screen** — placement, lap time, a score breakdown, the
  finishing order and a "new personal best" flag, with Race Again / Menu.

## Physics feel — rideable ramps, no sinking, no cheap wall-rides (this pass)

The driving had three long-standing bugs; this pass fixed the *feel*.

- **Ramps you actually ride** — a ramp used to fling you skyward the instant you
  touched it. Now your altitude tracks your position up the ramp face and you
  **launch off the lip** with power scaled to the ramp and your speed. Ramps (and
  boosters) occupy **one lane** — clip one sideways and you get a **sideswipe
  crash** instead of a free launch.
- **No more sinking** — banked corners used to drop the inner road edge below the
  ground and swallow the car. The whole cross-section now rides up on a berm so
  the surface stays put (0 sink frames under a full-throttle full-lock stress
  test).
- **A soft edge barrier** — running wide now springs you back like an armco
  instead of flinging you out of the world; going properly off snaps you back at
  reduced speed rather than dumping you into the void.
- **Booster = a flat escalator strip**, and the race-stopping **rocks are gone**.

## Forks, gates & a calmer glow (this pass)

![A branching fork on Apex Speedway — boost gate on the left route, a central
island splitting the road, and the right route rejoining ahead](screenshots/branching.jpg)

- **Branching routes** — at set points the road **splits around a central
  island** into a LEFT and a RIGHT route that rejoin, Mario-Kart style. A soft
  barrier down the middle makes you commit to a side; rivals spread across both
  routes instead of ploughing the island.
- **Boost gates** — a new drive-**through** speed ring: thread it on its lane for
  a strong surge (it's lane-specific — the wrong lane does nothing), alongside
  decorative checkpoint hoops for set-dressing.
- **Calmer glow** — the "odd glow" on the bright maps is gone: exposure and bloom
  strength came down and the bloom threshold went up, so only the genuinely bright
  things bloom.

## Real alternate routes (this pass)

![A true fork — the main road runs ahead past the Y sign while a whole separate
branch road peels off to the side and rejoins downstream](screenshots/branch-route.jpg)

The earlier "fork" was one road divided by a central island — not what was asked
for. This replaces it with **genuine branching**: at a fork the road **peels onto
a separate alternate road** that bows away (some rise into a short overpass) and
**rejoins the main track later**.

- **A real second road** (`branch.ts` / `BranchPath`) with its own ribbon, edge
  lines and dashed centre — you can see it run off to the side and loop back.
- **You choose by steering**: lean toward the branch at the fork mouth and you
  leave the main track onto it; stay centred and you keep the main line. Rejoining
  hands you a **boost** for taking the detour. Progress maps back onto the main
  track so laps and ranking stay fair.
- **Every map** forks (the longer ones twice); rivals hold the main racing line.
- **Perf**: bloom now renders at half resolution (a soft blur anyway, so it looks
  the same) — the busiest map went from ~22 ms to ~14 ms a frame, back to a solid
  60 fps.

## Forks everywhere + arcade signage (this pass)

![Every map now forks — a big Y split-sign, a blimp overhead, a boost-gate on one
route and a ramp on the other, over a striped central island](screenshots/forks-signage.jpg)

- **A fork on every map** — all eight realms now split (the longer ones twice),
  each fronted by a big, unmissable **Y-shaped split sign** so you see the choice
  coming.
- **Varied route rewards** — no two forks feel the same: the two routes are dealt
  from a rotating set of **speed gate / jump ramp / power-up box**, so sometimes
  you're choosing boost-vs-jump, sometimes jump-vs-item.
- **Less boost spam** — the flat boost pads and free-standing gates were thinned
  right down (and never spawn inside a fork), so the surges feel earned instead of
  constant.
- **Hotshot-style signage** — bold red **directional arrow boards** stand on the
  outside of every sharp corner (pointing the way the road bends), **checkered
  apex markers** on the inside, and **blimps** drift over the track — the SEGA /
  Hotshot Racing arcade look.

---

## Making it physical (this pass)

The world stopped being a backdrop you drive through and became something you can hit.

- **Solid scenery** — trees, rocks, buildings and mushrooms are real obstacles now:
  overlap one and the car is pushed clear along the contact normal, its into-the-object
  velocity is cancelled (no more tunnelling), speed scrubs and sparks throw. Soft things
  (water, floating candles, thin flags) stay passable. Recorded as `{x,z,r}` in a spatial
  grid and resolved every frame.
- **Asphalt-style takedowns** — ram a rival and it spins out (~1.4 s) while you get a boost
  and a score bump; environment hits are just an orange spark shower, no fake deflection.
- **Off-track grace** — leaving the ribbon starts a countdown, not a wall; you respawn
  cleanly where you left it. Random mines were removed.

## A fair fight — competitive AI

The grid was re-tuned into an actual race: the pole rival matches your top speed and the
field strings out by personality, rubber-banded so a bad lap doesn't bury you — but **capped
at your nitro ceiling** so nobody rockets off uncatchably. Finish-order ranking now uses the
real line-crossing sequence.

## Sound with a pulse + race drama

- **Dynamic music** — the sleepy minor-pentatonic arpeggio became a **driving 4-bar groove**
  (four-on-the-floor kick, backbeat snare, hats, a rolling bassline, an arp lead) whose layers
  fade in with a speed/nitro-driven intensity signal — full tilt when you're flat out, a calm
  pulse when you idle or finish.
- **Callouts** — big centre-screen **OVERTAKE!** (with the place gained), **PASSED** and
  **FINAL LAP** banners, debounced past the opening grid shuffle.

## The payoff screen + flow

The results screen makes your **finishing position the hero** — a giant ordinal with
gold/silver/bronze podium glow (solo modes show finish time instead), score + personal best,
and a one-tap rematch. Championship and intermission screens were reworked to match, the
leaderboard gained rank medals + a "YOU" highlight, and a `prefers-reduced-motion` guard was
added. A subtle always-on **cinematic vignette** now frames every frame.

## Real-time shadows + a graphics pass

PCF soft shadows from a sun whose frustum follows the car, a lighting rebalance, procedural
rebuilds of the mushrooms / rocks / trees / gems, and a fix for weather particles ballooning
into near-camera blobs.

## The smoothness war-story — 33 → 85 fps (this pass)

It looked done but didn't *feel* smooth, so I profiled the running engine instead of guessing:

- **Physics was free** (~0.05 ms/frame). The whole cost was **rendering**, and it was
  **draw-call bound**: ~**12,500 meshes** but only 800k triangles. Lowering the pixel ratio did
  nothing — per-object CPU overhead, not fill.
- **Fix 1 — tighter shadows.** Shrank the sun's shadow frustum (±95 m → ±58 m, biased toward
  travel direction) so it stops drawing thousands of distant casters; near shadows came out
  sharper. Dropped `preserveDrawingBuffer` (nothing reads the backbuffer — the realm thumbs
  are static JPGs).
- **Fix 2 — batched scenery, in local space.** Each prop's 5–8 sub-meshes collapse into one
  mesh per material. It *had* to be local-space: the foliage wind shader keys its sway off
  **local vertex height**, so a world-space merge would've made the trees flail. Defensive by
  design — anything it can't safely batch it leaves untouched, so it never changes the look.

**Meshes 12,474 → 5,627. Render ~24 ms → 11.75 ms. ~33 → ~85 fps. Forest pixel-for-pixel
identical.**

---

## Where it stands now

- **8 realms**: Enchanted Forest, Ember Wastes, Crystal Peaks, Void Circuit,
  Sunspire Sands (Egypt), Hogwarts (wizarding castle), Apex Speedway (F1 stadium),
  Neon Metro (NYC) — each with its own weather, ambience, lore and set-pieces
- **10 karts**: Comet, Bolt, Titan, Wisp, Apex, Goliath, Wraith, Nitro, Dune,
  Blaze — each a distinct model + stat line, picked in a live 3D garage
- **4 modes**: Classic, Time Trial, Nitro Sprint, Transformer Rush
- **8-car F1 grid** (7 rivals + you) — a competitive, rubber-banded AI capped at
  your nitro ceiling so it's a catchable fight, with live position, **OVERTAKE! /
  FINAL LAP** callouts, and a top-down minimap
- **A physically solid world** — scenery you can hit (push-out + speed scrub +
  sparks), **Asphalt-style takedowns** (ram a rival to spin it out for a boost),
  and off-track grace + clean respawn instead of walls
- **Branching routes** — forks that split around a central island into two
  routes (a boost gate one way, a jump ramp the other) and rejoin
- **Track quirks** — rideable single-lane ramps (sideways = crash), drive-through
  boost gates, flat escalator boosters, tunnels, waterfalls and river-bridge jumps
- **Grip-limited handling** (weight transfer, drift + boost) with a camera
  that banks and kicks FOV; barrel-roll/flip **stunts** with combos, a soft
  edge barrier and berm-banked corners
- **Transformer mech** with an energy sword + monster combat
- **Power-ups**: boost / shield / homing missile / mines, item boxes, and
  opponents that fight back — press **E** to fire
- **Real-time PCF soft shadows** (frustum follows the car), **bloom** + **ACES
  tone mapping** (dialled to a calm glow), an always-on cinematic vignette + a
  speed-FX overlay
- **Dynamic music** that builds with your speed + nitro, procedural SFX and
  per-realm ambience, pause + settings
- **A podium results screen** where your finishing position is the hero (medal
  tiers, score + personal best), plus championship + intermission flow
- **Global leaderboard** (activates fully once a KV store is connected)

**Stack:** Next.js 15 · React 19 · TypeScript · Three.js · Web Audio ·
Vercel. Assets: Kenney CC0 kits. Comfortably **60+ fps** after a draw-call
batching pass — the scenery render was profiled and cut from ~12,500 meshes to
~5,600 (render time roughly halved).

---

## Gameplay roadmap (next)

The look and UX are in good shape; the next arc is depth of play.

- ~~**Power-ups & combat**~~ — ✅ shipped in milestone 11: item boxes, boost,
  shield, homing missile, mines, and opponents that fight back.
- ~~**Karts & a garage**~~ — ✅ eight distinct karts with their own speed /
  accel / handling, chosen in a live 3D showroom. Still open: unlocks, gems as
  currency, progression milestones.
- ~~**More content & routes**~~ — ✅ branching forks that split and rejoin,
  per-realm weather + ambience, tunnels, waterfalls and river-bridge jumps, and
  new track quirks (boost gates, escalators, rideable ramps). Still open: hazards,
  time-of-day variety, more modes.
- ~~**Feel & polish**~~ — ✅ mostly shipped: drift-boost, weight transfer, a
  camera that banks + kicks FOV, speed-FX + vignette, screen shake, dynamic music
  that builds with speed, and race-drama callouts. A physically solid world with
  takedowns landed too. Still open: boost chaining, true counter-steer drift.
- ~~**Performance**~~ — ✅ profiled and fixed: the render was draw-call bound on
  ~12,500 scenery meshes; per-prop batching + a tighter shadow frustum roughly
  halved frame time (~33 → ~85 fps in a headless browser). Next lever for locked-60
  on weak hardware: cross-prop chunk-batching of the *non-foliage* static props
  (safe only where there's no wind shader).

Also open: a shared KV leaderboard, and touch controls for mobile. (Textured
foliage now ships via procedural bark/leaf materials; banked corners ship as
berm-lifted turns.)
