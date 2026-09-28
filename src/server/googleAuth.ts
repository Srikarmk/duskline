/**
 * Prove that a Google id token really is a Google id token, for THIS app.
 *
 * `/api/profile` is the third write endpoint in this project, and the first
 * two shipped wide open (AUDIT B4/B5). A settings-sync route keyed by a Google
 * `sub` is worse than a leaderboard if it is unauthenticated: subject ids are
 * not secret, so anyone who learned one could read and overwrite that person's
 * career. So the credential is verified before the key is touched.
 *
 * VERIFICATION IS DELEGATED TO GOOGLE'S `tokeninfo` endpoint rather than done
 * locally against the JWKS. Local verification is the documented choice at
 * high volume — it avoids a network round trip per call — but it also means
 * owning RS256 verification, key rotation and a cache, and getting any of
 * those subtly wrong fails OPEN. This is a browser racing game syncing a
 * quality setting and a win count; one extra hop on sign-in is the right price
 * for handing the cryptography to the party that issued the token.
 *
 * `aud` is checked against our own client id. Without that check the route
 * would accept a valid Google token minted for ANY application, which is the
 * classic way this goes wrong: the signature is real, the issuer is real, and
 * the token was never meant for us.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** Sign-in is only offered at all when a client id is configured. */
export const googleConfigured = CLIENT_ID.length > 0;

const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface VerifiedIdentity {
  ok: boolean;
  /** Google's stable subject id — the key everything is stored under. */
  sub?: string;
  /** Generic, for the response body. Never echoes anything from the token. */
  reason?: string;
}

interface TokenInfo {
  aud?: string;
  sub?: string;
  iss?: string;
  exp?: string | number;
  error_description?: string;
}

export async function verifyGoogleCredential(credential: unknown): Promise<VerifiedIdentity> {
  if (!googleConfigured) return { ok: false, reason: "sign-in not configured" };
  if (typeof credential !== "string" || credential.length < 40 || credential.length > 4096) {
    return { ok: false, reason: "missing credential" };
  }
  // A JWT and nothing else. Cheap shape check before spending a round trip,
  // and it keeps anything odd out of the request we make to Google.
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(credential)) return { ok: false, reason: "bad credential" };

  let info: TokenInfo;
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return { ok: false, reason: "bad credential" };
    info = (await res.json()) as TokenInfo;
  } catch {
    // Google unreachable. Refusing is the only safe answer: the alternative is
    // accepting an unverified token whenever the network hiccups.
    return { ok: false, reason: "could not verify" };
  }

  if (!info.sub) return { ok: false, reason: "bad credential" };
  if (info.aud !== CLIENT_ID) return { ok: false, reason: "wrong audience" };
  if (info.iss && !ISSUERS.has(info.iss)) return { ok: false, reason: "bad issuer" };
  // tokeninfo rejects expired tokens itself, but exp is checked here too so
  // the guarantee does not rest on an undocumented behaviour of theirs.
  const exp = Number(info.exp ?? 0);
  if (!exp || exp * 1000 < Date.now()) return { ok: false, reason: "credential expired" };

  return { ok: true, sub: info.sub };
}
