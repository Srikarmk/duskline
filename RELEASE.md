# Fantasy Racer — what's left before this is public

Updated 2026-09-14. Ordered by whether it *blocks* a public launch.

Legend: **[BLOCKER]** must be done first · **[SHIP-SOON]** days after launch is
fine · **[LATER]** real work, not urgent · **[DONE]** cleared, kept for the record.

---

## Corrections to the first draft of this file

Two items were listed as blockers and turned out not to exist. Recording that,
because acting on a wrong list wastes as much time as having no list.

- **Music licensing** was listed as "the single easiest thing to get sued
  over". There is no music to licence. All audio is generated at runtime by the
  Web Audio API — oscillators, filtered noise and envelopes in
  `src/game3d/sound.ts`. There is not a single audio file in the repository.
- **"The leaderboard is a lie across devices"** overstated it. The API already
  supports Vercel KV / Upstash via env vars and reports `global: hasKV`, and
  the UI already says *"shared board activates once a KV store is connected"*
  when it is false. It is not lying; it is unconfigured.

---

## 1. Blockers

### [DONE] Error boundary and crash recovery
`GameErrorBoundary` catches render-phase failures, and a window `error`
listener in `GameCanvas` catches the ones thrown inside `requestAnimationFrame`
— which is where this engine spends its life, and which a React boundary
cannot see. Either way you get a message and a route back to the menu instead
of a black canvas.

### [DONE] WebGL capability check
`src/game3d/capability.ts` runs before the engine is constructed and
distinguishes *no WebGL* from *WebGL 1 only* from *no float render targets*,
because those have different fixes. It also reports a `lowPower` hint from the
unmasked renderer string.

### [BLOCKER] Connect a KV store, or accept a device-only board
The board works the moment `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or the
`UPSTASH_REDIS_REST_*` pair) exist in the Vercel project. Without them, scores
live in per-instance memory, which on serverless means they effectively vanish.

Decide: connect Upstash (free tier is ample), or ship with the GLOBAL tab
removed so nobody expects one.

### [BLOCKER] No error reporting or analytics
Launching blind means never learning what broke. `GameErrorBoundary.componentDidCatch`
and the `GameCanvas` window handler are where a reporter hooks in — both already
log with a `[fantasy-racer]` prefix. Sentry's Next.js SDK is a ten-minute job.

### [BLOCKER] No measured performance floor
Everything has been tuned on one machine. There is still **no frame-time
number from any hardware**, because the preview pane throttles
`requestAnimationFrame` whenever it is not fronted, so every sampling attempt
returns a single frame. Object counts have been the proxy throughout.

What is needed: open the deployed build on a mid-range laptop and an
integrated GPU, and record median frame time on Neon Run (the heaviest realm —
260 signs, 176 towers, ~200 overhead lamps, 9 overpasses) and on Forest.

`capability.ts` already returns `lowPower`; it is **not yet wired to anything**.
The obvious use is to default the heavy settings off on weak hardware.

---

## 2. Ship-soon

### [DONE] Saved-data migration
Car ids were renamed wholesale (`comet` → `f40`) and the realm list grew twice,
so a returning visitor's stored car resolved to `CAR_SPECS[undefined]` and old
scores carried dead ids. `SCHEMA` in `src/ui/leaderboard.ts` drops anything
older rather than rendering it wrong. Bump it whenever an id stops existing.

### [DONE] Score validation
`spacewars` and `endless` were missing from `VALID_MODES`, so their scores were
silently relabelled `classic` — the board was filing Neon Run distances as
circuit races. Also added plausibility gates (a huge score in under 8 seconds,
or a time over six hours, is rejected).

### [DONE] Share metadata
Open Graph and Twitter card tags in `app/layout.tsx`, using the Sunset Bay
preview as the share image. Every share link used to render as a bare URL.

### [DONE] Credits and licence audit
`CREDITS.md`. Everything third-party is CC0 (Kenney models, Poly Haven
textures) or MIT (three.js, Next, React). One flag: **Orbitron and Rajdhani are
loaded from Google's CDN at runtime**, which sends every visitor's IP to Google
— self-hosting via `next/font` removes that and speeds up first paint.

### [DONE] CI
`.github/workflows/ci.yml` runs `tsc --noEmit` and `next build` on push and PR.
Nothing ran before, so a commit that did not compile reached production the
moment it landed — which happened.

### [DONE] Name privacy notice
The name field now says what happens to it before you type, rather than after.

### [DONE] Dev-only preview writer locked down
`app/api/devpreview/route.ts` writes to disk. It now requires both
`NODE_ENV !== "production"` **and** an explicit `FR_ALLOW_PREVIEW_WRITE=1`.

### [SHIP-SOON] Memory across many races
Each race builds a new `Game` with new textures and geometry. `stop()` exists
but has never been audited for complete disposal. Test: race → menu → race ×20,
watching `renderer.info.memory`. Neon Run is the one to test, since it builds
the most.

### [SHIP-SOON] Audio autoplay
Browsers block audio until a user gesture. `sound.ts` guards every call so
nothing breaks, but if the first race starts silent there is no prompt and no
recovery path.

### [SHIP-SOON] Dead modes in the union
`timetrial`, `nitro` and `transform` are off the picker but still in
`GameMode`, so every `Record<GameMode, …>` carries entries nothing can reach.
Decide: delete them properly, or finish and restore them.

### [SHIP-SOON] Realm previews go stale
`public/previews/realm-*.jpg` are renders of the game, so every art change
makes them wrong. They were last regenerated 2026-09-12 — before the sky
rewrite, the elevation work and the car detail pass, so **they are already out
of date**. Regenerate before launch (see the dev route above).

---

## 3. Later

### [LATER] Mobile is unhandled
No touch controls, the HUD assumes a wide viewport, and the texture budget
assumes desktop VRAM. Either commit to it properly or detect and say so.

### [LATER] No tutorial or controls reference
Controls are one line of text on the last step. No pause-menu reference, no
first-run explanation of drift, nitro or ramps.

### [LATER] Older realms predate the current art direction
Forest, Peaks, Void, Circuit and Metro have had the global fixes (banking,
elevation, sky, props) but not the bespoke landmark pass the six photo realms
got.

---

## Suggested order

1. Connect the KV store, or remove the GLOBAL tab.
2. Wire an error reporter.
3. Get a real frame-time number on hardware that is not the dev machine, and
   hook `capability.lowPower` to the quality defaults.
4. Regenerate the realm previews.
5. Self-host the fonts.
6. Everything else.
