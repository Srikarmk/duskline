# Duskline — what's left before this is public

Updated 2026-10-22. Ordered by whether it *blocks* a public launch. The owner
checklist at the bottom is the short version: everything still open needs an
account or a device, not a code change.

Legend: **[BLOCKER]** must be done first · **[SHIP-SOON]** days after launch is
fine · **[LATER]** real work, not urgent · **[DONE]** cleared, kept for the record.

---

## Corrections to the first draft of this file

Items that were listed as blockers and turned out not to exist. Recording
that, because acting on a wrong list wastes as much time as having no list.

- **Music licensing** was listed as "the single easiest thing to get sued
  over". There is no music to licence: the music, engine, tyres and ambience
  are generated at runtime by the Web Audio API in `src/game3d/sound.ts`.
  Since 2026-10-21 seven effects also use recordings — all CC0, from Kenney's
  Impact and Sci-fi packs, every take mapped to its source in `CREDITS.md`
  with the licences in `public/sfx/`. Still nothing to licence.
- **"The leaderboard is a lie across devices"** overstated it. The API already
  supports Vercel KV / Upstash via env vars and reports `global: hasKV`, and
  the UI already says *"shared board activates once a KV store is connected"*
  when it is false. It is not lying; it is unconfigured.
- **"Memory leaks across many races"** was a suspicion, not an observation. It
  has now been measured (see below) and there is no runaway leak.

---

## 1. Blockers

### [BLOCKER] Connect a KV store, or accept a device-only board
**This is now the only thing on the list that cannot be done from inside the
repository** — it needs credentials on the Vercel project.

`.env.example` documents exactly what to set. The board works the moment
`KV_REST_API_URL` + `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` pair)
exist in the Vercel project; adding Upstash from the Vercel Marketplace sets
them automatically. The same store powers the shared guest-number sequence, so
without it "RACER 1015" is a local random number rather than the 1015th guest.

Decide: connect Upstash (free tier is ample), or ship with the GLOBAL tab
removed so nobody expects one.

