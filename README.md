# Duskline

<a href="https://playduskline.vercel.app"><img alt="Play" src="https://img.shields.io/badge/play-playduskline.vercel.app-5b4fc9" /></a> <a href="https://www.srikarmk.dev/projects/duskline"><img alt="Case study" src="https://img.shields.io/badge/case%20study-srikarmk.dev-5b4fc9" /></a> <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue" /></a>

A browser racing game. Twelve worlds, ten road cars, and an endless neon
highway — no install, no account, no download screen.

**Play:** https://playduskline.vercel.app

![Duskline](docs/screenshots/void.jpg)

Built with Next.js 15, TypeScript and Three.js. Everything you see is generated
in code: the skies are shaders, the cars are lofted from cross-sections, the
tracks are splines with real elevation, and every sound is synthesised at
runtime by the Web Audio API. There is not one audio file in this repository.

## What's in it

- **Twelve worlds** — a coastal causeway at sunset, a snowbound mountain pass,
  eight lanes of new tarmac across a desert, canyon switchbacks above a grid of
  city lights. Each has its own palette, elevation and landmarks.
- **Ten cars**, each modelled individually rather than recoloured: an F40,
  a Testa, a Tauro, a Fairlady, an IROC and five more.
- **Four modes** — Circuit (nine rivals, a standing grid), Neon Run (an endless
  wet highway under a dead city), Grand Prix (three rounds, points), and Space
  Wars (anti-gravity tube, live ordnance).
- **Drift charges nitro.** That is the mechanic the whole game is built around.
- Plays on a phone: touch controls, installable, and it runs offline once
  you have loaded it.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run typecheck` | `tsc --noEmit` — run after engine changes |
| `npm run test:sw` | service-worker routing test |

No environment variables are required. Every one in `.env.example` is optional
and turns on a feature (shared leaderboard, Google sign-in, crash reporting);
the game says so honestly in the UI when one is not configured.

## How it is put together

The rule the codebase is organised around: **game logic never imports React,
and React never touches in-race state.** React owns the menus; the engine owns
the race; they meet at one callback.

```
app/            Next.js App Router shell — home screen, canvas host, pause menu
src/game3d/     the Three.js engine — track, realms, cars, props, AI, sound
src/game/       shared input/HUD drawing, and the original pseudo-3D engine
src/ui/         storage, settings, identity, leaderboard, crash reporting
```

`CLAUDE.md` has the architecture in detail. `RELEASE.md` tracks what is left
before launch, `AUDIT.md` the open bugs and the ideas worth building,
`CREDITS.md` every third-party asset and its licence.

## Licence

Game code, art direction, geometry, textures and audio are original work.
Third-party assets are CC0 (Kenney models, Poly Haven textures) or MIT/OFL
(three.js, Next, React, Orbitron, Rajdhani) — see `CREDITS.md`.
