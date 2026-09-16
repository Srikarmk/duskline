import { NextResponse } from "next/server";
import { rateLimit, tooManyRequests } from "@/src/server/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Hands out the next guest number.
 *
 * "Continue as guest" needs a name, and asking someone to invent one is the
 * friction we are removing. A shared counter gives RACER 1, RACER 2, RACER 3 —
 * which is only meaningful if it is genuinely shared, so it lives in the same
 * KV store the leaderboard uses.
 *
 * Without KV there is nowhere global to count, and per-instance memory on
 * serverless would hand three different people the same number. So the
 * fallback is honest: it returns `shared: false` and the client generates a
 * local id instead of pretending to a sequence it cannot keep.
 */
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const hasKV = Boolean(KV_URL && KV_TOKEN);
const COUNTER = "dl:guest:seq";

export async function POST(req: Request) {
  // 5 a minute. Claiming a guest number is a once-per-device act; the limit
  // exists because an unbounded INCR means a loop can make the shared
  // sequence meaningless for everyone.
  const limit = await rateLimit(req, "guest", 5, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  if (!hasKV) {
    return NextResponse.json({ shared: false });
  }
  try {
    const res = await fetch(KV_URL as string, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(["INCR", COUNTER]),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`kv ${res.status}`);
    const { result } = (await res.json()) as { result: number };
    return NextResponse.json({ shared: true, number: Number(result) });
  } catch {
    return NextResponse.json({ shared: false });
  }
}
