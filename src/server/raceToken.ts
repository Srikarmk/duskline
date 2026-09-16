import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const hasKV = Boolean(KV_URL && KV_TOKEN);

/**
 * A server-issued ticket that says "a race actually started here, at this
 * time".
 *
 * Rate limiting slowed score forging down; it never stopped it. The board is
 * still fed by a number the CLIENT computes, and no amount of validation on
 * this side can change that — running the simulation server-side is the only
 * real answer and is far more machinery than a browser racing game's
 * leaderboard is worth.
 *
 * What this does close is the cheap attack: `curl` with a believable score and
 * no race. To post now you must first ask for a token and then WAIT — the
 * server checks that at least most of your claimed race duration has actually
 * elapsed since it issued the ticket. Faking a 3-minute lap costs you three
 * minutes per attempt, which is the difference between a script and a hobby.
 *
 * Set `RACE_TOKEN_SECRET` to turn it on. Unset, submission works exactly as
 * before and `/api/scores` says `verified: false` rather than implying a
 * guarantee it is not making.
 */

const SECRET = process.env.RACE_TOKEN_SECRET ?? "";
export const tokenEnforced = SECRET.length >= 16;

/** How long a ticket stays usable. Long enough for a Grand Prix, not a week. */
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * How much of the claimed duration must really have passed.
 *
 * Not 1.0: the clock starts when the token is issued, which is when the race
 * screen mounts, and the claimed `timeMs` starts when the countdown ends a few
 * seconds later. 0.8 absorbs that without leaving room to claim a twenty-minute
 * epic you drove in ten seconds.
 */
const MIN_ELAPSED_FRACTION = 0.8;

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function issueRaceToken(): string {
  const payload = JSON.stringify({ iat: Date.now(), n: randomBytes(8).toString("base64url") });
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sign(body)}`;
}

export interface TokenCheck {
  ok: boolean;
  /** Why it failed — for the response body, and only ever generic. */
  reason?: string;
  /** The nonce, so a caller with a KV store can reject replays. */
  nonce?: string;
}

/**
 * Verify a ticket against a claimed race duration.
 *
 * Returns ok when enforcement is off, so the caller does not have to know
 * whether a secret is configured.
 */
export function verifyRaceToken(token: unknown, claimedMs: number): TokenCheck {
  if (!tokenEnforced) return { ok: true };
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "missing token" };

  const [body, mac] = token.split(".", 2);
  const expected = sign(body);
  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch rather than returning false.
  if (mac.length !== expected.length) return { ok: false, reason: "bad token" };
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return { ok: false, reason: "bad token" };

  let iat = 0;
  let nonce = "";
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { iat?: number; n?: string };
    iat = Number(parsed.iat) || 0;
    nonce = String(parsed.n ?? "");
  } catch {
    return { ok: false, reason: "bad token" };
  }

  const age = Date.now() - iat;
  // A token from the future means a tampered or wildly skewed clock.
  if (age < -60_000) return { ok: false, reason: "bad token" };
  if (age > MAX_AGE_MS) return { ok: false, reason: "token expired" };
  if (claimedMs > 0 && age < claimedMs * MIN_ELAPSED_FRACTION) {
    return { ok: false, reason: "race shorter than claimed" };
  }
  return { ok: true, nonce };
}

/** Per-instance fallback for replay protection: nonce -> expiry. */
const usedLocally = new Map<string, number>();

/**
 * Spend a ticket. Returns false if it has already been spent.
 *
 * Without this a ticket is reusable for its whole three-hour life, so one race
 * would buy an afternoon of submissions — the rate limit caps the flow but not
 * the total. Verified as a real hole before it was closed: the same ticket
 * posted twice, and both scores landed.
 *
 * KV makes this airtight across instances (`SET NX` is atomic). Without it,
 * per-instance memory catches a naive loop and not much more, which is the
 * same honest limitation the rate limiter has and is documented rather than
 * papered over.
 */
export async function spendRaceToken(nonce: string | undefined): Promise<boolean> {
  if (!tokenEnforced) return true;
  if (!nonce) return false;
  const key = `dl:nonce:${nonce}`;
  const ttl = Math.ceil(MAX_AGE_MS / 1000);

  if (hasKV) {
    try {
      const res = await fetch(KV_URL as string, {
        method: "POST",
        headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(["SET", key, "1", "NX", "EX", String(ttl)]),
        cache: "no-store",
      });
      if (res.ok) {
        const { result } = (await res.json()) as { result: unknown };
        return result !== null;      // null means the key already existed
      }
    } catch {
      // KV unreachable — fall through rather than refuse every honest score.
    }
  }

  const now = Date.now();
  if (usedLocally.size > 5000) {
    for (const [k, exp] of usedLocally) if (exp < now) usedLocally.delete(k);
  }
  const seen = usedLocally.get(nonce);
  if (seen !== undefined && seen > now) return false;
  usedLocally.set(nonce, now + MAX_AGE_MS);
  return true;
}
