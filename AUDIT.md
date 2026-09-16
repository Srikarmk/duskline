# Audit — 2026-09-15

Run against the **deployed build**, not a local dev server, except where noted.
Dependency and code checks are against the working tree.

Severity: 🔴 fix before launch · 🟠 fix soon · 🟡 worth doing · ⚪ nice to have

---

## 1. Bugs and issues

### 🔴 B1 — First visit downloads 12 MB of textures
Measured on the live site: a single race pulls **12 114 KB across 18 texture
files**; 13.5 MB total from landing to driving. The biggest are normal maps —
`foliage_nor` 1 372 KB, `ground_peaks_nor` 1 057 KB, `bark_nor` 992 KB.

Two compounding problems: they are **JPEG at full resolution** (WebP/AVIF at
half size would cut this by roughly 75% with no visible difference at the
distance these are seen), and **the set is fixed regardless of realm** — a race
at Sunset Bay still downloads `ground_peaks_*`.

Mitigated on repeat visits: the service worker serves all 18 from cache on the
second visit, **0 bytes transferred**. But a first impression on cellular is
minutes of black screen.

### 🔴 B2 — Async world-build failures escape crash recovery
`Game.start()` ends with `void this.init()`, and `init()` is async. A rejection
there — a model that will not parse, a texture 404, an out-of-memory during
world build — becomes an **unhandled promise rejection**, which neither the
React error boundary nor the window `error` listener catches. There is no
`unhandledrejection` handler anywhere in the app.

So the one place most likely to fail (asset loading, over a network, on someone
else's hardware) is the one place with no recovery path. The player gets a
frozen loading screen.

### 🟠 B3 — The race dies on *any* window error
`GameCanvas`'s window `error` listener sets the fatal state for every error
that reaches `window`, including ones thrown by browser extensions or anything
else on the page. A benign third-party error kills the race with "The race
stopped."

### 🟠 B4 — Anyone can post any score to the global board
`POST /api/scores` has no authentication, no rate limit and no proof of play.
The plausibility gates reject a huge score in under 8 seconds, but `curl` with
a believable score and time is accepted, under any name — including someone
else's. This only becomes a live problem the moment a KV store is connected.

Options, cheapest first: rate-limit by IP; sign the result with a
server-issued race token; accept it as a toy board and say so in the UI.

### 🟠 B5 — `/api/guest` can be spammed
Every POST does an unbounded `INCR`. Nothing stops a loop driving the counter
to a million, which makes the guest number meaningless (and is the one piece of
state that is actually shared).

### 🟠 B6 — Pinch-zoom is disabled site-wide
`user-scalable=no, maximum-scale=1` is right for a game canvas and wrong for
menus — it is a **WCAG 1.4.4 failure**, and it applies to the leaderboard and
every setup step. Should be scoped to the race, not the document.

### 🟡 B7 — The leaderboard sheet is not a real dialog
It sets `role="dialog" aria-modal="true"` but has no focus trap, does not move
focus into itself, and does not close on Escape. Keyboard and screen-reader
users can tab out of it into the page behind.

### 🟡 B8 — 4 npm vulnerabilities (1 critical, 3 high)
`postcss` path traversal, and `sharp` inheriting four libvips CVEs plus two
libheif advisories. Both are build-time dependencies rather than shipped code,
which lowers the severity, but `npm audit fix` clears them.

### 🟡 B9 — Twelve realm previews load at once
Step 1 fetches **660 KB across 12 JPEGs** simultaneously because they are CSS
background images, which cannot be lazy-loaded. `<img loading="lazy">` or an
IntersectionObserver would defer the ones below the fold.

### 🟡 B10 — Dependencies are behind
Next 15.5.20 (15.5.25 patch, 16.3.5 major), React 19.2.7 → 19.3.0, three 0.185
→ 0.186, TypeScript 5.9 → 7.0. The patch bumps are free; the majors need
deliberate time.

### ⚪ B11 — `escape()` in the Google token decoder
`src/ui/identity.ts` uses the legacy `escape()` for UTF-8 handling. It works
everywhere today but is deprecated; `TextDecoder` is the modern equivalent.

### ⚪ B12 — README and CLAUDE.md describe a different game
README still says "four realms" and "a transforming sword-mech" — there are
twelve realms and the mech is archived. CLAUDE.md says "the 3 realms" and
describes name entry on the home screen, which no longer exists. TODO.md and
PLAN.md predate most of the project.

---

## 2. What we could improve

### Performance
1. **Code-split the engine.** `GameApp` imports `GameCanvas` statically, so
   three.js is in the initial bundle: **405 KB of JavaScript to show a menu.**
   A `dynamic()` import would cut first load by roughly 60% and load the engine
   while the player is choosing a world.
2. **Recompress the textures** (B1). Biggest single win available.
3. **Per-realm texture sets** — do not ship snow to a beach.
4. **Merge Neon Run's city geometry.** 3 060 draw calls against 640 for the
   circuit realms. Signs and lamps are the repeated pieces.
5. **Precache during the menu.** The player spends ten seconds choosing; the
   service worker could be pulling the race assets during them.

### Gameplay depth
6. **Ghost cars** — your own best lap, replayed. Cheap to record (position
   samples), and it is the feature that makes time attack matter.
7. **Progression**: cars unlocked by distance or podiums, so the catalogue is
   something you work through rather than a menu.
8. **A real championship**: Grand Prix is three rounds; a season with points,
   standings and a car that improves is the same code with persistence.
9. **Photo mode.** The art direction is the point of this game and there is no
   way to show it off. A free camera and a hidden HUD is an afternoon.
10. **Weather as a race condition** rather than decoration — wet grip, spray,
    visibility.
11. **Rival personalities** — the AI is one behaviour with a rubber band.

### Product
12. **Share a result**: a generated image with car, realm, time and score.
    Nothing in the game currently produces a shareable artefact.
13. **Daily challenge** — same realm, car and seed for everyone, one run a day.
    The cheapest retention mechanic that exists, and it needs the KV store that
    is already on the list.
14. **Replays / highlights** of the last lap.
15. **Settings persistence across devices** once identity is real.

### Engineering
16. **ESLint is not configured** — `next lint` offers to set it up and never
    has been. No linting has ever run on this codebase.
17. **No tests except the service-worker routing check.** The physics helpers
    (`verticalCurvature`, banking, the placement blend) are pure functions and
    would take an hour to cover.
18. **A frame-budget test in CI** — assert draw calls and triangle counts stay
    under a ceiling, so a scenery change cannot quietly double them.
19. **Error-rate visibility** once a Sentry DSN exists.
20. **`prefers-reduced-motion`** is handled in CSS but not in the engine —
    camera shake and the speed blur still run.

---

## 3. Verified working

Things that were open questions and are now answered with measurements:

- **Service worker is live and effective.** Registered and `activated` on the
  deployed site, all three caches populated, and a second visit transfers
  **0 bytes** — all 18 textures served from cache. This was the one item the
  previous report listed as unverified.
- **No third-party requests.** Fonts are self-hosted; nothing calls out.
- **Accessibility basics pass**: every one of 21 focusable controls has an
  accessible name, images have `alt`, one `h1`, `lang` set, `main` landmark
  present.
- **No console errors or warnings** on the deployed build, through the gate,
  the setup steps and a race.
- **Memory is flat** across 15 race→menu→race cycles after the disposal fix.
- **Share metadata resolves correctly** — `og:image` is an absolute URL on the
  production domain, despite the build-time `metadataBase` warning.
