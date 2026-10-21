# Duskline — handoff

Written 2026-10-12, moving to a different machine; updated 2026-10-21 after
the first session on the new one. `CLAUDE.md` covers the
architecture, `AUDIT.md` the bug and improvement list, `RELEASE.md` what blocks
a public launch. This file is the short version: where it stands, what is left,
and what will waste your afternoon if nobody tells you.

Local folder is `fantasy-racer/`; the repo is **Srikarmk/duskline**. That
mismatch trips people up.

## Where it stands

| | |
| --- | --- |
| Live | https://playduskline.vercel.app |
| Repo | github.com/Srikarmk/duskline, branch `main` |
| Deploy | automatic on push to `main`; confirm the live SHA with `gh api repos/Srikarmk/duskline/deployments` |
| CI | `npm run test:ci` locally is the same gate |

## 2026-10-21 — first session on the new machine

- **The engine is out of the first load.** AUDIT 2.1 had been written off as
  unavoidable; it was one static import (`src/ui/warm.ts` →
  `game3d/textures.ts` → `three`). First-load JS **234 → 159 kB gzip**, and
  `test:budget` now fails if a first-paint script contains three.js.
- **The car preview was gone below 1080px wide**: 4px tall at 1024×768 and on
  phones, and on a phone the last row of cars sat under the nav where it could
  not be tapped. AUDIT N10 has the before/after per viewport.
- README / CLAUDE.md / share description said ten cars; there are fourteen.

## What shipped most recently

Four commits, all green and all live:

- **`d5abde9`** — the waterfall standing across the road, and the "dark black
  piece" over it. Two separate causes. `findCliff` searched for the steepest
  ground near a point with no road-clearance check, and where a road cuts
  *through* a hill the steepest ground for a hundred metres **is** the cutting
  — so it reliably planted a 74 m waterfall on the road's own embankment. The
  black slab was `buildRoadBridge` drawing a third rail quad from the left
  parapet's inner top across to the right parapet's inner top: a 16 m × 92 m
  stone lid roofing the whole carriageway at 0.92 m, which you drove through.
- **`9f35012`** — replays. WATCH LAP on the results screen.
- **`7709590`** — cross-device profile sync.
- **`0dea1b3`** — docs for what connecting a KV store now buys.

## What is left

### 1. Sound — first pass shipped 2026-10-21 (PR #1, merge `0349709`)

Deferred twice in September; on 2026-10-21 the user asked for all of it —
engine, effects, music, mix — and then for CC0 recorded sounds as well. AUDIT
2 "Sound" has what changed. It was judged in **the sound lab**
(`npm run sound-lab`, `tools/sound-lab/README.md`), which renders before /
synth / recorded side by side from the real code and measures them. The user
asked to keep the lab. Use it before and after any audio change: levels in
particular move without anyone touching a gain.

The user approved it and it is live. Judge further audio changes in the lab
first, then commit and push to `main` like everything else — the user wants
no branches or PRs here.

### 2. ~~Code-split the engine~~ — done 2026-10-21, see above and AUDIT 2.1

### 3. Two launch blockers that need something outside the repo

- **Connect a KV store.** `.env.example` names the variables. It powers three
  things now: the shared leaderboard, the guest-number sequence, and the synced
  profile. All three degrade honestly when it is unset.
- **A measured frame-time floor.** Needs hardware that is not this machine.
  Every attempt to sample one from the preview pane returns a single frame,
  because the pane throttles `requestAnimationFrame`. The FPS readout in the
  pause menu exists so a real number can come back from a real machine.

### 4. One thing that is shipped but unverified

Cross-device sync's **real Google credential path has never been exercised**,
because this deployment has no `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and no KV store.

What *was* verified, against a stub KV: a forged token carrying the correct
`aud` in its own payload is rejected 401 and the store is never touched; push
and pull round-trip; two subjects cannot see each other's profile; an oversize
body is refused 413; and unconfigured, it answers `{synced:false, reason}`.
The happy path was exercised with verification temporarily stubbed out — which
does **not** prove the `tokeninfo` call itself. If you set a client id, that is
the first thing to actually try.

### 5. Lower priority

The five older realms (Forest, Peaks, Void, Circuit, Metro) have had every
global fix but not the bespoke landmark pass the six photo realms got.

## How work gets done here

The user is blunt and short. Reports of problems are usually accurate even when
the diagnosis in them is not — the thing they are pointing at is real, the
cause is often somewhere else entirely. They want things **verified, with
numbers**, not asserted.

The established loop: implement → `npx tsc --noEmit` → `npm run lint` → verify
in the browser → `npm run build` → `npm test` → commit → push → confirm the
deploy via the GitHub deployments API.

**`npm test` is not the gate — `npm run test:ci` is.** The build-dependent
steps (`test:budget`) only run after a build, so a green local `npm test` once
hid seven consecutive red CI runs.

Five suites, all in CI: `test:sw`, `test:data`, `test:render`, `test:cars`,
`test:sync`. Each exists because the thing it guards is invisible to the
compiler and fails silently — data pointing at missing files, rib tables that
fold a car body through itself, a profile merge that quietly hands a player a
smaller career than the one they drove.

## What will waste your afternoon

These are written up properly in the memory notes (see the `claude-memory`
repo), but the four that bite hardest here:

- **Never run `npm run build` while the dev server is up.** They share `.next/`.
  The symptoms look like real bugs: React clicks do nothing, state never
  updates, `window.__frGame` goes missing. `preview_stop` → `rm -rf .next` →
  build → restart.
- **Editing `src/game3d/*.ts` breaks hydration** on the running dev server —
  the page serves SSR HTML with no CSS and dead buttons. Same fix: stop,
  `rm -rf .next`, restart.
- **When the browser pane is hidden the WebGL canvas collapses to 2×2**, and
  every pixel measurement silently becomes meaningless while nothing errors.
  Always print the capture's dimensions next to any pixel statistic.
- **`gl.readPixels` after a render disagrees with the screenshot.** Do not
  pixel-probe to find geometry. Bisect by toggling `scene.children[i].visible`
  and re-screenshotting.

## First things to do on the new machine

```bash
git clone git@github.com:Srikarmk/duskline.git fantasy-racer
cd fantasy-racer && npm install && npm run test:ci
```

`test:ci` passing is the signal that the environment is good. Then read
`CLAUDE.md` for the architecture and `AUDIT.md` for everything that has been
found and fixed — it is long, but it is the record of which explanations turned
out to be wrong, which is the part that saves time.
