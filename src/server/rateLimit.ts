/**
 * A small fixed-window rate limiter for the two write endpoints.
 *
 * Both were wide open. `POST /api/scores` would accept any score under any
 * name as fast as you could send it, and `POST /api/guest` did an unbounded
 * INCR — so a loop could drive the guest counter to a million and make the one
 * genuinely shared piece of state meaningless.
 *
 * This does NOT make the leaderboard trustworthy. The client computes the
 * score, so a determined person can still post a believable one; that needs a
 * server-issued race token, which is a bigger change than this and is recorded
 * in AUDIT.md. What this does is turn "trivial to flood" into "not worth the
 * effort", which is the right size of defence for a browser game's board.
 *
 * Uses the same store as the leaderboard when one is configured, because a
 * per-instance counter on serverless is barely a limit at all — each cold
 * start gets a fresh one. Without one it still limits per instance, which is
 * better than nothing and is all that is available.
 */

import { incr, storeShared } from "./store";

/** Per-instance fallback: bucket key -> [windowStartMs, count]. */
const local = new Map<string, [number, number]>();

/**
 * The caller's IP, as far as it can be known behind Vercel's proxy.
 *
 * `x-forwarded-for` is a client-settable header in general, but on Vercel the
 * edge overwrites it, so the first entry is the real peer. Falling back to a
 * single shared bucket is deliberate: if we cannot tell callers apart, one
 * shared limit is safer than no limit.
 */
function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim();
  return ip || req.headers.get("x-real-ip") || "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets — goes out as Retry-After. */
  retryAfter: number;
}

/**
 * @param bucket  what is being limited, e.g. "scores"
 * @param limit   requests allowed per window
 * @param windowSec  window length in seconds
 */
export async function rateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  // A FIXED window, not a sliding one: the key carries the window number, so
  // it expires on its own and there is no set to prune.
  const window = Math.floor(now / (windowSec * 1000));
  const key = `dl:rl:${bucket}:${clientKey(req)}:${window}`;
  const retryAfter = windowSec - Math.floor((now % (windowSec * 1000)) / 1000);

  if (storeShared) {
    try {
      const count = await incr(key, windowSec);
      return { ok: count <= limit, retryAfter };
    } catch {
      // Store unreachable. Refusing every write because the limiter is down
      // would be a worse failure than not limiting, so fall through to local.
    }
  }

  const entry = local.get(key);
  const count = (entry?.[1] ?? 0) + 1;
  local.set(key, [window, count]);
  // Keep the map from growing without bound on a long-lived instance.
  if (local.size > 5000) {
    for (const [k, v] of local) if (v[0] < window) local.delete(k);
  }
  return { ok: count <= limit, retryAfter };
}

/** Standard 429 with the header clients actually honour. */
export function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "rate limited" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  });
}
