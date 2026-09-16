# Audit — opened 2026-09-15, worked 2026-09-16

Run against the **deployed build**, not a local dev server, except where noted.
Dependency and code checks are against the working tree.

Severity: 🔴 fix before launch · 🟠 fix soon · 🟡 worth doing · ⚪ nice to have
Status: ✅ fixed and verified · ◻ open

**12 of 13 findings are fixed.** The one left open is a build-time dependency
advisory that needs a major framework upgrade, and is not reachable in this app
— reasoning below.

---

## 1. Bugs and issues

### ✅ 🔴 B1 — First visit downloaded 12 MB of textures
**Measured before:** 12,114 KB across 18 files; 13.5 MB from landing to
driving. The normal maps were the worst (`foliage_nor` 1,372 KB).

Two compounding causes: full-resolution JPEG, and a fixed set regardless of
realm. `scripts/optimize-textures.mjs` now recompresses to WebP with a recipe
*per map type*, because the three kinds tolerate compression very differently:

| Map | Treatment | Why |
| --- | --- | --- |
| `_diff` albedo | half size, q78 | tiled over a hillside, never seen at 1:1 |
| `_nor` normals | half size, q92 | a vector per texel — compression error here is lighting pointing the wrong way, not a soft edge |
| `_arm` AO/rough/metal | quarter size, q80 | the lowest-frequency data in the set |

**Measured after: 916 KB.** 17.6 MB of source → 1.3 MB shipped, a 93% cut,
with no visible difference in the render (checked at full scale on Sunset Bay:
asphalt grain, kerbs and cliff faces all intact). The source JPEGs moved to
`assets/textures/`, out of `public/`, so 18 MB of originals no longer upload to
the CDN on every deploy.

### ✅ 🔴 B2 — Async world-build failures escaped crash recovery
`Game.start()` ended with `void this.init()`. `init()` is async and loads
models and textures over a network, so a failure there became an **unhandled
promise rejection** — invisible to both the React error boundary and the window
`error` listener. The most likely failure on someone else's machine was the one
with no recovery path: a frozen loading screen.

`GameOptions` now carries an `onError` channel, `start()` routes an init
rejection into it, and `GameCanvas` shows the recovery screen and reports the
error with `source: "init"`. The copy changed too — a retry genuinely often
works when the cause was an asset fetch.

### ✅ 🟠 B3 — The race died on *any* window error
The listener claimed every error that reached `window`, including ones thrown
by browser extensions. Now it checks the error came from our own origin;
cross-origin scripts report an empty filename and the opaque "Script error.",
and neither is something we should claim as our crash.

### ✅ 🟠 B4/B5 — Both write endpoints were wide open
`POST /api/scores` accepted any score under any name as fast as you could send
it; `POST /api/guest` did an unbounded `INCR`, so a loop could drive the guest
counter to a million and make the one genuinely shared piece of state
meaningless.

`src/server/rateLimit.ts` — fixed-window limiter, KV-backed when configured
(a per-instance counter on serverless is barely a limit; every cold start gets
a fresh one), per-instance otherwise. Scores 10/min, guest 5/min, both with a
`Retry-After` header. **Verified against the running server: 10× 200 then 429,
5× 200 then 429, `retry-after: 54`.**

Residual risk, stated plainly: this does **not** make the board trustworthy.
The client computes the score, so a determined person can still post a
believable one. That needs a server-issued race token, which is listed under
improvements rather than pretended away here.

### ✅ 🟠 B6 — Pinch-zoom was disabled site-wide
`user-scalable=no, maximum-scale=1` is right for a game canvas — a pinch
mid-corner is a mis-grab — and wrong for menus, where it is a **WCAG 1.4.4
failure**. The lock now lives where it belongs: `touch-action: none` on
`.game-stage`, which suppresses the gesture on the canvas and nowhere else.

