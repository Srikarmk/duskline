import { NextResponse } from "next/server";
import { rateLimit, tooManyRequests } from "@/src/server/rateLimit";
import { verifyGoogleCredential, googleConfigured } from "@/src/server/googleAuth";
import { getDoc, setDoc, storeShared } from "@/src/server/store";

export const dynamic = "force-dynamic";

/**
 * A signed-in player's settings, career and season, kept server-side so they
 * follow them between devices. AUDIT item 21.
 *
 * READ AND WRITE ARE BOTH POST. A GET would have to carry the Google
 * credential in the query string, which puts a bearer token in access logs,
 * browser history and any proxy in between. The body costs nothing.
 *
 * GUESTS ARE NOT SYNCED, and the client will not even call this for one. A
 * guest id is minted per device — "syncing" it would create a second profile
 * on the second machine and then sit there looking like it had worked.
 *
 * Both unconfigured cases return `synced: false` with a reason rather than an
 * error. The game is entirely playable from local storage; sync is an extra,
 * and a deployment without a client id or a store should say so plainly
 * instead of throwing.
 */


/**
 * Hard ceiling on a stored profile.
 *
 * The three documents this carries are a settings object, six career counters
 * and a season with at most ten names in it — a few hundred bytes. 8 kB is
 * roughly twenty times the real thing, so it can absorb a format change and
 * still refuse to become a place to park arbitrary data.
 */
const MAX_BYTES = 8 * 1024;

export async function POST(req: Request) {
  // 30 a minute. A pull on sign-in plus a push after each race is a handful an
  // hour; this only has to stop a loop.
  const limit = await rateLimit(req, "profile", 30, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  if (!googleConfigured) {
    return NextResponse.json({ synced: false, reason: "no-identity" });
  }
  if (!storeShared) {
    return NextResponse.json({ synced: false, reason: "no-store" });
  }

  let body: { credential?: unknown; profile?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ synced: false, reason: "bad request" }, { status: 400 });
  }

  const who = await verifyGoogleCredential(body.credential);
  if (!who.ok || !who.sub) {
    return NextResponse.json({ synced: false, reason: who.reason ?? "unauthorised" }, { status: 401 });
  }

  const key = `dl:profile:${who.sub}`;

  // No profile in the request = a pull.
  if (body.profile === undefined) {
    try {
      return NextResponse.json({ synced: true, profile: await getDoc(key) });
    } catch {
      return NextResponse.json({ synced: false, reason: "store unavailable" });
    }
  }

  const serialised = JSON.stringify(body.profile);
  if (serialised.length > MAX_BYTES) {
    return NextResponse.json({ synced: false, reason: "too large" }, { status: 413 });
  }

  try {
    // A year. Long enough that a player who drifts away for a season still
    // finds their garage; short enough that abandoned profiles do not
    // accumulate in the store forever.
    await setDoc(key, body.profile, 365 * 24 * 60 * 60);
    return NextResponse.json({ synced: true, profile: body.profile });
  } catch {
    return NextResponse.json({ synced: false, reason: "store unavailable" });
  }
}
