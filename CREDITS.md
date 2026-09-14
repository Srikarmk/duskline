# Credits and licences

Every third-party asset in this repository, with its source and terms. Audited
2026-09-14.

## Audio — none third-party

All sound is generated at runtime by the Web Audio API: oscillators, filtered
noise and envelopes in `src/game3d/sound.ts`. There are no audio files in the
repository and nothing is streamed. Nothing to licence.

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

## Fonts — Google Fonts

**Orbitron** and **Rajdhani**, loaded from `fonts.googleapis.com` in
`app/globals.css`. Both are licensed under the SIL Open Font License 1.1,
which permits commercial use and embedding.

⚠️ **Loaded from Google's CDN at runtime.** That is a third-party request on
every page load, which has privacy implications in some jurisdictions (the
request carries the visitor's IP to Google). Self-hosting via `next/font` would
remove the dependency and improve load time. See `RELEASE.md`.

## Libraries

- **three.js** — MIT
- **Next.js**, **React** — MIT

Full dependency licences resolve through `npm`; run `npx license-checker
--summary` for the current tree.

## Original work

Everything not listed above — all game code, all realm and car design, all
procedural geometry, textures and audio — is original to this project.
