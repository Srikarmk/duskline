/**
 * The one shared store behind the leaderboard, the guest numbers, synced
 * profiles, rate limits and race tickets.
 *
 * Three backends, chosen by which credentials exist, in this order:
 *
 *   supabase  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 *             Tables and functions from supabase/schema.sql, reached over
 *             PostgREST with plain fetch — no SDK in the bundle.
 *   redis     KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_*
 *             pair): Vercel KV / Upstash, as before.
 *   none      neither. Every caller already degrades honestly without a store
 *             (per-instance memory, `shared: false`, "not switched on"), so
 *             this module only reports that and the callers keep doing it.
 *
 * Five files used to each speak Redis to the store themselves. They now ask
 * this module for the six things they actually need, which is what made a
 * second backend a change in one place.
 */

export interface ScoreEntry {
  name: string;
  score: number;
  mode: string;
  timeMs: number;
  date: string;
}

const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export type Backend = "supabase" | "redis" | "none";
export const backend: Backend = SB_URL && SB_KEY ? "supabase" : KV_URL && KV_TOKEN ? "redis" : "none";
/** True when state is shared across instances — what the UI calls "global". */
export const storeShared = backend !== "none";

// --- supabase ---------------------------------------------------------------

function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: SB_KEY, "Content-Type": "application/json", ...extra };
  // A legacy service_role key is a JWT and goes in Authorization too. The new
  // `sb_secret_…` keys are not JWTs and are only accepted in `apikey`.
  if (SB_KEY.startsWith("eyJ")) h.Authorization = `Bearer ${SB_KEY}`;
  return h;
}

async function sb(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<unknown> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: sbHeaders(init.headers),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const rpc = (fn: string, args: Record<string, unknown>) =>
  sb(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

// --- redis ------------------------------------------------------------------

async function kv(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

const SCORES_KEY = "dl:scores:v1";

// --- the operations ------------------------------------------------------------
// Each throws when the store is configured but unreachable, so the caller
// chooses how to degrade; none of them should be called when `backend` is
// "none" (they throw then too).

function noStore(): never {
  throw new Error("no store configured");
}

/** Add one and return the new value. With a ttl, the count restarts after it. */
export async function incr(key: string, ttlSec?: number): Promise<number> {
  if (backend === "supabase") {
    return Number(await rpc("dl_incr", { p_key: key, p_ttl_seconds: ttlSec ?? null }));
  }
  if (backend === "redis") {
    const n = Number(await kv(["INCR", key]));
    if (ttlSec && n === 1) await kv(["EXPIRE", key, ttlSec + 1]);
    return n;
  }
  return noStore();
}

/** Claim a key for `ttlSec`. True if this call claimed it, false if it was taken. */
export async function setOnce(key: string, ttlSec: number): Promise<boolean> {
  if (backend === "supabase") return (await rpc("dl_set_once", { p_key: key, p_ttl_seconds: ttlSec })) === true;
  if (backend === "redis") return (await kv(["SET", key, "1", "NX", "EX", String(ttlSec)])) !== null;
  return noStore();
}

/** A stored JSON document, or null if there is none (or it has expired). */
export async function getDoc(key: string): Promise<unknown | null> {
  if (backend === "supabase") {
    const now = new Date().toISOString();
    const rows = (await sb(
      `dl_kv?select=value&key=eq.${encodeURIComponent(key)}&expires_at=gt.${encodeURIComponent(now)}`,
    )) as { value: unknown }[];
    return rows[0]?.value ?? null;
  }
  if (backend === "redis") {
    const raw = (await kv(["GET", key])) as string | null;
    return raw ? JSON.parse(raw) : null;
  }
  return noStore();
}

/** Store a JSON document for `ttlSec`, replacing any there. */
export async function setDoc(key: string, value: unknown, ttlSec: number): Promise<void> {
  if (backend === "supabase") {
    await sb("dl_kv?on_conflict=key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key, value, expires_at: new Date(Date.now() + ttlSec * 1000).toISOString() }),
    });
    return;
  }
  if (backend === "redis") {
    await kv(["SET", key, JSON.stringify(value), "EX", String(ttlSec)]);
    return;
  }
  noStore();
}

/** Put a score on the board. The store keeps only the best `keep`. */
export async function addScore(e: ScoreEntry, keep: number): Promise<void> {
  if (backend === "supabase") {
    await rpc("dl_add_score", { p_name: e.name, p_score: e.score, p_mode: e.mode, p_time_ms: e.timeMs });
    return;
  }
  if (backend === "redis") {
    await kv(["ZADD", SCORES_KEY, String(e.score), JSON.stringify(e)]);
    await kv(["ZREMRANGEBYRANK", SCORES_KEY, "0", String(-(keep + 1))]);
    return;
  }
  noStore();
}

/** The best `n` scores, best first. */
export async function topScores(n: number): Promise<ScoreEntry[]> {
  if (backend === "supabase") {
    const rows = (await sb(
      `dl_scores?select=name,score,mode,time_ms,day&order=score.desc,id.asc&limit=${n}`,
    )) as { name: string; score: number; mode: string; time_ms: number; day: string }[];
    return rows.map((r) => ({ name: r.name, score: r.score, mode: r.mode, timeMs: r.time_ms, date: r.day }));
  }
  if (backend === "redis") {
    const flat = (await kv(["ZREVRANGE", SCORES_KEY, "0", String(n - 1), "WITHSCORES"])) as string[];
    const out: ScoreEntry[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      try {
        out.push(JSON.parse(flat[i]) as ScoreEntry);
      } catch {
        // skip malformed
      }
    }
    return out;
  }
  return noStore();
}
