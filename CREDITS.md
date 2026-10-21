# Credits and licences

Every third-party asset in this repository, with its source and terms. Audited
2026-09-14.

## Audio — mostly synthesised; recorded effects from Kenney, CC0

The engine, the road and tyres, the music, the ambience and most effects are
generated at runtime by the Web Audio API in `src/game3d/sound.ts`.

Seven effects use recordings, all from two Kenney packs (kenney.nl), CC0 /
public domain. Licences: `public/sfx/LICENSE-kenney-impact-sounds.txt` and
`public/sfx/LICENSE-kenney-sci-fi-sounds.txt`. Each take was trimmed of
leading silence, cut to what the game plays, mixed to mono and encoded as
96 kbps AAC; the source files are otherwise unchanged.

| In `public/sfx` | Used for | Kenney pack | Source files |
| --- | --- | --- | --- |
| `crash-metal-0…4` | crash | Impact Sounds | `impactMetal_heavy_000…004` |
| `crash-plate-0…4` | crash | Impact Sounds | `impactPlate_heavy_000…004` |
| `bump-0…4` | car contact | Impact Sounds | `impactPlate_medium_000…004` |
| `land-0…4` | landing | Impact Sounds | `impactSoft_heavy_000…004` |
| `hit-0…4` | monster hit | Impact Sounds | `impactPunch_heavy_000…004` |
| `smash-0…2` | rock smash | Sci-fi Sounds | `explosionCrunch_000`, `_001`, `_003` |
| `nitro-0…1` | nitro | Sci-fi Sounds | `thrusterFire_001`, `_003` (first 0.9 s) |
| `transform-0…1` | mech transform | Sci-fi Sounds | `forceField_000`, `_002` |

If a browser cannot decode AAC, each of these falls back to its synthesised
voice, so nothing goes silent.

## 3D models — Kenney, CC0

- **Car Kit** — Kenney (kenney.nl). Licence: `public/models/LICENSE-kenney-car-kit.txt`
- **Nature Kit 2.1** — Kenney (kenney.nl). Licence: `public/models/LICENSE-kenney-nature-kit.txt`

CC0 / public domain. No attribution required; credited here as good practice.

Note: the ten player cars are **not** from this kit — they are built
procedurally in `src/game3d/cars.ts` from lofted sections. The Kenney car kit
is retained for its texture atlas and as a fallback.

## Textures — Poly Haven, CC0

From polyhaven.com, listed in `public/textures/LICENSE.txt`:

| In repo | Poly Haven asset |
| --- | --- |
| `ground_forest` | forrest_ground_01 |
| `ground_ember` | red_laterite_soil_stones |
| `ground_peaks` | snow_02 |
| `road` | aerial_asphalt_01 |
| `rock` | rock_06 |
| `metal` | metal_plate |

CC0 / public domain. No attribution required; credited here as good practice.

Every other texture in the game — skies, road markings, liveries, foliage,
water, neon signs — is drawn procedurally to a canvas at runtime.

## Fonts — Orbitron and Rajdhani, OFL 1.1, self-hosted

Both are licensed under the SIL Open Font License 1.1, which permits
commercial use and embedding.

They are **self-hosted**, not loaded from a CDN: `next/font/google` in
`app/layout.tsx` downloads both faces at build time and serves them from this
origin. Verified on the running app — zero third-party requests on page load.
They used to be an `@import` from `fonts.googleapis.com`, which sent every
visitor's IP to Google before a pixel was drawn.

## Libraries

- **three.js** — MIT
- **Next.js**, **React** — MIT

Full dependency licences resolve through `npm`; run `npx license-checker
--summary` for the current tree.

## Original work

Everything not listed above — all game code, all realm and car design, all
procedural geometry, textures and synthesised audio — is original to this project.