### ✅ 🟡 B7 — The leaderboard sheet was not a real dialog
It declared `role="dialog" aria-modal="true"` — which tells a screen reader the
rest of the page is inert — and then did nothing to make that true. Now: focus
moves into the sheet on open and returns to the opener on close, Tab wraps at
both ends instead of walking out, and Escape closes it.

### ✅ 🟡 B8 — npm vulnerabilities: 4 → 2, and the two left are unreachable
`npm audit fix` cleared the `sharp`/libvips and libheif advisories. The
remaining two are `postcss`, pulled in by Next 15, and fixable only by
upgrading to Next 16 — a major.

Both postcss advisories are about **attacker-controlled CSS**: XSS via an
unescaped `</style>` in stringify output, and arbitrary `.map` file reads via a
`sourceMappingURL` comment. This project processes exactly one CSS file, which
we wrote, at build time. No user-supplied CSS ever reaches postcss, so neither
has a reachable path here. Upgrading to Next 16 is worth doing deliberately —
not bundled into a launch-week batch with everything else.

### ✅ 🟡 B9 — Twelve realm previews loaded at once
660 KB in one go, and unavoidable while they were CSS background images, which
cannot be lazy-loaded. They are `<img loading="lazy" decoding="async">` now,
with the realm's own sky gradient behind as the fallback, and WebP at q74.
**660 KB → 333 KB**, all twelve still load, layout unchanged.

### ✅ 🟡 B10 — Dependencies behind
Next 15.5.20 → 15.5.25, React 19.2.7 → 19.3.0, `@types/three` → 0.185.4. The
majors left deliberately: Next 16, three 0.186, TypeScript 7.

### ✅ ⚪ B11 — `escape()` in the Google token decoder
Replaced with `TextDecoder`. Worth more than the "deprecated API" label
suggests: `atob` returns bytes-as-latin1, and any name with a non-ASCII
character in it — most of the world — needs those bytes decoded as UTF-8.

### ✅ ⚪ B12 — README and CLAUDE.md described a different game
README advertised "four realms" and "a transforming sword-mech"; CLAUDE.md said
"the 3 realms" and described a name-entry home screen. Both rewritten during
the rename.

### ✅ NEW — Two invisible meshes on every fog-lamp car
Found by the first ESLint run, from a `no-unused-expressions` warning:

```js
if (p.fogLamps) for (const sx of [-1, 1])
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(...), lensMat)
        .translateX(0).translateY(0)),          // ← comma operator
    g.add(box(0.14, 0.1, 0.05, lensMat, sx * hw * 0.52, ...));
```

A comma operator, so **two** meshes were added per side: the fog lamp, and a
cylinder positioned by `.translateX(0).translateY(0)` — i.e. left at the car's
origin, buried inside the body where it could never be seen. Two invisible
meshes riding along on every Imprez, uploaded and drawn every frame. The
cylinder was an abandoned first attempt; the box is the lamp.

### ✅ NEW — ESLint had never been run, and it was holding ~700 lines of dead code
`next lint` has always offered to set this up and never had been, so 25k lines
were written with only `tsc` watching. The first run found 42 problems. Cleared
by deleting what they pointed at:

- **seven superseded car builders** (`buildKart`, `buildFormula`,
  `buildMonsterTruck`, `buildHover`, `buildDragster`, `buildBuggy`, `buildJet`)
  — the kart-era catalogue, replaced by the per-car rib system. `cars.ts`
  2,085 → 1,402 lines.
- unused helpers (`panelBetween`, `tyre`, `monsterWheel`, `suspensionArm`,
  `hexStr`, `gemGeometry`, `KartParams`, `Wing`), 16 unused import specifiers,
  and a dead weather-label table.
- the fog-lamp bug above.

`npm run lint` is clean and CI runs it.

---

## 2. What we could improve