Since this was written the same store has picked up a third job: a signed-in
player's synced profile (`/api/profile` — settings, career, season). That one
also needs `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, because it is keyed by the Google
subject id and verifies every call against it. Both unset is the current
state, and all three features say so in the UI rather than failing.

### [BLOCKER] No measured performance floor
Still open, and still for the same reason: **no frame-time number from any
hardware but this machine.** Every attempt to sample one from the preview pane
returns a single frame, because the pane throttles `requestAnimationFrame`
whenever it is not fronted.

What *is* now measured, by forcing renders manually at high quality:

| Realm | Draw calls / frame | Triangles / frame |
| --- | --- | --- |
| Sunset Bay (circuit) | 640 | 7.9 M |
| Neon Run (endless) | 3 060 | 5.9 M |

Draw calls are in good shape overall — they were ~12 k before the per-prop
merge — but **Neon Run is nearly 5× the circuit realms**, which is consistent
with it being the realm that feels heaviest. That is the one to profile first,
and the number to attack if a phone struggles: it is city geometry (signs,
towers, lamps) that could merge further.

What is still needed: open the deployed build on a mid-range laptop and a
phone, turn on the FPS readout in the pause menu, and record the median on
Neon Run (the heaviest realm — 260 signs, 176 towers, ~200 overhead lamps, 9
overpasses) and on Forest.

Mitigations already in place: quality tiers (dpr cap, shadow map, post chain,
scenery density) and `capability.lowPower` choosing the first-run default.

### [DONE] Error reporting
`src/ui/report.ts`. Both crash paths — `GameErrorBoundary.componentDidCatch`
and the `GameCanvas` window handler that catches errors thrown inside
`requestAnimationFrame` — now call `reportError`, tagged with realm, mode, car,
quality tier and GPU string.

Set `NEXT_PUBLIC_SENTRY_DSN` to turn it on; unset, it is exactly the console
line it was before. It posts the Sentry ingest envelope directly rather than
pulling in `@sentry/nextjs` (~90 kB on the client) for a browser game whose
whole pitch is that it loads fast. Capped at 8 events per session and
de-duplicated by message, because an error thrown inside the render loop is
thrown sixty times a second.

### [DONE] Error boundary and crash recovery
`GameErrorBoundary` catches render-phase failures; a window `error` listener in
`GameCanvas` catches the ones thrown inside `requestAnimationFrame`, which is
where this engine spends its life and which a React boundary cannot see.

### [DONE] WebGL capability check
`src/game3d/capability.ts` distinguishes *no WebGL* from *WebGL 1 only* from
*no float render targets*, and reports a `lowPower` hint from the unmasked
renderer string. That hint now picks the starting quality tier on first run.

---

## 2. Ship-soon

### [DONE] Memory across many races — measured, and made deterministic
**29 race → menu → race cycles**, sampling the JS heap and `renderer.info`
after each. Result: heap oscillated between 118 and 173 MB with no runaway
climb (first five races averaged 140 MB, the last five 154 MB — inside GC
noise, and there is no way to force a collection to settle it exactly).
Geometry count identical every race (542), canvas count never above 2, no
context-loss warnings. So: no leak.

But `stop()` was relying on the collector for all of it, so it now disposes
explicitly — every geometry and material in the scene, then
`renderer.forceContextLoss()`. That last one matters: browsers cap live WebGL
contexts at about sixteen and kill the oldest when you exceed it, and every
race builds a new renderer. Textures are deliberately *not* disposed; the
expensive ones are shared between races through the caches in `textures.ts`
and `cars.ts`.

Re-measured after that change, over 15 more cycles: the heap goes **flat** —
an eight-race stretch inside a 2.8 MB band, and the run ends 24 MB *below*
where it started. Worth having even though there was no leak to fix, because
GPU memory is not visible to the heap-pressure model that decides when to
collect: a machine can be out of VRAM while the heap looks fine.

### [DONE] Audio autoplay
The race starts from a click so the context is normally allowed — but iOS
Safari only honours a `resume()` made inside the gesture's own call stack, and
`Game.start()` runs a tick later from a React effect. When that happened the
race was simply silent with no explanation. `Sound.blocked` now reports it, and
`GameCanvas` offers a **TAP FOR SOUND** chip; any pointer or key on the stage
also unlocks it.

### [DONE] Self-hosted fonts
Orbitron and Rajdhani were pulled from `fonts.googleapis.com` at runtime, which
sends every visitor's IP to Google before a pixel is drawn. They are now
downloaded at build time by `next/font` and served from our own origin.
Verified on the running app: **zero third-party requests**, five `.woff2` files
all from `/_next/static/media/`.

### [DONE] Dead modes in the union — decided
`timetrial` and `nitro` are **deleted**: thin variations on classic, removed
from the game, and every `Record<GameMode, …>` was carrying a row nothing could
reach. `transform` is **archived, not deleted** — it is off the picker, but the
mech, the sword and the monsters are still wired to it, so it stays reachable
by passing the mode directly. `SCHEMA` in `src/ui/leaderboard.ts` is bumped to
3 so a saved score carrying a deleted mode is dropped rather than rendered
blank.

### [DONE] Shadow type was silently downgraded
`PCFSoftShadowMap` was deprecated in three r18x; the renderer fell back to
`PCFShadowMap` and warned on every race. Now set explicitly — which also
explains where the soft edges come from: PCFSoft ignores `shadow.radius` and
PCF honours it, and `radius` is 7.

### [DONE] Saved-data migration
Car ids were renamed wholesale (`comet` → `f40`) and the realm list grew twice,
so a returning visitor's stored car resolved to `CAR_SPECS[undefined]`. `SCHEMA`
drops anything older rather than rendering it wrong. Bump it whenever an id
stops existing.

### [DONE] Score validation
`spacewars` and `endless` were missing from `VALID_MODES`, so their scores were
silently relabelled `classic`. Also added plausibility gates (a huge score in
under 8 seconds, or a time over six hours, is rejected).

### [DONE] Share metadata
Open Graph and Twitter card tags in `app/layout.tsx`. Every share link used to
render as a bare URL.

### [DONE] Credits and licence audit
`CREDITS.md`. Everything third-party is CC0 (Kenney models, Poly Haven
textures) or MIT/OFL (three.js, Next, React, the two fonts).

### [DONE] CI
`.github/workflows/ci.yml` runs `tsc --noEmit` and `next build` on push and PR.
Nothing ran before, so a commit that did not compile reached production the
moment it landed — which happened.

### [DONE] Dev-only preview writer locked down
`app/api/devpreview/route.ts` requires both `NODE_ENV !== "production"` **and**
an explicit `FR_ALLOW_PREVIEW_WRITE=1`.

### [DONE] Realm previews regenerated
All twelve regenerated 2026-09-14 against the current art (after the sky
rewrite, the elevation work and the car detail pass). They are renders of the
game, so any significant art change makes them wrong again — regenerate with
the dev route above.

### [DONE] Service worker
`public/sw.js`, registered in production only by `ServiceWorkerRegister`. An
installed copy with no signal used to open to a network error, which is worse
than not being installable at all — the icon on the home screen promises an app.

The rule that keeps a worker from becoming a bug factory: never cache-first an
unhashed URL. `/_next/static/**` is content-hashed so it is cache-first
forever; `/previews`, `/models`, `/textures` and icons are
stale-while-revalidate; navigations are network-first; `/api/**` and
cross-origin are never touched.

`npm run test:sw` asserts every one of those routing decisions against the
real file, and CI runs it — the worker is plain JS outside the bundle, so
neither `tsc` nor `next build` would ever look at it.

✅ **Verified in a real browser, 2026-10-22**, against the production URL in
Chromium (the in-app preview pane refuses to register any worker, which is why
this was open). First visit: the worker registers and activates. After a
reload: the page is controlled, with 33 entries cached (`dl-v1-immutable` 14,
`dl-v1-assets` 18, `dl-v1-pages` 1). Then offline, a reload still opens the
sign-in screen. The only failed requests offline are the API calls, as
designed.

---

## 3. Later

Two of the three items that were here have since been done; they are kept in
place rather than moved, so the section reads as a record of what "later"
turned out to mean.

### [DONE] Tutorial and controls reference
`FirstRunHint` shows the controls once, on the first race ever, and is
dismissed by any input at all (the countdown is running behind it, so it had to
be glanceable rather than a modal). It reads the touch flag, so a phone gets
pad names instead of key names. Never shown again — one localStorage key.

The pause menu's one-line mnemonic is now a nine-row reference. Both of them
say the thing nothing in the game said before: **drifting through a corner is
what refills nitro.** That is the mechanic the whole game is built around and
it was discoverable only by accident.

Side effect worth noting: the settings panel had no height cap, and nine extra
rows pushed BACK off the bottom of a landscape phone. Capped at 92vh with
internal scroll.

### [LATER] Older realms predate the current art direction
Forest, Peaks, Void, Circuit and Metro have had the global fixes (banking,
elevation, sky, props) but not the bespoke landmark pass the six photo realms
got.

### [DONE] Mobile
Touch controls (`TouchControls.tsx` synthesises the same key events the engine
already listens for), a PWA manifest with `display: fullscreen` so the game
gets the whole panel instead of losing 15–20% to browser chrome, quality tiers
defaulting to medium on a coarse pointer, and a home screen that fits a 390 ×
844 viewport without scrolling. Not yet measured on a real handset — see the
performance blocker.

---

### [DONE] Launch hardening, 2026-10-22
- **Security headers on every route**: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
  that denies camera, microphone, geolocation and payment, and
  `X-Frame-Options: SAMEORIGIN` (HSTS was already sent by Vercel). **No CSP, on
  purpose**: three.js chunks, Google Identity, the Sentry ingest endpoint and
  the service worker all need allowing, and a CSP that misses one breaks the
  game with no visible error. Only add one with the live game tested against it.
- **`metadataBase`** is set, so the share image stays an absolute
  production URL on preview deployments and on any custom domain.
- **The favicon 404** that every page load produced (`/favicon.ico` does not
  exist) is gone; the page now declares the existing app icon.
- **`/sfx` gets the same one-week cache** as the other art. It was the one art
  folder still served with `max-age=0`.
- **Smoke-tested as a first-time visitor in Chromium**: the sign-in screen,
  guest, DRIVE NOW, a race on screen, pause, quit (with its new confirmation)
  and back to the menu, with no console or HTTP errors. A first visit
  transfers about 1.15 MB, most of it the race textures fetched in the
  background while you are on the menu.

---

## What is actually left — the owner checklist

Nothing below can be done from inside the repository. In order:

1. **Connect a database for the shared leaderboard.** Vercel → the `duskline`
   project → Storage (or Marketplace) → **Upstash for Redis** → create (the
   free tier is enough) → connect it to the project for Production and
   Preview. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` itself. Then
   **redeploy**: env vars are read at build time. It turns on three things at
   once: the GLOBAL board, real guest numbers ("RACER 1015" as the 1015th
   guest instead of a random one), and profile sync for signed-in players.
   If you would rather not, the game is honest about it as it is; just know
   the GLOBAL tab will say it is not switched on.
2. **Once the board is shared, set `RACE_TOKEN_SECRET`.** Vercel → Settings →
   Environment Variables → add `RACE_TOKEN_SECRET` = any random string of 16+
   characters (e.g. the output of `openssl rand -hex 24`), all environments,
   then redeploy. Without it anyone can `curl` a believable score onto the
   board.
3. **Measure the frame rate on real hardware.** On a phone and on an ordinary
   laptop (not a gaming machine): open playduskline.vercel.app, start a race,
   press **Esc** (or the pause button on a phone) → **Settings** → **Show
   FPS** on → resume. Drive a lap of **Neon Run** (the heaviest world) and one
   of **Enchanted Forest**, and note the number at the top right. Under 30 on
   either device is the thing to report back; the quality setting in the same
   menu is the first lever.
4. *Optional* — **Google sign-in.** Google Cloud Console → APIs & Services →
   Credentials → Create OAuth client ID → Web application → add
   `https://playduskline.vercel.app` (and any custom domain) under *Authorised
   JavaScript origins*. To publish the consent screen beyond test users,
   Google requires a privacy-policy URL. Then set
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in Vercel and redeploy. The first thing to
   try afterwards is sign-in on two devices, because the real token check has
   never run against Google (see HANDOFF).
5. *Optional* — **crash reports.** Create a Sentry project (Browser
   JavaScript), copy its DSN, set `NEXT_PUBLIC_SENTRY_DSN` in Vercel,
   redeploy.
6. *Optional* — **a custom domain.** Vercel → the project → Settings →
   Domains → add it and follow the DNS instructions. If Google sign-in is on,
   add the new origin to the OAuth client too.

Still open inside the repo, but not launch-blocking: the five older realms
(Forest, Peaks, Void, Circuit, Metro) have not had the bespoke landmark pass
the six photo realms got.
