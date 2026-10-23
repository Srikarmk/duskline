/**
 * src/server/store.ts against fake Supabase and fake Upstash servers.
 *
 * What this pins down is the CLIENT half: the URL, headers and body each
 * operation sends, and how each response is read — the part that would fail
 * silently (a wrong filter returns no rows rather than an error, a header in
 * the wrong place returns 401 and every caller quietly degrades to "not
 * shared"). The SQL functions themselves run only in Postgres; they are
 * exercised against a real project, which is a manual step (see RELEASE.md).
 *
 * Run: npm run test:store
 */
import http from "node:http";
import { spawn } from "node:child_process";

const failures = [];
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures.push(what); };

// The store reads its env at import time, so each backend runs in its own
// child process; this file is both the runner and (with an argument) the child.
const role = process.argv[2];

if (!role) {
  // ---- runner: start both fakes, run a child per backend --------------------
  const seen = [];
  const counters = new Map(), kv = new Map(), scores = [];
  const supa = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      seen.push({ method: req.method, path: url.pathname + url.search, apikey: req.headers.apikey, auth: req.headers.authorization, prefer: req.headers.prefer, body });
      const json = (v) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(v)); };
      if (req.headers.apikey !== "sb_secret_TEST") { res.statusCode = 401; return json({ message: "no key" }); }
      const a = body ? JSON.parse(body) : {};
      if (url.pathname === "/rest/v1/rpc/dl_incr") { const n = (counters.get(a.p_key) ?? 0) + 1; counters.set(a.p_key, n); return json(n); }
      if (url.pathname === "/rest/v1/rpc/dl_set_once") { if (kv.has(a.p_key)) return json(false); kv.set(a.p_key, true); return json(true); }
      if (url.pathname === "/rest/v1/rpc/dl_add_score") { scores.push({ name: a.p_name, score: a.p_score, mode: a.p_mode, time_ms: a.p_time_ms, day: "2026-10-22" }); res.statusCode = 204; return res.end(); }
      if (url.pathname === "/rest/v1/dl_kv" && req.method === "POST") { kv.set(a.key, a.value); res.statusCode = 201; return res.end(); }
      if (url.pathname === "/rest/v1/dl_kv" && req.method === "GET") {
        const k = url.searchParams.get("key")?.replace(/^eq\./, "");
        return json(kv.has(k) && url.searchParams.get("expires_at")?.startsWith("gt.") ? [{ value: kv.get(k) }] : []);
      }
      if (url.pathname === "/rest/v1/dl_scores") {
        const lim = Number(url.searchParams.get("limit"));
        return json([...scores].sort((x, y) => y.score - x.score).slice(0, lim));
      }
      res.statusCode = 404; json({ message: "not found" });
    });
  });
  const redisSeen = [];
  const rstore = new Map(); const zset = [];
  const redis = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      const cmd = JSON.parse(body); redisSeen.push(cmd);
      const out = (result) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ result })); };
      if (req.headers.authorization !== "Bearer kv-test") { res.statusCode = 401; return out(null); }
      switch (cmd[0]) {
        case "INCR": { const n = (rstore.get(cmd[1]) ?? 0) + 1; rstore.set(cmd[1], n); return out(n); }
        case "EXPIRE": return out(1);
        case "SET": if (cmd.includes("NX") && rstore.has(cmd[1])) return out(null); rstore.set(cmd[1], cmd[2]); return out("OK");
        case "GET": return out(rstore.get(cmd[1]) ?? null);
        case "ZADD": zset.push([Number(cmd[2]), cmd[3]]); return out(1);
        case "ZREMRANGEBYRANK": return out(0);
        case "ZREVRANGE": return out([...zset].sort((a, b) => b[0] - a[0]).flatMap(([s, m]) => [m, String(s)]));
      }
      out(null);
    });
  });
  await new Promise((r) => supa.listen(0, r));
  await new Promise((r) => redis.listen(0, r));
  const sbUrl = `http://127.0.0.1:${supa.address().port}/`;
  const kvUrl = `http://127.0.0.1:${redis.address().port}`;
  // Async, not spawnSync: a blocking child would freeze the event loop the
  // two fake servers answer on.
  const runAsync = (which, env) => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL(import.meta.url).pathname, which],
      { env: { PATH: process.env.PATH, ...env } });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => { process.stdout.write(out); resolve(code); });
  });
  console.log("supabase backend:");
  const c1 = await runAsync("supabase", { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_TEST", KV_REST_API_URL: kvUrl, KV_REST_API_TOKEN: "kv-test" });
  check(c1 === 0, "supabase checks passed");
  check(seen.every((s) => s.auth === undefined), "an sb_secret key is never sent as Authorization: Bearer");
  check(seen.some((s) => s.prefer?.includes("resolution=merge-duplicates")), "setDoc upserts (merge-duplicates)");
  check(seen.some((s) => s.path.startsWith("/rest/v1/dl_kv?select=value&key=eq.dl%3Aprofile%3Aabc")), "getDoc encodes the key in the filter");
  check(redisSeen.length === 0, "Supabase wins when both are configured — Upstash untouched");
  console.log("\nredis backend:");
  const c2 = await runAsync("redis", { KV_REST_API_URL: kvUrl, KV_REST_API_TOKEN: "kv-test" });
  check(c2 === 0, "redis checks passed");
  console.log("\nno backend:");
  const c3 = await runAsync("none", {});
  check(c3 === 0, "unconfigured reports none and refuses to pretend");
  supa.close(); redis.close();
  console.log("");
  if (failures.length) { console.error(`✗ ${failures.length} failed`); process.exit(1); }
  console.log("✓ store client holds for supabase, redis and none");
} else {
  // ---- child: exercise the real module ----------------------------------------
  const s = await import("../src/server/store.ts");
  const want = role;
  check(s.backend === want, `backend is "${want}"`);
  if (want === "none") {
    check(s.storeShared === false, "not shared");
    let threw = false; try { await s.incr("x"); } catch { threw = true; }
    check(threw, "operations throw rather than silently succeed");
  } else {
    check(s.storeShared === true, "shared");
    check((await s.incr("dl:guest:seq")) === 1 && (await s.incr("dl:guest:seq")) === 2, "incr counts up");
    check((await s.incr("dl:rl:scores:1.2.3.4:99", 60)) === 1, "incr with a ttl");
    check((await s.setOnce("dl:nonce:n1", 60)) === true, "setOnce claims a fresh key");
    check((await s.setOnce("dl:nonce:n1", 60)) === false, "setOnce refuses a claimed key");
    await s.setDoc("dl:profile:abc", { career: { races: 3 } }, 3600);
    const doc = await s.getDoc("dl:profile:abc");
    check(doc?.career?.races === 3, "setDoc then getDoc round-trips the document");
    check((await s.getDoc("dl:profile:nobody")) === null, "a missing document is null");
    await s.addScore({ name: "A", score: 100, mode: "classic", timeMs: 60000, date: "2026-10-22" }, 1000);
    await s.addScore({ name: "B", score: 300, mode: "endless", timeMs: 90000, date: "2026-10-22" }, 1000);
    const top = await s.topScores(20);
    check(top.length === 2 && top[0].name === "B" && top[0].timeMs === 90000 && top[0].mode === "endless", "topScores: best first, fields mapped back");
  }
  if (failures.length) process.exit(1);
}