### Performance
1. ✅ **Code-split the engine.** `GameApp` imported `GameCanvas` statically, so
   three.js shipped in the first chunk — **405 kB of JavaScript to display a
   menu that renders no triangles.** Now a `dynamic()` import with a loading
   state. **Page 295 kB → 23 kB; first-load JS 398 kB → 126 kB, a 68% cut.**
   The engine downloads while the player is choosing a world.
2. ✅ **Recompress the textures** — see B1. 12.1 MB → 916 KB.
3. ◻ **Per-realm texture sets.** Still ships snow to a beach: a race at Sunset
   Bay downloads `ground_peaks_*`. Now a 916 KB problem rather than a 12 MB
   one, which is why it dropped down the list.
4. ◻ **Merge Neon Run's city geometry.** 3,060 draw calls against 640 for the
   circuit realms. Signs and lamps are the repeated pieces.
5. ◻ **Precache during the menu.** The player spends ten seconds choosing; the
   service worker could pull race assets during them.

### Gameplay depth
6. ◻ **Ghost cars** — your own best lap, replayed. Cheap to record, and the
   feature that makes time attack matter.
7. ◻ **Progression**: cars unlocked by distance or podiums.
8. ◻ **A real championship**: Grand Prix is three rounds; a season with
   standings is the same code with persistence.
9. ◻ **Photo mode.** The art direction is the point of this game and there is
   no way to show it off. A free camera and a hidden HUD is an afternoon.
10. ◻ **Weather as a race condition** rather than decoration.
11. ◻ **Rival personalities** — the AI is one behaviour with a rubber band.

### Product
12. ◻ **Share a result**: a generated image with car, realm, time and score.
13. ◻ **Daily challenge** — same realm, car and seed for everyone, one run a
    day. The cheapest retention mechanic there is, and it needs the KV store
    that is already on the release list.
14. ◻ **Replays** of the last lap.
15. ◻ **Settings synced across devices** once identity is real.

### Engineering
16. ✅ **ESLint** — configured, clean, and in CI. See above for what it found.
17. ◻ **Tests beyond the service-worker routing check.** The physics helpers
    (`verticalCurvature`, banking, the placement blend) are pure functions and
    would take an hour to cover.
18. ◻ **A frame-budget test in CI** — assert draw calls and triangle counts
    stay under a ceiling, so a scenery change cannot quietly double them.
19. ◻ **A signed race token** for score submission, closing what rate limiting
    only slows (see B4).
20. ◻ **Next 16 upgrade**, which also clears the last two advisories.
21. ◻ **`prefers-reduced-motion`** is handled in CSS but not in the engine —
    camera shake and speed blur still run.

---

## 3. Verified working

Answered with measurements rather than assumed:

- **Service worker is live and effective.** Registered and `activated` on the
  deployed site, all three caches populated, and a second visit transfers
  **0 bytes** — all 18 textures from cache. This was the one item the previous
  report listed as unverified.
- **No third-party requests.** Fonts self-hosted; nothing calls out.
- **Accessibility basics pass**: all 21 focusable controls have accessible
  names, images have `alt`, one `h1`, `lang` set, `main` landmark present.
- **No console errors or warnings** through the gate, the setup steps and a
  race.
- **Memory is flat** across 15 race→menu→race cycles after the disposal fix.
- **Share metadata resolves correctly** — `og:image` is an absolute URL on the
  production domain, despite the build-time `metadataBase` warning.
- **The dead-code removal changed nothing.** Sunset Bay after: 641 draw calls,
  7.9 M triangles, 543 geometries, 13 textures — identical to before. All ten
  cars build, and the Imprez (the fog-lamp car) drives.

---

## 4. What a first visit costs now

| | Before | After |
| --- | --- | --- |
| First-load JavaScript | 405 kB | **126 kB** |
| Textures for the first race | 12,114 kB | **916 kB** |
| Realm previews on step 1 | 660 kB | **333 kB** |
| **Total to first race** | **~13.5 MB** | **~1.4 MB** |

A tenth of what it was, and the second visit is still zero.
