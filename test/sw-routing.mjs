// Load sw.js with a stubbed ServiceWorkerGlobalScope and assert which strategy
// each URL takes. The routing is the part that could strand someone on a stale
// build, so it is the part worth testing.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync("public/sw.js", "utf8");
const handlers = {};
const strategyOf = new Map();

const ctx = {
  self: {
    location: { origin: "https://fantasy-racer.vercel.app" },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  },
  caches: { keys: async () => [], delete: async () => true, open: async () => ({ match: async () => null, put: async () => {} }) },
  fetch: async () => ({ ok: true, clone: () => ({}) }),
  URL,
  Promise, console,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);

// Tag each strategy by wrapping what respondWith receives.
const probe = (url, mode = "no-cors", method = "GET") => {
  let chosen = "PASSTHROUGH";
  const ev = {
    request: { url, method, mode },
    respondWith: (p) => { chosen = p && p.__strategy ? p.__strategy : "HANDLED"; },
  };
  // Re-run with instrumented strategy functions
  const names = ["cacheFirst", "staleWhileRevalidate", "networkFirst"];
  for (const n of names) {
    const orig = ctx[n];
    if (typeof orig === "function") ctx[n] = (...a) => { const p = Promise.resolve(); p.__strategy = n; return p; };
  }
  handlers.fetch(ev);
  return chosen;
};

const cases = [
  ["https://fantasy-racer.vercel.app/_next/static/chunks/abc123.js", "navigate-no", "cacheFirst"],
  ["https://fantasy-racer.vercel.app/previews/realm-bay.jpg", "no", "staleWhileRevalidate"],
  ["https://fantasy-racer.vercel.app/icon-192.png", "no", "staleWhileRevalidate"],
  ["https://fantasy-racer.vercel.app/api/scores", "no", "PASSTHROUGH"],
  ["https://fantasy-racer.vercel.app/api/guest", "no", "PASSTHROUGH"],
  ["https://accounts.google.com/gsi/client", "no", "PASSTHROUGH"],
];

let fail = 0;
for (const [url, _m, want] of cases) {
  const got = probe(url);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${want.padEnd(22)} <- ${url}`);
}
// navigation must be network-first, never cache-first
const nav = probe("https://fantasy-racer.vercel.app/", "navigate");
const navOk = nav === "networkFirst";
if (!navOk) fail++;
console.log(`${navOk ? "ok  " : "FAIL"}  networkFirst           <- navigation to /`);
// a POST must never be intercepted
const post = probe("https://fantasy-racer.vercel.app/api/scores", "no", "POST");
const postOk = post === "PASSTHROUGH";
if (!postOk) fail++;
console.log(`${postOk ? "ok  " : "FAIL"}  PASSTHROUGH            <- POST /api/scores`);
console.log(fail === 0 ? "\nALL ROUTING TESTS PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
