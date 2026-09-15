/**
 * Fantasy Racer service worker.
 *
 * The manifest already makes the game installable, but an installed copy with
 * no signal opened to a network error — which is a worse experience than not
 * being installable at all, because the icon on the home screen promises an
 * app. The whole game is static except two API routes, so it can genuinely run
 * offline.
 *
 * The rule that keeps this from becoming a bug factory: NEVER cache-first an
 * unhashed URL. A service worker serving yesterday's HTML is the classic way
 * to strand everyone on an old build with no way to tell them.
 *
 *   /_next/static/**  content-hashed, immutable    -> cache-first, forever
 *   /previews, /models, /textures, icons            -> stale-while-revalidate
 *   navigations (the HTML)                          -> network-first
 *   /api/**                                         -> never touched
 */

const VERSION = "fr-v1";
const IMMUTABLE = `${VERSION}-immutable`;
const ASSETS = `${VERSION}-assets`;
const PAGES = `${VERSION}-pages`;
const ALL = [IMMUTABLE, ASSETS, PAGES];

self.addEventListener("install", (event) => {
  // Take over as soon as the new worker is ready rather than waiting for every
  // tab to close — a stale worker paired with a new build is the thing to
  // avoid, and the caches are versioned so there is nothing to lose.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !ALL.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** Hashed build output: the URL changes when the content does, so this is safe. */
function isImmutable(url) {
  return url.pathname.startsWith("/_next/static/");
}

/** Art that CAN change under a stable URL — realm previews get regenerated. */
function isAsset(url) {
  return (
    url.pathname.startsWith("/previews/") ||
    url.pathname.startsWith("/models/") ||
    url.pathname.startsWith("/textures/") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg")
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

/** Serve the cached copy immediately, refresh it in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const net = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || net;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Scores and guest numbers are the two things that must never be answered
  // from a cache — a stale leaderboard is worse than no leaderboard, and a
  // cached guest number would hand two people the same one.
  if (url.pathname.startsWith("/api/")) return;

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request, IMMUTABLE));
  } else if (isAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, ASSETS));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGES));
  }
});
