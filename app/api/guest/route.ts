import { NextResponse } from "next/server";
import { rateLimit, tooManyRequests } from "@/src/server/rateLimit";
import { incr, storeShared } from "@/src/server/store";

export const dynamic = "force-dynamic";

/**
 * Hands out the next guest number.
 *
 * "Continue as guest" needs a name, and asking someone to invent one is the
 * friction we are removing. A shared counter gives RACER 1, RACER 2, RACER 3 —
 * which is only meaningful if it is genuinely shared, so it lives in the same
 * store the leaderboard uses (src/server/store.ts).
 *
 * Without a store there is nowhere global to count, and per-instance memory on
 * serverless would hand three different people the same number. So the
 * fallback is honest: it returns `shared: false` and the client generates a
 * local id instead of pretending to a sequence it cannot keep.
 */
const COUNTER = "dl:guest:seq";

export async function POST(req: Request) {
  // 5 a minute. Claiming a guest number is a once-per-device act; the limit
  // exists because an unbounded INCR means a loop can make the shared
  // sequence meaningless for everyone.
  const limit = await rateLimit(req, "guest", 5, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  if (!storeShared) {
    return NextResponse.json({ shared: false });
  }
  try {
    return NextResponse.json({ shared: true, number: await incr(COUNTER) });
  } catch {
    return NextResponse.json({ shared: false });
  }
}
