import { NextResponse } from "next/server";
import { issueRaceToken, tokenEnforced } from "@/src/server/raceToken";
import { rateLimit, tooManyRequests } from "@/src/server/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Hands out a race ticket. See src/server/raceToken.ts for what it buys.
 *
 * Rate limited harder than the score endpoint it protects: a ticket is asked
 * for once per race, so 20 a minute is generous for a player and useless for
 * anyone trying to bank tickets to spend later.
 */
export async function GET(req: Request) {
  const limit = await rateLimit(req, "race-token", 20, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  if (!tokenEnforced) return NextResponse.json({ token: null, enforced: false });
  return NextResponse.json({ token: issueRaceToken(), enforced: true });
}
